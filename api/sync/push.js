/**
 * POST /api/sync/push —— 按条合并写回云端进度。
 *
 * req  { recs:[{id,payload,updatedAt,deleted}], deviceId }
 * res  200 { applied, conflicts:[], serverTime }
 *     400 { code:"E_BAD_REC" }   有记录缺 id 或时间戳
 *     401 { code:"E_NO_SESSION" }
 *     413 { code:"E_TOO_MANY" }  一次超过 2000 条
 *     429 { code:"E_RATE_DEVICE", retryAfter }
 *
 * ⚠️ 载荷**白名单化**（core.sanitizePayload）：客户端推上来的是不可信数据，
 *    只收背诵档案认识的字段，长度与数值范围都卡死 —— 否则一个坏客户端
 *    能把免费档的流量刷爆（docs §4.3 第 3 条）。
 * ⚠️ 时间戳老的盖不掉新的；判不了来源的冲突回 `conflicts`，
 *    由客户端弹「保留本机 / 保留账号 / 先导出再决定」（docs §4.4 D 项）。
 *
 * Ref: docs/architecture.md §4.3、§4.4
 */
"use strict";

var handler = require("../_lib/handler");

module.exports = handler.make("sync.push", ["POST"], function (d, body) {
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.syncPush(d, {
    recs: body.recs,
    deviceId: body.deviceId || d.deviceId
  });
});
