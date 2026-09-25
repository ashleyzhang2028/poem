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
      // ⚠️ **两行**（用户 2026-09-25，Issue #276 第九轮）：
      //    第一行 = 头像 + 昵称 + 身份（层级徽章）；
      //    第二行 = 「登录 / 退出登录」+「上传 / 更新头像」这两颗键。
      //    用户原话：「更新头像和登录按钮放到下面一行吧 怎么放到头像和昵称
      //    中间呢？！？」—— 上一轮把它们塞进了**同一行**（昵称列左边是头像、
      //    右边紧跟着两颗键），看下来就是「按钮跑到了头像与昵称中间」。
      //    ⚠️ 所以这一行**不许**再往第一行塞键：两行是结构，不是「装不下才折」。
      //       第一行只用 flex 让位（装不下收昵称列），绝不折；
      //       第二行允许折（两颗键各占一行），但那已经是 ≥300px 才发生的事。
      //    ⚠️ 次序也按人话写：徽章紧跟昵称（「我是谁 + 我在哪一层」是一句
      //       完整的自我介绍），键单独一行摆在它下面。
      '<div class="identity-head">' +
      '<span id="avatar-slot" class="avatar-slot">' +
      (window.Avatar ? Avatar.html(backing) : "") + "</span>" +
      '<span class="identity-main">' +
      '<label class="sr-only" for="input-nickname">用户名</label>' +
      // ⚠️ `size="1"` 不是装饰（Issue #276 第八轮）：`<input>` 的默认宽度来自
      //    `size` 属性（缺省 20 个字符 ≈ 186px），而那个宽度是它的
      //    **min-content 下限** —— 于是外面怎么设 `min-width: 0` 都收不动它。
      //    写成 `size="1"` 之后，输入框的直觉宽度交给 CSS 管（我们本来就
      //    用 max-width 给了 9.5em 那一段），min-content 才真的能收到 0。
      '<input id="input-nickname" class="nickname-input" type="text" maxlength="12"' +
      ' size="1" placeholder="起个名字" autocomplete="off" enterkeyhint="done" />' +
      '<span class="identity-sub" id="identity-sub"></span>' +
      "</span>" +
      '<span class="tier-badge" id="identity-badge"></span>' +
      "</div>" +
      // ⚠️ 第二行（.identity-btns）放**两颗键**，次序 = 登录在前、头像键在后：
      //    ①「登录 / 退出登录」—— **一颗键、两个文案、两件事**。没登录时说
      //       「登录」（去 /login/），登录着时说「退出登录」（当场退出这一份
      //       账号）。用户 2026-09-24 问的正是这一条：「登录按钮和退出登录
      //       按钮应该同时显示吗？他们应该是一个按钮两个状态吧？」—— 是。
      //    ②「上传头像 / 更新头像」—— 也是**同一颗键的两个文案**，判据是
      //       「本机有没有图」，文案只由 js/avatar-edit.js 的 render 一处定。
      //    ⚠️ 「删除头像」不在这里：**没图时它压根不该出现**，而有图那一半的
      //       唯一入口是「更新头像」点进去的裁切层 —— 它就住在那儿
      //       （见 mine/index.html 的 #btn-crop-clear），不占这一行一格。
      '<div class="identity-btns" id="identity-btns">' +
      '<button class="account-btn" id="btn-account-entry" type="button">登录</button>' +
      '<button class="account-btn ghost" id="btn-avatar-pick" type="button">上传头像</button>' +
      "</div>" +
      // ⚠️ 「账号」那颗（去 /login/ 看「我是谁」）**不在这一行**：它搬进下面
      //    「账号」卡（#account-card-actions，与「重发确认邮件」同处）。
      "";
    bindNickname();
    // ⚠️ 这里**必须**把「上传 / 更新头像」那颗键的文案补一次（Issue #276 第八轮）。
    //    原因：上面那段 HTML 里那颗键的**出厂文案写死成「上传头像」**，
    //    而「有图时它该叫更新头像」这件事只有 js/avatar-edit.js 的 render
    //    知道（它读 Avatar.display().hasImage）。第二行是**按需重画**的：
    //    重画一次就把那颗键换成一个新节点、文案回到出厂那一份 ——
    //    于是「这台设备本来就传过头像」的人打开这一页，看到的仍然是
    //    「上传头像」（实测：本机有图 + 刷新页面 → 那颗键写「上传头像」，
    //    而槽里明明画着头像）。
    //    ⚠️ 这一行是**转发**，不是第二个判据：文案与绑定仍只由
    //       js/avatar-edit.js 一处写。这里负责的只是「画完之后叫它一次」。
    if (window.AvatarEdit && window.AvatarEdit.render) window.AvatarEdit.render();
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

    // ⚠️ 这里原先还有一行「层级由服务器判定。/ 层级本机登记。」——
    //    结论就是旁边那枚徽章（Free / Pro / Max），「判定」这一步是内部实现，
    //    用户在这一页不需要知道，整行撤掉（挂载点一起走，不留空壳）。
    renderSignOut(id);
  }

  // ⚠️ 登录那一颗：**一颗键、两个文案、两件事**（Issue #276 第八轮）。
  //    用户原话：「登录按钮和退出登录按钮应该同时显示吗？他们应该是一个按钮
  //    两个状态吧？」—— 对。旧实现里「登录」去 /login/、「退出登录」留在
  //    账号卡，两颗键一直同时在页面上，用户要自己判断「我现在该点哪一颗」。
  //    现在一颗：没登录时说「登录」（去登录页），登录着时说「退出登录」
  //    （当场退出）。**任何时刻这一行上只有这一颗说得通**。
  //    ⚠️ 文案只在这**一处**写（旧实现里账号卡那颗由 CSS 的 order + :has()
  //       换位置，两态都要维护，必然漂）—— 现在 DOM 里就这一颗，没有第二处。
  //    ⚠️ 落点也跟着文案一起换，不许写死成 /login/：登录着的人点它要退出，
  //       不是再跳一次登录页。
  function renderSignOut(id) {
    var btn = $("btn-account-entry");
    if (!btn) return;
    btn.textContent = id.signedIn ? "退出登录" : "登录";
    btn.className = id.signedIn ? "account-btn ghost" : "account-btn";
    // ⚠️ 这颗键**永远画出来**（Issue #276：用户找不到登录入口了）。
    //    未登录时它就是这一页上唯一的登录入口，藏起来等于没有入口。
    btn.hidden = false;
    btn.dataset.action = id.signedIn ? "sign-out" : "sign-in";
    if (!btn.dataset.bound) {
      btn.dataset.bound = "1";
      // ⚠️ 监听器只绑一次，判据每次点击时**现读** dataset.action ——
      //    不这么写的话，第一帧绑的那个落点会被记死（登录之后点它仍然去登录页）。
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
      ["登录还有", days + " 天"]
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
          ? "确认邮件已发往 " + (r.emailMask || "你的邮箱") + "。"
          : "邮件没发出去（已试 " + (Number(r.verifyAttempts) || 1) + " 次），稍后再试。";
      }
      showToast(r.verifySent ? "确认邮件已发出" : "没能发出去");
    }, function () {
      if (btn) btn.disabled = false;
      if (el) el.textContent = "连不上服务器，请稍后再试。";
    });
  }

  // 管理后台入口（Issue #276）：**只认服务端下发的角色**（源头是数据库
  // `accounts.role`）。本机兜底已删 —— 未登录、或角色不够，这一颗就不画。
  // 与 /admin/ 的准入走同一个出口 `Entitlement.isOwner()`（不是各判各的）。
  //
  // ⚠️ 传参要带上 **uid**（Issue #276 后续）：`id.role` 只是「服务端说这台
  // 机器上最后登录的那位是 owner」，不带 uid 就分不清是不是**当前这位**。
  // 带上之后 `isOwner` 会核对缓存里那份答案的主人 —— 换了人登录，
  // 上一个人的管理员身份不再被继承（这正是「未登录 / 非管理员时那颗键
  // 压根不显示」的判据）。
  function renderAdmin(id) {
    var btn = $("btn-go-admin");
    if (!btn) return;
    var owner = Ent.isOwner(backing, id ? { role: id.role, uid: id.uid } : undefined);
    if (owner && id && id.signedIn) {
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
      line = "账号与云端进度都已删除，那一份已导出给你；本机背诵进度仍在。";
    } else if (r.remote === "skipped") {
      line = "本机账号已注销；没连上服务器，云端那一份还在 —— 联网后再注销一次。";
    } else {
      line = "账号已注销；本机背诵进度仍在。";
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
    // ⚠️ 设置域键名只在 js/progress-store.js 一处拼（saveUsername）。
    //    本页不再自己 setItem —— 那是第二处拼键名的地方，改键名时必漏一处。
    //    引擎不可用（老缓存 / 脚本顺序不对）时也照旧走它：saveUsername 自己
    //    有兜底那一支，兜底同样不把键名漏到页面里。
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
    renderStats();
    renderAccount(sess);
    renderNickname();
    renderSync();
    renderAdmin(id);
  }

  function init() {
    if (!A || !Ent || !store) return;

    // ⚠️ 这里原先给账号卡里那颗 #btn-sign-out 绑退出 —— 那一颗已经不存在了
    //    （退出并进身份行的 #btn-account-entry 一颗键，见 renderSignOut）。
    //    绑一颗页面上没有的键，只会是一条**永远不响**的死线。
    // 账号卡里那颗「账号与安全」：去 /login/ 看「我是谁」（改口令 / 换邮箱 /
    // 注销都在那一页的导航里）。它**不是**身份行上那颗「退出登录」——
    // 那颗管的是「我现在要不要退出」，这颗管的是「我的账号资料在哪」。
    var openAcct = $("btn-account-open");
    if (openAcct && !openAcct.dataset.bound) {
      openAcct.dataset.bound = "1";
      openAcct.addEventListener("click", function () { location.href = "/login/"; });
    }
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

  // ---- 跨设备同步（原先在 /profile/ 那一页，个人中心并入「我的」后搬到这里）----
  // ⚠️ 同步的唯一开关与唯一的裁决出口都只在这一处：`SyncStore`。
  //    本页只负责「把引擎的状态画出来」与「把用户的动作转给引擎」，
  //    不自己判登录与否、也不自己算层级（与 js/settings.js 同一条口径）。
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
            : "已开启：本机那份始终完整，断网照常背。";

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
