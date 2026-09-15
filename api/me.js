/**
 * GET /api/me —— 权益的唯一来源。
 *
 * res 200 { uid, nickname, plan:{tier,until}, features:[], mask }
 *     401 { code:"E_NO_SESSION" }
 *
 * ⚠️ 这是 Pro/Max 的**唯一合法挂载点**（docs §2.4 第 8 条）。
 *    客户端传上来的任何 plan 字段一律忽略（core.normalizeGrants）。
 * ⚠️ 未登录时回 401 而不是 200+空对象 —— 前端据此保持 local 模式，
 *    不弹窗、不打断背诵（docs §10「会话过期静默降级」）。
 *
 * Ref: docs/architecture.md §4.3
 */
"use strict";

var handler = require("./_lib/handler");

module.exports = handler.make("me", ["GET"], function (d) {
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.me(d);
});
