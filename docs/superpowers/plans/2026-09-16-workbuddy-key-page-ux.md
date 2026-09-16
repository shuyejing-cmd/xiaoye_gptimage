# WorkBuddy Key Page UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a newly created Key immediately display its installation prompt, separate the Key from the prompt, support prompt collapse/expand and regeneration, and remove full JSON configuration from the Key page.

**Architecture:** Keep the existing Key and installation-token HTTP APIs independent. Add a small browser-agnostic orchestration module that creates the Key first, immediately reports it to React, then requests the prompt while preserving the Key if prompt creation fails; React owns temporary prompt and expansion state only for the current page session.

**Tech Stack:** React 19, Vite 8, Node.js 22 `node:test`, existing Fastify APIs and design tokens

---

### Task 1: Define the create-then-prompt interaction contract

**Files:**
- Create: `web/src/key-page-flow.js`
- Create: `test/web/key-page-flow.test.mjs`

- [x] **Step 1: Write failing orchestration tests**

Test the desired call order and failure boundary:

```js
test("creates a key, exposes it immediately, then requests its prompt", async () => {
  const events = [];
  const request = async (path) => {
    events.push(path);
    if (path === "/api/api-keys") return { id: "7", key: "wb_live_public_secret", status: "active" };
    return { prompt: "install me", expires_at: "2026-09-16T12:10:00.000Z" };
  };
  const result = await createKeyWithPrompt({ request, name: "WorkBuddy Windows", onKeyCreated: (key) => events.push(`visible:${key.id}`) });
  assert.deepEqual(events, ["/api/api-keys", "visible:7", "/api/api-keys/7/installation-token"]);
  assert.equal(result.prompt.prompt, "install me");
});

test("keeps the created key when prompt generation fails", async () => {
  const request = async (path) => {
    if (path === "/api/api-keys") return { id: "8", key: "wb_live_public_secret", status: "active" };
    throw new Error("请求过于频繁，请稍后再试");
  };
  const result = await createKeyWithPrompt({ request, name: "WorkBuddy Windows", onKeyCreated: () => {} });
  assert.equal(result.key.id, "8");
  assert.equal(result.prompt, null);
  assert.equal(result.promptError, "请求过于频繁，请稍后再试");
});
```

Also test `isPromptExpired(expiresAt, now)` on both sides of the expiry timestamp.

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --test test/web/key-page-flow.test.mjs`

Expected: FAIL because `web/src/key-page-flow.js` does not exist.

- [x] **Step 3: Implement the minimal flow module**

Export:

```js
export async function createKeyWithPrompt({ request, name, onKeyCreated }) {
  const key = await request("/api/api-keys", { method: "POST", body: JSON.stringify({ name }) });
  onKeyCreated(key);
  try {
    const prompt = await request(`/api/api-keys/${key.id}/installation-token`, { method: "POST" });
    return { key, prompt, promptError: "" };
  } catch (error) {
    return { key, prompt: null, promptError: error.message };
  }
}

