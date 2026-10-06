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

  // 「明日再背」/「月后再背」两份名单（Issue #481 第三轮）
  // ---------------------------------------------------------------------------
  // 这两份名单原先挂在「我的」页，这一轮搬到这儿 —— 到期日历的正上方，
  // 因为它们是**日历的两头**：日历管「日子到了自己回来」，这两张卡管
  // 「日子没到之前我在哪儿」。点过的那一首属于哪一档、哪天回来，一眼看全。
  //
  // 台账（js/recite-defer.js）只存作品号 —— 换台设备也对得上；稿子（诗题 /
  // 作者）由这一页从课内主表与全站目录里现查，出口是 `useRef(fn)`。
  function laterRef(wid) {
    var list = (window.POEMS_ALL || []).concat(window.SITE_INDEX || []);
    for (var i = 0; i < list.length; i++) {
      var p = list[i], D = window.ReciteDefer;
      if (!p || !p.id || p.isBook) continue;
      if (!D || !D.widOf || D.widOf(p.id) !== wid) continue;
      return {
        id: p.id,
        title: showTitle(p.title),
        author: p.author || "",
        dynasty: p.dynasty || ""
      };
    }
    return null;
  }

  // 那一行小字：作者 · 朝代（明日那一档只搁一天，写日子反而是废话；
  // 月后要写「到哪天」，那是这一档唯一的悬念）。
  // 「哪天回来」由 `listByTier` 给的毫秒时间戳算 —— 不用 `Y-M-D` 字符串
  // `new Date()`，那种写法会被当成 UTC，往西的时区上会退回前一天。
  function fmtDay(ts) {
    var d = new Date(ts);
    return (d.getMonth() + 1) + " 月 " + d.getDate() + " 日";
  }

  function laterMeta(row, tier) {
    var parts = [];
    if (row.author) parts.push(row.author);
    if (row.dynasty && row.dynasty !== row.author) parts.push(row.dynasty);
    if (tier === "month" && row.until) parts.push(fmtDay(row.until) + "再上榜");
    return parts.join(" · ");
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

  // 一张卡一份名单：`tier` 认的是 `day` / `month` 两档。
  //
  // 名单是空的（或干脆没有台账）→ 整张卡收起来：一张写着「暂无」的卡会占掉
  // 日历上方的位置，而绝大多数人是空的（点过才出现，到日子就走了）。
  function renderLaterOne(tier, o) {
    var card = $("#later-" + tier + "-card");
    var box = $("#later-" + tier + "-box");
    if (!card || !box) return;
    var D = window.ReciteDefer;
    if (!D || !D.listByTier) { card.hidden = true; return; }

    D.useRef(laterRef);
    var rows = D.listByTier(tier);

    var sub = $("#later-" + tier + "-sub");
    if (sub) sub.textContent = rows.length ? rows.length + " 篇" : "";

    if (!rows.length) {
      box.innerHTML = "";
      card.hidden = true;
      return;
    }

    box.innerHTML = rows.map(function (r) {
      return '<div class="later-row" data-wid="' + escapeHtml(r.wid) + '" data-tier="' + tier + '">' +
        '<span class="later-main">' +
        '<span class="later-title">' + escapeHtml(r.title) + "</span>" +
        '<span class="later-meta">' + escapeHtml(laterMeta(r, tier)) + "</span>" +
        "</span>" +
        '<button type="button" class="later-del" aria-label="把《' + escapeHtml(r.title) + '》放回正常次序">删除</button>' +
        "</div>";
    }).join("");
    card.hidden = false;
  }

  function renderLater(o) {
    renderLaterOne("day", o);
    renderLaterOne("month", o);
  }

  // 名单变了（这一页删掉一条、或另一台设备同步下来）就把两张卡重画一遍。
  // 日历不用动：被摘掉的那一首本就「还没到日子」，不在日历的账上。
  function bindLater() {
    var main = $(".progress-main");
    if (!main || main.dataset.laterBound) return;
    main.dataset.laterBound = "1";

    main.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest(".later-del") : null;
      if (!btn) return;
      var row = btn.closest(".later-row");
      var D = window.ReciteDefer;
      if (!row || !D) return;
      var title = row.querySelector(".later-title");
      if (!D.unrest(row.dataset.wid, row.dataset.tier)) return;
      toast("《" + (title ? title.textContent : "") + "》放回来了 —— 回到正常次序");
      renderLater();
    });
    document.addEventListener("recite-defer-change", function () { renderLater(); });
  }

  function toast(m) {
    var t = $("#toast");
    if (!t) return;
    t.textContent = m;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2200);
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
    renderLater(o);
    renderCalendar(o);
    renderDueList(o);
    renderMastery(o);
    renderLevels(o);
    bindLater();
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
