# WorkBuddy 自然绿液态玻璃前端改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将登录页和用户端改造成自然草地、个人角色与液态玻璃组成的统一界面，并把 Key 页面改成紧凑的双栏工作台，同时保持所有后端与业务流程不变。

**Architecture:** 保留现有 React 单页应用和 API 调用逻辑，在 `App.jsx` 中调整用户端语义结构，并新增一个最后加载、仅作用于登录页和 `.user-surface` 的主题样式文件，避免管理后台被一起重构。Key 选择逻辑放进现有纯函数模块并用 Node 测试覆盖；视觉改动通过 Vite 构建、机械设计检查和桌面/手机截图验收。

**Tech Stack:** React 19、Vite 8、CSS、Node.js 22 测试运行器、Impeccable 检测脚本、现有 Fastify API。

---

## 文件结构

- Create: `web/src/assets/meadow-background.png` — 登录页与用户端的草地背景素材。
- Create: `web/src/assets/profile-avatar.png` — 登录页主角色和侧栏头像素材。
- Create: `web/src/green-glass.css` — 只覆盖登录页和用户端的自然绿玻璃视觉、Key 双栏与响应式规则。
- Modify: `web/src/main.jsx` — 最后加载新主题样式。
- Modify: `web/src/App.jsx` — 登录页、用户端壳、Key 工作台和其他用户页的语义结构；管理后台业务结构不变。
- Modify: `web/src/key-page-flow.js` — 增加当前 Key 选择的纯函数。
- Modify: `test/web/key-page-flow.test.mjs` — 覆盖创建、删除和列表变化后的选择规则。
- Verify only: `web/src/styles.css`, `web/src/mobile.css`, `web/src/enhancements.css` — 作为旧管理后台和基础可访问性的后备样式，不在本次整体重写。
- Modify if detector requires: `DESIGN.md` — 只修正实现与已批准设计系统之间的实际偏差。

## Task 1: 接入稳定视觉素材与主题入口

**Files:**
- Create: `web/src/assets/meadow-background.png`
- Create: `web/src/assets/profile-avatar.png`
- Create: `web/src/green-glass.css`
- Modify: `web/src/main.jsx`

- [ ] **Step 1: 从已提交的设计素材复制正式 Web 资产**

Run:

```powershell
New-Item -ItemType Directory -Force web/src/assets | Out-Null
Copy-Item docs/superpowers/assets/workbuddy-green-glass/meadow-reference.png web/src/assets/meadow-background.png
Copy-Item docs/superpowers/assets/workbuddy-green-glass/profile-avatar-reference.png web/src/assets/profile-avatar.png
```

Expected: 两个 PNG 均存在且大小大于 1MB；不要重新压缩或改变构图。

- [ ] **Step 2: 创建主题文件并定义批准的设计令牌**

Create `web/src/green-glass.css` with this foundation:

```css
:root {
  --meadow: #dff3d4;
  --glass: rgba(250, 255, 246, .68);
  --glass-solid: #f4fced;
  --forest: #1f6848;
  --glass-ink: #17372b;
  --glass-muted: #537262;
  --glass-edge: rgba(255, 255, 255, .72);
  --glass-rule: rgba(48, 105, 73, .16);
  --glass-focus: #245f91;
  --glass-danger: #a33f35;
}

.landing,
.user-surface {
  color: var(--glass-ink);
  background: var(--meadow) url("./assets/meadow-background.png") center / cover fixed;
}

.glass-panel {
  border: 1px solid var(--glass-edge);
  border-radius: 26px;
  background: var(--glass);
  box-shadow: inset 0 1px rgba(255,255,255,.92), 0 20px 55px rgba(31,104,72,.14);
  backdrop-filter: blur(22px) saturate(1.2);
}
```

- [ ] **Step 3: 让新主题最后加载**

Add after the existing CSS imports in `web/src/main.jsx`:

```js
import "./green-glass.css";
```

