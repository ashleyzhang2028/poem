(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./quiz.js"));
  else root.Exam = factory(root.Quiz);
})(typeof globalThis !== "undefined" ? globalThis : this, function (Quiz) {
  "use strict";

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

    var STAGES = [
    { id: "primary", name: "小学" },
    { id: "middle", name: "初中" },
    { id: "high", name: "高中" }
  ];

  function variant(id) {
    for (var i = 0; i < VARIANTS.length; i++) if (VARIANTS[i].id === id) return VARIANTS[i];
    return null;
  }

    var SCOPES_GROUPS = ["全部", "课内诗词", "其他集子"];

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
            short: questions.length < size ? size : 0
    };
  }

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
            text: total ? "这次 " + total + " 题对 " + right + " 题" : "这一卷没有题目",
      rows: rows
    };
  }

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
