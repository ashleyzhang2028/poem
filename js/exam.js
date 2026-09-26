(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./quiz.js"));
  else root.Exam = factory(root.Quiz);
})(typeof globalThis !== "undefined" ? globalThis : this, function (Quiz) {
  "use strict";

  // ---------------------------------------------------------------------
  // 形态（kind）：模拟 vs 正式的差别只有三条 ——
  //   交卷前给不给对错 / 限不限时 / 记录留不留。
  // 门槛与 js/entitlement.js 的 CAPS、api/_lib/core.js 的 featuresFor() 同源。
  // ---------------------------------------------------------------------
  var VARIANTS = [
    {
      id: "practice", cap: "quiz.review", tier: "pro", name: "题库复习",
      judge: "instant", timed: false, record: false,
      sizes: [5, 10, 20], size: 5,
      desc: "给上句选下句，一道道过，答完立刻说对错"
    },
    {
      id: "mock", cap: "exam.paper", tier: "max", name: "模拟考试",
      judge: "instant", timed: false, record: true,
      sizes: [8, 10, 20], size: 8,
      desc: "抽一套卷子当场做，答完立刻说对错"
    },
    {
      id: "formal", cap: "exam.formal", tier: "max", name: "正式考试",
      judge: "after", timed: true, record: true,
      sizes: [10, 20, 30], size: 10, minutes: 20,
      desc: "交卷后统一批改，限时 20 分钟，到点自动交卷"
    }
  ];

  // 学段范围（课内 251 首按 grade 分档）：与 data/index.js 的三组常量同源，
  // 不写字面数字 —— 加一门年级时这里跟着算。
  var STAGES = [
    { id: "primary", name: "小学" },
    { id: "middle", name: "初中" },
    { id: "high", name: "高中" }
  ];

  function variant(id) {
    for (var i = 0; i < VARIANTS.length; i++) if (VARIANTS[i].id === id) return VARIANTS[i];
    return null;
  }

  // ---------------------------------------------------------------------
  // 范围（scope）：**名单的唯一来源是 SITE_BOOKS**（data/site-books.js）。
  // 加第十二部集子时，这里自动多一个范围 —— 不许在本文件再列一份集子名单。
  //
  // ⚠️ 范围分成**三块**摆在首页上（Issue #356 第九轮：范围提到首页、可多选）。
  //    分块的**名字**在这里一处 —— 首页（`js/game.js` 的 `scopeRows()`）照着
  //    这个次序摆，两边不各写一份中文名。
  // ---------------------------------------------------------------------
  var SCOPES_GROUPS = ["全部", "课内诗词", "其他集子"];

  // 一个范围落在哪一块（判 id，不按名字猜）：
  //   · `all`            → 第 0 块（「全部」：整个语料混着抽）；
  //   · `poems:<学段>`   → 第 1 块（课内诗词按小学 / 初中 / 高中切）；
  //   · `book:<集子>`    → 第 2 块（其余集子，各住自己那一格）。
  // ⚠️ 返回 `-1` 不是「第一块」—— 认不出的 id 应当**如实说认不出**，
  //    而不是悄悄塞进「全部」（塞进去的后果是首页多出一格假的「全部」）。
  //
  // ⚠️ **`book:poems` 归 -1（不上首页）**：它与 `poems:primary` 那三格是
  //    **同一份语料**的两种切法（整部书 vs 按学段），而课内那三格已经把整部
  //    「课内诗词」切完了（小学 + 初中 + 高中 = 251 首，一个不多一个不少）。
  //    再摆一格「课内诗词（251 条）」在「其他集子」里，用户看到的会是
  //    **同一件事的第二遍**（真机核过：它原先就摆在「其他集子」的第一格）。
  //    所以：有 `poems:` 那三格时，`book:poems` 这一格不上首页
  //    —— 但它**照旧是一个合法 scope**（`select()` 认它），老链接不受影响。
  var SCOPES_HIDDEN = { "book:poems": 1 };

  function scopeGroupOf(scopeId) {
    var id = String(scopeId == null ? "" : scopeId);
    if (SCOPES_HIDDEN[id]) return -1;
    if (id === "all") return 0;
    if (id.indexOf("poems:") === 0) return 1;
    if (id.indexOf("book:") === 0) return 2;
    return -1;
  }
  function booksOf(opt) {
    var o = opt || {};
    // 显式传入优先（测试与 Node 环境用），否则问 data/site-books.js。
    if (o.books) return o.books;
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    return (g && g.SITE_BOOKS) || [];
  }

  function gradeSets() {
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    return {
      primary: (g && g.PRIMARY_GRADES) || [1, 2, 3, 4, 5, 6],
      middle: (g && g.MIDDLE_GRADES) || [7, 8, 9],
      high: (g && g.HIGH_GRADES) || [10, 11, 12]
    };
  }

  // 可考集子：语料里有正文、词条也能考（常识自带题那是 P3 的事，P1 只认正文）。
  function examinable(corpus) {
    var seen = {};
    (corpus || []).forEach(function (p) { if (p && p.book) seen[p.book] = 1; });
    return seen;
  }

  function scopes(corpus, opt) {
    var books = booksOf(opt);
    var have = examinable(corpus);
    var out = [{ id: "all", name: "全部", count: (corpus || []).length }];

    books.forEach(function (b) {
      if (!have[b.id]) return;
      out.push({
        id: "book:" + b.id, book: b.id, name: b.name,
        count: (corpus || []).filter(function (p) { return p && p.book === b.id; }).length
      });
    });

    // 课内再按学段切，方便「小学 / 初中 / 高中」这种考法。
    var sets = gradeSets();
    var hasPoems = have.poems;
    if (hasPoems) {
      STAGES.forEach(function (st) {
        var grades = sets[st.id] || [];
        if (!grades.length) return;
        var hit = (corpus || []).filter(function (p) {
          return p && p.book === "poems" && grades.indexOf(Number(p.grade)) >= 0;
        });
        if (!hit.length) return;
        out.push({ id: "poems:" + st.id, book: "poems", name: st.name, count: hit.length });
      });
    }
    return out;
  }

  // 取某一范围的条目。范围 id 不认识时如实回空数组（不悄悄退回全部）。
  //
  // ⚠️ **多选是合成 id**（Issue #356 第九轮）：首页那一段范围是**多选**的
  //    （用户原话：「供用户多选」），而组卷只需要**一个** scope。所以约定
  //    一个合成写法 `pick:<id1>+<id2>…` —— 由首页那一段拼（`js/game.js` 的
  //    `pickScope()`），**取谁仍然只在这里判**。
  //    为什么不把「筛好的语料」直接交给内核：`Exam.build()` 里还要按 scope
  //    再筛一次（逐题判是不是这一范围内），两处筛法一旦不一样就会打架
  //    （卷面写着 12 题、实际 8 题）。口径只有一处：**范围名单与取谁，全在这一节**。
  // ⚠️ 多选是**并集**、按顺序去重：同一篇既算「唐诗三百首」又算「小学」时只出一次
  //    （否则同一篇会被抽成两道同题）。
  function select(corpus, scopeId) {
    var id = String(scopeId == null ? "all" : scopeId);
    var cps = corpus || [];
    if (id === "all") return cps.slice();
    if (id.indexOf("pick:") === 0) {
      var parts = id.slice(5).split("+").filter(Boolean);
      if (!parts.length) return cps.slice();
      var seen = {}, out = [];
      parts.forEach(function (one) {
        select(cps, one).forEach(function (p) {
          var key = p && p.id != null ? String(p.id) : "";
          if (key && seen[key]) return;
          if (key) seen[key] = 1;
          out.push(p);
        });
      });
      return out;
    }
    if (id.indexOf("book:") === 0) {
      var book = id.slice(5);
      return cps.filter(function (p) { return p && p.book === book; });
    }
    if (id.indexOf("poems:") === 0) {
      var stage = id.slice(6);
      var grades = gradeSets()[stage] || [];
      if (!grades.length) return [];
      return cps.filter(function (p) {
        return p && p.book === "poems" && grades.indexOf(Number(p.grade)) >= 0;
      });
    }
    return [];
  }

  // ---------------------------------------------------------------------
  // 组卷：卷面 = 范围 × 形态 × 题量。题型仍是既有的一种（「给上句选下句」），
  // 入库的每一题都带 origin —— P1 只有 "kernel"（内核自动出）。
  // ---------------------------------------------------------------------
  function build(corpus, o) {
    var opt = o || {};
    var v = variant(opt.kind) || VARIANTS[0];
    var pool = select(corpus, opt.scope);
    var size = Number(opt.size);
    if (!(size > 0)) size = v.size;

    var bank = Quiz.buildBank(pool, { perPoem: 1, options: 4 });
    var seed = String(opt.seed == null ? "exam" : opt.seed);
    var questions = Quiz.paper({ bank: bank, size: size, seed: seed + ":" + v.id + ":" + (opt.scope || "all") });

    questions.forEach(function (q) { q.origin = "kernel"; });
    return {
      kind: v.id, cap: v.cap, tier: v.tier, name: v.name,
      scope: String(opt.scope == null ? "all" : opt.scope),
      size: questions.length, minutes: v.timed ? v.minutes : 0,
      judgedAfter: v.judge === "after",
      questions: questions,
      // 语料里凑不够题量时如实说 —— 不假装卷子有那么多题。
      short: questions.length < size ? size : 0
    };
  }

  // ---------------------------------------------------------------------
  // 判分：逐题比对仍在 Quiz.grade（纯字面），本模块只负责「批」与「算」。
  // 正式考试在交卷前不给对错 —— 判据在这里，界面上不许自己判。
  // ---------------------------------------------------------------------
  function batch(questions, picks) {
    var rows = [];
    var right = 0;
    (questions || []).forEach(function (q, i) {
      var chosen = (picks && picks[i]) || "";
      var r = Quiz.grade(q, chosen);
      if (r.ok) right += 1;
      rows.push({ index: i, poemId: q.poemId, title: q.title, origin: q.origin, chosen: chosen, answer: q.answer, ok: r.ok });
    });
    var total = rows.length;
    return {
      right: right, total: total, wrong: total - right,
      // 只给「这次 8 题对 6 题」这类事实，**不出「水平 XX 分」**（术语页那条承诺）。
      text: total ? "这次 " + total + " 题对 " + right + " 题" : "这一卷没有题目",
      rows: rows
    };
  }


  // ---------------------------------------------------------------------
  // 记录：本机一份练习记录（`poem_exam_v1`），**明确不上云**、**不进复习排期**。
  // 与每日计划那套背诵进度是两回事 ——
  // 批改权只能归 js/scheduler.js，游戏层不许自己写等级（§4.15 ④）。
  // ---------------------------------------------------------------------
  var RECORD_KEY = "poem_exam_v1";
  var RECORD_CAP = 50;

  function backingOf(opt) {
    if (opt && opt.backing) return opt.backing;
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    try { return (g && g.localStorage) || null; } catch (e) { return null; }
  }

  function readRecords(opt) {
    var b = backingOf(opt);
    if (!b) return [];
    var text = null;
    try { text = b.getItem(RECORD_KEY); } catch (e) { return []; }
    if (!text) return [];
    var rows = null;
    try { rows = JSON.parse(text); } catch (e) { return []; }
    return Array.isArray(rows) ? rows : [];
  }

  // 正式考试中途退出 = 不评分、不留记录 —— 所以这里**只有满分卷才写**，
  // 由调用方在「交卷那一刻」调，不在答题过程中调。
  function saveRecord(row, opt) {
    var b = backingOf(opt);
    if (!b) return { ok: false, why: "noStorage" };
    var rows = readRecords(opt);
    var rec = {
      at: Number(row && row.at) || Date.now(),
      kind: String((row && row.kind) || ""),
      scope: String((row && row.scope) || "all"),
      right: Number((row && row.right) || 0),
      total: Number((row && row.total) || 0)
    };
    rows.push(rec);
    if (rows.length > RECORD_CAP) rows = rows.slice(rows.length - RECORD_CAP);
    try { b.setItem(RECORD_KEY, JSON.stringify(rows)); }
    catch (e) { return { ok: false, why: "noStorage" }; }
    return { ok: true, record: rec };
  }

  function clearRecords(opt) {
    var b = backingOf(opt);
    if (!b) return { ok: false };
    try { b.removeItem(RECORD_KEY); } catch (e) { return { ok: false }; }
    return { ok: true };
  }

  return {
    VARIANTS: VARIANTS,
    STAGES: STAGES,
    SCOPES_GROUPS: SCOPES_GROUPS,
    scopeGroupOf: scopeGroupOf,
    variant: variant,
    scopes: scopes,
    select: select,
    build: build,
    batch: batch,
    RECORD_KEY: RECORD_KEY,
    readRecords: readRecords,
    saveRecord: saveRecord,
    clearRecords: clearRecords
  };
});