- [ ] **Step 4: 构建确认资源路径有效**

Run: `npm run web:build`

Expected: Vite build succeeds; output lists both PNG assets and no unresolved URL warning.

- [ ] **Step 5: Commit**

```bash
git add web/src/assets web/src/green-glass.css web/src/main.jsx
git commit -m "style: add meadow glass visual foundation"
```

## Task 2: 重构登录页和用户端应用壳

**Files:**
- Modify: `web/src/App.jsx`
- Modify: `web/src/green-glass.css`

- [ ] **Step 1: 在 React 中导入头像资源**

Add near the top of `web/src/App.jsx`:

```jsx
import profileAvatar from "./assets/profile-avatar.png";
```

- [ ] **Step 2: 把登录页改成单首屏双区布局**

Replace the current separate `.hero` and `.entry-sheet` composition with:

```jsx
return <main className="landing">
  <section className="login-scene">
    <div className="login-story">
      <span className="scene-kicker">WORKBUDDY · IMAGE MCP</span>
      <h1>让灵感，<br/>在对话里生长。</h1>
      <p>图片完成验证并可靠交付后才扣除一次额度。失败自动释放，未知结果继续对账。</p>
      <img className="profile-hero" src={profileAvatar} alt="小叶的草地角色头像" />
    </div>
    <div className="login-panel glass-panel">
      <div className="login-brand"><span aria-hidden="true">⌁</span><b>WorkBuddy 图片 MCP</b></div>
      <div className="entry-copy">
        <h2>{step === "email" ? "登录或创建账户" : "查收验证码"}</h2>
        <p>{step === "email" ? "验证邮箱后即可创建个人 Key。符合规则的新账户会获得 5 次体验额度。" : `验证码已发送到 ${email}，10 分钟内有效。`}</p>
      </div>
      <form onSubmit={submit}>
        {step === "email"
          ? <label>邮箱地址<input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" /></label>
          : <label>六位验证码<input required inputMode="numeric" pattern="[0-9]{6}" maxLength="6" value={code} onChange={e => setCode(e.target.value)} placeholder="000000" autoFocus /></label>}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? "正在处理…" : step === "email" ? "发送验证码" : "验证并进入"}</button>
        {step === "code" && <button type="button" className="text-button" onClick={() => setStep("email")}>更换邮箱</button>}
      </form>
    </div>
  </section>
</main>;
```

Do not change `submit`, `deviceId`,验证码有效期文案或注册奖励事实。

- [ ] **Step 3: 给应用壳区分用户端和管理后台**

Change the shell class in `App`:

```jsx
<div className={`app-shell ${page === "admin" ? "admin-surface" : "user-surface"}`}>
```

Replace only the existing account block with:

```jsx
<div className="account">
  <img src={profileAvatar} alt="个人头像" />
  <div><span>{me.user.email}</span><button onClick={logout}>退出登录</button></div>
</div>
```

Extract the inline logout operation into a local `logout` function only if needed for readable JSX; do not change the endpoint.

- [ ] **Step 4: 实现登录页和应用壳样式**

Add scoped rules to `green-glass.css`:

```css
.login-scene { min-height: 100vh; display: grid; grid-template-columns: minmax(0,1.2fr) minmax(340px,480px); gap: clamp(32px,7vw,110px); align-items: center; padding: clamp(24px,5vw,72px); background: linear-gradient(110deg,rgba(220,248,212,.24),rgba(30,105,72,.08)); }
.login-story { position: relative; align-self: stretch; display: flex; flex-direction: column; justify-content: center; min-height: 650px; }
.profile-hero { position: absolute; right: 4%; bottom: 0; width: min(47vw,620px); max-height: 78vh; object-fit: contain; filter: drop-shadow(0 25px 38px rgba(37,92,59,.12)); }
.login-panel { position: relative; z-index: 2; padding: clamp(28px,4vw,48px); }
.user-surface { min-height: 100vh; background-attachment: fixed; }
.user-surface::before { content:""; position:fixed; inset:0; pointer-events:none; background:rgba(224,246,216,.72); backdrop-filter:blur(7px); }
.user-surface > * { position:relative; }
.user-surface > aside { margin:16px 0 16px 16px; height:calc(100vh - 32px); border:1px solid var(--glass-edge); border-radius:24px; background:rgba(248,255,243,.7); backdrop-filter:blur(24px); }
.user-surface .account { display:grid; grid-template-columns:42px minmax(0,1fr); gap:10px; align-items:center; }
.user-surface .account img { width:42px; height:42px; border-radius:14px; object-fit:cover; }
```

