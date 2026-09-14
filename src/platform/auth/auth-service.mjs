import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { AppError } from "../../shared/errors.mjs";
import { withTransaction } from "../db/pool.mjs";

const LOGIN_CODE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError({ code: "invalid_email", message: "请输入有效邮箱", httpStatus: 400 });
  return email;
}

function digest(pepper, kind, value) {
  return createHmac("sha256", pepper).update(`${kind}:${value}`).digest("hex");
}

function equalDigest(left, right) {
  const a = Buffer.from(left || "");
  const b = Buffer.from(right || "");
  return a.length === b.length && timingSafeEqual(a, b);
}

function walletResult(row) {
  return { availableCredits: Number(row.available_credits), heldCredits: Number(row.held_credits) };
}

export function createAuthService({ pool, pepper, mailer, now = () => new Date(), randomCode = () => String(Math.floor(100000 + Math.random() * 900000)), randomToken = () => randomUUID() }) {
  if (!pepper) throw new Error("auth pepper is required");
  return {
    async requestCode({ email: rawEmail, ip, deviceId }) {
      const email = normalizeEmail(rawEmail);
      const code = randomCode();
      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + LOGIN_CODE_TTL_MS);
      await pool.query(
        "insert into email_login_codes(email, code_hash, request_ip, device_id, expires_at, created_at) values($1,$2,$3,$4,$5,$6)",
        [email, digest(pepper, "login-code", `${email}:${code}`), ip || null, deviceId || null, expiresAt, createdAt]
      );
      await mailer.sendLoginCode({ email, code, expiresAt });
      return { accepted: true };
    },

    async verifyCode({ email: rawEmail, code, ip, deviceId }) {
      const email = normalizeEmail(rawEmail);
      return withTransaction(pool, async (client) => {
        const found = await client.query(
          "select * from email_login_codes where email = $1 and consumed_at is null order by created_at desc, id desc limit 1",
          [email]
        );
        const login = found.rows[0];
        if (!login || new Date(login.expires_at) <= now()) throw new AppError({ code: "login_code_expired", message: "验证码已过期，请重新获取", httpStatus: 400 });
        if (Number(login.attempts) >= 5) throw new AppError({ code: "login_code_locked", message: "验证码尝试次数过多，请重新获取", httpStatus: 429 });
        const expected = digest(pepper, "login-code", `${email}:${code}`);
        if (!equalDigest(login.code_hash, expected)) {
          await client.query("update email_login_codes set attempts = attempts + 1 where id = $1", [login.id]);
          throw new AppError({ code: "invalid_login_code", message: "验证码不正确", httpStatus: 400 });
        }
        const consumed = await client.query("update email_login_codes set consumed_at = $2 where id = $1 and consumed_at is null returning id", [login.id, now()]);
        if (!consumed.rowCount) throw new AppError({ code: "login_code_used", message: "验证码已使用", httpStatus: 409 });

        let user = (await client.query("select * from users where email = $1", [email])).rows[0];
        if (!user) {
          const reusedDevice = deviceId ? (await client.query("select count(*)::int as count from users where bonus_device_id = $1", [deviceId])).rows[0].count > 0 : false;
          const ipCutoff = new Date(now().getTime() - 24 * 60 * 60 * 1000);
          const ipCount = ip ? Number((await client.query("select count(*)::int as count from users where signup_ip = $1 and created_at >= $2", [ip, ipCutoff])).rows[0].count) : 0;
          const eligible = !reusedDevice && ipCount < 3;
          user = (await client.query(
            "insert into users(email,status,role,signup_ip,bonus_device_id,created_at,updated_at) values($1,$2,'user',$3,$4,$5,$5) returning *",
            [email, eligible ? "active" : "pending_review", ip || null, deviceId || null, now()]
          )).rows[0];
          await client.query("insert into wallets(user_id,available_credits,held_credits) values($1,$2,0)", [user.id, eligible ? 5 : 0]);
          if (eligible) await client.query(
            "insert into ledger_entries(user_id,event_type,amount,reference_type,reference_id) values($1,'signup_bonus',5,'user',$2)",
            [user.id, String(user.id)]
          );
        }

        const sessionToken = randomToken();
        const sessionId = randomUUID();
        await client.query(
          "insert into sessions(id,user_id,token_hash,expires_at,created_at) values($1,$2,$3,$4,$5)",
          [sessionId, user.id, digest(pepper, "session", sessionToken), new Date(now().getTime() + SESSION_TTL_MS), now()]
        );
        const wallet = (await client.query("select * from wallets where user_id = $1", [user.id])).rows[0];
        return { user: { id: user.id, email: user.email, status: user.status, role: user.role }, wallet: walletResult(wallet), sessionToken };
      });
    },

    async authenticateSession(sessionToken) {
      const tokenHash = digest(pepper, "session", String(sessionToken || ""));
      const result = await pool.query("select s.id,u.id as user_id,u.email,u.status,u.role from sessions s join users u on u.id=s.user_id where s.token_hash=$1 and s.revoked_at is null and s.expires_at>$2", [tokenHash, now()]);
      const row = result.rows[0];
      if (!row || row.status === "suspended") throw new AppError({ code: "invalid_session", message: "登录状态已失效，请重新登录", httpStatus: 401 });
      return { sessionId: row.id, user: { id: row.user_id, email: row.email, status: row.status, role: row.role } };
    },

    async logout(sessionToken) {
      await pool.query("update sessions set revoked_at=$2 where token_hash=$1 and revoked_at is null", [digest(pepper, "session", String(sessionToken || "")), now()]);
      return { loggedOut: true };
    }
  };
}

export { normalizeEmail };
