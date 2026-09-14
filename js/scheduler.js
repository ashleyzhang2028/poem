/**
 * 背诵调度器：每日计划 + 进度总览
 * ==========================================================================
 * 这一份是**排期层**：决定「今天背哪几首」「进度怎么摊开看」。
 * 至于「这一篇下次什么时候复习、现在算哪个阶段」—— 那是**算法层**
 * （js/review-models.js）的事，这里只负责把每一条记忆档案交给它算。
 *
 * ## 复习算法可切换（见设置页「复习算法」）
 *
 * 站上原先只有一种固定间隔表（0→1→2→4→7→15→30→60→120→240 天）。
 * 现在算法做成注册表，用户可切：遗忘曲线 / 莱特纳盒 / SM-2 / FSRS。
 * 本文件**不写死任何公式** —— 排期转交 window.ReviewModels.review()，
 * 阶段名与阶段数走 ReviewModels 的模型定义，否则会出现
 * 「按 SM-2 复习，界面上却写着 1 天后 / 4 天后」这种自相矛盾的画面。
 *
 * 档案字段各算法共用一套：`{level, nextReviewAt, lastReviewAt, reviewCount,
 * lapses, learned, history}`，只有 level 的含义随算法变；
 * 各算法自己要的额外变量（SM-2 的 interval/EF、FSRS 的 S/D）直接存在
 * 档案本身上，由 ReviewModels.adopt() / review() 维护。
 *
 * ## 每日计划生成（generateDailyPlan）
 *
 * 1. 优先挑选「到期需要复习」的篇目（nextReviewAt <= 今天）
 * 2. 不足 dailyCount 时，从「背诵范围」（scope，见 SCOPES）里补充「从未学过」的新诗
 * 3. 仍不足则从其他年级补，保证每天稳定 N 首
 */
