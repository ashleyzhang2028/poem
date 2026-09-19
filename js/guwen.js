(function () {
  "use strict";

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

  function bookConfig() {
    return {
      id: "guwen",
      groupOrder: GROUP_ORDER,
      pageTitle: "古文观止",
      pageSub: "十二卷 · 自周文至明文",
      words: {
        list: "古文",
        unit: "篇",
        loadingFailed: "古文观止数据加载失败",
        empty: "没有匹配的古文",
        matchGroup: "古文观止",
        backToList: "返回古文列表",

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
