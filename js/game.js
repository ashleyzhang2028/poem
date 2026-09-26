(function () {
  "use strict";

  var Ent = window.Entitlement;
  var Q = window.Quiz;

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

  function renderHome() {
    var id = identifier();

    // ⚠️ 这一页是**飞花令 + 试题/**模拟/考试**那一页（Issue #356 用户的定调：
    //    「我说的古诗词大会这个页面就是模拟和考试页面，不是古诗词大会集子」）。
    //    所以：
    //      · 页面上**没有诗词列表、没有阅读器**（`/dahui/index.html` 上不挂那两个
    //        挂载点），一屏全是玩法卡 —— 想读诗词的请去 `/poems/`；
    //      · **没有一道「整页的集子闸」**：不放行的那一档，画的也是这一页
    //        （玩法卡各自标着门槛），与「集子访问」是两件事。集子归 `/library/`；
    //      · **页面上不摆任何说明卡**：从前那两张（页头「这一页是飞花令与考试
    //        —— 题目、模拟、正式考试都在这里……」与页底「这一页的诚实说明」）
    //        已按用户原话整段删除，一进页面就是玩法卡。
    //
    // ⚠️ 四个玩法**各自是一张卡**（用户 2026-09-26 原话：「飞花令四种玩法各自
    //    一个卡片」）。从前它们是同一张卡里的四个按钮 —— 每张卡自带 `.account-card`
    //    的背景、圆角与阴影，四张卡之间由 `.poems-game` 的 `gap` 留缝。
    //    顺带一处**真 bug** 跟著消失：`renderHome()` 从前画的是
    //    `<section class="account-card">`，四个按钮则靠 `.game-mode` 自己的
    //    `margin-bottom: 8px` 相间 —— 而 `:last-child` 那条把它在卡底归零，
    //    于是「卡内按钮之间」有缝、「卡底那颗按钮与这张卡的边缘」没有。
    //    现在一颗按钮一张卡，缝只有一处（父层的 `gap`）。
    var html = '';
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

    // 未登录时页底**只留那颗登录键**（Issue #356 用户原话：
    //   「如果需要登录，页底只显示那个登录 按钮即可，不要额外一张卡片，
    //     然后卡片里只有一个 登录 按钮」）。
    //    所以即使没登录也**不另开一张卡**：那颗键直接摆在这一层里
    //    （`&lt;section&gt;` 的兄弟），与玩法卡之间隔着同一个 `gap` ——
    //    用户 2026-09-26 又补了一句：「登录按钮和卡片要有 gap 间隔，
    //    而不是完全没有 margin」（从前的写法是 `.account-btn + .account-btn`
    //    的 `margin-top`，它答的是「两颗按钮之间」，答不了「按钮与卡片之间」）。
    //    已经登录、只是层级不够的，这里不出任何按钮 —— 那件事归玩法卡上
    //    那句「层级不够」，页面不摆第二张卡去重复它。
    if (!id.signedIn) {
      html += '<button class="account-btn" type="button" data-game-go="/login/">登录</button>';
    }
    return html;
  }

  // 玩法卡上那颗门槛小标：**已经能用的说层级名字，用不上的说「X 可用」**。
  //
  // ⚠️ 用户 2026-09-26 原话：「pro 登录可用，直接改成 Pro 可用 和 Max 可用」。
  //    从前写的是「Pro · 登录可用」—— 前半截是层级、后半截是**拒绝原因**
  //    （`Entitlement.denyReason()` 给的「登录可用」），叠在一起就成了
  //    「Pro · 登录可用」这种要把两件事连起来读才懂的短语。
  //    现在一处只念一件事，两个词形：
  //      · 放行（`r.ok`）→ 说这张卡要哪一档：「Max」/「Pro」/「Free」；
  //      · 拦住 → 「Max 可用」/「Pro 可用」（层级不够）或「登录可用」（没登录）。
  //    ⚠️ 「登录可用」那句**照抄 `denyReason()`**，第二个词形在这里拼 ——
  //       一句话的出处只许有一处（页面不自造），而 `denyReason()` 给层级那一档
  //       的原话是「Max 起」（用户不要这个说法）。所以：登录那一档直接用它，
  //       层级那一档只用它认层级（`cap(...).minTier`），说法换成「X 可用」。
  //    ⚠️ 层级取自**能力本身**（`r.minTier` / `Ent.cap(m.cap).minTier`），
  //       不是玩法表上那个 `tier` 字面量 —— 玩法表那份与 `Entitlement.CAPS`
  //       是两处，两处对不上时以**权益表**为准（它才是判行不行的那一处，
  //       `api/_lib/core.js` 同源）。
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

  // 句子的来源尾巴：`js/quiz.js` 的 `sourceOf()` 在集子那几部上给的是**book id**
  // （`poems` / `jinxiandai` / `tianshi` ……），直接摆出来是「《渔家傲·秋思》·
  // poems · 宋 · 范仲淹」—— 用户看不懂那个 `poems`。
  // 这里把开头的那个 id 换成集子的中文名（`data/site-books.js` 是名单的唯一来源）。
  // ⚠️ 只换**第一段**、且只在它与某个 book id 逐字相同时换：`gradeGroup`
  //    （「三年级上」）与 `selection`（卷次）照旧原样过去，不乱动。
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

  // 点飞花令里的一句 → 去那一篇的详情页。
  //
  // ⚠️ 两条路，按**这个页面上有没有阅读器**分（Issue #356 拆页之后才有的第二种）：
  //    · `/poems/` 上：`poems/index.html` 里挂着 `js/poems.js` 的阅读器，
  //      发一声 `poems:open` 就地叠上去（老路，一个字没改）；
  //    · `/dahui/` 上：这一页**只有题，没有列表也没有阅读器**（用户的要求），
  //      于是带着篇目 id 走 `/poems/?poem=<id>` —— 详情页仍在诗词页那一层，
  //      不在这里冒出来。`?poem=` 这个深链口径与首页 `/` 的同名参数一致。
  function openPoem(id) {
    if (!id) return;
    // 判据是「这一页有没有阅读器」，**不看有没有监听者**：
    // `dispatchEvent()` 的返回值只回答「有没有人 preventDefault 过」，
    // 而 `js/poems.js` 那一处监听是「收到就开」，它并没拦 —— 拿返回值当判据
    // 会把「有人开、且开成了」误判成「没人接」，于是紧跟着又跳一次页。
    if (!hasReader()) { location.href = "/poems/?poem=" + encodeURIComponent(id); return; }
    var ev = new CustomEvent("poems:open", { detail: { id: id }, cancelable: true });
    document.dispatchEvent(ev);
  }

  // 这一页上有没有「就地铺开阅读器」的那一层（`/poems/` 有，`/dahui/` 没有）。
  // 判据只有一处：那个挂载点在不在。独立页不摆它，于是自然走外链，
  // **不靠路径名去猜**（猜路径的代码，换一次目录名就得跟着改）。
  function hasReader() {
    return !!document.querySelector('[data-gw="reader"]');
  }

  function close() {
    if (!host) return;
    stopTimer();
    state.mode = "";
    setDockNav("poems");
    // 独立页（`/dahui/`）：**退出去**，回诗词列表。
    // 这里不能走「收起一层」那条路 —— 那一层的底下就是这一页自己的题，
    // 收起来只剩一张白纸；而用户要的正是「大会自己是一页」。
    if (standalone()) { location.href = "/poems/"; return; }
    host.hidden = true;
    showList(true);
    paintHeader(null);
    paintBack();
    window.scrollTo(0, 0);
  }

  // 抬头那一行字：独立页**写在 HTML 上**（`data-page` / `data-sub`），
  // 一进页面就是对的 —— 这里不必再画一遍，收起时也没什么好清（这一页就是它）。
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
    if (standalone()) return;
    if (!host || host.hidden) { C.setPageAction(null); return; }
    C.setPageAction({
      label: "返回诗词列表",
      onclick: function () { close(); }
    });
  }

  // 掀开 / 收起这一层时，**列表的显示也一并管住**。
  //
  // ⚠️ 为什么要单独写一句（Issue #356）：`#gw-list` 是 `.list`，而
  //    `css/style.css` 里 `.list { display: flex }`（1024px 起 `display: grid`）——
  //    元素上的 display 比浏览器默认样式表里给 `[hidden]` 的 `display: none`
  //    优先级高，于是从前的 `viewEl.hidden = true` **看着设了、其实没藏住**：
  //    大会那一层铺在 237px 处，底下 14879px 的诗词列表照旧摊着 ——
  //    用户看到的就是「首页还是普通古诗词列表」（报告原话）。
  //    藏的这一句是**声明式**的（`.list:where([hidden])` 与新写的
  //    `.poems-game:not([hidden]) ~ #gw-list[hidden]` 两条），JS 不自己摸
  //    `style.display` —— 就地改 style 会与「阅读器关上再回来」的整页重画打架。
  function showList(on) {
    // 独立页上没有那张列表（`/dahui/` 只有题），这就是一条无操作。
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

    // 老地址（`/poems/?game=1`）改道 `/dahui/`。
    // 这一条只为**已经发出去的链接**留着（底栏、README、用户存的 `#1` 都改成
    // `/dahui/` 了，可外面点进来的旧链接还在）。它是**跳转**，不是兼容层：
    // 那一层不在这里掀，掀开的那一页是 `/dahui/`。见 §4.72。
    if (wantsGame() && !standalone()) { location.replace("/dahui/"); return; }

    // 独立页（`/dahui/`）：这一页**就是**大会，进来即铺开 —— 没有「先落列表
    // 再找键」这一步，也没有「收起一层」这个状态。
    if (standalone()) {
      open();
      loadCorpusIntoView();
      return;
    }

    // ⚠️ 从前的 `[data-game-open]`（`/poems/` 工具条上那颗「就地掀层」的键）
    //    随拆页一起没了：那一页上那颗现在是**一条去 /dahui/ 的链接**，
    //    掀层这件事不存在了，这一段监听也就没有对象可挂，删掉。
    //    这一页真正的入口只有一条路：进来就铺开（上面 `standalone()` 那一段）。

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen() && !state.mode) close();
    });

    loadCorpusIntoView();
  }

  // 这一页是不是「大会自己的一页」（`/dahui/`）。
  //
  // ⚠️ 判据取 `body[data-nav="game"]` 一处 —— 底栏「谁亮」用的也是它
  //    （`js/chrome.js` 的 `dockKey`），两处同源，不另立一个标记。
  //    隐藏的后果是真正的差别：独立页上「收起一层」无处可收（底下就是这一页
  //    自己的题），退出去只有一条路 —— 回 `/poems/`。
  function standalone() {
    return !!(document.body && document.body.getAttribute &&
      document.body.getAttribute("data-nav") === "game");
  }

  // 地址栏里有没有 `game=1`（`/poems/?game=1#…` 也算）—— 老地址的记号。
  //
  // ⚠️ 从前的 `dropGameParam()`（退出时把参数从地址栏摘掉）**已经删了**：
  //    那是「就地叠层」时代的补丁（不摘的话一刷新那层又自己掀开）。
  //    大会有了自己的页（`/dahui/`）之后，地址栏上没有参数可摘，
  //    这个函数就成了一段没人调的死代码。
  //    这一条判据留着只有一个用处：把老地址**改道**去 `/dahui/`。
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
