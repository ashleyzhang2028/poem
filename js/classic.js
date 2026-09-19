(function () {
  "use strict";

  var GROUP_ORDER = [
    "蒙学经典",
    "寓言故事",
    "神话传说",
    "人物故事",
    "志人逸事",
    "治学勤读",
    "山水游记",
    "诸子论道"
  ];

  function bookConfig() {
    return {
      id: "classic",
      groupOrder: GROUP_ORDER,

      pageTitle: "课外必背小古文",
      pageSub: "百字上下，最适合起步",
      words: {
        list: "小古文",
        unit: "篇",
        loadingFailed: "小古文数据加载失败",
        empty: "没有匹配的小古文",
        matchGroup: "课外必背",
        backToList: "返回小古文列表",
        readStore: "poem_classic_read_v1",
        playerTitle: "小古文朗读"
      }
    };
  }

  function boot() {
    if (!window.ReaderEngine) return;
    var all = window.CLASSIC_ALL || window.POEMS_CLASSIC || [];
    if (!all.length) {
      var listEl = document.querySelector('[data-gw="list"]');
      if (listEl) listEl.innerHTML = '<div class="empty">小古文数据加载失败</div>';
      return;
    }

    var cfg = bookConfig();
    cfg.items = all;
    cfg.root = "[data-gw-root]";
    cfg.reader = "#gw-reader";
    window.ReaderEngine.mount(cfg);
  }

  window.ClassicBook = {
    config: bookConfig,
    items: function () { return window.POEMS_CLASSIC || []; }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
