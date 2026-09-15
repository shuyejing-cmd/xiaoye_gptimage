import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { runMigrations } from "../../src/platform/db/migrations.mjs";

async function createPool() {
  const memory = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
  const { Pool } = memory.adapters.createPg();
  return new Pool();
}

test("commercial schema migrations are repeatable and create the required tables", async () => {
  const pool = await createPool();
  await runMigrations(pool);
  await runMigrations(pool);

  const result = await pool.query("select table_name from information_schema.tables where table_schema = 'public'");
  const names = new Set(result.rows.map((row) => row.table_name));

  for (const name of ["users", "sessions", "api_keys", "wallets", "ledger_entries", "credit_holds", "generation_jobs", "payment_channels", "recharge_packages", "recharge_orders", "audit_events"]) {
    assert.equal(names.has(name), true, `missing table ${name}`);
  }
  assert.equal(Number((await pool.query("select count(*)::int as count from schema_migrations")).rows[0].count), 5);
  const keyColumns = await pool.query("select column_name from information_schema.columns where table_name='api_keys'");
  assert.equal(keyColumns.rows.some((row) => row.column_name === "encrypted_key"), true);
  await pool.end();
});

test("commercial schema enforces wallet, idempotency, and ledger invariants", async () => {
  const pool = await createPool();
  await runMigrations(pool);
  const user = await pool.query("insert into users(email, status, role) values($1, 'active', 'user') returning id", ["member@example.com"]);
  const userId = user.rows[0].id;
  await pool.query("insert into wallets(user_id, available_credits, held_credits) values($1, 5, 0)", [userId]);

  await assert.rejects(
    pool.query("update wallets set available_credits = -1 where user_id = $1", [userId]),
    /wallet_available_nonnegative/
  );

  const job = await pool.query("insert into generation_jobs(request_id, user_id, idempotency_key, state, provider, encrypted_payload) values($1, $2, $3, 'queued', 'gpt_ge', $4) returning id", ["req-1", userId, "same-key", "ciphertext"]);
  await assert.rejects(
    pool.query("insert into generation_jobs(request_id, user_id, idempotency_key, state, provider, encrypted_payload) values($1, $2, $3, 'queued', 'gpt_ge', $4)", ["req-2", userId, "same-key", "ciphertext"]),
    /unique/i
  );

  await pool.query("insert into ledger_entries(user_id, event_type, amount, reference_type, reference_id) values($1, 'hold', -1, 'generation', $2)", [userId, job.rows[0].id]);
  await assert.rejects(
    pool.query("insert into ledger_entries(user_id, event_type, amount, reference_type, reference_id) values($1, 'hold', -1, 'generation', $2)", [userId, job.rows[0].id]),
    /unique/i
  );
  await pool.end();
});
