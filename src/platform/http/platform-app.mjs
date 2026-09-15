import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { ZodError } from "zod";
import { parseGenerationRequest } from "../../shared/contracts.mjs";
import { AppError } from "../../shared/errors.mjs";
import { withTransaction } from "../db/pool.mjs";
import { buildWorkBuddyInstallPrompt } from "../installations/install-prompt.mjs";

const COOKIE_NAME = "wb_session";
const MAX_REFERENCE_BYTES = 4 * 1024 * 1024;
const MAX_PAYMENT_IMAGE_BYTES = 10 * 1024 * 1024;

function bearer(request) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization || "");
  if (!match) throw new AppError({ code: "invalid_api_key", message: "缺少个人密钥", httpStatus: 401 });
  return match[1];
}

function walletBody(wallet) {
  return { available_credits: Number(wallet.availableCredits), held_credits: Number(wallet.heldCredits) };
}

function generationBody(job) {
  return {
    request_id: job.requestId,
    status: job.state,
    ...(job.errorCode ? { error_code: job.errorCode } : {}),
    ...(job.wallet ? walletBody(job.wallet) : {})
  };
}

function clientIp(request) {
  return request.ip || request.headers["x-forwarded-for"]?.split(",")[0]?.trim() || null;
}

export function createPlatformApp({
  pool,
  authService,
  apiKeyService,
  installationTokenService,
  walletService,
  generationJobs,
  paymentService,
  proofStore,
  temporaryStore,
  rateLimiter,
  readyCheck = async () => true,
  generationAdmissionCheck = async () => true,
  publicRegistrationEnabled = false,
  cookieSecure = true,
  publicOrigin = "https://xiaoyeai.cn",
  installerVersion = "1.1.0",
  provider = "gpt-ge",
  logger = false
}) {
  const app = Fastify({ logger, trustProxy: true, bodyLimit: 12 * 1024 * 1024 });
  app.register(cookie);
  app.register(multipart, { limits: { files: 4, fileSize: MAX_PAYMENT_IMAGE_BYTES, parts: 10 } });

  async function websiteSession(request) {
    return authService.authenticateSession(request.cookies[COOKIE_NAME]);
  }

  async function websiteUser(request) { return (await websiteSession(request)).user; }

  async function keyUser(request) {
    return apiKeyService.authenticate(bearer(request));
  }

  async function adminUser(request) {
    const user = await websiteUser(request);
    if (user.role !== "admin" || user.status !== "active") throw new AppError({ code: "admin_required", message: "需要管理员权限", httpStatus: 403 });
    return user;
  }

  async function parseGenerationInput(request) {
    if (!request.isMultipart()) return { request: parseGenerationRequest(request.body), referenceObjectKeys: [] };
    let input;
    const referenceObjectKeys = [];
    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (part.fieldname !== "image") throw new AppError({ code: "invalid_reference_field", message: "参考图字段必须为 image", httpStatus: 400 });
        if (!temporaryStore) throw new AppError({ code: "reference_storage_unavailable", message: "参考图临时存储不可用", httpStatus: 503 });
        const chunks = [];
        for await (const chunk of part.file) chunks.push(chunk);
        const buffer = Buffer.concat(chunks);
        if (buffer.length > MAX_REFERENCE_BYTES) throw new AppError({ code: "reference_image_too_large", message: "每张参考图不能超过 4 MiB", httpStatus: 400 });
        const stored = await temporaryStore.putReference({ buffer, mimeType: part.mimetype, fileName: part.filename });
        referenceObjectKeys.push(stored.objectKey);
      } else if (part.fieldname === "request") {
        try { input = JSON.parse(part.value); }
        catch { throw new AppError({ code: "invalid_generation_request", message: "生成参数不是有效 JSON", httpStatus: 400 }); }
      }
    }
    return { request: parseGenerationRequest(input), referenceObjectKeys };
  }

  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/readyz", async (_request, reply) => {
    const ready = await readyCheck();
    if (!ready) return reply.code(503).send({ status: "not_ready" });
    return { status: "ready" };
  });

  app.post("/api/auth/email-code", async (request, reply) => {
    const email = String(request.body?.email || "").trim().toLowerCase();
    if (!publicRegistrationEnabled && !(await pool.query("select id from users where email=$1", [email])).rowCount) throw new AppError({ code: "registration_closed", message: "公开注册尚未开放，现有用户仍可登录", httpStatus: 403 });
    if (rateLimiter) {
      await rateLimiter.consume({ scope: "email_code_email", subject: email, limit: 3, windowMs: 60_000 });
      await rateLimiter.consume({ scope: "email_code_ip", subject: clientIp(request) || "unknown", limit: 10, windowMs: 60_000 });
    }
    await authService.requestCode({ email: request.body?.email, deviceId: request.body?.device_id, ip: clientIp(request) });
    return reply.code(202).send({ accepted: true });
  });

  app.post("/api/auth/verify", async (request, reply) => {
    const result = await authService.verifyCode({ email: request.body?.email, code: request.body?.code, deviceId: request.body?.device_id, ip: clientIp(request) });
    reply.setCookie(COOKIE_NAME, result.sessionToken, { path: "/", httpOnly: true, secure: cookieSecure, sameSite: "lax", maxAge: 30 * 24 * 60 * 60 });
    return { user: result.user, wallet: walletBody(result.wallet) };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    await authService.logout(request.cookies[COOKIE_NAME]);
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return { logged_out: true };
  });

  app.get("/api/me", async (request) => {
    const user = await websiteUser(request);
    return { user, wallet: walletBody(await walletService.getBalance(user.id)) };
  });
  app.get("/api/wallet", async (request) => walletBody(await walletService.getBalance((await websiteUser(request)).id)));
  app.get("/api/ledger", async (request) => {
    const user = await websiteUser(request);
    const rows = await pool.query("select id,event_type,amount,reference_type,reference_id,created_at from ledger_entries where user_id=$1 order by created_at desc,id desc limit 100", [user.id]);
    return { entries: rows.rows };
  });
  app.get("/api/generations", async (request) => {
    const user = await websiteUser(request);
    const rows = await pool.query("select request_id,state,error_code,created_at,completed_at from generation_jobs where user_id=$1 order by created_at desc,id desc limit 100", [user.id]);
    return { generations: rows.rows };
  });

  app.get("/api/api-keys", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return { keys: await apiKeyService.list((await websiteUser(request)).id) };
  });
  app.post("/api/api-keys", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return reply.code(201).send(await apiKeyService.create({ userId: (await websiteUser(request)).id, name: request.body?.name }));
  });
  app.delete("/api/api-keys/:id", async (request) => apiKeyService.revoke({ userId: (await websiteUser(request)).id, keyId: request.params.id }));

  app.post("/api/api-keys/:id/installation-token", async (request, reply) => {
    if (!installationTokenService) throw new AppError({ code: "installations_unavailable", message: "自动安装服务暂不可用", httpStatus: 503 });
    const session = await websiteSession(request);
    if (rateLimiter) await rateLimiter.consume({ scope: "installation_token", subject: String(session.user.id), limit: 3, windowMs: 60_000 });
    const issued = await installationTokenService.create({ userId: session.user.id, sessionId: session.sessionId, apiKeyId: request.params.id });
    reply.header("Cache-Control", "no-store");
    return reply.code(201).send({
      prompt: buildWorkBuddyInstallPrompt({ installationToken: issued.token, version: installerVersion, origin: publicOrigin }),
      expires_at: issued.expiresAt
    });
  });

  app.post("/v1/installations/exchange", async (request, reply) => {
    if (!installationTokenService) throw new AppError({ code: "installations_unavailable", message: "自动安装服务暂不可用", httpStatus: 503 });
    const exchanged = await installationTokenService.exchange(request.body?.installation_token);
    reply.header("Cache-Control", "no-store");
    return { api_key: exchanged.apiKey, gateway_url: publicOrigin };
  });

  app.get("/api/recharge-packages", async () => {
    const rows = await pool.query("select id,name,price_fen,credits from recharge_packages where active=true order by sort_order,id");
    return { packages: rows.rows };
  });
  app.get("/api/payment-instructions", async () => {
    if (!paymentService) throw new AppError({ code: "payments_unavailable", message: "充值服务暂不可用", httpStatus: 503 });
    return { channels: await paymentService.createInstructions() };
  });
  app.get("/api/recharge-orders", async (request) => {
    const user = await websiteUser(request);
    const rows = await pool.query("select id,order_no,package_name,price_fen,credits,state,note,expires_at,created_at from recharge_orders where user_id=$1 order by created_at desc,id desc", [user.id]);
    return { orders: rows.rows };
  });
  app.post("/api/recharge-orders", async (request, reply) => {
    if (!paymentService) throw new AppError({ code: "payments_unavailable", message: "充值服务暂不可用", httpStatus: 503 });
    return reply.code(201).send(await paymentService.createOrder({ userId: (await websiteUser(request)).id, packageId: request.body?.package_id }));
  });
  app.post("/api/recharge-orders/:id/proof", async (request) => {
    if (!paymentService) throw new AppError({ code: "payments_unavailable", message: "充值服务暂不可用", httpStatus: 503 });
    const user = await websiteUser(request);
    const part = await request.file();
    if (!part) throw new AppError({ code: "invalid_payment_proof", message: "请选择付款凭证图片", httpStatus: 400 });
    const chunks = [];
    for await (const chunk of part.file) chunks.push(chunk);
    return paymentService.submitProof({ userId: user.id, orderId: request.params.id, buffer: Buffer.concat(chunks), mimeType: part.mimetype, note: part.fields?.note?.value });
  });

  app.get("/api/admin/recharge-orders", async (request) => {
    await adminUser(request);
    const rows = await pool.query("select o.*,u.email,p.object_key as proof_object_key from recharge_orders o join users u on u.id=o.user_id left join payment_proofs p on p.order_id=o.id order by o.created_at desc,o.id desc limit 200");
    return { orders: await Promise.all(rows.rows.map(async (row) => ({ ...row, proof_url: row.proof_object_key && proofStore?.signedUrl ? await proofStore.signedUrl(row.proof_object_key, 300) : null, proof_object_key: undefined }))) };
  });
  app.post("/api/admin/recharge-orders/:id/approve", async (request) => {
    if (!paymentService) throw new AppError({ code: "payments_unavailable", message: "充值服务暂不可用", httpStatus: 503 });
    return paymentService.approve({ adminId: (await adminUser(request)).id, orderId: request.params.id });
  });
  app.post("/api/admin/recharge-orders/:id/reject", async (request) => {
    if (!paymentService) throw new AppError({ code: "payments_unavailable", message: "充值服务暂不可用", httpStatus: 503 });
    return paymentService.reject({ adminId: (await adminUser(request)).id, orderId: request.params.id, reason: request.body?.reason });
  });
  app.post("/api/admin/recharge-packages", async (request, reply) => {
    const admin = await adminUser(request);
    const { name, price_fen: priceFen, credits, sort_order: sortOrder = 0 } = request.body || {};
    if (!String(name || "").trim() || !Number.isInteger(priceFen) || priceFen <= 0 || !Number.isInteger(credits) || credits <= 0) throw new AppError({ code: "invalid_recharge_package", message: "套餐名称、金额和额度无效", httpStatus: 400 });
    const row = await withTransaction(pool, async (client) => {
      const saved = (await client.query("insert into recharge_packages(name,price_fen,credits,sort_order) values($1,$2,$3,$4) returning *", [String(name).trim(), priceFen, credits, Number(sortOrder) || 0])).rows[0];
      await client.query("insert into audit_events(actor_user_id,action,target_type,target_id,reason) values($1,'create_recharge_package','recharge_package',$2,$3)", [admin.id, String(saved.id), `创建套餐：${saved.name}`]);
      return saved;
    });
    return reply.code(201).send(row);
  });
  app.get("/api/admin/recharge-packages", async (request) => {
    await adminUser(request);
    return { packages: (await pool.query("select * from recharge_packages order by sort_order,id")).rows };
  });
  app.patch("/api/admin/recharge-packages/:id", async (request) => {
    const admin = await adminUser(request);
    const existing = (await pool.query("select * from recharge_packages where id=$1", [request.params.id])).rows[0];
    if (!existing) throw new AppError({ code: "recharge_package_not_found", message: "充值套餐不存在", httpStatus: 404 });
    const name = String(request.body?.name ?? existing.name).trim();
    const priceFen = Number(request.body?.price_fen ?? existing.price_fen);
    const credits = Number(request.body?.credits ?? existing.credits);
    const sortOrder = Number(request.body?.sort_order ?? existing.sort_order);
    if (!name || !Number.isInteger(priceFen) || priceFen <= 0 || !Number.isInteger(credits) || credits <= 0 || !Number.isInteger(sortOrder)) throw new AppError({ code: "invalid_recharge_package", message: "套餐名称、金额、额度或排序无效", httpStatus: 400 });
    return withTransaction(pool, async (client) => {
      const row = (await client.query("update recharge_packages set name=$2,price_fen=$3,credits=$4,active=$5,sort_order=$6,updated_at=now() where id=$1 returning *", [existing.id, name, priceFen, credits, request.body?.active ?? existing.active, sortOrder])).rows[0];
      await client.query("insert into audit_events(actor_user_id,action,target_type,target_id,reason) values($1,'update_recharge_package','recharge_package',$2,$3)", [admin.id, String(row.id), `更新套餐：${row.name}`]);
      return row;
    });
  });
  app.post("/api/admin/payment-channels", async (request, reply) => {
    const admin = await adminUser(request);
    if (!proofStore) throw new AppError({ code: "payments_unavailable", message: "付款渠道存储不可用", httpStatus: 503 });
    const part = await request.file();
    if (!part) throw new AppError({ code: "invalid_payment_qr", message: "请上传收款码图片", httpStatus: 400 });
    const chunks = [];
    for await (const chunk of part.file) chunks.push(chunk);
    const name = part.fields?.name?.value || "收款码";
    const stored = await proofStore.put({ orderNo: `channel-${Date.now()}`, buffer: Buffer.concat(chunks), mimeType: part.mimetype });
    const row = await withTransaction(pool, async (client) => {
      const saved = (await client.query("insert into payment_channels(provider,name,qr_object_key,instructions) values('manual_qr',$1,$2,$3) returning *", [String(name).slice(0, 80), stored.objectKey, String(part.fields?.instructions?.value || "").slice(0, 500) || null])).rows[0];
      await client.query("insert into audit_events(actor_user_id,action,target_type,target_id,reason) values($1,'create_payment_channel','payment_channel',$2,$3)", [admin.id, String(saved.id), `创建收款渠道：${saved.name}`]);
      return saved;
    });
    return reply.code(201).send(row);
  });
  app.get("/api/admin/payment-channels", async (request) => {
    await adminUser(request);
    return { channels: (await pool.query("select id,provider,name,instructions,active,sort_order from payment_channels order by sort_order,id")).rows };
  });
  app.patch("/api/admin/payment-channels/:id", async (request) => {
    const admin = await adminUser(request);
    const existing = (await pool.query("select * from payment_channels where id=$1", [request.params.id])).rows[0];
    if (!existing) throw new AppError({ code: "payment_channel_not_found", message: "收款渠道不存在", httpStatus: 404 });
    return withTransaction(pool, async (client) => {
      const row = (await client.query("update payment_channels set name=$2,instructions=$3,active=$4,sort_order=$5,updated_at=now() where id=$1 returning id,provider,name,instructions,active,sort_order", [existing.id, request.body?.name ?? existing.name, request.body?.instructions ?? existing.instructions, request.body?.active ?? existing.active, request.body?.sort_order ?? existing.sort_order])).rows[0];
      await client.query("insert into audit_events(actor_user_id,action,target_type,target_id,reason) values($1,'update_payment_channel','payment_channel',$2,$3)", [admin.id, String(row.id), `更新收款渠道：${row.name}`]);
      return row;
    });
  });
  app.get("/api/admin/users", async (request) => {
    await adminUser(request);
    const rows = await pool.query("select u.id,u.email,u.status,u.role,u.created_at,w.available_credits,w.held_credits from users u join wallets w on w.user_id=u.id order by u.created_at desc limit 200");
    return { users: rows.rows };
  });
  app.patch("/api/admin/users/:id", async (request) => {
    const admin = await adminUser(request);
    const status = request.body?.status;
    const reason = String(request.body?.reason || "").trim();
    if (!new Set(["active", "suspended"]).has(status) || !reason) throw new AppError({ code: "invalid_user_status_change", message: "账户状态和变更原因无效", httpStatus: 400 });
    if (String(admin.id) === String(request.params.id) && status === "suspended") throw new AppError({ code: "cannot_suspend_self", message: "管理员不能停用自己的账户", httpStatus: 409 });
    return withTransaction(pool, async (client) => {
      const user = (await client.query("update users set status=$2,updated_at=now() where id=$1 returning id,email,status,role,created_at", [request.params.id, status])).rows[0];
      if (!user) throw new AppError({ code: "user_not_found", message: "用户不存在", httpStatus: 404 });
      await client.query("insert into audit_events(actor_user_id,action,target_type,target_id,reason) values($1,'change_user_status','user',$2,$3)", [admin.id, String(user.id), reason.slice(0, 500)]);
      return user;
    });
  });
  app.get("/api/admin/metrics", async (request) => {
    await adminUser(request);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [states, oldestQueued, recentTerminals, invalidWallets] = await Promise.all([
      pool.query("select state,count(*)::int as count from generation_jobs group by state"),
      pool.query("select created_at from generation_jobs where state='queued' order by created_at,id limit 1"),
      pool.query("select state,error_code,count(*)::int as count from generation_jobs where completed_at>=$1 and state in ('succeeded','failed') group by state,error_code", [since]),
      pool.query("select count(*)::int as count from wallets where available_credits<0 or held_credits<0")
    ]);
    const stateCounts = Object.fromEntries(states.rows.map((row) => [row.state, Number(row.count)]));
    const terminalCount = recentTerminals.rows.reduce((sum, row) => sum + Number(row.count), 0);
    const succeeded = recentTerminals.rows.filter((row) => row.state === "succeeded").reduce((sum, row) => sum + Number(row.count), 0);
    const providerFailures = recentTerminals.rows.filter((row) => row.state === "failed" && String(row.error_code || "").startsWith("provider_")).reduce((sum, row) => sum + Number(row.count), 0);
    return {
      state_counts: stateCounts,
      queue_oldest_wait_seconds: oldestQueued.rowCount ? Math.max(0, Math.round((Date.now() - new Date(oldestQueued.rows[0].created_at).getTime()) / 1000)) : 0,
      generation_success_rate_24h: terminalCount ? succeeded / terminalCount : null,
      provider_error_rate_24h: terminalCount ? providerFailures / terminalCount : null,
      wallet_invariant_violations: Number(invalidWallets.rows[0].count)
    };
  });
  app.post("/api/admin/users/:id/adjust-credits", async (request) => {
    const admin = await adminUser(request);
    return walletBody(await walletService.adjust({ userId: request.params.id, amount: request.body?.amount, adminId: admin.id, reason: request.body?.reason, referenceId: request.headers["idempotency-key"] }));
  });
  app.get("/api/admin/manual-reviews", async (request) => {
    await adminUser(request);
    const rows = await pool.query("select request_id,user_id,provider,upstream_task_id,output_object_key,error_code,unknown_since,updated_at from generation_jobs where state='manual_review' order by unknown_since,id");
    return { generations: rows.rows };
  });
  app.post("/api/admin/manual-reviews/:requestId/resolve", async (request) => {
    const admin = await adminUser(request);
    const job = (await pool.query("select * from generation_jobs where request_id=$1 and state='manual_review'", [request.params.requestId])).rows[0];
    if (!job) throw new AppError({ code: "generation_not_reviewable", message: "任务不存在或已完成复核", httpStatus: 409 });
    if (!String(request.body?.reason || "").trim()) throw new AppError({ code: "review_reason_required", message: "人工复核必须填写原因", httpStatus: 400 });
    if (request.body?.outcome === "succeeded") {
      if (!job.output_object_key || !temporaryStore || !(await temporaryStore.exists(job.output_object_key))) throw new AppError({ code: "output_not_persisted", message: "没有可靠保存的图片，不能确认成功扣费", httpStatus: 409 });
      await generationJobs.succeed({ requestId: job.request_id });
    } else if (request.body?.outcome === "failed") await generationJobs.fail({ requestId: job.request_id, errorCode: "manual_review_failed" });
    else throw new AppError({ code: "invalid_review_outcome", message: "复核结果必须是 succeeded 或 failed", httpStatus: 400 });
    await pool.query("insert into audit_events(actor_user_id,action,target_type,target_id,reason) values($1,$2,'generation',$3,$4)", [admin.id, `manual_${request.body.outcome}`, job.request_id, String(request.body.reason).trim()]);
    return generationBody(await generationJobs.getForUser({ userId: job.user_id, requestId: job.request_id }));
  });

  const generationHandler = async (request, reply) => {
    const identity = await keyUser(request);
    if (!(await generationAdmissionCheck())) throw new AppError({ code: "generation_temporarily_paused", message: "生成服务正在进行账务检查，请稍后重试", httpStatus: 503, retryable: true });
    const input = await parseGenerationInput(request);
    const job = await generationJobs.enqueue({
      userId: identity.userId,
      idempotencyKey: request.headers["idempotency-key"],
      provider,
      ...input,
      beforeCreate: rateLimiter ? (client) => rateLimiter.consume({ scope: "generation", subject: identity.userId, limit: 5, windowMs: 60_000, queryable: client }) : undefined
    });
    const current = await generationJobs.getForUser({ userId: identity.userId, requestId: job.requestId });
    return reply.code(current.state === "succeeded" || current.state === "failed" ? 200 : 202).send(generationBody(current));
  };
  app.post("/v1/generations", generationHandler);
  app.post("/v1/bridge/generations", generationHandler);
  app.get("/v1/generations/:requestId", async (request) => {
    const identity = await keyUser(request);
    if (rateLimiter) await rateLimiter.consume({ scope: "key_query", subject: identity.keyId, limit: 60, windowMs: 60_000 });
    const job = await generationJobs.getForUser({ userId: identity.userId, requestId: request.params.requestId });
    const body = generationBody(job);
    if (job.state === "succeeded" && job.outputObjectKey && temporaryStore?.getSignedOutput) {
      const retentionEndsAt = job.completedAt ? new Date(job.completedAt).getTime() + 24 * 60 * 60 * 1000 : 0;
      if (retentionEndsAt > Date.now() && (!temporaryStore.exists || await temporaryStore.exists(job.outputObjectKey))) {
        body.image_url = await temporaryStore.getSignedOutput(job.outputObjectKey, 600);
        body.expires_at = new Date(Math.min(retentionEndsAt, Date.now() + 600_000)).toISOString();
      } else body.output_expired = true;
    }
    return body;
  });
  app.get("/v1/account/balance", async (request) => {
    const identity = await keyUser(request);
    if (rateLimiter) await rateLimiter.consume({ scope: "key_query", subject: identity.keyId, limit: 60, windowMs: 60_000 });
    return walletBody(await walletService.getBalance(identity.userId));
  });

  app.setErrorHandler((error, request, reply) => {
    let safe = error;
    if (error instanceof ZodError) safe = new AppError({ code: "invalid_generation_request", message: error.issues[0]?.message || "生成参数无效", httpStatus: 400 });
    else if (!(error instanceof AppError)) {
      if (error?.code === "FST_FILES_LIMIT") safe = new AppError({ code: "too_many_reference_images", message: "最多只能上传 4 张参考图", httpStatus: 400 });
      else if (error?.code === "FST_REQ_FILE_TOO_LARGE") safe = request.url.includes("/proof") || request.url.includes("payment-channels")
        ? new AppError({ code: "invalid_payment_proof", message: "付款图片不能超过 10 MiB", httpStatus: 400 })
        : new AppError({ code: "reference_image_too_large", message: "每张参考图不能超过 4 MiB", httpStatus: 400 });
      else safe = new AppError({ code: "internal_error", message: "服务暂时不可用，请稍后重试", httpStatus: 500 });
    }
    reply.code(safe.httpStatus).send({ error: { code: safe.code, message: safe.message } });
  });

  return app;
}
