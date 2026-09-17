(function () {
  "use strict";

  var DAY = 24 * 60 * 60 * 1000;
  var HOUR = 60 * 60 * 1000;
  var MIN = 60 * 1000;

  var FUZZY_HOURS = 12;
  var BAD_MINUTES = 30;

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
      name: "遗忘曲线",
      short: "遗忘曲线",
      sub: "按遗忘曲线复习",
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

    var elapsedDays = src && src.lastReviewAt
      ? Math.max(0, (t - src.lastReviewAt) / DAY)
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
