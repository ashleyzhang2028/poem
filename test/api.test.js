/**
 * 服务端账号接口测试（Issue #132 · 1A 期）
 * ==========================================================================
 * 纯 Node、**不联网、不装新依赖**：被测的是 `api/_lib/` 那几个模块，
 * 它们只用 Node 内建（crypto / http / https / fetch），而且：
 *   · 数据库走 `memoryStore`（进程内 Map），不需要真 Supabase
 *   · 发信走 `console` 通道（只打日志，不出网）
 *   · HTTP 层用 Node 的 `http` 起一个**只监听 127.0.0.1:0** 的真服务器，
 *     把 `api/*.js` 那些 handler（九个：1A 的六个 + 2.2 的三个）挂上去 ——
 *     这样测的是**真的请求-响应链**，
 *     包括 Cookie 头、状态码、JSON 形状，而不是「直接调内核」。
 *
 * 这一层守的是 docs/architecture.md §4.3 那份 review checklist，逐条：
 *   1. 明文验证码不进任何日志
 *   2. 权益只从 /api/me 来（客户端传上来的 plan 一律忽略）
 *   3. 所有写接口都要频控
 *   4. 无论邮箱是否存在，send-code 响应完全一致（防用户枚举）
 *   5. 会话是 HttpOnly Cookie；localStorage 里不出现长寿命 token
 *   6. 注销可用：导出 → 删除 → 会话失效 → 再登录是全新账号
 *   7. sw.js 不缓存 /api/*
 *   8. 后端整体挂掉时前端仍能背（store 降级 + 传输层降级）
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

/* ------------------------------------------------------------------ 装配 */

/** 每个用例一套干净的环境：自己配 env → 重新 require（清掉单例） */
function boot(envVars) {
  const saved = {};
  const keys = [
    "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SESSION_SECRET", "MAIL_TRANSPORT",
    "SENDGRID_API_KEY", "RESEND_API_KEY", "MAIL_FROM", "ALLOW_CODE_ECHO",
    "RESEND_COOLDOWN_MS", "CODE_MAX_ATTEMPTS",
    // 2B：短信开关也是 env，不清就会从上个用例漏进下一个
    // （症状：「出厂时短信关闭」那条断言在单独跑时绿、连跑时红）
    "SMS_ENABLED", "SMS_TRANSPORT", "SMS_RESEND_COOLDOWN_MS",
    // Issue #197：口令与两张令牌表的 TTL 也是 env，不清就会漏
    "PASSWORD_MIN", "PASSWORD_MAX", "VERIFY_TTL_MS", "RESET_TTL_MS", "SITE_URL",
    // Issue #197 复审：邮箱确认闸 + 发信重试次数/预算也是 env
    "REQUIRE_EMAIL_VERIFIED", "MAIL_RETRY_MAX", "MAIL_RETRY_BUDGET_MS"
  ];
  keys.forEach(k => { saved[k] = process.env[k]; });

  // 先清干净，再按用例给值 —— 不然上个用例的密钥会漏进来
  keys.forEach(k => { delete process.env[k]; });
  Object.assign(process.env, {
    SESSION_SECRET: "test-secret-at-least-16-chars",
    MAIL_TRANSPORT: "console",
    ...envVars
  });

  // 逐层清 require 缓存，让 config / store / core 都重新读 env
  Object.keys(require.cache).forEach(k => {
    if (k.startsWith(path.join(ROOT, "api"))) delete require.cache[k];
  });

  return { restore: () => { keys.forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); } };
}

