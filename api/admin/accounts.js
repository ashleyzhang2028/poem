/**
 * POST /api/admin/accounts —— 列出**全部账号**（只读，Issue #197）。
 *
 * 为什么是 POST 而不是 GET：与 `/admin/grants` 同一条 —— 名单不长在查询串上
 * （邮箱是身份信息，查询串会进各级访问日志与 Referer）。
 *
 * req  {} （会话在 Cookie 里）
 * res  200 { accounts:[{email,emailMask,nickname,tier,role,status,emailVerified,
 *                       hasPassword,createdAt,lastLoginAt}], total, store }
 *     401 / 403 / 503 同 /api/admin/grant
 *
 * 四条边界（`core.adminAccounts` 里逐条写着）：
 *   ① 角色闸在服务端：不是 owner / admin 一律 403（界面上藏入口不是安全边界）
 *   ② **绝不回** `password_hash` / `password_salt`
 *   ③ **绝不回** `email_hash`（那是登录标识，泄出去等于可查询「谁是本站用户」）
 *   ④ 不回进度 / 会话 / 确认令牌
 *
 * ⚠️ 这一条**回明文邮箱** —— 那正是它存在的理由（用户原话「我还是要看到这些用户」，
 *    而掩码 `a***@qq.com` 认不出是谁）。它与「只回掩码」的 `/admin/grants`
 *    是两条不同的接口：一条是**台账**（发过什么），一条是**名录**（都有谁）。
 *    把两条合成一条的下场是：要么台账里泄出明文，要么名录里认不出人。
 *
 * Ref: docs/auth-design.md §4.4、docs/architecture.md §4.14
 */
"use strict";

var handler = require("../_lib/handler");

module.exports = handler.make("admin.accounts", ["POST"], function (d) {
  if (d.cfg && !d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.adminAccounts(d);
});
