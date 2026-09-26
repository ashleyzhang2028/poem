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
      '<span class="tier-badge" id="identity-badge"></span>' +
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
      ["有记录的篇目", ids.length ? ids.length + " 篇" : "还没有"],
      ["已开始记忆", learned ? learned + " 篇" : "还没有"],
      ["今天到期", due ? due + " 篇" : "没有"]
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
    show($("btn-go-admin"));
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
        el.textContent = "邮箱还没确认；邮件也还没发出去（发信商没配好）。先点下面那颗重发。";
      } else if (gated) {
        el.textContent = "邮箱还没确认；这台服务器当前没有拦它。";
      } else {
        el.textContent = "邮箱还没确认；确认只影响将来找回密码。";
      }
    }
    show(row);
  }

  function onResendVerify() {
    var btn = $("btn-resend-verify");
    var el = $("verify-state");
    var M = acct();
    if (!M || typeof M.resendVerification !== "function") {
      if (el) el.textContent = "这个页面是旧缓存，刷新一下再试。";
      return;
    }
    if (btn) btn.disabled = true;
    M.resendVerification().then(function (r) {
      if (btn) btn.disabled = false;
      if (!r.ok) { if (el) el.textContent = r.message || "没能发出去，稍后再试。"; return; }
      if (r.alreadyVerified) {
        if (el) el.textContent = "这个邮箱已经确认过了。";
        if (btn) btn.disabled = true;
        return;
      }
      if (el) {
        el.textContent = r.verifySent
          ? "确认邮件已发往 " + (r.email || identityEmail() || "你的邮箱") + "。"
          : "邮件没发出去（已试 " + (Number(r.verifyAttempts) || 1) + " 次），稍后再试。";
      }
      showToast(r.verifySent ? "确认邮件已发出" : "没能发出去");
    }, function () {
      if (btn) btn.disabled = false;
      if (el) el.textContent = "连不上服务器，请稍后再试。";
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
    if (owner) show(btn); else hide(btn);
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
    showToast("已退出登录（进度没动）");

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
        if (msg) { msg.textContent = r.message || "注销没成功，请刷新页面重试"; msg.className = "account-msg warn"; }
        return;
      }
      afterDeleted(r, msg);
    })["catch"](function () {
      if (btn) btn.disabled = false;
      if (msg) { msg.textContent = "注销没成功，请刷新页面重试"; msg.className = "account-msg warn"; }
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
      line = "账号与云端进度都已删除，那一份已导出给你；本机背诵进度仍在。";
    } else if (r.remote === "skipped") {
      line = "本机账号已注销；没连上服务器，云端那一份还在 —— 联网后再注销一次。";
    } else {
      line = "账号已注销；本机背诵进度仍在。";
    }
    if (msg) { msg.textContent = line; msg.className = "account-msg " + (r.remote === "skipped" ? "warn" : "ok"); }
    showToast(r.remote === "skipped" ? "已注销本机账号；云端那一份没删掉" : "账号已注销，背诵进度仍在");
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
      showToast("这份浏览器不允许直接下载文件，请换个浏览器再来");
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
    var admin = $("btn-go-admin");
    if (admin) admin.addEventListener("click", function () { location.href = "/admin/"; });
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
    var hint = $("sync-hint");
    if (!input || !hint) return;
    var S = syncMod();

    if (!S) {
      input.disabled = true;
      hint.textContent = "同步层没加载出来，刷新页面重试。";
      hide($("sync-conflict"));
      return;
    }

    var st = S.status();
    var on = S.enabled();
    var n = S.conflicts().length;
    input.checked = on;

    input.disabled = (st === "unavailable");

    hint.textContent = n
      ? "有 " + n + " 篇需要你选一下（下面），选完之前不会自动合并。"
      : st === "unavailable"
      ? "本站未开放同步，进度只存本机。"
      : st === "tier"
        ? "跨设备云同步要 Pro 起（当前没到这一层）。进度仍在本机、一字不少。"
        : st === "off"
          ? ""
          : st === "signin"
            ? "已开启，登录后才会真的同步。"
            : "";

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
        ? (r.hint || "跨设备云同步要 Pro 起")
        : "浏览器不允许保存设置，这次改动没生效");
      renderSync();
      return;
    }
    renderSync();
    if (input.checked) {

      try {
        var first = S.firstSync();
        if (first && first.then) first.then(function () { renderSync(); }, function () {  });
      } catch (e) {  }
      showToast(S.status() === "signin" ? "已开启，登录后才会真的同步" : "已开启跨设备同步");
    } else {
      showToast("已关闭同步，进度仍在本机");
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
      lead.textContent = "这 " + list.length + " 篇两边都改过，需要你选一份（这边一共 " + localCount + " 篇）。" +
        (signedIn ? "" : "请先登录再选。");
    }
    show(box);
  }

  function onResolve(mode) {
    var S = syncMod();
    var msg = $("msg-conflict");
    if (!S) return;
    var r = S.resolveConflict(mode);
    if (!r || !r.ok) {
      if (msg) { msg.textContent = (r && r.message) || "没能完成这一步"; msg.className = "account-msg warn"; }
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
        if (msg) { msg.textContent = "快照已导出，冲突还没处理，你想好了再回来选。"; msg.className = "account-msg"; }
      } catch (e) {
        if (msg) { msg.textContent = "这份浏览器不允许直接下载文件，请到「设置 · 通用」用导出备份。"; msg.className = "account-msg warn"; }
      }
      return;
    }
    renderSync();
    showToast(mode === "keepLocal" ? "已按本机这一份处理，稍后会同步上去" : "已按账号这一份处理");
  }

  window.MinePage = { paint: paint, esc: esc, renderSync: renderSync };
})();