Keep `.admin-surface` on the incumbent styles; do not target it with meadow/glass overrides.

- [ ] **Step 5: 构建并检查登录态与未登录态**

Run: `npm run web:build`

Expected: PASS. In browser, email and code steps both remain usable; account logout still calls `/api/auth/logout`.

- [ ] **Step 6: Commit**

```bash
git add web/src/App.jsx web/src/green-glass.css
git commit -m "style: redesign login and user shell"
```

## Task 3: 用测试锁定 Key 选择规则

**Files:**
- Modify: `test/web/key-page-flow.test.mjs`
- Modify: `web/src/key-page-flow.js`

- [ ] **Step 1: 写失败测试**

Append to `test/web/key-page-flow.test.mjs`:

```js
test("keeps the selected key when it still exists", () => {
  assert.equal(flow.resolveSelectedKeyId([{ id: "a" }, { id: "b" }], "b"), "b");
});

test("selects the first remaining key after deletion", () => {
  assert.equal(flow.resolveSelectedKeyId([{ id: "b" }, { id: "c" }], "a"), "b");
});

test("clears selection when no keys remain", () => {
  assert.equal(flow.resolveSelectedKeyId([], "a"), "");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/web/key-page-flow.test.mjs`

Expected: FAIL because `resolveSelectedKeyId` is not defined.

- [ ] **Step 3: 实现最小选择函数**

Add to `web/src/key-page-flow.js`:

```js
export function resolveSelectedKeyId(keys, selectedId) {
  if (keys.some((key) => key.id === selectedId)) return selectedId;
  return keys[0]?.id || "";
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/web/key-page-flow.test.mjs`

Expected: all tests in the file pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/key-page-flow.js test/web/key-page-flow.test.mjs
git commit -m "test: define key workspace selection"
```

## Task 4: 实现双栏 Key 工作台

**Files:**
- Modify: `web/src/App.jsx`
- Modify: `web/src/green-glass.css`

- [ ] **Step 1: 接入选择状态**

Import `resolveSelectedKeyId`, add `selectedId`, and keep it synchronized:

```jsx
import { createKeyWithPrompt, isPromptExpired, resolveSelectedKeyId } from "./key-page-flow.js";

const [selectedId, setSelectedId] = useState("");
useEffect(() => {
  setSelectedId((current) => resolveSelectedKeyId(keys, current));
}, [keys]);

const selectedKey = keys.find((key) => key.id === selectedId) || null;
```

When a new Key is created, set it as selected inside `onKeyCreated`. Deletion relies on the effect to choose the first remaining Key.

- [ ] **Step 2: 用双栏语义结构替换逐个展开的 Key 列表**

Render this structure after the compact page header and release status:

```jsx
<div className="key-workspace glass-panel">
  <aside className="key-selector" aria-label="个人 Key 列表">
    {keys.map((key) => <button
      key={key.id}
      className={selectedId === key.id ? "selected" : ""}
      aria-pressed={selectedId === key.id}
      onClick={() => setSelectedId(key.id)}
    >
      <span><b>{key.name}</b><code>{`wb_live_${key.prefix}_…`}</code></span>
      <Status value={key.status} />
      <small>{key.lastUsedAt ? `最近使用 ${new Date(key.lastUsedAt).toLocaleString("zh-CN")}` : "尚未使用"}</small>
    </button>)}
  </aside>
  <section className="key-detail" aria-live="polite">
    {selectedKey ? renderKeyDetail(selectedKey) : <Empty>还没有 Key。创建后可直接复制安装提示词。</Empty>}
  </section>
