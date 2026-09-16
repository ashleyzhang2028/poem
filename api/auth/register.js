/**
 * POST /api/register —— 注册（Issue #197 的完整登录流程）。
 *
 * req  { email, password, deviceId }
 * res  202 { uid, created, verifySent, verifyTransport, store }
 *      400 { code:"E_EMAIL_FORMAT|E_PW_EMPTY|E_PW_SHORT|E_PW_LONG" }
 *      429 { code:"E_RATE_DEVICE", retryAfter }
 *      503 { code:"E_NOT_CONFIGURED" }   ← 服务端没配好（缺 SESSION_SECRET）
 *
 * 四条口径（docs/auth-design.md §4.4）：
 *   1. **注册立刻建号**（与发码那条「收到码才建号」不同）：用户在这一步填了口令，
 *      没有账号就没地方放那个摘要。于是有一个必须说清的中间态：已建号、邮箱待确认。
 *   2. **不确认也能用**（`status:'pending'`）：把「没点确认邮件」做成「登不进去」
 *      是拿用户当人质。确认的价值是「找回密码 / 换设备时的凭据」。
 *   3. **老账号重新注册**（发码那条路建的、还没有口令）走**同一条路**：
 *      补上口令 + 重发确认邮件，响应与全新注册完全一致 —— 区分开就是邮箱枚举。
 *   4. **明文口令一秒钟都不落任何地方**：库里只有 `scrypt$...`，
 *      日志与响应体里都不出现它（与「明文码不进日志」同一条纪律）。
 *
 * ⚠️ `verifySent:false` 是**事实**（console 发信商下就是没发出去）。
 *    界面据此写「没能发出」，绝不写「确认邮件已发出」。
 * ⚠️ 响应里的 `devVerifyToken` **只在显式开 ALLOW_CODE_ECHO 时才有**（冒烟自测）。
 *
 * Ref: docs/auth-design.md §4.4、§7.2
 */
"use strict";

var handler = require("../_lib/handler");

module.exports = handler.make("auth.register", ["POST"], function (d, body) {
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.register(d, {
    email: body.email,
    value: body.value,
    password: body.password,
    deviceId: body.deviceId || d.deviceId,
    ip: d.ip
  }).then(function (r) {
    return r.status === 200 ? { status: 202, body: r.body } : r;
  });
});
