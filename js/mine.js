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

  function buildIdentityRow(row) {
    row.innerHTML =
      '<span id="avatar-slot" class="avatar-slot">' +
      (window.Avatar ? Avatar.html(backing) : "") + "</span>" +
      '<span class="identity-main">' +
      '<label class="sr-only" for="input-nickname">用户名</label>' +
      '<input id="input-nickname" class="nickname-input" type="text" maxlength="12"' +
      ' placeholder="起个名字" autocomplete="off" enterkeyhint="done" />' +
      '<span class="identity-sub" id="identity-sub"></span>' +
      "</span>" +
      '<span class="tier-badge" id="identity-badge"></span>';
    bindNickname();
  }

  function renderIdentity(id) {
    var row = identityRow();
    if (!row || !id) return;
    if (!$("input-nickname")) buildIdentityRow(row);

    var slot = $("avatar-slot");
    if (slot) slot.innerHTML = window.Avatar ? Avatar.html(backing) : "";

    var sub = id.signedIn
      ? "已登录 · " + (id.mask || "（无邮箱）")
      : "游客";
    var subEl = $("identity-sub");
    if (subEl) subEl.textContent = sub;

    var badge = $("identity-badge");
    if (badge) {
      badge.className = "tier-badge tier-" + id.tier;
      badge.textContent = Ent.tierLabel(id.tier);
    }

    var input = $("input-nickname");
    if (input && document.activeElement !== input) input.value = nicknameValue();

    var hint = $("identity-hint");
    if (hint) {
      hint.hidden = !id.signedIn;
      hint.textContent = id.signedIn ? "层级" + tierSourceLine(id) + "。" : "";
    }

    renderSignOut(id);
  }

  function renderSignOut(id) {

    var btn = $("btn-account-entry");
    var out = $("btn-sign-out");
    var hint = $("signout-hint");
    if (btn) {
      btn.textContent = id.signedIn ? "管理登录状态" : "登录";
      if (!btn.dataset.bound) {
        btn.dataset.bound = "1";
        btn.addEventListener("click", function () { location.href = "/login/"; });
      }
    }
    if (out) out.hidden = !id.signedIn;
    if (hint) hint.hidden = !id.signedIn;
  }

  function tierSourceLine(id) {
    return id && id.tierSource === "server" ? "由服务器判定" : "本机登记";
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

  function renderAccount(sess) {
    var list = $("account-list");
    var danger = $("danger-card");
    if (!list) return;
    if (!sess || !sess.account) {
      hide($("account-card")); hide(danger); hide($("verify-row"));
      return;
    }
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
    show($("account-card"));
    show(danger);
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

  function renderAdmin(id) {
    var btn = $("btn-go-admin");
    if (!btn) return;
    var owner = Ent.isOwner(backing, id && id.role ? { role: id.role } : undefined);
    if (owner && id && id.signedIn) {
      Ent.markOwner(backing);
      show(btn);
    } else {
      hide(btn);
    }
  }

  function onSignOut() {
    var r = A.signOut(store);
    if (!r.ok) return;
    try { if (window.SyncStore && window.SyncStore.forget) window.SyncStore.forget(); } catch (e) { }
    try {
      var M = acct();
      if (M && M.clearServerTier) M.clearServerTier({ backing: backing, E: Ent });
    } catch (e) { }
    showToast("已退出登录（进度没动）");
    paint(A.session(store));
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
      line = "账号已注销：账号与云端进度都已在服务器上删除，那一份已导出给你。这台设备上的背诵进度仍在。";
    } else if (r.remote === "skipped") {
      line = "本机账号已注销。但没连上服务器，云端那一份还在 —— 网络恢复后再注销一次，或在服务器上删除。";
    } else {
      line = "账号已注销。这台设备上的背诵进度仍在。";
    }
    if (msg) { msg.textContent = line; msg.className = "account-msg " + (r.remote === "skipped" ? "warn" : "ok"); }
    showToast(r.remote === "skipped" ? "已注销本机账号；云端那一份没删掉" : "账号已注销，背诵进度仍在");
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
    if (P && typeof P.patch === "function") {
      P.patch({ username: v });
    } else {
      try {
        var raw = JSON.parse(backing.getItem("poem_recite_settings_v1") || "{}");
        raw.username = v;
        backing.setItem("poem_recite_settings_v1", JSON.stringify(raw));
      } catch (e) { }
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
    renderStats();
    renderAccount(sess);
    renderNickname();
    renderAdmin(id);
  }

  function init() {
    if (!A || !Ent || !store) return;

    var out = $("btn-sign-out");
    if (out) out.addEventListener("click", onSignOut);
    var resend = $("btn-resend-verify");
    if (resend) resend.addEventListener("click", onResendVerify);
    var admin = $("btn-go-admin");
    if (admin) admin.addEventListener("click", function () { location.href = "/admin/"; });
    var dStart = $("btn-delete-start");
    if (dStart) dStart.addEventListener("click", onDeleteStart);
    var dCancel = $("btn-delete-cancel");
    if (dCancel) dCancel.addEventListener("click", onDeleteCancel);
    var dConfirm = $("btn-delete-confirm");
    if (dConfirm) dConfirm.addEventListener("click", onDeleteConfirm);

    bindNickname();
    paint(A.session(store));

    var M = acct();
    var sess = A.session(store);
    if (M && sess) {
      Promise.resolve(M.refreshMe({ backing: backing, A: A, E: Ent })).then(function (r) {
        if (!r || !r.ok) return;
        paint(A.session(store));
      })["catch"](function () { });
    }

    window.addEventListener("storage", function () { paint(A.session(store)); });

    function onFamilyChange() { paint(A.session(store)); }
    window.addEventListener("family-change", onFamilyChange);
    document.addEventListener("family-change", onFamilyChange);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.MinePage = { paint: paint, esc: esc };
})();
