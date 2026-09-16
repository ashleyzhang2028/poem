/**
 * POST /api/reset-confirm —— 忘记密码第二步：真正把口令换掉（Issue #197）。
 *
 * req  { rid, token, password, deviceId }
 * res  200 { reset:true, emailMask, sessionsRevoked:true }
 *      400 { code:"E_NO_TOKEN|E_TOKEN_INVALID|E_TOKEN_USED|E_TOKEN_EXPIRED|E_PW_SHORT|E_PW_EMPTY|E_PW_LONG" }
 *      429 / 503 同其它接口
 *
 * 四条一次做齐（少一条都是半截功能）：
 *   ① 令牌校验（形状 / 过期 / 重放 / 定长比较）
 *   ② 口令形状校验（与注册**同一处** `checkPassword`，不是两套规则）
 *   ③ 写新摘要（新盐、新 scrypt 参数写进串里）
 *   ④ **吊销全部会话** —— 这才是「重设密码」真正的安全含义：
 *      密码被换，说明原来那个**可能已经泄露**，所有拿旧会话进来的人都得出去。
 *
 * ⚠️ 第 ④ 条不许省。省掉的下场是「用户改了密码，但偷到 Cookie 的人还在里面」——
 *    而那是最需要改密码的那一种情形。
 * ⚠️ 这一条**不顺手确认邮箱**：能收到重设邮件不等于邮箱已确认
 *    （下一次改主邮箱时会出错）。两件事各写各的。
 *
 * Ref: docs/auth-design.md §4.4、§6.4
 */
"use strict";

var handler = require("../_lib/handler");

module.exports = handler.make("auth.reset-confirm", ["POST"], function (d, body) {
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.resetConfirm(d, {
    rid: body.rid,
    token: body.token,
    password: body.password,
    deviceId: body.deviceId || d.deviceId
  });
});
