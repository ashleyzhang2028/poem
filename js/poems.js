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

  // 地址栏里那一个参数（`?poem=…` / `?game=1`）。
  function query() {
    try { return String(window.location.search || ""); } catch (e) { return ""; }
  }

  // 老地址 `/poems/?game=1` → `/dahui/`（Issue #356）。
  //
  // ⚠️ 只为**已经发出去的链接**留着：底栏、README、文档里的深链都改成
  //    `/dahui/` 了，可外面点进来的旧链接、用户存下来的书签还在。
  //    用 `replace` 而不是 `href`：不留一条「回退又跳回来」的历史。
  //    这一页上**没有**「大会」那一层了，所以这里只有跳转、没有别的动作。
  function redirectOldGameLink() {
    if (!/(?:^|[?&])game=1(?:&|$)/.test(query())) return false;
    window.location.replace("/dahui/");
    return true;
  }

  // 深链：`/poems/?poem=<id>` 直接把那一篇铺开。
  //
  // 谁发的：`/dahui/` 上飞花令「看答案」里的每一句 —— 那一页只有题，
  // 点了句子得**回来**这一页看原文（详情页仍住在诗词页这一层，见 §4.72）。
  // 口径与首页 `/` 的 `?poem=` **逐字相同**（`js/app.js` 的 `deepLinkId`）：
  // 一处写、一处读，用户不必记两种写法。
  function deepLinkId() {
    var m = /(?:^|[?&])poem=([^&]+)/.exec(query());
    if (!m) return "";
    var id = m[1];
    try { id = decodeURIComponent(id.replace(/\+/g, " ")); } catch (e) { }
    return String(id || "").trim();
  }

  function clearDeepLink() {
    try {
      if (!window.history || !window.history.replaceState) return;
      window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    } catch (e) {  }
  }

  function boot() {
    if (redirectOldGameLink()) return;
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

    // 深链进来：先把参数从地址栏抹掉（刷新不再自己铺开），再打开那一篇。
    // 写在 `engine` 就位之后、`poems:open` 那条监听之**前** —— 次序无所谓，
    // 但两处走的是同一个 `engine.open`，不许各写一套开法。
    var want = deepLinkId();
    if (want && engine && engine.open) {
      clearDeepLink();
      engine.open(want);
    }

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
