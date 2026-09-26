(function () {
  "use strict";

  var GROUP_ORDER = window.CHANGSHI_GROUP_ORDER = [
    "文体知识", "作家与作品", "流派与并称", "典籍",
    "称谓与礼俗", "制度与地理", "名句与典故", "现当代文学史事件"
  ];

  function bookConfig() {
    return {
      id: "changshi",
      groupOrder: GROUP_ORDER,
      pageTitle: "文学常识",
      pageSub: "按考纲范围分八组 · 文体 / 作家 / 流派 / 典籍 / 称谓 / 制度 / 典故 / 现当代文学史事件",
      // 词条式：正文即释义，本来就没有白话译文 ——
      // 引擎据此不做「待整理」标记，也不显示译文开关
      noTranslation: true,
      words: {
        list: "文学常识",
        unit: "条",
        loadingFailed: "文学常识数据加载失败",
        empty: "没有匹配的条目",
        matchGroup: "文学常识",
        backToList: "返回常识列表",
        readStore: "poem_changshi_read_v1",
        playerTitle: "常识朗读",
        searchPlaceholder: "搜索术语 / 出处 / 分组 / 关键词"
      }
    };
  }

  function boot() {
    if (!window.ReaderEngine) return;
    var all = window.POEMS_CHANGSHI || [];
    if (!all.length) {
      var listEl = document.querySelector('[data-gw="list"]');
      if (listEl) listEl.innerHTML = '<div class="empty">文学常识数据加载失败</div>';
      return;
    }

    var cfg = bookConfig();
    cfg.items = all;
    cfg.root = "[data-gw-root]";
    cfg.reader = "#gw-reader";
    window.ReaderEngine.mount(cfg);
  }

  window.ChangshiBook = {
    config: bookConfig,
    items: function () { return window.POEMS_CHANGSHI || []; }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
