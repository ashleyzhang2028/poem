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

  // ---------------------------------------------------------------------
  // 首页的「考什么范围」：**把范围提到玩法前面**
  // ---------------------------------------------------------------------
  // 用户 2026-09-26 原话（Issue #356 第七轮）：
  //   「这四张卡片目前是按题型来的，我记得还有按范围来的，例如只考唐诗三百首，
  //     只考文学常识，只考成语故事，你觉得应该怎么组织合适？还是在点击四张
  //     卡片后再设置范围？」
  //
  // 定下来的口径：**两类进首页（题型 + 常考的那几部集子），其余留「全部范围」**。
  //   · 首页两条路：上半「考哪一类题」（玩法四张卡，与从前一样），
  //     下半「考哪一部书」（常考集子各一张卡）；
  //   · 「全部」（全站 2928 条混着抽）与「课内三学段」（小学 / 初中 / 高中）
  //     不占首页的格子 —— 它们归「更多范围」那一层（`renderScopes()`）；
  //   · 玩法卡点进去的「卷面设置」里**范围不再问第二遍**：首页选的那一部
  //     已经带下去了（`start()` 把 `state.setup.scope` 先设好）。
  //
  // ⚠️ 名单**不在这里另列一份**：下面的 `FEATURED` 只是「哪几部进首页 + 排第几」
  //    的**次序表**，名字、条数、id 全部从 `Exam.scopes()`（→ `SITE_BOOKS`）现算。
  //    加第十二部集子时这里一个字都不用改 —— 它自动落进「更多范围」那一层。
  // ⚠️ 「全部」那一格写的不是 `all`，是 `poems:primary`？—— 不，「全部」与三学段
  //    都归「更多范围」。首页四部（唐诗 / 文学常识 / 成语故事 + 课内诗词）
  //    是**用户点名**的那三部 + 课内那一部（课内本来就有自己的页与语料）。
  var FEATURED = [
    { id: "book:tangshi",  hint: "按卷次，五言到乐府" },
    { id: "book:changshi", hint: "文体、典籍、称谓、典故" },
    { id: "book:chengyu",  hint: "原文带译文，一部一则" }
  ];

  // 「更多范围」那张卡（首页第四张）：说明与条数。
  // ⚠️ 条数是**整个语料**（`all` 那一格的 count），不是「其余集子加起来」——
  //    点进去之后最上面那一组就是「全部」，那句「2928 条」说的正是它。
  var MORE_HINT = "全部 · 小学 · 初中 · 高中 · 其余集子";

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
    // 卷面设置（范围 × 题量）：进去之后默认「全部 · 该形态的默认题量」。
    // `scopeChosen` 记「范围是不是用户自己挑的」—— 挑过就一路带下去、
    // 不再在卷面设置里问第二遍（Issue #356 第七轮）。
    setup: { scope: "all", size: 0, scopeChosen: false },
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
  //
  // ⚠️ **必须展开正文**（Issue #356 第七轮查出的真 bug）：
  //    集子那十部数据文件里**一个字的正文都没有** —— 位置由 `textRef` 记着，
  //    正文存在 `data/text-master.js` 那一张主表里（同一篇只落一份，见那张表的
  //    文件头）。从前这里直接拿 `window[w.v]` 原样返回，于是 `p.text` 是空的：
  //    「考哪一部书」（唐诗 / 宋词 / 古文观止……）这些范围**一道题都出不来**
  //    （真机量过：`Exam.build(corpus, {scope:'book:tangshi'})` → 0 题）。
  //    课内那一批看着正常，只是因为 `data/index.js` 在建 `POEMS_ALL` 时
  //    自己已经过了一遍 `masterTextOf` —— 两处做法不一致，问题就藏在会读出
  //    0 题的那半边。
  //    修法与 `data/index.js` 同一句：调 `window.masterTextOf(p, book)`；
  //    主表不在（脚本没挂上）时它原样返回，不会把课内那批弄丢。
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

  // 展开一条的正文（`textRef` → `data/text-master.js`），再打上集子标。
  // 主表没挂上 / 这一条没有 `textRef` 时**原样返回** —— 不猜、不塞空串，
  // 于是「语料不够」那句话会如实说出来，而不是悄悄出一张空卷。
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
    // ⚠️ 首页有**两行**卡（Issue #356 第七轮）：
    //    上一行是「考哪一类题」（玩法四张），下一行是「考哪一部书」（常考集子
    //    各一张卡）。从前只有上一行，用户于是问「我记得还有按范围来的……你觉得
    //    应该怎么组织合适？」—— 答案落在这里：**范围与题型并列，都在首页**。
    //    两行由 `.poems-home-tag` 那两行小标题分开（见 `css/account.css`）。
    var html = homeTag("题型");
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

    // 下一行：常考的那几部集子，各是一张卡 —— 点它就**带着这一部**进玩法选择。
    // ⚠️ 这一行的卡是 `data-game-scope`（不是 `data-game-mode`）：点它就是
    //    「我要考这一部书」，接着问玩哪种。进到玩法那一层时范围已经定了，
    //    卷面设置里不再问第二遍（见 `start()` 与 `renderSetup()`）。
    var scopes = scopeList();
    var feat = FEATURED.filter(function (f) {
      return scopes.filter(function (sc) { return sc.id === f.id; }).length > 0;
    });
    if (feat.length) {
      html += homeTag("范围");
      html += '<div class="poems-home-row">';
      feat.forEach(function (f) {
        var sc = null;
        scopes.forEach(function (x) { if (x.id === f.id) sc = x; });
        if (!sc) return;
        html += scopeCard(sc, f.hint);
      });
      // ⚠️ 「更多范围」**也是这一行的一张卡**（Issue #356 第八轮用户原话：
      //    「更多范围那里，以第四个卡片的形式展示」）。从前它是一条通栏的
      //    `.account-btn.ghost` —— 第五条边、和上面三张卡都不是一套外观，
      //    看着像「另一件事」。现在它就是第四张卡：同一套外观、同一行。
      //    三张常考 + 这一张，正好凑满 2×2 的田字格（390px 上一行两张）。
      // ⚠️ 它是 `data-game-scopes`（不是 `data-game-scope`）：点它不选范围，
      //    而是**展开那一层**（全部 / 三学段 / 其余集子）。
      html += '<button class="account-card game-mode game-scope game-scope-more" ' +
        'type="button" data-game-scopes="1">' +
        '<span class="game-mode-name">更多范围</span>' +
        '<span class="game-mode-desc">' + esc(MORE_HINT) + "</span>" +
        '<span class="game-mode-tier">' + esc(moreCount()) + " 条</span>" +
        "</button>";
      html += "</div>";
    }

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

  // 一张范围卡（首页那一行「范围」：三张常考 + 一张「更多范围」）。
  // ⚠️ 样子与玩法卡**同一套**（`.account-card.game-mode`）：同一行、同一格、
  //    同一档标题与门槛小标 —— 用户要的是「更多范围也是第四个卡片」，
  //    不是「三张卡加一条通栏键」。
  function scopeCard(sc, hint) {
    return '<button class="account-card game-mode game-scope" type="button" ' +
      'data-game-scope="' + esc(sc.id) + '">' +
      '<span class="game-mode-name">' + esc(sc.name) + "</span>" +
      (hint ? '<span class="game-mode-desc">' + esc(hint) + "</span>" : "") +
      '<span class="game-mode-tier">' + esc(sc.count) + " 条</span>" +
      "</button>";
  }

  // 「更多范围」那张卡上写多少条：整个语料那一格的 count。
  function moreCount() {
    var n = scopeCount("all");
    return n == null ? "" : n;
  }

  // 首页那两行小标题（「题型」/「范围」）。
  // ⚠️ 它就是**一个词**（用户 2026-09-26 第八轮原话：「改成 题型 不要加任何
  //    其他废话」「改成 范围 不要任何其他废话」）—— 从前后面还跟着一句
  //    「同一份语料，四种玩法；想换书的请看下一行」那样的说明，已经删干净。
  // ⚠️ 它**不是** `.account-card-title`（那是卡**里面**的标题，13px 灰色小字），
  //    也不是卡片（不带背景 / 圆角）—— 它只是横在卡片之间的一行字，
  //    把这一层分成两段。样式见 `css/account.css` 的 `.poems-home-tag`。
  function homeTag(title) {
    return '<p class="poems-home-tag">' + esc(title) + "</p>";
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

  // 某个范围有多少条（择不出时回 "?"，不假装知道）。
  function scopeCount(scopeId) {
    var list = scopeList();
    for (var i = 0; i < list.length; i++) if (list[i].id === scopeId) return list[i].count;
    return "?";
  }

  // ---------------------------------------------------------------------
  // 「更多范围」那一层（Issue #356 第八轮重排）
  // ---------------------------------------------------------------------
  // 首页那一行摆四张卡：常考的三部（`FEATURED`）+「更多范围」自己一张。
  // 剩下的一律在这一层，一个不少：
  //   · 全部（全站语料混着抽，例：2928 条）；
  //   · 课内三学段（小学 / 初中 / 高中 —— 由 `Exam.scopes()` 从年级算出来）；
  //   · 其余集子（课内诗词 / 小古文 / 乐府 / 宋词 / 元曲 / 古文观止 /
  //     昭明文选 / 近现代诗词）。
  //
  // ⚠️ 这一层与首页那一行**同源**：都读 `scopeList()`（→ `Exam.scopes()`
  //    → `SITE_BOOKS`）。首页那三张卡只是「从这里挑三张摆上去」，
  //    名单永远只有一份。
  // ⚠️ 点这里的任何一张 = 选好范围，接着问玩哪种（回首页那一行玩法卡）。
  //    所以这里是「选范围 → 选玩法」，与首页「选玩法 → 选范围」是同一个漏斗的
  //    两个入口，出口都是卷面设置。
  //
  // ⚠️ 首页那三张在这里**不重复出现**（`feat[sc.id]` 那一句跳掉的正是它们）：
  //    它们是「常考的那几部」，已经在上一层的卡片里点得到。
  function renderScopes() {
    var scopes = scopeList();
    var feat = {};
    FEATURED.forEach(function (f) { feat[f.id] = 1; });

    var all = [], stages = [], books = [];
    scopes.forEach(function (sc) {
      if (feat[sc.id]) return;
      if (sc.id === "all") all.push(sc);
      else if (sc.id.indexOf("poems:") === 0) stages.push(sc);
      else books.push(sc);
    });

    // ⚠️ 这一层的版式整块重来（Issue #356 第八轮用户原话：
    //    「点进 更多范围 页面，整个卡片和排版你是认真的吗，一塌糊涂！」）。
    //
    //    从前长这样，三处**真的坏了**：
    //      · 标题卡里先是一颗「回到玩法」**按钮**（`<button>` 通栏、白底、有边），
    //        再是「更多范围」这个卡内标题 —— 一颗键压在标题**上面**，主次翻了个；
    //      · 每一组又是一张 `.account-card`，格子里每一颗范围键**自己也带**
    //        `.account-card` —— **卡套卡套卡**：白底卡片里套着白底卡片，
    //        边框一道套一道，哪一层是「一组」看不出；
    //      · 格子是 flex `wrap` 不是 grid，每颗键**按内容定宽**（55～128px 不等），
    //        没填满的那一行左边齐、右边空一大片（「其他集子」那一组尤其明显）。
    //
    //    现在：**一条小标题 + 一片格子**，就这两样。分组不再是卡片（小标题
    //    自己就是分段的线），范围键也不再自带卡片外观（但保留 `.game-mode`
    //    那套「这是一颗能点的键」—— 按下去要有反应、标题档次一致，见 `scopeCard()`）。
    var html = '<button class="account-btn ghost game-back" type="button" ' +
      'data-game-back="1">返回</button>';

    html += scopeGroup("全部", all);
    html += scopeGroup("课内诗词", stages);
    html += scopeGroup("其他集子", books);

    if (state.setupNotice) {
      html += '<p class="account-msg warn game-scopes-notice">' +
        esc(state.setupNotice) + "</p>";
    }
    return html;
  }

  // 一组范围：一条小标题 + 一片格子。
  // ⚠️ 小标题用 `.poems-home-tag`（与首页「题型」「范围」**同一个样式**）——
  //    「分段」这件事全站只有这一个样子，不再为这一层另立一种。
  function scopeGroup(title, rows) {
    if (!rows.length) return "";
    return '<p class="poems-home-tag">' + esc(title) + "</p>" +
      '<div class="game-scope-grid">' +
      rows.map(function (sc) {
        return '<button class="game-scope-item" type="button" ' +
          'data-game-scope="' + esc(sc.id) + '">' +
          '<span class="game-scope-name">' + esc(sc.name) + "</span>" +
          '<span class="game-scope-count">' + esc(sc.count) + " 条</span>" +
          "</button>";
      }).join("") +
      "</div>";
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

    // 范围：**首页已经选过的那一部，这里只念一遍、不再问第二遍**
    // （Issue #356 第七轮）。用户点「唐诗三百首」那张卡进来，是来选玩法与题量的，
    // 不是来再审一次范围的 —— 再审一次等于把「选范围」问了两次。
    // 想换书有两条现成的路：这张卡上的「换一部书」回首页，或去「更多范围」。
    // ⚠️ 「全部」（`all`）是**默认档**，它本来就没在首页选过，所以照样给下拉 ——
    //    否则从玩法卡直接进来的人会发现自己只能考「全部」。
    var chosen = state.setup.scope && state.setup.scope !== "all";
    if (chosen) {
      html += '<section class="account-card"><h2 class="account-card-title">考什么范围</h2>' +
        '<p class="account-lead">' + esc(scopeName(state.setup.scope)) +
        "（" + esc(scopeCount(state.setup.scope)) + " 条）</p>" +
        '<div class="game-nav">' +
        '<button class="account-btn ghost" type="button" data-game-scopes="1">换一部书</button>' +
        "</div>" +
        '<p class="account-hint">范围在首页选的；换书就回那一层，不必在这里再审一遍。</p>' +
        "</section>";
    } else {
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
        '<p class="account-hint">名单从全站集子自己算出来 —— 加一部集子，这里就多一个范围。' +
        "常考的几部（唐诗 / 文学常识 / 成语故事）在首页就有自己的卡。</p>" +
        "</section>";
    }

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
    else if (state.mode === "scopes") body = renderScopes();
    else if (state.mode === "setup") body = renderSetup();
    else if (state.mode) body = renderPaper();
    else body = renderHome();

    if (state.mode === "fly") {
      body += '<section class="account-card"><button class="account-btn ghost" type="button" ' +
        'data-game-restart="1">换一副令字</button></section>';
    } else if (state.mode === "scopes" || state.mode === "setup") {
      // 「更多范围」与「卷面设置」这两层自己就是一层，不再往下挂回退键。
    } else if (state.mode) {
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
    // ⚠️ 范围**不在这里归零**（Issue #356 第七轮）：用户可能在首页那一行
    //    「考哪一部书」里已经点过「唐诗三百首」，走到这一步是来挑玩法的。
    //    归零 = 把他刚选的那部书悄悄扔掉，卷面设置里再问一遍「考什么范围」。
    //    只有题量每次重来（那是「这一次要几题」，不是用户的长期选择）。
    // ⚠️ 从题目里退回首页时也要留住 —— 见 `bind()` 的 `data-game-back`。
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

  // 选好了范围、回首页等选玩法 —— 用那颗现成的 toast 说一声（页面角落那一颗，
  // 不另开卡片）。文案只在这一处，`renderHome()` 不再自己写第二句。
  function showScopeToast(text) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(showScopeToast._t);
    showScopeToast._t = setTimeout(function () { el.hidden = true; }, 2200);
  }

  function readSetup() {
    var sel = $("#game-scope");
    if (sel) {
      state.setup.scope = sel.value || "all";
      // 在这个下拉里亲手改过 → 也算「用户挑的范围」，后续一路带下去。
      state.setup.scopeChosen = true;
    }
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
        // 三层各有各的回退：
        //   · 「更多范围」→ 回首页（那一层只是首页那一行的展开）；
        //   · 卷面设置    → 回首页（玩法与范围都在首页选过了）；
        //   · 考试进行中  → 回卷面设置（换题量重抽）。
        if (state.mode === "scopes" || state.mode === "setup") {
          state.mode = "";
          state.pending = "";
        } else {
          state.mode = "setup";
          readSetup();
        }
        render();
        return;
      }

      // 「更多范围」那一层：首页那张通栏键。
      var more = hit("data-game-scopes");
      if (more) {
        stopTimer();
        state.mode = "scopes";
        state.pending = "";
        state.setupNotice = "";
        render();
        return;
      }

      // 首页那一行「考哪一部书」的卡：**选好范围**，接着问玩哪种。
      // 所以先把范围记下，再回首页那一行玩法卡（`state.mode = ""`）——
      // 漏斗仍是一个：范围 → 玩法 → 卷面设置。
      var sc0 = hit("data-game-scope");
      if (sc0) {
        var sid = sc0.getAttribute("data-game-scope");
        state.setup.scope = sid;
        state.setup.scopeChosen = true;
        state.setupNotice = "";
        state.mode = "";
        state.pending = "";
        render();
        if (sid !== "all") {
          showScopeToast("已选「" + scopeName(sid) + "」—— 点一个玩法开始");
        }
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

  // 集子那几部是**按需加载**的（`WANTED` 那份清单，首页先不拉），所以
  // 首页第一次渲染时 `corpus()` 里只有课内那一批 —— 「考哪一部书」那一行
  // 靠 `scopeList()` 算，算出来是空的，那三张卡就不会出现。
  // 语料到位后补一次渲染：只在首页那一层补（别处的渲染不依赖集子加载完，
  // 补一次会把用户正在做的题重画掉）。
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
