"use strict";

var handler = require("../../_lib/handler");

module.exports = handler.make("auth.login", ["POST"], function (d, body) {
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.loginWithPassword(d, {
    email: body.email,
    value: body.value,
    password: body.password,
    deviceId: body.deviceId || d.deviceId,

    ip: d.ip
  }).then(function (r) {
    if (r.status !== 200 || !r._session) return r;
    var s = r._session;
    return Promise.resolve(d.store.putSession({ sid: s.sid, uid: s.uid, iat: s.iat, exp: s.exp, revoked: 0 }))
      .then(function () {
        var out = { status: r.status, body: r.body, cookies: r.cookies };
        delete r._session;
        return out;
      });
  });
});
