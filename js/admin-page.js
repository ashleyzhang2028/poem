(function () {
  "use strict";

  var Ent = window.Entitlement;

  function acct() { return window.AccountApi || null; }

  var backing = null;
  try { backing = window.localStorage; } catch (e) { backing = null; }

  var currentAccounts = [];

  var myId = null;

  var ROLE_LABEL = { owner: "主人（种子）", admin: "管理员", user: "普通用户" };

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
      return { pickId: p.id, text: p.title || widOfPoem(p), act: "选这一篇" };
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
    msg("msg-pf", "已选中《" + (p.title || widOfPoem(p)) + "》。" +
      "接下来点「挑一句」，从正文里点一行。", "ok");
  }

  function fillLine(p) {
    if (!p || !p.text) return;
    hits(String(p.text).split("\n").filter(function (x) { return x.trim(); })
      .map(function (line) { return { line: line.trim(), text: line.trim(), act: "用这一句" }; }));
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
    el.innerHTML = "这一句现在这样读：" + esc(text);
    el.hidden = false;
  }

  function onPinyinAdd() {
    var F = fix();
    if (!F) { msg("msg-pf", "页面脚本版本对不上（刷新一次即可）：这一块现在改不了。", "warn"); return; }
    var p = pickedPoem();
    var wid = p ? widOfPoem(p) : "";
    var line = (($("pf-line") || {}).value || "").trim();
    var py = (($("pf-py") || {}).value || "").trim();
    var at = Number((($("pf-at") || {}).value || "1"));
    if (!wid) { msg("msg-pf", "先在上面搜一篇（点「选这一篇」）。", "warn"); return; }
    if (!line) { msg("msg-pf", "要填原文里的一句（点「挑一句」也行）。", "warn"); return; }
    if (!py) { msg("msg-pf", "要填应读作什么（带声调，如 cháng）。", "warn"); return; }
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
      msg("msg-pf", r.reason === "full" ? ("勘误表满了（上限 " + F.MAX + " 条）。先删几条再钉。") : "这一条填得不全，没存。", "warn");
      return;
    }
    msg("msg-pf", (r.replaced ? "已改写" : "已钉住") + "：" + (p ? p.title : wid) +
      "「" + line + "」第 " + at + " 个「" + ch + "」读 " + py +
      "。立刻生效 —— 打开那篇（或刷新）就能看到。", "ok");
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
        ? ("上限 " + F.MAX + " 条。这一份随账号同步 —— 换台设备也照它读。")
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
    msg("msg-pf", r.ok ? "已删除这一条（那一处恢复成机器读音）。" : "这一条已经不在了。", r.ok ? "ok" : "warn");
    renderFixList();
    previewLine();
  }

  function onFixExport() {
    var F = fix();
    if (!F) return;
    var text = JSON.stringify({ v: 1, fixes: F.list() }, null, 2);
    var done = function () { msg("msg-pf", "勘误表已复制 —— 它可以贴进 PR、也可以发给别人导入。", "ok"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {
        msg("msg-pf", "复制失败，请手动抄下：" + text, "warn");
      });
      return;
    }
    msg("msg-pf", "这个浏览器不给复制，请手动抄下：" + text, "warn");
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
      if (a.status && a.status !== "active") sub.push("状态 " + esc(a.status));
      if (!a.emailVerified) sub.push("邮箱未确认 · 登不进来");
      var note = sub.length ? '<span class="admin-who-note">' + sub.join(" · ") + "</span>" : "";
      return '<tr data-uid="' + esc(a.uid || "") + '">' +
        '<td><span class="admin-mail">' + esc(mail) + "</span>" + note + "</td>" +
        '<td class="admin-role-cell">' + roleCell(a, role) + "</td>" +
        "</tr>";
    }).join("");
  }

  function roleCell(a, role) {
    if (!a.uid) return "";
    if (role === "owner") {
      return '<span class="admin-role-lock" title="OWNER_EMAILS 认领，这里改不动">' + esc(roleText(role)) + "</span>";
    }
    var canAdmin = isOwner(myId);
    var opts = ["user", "admin"].map(function (r) {
      return '<option value="' + r + '"' + (r === role ? " selected" : "") + ">" + esc(roleText(r)) + "</option>";
    }).join("");
    return '<select class="admin-role-select" data-uid="' + esc(a.uid) + '"' +
      ' data-was="' + esc(role) + '"' +
      ' aria-label="' + esc((a.email || "") + " 的角色") + '"' +
      (canAdmin ? "" : ' disabled title="改角色只对主人开放"') + ">" + opts + "</select>";
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
      accountsNote("页面脚本版本对不上（刷新一次即可）：这一块现在看不了。", true);
      return;
    }
    Promise.resolve(M.adminAccounts({ backing: backing, A: window.AuthCore, E: Ent })).then(function (r) {
      if (r && r.ok) {
        renderAccounts(r);
        var list = r.accounts || [];
        var owners = list.filter(function (a) { return a.role === "owner"; }).length;
        accountsNote("共 " + list.length + " 个账号" +
          (owners ? "（其中主人 " + owners + " 位）" : "") +
          "。选一个角色即写进数据库，对方刷新页面就生效。" +
          (isOwner(myId) ? "" : "改角色只有主人做得来（管理员能发层级、看名录、处理报告，但不能授权）。"), !isOwner(myId));
        renderGrants(list);
        return;
      }
      if (r && r.reason === "guest") { accountsNote("登录状态已过期，请重新登录后再来。", true); return; }
      if (r && r.reason === "not-configured") { accountsNote("本站还没开放云端账号（服务端缺密钥）：这一块暂时问不到。", true); return; }
      if (r && r.reason === "no-channel") { accountsNote("页面脚本版本对不上（刷新一次即可）。", true); return; }
      if (r && r.code === "E_FORBIDDEN") { accountsNote("这一条只对管理员开放（服务端的角色闸）。", true); return; }
      accountsNote("连不上服务端，这一轮没问到。", true);
    })["catch"](function () { accountsNote("连不上服务端，这一轮没问到。", true); });
  }

  function onAccountsChange(e) {
    var sel = e.target.closest ? e.target.closest("select[data-uid]") : null;
    if (!sel) return;
    var uid = sel.getAttribute("data-uid");
    var role = sel.value;
    var row = sel.closest("tr");
    var mail = row ? (row.querySelector(".admin-mail") || {}).textContent || "" : "";
    var was = sel.getAttribute("data-was") || "";

    if (role === "admin" && !window.confirm("把 " + mail + " 提成管理员？管理员能发层级、看名录、处理报告（但改不了别人的角色）。")) {
      sel.value = was || "user";
      return;
    }
    if (role === "user" && was === "admin" && !window.confirm("把 " + mail + " 降回普通用户？他立刻进不了管理后台。")) {
      sel.value = was;
      return;
    }

    var M = acct();
    if (!M || typeof M.adminSetRole !== "function") {
      sel.value = was || "user";
      msg("msg-accounts", "页面脚本版本对不上（刷新一次即可）。", "warn");
      return;
    }

    sel.disabled = true;
    msg("msg-accounts", "正在改 " + mail + " 的角色……", "");
    Promise.resolve(M.adminSetRole({ uid: uid, role: role })).then(function (r) {
      sel.disabled = false;
      if (r && r.ok) {
        sel.setAttribute("data-was", role);
        msg("msg-accounts", r.changed
          ? ((r.email || mail) + " 现在是「" + roleText(role) + "」。对方刷新即生效（由服务器判定）。")
          : ((r.email || mail) + " 本来就是「" + roleText(role) + "」。"), "ok");
        return;
      }
      sel.value = r && r.before ? r.before : (was || "user");
      if (r && r.code === "E_SELF") { msg("msg-accounts", "改不了自己的角色 —— 要换主人，把 OWNER_EMAILS 改成那个邮箱再用它登录一次。", "warn"); return; }
      if (r && r.code === "E_OWNER_LOCKED") { msg("msg-accounts", "这一位是种子主人（OWNER_EMAILS 里的人），身份不由这个口改。", "warn"); return; }
      if (r && r.code === "E_FORBIDDEN") { msg("msg-accounts", "改角色只对主人开放（管理员能发层级、看名录、处理报告，但不能授权）。", "warn"); return; }
      if (r && r.reason === "guest") { msg("msg-accounts", "登录状态已过期，请重新登录后再来。", "warn"); return; }
      if (r && r.reason === "not-configured") { msg("msg-accounts", "本站还没开放云端账号（服务端缺密钥），改不了。", "warn"); return; }
      msg("msg-accounts", (r && r.message) || "没改成，稍后再试。", "warn");
    })["catch"](function () {
      sel.disabled = false;
      sel.value = was || "user";
      msg("msg-accounts", "连不上服务端，这一轮没发出任何东西。", "warn");
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
      msg("msg-grants", "页面脚本版本对不上（刷新一次即可）。", "warn");
      return;
    }
    sel.disabled = true;
    msg("msg-grants", "正在把 " + mail + " 改成 " + Ent.tierLabel(tier) + " ……", "");
    Promise.resolve(M.adminGrant({ uid: uid, tier: tier, backing: backing, A: window.AuthCore, E: Ent }))
      .then(function (r) {
        sel.disabled = false;
        if (r && r.ok) {
          sel.setAttribute("data-was", tier);
          msg("msg-grants", r.changed
            ? (mail + " → " + Ent.tierLabel(tier) + "。对方刷新页面（或打开「我的」页）即由服务器判定生效。")
            : (mail + " 本来就是 " + Ent.tierLabel(tier) + "，一个字都没改。"), r.changed ? "ok" : "warn");
          return;
        }
        sel.value = was;
        var text = (r && r.message) || "这一条没发出去。";
        if (r && r.reason === "guest") text = "登录状态已过期，请重新登录后再来。";
        else if (r && r.reason === "not-configured") text = "本站还没开放云端账号（服务端缺密钥），发不了。";
        else if (r && r.reason === "no-channel") text = "页面脚本版本对不上（刷新一次即可）。";
        else if (r && r.reason === "unavailable") text = "连不上服务端，这一轮没发出任何东西。";
        msg("msg-grants", text, "warn");
      })["catch"](function () {
        sel.disabled = false;
        sel.value = was;
        msg("msg-grants", "连不上服务端，这一轮没发出任何东西。", "warn");
      });
  }

  function renderGrants(list) {
    var box = $("grants-body");
    if (!box) return;
    var empty = $("server-empty");
    if (empty) empty.hidden = (list || []).length > 0;
    box.innerHTML = (list || []).map(function (a) {
      var mail = a.email || "（无邮箱）";
      var tier = String(a.tier || "free");
      var opts = Ent.TIERS.map(function (t) {
        return '<option value="' + t + '"' + (t === tier ? " selected" : "") + ">" + esc(Ent.tierLabel(t)) + "</option>";
      }).join("");
      return '<tr data-uid="' + esc(a.uid || "") + '">' +
        '<td><span class="admin-mail">' + esc(mail) + "</span></td>" +
        '<td class="admin-tier-cell"><select class="admin-role-select" data-tier-of="' + esc(a.uid || "") + '"' +
          ' data-was="' + esc(tier) + '"' +
          ' aria-label="' + esc(mail + " 的层级") + '">' + opts + "</select></td>" +
        '<td><button class="admin-revoke" type="button" data-revoke="' + esc(a.uid || "") + '"' +
          ' data-revoke-mail="' + esc(mail) + '">收回</button></td>' +
        "</tr>";
    }).join("");
  }

    function onRevokeClick(e) {
    var b = e.target.closest ? e.target.closest("button[data-revoke]") : null;
    if (!b) return;
    var uid = b.getAttribute("data-revoke");
    var who = b.getAttribute("data-revoke-mail") || uid;
    if (!uid) { msg("msg-grants", "这一行没有 uid，刷新页面再来。", "warn"); return; }
    var M = acct();
    if (!M || typeof M.adminRevoke !== "function") { msg("msg-grants", "页面脚本版本对不上，这一轮没发出任何东西。", "warn"); return; }
    b.disabled = true;
    Promise.resolve(M.adminRevoke({ uid: uid, backing: backing, A: window.AuthCore, E: Ent })).then(function (r) {
      if (!r || !r.ok) {
        b.disabled = false;
        msg("msg-grants", (r && r.message) || "收回没成功，稍后再试。", "warn");
        return;
      }
      msg("msg-grants", r.changed
        ? "已在数据库里收回 " + who + " 的层级（对方刷新即回落 Free）。"
        : "数据库里本来就没有 " + who + " 这一条。", r.changed ? "ok" : "warn");
      loadAccounts();
    })["catch"](function () { b.disabled = false; msg("msg-grants", "连不上服务端，这一轮没发出任何东西。", "warn"); });
  }

  var currentReports = [];

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
      reportsNote("页面脚本版本对不上（刷新一次即可）：这一块现在看不了。", true);
      return;
    }
    var sel = $("report-filter");
    var status = sel ? sel.value : "new";
    reportsMsg("正在读取……", "");

    Promise.resolve(M.adminReports({ status: status, backing: backing, A: window.AuthCore, E: Ent }))
      .then(function (r) {
        if (r && r.ok) {
          currentReports = r.reports || [];
          renderReports(currentReports);
          renderReportCounts(r.counts || {}, status);
          reportsMsg("", "");
          reportsNote("这一排与上面的下拉是一件事：点一格切过去，数字是全站的条数。", false);
          return;
        }
        if (r && r.reason === "guest") { reportsMsg("登录状态已过期，请重新登录后再来。", "warn"); return; }
        if (r && r.reason === "not-configured") { reportsNote("本站还没开放云端账号（服务端缺密钥）：报告这一块暂时问不到。", true); return; }
        if (r && r.reason === "no-channel") { reportsNote("页面脚本版本对不上（刷新一次即可）。", true); return; }
        if (r && r.code === "E_FORBIDDEN") { reportsNote("这一条只对管理员开放（服务端的角色闸）。", true); return; }
        reportsMsg("连不上服务端，这一轮没问到。", "warn");
      })["catch"](function () { reportsMsg("连不上服务端，这一轮没问到。", "warn"); });
  }

  function renderReportCounts(counts, current) {
    var host = $("report-counts");
    if (!host) return;
    var R = window.Report;
    var cur = String(current || "new");
    var order = ["all"].concat((R && R.STATUS_LABEL) ? Object.keys(R.STATUS_LABEL) : []);
    var parts = [];
    order.forEach(function (k) {
      var n = counts ? counts[k] : undefined;
      if (typeof n !== "number") return;
      var label = k === "all" ? "全部" : (R ? R.labelOfStatus(k) : k);
      parts.push('<button type="button" class="' + (k === cur ? "active" : "") + '"' +
        ' data-count-status="' + esc(k) + '" aria-pressed="' + (k === cur ? "true" : "false") + '">' +
        esc(label) + "<span>" + n + "</span></button>");
    });
    host.innerHTML = parts.join("");
  }

  function onCountsClick(e) {
    var b = e.target.closest ? e.target.closest("button[data-count-status]") : null;
    if (!b) return;
    var sel = $("report-filter");
    var want = b.getAttribute("data-count-status");
    if (sel && sel.value !== want) sel.value = want;
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
        (r.book ? " · " + esc(r.book) : "") +
        (r.poemId ? " · " + esc(r.poemId) : "") + "</div>" +
        (r.quote ? '<div class="report-row-quote">「' + esc(r.quote) + "」</div>" : "") +
        (r.context ? '<div class="report-row-note">' + esc(r.context) + "</div>" : "") +
        (r.note ? '<div class="report-row-note">' + esc(r.note) + "</div>" : "") +
        (r.suggestion ? '<div class="report-row-reply">建议：' + esc(r.suggestion) + "</div>" : "") +
        (r.reply ? '<div class="report-row-reply">回给用户：' + esc(r.reply) + "</div>" : "") +
        '<div class="report-row-time">' + esc(reportTime(r.createdAt)) + "</div>" +
        '<div class="admin-report-acts">' +
        reportAct(r.rid, "read", "已看过", R) +
        reportAct(r.rid, "accepted", "确认", R) +
        reportAct(r.rid, "fixed", "标为已修复", R) +
        reportAct(r.rid, "rejected", "不采纳", R) +
        "</div>" +
        "</li>";
    }).join("");
  }

  function reportAct(rid, status, label, R) {
    return '<button type="button" data-report-act="' + esc(status) + '" data-rid="' + esc(rid) + '">' +
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
      reportsMsg("页面脚本版本对不上（刷新一次即可）", "warn");
      return;
    }

    if (status === "rejected" && !window.confirm("标成「未采纳」？用户那一页会显示未采纳。")) return;

    b.disabled = true;
    reportsMsg("正在改……", "");
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
          }
          reportsMsg("已改成「" + (window.Report ? window.Report.labelOfStatus(status) : status) + "」", "ok");
          return;
        }
        if (r && r.code === "E_FORBIDDEN") { reportsMsg("服务端说这一条只对管理员开放。", "warn"); return; }
        if (r && r.code === "E_NO_REPORT") { reportsMsg("这一条已经不在了（可能是另一台服务器发的）。", "warn"); return; }
        reportsMsg("没改成，稍后再试。", "warn");
      })["catch"](function () {
        b.disabled = false;
        reportsMsg("没改成，稍后再试。", "warn");
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
    show($("server-card"));
    show($("reports-card"));
    show($("pinyin-card"));
    if (paintTimer) { clearTimeout(paintTimer); paintTimer = null; }
    if (paint.done) return;
    paint.done = true;

    var who = $("accounts-body");
    if (who) who.addEventListener("change", onAccountsChange);

    if ($("grants-body")) $("grants-body").addEventListener("click", onRevokeClick);
    if ($("grants-body")) $("grants-body").addEventListener("change", onTierChange);
    if ($("btn-reports-reload")) $("btn-reports-reload").addEventListener("click", loadReports);
    if ($("report-filter")) $("report-filter").addEventListener("change", loadReports);
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
      if (!p) { msg("msg-pf", "先在上面搜一篇、点「选这一篇」。", "warn"); return; }
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
    renderGrants: renderGrants,

    renderReports: renderReports, loadReports: loadReports, reportTime: reportTime,
    renderReportCounts: renderReportCounts,

    searchPoems: searchPoems,
    widOfPoem: widOfPoem,
    renderFixList: renderFixList
  };
})();
