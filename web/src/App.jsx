import { useCallback, useEffect, useRef, useState } from "react";
import { formatInstallExpiry, formatWorkBuddyMcpConfig, installationPromptStatus } from "./mcp-config.js";

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", ...options, headers: options.body instanceof FormData ? options.headers : { "content-type": "application/json", ...options.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || "请求失败，请稍后重试");
  return body;
}

const Icon = ({ name }) => {
  const paths = {
    overview: <><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5"/></>,
    recharge: <><path d="M3 7h18v11H3z"/><path d="M3 10h18M16 15h2"/></>,
    key: <><circle cx="8" cy="12" r="4"/><path d="m12 12 9-9M17 7l2 2M14 10l2 2"/></>,
    install: <><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 19h16"/></>,
    admin: <><path d="M12 3 4 6v6c0 5 3 8 8 9 5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-5"/></>
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">{paths[name]}</svg>;
};

function Status({ value }) {
  const labels = { queued: "排队中", submitting: "提交中", provider_pending: "生成中", output_persisting: "保存中", succeeded: "已成功", failed: "已失败", unknown: "待对账", manual_review: "人工复核", created: "待付款", proof_submitted: "待审核", approved: "已到账", rejected: "已驳回", expired: "已过期", active: "有效", revoked: "已撤销", suspended: "已停用", pending_review: "待审核" };
  return <span className={`status status-${value}`}>{labels[value] || value}</span>;
}

function Empty({ children }) { return <div className="empty"><span>—</span><p>{children}</p></div>; }
function Loading({ children = "正在读取…" }) { return <div className="loading" role="status"><span/><p>{children}</p></div>; }

function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [deviceId] = useState(() => localStorage.getItem("wb_device") || crypto.randomUUID());
  const [step, setStep] = useState("email");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => localStorage.setItem("wb_device", deviceId), [deviceId]);
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (step === "email") { await api("/api/auth/email-code", { method: "POST", body: JSON.stringify({ email, device_id: deviceId }) }); setStep("code"); }
      else { const result = await api("/api/auth/verify", { method: "POST", body: JSON.stringify({ email, code, device_id: deviceId }) }); onLogin(result); }
    } catch (reason) { setError(reason.message); } finally { setBusy(false); }
  };
  return <main className="landing">
    <section className="hero">
      <div className="registration-mark top-left"/><div className="registration-mark bottom-right"/>
      <div className="hero-copy">
        <h1>图片生成，<br/>按交付结算。</h1>
        <p>专为 WorkBuddy 准备的图片 MCP。只有图片验证完成并可靠保存后才扣除一次额度；失败会释放，未知结果留待对账。</p>
      </div>
      <div className="settlement-diagram" aria-label="计费流程">
        <div><strong>01</strong><span>冻结一份额度</span></div>
        <i/>
        <div><strong>02</strong><span>生成并验证图片</span></div>
        <i/>
        <div><strong>03</strong><span>交付后结算</span></div>
      </div>
    </section>
    <section className="entry-sheet">
      <div className="stamp" aria-hidden="true"><span>WORKBUDDY · IMAGE · MCP ·</span><b>WB</b></div>
      <div className="entry-copy"><h2>{step === "email" ? "登录或创建账户" : "查收验证码"}</h2><p>{step === "email" ? "验证邮箱后即可创建个人 Key。符合规则的新账户会获得 5 次体验额度。" : `验证码已发送到 ${email}，10 分钟内有效。`}</p></div>
      <form onSubmit={submit}>
        {step === "email" ? <label>邮箱地址<input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" /></label> : <label>六位验证码<input required inputMode="numeric" pattern="[0-9]{6}" maxLength="6" value={code} onChange={e => setCode(e.target.value)} placeholder="000000" autoFocus /></label>}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? "正在处理…" : step === "email" ? "发送验证码" : "验证并进入"}</button>
        {step === "code" && <button type="button" className="text-button" onClick={() => setStep("email")}>更换邮箱</button>}
      </form>
    </section>
  </main>;
}

