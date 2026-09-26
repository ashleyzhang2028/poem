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

    // 「古诗词大会」那一格（底栏正中间那一颗）。形状是**五瓣花** ——
    // 取自「飞花令」：五片等分花瓣（每片 72°）加一颗花心。
    // 花心用**暖金实心**（#cf9a4a），是五格里唯一一处彩色 ——
    // 底栏其余四格都是素色线稿（`currentColor`），中间这一颗靠这一点暖色
    // 「跳出来」，不用光晕、不用底衬，也不随选中态变色（Issue #342）。
    // 花瓣路径只写一片，其余四片用 `<g rotate>` 绕 (12,12) 转 72° 得来：
    // 这样五瓣**严格等分**，手写五个路径一定会歪。
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

    // 「古诗词大会」那一格的去处：**它自己的一页** `/dahui/`（Issue #356）。
    //
    // ⚠️ 这一条**推翻**了两条老口径，别再把它们当依据：
    //    ① §4.15 ⑧「不新开页面，就地叠在 `/poems/` 那一层」——
    //       用户 2026-09-26 明确要求「拆成独立页，不应该显示各个古诗列表和详情页，
    //       而是各种试题，模拟及竞赛」，于是大会有了自己的页；
    //    ② §4.70 ④「那一格指向 `/poems/?game=1`」—— 那是叠层时代的地址，
    //       现在是 `/dahui/`；老地址留着一条**改道**（见 `js/game.js` 的 `init()`）。
    //
    // 用具名目录而不是查询参数的理由有两条：全站所有页面都是
    // 「目录 + 自己的 index.html」（`/poems/`、`/library/`、`/mine/` ……），
    // `?game=1` 是全站唯一一条参数路由，得靠 `currentRoute()` 专门特判；
    // 而且参数路由给出的地址**不是一页**，用户存下来的书签也就不是。
    // 名字取拼音 `dahui`：与 `/yuanqu/`、`/chengyu/`、`/zhaoming/` 同一条命名习惯。
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

    // 设置的四张二级页与几个「附在一页底下」的小页。
    // ⚠️ 它们各有各的路由键，**不能一律并进 `settings`** —— 并了的话
    //    `pageBackHref()` 那份表就无从区分「上一层是设置主页」与
    //    「上一层是通用页」（自检在通用页底下）。
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

  // 这一页是不是**底栏五格那一层自己**（背诵 / 课外 / 大会 / 搜索 / 我的）。
  //
  // ⚠️ 这一层右上角**一律不摆返回键**（Issue #370 用户原话：「如果在……
  //    这 5 个有底部导航栏的各自首页，右上角不应该再有后退按钮」）——
  //    底栏就在脚下，五个首页之间彼此直达，「返回」这两个字在这一层
  //    没有上一层可指。从前它们是「没写 `data-back` → 兜底去我的」，
  //    于是每一页右上角都挂着一颗去「我的」的键，与底栏最后一格重复。
  //
  // ⚠️ 判据是 `pageKey()` 而不是「有没有底栏」—— 底栏那一层是这五个键，
  //    「我的」页在底栏上但 `dockKey("settings")` 也是 `mine`；反过来
  //    `/self-check/` 有底栏却**不是**首页（它挂在设置底下，要留返回键）。
  function topLevelPage() {
    var key = pageKey();
    return key === "home" || key === "library" || key === "game" ||
      key === "search" || key === "mine";
  }

  // 顶栏那颗返回键的落点。
  //
  // 三条判据，**次序就是这个优先级**：
  //   ① 页面自己在 body 上写的 `data-back` —— 页面对「上一层是谁」比
  //      chrome 清楚（`/reset/` 的上一层是登录页，不是「我的」）；
  //   ② 没写的话按**路由**推一层（`pageBackRoute()` 那张表）——
  //      「详情页回各自的索引页」就是靠这一条：`/classic/` → `/library/`、
  //      `/settings/general/` → `/settings/`、`/progress/` → `/` ……
  //   ③ 还落不下来（根那一页、或一张表里没登记的新页）才认底栏那一颗
  //      「我的」。从前这一支直接去首页，而顶栏上那颗键的 title 与
  //      aria-label 都写着「返回」—— 两者对不上时它落在哪儿谁也说不准
  //      （后台那一页正因为没写 `data-back` 走到这里，Issue #320）。
  //
  // ⚠️ 顶部五格那一层**不该有这颗键**（见 `topLevelPage()`）；
  //    `pageBackHref()` 自身不必再判首页。
  function pageBackHref() {
    var back = bodyData("back");
    if (back && /^\/[^\/\s]/.test(back)) return back;

    var route = pageBackRoute(pageKey());
    if (route) return route;
    if (dockEnabled()) return routeHref("mine");
    return ROUTES.home;
  }

  // 「这一页的上一层是谁」——**全站只在这一张表里给一次**（Issue #370）。
  //
  // 表里只写**上一层不是底栏五格**的那些页：
  //   · 五个有底栏的首页（`/` `/library/` `/dahui/` `/search/` `/mine/`）
  //     自己就是一层，右上角**不该有**返回键 —— 所以它们不在这张表里；
  //   · 一部集子（`/classic/` `/tangshi/` …）的上一层是课外阅读入口
  //     `/library/`；点进正文之后那颗键仍回**这一页自己**（阅读器那一层
  //     由 `js/reader-core.js` 的 `backToList` 管），所以它得在表里；
  //   · 设置的四张二级页、`/progress/`、自检、用户对比、法务三页同理。
  //
  // ⚠️ 这张表**不替代** `data-back`：页面上写着的仍然优先（见 `pageBackHref()`）。
  //    两处写的是同一件事 —— 表这一处只是给「没写的页」一个正确的兜底，
  //    免得它们一律掉到「我的」。
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

  // 底栏五格（Issue #342：用户要求把「古诗词大会」挪进导航栏正中间）。
  //
  // ⚠️ 次序是**有含义的**，不是随手排的：「大会」插在**第三格**，
  //    因为它左边两格（背诵 / 课外）都是「读」，右边两格（搜索 / 我的）都是「用」，
  //    中间这一格是「玩」—— 五格正中最醒目，正是用户要的「很吸引人」。
  //    改次序前先读这一节：`docs/architecture.md` §4.66 ①。
  //
  // ⚠️ 这一条**推翻**了 §4.66 ⑨ 那句「不在底栏加第五格（底栏四格已满）」。
  //    那是当时（还在谈考试层落点）的不加，用户 2026-09-26 明确要求加 ——
  //    口径改了，文档也跟着改，不是不管它。
  var DOCK_ITEMS = [
    { key: "home", href: "/", icon: GLYPHS.tabPoem, label: "背诵", desc: "课内古诗词，按当前复习算法安排复习" },
    { key: "library", href: "/library/", icon: GLYPHS.tabLibrary, label: "课外", desc: "课内诗词 / 小古文 / 乐府集 / 唐诗 / 宋词 / 元曲 / 古文观止 / 近现代诗词 / 昭明文选 / 中华成语故事 / 文学常识" },
    // ⚠️ 这一格的 `desc`（就是 `title`）**不许把四个玩法的名字列出来** ——
    //    「飞花令 / 题库复习 / 模拟考试 / 正式考试」这几个名字的落点只有三处：
    //    `js/entitlement.js`（能力表）、`js/exam.js`（形态表）、`js/game.js`（页面层）。
    //    底栏这里再抄一份，就多一处迟早对不上的（`test/ops.test.js` 有断言守着）。
    { key: "game", href: "/dahui/", icon: GLYPHS.tabGame, label: "大会", desc: "古诗词大会：比拼与考试都在这一页" },
    { key: "search", href: "/search/", icon: GLYPHS.tabSearch, label: "搜索", desc: "全站篇目一次搜遍" },
    { key: "mine", href: "/mine/", icon: GLYPHS.tabMineImg, label: "我的", desc: "头像 / 昵称 / 账号 / 本机数据" }
  ];

  function dockKey(key) {
    if (key === "settings") return "mine";

    // `/dahui/` 那一页的 body 上写的就是 `data-nav="game"`（`pageKey()` 取它），
    // 于是这里不必猜、也不必看查询串：底栏中点亮的正是中间那一格。
    // `/poems/` 上那颗「古诗词大会」入口**不再**就地掀层（Issue #356 拆页），
    // 于是 `js/game.js` 也不必再临时改 `data-nav` 了。
    if (key === "game") return "game";

    if (key === "classic" || key === "yuefu" || key === "tangshi" || key === "songci" ||
        key === "guwen" || key === "zhaoming" || key === "yuanqu" ||
        key === "jinxiandai" || key === "chengyu" || key === "changshi") return "library";

    // `/poems/`（大会那层没掀开时）仍归「课外」—— 它先是诗词列表。
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

  // 顶栏就位时**问一次服务端「我是谁」**（Issue #274）。
  //
  // 为什么放在这里、而不是各页各自写一遍：`js/chrome.js` 是**每一张有导航的
  // 页面都要加载的那一份**（它负责把顶栏 / 底栏装上去），所以这里的一发
  // 覆盖「从首页到设置」全部页面 —— 而各页自己写的话，就是「有的页认、
  // 有的页不认」，正是用户报的那个症状。
  //
  // ⚠️ 它只做一件事：把服务端那份答案取回来（`AccountApi.refreshMe()`
  //    会写进 `poem_plan_v1`，并喊一声 `entitlementchange`），
  //    **不碰任何界面**。要跟着这一份答案重画的页面去听那个事件
  //    （`js/settings-nav.js` 早就在听了），页面自己那一处该不该重画、
  //    画成什么样，仍归页面自己。
  //
  // ⚠️ 结果与三档：`E_NO_SESSION`（真的没登录）/ 没配服务端 / 连不上，
  //    都**什么都不做** —— 未登录是正常状态，不是错误，不该弹任何提示。
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

  // 当前这一页是哪个「路由键」。
  //
  // ⚠️ 这里从前有一段特判：**先按整条地址（含查询串）比，再退回去掉查询串比** ——
  //    因为那时「大会」那一格的地址是 `/poems/?game=1`，与 `/poems/` 自己的路由
  //    **路径相同、只差一个查询串**，只看 pathname 的话 `game` 会把 `poems` 盖住。
  //    大会拆成 `/dahui/` 一页之后（Issue #356），两条路由的路径**不同了**，
  //    查询串不再是判据 —— 那段特判连同它的坑一起删掉。
  function currentRoute() {
    var p = currentPath();
    var key;
    for (key in ROUTES) {
      if (trimHref(routeHref(key)) === p) return key;
    }
    return "home";
  }

  // 去掉查询串与 `#…`，规范化结尾的 `/`。
  // 路由一律**只认路径**：网址上带什么参数都不改变「这是哪一页」。
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

    // ⚠️ 换子用户时**必然重画**、且把旧的那张 `<img>` 拆掉再插新的
    //    （Issue #320）。理由有两条，都不是「多此一举」：
    //    ① 旧 `<img>` 还挂着上一个孩子那张图 —— 内容一样就不重画的话，
    //       它就一直挂在那儿；
    //    ② 「本机那份字节优先」意味着换的是这个 `<img>` 自己看到的地址，
    //       同一个 src 连画两次，浏览器拿的还是它手里那份缓存。
    //    代价只是切档那一瞬间一次重排，底栏一颗 26px 的圆。
    clearDockAvatar();
    var want = dockMineHtml();
    if (!want || ic.innerHTML === want) return;

    ic.innerHTML = want;
  }

  // 把底栏那颗头像的空槽清出来（没有头像字节时它画的是「诗」这个字印，
  // 所以不留旧 `<img>` 也一样看得见东西）。
  function clearDockAvatar() {
    var item = dockMineItem();
    var ic = item ? item.querySelector(".dock-icon") : null;
    if (!ic || !ic.innerHTML) return;
    var want = dockMineHtml();
    if (!want || ic.innerHTML === want) return;

    ic.innerHTML = GLYPHS.tabMineImg.replace("__SRC__", "");
  }

  // 底栏「哪一格亮着」的就地重画。**只有 `active` 这一个属性会变**，
  // 所以不重挂 `<nav>`（重挂会把 `bindDock` 的监听与 `.dock` 的入场动画一起丢掉）。
  // 谁要它：`/poems/` 上那层「古诗词大会」掀开 / 收起时（`js/game.js`），
  // 地址栏不动、页面不刷新，可底栏正中间那一格必须当场亮起来 / 灭掉。
  // 判据仍是 `dockKey(pageKey())` 一处算 —— 不在这里另写一套「谁亮」的规则。
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
    // 子用户切走之后（`family-change`），底栏那颗头像必须重画 ——
    // 顶栏那份由各页自己重画（TopBar/brand 与头像无关），底栏这一颗归这里。
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

    // 见 `paintDock`：给「就地掀一层、地址栏不动」的那些页面用（目前只有大会）。
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
