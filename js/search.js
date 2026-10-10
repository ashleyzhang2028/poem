/* ==========================================================================
   全站搜索页（/search/）
   --------------------------------------------------------------------------
   页面上有**两颗**搜索框，各管各的（Issue #480 第二轮）：

     · `#site-search`（顶上、`search-hero` 里那颗）—— 本文件这一套。输入即出
       候选与结果，结果铺进 `#site-gw-list`。它不借阅读器：搜索页的字面就是
       「输入即出」，用户要的是**马上看到命中**，不是先挂一个列表会话等着。
     · `#gw-search`（下一层「作品」那一行里那颗）—— **阅读器的**，服务
       作者索引的②③两层（点作者 → 他的作品列表 → 详情页）。本文件不碰它。

   `#site-gw-list` 与 `#gw-list` 因此都挂 `data-gw="list"`：前者归本文件，
   后者归阅读器（js/authors.js 持有 `#gw-list` 这个引用）。
   ========================================================================== */
(function () {
  "use strict";

  var SLASH_KEYS = ["/", "／"];

  /* 候选下拉先给一批（`SUGGEST_MAX`），用户滚到底再续下一批
     （`SUGGEST_BATCH`，同宽），滚到没有为止（Issue #539 追问）。

     为什么不是一次铺完：候选框高按 `SUGGEST_ROWS = 5` 定死，超出要滚；
     而「一」「春」这类单字在全站命中 550+ / 1390+ 条（2033 条里），
     一次铺几百行 DOM 是 Issue #370 那笔卡顿账的老路。先铺一批、滚了再续，
     既不挡着「我就想看看第 9 条」的人，又不为没滚到的地方付费。 */
  var SUGGEST_MAX = 8;

  var SUGGEST_BATCH = 8;

  var SUGGEST_ROWS = 5;
  var SUGGEST_ROW_H = 44;

  var KB_MIN = 120;

  var FOCUS_LIFT_DELAY = 250;

  var BLUR_SETTLE_DELAY = 220;

  var SUGGEST_BLUR_DELAY = 180;

  var SUGGEST_EXTEND_GAP = 60;

  var KEYWORD_HOLD_DELAY = 800;

  var SCROLL_HIDE_DELAY = 140;

  var EMPTY_IDLE = "输入篇名、作者或诗句，即可搜遍全部集子";
  var EMPTY_MISS = "没有找到匹配的篇目";

  var hitDocs = {};         /* 当前展出那一段命中：id → 条目（点行时按 id 取回） */
  var suggestIndex = -1;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* 判重后的全站条目。SITE_INDEX 与 WorksIndex 都在启动时定下、此后不动，
     所以这张表算一次就够 —— 原来它每敲一个字重算一遍（5595 条走一遍
     widOf/repOf 两张哈希）。 */
  var allCache = null;
  var allCacheKey = "";

  function allItems() {
    var list = (window.SITE_INDEX || []).filter(function (p) { return !p.isBook; });

    if (!window.WorksIndex) return list;

    var key = list.length + "/" + (window.WORKS_ALL ? window.WORKS_ALL.length : 0);
    if (allCache && allCacheKey === key) return allCache;

    var out = [];
    var slotOf = {};
    list.forEach(function (p) {
      var wid = window.WorksIndex.widOf(p.id);
      var rep = window.WorksIndex.repOf(p.id);
      if (slotOf[wid] === undefined) {
        slotOf[wid] = out.length;
        out.push(p);
        return;
      }

      if (rep === p.id) out[slotOf[wid]] = p;
    });
    allCache = out;
    allCacheKey = key;
    return out;
  }

  function suggestBox() { return document.getElementById("site-search-suggest"); }

  /* ---------------------------------------------------------------
     匹配：**建索引、不建行**

     单字查询（「春」「一」）在 5405 条里能命中两千上下，而搜索页每敲一个
     字都要把这一整批塞给阅读器 —— 阅读器于是建两千行 DOM，真正的命中行
     往往排在一屏之外。删字时把链子往回走一遍，就是同一件事反复做。

     这里换个次序：先在**索引**里筛出命中集（只算不建 DOM），按分数排好，
     截到 SEARCH_MAX 条，再交给阅读器。查询串本身也带缓存，同一条查两次
     不必重扫 —— 删一个字落回刚看过的那串时，命中的就是缓存里那同一批
     对象，一行都不重画。

     只留 SEARCH_MAX 条是按**排名**截的，所以截掉的一定排在展出之后 ——
     原先展出的九条一条不少，只是不再为剩下的两千条白建行。
     --------------------------------------------------------------- */

  var SEARCH_MAX = 100;
  var QUERY_CACHE_MAX = 12;

  /* 一条一项的预折叠字段。大小写只折一次 —— 原来每个字都要对 5405 条
     的正文、译文、释义、注脚各折一遍，单次翻出去一个字就是十兆字符。 */
  function itemFieldsOf(p) {
    return {
      title: String(p.title || "").toLowerCase(),
      author: String(p.author || "").toLowerCase(),
      rest: [p.bookName, p.source, p.selection, p.dynasty, p.gradeGroup, p.authorName].join(" ").toLowerCase(),
      body: [p.text, p.translation, p.meaning, p.gloss].join(" ").toLowerCase()
    };
  }

  var fieldCache = null;
  var fieldCacheKey = "";

  function itemFields() {
    var all = allItems();
    var key = all.length + "/" + allCacheKey;
    if (fieldCache && fieldCacheKey === key) return fieldCache;
    fieldCache = all.map(function (p) {
      var f = itemFieldsOf(p);
      f.p = p;
      return f;
    });
    fieldCacheKey = key;
    return fieldCache;
  }

  /* 分数 = 命中的**最靠前**那一档（4 篇名 / 3 作者 / 2 书目 / 1 正文）。
     顺序照旧：篇名 → 作者 → 其余字段 → 正文。 */
  function scoreOf(f, q) {
    if (f.title.indexOf(q) >= 0) return 4;
    if (f.author.indexOf(q) >= 0) return 3;
    if (f.rest.indexOf(q) >= 0) return 2;
    if (f.body.indexOf(q) >= 0) return 1;
    return 0;
  }

  /* 同分时的第二眼：**课内诗词排前面**（Issue #539）。

     问一个作者名（「王安石」「李白」）时，命中的十几条全落在同一档
     （作者档 = 3）—— 光按分数排，它们谁先谁后是碰运气。原先的同分
     判据只有「篇名短的在前」，于是《梅花》《元日》排在前面，而
     《书湖阴先生壁》被挤到第 10 位，候选下拉只留 8 条（SUGGEST_MAX），
     它就掉出去了 —— 用户看到的正是「搜作者搜不到这首课内诗」。

     课内诗词是这份 App 的初心（见 js/library.js：它单列、排第一），
     按它优先既合情也稳定：同一批同分的篇目里，孩子真正在背的那几首
     先露面。`data/works-index.js` 的 `BOOK_RANK` 早就是这个口径
     （`poems: 0`），这里跟它对齐，不另立一套。 */
  function bookRankOf(p) { return p && p.book === "poems" ? 0 : 1; }

  var queryCache = {};
  var queryOrder = [];

  function queryResult(q) {
    if (queryCache[q]) return queryCache[q];
    var out = [];
    var fs = itemFields();
    for (var i = 0; i < fs.length; i++) {
      var sc = scoreOf(fs[i], q);
      if (sc > 0) out.push({ f: fs[i], sc: sc });
    }
    out.sort(function (a, b) {
      if (a.sc !== b.sc) return b.sc - a.sc;
      var ra = bookRankOf(a.f.p);
      var rb = bookRankOf(b.f.p);
      if (ra !== rb) return ra - rb;
      var la = String(a.f.p.title).length;
      var lb = String(b.f.p.title).length;
      if (la !== lb) return la - lb;
      return 0;
    });
    var items = out.map(function (r) {
      var p = r.f.p;
      if (!p.__hitScore || r.sc > p.__hitScore) { p.__hitScore = r.sc; p.__hitQuery = q; }
      return p;
    });
    queryCache[q] = items;
    queryOrder.push(q);

    if (queryOrder.length > QUERY_CACHE_MAX) delete queryCache[queryOrder.shift()];
    return items;
  }

  /* 交给阅读器展出的部分：按排名截到 SEARCH_MAX。 */
  function hitsOf(q) { return queryResult(q); }

  function renderHits(q) {
    var all = queryResult(q);
    return all.length > SEARCH_MAX ? all.slice(0, SEARCH_MAX) : all;
  }

  /* ---------------------------------------------------------------------------
     命中行：自己铺

     行的长相、已读点、三颗小按钮（报告 / 加背 / 自选）都从 `window.ReaderList`
     借 —— 与集子页同一份构造函数，不另画一套（见 js/reader-core.js 的
     `window.ReaderList`）。差别只有两处，都写在下面：

       · 行上不挂序号（`.item-num`）—— 搜索结果是按排名排的，一排到就露出
         「第 3 条」这种与篇目本身无关的数，读着像在数页码；
       · 不挂 `CFG.noTranslationBooks` 那套「待补」判断 —— 搜索页展出的是
         混着十部集子的条目，一条词条式集子的条目不该挂「待补」。判据这里
         简单摆明：集子自己就没打算给译文的那几部，不算缺。
     --------------------------------------------------------------------------- */

  var NO_TRANS_BOOKS = ["changshi", "mingshu", "mingren", "mingren-waiguo", "dwang", "dwang-waiguo"];

  function canTrans(p) {
    return NO_TRANS_BOOKS.indexOf(p.book) < 0;
  }

  function itemHtml(p, R) {
    var read = R.isRead(p.id);
    var pending = !p.text || (!p.translation && canTrans(p));
    var authorTag = p.author || "";
    if (p.authorName && p.authorName !== p.author) {
      authorTag = p.author + "（" + p.authorName + "）";
    }

    var excerpt = p.excerpt != null && String(p.excerpt) !== ""
      ? String(p.excerpt)
      : (p.text ? String(p.text).replace(/\n/g, "").slice(0, 16) + "…" : "");

    return '<div class="item' + (read ? " done" : "") + (pending ? " pending" : "") + '"' +
      ' data-id="' + R.esc(p.id) + '">' +
      '<div class="item-main">' +
      '<h3 class="item-title">' + R.esc(p.title) +
      (read ? '<span class="item-reason read">已读</span>' : "") +
      (pending ? '<span class="item-reason pending">待补</span>' : "") +
      "</h3>" +
      '<div class="item-meta">' +
      (p.dynasty ? "<span>" + R.esc(p.dynasty) + "</span>" : "") +
      (authorTag ? (p.dynasty ? "<span>·</span>" : "") + "<span>" + R.esc(authorTag) + "</span>" : "") +
      (p.bookName ? (p.dynasty || authorTag ? "<span>·</span>" : "") +
        "<span><em>" + R.esc(p.bookName) + "</em></span>" : "") +
      (excerpt ? "<span>·</span><span>" + R.esc(excerpt) + "</span>" : "") +
      "</div></div>" +
      '<div class="item-actions">' +
      R.reportBtn(p) + R.dailyBtn(p) + R.reciteBtn(p) +
      '<button type="button" class="item-read" title="播放这一篇" aria-label="播放 ' + R.esc(p.title) + '">' +
      R.playGlyph() + "</button>" +
      "</div>" +
      '<div class="item-arrow">' + R.arrowGlyph() + "</div>" +
      "</div>";
  }

  function paintHits(q) {
    var listEl = document.querySelector("#site-gw-list");
    if (!listEl) return;

    var R = window.ReaderList;
    hitDocs = {};

    if (!q) {
      listEl.innerHTML = "";
      return;
    }
    if (!R) {
      listEl.innerHTML = '<div class="empty">' + esc(EMPTY_MISS) + "</div>";
      return;
    }

    var list = renderHits(q);
    if (!list.length) {
      listEl.innerHTML = '<div class="empty">' + esc(EMPTY_MISS) + "</div>";
      return;
    }
    list.forEach(function (p) { hitDocs[p.id] = p; });
    listEl.innerHTML = list.map(function (p) { return itemHtml(p, R); }).join("");

    /* 点行开读。三颗小按钮自己 `stopPropagation`（与集子页一样），所以
       点到它们不会误开正文。 */
    Array.prototype.slice.call(listEl.querySelectorAll(".item")).forEach(function (el) {
      el.addEventListener("click", function () { openHit(el.dataset.id); });
    });

    var playables = listEl.querySelectorAll(".item-read");
    Array.prototype.slice.call(playables).forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        openHit(b.closest(".item").dataset.id, true);
      });
    });
  }

  /* 点开一条命中。搜索页不借阅读器会话、也不整页跳走 —— 就地叠一层
     阅读器，读完返回，搜索框里的词还在。

     ⚠️ 这里**不自己画阅读器**：那一层（标题 / 正文 / 注音 / 译文 / 朗读 /
     上一篇下一篇）是阅读器引擎的活，几十处状态。搜索页只是「按条开一个
     只装这一条的会话」，`window.ReaderSearch.open(p)` 就是给它留的口子
     （见 js/reader-core.js）。 */
  function openHit(id, play) {
    var p = hitDocs[id];
    if (!p) return;
    var RS = window.ReaderSearch;
    if (!RS) return;
    if (play && typeof RS.play === "function") { RS.play(p); return; }
    RS.open(p, hitDocs);
  }

  /* 已经铺出来的候选条数。``suggestShown ~ kw`` 写在框上
     （`data-kw` / `data-shown`）：换词就从头一批起，滚到底就多给一批。
     数只记在框上，不改 `suggestItems()` 的原意（那是「这个框能给出多少」，
     现在是全量命中，截断交给下面两处）。 */
  function suggestShown(box, kw) {
    if (!box || box.dataset.kw !== kw) return SUGGEST_MAX;
    var n = parseInt(box.dataset.shown, 10);
    return isNaN(n) ? SUGGEST_MAX : Math.max(SUGGEST_MAX, n);
  }

  function suggestItems(kw, limit) {
    var q = String(kw || "").trim().toLowerCase();
    if (!q) return [];
    var cap = limit === undefined ? SUGGEST_MAX : limit;
    return hitsOf(q).slice(0, Math.max(0, cap));
  }

  function suggestMeta(p) {
    var parts = [];
    if (p.dynasty) parts.push(p.dynasty);
    if (p.author) parts.push(p.author);
    var left = parts.length ? esc(parts.join(" · ")) : "";
    if (!p.bookName) return left;
    return left + (left ? " · " : "") + "<em>" + esc(p.bookName) + "</em>";
  }

  function suggestRowHtml(p, i) {
    return '<button type="button" class="suggest-item" role="option" data-suggest="' + i + '"' +
      ' aria-selected="false">' +
      '<span class="suggest-title">' + esc(p.title) + "</span>" +
      '<span class="suggest-meta">' + suggestMeta(p) + "</span></button>";
  }

  function fillSuggest(box, list, reset) {
    var html = list.map(suggestRowHtml).join("");
    if (reset) box.innerHTML = html;
    else box.insertAdjacentHTML("beforeend", html);
    box.dataset.items = JSON.stringify(list.map(function (p) { return p.id; }));
    box.dataset.shown = String(list.length);
  }

  function renderSuggest(kw) {
    var box = suggestBox();
    if (!box) return;
    var list = suggestItems(kw, SUGGEST_MAX);
    suggestIndex = -1;
    if (!list.length) {
      box.hidden = true;
      box.innerHTML = "";
      box.dataset.items = "";
      box.dataset.kw = "";
      box.dataset.shown = "";
      setExpanded(false);
      return;
    }
    box.dataset.kw = kw;
    fillSuggest(box, list, true);

    box.scrollTop = 0;
    box.hidden = false;
    setExpanded(true);
  }

  /* 滚到底（差一行以内）就续下一批。没有下一批了就不再动 —— 全量命中的
     条数按下标数（`dataset.items` 就是全量 id 表），滚到底自然停住。 */
  function extendSuggest() {
    var box = suggestBox();
    if (!box || box.hidden) return false;
    var kw = box.dataset.kw || "";
    var shown = suggestShown(box, kw);
    var total = suggestItems(kw, Infinity).length;
    if (shown >= total) return false;

    var list = suggestItems(kw, shown + SUGGEST_BATCH);
    if (list.length <= shown) return false;
    fillSuggest(box, list, false);
    return true;
  }

  /* 只在「快到底」时续：`scrollHeight - scrollTop - clientHeight` 留一行余量。 */
  function nearSuggestBottom(box) {
    return box.scrollHeight - box.scrollTop - box.clientHeight <= SUGGEST_ROW_H;
  }

  function setExpanded(on) {
    var input = document.getElementById("site-search");
    if (input) input.setAttribute("aria-expanded", on ? "true" : "false");
  }

  function hideSuggest() {
    var box = suggestBox();
    if (!box) return;
    box.hidden = true;
    suggestIndex = -1;
    setExpanded(false);
  }

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

  function pickSuggest(i) {
    var ids = suggestIds();
    if (i < 0 || i >= ids.length) return false;
    noteSearchAction();
    /* 选一条候选 = 点开那一条（与点行同一个动作）。 */
    openHit(ids[i]);
    hideSuggest();
    return true;
  }

  var kdTimer = 0;
  var kdPending = null;

  function storage() { return window.Storage || null; }

  function readKeyword() {
    var st = storage();
    if (!st || !st.getSearchKeyword) return "";
    try { return String(st.getSearchKeyword() || ""); } catch (e) { return ""; }
  }

  function writeKeyword(kw) {
    var st = storage();
    if (!st || !st.setSearchKeyword) return;
    try { st.setSearchKeyword(String(kw == null ? "" : kw)); } catch (e) {  }
  }

  function noteKeyword(kw) {
    kdPending = String(kw == null ? "" : kw);
    clearTimeout(kdTimer);
    kdTimer = setTimeout(function () {
      kdTimer = 0;
      var v = kdPending;
      kdPending = null;
      writeKeyword(v);
    }, KEYWORD_HOLD_DELAY);
  }

  function onLiftLost() {
    if (kdPending === null) return;
    var v = kdPending;
    kdPending = null;
    clearTimeout(kdTimer);
    kdTimer = 0;
    writeKeyword(v);
  }

  function renderBody() {
    var input = document.getElementById("site-search");
    var kw = input ? input.value : "";
    var q = String(kw == null ? "" : kw).trim();

    syncHeroState();
    paintHits(q);
    annotateMatches(q);
    syncEmptyState(q);

    noteKeyword(q);
  }

  function syncEmptyState(q) {
    var listEl = document.querySelector("#site-gw-list");
    if (!listEl) return;
    var empty = listEl.querySelector(".empty");
    if (!empty) return;

    empty.textContent = q ? EMPTY_MISS : "";

    alignEmptyState(true);
    syncEmptySpacer(empty, !!q);
  }

  function syncEmptySpacer(empty, q) {
    if (!empty || !empty.dataset) return;
    empty.dataset.empty = q ? "miss" : "idle";
  }

  function annotateMatches(kw) {
    var q = String(kw || "").trim();
    var listEl = document.querySelector("#site-gw-list");
    if (!listEl || !q) return;
    /* 每行一份、只建一次 —— 原来在 forEach 里 each 各扫一遍全表
       找同一条（每页两三千次 × 5405）。 */
    var slots = document.querySelectorAll("#site-gw-list .item");
    var byIdMap = {};
    var hits = hitSet(q);
    hits.forEach(function (p) { byIdMap[p.id] = p; });
    Array.prototype.slice.call(slots).forEach(function (el) {
      var p = byIdMap[el.dataset.id];
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

  /* 命中集：按查询串取一趟（带缓存）。 */
  function hitSet(q) { return q ? queryResult(q) : []; }

  function keyboardSpace() {
    var vv = window.visualViewport;
    if (!vv) return 0;
    var layoutH = window.innerHeight || vv.height;
    var space = layoutH - vv.height - (vv.offsetTop || 0);
    return space > KB_MIN ? Math.round(space) : 0;
  }

  function keyboardVisible() {
    var vv = window.visualViewport;
    if (!vv || !vv.height) return 0;
    return Math.round(vv.height);
  }

  function heroEl() { return document.getElementById("search-hero"); }

  function hasKeyword() {
    var input = document.getElementById("site-search");
    return !!input && !!String(input.value || "").trim();
  }

  var searchedThisVisit = false;

  function noteSearchAction() {
    if (searchedThisVisit) return;
    searchedThisVisit = true;
    syncHeroState();
  }

  function syncHeroState() {
    var hero = heroEl();
    if (!hero) return;
    var input = document.getElementById("site-search");
    var focused = !!input && document.activeElement === input;
    var space = keyboardSpace();

    /* 搜索框里有没有字 —— 挂在 `<html>` 上给 CSS 用（入口条收放的判据）。
       比 `.search-active` / `.kb-open` 都靠得住：那两个认的是「来过 / 键盘
       抬起来了」，而这里认的是用户此刻手里真有的东西。 */
    try {
      var html = document.documentElement;
      if (input && String(input.value || "").trim()) html.setAttribute("data-searching", "1");
      else html.removeAttribute("data-searching");
    } catch (e) {  }

    var lifted = focused || space > 0 || searchedThisVisit;
    setLift(lifted, onLiftLost);
    try {
      hero.classList.toggle("search-active", lifted);
      hero.classList.toggle("kb-open", lifted);
    } catch (e) {  }

    hero.style.setProperty("--kb-space", space + "px");
    var visible = keyboardVisible();
    var box = suggestBox();
    if (visible > 0) {
      hero.style.setProperty("--kb-visible", visible + "px");
      if (box) box.style.setProperty("--kb-visible", visible + "px");
    }
    if (box) box.style.setProperty("--kb-space", space + "px");

    hero.style.setProperty("--suggest-rows", String(SUGGEST_ROWS));
    hero.style.setProperty("--suggest-row-h", SUGGEST_ROW_H + "px");
    if (box) {
      box.style.setProperty("--suggest-rows", String(SUGGEST_ROWS));
      box.style.setProperty("--suggest-row-h", SUGGEST_ROW_H + "px");
    }

    alignEmptyState(lifted);
  }

  function alignEmptyState(on) {
    var empty = document.querySelector("#gw-list .empty");
    if (!empty) return;
    try { empty.classList.toggle("search-empty", on); } catch (e) {  }
  }

  var lift = { on: false, cb: null };
  function setLift(on, cb) {
    var changed = lift.on !== !!on;
    lift.on = !!on;
    if (cb) lift.cb = cb;
    if (changed && !lift.on && lift.cb) lift.cb();
  }

  function bindLightFocus() {
    var input = document.getElementById("site-search");
    if (!input) return;

    input.addEventListener("pointerdown", function () {
      setLift(true);
      syncHeroState();
      setTimeout(syncHeroState, 0);
    });
  }

  function bindSlashKey() {
    document.addEventListener("keydown", function (e) {
      if (SLASH_KEYS.indexOf(e.key) < 0) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.defaultPrevented) return;
      var input = document.getElementById("site-search");
      if (!input) return;
      var t = e.target;
      if (t === input) return;
      var tag = t && t.tagName ? String(t.tagName).toLowerCase() : "";
      var typing = tag === "input" || tag === "textarea" || tag === "select" ||
        (t && t.isContentEditable);
      if (typing) return;
      e.preventDefault();
      try { input.focus({ preventScroll: true }); } catch (err) {  }
      setLift(true);
      syncHeroState();
    });
  }

  function bindKeyboardWatchers() {
    var input = document.getElementById("site-search");
    var hero = heroEl();
    if (hero && input) {
      input.addEventListener("focus", function () {
        hero.classList.add("search-active");
        syncHeroState();

        setTimeout(function () {
          if (document.activeElement === input || hero.classList.contains("kb-open")) {
            hero.classList.add("kb-open");
            syncHeroState();
          }
        }, FOCUS_LIFT_DELAY);
      });
      input.addEventListener("blur", function () {

        setTimeout(function () {
          if (document.activeElement === input) return;
          if (keyboardSpace() === 0) hero.classList.remove("kb-open");

          syncHeroState();
        }, BLUR_SETTLE_DELAY);
      });
    }

    var vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", syncHeroState);
      vv.addEventListener("scroll", syncHeroState);
    }
    window.addEventListener("resize", syncHeroState);
    window.addEventListener("orientationchange", function () {

      setTimeout(syncHeroState, 300);
    });
  }

  function boot() {
    var all = allItems();
    var listEl = document.querySelector("#site-gw-list");
    if (!all.length) {
      if (listEl) listEl.innerHTML = '<div class="empty">全站篇目索引加载失败</div>';
      return;
    }

    var input = document.getElementById("site-search");

    if (input) {
      var last = readKeyword();
      if (last) input.value = last;
    }
    if (input) {
      input.addEventListener("input", function () {

        noteSearchAction();
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

        setTimeout(hideSuggest, SUGGEST_BLUR_DELAY);
      });
    }

    bindKeyboardWatchers();
    bindLightFocus();
    bindSlashKey();

    var box = suggestBox();
    if (box) {
      box.addEventListener("mousedown", function (e) {

        var btn = e.target.closest ? e.target.closest("[data-suggest]") : null;
        if (!btn) return;
        e.preventDefault();
        pickSuggest(parseInt(btn.getAttribute("data-suggest"), 10));
      });
    }

    bindSuggestDismiss();
    bindSuggestScroll();

    window.addEventListener("pagehide", onLiftLost);

    renderBody();
    syncHeroState();
  }

  /* 候选框自己滚到底 → 续下一批。监听挂在框上（不是文档），只在框真
     在滚的时候触发；滚轮/touch 走 passive，交给浏览器合成滚动，不拦手感。 */
  function bindSuggestScroll() {
    var box = suggestBox();
    if (!box) return;
    var timer = 0;
    box.addEventListener("scroll", function () {
      if (!nearSuggestBottom(box)) return;
      clearTimeout(timer);
      timer = setTimeout(extendSuggest, SUGGEST_EXTEND_GAP);
    }, { passive: true });
  }

  function bindSuggestDismiss() {
    var listEl = document.querySelector("#site-gw-list");
    if (listEl) {
      var timer = 0;
      listEl.addEventListener("scroll", function () {
        var box = suggestBox();
        if (!box || box.hidden) return;
        clearTimeout(timer);
        timer = setTimeout(hideSuggest, SCROLL_HIDE_DELAY);
      }, { passive: true });

      listEl.addEventListener("click", function (e) {
        var box = suggestBox();
        if (!box || box.hidden) return;

        var t = e.target;
        if (t && t.closest && t.closest(".item-daily, .item-recite, .item-read")) return;
        hideSuggest();
        e.stopPropagation();
        e.preventDefault();
      }, true);
    }
    bindBlankTapDismiss();
  }

  function bindBlankTapDismiss() {
    function onTap(e) {
      var box = suggestBox();
      if (!box || box.hidden) return;
      var wrap = document.getElementById("site-search-wrap");
      var t = e.target;

      if (wrap && t && (t === wrap || wrap.contains(t))) return;

      if (t && t.closest && t.closest("#site-search-suggest")) return;
      hideSuggest();
    }
    document.addEventListener("mousedown", onTap, true);
    document.addEventListener("touchstart", onTap, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.SiteSearch = {
    items: function () { return allItems(); },
    suggest: function (kw, limit) { return suggestItems(kw, limit); },

    keyword: function () {
      var input = document.getElementById("site-search");
      return input ? input.value : "";
    },

    storedKeyword: function () { return readKeyword(); }
  };
})();
