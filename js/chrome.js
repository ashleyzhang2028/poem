(function () {
  "use strict";

  var IMG_ATTRS =
    'loading="lazy" decoding="async" referrerpolicy="no-referrer" ' +
    'width="26" height="26"';

  var SVG_HEAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';

  var GLYPHS = {

    mark:
      '<img src="/icons/icon.svg" alt="" aria-hidden="true" width="44" height="42" style="display:block;width:44px;height:42px;object-fit:contain;">',

    tabPoem:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 6.6C10.3 5.2 8.1 4.6 5.4 4.6v12.6c2.7 0 4.9.6 6.6 1.9 1.7-1.3 3.9-1.9 6.6-1.9V4.6c-2.7 0-4.9.6-6.6 2Z"/>' +
      '<path d="M12 6.6V19.1"/></svg>',

    tabClassic:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M5.4 4.6h5.2v14.8H5.4A1.4 1.4 0 0 1 4 18V6a1.4 1.4 0 0 1 1.4-1.4Z"/>' +
      '<path d="M10.6 4.6h8A1.4 1.4 0 0 1 20 6v12a1.4 1.4 0 0 1-1.4 1.4h-8"/>' +
      '<path d="M13.2 9.2h4.2M13.2 13h4.2"/></svg>',

    tabLibrary:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="3.6" y="4.4" width="5.4" height="15.2" rx="1"/>' +
      '<rect x="9.6" y="4.4" width="5.4" height="15.2" rx="1"/>' +
      '<path d="M16.4 4.9l3.2.85a1.1 1.1 0 0 1 .78 1.35l-3.4 12.7"/>' +
      '<path d="M5.6 8.4h1.4M11.6 8.4h1.4"/></svg>',

    tabSearch:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="10.6" cy="10.6" r="6.2"/>' +
      '<path d="M15.2 15.2 20.4 20.4"/></svg>',

    tabGame:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<g transform="rotate(0 12 12)"><path d="M12 12.7c-1.95-1.55-2.95-3.4-2.95-5.3 0-1.95 1.02-3.6 2.95-5.5 1.93 1.9 2.95 3.55 2.95 5.5 0 1.9-1 3.75-2.95 5.3Z"/></g>' +
      '<g transform="rotate(72 12 12)"><path d="M12 12.7c-1.95-1.55-2.95-3.4-2.95-5.3 0-1.95 1.02-3.6 2.95-5.5 1.93 1.9 2.95 3.55 2.95 5.5 0 1.9-1 3.75-2.95 5.3Z"/></g>' +
      '<g transform="rotate(144 12 12)"><path d="M12 12.7c-1.95-1.55-2.95-3.4-2.95-5.3 0-1.95 1.02-3.6 2.95-5.5 1.93 1.9 2.95 3.55 2.95 5.5 0 1.9-1 3.75-2.95 5.3Z"/></g>' +
      '<g transform="rotate(216 12 12)"><path d="M12 12.7c-1.95-1.55-2.95-3.4-2.95-5.3 0-1.95 1.02-3.6 2.95-5.5 1.93 1.9 2.95 3.55 2.95 5.5 0 1.9-1 3.75-2.95 5.3Z"/></g>' +
      '<g transform="rotate(288 12 12)"><path d="M12 12.7c-1.95-1.55-2.95-3.4-2.95-5.3 0-1.95 1.02-3.6 2.95-5.5 1.93 1.9 2.95 3.55 2.95 5.5 0 1.9-1 3.75-2.95 5.3Z"/></g>' +
      '<circle cx="12" cy="12" r="1.55" fill="#cf9a4a" stroke="none"/></svg>',

    gear:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="3.2"/>' +
      '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-.45 3.11 2 2 0 0 1-2.18-.36l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-1.34 1.88 2 2 0 0 1-2.34-.97 2 2 0 0 1-.32-1.11v-.09A1.65 1.65 0 0 0 9 18.98a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-3.11-.45 2 2 0 0 1 .36-2.18l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-1.88-1.34 2 2 0 0 1 .97-2.34 2 2 0 0 1 1.11-.32h.09A1.65 1.65 0 0 0 5.02 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 .45-3.11 2 2 0 0 1 2.18.36l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 1.34-1.88 2 2 0 0 1 2.34.97 2 2 0 0 1 .32 1.11v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 3.11.45 2 2 0 0 1-.36 2.18l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 1.88 1.34 2 2 0 0 1-.97 2.34 2 2 0 0 1-1.11.32h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',

    tabMineImg:
      '<img class="avatar-img" src="__SRC__" alt="" ' + IMG_ATTRS + " />",

    back:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M14.4 5.4 7.8 12l6.6 6.6"/></svg>',

    close:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6"/></svg>',

    daily:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M4 18.6h16"/>' +
      '<path d="M7.2 18.6V13l2.8-2 2.6 2 2.4-3.2L18.4 11v7.6"/></svg>'
  };

  var ROUTES = {
    home: "/",

        game: "/dahui/",
    poems: "/poems/",
    library: "/library/",
    classic: "/classic/",
    yuefu: "/yuefu/",
    tangshi: "/tangshi/",
    songci: "/songci/",
    guwen: "/guwen/",
    zhaoming: "/zhaoming/",
    yuefu: "/yuefu/",
    yuanqu: "/yuanqu/",
    jinxiandai: "/jinxiandai/",
    chengyu: "/chengyu/",
    changshi: "/changshi/",
    search: "/search/",
    mine: "/mine/",
    settings: "/settings/",
    login: "/login/",
    admin: "/admin/",
    plans: "/plans/",
    terms: "/terms/",
    privacy: "/privacy/"
  };

  function routeHref(key) {
    return ROUTES[key] || ROUTES.home;
  }

  var APP_NAME = "跬步";

  var DEFAULT_SUB = "";

  function bodyData(key) {
    var el = document.body;
    return el ? el.getAttribute("data-" + key) : null;
  }

  function pageKey() {
    var v = bodyData("nav");
    if (v) return v;
    var p = currentPath();
    if (/^\/library\/?$/.test(p) || /^\/library\/index\.html$/.test(p)) return "library";
    if (/^\/poems\/?$/.test(p) || /^\/poems\/index\.html$/.test(p)) return "poems";
    if (/^\/dahui\/?$/.test(p) || /^\/dahui\/index\.html$/.test(p)) return "game";
    if (/^\/search\/?$/.test(p) || /^\/search\/index\.html$/.test(p)) return "search";
    if (/^\/classic\/?$/.test(p) || /^\/classic\/index\.html$/.test(p)) return "classic";
    if (/^\/yuefu\/?$/.test(p) || /^\/yuefu\/index\.html$/.test(p)) return "yuefu";
    if (/^\/tangshi\/?$/.test(p) || /^\/tangshi\/index\.html$/.test(p)) return "tangshi";
    if (/^\/songci\/?$/.test(p) || /^\/songci\/index\.html$/.test(p)) return "songci";
    if (/^\/guwen\/?$/.test(p) || /^\/guwen\/index\.html$/.test(p)) return "guwen";
    if (/^\/zhaoming\/?$/.test(p) || /^\/zhaoming\/index\.html$/.test(p)) return "zhaoming";
    if (/^\/yuefu\/?$/.test(p) || /^\/yuefu\/index\.html$/.test(p)) return "yuefu";
    if (/^\/yuanqu\/?$/.test(p) || /^\/yuanqu\/index\.html$/.test(p)) return "yuanqu";
    if (/^\/jinxiandai\/?$/.test(p) || /^\/jinxiandai\/index\.html$/.test(p)) return "jinxiandai";
    if (/^\/chengyu\/?$/.test(p) || /^\/chengyu\/index\.html$/.test(p)) return "chengyu";
    if (/^\/changshi\/?$/.test(p) || /^\/changshi\/index\.html$/.test(p)) return "changshi";
    if (/^\/mine\/?$/.test(p) || /^\/mine\/index\.html$/.test(p)) return "mine";
    if (/^\/settings\/?$/.test(p) || /^\/settings\/index\.html$/.test(p)) return "settings";
    if (/^\/progress\/?$/.test(p) || /^\/progress\/index\.html$/.test(p)) return "progress";

        if (/^\/settings\/general\/?$/.test(p)) return "settings/general";
    if (/^\/settings\/recite\/?$/.test(p)) return "settings/recite";
    if (/^\/settings\/lists\/?$/.test(p)) return "settings/lists";
    if (/^\/settings\/reader\/?$/.test(p)) return "settings/reader";
    if (/^\/settings\/reports\/?$/.test(p)) return "settings/reports";

    if (/^\/login\/?$/.test(p) || /^\/login\/index\.html$/.test(p)) return "login";
    if (/^\/admin\/?$/.test(p) || /^\/admin\/index\.html$/.test(p)) return "admin";

    if (/^\/plans\/?$/.test(p) || /^\/plans\/index\.html$/.test(p)) return "plans";
    if (/^\/self-check\/?$/.test(p) || /^\/self-check\/index\.html$/.test(p)) return "selfCheck";
    if (/^\/terms\/?$/.test(p) || /^\/terms\/index\.html$/.test(p)) return "terms";
    if (/^\/privacy\/?$/.test(p) || /^\/privacy\/index\.html$/.test(p)) return "privacy";
    return "home";
  }

  var pageOverride = "";

  function pageSub() {
    if (subOverride) return subOverride;
    return bodyData("sub") || DEFAULT_SUB;
  }

  var subOverride = "";

  function paintSubText(text) {
    subOverride = text == null ? "" : String(text);
    var bars = readBars();
    bars.forEach(function (bar) {
      var el = bar.querySelector("#brand-sub");
      if (!el) return;
      var want = subOverride || pageSub();
      if (el.textContent !== want) el.textContent = want;
    });
  }

  function dockEnabled() {
    return bodyData("dock") !== "off";
  }

  var headerStack = [];

  function topAction() {
    return headerStack.length > 1 ? headerStack[headerStack.length - 1] : null;
  }

  function markSvg() {
    return GLYPHS.mark;
  }

  var pageAction = null;

  function readerLayerOpen() {
    var boxes = document.querySelectorAll(".reader");
    for (var i = 0; i < boxes.length; i++) {
      if (!boxes[i].hidden) return true;
    }
    return false;
  }

  function isReaderBar(bar) {
    return !!(bar && bar.parentNode && bar.parentNode.classList &&
      bar.parentNode.classList.contains("reader"));
  }

  function headerHtml(isReader) {
    var sub = pageSub();

    var action = isReader ? topAction() : (readerLayerOpen() ? null : pageAction);
    var right;

    var rightKey = "";
    if (isReader) {

      if (action) {
        rightKey =
          '<button type="button" class="top-act" id="top-act">' +
          '<span class="top-act-icon" aria-hidden="true">' + GLYPHS.back + "</span>" +
          '<span class="sr-only">' + action.label + "</span></button>";
      }
    } else if (readerLayerOpen()) {

    } else if (pageAction) {

      rightKey =
        '<button type="button" class="top-act" id="top-act">' +
        '<span class="top-act-icon" aria-hidden="true">' + GLYPHS.back + "</span>" +
        '<span class="sr-only">' + pageAction.label + "</span></button>";
    } else if (!topLevelPage() && pageTopAction()) {

      rightKey =
        '<a class="top-act" id="top-act-link" href="' + pageTopAction().href + '"' +
        ' title="' + escapeHtml(pageTopAction().label) + '" aria-label="' + escapeHtml(pageTopAction().label) + '">' +
        '<span class="top-act-icon" aria-hidden="true">' + pageTopAction().glyph + "</span></a>";
    } else if (!topLevelPage()) {

      rightKey =
        '<a class="top-act" id="top-back" href="' + pageBackHref() + '"' +
        ' title="返回" aria-label="返回">' +
        '<span class="top-act-icon" aria-hidden="true">' + GLYPHS.back + "</span></a>";
    }

    var right = rightKey;

    var page = pageTitle();
    var pageHtml =
      '<span class="brand-page" id="brand-page">' +
      '<span class="brand-page-text" id="brand-page-text">' + escapeHtml(page) + "</span>" +
      "</span>";

    return (
      '<div class="brand">' +
      '<span class="brand-icon brand-mark" aria-hidden="true">' + markSvg() + "</span>" +
      '<span class="brand-text">' +
      '<span class="brand-name-row"><h1 id="brand-name">' + APP_NAME + "</h1>" + pageHtml + "</span>" +
      '<p class="brand-sub" id="brand-sub">' + escapeHtml(sub) + "</p>" +
      "</span>" +
      "</div>" + right
    );
  }

  function firstActAnchor(bar) {
    var el = bar.querySelector(".top-act");
    return el || null;
  }

  function pageTopAction() {
    var v = bodyData("top-action");
    if (v === "settings") return { href: routeHref("settings"), label: "设置", glyph: GLYPHS.gear };
    return null;
  }

    function topLevelPage() {
    var key = pageKey();
    return key === "home" || key === "library" || key === "game" ||
      key === "search" || key === "mine";
  }

    function pageBackHref() {
    var back = bodyData("back");
    if (back && /^\/[^\/\s]/.test(back)) return back;

    var route = pageBackRoute(pageKey());
    if (route) return route;
    if (dockEnabled()) return routeHref("mine");
    return ROUTES.home;
  }

    var BACK_ROUTES = {
    poems: routeHref("library"),
    classic: routeHref("library"),
    yuefu: routeHref("library"),
    tangshi: routeHref("library"),
    songci: routeHref("library"),
    guwen: routeHref("library"),
    zhaoming: routeHref("library"),
    yuanqu: routeHref("library"),
    jinxiandai: routeHref("library"),
    chengyu: routeHref("library"),
    changshi: routeHref("library"),

    settings: routeHref("mine"),

    progress: ROUTES.home,

    "settings/general": routeHref("settings"),
    "settings/recite": routeHref("settings"),
    "settings/lists": routeHref("settings"),
    "settings/reader": routeHref("settings"),
    "settings/reports": routeHref("settings"),

    selfCheck: "/settings/general/",
    plans: routeHref("settings"),
    login: routeHref("mine"),

    terms: ROUTES.home,
    privacy: ROUTES.home
  };

  function pageBackRoute(key) {
    return BACK_ROUTES[key] || "";
  }

  function pageTitle() {

    if (pageOverride) return pageOverride;
    var v = bodyData("page");
    if (v != null) return v;
    var k = pageKey();
    if (k === "library") return "课外阅读";
    if (k === "game") return "古诗词大会";
    if (k === "poems") return "课内古诗词";
    if (k === "mine") return "我的";
    if (k === "search") return "搜索";
    if (k === "classic") return "小古文";
    if (k === "yuefu") return "乐府集";
    if (k === "tangshi") return "唐诗三百首";
    if (k === "songci") return "宋词三百首";
    if (k === "guwen") return "古文观止";
    if (k === "zhaoming") return "昭明文选";
    if (k === "yuefu") return "乐府诗选";
    if (k === "yuanqu") return "元曲三百首";
    if (k === "jinxiandai") return "近现代诗词";
    if (k === "chengyu") return "中华成语故事";
    if (k === "changshi") return "文学常识";
    return "";
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

    var DOCK_ITEMS = [
    { key: "home", href: "/", icon: GLYPHS.tabPoem, label: "背诵", desc: "课内古诗词，按当前复习算法安排复习" },
    { key: "library", href: "/library/", icon: GLYPHS.tabLibrary, label: "课外", desc: "课内诗词 / 小古文 / 乐府集 / 唐诗 / 宋词 / 元曲 / 古文观止 / 近现代诗词 / 昭明文选 / 中华成语故事 / 文学常识" },
        { key: "game", href: "/dahui/", icon: GLYPHS.tabGame, label: "大会", desc: "古诗词大会：比拼与考试都在这一页" },
    { key: "search", href: "/search/", icon: GLYPHS.tabSearch, label: "搜索", desc: "全站篇目一次搜遍" },
    { key: "mine", href: "/mine/", icon: GLYPHS.tabMineImg, label: "我的", desc: "头像 / 昵称 / 账号 / 本机数据" }
  ];

  function dockKey(key) {
    if (key === "settings") return "mine";

        if (key === "game") return "game";

    if (key === "classic" || key === "yuefu" || key === "tangshi" || key === "songci" ||
        key === "guwen" || key === "zhaoming" || key === "yuanqu" ||
        key === "jinxiandai" || key === "chengyu" || key === "changshi") return "library";

        if (key === "poems") return "library";

    if (key === "progress") return "home";
    return key;
  }

  function dockHtml() {
    var key = dockKey(pageKey());
    var items = DOCK_ITEMS;
    var html = '<nav class="dock" id="site-dock" aria-label="主导航"><div class="dock-inner">';
    items.forEach(function (it) {
      var on = key === it.key;

      var tag = it.key === "mine" ? "a" : "button";
      html +=
        "<" + tag + ' ' + (tag === "a" ? 'href="' + it.href + '"' : 'type="button"') +
        ' class="dock-item' + (on ? " active" : "") + '"' +
        (it.key === "mine" ? ' data-dock-avatar="1"' : "") +
        ' data-nav-go="' + it.key + '" data-href="' + it.href + '"' +
        (on ? ' aria-current="page"' : "") +
        ' title="' + it.desc + '">' +
        '<span class="dock-icon" aria-hidden="true">' + dockIcon(it) + "</span>" +
        '<span class="dock-label">' + it.label + "</span>" +
        "</button>";
    });
    return html + "</div></nav>";
  }

  function avatarMod() {
    return (typeof globalThis !== "undefined" && globalThis.Avatar) || null;
  }

  function backingStore() {
    try {
      return (typeof globalThis !== "undefined" && globalThis.localStorage) || null;
    } catch (e) { return null; }
  }

  function dockIcon(it) {

    if (it.icon.indexOf("__SRC__") < 0) return it.icon;
    var A = avatarMod();
    if (A && A.html) {

      try { return A.html(backingStore(), { dock: true }); } catch (e) { }
    }
    return GLYPHS.tabMineImg.replace("__SRC__", "");
  }

  function renderBar(bar) {
    var keep = null;

    var extras = bar.querySelectorAll(":scope > .count-badge");
    if (extras.length) {
      keep = [].slice.call(extras);
      keep.forEach(function (el) { bar.removeChild(el); });
    }
    bar.innerHTML = headerHtml(isReaderBar(bar));
    if (!keep) return;

    var act = firstActAnchor(bar);
    keep.forEach(function (el) {
      if (act) bar.insertBefore(el, act);
      else bar.appendChild(el);
    });
  }

  function mount() {

    var bar = document.querySelector(".topbar");
    var made = false;
    if (!bar) {
      bar = document.createElement("header");
      bar.className = "topbar";
      made = true;
    }

    renderBar(bar);
    if (made) {
      var app = document.querySelector(".app");
      (app || document.body).insertBefore(bar, (app || document.body).firstChild);
    }
    bindHeader();

    if (!dockEnabled()) {
      document.body.classList.add("no-dock");
    } else {
      var dock = document.getElementById("site-dock");
      if (!dock) {
        var wrap = document.createElement("div");
        wrap.innerHTML = dockHtml();
        dock = wrap.firstChild;
        document.body.appendChild(dock);
      }
      bindDock(dock);
      mountDockAvatarWatch();
    }

    refreshAccount();

    var ev = document.createEvent("Event");
    ev.initEvent("chrome:ready", true, true);
    document.dispatchEvent(ev);
  }

    function refreshAccount() {
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    var M = (g && g.AccountApi) || null;
    if (!M || typeof M.refreshMe !== "function") return;
    try {
      Promise.resolve(M.refreshMe({})).then(function (r) {
        if (!r || !r.ok) return;
        var ev = document.createEvent("Event");
        ev.initEvent("account:ready", true, true);
        document.dispatchEvent(ev);
      })["catch"](function () {  });
    } catch (e) {  }
  }

  function bindHeader() {

  }

  function readBars() {
    var list = [];
    var page = document.querySelector(".app > .topbar");
    if (page) list.push(page);
    document.querySelectorAll(".reader > .topbar").forEach(function (el) {
      if (list.indexOf(el) === -1) list.push(el);
    });

    if (!list.length) {
      var any = document.querySelector(".topbar");
      if (any) list.push(any);
    }
    return list;
  }

  function bindPageAction() {
    var bar = document.querySelector(".app > .topbar");
    if (!bar || bar.dataset.pageActionBound) return;
    bar.dataset.pageActionBound = "1";
    bar.addEventListener("click", function (e) {
      if (!pageAction || !pageAction.onclick) return;
      var btn = e.target && e.target.closest ? e.target.closest("#top-act") : null;
      if (!btn || btn.closest(".reader")) return;
      pageAction.onclick(e);
    });
  }

  function bindDock(dock) {
    dock.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest("[data-nav-go]") : null;
      if (!btn) return;
      e.preventDefault();
      var dest = btn.getAttribute("data-nav-go");
      var want = routeHref(dest);

      if (currentRoute() === dest) {
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      location.href = want;
    });
  }

  function currentPath() {
    var p = location.pathname.replace(/\/index\.html$/, "/");
    p = p.replace(/\/+$/, "");
    return p || "/";
  }

    function currentRoute() {
    var p = currentPath();
    var key;
    for (key in ROUTES) {
      if (trimHref(routeHref(key)) === p) return key;
    }
    return "home";
  }

    function trimHref(href) {
    var v = String(href).split("#")[0].split("?")[0];
    v = v.replace(/\/index\.html$/, "/").replace(/\/+$/, "");
    return v || "/";
  }

  function openSettings() {
    location.href = "/settings/";
  }

  function dockMineItem() {
    return document.querySelector('.dock-item[data-nav-go="mine"]');
  }

  function dockMineHtml() {
    var hit = null;
    DOCK_ITEMS.forEach(function (it) { if (it.key === "mine") hit = it; });
    return hit ? dockIcon(hit) : "";
  }

  function refreshDockAvatar() {
    if (!dockEnabled()) return;
    var item = dockMineItem();
    var ic = item ? item.querySelector(".dock-icon") : null;
    if (!ic) return;

        clearDockAvatar();
    var want = dockMineHtml();
    if (!want || ic.innerHTML === want) return;

    ic.innerHTML = want;
  }

    function clearDockAvatar() {
    var item = dockMineItem();
    var ic = item ? item.querySelector(".dock-icon") : null;
    if (!ic || !ic.innerHTML) return;
    var want = dockMineHtml();
    if (!want || ic.innerHTML === want) return;

    ic.innerHTML = GLYPHS.tabMineImg.replace("__SRC__", "");
  }

    function paintDock() {
    var nav = document.getElementById("site-dock");
    if (!nav) return;
    var on = dockKey(pageKey());
    var items = nav.querySelectorAll(".dock-item");
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var hit = it.getAttribute("data-nav-go") === on;
      if (it.classList) it.classList.toggle("active", hit);
      if (hit) it.setAttribute("aria-current", "page");
      else it.removeAttribute("aria-current");
    }
  }

  function mountDockAvatarWatch() {
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) refreshDockAvatar();
    });
    window.addEventListener("pageshow", refreshDockAvatar);
    window.addEventListener("storage", refreshDockAvatar);
    window.addEventListener("poem:avatar-change", refreshDockAvatar);
        window.addEventListener("family-change", refreshDockAvatar);
    document.addEventListener("family-change", refreshDockAvatar);
  }

  window.SiteChrome = {
    glyph: function (name) {
      return GLYPHS[name] || "";
    },

    setHeaderAction: function (action) {

      if (action) {
        if (!headerStack.length) headerStack.push(null);
        headerStack.push(action);
      } else if (headerStack.length > 1) {
        headerStack.pop();
      } else {
        headerStack.length = 0;
      }
      var bars = readBars();
      bars.forEach(function (bar) {
        renderBar(bar);
        bindHeader();

        if (!isReaderBar(bar) || !action || !action.onclick) return;
        var btn = bar.querySelector("#top-act");
        if (!btn) return;
        btn.setAttribute("type", "button");
        btn.addEventListener("click", action.onclick);
      });
    },

    setSub: function (text) { paintSubText(text); },

    setPageAction: function (action) {
      pageAction = action || null;

      var bars = readBars();
      bars.forEach(function (bar) {
        if (isReaderBar(bar)) return;
        renderBar(bar);
      });
      if (!pageAction || !pageAction.onclick) return;

      bindPageAction();
    },

    badge: function () {
      var bar = document.querySelector(".app > .topbar") || document.querySelector(".topbar");
      if (!bar) return null;
      var el = bar.querySelector(":scope > .count-badge");
      if (el) return el;

      el = document.createElement("span");
      el.className = "count-badge";
      var act = firstActAnchor(bar);
      if (act) bar.insertBefore(el, act);
      else bar.appendChild(el);
      return el;
    },

    openSettings: openSettings,

        setDock: function () { paintDock(); },

    setPage: function (name) {
      pageOverride = name == null ? "" : String(name);
      var bars = readBars();
      bars.forEach(function (bar) {
        var el = bar.querySelector("#brand-page-text");
        if (el) el.textContent = pageTitle();
      });
    },

    refreshUser: function () {
      readBars().forEach(function (bar) {
        if (isReaderBar(bar)) return;
        renderBar(bar);
      });
      refreshDockAvatar();
    },
    appName: APP_NAME
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
