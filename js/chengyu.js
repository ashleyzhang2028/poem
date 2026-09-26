(function () {
  "use strict";

  var GROUP_ORDER = window.CHENGYU_GROUP_ORDER = ["上古传说", "夏", "商", "西周", "春秋", "战国", "秦", "西汉", "东汉", "三国", "两晋南北朝", "隋", "唐", "五代", "宋", "辽金", "元", "明", "清"];

  function bookConfig() {
    return {
      id: "chengyu",
      groupOrder: GROUP_ORDER,
      pageTitle: "中华成语故事",
      pageSub: "按朝代编排 · 每则给出最早出处的原文与白话译文",
      // 收录进搜索范围的三栏：成语释义 + 语源 / 典故说明
      extraFields: ["meaning", "gloss"],
      words: {
        list: "中华成语故事",
        unit: "则",
        loadingFailed: "中华成语故事数据加载失败",
        empty: "没有匹配的成语",
        matchGroup: "中华成语故事",
        backToList: "返回成语列表",
        readStore: "poem_chengyu_read_v1",
        playerTitle: "成语朗读",
        searchPlaceholder: "搜索成语 / 释义 / 出处 / 朝代 / 作者"
      }
    };
  }

  function boot() {
    if (!window.ReaderEngine) return;
    var all = window.POEMS_CHENGYU || [];
    if (!all.length) {
      var listEl = document.querySelector('[data-gw="list"]');
      if (listEl) listEl.innerHTML = '<div class="empty">中华成语故事数据加载失败</div>';
      return;
    }

    var cfg = bookConfig();
    cfg.items = all;
    cfg.root = "[data-gw-root]";
    cfg.reader = "#gw-reader";
    window.ReaderEngine.mount(cfg);
  }

  window.ChengyuBook = {
    config: bookConfig,
    items: function () { return window.POEMS_CHENGYU || []; }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
