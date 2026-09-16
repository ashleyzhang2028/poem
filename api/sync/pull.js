/**
 * POST /api/sync/pull —— 增量拉云端进度。
 *
 * req  { since, deviceId, child }
 * res  200 { recs:[{id,payload,updatedAt,deleted}], serverTime }
 *     401 { code:"E_NO_SESSION" }
 *     429 { code:"E_RATE_DEVICE", retryAfter }
 *
 * ⚠️ `since` 是**服务端时间**游标（上一次响应里的 serverTime），
 *    不是客户端自己的修改时间 —— 用客户端时钟会拖出「永远拉不到 / 拉到重复」。
 * ⚠️ 这是方案 B（进度上云，docs §4.2）的读端。
 *
 * Ref: docs/architecture.md §4.3、§4.4
 */
"use strict";

var handler = require("../_lib/handler");

module.exports = handler.make("sync.pull", ["POST"], function (d, body) {
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.syncPull(d, {
    since: body.since,
    deviceId: body.deviceId || d.deviceId,
    /* 子档案（5.3 跨设备分档案）：空串 = 第一个孩子那一份 —— 不传就是它，
       于是**老客户端**（不认识 child）的行为与分家之前逐字相同。 */
    child: body.child
  });
});
