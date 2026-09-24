"use strict";

var handler = require("../../_lib/handler");

module.exports = handler.make("auth.verify-email", ["POST"], function (d, body) {
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.verifyEmail(d, {
    vid: body.vid,
    token: body.token
  }).then(function (r) {
    // 点完确认链接就登录（Issue #278）：这一条接口现在也会签发会话，
    // 于是它必须走同一处落库 / 同一条设置 Cookie 的路。
    return handler.settleSession(d, r);
  });
});
