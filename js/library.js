/**
 * 课外阅读入口页（/library/）
 * ==========================================================================
 * 这一页有两层，都在同一页里：
 *
 *   第一层「集子目录」—— 六张卡片，把六部集子摆出来让你挑（本文件的主要工作）。
 *   第二层「某部的索引」—— 点一张卡，把那一部的索引页**就地**铺上来
 *     （唐 / 宋词 / 古文观止 / 昭明文选 / 小古文五部走这里，用
 *      js/reader-core.js 同一套引擎、与 /tangshi/ 等页面同一份挂载配置）；
 *     再点一篇，阅读器叠在最上面。
 *
 * 为什么是「就地叠层」而不是跳转到 /tangshi/（Issue #122）：
 *   浏览器的习惯是「进一层、退一层」。跳到 /tangshi/ 的话，
 *   中间那层索引住在**另一个地址**上，而阅读器只是同一页里的一个层 ——
 *   从索引点进一首诗，按右上角返回，只能把阅读器那层收掉，
 *   接着要么停在 /tangshi/（用户的预期是回索引）、要么直接回首页
 *   （用户实际看到的正是「直接退到了背诵首页」）。
 *   就地叠层之后，正文 / 索引 / 目录是同一页里的三层：
 *   返回一次收一层，一层一层退，与用户点出来的路径一一对应。
 *
 * 课内诗词（/poems/）仍走跳转 —— 它有自己的索引页（按教材 24 册分组），
 * 从那里返回就是回首页，与「进入索引 → 进入一篇 → 返回」的路径一致，
 * 不必再在这一页里铺一份。
 *
 * 为什么要有这一页：
 *   底部页签那一行每格只有两三个字，装得下「设置」，装不下
 *   「古文观止」这类书名 —— 以前只在页签上写「小古文」，
 *   于是另外三部集子（唐诗 / 宋词 / 古文观止）虽然做完了，却没有入口。
 *   现在页签写「课外」（短、且不偏向任何一部），点进来这一页把五部选集
 *   连同各自篇数一次列清，再各自进自己的索引页。
 *
 * 篇数从 data/site-index.js 实时算，不写死：
 *   日后哪一部增补了篇目（例如某部集子先收一部分、后来补齐），
 *   这一页的数字自动跟上，不会出现「卡片写 100 篇、点进去 166 篇」。
 */
