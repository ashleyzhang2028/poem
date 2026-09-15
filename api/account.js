/**
 * DELETE /api/account —— 注销：先导出、再删行。
 *
 * req  { confirm:true, deviceId }
 * res  200 { deleted:true, export:{...}, note }  + Set-Cookie: kbsid= (清空)
 *     400 { code:"E_CONFIRM" }
 *     401 { code:"E_NO_SESSION" }
 *     429 { code:"E_RATE_DEVICE", retryAfter }
 *
 * ⚠️ 注销是合规硬要求（删除权 + 可携带权，docs §4.2 第 3 条）。
 *    本期**不返回 exportUrl** —— 没有对象存储放导出文件，
 *    数据直接随响应回，用户自己存。假装有个下载链接比不做更糟。
 * ⚠️ 明确不影响本机进度：本机那一份由前端自己导出，且始终是完整副本
 *    （docs §1.3「supabase 里的进度永远不是唯一副本」）。
 *
 * Ref: docs/architecture.md §4.2、§4.3
 */
"use strict";

var handler = require("./_lib/handler");

module.exports = handler.make("account", ["DELETE"], function (d, body) {
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.accountDelete(d, {
    confirm: body.confirm === true,
    deviceId: body.deviceId || d.deviceId
  });
});
