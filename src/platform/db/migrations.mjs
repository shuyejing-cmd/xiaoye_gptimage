const migrations = [
  {
    version: 1,
    statements: [
      `create table if not exists users (
        id bigserial primary key,
        email text not null unique,
        status text not null check (status in ('active','suspended','pending_review')),
        role text not null check (role in ('user','admin')),
        signup_ip text,
        bonus_device_id text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      `create table if not exists wallets (
        user_id bigint primary key references users(id),
        available_credits integer not null default 0,
        held_credits integer not null default 0,
        version integer not null default 0,
        updated_at timestamptz not null default now(),
        constraint wallet_available_nonnegative check (available_credits >= 0),
        constraint wallet_held_nonnegative check (held_credits >= 0)
      )`,
      `create table if not exists email_login_codes (
        id bigserial primary key,
        email text not null,
        code_hash text not null,
        request_ip text,
        device_id text,
        attempts integer not null default 0 check (attempts >= 0 and attempts <= 5),
        expires_at timestamptz not null,
        consumed_at timestamptz,
        created_at timestamptz not null default now()
      )`,
      `create table if not exists sessions (
        id text primary key,
        user_id bigint not null references users(id),
        token_hash text not null unique,
        expires_at timestamptz not null,
        created_at timestamptz not null default now(),
        revoked_at timestamptz
      )`,
      `create table if not exists api_keys (
        id bigserial primary key,
        user_id bigint not null references users(id),
        name text not null,
        key_prefix text not null unique,
        key_hash text not null unique,
        status text not null default 'active' check (status in ('active','revoked')),
        last_used_at timestamptz,
        created_at timestamptz not null default now(),
        revoked_at timestamptz
      )`,
      `create table if not exists recharge_packages (
        id bigserial primary key,
        name text not null,
        price_fen integer not null check (price_fen > 0),
        credits integer not null check (credits > 0),
        active boolean not null default true,
        sort_order integer not null default 0,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      `create table if not exists recharge_orders (
        id bigserial primary key,
        order_no text not null unique,
        user_id bigint not null references users(id),
        package_id bigint references recharge_packages(id),
        provider text not null default 'manual_qr',
        package_name text not null,
        price_fen integer not null check (price_fen > 0),
        credits integer not null check (credits > 0),
        state text not null check (state in ('created','proof_submitted','approved','rejected','expired')),
        note text,
        reviewed_by bigint references users(id),
        reviewed_at timestamptz,
        review_reason text,
        created_at timestamptz not null default now(),
        expires_at timestamptz not null,
        updated_at timestamptz not null default now()
      )`,
      `create table if not exists payment_proofs (
        id bigserial primary key,
        order_id bigint not null unique references recharge_orders(id),
        object_key text not null,
        sha256 text not null,
        mime_type text not null,
        created_at timestamptz not null default now(),
        delete_after timestamptz not null
      )`,
      `create table if not exists generation_jobs (
        id bigserial primary key,
        request_id text not null unique,
        user_id bigint not null references users(id),
        idempotency_key text not null,
        state text not null check (state in ('queued','submitting','provider_pending','output_persisting','succeeded','failed','unknown','manual_review')),
        provider text not null,
        encrypted_payload text,
        upstream_task_id text,
        output_object_key text,
        output_mime_type text,
        error_code text,
        available_at timestamptz not null default now(),
        claimed_at timestamptz,
        unknown_since timestamptz,
        completed_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique(user_id, idempotency_key)
      )`,
      `create table if not exists credit_holds (
        id bigserial primary key,
        user_id bigint not null references users(id),
        generation_id bigint not null unique references generation_jobs(id),
        amount integer not null check (amount > 0),
        state text not null check (state in ('held','captured','released')),
        created_at timestamptz not null default now(),
        settled_at timestamptz
      )`,
      `create table if not exists ledger_entries (
        id bigserial primary key,
        user_id bigint not null references users(id),
        event_type text not null check (event_type in ('signup_bonus','first_recharge_bonus','recharge','hold','capture','release','admin_adjustment')),
        amount integer not null check (amount <> 0),
        reference_type text not null,
        reference_id text not null,
        metadata text,
        created_at timestamptz not null default now(),
        unique(reference_type, reference_id, event_type)
      )`,
      `create table if not exists audit_events (
        id bigserial primary key,
        actor_user_id bigint references users(id),
        action text not null,
        target_type text not null,
        target_id text not null,
        reason text,
        created_at timestamptz not null default now()
      )`,
      `create table if not exists rate_limit_windows (
        scope text not null,
        subject text not null,
        window_start timestamptz not null,
        count integer not null default 0 check (count >= 0),
        primary key(scope, subject, window_start)
      )`
    ]
  },
  {
    version: 2,
    statements: [
      `create table if not exists payment_channels (
        id bigserial primary key,
        provider text not null,
        name text not null,
        qr_object_key text not null,
        instructions text,
        active boolean not null default true,
        sort_order integer not null default 0,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`
    ]
  },
  {
    version: 3,
    statements: [
      "create index if not exists generation_jobs_reconciliation_idx on generation_jobs(state, updated_at, id)",
      "create index if not exists generation_jobs_user_history_idx on generation_jobs(user_id, created_at desc, id desc)",
      "create index if not exists ledger_entries_user_history_idx on ledger_entries(user_id, created_at desc, id desc)",
      "create index if not exists recharge_orders_user_history_idx on recharge_orders(user_id, created_at desc, id desc)",
      "create index if not exists recharge_orders_review_idx on recharge_orders(state, created_at, id)",
      "create index if not exists email_login_codes_lookup_idx on email_login_codes(email, created_at desc, id desc)",
      "create index if not exists audit_events_target_idx on audit_events(target_type, target_id, created_at desc)"
    ]
  },
  {
    version: 4,
    statements: [
      "create index if not exists generation_jobs_upstream_task_idx on generation_jobs(provider,upstream_task_id) where upstream_task_id is not null",
      "create index if not exists sessions_user_active_idx on sessions(user_id,expires_at) where revoked_at is null",
      "create index if not exists payment_proofs_delete_after_idx on payment_proofs(delete_after)",
      "create index if not exists rate_limit_windows_start_idx on rate_limit_windows(window_start)"
    ]
  },
  {
    version: 5,
    statements: [
      "alter table api_keys add column if not exists encrypted_key text"
    ]
  }
];

export async function runMigrations(pool) {
  await pool.query("create table if not exists schema_migrations (version integer primary key, applied_at timestamptz not null default now())");
  for (const migration of migrations) {
    const applied = await pool.query("select version from schema_migrations where version = $1", [migration.version]);
    if (applied.rowCount) continue;
    const client = await pool.connect();
    try {
      await client.query("begin");
      for (const statement of migration.statements) await client.query(statement);
      await client.query("insert into schema_migrations(version) values($1)", [migration.version]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

export { migrations };
