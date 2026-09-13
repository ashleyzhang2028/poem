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

  function boot() {
    if (!window.ReaderEngine) return;
    var all = window.POEMS_GUWEN || window.GUWEN_ALL || [];
    if (!all.length) {
      var listEl = document.querySelector('[data-gw="list"]');
      if (listEl) listEl.innerHTML = '<div class="empty">古文观止数据加载失败</div>';
      return;
    }

    window.ReaderEngine.mount({
      id: "guwen",
      items: all,
      root: "[data-gw-root]",
      reader: "#gw-reader",
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
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
