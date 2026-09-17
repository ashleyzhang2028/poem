/**
 * 把 `api/*.js` 那六个文件与内核（core.js）接起来。
 *
 * 六个 handler 长得几乎一样 —— 那正是**不该**在六个文件里各写一遍的理由：
 * 会话读取、错误兜底、日志、Cookie 都在这里做一次。
 *
 * ⚠️ 错误兜底的口径：**任何未预期异常都回 500，且响应体里不留内部细节**。
 *    异常细节只进服务端日志（经 redact），不回给客户端。
 */
"use strict";

var CONFIG = require("./config");
var storeMod = require("./store");
var session = require("./session");
var core = require("./core");
var game = require("./game");
var H = require("./http");

/* 单实例内的频控器：Serverless 实例存活期间有效（见 core.js 的说明） */
var limiter = core.makeRateLimiter();

/** 每次请求现算，便于测试注入 cfg / store */
function deps(req, body) {
  return {
    cfg: CONFIG,   /* ⚠️ 与 withSession 里用的 CONFIG 必须是**同一个对象** —— 见下方那条断言 */
    store: storeMod.getStore(CONFIG),
    limiter: limiter,
    now: function () { return Date.now(); },
    account: null,     // 由 withSession 填
    ip: H.clientIp(req),
    deviceId: H.deviceId(req, body)
  };
}

/** 读会话 → 取账号；没有会话就返回 account = null（**不在这里 401**，由 handler 决定） */
function withSession(req, d) {
  if (!CONFIG.hasSession()) return Promise.resolve(d);
  var token = session.fromCookieHeader((req.headers || {}).cookie, CONFIG.cookieName);
  var s = session.read(CONFIG, token, Date.now());
  if (!s) return Promise.resolve(d);
  return Promise.resolve(d.store.getSession(s.sid)).then(function (row) {
    // 会话被吊销（注销 / 重设凭证）→ 当作没有会话，前端静默降级为 local
    if (row && Number(row.revoked) === 1) return d;
    d.account = { uid: s.uid, sid: s.sid };
    return d;
  });
}

/**
 * 起一个 handler。
 *
 * @param {string} name         接口名（日志里用）
 * @param {string[]} methods    允许的方法
 * @param {Function} run        (deps, body, req) => Promise<{status,body,cookies?}>
 */
function make(name, methods, run, opts) {
  opts = opts || {};
  return function (req, res) {
    var m = String(req.method || "GET").toUpperCase();
    if (methods.indexOf(m) < 0) return H.methodNotAllowed(res, methods);
    /* rawBody：这个 handler 的 body 是**裸字节**（图片），不是 JSON。
       交给它自己去读流，`deps` 里仍然给一个空对象（它只用会话与设备号）。 */
    var rawBody = !!opts.rawBody;

    // GET/DELETE 也可能带 body，但这两个方法我们只用查询串与 Cookie
    /* ⚠️ **裸字节那一条路不走 `readBody()`**（Issue #163 的头像上传）：
       `readBody()` 会把请求体当 JSON 解，图片字节一进去就是 `E_BAD_BODY` ——
       而它的症状是「传头像永远 400」，看着像前端坏了。
       `rawBody` 的 handler 自己去读流（见 api/avatar/index.js 的 readBytes）。 */
    var wantBody = m !== "GET" && !rawBody;
    Promise.resolve(wantBody ? H.readBody(req) : {})
      .then(function (body) {
        if (body === null) {
          H.log("api.bad_body", { api: name });
          return H.json(res, 400, { code: "E_BAD_BODY", message: "请求体不是合法的 JSON" });
        }
        var d = deps(req, body);
        return withSession(req, d).then(function (d2) {
          return run(d2, body || {}, req);
        }).then(function (out) {
          /* ⚠️ `out.headers` 是**可选的**额外响应头（目前只有 /api/config 用它下
             Cache-Control）。写成 null 起步是为了保持既有行为一字不改：
             不返回 headers 的接口，响应头与从前完全一样。 */
          var headers = out.headers || null;
          if (out.cookies && out.cookies.length) {
            // 多枚 Cookie 必须用数组（setHeader 传数组才会写多条 Set-Cookie）
            res.setHeader("Set-Cookie", out.cookies);
          }
          /* ------------------------------------------------------------------
             人机校验失败要**进服务端日志**（Issue #197 后续）
             ------------------------------------------------------------------
             为什么必须记：Turnstile 失败在用户那边永远只看到一句
             「人机校验没通过，请刷新页面再试一次」——**刻意的**（不把
             Cloudflare 的 error-codes 暴露给调用方）。但这也意味着
             「密钥配错了」与「真的是脚本在刷」在客户端看起来一模一样。
             判这两件事的唯一材料就是这份服务端日志，所以必须留下。

             ⚠️ `_codes` 是 Cloudflare 回的 error-codes（如
                invalid-input-secret / timeout-or-duplicate / invalid-input-response）。
                它是**服务端配置与风控的诊断信息**，不是用户数据。
                经 `redact()` 之后进日志 —— 与「明文码不进日志」同一条纪律：
                所有日志都从这个出口过。
             ⚠️ 它**只在 status 为 400 且体内带 code E_TURNSTILE 时**记，
                不然每一条 400 都会试图去读一个不存在的字段。
             ------------------------------------------------------------------ */
          if (out.body && out.body.code === "E_TURNSTILE") {
            H.log("api.turnstile_blocked", {
              api: name,
              reason: out.body.turnstile,
              codes: out._codes || []
            });
          }
          H.log("api.ok", { api: name, status: out.status });
          H.json(res, out.status, out.body, headers);
        });
      })
      .catch(function (e) {
        // 内部细节只进日志，不回客户端
        H.log("api.error", { api: name, error: String(e && e.message || e).slice(0, 300) });
        H.json(res, 500, { code: "E_INTERNAL", message: "服务端出了点问题，稍后再试；期间本站仍可完全离线使用。" });
      });
  };
}

module.exports = {
  make: make,
  deps: deps,
  withSession: withSession,
  CONFIG: CONFIG,
  store: storeMod,
  core: core,
  game: game,
  http: H
};