(function () {
  "use strict";

  /** 六部集子的入口说明：顺序即页面上的排布顺序（课内在前，其余按篇幅由短到长） */
  var ENTRIES = [
    {
      id: "poems",
      name: "课内诗词",
      short: "课内",
      // ⚠️ 指索引页（/poems/），不是首页（/）—— 这是 Issue #114 第一条。
      //    首页是「今日背诵 + 遗忘曲线」，点进来看到的是今天那几首，
      //    不是「课内都收着哪些诗」。其余五张卡都指各自的索引页，
      //    这一张也该一样：入口页点卡 → 索引页 → 再点一篇 → 详情页。
      page: "/poems/",
      unit: "首",
      desc: "一年级至高三，按年级分册，想读哪首点哪首"
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
    }
  ];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /**
   * 取某一部的篇数。
   *
   * ⚠️ 不能拿 `SITE_INDEX` 来数：那是一张**搜索索引**，按约定不收「待补」条目
   *    （搜到一条点进去只有提示，等于让人白跑一趟，见 data/site-index.js）。
   *    用它来数，卡片上就会出现「昭明文选 480 篇」以外的数字 ——而点进去明明有 480 篇，
   *    用户会以为页面坏了。所以直接数各集子自己的数据（window.POEMS_*）。
   *    集子自身那条也不在这里出现：它本就不是一篇作品。
   */
  function countOf(bookId) {
    var idx = window.SITE_INDEX || [];
    var direct = idx.filter(function (p) { return p.book === bookId && !p.isBook; }).length;
    // 各集子的数据在 window 上的变量名（与 data/site-index.js 的 BOOKS 一致）
    var VARS = {
      poems: "POEMS_ALL",
      classic: "POEMS_CLASSIC",
      tangshi: "POEMS_TANGSHI",
      songci: "POEMS_SONGCI",
      guwen: "POEMS_GUWEN",
      zhaoming: "POEMS_ZHAOMING"
    };
    var key = VARS[bookId];
    var list = key ? window[key] : null;
    if (list && list.length) return list.length;
    // 兜底：这一部数据没加载上时，按搜索索引里的条数给个近似值
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
      // 能就地打开的那五部（book 指向各自的挂载配置）不用 <a>：点了在这一页
      // 铺开索引，地址栏不动（见 enterBook）。课内诗词走跳转，仍是链接，
      // 这样中键 / 新标签页打开它照旧可用（就地打开的那五部也保留 /tangshi/ 这一路，
      // 只是要从卡上「点」才走就地那一支 —— 见 bindGrid 的判断）。
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

  /* ---------------- 第二层：就地铺开一部集子的索引 ----------------
     为什么是「就地」而不是跳转 /tangshi/，见文件头注释（Issue #122）。
     这一节只做四件事：
       1. enterBook(bookId) —— 铺开：页顶那一行换成这一部的页名 / 说明 / 进度牌，
          索引块显示出来，把这一部的数据与挂载配置交给引擎挂上去；
       2. exitBook() —— 收起：顶栏与页名还原成「课外阅读」，回到集子目录；
       3. 返回键的去向 —— 阅读器那一颗交给引擎的 openFrom（见 js/reader-core.js）：
          阅读器开着时按返回 → 收阅读器；没开则 → 收起索引回目录
          （页面那条顶栏的动作位由这一页自己用 SiteChrome.setPageAction 管）。
       4. 卡片上的「点」：能就地打开的就地打开；中键 / Ctrl+点击仍是原生跳转。

     ⚠️ 换部必须重挂：同一块 DOM 上不能留两份实例（引擎的 mount 有防重，
        同一块挂两份会互相覆盖状态），而每一部的分组顺序、已读键名、
        文案都不一样 —— 所以 enterBook 会先把上一部 unmount 掉再挂，
        而不是在同一个实例上换数据（见 reader-core 的 unmount）。 */

  var rail = null;   // 第二层那一段 DOM（[data-lib-view="book"]）
  var grid = null;   // 第一层那一段 DOM（[data-lib-view="grid"]）
  var current = null; // 当前铺开的那一部（ENTRIES 里的一条）

  function engineOf(entry) {
    var ns = entry && entry.book ? window[entry.book] : null;
    return ns && typeof ns.config === "function" ? ns : null;
  }

  function itemsOf(entry) {
    var ns = engineOf(entry);
    var list = ns ? ns.items() : null;
    // 兜底：NS 没挂上（脚本顺序变了之类）也按站点索引里这一部的条目摆一份出来，
    // 宁可少一点正文，也别点进去是一片空白。
    if (list && list.length) return list;
    return (window.SITE_INDEX || []).filter(function (p) {
      return p.book === entry.id && !p.isBook;
    });
  }

  /**
   * 把页顶那一行换成这一部的（页名 / 说明），退出时再换回来。
   *
   * ⚠️ 页顶那一行**不再挂已读进度牌**（Issue #147）：它原先在这里按集子换数
   *    （「0 / 301 首」），窄屏上会把品牌区挤成省略号。已读进度现在跟着
   *    **详情页的状态栏**走（朝代 / 作者 / 出处那一行，见 js/reader-core.js 的
   *    syncCount），所以这一层只换页名与说明；数由正文自己报。
   *    这一页的进度牌（若将来要挂回来）要走 C.badge()，见 js/chrome.js。
   */
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

  /**
   * 这一部索引页的第二行说明。
   * ⚠️ 从**这一部自己的挂载配置**里取（reader-core.js 挂载时用它的 pageSub）——
   *    不在这里另写一句，否则从 /library/ 进来与直接从 /tangshi/ 进来，
   *    页名下面那句说明会是两句不同的话（同一部集子两个样子）。
   */
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
      // 课内诗词（/poems/）：它有自己的索引页，跳过去 ——
      // 从那里返回就是回首页，与「进索引 → 进一篇 → 返回」的路径一致，
      // 不必在这一页里再铺一份（见文件头注释）。
      location.href = entry.page;
      return;
    }
    var ns = engineOf(entry);
    var items = itemsOf(entry);
    if (!ns || !items.length) return;
    if (!window.ReaderEngine) return;

    // 换部必须重挂：每一部的 groupOrder / readStore / 文案都不同，而引擎的
    // mount 对「同一块 DOM」有防重（同一块挂两份会互相覆盖状态）。
    // 这里先把上一部（若有）摘掉再挂 —— 摘掉的是引擎里那条记录，
    // DOM 由 mount 自己整块重画（列表内容会被覆盖，不留上一部的篇目）。
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
    // 阅读器里那颗返回键的去向（引擎的 openFrom，见 js/reader-core.js）：
    //   阅读器开着 → 返回 null，交回引擎（它把那一篇收掉，落到本层索引）；
    //   阅读器没开 → 给一个函数，收起索引回集子目录。
    cfg.openFrom = function () {
      var a = window.ReaderEngine.current;
      if (a && a.isOpen && a.isOpen()) return null;
      return function () { exitBook(); };
    };
    // 引擎合上阅读器之后会把**阅读器那条**顶栏的动作位清成 null ——
    // 那只影响它自己那条；这一层看的是页面那条顶栏（由 setPageAction 管），
    // 所以这里只把「还压着一层」告诉引擎，让它别去动页面那条的动作位。
    cfg.onHideReader = function () { return true; };

    var api = window.ReaderEngine.mount(cfg);
    if (!api) return;
    // 索引这一层自己的返回键：收起索引，回到六张卡的集子目录。
    // ⚠️ 挂载之后**一定**要再设一次：引擎挂载时会把顶栏动作位设成 null
    //    （它那一颗是给阅读器的，索引这一层此时还没开阅读器）——
    //    不回设的话，页顶那一行露出的是默认的「回首页」返回键，
    //    按它就直接跳去首页（正是 #122 报的那个现象）。
    paintBack();
    window.scrollTo(0, 0);
  }

  /**
   * 页面那条顶栏右侧的动作位。
   *   铺着某一部的索引 → 「返回课外阅读」（收起索引，回六张卡的目录）；
   *   在目录这一层      → 还回各页默认那颗「回首页」。
   * 走 SiteChrome.setPageAction（**页面那条**顶栏，不是阅读器那条）：
   * 这一层没有自己的阅读器层，唯一看得见的顶栏就是页面这条 ——
   * 不能让引擎的 setHeaderAction 去管它（那一颗是阅读器开着时才该出现的）。
   */
  function paintBack() {
    if (!window.SiteChrome || !window.SiteChrome.setPageAction) return;
    if (!current) { window.SiteChrome.setPageAction(null); return; }
    window.SiteChrome.setPageAction({
      label: "返回课外阅读",
      onclick: function () { exitBook(); }
    });
  }

  /** 第二层里交给引擎做挂载点的那个元素（引擎按它认「这一份挂在哪儿」） */
  function listHolder() {
    return rail ? rail.querySelector("[data-lib-part='list']") : null;
  }

  /**
   * 把第二层那块列表清空、并复位工具栏。
   *
   * 为什么换部 / 退出时都要清：引擎认「root 元素」做挂载点，而每一部的
   * groupOrder / readStore / 文案都不同，换部只能整块重来 ——
   * 列表若不清，新的一部渲染前会闪一下上一部的篇目；
   * 搜索框与「全部 / 未读」若不复位，上一部搜过的关键字会带进下一部
   * （表现是「点进宋词只看到几首」，其实是被上一次的搜索框住了）。
   */
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
    // 阅读器若还开着，先收掉那一层。
    // ⚠️ 用 hideReader（只收层）而不是 close：
    //    close 是「回到本页索引列表」那一个出口，它会把页顶的动作位一起清掉 ——
    //    而这一页的动作位归这一层自己管（setPageAction），清掉之后
    //    再重绘就会落回默认的「回首页」返回键。
    if (window.ReaderEngine && window.ReaderEngine.current &&
        window.ReaderEngine.current.isOpen && window.ReaderEngine.current.isOpen()) {
      window.ReaderEngine.current.hideReader();
    }
    // 摘掉引擎里那一份：同一块 DOM 上换部要重新挂（见 enterBook）
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
      if (!entry || !entry.book) return;   // 课内诗词走 <a> 的原生跳转
      // 中键 / Ctrl / ⌘ / Shift 点击：用户要的是「新标签页打开」，
      // 那就让他走 /tangshi/ 那一页（就地打开只在当前标签页里成立）
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
    // 对外：把某一部的索引铺上来 / 收回去（测试与「贴地址」这一路用它）
    open: enterBook,
    close: exitBook,
    current: function () { return current ? current.id : ""; },
    rail: function () { return rail; }
  };
})();
