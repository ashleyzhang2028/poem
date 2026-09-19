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
      name: "课外必背小古文",
      book: "ClassicBook",
      short: "小古文",
      page: "/classic/",
      unit: "篇",
      desc: "蒙学识字、寓言故事到诸子论道，百字上下，最适合起步"
    },
    {
      id: "tangshi",
      name: "唐诗三百首",
      book: "TangshiBook",
      short: "唐诗",
      page: "/tangshi/",
      unit: "首",
      desc: "按卷一至卷八编排：五言古诗、七言乐府、律诗、绝句"
    },
    {
      id: "songci",
      name: "宋词三百首",
      book: "SongciBook",
      short: "宋词",
      page: "/songci/",
      unit: "首",
      desc: "按词牌分组，一调之下诸家并列，可直接比对同调之作"
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
      id: "zhaoming",
      name: "昭明文选",
      book: "ZhaomingBook",
      short: "文选",
      page: "/zhaoming/",
      unit: "篇",
      desc: "六十卷按赋、诗、骚、七等三十九类文体编排，现存最早的诗文总集"
    },
    {
      id: "yuanqu",
      name: "元曲三百首",
      book: "YuanquBook",
      short: "元曲",
      page: "/yuanqu/",
      unit: "首",
      desc: "小令与套数按宫调编排，质朴自然，曲白相生"
    }
  ];

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
      tangshi: "POEMS_TANGSHI",
      songci: "POEMS_SONGCI",
      guwen: "POEMS_GUWEN",
      zhaoming: "POEMS_ZHAOMING",
      yuanqu: "POEMS_YUANQU"
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

  function render() {
    var grid = document.getElementById("library-grid");
    if (!grid) return;
    var html = "";
    ENTRIES.forEach(function (it) {
      var n = countOf(it.id);

      var tag = it.book ? "button" : "a";
      var attr = it.book ? ' type="button"' : ' href="' + it.page + '"';
      html +=
        "<" + tag + ' class="library-card" data-book="' + it.id + '"' + attr + ">" +
        '<span class="library-card-head">' +
        '<span class="library-card-name">' + esc(it.name) + "</span>" +
        '<span class="library-card-count">' + n + " " + it.unit + "</span>" +
        "</span>" +
        '<span class="library-card-desc">' + esc(it.desc) + "</span>" +
        '<span class="library-card-go" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
        'stroke-linecap="round" stroke-linejoin="round"><path d="M9.4 5.6 15.8 12l-6.4 6.4"/></svg>' +
        "</span>" +
        (it.book ? '<span class="sr-only">进入' + esc(it.name) + "</span>" : "") +
        "</" + tag + ">";
    });
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
    var list = ns ? ns.items() : null;

    if (list && list.length) return list;
    return (window.SITE_INDEX || []).filter(function (p) {
      return p.book === entry.id && !p.isBook;
    });
  }

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
    var cfg = ns ? ns.config() : null;
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
    var cfg = ns.config();
    cfg.items = items;
    cfg.root = listEl;
    cfg.reader = "#lib-gw-reader";

    cfg.openFrom = function () {
      var a = window.ReaderEngine.current;
      if (a && a.isOpen && a.isOpen()) return null;
      return function () { exitBook(); };
    };

    cfg.onHideReader = function () { return true; };

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

    if (window.ReaderEngine && window.ReaderEngine.current &&
        window.ReaderEngine.current.isOpen && window.ReaderEngine.current.isOpen()) {
      window.ReaderEngine.current.hideReader();
    }

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
      var card = e.target && e.target.closest ? e.target.closest(".library-card") : null;
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
