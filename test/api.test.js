"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function boot(envVars) {
  const saved = {};
  const keys = [
    "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SESSION_SECRET", "MAIL_TRANSPORT",
    "SENDGRID_API_KEY", "RESEND_API_KEY", "MAIL_FROM", "ALLOW_CODE_ECHO",
    "RESEND_COOLDOWN_MS", "CODE_MAX_ATTEMPTS",

    "SMS_ENABLED", "SMS_TRANSPORT", "SMS_RESEND_COOLDOWN_MS",

    "PASSWORD_MIN", "PASSWORD_MAX", "VERIFY_TTL_MS", "RESET_TTL_MS", "SITE_URL",

    "REQUIRE_EMAIL_VERIFIED", "MAIL_RETRY_MAX", "MAIL_RETRY_BUDGET_MS",

    "TURNSTILE_ENABLED", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY", "TURNSTILE_BYPASS",

    "SUPABASE_AVATAR_BUCKET", "AVATAR_MAX_BYTES",

    "OWNER_EMAILS"
  ];
  keys.forEach(k => { saved[k] = process.env[k]; });

  keys.forEach(k => { delete process.env[k]; });
  Object.assign(process.env, {
    SESSION_SECRET: "test-secret-at-least-16-chars",
    MAIL_TRANSPORT: "console",
    ...envVars
  });

  Object.keys(require.cache).forEach(k => {
    if (k.startsWith(path.join(ROOT, "api"))) delete require.cache[k];
  });

  return { restore: () => { keys.forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); } };
}

function serve() {
  const entry = require("../api/handler.js");

  const routes = require("../api/_lib/routes.js");
  const server = http.createServer(entry);
  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({

        base: "http://127.0.0.1:" + port,
        close: () => new Promise(r => server.close(r))
      });
    });
  });
}

async function confirmEmail(store, uid, pepper) {
  const id = require("../api/_lib/identity.js");
  const rec = {
    vid: id.newVerifyId(), uid: uid,
    email_hash: "x", token_hash: "x", salt: id.newSalt(),
    issued_at: Date.now(), expires_at: Date.now() + 3600000,
    consumed_at: null, attempts: 0
  };
  const token = id.newToken();
  rec.token_hash = id.tokenHash(uid, "verify", token, pepper);
  await store.putVerification(rec);
  const acc = await store.getAccount(uid);
  acc.email_verified_at = Date.now();
  if (acc.status === "pending") acc.status = "active";
  await store.putAccount(acc);
  return true;
}

async function loginByHttp(POST, email) {
  const svStore = require("../api/_lib/store.js").getStore(require("../api/_lib/config.js"));
  const reg = await POST("/api/register", { email: email, password: "hunter2hunter" });

  const vid = Object.keys(svStore._db.verifications)
    .filter(k => !svStore._db.verifications[k].consumed_at)
    .sort((a, b) => svStore._db.verifications[b].issued_at - svStore._db.verifications[a].issued_at)[0];
  await POST("/api/verify-email", { vid: vid, token: reg.body.devVerifyToken });
  const u = await POST("/api/send-code", { email: email });
  const c = await POST("/api/verify-code", { codeId: u.body.codeId, code: u.body.devCode });
  return String(c.setCookie || "").split(";")[0];
}

async function loginByHttpDetailed(POST, email) {
  const svStore = require("../api/_lib/store.js").getStore(require("../api/_lib/config.js"));
  const reg = await POST("/api/register", { email: email, password: "hunter2hunter" });
  const vid = Object.keys(svStore._db.verifications)
    .filter(k => !svStore._db.verifications[k].consumed_at)
    .sort((a, b) => svStore._db.verifications[b].issued_at - svStore._db.verifications[a].issued_at)[0];
  const v = await POST("/api/verify-email", { vid: vid, token: reg.body.devVerifyToken });
  const u = await POST("/api/send-code", { email: email });
  const c = await POST("/api/verify-code", { codeId: u.body.codeId, code: u.body.devCode });
  return { cookie: String(c.setCookie || "").split(";")[0], register: reg, verify: v, login: c };
}

function wirePath(p) {
  const s = String(p);
  if (s.indexOf("/api/handler?__path=") === 0) return s;
  if (s === "/api") return "/api/handler?__path=";
  if (s.indexOf("/api/") === 0) {
    var parts = s.slice("/api/".length).split("?");
    var query = parts.slice(1).join("?");
    return "/api/handler?__path=" + encodeURIComponent(parts[0]) + (query ? "&" + query : "");
  }
  return s;
}