</div>
```

Define `renderKeyDetail` inside `Keys`, immediately before `return`:

```jsx
const renderKeyDetail = (key) => {
  const promptState = prompts[key.id];
  const expired = Boolean(promptState?.prompt) && isPromptExpired(promptState.expiresAt, clock);
  const panelId = `install-prompt-${key.id}`;
  return <>
    <header className="key-detail-head">
      <div><span className="scene-kicker">SELECTED KEY</span><h2>{key.name}</h2><small>创建于 {key.createdAt ? new Date(key.createdAt).toLocaleString("zh-CN") : "刚刚"}</small></div>
      <div className="key-meta"><Status value={key.status}/><small>{key.lastUsedAt ? `最近使用 ${new Date(key.lastUsedAt).toLocaleString("zh-CN")}` : "尚未使用"}</small></div>
    </header>
    <section className="key-secret-section">
      <h3>个人 Key</h3>
      <div className="key-secret-row"><code className="full-key">{key.key || `wb_live_${key.prefix}_••••••••`}</code>{key.key && <button aria-label="复制完整个人 Key" onClick={() => copy(key.id, "key", key.key)}>复制 Key</button>}</div>
      {!key.key && key.status === "active" && <p className="key-unrecoverable">该 Key 的完整内容不可恢复。若需要复制，请删除后重新创建。</p>}
    </section>
    {key.status === "active" && <section className="prompt-section">
      <div className="prompt-header"><div><h3>WorkBuddy 安装提示词</h3><p>生成后 30 分钟有效且只能使用一次；复制后直接粘贴给 WorkBuddy。</p></div>{promptState?.prompt && !expired && <button className="text-button" aria-expanded={Boolean(promptState.expanded)} aria-controls={panelId} onClick={() => togglePrompt(key.id)}>{promptState.expanded ? "收起" : "展开"}</button>}</div>
      {!promptState && <div className="prompt-state"><p>{release.ready ? "当前页面还没有为这个 Key 生成安装提示词。" : "安装服务准备中，暂时不能生成安装提示词。"}</p><button className="primary" disabled={!release.ready || issuing === key.id} onClick={() => issuePrompt(key.id)}>生成安装提示词</button></div>}
      {promptState?.loading && <Loading>正在生成安装提示词…</Loading>}
      {promptState?.error && !promptState.loading && <div className="prompt-state error" role="alert"><p>提示词生成失败：{promptState.error}</p><button disabled={!release.ready} onClick={() => issuePrompt(key.id)}>重试</button></div>}
      {expired && !promptState.loading && <div className="prompt-state"><p>这段安装提示词已过期，请重新生成。</p><button className="primary" disabled={!release.ready || issuing === key.id} onClick={() => issuePrompt(key.id)}>重新生成</button></div>}
      {promptState?.prompt && !expired && <div id={panelId} className="prompt-body" hidden={!promptState.expanded}><div className="prompt-actions"><button className="primary" disabled={!release.ready} onClick={() => copy(key.id, "prompt", promptState.prompt)}>复制提示词</button><button disabled={!release.ready || issuing === key.id} onClick={() => issuePrompt(key.id)}>{issuing === key.id ? "正在生成…" : "重新生成"}</button><span aria-live="polite">{copyState.id === key.id ? copyState.message : ""}</span></div><pre tabIndex="0">{promptState.prompt}</pre><small>30 分钟内有效且只能使用一次 · 准确过期时间 {formatInstallExpiry(promptState.expiresAt)}</small></div>}
    </section>}
    {key.status === "active" && <button disabled={busy} className="danger-text key-delete" onClick={() => deleteKey(key.id)}>删除这个 Key</button>}
  </>;
};
```

- [ ] **Step 3: 收紧顶部与 Release 状态**

Use one compact header row:

```jsx
<header className="key-page-head">
  <div><span className="scene-kicker">ACCESS KEYS</span><h1>我的 MCP Key</h1><p>选择一个 Key，复制安装提示词给 WorkBuddy。</p></div>
  <div className="key-page-actions"><span>{activeCount} / 3 个有效</span><button className="primary" onClick={create} disabled={busy}>创建 Key</button></div>
