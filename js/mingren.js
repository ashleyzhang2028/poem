(function () {
  "use strict";

  // Issue #381 第四轮：135 → 649 位，并把上一轮挤在一个筐里的「外国名人」
  // 按学科拆开。组序按「先中国后外国，中国内按文学—艺术—专门之学，
  // 外国内按哲学—数学—物理—化学—生物—天文—医学—文学—艺术—建筑」排。
  var GROUP_ORDER = window.MINGREN_GROUP_ORDER = [
    // 中国：文学与思想 → 艺术 → 专门之学
    "文学家", "史学家", "思想家", "哲学家", "军事家",
    "书法家", "画家", "戏曲家", "音乐家",
    "科学家", "医学家", "天文学家（中国）", "生物学家（中国）", "建筑家",
    // 外国：按学科
    "外国数学家", "外国物理学家", "外国化学家",
    "外国生物学家", "外国天文学家", "外国医学家",
    "外国文学家", "外国艺术家", "外国建筑家"
  ];

  function bookConfig() {
    return {
      id: "mingren",
      groupOrder: GROUP_ORDER,
      pageTitle: "历代名家",
      pageSub: "中国十四组（文学 / 史学 / 思想 / 哲学 / 军事 / 书法 / 绘画 / 戏曲 / 音乐 / 科学 / 医学 / 天文 / 生物 / 建筑），外国九组按学科分 · 每位的字 / 号 / 生卒 / 亲属 / 生平 / 流派",
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