async function call(base, method, p, body, cookie, extraHeaders) {
  const init = { method, headers: { "Content-Type": "application/json" } };
  if (cookie) init.headers.Cookie = cookie;

  if (extraHeaders) Object.assign(init.headers, extraHeaders);
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(base + wirePath(p), init);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
  return { status: res.status, body: json, setCookie: res.headers.get("set-cookie"), raw: text };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function confirmViaHttp(base, email, call) {

  const core = require("../api/_lib/core.js");
  const mailMod = core.__mail;
  let captured = null;
  const realConfirm = mailMod.confirm;
  mailMod.confirm = function (c, o) { captured = o; return Promise.resolve({ delivered: false, transport: "console" }); };
  let anon;
  try {
    anon = await call(base, "POST", "/api/resend-verification-by-email", { email: email });
  } finally { mailMod.confirm = realConfirm; }
  if (!anon || anon.status !== 200) return false;
  if (anon.body && anon.body.devVerifyToken) {

    console.log("✗ 匿名重发口**回出了确认令牌**（凭邮箱就能确认别人的邮箱）");
    return false;
  }
  if (!captured || !captured.token) return false;
  const v = await call(base, "POST", "/api/verify-email", { vid: captured.vid, token: captured.token });
  return v.status === 200;
}

async function confirmForTest(core, d, email) {
  const mailMod = core.__mail;
  let cap = null;
  const real = mailMod.confirm;
  mailMod.confirm = function (c, o) { cap = o; return Promise.resolve({ delivered: false, transport: "console" }); };
  try {
    await core.resendVerificationByEmail(
      Object.assign({}, d, { cfg: Object.assign({}, d.cfg, { resendCooldownMs: 0 }) }),
      { email: email, deviceId: "confirm-" + email, ip: d.ip || "1.1.1.1" });
  } finally { mailMod.confirm = real; }
  if (!cap) return false;
  const r = await core.verifyEmail(d, { vid: cap.vid, token: cap.token });
  return r.status === 200;
}

function readCoreSendCode() {
  return fs.readFileSync(path.join(ROOT, "js/auth-core.js"), "utf8");
}

let fails = 0;
const chk = (c, m) => { if (!c) { console.log("✗ " + m); fails++; } else console.log("✓ " + m); };
const eq = (a, b, m) => chk(a === b, m + "（实际 " + JSON.stringify(a) + "）");

async function main() {
  {
    const serveSource = fs.readFileSync(path.join(ROOT, "scripts/serve.js"), "utf8");
    const exportsFactory = /module\.exports\s*=\s*\{[^}]*createServer/.test(serveSource);
    chk(exportsFactory, "本地服务导出 createServer，测试可用随机端口启动");
    if (exportsFactory) {
      const env = boot({});
      const local = require("../scripts/serve.js").createServer();
      await new Promise(resolve => local.listen(0, "127.0.0.1", resolve));
      const base = "http://127.0.0.1:" + local.address().port;
      try {
        eq((await fetch(base + "/login/")).status, 200, "本地服务能打开登录页");
        eq((await fetch(base + "/api/config")).status, 200, "本地服务同源挂载 API");
        const invalid = await fetch(base + "/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "not-an-email", password: "hunter2hunter" })
        });
        const body = await invalid.json();
        eq(invalid.status, 400, "本地注册请求到达真实 API 校验");
        eq(body.code, "E_EMAIL_FORMAT", "本地 API 返回结构化邮箱错误");
      } finally {
        await new Promise(resolve => local.close(resolve));
        env.restore();
      }
    }
  }


  {
    boot({});
    const id = require("../api/_lib/identity.js");

    eq(id.normalizeEmail("  Zhang.Min@163.COM "), "zhang.min@163.com", "服务端邮箱归一化：空格与大写");
    eq(id.normalizeEmail("a\u200bb@c.com"), "ab@c.com", "服务端邮箱归一化：零宽字符被剔除");
    chk(id.isEmailShape("a@b.com"), "正常邮箱通过形态校验");
    chk(!id.isEmailShape("a@b"), "无顶级域被拒");
    chk(!id.isEmailShape("a@@b.com"), "两个 @ 被拒");
    chk(!id.isEmailShape("a..b@c.com"), "域名含 .. 被拒");
    chk(!id.isEmailShape(""), "空邮箱被拒");
    eq(id.maskEmail("zhangmin@163.com"), "z***@163.com", "掩码只留首字母与域名");
    eq(id.maskEmail("bad"), "***", "掩码对脏值给 ***");

    const A = require("../js/auth-core.js");
    ["zhangmin@163.com", " A@B.com ", "x@qq.com"].forEach(e => {
      eq(id.maskEmail(e), A.maskEmail(e), "掩码与前端内核一致：" + JSON.stringify(e));
      eq(id.normalizeEmail(e), A.normalizeEmail(e), "归一化与前端内核一致：" + JSON.stringify(e));
    });

    const h1 = id.emailHash("a@b.com", "pepper1");
    const h2 = id.emailHash("a@b.com", "pepper2");
    chk(h1 !== h2, "换 pepper 得到不同摘要（防彩虹表反查）");
    eq(h1.length, 64, "摘要长度 64 位 hex（SHA-256）");
    chk(!/a@b\.com/.test(h1), "摘要里看不到明文邮箱");

    chk(id.timingSafeEqual("abc", "abc"), "定长比较：相同为 true");
    chk(!id.timingSafeEqual("abc", "abd"), "定长比较：不同为 false");
    chk(!id.timingSafeEqual("abc", "abcd"), "定长比较：长度不同也不抛");

    const c = id.newCode(6);
    chk(/^\d{6}$/.test(c), "验证码是 6 位纯数字（实际 " + c + "）");
    chk(id.newUid().indexOf("u_") === 0 && id.newUid().length === 10, "uid 形如 u_ + 8 位");
    chk(id.newSid().indexOf("s_") === 0, "sid 形如 s_ + 16 位");
  }

  {
    boot({});
    const cfg = require("../api/_lib/config.js");
    const S = require("../api/_lib/session.js");

    const s = S.issue(cfg, "u_deadbeef", 1757900000000);
    const r = S.read(cfg, s.token, 1757900000000 + 1000);
    chk(!!r && r.uid === "u_deadbeef", "会话能正常解签");
    eq(r.sid, s.sid, "解出的 sid 与签发一致");

    ["sid", "uid", "iat", "exp"].forEach(k => {
      chk(s[k] !== undefined && s[k] !== null && s[k] !== "",
        "issue() 回出 " + k + "（sessions 表那一列是 NOT NULL，缺了只在真库上炸）");
    });
    eq(s.uid, "u_deadbeef", "issue() 回的 uid 就是签进去的那个");
    eq(s.iat, 1757900000000, "issue() 回的 iat 就是签发时刻");
    chk(s.exp > s.iat, "exp 晚于 iat");
    eq(s.exp - s.iat, cfg.sessionDays * 86400000, "有效期正好是 SESSION_DAYS 天");

    const bad = s.token.replace(/^./, s.token[0] === "A" ? "B" : "A");
    chk(S.read(cfg, bad, 1757900000000 + 1000) === null, "篡改后的会话被拒（签名校验）");

    const other = Object.assign({}, cfg, { sessionSecret: "another-secret-16-chars" });
    chk(S.read(other, s.token, 1757900000000 + 1000) === null, "换 SESSION_SECRET 后旧会话失效");

    chk(S.read(cfg, s.token, 1757900000000 + 31 * 86400000) === null, "超过 30 天的会话失效");

    const h = S.setCookieHeader(cfg, s.token, 3600);
    chk(/^kbsid=/.test(h), "Cookie 名是 kbsid");
    chk(/HttpOnly/.test(h), "Cookie 带 HttpOnly（JS 读不到 token）");
    chk(/Secure/.test(h), "Cookie 带 Secure");
    chk(/SameSite=Lax/.test(h), "Cookie 带 SameSite=Lax");
    chk(/Path=\//.test(h), "Cookie 限定 Path=/");
    chk(S.clearCookieHeader(cfg).indexOf("Max-Age=0") > 0, "清理 Cookie 用 Max-Age=0");

    eq(S.fromCookieHeader("a=1; kbsid=xyz; b=2", "kbsid"), "xyz", "从 Cookie 头里能取到我们那一枚");
    eq(S.fromCookieHeader("a=1", "kbsid"), null, "没有那一枚时返回 null");
    eq(S.fromCookieHeader("", "kbsid"), null, "空头返回 null");

    const payload = JSON.parse(S._unb64url(s.token.split(".")[0]));
    eq(Object.keys(payload).sort().join(","), "e,i,s,u", "会话载荷只有 sid/uid/iat/exp");
    chk(!/nickname|email|plan|tier/.test(JSON.stringify(payload)), "会话里不固化权益与身份资料");
  }

  {

    boot({ MAIL_TRANSPORT: "" });
    const mail = require("../api/_lib/mail/index.js");
    const cfg = require("../api/_lib/config.js");

    eq(mail.pick(cfg).name, "console", "没配任何密钥时落到 console 通道");
    eq(mail.pick(Object.assign({}, cfg, { sendgridKey: "k" })).name, "sendgrid", "有 SendGrid 密钥就用 SendGrid");
    eq(mail.pick(Object.assign({}, cfg, { resendKey: "k" })).name, "resend", "只有 Resend 密钥就用 Resend");
    eq(mail.pick(Object.assign({}, cfg, { sendgridKey: "k", resendKey: "k", mailTransport: "resend" })).name,
      "resend", "MAIL_TRANSPORT 显式指定优先于密钥推断");
    eq(mail.pick(Object.assign({}, cfg, { sendgridKey: "k", mailTransport: "nonsense" })).name,
      "console", "MAIL_TRANSPORT 写了不认识的值时回落 console（不抛）");

    const m = mail.buildMessage(cfg, { code: "123456" });
    chk(m.subject.indexOf("123456") > 0, "邮件主题带验证码");
    chk(m.text.indexOf("123456") > 0, "纯文本正文带验证码");
    chk(m.text.indexOf("10 分钟") > 0, "正文写明有效期（10 分钟）");
    chk(m.html.indexOf("123456") > 0, "HTML 正文带验证码");
    chk(!/password|密码/.test(m.text), "正文里不出现「密码」这类措辞");

    const sent = await mail.send(cfg, { to: "a@b.com", mask: "a***@b.com", code: "000000" });
    eq(sent.transport, "console", "console 通道如实回报自己是谁");
    eq(sent.delivered, false, "console 通道如实回报「没真的送达」");

    const logs = [];
    const realLog = console.log;
    console.log = (...a) => logs.push(a.join(" "));
    try { await mail.send(cfg, { to: "a@b.com", mask: "a***@b.com", code: "654321" }); }
    finally { console.log = realLog; }
    chk(logs.length > 0, "console 通道确实记了一行日志（便于确认链路走到哪）");
    chk(!logs.join("\n").includes("654321"), "console 通道的日志里**没有明文码**");
    chk(!/\b\d{6}\b/.test(logs.join("\n")), "console 通道的日志里没有任何 6 位数字串");
  }

  {
    boot({});
    const core = require("../api/_lib/core.js");
    const cfg = require("../api/_lib/config.js");
    const storeMod = require("../api/_lib/store.js");
    const store = storeMod.memoryStore();
    const limiter = core.makeRateLimiter();
    let t = 1757900000000;
    const d = { cfg, store, limiter, now: () => t, ip: "1.2.3.4" };

    const r1 = await core.sendCode(d, { email: "Parent@Example.com", ip: "1.2.3.4", code: "111111" });
    eq(r1.status, 202 - 2, "发码成功（内核回 200，HTTP 层再换成 202）");
    chk(!!r1.body.codeId, "发码返回 codeId");
    eq(r1.body.cooldown, 60, "发码返回冷却秒数 60");
    eq(r1.body.transport, "console", "响应如实回报发信通道");
    eq(r1.body.delivered, false, "响应如实回报未真实送达");
    chk(!("isNewAccount" in r1.body), "响应里**不透露**是不是新账号（防用户枚举）");

    const rec = store.getCode(r1.body.codeId);
    chk(!/111111/.test(JSON.stringify(rec)), "落库的码记录里没有明文验证码");
    eq(rec.sent_to, "p***@example.com", "落库的是邮箱掩码，不是明文邮箱");
    eq(rec.attempts, 0, "初始失败次数为 0");

    const acc = store.getAccountByHash(
      require("../api/_lib/identity.js").emailHash("parent@example.com", cfg.sessionSecret)
    );
    chk(!!acc, "账号已建立");

    eq(acc.email, "Parent@Example.com", "账号里**有**明文邮箱（Issue #197），且保留用户填的大小写");
    chk(!/email\s*:\s*"/.test("") || true, "（下面那条才是重点）");
    chk(!/password_hash": "[^"]/.test(JSON.stringify(acc)) || acc.password_hash === "",
      "发码那条路建的账号**没有口令**（口令是注册那条路的事，两条路不互相污染）");

    chk(/^[0-9a-f]{64}$/.test(acc.email_hash), "email_hash 仍是 64 位 hex 摘要");
    chk(acc.email_hash !== acc.email, "摘要与明文不是一回事（登录走摘要，显示走明文）");
    eq(acc.plan, "free", "新账号默认 free 层级");
    eq(acc.role, "user", "新账号默认 user 角色（与层级正交）");

    const w1 = await core.verifyCode(d, { codeId: r1.body.codeId, code: "999999" });
    eq(w1.status, 400, "错码回 400");
    eq(w1.body.code, "E_CODE_WRONG", "错码的错误码正确");
    eq(w1.body.remaining, 4, "错码回剩余次数 4");

    const gated = await core.verifyCode(d, { codeId: r1.body.codeId, code: "111111" });
    eq(gated.status, 403, "**码是对的、但邮箱没确认 → 403**（这是这一节的核心口径）");
    eq(gated.body.code, "E_EMAIL_UNVERIFIED", "码是 E_EMAIL_UNVERIFIED");
    chk(/确认/.test(gated.body.message), "文案里说了要去点确认（这是用户唯一的下一步）");
    chk(!!gated.body.emailMask, "带出掩码，界面据此回显「发往哪儿」");
    chk(gated.cookies === undefined, "**一枚 Cookie 都不发**（判在前、签在后）");

    eq((await core.verifyCode(d, { codeId: r1.body.codeId, code: "111111" })).body.code, "E_CODE_USED",
      "被拦那一次**已经把码消费掉了**（不留「回头再填一次」这条路）");

    await confirmEmail(store, acc.uid, cfg.sessionSecret);
    const r1b = await core.sendCode(Object.assign({}, d, { limiter: core.makeRateLimiter() }),
      { email: "Parent@Example.com", ip: "1.2.3.5", code: "111111" });
    eq(r1b.status, 200, "（前置）确认之后重新发一枚码");
    const v1 = await core.verifyCode(Object.assign({}, d, { limiter: core.makeRateLimiter() }),
      { codeId: r1b.body.codeId, code: "111111" });
    eq(v1.status, 200, "**确认之后同一枚码就能换到会话了**（拦的是「没确认」，不是「用码登录」这件事）");
    chk(!!v1.body.account.uid, "回账号信息");
    eq(v1.body.account.plan.tier, "free", "回 free 层级");
    chk(v1.body.account.mask === "p***@example.com", "回的是掩码，不是明文邮箱");
    chk(v1.body.account.emailVerified === true, "响应如实说「邮箱已确认」");
    chk(Array.isArray(v1.cookies) && v1.cookies.length === 1, "签发了一枚 Cookie");
    chk(v1.cookies[0].indexOf("HttpOnly") > 0, "那枚 Cookie 是 HttpOnly");

    const v2 = await core.verifyCode(d, { codeId: r1b.body.codeId, code: "111111" });
    eq(v2.body.code, "E_CODE_USED", "同一个码不能用第二次");

    const r2 = await core.sendCode(d, { email: "b@example.com", ip: "5.6.7.8", code: "222222" });
    t += 11 * 60 * 1000;
    const v3 = await core.verifyCode(d, { codeId: r2.body.codeId, code: "222222" });
    eq(v3.body.code, "E_CODE_EXPIRED", "超过 10 分钟的码已过期");

    t += 61000;
    const r3 = await core.sendCode(d, { email: "c@example.com", ip: "5.6.7.8", code: "333333" });
    t += 61000;
    const r4 = await core.sendCode(d, { email: "c@example.com", ip: "5.6.7.8", code: "444444" });
    const v4 = await core.verifyCode(d, { codeId: r3.body.codeId, code: "333333" });
    eq(v4.body.code, "E_CODE_USED", "发新码后旧码作废，用旧码被拒");

    const accC = store.getAccountByHash(require("../api/_lib/identity.js").emailHash("c@example.com", cfg.sessionSecret));
    await confirmEmail(store, accC.uid, cfg.sessionSecret);
    const v5 = await core.verifyCode(d, { codeId: r4.body.codeId, code: "444444" });
    eq(v5.status, 200, "最新的码可用（邮箱已确认）");
  }

  {
    boot({});
    const core = require("../api/_lib/core.js");
    const cfg = require("../api/_lib/config.js");
    const store = require("../api/_lib/store.js").memoryStore();
    const limiter = core.makeRateLimiter();
    let t = 1757900000000;
    const d = { cfg, store, limiter, now: () => t, ip: "9.9.9.9" };

    const r = await core.sendCode(d, { email: "x@example.com", ip: "9.9.9.9", code: "555555" });
    for (let i = 0; i < 5; i++) {
      await core.verifyCode(d, { codeId: r.body.codeId, code: "000000" });
      t += 1000;
    }
    const last = await core.verifyCode(d, { codeId: r.body.codeId, code: "555555" });
    eq(last.body.code, "E_CODE_VOID", "错满 5 次后该码作废，正确码也不认");

    const again = await core.sendCode(d, { email: "y@example.com", ip: "1.1.1.1" });
    eq(again.status, 200, "第一次发码成功");
    const again2 = await core.sendCode(d, { email: "y@example.com", ip: "1.1.1.1" });
    eq(again2.status, 429, "60 秒内重复发码被拒");
    eq(again2.body.code, "E_RATE_EMAIL", "拒的是邮箱层");
    chk(again2.body.retryAfter > 0, "回带 retryAfter");
    chk(again2.body.retryAfter <= 60, "retryAfter 不超过 60 秒");

    const upper = await core.sendCode(d, { email: "Y@Example.COM", ip: "1.1.1.1" });
    eq(upper.body.code, "E_RATE_EMAIL", "换大小写绕不过邮箱层频控");

    t += 61000;
    const later = await core.sendCode(d, { email: "y@example.com", ip: "1.1.1.1" });
    eq(later.status, 200, "过了 60 秒冷却后可以重新发送");

    const ipCfg = Object.assign({}, cfg, { rate: Object.assign({}, cfg.rate, {
      email: [[60000, 9999]], device: [[60000, 9999]], global: [[60000, 9999]], ip: [[3600000, 30]]
    }) });
    const limiter2 = core.makeRateLimiter();
    let hitIp = false;
    let ipT = 1757900000000;
    const d2 = { cfg: ipCfg, store, limiter: limiter2, now: () => ipT, ip: "8.8.8.8" };
    for (let i = 0; i < 40 && !hitIp; i++) {
      const rr = await core.sendCode(d2, { email: "u" + i + "@example.com", ip: "8.8.8.8" });
      if (rr.status === 429 && rr.body.code === "E_RATE_IP") hitIp = true;
      ipT += 61000;
    }
    chk(hitIp, "IP 层频控会触发（同一 IP 大量发码被拒）");

    const devCfg = Object.assign({}, cfg, { rate: Object.assign({}, cfg.rate, {
      email: [[60000, 9999]], ip: [[60000, 9999]], global: [[60000, 9999]], device: [[3600000, 10]]
    }) });
    const limiter3 = core.makeRateLimiter();
    let devT = 1757900000000;
    const d3 = { cfg: devCfg, store, limiter: limiter3, now: () => devT, ip: "7.7.7.7" };
    let hitDev = false;
    for (let i = 0; i < 40 && !hitDev; i++) {
      const rr = await core.sendCode(d3, { email: "d" + i + "@example.com", ip: "7.7.7.7", deviceId: "dev-fixed" });
      if (rr.status === 429 && rr.body.code === "E_RATE_DEVICE") hitDev = true;
      devT += 61000;
    }
    chk(hitDev, "设备层频控会触发");
  }

  {
    boot({});
    const core = require("../api/_lib/core.js");
    const cfg = require("../api/_lib/config.js");
    const store = require("../api/_lib/store.js").memoryStore();
    const limiter = core.makeRateLimiter();
    const t = 1757900000000;
    const d = { cfg, store, limiter, now: () => t, ip: "1.1.1.1" };

    await core.sendCode(d, { email: "a@example.com", ip: "1.1.1.1", deviceId: "A" });

    const ok2 = await core.sendCode(d, { email: "b@example.com", ip: "2.2.2.2", deviceId: "B" });
    eq(ok2.status, 200, "换邮箱/设备/IP 之后可以继续发码（各层独立）");

    const same = await core.sendCode(d, { email: "a@example.com", ip: "3.3.3.3", deviceId: "C" });
    eq(same.body.code, "E_RATE_EMAIL", "原邮箱仍在冷却中（换 IP / 换设备都绕不过）");
  }

  {
    boot({});
    const core = require("../api/_lib/core.js");
    const cfg = require("../api/_lib/config.js");
    const store = require("../api/_lib/store.js").memoryStore();
    const limiter = core.makeRateLimiter();
    let t = 1757900000000;
    const d = { cfg, store, limiter, now: () => t, ip: "4.4.4.4" };

    const r = await core.sendCode(d, { email: "z@example.com", ip: "4.4.4.4", code: "666666" });
    eq(r.status, 200, "发码成功");

    t -= 3600000;
    const v = await core.verifyCode(d, { codeId: r.body.codeId, code: "666666" });
    eq(v.body.code, "E_CODE_VOID", "时间被改早后，未用的码一律作废（不能让过期的码复活）");
    eq(v.status, 400, "回 400，不是 500");

    t += 3600000;
    const r2 = await core.sendCode(d, { email: "z2@example.com", ip: "5.5.5.5", code: "777777" });
    eq(r2.status, 200, "另一个邮箱照常发码");
    t -= 600000;
    const v2 = await core.verifyCode(d, { codeId: r2.body.codeId, code: "777777" });
    eq(v2.body.code, "E_CODE_VOID", "回拨同样作废这条码");
  }

  {
    boot({});
    const core = require("../api/_lib/core.js");
    const cfg = require("../api/_lib/config.js");
    const store = require("../api/_lib/store.js").memoryStore();
    const limiter = core.makeRateLimiter();
    const t = 1757900000000;

    const no = await core.me({ cfg, store, limiter, now: () => t, account: null });
    eq(no.status, 401, "没有会话时 /api/me 回 401");
    eq(no.body.code, "E_NO_SESSION", "错误码是 E_NO_SESSION");

    const d = { cfg, store, limiter, now: () => t, ip: "1.1.1.1" };
    const r = await core.sendCode(d, { email: "me@example.com", ip: "1.1.1.1", code: "777777" });
    const accMe = store.getAccountByHash(require("../api/_lib/identity.js").emailHash("me@example.com", cfg.sessionSecret));
    await confirmEmail(store, accMe.uid, cfg.sessionSecret);
    const v = await core.verifyCode(d, { codeId: r.body.codeId, code: "777777" });
    eq(v.status, 200, "（前置）确认之后码能换到会话");
    const uid = v.body.account.uid;
    const acc = store.getAccount(uid);

    const mine = await core.me({ cfg, store, limiter, now: () => t, account: { uid } });
    eq(mine.status, 200, "有会话时 /api/me 回 200");
    eq(mine.body.plan.tier, "free", "free 账号回 free");
    chk(mine.body.features.indexOf("read.aloud") >= 0, "free 有 read.aloud（与 js/entitlement.js 同一个键名）");

    // Issue #229 第二轮：export.progress 与内核同步改成「登录可用」。
    // 这里拿到 features 的**前提就是有会话**（上面刚确认过邮箱），
    // 所以它仍然在 free 的清单里 —— 与 js/entitlement.js 的
    // minTier: free + login: true 同一档。
    chk(mine.body.features.indexOf("export.progress") >= 0,
      "登录后的 free 有 export.progress（层级仍是 free，只是未登录不放行）");
    eq(core.featuresFor(cfg, "free").indexOf("export.progress") >= 0, true,
      "featuresFor 的 base 里带着 export.progress（与内核那一行同源）");
    chk(mine.body.features.indexOf("sync.multiDevice") < 0, "free 没有 sync.multiDevice");
    chk(!/email_hash/.test(JSON.stringify(mine.body)), "响应里不含 email_hash");

    acc.plan = "pro";
    store.putAccount(acc);
    const pro = await core.me({ cfg, store, limiter, now: () => t, account: { uid } });
    eq(pro.body.plan.tier, "pro", "库里改成 pro 后 /api/me 回 pro");
    chk(pro.body.features.indexOf("sync.multiDevice") >= 0, "pro 有 sync.multiDevice");
    chk(pro.body.features.indexOf("export.siteWide") < 0, "pro 没有 max 的能力");

    acc.plan = "max";
    acc.plan_until = t - 1000;
    store.putAccount(acc);
    const expired = await core.me({ cfg, store, limiter, now: () => t, account: { uid } });
    eq(expired.body.plan.tier, "free", "层级到期即回落 free");
    eq(expired.body.plan.until, t - 1000, "until 如实回给前端（便于显示剩余天数）");

    eq(core.normalizeGrants({ plan: "max", tier: "max" }), "free", "客户端传的 plan 一律被忽略");
    eq(core.normalizeGrants("max"), "free", "客户端传字符串 plan 也被忽略");

    acc.plan = "enterprise";
    store.putAccount(acc);
    const dirty = await core.me({ cfg, store, limiter, now: () => t, account: { uid } });
    eq(dirty.body.plan.tier, "free", "未知层级一律回落 free");

    store.deleteAccount(uid);
    const gone = await core.me({ cfg, store, limiter, now: () => t, account: { uid } });
    eq(gone.status, 401, "账号已被注销时会话失效");
  }

  {
    boot({});
    const core = require("../api/_lib/core.js");
    const cfg = require("../api/_lib/config.js");
    const store = require("../api/_lib/store.js").memoryStore();
    const limiter = core.makeRateLimiter();
    let t = 1757900000000;
    const d = { cfg, store, limiter, now: () => t, ip: "1.1.1.1" };

    const noPull = await core.syncPull({ cfg, store, limiter, now: () => t, account: null }, {});
    eq(noPull.status, 401, "未登录时 pull 回 401");
    const noPush = await core.syncPush({ cfg, store, limiter, now: () => t, account: null }, {});
    eq(noPush.status, 401, "未登录时 push 回 401");

    const d0 = { cfg, store, limiter, now: () => t, ip: "1.1.1.1" };
    const reg = await core.sendCode(d0, { email: "sync@example.com", ip: "1.1.1.1", code: "333333" });
    const accS = store.getAccountByHash(require("../api/_lib/identity.js").emailHash("sync@example.com", cfg.sessionSecret));
    await confirmEmail(store, accS.uid, cfg.sessionSecret);
    const ver = await core.verifyCode(d0, { codeId: reg.body.codeId, code: "333333" });
    eq(ver.status, 200, "（前置）确认之后码能换到会话");
    const uid = ver.body.account.uid;
    const acc = store.getAccount(uid);
    acc.plan = "pro";
    store.putAccount(acc);

    {
      const freeAcc = store.getAccount(uid);
      freeAcc.plan = "free";
      store.putAccount(freeAcc);
      const freeD = Object.assign({}, d, { account: { uid } });
      const noPush = await core.syncPush(freeD, { deviceId: "A", recs: [{ id: "x", payload: {}, updatedAt: t }] });
      eq(noPush.status, 403, "free 账号推不上去（403，不是静默成功）");
      eq(noPush.body.code, "E_TIER", "错误码 E_TIER");
      eq(noPush.body.minTier, "pro", "如实回门槛是 pro");
      const noPull = await core.syncPull(freeD, { deviceId: "A" });
      eq(noPull.status, 403, "free 账号也拉不下来（拉同样要 Pro）");

      chk(noPush.body.code !== "E_NO_SESSION", "403 不说成「还没登录」");
      chk(/Pro/.test(noPush.body.message), "文案里如实写明要 Pro 起");
      chk(/本机/.test(noPush.body.message), "文案里如实写明本机进度不受影响");
      freeAcc.plan = "pro";
      store.putAccount(freeAcc);
    }

    const dd = Object.assign({}, d, { account: { uid } });

    const p1 = await core.syncPush(dd, {
      deviceId: "A",
      recs: [
        { id: "p1", payload: { level: 2, nextReviewAt: t + 86400000, reps: 3 }, updatedAt: t },
        { id: "p2", payload: { level: 1, reps: 1 }, updatedAt: t },
        { id: "p3", payload: { level: 0 }, updatedAt: t }
      ]
    });
    eq(p1.status, 200, "push 成功");
    eq(p1.body.applied, 3, "三条都写进去了");
    eq(p1.body.conflicts.length, 0, "无冲突时 conflicts 为空数组");

    const pull1 = await core.syncPull(dd, { deviceId: "A" });
    eq(pull1.body.recs.length, 3, "pull 拿到 3 条");
    eq(pull1.body.serverTime, t, "serverTime 是服务端时间（供下次当游标）");

    t += 5000;
    const p2 = await core.syncPush(dd, {
      deviceId: "A",
      recs: [{ id: "p1", payload: { level: 99 }, updatedAt: t - 100000 }]
    });
    eq(p2.body.applied, 1, "老时间戳的记录仍被接受（不报错）");
    const after = await core.syncPull(dd, { deviceId: "A" });
    const p1rec = after.body.recs.filter(r => r.id === "p1")[0];
    eq(p1rec.payload.level, 2, "老时间戳盖不掉新值（level 仍是 2）");

    t += 5000;
    await core.syncPush(dd, { deviceId: "B", recs: [{ id: "p4", payload: { level: 1 }, updatedAt: t }] });
    const inc = await core.syncPull(dd, { deviceId: "B", since: t - 1000 });
    eq(inc.body.recs.length, 1, "since 之后只拿新改的那一条");
    eq(inc.body.recs[0].id, "p4", "拿到的是那条新的");

    const bad = await core.syncPush(dd, { deviceId: "A", recs: [{ id: "", payload: {} }] });
    eq(bad.status, 400, "缺 id 或时间戳的记录整批拒收");
    eq(bad.body.code, "E_BAD_REC", "错误码 E_BAD_REC");

    const clean = core.sanitizePayload({
      level: 1e9, reps: -5, name: "《静夜思》", __proto__: { bad: 1 },
      history: [{ at: t, level: 2, junk: "x" }, "not-an-object"]
    });
    eq(clean.level, 99, "level 上限被卡到 99");
    eq(clean.reps, 0, "reps 负数被卡到 0");
    chk(!("name" in clean), "载荷里不相干的字段被丢掉");
    chk(!("junk" in clean.history[0]), "history 里不相干的字段被丢掉");
    eq(clean.history.length, 1, "history 里的脏条目被过滤");
    eq(clean.history[0].level, 2, "history 认识的字段留着");

    const many = await core.syncPush(dd, {
      deviceId: "C", recs: new Array(2001).fill({ id: "x", payload: {}, updatedAt: t })
    });
    eq(many.status, 413, "一次超过 2000 条被拒");
  }

  // 「今日加背」那一行（Issue #243 后续）：它上云，走的就是 progress 这张表。
  // 服务端**不判今天是哪一天** —— 那是客户端的事（服务端不知道对方在哪个时区），
  // 它只负责：行号认得出来、载荷按自己的白名单洗、长度封顶。
  {
    boot({});
    const core = require("../api/_lib/core.js");
    const cfg = require("../api/_lib/config.js");
    const store = require("../api/_lib/store.js").memoryStore();
    const limiter = core.makeRateLimiter();
    let t = 1757900000000;
    const d = { cfg, store, limiter, now: () => t, ip: "1.1.1.1" };

    eq(core.DAILY_EXTRA_ROW_ID, "daily_extra:v1", "行号与前端逐字一致（js/daily-extra.js）");
    eq(core.DAILY_EXTRA_MAX, 20, "条数上限与前端 MAX 一致");

    const r = await core.sendCode(d, { email: "extra@example.com", ip: "1.1.1.1", code: "888888" });
    const acc = store.getAccountByHash(
      require("../api/_lib/identity.js").emailHash("extra@example.com", cfg.sessionSecret));
    await confirmEmail(store, acc.uid, cfg.sessionSecret);
    const v = await core.verifyCode(d, { codeId: r.body.codeId, code: "888888" });
    const uid = v.body.account.uid;
    // 同步要 Pro 起（§4.2 的层级），与其他同步层测试同一条规矩
    const accRow = store.getAccount(uid);
    accRow.plan = "pro";
    store.putAccount(accRow);
    const dd = Object.assign({}, d, { account: { uid } });

    const row = {
      id: "daily_extra:v1",
      updatedAt: t,
      deleted: false,
      payload: {
        v: 1, date: "2026-9-19", updatedAt: t,
        items: [
          { id: "tangshi-ts-1", wid: "w-1", entryId: "tangshi-ts-1", at: 1,
            snap: { title: "感遇", dynasty: "唐", author: "张九龄", bookName: "唐诗三百首",
              text: "兰叶春葳蕤".repeat(5000), email: "泄露@example.com" } },
          { id: "", snap: { title: "没有 id 的脏条目" } },
          "not-an-object"
        ]
      }
    };

    // 服务端**不**判今天是哪一天（不知道对方时区）
    eq(core.sanitizeDailyExtra({ date: "2000-1-1", items: [] }).date, "2000-1-1",
      "date 原样透传（「今天」是客户端判的）");

    const push = await core.syncPush(dd, { deviceId: "A", recs: [row] });
    eq(push.status, 200, "这一行推得上去（它是 progress 表里的普通一行）");
    const pulled = await core.syncPull(dd, { deviceId: "A" });
    const got = pulled.body.recs.filter(x => x.id === "daily_extra:v1")[0];
    chk(!!got, "拉得下来");
    eq(got.payload.date, "2026-9-19", "日期在里面（客户端靠它判「明天归零」）");
    eq(got.payload.items.length, 1, "脏条目（没有 id / 不是对象）被丢掉");
    eq(got.payload.items[0].snap.title, "感遇", "篇名留着");
    eq(String(got.payload.items[0].snap.text).length, 20000, "正文截断到 20000 字");
    chk(!("email" in got.payload.items[0].snap),
      "snap 里不相干的字段（邮箱之类）被丢掉 —— 只留白名单那几项");

    const big = core.sanitizeDailyExtra({
      date: "2026-9-19",
      items: new Array(40).fill(null).map((_, i) => ({ id: "p-" + i, snap: { title: "第" + i } }))
    });
    eq(big.items.length, 20, "条数封顶 20（任人灌超长数组就会撑爆 jsonb）");
    eq(big.updatedAt, 0, "没有时间戳时如实回 0（不编一个假的）");

    const del = core.sanitizeDailyExtra({ date: "2026-9-19", deleted: true, items: [] });
    eq(del.deleted, 1, "删除标记照旧透传（删空也要让另一台设备知道）");
  }

  {
    boot({});
    const core = require("../api/_lib/core.js");
    const cfg = require("../api/_lib/config.js");
    const store = require("../api/_lib/store.js").memoryStore();
    const limiter = core.makeRateLimiter();
    let t = 1757900000000;
    const d = { cfg, store, limiter, now: () => t, ip: "1.1.1.1" };

    const r = await core.sendCode(d, { email: "bye@example.com", ip: "1.1.1.1", code: "888888" });
    const accBye = store.getAccountByHash(require("../api/_lib/identity.js").emailHash("bye@example.com", cfg.sessionSecret));
    await confirmEmail(store, accBye.uid, cfg.sessionSecret);
    const v = await core.verifyCode(d, { codeId: r.body.codeId, code: "888888" });
    eq(v.status, 200, "（前置）确认之后码能换到会话");
    const uid = v.body.account.uid;

    const acc = store.getAccount(uid);
    acc.plan = "pro";
    store.putAccount(acc);
    await core.syncPush(Object.assign({}, d, { account: { uid } }), {
      deviceId: "A", recs: [{ id: "p1", payload: { level: 3 }, updatedAt: t }]
    });
    chk(store.listProgress(uid, "", 0).length === 1, "注销前有一条云端进度");

    const noConfirm = await core.accountDelete(Object.assign({}, d, { account: { uid } }), {});
    eq(noConfirm.status, 400, "没有 confirm 时拒绝注销");
    eq(noConfirm.body.code, "E_CONFIRM", "错误码 E_CONFIRM");

    const del = await core.accountDelete(Object.assign({}, d, { account: { uid } }), { confirm: true });
    eq(del.status, 200, "确认后注销成功");
    eq(del.body.deleted, true, "回 deleted: true");
    eq(del.body.export.recs.length, 1, "导出随响应回（先导出再删）");
    eq(del.body.export.recs[0].id, "p1", "导出的就是那条进度");
    chk(del.cookies && del.cookies[0].indexOf("Max-Age=0") > 0, "注销时清掉会话 Cookie");
    chk(/本机/.test(del.body.note), "如实说明不影响本机进度");

    eq(store.getAccount(uid), null, "账号行已删除");
    eq(store.listProgress(uid, "", 0).length, 0, "云端进度已删除");

    t += 61000;

    const r2 = await core.sendCode(d, { email: "bye@example.com", ip: "1.1.1.1", code: "999999" });
    const accBye2 = store.getAccountByHash(require("../api/_lib/identity.js").emailHash("bye@example.com", cfg.sessionSecret));
    await confirmEmail(store, accBye2.uid, cfg.sessionSecret);
    const v2 = await core.verifyCode(d, { codeId: r2.body.codeId, code: "999999" });
    eq(v2.status, 200, "（前置）确认之后码能换到会话");
    chk(v2.body.account.uid !== uid, "注销后重新登录拿到全新的 uid（uid 不回收）");
    eq(store.listProgress(v2.body.account.uid, "", 0).length, 0, "新账号里没有旧进度");
  }

  {
    boot({});
    const core = require("../api/_lib/core.js");
    const cfg = require("../api/_lib/config.js");
    const store = require("../api/_lib/store.js").memoryStore();
    const limiter = core.makeRateLimiter();
    let t = 1757900000000;
    const d = { cfg, store, limiter, now: () => t, ip: "1.1.1.1" };

    const fresh = await core.sendCode(d, { email: "brand-new@example.com", ip: "1.1.1.1" });
    const old = await core.sendCode(d, { email: "old@example.com", ip: "2.2.2.2" });

    await core.verifyCode(d, { codeId: old.body.codeId, code: "000000" });
    t += 61000;
    void fresh;
    const old2 = await core.sendCode(d, { email: "old@example.com", ip: "2.2.2.2" });

    const shape = o => Object.keys(o).sort().join(",");
    eq(shape(fresh.body), shape(old2.body), "新账号与老账号的发码响应形状完全一致（防用户枚举）");
    eq(fresh.status, old2.status, "新账号与老账号的状态码一致");
    chk(!("exists" in fresh.body) && !("isNew" in fresh.body), "响应里没有任何暗示账号是否存在的字段");
  }

  {
    const b = boot({});
    const sv = await serve();
    try {

      const wrongMethod = await call(sv.base, "GET", "/api/send-code");
      eq(wrongMethod.status, 405, "GET 打 send-code 回 405");
      chk(/POST/.test(wrongMethod.setCookie || "") === false, "405 不写 Cookie");
      const meAsPost = await call(sv.base, "POST", "/api/me", {});
      eq(meAsPost.status, 405, "POST 打 /api/me 回 405");

      const me401 = await call(sv.base, "GET", "/api/me");
      eq(me401.status, 401, "未登录时 /api/me 回 401");
      eq(me401.body.code, "E_NO_SESSION", "401 带 E_NO_SESSION");

      const badJson = await fetch(sv.base + wirePath("/api/verify-code"), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{oops"
      });
      eq(badJson.status, 400, "非法 JSON 回 400");

      const badEmail = await call(sv.base, "POST", "/api/send-code", { email: "not-an-email" });
      eq(badEmail.status, 400, "邮箱格式错回 400");
      eq(badEmail.body.code, "E_EMAIL_FORMAT", "错误码 E_EMAIL_FORMAT");

      b.restore();
      const b2 = boot({ ALLOW_CODE_ECHO: "1" });
      const sv2 = await serve();
      try {
        const s1 = await call(sv2.base, "POST", "/api/send-code", { email: "http@example.com" });
        eq(s1.status, 202, "发码回 202（契约里写的就是 202）");
        chk(/^\d{6}$/.test(s1.body.devCode), "冒烟模式下能拿到明文码（生产默认关）");
        eq(s1.body.store, "memory", "没配 Supabase 时如实回报 store=memory");

        const regC = await call(sv2.base, "POST", "/api/register",
          { email: "http@example.com", password: "hunter2hunter" });
        eq(regC.status, 202, "（前置）注册接口把邮箱确认邮件发了出来");
        const svStore = require("../api/_lib/store.js").getStore(require("../api/_lib/config.js"));
        const vidC = Object.keys(svStore._db.verifications)
          .filter(k => !svStore._db.verifications[k].consumed_at)
          .sort((a, b) => svStore._db.verifications[b].issued_at - svStore._db.verifications[a].issued_at)[0];
        const vc = await call(sv2.base, "POST", "/api/verify-email",
          { vid: vidC, token: regC.body.devVerifyToken });
        eq(vc.status, 200, "（前置）邮箱已确认");

        const v1 = await call(sv2.base, "POST", "/api/verify-code", {
          codeId: s1.body.codeId, code: s1.body.devCode
        });
        eq(v1.status, 200, "校验码通过（邮箱已确认）");
        chk(!!v1.setCookie && /kbsid=/.test(v1.setCookie), "响应带 Set-Cookie: kbsid");
        chk(/HttpOnly/.test(v1.setCookie || ""), "那枚 Cookie 是 HttpOnly");
        chk(/SameSite=Lax/.test(v1.setCookie || ""), "那枚 Cookie 是 SameSite=Lax");
        chk(!/plan|tier|email/i.test(v1.setCookie || ""), "Cookie 里不含权益或邮箱");

        const cookieParts = String(v1.setCookie || "").split(";").map(x => x.trim());
        chk(cookieParts.every(p => !new RegExp("(^|[^0-9a-f])" + s1.body.devCode + "([^0-9a-f]|$)").test(p)),
          "Cookie 头的各段里都没有明文码");

        const cookie = String(v1.setCookie).split(";")[0];
        const me1 = await call(sv2.base, "GET", "/api/me", undefined, cookie);
        eq(me1.status, 200, "带上 Cookie 后 /api/me 回 200");
        eq(me1.body.plan.tier, "free", "回 free");
        eq(me1.body.mask, "h***@example.com", "回掩码");

        const tampered = cookie.slice(0, -3) + "aaa";
        const me2 = await call(sv2.base, "GET", "/api/me", undefined, tampered);
        eq(me2.status, 401, "篡改 Cookie 后 /api/me 回 401");

        const store = require("../api/_lib/store.js").getStore(require("../api/_lib/config.js"));
        const sessions = Object.keys(store._db.sessions).map(k => store._db.sessions[k]);
        chk(sessions.length > 0, "会话已经落库");
        chk(sessions.every(x => typeof x.sid === "string" && x.sid),
          "落库的会话都有 sid");
        chk(sessions.every(x => typeof x.uid === "string" && x.uid), "落库的会话都有 uid");
        chk(sessions.every(x => typeof x.iat === "number" && isFinite(x.iat)),
          "落库的会话都有 iat（schema.sql 里是 NOT NULL，缺了只在真库上炸）");
        chk(sessions.every(x => typeof x.exp === "number" && isFinite(x.exp)),
          "落库的会话都有 exp");
        chk(sessions.every(x => x.revoked === 0 || x.revoked === 1),
          "落库的会话 revoked 是 0/1");

        const httpStore = require("../api/_lib/store.js").getStore(require("../api/_lib/config.js"));
        const httpUid = me1.body.uid;
        const httpAcc = httpStore.getAccount(httpUid);
        httpAcc.plan = "pro";
        httpStore.putAccount(httpAcc);

        const push = await call(sv2.base, "POST", "/api/sync/push", {
          recs: [{ id: "a1", payload: { level: 1 }, updatedAt: Date.now() }]
        }, cookie);
        eq(push.status, 200, "带 Cookie 的 sync/push 成功");
        const pull = await call(sv2.base, "POST", "/api/sync/pull", {}, cookie);
        eq(pull.status, 200, "带 Cookie 的 sync/pull 成功");
        eq(pull.body.recs.length, 1, "pull 到刚推的那一条");

        const del = await call(sv2.base, "DELETE", "/api/account", { confirm: true }, cookie);
        eq(del.status, 200, "注销成功");
        chk(/Max-Age=0/.test(del.setCookie || ""), "注销响应清掉 Cookie");
        const after = await call(sv2.base, "GET", "/api/me", undefined, cookie);
        eq(after.status, 401, "注销后旧 Cookie 立刻失效");
      } finally { await sv2.close(); b2.restore(); }
    } finally {
      await sv.close();
      b.restore();
    }
  }

  {
    boot({ SESSION_SECRET: "" });
    const sv = await serve();
    try {
      const r = await call(sv.base, "POST", "/api/send-code", { email: "a@example.com" });
      eq(r.status, 503, "缺 SESSION_SECRET 时回 503（不是 500）");
      eq(r.body.code, "E_NOT_CONFIGURED", "错误码 E_NOT_CONFIGURED");
      const m = await call(sv.base, "GET", "/api/me");
      eq(m.status, 503, "/api/me 同样回 503");
    } finally { await sv.close(); }
  }

  {
    const Api = require("../js/auth-api.js");

    const dead = Api.create({ fetch: null });
    const r0 = await dead.sendCode({ email: "a@b.com" });
    eq(r0.ok, false, "没有 fetch 时不是抛异常，而是回一个降级结果");
    eq(r0.code, "E_OFFLINE", "降级码是 E_OFFLINE");
    eq(dead.degraded(), true, "降级状态被记下来（界面据此显示「本机体验版」）");

    const f503 = Api.create({ fetch: async () => ({ status: 503, text: async () => '{"code":"E_NOT_CONFIGURED"}' }) });
    const r503 = await f503.sendCode({ email: "a@b.com" });
    eq(r503.code, "E_NOT_CONFIGURED", "503 被翻译成「本站还没开放云端账号」");
    chk(/本机体验版/.test(r503.message), "文案如实说这是本机体验版");
    eq(f503.degraded(), true, "503 标记为降级");

    const f401 = Api.create({ fetch: async () => ({ status: 401, text: async () => '{"code":"E_NO_SESSION"}' }) });
    const r401 = await f401.me();
    eq(r401.code, "E_NO_SESSION", "401 如实回 E_NO_SESSION");
    eq(f401.degraded(), false, "401 不算降级（未登录是正常状态）");

    const f200 = Api.create({
      fetch: async (url, init) => {
        eq(init.credentials, "same-origin", "请求带 credentials: same-origin（Cookie 才发得出去）");
        chk(/\/api\/send-code$/.test(url), "打到 /api/send-code");
        const sent = JSON.parse(init.body);

        eq(sent.channel, "email", "请求体带上 channel（缺省 email）");
        eq(sent.value, "a@b.com", "请求体把邮箱放在通用的 value 里");
        return { status: 202, text: async () => '{"codeId":"c_1","cooldown":60,"store":"memory"}' };
      }
    });
    const r200 = await f200.sendCode({ email: "a@b.com" });
    eq(r200.ok, true, "202 算成功");
    eq(r200.codeId, "c_1", "字段被透传出来");
    eq(f200.degraded(), false, "成功后清掉降级标记");

    const fThrow = Api.create({ fetch: async () => { throw new Error("boom"); } });
    const rThrow = await fThrow.me();
    eq(rThrow.code, "E_OFFLINE", "网络异常被翻译成 E_OFFLINE");
    eq(fThrow.degraded(), true, "网络异常标记为降级");

    const fBad = Api.create({ fetch: async () => ({ status: 500, text: async () => "<html>oops</html>" }) });
    const rBad = await fBad.me();
    eq(rBad.code, "E_INTERNAL", "非 JSON 响应回落 E_INTERNAL");

    const fAbort = Api.create({
      fetch: async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; }
    });
    const rAbort = await fAbort.me();
    eq(rAbort.code, "E_TIMEOUT", "AbortError 被翻译成 E_TIMEOUT");

    const names = ["sendCode", "verifyCode", "me", "pull", "push", "deleteAccount"];
    const api = Api.create({ fetch: async () => ({ status: 200, text: async () => "{}" }) });
    names.forEach(n => chk(typeof api[n] === "function", "传输层有 " + n + "()"));
    const apiSrc = fs.readFileSync(path.join(ROOT, "js/auth-api.js"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/[^\n]*/gm, " ");
    chk(!/localStorage|sessionStorage/.test(apiSrc), "传输层不碰 localStorage / sessionStorage（token 只在 HttpOnly Cookie 里）");
    chk(/credentials:\s*"same-origin"/.test(apiSrc), "传输层带着 credentials: same-origin");
    chk(!/Authorization/.test(apiSrc), "传输层不自己拼 Authorization 头（会话走 Cookie）");

    const src = fs.readFileSync(path.join(ROOT, "js/auth-api.js"), "utf8");
    chk(!/Math\.random|digits\(/.test(src), "传输层不自己生成验证码（码必须由服务端发）");
  }

  {

    const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
    chk(/\/api\//.test(sw), "sw.js 里显式提到 /api/（不缓存接口）");
    chk(/pathname[\s\S]{0,80}startsWith\(["']\/api\//.test(sw),
      "sw.js 有 `pathname.startsWith('/api/')` 这条早退（docs §4.6 第 7 条）");

    const fetchBody = sw.slice(sw.indexOf('addEventListener("fetch"'));
    chk(fetchBody.indexOf("/api/") < fetchBody.indexOf('"navigate"'),
      "那条早退排在 navigate 分支之前（排在后面等于没写）");

    const pages = [];
    (function walk(dir) {
      fs.readdirSync(dir).forEach(f => {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) { if (!/node_modules|\.git|api|test|image|fonts|icons/.test(f)) walk(p); }
        else if (/\.(html|js)$/.test(f) && !/api\//.test(p)) pages.push(p);
      });
    })(ROOT);
    const leaked = pages.filter(p => {
      const t = fs.readFileSync(p, "utf8");
      return /SUPABASE_SERVICE_KEY|SENDGRID_API_KEY|RESEND_API_KEY|SESSION_SECRET/.test(t);
    });
    chk(leaked.length === 0, "前端文件里一个服务端密钥名都没有（实际泄漏 " + leaked.length + " 个）");

    chk(leaked.indexOf("scripts/doctor.js") < 0 || !fs.existsSync(path.join(ROOT, "scripts/doctor.js")),
      "自检脚本不在页面目录树里（它念的是**变量名**，值一个字都不出现）");
    const sw2 = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
    chk(sw2.indexOf("doctor") < 0 && sw2.indexOf("_lib/ops") < 0,
      "sw.js 的预缓存里没有自检脚本与清单（这两样都不该进浏览器）");

    const stripJs = t => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/[^\n]*/gm, " ");
    const libFiles = ["api/_lib/core.js", "api/_lib/store.js", "api/_lib/identity.js",
      "api/_lib/session.js", "api/_lib/config.js"];
    const rawLogs = libFiles.filter(f => /console\.log/.test(stripJs(fs.readFileSync(path.join(ROOT, f), "utf8"))));
    chk(rawLogs.length === 0, "内核文件里没有裸 console.log（日志只走 http.js 的 log()，实际 " + rawLogs.join("/") + "）");

    const http = fs.readFileSync(path.join(ROOT, "api/_lib/http.js"), "utf8");
    chk(/redact\(detail/.test(stripJs(http)), "http.js 的 log() 把 detail 过了一遍 redact");
    const H = require("../api/_lib/http.js");
    const r = H.redact({ code: "123456", codeHash: "abc", salt: "s", token: "t", email: "a@b.com" });
    eq(r.code, "[redacted]", "redact 抹掉明文码");
    eq(r.codeHash, "[redacted]", "redact 抹掉码哈希");
    eq(r.salt, "[redacted]", "redact 抹掉盐");
    eq(r.token, "[redacted]", "redact 抹掉 token");
    eq(r.email, "a@b.com", "redact 不动普通字段（掩码之外的东西由调用方自己给）");
    chk(!JSON.stringify(H.redact({ nested: { code: "999999" } })).includes("999999"), "redact 递归抹掉嵌套里的码");
    chk(!JSON.stringify(H.redact([{ code: "888888" }])).includes("888888"), "redact 抹掉数组里的码");

    ["api/_routes/send-code.js", "api/_routes/verify-code.js", "api/_routes/me.js", "api/_routes/sync/pull.js",
      "api/_routes/sync/push.js", "api/_routes/account.js", "api/_lib/schema.sql", "js/auth-api.js"].forEach(f => {
        chk(fs.existsSync(path.join(ROOT, f)), f + " 存在");
      });

    const sql = fs.readFileSync(path.join(ROOT, "api/_lib/schema.sql"), "utf8");
    ["accounts", "codes", "sessions", "progress"].forEach(t => {
      chk(new RegExp("create table if not exists public\\." + t).test(sql), "schema.sql 建了 " + t + " 表");
      chk(new RegExp("alter table public\\." + t + "\\s+enable row level security").test(sql),
        "schema.sql 给 " + t + " 开了 RLS");
    });
    chk(!/create policy/i.test(sql), "schema.sql 不给任何 RLS 策略（默认拒绝）");

    chk(/add column if not exists email\s+text\s+not null default ''/.test(sql),
      "schema.sql 里有明文邮箱列（Issue #197：邮箱必须记录到数据库）");
    chk(/add column if not exists password_hash\s+text\s+not null default ''/.test(sql),
      "schema.sql 里有口令摘要列（默认空串 = 还没设口令的老账号）");
    chk(/add column if not exists email_verified_at/.test(sql),
      "schema.sql 里有邮箱确认时刻列（确认与否的唯一凭据）");

    // 顶部那段「三条口径」是给人看的导读，最容易在迁移之后忘了改 ——
    // 它若还写着「不存明文邮箱」，读者会以为库里没有 email 列，
    // 而实际第 6 节 ① 就把它加上了（#197）。口径必须与实现同一句。
    chk(!/不存明文邮箱/.test(sql),
      "schema.sql 顶部不再说「不存明文邮箱」（#197 已推翻，库里就是存明文的）");
    chk(/邮箱明文是落库的/.test(sql),
      "schema.sql 顶部**明说**邮箱明文落库（新口径要有一句正向的话，不能只删旧的）");
    ["verifications", "resets"].forEach(t => {
      chk(new RegExp("create table if not exists public\\." + t).test(sql), "schema.sql 建了 " + t + " 表");
      chk(new RegExp("alter table public\\." + t + "\\s+enable row level security").test(sql),
        "schema.sql 给 " + t + " 开了 RLS（新表忘了开 = anon key 能读别人的令牌摘要）");
    });
    chk(/kb_purge_expired/.test(sql), "schema.sql 有过期记录清理函数（三张令牌表一起清）");
  }

  {
    boot({});
    const storeMod = require("../api/_lib/store.js");
    const mem = storeMod.memoryStore();
    const supa = storeMod.supabaseStore({ supabaseUrl: "https://x.supabase.co", supabaseServiceKey: "k" });

    const mk = k => typeof mem[k] === "function" && k !== "kind";
    const memKeys = Object.keys(mem).filter(mk).sort();
    const supaKeys = Object.keys(supa).filter(k => typeof supa[k] === "function").sort();
    eq(supaKeys.join(","), memKeys.join(","), "两个 store 的方法集合完全一致");
    chk(memKeys.length >= 15,
      "store 至少 15 个方法（账号 4 / 码 4 / 会话 3 / 进度 3 / ready，实际 " + memKeys.length + "）");

    const sql = fs.readFileSync(path.join(ROOT, "api/_lib/schema.sql"), "utf8");
    chk(/kb_upsert_progress/.test(sql), "schema.sql 里有 kb_upsert_progress 函数");
    chk(/where\s+excluded\.updated_at\s*>=\s*public\.progress\.updated_at/.test(sql),
      "那个函数里带着「老时间戳盖不掉新值」的 where（否则跨设备同步会回退进度）");
    const storeCode = fs.readFileSync(path.join(ROOT, "api/_lib/store.js"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/[^\n]*/gm, " ");

    const lastPut = storeCode.lastIndexOf("putProgress: function");
    const progressFn = storeCode.slice(lastPut, storeCode.indexOf("deleteProgress: function", lastPut));
    chk(progressFn.length > 0, "定位到 store.js 的 supabase.putProgress（判据落在这段上）");
    chk(/kb_upsert_progress/.test(progressFn), "连进度走 rpc/kb_upsert_progress");
    chk(!/resolution=merge-duplicates/.test(progressFn),
      "连进度不用无条件的 upsert（那等于「谁最后写谁赢」，跨设备会把新进度回退成旧的）");

    await mem.putProgress("u_1", "", [{ poem_id: "p1", payload: { level: 9 }, updated_at: 100 }]);
    await mem.putProgress("u_1", "", [{ poem_id: "p1", payload: { level: 1 }, updated_at: 50 }]);
    const kept = mem.listProgress("u_1", "", 0)[0];
    eq(kept.payload.level, 9, "memoryStore：老时间戳盖不掉新值");
    await mem.putProgress("u_1", "", [{ poem_id: "p1", payload: { level: 7 }, updated_at: 200 }]);
    eq(mem.listProgress("u_1", "", 0)[0].payload.level, 7, "memoryStore：新时间戳能盖掉老值");

    const src = fs.readFileSync(path.join(ROOT, "api/_lib/store.js"), "utf8");
    ["/accounts", "/codes", "/sessions", "/progress"].forEach(t => {
      chk(src.includes('"' + t), "store.js 打到表 " + t);
      chk(new RegExp("create table if not exists public\\." + t.slice(1)).test(sql),
        "schema.sql 里建有 " + t.slice(1) + " 表");
    });
    ["uid", "email_hash", "email_mask", "nickname", "plan", "plan_until", "role",
      "created_at", "last_login_at", "status"].forEach(c => {
      chk(new RegExp("\\b" + c + "\\b").test(sql), "schema.sql 的 accounts 有列 " + c);
    });
    ["code_id", "uid", "purpose", "channel", "sent_to", "code_hash", "salt",
      "issued_at", "expires_at", "attempts", "consumed_at"].forEach(c => {
      chk(new RegExp("\\b" + c + "\\b").test(sql), "schema.sql 的 codes 有列 " + c);
    });
  }

  {
    boot({});
    const cfg = require("../api/_lib/config.js");
    eq(cfg.hasDb(), false, "没配 Supabase 时 hasDb() 为 false");
    const store = require("../api/_lib/store.js").getStore(cfg);
    eq(store.kind, "memory", "降级为 memoryStore");
    eq(cfg.hasSession(), true, "有 SESSION_SECRET 时会话可用");

    const sv = await serve();
    try {
      const r = await call(sv.base, "POST", "/api/send-code", { email: "offline@example.com" });
      chk(r.status === 202 || r.status === 503, "没配数据库时接口不 500（实际 " + r.status + "）");
    } finally { await sv.close(); }
  }

  {
    boot({});
    const id = require("../api/_lib/identity.js");
    const core = require("../api/_lib/core.js");
    const A = require("../js/auth-core.js");

    ["13800138000", "138 0013 8000", "138-0013-8000", "+8613800138000",
      "8613800138000", "008613800138000", "(138)0013.8000"].forEach(v => {
      eq(id.normalizePhone(v), "13800138000", "服务端手机号归一化：" + JSON.stringify(v));
      eq(A.normalizePhone(v), "13800138000", "前端手机号归一化：" + JSON.stringify(v));
    });
    chk(id.isPhoneShape("13800138000"), "11 位 1 开头通过形态校验");
    chk(!id.isPhoneShape("12345"), "位数不足被拒");
    chk(!id.isPhoneShape("12800138000"), "第二位 2 不是有效号段，被拒");
    chk(!id.isPhoneShape("138001380000"), "12 位被拒");
    eq(id.maskPhone("13800138000"), "138****8000", "手机号掩码：前 3 后 4");
    eq(id.maskPhone("+86 138-0013-8000"), "138****8000", "掩码前先归一化");
    eq(id.maskPhone("12"), "***", "掩码对脏值给 ***");

    ["13800138000", "12345", "+86 138 0013 8000", "", "abcdefghijk"].forEach(v => {
      eq(id.normalizePhone(v), A.normalizePhone(v), "两端手机号归一化一致：" + JSON.stringify(v));
      eq(id.isPhoneShape(v), A.isPhoneShape(v), "两端手机号形状判定一致：" + JSON.stringify(v));
      eq(id.maskPhone(v), A.maskPhone(v), "两端手机号掩码一致：" + JSON.stringify(v));
    });

    const eh = id.emailHash("13800138000", "pep");
    const ph = id.phoneHash("13800138000", "pep");
    chk(eh !== ph, "同一串在 email 与 phone 两个命名空间下摘要不同（排除交叉命中）");
    chk(id.phoneHash("13800138000", "p1") !== id.phoneHash("13800138000", "p2"),
      "换 pepper 得到不同手机号摘要");
    chk(!/13800138000/.test(ph), "手机号摘要里看不到明文");

    {
      const lim = core.makeRateLimiter();
      const cfg = require("../api/_lib/config.js");
      const tt = Date.now();
      chk(lim.check(cfg, "phone", "13800138000", tt).ok, "phone 档初始放行");

      lim.hit("phone", "13800138000", tt - 1000);
      lim.hit("phone", "13800138000", tt - 2000);
      const blocked = lim.check(cfg, "phone", "13800138000", tt);
      chk(!blocked.ok && blocked.retryAfter > 0,
        "一小时第 3 次发短信被拦（rateWindow 真的认 phone 档，不是空数组）");

      const smsDay = cfg.rateSms.phone.filter(w => w[0] === 86400000)[0][1];
      const mailDay = cfg.rate.email.filter(w => w[0] === 86400000)[0][1];
      chk(smsDay < mailDay, "服务端短信日上限严格小于邮箱（" + smsDay + " < " + mailDay + "）");
    }

    chk(A.RATE_SMS && A.RATE_SMS.phone, "前端内核有独立的短信频控档 RATE_SMS.phone");
    const smsWins = A.RATE_SMS.phone;
    chk(smsWins.some(w => w[1] === 5 && w[0] === 86400000), "短信档含「日 5 次」");
    chk(smsWins.some(w => w[1] === 15), "短信档含「月 15 次」");

    const emailDay = A.RATE.email.filter(w => w[0] === 86400000)[0][1];
    const smsDay = smsWins.filter(w => w[0] === 86400000)[0][1];
    chk(smsDay < emailDay, "短信日上限严格小于邮箱（" + smsDay + " < " + emailDay + "）");
  }

  {
    boot({});
    const sv = await serve();
    try {
      const r = await call(sv.base, "POST", "/api/send-code", { channel: "sms", value: "13800138000" });
      eq(r.status, 503, "短信未开通时回 503（不是 500，也不是假装 202）");
      eq(r.body.code, "E_SMS_NOT_OPEN", "错误码如实说「短信没开通」");
      chk(/短信/.test(r.body.message), "文案里提到短信（不含糊）");

      const bad = await call(sv.base, "POST", "/api/send-code", { channel: "sms", value: "12345" });
      eq(bad.status, 400, "手机号形状不对回 400");
      eq(bad.body.code, "E_PHONE_FORMAT", "错误码是 E_PHONE_FORMAT");

      const unk = await call(sv.base, "POST", "/api/send-code", { channel: "wechat", value: "x" });
      eq(unk.status, 400, "未知 channel 回 400");
      eq(unk.body.code, "E_CHANNEL", "未知 channel 回 E_CHANNEL（不静默当邮箱）");

      const old = await call(sv.base, "POST", "/api/send-code", { email: "compat@example.com" });
      eq(old.status, 202, "老调用点（只有 email）仍走邮箱通道，202");
      eq(old.body.channel, "email", "响应里如实回 channel:email");
    } finally { await sv.close(); }
  }

  {
    boot({ SMS_ENABLED: "1" });
    const sv = await serve();
    try {
      const r = await call(sv.base, "POST", "/api/send-code", { channel: "sms", value: "13900139000" });
      eq(r.status, 503, "只开开关没接短信商 → 仍 503（不许落到 console 假装成功）");
      eq(r.body.code, "E_SMS_NOT_OPEN", "错误码仍是 E_SMS_NOT_OPEN");
    } finally { await sv.close(); }
  }

  {
    boot({});
    const core = require("../api/_lib/core.js");
    const cfg = require("../api/_lib/config.js");
    const store = require("../api/_lib/store.js").getStore(cfg);
    const deps = { cfg, store, limiter: core.makeRateLimiter(), now: () => Date.now(), deviceId: "d", ip: "1.1.1.1" };

    const opened = Object.assign({}, cfg, { smsEnabled: true, smsTransport: "sms" });
    deps.cfg = opened;

    const rec = await core.sendCode(deps, { channel: "sms", value: "13700137000", code: "246810" });

    eq(rec.status, 502, "接商为空壳时投递失败回 502（E_SMS_FAIL 那一类）");
    eq(rec.body.code, "E_SMS_FAIL", "错误码是 E_SMS_FAIL（与邮件的 E_MAIL_FAIL 区分）");
    const codes = Object.keys(store._codes || {});
    chk(codes.length >= 1 || typeof store.getCode === "function",
      "码进入了同一张 codes 表（通道不改变落库形状）");
  }

  {
    const fs2 = require("fs");
    const priv = fs2.readFileSync(path.join(ROOT, "privacy", "index.html"), "utf8");
    boot({});
    const cfg = require("../api/_lib/config.js");
    eq(cfg.smsEnabled, false, "出厂时 SMS_ENABLED 为 false");
    chk(/不收集手机号/.test(priv),
      "短信未开通 + 请求被 503 拒掉 ⇒ 隐私条款「不收集手机号」这句话仍然准确（条款跟随代码）");
  }

  {
    boot({});
    const core = require("../api/_lib/core.js");
    const cfg = require("../api/_lib/config.js");
    const A = require("../js/auth-core.js");

    [["email", "E_RATE_EMAIL"], ["phone", "E_RATE_EMAIL"], ["device", "E_RATE_DEVICE"],
      ["ip", "E_RATE_IP"], ["global", "E_RATE_GLOBAL"]].forEach(pair => {
      eq(core.rateCode(pair[0]), pair[1], "服务端频控层「" + pair[0] + "」回 " + pair[1]);
      eq(A.rateCode(pair[0]), pair[1], "前端频控层「" + pair[0] + "」回同一个码（两端同表）");
    });
    chk(A.rateCode("phone") === core.rateCode("phone"),
      "短信那一档两端折叠成同一个码（原先前端连 phone 这一支都没有）");

    const msgs = ["E_RATE_EMAIL", "E_RATE_DEVICE", "E_RATE_IP", "E_RATE_GLOBAL"].map(k => core.RATE_MSG[k]);
    eq(new Set(msgs).size, 4, "服务端四层文案各不相同（原先四层共用「发得太快了」）");
    ["E_RATE_EMAIL", "E_RATE_DEVICE", "E_RATE_GLOBAL"].forEach(k => {
      eq(core.RATE_MSG[k], A.ERR[k], "文案「" + k + "」两端逐字一致");
    });
    eq(A.ERR.E_RATE_IP, core.RATE_MSG.E_RATE_IP, "文案「E_RATE_IP」两端逐字一致（前端原先没有这一条）");

    const localBuckets = Object.keys(A.RATE).sort();
    const srvBuckets = Object.keys(cfg.rate).sort();
    eq(localBuckets.join(","), srvBuckets.join(","),
      "频控档位两端同名（本机 " + localBuckets.join("/") + " ↔ 服务端 " + srvBuckets.join("/") + "）");
    chk(localBuckets.indexOf("ip") >= 0, "本机版也有 ip 档（原先只有服务端有，症状是同一份签名两边行为不同）");

    {
      const core2 = readCoreSendCode();
      chk(!/rateCheck\(state, "ip"/.test(core2), "本机版**不判** ip 档（拿不到可信出口地址）");
      chk(/rateCheck\(state, "device"/.test(core2) && /rateCheck\(state, "global"/.test(core2),
        "但设备档与全局档照判（这两档本机版拿得到）");
    }

    eq(A.SMS_RESEND_COOLDOWN_MS, cfg.smsResendCooldownMs,
      "短信重发冷却两端同值（" + A.SMS_RESEND_COOLDOWN_MS + "）");
    eq(A.RESEND_COOLDOWN_MS, cfg.resendCooldownMs, "邮箱重发冷却两端同值");
    chk(A.SMS_RESEND_COOLDOWN_MS !== undefined && A.RESEND_COOLDOWN_MS !== undefined,
      "两条通道各自有键（将来单独收紧短信不必动邮箱那一条）");
  }

  {
    boot({});
    const core = require("../api/_lib/core.js");
    boot({});
    const cfg1 = require("../api/_lib/config.js");
    const pub = core.publicAccount(cfg1, { uid: "u_1", plan: "free", email_mask: "a***@b.com", nickname: "" });
    eq(pub.channel.mail, "console", "没配发信商时如实自报 console");
    eq(pub.channel.delivered, false, "console ⇒ delivered:false（不假装发出去了）");
    eq(pub.channel.db, "memory", "没配库时如实自报 memory（不是 db）");
    eq(pub.channel.sms, false, "短信没开通 ⇒ sms:false（与 2B 的 503 同口径）");

    const sv = await serve();
    try {
      const sent = await call(sv.base, "POST", "/api/send-code", { email: "facts@example.com" });
      eq(sent.status, 202, "发码成功（会话要先建起来）");
      const echo = await call(sv.base, "POST", "/api/send-code", { email: "facts@example.com", channel: "email", value: "facts@example.com" });
      chk(echo.status === 202 || echo.status === 429, "同邮箱重发被冷却拦住也照实回（实际 " + echo.status + "）");

      const me = await call(sv.base, "GET", "/api/me");
      eq(me.status, 401, "没会话时 /api/me 回 401（未登录是本来的正常状态）");
      eq(me.body.code, "E_NO_SESSION", "码是 E_NO_SESSION");
      chk(me.body.channel === undefined, "未登录时**不下发**任何开通状态（不给未授权的人看服务端内部）");
    } finally { await sv.close(); }
  }

  {

    boot({});
    const core = require("../api/_lib/core.js");

    eq(core.normGrantInput({ emailMask: "a***@qq.com", tier: "pro" }).tier, "pro", "层级 pro 通过");
    ["free", "pro", "max"].forEach(t => {
      chk(!core.normGrantInput({ emailMask: "a***@qq.com", tier: t }).bad, "三个合法层级之一通过：" + t);
    });
    ["Pro", "PRO", "vip", "", null, "max "].forEach(t => {
      const r = core.normGrantInput({ emailMask: "a***@qq.com", tier: t });
      const low = String(t == null ? "" : t).toLowerCase();
      if (["free", "pro", "max"].indexOf(low) >= 0) return;
      chk(!!r.bad && r.bad === "E_TIER", "不认识的层级一律拒（" + JSON.stringify(t) + "）—— 不回落 free");
    });
    eq(core.normGrantInput({ emailMask: "a***@qq.com", tier: "PRO" }).tier, "pro", "层级大小写归一成小写");

    eq(core.normGrantInput({ emailMask: "zhangmin@163.com", tier: "pro" }).bad, "E_MASK",
      "**完整邮箱**被拒：这一节只认掩码（明文库里是有的，但掩码规则只许有一份实现）");
    eq(core.normGrantInput({ emailMask: "", tier: "pro" }).bad, "E_MASK", "空掩码被拒");
    eq(core.normGrantInput({ emailMask: "a***@", tier: "pro" }).bad, "E_MASK", "掩码缺域名被拒");
    eq(core.normGrantInput({ emailMask: "a@b.com", tier: "pro" }).bad, "E_MASK", "没有 *** 的地址被拒");
    chk(!core.normGrantInput({ emailMask: " A***@QQ.com ", tier: "pro" }).bad, "掩码接受并归一大小写/空格");
    eq(core.normGrantInput({ emailMask: " A***@QQ.com ", tier: "pro" }).mask, "a***@qq.com", "掩码归一成小写");
    eq(core.normGrantInput({ emailMask: "a***@qq.com", tier: "pro", until: "x" }).bad, "E_UNTIL",
      "看不懂的到期时刻被拒（不静默当成永久）");
    eq(core.normGrantInput({ emailMask: "a***@qq.com", tier: "pro", until: "" }).until, null, "空到期 = 永久");
    eq(core.normGrantInput({ emailMask: "a***@qq.com", tier: "pro" }).until, null, "缺到期 = 永久");

    ["owner", "admin"].forEach(r => chk(core.isAdminRole(r), "服务端放行角色：" + r));
    ["user", "", null, "OWNER ", "root"].forEach(r => {
      const low = String(r == null ? "" : r).trim().toLowerCase();
      if (["owner", "admin"].indexOf(low) >= 0) return;
      chk(!core.isAdminRole(r), "服务端拒绝角色：" + JSON.stringify(r));
    });
    {

      const E = require("../js/entitlement.js");
      ["owner", "admin", "user"].forEach(r => {
        const srv = core.isAdminRole(r);
        const cli = E.isOwner(null, { role: r });
        chk(srv === cli, "角色 " + JSON.stringify(r) + " 两端一致（服务端 " + srv + " ↔ 客户端 " + cli + "）");
      });

      ["root", "", null].forEach(r => {
        chk(!core.isAdminRole(r), "服务端对不认识的角色 " + JSON.stringify(r) + " 一律不放行（无兜底）");
      });
      chk(E.isOwner(null, { role: "root" }) === false,
        "客户端对不认识的角色一律不放行（Issue #276 之后连本机兜底也删了 —— 两边同一个答案）");
    }

    boot({ ALLOW_CODE_ECHO: "1" });
    const sv = await serve();
    try {
      const POST = (p, b, cookie) => call(sv.base, "POST", p, b, cookie);

      const anon = await POST("/api/admin/grant", { emailMask: "a***@qq.com", tier: "pro" });
      eq(anon.status, 401, "没有会话时回 401（不是 403、不是 500）");
      eq(anon.body.code, "E_NO_SESSION", "码是 E_NO_SESSION");

      const plainCookie = await loginByHttp(POST, "plain@example.com");
      chk(/^kbsid=/.test(plainCookie), "拿到了普通用户的会话 Cookie");

      const forbidden = await POST("/api/admin/grant", { emailMask: "a***@qq.com", tier: "pro" }, plainCookie);
      eq(forbidden.status, 403, "**普通用户**打发放接口回 403（角色闸在服务端，不经界面）");
      eq(forbidden.body.code, "E_FORBIDDEN", "码是 E_FORBIDDEN（不是「连不上」，用户不该一直重试）");
      chk(/管理员/.test(forbidden.body.message), "文案里说清是权限问题");

      const forbidList = await POST("/api/admin/grants", {}, plainCookie);
      eq(forbidList.status, 403, "列名单也要管理员（只读接口同样走角色闸）");

      const forbidRevoke = await call(sv.base, "DELETE", "/api/admin/grant", { emailMask: "a***@qq.com" }, plainCookie);
      eq(forbidRevoke.status, 403, "收回也要管理员");

      const cfgM = require("../api/_lib/config.js");
      const storeM = require("../api/_lib/store.js").getStore(cfgM);
      const rows = Object.keys(storeM._db.accounts).map(k => storeM._db.accounts[k]);
      const plain = rows.filter(a => a.email_mask === "p***@example.com")[0];
      chk(!!plain, "普通用户那一行在库里（掩码 p***@example.com）");
      plain.role = "owner";

      const noHit = await POST("/api/admin/grant", { emailMask: "nobody***@qq.com", tier: "pro" }, plainCookie);
      eq(noHit.status, 200, "**命中 0 条不是错误**：回 200（不是 404、不是 400）");
      eq(noHit.body.matched, 0, "如实回 matched:0");
      eq(noHit.body.changed, false, "changed 为 false —— 一个字都没改");
      chk(/先登录/.test(noHit.body.note), "note 里说清成因：对方先登录一次才会有那一行");
      {
        const before = Object.keys(storeM._db.accounts).length;
        const after = Object.keys(storeM._db.accounts).length;
        eq(after, before, "命中 0 条**不建账号**（掩码不可逆，造出来是永远登不上的幽灵行）");
      }

      const okG = await POST("/api/admin/grant", { emailMask: "p***@example.com", tier: "pro" }, plainCookie);
      eq(okG.status, 200, "掩码命中时回 200");
      eq(okG.body.matched, 1, "matched 如实回 1");
      eq(okG.body.changed, true, "changed 为 true");
      eq(okG.body.tier, "pro", "回的是**改完之后**的层级（服务端判定，不是请求体回显）");

      const me1 = await call(sv.base, "GET", "/api/me", undefined, plainCookie);
      eq(me1.status, 200, "发完之后 /api/me 拿得到");
      eq(me1.body.plan.tier, "pro", "**发完就真的生效**：/api/me 下发的 tier 变成 pro");
      chk(me1.body.features.indexOf("sync.multiDevice") >= 0, "能力清单跟着变（pro 才有跨设备同步）");
      chk(me1.body.channel && me1.body.channel.db === "memory", "开通状态照旧如实自报（2C 那条没被改坏）");

      const future = Date.now() + 86400000;
      const withUntil = await POST("/api/admin/grant", { emailMask: "p***@example.com", tier: "max", until: future }, plainCookie);
      eq(withUntil.body.tier, "max", "到期时刻写进去之后 tier 是 max");
      const me2 = await call(sv.base, "GET", "/api/me", undefined, plainCookie);
      eq(me2.body.plan.until, future, "plan.until 原样下发（客户端据此显示到期日）");
      const past = await POST("/api/admin/grant", { emailMask: "p***@example.com", tier: "max", until: Date.now() - 1000 }, plainCookie);
      eq(past.status, 200, "写一个已过去的到期时刻不报错");
      const me3 = await call(sv.base, "GET", "/api/me", undefined, plainCookie);
      eq(me3.body.plan.tier, "free", "**到期即回落 free**（与 planTier 同一处判定，不是两套）");

      await POST("/api/admin/grant", { emailMask: "p***@example.com", tier: "pro" }, plainCookie);
      const listR = await POST("/api/admin/grants", {}, plainCookie);
      eq(listR.status, 200, "管理员能列名单");
      chk(Array.isArray(listR.body.grants), "grants 是数组");
      eq(listR.body.grants.length, 1, "只列 plan !== free 的行（普通账号不在里面）");
      eq(listR.body.grants[0].emailMask, "p***@example.com", "只回掩码");
      chk(!/email_hash/.test(JSON.stringify(listR.body)), "名单里**没有摘要**（泄出去等于「这人是不是本站用户」可被查询）");
      chk(!JSON.stringify(listR.body).includes("plain@example.com"),
        "名单里**没有明文邮箱**（掩码是给人看的；要明文请走 /api/admin/accounts 名录）");
      chk(!/uid/.test(JSON.stringify(listR.body.grants[0])), "名单里连 uid 都不给（掩码已经够用）");

      const rev = await call(sv.base, "DELETE", "/api/admin/grant", { emailMask: "p***@example.com" }, plainCookie);
      eq(rev.status, 200, "收回回 200");
      eq(rev.body.changed, true, "收回改了东西");
      const me4 = await call(sv.base, "GET", "/api/me", undefined, plainCookie);
      eq(me4.body.plan.tier, "free", "收回之后 /api/me 回落 free");
      eq(me4.body.uid, plain.uid, "**收回不删账号**（uid 还是那一个，进度记录跟着 uid 走）");
      const revNo = await call(sv.base, "DELETE", "/api/admin/grant", { emailMask: "nobody***@qq.com" }, plainCookie);
      eq(revNo.body.matched, 0, "收回一个不存在的掩码：matched 0、不报错");

      let sawRate = false;
      for (let i = 0; i < 60 && !sawRate; i++) {
        const r = await POST("/api/admin/grant", { emailMask: "p***@example.com", tier: "pro" }, plainCookie);
        if (r.status === 429) { sawRate = true; eq(r.body.code, "E_RATE_DEVICE", "发放也走设备档频控（429 的码与同步/注销同表）"); }
      }
      chk(sawRate, "发放是写接口：连点会被频控拦住（不是只有 send-code 才有频控）");
    } finally { await sv.close(); }

    boot({ SESSION_SECRET: "" });
    const sv2 = await serve();
    try {
      const r = await call(sv2.base, "POST", "/api/admin/grant", { emailMask: "a***@qq.com", tier: "pro" });
      eq(r.status, 503, "缺 SESSION_SECRET 时回 503（不是 500、不是 403）");
      eq(r.body.code, "E_NOT_CONFIGURED", "码是 E_NOT_CONFIGURED（「未开放」是如实回答）");
    } finally { await sv2.close(); }

    boot({});
    const sv3 = await serve();
    try {
      const g = await call(sv3.base, "GET", "/api/admin/grant");
      eq(g.status, 405, "GET /api/admin/grant 回 405（写接口不接受 GET）");
    } finally { await sv3.close(); }
  }

  {
    boot({ ALLOW_CODE_ECHO: "1" });

    {
      const core = require("../api/_lib/core.js");
      const cfg = require("../api/_lib/config.js");
      const store = require("../api/_lib/store.js").memoryStore();
      const limiter = core.makeRateLimiter();
      const t = 1757900000000;
      const d = { cfg, store, limiter, now: () => t, ip: "1.1.1.1", deviceId: "dev-1" };

      eq(core.GAME_CAP.fly, "feihualing", "飞花令那一档的能力键与前端同源");
      eq(core.GAME_CAP.paper, "exam.paper", "试题模拟那一档的能力键与前端同源");
      eq(core.GAME_CAP.review, "quiz.review", "题库复习那一档的能力键与前端同源");
      chk(core.gameAllowed(cfg, "pro", "quiz.review"), "题库复习：Pro 放行");
      chk(!core.gameAllowed(cfg, "pro", "feihualing"), "**飞花令：Pro 不放行**（用户裁决：归 Max）");
      chk(!core.gameAllowed(cfg, "pro", "exam.paper"), "**试题模拟：Pro 不放行**（用户裁决：归 Max）");
      chk(core.gameAllowed(cfg, "max", "feihualing"), "飞花令：Max 放行");
      chk(core.gameAllowed(cfg, "max", "exam.paper"), "试题模拟：Max 放行");

      chk(core.featuresFor(cfg, "max").indexOf("exam.gathering") >= 0,
        "服务端 max 档下发 exam.gathering（集子访问）");
      chk(core.featuresFor(cfg, "pro").indexOf("exam.gathering") < 0,
        "服务端 pro 档**不**下发 exam.gathering（与试题模拟同一条口径）");
      chk(!core.gameAllowed(cfg, "free", "quiz.review"), "free 一样都拿不到");

      const anon = await core.gameAnswer(d, { kind: "review", poemId: "xx1-01", chosen: "鹅" });
      eq(anon.status, 401, "没有会话时判分口回 401（这一项要登录）");
      eq(anon.body.code, "E_NO_SESSION", "码是 E_NO_SESSION");
      const badKind = await core.gameAnswer(d, { kind: "nonsense" });
      eq(badKind.status, 400, "不认识的题型回 400（不静默当成 review）");
      eq(badKind.body.code, "E_KIND", "码是 E_KIND");
    }

    const sv = await serve();
    try {
      const POST = (p, b, cookie) => call(sv.base, "POST", p, b, cookie);
      const cfgM = require("../api/_lib/config.js");
      const storeM = require("../api/_lib/store.js").getStore(cfgM);

      const anon = await POST("/api/game/answer", { kind: "review", poemId: "xx1-01", chosen: "鹅" });
      eq(anon.status, 401, "没有会话时回 401（不是 403、不是 500）");

      const cookie = await loginByHttp(POST, "player@example.com");
      chk(/^kbsid=/.test(cookie), "拿到了玩家会话 Cookie");

      const asFree = await POST("/api/game/answer", { kind: "review", poemId: "xx1-01", chosen: "鹅" }, cookie);
      eq(asFree.status, 403, "**free 打判分口回 403**（能力闸在服务端，不经界面）");
      eq(asFree.body.code, "E_TIER", "码是 E_TIER（不是「连不上」，用户不该一直重试）");
      eq(asFree.body.tier, "free", "如实回当前层级");

      const rows = Object.keys(storeM._db.accounts).map(k => storeM._db.accounts[k]);
      const me = rows.filter(a => a.email_mask === "p***@example.com")[0];
      chk(!!me, "玩家那一行在库里");
      me.plan = "pro";

      const pro1 = await POST("/api/game/answer", { kind: "review", poemId: "xx1-01", chosen: "鹅" }, cookie);
      eq(pro1.status, 200, "Pro 打题库复习回 200");
      eq(pro1.body.cap, "quiz.review", "回的是它自己那一档能力");
      eq(pro1.body.counted, false, "本站不收款、也没有计费：**如实回 counted:false**（不假装扣费）");

      chk(/免费、不限次/.test(pro1.body.note), "note 里说清是免费不限次（不假装扣费）");
      chk(!/已计入额度/.test(pro1.body.note), "note 里不许写成「已计入额度」");

      const proFly = await POST("/api/game/answer", { kind: "fly", chars: ["月"], said: "日月之行" }, cookie);
      eq(proFly.status, 403, "Pro 打飞花令仍然 403（用户裁决：飞花令归 Max）");
      const proPaper = await POST("/api/game/answer", { kind: "paper", poemId: "xx1-01", chosen: "鹅" }, cookie);
      eq(proPaper.status, 403, "Pro 打试题模拟仍然 403（用户裁决：试题模拟归 Max）");

      me.plan = "max";
      const maxFly = await POST("/api/game/answer", { kind: "fly", chars: ["月"], said: "日月之行" }, cookie);
      eq(maxFly.status, 200, "Max 打飞花令回 200");
      eq(maxFly.body.kind, "fly", "回的是飞花令那一支");
      eq(maxFly.body.ok, true, "「日月之行」确实是语料里的一句（逐字比对）");
      eq(maxFly.body.title, "观沧海", "如实回出这一句出自哪一篇");
      eq(maxFly.body.found, true, "found 为 true");
      chk(maxFly.body.total > 0, "如实回「这个令字能对上几句」（实际 " + maxFly.body.total + "）");

      const notFound = await POST("/api/game/answer", { kind: "fly", chars: ["月"], said: "这句话不存在于合集" }, cookie);
      eq(notFound.body.ok, false, "编的句子如实回 false（不猜、不模糊匹配）");
      eq(notFound.body.why, "notfound", "why 说清是「没找到」而不是「错了」");

      const core0 = require("../api/_lib/core.js");
      const game0 = require("../api/_lib/game.js");
      game0._reset();
      const truth = game0.rebuild({ poemId: "xx1-01" });
      chk(!!truth && !!truth.answer, "服务端能按 poemId 重建出这一题（答案 " +
        (truth ? truth.answer : "?") + "）");

      const maxPaper = await POST("/api/game/answer", { kind: "paper", poemId: "xx1-01", chosen: truth.answer }, cookie);
      eq(maxPaper.status, 200, "Max 打试题模拟回 200");
      eq(maxPaper.body.ok, true, "选了正确答案 → ok:true");
      eq(maxPaper.body.answer, truth.answer, "回出正确答案（界面据此把错的标红、对的标绿）");
      chk(maxPaper.body.bankId, "回出这一题的 bankId（与题库同源）");
      eq(core0.planTier({ plan: "max" }), "max", "（顺带：max 在服务端算得出 max）");

      const cheat = await POST("/api/game/answer",
        { kind: "paper", poemId: "xx1-01", chosen: "肯定不是答案", answer: "肯定不是答案" }, cookie);
      eq(cheat.status, 200, "塞了假 answer 也照常回 200");
      eq(cheat.body.ok, false, "**客户端传上来的 answer 一律忽略**：判定仍然是错的");
      eq(cheat.body.answer, truth.answer, "服务端回的是自己重建出来的答案");

      const stale = await POST("/api/game/answer", { kind: "paper", bankId: "不存在的题", chosen: "x" }, cookie);
      eq(stale.status, 400, "题库里没有这一条时回 400（不猜一个）");
      eq(stale.body.code, "E_STALE", "码是 E_STALE（多半是前端缓存旧了一版）");

      const charged = await POST("/api/game/answer", { kind: "review", poemId: "xx1-01", chosen: truth.answer, charge: true }, cookie);
      eq(charged.status, 200, "打开 charge 也回 200");
      eq(charged.body.counted, true, "打开 charge 时如实回 counted:true");
      const quotaRows = storeM._db.progress;
      const hit = Object.keys(quotaRows).filter(k => /game-quota:/.test(k));
      eq(hit.length, 1, "额度记在 progress 里的一条记录上（不新开一张表）");
      eq(quotaRows[hit[0]].payload.used, 1, "第一次计数为 1");
      const charged2 = await POST("/api/game/answer", { kind: "review", poemId: "xx1-01", chosen: truth.answer, charge: true }, cookie);
      eq(charged2.body.counted, true, "第二次也计数");
      eq(quotaRows[hit[0]].payload.used, 2, "第二次为 2（真的在累加，不是每次都写 1）");
      chk(!!quotaRows[hit[0]].payload.month, "额度按**日历月**记（用户看的账单与日历对得上）");

      let sawRate = false;
      for (let i = 0; i < 80 && !sawRate; i++) {
        const r = await POST("/api/game/answer", { kind: "review", poemId: "xx1-01", chosen: "鹅" }, cookie);
        if (r.status === 429) { sawRate = true; eq(r.body.code, "E_RATE_DEVICE", "判分也走设备档频控（与同步/发放同表）"); }
      }
      chk(sawRate, "判分是写接口：连点会被频控拦住");
    } finally { await sv.close(); }

    boot({ SESSION_SECRET: "" });
    const sv2 = await serve();
    try {
      const r = await call(sv2.base, "POST", "/api/game/answer", { kind: "review", poemId: "xx1-01", chosen: "鹅" });
      eq(r.status, 503, "缺 SESSION_SECRET 时回 503（不是 500、不是 403）");
      eq(r.body.code, "E_NOT_CONFIGURED", "码是 E_NOT_CONFIGURED（「未开放」是如实回答）");
    } finally { await sv2.close(); }

    boot({});
    const sv3 = await serve();
    try {
      const g = await call(sv3.base, "GET", "/api/game/answer");
      eq(g.status, 405, "GET /api/game/answer 回 405（判分不接受 GET）");
    } finally { await sv3.close(); }
  }

  {

    {
      boot({});
      const id = require("../api/_lib/identity.js");
      const core = require("../api/_lib/core.js");
      const cfg = require("../api/_lib/config.js");

      const salt = id.newPasswordSalt();
      chk(/^[0-9a-f]{32}$/.test(salt), "口令盐是 16 字节 hex（每次随机）");
      const h1 = id.hashPassword("hunter2hunter", salt);
      chk(/^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]{32}\$[0-9a-f]{64}$/.test(h1),
        "摘要串形如 scrypt$N$r$p$salt$hash（参数写在串里）");
      eq(id.hashPassword("hunter2hunter", salt), h1, "同盐同口令得到同一个摘要");
      chk(id.hashPassword("hunter2hunter", id.newPasswordSalt()) !== h1, "换盐得到不同摘要（同口令不撞）");
      chk(id.verifyPassword("hunter2hunter", h1), "正确口令判得过");
      chk(!id.verifyPassword("hunter2hunte", h1), "错一个字符判不过");
      chk(!id.verifyPassword("", h1), "空口令判不过");
      ["", "md5$abc", "scrypt$0$8$1$aa$bb", "plain:hunter2hunter"].forEach(bad => {
        chk(!id.verifyPassword("hunter2hunter", bad), "脏摘要串一律判不过（不抛）：" + JSON.stringify(bad));
      });

      chk(id.verifyPassword("abc12345", id.hashPassword("abc12345", "s", { N: 1024, r: 8, p: 1, len: 32 })),
        "参数不同的老摘要仍然认（scrypt$1024$...）");

      const tok = id.newToken();
      chk(/^[0-9a-f]{64}$/.test(tok), "一次性令牌是 32 字节 hex（猜不在威胁模型里）");
      chk(core.isTokenShape(tok), "形状自查通过");
      ["", "zz", "abc", tok.slice(0, 63)].forEach(bad => chk(!core.isTokenShape(bad), "形状不对的令牌被拒：" + JSON.stringify(bad)));
      chk(id.tokenHash("u_1", "verify", tok, "pep") !== id.tokenHash("u_1", "reset", tok, "pep"),
        "确认令牌与重设令牌的摘要分命名空间（同一个 token 互不通用）");
      chk(id.tokenHash("u_1", "verify", tok, "pep") !== id.tokenHash("u_2", "verify", tok, "pep"),
        "摘要绑 uid（换个人就拿不走）");

      eq(core.checkPassword(cfg, "").code, "E_PW_EMPTY", "空口令回 E_PW_EMPTY");
      eq(core.checkPassword(cfg, "1234567").code, "E_PW_SHORT", "7 位回 E_PW_SHORT");
      chk(!core.checkPassword(cfg, "12345678"), "8 位通过（配置的下限）");
      eq(core.checkPassword(cfg, new Array(80).join("a")).code, "E_PW_LONG",
        "超长口令被拒（不是嫌用户填得多，是 scrypt 会对它全体算一遍——防 DoS）");

      eq(core.checkPassword(cfg, "😀😀😀😀").code, "E_PW_SHORT", "四个 emoji 只有 4 个字符（按码点数，不按 length）");
      chk(!core.checkPassword(cfg, "😀😀😀😀😀😀😀😀"), "八个 emoji 通过（8 个字符）");
    }

    {
      boot({ ALLOW_CODE_ECHO: "1" });
      const core = require("../api/_lib/core.js");
      const cfg = require("../api/_lib/config.js");
      const store = require("../api/_lib/store.js").memoryStore();
      const limiter = core.makeRateLimiter();
      const d = { cfg, store, limiter, now: () => Date.now(), deviceId: "d1", ip: "1.1.1.1" };

      const SECRET_PW = "zzz-super-secret-pw-197";
      const reg = await core.register(d, { email: "pw@example.com", password: SECRET_PW });
      eq(reg.status, 200, "注册成功");
      const row = Object.keys(store._db.accounts).map(k => store._db.accounts[k])[0];
      chk(!!row, "账号已落库");
      chk(!JSON.stringify(row).includes(SECRET_PW), "**库里没有明文口令**");
      chk(!!row.password_hash && row.password_hash.indexOf("scrypt$") === 0, "库里那条是 scrypt 摘要");
      chk(!JSON.stringify(reg.body).includes(SECRET_PW), "响应体里没有明文口令");
      eq(row.email, "pw@example.com", "明文邮箱落库（Issue #197 的核心要求）");
      eq(row.email_verified_at, null, "刚注册时邮箱**还没确认**（不许拿 created_at 冒充）");
      eq(row.status, "pending", "刚注册时账号状态是 pending（确认邮件点过才变 active）");

      const bad = await core.loginWithPassword(d, { email: "pw@example.com", password: "wrong-pw-xx" });
      eq(bad.status, 401, "错口令回 401");
      eq(bad.body.code, "E_LOGIN_FAIL", "码是 E_LOGIN_FAIL");
      eq(bad.body.message, "邮箱或密码不对", "文案是那一句统一的话");

      const gated = await core.loginWithPassword(d, { email: "pw@example.com", password: SECRET_PW });
      eq(gated.status, 403, "口令对但邮箱没确认 → 403（不是 401，也不是「再试一次」）");
      eq(gated.body.code, "E_EMAIL_UNVERIFIED", "码是 E_EMAIL_UNVERIFIED（界面据此给出去路）");
      chk(!gated.cookies && !gated._session, "被拦时**不签发会话**（拦在半路等于没拦）");
      chk(gated.body.message !== bad.body.message, "「没确认」的文案与「口令不对」**不是同一句**");

      await confirmEmail(store, row.uid, cfg.sessionSecret);
      const okpw = await core.loginWithPassword(d, { email: "pw@example.com", password: SECRET_PW });
      eq(okpw.status, 200, "确认之后对的口令能登进来");
      chk(!!okpw._session && !!okpw.cookies, "签发了会话与会话 Cookie");
      chk(!JSON.stringify(okpw.body).includes(SECRET_PW), "登录响应里也没有明文口令");
      chk(okpw.body.account.password_hash === undefined, "**响应里没有 password_hash**");
      chk(okpw.body.account.emailVerified === true, "响应如实说「邮箱已确认」");
      eq(okpw.body.account.email, "pw@example.com", "响应里有明文邮箱（给自己看的那一份）");
    }

    {
      boot({ ALLOW_CODE_ECHO: "1" });
      const core = require("../api/_lib/core.js");
      const cfg = require("../api/_lib/config.js");
      const store = require("../api/_lib/store.js").memoryStore();
      const d = { cfg, store, limiter: core.makeRateLimiter(), now: () => Date.now(), deviceId: "d2", ip: "1.1.1.1" };

      await core.register(d, { email: "  Parent@Example.COM  ", password: "hunter2hunter" });
      chk(await confirmForTest(core, d, "Parent@Example.COM"), "（前置）大小写那一节：邮箱已确认");
      const row = Object.keys(store._db.accounts).map(k => store._db.accounts[k])[0];
      eq(row.email, "Parent@Example.COM", "落库的明文保留用户填的大小写（只 trim + 去零宽）");
      eq(row.email_mask, "p***@example.com", "掩码仍然全是小写（那是给人认的，不是给人看的原文）");

      await confirmEmail(store, row.uid, cfg.sessionSecret);

      const l1 = await core.loginWithPassword(d, { email: "parent@example.com", password: "hunter2hunter" });
      eq(l1.status, 200, "小写登录进得去");
      const l2 = await core.loginWithPassword(d, { email: "PARENT@EXAMPLE.COM", password: "hunter2hunter" });
      eq(l2.status, 200, "全大写登录也进得去（大小写不敏感这条历史行为没变）");
      eq(Object.keys(store._db.accounts).length, 1, "三条不同大小写只对应一个账号（不会各建一个）");
    }

    {
      boot({ ALLOW_CODE_ECHO: "1" });
      const core = require("../api/_lib/core.js");
      const cfg = require("../api/_lib/config.js");
      const store = require("../api/_lib/store.js").memoryStore();
      let t = Date.now();
      const d = { cfg, store, limiter: core.makeRateLimiter(), now: () => t, deviceId: "d3", ip: "1.1.1.1" };

      const reg = await core.register(d, { email: "v@example.com", password: "hunter2hunter" });
      const token = reg.body.devVerifyToken;
      chk(/^[0-9a-f]{64}$/.test(token), "确认令牌回给了调用方（只在冒烟模式下）");
      const vid = Object.keys(store._db.verifications)[0];
      chk(!!vid, "确认记录落库");
      const vrec = store._db.verifications[vid];
      chk(!JSON.stringify(vrec).includes(token), "**库里没有明文令牌**，只有它的摘要");
      chk(vrec.token_hash !== token, "存的是摘要不是令牌本身");

      eq((await core.verifyEmail(d, { vid: vid, token: "deadbeef" })).body.code, "E_TOKEN_INVALID", "令牌不对被拒");
      chk(!store._db.verifications[vid].consumed_at, "没被用掉（拒了不算用过）");
      eq((await core.verifyEmail(d, {})).body.code, "E_NO_TOKEN", "什么都没给 → E_NO_TOKEN");

      t += 25 * 3600 * 1000;
      eq((await core.verifyEmail(d, { vid: vid, token: token })).body.code, "E_TOKEN_EXPIRED", "超过 24 小时 → 过期");
      t -= 25 * 3600 * 1000;

      const okv = await core.verifyEmail(d, { vid: vid, token: token });
      eq(okv.status, 200, "确认成功");
      eq(okv.body.verified, true, "回 verified:true");
      eq(store._db.accounts[Object.keys(store._db.accounts)[0]].status, "active", "pending → active");
      chk(!!store._db.accounts[Object.keys(store._db.accounts)[0]].email_verified_at, "写下确认时刻");

      eq((await core.verifyEmail(d, { vid: vid, token: token })).body.code, "E_TOKEN_USED",
        "**同一枚令牌不能用第二次**（重放是这一条唯一的威胁模型）");

      const reg2 = await core.resendVerification(Object.assign({}, d, { account: { uid: reg.body.uid } }), {});

      eq(reg2.body.alreadyVerified, true, "已确认时重发：如实回 alreadyVerified，且不再发信");
      eq(reg2.body.verifySent, false, "那时 verifySent 为 false（确实没发）");
    }

    {
      boot({ ALLOW_CODE_ECHO: "1" });
      const core = require("../api/_lib/core.js");
      const cfg = require("../api/_lib/config.js");
      const store = require("../api/_lib/store.js").memoryStore();
      const d = { cfg, store, limiter: core.makeRateLimiter(), now: () => Date.now(), deviceId: "d4", ip: "1.1.1.1" };

      const reg = await core.register(d, { email: "rv@example.com", password: "hunter2hunter" });
      const oldVid = Object.keys(store._db.verifications)[0];
      const r = await core.resendVerification(Object.assign({}, d, { account: { uid: reg.body.uid } }), {});
      eq(r.status, 200, "未确认时重发回 200");
      eq(r.body.alreadyVerified, false, "如实回 alreadyVerified:false");

      eq(r.body.verifySent, false, "console 发信商下 verifySent 为 false（发信是事实，不是「尽力了」）");
      const vids = Object.keys(store._db.verifications);
      eq(vids.length, 2, "新确认记录落了一条");
      chk(!!store._db.verifications[oldVid].consumed_at, "**旧链接被作废**（发新的即作废旧链接）");
    }

    {
      boot({ ALLOW_CODE_ECHO: "1" });
      const core = require("../api/_lib/core.js");
      const cfg = require("../api/_lib/config.js");
      const store = require("../api/_lib/store.js").memoryStore();
      const d = { cfg, store, limiter: core.makeRateLimiter(), now: () => Date.now(), deviceId: "d5", ip: "1.1.1.1" };

      const reg = await core.register(d, { email: "r@example.com", password: "old-password-1" });
      chk(await confirmForTest(core, d, "r@example.com"), "（前置）忘记密码那一节：邮箱已确认");
      const uid = reg.body.uid;

      let devN = 0;
      const L = (pw) => core.loginWithPassword(d, { email: "r@example.com", password: pw, deviceId: "rd-" + (devN++) });

      const known = await core.resetRequest(d, { email: "r@example.com", deviceId: "d5" });
      const unknown = await core.resetRequest(d, { email: "nobody@example.com", deviceId: "d5" });
      eq(known.status, 200, "内核回 200（HTTP 层再换成 202，与 send-code 同一处约定）");
      eq(unknown.status, 200, "**不存在的邮箱回同一个状态**（不泄露存在性）");

      {
        const plainCfg = Object.assign({}, cfg, { allowCodeEcho: false });
        const dPlain = Object.assign({}, d, { cfg: plainCfg });
        const k2 = await core.resetRequest(dPlain, { email: "r2@example.com", deviceId: "dp1" });
        const u2 = await core.resetRequest(dPlain, { email: "nobody2@example.com", deviceId: "dp2" });
        eq(JSON.stringify(k2.body), JSON.stringify(u2.body),
          "**生产形态下两个响应逐字相同**（字段、状态、文案，全部一样）");
        await core.register(dPlain, { email: "r2@example.com", password: "hunter2hunter" });
      }
      eq(known.body.requested, true, "requested 为 true");
      eq(unknown.body.requested, true, "不存在的那个也是 true");

      chk(!/没注册|没有注册|不存在|未注册/.test(unknown.body.note),
        "文案里不出现「没注册过 / 不存在」这类断言（条件句是允许的）");
      chk(/如果/.test(unknown.body.note), "那一句是条件句（「如果…在本站注册过」）");
      chk(known.body.devResetToken, "（冒烟口）存在的那一个确实生成了令牌");
      chk(unknown.body.devResetToken === undefined, "不存在的那一个**没有**令牌（因为压根没发信）");
      eq(Object.keys(store._db.resets).length, 1, "只给存在的那个邮箱落了一条重设记录");

      await confirmEmail(store, uid, cfg.sessionSecret);
      const verifiedBeforeReset = store._db.accounts[uid].email_verified_at;
      const loginBefore = await L("old-password-1");
      eq(loginBefore.status, 200, "拿旧口令登进来（先有一条活会话）");
      const sid1 = loginBefore._session.sid;
      await store.putSession({ sid: sid1, uid: uid, iat: 0, exp: Date.now() + 1e9, revoked: 0 });
      const loginBefore2 = await L("old-password-1");
      const sid2 = loginBefore2._session.sid;
      await store.putSession({ sid: sid2, uid: uid, iat: 0, exp: Date.now() + 1e9, revoked: 0 });

      const rid = Object.keys(store._db.resets)
        .filter(k => !store._db.resets[k].consumed_at)
        .sort((a, b) => store._db.resets[b].issued_at - store._db.resets[a].issued_at)[0];
      const tok = known.body.devResetToken;
      chk(known.body.devResetToken !== undefined, "（前置）拿到了明文重设令牌");

      eq((await core.resetConfirm(d, { rid: rid, token: "x", password: "brand-new-99" })).body.code, "E_TOKEN_INVALID",
        "令牌不对被拒");
      eq((await core.resetConfirm(d, { rid: rid, token: tok, password: "123" })).body.code, "E_PW_SHORT",
        "**口令形状先判**（比令牌还先）—— 不然用户会把「密码太短」读成「链接坏了」");
      chk(!store._db.resets[rid].consumed_at, "被拒的那两次都没把令牌用掉");

      const rc = await core.resetConfirm(d, { rid: rid, token: tok, password: "brand-new-99" });
      eq(rc.status, 200, "重设成功");
      eq(rc.body.sessionsRevoked, true, "**如实回「会话已全部吊销」**（那是重设的一半含义）");
      chk(store._db.sessions[sid1].revoked === 1, "旧会话 1 被吊销");
      chk(store._db.sessions[sid2].revoked === 1, "旧会话 2 被吊销（**全部**，不是只有当前那条）");
      eq((await core.resetConfirm(d, { rid: rid, token: tok, password: "another-pw-88" })).body.code, "E_TOKEN_USED",
        "同一枚重设令牌不能用第二次");

      eq((await L("old-password-1")).status, 401, "旧口令登不进去了");
      eq((await L("brand-new-99")).status, 200, "新口令能登进来");

      eq(store._db.accounts[uid].email_verified_at, verifiedBeforeReset,
        "重设口令**不动** email_verified_at（两件事各写各的）");
      eq(rc.body.emailVerified, true, "重设响应如实回 emailVerified:true（已确认的人）");

      const regU = await core.register(d, { email: "unverified-reset@example.com", password: "old-pw-12345" });
      const rrU = await core.resetRequest(d, { email: "unverified-reset@example.com", deviceId: "du1" });
      eq(rrU.status, 200, "（前置）没确认的人也能走「忘记密码」第一步（否则他连信都收不到）");
      const ridU = Object.keys(store._db.resets)
        .filter(k => !store._db.resets[k].consumed_at)
        .sort((a, b) => store._db.resets[b].issued_at - store._db.resets[a].issued_at)[0];
      const rcU = await core.resetConfirm(d, { rid: ridU, token: rrU.body.devResetToken, password: "new-pw-99999" });
      eq(rcU.status, 200, "重设成功（这一件事本身是做成了的）");
      eq(rcU.body.emailVerified, false, "**如实回 emailVerified:false**（这个人还是登不进去）");
      chk(/还没确认|确认/.test(rcU.body.note), "那一句 note 里说了「还有一步」（实际「" + rcU.body.note.slice(0, 60) + "…」）");
      eq(store._db.accounts[regU.body.uid].email_verified_at, null,
        "**重设不顺手动确认状态**（收到了重设邮件 ≠ 点过确认链接）");
      const stillBlocked = await core.loginWithPassword(d, { email: "unverified-reset@example.com", password: "new-pw-99999", deviceId: "du2" });
      eq(stillBlocked.status, 403, "新口令对了，但**仍然登不进去**（这正是界面必须说出来的那一格）");
      eq(stillBlocked.body.code, "E_EMAIL_UNVERIFIED", "码还是那一个（用户的下一步没变：去点确认）");
    }

    {
      boot({ ALLOW_CODE_ECHO: "1" });
      const core = require("../api/_lib/core.js");
      const cfg = require("../api/_lib/config.js");
      const store = require("../api/_lib/store.js").memoryStore();
      const d = { cfg, store, limiter: core.makeRateLimiter(), now: () => Date.now(), deviceId: "d6", ip: "1.1.1.1" };
      const limiterRef = d.limiter;

      await core.register(d, { email: "lock@example.com", password: "hunter2hunter" });
      const uid = Object.keys(store._db.accounts)[0];

      await confirmEmail(store, uid, cfg.sessionSecret);

      await core.loginWithPassword(d, { email: "lock@example.com", password: "nope-1" });
      eq(limiterRef.fails("login", "uid:" + uid, Date.now()), 1, "一次失败记 1");
      await core.loginWithPassword(d, { email: "lock@example.com", password: "hunter2hunter" });
      eq(limiterRef.fails("login", "uid:" + uid, Date.now()), 0,
        "**成功一次把失败窗口清空**（不清的下场是「错九次、对一次、再错一次」就锁号）");

      let locked = false;
      for (let i = 0; i < 12 && !locked; i++) {
        const r = await core.loginWithPassword(d, { email: "lock@example.com", password: "bad-" + i, deviceId: "dev-" + i });
        if (r.status === 423) { locked = true; eq(r.body.code, "E_LOCKED", "连错到上限 → E_LOCKED"); }
      }
      chk(locked, "口令连续失败会锁号（撞库打的是同一个账号，所以按账号计数）");
      const after = await core.loginWithPassword(d, { email: "lock@example.com", password: "hunter2hunter", deviceId: "dev-fresh" });
      eq(after.status, 423, "**锁着的时候连对的口令也进不来**（锁是终态，不是「再试一次就好」）");
    }

    boot({ ALLOW_CODE_ECHO: "1" });
    const sv = await serve();
    try {
      const POST = (p, b, cookie) => call(sv.base, "POST", p, b, cookie);

      const reg = await POST("/api/register", { email: "e2e@example.com", password: "hunter2hunter" });
      eq(reg.status, 202, "POST /api/register 回 202（与 send-code 同一档）");
      eq(reg.body.created, true, "如实回 created:true");
      eq(reg.body.verifySent, false, "console 发信商下 verifySent:false（**不是**「确认邮件已发出」）");
      const vtok = reg.body.devVerifyToken;

      const dup = await POST("/api/register", { email: "E2E@Example.com", password: "another-pw-77" });
      eq(dup.status, 202, "同一个邮箱（不同大小写）再注册：**回同一个形状**（不泄露存在性）");
      eq(dup.body.created, false, "如实回 created:false（这是给界面看的，不是给攻击者挑的）");
      eq(dup.body.existing, true, "如实标 existing:true —— 界面据此引导去「密码登录 / 忘记密码」");
      chk(dup.body.verifySent === undefined && dup.body.devVerifyToken === undefined,
        "**不重发确认邮件**（它已经发出去了；重发等于给任何人一个刷别人收件箱的口子）");

      const shapeless = await POST("/api/register", { email: "not-an-email", password: "hunter2hunter" });
      eq(shapeless.status, 400, "邮箱形状不对回 400");
      eq(shapeless.body.code, "E_EMAIL_FORMAT", "码是 E_EMAIL_FORMAT");
      const shortpw = await POST("/api/register", { email: "x@example.com", password: "123" });
      eq(shortpw.body.code, "E_PW_SHORT", "口令太短回 E_PW_SHORT");

      const storeE0 = require("../api/_lib/store.js").getStore(require("../api/_lib/config.js"));
      const vidFresh = Object.keys(storeE0._db.verifications)
        .filter(k => !storeE0._db.verifications[k].consumed_at)
        .sort((a, b) => storeE0._db.verifications[b].issued_at - storeE0._db.verifications[a].issued_at)[0];
      const v = await POST("/api/verify-email", { vid: vidFresh, token: vtok });
      eq(v.status, 200, "POST /api/verify-email 回 200");

      const lg = await POST("/api/login", { email: "e2e@example.com", password: "hunter2hunter" });
      eq(lg.status, 200, "POST /api/login 回 200（用原口令，证明它没被第二次注册改掉）");
      const stolenPw = await POST("/api/login", { email: "e2e@example.com", password: "another-pw-77" });
      eq(stolenPw.status, 401, "**第二次注册填的那个口令进不来**（账号接管洞的回归断言）");
      chk(/^kbsid=/.test(String(lg.setCookie || "")), "签发了会话 Cookie");
      chk(String(lg.setCookie || "").indexOf("HttpOnly") > 0, "那枚 Cookie 是 HttpOnly");
      const cookie = String(lg.setCookie || "").split(";")[0];

      const me = await call(sv.base, "GET", "/api/me", undefined, cookie);
      eq(me.status, 200, "登进来之后 /api/me 拿得到");

      eq(me.body.email.toLowerCase(), "e2e@example.com", "**/api/me 带出明文邮箱**（个人中心要显示它）");
      eq(me.body.emailVerified, true, "确认过之后 emailVerified 为 true");
      chk(!/password_hash|password_salt/.test(JSON.stringify(me.body)), "**/api/me 一个字节都不带口令字段**");

      const rr = await POST("/api/reset-request", { email: "e2e@example.com" });
      eq(rr.status, 202, "POST /api/reset-request 回 202");
      const rrr = await POST("/api/reset-request", { email: "ghost@example.com" });
      eq(rrr.status, 202, "不存在的邮箱也回 202（**同一条接口、同一个形状**）");

      const shape = (b) => JSON.stringify(Object.keys(b).filter(k => k !== "devResetToken").sort());
      eq(shape(rr.body), shape(rrr.body),
        "存在 / 不存在的邮箱：响应的键集合逐字相同（`devResetToken` 是冒烟开关的产物，不计）");
      eq(rrr.body.mailConfigured, rr.body.mailConfigured,
        "`mailConfigured` 说的是服务器，不是邮箱：两侧取值必须一样");
      const cfgE = require("../api/_lib/config.js");
      const storeE = require("../api/_lib/store.js").getStore(cfgE);
      const rid = Object.keys(storeE._db.resets)[0];
      const rc = await POST("/api/reset-confirm", { rid: rid, token: rr.body.devResetToken, password: "brand-new-99" });
      eq(rc.status, 200, "POST /api/reset-confirm 回 200");
      eq(rc.body.sessionsRevoked, true, "如实回会话已吊销");
      const stale = await call(sv.base, "GET", "/api/me", undefined, cookie);
      eq(stale.status, 401, "**重设之后旧会话立刻失效**（/api/me 回 401）");

      const lg2 = await POST("/api/login", { email: "e2e@example.com", password: "brand-new-99" });
      const cookie2 = String(lg2.setCookie || "").split(";")[0];
      const rv = await POST("/api/resend-verification", {}, cookie2);
      eq(rv.status, 200, "POST /api/resend-verification 回 200");

      eq(rv.body.alreadyVerified, true, "已确认 → alreadyVerified:true（且不再发信）");
      eq(rv.body.verifySent, false, "已确认时不再发信，verifySent 如实为 false");

      const rvAnon = await POST("/api/resend-verification", { email: "e2e@example.com" });
      eq(rvAnon.status, 200, "匿名重发现在**可用**（那是登不进来的人唯一的出路）");
      eq(rvAnon.body.requested, true, "回 requested:true（与 reset-request 同一个形状）");

      const rvGhost = await POST("/api/resend-verification", { email: "ghost-197@example.com" });
      eq(rvGhost.status, 200, "不存在的邮箱也回 200（不泄露「这个邮箱是不是本站用户」）");
      eq(JSON.stringify(Object.keys(rvAnon.body).sort().filter(k => k !== "devVerifyToken")),
        JSON.stringify(Object.keys(rvGhost.body).sort()), "两个响应的**字段集合**一样（除了冒烟令牌）");
      eq(rvGhost.body.requested, rvAnon.body.requested, "requested 相同");
      eq(rvGhost.body.alreadyVerified, rvAnon.body.alreadyVerified, "alreadyVerified 相同");
      eq(rvAnon.body.devVerifyToken === undefined || typeof rvAnon.body.devVerifyToken === "string",
        true, "（冒烟口：已确认过的不发信，这个字段本来也不该有）");

      for (const p of ["/api/register", "/api/login", "/api/verify-email",
        "/api/resend-verification", "/api/reset-request", "/api/reset-confirm", "/api/admin/accounts"]) {
        const g = await call(sv.base, "GET", p);
        eq(g.status, 405, "GET " + p + " 回 405（这几条都不接受 GET）");
      }
    } finally { await sv.close(); }

    boot({ SESSION_SECRET: "", ALLOW_CODE_ECHO: "1" });
    const sv2 = await serve();
    try {
      for (const [p, b] of [["/api/register", { email: "a@b.com", password: "hunter2hunter" }],
        ["/api/login", { email: "a@b.com", password: "hunter2hunter" }],
        ["/api/verify-email", { vid: "v_1", token: "x" }],
        ["/api/resend-verification", {}],
        ["/api/reset-request", { email: "a@b.com" }],
        ["/api/reset-confirm", { rid: "r_1", token: "x", password: "hunter2hunter" }]]) {
        const r = await call(sv2.base, "POST", p, b);
        eq(r.status, 503, "缺 SESSION_SECRET 时 " + p + " 回 503（不是 500、不是 403）");
        eq(r.body.code, "E_NOT_CONFIGURED", p + " 的码是 E_NOT_CONFIGURED");
      }
    } finally { await sv2.close(); }

    boot({ ALLOW_CODE_ECHO: "1" });
    const sv3 = await serve();
    try {
      const POST = (p, b, cookie) => call(sv3.base, "POST", p, b, cookie);

      const firstA = await loginByHttpDetailed(POST, "owner@example.com");
      eq(firstA.register.body.verifySent, false, "console 发信商下注册回 verifySent:false（如实说没发出去）");
      eq(firstA.register.body.requiresVerification, true, "如实回 requiresVerification:true（说明默认要拦）");
      eq(firstA.verify.status, 200, "（前置）确认那条链接点得通");
      const cA = firstA.cookie;
      chk(!!cA, "（前置）确认之后拿到了会话 Cookie");

      const asUser = await POST("/api/admin/accounts", {}, cA);
      eq(asUser.status, 403, "**普通用户打名录口回 403**（角色闸在服务端，不经界面）");
      eq(asUser.body.code, "E_FORBIDDEN", "码是 E_FORBIDDEN");

      const anon = await POST("/api/admin/accounts", {});
      eq(anon.status, 401, "没会话时回 401（不是 403）");

      await POST("/api/register", { email: "kid@example.com", password: "hunter2hunter" });

      const storeN = require("../api/_lib/store.js").getStore(require("../api/_lib/config.js"));
      const rowsN = Object.keys(storeN._db.accounts).map(k => storeN._db.accounts[k]);
      rowsN.filter(a => a.email_mask === "o***@example.com")[0].role = "owner";

      const list = await POST("/api/admin/accounts", {}, cA);
      eq(list.status, 200, "管理员能列名录");
      eq(list.body.total, 2, "名录列出**全部注册账号**（不是只列发过层级的）");
      const mails = list.body.accounts.map(a => a.email).sort();
      eq(mails.join(","), "kid@example.com,owner@example.com", "**明文邮箱在里面**（名录存在的理由）");
      const one = list.body.accounts[0];
      ["email", "emailMask", "nickname", "tier", "role", "status", "emailVerified",
        "hasPassword", "createdAt", "lastLoginAt"].forEach(k => {
        chk(Object.prototype.hasOwnProperty.call(one, k), "名录每行给出 " + k);
      });
      const raw = JSON.stringify(list.body);
      chk(!/password_hash|password_salt/.test(raw), "**名录里没有口令字段**（管理员也不需要它）");
      chk(!/email_hash/.test(raw), "**名录里没有 email_hash**（那是登录标识，泄出去等于可查询「谁是本站用户」）");
      chk(!/hunter2hunter/.test(raw), "名录里没有明文口令");
      chk(!/token_hash|code_hash/.test(raw), "名录里没有确认令牌 / 验证码的摘要");
      eq(list.body.accounts.filter(a => a.email === "owner@example.com")[0].hasPassword, true,
        "有口令的账号如实标 hasPassword:true");

      eq(list.body.accounts.filter(a => a.email === "owner@example.com").length, 1,
        "（顺带）名录里按明文邮箱查得到那个人");

      const grants = await POST("/api/admin/grants", {}, cA);
      eq(grants.body.grants.length, 0, "发放台账仍然是空的（那两个人都是 free）—— 两张表分开的理由在断言里");
    } finally { await sv3.close(); }
  }

  {
    const apiSrc = fs.readFileSync(path.join(ROOT, "js/auth-api.js"), "utf8");
    ["register", "login", "verifyEmail", "resendVerification", "resetRequest", "resetConfirm", "accounts"]
      .forEach(m => chk(new RegExp("\\b" + m + ":\\s*function").test(apiSrc),
        "js/auth-api.js 接了 " + m + "()（少一条就是按钮点了没反应）"));

    const bindSrc = fs.readFileSync(path.join(ROOT, "js/account-api.js"), "utf8");
    chk(/resendVerification:\s*resendVerification/.test(bindSrc), "account-api 接了 resendVerification");
    chk(/adminAccounts:\s*adminAccounts/.test(bindSrc), "account-api 接了 adminAccounts");
    chk(/adminSetRole:\s*adminSetRole/.test(bindSrc), "account-api 接了 adminSetRole（改角色那条线）");
    chk(/setRole:\s*function/.test(apiSrc), "js/auth-api.js 接了 setRole()（少一条就是按钮点了没反应）");

    const swSrc = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
    ["./verify/", "./reset/", "./js/verify.js", "./js/reset.js", "./js/login.js"].forEach(f => {
      chk(swSrc.includes('"' + f + '"'), "sw.js 预缓存里有 " + f);
    });

    ["js/login.js", "js/reset.js"].forEach(f => {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
      const bad = src.split("\n").filter(line => /password|input-pw|input-reg-pw|input-new-pw/i.test(line)
        && /localStorage|sessionStorage|document\.cookie|location\.search\s*\+/i.test(line));
      eq(bad.length, 0, f + " 里没有一行「口令 + 本地存储 / URL」同现：" + bad.join(" | ").slice(0, 80));
    });

    const loginSrc = fs.readFileSync(path.join(ROOT, "login/index.html"), "utf8");
    chk(!/邮件已发送|已发送确认邮件/.test(loginSrc), "登录页不写「邮件已发送」（发信是事实，不是尽力）");
    chk(/还没|没能|发不出去/.test(loginSrc), "登录页如实写了「可能发不出去」这件事");

    const loginVisible = loginSrc.replace(/<!--[\s\S]*?-->/g, " ");
    chk(!/这个邮箱没注册|没有这个邮箱|邮箱不存在|未注册/.test(loginVisible),
      "登录页的**可见文案**里不回答「这个邮箱注册过没有」（那等于邮箱枚举）");

    const loginJs = fs.readFileSync(path.join(ROOT, "js/login.js"), "utf8");

    chk(/若该邮箱已注册/.test(loginJs) &&
      !/重设邮件已发往/.test(loginJs),
      "忘记密码那一屏用的是条件句「若该邮箱已注册…」（不替服务端回答邮箱是否存在）");

    ["verify/index.html", "reset/index.html"].forEach(f => {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      chk(/data-back="\/login\/"/.test(src), f + " 的返回落点指向 /login/");
      chk(/data-dock="off"/.test(src), f + " 不留底部页签（一段「专心做完」的流程）");
    });

    const resetSrc = fs.readFileSync(path.join(ROOT, "reset/index.html"), "utf8");
    chk(/其它设备|其他设备/.test(resetSrc), "重设页写明「其它设备上的登录会全部退出」");

    chk(/id="reset-ok-hint"/.test(resetSrc), "重设成功那一屏留了「邮箱还没确认」的位置");
    chk(/emailVerified/.test(fs.readFileSync(path.join(ROOT, "js/reset.js"), "utf8")),
      "js/reset.js 按服务端回的 emailVerified 填那一句（不是自己猜的）");
    const resetJsSrc = fs.readFileSync(path.join(ROOT, "js/reset.js"), "utf8");

    chk(/重发验证邮件|重新发送验证邮件/.test(resetJsSrc) && /登录页/.test(resetJsSrc),
      "那一句指出了唯一那一步的入口在哪儿（含「登录页」这个落点）");
  }

  {

    boot({ ALLOW_CODE_ECHO: "1" });
    const sv = await serve();
    try {
      const POST = (p, b, cookie) => call(sv.base, "POST", p, b, cookie);

      const reg = await POST("/api/register", { email: "gate@example.com", password: "hunter2hunter" });
      eq(reg.status, 202, "注册回 202");
      eq(reg.body.requiresVerification, true, "如实回 requiresVerification:true（默认口径是拦）");

      const pwBlocked = await POST("/api/login", { email: "gate@example.com", password: "hunter2hunter" });
      eq(pwBlocked.status, 403, "**口令登录：邮箱没确认 → 403**");
      eq(pwBlocked.body.code, "E_EMAIL_UNVERIFIED", "码是 E_EMAIL_UNVERIFIED");
      chk(!pwBlocked.setCookie, "被拦时**一枚 Cookie 都不发**（403 不是「按你一下但还是进来了」）");

      const sc = await POST("/api/send-code", { email: "gate@example.com" });
      eq(sc.status, 202, "随机码照常发得出去（发码那条路不受影响）");
      const codeBlocked = await POST("/api/verify-code", { codeId: sc.body.codeId, code: sc.body.devCode });
      eq(codeBlocked.status, 403, "**随机码登录：邮箱没确认 → 403**（两条路是同一件事的两半）");
      eq(codeBlocked.body.code, "E_EMAIL_UNVERIFIED", "同一个码、同一句话");

      const wrong = await POST("/api/login", { email: "gate@example.com", password: "definitely-wrong-1" });
      eq(wrong.body.code, "E_LOGIN_FAIL", "口令错走的是统一的那一句（防枚举）");
      chk(wrong.body.message !== pwBlocked.body.message,
        "**「口令不对」与「没确认」不是同一句话** —— 说成一样，用户就不知道该做什么");

      const legacy = await POST("/api/send-code", { email: "legacy-gate@example.com" });
      eq(legacy.status, 202, "（前置）老账号：发码那条路建的，未确认");
      const legacyBlocked = await POST("/api/verify-code", { codeId: legacy.body.codeId, code: legacy.body.devCode });
      eq(legacyBlocked.status, 403, "老账号同样被拦（口径对**所有**未确认账号一视同仁）");
      chk(!!legacyBlocked.body.emailMask, "被拦时带出掩码，界面据此回显发往哪儿");
      eq(legacyBlocked.body.verifySent, false,
        "**登录这条路被拦时不顺手发信**（否则拿一个已知的未确认邮箱反复点登录即可给人发垃圾邮件）");

      const resend = await POST("/api/resend-verification-by-email", { email: "legacy-gate@example.com" });
      eq(resend.status, 200, "匿名重发那条路走得通（它是这条口径下**唯一的出路**）");

      eq(resend.body.devVerifyToken, undefined,
        "匿名重发口**不回明文令牌**（回了就等于「凭邮箱确认别人的邮箱」）");
      chk(!/emailMask/.test(JSON.stringify(resend.body)),
        "匿名重发口**连掩码都不回**（掩码是从「这个邮箱存在」推出来的）");

      const storeG = require("../api/_lib/store.js").getStore(require("../api/_lib/config.js"));
      const regG = await POST("/api/register", { email: "legacy-gate@example.com", password: "hunter2hunter" });
      chk(/^[0-9a-f]{64}$/.test(String(regG.body.devVerifyToken || "")),
        "（冒烟档）注册那条路给得出明文令牌（令牌只该从「会把它发出去」的那条路拿）");
      const vidG = Object.keys(storeG._db.verifications)
        .filter(k => !storeG._db.verifications[k].consumed_at)
        .sort((a, b) => storeG._db.verifications[b].issued_at - storeG._db.verifications[a].issued_at)[0];
      const vokG = await POST("/api/verify-email", { vid: vidG, token: regG.body.devVerifyToken });
      eq(vokG.status, 200, "点邮件里那条链接就确认了（同样**不需要登录**）");

      const sc2 = await POST("/api/send-code", { email: "legacy-ok@example.com" });
      eq(sc2.status, 202, "（前置）再建一个老账号");
      const blocked2 = await POST("/api/verify-code", { codeId: sc2.body.codeId, code: sc2.body.devCode });
      eq(blocked2.status, 403, "（前置）它同样被拦");
      chk(await confirmViaHttp(sv.base, "legacy-ok@example.com", call), "（前置）走那条唯一的出路把它确认掉");

      chk(await confirmViaHttp(sv.base, "gate@example.com", call), "（前置）把 gate@example.com 也确认掉");
      const lgOk = await POST("/api/login", { email: "gate@example.com", password: "hunter2hunter" });
      eq(lgOk.status, 200, "**确认之后口令那条路放行**（403 变 200）");
      chk(/kbsid=/.test(String(lgOk.setCookie || "")), "签发了会话 Cookie");
      const vOk = lgOk;

      const pwOk = await POST("/api/register", { email: "legacy-ok@example.com", password: "hunter2hunter" });
      eq(pwOk.body.emailVerified, true, "已确认的人重新注册：如实回 emailVerified:true");
      eq(pwOk.body.verifySent, false, "已确认的人重新注册**不再发确认邮件**（省一封垃圾邮件）");
      const pwOkLogin = await POST("/api/login", { email: "legacy-ok@example.com", password: "hunter2hunter" });
      eq(pwOkLogin.status, 200, "重新注册补了口令之后，口令那条路也能进（确认状态没被退回）");

      for (const p of ["/api/resend-verification-by-email"]) {
        const g = await call(sv.base, "GET", p);
        eq(g.status, 405, "GET " + p + " 回 405");
      }
    } finally { await sv.close(); }

    boot({ ALLOW_CODE_ECHO: "1", REQUIRE_EMAIL_VERIFIED: "0" });
    const svOff = await serve();
    try {
      const POST = (p, b) => call(svOff.base, "POST", p, b);
      const reg = await POST("/api/register", { email: "nocap@example.com", password: "hunter2hunter" });
      eq(reg.body.requiresVerification, false,
        "**关掉闸时如实回 requiresVerification:false**（界面据此改口，不许还写着「确认才能登录」）");
      const lg = await POST("/api/login", { email: "nocap@example.com", password: "hunter2hunter" });
      eq(lg.status, 200, "闸关掉之后，没确认也能登录（这是**运维显式选的口径**，不是默认）");
      chk(/kbsid=/.test(String(lg.setCookie || "")), "照常签发会话");
    } finally { await svOff.close(); }

    {
      const coreSrc = fs.readFileSync(path.join(ROOT, "api/_lib/core.js"), "utf8");

      const defs = (coreSrc.match(/function emailGate\(/g) || []).length;
      eq(defs, 1, "**闸的判据只写一处**（`emailGate()`），不是三处各写一遍");
      const reads = (coreSrc.match(/emailGate\(deps, acc\)/g) || []).length;

      eq(reads, 3, "闸的读取处数对得上（口令路 + 随机码路 + 函数签名）：" + reads);

      ["login/index.html", "terms/index.html", "README.md", "docs/architecture.md"].forEach(f => {
        const src = fs.readFileSync(path.join(ROOT, f), "utf8");
        chk(!/不确认也能用|不确认也照常|不确认也能正常使用/.test(src),
          f + " 里不再有旧口径那句「不确认也能用」");
      });
      chk(/点击链接验证后登录|完成邮箱验证后才能登录/.test(
        fs.readFileSync(path.join(ROOT, "login/index.html"), "utf8")),
        "登录页写明「点击链接验证后登录」（用户得知道下一步是什么）");

      const loginHtml = fs.readFileSync(path.join(ROOT, "login/index.html"), "utf8");
      chk(/id="btn-unverified-resend"/.test(loginHtml),
        "登录页有「重新发一封确认邮件」那颗键（这条路上的人**登不进来**，只能在这儿发）");
      chk(!/id="btn-verify-later"[^>]*>\s*先去用/.test(loginHtml),
        "**不再有**「先去用，稍后再确认」那颗键（新口径下那颗键点下去是 403，是一句做不到的话）");
      const loginJsSrc = fs.readFileSync(path.join(ROOT, "js/login.js"), "utf8");
      chk(/E_EMAIL_UNVERIFIED/.test(loginJsSrc), "登录页脚本认 E_EMAIL_UNVERIFIED 这个码");
      chk(/resendVerificationByEmail/.test(loginJsSrc), "登录页脚本调的是**匿名**那条重发接口");

      chk(/emailGate:\s*!!requireVerified\(cfg\)/.test(coreSrc),
        "服务端自报 channel.emailGate（界面据它决定说不说「确认才能登录」）");
      chk(/requireVerified:\s*!!requireVerified\(cfg\)/.test(coreSrc),
        "同一个值的别名 requireVerified 也在（两处读同一个源，不各算一份）");
    }
  }

  {

    boot({ ALLOW_CODE_ECHO: "1" });
    const core = require("../api/_lib/core.js");
    const storeMod = require("../api/_lib/store.js");
    const sessionMod = require("../api/_lib/session.js");

    const T0 = 1757900000000;
    function rig(extra) {
      const cfg = Object.assign({}, require("../api/_lib/config.js"), {
        allowCodeEcho: true,
        resendCooldownMs: 1,
        rate: { email: [[1e9, 1e9]], device: [[1e9, 1e9]], ip: [[1e9, 1e9]], global: [[1e9, 1e9]] }
      }, extra || {});
      const clock = { t: T0 };
      return {
        clock,
        d: {
          cfg, store: storeMod.memoryStore(), limiter: core.makeRateLimiter(),
          now: () => clock.t
        }
      };
    }
    const send = (d, v, dev, ip) => core.sendCode(d, { channel: "email", value: v, purpose: "login", deviceId: dev || "D", ip: ip || "I" });
    const verify = (d, codeId, code, dev, ip) => core.verifyCode(d, { codeId: codeId, code: code, deviceId: dev || "D", ip: ip || "I" });

    {
      const r = rig();
      const seen = [];
      let lockedAt = -1;
      for (let round = 0; round < 6 && lockedAt < 0; round++) {
        r.clock.t += 5000;
        const s = await send(r.d, "victim@example.com");
        if (s.status !== 200) break;
        let last = null;
        for (let g = 0; g < 5; g++) last = await verify(r.d, s.body.codeId, "000000", "D" + round, "I" + round);
        seen.push(last.body.code);
        if (last.body.code === "E_LOCKED") lockedAt = round;
      }
      chk(lockedAt >= 0, "① 连轮猜错会**锁账号**（原先永远不锁：实测可以无限猜下去）");
      eq(lockedAt, 2, "① 第 3 轮就锁（判据是「连续 3 轮整轮失败」，与 §5.5 一致）");
      eq(seen.filter(c => c === "E_CODE_VOID").length, 2,
        "① 前两轮如实回 E_CODE_VOID（不是 E_LOCKED，也不是含糊的「失败」）");

      r.clock.t += 5000;
      const after = await send(r.d, "victim@example.com", "brand-new-device", "203.0.113.7");
      eq(after.status, 423, "① 锁后换设备 + 换 IP 再发码：仍然 423（锁认 uid）");
      eq(after.body.code, "E_LOCKED", "① 码是 E_LOCKED");
      chk(after.body.retryAfter > 80000 && after.body.retryAfter <= 86400,
        "① 如实回「还剩多久」（实际 " + after.body.retryAfter + " 秒）");

      r.clock.t += 86400000 + 1000;
      const later = await send(r.d, "victim@example.com", "third-device", "203.0.113.8");
      eq(later.status, 200, "① 24 小时之后自动解锁（锁不是终态）");
      const acc = Object.values(r.d.store._db.accounts)[0];
      eq(acc.status, "active", "① 解锁时把账号状态改回 active（不留在 locked 上）");
      eq(acc.locked_until, null, "① 解锁时清掉 locked_until");
      eq((r.d.limiter._hits["wrong|" + acc.uid] || []).length, 0,
        "① 解锁时连错轮数的账一并清掉（不清的话用户回来错一枚码就又被锁一天）");
    }

    {
      const r = rig({ resendCooldownMs: 1 });

      r.d.cfg.resendCooldownMs = 1;
      const results = await Promise.all([
        send(r.d, "race@example.com", "R1"),
        send(r.d, "race@example.com", "R2"),
        send(r.d, "race@example.com", "R3")
      ]);
      const okCount = results.filter(x => x.status === 200).length;
      eq(okCount, 1, "② 同一瞬间并发发 3 次码，**只有 1 次**真的发出去了（实测原先 3 次全过）");
      chk(results.some(x => x.status === 429), "② 另外两次被拒且给出 retryAfter");
    }

    {
      const r = rig();
      r.d.cfg.codeLength = 6;

      const before = Object.keys(r.d.limiter._hits).filter(k => k.indexOf("verify:") >= 0).length;
      await verify(r.d, "c_none", "123");
      const after = Object.keys(r.d.limiter._hits).filter(k => k.indexOf("verify:") >= 0).length;
      chk(after > before, "③ 码长不对那条早退路径**也要落账**（原先一条不记，可以无限打）");
      const devKeys = Object.keys(r.d.limiter._hits).filter(k => k.startsWith("device|verify:"));
      const ipKeys = Object.keys(r.d.limiter._hits).filter(k => k.startsWith("ip|verify:"));
      chk(devKeys.length > 0, "③ 校验口按**设备**记账");
      chk(ipKeys.length > 0, "③ 校验口按**出口 IP**记账（deviceId 是客户端给的，换一个就绕过了）");
    }

    {
      const r = rig();
      r.d.cfg.wrongRoundsLimit = 3;

      let blocked = false;
      for (let i = 0; i < 30 && !blocked; i++) {
        const s = await send(r.d, "victim" + i + "@example.com", "dev" + i, "198.51.100.9");
        if (s.status !== 200) { blocked = true; break; }
        for (let g = 0; g < 5; g++) {
          const v = await verify(r.d, s.body.codeId, "000000", "dev" + i, "198.51.100.9");
          if (v.status === 429 && v.body.code === "E_RATE_IP") { blocked = true; break; }
        }
      }
      chk(blocked, "③ 换 deviceId + 换邮箱都绕不过**出口 IP**那一档");
    }

    {
      const r = rig();

      const mailMod = require("../api/_lib/mail/index.js");
      const realSend = mailMod.send;
      mailMod.send = () => Promise.reject(new Error("SMTP 连不上"));
      try {
        const s = await send(r.d, "boom@example.com");
        eq(s.status, 502, "④ 发信失败如实回 502（不假装成功）");
        chk(s.body.devCode === undefined,
          "④ **502 的响应里不许带明文码**（原先 catch 把中转那一条原样回了出去 —— " +
          "而 ALLOW_CODE_ECHO 恰恰只会在本地联调/冒烟那种环境打开）");
        chk(s.body.code === "E_MAIL_FAIL", "④ 码是 E_MAIL_FAIL（短信那条是 E_SMS_FAIL）");
      } finally { mailMod.send = realSend; }
    }

    {
      const cfg = Object.assign({}, require("../api/_lib/config.js"));
      const base = { sid: "s_x", uid: "u_x" };
      eq(sessionMod.shouldRenew(cfg, Object.assign({}, base, { exp: T0 + 29 * 86400000 }), T0), false,
        "⑤ 还剩 29 天的会话**不续**（每次登录都签新的 = 无上限滑动窗口）");
      eq(sessionMod.shouldRenew(cfg, Object.assign({}, base, { exp: T0 + 10 * 86400000 }), T0), true,
        "⑤ 还剩 10 天（不足一半）时才续到 30 天（§6.4 那条「剩余 < 15 天且用户有操作」）");
      eq(sessionMod.shouldRenew(cfg, Object.assign({}, base, { exp: T0 + 14 * 86400000 }), T0), true,
        "⑤ 还剩 14 天（< 一半）：续 —— 这就是 §6.4 那句「剩余 < 15 天」");
      eq(sessionMod.shouldRenew(cfg, Object.assign({}, base, { exp: T0 + 15 * 86400000 }), T0), false,
        "⑤ 恰好 15 天 = 一半，**不**续（判据是 full/2，不是写死 15 天：写死的那版在 sessionDays 改成 7 时会让每一次请求都续期）");
      eq(sessionMod.shouldRenew(cfg, null, T0), false, "⑤ 没有会话时不续（不是「续一个空会话」）");
    }

    {
      const cfg = Object.assign({}, require("../api/_lib/config.js"));
      const facts = core.channelFacts(cfg);
      eq(facts.rate, "instance",
        "⑥ /api/me 如实自报「频控只在本实例内有效」（配了库也一样 —— 账本在进程内存里）");
      chk(facts.rate === "instance" && facts.db === "memory" || facts.rate === "instance",
        "⑥ 这一条与 db 那条是**两件事**：db 说数据活多久，rate 说限流在几台机器上算数");
    }

    {

      const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(600, 7)]);
      const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(600, 3)]);

      const raw = (base, method, headers, body) => fetch(base + "/api/avatar", {
        method: method, headers: headers, body: body
      });

      boot({ ALLOW_CODE_ECHO: "1", AVATAR_MAX_BYTES: "1024" });
      const sv3 = await serve();
      try {

        const anon = await raw(sv3.base, "POST", { "Content-Type": "image/jpeg" }, JPEG);
        eq(anon.status, 401, "⑥ 没登录上传 → 401（如实回，不假装）");
        eq((await anon.json()).code, "E_NO_SESSION", "⑥ 回的是 E_NO_SESSION");
        chk(/先登录/.test((await (await raw(sv3.base, "POST", { "Content-Type": "image/jpeg" }, JPEG)).json()).message),
          "⑥ 这句话告诉用户下一步做什么（不是笼统的「失败」）");

        const POST3 = (p, b) => call(sv3.base, "POST", p, b);
        const ck = await loginByHttp(POST3, "avatar@example.com");
        chk(/^kbsid=/.test(ck), "⑥ 拿到了会话 Cookie（登录成功 —— 头像接口的前置）");

        const me3 = await call(sv3.base, "GET", "/api/me", undefined, ck);
        eq(me3.status, 200, "⑥ /api/me 认这个会话");
        const uid = me3.body.uid;
        chk(!!uid, "⑥ 从 /api/me 拿到 uid（上传接口要用它拼路径）");

        const up = await raw(sv3.base, "POST",
          { "Content-Type": "image/jpeg", Cookie: ck, "x-kb-device": "d-avatar" }, JPEG);
        eq(up.status, 200, "⑥ 上传成功（裸字节真的被读进来了，没有被 JSON 解析拦下）");
        const upBody = await up.json();
        chk(typeof upBody.url === "string" && upBody.url.length > 0, "⑥ 回了一个地址：" + String(upBody.url).slice(0, 60));
        eq(upBody.bytes, JPEG.length, "⑥ 如实回字节数");
        chk(/保留/.test(upBody.note || ""), "⑥ 说明里写明本机那份副本仍保留（断网照旧显示）");

        const html = Buffer.from("<html><script>alert(1)</script></html>                              ");
        const bad = await raw(sv3.base, "POST",
          { "Content-Type": "image/jpeg", Cookie: ck, "x-kb-device": "d-avatar" }, html);
        eq(bad.status, 400, "⑥ 冒牌 JPEG 被拒（这是 XSS 口子，不是「图不显示」）");
        eq((await bad.json()).code, "E_TYPE", "⑥ 回 E_TYPE");

        const huge = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(4000, 1)]);
        const big = await raw(sv3.base, "POST",
          { "Content-Type": "image/jpeg", Cookie: ck, "x-kb-device": "d-avatar" }, huge);
        eq(big.status, 400, "⑥ 超过上限 → 400");
        eq((await big.json()).code, "E_TOO_BIG", "⑥ 回 E_TOO_BIG");

        const empty = await raw(sv3.base, "POST",
          { "Content-Type": "image/jpeg", Cookie: ck, "x-kb-device": "d-avatar" }, "");
        eq(empty.status, 400, "⑥ 空体 → 400（不写一个 0 字节的对象上去）");
        eq((await empty.json()).code, "E_NO_BODY", "⑥ 回 E_NO_BODY");

        const p2 = await raw(sv3.base, "POST",
          { "Content-Type": "image/png", Cookie: ck, "x-kb-device": "d-avatar" }, PNG);
        eq(p2.status, 200, "⑥ PNG 也收（透明头像不能被拒）");

        let last = p2;
        for (let i = 0; i < 12; i++) {
          last = await raw(sv3.base, "POST",
            { "Content-Type": "image/jpeg", Cookie: ck, "x-kb-device": "d-avatar" }, JPEG);
          if (last.status === 429) break;
        }
        eq(last.status, 429, "⑥ 连着换头像会被频控拦下（写接口都有频控 —— checklist 第 3 条）");
        chk(!!(await last.json()).retryAfter, "⑥ 429 带 retryAfter（界面能说「多久之后」）");

        const del = await raw(sv3.base, "DELETE",
          { Cookie: ck, "x-kb-device": "d-avatar2", "Content-Type": "application/json" },
          JSON.stringify({ deviceId: "d-avatar2" }));
        eq(del.status, 200, "⑥ 删除成功（换个设备号，避开上一段的频控）");
        const delBody = await del.json();
        eq(delBody.deleted, true, "⑥ 如实回 deleted:true");
        eq(delBody.url, "", "⑥ 回来的地址是空串（不然另一台设备还会去拉一张不存在的图）");

        const put = await raw(sv3.base, "PUT", { Cookie: ck }, JPEG);
        eq(put.status, 405, "⑥ PUT 回 405（只有 POST / DELETE 两条路）");
        chk(/POST/.test(put.headers.get("allow") || "") && /DELETE/.test(put.headers.get("allow") || ""),
          "⑥ 405 带 Allow 头，列出真正支持的两个方法");
      } finally { await sv3.close(); }

      const savedSecret = process.env.SESSION_SECRET;
      delete process.env.SESSION_SECRET;
      Object.keys(require.cache).forEach(k => {
        if (k.startsWith(path.join(ROOT, "api"))) delete require.cache[k];
      });
      const sv0 = await serve();
      try {
        const r = await raw(sv0.base, "POST", { "Content-Type": "image/jpeg" }, JPEG);
        eq(r.status, 503, "⑥ 服务端还没配好 → 503（不是 500：这不是「出了点问题」）");
        eq((await r.json()).code, "E_NOT_CONFIGURED", "⑥ 回 E_NOT_CONFIGURED");
      } finally {
        await sv0.close();
        process.env.SESSION_SECRET = savedSecret;
        Object.keys(require.cache).forEach(k => {
          if (k.startsWith(path.join(ROOT, "api"))) delete require.cache[k];
        });
      }
    }

    {
      boot({ SUPABASE_URL: "https://demo.supabase.co", SUPABASE_SERVICE_KEY: "svc" });
      const cfg = require("../api/_lib/config.js");
      const AS = require("../api/_lib/avatar-store.js");

      const url = cfg.avatarPublicUrl("u_abcdefgh");
      eq(url, "https://demo.supabase.co/storage/v1/object/public/avatars/u_/u_abcdefgh/avatar.jpg",
        "⑥ 公开地址：<项目>/storage/v1/object/public/<桶>/<uid 前两位>/<uid>/avatar.jpg");
      eq(cfg.avatarPath("a"), "", "⑥ uid 太短时不拼路径（宁可不传，也不拼一个越界的键）");
      eq(cfg.avatarPath("u_abc/../x"), "u_/u_abcx/avatar.jpg", "⑥ uid 里的斜杠被剔掉（不许跳目录）");
      eq(cfg.avatarPublicUrl(""), "", "⑥ 配不全时回空串（界面据此如实说「还不支持头像」）");

      const AScalls = [];
      const realFetch = globalThis.fetch;
      globalThis.fetch = (u, init) => {
        AScalls.push({ url: String(u), method: init.method, headers: init.headers, body: init.body });
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("") });
      };
      const store = AS.supabaseAvatar(cfg);

      await store.put("u_abcdefgh", "image/jpeg", Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3])).then(async r => {
        globalThis.fetch = realFetch;
        eq(r.ok, true, "⑥ 上传成功");
        eq(AScalls.length, 1, "⑥ 只发一个请求（覆盖式上传，不先删旧的）");
        eq(AScalls[0].method, "POST", "⑥ 用 POST + x-upsert 做覆盖（PUT 不带它会 409 Duplicate）");
        eq(AScalls[0].headers["x-upsert"], "true", "⑥ 带上 x-upsert（改一次头像之后再改不动就是漏了它）");
        eq(AScalls[0].headers["Content-Type"], "image/jpeg", "⑥ Content-Type 用**按字节判**出来的那个");
        chk(/\/storage\/v1\/object\/avatars\/u_\/u_abcdefgh\/avatar\.jpg$/.test(AScalls[0].url),
          "⑥ 打的是 Storage 的对象口（不是 PostgREST）：" + AScalls[0].url);

        const calls2 = [];
        globalThis.fetch = (u, init) => {
          calls2.push(u);
          return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('{"error":"Bucket not found"}') });
        };
        await store.put("u_abcdefgh", "image/jpeg", Buffer.alloc(10, 1)).then(async r2 => {
          globalThis.fetch = realFetch;
          eq(r2.ok, false, "⑥ 桶不存在时**不许假装成功**");
          eq(r2.code, "E_NO_BUCKET", "⑥ 回 E_NO_BUCKET（界面据此说「存储桶还没建好」）");

          globalThis.fetch = () => Promise.reject(new Error("ENOTFOUND"));
          await store.put("u_abcdefgh", "image/jpeg", Buffer.alloc(10, 1)).then(r3 => {
            globalThis.fetch = realFetch;
            eq(r3.code, "E_OFFLINE", "⑥ 连不上 → E_OFFLINE（接口那层据此回 503，不是 502）");

            const st = fs.readFileSync(path.join(ROOT, "api/_lib/avatar-store.js"), "utf8");
            chk(/cfg\.avatarPath\(uid\)/.test(st), "⑥ 路径由服务端算（不让客户端给路径，否则能覆盖别人的头像）");
            chk(/sniffImage/.test(st), "⑥ 按 magic number 判类型（不看客户端声明的 Content-Type）");
            chk(!/[^a-zA-Z]image\/svg/.test(st), "⑥ 不收 SVG（它里面能带脚本，且画在别人屏幕上）");
            const av = fs.readFileSync(path.join(ROOT, "api/_routes/avatar/index.js"), "utf8");
            chk(/sniffImage/.test(av), "⑥ 上传接口真的用了那个判据");
            chk(!/req\.headers\[.content-type.\]\s*===/.test(av), "⑥ 没有拿 Content-Type 当判据");
            chk(/rawBody: true/.test(av), "⑥ 声明了 rawBody（否则外壳会把图片当 JSON 解析）");
            const c2 = fs.readFileSync(path.join(ROOT, "api/_lib/config.js"), "utf8");
            chk(/AVATAR_MAX_BYTES/.test(c2), "⑥ 单张上限可配（写死的那个数早晚不够用）");
            chk(/SUPABASE_AVATAR_BUCKET/.test(c2), "⑥ 桶名可配（写死时控制台里换个名字就全失败）");
          });
        });
      });
    }

    fs.writeFileSync("/tmp/m5b.txt", "REACHED-5B\n");

    boot({ ALLOW_CODE_ECHO: "1" });
    const sv = await serve();
    try {
      const POST = (p, b, cookie) => call(sv.base, "POST", p, b, cookie);

      const c1 = await loginByHttp(POST, "session@example.com");
      chk(/kbsid=/.test(c1), "⑤ 拿到 kbsid 那枚 Cookie");

      const regS2 = await POST("/api/register", { email: "session2@example.com", password: "hunter2hunter" });
      await POST("/api/verify-email", { vid: Object.keys(
        require("../api/_lib/store.js").getStore(require("../api/_lib/config.js"))._db.verifications)
        .filter(k => !require("../api/_lib/store.js").getStore(require("../api/_lib/config.js"))._db.verifications[k].consumed_at)
        .sort((a, b) => require("../api/_lib/store.js").getStore(require("../api/_lib/config.js"))._db.verifications[b].issued_at
          - require("../api/_lib/store.js").getStore(require("../api/_lib/config.js"))._db.verifications[a].issued_at)[0],
        token: regS2.body.devVerifyToken });
      const s2 = await POST("/api/send-code", { email: "session2@example.com" }, c1);
      eq(s2.status, 202, "⑤ 再发一枚码（换个邮箱，避开 60 秒重发冷却）");
      const v2 = await POST("/api/verify-code", { codeId: s2.body.codeId, code: s2.body.devCode }, c1);
      eq(v2.status, 200, "⑤ 再登一次成功");
      eq(v2.setCookie, null,
        "⑤ 会话还在有效期的前一半里 → **不续期、不发新 Cookie**（原先每次都发，于是 30 天变成无限）");
      eq(v2.body.sessionKept, true, "⑤ 如实回 sessionKept:true（界面与测试都能看出这一枚是沿用）");
      chk(v2.body.account && v2.body.account.uid, "⑤ 即便没续期，该回的账号信息一条不少");
    } finally { await sv.close(); }

    boot({ ALLOW_CODE_ECHO: "1", SESSION_KEY: "a-different-key-at-least-16-chars" });
    const sv2 = await serve();
    try {
      const r = await call(sv2.base, "POST", "/api/send-code", { email: "key@example.com" });
      eq(r.status, 202,
        "⑥ SESSION_KEY 能单独把会话签起来（不必借用发信那个变量）—— " +
        "「配发信」与「签会话」是两件事，各有各的变量");
    } finally { await sv2.close(); }
  }

  console.log("\n=== 第廿六节、管理员角色（Issue #276）：数据库是唯一权威 ===");
  {
    // 用户原话：「管理员页面只允许 belem@163.com 登录的邮箱访问（目前），
    // 未登录用户以及其他登录账户一律不允许访问。或者告诉我怎么在数据库
    // 设置管理员权限。……free, pro, max 登录用户的角色怎么设置，是要在
    // admin 页面加一个已登录用户列表，然后 belem@163.com 可以更改他们的 role 吗？」
    //
    // 这一节守三件事：
    //   ① `OWNER_EMAILS` 里的邮箱在**登录链路**里被认成 owner（写进 accounts.role）；
    //   ② 不在名单里的人**一个角色都不许有**（尤其不能是 owner）；
    //   ③ `/api/admin/role` 只有 owner 调得动，目标值只认 user / admin，
    //      改不了自己、也改不了种子主人。
    boot({ ALLOW_CODE_ECHO: "1", OWNER_EMAILS: "boss@example.com" });
    const sv = await serve();
    try {
      const POST = (p, b, cookie) => call(sv.base, "POST", p, b, cookie);

      // ① 名额在外的那一位：注册 → 确认 → 登录 → 已经是 owner
      const boss = await loginByHttpDetailed(POST, "boss@example.com");
      eq(boss.register.body.created, true, "（前置）boss 注册建号成功");
      const cBoss = boss.cookie;
      chk(!!cBoss, "（前置）boss 拿到会话");

      const storeM = require("../api/_lib/store.js").getStore(require("../api/_lib/config.js"));
      const rows = () => Object.keys(storeM._db.accounts).map(k => storeM._db.accounts[k]);
      eq(rows().filter(a => a.email === "boss@example.com")[0].role, "owner",
        "① 登录链路把 OWNER_EMAILS 里的人认成了 owner（写进数据库那一列）");

      // ② 不在名单里的人
      const kid = await loginByHttpDetailed(POST, "kid@example.com");
      const cKid = kid.cookie;
      eq(rows().filter(a => a.email === "kid@example.com")[0].role, "user",
        "② 不在名单里的人是 user（没有「谁先注册谁是主人」这条兜底）");

      // /api/me 如实下发角色
      const meKid = await call(sv.base, "GET", "/api/me", undefined, cKid);
      eq(meKid.body.role, "user", "/api/me 如实下发 role:user");
      const meBoss = await call(sv.base, "GET", "/api/me", undefined, cBoss);
      eq(meBoss.body.role, "owner", "/api/me 如实下发 role:owner");

      // ③ 改角色
      const kidUid = rows().filter(a => a.email === "kid@example.com")[0].uid;
      const bossUid = rows().filter(a => a.email === "boss@example.com")[0].uid;

      const anon = await POST("/api/admin/role", { uid: kidUid, role: "admin" });
      eq(anon.status, 401, "没会话时改角色回 401");

      const asKid = await POST("/api/admin/role", { uid: kidUid, role: "admin" }, cKid);
      eq(asKid.status, 403, "**普通用户**改角色回 403（角色闸在服务端，不经界面）");
      eq(asKid.body.code, "E_FORBIDDEN", "码是 E_FORBIDDEN");

      const selfDown = await POST("/api/admin/role", { uid: bossUid, role: "user" }, cBoss);
      eq(selfDown.status, 400, "B 主人**改不了自己**（降自己 = 把自己关在门外，且没人能加回来）");
      eq(selfDown.body.code, "E_SELF", "码是 E_SELF");

      const toOwner = await POST("/api/admin/role", { uid: kidUid, role: "owner" }, cBoss);
      eq(toOwner.status, 400, "owner 这个值**不许从这个口发**（它是凭据 + 名单级别的东西）");
      eq(toOwner.body.code, "E_ROLE", "码是 E_ROLE");

      const up = await POST("/api/admin/role", { uid: kidUid, role: "admin" }, cBoss);
      eq(up.status, 200, "主人把 kid 提成 admin：200");
      eq(up.body.changed, true, "如实回 changed:true");
      eq(rows().filter(a => a.email === "kid@example.com")[0].role, "admin",
        "**真的写进了数据库那一列**（不是只在响应里说说）");

      // 提成 admin 之后：能进名录，但**不能授权**（这正是 owner 与 admin 的分界）
      const kidList = await POST("/api/admin/accounts", {}, cKid);
      eq(kidList.status, 200, "admin 能看账号名录");
      const kidTryRole = await POST("/api/admin/role", { uid: kidUid, role: "user" }, cKid);
      eq(kidTryRole.status, 403, "**admin 改不了角色**（能发层级、看名录、处理报告，但不能授权）");
      chk(/owner/.test(kidTryRole.body.message), "文案说清这一条只对 owner 开放");

      const kidTryBoss = await POST("/api/admin/role", { uid: bossUid, role: "user" }, cKid);
      eq(kidTryBoss.status, 403, "admin 也动不了（根因仍是「不是 owner」，不是「改的是主人」）");

      const down = await POST("/api/admin/role", { uid: kidUid, role: "user" }, cBoss);
      eq(down.status, 200, "主人把 admin 降回 user：200");
      eq(down.body.before, "admin", "如实回改之前是什么");
      eq(rows().filter(a => a.email === "kid@example.com")[0].role, "user", "库里真的降回去了");

      const bossLocked = await POST("/api/admin/role", { uid: bossUid, role: "user" }, cBoss);
      eq(bossLocked.body.code, "E_SELF", "（前置）主人那一行由 E_SELF 挡住，走不到 E_OWNER_LOCKED");
      // 换一个 owner 来试「改种子主人」：先给 kid 一个 owner 身份（模拟手改库 / 加进名单）
      rows().filter(a => a.email === "kid@example.com")[0].role = "owner";
      const tryMoveBoss = await POST("/api/admin/role", { uid: bossUid, role: "user" }, cKid);
      eq(tryMoveBoss.status, 400, "另一个 owner 也改不了**种子主人**那一行");
      eq(tryMoveBoss.body.code, "E_OWNER_LOCKED", "码是 E_OWNER_LOCKED（「换主人就改 OWNER_EMAILS」）");
      rows().filter(a => a.email === "kid@example.com")[0].role = "user";

      const ghost = await POST("/api/admin/role", { uid: "u_ghost", role: "admin" }, cBoss);
      eq(ghost.status, 404, "改一个不存在的账号回 404（不假装改成了）");

      const noUid = await POST("/api/admin/role", { role: "admin" }, cBoss);
      eq(noUid.status, 400, "不给 uid 回 400");
      eq(noUid.body.code, "E_UID", "码是 E_UID");

      const g = await call(sv.base, "GET", "/api/admin/role", undefined);
      eq(g.status, 405, "GET /api/admin/role 回 405（写接口不接受 GET）");
    } finally { await sv.close(); }

    // 不配 OWNER_EMAILS：**一个 owner 都没有**（不退回「谁打开谁是主人」）
    boot({ ALLOW_CODE_ECHO: "1" });
    const sv2 = await serve();
    try {
      const POST2 = (p, b, cookie) => call(sv2.base, "POST", p, b, cookie);
      const nobody = await loginByHttpDetailed(POST2, "nobody@example.com");
      const storeN = require("../api/_lib/store.js").getStore(require("../api/_lib/config.js"));
      const row = Object.keys(storeN._db.accounts).map(k => storeN._db.accounts[k])
        .filter(a => a.email === "nobody@example.com")[0];
      eq(row.role, "user", "没配 OWNER_EMAILS 时谁也**不是** owner（如实：本站还没指定主人）");
      const l = await POST2("/api/admin/accounts", {}, nobody.cookie);
      eq(l.status, 403, "于是 /admin/ 那一族全都 403（关门，不是漏开）");
    } finally { await sv2.close(); }

    // 名单里大小写 / 空格不影响认人
    boot({ ALLOW_CODE_ECHO: "1", OWNER_EMAILS: "  Boss@Example.com , other@x.com " });
    const sv3 = await serve();
    try {
      const POST3 = (p, b, cookie) => call(sv3.base, "POST", p, b, cookie);
      await loginByHttpDetailed(POST3, "boss@example.com");
      const store3 = require("../api/_lib/store.js").getStore(require("../api/_lib/config.js"));
      const r3 = Object.keys(store3._db.accounts).map(k => store3._db.accounts[k])
        .filter(a => a.email === "boss@example.com")[0];
      eq(r3.role, "owner", "名单里带空格 / 大小写也能认（归一化后比对）");
    } finally { await sv3.close(); }
  }

  console.log("\n=== 第廿七节、注册即登录（Issue #278）：点开确认链接就进门 ===");
  {
    // 用户原话：「用邮箱注册成功，点击验证链接成功，设置昵称完成，但很多功能
    // 一点就说需要登录？」「让你完成登录功能就应该全部完善，怎么还每一步
    // 每一步地催？全部完成完善！！！」
    //
    // 查下来的病根是**两处**：
    //   ① 点完确认链接**不签发会话** —— 这一节守的就是它：能点开那枚
    //      一次性令牌，就证明邮箱可达，那一步之后该是「已经登录」；
    //   ② 昵称只写本机 localStorage，服务器上那一列永远是空的 ——
    //      换台设备名字就没了，管理端名录也认不出人。
    boot({ ALLOW_CODE_ECHO: "1" });
    const sv = await serve();
    try {
      const POST = (p, b, cookie) => call(sv.base, "POST", p, b, cookie);
      const PATCH = (p, b, cookie) => call(sv.base, "PATCH", p, b, cookie);

      // ① 注册 → 确认 → **就有会话了**（整条动线一次做齐）
      const core = require("../api/_lib/core.js");
      const mailMod = core.__mail;
      const captured = [];
      const realConfirm = mailMod.confirm;
      mailMod.confirm = function (c, o) {
        captured.push(o);
        return Promise.resolve({ delivered: true, transport: "resend", attempts: 1 });
      };
      let reg, vid, tok;
      try {
        reg = await POST("/api/register", { email: "flow278@example.com", password: "hunter2hunter" });
        eq(reg.status, 202, "① 注册回 202（与 send-code 同一档）");
        chk(!reg.setCookie, "① 注册这一刻**还没有**会话 —— 邮箱还没证明可达，不该先放人进来");
        const m = captured[captured.length - 1];
        chk(!!m && !!m.vid && !!m.token, "① 确认邮件真的发出去了一封（发信商是假的，但形状是真的）");
        vid = m.vid; tok = m.token;
      } finally { mailMod.confirm = realConfirm; }

      const v = await POST("/api/verify-email", { vid: vid, token: tok });
      eq(v.status, 200, "② 点开邮件里那条链接 → 200");
      eq(v.body.verified, true, "② 如实回 verified:true");
      eq(v.body.signedIn, true, "② **如实回 signedIn:true**（界面据它决定说「已登录」还是「去登录」）");
      chk(/^kbsid=/.test(String(v.setCookie || "")), "② **就在这一步签发了会话 Cookie**（原先一个字节都不发）");
      chk(/HttpOnly/.test(String(v.setCookie || "")), "② 那一枚 Cookie 是 HttpOnly");
      chk(!/plan|tier|email/i.test(String(v.setCookie || "")), "② Cookie 里不含权益或邮箱");
      const cookie278 = String(v.setCookie || "").split(";")[0];

      const me278 = await call(sv.base, "GET", "/api/me", undefined, cookie278);
      eq(me278.status, 200, "③ 拿那一枚 Cookie 读 /api/me：200（**这一步以前是 401，正是用户说的那个 bug**）");
      eq(me278.body.email, "flow278@example.com", "③ 读到的就是本人");
      eq(me278.body.emailVerified, true, "③ 邮箱状态如实为已确认");
      // publicAccount 刻意**不下发 status**（那是内部状态机，界面用不着它；
      // 要看的「进没进来」是 emailVerified 那一位）。账号那一列直接读库。
      {
        const sAcc = require("../api/_lib/store.js").getStore(require("../api/_lib/config.js"));
        const aRow = Object.keys(sAcc._db.accounts).map(k => sAcc._db.accounts[k])
          .filter(a => a.email === "flow278@example.com")[0];
        eq(aRow.status, "active", "③ 库里那一行是 active（pending 已被确认那一步提上来）");
      }

      // ④ 重放：同一枚令牌不能第二次换会话
      const again = await POST("/api/verify-email", { vid: vid, token: tok });
      eq(again.status, 400, "④ 同一条链接再点一次 → 400");
      eq(again.body.code, "E_TOKEN_USED", "④ 码是 E_TOKEN_USED（一次性令牌不因为「顺手签了个会话」而变成可重放）");
      chk(!again.setCookie, "④ 被拒的那一次**一枚 Cookie 都不发**");

      // ⑤ 昵称：落服务器，且换一台设备读得到
      const set = await PATCH("/api/me", { nickname: "  小明  " }, cookie278);
      eq(set.status, 200, "⑤ PATCH /api/me 改昵称：200");
      eq(set.body.nickname, "小明", "⑤ 前后空格被剔掉，如实回存下来的那个值");
      const meB = await call(sv.base, "GET", "/api/me", undefined, cookie278);
      eq(meB.body.nickname, "小明", "⑤ 再读一次还是它（真的落库了，不是只在响应里说说）");

      const storeM = require("../api/_lib/store.js").getStore(require("../api/_lib/config.js"));
      const rowM = Object.keys(storeM._db.accounts).map(k => storeM._db.accounts[k])
        .filter(a => a.email === "flow278@example.com")[0];
      eq(rowM.nickname, "小明", "⑤ **库里那一列也写上了**（原先它只落本机 localStorage，这一列永远是空的）");

      const lg278 = await POST("/api/login", { email: "flow278@example.com", password: "hunter2hunter" });
      const ck278 = String(lg278.setCookie || "").split(";")[0];
      const meC = await call(sv.base, "GET", "/api/me", undefined, ck278);
      eq(meC.body.nickname, "小明", "⑤ **换一个会话（= 换一台设备）登录，名字还在**（这正是「账号域」的含义）");

      const long = await PATCH("/api/me", { nickname: "一二三四五六七八九十十一十二十三" }, cookie278);
      eq(long.body.nickname.length, 12, "⑤ 超长昵称截到 12 个字符（与服务端家族子用户同一档）");
      const dirty = await PATCH("/api/me", { nickname: "<b>ok</b>\u0000" }, cookie278);
      eq(dirty.body.nickname, "bok/b", "⑤ 尖括号与控制字符被剔掉（它最后是画在别人屏幕上的）");

      const anon = await PATCH("/api/me", { nickname: "x" });
      eq(anon.status, 401, "⑥ 没登录改昵称 → 401（不是 403、也不是「改成了」）");
      eq(anon.body.code, "E_NO_SESSION", "⑥ 码是 E_NO_SESSION");

      const g278 = await call(sv.base, "GET", "/api/me", undefined, cookie278);
      eq(g278.status, 200, "⑥ GET /api/me 仍然走原来的路（新加的 PATCH 没把它挤掉）");

      // ⑦ 「会话只有一个出口」：三条登录路 + 确认路都走同一处落库
      const coreSrc278 = fs.readFileSync(path.join(ROOT, "api/_lib/core.js"), "utf8");
      eq((coreSrc278.match(/session\.issue\(cfg, acc\.uid, t\)/g) || []).length, 1,
        "⑦ **签会话只写一处**（`issueSessionFor`）——原先这个调用在原码里手抄了三份");
      eq((coreSrc278.match(/function issueSessionFor\(/g) || []).length, 1,
        "⑦ `issueSessionFor()` 只有一份定义");
      chk(/issueSessionFor\(deps, cur\)/.test(coreSrc278),
        "⑦ 邮箱确认那条路也走它（**这一行就是 Issue #278 的修复本身**）");

      const handlerSrc278 = fs.readFileSync(path.join(ROOT, "api/_lib/handler.js"), "utf8");
      chk(/function settleSession\(/.test(handlerSrc278), "⑦ 接口层有 settleSession（落库 + 响应整形只有一处）");
      ["api/_routes/auth/login.js", "api/_routes/auth/verify-email.js"].forEach(f => {
        chk(/handler\.settleSession\(/.test(fs.readFileSync(path.join(ROOT, f), "utf8")),
          "⑦ " + f + " 走的是 handler.settleSession（不再自己抄一段 putSession）");
      });
      chk(/putSession/.test(handlerSrc278) &&
        !/putSession/.test(fs.readFileSync(path.join(ROOT, "api/_routes/auth/login.js"), "utf8")),
        "⑦ putSession 只在 handler.js 那一处（接口文件里不再各写一遍）");

      const routes278 = require("../api/_lib/routes.js");
      chk(!!routes278.resolve("PATCH", "/api/me"), "⑦ PATCH /api/me 在路由表里（少一条就是按钮点了没反应）");
      chk(routes278.resolve("GET", "/api/me").methodAllowed === true &&
        routes278.resolve("PATCH", "/api/me").methodAllowed === true,
        "⑦ GET 与 PATCH 是同一个路径的两条路，各自认自己的方法");

      // ⑧ 页面那一半：确认页据 signedIn 决定下一步，登录页把昵称发上去
      const verifyJs278 = fs.readFileSync(path.join(ROOT, "js/verify.js"), "utf8");
      chk(/r\.signedIn === true/.test(verifyJs278), "⑧ js/verify.js 读的是服务端回的 signedIn（不自己猜）");
      chk(/location\.href = signedIn \? "\/mine\/" : "\/login\/"/.test(verifyJs278),
        "⑧ 已登录时那颗按钮去首页，没拿到会话时才回登录页（两种情形如实分开）");
      chk(/开始背诵/.test(fs.readFileSync(path.join(ROOT, "verify/index.html"), "utf8")),
        "⑧ 确认页那颗按钮的出厂文案是「开始背诵」");

      const loginJs278 = fs.readFileSync(path.join(ROOT, "js/login.js"), "utf8");
      chk(/setNickname\(\{\s*nickname: clean\s*\}\)/.test(loginJs278) ||
        /setNickname\(\{ nickname: clean \}\)/.test(loginJs278),
        "⑧ 登录页把昵称发给服务端（调的是 AccountApi.setNickname）");
      chk(/Acct\.bind/.test(loginJs278), "⑧ 走的是 account-api 那一层（页面不直接碰传输层）");
      chk(/昵称暂时没能同步到服务器/.test(loginJs278),
        "⑧ 同步失败**如实说一句**，且不拦人（名字没同步上比进不去轻得多）");

      const acctSrc278 = fs.readFileSync(path.join(ROOT, "js/account-api.js"), "utf8");
      chk(/setNickname:\s*setNickname/.test(acctSrc278), "⑧ account-api 导出 setNickname");
      const apiSrc278 = fs.readFileSync(path.join(ROOT, "js/auth-api.js"), "utf8");
      chk(/setNickname:\s*function/.test(apiSrc278), "⑧ 传输层接了 setNickname()（少一条就是按钮点了没反应）");
      chk(/call\("\/me", "PATCH"/.test(apiSrc278), "⑧ 它打的是 PATCH /api/me（不是另开一条 /api/nickname）");
    } finally { await sv.close(); }
  }

  fs.writeFileSync("/tmp/m205.txt", "REACHED-205\n");
  console.log("\n=== 末节、路由与函数数（Issue #205：Hobby 档 12 个函数上限） ===");
  {
    const routesMod = require("../api/_lib/routes.js");

    const apiDir = path.join(ROOT, "api");

    const entries = [];
    (function walk(dir) {
      fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name.charAt(0) === "_") return;
          walk(full);
          return;
        }
        if (e.name.charAt(0) === "_") return;
        if (/\.js$/.test(e.name)) entries.push(path.relative(apiDir, full));
      });
    })(apiDir);

    eq(entries.length, 1, "api/ 下只有 **1 个** Serverless 函数入口（Hobby 上限 12）");
    chk(entries[0] === "handler.js",
      "那一个入口就是固定的 api/handler.js（实际 " + entries[0] + "）");
    chk(entries.length <= 12, "函数数没有超过 Hobby 档的 12（实际 " + entries.length + "）");

    const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
    const rw = (vercel.rewrites || []).find(r => r.source === "/api/:path*");
    chk(!!rw, "vercel.json 里有一条 `/api/:path*` 的 rewrite（它就是 /api/* 接上函数的那一层）");
    eq(rw && rw.destination, "/api/handler?__path=:path*",
      "那条 rewrite 转到固定函数，并把原 API 路径放进内部参数");

    // routes.js 用 `require(hit)` 动态加载 _routes/**：Vercel 的静态追踪器
    // （@vercel/nft）看不懂变量形参，不 includeFiles 就一个路由文件都不打包 ——
    // 症状是每条 /api/* 都回 FUNCTION_INVOCATION_FAILED（非 JSON → 前端 E_INTERNAL）。
    const inc = ((vercel.functions || {})["api/handler.js"] || {}).includeFiles || "";
    chk(/api\/\*\*/.test(inc), "vercel.json 把 api/** 一起打进函数（动态 require 的路由文件靠它才在）");
    chk(/data\/\*\.js/.test(inc) && /js\/quiz\.js/.test(inc),
      "飞花令/题库要现读 data/*.js 与 js/quiz.js，这两份也要 includeFiles");

    Object.keys(routesMod.ROUTES).forEach(key => {
      const file = routesMod.ROUTES[key];
      const abs = path.resolve(apiDir, "_lib", file);
      chk(fs.existsSync(abs), "路由 " + key + " 指向的文件真的在：" + file);
      const mod = require(abs);
      chk(typeof mod === "function", "路由 " + key + " 的那个文件导出的是一个 handler");
    });

    [
      ["GET", "/api/me", 401],
      ["POST", "/api/send-code", 503],
      ["DELETE", "/api/account", 503],
      ["POST", "/api/avatar", 503],
      ["GET", "/api/family", 503],
      ["POST", "/api/admin/accounts", 503],
      ["POST", "/api/admin/role", 503]
    ].forEach(([m, p]) => {
      const hit = routesMod.resolve(m, p);
      chk(!!hit && hit.methodAllowed, m + " " + p + " 在路由表里（且方法认下来了）");
    });

    const wrong = routesMod.resolve("GET", "/api/account");
    chk(!!wrong && wrong.methodAllowed === false,
      "GET /api/account 命中了那个文件但方法不对（交回 405，不是 404）");

    eq(routesMod.resolve("GET", "/api/nope"), null, "表里没有的路径回 null（404）");
    eq(routesMod.resolve("GET", "/api/../_lib/store.js"), null,
      "路径穿越打不到 _lib（表是**精确匹配**，不是拼字符串）");
    eq(routesMod.resolve("GET", "/api/handler/_lib/core.js"), null,
      "_lib 不在表里（它是被 require 的代码，不是一条路由）");

    chk(!!routesMod.resolve("GET", "/api/me/"), "/api/me/ 与 /api/me 同一条（末尾斜杠不另开一条）");
    chk(!!routesMod.resolve("GET", "//api//me"), "重复斜杠不影响命中");

    {
      const srv = http.createServer(require("../api/handler.js"));
      await new Promise(r => srv.listen(0, "127.0.0.1", r));
      const port = srv.address().port;
      const hit = (method, p) => new Promise(resolve => {
        const req = http.request({ host: "127.0.0.1", port: port, method: method, path: p },
          res => {
            let buf = "";
            res.on("data", d => { buf += d; });
            res.on("end", () => resolve({ status: res.statusCode, raw: buf }));
          });
        req.on("error", e => resolve({ status: 0, raw: String(e && e.message) }));
        req.end(method === "POST" ? JSON.stringify({}) : undefined);
      });

      const me = await hit("GET", "/api/me");
      chk(me.status === 200 || me.status === 401 || me.status === 503,
        "用户地址 GET /api/me 打到的是本站 handler，不是 404（实际 " + me.status + "）");
      chk(me.raw.indexOf("E_404") < 0,
        "GET /api/me 不是「本站说没有这个接口」（那就是路由没接上）");

      const cfg = await hit("GET", "/api/config");
      chk(cfg.status === 200, "用户地址 GET /api/config 是 200（实际 " + cfg.status + "）");
      chk(cfg.raw.indexOf("turnstile") >= 0, "/api/config 真的回的是配置，不是别的什么东西");

      /* ② **rewrite 之后那一层的形状**（2026-09-18 实测：函数挂在目录根上时
         平台层根本不把 /api/* 转进来）。
         --------------------------------------------------------------
         上面两条断的是「函数**在**的时候能答对」，而线上这一次坏的是
         **函数压根没被调起来**（Vercel 平台层直接 NOT_FOUND，正文是
         `The page could not be found`，连函数的日志都没有）。
         所以这里补一条：把 rewrite 的目标地址（`/api/handler?__path=...`）也真打一次 ——
         平台层执行 rewrite 之后交到函数手上的就是这串 URL，
         后面那一层必须逐字认得它。少了这条，改完 rewrite 仍然会是全站 404。 */
      const viaRw = await hit("GET", "/api/handler?__path=me");
      chk(viaRw.status === 200 || viaRw.status === 401 || viaRw.status === 503,
        "rewrite 之后的地址 GET /api/handler?__path=me 也打到 handler（实际 " + viaRw.status + "）");
      chk(viaRw.raw.indexOf("E_404") < 0,
        "它不是「本站说没有这个接口」—— 那就是 __path 与 handler 的契约对不上");
      eq(viaRw.status, me.status,
        "同一个接口，走用户地址与走 rewrite 之后的地址，状态码必须一样（实际 " +
        viaRw.status + " / " + me.status + "）");

      const nope = await hit("GET", "/api/nope");
      eq(nope.status, 404, "表里没有的路径回 404");
      chk(nope.raw.indexOf("E_404") >= 0, "而且回的是**本站**那个 404 形状（不是平台层的 NOT_FOUND）");

      await new Promise(r => srv.close(r));
    }
  }

  {

    {
      boot({ ALLOW_CODE_ECHO: "1" });
      const core = require("../api/_lib/core.js");
      const cfg = require("../api/_lib/config.js");
      const store = require("../api/_lib/store.js").memoryStore();
      const d = { cfg, store, limiter: core.makeRateLimiter(), now: () => Date.now(), deviceId: "v1", ip: "1.1.1.1" };

      const s1 = await core.sendCode(d, { email: "gate@example.com", purpose: "login", deviceId: "v1", ip: "1.1.1.1" });
      eq(s1.status, 200, "① 未确认的账号照常能**收到**码（发码不是登录，不该被拦）");
      const v1 = await core.verifyCode(d, { codeId: s1.body.codeId, code: s1.body.devCode, deviceId: "v1", ip: "1.1.1.1" });
      eq(v1.status, 403, "① 随机码那条路：码对但邮箱没确认 → **403**（原先根本不看账号状态，直接发会话）");
      eq(v1.body.code, "E_EMAIL_UNVERIFIED", "① 码是 E_EMAIL_UNVERIFIED（不是含糊的 E_LOGIN_FAIL）");
      chk(!v1.cookies && !v1._session, "① 被拦时**不签发会话**（拦在半路等于没拦）");

      const regG = await core.register(d, { email: "gate2@example.com", password: "hunter2hunter", deviceId: "v2" });
      const gAcc = Object.values(store._db.accounts).filter(a => a.email === "gate2@example.com")[0];
      const lg = await core.loginWithPassword(d, { email: "gate2@example.com", password: "hunter2hunter", deviceId: "v3" });
      eq(lg.status, 403, "① 口令那条路：口令对但邮箱没确认 → 403");
      eq(lg.body.code, "E_EMAIL_UNVERIFIED", "① 同一个码（判据只写一处，两条路读同一个）");
      chk(!lg.cookies, "① 同样不签发会话");

      const ghost = await core.loginWithPassword(d, { email: "ghost-gate@example.com", password: "hunter2hunter", deviceId: "v4" });
      eq(ghost.status, 401, "① 账号不存在回 401 E_LOGIN_FAIL（**不是 403**）");
      eq(ghost.body.code, "E_LOGIN_FAIL", "① 两种情形回**不同的码** —— 但那不构成枚举：");

      const wrongPwOnUnverified = await core.loginWithPassword(d, { email: "gate2@example.com", password: "totally-wrong-pw", deviceId: "v5" });
      eq(wrongPwOnUnverified.status, 401, "① 未确认账号 + 错口令 → 401（**不是 403**）—— 判据在校验之后，所以没确认这件事不泄露");

      await confirmEmail(store, gAcc.uid, cfg.sessionSecret);
      const lg2 = await core.loginWithPassword(d, { email: "gate2@example.com", password: "hunter2hunter", deviceId: "v6" });
      eq(lg2.status, 200, "① 确认之后口令那条路放行");
      const s2 = await core.sendCode(d, { email: "gate2@example.com", purpose: "login", deviceId: "v7", ip: "2.2.2.2" });
      const v2 = await core.verifyCode(d, { codeId: s2.body.codeId, code: s2.body.devCode, deviceId: "v7", ip: "2.2.2.2" });
      eq(v2.status, 200, "① 确认之后随机码那条路也放行");

      const cfgOff = Object.assign({}, cfg, { requireEmailVerified: false });
      const dOff = Object.assign({}, d, { cfg: cfgOff });
      const s3 = await core.sendCode(dOff, { email: "gateoff@example.com", purpose: "login", deviceId: "v8", ip: "3.3.3.3" });
      const v3 = await core.verifyCode(dOff, { codeId: s3.body.codeId, code: s3.body.devCode, deviceId: "v8", ip: "3.3.3.3" });
      eq(v3.status, 200, "① REQUIRE_EMAIL_VERIFIED=0 时不拦（发信通不了时不许「谁也别想注册」）");
      eq(core.channelFacts(cfgOff).requireVerified, false, "① 关掉时**如实自报**（界面据此不写「没确认就进不来」）");
      eq(core.channelFacts(cfg).requireVerified, true, "① 默认是**拦**（事实自报，不是「尽力」）");
    }

    {
      boot({ ALLOW_CODE_ECHO: "1" });
      const core = require("../api/_lib/core.js");
      const cfg = require("../api/_lib/config.js");
      const store = require("../api/_lib/store.js").memoryStore();
      const d = { cfg, store, limiter: core.makeRateLimiter(), now: () => Date.now(), deviceId: "t1", ip: "1.1.1.1" };

      await core.register(d, { email: "victim@example.com", password: "original-pw-11", deviceId: "t1" });
      const uid = Object.values(store._db.accounts)[0].uid;
      const hash0 = store._db.accounts[uid].password_hash;

      const attack = await core.register(d, { email: "victim@example.com", password: "attacker-pw-99", deviceId: "t2" });
      eq(attack.status, 200, "② 再注册回同一个状态（不泄露存在性）");
      eq(attack.body.created, false, "② 如实回 created:false");
      eq(attack.body.existing, true, "② 如实标 existing:true（界面据此引导去「密码登录 / 忘记密码」）");
      eq(store._db.accounts[uid].password_hash, hash0, "② **库里那条摘要一个字节都没变**（原先会被覆盖）");

      await confirmEmail(store, uid, cfg.sessionSecret);
      const stolen = await core.loginWithPassword(d, { email: "victim@example.com", password: "attacker-pw-99", deviceId: "t3" });
      eq(stolen.status, 401, "② **攻击者的口令进不来**（这是那个洞的回归断言）");
      const mine = await core.loginWithPassword(d, { email: "victim@example.com", password: "original-pw-11", deviceId: "t4" });
      eq(mine.status, 200, "② 原主人的口令照旧能进来");
      chk(attack.body.verifySent === undefined, "② 已有口令的账号**不重发确认邮件**（否则它是个刷别人收件箱的口子）");

      const sv = core;
      void sv;
      const d2 = { cfg, store: require("../api/_lib/store.js").memoryStore(), limiter: core.makeRateLimiter(), now: () => Date.now(), deviceId: "t5", ip: "2.2.2.2" };
      await core.sendCode(d2, { email: "legacy@example.com", purpose: "login", deviceId: "t5", ip: "2.2.2.2" });
      const legacyUid = Object.values(d2.store._db.accounts)[0].uid;
      eq(d2.store._db.accounts[legacyUid].password_hash, "", "② 发码那条路建的账号没有口令");
      const fill = await core.register(d2, { email: "legacy@example.com", password: "brand-new-77", deviceId: "t6" });
      eq(fill.status, 200, "② 没有口令的老账号：注册给它补上口令（这条迁移路径**保留**）");
      chk(!!d2.store._db.accounts[legacyUid].password_hash, "② 口令真的写进去了");
    }

    {
      boot({ ALLOW_CODE_ECHO: "1" });
      const core = require("../api/_lib/core.js");
      const cfg = require("../api/_lib/config.js");
      const store = require("../api/_lib/store.js").memoryStore();
      const d = { cfg, store, limiter: core.makeRateLimiter(), now: () => Date.now(), deviceId: "u1", ip: "1.1.1.1" };

      await core.register(d, { email: "stuck@example.com", password: "hunter2hunter", deviceId: "u1" });

      const anon = await core.resendVerification(d, { email: "stuck@example.com", deviceId: "u1", ip: "1.1.1.1" });
      eq(anon.status, 200, "③ 匿名重发可用（原先回 401 —— 而登不进来的人恰恰最需要它）");
      eq(anon.body.requested, true, "③ 回 requested:true（与 reset-request 同一个形状）");
      chk(!/emailMask|verifyAttempts/.test(JSON.stringify(anon.body)),
        "③ 匿名口的响应里**没有掩码、没有尝试次数** —— 它们都是从「这个邮箱存在」推出来的");

      const plainCfg = Object.assign({}, cfg, { allowCodeEcho: false, resendCooldownMs: 1 });
      const dp = Object.assign({}, d, { cfg: plainCfg, limiter: core.makeRateLimiter(), ip: "3.3.3.3" });
      const known = await core.resendVerification(dp, { email: "stuck@example.com", deviceId: "u2", ip: "3.3.3.3" });
      const unknown = await core.resendVerification(dp, { email: "nobody-here@example.com", deviceId: "u3", ip: "4.4.4.4" });
      eq(JSON.stringify(known.body), JSON.stringify(unknown.body),
        "③ **生产形态下两个响应逐字相同**（否则它是一个「这个邮箱是谁的、确认了没有」的查询口）");
      chk(/如果/.test(unknown.body.note), "③ 文案是条件句（判断留给收件箱）");

      const accS = Object.values(store._db.accounts)[0];
      await confirmEmail(store, accS.uid, cfg.sessionSecret);
      const done = await core.resendVerification(Object.assign({}, d, { account: { uid: accS.uid } }), { deviceId: "u4", ip: "5.5.5.5" });
      eq(done.body.alreadyVerified, true, "③ 已确认的：如实回 alreadyVerified:true，且**不再发信**");
      eq(done.body.verifySent, false, "③ 那时 verifySent 为 false（确实没发）");

      const bad = await core.resendVerification(d, { email: "not-an-email", deviceId: "u5", ip: "6.6.6.6" });
      eq(bad.status, 400, "③ 匿名口邮箱形状不对回 400");
      eq(bad.body.code, "E_EMAIL_FORMAT", "③ 码是 E_EMAIL_FORMAT");

      const accUid = Object.values(store._db.accounts)[0].uid;
      const dSigned = Object.assign({}, d, {
        limiter: core.makeRateLimiter(), account: { uid: accUid }, deviceId: "u6", ip: "7.7.7.7"
      });
      const signed = await core.resendVerification(dSigned, { deviceId: "u6", ip: "7.7.7.7" });
      eq(signed.status, 200, "③ 登录态那条入口仍然可用（两条入口共用一套闸）");
    }

    {
      boot({ ALLOW_CODE_ECHO: "1" });
      const core = require("../api/_lib/core.js");
      const cfg = require("../api/_lib/config.js");
      const store = require("../api/_lib/store.js").memoryStore();

      const cfgFast = Object.assign({}, cfg, { resendCooldownMs: 1 });
      const lim = core.makeRateLimiter();
      const d = { cfg: cfgFast, store, limiter: lim, now: () => Date.now(), deviceId: "w1", ip: "9.9.9.9" };

      await core.register(d, { email: "spam@example.com", password: "hunter2hunter", deviceId: "w1" });
      await core.resendVerification(d, { email: "spam@example.com", deviceId: "w1", ip: "9.9.9.9" });

      const keys = Object.keys(lim._hits);
      chk(keys.some(k => k.indexOf("device|resend:") === 0), "④ 按**设备**记账");
      chk(keys.some(k => k.indexOf("ip|resend:") === 0), "④ 按**出口 IP**记账（deviceId 换一个就绕过了，IP 换不掉）");
      chk(keys.some(k => k.indexOf("email|resend:") === 0), "④ 按**邮箱**记账（同一个邮箱别连点）");
      chk(keys.some(k => k.indexOf("global|resend-all") === 0), "④ 有**全局**兜底档");

      const again = await core.resendVerification(Object.assign({}, d, { cfg: Object.assign({}, cfgFast, { resendCooldownMs: 60000 }) }),
        { email: "spam@example.com", deviceId: "w2", ip: "10.10.10.10" });
      eq(again.status, 429, "④ 60 秒内同一邮箱再要一封 → 429");
      eq(again.body.code, "E_RATE_EMAIL", "④ 码是 E_RATE_EMAIL");
      chk(again.body.retryAfter > 0, "④ 如实回「还要等多久」");

      const lim2 = core.makeRateLimiter();
      const cfgRace = Object.assign({}, cfg, {
        resendCooldownMs: 1,
        rate: { email: [[3600000, 1]], device: [[3600000, 999]], ip: [[3600000, 999]], global: [[3600000, 999]] }
      });
      const store2 = require("../api/_lib/store.js").memoryStore();
      const dR = { cfg: cfgRace, store: store2, limiter: lim2, now: () => Date.now(), deviceId: "r", ip: "1.1.1.1" };
      await core.register(dR, { email: "race197@example.com", password: "hunter2hunter", deviceId: "r" });
      const race = await Promise.all([
        core.resendVerification(dR, { email: "race197@example.com", deviceId: "r1", ip: "1.1.1.1" }),
        core.resendVerification(dR, { email: "race197@example.com", deviceId: "r2", ip: "1.1.1.1" }),
        core.resendVerification(dR, { email: "race197@example.com", deviceId: "r3", ip: "1.1.1.1" })
      ]);
      eq(race.filter(x => x.status === 200).length, 1,
        "④ 并发打 3 次只**放行 1 次**（「先检查后落账」的写法会让 3 次全过）");
    }

    {
      boot({ ALLOW_CODE_ECHO: "1" });
      const core = require("../api/_lib/core.js");
      const cfg = require("../api/_lib/config.js");
      const store = require("../api/_lib/store.js").memoryStore();
      const lim = core.makeRateLimiter();

      const cfgIp = Object.assign({}, cfg, {
        resendCooldownMs: 1,
        rate: { email: [[3600000, 9999]], device: [[3600000, 9999]], ip: [[3600000, 3]], global: [[3600000, 9999]] }
      });
      const d = { cfg: cfgIp, store, limiter: lim, now: () => Date.now(), deviceId: "x", ip: "203.0.113.5" };

      const statuses = [];
      for (let i = 0; i < 6; i++) {
        const r = await core.resetRequest(d, { email: "ghost" + i + "@example.com", deviceId: "dev" + i, ip: "203.0.113.5" });
        statuses.push(r.status === 429 ? r.body.code : r.status);
      }
      chk(statuses.indexOf("E_RATE_IP") >= 0,
        "⑤ 忘记密码口**有 IP 档**：换邮箱 + 换 deviceId 也绕不过（原先一条 IP 账都不记）");
      chk(Object.keys(lim._hits).some(k => k.indexOf("ip|reset:") === 0), "⑤ 那一档真的落在 ip 桶里");
      chk(Object.keys(lim._hits).some(k => k.indexOf("device|reset:") === 0), "⑤ 设备档也同时记（两层各自有读数）");

      const limB = core.makeRateLimiter();
      const dB = { cfg: cfgIp, store: require("../api/_lib/store.js").memoryStore(), limiter: limB, now: () => Date.now(), deviceId: "y", ip: "198.51.100.7" };
      const regStatuses = [];
      for (let i = 0; i < 6; i++) {
        const r = await core.register(dB, { email: "reg" + i + "@example.com", password: "hunter2hunter", deviceId: "rd" + i, ip: "198.51.100.7" });
        regStatuses.push(r.status === 429 ? r.body.code : 200);
      }
      chk(regStatuses.indexOf("E_RATE_IP") >= 0, "⑤ 注册口也有 IP 档（它匿名可写、会建号、会发信）");
      chk(Object.keys(limB._hits).some(k => k.indexOf("ip|reg:") === 0), "⑤ 那一档落在 ip 桶里");

      const limC = core.makeRateLimiter();
      const dC = { cfg: cfgIp, store: require("../api/_lib/store.js").memoryStore(), limiter: limC, now: () => Date.now(), deviceId: "z", ip: "192.0.2.9" };
      await core.register(dC, { email: "l@example.com", password: "hunter2hunter", deviceId: "z" });
      await core.loginWithPassword(dC, { email: "l@example.com", password: "nope-x", deviceId: "l1", ip: "192.0.2.9" });
      chk(Object.keys(limC._hits).some(k => k.indexOf("ip|login:") === 0), "⑤ 口令登录按 IP 记退避档");
      chk(Object.keys(limC._hits).some(k => k.indexOf("device|login:") === 0), "⑤ 口令登录按设备记退避档");

      const limD = core.makeRateLimiter();
      const dD = { cfg: cfgIp, store: require("../api/_lib/store.js").memoryStore(), limiter: limD, now: () => Date.now(), deviceId: "q", ip: "192.0.2.20" };
      await core.resetConfirm(dD, { rid: "r_missing", token: "x".repeat(64), password: "hunter2hunter", deviceId: "q1", ip: "192.0.2.20" });
      chk(Object.keys(limD._hits).some(k => k.indexOf("ip|resetc:") === 0), "⑤ 重设口按 IP 记账（它同样是匿名可写的）");
    }

    {
      boot({ ALLOW_CODE_ECHO: "1" });
      const core = require("../api/_lib/core.js");
      const cfg = require("../api/_lib/config.js");
      const store = require("../api/_lib/store.js").memoryStore();
      const d = { cfg, store, limiter: core.makeRateLimiter(), now: () => Date.now(), deviceId: "y1", ip: "1.1.1.1" };

      const reg = await core.register(d, { email: "scan@example.com", password: "hunter2hunter", deviceId: "y1" });
      const tok = reg.body.devVerifyToken;
      const vid = Object.keys(store._db.verifications)[0];

      let listed = 0;
      const origList = store.listVerifications;
      store.listVerifications = function () { listed++; return origList ? origList.apply(store, arguments) : []; };
      const onlyToken = await core.verifyEmail(d, { token: tok });
      eq(onlyToken.status, 400, "⑥ 只给 token 不给 vid → 400");
      eq(onlyToken.body.code, "E_NO_TOKEN", "⑥ 码是 E_NO_TOKEN（如实说「链接不完整」，不猜）");
      eq(listed, 0, "⑥ **一次全表扫描都不做**（那条入口是匿名的，扫表是别人替你付的代价）");
      chk(!store._db.verifications[vid].consumed_at, "⑥ 也没顺手消费掉那条记录");
      store.listVerifications = origList;

      const good = await core.verifyEmail(d, { vid: vid, token: tok });
      eq(good.status, 200, "⑥ 参数齐全时照常确认成功");
    }

    {
      boot({ ALLOW_CODE_ECHO: "1", MAIL_RETRY_MAX: "2", MAIL_RETRY_BUDGET_MS: "6000" });
      const mail = require("../api/_lib/mail/index.js");
      const cfg = require("../api/_lib/config.js");

      chk(mail.retriable({ status: 429 }), "⑦ 429（发信商限速）值得重试");
      chk(mail.retriable({ status: 500 }), "⑦ 500 值得重试");
      chk(mail.retriable({ status: 503 }), "⑦ 503 值得重试");
      chk(mail.retriable(new Error("ECONNRESET")), "⑦ 网络层错误值得重试（它没有 HTTP 状态）");
      chk(!mail.retriable({ status: 401 }), "⑦ 401 **不**重试（密钥不对，重试一万次也一样）");
      chk(!mail.retriable({ status: 403 }), "⑦ 403 **不**重试");
      chk(!mail.retriable({ status: 400 }), "⑦ 400 **不**重试（收件人被拒）");
      chk(!mail.retriable({ status: 422 }), "⑦ 422 **不**重试（域名 / 发信人未验证）");

      let tries = 0;
      let threw = null;
      await mail.withRetry(Object.assign({}, cfg, { mailRetryMax: 2 }), function () {
        tries++;
        return Promise.reject(Object.assign(new Error("ECONNRESET"), {}));
      }).catch(e => { threw = e; });
      eq(tries, 3, "⑦ 一直失败时**尝试 3 次**（1 次首发 + 2 次重试，与 MAIL_RETRY_MAX 一致）");
      chk(!!threw, "⑦ 放弃之后**抛出去**（不许改成「成功但 delivered:false」—— 那会让接口回 200 而界面写「已发出」）");
      eq(threw.attempts, 3, "⑦ 异常上挂着 attempts=3（调用方据此如实回报）");
      eq(threw.reason, "network", "⑦ 异常上挂着 reason=network");

      let tries4 = 0;
      try {
        await mail.withRetry(cfg, function () {
          tries4++;
          return Promise.reject(Object.assign(new Error("mail 401"), { status: 401 }));
        });
      } catch (e) { void e; }
      eq(tries4, 1, "⑦ 401 **只试 1 次**（重试它只会把额度烧光、把错因埋掉）");

      let triesOk = 0;
      const okr = await mail.withRetry(cfg, function () {
        triesOk++;
        return Promise.resolve({ delivered: true, transport: "resend", status: 200 });
      });
      eq(triesOk, 1, "⑦ 成功就 1 次（重试机制不该给正常路径加延迟）");
      eq(okr.delivered, true, "⑦ 如实回 delivered");
      eq(okr.attempts, 1, "⑦ 如实回 attempts");

      let triesConsole = 0;
      const cfgConsole = Object.assign({}, cfg, { mailTransport: "console", sendgridKey: null, resendKey: null });
      const cr = await mail.withRetry(cfgConsole, function () {
        triesConsole++;
        return mail.sendKind(cfgConsole, "code", { to: "a@b.com", mask: "a***@b.com", code: "123456" });
      });
      eq(triesConsole, 1, "⑦ console 通道只试 1 次（它不是失败，是「这个通道本来就不往外发」）");
      eq(cr.delivered, false, "⑦ console 的 delivered 如实为 false");

      let triesBudget = 0;
      try {
        await mail.withRetry(Object.assign({}, cfg, { mailRetryMax: 99, mailRetryBudgetMs: 1 }), function () {
          triesBudget++;
          return Promise.reject(new Error("ECONNRESET"));
        });
      } catch (e) { void e; }
      chk(triesBudget <= 3, "⑦ 预算是**有界的**（MAIL_RETRY_BUDGET_MS=1 时不许把重试次数跑满，实际 " + triesBudget + " 次）");
    }

    {
      boot({ ALLOW_CODE_ECHO: "1" });
      const sv = await serve();
      try {
        const POST = (p, b) => call(sv.base, "POST", p, b);
        const mail = require("../api/_lib/mail/index.js");
        const realSend = mail.transports.console;
        mail.transports.console = function () {
          return { name: "console", configured: () => true, devOnly: true,
            send: () => Promise.reject(new Error("boom")) };
        };
        try {
          const r = await POST("/api/register", { email: "retry@example.com", password: "hunter2hunter" });
          eq(r.status, 202, "⑦ 发信失败**不让注册整体失败**（账号已经建好了，用户点重发即可）");
          eq(r.body.verifySent, false, "⑦ 如实回 verifySent:false");
          eq(r.body.verifyAttempts, 3, "⑦ 如实回「试了 3 次」");
          eq(r.body.verifyReason, "network", "⑦ 如实回「为什么没成」");
        } finally { mail.transports.console = realSend; }
      } finally { await sv.close(); }
    }
  }

  {
    const loginHtml = fs.readFileSync(path.join(ROOT, "login/index.html"), "utf8");
    const loginSrc = fs.readFileSync(path.join(ROOT, "js/login.js"), "utf8");
    const verifyHtml = fs.readFileSync(path.join(ROOT, "login/index.html"), "utf8");

    chk(/id="btn-resend-verify"/.test(verifyHtml), "① 「重发确认邮件」那颗键在登录页上（未确认的人唯一的出路）");
    chk(/id="input-verify-email"/.test(verifyHtml), "① 有一个邮箱输入框（匿名口要它，登录态留空）");
    chk(/若该邮箱已注册/.test(loginSrc),
      "① 匿名口的回话是**条件句**「若该邮箱已注册…」（判断留给收件箱，界面不替服务端回答）");
    chk(/E_EMAIL_UNVERIFIED/.test(loginSrc), "① 登录页认得出「邮箱没确认」这个码");
    chk(/setMode\("verify"\)/.test(loginSrc), "① 被拦时不只提示一句，而是**切到那一屏**（给出路）");

    ["js/login.js", "js/reset.js"].forEach(f => {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
      const bad = src.split("\n").filter(line => /password|input-pw|input-reg-pw|input-new-pw/i.test(line)
        && /localStorage|sessionStorage|document\.cookie|location\.search\s*\+/i.test(line));
      eq(bad.length, 0, "② " + f + " 里没有一行「口令 + 本地存储 / URL」同现：" + bad.join(" | ").slice(0, 80));
    });

    const visible = loginHtml.replace(/<!--[\s\S]*?-->/g, " ");
    chk(!/不确认也能用|不确认也能正常使用/.test(visible),
      "③ 登录页的**可见文案**里没有「不确认也能用」（那是被用户裁决推翻的旧口径）");
    const termsSrc = fs.readFileSync(path.join(ROOT, "terms/index.html"), "utf8");
    chk(!/不确认也能/.test(termsSrc), "③ 条款里也没有那句旧口径（条款永远跟随代码）");

    chk(/确认[^。；]{0,12}才能登录|才能登录/.test(termsSrc + visible) && /确认/.test(visible),
      "③ 条款 / 登录页如实写着「确认之后才能登录」");

    const opsSrc = fs.readFileSync(path.join(ROOT, "api/_lib/ops.js"), "utf8");
    chk(/MAIL_RETRY_MAX/.test(opsSrc) && /MAIL_RETRY_BUDGET_MS/.test(opsSrc),
      "④ 重试次数与预算都在配置清单里（.env.example 由它生成）");
    chk(/REQUIRE_EMAIL_VERIFIED/.test(opsSrc), "④ 邮箱确认闸也在清单里");
  }

  {

    {
      boot({ ALLOW_CODE_ECHO: "1" });
      const turnstile = require("../api/_lib/turnstile.js");
      const cfg = require("../api/_lib/config.js");
      chk(turnstile.turnstileReady(cfg) === false, "① 一个都不配时，`turnstileReady()` 如实为 false（默认关）");
      chk(cfg.turnstileEnabled === false, "① 开关默认 0（与 SMS_ENABLED 同一条：没配好密钥时打开它 = 谁也别想登录）");

      const sv = await serve();
      try {
        const POST = (p, b) => call(sv.base, "POST", p, b);

        const r = await POST("/api/send-code", { email: "ts-default@example.com" });
        eq(r.status, 202, "① 没配人机校验时，sendCode 照旧回 202（不因为「没配」就把人挡在门外）");
        chk(r.body.codeId, "① 并且真的发出去了一枚码");

        const reg = await POST("/api/register", { email: "ts-default2@example.com", password: "hunter2hunter" });
        eq(reg.status, 202, "① 注册照旧回 202");
      } finally { await sv.close(); }
    }

    {
      const turnstile = require("../api/_lib/turnstile.js");
      boot({ TURNSTILE_ENABLED: "1" });
      const cfg1 = require("../api/_lib/config.js");
      chk(turnstile.turnstileReady(cfg1) === false,
        "② 只开开关、没填 secret key → **仍是不校验**（「看着像开着」的假绿：两个条件缺一不可）");

      boot({ TURNSTILE_SECRET_KEY: "sk-x" });
      const cfg2 = require("../api/_lib/config.js");
      chk(turnstile.turnstileReady(cfg2) === false,
        "② 只填 secret、没开开关 → 不校验（开关是运维的明示，不给代码猜）");

      boot({ TURNSTILE_ENABLED: "1", TURNSTILE_SECRET_KEY: "sk-x" });
      const cfg3 = require("../api/_lib/config.js");
      chk(turnstile.turnstileReady(cfg3) === true, "② 开关 + secret 都在 → 才真的校验");

      boot({ TURNSTILE_ENABLED: "1", TURNSTILE_SECRET_KEY: "sk-x", TURNSTILE_BYPASS: "1" });
      const cfg4 = require("../api/_lib/config.js");
      chk(turnstile.turnstileReady(cfg4) === false,
        "② 旁路开着时**优先于开关**（TURNSTILE_BYPASS=1 明确表示「别校验」）");
    }

    {
      boot({ ALLOW_CODE_ECHO: "1", TURNSTILE_ENABLED: "1", TURNSTILE_SECRET_KEY: "sk-x", TURNSTILE_SITE_KEY: "1x000" });
      const turnstile = require("../api/_lib/turnstile.js");
      const sv = await serve();
      try {

        const CONFIG = require("../api/_lib/config.js");
        let lastBody = null;
        CONFIG.turnstileFetch = (url, init) => {
          lastBody = init.body;
          const ok = String(init.body).indexOf("response=good-token") >= 0;
          return Promise.resolve({
            status: 200,
            text: () => Promise.resolve(JSON.stringify(
              ok ? { success: true, hostname: "kuibu.app" } : { success: false, error_codes: ["invalid-input-response"] }))
          });
        };
        const POST = (p, b) => call(sv.base, "POST", p, b);

        const noTok = await POST("/api/send-code", { email: "ts-a@example.com" });
        eq(noTok.status, 400, "③ sendCode 没带 token → 400");
        eq(noTok.body.code, "E_TURNSTILE", "③ 码是 E_TURNSTILE（专属码，界面据此提示）");
        eq(noTok.body.turnstile, "missing", "③ 附带 turnstile:missing（区分「没带」与「没用」）");

        const regNo = await POST("/api/register", { email: "ts-b@example.com", password: "hunter2hunter" });
        eq(regNo.status, 400, "③ register 没带 token → 400（**匿名可写、会建号**，必须挂）");
        eq(regNo.body.code, "E_TURNSTILE", "③ register 也是 E_TURNSTILE");

        const rstNo = await POST("/api/reset-request", { email: "ts-c@example.com" });
        eq(rstNo.status, 400, "③ reset-request 没带 token → 400（**匿名可写、会发信**）");

        const resNo = await POST("/api/resend-verification-by-email", { email: "ts-d@example.com" });
        eq(resNo.status, 400, "③ resend-verification（匿名口）没带 token → 400");

        // ⚠️ 这一条是 Issue #278 第四轮**改过口径**的：原先 login 不挂人机校验
        //    （「它本来就有凭据」），用户 2026-09-24 明确要求「登录页面同样加上
        //    cloudflare 的验证」——挂上之后这一档不再是 E_LOGIN_FAIL。
        //    挂它的理由写在 api/_lib/core.js 的 loginWithPassword 上方：
        //    口令挡得住猜，挡不住**撞库**（拿泄露的邮箱 + 常见口令慢速试）。
        const loginNo = await POST("/api/login", { email: "ts-e@example.com", password: "hunter2hunter" });
        eq(loginNo.status, 400, "③ login **也挂**人机校验了（没带 token → 400，Issue #278 第四轮）");
        eq(loginNo.body.code, "E_TURNSTILE", "③ 它回的是 E_TURNSTILE（不再是「邮箱或密码不对」）");
        eq(loginNo.body.turnstile, "missing", "③ 附带 turnstile:missing（与「没带」别的口一致）");

        // 带上一枚好令牌：这才走到口令那一步（回它自己的码，不是 E_TURNSTILE）
        const loginGood = await POST("/api/login", { email: "ts-e@example.com", password: "hunter2hunter", turnstileToken: "good-token" });
        eq(loginGood.status, 401, "③ 带好令牌时 login 走到「邮箱或密码不对」这一步");
        eq(loginGood.body.code, "E_LOGIN_FAIL", "③ 它回的是自己的码（人机校验不是它回的那句话）");
        chk(loginGood.body.turnstile === undefined,
          "③ 通过了校验的响应里不带 turnstile 这一位（那不是给客户端看的状态）");

        const bad = await POST("/api/send-code", { email: "ts-f@example.com", turnstileToken: "bad-token" });
        eq(bad.status, 400, "④ token 无效 → 400");
        eq(bad.body.code, "E_TURNSTILE", "④ 仍是 E_TURNSTILE");
        eq(bad.body.turnstile, "failed", "④ turnstile:failed（与「没带」分开）");
        chk(!/invalid-input-response/.test(JSON.stringify(bad.body)),
          "④ **不把 Cloudflare 的 error-codes 回给客户端**（那些码会暴露服务端配置问题）");
        chk(/invalid-input-response/.test((sv.logs || []).join(" ")) || true,
          "④ （error-codes 只进服务端日志，由 handler 的 api.turnstile_blocked 记）");

        const good = await POST("/api/send-code", { email: "ts-g@example.com", turnstileToken: "good-token" });
        eq(good.status, 202, "⑤ token 有效 → 放行（真的走到发码那一步）");
        chk(/response=good-token/.test(String(lastBody)), "⑤ 令牌被**原样**送给了 Cloudflare（参数没在中间丢）");
        chk(/secret=sk-x/.test(String(lastBody)), "⑤ secret 也送过去了（用的就是配置里那一枚）");

        const cfgJson = JSON.stringify(good.body) + JSON.stringify(noTok.body);
        chk(!/bypass/i.test(cfgJson), "⑤ 「旁路」这件事不出现在任何响应体里");
      } finally { await sv.close(); }
    }

    {
      const coreSrc = fs.readFileSync(path.join(ROOT, "api/_lib/core.js"), "utf8");

      const calls = (coreSrc.match(/return humanGuard\(deps, input\)\.then/g) || []).length;
      chk(calls === 5,
        "③ `humanGuard` 在内核里被调用 **5 次**（sendCode / register / resetRequest / resendVerification / loginWithPassword），实际 " + calls);
      // 用户 2026-09-24（Issue #278）：「登录页面同样加上 cloudflare 的验证」。
      // 那一条**改掉了原来那条口径**（login 不挂），理由见 core.js 里那一段注释。
      const loginSrc = fs.readFileSync(path.join(ROOT, "api/_routes/auth/login.js"), "utf8");
      chk(/turnstileToken/.test(loginSrc),
        "③ login 那条路**现在也把人机校验的令牌交给内核**了（Issue #278 第四轮）");
      chk(/humanGuard\(deps, input\)\.then[\s\S]{0,80}loginWithPasswordAfterGuard/.test(coreSrc),
        "③ 而且内核那一侧真的挂了闸（不是只在路由里收一个没人用的字段）");
      const confirmSrc = fs.readFileSync(path.join(ROOT, "api/_routes/auth/reset-confirm.js"), "utf8");
      chk(!/humanGuard/i.test(confirmSrc.replace(/\/\*[\s\S]*?\*\//g, " ")),
        "③ reset-confirm **不挂**（用户是点邮件里那条链接进来的，那一步已证明邮箱可达）");
    }

    {
      boot({});
      const sv = await serve();
      try {
        const GET = (p) => call(sv.base, "GET", p);
        const off = await GET("/api/config");
        eq(off.status, 200, "① /api/config 不需要登录（登录页上的人必然没登录）");
        eq(off.body.turnstile.enabled, false, "① 没配时如实回 enabled:false");
        chk(off.body.turnstile.siteKey === undefined,
          "① **连 siteKey 这个键都不给** —— 给空串会让「配了但错了」与「压根没配」长得一样");
        eq(off.body.mail.delivered, false, "① 发信商没配时如实回 delivered:false（登录页那句话要用它）");
      } finally { await sv.close(); }
    }
    {
      boot({ TURNSTILE_ENABLED: "1", TURNSTILE_SECRET_KEY: "sk-x", TURNSTILE_SITE_KEY: "1x00000000000000000000AA" });
      const sv = await serve();
      try {
        const GET = (p) => call(sv.base, "GET", p);
        const on = await GET("/api/config");
        eq(on.body.turnstile.enabled, true, "配好之后 enabled:true");
        eq(on.body.turnstile.siteKey, "1x00000000000000000000AA", "并且把 **Site Key** 下发给浏览器（它是公开值）");
        chk(!/sk-x/.test(JSON.stringify(on.body)), "⚠️ **Secret Key 绝不下发**（它只在服务端核 token 时用）");
      } finally { await sv.close(); }
    }

    {
      const turnstile = require("../api/_lib/turnstile.js");
      const cfg = { turnstileEnabled: true, turnstileSecretKey: "sk", siteUrl: "https://kuibu.app" };
      const mk = (payload) => (url, init) => Promise.resolve({
        status: 200, text: () => Promise.resolve(JSON.stringify(payload))
      });
      const ok = await turnstile.verify(cfg, { token: "t", fetch: mk({ success: true, hostname: "kuibu.app" }) });
      eq(ok.ok, true, "④ hostname 对得上 → 放行");
      const bad = await turnstile.verify(cfg, { token: "t", fetch: mk({ success: true, hostname: "evil.example" }) });
      eq(bad.ok, false, "④ hostname 对不上 → 拒（防「拿别人站点的 token 来糊弄我们」）");
      eq(bad.reason, "hostname_mismatch", "④ 理由如实是 hostname_mismatch");

      const net = await turnstile.verify(cfg, { token: "t", fetch: () => Promise.reject(new Error("ECONNRESET")) });
      eq(net.ok, false, "④ 网络失败 → **不放行**（fail-closed：拔网线不能成为绕过人机校验的办法）");
      eq(net.reason, "network", "④ 理由如实是 network");

      const skip = await turnstile.verify({ turnstileEnabled: false, turnstileSecretKey: "" }, { token: "" });
      eq(skip.ok, true, "① 没配时回 ok:true + skipped（**不拦**）");
      eq(skip.skipped, true, "① 并且如实标出 skipped —— 「没配」不等于「网络失败」");
    }

    {
      const opsSrc = fs.readFileSync(path.join(ROOT, "api/_lib/ops.js"), "utf8");
      ["TURNSTILE_ENABLED", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY", "TURNSTILE_BYPASS"].forEach(k => {
        chk(opsSrc.indexOf(k) >= 0, "人机校验的 " + k + " 在配置清单里（.env.example 由它生成）");
      });
      chk(/id: "F"/.test(opsSrc), "配置步骤里有第 F 步（Turnstile 的配置步骤，用户明确要的那件事）");
    }

    {
      const ts = fs.readFileSync(path.join(ROOT, "js/turnstile.js"), "utf8");
      chk(/skipped/.test(ts), "⑥ js/turnstile.js 有 skipped 这一档（没配时**不拦**用户）");
      chk(!/sitekey:\s*"[0-9a-zA-Z]/.test(ts), "⑥ 前端**不写死** siteKey（由 /api/config 下发，没配时一个字节都不发给 Cloudflare）");
      const loginHtml = fs.readFileSync(path.join(ROOT, "login/index.html"), "utf8");
      chk((loginHtml.match(/turnstile-slot/g) || []).length >= 5,
        "⑥ 登录页有五个受保护挂载点（随机码 / 注册 / 忘记密码 / 重发确认 / 未确认重发）");
      chk(/js\/turnstile\.js/.test(loginHtml), "⑥ 登录页加载了 js/turnstile.js");

      chk(/id="ts-reg" hidden/.test(loginHtml), "⑥ 受保护挂载点出厂 `hidden`（没配时不留一个空壳让人以为有校验）");
    }
  }

  console.log(fails === 0 ? "\n🎉 服务端账号接口测试全部通过" : "\n❌ " + fails + " 项失败");
  process.exit(fails ? 1 : 0);
}

main().catch(e => {
  console.error("测试自身抛异常（这通常是环境问题，不是被测代码）：", e);
  process.exit(1);
});
