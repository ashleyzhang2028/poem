(function () {
  "use strict";

  var GROUP_ORDER = window.MINGSHU_GROUP_ORDER = [
    "中国古典小说", "中国现代小说", "中国当代小说",
    "中国现代散文", "中国现当代诗歌", "中国现代戏剧", "外国文学"
  ];

  function bookConfig() {
    return {
      id: "mingshu",
      groupOrder: GROUP_ORDER,
      pageTitle: "名著导读",
      pageSub: "按中国古典 / 现代 / 当代 / 散文 / 诗歌 / 戏剧与外国文学分七组 · 每部给背景 / 情节 / 人物 / 主旨",
      // 词条式：正文即导读，本来就没有白话译文
      noTranslation: true,
      words: {
        list: "名著导读",
        unit: "部",
        loadingFailed: "名著导读数据加载失败",
        empty: "没有匹配的名著",
        matchGroup: "名著导读",
        backToList: "返回名著列表",
        readStore: "poem_mingshu_read_v1",
        playerTitle: "名著导读朗读",
        searchPlaceholder: "搜索书名 / 作者 / 人物 / 主旨"
      }
    };
  }

  function boot() {
    if (!window.ReaderEngine) return;
    var all = window.POEMS_MINGSHU || [];
    if (!all.length) {
      var listEl = document.querySelector('[data-gw="list"]');
      if (listEl) listEl.innerHTML = '<div class="empty">名著导读数据加载失败</div>';
      return;
    }

    var cfg = bookConfig();
    cfg.items = all;
    cfg.root = "[data-gw-root]";
    cfg.reader = "#gw-reader";
    window.ReaderEngine.mount(cfg);
  }

  window.MingshuBook = {
    config: bookConfig,
    items: function () { return window.POEMS_MINGSHU || []; }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
