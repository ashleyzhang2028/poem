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
 * 做：到期日历（未来 14 天每天到期的篇数 + 逾期提醒）、**全部到期篇目**
 *     （哪天该背哪几篇，日历那一格的展开）、掌握度分布（五档）、
 *     记忆阶段分布（新学 / 1 天后 / …… / 已牢固）。
 * 不做：不写任何一篇的进度、不重排今日任务、不改「已读」标记。
 *     这是「看进度」的地方，动数据的事在首页那一套里做。
 *
 * ⚠️ 日历与篇目清单**必须同一本账**：日历说今天 3 篇，清单里今天就得是那 3 篇。
 *    两边都走 Scheduler 的同一套归档规则（逾期并进今天、逾期一周以上单列），
 *    数不一致就是 bug —— test/progress.test.js 拿两边的数对账。
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
      tip.textContent = "还没有学习记录。";
      return;
    }
    /* 逾期要单独说一句：不说明的话用户会以为「今天凭空多了几篇」——
       其实是他前几天漏掉的。但口径要说准（#119 这里写反了）：
         · 逾期**一周以内**的：并进「今天」那一格（他今天确实该补）；
         · 逾期**超过一周**的：**另计**一条（唯一那截 backlog），
           日历与清单都**不并进**今天 —— 否则两处数就对不上。
       所以这里说「另有 N 首逾期超过一周」，不能说「已并进今天」。 */
    tip.textContent = "共 " + o.total + " 首，已学 " + o.learned + " 首" +
      (o.overdue ? "，另有 " + o.overdue + " 首逾期超过一周（另计，不在今天那一格）" : "") + "。";
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
      // 点得到「那天是哪些篇目」（下方清单里的那一档）—— 见 bindCalendarJump()
      cell.setAttribute("data-offset", String(i));
      cell.setAttribute("role", "button");
      cell.setAttribute("tabindex", "0");
      // 竖条高度按「这一档最多的一天」归一 —— 有 3 篇的那天就是满格，
      // 免得 1 篇与 30 篇画出来一样高（那样这张图等于没画）
      var h = d.count ? Math.max(7, Math.round((d.count / max) * 100)) : 0;
      cell.innerHTML =
        '<span class="cal-count">' + (d.count || "") + "</span>" +
        '<span class="cal-bar"><i style="height:' + h + '%"></i></span>' +
        '<span class="cal-day">' + (i === 0 ? "今天" : WEEK[new Date(d.date).getDay()]) + "</span>" +
        '<span class="cal-date">' + md(d.date) + "</span>";
      cell.title = (i === 0 ? "今天" : md(d.date) + "（周" + WEEK[new Date(d.date).getDay()] + "）") +
        "：" + (d.count ? d.count + " 首要复习（点一下看是哪几篇）" : "没有到期的");
      box.appendChild(cell);
    });

    var sub = $("#calendar-sub");
    if (sub) {
      var busy = o.calendar.filter(function (d) { return d.count > 0; }).length;
      sub.textContent = o.learned ? busy + " 天有复习" : "还没有学习记录";
    }
    var note = $("#calendar-note");
    if (note) {
      /* 「今天」这一格含的是**今天到期的 + 逾期一周以内的**；
         逾期一周以上的（o.overdue）另计一条，不在这格里。 */
      note.textContent = o.overdue
        ? "另有 " + o.overdue + " 首逾期超过一周（另计，未并进今天）。"
        : "";
    }
  }

  /* ---------------- 全部到期篇目 ---------------- */
  /**
   * 篇目清单：把日历上「哪天几篇」摊成「哪天是**哪几篇**」。
   *
   * 与日历同一本账、同一套归档规则（见 Scheduler.dueList 的注释）：
   *   今天这一档 = 今天到期的 + 逾期一周以内的 + 逾期一周以上的（另标一截）
   *   其余各天按偏移排；超出 14 天窗口的不列篇名，只在脚注里报个数。
   *
   * 每一篇显示：篇名（+朝代作者）、记忆阶段、掌握度，以及「逾期几天 / 还有几天」。
   * 点篇名跳到首页去背（这一页只读，不在原地改进度）。
   */
  function renderDueList(o) {
    var box = $("#progress-duelist");
    if (!box) return;

    var L = o.dueList;
    var sub = $("#duelist-sub");
    var note = $("#duelist-note");

    if (!L || !L.total) {
      box.innerHTML = '<div class="empty duelist-empty">还没有到期的篇目' +
        (o.learned ? "，接下来的两周都没有要复习的" : "，先到首页背几首再回来") + "</div>";
      if (sub) sub.textContent = o.learned ? "两周内无到期" : "还没有学习记录";
      if (note) note.textContent = "";
      return;
    }

    /* ⚠️ 「今天 N 篇」这个 N 必须等于**日历上今天那一格**的数（`o.calendar[0].count`），
       不能把 backlog 并进来 —— 这是 #119 留下的真 bug：
       原先这里写的是 `L.days[0].items.length + L.backlog.length`（把逾期一周以上
       的也算进今天），而日历那一格与今天这一档的表头都**不含**它们
       （overview 的 overdue 是另计一条）。于是只要有一篇逾期超过一周，
       日历说今天 1 篇、清单汇总说今天 2 篇 —— 正是「同一本账」要防的情形。
       逾期那一批由下方「逾期超过一周 · N 篇」那一截单独报。
       `test/progress.test.js` 现在造了「逾期 9 天」的进度，逐格对账兜住它。 */
    var today = L.days[0].items.length;
    if (sub) {
      /* 三个数各说一件事，别混：
           · 今天 N 篇        —— 日历上今天那一格的数（不含逾期一周以上）
           · 逾期超过一周 M 篇 —— 单独一截，另计（不并进上面那个 N）
           · 未来两周共 T 篇   —— 14 天窗口里要做的全部（含上面两项）
         原先这里把 backlog 并进了「今天」，与日历那一格对不上（见上）。 */
      var parts = [];
      parts.push(today ? "今天 " + today + " 篇" : "今天无到期");
      if (L.backlog.length) parts.push("逾期超一周 " + L.backlog.length + " 篇");
      parts.push("两周共 " + L.total + " 篇");
      sub.textContent = parts.join(" · ");
    }

    box.innerHTML = "";
    L.days.forEach(function (d, i) {
      // 空档不画：翻完两周里没到期的那几天，列一行「这天没有到期的」毫无用处。
      // ⚠️ 今天那一档例外：逾期一周以上的篇目要挂在这一档下面，
      //    即使「今天到期」本身是 0 篇，那一截也得画出来。
      if (!d.items.length && !(i === 0 && L.backlog.length)) return;
      var block = document.createElement("div");
      block.className = "duelist-day" + (i === 0 ? " today" : "");
      block.setAttribute("data-offset", String(d.offset));

      var head = document.createElement("div");
      head.className = "duelist-day-head";
      head.innerHTML =
        '<span class="duelist-when">' + (i === 0 ? "今天" : md(d.date) + " 周" + WEEK[new Date(d.date).getDay()]) +
        "</span>" +
        '<span class="duelist-count">' + d.items.length + " 篇</span>";
      block.appendChild(head);

      var list = document.createElement("div");
      list.className = "duelist-items";
      d.items.forEach(function (it) { list.appendChild(dueItem(it)); });
      block.appendChild(list);

      // 逾期一周以上的：单列一小截挂在「今天」下面。
      // 为什么不并进今天那一档的篇数：日历上「今天」那一格也不含它们
      // （overview 的 overdue 是另计一条），并进来两处数就对不上了。
      if (i === 0 && L.backlog.length) {
        var lateHead = document.createElement("div");
        lateHead.className = "duelist-overdue-head";
        lateHead.textContent = "逾期超过一周 · " + L.backlog.length + " 篇";
        block.appendChild(lateHead);
        var lateList = document.createElement("div");
        lateList.className = "duelist-items late";
        L.backlog.forEach(function (it) { lateList.appendChild(dueItem(it)); });
        block.appendChild(lateList);
      }
      box.appendChild(block);
    });

    if (note) {
      note.textContent = L.farther ? "更远还有 " + L.farther + " 篇。" : "";
    }
  }

  /** 清单里的一篇：篇名 + 元信息 + 「逾期几天 / 还有几天」 */
  function dueItem(it) {
    var row = document.createElement("a");
    row.className = "duelist-item";
    // 回首页去背：这一页只读，不在原地改进度（与首页那一套分开）
    row.href = "/?poem=" + encodeURIComponent(it.id);
    row.innerHTML =
      '<span class="duelist-title">' + escapeHtml(showTitle(it.title)) + "</span>" +
      '<span class="duelist-meta">' +
        escapeHtml([it.dynasty, it.author].filter(Boolean).join(" · ")) +
      "</span>" +
      '<span class="duelist-state">' +
        escapeHtml(it.stageName || window.Scheduler.levelName(it.level)) + " · " + it.mastery + "%" +
      "</span>" +
      '<span class="duelist-due' + (it.daysLeft < 0 ? " late" : "") + '">' + dueText(it.daysLeft) + "</span>";
    row.title = showTitle(it.title) + "：" + dueText(it.daysLeft) +
      "，当前在「" + (it.stageName || window.Scheduler.levelName(it.level)) +
      "」、掌握度 " + it.mastery + "%";
    return row;
  }

  /** 「逾期 3 天」/「今天」/「还有 2 天」 */
  function dueText(daysLeft) {
    if (daysLeft < 0) return "逾期 " + -daysLeft + " 天";
    if (daysLeft === 0) return "今天";
    return "还有 " + daysLeft + " 天";
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
      sub.textContent = o.learned ? "平均 " + o.avgMastery + "%" : "";
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
      // 「已牢固」= 走完 10 阶（240 天后那一档），与首页「较牢固」同一口径。
      // 换算法后档名会跟着变（Leitner 说「号盒」、SM-2 说「间隔与简易度」、
      // FSRS 说「稳定与难度」）—— 这里顺带把当前用的是哪一套说出来，
      // 免得用户看到和上次不一样的档名，以为是数据串了。
      var last = o.levelCounts[o.levelCounts.length - 1].count;
      var algo = window.ReviewModels ? window.ReviewModels.describe(algoKey()).name : "";
      var tail = algo && algo !== "遗忘曲线" ? "（按 " + algo + " 排期）" : "";
      sub.textContent = o.learned ? "已走完 " + last + " 首" + tail : "";
    }
  }

  /** 当前复习算法：进度页只读设置，不改它 */
  function algoKey() {
    var s = window.Storage ? window.Storage.getSettings() : null;
    var key = s && s.algo;
    if (!window.ReviewModels) return "ebbinghaus";
    return window.ReviewModels.known(key) ? key : window.ReviewModels.DEFAULT_KEY;
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

    var ak = algoKey();
    var o = window.Scheduler.overview(list, getRecord, { days: DAYS, algo: ak });
    // 篇目清单与日历是同一本账：一次算好挂到 o 上，页面各画各的
    // （两处各自算一遍迟早会算出两个数，而表现是「日历说 3 篇、清单里 2 篇」）
    o.dueList = window.Scheduler.dueList(list, getRecord, { days: DAYS });
    renderStats(o);
    renderCalendar(o);
    renderDueList(o);
    renderMastery(o);
    renderLevels(o);
    bindCalendarJump();
  }

  /**
   * 点日历某一格 → 下方篇目清单滚到那一天。
   *
   * 为什么要有这一步：日历是「哪天忙」的形状，用户看见某天一根高条，
   * 下一个动作必然是「那天是哪些」—— 原先只能自己往下翻。
   * 没到期的那几天没有对应的清单块（空档不画），点了就滚到今天那一档。
   */
  function bindCalendarJump() {
    var cal = $("#progress-calendar");
    if (!cal) return;
    var jump = function (ev) {
      var cell = ev.target && ev.target.closest ? ev.target.closest(".cal-cell") : null;
      if (!cell) return;
      var offset = cell.getAttribute("data-offset");
      var box = $("#progress-duelist");
      if (!box) return;
      var target = box.querySelector('.duelist-day[data-offset="' + offset + '"]');
      if (!target) target = box.querySelector(".duelist-day.today");
      if (!target) return;
      if (target.scrollIntoView) target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.classList.remove("flash");
      // 强制重排后再加，动画才会重放（连点同一格时也要闪一次）
      void target.offsetWidth;
      target.classList.add("flash");
    };
    cal.addEventListener("click", jump);
    // 只做了点击的话键盘用户按 Enter / 空格没有任何反应 ——
    // 格子挂了 role="button" / tabindex="0"，就得把键也接上
    cal.addEventListener("keydown", function (ev) {
      if (ev.key !== "Enter" && ev.key !== " " && ev.key !== "Spacebar") return;
      var cell = ev.target && ev.target.closest ? ev.target.closest(".cal-cell") : null;
      if (!cell) return;
      ev.preventDefault();
      jump(ev);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
