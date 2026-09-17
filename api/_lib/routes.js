/**
 * 全部 API 路由的**唯一路由表**（Issue #205）
 * ==========================================================================
 * Vercel Hobby 档有一条硬上限：**一个部署最多 12 个 Serverless 函数**
 * （`No more than 12 serverless functions can be added to a deployment on the
 * hobby plan`）。issue #197（完整登录流程）与 #163（头像上云）之后，
 * `api/` 下已经长到 **19 个路由文件**，于是 Vercel 构建直接失败 ——
 * 而这**不是代码坏了**，是「一个文件 = 一个函数」这条目录约定撞上了档位上限。
 *
 * 解法是让**业务边界**与**部署形态**各归各位：
 * 业务仍然一个业务一个文件（放在 `api/_routes/`），但整个 `/api/*`
 * 只暴露成**一个函数**（`api/[...path].js`），`vercel.json` 一条 rewrite 兜住：
 *
 *     /api/me       →  /api/handler/me        （rewrite，外部地址一字不变）
 *     /api/sync/pull→  /api/handler/sync/pull
 *
 * 于是：
 *   · 函数数 **19 → 1**（Hobby 上限 12，留 11 个余量）；
 *   · 外部 URL **一个都没变**（客户端、文档、doctor 的 curl 全部照旧）；
 *   · 被测的仍然是 `api/_routes/me.js` 那一份 handler，测试与线上同形；
 *   · 部署档位将来若不是 Hobby，把 `vercel.json` 里那条 rewrite 去掉、
 *     把 `_routes/` 挪回 `api/` 即可 —— 一行业务代码不用改。
 *
 * ## 为什么放在 `api/_lib/`
 *
 * `api/_lib/` 下的文件**不会**被 Vercel 当成函数（下划线开头的目录是
 * 约定俗成的私有目录），所以放在这里的是「被 require 的代码」而不是「被
 * 部署的函数」—— 与 `core.js` / `store.js` 同一个位置。
 *
 * ## 为什么是一条**精确表**，不是自己拆路径拼 require
 *
 * 拼字符串 require 的两个下场：`GET /api/../../etc/passwd` 这类路径穿越，
 * 以及「线上能打到、测试里没有」的幽灵路由。这里是一张**逐字列出的表**，
 * 路径不在表里就是 404 —— 与「每个业务需求一个函数」那条纪律同源：
 * 多出来的入口必须是**显式**的。
 *
 * ⚠️ 这张表也是 `test/api.test.js` 的唯一来源：路由表不另抄一份
 *    （抄一份的下场是「线上加了接口、测试里没有」，或者反过来）。
 *    `test/api.test.js` 末节同时守着三件事：函数数 ≤ 12、rewrite 方向对、
 *    表里的每一条都指向一个真的存在、且导出 handler 的文件。
 *
 * Ref: docs/architecture.md §2.2（为什么后端只有这么多函数）、§4.21（头像）
 */
"use strict";

/**
 * 路由 = 文件的一一对应。
 *
 * 键是 `METHOD /path`（`/path` 不含 `/api` 前缀，与 Vercel 的目录约定同形），
 * 值是 handler 工厂模块的相对路径（都在 `api/_routes/` 下）——
 * **同一个文件可以挂多个方法**
 * （`/api/admin/grant` 与 `/api/family` 就是两个方法共用一个文件）。
 */
