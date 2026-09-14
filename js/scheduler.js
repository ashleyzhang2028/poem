/**
 * 遗忘曲线复习调度器
 * ---------------------------------------------------
 * 设计说明：
 * 1. 每首诗拥有独立记忆档案：level（记忆阶段）、nextReviewAt（下次复习时间）、history（复习历史）。
 * 2. 采用经典遗忘曲线复习间隔序列（天）：
 *    0（当天学习）→ 1 → 2 → 4 → 7 → 15 → 30 → 60 → 120 → 240
 *    间隔逐级翻倍，符合遗忘"先快后慢"的规律。
 * 3. 每次复习后按掌握程度调整：
 *    - 记住（good）  ：升级到下一阶段
 *    - 模糊（fuzzy） ：停留在当前阶段（间隔不增长），短期后再复习
 *    - 忘记（bad）   ：降级回上一阶段（最低回到第 0 阶段），重新走曲线
 * 4. 每日计划生成（generateDailyPlan）：
 *    - 优先挑选"到期需要复习"的诗（nextReviewAt <= 今天）
 *    - 不足 dailyCount 时，从「背诵范围」（scope，见 SCOPES）中补充"从未学过"的新诗：
 *      本册 / 本册及之前 / 小学随机 / 初中随机 / 小学+初中随机 / 高中随机 / 全部随机
 *    - 仍不足则从其他年级补，保证每天稳定 5 首
 */
