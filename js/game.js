/**
 * 试题模拟（3 期 · 不花钱的那一层）
 * ==========================================================================
 * 三个玩法，同一个内核（`js/quiz.js`）、同一份语料（各集子自己的数据文件）。
 *
 *   飞花令      —— 给一个令字，写出所有带这个字的句子（**Max**）
 *   试题模拟    —— 抽一套卷子当场做，交卷即判分（**Max**）
 *   题库复习    —— 给上句选下句，一道道过（**Pro**）
 *
 * ⚠️ 2026-09-19（Issue #163）用户把两件事裁清了：
 *   「一个是古诗词大会的集子的访问权限，一个是在线试题模拟的权限」
 * 这一页是**后者**（在线出题 · 判分）；前者的权限键是 `exam.gathering`，
 * 落在 `/poems/` 上那颗入口（见 js/poems.js），点进来之前就先判过。
 * 两件事各有自己的钩叉 —— 能进集子 ≠ 能考试。
 *
 * ## 这一页的定位：它是 `/poems/` 上的一层，不是新的一站
 *
 * 底部四个页签已经满了（背诵 / 课外 / 搜索 / 设置），不该再挤一个。
 * 它是**课内那 261 首的另一种用法** —— 所以挂在课内诗词索引页（`/poems/`）里，
 * 与 `/library/` 上那五部集子的索引**同一套「就地叠层」**：
 * 地址栏不动，页顶那一行换成本页的页名与说明，右上角那颗返回键一层退一层。
 * 于是「课内目录 → 试题模拟 → 一层退一层」与用户点出来的路径一一对应。
 *
 * ## 三条口径
 *
 * 1. **不提前渲染一个字** —— 未登录 / 层级不够时，只显示一张如实说明的卡
 *    （「这一项要 Max」+ 怎么才能拿到），**不写「即将上线」**（2A 立的规矩）。
 * 2. **答案与题目一起出** —— 抽题时就配好了答案，界面用 CSS 遮住。
 *    这一点必须如实说：答案就在浏览器里，它**不是防作弊**，
 *    是一份「先自己想一想再看」的自省工具（离线、不联网、不上传作答记录）。
 * 3. **判分服务端说了算（配了服务端时）** —— 飞花令与试题模拟都走
 *    `POST /api/game/answer`；服务端不在时**如实降级为本机判分**并标注，
 *    不假装「已由服务器判定」。
 */
