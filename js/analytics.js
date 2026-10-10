/* 站点事件上报（Issue #535）
   ---------------------------------------------------------------------------
   GA 的 base tag 只管 page_view（哪些页面被打开）。她真正想知道的不是那个，
   是**人在这里做了什么**：连读键按了没有、从哪个集子切到哪个集子。

   这个模块只做三件事，不多做：

     1. `track(name, params)` —— 往 gtag 送一条事件。gtag 不在（脚本被拦、
        走的不是 GA 那页）就静默丢掉，**绝不因为统计挂了影响功能**。
     2. 事件名与参数名的白名单归一 —— 见下面。名字写错、参数塞多了，在这里
        就被截掉，不要把杂物送进 GA（GA 那边看不清、还占配额）。
     3. `defer` —— 事件在 `DocumentFragment` 里发不出来（`closest` 挂不上），
        用这个兜一下。见"列表行的三颗小按钮"那一段。

   ⚠️ 有意**不做**的：不存队列、不重试、不做本地缓存。统计是"顺手记一笔"，
   不是账本 —— 攒着等人回来再补发，反而会把"什么时候真的做了这件事"记歪。
   =========================================================================== */
(function () {
  "use strict";

  var GONE = false;

  function raw() {
    if (GONE) return null;
    if (typeof window.gtag !== "function") return null;
    return window.gtag;
  }

  /* 参数字典。只收这几把钥匙。
     ------------------------------------------------------------------------
     · source  —— 「从哪里按的」：`all` / `group`（分类卡片那颗）/ `book`（顶上那颗）
     · book    —— 集子 id（classic / tangshi / …），与 js/library.js 的 ENTRIES 同源
     · gradeGroup —— 分类卡上的分类名（蒙学经典 / 诸子论道…）
     · mode    —— 连读模式 id，与 js/play-modes.js 的 LIST 同源（seq-origin…）
     · source_view —— 播放的是原文还是译文（原文 / 译文 / 原文+译文）
     · item_count —— 这一次连读排了多长的队
     · direction —— prev / next
     · collection —— 自选集合 id
     · filter  —— 列表的筛选（all / unread）
     · query_length —— 只在本地算长度，**不把搜索词本身送出去**
     ------------------------------------------------------------------------ */
  var PARAM_KEYS = [
    "source", "book", "gradeGroup", "mode", "source_view",
    "item_count", "direction", "collection", "filter", "query_length"
  ];

  function clean(params) {
    var out = {};
    if (!params) return out;
    for (var i = 0; i < PARAM_KEYS.length; i++) {
      var k = PARAM_KEYS[i];
      var v = params[k];
      if (v === undefined || v === null || v === "") continue;
      /* 统计参数一律当字符串送：GA 里混着数字与字符串会让同一维裂成两列。 */
      out[k] = String(v);
    }
    return out;
  }

  function track(name, params) {
    var g = raw();
    if (!g) return false;
    if (!name || typeof name !== "string") return false;
    try {
      g("event", name, clean(params));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* 页面路径上能读到的「这一页是什么集子」。
     ------------------------------------------------------------------------
     用途只有一个：阅读器里打开的**这一篇属于哪一部**。集子页在自己的 cfg
     里给了 `id`（reader-core 认），但几处调用点（大慧、搜索页、进度页）没有
     那个 cfg，靠路径兜底最省事 —— 路径是静态的，不会因为配置缺失而算不出来。 */
  function pageOf(pathname) {
    var p = String(pathname || (typeof location !== "undefined" ? location.pathname : "") || "");
    p = p.replace(/\/index\.html$/, "/");
    var m = p.match(/^\/([a-z0-9-]+)\/?$/);
    if (!m) return "";
    var seg = m[1];
    var KNOWN = ["poems", "classic", "guwen", "yuefu", "tangshi", "gushi", "songci",
      "yuanqu", "jinxiandai", "zhaoming", "chengyu", "changshi", "mingshu",
      "mingren", "mingren-waiguo", "dwang", "dwang-waiguo", "search", "library"];
    return KNOWN.indexOf(seg) > -1 ? seg : "";
  }

  /* 事件发生在 `DocumentFragment` 里时，`closest` 从元素往上走到片段就断了 ——
     作者索引第二层（`js/reader-core.js` 里 `#gw-list` 那段）正是把行先拼进
     片段、再一次性贴进 DOM 的：点击落在那片段里的按钮上时，`.group-head`
     往上找不到，「顶上的连读键」与「分类卡上的连读键」就分不出来。
     点完马上就贴进 DOM 了，所以让事件先滑一步，再照常往上找。 */
  var pending = [];
  function defer(fn) {
    if (typeof fn !== "function") return;
    pending.push(fn);
    if (pending.length > 1) return;
    if (typeof queueMicrotask === "function") queueMicrotask(flush);
    else if (typeof setTimeout === "function") setTimeout(flush, 0);
    else flush();
  }

  function flush() {
    var list = pending;
    pending = [];
    for (var i = 0; i < list.length; i++) {
      try {
        list[i]();
      } catch (e) {
        /* 统计的错不许冒出去 */
      }
    }
  }

  window.Analytics = {
    track: track,
    pageOf: pageOf,
    defer: defer
  };
})();