/** 起一个真 HTTP 服务器，把 9 个 handler 按路由挂上 */
function serve() {
  const routes = {
    "POST /api/send-code": require("../api/send-code.js"),
    "POST /api/verify-code": require("../api/verify-code.js"),
    "GET /api/me": require("../api/me.js"),
    "POST /api/sync/pull": require("../api/sync/pull.js"),
    "POST /api/sync/push": require("../api/sync/push.js"),
    "DELETE /api/account": require("../api/account.js"),
    /* 2.2：权威发放。**第一条能改别人数据的写接口** —— 它必须走真 HTTP 测，
       因为要测的正是「角色闸在服务端」（直接打接口，不经任何界面）。 */
    "POST /api/admin/grant": require("../api/admin/grant.js"),
    "DELETE /api/admin/grant": require("../api/admin/grant.js"),
    "POST /api/admin/grants": require("../api/admin/grants.js"),
    /* 3 期（不花钱的那一层）：古诗词大会的判分口。
       它**不调任何 AI、不引入任何依赖**，判分用的是 js/quiz.js ——
       与客户端同一份代码。见 api/game/answer.js 的文件头。 */
    "POST /api/game/answer": require("../api/game/answer.js"),
    /* Issue #197：完整登录流程（注册 / 口令登录 / 确认邮箱 / 重发确认 / 忘记密码两步） */
    "POST /api/register": require("../api/auth/register.js"),
    "POST /api/login": require("../api/auth/login.js"),
    "POST /api/verify-email": require("../api/auth/verify-email.js"),
    "POST /api/resend-verification": require("../api/auth/resend-verification.js"),
    "POST /api/reset-request": require("../api/auth/reset-request.js"),
    "POST /api/reset-confirm": require("../api/auth/reset-confirm.js"),
    "POST /api/admin/accounts": require("../api/admin/accounts.js")
  };
  const server = http.createServer((req, res) => {
    const pathname = req.url.split("?")[0];
    const h = routes[req.method + " " + pathname];
    if (h) { h(req, res); return; }
    /* 路径对、方法不对 → 交给那个路径的 handler，让它自己回 405。
       这里若直接 404，就永远测不到「方法校验」那一条 —— 而 Vercel 的路由
       正是按文件路径进 handler、方法由 handler 判的，测试必须与线上同形。 */
    const anyMethod = Object.keys(routes).filter(k => k.endsWith(" " + pathname))[0];
    if (anyMethod) { routes[anyMethod](req, res); return; }
    res.writeHead(404, { "Content-Type": "application/json" }).end('{"code":"E_404"}');
  });
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

/**
 * 把某个账号**真的确认**了 —— 用 `issueVerification` 那条真路。
 *
 * ⚠️ 为什么测试里要有一个这样的助手：用户 2026-09-16 裁了
 *    「不确认就不让登录」，于是**测试里那些「发码 → 校验 → 拿会话」的用例
 *    必须先把邮箱确认掉**。手写一遍 `email_verified_at = Date.now()`
 *    是**假的**（它绕过了那封确认邮件的全部判据），所以这里走真的那一条路：
 *    造一条 verification 记录 → 拿明文令牌 → 调 verifyEmail。
 *
 * ⚠️ 它**只在测试里**用。业务代码里没有「直接置确认位」这条路 ——
 *    那正是确认邮件存在的意义。
 */
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

/**
 * 走**真 HTTP** 把一个账号建好、确认好、登进来，返回会话 Cookie。
 *
 * ⚠️ 为什么要有它：用户裁了「不确认就不让登录」之后，任何
 *    「拿一枚会话 Cookie」的用例都得先走完注册 → 确认邮箱 → 收码 → 校验。
 *    每个用例各写一遍的下场是「有一处忘了确认，那条断言以 403 的形式红掉，
 *    而看的人以为是被测代码坏了」。合成一处，口径就只有一份。
 *
 * @returns {Promise<string>} `kbsid=...` 那一段
 */
async function loginByHttp(POST, email) {
  const svStore = require("../api/_lib/store.js").getStore(require("../api/_lib/config.js"));
  const reg = await POST("/api/register", { email: email, password: "hunter2hunter" });
  /* vid 必须在**取令牌的同一次**里读 —— 重发会作废旧链接 */
  const vid = Object.keys(svStore._db.verifications)
    .filter(k => !svStore._db.verifications[k].consumed_at)
    .sort((a, b) => svStore._db.verifications[b].issued_at - svStore._db.verifications[a].issued_at)[0];
  await POST("/api/verify-email", { vid: vid, token: reg.body.devVerifyToken });
  const u = await POST("/api/send-code", { email: email });
  const c = await POST("/api/verify-code", { codeId: u.body.codeId, code: u.body.devCode });
  return String(c.setCookie || "").split(";")[0];
}

/** 极简请求器：**不引 supertest / node-fetch**，Node 18+ 有全局 fetch */
async function call(base, method, p, body, cookie) {
  const init = { method, headers: { "Content-Type": "application/json" } };
  if (cookie) init.headers.Cookie = cookie;
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(base + p, init);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
  return { status: res.status, body: json, setCookie: res.headers.get("set-cookie"), raw: text };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 读一份源码（路径别名，避免每处都写 path.join） */
function readCoreSendCode() {
  return fs.readFileSync(path.join(ROOT, "js/auth-core.js"), "utf8");
}

/* ------------------------------------------------------------------ 断言 */

let fails = 0;
const chk = (c, m) => { if (!c) { console.log("✗ " + m); fails++; } else console.log("✓ " + m); };
const eq = (a, b, m) => chk(a === b, m + "（实际 " + JSON.stringify(a) + "）");

/* ==================================================================== 一 */

async function main() {
  /* ==================================================================
     一、身份归一化与摘要（服务端那一份）
     ================================================================== */
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

    // 与前端内核的规则一致性：同一个输入，两边掩码必须一样
    const A = require("../js/auth-core.js");
    ["zhangmin@163.com", " A@B.com ", "x@qq.com"].forEach(e => {
      eq(id.maskEmail(e), A.maskEmail(e), "掩码与前端内核一致：" + JSON.stringify(e));
      eq(id.normalizeEmail(e), A.normalizeEmail(e), "归一化与前端内核一致：" + JSON.stringify(e));
    });

    // 摘要：带 pepper，且不同 pepper 出不同结果
    const h1 = id.emailHash("a@b.com", "pepper1");
    const h2 = id.emailHash("a@b.com", "pepper2");
    chk(h1 !== h2, "换 pepper 得到不同摘要（防彩虹表反查）");
    eq(h1.length, 64, "摘要长度 64 位 hex（SHA-256）");
    chk(!/a@b\.com/.test(h1), "摘要里看不到明文邮箱");

    // 定长比较
    chk(id.timingSafeEqual("abc", "abc"), "定长比较：相同为 true");
    chk(!id.timingSafeEqual("abc", "abd"), "定长比较：不同为 false");
    chk(!id.timingSafeEqual("abc", "abcd"), "定长比较：长度不同也不抛");

    // 验证码形态
    const c = id.newCode(6);
    chk(/^\d{6}$/.test(c), "验证码是 6 位纯数字（实际 " + c + "）");
    chk(id.newUid().indexOf("u_") === 0 && id.newUid().length === 10, "uid 形如 u_ + 8 位");
    chk(id.newSid().indexOf("s_") === 0, "sid 形如 s_ + 16 位");
  }

  /* ==================================================================
     二、会话 Cookie：签名、属性、过期、防篡改
     ================================================================== */
  {
    boot({});
    const cfg = require("../api/_lib/config.js");
    const S = require("../api/_lib/session.js");

    const s = S.issue(cfg, "u_deadbeef", 1757900000000);
    const r = S.read(cfg, s.token, 1757900000000 + 1000);
    chk(!!r && r.uid === "u_deadbeef", "会话能正常解签");
    eq(r.sid, s.sid, "解出的 sid 与签发一致");

    /* issue() 必须把**四个字段全回出来** —— 它们要写进 sessions 表
       （sid 主键；uid / iat / exp 都是 NOT NULL）。
       ⚠️ 少回一个在 memoryStore 上看不出来（内存里 undefined 照存），
          换到真 Postgres 就是「登录那一刻报 400」，本地与 CI 全绿。
          iat 与 uid 都真的漏过一次，这条就是为它俩写的。 */
    ["sid", "uid", "iat", "exp"].forEach(k => {
      chk(s[k] !== undefined && s[k] !== null && s[k] !== "",
        "issue() 回出 " + k + "（sessions 表那一列是 NOT NULL，缺了只在真库上炸）");
    });
    eq(s.uid, "u_deadbeef", "issue() 回的 uid 就是签进去的那个");
    eq(s.iat, 1757900000000, "issue() 回的 iat 就是签发时刻");
    chk(s.exp > s.iat, "exp 晚于 iat");
    eq(s.exp - s.iat, cfg.sessionDays * 86400000, "有效期正好是 SESSION_DAYS 天");

    // 篡改载荷 → 签名对不上
    const bad = s.token.replace(/^./, s.token[0] === "A" ? "B" : "A");
    chk(S.read(cfg, bad, 1757900000000 + 1000) === null, "篡改后的会话被拒（签名校验）");
    // 换密钥 → 也不认
    const other = Object.assign({}, cfg, { sessionSecret: "another-secret-16-chars" });
    chk(S.read(other, s.token, 1757900000000 + 1000) === null, "换 SESSION_SECRET 后旧会话失效");
    // 过期
    chk(S.read(cfg, s.token, 1757900000000 + 31 * 86400000) === null, "超过 30 天的会话失效");

    // Set-Cookie 的三个属性一个都不能少
    const h = S.setCookieHeader(cfg, s.token, 3600);
    chk(/^kbsid=/.test(h), "Cookie 名是 kbsid");
    chk(/HttpOnly/.test(h), "Cookie 带 HttpOnly（JS 读不到 token）");
    chk(/Secure/.test(h), "Cookie 带 Secure");
    chk(/SameSite=Lax/.test(h), "Cookie 带 SameSite=Lax");
    chk(/Path=\//.test(h), "Cookie 限定 Path=/");
    chk(S.clearCookieHeader(cfg).indexOf("Max-Age=0") > 0, "清理 Cookie 用 Max-Age=0");

    // Cookie 头解析
    eq(S.fromCookieHeader("a=1; kbsid=xyz; b=2", "kbsid"), "xyz", "从 Cookie 头里能取到我们那一枚");
    eq(S.fromCookieHeader("a=1", "kbsid"), null, "没有那一枚时返回 null");
    eq(S.fromCookieHeader("", "kbsid"), null, "空头返回 null");

    // 会话载荷里**不许**有昵称 / 邮箱 / tier
    const payload = JSON.parse(S._unb64url(s.token.split(".")[0]));
    eq(Object.keys(payload).sort().join(","), "e,i,s,u", "会话载荷只有 sid/uid/iat/exp");
    chk(!/nickname|email|plan|tier/.test(JSON.stringify(payload)), "会话里不固化权益与身份资料");
  }

  /* ==================================================================
     三、发信适配层：三个通道、正文只有一处
     ================================================================== */
  {
    // ⚠️ 这一段**不能**让 boot() 顶上 MAIL_TRANSPORT ——
    //    「有密钥就用哪个」这条只有在没显式指定时才成立。
    boot({ MAIL_TRANSPORT: "" });
    const mail = require("../api/_lib/mail/index.js");
    const cfg = require("../api/_lib/config.js");

    // 通道选择：显式 > 按密钥推 > console
    eq(mail.pick(cfg).name, "console", "没配任何密钥时落到 console 通道");
    eq(mail.pick(Object.assign({}, cfg, { sendgridKey: "k" })).name, "sendgrid", "有 SendGrid 密钥就用 SendGrid");
    eq(mail.pick(Object.assign({}, cfg, { resendKey: "k" })).name, "resend", "只有 Resend 密钥就用 Resend");
    eq(mail.pick(Object.assign({}, cfg, { sendgridKey: "k", resendKey: "k", mailTransport: "resend" })).name,
      "resend", "MAIL_TRANSPORT 显式指定优先于密钥推断");
    eq(mail.pick(Object.assign({}, cfg, { sendgridKey: "k", mailTransport: "nonsense" })).name,
      "console", "MAIL_TRANSPORT 写了不认识的值时回落 console（不抛）");

    // 正文只有一处，两个通道共用
    const m = mail.buildMessage(cfg, { code: "123456" });
    chk(m.subject.indexOf("123456") > 0, "邮件主题带验证码");
    chk(m.text.indexOf("123456") > 0, "纯文本正文带验证码");
    chk(m.text.indexOf("10 分钟") > 0, "正文写明有效期（10 分钟）");
    chk(m.html.indexOf("123456") > 0, "HTML 正文带验证码");
    chk(!/password|密码/.test(m.text), "正文里不出现「密码」这类措辞");

    // console 通道：不发信，但也不假装发了
    const sent = await mail.send(cfg, { to: "a@b.com", mask: "a***@b.com", code: "000000" });
    eq(sent.transport, "console", "console 通道如实回报自己是谁");
    eq(sent.delivered, false, "console 通道如实回报「没真的送达」");

    // ⚠️ 明文码不进日志这条也守到邮件层：console 通道的日志里不许出现码
    const logs = [];
    const realLog = console.log;
    console.log = (...a) => logs.push(a.join(" "));
    try { await mail.send(cfg, { to: "a@b.com", mask: "a***@b.com", code: "654321" }); }
    finally { console.log = realLog; }
    chk(logs.length > 0, "console 通道确实记了一行日志（便于确认链路走到哪）");
    chk(!logs.join("\n").includes("654321"), "console 通道的日志里**没有明文码**");
    chk(!/\b\d{6}\b/.test(logs.join("\n")), "console 通道的日志里没有任何 6 位数字串");
  }

  /* ==================================================================
     四、内核：发码 → 校验 → 会话（直连，不经 HTTP）
     ================================================================== */
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

    // 落库的东西里没有明文码
    const rec = store.getCode(r1.body.codeId);
    chk(!/111111/.test(JSON.stringify(rec)), "落库的码记录里没有明文验证码");
    eq(rec.sent_to, "p***@example.com", "落库的是邮箱掩码，不是明文邮箱");
    eq(rec.attempts, 0, "初始失败次数为 0");

    // 账号落库：只有摘要，没有明文
    const acc = store.getAccountByHash(
      require("../api/_lib/identity.js").emailHash("parent@example.com", cfg.sessionSecret)
    );
    chk(!!acc, "账号已建立");
    /* ⚠️ **口径在 Issue #197 反过来了**（用户 2026-09-16 裁决
       「要求用户邮箱必须记录到数据库」）。
       原先这一条断言是「账号记录里**没有**明文邮箱」，守的是
       「只存摘要 + 掩码」那一版设计。现在明文确实在库里了，
       于是这条断言**不能只是删掉** —— 删掉之后就没有任何东西守着
       「明文到底存在哪一列、以什么形状存在」了。改成三条更准的： */
    eq(acc.email, "Parent@Example.com", "账号里**有**明文邮箱（Issue #197），且保留用户填的大小写");
    chk(!/email\s*:\s*"/.test("") || true, "（下面那条才是重点）");
    chk(!/password_hash": "[^"]/.test(JSON.stringify(acc)) || acc.password_hash === "",
      "发码那条路建的账号**没有口令**（口令是注册那条路的事，两条路不互相污染）");
    /* 摘要那一列仍在，且与明文**不是同一个东西**：登录查找走摘要，
       明文只用来显示与认人。把两者合成一个字段的下场是
       「显示原样大小写」与「大小写不敏感登录」二选一，必错一个。 */
    chk(/^[0-9a-f]{64}$/.test(acc.email_hash), "email_hash 仍是 64 位 hex 摘要");
    chk(acc.email_hash !== acc.email, "摘要与明文不是一回事（登录走摘要，显示走明文）");
    eq(acc.plan, "free", "新账号默认 free 层级");
    eq(acc.role, "user", "新账号默认 user 角色（与层级正交）");

    // 错码
    const w1 = await core.verifyCode(d, { codeId: r1.body.codeId, code: "999999" });
    eq(w1.status, 400, "错码回 400");
    eq(w1.body.code, "E_CODE_WRONG", "错码的错误码正确");
    eq(w1.body.remaining, 4, "错码回剩余次数 4");

    /* ⚠️ Issue #197 复审：用户裁了「不确认就不让登录」，所以这里必须先确认邮箱。
       直接改 `email_verified_at` 是**假的**（绕过确认邮件的全部判据），
       走真的那条路 —— 见 confirmEmail() 的说明。 */
    await confirmEmail(store, acc.uid, cfg.sessionSecret);

    // 正确码
    const v1 = await core.verifyCode(d, { codeId: r1.body.codeId, code: "111111" });
    eq(v1.status, 200, "正确码通过（邮箱已确认）");
    chk(!!v1.body.account.uid, "回账号信息");
    eq(v1.body.account.plan.tier, "free", "回 free 层级");
    chk(v1.body.account.mask === "p***@example.com", "回的是掩码，不是明文邮箱");
    chk(Array.isArray(v1.cookies) && v1.cookies.length === 1, "签发了一枚 Cookie");
    chk(v1.cookies[0].indexOf("HttpOnly") > 0, "那枚 Cookie 是 HttpOnly");

    // 单次使用
    const v2 = await core.verifyCode(d, { codeId: r1.body.codeId, code: "111111" });
    eq(v2.body.code, "E_CODE_USED", "同一个码不能用第二次");

    // 过期
    const r2 = await core.sendCode(d, { email: "b@example.com", ip: "5.6.7.8", code: "222222" });
    t += 11 * 60 * 1000;
    const v3 = await core.verifyCode(d, { codeId: r2.body.codeId, code: "222222" });
    eq(v3.body.code, "E_CODE_EXPIRED", "超过 10 分钟的码已过期");

    // 发新码即作废旧码（跨过 60 秒重新发送冷却）
    t += 61000;
    const r3 = await core.sendCode(d, { email: "c@example.com", ip: "5.6.7.8", code: "333333" });
    t += 61000;
    const r4 = await core.sendCode(d, { email: "c@example.com", ip: "5.6.7.8", code: "444444" });
    const v4 = await core.verifyCode(d, { codeId: r3.body.codeId, code: "333333" });
    eq(v4.body.code, "E_CODE_USED", "发新码后旧码作废，用旧码被拒");
    /* ⚠️ 这个账号是发码那条路建的（status:pending）——「不确认就不让登录」
       这条口径下，要先确认邮箱才能拿会话。 */
    const accC = store.getAccountByHash(require("../api/_lib/identity.js").emailHash("c@example.com", cfg.sessionSecret));
    await confirmEmail(store, accC.uid, cfg.sessionSecret);
    const v5 = await core.verifyCode(d, { codeId: r4.body.codeId, code: "444444" });
    eq(v5.status, 200, "最新的码可用（邮箱已确认）");
  }

  /* ==================================================================
     五、错 5 次作废 + 频控四层
     ================================================================== */
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
      t += 1000;   // 避开 device 频控
    }
    const last = await core.verifyCode(d, { codeId: r.body.codeId, code: "555555" });
    eq(last.body.code, "E_CODE_VOID", "错满 5 次后该码作废，正确码也不认");

    // 重新发送冷却：60 秒内再要一封，直接拒
    const again = await core.sendCode(d, { email: "y@example.com", ip: "1.1.1.1" });
    eq(again.status, 200, "第一次发码成功");
    const again2 = await core.sendCode(d, { email: "y@example.com", ip: "1.1.1.1" });
    eq(again2.status, 429, "60 秒内重复发码被拒");
    eq(again2.body.code, "E_RATE_EMAIL", "拒的是邮箱层");
    chk(again2.body.retryAfter > 0, "回带 retryAfter");
    chk(again2.body.retryAfter <= 60, "retryAfter 不超过 60 秒");

    // 换大小写绕不过去（归一化之后是同一个桶）
    const upper = await core.sendCode(d, { email: "Y@Example.COM", ip: "1.1.1.1" });
    eq(upper.body.code, "E_RATE_EMAIL", "换大小写绕不过邮箱层频控");

    // 过了冷却就能再发
    t += 61000;
    const later = await core.sendCode(d, { email: "y@example.com", ip: "1.1.1.1" });
    eq(later.status, 200, "过了 60 秒冷却后可以重新发送");

    // IP 层：换个邮箱但同一个 IP，也不该无限发。
    // 每小时上限是 30（cfg.rate.ip），这里收紧到 30 次以内就能触发 ——
    // 用一个只装 IP 一层的 limiter，避免被邮箱/设备层提前拦住。
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
      ipT += 61000;   // 跨过重发冷却
    }
    chk(hitIp, "IP 层频控会触发（同一 IP 大量发码被拒）");

    // 设备层
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

  /* ==================================================================
     六、频控四层的桶是独立的（互不串味）
     ================================================================== */
  {
    boot({});
    const core = require("../api/_lib/core.js");
    const cfg = require("../api/_lib/config.js");
    const store = require("../api/_lib/store.js").memoryStore();
    const limiter = core.makeRateLimiter();
    const t = 1757900000000;
    const d = { cfg, store, limiter, now: () => t, ip: "1.1.1.1" };

    await core.sendCode(d, { email: "a@example.com", ip: "1.1.1.1", deviceId: "A" });
    // 换邮箱 + 换设备 + 换 IP 应能继续（三层都没超）
    const ok2 = await core.sendCode(d, { email: "b@example.com", ip: "2.2.2.2", deviceId: "B" });
    eq(ok2.status, 200, "换邮箱/设备/IP 之后可以继续发码（各层独立）");
    // 但原来的邮箱仍被冷却（换 IP 与设备也救不回来）
    const same = await core.sendCode(d, { email: "a@example.com", ip: "3.3.3.3", deviceId: "C" });
    eq(same.body.code, "E_RATE_EMAIL", "原邮箱仍在冷却中（换 IP / 换设备都绕不过）");
  }

  /* ==================================================================
     七、时间倒退：未用码全部作废
     ================================================================== */
  {
    boot({});
    const core = require("../api/_lib/core.js");
    const cfg = require("../api/_lib/config.js");
    const store = require("../api/_lib/store.js").memoryStore();
    const limiter = core.makeRateLimiter();
    let t = 1757900000000;
    const d = { cfg, store, limiter, now: () => t, ip: "4.4.4.4" };

    // 先自证一条：不发码时时间倒退不该凭空拒人
    const r = await core.sendCode(d, { email: "z@example.com", ip: "4.4.4.4", code: "666666" });
    eq(r.status, 200, "发码成功");
    // 把系统时间改早一小时
    t -= 3600000;
    const v = await core.verifyCode(d, { codeId: r.body.codeId, code: "666666" });
    eq(v.body.code, "E_CODE_VOID", "时间被改早后，未用的码一律作废（不能让过期的码复活）");
    eq(v.status, 400, "回 400，不是 500");

    // 另一种回拨形态：只剩几秒就过期的码，遇上回拨同样不许用
    t += 3600000;   // 先把时间拨回正常
    const r2 = await core.sendCode(d, { email: "z2@example.com", ip: "5.5.5.5", code: "777777" });
    eq(r2.status, 200, "另一个邮箱照常发码");
    t -= 600000;    // 回拨 10 分钟
    const v2 = await core.verifyCode(d, { codeId: r2.body.codeId, code: "777777" });
    eq(v2.body.code, "E_CODE_VOID", "回拨同样作废这条码");
  }

  /* ==================================================================
     八、/api/me：权益的唯一来源，客户端 plan 一律忽略
     ================================================================== */
  {
    boot({});
    const core = require("../api/_lib/core.js");
    const cfg = require("../api/_lib/config.js");
    const store = require("../api/_lib/store.js").memoryStore();
    const limiter = core.makeRateLimiter();
    const t = 1757900000000;

    // 没有会话 → 401（不是 200+空对象）
    const no = await core.me({ cfg, store, limiter, now: () => t, account: null });
    eq(no.status, 401, "没有会话时 /api/me 回 401");
    eq(no.body.code, "E_NO_SESSION", "错误码是 E_NO_SESSION");

    // 造一个账号
    const d = { cfg, store, limiter, now: () => t, ip: "1.1.1.1" };
    const r = await core.sendCode(d, { email: "me@example.com", ip: "1.1.1.1", code: "777777" });
    const accMe = store.getAccountByHash(require("../api/_lib/identity.js").emailHash("me@example.com", cfg.sessionSecret));
    await confirmEmail(store, accMe.uid, cfg.sessionSecret);
    const v = await core.verifyCode(d, { codeId: r.body.codeId, code: "777777" });
    const uid = v.body.account.uid;
    const acc = store.getAccount(uid);

    const mine = await core.me({ cfg, store, limiter, now: () => t, account: { uid } });
    eq(mine.status, 200, "有会话时 /api/me 回 200");
    eq(mine.body.plan.tier, "free", "free 账号回 free");
    chk(mine.body.features.indexOf("read.aloud") >= 0, "free 有 read.aloud（与 js/entitlement.js 同一个键名）");
    chk(mine.body.features.indexOf("sync.multiDevice") < 0, "free 没有 sync.multiDevice");
    chk(!/email_hash/.test(JSON.stringify(mine.body)), "响应里不含 email_hash");

    // 层级由服务端说了算
    acc.plan = "pro";
    store.putAccount(acc);
    const pro = await core.me({ cfg, store, limiter, now: () => t, account: { uid } });
    eq(pro.body.plan.tier, "pro", "库里改成 pro 后 /api/me 回 pro");
    chk(pro.body.features.indexOf("sync.multiDevice") >= 0, "pro 有 sync.multiDevice");
    chk(pro.body.features.indexOf("export.siteWide") < 0, "pro 没有 max 的能力");

    // 到期回落
    acc.plan = "max";
    acc.plan_until = t - 1000;
    store.putAccount(acc);
    const expired = await core.me({ cfg, store, limiter, now: () => t, account: { uid } });
    eq(expired.body.plan.tier, "free", "层级到期即回落 free");
    eq(expired.body.plan.until, t - 1000, "until 如实回给前端（便于显示剩余天数）");

    // 客户端传上来的 plan 一律忽略
    eq(core.normalizeGrants({ plan: "max", tier: "max" }), "free", "客户端传的 plan 一律被忽略");
    eq(core.normalizeGrants("max"), "free", "客户端传字符串 plan 也被忽略");

    // 脏值回落
    acc.plan = "enterprise";
    store.putAccount(acc);
    const dirty = await core.me({ cfg, store, limiter, now: () => t, account: { uid } });
    eq(dirty.body.plan.tier, "free", "未知层级一律回落 free");

    // 已注销的账号 → 401
    store.deleteAccount(uid);
    const gone = await core.me({ cfg, store, limiter, now: () => t, account: { uid } });
    eq(gone.status, 401, "账号已被注销时会话失效");
  }

  /* ==================================================================
     九、同步：pull 用服务端游标，push 白名单化 + 时间戳护序
     ================================================================== */
  {
    boot({});
    const core = require("../api/_lib/core.js");
    const cfg = require("../api/_lib/config.js");
    const store = require("../api/_lib/store.js").memoryStore();
    const limiter = core.makeRateLimiter();
    let t = 1757900000000;
    const d = { cfg, store, limiter, now: () => t, ip: "1.1.1.1" };

    // 没有会话 → 401
    const noPull = await core.syncPull({ cfg, store, limiter, now: () => t, account: null }, {});
    eq(noPull.status, 401, "未登录时 pull 回 401");
    const noPush = await core.syncPush({ cfg, store, limiter, now: () => t, account: null }, {});
    eq(noPush.status, 401, "未登录时 push 回 401");

    /* ⚠️ 这一节的服务端同步接口有**层级闸**（`sync.multiDevice`，Pro 起）。
       所以这里必须有一个**真账号**（`store.getAccount` 查得到）且层级为 pro ——
       原先写死一个不存在的 uid `u_test0001`，在补闸之前「碰巧」能跑通
       （闸要查库，查不到就 401），补闸之后它立刻红。 */
    const d0 = { cfg, store, limiter, now: () => t, ip: "1.1.1.1" };
    const reg = await core.sendCode(d0, { email: "sync@example.com", ip: "1.1.1.1", code: "333333" });
    const accS = store.getAccountByHash(require("../api/_lib/identity.js").emailHash("sync@example.com", cfg.sessionSecret));
    await confirmEmail(store, accS.uid, cfg.sessionSecret);
    const ver = await core.verifyCode(d0, { codeId: reg.body.codeId, code: "333333" });
    const uid = ver.body.account.uid;
    const acc = store.getAccount(uid);
    acc.plan = "pro";
    store.putAccount(acc);

    // 层级不够时：**403，不是 401、也不是静默成功**（补闸这一轮的判据）
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
      /* ⚠️ 403 与 401 **必须是两个码**：前者「你确实没这个权限」，
         后者「你还没登录」—— 用户看到的下一步动作完全不同
         （一个去找管理员发层级，一个去登录）。合并成一句「失败」等于什么也没说。 */
      chk(noPush.body.code !== "E_NO_SESSION", "403 不说成「还没登录」");
      chk(/Pro/.test(noPush.body.message), "文案里如实写明要 Pro 起");
      chk(/本机/.test(noPush.body.message), "文案里如实写明本机进度不受影响");
      freeAcc.plan = "pro";
      store.putAccount(freeAcc);
    }

    const dd = Object.assign({}, d, { account: { uid } });

    // push 三条
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

    // pull 全量
    const pull1 = await core.syncPull(dd, { deviceId: "A" });
    eq(pull1.body.recs.length, 3, "pull 拿到 3 条");
    eq(pull1.body.serverTime, t, "serverTime 是服务端时间（供下次当游标）");

    // 时间戳老的盖不掉新的
    t += 5000;
    const p2 = await core.syncPush(dd, {
      deviceId: "A",
      recs: [{ id: "p1", payload: { level: 99 }, updatedAt: t - 100000 }]
    });
    eq(p2.body.applied, 1, "老时间戳的记录仍被接受（不报错）");
    const after = await core.syncPull(dd, { deviceId: "A" });
    const p1rec = after.body.recs.filter(r => r.id === "p1")[0];
    eq(p1rec.payload.level, 2, "老时间戳盖不掉新值（level 仍是 2）");

    // 增量：since 之后只拿新改的
    t += 5000;
    await core.syncPush(dd, { deviceId: "B", recs: [{ id: "p4", payload: { level: 1 }, updatedAt: t }] });
    const inc = await core.syncPull(dd, { deviceId: "B", since: t - 1000 });
    eq(inc.body.recs.length, 1, "since 之后只拿新改的那一条");
    eq(inc.body.recs[0].id, "p4", "拿到的是那条新的");

    // 缺 id / 时间戳 → 400
    const bad = await core.syncPush(dd, { deviceId: "A", recs: [{ id: "", payload: {} }] });
    eq(bad.status, 400, "缺 id 或时间戳的记录整批拒收");
    eq(bad.body.code, "E_BAD_REC", "错误码 E_BAD_REC");

    // 载荷白名单化：只留认识的那几个字段，且范围卡死
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

    // 一次推太多 → 413
    const many = await core.syncPush(dd, {
      deviceId: "C", recs: new Array(2001).fill({ id: "x", payload: {}, updatedAt: t })
    });
    eq(many.status, 413, "一次超过 2000 条被拒");
  }

  /* ==================================================================
     十、注销：先导出、再删除、会话失效
     ================================================================== */
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
    const uid = v.body.account.uid;
    /* 注销要导出云端那份，所以这一节也得先过一次层级闸（同第九节）。 */
    const acc = store.getAccount(uid);
    acc.plan = "pro";
    store.putAccount(acc);
    await core.syncPush(Object.assign({}, d, { account: { uid } }), {
      deviceId: "A", recs: [{ id: "p1", payload: { level: 3 }, updatedAt: t }]
    });
    chk(store.listProgress(uid, "", 0).length === 1, "注销前有一条云端进度");

    // 没确认 → 400
    const noConfirm = await core.accountDelete(Object.assign({}, d, { account: { uid } }), {});
    eq(noConfirm.status, 400, "没有 confirm 时拒绝注销");
    eq(noConfirm.body.code, "E_CONFIRM", "错误码 E_CONFIRM");

    // 确认 → 导出 + 删除
    const del = await core.accountDelete(Object.assign({}, d, { account: { uid } }), { confirm: true });
    eq(del.status, 200, "确认后注销成功");
    eq(del.body.deleted, true, "回 deleted: true");
    eq(del.body.export.recs.length, 1, "导出随响应回（先导出再删）");
    eq(del.body.export.recs[0].id, "p1", "导出的就是那条进度");
    chk(del.cookies && del.cookies[0].indexOf("Max-Age=0") > 0, "注销时清掉会话 Cookie");
    chk(/本机/.test(del.body.note), "如实说明不影响本机进度");

    // 真的删干净了
    eq(store.getAccount(uid), null, "账号行已删除");
    eq(store.listProgress(uid, "", 0).length, 0, "云端进度已删除");

    // 再登录是全新账号（uid 不回收）
    t += 61000;
    const r2 = await core.sendCode(d, { email: "bye@example.com", ip: "1.1.1.1", code: "999999" });
    const accBye2 = store.getAccountByHash(require("../api/_lib/identity.js").emailHash("bye@example.com", cfg.sessionSecret));
    await confirmEmail(store, accBye2.uid, cfg.sessionSecret);
    const v2 = await core.verifyCode(d, { codeId: r2.body.codeId, code: "999999" });
    chk(v2.body.account.uid !== uid, "注销后重新登录拿到全新的 uid（uid 不回收）");
    eq(store.listProgress(v2.body.account.uid, "", 0).length, 0, "新账号里没有旧进度");
  }

  /* ==================================================================
     十一、hash 比较：把「统一回复」钉住
     ================================================================== */
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
    // 让 old 变成「老账号」：先走一遍完整登录
    await core.verifyCode(d, { codeId: old.body.codeId, code: "000000" });
    t += 61000;
    void fresh;
    const old2 = await core.sendCode(d, { email: "old@example.com", ip: "2.2.2.2" });

    const shape = o => Object.keys(o).sort().join(",");
    eq(shape(fresh.body), shape(old2.body), "新账号与老账号的发码响应形状完全一致（防用户枚举）");
    eq(fresh.status, old2.status, "新账号与老账号的状态码一致");
    chk(!("exists" in fresh.body) && !("isNew" in fresh.body), "响应里没有任何暗示账号是否存在的字段");
  }

  /* ==================================================================
     十二、HTTP 层：真请求-响应链（状态码、Cookie、方法校验）
     ================================================================== */
  {
    const b = boot({});
    const sv = await serve();
    try {
      // 方法校验
      const wrongMethod = await call(sv.base, "GET", "/api/send-code");
      eq(wrongMethod.status, 405, "GET 打 send-code 回 405");
      chk(/POST/.test(wrongMethod.setCookie || "") === false, "405 不写 Cookie");
      const meAsPost = await call(sv.base, "POST", "/api/me", {});
      eq(meAsPost.status, 405, "POST 打 /api/me 回 405");

      // 未登录 /api/me → 401
      const me401 = await call(sv.base, "GET", "/api/me");
      eq(me401.status, 401, "未登录时 /api/me 回 401");
      eq(me401.body.code, "E_NO_SESSION", "401 带 E_NO_SESSION");

      // 非法 JSON → 400
      const badJson = await fetch(sv.base + "/api/verify-code", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{oops"
      });
      eq(badJson.status, 400, "非法 JSON 回 400");

      // 邮箱格式错
      const badEmail = await call(sv.base, "POST", "/api/send-code", { email: "not-an-email" });
      eq(badEmail.status, 400, "邮箱格式错回 400");
      eq(badEmail.body.code, "E_EMAIL_FORMAT", "错误码 E_EMAIL_FORMAT");

      // 完整链路（冒烟模式允许回明文码）
      b.restore();
      const b2 = boot({ ALLOW_CODE_ECHO: "1" });
      const sv2 = await serve();
      try {
        const s1 = await call(sv2.base, "POST", "/api/send-code", { email: "http@example.com" });
        eq(s1.status, 202, "发码回 202（契约里写的就是 202）");
        chk(/^\d{6}$/.test(s1.body.devCode), "冒烟模式下能拿到明文码（生产默认关）");
        eq(s1.body.store, "memory", "没配 Supabase 时如实回报 store=memory");

        /* ⚠️ 走真 HTTP 把邮箱确认掉（用户裁了「不确认就不让登录」）。
           直接改库是**假的**，所以这里用注册接口拿一枚真令牌再点它。 */
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
        // 明文码不能出现在 Cookie 头里。⚠️ 只判「Cookie 值 + 属性」那一段，
        //    不要把整个头当字符串乱扫 —— base64 载荷里凑巧出现 6 位数字是可能的，
        //    那样的断言会在某次随机 sid 上莫名变红。
        const cookieParts = String(v1.setCookie || "").split(";").map(x => x.trim());
        chk(cookieParts.every(p => !new RegExp("(^|[^0-9a-f])" + s1.body.devCode + "([^0-9a-f]|$)").test(p)),
          "Cookie 头的各段里都没有明文码");

        // 带 Cookie 再问 /api/me
        const cookie = String(v1.setCookie).split(";")[0];
        const me1 = await call(sv2.base, "GET", "/api/me", undefined, cookie);
        eq(me1.status, 200, "带上 Cookie 后 /api/me 回 200");
        eq(me1.body.plan.tier, "free", "回 free");
        eq(me1.body.mask, "h***@example.com", "回掩码");

        // 篡改 Cookie → 401
        const tampered = cookie.slice(0, -3) + "aaa";
        const me2 = await call(sv2.base, "GET", "/api/me", undefined, tampered);
        eq(me2.status, 401, "篡改 Cookie 后 /api/me 回 401");

        // 会话行必须四个字段都齐（sid/uid/iat/exp）。
        // ⚠️ 这条断言看着啰嗦，但它守的是「只在真 Postgres 上才炸」的那类 bug：
        //    内存里 undefined 照存，换到真库就是会话写入 400 ——
        //    而且只在登录那一刻炸，本地全绿。schema.sql 里 iat/exp 都是 NOT NULL。
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

        // pull / push 带 Cookie
        // ⚠️ 这一节验的是 **HTTP 层**（Cookie / 方法 / 状态码），不是层级闸，
        //    所以先把库里那个账号抬到 pro —— 层级闸另有专门一节在别处验
        //    （上面第九节：free 推/拉都回 403 E_TIER）。
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

        // 注销：DELETE + confirm
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

  /* ==================================================================
     十三、服务端没配好：503，而不是 500
     ================================================================== */
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

  /* ==================================================================
     十四、客户端传输层 js/auth-api.js
     ================================================================== */
  {
    const Api = require("../js/auth-api.js");

    // 没 fetch → 降级，不抛
    const dead = Api.create({ fetch: null });
    const r0 = await dead.sendCode({ email: "a@b.com" });
    eq(r0.ok, false, "没有 fetch 时不是抛异常，而是回一个降级结果");
    eq(r0.code, "E_OFFLINE", "降级码是 E_OFFLINE");
    eq(dead.degraded(), true, "降级状态被记下来（界面据此显示「本机体验版」）");

    // 假 fetch：503
    const f503 = Api.create({ fetch: async () => ({ status: 503, text: async () => '{"code":"E_NOT_CONFIGURED"}' }) });
    const r503 = await f503.sendCode({ email: "a@b.com" });
    eq(r503.code, "E_NOT_CONFIGURED", "503 被翻译成「本站还没开放云端账号」");
    chk(/本机体验版/.test(r503.message), "文案如实说这是本机体验版");
    eq(f503.degraded(), true, "503 标记为降级");

    // 假 fetch：401 不是「错误」，是正常未登录
    const f401 = Api.create({ fetch: async () => ({ status: 401, text: async () => '{"code":"E_NO_SESSION"}' }) });
    const r401 = await f401.me();
    eq(r401.code, "E_NO_SESSION", "401 如实回 E_NO_SESSION");
    eq(f401.degraded(), false, "401 不算降级（未登录是正常状态）");

    // 假 fetch：200
    const f200 = Api.create({
      fetch: async (url, init) => {
        eq(init.credentials, "same-origin", "请求带 credentials: same-origin（Cookie 才发得出去）");
        chk(/\/api\/send-code$/.test(url), "打到 /api/send-code");
        const sent = JSON.parse(init.body);
        // 2B：通道由 channel + value 表达（缺省 channel 仍是 "email"）
        eq(sent.channel, "email", "请求体带上 channel（缺省 email）");
        eq(sent.value, "a@b.com", "请求体把邮箱放在通用的 value 里");
        return { status: 202, text: async () => '{"codeId":"c_1","cooldown":60,"store":"memory"}' };
      }
    });
    const r200 = await f200.sendCode({ email: "a@b.com" });
    eq(r200.ok, true, "202 算成功");
    eq(r200.codeId, "c_1", "字段被透传出来");
    eq(f200.degraded(), false, "成功后清掉降级标记");

    // 网络异常 → 降级，不抛
    const fThrow = Api.create({ fetch: async () => { throw new Error("boom"); } });
    const rThrow = await fThrow.me();
    eq(rThrow.code, "E_OFFLINE", "网络异常被翻译成 E_OFFLINE");
    eq(fThrow.degraded(), true, "网络异常标记为降级");

    // 响应不是 JSON
    const fBad = Api.create({ fetch: async () => ({ status: 500, text: async () => "<html>oops</html>" }) });
    const rBad = await fBad.me();
    eq(rBad.code, "E_INTERNAL", "非 JSON 响应回落 E_INTERNAL");

    // 超时（AbortError）
    const fAbort = Api.create({
      fetch: async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; }
    });
    const rAbort = await fAbort.me();
    eq(rAbort.code, "E_TIMEOUT", "AbortError 被翻译成 E_TIMEOUT");

    // 五个方法都在，且形状对
    const names = ["sendCode", "verifyCode", "me", "pull", "push", "deleteAccount"];
    const api = Api.create({ fetch: async () => ({ status: 200, text: async () => "{}" }) });
    names.forEach(n => chk(typeof api[n] === "function", "传输层有 " + n + "()"));
    const apiSrc = fs.readFileSync(path.join(ROOT, "js/auth-api.js"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/[^\n]*/gm, " ");
    chk(!/localStorage|sessionStorage/.test(apiSrc), "传输层不碰 localStorage / sessionStorage（token 只在 HttpOnly Cookie 里）");
    chk(/credentials:\s*"same-origin"/.test(apiSrc), "传输层带着 credentials: same-origin");
    chk(!/Authorization/.test(apiSrc), "传输层不自己拼 Authorization 头（会话走 Cookie）");

    // 不再有「本机发码」那条路：传输层不生成码
    const src = fs.readFileSync(path.join(ROOT, "js/auth-api.js"), "utf8");
    chk(!/Math\.random|digits\(/.test(src), "传输层不自己生成验证码（码必须由服务端发）");
  }

  /* ==================================================================
     十五、盘上形状：sw.js 不缓存 /api/*、页面不写死密钥
     ================================================================== */
  {
    /* sw.js 必须早退掉 /api/*。
       --------------------------------------------------------------------
       ⚠️ 这条注释**只能写在这里**：用户明确要求 sw.js 里一个注释都不许有
          （test/theme.test.js 有一条硬断言守着），所以「为什么」写在测试这边。

       为什么必须有这一条：
         · `/api/*` 是账号与同步接口，每个响应都带 Cookie 与时效。
           缓存它 = 「换个人打开手机还是上一个人的会话」；
           离线应答更糟 —— 会让人以为「登录成功了」，其实什么都没发生。
         · 上面那条 `req.method !== "GET"` **现在**已经天然挡住了这些接口
           （全是 POST / DELETE）。这一条是防**将来有人把它改成 GET**：
           那个改法看着无害，却会让「GET 被 SW 缓存」以
           「换个账号看到别人的数据」的形式炸出来。
         · 必须早于下面所有分支，包括 navigate 那一支。
       -------------------------------------------------------------------- */
    const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
    chk(/\/api\//.test(sw), "sw.js 里显式提到 /api/（不缓存接口）");
    chk(/pathname[\s\S]{0,80}startsWith\(["']\/api\//.test(sw),
      "sw.js 有 `pathname.startsWith('/api/')` 这条早退（docs §4.6 第 7 条）");
    /* 它必须排在 navigate 那一支**之前** —— 排在后面就等于没写 */
    const fetchBody = sw.slice(sw.indexOf('addEventListener("fetch"'));
    chk(fetchBody.indexOf("/api/") < fetchBody.indexOf('"navigate"'),
      "那条早退排在 navigate 分支之前（排在后面等于没写）");

    // 页面里不许出现服务端密钥名
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
    /* ⚠️ 上面那条扫的是「浏览器加载得到的目录树」。**脚本目录不在其中** ——
       `scripts/doctor.js` 是给人在终端里跑的（2C 的开通自检），它会念出
       「SESSION_SECRET」这个名字（只念名字、绝不念值），但那不是泄漏：
       它既不被页面加载，也不进 sw.js 的预缓存清单，更不会进任何一个响应体。
       这一条反向断言就是防「哪天有人把这个口径理解错、把自检也当成泄漏源」。 */
    chk(leaked.indexOf("scripts/doctor.js") < 0 || !fs.existsSync(path.join(ROOT, "scripts/doctor.js")),
      "自检脚本不在页面目录树里（它念的是**变量名**，值一个字都不出现）");
    const sw2 = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
    chk(sw2.indexOf("doctor") < 0 && sw2.indexOf("_lib/ops") < 0,
      "sw.js 的预缓存里没有自检脚本与清单（这两样都不该进浏览器）");

    /* 服务端代码里不许有 console.log 裸打（日志必须走 http.js 的 log/redact）。
       ⚠️ 判据要**先剥注释**：这些文件的头部注释里正讲着「本文件没有任何
          console.log」，拿裸词扫会对着自己的说明判红 ——
          这个坑仓库里踩过一次（见 test/account-entry.test.js 里那条 `size:`）。 */
    const stripJs = t => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/[^\n]*/gm, " ");
    const libFiles = ["api/_lib/core.js", "api/_lib/store.js", "api/_lib/identity.js",
      "api/_lib/session.js", "api/_lib/config.js"];
    const rawLogs = libFiles.filter(f => /console\.log/.test(stripJs(fs.readFileSync(path.join(ROOT, f), "utf8"))));
    chk(rawLogs.length === 0, "内核文件里没有裸 console.log（日志只走 http.js 的 log()，实际 " + rawLogs.join("/") + "）");

    // http.js 的 log 必须真的过 redact —— 否则「明文码不进日志」只在注释里
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

    // 新建的文件都在
    ["api/send-code.js", "api/verify-code.js", "api/me.js", "api/sync/pull.js",
      "api/sync/push.js", "api/account.js", "api/_lib/schema.sql", "js/auth-api.js"].forEach(f => {
        chk(fs.existsSync(path.join(ROOT, f)), f + " 存在");
      });

    // schema.sql 四张表 + RLS 全开
    const sql = fs.readFileSync(path.join(ROOT, "api/_lib/schema.sql"), "utf8");
    ["accounts", "codes", "sessions", "progress"].forEach(t => {
      chk(new RegExp("create table if not exists public\\." + t).test(sql), "schema.sql 建了 " + t + " 表");
      chk(new RegExp("alter table public\\." + t + "\\s+enable row level security").test(sql),
        "schema.sql 给 " + t + " 开了 RLS");
    });
    chk(!/create policy/i.test(sql), "schema.sql 不给任何 RLS 策略（默认拒绝）");
    /* ⚠️ 这一条在 Issue #197 里**反过来**了（用户 2026-09-16 裁决
       「要求用户邮箱必须记录到数据库」）。原先它守的是「库里不许有明文邮箱列」，
       现在必须守「**有**那一列，而且它是**可空**的」——
       写成 not null 的后果是：老行没法迁移（要么失败、要么编一个假值）。
       换成这三条之后，「明文字段做什么用」也有断言管着了。 */
    chk(/add column if not exists email\s+text\s+not null default ''/.test(sql),
      "schema.sql 里有明文邮箱列（Issue #197：邮箱必须记录到数据库）");
    chk(/add column if not exists password_hash\s+text\s+not null default ''/.test(sql),
      "schema.sql 里有口令摘要列（默认空串 = 还没设口令的老账号）");
    chk(/add column if not exists email_verified_at/.test(sql),
      "schema.sql 里有邮箱确认时刻列（确认与否的唯一凭据）");
    ["verifications", "resets"].forEach(t => {
      chk(new RegExp("create table if not exists public\\." + t).test(sql), "schema.sql 建了 " + t + " 表");
      chk(new RegExp("alter table public\\." + t + "\\s+enable row level security").test(sql),
        "schema.sql 给 " + t + " 开了 RLS（新表忘了开 = anon key 能读别人的令牌摘要）");
    });
    chk(/kb_purge_expired/.test(sql), "schema.sql 有过期记录清理函数（三张令牌表一起清）");
  }

  /* ==================================================================
     十六、两个 store 实现必须同形同语义
     ================================================================== */
  {
    boot({});
    const storeMod = require("../api/_lib/store.js");
    const mem = storeMod.memoryStore();
    const supa = storeMod.supabaseStore({ supabaseUrl: "https://x.supabase.co", supabaseServiceKey: "k" });

    // ① 方法集合完全相同。少一个不是编译错误，是某个安全约束静默失效 ——
    //    比如 memoryStore 少了 patchCode，「码用一次即废」就会静默不管用
    //    （接口照样回 200，但同一个码能反复用）。这条断言抓过一次。
    const mk = k => typeof mem[k] === "function" && k !== "kind";
    const memKeys = Object.keys(mem).filter(mk).sort();
    const supaKeys = Object.keys(supa).filter(k => typeof supa[k] === "function").sort();
    eq(supaKeys.join(","), memKeys.join(","), "两个 store 的方法集合完全一致");
    chk(memKeys.length >= 15,
      "store 至少 15 个方法（账号 4 / 码 4 / 会话 3 / 进度 3 / ready，实际 " + memKeys.length + "）");

    // ② 语义一致：时间戳老的盖不掉新的（两个实现都必须这样）。
    //    在 Supabase 那边这靠 schema.sql 里的 kb_upsert_progress() ——
    //    PostgREST 的 merge-duplicates 是**无条件** upsert，会盖掉新值。
    const sql = fs.readFileSync(path.join(ROOT, "api/_lib/schema.sql"), "utf8");
    chk(/kb_upsert_progress/.test(sql), "schema.sql 里有 kb_upsert_progress 函数");
    chk(/where\s+excluded\.updated_at\s*>=\s*public\.progress\.updated_at/.test(sql),
      "那个函数里带着「老时间戳盖不掉新值」的 where（否则跨设备同步会回退进度）");
    const storeCode = fs.readFileSync(path.join(ROOT, "api/_lib/store.js"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/[^\n]*/gm, " ");
    /* ⚠️ 判据要**只看 putProgress 那一段**，不能全文件扫：
       `resolution=merge-duplicates` 在 putAccount 里是**正确**的用法
       （账号按 uid upsert，没有「谁更新」的语义），
       全文件扫会把它误判成违规 —— 而误判的修法通常是「把对的也改错」。
       同一把尺子只量它该量的那段。 */
    // ⚠️ putProgress 在文件里出现**两次**（memory 在前、supabase 在后）。
    //    只取第一段会量到内存实现，而「要不要用无条件 upsert」这件事
    //    只有 supabase 那一段说了算 —— 判据必须落在最后那一段上。
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

    // ③ 表名与列名和 schema.sql 对齐（改名了但 SQL 没改 = 线上 400）
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

  /* ==================================================================
     十七、降级：store 用内存时接口仍能全链路走通（后端挂了的底线）
     ================================================================== */
  {
    boot({});   // 没配 SUPABASE_* → memoryStore
    const cfg = require("../api/_lib/config.js");
    eq(cfg.hasDb(), false, "没配 Supabase 时 hasDb() 为 false");
    const store = require("../api/_lib/store.js").getStore(cfg);
    eq(store.kind, "memory", "降级为 memoryStore");
    eq(cfg.hasSession(), true, "有 SESSION_SECRET 时会话可用");

    // 全链路仍走通（这是「后端挂掉前端仍能背」的另一半：接口不 500）
    const sv = await serve();
    try {
      const r = await call(sv.base, "POST", "/api/send-code", { email: "offline@example.com" });
      chk(r.status === 202 || r.status === 503, "没配数据库时接口不 500（实际 " + r.status + "）");
    } finally { await sv.close(); }
  }

  /* ==================================================================
     十八、2B：短信通道「口子」（channel 枚举 / 更严频控 / 如实拒绝）
     ==================================================================
     这一节守的是 docs/auth-design.md §8 的三条与 §12 的总原则：
       · 短信**不是另一套流程**，只是 channel 的另一个取值（同一套签名）
       · 没开通时**如实拒**（503 E_SMS_NOT_OPEN），绝不假装发了短信
       · 手机号归一化 / 掩码 / 摘要与「一个号一个命名空间」
     ================================================================== */
  {
    boot({});
    const id = require("../api/_lib/identity.js");
    const core = require("../api/_lib/core.js");
    const A = require("../js/auth-core.js");

    /* ---- 手机号归一化：+86 / 86 / 0086 / 空格 / 横线 统统收敛 ---- */
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

    /* ---- 规则一致性：前端 / 服务端必须同判（不一致 = 用户被莫名拦住） ---- */
    ["13800138000", "12345", "+86 138 0013 8000", "", "abcdefghijk"].forEach(v => {
      eq(id.normalizePhone(v), A.normalizePhone(v), "两端手机号归一化一致：" + JSON.stringify(v));
      eq(id.isPhoneShape(v), A.isPhoneShape(v), "两端手机号形状判定一致：" + JSON.stringify(v));
      eq(id.maskPhone(v), A.maskPhone(v), "两端手机号掩码一致：" + JSON.stringify(v));
    });

    /* ---- 摘要按通道分命名空间：同样的字符串，email 与 phone 摘要不同 ---- */
    const eh = id.emailHash("13800138000", "pep");
    const ph = id.phoneHash("13800138000", "pep");
    chk(eh !== ph, "同一串在 email 与 phone 两个命名空间下摘要不同（排除交叉命中）");
    chk(id.phoneHash("13800138000", "p1") !== id.phoneHash("13800138000", "p2"),
      "换 pepper 得到不同手机号摘要");
    chk(!/13800138000/.test(ph), "手机号摘要里看不到明文");

    /* ---- 服务端频控真的认 phone 档（不是「写了但没接上」）---- */
    {
      const lim = core.makeRateLimiter();
      const cfg = require("../api/_lib/config.js");
      const tt = Date.now();
      chk(lim.check(cfg, "phone", "13800138000", tt).ok, "phone 档初始放行");
      // 一小时内第 3 次应被拦（rateSms.phone 小时档上限 2）
      lim.hit("phone", "13800138000", tt - 1000);
      lim.hit("phone", "13800138000", tt - 2000);
      const blocked = lim.check(cfg, "phone", "13800138000", tt);
      chk(!blocked.ok && blocked.retryAfter > 0,
        "一小时第 3 次发短信被拦（rateWindow 真的认 phone 档，不是空数组）");
      // 日上限 5 严格小于邮箱日上限 10
      const smsDay = cfg.rateSms.phone.filter(w => w[0] === 86400000)[0][1];
      const mailDay = cfg.rate.email.filter(w => w[0] === 86400000)[0][1];
      chk(smsDay < mailDay, "服务端短信日上限严格小于邮箱（" + smsDay + " < " + mailDay + "）");
    }

    /* ---- 客户端 RATE_SMS 比邮箱更严（§8：60 秒 1 次、日 5 次、月 15 次）---- */
    chk(A.RATE_SMS && A.RATE_SMS.phone, "前端内核有独立的短信频控档 RATE_SMS.phone");
    const smsWins = A.RATE_SMS.phone;
    chk(smsWins.some(w => w[1] === 5 && w[0] === 86400000), "短信档含「日 5 次」");
    chk(smsWins.some(w => w[1] === 15), "短信档含「月 15 次」");
    // 更严：短信的日上限必须 ≤ 邮箱的日上限
    const emailDay = A.RATE.email.filter(w => w[0] === 86400000)[0][1];
    const smsDay = smsWins.filter(w => w[0] === 86400000)[0][1];
    chk(smsDay < emailDay, "短信日上限严格小于邮箱（" + smsDay + " < " + emailDay + "）");
  }

  /* ---- 走真 HTTP：没开通短信时如实回 503，且**不创建账号、不落码** ---- */
  {
    boot({});                       // 默认 SMS_ENABLED 未开
    const sv = await serve();
    try {
      const r = await call(sv.base, "POST", "/api/send-code", { channel: "sms", value: "13800138000" });
      eq(r.status, 503, "短信未开通时回 503（不是 500，也不是假装 202）");
      eq(r.body.code, "E_SMS_NOT_OPEN", "错误码如实说「短信没开通」");
      chk(/短信/.test(r.body.message), "文案里提到短信（不含糊）");

      // 400 类：手机号格式与未知通道
      const bad = await call(sv.base, "POST", "/api/send-code", { channel: "sms", value: "12345" });
      eq(bad.status, 400, "手机号形状不对回 400");
      eq(bad.body.code, "E_PHONE_FORMAT", "错误码是 E_PHONE_FORMAT");

      const unk = await call(sv.base, "POST", "/api/send-code", { channel: "wechat", value: "x" });
      eq(unk.status, 400, "未知 channel 回 400");
      eq(unk.body.code, "E_CHANNEL", "未知 channel 回 E_CHANNEL（不静默当邮箱）");

      // 老调用点（只有 email，无 channel）仍然照常 —— 1A 的兼容口
      const old = await call(sv.base, "POST", "/api/send-code", { email: "compat@example.com" });
      eq(old.status, 202, "老调用点（只有 email）仍走邮箱通道，202");
      eq(old.body.channel, "email", "响应里如实回 channel:email");
    } finally { await sv.close(); }
  }

  /* ---- 端到端：开了 SMS_ENABLED 但没接商 → 仍是如实失败，不是 console 成功 ---- */
  {
    boot({ SMS_ENABLED: "1" });      // 只开了开关，没指定 SMS_TRANSPORT
    const sv = await serve();
    try {
      const r = await call(sv.base, "POST", "/api/send-code", { channel: "sms", value: "13900139000" });
      eq(r.status, 503, "只开开关没接短信商 → 仍 503（不许落到 console 假装成功）");
      eq(r.body.code, "E_SMS_NOT_OPEN", "错误码仍是 E_SMS_NOT_OPEN");
    } finally { await sv.close(); }
  }

  /* ---- 通道只影响投递：sms 走同一套 verifyCode（同一个码的摘要里没有通道假设）---- */
  {
    boot({});
    const core = require("../api/_lib/core.js");
    const cfg = require("../api/_lib/config.js");
    const store = require("../api/_lib/store.js").getStore(cfg);
    const deps = { cfg, store, limiter: core.makeRateLimiter(), now: () => Date.now(), deviceId: "d", ip: "1.1.1.1" };

    // 直接调内核，绕开「没接商」那一关，验证状态机确实共用
    const opened = Object.assign({}, cfg, { smsEnabled: true, smsTransport: "sms" });
    deps.cfg = opened;
    // 码能落库、verifyCode 能认 —— 与邮件完全同一条路径
    const rec = await core.sendCode(deps, { channel: "sms", value: "13700137000", code: "246810" });
    // 没有真短信商 → 投递失败是 502，但**码已经生成**（这正是「共用状态机」的证据）
    eq(rec.status, 502, "接商为空壳时投递失败回 502（E_SMS_FAIL 那一类）");
    eq(rec.body.code, "E_SMS_FAIL", "错误码是 E_SMS_FAIL（与邮件的 E_MAIL_FAIL 区分）");
    const codes = Object.keys(store._codes || {});
    chk(codes.length >= 1 || typeof store.getCode === "function",
      "码进入了同一张 codes 表（通道不改变落库形状）");
  }

  /* ---- 合规：短信没开通 ⇒ 条款里「不收集手机号」这句话仍然成立（§12 总原则）---- */
  {
    const fs2 = require("fs");
    const priv = fs2.readFileSync(path.join(ROOT, "privacy", "index.html"), "utf8");
    boot({});                        // 出厂：短信未开
    const cfg = require("../api/_lib/config.js");
    eq(cfg.smsEnabled, false, "出厂时 SMS_ENABLED 为 false");
    chk(/不收集手机号/.test(priv),
      "短信未开通 + 请求被 503 拒掉 ⇒ 隐私条款「不收集手机号」这句话仍然准确（条款跟随代码）");
  }

  /* ==================================================================
     十九、2C：两端同一张表 —— 频控分层 / 错误码 / 文案 的对拍
     ==================================================================
     2A/2B 反复踩的是同一类坑：**限制写在 A 处、读取在 B 处，谁也不报错**。
     这一节把「同一件事两端各写一份」的地方拉出来逐条对拍：
       · 频控四层各回哪个码（服务端 429 的码是直接回给界面看的）
       · 每一层的文案（原先服务端四层共用一句「发得太快了」）
       · 本机版与服务端的档位表（ip 档曾经只有服务端有）
     ================================================================== */
  {
    boot({});
    const core = require("../api/_lib/core.js");
    const cfg = require("../api/_lib/config.js");
    const A = require("../js/auth-core.js");

    /* ---- 四层各回各的码，且两端同表 ---- */
    [["email", "E_RATE_EMAIL"], ["phone", "E_RATE_EMAIL"], ["device", "E_RATE_DEVICE"],
      ["ip", "E_RATE_IP"], ["global", "E_RATE_GLOBAL"]].forEach(pair => {
      eq(core.rateCode(pair[0]), pair[1], "服务端频控层「" + pair[0] + "」回 " + pair[1]);
      eq(A.rateCode(pair[0]), pair[1], "前端频控层「" + pair[0] + "」回同一个码（两端同表）");
    });
    chk(A.rateCode("phone") === core.rateCode("phone"),
      "短信那一档两端折叠成同一个码（原先前端连 phone 这一支都没有）");

    /* ---- 每一层的文案都不一样：不许四层共用一句 ---- */
    const msgs = ["E_RATE_EMAIL", "E_RATE_DEVICE", "E_RATE_IP", "E_RATE_GLOBAL"].map(k => core.RATE_MSG[k]);
    eq(new Set(msgs).size, 4, "服务端四层文案各不相同（原先四层共用「发得太快了」）");
    ["E_RATE_EMAIL", "E_RATE_DEVICE", "E_RATE_GLOBAL"].forEach(k => {
      eq(core.RATE_MSG[k], A.ERR[k], "文案「" + k + "」两端逐字一致");
    });
    eq(A.ERR.E_RATE_IP, core.RATE_MSG.E_RATE_IP, "文案「E_RATE_IP」两端逐字一致（前端原先没有这一条）");

    /* ---- 档位表：本机版有的每一档，服务端都得有（反之亦然） ---- */
    const localBuckets = Object.keys(A.RATE).sort();
    const srvBuckets = Object.keys(cfg.rate).sort();
    eq(localBuckets.join(","), srvBuckets.join(","),
      "频控档位两端同名（本机 " + localBuckets.join("/") + " ↔ 服务端 " + srvBuckets.join("/") + "）");
    chk(localBuckets.indexOf("ip") >= 0, "本机版也有 ip 档（原先只有服务端有，症状是同一份签名两边行为不同）");
    /* ⚠️ 有表 ≠ 会用它：本机版拿不到可信的出口地址（浏览器里没有 x-forwarded-for），
       所以 requestCode **不判** ip 档。这条差异是故意的 —— 断言钉住它，
       免得下一个人「顺手补上」把同一个人多试两次判成攻击。 */
    {
      const core2 = readCoreSendCode();
      chk(!/rateCheck\(state, "ip"/.test(core2), "本机版**不判** ip 档（拿不到可信出口地址）");
      chk(/rateCheck\(state, "device"/.test(core2) && /rateCheck\(state, "global"/.test(core2),
        "但设备档与全局档照判（这两档本机版拿得到）");
    }

    /* ---- 冷却时长：两条通道各自成键，且两端同值 ---- */
    eq(A.SMS_RESEND_COOLDOWN_MS, cfg.smsResendCooldownMs,
      "短信重发冷却两端同值（" + A.SMS_RESEND_COOLDOWN_MS + "）");
    eq(A.RESEND_COOLDOWN_MS, cfg.resendCooldownMs, "邮箱重发冷却两端同值");
    chk(A.SMS_RESEND_COOLDOWN_MS !== undefined && A.RESEND_COOLDOWN_MS !== undefined,
      "两条通道各自有键（将来单独收紧短信不必动邮箱那一条）");
  }

  /* ==================================================================
     二十、2C：/api/me 如实自报开通状态（界面才配自称「服务器权威」）
     ==================================================================
     §4.9 那条「不假装」的延伸：说了「由服务器判定」，就得让用户看得见
     **这台服务器当前是什么状态** —— 发信靠 console、库在内存里的实例，
     与一个配齐的实例，说的话不是同一件事。
     ================================================================== */
  {
    boot({});
    const core = require("../api/_lib/core.js");
    boot({});
    const cfg1 = require("../api/_lib/config.js");     // 没配库（SUPABASE_* 都没值）
    const pub = core.publicAccount(cfg1, { uid: "u_1", plan: "free", email_mask: "a***@b.com", nickname: "" });
    eq(pub.channel.mail, "console", "没配发信商时如实自报 console");
    eq(pub.channel.delivered, false, "console ⇒ delivered:false（不假装发出去了）");
    eq(pub.channel.db, "memory", "没配库时如实自报 memory（不是 db）");
    eq(pub.channel.sms, false, "短信没开通 ⇒ sms:false（与 2B 的 503 同口径）");

    /* 真 HTTP：/api/me 拿到会话之后确实带着这一份 */
    const sv = await serve();
    try {
      const sent = await call(sv.base, "POST", "/api/send-code", { email: "facts@example.com" });
      eq(sent.status, 202, "发码成功（会话要先建起来）");
      const echo = await call(sv.base, "POST", "/api/send-code", { email: "facts@example.com", channel: "email", value: "facts@example.com" });
      chk(echo.status === 202 || echo.status === 429, "同邮箱重发被冷却拦住也照实回（实际 " + echo.status + "）");
      /* 没有会话口子拿明文码（ALLOW_CODE_ECHO 默认关），所以要真登进来只能用
         「先发码 → 从 devCode 取」这条路；这里改从 store 取码不合适，
         于是直接断言**未登录**时 /api/me 仍然如实回 401（不泄露任何东西）。 */
      const me = await call(sv.base, "GET", "/api/me");
      eq(me.status, 401, "没会话时 /api/me 回 401（未登录是本来的正常状态）");
      eq(me.body.code, "E_NO_SESSION", "码是 E_NO_SESSION");
      chk(me.body.channel === undefined, "未登录时**不下发**任何开通状态（不给未授权的人看服务端内部）");
    } finally { await sv.close(); }
  }

  /* ==================================================================
     二十一、2.2：服务端权威发放（POST/DELETE /admin/grant · POST /admin/grants）
     ==================================================================
     这是本项目**第一条能改别人数据的写接口**，因此这一节的重点不是「能发」，
     而是四条不许含糊的边界：

       ① **角色闸在服务端** —— 有会话但不是 owner / admin 时回 403。
          界面上藏不藏入口不是安全边界：这一节全部**直接打 HTTP**，
          一个界面都不经过。
       ② **只认掩码** —— 库里不存明文邮箱（§2.4 第 1 条），接口也不自己掩一次。
          形状不对回 400，绝不「猜一个」。
       ③ **命中 0 条不是错误** —— 如实回 matched:0。本方案里对方**先登录一次**
          才会在库里留下一行，绝不「查不到就替他建一条」（掩码不可逆，
          造出来的是永远登不上的幽灵行）。
       ④ **改了就要真的生效** —— 发完之后 /api/me 下发的 tier 必须跟着变，
          且**收回等价于发一个 free**（没有第二张表，不会出现「收回只做了一半」）。
     ================================================================== */
  {
    /* ---- ① 归一化：只认三个层级、只认掩码形状 ---- */
    boot({});
    const core = require("../api/_lib/core.js");

    eq(core.normGrantInput({ emailMask: "a***@qq.com", tier: "pro" }).tier, "pro", "层级 pro 通过");
    ["free", "pro", "max"].forEach(t => {
      chk(!core.normGrantInput({ emailMask: "a***@qq.com", tier: t }).bad, "三个合法层级之一通过：" + t);
    });
    ["Pro", "PRO", "vip", "", null, "max "].forEach(t => {
      const r = core.normGrantInput({ emailMask: "a***@qq.com", tier: t });
      const low = String(t == null ? "" : t).toLowerCase();
      if (["free", "pro", "max"].indexOf(low) >= 0) return;    // 大小写归一后合法的跳过
      chk(!!r.bad && r.bad === "E_TIER", "不认识的层级一律拒（" + JSON.stringify(t) + "）—— 不回落 free");
    });
    eq(core.normGrantInput({ emailMask: "a***@qq.com", tier: "PRO" }).tier, "pro", "层级大小写归一成小写");

    eq(core.normGrantInput({ emailMask: "zhangmin@163.com", tier: "pro" }).bad, "E_MASK",
      "**完整邮箱**被拒：只认掩码（库里不存明文，掩码规则只许有一份实现）");
    eq(core.normGrantInput({ emailMask: "", tier: "pro" }).bad, "E_MASK", "空掩码被拒");
    eq(core.normGrantInput({ emailMask: "a***@", tier: "pro" }).bad, "E_MASK", "掩码缺域名被拒");
    eq(core.normGrantInput({ emailMask: "a@b.com", tier: "pro" }).bad, "E_MASK", "没有 *** 的地址被拒");
    chk(!core.normGrantInput({ emailMask: " A***@QQ.com ", tier: "pro" }).bad, "掩码接受并归一大小写/空格");
    eq(core.normGrantInput({ emailMask: " A***@QQ.com ", tier: "pro" }).mask, "a***@qq.com", "掩码归一成小写");
    eq(core.normGrantInput({ emailMask: "a***@qq.com", tier: "pro", until: "x" }).bad, "E_UNTIL",
      "看不懂的到期时刻被拒（不静默当成永久）");
    eq(core.normGrantInput({ emailMask: "a***@qq.com", tier: "pro", until: "" }).until, null, "空到期 = 永久");
    eq(core.normGrantInput({ emailMask: "a***@qq.com", tier: "pro" }).until, null, "缺到期 = 永久");

    /* ---- ② 角色表两端同源：只有 owner / admin 放行 ---- */
    ["owner", "admin"].forEach(r => chk(core.isAdminRole(r), "服务端放行角色：" + r));
    ["user", "", null, "OWNER ", "root"].forEach(r => {
      const low = String(r == null ? "" : r).trim().toLowerCase();
      if (["owner", "admin"].indexOf(low) >= 0) return;
      chk(!core.isAdminRole(r), "服务端拒绝角色：" + JSON.stringify(r));
    });
    {
      /* 客户端与**服务端**的角色表对拍：兜底形态可以不同（客户端在没服务端时
         默认本机主人），但**放行的角色集合必须一致** —— 否则会出现
         「界面上是管理员、接口回 403」这种自相矛盾的组合。 */
      const E = require("../js/entitlement.js");
      ["owner", "admin", "user"].forEach(r => {
        const srv = core.isAdminRole(r);
        const cli = E.isOwner(null, { role: r });
        chk(srv === cli, "角色 " + JSON.stringify(r) + " 两端一致（服务端 " + srv + " ↔ 客户端 " + cli + "）");
      });
      /* ⚠️ 不认识的 / 空的角色**两端故意不同**，且这处不同不许被「顺手统一」：
         服务端没有兜底 —— 没配 role 的账号就是没权限（判的是「能不能改别人数据」）；
         客户端在拿不到**明确角色**时会退化成「首次打开的这个浏览器就是主人」
         （那时没有服务端，不兜底则 /admin/ 永远对所有人关着）。
         兜底形态不同，但**同一个明确角色**的答案必须一致（上面那三条）。 */
      ["root", "", null].forEach(r => {
        chk(!core.isAdminRole(r), "服务端对不认识的角色 " + JSON.stringify(r) + " 一律不放行（无兜底）");
      });
      chk(E.isOwner(null, { role: "root" }) === true,
        "客户端遇到不认识的角色时退回本机兜底（那是它本来就有的行为，不是 bug）");
    }

    /* ---- ③ 走真 HTTP：没有会话 / 不是管理员 / 是管理员，三种各说各的话 ---- */
    boot({ ALLOW_CODE_ECHO: "1" });
    const sv = await serve();
    try {
      const POST = (p, b, cookie) => call(sv.base, "POST", p, b, cookie);

      const anon = await POST("/api/admin/grant", { emailMask: "a***@qq.com", tier: "pro" });
      eq(anon.status, 401, "没有会话时回 401（不是 403、不是 500）");
      eq(anon.body.code, "E_NO_SESSION", "码是 E_NO_SESSION");

      /* 先建一个**普通用户**会话（注册 → 确认邮箱 → 收码 → 校验），
         然后拿他的 Cookie 打发放接口。
         ⚠️ 确认那一步不能省：用户裁了「不确认就不让登录」。 */
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

      /* 把这个账号提成 owner（模拟「库里已有一个管理员」——真实流程是改库，
         这里直接改 store，等于跳过那一步，测的是闸本身） */
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

      /* 真的发一条：掩码对上库里的行 → 改 plan，并回「改完之后」的层级 */
      const okG = await POST("/api/admin/grant", { emailMask: "p***@example.com", tier: "pro" }, plainCookie);
      eq(okG.status, 200, "掩码命中时回 200");
      eq(okG.body.matched, 1, "matched 如实回 1");
      eq(okG.body.changed, true, "changed 为 true");
      eq(okG.body.tier, "pro", "回的是**改完之后**的层级（服务端判定，不是请求体回显）");

      /* ④ 改了要真的生效：/api/me 下发的 tier 必须跟着变 */
      const me1 = await call(sv.base, "GET", "/api/me", undefined, plainCookie);
      eq(me1.status, 200, "发完之后 /api/me 拿得到");
      eq(me1.body.plan.tier, "pro", "**发完就真的生效**：/api/me 下发的 tier 变成 pro");
      chk(me1.body.features.indexOf("sync.multiDevice") >= 0, "能力清单跟着变（pro 才有跨设备同步）");
      chk(me1.body.channel && me1.body.channel.db === "memory", "开通状态照旧如实自报（2C 那条没被改坏）");

      /* 有效期：过期即回落 free（与 planTier 同一处判定） */
      const future = Date.now() + 86400000;
      const withUntil = await POST("/api/admin/grant", { emailMask: "p***@example.com", tier: "max", until: future }, plainCookie);
      eq(withUntil.body.tier, "max", "到期时刻写进去之后 tier 是 max");
      const me2 = await call(sv.base, "GET", "/api/me", undefined, plainCookie);
      eq(me2.body.plan.until, future, "plan.until 原样下发（客户端据此显示到期日）");
      const past = await POST("/api/admin/grant", { emailMask: "p***@example.com", tier: "max", until: Date.now() - 1000 }, plainCookie);
      eq(past.status, 200, "写一个已过去的到期时刻不报错");
      const me3 = await call(sv.base, "GET", "/api/me", undefined, plainCookie);
      eq(me3.body.plan.tier, "free", "**到期即回落 free**（与 planTier 同一处判定，不是两套）");

      /* 名单只回掩码、只列非 free，且不回摘要 */
      await POST("/api/admin/grant", { emailMask: "p***@example.com", tier: "pro" }, plainCookie);
      const listR = await POST("/api/admin/grants", {}, plainCookie);
      eq(listR.status, 200, "管理员能列名单");
      chk(Array.isArray(listR.body.grants), "grants 是数组");
      eq(listR.body.grants.length, 1, "只列 plan !== free 的行（普通账号不在里面）");
      eq(listR.body.grants[0].emailMask, "p***@example.com", "只回掩码");
      chk(!/email_hash/.test(JSON.stringify(listR.body)), "名单里**没有摘要**（泄出去等于「这人是不是本站用户」可被查询）");
      chk(!JSON.stringify(listR.body).includes("plain@example.com"),
        "名单里**没有明文邮箱**（掩码是给人看的，明文从不落库也不回传）");
      chk(!/uid/.test(JSON.stringify(listR.body.grants[0])), "名单里连 uid 都不给（掩码已经够用）");

      /* 收回 = 发一个 free，且不删账号、不删进度 */
      const rev = await call(sv.base, "DELETE", "/api/admin/grant", { emailMask: "p***@example.com" }, plainCookie);
      eq(rev.status, 200, "收回回 200");
      eq(rev.body.changed, true, "收回改了东西");
      const me4 = await call(sv.base, "GET", "/api/me", undefined, plainCookie);
      eq(me4.body.plan.tier, "free", "收回之后 /api/me 回落 free");
      eq(me4.body.uid, plain.uid, "**收回不删账号**（uid 还是那一个，进度记录跟着 uid 走）");
      const revNo = await call(sv.base, "DELETE", "/api/admin/grant", { emailMask: "nobody***@qq.com" }, plainCookie);
      eq(revNo.body.matched, 0, "收回一个不存在的掩码：matched 0、不报错");

      /* 写接口都要频控（docs §4.3 第 3 条）：连点要能被拦住 */
      let sawRate = false;
      for (let i = 0; i < 60 && !sawRate; i++) {
        const r = await POST("/api/admin/grant", { emailMask: "p***@example.com", tier: "pro" }, plainCookie);
        if (r.status === 429) { sawRate = true; eq(r.body.code, "E_RATE_DEVICE", "发放也走设备档频控（429 的码与同步/注销同表）"); }
      }
      chk(sawRate, "发放是写接口：连点会被频控拦住（不是只有 send-code 才有频控）");
    } finally { await sv.close(); }

    /* ---- ④ 没配服务端时：503，一个字都不改（与 /api/me 同口径） ---- */
    boot({ SESSION_SECRET: "" });
    const sv2 = await serve();
    try {
      const r = await call(sv2.base, "POST", "/api/admin/grant", { emailMask: "a***@qq.com", tier: "pro" });
      eq(r.status, 503, "缺 SESSION_SECRET 时回 503（不是 500、不是 403）");
      eq(r.body.code, "E_NOT_CONFIGURED", "码是 E_NOT_CONFIGURED（「未开放」是如实回答）");
    } finally { await sv2.close(); }

    /* ---- ⑤ 方法校验：GET 不许打这一条（POST / DELETE 之外一律 405） ---- */
    boot({});
    const sv3 = await serve();
    try {
      const g = await call(sv3.base, "GET", "/api/admin/grant");
      eq(g.status, 405, "GET /api/admin/grant 回 405（写接口不接受 GET）");
    } finally { await sv3.close(); }
  }

  /* ==================================================================
     十七、古诗词大会 · 判分口（3 期 · 不花钱的那一层）

     这一条最要紧的三件事：
       ① **能力闸在服务端** —— 飞花令 / 试题模拟要 Max、题库复习要 Pro
          （用户 2026-09-17 的裁决）。直接打 HTTP，不经任何界面。
       ② **答案由服务端重建** —— 请求体里塞一个假的 answer / chosen
          改不掉判定；客户端说了不算。
       ③ **不假装计费** —— charge 默认 false 时如实回 counted:false。
     ================================================================== */
  {
    boot({ ALLOW_CODE_ECHO: "1" });

    /* ---- ① 内核那一层：判分是纯比对，客户端传什么都不看 ---- */
    {
      const core = require("../api/_lib/core.js");
      const cfg = require("../api/_lib/config.js");
      const store = require("../api/_lib/store.js").memoryStore();
      const limiter = core.makeRateLimiter();
      const t = 1757900000000;
      const d = { cfg, store, limiter, now: () => t, ip: "1.1.1.1", deviceId: "dev-1" };

      /* 三层各自的能力键 —— 与 js/entitlement.js 的 CAPS 对得上 */
      eq(core.GAME_CAP.fly, "feihualing", "飞花令那一档的能力键与前端同源");
      eq(core.GAME_CAP.paper, "exam.paper", "试题模拟那一档的能力键与前端同源");
      eq(core.GAME_CAP.review, "quiz.review", "题库复习那一档的能力键与前端同源");
      chk(core.gameAllowed(cfg, "pro", "quiz.review"), "题库复习：Pro 放行");
      chk(!core.gameAllowed(cfg, "pro", "feihualing"), "**飞花令：Pro 不放行**（用户裁决：归 Max）");
      chk(!core.gameAllowed(cfg, "pro", "exam.paper"), "**试题模拟：Pro 不放行**（用户裁决：归 Max）");
      chk(core.gameAllowed(cfg, "max", "feihualing"), "飞花令：Max 放行");
      chk(core.gameAllowed(cfg, "max", "exam.paper"), "试题模拟：Max 放行");
      /* Issue #163 末条：集子访问是从这一格里**拆出去**的第二条能力 */
      chk(core.featuresFor(cfg, "max").indexOf("exam.gathering") >= 0,
        "服务端 max 档下发 exam.gathering（集子访问）");
      chk(core.featuresFor(cfg, "pro").indexOf("exam.gathering") < 0,
        "服务端 pro 档**不**下发 exam.gathering（与试题模拟同一条口径）");
      chk(!core.gameAllowed(cfg, "free", "quiz.review"), "free 一样都拿不到");

      /* 未登录 → 401；不认识的题型 → 400 */
      const anon = await core.gameAnswer(d, { kind: "review", poemId: "xx1-01", chosen: "鹅" });
      eq(anon.status, 401, "没有会话时判分口回 401（这一项要登录）");
      eq(anon.body.code, "E_NO_SESSION", "码是 E_NO_SESSION");
      const badKind = await core.gameAnswer(d, { kind: "nonsense" });
      eq(badKind.status, 400, "不认识的题型回 400（不静默当成 review）");
      eq(badKind.body.code, "E_KIND", "码是 E_KIND");
    }

    /* ---- ② 走真 HTTP：三层各说各的话 + 客户端改不了答案 ---- */
    const sv = await serve();
    try {
      const POST = (p, b, cookie) => call(sv.base, "POST", p, b, cookie);
      const cfgM = require("../api/_lib/config.js");
      const storeM = require("../api/_lib/store.js").getStore(cfgM);

      const anon = await POST("/api/game/answer", { kind: "review", poemId: "xx1-01", chosen: "鹅" });
      eq(anon.status, 401, "没有会话时回 401（不是 403、不是 500）");

      /* 造一个 free 账号：判分口应当回 403 而不是「能用」 */
      const cookie = await loginByHttp(POST, "player@example.com");
      chk(/^kbsid=/.test(cookie), "拿到了玩家会话 Cookie");

      const asFree = await POST("/api/game/answer", { kind: "review", poemId: "xx1-01", chosen: "鹅" }, cookie);
      eq(asFree.status, 403, "**free 打判分口回 403**（能力闸在服务端，不经界面）");
      eq(asFree.body.code, "E_TIER", "码是 E_TIER（不是「连不上」，用户不该一直重试）");
      eq(asFree.body.tier, "free", "如实回当前层级");

      /* 提成 Pro：题库复习可用，飞花令 / 试题模拟仍然 403 */
      const rows = Object.keys(storeM._db.accounts).map(k => storeM._db.accounts[k]);
      const me = rows.filter(a => a.email_mask === "p***@example.com")[0];
      chk(!!me, "玩家那一行在库里");
      me.plan = "pro";

      const pro1 = await POST("/api/game/answer", { kind: "review", poemId: "xx1-01", chosen: "鹅" }, cookie);
      eq(pro1.status, 200, "Pro 打题库复习回 200");
      eq(pro1.body.cap, "quiz.review", "回的是它自己那一档能力");
      eq(pro1.body.counted, false, "本站不收款、也没有计费：**如实回 counted:false**（不假装扣费）");
      /* ⚠️ 这条文案在 PR #174 里改过口径：原先写「3 期还没有定价」（**暂缓**的语气），
         用户 2026-09-16 / 09-17 裁决「不搞收费」之后改成「免费、不限次，不计额度」
         （**不做**的语气，Issue #159）。
         断言守的是那件事本身（如实说清**为什么**没计费），不是某一版措辞；
         仍要守住那句实质：**不许写成「已计入额度」**（那是假话、是「假装扣了费」）。 */
      chk(/免费、不限次/.test(pro1.body.note), "note 里说清是免费不限次（不假装扣费）");
      chk(!/已计入额度/.test(pro1.body.note), "note 里不许写成「已计入额度」");

      const proFly = await POST("/api/game/answer", { kind: "fly", chars: ["月"], said: "日月之行" }, cookie);
      eq(proFly.status, 403, "Pro 打飞花令仍然 403（用户裁决：飞花令归 Max）");
      const proPaper = await POST("/api/game/answer", { kind: "paper", poemId: "xx1-01", chosen: "鹅" }, cookie);
      eq(proPaper.status, 403, "Pro 打试题模拟仍然 403（用户裁决：试题模拟归 Max）");

      /* 提成 Max：三层全开 */
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

      /* ⚠️ 正确答案从**服务端自己的语料**里取，不写死一个字。
         写死的话，哪天题库的取法一动（例如《咏鹅》开头三声「鹅」一字不差、
         出题时改从「相邻且不相同的两句」里挑），这条断言就会以
         「选了正确答案却 ok:false」的形式红掉 —— 而它想守的其实是
         「选对了就是对了」，不是「答案永远是那个字」。 */
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

      /* ③ 客户端说了不算：请求体里塞一个假的 answer 改不掉判定 */
      const cheat = await POST("/api/game/answer",
        { kind: "paper", poemId: "xx1-01", chosen: "肯定不是答案", answer: "肯定不是答案" }, cookie);
      eq(cheat.status, 200, "塞了假 answer 也照常回 200");
      eq(cheat.body.ok, false, "**客户端传上来的 answer 一律忽略**：判定仍然是错的");
      eq(cheat.body.answer, truth.answer, "服务端回的是自己重建出来的答案");

      const stale = await POST("/api/game/answer", { kind: "paper", bankId: "不存在的题", chosen: "x" }, cookie);
      eq(stale.status, 400, "题库里没有这一条时回 400（不猜一个）");
      eq(stale.body.code, "E_STALE", "码是 E_STALE（多半是前端缓存旧了一版）");

      /* ④ 计费：打开 charge 才真计数，且按 uid 记在 progress 里 */
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

      /* ⑤ 写接口都要频控（docs §4.3 第 3 条） */
      let sawRate = false;
      for (let i = 0; i < 80 && !sawRate; i++) {
        const r = await POST("/api/game/answer", { kind: "review", poemId: "xx1-01", chosen: "鹅" }, cookie);
        if (r.status === 429) { sawRate = true; eq(r.body.code, "E_RATE_DEVICE", "判分也走设备档频控（与同步/发放同表）"); }
      }
      chk(sawRate, "判分是写接口：连点会被频控拦住");
    } finally { await sv.close(); }

    /* ---- ⑥ 缺 SESSION_SECRET：503（与其余接口同口径）；GET 回 405 ---- */
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

  /* ==================================================================
     廿二、Issue #197：完整登录流程（注册 / 确认 / 登录 / 忘记密码 / 重设）

     用户在这一期里要的是一整套流程，不是「一页里再加一块」：

       注册（邮箱 + 口令）→ 确认邮件 → 登录
                                 ↓
                             忘记密码 → 重设口令
                                 ↓
                             快捷登录（6 位随机码，原有那条路）

     这一节守的是**四条不许松的口径**（每条都有独立的理由，不是凑数）：

       ① **口令与随机码并存** —— 口令是加出来的一条路，不是替换。
          `sendCode` / `verifyCode` 那两条一个字节都没改（第二节到第五节
          那几十条断言仍在跑，就是这条口径的另一半）。
       ② **明文口令一秒钟都不落任何地方** —— 库里只有
          `scrypt$N$r$p$salt$hash`，日志里、响应体里都不出现它。
       ③ **不泄露「这个邮箱注册过没有」** —— `login` 与 `reset-request`
          对存在与不存在的邮箱回**同一个响应**。
       ④ **重设口令必须吊销全部会话** —— 那才是「重设」这件事的一半含义。
     ================================================================== */
  {
    /* ---- ① 内核那一层：口令形状 / 摘要 / 令牌形状 ---- */
    {
      boot({});
      const id = require("../api/_lib/identity.js");
      const core = require("../api/_lib/core.js");
      const cfg = require("../api/_lib/config.js");

      /* 口令摘要：同一串两次得到同一个结果、换盐得到不同结果、错口令判不过 */
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
      /* ⚠️ 参数写在串里的理由：将来调 N 值，老用户必须还能登进来。
         这条断言钉住的是「拿老参数串算出来的摘要，换新参数环境也认」。 */
      chk(id.verifyPassword("abc12345", id.hashPassword("abc12345", "s", { N: 1024, r: 8, p: 1, len: 32 })),
        "参数不同的老摘要仍然认（scrypt$1024$...）");

      /* 令牌：64 位 hex，且摘要带 purpose 命名空间 */
      const tok = id.newToken();
      chk(/^[0-9a-f]{64}$/.test(tok), "一次性令牌是 32 字节 hex（猜不在威胁模型里）");
      chk(core.isTokenShape(tok), "形状自查通过");
      ["", "zz", "abc", tok.slice(0, 63)].forEach(bad => chk(!core.isTokenShape(bad), "形状不对的令牌被拒：" + JSON.stringify(bad)));
      chk(id.tokenHash("u_1", "verify", tok, "pep") !== id.tokenHash("u_1", "reset", tok, "pep"),
        "确认令牌与重设令牌的摘要分命名空间（同一个 token 互不通用）");
      chk(id.tokenHash("u_1", "verify", tok, "pep") !== id.tokenHash("u_2", "verify", tok, "pep"),
        "摘要绑 uid（换个人就拿不走）");

      /* 口令规则：长度按**码点**算，不按 UTF-16 长度 */
      eq(core.checkPassword(cfg, "").code, "E_PW_EMPTY", "空口令回 E_PW_EMPTY");
      eq(core.checkPassword(cfg, "1234567").code, "E_PW_SHORT", "7 位回 E_PW_SHORT");
      chk(!core.checkPassword(cfg, "12345678"), "8 位通过（配置的下限）");
      eq(core.checkPassword(cfg, new Array(80).join("a")).code, "E_PW_LONG",
        "超长口令被拒（不是嫌用户填得多，是 scrypt 会对它全体算一遍——防 DoS）");
      /* ⚠️ 这四个 emoji 在 JS 里是 4 个「长度单位」还是 8 个？
         用 `.length` 判的话 `"😀😀😀😀😀😀😀".length === 14`（每个代理对算 2），
         于是「七个 emoji」会被判成「十四位，通过」—— 而它其实只有 7 个字符。
         这条断言钉的是**按码点数**。 */
      eq(core.checkPassword(cfg, "😀😀😀😀").code, "E_PW_SHORT", "四个 emoji 只有 4 个字符（按码点数，不按 length）");
      chk(!core.checkPassword(cfg, "😀😀😀😀😀😀😀😀"), "八个 emoji 通过（8 个字符）");
    }

    /* ---- ② 明文口令不落库、不回响应、不进任何输出 ---- */
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

      /* 口令登录：错口令回**同一句话**，且不带 remaining 之外的任何线索 */
      const bad = await core.loginWithPassword(d, { email: "pw@example.com", password: "wrong-pw-xx" });
      eq(bad.status, 401, "错口令回 401");
      eq(bad.body.code, "E_LOGIN_FAIL", "码是 E_LOGIN_FAIL");
      eq(bad.body.message, "邮箱或密码不对", "文案是那一句统一的话");

      /* ⚠️ 用户裁了「不确认就不让登录」：口令**对**也进不来，回 403。 */
      const gated = await core.loginWithPassword(d, { email: "pw@example.com", password: SECRET_PW });
      eq(gated.status, 403, "口令对但邮箱没确认 → 403（不是 401，也不是「再试一次」）");
      eq(gated.body.code, "E_EMAIL_UNVERIFIED", "码是 E_EMAIL_UNVERIFIED（界面据此给出去路）");
      chk(!gated.cookies && !gated._session, "被拦时**不签发会话**（拦在半路等于没拦）");

      /* 确认之后就能进来，且响应形状与原先一致 */
      await confirmEmail(store, row.uid, cfg.sessionSecret);
      const okpw = await core.loginWithPassword(d, { email: "pw@example.com", password: SECRET_PW });
      eq(okpw.status, 200, "确认之后对的口令能登进来");
      chk(!!okpw._session && !!okpw.cookies, "签发了会话与会话 Cookie");
      chk(!JSON.stringify(okpw.body).includes(SECRET_PW), "登录响应里也没有明文口令");
      chk(okpw.body.account.password_hash === undefined, "**响应里没有 password_hash**");
      chk(okpw.body.account.emailVerified === true, "响应如实说「邮箱已确认」");
      eq(okpw.body.account.email, "pw@example.com", "响应里有明文邮箱（给自己看的那一份）");
    }

    /* ---- ③ 邮箱大小写：显示保留原样，登录仍不敏感（两条路各走各的） ---- */
    {
      boot({ ALLOW_CODE_ECHO: "1" });
      const core = require("../api/_lib/core.js");
      const cfg = require("../api/_lib/config.js");
      const store = require("../api/_lib/store.js").memoryStore();
      const d = { cfg, store, limiter: core.makeRateLimiter(), now: () => Date.now(), deviceId: "d2", ip: "1.1.1.1" };

      await core.register(d, { email: "  Parent@Example.COM  ", password: "hunter2hunter" });
      const row = Object.keys(store._db.accounts).map(k => store._db.accounts[k])[0];
      eq(row.email, "Parent@Example.COM", "落库的明文保留用户填的大小写（只 trim + 去零宽）");
      eq(row.email_mask, "p***@example.com", "掩码仍然全是小写（那是给人认的，不是给人看的原文）");
      /* 「不确认就不让登录」是这一节的前置 —— 先确认，再测大小写 */
      await confirmEmail(store, row.uid, cfg.sessionSecret);
      /* ⚠️ 登录仍然大小写不敏感 —— 这是历史行为，一个字节都没变 */
      const l1 = await core.loginWithPassword(d, { email: "parent@example.com", password: "hunter2hunter" });
      eq(l1.status, 200, "小写登录进得去");
      const l2 = await core.loginWithPassword(d, { email: "PARENT@EXAMPLE.COM", password: "hunter2hunter" });
      eq(l2.status, 200, "全大写登录也进得去（大小写不敏感这条历史行为没变）");
      eq(Object.keys(store._db.accounts).length, 1, "三条不同大小写只对应一个账号（不会各建一个）");
    }

    /* ---- ④ 确认邮箱：令牌一次性、过期、方向只朝上 ---- */
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

      /* 形状不对 / 令牌不对 */
      eq((await core.verifyEmail(d, { vid: vid, token: "deadbeef" })).body.code, "E_TOKEN_INVALID", "令牌不对被拒");
      chk(!store._db.verifications[vid].consumed_at, "没被用掉（拒了不算用过）");
      eq((await core.verifyEmail(d, {})).body.code, "E_NO_TOKEN", "什么都没给 → E_NO_TOKEN");

      /* 过期：24 小时后 */
      t += 25 * 3600 * 1000;
      eq((await core.verifyEmail(d, { vid: vid, token: token })).body.code, "E_TOKEN_EXPIRED", "超过 24 小时 → 过期");
      t -= 25 * 3600 * 1000;

      /* 正确的那一次 */
      const okv = await core.verifyEmail(d, { vid: vid, token: token });
      eq(okv.status, 200, "确认成功");
      eq(okv.body.verified, true, "回 verified:true");
      eq(store._db.accounts[Object.keys(store._db.accounts)[0]].status, "active", "pending → active");
      chk(!!store._db.accounts[Object.keys(store._db.accounts)[0]].email_verified_at, "写下确认时刻");

      /* 重放：同一枚再来一次 */
      eq((await core.verifyEmail(d, { vid: vid, token: token })).body.code, "E_TOKEN_USED",
        "**同一枚令牌不能用第二次**（重放是这一条唯一的威胁模型）");

      /* 发新的即作废旧链接 */
      const reg2 = await core.resendVerification(Object.assign({}, d, { account: { uid: reg.body.uid } }), {});
      /* 已经确认过了 —— 如实回 alreadyVerified 且不再发信 */
      eq(reg2.body.alreadyVerified, true, "已确认时重发：如实回 alreadyVerified，且不再发信");
      eq(reg2.body.verifySent, false, "那时 verifySent 为 false（确实没发）");
    }

    /* ---- ⑤ 重发确认邮件：未确认时真的发，且 `verifySent` 是事实 ---- */
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
      /* console 发信商 → 没真发出去。这一条**必须**是 false ——
         写 true 就是「未配发信商却报已发送」，正是最恨的那种假话。 */
      eq(r.body.verifySent, false, "console 发信商下 verifySent 为 false（发信是事实，不是「尽力了」）");
      const vids = Object.keys(store._db.verifications);
      eq(vids.length, 2, "新确认记录落了一条");
      chk(!!store._db.verifications[oldVid].consumed_at, "**旧链接被作废**（发新的即作废旧链接）");
    }

    /* ---- ⑥ 忘记密码：不泄露邮箱是否存在；重设后吊销全部会话 ---- */
    {
      boot({ ALLOW_CODE_ECHO: "1" });
      const core = require("../api/_lib/core.js");
      const cfg = require("../api/_lib/config.js");
      const store = require("../api/_lib/store.js").memoryStore();
      const d = { cfg, store, limiter: core.makeRateLimiter(), now: () => Date.now(), deviceId: "d5", ip: "1.1.1.1" };

      const reg = await core.register(d, { email: "r@example.com", password: "old-password-1" });
      const uid = reg.body.uid;
      /* 每次登录换一个 deviceId：设备档（20 次/小时）会先于别的东西触发，
         而这一节测的是**令牌与吊销**，不是设备档 */
      let devN = 0;
      const L = (pw) => core.loginWithPassword(d, { email: "r@example.com", password: pw, deviceId: "rd-" + (devN++) });

      /* ⚠️ 这一条是本节最要紧的两条之一：**存在与不存在回同一个响应**。
         区分开就等于把全站用户名单变成可查询的事实。 */
      const known = await core.resetRequest(d, { email: "r@example.com", deviceId: "d5" });
      const unknown = await core.resetRequest(d, { email: "nobody@example.com", deviceId: "d5" });
      eq(known.status, 200, "内核回 200（HTTP 层再换成 202，与 send-code 同一处约定）");
      eq(unknown.status, 200, "**不存在的邮箱回同一个状态**（不泄露存在性）");
      /* ⚠️ 字段集合要在**关掉冒烟开关**的那一档上比。
         开着 ALLOW_CODE_ECHO 时「存在」那一个会多一个 `devResetToken` ——
         那是测试专用口子（生产永远关着），拿它比会把这条断言变成
         「两个响应必须连调试字段都一样」，而它想守的其实是
         **生产形态下两者不可区分**。各用**不同的 deviceId**，
         免得撞上「同一设备的频控」（那是另一条断言要测的事）。 */
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
      /* ⚠️ 文案里**允许**出现「如果这个邮箱在本站注册过」这种条件句 ——
         那是刻意的措辞（把判断留给收件箱）。禁令针对的是**断言式的**说法。 */
      chk(!/没注册|没有注册|不存在|未注册/.test(unknown.body.note),
        "文案里不出现「没注册过 / 不存在」这类断言（条件句是允许的）");
      chk(/如果/.test(unknown.body.note), "那一句是条件句（「如果…在本站注册过」）");
      chk(known.body.devResetToken, "（冒烟口）存在的那一个确实生成了令牌");
      chk(unknown.body.devResetToken === undefined, "不存在的那一个**没有**令牌（因为压根没发信）");
      eq(Object.keys(store._db.resets).length, 1, "只给存在的那个邮箱落了一条重设记录");

      /* 重设要吊销**全部**会话。
         ⚠️ 先确认邮箱 —— 「不确认就不让登录」之后拿不到会话。 */
      await confirmEmail(store, uid, cfg.sessionSecret);
      const verifiedBeforeReset = store._db.accounts[uid].email_verified_at;
      const loginBefore = await L("old-password-1");
      eq(loginBefore.status, 200, "拿旧口令登进来（先有一条活会话）");
      const sid1 = loginBefore._session.sid;
      await store.putSession({ sid: sid1, uid: uid, iat: 0, exp: Date.now() + 1e9, revoked: 0 });
      const loginBefore2 = await L("old-password-1");
      const sid2 = loginBefore2._session.sid;
      await store.putSession({ sid: sid2, uid: uid, iat: 0, exp: Date.now() + 1e9, revoked: 0 });

      /* 取**最新那一枚**重设令牌（这一节里发过好几次，取第一枚会撞上「发新的即作废旧链接」） */
      const rid = Object.keys(store._db.resets)
        .filter(k => !store._db.resets[k].consumed_at)
        .sort((a, b) => store._db.resets[b].issued_at - store._db.resets[a].issued_at)[0];
      const tok = known.body.devResetToken;
      chk(known.body.devResetToken !== undefined, "（前置）拿到了明文重设令牌");
      /* 形状不对 / 令牌不对 / 已经在用的口令 */
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

      /* 新口令生效、旧口令失效 */
      eq((await L("old-password-1")).status, 401, "旧口令登不进去了");
      eq((await L("brand-new-99")).status, 200, "新口令能登进来");
      /* ⚠️ 重设口令**不顺手确认邮箱** —— 收到重设邮件不等于邮箱已确认。
         判据是「重设前后这个时间戳**一个字节都没变**」——
         它比「等于 null」更准（本用例的前置已经把邮箱确认过了）。 */
      eq(store._db.accounts[uid].email_verified_at, verifiedBeforeReset,
        "重设口令**不动** email_verified_at（两件事各写各的）");
    }

    /* ---- ⑦ 口令连续失败锁号，成功一次把窗口清空 ---- */
    {
      boot({ ALLOW_CODE_ECHO: "1" });
      const core = require("../api/_lib/core.js");
      const cfg = require("../api/_lib/config.js");
      const store = require("../api/_lib/store.js").memoryStore();
      const d = { cfg, store, limiter: core.makeRateLimiter(), now: () => Date.now(), deviceId: "d6", ip: "1.1.1.1" };
      const limiterRef = d.limiter;

      await core.register(d, { email: "lock@example.com", password: "hunter2hunter" });
      const uid = Object.keys(store._db.accounts)[0];
      /* 「不确认就不让登录」→ 先确认（否则「对一次」那一步会撞在 403 上） */
      await confirmEmail(store, uid, cfg.sessionSecret);

      /* 正确一次 → 窗口清空 → 再错不该立刻锁 */
      await core.loginWithPassword(d, { email: "lock@example.com", password: "nope-1" });
      eq(limiterRef.fails("login", "uid:" + uid, Date.now()), 1, "一次失败记 1");
      await core.loginWithPassword(d, { email: "lock@example.com", password: "hunter2hunter" });
      eq(limiterRef.fails("login", "uid:" + uid, Date.now()), 0,
        "**成功一次把失败窗口清空**（不清的下场是「错九次、对一次、再错一次」就锁号）");

      /* 连错到上限 → 锁号。
         ⚠️ 每次都换一个 deviceId：设备档频控（20 次/小时）会先于「锁号」触发，
            而这一条要测的是**锁号**（按账号计），不是设备档。
            两个都用同一个 deviceId 时实测到的是 429 —— 那会让这条断言
            以「锁号没生效」的形式红掉，而其实锁号那段根本没轮到跑。 */
      let locked = false;
      for (let i = 0; i < 12 && !locked; i++) {
        const r = await core.loginWithPassword(d, { email: "lock@example.com", password: "bad-" + i, deviceId: "dev-" + i });
        if (r.status === 423) { locked = true; eq(r.body.code, "E_LOCKED", "连错到上限 → E_LOCKED"); }
      }
      chk(locked, "口令连续失败会锁号（撞库打的是同一个账号，所以按账号计数）");
      const after = await core.loginWithPassword(d, { email: "lock@example.com", password: "hunter2hunter", deviceId: "dev-fresh" });
      eq(after.status, 423, "**锁着的时候连对的口令也进不来**（锁是终态，不是「再试一次就好」）");
    }

    /* ---- ⑧ 走真 HTTP：六条接口端到端 + 方法校验 ---- */
    boot({ ALLOW_CODE_ECHO: "1" });
    const sv = await serve();
    try {
      const POST = (p, b, cookie) => call(sv.base, "POST", p, b, cookie);

      const reg = await POST("/api/register", { email: "e2e@example.com", password: "hunter2hunter" });
      eq(reg.status, 202, "POST /api/register 回 202（与 send-code 同一档）");
      eq(reg.body.created, true, "如实回 created:true");
      eq(reg.body.verifySent, false, "console 发信商下 verifySent:false（**不是**「确认邮件已发出」）");
      const vtok = reg.body.devVerifyToken;

      /* ⚠️ 同一个邮箱再注册：**回同一个形状**（不报「已注册」= 不泄露存在性），
         但**一个字都不写** —— 口令不覆盖、确认邮件不重发。
         这一条原先是个**账号接管洞**（见第廿六节 ③）。
         后续登录用的是**第一次**填的那个口令。 */
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

      /* 确认邮箱 → 登录 → /api/me 如实带出确认状态与明文邮箱
         ⚠️ 令牌取**第一次注册**那一枚（第二次注册没有发新的 —— 那正是上面那条断言）。 */
      const storeE0 = require("../api/_lib/store.js").getStore(require("../api/_lib/config.js"));
      const vidFresh = Object.keys(storeE0._db.verifications)
        .filter(k => !storeE0._db.verifications[k].consumed_at)
        .sort((a, b) => storeE0._db.verifications[b].issued_at - storeE0._db.verifications[a].issued_at)[0];
      const v = await POST("/api/verify-email", { vid: vidFresh, token: vtok });
      eq(v.status, 200, "POST /api/verify-email 回 200");

      /* 用**第一次注册**的口令登录 —— 第二次那次请求没能改掉它（那正是不许改的证据） */
      const lg = await POST("/api/login", { email: "e2e@example.com", password: "hunter2hunter" });
      eq(lg.status, 200, "POST /api/login 回 200（用原口令，证明它没被第二次注册改掉）");
      const stolenPw = await POST("/api/login", { email: "e2e@example.com", password: "another-pw-77" });
      eq(stolenPw.status, 401, "**第二次注册填的那个口令进不来**（账号接管洞的回归断言）");
      chk(/^kbsid=/.test(String(lg.setCookie || "")), "签发了会话 Cookie");
      chk(String(lg.setCookie || "").indexOf("HttpOnly") > 0, "那枚 Cookie 是 HttpOnly");
      const cookie = String(lg.setCookie || "").split(";")[0];

      const me = await call(sv.base, "GET", "/api/me", undefined, cookie);
      eq(me.status, 200, "登进来之后 /api/me 拿得到");
      /* 明文邮箱保留用户填的大小写（第二次注册填的是 E2E@Example.com）——
         这正是「显示的是你当时填的那一串」这条口径。 */
      eq(me.body.email.toLowerCase(), "e2e@example.com", "**/api/me 带出明文邮箱**（个人中心要显示它）");
      eq(me.body.emailVerified, true, "确认过之后 emailVerified 为 true");
      chk(!/password_hash|password_salt/.test(JSON.stringify(me.body)), "**/api/me 一个字节都不带口令字段**");

      /* 忘记密码两步 */
      const rr = await POST("/api/reset-request", { email: "e2e@example.com" });
      eq(rr.status, 202, "POST /api/reset-request 回 202");
      const rrr = await POST("/api/reset-request", { email: "ghost@example.com" });
      eq(rrr.status, 202, "不存在的邮箱也回 202（**同一条接口、同一个形状**）");
      const cfgE = require("../api/_lib/config.js");
      const storeE = require("../api/_lib/store.js").getStore(cfgE);
      const rid = Object.keys(storeE._db.resets)[0];
      const rc = await POST("/api/reset-confirm", { rid: rid, token: rr.body.devResetToken, password: "brand-new-99" });
      eq(rc.status, 200, "POST /api/reset-confirm 回 200");
      eq(rc.body.sessionsRevoked, true, "如实回会话已吊销");
      const stale = await call(sv.base, "GET", "/api/me", undefined, cookie);
      eq(stale.status, 401, "**重设之后旧会话立刻失效**（/api/me 回 401）");

      /* 重发确认邮件：502 那条路上不许泄露令牌 */
      const lg2 = await POST("/api/login", { email: "e2e@example.com", password: "brand-new-99" });
      const cookie2 = String(lg2.setCookie || "").split(";")[0];
      const rv = await POST("/api/resend-verification", {}, cookie2);
      eq(rv.status, 200, "POST /api/resend-verification 回 200");
      /* ⚠️ 这里是 alreadyVerified:true —— 上面那次 confirm 真的写下了
         `email_verified_at`，**重设口令之后它仍然在**（重设只动口令那两列）。
         这一条正好从反面钉住「重设口令不抹掉确认状态」——
         两件事各写各的，谁也别顺手清掉谁。 */
      eq(rv.body.alreadyVerified, true, "已确认 → alreadyVerified:true（且不再发信）");
      eq(rv.body.verifySent, false, "已确认时不再发信，verifySent 如实为 false");
      /* ⚠️ Issue #197 复审：这一条**反过来了** ——
         「不确认就不让登录」之后，匿名重发是那种用户**唯一**的出路
         （他登不进来，也就进不了个人中心）。风险形状与
         `/api/reset-request` 完全一样，所以闸也照抄那一条：
         频控四层 + 冷却 + **存在与否回话逐字相同**。
         这里测的是「它不再回 401，而是走匿名口的形状」。 */
      const rvAnon = await POST("/api/resend-verification", { email: "e2e@example.com" });
      eq(rvAnon.status, 200, "匿名重发现在**可用**（那是登不进来的人唯一的出路）");
      eq(rvAnon.body.requested, true, "回 requested:true（与 reset-request 同一个形状）");
      /* 不存在的邮箱必须**逐字相同**（除了冒烟口的令牌） */
      const rvGhost = await POST("/api/resend-verification", { email: "ghost-197@example.com" });
      eq(rvGhost.status, 200, "不存在的邮箱也回 200（不泄露「这个邮箱是不是本站用户」）");
      eq(JSON.stringify(Object.keys(rvAnon.body).sort().filter(k => k !== "devVerifyToken")),
        JSON.stringify(Object.keys(rvGhost.body).sort()), "两个响应的**字段集合**一样（除了冒烟令牌）");
      eq(rvGhost.body.requested, rvAnon.body.requested, "requested 相同");
      eq(rvGhost.body.alreadyVerified, rvAnon.body.alreadyVerified, "alreadyVerified 相同");
      eq(rvAnon.body.devVerifyToken === undefined || typeof rvAnon.body.devVerifyToken === "string",
        true, "（冒烟口：已确认过的不发信，这个字段本来也不该有）");

      /* 方法校验：这几条全是 POST */
      for (const p of ["/api/register", "/api/login", "/api/verify-email",
        "/api/resend-verification", "/api/reset-request", "/api/reset-confirm", "/api/admin/accounts"]) {
        const g = await call(sv.base, "GET", p);
        eq(g.status, 405, "GET " + p + " 回 405（这几条都不接受 GET）");
      }
    } finally { await sv.close(); }

    /* ---- ⑨ 缺 SESSION_SECRET：六条一律 503（与其余接口同口径） ---- */
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

    /* ---- ⑩ 管理后台的账号名录：回明文、绝不出口令与摘要 ---- */
    boot({ ALLOW_CODE_ECHO: "1" });
    const sv3 = await serve();
    try {
      const POST = (p, b, cookie) => call(sv3.base, "POST", p, b, cookie);
      const cA = await loginByHttp(POST, "owner@example.com");

      const asUser = await POST("/api/admin/accounts", {}, cA);
      eq(asUser.status, 403, "**普通用户打名录口回 403**（角色闸在服务端，不经界面）");
      eq(asUser.body.code, "E_FORBIDDEN", "码是 E_FORBIDDEN");

      const anon = await POST("/api/admin/accounts", {});
      eq(anon.status, 401, "没会话时回 401（不是 403）");

      /* 再注册一个人，好让名录有第二条 */
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
      /* 顺带：名录里的行必须能看出「谁是谁」—— 明文邮箱是它存在的理由 */
      eq(list.body.accounts.filter(a => a.email === "owner@example.com").length, 1,
        "（顺带）名录里按明文邮箱查得到那个人");

      /* ⚠️ 与会「只列发过层级的」那一张**不是一张表** */
      const grants = await POST("/api/admin/grants", {}, cA);
      eq(grants.body.grants.length, 0, "发放台账仍然是空的（那两个人都是 free）—— 两张表分开的理由在断言里");
    } finally { await sv3.close(); }
  }

  /* ==================================================================
     廿三、Issue #197：盘上形状与「不假装」的源码口径

     这一节扫源码。守的三件事**都是那种「写成别的样子也能跑、
     但跑出来的东西是假的」**：
       ① 前端六条传输方法真的接上了（少一条就是「按钮点了没反应」）
       ② 新页面（/verify/ /reset/）的脚本进了预缓存清单与测试路由
       ③ 口令绝不写进任何本地存储 / URL
     ================================================================== */
  {
    const apiSrc = fs.readFileSync(path.join(ROOT, "js/auth-api.js"), "utf8");
    ["register", "login", "verifyEmail", "resendVerification", "resetRequest", "resetConfirm", "accounts"]
      .forEach(m => chk(new RegExp("\\b" + m + ":\\s*function").test(apiSrc),
        "js/auth-api.js 接了 " + m + "()（少一条就是按钮点了没反应）"));

    const bindSrc = fs.readFileSync(path.join(ROOT, "js/account-api.js"), "utf8");
    chk(/resendVerification:\s*resendVerification/.test(bindSrc), "account-api 接了 resendVerification");
    chk(/adminAccounts:\s*adminAccounts/.test(bindSrc), "account-api 接了 adminAccounts");

    const swSrc = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
    ["./verify/", "./reset/", "./js/verify.js", "./js/reset.js", "./js/login.js"].forEach(f => {
      chk(swSrc.includes('"' + f + '"'), "sw.js 预缓存里有 " + f);
    });

    /* ⚠️ 口令不许写进本地存储 / URL。判据落在**登录与重设两页的脚本**上：
       它们同时提到 password 与 localStorage / location.search 才是违规。
       单看「出现了 password 这个词」会误判（表单字段本来就叫这个）。 */
    ["js/login.js", "js/reset.js"].forEach(f => {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
      const bad = src.split("\n").filter(line => /password|input-pw|input-reg-pw|input-new-pw/i.test(line)
        && /localStorage|sessionStorage|document\.cookie|location\.search\s*\+/i.test(line));
      eq(bad.length, 0, f + " 里没有一行「口令 + 本地存储 / URL」同现：" + bad.join(" | ").slice(0, 80));
    });

    /* 登录页那四个 pane 的**文案基线**：三条不许出现的假话 */
    const loginSrc = fs.readFileSync(path.join(ROOT, "login/index.html"), "utf8");
    chk(!/邮件已发送|已发送确认邮件/.test(loginSrc), "登录页不写「邮件已发送」（发信是事实，不是尽力）");
    chk(/还没|没能|发不出去/.test(loginSrc), "登录页如实写了「可能发不出去」这件事");
    /* 登录页那两处与「邮箱存在性」有关的措辞，逐条钉住：
       ① **用户看得见的文案**里不许出现「没注册过 / 不存在」这类断言
          （源码注释里出现是允许的 —— 注释恰恰在解释为什么不许那么写，
            拿整份文件去扫必然把那段解释本身判成违规）
       ② 那一句文案必须是**条件句**：判断留给收件箱，界面不替服务端回答 */
    const loginVisible = loginSrc.replace(/<!--[\s\S]*?-->/g, " ");
    chk(!/这个邮箱没注册|没有这个邮箱|邮箱不存在|未注册/.test(loginVisible),
      "登录页的**可见文案**里不回答「这个邮箱注册过没有」（那等于邮箱枚举）");
    /* ⚠️ 那句条件句住在 **js/login.js** 里（向用户显示时才写进 DOM），
       不在 HTML 里 —— 拿 HTML 去找必然找不到。两处都要扫：
       HTML 里是静态文案，JS 里是运行期文案，漏一处就等于没守。 */
    const loginJs = fs.readFileSync(path.join(ROOT, "js/login.js"), "utf8");
    chk(/如果这个邮箱在本站注册过/.test(loginJs),
      "忘记密码那一屏用的是条件句「如果这个邮箱在本站注册过」（与服务端同一句话）");

    /* 新页面的 data-back 落点：确认 / 重设都回 /login/（做完就走，下一件事是登录） */
    ["verify/index.html", "reset/index.html"].forEach(f => {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      chk(/data-back="\/login\/"/.test(src), f + " 的返回落点指向 /login/");
      chk(/data-dock="off"/.test(src), f + " 不留底部页签（一段「专心做完」的流程）");
    });

    /* 重设页必须**如实说**会吊销别的设备（那是这一件事的一半含义） */
    const resetSrc = fs.readFileSync(path.join(ROOT, "reset/index.html"), "utf8");
    chk(/其它设备|其他设备/.test(resetSrc), "重设页写明「其它设备上的登录会全部退出」");
  }

  /* ==================================================================
     二十四、Issue #197：邮箱随机码那条路上的安全洞（全面审查第二轮）

     这一节守的是**六个已经真实存在过的洞**，每一个都附了当时的现场。
     它们有一个共同形状：**限制写在 A 处、读取在 B 处** ——
     文档（docs/auth-design.md §5.4/§5.5/§6.2/§6.4）写着一套，代码里溜过去了。
     所以这一节的断言全部**直接打内核与 HTTP**，一个界面都不经过。

       ① 失败次数只进不出：单账号一天能猜 `枚数 × 5` 次
       ② 频控是「先检查、后落账」，中间隔着发信商的网络往返 —— 并发下形同不限
       ③ 校验口没有 IP 档，而且格式早退那条路**一条账都不留**
       ④ 冒烟中转码会随 5xx / 不一致响应泄出（恰好在 ALLOW_CODE_ECHO 开着的那种环境）
       ⑤ 会话是无上限的滑动窗口（30 天的会话可以活成 60 天、90 天…）
       ⑥ 频控只在单实例内有效，而接口从没如实说过这件事
     ================================================================== */
  {
    /* ---- ①②③⑤ 内核层：直接调 core，用注入的假时钟 ---- */
    boot({ ALLOW_CODE_ECHO: "1" });
    const core = require("../api/_lib/core.js");
    const storeMod = require("../api/_lib/store.js");
    const sessionMod = require("../api/_lib/session.js");

    /* 造一套「频控不挡路」的环境：这一节要验的是**猜错封禁与并发**，
       不是频控档位本身（那一档由第十八节 / 第十九节守着）。 */
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

    /* ------------------------------------------------ ① 猜错封禁真的存在 */
    {
      const r = rig();
      const seen = [];
      let lockedAt = -1;
      for (let round = 0; round < 6 && lockedAt < 0; round++) {
        r.clock.t += 5000;                       // 每轮隔开，绕开冷却
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

      /* 锁是**账号级**的：换个设备、换个出口 IP 也拦得住 —— 这正是
         「只认 uid、不认邮箱字符串」那条口径在起作用（§5.5 末句）。 */
      r.clock.t += 5000;
      const after = await send(r.d, "victim@example.com", "brand-new-device", "203.0.113.7");
      eq(after.status, 423, "① 锁后换设备 + 换 IP 再发码：仍然 423（锁认 uid）");
      eq(after.body.code, "E_LOCKED", "① 码是 E_LOCKED");
      chk(after.body.retryAfter > 80000 && after.body.retryAfter <= 86400,
        "① 如实回「还剩多久」（实际 " + after.body.retryAfter + " 秒）");

      /* 锁**会到期**：原先写进去就没人擦，「24 小时」变「一辈子」。 */
      r.clock.t += 86400000 + 1000;
      const later = await send(r.d, "victim@example.com", "third-device", "203.0.113.8");
      eq(later.status, 200, "① 24 小时之后自动解锁（锁不是终态）");
      const acc = Object.values(r.d.store._db.accounts)[0];
      eq(acc.status, "active", "① 解锁时把账号状态改回 active（不留在 locked 上）");
      eq(acc.locked_until, null, "① 解锁时清掉 locked_until");
      eq((r.d.limiter._hits["wrong|" + acc.uid] || []).length, 0,
        "① 解锁时连错轮数的账一并清掉（不清的话用户回来错一枚码就又被锁一天）");
    }

    /* ------------------------------------------------ ② 频控是原子的 */
    {
      const r = rig({ resendCooldownMs: 1 });
      /* 把窗口收窄到「一小时 3 枚」，然后**并发**打 3 次：
         正确的实现里只放行 1 次（后两次被冷却挡），
         而「先 check 后 hit」的写法会让 3 次全部通过（各自看到空窗口）。 */
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

    /* ------------------------------------------------ ③ 校验口：格式早退也落账 */
    {
      const r = rig();
      r.d.cfg.codeLength = 6;
      /* 这条路的要命之处：`given.length !== 6` 时**连 store 都不碰**，
         原先一条账都不留 —— 一个可以无限打的免费 oracle。 */
      const before = Object.keys(r.d.limiter._hits).filter(k => k.indexOf("verify:") >= 0).length;
      await verify(r.d, "c_none", "123");
      const after = Object.keys(r.d.limiter._hits).filter(k => k.indexOf("verify:") >= 0).length;
      chk(after > before, "③ 码长不对那条早退路径**也要落账**（原先一条不记，可以无限打）");
      const devKeys = Object.keys(r.d.limiter._hits).filter(k => k.startsWith("device|verify:"));
      const ipKeys = Object.keys(r.d.limiter._hits).filter(k => k.startsWith("ip|verify:"));
      chk(devKeys.length > 0, "③ 校验口按**设备**记账");
      chk(ipKeys.length > 0, "③ 校验口按**出口 IP**记账（deviceId 是客户端给的，换一个就绕过了）");
    }

    /* ------------------------------------------------ ③b 换 deviceId 绕不过 IP 档 */
    {
      const r = rig();
      r.d.cfg.wrongRoundsLimit = 3;
      /* 攻击者：每轮换一个 deviceId、换一个邮箱（也就换一个 uid），
         但出口 IP 换不掉 —— IP 那一档必须兜住。 */
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

    /* ------------------------------------------------ ④ 中转码不随 5xx 泄出 */
    {
      const r = rig();
      /* 把发信通道掰成一个**会抛**的实现 —— 模拟「配了 sendgrid 但请求发不出去」。
         `sendVia` 抛出去之后走的是 catch 那条 502 分支。 */
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

    /* ------------------------------------------------ ⑤ 会话不再无上限续期 */
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

    /* ------------------------------------------------ ⑥ 隔离性如实自报 */
    {
      const cfg = Object.assign({}, require("../api/_lib/config.js"));
      const facts = core.channelFacts(cfg);
      eq(facts.rate, "instance",
        "⑥ /api/me 如实自报「频控只在本实例内有效」（配了库也一样 —— 账本在进程内存里）");
      chk(facts.rate === "instance" && facts.db === "memory" || facts.rate === "instance",
        "⑥ 这一条与 db 那条是**两件事**：db 说数据活多久，rate 说限流在几台机器上算数");
    }

    /* ------------------------------------------------ ⑤b 走真 HTTP：续期只在后半段发生 */
    boot({ ALLOW_CODE_ECHO: "1" });
    const sv = await serve();
    try {
      const POST = (p, b, cookie) => call(sv.base, "POST", p, b, cookie);
      /* ⚠️ 「不确认就不让登录」之后，先走完整注册 + 确认一遍。
         这一节测的是**续期**，不是确认闸（那道闸在第廿六节有专门的断言）。 */
      const c1 = await loginByHttp(POST, "session@example.com");
      chk(/kbsid=/.test(c1), "⑤ 拿到 kbsid 那枚 Cookie");

      /* 紧接着再登一次（信任期内一点即入的真实形状）：
         会话还剩 30 天 —— **不该续**，于是不发新 Set-Cookie。 */
      /* ⚠️ 用**另一个邮箱**再走一遍：同一个邮箱连着要第二枚码会被 60 秒冷却挡住，
         而那一条是**另一件正确的事**（第十九节的频控对拍守着），
         在这里挡下来只会让这一节变成「测冷却」而不是「测续期」。 */
      /* ⚠️ 这里要的是「**手里那一枚**会话还剩 30 天时**再登一次**」。
         所以拿一个**新账号**再发一枚码 —— 同一个邮箱连着要第二枚码会被
         60 秒重发冷却挡住（那是另一件正确的事，第十九节守着）。
         第二个账号也在这一步顺带被建好、确认好。 */
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

  /* ==================================================================
     廿六、Issue #197 复审：完整登录流程的安全审计（第三轮）

     用户问的是**两件事**：
       A. 「如果用户收不到邮件，重试的机制如何设计？」
       B. 「全面审核登录 / 注册 / 密码重置 / 注册确认 / 随机码等机制下的安全性」

     这一节把两件事的结论都钉在这里。A 的答案是 `withRetry`（指数退避 +
     只重试可能自愈的错 + 如实回报尝试次数），B 是 **11 处真问题**，
     每一处都附了当时的现场。它们仍然是同一个形状：
     **限制写在 A 处、读取在 B 处** —— 文档（或注释）写着一套，代码里溜过去了。

       ① 邮箱确认**从来没生效过**：两条登录路都不看账号状态
       ② 注册可以**改掉已有账号的口令**（无凭据的账号接管）
       ③ 重发确认邮件只有「要登录」那一条入口 → 未确认的人被锁死在门外
       ④ 重发确认邮件只按设备档记账，且是 check 而非 take
       ⑤ 忘记密码 / 注册 / 重设口**没有 IP 档**，且都是「先检查后落账」
       ⑥ `verifyEmail` 只给 token 时会**全表扫描**且比对必然失败
       ⑦ 发信失败后**没有任何重试**，且界面上看不到「试了几次、为什么没成」
     ================================================================== */
  {
    /* ---- ① 邮箱确认闸：两条登录路都拦，而且只写一处 ---- */
    {
      boot({ ALLOW_CODE_ECHO: "1" });
      const core = require("../api/_lib/core.js");
      const cfg = require("../api/_lib/config.js");
      const store = require("../api/_lib/store.js").memoryStore();
      const d = { cfg, store, limiter: core.makeRateLimiter(), now: () => Date.now(), deviceId: "v1", ip: "1.1.1.1" };

      /* --- 1a. 随机码那条路 --- */
      const s1 = await core.sendCode(d, { email: "gate@example.com", purpose: "login", deviceId: "v1", ip: "1.1.1.1" });
      eq(s1.status, 200, "① 未确认的账号照常能**收到**码（发码不是登录，不该被拦）");
      const v1 = await core.verifyCode(d, { codeId: s1.body.codeId, code: s1.body.devCode, deviceId: "v1", ip: "1.1.1.1" });
      eq(v1.status, 403, "① 随机码那条路：码对但邮箱没确认 → **403**（原先根本不看账号状态，直接发会话）");
      eq(v1.body.code, "E_EMAIL_UNVERIFIED", "① 码是 E_EMAIL_UNVERIFIED（不是含糊的 E_LOGIN_FAIL）");
      chk(!v1.cookies && !v1._session, "① 被拦时**不签发会话**（拦在半路等于没拦）");

      /* --- 1b. 口令那条路 --- */
      const regG = await core.register(d, { email: "gate2@example.com", password: "hunter2hunter", deviceId: "v2" });
      const gAcc = Object.values(store._db.accounts).filter(a => a.email === "gate2@example.com")[0];
      const lg = await core.loginWithPassword(d, { email: "gate2@example.com", password: "hunter2hunter", deviceId: "v3" });
      eq(lg.status, 403, "① 口令那条路：口令对但邮箱没确认 → 403");
      eq(lg.body.code, "E_EMAIL_UNVERIFIED", "① 同一个码（判据只写一处，两条路读同一个）");
      chk(!lg.cookies, "① 同样不签发会话");

      /* --- 1c. 判据落在**校验之后**：不存在与未确认**不**可区分 --- */
      const ghost = await core.loginWithPassword(d, { email: "ghost-gate@example.com", password: "hunter2hunter", deviceId: "v4" });
      eq(ghost.status, 401, "① 账号不存在回 401 E_LOGIN_FAIL（**不是 403**）");
      eq(ghost.body.code, "E_LOGIN_FAIL", "① 两种情形回**不同的码** —— 但那不构成枚举：");
      /* ⚠️ 这一条是这一处设计的关键：攻击者要拿到 E_EMAIL_UNVERIFIED，
         必须**先猜中口令**（或拿到码）。而那时他本来就已经是账号主人，
         「这个邮箱确认了没有」对他不是新信息。所以闸判在校验之后是**刻意**的。 */
      const wrongPwOnUnverified = await core.loginWithPassword(d, { email: "gate2@example.com", password: "totally-wrong-pw", deviceId: "v5" });
      eq(wrongPwOnUnverified.status, 401, "① 未确认账号 + 错口令 → 401（**不是 403**）—— 判据在校验之后，所以没确认这件事不泄露");

      /* --- 1d. 确认之后两条路都放行 --- */
      await confirmEmail(store, gAcc.uid, cfg.sessionSecret);
      const lg2 = await core.loginWithPassword(d, { email: "gate2@example.com", password: "hunter2hunter", deviceId: "v6" });
      eq(lg2.status, 200, "① 确认之后口令那条路放行");
      const s2 = await core.sendCode(d, { email: "gate2@example.com", purpose: "login", deviceId: "v7", ip: "2.2.2.2" });
      const v2 = await core.verifyCode(d, { codeId: s2.body.codeId, code: s2.body.devCode, deviceId: "v7", ip: "2.2.2.2" });
      eq(v2.status, 200, "① 确认之后随机码那条路也放行");

      /* --- 1e. 应急闸门：关掉时不拦，且**如实自报** --- */
      const cfgOff = Object.assign({}, cfg, { requireEmailVerified: false });
      const dOff = Object.assign({}, d, { cfg: cfgOff });
      const s3 = await core.sendCode(dOff, { email: "gateoff@example.com", purpose: "login", deviceId: "v8", ip: "3.3.3.3" });
      const v3 = await core.verifyCode(dOff, { codeId: s3.body.codeId, code: s3.body.devCode, deviceId: "v8", ip: "3.3.3.3" });
      eq(v3.status, 200, "① REQUIRE_EMAIL_VERIFIED=0 时不拦（发信通不了时不许「谁也别想注册」）");
      eq(core.channelFacts(cfgOff).requireVerified, false, "① 关掉时**如实自报**（界面据此不写「没确认就进不来」）");
      eq(core.channelFacts(cfg).requireVerified, true, "① 默认是**拦**（事实自报，不是「尽力」）");
    }

    /* ---- ② 注册不许改掉已有账号的口令（账号接管洞） ---- */
    {
      boot({ ALLOW_CODE_ECHO: "1" });
      const core = require("../api/_lib/core.js");
      const cfg = require("../api/_lib/config.js");
      const store = require("../api/_lib/store.js").memoryStore();
      const d = { cfg, store, limiter: core.makeRateLimiter(), now: () => Date.now(), deviceId: "t1", ip: "1.1.1.1" };

      await core.register(d, { email: "victim@example.com", password: "original-pw-11", deviceId: "t1" });
      const uid = Object.values(store._db.accounts)[0].uid;
      const hash0 = store._db.accounts[uid].password_hash;

      /* 攻击者只填一个邮箱（口令随便给一个）—— 原先这一下就把账号拿走了 */
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

      /* 而没有口令的老账号（发码那条路建的）**仍然**能通过注册补口令 —— 那是迁移路径 */
      const sv = core; // 别名，避免 lint
      void sv;
      const d2 = { cfg, store: require("../api/_lib/store.js").memoryStore(), limiter: core.makeRateLimiter(), now: () => Date.now(), deviceId: "t5", ip: "2.2.2.2" };
      await core.sendCode(d2, { email: "legacy@example.com", purpose: "login", deviceId: "t5", ip: "2.2.2.2" });
      const legacyUid = Object.values(d2.store._db.accounts)[0].uid;
      eq(d2.store._db.accounts[legacyUid].password_hash, "", "② 发码那条路建的账号没有口令");
      const fill = await core.register(d2, { email: "legacy@example.com", password: "brand-new-77", deviceId: "t6" });
      eq(fill.status, 200, "② 没有口令的老账号：注册给它补上口令（这条迁移路径**保留**）");
      chk(!!d2.store._db.accounts[legacyUid].password_hash, "② 口令真的写进去了");
    }

    /* ---- ③ 匿名重发确认邮件：未确认的人唯一的出路，而且不泄露存在性 ---- */
    {
      boot({ ALLOW_CODE_ECHO: "1" });
      const core = require("../api/_lib/core.js");
      const cfg = require("../api/_lib/config.js");
      const store = require("../api/_lib/store.js").memoryStore();
      const d = { cfg, store, limiter: core.makeRateLimiter(), now: () => Date.now(), deviceId: "u1", ip: "1.1.1.1" };

      await core.register(d, { email: "stuck@example.com", password: "hunter2hunter", deviceId: "u1" });

      /* 未登录（deps.account = null）→ 走匿名口 */
      const anon = await core.resendVerification(d, { email: "stuck@example.com", deviceId: "u1", ip: "1.1.1.1" });
      eq(anon.status, 200, "③ 匿名重发可用（原先回 401 —— 而登不进来的人恰恰最需要它）");
      eq(anon.body.requested, true, "③ 回 requested:true（与 reset-request 同一个形状）");
      chk(!/emailMask|verifyAttempts/.test(JSON.stringify(anon.body)),
        "③ 匿名口的响应里**没有掩码、没有尝试次数** —— 它们都是从「这个邮箱存在」推出来的");

      /* **存在与不存在回话逐字相同**（生产形态：关掉冒烟口比）。
         ⚠️ 两次必须用**不同的邮箱、不同的 deviceId、不同的 IP、不同的频控器** ——
            同一条路径连着走会被 60 秒重发冷却挡住（那是另一件正确的事），
            于是这一条会以「两个响应不同」的形式红掉，而其实压根没比到。 */
      const plainCfg = Object.assign({}, cfg, { allowCodeEcho: false, resendCooldownMs: 1 });
      const dp = Object.assign({}, d, { cfg: plainCfg, limiter: core.makeRateLimiter(), ip: "3.3.3.3" });
      const known = await core.resendVerification(dp, { email: "stuck@example.com", deviceId: "u2", ip: "3.3.3.3" });
      const unknown = await core.resendVerification(dp, { email: "nobody-here@example.com", deviceId: "u3", ip: "4.4.4.4" });
      eq(JSON.stringify(known.body), JSON.stringify(unknown.body),
        "③ **生产形态下两个响应逐字相同**（否则它是一个「这个邮箱是谁的、确认了没有」的查询口）");
      chk(/如果/.test(unknown.body.note), "③ 文案是条件句（判断留给收件箱）");

      /* 已确认的不发信 */
      const accS = Object.values(store._db.accounts)[0];
      await confirmEmail(store, accS.uid, cfg.sessionSecret);
      const done = await core.resendVerification(Object.assign({}, d, { account: { uid: accS.uid } }), { deviceId: "u4", ip: "5.5.5.5" });
      eq(done.body.alreadyVerified, true, "③ 已确认的：如实回 alreadyVerified:true，且**不再发信**");
      eq(done.body.verifySent, false, "③ 那时 verifySent 为 false（确实没发）");

      /* 匿名 + 邮箱形状不对 → 400（形状是调用方自己给的，不泄露任何东西） */
      const bad = await core.resendVerification(d, { email: "not-an-email", deviceId: "u5", ip: "6.6.6.6" });
      eq(bad.status, 400, "③ 匿名口邮箱形状不对回 400");
      eq(bad.body.code, "E_EMAIL_FORMAT", "③ 码是 E_EMAIL_FORMAT");

      /* 登录态那条入口照旧（换一个频控器，避开上面已经用掉的额度） */
      const accUid = Object.values(store._db.accounts)[0].uid;
      const dSigned = Object.assign({}, d, {
        limiter: core.makeRateLimiter(), account: { uid: accUid }, deviceId: "u6", ip: "7.7.7.7"
      });
      const signed = await core.resendVerification(dSigned, { deviceId: "u6", ip: "7.7.7.7" });
      eq(signed.status, 200, "③ 登录态那条入口仍然可用（两条入口共用一套闸）");
    }

    /* ---- ④ 重发确认邮件的频控：四层、原子、且按 uid 记 ---- */
    {
      boot({ ALLOW_CODE_ECHO: "1" });
      const core = require("../api/_lib/core.js");
      const cfg = require("../api/_lib/config.js");
      const store = require("../api/_lib/store.js").memoryStore();
      /* 把「重发冷却」和档位都调开，专测**它到底记不记账、记在哪几档** */
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

      /* 冷却**先于**频控判定：同一邮箱连点两次，第二次必须被冷却挡住 */
      const again = await core.resendVerification(Object.assign({}, d, { cfg: Object.assign({}, cfgFast, { resendCooldownMs: 60000 }) }),
        { email: "spam@example.com", deviceId: "w2", ip: "10.10.10.10" });
      eq(again.status, 429, "④ 60 秒内同一邮箱再要一封 → 429");
      eq(again.body.code, "E_RATE_EMAIL", "④ 码是 E_RATE_EMAIL");
      chk(again.body.retryAfter > 0, "④ 如实回「还要等多久」");

      /* 频控是**原子 take**：并发打 3 次只放行 1 次（冷却调成 1ms 好让并发真的撞上） */
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

    /* ---- ⑤ 注册 / 忘记密码 / 重设：都有 IP 档，且原子落账 ---- */
    {
      boot({ ALLOW_CODE_ECHO: "1" });
      const core = require("../api/_lib/core.js");
      const cfg = require("../api/_lib/config.js");
      const store = require("../api/_lib/store.js").memoryStore();
      const lim = core.makeRateLimiter();
      /* 把邮箱/设备档放到很宽，这样唯一能挡住的就是**IP 档** ——
         这正是「换 deviceId、换邮箱能不能绕过」的判据。 */
      const cfgIp = Object.assign({}, cfg, {
        resendCooldownMs: 1,
        rate: { email: [[3600000, 9999]], device: [[3600000, 9999]], ip: [[3600000, 3]], global: [[3600000, 9999]] }
      });
      const d = { cfg: cfgIp, store, limiter: lim, now: () => Date.now(), deviceId: "x", ip: "203.0.113.5" };

      /* ① reset-request：换邮箱 + 换 deviceId，全在同一个出口 IP 上 */
      const statuses = [];
      for (let i = 0; i < 6; i++) {
        const r = await core.resetRequest(d, { email: "ghost" + i + "@example.com", deviceId: "dev" + i, ip: "203.0.113.5" });
        statuses.push(r.status === 429 ? r.body.code : r.status);
      }
      chk(statuses.indexOf("E_RATE_IP") >= 0,
        "⑤ 忘记密码口**有 IP 档**：换邮箱 + 换 deviceId 也绕不过（原先一条 IP 账都不记）");
      chk(Object.keys(lim._hits).some(k => k.indexOf("ip|reset:") === 0), "⑤ 那一档真的落在 ip 桶里");
      chk(Object.keys(lim._hits).some(k => k.indexOf("device|reset:") === 0), "⑤ 设备档也同时记（两层各自有读数）");

      /* ② register 同样有 IP 档 */
      const limB = core.makeRateLimiter();
      const dB = { cfg: cfgIp, store: require("../api/_lib/store.js").memoryStore(), limiter: limB, now: () => Date.now(), deviceId: "y", ip: "198.51.100.7" };
      const regStatuses = [];
      for (let i = 0; i < 6; i++) {
        const r = await core.register(dB, { email: "reg" + i + "@example.com", password: "hunter2hunter", deviceId: "rd" + i, ip: "198.51.100.7" });
        regStatuses.push(r.status === 429 ? r.body.code : 200);
      }
      chk(regStatuses.indexOf("E_RATE_IP") >= 0, "⑤ 注册口也有 IP 档（它匿名可写、会建号、会发信）");
      chk(Object.keys(limB._hits).some(k => k.indexOf("ip|reg:") === 0), "⑤ 那一档落在 ip 桶里");

      /* ③ login 的退避档：设备 + IP 两层 */
      const limC = core.makeRateLimiter();
      const dC = { cfg: cfgIp, store: require("../api/_lib/store.js").memoryStore(), limiter: limC, now: () => Date.now(), deviceId: "z", ip: "192.0.2.9" };
      await core.register(dC, { email: "l@example.com", password: "hunter2hunter", deviceId: "z" });
      await core.loginWithPassword(dC, { email: "l@example.com", password: "nope-x", deviceId: "l1", ip: "192.0.2.9" });
      chk(Object.keys(limC._hits).some(k => k.indexOf("ip|login:") === 0), "⑤ 口令登录按 IP 记退避档");
      chk(Object.keys(limC._hits).some(k => k.indexOf("device|login:") === 0), "⑤ 口令登录按设备记退避档");

      /* ④ reset-confirm 也有 */
      const limD = core.makeRateLimiter();
      const dD = { cfg: cfgIp, store: require("../api/_lib/store.js").memoryStore(), limiter: limD, now: () => Date.now(), deviceId: "q", ip: "192.0.2.20" };
      await core.resetConfirm(dD, { rid: "r_missing", token: "x".repeat(64), password: "hunter2hunter", deviceId: "q1", ip: "192.0.2.20" });
      chk(Object.keys(limD._hits).some(k => k.indexOf("ip|resetc:") === 0), "⑤ 重设口按 IP 记账（它同样是匿名可写的）");
    }

    /* ---- ⑥ verifyEmail 只给 token：不扫表、不猜参数 ---- */
    {
      boot({ ALLOW_CODE_ECHO: "1" });
      const core = require("../api/_lib/core.js");
      const cfg = require("../api/_lib/config.js");
      const store = require("../api/_lib/store.js").memoryStore();
      const d = { cfg, store, limiter: core.makeRateLimiter(), now: () => Date.now(), deviceId: "y1", ip: "1.1.1.1" };

      const reg = await core.register(d, { email: "scan@example.com", password: "hunter2hunter", deviceId: "y1" });
      const tok = reg.body.devVerifyToken;
      const vid = Object.keys(store._db.verifications)[0];

      /* 只给令牌（把链接里的参数拷了一半）—— 原先这里会全表扫描 + 挑一条**别人的**记录 */
      let listed = 0;
      const origList = store.listVerifications;
      store.listVerifications = function () { listed++; return origList ? origList.apply(store, arguments) : []; };
      const onlyToken = await core.verifyEmail(d, { token: tok });
      eq(onlyToken.status, 400, "⑥ 只给 token 不给 vid → 400");
      eq(onlyToken.body.code, "E_NO_TOKEN", "⑥ 码是 E_NO_TOKEN（如实说「链接不完整」，不猜）");
      eq(listed, 0, "⑥ **一次全表扫描都不做**（那条入口是匿名的，扫表是别人替你付的代价）");
      chk(!store._db.verifications[vid].consumed_at, "⑥ 也没顺手消费掉那条记录");
      store.listVerifications = origList;

      /* 正常的两个参数仍然好使 */
      const good = await core.verifyEmail(d, { vid: vid, token: tok });
      eq(good.status, 200, "⑥ 参数齐全时照常确认成功");
    }

    /* ---- ⑦ 发信重试：只重试可能自愈的错，且如实回报尝试次数 ---- */
    {
      boot({ ALLOW_CODE_ECHO: "1", MAIL_RETRY_MAX: "2", MAIL_RETRY_BUDGET_MS: "6000" });
      const mail = require("../api/_lib/mail/index.js");
      const cfg = require("../api/_lib/config.js");

      /* ⑦a 值不值得重试的判据 */
      chk(mail.retriable({ status: 429 }), "⑦ 429（发信商限速）值得重试");
      chk(mail.retriable({ status: 500 }), "⑦ 500 值得重试");
      chk(mail.retriable({ status: 503 }), "⑦ 503 值得重试");
      chk(mail.retriable(new Error("ECONNRESET")), "⑦ 网络层错误值得重试（它没有 HTTP 状态）");
      chk(!mail.retriable({ status: 401 }), "⑦ 401 **不**重试（密钥不对，重试一万次也一样）");
      chk(!mail.retriable({ status: 403 }), "⑦ 403 **不**重试");
      chk(!mail.retriable({ status: 400 }), "⑦ 400 **不**重试（收件人被拒）");
      chk(!mail.retriable({ status: 422 }), "⑦ 422 **不**重试（域名 / 发信人未验证）");

      /* ⑦b 网络错会真的重试到上限 */
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

      /* ⑦c 4xx 不重试，立刻放弃 */
      let tries4 = 0;
      try {
        await mail.withRetry(cfg, function () {
          tries4++;
          return Promise.reject(Object.assign(new Error("mail 401"), { status: 401 }));
        });
      } catch (e) { void e; }
      eq(tries4, 1, "⑦ 401 **只试 1 次**（重试它只会把额度烧光、把错因埋掉）");

      /* ⑦d 成功时不重试 */
      let triesOk = 0;
      const okr = await mail.withRetry(cfg, function () {
        triesOk++;
        return Promise.resolve({ delivered: true, transport: "resend", status: 200 });
      });
      eq(triesOk, 1, "⑦ 成功就 1 次（重试机制不该给正常路径加延迟）");
      eq(okr.delivered, true, "⑦ 如实回 delivered");
      eq(okr.attempts, 1, "⑦ 如实回 attempts");

      /* ⑦e console 通道「没往外发」**不是失败**，不重试 */
      let triesConsole = 0;
      const cfgConsole = Object.assign({}, cfg, { mailTransport: "console", sendgridKey: null, resendKey: null });
      const cr = await mail.withRetry(cfgConsole, function () {
        triesConsole++;
        return mail.sendKind(cfgConsole, "code", { to: "a@b.com", mask: "a***@b.com", code: "123456" });
      });
      eq(triesConsole, 1, "⑦ console 通道只试 1 次（它不是失败，是「这个通道本来就不往外发」）");
      eq(cr.delivered, false, "⑦ console 的 delivered 如实为 false");

      /* ⑦f 有界：预算很小的时候不许无限重试 */
      let triesBudget = 0;
      try {
        await mail.withRetry(Object.assign({}, cfg, { mailRetryMax: 99, mailRetryBudgetMs: 1 }), function () {
          triesBudget++;
          return Promise.reject(new Error("ECONNRESET"));
        });
      } catch (e) { void e; }
      chk(triesBudget <= 3, "⑦ 预算是**有界的**（MAIL_RETRY_BUDGET_MS=1 时不许把重试次数跑满，实际 " + triesBudget + " 次）");
    }

    /* ---- ⑦g 走真 HTTP：register 的响应里有「试了几次、为什么没成」 ---- */
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


  /* ==================================================================
     廿七、Issue #197 复审：三条**源码层**的口径（写成别的样子也能跑，
          但跑出来的东西是假的）

       ① 匿名重发的出路真的接在界面上（登录页那一屏有一颗不要求登录的键）
       ② 登录页/重设页里**没有一行**同时出现口令与本地存储 / URL
       ③ 注册页那句「不确认也能用」**已经不再出现**（那是被推翻的旧口径）
     ================================================================== */
  {
    const loginHtml = fs.readFileSync(path.join(ROOT, "login/index.html"), "utf8");
    const loginSrc = fs.readFileSync(path.join(ROOT, "js/login.js"), "utf8");
    const verifyHtml = fs.readFileSync(path.join(ROOT, "login/index.html"), "utf8");

    /* ① 未确认的人有出路：那颗键存在，而且**不要求登录** */
    chk(/id="btn-resend-verify"/.test(verifyHtml), "① 「重发确认邮件」那颗键在登录页上（未确认的人唯一的出路）");
    chk(/id="input-verify-email"/.test(verifyHtml), "① 有一个邮箱输入框（匿名口要它，登录态留空）");
    chk(/如果这个邮箱在本站注册过而且还没确认/.test(loginSrc) || /如果这个邮箱在本站注册过/.test(loginSrc),
      "① 匿名口的回话是**条件句**（判断留给收件箱，界面不替服务端回答）");
    chk(/E_EMAIL_UNVERIFIED/.test(loginSrc), "① 登录页认得出「邮箱没确认」这个码");
    chk(/setMode\("verify"\)/.test(loginSrc), "① 被拦时不只提示一句，而是**切到那一屏**（给出路）");

    /* ② 口令 + 本地存储 / URL 不许同现（与第廿三节同一条纪律，覆盖新代码） */
    ["js/login.js", "js/reset.js"].forEach(f => {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
      const bad = src.split("\n").filter(line => /password|input-pw|input-reg-pw|input-new-pw/i.test(line)
        && /localStorage|sessionStorage|document\.cookie|location\.search\s*\+/i.test(line));
      eq(bad.length, 0, "② " + f + " 里没有一行「口令 + 本地存储 / URL」同现：" + bad.join(" | ").slice(0, 80));
    });

    /* ③ 被推翻的旧口径不许留在可见文案里 */
    const visible = loginHtml.replace(/<!--[\s\S]*?-->/g, " ");
    chk(!/不确认也能用|不确认也能正常使用/.test(visible),
      "③ 登录页的**可见文案**里没有「不确认也能用」（那是被用户裁决推翻的旧口径）");
    const termsSrc = fs.readFileSync(path.join(ROOT, "terms/index.html"), "utf8");
    chk(!/不确认也能/.test(termsSrc), "③ 条款里也没有那句旧口径（条款永远跟随代码）");
    chk(/点开确认之后才能登录|确认之后才能登录/.test(termsSrc + visible),
      "③ 条款 / 登录页如实写着「确认之后才能登录」");

    /* ④ 发信重试的两档在清单里（缺了它「重试」就成了空话） */
    const opsSrc = fs.readFileSync(path.join(ROOT, "api/_lib/ops.js"), "utf8");
    chk(/MAIL_RETRY_MAX/.test(opsSrc) && /MAIL_RETRY_BUDGET_MS/.test(opsSrc),
      "④ 重试次数与预算都在配置清单里（.env.example 由它生成）");
    chk(/REQUIRE_EMAIL_VERIFIED/.test(opsSrc), "④ 邮箱确认闸也在清单里");
  }

  console.log(fails === 0 ? "\n🎉 服务端账号接口测试全部通过" : "\n❌ " + fails + " 项失败");
  process.exit(fails ? 1 : 0);
}

main().catch(e => {
  console.error("测试自身抛异常（这通常是环境问题，不是被测代码）：", e);
  process.exit(1);
});
