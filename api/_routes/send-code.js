/**
 * POST /api/send-code —— 发验证码。
 *
 * req  { channel:"email"|"sms", value, purpose:"login"|"reset", deviceId }
 *      （兼容老字段：channel 缺省时读 email；email/phone 亦可）
 * res  202 { codeId, expiresAt, cooldown, transport, delivered, channel, store }
 *      400 { code:"E_EMAIL_FORMAT|E_PHONE_FORMAT|E_CHANNEL" }
 *      429 { code:"E_RATE_EMAIL|E_RATE_DEVICE|E_RATE_IP|E_RATE_GLOBAL", retryAfter }
 *      503 { code:"E_NOT_CONFIGURED|E_SMS_NOT_OPEN" }  ← 前者服务端没配好；
 *            后者短信通道没开通（2B：只留口子，如实拒掉，不假装发了短信）
 *
 * ⚠️ 无论邮箱是否存在，响应**完全一致**（防用户枚举，docs §4.3 第 4 条）。
 * ⚠️ 明文码不进任何日志；只有开了 ALLOW_CODE_ECHO 的冒烟模式才回 devCode。
 *
 * Ref: docs/architecture.md §4.3、docs/auth-design.md §7.2
 */
"use strict";

var handler = require("../_lib/handler");

module.exports = handler.make("send-code", ["POST"], function (d, body) {
  // 没配 SESSION_SECRET 就不签会话、也不发码 —— 如实回 503，
  // 而不是发一封「登录完也留不下来」的邮件。前端见到 503 会整体降级为 local。
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.sendCode(d, {
    channel: body.channel,
    value: body.value,
    email: body.email,
    phone: body.phone,
    purpose: body.purpose,
    deviceId: body.deviceId || d.deviceId,
    /* Issue #197 后续：人机校验的 token 必须**原样送到内核** —— 内核里
       `humanGuard` 读它（`turnstileToken` / `cf-turnstile-response` 两个名字都认）。
       ⚠️ 这一层只做「把参数送到」，**不判**校验过没过：
          判在服务端内核那一处（`core.humanGuard`），在这里再判一遍就是两处规则。 */
    turnstileToken: body.turnstileToken != null ? body.turnstileToken : body["cf-turnstile-response"],
    ip: d.ip
  }).then(function (r) {
    // 契约写的是 202（docs §4.3），内核回 200 —— 这里对齐契约
    return r.status === 200 ? { status: 202, body: r.body, cookies: r.cookies } : r;
  });
});
