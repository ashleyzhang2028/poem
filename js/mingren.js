(function () {
  "use strict";

  // Issue #381 第八轮：中外合并成十五个行当组。
  // Issue #381 第九轮：补齐缺的那几格（农学家 / 水利家 / 经济学家 / 法学家 /
  //  翻译家 / 茶学家 / 工艺家 / 外交家 / 教育家 / 语言文字学家 / 考古学家），
  //  十五组 → 二十六个行当组。
  // Issue #381 第十轮：把散格并回主干 —— 用户原话「画家要改成美术家，
  //  建筑家合并到美术家」「水利家和茶学家合并到农学家」「考古 合并到
  //  历史学家」「法学家合并到政治家」「翻译家合并到语言文字学家」
  //  「外交家合并到政治家」「水利 / 农学 / 工艺 / 教育 / 考古按合适的类别
  //  合并」。二十六组 → 十七个行当组，组名不带国别。
  // 与 scripts/build-mingren.js 的 GROUP_ORDER 一字不差。
  var GROUP_ORDER = window.MINGREN_GROUP_ORDER = [
    "政治家", "文学家", "历史学家", "思想家", "哲学家", "军事家",
    "科学家", "医学家", "农学家", "天文地理学家", "生物学家",
    "美术家", "书法家", "戏曲家", "音乐家",
    "语言文字学家", "经济学家"
  ];

  function bookConfig() {
    return {
      id: "mingren",
      groupOrder: GROUP_ORDER,
      pageTitle: "历代名家",
      pageSub: "十七个行当组，不分中外（政治 / 文学 / 历史 / 思想 / 哲学 / 军事 / 科学家 / 医学 / 农学 / 天文地理 / 生物 / 美术 / 书法 / 戏曲 / 音乐 / 语言文字学 / 经济学） · 全册按出生时间先后排 · 每位写清是什么家",
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
