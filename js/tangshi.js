(function () {
  "use strict";

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
