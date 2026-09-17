import { createHmac, randomBytes as cryptoRandomBytes } from "node:crypto";
import { AppError } from "../../shared/errors.mjs";
import { withTransaction } from "../db/pool.mjs";

const TOKEN_TTL_MS = 30 * 60 * 1000;
const TOKEN_LIMIT = 5;

function digest(pepper, value) {
  return createHmac("sha256", pepper).update(`installation-token:${value}`).digest("hex");
}

function fail(code, message, httpStatus) {
  throw new AppError({ code, message, httpStatus });
}

export function createInstallationTokenService({ pool, pepper, apiKeyService, now = () => new Date(), randomBytes = cryptoRandomBytes }) {
  if (!pepper) throw new Error("installation token pepper is required");
  if (!apiKeyService?.resolveActiveForInstallation) throw new Error("API key installation resolver is required");

  return {
    create({ userId, sessionId, apiKeyId }) {
      return withTransaction(pool, async (client) => {
        await client.query("select id from users where id=$1 for update", [userId]);
        const session = (await client.query("select id from sessions where id=$1 and user_id=$2 and revoked_at is null and expires_at>$3", [sessionId, userId, now()])).rows[0];
        if (!session) fail("invalid_session", "登录状态已失效，请重新登录", 401);
        await apiKeyService.resolveActiveForInstallation({ userId, keyId: apiKeyId, client });
        const active = Number((await client.query("select count(id)::int count from installation_tokens where user_id=$1 and consumed_at is null and expires_at>$2", [userId, now()])).rows[0].count);
        if (active >= TOKEN_LIMIT) fail("installation_token_limit_reached", "有效安装码过多，请稍后再试", 409);

        const secret = randomBytes(24).toString("base64url");
        const prefix = secret.slice(0, 8);
        const token = `wb_install_${prefix}_${secret}`;
        const createdAt = now();
        const expiresAt = new Date(createdAt.getTime() + TOKEN_TTL_MS);
        const row = (await client.query(
          "insert into installation_tokens(user_id,api_key_id,session_id,token_prefix,token_hash,expires_at,created_at) values($1,$2,$3,$4,$5,$6,$7) returning id",
          [userId, apiKeyId, sessionId, prefix, digest(pepper, token), expiresAt, createdAt]
        )).rows[0];
        await client.query("insert into audit_events(actor_user_id,action,target_type,target_id,created_at) values($1,'create_installation_token','installation_token',$2,$3)", [userId, String(row.id), createdAt]);
        return { token, expiresAt };
      });
    },

    exchange(rawToken) {
      return withTransaction(pool, async (client) => {
        const token = String(rawToken || "");
        const match = /^wb_install_([A-Za-z0-9_-]{8})_[A-Za-z0-9_-]+$/.exec(token);
        if (!match) fail("invalid_installation_token", "安装码无效", 401);
        const row = (await client.query(
          `select t.*,s.revoked_at as session_revoked_at,s.expires_at as session_expires_at,u.status as user_status
           from installation_tokens t
           join sessions s on s.id=t.session_id
           join users u on u.id=t.user_id
           where t.token_prefix=$1 and t.token_hash=$2
           for update`,
          [match[1], digest(pepper, token)]
        )).rows[0];
        if (!row) fail("invalid_installation_token", "安装码无效", 401);
        if (row.consumed_at) fail("installation_token_used", "安装码已经使用，请重新生成", 409);
        if (new Date(row.expires_at) <= now()) fail("installation_token_expired", "安装码已过期，请重新生成", 410);
        if (row.session_revoked_at || new Date(row.session_expires_at) <= now()) fail("invalid_session", "创建安装码的登录状态已失效", 401);
        if (row.user_status === "suspended") fail("account_suspended", "账户已停用", 403);
        const apiKey = await apiKeyService.resolveActiveForInstallation({ userId: row.user_id, keyId: row.api_key_id, client });
        const consumed = await client.query("update installation_tokens set consumed_at=$2 where id=$1 and consumed_at is null returning id", [row.id, now()]);
        if (!consumed.rowCount) fail("installation_token_used", "安装码已经使用，请重新生成", 409);
        await client.query("insert into audit_events(actor_user_id,action,target_type,target_id,created_at) values($1,'exchange_installation_token','installation_token',$2,$3)", [row.user_id, String(row.id), now()]);
        return { apiKey, apiKeyId: row.api_key_id, userId: row.user_id };
      });
    }
  };
}
