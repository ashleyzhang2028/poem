(function () {
  const DAY = 24 * 60 * 60 * 1000;

  const FALLBACK_INTERVALS = [0, 1, 2, 4, 7, 15, 30, 60, 120, 240];

  function algoKey() {
    if (!window.ReviewModels) return "ebbinghaus";
    const s = window.Storage ? window.Storage.getSettings() : null;
    const key = s && s.algo;
    return window.ReviewModels.known(key) ? key : window.ReviewModels.DEFAULT_KEY;
  }

  const MODEL_INTERVALS = {
    ebbinghaus: [0, 1, 2, 4, 7, 15, 30, 60, 120, 240],
    leitner: [1, 2, 4, 8, 16],
    sm2: [1, 3, 7, 15, 30, 60, 120, 180, 270, 365],
    fsrs: [1, 4, 11, 27, 65, 145, 310, 680]
  };

  function activeIntervals() {
    const key = algoKey();
    const t = MODEL_INTERVALS[key] || FALLBACK_INTERVALS;
    return t.slice();
  }

  const INTERVALS = activeIntervals();

  function stageCount() {
    return INTERVALS.length;
  }

  function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function today() {
    return startOfDay(Date.now());
  }

  function daysBetween(a, b) {
    return Math.round((startOfDay(b) - startOfDay(a)) / DAY);
  }

  function createRecord() {
    return {
      level: 0,
      nextReviewAt: Date.now(),
      lastReviewAt: null,
      reviewCount: 0,
      lapses: 0,
      learned: false,
      attempted: false,
      history: []
    };
  }

  function nextTimeForLevel(level, fromTs) {
    const lv = Math.max(0, Math.min(level, INTERVALS.length - 1));
    const days = INTERVALS[lv];
    return startOfDay(fromTs || Date.now()) + days * DAY + 9 * 60 * 60 * 1000;
  }

  function review(rec, result, algoKey) {
    if (window.ReviewModels && typeof window.ReviewModels.review === "function") {
      return window.ReviewModels.review(rec, result, algoKey);
    }

    const r = rec ? JSON.parse(JSON.stringify(rec)) : createRecord();
    const now = Date.now();

    r.attempted = true;
    if (r.learned === undefined) r.learned = true;
    r.learned = true;

    if (result === "fuzzy") {
      r.nextReviewAt = now + 12 * 60 * 60 * 1000;
    } else if (result === "bad") {
      r.level = Math.max(0, r.level - 1);
      r.lapses = (r.lapses || 0) + 1;
      r.nextReviewAt = now + 30 * 60 * 1000;
    } else {
      r.level = Math.min(r.level + 1, INTERVALS.length - 1);
      r.nextReviewAt = nextTimeForLevel(r.level, now);
    }
    r.lastReviewAt = now;
    r.reviewCount += 1;
    r.history.push({ at: now, result: result, level: r.level, algo: "ebbinghaus" });
    return r;
  }

  function isDue(rec, ts) {
    if (!rec || !(rec.attempted || rec.learned)) return false;
    return rec.nextReviewAt <= (ts === undefined ? Date.now() : ts);
  }

  function isLearned(rec) {
    if (!rec) return false;
    return !!(rec.attempted || rec.learned);
  }

  function mastery(rec) {
    if (!rec || !rec.learned) return 0;
    const denom = INTERVALS.length - 1;
    const base = (rec.level / denom) * 100;
    const penalty = Math.min(rec.lapses * 5, 20);
    return Math.max(0, Math.min(100, Math.round(base - penalty + 5)));
  }

  function levelName(level, rec) {
    if (rec && window.ReviewModels && window.ReviewModels.MODELS &&
        rec.algo && rec.algo !== "ebbinghaus" && window.ReviewModels.MODELS[rec.algo]) {
      return window.ReviewModels.MODELS[rec.algo].stageName(rec) || "学习中";
    }
    const names = ["新学", "1天后", "2天后", "4天后", "7天后", "15天后", "30天后", "60天后", "120天后", "已牢固"];
    return names[Math.max(0, Math.min(level, names.length - 1))] || "新学";
  }

  function stageNameOf(level) {

    const rec = createRecord();
    rec.level = level;
    rec.learned = level > 0;
    rec.algo = algoKey();
    return levelName(level, rec);
  }

  function stages() {
    const n = stageCount();
    const out = [];
    for (let i = 0; i < n; i += 1) out.push(stageNameOf(i));
    return out;
  }

  const SCOPES = {
    term: { label: "本册", scopeName: "本学期", terms: false, random: false, stages: ["current"] },
    upto: { label: "本册及之前", scopeName: "本学期及之前", terms: false, random: false, stages: ["upto"] },
    primary: { label: "小学随机", scopeName: "小学阶段", terms: true, random: true, stages: ["primary"] },
    middle: { label: "初中随机", scopeName: "初中阶段", terms: true, random: true, stages: ["middle"] },
    primary_middle: { label: "小学+初中随机", scopeName: "小学及初中阶段", terms: true, random: true, stages: ["primary", "middle"] },
    high: { label: "高中随机", scopeName: "高中阶段", terms: true, random: true, stages: ["high"] },
    all: { label: "全部随机", scopeName: "全部阶段", terms: true, random: true, stages: ["primary", "middle", "high"] }
  };

  const DEFAULT_SCOPE = "upto";

  function scopeOf(key) {
    return SCOPES[key] || SCOPES[DEFAULT_SCOPE];
  }

  function stageGrades(stage) {
    if (stage === "primary") return window.PRIMARY_GRADES || [1, 2, 3, 4, 5, 6];
    if (stage === "middle") return window.MIDDLE_GRADES || [7, 8, 9];
    return window.HIGH_GRADES || [10, 11, 12];
  }

  function poolForScope(opt) {
    const grade = Number(opt.grade);
    const term = Number(opt.term);
    const key = opt.scope || DEFAULT_SCOPE;
    const scope = scopeOf(key);
    const allPoems = (opt.allPoems || window.POEMS_ALL || []).slice();
    let pool;

    if (key === "term") {
      pool = allPoems.filter(function (p) {
        return p.grade === grade && p.term === term;
      });
    } else if (key === "upto") {
      pool = allPoems.filter(function (p) {
        return p.grade < grade || (p.grade === grade && p.term <= term);
      });
    } else {
      let inStage = [];
      scope.stages.forEach(function (st) {
        stageGrades(st).forEach(function (g) {
          inStage = inStage.concat(allPoems.filter(function (p) {
            return p.grade === g;
          }));
        });
      });
      if (inStage.length) pool = inStage;
      else pool = allPoems.filter(function (p) {
        return p.grade === grade && p.term === term;
      });
    }

    if (scope.terms) {
      pool.sort(function (a, b) {
        return (a.grade - b.grade) || (a.term - b.term);
      });
    }
    return pool;
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

  function gradeDistance(g, grade) {
    return Math.abs(g - grade);
  }

  function generateDailyPlan(opt) {
    const grade = Number(opt.grade);
    const term = Number(opt.term);
    const count = opt.count || 5;
    const getRecord = opt.getRecord;
    const now = Date.now();
    const current = (opt.provider ? opt.provider(grade, term) : []) || [];
    const allPoems = window.POEMS_ALL || current;
    const scope = scopeOf(opt.scope);

    let pool = poolForScope({ grade: grade, term: term, scope: opt.scope, allPoems: allPoems });

    if (!pool.length) pool = current.slice();
    if (scope.random) {
      pool = shuffle(pool);
    } else {
      pool.sort(function (a, b) {
        const aCur = a.grade === grade && a.term === term ? 0 : 1;
        const bCur = b.grade === grade && b.term === term ? 0 : 1;
        if (aCur !== bCur) return aCur - bCur;
        const ag = gradeDistance(a.grade, grade);
        const bg = gradeDistance(b.grade, grade);
        if (ag !== bg) return ag - bg;
        return (a.term - b.term) || 0;
      });
    }

    const plan = [];
    const used = {};

    const extra = (opt.extraPoems || []).filter(function (p) {
      return p && p.id;
    });
    const extraById = {};
    const extraList = [];
    extra.forEach(function (p) {
      if (extraById[p.id]) return;
      extraById[p.id] = true;
      extraList.push(p);
    });

    const courseIds = {};
    allPoems.forEach(function (p) { courseIds[p.id] = true; });

    const dueAll = allPoems.concat(extraList.filter(function (p) { return !courseIds[p.id]; })).filter(function (p) {
      return isDue(getRecord(p.id), now);
    });

    const inPool = {};
    pool.forEach(function (p) {
      inPool[p.id] = true;
    });
    dueAll.sort(function (a, b) {
      const aIn = inPool[a.id] ? 0 : 1;
      const bIn = inPool[b.id] ? 0 : 1;
      if (aIn !== bIn) return aIn - bIn;
      const ra = getRecord(a.id);
      const rb = getRecord(b.id);
      return (ra ? ra.nextReviewAt : 0) - (rb ? rb.nextReviewAt : 0);
    });
    dueAll.forEach(function (p) {
      if (plan.length < count && !used[p.id]) {
        used[p.id] = true;
        const rec = getRecord(p.id);
        plan.push({
          poem: p,
          reason: "review",
          reviewRound: rec ? rec.level + 1 : 1,
          lastReviewAt: rec ? rec.lastReviewAt : null
        });
      }
    });

    function fillFrom(list, reason) {
      list.forEach(function (p) {
        if (plan.length >= count || used[p.id]) return;
        const rec = getRecord(p.id);
        if (isLearned(rec)) return;
        used[p.id] = true;
        plan.push({ poem: p, reason: reason || "new", reviewRound: 0, lastReviewAt: null });
      });
    }

    fillFrom(pool, "new");

    fillFrom(extraList.filter(function (p) { return !courseIds[p.id]; }), "optional");

    if (plan.length < count) {
      const others = allPoems.filter(function (p) {
        return !used[p.id] && !(p.grade === grade && p.term === term);
      });
      others.sort(function (a, b) {
        const da = Math.abs(a.grade - grade) * 10 + Math.abs(a.term - term);
        const db = Math.abs(b.grade - grade) * 10 + Math.abs(b.term - term);
        return da - db;
      });
      fillFrom(others, "new");
    }

    if (plan.length < count) {
      const remain = (scope.random ? shuffle(pool) : pool.concat(current))
        .concat(extraList.filter(function (p) { return !courseIds[p.id]; }))
        .filter(function (p) {
          return !used[p.id];
        });
      remain.forEach(function (p) {
        if (plan.length >= count) return;
        used[p.id] = true;
        const rec = getRecord(p.id);
        plan.push({
          poem: p,
          reason: "extra",
          reviewRound: rec ? rec.level + 1 : 1,
          lastReviewAt: rec ? rec.lastReviewAt : null
        });
      });
    }

    return plan;
  }

  function stats(poems, getRecord) {
    const total = poems.length;
    let learned = 0;
    let mastered = 0;
    let dueToday = 0;
    const now = Date.now();

    const solid = Math.max(1, Math.floor((stageCount() - 1) * 0.55));
    poems.forEach(function (p) {
      const rec = getRecord(p.id);
      if (isLearned(rec)) {
        learned += 1;
        if (rec.level >= solid) mastered += 1;
        if (isDue(rec, now)) dueToday += 1;
      }
    });
    return { total: total, learned: learned, mastered: mastered, dueToday: dueToday };
  }

  function overview(poems, getRecord, opt) {
    const o = opt || {};
    const days = o.days || 14;
    const now = o.now || Date.now();
    const today0 = startOfDay(now);

    const nStages = stageCount();

    const list = (poems || []).filter(function (p) { return p && p.id; });
    const total = list.length;
    let learned = 0;
    const calendar = [];
    const overdue = [];
    const levels = [];
    const masteryBuckets = [0, 0, 0, 0, 0];
    let masterySum = 0;

    for (let i = 0; i < days; i += 1) {
      const ts = today0 + i * DAY;
      calendar.push({ offset: i, date: ts, count: 0, due: false });
    }

    const seen = {};
    list.forEach(function (p) {
      if (seen[p.id]) return;
      seen[p.id] = true;
      const rec = getRecord(p.id);
      if (!isLearned(rec)) return;
      learned += 1;

      const m = mastery(rec);
      masterySum += m;
      const bi = Math.min(4, Math.floor(m / 20));
      masteryBuckets[bi] += 1;

      levels.push({ id: p.id, level: Math.max(0, Math.min(rec.level, nStages - 1)) });

      const at = rec.nextReviewAt;
      const off = Math.round((startOfDay(at) - today0) / DAY);
      if (off < -7) {
        overdue.push(p.id);
      } else if (off < 0) {
        calendar[0].count += 1;
      } else if (off < days) {
        calendar[off].count += 1;
      }
      if (off <= 0) calendar[0].due = true;
    });

    const levelCounts = [];

    const algoName = window.ReviewModels
      ? window.ReviewModels.MODELS[o.algo || ""]
      : null;
    for (let i = 0; i < INTERVALS.length; i += 1) {
      const nm = algoName
        ? algoName.stageName({ level: i, box: i, learned: i > 0, interval: FALLBACK_INTERVALS[i] || 1, ef: 2.5,
          stability: INTERVALS[i] || 1, difficulty: 5 })
        : levelName(i);
      levelCounts.push({ level: i, name: nm, count: 0 });
    }
    levels.forEach(function (x) { levelCounts[x.level].count += 1; });

    return {
      total: total,
      learned: learned,
      unlearned: Math.max(0, total - learned),
      dueToday: calendar[0].count + overdue.length,
      overdue: overdue.length,
      avgMastery: learned ? Math.round(masterySum / learned) : 0,
      calendar: calendar,
      levelCounts: levelCounts,
      masteryBuckets: masteryBuckets,

      maxDay: calendar.reduce(function (a, d) { return Math.max(a, d.count); }, 0)
    };
  }

  function daysUntilDue(rec, now) {
    if (!rec || !rec.learned || !rec.nextReviewAt) return null;
    const t0 = startOfDay(now === undefined ? Date.now() : now);
    return Math.round((startOfDay(rec.nextReviewAt) - t0) / DAY);
  }

  function dueList(poems, getRecord, opt) {
    const o = opt || {};
    const days = o.days || 14;
    const now = o.now || Date.now();
    const today0 = startOfDay(now);

    const list = (poems || []).filter(function (p) { return p && p.id; });
    const out = [];
    for (let i = 0; i < days; i += 1) {
      out.push({ offset: i, date: today0 + i * DAY, items: [] });
    }
    const backlog = [];
    const seen = {};
    let total = 0;
    let farther = 0;

    list.forEach(function (p) {
      if (seen[p.id]) return;
      seen[p.id] = true;
      const rec = getRecord(p.id);
      if (!rec || !rec.learned) return;
      const off = Math.round((startOfDay(rec.nextReviewAt) - today0) / DAY);

      const item = {
        id: p.id,
        title: p.title || "",
        author: p.author || "",
        dynasty: p.dynasty || "",
        level: Math.max(0, Math.min(rec.level, INTERVALS.length - 1)),
        mastery: mastery(rec),
        nextReviewAt: rec.nextReviewAt,
        daysLeft: off,

        stageName: levelName(rec.level, rec),
        algo: rec.algo || null
      };
      if (off < -7) {
        backlog.push(item);
      } else if (off < 0) {
        out[0].items.push(item);
      } else if (off < days) {
        out[off].items.push(item);
      } else {

        farther += 1;
        return;
      }
      total += 1;
    });

    const byUrgency = function (a, b) {
      if (a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft;
      if (a.mastery !== b.mastery) return a.mastery - b.mastery;
      return a.id < b.id ? -1 : 1;
    };
    out.forEach(function (d) { d.items.sort(byUrgency); });
    backlog.sort(byUrgency);

    return { days: out, backlog: backlog, total: total, farther: farther };
  }

  window.Scheduler = {

    get INTERVALS() { return activeIntervals(); },
    intervals: activeIntervals,
    stageCount: stageCount,
    stageNameOf: stageNameOf,
    stages: stages,
    isLearned: isLearned,
    algoKey: algoKey,
    overview: overview,
    daysUntilDue: daysUntilDue,
    dueList: dueList,
    startOfDay: startOfDay,
    DAY: DAY,
    createRecord: createRecord,
    review: review,
    isDue: isDue,
    mastery: mastery,
    levelName: levelName,
    generateDailyPlan: generateDailyPlan,
    SCOPES: SCOPES,
    DEFAULT_SCOPE: DEFAULT_SCOPE,
    scopeOf: scopeOf,
    poolForScope: poolForScope,
    stats: stats,
    nextTimeForLevel: nextTimeForLevel,
    daysBetween: daysBetween
  };
})();
