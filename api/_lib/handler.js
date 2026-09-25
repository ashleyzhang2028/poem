"use strict";

var CONFIG = require("./config");
var storeMod = require("./store");
var session = require("./session");
var core = require("./core");
var game = require("./game");
var H = require("./http");

var limiter = core.makeRateLimiter();

function deps(req, body) {
  return {
    cfg: CONFIG,
    store: storeMod.getStore(CONFIG),
    limiter: limiter,
    now: function () { return Date.now(); },
    account: null,
    ip: H.clientIp(req),
    deviceId: H.deviceId(req, body)
  };
}

function withSession(req, d) {
  if (!CONFIG.hasSession()) return Promise.resolve(d);
  var token = session.fromCookieHeader((req.headers || {}).cookie, CONFIG.cookieName);
  var s = session.read(CONFIG, token, Date.now());
  if (!s) return Promise.resolve(d);
  return Promise.resolve(d.store.getSession(s.sid)).then(function (row) {

    if (row && Number(row.revoked) === 1) return d;
    d.account = { uid: s.uid, sid: s.sid };
    return d;
  });
}

// 内核签了会话之后**必须**做的两件事（Issue #278）：把会话行落库、
// 把响应整形干净（去掉 `_session`、留下 `cookies`）。
//
// 为什么要收成一处：这段代码原先长在 `_routes/auth/login.js` 里，
// 而「邮箱确认」那条路根本不知道它的存在 —— 于是内核在确认里签了会话，
// 接口既不落库也不发 Cookie。写成两处就必然有第三处漏掉，
// 所以它跟 `make()` 放在一起，谁签会话谁调它。
function settleSession(d, r) {
  if (!r || r.status !== 200 || !r._session) return Promise.resolve(r);
  var s = r._session;
  return Promise.resolve(d.store.putSession({
    sid: s.sid, uid: s.uid, iat: s.iat, exp: s.exp, revoked: 0
  })).then(function () {
    var out = { status: r.status, body: r.body, cookies: r.cookies };
    delete r._session;
    return out;
  });
}

// 读正文这一步的**硬上限**（Issue #276 后续）。
//
// 为什么要有它：`readBody` 在两个监听器（data / end）都不会触发时**永不 resolve**
// —— 实测线上那一档就是「平台已经把流读空了」，函数于是被平台判超时，
// 外面看到的是整套 POST /api/* 回 500 E_INTERNAL（前端翻成「服务暂时不可用」）。
// `readBody` 自己已经补上了「流已读完」的判据，这里是**最后一道**：
// 无论以后谁改坏了那一处、或平台换了新的身体行为，函数都**不会挂死** ——
// 最多是这一发如实回一句「没读懂」，用户刷新即可，而不是等一个永远不来的响应。
var BODY_TIMEOUT = { __kb_body_timeout__: true };
var BODY_TIMEOUT_MS = 8000;

function readBodyGuarded(req) {
  return Promise.race([
    H.readBody(req),
    new Promise(function (resolve) { setTimeout(function () { resolve(BODY_TIMEOUT); }, BODY_TIMEOUT_MS); })
  ]);
}

function make(name, methods, run, opts) {
  opts = opts || {};
  return function (req, res) {
    var m = String(req.method || "GET").toUpperCase();
    if (methods.indexOf(m) < 0) return H.methodNotAllowed(res, methods);

    var rawBody = !!opts.rawBody;

    var wantBody = m !== "GET" && !rawBody;
    Promise.resolve(wantBody ? readBodyGuarded(req) : {})
      .then(function (body) {
        if (body === null) {
          H.log("api.bad_body", { api: name });
          return H.json(res, 400, { code: "E_BAD_BODY", message: "请求体不是合法的 JSON" });
        }
        if (body === BODY_TIMEOUT) {
          // 读正文这一步超时 = 「这一发没被读懂」，与「服务端内部出错」不是
          // 一件事 —— 后者会让人反复重试同一个坏请求（Issue #276 后续）。
          H.log("api.body_timeout", { api: name });
          return H.json(res, 400, { code: "E_BAD_BODY", message: "请求体没能在时限内读完，请刷新页面重试" });
        }
        var d = deps(req, body);
        return withSession(req, d).then(function (d2) {
          return run(d2, body || {}, req);
        }).then(function (out) {

          var headers = out.headers || null;
          if (out.cookies && out.cookies.length) {

            res.setHeader("Set-Cookie", out.cookies);
          }

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

        H.log("api.error", { api: name, error: String(e && e.message || e).slice(0, 300) });
        H.json(res, 500, { code: "E_INTERNAL", message: "服务端出了点问题，稍后再试；期间本站仍可完全离线使用。" });
      });
  };
}

module.exports = {
  make: make,
  deps: deps,
  settleSession: settleSession,
  withSession: withSession,
  CONFIG: CONFIG,
  store: storeMod,
  core: core,
  game: game,
  http: H
};
