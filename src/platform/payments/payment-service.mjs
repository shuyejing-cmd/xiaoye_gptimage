import { AppError } from "../../shared/errors.mjs";
import { withTransaction } from "../db/pool.mjs";

const MAX_PROOF_BYTES = 10 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const PROOF_RETENTION_MS = 180 * DAY_MS;

function proofMime(buffer) {
  if (buffer?.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if (buffer?.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) return "image/jpeg";
  if (buffer?.subarray(0, 4).toString("ascii") === "RIFF" && buffer?.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  throw new AppError({ code: "invalid_payment_proof", message: "付款凭证必须是 PNG、JPEG 或 WebP 图片", httpStatus: 400 });
}

function publicOrder(row) {
  return { id: row.id, orderNo: row.order_no, packageName: row.package_name, priceFen: Number(row.price_fen), credits: Number(row.credits), state: row.state, note: row.note, expiresAt: row.expires_at };
}

export function createPaymentService({ pool, proofStore, paymentProvider, now = () => new Date(), orderNoFactory }) {
  const provider = paymentProvider || createManualQrProvider({ pool, proofStore });
  const approvalQueues = new Map();

  async function serializeApproval(userId, operation) {
    const key = String(userId);
    const previous = approvalQueues.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    approvalQueues.set(key, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (approvalQueues.get(key) === current) approvalQueues.delete(key);
    }
  }

  return {
    createInstructions() {
      return provider.createInstructions();
    },

    async createOrder({ userId, packageId }) {
      const pack = (await pool.query("select * from recharge_packages where id=$1 and active=true", [packageId])).rows[0];
      if (!pack) throw new AppError({ code: "recharge_package_not_found", message: "充值套餐不存在或已下架", httpStatus: 404 });
      const createdAt = now();
      const row = (await pool.query(
        "insert into recharge_orders(order_no,user_id,package_id,provider,package_name,price_fen,credits,state,created_at,updated_at,expires_at) values($1,$2,$3,$4,$5,$6,$7,'created',$8,$8,$9) returning *",
        [orderNoFactory(), userId, packageId, provider.name, pack.name, pack.price_fen, pack.credits, createdAt, new Date(createdAt.getTime() + DAY_MS)]
      )).rows[0];
      return publicOrder(row);
    },

    async submitProof({ userId, orderId, buffer, mimeType, note }) {
      if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_PROOF_BYTES) throw new AppError({ code: "invalid_payment_proof", message: "付款凭证不能为空且不能超过 10 MiB", httpStatus: 400 });
      const detectedMime = proofMime(buffer);
      if (mimeType && mimeType !== detectedMime) throw new AppError({ code: "invalid_payment_proof", message: "付款凭证图片格式不匹配", httpStatus: 400 });
      const order = (await pool.query("select * from recharge_orders where id=$1 and user_id=$2", [orderId, userId])).rows[0];
      if (!order || order.state !== "created") throw new AppError({ code: "recharge_order_not_payable", message: "充值订单不存在或不能再提交凭证", httpStatus: 409 });
      const stored = await provider.submitProof({ orderNo: order.order_no, buffer, mimeType: detectedMime });
      const saved = await withTransaction(pool, async (client) => {
        const locked = (await client.query("select * from recharge_orders where id=$1 and user_id=$2 for update", [orderId, userId])).rows[0];
        if (!locked || locked.state !== "created") throw new AppError({ code: "recharge_order_not_payable", message: "充值订单不存在或不能再提交凭证", httpStatus: 409 });
        await client.query("insert into payment_proofs(order_id,object_key,sha256,mime_type,created_at,delete_after) values($1,$2,$3,$4,$5,$6)", [orderId, stored.objectKey, stored.sha256, detectedMime, now(), new Date(now().getTime() + PROOF_RETENTION_MS)]);
        return (await client.query("update recharge_orders set state='proof_submitted',note=$2,updated_at=$3 where id=$1 returning *", [orderId, String(note || "").trim().slice(0, 500) || null, now()])).rows[0];
      });
      return publicOrder(saved);
    },

    async approve({ adminId, orderId }) {
      const approvalTarget = (await pool.query("select user_id from recharge_orders where id=$1", [orderId])).rows[0];
      if (!approvalTarget) throw new AppError({ code: "recharge_order_not_found", message: "充值订单不存在", httpStatus: 404 });
      try {
        return await serializeApproval(approvalTarget.user_id, () => withTransaction(pool, async (client) => {
          const admin = (await client.query("select role,status from users where id=$1", [adminId])).rows[0];
          if (!admin || admin.role !== "admin" || admin.status !== "active") throw new AppError({ code: "admin_required", message: "需要管理员权限", httpStatus: 403 });
          const order = (await client.query("select * from recharge_orders where id=$1 for update", [orderId])).rows[0];
          if (order.state === "approved") return publicOrder(order);
          if (order.state !== "proof_submitted") throw new AppError({ code: "recharge_order_not_reviewable", message: "充值订单尚未提交有效凭证", httpStatus: 409 });
          await client.query("select id from users where id=$1 for update", [order.user_id]);
          const wallet = (await client.query("select * from wallets where user_id=$1 for update", [order.user_id])).rows[0];
          const previous = await client.query("select count(*)::int as count from recharge_orders where user_id=$1 and state='approved' and id<>$2", [order.user_id, order.id]);
          const firstRecharge = Number(previous.rows[0].count) === 0;
          const total = Number(order.credits) + (firstRecharge ? 10 : 0);
          await client.query("update wallets set available_credits=$2,version=version+1,updated_at=$3 where user_id=$1", [order.user_id, Number(wallet.available_credits) + total, now()]);
          await client.query("insert into ledger_entries(user_id,event_type,amount,reference_type,reference_id,created_at) values($1,'recharge',$2,'recharge_order',$3,$4)", [order.user_id, order.credits, String(order.id), now()]);
          if (firstRecharge) await client.query("insert into ledger_entries(user_id,event_type,amount,reference_type,reference_id,created_at) values($1,'first_recharge_bonus',10,'user',$2,$3)", [order.user_id, String(order.user_id), now()]);
          const saved = (await client.query("update recharge_orders set state='approved',reviewed_by=$2,reviewed_at=$3,updated_at=$3 where id=$1 returning *", [order.id, adminId, now()])).rows[0];
          await client.query("insert into audit_events(actor_user_id,action,target_type,target_id,reason,created_at) values($1,'approve_recharge','recharge_order',$2,'管理员确认付款到账',$3)", [adminId, String(order.id), now()]);
          return publicOrder(saved);
        }));
      } catch (error) {
        if (error?.code === "23505") {
          const order = (await pool.query("select * from recharge_orders where id=$1", [orderId])).rows[0];
          if (order?.state === "approved") return publicOrder(order);
        }
        throw error;
      }
    },

    reject({ adminId, orderId, reason }) {
      if (!String(reason || "").trim()) throw new AppError({ code: "review_reason_required", message: "驳回时必须填写原因", httpStatus: 400 });
      return withTransaction(pool, async (client) => {
        const admin = (await client.query("select role,status from users where id=$1", [adminId])).rows[0];
        if (!admin || admin.role !== "admin" || admin.status !== "active") throw new AppError({ code: "admin_required", message: "需要管理员权限", httpStatus: 403 });
        const saved = (await client.query("update recharge_orders set state='rejected',reviewed_by=$2,reviewed_at=$3,review_reason=$4,updated_at=$3 where id=$1 and state='proof_submitted' returning *", [orderId, adminId, now(), String(reason).trim().slice(0, 500)])).rows[0];
        if (!saved) throw new AppError({ code: "recharge_order_not_reviewable", message: "充值订单不能驳回", httpStatus: 409 });
        await client.query("insert into audit_events(actor_user_id,action,target_type,target_id,reason,created_at) values($1,'reject_recharge','recharge_order',$2,$3,$4)", [adminId, String(orderId), reason, now()]);
        return publicOrder(saved);
      });
    },

    async expireCreatedOrders() {
      const result = await pool.query("update recharge_orders set state='expired',updated_at=$1 where state='created' and expires_at<=$1 returning id", [now()]);
      return result.rows.map((row) => row.id);
    }
  };
}

export function createManualQrProvider({ pool, proofStore, channels = [] }) {
  return {
    name: "manual_qr",
    async createInstructions() {
      const activeChannels = pool
        ? (await pool.query("select id,provider,name,qr_object_key,instructions from payment_channels where active=true order by sort_order,id")).rows
        : channels.filter((channel) => channel.active);
      return Promise.all(activeChannels.map(async (channel) => ({
        id: channel.id,
        provider: "manual_qr",
        name: channel.name,
        instructions: channel.instructions || null,
        qr_url: channel.qr_url || channel.qrUrl || (channel.qr_object_key && proofStore?.signedUrl ? await proofStore.signedUrl(channel.qr_object_key, 300) : null)
      })));
    },
    submitProof({ orderNo, buffer, mimeType }) {
      if (!proofStore?.put) throw new AppError({ code: "payments_unavailable", message: "付款凭证存储暂不可用", httpStatus: 503 });
      return proofStore.put({ orderNo, buffer, mimeType });
    },
    confirm(order, operator) {
      return { type: "payment_confirmed", orderId: order.id, operatorId: operator.id };
    },
    reject(order, operator, reason) {
      return { type: "payment_rejected", orderId: order.id, operatorId: operator.id, reason };
    }
  };
}