export function isPromptExpired(expiresAt, now = Date.now()) {
  return !expiresAt || new Date(expiresAt).getTime() <= now;
}
```

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `node --test test/web/key-page-flow.test.mjs`

Expected: all flow tests pass.

- [x] **Step 5: Commit the interaction contract**

```bash
git add web/src/key-page-flow.js test/web/key-page-flow.test.mjs
git commit -m "feat: orchestrate Key and prompt creation"
```

### Task 2: Rebuild the Key page state and content hierarchy

**Files:**
- Modify: `web/src/App.jsx`
- Modify: `test/web/mcp-config.test.mjs`
- Modify: `web/src/mcp-config.js`

- [x] **Step 1: Write the failing copy and expiry presentation test**

Replace the obsolete full-configuration assertion with prompt-oriented helpers:

```js
test("formats prompt expiry without exposing full MCP configuration", () => {
  assert.equal(typeof mcpConfig.buildWorkBuddyMcpConfig, "undefined");
  assert.equal(typeof mcpConfig.formatWorkBuddyMcpConfig, "undefined");
  const localExpiry = new Date(2026, 8, 16, 12, 10, 0);
  assert.match(mcpConfig.formatInstallExpiry(localExpiry, "zh-CN"), /12:10/);
});
```

- [x] **Step 2: Run the web unit tests and verify RED**

Run: `node --test test/web/mcp-config.test.mjs test/web/key-page-flow.test.mjs`

Expected: FAIL because the full-configuration exports still exist.

- [x] **Step 3: Remove configuration helpers and refactor `Keys`**

In `mcp-config.js`, keep only `installationPromptStatus` and `formatInstallExpiry`.

In `Keys`:

- replace `promptFallback` with `prompts`, keyed by Key ID;
- call `createKeyWithPrompt`, insert the Key immediately in `onKeyCreated`, and set its prompt state to `{ loading: true, expanded: true }`;
- on success store `{ prompt, expiresAt, expanded: true, loading: false, error: "" }`;
- on failure store the server message while preserving the Key;
- change `issuePrompt` to generate and display rather than auto-copy;
- add separate `copyPrompt`, `togglePrompt`, and immediate local removal after successful deletion;
- render independent “个人 Key” and “WorkBuddy 安装提示词” sections;
- use `aria-expanded` and `aria-controls` on the prompt toggle;
- remove JSON configuration, installer download, and their copy actions from the Key page;
- update page copy and the empty state to describe prompt-guided installation.

The prompt section must render these explicit states: not generated, loading, available/expanded, available/collapsed, expired, and failed/retryable.

- [x] **Step 4: Run web unit tests and build**

Run: `node --test test/web/mcp-config.test.mjs test/web/key-page-flow.test.mjs test/web/http-options.test.mjs`

Expected: all focused tests pass.

Run: `npm run web:build`

Expected: Vite build exits 0.

- [x] **Step 5: Commit the Key page behavior**

```bash
git add web/src/App.jsx web/src/mcp-config.js test/web/mcp-config.test.mjs
git commit -m "feat: show prompt-first Key workflow"
```

### Task 3: Apply the ledger-style visual hierarchy

**Files:**
- Modify: `web/src/styles.css`
- Modify: `web/src/App.jsx` only if visual verification exposes a semantic markup defect

- [x] **Step 1: Load the UI quality floor**

Read `C:/Users/Midiec/Documents/Codex/.agents/skills/impeccable/reference/craft-floor.md` and `C:/Users/Midiec/Documents/Codex/.agents/skills/impeccable/reference/layout.md` immediately before editing.

- [x] **Step 2: Implement the Key-page styles**

Create focused rules for:

```css
.key-entry { border-top: 1px solid var(--line); padding: 30px 0; }
.key-entry-head { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 24px; }
.key-secret-section, .prompt-section { border-top: 1px solid var(--line); margin-top: 22px; padding-top: 20px; }
.key-secret-row { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 12px; }
.prompt-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.prompt-body pre { max-height: 360px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
```

Use the existing square buttons, paper surfaces, mono labels, focus ring, rule lines, and mobile breakpoints. Do not introduce shadows, rounded cards, gradients, or new colors.

- [x] **Step 3: Run the Impeccable detector once**

Run:

```powershell
node C:/Users/Midiec/Documents/Codex/.agents/skills/impeccable/scripts/detect.mjs --json web/src/App.jsx web/src/styles.css
```

Expected: no blocking design-quality findings; resolve actionable findings in one batch.

- [x] **Step 4: Build after visual styling**

Run: `npm run web:build`

Expected: Vite build exits 0.

- [x] **Step 5: Commit the visual refinement**

```bash
git add web/src/App.jsx web/src/styles.css
git commit -m "style: clarify Key and prompt hierarchy"
```

### Task 4: Browser verification and local rollout

**Files:**
- Modify only if the bounded browser pass exposes a defect.

- [x] **Step 1: Run the full automated suite**

Run: `npm test`

Expected: zero failures; the existing unavailable-symlink skip may remain.

- [x] **Step 2: Restart the API after the final web build**

Restart only the local API process with the existing local environment so Fastify registers the final hashed assets. Keep PostgreSQL and worker running.

- [x] **Step 3: Verify desktop and mobile in one bounded browser pass**

Use a temporary local test session with three states represented across Key rows: a newly generated expanded prompt, an existing Key without a prompt, and a prompt error/retry state. Inspect at desktop 1440×900 and mobile 390×844 in the same pass. Confirm no page overflow, Key text remains selectable, prompt collapse/expand is keyboard accessible, and removed configuration content is absent.

- [x] **Step 4: Fix all observed defects in one batch and confirm once**

If the first pass finds defects, make one consolidated correction, rebuild, restart API, and run one final desktop/mobile confirmation. Do not continue open-ended polishing.

- [x] **Step 5: Verify live service health and repository state**

Confirm `/healthz`, `/readyz`, and the final hashed JavaScript asset all return 200 with the asset served as `application/javascript`. Run `git status --short` and ensure only intentional changes remain, then mark this plan complete and commit its checkbox update.

