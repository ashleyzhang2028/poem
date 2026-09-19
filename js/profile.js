(function () {
  "use strict";

  var A = window.AuthCore;
  var Ent = window.Entitlement;

  function acct() { return window.AccountApi || null; }

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

  function renderIdentity(id) {
    var row = $("identity-row");
    if (!row) return;
    var d = window.Avatar ? Avatar.display(backing) : { char: "诗", nickname: "", isDefaultName: true, hasImage: false };
    var name = d.nickname || (d.isDefaultName ? "未起名" : d.nickname);
    var badge = '<span class="tier-badge tier-' + esc(id.tier) + '">' + esc(Ent.tierLabel(id.tier)) + "</span>";
    var sub = id.signedIn
      ? "已登录 · " + esc(id.mask || "（无邮箱）")
      : "本机游客 · 未登录";
    row.innerHTML =
      (window.Avatar ? Avatar.html(backing) : "") +
      '<span class="identity-main">' +
      '<p class="identity-name">' + esc(name) + "</p>" +
      '<span class="identity-sub">' + sub + "</span>" +
      "</span>" + badge;

    var hint = $("identity-hint");
    if (hint) {
      hint.hidden = !id.signedIn;
      hint.textContent = id.signedIn ? "层级" + tierSourceLine(id) + "。" : "";
    }

    renderAccountEntry(id);
  }

  function renderAccountEntry(id) {
    var btn = $("btn-account-entry");
    if (!btn) return;
    var out = $("btn-sign-out");
    var hint = $("signout-hint");

    btn.textContent = id.signedIn ? "管理登录状态" : "登录";
    btn.addEventListener("click", function () { location.href = "/login/"; });

    if (out) out.hidden = !id.signedIn;
    if (hint) hint.hidden = !id.signedIn;

  }

  function renderStats() {
    var box = $("stats-list");
    if (!box) return;
    var all = window.Storage ? window.Storage.all() : {};
    var ids = Object.keys(all || {});
    var learned = 0, due = 0, masterySum = 0;
    ids.forEach(function (id) {
      var rec = all[id];
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

  function renderAccount(sess) {
    var list = $("account-list");
    if (!list) return;
    if (!sess || !sess.account) { hide(list); hide($("danger-card")); hide($("verify-row")); return; }
    var acc = sess.account;
    var days = Math.max(0, Math.round((sess.exp - Date.now()) / 86400000));

    var info = acct() && acct().account ? acct().account() : null;
    var email = (info && info.email) ? info.email
      : (acc.identities[0] ? acc.identities[0].mask : "（无邮箱）");
    var rows = [
      ["账号", email],
      ["本次登录", "还剩 " + days + " 天"]
    ];
    list.innerHTML = rows.map(function (r) {
      return '<div class="kv-row"><span class="kv-k">' + esc(r[0]) +
        '</span><span class="kv-v">' + esc(r[1]) + "</span></div>";
    }).join("");
    show(list);
    show($("danger-card"));
    renderVerifyState(info);
  }

  function renderVerifyState(info) {
    var row = $("verify-row");
    if (!row) return;
    if (!info || info.emailVerified) { hide(row); return; }
    var el = $("verify-state");

    var ch = acct() && acct().channel ? acct().channel() : null;
    var gated = ch && ch.emailGate === true;
    var deliverable = ch && ch.emailDeliverable === true;
    if (el) {
      if (gated && !deliverable) {
        el.textContent = "邮箱还没确认。这台服务器现在是**要求确认后才能登录**的，但它没能把确认邮件发出去（发信商还没配好）——点下面那颗重发试试，或者让站长先把发信商配好。";
      } else if (gated) {
        el.textContent = "邮箱还没确认。默认口径是「确认之后才能登录」；你能站在这里，说明这台服务器当前**没有**拦它。";
      } else {
        el.textContent = "邮箱还没确认。这台服务器**没有**拦「没确认就不让登录」，确认只影响将来找回密码。";
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
          ? "确认邮件已发往 " + (r.emailMask || "你的邮箱") + "。"
          : "这台服务器现在没能把邮件发出去（已试 " + (Number(r.verifyAttempts) || 1)
            + " 次）。稍后再试，或联系管理员。";
      }
      showToast(r.verifySent ? "确认邮件已发出" : "没能发出去");
    }, function () {
      if (btn) btn.disabled = false;
      if (el) el.textContent = "连不上服务器，请稍后再试。";
    });
  }

  function tierSourceLine(id) {
    return id && id.tierSource === "server" ? "由服务器判定" : "本机登记";
  }

  function renderAdmin(id) {

    var btn = $("btn-go-admin");
    if (!btn) return;
    if (Ent.isOwner(backing)) {

      Ent.markOwner(backing);
      show(btn);
    } else {
      hide(btn);
    }
  }

  function onSignOut() {
    var r = A.signOut(store);
    if (r.ok) {
      showToast("已退出登录（进度没动）");
      location.href = "/mine/";
    }
  }

  function onDeleteStart() {
    show($("delete-step-2"));
    hide($("delete-step-1"));
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
    if (msg) { msg.textContent = "正在注销……", msg.className = "account-msg"; }

    var M = acct();
    var p = M
      ? M.deleteAccount({ email: v, confirm: true, backing: backing, A: A, E: Ent })
      : Promise.resolve(localOnlyDelete(v));

    Promise.resolve(p).then(function (r) {
      if (btn) btn.disabled = false;
      if (!r.ok) {
        if (msg) { msg.textContent = r.message || "注销没成功，请刷新页面重试", msg.className = "account-msg warn"; }
        return;
      }
      afterDeleted(r, msg);
    })["catch"](function () {
      if (btn) btn.disabled = false;
      if (msg) { msg.textContent = "注销没成功，请刷新页面重试", msg.className = "account-msg warn"; }
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
      line = "账号已注销：账号与云端进度都已在服务器上删除，那一份已导出给你。" +
        "这台设备上的背诵进度仍在。";
    } else if (r.remote === "skipped") {
      line = "本机账号已注销。但没连上服务器，云端那一份还在 —— " +
        "网络恢复后再注销一次，或在服务器上删除。";
    } else {
      line = "账号已注销。这台设备上的背诵进度仍在。";
    }
    if (msg) { msg.textContent = line, msg.className = "account-msg " + (r.remote === "skipped" ? "warn" : "ok"); }
    showToast(r.remote === "skipped" ? "已注销本机账号；云端那一份没删掉" : "账号已注销，背诵进度仍在");
    if (r.remote === "skipped") return;
    setTimeout(function () { location.href = "/mine/"; }, 1400);
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

  function renderCacheInfo() {
    var el = $("about-cache");
    if (!el) return;

    var meta = document.querySelector('meta[name="kuibu-cache"]');
    el.textContent = meta ? meta.getAttribute("content") : "已离线就绪";
  }

  function paint(sess) {
    var id = Ent.identity({ backing: backing, authStore: store });
    renderIdentity(id);
    renderStats();
    renderAccount(sess);
    renderSync();
    renderAdmin(id);
    renderCacheInfo();
  }

  function init() {
    if (!A || !Ent || !store) return;

    $("btn-sign-out").addEventListener("click", onSignOut);
    $("btn-resend-verify").addEventListener("click", onResendVerify);
    var sess = A.session(store);
    paint(sess);

    var M = acct();
    if (M && sess) {
      Promise.resolve(M.refreshMe({ backing: backing, A: A, E: Ent })).then(function (r) {

        if (!r || !r.ok) return;
        paint(A.session(store));
      })["catch"](function () {  });
    }

    $("btn-go-admin").addEventListener("click", function () { location.href = "/admin/"; });
    $("btn-delete-start").addEventListener("click", onDeleteStart);
    $("btn-delete-cancel").addEventListener("click", onDeleteCancel);
    $("btn-delete-confirm").addEventListener("click", onDeleteConfirm);

    $("toggle-sync").addEventListener("change", onToggleSync);
    $("btn-keep-local").addEventListener("click", function () { onResolve("keepLocal"); });
    $("btn-keep-remote").addEventListener("click", function () { onResolve("keepRemote"); });
    $("btn-export-first").addEventListener("click", function () { onResolve("exportFirst"); });
  }

  function syncMod() { return window.SyncStore || null; }

  function renderSync() {
    var input = $("toggle-sync");
    var hint = $("sync-hint");
    if (!input || !hint) return;
    var S = syncMod();

    if (!S) {
      input.disabled = true;
      hint.textContent = "同步层没加载成功，刷新页面重试（背诵不受影响）。";
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
            : "开启中：进度、账号设置、自选集合、集子已读、今日加背、头像都会同步；本机那份始终完整，断网照常背。";

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
    try { return A && A.session ? A.session(store) : null; } catch (e) { return null; }
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
      lead.textContent = "有 " + list.length + " 篇两边都改过，判不出该听谁的，未自动合并。" +
        "本机共 " + localCount + " 篇。" +
        (signedIn ? "" : "请先登录再选。") +
        "选「保留账号」前会先在本机留一份快照。";
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.ProfilePage = { renderSync: renderSync, esc: esc };
})();
