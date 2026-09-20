"use strict";

var handler = require("../../_lib/handler");

// 改别人的角色（Issue #276）：只有 owner 调得动，目标值只认 user / admin。
// 界面那一半是 /admin/ 上「账号名录」每行右侧那颗角色按钮。
module.exports = handler.make("admin.role", ["POST"], function (d, body) {
  if (d.cfg && !d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.adminSetRole(d, {
    uid: body.uid,
    role: body.role,
    deviceId: body.deviceId || d.deviceId
  });
});
