/**
 * GET /api/config —— 本站的**公开**配置（Issue #197 后续：人机校验）
 *
 * res 200 { turnstile: { enabled, siteKey }, mail: { delivered } }
 *
 * ## 为什么要有这一条，而不是把 siteKey 写死在 HTML 里
 *
 * Turnstile 的 `siteKey` 是**公开**的（它就是给浏览器渲染 widget 用的，
 * Cloudflare 的官方说法是「Site Key 可以公开」），但**公开不等于写死**：
 *   · 写死在 HTML 里 → 想换一个 key 就要改代码、重新部署
 *   · 更糟的是：**没配的实例**上也会有一个「假 siteKey」在页面上，
 *     而它渲染出来的 widget 一定失败 —— 页面于是成了一句假话
 *
 * 所以：siteKey 由服务端**如实下发**。没配就下发 `enabled:false` 且**不带 siteKey**，
 * 前端据此**一个字节都不发给 Cloudflare**（见 js/turnstile.js 的 mount）。
 *
 * ## 为什么这一条**不需要登录**
 *
 * 需要它的两页（`/login/`、`/reset/` 的前半段）里，用户**必然还没登录** ——
 * 要求登录才能拿到「要不要人机校验」这个答案，等于让登录页先登录一次。
 *
 * ## 因此这一条上**只有一个字段组**，而且刻意只有那一组
 *
 * ⚠️ **绝不**把 `/api/me` 的 `channel` 那种「这台服务器开通到哪一步」整份搬过来：
 *    那份东西里（`db` / `mail` / `rate`）描述的是**服务端的内部状态**，
 *    未登录的人没有理由看得见。这里下发的两件事都**只与「怎么把人机校验渲染出来」
 *    以及「发了信收不收得到」有关**，它们本来就写在登录页上（「发信商没配好」那句话）。
 * ⚠️ 它可以被**缓存**（30 秒）：这几项在一次冷启动内不会变，
 *    而这一条是全局唯一一个匿名可打的读接口 —— 不加缓存等于给了一个
 *    「随口一问就让服务端过一遍配置」的免费放大口。短缓存把它按住。
 *
 * Ref: docs/auth-design.md §4.4.12
 */
"use strict";

var handler = require("./_lib/handler");

module.exports = handler.make("config", ["GET"], function (d) {
  var cfg = d.cfg;
  /* 人机校验到底开没开 —— 判据**只有一处**（`turnstile.turnstileReady`）。
     ⚠️ 没开时**连 `siteKey` 这个键都不给**：给一个空串会让前端
        「配了但错了」与「压根没配」长得一样，而这两件事的界面表现不同。 */
  var enabled = handler.core.turnstileReady(cfg);
  var turnstile = { enabled: enabled };
  if (enabled) turnstile.siteKey = String(cfg.turnstileSiteKey || "");

  var out = {
    turnstile: turnstile,
    /* 发信商配好了没有 —— 登录页那句「这台服务器现在收不到信」需要它，
       而那句话要**在用户填完邮箱之前**就能说（他不必先发一次码才知道）。 */
    mail: { delivered: String(cfg.mail ? cfg.mail() : "console") !== "console" }
  };

  return {
    status: 200,
    body: out,
    /* 30 秒：足够把「刷新页面刷配置」按住，又短到换 key 之后不用等太久。
       `no-store` 由 http.json 默认下 —— 这里显式覆盖成 public 短缓存。 */
    headers: { "Cache-Control": "public, max-age=30" }
  };
});
