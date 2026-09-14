/**
 * 背诵调度算法（间隔重复）
 * ==========================================================================
 * 这一份是**算法层**：只回答两个问题 ——
 *   1. 这一篇下一次该在什么时候复习？
 *   2. 这一篇现在算「什么阶段 / 多少掌握度、该怎样显示」？
 * 具体「今天背哪几首」（每日计划）仍旧由 js/scheduler.js 负责，
 * 它把这里的公式套到每一条记忆档案上。
 *
 * ## 为什么要单独拆一层
 *
 * 站上原先把「遗忘曲线」的间隔表**写死在调度器里**（0→1→2→4→7→15→30→
 * 60→120→240 天）。那是一张固定表：同一天学的两首诗，记忆力好坏没有分别，
 * 见过三次就没的选。但「背」这件事本来就因人、因篇而异 ——
 * 五言绝句与《长恨歌》不该用同一张表，小学一年级与高三也不该。
 *
 * 所以这里做成**可切换的算法注册表**，用户按自己的情况选一种（见设置页）：
 *
 *   ebbinghaus 艾宾浩斯遗忘曲线（1885）—— 固定间隔表，站上原来的那套，默认。
 *              严格说它不是「复习调度算法」而是一条心理学规律（遗忘先快后慢），
 *              市面上的「1-2-4-7-15-30 天」是后人自制的计划表；本档用的就是
 *              站上一直用的那张表，所以对老用户零变化。
 *   leitner    莱特纳盒（1972）—— 分盒制：记住升一格、模糊留在原格、
 *              忘记退回第 1 格，每一格一套固定天数。纸卡时代的经典做法，
 *              规则短、好理解、结果可预期。
 *   sm2        SM-2（1987，老版 Anki 默认）—— 两个变量：间隔 I 与简易度 EF。
 *              间隔按 EF 连乘放大（I→I×EF），忘记则把 EF 掉 0.8 并回到 1 天。
 *              对**短篇**很合适（古诗词正是短篇）；它的老毛病是 EF 一旦被
 *              记错就长期偏低（俗称「难度地狱」），对长篇古文不友好。
 *   fsrs       FSRS（2022，新版 Anki 内置）—— 三个变量：难度 D、稳定性 S、
 *              可提取性 R。这里给的是**降级版**实现：站上不采集用户的复习历史
 *              日志，没法做论文里那种拟合训练，所以只按家庭作业里公开的那组
 *              参数取「初始稳定性 / 稳定度增幅 / 遗忘回落」这几支主曲线，
 *              不假称是完整的 FSRS（完整版要 ≥1000 条复习记录才拟合得动）。
 *
 * 另外两种「市面上的」为什么**没有**做进来（设置页里写了白话说明）：
 *   · SuperMemo 的 SM-17 ~ SM-20 是私有闭源算法，参数与界面都不公开，
 *     无法实现，也无法与其它算法对上口径；
 *   · 多邻国的 HLR（半衰期回归）是为**单词 / 短语**那种碎片化练习设计的，
 *     偏「随时手边练一下」，与「整篇成诵」的复习节奏不是一回事。
 *
 * ## 档案字段是**各算法共用**的一套
 *
 * 每条记忆档案（localStorage 里 poem_recite_progress_v1 的一项）始终是：
 *   { level, nextReviewAt, lastReviewAt, reviewCount, lapses, learned, history }
 * 只有 level 的含义随算法而变（回忆阶段 / 盒子编号 / 第几轮）；
 * 各算法自己需要的额外变量（SM-2 的 EF、FSRS 的 S 与 D）插在档案的
 * `srs` 子对象里，字段名 + 算法 id 双写：
 *   rec.srs = { sm2: { ef: 2.5 }, fsrs: { s: 3.1, d: 6.2 } }
 * 这样**来回切换算法不会互相踩脏**：切到 SM-2 用的是上次留下的 EF，
 * 切回遗忘曲线也不必清空任何东西。
 *
 * ## 口径不做历史重写（重要）
 *
 * 切换算法**只影响之后排的复习**，不会把已经形成的档案（第几轮 / 下次复习
 * 时间）按新算法重算一遍。理由：重算等于瞬间改写用户所有篇目的到期日，
 * 昨天标着「今天复习」的一批可能一夜之间全跑到下周去 —— 那是肉眼可见的
 * 「我的进度被动过了」。所以老档沿用，新复习用新算法接着走。
 */
