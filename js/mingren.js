(function () {
  "use strict";

  // Issue #381 第八轮：中外合并成十五个行当组。
  // Issue #381 第十轮：再把缺的那几格补齐 —— 用户原话
  // 「农学家、水利家、经济学家、翻译家 玄奘、茶学家、工艺家、法学家、
  //  纵横家、教育家、语言文字学家、考古学家」，十五组 → 二十六个行当组。
  // 组就是行当，中外一位同组，组名里不带「外国」「（中国）」。
  // 与 scripts/build-mingren.js 的 GROUP_ORDER 一字不差。
  var GROUP_ORDER = window.MINGREN_GROUP_ORDER = [
    "政治家", "文学家", "史学家", "思想家", "哲学家", "军事家",
    "科学家", "医学家", "农学家", "水利家", "天文地理学家", "生物学家",
    "建筑家", "工艺家", "书法家", "画家", "戏曲家", "音乐家",
    "法学家", "经济学家", "翻译家", "外交家", "茶学家",
    "教育家", "语言文字学家", "考古学家"
  ];

  function bookConfig() {
    return {
      id: "mingren",
      groupOrder: GROUP_ORDER,
      pageTitle: "历代名家",
      pageSub: "二十六个行当组，不分中外（政治 / 文学 / 史学 / 思想 / 哲学 / 军事 / 科学家 / 医学 / 农学 / 水利 / 天文地理 / 生物 / 建筑 / 工艺 / 书法 / 绘画 / 戏曲 / 音乐 / 法学 / 经济 / 翻译 / 外交 / 茶学 / 教育 / 语言文字学 / 考古学） · 全册按出生时间先后排 · 每位的字 / 号 / 生卒 / 亲属 / 生平 / 流派",
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
