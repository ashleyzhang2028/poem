/**
 * 背诵进度总览（/progress/）
 * ==========================================================================
 * 为什么要有这一页：
 *   「这篇在第几轮」「这篇掌握度多少」「下次何时到期」原先只在**单篇**的
 *   详情弹层里看得到（首页点开任意一首，底部那三行）。单篇视角够用，
 *   但它回答不了两个真正想知道的问题：
 *     · 接下来哪天要复习几篇？今天要背几篇？（到期日历）
 *     · 我整体到什么程度了？是都堆在「新学」还是已经有一批「较牢固」？（分布）
 *   所以这一页把**全量**摊成两张图 —— 数据全部来自 localStorage，
 *   一页只读，不改任何一篇的排期。
 *
 * ## 这一页做什么、不做什么
 *
 * 做：到期日历（未来 14 天每天到期的篇数 + 逾期提醒）、掌握度分布（五档）、
 *     记忆阶段分布（新学 / 1 天后 / …… / 已牢固）。
 * 不做：不写任何一篇的进度、不重排今日任务、不改「已读」标记。
 *     这是「看进度」的地方，动数据的事在首页那一套里做。
 *
 * ## 口径
 *
 * 读的是**课内 261 首**（POEMS_ALL）的进度 —— 与首页「今日背诵」同一份数据、
 * 同一个键（poem_recite_progress_v1）。自选集合里的课外篇目也在这份进度里
 * （加自选时排程代表条目并到课内那一条；纯课外的用它自己的 id），
 * 所以这一页的账与首页「已学 / 较牢固 / 待复习」那四格是同一本账。
 * ========================================================================== */
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };

  /** 到期日历看未来多少天（含今天这一档） */
  var DAYS = 14;

  /** 篇名显示名：去掉语料内部区分同名词作的「其一 / 其二」（见 js/collections.js） */
  function showTitle(t) {
    if (window.ReciteCollections && window.ReciteCollections.displayTitle) {
      return window.ReciteCollections.displayTitle(t);
    }
    return t;
  }

  /** 篇目表：课内 261 首（`{id, title}` 就够，这一页只用它算账） */
  function poems() {
    return (window.POEMS_ALL || []).filter(function (p) { return p && p.id; });
  }

  function getRecord(id) {
    return window.Storage ? window.Storage.get(id) : null;
  }

  /** 日期 → 「7/14」这种短写法 */
  function md(ts) {
    var d = new Date(ts);
    return (d.getMonth() + 1) + "/" + d.getDate();
  }

  /** 星期几（只用中文单字，日历格子窄） */
  var WEEK = ["日", "一", "二", "三", "四", "五", "六"];

  /* ---------------- 总览四格 ---------------- */
  function renderStats(o) {
    var box = $("#progress-stats");
    if (!box) return;
    box.innerHTML =
      '<div class="stat"><b>' + o.learned + "</b><span>已学</span></div>" +
      '<div class="stat review"><b>' + o.dueToday + "</b><span>待复习</span></div>" +
      '<div class="stat"><b>' + o.avgMastery + "%</b><span>平均掌握</span></div>" +
      '<div class="stat"><b>' + o.unlearned + "</b><span>尚未学过</span></div>";

    var tip = $("#progress-tip");
    if (!tip) return;
    if (!o.learned) {
      tip.textContent = "还没有学习记录。到首页背一首，回来就能看到到期日历与掌握度。";
      return;
    }
    // 逾期要单独说一句：它被并进「今天」那一格里，不说明的话用户会以为
    // 今天凭空多了几篇 —— 其实是他前几天漏掉的
    tip.textContent = o.overdue
      ? "共 " + o.total + " 首里已学 " + o.learned + " 首，其中 " + o.overdue +
        " 首已逾期超过一周（已并进「今天」这一格）。"
      : "共 " + o.total + " 首里已学 " + o.learned + " 首。";
  }

  /* ---------------- 到期日历 ---------------- */
  function renderCalendar(o) {
    var box = $("#progress-calendar");
    if (!box) return;

    var max = Math.max(1, o.maxDay);
    box.innerHTML = "";
    o.calendar.forEach(function (d, i) {
      var cell = document.createElement("div");
      cell.className = "cal-cell" + (i === 0 ? " today" : "") + (d.count ? " has" : "");
      // 竖条高度按「这一档最多的一天」归一 —— 有 3 篇的那天就是满格，
      // 免得 1 篇与 30 篇画出来一样高（那样这张图等于没画）
      var h = d.count ? Math.max(7, Math.round((d.count / max) * 100)) : 0;
      cell.innerHTML =
        '<span class="cal-count">' + (d.count || "") + "</span>" +
        '<span class="cal-bar"><i style="height:' + h + '%"></i></span>' +
        '<span class="cal-day">' + (i === 0 ? "今天" : WEEK[new Date(d.date).getDay()]) + "</span>" +
        '<span class="cal-date">' + md(d.date) + "</span>";
      cell.title = (i === 0 ? "今天" : md(d.date) + "（周" + WEEK[new Date(d.date).getDay()] + "）") +
        "：" + (d.count ? d.count + " 首要复习" : "没有到期的");
      box.appendChild(cell);
    });

    var sub = $("#calendar-sub");
    if (sub) {
      var busy = o.calendar.filter(function (d) { return d.count > 0; }).length;
      sub.textContent = o.learned
        ? "未来 " + (DAYS - 1) + " 天里 " + busy + " 天有复习"
        : "还没有学习记录";
    }
    var note = $("#calendar-note");
    if (note) {
      note.textContent = o.overdue
        ? "「今天」这一格含 " + o.overdue + " 首逾期超过一周的篇目。"
        : "竖条越高，那天要复习的篇目越多。";
    }
  }

  /* ---------------- 掌握度 / 记忆阶段：横条 ---------------- */
  /**
   * 一组横条。
   * @param {string} sel   容器
   * @param {Array} rows   [{ label, count, tone }]
   * @param {Function} [onPick]  点某一行时的回调（可省）
   */
  function renderBars(sel, rows, onPick) {
    var box = $(sel);
    if (!box) return;
    var max = rows.reduce(function (a, r) { return Math.max(a, r.count); }, 0);
    box.innerHTML = "";
    rows.forEach(function (r) {
      var el = document.createElement("div");
      el.className = "bar-row" + (r.tone ? " " + r.tone : "") + (r.count ? "" : " zero");
      el.innerHTML =
        '<span class="bar-label">' + escapeHtml(r.label) + "</span>" +
        '<span class="bar-track"><i style="width:' +
        (max ? Math.round((r.count / max) * 100) : 0) + '%"></i></span>' +
        '<span class="bar-count">' + r.count + "</span>";
      if (onPick) {
        el.classList.add("pickable");
        el.addEventListener("click", function () { onPick(r); });
      }
      box.appendChild(el);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /** 掌握度五档：与 Scheduler.mastery() 那把尺子对齐（每 20% 一档） */
  var MASTERY_LABELS = [
    { label: "0-19% 刚起步", tone: "m0" },
    { label: "20-39% 在记", tone: "m1" },
    { label: "40-59% 过半", tone: "m2" },
    { label: "60-79% 较熟", tone: "m3" },
    { label: "80-100% 牢固", tone: "m4" }
  ];

  function renderMastery(o) {
    var rows = MASTERY_LABELS.map(function (m, i) {
      return { label: m.label, count: o.masteryBuckets[i], tone: m.tone };
    });
    renderBars("#progress-mastery", rows);
    var sub = $("#mastery-sub");
    if (sub) {
      sub.textContent = o.learned ? "已学 " + o.learned + " 首，平均 " + o.avgMastery + "%" : "还没有学习记录";
    }
  }

  function renderLevels(o) {
    var rows = o.levelCounts.map(function (l, i) {
      // 「已牢固」是最末一档，单独一种色；其余按阶深浅走
      var tone = i === o.levelCounts.length - 1 ? "lv-last" : "lv";
      return { label: l.name, count: l.count, tone: tone };
    });
    renderBars("#progress-levels", rows);
    var sub = $("#levels-sub");
    if (sub) {
      // 「已牢固」= 走完 10 阶（240 天后那一档），与首页「较牢固」同一口径
      var last = o.levelCounts[o.levelCounts.length - 1].count;
      sub.textContent = o.learned ? "走完全程的 " + last + " 首" : "还没有学习记录";
    }
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    var list = poems();
    var head = $(".app");
    if (!list.length) {
      if (head) head.innerHTML = '<div class="empty" style="padding:60px 20px">诗词数据加载失败</div>';
      return;
    }
    if (!window.Scheduler || !window.Scheduler.overview) return;

    var o = window.Scheduler.overview(list, getRecord, { days: DAYS });
    renderStats(o);
    renderCalendar(o);
    renderMastery(o);
    renderLevels(o);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
