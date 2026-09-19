(function () {
  "use strict";

  var GROUP_ORDER = window.YUEFU_GROUP_ORDER = [
    "汉乐府",
    "北朝乐府",
    "南朝乐府"
  ];

  function bookConfig() {
    return {
      id: "yuefu",
      groupOrder: GROUP_ORDER,
      pageTitle: "乐府诗选",
      pageSub: "两汉至南北朝 · 感于哀乐，缘事而发",
      words: {
        list: "乐府",
        unit: "首",
        loadingFailed: "乐府数据加载失败",
        empty: "没有匹配的乐府诗",
        matchGroup: "乐府诗选",
        backToList: "返回乐府列表",
        readStore: "poem_yuefu_read_v1",
        playerTitle: "乐府朗读",
        searchPlaceholder: "搜索篇名 / 出处 / 作者"
      }
    };
  }

  function boot() {
    if (!window.ReaderEngine) return;
    var all = window.POEMS_YUEFU || window.YUEFU_ALL || [];
    if (!all.length) {
      var listEl = document.querySelector('[data-gw="list"]');
      if (listEl) listEl.innerHTML = '<div class="empty">乐府数据加载失败</div>';
      return;
    }

    var cfg = bookConfig();
    cfg.items = all;
    cfg.root = "[data-gw-root]";
    cfg.reader = "#gw-reader";
    window.ReaderEngine.mount(cfg);
  }

  window.YuefuBook = {
    config: bookConfig,
    items: function () { return window.POEMS_YUEFU || []; }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
