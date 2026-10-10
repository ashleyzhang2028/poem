/* ==========================================================================
   作者索引页（Issue #480）
   --------------------------------------------------------------------------
   用户原话：

     「搜索大类功能，增加作者作品索引页，按时间朝代顺序，将中国所有作品的
       作者列在一页，上面是朝代索引列表，点击朝代可以下面的具体朝代，
       朝代下面是各个作者，例如唐代 李白，点击李白，显示李白所有作品列表，
       再点击列表，进入详情页，详情页的上一页下一页都是该作者的作品。
       返回就回到李白列表。」

   三层，全部**就地**展开（不换页、不改 url）：
     ① 朝代索引卡 + 各朝代段（一段里是这一朝的作者，**一行行胶囊**：
        只有「名字 + 条数」，一行三个起步 —— 见 `eraCard()`）
     ② 点作者 → 作品列表（空搜索 + 全部 / 未读 + 随机连读，与集子页同构）
     ③ 点作品 → 详情页，上一页 / 下一页**只在该作者的作品里走**

   返回键一层退一层：③ → ② → ①。

   ## 入口在搜索页，不在课外阅读

   这一页挂在 `/search/` 里（Issue #480 第二轮：用户要「从搜索页进，不是从
   课外阅读集子页进」）。所以搜索页上有**三件**东西：顶上那颗搜索框、下面
   一行「作者索引」入口、再下面的全站结果列表 —— 它们各归各的：

     · 顶上那颗搜索框 `#site-search` 走 js/search.js 自己那一套（输入即出
       候选与结果，结果铺进 `#site-gw-list`）；
     · 下面那颗 `#gw-search` 与 `#gw-list` 是**阅读器的**，只服务②③两层。

   ①层展开时把搜索页那两件收起来（加 `hidden` 不是删），退回①层（或从
   详情页一路退回到搜索页）再放回 —— 搜索关键词与滚动位置都还在。
   `setSearchLayer()` 一处管这件事。

   ## 这一页与集子页的关系

   列表与阅读器还是 js/reader-core.js 那一套（`window.ReaderEngine.mount`）。
   不同的只有两处，都不动引擎：

     1. **第一层不是阅读器的列表** —— 它是「朝代表 + 作者名册」两张静态卡。
        引擎只在②③这两层出场。所以第一层直接铺 DOM，`enterAuthor()` 才
        把引擎挂上、`data-gw` 那些节点才第一次被填内容。

     2. **详情页的「上一篇 / 下一篇」按作者切** —— 引擎的 `allItems()` 吃的是
        mount 时给的 `items`，所以进②时把 `items` 换成**这一位作者的作品**，
        上一页 / 下一页自然就不跨作者了（这正是用户要的）。退回①时
        `unmount()` 掉整个会话 —— 下一位作者是下一次 mount、另起一炉。

   ⚠️ 一处踩过的坑：**不能**反复 `mount` 同一组 `root` / `reader` 而不卸载。
   引擎按 `(root, cfg)` 认会话，`cfg` 是每次新建的对象，认不出来就再挂一个，
   挂到第五个的时候 `$()` 会从最早那个会话里取节点。所以 `enterAuthor()`
   第一件事是 `unmount()` 上一次，`leaveAuthor()` 同样。
   ========================================================================== */
