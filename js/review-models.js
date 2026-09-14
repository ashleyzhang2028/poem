/**
 * 复习调度算法（可切换）
 * ==========================================================================
 * 为什么要有这一层：
 *   项目原先只认一套「艾宾浩斯式」固定间隔序列（见 js/scheduler.js 的
 *   INTERVALS），用户选了它就没得换。而市面上的复习调度算法各有取舍，
 *   没有哪一套对所有篇目都最好 ——
 *     短篇五绝，固定间隔最省心智；长篇《琵琶行》，按难度调间隔才不至于
 *     「明明记不住，它偏让我 30 天后再来」。
 *   所以把「下一次什么时候复习」这件事抽出来，做成可插拔的几张**模型**，
 *   用户在设置页选哪一种，首页副标题也跟着说清「按 X 复习」。
 *
 * ## 先厘清一件常被混为一谈的事
 *
 * 「艾宾浩斯遗忘曲线」（1885）是**心理学规律**（遗忘先快后慢），
 * **不是调度算法** —— 网传的 1-2-4-7-15-30 天是后人自制的计划表，
 * 与艾宾浩斯本人的实验数据并不一一对应。本项目把它实现成 MODEL
 * `ebbinghaus` 并保留为**出厂默认**：它零参数、可解释、对短篇够用。
 *
 * ## 收录了哪几种，为什么是这几种
 *
 * | 模型 | 出处 | 变量 | 为什么收 / 不收 |
 * |---|---|---|---|
 * | `ebbinghaus` | 固定间隔计划表（原实现） | 阶段 level | ✅ 出厂默认：零参数、结果可解释，短篇最省心 |
 * | `leitner` | Leitner 盒（1972） | 盒号 box | ✅ **纸质卡片的心智模型**与「背一首、记一次结果」同构；无数学，家长看得懂 |
 * | `sm2` | SM-2（1987，Anki 旧版默认） | 间隔 interval、简易度 EF | ✅ 变量少、结果稳，对长篇的个性化明显好于固定表 |
 * | `fsrs` | FSRS（2022，新版 Anki 内置）**简化版** | 难度 D、稳定性 S、可提取性 R | ✅ 三变量、开源可复现，积压多 / 难度差异大时收敛最好。⚠️ 完整版靠**机器学习拟合个人记忆**，本项目是纯前端、无后端也无训练数据，只落地**简化可解释版**（见下） |
 * | — | SM-17 / SM-19 / SM-20 | S、R | ❌ **不做**：SuperMemo 私有闭源，公式未公开，无法如实复现。宁可明说不做，也不编一套「像 SM-17 的东西」冒充 |
 * | — | HLR 半衰期回归（多邻国） | 半衰期 | ➖ **不单独成一套**：它「每条记忆算半衰期」的思路与 FSRS 的稳定性 S 同源；单独再摆一套只会与 FSRS 重复。这里把它作为 FSRS 里 S 的解读（S 就是「记忆强度衰减到一半所需的天数」） |
 *
 * ## 三种评级（沿用现有按钮，不改用户已经养成的习惯）
 *
 *   good  记住 —— 升级 / 拉长间隔
 *   fuzzy 模糊 —— 原地停留，短期（12 小时）后再来                     [所有模型一致]
 *   bad   忘记 —— 降级 / 缩短间隔，30 分钟后再来                       [所有模型一致]
 *
 * ## 数据格式（向下兼容）
 *
 * 记录（`poem_recite_progress_v1` 里的一条）公用字段不变：
 *   level / nextReviewAt / lastReviewAt / reviewCount / lapses / learned / history
 * 额外一个 `algo` 字段记「这条记录是哪个模型算出来的」，再按模型附带自己的状态：
 *   leitner → box；sm2 → interval / ef；fsrs → difficulty / stability
 *
 * ⚠️ **换了模型不清进度**：用户背了 30 首再换模型，不可能让他从头再来。
 *    `adopt()` 负责把旧记录**换算**成新模型的状态（按 level / interval / EF 等
 *    最接近的落点），换完之后 `algo` 更新为新模型，其余字段原样保留。
 *
 * ⚠️ 模型层的输出**只有两件事**：`nextReviewAt`（下次何时复习）与
 *    `state`（模型自己的状态，交回 `review()` 时原样带上）。
 *    掌握度、阶段名这些**展示口径**仍走 js/scheduler.js 的 mastery() /
 *    levelName()，本文件不另造一套 —— 否则同一个进度在首页与进度页会显示两个数。
 * ========================================================================== */
