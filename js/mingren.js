(function () {
  "use strict";

  // Issue #381 第八轮：历代名家 706 位，十五组。
  // 用户原话：「将外国和中国的各个家合并，不区分中国外国两大类，
  // 按时间顺序排列。」
  // 所以上一版那二十五组（中国十五 + 外国十）并成十五个**行当组** ——
  // 组就是行当，中外一位同组，组名里不再带「外国」「（中国）」。
  // 与 scripts/build-mingren.js 的 GROUP_ORDER 一字不差。
  var GROUP_ORDER = window.MINGREN_GROUP_ORDER = [
    "政治家", "文学家", "史学家", "思想家", "哲学家", "军事家",
    "书法家", "画家", "戏曲家", "音乐家",
    "科学家", "医学家", "天文地理学家", "生物学家", "建筑家"
  ];

  function bookConfig() {
    return {
      id: "mingren",
      groupOrder: GROUP_ORDER,
      pageTitle: "历代名家",
      pageSub: "十五组不分中外（政治 / 文学 / 史学 / 思想 / 哲学 / 军事 / 书法 / 绘画 / 戏曲 / 音乐 / 科学 / 医学 / 天文地理 / 生物 / 建筑） · 全册按出生时间先后排 · 每位的字 / 号 / 生卒 / 亲属 / 生平 / 流派",
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