(function () {
  "use strict";

  var AI = null;
  var listEl = null;        /* ②③ 两层的列表容器（阅读器的 [data-gw="list"]） */
  var readerBox = null;
  var indexPath = null;     /* ① 那一层：朝代索引卡 + 作者名册 */
  var api = null;           /* 当前 mount 出来的阅读器会话 */
  var current = null;       /* 当前这一位作者（②③ 层）；①层时为 null */
  var leaving = false;

  /* 搜索页自己那一套（Issue #480 第二轮）：作者索引展开时它们让位，
     退回来再放回。 */
  var searchNodes = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* 拼音序：手机、电脑、Node 三处跑出来一样。`sensitivity:"base"` 让
     「曹」与「艹」类不因声调分家 —— 这里排的是人名，不是生僻字表。 */
  function byPinyin(a, b) {
    try {
      return String(a.name).localeCompare(String(b.name), "zh-Hans-CN", { sensitivity: "base" });
    } catch (e) {
      return String(a.name) < String(b.name) ? -1 : 1;
    }
  }

  function peopleOf(at) {
    return AI.byEra(at).slice().sort(byPinyin);
  }

  /* 一位作者名下可能挂着好几处朝代写法（同一个人在不同选本里写法不同，
     例如一位唐代诗人被某处误标成「先秦」）。这里取**落在最早那一朝**的那
     一个写法 —— 与 `data/author-index.js` 里 `w.at` 的取法同源（也是取
     最早），否则名册页上会出现「先秦 · 骆宾王」，名册自己却把他摆在唐。 */
  function earliestDynasty(w) {
    var best = "";
    var bestAt = 99;
    Object.keys(w.dynasties || {}).forEach(function (d) {
      var at = window.AuthorIndex ? window.AuthorIndex.eraOf(d) : 99;
      if (at < bestAt) { bestAt = at; best = d; }
    });
    return best;
  }

  var CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.4 5.6 15.8 12l-6.4 6.4"/></svg>';

  /* ── 搜索页那两件：作者索引展开时让位，退回来再放回 ──────────────────
     这里**只加 hidden、不删 DOM** —— 搜索框里那个关键词、结果列表的滚动
     位置，回来的时候都还在（用户按一下作者索引是来看名册的，不是要把自己
     刚搜的东西清掉）。

     ⚠️ 搜索的 hero（顶上那颗搜索框）收起时要连**可见性**一起收 —— 它
     有一份「键盘顶起来时把 hero 抬走」的定位逻辑（js/search.js 的
     `syncHeroState`），留着它、只把作者名册塞在下面，手机上会被那块
     抬起来的定位盖住。 */
  function setSearchLayer(on) {
    if (!searchNodes) return;
    searchNodes.forEach(function (el) {
      if (!el) return;
      el.hidden = !!on;
    });
  }

  /* ── ① 朝代索引卡 ────────────────────────────────────────────────────
     与集子列表页顶上那张 `.group-index-card` 同一份长相、同一份交互
     （左名右数、手机竖屏一行两列、点一格就地滚到那一段并给一道高亮）。
     `data-index-group` 那个属性名也照旧 —— ① 层是这一页自己铺的 DOM，
     所以点击由本文件的 handler 接（不是引擎里那个）。 */
  function indexCard(groups) {
    var sec = document.createElement("section");
    sec.className = "group-index-card";
    sec.setAttribute("data-index-card", "1");
    sec.innerHTML =
      '<div class="group-index-head">' +
      '<p class="group-index-tag">朝代</p>' +
      '<span class="group-index-count">' + groups.length + " 朝</span>" +
      "</div>" +
      '<div class="group-index-list">' +
      groups.map(function (g) {
        return '<button type="button" class="group-index-pick"' +
          ' data-index-group="' + esc(g.name) + '"' +
          ' aria-label="跳到 ' + esc(g.name) + '">' +
          '<span class="group-index-name">' + esc(g.name) + "</span>" +
          '<span class="group-index-num">' + g.count + " 家</span>" +
          "</button>";
      }).join("") +
      "</div>";
    return sec;
  }

  /* ── ① 各朝代段：段里是这一朝的作者 ─────────────────────────────────
     段里**只有**「作者名 + 条数」两件事，排成和顶上那张朝代索引卡**同一副
     长相**的格子：左名右数、一条细线分隔，名字左对齐、数字右对齐。

     为什么不是一行一位作者：手机上那是一个作者一行、右边一颗箭头一把小字，
     一部《唐诗》就摆出上百行，读者要点着滚动条把一整朝滤一遍。名册要的是
     「扫一眼有谁」，不是「读一行的详情」—— 朝代、集子名、条数这些小字
     全都不进名册，名字自己就是索引。点哪一格进哪一位的作品列表，
     该有的信息在②层里一条不少。

     为什么不是行内胶囊（Issue #484 第五轮）：胶囊按名字长短各拿各的宽，
     一行三四个、行行参差，数字也跟在名字屁股后头跳来跳去 —— 用户原话
     「还是显得乱了」。改成等分格子后，每一列的名字起笔对齐、数字右端
     对齐，一竖列扫下来就是一张表。

     字号 / 字形取搜索页那颗「作者索引」入口那一档（13px、UI 黑体），
     与①层那张朝代索引卡同一族 —— 名册一行四格起步，字号比朝代卡收半号，
     长名字才放得下。 */
  function eraCard(g) {
    var people = peopleOf(g.at);
    var sec = document.createElement("section");
    sec.className = "group-card author-era";
    sec.dataset.group = g.name;

    var head = document.createElement("div");
    head.className = "group-head";
    head.innerHTML =
      '<span class="group-name">' + esc(g.name) + "</span>" +
      '<span class="group-count">' + people.length + " 家 · " + g.works + " 条</span>";
    sec.appendChild(head);

    var wrap = document.createElement("div");
    wrap.className = "author-grid";
    people.forEach(function (w) {
      var el = document.createElement("button");
      el.type = "button";
      el.className = "author-cell";
      el.dataset.author = w.name;
      el.innerHTML =
        '<span class="author-name">' + esc(w.name) + "</span>" +
        '<span class="author-count">' + w.items.length + "</span>";
      el.addEventListener("click", function () { enterAuthor(w.name); });
      wrap.appendChild(el);
    });
    sec.appendChild(wrap);

    return sec;
  }

  function renderIndex() {
    if (!indexPath) return;
    var groups = AI.groups();
    indexPath.innerHTML = "";
    indexPath.appendChild(indexCard(groups));
    groups.forEach(function (g) { indexPath.appendChild(eraCard(g)); });
  }

  /* 就地滚到某一朝那一段 —— 与引擎里 `jumpToGroup` 同一份做法、同一道
     `.group-card.flash` 高亮。 */
  function jumpToEra(name) {
    if (!indexPath) return;
    var hit = null;
    Array.prototype.slice.call(indexPath.querySelectorAll(".group-card")).forEach(function (c) {
      if (!hit && c.getAttribute("data-group") === name) hit = c;
    });
    if (!hit) return;
    try { hit.scrollIntoView({ block: "start", behavior: "smooth" }); }
    catch (e) { hit.scrollIntoView(true); }
    hit.classList.remove("flash");
    void hit.offsetWidth;
    hit.classList.add("flash");
    setTimeout(function () { hit.classList.remove("flash"); }, 1200);
  }

  /* 作者列表顶上再摆一张「这一朝有谁」的小卡？不做 —— 一朝的作者本来就在
     同一屏里排开，名字就是索引，再拿名字索引名字就成了同义反复。 */

  /* ── ② 点作者 → 作品列表（阅读器引擎接手）────────────────────────── */
  function mountConfig(w) {
    var items = AI.itemsOf(w);
    return {
      id: "authors",
      items: items,
      allowEmpty: true,
      root: "[data-gw-root]",
      reader: "#gw-reader",

      /* 不给分组顺序：一位作者的作品不该再分卷 —— 集的顺序（SITE_INDEX 的
         顺序）就是这一位作者的顺序。`groupOrder: []` 会让 allItems() 原样返回。 */
      groupOrder: [],

      pageTitle: "作者索引",
      /* 这一行小注在②③两层都要在，而**阅读器一开详情页就把 `.brand-sub`
         按 `CFG.pageSub` 重刷一遍**（`js/reader-core.js` 的 `paintSub()`）——
         所以「某某等」那四位的出处注要**同时**写在这里和 `paintHead()` 里，
         两处取同一个源（`AI.collectedNote()`）。只写 `paintHead()` 的话，
         一点进作品就退回通用那一句（实测过）。 */
      pageSub: AI.collectedNote(w.name) || "朝代 · 作者 · 作品，三级都在这一页",
      extraFields: ["text", "translation", "authorName"],

      words: {
        list: "作品",
        unit: "条",
        loadingFailed: "作者作品索引加载失败",
        empty: "这一位还没有收作品",
        matchGroup: "",
        backToList: "返回" + w.name,
        countInvalid: "作者作品索引加载失败",

        readStore: "poem_authors_read_v1",
        playerTitle: "朗读",
        searchPlaceholder: "搜索篇名 / 出处 / 集子"
      }
    };
  }

  function enterAuthor(name) {
    var w = AI.byName(name);
    if (!w || !window.ReaderEngine) return;
    var items = AI.itemsOf(w);
    if (!items.length) return;

    leaveAuthor(true);
    current = w;

    indexPath.hidden = true;
    setSearchLayer(true);
    document.querySelector("[data-lib-view='author']").hidden = false;

    var cfg = mountConfig(w);
    /* 详情页里那个「返回」回到**这一位作者的作品列表**（不是回大索引）：
       reading 时按一下退一层，正是用户要的「返回就回到李白列表」。 */
    cfg.openFrom = function () {
      if (api && api.isOpen && api.isOpen()) return null;
      return function () { leaveAuthor(); };
    };
    cfg.onHideReader = function () { return leaving ? "drop-list" : true; };

    api = window.ReaderEngine.mount(cfg);
    if (!api) { leaveAuthor(); return; }
    window.ReaderEngine.current = api;

    paintHead(w.name);
    paintBack();
    window.scrollTo(0, 0);
  }

  function leaveAuthor(silent) {
    leaving = true;
    if (window.ReaderEngine && window.ReaderEngine.current &&
        window.ReaderEngine.current.isOpen && window.ReaderEngine.current.isOpen()) {
      window.ReaderEngine.current.hideReader();
    }
    leaving = false;

    if (window.ReaderEngine && window.ReaderEngine.unmount) {
      window.ReaderEngine.unmount(listEl);
      window.ReaderEngine.current = null;
    }
    api = null;
    current = null;
    if (listEl) listEl.innerHTML = "";

    var rail = document.querySelector("[data-lib-view='author']");
    if (rail && !silent) rail.hidden = true;
    if (indexPath && !silent) indexPath.hidden = false;
    if (!silent) setSearchLayer(false);

    if (!silent) {
      paintHead("");
      paintBack();
      renderIndex();
      window.scrollTo(0, 0);
    }
  }

  /* ① 层是搜索页里的一层，不是另一个页面 —— 所以标题也跟着分：
     名册展开时，顶上写「作者索引」；退回来自动还给搜索页自己那一份
     （`body[data-page]` 上的原话，chrome 认它）。 */
  function paintHead(name) {
    var C = window.SiteChrome;
    if (!C) return;
    if (!name) {
      C.setPage(null);
      C.setSub("");
      return;
    }
    C.setPage(name === "作者索引" ? "搜索 · 作者索引" : name);
    /* 作者的作品列表（②）那一行小注：平常是「某某 的作品」；
       「某某等」那四位（房玄龄等 / 脱脱等 / 宋濂等 / 李昉等）换成出处注 ——
       用户 2026-10-06 报的正是「有一些作者 出现了 等」。这四位核实下来
       **署名无误、原样保留**（官修书多人分撰，「某某等」是文献上通行的写法），
       那就得让人看得出那个「等」字是有来由的，不是含糊其辞。
       点进作品列表时读得到「《宋史》为元至正年间奉敕所修，脱脱等总裁……」。
       别的作者一个字不动，照旧「某某 的作品」。 */
    if (name === "作者索引") {
      C.setSub("朝代 · 作者 · 作品");
    } else {
      C.setSub(AI.collectedNote(name) || name + " 的作品");
    }
  }

  /* 顶上那颗返回。三层各有各的落点：

       · 名册（①）→ 回**搜索**（这个词是这一层从搜索页借来的，不还回去
         它就一直是「搜索」这个词条页）；
       · 作者的作品列表（②）→ 回名册；
       · 详情页（③）→ 回**这一位作者的作品列表**（「返回就叫『返回李白』」，
         正是用户要的「返回就回到李白列表」）。

     ②③ 两层由 `current` 认（`current` 非空即在这两层里），点一下退一层。 */
  function paintBack() {
    if (!window.SiteChrome || !window.SiteChrome.setPageAction) return;

    if (!current) {
      /* ① 名册这一层：回搜索页。名册是 `/search/` 里的一层，所以这里
         不跳转、只把这一层收起来 —— 搜索框与命中行原样还在下面。 */
      if (indexPath && !indexPath.hidden) {
        window.SiteChrome.setPageAction({
          label: "返回搜索",
          onclick: function () {
            indexPath.hidden = true;
            setSearchLayer(false);
            paintHead("");
            paintBack();
            window.scrollTo(0, 0);
          }
        });
      } else {
        window.SiteChrome.setPageAction(null);
      }
      return;
    }

    window.SiteChrome.setPageAction({
      label: "返回作者索引",
      onclick: function () { leaveAuthor(); }
    });
  }

  /* 「作者索引」那颗入口（搜索页 hero 里那一行）：点开名册本身。
     入口不止一个（顶上那颗搜索框所在的那一行），所以按 id 接一次就够 ——
     节点是静态的，不会随 renderIndex() 重建。 */
  function bindEntry() {
    var btn = document.getElementById("author-entry");
    if (!btn) return;
    /* 入口条虽然只在搜索层露着，但它也可能在**名册还开着**的时候被点到
       （退回搜索层后没刷新、又有缓存的 DOM；或者用户从浏览器历史回来）。
       所以这里不假设当前是哪一层：一律收成「名册根 + 滚到顶」。 */
    btn.addEventListener("click", function () {
      if (current) leaveAuthor();
      try { history.pushState({ authors: "1" }, ""); } catch (e) {  }
      indexPath.hidden = false;
      setSearchLayer(true);
      paintHead("作者索引");
      paintBack();
      window.scrollTo(0, 0);
    });
  }

  function bind() {
    /* ① 层的点击：索引卡的「跳到某一朝」与作者卡。
       ⚠️ 都在 **document** 上接、用 closest 判归属，因为 ① 层的 DOM 每次
       `renderIndex()` 都重建一遍 —— 接在节点上的 handler 会跟着丢。 */
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      var idx = t.closest("[data-index-group]");
      if (idx && indexPath && indexPath.contains(idx)) {
        e.preventDefault();
        jumpToEra(idx.getAttribute("data-index-group"));
        return;
      }

      var a = t.closest("[data-author]");
      if (a && indexPath && indexPath.contains(a)) {
        e.preventDefault();
        enterAuthor(a.getAttribute("data-author"));
      }
    });
  }

  function boot() {
    AI = window.AuthorIndex;
    if (!AI) return;
    indexPath = document.getElementById("authors-index");
    listEl = document.getElementById("gw-list");
    readerBox = document.getElementById("gw-reader");
    if (!indexPath || !listEl) return;

    searchNodes = [
      document.getElementById("search-hero"),
      document.getElementById("site-gw-list")
    ].filter(Boolean);

    bindEntry();
    renderIndex();
    bind();
    paintHead("");
    paintBack();

    /* 返回键（浏览器 / 手机手势）在这一页上 = 退一层，不是离开这一页：
       详情页 → 作者的作品列表 → 名册 → 搜索。不接这一个，一路退回去会
       直接跳出 `/search/`（这一层是「就地」铺的，url 没变过），用户就
       把自己刚搜的词丢了。只在真有层可退时拦，退到搜索层就放行。 */
    window.addEventListener("popstate", function () {
      if (!current && (!indexPath || indexPath.hidden)) return;
      history.pushState({ authors: "1" }, "");
      if (current) leaveAuthor();
      else {
        indexPath.hidden = true;
        setSearchLayer(false);
        paintHead("");
        paintBack();
        window.scrollTo(0, 0);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  /* 对外的口子。两拨人各要一份：

       · 页面自己（js/authors.js 内的三层）用 `eras` / `people` / `open` /
         `close` / `current`；
       · `test/authors.test.js` 那一层要的是**名册数据**（朝代 → 作者 →
         作品那三张表），就是 `index()`。它不碰 DOM、也不开阅读器会话，
         所以两拨各留各的，谁也不替谁。

     ⚠️ `open` / `close` 只在挂上 `window.AuthorIndex` 的那一页有意义 ——
     数据层那份（`index()`）在 Node 沙盒里也能跑。 */
  window.AuthorsPage = {
    index: function () {
      if (!AI) return { authors: [], byAuthor: {} };
      var people = AI.people();
      var byAuthor = {};
      /* `dynasty` 是**原写法**（集子里怎么写的就怎么给），`key` 是归并之后的
         朝代段名 —— 数据层那两张表当年要的就是这两个数，别拿 `key` 冒充
         `dynasty`（`南宋` 与 `宋` 在这两格上不是一个意思）。
         `at` 不为 0 的先按时间轴排、再按名字：名册页自己那份顺序另有讲究
         （朝内按拼音），这里是给数据层用的。 */
      var ordered = people.slice().sort(function (a, b) {
        var ra = a.at || 99, rb = b.at || 99;
        if (ra !== rb) return ra - rb;
        return byPinyin(a, b);
      });
      var rows = ordered.map(function (w) {
        return {
          name: w.name,
          dynasty: earliestDynasty(w),
          key: AI.eraName(earliestDynasty(w)),
          works: AI.itemsOf(w)
        };
      });
      rows.forEach(function (r) { byAuthor[r.name] = r; });
      return { authors: rows, byAuthor: byAuthor };
    },

    eras: function () { return AI ? AI.groups() : []; },
    people: function (at) { return AI ? peopleOf(at) : []; },
    open: function (name) { enterAuthor(name); },
    close: function () { leaveAuthor(); },
    current: function () { return current ? current.name : ""; }
  };
})();
