/**
 * POST /api/resend-verification —— 重发确认邮件（Issue #197）。
 *
 * req  { email?, deviceId? }    ← **两条入口**
 *      · 有会话（Cookie）→ 认会话里的 uid（这是「你自己」的事）
 *      · 没会话但带了 `email` → 匿名口（用户裁了「不确认就不让登录」之后
 *        它是**唯一的出路**：登不进来的人也得能再要一封确认邮件）
 * res  200 { requested:true, alreadyVerified, emailMask?, verifySent, verifyTransport? }
 *      400 { code:"E_EMAIL_FORMAT" }  ← 匿名口邮箱形状不对
 *      401 / 429 / 503 同其它接口
 *
 * ## ⚠️ 匿名口是**全站唯一**「不登录也能让本站往外发信」的接口
 *
 * 所以四条闸都上了（见 `core.resendVerification`）：
 *   频控四层（邮箱 / 设备 / IP / 全局）+ 70 秒冷却 +
 *   **存在与否与已确认与否回话逐字相同**（否则它就是邮箱枚举口）+ 已确认的不发信。
 *
 * ## 为什么它**不再要求登录**
 *
 * 原先这一条挂着 401。那是「确认邮件只在个人中心重发」时的正确设计，
 * 但在「不确认就不让登录」这条口径下它是一个**死结**：
 * 没确认的人登不进来 → 进不了个人中心 → 发不出确认邮件。
 * 用户（和运维）被锁在门外而屏幕上没有任何可点的东西。
 *
 * Ref: docs/auth-design.md §4.4
 */
"use strict";

var handler = require("../../_lib/handler");

module.exports = handler.make("auth.resend-verification", ["POST"], function (d, body) {
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.resendVerification(d, {
    email: body.email,
    value: body.value,
    deviceId: body.deviceId || d.deviceId,
    /* Issue #197 后续：人机校验的 token 必须**原样送到内核** —— 内核里
       `humanGuard` 读它（`turnstileToken` / `cf-turnstile-response` 两个名字都认）。
       ⚠️ 这一层只做「把参数送到」，**不判**校验过没过：
          判在服务端内核那一处（`core.humanGuard`），在这里再判一遍就是两处规则。 */
    turnstileToken: body.turnstileToken != null ? body.turnstileToken : body["cf-turnstile-response"],
    /* ⚠️ 出口 IP 必须传下去 —— 这一条以前只按设备档记账，
       deviceId 是客户端自己给的，每天换一个就绕过了。 */
    ip: d.ip
  });
});
