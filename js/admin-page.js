(function () {
  "use strict";

  var Ent = window.Entitlement;

  function acct() { return window.AccountApi || null; }

  var backing = null;
  try { backing = window.localStorage; } catch (e) { backing = null; }

  var pickedTier = "pro";

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

  function isOwner(id) {

    void id;
    return Ent.isOwner(backing);
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
      msg("msg-grant", "页面脚本版本对不上（刷新一次即可），这一轮没发出任何东西。想先用本机那份，点「只发到本机名单」。", "warn");
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
        var line = "已写进服务端：" + r.emailMask + " → " + Ent.tierLabel(r.tier) +
          (r.until ? "（到期 " + new Date(r.until).toLocaleDateString() + "）" : "（永久）") +
          "。对方刷新页面（或打开个人中心）即由服务器判定生效。";
        if (r.ambiguous) line += "⚠️ 这个掩码在库里不只一条，只改了最早的那一条 —— 请让对方确认。";
        msg("msg-grant", line, "ok");
        clearForm();
        loadServerGrants();
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
      text = "本站还没开放云端账号（服务端缺密钥），这一条发不出去。可以先用「只发到本机名单」兜底 —— 但那一份不是权威。";
    } else if (reason === "no-channel") {
      text = "页面脚本版本对不上（刷新一次即可），这一轮没发出任何东西。";
    } else if (reason === "unavailable") {
      text = "连不上服务端，这一轮没发出任何东西。（本机名单不受影响，可先用「只发到本机名单」兜底 —— 但那一份不是权威。）";
    }
    msg("msg-grant", text, "warn");
  }

  function onGrantLocal() {
    var f = readForm();
    if (f.bad) { msg("msg-grant", f.bad, "warn"); return; }
    var r = Ent.putGrant(backing, { emailMask: f.mask, tier: pickedTier, until: f.until, by: "owner", at: Date.now() });
    if (!r.ok) { msg("msg-grant", r.message, "warn"); return; }
    msg("msg-grant", "已发往**本机名单**：" + r.grant.emailMask + " → " + Ent.tierLabel(r.grant.tier) +
      (r.grant.until ? "（到期 " + new Date(r.grant.until).toLocaleDateString() + "）" : "（永久）") +
      "。⚠️ 这一份要对方自己导入，且不是权威。", "ok");
    clearForm();
    renderList();
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
      serverNote("页面脚本版本对不上（刷新一次即可）：这一块现在只能看本机名单。", true);
      return;
    }
    Promise.resolve(M.adminGrants({ backing: backing, A: window.AuthCore, E: Ent })).then(function (r) {
      if (r && r.ok) {
        renderServerGrants(r);
        serverNote("和上面那份**不是一回事**：这一份由服务器判定，对方改一行存储改不动它。两份不自动同步。", false);
        return;
      }
      if (r && r.reason === "guest") { serverNote("登录状态已过期，请重新登录后再来。下面这一份本机名单照旧可用。", true); return; }
      if (r && r.reason === "not-configured") { serverNote("本站还没开放云端账号（服务端缺密钥）：这一块暂时问不到。下面这一份本机名单照旧可用。", true); return; }
      if (r && r.reason === "no-channel") { serverNote("页面脚本版本对不上（刷新一次即可）：这一块现在只能看本机名单。", true); return; }
      if (r && r.code === "E_FORBIDDEN") { serverNote("这一条只对管理员开放（服务端的角色闸）：下面是本机那一份。", true); return; }
      serverNote("连不上服务端，这一轮没问到。下面这一份本机名单照旧可用。", true);
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
        ? "已在服务端收回 " + mask + " 的层级（对方刷新即回落 Free）。"
        : "服务端上本来就没有 " + mask + " 这一条。", r.changed ? "ok" : "warn");
      loadServerGrants();
    })["catch"](function () { b.disabled = false; msg("msg-server", "连不上服务端，这一轮没发出任何东西。", "warn"); });
  }

  function renderAccounts(data) {
    var box = $("accounts-list");
    if (!box) return;
    var list = (data && data.accounts) || [];
    var empty = $("accounts-empty");
    if (empty) {
      empty.hidden = list.length > 0;
      empty.textContent = "还没有任何账号。";
    }
    box.innerHTML = list.map(function (a) {

      var mail = a.email || a.emailMask || "（无邮箱）";

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
      return '<li class="acct-row">' +
        '<span class="acct-main"><span class="acct-mail">' + esc(mail) + "</span>" +
        '<span class="acct-sub">' + nick + " · 注册 " + esc(created) + " · 最后登录 " + esc(last) + "</span></span>" +
        '<span class="acct-tags">' +
        '<span class="tier-badge tier-' + esc(a.tier) + '">' + esc(Ent.tierLabel(a.tier)) + "</span>" +
        verified + pw + st +
        "</span></li>";
    }).join("");
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
        var data = (r.accounts || []).length;
        accountsNote("共 " + data + " 个账号。这里列的是**注册过的**（含邮箱）；上面那张只列发过层级的。", false);
        return;
      }
      if (r && r.reason === "guest") { accountsNote("登录状态已过期，请重新登录后再来。", true); return; }
      if (r && r.reason === "not-configured") { accountsNote("本站还没开放云端账号（服务端缺密钥）：这一块暂时问不到。", true); return; }
      if (r && r.reason === "no-channel") { accountsNote("页面脚本版本对不上（刷新一次即可）。", true); return; }
      if (r && r.code === "E_FORBIDDEN") { accountsNote("这一条只对管理员开放（服务端的角色闸）。", true); return; }
      accountsNote("连不上服务端，这一轮没问到。", true);
    })["catch"](function () { accountsNote("连不上服务端，这一轮没问到。", true); });
  }

  function renderList() {
    var box = $("grant-list");
    if (!box) return;
    var grants = Ent.readGrants(backing).grants;
    var empty = $("grant-empty");
    if (empty) empty.hidden = grants.length > 0;
    box.innerHTML = grants.map(function (g) {
      var when = g.until ? "到期 " + new Date(g.until).toLocaleDateString() : "永久";
      return '<li class="grant-row">' +
        '<span class="grant-mail">' + esc(g.emailMask) + "</span>" +
        '<span class="tier-badge tier-' + esc(g.tier) + '">' + esc(Ent.tierLabel(g.tier)) + "</span>" +
        '<span class="grant-when">' + esc(when) + "</span>" +
        '<button class="grant-del" type="button" data-mask="' + esc(g.emailMask) + '">删除</button>' +
        "</li>";
    }).join("");
  }

  function onListClick(e) {
    var b = e.target.closest ? e.target.closest("button[data-mask]") : null;
    if (!b) return;
    var mask = b.getAttribute("data-mask");
    var r = Ent.removeGrant(backing, mask);
    msg("msg-list", r.removed ? "已收回 " + mask + " 的层级" : "这条已经不在了", r.removed ? "ok" : "warn");
    renderList();
  }

  function onExport() {
    var text = Ent.exportGrants(backing);
    var done = function () { msg("msg-list", "名单已复制，发给对方让他导入即可", "ok"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {

        msg("msg-list", "复制失败，请手动抄下：" + text, "warn");
      });
    } else {
      msg("msg-list", "这份名单请手动抄下：" + text, "warn");
    }
  }

  function onImportOpen() {
    var modal = $("text-dialog");
    if (!modal) return;
    var t = $("text-dialog-text");
    if (t) t.value = "";
    var title = $("text-dialog-title");
    if (title) title.textContent = "导入发放名单";
    var tip = $("text-dialog-tip");
    if (tip) tip.textContent = "把对方给你的名单 JSON 粘在这里，导入会覆盖当前名单。";
    modal.hidden = false;
    if (t) t.focus();
  }

  function closeImport() {
    var modal = $("text-dialog");
    if (modal) modal.hidden = true;
  }

  function onImportOk() {
    var t = $("text-dialog-text");
    var text = (t && t.value ? t.value : "").trim();
    if (!text) { msg("msg-list", "还没有粘贴内容", "warn"); closeImport(); return; }
    var r = Ent.importGrants(backing, text);
    closeImport();
    if (!r.ok) { msg("msg-list", r.message, "warn"); return; }
    msg("msg-list", "已导入 " + r.count + " 条发放记录", "ok");
    renderList();
  }

  function renderSim(id) {
    var label = $("sim-label");
    var btn = $("btn-sim");
    if (!label || !btn) return;

    var real = Ent.readTier(backing);
    var isFree = Ent.tierIndex(real) === 0;
    label.textContent = Ent.tierLabel(real);

    btn.textContent = isFree ? "恢复 " + Ent.tierLabel(Ent.TIERS[1]) : "降到 " + Ent.tierLabel(Ent.TIERS[0]);
    btn.setAttribute("data-mode", isFree ? "restore" : "free");
    void id;
  }

  function onSim() {
    var btn = $("btn-sim");
    var mode = btn ? btn.getAttribute("data-mode") : "free";
    if (mode === "restore") {
      Ent.writeTier(backing, "pro", null);
      showToast("已恢复为 Pro");
    } else {
      Ent.writeTier(backing, "free", null);
      showToast("现在以 Free 身份预览");
    }
    renderSim(Ent.identity({ backing: backing }));
  }

  function onWipeStart() { hide($("wipe-step-1")); show($("wipe-step-2")); msg("msg-wipe", ""); }
  function onWipeCancel() { hide($("wipe-step-2")); show($("wipe-step-1")); msg("msg-wipe", ""); }
  function onWipeConfirm() {
    Ent.clearGrants(backing);
    hide($("wipe-step-2"));
    show($("wipe-step-1"));
    msg("msg-wipe", "发放名单已清空，所有已发放的层级都已收回。", "ok");
    renderList();
  }

  function init() {
    var id = Ent.identity({ backing: backing });

    if (!isOwner(id)) {

      show($("deny-card"));
      var lead = $("deny-lead");
      if (lead) {
        lead.textContent = "只对本机管理员开放。你现在是「" + Ent.tierLabel(id.tier) +
          "」" + (id.signedIn ? "（" + (id.mask || "无邮箱") + "）" : "（未登录）") + "。";
      }
      $("btn-back-profile").addEventListener("click", function () { location.href = "/profile/"; });
      return;
    }

    Ent.markOwner(backing);

    show($("grant-card"));
    show($("server-card"));
    show($("accounts-card"));
    show($("list-card"));
    show($("sim-card"));
    show($("danger-card"));
    renderTierPick();
    renderList();
    renderSim(id);
    loadServerGrants();

    $("tier-pick").addEventListener("click", onPick);
    $("btn-grant").addEventListener("click", onGrant);
    $("btn-grant-local").addEventListener("click", onGrantLocal);
    $("server-list").addEventListener("click", onServerListClick);
    $("btn-server-reload").addEventListener("click", loadServerGrants);
    $("btn-accounts-reload").addEventListener("click", loadAccounts);
    $("grant-list").addEventListener("click", onListClick);
    $("btn-export").addEventListener("click", onExport);
    $("btn-import-open").addEventListener("click", onImportOpen);
    $("btn-sim").addEventListener("click", onSim);
    $("btn-wipe-start").addEventListener("click", onWipeStart);
    $("btn-wipe-cancel").addEventListener("click", onWipeCancel);
    $("btn-wipe-confirm").addEventListener("click", onWipeConfirm);

    var ok = $("text-dialog-ok"), cancel = $("text-dialog-cancel"), modal = $("text-dialog");
    if (ok) ok.addEventListener("click", onImportOk);
    if (cancel) cancel.addEventListener("click", closeImport);
    if (modal) {
      modal.addEventListener("click", function (e) {
        if (e.target && e.target.getAttribute && e.target.getAttribute("data-close")) closeImport();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.AdminPage = {
    isOwner: isOwner, esc: esc,

    readForm: readForm, grantFailed: grantFailed
  };
})();
