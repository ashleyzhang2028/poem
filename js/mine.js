(function () {
  "use strict";

  var A = window.AuthCore;
  var Ent = window.Entitlement;

  function acct() { return window.AccountApi || null; }
  function familyMod() { return window.Family || null; }

  var backing = null;
  try { backing = window.localStorage; } catch (e) { backing = null; }
  var store = A && A.makeStore ? A.makeStore(backing) : null;

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

  function identity() {
    try { return Ent.identity({ backing: backing, authStore: store }); } catch (e) { return null; }
  }

  function identityRow() { return $("identity-row"); }

  var EMAIL_OPEN = false;

  function identityEmail() {
    var id = identity();
    if (!id || !id.signedIn) return "";
    var info = acct() && acct().account ? acct().account() : null;
    if (info && info.email) return String(info.email);
    if (id.email) return String(id.email);
    var s = A.session(store);
    var ids = (s && s.account && s.account.identities) || [];
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] && ids[i].channel === "email" && ids[i].value) return String(ids[i].value);
    }
    return "";
  }

  function paintEmailToggle() {
    var btn = $("btn-my-email");
    var box = $("identity-email");
    if (!btn || !box) return;
    var mail = identityEmail();
    if (!mail) {
      hide(btn); hide(box); box.textContent = "";
      return;
    }
        if (paintEmailToggle._who !== identity().uid) {
      paintEmailToggle._who = identity().uid;
      EMAIL_OPEN = false;
    }
    show(btn);
    btn.textContent = EMAIL_OPEN ? "收起邮箱" : "我的邮箱";
    btn.setAttribute("aria-expanded", EMAIL_OPEN ? "true" : "false");
    btn.setAttribute("aria-controls", "identity-email");
    box.textContent = EMAIL_OPEN ? mail : "";
    if (EMAIL_OPEN) show(box); else hide(box);
  }

  function buildIdentityRow(row) {
    row.innerHTML =

      '<div class="identity-head">' +
      '<span id="avatar-slot" class="avatar-slot">' +
      (window.Avatar ? Avatar.html(backing) : "") + "</span>" +

      '<span class="identity-main" id="identity-main">' +
      '<label class="sr-only" for="input-nickname">用户名</label>' +

      '<input id="input-nickname" class="nickname-input" type="text" maxlength="12"' +
      ' size="1" placeholder="起个名字" autocomplete="off" enterkeyhint="done" />' +
            '<span class="identity-sub" id="identity-sub">' +
      '<span id="identity-state"></span>' +
      '<button class="identity-mail-btn" id="btn-my-email" type="button" hidden' +
      ' aria-expanded="false">我的邮箱</button>' +
      '<span class="identity-email" id="identity-email" hidden></span>' +
      "</span>" +
      "</span>" +
      '<a class="tier-badge" id="identity-badge" href="/plans/" title="查看权益对比"></a>' +
      "</div>" +

      '<div class="identity-btns" id="identity-btns">' +
      '<button class="account-btn" id="btn-account-entry" type="button">登录</button>' +
      '<button class="account-btn ghost" id="btn-avatar-pick" type="button">上传头像</button>' +
      "</div>" +

      "";
    bindNickname();
    bindEmailToggle();

    if (window.AvatarEdit && window.AvatarEdit.render) window.AvatarEdit.render();
  }

  function bindEmailToggle() {
    var btn = $("btn-my-email");
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", function () {
      EMAIL_OPEN = !EMAIL_OPEN;
      paintEmailToggle();
    });
  }

  function renderIdentity(id) {
    var row = identityRow();
    if (!row || !id) return;
    if (!$("input-nickname")) buildIdentityRow(row);

    var slot = $("avatar-slot");
    if (slot) slot.innerHTML = window.Avatar ? Avatar.html(backing) : "";

        var stateEl = $("identity-state");
    if (stateEl) stateEl.textContent = id.signedIn ? "已登录" : "游客";
    paintEmailToggle();

    var badge = $("identity-badge");
    if (badge) {
      badge.className = "tier-badge tier-" + id.tier;
      badge.textContent = Ent.tierLabel(id.tier);
    }

    var input = $("input-nickname");
    if (input && document.activeElement !== input) input.value = nicknameValue();

    renderSignOut(id);
  }

  function renderSignOut(id) {
    var btn = $("btn-account-entry");
    if (!btn) return;
    btn.textContent = id.signedIn ? "退出登录" : "登录";
    btn.className = id.signedIn ? "account-btn ghost" : "account-btn";

    btn.hidden = false;
    btn.dataset.action = id.signedIn ? "sign-out" : "sign-in";
    if (!btn.dataset.bound) {
      btn.dataset.bound = "1";

      btn.addEventListener("click", function () {
        if (btn.dataset.action === "sign-out") onSignOut();
        else location.href = "/login/";
      });
    }
  }

  function renderStats() {
    var box = $("stats-list");
    if (!box) return;
    var all = window.Storage ? window.Storage.all() : {};
    var ids = Object.keys(all || {});
    var learned = 0, due = 0, masterySum = 0;
    ids.forEach(function (pid) {
      var rec = all[pid];
      if (!rec) return;
      if (window.Scheduler) {
        if (Scheduler.isLearned(rec)) learned += 1;
        if (Scheduler.isDue(rec)) due += 1;
        masterySum += Scheduler.mastery(rec);
      }
    });
    var avg = learned ? Math.round(masterySum / learned) : 0;
    var rows = [
      ["有记录篇目", ids.length + " 篇"],
      ["已开始记忆", learned + " 篇"],
      ["今日到期", due + " 篇"]
    ];
    if (learned) rows.push(["平均掌握度", avg + "%"]);
    box.innerHTML = rows.map(function (r) {
      return '<div class="kv-row"><span class="kv-k">' + esc(r[0]) +
        '</span><span class="kv-v">' + esc(r[1]) + "</span></div>";
    }).join("");
  }

    function renderSignedIn(sess) {
    var id = identity();
    if (!id || !id.signedIn) {
      hide($("btn-delete-start"));
      hide($("btn-go-admin"));
      renderBottomActions();
      return;
    }
    show($("btn-delete-start"));
    renderAdmin(id);
    renderBottomActions();
  }

    function renderVerifyState() {
    var row = $("verify-row");
    if (!row) return;
    var id = identity();
    var info = acct() && acct().account ? acct().account() : null;
    if (!id || !id.signedIn || !info || info.emailVerified) { hide(row); return; }
    var el = $("verify-state");

    var ch = acct() && acct().channel ? acct().channel() : null;
    var gated = ch && ch.emailGate === true;
    var deliverable = ch && ch.emailDeliverable === true;
    if (el) {
      if (gated && !deliverable) {
        el.textContent = "邮箱尚未验证，验证邮件未能发出，请点击下方按钮重新发送。";
      } else if (gated) {
        el.textContent = "邮箱尚未验证。";
      } else {
        el.textContent = "邮箱尚未验证，验证后可用于找回密码。";
      }
    }
    show(row);
  }

  function onResendVerify() {
    var btn = $("btn-resend-verify");
    var el = $("verify-state");
    var M = acct();
    if (!M || typeof M.resendVerification !== "function") {
      if (el) el.textContent = "页面已更新，请刷新后重试。";
      return;
    }
    if (btn) btn.disabled = true;
    M.resendVerification().then(function (r) {
      if (btn) btn.disabled = false;
      if (!r.ok) { if (el) el.textContent = r.message || "发送失败，请稍后再试。"; return; }
      if (r.alreadyVerified) {
        if (el) el.textContent = "该邮箱已验证。";
        if (btn) btn.disabled = true;
        return;
      }
      if (el) {
        el.textContent = r.verifySent
          ? "验证邮件已发送至 " + (r.email || identityEmail() || "你的邮箱") + "。"
          : "邮件发送失败，请稍后再试。";
      }
      showToast(r.verifySent ? "验证邮件已发送" : "发送失败");
    }, function () {
      if (btn) btn.disabled = false;
      if (el) el.textContent = "无法连接服务器，请稍后再试。";
    });
  }

    function renderAdmin(id) {
    var btn = $("btn-go-admin");
    if (!btn) return;
        if (!id || !id.signedIn) {
      hide(btn);
      renderBottomActions();
      return;
    }
    var owner = Ent.isOwner(backing, { role: id.role, uid: id.uid });
    if (owner && id && id.signedIn) show(btn); else hide(btn);
    renderBottomActions();
  }

  function renderBottomActions() {
    var row = $("bottom-actions");
    if (!row) return;
    var any = false;
    Array.prototype.forEach.call(row.children, function (el) {
      if (!el.hidden) any = true;
    });
    if (any) show(row); else hide(row);
  }

  // 报告 / 反馈有进展：badge + 一次性 toast（点开对应那一页即视为看过）。
  function checkProgressUpdates() {
    var R = window.Report, F = window.Feedback;

    var reportP = (R && typeof R.mine === "function")
      ? R.mine().then(function (r) { return R.pendingUpdates((r && r.reports) || []); })["catch"](function () { return []; })
      : Promise.resolve([]);
    var feedbackP = (F && typeof F.mine === "function")
      ? F.mine().then(function (r) { return F.pendingUpdates((r && r.threads) || []); })["catch"](function () { return []; })
      : Promise.resolve([]);

    Promise.all([reportP, feedbackP]).then(function (pair) {
      var reportPend = pair[0] || [], feedbackPend = pair[1] || [];
      var dotR = $("dot-reports");
      if (dotR) dotR.hidden = !reportPend.length;
      var dotF = $("dot-feedback");
      if (dotF) dotF.hidden = !feedbackPend.length;

      var notes = [];
      if (reportPend.length) notes.push(reportPend.length + " 条报告有进展");
      if (feedbackPend.length) notes.push(feedbackPend.length + " 条反馈有回复");
      if (notes.length) showToast(notes.join("，") + "，点开看看");
    });
  }

  function renderDanger() {
    var id = identity();
    var on = !!(id && id.signedIn);
    var row = $("bottom-actions");
    if (row && !on) {
      hide($("btn-delete-start"));
      hide($("btn-go-admin"));
      renderBottomActions();
    }
    if (!on) {
      hide($("danger-panel"));
      hide($("delete-step-1"));
      hide($("delete-step-2"));
    }
  }

    function onSignOut() {
    var r = A.signOut(store);
    if (!r.ok) return;
    try { if (window.SyncStore && window.SyncStore.forget) window.SyncStore.forget(); } catch (e) { }

    var M = acct();
    var wait = M && M.signOut
      ? Promise.resolve(M.signOut({ backing: backing, E: Ent, A: A }))
      : Promise.resolve(null);

        paint(A.session(store));
    showToast("已退出登录，本机进度保留");

    wait.then(function () {
            paint(A.session(store));
      renderIdentity(identity());
    })["catch"](function () { });
  }

  function deletePanelOpen() {
    var p = $("danger-panel");
    return !!(p && !p.hasAttribute("hidden"));
  }

  function onDelete(open) {
    var want = open === undefined ? !deletePanelOpen() : !!open;
    var btn = $("btn-delete-start");
    if (btn) btn.setAttribute("aria-expanded", want ? "true" : "false");

    if (!want) {
      onDeleteCancel();
      hide($("danger-panel"));
      return;
    }

    show($("danger-panel"));
    show($("delete-step-1"));
    hide($("delete-step-2"));
    var ask = $("btn-delete-ask");
    if (ask) ask.focus();
  }

  function onDeleteStart() {
    show($("danger-panel"));
    hide($("delete-step-1"));
    show($("delete-step-2"));
    var el = $("input-delete-email");
    if (el) el.focus();
  }

  function onDeleteCancel() {
    hide($("delete-step-2"));
    show($("delete-step-1"));
    var el = $("input-delete-email");
    if (el) el.value = "";
    var m = $("msg-delete");
    if (m) { m.textContent = ""; m.className = "account-msg"; }
  }

  function onDeleteConfirm() {
    var el = $("input-delete-email");
    var v = (el && el.value ? el.value : "").trim();
    var msg = $("msg-delete");
    var btn = $("btn-delete-confirm");
    if (btn) btn.disabled = true;
    if (msg) { msg.textContent = "正在注销……"; msg.className = "account-msg"; }

    var M = acct();
    var p = M
      ? M.deleteAccount({ email: v, confirm: true, backing: backing, A: A, E: Ent })
      : Promise.resolve(localOnlyDelete(v));

    Promise.resolve(p).then(function (r) {
      if (btn) btn.disabled = false;
      if (!r.ok) {
        if (msg) { msg.textContent = r.message || "注销失败，请刷新页面后重试"; msg.className = "account-msg warn"; }
        return;
      }
      afterDeleted(r, msg);
    })["catch"](function () {
      if (btn) btn.disabled = false;
      if (msg) { msg.textContent = "注销失败，请刷新页面后重试"; msg.className = "account-msg warn"; }
    });
  }

  function localOnlyDelete(email) {
    var r = A.deleteAccount(store, email);
    return { ok: r.ok, remote: "none", message: r.message };
  }

  function afterDeleted(r, msg) {
    var box = $("delete-export"), btn = $("btn-delete-export");
    if (box && btn && r.export) {
      show(box);
      btn.onclick = function () { downloadCloudExport(r.export); };
    } else if (box) {
      hide(box);
    }

    var line;
    if (r.remote === "deleted") {
      line = "账号及云端进度已删除，备份已导出；本机进度保留。";
    } else if (r.remote === "skipped") {
      line = "已在本机退出账号，但未能连接服务器，云端数据仍在。请联网后重试。";
    } else {
      line = "账号已注销；本机进度保留。";
    }
    if (msg) { msg.textContent = line; msg.className = "account-msg " + (r.remote === "skipped" ? "warn" : "ok"); }
    showToast(r.remote === "skipped" ? "云端数据未删除，请联网后重试" : "账号已注销");
    renderDanger();
    if (r.remote === "skipped") return;
    setTimeout(function () { paint(A.session(store)); }, 900);
  }

  function downloadCloudExport(data) {
    var text = JSON.stringify(data, null, 2);
    try {
      var blob = new Blob([text], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "跬步-云端数据-" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      showToast("当前浏览器不支持直接下载文件");
    }
  }

  var nicknameTimer = null;

  function commitNickname(value) {
    var v = String(value == null ? "" : value).trim().slice(0, 12);
    var P = window.ProgressStore;

    if (P && typeof P.saveUsername === "function") {
      P.saveUsername(v);
    } else if (P && typeof P.patch === "function") {
      P.patch({ username: v });
    }
    var Av = window.Avatar;
    if (Av && typeof Av.saveNickname === "function") {
      try { Av.saveNickname(backing, v); } catch (e) { }
    }
  }

  window.__mineSyncNickname = function () {
    var input = $("input-nickname");
    if (!input) return;
    var d = window.Avatar ? Avatar.display(backing) : { nickname: "" };
    input.value = String((d && d.nickname) || "");
    renderIdentity(identity());
  };

  function nicknameValue() {
    var d = window.Avatar ? Avatar.display(backing) : { nickname: "" };
    return String((d && d.nickname) || "");
  }

  function renderNickname() {
    var input = $("input-nickname");
    if (!input) return;
    if (document.activeElement === input) return;
    input.value = nicknameValue();
  }

  function chromeRefresh() {
    if (window.SiteChrome && window.SiteChrome.refreshUser) window.SiteChrome.refreshUser();
  }

  function observerApi() {
    var O = window.MutationObserver || window.WebKitMutationObserver;
    return typeof O === "function" ? O : null;
  }

  function observerApi() {
    var O = window.MutationObserver || window.WebKitMutationObserver;
    return typeof O === "function" ? O : null;
  }

  function watchDockAvatar() {

    var O = observerApi();

    if (!O || document.querySelector("#site-dock .dock-icon")) return;
    var body = document.body;
    if (!body) return;
    var guard = null;
    guard = new O(function () {
      if (!document.querySelector("#site-dock .dock-icon")) return;
      guard.disconnect();
      guard = null;
      watchAvatar();
    });
    guard.observe(body, { childList: true, subtree: true });
  }

  function watchAvatar() {

    var slot = document.querySelector("#site-dock .dock-icon");
    if (slot) {

      var O = observerApi();
      if (O) new O(chromeRefresh).observe(slot, { childList: true, subtree: true });
    }
    watchProfile();
  }

  function watchProfile() {
    var O = observerApi();
    if (!O || !window.Avatar) return;
    var A = window.Avatar;
    var snap = function () {
      try { return JSON.stringify(A.display(backing)); } catch (e) { return ""; }
    };
    var prev = snap();
    var timer = null;
    new O(function () {
      var now = snap();
      if (now === prev) return;
      prev = now;
      clearTimeout(timer);
      timer = setTimeout(chromeRefresh, 0);
    }).observe(document.documentElement, {
      subtree: true, childList: true, attributes: true, attributeFilter: ["src"]
    });
  }

  function saveNickname() {
    var input = $("input-nickname");
    if (!input) return;
    commitNickname(input.value);
    var clean = nicknameValue();
    input.value = clean;

    if (window.FamilyUi && window.FamilyUi.render) window.FamilyUi.render();
    if (window.AvatarEdit) window.AvatarEdit.render();
    if (window.SiteChrome && window.SiteChrome.refreshUser) window.SiteChrome.refreshUser();
    renderIdentity(identity());
  }

  function bindNickname() {
    var input = $("input-nickname");
    if (!input || input.dataset.bound) return;
    input.dataset.bound = "1";

    input.addEventListener("input", function () {
      commitNickname(input.value);
      if (window.AvatarEdit) window.AvatarEdit.render();
      clearTimeout(nicknameTimer);
      nicknameTimer = setTimeout(function () {
        if (window.SiteChrome && window.SiteChrome.refreshUser) window.SiteChrome.refreshUser();
        renderIdentity(identity());
      }, 300);
    });
    input.addEventListener("change", function () {
      clearTimeout(nicknameTimer);
      saveNickname();
    });
    input.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      saveNickname();
      input.blur();
    });
    input.addEventListener("blur", function () {

      if (input.value !== nicknameValue()) saveNickname();
      else input.value = nicknameValue();
    });
  }

  function paint(sess) {
    var id = identity();
    if (!id) return;
        renderIdentity(id);
    renderAdmin(id);
    paintEmailToggle();
    renderStats();
    renderSignedIn(sess);
    renderVerifyState();
    renderNickname();
    renderSync();
    renderBottomActions();
  }

  function init() {
    if (!A || !Ent || !store) return;

    var resend = $("btn-resend-verify");
    if (resend) resend.addEventListener("click", onResendVerify);
    var dStart = $("btn-delete-start");
    if (dStart) {
      dStart.setAttribute("aria-expanded", "false");
      dStart.addEventListener("click", function () { onDelete(); });
    }
    var dAsk = $("btn-delete-ask");
    if (dAsk) dAsk.addEventListener("click", onDeleteStart);
    var dCancel = $("btn-delete-cancel");
    if (dCancel) dCancel.addEventListener("click", onDeleteCancel);
    var dConfirm = $("btn-delete-confirm");
    if (dConfirm) dConfirm.addEventListener("click", onDeleteConfirm);

    var syncToggle = $("toggle-sync");
    if (syncToggle) syncToggle.addEventListener("change", onToggleSync);
    var keepLocal = $("btn-keep-local");
    if (keepLocal) keepLocal.addEventListener("click", function () { onResolve("keepLocal"); });
    var keepRemote = $("btn-keep-remote");
    if (keepRemote) keepRemote.addEventListener("click", function () { onResolve("keepRemote"); });
    var exportFirst = $("btn-export-first");
    if (exportFirst) exportFirst.addEventListener("click", function () { onResolve("exportFirst"); });

    bindNickname();
    if (document.querySelector("#site-dock .dock-icon")) {
      watchAvatar();
    } else {
      watchDockAvatar();
      document.addEventListener("chrome:ready", function () {
        watchAvatar();
        chromeRefresh();
      }, { once: true });
    }
    paint(A.session(store));
    checkProgressUpdates();

    var M = acct();
    if (M) {
      Promise.resolve(M.refreshMe({ backing: backing, A: A, E: Ent })).then(function (r) {
        if (!r || !r.ok) return;
                paint(A.session(store));
      })["catch"](function () { });
    }

    window.addEventListener("storage", function () { paint(A.session(store)); });
        document.addEventListener("account:ready", function () { paint(A.session(store)); });
    document.addEventListener("entitlementchange", function () { paint(A.session(store)); });

    function onFamilyChange() { paint(A.session(store)); }
    window.addEventListener("family-change", onFamilyChange);
    document.addEventListener("family-change", onFamilyChange);
  }

  var inited = false;

  function boot() {
    if (inited) return;
    inited = true;
    init();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  function syncMod() { return window.SyncStore || null; }

  function renderSync() {
    var input = $("toggle-sync");
    if (!input) return;
    var S = syncMod();

    if (!S) {
      input.disabled = true;
      hide($("sync-conflict"));
      return;
    }

    var st = S.status();
    var on = S.enabled();
    var n = S.conflicts().length;
    input.checked = on;

    input.disabled = (st === "unavailable");

    renderConflict(S, !!sess());
  }

  function onToggleSync() {
    var input = $("toggle-sync");
    var S = syncMod();
    if (!input || !S) return;
    var r = S.setEnabled(input.checked);
    if (!r || !r.ok) {
      input.checked = !!S.enabled();
      showToast(r && r.code === "E_TIER"
        ? (r.hint || "跨设备同步需 Pro 及以上")
        : "浏览器未能保存设置，请重试");
      renderSync();
      return;
    }
    renderSync();
    if (input.checked) {

      try {
        var first = S.firstSync();
        if (first && first.then) first.then(function () { renderSync(); }, function () {  });
      } catch (e) {  }
      showToast(S.status() === "signin" ? "已开启，登录后开始同步" : "已开启跨设备同步");
    } else {
      showToast("已关闭同步，进度仍保存在本机");
    }
  }

    function sess() {
    var ok = false;
    try { ok = !!(Ent && Ent.cookieSession && Ent.cookieSession({ backing: backing })); } catch (e) { ok = false; }
    return ok ? {} : null;
  }

  function renderConflict(S, signedIn) {
    var box = $("sync-conflict");
    var lead = $("conflict-lead");
    if (!box) return;
    var list = S.conflicts();
    if (!list.length) { hide(box); return; }

    var localCount = 0;
    try { localCount = Object.keys(window.ProgressStore.all() || {}).length; } catch (e) { localCount = 0; }
    if (lead) {
      lead.textContent = "这 " + list.length + " 篇在本机和云端都有修改，请选择保留哪一份（本机共 " + localCount + " 篇）。" +
        (signedIn ? "" : "请先登录。");
    }
    show(box);
  }

  function onResolve(mode) {
    var S = syncMod();
    var msg = $("msg-conflict");
    if (!S) return;
    var r = S.resolveConflict(mode);
    if (!r || !r.ok) {
      if (msg) { msg.textContent = (r && r.message) || "操作未完成，请重试"; msg.className = "account-msg warn"; }
      return;
    }
    if (mode === "exportFirst") {

      var text = JSON.stringify(r.backup || {}, null, 2);
      try {
        var blob = new Blob([text], { type: "application/json" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "跬步-同步快照-" + new Date().toISOString().slice(0, 10) + ".json";
        a.click();
        URL.revokeObjectURL(a.href);
        if (msg) { msg.textContent = "备份已导出，冲突尚未处理，请稍后选择。"; msg.className = "account-msg"; }
      } catch (e) {
        if (msg) { msg.textContent = "当前浏览器不支持直接下载，请在「设置 · 通用」中导出备份。"; msg.className = "account-msg warn"; }
      }
      return;
    }
    renderSync();
    showToast(mode === "keepLocal" ? "已保留本机进度，稍后同步到云端" : "已保留云端进度");
  }

  window.MinePage = { paint: paint, esc: esc, renderSync: renderSync };
})();
