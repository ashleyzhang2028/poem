/**
 * 全站统一的顶栏 + 底部导航（宋式样）
 * ==========================================================================
 * 为什么要有这个文件：
 *   首页、小古文页、法务页原先各自写了一份顶栏，标题、返回键、右侧按钮
 *   各不一样，用户「不知道自己站在哪、下一层能去哪」。这里把三页的
 *   导航收敛成同一套：
 *
 *   ┌──────────────────────────────────┐
 *   │  〔徽标〕 跬步 · 小古文       [↩] │  ← 同一行、同一字体：应用名 · 当前页名
 *   ├──────────────────────────────────┤
 *   │  …页面内容…                      │
 *   ├──────────────────────────────────┤
 *   │  古诗词    小古文    设置        │  ← 底部三页签：页面身份的锚点
 *   └──────────────────────────────────┘
 *
 * 设计取向（宋式美学）：
 *   · 徽标 = 双鱼纹（宋瓷、宋锦上最常见的「鱼」谐音「余」，也呼应「跬步」的耐心）
 *   · 分隔 = 描金细线 + 器物口沿的「子母口」双线，不做投影式的现代卡片感
 *   · 点缀 = 极淡的云纹浮雕，只在角落出现，不抢内容
 *
 * 关键：所有标记用 data- 属性驱动，样式在 css/style.css 里，逻辑只做渲染。
 */
