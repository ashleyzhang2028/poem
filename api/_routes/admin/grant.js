"use strict";

var handler = require("../../_lib/handler");

module.exports = handler.make("admin.grant", ["POST", "DELETE"], function (d, body, req) {
  if (d.cfg && !d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  var method = String((req && req.method) || "POST").toUpperCase();
  if (method === "DELETE") {
    // 收回**只认 uid**（Issue #320）：掩码那一条认人路整块撤掉了。
    return handler.core.adminRevoke(d, { uid: body.uid, deviceId: body.deviceId || d.deviceId });
  }
  return handler.core.adminGrant(d, {
    uid: body.uid,
    tier: body.tier,
    until: body.until,
    deviceId: body.deviceId || d.deviceId
  });
});
