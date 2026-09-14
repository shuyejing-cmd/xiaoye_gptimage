import { AppError } from "../../shared/errors.mjs";
import { withTransaction } from "../db/pool.mjs";

function publicJob(job, wallet) {
  return {
    id: job.id,
    userId: job.user_id,
    requestId: job.request_id,
    state: job.state,
    provider: job.provider,
    encryptedPayload: job.encrypted_payload,
    upstreamTaskId: job.upstream_task_id,
    outputObjectKey: job.output_object_key,
    outputMimeType: job.output_mime_type,
    errorCode: job.error_code,
    completedAt: job.completed_at,
    wallet: wallet ? { availableCredits: Number(wallet.available_credits), heldCredits: Number(wallet.held_credits) } : undefined
  };
}

async function lockWallet(client, userId) {
  const result = await client.query("select * from wallets where user_id = $1 for update", [userId]);
  if (!result.rowCount) throw new AppError({ code: "wallet_not_found", message: "账户钱包不存在", httpStatus: 404 });
  return result.rows[0];
}

export function createGenerationJobs({ pool, cipher, requestIdFactory, now = () => new Date() }) {
  return {
    async enqueue({ userId, idempotencyKey, provider, request, referenceObjectKeys = [], beforeCreate }) {
      if (!idempotencyKey) throw new AppError({ code: "missing_idempotency_key", message: "缺少幂等请求标识", httpStatus: 400 });
      try {
        return await withTransaction(pool, async (client) => {
        await client.query("select id from users where id = $1 for update", [userId]);
        const existing = await client.query("select * from generation_jobs where user_id = $1 and idempotency_key = $2", [userId, idempotencyKey]);
        if (existing.rowCount) return publicJob(existing.rows[0]);
        if (beforeCreate) await beforeCreate(client);
        const active = await client.query("select count(*)::int as count from generation_jobs where user_id=$1 and state in ('queued','submitting','provider_pending','output_persisting','unknown')", [userId]);
        if (Number(active.rows[0].count) >= 1) throw new AppError({ code: "generation_concurrency_limit", message: "已有图片正在生成，请完成后再发起新任务", httpStatus: 429 });
        const wallet = await lockWallet(client, userId);
        if (Number(wallet.available_credits) < 1) throw new AppError({ code: "insufficient_credits", message: "生成额度不足，请先充值", httpStatus: 402 });
        const requestId = requestIdFactory();
        const encryptedPayload = cipher.encrypt({ request, referenceObjectKeys });
        const job = (await client.query(
          "insert into generation_jobs(request_id,user_id,idempotency_key,state,provider,encrypted_payload,available_at,created_at,updated_at) values($1,$2,$3,'queued',$4,$5,$6,$6,$6) returning *",
          [requestId, userId, idempotencyKey, provider, encryptedPayload, now()]
        )).rows[0];
        await client.query("update wallets set available_credits=$2,held_credits=$3,version=version+1,updated_at=$4 where user_id=$1", [userId, Number(wallet.available_credits) - 1, Number(wallet.held_credits) + 1, now()]);
        await client.query("insert into credit_holds(user_id,generation_id,amount,state,created_at) values($1,$2,1,'held',$3)", [userId, job.id, now()]);
        await client.query("insert into ledger_entries(user_id,event_type,amount,reference_type,reference_id,created_at) values($1,'hold',-1,'generation',$2,$3)", [userId, String(job.id), now()]);
          return publicJob(job);
        });
      } catch (error) {
        if (error?.code === "23505") {
          const existing = await pool.query("select * from generation_jobs where user_id=$1 and idempotency_key=$2", [userId, idempotencyKey]);
          if (existing.rowCount) return publicJob(existing.rows[0]);
        }
        throw error;
      }
    },

    markOutputPersisting({ requestId, objectKey, mimeType }) {
      return pool.query("update generation_jobs set state='output_persisting',output_object_key=$2,output_mime_type=$3,updated_at=$4 where request_id=$1 and state not in ('succeeded','failed')", [requestId, objectKey, mimeType, now()]);
    },

    markProviderPending({ requestId, upstreamTaskId }) {
      return pool.query("update generation_jobs set state='provider_pending',upstream_task_id=$2,error_code=null,unknown_since=null,updated_at=$3 where request_id=$1 and state in ('submitting','unknown')", [requestId, upstreamTaskId, now()]);
    },

    claimNext() {
      return withTransaction(pool, async (client) => {
        const result = await client.query("update generation_jobs set state='submitting',claimed_at=$1,updated_at=$1 where id=(select id from generation_jobs where state='queued' and available_at<=$1 order by created_at,id limit 1) and state='queued' returning *", [now()]);
        if (!result.rowCount) return null;
        const job = publicJob(result.rows[0]);
        return { ...job, payload: cipher.decrypt(result.rows[0].encrypted_payload) };
      });
    },

    succeed({ requestId }) {
      return withTransaction(pool, async (client) => {
        const job = (await client.query("select * from generation_jobs where request_id=$1 for update", [requestId])).rows[0];
        if (!job) throw new AppError({ code: "generation_not_found", message: "生成任务不存在", httpStatus: 404 });
        if (job.state === "succeeded") return publicJob(job);
        if (!job.output_object_key) throw new AppError({ code: "output_not_persisted", message: "生成结果尚未可靠保存", httpStatus: 409 });
        const hold = (await client.query("select * from credit_holds where generation_id=$1 for update", [job.id])).rows[0];
        if (hold?.state === "held") {
          const wallet = await lockWallet(client, job.user_id);
          await client.query("update wallets set held_credits=$2,version=version+1,updated_at=$3 where user_id=$1", [job.user_id, Number(wallet.held_credits) - Number(hold.amount), now()]);
          await client.query("update credit_holds set state='captured',settled_at=$2 where id=$1", [hold.id, now()]);
          await client.query("insert into ledger_entries(user_id,event_type,amount,reference_type,reference_id,created_at) values($1,'capture',$2,'generation',$3,$4)", [job.user_id, -Number(hold.amount), String(job.id), now()]);
        }
        const saved = (await client.query("update generation_jobs set state='succeeded',encrypted_payload=null,completed_at=$2,updated_at=$2 where id=$1 returning *", [job.id, now()])).rows[0];
        return publicJob(saved);
      });
    },

    fail({ requestId, errorCode }) {
      return withTransaction(pool, async (client) => {
        const job = (await client.query("select * from generation_jobs where request_id=$1 for update", [requestId])).rows[0];
        if (!job) throw new AppError({ code: "generation_not_found", message: "生成任务不存在", httpStatus: 404 });
        if (job.state === "failed") return publicJob(job);
        if (job.state === "succeeded") throw new AppError({ code: "generation_already_succeeded", message: "已成功任务不能标记失败", httpStatus: 409 });
        const hold = (await client.query("select * from credit_holds where generation_id=$1 for update", [job.id])).rows[0];
        if (hold?.state === "held") {
          const wallet = await lockWallet(client, job.user_id);
          await client.query("update wallets set available_credits=$2,held_credits=$3,version=version+1,updated_at=$4 where user_id=$1", [job.user_id, Number(wallet.available_credits) + Number(hold.amount), Number(wallet.held_credits) - Number(hold.amount), now()]);
          await client.query("update credit_holds set state='released',settled_at=$2 where id=$1", [hold.id, now()]);
          await client.query("insert into ledger_entries(user_id,event_type,amount,reference_type,reference_id,created_at) values($1,'release',$2,'generation',$3,$4)", [job.user_id, Number(hold.amount), String(job.id), now()]);
        }
        const saved = (await client.query("update generation_jobs set state='failed',error_code=$2,encrypted_payload=null,completed_at=$3,updated_at=$3 where id=$1 returning *", [job.id, errorCode, now()])).rows[0];
        return publicJob(saved);
      });
    },

    markUnknown({ requestId, errorCode }) {
      return pool.query("update generation_jobs set state='unknown',error_code=$2,unknown_since=$3,updated_at=$3 where request_id=$1 and state not in ('succeeded','failed')", [requestId, errorCode, now()]);
    },

    async escalateUnresolved({ olderThan }) {
      const result = await pool.query("update generation_jobs set state='manual_review',encrypted_payload=null,updated_at=$2 where (state='unknown' and unknown_since<=$1) or (state in ('provider_pending','output_persisting') and updated_at<=$1) returning request_id", [olderThan, now()]);
      return result.rows.map((row) => row.request_id);
    },

    async listReconciliationCandidates({ limit = 100, staleSubmittingBefore = new Date(Date.now() - 10 * 60 * 1000) } = {}) {
      const result = await pool.query(
        "select * from generation_jobs where state in ('provider_pending','output_persisting','unknown') or (state='submitting' and updated_at<=$1) order by updated_at,id limit $2",
        [staleSubmittingBefore, limit]
      );
      return result.rows.map((row) => publicJob(row));
    },

    async getForUser({ userId, requestId }) {
      const result = await pool.query("select j.*,w.available_credits,w.held_credits from generation_jobs j join wallets w on w.user_id=j.user_id where j.request_id=$1 and j.user_id=$2", [requestId, userId]);
      if (!result.rowCount) throw new AppError({ code: "generation_not_found", message: "生成任务不存在", httpStatus: 404 });
      const row = result.rows[0];
      return publicJob(row, row);
    },

    decrypt(job) {
      return cipher.decrypt(job.encryptedPayload ?? job.encrypted_payload);
    }
  };
}