function Overview({ me }) {
  const [data, setData] = useState({ entries: [], generations: [], loading: true, error: "" });
  useEffect(() => { Promise.all([api("/api/ledger"), api("/api/generations")]).then(([ledger, jobs]) => setData({ entries: ledger.entries, generations: jobs.generations, loading: false, error: "" })).catch(error => setData(current => ({ ...current, loading: false, error: error.message }))); }, []);
  return <section className="page"><header className="page-head"><h1>你的使用台账</h1><p>生成记录不展示图片或提示词，只保留状态和扣费事实。</p></header>
    <div className="balance-band"><div><span>可用额度</span><strong>{me.wallet.available_credits}</strong></div><div><span>冻结额度</span><strong>{me.wallet.held_credits}</strong></div><p>成功交付一张扣除 1 次<br/>充值额度永久有效</p></div>
    {data.error && <p className="error" role="alert">台账读取失败：{data.error}</p>}
    <div className="split-ledger"><div><h2>最近任务</h2>{data.loading ? <Loading/> : data.generations.length ? <table><thead><tr><th>任务</th><th>状态</th><th>时间</th></tr></thead><tbody>{data.generations.map(x => <tr key={x.request_id}><td className="mono">{x.request_id.slice(0, 13)}…</td><td><Status value={x.state}/></td><td>{new Date(x.created_at).toLocaleString("zh-CN")}</td></tr>)}</tbody></table> : <Empty>还没有生成任务。完成安装后可直接在 WorkBuddy 中使用。</Empty>}</div>
    <div><h2>额度流水</h2>{data.loading ? <Loading/> : data.entries.length ? <ul className="entries">{data.entries.map(x => <li key={x.id}><div><b>{({ signup_bonus:"注册赠送", first_recharge_bonus:"首次充值赠送", recharge:"充值到账", hold:"生成冻结", capture:"成功结算", release:"失败释放", admin_adjustment:"人工调账" })[x.event_type]}</b><span>{new Date(x.created_at).toLocaleString("zh-CN")}</span></div><strong className={x.amount > 0 ? "positive" : ""}>{x.amount > 0 ? "+" : ""}{x.amount}</strong></li>)}</ul> : <Empty>账本尚无记录。</Empty>}</div></div>
  </section>;
}

function Keys() {
  const [keys, setKeys] = useState([]), [error, setError] = useState(""), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [issuing, setIssuing] = useState(""), [copyState, setCopyState] = useState({}), [promptFallback, setPromptFallback] = useState(null);
  const load = useCallback(() => api("/api/api-keys").then(x => setKeys(x.keys)).finally(()=>setLoading(false)), []);
  useEffect(() => { load().catch(e => setError(e.message)); }, [load]);
  const create = async () => { setBusy(true); setError(""); try { await api("/api/api-keys", { method:"POST", body: JSON.stringify({ name:"WorkBuddy Windows" }) }); await load(); } catch(e) { setError(e.message); } finally { setBusy(false); } };
  const deleteKey = async id => { if (!confirm("删除后此 Key 会立即失效，使用它的 WorkBuddy 将无法继续访问。继续吗？")) return; setBusy(true); setError(""); try { await api(`/api/api-keys/${id}`, { method:"DELETE" }); await load(); } catch(e){setError(e.message)} finally {setBusy(false)} };
  const copy = async (id, type, value) => { try { await navigator.clipboard.writeText(value); setCopyState({ id, type, message: type === "config" ? "完整配置已复制" : "Key 已复制" }); } catch { setCopyState({ id, type, message: "复制失败，请手动选择内容" }); } };
  const issuePrompt = async (key) => {
    setIssuing(key.id); setError(""); setPromptFallback(null);
    try {
      const result = await api(`/api/api-keys/${key.id}/installation-token`, { method: "POST" });
      let copied = true;
      try { await navigator.clipboard.writeText(result.prompt); } catch { copied = false; setPromptFallback({ id: key.id, prompt: result.prompt }); }
      setCopyState({ id: key.id, type: "prompt", message: `${installationPromptStatus({ copied })}，有效至 ${formatInstallExpiry(result.expires_at)}` });
    } catch (e) { setError(e.message); }
    finally { setIssuing(""); }
  };
  return <section className="page"><header className="page-head"><h1>个人 MCP Key</h1><p>每位用户最多保留 3 个有效 Key。登录后可随时复制完整 Key 和 WorkBuddy 配置。</p></header>
    <div className="toolbar"><button className="primary" onClick={create} disabled={busy}>{busy ? "正在处理…" : "创建新 Key"}</button><span>{keys.filter(x=>x.status==="active").length} / 3 个有效</span></div>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="key-list">{loading ? <Loading/> : keys.length ? keys.map(key => {
      const config = key.key ? formatWorkBuddyMcpConfig(key.key) : "";
      return <article className="key-entry" key={key.id}><div className="key-entry-head"><div><h2>{key.name}</h2><code className="full-key">{key.key || `wb_live_${key.prefix}_••••••••`}</code></div><div className="key-meta"><Status value={key.status}/><small>{key.lastUsedAt ? `最近使用 ${new Date(key.lastUsedAt).toLocaleString("zh-CN")}` : "尚未使用"}</small>{key.status === "active" && <button disabled={busy} className="danger-text" onClick={() => deleteKey(key.id)}>删除</button>}</div></div>
        {key.key ? <div className="key-delivery"><div className="key-actions"><button className="primary" disabled={issuing === key.id} onClick={() => issuePrompt(key)}>{issuing === key.id ? "正在生成…" : "复制安装提示词"}</button><a href="/downloads/WorkBuddy-Image-MCP-Setup.exe">下载安装器</a><button onClick={() => copy(key.id, "config", config)}>复制完整配置</button><button onClick={() => copy(key.id, "key", key.key)}>复制 Key</button><span aria-live="polite">{copyState.id === key.id ? copyState.message : ""}</span></div>{promptFallback?.id === key.id && <div className="prompt-fallback"><b>手动复制这段提示词</b><pre tabIndex="0">{promptFallback.prompt}</pre></div>}<div className="config-heading"><h3>WorkBuddy MCP 完整配置</h3><p>这是手动备用方案。正常安装只需复制上方提示词并粘贴给 WorkBuddy。</p></div><pre tabIndex="0"><code>{config}</code></pre></div> : key.status === "active" ? <p className="key-unrecoverable">这是升级前创建的旧 Key，无法恢复完整内容。请撤销后重新创建。</p> : null}
      </article>;
    }) : <Empty>还没有 Key。创建后即可复制完整 WorkBuddy 配置。</Empty>}</div>
  </section>;
}