(function () {
  const DAY = 24 * 60 * 60 * 1000;

  // 算法层没加载时的兜底（页面脚本顺序不对、或单测只加载本文件）
  const FALLBACK_INTERVALS = [0, 1, 2, 4, 7, 15, 30, 60, 120, 240];

  /** 当前复习算法键（认不出来退回出厂默认） */
  function algoKey() {
    if (!window.ReviewModels) return "ebbinghaus";
    const s = window.Storage ? window.Storage.getSettings() : null;
    const key = s && s.algo;
    return window.ReviewModels.known(key) ? key : window.ReviewModels.DEFAULT_KEY;
  }

  /**
   * 当前算法的复习间隔（天）—— 只作为**调用方与测试的兼容出口**保留。
   *
   * 出厂模型（遗忘曲线）是一张固定的间隔表；其余三张的间隔是「走出来」的
   * （Leitner 看盒号、SM-2 看 EF、FSRS 看稳定性），这里给出该模型自己的
   * 间隔表。调用方（含历史测试）拿它当「阶段有几档」的尺子：
   * `Scheduler.INTERVALS.length` 就等于阶段总数，算法一换它就跟着换。
   */
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
  // 兼容旧调用方的常量形态：取一次当前算法
  const INTERVALS = activeIntervals();

  /** 当前算法的阶段总数（= INTERVALS.length；算法层缺席时按兜底表算） */
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

  /**
   * 新诗初始化档案
   *
   * ⚠️ 新增了 `attempted` 字段（老档没有，读到缺省值）。
   * 它区分「点开看过、当时选了『模糊 / 忘记』」与「还没碰过」：
   * 前者已经算学过了（该按算法排复习），后者才是「今天该新学一首」。
   * 原先判的是 `learned`，而原先的 review() 在每一条分支里都把它置真 ——
   * 于是「模糊 / 忘记」的第一遍也被当成学过。现在按分支各置各的，更准确。
   */
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

  /**
   * 根据阶段算下一次复习时间（从今天算起）
   * 当前算法已封顶（「已牢固 / 出盒」那一档）时保持原样，不再往后推。
   */
  function nextTimeForLevel(level, fromTs) {
    const lv = Math.max(0, Math.min(level, INTERVALS.length - 1));
    const days = INTERVALS[lv];
    return startOfDay(fromTs || Date.now()) + days * DAY + 9 * 60 * 60 * 1000; // 当天 09:00 复习
  }

  /**
   * 记录一次复习结果。
   *
   * ⚠️ 从「可切换复习算法」那一轮起，这里**转交**给 js/review-models.js：
   *    下一次什么时候复习，取决于用户选的是哪张模型（遗忘曲线 / Leitner /
   *    SM-2 / FSRS 简化版，见该文件顶部的取舍说明）。本函数只留一条兜底 ——
   *    页面没加载 review-models.js 时（例如只跑调度单测）行为与旧版逐条一致。
   *
   * `algo` 传当前选定的模型；不传则沿用记录自己记着的那个（旧记录没有就
   * 取出厂默认「遗忘曲线」）。于是：
   *   · 同一份进度在换模型后，**新复习的**按新模型算；
   *   · 旧记录不会被静默改写 —— 换模型时的换算见 ReviewModels.adopt()。
   *
   * 掌握度 / 阶段名这些**展示口径**不在这里改（仍走 mastery() / levelName()），
   * 否则同一份进度在首页与进度页会显示两个数。
   */
  function review(rec, result, algoKey) {
    if (window.ReviewModels && typeof window.ReviewModels.review === "function") {
      return window.ReviewModels.review(rec, result, algoKey);
    }
    // 算法层缺席时的兜底：按遗忘曲线那张表办（与升级前完全一致）
    const r = rec ? JSON.parse(JSON.stringify(rec)) : createRecord();
    const now = Date.now();

    r.attempted = true;
    if (r.learned === undefined) r.learned = true; // 老档兼容：能走到这里就是学过了
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

  /** 是否到期需要复习（还没背过的篇目不算「到期」—— 那条路是「今天新学」） */
  function isDue(rec, ts) {
    if (!rec || !(rec.attempted || rec.learned)) return false;
    return rec.nextReviewAt <= (ts === undefined ? Date.now() : ts);
  }

  /** 这一篇是不是已经背过（老档没有 attempted 时按 learned 判） */
  function isLearned(rec) {
    if (!rec) return false;
    return !!(rec.attempted || rec.learned);
  }

  /**
   * 掌握度百分比（用于 UI 展示）。
   *
   * ⚠️ **换模型不改这把尺子**：它一直是「阶段号打底、遗忘次数扣分」，
   * 而 `level` 是所有模型都在维护的公用字段（见 js/review-models.js 的
   * adopt()：换模型时 level 原样保留）。所以进度页的掌握度分布在换模型后
   * 仍然可比 —— 若这里按各模型自己的量（EF / S / 盒号）另算一套，
   * 用户换个模型就会发现「掌握度」整片重排，那更像 bug 而不是功能。
   */
  function mastery(rec) {
    if (!rec || !rec.learned) return 0;
    const denom = INTERVALS.length - 1;
    const base = (rec.level / denom) * 100;
    const penalty = Math.min(rec.lapses * 5, 20);
    return Math.max(0, Math.min(100, Math.round(base - penalty + 5)));
  }

  /**
   * 阶段名称 —— 「这篇现在走到哪一步」。
   *
   * 出厂模型（遗忘曲线）下就是那张间隔表的读法：1天后 / 2天后 / ……。
   * 换了模型则按**该模型自己的说法**给名字（Leitner 说「3 号盒」、
   * SM-2 说「间隔 7 天 · 简易度 2.5」、FSRS 说「稳定 12.3 天」）——
   * 否则用户选了 FSRS 却看到「15天后」这种遗忘曲线的档名，会以为没生效。
   * 名字的取法在 js/review-models.js 里（各模型最清楚自己那几个量叫什么），
   * 本函数只负责「没有模型层时退回旧的固定档名」。
   */
  function levelName(level, rec) {
    if (rec && window.ReviewModels && window.ReviewModels.MODELS &&
        rec.algo && rec.algo !== "ebbinghaus" && window.ReviewModels.MODELS[rec.algo]) {
      return window.ReviewModels.MODELS[rec.algo].stageName(rec) || "学习中";
    }
    const names = ["新学", "1天后", "2天后", "4天后", "7天后", "15天后", "30天后", "60天后", "120天后", "已牢固"];
    return names[Math.max(0, Math.min(level, names.length - 1))] || "新学";
  }

  /**
   * 阶段名的**定尺**版本：用一个临时档案按该档的「中位阶段」算名字。
   *
   * 有些算法（SM-2）的阶段名要看档案里的 EF 才推得出「下一轮多少天」，
   * 而进度页要画的是「每一档叫什么，各有多少篇」—— 那里没有档案可给。
   * 这里就造一个空档（EF 走初值）去取名，保证图上的刻度与单篇的文案同源。
   */
  function stageNameOf(level) {
    // 造一个「停在第 level 档」的临时档案：SM-2 的阶段名要看 EF、
    // FSRS 要看稳定性，都是各模型最清楚自己那几个量该怎么说
    const rec = createRecord();
    rec.level = level;
    rec.learned = level > 0;
    rec.algo = algoKey();
    return levelName(level, rec);
  }

  /** 当前算法一共几档（进度页要按它铺刻度） */
  function stages() {
    const n = stageCount();
    const out = [];
    for (let i = 0; i < n; i += 1) out.push(stageNameOf(i));
    return out;
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
        if (isLearned(rec)) return;
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
    // 「较牢固」的门槛：走到当前算法的后 1/3 阶段（原先写死 level>=5，
    // 那是按遗忘曲线 10 档定的；莱特纳盒只有 6 档，写死就永远没有「较牢固」了）
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
   * @param {Object} [opt]  opt.days 日历天数（默认 14），opt.now 基准时间，
   *                         opt.algo 当前复习算法（决定「记忆阶段」那几档怎么说，
   *                         见 js/review-models.js；缺省则说出厂算法的话）
   */
  function overview(poems, getRecord, opt) {
    const o = opt || {};
    const days = o.days || 14;
    const now = o.now || Date.now();
    const today0 = startOfDay(now);
    // 当前算法的阶段总数（遗忘曲线 10 档 / 莱特纳盒 6 盒 / SM-2 11 档 / FSRS 8 档）：
    // 下面归档与摊表都用它，必须在使用之前取好
    const nStages = stageCount();

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
      if (!isLearned(rec)) return;
      learned += 1;

      // 掌握度分档：与 mastery() 同一把尺子（它是页面到处在用的那一个）
      const m = mastery(rec);
      masterySum += m;
      const bi = Math.min(4, Math.floor(m / 20));
      masteryBuckets[bi] += 1;

      levels.push({ id: p.id, level: Math.max(0, Math.min(rec.level, nStages - 1)) });

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
    /* 档名：出厂算法就是那张间隔表的读法（1天后 / 2天后 / …）；
       换了算法则说该算法的阶段名。**档位本身（i = 0..9）不变** ——
       它是「连续记住几次」的通用刻度，换算法不该让分布图整片重排。 */
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

  /**
   * 到期篇目清单：把「哪天到期几篇」摊开成「哪天到期是**哪几篇**」。
   *
   * 与 overview() 是同一本账的两种数法（口径必须一致，否则日历上的数字
   * 与点进去看到的篇数对不上，用户第一个反应是「这页坏了」）：
   *   · overview().calendar[i].count  —— 第 i 天有几篇（画竖条）
   *   · dueList().days[i].items       —— 第 i 天是**哪几篇**（本函数）
   * 两处都按同一套归档规则，所以：
   *   days[0].items.length === calendar[0].count   （今天那一档，逾期 7 天以内的并进来）
   *   backlog.length         === overview().overdue（逾期 7 天以上的单列）
   * 页面把 backlog 另起一小截放在「今天」那一档的下面 ——
   *   它不并进天数，这样日历与清单**逐格对得上**，同时用户又看得到那几篇。
   *
   * 为什么单独一个函数、而不是让页面自己 filter 一遍：
   *   归档规则（尤其「逾期并进今天」那一条）写在看得见的地方，
   *   页面只管画，改口径只改这一处。
   *
   * @param {Array} poems  候选篇目（`{id, title, author, dynasty}` 即可）
   * @param {Function} getRecord  id → 记忆档案
   * @param {Object} [opt]  opt.days 天数（默认 14），opt.now 基准时间
   * @returns {Object} { days: [{offset, date, items}], backlog: [items], total }
   *   days[0] 是今天（已并入逾期 7 天以内的）；backlog 是逾期 7 天以上的；
   *   每一篇 items 里的元素带上 daysLeft（负数 = 已逾期几天）。
   */
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
      // 与 overview() 同一套归档：逾期 7 天以内并进今天，更早的单列
      const item = {
        id: p.id,
        title: p.title || "",
        author: p.author || "",
        dynasty: p.dynasty || "",
        level: Math.max(0, Math.min(rec.level, INTERVALS.length - 1)),
        mastery: mastery(rec),
        nextReviewAt: rec.nextReviewAt,
        daysLeft: off,
        /* 「这篇现在走到哪一步」要说得出各模型自己的说法（几号盒 / 间隔与 EF /
           稳定与难度）—— 把档案原样带上，交给 levelName(level, rec) 判。
           只带展示要用的那几个量，不整条扔过来（history 可能很长）。 */
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
        // 超出窗口的那一批既不进日历、也不算「今天该背」——
        // 但它仍是「已学、只是还早」，页面要能说清「更远还有几篇」。
        // ⚠️ 这里只报**个数**、不列篇名（「全部到期篇目」讲的是
        //    「我接下来两周要做的事」）；数要在这里算 ——
        //    出了这个循环 seen 已经把它标成处理过，再扫一遍会一个也数不到。
        farther += 1;
        return;
      }
      total += 1;
    });

    /* 每一天内部按「已逾期几天（越久越前）→ 掌握度低者前 → 篇名」排，
       让用户从上往下背就是最该先背的那几篇。 */
    const byUrgency = function (a, b) {
      if (a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft;
      if (a.mastery !== b.mastery) return a.mastery - b.mastery;
      return a.id < b.id ? -1 : 1;
    };
    out.forEach(function (d) { d.items.sort(byUrgency); });
    backlog.sort(byUrgency);

    /* ⚠️ 逾期 7 天以上的**不并进** days[0] —— 它与 overview() 的 overdue 一样
       是「另计一条」。并进来的话日历说今天 2 篇、清单里今天却是 3 篇，
       两处对不上；页面把 backlog 单独渲染在「今天」那一档下方，
       用户照样看得到，而两个数仍逐格对得上。 */
    return { days: out, backlog: backlog, total: total, farther: farther };
  }

  window.Scheduler = {
    // INTERVALS 换成取值函数：算法可切，档位表也就跟着变（见 activeIntervals 的说明）
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
