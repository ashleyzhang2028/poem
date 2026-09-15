/**
 * POST   /api/admin/grant —— **服务端权威发放层级**（2.2）
 * DELETE /api/admin/grant —— 收回（等价于发一个 free，不删账号、不删进度）
 *
 * req  { emailMask, tier, until }        （DELETE 只要 { emailMask }）
 * res  200 { matched, changed, uid?, tier, until, note }
 *     400 { code:"E_TIER" | "E_MASK" | "E_UNTIL" }
 *     401 { code:"E_NO_SESSION" }
 *     403 { code:"E_FORBIDDEN" }         ← 有会话但角色不是 owner / admin
 *     429 { code:"E_RATE_DEVICE", retryAfter }
 *     503 { code:"E_NOT_CONFIGURED" }
 *
 * ⚠️ 这是本项目**第一条能改别人数据的写接口**。三条硬口径（docs §3.5）：
 *
 *   1. **角色闸在服务端** —— `accounts.role` 是 owner / admin 才放行。
 *      客户端的入口藏没藏起来**不是**安全边界：直接的 HTTP 请求照样打得到这里。
 *   2. **只认掩码，不认明文邮箱** —— 库里本来就不存明文（§2.4 第 1 条），
 *      也不在这里自己掩一次（那会给掩码规则造出第二份实现）。
 *   3. **命中 0 条不是错误** —— 如实回 `matched:0`。本方案里对方**先登录一次**
 *      才会在库里留下一行，管理员才可能拿到他的掩码。见 `core.adminGrant`。
 *
 * ⚠️ 与「本机名单」（`poem_plan_grant_v1`）是两件事：那一份是
 *    「手工发邀请码的本机版」，改一行存储就能改；这一条才是权威。
 *    两者**不自动同步**，界面上必须说清（/admin/ 页那句提示）。
 *
 * Ref: docs/architecture.md §4.14、docs/auth-design.md §3.5
 */
"use strict";

var handler = require("../_lib/handler");

module.exports = handler.make("admin.grant", ["POST", "DELETE"], function (d, body, req) {
  if (d.cfg && !d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  var method = String((req && req.method) || "POST").toUpperCase();
  if (method === "DELETE") {
    return handler.core.adminRevoke(d, { emailMask: body.emailMask || body.mask, deviceId: body.deviceId || d.deviceId });
  }
  return handler.core.adminGrant(d, {
    emailMask: body.emailMask || body.mask,
    tier: body.tier,
    until: body.until,
    deviceId: body.deviceId || d.deviceId
  });
});