(function () {
  "use strict";

  var Ent = window.Entitlement;
  var Q = window.Quiz;

  /**
   * 「《古诗词大会》集子的访问」这一条能力的键名 —— 与 js/entitlement.js 的
   * `exam.gathering` **逐字一致**（用户 2026-09-19 裁清的那两件事里的第一件）。
   *
   * ⚠️ 它与下面三层玩法（`exam.paper` 那条）是**两条能力**：能进集子 ≠ 能考试。
   *    两颗钩叉各答各的问题，所以这里不许把它并回 MODES 里当第四张卡 ——
   *    它不是「一个玩法」，是一层的入场券。
   */
  var GATHERING_CAP = "exam.gathering";

  /* 三层各自的定义。cap 与 js/entitlement.js 的 CAPS 键名**逐字一致** ——
     写错的下场是「界面点亮了，服务端判分口回 403」。
     ⚠️ 这三层是「**试题模拟**」这个权限下面的三件事（用户 2026-09-19 裁清：
        「一个是在线试题模拟的权限」）。《古诗词大会》那个**集子**的访问是
        另一条能力 `exam.gathering` —— 它落在这一页的**入口**上（见集子卡），
        不落在这三张玩法卡上：能进集子 ≠ 能考试，两件事各有自己的钩叉。 */
  var MODES = [
    {
      id: "fly", cap: "feihualing", tier: "max",
      name: "飞花令",
      desc: "给一个令字，写出所有带这个字的句子",
      unit: "句"
    },
    {
      /* ⚠️ 2026-09-19（Issue #163）：名字从「现场考试」改成「**试题模拟**」——
         与对比页那一行同名同义（用户点名：「一个是在线试题模拟的权限」）。
         能力键仍是 `exam.paper`（服务端判分口与它同源，一个字没动）。 */
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

  /* 飞花令的令字档位。三档都从**语料现算**（见 js/quiz.js 的 candidates），
     不写死一份字表 —— 写死的那份早晚与语料对不上。
       easy   常见字：能对上 25 句以上，随便想得起
       normal 一般字：6 句以上
       hard   难字：多音字或非常用字（小朋友最容易读错的那一类）
     注音由 js/pinyin.js 负责（它已经有「生字 + 多音字」的判据），
     这里只借它的两个只读判据，不另写一套。 */
  var CHAR_LEVELS = [
    { id: "easy",   name: "常见字", min: 25 },
    { id: "normal", name: "一般字", min: 6 },
    { id: "hard",   name: "难字",   min: 6, hard: true }
  ];

  var state = {
    mode: "",         // "" = 还没开局（显示三张卡）
    chars: [],        // 飞花令当前令字
    level: "normal",
    paper: [],        // 当前卷子（题目数组）
    at: 0,            // 做到第几题
    picks: [],        // 每题选了哪一条（"" = 还没选）
    checked: [],      // 每题是否已经「当场看过答案」（与整卷 graded 分开）
    said: [],         // 飞花令：用户自己写的句子
    graded: null,     // 交卷后的判分结果
    server: null      // "/api/game/answer 通不通"，null = 还不知道
  };

  var host = null;    // 这一层的挂载点（[data-poems-view="game"]）
  var viewEl = null;  // 第一层（诗词列表那一段）

  function $(sel, base) { return (base || host || document).querySelector(sel); }
  function $$(sel, base) {
    return Array.prototype.slice.call((base || host || document).querySelectorAll(sel));
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ------------------------------------------------------------ 语料 */

  /**
   * 全站篇目 —— **六部集子合起来**，不只课内那 261 首。
   *
   * 为什么飞花令要用全站：它就是「翻遍肚子里的诗」这件事，
   * 只看课内等于替用户把范围缩小了。而各集子的数据在**别的页面**才加载
   * （`/poems/` 只有课内 12 册），所以这里按需补加载：
   * 已在 window 上的直接用，没有的就动态插一个 `<script>` 再取。
   * 六个文件都是本站自己的静态资源（已在 sw.js 预缓存里），不联网、不引第三方。
   */
  var WANTED = [
    { file: "data/poems-classic.js",  v: "POEMS_CLASSIC" },
    { file: "data/poems-tangshi.js",  v: "POEMS_TANGSHI" },
    { file: "data/poems-songci.js",   v: "POEMS_SONGCI" },
    { file: "data/poems-guwen.js",    v: "POEMS_GUWEN" },
    { file: "data/poems-zhaoming.js", v: "POEMS_ZHAOMING" }
  ];

  /** 补加载一部集子的脚本最多等多久（毫秒）——见 loadScript 的注释 */
  var LOAD_TIMEOUT_MS = 8000;

  /**
   * 补加载一份数据脚本。**永远会 settle，永远不会挂住**。
   *
   * ⚠️ 三道保险缺一不可，否则整页会卡在「正在加载」上：
   *    · onload   —— 正常路径；
   *    · onerror  —— 404 / 断网（少一部也是能玩的，不打断）；
   *    · **超时** —— 前两个都不来时（扩展拦了请求、脚本标签被移除、
   *      或被嵌在没有网络栈的环境里）兜底放行。
   *   少了超时那一道，症状是**点了玩法之后什么都不发生**：
   *   `ensureCorpus()` 那个 Promise 永不 settle，后面的开局代码一行都不跑。
   *   这一条不是纸上推演出来的 —— 它就是在无网络栈的测试环境里
   *   实测到的：`state.mode` 已经是 `"review"`，而卷子一直是空的。
   */
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

  /** 补加载还没上来的那几部；拉完（或失败）都回过神来 */
  function ensureCorpus() {
    var jobs = WANTED.filter(function (w) {
      return !(window[w.v] && window[w.v].length);
    }).map(function (w) { return loadScript(w.file); });
    if (!jobs.length) return Promise.resolve(corpus());
    return Promise.all(jobs).then(function () { return corpus(); });
  }

  /* ---------------------------------------------------------- 能力判权 */

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

  /** 这一档玩法现在能不能开（与集子那条共用同一个出口） */
  function allowed(mode, id) {
    return capAllowed(mode.cap, id);
  }

  /**
   * 这一条能力现在开不开。
   * **一律走 `Entitlement.can()`**，页面不自己比 tier（有源码扫描守着）。
   */
  function capAllowed(cap, id) {
    return Ent.can(cap, { tier: (id && id.tier) || "free", signedIn: !!(id && id.signedIn) });
  }

  /* ------------------------------------------------- 服务端判分（有就优先） */

  /**
   * 判分：**配了服务端就让服务端判，没配就本机判**。
   *
   * ⚠️ 这一步**不许假装**：
   *    · 服务端不在（`/api/me` 都拿不到）→ 本机判分 + 界面上如实标注；
   *    · 服务端在但回 403 → 那是「你确实没这个权限」，**不回落本机判分**
   *      （回落等于把闸绕过去了，而闸本来就在服务端）。
   * 两个回执形状一致（都有 ok / why），所以调用方不必分两支读。
   */
  function judge(payload) {
    var api = window.AccountApi;
    var req = api && api.gameAnswer ? api.gameAnswer(payload) : null;
    if (!req) return Promise.resolve(null);      // 老缓存：没有这一层
    return Promise.resolve(req).then(function (r) {
      if (r && r.ok) { state.server = "on"; return r; }
      /* 403 = 权限问题，如实抛给调用方（不回落）；其余（连不上 / 未配置 /
         老脚本）一律回 null → 调用方走本机判分，并在界面上标注 */
      if (r && r.status === 403) { state.server = "on"; return r; }
      state.server = "off";
      return null;
    })["catch"](function () { state.server = "off"; return null; });
  }

  /* ------------------------------------------------------------ 飞花令 */

  /**
   * 令字的注音辅助：只用 js/pinyin.js 的**两个只读判据**，
   * 不自己写一套「哪些字难」的表。
   */
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
    // 一次给两个字：单字太难「正好是那个字」，两个字才有「凑一凑」的余地。
    // 用候选自身当种子（同一个令字永远同一副牌，可复现）。
    var picked = Q.shuffle(pool, pool[0] + pool.length)[0] || pool[0];
    var second = Q.shuffle(pool.filter(function (c) { return c !== picked; }), picked)[0];
    return second ? [picked, second] : [picked];
  }

  /* ---------------------------------------------------------- 渲染 */

  function gateCard(mode, id) {
    var r = capAllowed(mode.cap, id);
    if (r.ok) return "";
    /* ⚠️ 未登录与层级不够是**两回事**（与 /plans/ 那一页同口径）：
       游客要先登录，已登录的 free 要有人给他发层级。文案走 denyReason()。*/
    var why = Ent.denyReason(mode.cap, { tier: id.tier, signedIn: id.signedIn });
    return '<div class="game-gate">' +
      '<p class="game-gate-why">' + esc(why) + "</p>" +
      (id.signedIn
        ? '<p class="account-hint">层级由管理员按邮箱掩码发放。这一页的说明与对照见 <a href="/plans/">四种身份对比</a>。</p>'
        : '<button class="account-btn" type="button" data-game-go="/login/">用邮箱建一个账号</button>') +
      "</div>";
  }

  /**
   * 集子访问没过闸时，就地铺一张如实说明的卡（**不跳走、不把入口藏起来**）。
   * 文案与其余各处同一个来源：`Entitlement.denyReason()`。
   */
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
    bind();          // 那张卡上的两颗键（去登录 / 返回列表）也要真的接上
    paintBack();
  }

  function renderHome() {
    var id = identifier();
    /* ⚠️ 顶上那张卡说清的是「**试题模拟**」这一层（三张玩法卡都在它下面），
       不是《古诗词大会》那个集子 —— 集子的访问权限在**入口那一层**
       （`exam.gathering`，见 js/poems.js 与 poems/index.html），与这里分开。 */
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

    // 锁定说明单独一张卡：三张卡各自的按钮上都写着原因了，这里只补一句「怎么拿到」
    var locked = MODES.filter(function (m) { return !allowed(m, id).ok; });
    if (locked.length) {
      html += '<section class="account-card"><h2 class="account-card-title">怎么用上</h2>' +
        gateCard(locked[0], id) + "</section>";
    }

    /* ⚠️ 这段文字**直接进 innerHTML**，所以不许写 Markdown 的 `**加粗**` ——
       乘号会原样显示出来（这个坑是实测到的）。要强调就用 <strong>。 */
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

    // 答案区：默认折叠。**这就是「同款刮开」** —— 内容先不给，点开才生成。
    // 与「自己在纸上写」是同一件事，只是不用真的找纸。
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

  /** 把命中的令字加粗（内核已经给出 hit，这里不重新扫一遍） */
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
    /* 单题的反馈：这一题当场看过答案了就标出来（不必等到整卷交卷）；
       整卷交完之后（`graded`）每一题都标出来。两件事分开，
       否则「选了一条」会立刻把**整张卷子**锁住。 */
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
    // 已经开局的页面顶上那颗「重开一副卷子」——放在尾部，免得抢了正文
    if (state.mode) {
      body += '<section class="account-card"><button class="account-btn ghost" type="button" ' +
        'data-game-restart="1">' + (state.mode === "fly" ? "换一副令字" : "重抽一副卷子") +
        "</button></section>";
    }
    host.innerHTML = body;
    bind();
  }

  /* ---------------------------------------------------------- 交互 */

  function startFly(levelId) {
    state.level = levelId || state.level;
    var cps = corpus();
    state.chars = pickChars(cps, state.level);
    state.revealed = false;
    render();
  }

  /**
   * 问一次判分口，把 `state.server` 定下来（界面据此标注「由服务器判分」还是
   * 「本机判分」）。**不阻断开局** —— 问不到就是本机判分，如实标。
   */
  function probeServer() {
    if (state.server) return;
    judge({ kind: "review", poemId: "xx1-01", chosen: "__probe__" }).then(function () { render(); });
  }

  function startPaper(mode) {
    var cps = corpus();
    var bank = Q.buildBank(cps, { perPoem: 1, options: 4 });
    var size = mode === "paper" ? 8 : 5;   // 试题模拟 8 题、题库复习 5 题
    // 种子用「现在的分钟数」：同分钟内重抽是同一副卷子（可复现），
    // 隔一会儿再来是新的一副 —— 不用 Math.random，测试才钉得住。
    var seed = String(Math.floor(Date.now() / 60000));
    state.paper = Q.paper({ bank: bank, size: size, seed: seed + ":" + mode });
    state.at = 0;
    state.picks = state.paper.map(function () { return ""; });
    state.checked = state.paper.map(function () { return false; });
    state.graded = null;
    render();
  }

  /**
   * 语料补上来之后重抽一副卷子。
   *
   * ⚠️ 只在**用户还没开始做**（一道都没选）时换：已经开始做了再换掉题，
   *    等于把用户刚想的答案连题一起抽走。
   */
  function refreshPaper(modeId) {
    var touched = state.picks.some(function (p) { return !!p; });
    if (!touched && !state.graded) startPaper(modeId);
  }

  function start(modeId) {
    var m = modeOf(modeId);
    if (!m) return;
    var id = identifier();
    if (!allowed(m, id).ok) { render(); return; }   // 锁着的不给开（与服务端同一张表）
    state.mode = modeId;
    /* ⚠️ **先用手上已有的语料立刻开局**，补加载的那几部到位之后再重来一遍。
       为什么不能等 `ensureCorpus()` 回来才开局：那几部是动态 `<script>`，
       在断网 / 被拦 / 脚本标签被移除时永远不 settle（靠超时兜底也要等 8 秒）——
       等它的症状是「点了玩法之后什么都不发生」，而那五部集子本来就只是
       「锦上添花」（课内那 261 首一直在手上，飞花令与题库当场就能玩）。
       先开局再补料，用户立刻看到东西，补上来之后数字自己变大。 */
    if (modeId === "fly") { startFly(); } else { startPaper(modeId); }
    ensureCorpus().then(function () {
      if (state.mode !== modeId) return;     // 用户已经换到别的玩法了，别抢回控制权
      if (modeId === "fly") { startFly(state.level); } else { refreshPaper(modeId); }
    });
  }

  /** 交卷：逐题跟服务端核一次（服务端在的话），拿它的 ok 算分 */
  function submit() {
    var right = 0;
    var jobs = state.paper.map(function (q, i) {
      var chosen = state.picks[i] || "";
      /* ⚠️ 这里**只传题的标识与用户选的那一条**，不传答案。
         传输层（js/auth-api.js）也不转发 `answer` —— 服务端从自己的语料重建题目，
         客户端说了不算。这一条由 test/api.test.js 用「塞一个假 answer」钉住。 */
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

      /* 集子访问没过闸那张卡上的「返回诗词列表」——与 ☓ 收掉这一层同一条路 */
      var cl = hit("data-game-close");
      if (cl) { close(); return; }

      var mode = hit("data-game-mode");
      if (mode) {
        var mid = mode.getAttribute("data-game-mode");
        if (mode.getAttribute("data-locked")) return;   // 锁着的不给开
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
        if (!q || state.graded) return;      // 交卷之后选项锁住，不再改
        state.picks[state.at] = q.options[k];
        /* 选完**当场**给一次反馈：本机判（不花钱、也不该等一个请求），
           判据是内核的同一个 `Q.grade()` —— 与服务端那一份同源。
           标记成 `checked[i]` 而不是整份 `graded`：`graded` 是「整卷交完了」，
           两者的界面表现完全不同（前者只标这一题，后者才出总分、才锁住选项）。 */
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

  /* ------------------------------------------------------ 与索引页的衔接 */

  /** 点飞花令里那一句 → 打开那一篇的原文（走索引页自己的阅读器） */
  function openPoem(id) {
    if (!id) return;
    var ev = new CustomEvent("poems:open", { detail: { id: id }, cancelable: true });
    document.dispatchEvent(ev);
  }

  /** 收掉这一层，回到诗词列表 */
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

  /** 打开这一层（从索引页工具条那一颗进） */
  function open() {
    if (!host) return;
    if (viewEl) viewEl.hidden = true;
    host.hidden = false;
    state.mode = "";
    render();
    paintHeader(true);
    paintBack();
    ensureCorpus().then(function () {
      /* 语料补上来了：若已经在某一局里（用户手快），重画一次，
         场景的数字立刻从「只有课内」变成全站。 */
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
    /* 索引页里那颗「古诗词大会」入口键。挂在工具条上（与搜索、连读同一行），
       由这一层自己绑 —— 索引页那边只留一个空槽位，不写任何本页的逻辑。
       ⚠️ 它就是**集子访问**那一条权限（`exam.gathering`）的落点：
          用户 2026-09-19 把两件事裁清了（「一个是古诗词大会的集子的访问权限，
          一个是在线试题模拟的权限」）—— 所以点它之前先判这条能力。 */
    var entry = document.querySelector("[data-game-open]");
    if (entry) {
      entry.addEventListener("click", function (e) {
        e.preventDefault();
        if (!capAllowed(GATHERING_CAP, identifier()).ok) { renderEntryGate(); return; }
        open();
      });
    }
    /* 索引页自己的返回键（进入阅读器时它换过）——这一层盖上来时由本层接管；
       阅读器打开时由引擎接管（引擎的 openFrom 会先收阅读器）。 */
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen() && !state.mode) close();
    });
    loadCorpusIntoView();
  }

  /** 补加载那五部集子的脚本（进这一页就拉，别等用户点了才等） */
  function loadCorpusIntoView() {
    ensureCorpus().then(function () { /* 语料到位；渲染时自然会用上 */ });
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
    /* 测试用：不点界面直接开局 */
    start: start,
    state: function () { return state; },
    corpus: corpus
  };
})();
