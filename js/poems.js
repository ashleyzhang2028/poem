(function () {
  "use strict";

  function gradeName(g) {
    var names = window.GRADE_NAMES;
    return (names && names[g]) || g + "年级";
  }

  function termName(t) {
    return Number(t) === 2 ? "下" : "上";
  }

  var GROUP_ORDER = (function () {
    var out = [];
    for (var g = 1; g <= 12; g += 1) {
      out.push(gradeName(g) + termName(1));
      out.push(gradeName(g) + termName(2));
    }
    return out;
  })();

  function withGroups(all) {
    var list = [];
    var seen = {};
    all.forEach(function (raw) {

      if (!raw || !raw.id || seen[raw.id]) return;
      seen[raw.id] = true;
      var p = {};
      Object.keys(raw).forEach(function (k) { p[k] = raw[k]; });
      p.gradeGroup = gradeName(p.grade) + termName(p.term);
      list.push(p);
    });
    var rank = {};
    GROUP_ORDER.forEach(function (name, i) { rank[name] = i; });
    list.sort(function (a, b) {
      return (rank[a.gradeGroup] - rank[b.gradeGroup]) || 0;
    });
    return list;
  }

  function boot() {
    if (!window.ReaderEngine) return;
    var all = window.POEMS_ALL || [];
    var listEl = document.querySelector('[data-gw="list"]');
    if (!all.length) {
      if (listEl) listEl.innerHTML = '<div class="empty">课内诗词数据加载失败</div>';
      return;
    }

    var engine = window.ReaderEngine.mount({
      id: "poems",
      items: withGroups(all),
      root: "[data-gw-root]",
      reader: "#gw-reader",
      groupOrder: GROUP_ORDER,

      pageTitle: "课内古诗词",
      pageSub: "一至高三 · 按年级分册，想读哪首点哪首",
      words: {
        list: "诗词",
        unit: "首",
        loadingFailed: "课内诗词数据加载失败",
        empty: "没有匹配的诗词",
        matchGroup: "课内",
        backToList: "返回诗词列表",

        readStore: "poem_poems_read_v1",
        playerTitle: "课内诗词朗读",
        searchPlaceholder: "搜索诗题 / 作者 / 名句"
      },

      reciteList: false
    });

    document.addEventListener("poems:open", function (e) {
      var id = e && e.detail && e.detail.id;
      if (!id || !engine || !engine.open) return;

      if (window.PoemGame && window.PoemGame.isOpen && window.PoemGame.isOpen()) {
        window.PoemGame.close();
      }
      engine.open(id);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
