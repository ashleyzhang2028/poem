(function () {
  "use strict";

  var GROUP_ORDER = window.JINXIANDAI_GROUP_ORDER = [
    "革命岁月", "长征路上", "建国前后", "咏物寄怀", "狱中与就义", "志士之歌"
  ];

  function bookConfig() {
    return {
      id: "jinxiandai",
      groupOrder: GROUP_ORDER,
      pageTitle: "近现代诗词",
      pageSub: "近百年间的志士之诗 · 原作引用，译文自拟",
      words: {
        list: "近现代诗词",
        unit: "首",
        loadingFailed: "近现代诗词数据加载失败",
        empty: "没有匹配的篇目",
        matchGroup: "近现代诗词",
        backToList: "返回近现代诗词列表",
        readStore: "poem_jinxiandai_read_v1",
        playerTitle: "诗词朗读",
        searchPlaceholder: "搜索篇名 / 出处 / 作者"
      }
    };
  }

  function boot() {
    if (!window.ReaderEngine) return;
    var all = window.POEMS_JINXIANDAI || window.JINXIANDAI_ALL || [];
    if (!all.length) {
      var listEl = document.querySelector('[data-gw="list"]');
      if (listEl) listEl.innerHTML = '<div class="empty">近现代诗词数据加载失败</div>';
      return;
    }

    var cfg = bookConfig();
    cfg.items = all;
    cfg.root = "[data-gw-root]";
    cfg.reader = "#gw-reader";
    window.ReaderEngine.mount(cfg);
  }

  window.JinxiandaiBook = {
    config: bookConfig,
    items: function () { return window.POEMS_JINXIANDAI || []; }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
