(function () {
  "use strict";

  var ENTRIES = [
    {
      id: "poems",
      name: "课内诗词",
      short: "课内",

      page: "/poems/",
      unit: "首",
      desc: "一年级至高三，按年级分册"
    },
    {
      id: "classic",
      name: "小古文",
      book: "ClassicBook",
      short: "小古文",
      page: "/classic/",
      unit: "篇",
      desc: "蒙学识字、寓言故事到诸子论道，百字上下，最适合起步"
    },
    {
      id: "yuefu",
      name: "乐府集",
      book: "YuefuBook",
      short: "乐府",
      page: "/yuefu/",
      unit: "首",
      desc: "精选一百零三首，自汉魏至唐五代按卷一至卷五分卷，乐府一体两千年"
    },
    {
      id: "tangshi",
      name: "唐诗",
      book: "TangshiBook",
      short: "唐诗",
      page: "/tangshi/",
      unit: "首",
      desc: "八卷选本按体裁编排，唐代诗歌的入门选本"
    },
    {
      id: "gushi",
      name: "古诗「非唐代」",
      book: "GushiBook",
      short: "古诗",
      page: "/gushi/",
      unit: "首",
      desc: "唐代之外的古诗：先秦《诗经》《楚辞》、汉魏六朝、宋诗与元明清诗，按时代先后分五组"
    },
    {
      id: "songci",
      name: "词",
      book: "SongciBook",
      short: "宋词",
      page: "/songci/",
      unit: "首",
      desc: "按词牌分组，宋词婉约与豪放两派精粹"
    },
    {
      id: "yuanqu",
      name: "曲",
      book: "YuanquBook",
      short: "元曲",
      page: "/yuanqu/",
      unit: "首",
      desc: "小令与套数按宫调编排，质朴自然，曲白相生"
    },
    {
      id: "guwen",
      name: "古文观止",
      book: "GuwenBook",
      short: "古文",
      page: "/guwen/",
      unit: "篇",
      desc: "十二卷自周文至明文，历代文章的选本经典"
    },
    {
      id: "jinxiandai",
      name: "近现代诗词",
      book: "JinxiandaiBook",
      short: "近现代",
      page: "/jinxiandai/",
      unit: "首",
      desc: "近百年间的志士之诗；原作引用、译文自拟，仅供背诵学习"
    },
    {
      id: "zhaoming",
      name: "昭明文选",
      book: "ZhaomingBook",
      short: "文选",
      page: "/zhaoming/",
      unit: "篇",
      desc: "六十卷按赋、诗、骚、七等三十九类文体编排，现存最早的诗文总集"
    },
    {
      id: "chengyu",
      name: "中华成语故事",
      book: "ChengyuBook",
      short: "成语",
      page: "/chengyu/",
      unit: "则",
      desc: "七百三十六则成语，逐条考订朝代、作者与出处，正文取经史子集原文"
    },
    {
      id: "changshi",
      name: "文学常识",
      book: "ChangshiBook",
      short: "常识",
      page: "/changshi/",
      unit: "条",
      desc: "文体 / 作家 / 流派 / 典籍 / 称谓 / 制度 / 典故 / 现当代文学史事件八组，高中及以前考点"
    },
    {
      id: "mingshu",
      name: "名著导读",
      book: "MingshuBook",
      short: "名著",
      page: "/mingshu/",
      unit: "部",
      desc: "中外名著八百部（国内三百六十余 / 世界四百四十余），每部给写作背景 / 情节 / 人物 / 主旨 / 名句"
    },
    /* Issue #399：历代名家拆两部 —— 中国卷 / 外国卷各是一个集子。 */
    {
      id: "mingren",
      name: "名家「中国」",
      book: "MingrenBook",
      short: "名家·中",
      page: "/mingren/",
      unit: "家",
      desc: "中国历代名家三百九十二位，按十七个行当组收（政治 / 文学 / 历史 / 思想 / 哲学 / 军事 / 科学家 / 医学 / 农学 / 天文地理 / 生物 / 美术 / 书法 / 戏曲 / 音乐 / 语言文字学 / 经济学），本卷按出生时间先后排；每位写清是什么家"
    },
    {
      id: "mingren-waiguo",
      name: "名家「外国」",
      book: "MingrenBook",
      short: "名家·外",
      page: "/mingren-waiguo/",
      unit: "家",
      desc: "外国历代名家五百二十三位，同样十七个行当组，本卷按出生时间先后排；每位写清是什么家"
    },
    /* Issue #407：帝王两卷 —— 中国卷自夏至清末，外国卷覆盖教科书点名的各国君主。 */
    {
      id: "dwang",
      name: "帝王「中国」",
      book: "DwangBook",
      short: "帝王·中",
      page: "/dwang/",
      unit: "位",
      desc: "自传说时代（三皇五帝）与夏商周至清末的六百余位帝王，按二十七个时期分段、按在位先后排；每位给姓名 / 年号 / 在位 / 谥号 / 庙号 / 谱系，并按政治 / 经济 / 军事 / 文化 / 民族外交 / 个人六项评价。东周诸侯那一段另给一国的世系图与列传体白话译文"
    },
    {
      id: "dwang-waiguo",
      name: "帝王「外国」",
      book: "DwangBook",
      short: "帝王·外",
      page: "/dwang-waiguo/",
      unit: "位",
      desc: "教科书小初高大学阶段点名的各国君主，分上古东方 / 希腊与罗马 / 中世纪与伊斯兰 / 近代欧洲 / 现代五个时期，按在位先后排；每位给姓名 / 在位 / 尊号 / 王统与六项评价"
    }
  ];

  /* Issue #407：入口页 16 张卡压成 4 张 —— 课内诗词单列，其余按「诗文典籍 /
     人物 / 文史常识」三组并进分组卡；分组卡里只列名字与条数，不写介绍。 */
  var GROUPS = [
    { id: "wen", name: "诗文典籍", note: "蒙学古文 · 诗词曲选 · 历代总集", members: ["classic", "guwen", "yuefu", "tangshi", "gushi", "songci", "yuanqu", "jinxiandai", "zhaoming"] },
    { id: "renwu", name: "人物", note: "帝王与名家 · 中外各一卷", members: ["dwang", "dwang-waiguo", "mingren", "mingren-waiguo"] },
    { id: "changshi", name: "文史常识", note: "成语 · 文学常识 · 名著导读", members: ["chengyu", "changshi", "mingshu"] }
  ];

  /* 课内诗词单列（不入 GROUPS），排第一 —— 这是 App 的初心与头号功能。 */
  var SOLO = ["poems"];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function countOf(bookId) {
    var idx = window.SITE_INDEX || [];
    var direct = idx.filter(function (p) { return p.book === bookId && !p.isBook; }).length;

    var VARS = {
      poems: "POEMS_ALL",
      classic: "POEMS_CLASSIC",
      yuefu: "POEMS_YUEFU",
      tangshi: "POEMS_TANGSHI",
      gushi: "POEMS_GUSHI",
      songci: "POEMS_SONGCI",
      guwen: "POEMS_GUWEN",
      zhaoming: "POEMS_ZHAOMING",
      yuanqu: "POEMS_YUANQU",
      jinxiandai: "POEMS_JINXIANDAI",
      chengyu: "POEMS_CHENGYU",
      changshi: "POEMS_CHANGSHI",
      mingshu: "POEMS_MINGSHU",
      mingren: "POEMS_MINGREN_CN",
      "mingren-waiguo": "POEMS_MINGREN_FOREIGN",
      dwang: "POEMS_EMPEROR_CN",
      "dwang-waiguo": "POEMS_EMPEROR_FOREIGN"
    };
    var key = VARS[bookId];
    var list = key ? window[key] : null;
    if (list && list.length) return list.length;

    return direct;
  }

  function entryOf(bookId) {
    for (var i = 0; i < ENTRIES.length; i++) if (ENTRIES[i].id === bookId) return ENTRIES[i];
    return null;
  }

  var CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M9.4 5.6 15.8 12l-6.4 6.4"/></svg>';

  /* 一张子入口：名字 + 条数，点它就地进集子（与旧卡片同一条路）。 */
  function subItemHtml(it) {
    var tag = it.book ? "button" : "a";
    var attr = it.book ? ' type="button"' : ' href="' + it.page + '"';
    return "<" + tag + ' class="library-sub" data-book="' + it.id + '"' + attr + ">" +
      '<span class="library-sub-name">' + esc(it.name) + "</span>" +
      '<span class="library-sub-count">' + countOf(it.id) + " " + esc(it.unit) + "</span>" +
      "</" + tag + ">";
  }

  /* 分组卡：卡头一行名字 + 一句短注，下面是子入口网格，没有 desc。 */
  function groupCardHtml(g) {
    var members = g.members.map(entryOf).filter(Boolean);
    if (!members.length) return "";
    return '<section class="library-group" data-group="' + g.id + '">' +
      '<header class="library-group-head">' +
      '<span class="library-group-name">' + esc(g.name) + "</span>" +
      '<span class="library-group-note">' + esc(g.note) + "</span>" +
      "</header>" +
      '<div class="library-subs">' + members.map(subItemHtml).join("") + "</div>" +
      "</section>";
  }

  function render() {
    var grid = document.getElementById("library-grid");
    if (!grid) return;

    var html = "";
    SOLO.forEach(function (id) {
      var it = entryOf(id);
      if (!it) return;
      var tag = it.book ? "button" : "a";
      var attr = it.book ? ' type="button"' : ' href="' + it.page + '"';
      html +=
        "<" + tag + ' class="library-card library-solo" data-book="' + it.id + '"' + attr + ">" +
        '<span class="library-card-head">' +
        '<span class="library-card-name">' + esc(it.name) + "</span>" +
        '<span class="library-card-count">' + countOf(it.id) + " " + it.unit + "</span>" +
        "</span>" +
        '<span class="library-card-desc">' + esc(it.desc) + "</span>" +
        '<span class="library-card-go" aria-hidden="true">' + CHEVRON + "</span>" +
        (it.book ? '<span class="sr-only">进入' + esc(it.name) + "</span>" : "") +
        "</" + tag + ">";
    });

    GROUPS.forEach(function (g) { html += groupCardHtml(g); });

    grid.innerHTML = html;
  }

  var rail = null;
  var grid = null;
  var current = null;

  function engineOf(entry) {
    var ns = entry && entry.book ? window[entry.book] : null;
    return ns && typeof ns.config === "function" ? ns : null;
  }

  function itemsOf(entry) {
    var ns = engineOf(entry);
    var list = ns ? ns.items(entry && entry.id) : null;

    if (list && list.length) return list;
    return (window.SITE_INDEX || []).filter(function (p) {
      return p.book === entry.id && !p.isBook;
    });
  }

  var leavingBook = false;

  function paintHeader(entry) {
    var C = window.SiteChrome;
    if (!C) return;
    if (!entry) {
      C.setPage("");
      C.setSub("");
      return;
    }
    C.setPage(entry.name);
    C.setSub(pageSubOf(entry.id));
  }

  function pageSubOf(bookId) {
    var e = entryOf(bookId);
    var ns = engineOf(e);
    var cfg = ns ? ns.config(e && e.id) : null;
    return (cfg && cfg.pageSub) || "";
  }

  function enterBook(bookId) {
    var entry = entryOf(bookId);
    if (!entry) return;
    if (!entry.book) {

      location.href = entry.page;
      return;
    }
    var ns = engineOf(entry);
    var items = itemsOf(entry);
    if (!ns || !items.length) return;
    if (!window.ReaderEngine) return;

    if (current) {
      if (window.ReaderEngine.unmount) window.ReaderEngine.unmount(listHolder());
      window.ReaderEngine.current = null;
    }
    current = entry;

    if (grid) grid.hidden = true;
    if (rail) rail.hidden = false;
    paintHeader(entry);

    var listEl = listHolder();
    var cfg = ns.config(entry.id);
    cfg.items = items;
    cfg.root = listEl;
    cfg.reader = "#lib-gw-reader";

    cfg.openFrom = function () {
      var a = window.ReaderEngine.current;
      if (a && a.isOpen && a.isOpen()) return null;
      return function () { exitBook(); };
    };

    cfg.onHideReader = function () { return leavingBook ? "drop-list" : true; };

    var api = window.ReaderEngine.mount(cfg);
    if (!api) return;

    paintBack();
    window.scrollTo(0, 0);
  }

  function paintBack() {
    if (!window.SiteChrome || !window.SiteChrome.setPageAction) return;
    if (!current) { window.SiteChrome.setPageAction(null); return; }
    window.SiteChrome.setPageAction({
      label: "返回课外阅读",
      onclick: function () { exitBook(); }
    });
  }

  function listHolder() {
    return rail ? rail.querySelector("[data-lib-part='list']") : null;
  }

  function resetRail() {
    if (!rail) return;
    var listEl = listHolder();
    if (listEl) listEl.innerHTML = "";
    var search = rail.querySelector("[data-lib-part='search']");
    if (search) search.value = "";
    var seg = rail.querySelector("[data-lib-part='filter-seg']");
    if (seg) {
      Array.prototype.slice.call(seg.querySelectorAll("button")).forEach(function (b) {
        var on = b.getAttribute("data-filter") === "all";
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }
  }

  function exitBook() {

    leavingBook = true;
    if (window.ReaderEngine && window.ReaderEngine.current &&
        window.ReaderEngine.current.isOpen && window.ReaderEngine.current.isOpen()) {
      window.ReaderEngine.current.hideReader();
    }
    leavingBook = false;

    if (window.ReaderEngine && window.ReaderEngine.unmount) {
      window.ReaderEngine.unmount(listHolder());
      window.ReaderEngine.current = null;
    }
    current = null;
    if (rail) rail.hidden = true;
    if (grid) grid.hidden = false;
    paintHeader(null);
    paintBack();
    resetRail();
    window.scrollTo(0, 0);
  }

  function bindGrid() {
    if (!grid || grid.dataset.bound) return;
    grid.dataset.bound = "1";
    grid.addEventListener("click", function (e) {
      var card = e.target && e.target.closest ? e.target.closest("[data-book]") : null;
      if (!card) return;
      var entry = entryOf(card.getAttribute("data-book"));
      if (!entry || !entry.book) return;

      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      enterBook(entry.id);
    });
  }

  function boot() {
    grid = document.querySelector("[data-lib-view='grid']");
    rail = document.querySelector("[data-lib-view='book']");
    if (rail) rail.hidden = true;
    render();
    bindGrid();
    paintHeader(null);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.LibraryPage = {
    entries: function () { return ENTRIES.slice(); },
    countOf: countOf,

    open: enterBook,
    close: exitBook,
    current: function () { return current ? current.id : ""; },
    rail: function () { return rail; }
  };
})();
