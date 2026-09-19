(function () {
  "use strict";

  var GROUP_ORDER = window.YUEFU_GROUP_ORDER = [
    "汉乐府",
    "北朝乐府",
    "南朝乐府"
  ];

  function bookConfig() {
    return {
      id: "yuefu",
      groupOrder: GROUP_ORDER,
      pageTitle: "乐府诗选",
      pageSub: "汉乐府与南北朝乐府 · 言浅意深",
      words: {
        list: "乐府",
        unit: "首",
        loadingFailed: "乐府数据加载失败",
        empty: "没有匹配的乐府",
        matchGroup: "乐府诗选",
        backToList: "返回乐府列表",
        readStore: "poem_yuefu_read_v1",
        playerTitle: "乐府朗读",
        searchPlaceholder: "搜索篇名 / 出处 / 作者"
      }
    };
  }

  function boot() {
    if (!window.ReaderEngine) return;
    var all = window.POEMS_YUEFU || window.YUEFU_ALL || [];
    if (!all.length) {
      var listEl = document.querySelector('[data-gw="list"]');
      if (listEl) listEl.innerHTML = '<div class="empty">乐府数据加载失败</div>';
      return;
    }

    var cfg = bookConfig();
    cfg.items = all;
    cfg.root = "[data-gw-root]";
    cfg.reader = "#gw-reader";
    window.ReaderEngine.mount(cfg);
  }

  // 分组顺序表是 window.YUEFU_GROUP_ORDER（见文件开头）——
  // data/group-order.js 的 yuefu 一格按它取，各页排序口径全站一致。
  window.YUEFU_ALL = window.POEMS_YUEFU;

  window.getYuefuById = function (id) {
    return (window.POEMS_YUEFU || []).filter(function (p) { return p.id === id; })[0] || null;
  };

  window.getYuefuGroups = function () {
    var groups = [];
    (window.POEMS_YUEFU || []).forEach(function (p) {
      var g = p.gradeGroup || "其他";
      var hit = groups.filter(function (it) { return it.name === g; })[0];
      if (!hit) { hit = { name: g, items: [] }; groups.push(hit); }
      hit.items.push(p);
    });

    var order = window.YUEFU_GROUP_ORDER || [];
    groups.sort(function (a, b) {
      var ia = order.indexOf(a.name);
      var ib = order.indexOf(b.name);
      if (ia < 0) ia = order.length;
      if (ib < 0) ib = order.length;
      if (ia !== ib) return ia - ib;
      return a.name < b.name ? -1 : 1;
    });
    return groups;
  };

  window.YuefuBook = {
    config: bookConfig,
    items: function () { return window.POEMS_YUEFU || []; }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
