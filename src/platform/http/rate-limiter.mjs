import { AppError } from "../../shared/errors.mjs";

export function createRateLimiter({ pool, now = () => new Date() }) {
  return {
    async consume({ scope, subject, limit, windowMs, queryable = pool }) {
      const timestamp = now().getTime();
      const windowStart = new Date(Math.floor(timestamp / windowMs) * windowMs);
      const result = await queryable.query(
        `insert into rate_limit_windows(scope,subject,window_start,count) values($1,$2,$3,1)
         on conflict(scope,subject,window_start) do update set count=rate_limit_windows.count+1
         returning count`,
        [scope, String(subject), windowStart]
      );
      const count = Number(result.rows[0].count);
      if (count > limit) throw new AppError({ code: "rate_limit_exceeded", message: "请求过于频繁，请稍后再试", httpStatus: 429, retryable: true });
      return { count, remaining: Math.max(0, limit - count), resetAt: new Date(windowStart.getTime() + windowMs) };
    },

    async cleanup({ olderThan }) {
      const result = await pool.query("delete from rate_limit_windows where window_start<$1 returning scope", [olderThan]);
      return result.rowCount;
    }
  };
}
