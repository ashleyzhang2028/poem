(function () {
  "use strict";

  var Ent = window.Entitlement;
  var Q = window.Quiz;

  var GATHERING_CAP = "exam.gathering";

  var Ex = window.Exam;

  // 玩法卡：飞花令 + 考试层的三种形态（练习 / 模拟 / 正式）。
  // 三种形态的旋钮（门槛 / 限时 / 判分时机 / 题量档）都从 js/exam.js 的
  // VARIANTS 来 —— 这里再列一份就迟早会对不上。
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
    // 考试层的卷面设置（范围 × 题量）：进去之后默认「全部 · 该形态的默认题量」。
    setup: { scope: "all", size: 0 },
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

  // 集子清单：`id` 与 `data/site-index.js` 的 `SITE_BOOKS` 逐字相同
  // （考试层的 scope 名单取自 SITE_BOOKS，这边靠 id 把语料归到集子上）。
  // 加第十二部时三处一起加：SITE_BOOKS、library 的 ENTRIES、这里。
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

  // 每条都打上所属集子（`book`）—— 考试层的范围（scope）靠它筛。
  // 课内那一批的 `POEMS_ALL` 本身没有 book 字段，在这里补成 "poems"；
  // 集子那几部按 WANTED 的 id 打标（id 与 SITE_BOOKS 同源）。
  function corpus() {
    var out = (window.POEMS_ALL || []).map(function (p) {
      return p && p.book ? p : tag(p, "poems");
    });
    WANTED.forEach(function (w) {
      var list = window[w.v];
      if (list && list.length) {
        out = out.concat(list.map(function (p) { return tag(p, w.id); }));
      }
    });
    return out;
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

  function gateCard(mode, id) {
    var r = capAllowed(mode.cap, id);
    if (r.ok) return "";

    var why = Ent.denyReason(mode.cap, { tier: id.tier, signedIn: id.signedIn });
    return '<div class="game-gate">' +
      '<p class="game-gate-why">' + esc(why) + "</p>" +
      (id.signedIn
        ? '<p class="account-hint">层级由管理员在后台按账号发放。这一页的说明与对照见 <a href="/plans/">四种用户对比</a>。</p>'
        : '<button class="account-btn" type="button" data-game-go="/login/">用邮箱建一个账号</button>') +
      "</div>";
  }

  function renderEntryGate() {
    if (!host) return;
    var id = identifier();
    host.innerHTML = '<section class="account-card">' +
      '<h2 class="account-card-title">古诗词大会</h2>' +
      '<p class="account-lead">这一项是《古诗词大会》的集子，与考试（模拟 / 正式）分开。</p>' +
      gateCard({ cap: GATHERING_CAP }, id) +
      '<button class="account-btn ghost" type="button" data-game-close="1">返回诗词列表</button>' +
      "</section>";
    host.hidden = false;
    if (viewEl) viewEl.hidden = true;
    // 拦住用户时**也算「站在大会这一层」**：底栏正中间那一格照亮点，
    // 不然从底栏点进来只会看到「课外」亮着、右边冒出一张卡，
    // 像点错了地方。抬起头的标题同样换成「古诗词大会」（卡片上就是这几个字）。
    setDockNav("game");
    paintHeader(true);
    bind();
    paintBack();
  }

  function renderHome() {
    var id = identifier();

    var html = '<section class="account-card">' +
      '<h2 class="account-card-title">古诗词大会</h2>' +
      '<p class="account-lead">飞花令与三种形态的考试，同一份语料。' +
      '练习与模拟答完当场判分，正式考试交卷后统一批。</p>' +
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
      "模拟与正式考试的卷面记录只存在本机、<strong>不上云</strong>，" +
      "答错也<strong>不影响</strong>每日复习计划；只报「这次几题对几题」，" +
      "不是古诗词水平评估。" +
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

  // 卷面设置：范围 × 题量（形态在上一层的玩法卡里选）。
  function renderSetup() {
    // 设置这一层是「考试三形态共用的一层」：形态在 state.pending 上，
    // state.mode 只是 "setup" 这个层名 —— 别拿它去查形态表（查不到）。
    var m = modeOf(state.pending);
    var v = variantOf(state.pending);
    if (!m || !v) return "";
    var sizes = v.sizes || [];
    if (sizes.indexOf(state.setup.size) < 0) state.setup.size = v.size;

    var html = '<section class="account-card game-head">' +
      '<button class="account-btn ghost game-back" type="button" data-game-back="1">换一个玩法</button>' +
      '<h2 class="account-card-title">' + esc(m.name) + "</h2>" +
      '<p class="account-hint">' + esc(m.desc) +
      (v.timed ? " · 限时 " + v.minutes + " 分钟" : "") + "</p>" +
      "</section>";

    html += '<section class="account-card"><h2 class="account-card-title">考什么范围</h2>' +
      '<div class="account-field">' +
      '<label class="account-label" for="game-scope">范围</label>' +
      '<select class="account-input" id="game-scope">' +
      scopeList().map(function (sc) {
        return '<option value="' + esc(sc.id) + '"' +
          (sc.id === state.setup.scope ? " selected" : "") + ">" +
          esc(sc.name) + "（" + sc.count + " 条）</option>";
      }).join("") +
      "</select></div>" +
      '<p class="account-hint">名单从全站集子自己算出来 —— 加一部集子，这里就多一个范围。</p>' +
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

    // 正式考试交卷前不给对错 —— 判据在这里，不在界面上自己判。
    var reveal = v.judge !== "after";
    var done = !!state.graded || (reveal && !!state.checked[i]);

    var html = '<section class="account-card game-head">' +
      '<button class="account-btn ghost game-back" type="button" data-game-back="1">换一个玩法</button>' +
      '<h2 class="account-card-title">' + esc(m.name) + "</h2>" +
      '<p class="account-hint">第 ' + (i + 1) + " / " + total + " 题 · " +
      esc(scopeName(state.setup.scope)) +
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
      // 只是「记住了哪一句」这一类出处信息，不是答案，交卷前也给。
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
    } else if (state.mode && state.mode !== "setup") {
      // 考试进行中给一条回设置的路（换范围 / 换题量重抽）；设置那一层自己就是那一层。
      body += '<section class="account-card"><button class="account-btn ghost" type="button" ' +
        'data-game-reset="1">回到卷面设置</button></section>';
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

  // 抽卷：范围 × 形态 × 题量交给内核（js/exam.js），这里只管把题摆出来。
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
    // 语料里凑不够题量时如实说，不假装卷子有那么多题。
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
        submit();  // 到点自动交卷
        return;
      }
      // 只刷新那一行「剩余 mm:ss」，不重画整页（重画会把选项状态抖掉）。
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
    state.setup = { scope: "all", size: 0 };
    state.setupNotice = "";

    if (modeId === "fly") {
      state.mode = "fly";
      startFly();
      ensureCorpus().then(function () {
        if (state.mode === "fly") startFly(state.level);
      });
      return;
    }

    // 考试层的三种形态都要先过「卷面设置」这一层。
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

    // 先本机批一份（`Ex.batch` 是判据的唯一一处）；服务端接通时，逐题用它的结论覆盖。
    var graded = Ex.batch(state.paper, state.picks);

    var jobs = state.paper.map(function (q, i) {
      return judge({
        // 服务端只认 fly / paper / review 三种题型；考试三形态都走 paper 这一支。
        kind: "paper", bankId: q.id, poemId: q.poemId, chosen: state.picks[i] || ""
      }).then(function (r) {
        return r && r.body ? !!r.body.ok : null;
      });
    });

    return Promise.all(jobs).then(function (oks) {
      oks.forEach(function (ok, i) {
        if (ok === null) return;  // 服务端没接通：留着本机那一份
        graded.rows[i].ok = ok;
      });
      graded.right = graded.rows.filter(function (r) { return r.ok; }).length;
      graded.wrong = graded.total - graded.right;
      graded.text = graded.total
        ? "这次 " + graded.total + " 题对 " + graded.right + " 题"
        : "这一卷没有题目";

      state.graded = graded;
      // 记录只在「留记录」的形态上写（正式考试中途退出不评分不留记录）。
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

  function readSetup() {
    var sel = $("#game-scope");
    if (sel) state.setup.scope = sel.value || "all";
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
        // 卷面设置那一层退回玩法卡；考试进行中退回设置（重选范围 / 题量）。
        if (state.mode === "setup") { state.mode = ""; state.pending = ""; }
        else { state.mode = "setup"; readSetup(); }
        render();
        return;
      }

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

      var sz = hit("data-game-size");
      if (sz) { readSetup(); state.setup.size = Number(sz.getAttribute("data-game-size")); render(); return; }

      var beg = hit("data-game-begin");
      if (beg) { readSetup(); beginExam(); return; }

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
        // 正式考试选完不复盘（交卷才批）；练习与模拟选完立刻说对错。
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

    // 范围下拉是原生 select，改一次就记一次（重画时不会丢）。
    var scopeSel = $("#game-scope");
    if (scopeSel) scopeSel.onchange = function () { readSetup(); };
  }

  function openPoem(id) {
    if (!id) return;
    var ev = new CustomEvent("poems:open", { detail: { id: id }, cancelable: true });
    document.dispatchEvent(ev);
  }

  function close() {
    if (!host) return;
    stopTimer();
    state.mode = "";
    host.hidden = true;
    setDockNav("poems");
    // 从底栏进来的那一条（`/poems/?game=1`）退出时把参数抹掉 ——
    // 不抹的话地址栏留着 `game=1`：用户一刷新，这一层**又自己掀开**，
    // 可方才明明是「返回诗词列表」退出来的。
    // 用 `replaceState` 而不是重新 `location.href`：**不刷新**、
    // 不丢列表滚动位置，只把那一个参数从地址栏上摘掉。
    dropGameParam();
    if (viewEl) viewEl.hidden = false;
    paintHeader(null);
    paintBack();
    window.scrollTo(0, 0);
  }

  function paintHeader(mode) {
    var C = window.SiteChrome;
    if (!C) return;
    if (!mode) { C.setPage(""); C.setSub(""); return; }
    C.setPage("古诗词大会");
    C.setSub("飞花令 · 题库复习 · 模拟考试 · 正式考试");
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
    setDockNav("game");
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

  // ---------------------------------------------------------------------
  // 底栏那一格：掀开 / 收起时**就地**把它点亮 / 灭掉（Issue #342）
  // ---------------------------------------------------------------------
  // 大会是 `/poems/` 里就地叠的一层，地址栏不动 —— 可底栏正中间那一格
  // 必须跟着亮，不然用户点了「大会」，底栏还亮着「课外」，像没反应。
  //
  // 做法：改 `body[data-nav]`，再喊 `SiteChrome.setDock()` 重画。
  // 👉 **不写第二套「谁亮」的规则**：`dockKey()` 里 `game → game`
  //    一条就够，底栏那 5 个 `<button>` 一个都不用碰。
  // 👉 退出时**必须还原成 `poems`**（那一页原本的 `data-nav`）——
  //    留着 `game` 的话，回到诗词列表底栏仍然点着「大会」。
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

    // 底栏中间那一格（`/poems/?game=1`）进来时要**当场把这层掀开** ——
    // 不然用户点「大会」只落到诗词列表，还得再找一次那颗键。
    //
    // ⚠️ 先过权限：`exam.gathering` 是 Max 的门。不够就画那张「为什么点不动」
    //    的卡（`renderEntryGate`），**不弹层、也不什么都不做** ——
    //    底栏那颗键谁都看得见，得给个说法。
    if (wantsGame()) {
      if (!capAllowed(GATHERING_CAP, identifier()).ok) renderEntryGate();
      else open();
    }

    loadCorpusIntoView();
  }

  // 把地址栏上的 `game=1` 摘掉（不动历史、不刷新）。
  // 只有从底栏那条路进来过才有得摘；裸 `/poems/` 上它是一个无操作。
  function dropGameParam() {
    var loc = window.location;
    if (!wantsGame()) return;
    if (!window.history || !window.history.replaceState) return;
    var q = loc.search.replace(/^\?/, "").split("&").filter(function (kv) {
      return kv !== "" && kv !== "game=1";
    });
    var next = loc.pathname + (q.length ? "?" + q.join("&") : "") + (loc.hash || "");
    try { window.history.replaceState(window.history.state, "", next); } catch (e) { }
  }

  // 地址栏里有没有 `game=1`（`/poems/?game=1#…` 也算）。
  // 只看这一个参数，别的一概不管 —— 底栏那颗键是它唯一的发出者。
  function wantsGame() {
    var q = (window.location && window.location.search) || "";
    return /(?:^|[?&])game=1(?:&|$)/.test(q);
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
