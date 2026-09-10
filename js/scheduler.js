/**
 * 艾宾浩斯遗忘曲线复习调度器
 * ---------------------------------------------------
 * 设计说明：
 * 1. 每首诗拥有独立记忆档案：level（记忆阶段）、nextReviewAt（下次复习时间）、history（复习历史）。
 * 2. 采用经典艾宾浩斯复习间隔序列（天）：
 *    0（当天学习）→ 1 → 2 → 4 → 7 → 15 → 30 → 60 → 120 → 240
 *    间隔逐级翻倍，符合遗忘"先快后慢"的规律。
 * 3. 每次复习后按掌握程度调整：
 *    - 记住（good）  ：升级到下一阶段
 *    - 模糊（fuzzy） ：停留在当前阶段（间隔不增长），短期后再复习
 *    - 忘记（bad）   ：降级回上一阶段（最低回到第 0 阶段），重新走曲线
 * 4. 每日计划生成（generateDailyPlan）：
 *    - 优先挑选"到期需要复习"的诗（nextReviewAt <= 今天）
 *    - 不足 dailyCount 时，从当前年级/学期中顺序补充"从未学过"的新诗
 *    - 都取完仍不足则从其他年级补，保证每天稳定 5 首
 */
(function () {
  const DAY = 24 * 60 * 60 * 1000;

  // 艾宾浩斯复习间隔（天）
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
   * 生成每日背诵计划
   * @param {Object} opt
   *   opt.grade      当前年级（1-12）
   *   opt.term       当前学期（1/2）
   *   opt.count      每日数量，默认 5
   *   opt.provider   函数 (grade, term) => 诗词数组
   *   opt.getRecord  函数 (id) => 进度记录
   */
  function generateDailyPlan(opt) {
    const grade = Number(opt.grade);
    const term = Number(opt.term);
    const count = opt.count || 5;
    const provider = opt.provider;
    const getRecord = opt.getRecord;
    const now = Date.now();
    const current = provider(grade, term) || [];

    const plan = [];
    const used = {};

    // 1) 到期的复习诗：全库范围内查找（跨年级复习），优先当前年级学期
    const allPoems = window.POEMS_ALL || current;
    const dueAll = allPoems.filter(function (p) {
      const rec = getRecord(p.id);
      return isDue(rec, now);
    });
    // 当前年级学期到期的排前面
    dueAll.sort(function (a, b) {
      const aCur = a.grade === grade && a.term === term ? 0 : 1;
      const bCur = b.grade === grade && b.term === term ? 0 : 1;
      if (aCur !== bCur) return aCur - bCur;
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

    // 2) 补充未学过的新诗（当前年级学期优先）
    function fillFrom(list, reason) {
      list.forEach(function (p) {
        if (plan.length >= count || used[p.id]) return;
        const rec = getRecord(p.id);
        if (rec && rec.learned) return;
        used[p.id] = true;
        plan.push({ poem: p, reason: reason || "new", reviewRound: 0, lastReviewAt: null });
      });
    }

    fillFrom(current, "new");

    // 3) 仍然不足：从相邻年级/学期补
    if (plan.length < count) {
      const others = allPoems.filter(function (p) {
        return !(p.grade === grade && p.term === term);
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
      const remain = current.filter(function (p) {
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

  window.Scheduler = {
    INTERVALS: INTERVALS,
    createRecord: createRecord,
    review: review,
    isDue: isDue,
    mastery: mastery,
    levelName: levelName,
    generateDailyPlan: generateDailyPlan,
    stats: stats,
    nextTimeForLevel: nextTimeForLevel,
    daysBetween: daysBetween
  };
})();
