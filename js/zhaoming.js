(function () {
  "use strict";

  var GROUP_ORDER = window.ZHAOMING_GROUP_ORDER = [
    "赋 · 京都上", "赋 · 京都中", "赋 · 京都下", "赋 · 郊祀",
    "赋 · 耕藉", "赋 · 畋猎", "赋", "赋 · 纪行上",
    "赋 · 纪行下", "赋 · 游览", "赋 · 宫殿", "赋 · 江海",
    "赋 · 物色", "赋 · 鸟兽", "赋 · 鸟兽下", "赋 · 志上",
    "赋 · 志中", "赋 · 志下", "赋 · 哀伤", "赋 · 论文",
    "赋 · 音乐上", "赋 · 音乐下", "赋 · 情", "诗 · 补亡",
    "诗 · 述德", "诗 · 劝励", "诗 · 献诗", "诗 · 公䜩",
    "诗 · 祖饯", "诗 · 咏史", "诗 · 百一", "诗 · 游仙",
    "诗 · 招隐", "诗 · 反招隐", "诗 · 游览", "诗 · 咏怀",
    "诗 · 临终", "诗 · 哀伤", "诗 · 赠答一", "诗 · 赠答二",
    "诗 · 赠答三", "诗 · 赠答四", "诗 · 行旅上", "诗 · 行旅下",
    "诗 · 军戎", "诗 · 郊庙", "诗 · 乐府上", "诗 · 乐府下",
    "诗 · 杂歌", "诗 · 杂诗上", "诗 · 杂诗下", "诗 · 杂拟上",
    "诗 · 杂拟下", "骚", "七", "诏",
    "册", "令", "教", "文",
    "表", "上书", "启", "弹事",
    "笺", "奏记", "书", "檄",
    "对问", "设论", "辞", "序",
    "颂", "赞", "符命", "史论",
    "史述赞", "论 · 论一", "论 · 论二", "论 · 论三",
    "论 · 论四", "连珠 · 论五", "箴", "铭",
    "诔", "哀", "碑文", "墓志",
    "行状", "吊文", "祭文"
  ];

  function bookConfig() {
    return {
      id: "zhaoming",
      groupOrder: GROUP_ORDER,
      pageTitle: "昭明文选",
      pageSub: "六十卷 · 三十九类文体 · 想读哪篇点哪篇",
      words: {
        list: "文章",
        unit: "篇",
        loadingFailed: "昭明文选数据加载失败",
        empty: "没有匹配的文章",
        matchGroup: "昭明文选",
        backToList: "返回文选列表",

        pendingText: "本篇原文尚在整理中",
        pendingTranslation: "本篇白话译文尚在整理中",
        readStore: "poem_zhaoming_read_v1",
        playerTitle: "文选朗读",
        searchPlaceholder: "搜索篇名 / 作者 / 文体"
      }
    };
  }

  function boot() {
    if (!window.ReaderEngine) return;
    var all = window.POEMS_ZHAOMING || window.ZHAOMING_ALL || [];
    if (!all.length) {
      var listEl = document.querySelector('[data-gw="list"]');
      if (listEl) listEl.innerHTML = '<div class="empty">昭明文选数据加载失败</div>';
      return;
    }

    var cfg = bookConfig();
    cfg.items = all;
    cfg.root = "[data-gw-root]";
    cfg.reader = "#gw-reader";
    window.ReaderEngine.mount(cfg);
  }

  window.ZhaomingBook = {
    config: bookConfig,
    items: function () { return window.POEMS_ZHAOMING || []; }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
