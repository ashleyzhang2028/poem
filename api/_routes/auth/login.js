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

    // 人机校验的令牌（Issue #278 第四轮）：口径与 sendCode / register 同源 ——
    // 两个键名都收，因为 Cloudflare 自己那个表单字段就叫
    // `cf-turnstile-response`，前端照抄它时不必再改名。
    // 没配人机校验的实例这里恒为空串，内核的 humanGuard 会如实 skipped 放行。
    turnstileToken: body.turnstileToken != null ? body.turnstileToken : body["cf-turnstile-response"],

    ip: d.ip
  }).then(function (r) {
    // 会话行的落库与响应整形只写一处（`_lib/handler.js` 的 settleSession）：
    // 「内核签了会话但接口忘了落库」这种半截活，本轮起不再有第二个地方可写。
    return handler.settleSession(d, r);
  });
});
