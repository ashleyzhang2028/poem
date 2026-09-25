(function () {
  "use strict";

  var Ent = window.Entitlement;
  var Q = window.Quiz;

  var GATHERING_CAP = "exam.gathering";

  var MODES = [
    {
      id: "fly", cap: "feihualing", tier: "max",
      name: "飞花令",
      desc: "给一个令字，写出所有带这个字的句子",
      unit: "句"
    },
    {

      id: "paper", cap: "exam.paper", tier: "max",
      name: "试题模拟",
      desc: "抽一套卷子当场做，交卷即判分",
      unit: "题"
    },
    {
      id: "review", cap: "quiz.review", tier: "pro",
      name: "题库复习",
      desc: "给上句选下句，一道道过",
      unit: "题"
    }
  ];

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
    server: null
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
    { file: "data/poems-classic.js",  v: "POEMS_CLASSIC" },
    { file: "data/poems-tangshi.js",  v: "POEMS_TANGSHI" },
    { file: "data/poems-songci.js",   v: "POEMS_SONGCI" },
    { file: "data/poems-guwen.js",    v: "POEMS_GUWEN" },
    { file: "data/poems-zhaoming.js", v: "POEMS_ZHAOMING" },
    { file: "data/poems-yuanqu.js",  v: "POEMS_YUANQU" },
    { file: "data/poems-yuefu.js",   v: "POEMS_YUEFU" },
    { file: "data/poems-jinxiandai.js", v: "POEMS_JINXIANDAI" }
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
    var out = (window.POEMS_ALL || []).slice();
    WANTED.forEach(function (w) {
      var list = window[w.v];
      if (list && list.length) out = out.concat(list);
    });
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

  function gateCard(mode, id) {
    var r = capAllowed(mode.cap, id);
    if (r.ok) return "";

    var why = Ent.denyReason(mode.cap, { tier: id.tier, signedIn: id.signedIn });
    return '<div class="game-gate">' +
      '<p class="game-gate-why">' + esc(why) + "</p>" +
      (id.signedIn
        ? '<p class="account-hint">层级由管理员按邮箱掩码发放。这一页的说明与对照见 <a href="/plans/">四种用户对比</a>。</p>'
        : '<button class="account-btn" type="button" data-game-go="/login/">用邮箱建一个账号</button>') +
      "</div>";
  }

  function renderEntryGate() {
    if (!host) return;
    var id = identifier();
    host.innerHTML = '<section class="account-card">' +
      '<h2 class="account-card-title">古诗词大会</h2>' +
      '<p class="account-lead">这一项是《古诗词大会》的集子，与试题模拟分开。</p>' +
      gateCard({ cap: GATHERING_CAP }, id) +
      '<button class="account-btn ghost" type="button" data-game-close="1">返回诗词列表</button>' +
      "</section>";
    host.hidden = false;
    if (viewEl) viewEl.hidden = true;
    bind();
    paintBack();
  }

  function renderHome() {
    var id = identifier();

    var html = '<section class="account-card">' +
      '<h2 class="account-card-title">试题模拟</h2>' +
      '<p class="account-lead">三个玩法，同一份语料。答完当场判分。</p>' +
      "</section>";

    html += '<section class="account-card"><h2 class="account-card-title">选一个玩法</h2>';
    MODES.forEach(function (m) {
      var r = allowed(m, id);
      html += '<button class="game-mode" type="button" data-game-mode="' + m.id + '"' +
        (r.ok ? "" : ' data-locked="1"') + '>' +
        '<span class="game-mode-main">' +
        '<span class="game-mode-name">' + esc(m.name) + "</span>" +
        '<span class="game-mode-tier">' + esc(Ent.tierLabel(m.tier)) +
        (r.ok ? "" : " · " + esc(Ent.denyReason(m.cap, { tier: id.tier, signedIn: id.signedIn }))) +
        "</span>" +
        "</span>" +
        '<span class="game-mode-desc">' + esc(m.desc) + "</span>" +
        "</button>";
    });
    html += "</section>";

    var locked = MODES.filter(function (m) { return !allowed(m, id).ok; });
    if (locked.length) {
      html += '<section class="account-card"><h2 class="account-card-title">怎么用上</h2>' +
        gateCard(locked[0], id) + "</section>";
    }

    html += '<section class="account-card"><h2 class="account-card-title">这一页的诚实说明</h2>' +
      '<p class="account-hint">' +
      "题目与答案是一起发给浏览器的，界面只是把答案遮住 —— 它是一份" +
      "「先自己想一想再看」的自省工具，<strong>不是防作弊</strong>。" +
      "答对答错都不上传，本地不留记录。" +
      "</p></section>";
    return html;
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
              (r.source ? " · " + esc(r.source) : "") + "</span>" +
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

  function mark(text, chars) {
    var out = "";
    String(text).split("").forEach(function (ch) {
      out += chars.indexOf(ch) >= 0
        ? '<mark class="game-hit">' + esc(ch) + "</mark>"
        : esc(ch);
    });
    return out;
  }

  function renderPaper() {
    var m = modeOf(state.mode);
    var i = state.at;
    var q = state.paper[i];
    if (!q) return "";
    var total = state.paper.length;
    var picked = state.picks[i] || "";

    var done = !!state.graded || !!state.checked[i];

    var html = '<section class="account-card game-head">' +
      '<button class="account-btn ghost game-back" type="button" data-game-back="1">换一个玩法</button>' +
      '<h2 class="account-card-title">' + esc(m.name) + "</h2>" +
      '<p class="account-hint">第 ' + (i + 1) + " / " + total + " 题 · " +
      (state.server === "off" ? "本机判分（服务端没接通）" : "由服务器判分") + "</p>" +
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

    html += '<section class="account-card"><div class="game-nav">' +
      '<button class="account-btn ghost" type="button" data-game-prev="1"' +
      (i <= 0 ? " disabled" : "") + ">上一题</button>" +
      (i < total - 1
        ? '<button class="account-btn" type="button" data-game-next="1">下一题</button>'
        : '<button class="account-btn" type="button" data-game-submit="1">交卷</button>') +
      "</div>" +
      (state.graded
        ? '<p class="account-msg ok">得分 ' + state.graded.right + " / " + state.graded.total +
          "（" + Math.round(state.graded.right / state.graded.total * 100) + " 分）</p>"
        : '<p class="account-hint">卷子里的题与答案一起发出，界面只是把答案遮住。</p>') +
      "</section>";
    return html;
  }

  function render() {
    if (!host || !Q) return;
    var body = state.mode === "fly" ? renderFly()
      : state.mode ? renderPaper()
      : renderHome();

    if (state.mode) {
      body += '<section class="account-card"><button class="account-btn ghost" type="button" ' +
        'data-game-restart="1">' + (state.mode === "fly" ? "换一副令字" : "重抽一副卷子") +
        "</button></section>";
    }
    host.innerHTML = body;
    bind();
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
    var cps = corpus();
    var bank = Q.buildBank(cps, { perPoem: 1, options: 4 });
    var size = mode === "paper" ? 8 : 5;

    var seed = String(Math.floor(Date.now() / 60000));
    state.paper = Q.paper({ bank: bank, size: size, seed: seed + ":" + mode });
    state.at = 0;
    state.picks = state.paper.map(function () { return ""; });
    state.checked = state.paper.map(function () { return false; });
    state.graded = null;
    render();
  }

  function refreshPaper(modeId) {
    var touched = state.picks.some(function (p) { return !!p; });
    if (!touched && !state.graded) startPaper(modeId);
  }

  function start(modeId) {
    var m = modeOf(modeId);
    if (!m) return;
    var id = identifier();
    if (!allowed(m, id).ok) { render(); return; }
    state.mode = modeId;

    if (modeId === "fly") { startFly(); } else { startPaper(modeId); }
    ensureCorpus().then(function () {
      if (state.mode !== modeId) return;
      if (modeId === "fly") { startFly(state.level); } else { refreshPaper(modeId); }
    });
  }

  function submit() {
    var right = 0;
    var jobs = state.paper.map(function (q, i) {
      var chosen = state.picks[i] || "";

      return judge({
        kind: state.mode, bankId: q.id, poemId: q.poemId, chosen: chosen
      }).then(function (r) {
        var ok = r && r.body ? r.body.ok : Q.grade(q, chosen).ok;
        if (ok) right += 1;
        return ok;
      });
    });
    return Promise.all(jobs).then(function () {
      state.graded = { right: right, total: state.paper.length };
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
      if (back) { state.mode = ""; render(); return; }

      var cl = hit("data-game-close");
      if (cl) { close(); return; }

      var mode = hit("data-game-mode");
      if (mode) {
        var mid = mode.getAttribute("data-game-mode");
        if (mode.getAttribute("data-locked")) return;
        start(mid);
        return;
      }

      var lv = hit("data-game-level");
      if (lv) { startFly(lv.getAttribute("data-game-level")); return; }

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
        if (!q || state.graded) return;
        state.picks[state.at] = q.options[k];

        state.checked[state.at] = true;
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
      if (rst) { state.mode === "fly" ? startFly() : startPaper(state.mode); return; }
    };
  }

  function openPoem(id) {
    if (!id) return;
    var ev = new CustomEvent("poems:open", { detail: { id: id }, cancelable: true });
    document.dispatchEvent(ev);
  }

  function close() {
    if (!host) return;
    state.mode = "";
    host.hidden = true;
    if (viewEl) viewEl.hidden = false;
    paintHeader(null);
    paintBack();
    window.scrollTo(0, 0);
  }

  function paintHeader(mode) {
    var C = window.SiteChrome;
    if (!C) return;
    if (!mode) { C.setPage(""); C.setSub(""); return; }
    C.setPage("试题模拟");
    C.setSub("飞花令 · 试题模拟 · 题库复习");
  }

  function paintBack() {
    var C = window.SiteChrome;
    if (!C || !C.setPageAction) return;
    if (!host || host.hidden) { C.setPageAction(null); return; }
    C.setPageAction({
      label: "返回诗词列表",
      onclick: function () { close(); }
    });
  }

  function open() {
    if (!host) return;
    if (viewEl) viewEl.hidden = true;
    host.hidden = false;
    state.mode = "";
    render();
    paintHeader(true);
    paintBack();
    ensureCorpus().then(function () {

      if (state.mode) render();
    });
    window.scrollTo(0, 0);
  }

  function isOpen() { return !!host && !host.hidden; }

  function init() {
    host = document.querySelector('[data-poems-view="game"]');
    viewEl = document.querySelector('[data-poems-view="list"]');
    if (!host) return;
    host.hidden = true;

    var entry = document.querySelector("[data-game-open]");
    if (entry) {
      entry.addEventListener("click", function (e) {
        e.preventDefault();
        if (!capAllowed(GATHERING_CAP, identifier()).ok) { renderEntryGate(); return; }
        open();
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen() && !state.mode) close();
    });
    loadCorpusIntoView();
  }

  function loadCorpusIntoView() {
    ensureCorpus().then(function () {  });
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
