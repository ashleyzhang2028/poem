/**
 * POST /api/reset-request —— 忘记密码第一步：发一封重设邮件（Issue #197）。
 *
 * req  { email, deviceId }
 * res  202 { requested:true, ttlSeconds, store, note }   ← **一律这一个形状**
 *      400 { code:"E_EMAIL_FORMAT" }
 *      429 { code:"E_RATE_DEVICE|E_RATE_EMAIL", retryAfter }
 *      503 { code:"E_NOT_CONFIGURED" }
 *
 * ⚠️ 最要紧的一条：**响应与请求一律不泄露「这个邮箱注册过没有」**。
 *    不存在的邮箱也回 202、也回同一个形状 —— 唯一的区别是不发信，
 *    而那一件事用户在界面上看不见（他去看自己的收件箱）。
 *    与发码那条 checklist 第 4 条逐字同源，理由也一样：
 *    一句「这个邮箱没注册过」等于把全站用户名单变成可查询的事实。
 * ⚠️ 重设链接里的令牌**不进任何日志**（http.js 的 redact 也覆盖不到请求体，
 *    所以这条纪律靠「不打日志」本身守着）。
 *
 * Ref: docs/auth-design.md §4.4、§13
 */
"use strict";

var handler = require("../../_lib/handler");

module.exports = handler.make("auth.reset-request", ["POST"], function (d, body) {
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.resetRequest(d, {
    email: body.email,
    value: body.value,
    deviceId: body.deviceId || d.deviceId,
    ip: d.ip
  }).then(function (r) {
    return r.status === 200 ? { status: 202, body: r.body } : r;
  });
});
