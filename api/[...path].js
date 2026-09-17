/**
 * `/api/*` 的**唯一入口**（Issue #205）
 * ==========================================================================
 * Vercel Hobby 档硬上限：一个部署最多 **12 个 Serverless 函数**。Issue #197
 * （完整登录流程）与 #163（头像上云）之后 `api/` 下有 **19 个路由文件**，
 * 构建报的是：
 *
 *     No more than 12 serverless functions can be added to a deployment on the
 *     hobby plan
 *
 * 这里把 19 个函数收成 **1 个**：`vercel.json` 用一条 rewrite 把
 * `/api/*` 转到 `/api/handler/*`，本文件按 `api/_lib/routes.js` 那张
 * **唯一的表**把请求交给 `api/_routes/me.js` 那样的真 handler。
 *
 * ## 三条不可退让的口径
 *
 * 1. **外部地址一字不变** —— `/api/me`、`/api/sync/push`、Cookie 的 Path
 *    全部照旧，客户端与文档不需要知道这次改动。
 * 2. **handler 还是原来那一份** —— 会话、错误兜底、日志、405 全在各自的
 *    `handler.make()` 里，这里**不做任何业务判断**，只是一次转发。
 * 3. **不拆字符串拼 require** —— 路径命中 `routes.js` 那张精确表才放行，
 *    否则 404（拼路径的下场是路径穿越与幽灵路由）。
 *
 * ⚠️ 文件名 `[...path].js` 是 Vercel 的 **catch-all 动态路由**语法。
 *    只有它、和 `_` 开头的目录（`_lib/` / `_routes/`）在 `api/` 下 ——
 *    也就是说这个部署里的 Serverless 函数**数得出 1 个**，而那条硬上限
 *    （12）从此离得很远。**将来谁想在 `api/` 下直接加一个 `.js`**，
 *    `test/api.test.js` 末节那条断言会立刻变红 —— 它就是为这一件事写的。
 *
 * Ref: docs/architecture.md §2.2 / §2.2.1（函数数与纪律）、§4.3（接口契约）
 */
"use strict";

var routes = require("./_lib/routes.js");
var H = require("./_lib/http.js");

module.exports = function (req, res) {
  var hit = routes.resolve(req.method, req.url);
  if (!hit) {
    /* 表里没有这条路径 —— 与「一个文件一个函数」时 Vercel 的行为一致：
       404，而不是 500，也不把内部细节说出去。 */
    return H.json(res, 404, { code: "E_404", message: "没有这个接口。" });
  }
  return hit.handler(req, res);
};
