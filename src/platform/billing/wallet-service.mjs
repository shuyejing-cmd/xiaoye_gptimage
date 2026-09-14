import { AppError } from "../../shared/errors.mjs";
import { withTransaction } from "../db/pool.mjs";

const shape = (row) => ({ availableCredits: Number(row.available_credits), heldCredits: Number(row.held_credits) });

async function balance(client, userId) {
  const result = await client.query("select available_credits, held_credits from wallets where user_id = $1", [userId]);
  if (!result.rowCount) throw new AppError({ code: "wallet_not_found", message: "账户钱包不存在", httpStatus: 404 });
  return shape(result.rows[0]);
}

export function createWalletService({ pool }) {
  return {
    getBalance: (userId) => balance(pool, userId),

    hold({ userId, generationId, amount = 1 }) {
      return withTransaction(pool, async (client) => {
        const locked = await client.query("select available_credits, held_credits from wallets where user_id = $1 for update", [userId]);
        if (!locked.rowCount) throw new AppError({ code: "wallet_not_found", message: "账户钱包不存在", httpStatus: 404 });
        const existing = await client.query("select state from credit_holds where generation_id = $1", [generationId]);
        if (existing.rowCount) return balance(client, userId);
        if (Number(locked.rows[0].available_credits) < amount) throw new AppError({ code: "insufficient_credits", message: "生成额度不足，请先充值", httpStatus: 402 });
        await client.query("update wallets set available_credits = $2, held_credits = $3, version = version + 1, updated_at = now() where user_id = $1", [userId, Number(locked.rows[0].available_credits) - amount, Number(locked.rows[0].held_credits) + amount]);
        await client.query("insert into credit_holds(user_id,generation_id,amount,state) values($1,$2,$3,'held')", [userId, generationId, amount]);
        await client.query("insert into ledger_entries(user_id,event_type,amount,reference_type,reference_id) values($1,'hold',$2,'generation',$3)", [userId, -amount, String(generationId)]);
        return balance(client, userId);
      });
    },

    capture({ generationId }) {
      return withTransaction(pool, async (client) => {
        const result = await client.query("select * from credit_holds where generation_id = $1 for update", [generationId]);
        const hold = result.rows[0];
        if (!hold) throw new AppError({ code: "credit_hold_not_found", message: "生成额度冻结记录不存在", httpStatus: 409 });
        if (hold.state === "held") {
          const wallet = (await client.query("select available_credits, held_credits from wallets where user_id = $1 for update", [hold.user_id])).rows[0];
          await client.query("update wallets set held_credits = $2, version = version + 1, updated_at = now() where user_id = $1", [hold.user_id, Number(wallet.held_credits) - Number(hold.amount)]);
          await client.query("update credit_holds set state = 'captured', settled_at = now() where id = $1", [hold.id]);
          await client.query("insert into ledger_entries(user_id,event_type,amount,reference_type,reference_id) values($1,'capture',$2,'generation',$3)", [hold.user_id, -Number(hold.amount), String(generationId)]);
        }
        return balance(client, hold.user_id);
      });
    },

    release({ generationId }) {
      return withTransaction(pool, async (client) => {
        const result = await client.query("select * from credit_holds where generation_id = $1 for update", [generationId]);
        const hold = result.rows[0];
        if (!hold) throw new AppError({ code: "credit_hold_not_found", message: "生成额度冻结记录不存在", httpStatus: 409 });
        if (hold.state === "held") {
          const wallet = (await client.query("select available_credits, held_credits from wallets where user_id = $1 for update", [hold.user_id])).rows[0];
          await client.query("update wallets set available_credits = $2, held_credits = $3, version = version + 1, updated_at = now() where user_id = $1", [hold.user_id, Number(wallet.available_credits) + Number(hold.amount), Number(wallet.held_credits) - Number(hold.amount)]);
          await client.query("update credit_holds set state = 'released', settled_at = now() where id = $1", [hold.id]);
          await client.query("insert into ledger_entries(user_id,event_type,amount,reference_type,reference_id) values($1,'release',$2,'generation',$3)", [hold.user_id, Number(hold.amount), String(generationId)]);
        }
        return balance(client, hold.user_id);
      });
    },

    credit({ userId, amount, eventType, referenceType, referenceId, metadata }) {
      if (!Number.isInteger(amount) || amount <= 0) throw new AppError({ code: "invalid_credit_amount", message: "额度必须是正整数", httpStatus: 400 });
      return withTransaction(pool, async (client) => {
        const locked = await client.query("select available_credits from wallets where user_id = $1 for update", [userId]);
        if (!locked.rowCount) throw new AppError({ code: "wallet_not_found", message: "账户钱包不存在", httpStatus: 404 });
        const existing = await client.query("select id from ledger_entries where reference_type = $1 and reference_id = $2 and event_type = $3", [referenceType, String(referenceId), eventType]);
        if (!existing.rowCount) {
          await client.query(
            "insert into ledger_entries(user_id,event_type,amount,reference_type,reference_id,metadata) values($1,$2,$3,$4,$5,$6)",
            [userId, eventType, amount, referenceType, String(referenceId), metadata ? JSON.stringify(metadata) : null]
          );
          await client.query("update wallets set available_credits = $2, version = version + 1, updated_at = now() where user_id = $1", [userId, Number(locked.rows[0].available_credits) + amount]);
        }
        return balance(client, userId);
      });
    },

    adjust({ userId, amount, adminId, reason, referenceId }) {
      if (!Number.isInteger(amount) || amount === 0) throw new AppError({ code: "invalid_adjustment_amount", message: "调账额度必须是非零整数", httpStatus: 400 });
      if (!String(reason || "").trim()) throw new AppError({ code: "adjustment_reason_required", message: "人工调账必须填写原因", httpStatus: 400 });
      return withTransaction(pool, async (client) => {
        const admin = (await client.query("select role,status from users where id=$1", [adminId])).rows[0];
        if (!admin || admin.role !== "admin" || admin.status !== "active") throw new AppError({ code: "admin_required", message: "需要管理员权限", httpStatus: 403 });
        const locked = (await client.query("select * from wallets where user_id=$1 for update", [userId])).rows[0];
        if (!locked) throw new AppError({ code: "wallet_not_found", message: "账户钱包不存在", httpStatus: 404 });
        if (Number(locked.available_credits) + amount < 0) throw new AppError({ code: "insufficient_credits", message: "调账后可用额度不能为负数", httpStatus: 409 });
        const id = String(referenceId || `admin-${adminId}-${Date.now()}`);
        const duplicate = await client.query("select id from ledger_entries where reference_type='admin_adjustment' and reference_id=$1 and event_type='admin_adjustment'", [id]);
        if (!duplicate.rowCount) {
          await client.query("update wallets set available_credits=$2,version=version+1,updated_at=now() where user_id=$1", [userId, Number(locked.available_credits) + amount]);
          await client.query("insert into ledger_entries(user_id,event_type,amount,reference_type,reference_id,metadata) values($1,'admin_adjustment',$2,'admin_adjustment',$3,$4)", [userId, amount, id, JSON.stringify({ reason: String(reason).trim(), adminId })]);
          await client.query("insert into audit_events(actor_user_id,action,target_type,target_id,reason) values($1,'adjust_wallet','user',$2,$3)", [adminId, String(userId), String(reason).trim()]);
        }
        return balance(client, userId);
      });
    }
  };
}
