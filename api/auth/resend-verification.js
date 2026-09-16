/**
 * POST /api/resend-verification —— 重发确认邮件（Issue #197）。
 *
 * req  { deviceId }      ← 会话在 Cookie 里，**要登录**
 * res  200 { alreadyVerified:false, emailMask, verifySent, verifyTransport }
 *      200 { alreadyVerified:true,  emailMask, verifySent:false }
 *      401 / 429 / 503 同其它接口
 *
 * 为什么这一条**要登录**、而 `verify-email` 不要：
 *   确认邮箱是「点开邮件」这件事（不需要身份）；
 *   重发确认邮件是「我要往我这个邮箱再发一封」——那必须有身份，
 *   否则任何人都能拿别人的邮箱刷确认邮件（而发信是真金白银的）。
 *
 * ⚠️ 已经确认过时**如实回 alreadyVerified:true 且不再发信**。
 *    发一封「你的邮箱已确认」没有意义，而它还会让「重发」这颗按钮
 *    看起来永远有用（用户会一直点）。
 *
 * Ref: docs/auth-design.md §4.4
 */
"use strict";

var handler = require("../_lib/handler");

module.exports = handler.make("auth.resend-verification", ["POST"], function (d, body) {
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.resendVerification(d, {
    deviceId: body.deviceId || d.deviceId
  });
});
