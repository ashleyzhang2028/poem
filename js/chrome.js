/**
 * 全站统一的顶栏 + 底部导航（宋式样）
 * ==========================================================================
 * 为什么要有这个文件：
 *   首页、小古文页、法务页原先各自写了一份顶栏，标题、返回键、右侧按钮
 *   各不一样，用户「不知道自己站在哪、下一层能去哪」。这里把全站的
 *   导航收敛成同一套：
 *
 *   ┌──────────────────────────────────┐
 *   │  〔徽标〕 跬步 · 课外阅读     [↩] │  ← 同一行、同一字体：应用名 · 当前页名
 *   ├──────────────────────────────────┤
 *   │  …页面内容…                      │
 *   ├──────────────────────────────────┤
 *   │  背诵    课外    搜索    设置    │  ← 底部四页签：页面身份的锚点
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

    /* 页签：课外阅读（叠着的两册书，与「背诵」那册翻开的不同：
       这一枚是立着排的几册，表示「还有好几部可以读」） */
    tabLibrary:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="3.6" y="4.4" width="5.4" height="15.2" rx="1"/>' +
      '<rect x="9.6" y="4.4" width="5.4" height="15.2" rx="1"/>' +
      '<path d="M16.4 4.9l3.2.85a1.1 1.1 0 0 1 .78 1.35l-3.4 12.7"/>' +
      '<path d="M5.6 8.4h1.4M11.6 8.4h1.4"/></svg>',

    /* 页签：全站搜索（放大镜） */
    tabSearch:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="10.6" cy="10.6" r="6.2"/>' +
      '<path d="M15.2 15.2 20.4 20.4"/></svg>',

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

    /* 顶栏右侧：翻开这一册（阅读器里的**恒定槽位**，Issue #147）
       —— 阅读器那一条顶栏里没有头像（沉浸层让位给正文），若把返回键直接摆到
       最右，正文一开一合那颗箭头就横跳 50px（头像的宽度 + 间距）。
       于是补上这一枚「正在读的这一册」图标：高度、宽度、间距全部来自
       --top-slot（= 头像），**占住头像的像素位**，阅读器那条顶栏的右侧簇
       与页面那条逐像素对齐 —— 这正是「所有页面都应该如此」的落法。
       画的是翻开的书页，与底部页签「背诵」那一册同源，不做第二套图形语言。 */
    reader:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 6.6C10.3 5.2 8.1 4.6 5.4 4.6v12.6c2.7 0 4.9.6 6.6 1.9 1.7-1.3 3.9-1.9 6.6-1.9V4.6c-2.7 0-4.9.6-6.6 2Z"/>' +
      '<path d="M12 6.6V19.1"/></svg>',

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
   *   /            首页（背诵）：今日背诵 + 遗忘曲线
   *   /poems/      课内古诗词索引页（一至高三 261 首，按年级分册的目录）
   *   /library/    课外阅读（集子入口页：课内诗词 + 五部选集）
   *   /classic/    课外必背小古文
   *   /tangshi/    唐诗三百首
   *   /songci/     宋词三百首
   *   /guwen/      古文观止
   *   /zhaoming/   昭明文选
   *   /search/     全站搜索
   *   /settings/   设置
   *   /terms/      用户协议
   *   /privacy/    隐私条款
   *
   * 五部选集不再各自占一个页签（页签只有两三个字，装不下书名），
   * 而是统一从 /library/ 进；页面名仍按各页 body 上的 data-page 显示，
   * 所以从入口页点进《古文观止》，顶栏第一行照样写「跬步 · 古文观止」。
   *
   * 各页面真实文件都是该目录下的 index.html。
   * 这里也兼容直接访问 /classic/index.html 的情形（等价于 /classic/）。
   */
  var ROUTES = {
    home: "/",
    poems: "/poems/",
    library: "/library/",
    classic: "/classic/",
    tangshi: "/tangshi/",
    songci: "/songci/",
    guwen: "/guwen/",
    zhaoming: "/zhaoming/",
    search: "/search/",
    settings: "/settings/",
    login: "/login/",
    profile: "/profile/",
    admin: "/admin/",
    plans: "/plans/",
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
       · 首页 —— 「按 XX 复习」（XX 是用户选的背诵算法，如 SM-2 / FSRS；
         文案由 js/app.js 按当前算法写进顶栏，此处只做说明，不硬编码算法名）
       · 课外阅读入口页 —— 「课本之外的经典，按部就班读下去」
       · 小古文页 —— 「100 篇 · 想读哪篇点哪篇」
     刻意不再写「一年级至高三」这类学段字样：首页能选年级学期，
     固定写死一个学段反而让非该学段的用户觉得不是给自己用的。
     同理也不写死某一种算法的名字 —— 算法是用户能换的（见设置页「背诵算法」）。
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
    if (/^\/library\/?$/.test(p) || /^\/library\/index\.html$/.test(p)) return "library";
    if (/^\/poems\/?$/.test(p) || /^\/poems\/index\.html$/.test(p)) return "poems";
    if (/^\/search\/?$/.test(p) || /^\/search\/index\.html$/.test(p)) return "search";
    if (/^\/classic\/?$/.test(p) || /^\/classic\/index\.html$/.test(p)) return "classic";
    if (/^\/tangshi\/?$/.test(p) || /^\/tangshi\/index\.html$/.test(p)) return "tangshi";
    if (/^\/songci\/?$/.test(p) || /^\/songci\/index\.html$/.test(p)) return "songci";
    if (/^\/guwen\/?$/.test(p) || /^\/guwen\/index\.html$/.test(p)) return "guwen";
    if (/^\/zhaoming\/?$/.test(p) || /^\/zhaoming\/index\.html$/.test(p)) return "zhaoming";
    if (/^\/settings\/?$/.test(p) || /^\/settings\/index\.html$/.test(p)) return "settings";
    if (/^\/progress\/?$/.test(p) || /^\/progress\/index\.html$/.test(p)) return "progress";
    // 账号三页：登录 / 个人中心 / 管理后台（Issue #132 · A→B→C→D 的 B / C）
    if (/^\/login\/?$/.test(p) || /^\/login\/index\.html$/.test(p)) return "login";
    if (/^\/profile\/?$/.test(p) || /^\/profile\/index\.html$/.test(p)) return "profile";
    if (/^\/admin\/?$/.test(p) || /^\/admin\/index\.html$/.test(p)) return "admin";
    // 层级对比页（/plans/）：从个人中心的「权限」进，看完就走的小页
    if (/^\/plans\/?$/.test(p) || /^\/plans\/index\.html$/.test(p)) return "plans";
    return "home";
  }

  /** 页名的临时覆盖（见 setPage；空串 = 用 body 上的 data-page） */
  var pageOverride = "";

  /** 当前页副标题：由页面在 body 上给出，避免把各页文案硬编码在这里 */
  function pageSub() {
    if (subOverride) return subOverride;
    return bodyData("sub") || DEFAULT_SUB;
  }

  /** 副标题的临时覆盖（与 pageOverride 同出一辙，见 setPage / setSub） */
  var subOverride = "";

  /**
   * 写（或还原）页顶第二行那句说明。
   *
   * 各页的说明本来走 body 上的 data-sub，由 headerHtml 一次画好；
   * 但「就地换一层」的页面（课外阅读入口页铺一层集子索引）要临时改写它，
   * 而 headerHtml 只在整行重绘时读一次 —— 所以这里直接落到 #brand-sub 上，
   * 并把它记成覆盖值，免得下一次重绘（例如打开阅读器）又翻回旧文案。
   * 传空串 = 还回 body 上的 data-sub。
   */
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

  /** 是否显示底部页签（法务页等深页不显示，改用顶栏返回键） */
  function dockEnabled() {
    return bodyData("dock") !== "off";
  }

  /* 顶栏右侧动作：JS 可覆盖（阅读器打开时要变成「返回上一级」）。
     用**栈**而不是一个变量：阅读器可以叠着开 —— 课外阅读入口页
     （/library/）就是一例，它把一部集子的索引页**就地**铺上来
     （见 js/library.js），索引页上再点一篇又叠一层阅读器。
     一个变量的话，开第二层就把第一层的动作冲掉，合上第二层只能落到 null，
     底下那层露出「回首页」的返回键 —— 就是 Issue #122 那个「点开一首诗，
     再点右上角返回，直接退到了背诵首页」。
     栈底那一枚（动作从无到有的第一次）只当锚点，合到最后仍走原来的 null 分支。 */
  var headerStack = []; // 每项 {icon, label, href, onclick}

  function topAction() {
    return headerStack.length > 1 ? headerStack[headerStack.length - 1] : null;
  }

  function markSvg() {
    return GLYPHS.mark;
  }

  /* 页面自己那条顶栏的动作位（默认 null = 画各页默认的「回首页」返回键）。
     与 headerStack 分开：一个管阅读器那一层，一个管页面这一层，
     合并起来太绕（阅读器的开 / 关与页面的进 / 退是两件独立的事）。 */
  var pageAction = null;
  /* 这一页有没有「就地叠层」的动作位（setPageAction 设过 —— 哪怕现在传的是 null）。
     常设之后，页面那条顶栏在阅读器开着时画的是**占位符**而不是默认的
     「回首页」返回键：在集子索引这一层，「回首页」是个错误的落点
     （点它直接跳去背诵首页，正是 Issue #122 报的那个现象）。 */
  var pageActionHint = false;

  /** 有没有阅读器那一层开着（开着时页面那条顶栏不画动作键，见 headerHtml） */
  function readerLayerOpen() {
    var boxes = document.querySelectorAll(".reader");
    for (var i = 0; i < boxes.length; i++) {
      if (!boxes[i].hidden) return true;
    }
    return false;
  }

  /** 这条顶栏是不是阅读器里的那条（动作位归它，页面顶部那条不参与） */
  function isReaderBar(bar) {
    return !!(bar && bar.parentNode && bar.parentNode.classList &&
      bar.parentNode.classList.contains("reader"));
  }

  /* ---------------- 渲染：顶栏 ---------------- */
  /**
   * 顶栏右端那一个动作位。
   *
   * isReader 为 true 时（阅读器那条顶栏）才走 topAction()（动作栈的栈顶）；
   * 页面自己那条顶栏即使阅读器开着，也照旧显示「回首页」的返回键 ——
   * 否则页面顶栏与阅读器顶栏会同时渲染出 `id="top-act"`，
   * 一个页面里出现两个同名 id：HTML 不合法，且 `element.querySelector('#top-act')`
   * 在部分 DOM 实现（jsdom ≥27）里只认第一枚，阅读器那条会查不到按钮。
   * 顺带也修掉「顶栏整行连着两个『小古文』」：页面顶栏本该是「跬步 · 小古文 ｜ 返回」，
   * 不该把阅读器的动作文案「返回小古文列表」也挂上来。
   */
  function headerHtml(isReader) {
    var key = pageKey();
    var sub = pageSub();
    // 动作位归谁：
    //   · 阅读器那条（isReader）—— 归 setHeaderAction（阅读器开着时它盖在最上面）；
    //   · 页面那条 —— 归 setPageAction，但**只在没有阅读器开着的时候**：
    //     阅读器一开，它那条顶栏就盖在最上面、动作位也归它了，
    //     页面那条若还画一颗 #top-act，同一页就有两枚同名 id
    //     （HTML 不合法，且作用域查询只认第一枚 —— jsdom ≥27 的经典翻车姿势）。
    //     阅读器合上时页面那条会自动重新露出它那一颗（重绘由 hideReader 触发）。
    // 页面那条还有一个「暂时不画」的中间态：这一页有 setPageAction 的动作，
    // 但此刻阅读器那一层开着（动作位归阅读器）—— 那时**既不该画动作键，
    // 也不该落回默认的「回首页」**：那一颗在索引层上是错的落点（点它跳首页）。
    // 所以给它占位符，保持两栏对齐，也免得阅读器关掉时左右跳一下。
    var pageActionHeld = !isReader && !readerLayerOpen() && !pageAction && !!pageActionHint;
    var action = isReader ? topAction() : (readerLayerOpen() ? null : pageAction);
    var right;

    // 右侧簇（Issue #132 · 2026-09-15）：顶栏右端从「一个动作位」升级成
    // 「一枚恒定锚点 + 右侧若干颗」。头像永远在最右，返回键在它**左边**。
    //
    // 为什么头像固定最右、返回键浮动（不是反过来）：
    //   返回键的落点会变（有时没有、有时换文案），头像的落点不能变 ——
    //   用户点头像是靠肌肉记忆（「右上角那枚印」），它必须每页都在同一个像素位上。
    //
    // 为什么阅读器里不画头像：阅读器是全屏沉浸层，那一条顶栏只留「合上」。
    //   把身份入口压在正文上，会把「读诗」拉回「管账号」。
    // 右侧簇（Issue #132 · 2026-09-15；气泡化重排 Issue #147 · 2026-09-15）：
    //     ┌────────────────────────────────────────┐
    //     │ (徽标42) 跬步 · 页名   〔  返回 42  〕(头像42) │
    //     └────────────────────────────────────────┘
    //      品牌区（可收缩，走 ellipsis）  ↑ 固定圆槽      ↑ 固定锚点
    //
    // **两颗都是固定位**：返回键住在一枚 42px 的圆形槽里（与徽标、头像同径），
    // 槽钉在右侧簇里（`.top-slot` 的 `margin-left: auto`），头像钉在最右。
    // 于是返回键与头像的像素位**与页名长短完全无关** —— 上一版把返回键直接
    // 跟在品牌区后面（整行 `justify-content: space-between`），页名一短
    // 返回键就左移：搜索页「跬步 · 搜索」比「课外阅读」短，那一颗箭头
    // 比别页左偏 36~46px（用户 2026-09-15 报的正是这个）。
    //
    // 同一条规矩也管到阅读器：阅读器那条顶栏是一个**全屏沉浸层**，
    // 那里不画头像（不该把「管账号」压在正文上）；若把它的返回键摆到最右，
    // 正文一开一合那颗箭头就横跳 50px。所以阅读器里由一枚同径的
    // **`.top-slot-mark`（翻开的这一册）占住头像的像素位**，
    // 阅读器的「合上」稳稳落在页面返回键那一个像素位上 —— 一页之内也不横跳。
    var leftOfCluster = "";
    if (isReader) {
      // 阅读器那条顶栏：只有「合上」这一颗。
      // 动作是「关闭阅读器」这类「合上 / 撤回上一层」的语义，一律画成返回箭头：
      // 同一种行为在全站只能是同一个图标（顶栏右侧那颗与底部页签「回首页」各司其职）。
      // 曾经这里换成 ✕，结果阅读器里同时出现「底部页签回首页」与「右上角 ✕」，
      // 两个出口语义重叠，✕ 还比全站的箭头多长了一个形状。
      if (action) {
        leftOfCluster =
          '<button type="button" class="top-act" id="top-act">' +
          '<span class="top-act-icon" aria-hidden="true">' + GLYPHS.back + "</span>" +
          '<span class="sr-only">' + action.label + "</span></button>";
      }
    } else if (pageActionHeld) {
      // 这一页有「就地叠层」的动作，但此刻动作位归阅读器那一层
      // （阅读器开着，事务栈的栈顶是「合上」）—— **既不该画动作键、
      // 也不该落回默认的「回首页」**：那一颗在索引层上是错的落点
      // （点它跳首页）。留空槽，保持两栏对齐，也免得阅读器关掉时左右跳一下。
      // ⚠️ 槽还在（`.top-slot` 由下面的模板统一给），只是里头没有键 ——
      //    这正是「返回键的位置与有没有返回键无关」的另一半。
    } else if (action) {
      // 页面自己挂的动作（课外阅读入口页「就地叠层」时用）→ 撤回上一层
      leftOfCluster =
        '<button type="button" class="top-act" id="top-act">' +
        '<span class="top-act-icon" aria-hidden="true">' + GLYPHS.back + "</span>" +
        '<span class="sr-only">' + action.label + "</span></button>";
    } else if (!isReader && key !== "home") {
      // 子页面（搜索、小古文、设置、法务页）—— 同一颗「返回」，指向 pageBackHref()。
      // 返回键统一由这里渲染，各页不要自造一颗：曾出现「页面自己手写返回、
      // 与重建后的顶栏同时冒出来」的问题。文案只给读屏软件，可见的只有一个箭头。
      leftOfCluster =
        '<a class="top-act" id="top-back" href="' + pageBackHref() + '"' +
        ' title="返回" aria-label="返回">' +
        '<span class="top-act-icon" aria-hidden="true">' + GLYPHS.back + "</span></a>";
    }

    // 右侧簇 = 〔返回槽〕+ 恒定锚点。
    //   · 页面那条顶栏的锚点是**头像**（点它看自己，靠肌肉记忆，一像素都不许动）；
    //   · 阅读器那条的锚点是**这一册的印**（同上一个宽度，让返回键原地不动）。
    // 首页右上角不再放设置齿轮：底部最后一个页签就是「设置」，
    // 两个入口指向同一面板，右上角那个纯属重复。首页也不放返回键（没有上一层），
    // 槽留空 —— 头像仍在最右，四个页签根页的顶栏右端因此完全一致。
    var anchor = isReader
      ? '<span class="top-slot-mark" aria-hidden="true">' + GLYPHS.reader + "</span>"
      : userAvatarHtml();
    right =
      '<span class="top-slot">' + leftOfCluster + "</span>" + anchor;

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

  /**
   * 右侧簇里**最靠左**的那一颗（页面小件要插在它左边）。
   *
   * 挑的是右侧簇里**最靠左**的那一颗，候选顺序即视觉顺序 ——
   * 页面动作键 `#top-act` → 返回键 `#top-back` → 头像 `.top-user` → 占位符。
   * 首页没有返回键时，小件就落在头像左边（那也是唯一正确的落点）。
   *
   * ⚠️ Issue #147 之后右侧簇已经**整个包在 `.top-slot` 里**
   * （返回键住一枚 42px 的固定圆槽，头像钉在最右）—— 小件落在槽**左**边，
   * 即「品牌区 ｜ 小件 ｜ 返回槽 ｜ 头像」，与重排之前的视觉顺序一致。
   * 这里仍逐个变量找锚点，不直接取 `.top-slot`：万一将来某一处
   * 不按这个模板渲染（例如别处复用的顶栏），逐个候选仍能找到正确的落点。
   */
  function firstActAnchor(bar) {
    var list = bar.querySelectorAll(".top-act, .top-user, .top-act-spacer");
    return list.length ? list[0] : null;
  }

  /**
   * 顶栏右上角那枚「头像印」（Issue #132 · 2026-09-15）。
   *
   * 三个刻意的取舍：
   *   · **未登录也画**：未登录时是一枚「默认印（诗字 / 朱砂）」，它不是账号入口的
   *     伪装，而是一个恒定的身份锚点 —— 点了去 `/profile/`（未登录时那一页
   *     自己会变成引导页，见 js/profile.js）。空着反而让用户以为「右上角什么都没有」。
   *   · **独立的 id / 类名**：`id="top-user"` / `.top-user`，**不复用 `#top-act`
   *     与 `#top-back`**。仓库里有一条硬断言「全页只有一枚 #top-act / #top-back」，
   *     顺手写进同一个 id 会让它变红；且 jsdom ≥27 下 `querySelector('#top-act')`
   *     只认第一枚，会把阅读器的按钮绑错（这个坑仓库里踩过并写进了注释）。
   *   · **渲染走 Avatar.html()**：全站唯一画印的地方，页面不许自己拼一份渐变
   *     （`test/avatar.test.js` 有源码扫描守着）。
   *
   * 没有 Avatar 模块时（老缓存 / 脚本顺序不对）退回不可见占位，宁可不画也不报错：
   * 顶栏是每一页都跑的东西，这里抛一次就是全站白屏。
   */
  function userAvatarHtml() {
    var A = (typeof globalThis !== "undefined" && globalThis.Avatar) || null;
    var inner;
    if (A && typeof A.html === "function") {
      try {
        // ⚠️ 必须显式传 localStorage：传 null 会读不到 `poem_profile_v1`，
        //    顶栏永远画默认的「诗」字印 —— 用户选了梅、首页也显示梅，
        //    只有顶栏还是诗，是最难解释的那类不一致（不报错、只是画错）。
        var backing = (typeof globalThis !== "undefined" && globalThis.localStorage) || null;
        // ⚠️ **不传 size**：直径由 CSS 统一给（`.top-user` 的 `--user-size: 42px`，
        //    与 `.brand-mark` 的徽标同径 —— 用户 2026-09-15 要求「和 logo
        //    一模一样大小的圆形」）。在这里再写一个数字就是第二个尺寸来源，
        //    那个数字早晚会和样式表里那个不一致。
        inner = A.html(backing, { cls: "seal-avatar-top" });
      } catch (e) { inner = ""; }
    }
    // 没有 Avatar 模块时退回不可见占位。宽度走同一条 `--top-slot` 口径
    // （见 css/style.css），不再单独写一个 42 —— 顶栏右侧的每一件都是
    // 同一枚圆槽的尺寸，写第二处数字就是下一次走散的种子。
    if (!inner) return '<span class="top-act-spacer" aria-hidden="true"></span>';
    // 骨架是 <a>：一个真实链接（可右键 / 可键盘 / 可读屏），不是「点了没反应」的装饰。
    // 落点是 `/profile/` —— 那一页建好之后，这里就不再退回设置页了：
    // 「点头像 → 看自己」是肌肉记忆，中间隔一层设置页就不叫锚点了。
    return '<a class="top-user" id="top-user" href="' + userHref() + '"' +
      ' aria-label="个人中心" title="个人中心">' + inner + "</a>";
  }

  /**
   * 头像的落点 = `/profile/`。
   *
   * 曾经先指设置页（那时 `/profile/` 还没建，指一个 404 不如指一个能改头像的地方）。
   * 现在那一页有了，就回到「点头像看自己」这个唯一正确的语义上 ——
   * 保留 `__AVATAR_PAGE__` 这个覆盖口是给「同一套 chrome 渲染到别处」的情形用的
   * （测试与将来的多入口），不是给页面自己改跳转的。
   */
  function userHref() {
    var p = (typeof globalThis !== "undefined" && globalThis.__AVATAR_PAGE__) || "";
    return p || ROUTES.profile;
  }

  /**
   * 当前页的返回目标。
   *
   * 默认：子页面回首页（首页自己不留返回键，用占位保持两栏对齐）。
   * 例外：页面可以用 body 上的 `data-back` 指定上一层 —— 设置拆成二级页之后
   * （Issue #132 后续），四张二级页的上一层是**设置主页**而不是背诵首页：
   * 从「阅读与朗读」返回背诵首页，等于把用户从设置里一脚踢出来。
   *
   * ⚠️ 只认站内绝对路径（`/` 开头）：`data-back` 是页面自己写的属性，
   *    写成 `javascript:` 或外站地址就等于给了页面一个开放跳转。
   */
  function pageBackHref() {
    var back = bodyData("back");
    if (back && /^\/[^\/\s]/.test(back)) return back;
    return ROUTES.home;
  }

  /** 第一行里的页面名：首页是「「用户名」的古诗词」，其余页用 data-page */
  function pageTitle() {
    // 页名可以被页面临时改掉（课外阅读入口页铺上一层集子索引时，
    // 第一行要从「课外阅读」变成「唐诗三百首」，见 setPage）。
    // ⚠️ 覆盖只影响**这一行**，body 上的 data-page 不动，清掉覆盖就还原。
    if (pageOverride) return pageOverride;
    var v = bodyData("page");
    if (v != null) return v;
    var k = pageKey();
    if (k === "library") return "课外阅读";
    if (k === "poems") return "课内古诗词";
    if (k === "search") return "搜索";
    if (k === "classic") return "小古文";
    if (k === "tangshi") return "唐诗三百首";
    if (k === "songci") return "宋词三百首";
    if (k === "guwen") return "古文观止";
    if (k === "zhaoming") return "昭明文选";
    return "";
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------------- 渲染：底部页签 ---------------- */
  /**
   * 底部四个页签。
   *
   * 上一版是三个：「古诗词 / 小古文 / 设置」。问题有两处 ——
   *   1. 当年只有小古文一部集子，页签写「小古文」还算如实；
   *      唐诗、宋词、古文观止、昭明文选做完之后，它们**一个入口都没有**，
   *      只能靠手敲地址进。
   *   2. 「古诗词」这个名字也不准：那一页管的是课内背诵与遗忘曲线复习，
   *      与「课外读」是两回事。
   * 现在改成：背诵（课内，按遗忘曲线安排复习）｜课外（集子入口）
   * ｜搜索（全站篇目）｜设置。四格在窄屏上仍是一行放得下（每格 ≥75px）。
   *
   * 页签与「当前页」的对应关系（pageKey）：
   *   /            → home
   *   /library/    → library
   *   /classic/ /tangshi/ /songci/ /guwen/ /zhaoming/ → 都算「课外」这一格选中
   *   课内诗词索引页（/poems/）也算「课外」这一格：入口页第一张卡就指过去，
   *   用户是从那一页进来的，页签理应停在那一格（而不是跳到「背诵」）。
   *   /search/     → search
   *   /settings/   → settings
   */
  var DOCK_ITEMS = [
    { key: "home", href: "/", icon: GLYPHS.tabPoem, label: "背诵", desc: "课内古诗词，按当前复习算法安排复习" },
    { key: "library", href: "/library/", icon: GLYPHS.tabLibrary, label: "课外", desc: "课内诗词 / 小古文 / 唐诗 / 宋词 / 古文观止 / 昭明文选" },
    { key: "search", href: "/search/", icon: GLYPHS.tabSearch, label: "搜索", desc: "全站篇目一次搜遍" },
    { key: "settings", href: "/settings/", icon: GLYPHS.tabGear, label: "设置", desc: "用户名 / 年级 / 音量" }
  ];

  /** 五部选集页都算「课外」这一格：它们共用同一个入口，也该共用同一个选中态 */
  function dockKey(key) {
    if (key === "classic" || key === "tangshi" || key === "songci" || key === "guwen" ||
        key === "zhaoming") return "library";
    // 课内诗词索引页（/poems/）算「课外」这一格：它就是课外阅读入口页
    // 第一张卡的去处 —— 用户是从那一页点进来的，页签该留在那一格上。
    // （首页 / 仍是「背诵」那一格：那是另一件事，见 DOCK_ITEMS 第一条。）
    if (key === "poems") return "library";
    // 背诵进度页（/progress/）算「背诵」这一格：它讲的就是课内背诵那本账
    // （到期日历 / 掌握度），不是独立的一站，也只是从设置页进得去的小页。
    if (key === "progress") return "home";
    return key;
  }

  /**
   * 底部四页签。
   *
   * 结构是「外层整宽 + 内层限宽」两层（见 css/style.css 的 .dock-inner）：
   *   外层 .dock —— 整宽贴底，底纹 / 描金细线 / 底部安全区都在它身上；
   *   内层 .dock-inner —— 限宽 720px 居中，四格在这个宽度里等分。
   * 不这么分的话，1920px 屏上每格会被拉到 477px，一颗 22px 的图标
   * 孤零零挂在格子正中，页签看着像四块空白板子。
   * ⚠️ 两层都不能省：把 max-width 直接写在外层，固定定位的底线会一起收掉，
   *    屏幕左右两侧露出「没有页签」的空白。
   */
  function dockHtml() {
    var key = dockKey(pageKey());
    var items = DOCK_ITEMS;
    var html = '<nav class="dock" id="site-dock" aria-label="主导航"><div class="dock-inner">';
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
    return html + "</div></nav>";
  }

  /**
   * 重建顶栏内容。
   *
   * 页面可以往顶栏里挂自己的小件（class="count-badge"），它们不在 headerHtml() 里，
   * 所以重建前先出栈、重建后插回**品牌区之后、右侧动作位之前**：
   * 顺序固定为　品牌区 ｜ 页面小件 ｜ 返回键（或阅读器里的关闭键）。
   * 漏掉这一步，阅读器一打开（动作位换成「关闭」）小件就会整块消失。
   * 注意是「全部小件」而不是「第一枚」—— 万一两条顶栏各挂一枚，只搬第一枚就丢一枚。
   *
   * ⚠️ 各集子页**已不再往顶栏挂那枚「0 / 100 篇」已读进度牌**（Issue #147）：
   *    它挪去了详情页的状态栏（朝代 / 作者 / 出处那一行，见 js/reader-core.js 的
   *    syncCount 与 css/classic.css 的 .rd-count）。这一处的搬迁能力仍然留着 ——
   *    renderBar 是通用的，将来哪一页要在顶栏挂小件照样挂得上。
   */
  function renderBar(bar) {
    var keep = null;
    // 小件可能不止一枚（同款 .count-badge 挂在两条顶栏上）。一律全量收集、
    // 原序插回品牌区之后 —— 只搬第一枚时，另一条顶栏的小件就没了。
    var extras = bar.querySelectorAll(":scope > .count-badge");
    if (extras.length) {
      keep = [].slice.call(extras);
      keep.forEach(function (el) { bar.removeChild(el); });
    }
    bar.innerHTML = headerHtml(isReaderBar(bar));
    if (!keep) return;
    // 锚点是右侧簇里**最靠左**的那一颗：簇里有时是「返回键 + 头像」两颗、
    // 有时只有头像一颗，按单颗找（`querySelector` 认第一枚）本来也对 ——
    // 但候选必须把 `.top-user` 也列进去，否则小件会插到头像**后面**。
    var act = firstActAnchor(bar);
    keep.forEach(function (el) {
      if (act) bar.insertBefore(el, act);
      else bar.appendChild(el);
    });
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
   * 两条顶栏会被**一起**重绘（品牌区与页面小件按枚迁回，所以进正文时页面顶部不闪），
   * 但动作位只在阅读器那条上生效（见 headerHtml 的 isReader 与 isReaderBar）：
   * 页面那条仍显示「回首页」，不会跟着变成按钮，也不会冒出一枚重复的 id="top-act"。
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

  /**
   * 页面顶栏的「返回上一层」动作：事件委托，绑一次就够。
   *
   * 为什么要委托：这一条顶栏会被整行重绘多次（renderBar 换 innerHTML），
   * 逐次 addEventListener 会在每一次重绘后失效 —— 表现正是
   * 「按钮画出来了、点了没反应」，而且只在第二次之后再点才发生，最难查。
   * 委托绑在顶栏节点上（那个节点本身不换），一次绑好、终身有效；
   * 只有**页面自己那条**顶栏会响应（阅读器那条走 setHeaderAction 直接绑）。
   */
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
     * 所有顶栏一起重绘（品牌区与页面小件不动，所以「进正文」时页面顶部不会闪一下），
     * 但**只有阅读器那条**的动作位变成这颗按钮：
     *  · 页面自己那条照旧是「回首页」的返回键（id="top-back"），
     *    否则同一页面会出现两枚 id="top-act" —— HTML 不合法，
     *    且 `#top-act` 这种作用域查询在部分 DOM 实现里只认第一枚，
     *    阅读器那条会查不到按钮（jsdom ≥27 的经典翻车姿势）；
     *  · 页面顶栏也不必挂上「返回小古文列表」这句话，免得整行连出两个「小古文」。
     */
    setHeaderAction: function (action) {
      // null = 「这一层合上了」：弹掉栈顶一层；栈空了就是全合上。
      // 传对象 = 「又开了一层」：压栈。
      // 压栈时若底下还是空的，先垫一枚空锚点，让「合到最后」仍落回 null 分支
      // （否则最后一层合上会弹空栈，页面上留下一个错误的默认返回键）。
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
        // 动作只落在阅读器那条顶栏上；页面那条交给它自己的 href 兜底
        if (!isReaderBar(bar) || !action || !action.onclick) return;
        var btn = bar.querySelector("#top-act");
        if (!btn) return;
        btn.setAttribute("type", "button");
        btn.addEventListener("click", action.onclick);
      });
    },
    /** 写 / 还原页顶第二行那句说明（见 paintSubText） */
    setSub: function (text) { paintSubText(text); },
    /**
     * 页面自己那条顶栏的右侧动作位换成「返回上一层」。
     *
     * 与 setHeaderAction 的分工（两者都画成同一颗返回箭头，位置也一样）：
     *   · setHeaderAction —— **阅读器那条**顶栏的动作位（阅读器开着时它盖在最上面）；
     *   · setPageAction   —— **页面顶部那条**顶栏的动作位，页面里没有阅读器
     *     可挂动作时用（课外阅读入口页把某部的索引**就地**铺上来，那一层
     *     就是页面本身，没有另一条顶栏，见 js/library.js）。
     * 两条各画各的，同一时刻只有一条看得见 —— 所以全页仍然只有一枚 #top-act。
     * 传 null 还原成各页默认那颗「回首页」。
     */
    setPageAction: function (action) {
      pageAction = action || null;
      if (action) pageActionHint = true;
      // 重绘页面那条（页面小件由 renderBar 按枚搬回，与别处同一条路），
      // 再把动作绑上去 —— 重绘会把它清掉，顺序不能反。
      var bars = readBars();
      bars.forEach(function (bar) {
        if (isReaderBar(bar)) return;
        renderBar(bar);
      });
      if (!pageAction || !pageAction.onclick) return;
      // ⚠️ 用**事件委托**绑在顶栏上，不再逐次给那一颗按钮 addEventListener：
      //    这一条顶栏会被反复整行重绘（换集子、开合阅读器都会），逐次绑就得
      //    每次重绘后重绑一遍 —— 漏一次，按钮就成了一颗按不动的装饰：
      //    「画出来了、点了没反应」，而且只在第二次之后再点才发生，最难查。
      //    委托绑在顶栏节点上（那个节点本身不换），一次绑好、终身有效。
      bindPageAction();
    },
    /**
     * 页顶那一行里的「页面小件」（class="count-badge"）。
     *
     * ⚠️ 各集子页**不再用它挂已读进度牌**（Issue #147）：那枚数挪去了详情页的
     *    状态栏（见 js/reader-core.js 的 syncCount）。这个口子留给**页顶确实需要
     *    一枚读数**的场合 —— 当下没有页面在页顶用它，但能力保留。
     * 小件**不是** chrome.js 渲染的
     * （它是各页自己挂在顶栏里的「页面小件」，见 renderBar），
     * 所以这里只提供「取到那一枚」与「整行重绘后别丢」两件事：
     *   · 取：返回页顶那条顶栏里的 .count-badge（没有就 null）；
     *   · 保：整行重绘会把小件出栈再插回，调用方不必自己搬。
     * 页面自己设文案与 textContent，chrome.js 不猜它的口径。
     */
    badge: function () {
      var bar = document.querySelector(".app > .topbar") || document.querySelector(".topbar");
      if (!bar) return null;
      var el = bar.querySelector(":scope > .count-badge");
      if (el) return el;
      // 还没有：造一枚插到品牌区之后、动作位之前（与 renderBar 的插回位置同一处）
      el = document.createElement("span");
      el.className = "count-badge";
      var act = firstActAnchor(bar);
      if (act) bar.insertBefore(el, act);
      else bar.appendChild(el);
      return el;
    },
    /** 打开设置（页签与顶栏按钮共用） */
    openSettings: openSettings,
    /**
     * 改第一行的页名（默认取 body 上的 data-page）。
     *
     * 给课外阅读入口页用：它把某一部的索引**就地**铺上来时，页顶那一行
     * 要跟着换成那一部的名字（「课外阅读」→「唐诗三百首」，见 js/library.js）。
     * 不传 / 传空串就还回 body 上的 data-page。
     * 只改这一行，不动 DOM 里的其它东西；页名是纯文本，走 textContent，不拼 HTML。
     */
    setPage: function (name) {
      pageOverride = name == null ? "" : String(name);
      var bars = readBars();
      bars.forEach(function (bar) {
        var el = bar.querySelector("#brand-page-text");
        if (el) el.textContent = pageTitle();
      });
    },
    /**
     * 重画顶栏那枚头像印（`poem_profile_v1` 改了之后调用）。
     *
     * 为什么要有这个入口：用户可在设置页改「印」的字与色，而顶栏是 chrome.js
     * 一次画好的。不重画的话，改完要刷新页面才看得到 —— 那正是「改了个设置却像是没生效」。
     * 只重绘**页面那条**顶栏（阅读器那条本来就没有头像），与 setPageAction 同一路径。
     */
    refreshUser: function () {
      readBars().forEach(function (bar) {
        if (isReaderBar(bar)) return;
        renderBar(bar);
      });
    },
    appName: APP_NAME
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
