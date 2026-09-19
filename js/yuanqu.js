(function () {
  "use strict";

  var GROUP_ORDER = window.YUANQU_GROUP_ORDER = [
    "小令 · 黄钟", "小令 · 正宫", "小令 · 中吕", "小令 · 南吕",
    "小令 · 双调", "小令 · 越调",
    "套数 · 中吕"
  ];

  function bookConfig() {
    return {
      id: "yuanqu",
      groupOrder: GROUP_ORDER,
      pageTitle: "元曲三百首",
      pageSub: "想读哪首点哪首",
      words: {
        list: "元曲",
        unit: "首",
        loadingFailed: "元曲数据加载失败",
        empty: "没有匹配的元曲",
        matchGroup: "元曲三百首",
        backToList: "返回元曲列表",
        readStore: "poem_yuanqu_read_v1",
        playerTitle: "元曲朗读",
        searchPlaceholder: "搜索曲牌 / 出处 / 作者"
      }
    };
  }

  function boot() {
    if (!window.ReaderEngine) return;
    var all = window.POEMS_YUANQU || window.YUANQU_ALL || [];
    if (!all.length) {
      var listEl = document.querySelector('[data-gw="list"]');
      if (listEl) listEl.innerHTML = '<div class="empty">元曲数据加载失败</div>';
      return;
    }

    var cfg = bookConfig();
    cfg.items = all;
    cfg.root = "[data-gw-root]";
    cfg.reader = "#gw-reader";
    window.ReaderEngine.mount(cfg);
  }

  window.YuanquBook = {
    config: bookConfig,
    items: function () { return window.POEMS_YUANQU || []; }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