(function () {
  const DAY = 24 * 60 * 60 * 1000;

  // 遗忘曲线复习间隔（天）
  const INTERVALS = [0, 1, 2, 4, 7, 15, 30, 60, 120, 240];
  // 模糊（fuzzy）时的短间隔（小时）
  const FUZZY_HOURS = 12;

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

  /** 新诗初始化档案 */
  function createRecord() {
    return {
      level: 0,
      nextReviewAt: Date.now(),
      lastReviewAt: null,
      reviewCount: 0,
      lapses: 0,
      learned: false,
      history: []
    };
  }

  /** 根据阶段计算下一次复习时间（从今天算起） */
  function nextTimeForLevel(level, fromTs) {
    const lv = Math.max(0, Math.min(level, INTERVALS.length - 1));
    const days = INTERVALS[lv];
    return startOfDay(fromTs || Date.now()) + days * DAY + 9 * 60 * 60 * 1000; // 当天 09:00 复习
  }

  /** 记录一次复习结果 */
  function review(rec, result) {
    const r = rec ? JSON.parse(JSON.stringify(rec)) : createRecord();
    const now = Date.now();

    if (result === "good") {
      r.level = Math.min(r.level + 1, INTERVALS.length - 1);
    } else if (result === "fuzzy") {
      // 停留当前阶段，12 小时后再来
      r.nextReviewAt = now + FUZZY_HOURS * 60 * 60 * 1000;
      r.lastReviewAt = now;
      r.reviewCount += 1;
      r.learned = true;
      r.history.push({ at: now, result: result, level: r.level });
      return r;
    } else {
      // bad：降级重来
      r.level = Math.max(0, r.level - 1);
      r.lapses += 1;
      r.nextReviewAt = now + 30 * 60 * 1000; // 30 分钟后再来一次
      r.lastReviewAt = now;
      r.reviewCount += 1;
      r.learned = true;
      r.history.push({ at: now, result: result, level: r.level });
      return r;
    }

    r.nextReviewAt = nextTimeForLevel(r.level, now);
    r.lastReviewAt = now;
    r.reviewCount += 1;
    r.learned = true;
    r.history.push({ at: now, result: result, level: r.level });
    return r;
  }

  /** 是否到期需要复习 */
  function isDue(rec, ts) {
    if (!rec || !rec.learned) return false;
    return rec.nextReviewAt <= (ts === undefined ? Date.now() : ts);
  }

  /** 掌握度百分比（用于 UI 展示） */
  function mastery(rec) {
    if (!rec || !rec.learned) return 0;
    const denom = INTERVALS.length - 1;
    const base = (rec.level / denom) * 100;
    const penalty = Math.min(rec.lapses * 5, 20);
    return Math.max(0, Math.min(100, Math.round(base - penalty + 5)));
  }

  /** 阶段名称 */
  function levelName(level) {
    const names = ["新学", "1天后", "2天后", "4天后", "7天后", "15天后", "30天后", "60天后", "120天后", "已牢固"];
    return names[Math.max(0, Math.min(level, names.length - 1))] || "新学";
  }

  /**
   * 背诵范围选项（设置里的「背诵范围」）
   *   term          本年级本学期（默认）
   *   upto          本年级本学期及之前学过的全部内容
   *   primary       小学阶段随机
   *   middle        初中阶段随机
   *   primary_middle 小学 + 初中随机
   *   high          高中阶段随机
   *   all           全部阶段随机
   */
  const SCOPES = {
    term: { label: "本册", scopeName: "本年级本学期", terms: false, random: false, stages: ["current"] },
    upto: { label: "本册及之前", scopeName: "本年级本学期及之前", terms: false, random: false, stages: ["upto"] },
    primary: { label: "小学随机", scopeName: "小学阶段", terms: true, random: true, stages: ["primary"] },
    middle: { label: "初中随机", scopeName: "初中阶段", terms: true, random: true, stages: ["middle"] },
    primary_middle: { label: "小学+初中随机", scopeName: "小学及初中阶段", terms: true, random: true, stages: ["primary", "middle"] },
    high: { label: "高中随机", scopeName: "高中阶段", terms: true, random: true, stages: ["high"] },
    all: { label: "全部随机", scopeName: "全部阶段", terms: true, random: true, stages: ["primary", "middle", "high"] }
  };

  const DEFAULT_SCOPE = "term";

  function scopeOf(key) {
    return SCOPES[key] || SCOPES[DEFAULT_SCOPE];
  }

  function stageGrades(stage) {
    if (stage === "primary") return window.PRIMARY_GRADES || [1, 2, 3, 4, 5, 6];
    if (stage === "middle") return window.MIDDLE_GRADES || [7, 8, 9];
    return window.HIGH_GRADES || [10, 11, 12];
  }

  /**
   * 按背诵范围取出候选诗词
   * @returns {Array} 候选诗词（顺序：term/upto 为教材顺序，随机范围为随机顺序）
   */
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

  /** 由外向内扩散的年级距离（用于「本册及之前」优先取最近学期） */
  function gradeDistance(g, grade) {
    return Math.abs(g - grade);
  }

  /**
   * 生成每日背诵计划
   * @param {Object} opt
   *   opt.grade      当前年级（1-12）
   *   opt.term       当前学期（1/2）
   *   opt.count      每日数量，默认 5
   *   opt.scope      背诵范围（见 SCOPES），默认本年级本学期
   *   opt.provider   函数 (grade, term) => 诗词数组
   *   opt.getRecord  函数 (id) => 进度记录
   *   opt.extraPoems 自选集合里「额外想背」的篇目（见 js/collections.js）。
   *                  它们**不属任何学段**，但一样要按遗忘曲线复习：
   *                  到期的排在最前，未学过的在课内之后补位。
   *                  每一项需带 id / title / text（以及可选的 translation 等）。
   */
  function generateDailyPlan(opt) {
    const grade = Number(opt.grade);
    const term = Number(opt.term);
    const count = opt.count || 5;
    const getRecord = opt.getRecord;
    const now = Date.now();
    const current = (opt.provider ? opt.provider(grade, term) : []) || [];
    const allPoems = window.POEMS_ALL || current;
    const scope = scopeOf(opt.scope);

    // 候选池：
    // - 固定范围（本册 / 本册及之前）：教材顺序，优先本册，再按年级、学期由近到远
    // - 随机范围（各学段）：随机打乱后取前 N 首
    let pool = poolForScope({ grade: grade, term: term, scope: opt.scope, allPoems: allPoems });
    // 数据缺省时兜底到本册
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

    // 0) 自选集合的篇目：与课内同一套遗忘曲线，只是不属于任何学段 / 学期。
    //    按 id 去重（同一篇在多个集合里各存一份引用，只算一次）；
    //    与课内已经同篇的也要去重 —— 由调用方给 extraPoems 时保证 id 已合流
    //    （见 js/collections.js 的 poemIdFor / WorksIndex.repOf）。
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
    // 课内池里已有的 id 不再重复当作自选篇目（判重兜底）
    const courseIds = {};
    allPoems.forEach(function (p) { courseIds[p.id] = true; });

    // 1) 到期的复习诗（范围之外已学过的诗也应复习，避免遗忘）
    const dueAll = allPoems.concat(extraList.filter(function (p) { return !courseIds[p.id]; })).filter(function (p) {
      return isDue(getRecord(p.id), now);
    });
    // 范围内的排前面，其次按到期时间先后
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

    // 2) 补充未学过的新诗（范围优先，其次相邻学期）
    function fillFrom(list, reason) {
      list.forEach(function (p) {
        if (plan.length >= count || used[p.id]) return;
        const rec = getRecord(p.id);
        if (rec && rec.learned) return;
        used[p.id] = true;
        plan.push({ poem: p, reason: reason || "new", reviewRound: 0, lastReviewAt: null });
      });
    }

    fillFrom(pool, "new");

    // 2.5) 课内新诗排完之后，轮到自选集合里还没学过的
    fillFrom(extraList.filter(function (p) { return !courseIds[p.id]; }), "optional");

    // 3) 仍然不足：从相邻年级/学期补
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

    // 4) 极端情况：全部学过且未到期，仍补满（每日巩固）
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

  /** 当前年级/学期总体统计 */
  function stats(poems, getRecord) {
    const total = poems.length;
    let learned = 0;
    let mastered = 0;
    let dueToday = 0;
    const now = Date.now();
    poems.forEach(function (p) {
      const rec = getRecord(p.id);
      if (rec && rec.learned) {
        learned += 1;
        if (rec.level >= 5) mastered += 1;
        if (isDue(rec, now)) dueToday += 1;
      }
    });
    return { total: total, learned: learned, mastered: mastered, dueToday: dueToday };
  }

  /**
   * 进度总览：把「所有有记录的篇目」摊成一张可视化用的表。
   *
   * 为什么要单独做这一层：页面原先只看得到「这一篇在第几轮」——
   * 第几轮是**单篇**的视角，看不出「接下来哪天要复习几篇」「掌握度都堆在哪」。
   * 到期日历与掌握度分布要的是**全量**的聚合，所以在这里一次算好：
   *   · calendar —— 未来 N 天每天到期的篇数（含「已逾期」那一档单独计）
   *   · levels   —— 每个记忆阶段（新学 / 1 天后 / …… / 已牢固）各有多少篇
   *   · mastery  —— 掌握度分五档（0-19 / 20-39 / 40-59 / 60-79 / 80-100）
   *
   * ⚠️ **已逾期的算进「今天」那一档**，日历上不显示成负数的日期：
   * 逾期就是「今天该复习」，单独列一条会让日历第一格永远是空的。
   *    逾期超过 7 天的单列一条「逾期 7 天以上」——那是真正需要提醒的。
   *
   * @param {Array} poems  候选篇目（`{id}` 即可）
   * @param {Function} getRecord  id → 记忆档案
   * @param {Object} [opt]  opt.days 日历天数（默认 14），opt.now 基准时间
   */
  function overview(poems, getRecord, opt) {
    const o = opt || {};
    const days = o.days || 14;
    const now = o.now || Date.now();
    const today0 = startOfDay(now);

    const list = (poems || []).filter(function (p) { return p && p.id; });
    const total = list.length;
    let learned = 0;
    const calendar = [];          // [{ offset: 0..days-1, label, date, count }]
    const overdue = [];           // 逾期 7 天以上单列
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
      if (!rec || !rec.learned) return;
      learned += 1;

      // 掌握度分档：与 mastery() 同一把尺子（它是页面到处在用的那一个）
      const m = mastery(rec);
      masterySum += m;
      const bi = Math.min(4, Math.floor(m / 20));
      masteryBuckets[bi] += 1;

      levels.push({ id: p.id, level: Math.max(0, Math.min(rec.level, INTERVALS.length - 1)) });

      // 到期归档：逾期 → 今天那一格；再往前 7 天以上的单列
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
    for (let i = 0; i < INTERVALS.length; i += 1) {
      levelCounts.push({ level: i, name: levelName(i), count: 0 });
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
      // 未来 N 天里哪天最忙（一条竖条的最高那根，画图时要用它定高）
      maxDay: calendar.reduce(function (a, d) { return Math.max(a, d.count); }, 0)
    };
  }

  /**
   * 再过几天该复习 —— 「下次何时到期」这个数。
   *
   * 未被学过的返回 null（没学过就谈不上「下次」）；
   * 已逾期的返回 0 或负数（页面显示成「已到期」）。
   */
  function daysUntilDue(rec, now) {
    if (!rec || !rec.learned || !rec.nextReviewAt) return null;
    const t0 = startOfDay(now === undefined ? Date.now() : now);
    return Math.round((startOfDay(rec.nextReviewAt) - t0) / DAY);
  }

  window.Scheduler = {
    INTERVALS: INTERVALS,
    overview: overview,
    daysUntilDue: daysUntilDue,
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