function Recharge() {
  const [packages, setPackages] = useState([]), [orders, setOrders] = useState([]), [channels, setChannels] = useState([]), [error, setError] = useState(""), [loading, setLoading] = useState(true), [busy, setBusy] = useState("");
  const load = useCallback(() => Promise.all([api("/api/recharge-packages"), api("/api/recharge-orders"), api("/api/payment-instructions")]).then(([a,b,c]) => { setPackages(a.packages); setOrders(b.orders); setChannels(c.channels); }).finally(()=>setLoading(false)), []);
  useEffect(() => { load().catch(e => setError(e.message)); }, [load]);
  const createOrder = async packageId => { setBusy(`package-${packageId}`); setError(""); try { await api("/api/recharge-orders", { method:"POST", body:JSON.stringify({ package_id: packageId }) }); await load(); } catch(e){ setError(e.message); } finally {setBusy("")} };
  const upload = async (id, file) => { const form = new FormData(); form.append("proof", file); setBusy(`order-${id}`); setError(""); try { await api(`/api/recharge-orders/${id}/proof`, { method:"POST", body:form }); await load(); } catch(e){ setError(e.message); } finally {setBusy("")} };
  return <section className="page"><header className="page-head"><h1>充值额度</h1><p>选择固定套餐后，按收款码付款并上传截图。管理员确认到账后额度永久有效。</p></header>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="package-strip">{loading ? <Loading/> : packages.length ? packages.map(x => <button key={x.id} disabled={Boolean(busy)} onClick={() => createOrder(x.id)}><span>{x.name}</span><strong>{x.credits} 次</strong><small>{busy===`package-${x.id}` ? "正在创建…" : `¥${(x.price_fen/100).toFixed(2)} · 创建订单`}</small></button>) : <Empty>管理员尚未上架充值套餐。</Empty>}</div>
    {channels.length > 0 && <div className="payment-channels">{channels.map(c => <div key={c.id}><img src={c.qr_url} alt={`${c.name}收款码`}/><div><h2>{c.name}</h2><p>{c.instructions || "付款时请备注订单号，完成后上传付款截图。"}</p></div></div>)}</div>}
    <h2 className="section-title">我的充值订单</h2>{loading ? <Loading/> : orders.length ? <div className="orders">{orders.map(o => <article key={o.id}><div><code>{o.order_no}</code><b>{o.package_name} · {o.credits} 次 · ¥{(o.price_fen/100).toFixed(2)}</b></div><div><Status value={o.state}/>{o.state === "created" && <label className="upload">{busy===`order-${o.id}` ? "正在上传…" : "上传付款截图"}<input disabled={Boolean(busy)} type="file" accept="image/png,image/jpeg,image/webp" onChange={e => e.target.files[0] && upload(o.id,e.target.files[0])}/></label>}</div></article>)}</div> : <Empty>还没有充值订单。</Empty>}
  </section>;
}

