(function () {
  "use strict";

  var GROUP_ORDER = window.MINGREN_GROUP_ORDER = [
    "文学家", "史学家", "思想家", "军事家",
    "科学家", "医学家", "音乐家", "建筑家", "戏曲家"
  ];

  function bookConfig() {
    return {
      id: "mingren",
      groupOrder: GROUP_ORDER,
      pageTitle: "历代名家",
      pageSub: "按文学家 / 史学家 / 思想家 / 军事家 / 科学家 / 医学家 / 音乐家 / 建筑家 / 戏曲家分九组 · 每家的字 / 号 / 生卒 / 亲属 / 生平 / 流派",
      // 词条式：正文即词条表，本来就没有白话译文
      noTranslation: true,
      words: {
        list: "历代名家",
        unit: "家",
        loadingFailed: "历代名家数据加载失败",
        empty: "没有匹配的名家",
        matchGroup: "历代名家",
        backToList: "返回名家列表",
        readStore: "poem_mingren_read_v1",
        playerTitle: "名家朗读",
        searchPlaceholder: "搜索姓名 / 字号 / 朝代 / 流派 / 作品"
      }
    };
  }

  function boot() {
    if (!window.ReaderEngine) return;
    var all = window.POEMS_MINGREN || [];
    if (!all.length) {
      var listEl = document.querySelector('[data-gw="list"]');
      if (listEl) listEl.innerHTML = '<div class="empty">历代名家数据加载失败</div>';
      return;
    }

    var cfg = bookConfig();
    cfg.items = all;
    cfg.root = "[data-gw-root]";
    cfg.reader = "#gw-reader";
    window.ReaderEngine.mount(cfg);
  }

  window.MingrenBook = {
    config: bookConfig,
    items: function () { return window.POEMS_MINGREN || []; }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
