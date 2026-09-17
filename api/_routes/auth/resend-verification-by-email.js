/**
 * POST /api/resend-verification-by-email —— **匿名**重发确认邮件（Issue #197 后半段）。
 *
 * req  { email, deviceId }
 * res  200 { alreadyVerified:false, emailMask, verifySent, verifyTransport }
 *      200 { alreadyVerified:true,  emailMask, verifySent:false }
 *      400 { code:"E_EMAIL_FORMAT" }
 *      429 { code:"E_RATE_EMAIL|E_RATE_DEVICE|E_RATE_IP|E_RATE_GLOBAL", retryAfter }
 *      503 { code:"E_NOT_CONFIGURED" }
 *
 * ## 它与 `/api/resend-verification`（要登录）的分工
 * 「没确认就不让登录」这条口径一落，要登录那条路上就出现了一个死结：
 * **最需要重发那封信的人恰恰是登不进来的人**。
 * 所以那封信必须有一条匿名可用的路 —— 就是这一条。
 * 要登录那条仍然留着（个人中心里那颗「重发确认邮件」），两条各自说清各自的身份。
 *
 * ## ⚠️ 这是全站唯一一条「不登录也能让本站往外发信」的接口
 * 因此：频控四层 + 冷却，并且**无论邮箱存在与否、确认与否，
 * 响应形状完全相同**（`alreadyVerified` 除外，而它只有在「这个邮箱
 * 确实注册过且已确认」时才为真 —— 那种人本来就能用登录那条路自证身份）。
 * 「发信商没配好」这一格也回同一个形状：那是**服务器的公开事实**
 * （`/api/me` 的 `channel` 就自报它），不含任何关于这个邮箱的信息。
 *
 * Ref: docs/auth-design.md §4.4.9
 */
"use strict";

var handler = require("../../_lib/handler");

module.exports = handler.make("auth.resend-verification-by-email", ["POST"], function (d, body) {
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.resendVerificationByEmail(d, {
    email: body.email,
    value: body.value,
    deviceId: body.deviceId || d.deviceId,
    /* Issue #197 后续：人机校验的 token 必须**原样送到内核** —— 内核里
       `humanGuard` 读它（`turnstileToken` / `cf-turnstile-response` 两个名字都认）。
       ⚠️ 这一层只做「把参数送到」，**不判**校验过没过：
          判在服务端内核那一处（`core.humanGuard`），在这里再判一遍就是两处规则。 */
    turnstileToken: body.turnstileToken != null ? body.turnstileToken : body["cf-turnstile-response"],
    ip: d.ip
  });
});
