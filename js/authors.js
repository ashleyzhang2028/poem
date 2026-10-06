(function () {
  "use strict";

  /* ==========================================================================
     作者索引（Issue #480）
     --------------------------------------------------------------------------
     用户裁决：作者索引**从搜索页进**，不从课外阅读集子页进。

     一页三级，就地展开（与「课外阅读 → 集子 → 正文」同一套三层口径）：

       1. 朝代索引卡（页顶，沿用 `.group-index-card`）—— 先秦一路到近现代，
          一条时间轴；点一朝就滚到那一段。
       2. 朝代段（`.group-card`）—— 段里是这一朝的**作者**，左名右数
          （条数 = 该作者在本站的全部作品数）。
       3. 点作者 → 该作者的**作品列表**（空搜索框 + 全部 / 未读筛选 +
          随机连读，与集子页同构）；点作品 → 详情页，上一页 / 下一页
          **只在该作者的作品里走**（items 就是该作者的作品，天然不跨作者），
          返回键一层退一层。

     收哪些集子：文学作品的十部（课内诗词 / 古文 / 乐府集 / 唐诗 /
     古诗「非唐代」/ 词 / 曲 / 古文观止 / 近现代诗词 / 昭明文选）。
     **不收**名家 / 帝王 / 文学常识 / 名著导读 / 成语 —— 「作者」在这些集子里
     是**词条本身**（李白既在《唐诗》里作作者、又在《名家「中国」》里作条目），
     收进来就成了自己给自己写作品。

     判重口径与全站一致：同一篇作品在两部集子里重复出现（课内的《静夜思》
     与《唐诗》的《夜思》）只算一次，认的是 WorksIndex 的 rep（代表条目）。
     ========================================================================== */

  var LITERARY_BOOKS = [
    "poems", "classic", "yuefu", "tangshi", "gushi",
    "songci", "yuanqu", "guwen", "jinxiandai", "zhaoming"
  ];

  /* 朝代归一：数据里写法有三十多种（宋 / 北宋 / 南宋 / 三国 / 三国·魏 /
     南朝·宋 / 东周 / 春秋 / 战国 …），归进同一条时间轴。表只列**本站出现过的**
     写法，没列到的原样保留、排在末尾（不吞掉）。 */
  var DYNASTY = {
    "先秦": "先秦", "东周": "先秦", "春秋": "先秦", "战国": "先秦",
    "战国·楚": "先秦", "先秦·宋": "先秦",
    "秦": "秦", "秦末": "秦",
    "汉": "汉", "西汉": "汉", "东汉": "汉",
    "三国": "三国", "三国·魏": "三国", "三国·蜀": "三国", "三国·吴": "三国",
    "晋": "晋", "西晋": "晋", "东晋": "晋",
    "南北朝": "南北朝", "南朝": "南北朝", "南朝·宋": "南北朝",
    "南朝·齐": "南北朝", "南朝·梁": "南北朝", "北朝": "南北朝", "北周": "南北朝",
    "隋": "隋",
    "唐": "唐",
    "五代": "五代", "十国": "五代",
    "宋": "宋", "北宋": "宋", "南宋": "宋", "辽": "宋", "金": "宋",
    "元": "元",
    "明": "明",
    "清": "清",
    "民国": "近现代", "现代": "近现代", "近现代": "近现代", "当代": "近现代"
  };

  var TIMELINE = [
    "先秦", "秦", "汉", "三国", "晋", "南北朝", "隋", "唐",
    "五代", "宋", "元", "明", "清", "近现代"
  ];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function chronoKey(d) {
    var v = String(d || "").trim();
    return DYNASTY[v] || v || "其他";
  }

  function chronoRank(k) {
    var i = TIMELINE.indexOf(k);
    return i === -1 ? TIMELINE.length : i;
  }

  function authorNameOf(p) {
    return String(p.authorName || p.author || "").trim();
  }

  /* 全站作品按作者收拢。同一篇跨集重复只算一次（认 rep）。 */
  var index = null;

  function buildIndex() {
    if (index) return index;

    var si = window.SITE_INDEX || [];
    var WI = window.WorksIndex;
    var seenWid = {};
    var byAuthor = {};
    var order = [];

    si.forEach(function (p) {
      if (!p || p.isBook || !p.id) return;
      if (LITERARY_BOOKS.indexOf(p.book) < 0) return;

      var name = authorNameOf(p);
      if (!name || name === "佚名" || name === "古辞" || name === "无名氏") return;

      if (WI && WI.widOf) {
        var wid = WI.widOf(p.id);
        if (seenWid[wid]) return;
        seenWid[wid] = true;

        var rep = WI.repOf ? WI.repOf(p.id) : p.id;
        if (rep !== p.id) return;
      }

      var key = name;
      if (!byAuthor[key]) {
        byAuthor[key] = {
          name: name,
          dynasty: p.dynasty || "",
          key: chronoKey(p.dynasty),
          works: []
        };
        order.push(key);
      }
      byAuthor[key].works.push(p);
    });

    /* 作者按朝代排、朝内按作品数从多到少、再按名字；朝代段按时间轴排。 */
    var authors = order.map(function (k) { return byAuthor[k]; });
    authors.forEach(function (a) {
      a.works.sort(function (x, y) {
        return String(x.title).localeCompare(String(y.title), "zh");
      });
    });
    authors.sort(function (a, b) {
      var ra = chronoRank(a.key), rb = chronoRank(b.key);
      if (ra !== rb) return ra - rb;
      if (a.key !== b.key) return a.key < b.key ? -1 : 1;
      if (a.works.length !== b.works.length) return b.works.length - a.works.length;
      return a.name.localeCompare(b.name, "zh");
    });

    index = { authors: authors, byAuthor: byAuthor };
    return index;
  }

  /* ---------------------------------------------------------------- 一级：作者索引 */

  function renderIndex() {
    var listEl = document.getElementById("authors-list");
    if (!listEl) return;
    var data = buildIndex();
    var kw = String((document.getElementById("authors-search") || {}).value || "").trim().toLowerCase();

    var authors = data.authors.filter(function (a) {
      if (!kw) return true;
      return a.name.toLowerCase().indexOf(kw) >= 0 ||
        String(a.dynasty).toLowerCase().indexOf(kw) >= 0 ||
        a.key.toLowerCase().indexOf(kw) >= 0;
    });

    if (!authors.length) {
      listEl.innerHTML = '<div class="empty search-empty">没有找到匹配的作者</div>';
      return;
    }

    /* 朝代分段（筛过之后按剩余作者重新分组）。 */
    var groups = [];
    var gByKey = {};
    authors.forEach(function (a) {
      if (!gByKey[a.key]) {
        gByKey[a.key] = { key: a.key, note: dynastyNote(a.key), authors: [] };
        groups.push(gByKey[a.key]);
      }
      gByKey[a.key].authors.push(a);
    });

    var html = indexCardHtml(groups);

    groups.forEach(function (g) {
      html += '<section class="group-card" data-group="' + esc(g.key) + '">' +
        '<h3 class="group-head">' + esc(g.key) +
        '<span class="group-note">' + esc(g.note) + "</span></h3>";
      g.authors.forEach(function (a) {
        html += '<button type="button" class="item author-item" data-author="' + esc(a.name) + '">' +
          '<span class="item-title">' + esc(a.name) + "</span>" +
          '<span class="item-meta"><span>' + esc(a.dynasty || g.key) + "</span>" +
          "<span>·</span><span>" + a.works.length + " 篇</span></span></button>";
      });
      html += "</section>";
    });

    listEl.innerHTML = html;
    bindIndexCard(listEl);
  }

  function dynastyNote(key) {
    var i = TIMELINE.indexOf(key);
    if (i < 0) return "";
    if (i === 0) return "中国文学最初的源头";
    return "承 " + TIMELINE[i - 1] + " 而下";
  }

  function indexCardHtml(groups) {
    if (groups.length < 2) return "";
    return '<section class="group-index-card" data-index-card="1">' +
      '<div class="group-index-head">' +
      '<p class="group-index-tag">朝代</p>' +
      '<span class="group-index-count">' + groups.length + " 朝</span>" +
      "</div>" +
      '<div class="group-index-list">' +
      groups.map(function (g) {
        return '<button type="button" class="group-index-pick" data-index-group="' + esc(g.key) +
          '" aria-label="跳到 ' + esc(g.key) + '">' +
          '<span class="group-index-name">' + esc(g.key) + "</span>" +
          '<span class="group-index-num">' + g.authors.length + " 位</span></button>";
      }).join("") +
      "</div></section>";
  }

  function bindIndexCard(listEl) {
    Array.prototype.slice.call(listEl.querySelectorAll("[data-index-group]")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var name = btn.getAttribute("data-index-group");
        var hit = null;
        Array.prototype.slice.call(listEl.querySelectorAll(".group-card")).forEach(function (c) {
          if (!hit && c.getAttribute("data-group") === name) hit = c;
        });
        if (!hit) return;
        try { hit.scrollIntoView({ block: "start", behavior: "smooth" }); }
        catch (e) { hit.scrollIntoView(true); }
        hit.classList.add("flash");
        setTimeout(function () { hit.classList.remove("flash"); }, 1200);
      });
    });
  }

  /* ---------------------------------------------------------------- 二级：该作者的作品 */

  var api = null;
  var currentAuthor = "";

  function worksMount() { return document.getElementById("authors-works"); }

  function showIndex() {
    currentAuthor = "";
    var idx = document.getElementById("authors-index");
    var works = worksMount();
    if (works) works.hidden = true;
    if (idx) idx.hidden = false;
    if (window.ReaderEngine && window.ReaderEngine.current &&
        window.ReaderEngine.current.isOpen()) {
      window.ReaderEngine.current.hideReader();
    }
    if (window.ReaderEngine && window.ReaderEngine.unmount) {
      window.ReaderEngine.unmount(worksMount());
      window.ReaderEngine.current = null;
    }
    api = null;
    paintBack();
    window.scrollTo(0, 0);
  }

  function openAuthor(name) {
    var data = buildIndex();
    var a = data.byAuthor[name];
    if (!a || !a.works.length) return;
    if (!window.ReaderEngine) return;

    currentAuthor = name;
    var idx = document.getElementById("authors-index");
    var works = worksMount();
    if (idx) idx.hidden = true;
    if (works) works.hidden = false;

    if (window.ReaderEngine.unmount) {
      window.ReaderEngine.unmount(worksMount());
      window.ReaderEngine.current = null;
    }

    var cfg = {
      id: "authors",
      items: a.works.slice(),
      root: "#authors-works",
      reader: "#gw-reader",
      groupOrder: [],
      allowEmpty: true,
      pageTitle: name,
      pageSub: a.dynasty + " · 共 " + a.works.length + " 篇",
      extraFields: ["text", "translation", "bookName"],
      noTranslationBooks: ["changshi", "mingshu", "mingren", "mingren-waiguo", "dwang", "dwang-waiguo"],
      words: {
        list: "作品",
        unit: "篇",
        loadingFailed: "作品列表加载失败",
        empty: "这位作者暂无作品",
        matchGroup: "",
        backToList: "返回" + name,
        countInvalid: "作品列表加载失败",
        readStore: "",
        playerTitle: name + " · 朗读",
        searchPlaceholder: "搜索篇名 / 出处"
      }
    };

    api = window.ReaderEngine.mount(cfg);
    if (!api) return;

    paintHeader();
    paintBack();
    window.scrollTo(0, 0);
  }

  function paintHeader() {
    var C = window.SiteChrome;
    if (!C) return;
    if (!currentAuthor) { C.setPage("作者索引"); C.setSub("按朝代读遍历代作者"); return; }
    var a = buildIndex().byAuthor[currentAuthor];
    C.setPage(currentAuthor);
    C.setSub((a && a.dynasty) || "");
  }

  function paintBack() {
    var C = window.SiteChrome;
    if (!C || !C.setPageAction) return;
    if (!currentAuthor) { C.setPageAction(null); return; }
    C.setPageAction({
      label: "返回作者索引",
      onclick: function () { showIndex(); renderIndex(); }
    });
  }

  /* ---------------------------------------------------------------- 装配 */

  function boot() {
    var listEl = document.getElementById("authors-list");
    if (!listEl) return;

    renderIndex();
    paintHeader();
    paintBack();

    var input = document.getElementById("authors-search");
    if (input) {
      input.addEventListener("input", function () {
        renderIndex();
        syncHero();
      });
      input.addEventListener("focus", syncHero);
      input.addEventListener("blur", function () { setTimeout(syncHero, 40); });
    }

    listEl.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest("[data-author]") : null;
      if (!btn) return;
      openAuthor(btn.getAttribute("data-author"));
    });

    /* 从作者作品列表返回：阅读器关掉、退回索引一层。 */
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (!currentAuthor) return;
      if (window.ReaderEngine && window.ReaderEngine.current &&
          window.ReaderEngine.current.isOpen()) return;
      showIndex();
      renderIndex();
    });

    window.addEventListener("popstate", function () {
      if (!currentAuthor) return;
      if (window.ReaderEngine && window.ReaderEngine.current &&
          window.ReaderEngine.current.isOpen()) return;
      showIndex();
      renderIndex();
    });

    syncHero();
  }

  function syncHero() {
    var wrap = document.querySelector("#authors-index .toolbar");
    if (!wrap) return;
    var input = document.getElementById("authors-search");
    var on = !!input && (document.activeElement === input || String(input.value || "").trim());
    wrap.classList.toggle("search-active", on);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.AuthorsPage = {
    index: buildIndex,
    open: openAuthor,
    close: showIndex
  };
})();
