/**
 * GET / POST /api/family —— 子档案名册（跨设备分档案，Issue #159 · todo.md 第 4 条）。
 *
 * GET  200 { family:{v,at,profiles:[]}, updatedAt, serverTime }
 *      401 { code:"E_NO_SESSION" }
 *      503 { code:"E_NOT_CONFIGURED" }（没配 SESSION_SECRET）
 * POST 200 { family:{...}, serverTime }
 *      403 { code:"E_TIER" }（跨设备云同步要 Pro 起 —— 与 /api/sync/* 同一把闸）
 *      429 { code:"E_RATE_DEVICE", retryAfter }
 *
 * ## 为什么它自己一个接口，而不是并进 /api/sync/*
 *
 * 名册是**账号级**的（`child_id = ''`），进度是**每个孩子一份**的。
 * 并进 sync/pull 的下场是「拉进度的时候顺手把名册也拉了」——
 * 看着省一个请求，但两者的更新时机完全不同：名册只在**建/删/改名**时变，
 * 进度每次背完都变。混在一个游标下的症状是
 * 「新建的孩子要等到下一次背完才在另一台设备上出现」。
 *
 * `GET` 与 `POST` 在同一个文件里：Vercel 的路由按文件路径进 handler，
 * 方法由 handler 自己判（与 `/api/admin/grant` 同款）。
 *
 * Ref: docs/architecture.md §5.3
 */
"use strict";

var handler = require("../../_lib/handler");

module.exports = handler.make("family", ["GET", "POST"], function (d, body, req) {
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  if (String((req && req.method) || "GET").toUpperCase() === "POST") {
    return handler.core.familyPut(d, { family: body.family, deviceId: body.deviceId || d.deviceId });
  }
  return handler.core.familyGet(d);
});
