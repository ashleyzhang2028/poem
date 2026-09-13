/**
 * 全站搜索（/search/ · 五部集子一次搜遍）
 * ==========================================================================
 * 这一页与 js/classic.js / js/tangshi.js / js/songci.js / js/guwen.js 同族，
 * 但有两处根本差别：
 *
 *   一、**数据来源**：前四页各取自己那一部的 window.POEMS_*；
 *       这一页取 data/site-index.js 的 window.SITE_INDEX ——
 *       那张表本来就是「全站篇目汇总」，搜索要的正是它。
 *       在页面里再拼一次五部，日后加第六部就会漏一处。
 *
 *   二、**搜什么**：集子索引页只在「篇名 / 作者 / 朝代 / 出处」里找；
 *       搜索页还要搜**正文与译文**（extraFields: text / translation）。
 *       用户记不住篇名的时候，往往只记得住一句话 ——
 *       「先天下之忧而忧」要能搜到《岳阳楼记》，这是搜索页存在的理由。
 *
 * 每条结果的 id 带集子前缀（`tangshi-ts-12`）：五部的原 id 各自从 1 排起，
 * 必然撞在一起；带前缀才是全站唯一键，也顺带说明了「这一条出自哪一部」。
 *
 * 已读存储：搜索页**不写任何已读键**（readStore 为空字符串）。
 *   「已读」是每一部自己的进度（poem_classic_read_v1 等），
 *   在搜索页点一下不该改动任何一部的进度 —— 用户是来查东西的，不是来读书的。
 *   阅读器里的「标记已读」按钮因此整颗隐藏（见 reader-core.js 的 hasReadStore）。
 *
 * 集子筛选：一栏药丸，来自 window.SITE_BOOKS；「全部」之外每个都带篇数。
 *   篇数实时从总索引算，不写死 —— 哪一部日后增补篇目，这里跟着变。
 *   筛选状态记在 sessionStorage，从详情页返回时不会丢。
 */
