(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };

  var DAYS = 14;

  function showTitle(t) {
    if (window.ReciteCollections && window.ReciteCollections.displayTitle) {
      return window.ReciteCollections.displayTitle(t);
    }
    return t;
  }

  function poems() {
    return (window.POEMS_ALL || []).filter(function (p) { return p && p.id; });
  }

  function getRecord(id) {
    return window.Storage ? window.Storage.get(id) : null;
  }

  function md(ts) {
    var d = new Date(ts);
    return (d.getMonth() + 1) + "/" + d.getDate();
  }

  var WEEK = ["日", "一", "二", "三", "四", "五", "六"];

  function renderStats(o) {
    var box = $("#progress-stats");
    if (!box) return;
    box.innerHTML =
      '<div class="stat"><b>' + o.learned + "</b><span>已学</span></div>" +
      '<div class="stat review"><b>' + o.dueToday + "</b><span>复习</span></div>" +
      '<div class="stat"><b>' + o.avgMastery + "%</b><span>平均掌握</span></div>" +
      '<div class="stat"><b>' + o.unlearned + "</b><span>尚未学过</span></div>";

    var tip = $("#progress-tip");
    if (!tip) return;
    if (!o.learned) {
      tip.textContent = "还没有学习记录。";
      return;
    }

    tip.textContent = "共 " + o.total + " 首，已学 " + o.learned + " 首" +
      (o.overdue ? "，另有 " + o.overdue + " 首逾期超过一周（另计，不在今天那一格）" : "") + "。";
  }

  function renderCalendar(o) {
    var box = $("#progress-calendar");
    if (!box) return;

    var max = Math.max(1, o.maxDay);
    box.innerHTML = "";
    o.calendar.forEach(function (d, i) {
      var cell = document.createElement("div");
      cell.className = "cal-cell" + (i === 0 ? " today" : "") + (d.count ? " has" : "");

      cell.setAttribute("data-offset", String(i));
      cell.setAttribute("role", "button");
      cell.setAttribute("tabindex", "0");

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

      note.textContent = o.overdue
        ? "另有 " + o.overdue + " 首逾期超过一周（另计，未并进今天）。"
        : "";
    }
  }

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

    var today = L.days[0].items.length;
    if (sub) {

      var parts = [];
      parts.push(today ? "今天 " + today + " 篇" : "今天无到期");
      if (L.backlog.length) parts.push("逾期超一周 " + L.backlog.length + " 篇");
      parts.push("两周共 " + L.total + " 篇");
      sub.textContent = parts.join(" · ");
    }

    box.innerHTML = "";
    L.days.forEach(function (d, i) {

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

  function dueItem(it) {
    var row = document.createElement("a");
    row.className = "duelist-item";

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

  function dueText(daysLeft) {
    if (daysLeft < 0) return "逾期 " + -daysLeft + " 天";
    if (daysLeft === 0) return "今天";
    return "还有 " + daysLeft + " 天";
  }

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

      var tone = i === o.levelCounts.length - 1 ? "lv-last" : "lv";
      return { label: l.name, count: l.count, tone: tone };
    });
    renderBars("#progress-levels", rows);
    var sub = $("#levels-sub");
    if (sub) {

      var last = o.levelCounts[o.levelCounts.length - 1].count;
      var algo = window.ReviewModels ? window.ReviewModels.describe(algoKey()).name : "";
      var tail = algo && algo !== "遗忘曲线" ? "（按 " + algo + " 排期）" : "";
      sub.textContent = o.learned ? "已走完 " + last + " 首" + tail : "";
    }
  }

  function algoKey() {
    if (!window.ReviewModels) return "ebbinghaus";
    var s = window.Storage ? window.Storage.getSettings() : null;
    var key = s && s.algo;

    return window.ReviewModels.allowedKey(key, algoCtx());
  }

  function algoCtx() {
    var E = window.Entitlement;
    if (!E || typeof E.can !== "function") return undefined;
    try {
      var id = typeof E.identity === "function" ? E.identity() : null;
      return id && id.ctx ? id.ctx : undefined;
    } catch (e) {
      return undefined;
    }
  }

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

    o.dueList = window.Scheduler.dueList(list, getRecord, { days: DAYS });
    renderStats(o);
    renderCalendar(o);
    renderDueList(o);
    renderMastery(o);
    renderLevels(o);
    bindCalendarJump();
  }

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

      void target.offsetWidth;
      target.classList.add("flash");
    };
    cal.addEventListener("click", jump);

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
