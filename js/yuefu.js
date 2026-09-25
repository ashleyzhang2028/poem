(function () {
  "use strict";

  var GROUP_ORDER = window.YUEFU_GROUP_ORDER = [
    "卷一 汉魏乐府",
    "卷二 南朝乐府",
    "卷三 唐代乐府",
    "卷四 唐五代乐府",
    "卷五 乐府歌辞"
  ];

  function bookConfig() {
    return {
      id: "yuefu",
      groupOrder: GROUP_ORDER,
      pageTitle: "乐府集",
      pageSub: "精选一百零三首 · 汉魏至唐五代",
      words: {
        list: "乐府",
        unit: "首",
        loadingFailed: "乐府集数据加载失败",
        empty: "没有匹配的乐府",
        matchGroup: "乐府集",
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
      if (listEl) listEl.innerHTML = '<div class="empty">乐府集数据加载失败</div>';
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
    items: function () { return window.POEMS_YUEFU || window.YUEFU_ALL || []; }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