</header>
```

Place the Release readiness message inside the right detail area as a compact status strip. Keep the manual installer link available but secondary.

- [ ] **Step 4: 实现双栏与提示词样式**

Add to `green-glass.css`:

```css
.user-surface .key-workspace { display:grid; grid-template-columns:minmax(260px,310px) minmax(0,1fr); min-height:560px; overflow:hidden; }
.key-selector { padding:14px; border-right:1px solid var(--glass-rule); background:rgba(237,249,230,.42); }
.key-selector > button { width:100%; display:grid; grid-template-columns:minmax(0,1fr) auto; gap:6px 10px; padding:14px; border:1px solid transparent; border-radius:15px; background:transparent; color:inherit; text-align:left; cursor:pointer; }
.key-selector > button.selected { border-color:var(--glass-edge); background:rgba(255,255,255,.58); box-shadow:inset 0 1px white; }
.key-selector code,.key-selector small { color:var(--glass-muted); font-size:10px; }
.key-detail { min-width:0; padding:clamp(22px,4vw,42px); }
.key-secret-row { grid-template-columns:minmax(0,1fr) auto; }
.key-secret-row .full-key { border-color:var(--glass-rule); border-radius:12px; background:rgba(244,252,237,.9); }
.prompt-body pre { max-height:320px; border-color:var(--glass-rule); border-radius:14px; background:rgba(244,252,237,.94); }
```

- [ ] **Step 5: 运行 Key 测试和完整构建**

Run:

```bash
node --test test/web/key-page-flow.test.mjs
npm run web:build
```

Expected: tests pass; Vite build passes; no React key or nesting warnings in browser console.

- [ ] **Step 6: Commit**

```bash
git add web/src/App.jsx web/src/green-glass.css
git commit -m "feat: build compact key workspace"
```

## Task 5: 统一控制台、充值与安装页

**Files:**
- Modify: `web/src/App.jsx`
- Modify: `web/src/green-glass.css`

- [ ] **Step 1: 给用户页添加明确的页面级类名**

Change only the opening section classes; leave their children unchanged:

```jsx
// Overview
return <section className="page overview-page">
// Recharge
return <section className="page recharge-page">
// Keys
return <section className="page keys-page">
// Install
return <section className="page install-page">
```

Keep `<section className="page admin-page">` on the incumbent admin presentation.

- [ ] **Step 2: 把余额带改成两张主要面板和一条规则说明**

Keep the same values and copy, but render:

```jsx
<div className="balance-grid">
  <article className="balance-card glass-panel"><span>可用额度</span><strong>{me.wallet.available_credits}</strong><small>可用于新的生成任务</small></article>
  <article className="balance-card glass-panel"><span>冻结额度</span><strong>{me.wallet.held_credits}</strong><small>等待交付或对账</small></article>
  <p className="billing-note">成功交付一张扣除 1 次 · 充值额度永久有效</p>
