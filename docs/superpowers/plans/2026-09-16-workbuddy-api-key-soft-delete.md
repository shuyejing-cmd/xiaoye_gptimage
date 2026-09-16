# WorkBuddy API Key Soft Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to delete an API Key so it immediately stops working, disappears from their list, and no longer counts toward the three-active-key limit while historical relations remain valid.

**Architecture:** Add a nullable tombstone timestamp to `api_keys`, then perform key invalidation, encrypted-secret removal, and audit insertion in one PostgreSQL transaction. Keep the existing HTTP route but change its service operation and website wording from revoke to delete.

**Tech Stack:** Node.js 22, Fastify, PostgreSQL/pg, pg-mem, React/Vite, node:test

---

### Task 1: Add the soft-delete data contract

**Files:**
- Modify: `src/platform/db/migrations.mjs`
- Modify: `test/platform/migrations.test.mjs`

- [ ] **Step 1: Write the failing migration test**

Extend the expected migration version to 7 and require the new column:

```js
assert.equal(Number(version.rows[0].version), 7);
assert.equal(keyColumns.has("deleted_at"), true);
```

- [ ] **Step 2: Run the migration test and verify RED**

Run: `node --test test/platform/migrations.test.mjs`

Expected: FAIL because schema version 7 and `api_keys.deleted_at` do not exist.

- [ ] **Step 3: Add migration 7**

Append:

```js
{
  version: 7,
  statements: [
    "alter table api_keys add column if not exists deleted_at timestamptz"
  ]
}
```

- [ ] **Step 4: Run the migration test and verify GREEN**

Run: `node --test test/platform/migrations.test.mjs`

Expected: all migration tests pass.

- [ ] **Step 5: Commit the migration**

```bash
git add src/platform/db/migrations.mjs test/platform/migrations.test.mjs
git commit -m "feat: add API key deletion tombstone"
```

### Task 2: Implement transactional key deletion

**Files:**
- Modify: `src/platform/auth/api-key-service.mjs`
- Modify: `test/platform/api-keys.test.mjs`
- Modify: `test/platform/installation-token-service.test.mjs`

- [ ] **Step 1: Write failing service tests**

Add tests that create three keys, delete one, and assert:

```js
const deleted = await keys.delete({ userId, keyId: first.id });
assert.equal(deleted.deleted, true);
assert.equal((await keys.list(userId)).some((key) => key.id === first.id), false);
await assert.rejects(keys.authenticate(first.key), (error) => error.code === "invalid_api_key");
const stored = (await pool.query("select * from api_keys where id=$1", [first.id])).rows[0];
assert.equal(stored.encrypted_key, null);
assert.ok(stored.deleted_at);
await keys.create({ userId, name: "replacement" });
assert.equal((await keys.delete({ userId, keyId: first.id })).deleted, true);
```

Also assert that a one-time installation token issued before deletion fails exchange with `api_key_invalid`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test test/platform/api-keys.test.mjs test/platform/installation-token-service.test.mjs`

Expected: FAIL because `keys.delete` does not exist.

- [ ] **Step 3: Implement the minimal transactional behavior**

Change active counting and listing:

```js
select count(*)::int as count from api_keys
where user_id=$1 and status='active' and deleted_at is null

select * from api_keys
where user_id=$1 and deleted_at is null
order by created_at desc,id desc
```

Add `delete({ userId, keyId })` using `withTransaction`: lock the owned row, return `{ id, deleted: true }` when already deleted, otherwise set `status='revoked'`, `revoked_at`, `deleted_at`, and `encrypted_key=null`, then insert one `delete_api_key` audit event in the same transaction. Missing or foreign-owned rows throw `api_key_not_found` with HTTP 404.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test test/platform/api-keys.test.mjs test/platform/installation-token-service.test.mjs`

Expected: all focused tests pass.

- [ ] **Step 5: Commit the service behavior**

```bash
git add src/platform/auth/api-key-service.mjs test/platform/api-keys.test.mjs test/platform/installation-token-service.test.mjs
git commit -m "feat: soft-delete personal API keys"
```

### Task 3: Expose deletion through the API and website

**Files:**
- Modify: `src/platform/http/platform-app.mjs`
- Modify: `test/platform/platform-app.test.mjs`
- Modify: `web/src/App.jsx`

- [ ] **Step 1: Write the failing HTTP test**

Create a key through the authenticated route, delete it twice, and assert both responses are 200 with `{ deleted: true }`. Assert a second user receives 404, the deleted key is absent from `GET /api/api-keys`, and creating a replacement succeeds.

- [ ] **Step 2: Run the HTTP test and verify RED**

Run: `node --test test/platform/platform-app.test.mjs`

Expected: FAIL because the route still calls `revoke` and returns a revoked key object.

- [ ] **Step 3: Switch the route and UI to delete semantics**

Route:

```js
app.delete("/api/api-keys/:id", async (request) =>
  apiKeyService.delete({ userId: (await websiteUser(request)).id, keyId: request.params.id }));
```

Website:

```jsx
const deleteKey = async id => {
  if (!confirm("删除后此 Key 会立即失效，使用它的 WorkBuddy 将无法继续访问。继续吗？")) return;
  // DELETE request, then reload list
};
```

Change the button label from “撤销” to “删除”.

- [ ] **Step 4: Verify API tests and website build**

Run: `node --test test/platform/platform-app.test.mjs`

Expected: all platform HTTP tests pass.

Run: `npm run web:build`

Expected: Vite build exits 0.

- [ ] **Step 5: Commit the API and UI**

```bash
git add src/platform/http/platform-app.mjs test/platform/platform-app.test.mjs web/src/App.jsx web/dist
git commit -m "feat: let users delete API keys"
```

### Task 4: Full verification and local rollout

**Files:**
- Modify only if verification exposes a defect in the preceding tasks.

- [ ] **Step 1: Run the full automated suite**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Run production builds**

Run: `npm run web:build`

Expected: Vite build exits 0 with generated assets.

- [ ] **Step 3: Apply migration and restart local services**

Restart the API and worker with the existing local environment so startup applies migration 7. Verify `GET /healthz` and `GET /readyz` both return 200.

- [ ] **Step 4: Verify the original user flow**

Through authenticated API behavior, create three keys, delete one, confirm the old key fails authentication and disappears, then create a replacement without receiving `api_key_limit_reached`.

- [ ] **Step 5: Record completion**

Run `git status --short` and confirm there are no unintended changes. Update this plan's checkboxes, then commit the plan completion if its checkbox state changed.
