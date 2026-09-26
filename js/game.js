(function () {
  "use strict";

  var Ent = window.Entitlement;
  var Q = window.Quiz;

  var Ex = window.Exam;

  var MODES = [
    {
      id: "fly", cap: "feihualing", tier: "max",
      name: "飞花令",
      desc: "给一个令字，写出所有带这个字的句子",
      unit: "句"
    }
  ];

  (Ex ? Ex.VARIANTS : []).forEach(function (v) {
    MODES.push({
      id: v.id, cap: v.cap, tier: v.tier,
      name: v.name, desc: v.desc, unit: "题",
      exam: true
    });
  });

  var CHAR_LEVELS = [
    { id: "easy",   name: "常见字", min: 25 },
    { id: "normal", name: "一般字", min: 6 },
    { id: "hard",   name: "难字",   min: 6, hard: true }
  ];

  var state = {
    mode: "",
    chars: [],
    level: "normal",
    paper: [],
    at: 0,
    picks: [],
    checked: [],
    said: [],
    graded: null,
    server: null,
        setup: { scope: "all", size: 0, scopeChosen: false },
        scopes: [],
    scopeOpen: true,
    left: 0,
    timer: null
  };

  var host = null;
  var viewEl = null;

  function $(sel, base) { return (base || host || document).querySelector(sel); }
  function $$(sel, base) {
    return Array.prototype.slice.call((base || host || document).querySelectorAll(sel));
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

    var WANTED = [
    { id: "classic",    file: "data/poems-classic.js",    v: "POEMS_CLASSIC" },
    { id: "tangshi",    file: "data/poems-tangshi.js",    v: "POEMS_TANGSHI" },
    { id: "songci",     file: "data/poems-songci.js",     v: "POEMS_SONGCI" },
    { id: "guwen",      file: "data/poems-guwen.js",      v: "POEMS_GUWEN" },
    { id: "zhaoming",   file: "data/poems-zhaoming.js",   v: "POEMS_ZHAOMING" },
    { id: "yuanqu",     file: "data/poems-yuanqu.js",     v: "POEMS_YUANQU" },
    { id: "yuefu",      file: "data/poems-yuefu.js",      v: "POEMS_YUEFU" },
    { id: "jinxiandai", file: "data/poems-jinxiandai.js", v: "POEMS_JINXIANDAI" },
    { id: "chengyu",    file: "data/poems-chengyu.js",    v: "POEMS_CHENGYU" },
    { id: "changshi",   file: "data/poems-changshi.js",   v: "POEMS_CHANGSHI" }
  ];

  var LOAD_TIMEOUT_MS = 8000;

  function loadScript(src) {
    return new Promise(function (resolve) {
      var done = false;
      function finish(ok) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(ok);
      }
      var timer = setTimeout(function () { finish(false); }, LOAD_TIMEOUT_MS);
      var s = document.createElement("script");
      s.src = src;
      s.async = false;
      s.onload = function () { finish(true); };
      s.onerror = function () { finish(false); };
      try { document.head.appendChild(s); }
      catch (e) { finish(false); }
    });
  }

    function corpus() {
    var out = (window.POEMS_ALL || []).map(function (p) {
      return p && p.book ? p : expand(p, "poems");
    });
    WANTED.forEach(function (w) {
      var list = window[w.v];
      if (list && list.length) {
        out = out.concat(list.map(function (p) { return expand(p, w.id); }));
      }
    });
    return out;
  }

    function expand(p, book) {
    if (!p) return p;
    var m = p;
    if (typeof window.masterTextOf === "function" && p.textRef) {
      try { m = window.masterTextOf(p, book); } catch (e) { m = p; }
    }
    return tag(m, book);
  }

  function tag(p, book) {
    if (!p) return p;
    var out = {};
    Object.keys(p).forEach(function (k) { out[k] = p[k]; });
    if (!out.book) out.book = book;
    return out;
  }

  function ensureCorpus() {
    var jobs = WANTED.filter(function (w) {
      return !(window[w.v] && window[w.v].length);
    }).map(function (w) { return loadScript(w.file); });
    if (!jobs.length) return Promise.resolve(corpus());
    return Promise.all(jobs).then(function () { return corpus(); });
  }

  function backing() {
    try { return window.localStorage; } catch (e) { return null; }
  }

  function identifier() {
    return Ent.identity({ backing: backing() });
  }

  function modeOf(id) {
    for (var i = 0; i < MODES.length; i++) if (MODES[i].id === id) return MODES[i];
    return null;
  }

  function allowed(mode, id) {
    return capAllowed(mode.cap, id);
  }

  function capAllowed(cap, id) {
    return Ent.can(cap, { tier: (id && id.tier) || "free", signedIn: !!(id && id.signedIn) });
  }

  function judge(payload) {
    var api = window.AccountApi;
    var req = api && api.gameAnswer ? api.gameAnswer(payload) : null;
    if (!req) return Promise.resolve(null);
    return Promise.resolve(req).then(function (r) {
      if (r && r.ok) { state.server = "on"; return r; }

      if (r && r.status === 403) { state.server = "on"; return r; }
      state.server = "off";
      return null;
    })["catch"](function () { state.server = "off"; return null; });
  }

  function pinyinOf(ch) {
    var P = window.Pinyin;
    if (!P || !P.read) return "";
    try { return P.read(ch) || ""; } catch (e) { return ""; }
  }

  function isHard(ch) {
    var P = window.Pinyin;
    if (!P) return false;
    try { return P.isPolyphone(ch) || !P.isCommon(ch); } catch (e) { return false; }
  }

  function pickChars(cps, levelId) {
    var lv = null;
    for (var i = 0; i < CHAR_LEVELS.length; i++) if (CHAR_LEVELS[i].id === levelId) lv = CHAR_LEVELS[i];
    if (!lv) lv = CHAR_LEVELS[1];
    var all = Q.candidates(cps, { min: lv.min });
    var pool = lv.hard ? all.filter(isHard) : (lv.id === "easy" ? all : all.filter(function (c) { return !isHard(c); }));
    if (!pool.length) pool = all;
    if (!pool.length) return [];

    var picked = Q.shuffle(pool, pool[0] + pool.length)[0] || pool[0];
    var second = Q.shuffle(pool.filter(function (c) { return c !== picked; }), picked)[0];
    return second ? [picked, second] : [picked];
  }

  function renderHome() {
    var id = identifier();

        var html = scopeRows();
    html += homeTag("题型");
    html += '<div class="poems-home-row">';
    MODES.forEach(function (m) {
      var r = allowed(m, id);
      html += '<button class="account-card game-mode" type="button" ' +
        'data-game-mode="' + m.id + '"' + (r.ok ? "" : ' data-locked="1"') + '>' +
        '<span class="game-mode-name">' + esc(m.name) + "</span>" +
        '<span class="game-mode-desc">' + esc(m.desc) + "</span>" +
        '<span class="game-mode-tier"' + (r.ok ? ' data-on="1"' : "") + '>' +
        esc(tierText(m, r)) +
        "</span>" +
        "</button>";
    });
    html += "</div>";

        if (!id.signedIn) {
      html += '<button class="account-btn" type="button" data-game-go="/login/">登录</button>';
    }
    return html;
  }

    function scopeRows() {
    var scopes = scopeList();
    var groups = [[], [], []];
    scopes.forEach(function (sc) {
      var g = Ex ? Ex.scopeGroupOf(sc.id) : -1;
      if (g < 0) return;
      groups[g].push(sc);
    });

    var names = (Ex && Ex.SCOPES_GROUPS) || [];
    var html = '<div class="game-scope-head">' +
      '<p class="poems-home-tag">范围</p>' +
      '<button class="game-scope-all" type="button" data-game-scope-all="1">' +
      (state.scopeOpen ? "收起" : "展开") + "</button>" +
      "</div>";
    html += pickNote();
    groups.forEach(function (rows, i) {
      html += scopeGroup(names[i], rows);
    });
    return html;
  }

    function pickNote() {
    return '<p class="game-scope-note">' + esc(scopePickNote()) + "</p>";
  }

    function scopeGroup(title, rows) {
    if (!rows.length) return "";
    var open = state.scopeOpen;
    return '<div class="game-scope-row"' + (open ? "" : ' data-folded="1"') + ">" +
      '<button class="game-scope-item" type="button" data-game-scope-fold="' + esc(title) + '"' +
      ' aria-expanded="' + (open ? "true" : "false") + '">' +
      '<span class="game-scope-sign" aria-hidden="true"></span>' +
      '<span class="game-scope-name">' + esc(title) + "</span>" +
      '<span class="game-scope-count">' + esc(scopeCountOf(rows)) + "</span>" +
      "</button>" +
      '<div class="game-scope-grid">' +
      rows.map(scopePick).join("") +
      "</div>" +
      "</div>";
  }

    function scopeCountOf(rows) {
    var n = 0;
    rows.forEach(function (r) { n += Number(r.count) || 0; });
    return n + " 条";
  }

    function scopePick(sc) {
    var on = state.scopes.indexOf(sc.id) >= 0;
    return '<button class="game-scope-pick" type="button" data-game-scope="' + esc(sc.id) + '"' +
      (on ? ' data-on="1" aria-pressed="true"' : ' aria-pressed="false"') + ">" +
      '<span class="game-scope-name">' + esc(sc.name) + "</span>" +
      '<span class="game-scope-count">' + esc(sc.count) + " 条</span>" +
      "</button>";
  }

    function homeTag(title) {
    return '<p class="poems-home-tag">' + esc(title) + "</p>";
  }

    function tierText(m, r) {
    if (r.ok) return Ent.tierLabel(m.tier);
    var why = Ent.denyReason(m.cap, { tier: identifier().tier, signedIn: !!(r.reason !== "login") });
    if (r.reason === "login") return why || "登录可用";
    return Ent.tierLabel(r.minTier || Ent.cap(m.cap).minTier) + " 可用";
  }

  function renderFly() {
    var id = identifier();
    var m = modeOf("fly");
    var cps = corpus();
    var ff = Q.flyFlower({ poems: cps, chars: state.chars });
    var sum = Q.charSummary(cps, state.chars);

    var html = '<section class="account-card game-head">' +
      '<button class="account-btn ghost game-back" type="button" data-game-back="1">换一个玩法</button>' +
      '<h2 class="account-card-title">' + esc(m.name) + "</h2>" +
      '<div class="game-chars">' + state.chars.map(function (c) {
        return '<span class="game-char">' + esc(c) +
          (pinyinOf(c) ? '<span class="game-char-py">' + esc(pinyinOf(c)) + "</span>" : "") +
          "</span>";
      }).join("") + "</div>" +
      '<p class="account-hint">' + esc(sum.text) + " —— 这是合集里实际能对上的句数。</p>" +
      '<div class="seg mini" id="game-level" role="group" aria-label="令字难度">' +
      CHAR_LEVELS.map(function (lv) {
        return '<button type="button" data-game-level="' + lv.id + '"' +
          (lv.id === state.level ? ' class="active" aria-pressed="true"' : ' aria-pressed="false"') +
          ">" + esc(lv.name) + "</button>";
      }).join("") + "</div>" +
      "</section>";

    html += '<section class="account-card">' +
      '<button class="account-btn ghost" type="button" data-game-reveal="1">' +
      (state.revealed ? "收起答案" : "看答案（" + ff.count + " 句）") + "</button>" +
      (state.revealed
        ? '<div class="game-lines">' + (ff.rows.length ? ff.rows.map(function (r) {
            return '<div class="game-line" data-id="' + esc(r.id) + '">' +
              '<span class="game-line-text">' + mark(r.text, state.chars) + "</span>" +
              '<span class="game-line-src">' + esc(r.title) +
              (r.source ? " · " + esc(bookName(r.source)) : "") + "</span>" +
              "</div>";
          }).join("") : '<p class="account-hint">这一份语料里没有带这些字的句子。</p>') + "</div>"
        : '<p class="account-hint">先自己想，想完了再点开对一对。点开之后可以点任意一句跳到原文。</p>') +
      "</section>";

    html += '<section class="account-card"><h2 class="account-card-title">自己写一句试试</h2>' +
      '<div class="account-field">' +
      '<label class="account-label" for="game-said">你想起来的那一句</label>' +
      '<input class="account-input" id="game-said" type="text" autocomplete="off" ' +
      'placeholder="整句照抄，例如「日月之行」" />' +
      "</div>" +
      '<button class="account-btn" type="button" data-game-say="1">核一核</button>' +
      '<p class="account-msg" id="game-said-msg"></p>' +
      '<p class="account-hint">判分是逐字比对：写出来的这一句要能在合集里一字不差地找到。</p>' +
      "</section>";
    return html;
  }

    function bookName(source) {
    var bits = String(source == null ? "" : source).split(" · ");
    var books = window.SITE_BOOKS || [];
    for (var i = 0; i < books.length; i++) {
      if (bits[0] === books[i].id) { bits[0] = books[i].name; break; }
    }
    return bits.join(" · ");
  }

  function mark(text, chars) {
    var out = "";
    String(text).split("").forEach(function (ch) {
      out += chars.indexOf(ch) >= 0
        ? '<mark class="game-hit">' + esc(ch) + "</mark>"
        : esc(ch);
    });
    return out;
  }

  function variantOf(modeId) {
    return Ex ? Ex.variant(modeId) : null;
  }

  function scopeList() {
    return Ex ? Ex.scopes(corpus()) : [];
  }

  function scopeName(scopeId) {
    var list = scopeList();
    for (var i = 0; i < list.length; i++) if (list[i].id === scopeId) return list[i].name;
    return "全部";
  }

    function scopeCount(scopeId) {
    var list = scopeList();
    for (var i = 0; i < list.length; i++) if (list[i].id === scopeId) return list[i].count;
    return "?";
  }

    function scopePickLabel(scopeId) {
    var id = String(scopeId || "all");
    if (id.indexOf("pick:") !== 0) {
      var one = scopeCount(id);
      return scopeName(id) + (one === "?" ? "" : "（" + one + " 条）");
    }
    var ids = id.slice(5).split("+").filter(Boolean);
    var n = null;
    if (Ex && Ex.select) {
      try { n = Ex.select(corpus(), id).length; } catch (e) { n = null; }
    }
    return ids.map(scopeName).join(" + ") + (n == null ? "" : "（" + n + " 条）");
  }

    function pickScope() {
    var on = state.scopes.slice();
    if (!on.length) return "all";
    if (on.indexOf("all") >= 0) return "all";
    if (on.length === 1) return on[0];
    return "pick:" + on.join("+");
  }

    function pickCount() {
    if (!Ex || !Ex.select) return null;
    try { return Ex.select(corpus(), pickScope()).length; } catch (e) { return null; }
  }

    function scopePickNote() {
    var n = pickCount();
    var on = state.scopes.slice();
    if (!on.length) return "一格没选 = 什么都考" + (n == null ? "" : "（" + n + " 篇）");
    if (on.indexOf("all") >= 0) return "全部" + (n == null ? "" : "（" + n + " 篇）");
    var names = on.map(scopeName);
    return names.join(" + ") + (n == null ? "" : "（" + n + " 篇）");
  }

    function renderSetup() {
        var m = modeOf(state.pending);
    var v = variantOf(state.pending);
    if (!m || !v) return "";
    var sizes = v.sizes || [];
    if (sizes.indexOf(state.setup.size) < 0) state.setup.size = v.size;

        var html = '<section class="account-card game-head">' +
      '<button class="account-btn ghost game-back" type="button" data-game-back="1">换范围</button>' +
      '<h2 class="account-card-title">' + esc(m.name) + "</h2>" +
      '<p class="account-hint">' + esc(m.desc) +
      (v.timed ? " · 限时 " + v.minutes + " 分钟" : "") + "</p>" +
      "</section>";

        html += '<section class="account-card"><h2 class="account-card-title">考什么范围</h2>' +
      '<p class="account-lead">' + esc(scopePickLabel(state.setup.scope)) + "</p>" +
      '<div class="game-nav">' +
      '<button class="account-btn ghost" type="button" data-game-back="1">换范围</button>' +
      "</div>" +
      '<p class="account-hint">范围在首页那段清单里选的；要改就回首页，点一下格子就行。</p>' +
      "</section>";

    html += '<section class="account-card"><h2 class="account-card-title">考多少题</h2>' +
      '<div class="seg mini" id="game-size" role="group" aria-label="题量">' +
      sizes.map(function (n) {
        return '<button type="button" data-game-size="' + n + '"' +
          (n === state.setup.size ? ' class="active" aria-pressed="true"' : ' aria-pressed="false"') +
          ">" + n + " 题</button>";
      }).join("") + "</div>" +
      '<p class="account-hint">' +
      (v.judge === "after"
        ? "交卷后统一批改，中途退出不评分、不留记录。"
        : "答完立刻说对错。" + (v.record ? "卷面记录留在本机。" : "本地不留记录。")) +
      "</p>" +
      '<button class="account-btn" type="button" data-game-begin="1">开始</button>' +
      (state.setupNotice
        ? '<p class="account-msg warn">' + esc(state.setupNotice) + "</p>"
        : "") +
      "</section>";
    return html;
  }

  function renderPaper() {
    var m = modeOf(state.mode);
    var v = variantOf(state.mode) || {};
    var i = state.at;
    var q = state.paper[i];
    if (!q) return "";
    var total = state.paper.length;
    var picked = state.picks[i] || "";

        var reveal = v.judge !== "after";
    var done = !!state.graded || (reveal && !!state.checked[i]);

    var html = '<section class="account-card game-head">' +
      '<button class="account-btn ghost game-back" type="button" data-game-back="1">换一个玩法</button>' +
      '<h2 class="account-card-title">' + esc(m.name) + "</h2>" +
      '<p class="account-hint">第 ' + (i + 1) + " / " + total + " 题 · " +
      esc(scopePickLabel(state.setup.scope)) +
      (v.timed ? " · 剩余 " + timeLeftText() : "") +
      " · " +
      (state.server === "off" && reveal ? "本机判分（服务端没接通）" : "由服务器判分") + "</p>" +
      (state.setupNotice ? '<p class="account-msg warn">' + esc(state.setupNotice) + "</p>" : "") +
      "</section>";

    html += '<section class="account-card">' +
      '<p class="account-lead game-stem">' + esc(q.stem) + "</p>" +
      '<p class="account-hint">下面哪一句接得上？</p>' +
      '<div class="game-opts">' + q.options.map(function (o, k) {
        var cls = "game-opt";
        if (done) {
          if (o === q.answer) cls += " ok";
          else if (o === picked) cls += " no";
        } else if (o === picked) cls += " on";
        return '<button class="' + cls + '" type="button" data-game-opt="' + k + '"' +
          (done ? " disabled" : "") + ">" + esc(o) + "</button>";
      }).join("") + "</div>" +
      (done
        ? '<p class="account-msg ' + (picked === q.answer ? "ok" : "warn") + '">' +
          (picked === q.answer ? "对了。" : "这一题答案是：" + esc(q.answer)) + "</p>"
        : "") +
            '<p class="account-hint">' + esc(q.title) + (q.source ? " · " + esc(q.source) : "") + "</p>" +
      "</section>";

    var answered = state.picks.filter(function (p) { return !!p; }).length;
    html += '<section class="account-card"><div class="game-nav">' +
      '<button class="account-btn ghost" type="button" data-game-prev="1"' +
      (i <= 0 ? " disabled" : "") + ">上一题</button>" +
      (i < total - 1
        ? '<button class="account-btn" type="button" data-game-next="1">下一题</button>'
        : '<button class="account-btn" type="button" data-game-submit="1">交卷</button>') +
      "</div>" +
      (state.graded
        ? '<p class="account-msg ok">' + esc(state.graded.text) + "</p>" +
          (state.graded.saved ? '<p class="account-hint">卷面记录已留在本机（不上云）。</p>' : "")
        : '<p class="account-hint">已答 ' + answered + " / " + total + " 题。" +
          (v.judge === "after" ? "交卷后统一批改。" : "答完一题立刻说对错。") + "</p>") +
      "</section>";
    return html;
  }

  function timeLeftText() {
    var n = Math.max(0, Math.round(state.left / 1000));
    var mm = Math.floor(n / 60);
    var ss = n % 60;
    return mm + ":" + (ss < 10 ? "0" : "") + ss;
  }

  function render() {
    if (!host || !Q) return;
        var body;
    if (state.mode === "fly") body = renderFly();
    else if (state.mode === "setup") body = renderSetup();
    else if (state.mode) body = renderPaper();
    else body = renderHome();

    if (state.mode === "fly") {
      body += '<section class="account-card"><button class="account-btn ghost" type="button" ' +
        'data-game-restart="1">换一副令字</button></section>';
    } else if (state.mode === "setup") {
          } else if (state.mode) {
            body += '<section class="account-card"><button class="account-btn ghost" type="button" ' +
        'data-game-reset="1">回到卷面设置</button></section>';
    }
    host.innerHTML = body;
    bind();
        paintBack();
  }

  function startFly(levelId) {
    state.level = levelId || state.level;
    var cps = corpus();
    state.chars = pickChars(cps, state.level);
    state.revealed = false;
    render();
  }

  function probeServer() {
    if (state.server) return;
    judge({ kind: "review", poemId: "xx1-01", chosen: "__probe__" }).then(function () { render(); });
  }

    function startPaper(mode) {
    var v = variantOf(mode) || {};
    var size = state.setup.size || v.size;
    var seed = String(Math.floor(Date.now() / 60000));
    var plan = Ex.build(corpus(), {
      kind: mode, scope: state.setup.scope, size: size, seed: seed
    });

    state.paper = plan.questions;
    state.at = 0;
    state.picks = state.paper.map(function () { return ""; });
    state.checked = state.paper.map(function () { return false; });
    state.graded = null;
    state.left = (v.minutes || 0) * 60 * 1000;
        state.setupNotice = plan.short
      ? "这个范围只凑得出 " + state.paper.length + " 题（本来要 " + plan.short + " 题）。"
      : "";

    startTimer();
    render();
  }

  function startTimer() {
    stopTimer();
    var v = variantOf(state.mode) || {};
    if (!v.timed || !state.paper.length) return;
    state.timer = setInterval(function () {
      state.left -= 1000;
      if (state.left <= 0) {
        state.left = 0;
        stopTimer();
        submit();
        return;
      }
            var head = $(".game-head .account-hint");
      if (head) head.innerHTML = head.innerHTML.replace(/剩余 \d+:\d\d/, "剩余 " + timeLeftText());
    }, 1000);
  }

  function stopTimer() {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
  }

  function start(modeId) {
    var m = modeOf(modeId);
    if (!m) return;
    var id = identifier();
    if (!allowed(m, id).ok) { render(); return; }

    stopTimer();
        var keepScope = state.setup && state.setup.scopeChosen ? state.setup.scope : "all";
    state.setup = { scope: keepScope, size: 0, scopeChosen: !!(state.setup && state.setup.scopeChosen) };
    state.setupNotice = "";

    if (modeId === "fly") {
      state.mode = "fly";
      startFly();
      ensureCorpus().then(function () {
        if (state.mode === "fly") startFly(state.level);
      });
      return;
    }

        state.mode = "setup";
    state.pending = modeId;
    render();
    ensureCorpus().then(function () {
      if (state.mode === "setup" && state.pending === modeId) render();
    });
  }

  function beginExam() {
    var modeId = state.pending;
    if (!modeOf(modeId)) return;
    state.mode = modeId;
    startPaper(modeId);
  }

  function submit() {
    stopTimer();
    var v = variantOf(state.mode) || {};

        var graded = Ex.batch(state.paper, state.picks);

    var jobs = state.paper.map(function (q, i) {
      return judge({
                kind: "paper", bankId: q.id, poemId: q.poemId, chosen: state.picks[i] || ""
      }).then(function (r) {
        return r && r.body ? !!r.body.ok : null;
      });
    });

    return Promise.all(jobs).then(function (oks) {
      oks.forEach(function (ok, i) {
        if (ok === null) return;
        graded.rows[i].ok = ok;
      });
      graded.right = graded.rows.filter(function (r) { return r.ok; }).length;
      graded.wrong = graded.total - graded.right;
      graded.text = graded.total
        ? "这次 " + graded.total + " 题对 " + graded.right + " 题"
        : "这一卷没有题目";

      state.graded = graded;
            if (v.record) {
        state.graded.saved = Ex.saveRecord({
          kind: state.mode, scope: state.setup.scope,
          right: graded.right, total: graded.total
        }).ok;
      }
      render();
      loadCorpusIntoView();
    });
  }

  function checkSaid() {
    var input = $("#game-said");
    var msg = $("#game-said-msg");
    if (!input || !msg) return;
    var said = input.value.trim();
    if (!said) { msg.className = "account-msg warn"; msg.textContent = "先写一句。"; return; }
    var local = Q.flyFlower({ poems: corpus(), chars: state.chars }).rows
      .filter(function (r) { return r.text === said; })[0];
    judge({ kind: "fly", chars: state.chars, said: said }).then(function (r) {
      var found = r && r.body ? !!r.body.found : !!local;
      var by = r && r.body ? "由服务器核对" : "本机核对（服务端没接通）";
      msg.className = "account-msg " + (found ? "ok" : "warn");
      msg.textContent = found
        ? "在合集里对上了：" + (local ? local.title : said) + " —— " + by + "。"
        : "合集里没有一字不差的一句「" + said + "」 —— " + by + "。";
    });
  }

  function bind() {
    if (!host) return;
    host.onclick = function (e) {
      var t = e.target;
      var hit = function (attr) {
        return t && t.closest ? t.closest("[" + attr + "]") : null;
      };

      var go = hit("data-game-go");
      if (go) { location.href = go.getAttribute("data-game-go"); return; }

      var back = hit("data-game-back");
      if (back) {
        stopTimer();
                if (state.mode === "setup") {
          state.mode = "";
          state.pending = "";
        } else {
          state.mode = "setup";
        }
        render();
        return;
      }

            var pick = hit("data-game-scope");
      if (pick) {
        var sid = pick.getAttribute("data-game-scope");
        var at = state.scopes.indexOf(sid);
        if (at >= 0) state.scopes.splice(at, 1);
        else state.scopes.push(sid);
        state.setupNotice = "";
        render();
        return;
      }

            var fold = hit("data-game-scope-fold");
      if (fold) {
        state.scopeOpen = !state.scopeOpen;
        render();
        return;
      }

            var allFold = hit("data-game-scope-all");
      if (allFold) {
        state.scopeOpen = !state.scopeOpen;
        render();
        return;
      }

            var mode = hit("data-game-mode");
      if (mode) {
        var mid = mode.getAttribute("data-game-mode");
        if (mode.getAttribute("data-locked")) return;
        var scope = pickScope();
        state.setup.scope = scope;
        state.setup.scopeChosen = scope !== "all";
        start(mid);
        return;
      }

      var lv = hit("data-game-level");
      if (lv) { startFly(lv.getAttribute("data-game-level")); return; }

      var sz = hit("data-game-size");
      if (sz) { state.setup.size = Number(sz.getAttribute("data-game-size")); render(); return; }

      var beg = hit("data-game-begin");
      if (beg) { beginExam(); return; }

      var rev = hit("data-game-reveal");
      if (rev) { state.revealed = !state.revealed; render(); return; }

      var line = hit("data-id");
      if (line) { openPoem(line.getAttribute("data-id")); return; }

      var say = hit("data-game-say");
      if (say) { checkSaid(); return; }

      var opt = hit("data-game-opt");
      if (opt) {
        var k = Number(opt.getAttribute("data-game-opt"));
        var q = state.paper[state.at];
        var v = variantOf(state.mode) || {};
        if (!q || state.graded) return;
        state.picks[state.at] = q.options[k];
                state.checked[state.at] = v.judge !== "after";
        render();
        return;
      }

      var prev = hit("data-game-prev");
      if (prev) { state.at = Math.max(0, state.at - 1); render(); return; }
      var next = hit("data-game-next");
      if (next) { state.at = Math.min(state.paper.length - 1, state.at + 1); render(); return; }
      var sub = hit("data-game-submit");
      if (sub) { submit(); return; }
      var rst = hit("data-game-restart");
      if (rst) { startFly(); return; }
      var rset = hit("data-game-reset");
      if (rset) { stopTimer(); state.mode = "setup"; render(); return; }
    };

  }

    function openPoem(id) {
    if (!id) return;
        if (!hasReader()) { location.href = "/poems/?poem=" + encodeURIComponent(id); return; }
    var ev = new CustomEvent("poems:open", { detail: { id: id }, cancelable: true });
    document.dispatchEvent(ev);
  }

    function hasReader() {
    return !!document.querySelector('[data-gw="reader"]');
  }

  function close() {
    if (!host) return;
    stopTimer();
    state.mode = "";

        var onOwnPage = standalone();
    setDockNav(onOwnPage ? "poems" : "game");
    if (onOwnPage) { location.href = "/poems/"; return; }

    host.hidden = true;
    showList(true);
    paintHeader(null);
    paintBack();
    window.scrollTo(0, 0);
  }

    function paintHeader(mode) {
    var C = window.SiteChrome;
    if (!C || standalone()) return;
    if (!mode) { C.setPage(""); C.setSub(""); return; }
    C.setPage("古诗词大会");
    C.setSub("飞花令 · 题库复习 · 模拟考试 · 正式考试");
  }

    function paintBack() {
    var C = window.SiteChrome;
    if (!C || !C.setPageAction) return;
    if (!host || host.hidden) { C.setPageAction(null); return; }

    var inLayer = !!state.mode;
    C.setPageAction({
            label: inLayer ? "返回古诗词大会" : "返回诗词列表",
      onclick: function () {
        stopTimer();
        state.mode = "";
        state.pending = "";
        if (inLayer) { render(); return; }
        close();
      }
    });
  }

    function showList(on) {
        if (!viewEl) return;
    if (on) viewEl.removeAttribute("hidden");
    else viewEl.setAttribute("hidden", "");
  }

  function open() {
    if (!host) return;
    showList(false);
    host.hidden = false;
    setDockNav("game");
    state.mode = "";
        state.scopes = [];
    state.scopeOpen = true;
    state.setup = { scope: "all", size: 0, scopeChosen: false };
    state.setupNotice = "";
    state.pending = "";
    render();
    paintHeader(true);
    paintBack();
        ensureCorpus().then(function () {

      if (!state.mode && host && !host.hidden) render();
    });
    window.scrollTo(0, 0);
  }

  function isOpen() { return !!host && !host.hidden; }

    function setDockNav(v) {
    if (!document.body || !document.body.setAttribute) return;
    document.body.setAttribute("data-nav", v);
    var C = window.SiteChrome;
    if (C && C.setDock) C.setDock();
  }

  function init() {
    host = document.querySelector('[data-poems-view="game"]');
    viewEl = document.querySelector('[data-poems-view="list"]');
    if (!host) return;
    host.hidden = true;

        if (wantsGame() && !standalone()) { location.replace("/dahui/"); return; }

        if (standalone()) {
      open();
      loadCorpusIntoView();
      return;
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen() && !state.mode) close();
    });

    loadCorpusIntoView();
  }

    function standalone() {
    return !!(document.body && document.body.getAttribute &&
      document.body.getAttribute("data-nav") === "game");
  }

    function wantsGame() {
    var q = (window.location && window.location.search) || "";
    return /(?:^|[?&])game=1(?:&|$)/.test(q);
  }

    function loadCorpusIntoView() {
    ensureCorpus().then(function () {
      if (!state.mode && host && !host.hidden) render();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.PoemGame = {
    MODES: MODES,
    CHAR_LEVELS: CHAR_LEVELS,
    open: open,
    close: close,
    isOpen: isOpen,

    start: start,
    state: function () { return state; },
    corpus: corpus
  };
})();