</div>
```

- [ ] **Step 3: 为充值和安装流程增加玻璃容器，不改变行为**

Add glass classes to the existing containers without changing their children:

```jsx
<div className="package-strip glass-panel user-panel package-panel">
<div className="payment-channels glass-panel user-panel">
<div className="orders glass-panel user-panel orders-panel">
<div className="install-flow">
<ol className="glass-panel user-panel install-steps">
<div className="download-plate glass-panel user-panel manual-install">
```

Do not change package creation calls, proof upload, Release URLs or installation instructions.

- [ ] **Step 4: 添加页面统一样式**

```css
.user-surface .page { max-width:1440px; padding:clamp(28px,5vw,68px); }
.user-surface .page-head { border:0; padding-bottom:28px; }
.balance-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:18px; }
.balance-card { padding:28px; }
.balance-card strong { display:block; margin:14px 0 8px; color:var(--forest); font-size:clamp(52px,6vw,78px); line-height:1; }
.billing-note { grid-column:1/-1; margin:0; color:var(--glass-muted); }
.user-panel { padding:clamp(22px,3vw,36px); }
.user-surface table,.user-surface .entries { background:rgba(250,255,246,.48); border-radius:18px; overflow:hidden; }
```

- [ ] **Step 5: 构建并验证业务请求未改变**

Run:

```bash
npm test
npm run web:build
```

Expected: 0 failures; existing platform API tests remain green.

- [ ] **Step 6: Commit**

```bash
git add web/src/App.jsx web/src/green-glass.css
git commit -m "style: unify customer workspace pages"
```

## Task 6: 响应式、键盘与减少动态效果

**Files:**
- Modify: `web/src/green-glass.css`
- Modify: `web/src/App.jsx` only if accessible labels are missing

- [ ] **Step 1: 添加 1100px 与 760px 断点**

```css
@media (max-width:1100px) {
  .user-surface { grid-template-columns:92px 1fr; }
  .user-surface .wordmark b,.user-surface nav button:not(.active) { font-size:0; }
  .user-surface .key-workspace { grid-template-columns:240px minmax(0,1fr); }
}

@media (max-width:760px) {
  .login-scene { grid-template-columns:1fr; padding:20px; }
  .login-story { min-height:44vh; justify-content:flex-start; }
  .profile-hero { width:min(88vw,480px); right:-8%; opacity:.92; }
  .user-surface { display:block; padding-bottom:84px; }
  .user-surface > aside { position:fixed; z-index:20; inset:auto 10px 10px; width:auto; height:68px; margin:0; }
  .user-surface .key-workspace { grid-template-columns:1fr; }
  .key-selector { border-right:0; border-bottom:1px solid var(--glass-rule); display:flex; overflow-x:auto; }
  .key-selector > button { min-width:220px; }
  .balance-grid { grid-template-columns:1fr; }
}
```

- [ ] **Step 2: 完成键盘和辅助技术细节**

Ensure:

```jsx
<button aria-label="复制完整个人 Key">复制 Key</button>
<span className="copy-feedback" aria-live="polite">{message}</span>
<button aria-expanded={promptState.expanded} aria-controls={panelId}>{promptState.expanded ? "收起" : "展开"}</button>
```

Every icon-only control needs a Chinese `aria-label`. Selected Key uses `aria-pressed` and visible focus.

- [ ] **Step 3: 添加动态偏好和低性能回退**

```css
@supports not (backdrop-filter: blur(1px)) {
  .glass-panel,.user-surface > aside { background:rgba(244,252,237,.96); }
}
@media (prefers-reduced-motion:reduce) {
  .landing *, .user-surface * { scroll-behavior:auto !important; transition:none !important; animation:none !important; }
}
```

- [ ] **Step 4: Build and commit**

Run: `npm run web:build`

Expected: PASS.

```bash
git add web/src/App.jsx web/src/green-glass.css
git commit -m "fix: adapt glass workspace for mobile and keyboard"
```

## Task 7: 有界视觉验收与一次修正

**Files:**
- Modify: only files implicated by the inspection

- [ ] **Step 1: 运行机械设计检查一次**

Run:

```powershell
node C:\Users\Midiec\Documents\Codex\.agents\skills\impeccable\scripts\detect.mjs --json web/src/App.jsx web/src/green-glass.css web/src/main.jsx
```

Expected: no high-confidence violations. Fix actual violations in one batch; do not rerun until after the screenshot pass.

- [ ] **Step 2: 启动本地站点并准备真实状态**

Run the existing local stack:

```powershell
docker compose -p workbuddy-image-mcp --env-file .env up -d postgres api worker legacy-gateway caddy
```

Open `http://127.0.0.1:3000`. Use an existing local account containing at least two Keys when available; otherwise create two test Keys through the UI.

