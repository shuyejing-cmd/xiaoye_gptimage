import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { runMigrations } from "../../src/platform/db/migrations.mjs";
import { createRateLimiter } from "../../src/platform/http/rate-limiter.mjs";

test("PostgreSQL rate limiter rejects only requests beyond the configured window quota", async () => {
  const memory = newDb({ noAstCoverageCheck: true });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  await runMigrations(pool);
  let now = new Date("2026-09-13T12:00:00Z");
  const limiter = createRateLimiter({ pool, now: () => now });
  await limiter.consume({ scope: "generation", subject: "user-1", limit: 2, windowMs: 60_000 });
  await limiter.consume({ scope: "generation", subject: "user-1", limit: 2, windowMs: 60_000 });
  await assert.rejects(limiter.consume({ scope: "generation", subject: "user-1", limit: 2, windowMs: 60_000 }), (error) => error.code === "rate_limit_exceeded");
  now = new Date("2026-09-13T12:01:00Z");
  await limiter.consume({ scope: "generation", subject: "user-1", limit: 2, windowMs: 60_000 });
  const removed = await limiter.cleanup({ olderThan: new Date("2026-09-14T00:00:00Z") });
  assert.equal(removed, 2);
  assert.equal(Number((await pool.query("select count(*)::int as count from rate_limit_windows")).rows[0].count), 0);
  await pool.end();
});
