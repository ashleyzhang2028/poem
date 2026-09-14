/**
 * 古文观止（/guwen/）
 * ==========================================================================
 * 这个文件与小古文的 js/classic.js、唐诗的 js/tangshi.js 一样薄：它只做三件事 ——
 *   1. 把《古文观止》这**一部集子**的配置交给 js/reader-core.js 的
 *      ReaderEngine.mount()：数据、卷次顺序、文案、已读存的键名。
 *   2. 「已读」进度由引擎统一维护；本页不再自己管 localStorage。
 *   3. 卷次分组靠 gradeGroup 字段（卷一 周文 …… 卷十二 明文）。
 *
 * 为什么分组顺序要在这里显式写出：
 *   引擎按 config.groupOrder 排序，而不是照数组出场顺序 —— 数据文件里
 *   本来就是按卷次排的，但把顺序写出来，日后增删卷次或调整数据顺序时，
 *   列表的分组不会跟着乱。
 *
 * ⚠️ 古文观止与小古文、唐诗**各存各的已读**（poem_guwen_read_v1 /
 *    poem_classic_read_v1 / poem_tangshi_read_v1）：读古文点亮的「已读」
 *    不该混进别的集子。字号与对齐则是全站共用的一份阅读偏好（在古文里调大了
 *    字号，翻到唐诗不该又变回去）—— 这一条由引擎负责，见 js/reader-core.js。
 */
(function () {
  "use strict";

  /** 卷次顺序：按选本篇次，先列《古文观止》十二卷 */
  var GROUP_ORDER = [
    "卷一 周文",
    "卷二 周文",
    "卷三 周文",
    "卷四 秦文",
    "卷五 汉文",
    "卷六 汉文",
    "卷七 六朝唐文",
    "卷八 唐文",
    "卷九 唐宋文",
    "卷十 宋文",
    "卷十一 宋文",
    "卷十二 明文"
  ];

  /**
   * 这一部的**挂载配置**（不含数据与 DOM 根）。
   *
   * 单独拎出来，是因为同一部集子有两个入口：
   *   1. 直接打开本页（下面的 boot()）；
   *   2. 在课外阅读入口页 /library/ 里点开这一部，把索引**就地**铺上来
   *      （见 js/library.js 的 enterBook）。
   * 两处必须挂**同一份配置**：分组顺序、页名、文案、已读键名（poem_guwen_read_v1）
   * 一个都不能不一样 —— 各写一份迟早出现「同一部集子两个样子」的病
   * （从这一页进去显示 N 篇、从入口页进去少几篇），而且两处都「看起来对」，最难查。
   */
  function bookConfig() {
    return {
      id: "guwen",
      groupOrder: GROUP_ORDER,
      pageTitle: "古文观止",
      pageSub: "想读哪篇点哪篇",
      words: {
        list: "古文",
        unit: "篇",
        loadingFailed: "古文观止数据加载失败",
        empty: "没有匹配的古文",
        matchGroup: "古文观止",
        backToList: "返回古文列表",
        // 目录里尚未整理正文 / 译文的那些篇目：点开是说清楚，不是白屏
        pendingText: "本篇原文尚在整理中",
        pendingTranslation: "本篇白话译文尚在整理中",
        readStore: "poem_guwen_read_v1",
        playerTitle: "古文朗读",
        searchPlaceholder: "搜索篇名 / 出处 / 作者"
      }
    };
  }

  function boot() {
    if (!window.ReaderEngine) return;
    var all = window.POEMS_GUWEN || window.GUWEN_ALL || [];
    if (!all.length) {
      var listEl = document.querySelector('[data-gw="list"]');
      if (listEl) listEl.innerHTML = '<div class="empty">古文观止数据加载失败</div>';
      return;
    }

    var cfg = bookConfig();
    cfg.items = all;
    cfg.root = "[data-gw-root]";
    cfg.reader = "#gw-reader";
    window.ReaderEngine.mount(cfg);
  }

  /* 课外阅读入口页（/library/）就地铺这一部时用它取数据与配置 */
  window.GuwenBook = {
    config: bookConfig,
    items: function () { return window.POEMS_GUWEN || []; }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
