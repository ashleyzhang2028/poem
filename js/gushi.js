(function () {
  "use strict";

  var GROUP_ORDER = window.GUSHI_GROUP_ORDER = [
    "先秦诗",
    "汉魏诗",
    "六朝诗",
    "宋诗",
    "元明清诗"
  ];

  function bookConfig() {
    return {
      id: "gushi",
      groupOrder: GROUP_ORDER,
      pageTitle: "古诗「非唐代」",
      pageSub: "唐代之外 · 先秦至清",
      words: {
        list: "古诗",
        unit: "首",
        loadingFailed: "古诗数据加载失败",
        empty: "没有匹配的古诗",
        matchGroup: "古诗「非唐代」",
        backToList: "返回古诗列表",
        readStore: "poem_gushi_read_v1",
        playerTitle: "古诗朗读",
        searchPlaceholder: "搜索篇名 / 出处 / 作者"
      }
    };
  }

  function boot() {
    if (!window.ReaderEngine) return;
    var all = window.POEMS_GUSHI || [];
    if (!all.length) {
      var listEl = document.querySelector('[data-gw="list"]');
      if (listEl) listEl.innerHTML = '<div class="empty">古诗数据加载失败</div>';
      return;
    }

    var cfg = bookConfig();
    cfg.items = all;
    cfg.root = "[data-gw-root]";
    cfg.reader = "#gw-reader";
    window.ReaderEngine.mount(cfg);
  }

  window.GushiBook = {
    config: bookConfig,
    items: function () { return window.POEMS_GUSHI || []; }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
