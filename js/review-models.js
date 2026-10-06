(function () {
  "use strict";

  var DAY = 24 * 60 * 60 * 1000;
  var HOUR = 60 * 60 * 1000;
  var MIN = 60 * 1000;

  var FUZZY_HOURS = 12;
  var BAD_MINUTES = 30;

  // 一天只算一次，且以**最后一次**的选择为准（Issue #481）。
  //
  // 用户一天之内可以对同一首反复改判（记住 → 忘记 → 记住）：记忆阶段、
  // 遗忘次数、下次复习时间、复习次数都按最后一次那个选择算。做法是把
  // 「今天头一次点击之前」的那份记录留在 `dayBase` 里，改判时先退回它、
  // 再按新选择算一遍 —— 于是三条一起翻，不会出现「阶段是忘记的、遗忘
  // 次数却算了两次」这种自相矛盾。
  //
  // 跨过 0 点 `dayBase` 作废（日期对不上），下一次点击是全新的一天，
  // 复习次数才 +1。日界用本地时间，与首页的「今天」、每日加背的归零同一口径。
  function dayOf(ts) {
    var d = new Date(ts);
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  function startOfDay(ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function dayAt(ts, days) {
    return startOfDay(ts) + days * DAY + 9 * HOUR;
  }

  var EBBINGHAUS_INTERVALS = [0, 1, 2, 4, 7, 15, 30, 60, 120, 240];

  var MODELS = {

    ebbinghaus: {
      key: "ebbinghaus",
      name: "艾宾浩斯遗忘曲线",

      minTier: "free",
      login: false,
      short: "艾宾浩斯遗忘曲线",
      sub: "按艾宾浩斯遗忘曲线复习",
      years: "1885 · 固定间隔",
      blurb: "固定间隔表，记住就往下走一格，短篇最省心",

      stages: EBBINGHAUS_INTERVALS.length,

      init: function () {
        return { level: 0 };
      },

      stageOf: function (rec) {
        return clampLevel(rec && typeof rec.level === "number" ? rec.level : 0);
      },

      intervalDays: function (level) {
        var lv = clampLevel(level);
        return EBBINGHAUS_INTERVALS[lv];
      },

      stageName: function (rec) {
        var names = ["新学", "1天后", "2天后", "4天后", "7天后", "15天后",
          "30天后", "60天后", "120天后", "已牢固"];
        return names[clampLevel(rec && rec.level)] || "新学";
      }
    },

    leitner: {
      key: "leitner",
      name: "莱特纳盒",
      minTier: "free",
      login: true,
      short: "Leitner",
      sub: "按 Leitner 盒复习",
      years: "1972 · 分级盒子",
      blurb: "答对往后挪一盒，答错退回第一盒，像纸质卡片",

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

      stageName: function (rec) {
        var b = clampBox(rec && rec.box);
        return (b + 1) + " 号盒 · " + this.boxes[b] + " 天后";
      }
    },

    sm2: {
      key: "sm2",
      name: "SM-2",
      minTier: "pro",
      login: true,
      short: "SM-2",
      sub: "按 SM-2 复习",
      years: "1987 · 间隔 × 简易度",
      blurb: "记住就按简易度拉长间隔，长篇更贴合",

      stages: 10,

      firstIntervals: [1, 3, 7],
      DEFAULT_EF: 2.5,
      MIN_EF: 1.3,

      grades: { bad: 1, fuzzy: 3, good: 5 },
      init: function () {
        return { level: 1, interval: 0, ef: this.DEFAULT_EF };
      },
      stageOf: function (rec) {
        return clampLevel((rec && rec.level) || 0);
      },

      efAfter: function (ef, q) {
        var next = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
        return Math.max(this.MIN_EF, Math.round(next * 100) / 100);
      },

      intervalAfter: function (interval, ef, passCount) {
        if (passCount <= 1) return this.firstIntervals[0];
        if (passCount === 2) return this.firstIntervals[1];
        if (passCount === 3) return this.firstIntervals[2];
        return Math.max(1, Math.round(interval * ef));
      },

      stageName: function (rec) {
        if (!rec || !rec.learned) return "新学";
        var iv = Math.max(0, Math.round(rec.interval || 0));
        var ef = typeof rec.ef === "number" ? rec.ef : this.DEFAULT_EF;
        return "间隔 " + iv + " 天 · 简易度 " + ef;
      }
    },

    fsrs: {
      key: "fsrs",
      name: "FSRS",
      minTier: "max",
      login: true,
      short: "FSRS",
      sub: "按 FSRS 复习",
      years: "2022 · 难度 / 稳定性",
      blurb: "按难度与稳定天数排期，快忘光了就早复习",
      yearsNote: "简化版",

      params: {

        initS: { bad: 1, fuzzy: 3, good: 6 },

        initD: 5,

        dStep: { bad: 1.6, fuzzy: 0.6, good: -0.6 },
        minD: 1,
        maxD: 10,

        goodGain: 2.4,

        minS: 1
      },
      stages: 10,
      init: function () {
        return { level: 1, difficulty: this.params.initD, stability: this.params.initS.good };
      },
      stageOf: function (rec) {
        return clampLevel((rec && rec.level) || 0);
      },

      retrievability: function (stability, elapsedDays) {
        var s = Math.max(this.params.minS, stability || this.params.minS);
        var t = Math.max(0, elapsedDays || 0);
        return Math.pow(2, -t / s);
      },

      intervalOf: function (stability, target) {
        var rt = target || 0.9;
        var days = stability * (Math.log(1 / rt) / Math.log(2));
        return Math.max(1, Math.round(days));
      },

      difficultyAfter: function (d, result) {
        var step = this.params.dStep[result] || 0;
        return Math.max(this.params.minD, Math.min(this.params.maxD, d + step));
      },

      stabilityAfter: function (s, d, result, rNow) {
        var p = this.params;
        if (result === "bad") {
          return Math.max(p.minS, Math.round(s * 0.4 * 100) / 100);
        }

        var ease = (p.maxD - d) / (p.maxD - p.minD);
        var gain = p.goodGain * (0.5 + ease) * (result === "fuzzy" ? 0.6 : 1);
        var bonus = 1 + (1 - (rNow || 1)) * 0.5;
        return Math.max(p.minS, Math.round(s * gain * bonus * 100) / 100);
      },

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

  var ORDER = ["ebbinghaus", "leitner", "sm2", "fsrs"];

  var DEFAULT_KEY = "ebbinghaus";

  function keys() {
    return ORDER.slice();
  }

  function known(key) {
    return Object.prototype.hasOwnProperty.call(MODELS, key);
  }

  function modelOf(key) {
    return MODELS[known(key) ? key : DEFAULT_KEY];
  }

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

    // 今天的「底」跟着记录走（与 reviewCount 同一域），换算法不清 ——
    // 否则换一次算法就等于把今天改判的能力丢了。
    if (typeof src.dayBase === "string" && src.dayBase) out.dayBase = src.dayBase;
    if (src.dayBaseRec && typeof src.dayBaseRec === "object") {
      out.dayBaseRec = JSON.parse(JSON.stringify(src.dayBaseRec));
    }

    if (target.key === "leitner") {

      var box = Math.max(0, Math.min(MODELS.leitner.boxes.length - 1, Math.floor(level / 2)));

      out.box = learned ? box : 0;
    } else if (target.key === "sm2") {
      var iv = learned ? Math.max(src.interval || 0, days) : 0;

      var ef = Math.round(Math.max(1.3, MODELS.sm2.DEFAULT_EF - lapses * 0.1) * 100) / 100;
      out.interval = iv;
      out.ef = ef;
    } else if (target.key === "fsrs") {
      var s = learned ? Math.max(src.stability || 0, src.interval || 0, days || MODELS.fsrs.params.minS)
        : MODELS.fsrs.params.initS.good;

      var d = Math.min(MODELS.fsrs.params.maxD, MODELS.fsrs.params.initD + lapses * 0.5);
      out.stability = Math.round(s * 100) / 100;
      out.difficulty = Math.round(d * 100) / 100;
    }

    return out;
  }

  function review(rec, result, key, now) {
    var t = now === undefined ? Date.now() : now;
    var src = rec && typeof rec === "object" ? rec : null;
    var modelKey = known(key) ? key : (src && known(src.algo) ? src.algo : DEFAULT_KEY);
    var model = modelOf(modelKey);
    var today = dayOf(t);

    // 今天已经点过一次 → 这是改判。先退回「今天头一次点击之前」那份，
    // 再按新选择算一遍：阶段 / 遗忘次数 / 下次复习时间一起翻，只留最后一次。
    // ⚠️ 头一次点的可能是一张**空记录**（新学的一首），所以「有底」不能靠
    //    dayBaseRec 有没有值来判，得看 dayBase 这个日期标记 —— 它就是为
    //    了把「今天点过、且底是一张白纸」这件事记下来。
    // ⚠️ 判定只认 `dayBase` 这个日期，不看 `dayBaseRec` 在不在：跨设备拉下来
    //    的记录可能只有日期没有底（快照是本机的事，不上云）。这种情况下
    //    `reviewCount` 仍照「一天只加一次」走 —— 计数跟的是日期，不是底。
    var regrade = !!src && typeof src.lastReviewAt === "number" &&
      src.dayBase === today && dayOf(src.lastReviewAt) === today;
    var base = regrade && src.dayBaseRec ? src.dayBaseRec : (regrade ? null : src);
    var counted = regrade && typeof src.reviewCount === "number";

    var r = base && typeof base === "object" ? adopt(base, modelKey) : null;
    if (!r) {
      r = {
        level: 0, nextReviewAt: t, lastReviewAt: null, reviewCount: 0,
        lapses: 0, learned: false, history: []
      };
      var init = model.init();
      Object.keys(init).forEach(function (k) { r[k] = init[k]; });
      r.algo = modelKey;
    }

    // 今天的「底」：头一次点击时留一份「点之前」的原样；改判时把它带过去
    // （adopt 读的是底本身，底里没有底，不显式搬一次第二次改判就丢了）。
    r.dayBase = regrade ? src.dayBase : today;
    if (regrade) r.dayBaseRec = src.dayBaseRec || null;
    else if (src) r.dayBaseRec = JSON.parse(JSON.stringify(src));
    else r.dayBaseRec = null;

    r.lastReviewAt = t;
    // 一天只算一次：改判原样留着今天那头一次加的那个数，跨天才 +1。
    r.reviewCount = counted ? Math.max(1, src.reviewCount) : (r.reviewCount || 0) + 1;
    r.learned = true;

    var elapsedDays = base && base.lastReviewAt
      ? Math.max(0, (t - base.lastReviewAt) / DAY)
      : 0;

    if (result === "fuzzy") {

      r.nextReviewAt = t + FUZZY_HOURS * HOUR;
      pushHistory(r, result, t);
      return r;
    }

    if (result === "bad") {

      r.lapses = (r.lapses || 0) + 1;
      advance(modelKey, r, result, elapsedDays);
      r.nextReviewAt = t + BAD_MINUTES * MIN;
      pushHistory(r, result, t);
      return r;
    }

    advance(modelKey, r, "good", elapsedDays);
    var days = daysFor(modelKey, r);
    r.nextReviewAt = dayAt(t, days);
    pushHistory(r, result, t);
    return r;
  }

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
        : 0;
      r.level = Math.min(9, r.box * 2 + (result === "good" ? 1 : 0));
      return;
    }

    if (modelKey === "sm2") {
      var q = model.grades[result];
      var passed = q >= 3;
      r.ef = model.efAfter(typeof r.ef === "number" ? r.ef : model.DEFAULT_EF, q);
      var passCount = passed
        ? Math.max(1, Math.min(9, (r.level || 0) + 1))
        : 1;
      r.interval = model.intervalAfter(r.interval || 0, r.ef, passCount);
      r.level = passed ? Math.min(9, passCount) : Math.max(1, (r.level || 1) - 1);
      return;
    }

    var ss = typeof r.stability === "number" ? r.stability : model.params.initS.good;
    var dd = typeof r.difficulty === "number" ? r.difficulty : model.params.initD;
    var rNow = model.retrievability(ss, elapsedDays);
    r.stability = model.stabilityAfter(ss, dd, result, rNow);
    r.difficulty = model.difficultyAfter(dd, result);
    r.level = result === "good"
      ? Math.min(9, (r.level || 0) + 1)
      : Math.max(1, (r.level || 1) - 1);
  }

  function daysFor(modelKey, r) {
    var model = modelOf(modelKey);
    if (modelKey === "ebbinghaus") return model.intervalDays(r.level);
    if (modelKey === "leitner") return model.intervalDays(r.box);
    if (modelKey === "sm2") return Math.max(1, r.interval || 1);
    return model.intervalOf(r.stability);
  }

  function pushHistory(r, result, t) {
    if (!Array.isArray(r.history)) r.history = [];
    r.history.push({ at: t, result: result, level: r.level, algo: r.algo });
  }

  // 今天点过了吗 —— 首页/详情页据此把「改判」这件事说出来（点过就提示
  // 「今天已选过，再点只改不算新的一次」）。
  function gradedToday(rec, now) {
    if (!rec || typeof rec !== "object") return false;
    var t = now === undefined ? Date.now() : now;
    if (typeof rec.lastReviewAt !== "number") return false;
    return dayOf(rec.lastReviewAt) === dayOf(t) && !!rec.dayBase;
  }

  // 今天选的是哪一个 —— 弹卡片时把那颗按钮点亮，用户一眼看见自己上次点的
  // 是「忘记」而不是「记住」，再点就是改判（Issue #481）。
  function todayResult(rec, now) {
    if (!gradedToday(rec, now)) return "";
    var h = Array.isArray(rec.history) ? rec.history : [];
    for (var i = h.length - 1; i >= 0; i--) {
      if (h[i] && dayOf(h[i].at) === dayOf(now === undefined ? Date.now() : now)) {
        return h[i].result || "";
      }
    }
    return "";
  }

  function subFor(key) {
    return modelOf(key).sub;
  }

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

  function describe(key) {
    var m = modelOf(key);
    return {
      key: m.key,
      name: m.name,
      short: m.short,
      sub: m.sub,
      years: m.years,
      blurb: m.blurb,
      minTier: m.minTier,
      login: !!m.login
    };
  }

  function ent() {
    if (typeof window !== "undefined" && window && window.Entitlement) return window.Entitlement;
    if (typeof globalThis !== "undefined" && globalThis.Entitlement) return globalThis.Entitlement;
    return null;
  }

  function entrance(key) {
    return "algo." + (known(key) ? key : DEFAULT_KEY);
  }

  function allowed(key, ctx) {
    var k = known(key) ? key : DEFAULT_KEY;
    var E = ent();
    if (!E || typeof E.can !== "function") {

      return k === DEFAULT_KEY;
    }
    var c = ctx || { tier: "free", signedIn: false };
    return !!E.can(entrance(k), c).ok;
  }

  function allowedKey(want, ctx) {
    if (allowed(want, ctx)) return known(want) ? want : DEFAULT_KEY;
    for (var i = ORDER.length - 1; i >= 0; i--) {
      if (allowed(ORDER[i], ctx)) return ORDER[i];
    }
    return DEFAULT_KEY;
  }

  function allowedKeys(ctx) {
    return ORDER.filter(function (k) { return allowed(k, ctx); });
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
    entrance: entrance,
    allowed: allowed,
    allowedKey: allowedKey,
    allowedKeys: allowedKeys,
    adopt: adopt,
    review: review,
    dayOf: dayOf,
    gradedToday: gradedToday,
    todayResult: todayResult,
    subFor: subFor,
    resultHint: resultHint,
    describe: describe,
    startOfDay: startOfDay,
    dayAt: dayAt
  };
})();
