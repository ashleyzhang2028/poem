(function () {
  "use strict";

  // Issue #399（本轮）：用户原话「课外阅读历代名家还是重新拆分成
  //  历代名家「中国」/ 历代名家「外国」两个集子」—— 真的有**两份壳**、
  //  两个 url（/mingren/ 与 /mingren-waiguo/）。老键 poem_mingren_read_v1
  //  里那 171 条已读记录，按人分流到两卷各自的键上（见 migrateReadStore）。
  //
  // Issue #381 第八 / 九 / 十 / 十一轮留下的组口径都在：十七个行当组，
  //  组名不带国别；两卷共用同一张 GROUP_ORDER（组是行当，不是国别）。
  //  与 scripts/build-mingren.js 的 GROUP_ORDER 一字不差。
  var GROUP_ORDER = window.MINGREN_GROUP_ORDER = [
    "政治家", "文学家", "历史学家", "思想家", "哲学家", "军事家",
    "科学家", "医学家", "农学家", "天文地理学家", "生物学家",
    "美术家", "书法家", "戏曲家", "音乐家",
    "语言文字学家", "经济学家"
  ];

  var VOLUMES = {
    cn: {
      key: "cn",
      bookId: "mingren",
      title: "名家「中国」",
      varName: "POEMS_MINGREN_CN",
      page: "/mingren/",
      readStore: "poem_mingren_cn_read_v1",
      pageSub: "十七个行当组 · 本卷收中国名家 · 按出生时间先后排 · 每位写清是什么家"
    },
    foreign: {
      key: "foreign",
      bookId: "mingren-waiguo",
      title: "名家「外国」",
      varName: "POEMS_MINGREN_FOREIGN",
      page: "/mingren-waiguo/",
      readStore: "poem_mingren_foreign_read_v1",
      pageSub: "十七个行当组 · 本卷收外国名家 · 按出生时间先后排 · 每位写清是什么家"
    }
  };

  /* ── 这一页 / 这一次进的是哪一卷（两份壳、两个 url）────────────────────
     两个入口都走这里：
       · 立在 /mingren/ 或 /mingren-waiguo/ 上时：看 url；
       · 从课外阅读列表里点进来时：显式给 bookId（`mingren` / `mingren-waiguo`）。
     ⚠️ 不按「哪份壳先加载」判 —— 课外阅读页两份壳都挂着，按加载顺序判
        会永远进同一卷（这是拆两部之后最容易踩的那一脚）。 */
  function volume(bookId) {
    if (bookId === VOLUMES.foreign.bookId) return VOLUMES.foreign;
    if (bookId === VOLUMES.cn.bookId) return VOLUMES.cn;
    var href = (window.location && window.location.pathname) || "";
    if (/^\/mingren-waiguo(\/|$)/.test(href)) return VOLUMES.foreign;
    return VOLUMES.cn;
  }

  function itemsOf(v) {
    var all = window[v.varName] || [];
    /* ⚠️ 两份壳同时挂在页面上时（课外阅读页、搜索页）按 country 再筛一道 ——
       「哪一卷」这件事最终认字段，不认脚本加载顺序。 */
    return all.filter(function (p) { return !p.country || p.country === (v.key === "foreign" ? "外国" : "中国"); });
  }

  function bookConfig(v) {
    return {
      id: "mingren",
      groupOrder: GROUP_ORDER,
      pageTitle: v.title,
      pageSub: v.pageSub,
      // 词条式：正文即词条表，本来就没有白话译文
      noTranslation: true,
      words: {
        list: v.title,
        unit: "家",
        loadingFailed: v.title + "数据加载失败",
        empty: "没有匹配的名家",
        matchGroup: v.title,
        backToList: "返回" + v.title + "列表",
        readStore: v.readStore,
        playerTitle: "名家朗读",
        searchPlaceholder: "搜索姓名 / 字号 / 朝代 / 流派 / 作品"
      }
    };
  }

  /* ── 老进度迁移（Issue #399）──────────────────────────────────────────
     上一轮只有一部集子，已读记录全在 poem_mingren_read_v1 里，键是
     `mingren-mr-xx`。这一轮拆两部、id 换成 mr-c-xx / mr-w-xx，老键里的
     号对不上新号（**号段不同，不能按号平移**）—— 所以按人分流：
     两卷各建一张 `老号 → 新号` 的对照表，只认自己卷里的人。

     迁移是**幂等**的：老键里的号只处理一次（处理后删掉处理过的项），
     且只在目标卷的键为空时才铺 —— 用户自己点过的「已读 / 未读」不被覆盖。 */
  function migrateReadStore(v, items) {
    if (!window.ProgressStore) return;
    var OLD = "poem_mingren_read_v1";
    var oldMap;
    try { oldMap = window.ProgressStore.readMap(OLD) || {}; } catch (e) { return; }
    if (!oldMap || !Object.keys(oldMap).length) return;

    var mine = {};
    try { mine = window.ProgressStore.readMap(v.readStore) || {}; } catch (e) { mine = {}; }
    if (Object.keys(mine).length) return;   // 本卷已有进度：用户自己的，不动

    /* 老键里的号形如 `mr-01`（读的是**壳的 id**，见 reader-core 的
       `setRead(current.id)`），新键里要落的也是这一卷壳的 id（`mr-c-01`）。
       两卷的号段不同位，所以按人认：新 id 去掉了 `c` / `w` 那一段，
       就是老号（`mr-c-01` → `mr-01`）。 */
    var next = {};
    var moved = 0;
    items.forEach(function (p) {
      var old = String(p.id || "").replace(/-[cw]-/, "-");
      if (oldMap[old] || oldMap[p.textRef]) {
        next[p.id] = { read: true };
        moved += 1;
      }
    });
    if (!moved) return;
    try {
      window.ProgressStore.setReadMap(v.readStore, next);
      window.dispatchEvent(new CustomEvent("reader-read-change",
        { detail: { store: v.readStore, migrated: moved } }));
    } catch (e) { /* 迁移失败不影响阅读 */ }
  }

  function boot() {
    if (!window.ReaderEngine) return;
    /* 立在某一卷的页面上时按 url 认卷（课外阅读页不走这里：那里由
       enterBook 显式把 bookId 传进 config() / items()）。 */
    var v = volume();
    var all = itemsOf(v);
    if (!all.length) {
      var listEl = document.querySelector('[data-gw="list"]');
      if (listEl) listEl.innerHTML = '<div class="empty">' + v.title + '数据加载失败</div>';
      return;
    }

    migrateReadStore(v, all);

    var cfg = bookConfig(v);
    cfg.items = all;
    cfg.root = "[data-gw-root]";
    cfg.reader = "#gw-reader";
    window.ReaderEngine.mount(cfg);
  }

  window.MingrenBook = {
    volumes: { cn: VOLUMES.cn.bookId, foreign: VOLUMES.foreign.bookId },
    /* `bookId` 可选：课外阅读页按卡片给的 id 进来（`mingren` / `mingren-waiguo`）；
       立在本卷页面上时不传，按 url 认。 */
    config: function (bookId) { return bookConfig(volume(bookId)); },
    items: function (bookId) { return itemsOf(volume(bookId)); }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
