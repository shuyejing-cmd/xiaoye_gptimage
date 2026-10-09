import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { migrations, runMigrations } from "../../src/platform/db/migrations.mjs";

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

  for (const name of ["users", "sessions", "api_keys", "installation_tokens", "wallets", "ledger_entries", "credit_holds", "generation_jobs", "payment_channels", "recharge_packages", "recharge_orders", "audit_events"]) {
    assert.equal(names.has(name), true, `missing table ${name}`);
  }
  assert.equal(Number((await pool.query("select count(*)::int as count from schema_migrations")).rows[0].count), 8);
  const keyColumns = new Set((await pool.query("select column_name from information_schema.columns where table_name='api_keys'")).rows.map((row) => row.column_name));
  assert.equal(keyColumns.has("encrypted_key"), true);
  assert.equal(keyColumns.has("deleted_at"), true);
  const tokenColumns = new Set((await pool.query("select column_name from information_schema.columns where table_name='installation_tokens'")).rows.map((row) => row.column_name));
  for (const name of ["user_id", "api_key_id", "session_id", "token_prefix", "token_hash", "expires_at", "consumed_at"]) assert.equal(tokenColumns.has(name), true, `missing installation_tokens.${name}`);
  await pool.end();
});

test("legacy balances, holds and order snapshots convert exactly once", async () => {
  const pool = await createPool();
  await pool.query("create table schema_migrations (version integer primary key)");
  for (const migration of migrations.filter((item) => item.version < 8)) {
    for (const statement of migration.statements) await pool.query(statement);
    await pool.query("insert into schema_migrations(version) values($1)", [migration.version]);
  }
  const user = (await pool.query("insert into users(email,status,role) values('old@example.com','active','user') returning id")).rows[0];
  await pool.query("insert into wallets(user_id,available_credits,held_credits) values($1,3,1)", [user.id]);
  await pool.query("insert into recharge_packages(name,price_fen,credits) values('old',100,2)");
  await pool.query("insert into recharge_orders(order_no,user_id,provider,package_name,price_fen,credits,state,expires_at) values('old-order',$1,'manual_qr','old',100,2,'approved',now())", [user.id]);
  const job = (await pool.query("insert into generation_jobs(request_id,user_id,idempotency_key,state,provider) values('old-job',$1,'old-key','unknown','gpt_ge') returning id", [user.id])).rows[0];
  await pool.query("insert into credit_holds(user_id,generation_id,amount,state) values($1,$2,1,'held')", [user.id, job.id]);
  await pool.query("insert into ledger_entries(user_id,event_type,amount,reference_type,reference_id) values($1,'hold',-1,'generation',$2)", [user.id, String(job.id)]);
  await assert.rejects(runMigrations(pool), /active_generation_jobs/);
  // pg-mem does not roll back DDL; real PostgreSQL rolls this column back with the transaction.
  await pool.query("alter table generation_jobs drop column points_cost");
  await pool.query("update generation_jobs set state='failed' where id=$1", [job.id]);
  await runMigrations(pool);
  await runMigrations(pool);
  assert.deepEqual((await pool.query("select available_points,held_points from wallets where user_id=$1", [user.id])).rows[0], { available_points: 15, held_points: 5 });
  assert.equal((await pool.query("select points from recharge_orders where order_no='old-order'")).rows[0].points, 10);
  assert.equal((await pool.query("select points from recharge_packages where name='old'")).rows[0].points, 10);
  assert.equal((await pool.query("select points_amount from credit_holds where generation_id=$1", [job.id])).rows[0].points_amount, 5);
  assert.equal((await pool.query("select amount from ledger_entries where reference_id=$1", [String(job.id)])).rows[0].amount, -5);
  await pool.end();
});

test("commercial schema enforces wallet, idempotency, and ledger invariants", async () => {
  const pool = await createPool();
  await runMigrations(pool);
  const user = await pool.query("insert into users(email, status, role) values($1, 'active', 'user') returning id", ["member@example.com"]);
  const userId = user.rows[0].id;
  await pool.query("insert into wallets(user_id, available_points, held_points) values($1, 5, 0)", [userId]);

  await assert.rejects(
    pool.query("update wallets set available_points = -1 where user_id = $1", [userId]),
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