- [ ] **Step 3: 一次性检查桌面与手机截图**

Capture and inspect:

- Desktop `1440 × 1000`: email login、验证码、概览、充值、Key 双栏、安装页。
- Mobile `390 × 844`: login、概览、Key 上下布局。
- Key states: two active Keys、long full Key、long prompt、expired prompt、Release pending or simulated error where safely available。

Check: no overflow, no content hidden under nav, readable contrast, avatar crop, glass hierarchy, 44px mobile targets, admin page not visually restructured.

- [ ] **Step 4: 在一个批次修复全部截图缺陷**

Modify only the implicated JSX/CSS. Typical allowed fixes: spacing, line wrapping, max-height, background overlay, avatar object-position, mobile grid, focus visibility. Do not add new features.

- [ ] **Step 5: 做最后一次确认**

Rebuild and capture only the previously failing desktop/mobile surfaces:

```bash
npm run web:build
```

Run detector one final time only if code changed after Step 1.

- [ ] **Step 6: Commit**

```bash
git add web/src/App.jsx web/src/green-glass.css web/src/main.jsx web/src/assets
git commit -m "style: finish meadow glass interface"
```

## Task 8: 全量验证与生产部署准备

**Files:**
- Verify: entire repository
- Create artifact outside Git: `C:\Users\Midiec\Downloads\workbuddy-green-glass-<commit>.tar.gz`

- [ ] **Step 1: 运行完整验证**

Run:

```powershell
npm test
npm run web:build
git diff --check
git status -sb
```

Expected: 0 test failures, Vite build success, no whitespace errors, only intentional branch commits.

- [ ] **Step 2: 检查敏感信息没有进入变更**

Run:

```powershell
git diff HEAD~6..HEAD -- . ':!docs/superpowers/assets/**' | rg -n "SMTP_PASS|COS_SECRET|API_KEY_ENCRYPTION_KEY|wb_live_|wb_install_"
```

Expected: no real credential values. Test fixtures and UI labels are acceptable only when clearly synthetic.

- [ ] **Step 3: 创建可审计部署包**

Run:

```powershell
$commit = git rev-parse --short HEAD
git archive --format=tar.gz --output="C:\Users\Midiec\Downloads\workbuddy-green-glass-$commit.tar.gz" HEAD
Get-FileHash "C:\Users\Midiec\Downloads\workbuddy-green-glass-$commit.tar.gz" -Algorithm SHA256
```

Expected: archive is created outside Git and SHA-256 is printed for server verification.

- [ ] **Step 4: 部署时只重建应用容器**

On the server, after backing up `/opt/workbuddy-image-mcp`, extract the verified archive, preserve `.env`, then run:

```bash
sudo docker compose -p workbuddy-image-mcp --env-file .env config --quiet
sudo docker compose -p workbuddy-image-mcp --env-file .env up -d --build api worker legacy-gateway caddy
curl -fsS https://xiaoyeai.cn/healthz
curl -fsS https://xiaoyeai.cn/readyz
```

Expected: both health responses are OK; PostgreSQL volume is untouched.

- [ ] **Step 5: 生产冒烟验收**

Verify in the production browser:

- 登录请求验证码正常。
- 现有账户余额和账本可读。
- Key 双栏切换、复制和提示词生成正常。
- 充值与安装入口正常。
- 管理后台功能和结构未回归。

Record the production commit and archive SHA-256 in the handoff; do not commit `.env`, backups or deployment archives.
