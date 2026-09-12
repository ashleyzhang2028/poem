/**
 * 全站统一的顶栏 + 底部导航（宋式样）
 * ==========================================================================
 * 为什么要有这个文件：
 *   首页、小古文页、法务页原先各自写了一份顶栏，标题、返回键、右侧按钮
 *   各不一样，用户「不知道自己站在哪、下一层能去哪」。这里把三页的
 *   导航收敛成同一套：
 *
 *   ┌──────────────────────────────┐
 *   │  〔徽标〕 跬步                │  ← 第一行：logo + 应用名（全站一致）
 *   │          小古文              │     第二行：当前页面名（从小窗进入该页）
 *   ├──────────────────────────────┤
 *   │  …页面内容…                  │
 *   ├──────────────────────────────┤
 *   │  古诗词   小古文   设置      │  ← 底部三页签：页面身份的锚点
 *   └──────────────────────────────┘
 *
 * 设计取向（宋式美学）：
 *   · 徽标 = 双鱼纹（宋瓷、宋锦上最常见的「鱼」谐音「余」，也呼应「跬步」的耐心）
 *   · 分隔 = 描金细线 + 器物口沿的「子母口」双线，不做投影式的现代卡片感
 *   · 点缀 = 极淡的龟背纹浮雕，只在角落出现，不抢内容
 *
 * 关键：所有标记用 data- 属性驱动，样式在 css/style.css 里，逻辑只做渲染。
 */