function Install() {
  return <section className="page"><header className="page-head"><h1>把图片 MCP 装进 WorkBuddy</h1><p>正常流程不需要判断 Node.js、安装目录或配置路径，只需复制一段提示词。</p></header>
    <div className="install-flow"><ol><li><b>创建个人 Key</b><p>前往“MCP Key”页面，选择一个有效 Key。</p></li><li><b>复制提示词给 WorkBuddy</b><p>点击“复制安装提示词”，粘贴到 WorkBuddy 对话中。</p></li><li><b>允许执行并开启 MCP</b><p>确认一次本机执行权限；安装完成后开启 xiaoye-image，必要时重启 WorkBuddy。</p></li></ol><div className="download-plate"><Icon name="install"/><h2>手动备用安装</h2><p>WorkBuddy 不能执行本机命令时使用。</p><a className="primary" href="/downloads/WorkBuddy-Image-MCP-Setup.exe">下载安装器</a><small>完整 JSON 配置和个人 Key 可在“MCP Key”页面复制。</small></div></div>
  </section>;
}

function Admin() {
  const [orders, setOrders] = useState([]), [users, setUsers] = useState([]), [reviews, setReviews] = useState([]), [adminPackages, setAdminPackages] = useState([]), [adminChannels, setAdminChannels] = useState([]), [metrics, setMetrics] = useState(null), [error, setError] = useState(""), [loading, setLoading] = useState(true), [busy, setBusy] = useState("");
  const load = useCallback(() => Promise.all([api("/api/admin/recharge-orders"),api("/api/admin/users"),api("/api/admin/manual-reviews"),api("/api/admin/recharge-packages"),api("/api/admin/payment-channels"),api("/api/admin/metrics")]).then(([a,b,c,d,e,f])=>{setOrders(a.orders);setUsers(b.users);setReviews(c.generations);setAdminPackages(d.packages);setAdminChannels(e.channels);setMetrics(f)}).catch(e=>setError(e.message)).finally(()=>setLoading(false)),[]);
  useEffect(()=>{load()},[load]);
  const reviewOrder = async (id, action) => { const reason = action === "reject" ? prompt("填写驳回原因") : undefined; if(action === "reject" && !reason)return; setBusy(`order-${id}`);setError("");try{await api(`/api/admin/recharge-orders/${id}/${action}`,{method:"POST",body:JSON.stringify({reason})});await load()}catch(e){setError(e.message)}finally{setBusy("")} };
  const resolveJob = async (id, outcome) => { const reason=prompt("填写人工复核依据");if(!reason)return;setBusy(`job-${id}`);setError("");try{await api(`/api/admin/manual-reviews/${id}/resolve`,{method:"POST",body:JSON.stringify({outcome,reason})});await load()}catch(e){setError(e.message)}finally{setBusy("")} };
  const createPackage = async event => {event.preventDefault();const form=new FormData(event.currentTarget);setBusy("package");setError("");try{await api("/api/admin/recharge-packages",{method:"POST",body:JSON.stringify({name:form.get("name"),price_fen:Math.round(Number(form.get("price"))*100),credits:Number(form.get("credits"))})});event.currentTarget.reset();await load()}catch(e){setError(e.message)}finally{setBusy("")}};
  const createChannel = async event => {event.preventDefault();const raw=new FormData(event.currentTarget);const body=new FormData();body.append("name",raw.get("name"));body.append("instructions",raw.get("instructions"));body.append("image",raw.get("image"));setBusy("channel");setError("");try{await api("/api/admin/payment-channels",{method:"POST",body});event.currentTarget.reset();await load()}catch(e){setError(e.message)}finally{setBusy("")}};
  const togglePackage = async item => {setBusy(`package-${item.id}`);try{await api(`/api/admin/recharge-packages/${item.id}`,{method:"PATCH",body:JSON.stringify({active:!item.active})});await load()}catch(e){setError(e.message)}finally{setBusy("")}};
  const toggleChannel = async item => {setBusy(`channel-${item.id}`);try{await api(`/api/admin/payment-channels/${item.id}`,{method:"PATCH",body:JSON.stringify({active:!item.active})});await load()}catch(e){setError(e.message)}finally{setBusy("")}};
  const adjust = async user => {const amount=Number(prompt(`为 ${user.email} 调整多少额度？可填写负数。`));if(!Number.isInteger(amount)||amount===0)return;const reason=prompt("填写调账原因");if(!reason)return;setBusy(`user-${user.id}`);setError("");try{await api(`/api/admin/users/${user.id}/adjust-credits`,{method:"POST",headers:{"idempotency-key":crypto.randomUUID()},body:JSON.stringify({amount,reason})});await load()}catch(e){setError(e.message)}finally{setBusy("")}};
  const changeStatus = async user => {const status=user.status==="active"?"suspended":"active";const reason=prompt(status==="suspended"?`填写停用 ${user.email} 的原因`:`填写恢复 ${user.email} 的原因`);if(!reason)return;setBusy(`user-${user.id}`);setError("");try{await api(`/api/admin/users/${user.id}`,{method:"PATCH",body:JSON.stringify({status,reason})});await load()}catch(e){setError(e.message)}finally{setBusy("")}};
  const pendingOrders=orders.filter(x=>x.state==="proof_submitted");
  return <section className="page"><header className="page-head"><h1>运营与复核</h1><p>所有审核、调账和异常任务处理都会记录操作人、时间、对象和原因。</p></header>{error&&<p className="error" role="alert">{error}</p>}
    {metrics&&<div className="ops-metrics"><div><span>排队最久</span><strong>{metrics.queue_oldest_wait_seconds}s</strong></div><div><span>24h 成功率</span><strong>{metrics.generation_success_rate_24h==null?"—":`${Math.round(metrics.generation_success_rate_24h*100)}%`}</strong></div><div><span>未知 / 人工复核</span><strong>{(metrics.state_counts.unknown||0)+(metrics.state_counts.manual_review||0)}</strong></div><div><span>钱包异常</span><strong>{metrics.wallet_invariant_violations}</strong></div></div>}
    <h2 className="section-title">套餐与收款码</h2><div className="admin-config"><form onSubmit={createPackage}><h3>新增固定套餐</h3><label>套餐名<input name="name" required/></label><label>金额（元）<input name="price" type="number" min="0.01" step="0.01" required/></label><label>生成次数<input name="credits" type="number" min="1" step="1" required/></label><button disabled={Boolean(busy)}>{busy==="package"?"正在保存…":"保存套餐"}</button></form><form onSubmit={createChannel}><h3>新增收款码</h3><label>渠道名<input name="name" required/></label><label>付款说明<input name="instructions"/></label><label>收款码图片<input name="image" type="file" accept="image/png,image/jpeg,image/webp" required/></label><button disabled={Boolean(busy)}>{busy==="channel"?"正在上传…":"保存收款码"}</button></form></div><div className="admin-list">{loading?<Loading/>:<>{adminPackages.map(item=><article key={`package-${item.id}`}><div><b>{item.name}</b><span>¥{(item.price_fen/100).toFixed(2)} · {item.credits} 次</span></div><Status value={item.active?"active":"revoked"}/><button disabled={Boolean(busy)} onClick={()=>togglePackage(item)}>{item.active?"下架":"重新上架"}</button></article>)}{adminChannels.map(item=><article key={`channel-${item.id}`}><div><b>{item.name}</b><span>{item.instructions||"暂无付款说明"}</span></div><Status value={item.active?"active":"revoked"}/><button disabled={Boolean(busy)} onClick={()=>toggleChannel(item)}>{item.active?"停用":"启用"}</button></article>)}</>}</div>
    <h2 className="section-title">待审核充值</h2><div className="admin-list">{loading?<Loading/>:pendingOrders.map(o=><article key={o.id}><div><b>{o.email}</b><code>{o.order_no}</code><span>{o.package_name} · ¥{(o.price_fen/100).toFixed(2)} · {o.credits} 次</span></div>{o.proof_url&&<a href={o.proof_url} target="_blank" rel="noopener noreferrer">查看凭证</a>}<button disabled={Boolean(busy)} onClick={()=>reviewOrder(o.id,"approve")}>{busy===`order-${o.id}`?"正在处理…":"确认到账"}</button><button disabled={Boolean(busy)} className="danger-text" onClick={()=>reviewOrder(o.id,"reject")}>驳回</button></article>)}{!loading&&!pendingOrders.length&&<Empty>目前没有待审核订单。</Empty>}</div>
    <h2 className="section-title">异常任务</h2><div className="admin-list">{loading?<Loading/>:reviews.map(j=><article key={j.request_id}><div><code>{j.request_id}</code><span>{j.provider} · {j.error_code}</span></div><button disabled={Boolean(busy)} onClick={()=>resolveJob(j.request_id,"succeeded")}>{busy===`job-${j.request_id}`?"正在处理…":"确认成功扣费"}</button><button disabled={Boolean(busy)} onClick={()=>resolveJob(j.request_id,"failed")}>确认失败释放</button></article>)}{!loading&&!reviews.length&&<Empty>目前没有需要人工复核的任务。</Empty>}</div>
    <h2 className="section-title">用户账户</h2>{loading?<Loading/>:<table><thead><tr><th>邮箱</th><th>状态</th><th>可用</th><th>冻结</th><th>操作</th></tr></thead><tbody>{users.map(u=><tr key={u.id}><td>{u.email}</td><td><Status value={u.status}/></td><td>{u.available_credits}</td><td>{u.held_credits}</td><td><button className="text-button" disabled={Boolean(busy)} onClick={()=>adjust(u)}>{busy===`user-${u.id}`?"处理中…":"人工调账"}</button> <button className="text-button" disabled={Boolean(busy)} onClick={()=>changeStatus(u)}>{u.status==="active"?"停用账户":"恢复账户"}</button></td></tr>)}</tbody></table>}
  </section>;
}