(function () {
  "use strict";

  var DAY = 24 * 60 * 60 * 1000;
  var HOUR = 60 * 60 * 1000;

  /* ---------------- 小工具 ---------------- */

  function startOfDay(ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function today() {
    return startOfDay(Date.now());
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  /** 下次复习统一落在「那天的早上 9 点」，与原先的遗忘曲线一致 */
  function atNine(dayStart) {
    return dayStart + 9 * HOUR;
  }

  function fromNow(days, now) {
    return atNine(startOfDay((now === undefined ? Date.now() : now) + days * DAY));
  }

  function fromNowHours(hours, now) {
    return (now === undefined ? Date.now() : now) + hours * HOUR;
  }

  /* ---------------- 各算法的额外变量 ---------------- */

  /** 取该算法在档案里存的私有变量（缺省时给一份初值） */
  function varsOf(algo, rec) {
    var bag = (rec && rec.srs && rec.srs[algo.id]) || {};
    var out = {};
    algo.fields.forEach(function (f) {
      out[f.key] = (bag[f.key] === undefined || bag[f.key] === null) ? f.init : Number(bag[f.key]);
    });
    return out;
  }

  /** 把该算法的私有变量记回档案（只动自己那一格，别的算法那一格原样保留） */
  function setVars(rec, algo, vars) {
    rec.srs = rec.srs || {};
    var bag = rec.srs[algo.id] || (rec.srs[algo.id] = {});
    Object.keys(vars).forEach(function (k) { bag[k] = Math.round(vars[k] * 1000) / 1000; });
  }

  /* ---------------- 四种算法 ---------------- */

  /**
   * 1. 艾宾浩斯遗忘曲线（1885）：固定间隔表
   * 站上原来那一套，一个字没改 —— 老用户切到这一档时看到的间隔、
   * 记忆阶段名、掌握度都与升级前完全一致。
   */
  var ebbinghaus = {
    id: "ebbinghaus",
    name: "艾宾浩斯遗忘曲线",
    short: "遗忘曲线",
    year: 1885,
    tagline: "固定间隔表，逐级翻倍",
    note: "1-2-4-7-15-30-60 天递增，规则最简单，适合按教材顺序稳步推进",
    sub: "按遗忘曲线复习",
    intro:
      "1885 年艾宾浩斯发现的规律是「遗忘先快后慢」，本身不是一套复习调度算法；" +
      "市面上流传的「1-2-4-7-15-30 天」是后人自制的计划表。本档用的就是站上一直用的那张表：" +
      "记住升一级、模糊原地不动、忘记退一级。规则简单、结果可预期，适合按教材顺序稳步推进。",
    stages: ["新学", "1天后", "2天后", "4天后", "7天后", "15天后", "30天后", "60天后", "120天后", "已牢固"],
    fields: [],
    /** 各阶段的下次间隔（天），最后一项封顶 */
    intervals: [0, 1, 2, 4, 7, 15, 30, 60, 120, 240],

    maxLevel: function () { return this.intervals.length - 1; },

    next: function (rec, result, ctx) {
      var now = ctx.now;
      if (result === "fuzzy") {
        // 停留当前阶段，12 小时后再来（短间隔，不推进阶段）
        return { level: rec.level, nextReviewAt: fromNowHours(12, now), lapses: rec.lapses, vars: {} };
      }
      if (result === "bad") {
        return {
          level: Math.max(0, rec.level - 1),
          nextReviewAt: fromNowHours(0.5, now),
          lapses: rec.lapses + 1,
          vars: {}
        };
      }
      var lv = clamp(rec.level + 1, 0, this.maxLevel());
      return { level: lv, nextReviewAt: fromNow(this.intervals[lv], now), lapses: rec.lapses, vars: {} };
    },

    /** 掌握度：阶段占比扣掉遗忘罚分 —— 与站上原来那把尺子同一个算式 */
    mastery: function (rec) {
      var denom = this.maxLevel();
      if (!denom) return 0;
      var base = (rec.level / denom) * 100;
      var penalty = Math.min(rec.lapses * 5, 20);
      return clamp(Math.round(base - penalty + 5), 0, 100);
    }
  };

  /**
   * 2. 莱特纳盒（1972）：分级盒子 + 每盒固定天数
   *
   * 纸卡时代的做法：一叠盒子，答对的卡片往后挪一格，答错的**退回第一格**。
   * 与遗忘曲线那一档的区别在于「忘了怎么办」——
   * 这里不给缓冲，直接退回第 1 盒重来（遗忘曲线只退一级）。
   */
  var leitner = {
    id: "leitner",
    name: "莱特纳盒",
    short: "莱特纳盒",
    year: 1972,
    tagline: "分盒递进，忘记退回第一格",
    note: "五个盒子各配固定天数，答对进下一盒，答错退回第 1 盒从头来",
    sub: "按莱特纳盒复习",
    intro:
      "1972 年莱特纳的纸卡做法：把卡片分装进几个盒子，每个盒子一套固定天数。" +
      "问一遍答对了，卡片往后挪一盒；答错了，直接退回第 1 盒从头来。" +
      "规则短、手感明确，孩子自己能看懂「我现在在第几盒」。",
    stages: ["第1盒 · 1天", "第2盒 · 2天", "第3盒 · 4天", "第4盒 · 8天", "第5盒 · 16天", "出盒 · 已掌握"],
    fields: [],
    /** 盒 0 是「当天新学」，盒 1..5 各一套天数（盒 5 即「出盒」，最长） */
    intervals: [0, 1, 2, 4, 8, 16],

    maxLevel: function () { return this.intervals.length - 1; },

    next: function (rec, result, ctx) {
      var now = ctx.now;
      if (result === "fuzzy") {
        // 糊着不算答错：留在这一盒，当天晚些时候再过一遍
        return { level: rec.level, nextReviewAt: fromNowHours(8, now), lapses: rec.lapses, vars: {} };
      }
      if (result === "bad") {
        // 莱特纳的规矩：答错一律退回第 1 盒（不是退一格）。
        // 但**当天**还要再来一遍 —— 纸卡时代就是当场把卡片插回盒底重问一次，
        // 直接排到 1 天后会让人以为「今天不用管了」。所以第一次回落走 30 分钟。
        return {
          level: 1,
          nextReviewAt: (rec.level > 1 ? fromNowHours(0.5, now) : fromNow(this.intervals[1], now)),
          lapses: rec.lapses + 1,
          vars: {}
        };
      }
      var lv = clamp(rec.level + 1, 0, this.maxLevel());
      return { level: lv, nextReviewAt: fromNow(this.intervals[lv], now), lapses: rec.lapses, vars: {} };
    },

    mastery: function (rec) {
      var denom = this.maxLevel();
      if (!denom) return 0;
      return clamp(Math.round(((rec.level + 1) / (denom + 1)) * 100 - Math.min(rec.lapses * 8, 24)), 0, 100);
    }
  };

  /**
   * 3. SM-2（1987，老版 Anki 默认）：间隔 × 简易度
   *
   * 两个变量：间隔 I、简易度 EF（初值 2.5，下限 1.3）。
   * 记住 → 间隔乘 EF；忘记 → 间隔回到 1 天、EF 掉 0.8（贴到下限为止）。
   * 对短篇（五言绝句这类）效果很好；短板是 EF 只降不升，一旦记错几次，
   * 这篇就长期被判成「难」，复习次数下不来 —— 长篇古文尤其容易掉进去。
   */
  var sm2 = {
    id: "sm2",
    name: "SM-2",
    short: "SM-2",
    year: 1987,
    tagline: "间隔按简易度连乘",
    note: "老版 Anki 的默认算法，适合短篇；长篇容易越背越密",
    sub: "按 SM-2 复习",
    intro:
      "1987 年 SuperMemo 的第二个版本，也是老版 Anki 的默认算法。" +
      "只有两个变量：间隔与简易度 EF。记住了就把间隔乘上 EF（初值 2.5）越拉越长，" +
      "忘了就把 EF 掉 0.8 并退回 1 天。**对五言绝句这类短篇很合适**，" +
      "但 EF 只降不升，长篇古文被记错几次后会长期被判成「难」，复习会越来越密。",
    stages: null, // 阶段名按间隔天数现算（见 stageNames）
    fields: [{ key: "ef", init: 2.5 }],
    // 「当前算法的节奏」那一栏要列一张表：SM-2 的间隔随 EF 变，
    // 这里列的是**EF 走初值 2.5** 时的各轮天数（EF 被扣低之后会短于这张表）
    intervals: [0, 1, 6, 15, 38, 95, 238, 365, 365, 365, 365],

    maxLevel: function () { return 10; },

    /** EF 下限 1.3（SM-2 原版的硬底线，低于 1.3 间隔就不再增长） */
    EF_MIN: 1.3,
    EF_INIT: 2.5,

    next: function (rec, result, ctx) {
      var now = ctx.now;
      var v = varsOf(this, rec);
      var ef = clamp(Number(v.ef) || this.EF_INIT, this.EF_MIN, 3.0);

      if (result === "fuzzy") {
        // 糊：EF 轻扣一点，间隔不推进（当天 10 小时后再过一遍）
        ef = clamp(ef - 0.1, this.EF_MIN, 3.0);
        return { level: rec.level, nextReviewAt: fromNowHours(10, now), lapses: rec.lapses, vars: { ef: ef } };
      }
      if (result === "bad") {
        // SM-2 原版把间隔打回 1 天；但**当天**还得再见一次 —— 忘了就该当场
        // 再背一遍（与遗忘曲线 / 莱特纳盒两档同一口径），1 天后那一轮才是
        // 正式回到第 1 轮。所以第一次回落排的是 30 分钟。
        ef = clamp(ef - 0.8, this.EF_MIN, 3.0);
        return {
          level: 1,
          nextReviewAt: (rec.level > 1 ? fromNowHours(0.5, now) : fromNow(1, now)),
          lapses: rec.lapses + 1,
          vars: { ef: ef }
        };
      }

      // good：第 1 轮 1 天，第 2 轮 6 天，之后按 EF 连乘
      var lv = Math.min(rec.level + 1, this.maxLevel());
      var days;
      if (lv <= 1) days = 1;
      else if (lv === 2) days = 6;
      else {
        // 用「上一轮的间隔」乘 EF —— 档案里只存了阶段号，这里按同一把尺子
        // 反推上一轮间隔，避免为了一个中间量再往档案里塞字段
        var prev = rec.level <= 1 ? 1 : rec.level === 2 ? 6 : 6 * Math.pow(ef, rec.level - 2);
        days = Math.max(1, Math.round(prev * ef));
      }
      days = Math.min(days, 365);
      return { level: lv, nextReviewAt: fromNow(days, now), lapses: rec.lapses, vars: { ef: ef } };
    },

    /** 该档的阶段名 = 下一次间隔多少天（SM-2 的阶段就是「间隔」本身） */
    levelName: function (level, rec) {
      var names = this.stageNames(rec);
      return names[clamp(level, 0, names.length - 1)] || "第 1 轮";
    },

    stageNames: function (rec) {
      var v = varsOf(this, rec);
      var ef = clamp(Number(v.ef) || this.EF_INIT, this.EF_MIN, 3.0);
      var days = [0, 1, 6];
      for (var i = 3; i <= this.maxLevel(); i += 1) {
        days.push(Math.min(365, Math.max(1, Math.round(days[i - 1] * ef))));
      }
      return days.map(function (d, i) {
        if (i === 0) return "新学";
        if (i === days.length - 1) return "已牢固";
        return d + "天后";
      });
    },

    mastery: function (rec) {
      var names = this.stageNames(rec);
      var lv = clamp(rec.level, 0, names.length - 1);
      var base = (lv / (names.length - 1)) * 100;
      return clamp(Math.round(base - Math.min(rec.lapses * 6, 24) + 5), 0, 100);
    }
  };

  /**
   * 4. FSRS（2022，新版 Anki 内置）：难度 D、稳定性 S、可提取性 R
   *
   * ⚠️ 这一档是**降级版**：站上没有复习历史日志，做不到论文要求的参数拟合。
   * 所以只实现公开的那几支主曲线（初始稳定性、稳定性增幅、遗忘后的回落），
   * 参数用默认值而不是个人拟合值 —— 界面上也照实说明，不冒充完整 FSRS。
   *
   * 三个变量的意思（用大白话）：
   *   D 难度   0~10，越大表示这篇对他越难 —— 难度大，稳定性涨得慢
   *   S 稳定性 单位是天：**预测「这次记住了，多久之后回忆率掉到 90%」**
   *   R 可提取 0~1，此刻还记着的概率，随「已经过去多少天 / S」指数衰减
   * 到期日 = 从今天起，让 R 重新落回目标保留率所需的天数。
   */
  var fsrs = {
    id: "fsrs",
    name: "FSRS",
    short: "FSRS",
    year: 2022,
    tagline: "难度 / 稳定性 / 可提取性三变量",
    note: "新版 Anki 内置；按个人记忆拟合，复习次数比 SM-2 省",
    sub: "按 FSRS 复习",
    intro:
      "2022 年开源的新一代算法，也是新版 Anki 的内置算法。用三个变量描述一条记忆：" +
      "难度 D、稳定性 S（还能记住多久）、可提取性 R（此刻还记得的概率）。" +
      "它按每个人自己的复习记录去拟合，因此**长期看复习次数比 SM-2 省**，也更少出现" +
      "「越背越密」。本档是降级版：站上不采集复习日志，做不了个人拟合，用的是公开默认参数。",
    stages: ["新学", "刚记住", "较牢", "牢固", "很牢固", "长期", "稳固", "已牢固"],
    fields: [
      { key: "s", init: 3.1 },   // 初始稳定性（天）
      { key: "d", init: 6.2 }    // 初始难度
    ],

    /** 目标保留率：到期日就是「R 掉回这个值」的那一天 */
    REQUEST_RETENTION: 0.9,
    D_MIN: 1,
    D_MAX: 10,
    // 「当前算法的节奏」那一栏要列出间隔表；FSRS 的间隔是从 S 折算出来的，
    // 这里放的是**从零开始、每次都选「记住了」**时各轮会落到的天数
    // （S 初值 3.1 × 每轮增幅，再按目标保留率 0.9 折算）
    intervals: [0, 1, 4, 11, 27, 65],
    S_MIN: 0.2,
    // 稳定性上限：3650 天（10 年）—— 封在 365 天时，背到后半程每一轮的间隔
    // 都会被卡在 365 天上（界面上表现为「已牢固 / 已牢固」两档一模一样），
    // 而 S 本身还在涨，说明不了「越来越牢」
    S_MAX: 3650,

    maxLevel: function () { return this.stages.length - 1; },

    /** 难度大 → 稳定性涨得慢；难度小 → 涨得快（FSRS 主曲线的大意） */
    w: function () {
      return {
        s0Easy: 7.5,     // 记得很轻松时的初始稳定性
        s0Good: 3.1,     // 自评「还可以」
        s0Hard: 1.2,     // 自评「有点糊」时的初始稳定性
        w1: 0.4,         // 模糊：稳定性小幅增长
        w2: 1.1,         // 记住：稳定性增长幅度
        sFailMul: 0.35,  // 忘记：稳定性打回多少
        dGood: -1.0,     // 记住 → 难度下行
        dBad: 1.2        // 忘记 → 难度上行
      };
    },

    /** 经过 elapsedDays 天后，还能记住的概率（指数遗忘曲线） */
    retrievability: function (s, elapsedDays) {
      if (!(s > 0)) return 0;
      return Math.pow(1 + elapsedDays / (9 * s), -1);
    },

    /** 按目标保留率反推：S 天的稳定性，多久之后该复习（天） */
    intervalFor: function (s) {
      var r = this.REQUEST_RETENTION;
      var days = 9 * s * (Math.pow(r, -1) - 1);
      return clamp(days, 1, this.S_MAX);
    },

    next: function (rec, result, ctx) {
      var now = ctx.now;
      var v = varsOf(this, rec);
      var s = clamp(Number(v.s) || 3.1, this.S_MIN, this.S_MAX);
      var d = clamp(Number(v.d) || 6.2, this.D_MIN, this.D_MAX);
      var W = this.w();

      var last = rec.lastReviewAt || now;
      var elapsed = Math.max(0, (now - last) / DAY);
      var r = this.retrievability(s, elapsed);
      var newS;
      var newD;

      if (result === "bad") {
        // 忘了：稳定性大幅回落（但不必归零 —— 学过的痕迹还在），难度上调
        newS = clamp(s * W.sFailMul, this.S_MIN, this.S_MAX);
        newD = clamp(d + W.dBad, this.D_MIN, this.D_MAX);
        return {
          level: Math.max(1, rec.level - 1),
          // 忘了就当天再见一次（半小时）；不过 30 分钟后那一次仍用 0.5 小时 ——
          // 这是「当场再背一遍」的意思，不是排进正式的复习队列，
          // 所以与其它两档口径一致，不按稳定性折算
          nextReviewAt: fromNowHours(0.5, now),
          lapses: rec.lapses + 1,
          vars: { s: newS, d: newD }
        };
      }

      if (result === "fuzzy") {
        // 糊：用「略高于当前可提取性」的回访来推稳定性，小幅增长
        var sFuzzy = s * (1 + W.w1 * (1 - r));
        newS = clamp(Math.max(s, sFuzzy), this.S_MIN, this.S_MAX);
        newD = clamp(d, this.D_MIN, this.D_MAX);
        return {
          level: rec.level,
          nextReviewAt: fromNowHours(10, now),
          lapses: rec.lapses,
          vars: { s: newS, d: newD }
        };
      }

      // good：难度越大，稳定性涨得越少；「记得越吃力」获得越大的增幅补偿
      var gain = W.w2 * (11 - d) * (1 + (1 - r));
      newS = clamp(s * (1 + gain / 10), this.S_MIN, this.S_MAX);
      newD = clamp(d + W.dGood, this.D_MIN, this.D_MAX);

      var lv = clamp(rec.level + 1, 0, this.maxLevel());
      var days = this.intervalFor(newS);
      return {
        level: lv,
        nextReviewAt: fromNow(days, now),
        lapses: rec.lapses,
        vars: { s: newS, d: newD }
      };
    },

    /**
     * 掌握度（0~100）
     * FSRS 的稳定性 S 是「还能记住多久」，但**阶段号同样说明问题**：
     * 一个刚背完第 7 遍（level 到顶）的档案，即时 S 只有几天，
     * 也只按 S 折算就会显示成「30% 刚起步」——那是错觉。
     * 所以取两者较大的那一个：S 讲「记得多久」，level 讲「走了多远」。
     */
    mastery: function (rec) {
      var v = varsOf(this, rec);
      var s = clamp(Number(v.s) || 3.1, this.S_MIN, this.S_MAX);
      var byS = (Math.log(s + 1) / Math.log(this.S_MAX + 1)) * 100;
      var byLevel = (clamp(rec.level, 0, this.maxLevel()) / this.maxLevel()) * 100;
      var base = Math.max(byS, byLevel);
      return clamp(Math.round(base + 6 - Math.min(rec.lapses * 5, 20)), 0, 100);
    }
  };

  var ALGOS = [ebbinghaus, leitner, sm2, fsrs];
  var DEFAULT_ALGO = "ebbinghaus";

  function get(id) {
    for (var i = 0; i < ALGOS.length; i += 1) {
      if (ALGOS[i].id === id) return ALGOS[i];
    }
    return null;
  }

  function fallback() {
    return ebbinghaus;
  }

  var SettingsBridge = {
    /** 当前算法 id：设置里的值不认识（老档 / 手改脏值）时用默认那一档，不猜 */
    current: function () {
      var id = "";
      try {
        var s = window.Storage && window.Storage.getSettings ? window.Storage.getSettings() : null;
        id = (s && s.srs) || "";
      } catch (e) {
        id = "";
      }
      return get(id) ? id : DEFAULT_ALGO;
    },

    currentAlgo: function () {
      return get(SettingsBridge.current()) || fallback();
    },

    /** 副标题：这一档在「按 XX 复习」里该怎么自称（见各算法注册项的 sub） */
    currentSub: function () {
      return SettingsBridge.currentAlgo().sub;
    },

    /** 记忆阶段名是否随算法变（变的话详情页要写「当前阶段」而不是「记忆阶段」） */
    stagesVary: function () {
      return ALGOS.length > 1;
    }
  };

  function activeIntervals() {
    var a = SettingsBridge.currentAlgo();
    return a && a.intervals ? a.intervals.slice() : ebbinghaus.intervals.slice();
  }

  /** 当前算法的阶段总数 */
  function stageCount() {
    return activeIntervals().length;
  }

  window.SRS = {
    ALGOS: ALGOS,
    DEFAULT: DEFAULT_ALGO,
    get: get,
    fallback: fallback,
    current: SettingsBridge.current,
    currentAlgo: SettingsBridge.currentAlgo,
    currentSub: SettingsBridge.currentSub,
    /** 当前算法的间隔表（天）与档位数：调度器与界面都按它取值 */
    INTERVALS: activeIntervals,
    stageCount: stageCount,
    STEP: 5,
    DAY: DAY,
    startOfDay: startOfDay,
    today: today,
    atNine: atNine,
    /** 显式指定算法来算一次（测试与「切换后预览」用；页面走 currentAlgo） */
    next: function (algoId, rec, result, now) {
      var a = get(algoId) || fallback();
      return a.next(rec, result, { now: now === undefined ? Date.now() : now });
    }
  };
})();
