import { createHmac, randomBytes as cryptoRandomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "../../shared/errors.mjs";
import { withTransaction } from "../db/pool.mjs";

function hashKey(pepper, value) {
  return createHmac("sha256", pepper).update(`api-key:${value}`).digest("hex");
}

function safeEqual(left, right) {
  const a = Buffer.from(left || "");
  const b = Buffer.from(right || "");
  return a.length === b.length && timingSafeEqual(a, b);
}

function revealedKey(row, cipher) {
  if (row.status !== "active" || !row.encrypted_key) return null;
  try {
    const value = cipher.decrypt(row.encrypted_key)?.key;
    return typeof value === "string" && value ? value : null;
  } catch {
    return null;
  }
}

function publicKey(row, cipher) {
  const key = revealedKey(row, cipher);
  return { id: row.id, name: row.name, prefix: row.key_prefix, status: row.status, lastUsedAt: row.last_used_at, createdAt: row.created_at, key, recoverable: Boolean(key) };
}

export function createApiKeyService({ pool, pepper, cipher, randomBytes = cryptoRandomBytes, now = () => new Date() }) {
  if (!pepper) throw new Error("API key pepper is required");
  if (!cipher?.encrypt || !cipher?.decrypt) throw new Error("API key cipher is required");
  return {
    create({ userId, name }) {
      return withTransaction(pool, async (client) => {
        await client.query("select id from users where id=$1 for update", [userId]);
        const active = await client.query("select count(*)::int as count from api_keys where user_id=$1 and status='active'", [userId]);
        if (Number(active.rows[0].count) >= 3) throw new AppError({ code: "api_key_limit_reached", message: "最多只能保留三个有效密钥", httpStatus: 409 });
        const secret = randomBytes(24).toString("base64url");
        const prefix = secret.slice(0, 8);
        const key = `wb_live_${prefix}_${secret}`;
        const row = (await client.query(
          "insert into api_keys(user_id,name,key_prefix,key_hash,encrypted_key,status,created_at) values($1,$2,$3,$4,$5,'active',$6) returning *",
          [userId, String(name || "WorkBuddy").trim().slice(0, 80) || "WorkBuddy", prefix, hashKey(pepper, key), cipher.encrypt({ key }), now()]
        )).rows[0];
        return publicKey(row, cipher);
      });
    },

    async list(userId) {
      const rows = await pool.query("select * from api_keys where user_id=$1 order by created_at desc,id desc", [userId]);
      return rows.rows.map((row) => publicKey(row, cipher));
    },

    async revoke({ userId, keyId }) {
      const result = await pool.query("update api_keys set status='revoked',revoked_at=$3 where id=$1 and user_id=$2 and status='active' returning *", [keyId, userId, now()]);
      if (!result.rowCount) throw new AppError({ code: "api_key_not_found", message: "密钥不存在或已撤销", httpStatus: 404 });
      return publicKey(result.rows[0], cipher);
    },

    async authenticate(rawKey) {
      const match = /^wb_live_([A-Za-z0-9_-]{8})_([A-Za-z0-9_-]+)$/.exec(String(rawKey || ""));
      const result = match
        ? await pool.query("select k.*,u.role,u.status as user_status from api_keys k join users u on u.id=k.user_id where k.key_prefix=$1 and k.status='active'", [match[1]])
        : await pool.query("select k.*,u.role,u.status as user_status from api_keys k join users u on u.id=k.user_id where k.key_hash=$1 and k.status='active'", [hashKey(pepper, rawKey)]);
      const row = result.rows.find((candidate) => safeEqual(candidate.key_hash, hashKey(pepper, rawKey)));
      if (!row || row.user_status === "suspended") throw new AppError({ code: "invalid_api_key", message: "个人密钥无效或账户已停用", httpStatus: 401 });
      await pool.query("update api_keys set last_used_at=$2 where id=$1", [row.id, now()]);
      return { keyId: row.id, userId: row.user_id, role: row.role, status: row.user_status };
    },

    async importLegacy({ userId, rawKey, name = "Legacy WorkBuddy" }) {
      const prefix = hashKey(pepper, rawKey).slice(0, 8);
      const existing = await pool.query("select * from api_keys where key_hash=$1", [hashKey(pepper, rawKey)]);
      if (existing.rowCount) {
        let row = existing.rows[0];
        if (row.status === "active" && !row.encrypted_key) row = (await pool.query("update api_keys set encrypted_key=$2 where id=$1 returning *", [row.id, cipher.encrypt({ key: rawKey })])).rows[0];
        return publicKey(row, cipher);
      }
      const row = (await pool.query("insert into api_keys(user_id,name,key_prefix,key_hash,encrypted_key,status,created_at) values($1,$2,$3,$4,$5,'active',$6) returning *", [userId, name, prefix, hashKey(pepper, rawKey), cipher.encrypt({ key: rawKey }), now()])).rows[0];
      return publicKey(row, cipher);
    }
  };
}