(function () {
  "use strict";

  var DAY = 24 * 60 * 60 * 1000;
  var HOUR = 60 * 60 * 1000;
  var MIN = 60 * 1000;

  /** 模糊 / 忘记的短期重来间隔（与原有行为一致，所有模型共用） */
  var FUZZY_HOURS = 12;
  var BAD_MINUTES = 30;

  function startOfDay(ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  /** n 天后的当天 09:00（与原实现同一个落点：用户不会半夜被叫起来复习） */
  function dayAt(ts, days) {
    return startOfDay(ts) + days * DAY + 9 * HOUR;
  }

  /* ==========================================================================
     一、模型清单
     ========================================================================== */

  /**
   * 出厂默认：固定间隔表（原「遗忘曲线」实现，行为逐条保持不变）。
   *
   * 间隔序列（天）：0 → 1 → 2 → 4 → 7 → 15 → 30 → 60 → 120 → 240
   * 这是本项目此前的唯一一套，保留为默认 —— 换模型是**加法**，不是替换。
   */
  var EBBINGHAUS_INTERVALS = [0, 1, 2, 4, 7, 15, 30, 60, 120, 240];

  var MODELS = {
    /* ---------------- 1. 固定间隔（艾宾浩斯式计划表，出厂默认） ---------------- */
    ebbinghaus: {
      key: "ebbinghaus",
      name: "遗忘曲线",
      short: "遗忘曲线",
      sub: "按遗忘曲线复习",
      years: "1885 · 固定间隔",
      blurb: "把复习间隔写成一张固定的表（1、2、4、7、15、30…天），记住就往下走一格。"
        + "零参数、结果一眼看得懂，短诗、词最省心；缺点是不看这一篇到底是难是易，"
        + "《琵琶行》和《静夜思》用同一张表。",
      /** 阶段数（进度页的阶段分布按它分档） */
      stages: EBBINGHAUS_INTERVALS.length,
      /** 该模型下一条新记录的状态 */
      init: function () {
        return { level: 0 };
      },
      /** 按进度记录算阶段号（0 起；进度页 / 掌握度都用它归一） */
      stageOf: function (rec) {
        return clampLevel(rec && typeof rec.level === "number" ? rec.level : 0);
      },
      /**
       * 算下一次复习。
       * @param {number} level 阶段号
       * @param {number} now
       */
      intervalDays: function (level) {
        var lv = clampLevel(level);
        return EBBINGHAUS_INTERVALS[lv];
      },
      /** 档名沿用原口径：1天后 / 2天后 / …… / 已牢固 */
      stageName: function (rec) {
        var names = ["新学", "1天后", "2天后", "4天后", "7天后", "15天后",
          "30天后", "60天后", "120天后", "已牢固"];
        return names[clampLevel(rec && rec.level)] || "新学";
      }
    },

    /* ---------------- 2. Leitner 莱特纳盒（1972） ---------------- */
    leitner: {
      key: "leitner",
      name: "莱特纳盒",
      short: "Leitner",
      sub: "按 Leitner 盒复习",
      years: "1972 · 分级盒子",
      blurb: "纸质卡片的老办法：答对就把卡片往后挪一个盒子，盒号越大间隔越长；"
        + "答错就退回第一个盒子，从头再来。没有公式，一盒一盒看得见地往前走 ——"
        + "「我这篇在第几盒」比「第几阶段」更像个实物。",
      /**
       * 五个盒子，间隔（天）：
       *   1 号盒：每天；2 号盒：2 天；3 号盒：4 天；4 号盒：8 天；5 号盒：16 天
       * 原版 Leitner 的间隔是「每进一盒翻一倍」的口径，这里取 2 的幂次；
       * 盒子数取 5 —— 再多下去间隔会超过「背完一册教材」的时间尺度。
       */
      boxes: [1, 2, 4, 8, 16],
      stages: 5,
      init: function () {
        return { box: 0 };
      },
      stageOf: function (rec) {
        return clampBox(rec && typeof rec.box === "number" ? rec.box : 0);
      },
      intervalDays: function (box) {
        return this.boxes[clampBox(box)];
      },
      /** 就说「几号盒 · 几天后」—— Leitner 的心智模型本来就是盒子 */
      stageName: function (rec) {
        var b = clampBox(rec && rec.box);
        return (b + 1) + " 号盒 · " + this.boxes[b] + " 天后";
      }
    },

    /* ---------------- 3. SM-2（1987，Anki 旧版默认） ---------------- */
    sm2: {
      key: "sm2",
      name: "SM-2",
      short: "SM-2",
      sub: "按 SM-2 复习",
      years: "1987 · 间隔 × 简易度",
      blurb: "两个变量：间隔（interval）与简易度（EF，英文 ease factor，出厂 2.5）。"
        + "记住一次，间隔就乘以简易度；总记不住，简易度自己往下掉，间隔就长得慢 ——"
        + "对长篇（《琵琶行》这类）比固定表贴合得多。",
      /**
       * 阶段仍按「第几次连续记住」计（进度页的阶段分布与掌握度要用一个统一的档）：
       *   阶段 0 未学；阶段 1 起 = 1、2、3… 次连续记住，末档封顶。
       */
      stages: 10,
      /** SM-2 的间隔（天）表 —— 前 3 次是固定值，第 4 次起走 interval × EF */
      firstIntervals: [1, 3, 7],
      DEFAULT_EF: 2.5,
      MIN_EF: 1.3,
      /**
       * 三条按钮 → SM-2 的 0-5 质量分（SM-2 原版要求 0-5）：
       *   记住 good  → 5（完全记得）
       *   模糊 fuzzy → 3（记得，但费劲）—— 原版 3 分也**算通过**，只是 EF 会往下掉
       *   忘记 bad   → 1（想起来才记起，答错）
       * 这样才守得住 SM-2 的原意：EF 由「你答得多顺」驱动，而不是只由对错驱动。
       */
      grades: { bad: 1, fuzzy: 3, good: 5 },
      init: function () {
        return { level: 1, interval: 0, ef: this.DEFAULT_EF };
      },
      stageOf: function (rec) {
        return clampLevel((rec && rec.level) || 0);
      },
      /**
       * EF 更新公式（SM-2 原式）：
       *   EF' = EF + (0.1 − (5 − q) × (0.08 + (5 − q) × 0.02))
       * q=5 → +0.10；q=4 → 0；q=3 → −0.14；q=2 → −0.32；q=1 → −0.54。
       * 下限 1.3（原版如此：再低下去间隔会长不起来）。
       */
      efAfter: function (ef, q) {
        var next = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
        return Math.max(this.MIN_EF, Math.round(next * 100) / 100);
      },
      /** 下一段间隔（天）：前三次取固定值，之后 interval × EF */
      intervalAfter: function (interval, ef, passCount) {
        if (passCount <= 1) return this.firstIntervals[0];
        if (passCount === 2) return this.firstIntervals[1];
        if (passCount === 3) return this.firstIntervals[2];
        return Math.max(1, Math.round(interval * ef));
      },
      /** 把两个量都说出来 —— 「间隔 7 天 · 简易度 2.5」 */
      stageName: function (rec) {
        if (!rec || !rec.learned) return "新学";
        var iv = Math.max(0, Math.round(rec.interval || 0));
        var ef = typeof rec.ef === "number" ? rec.ef : this.DEFAULT_EF;
        return "间隔 " + iv + " 天 · 简易度 " + ef;
      }
    },

    /* ---------------- 4. FSRS 简化版（2022，新版 Anki 内置） ---------------- */
    fsrs: {
      key: "fsrs",
      name: "FSRS",
      short: "FSRS",
      sub: "按 FSRS 复习",
      years: "2022 · 难度 / 稳定性",
      blurb: "三个变量：难度 D、稳定性 S、可提取性 R。"
        + "把记忆想成「一条会衰减的曲线」，S 是「衰减到一半要多少天」，"
        + "D 是这篇对你有多难。S 越长、离到期越久，就越不该现在复习；"
        + "快忘光了（R 低）就立刻安排。对积压多、难易差别大的清单收敛最好。",
      yearsNote: "简化版",
      /**
       * ⚠️ 这是 FSRS 的**简化可解释版**，不是官方参数的完整实现：
       *   官方 FSRS 用一组（10+ 个）参数，靠**用户自己的复习历史做机器学习拟合**，
       *   每个人的参数都不一样。本项目是纯前端、没有后端也没有训练数据，
       *   所以这里用**公开的、固定的**一套参数与公式骨架（D 的更新、S 的更新、
       *   可提取性 R = 2^(−t/S) 这条遗忘曲线），不做拟合。
       *   落地效果：初期与 SM-2 接近，长期更能拉住「难篇」与「积压」。
       */
      params: {
        /* 初始稳定性：第一次记住后，这条记忆的初始 S（天） */
        initS: { bad: 1, fuzzy: 3, good: 6 },
        /* 初始难度（1-10，5 为中等） */
        initD: 5,
        /* 难度调整步长与范围 */
        dStep: { bad: 1.6, fuzzy: 0.6, good: -0.6 },
        minD: 1,
        maxD: 10,
        /* 稳定性增益：记住时 S 乘以的系数（受难度与 R 影响） */
        goodGain: 2.4,
        /* 每次复习把 S 往上拉时的下限保护（天） */
        minS: 1
      },
      stages: 10,
      init: function () {
        return { level: 1, difficulty: this.params.initD, stability: this.params.initS.good };
      },
      stageOf: function (rec) {
        return clampLevel((rec && rec.level) || 0);
      },
      /**
       * 可提取性 R = 2^(−t/S)：距上次复习 t 天、稳定性 S 天时，还记得的概率。
       * t=0 → 1（刚背完）；t=S → 0.5（衰减一半）；t 越大越接近 0。
       */
      retrievability: function (stability, elapsedDays) {
        var s = Math.max(this.params.minS, stability || this.params.minS);
        var t = Math.max(0, elapsedDays || 0);
        return Math.pow(2, -t / s);
      },
      /**
       * 下一次间隔（天）：让 R 回落到目标值所需的时间 ——
       *   R_target = 0.9（官方默认「到期时约九成还记得」）
       *   interval = S × log2(1 / R_target)
       * 记忆越稳（S 大）间隔越长，正是「该温柔时就别勤来打扰」。
       */
      intervalOf: function (stability, target) {
        var rt = target || 0.9;
        var days = stability * (Math.log(1 / rt) / Math.log(2));
        return Math.max(1, Math.round(days));
      },
      /** 难度更新：记住了往回降一点，忘了往上抬（1-10 之间） */
      difficultyAfter: function (d, result) {
        var step = this.params.dStep[result] || 0;
        return Math.max(this.params.minD, Math.min(this.params.maxD, d + step));
      },
      /** 稳定性更新：记住则按「难度越低涨得越快」放大；忘记则回落到初始值附近 */
      stabilityAfter: function (s, d, result, rNow) {
        var p = this.params;
        if (result === "bad") {
          return Math.max(p.minS, Math.round(s * 0.4 * 100) / 100);
        }
        /* 难度低（易）→ 增益大；可提取性 R 越低（快忘光）→ 增益越大（这次复习很值） */
        var ease = (p.maxD - d) / (p.maxD - p.minD);      // 0..1
        var gain = p.goodGain * (0.5 + ease) * (result === "fuzzy" ? 0.6 : 1);
        var bonus = 1 + (1 - (rNow || 1)) * 0.5;           // R 越低补得越多
        return Math.max(p.minS, Math.round(s * gain * bonus * 100) / 100);
      },
      /** 三个量里挑两个最直白的：稳定 S（天）与难度 D */
      stageName: function (rec) {
        if (!rec || !rec.learned) return "新学";
        var st = typeof rec.stability === "number" ? Math.round(rec.stability * 10) / 10 : 0;
        var d = typeof rec.difficulty === "number" ? Math.round(rec.difficulty * 10) / 10 : 0;
        return "稳定 " + st + " 天 · 难度 " + d;
      }
    }
  };

  function clampLevel(lv) {
    var n = typeof lv === "number" && isFinite(lv) ? Math.round(lv) : 0;
    return Math.max(0, Math.min(n, EBBINGHAUS_INTERVALS.length - 1));
  }
  function clampBox(b) {
    var n = typeof b === "number" && isFinite(b) ? Math.round(b) : 0;
    return Math.max(0, Math.min(n, MODELS.leitner.boxes.length - 1));
  }

  /** 设置页与进度页按这个顺序列出（第一个是出厂默认） */
  var ORDER = ["ebbinghaus", "leitner", "sm2", "fsrs"];

  var DEFAULT_KEY = "ebbinghaus";

  function keys() {
    return ORDER.slice();
  }

  function known(key) {
    return Object.prototype.hasOwnProperty.call(MODELS, key);
  }

  /** 取一个模型（不认识就给出厂默认，绝不返回 null） */
  function modelOf(key) {
    return MODELS[known(key) ? key : DEFAULT_KEY];
  }

  /* ==========================================================================
     二、换模型时的进度换算（不清进度）
     ========================================================================== */

  /**
   * 把一条记录**换算**成目标模型的状态。
   *
   * 用户的真实处境：已经背了 30 首、有的到第 7 阶段、有的忘了好几回。
   * 这时候他换成 FSRS，不可能让他从头再来 —— 所以按最接近的落点换算：
   *
   *   · level    —— 任何模型都保留（它是「连续记住几次」的通用计量，
   *                 进度页的阶段分布与掌握度都读它）
   *   · leitner  —— box 由 level 折半映射（level 0..8 → box 0..4）
   *   · sm2      —— interval 取原 level 对应天数；EF 按 lapses 略降
   *   · fsrs     —— S 取原 level 对应天数（或已有 interval）；D 按 lapses 回升
   *
   * ⚠️ 换算只保证「大致接着走」，不追求与旧模型逐日一致 ——
   *    换模型本来就是换一套口径，硬凑成完全等价只会既做不到又说不清。
   *    唯一必须守住的是：**已经背过的篇目绝不退回未学**。
   *
   * @param {Object} rec   旧记录
   * @param {string} key   目标模型
   * @returns {Object} 换算后的记录（新对象，不改原记录）
   */
  function adopt(rec, key) {
    var target = modelOf(key);
    var src = rec && typeof rec === "object" ? rec : {};
    var out = JSON.parse(JSON.stringify(src));
    out.algo = target.key;

    var learned = !!src.learned;
    var level = typeof src.level === "number" ? clampLevel(src.level) : (learned ? 1 : 0);
    var lapses = typeof src.lapses === "number" ? src.lapses : 0;
    var days = EBBINGHAUS_INTERVALS[level] || 0;

    out.level = level;

    if (target.key === "leitner") {
      // 5 个盒子对上 10 个阶段：两阶并一盒（0/1 → 盒 00，… 8/9 → 盒 4）
      var box = Math.max(0, Math.min(MODELS.leitner.boxes.length - 1, Math.floor(level / 2)));
      // 未学过的：停在 0 号盒（第一次记住时由 review 推进）
      out.box = learned ? box : 0;
    } else if (target.key === "sm2") {
      var iv = learned ? Math.max(src.interval || 0, days) : 0;
      // 忘得多的篇目，简易度给低一点（至少 1.3，与 SM-2 原版下限一致）
      var ef = Math.round(Math.max(1.3, MODELS.sm2.DEFAULT_EF - lapses * 0.1) * 100) / 100;
      out.interval = iv;
      out.ef = ef;
    } else if (target.key === "fsrs") {
      var s = learned ? Math.max(src.stability || 0, src.interval || 0, days || MODELS.fsrs.params.minS)
        : MODELS.fsrs.params.initS.good;
      // 忘得多 → 难度高（每忘一次 +0.5，封顶 10）
      var d = Math.min(MODELS.fsrs.params.maxD, MODELS.fsrs.params.initD + lapses * 0.5);
      out.stability = Math.round(s * 100) / 100;
      out.difficulty = Math.round(d * 100) / 100;
    }
    /* ebbinghaus 不需要额外字段：它只读 level */

    return out;
  }

  /* ==========================================================================
     三、一次复习 → 下一次何时复习
     ========================================================================== */

  /**
   * 记录一次复习结果，算出下一次复习时间。
   *
   * @param {Object} rec    旧记录（可为 null，表示新学）
   * @param {string} result "good" | "fuzzy" | "bad"
   * @param {string} [key]  模型；缺省取 rec.algo，再缺省取出厂默认
   * @param {number} [now]  基准时间（测试用）
   * @returns {Object} 新记录（新对象；公用字段齐全，另带该模型的状态）
   */
  function review(rec, result, key, now) {
    var t = now === undefined ? Date.now() : now;
    var src = rec && typeof rec === "object" ? rec : null;
    var modelKey = known(key) ? key : (src && known(src.algo) ? src.algo : DEFAULT_KEY);
    var model = modelOf(modelKey);

    /** 先把旧记录换算成本模型的状态（同模型就是原样复制） */
    var r = src ? adopt(src, modelKey) : null;
    if (!r) {
      r = {
        level: 0, nextReviewAt: t, lastReviewAt: null, reviewCount: 0,
        lapses: 0, learned: false, history: []
      };
      var init = model.init();
      Object.keys(init).forEach(function (k) { r[k] = init[k]; });
      r.algo = modelKey;
    }

    r.lastReviewAt = t;
    r.reviewCount = (r.reviewCount || 0) + 1;
    r.learned = true;
    // 距上次复习过了几天（FSRS 算 R 要用；没有上次就按 0，即刚背完）
    var elapsedDays = src && src.lastReviewAt
      ? Math.max(0, (t - src.lastReviewAt) / DAY)
      : 0;

    if (result === "fuzzy") {
      /* 模糊：所有模型一致 —— 原地停留、12 小时后再来。
         不推进任何模型的「记住」计数：这一次不算掌握。 */
      r.nextReviewAt = t + FUZZY_HOURS * HOUR;
      pushHistory(r, result, t);
      return r;
    }

    if (result === "bad") {
      /* 忘记：所有模型一致 —— 30 分钟后再来，且计一次遗忘。 */
      r.lapses = (r.lapses || 0) + 1;
      advance(modelKey, r, result, elapsedDays);
      r.nextReviewAt = t + BAD_MINUTES * MIN;
      pushHistory(r, result, t);
      return r;
    }

    /* 记住：各模型推进自己的状态，再按新状态定下一次日期 */
    advance(modelKey, r, "good", elapsedDays);
    var days = daysFor(modelKey, r);
    r.nextReviewAt = dayAt(t, days);
    pushHistory(r, result, t);
    return r;
  }

  /** 按模型推进内部状态（level 是公用字段，任何模型都推） */
  function advance(modelKey, r, result, elapsedDays) {
    var model = modelOf(modelKey);

    if (modelKey === "ebbinghaus") {
      r.level = result === "good"
        ? Math.min(clampLevel(r.level) + 1, EBBINGHAUS_INTERVALS.length - 1)
        : Math.max(0, clampLevel(r.level) - 1);
      return;
    }

    if (modelKey === "leitner") {
      var b = clampBox(r.box);
      r.box = result === "good"
        ? Math.min(b + 1, model.boxes.length - 1)
        : 0;                       // 忘了就退回 1 号盒 —— 原版 Leitner 的做法
      r.level = Math.min(9, r.box * 2 + (result === "good" ? 1 : 0));
      return;
    }

    if (modelKey === "sm2") {
      var q = model.grades[result];
      var passed = q >= 3;         // SM-2 原版：3 分及以上算通过
      r.ef = model.efAfter(typeof r.ef === "number" ? r.ef : model.DEFAULT_EF, q);
      var passCount = passed
        ? Math.max(1, Math.min(9, (r.level || 0) + 1))
        : 1;                        // 忘了：间隔从头开始（1 天）
      r.interval = model.intervalAfter(r.interval || 0, r.ef, passCount);
      r.level = passed ? Math.min(9, passCount) : Math.max(1, (r.level || 1) - 1);
      return;
    }

    /* FSRS 简化版 */
    var ss = typeof r.stability === "number" ? r.stability : model.params.initS.good;
    var dd = typeof r.difficulty === "number" ? r.difficulty : model.params.initD;
    var rNow = model.retrievability(ss, elapsedDays);
    r.stability = model.stabilityAfter(ss, dd, result, rNow);
    r.difficulty = model.difficultyAfter(dd, result);
    r.level = result === "good"
      ? Math.min(9, (r.level || 0) + 1)
      : Math.max(1, (r.level || 1) - 1);
  }

  /** 该模型下「记不住 / 记住」的间隔天数（bad 由调用方覆盖成 30 分钟） */
  function daysFor(modelKey, r) {
    var model = modelOf(modelKey);
    if (modelKey === "ebbinghaus") return model.intervalDays(r.level);
    if (modelKey === "leitner") return model.intervalDays(r.box);
    if (modelKey === "sm2") return Math.max(1, r.interval || 1);
    return model.intervalOf(r.stability);       // fsrs
  }

  function pushHistory(r, result, t) {
    if (!Array.isArray(r.history)) r.history = [];
    r.history.push({ at: t, result: result, level: r.level, algo: r.algo });
  }

  /* ==========================================================================
     四、给界面用的说明文案
     ========================================================================== */

  /** 首页顶栏第二行：「按 X 复习」 */
  function subFor(key) {
    return modelOf(key).sub;
  }

  /** 「记住 / 模糊 / 忘记」三个按钮下面的结果提示（每个模型说法不同） */
  function resultHint(key, result, rec) {
    var model = modelOf(key);
    if (result === "fuzzy") return "有点模糊，" + FUZZY_HOURS + " 小时后再复习一次";
    if (result === "bad") return "没关系，" + BAD_MINUTES + " 分钟后再复习一次";
    var days = rec ? monthsDays(rec, key) : 0;
    if (!days) return "记住了！";
    return "记住了！下次复习：" + days;
  }

  function monthsDays(rec, key) {
    if (!rec || !rec.nextReviewAt) return "";
    return new Date(rec.nextReviewAt).toLocaleDateString("zh-CN");
  }

  /** 设置页里那一段说明：模型名 + 出处 + 一句话取舍 + 当前生效的解释 */
  function describe(key) {
    var m = modelOf(key);
    return {
      key: m.key,
      name: m.name,
      short: m.short,
      sub: m.sub,
      years: m.years,
      blurb: m.blurb
    };
  }

  window.ReviewModels = {
    MODELS: MODELS,
    ORDER: ORDER,
    DEFAULT_KEY: DEFAULT_KEY,
    FUZZY_HOURS: FUZZY_HOURS,
    BAD_MINUTES: BAD_MINUTES,
    EBBINGHAUS_INTERVALS: EBBINGHAUS_INTERVALS,
    keys: keys,
    known: known,
    modelOf: modelOf,
    adopt: adopt,
    review: review,
    subFor: subFor,
    resultHint: resultHint,
    describe: describe,
    startOfDay: startOfDay,
    dayAt: dayAt
  };
})();
