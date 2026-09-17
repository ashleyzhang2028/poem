/**
 * POST /api/verify-email —— 确认邮箱（Issue #197）。
 *
 * req  { vid, token }    ← 两个都来自邮件里那条链接
 * res  200 { verified:true, email, emailMask }
 *      400 { code:"E_NO_TOKEN|E_TOKEN_INVALID|E_TOKEN_USED|E_TOKEN_EXPIRED" }
 *      503 { code:"E_NOT_CONFIGURED" }
 *
 * 三条口径：
 *   1. **不要求登录**：用户可能是在另一台设备上点开邮件的。要求登录
 *      会让「在手机上注册、在电脑上收信」这件事彻底走不通。
 *   2. **令牌是长随机数**（32 字节 = 256 位），所以「猜」不在威胁模型里；
 *      威胁模型是**重放**与**过期**，两条各有一个判据（consumed_at / expires_at）。
 *   3. **只把 `pending` 提成 `active` 这一个方向**：`suspended` / `locked`
 *      是别的原因，确认邮箱不该把它们解开（顺手解开 = 封掉的号点一下邮件就复活）。
 *
 * ⚠️ 这一条**不发会话**：确认邮箱不是登录。用户确认完回到登录页，
 *    用他注册时设的口令登进来 —— 两件事分开，界面才说得清发生了什么。
 *
 * Ref: docs/auth-design.md §4.4
 */
"use strict";

var handler = require("../../_lib/handler");

module.exports = handler.make("auth.verify-email", ["POST"], function (d, body) {
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.verifyEmail(d, {
    vid: body.vid,
    token: body.token
  });
});