export default function App() {
  const [me, setMe] = useState(null), [loading, setLoading] = useState(true), [page, setPage] = useState("overview");
  const mainRef = useRef(null);
  const refresh = useCallback(() => api("/api/me").then(result=>setMe(result?.user && result?.wallet ? result : null)).catch(()=>setMe(null)).finally(()=>setLoading(false)),[]);
  useEffect(()=>{refresh()},[refresh]);
  useEffect(()=>{if(me)mainRef.current?.focus()},[page,me]);
  if (loading) return <div className="boot">正在核对账户…</div>;
  if (!me) return <Login onLogin={result=>setMe(result)}/>;
  const items = [["overview","overview","概览"],["recharge","recharge","充值"],["keys","key","MCP Key"],["install","install","安装向导"],...(me.user.role==="admin"?[["admin","admin","管理后台"]]:[])];
  const pages={overview:<Overview me={me}/>,recharge:<Recharge/>,keys:<Keys/>,install:<Install/>,admin:<Admin/>};
  return <><a className="skip-link" href="#main-content">跳到主要内容</a><div className="app-shell"><aside><button className="wordmark" onClick={()=>setPage("overview")}><span>W/B</span><b>WorkBuddy<br/>图片 MCP</b></button><nav aria-label="账户功能">{items.map(([id,icon,label])=><button key={id} className={page===id?"active":""} aria-current={page===id?"page":undefined} onClick={()=>setPage(id)}><Icon name={icon}/>{label}</button>)}</nav><div className="account"><span>{me.user.email}</span><button onClick={async()=>{await api("/api/auth/logout",{method:"POST"});setMe(null)}}>退出登录</button></div></aside><main id="main-content" className="content" ref={mainRef} tabIndex="-1"><div className="top-register"><span>{new Date().toLocaleDateString("zh-CN")}</span><span>ACCOUNT / {String(me.user.id).padStart(6,"0")}</span></div>{pages[page]}</main></div></>;
}