(function () {
  "use strict";

  /** 集子筛选状态：'all' 或某一部的 id。存 session 不存 local：
      用户可能同时开着两个标签页看不同的部，local 会互相覆盖。 */
  var FILTER_KEY = "poem_search_book_v1";

  /** 候选下拉最多几条：够用即可，多了挡住结果列表 */
  var SUGGEST_MAX = 8;

  var api = null;
  var books = [];
  var bookFilter = "all";
  var suggestIndex = -1;   // 键盘上下键当前选中的候选序号

  function readFilter() {
    try { return sessionStorage.getItem(FILTER_KEY) || "all"; } catch (e) { return "all"; }
  }
  function saveFilter(v) {
    try { sessionStorage.setItem(FILTER_KEY, v); } catch (e) { /* 隐私模式忽略 */ }
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------------- 篇目集合 ---------------- */

  /**
   * 真正的「篇目」：总索引里除了每一部自己的条目，还各挂一条
   * 「集子自身」（isBook，用来搜「唐诗三百首」四个字直接进那一页）。
   * 计数要把它排除掉 —— 否则「共 N 篇」「唐诗 302 首」都会比实际多一条，
   * 读起来就是错的。集子条目仍留在候选与结果里（搜集子名要能命中它）。
   */
  function allItems() {
    return (window.SITE_INDEX || []).filter(function (p) { return !p.isBook; });
  }

  function currentItems() {
    if (bookFilter === "all") return allItems();
    return allItems().filter(function (p) { return p.book === bookFilter; });
  }

  function totalCount() { return allItems().length; }

  function countOf(bookId) {
    return allItems().filter(function (p) { return p.book === bookId; }).length;
  }

  function unitOf(id) {
    if (id === "all") return "篇";
    var hit = books.filter(function (b) { return b.id === id; })[0];
    return hit ? hit.unit : "篇";
  }

  /* ---------------- 集子筛选药丸 ---------------- */

  function renderBookSeg() {
    var seg = document.getElementById("search-book-seg");
    if (!seg) return;
    var items = [{ id: "all", name: "全部", count: totalCount() }].concat(
      books.map(function (b) { return { id: b.id, name: b.name, count: countOf(b.id) }; })
    );
    seg.innerHTML = items.map(function (it) {
      var on = bookFilter === it.id;
      return '<button type="button" data-book="' + it.id + '"' +
        (on ? ' class="active"' : "") +
        ' aria-pressed="' + (on ? "true" : "false") + '"' +
        ' title="只看' + it.name + '（' + it.count + " " + unitOf(it.id) + '）">' +
        it.name + '<span class="book-count">' + it.count + "</span></button>";
    }).join("");
  }

  function onBookClick(e) {
    var btn = e.target && e.target.closest ? e.target.closest("[data-book]") : null;
    if (!btn) return;
    bookFilter = btn.getAttribute("data-book");
    saveFilter(bookFilter);
    applyBookFilter();
    renderBody();
  }

  /**
   * 切换集子筛选：**换掉实例里的 items**，不重新 mount。
   *
   * mount() 对「同一个 root 又传一份新 config」有防重：它把第二份当成
   * 「同一块挂在两处」而退回**已有那个实例**（见 reader-core.js 的 mount）。
   * 所以「改筛选就再 mount 一次」的写法根本不会生效 —— 页面看起来毫无反应，
   * 用户以为筛选坏了。这里用引擎实例的 setItems()：
   * 按新的一份重排列表、保留阅读器与关键词状态。
   */
  function applyBookFilter() {
    if (api) api.setItems(currentItems());
  }

  /* ---------------- 候选下拉 ---------------- */

  function suggestBox() { return document.getElementById("search-suggest"); }

  /**
   * 命中权重：篇名命中最高，作者 / 出处次之，正文 / 译文最低。
   * 返回 0 表示不命中。与引擎的 haystack 同一组字段
   * （见 mountCfg 的 extraFields），只是再排一下序 ——
   * 输入「月」，用户要找的是《静夜思》《水调歌头·明月几时有》这类
   * 篇名里带「月」的，而不是正文里偶有「月」字的长篇。
   */
  function matchScore(p, q) {
    var title = String(p.title || "").toLowerCase();
    var author = String(p.author || "").toLowerCase();
    var rest = [p.bookName, p.source, p.selection, p.dynasty, p.gradeGroup].join(" ").toLowerCase();
    var body = [p.text, p.translation].join(" ").toLowerCase();
    if (title.indexOf(q) >= 0) return 4;
    if (author.indexOf(q) >= 0) return 3;
    if (rest.indexOf(q) >= 0) return 2;
    if (body.indexOf(q) >= 0) return 1;
    return 0;
  }

  /** 候选：走与结果列表同一套匹配（同一组字段），只取前 SUGGEST_MAX 条 */
  function suggestItems(kw) {
    var q = String(kw || "").trim().toLowerCase();
    if (!q) return [];
    var hit = currentItems().filter(function (p) { return matchScore(p, q) > 0; });
    hit.sort(function (a, b) {
      var sa = matchScore(a, q);
      var sb = matchScore(b, q);
      if (sa !== sb) return sb - sa;
      return String(a.title).length - String(b.title).length;
    });
    return hit.slice(0, SUGGEST_MAX);
  }

  function renderSuggest(kw) {
    var box = suggestBox();
    if (!box) return;
    var list = suggestItems(kw);
    suggestIndex = -1;
    if (!list.length) {
      box.hidden = true;
      box.innerHTML = "";
      box.dataset.items = "";
      setExpanded(false);
      return;
    }
    box.innerHTML = list.map(function (p, i) {
      return '<button type="button" class="suggest-item" role="option" data-suggest="' + i + '"' +
        ' aria-selected="false">' +
        '<span class="suggest-title">' + esc(p.title) + "</span>" +
        '<span class="suggest-meta">' +
        esc([p.dynasty, p.author].filter(Boolean).join(" · ")) +
        (p.bookName ? (p.dynasty || p.author ? " · " : "") + "<em>" + esc(p.bookName) + "</em>" : "") +
        "</span></button>";
    }).join("");
    box.dataset.items = JSON.stringify(list.map(function (p) { return p.id; }));
    box.hidden = false;
    setExpanded(true);
  }

  function setExpanded(on) {
    var input = document.getElementById("gw-search");
    if (input) input.setAttribute("aria-expanded", on ? "true" : "false");
  }

  function hideSuggest() {
    var box = suggestBox();
    if (!box) return;
    box.hidden = true;
    suggestIndex = -1;
    setExpanded(false);
  }

  /** 键盘上下键移动候选高亮（到底回头，不卡住） */
  function moveSuggest(dir) {
    var box = suggestBox();
    if (!box || box.hidden) return false;
    var items = box.querySelectorAll(".suggest-item");
    if (!items.length) return false;
    suggestIndex += dir;
    if (suggestIndex < 0) suggestIndex = items.length - 1;
    if (suggestIndex >= items.length) suggestIndex = 0;
    for (var i = 0; i < items.length; i++) {
      var on = i === suggestIndex;
      items[i].classList.toggle("active", on);
      items[i].setAttribute("aria-selected", on ? "true" : "false");
    }
    return true;
  }

  function suggestIds() {
    var box = suggestBox();
    if (!box || !box.dataset.items) return [];
    try { return JSON.parse(box.dataset.items) || []; } catch (e) { return []; }
  }

  /** 选中一条候选：打开详情页 —— 与点结果列表走的是同一条路径 */
  function pickSuggest(i) {
    var ids = suggestIds();
    if (i < 0 || i >= ids.length) return false;
    if (api) api.open(ids[i]);
    hideSuggest();
    return true;
  }

  /* ---------------- 结果列表 ---------------- */

  function renderBody() {
    renderBookSeg();
    var input = document.getElementById("gw-search");
    var kw = input ? input.value : "";
    if (api) api.setKeyword(kw);
    annotateMatches(kw);
    var hint = document.getElementById("search-hint");
    if (hint) hint.hidden = String(kw).trim().length > 0;
  }

  /**
   * 给每条「正文 / 译文命中」的结果补一句命中上下文。
   * 否则用户看到「《岳阳楼记》」会想「我搜的句子在哪儿」——
   * 摘出前后各 12 字，答案就在眼前。
   * 数据自带 excerpt（名句摘句）时不覆盖：摘句比机器截的更能认出作品。
   */
  function annotateMatches(kw) {
    var q = String(kw || "").trim();
    var listEl = document.querySelector("#gw-list");
    if (!listEl || !q) return;
    listEl.querySelectorAll(".item").forEach(function (el) {
      var id = el.dataset.id;
      var p = allItems().filter(function (x) { return x.id === id; })[0];
      if (!p) return;
      var ctx = matchContext(p, q);
      if (!ctx) return;
      var meta = el.querySelector(".item-meta");
      if (!meta) return;
      var old = meta.querySelector(".item-hit");
      if (old) old.parentNode.removeChild(old);
      meta.insertAdjacentHTML("beforeend", '<span class="item-hit">…' + esc(ctx) + "…</span>");
    });
  }

  /** 从正文 / 译文里截出关键词前后各 12 字的上下文 */
  function matchContext(p, q) {
    var i = String(p.text || "").toLowerCase().indexOf(q.toLowerCase());
    var src = p.text || "";
    if (i < 0) {
      src = p.translation || "";
      i = String(src).toLowerCase().indexOf(q.toLowerCase());
    }
    if (i < 0) return "";
    var a = Math.max(0, i - 12);
    var b = Math.min(src.length, i + q.length + 12);
    return src.slice(a, b).replace(/\s/g, "");
  }

  /* ---------------- 启动 ---------------- */

  /**
   * 一次 mount 用到的全部配置。
   *
   * extraFields 是引擎自带的「关键词还该在哪些字段里找」：
   *   · text / translation —— 搜索页与其余各页最大的不同就在这：
   *     在集子索引页里搜「先天下之忧而忧」毫无意义（那一页只搜本集的题名作者），
   *     但搜索页必须能搜到 —— 用户记不住篇名，只记得住一句话。
   *   · bookName / gradeGroup —— 搜「唐诗三百首」要列出那一部的全部篇目，
   *     搜「卷一 周文」也要能筛出《古文观止》第一卷。
   */
  function mountCfg() {
    return {
      id: "search",
      items: currentItems(),
      root: "[data-gw-root]",
      reader: "#gw-reader",
      // 空数组：搜索结果不按卷次 / 词牌重排，按总索引的顺序（课内在前、四部在后）
      groupOrder: [],
      pageTitle: "搜索",
      pageSub: "全站篇目，一搜就到",
      extraFields: ["text", "translation", "bookName", "gradeGroup"],
      words: {
        list: "篇目",
        unit: "篇",
        loadingFailed: "全站篇目索引加载失败",
        empty: "没有找到匹配的篇目",
        matchGroup: "",
        backToList: "返回搜索结果",
        // 搜索页不碰任何一部的已读 —— 空键名即「本页不提供标记已读」
        readStore: "",
        playerTitle: "朗读",
        searchPlaceholder: "搜索篇名 / 作者 / 诗句（全站）"
      }
    };
  }

  function boot() {
    if (!window.ReaderEngine) return;
    var all = allItems();
    if (!all.length) {
      var listEl = document.querySelector('[data-gw="list"]');
      if (listEl) listEl.innerHTML = '<div class="empty">全站篇目索引加载失败</div>';
      return;
    }

    books = (window.SITE_BOOKS || []).slice();
    bookFilter = readFilter();
    if (bookFilter !== "all" && !books.some(function (b) { return b.id === bookFilter; })) {
      bookFilter = "all";
    }

    // 集子筛选与「全部 / 未读」是两套筛选，不能共用一个容器：
    // 前者是会话里的 bookFilter（本文件管），后者是引擎的 filter（引擎管）。
    api = window.ReaderEngine.mount(mountCfg());
    if (!api) return;

    var seg = document.getElementById("search-book-seg");
    if (seg) seg.addEventListener("click", onBookClick);

    var input = document.getElementById("gw-search");
    if (input) {
      input.addEventListener("input", function () {
        renderBody();
        renderSuggest(input.value);
      });
      input.addEventListener("focus", function () {
        if (input.value.trim()) renderSuggest(input.value);
      });
      input.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown") {
          if (moveSuggest(1)) e.preventDefault();
        } else if (e.key === "ArrowUp") {
          if (moveSuggest(-1)) e.preventDefault();
        } else if (e.key === "Enter") {
          if (suggestIndex >= 0 && pickSuggest(suggestIndex)) e.preventDefault();
          else hideSuggest();
        } else if (e.key === "Escape") {
          hideSuggest();
        }
      });
      input.addEventListener("blur", function () {
        // 延迟收起：鼠标点候选时先触发 blur，立刻收起就点不到了
        setTimeout(hideSuggest, 180);
      });
    }

    var box = suggestBox();
    if (box) {
      box.addEventListener("mousedown", function (e) {
        // mousedown 而不是 click：blur 抢在 click 之前，
        // 点下去时那 180ms 的收起定时器还没到，click 会被吃掉
        var btn = e.target.closest ? e.target.closest("[data-suggest]") : null;
        if (!btn) return;
        e.preventDefault();
        pickSuggest(parseInt(btn.getAttribute("data-suggest"), 10));
      });
    }

    renderBookSeg();
    renderBody();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  /** 供测试与宿主页面调用 */
  window.SiteSearch = {
    filter: function () { return bookFilter; },
    setFilter: function (v) {
      bookFilter = v;
      saveFilter(v);
      applyBookFilter();
      renderBody();
    },
    items: function () { return currentItems(); },
    suggest: function (kw) { return suggestItems(kw); },
    books: function () { return books.slice(); }
  };
})();
