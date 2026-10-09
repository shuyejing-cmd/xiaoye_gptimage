import pg from "pg";

const database = process.env.POINTS_REHEARSAL_DATABASE;
if (!/^workbuddy_points_rehearsal_[0-9]{8}$/.test(database || "")) throw new Error("POINTS_REHEARSAL_DATABASE must name a dedicated rehearsal database");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const moduleUrl = process.env.POINTS_MIGRATION_MODULE || new URL("../src/platform/db/migrations.mjs", import.meta.url).href;
const { runMigrations } = await import(moduleUrl);
const url = new URL(process.env.DATABASE_URL);
if (url.pathname === `/${database}`) throw new Error("DATABASE_URL must point to the source database, not the rehearsal database");
url.pathname = `/${database}`;
const pool = new pg.Pool({ connectionString: url.toString() });

try {
  const beforeVersion = Number((await pool.query("select max(version) as version from schema_migrations")).rows[0].version);
  if (beforeVersion !== 7) throw new Error(`expected migration 7 snapshot, got ${beforeVersion}`);
  const before = (await pool.query("select user_id,available_credits,held_credits from wallets order by user_id")).rows;
  const active = Number((await pool.query("select count(*)::int as count from generation_jobs where state in ('queued','submitting','provider_pending','output_persisting','unknown','manual_review')")).rows[0].count);
  if (active) throw new Error(`active_generation_jobs: ${active}`);
  await runMigrations(pool);
  await runMigrations(pool);
  const after = (await pool.query("select user_id,available_points,held_points from wallets order by user_id")).rows;
  if (before.length !== after.length || before.some((wallet, index) => String(wallet.user_id) !== String(after[index].user_id) || Number(wallet.available_credits) * 5 !== Number(after[index].available_points) || Number(wallet.held_credits) * 5 !== Number(after[index].held_points))) throw new Error("wallet conversion mismatch");
  const version = Number((await pool.query("select max(version) as version from schema_migrations")).rows[0].version);
  if (version !== 8) throw new Error(`expected migration 8, got ${version}`);
  process.stdout.write(JSON.stringify({ status: "rehearsal_ok", migrated_wallets: after.length, schema_version: version }) + "\n");
} finally {
  await pool.end();
}
