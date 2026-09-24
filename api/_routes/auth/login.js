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
    // 会话行的落库与响应整形只写一处（`_lib/handler.js` 的 settleSession）：
    // 「内核签了会话但接口忘了落库」这种半截活，本轮起不再有第二个地方可写。
    return handler.settleSession(d, r);
  });
});
