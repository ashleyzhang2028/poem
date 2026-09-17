/**
 * POST /api/admin/grants —— 列出**服务端权威名单**（只读，2.2）
 *
 * 为什么是 POST 而不是 GET：名单不长在查询串上（掩码是身份信息，
 * 查询串会进各级访问日志与 Referer），而且这一条与 `/admin/grant` 同属
 * 一组「只有管理员能问」的入口，用同一个方法省掉一半的方法校验分支。
 *
 * req  {} （会话在 Cookie 里）
 * res  200 { grants:[{emailMask, tier, until}], store }
 *     401 / 403 / 503 同 /api/admin/grant
 *
 * ⚠️ **只回掩码**，绝不回 `email_hash` 或明文邮箱：掩码是给人看的，
 *    摘要泄出去等于把「这个人是不是本站用户」变成可查询的事实。
 * ⚠️ 只列 `plan !== "free"` 的那些行 —— 那才是「发过东西」的记录。
 *    把全部账号倒出来不是这一页要做的事（那是「用户列表」，本项目没有它）。
 *
 * Ref: docs/architecture.md §4.14
 */
"use strict";

var handler = require("../../_lib/handler");

module.exports = handler.make("admin.grants", ["POST"], function (d) {
  if (d.cfg && !d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.adminGrants(d);
});
