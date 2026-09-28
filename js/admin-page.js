(function () {
  "use strict";

  var Ent = window.Entitlement;

  function acct() { return window.AccountApi || null; }

  var backing = null;
  try { backing = window.localStorage; } catch (e) { backing = null; }

  var currentAccounts = [];

  var myId = null;

  var ROLE_LABEL = { owner: "所有者", admin: "管理员", user: "普通用户" };

  var STALE = "页面已更新，请刷新后重试。";
  var OFFLINE = "无法连接服务器，请稍后再试。";
  var EXPIRED = "登录已过期，请重新登录。";
  var NO_CLOUD = "服务端尚未开启云端账号。";

  function $(id) { return document.getElementById(id); }
  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function showToast(m) {
    var t = $("toast");
    if (!t) return;
    t.textContent = m;
    t.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { t.hidden = true; }, 2200);
  }
  function msg(id, s, level) {
    var el = $(id);
    if (!el) return;
    el.textContent = s == null ? "" : String(s);
    el.className = "account-msg" + (level ? " " + level : "");
  }

  function roleText(role) {
    var r = String(role || "user").toLowerCase();
    return ROLE_LABEL[r] || r;
  }

    function isOwner(id) {
    if (!id) return Ent.isOwner(backing);
    return Ent.isOwner(backing, { role: id.role, uid: id.uid });
  }

  function fix() { return window.PinyinFix || null; }

  function allPoems() {
    var out = [];
    try {
      var base = (window.POEMS_ALL || []).slice();
      base.forEach(function (p) { if (p && p.id && p.text) out.push(p); });
    } catch (e) {  }
    return out;
  }

  function widOfPoem(p) {
    var id = (p && p.id) || "";
    if (!id) return "";
    if (window.WorksIndex && typeof window.WorksIndex.widOf === "function") {
      try { return window.WorksIndex.widOf(id) || id; } catch (e) {  }
    }
    return id;
  }

  function searchPoems(kw) {
    var q = String(kw || "").trim();
    if (!q) return [];
    var out = [];
    allPoems().forEach(function (p) {
      var hay = (p.title || "") + (p.author || "") + (p.text || "");
      if (hay.indexOf(q) < 0) return;
      if (out.length < 8) out.push(p);
    });
    return out;
  }

    function hits(list) {
    var box = $("pf-hits");
    if (!box) return;
    if (!list.length) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML = list.map(function (it) {
      var attr = it.pickId ? "data-pick=\"" + esc(it.pickId) + "\"" : "data-line=\"" + esc(it.line) + "\"";
      return '<li class="grant-row">' +
        '<span class="grant-ish">' + esc(it.text) + "</span>" +
        '<button class="grant-del" type="button" ' + attr + ">" + esc(it.act) + "</button>" +
        "</li>";
    }).join("");
  }

  function onPinyinSearch() {
    var kw = (($("pf-wid") || {}).value || "").trim();
    hits(searchPoems(kw).map(function (p) {
      return { pickId: p.id, text: p.title || widOfPoem(p), act: "选择" };
    }));
  }

  function pickedPoem() {
    var id = onPinyinSearch._id || "";
    if (!id) return null;
    var hit = null;
    allPoems().forEach(function (p) { if (p.id === id) hit = p; });
    return hit;
  }

  function onPickPoem(p) {
    onPinyinSearch._id = p.id;
    var w = $("pf-wid");
    if (w) w.value = p.title || "";
    hits([]);
    msg("msg-pf", "已选中《" + (p.title || widOfPoem(p)) + "》，请点「选句」选择原句。", "ok");
  }

  function fillLine(p) {
    if (!p || !p.text) return;
    hits(String(p.text).split("\n").filter(function (x) { return x.trim(); })
      .map(function (line) { return { line: line.trim(), text: line.trim(), act: "选择" }; }));
  }

  function onHitClick(e) {
    var t = e.target;
    var pick = t.closest ? t.closest("button[data-pick]") : null;
    if (pick) {
      var id = pick.getAttribute("data-pick");
      var p = null;
      allPoems().forEach(function (x) { if (x.id === id) p = x; });
      if (p) onPickPoem(p);
      return;
    }
    var use = t.closest ? t.closest("button[data-line]") : null;
    if (!use) return;
    var box = $("pf-line");
    if (box) box.value = use.getAttribute("data-line");
    hits([]);
    previewLine();
  }

  function previewLine() {
    var el = $("pf-picked");
    if (!el) return;
    var line = (($("pf-line") || {}).value || "").trim();
    var P = window.Pinyin;
    var p = pickedPoem();
    if (!line || !P) { el.hidden = true; el.textContent = ""; return; }
    var wid = p ? widOfPoem(p) : "";
    var html = P.annotatePoem ? P.annotatePoem(wid, line, "all") : P.annotateHtml(line, "all");

    var text = html.replace(/<ruby>([^<]*)<rt>([^<]*)<\/rt><\/ruby>/g, "$1($2)")
                   .replace(/<br>/g, " ");
    el.innerHTML = "当前读音：" + esc(text);
    el.hidden = false;
  }

  function onPinyinAdd() {
    var F = fix();
    if (!F) { msg("msg-pf", STALE, "warn"); return; }
    var p = pickedPoem();
    var wid = p ? widOfPoem(p) : "";
    var line = (($("pf-line") || {}).value || "").trim();
    var py = (($("pf-py") || {}).value || "").trim();
    var at = Number((($("pf-at") || {}).value || "1"));
    if (!wid) { msg("msg-pf", "请先搜索并选择篇目。", "warn"); return; }
    if (!line) { msg("msg-pf", "请填写原句，或点「选句」选择。", "warn"); return; }
    if (!py) { msg("msg-pf", "请填写正确读音（带声调，如 cháng）。", "warn"); return; }
    if (!isFinite(at) || at < 1) at = 1;

    var text = line;
    var ch = "";
    if (p && p.text) {
      var hit = String(p.text).split("\n").filter(function (x) { return x.trim() === line; })[0];
      if (hit) text = hit;
    }
    var chs = Array.from(text.trim());
    ch = chs[Math.min(at - 1, chs.length - 1)] || "";

    var r = F.add({ wid: wid, line: line, at: at, ch: ch, py: py });
    if (!r.ok) {
      msg("msg-pf", r.reason === "full" ? ("勘误已达上限（" + F.MAX + " 条），请先删除部分条目。") : "信息不完整，未保存。", "warn");
      return;
    }
    msg("msg-pf", (r.replaced ? "已更新" : "已保存") + "：" + (p ? p.title : wid) +
      "「" + line + "」第 " + at + " 个字「" + ch + "」读 " + py + "。刷新篇目即可看到。", "ok");
    renderFixList();
    previewLine();
  }

  function renderFixList() {
    var box = $("pf-list");
    var F = fix();
    if (!box || !F) return;
    var list = F.list();
    var empty = $("pf-empty");
    if (empty) empty.hidden = list.length > 0;
    var count = $("pf-count");
    if (count) count.textContent = String(list.length);
    var note = $("pf-note");
    if (note) {
      note.hidden = false;
      note.textContent = list.length
        ? ("上限 " + F.MAX + " 条，随账号同步。")
        : "";
    }
    box.innerHTML = list.map(function (f) {
      return '<li class="grant-row">' +
        '<span class="admin-fix-wid">' + esc(f.wid) + "</span>" +
        '<span class="admin-fix-detail">' + esc(f.line) + "<br>第 " + esc(String(f.at)) +
          " 个字「" + esc(f.ch || "?") + "」→ <b>" + esc(f.py) + "</b></span>" +
        '<button class="grant-del" type="button" data-unfix="' + esc(F.keyOf(f)) + '">删除</button>' +
        "</li>";
    }).join("");
  }

  function onFixListClick(e) {
    var b = e.target.closest ? e.target.closest("button[data-unfix]") : null;
    if (!b) return;
    var F = fix();
    if (!F) return;
    var r = F.remove(b.getAttribute("data-unfix"));
    msg("msg-pf", r.ok ? "已删除，该处恢复为自动注音。" : "该条已不存在。", r.ok ? "ok" : "warn");
    renderFixList();
    previewLine();
  }

  function onFixExport() {
    var F = fix();
    if (!F) return;
    var text = JSON.stringify({ v: 1, fixes: F.list() }, null, 2);
    var done = function () { msg("msg-pf", "勘误表已复制到剪贴板。", "ok"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {
        msg("msg-pf", "复制失败，请手动复制：" + text, "warn");
      });
      return;
    }
    msg("msg-pf", "当前浏览器不支持复制，请手动复制：" + text, "warn");
  }

    function renderAccounts(data) {
    var box = $("accounts-body");
    if (!box) return;
    var list = (data && data.accounts) || [];
    currentAccounts = list;
    var empty = $("accounts-empty");
    if (empty) empty.hidden = list.length > 0;
    box.innerHTML = list.map(function (a) {
      var mail = a.email || "（无邮箱）";
      var role = String(a.role || "user").toLowerCase();
      var sub = [];
      if (a.nickname) sub.push(esc(a.nickname));
      if (!a.emailVerified || (a.status && a.status === "pending")) sub.push("待验证邮箱");
      else if (a.status && a.status !== "active") sub.push(esc(a.status));
      var note = sub.length ? '<span class="admin-who-note">' + sub.join(" · ") + "</span>" : "";
      return '<tr data-uid="' + esc(a.uid || "") + '">' +
        '<td><span class="admin-mail">' + esc(mail) + "</span>" + note + "</td>" +
        '<td class="admin-role-cell">' + roleCell(a, role) + "</td>" +
        '<td class="admin-tier-cell">' + tierCell(a, mail) + "</td>" +
        "</tr>";
    }).join("");
  }

  function tierCell(a, mail) {
    if (!a.uid) return "";
    var tier = String(a.tier || "free");
    var opts = Ent.TIERS.map(function (t) {
      return '<option value="' + t + '"' + (t === tier ? " selected" : "") + ">" + esc(Ent.tierLabel(t)) + "</option>";
    }).join("");
    return '<select class="admin-role-select" data-tier-of="' + esc(a.uid) + '"' +
      ' data-was="' + esc(tier) + '"' +
      ' aria-label="' + esc(mail + " 的层级") + '">' + opts + "</select>";
  }

  function roleCell(a, role) {
    if (!a.uid) return "";
    if (role === "owner") {
      return '<span class="admin-role-lock" title="所有者由服务端配置，此处不可修改">' + esc(roleText(role)) + "</span>";
    }
    var canAdmin = isOwner(myId);
    var opts = ["user", "admin"].map(function (r) {
      return '<option value="' + r + '"' + (r === role ? " selected" : "") + ">" + esc(roleText(r)) + "</option>";
    }).join("");
    return '<select class="admin-role-select" data-uid="' + esc(a.uid) + '"' +
      ' data-was="' + esc(role) + '"' +
      ' aria-label="' + esc((a.email || "") + " 的角色") + '"' +
      (canAdmin ? "" : ' disabled title="仅所有者可修改角色"') + ">" + opts + "</select>";
  }

  function accountsNote(text, warn) {
    var el = $("accounts-note");
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !text;
    el.className = "account-hint" + (warn ? " warn-hint" : "");
  }

  function loadAccounts() {
    var M = acct();
    if (!M || typeof M.adminAccounts !== "function") {
      accountsNote(STALE, true);
      return;
    }
    Promise.resolve(M.adminAccounts({ backing: backing, A: window.AuthCore, E: Ent })).then(function (r) {
      if (r && r.ok) {
        renderAccounts(r);
        var list = r.accounts || [];
        accountsNote("共 " + list.length + " 个账号。" +
          (isOwner(myId) ? "" : "仅所有者可修改角色。"), false);
        return;
      }
      if (r && r.reason === "guest") { accountsNote(EXPIRED, true); return; }
      if (r && r.reason === "not-configured") { accountsNote(NO_CLOUD, true); return; }
      if (r && r.reason === "no-channel") { accountsNote(STALE, true); return; }
      if (r && r.code === "E_FORBIDDEN") { accountsNote("仅管理员可查看。", true); return; }
      accountsNote(OFFLINE, true);
    })["catch"](function () { accountsNote(OFFLINE, true); });
  }

  function onAccountsChange(e) {
    var sel = e.target.closest ? e.target.closest("select[data-uid]") : null;
    if (!sel) return;
    var uid = sel.getAttribute("data-uid");
    var role = sel.value;
    var row = sel.closest("tr");
    var mail = row ? (row.querySelector(".admin-mail") || {}).textContent || "" : "";
    var was = sel.getAttribute("data-was") || "";

    if (role === "admin" && !window.confirm("将 " + mail + " 设为管理员？管理员可以调整层级、查看账号和处理报告，但不能修改角色。")) {
      sel.value = was || "user";
      return;
    }
    if (role === "user" && was === "admin" && !window.confirm("将 " + mail + " 降为普通用户？对方将无法再进入管理后台。")) {
      sel.value = was;
      return;
    }

    var M = acct();
    if (!M || typeof M.adminSetRole !== "function") {
      sel.value = was || "user";
      msg("msg-accounts", STALE, "warn");
      return;
    }

    sel.disabled = true;
    msg("msg-accounts", "正在保存……", "");
    Promise.resolve(M.adminSetRole({ uid: uid, role: role })).then(function (r) {
      sel.disabled = false;
      if (r && r.ok) {
        sel.setAttribute("data-was", role);
        msg("msg-accounts", (r.email || mail) + " 的角色已设为「" + roleText(role) + "」。", "ok");
        return;
      }
      sel.value = r && r.before ? r.before : (was || "user");
      if (r && r.code === "E_SELF") { msg("msg-accounts", "不能修改自己的角色。", "warn"); return; }
      if (r && r.code === "E_OWNER_LOCKED") { msg("msg-accounts", "所有者由服务端配置，此处不可修改。", "warn"); return; }
      if (r && r.code === "E_FORBIDDEN") { msg("msg-accounts", "仅所有者可修改角色。", "warn"); return; }
      if (r && r.reason === "guest") { msg("msg-accounts", EXPIRED, "warn"); return; }
      if (r && r.reason === "not-configured") { msg("msg-accounts", NO_CLOUD, "warn"); return; }
      msg("msg-accounts", (r && r.message) || "保存失败，请稍后再试。", "warn");
    })["catch"](function () {
      sel.disabled = false;
      sel.value = was || "user";
      msg("msg-accounts", OFFLINE, "warn");
    });
  }

    function onTierChange(e) {
    var sel = e.target.closest ? e.target.closest("select[data-tier-of]") : null;
    if (!sel) return;
    var uid = sel.getAttribute("data-tier-of");
    var tier = sel.value;
    var row = sel.closest("tr");
    var was = sel.getAttribute("data-was") || "free";
    var mail = row ? (row.querySelector(".admin-mail") || {}).textContent || uid : uid;

    var M = acct();
    if (!M || typeof M.adminGrant !== "function") {
      sel.value = was;
      msg("msg-accounts", STALE, "warn");
      return;
    }
    sel.disabled = true;
    msg("msg-accounts", "正在保存……", "");
    Promise.resolve(M.adminGrant({ uid: uid, tier: tier, backing: backing, A: window.AuthCore, E: Ent }))
      .then(function (r) {
        sel.disabled = false;
        if (r && r.ok) {
          sel.setAttribute("data-was", tier);
          msg("msg-accounts", mail + " 的层级已设为 " + Ent.tierLabel(tier) + "。", "ok");
          return;
        }
        sel.value = was;
        var text = (r && r.message) || "保存失败，请稍后再试。";
        if (r && r.reason === "guest") text = EXPIRED;
        else if (r && r.reason === "not-configured") text = NO_CLOUD;
        else if (r && r.reason === "no-channel") text = STALE;
        else if (r && r.reason === "unavailable") text = OFFLINE;
        msg("msg-accounts", text, "warn");
      })["catch"](function () {
        sel.disabled = false;
        sel.value = was;
        msg("msg-accounts", OFFLINE, "warn");
      });
  }

  var currentReports = [];
  var reportStatus = "new";

  function reportsMsg(text, level) {
    msg("msg-reports", text, level);
  }

  function reportsNote(text, warn) {
    var el = $("reports-note");
    if (!el) return;
    el.textContent = text || "";
    el.className = "account-hint" + (warn ? " warn" : "");
    el.hidden = !text;
  }

  function loadReports() {
    var M = acct();
    var box = $("reports-list");
    if (!box) return;
    if (!M || typeof M.adminReports !== "function") {
      reportsNote(STALE, true);
      return;
    }
    var status = reportStatus;
    reportsMsg("正在读取……", "");

    Promise.resolve(M.adminReports({ status: status, backing: backing, A: window.AuthCore, E: Ent }))
      .then(function (r) {
        if (r && r.ok) {
          currentReports = r.reports || [];
          renderReports(currentReports);
          renderReportCounts(r.counts || {}, status);
          reportsMsg("", "");
          reportsNote("", false);
          return;
        }
        if (r && r.reason === "guest") { reportsMsg(EXPIRED, "warn"); return; }
        if (r && r.reason === "not-configured") { reportsNote(NO_CLOUD, true); return; }
        if (r && r.reason === "no-channel") { reportsNote(STALE, true); return; }
        if (r && r.code === "E_FORBIDDEN") { reportsNote("仅管理员可查看。", true); return; }
        reportsMsg(OFFLINE, "warn");
      })["catch"](function () { reportsMsg(OFFLINE, "warn"); });
  }

  function renderReportCounts(counts, current) {
    var host = $("report-counts");
    if (!host) return;
    var R = window.Report;
    var cur = String(current || "new");
    var keys = (R && R.STATUS_LABEL) ? Object.keys(R.STATUS_LABEL) : [];
    var total = 0;
    keys.forEach(function (k) { total += Number(counts && counts[k]) || 0; });
    var order = ["all"].concat(keys);
    host.innerHTML = order.map(function (k) {
      var n = k === "all" ? (typeof (counts && counts.all) === "number" ? counts.all : total) : (Number(counts && counts[k]) || 0);
      var label = k === "all" ? "全部" : (R ? R.labelOfStatus(k) : k);
      return '<button type="button" class="' + (k === cur ? "active" : "") + '"' +
        ' data-count-status="' + esc(k) + '" aria-pressed="' + (k === cur ? "true" : "false") + '">' +
        esc(label) + "<span>" + n + "</span></button>";
    }).join("");
  }

  function onCountsClick(e) {
    var b = e.target.closest ? e.target.closest("button[data-count-status]") : null;
    if (!b) return;
    reportStatus = b.getAttribute("data-count-status") || "new";
    loadReports();
  }

  function renderReports(list) {
    var box = $("reports-list");
    if (!box) return;
    var empty = $("reports-empty");
    if (empty) empty.hidden = (list || []).length > 0;
    var R = window.Report;
    box.innerHTML = (list || []).map(function (r) {
      var st = String(r.status || "new");
      var label = R ? R.labelOfStatus(st) : st;
      var kindLabel = R ? R.labelOfKind(r.kind) : r.kind;
      return '<li class="report-row admin-report-row report-st-' + esc(st) + '" data-rid="' + esc(r.rid) + '">' +
        '<div class="report-row-head">' +
        '<span class="report-kind">' + esc(kindLabel) + "</span>" +
        '<span class="report-title">' + esc(r.poemTitle || "（未指定篇目）") + "</span>" +
        '<span class="report-status">' + esc(label) + "</span>" +
        "</div>" +
        '<div class="admin-report-who">' + esc(r.email || "（无邮箱）") +
        (r.nickname ? " · " + esc(r.nickname) : "") +
        (r.book ? " · " + esc(r.book) : "") + "</div>" +
        (r.quote ? '<div class="report-row-quote">「' + esc(r.quote) + "」</div>" : "") +
        (r.context ? '<div class="report-row-note">' + esc(r.context) + "</div>" : "") +
        (r.note ? '<div class="report-row-note">' + esc(r.note) + "</div>" : "") +
        (r.suggestion ? '<div class="report-row-reply">建议：' + esc(r.suggestion) + "</div>" : "") +
        (r.reply ? '<div class="report-row-reply">回复：' + esc(r.reply) + "</div>" : "") +
        '<div class="report-row-time">' + esc(reportTime(r.createdAt)) + "</div>" +
        '<div class="admin-report-acts">' +
        reportAct(r.rid, "read", "已查看", st) +
        reportAct(r.rid, "accepted", "确认", st) +
        reportAct(r.rid, "fixed", "已修复", st) +
        reportAct(r.rid, "rejected", "不采纳", st) +
        "</div>" +
        "</li>";
    }).join("");
  }

  function reportAct(rid, status, label, current) {
    var on = status === current;
    return '<button type="button" data-report-act="' + esc(status) + '" data-rid="' + esc(rid) + '"' +
      (on ? ' class="active" aria-pressed="true"' : ' aria-pressed="false"') + ">" +
      esc(label) + "</button>";
  }

  function reportTime(ts) {
    var t = Number(ts) || 0;
    if (!t) return "";
    try {
      var d = new Date(t);
      var p = function (n) { return n < 10 ? "0" + n : "" + n; };
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
        " " + p(d.getHours()) + ":" + p(d.getMinutes());
    } catch (e) { return ""; }
  }

  function onReportsClick(e) {
    var b = e.target.closest ? e.target.closest("button[data-report-act]") : null;
    if (!b) return;
    var rid = b.getAttribute("data-rid");
    var status = b.getAttribute("data-report-act");
    var M = acct();
    if (!M || typeof M.adminReportPatch !== "function") {
      reportsMsg(STALE, "warn");
      return;
    }

    if (status === "rejected" && !window.confirm("将该报告标为「不采纳」？用户将在「我的报告」中看到此状态。")) return;

    b.disabled = true;
    reportsMsg("正在保存……", "");
    Promise.resolve(M.adminReportPatch({ rid: rid, status: status, backing: backing, A: window.AuthCore, E: Ent }))
      .then(function (r) {
        b.disabled = false;
        if (r && r.ok) {

          var li = document.querySelector('.admin-report-row[data-rid="' + rid + '"]');
          var R = window.Report;
          if (li) {
            li.className = "report-row admin-report-row report-st-" + status;
                        var s = li.querySelector(".report-status");
            if (s) s.textContent = R ? R.labelOfStatus(status) : status;
            Array.prototype.forEach.call(li.querySelectorAll("button[data-report-act]"), function (x) {
              var on = x.getAttribute("data-report-act") === status;
              x.classList.toggle("active", on);
              x.setAttribute("aria-pressed", on ? "true" : "false");
            });
          }
          reportsMsg("已更新为「" + (window.Report ? window.Report.labelOfStatus(status) : status) + "」", "ok");
          return;
        }
        if (r && r.code === "E_FORBIDDEN") { reportsMsg("仅管理员可操作。", "warn"); return; }
        if (r && r.code === "E_NO_REPORT") { reportsMsg("该报告已不存在。", "warn"); return; }
        reportsMsg("保存失败，请稍后再试。", "warn");
      })["catch"](function () {
        b.disabled = false;
        reportsMsg(OFFLINE, "warn");
      });
  }

    var painted = false;
  var paintTimer = null;

  function paintDeny(text) {
    show($("deny-card"));
    var lead = $("deny-lead");
    if (lead) lead.textContent = text;
    if (paintTimer) { clearTimeout(paintTimer); paintTimer = null; }
  }

  function paint() {
    var id = Ent.identity({ backing: backing });
    myId = id;

    if (!isOwner(id)) {
            if (!painted && (!id || !id.uid)) {
        if (!paintTimer) {
          paintTimer = setTimeout(function () {
            if (!painted) paintDeny("只对管理员开放。");
          }, 2500);
        }
        return;
      }
      painted = true;
      paintDeny("只对管理员开放。");
      return;
    }

    painted = true;
    hide($("deny-card"));
    show($("grant-card"));
    show($("reports-card"));
    show($("pinyin-card"));
    if (paintTimer) { clearTimeout(paintTimer); paintTimer = null; }
    if (paint.done) return;
    paint.done = true;

    var who = $("accounts-body");
    if (who) {
      who.addEventListener("change", onAccountsChange);
      who.addEventListener("change", onTierChange);
    }
    if ($("btn-reports-reload")) $("btn-reports-reload").addEventListener("click", loadReports);
    if ($("report-counts")) $("report-counts").addEventListener("click", onCountsClick);
    if ($("reports-list")) $("reports-list").addEventListener("click", onReportsClick);
    loadAccounts();
    loadReports();

    var pfWid = $("pf-wid"), pfLine = $("pf-line");
    if (pfWid) pfWid.addEventListener("input", onPinyinSearch);
    if (pfLine) pfLine.addEventListener("input", previewLine);
    if ($("pf-hits")) $("pf-hits").addEventListener("click", onHitClick);
    $("btn-pf-add").addEventListener("click", onPinyinAdd);
    $("btn-pf-fill").addEventListener("click", function () {
      var p = pickedPoem();
      if (!p) { msg("msg-pf", "请先搜索并选择篇目。", "warn"); return; }
      fillLine(p);
    });
    $("pf-list").addEventListener("click", onFixListClick);
    $("btn-pf-export").addEventListener("click", onFixExport);
    renderFixList();
  }

  function init() {
        window.addEventListener("entitlementchange", paint);
    document.addEventListener("entitlementchange", paint);
    paint();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.AdminPage = {
    isOwner: isOwner, esc: esc, roleText: roleText,

    renderAccounts: renderAccounts, loadAccounts: loadAccounts,

    renderReports: renderReports, loadReports: loadReports, reportTime: reportTime,
    renderReportCounts: renderReportCounts,

    searchPoems: searchPoems,
    widOfPoem: widOfPoem,
    renderFixList: renderFixList
  };
})();