(function () {
  "use strict";

  /* ---------------- 宋式纹样（内联 SVG，不请求任何外部资源） ----------------
     1) 龟背纹　宋代器物与织锦最典型的地纹，这里拆成一枚「六角龟甲」单元，
                 配上内嵌的小菱花，平铺即成底纹。
     2) 双鱼纹　两条同向游鱼首尾相衔，围成一个圆；用作徽标。
     3) 云雷纹　回字回旋，用作按钮 / 分隔处的一缕装饰。
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

    /* 页签：设置（宋代「官」字印蜕取形，不做齿轮那种现代工业感） */
    tabGear:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="3.2"/>' +
      '<path d="M10.6 3.2h2.8l.35 2.3 2.2.95 1.75-1.5 1.95 1.95-1.5 1.75.95 2.2 2.3.35v2.8l-2.3.35-.95 2.2 1.5 1.75-1.95 1.95-1.75-1.5-2.2.95-.35 2.3h-2.8l-.35-2.3-2.2-.95-1.75 1.5-1.95-1.95 1.5-1.75-.95-2.2-2.3-.35v-2.8l2.3-.35.95-2.2-1.5-1.75 1.95-1.95 1.75 1.5 2.2-.95Z"/></svg>',

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

  /* ---------------- 页面身份 ---------------- */
  var APP_NAME = "跬步";
  var DEFAULT_SUB = "一年级至高三 · 按遗忘曲线复习";

  function bodyData(key) {
    var el = document.body;
    return el ? el.getAttribute("data-" + key) : null;
  }

  /** 当前页页签：body 上的 data-nav 说了算（缺省按文件名猜） */
  function pageKey() {
    var v = bodyData("nav");
    if (v) return v;
    return /classic\.html$/.test(location.pathname) ? "classic" : "home";
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
      right =
        '<button type="button" class="top-act" id="top-act">' +
        '<span class="top-act-icon" aria-hidden="true">' + action.icon + "</span>" +
        '<span class="sr-only">' + action.label + "</span></button>";
    } else if (key === "home") {
      right =
        '<button type="button" class="top-act" id="btn-settings" title="设置" aria-label="打开设置">' +
        '<span class="top-act-icon" aria-hidden="true">' + GLYPHS.tabGear + "</span></button>";
    } else {
      right =
        '<a class="top-act" id="top-back" href="./index.html" title="回到首页" aria-label="回到首页">' +
        '<span class="top-act-icon" aria-hidden="true">' + GLYPHS.back + "</span></a>";
    }

    // 品牌：徽标 + 「跬步」；当前页名另起一行，不再和副标题挤在一起
    return (
      '<div class="brand">' +
      '<span class="brand-icon brand-mark" aria-hidden="true">' + markSvg() + "</span>" +
      '<span class="brand-text">' +
      '<span class="brand-name-row"><h1 id="brand-name">' + APP_NAME + "</h1></span>" +
      '<p class="brand-sub" id="brand-sub">' + escapeHtml(sub) + "</p>" +
      "</span>" +
      "</div>" + right
    );
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /** 页面名（小古文 / 用户协议 …）显示在 logo 右侧 */
  /* ---------------- 渲染：底部三页签 ---------------- */
  function dockHtml() {
    var key = pageKey();
    var items = [
      { key: "home", href: "./index.html", icon: GLYPHS.tabPoem, label: "古诗词", desc: "今日背诵与全部诗词" },
      { key: "classic", href: "./classic.html", icon: GLYPHS.tabClassic, label: "小古文", desc: "100 篇文言短文" },
      { key: "settings", href: "#settings", icon: GLYPHS.tabGear, label: "设置", desc: "用户名 / 年级 / 音量" }
    ];
    var html = '<nav class="dock" id="site-dock" aria-label="主导航">';
    items.forEach(function (it) {
      var on = key === it.key;
      var tag = it.key === "settings" && key !== "classic" ? "button" : "a";
      // 小古文页上的「设置」也在本页弹出，因此统一用按钮承载 data-nav-go
      tag = "button";
      html +=
        "<" + tag + ' type="button" class="dock-item' + (on ? " active" : "") + '"' +
        ' data-nav-go="' + it.key + '" data-href="' + it.href + '"' +
        (on ? ' aria-current="page"' : "") +
        ' title="' + it.desc + '">' +
        '<span class="dock-icon" aria-hidden="true">' + it.icon + "</span>" +
        '<span class="dock-label">' + it.label + "</span>" +
        "</button>";
    });
    return html + "</nav>";
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
    if (made || !bar.querySelector(".brand-icon")) bar.insertAdjacentHTML("afterbegin", "");
    // 清空重建，保证三页顶栏结构完全一致
    bar.innerHTML = headerHtml();
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
    var settingsBtn = document.getElementById("btn-settings");
    if (!settingsBtn) return;
    settingsBtn.addEventListener("click", function () {
      // 优先让页面自己的设置面板接管（首页 / 小古文页都有）
      var opener = document.getElementById("open-settings");
      if (opener) {
        opener.click();
        return;
      }
      var modal = document.getElementById("settings-modal");
      if (modal) {
        modal.hidden = false;
        document.body.style.overflow = "hidden";
        var ev = document.createEvent("Event");
        ev.initEvent("settings:open", true, true);
        document.dispatchEvent(ev);
      }
    });
  }

  function bindDock(dock) {
    dock.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest("[data-nav-go]") : null;
      if (!btn) return;
      e.preventDefault();
      var dest = btn.getAttribute("data-nav-go");
      if (dest === "settings") {
        openSettings();
        return;
      }
      var file = /classic\.html/.test(location.pathname) ? "classic.html" : "index.html";
      var want = dest === "classic" ? "classic.html" : "index.html";
      if (file === want) {
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      location.href = "./" + want;
    });
  }

  /** 打开设置面板：三个页面各自的实现不同，这里做统一入口 */
  function openSettings() {
    var ev = document.createEvent("CustomEvent");
    ev.initCustomEvent("app:open-settings", true, true, {});
    var handled = !document.dispatchEvent(ev);
    if (handled) return;
    var modal = document.getElementById("settings-modal");
    if (modal) {
      modal.hidden = false;
      document.body.style.overflow = "hidden";
      var e2 = document.createEvent("Event");
      e2.initEvent("settings:open", true, true);
      document.dispatchEvent(e2);
    }
  }

  /* ---------------- 页面可调用的接口 ---------------- */
  window.SiteChrome = {
    glyph: function (name) {
      return GLYPHS[name] || "";
    },
    /** 顶栏右侧换成自定义动作（阅读器 → 关闭；法务页 → 返回） */
    setHeaderAction: function (action) {
      headerAction = action || null;
      var bar = document.querySelector(".topbar");
      if (bar) {
        bar.innerHTML = headerHtml();
        bindHeader();
        var btn = document.getElementById("top-act");
        if (btn && action && action.onclick) btn.addEventListener("click", action.onclick);
      }
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
