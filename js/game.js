(function () {
  "use strict";

  var Ent = window.Entitlement;
  var Q = window.Quiz;

  var Ex = window.Exam;

  var MODES = [
    {
      id: "fly", cap: "feihualing", tier: "max",
      name: "飞花令",
      desc: "给一个令字，写出带此字的诗词",
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
        setup: { scope: "all", size: 0, scopeChosen: false },   // open() / applyDefaultScope() 里落到「小学」
        scopes: [],
    scopeOpen: true,
    flyRound: 0,
    // 飞花令两种形态（用户 2026-09-30 P4）：
    //   "look" 从前的「查一查」—— 选字 → 一次性看全部命中句，一个字都不改；
    //   "level" 新的「闯关」—— 一个令字一关，自己写一句、写不出就断在那儿。
    flyKind: "look",
    lvPool: [],
    lvChars: [],
    lvAt: 0,
    lvRound: 0,
    lvDone: [],
    lvLeft: 0,
    lvTimer: null,
    lvDeadline: 0,
    lvMsg: "",
    lvMsgOk: false,
    lvStreak: 0,
    lvBest: 0,
    left: 0,
    timer: null,
    overlayId: "",
    historyRecords: null,
    historyError: ""
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
    { id: "changshi",   file: "data/poems-changshi.js",   v: "POEMS_CHANGSHI" },
    { id: "mingshu",    file: "data/poems-mingshu.js",    v: "POEMS_MINGSHU" },
    /* Issue #399：历代名家拆两部 */
    { id: "mingren",    file: "data/poems-mingren-cn.js",      v: "POEMS_MINGREN_CN" },
    { id: "mingren-waiguo", file: "data/poems-mingren-foreign.js", v: "POEMS_MINGREN_FOREIGN" }
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

  // 大会内所有题型的**默认范围是「小学」**，不是「全部」（用户 2026-09-30：
  // 「古诗词大会内的所有题型，默认范围为小学，而不是全部」）。
  // 只在这里写一次，飞花令的选字 / 看答案 / 作答、三个题型的卷子
  // 都从 state.setup.scope 走，所以「默认」只有这一个出处。
  var DEFAULT_SCOPE = "poems:primary";

  // 语料里有没有「小学」这一档 —— 课内诗词语料没加载出来时（例如大会页上
  // 只预缓存了集子），照旧退回「全部」，免得一进来就是一份空卷子。
  function defaultScope(cps) {
    if (!Ex || !Ex.select) return "all";
    try {
      var hit = Ex.select(cps || corpus(), DEFAULT_SCOPE);
      if (hit && hit.length) return DEFAULT_SCOPE;
    } catch (e) {  }
    return "all";
  }

  // 落到 state.scopes 上：首页那 15 行清单里「小学」那一格要是亮的，
  // 否则说明行写着「小学（119 篇）」、格子上却是空的，同一件事两个说法。
  function applyDefaultScope() {
    var sc = defaultScope(corpus());
    state.setup.scope = sc;
    state.setup.scopeChosen = sc !== "all";
    state.scopes = sc === "all" ? [] : [sc];
  }

  // 按当前范围过滤语料：飞花令的**选字、看答案、以及「这一关有几句」**
  // 都走这一份（否则「选了小学」只是摆设）。
  //
  // ⚠️ 判**作答**不在这里 —— 见 answerCorpus()。范围管的是「出什么题」，
  // 不管「你能想起哪一句」：令字是风，你在小学范围里闯关，可你想起的是
  // 「春风不度玉门关」（王之涣《凉州词》，只在乐府集里）。拿范围去卡作答，
  // 就会把一句真诗判成「合集里没有」——那不是飞花令，那是背范围。
  function scopedCorpus() {
    var cps = corpus();
    if (!Ex || !Ex.select) return cps;
    try {
      var out = Ex.select(cps, state.setup.scope);
      return (out && out.length) ? out : cps;
    } catch (e) { return cps; }
  }

  // 判作答用的语料：**整份语料**，不分范围（用户 2026-09-30 裁决）。
  // 「我的初始出题范围确实是目标范围内的令字，但我的回答可以超出当前范围
  //   吧，否则没法回答了」——对。范围收的是令字（题），作答是用户背过的句子
  //  （答）。真飞花令也是这个理：令字定死，答的那一句从你记得的诗词里来，
  //  没人管你背的那首在不在课本里。
  // 语料要是整份都为空（各集子脚本都没加载出来），退回 scopedCorpus() ——
  // 至少还能按当前范围判，别判成「一句都不认得」。
  function answerCorpus() {
    var cps = corpus();
    return (cps && cps.length) ? cps : scopedCorpus();
  }

  function poemById(id) {
    var cps = corpus();
    for (var i = 0; i < cps.length; i++) if (cps[i] && cps[i].id === id) return cps[i];
    return null;
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

  var SOUND_KEY = "poem_sound_v1";

  function soundOn() {
    try {
      var v = localStorage.getItem(SOUND_KEY);
      return v == null ? true : v !== "0";
    } catch (e) { return true; }
  }

  var audioCtx = null;
  // Web Audio 合成，不带音频文件；答对是上扬双音，答错是低沉单音。
  function playSound(ok) {
    if (!soundOn()) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === "suspended") audioCtx.resume();
      var t0 = audioCtx.currentTime;
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.connect(g);
      g.connect(audioCtx.destination);
      o.type = "sine";
      if (ok) {
        o.frequency.setValueAtTime(880, t0);
        o.frequency.setValueAtTime(1318.5, t0 + 0.09);
      } else {
        o.frequency.setValueAtTime(220, t0);
      }
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + (ok ? 0.24 : 0.28));
      o.start(t0);
      o.stop(t0 + (ok ? 0.26 : 0.3));
    } catch (e) {  }
  }

  function flashOption(k, ok) {
    var els = $$(".game-opt");
    var el = els[k];
    if (!el) return;
    var cls = ok ? "game-opt-flash-ok" : "game-opt-flash-bad";
    el.classList.add(cls);
    el.addEventListener("animationend", function handler() {
      el.classList.remove(cls);
      el.removeEventListener("animationend", handler);
    });
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

  // 「换令」要真的换一副牌（用户 2026-09-30：「点击换令按钮好像没任何反应」）。
  // 从前的种子是「候选自身」，同一个令字永远同一副牌 —— 于是按钮点下去
  // 算出来的还是原来那两个字，看着就是坏的。种子改由 `state.flyRound`
  // 参与，每点一次 +1，牌就换一副；同一个令字在同一轮里仍然可复现。
  function pickChars(cps, levelId, round) {
    var lv = null;
    for (var i = 0; i < CHAR_LEVELS.length; i++) if (CHAR_LEVELS[i].id === levelId) lv = CHAR_LEVELS[i];
    if (!lv) lv = CHAR_LEVELS[1];
    var all = Q.candidates(cps, { min: lv.min });
    var pool = lv.hard ? all.filter(isHard) : (lv.id === "easy" ? all : all.filter(function (c) { return !isHard(c); }));
    if (!pool.length) pool = all;
    if (!pool.length) return [];

    // **一次给两个字**：单字太难「正好是那个字」，两个字才有「凑一凑」的余地。
    // （这句由 09804fc 写下，后来在一轮「去掉所有注释」的整理里丢了 ——
    // 用户 2026-09-30 因此问「为什么每次出两个令字」。丢了就要补回来。）
    var seed = pool[0] + "|" + pool.length + "|" + Number(round || 0);
    var picked = Q.shuffle(pool, seed)[0] || pool[0];
    var second = Q.shuffle(pool.filter(function (c) { return c !== picked; }), seed + "|b")[0];
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
    } else {
      html += '<button class="account-btn ghost" type="button" data-game-history="1">考试记录</button>';
    }
    return html;
  }

  // 范围那一段。用户 2026-09-26 裁决两件事：
  //   ① 「将范围这么多列表放在一个卡片显示，而不是看上去一个选项一个卡片」——
  //      所以 15 行**收进同一张卡**（`.game-scope-card`）；行里不再各有自己的
  //      边框与圆角，行的边界靠卡内一条细线（`.game-scope-pick { border-top }`）。
  //      「收起」那一颗从前摆在段头（与「范围」同一行），也收进了卡里 ——
  //      段头只有「范围」两个字，卡片管自己那一份清单。
  //   ② 次序（小学 / 初中 / 高中 紧跟全部）由 Exam.scopes() 定，这一层照单摆。
  function scopeRows() {
    var scopes = scopeList().filter(function (sc) {
      return Ex ? Ex.scopeVisible(sc.id) : true;
    });

    var html = '<div class="game-scope-head">' +
      '<p class="poems-home-tag">范围</p>' +
      "</div>";

    html += '<section class="account-card game-scope-card">' +
      '<div class="game-scope-card-head">' +
      pickNote() +
      '<button class="game-scope-all" type="button" data-game-scope-all="1">' +
      (state.scopeOpen ? "收起" : "展开") + "</button>" +
      "</div>" +
      '<div class="game-scope-list"' + (state.scopeOpen ? "" : ' data-folded="1"') + ">" +
      scopes.map(scopePick).join("") +
      "</div></section>";
    return html;
  }

  function pickNote() {
    return '<p class="game-scope-note">' + esc(scopePickNote()) + "</p>";
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

  // 飞花令两段（用户 2026-09-30 裁决）：
  //   ① 令字卡：范围 / 令字 / 命中句数 / 难度（常见字·一般字·难字）**再加换令按钮**
  //      —— 「换令按钮应该在常见字，一般字按钮选项下面显示，一张卡片内」；
  //   ② 「作答」卡（用户 2026-09-30 改名）：卡的标题收成两个字，按钮收成
  //      「回答」，提示文字换成「云深不知处」—— **去掉「照抄」这个引导**：
  //      原来那句在教用户抄一句现成的，而这一格要的是自己想起来的那一句。
  //      （三处旧说法按用户要求不再出现在界面上，测试只扫**渲染模板**、不扫注释，
  //      免得这段说明把测试扫红；要核对原文看 Issue #356 第五轮。）
  //   ③ 看答案**不在这两段里** —— 「看答案按钮应该不需要卡片，显示在页底（其他卡片下面）」。
  function renderFly() {
    return '<div class="game-fly-kind">' + flyKindSeg() + "</div>" +
      (state.flyKind === "level" ? renderFlyLevel() : renderFlyLook());
  }

  // 两种形态并列，旧的那一种照旧是默认（用户裁决：不删旧功能）。
  // 说是「两种形态」而不是「难度」—— 它们答的是不一样的问题：
  // 一个是「合集里有多少句」，一个是「你自己能想起几句」。
  function flyKindSeg() {
    var KINDS = [
      { id: "look", name: "查一查" },
      { id: "level", name: "闯关" }
    ];
    return '<div class="seg mini" id="game-fly-kind" role="group" aria-label="飞花令形态">' +
      KINDS.map(function (k) {
        return '<button type="button" data-game-fly-kind="' + k.id + '"' +
          (k.id === state.flyKind ? ' class="active" aria-pressed="true"' : ' aria-pressed="false"') +
          ">" + esc(k.name) + "</button>";
      }).join("") + "</div>" +
      '<p class="account-hint">' +
      esc(state.flyKind === "level" ? "闯关：写对一句翻下一个字，卡住就断在这儿。" : "查一查：看合集的答案。") +
      "</p>";
  }

  function renderFlyLook() {
    var m = modeOf("fly");
    var cps = scopedCorpus();
    var sum = Q.charSummary(cps, state.chars);

    var html = '<section class="account-card game-head">' +
      '<h2 class="account-card-title">' + esc(m.name) + "</h2>" +
      '<p class="account-hint">范围：' + esc(scopePickLabel(state.setup.scope)) + "</p>" +
      // 令字与拼音：**拼音在上、汉字在下**（用户 2026-09-30 裁决）。
      // DOM 次序就是「拼音 → 汉字」，不靠 CSS 的 order / column-reverse 去翻 ——
      // 读屏念出来也是先音后字，与看到的顺序一致。
      // 拼音空着（表里查不到那个字）也照旧渲染这一行：行高定在 CSS 里，
      // 横排时两字的汉字基线才对得上。
      '<div class="game-chars">' + state.chars.map(function (c) {
        return '<span class="game-char">' +
          '<span class="game-char-py">' + esc(pinyinOf(c)) + "</span>" +
          '<span class="game-char-han">' + esc(c) + "</span>" +
          "</span>";
      }).join("") + "</div>" +
      '<p class="account-hint">' + esc(sum.text) + "</p>" +
      '<div class="seg mini" id="game-level" role="group" aria-label="令字难度">' +
      CHAR_LEVELS.map(function (lv) {
        return '<button type="button" data-game-level="' + lv.id + '"' +
          (lv.id === state.level ? ' class="active" aria-pressed="true"' : ' aria-pressed="false"') +
          ">" + esc(lv.name) + "</button>";
      }).join("") + "</div>" +
      '<button class="account-btn ghost game-fly-restart" type="button" data-game-restart="1">换令</button>' +
      "</section>";

    html += '<section class="account-card"><h2 class="account-card-title">作答</h2>' +
      '<div class="account-field">' +
      '<label class="account-label" for="game-said">你想起来的那一句</label>' +
      '<input class="account-input" id="game-said" type="text" autocomplete="off" ' +
      'placeholder="云深不知处" />' +
      "</div>" +
      '<button class="account-btn" type="button" data-game-say="1">回答</button>' +
      '<p class="account-msg" id="game-said-msg"></p>' +
      "</section>";
    return html;
  }

  // ——— 飞花令「闯关」（Issue #356 P4）———————————————
  //
  // 与「查一查」并排，不动旧的那一条路。玩法借真飞花令的形：
  //   一个字一关 → 限时内自己写一句 → 对了翻下一个字，连对累计；写不出就断。
  // 两处「鼓励口吻」（与成绩横幅同一套：只说「再试试 / 先放着」，不出现
  // 「失败」这类否定字眼）：倒计时到了不是判错，是「这一关先放着」；
  // 卡住了给一句提示，不给答案。
  var LEVEL_SECONDS = 45;
  var LEVEL_HINT_AFTER = 20;

  function levelLeftText() {
    var n = Math.max(0, Math.ceil(state.lvLeft / 1000));
    var mm = Math.floor(n / 60);
    var ss = n % 60;
    return mm + ":" + (ss < 10 ? "0" : "") + ss;
  }

  function levelAt() { return state.lvChars[state.lvAt] || ""; }

  // 一关的句库：语料里带这一个字的所有句。
  // 短到判不过的那几条（「水」「水长流」这种从长句里切出来的碎段）不要 ——
  // 它们留着只会变成一句「照抄还判我太短」的坑（Q.passable 与判分门槛同一个数）。
  function levelPool(char) {
    var hit = Q.flyFlower({ poems: scopedCorpus(), chars: [char] });
    return hit.rows.filter(function (r) { return Q.passable(r.text); })
      .map(function (r) {
        return { id: r.id, title: r.title, text: r.text };
      });
  }

  // 发牌：一个令字一关。种子带 lvRound，所以「换一关」真的换一副牌 ——
  // 与「换令」踩过的是同一个坑（Issue #356 第四轮）：种子若不含会变的东西，
  // 按钮点下去算出来还是同一副牌，看着就是坏的。
  // 所以 lvRound 只增不减：换一关 = 轮次 +1 换牌；「重来」只清零分数。
  function startFlyLevel(keepRound) {
    if (!keepRound) {
      state.lvDone = [];
      state.lvStreak = 0;
      state.lvBest = 0;
      state.lvMsg = "";
      state.lvMsgOk = false;
    }
    state.lvRound += 1;
    state.lvAt = 0;
    state.lvLeft = LEVEL_SECONDS * 1000;
    state.lvDeadline = Date.now() + state.lvLeft;
    var cps = scopedCorpus();
    state.chars = pickChars(cps, state.level, state.lvRound);
    // 挑出来的令字，底下一条能作答的句子都没有 —— 那不是一关，是个死胡同。
    // 往后找下一个字顶上（都不行就留一个空关，renderFlyLevel 会给出「换范围」那条路）。
    var usable = state.chars.filter(function (c) { return levelPool(c).length; });
    state.lvChars = usable.length ? usable : state.chars.slice();
    state.lvPool = levelAt() ? levelPool(levelAt()) : [];
    stopLevelTimer();
    render();
    startLevelTimer();
  }

  function startLevelTimer() {
    if (!levelAt()) return;
    state.lvTimer = setInterval(function () {
      state.lvLeft = Math.max(0, state.lvDeadline - Date.now());
      paintLevelTimer();
      if (state.lvLeft <= 0) {
        stopLevelTimer();
        // 到点是「这一关先放着」，不是判错 —— 分档口吻与成绩横幅一致。
        levelFail("timeout");
      }
    }, 250);
  }

  function stopLevelTimer() {
    if (state.lvTimer) { clearInterval(state.lvTimer); state.lvTimer = null; }
  }

  // 只动倒计时那一条，不整页重画 —— 每秒重画会把输入框里的字抹掉。
  function paintLevelTimer() {
    var num = document.getElementById("game-lv-num");
    if (num) num.textContent = levelLeftText();
    var bar = document.getElementById("game-lv-fill");
    if (bar) {
      bar.style.width = Math.max(0, Math.min(100, Math.round(state.lvLeft / (LEVEL_SECONDS * 10)))) + "%";
      bar.classList.toggle("warn", state.lvLeft <= 10000);
    }
    var hint = document.getElementById("game-lv-hint");
    if (hint && !hint.textContent) {
      var t = levelHintText();
      if (t) hint.textContent = t;
    }
  }

  // 卡住给的提示：不报答案，只说「这一关还有几句别的写法」（说个数，
  // 让用户知道还有戏，而不是只剩「没有」两个字）。数是真的从这一关的句库里数的。
  function levelHintText() {
    if (!levelAt()) return "";
    if (state.lvLeft > (LEVEL_SECONDS - LEVEL_HINT_AFTER) * 1000) return "";
    var n = state.lvPool.length;
    if (!n) return "卡住了？换个范围或换个难度试试。";
    return "卡住了？这一关还有 " + n + " 句能对上，再想想。";
  }

  function levelDoneRow(ok, why) {
    var zh = {
      ok: "对上了",
      empty: "你写了空",
      short: "太短，写整一点",
      nochar: "这一句里没有「" + levelAt() + "」",
      notfound: "合集里没这一句",
      timeout: "这一关先放着"
    };
    return zh[why] || (ok ? "对上了" : "再想想");
  }

  function levelFail(why) {
    state.lvStreak = 0;
    state.lvMsgOk = false;
    state.lvMsg = levelDoneRow(false, why);
    stopLevelTimer();
    render();
    flashChars();
    playSound(false);
  }

  function levelPass(said, row) {
    state.lvDone.push({
      char: levelAt(), text: said, title: (row && row.title) || "", ok: true
    });
    state.lvStreak += 1;
    state.lvBest = Math.max(state.lvBest, state.lvStreak);
    state.lvMsg = "对上了" + (row && row.title ? "：" + row.title : "") + " —— 下一关。";
    state.lvMsgOk = true;
    playSound(true);

    // 还有下一个字：翻过去，倒计时重开；没有就停在最后一关数连对。
    // flashChars() 要放在 render() **之后** —— 闪的是刚渲染出来的那一格；
    // 放在前面闪的是马上要被换掉的旧节点，动画等于没放。
    if (state.lvAt < state.lvChars.length - 1) {
      state.lvAt += 1;
      state.lvLeft = LEVEL_SECONDS * 1000;
      state.lvDeadline = Date.now() + state.lvLeft;
      state.lvPool = levelPool(levelAt());
      render();
      flashChars();
      startLevelTimer();
      return;
    }
    stopLevelTimer();
    // 令字个数是可变的（池子小的时候 pickChars 可能只给一个），别写死「两个字」。
    state.lvMsg = state.lvChars.length + " 个字都过完了，连对 " + state.lvStreak +
      " 句 —— 换一副牌再来。";
    render();
    flashChars();
  }

  // 令字那一格闪一下（答对用 green、答错用 red），与选项的 flashOption 同一套做法。
  function flashChars() {
    var el = document.querySelector(".game-lv-char");
    if (!el) return;
    var cls = state.lvMsgOk ? "game-lv-char-ok" : "game-lv-char-bad";
    el.classList.add(cls);
    el.addEventListener("animationend", function handler() {
      el.classList.remove(cls);
      el.removeEventListener("animationend", handler);
    });
  }

  function checkLevelSaid() {
    var input = $("#game-lv-said");
    if (!input) return;
    var said = input.value.trim();
    // 判作答走 answerCorpus（整份语料），不是当前范围 —— 范围管的是**令字**，
    // 不是你想起的那一句。令字是「风」、范围是小学，你答「春风不度玉门关」
    // （王之涣《凉州词》，只在乐府集里），那是真句子，就得算对。
    var local = Q.judgeSetLine({ poems: answerCorpus(), chars: [levelAt()], said: said });
    if (!local.ok) { levelFail(local.why); return; }

    // 服务器核对优先。判分语料两端口径一致：两边都扫**整份语料**——
    // 范围只用来收窄**令字**（题），不用来收窄**作答**（答）。
    // 从前两端口径不一致：本机按范围判、服务端扫全站，于是「界面说没有、
    // 服务器说对上」各说一套；上一轮是用「服务端 scopeExact=false 就别信它」
    // 打的补丁。这一轮把口径本身統一了，那条补丁就不再是主角。
    // 仍留 scopeExact 一道：服务端认不出这个范围时（scoped() 退全站）它如实
    // 报 false，这时它的「没找到」不足为凭，本机仍按自己那句说话。
    judge({
      kind: "fly", chars: [levelAt()], said: said, scopeId: state.setup.scope
    }).then(function (r) {
      var body = r && r.body;
      if (body && !body.found && body.scopeExact !== false) { levelFail("notfound"); return; }
      var row = local.row;
      if (body && body.title) row = { title: body.title };
      levelPass(said, row);
    });
  }

  function renderFlyLevel() {
    var m = modeOf("fly");
    var at = levelAt();
    // 挑不出令字、或者挑出来的令字底下一条能作答的句子都没有 ——
    // 两条都落到同一个「这个范围挑不出能闯的关」上（不给一个空关）。
    if (at && !state.lvPool.length) at = "";
    if (!at) {
      return '<section class="account-card game-head">' +
        '<h2 class="account-card-title">' + esc(m.name) + " · 闯关</h2>" +
        '<p class="account-hint">这个范围里挑不出能闯的令字 —— 换一个大一点的范围再来。</p>' +
        "</section>" +
        // 这里从前挂的是 data-game-back —— 全场没有这个属性的处理函数，点了没反应。
        // 改成走既有的「回大会首页」那条路（与顶部返回键同一个出口）。
        '<button class="account-btn ghost" type="button" data-game-home="1">换一个题型</button>';
    }

    var html = '<section class="account-card game-head">' +
      '<h2 class="account-card-title">' + esc(m.name) + " · 闯关</h2>" +
      '<p class="account-hint">范围：' + esc(scopePickLabel(state.setup.scope)) +
      " · 第 " + (state.lvAt + 1) + " / " + state.lvChars.length + " 关 · 连对 " + state.lvStreak +
      "（最好 " + state.lvBest + "）</p>" +
      '<div class="game-lv-char">' +
      '<span class="game-char-py">' + esc(pinyinOf(at)) + "</span>" +
      '<span class="game-char-han">' + esc(at) + "</span>" +
      "</div>" +
      '<p class="account-hint">写一句带「' + esc(at) + "」的诗词，对了翻下一个字。</p>" +
      '<div class="game-lv-clock">' +
      '<span class="game-lv-num" id="game-lv-num">' + levelLeftText() + "</span>" +
      '<span class="game-lv-unit">秒</span>' +
      "</div>" +
      '<div class="game-timer-bar"><div class="game-timer-fill" id="game-lv-fill" style="width:' +
      Math.max(0, Math.min(100, Math.round(state.lvLeft / (LEVEL_SECONDS * 10)))) + '%"></div></div>' +
      '<div class="seg mini game-lv-easy" role="group" aria-label="令字难度">' +
      CHAR_LEVELS.map(function (lv) {
        return '<button type="button" data-game-level="' + lv.id + '"' +
          (lv.id === state.level ? ' class="active" aria-pressed="true"' : ' aria-pressed="false"') +
          ">" + esc(lv.name) + "</button>";
      }).join("") + "</div>" +
      '<button class="account-btn ghost game-fly-restart" type="button" data-game-lv-restart="1">换一关</button>' +
      "</section>";

    html += '<section class="account-card"><h2 class="account-card-title">你想起的那一句</h2>' +
      '<div class="account-field">' +
      '<label class="account-label" for="game-lv-said">你想起来的那一句，含「' + esc(at) + '」</label>' +
      '<input class="account-input" id="game-lv-said" type="text" autocomplete="off" ' +
      'placeholder="' + esc(LEVEL_PLACEHOLDER) + '" />' +
      "</div>" +
      '<button class="account-btn" type="button" data-game-lv-say="1">交这一句</button>' +
      '<p class="account-msg ' + (state.lvMsg ? (state.lvMsgOk ? "ok" : "warn") : "") +
      '" id="game-lv-msg">' + esc(state.lvMsg) + "</p>" +
      '<p class="account-hint" id="game-lv-hint">' + esc(levelHintText()) + "</p>" +
      "</section>";

    if (state.lvDone.length) {
      html += '<section class="account-card"><h2 class="account-card-title">这一轮的连对</h2>' +
        '<div class="game-lv-done">' + state.lvDone.map(function (d, i) {
          return '<div class="game-lv-row"><span class="game-lv-row-char">' + esc(d.char) + "</span>" +
            '<span class="game-lv-row-text">' + esc(d.text) + "</span>" +
            (d.title ? '<span class="game-lv-row-src">' + esc(d.title) + "</span>" : "") +
            "</div>";
        }).join("") + "</div>" +
        '<p class="account-hint">连对 ' + state.lvStreak + " 句，最好 " + state.lvBest + " 句。</p>" +
        "</section>";
    }
    return html;
  }

  // 示例句与「作答」卡同一个（「云深不知处」）—— **不能拿这一关句库里的句子当例子**：
  // 那是直接把答案摊给用户看，与「自己想一句」背道而驰（Issue #356 第五轮已把
  // 「整句照抄，例如……」这种引导撤掉，闯关这边不该又造一个）。
  var LEVEL_PLACEHOLDER = "云深不知处";

  // 页底那颗「看答案」：不套卡片（用户 2026-09-30「看答案按钮应该不需要卡片」），
  // 排在页面所有卡片**下面**，答案清单跟着它往下摊。
  function renderFlyReveal() {
    var cps = scopedCorpus();
    var ff = Q.flyFlower({ poems: cps, chars: state.chars });
    return '<div class="game-fly-reveal">' +
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
        : "") +
      "</div>";
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
    if (!on.length) return "全部" + (n == null ? "" : "（" + n + " 篇）");
    if (on.indexOf("all") >= 0) return "全部" + (n == null ? "" : "（" + n + " 篇）");
    var names = on.map(scopeName);
    return names.join(" + ") + (n == null ? "" : "（" + n + " 篇）");
  }

  // 卷面设置：**范围与题量收进同一张卡**，开始按钮从卡里出来、单摆在卡下
  // （用户 2026-09-30：「题库和题量设置应该放在一张卡片内，开始按钮应该从卡片中
  // 脱离出来，单独在卡片下面显示」）。题量段在卡内自带一道细分隔线，与范围分开。
  function renderSetup() {
    var m = modeOf(state.pending);
    var v = variantOf(state.pending);
    if (!m || !v) return "";
    var sizes = v.sizes || [];
    if (sizes.indexOf(state.setup.size) < 0) state.setup.size = v.size;

    var html = '<section class="account-card game-head">' +
      '<h2 class="account-card-title">' + esc(m.name) + "</h2>" +
      '<p class="account-hint">' + esc(m.desc) +
      (v.timed ? " · 限时 " + v.minutes + " 分钟" : "") + "</p>" +
      "</section>";

    html += '<section class="account-card game-setup-card">' +
      '<p class="account-hint">范围：' + esc(scopePickLabel(state.setup.scope)) + "</p>" +
      '<div class="game-setup-size">' +
      '<h2 class="account-card-title">题量</h2>' +
      '<div class="seg mini" id="game-size" role="group" aria-label="题量">' +
      sizes.map(function (n) {
        return '<button type="button" data-game-size="' + n + '"' +
          (n === state.setup.size ? ' class="active" aria-pressed="true"' : ' aria-pressed="false"') +
          ">" + n + " 题</button>";
      }).join("") + "</div>" +
      '<p class="account-hint">' +
      (v.judge === "after"
        ? "交卷批改，退出不评分。"
        : "答完出结果。" + (v.record ? "记录留本地。" : "本地不留记录。")) +
      "</p>" +
      "</div></section>";

    // 开始按钮：脱离卡片，单独落在卡片下方（用户 2026-09-30 裁决）
    html += '<button class="account-btn game-setup-begin" type="button" data-game-begin="1">开始</button>' +
      (state.setupNotice
        ? '<p class="account-msg warn">' + esc(state.setupNotice) + "</p>"
        : "");
    return html;
  }

  // 考试记录：**一张卡**，标题是卡里第一行（用户 2026-09-30）。
  // 从前标题单独占一张卡（`game-head`），下面另起一张装清单 —— 两张卡之间那道
  // 12px 的缝里什么都没有，标题卡看着就是「一块被撑开的空行」。合成一张之后，
  // 标题与清单共用一个 padding，缝自然没了。
  function renderHistory() {
    var id = identifier();
    var html = '<section class="account-card game-head">' +
      '<h2 class="account-card-title">考试记录</h2>';

    if (!id.signedIn) {
      html += '<p class="account-hint">登录后查看。</p>' +
        '<button class="account-btn" type="button" data-game-go="/login/">登录</button>';
      return html + "</section>";
    }
    if (state.historyRecords === null) {
      return html + '<p class="account-hint">读取中……</p></section>';
    }
    if (state.historyError) {
      return html + '<p class="account-msg warn">' + esc(state.historyError) + "</p></section>";
    }
    if (!state.historyRecords.length) {
      return html + '<p class="account-hint">暂无「考试」记录</p></section>';
    }

    html += '<div class="game-history-list">' +
      state.historyRecords.map(function (r) {
        var d = new Date(r.createdAt || 0);
        var when = isNaN(d.getTime()) ? "" : d.toLocaleString("zh-CN", { hour12: false });
        return '<div class="game-history-row">' +
          '<div class="game-history-main">' +
          '<span class="game-history-score">' + esc(r.score) + " / " + esc(r.total) + "</span>" +
          '<span class="game-history-meta">' + esc(r.scopeLabel || "全部") + " · " + esc(when) + "</span>" +
          "</div>" +
          // 「删除」是次要动作：用小一号的次一级按钮，不再跟「开始」「交卷」一个体量
          // （用户 2026-09-30：「删除按钮用次一级的按钮 太大了」）。
          '<button class="mini-btn" type="button" data-game-history-del="' + esc(r.eid) + '">删除</button>' +
          "</div>";
      }).join("") + "</div></section>";
    return html;
  }

  function loadHistory() {
    if (!window.AccountApi || typeof AccountApi.examRecordsMine !== "function") {
      state.historyRecords = [];
      state.historyError = "";
      render();
      return;
    }
    AccountApi.examRecordsMine().then(function (r) {
      if (state.mode !== "history") return;
      if (r && r.ok) {
        state.historyRecords = r.records || [];
        state.historyError = "";
      } else {
        state.historyRecords = [];
        state.historyError = (r && r.message) || "读取失败，稍后再试。";
      }
      render();
    });
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

    var html = state.graded ? renderScoreBanner(state.graded) : "";

    html += '<section class="account-card game-head">' +
      '<h2 class="account-card-title">' + esc(m.name) + "</h2>" +
      '<p class="account-hint">第 ' + (i + 1) + " / " + total + " 题 · " +
      esc(scopePickLabel(state.setup.scope)) +
      (v.timed ? " · 剩余 " + timeLeftText() : "") +
      " · " +
      (state.server === "off" && reveal ? "本地评分（服务端没接通）" : "由服务器评分") + "</p>" +
      (v.timed && !state.graded
        ? '<div class="game-timer-bar"><div class="game-timer-fill" id="game-timer-fill" style="width:' +
          Math.max(0, Math.min(100, Math.round(state.left / Math.max(1, (v.minutes || 1) * 60000) * 100))) +
          '%"></div></div>'
        : "") +
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
          (state.graded.saved ? '<p class="account-hint">卷面记录已留本地。</p>' : "") +
          (state.mode === "formal" && state.graded.cloudSaved
            ? '<p class="account-hint">已存「考试记录」。</p>' : "")
        : '<p class="account-hint">已答 ' + answered + " / " + total + " 题。" +
          (v.judge === "after" ? "交卷后批改。" : "答完立刻显示结果。") + "</p>") +
      "</section>";
    return html;
  }

  var SCORE_BANDS = [
    { min: 90, cls: "gold", title: "太棒了！" },
    { min: 60, cls: "green", title: "不错，继续加油！" },
    { min: 0, cls: "blue", title: "再练一次，会更好" }
  ];

  function scoreBand(pct) {
    for (var i = 0; i < SCORE_BANDS.length; i++) if (pct >= SCORE_BANDS[i].min) return SCORE_BANDS[i];
    return SCORE_BANDS[SCORE_BANDS.length - 1];
  }

  function renderScoreBanner(graded) {
    var pct = graded.total ? Math.round(graded.right / graded.total * 100) : 0;
    var band = scoreBand(pct);
    var shown = state.gradedAnimated ? pct : 0;
    return '<section class="game-score-banner ' + band.cls + '">' +
      '<div class="game-score-num" data-game-score-target="' + pct + '">' + shown + "</div>" +
      '<div class="game-score-unit">分</div>' +
      '<div class="game-score-title">' + esc(band.title) + "</div>" +
      '<div class="game-score-sub">' + esc(graded.right) + " / " + esc(graded.total) + " 题对</div>" +
      "</section>";
  }

  function animateScoreBanner() {
    if (!state.graded || state.gradedAnimated) return;
    var numEl = $(".game-score-num");
    if (!numEl) return;
    state.gradedAnimated = true;
    var target = Number(numEl.getAttribute("data-game-score-target") || 0);
    var t0 = null;
    var dur = 650;
    function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var val = Math.round(target * (1 - Math.pow(1 - p, 3)));
      numEl.textContent = String(val);
      if (p < 1) window.requestAnimationFrame(step);
      else numEl.textContent = String(target);
    }
    window.requestAnimationFrame(step);
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
    else if (state.mode === "history") body = renderHistory();
    else if (state.mode) body = renderPaper();
    else body = renderHome();

    // 飞花令的「看答案」排在页底：所有卡片之后（用户 2026-09-30）。
    // 只在「查一查」形态里给 —— 闯关里把答案清单摊开，这一关就白闯了。
    if (state.mode === "fly" && state.flyKind !== "level") body += renderFlyReveal();
    host.innerHTML = body + (state.overlayId ? renderPoemOverlay(state.overlayId) : "");
    bind();
        paintBack();
    animateScoreBanner();
  }

  // 换一个难度 = 重新开始一副牌，轮次归零；同一档里点「换令」才往前走一轮。
  function startFly(levelId, keepRound) {
    var nextLevel = levelId || state.level;
    if (!keepRound || nextLevel !== state.level) state.flyRound = 0;
    state.level = nextLevel;
    if (state.flyKind === "level") { startFlyLevel(keepRound); return; }
    stopLevelTimer();
    var cps = scopedCorpus();
    state.chars = pickChars(cps, state.level, state.flyRound);
    state.revealed = false;
    render();
  }

  function nextFly() {
    state.flyRound += 1;
    startFly(state.level, true);
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
    state.gradedAnimated = false;
    state.left = (v.minutes || 0) * 60 * 1000;
    state.startedAt = Date.now();
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
    var totalMs = Math.max(1, (v.minutes || 1) * 60 * 1000);
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
      var fill = document.getElementById("game-timer-fill");
      if (fill) {
        fill.style.width = Math.max(0, Math.min(100, Math.round(state.left / totalMs * 100))) + "%";
        fill.classList.toggle("warn", state.left <= 60000);
      }
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
    stopLevelTimer();
    var keepScope = state.setup && state.setup.scopeChosen ? state.setup.scope : "all";
    var keepChosen = !!(state.setup && state.setup.scopeChosen);
    state.setup = { scope: keepScope, size: 0, scopeChosen: keepChosen };
    if (!keepChosen) applyDefaultScope();
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
        : "这一卷无题目";

      state.graded = graded;
      state.gradedAnimated = false;
            if (v.record) {
        state.graded.saved = Ex.saveRecord({
          kind: state.mode, scope: state.setup.scope,
          right: graded.right, total: graded.total
        }).ok;
      }
      // 只有「考试」上云（模拟考试 / 题库不上云，§4.66）
      if (state.mode === "formal" && window.AccountApi && AccountApi.examRecordCreate) {
        var items = graded.rows.map(function (r, i) {
          var q = state.paper[i] || {};
          return { stem: q.stem || "", picked: r.chosen || "", answer: r.answer || "", correct: !!r.ok };
        });
        AccountApi.examRecordCreate({
          scopeId: state.setup.scope,
          scopeLabel: scopePickLabel(state.setup.scope),
          size: graded.total, score: graded.right, total: graded.total,
          durationSec: Math.max(0, Math.round((Date.now() - (state.startedAt || Date.now())) / 1000)),
          items: items
        }).then(function (r) {
          state.graded.cloudSaved = !!(r && r.ok);
          render();
        });
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
    // 判作答扫**整份语料**（answerCorpus），不是当前范围 —— 范围管令字，
    // 不管你能想起哪一句。只是若命中落在范围外，顺带说一句「这一句在
    // 《xxx》里」，让用户知道是从哪儿对上的。
    var local = Q.flyFlower({ poems: answerCorpus(), chars: state.chars }).rows
      .filter(function (r) { return r.text === said; })[0];
    judge({ kind: "fly", chars: state.chars, said: said }).then(function (r) {
      var body = r && r.body;
      var found = body ? !!body.found : !!local;
      var by = body ? "由服务器核对" : "本机核对（服务端没接通）";
      msg.className = "account-msg " + (found ? "ok" : "warn");
      if (!found) {
        msg.textContent = "合集里没有一字不差的一句「" + said + "」 —— " + by + "。";
        return;
      }
      // 对上了就说清是从哪儿对上的；命中在**当前范围之外**（服务端 inScope 明确
      // 为 false）时补一句「不在本范围，但算对」—— 免得用户看见「对上了」
      // 还以为这一句真在自己选的那一册里。
      var title = (local && local.title) || (body && body.title) || said;
      var tail = (body && body.inScope === false)
        ? "（不在" + scopeName(state.setup.scope) + "里，但算对 —— 范围只管令字。）"
        : "";
      msg.textContent = "在合集里对上了：" + title + tail + " —— " + by + "。";
    });
  }

  function bind() {
    if (!host) return;
    host.onclick = function (e) {
      var t = e.target;
      var hit = function (attr) {
        return t && t.closest ? t.closest("[" + attr + "]") : null;
      };

            var closeOverlay = hit("data-game-overlay-close");
      if (closeOverlay) { state.overlayId = ""; render(); return; }

      var history = hit("data-game-history");
      if (history) {
        stopTimer();
        state.mode = "history";
        state.historyRecords = null;
        state.historyError = "";
        render();
        loadHistory();
        return;
      }

      var historyDel = hit("data-game-history-del");
      if (historyDel) {
        var eid = historyDel.getAttribute("data-game-history-del");
        if (eid && window.confirm("删除这条考试记录？") && window.AccountApi && AccountApi.examRecordDelete) {
          AccountApi.examRecordDelete({ eid: eid }).then(function (r) {
            if (r && r.ok && Array.isArray(state.historyRecords)) {
              state.historyRecords = state.historyRecords.filter(function (row) { return row.eid !== eid; });
            }
            render();
          });
        }
        return;
      }

      var go = hit("data-game-go");
      if (go) { location.href = go.getAttribute("data-game-go"); return; }

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

      // 飞花令：查一查 / 闯关 两种形态切换。切过去就重新发一副牌，
      // 两边的「轮」各算各的（闯关的轮次在 startFlyLevel 里自己 +1）。
      var kind = hit("data-game-fly-kind");
      if (kind) {
        var kid = kind.getAttribute("data-game-fly-kind");
        if (kid !== state.flyKind) {
          state.flyKind = kid;
          state.flyRound = 0;
          stopLevelTimer();
          if (kid === "level") startFlyLevel(false);
          else { startFly(state.level, false); }
        }
        return;
      }

      var home = hit("data-game-home");
      if (home) {
        stopTimer();
        stopLevelTimer();
        state.mode = "";
        state.pending = "";
        render();
        return;
      }

      var lvRestart = hit("data-game-lv-restart");
      if (lvRestart) { startFlyLevel(false); return; }

      var lvSay = hit("data-game-lv-say");
      if (lvSay) { checkLevelSaid(); return; }

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
                var reveal = v.judge !== "after";
        state.checked[state.at] = reveal;
        render();
        if (reveal) {
          var justRight = q.options[k] === q.answer;
          playSound(justRight);
          flashOption(k, justRight);
        }
        return;
      }

      var prev = hit("data-game-prev");
      if (prev) { state.at = Math.max(0, state.at - 1); render(); return; }
      var next = hit("data-game-next");
      if (next) { state.at = Math.min(state.paper.length - 1, state.at + 1); render(); return; }
      var sub = hit("data-game-submit");
      if (sub) { submit(); return; }
      var rst = hit("data-game-restart");
      if (rst) { nextFly(); return; }
    };

  }

    function openPoem(id) {
    if (!id) return;
    if (hasReader()) {
      var ev = new CustomEvent("poems:open", { detail: { id: id }, cancelable: true });
      document.dispatchEvent(ev);
      return;
    }
        // 独立页（/dahui/）没有阅读器可挂：原地弹一张只读原文卡，不整页跳走丢答题进度
    if (poemById(id)) { state.overlayId = id; render(); return; }
    location.href = "/poems/?poem=" + encodeURIComponent(id);
  }

    function hasReader() {
    return !!document.querySelector('[data-gw="reader"]');
  }

    function renderPoemOverlay(id) {
    var p = poemById(id);
    if (!p) return "";
    var text = esc(String(p.text || "")).replace(/\n/g, "<br>");
    return '<div class="modal">' +
      '<div class="modal-mask" data-game-overlay-close="1"></div>' +
      '<div class="modal-box small">' +
      '<button class="modal-close" type="button" data-game-overlay-close="1">&times;</button>' +
      '<div class="modal-head"><h2>' + esc(p.title || "") + "</h2>" +
      '<p class="meta"><span class="tag ghost">' + esc(p.author || "") + "</span>" +
      (p.book ? '<span class="tag ghost">' + esc(bookName(p.book)) + "</span>" : "") +
      "</p></div>" +
      '<p class="poem-text">' + text + "</p>" +
      "</div></div>";
  }

  function close() {
    if (!host) return;
    stopTimer();
    stopLevelTimer();
    state.mode = "";
    state.overlayId = "";

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
    C.setSub("飞花令 · 题库 · 模拟考试 · 考试");
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
        state.scopeOpen = true;
    state.setup = { scope: "all", size: 0, scopeChosen: false };
    applyDefaultScope();
    state.setupNotice = "";
    state.pending = "";
    state.overlayId = "";
    state.flyKind = "look";
    state.lvRound = 0;
    state.lvDone = [];
    state.lvStreak = 0;
    state.lvBest = 0;
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
      if (e.key !== "Escape") return;
      if (state.overlayId) { state.overlayId = ""; render(); return; }
      if (isOpen() && !state.mode) close();
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
