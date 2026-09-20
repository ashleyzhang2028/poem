(function () {
  "use strict";

  var Ent = window.Entitlement;

  function acct() { return window.AccountApi || null; }

  var backing = null;
  try { backing = window.localStorage; } catch (e) { backing = null; }

  // 可发放的层级（Issue #276 之后**只发到服务端**，本机那一份已下线）。
  var pickedTier = "pro";

  // 名录那一张的当前快照（改角色后就地更新，不重拉整张）。
  var currentAccounts = [];

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

  // 「谁能进管理后台」（Issue #276）：**只看服务端下发到本机缓存里的那个角色**
  // （源头是数据库 `accounts.role`）。本机兜底已删 —— 没有服务端答案就不放行。
  function isOwner(id) {
    if (id && id.role) return Ent.isOwner(backing, { role: id.role });
    return Ent.isOwner(backing);
  }

  // ---------------------------------------------------------------------------
  // 注音勘误（Issue #243 · 《滕王阁序》「长」）
  // ---------------------------------------------------------------------------
  // 这一块**不上服务端**：勘误表就是本机 `poem_pinyin_fix_v1` 那一份
  // （ProgressStore 带 `pinyin_fix:v1` 一行上云，走的是与自选集合同一条路）。
  // 后台在这里只做三件事：找篇、钉一处、删一处。
  function fix() { return window.PinyinFix || null; }

  // 全站篇目（课内 12 册 + 各集子）——给「搜一篇」用。
  // 集子那几部的数据在本页没加载（首屏体积），所以这里列的是**课内**；
  // 集子里的篇目可以用「篇目 id 直接填」那条路（下面 pickHit 会说明）。
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

  function renderHits(list) {
    var box = $("pf-hits");
    if (!box) return;
    if (!list.length) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML = list.map(function (p) {
      return '<li class="grant-row">' +
        '<span class="grant-mail">' + esc(p.title || "") + "</span>" +
        '<span class="grant-when">' + esc(widOfPoem(p)) + "</span>" +
        '<button class="grant-del" type="button" data-pick="' + esc(p.id) + '">选这一篇</button>' +
        "</li>";
    }).join("");
  }

  function onPinyinSearch() {
    var kw = (($("pf-wid") || {}).value || "").trim();
    renderHits(searchPoems(kw));
  }

  function pickedPoem() {
    var id = onPinyinSearch._id || "";
    if (!id) return null;
    var hit = null;
    allPoems().forEach(function (p) { if (p.id === id) hit = p; });
    return hit;
  }

  function onPinyinPick(e) {
    var b = e.target.closest ? e.target.closest("button[data-pick]") : null;
    if (!b) return;
    var id = b.getAttribute("data-pick");
    var p = null;
    allPoems().forEach(function (x) { if (x.id === id) p = x; });
    if (!p) return;
    onPinyinSearch._id = id;
    var w = $("pf-wid");
    if (w) w.value = p.title || "";
    renderHits([]);
    fillLine(p);
  }

  // 「从篇目里挑一句」：把正文按行摊开，点哪一行就填进「原文里的一句」，
  // 并自动数出「这一句里第几次出现」那一格（用户在正文里点中哪个字都行 ——
  // 这里先按第一个字算，用户可以自己改那个数）。
  function fillLine(p) {
    var box = $("pf-hits");
    if (!box || !p || !p.text) return;
    var lines = String(p.text).split("\n").filter(function (x) { return x.trim(); });
    box.hidden = false;
    box.innerHTML = lines.map(function (line) {
      return '<li class="grant-row">' +
        '<span class="grant-mail">' + esc(line) + "</span>" +
        '<button class="grant-del" type="button" data-line="' + esc(line.trim()) + '">用这一句</button>' +
        "</li>";
    }).join("");
  }

  function onPinyinLine(e) {
    var b = e.target.closest ? e.target.closest("button[data-line]") : null;
    if (!b) return;
    var line = b.getAttribute("data-line");
    var box = $("pf-line");
    if (box) box.value = line;
    renderHits([]);
    previewLine();
  }

  // 这一句里每个字读什么（用当前引擎 + 当前勘误算一遍）——
  // 钉之前先让人看清「现在读成什么」，钉之后再看一眼「有没有改对」。
  function previewLine() {
    var el = $("pf-picked");
    if (!el) return;
    var line = (($("pf-line") || {}).value || "").trim();
    var P = window.Pinyin;
    var p = pickedPoem();
    if (!line || !P) { el.hidden = true; el.textContent = ""; return; }
    var wid = p ? widOfPoem(p) : "";
    var html = P.annotatePoem ? P.annotatePoem(wid, line, "all") : P.annotateHtml(line, "all");
    // 只留「字(读音)」这一层，别把 ruby 标签塞进提示里。
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
    if (!line) { msg("msg-pf", "要填原文里的一句（点「从篇目里挑一句」也行）。", "warn"); return; }
    if (!py) { msg("msg-pf", "要填应读作什么（带声调，如 cháng）。", "warn"); return; }
    if (!isFinite(at) || at < 1) at = 1;

    // 那一个字是什么：从这一句里数出第 at 个字（复核用，也让别处不必再翻正文）。
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
    var note = $("pf-note");
    if (note) {
      note.hidden = false;
      note.textContent = list.length
        ? ("共 " + list.length + " 条（上限 " + F.MAX + "）。这一份随账号同步 —— 换台设备也照它读。")
        : "";
    }
    box.innerHTML = list.map(function (f) {
      return '<li class="grant-row">' +
        '<span class="grant-mail">' + esc(f.wid) + "</span>" +
        '<span class="grant-when">' + esc(f.line) + " · 第" + esc(String(f.at)) +
          "个「" + esc(f.ch || "?") + "」 → " + esc(f.py) + "</span>" +
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

  function renderTierPick() {
    var box = $("tier-pick");
    if (!box) return;
    box.innerHTML = Ent.TIERS.map(function (t) {
      return '<button type="button" data-tier="' + t + '"' +
        (t === pickedTier ? ' class="active"' : "") + ' aria-pressed="' +
        (t === pickedTier ? "true" : "false") + '">' + esc(Ent.tierLabel(t)) + "</button>";
    }).join("");
  }

  function onPick(e) {
    var b = e.target.closest ? e.target.closest("button[data-tier]") : null;
    if (!b) return;
    pickedTier = b.getAttribute("data-tier");
    renderTierPick();
  }

  function readForm() {
    var mask = (($("input-mask") || {}).value || "").trim();
    if (!mask) return { bad: "请填邮箱掩码（与用户在账号页看到的那串一致）" };
    var untilStr = (($("input-until") || {}).value || "").trim();
    var until = null;
    if (untilStr) {

      var t = Date.parse(untilStr + "T23:59:59");
      if (!isFinite(t)) return { bad: "到期日看不懂，请用日期选择器" };
      until = t;
    }
    return { mask: mask, until: until };
  }

  function clearForm() {
    var m = $("input-mask"); if (m) m.value = "";
  }

  function onGrant() {
    var f = readForm();
    if (f.bad) { msg("msg-grant", f.bad, "warn"); return; }
    var M = acct();
    var btn = $("btn-grant");
    if (btn) btn.disabled = true;
    msg("msg-grant", "正在发往服务端……", "");

    if (!M || typeof M.adminGrant !== "function") {
      if (btn) btn.disabled = false;
      msg("msg-grant", "页面脚本版本对不上（刷新一次即可），这一轮没发出任何东西。", "warn");
      return;
    }

    Promise.resolve(M.adminGrant({ emailMask: f.mask, tier: pickedTier, until: f.until, backing: backing, A: window.AuthCore, E: Ent }))
      .then(function (r) {
        if (btn) btn.disabled = false;
        if (!r || !r.ok) { grantFailed(r); return; }
        if (!r.changed) {
          msg("msg-grant", "服务端收到这一条了，但" + r.note, "warn");
          clearForm();
          loadServerGrants();
          loadAccounts();
          return;
        }
        var line = "已写进数据库：" + r.emailMask + " → " + Ent.tierLabel(r.tier) +
          (r.until ? "（到期 " + new Date(r.until).toLocaleDateString() + "）" : "（永久）") +
          "。对方刷新页面（或打开「我的」页）即由服务器判定生效。";
        if (r.ambiguous) line += "⚠️ 这个掩码在库里不只一条，只改了最早的那一条 —— 请让对方确认。";
        msg("msg-grant", line, "ok");
        clearForm();
        loadServerGrants();
        loadAccounts();
      })["catch"](function () {
        if (btn) btn.disabled = false;
        msg("msg-grant", "连不上服务端，这一轮没发出任何东西。", "warn");
      });
  }

  function grantFailed(r) {
    var reason = r && r.reason;
    var text = (r && r.message) || "发放没成功。";
    if (reason === "guest") {
      text = "登录状态已过期，请重新登录后再来。";
    } else if (reason === "not-configured") {
      text = "本站还没开放云端账号（服务端缺密钥），这一条发不出去。本站**没有**第二条发放的路 —— 层级只在数据库里。";
    } else if (reason === "no-channel") {
      text = "页面脚本版本对不上（刷新一次即可），这一轮没发出任何东西。";
    } else if (reason === "unavailable") {
      text = "连不上服务端，这一轮没发出任何东西。请稍后重试 —— 层级只在数据库里，本机没有第二份。";
    }
    msg("msg-grant", text, "warn");
  }

  function renderServerGrants(data) {
    var box = $("server-list");
    if (!box) return;
    var list = (data && data.grants) || [];
    var empty = $("server-empty");
    if (empty) empty.hidden = list.length > 0;
    box.innerHTML = list.map(function (g) {
      var when = g.until ? "到期 " + new Date(g.until).toLocaleDateString() : "永久";
      return '<li class="grant-row">' +
        '<span class="grant-mail">' + esc(g.emailMask) + "</span>" +
        '<span class="tier-badge tier-' + esc(g.tier) + '">' + esc(Ent.tierLabel(g.tier)) + "</span>" +
        '<span class="grant-when">' + esc(when) + "</span>" +
        '<button class="grant-del" type="button" data-revoke="' + esc(g.emailMask) + '">收回</button>' +
        "</li>";
    }).join("");
  }

  function serverNote(text, warn) {
    var el = $("server-note");
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !text;
  }

  function loadServerGrants() {
    var M = acct();
    if (!M || typeof M.adminGrants !== "function") {
      serverNote("页面脚本版本对不上（刷新一次即可）：这一块现在看不了。", true);
      return;
    }
    Promise.resolve(M.adminGrants({ backing: backing, A: window.AuthCore, E: Ent })).then(function (r) {
      if (r && r.ok) {
        renderServerGrants(r);
        serverNote("这一份由服务器判定：对方改一行存储改不动它 —— 层级只在数据库里。", false);
        return;
      }
      if (r && r.reason === "guest") { serverNote("登录状态已过期，请重新登录后再来。", true); return; }
      if (r && r.reason === "not-configured") { serverNote("本站还没开放云端账号（服务端缺密钥）：这一块暂时问不到。", true); return; }
      if (r && r.reason === "no-channel") { serverNote("页面脚本版本对不上（刷新一次即可）：这一块现在看不了。", true); return; }
      if (r && r.code === "E_FORBIDDEN") { serverNote("这一条只对管理员开放（服务端的角色闸）。", true); return; }
      serverNote("连不上服务端，这一轮没问到。", true);
    })["catch"](function () { serverNote("连不上服务端，这一轮没问到。", true); });
  }

  function onServerListClick(e) {
    var b = e.target.closest ? e.target.closest("button[data-revoke]") : null;
    if (!b) return;
    var mask = b.getAttribute("data-revoke");
    var M = acct();
    if (!M || typeof M.adminRevoke !== "function") { msg("msg-server", "页面脚本版本对不上，这一轮没发出任何东西。", "warn"); return; }
    b.disabled = true;
    msg("msg-server", "正在收回 " + mask + " ……", "");
    Promise.resolve(M.adminRevoke({ emailMask: mask, backing: backing, A: window.AuthCore, E: Ent })).then(function (r) {
      b.disabled = false;
      if (!r || !r.ok) { msg("msg-server", (r && r.message) || "收回没成功，稍后再试。", "warn"); return; }
      msg("msg-server", r.changed
        ? "已在数据库里收回 " + mask + " 的层级（对方刷新即回落 Free）。"
        : "数据库里本来就没有 " + mask + " 这一条。", r.changed ? "ok" : "warn");
      loadServerGrants();
    })["catch"](function () { b.disabled = false; msg("msg-server", "连不上服务端，这一轮没发出任何东西。", "warn"); });
  }

  // 名录（Issue #276 起这里也是「改角色」的地方）
  //
  // 三条口径：
  //   · **角色与层级各一格**。它们是两条正交的轴（`role` 决定能不能进后台，
  //     `tier` 决定能用什么），所以并排显示、各自一个徽章 —— 折成一列的下场
  //     是「管理员 = 买了 Max 的人」这个误解又回来了。
  //   · **改角色是按钮，不是下拉**。目标值只有两档（普通用户 / 管理员），
  //     下拉要两次点击 + 一次滚动，按钮一次。
  //   · **改完就地更新那一行**（不重拉整张表）—— 重拉的下场是「滚到第 40 个
  //     人改了一下，页面跳回顶部」。
  var ROLE_LABEL = { owner: "主人（种子）", admin: "管理员", user: "普通用户" };

  function roleText(role) {
    var r = String(role || "user").toLowerCase();
    return ROLE_LABEL[r] || r;
  }

  function renderAccounts(data) {
    var box = $("accounts-list");
    if (!box) return;
    var list = (data && data.accounts) || [];
    currentAccounts = list;
    var empty = $("accounts-empty");
    if (empty) {
      empty.hidden = list.length > 0;
      empty.textContent = "还没有任何账号。";
    }
    box.innerHTML = list.map(function (a) {
      var mail = a.email || a.emailMask || "（无邮箱）";
      var role = String(a.role || "user").toLowerCase();

      var verified = a.emailVerified
        ? '<span class="acct-tag ok">已确认</span>'
        : '<span class="acct-tag warn" title="没确认就登不进来（默认口径）">待确认 · 登不进来</span>';
      var pw = a.hasPassword
        ? '<span class="acct-tag">有密码</span>'
        : '<span class="acct-tag muted">无密码</span>';
      var st = a.status === "active" ? "" : '<span class="acct-tag warn">' + esc(a.status) + "</span>";
      var nick = a.nickname ? esc(a.nickname) : '<span class="acct-none">未起名</span>';
      var created = a.createdAt ? new Date(a.createdAt).toLocaleDateString() : "—";
      var last = a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleDateString() : "—";

      return '<li class="acct-row" data-uid="' + esc(a.uid || "") + '">' +
        '<span class="acct-main"><span class="acct-mail">' + esc(mail) + "</span>" +
        '<span class="acct-sub">' + nick + " · 注册 " + esc(created) + " · 最后登录 " + esc(last) + "</span></span>" +
        '<span class="acct-tags">' +
        '<span class="role-badge role-' + esc(role) + '" data-role-badge>' + esc(roleText(role)) + "</span>" +
        '<span class="tier-badge tier-' + esc(a.tier) + '">' + esc(Ent.tierLabel(a.tier)) + "</span>" +
        verified + pw + st +
        "</span>" +
        roleActs(a.uid, role) +
        "</li>";
    }).join("");
  }

  // 角色按钮：只有 owner 改得动（服务端也会再拦一次）；owner 本人那一行不摆按钮
  // ——「改不了自己」是服务端定的规矩，界面照实画出来，不做成点了才报错。
  function roleActs(uid, role) {
    if (!uid) return "";
    if (role === "owner") {
      return '<span class="acct-role-acts"><span class="acct-none">种子主人 · 由 OWNER_EMAILS 认领</span></span>';
    }
    return '<span class="acct-role-acts">' +
      roleAct(uid, "user", "普通用户", role) +
      roleAct(uid, "admin", "管理员", role) +
      "</span>";
  }

  function roleAct(uid, target, label, role) {
    var on = role === target;
    return '<button type="button" class="acct-role-btn' + (on ? " active" : "") + '"' +
      ' data-set-role="' + esc(target) + '" data-uid="' + esc(uid) + '"' +
      (on ? ' aria-pressed="true"' : ' aria-pressed="false"') + ">" + esc(label) + "</button>";
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
        var n = (r.accounts || []).length;
        var owners = (r.accounts || []).filter(function (a) { return a.role === "owner"; }).length;
        accountsNote("共 " + n + " 个账号（其中主人 " + owners + " 位）。角色与层级都以数据库为准；" +
          "上面那张只列发过层级的。", owners ? false : true);
        return;
      }
      if (r && r.reason === "guest") { accountsNote("登录状态已过期，请重新登录后再来。", true); return; }
      if (r && r.reason === "not-configured") { accountsNote("本站还没开放云端账号（服务端缺密钥）：这一块暂时问不到。", true); return; }
      if (r && r.reason === "no-channel") { accountsNote("页面脚本版本对不上（刷新一次即可）。", true); return; }
      if (r && r.code === "E_FORBIDDEN") { accountsNote("这一条只对管理员开放（服务端的角色闸）。", true); return; }
      accountsNote("连不上服务端，这一轮没问到。", true);
    })["catch"](function () { accountsNote("连不上服务端，这一轮没问到。", true); });
  }

  function onAccountsClick(e) {
    var b = e.target.closest ? e.target.closest("button[data-set-role]") : null;
    if (!b) return;
    var uid = b.getAttribute("data-uid");
    var role = b.getAttribute("data-set-role");
    var M = acct();
    if (!M || typeof M.adminSetRole !== "function") {
      msg("msg-accounts", "页面脚本版本对不上（刷新一次即可）。", "warn");
      return;
    }
    var li = document.querySelector('.acct-row[data-uid="' + uid + '"]');
    var mail = li ? (li.querySelector(".acct-mail") || {}).textContent || "" : "";
    if (role === "admin" && !window.confirm("把 " + mail + " 提成管理员？管理员能发层级、看名录、处理报告（但改不了别人的角色）。")) return;
    if (role === "user" && /管理员/.test((li && li.querySelector(".role-badge") || {}).textContent || "") &&
        !window.confirm("把 " + mail + " 降回普通用户？他立刻进不了管理后台。")) return;

    var btns = li ? li.querySelectorAll("button[data-set-role]") : [];
    for (var i = 0; i < btns.length; i++) btns[i].disabled = true;
    msg("msg-accounts", "正在改……", "");
    Promise.resolve(M.adminSetRole({ uid: uid, role: role })).then(function (r) {
      for (var j = 0; j < btns.length; j++) btns[j].disabled = false;
      if (r && r.ok) {
        // 就地更新那一行（不重拉整张表 —— 重拉会把滚动位置打回顶部）。
        if (li) {
          var badge = li.querySelector("[data-role-badge]");
          if (badge) { badge.textContent = roleText(role); badge.className = "role-badge role-" + role; }
          var bs = li.querySelectorAll("button[data-set-role]");
          for (var k = 0; k < bs.length; k++) {
            var on = bs[k].getAttribute("data-set-role") === role;
            bs[k].className = "acct-role-btn" + (on ? " active" : "");
            bs[k].setAttribute("aria-pressed", on ? "true" : "false");
          }
        }
        msg("msg-accounts", r.changed
          ? ((r.emailMask || mail) + " 现在是「" + roleText(role) + "」。对方刷新即生效（由服务器判定）。")
          : ((r.emailMask || mail) + " 本来就是「" + roleText(role) + "」。"), "ok");
        return;
      }
      if (r && r.code === "E_SELF") { msg("msg-accounts", "改不了自己的角色 —— 要换主人，把 OWNER_EMAILS 改成那个邮箱再用它登录一次。", "warn"); return; }
      if (r && r.code === "E_OWNER_LOCKED") { msg("msg-accounts", "这一位是种子主人（OWNER_EMAILS 里的人），身份不由这个口改。", "warn"); return; }
      if (r && r.code === "E_FORBIDDEN") { msg("msg-accounts", "改角色只对主人开放（管理员能发层级、看名录、处理报告，但不能授权）。", "warn"); return; }
      if (r && r.reason === "guest") { msg("msg-accounts", "登录状态已过期，请重新登录后再来。", "warn"); return; }
      if (r && r.reason === "not-configured") { msg("msg-accounts", "本站还没开放云端账号（服务端缺密钥），改不了。", "warn"); return; }
      msg("msg-accounts", (r && r.message) || "没改成，稍后再试。", "warn");
    })["catch"](function () {
      for (var j2 = 0; j2 < btns.length; j2++) btns[j2].disabled = false;
      msg("msg-accounts", "连不上服务端，这一轮没发出任何东西。", "warn");
    });
  }

  // ---- 用户报告台账（Issue #243 第四轮）----------------------------------
  //
  // 这一块与「发层级」那一族是**两条平行的线**：那条线改的是权益，
  // 这条线只读台账 + 改状态。所以它有自己的一小套 load / render，
  // 不与 `loadAccounts` 合并 —— 合并的下场是「刷新账号名录顺手把
  // 报告也重拉一遍」，而报告的读比账号名录重得多。
  //
  // 三条口径：
  //   · **默认只看「还没处理的」**（new）。全站翻到第 500 条不是管理员的日常，
  //     「今天新来的有几条」才是。所以下拉框默认落在「已收到（还没看）」。
  //   · **状态是按钮，不是下拉**。一屏里逐条改状态时，下拉要两次点击 + 一次滚动；
  //     按钮一次。而这里的状态只有五个、且是终点（不会来回切）。
  //   · **改完就地更新那一行**，不重拉整张表 —— 重拉的下场是「滚到第 30 条
  //     改了一下，页面跳回顶部」。
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
    var status = sel ? sel.value : "all";
    reportsMsg("正在读取……", "");

    Promise.resolve(M.adminReports({ status: status, backing: backing, A: window.AuthCore, E: Ent }))
      .then(function (r) {
        if (r && r.ok) {
          currentReports = r.reports || [];
          renderReports(currentReports);
          renderReportCounts(r.counts || {});
          reportsMsg("", "");
          reportsNote("共 " + currentReports.length + " 条（这一屏）。上面那排小字是全站各状态的总数。", false);
          return;
        }
        if (r && r.reason === "guest") { reportsMsg("登录状态已过期，请重新登录后再来。", "warn"); return; }
        if (r && r.reason === "not-configured") { reportsNote("本站还没开放云端账号（服务端缺密钥）：报告这一块暂时问不到。", true); return; }
        if (r && r.reason === "no-channel") { reportsNote("页面脚本版本对不上（刷新一次即可）。", true); return; }
        if (r && r.code === "E_FORBIDDEN") { reportsNote("这一条只对管理员开放（服务端的角色闸）。", true); return; }
        reportsMsg("连不上服务端，这一轮没问到。", "warn");
      })["catch"](function () { reportsMsg("连不上服务端，这一轮没问到。", "warn"); });
  }

  function renderReportCounts(counts) {
    var host = $("report-counts");
    if (!host) return;
    var R = window.Report;
    var order = ["all"].concat((R && R.STATUS_LABEL) ? Object.keys(R.STATUS_LABEL) : []);
    var parts = [];
    order.forEach(function (k) {
      var n = counts ? counts[k] : undefined;
      if (typeof n !== "number") return;
      var label = k === "all" ? "全部" : (R ? R.labelOfStatus(k) : k);
      parts.push("<span>" + esc(label) + " " + n + "</span>");
    });
    host.innerHTML = parts.join("");
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
        '<div class="admin-report-who">' + esc(r.emailMask || "（无邮箱）") +
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

    // 「不采纳」要问一句 —— 那是对用户说「你报的是错的」，
    // 而用户看得到这个状态（`/settings/reports/` 那一页）。
    if (status === "rejected" && !window.confirm("标成「未采纳」？用户那一页会显示未采纳。")) return;

    b.disabled = true;
    reportsMsg("正在改……", "");
    Promise.resolve(M.adminReportPatch({ rid: rid, status: status, backing: backing, A: window.AuthCore, E: Ent }))
      .then(function (r) {
        b.disabled = false;
        if (r && r.ok) {
          // 就地更新那一行（不重拉整张表 —— 重拉会把滚动位置打回顶部）。
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

  function init() {
    var id = Ent.identity({ backing: backing });

    if (!isOwner(id)) {
      // 拒绝界面（Issue #276）：**不再有「本机主人」这条兜底** ——
      // 没有服务端答案就不放行。文案只有一句（用户裁：不分情况啰嗦）：
      // 未登录与角色不够的答案一样 —— 都不放行。
      show($("deny-card"));
      var lead = $("deny-lead");
      if (lead) lead.textContent = "只对管理员开放。";
      var back = $("btn-back-profile");
      if (back) back.addEventListener("click", function () { location.href = "/mine/"; });
      return;
    }

    show($("grant-card"));
    show($("server-card"));
    show($("accounts-card"));
    show($("reports-card"));
    show($("pinyin-card"));
    renderTierPick();
    loadServerGrants();
    loadAccounts();

    $("tier-pick").addEventListener("click", onPick);
    $("btn-grant").addEventListener("click", onGrant);
    $("server-list").addEventListener("click", onServerListClick);
    $("btn-server-reload").addEventListener("click", loadServerGrants);
    $("btn-accounts-reload").addEventListener("click", loadAccounts);
    if ($("accounts-list")) $("accounts-list").addEventListener("click", onAccountsClick);
    if ($("btn-reports-reload")) $("btn-reports-reload").addEventListener("click", loadReports);
    if ($("report-filter")) $("report-filter").addEventListener("change", loadReports);
    if ($("reports-list")) $("reports-list").addEventListener("click", onReportsClick);
    loadReports();

    var pfWid = $("pf-wid"), pfLine = $("pf-line");
    if (pfWid) pfWid.addEventListener("input", onPinyinSearch);
    if (pfLine) pfLine.addEventListener("input", previewLine);
    $("pf-hits").addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("button[data-line]")) onPinyinLine(e);
      else onPinyinPick(e);
    });
    $("btn-pf-add").addEventListener("click", onPinyinAdd);
    $("btn-pf-fill").addEventListener("click", function () {
      var p = pickedPoem();
      if (!p) { msg("msg-pf", "先在上面搜一篇、点「选这一篇」。", "warn"); return; }
      fillLine(p);
    });
    $("pf-list").addEventListener("click", onFixListClick);
    $("btn-pf-export").addEventListener("click", onFixExport);
    $("btn-pf-refresh").addEventListener("click", renderFixList);
    renderFixList();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.AdminPage = {
    isOwner: isOwner, esc: esc, roleText: roleText, renderAccounts: renderAccounts,

    readForm: readForm, grantFailed: grantFailed,

    renderReports: renderReports, loadReports: loadReports, reportTime: reportTime,

    // 注音勘误那一块（测试直接调这几个，不必去点 DOM）。
    searchPoems: searchPoems,
    widOfPoem: widOfPoem
  };
})();
