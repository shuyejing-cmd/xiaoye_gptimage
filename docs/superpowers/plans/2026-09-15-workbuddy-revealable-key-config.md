# WorkBuddy Revealable Key Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Let an authenticated user repeatedly view an active personal Key and copy a complete WorkBuddy MCP JSON configuration without storing plaintext Key material.

**Architecture:** Add a nullable AES-256-GCM ciphertext column alongside the existing HMAC digest. The API-key service decrypts only owner-visible active keys, while gateway authentication continues to use the digest. A pure frontend formatter builds the install-layout JSON, and the local bridge expands `%USERPROFILE%` before enforcing allowed image roots.

**Tech Stack:** Node.js 22, PostgreSQL, AES-256-GCM, Fastify, React/Vite, Node test runner.

---

### Task 1: Encrypted Key Persistence

**Files:**
- Modify: `src/platform/db/migrations.mjs`
- Modify: `src/platform/config.mjs`
- Modify: `src/platform/runtime.mjs`
- Modify: `src/platform/auth/api-key-service.mjs`
- Test: `test/platform/migrations.test.mjs`
- Test: `test/platform/api-keys.test.mjs`

- [x] Add a failing migration test expecting version 5 and `api_keys.encrypted_key`.
- [x] Add failing service tests proving a new Key is encrypted, recoverable after recreating the service, owner-scoped, hidden after revoke, and rejected after ciphertext tampering.
- [x] Add migration 5: `alter table api_keys add column if not exists encrypted_key text`.
- [x] Require and parse `API_KEY_ENCRYPTION_KEY` independently from `PAYLOAD_ENCRYPTION_KEY`.
- [x] Inject `createPayloadCipher({ key: config.apiKeyEncryptionKey })` into `createApiKeyService`.
- [x] Encrypt `{ key }` on create, decrypt only active owner rows on list, and backfill encrypted legacy keys when the raw legacy token is available.
- [x] Run the focused tests and confirm they pass.

### Task 2: Safe Key API Responses

**Files:**
- Modify: `src/platform/http/platform-app.mjs`
- Test: `test/platform/platform-app.test.mjs`

- [x] Add a failing API test proving a newly created Key remains visible on a later list request while another user cannot fetch it.
- [x] Return decrypted values only from the authenticated owner's list and add `Cache-Control: no-store`.
- [x] Verify create, list, revoke, and cross-user tests pass.

### Task 3: Portable WorkBuddy Configuration

**Files:**
- Create: `src/bridge/environment-paths.mjs`
- Modify: `src/index.mjs`
- Create: `web/src/mcp-config.js`
- Test: `test/bridge/environment-paths.test.mjs`
- Test: `test/web/mcp-config.test.mjs`

- [x] Add failing tests for `%USERPROFILE%` expansion and the exact JSON object.
- [x] Implement environment-token expansion before allowed-root parsing.
- [x] Implement `buildWorkBuddyMcpConfig(apiKey)` with the default signed-installer paths and `https://xiaoyeai.cn`.
- [x] Verify both pure-function test files pass.

### Task 4: Key Page UI

**Files:**
- Modify: `web/src/App.jsx`
- Modify: `web/src/styles.css`
- Modify: `web/src/mobile.css`

- [x] Replace the one-time reveal state with owner-visible active-key rows.
- [x] Display the full active Key, formatted configuration JSON, “复制 Key”, and “复制完整配置” actions.
- [x] Show nonrecoverable and revoked states without fabricated secrets.
- [x] Provide copy success/failure text through an `aria-live` status.
- [x] Run the Impeccable detector once, build the frontend, and inspect desktop/mobile rendering in one bounded pass.

### Task 5: Configuration and End-to-End Verification

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [x] Document `API_KEY_ENCRYPTION_KEY` and the generated configuration behavior.
- [x] Add a local key-encryption secret without printing it.
- [x] Restart API and worker, run migrations, create a Key, reload the list, copy/parse the JSON, and authenticate with the recovered Key.
- [x] Run focused tests, production build, syntax checks, `git diff --check`, and the available full regression suite.
- [x] Commit the verified change without adding `.env` or runtime data.