var ROUTES = {
  "POST /send-code": "./../_routes/send-code.js",
  "POST /verify-code": "./../_routes/verify-code.js",
  "GET /me": "./../_routes/me.js",
  /* Issue #197 后续（人机校验）：本站**公开**配置。它必须**匿名可打** ——
     需要它的两页（`/login/`、`/reset/`）上，用户必然还没登录。 */
  "GET /config": "./../_routes/config.js",
  "POST /sync/pull": "./../_routes/sync/pull.js",
  "POST /sync/push": "./../_routes/sync/push.js",
  "DELETE /account": "./../_routes/account.js",
  "POST /avatar": "./../_routes/avatar/index.js",
  "DELETE /avatar": "./../_routes/avatar/index.js",
  "GET /family": "./../_routes/family/index.js",
  "POST /family": "./../_routes/family/index.js",
  "POST /game/answer": "./../_routes/game/answer.js",
  "POST /admin/grant": "./../_routes/admin/grant.js",
  "DELETE /admin/grant": "./../_routes/admin/grant.js",
  "POST /admin/grants": "./../_routes/admin/grants.js",
  "POST /admin/accounts": "./../_routes/admin/accounts.js",
  /* Issue #197：完整登录流程（注册 / 口令登录 / 确认邮箱 / 重发确认 / 忘记密码两步） */
  "POST /register": "./../_routes/auth/register.js",
  "POST /login": "./../_routes/auth/login.js",
  "POST /verify-email": "./../_routes/auth/verify-email.js",
  "POST /resend-verification": "./../_routes/auth/resend-verification.js",
  "POST /resend-verification-by-email": "./../_routes/auth/resend-verification-by-email.js",
  "POST /reset-request": "./../_routes/auth/reset-request.js",
  "POST /reset-confirm": "./../_routes/auth/reset-confirm.js"
};

/** 路径前缀：`/api/handler/...` 里的 handler 那一段（见 vercel.json 的 rewrite） */
var PREFIX = "/api/handler";

/** 去重后的路径清单（一个文件挂两个方法时只出现一次） */
var PATHS = Object.keys(ROUTES).map(function (k) {
  return k.split(" ")[1];
}).filter(function (p, i, arr) {
  return arr.indexOf(p) === i;
});

/**
 * 把请求解析成一个 handler。
 *
 * @param {string} method  HTTP 方法（大小写不敏感）
 * @param {string} url     `req.url`（可能带查询串）
 * @returns {{path:string, handler:Function, methodAllowed:boolean}|null}
 *          · 命中：`{path, handler, methodAllowed}`
 *          · `methodAllowed === false`：**路径对、方法不对** ——
 *            交给那个路径的 handler 自己回 405（与「一个文件一个函数」时
 *            Vercel 的行为逐字一致：方法由 handler 判，不是路由判）。
 *          · 返回 `null`：这张表里没有这个路径 → 404
 */
function resolve(method, url) {
  var m = String(method || "GET").toUpperCase();
  var p = String(url || "").split("?")[0].split("#")[0];

  /* ⚠️ 先归一化**再**剥前缀。反过来的话 `//api//me` 这样的地址（重复斜杠，
     代理与浏览器都可能造出来）剥不掉前缀，于是变成一条表里没有的路径 ——
     症状是 404，而它会把人引去查「路由表是不是漏了一条」。 */
  var rest = p.replace(/\/+/g, "/");
  if (rest.charAt(0) !== "/") rest = "/" + rest;

  /* 线上进来时带 `/api/handler` 前缀（rewrite 后的地址）。测试里也走真
     HTTP，地址与线上一致；两种形状都认，避免「测试能过、线上 404」。 */
  if (rest === PREFIX) rest = "/";
  else if (rest.indexOf(PREFIX + "/") === 0) rest = rest.slice(PREFIX.length);
  else if (rest === "/api") rest = "/";
  else if (rest.indexOf("/api/") === 0) rest = rest.slice("/api".length);
  /* 末尾斜杠：`/api/me/` 与 `/api/me` 是同一条（与静态站的目录化路由同形） */
  if (rest.length > 1) rest = rest.replace(/\/+$/, "");
  if (rest === "") rest = "/";

  var hit = ROUTES[m + " " + rest];
  if (hit) return { path: rest, handler: require(hit), methodAllowed: true };

  /* 路径对、方法不对 → 找出这个路径上**任意一个**已注册的方法 */
  var any = Object.keys(ROUTES).filter(function (k) {
    return k.split(" ")[1] === rest;
  })[0];
  if (any) return { path: rest, handler: require(ROUTES[any]), methodAllowed: false };

  return null;
}

module.exports = {
  ROUTES: ROUTES,
  PATHS: PATHS,
  PREFIX: PREFIX,
  resolve: resolve
};