(function () {
  "use strict";

  /* ---------------- 内联 SVG 图标（不请求任何外部资源） ----------------
     页面背景不使用任何图案（纹样已在 css/style.css 里整段移除），
     这里只提供界面自身的图标，全部内联 SVG，不请求图片、断网也在：
     1) 印章徽标　篆意「步」字印，外一圈宋器口沿的细弦。
     2) 页签 / 按钮图标　书本、古卷、设置、播放键等。
  ------------------------------------------------------------------------- */
  var SVG_HEAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';

  var GLYPHS = {
    /* 徽标：篆意「步」字印 —— 上「止」下反「止」，两枚足迹一前一后，
       正是「一步一止、积跬步」的本义；外一圈宋器口沿的细弦，像宋瓷底款。 */
    mark:
      '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true">' +
      '<circle cx="16" cy="16" r="13.4" stroke="currentColor" stroke-width="1" stroke-opacity=".3"/>' +
      '<path d="M16 6.4v7.2M16 8.6l-3.1 2.5M16 8.6l3.1 2.5M13.4 11.6h5.2" ' +
      'stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
      '<path d="M16 25.6v-7.2M16 23.4l-3.1-2.5M16 23.4l3.1-2.5M13.4 20.4h5.2" ' +
      'stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
      '<circle cx="16" cy="16" r="1.15" fill="currentColor" fill-opacity=".5" stroke="none"/>' +
      '</svg>',

    /* 页签：古诗词（翻开的一册） */
    tabPoem:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 6.6C10.3 5.2 8.1 4.6 5.4 4.6v12.6c2.7 0 4.9.6 6.6 1.9 1.7-1.3 3.9-1.9 6.6-1.9V4.6c-2.7 0-4.9.6-6.6 2Z"/>' +
      '<path d="M12 6.6V19.1"/></svg>',

    /* 页签：小古文（展开的古卷） */
    tabClassic:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M5.4 4.6h5.2v14.8H5.4A1.4 1.4 0 0 1 4 18V6a1.4 1.4 0 0 1 1.4-1.4Z"/>' +
      '<path d="M10.6 4.6h8A1.4 1.4 0 0 1 20 6v12a1.4 1.4 0 0 1-1.4 1.4h-8"/>' +
      '<path d="M13.2 9.2h4.2M13.2 13h4.2"/></svg>',

    /* 页签：设置（齿轮）——齿形按几何生成，8 齿均分、左右上下都对称：
       齿顶圆 r9.4 / 齿根圆 r6.9 / 轴孔 r3.2。原先那枚手工描的齿轮
       齿距不匀、整体重心偏右，视觉上「摇」，这里换成真正画正的齿轮。 */
    tabGear:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M9.63 5.52L10.78 2.68L13.22 2.68L14.37 5.52L14.64 5.63L14.91 5.74L17.73 4.55L19.45 6.27L18.26 9.09L18.37 9.36L18.48 9.63L21.32 10.78L21.32 13.22L18.48 14.37L18.37 14.64L18.26 14.91L19.45 17.73L17.73 19.45L14.91 18.26L14.64 18.37L14.37 18.48L13.22 21.32L10.78 21.32L9.63 18.48L9.36 18.37L9.09 18.26L6.27 19.45L4.55 17.73L5.74 14.91L5.63 14.64L5.52 14.37L2.68 13.22L2.68 10.78L5.52 9.63L5.63 9.36L5.74 9.09L4.55 6.27L6.27 4.55L9.09 5.74L9.36 5.63Z"/>' +
      '<circle cx="12" cy="12" r="3.2"/></svg>',

    /* 顶栏右侧：返回上一页（法务页、深页用它替代「设置」） */
    back:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M14.4 5.4 7.8 12l6.6 6.6"/></svg>',

    /* 顶栏右侧：关闭（弹层 / 阅读器用） */
    close:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6"/></svg>',

    /* 页签：跬步标识（首页页签用徽标，保持与顶栏一致） */
    daily:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M4 18.6h16"/>' +
      '<path d="M7.2 18.6V13l2.8-2 2.6 2 2.4-3.2L18.4 11v7.6"/></svg>'
  };

  /* ---------------- 页面路由表 ---------------- */
  /**
   * 全站唯一的一份「页面住哪」。
   *
   * URL 一律目录化，不带 .html：
   *   /            首页（古诗词）
   *   /classic/    小古文
   *   /settings/   设置
   *   /terms/      用户协议
   *   /privacy/    隐私条款
   *
   * 各页面真实文件都是该目录下的 index.html。
   * 这里也兼容直接访问 /classic/index.html 的情形（等价于 /classic/）。
   */
  var ROUTES = {
    home: "/",
    classic: "/classic/",
    settings: "/settings/",
    terms: "/terms/",
    privacy: "/privacy/"
  };

  /** 路由 → 跳转地址 */
  function routeHref(key) {
    return ROUTES[key] || ROUTES.home;
  }

  /* ---------------- 页面身份 ---------------- */
  var APP_NAME = "跬步";
  /* 顶栏第二行 = 页面自己的说明（页面用 body 上的 data-sub 给）。
     应用名与页面名已经在第一行，这里只放「这个页面是干什么的」：
       · 首页 —— 「按遗忘曲线复习」（文案在首页的 data-sub 上，此处只做说明）
       · 小古文页 —— 「100 篇 · 想读哪篇点哪篇」
     刻意不再写「一年级至高三」这类学段字样：首页能选年级学期，
     固定写死一个学段反而让非该学段的用户觉得不是给自己用的。
     留空则第二行不占高度（.brand-sub:empty）。 */
  var DEFAULT_SUB = "";

  function bodyData(key) {
    var el = document.body;
    return el ? el.getAttribute("data-" + key) : null;
  }

  /** 当前页页签：body 上的 data-nav 说了算（缺省按路径猜） */
  function pageKey() {
    var v = bodyData("nav");
    if (v) return v;
    var p = currentPath();
    if (/^\/classic\/?$/.test(p) || /^\/classic\/index\.html$/.test(p)) return "classic";
    if (/^\/settings\/?$/.test(p) || /^\/settings\/index\.html$/.test(p)) return "settings";
    return "home";
  }

  /** 当前页副标题：由页面在 body 上给出，避免把各页文案硬编码在这里 */
  function pageSub() {
    return bodyData("sub") || DEFAULT_SUB;
  }

  /** 是否显示底部三页签（法务页等深页不显示，改用顶栏返回键） */
  function dockEnabled() {
    return bodyData("dock") !== "off";
  }

  /* 顶栏右侧动作：JS 可覆盖（阅读器打开时要变成「关闭」） */
  var headerAction = null; // {icon, label, href, onclick}

  function markSvg() {
    return GLYPHS.mark;
  }

  /* ---------------- 渲染：顶栏 ---------------- */
  function headerHtml() {
    var key = pageKey();
    var sub = pageSub();
    var action = headerAction;
    var right;

    if (action) {
      // 动作是「关闭阅读器」这类「合上 / 撤回上一层」的语义，一律画成返回箭头：
      // 同一种行为在全站只能是同一个图标（顶栏右侧那颗与底部页签「回首页」各司其职）。
      // 曾经这里换成 ✕，结果阅读器里同时出现「底部页签回首页」与「右上角 ✕」，
      // 两个出口语义重叠，✕ 还比全站的箭头多长了一个形状。
      right =
        '<button type="button" class="top-act" id="top-act">' +
        '<span class="top-act-icon" aria-hidden="true">' + GLYPHS.back + "</span>" +
        '<span class="sr-only">' + action.label + "</span></button>";
    } else if (key === "home") {
      // 首页右上角不再放设置齿轮：底部第三个页签就是「设置」，
      // 两个入口指向同一面板，右上角那个纯属重复。
      right = '<span class="top-act-spacer" aria-hidden="true"></span>';
    } else {
      // 子页面（小古文、设置、法务页）右侧都是同一颗「返回」按钮，指向 pageBackHref()。
      // 返回键统一由这里渲染，各页不要自造一颗：曾出现「页面自己手写返回、
      // 与重建后的顶栏同时冒出来」的问题。文案只给读屏软件，可见的只有一个箭头。
      right =
        '<a class="top-act" id="top-back" href="' + pageBackHref() + '"' +
        ' title="返回" aria-label="返回">' +
        '<span class="top-act-icon" aria-hidden="true">' + GLYPHS.back + "</span></a>";
    }

    // 品牌：徽标 + 「跬步 · 当前页名」——同一行、同一字体，读起来是一句话
    // 页面名由页面用 data-page 给出（首页由 app.js 写成「XX的古诗词」）
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

  /** 当前页的返回目标：子页面回首页（首页自己不留返回键，用占位保持两栏对齐） */
  function pageBackHref() {
    return ROUTES.home;
  }

  /** 第一行里的页面名：首页是「「用户名」的古诗词」，其余页用 data-page */
  function pageTitle() {
    var v = bodyData("page");
    if (v != null) return v;
    return pageKey() === "classic" ? "小古文" : "";
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------------- 渲染：底部三页签 ---------------- */
  function dockHtml() {
    var key = pageKey();
    var items = [
      { key: "home", href: "/", icon: GLYPHS.tabPoem, label: "古诗词", desc: "今日背诵与全部诗词" },
      { key: "classic", href: "/classic/", icon: GLYPHS.tabClassic, label: "小古文", desc: "100 篇文言短文" },
      { key: "settings", href: "/settings/", icon: GLYPHS.tabGear, label: "设置", desc: "用户名 / 年级 / 音量" }
    ];
    var html = '<nav class="dock" id="site-dock" aria-label="主导航">';
    items.forEach(function (it) {
      var on = key === it.key;
      // 每个页签都指向真实页面：设置也是独立整页（/settings/），不再是弹层卡片
      // 地址统一走目录化路由，不带 .html
      var tag = it.key === "settings" ? "a" : "button";
      html +=
        "<" + tag + ' ' + (tag === "a" ? 'href="' + it.href + '"' : 'type="button"') +
        ' class="dock-item' + (on ? " active" : "") + '"' +
        ' data-nav-go="' + it.key + '" data-href="' + it.href + '"' +
        (on ? ' aria-current="page"' : "") +
        ' title="' + it.desc + '">' +
        '<span class="dock-icon" aria-hidden="true">' + it.icon + "</span>" +
        '<span class="dock-label">' + it.label + "</span>" +
        "</button>";
    });
    return html + "</nav>";
  }

  /**
   * 重建顶栏内容。
   *
   * 页面可以往顶栏里挂自己的小件（小古文页的「0 / 100 篇」进度牌），
   * 它们不在 headerHtml() 里，所以重建前先出栈、重建后插回**右侧动作位左边**：
   * 顺序固定为　品牌区 ｜ 页面小件 ｜ 返回键（或阅读器里的关闭键）。
   * 漏掉这一步，阅读器一打开（动作位换成「关闭」）进度牌就会整块消失。
   */
  function renderBar(bar) {
    var keep = null;
    var extra = bar.querySelector(":scope > .count-badge");
    if (extra) {
      keep = extra;
      bar.removeChild(extra);
    }
    bar.innerHTML = headerHtml();
    if (keep) {
      var act = bar.querySelector(".top-act, .top-act-spacer");
      if (act) bar.insertBefore(keep, act);
      else bar.appendChild(keep);
    }
  }

  /* ---------------- 挂载 ---------------- */
  function mount() {
    // 顶栏：页面里已有 .topbar 就地复用（保住既有测试与结构），没有则插到最前
    var bar = document.querySelector(".topbar");
    var made = false;
    if (!bar) {
      bar = document.createElement("header");
      bar.className = "topbar";
      made = true;
    }
    // 清空重建，保证三页顶栏结构完全一致（页面自己的小件由 renderBar 保住）
    renderBar(bar);
    if (made) {
      var app = document.querySelector(".app");
      (app || document.body).insertBefore(bar, (app || document.body).firstChild);
    }
    bindHeader();

    // 底部页签
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
    }

    // 顶栏把「本站应用名」先落到第一行，之后各页面再补第二行。
    // 注意脚本顺序：app.js 在本脚本之前执行，它改顶栏时 DOM 里还没有 #brand-sub，
    // 所以这里渲染完要发一个事件，让页面把第二行重新写一遍（否则用户名 / 页面名会丢）。
    var ev = document.createEvent("Event");
    ev.initEvent("chrome:ready", true, true);
    document.dispatchEvent(ev);
  }

  function bindHeader() {
    // 顶栏动作位现在是「返回」或自定义动作（阅读器 → 关闭）；
    // 首页不再放设置齿轮（底部页签已承担），因此这里无需绑定设置按钮。
    // 保留空函数是为了 mount() 的调用结构稳定，后续加顶栏动作位时从这里接手。
  }

  /**
   * 全站所有的顶栏元素（通常两条：页面顶部那条 + 阅读器里那条）。
   *
   * 小古文阅读器是全屏 fixed 层，里面**也有**一条同样结构的顶栏 ——
   * 从列表点进正文时，徽标、「跬步 · 小古文」、右侧圆形动作位都不该变样。
   *
   * ⚠️ 两条顶栏必须**一起**重绘：只重绘一条，另一条就会停在旧状态 ——
   * 阅读器一打开，页面顶上那条仍挂着「返回首页」，而用户已经在正文里了。
   *
   * ⚠️ 顺序也有讲究：DOM 顺序是「页面那条前、阅读器那条后」。
   * headerAction 是全局的，所以**最后一条**说了算；先渲染阅读器那条、
   * 再渲染页面那条，页面那条就会把阅读器需要的「返回列表」覆盖回「返回首页」。
   * 先算清动作、再按顺序渲染，两条才不会打架。
   */
  function readBars() {
    var list = [];
    var page = document.querySelector(".app > .topbar");
    if (page) list.push(page);
    document.querySelectorAll(".reader > .topbar").forEach(function (el) {
      if (list.indexOf(el) === -1) list.push(el);
    });
    // 兜底：别的页面若把顶栏直接挂在 .app 外，也一并纳入
    if (!list.length) {
      var any = document.querySelector(".topbar");
      if (any) list.push(any);
    }
    return list;
  }

  function bindDock(dock) {
    dock.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest("[data-nav-go]") : null;
      if (!btn) return;
      e.preventDefault();
      var dest = btn.getAttribute("data-nav-go");
      var want = routeHref(dest);
      // 已经在这一页：回到顶部，不再重复导航
      if (currentRoute() === dest) {
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      location.href = want;
    });
  }

  /** 当前路径（去掉结尾多余的 /，统一成不含末尾斜杠的形式；根路径归一成 "/"） */
  function currentPath() {
    var p = location.pathname.replace(/\/index\.html$/, "/");
    p = p.replace(/\/+$/, "");
    return p || "/";
  }

  /** 当前页所在路由 key：用于判断「已在本页」（同时容忍 /classic 与 /classic/ 两种写法） */
  function currentRoute() {
    var p = currentPath();
    for (var key in ROUTES) {
      if (currentPathOf(routeHref(key)) === p) return key;
    }
    return "home";
  }

  function currentPathOf(href) {
    var v = String(href).split("#")[0].split("?")[0];
    v = v.replace(/\/index\.html$/, "/").replace(/\/+$/, "");
    return v || "/";
  }

  /** 打开设置整页（保留给页面内其他入口调用：直接跳转，不再弹卡片） */
  function openSettings() {
    location.href = "/settings/";
  }

  /* ---------------- 页面可调用的接口 ---------------- */
  window.SiteChrome = {
    glyph: function (name) {
      return GLYPHS[name] || "";
    },
    /**
     * 顶栏右侧换成自定义动作（阅读器 → 关闭；法务页 → 返回）。
     * 全站所有顶栏（页面那条 + 阅读器里那条）一起重绘：只换右侧动作位，
     * 品牌区不动，所以「进正文」时页面顶部不会闪一下、也不会换一张脸。
     */
    setHeaderAction: function (action) {
      headerAction = action || null;
      var bars = readBars();
      // handle 只挂一次：重复调用（每次翻篇都会调）不该把同一个监听器叠上好几层
      var wired = false;
      bars.forEach(function (bar, i) {
        renderBar(bar);
        bindHeader();
        var btn = bar.querySelector(".top-act, .top-act-spacer");
        if (!btn || !action || !action.onclick) return;
        btn.setAttribute("type", "button");
        // 只给**最后一条**（阅读器那条）接上行为；页面顶部那条交给它的 href 兜底。
        // 两条都挂的话，点一次会跑两遍 closeReader —— 第二次 current 已经为 null，
        // 会去读 current.id 而报错。
        if (wired || i !== bars.length - 1) return;
        wired = true;
        btn.addEventListener("click", action.onclick);
      });
    },
    /** 打开设置（页签与顶栏按钮共用） */
    openSettings: openSettings,
    appName: APP_NAME
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
