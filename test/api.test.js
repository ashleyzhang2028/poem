/**
 * 服务端账号接口测试（Issue #132 · 1A 期）
 * ==========================================================================
 * 纯 Node、**不联网、不装新依赖**：被测的是 `api/_lib/` 那几个模块，
 * 它们只用 Node 内建（crypto / http / https / fetch），而且：
 *   · 数据库走 `memoryStore`（进程内 Map），不需要真 Supabase
 *   · 发信走 `console` 通道（只打日志，不出网）
 *   · HTTP 层用 Node 的 `http` 起一个**只监听 127.0.0.1:0** 的真服务器，
 *     把 `api/*.js` 那六个 handler 挂上去 —— 这样测的是**真的请求-响应链**，
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
    "RESEND_COOLDOWN_MS", "CODE_MAX_ATTEMPTS"
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

/** 起一个真 HTTP 服务器，把 6 个 handler 按路由挂上 */
function serve() {
  const routes = {
    "POST /api/send-code": require("../api/send-code.js"),
    "POST /api/verify-code": require("../api/verify-code.js"),
    "GET /api/me": require("../api/me.js"),
    "POST /api/sync/pull": require("../api/sync/pull.js"),
    "POST /api/sync/push": require("../api/sync/push.js"),
    "DELETE /api/account": require("../api/account.js")
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
    chk(!/parent@example\.com/.test(JSON.stringify(acc)), "账号记录里没有明文邮箱");
    eq(acc.plan, "free", "新账号默认 free 层级");
    eq(acc.role, "user", "新账号默认 user 角色（与层级正交）");

    // 错码
    const w1 = await core.verifyCode(d, { codeId: r1.body.codeId, code: "999999" });
    eq(w1.status, 400, "错码回 400");
    eq(w1.body.code, "E_CODE_WRONG", "错码的错误码正确");
    eq(w1.body.remaining, 4, "错码回剩余次数 4");

    // 正确码
    const v1 = await core.verifyCode(d, { codeId: r1.body.codeId, code: "111111" });
    eq(v1.status, 200, "正确码通过");
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
    const v5 = await core.verifyCode(d, { codeId: r4.body.codeId, code: "444444" });
    eq(v5.status, 200, "最新的码可用");
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
    const v = await core.verifyCode(d, { codeId: r.body.codeId, code: "777777" });
    const uid = v.body.account.uid;
    const acc = store.getAccount(uid);

    const mine = await core.me({ cfg, store, limiter, now: () => t, account: { uid } });
    eq(mine.status, 200, "有会话时 /api/me 回 200");
    eq(mine.body.plan.tier, "free", "free 账号回 free");
    chk(mine.body.features.indexOf("speech.read") >= 0, "free 有 speech.read");
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

    const dd = Object.assign({}, d, { account: { uid: "u_test0001" } });

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
    const v = await core.verifyCode(d, { codeId: r.body.codeId, code: "888888" });
    const uid = v.body.account.uid;
    await core.syncPush(Object.assign({}, d, { account: { uid } }), {
      deviceId: "A", recs: [{ id: "p1", payload: { level: 3 }, updatedAt: t }]
    });
    chk(store.listProgress(uid, 0).length === 1, "注销前有一条云端进度");

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
    eq(store.listProgress(uid, 0).length, 0, "云端进度已删除");

    // 再登录是全新账号（uid 不回收）
    t += 61000;
    const r2 = await core.sendCode(d, { email: "bye@example.com", ip: "1.1.1.1", code: "999999" });
    const v2 = await core.verifyCode(d, { codeId: r2.body.codeId, code: "999999" });
    chk(v2.body.account.uid !== uid, "注销后重新登录拿到全新的 uid（uid 不回收）");
    eq(store.listProgress(v2.body.account.uid, 0).length, 0, "新账号里没有旧进度");
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

        const v1 = await call(sv2.base, "POST", "/api/verify-code", {
          codeId: s1.body.codeId, code: s1.body.devCode
        });
        eq(v1.status, 200, "校验码通过");
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
        eq(sent.email, "a@b.com", "请求体带上邮箱");
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
         · 上面那条 `req.method !== "GET"` **现在**已经天然挡住了六个接口
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
    chk(!/email\s+text\s+not null/.test(sql), "schema.sql 里没有明文邮箱列");
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

    await mem.putProgress("u_1", [{ poem_id: "p1", payload: { level: 9 }, updated_at: 100 }]);
    await mem.putProgress("u_1", [{ poem_id: "p1", payload: { level: 1 }, updated_at: 50 }]);
    const kept = mem.listProgress("u_1", 0)[0];
    eq(kept.payload.level, 9, "memoryStore：老时间戳盖不掉新值");
    await mem.putProgress("u_1", [{ poem_id: "p1", payload: { level: 7 }, updated_at: 200 }]);
    eq(mem.listProgress("u_1", 0)[0].payload.level, 7, "memoryStore：新时间戳能盖掉老值");

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

  console.log(fails === 0 ? "\n🎉 服务端账号接口测试全部通过" : "\n❌ " + fails + " 项失败");
  process.exit(fails ? 1 : 0);
}

main().catch(e => {
  console.error("测试自身抛异常（这通常是环境问题，不是被测代码）：", e);
  process.exit(1);
});
