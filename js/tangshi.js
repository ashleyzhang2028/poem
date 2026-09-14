/**
 * 唐诗三百首（/tangshi/ · 301 首）
 * ==========================================================================
 * 这个文件与小古文的 js/classic.js 一样薄：它只做三件事 ——
 *   1. 把《唐诗三百首》这**一部集子**的配置交给 js/reader-core.js 的
 *      ReaderEngine.mount()：数据、卷次顺序、文案、已读存的键名。
 *   2. 「已读」进度由引擎统一维护；本页不再自己管 localStorage。
 *   3. 卷次分组靠 gradeGroup 字段（卷一 五言古诗 …… 卷八 七言绝句）。
 *
 * 为什么分组顺序要在这里显式写出：
 *   引擎按 config.groupOrder 排序，而不是照数组出场顺序 —— 数据文件里
 *   本来就是按卷次排的，但把顺序写出来，日后增删卷次或调整数据顺序时，
 *   列表的分组不会跟着乱。
 *
 * ⚠️ 唐诗与小古文**各存各的已读**（poem_tangshi_read_v1 / poem_classic_read_v1）：
 *    读唐诗点亮的「已读」不该混进小古文的进度。字号与对齐则是全站共用的一份
 *    阅读偏好（在唐诗里调大了字号，翻到小古文不该又变回去）——
 *    这一条由引擎负责，见 js/reader-core.js。
 */
(function () {
  "use strict";

  /** 卷次顺序：卷一至卷八，按选本的编排次第 */
  var GROUP_ORDER = [
    "卷一 五言古诗",
    "卷二 七言古诗",
    "卷三 五言乐府",
    "卷四 七言乐府",
    "卷五 五言律诗",
    "卷六 七言律诗",
    "卷七 五言绝句",
    "卷八 七言绝句"
  ];

  /**
   * 这一部的**挂载配置**（不含数据与 DOM 根）。
   *
   * 单独拎出来，是因为同一部集子有两个入口：
   *   1. 直接打开 /tangshi/（本文件末尾的 boot()）；
   *   2. 在课外阅读入口页 /library/ 里点「唐诗三百首」，把这一部的索引
   *      **就地**铺上来（见 js/library.js 的 enterBook）。
   * 两处必须挂**同一份配置** —— 分组的卷次顺序、页名、文案、已读键名
   * （poem_tangshi_read_v1）一个都不能不一样。各写一份的话，
   * 迟早出现「从 /tangshi/ 进去显示 301 首、从 /library/ 进去只显示 250 首」
   * 这类「同一部集子两个样子」的病，而且最难查（两处都「看起来对」）。
   */
  function bookConfig() {
    return {
      id: "tangshi",
      groupOrder: GROUP_ORDER,
      pageTitle: "唐诗三百首",
      pageSub: "想读哪首点哪首",
      words: {
        list: "唐诗",
        unit: "首",
        loadingFailed: "唐诗数据加载失败",
        empty: "没有匹配的唐诗",
        matchGroup: "唐诗三百首",
        backToList: "返回唐诗列表",
        readStore: "poem_tangshi_read_v1",
        playerTitle: "唐诗朗读",
        searchPlaceholder: "搜索诗题 / 出处 / 作者"
      }
    };
  }

  function boot() {
    if (!window.ReaderEngine) return;
    var all = window.POEMS_TANGSHI || window.TANGSHI_ALL || [];
    if (!all.length) {
      var listEl = document.querySelector('[data-gw="list"]');
      if (listEl) listEl.innerHTML = '<div class="empty">唐诗数据加载失败</div>';
      return;
    }

    var cfg = bookConfig();
    cfg.items = all;
    cfg.root = "[data-gw-root]";
    cfg.reader = "#gw-reader";
    window.ReaderEngine.mount(cfg);
  }

  /* 课外阅读入口页（/library/）就地铺这一部时用它取数据与配置 */
  window.TangshiBook = {
    config: bookConfig,
    items: function () { return window.POEMS_TANGSHI || window.TANGSHI_ALL || []; }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
