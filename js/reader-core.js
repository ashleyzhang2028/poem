(function () {
  "use strict";

  var DEFAULT_WORDS = {
    list: "小古文",
    unit: "篇",
    loadingFailed: "小古文数据加载失败",
    empty: "没有匹配的小古文",
    filterAll: "全部",
    filterUnread: "未读",
    matchGroup: "课外必背",
    filterGroup: "",
    filterGroupLabel: "",
    countInvalid: "数据加载失败",
    noReadable: "没有可朗读的篇目",
    backToList: "返回列表",
    readStoreLabel: "已读",

    pendingText: "本篇原文尚在整理中",
    pendingTranslation: "本篇白话译文尚在整理中",
    playerTitle: "",
    randomRead: "随机连读",
    searchPlaceholder: "搜索篇名 / 出处 / 作者",
    version: "",
    readStore: "poem_classic_read_v1",
    appName: "跬步",

    recite: "加入背诵",
    reciteAdd: "加入自选集合",
    reciteIn: "已在背诵",
    reciteRemove: "移出背诵"
  };

  var canonicalById = null;

  function canonicalMap() {
    if (canonicalById) return canonicalById;
    var list = (typeof window !== "undefined" && window.CANONICAL_TEXTS) || [];

    if (!list.length) return {};
    canonicalById = {};
    list.forEach(function (r) { if (r && r.id) canonicalById[r.id] = r; });
    return canonicalById;
  }

  function canonicalRuleFor(p, bookId) {
    var map = canonicalMap();
    var hit = map[p.id];
    if (hit) return hit;

    var book = bookId || (CFG && CFG.id) || "";
    if (book) {
      hit = map[book + "-" + p.id];
      if (hit) return hit;
    }
    return null;
  }

  // 带 textRef 的条目**一律以主表为准**，哪怕数据文件里还内联着正文。
  // 两处各存一份就是两个真相：换正文 / 换译文时改一处忘一处，表现是「同一部
  // 作品在两个页面上读到两种白话」。同一判据在 data/text-master.js 的
  // masterTextOf 里 —— 那边是生成物，两处由 scripts/build-text-master.js 对齐。
  function withMasterText(p, bookId) {
    if (!p || !p.textRef) return p;
    var book = bookId || (CFG && CFG.id) || "";
    if (typeof window !== "undefined" && typeof window.masterTextOf === "function") {
      return window.masterTextOf(p, book);
    }
    return p;
  }

  function canonicalOf(p, bookId) {
    if (!p || !p.id) return p;

    p = withMasterText(p, bookId);
    var rule = canonicalRuleFor(p, bookId);
    var book = bookId || (CFG && CFG.id) || "";
    if (!rule || !rule.of || rule.of === p.id || rule.of === book + "-" + p.id) return p;
    var byIdx = (typeof window !== "undefined" && window.SITE_INDEX) || null;

    var fromEntry = null;

    var keys = [rule.ofEntry, rule.of, "poems-" + rule.of];
    if (byIdx) {
      for (var k = 0; k < keys.length && !fromEntry; k++) {
        for (var i = 0; i < byIdx.length; i++) {
          if (byIdx[i].id === keys[k]) { fromEntry = byIdx[i]; break; }
        }
      }
    }

    if (!fromEntry && typeof window !== "undefined") {
      var course = window.POEMS_ALL || [];
      for (var c = 0; c < course.length && !fromEntry; c++) {
        if (course[c].id === rule.of || course[c].id === rule.ofEntry ||
            ("poems-" + course[c].id) === rule.ofEntry) fromEntry = course[c];
      }
    }
    if (!fromEntry) {

      var hits = items.filter(function (x) { return x.id === rule.of; });
      fromEntry = hits.length ? hits[0] : null;
    }
    if (!fromEntry) return p;
    return {
      id: p.id,
      title: p.title,
      author: p.author || "",
      authorName: p.authorName || "",
      dynasty: p.dynasty || "",
      source: p.source || "",
      selection: p.selection || "",
      excerpt: p.excerpt,
      grade: p.grade,
      term: p.term,
      gradeGroup: p.gradeGroup || "",
      translationSource: p.translationSource,
      text: rule.text === true ? (fromEntry.text || "") : (p.text || ""),
      translation: rule.translation === true ? (fromEntry.translation || "") : (p.translation || "")
    };
  }

  var FONT_KEY = "poem_classic_font_v1";

  var PLAY_KEY = (typeof window !== "undefined" && window.PlayModes && window.PlayModes.KEY) ||
    "poem_play_mode_v1";
  var DEFAULT_PLAY_MODE = (typeof window !== "undefined" && window.PlayModes &&
    window.PlayModes.DEFAULT) || "seq-origin";
  var ALIGN_KEY = "poem_classic_align_v1";
  var PINYIN_KEY = "poem_helper_pinyin_v1";
  var SETTINGS_KEY = "poem_recite_settings_v1";

  function $(sel, base) {
    if (base) return base.querySelector(sel);
    var hit = root && root.querySelector(sel);
    if (hit) return hit;
    hit = box && box.querySelector(sel);
    if (hit) return hit;
    return document.querySelector(sel);
  }
  function $$(sel, base) {
    if (base) return Array.prototype.slice.call(base.querySelectorAll(sel));
    var hit = root ? Array.prototype.slice.call(root.querySelectorAll(sel)) : [];
    if (box) {
      Array.prototype.slice.call(box.querySelectorAll(sel)).forEach(function (el) {
        if (hit.indexOf(el) === -1) hit.push(el);
      });
    }
    return hit;
  }

  function hasReadStore() {
    return !!(W && W.readStore);
  }

  function $$all(sel) {
    return Array.prototype.slice.call(document.querySelectorAll(sel));
  }

  function liveTo(s) {
    live = s;
    root = s.root;
    box = s.box;
    CFG = s.cfg;
    W = s.words;
    items = s.items;
    itemsById = s.byId;
    current = s.current;
    keyword = s.keyword;
    filter = s.filter;
    autoReading = s.autoReading;
    playModeId = s.playMode;
    speakingTarget = s.speakingTarget;
  }

  function stash(s) {
    if (!s) return;
    s.current = current;
    s.keyword = keyword;
    s.filter = filter;
    s.autoReading = autoReading;
    s.playMode = playModeId;
    s.speakingTarget = speakingTarget;
  }

  function sessionOf(node) {
    var el = node && node.nodeType === 1 ? node : (node && node.parentElement);
    while (el) {
      for (var i = 0; i < mounts.length; i++) {
        if (el === mounts[i].root || el === mounts[i].box) return mounts[i];
      }
      el = el.parentElement;
    }
    return live;
  }

  function enterLive() { if (live) liveTo(live); }

  const FONT_SIZES = [9, 11, 13, 15, 17, 19, 21, 23, 25];
  const FONT_MIN = 9;
  const FONT_MAX = 25;
  const DEFAULT_FONT = 17;

  const ALIGNS = ["left", "center"];
  const DEFAULT_ALIGN = "center";

  const PINYIN_MODES = ["off", "rare", "all"];
  const DEFAULT_PINYIN_MODE = "rare";

  function helperOn() {
    if (typeof window !== "undefined" && window.ProgressStore &&
        typeof window.ProgressStore.helper === "function") {
      return window.ProgressStore.helper() !== "off";
    }
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}").helper !== "off";
    } catch (e) {
      return true;
    }
  }

  function effectivePinyinMode() {
    if (!helperOn()) return "off";
    const v = localStorage.getItem(PINYIN_KEY);

    if (PINYIN_MODES.indexOf(v) > -1) return v;
    return DEFAULT_PINYIN_MODE;
  }

  const APP_NAME = "跬步";

  let live = null;
  let box = null;
  let root = null;
  let CFG = null;
  let W = null;
  let items = [];
  let itemsById = {};
  let current = null;
  let keyword = "";
  let filter = "all";
  let autoReading = false;

  let playModeId = DEFAULT_PLAY_MODE;

  let speakingTarget = "原文";

  function pinyinMode() {
    return effectivePinyinMode();
  }

  function setPinyinMode(mode) {
    const m = PINYIN_MODES.indexOf(mode) > -1 ? mode : "off";
    localStorage.setItem(PINYIN_KEY, m);

    setHelperOn(m !== "off");
  }

  function setHelperOn(on) {
    if (typeof window !== "undefined" && window.ProgressStore &&
        typeof window.ProgressStore.setHelper === "function") {
      window.ProgressStore.setHelper(!!on);
      return;
    }
    let cfg = {};
    try {
      cfg = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {};
    } catch (e) {
      cfg = {};
    }
    if (!cfg || typeof cfg !== "object") cfg = {};
    cfg.helper = on ? "on" : "off";
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(cfg));
  }

  function currentUsername() {
    try {
      var cfg = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {};
      return String(cfg.username == null ? "" : cfg.username).trim();
    } catch (e) {
      return "";
    }
  }

  function paintSub() {
    $$all(".brand-sub").forEach(function (sub) { sub.textContent = CFG.pageSub || ""; });
  }

  function applyAppName() {
    var title = CFG.pageTitle || W.list;
    var name = currentUsername();

    document.title = name ? name + " · " + title + " · " + APP_NAME : title + " · " + APP_NAME;
    $$all('meta[name="apple-mobile-web-app-title"]').forEach(function (m) {
      m.setAttribute("content", name ? name + " · " + title : APP_NAME);
    });
    paintSub();

    var onChrome = function () { paintSub(); };
    document.addEventListener("chrome:ready", onChrome);
  }

  function RS() {
    return typeof window !== "undefined" && window.ProgressStore ? window.ProgressStore : null;
  }

  function readMap() {
    var ps = RS();
    if (ps) { try { return ps.readMap(W.readStore) || {}; } catch (e) {  } }
    try {
      var v = JSON.parse(localStorage.getItem(W.readStore) || "{}");
      return v && typeof v === "object" ? v : {};
    } catch (e) {
      return {};
    }
  }

  function isRead(id) {
    return !!readMap()[id];
  }

  function setRead(id, val) {
    var map = readMap();
    if (val) {
      var old = map[id] || {};
      map[id] = { read: true, at: old.at || Date.now(), times: (old.times || 0) + 1 };
    } else {
      delete map[id];
    }
    var ps = RS();
    if (ps && ps.setReadMap) ps.setReadMap(W.readStore, map);
    else localStorage.setItem(W.readStore, JSON.stringify(map));

    markReadSynced();

    window.dispatchEvent(new CustomEvent("reader-read-change", { detail: { store: W.readStore, id: id, read: !!val } }));
  }

  function markReadSynced() {
    var R = typeof window !== "undefined" ? window.ReadSync : null;
    if (!R || typeof R.touch !== "function") return;
    try { R.touch(W.readStore); } catch (e) { return; }
    var S = typeof window !== "undefined" ? window.SyncStore : null;
    if (!S || typeof S.now !== "function") return;
    try { S.now({ pull: false }); } catch (e) {  }
  }

  function onReadChange(e) {
    if (!e.detail || e.detail.store !== W.readStore) return;
    $$('[data-id="' + e.detail.id + '"]', listBox()).forEach(function (el) {
      el.classList.toggle("done", !!e.detail.read);
      var mark = el.querySelector(".item-reason.read");
      if (e.detail.read && !mark) {
        var h = el.querySelector(".item-title");
        if (h) h.insertAdjacentHTML("beforeend", '<span class="item-reason read">' + esc(W.readStoreLabel) + "</span>");
      } else if (!e.detail.read && mark) {
        mark.parentNode.removeChild(mark);
      }
    });
  }

  function allItems() {
    var list = items.slice();
    var order = CFG.groupOrder || [];
    if (!order.length) return list;
    return list.sort(function (a, b) {
      var ia = order.indexOf(a.gradeGroup);
      var ib = order.indexOf(b.gradeGroup);
      var ra = ia === -1 ? order.length : ia;
      var rb = ib === -1 ? order.length : ib;
      if (ra !== rb) return ra - rb;

      return listIndexOf(a) - listIndexOf(b);
    });
  }

  function listIndexOf(p) {
    for (var i = 0; i < items.length; i++) if (items[i].id === p.id) return i;
    return 0;
  }

  function byId(id) {
    return itemsById[id] || null;
  }

  function idIndex(p) {
    var list = allItems();
    for (var i = 0; i < list.length; i++) if (list[i].id === p.id) return i;
    return -1;
  }

  function visibleItems() {
    var kw = keyword.trim().toLowerCase();
    return allItems().filter(function (p) {
      if (W.filterGroup && p.gradeGroup !== W.filterGroup) return false;
      if (filter === "unread" && isRead(p.id)) return false;
      if (!kw) return true;
      return haystack(p).toLowerCase().indexOf(kw) !== -1;
    });
  }

  function haystack(p) {

    return [p.title, p.source, p.selection, p.author, p.authorName, p.dynasty, p.gradeGroup]
      .concat(extraFields(p)).join(" ");
  }

  function extraFields(p) {
    var out = [];
    (CFG.extraFields || []).forEach(function (k) {
      if (p[k]) out.push(String(p[k]));
    });
    return out;
  }


  /* =========================================================================
     正文里的表格 · Issue #347
     -------------------------------------------------------------------------
     详情页的正文是**作者只写文字的纯文本**（`data/text-master.js` 的 `text`），
     所以要画表格，也只能让作者在纯文本里画。这里认两种画法：

       ┌───────┬────────┐    ① 有框表：画了框线的，整块连续的行 = 一张表
       │ 年号  │ 帝王   │       首行是表头；`├ ┤` / `└ ┘` 那两行只作分隔。
       ├───────┼────────┤       表格**只用竖线分列**，没有跨行跨列 ——
       │ 建元  │ 汉武帝 │       框线的横线画在哪里，渲染时都不作数。
       └───────┴────────┘

       建元 ｜ 汉武帝 ｜ 第一   ② 无框对齐表：两列以上、行行竖线数相同，
       元光 ｜ 汉武帝 ｜ 第二   整块连续的行 = 一张表。首行是不是表头，
       元朔 ｜ 汉武帝 ｜ 第三   看它跟下一行之间有没有那条 `─────` 分隔线。

     为什么先切成「字符 → 单元格 → 行」再插 `<ruby>`（注音）：
     全文注音是逐字符插注音，插进表格的格线里就是「一列汉字一列拼音」的乱码。
     所以表格在注音**之前**切成结构，注音只在单元格内部做（`annotate` 回调）。

     认不出来一律**原样输出**：老正文里用 `｜` 分隔的排比句、全篇只出现一两行
     `│` 的正文，都不该被当成表格 —— 宁可排得平一点，不能把正文改坏。
     ========================================================================= */

  function splitCells(line) {
    return line.split("│").slice(1, -1).map(function (s) { return s.trim(); });
  }

  /* 「│ a │ b │」→ ["a","b"]；不是这样一个框行就返回 null */
  /* 「│ 甲 │ 乙 │」→ ["甲","乙"]。**至少要分出两格**才算一个框行 ——
     「│ 一整句话 │」这种一根竖线包住一句话的写法不是表格，只是有人爱那么写。 */
  function boxRow(line) {
    var t = String(line).trim();
    var n = t.length;
    if (n < 3 || t.charAt(0) !== "│" || t.charAt(n - 1) !== "│") return null;
    var cells = splitCells(t);
    return cells.length > 1 ? cells : null;
  }

  /* 框线行（只有 ┌─┬┐ 这一族字符）。连不连续由调用处按整段的框行一起判 */
  function boxRule(line) {
    return /^[┌┬┐├┼┤└┴┘─]+$/.test(String(line).trim());
  }

  /* 无框表的一行：「a ｜ b ｜ c」—— 两列以上，且竖线两侧都得有内容。
     竖线两种写法都认：全角「｜」（中文正文里好打、也好与框线区分）与半角「|」，
     但一张表里只许用同一种，混着写的一行不算数，整段退回纯文本。
     ⚠️ 「一行里有竖线」不等于「这是个表」—— 判表交给 `blockRows`
     （连续两行以上、行行竖线数相同），句中的「一 ｜ 二」因此不会被误判。 */
  function gridRow(line) {
    var t = String(line).trim();
    var full = t.indexOf("｜") >= 0;
    var half = t.indexOf("|") >= 0;
    if (full === half) return null;
    var cells = t.split(full ? "｜" : "|").map(function (s) { return s.trim(); });
    if (cells.length < 2) return null;
    for (var i = 0; i < cells.length; i++) if (!cells[i]) return null;
    return cells;
  }

  /* 一条「────—」分隔线（无框表里用来分表头 / 分节） */
  function gridRule(line) {
    var t = String(line).trim();
    return t.length > 0 && /^[-─—\s]+$/.test(t) && /[-─—]{3,}/.test(t);
  }

  /* 自查：正文里的表格块必须**画得端正** ——
     同一张表里每一行的列数要一致，竖线数不一样的那一行会被整段退回纯文本
     （症状是「表格没生效」，而那种症状肉眼很难第一时间归因到少打一根竖线）。
     开发时 `ReaderEngine.checkCorpus()` 引一声，测试里也拿它守。 */
  function tableIssues(text) {
    var lines = String(text == null ? "" : text).split("\n");
    var bad = [];

    for (var i = 0; i < lines.length; i++) {
      var first = boxRow(lines[i]);
      if (!first) continue;
      var box = [lines[i]];
      var k = i + 1;
      while (k < lines.length && (boxRow(lines[k]) || boxRule(lines[k]))) {
        var row = boxRow(lines[k]);
        if (row && row.length !== first.length) {
          bad.push({ line: k + 1, text: String(lines[k]).trim(), want: first.length });
        }
        box.push(lines[k]);
        k++;
      }
      /* 只有一行框行不成表（页面上会原样显示成一行带竖线的字） */
      if (k === i + 1) bad.push({ line: i + 1, text: String(lines[i]).trim(), want: first.length });
      i = k - 1;
    }

    var S = "｜";
    for (var j = 0; j < lines.length; j++) {
      if (!gridRow(lines[j])) continue;
      var head = cellsOf(lines[j], S);
      var seg = [lines[j]];
      var m = j + 1;
      while (m < lines.length && gridRow(lines[m]) && !rowIsRule(gridRow(lines[m]))) {
        var cells = cellsOf(lines[m], S);
        if (cells.length !== head.length) {
          bad.push({ line: m + 1, text: String(lines[m]).trim(), want: head.length });
        }
        seg.push(lines[m]);
        m++;
      }
      j = m - 1;
    }

    return bad;
  }

  /* 一条「─────」分隔线（无框表里用来分表头 / 分节）。
     写法是「横线 ｜ 横线 ｜ 横线」—— 每格都是横线，格数没写全的那一行
     不算分隔线，会当成普通单元格原样显示（宁可看着怪，也不删用户写的字）。 */
  function gridIsRule(line) {
    var cells = gridRow(line);
    if (rowIsRule(cells)) return true;
    /* 也认整行只有横线、不分格的一种写法 */
    var t = String(line).trim();
    return t.length > 0 && /^[-─—\s]+$/.test(t) && /[-─—]{3,}/.test(t);
  }

  function rowIsRule(cells) {
    if (!cells || cells.length < 2) return false;
    for (var i = 0; i < cells.length; i++) {
      if (!/^[-─—]{2,}$/.test(cells[i])) return false;
    }
    return true;
  }

  function cellsOf(line, glyph) {
    return String(line).trim().split(glyph).map(function (s) { return s.trim(); });
  }

  function cellsHtml(cells, tag, annotate) {
    var out = "";
    for (var i = 0; i < cells.length; i++) {
      out += "<" + tag + ">" + annotate(cells[i]) + "</" + tag + ">";
    }
    return out;
  }

  /* 整段的框行 → 一张表。表头取第一个框行；其余框行只当分隔，不作行 */
  function boxTableHtml(lines, cols, annotate) {
    var head = null;
    var body = "";
    for (var i = 0; i < lines.length; i++) {
      var cells = boxRow(lines[i]);
      if (!cells) continue;
      if (!head) {
        head = "<tr>" + cellsHtml(cells, "th", annotate) + "</tr>";
        cols = cells.length;
        continue;
      }
      body += "<tr>" + cellsHtml(cells, "td", annotate) + "</tr>";
    }
    if (!head) return null;
    return '<div class="rd-scroll"><table class="rd-table"><thead>' + head +
      "</thead><tbody>" + body + "</tbody></table></div>";
  }

  /* 整段的无框行 → 一张表（或「表前小标题 + 表」）。首行之下若是分隔线，
     首行即表头；分隔线只作分节，不渲染成行 */
  function gridHtml(lines, cols, annotate) {
    var parts = [];
    var cur = [];
    lines.forEach(function (line) {
      if (gridRow(line)) { cur.push(line); return; }
      if (cur.length) { parts.push({ table: cur }); cur = []; }
      parts.push({ note: String(line).trim() });
    });
    if (cur.length) parts.push({ table: cur });

    var head = "";
    var body = "";
    var out = "";

    function flush() {
      if (!head && !body) return;
      out += '<div class="rd-scroll"><table class="rd-grid">' +
        (head ? "<thead>" + head + "</thead>" : "") +
        "<tbody>" + body + "</tbody></table></div>";
      head = "";
      body = "";
    }

    parts.forEach(function (part) {
      if (!part.table) { flush(); out += '<p class="rd-grid-note">' + annotate(part.note) + "</p>"; return; }
      var rows = part.table;
      var start = 0;
      if (rows.length >= 2 && rowIsRule(gridRow(rows[1]))) {
        head += "<tr>" + cellsHtml(gridRow(rows[0]), "th", annotate) + "</tr>";
        start = 2;
      }
      for (var k = start; k < rows.length; k++) {
        if (rowIsRule(gridRow(rows[k]))) continue;
        body += "<tr>" + cellsHtml(gridRow(rows[k]), "td", annotate) + "</tr>";
      }
    });

    flush();
    return out;
  }

  /* 正文 → HTML：认得出表格就画表，认不出就按老样子（换行 + 注音 + 转义）。
     `annotate` 是注音回调（把纯文本变成带 `<ruby>` 的 HTML），
     表格里只对**单元格内部**调它，格线不吃注音。 */
  function textToHtml(text, annotate) {
    var src = String(text == null ? "" : text);
    return renderBlocks(src.split("\n"), annotate || esc);
  }

  /* 一张表至少要两行 —— 一行竖线排比句不是表（老正文里这种句子不少）。
     所以「连续两行以上、行行竖线数相同」才算表，否则整段原样输出。
     ⚠️ 表体里**不许出现空行**：空行是「这张表到此为止」的信号。否则
        「谥号 ｜ 评行迹」（孤零零一句）
        「空行」
        「另一句带竖线的话 ｜ 又是一句」
     会被拼成一张两行的表 —— 两句话各占一行、还共用一套列宽，正是老正文里
     最容易被误伤的那种排比句。分开写就是两张表。 */
  function blockRows(lines, i) {
    var need = null;
    var grid = [];
    for (var k = i; k < lines.length; k++) {
      var t = String(lines[k]).trim();
      if (t === "") break;
      if (gridIsRule(lines[k])) { if (!grid.length) break; grid.push(lines[k]); continue; }
      var row = gridRow(lines[k]);
      if (!row) break;
      if (need === null) need = row.length;
      else if (row.length !== need) break;
      grid.push(lines[k]);
    }
    var n = 0;
    grid.forEach(function (l) { if (gridRow(l)) n++; });
    return { lines: grid, cols: need || 0, rows: n };
  }

  function renderBlocks(lines, annotate) {
    var out = "";

    function plain(line) {
      out += line === "" ? "<br>" : annotate(line) + "<br>";
    }

    for (var i = 0; i < lines.length; ) {
      /* 起点可以是框行，也可以是那圈框线的第一笔（┌─┬┐）——
         只有框行才起表，光有框线没有内容行的一整段（罕见）才退回纯文本。 */
      if (boxRow(lines[i]) || boxRule(lines[i])) {
        var box = [];
        var first = null;
        /* 画出来的框线（┌─┬┐ 那一族）**不渲染**：渲染出来的 <table> 自带边框，
           正文里那圈 ASCII 框线再跟着显示，同一张表就有了两道框。
           一段里凡「框行」都收进表、「框线行」都跳过 —— 作者在代码里维护的是
           一张画得像表的 ASCII 稿，读者看到的是真表。 */
        while (i < lines.length) {
          var r = boxRow(lines[i]);
          if (r) { if (!first) first = r; box.push(lines[i]); i++; continue; }
          if (boxRule(lines[i])) { i++; continue; }
          break;
        }
        /* 一行内容的框表**也算表**：作者既然画了框线（┌─┬┐ 那一族），
           意图就是表，一行也照画 —— 这与无框表那条「至少两行」的规则不同：
           无框表靠「连着几行、行行对齐」认，一行认不出来。 */
        if (first) { out += boxTableHtml(box, first.length, annotate); continue; }
        /* 一段里只有框线、一行内容都没有（罕见）：整段跳过，不留一坨框线 */
        continue;
      }

      if (gridRow(lines[i])) {
        var seg = blockRows(lines, i);
        if (seg.rows >= 2) { out += gridHtml(seg.lines, seg.cols, annotate); i += seg.lines.length; continue; }
      }

      plain(lines[i++]);
    }
    return out;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function closeTimeout(t) {
    if (t) clearTimeout(t);
  }

  function playGlyph() {
    return (
      '<span class="play-glyph" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24"><path d="M8.4 6.1 18.3 12 8.4 17.9Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" /></svg>' +
      "</span>" +
      '<span class="pause-glyph" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24"><path d="M8.2 5h2.9v14H8.2Z M12.9 5h2.9v14h-2.9Z" fill="currentColor" stroke="none" /></svg>' +
      "</span>"
    );
  }

  function arrowGlyph() {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M9.8 6.6 15.2 12l-5.4 5.4" /></svg>'
    );
  }

  function playSmGlyph() {
    return (
      '<span class="play-glyph-sm" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24"><path d="M9.4 6.6 18 12 9.4 17.4Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />' +
      "</svg></span>"
    );
  }

  function syncItemPlayBtns() {
    var playing = readingActive();
    $$(".item-read", listBox()).forEach(function (b) {
      b.dataset.on = playing ? "1" : "0";
    });
  }

  function readOne(p, btn) {
    if (!speechReady()) {
      showToast(speechHint());
      return;
    }

    if (readingActive()) {
      autoReading = false;
      window.Speech.stop();
      if (window.ReaderPlayer) window.ReaderPlayer.close();
      showToast("已停止朗读");
    } else {
      const ok = window.Speech.speak(speechText(p));
      showToast(ok ? "开始朗读《" + p.title + "》" : "朗读启动失败，请重试");
    }
    syncAllReadState();
    setTimeout(syncAllReadState, 80);
  }

  function listBox() {
    if (live && live.listEl && live.listEl.isConnected) return live.listEl;

    var el = root && root.classList && root.classList.contains("list") ? root : null;
    if (!el) el = inMount(root, '[data-gw="list"]');
    if (!el && root) el = root.querySelector("#gw-list");
    if (live) live.listEl = el;
    return el;
  }

  function renderList() {
    var listEl = listBox();
    if (!listEl) return;
    var shown = visibleItems();
    var total = allItems().length;
    listEl.innerHTML = "";
    if (!shown.length) {
      listEl.innerHTML = '<div class="empty">' +
        (total ? esc(W.empty) : esc(W.loadingFailed)) + "</div>";
      return;
    }

    var index = 0;
    var groupCard = null;
    var lastGroup = "";
    shown.forEach(function (p) {
      index += 1;

      if (p.gradeGroup && p.gradeGroup !== lastGroup) {
        lastGroup = p.gradeGroup;
        groupCard = document.createElement("section");
        groupCard.className = "group-card";
        groupCard.dataset.group = p.gradeGroup;
        var head = document.createElement("div");

        head.className = "group-head";
        head.innerHTML =
          '<span class="group-name">' + esc(p.gradeGroup) + "</span>" +
          '<span class="group-count">' + allItems().filter(function (x) { return x.gradeGroup === lastGroup; }).length + " " + esc(W.unit) + "</span>" +

          '<button type="button" class="gw-play gw-play-sm" data-random-group="' + esc(p.gradeGroup) + '" data-menu="0"' +
          ">" + playSmGlyph() +
          '<span class="gw-play-input"></span>' +
          '<span class="play-mode" aria-hidden="true"></span>' +
          '<span class="gw-menu" role="menu" hidden></span>' +
          "</button>";
        groupCard.appendChild(head);
        listEl.appendChild(groupCard);
      }

      var read = isRead(p.id);

      var pending = !p.text || (!p.translation && !CFG.noTranslation);
      var el = document.createElement("div");
      el.className = "item" + (read ? " done" : "") + (pending ? " pending" : "") +
        (p.gradeGroup === W.matchGroup ? "" : " in-book");
      el.dataset.id = p.id;
      el.innerHTML =
        '<div class="item-main">' +

        '<h3 class="item-title"><span class="item-num">' + index + "</span>" + esc(p.title) +
        (read && hasReadStore() ? '<span class="item-reason read">' + esc(W.readStoreLabel) + "</span>" : "") +
        (pending ? '<span class="item-reason pending">待补</span>' : "") +
        "</h3>" +

        '<div class="item-meta">' +
        (p.dynasty ? "<span>" + esc(p.dynasty) + "</span>" : "") +
        (p.author ? (p.dynasty ? "<span>·</span>" : "") + "<span>" + esc(p.author) +
          (p.authorName && p.authorName !== p.author ? "（" + esc(p.authorName) + "）" : "") + "</span>" : "") +
        (p.source ? ((p.dynasty || p.author) ? "<span>·</span>" : "") + "<span>" + esc(p.source) + "</span>" : "") +
        (p.selection ? "<span class=\"item-selection\">" + esc(p.selection) + "</span>" : "") +

        (function () {
          var line = p.excerpt != null && String(p.excerpt) !== ""
            ? String(p.excerpt)
            : (p.text ? String(p.text) : "").replace(/\n/g, "").slice(0, 16) + (p.text ? "…" : "");
          return line ? "<span>·</span><span>" + esc(line.replace(/\n/g, "")) + "</span>" : "";
        })() +
        "</div>" +
        "</div>" +

        '<div class="item-actions">' +
        (CFG.reportList === false ? "" : reportItemBtn(p)) +
        (CFG.dailyList === false ? "" : dailyItemBtn(p)) +
        (CFG.reciteList === false ? "" : reciteItemBtn(p)) +
        '<button type="button" class="item-read" title="播放这一篇" aria-label="播放 ' + esc(p.title) + '">' +
        playGlyph() + "</button>" +
        "</div>" +
        '<div class="item-arrow">' + arrowGlyph() + "</div>";
      el.addEventListener("click", function () { openReader(p); });
      var playBtn = el.querySelector(".item-read");
      playBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        readOne(p, playBtn);
      });
      var reciteBtn = el.querySelector(".item-recite");
      if (reciteBtn) {
        reciteBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          claim(e);
          startRecite(p);
        });
      }
      var dailyBtn = el.querySelector(".item-daily");
      if (dailyBtn) {
        dailyBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          claim(e);
          toggleDaily(p);
        });
      }
      var reportBtn = el.querySelector(".item-report");
      if (reportBtn) {
        reportBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          claim(e);
          openReport(p);
        });
      }
      (groupCard || listEl).appendChild(el);
    });

    $$(".group-head .gw-play-sm .gw-menu", listEl).forEach(renderPlayMenu);

    syncItemPlayBtns();
    syncPlayBtn();
    syncListItemReciteButtons();
    syncListItemDailyButtons();
  }

  function highlightItem(id) {
    var el = $(".item[data-id='" + id + "']", listBox());
    if (!el) return;
    el.classList.add("reading");
    if (typeof el.scrollIntoView === "function") {
      try {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      } catch (e) {  }
    }
    // 连读时画面在往下滚，浏览位置跟着走，退出读者态才停在读者最后看到的那一条
    rememberListScroll();
  }

  // 列表滚的是 window（页面本身），窗口滚动量就是浏览位置。
  // ⚠️ 别在这里顺手存 scrollX：地址栏收放那点横向抖动也得算进去的话，
  // 存回来的就是一个跟用户无关的数。
  function listScrollY() {
    if (window.scrollX || window.scrollY) return window.scrollY;
    return (document.scrollingElement && document.scrollingElement.scrollTop) || 0;
  }

  function rememberListScroll() {
    if (!live || !live.items || !live.items.length || readerShown()) return;
    live.listScroll = listScrollY();
  }

  // 打开详情页会把窗口滚到顶，返回时按记下的位置放回去 —— 否则不管从列表
  // 多深点进去，退出来一律回到第一条（Issue #347）。
  // 恢复必须等详情层的布局做完：这里还在 overflow:hidden 的 body 上，
  // 文档自身的高度被压成窗口高，此刻写 scrollTo 会被浏览器当成越界而置 0。
  function restoreListScroll(y) {
    if (!y) return;
    setDoubleRaf(function () {
      if (readerShown()) return;
      window.scrollTo(0, y);
    });
  }

  function clearHighlight() {
    $$(".item.reading", listBox()).forEach(function (el) { el.classList.remove("reading"); });
  }

  function rd(sel) {
    var el = box ? box.querySelector('[data-gw="' + sel + '"]') : null;
    if (el) return el;
    el = root ? root.querySelector('[data-gw="' + sel + '"]') : null;
    return el || document.querySelector('[data-gw="' + sel + '"]');
  }

  function rdAll(sel) {
    var hits = [];
    [box, root, document].forEach(function (base) {
      if (!base) return;
      Array.prototype.slice.call(base.querySelectorAll('[data-gw="' + sel + '"]')).forEach(function (el) {
        if (hits.indexOf(el) === -1) hits.push(el);
      });
    });
    return hits;
  }

  function inMount(elem, sel) {
    if (!elem || !elem.querySelectorAll) return null;
    var hit = elem.querySelectorAll(sel)[0];
    if (hit) return hit;
    var up = elem.parentNode;
    return up && up.querySelectorAll ? up.querySelectorAll(sel)[0] : null;
  }

  function openReader(p) {

    if (p && p.id && itemsById[p.id]) p = itemsById[p.id];
    // 第一次打开才记：连读从一篇换到下一篇时也走这里，跟着记就等于把
    // 读者刚离开的那一条当成浏览位置，返回时落点越来越深。
    if (!readerShown()) rememberListScroll();
    current = p;
    var idx = idIndex(p);
    var el = rd("reader");
    if (!el) return;
    el.querySelector('.rd-title, #rd-title').textContent = p.title;
    var meta = el.querySelector('.rd-meta, #rd-meta');

    var authorTag = p.author || "";
    if (p.authorName && p.authorName !== p.author) {
      authorTag = p.author + "（" + p.authorName + "）";
    }

    meta.innerHTML =
      (p.dynasty ? '<span class="tag ghost">' + esc(p.dynasty) + "</span>" : "") +
      (authorTag ? '<span class="tag ghost">' + esc(authorTag) + "</span>" : "") +
      (p.source ? '<span class="tag">' + esc(p.source) + "</span>" : "") +
      (p.selection ? '<span class="tag ghost">' + esc(p.selection) + "</span>" : "");

    renderReaderText();

    // 语源 / 典故卡（成语页专属）：正文只放原书那一句，编者过去写在正文括注里的
    // 「（佛典）」「（语本元曲）」「（原文作某某）」搬到这里。没有 gloss 的集子整卡不出现。
    var glossBox = rd("gloss");
    var glossEl = rd("gloss-text");
    if (glossBox) {
      var gloss = p.gloss ? String(p.gloss) : "";
      glossBox.hidden = !gloss;
      if (glossEl) glossEl.textContent = gloss;
    }

    // 释义卡（成语页专属）：没有 meaning 的集子整卡不出现，不留空白框
    var meanBox = rd("meaning");
    var meanEl = rd("meaning-text");
    if (meanBox) {
      var mean = p.meaning ? String(p.meaning) : "";
      meanBox.hidden = !mean;
      if (meanEl) meanEl.textContent = mean;
    }

    el.querySelector('.rd-trans-text, #rd-trans-text').textContent = p.translation || W.pendingTranslation;

    // 出处那一行右侧带上这一条的版次：底本一处文字改了，这个号就变。
    // 已加入背诵 / 自选清单的条目在用户本机存着当时的快照，客户端拿这个号与
    // 存下的比一比，就能认出「这一条在上次存下之后改过」——界面不必等用户
    // 哪天翻到旧的一行、读了旧的白话才发现（js/collections.js 的
    // refreshSnapshots / markStale）。
    var srcEl = el.querySelector('.rd-trans-src, #rd-trans-src');
    if (srcEl) {
      var srcText = p.translation && window.translationSourceText
        ? window.translationSourceText(p) : "";
      var ver = window.textVersionOf ? window.textVersionOf(p, CFG && CFG.id) : 0;
      srcEl.textContent = ver ? srcText + " · " + ver : srcText;
    }

    // 词条式集子（文学常识一类）：正文即释义，本来就没有白话译文
    // —— 译文开关藏起来，免得点开是空的
    var transBtn = rd("trans-toggle");
    if (transBtn) transBtn.hidden = !!CFG.noTranslation;

    showTransBox(false);
    speakingTarget = "原文";
    renderNav();
    applyFont();
    applyAlign();
    syncPinyinButton();
    syncReadButtons();
    syncDoneButton();
    syncReciteButtons();
    syncDailyButton();
    syncReportButton();
    el.hidden = false;
    document.body.classList.add("reader-open");

    var back = (typeof CFG.openFrom === "function" && CFG.openFrom()) || null;
    if (!back) back = closeReader;
    if (window.SiteChrome) {
      window.SiteChrome.setHeaderAction({ label: W.backToList, onclick: back });

      paintSub();
    }

    var printBtn = document.querySelector("[data-print-open]");
    if (printBtn) printBtn.setAttribute("data-print-poem", p.id || "");
    // 读者态铺满整屏，底下列表多深都看不见 —— 从正文开头读起才是对的
    window.scrollTo(0, 0);
  }

  function renderNav() {
    if (!current) return;
    const list = allItems();
    const i = idIndex(current);
    const prev = i > 0 ? list[i - 1] : null;
    const next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
    const prevBtn = rd("prev");
    const nextBtn = rd("next");
    if (!prevBtn || !nextBtn) return;
    rd("prev-title").textContent = prev ? prev.title : "已是第一篇";
    rd("next-title").textContent = next ? next.title : "已是最后一篇";

    prevBtn.title = prev ? prev.title : "已是第一篇";
    nextBtn.title = next ? next.title : "已是最后一篇";
    prevBtn.disabled = !prev;
    nextBtn.disabled = !next;
    prevBtn.dataset.target = prev ? prev.id : "";
    nextBtn.dataset.target = next ? next.id : "";
  }

  function goSibling(dir) {
    if (!current) return;
    const list = allItems();
    const i = idIndex(current) + dir;
    if (i < 0 || i >= list.length) return;
    if (window.Speech) window.Speech.stop();
    openReader(list[i]);
  }

  function readerWid(p) {
    var id = p && p.id ? p.id : "";
    if (!id) return "";
    if (window.WorksIndex && typeof window.WorksIndex.widOf === "function") {
      try { return window.WorksIndex.widOf(id) || id; } catch (e) {  }
    }
    return id;
  }

  /* 页面层唯一的「正文 → HTML」入口：表格 + 注音一起做。
     `plain` 为真时只转义不注音（注音关着，但正文里有表格） */
  function pageTextHtml(text, mode, plain) {
    return textToHtml(text, plain ? esc : function (line) {
      return annotateLine(readerWid(current), line, mode);
    });
  }

  /* 一行正文 → HTML。**勘误是按篇（wid）命中**的，所以这里只认 annotatePoem；
     引擎没加载勘误层（老缓存）时退回不带勘误的 annotateHtml，不静默变成不注音。 */
  function annotateLine(wid, line, mode) {
    if (!window.Pinyin) return esc(line);
    return window.Pinyin.annotatePoem
      ? window.Pinyin.annotatePoem(wid, line, mode)
      : window.Pinyin.annotateHtml(line, mode);
  }

  function hasTable(text) {
    var lines = String(text == null ? "" : text).split("\n");
    for (var i = 0; i < lines.length; i++) {
      if (boxRow(lines[i]) || gridRow(lines[i])) return true;
    }
    return false;
  }

  function renderReaderText() {
    if (!current) return;
    var el = rd("text");
    if (!el) return;
    if (!current.text) {
      el.classList.remove("with-pinyin");
      el.textContent = W.pendingText;
      return;
    }
    var mode = pinyinMode();

    /* 正文里有表格（`│` / 框线）时必须走 HTML 那条路 —— 纯文本的 `<pre>` 里
       表格画不出来。判断只做一次、只按正文内容，跟注音开关无关 */
    if (mode !== "off" || hasTable(current.text)) {
      el.innerHTML = pageTextHtml(current.text, mode === "all" ? "all" : "rare", mode === "off");
      el.classList.toggle("with-pinyin", mode !== "off" && !!window.Pinyin);
    } else {
      el.textContent = current.text;
      el.classList.remove("with-pinyin");
    }
  }

  function syncPinyinButton() {
    var seg = rd("reader") && rd("reader").querySelector(".pinyin-seg, #rd-pinyin-seg");
    if (!seg) return;
    const mode = pinyinMode();
    $$("button", seg).forEach(function (b) {
      const on = b.dataset.mode === mode;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    seg.dataset.on = mode === "off" ? "0" : "1";
  }

  function setPinyinModeFromUI(mode) {
    setPinyinMode(mode);
    renderReaderText();
    syncPinyinButton();
    showToast(mode === "off" ? "已隐藏拼音" : mode === "all" ? "已全文注音" : "已只标生字");
  }

  function speechText(p) {
    const head = [p.title, p.dynasty, p.author].filter(Boolean).join("，");
    return head + "。" + p.text;
  }

  function speechSupported() {
    return !!(window.Speech && window.Speech.supported());
  }

  function speechReady() {
    if (!speechSupported()) return false;
    return !!(window.Speech.allowed && window.Speech.allowed().ok);
  }

  function speechHint() {
    if (!speechSupported()) return "当前浏览器不支持语音朗读";
    const a = window.Speech.allowed ? window.Speech.allowed() : { ok: true, hint: "" };

    return a.hint || "登录可用";
  }

  function readingActive() {
    return !!(window.Speech && window.Speech.active && window.Speech.active());
  }

  function handleSpeechStopped() {
    if (window.Speech && window.Speech.active && window.Speech.active()) return;
    autoReading = false;
    clearHighlight();
    syncAllReadState();

    syncPlayBtn();
  }

  function syncAllReadState() {
    syncReadButtons();
    syncTransReadButton();
    syncRandomReadButton();
    syncItemPlayBtns();
  }

  function syncReadButtons() {
    const ok = speechReady();

    const playing = ok && !autoReading && readingActive();

    var btn = rd("read");
    if (btn) {
      btn.disabled = !ok;
      btn.title = ok ? "朗读原文：标题、朝代、作者与正文" : speechHint();
      const on = playing && speakingTarget === "原文";
      btn.dataset.on = on ? "1" : "0";
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }

    syncTransReadButton();
  }

  function toggleRead() {
    if (!current) return;

    if (!speechReady()) {
      showToast(speechHint());
      return;
    }

    autoReading = false;

    if (readingActive() && speakingTarget === "原文") {
      window.Speech.stop();
      showToast("已停止朗读");
    } else {
      speakingTarget = "原文";
      const ok = window.Speech.speak(speechText(current));
      showToast(ok ? "开始朗读" : "朗读启动失败，请重试");
    }
    syncAllReadState();
    setTimeout(syncAllReadState, 60);
    setTimeout(syncAllReadState, 300);
  }

  function toggleTransRead() {
    if (!current) return;
    if (!speechReady()) {
      showToast(speechHint());
      return;
    }
    autoReading = false;

    if (readingActive() && speakingTarget === "译文") {
      window.Speech.stop();
      showToast("已停止朗读");
    } else {
      const t = current.translation || "";
      if (!t) {
        showToast("本篇暂无译文");
        return;
      }
      var tbox = rd("trans");
      if (tbox && tbox.hidden) showTransBox(true);
      speakingTarget = "译文";
      const ok = window.Speech.speak(t);
      showToast(ok ? "开始朗读译文" : "朗读启动失败，请重试");
    }
    syncAllReadState();
    setTimeout(syncAllReadState, 60);
    setTimeout(syncAllReadState, 300);
  }

  function showTransBox(show) {
    var btn = rd("trans-toggle");
    var transBox = rd("trans");
    if (!transBox) return;
    transBox.hidden = !show;
    if (btn) {
      const on = !!show;
      btn.dataset.on = on ? "1" : "0";
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.title = on ? "收起译文" : "显示译文";
      var t = btn && btn.querySelector(".sr-only");
      if (t) t.textContent = on ? "收起译文" : "显示译文";
    }

    if (!show && speakingTarget === "译文") speakingTarget = "原文";
    syncTransReadButton();
  }

  function syncTransReadButton() {
    var btn = rd("trans-read");
    if (!btn) return;
    const ok = speechReady();
    var tbox = rd("trans");
    const boxOpen = !!tbox && !tbox.hidden;
    btn.disabled = !ok;
    btn.title = ok ? "朗读白话译文" : speechHint();

    const on = ok && boxOpen && !autoReading && speakingTarget === "译文" && readingActive();
    btn.dataset.on = on ? "1" : "0";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    var label = btn.querySelector(".trans-read-label");
    if (label) label.textContent = on ? "停止朗读" : "朗读译文";
  }

  function readerShown() {
    var el = box || (root && root.querySelector('[data-gw="reader"]')) ||
      document.querySelector('[data-gw="reader"]');
    return !!el && !el.hidden;
  }

  // 两次 rAF：一次等样式落地，一次等这次重排被浏览器采纳，之后才量得到
  // 去掉 overflow:hidden 之后的真实文档高度。
  function setDoubleRaf(fn) {
    if (typeof window.requestAnimationFrame !== "function") { setTimeout(fn, 0); return; }
    window.requestAnimationFrame(function () { window.requestAnimationFrame(fn); });
  }

  function hideReader() {
    if (window.Speech) window.Speech.stop();
    autoReading = false;
    speakingTarget = "原文";
    var el = rd("reader");
    if (el) el.hidden = true;
    document.body.classList.remove("reader-open");
    current = null;
    renderList();
    syncRandomReadButton();

    if (window.SiteChrome && window.SiteChrome.setHeaderAction) {
      window.SiteChrome.setHeaderAction(null);
    }

    var backTo = live ? live.listScroll : 0;
    if (live) live.listScroll = 0;

    // onHideReader 的返回值管的是「顶栏交给页面自己收」，跟还原滚动位置是
    // 两件事：课外阅读先收顶栏、再由页面自己决定退回书架还是留在集子 ——
    // 留在集子时列表就在原地，位置照样得还（Issue #347）。只有页面明说
    // 这次连列表一起拆（返回 "drop-list"）才跳过，交给下次进列表重来。
    var verdict = typeof CFG.onHideReader === "function" ? CFG.onHideReader() : false;
    var dropped = verdict === "drop-list";
    if (!dropped) restoreListScroll(backTo);
    return verdict !== false && !dropped;
  }

  function closeReader() {

    hideReader();
    paintSub();
  }

  function syncDoneButton() {
    if (!current) return;
    var btn = rd("done");
    if (!btn) return;

    btn.hidden = !hasReadStore();
    if (!hasReadStore()) return;
    const read = isRead(current.id);
    btn.classList.toggle("is-done", read);

    btn.title = read ? "已读，再点一次取消" : "标记为已读";
    btn.setAttribute("aria-pressed", read ? "true" : "false");
    var label = btn.querySelector(".sr-only");
    if (label) label.textContent = read ? "已读，再点一次取消" : "标记为已读";
  }

  var PLAY = (typeof window !== "undefined" && window.PlayModes) || null;
  var PLAY_MODES = PLAY ? PLAY.LIST : [];
  function modeOf(id) {
    if (PLAY) return PLAY.of(id);
    for (var i = 0; i < PLAY_MODES.length; i++) {
      if (PLAY_MODES[i].id === id) return PLAY_MODES[i];
    }
    return null;
  }

  function playMode() {
    return PLAY ? PLAY.read() : DEFAULT_PLAY_MODE;
  }

  function playModeInfo() {
    return modeOf(playModeId) || modeOf(playMode()) || modeOf(DEFAULT_PLAY_MODE);
  }

  function playBtnAria(mode) {
    var m = mode || playModeInfo();

    return m.label + (m.note ? "；" + m.note : "");
  }

  function setPlayMode(id) {
    if (!modeOf(id)) return false;

    if (PLAY) { PLAY.write(id); PLAY.emit(id); } else { localStorage.setItem(PLAY_KEY, id); }
    syncPlayBtn();
    showToast(modeOf(id).label);
    return true;
  }

  function syncPlayBtn() {
    var running = autoReading && !!(window.Speech && window.Speech.active && window.Speech.active());
    var label = playBtnAria();
    var info = playModeInfo();
    headPlayBtns().forEach(function (btn) {
      btn.dataset.on = running ? "1" : "0";
      btn.setAttribute("aria-pressed", running ? "true" : "false");
      btn.title = running ? "停止连读" : label;
      btn.setAttribute("aria-label", running ? "停止连读" : label);
      btn.dataset.mode = info.id;

      btn.dataset.playShort = info.short;
    });

    syncRandomReadButton();
  }

  function headPlayBtns(scope) {
    var el = scope || listBox();
    if (!el) return [];
    return $$(".group-head .gw-play-sm", el);
  }

  function closePlayMenus() {
    $$all(".gw-menu").forEach(function (m) {
      m.hidden = true;
      m.setAttribute("aria-hidden", "true");
      var owner = m.parentNode;
      if (owner && owner.removeAttribute) owner.removeAttribute("data-menu");
    });
  }

  function togglePlayMenu(btn) {
    if (!btn) return;
    var menu = btn.querySelector(".gw-menu");
    if (!menu) return;
    var open = menu.hidden;
    closePlayMenus();
    if (!open) return;

    var cur = playModeInfo().id;
    $$("button", menu).forEach(function (m) {
      var on = m.dataset.mode === cur;
      m.classList.toggle("active", on);
      m.setAttribute("aria-checked", on ? "true" : "false");
    });
    btn.dataset.menu = "1";
    menu.hidden = false;

    menu.setAttribute("aria-hidden", "true");
  }

  function renderPlayMenu(menu) {
    var cur = playModeInfo().id;
    menu.innerHTML = PLAY_MODES.map(function (m) {
      return '<button type="button" role="menuitemradio" class="gw-menu-item' +
        (m.id === cur ? " active" : "") + '" data-mode="' + m.id + '"' +
        ' aria-checked="' + (m.id === cur ? "true" : "false") + '">' +
        '<span class="gw-menu-tick" aria-hidden="true"></span>' +
        '<span class="gw-menu-text">' + esc(m.label) + "</span></button>";
    }).join("");
  }

  function playPool(btn) {

    if (!btn) return visibleItems();
    var group = btn.dataset.randomGroup;

    var shown = visibleItems();
    if (!group) return shown;
    return shown.filter(function (p) { return p.gradeGroup === group; });
  }

  function buildQueue(pool, mode) {
    var self = live;
    var out = [];
    pool.forEach(function (p) {
      var text = mode.source === "译文" ? p.translation : speechText(p);
      if (mode.source === "原文+译文" && p.translation) text = speechText(p) + "。" + p.translation;
      if (!text || !String(text).trim()) return;
      out.push({
        id: p.id,
        title: p.title,
        text: text,
        onStart: function () {
          withSession(self, function () {
            if (!current || current.id !== p.id) openReader(p);
            highlightItem(p.id);
          });
        }
      });
    });
    return mode.order === "shuffle" ? shuffle(out) : out;
  }

  function startPlay(btn) {
    if (!speechReady()) {
      showToast(speechHint());
      return;
    }

    if (autoReading && readingActive()) {
      window.Speech.stop();
      if (window.ReaderPlayer) window.ReaderPlayer.close();
      autoReading = false;
      clearHighlight();
      syncPlayBtn();
      syncItemPlayBtns();
      showToast("已停止连读");
      return;
    }
    var list = buildQueue(playPool(btn), playModeInfo());
    if (!list.length) {

      showToast(btn
        ? "本分类暂无" + (playModeInfo().source === "原文" ? "可读篇目" : "译文可读")
        : W.noReadable);
      return;
    }
    closePlayMenus();
    autoReading = true;
    syncPlayBtn();

    var selfSession = live;
    window.ReaderPlayer.player({
      title: playModeInfo().label,
      mode: playModeInfo().short,
      items: list,
      onIndex: function (i) {
        withSession(selfSession, function () {
          var it = list[i];
          if (!it) return;
          if (!current || current.id !== it.id) openReader(byId(it.id) || current);
          syncPlayBtn();
        });
      },
      onEnd: function () {
        withSession(selfSession, function () {
          autoReading = false;
          clearHighlight();
          syncPlayBtn();
          syncReadButtons();
          syncItemPlayBtns();
        });
      }
    });
  }

  function syncRandomReadButton() {
    var btn = $('[data-gw="random"]') || $("#gw-random-read");
    if (!btn) return;
    const ok = speechReady();
    btn.disabled = !ok;
    const running = autoReading && !!(window.Speech && window.Speech.active && window.Speech.active());
    btn.dataset.on = running ? "1" : "0";

    btn.setAttribute("aria-pressed", running ? "true" : "false");

    btn.title = running ? "停止连读" : (ok ? playBtnAria() : speechHint());
  }

  function shuffle(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function fontIdx() {
    const v = Number(localStorage.getItem(FONT_KEY));
    const i = FONT_SIZES.indexOf(v);
    return i === -1 ? FONT_SIZES.indexOf(DEFAULT_FONT) : i;
  }

  function applyFont() {
    var el = rd("text");
    if (el) el.style.fontSize = FONT_SIZES[fontIdx()] + "px";
  }

  function changeFont(step) {
    let i = fontIdx() + step;
    i = Math.max(0, Math.min(FONT_SIZES.length - 1, i));
    localStorage.setItem(FONT_KEY, String(FONT_SIZES[i]));
    applyFont();
    showToast("字号 " + FONT_SIZES[i] + "px");
  }

  function alignMode() {
    const v = localStorage.getItem(ALIGN_KEY);
    return ALIGNS.indexOf(v) > -1 ? v : DEFAULT_ALIGN;
  }

  function applyAlign() {
    var el = rd("text");
    if (!el) return;
    el.dataset.align = alignMode();
  }

  function syncAlignButtons() {
    const mode = alignMode();
    rdAll("align").forEach(function (b) {
      const on = b.dataset.align === mode;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function setAlign(mode) {
    localStorage.setItem(ALIGN_KEY, ALIGNS.indexOf(mode) > -1 ? mode : DEFAULT_ALIGN);
    applyAlign();
    syncAlignButtons();
    showToast(mode === "left" ? "正文左对齐" : "正文居中对齐");
  }

  function showToast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { t.hidden = true; }, 1600);
  }

  function claim(e) {
    var s = sessionOf(e && (e.currentTarget || e.target));
    if (s && s !== live) liveTo(s);
    return s || live;
  }

  function bindSearch(scope) {
    var list = scope && scope.querySelectorAll
      ? Array.prototype.slice.call(scope.querySelectorAll('[data-gw="search"], #gw-search'))
      : (scope && scope.querySelector ? [scope] : []);
    if (!list.length) {
      var one = $('[data-gw="search"]') || $("#gw-search");
      if (one) list = [one];
    }
    list.forEach(function (el) {
      if (el.dataset && el.dataset.gwSearchBound === "1") return;
      if (el.dataset) el.dataset.gwSearchBound = "1";
      el.addEventListener("input", function (e) {
        var s = claim(e);

        s.keyword = el.value;
        keyword = el.value;
        renderList();
      });
    });
  }

  function bindEvents() {
    bindSearch(document);

    $$all("[data-filter]").forEach(function (b) {
      b.addEventListener("click", function (e) {
        claim(e);
        filter = b.dataset.filter;
        $$all("[data-filter]").forEach(function (x) {
          if (sessionOf(x) !== live) return;
          var on = x === b;
          x.classList.toggle("active", on);
          x.setAttribute("aria-pressed", on ? "true" : "false");
        });
        renderList();
      });
    });

    var listEl = listBox();
    if (listEl) {
      var menuOpenedAt = 0;
      listEl.addEventListener("click", function (e) {
        var target = e.target;
        if (!target || !target.closest) return;
        claim(e);

        var mi = target.closest(".gw-menu-item");
        if (mi) {
          e.stopPropagation();
          setPlayMode(mi.dataset.mode);
          closePlayMenus();
          startPlay(mi.closest(".gw-play-sm"));
          return;
        }
        var gbtn = target.closest("[data-random-group]") || target.closest("[data-play-group]");
        if (!gbtn) {
          closePlayMenus();
          return;
        }
        e.stopPropagation();

        if (Date.now() - menuOpenedAt < 700) return;
        startPlay(gbtn);
      });

      var pressTimer = null;
      var pressFrom = null;
      var openMenuByPress = function (e) {
        var target = e.target;
        if (!target || !target.closest) return;
        var gbtn = target.closest("[data-random-group]") || target.closest("[data-play-group]");
        if (!gbtn) return;
        claim(e);
        closeTimeout(pressTimer);
        pressFrom = { x: e.clientX, y: e.clientY };
        pressTimer = setTimeout(function () {
          menuOpenedAt = Date.now();
          togglePlayMenu(gbtn);
        }, 500);
      };
      var cancelPress = function () { closeTimeout(pressTimer); };
      listEl.addEventListener("pointerdown", openMenuByPress);
      ["pointerup", "pointercancel", "pointerleave", "scroll"].forEach(function (ev) {
        listEl.addEventListener(ev, cancelPress, true);
      });
      listEl.addEventListener("pointermove", function (e) {
        if (!pressFrom) return;
        if (Math.abs(e.clientX - pressFrom.x) > 8 || Math.abs(e.clientY - pressFrom.y) > 8) cancelPress();
      });

      listEl.addEventListener("contextmenu", function (e) {
        var target = e.target;
        if (!target || !target.closest) return;
        var gbtn = target.closest("[data-random-group]") || target.closest("[data-play-group]");
        if (!gbtn) return;
        claim(e);
        e.preventDefault();
        togglePlayMenu(gbtn);
      });
    }

    document.addEventListener("click", function (e) {
      var t = e.target;
      if (t && t.closest && t.closest("#gw-list [data-random-group], #gw-list [data-play-group]")) return;
      if (t && t.closest && t.closest(".gw-menu")) return;
      closePlayMenus();
    });

    var randomBtn = $('[data-gw="random"]') || $("#gw-random-read");
    if (randomBtn) {

      randomBtn.addEventListener("click", function (e) { claim(e); startPlay(null); });
    }

    var prevBtn = rd("prev");
    var nextBtn = rd("next");
    if (prevBtn) prevBtn.addEventListener("click", function (e) { claim(e); goSibling(-1); });
    if (nextBtn) nextBtn.addEventListener("click", function (e) { claim(e); goSibling(1); });

    var doneBtn = rd("done");
    if (doneBtn) doneBtn.addEventListener("click", function (e) {
      claim(e);
      if (!current) return;
      var now = isRead(current.id);
      setRead(current.id, !now);
      syncDoneButton();
      showToast(now ? "已取消「已读」" : "已标记为已读");
    });

    var dailyBtn = rd("daily");
    if (dailyBtn) dailyBtn.addEventListener("click", function (e) {
      if (e && e.preventDefault) e.preventDefault();
      toggleDaily(current);
    });
    var reciteBtn = rd("recite");
    if (reciteBtn) reciteBtn.addEventListener("click", function (e) {
      claim(e);
      if (!current) return;
      startRecite(current);
    });

    var reportBtn = rd("report");
    if (reportBtn) reportBtn.addEventListener("click", function (e) {
      claim(e);
      if (!current) return;
      openReport(current);
    });

    var transToggle = rd("trans-toggle");
    if (transToggle) transToggle.addEventListener("click", function (e) {
      claim(e);
      var show = this.dataset.on !== "1";

      if (!show && speakingTarget === "译文" && readingActive()) window.Speech.stop();
      showTransBox(show);
      syncAllReadState();
    });

    var fontUp = rd("font-up");
    var fontDown = rd("font-down");
    if (fontUp) fontUp.addEventListener("click", function (e) { claim(e); changeFont(1); });
    if (fontDown) fontDown.addEventListener("click", function (e) { claim(e); changeFont(-1); });

    rdAll("align").forEach(function (b) {
      b.addEventListener("click", function (e) { claim(e); setAlign(b.dataset.align); });
    });

    rdAll("pinyin").forEach(function (b) {
      b.addEventListener("click", function (e) {
        claim(e);
        setPinyinModeFromUI(b.dataset.mode);
      });
    });

    var readBtn = rd("read");
    if (readBtn) readBtn.addEventListener("click", function (e) { claim(e); toggleRead(); });
    var transReadBtn = rd("trans-read");
    if (transReadBtn) transReadBtn.addEventListener("click", function (e) { claim(e); toggleTransRead(); });

    var textEl = rd("text");
    var R = reportMod();
    if (textEl && R && typeof R.bindSelection === "function") {
      R.bindSelection(textEl, function () {
        return {
          poemId: (current && current.id) || "",
          poemTitle: (current && current.title) || "",
          book: (current && (current.bookName || current.source || current.book)) || ""
        };
      });
    }
  }

  function bindGlobal() {
    if (bindGlobal.done) return;
    bindGlobal.done = true;

    if (window.ReaderPlayer && window.ReaderPlayer.onStop) window.ReaderPlayer.onStop(handleSpeechStopped);

    if (window.speechSynthesis && window.speechSynthesis.addEventListener) {
      var syncAll = function () { handleSpeechStopped(); };
      window.speechSynthesis.addEventListener("end", syncAll);
      window.speechSynthesis.addEventListener("cancel", syncAll);
    }

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      var open = activeMount();
      if (open) open.close();
    });

    window.addEventListener("hashchange", function () {
      if (location.hash === "#read") return;
      var open = activeMount();
      if (open) open.close();
    });

    window.addEventListener("storage", function (e) {
      if (e.key !== SETTINGS_KEY && e.key !== PINYIN_KEY) return;
      mounts.forEach(function (s) {
        withSession(s, function () { renderReaderText(); syncPinyinButton(); });
      });
    });

    window.addEventListener("pageshow", function () {
      mounts.forEach(function (s) {
        withSession(s, function () {
          if (!current) return;
          renderReaderText();
          syncPinyinButton();
        });
      });
    });

    window.addEventListener("daily-extra-change", function () {
      mounts.forEach(function (s) {
        withSession(s, function () { syncDailyButton(); });
      });
    });
    window.addEventListener("recite-collections-change", function () {
      mounts.forEach(function (s) {
        withSession(s, function () {
          syncListItemReciteButtons();
          syncReciteButtons();
          var picker = document.getElementById("gw-recite-picker");
          if (picker && !picker.hidden) renderRecitePicker();
        });
      });
    });

    window.addEventListener("reader-read-change", function (e) {
      mounts.forEach(function (s) {
        if (s.words.readStore !== (e.detail && e.detail.store)) return;
        withSession(s, function () { onReadChange(e); });
      });
    });
  }

  function syncSettingsUI() {
    var input = $("#input-username");
    if (input) input.value = String(currentUsername()).trim().slice(0, 12);
    $$("#seg-helper-c button").forEach(function (b) {
      var on = (b.dataset.helper === "on") === helperOn();
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function openSettings() {
    var modal = document.getElementById("settings-modal");
    if (!modal) return;
    syncSettingsUI();
    modal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeSettings() {
    var modal = document.getElementById("settings-modal");
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = "";
  }

  function saveUsername(v) {
    var cfg = {};
    try {
      cfg = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {};
    } catch (e) {
      cfg = {};
    }
    if (!cfg || typeof cfg !== "object") cfg = {};
    cfg.username = String(v == null ? "" : v).trim().slice(0, 12);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(cfg));
    applyAppName();
  }

  function bindSettings() {
    var modal = document.getElementById("settings-modal");
    if (!modal) return;
    $$("[data-settings-close]").forEach(function (el) {
      el.addEventListener("click", closeSettings);
    });
    var input = $("#input-username");
    if (input) {
      input.addEventListener("change", function () {
        input.value = String(currentUsername()).trim().slice(0, 12);
        saveUsername(input.value);
      });
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); input.blur(); }
      });
    }
    $$("#seg-helper-c button").forEach(function (b) {
      b.addEventListener("click", function () {
        setHelperOn(b.dataset.helper === "on");

        localStorage.setItem(PINYIN_KEY, helperOn() ? DEFAULT_PINYIN_MODE : "off");
        renderReaderText();
        syncPinyinButton();
        syncSettingsUI();
        showToast(helperOn() ? "阅读辅助已开启：打开即自动注音" : "阅读辅助已关闭：打开为纯文本");
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) closeSettings();
    });
  }

  var mounts = [];

  function activeMount() {
    for (var i = 0; i < mounts.length; i++) {
      if (mounts[i].api && mounts[i].api.isOpen()) return mounts[i].api;
    }
    return null;
  }

  function unmount(rootEl) {
    var target = null;
    for (var i = mounts.length - 1; i >= 0; i--) {
      if (!rootEl || mounts[i].root === rootEl) { target = mounts[i]; break; }
    }
    if (!target) return false;
    if (target.api && target.api.isOpen()) withSession(target, function () { closeReader(); });
    mounts.splice(mounts.indexOf(target), 1);
    if (window.ReaderEngine.current === target.api) window.ReaderEngine.current = null;
    return true;
  }

  function mount(config) {
    var cfg = config || {};

    if ((!cfg.items || !cfg.items.length) && !cfg.allowEmpty) return null;
    var rootSel = cfg.root || "[data-gw-root]";
    var rootEl = typeof rootSel === "string" ? document.querySelector(rootSel) : rootSel;
    if (!rootEl) return null;

    for (var i = 0; i < mounts.length; i++) {
      if (mounts[i].root === rootEl && mounts[i].cfg === cfg) return mounts[i];
    }

    var previous = live;
    var session = {
      root: rootEl,
      box: (cfg.reader ? (typeof cfg.reader === "string" ? document.querySelector(cfg.reader) : cfg.reader) : null) || document.querySelector("[data-gw-reader]"),
      cfg: cfg,
      words: Object.assign({}, DEFAULT_WORDS, cfg.words || {}),

      src: cfg.items.slice(),
      items: cfg.items.map(function (p) { return canonicalOf(p, cfg.id); }),
      byId: {},
      current: null,
      listScroll: 0,
      keyword: "",
      filter: cfg.initialFilter || "all",
      autoReading: false,
      speakingTarget: "原文",
      listEl: null,
      transBox: null,
      domBound: false,
      listeners: []
    };
    session.items.forEach(function (p) { session.byId[p.id] = p; });

    liveTo(session);
    if (W.version) {

      localStorage.setItem("poem_classic_words_" + W.version, "1");
    }
    init(session);

    session.api = {
      id: cfg.id || "gw",
      words: session.words,
      total: function () { return session.items.length; },
      visible: function () { return withSession(session, function () { return visibleItems().length; }); },
      isOpen: function () { return withSession(session, function () { var el = rd("reader"); return !!el && !el.hidden; }); },
      open: function (id) { withSession(session, function () { var p = byId(id); if (p) openReader(p); }); },
      close: function () { withSession(session, function () { closeReader(); }); },
      align: function () { return alignMode(); },
      setAlign: function (m) { return withSession(session, function () { return setAlign(m); }); },
      setKeyword: function (kw) { withSession(session, function () { keyword = String(kw == null ? "" : kw); renderList(); }); },

      hideReader: function () { return withSession(session, hideReader); },

      refreshCanonical: function () {
        return withSession(session, function () {

          var source = session.src || session.items;
          var book = session.cfg && session.cfg.id;
          var arr = source.map(function (p) { return canonicalOf(p, book); });
          session.items = arr;
          session.byId = {};
          arr.forEach(function (p) { session.byId[p.id] = p; });
          items = arr;
          itemsById = session.byId;
          if (current) {
            var now = itemsById[current.id];
            if (now) current = now;
          }
          var box = rd("reader");
          if (current && box && !box.hidden) {

            renderReaderText();
            var tt = box.querySelector(".rd-trans-text, #rd-trans-text");
            if (tt) tt.textContent = current.translation || W.pendingTranslation;
          }
          renderList();
          return arr.length;
        });
      },

      setItems: function (list) {
        return withSession(session, function () {
          var arr = (list || []).slice();
          session.items = arr;
          session.byId = {};
          arr.forEach(function (p) { session.byId[p.id] = p; });
          items = arr;
          itemsById = session.byId;
          if (current && !itemsById[current.id]) closeReader();
          renderList();
          syncRandomReadButton();
        });
      },
      /* 打印 / 快照要用的一行行正文：与阅读器同一条注音出口（含勘误），
         表格也照画 —— 打印出来的表与屏幕上的一致 */
      annotate: function () {
        return withSession(session, function () {
          return pageTextHtml(current ? current.text : "", "rare");
        });
      },
      annotateLine: function (line) {
        return withSession(session, function () {
          return annotateLine(readerWid(current), line, "rare");
        });
      },
      onSpeechStopped: function () { withSession(session, handleSpeechStopped); },
      root: rootEl,
      box: session.box,
      cfg: cfg
    };
    mounts.push(session);
    window.ReaderEngine.current = session.api;

    if (previous) liveTo(previous);
    return session.api;
  }

  function withSession(session, fn) {
    var prev = live;
    stash(prev);
    liveTo(session);
    var out;
    try {
      out = fn();
    } finally {
      stash(session);
      if (prev && prev !== session) liveTo(prev);
      else enterLive();
    }
    return out;
  }

  function init(session) {
    var s = session || live;

    if (CFG.setTitle !== false) applyAppName();

    if (!s.domBound) {
      s.domBound = true;

      if (s.root && s.root.querySelector && s.root.querySelector('[data-gw="search"]')) {
        bindSearch(s.root);
      }
      bindEvents();
      bindSettings();
      bindGlobal();
    }

    if (!items.length) {
      var listEl = listBox();
      if (listEl) listEl.innerHTML = '<div class="empty">' +
        esc(CFG.allowEmpty ? W.empty : W.loadingFailed) + "</div>";
      return;
    }
    renderList();
    syncAlignButtons();
    syncRandomReadButton();

    if (window.ReciteCollections && window.ReciteCollections.refreshSnapshots) {
      window.ReciteCollections.refreshSnapshots(window.SITE_INDEX || []);
    }

    if (session.api && session.api.refreshCanonical) session.api.refreshCanonical();
  }

  function reportMod() {
    return (typeof window !== "undefined" && window.Report) || null;
  }

  function reportItemBtn(p) {
    var R = reportMod();
    if (!R || typeof R.itemBtn !== "function") return "";
    return R.itemBtn(p);
  }

  function syncReportButton() {
    var btn = rd("report");
    var R = reportMod();
    if (!btn) return;
    if (!current || !R) { btn.hidden = true; return; }
    btn.hidden = false;
  }

  function openReport(p, extra) {
    var R = reportMod();
    if (!R) { showToast("页面脚本版本对不上（刷新一次即可）"); return; }
    var o = extra || {};
    R.open({
      kind: o.kind || "other",
      poemId: (p && p.id) || "",
      poemTitle: (p && p.title) || "",
      book: (p && (p.bookName || p.source || p.book)) || "",
      quote: o.quote || "",
      context: o.context || ""
    });
  }

  function dailyMod() {
    return (typeof window !== "undefined" && window.DailyExtraUI) || null;
  }

  function dailyItemBtn(p) {
    var U = dailyMod();
    if (!U) return "";
    return U.itemBtn(p);
  }

  function syncListItemDailyButtons() {
    var U = dailyMod();
    if (!U) return;
    $$(".item-daily", listBox()).forEach(function (b) {
      var id = b.getAttribute("data-daily");
      var p = itemsById[id];
      if (!p) return;
      U.syncOne(b, p);
    });
  }

  function syncDailyButton() {
    var btn = rd("daily");
    if (btn) {
      if (!current || !dailyMod()) {
        btn.hidden = true;
      } else {
        btn.hidden = false;
        dailyMod().syncOne(btn, current);
      }
    }

    syncListItemDailyButtons();
  }

  function toggleDaily(p) {
    if (!p) return;
    var U = dailyMod();
    if (!U) {
      showToast("本机不支持今日加背");
      return;
    }
    var r = U.toggle(p);
    if (r.message) showToast(r.message);
    if (r.ok === false) return;
    syncDailyButton();
  }

  function reciteState(p) {
    if (!p || !window.ReciteCollections) return { in: false, collections: [] };
    var cols = window.ReciteCollections.collectionsOf(p.id);
    return { in: cols.length > 0, collections: cols };
  }

  function reciteGlyph() {

    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M7 4.6h10a1.4 1.4 0 0 1 1.4 1.4v13.4l-6.4-4.1-6.4 4.1V6a1.4 1.4 0 0 1 1.4-1.4Z"/>' +
      "</svg>";
  }

  function reciteItemBtn(p) {
    var on = reciteState(p).in;
    var label = on ? W.reciteIn : W.reciteAdd;
    return '<button type="button" class="item-recite" data-recite="' + esc(p.id) + '"' +
      ' data-on="' + (on ? "1" : "0") + '"' +
      ' title="' + esc(label) + '" aria-label="' + esc(p.title) + "：" + esc(label) + '"' +
      ' aria-pressed="' + (on ? "true" : "false") + '">' + reciteGlyph() + "</button>";
  }

  function syncListItemReciteButtons() {
    $$(".item-recite", listBox()).forEach(function (b) {
      var id = b.getAttribute("data-recite");
      var p = itemsById[id];
      if (!p) return;
      var on = reciteState(p).in;
      b.dataset.on = on ? "1" : "0";
      var label = on ? W.reciteIn : W.reciteAdd;
      b.title = label;
      b.setAttribute("aria-label", p.title + "：" + label);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function syncReciteButtons() {
    var btn = rd("recite");
    if (!btn) return;
    if (!current || !window.ReciteCollections) {
      btn.hidden = true;
      return;
    }
    btn.hidden = false;
    var on = reciteState(current).in;
    btn.classList.toggle("is-in", on);
    btn.dataset.on = on ? "1" : "0";
    var label = on ? W.reciteIn : W.reciteAdd;
    btn.title = label;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    var lab = btn.querySelector(".sr-only");
    if (lab) lab.textContent = label;
    syncListItemReciteButtons();
  }

  function openRecitePicker(p) {
    if (!p || !window.ReciteCollections) return;
    var C = window.ReciteCollections;
    var cols = C.list();
    var inCols = {};
    C.collectionsOf(p.id).forEach(function (c) { inCols[c.id] = true; });

    var wrap = document.getElementById("gw-recite-picker");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "gw-recite-picker";
      wrap.className = "modal recite-picker";
      wrap.hidden = true;
      wrap.innerHTML =
        '<div class="modal-mask" data-recite-close="1"></div>' +
        '<div class="modal-box small" role="dialog" aria-modal="true" aria-label="加入背诵">' +
        '<button type="button" class="modal-close" data-recite-close="1" aria-label="关闭">✕</button>' +
        '<div class="modal-head"><h2>加入背诵</h2>' +
        '<div class="recite-sub" id="gw-recite-sub"></div></div>' +
        '<div class="recite-cols" id="gw-recite-cols"></div>' +
        '<div class="recite-new">' +
        '<input id="gw-recite-new" class="settings-input" type="text" maxlength="12" ' +
        'placeholder="新建集合，例如：我要背的" autocomplete="off" enterkeyhint="done" />' +
        '<button type="button" class="btn ghost-btn" id="gw-recite-create">新建</button>' +
        "</div>" +
        "</div>";
      document.body.appendChild(wrap);
      bindRecitePicker(wrap);
    }

    wrap.dataset.item = p.id;
    wrap.dataset.title = p.title;
    wrap.hidden = false;

    document.body.style.overflow = "hidden";
    renderRecitePicker();
  }

  function renderRecitePicker() {
    var wrap = document.getElementById("gw-recite-picker");
    if (!wrap || wrap.hidden) return;
    var p = itemsById[wrap.dataset.item] || current;
    var C = window.ReciteCollections;
    if (!p || !C) return;
    var cols = C.list();
    var inCols = {};
    C.collectionsOf(p.id).forEach(function (c) { inCols[c.id] = true; });

    var sub = document.getElementById("gw-recite-sub");
    if (sub) {
      var n = Object.keys(inCols).length;
      sub.textContent = "《" + p.title + "》" + (n ? "已在 " + n + " 个集合里" : "尚未加入任何集合");
    }

    var box = document.getElementById("gw-recite-cols");
    if (!box) return;
    if (!cols.length) {
      box.innerHTML = '<div class="recite-empty">还没有自选集合。在下面输入一个名字新建。</div>';
      return;
    }
    box.innerHTML = cols.map(function (c) {
      var on = !!inCols[c.id];
      return '<button type="button" class="recite-col' + (on ? " on" : "") + '"' +
        ' data-col="' + esc(c.id) + '" aria-pressed="' + (on ? "true" : "false") + '">' +
        '<span class="recite-col-tick" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17.5 19.5 7"/></svg>' +
        "</span>" +
        '<span class="recite-col-name">' + esc(c.name) + "</span>" +
        '<span class="recite-col-count">' + c.items.length + " 篇</span>" +
        "</button>";
    }).join("");
  }

  function closeRecitePicker() {
    var wrap = document.getElementById("gw-recite-picker");
    if (!wrap) return;
    wrap.hidden = true;
    document.body.style.overflow = "";
  }

  function bindRecitePicker(wrap) {
    wrap.addEventListener("click", function (e) {
      var t = e.target;
      if (t.closest && t.closest("[data-recite-close]")) {
        closeRecitePicker();
        return;
      }
      var colBtn = t.closest ? t.closest("[data-col]") : null;
      if (colBtn) {
        var p = itemsById[wrap.dataset.item] || current;
        var C = window.ReciteCollections;
        if (!p || !C) return;
        var cid = colBtn.getAttribute("data-col");
        var was = C.collectionsOf(p.id).some(function (c) { return c.id === cid; });
        if (was) {
          C.removeItem(p.id, cid);
          showToast("已移出「" + (C.get(cid) ? C.get(cid).name : "") + "」的背诵清单");
        } else {
          C.add(p.id, cid);
          stashSnapshot(p);
          showToast("已加入「" + (C.get(cid) ? C.get(cid).name : "") + "」，会排进每日任务");
        }
        renderRecitePicker();
        syncReciteButtons();
        return;
      }
      if (t.id === "gw-recite-create") {
        var input = document.getElementById("gw-recite-new");
        var name = input ? input.value : "";
        var p2 = itemsById[wrap.dataset.item] || current;
        var C2 = window.ReciteCollections;
        if (!p2 || !C2) return;
        var col = C2.create(name);
        C2.add(p2.id, col.id);
        stashSnapshot(p2);
        if (input) input.value = "";
        renderRecitePicker();
        syncReciteButtons();
        showToast("已新建「" + col.name + "」并加入这一篇");
      }
    });
    var input = document.getElementById("gw-recite-new");
    if (input) {
      input.addEventListener("keydown", function (e) {
        if (e.key !== "Enter") return;
        e.preventDefault();
        var btn = document.getElementById("gw-recite-create");
        if (btn) btn.click();
      });
    }
  }

  function stashSnapshot(p) {
    if (!p || !window.ReciteCollections || !p.text) return;
    var snap = {
      title: p.title, author: p.author || "", authorName: p.authorName || "",
      dynasty: p.dynasty || "", source: p.source || "", selection: p.selection || "",
      book: p.book || "", bookName: p.bookName || "", page: p.page || "",
      text: p.text || "", translation: p.translation || "",
      translationSource: p.translationSource
    };
    var idx = (window.SITE_INDEX || []).slice();
    if (!idx.some(function (x) { return x.id === p.id; })) idx.push(Object.assign({ id: p.id }, snap));
    window.ReciteCollections.refreshSnapshots(idx);
  }

  function startRecite(p) {
    if (!p) return;
    if (!window.ReciteCollections) {
      showToast("本机不支持自选集合");
      return;
    }
    var C = window.ReciteCollections;
    if (!C.list().length) {
      var col = C.create("");
      C.add(p.id, col.id);
      stashSnapshot(p);
      syncReciteButtons();
      showToast("已新建「" + col.name + "」并加入这一篇");
      return;
    }
    openRecitePicker(p);
  }

  window.ReaderEngine = {
    mount: mount,
    unmount: unmount,
    active: activeMount,
    words: DEFAULT_WORDS,
    totalItems: function () { return items.length; },

    /* 正文 → HTML（表格 + 注音）。默认用裸转义，页面层由 ClassicProse.annotate 走它 */
    textToHtml: textToHtml,

    /* 自查：语料里画歪的表格（列数不一致 / 只剩一行）。测试与开发时引一声 */
    tableIssues: tableIssues
  };

  window.ClassicProse = {
    isRead: function (id) { return isRead(id); },
    align: function () { return alignMode(); },
    setAlign: function (m) { return setAlign(m); },
    annotate: function () {
      return pageTextHtml(current ? current.text : "", "rare");
    },
    annotateLine: function (line) {
      return annotateLine(readerWid(current), line, "rare");
    },

    onSpeechStopped: handleSpeechStopped
  };

})();
