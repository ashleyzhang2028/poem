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

function make(name, methods, run, opts) {
  opts = opts || {};
  return function (req, res) {
    var m = String(req.method || "GET").toUpperCase();
    if (methods.indexOf(m) < 0) return H.methodNotAllowed(res, methods);

    var rawBody = !!opts.rawBody;

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
