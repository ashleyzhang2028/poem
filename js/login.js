(function () {
  "use strict";

  var A = window.AuthCore;
  var Ent = window.Entitlement;

  var TS = window.Turnstile || null;

  var backing = null;
  try { backing = window.localStorage; } catch (e) { backing = null; }
  var store = A && A.makeStore ? A.makeStore(backing) : null;

  var api = (window.AuthApi && window.AuthApi.supported()) ? window.AuthApi.create({

    deviceId: (function () {
      try { return (store && store.read().deviceId) || ""; } catch (e) { return ""; }
    })()
  }) : null;

  function isLocal() { return !api || api.degraded(); }

  function passwordNeedsServer() {
    return isLocal();
  }

  var tsConfig = { enabled: false, siteKey: "" };

  var mailDelivered = null;

  var state = {
    purpose: "login",
    mode: "pw",
    codeId: "",
    code: "",
    sentTo: "",
    expiresAt: 0,
    cooldown: 0,
    tick: null,

    regEmail: ""
  };

  function $(id) { return document.getElementById(id); }

  function pending(button, busy, label) {
    if (!button) return;
    if (busy) {
      button.dataset.idleText = button.textContent;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      if (label) button.textContent = label;
      return;
    }
    button.disabled = false;
    button.removeAttribute("aria-busy");
    if (button.dataset.idleText) button.textContent = button.dataset.idleText;
  }

  function submitPending(buttonId, label, task) {
    var button = $(buttonId);
    if (!button || button.disabled) return Promise.resolve(null);
    pending(button, true, label);
    var result;
    try { result = task(); }
    catch (error) { pending(button, false); throw error; }
    if (!result || typeof result.then !== "function") {
      pending(button, false);
      return result;
    }
    return result.then(function (value) {
      pending(button, false);
      return value;
    }, function (error) {
      pending(button, false);
      throw error;
    });
  }
  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }
  function text(el, s) { if (el) el.textContent = s == null ? "" : String(s); }

  function mailOutcome(sent, masked) {
    if (mailDelivered === false) return mailNotConfiguredNote(masked);
    return sent;
  }

  function showToast(msg) {
    var t = $("toast");
    if (!t) return;
    t.textContent = msg;
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

  function note(id, s, level) {
    var el = $(id);
    if (!el) return;
    if (!s) { el.hidden = true; el.textContent = ""; return; }
    el.className = "account-note" + (level ? " " + level : "");
    el.textContent = String(s);
    el.hidden = false;
  }

  function mailNotConfiguredNote(masked) {
    void masked;
    return "验证邮件暂时无法发送，请稍后重试。如问题持续，请联系管理员。";
  }

  // 每一处挂载点：键是「屏」（js/login.js 的 mode），值那一路表单里的容器 id。
  //
  // ⚠️ `pw` 这一条是 Issue #278 第四轮加的（用户原话：「登录页面同样加上
  //    cloudflare 的验证」）。它**改掉了原来那条口径**——
  //    原先这里写的是「密码登录本来就不需要人机校验（服务端那一条路不校验）」，
  //    现在服务端也挂了（api/_lib/core.js 的 loginWithPassword），
  //    所以这一条不许再删：删了之后前端不画方框、服务端却要 token，
  //    症状就是**谁也别想用口令登进来**（400 E_TURNSTILE）。
  //    两处是**同一个开关的两半**：《js/turnstile.js》没配时前端不画、
  //    服务端也 skipped，所以没接 Cloudflare 的实例两半都安静。
  var TS_SLOTS = {
    pw: "ts-pw",
    code: "ts-code",
    register: "ts-reg",
    forgot: "ts-forgot",
    verify: "ts-verify",
    unverified: "ts-unverified"
  };

  // 挂载点有两处（Issue #276）：
  //   ① 页面打开时 preload 脚本（见下面的 preloadTurnstileScript）；
  //   ② 每次切屏（切到哪一屏就把方框挂到哪一屏）＋ 拿到 /api/config 之后补挂一次。
  // 都不是「用户点提交」那一刻 —— 用户 2026-09-21 报的正是「点完注册按钮，
  // 验证框才开始弹出来、还慢慢转圈」。那一整段等待（拉脚本最多 8 秒 + 渲染
  // widget + Cloudflare 判人机）必须提前到用户填表的时候跑完。
  function mountTurnstile(slotKey) {
    if (!TS || !TS.mount || !slotKey) return;
    var slotId = TS_SLOTS[slotKey];
    var el = slotId ? $(slotId) : null;
    if (!el) return;
    TS.mount(el, { siteKey: tsConfig.siteKey, enabled: tsConfig.enabled }).then(function (st) {
      // ⚠️ 这个 `.then` 是**异步**的（脚本在路上、widget 要等 Cloudflare 判人机），
      //    而用户在这几百毫秒里可能已经切到别的屏了。原来这里只判
      //    `st.configured` 就 `show(el)` —— 于是切走的那一屏的方框被**重新显形**：
      //    实测（Issue #278 第五轮，真浏览器点一遍）
      //      密码登录 → 快捷登录 → 注册 → 忘记密码
      //    走完四屏，页面上**四个 `ts-*` 槽位同时是可见的**（`hidden=false`），
      //    只有一个是真的画在当前屏上的。用户会看到方框跟着自己跑，
      //    或者提交时报「人机校验没通过」而他在当前屏上根本找不到那个方框。
      //
      //    判据是「这一屏还是当前那一屏吗」—— `state.mode` 就是那个答案
      //    （挂 pw 的槽位时 4 个 mode 里有 3 个都会命中，所以必须比对值）。
      //    切走的那一屏由 `setMode()` 的 `hide()` 收走即可。
      if (st && st.configured && state.mode === slotKey) show(el);
      turnstileBrokenNote(slotId);
    });
  }

  // 页面一打开，只要本站配了人机校验，就先把 Cloudflare 的脚本拉起来。
  // 这时还没拿到 siteKey（/api/config 与脚本是两条可以并行的请求），所以这里
  // 只负责「加载」脚本，渲染留给拿到 siteKey 之后的 mount。
  // 用户 2026-09-21 报的 Issue #276 就是这一段被推迟到了提交之后：脚本最多要
  // 8 秒，加上渲染 widget 与 Cloudflare 判人机，用户看到的就是「点完按钮，
  // 验证框才慢慢冒出来」。
  function preloadTurnstileScript() {
    if (!TS || !TS.preload) return;
    TS.preload();
  }

  function turnstileBrokenNote(slotId) {
    if (!TS || !TS.failed || !slotId) return;
    var note = $("ts-broken-" + slotId);
    if (!note) return;
    // ⚠️ 同样要判「还是当前那一屏」（理由与上面 `show(el)` 那一段同源）：
    //    否则用户在注册屏上会看到密码登录那一屏的红字 —— 与 Issue #276
    //    那条「切屏时把上一屏的失败提示收掉」是同一件事的两半。
    //    调用方 `turnstileBlocked()` 已经在当前屏上，所以那里传进来的
    //    slotId 一定就是当前那一屏，这一条不会误伤它。
    if (note.hidden && TS_SLOTS[state.mode] !== slotId) return;
    if (!TS.failed()) { hide(note); text(note, ""); return; }
    text(note, (TS.why ? TS.why() + " " : "") +
      "请刷新页面重试。如问题持续，请联系管理员。");
    show(note);
  }

  function turnstileBlocked(msgId) {
    if (!TS || !TS.gate) return false;
    var why = TS.gate();
    if (!why) return false;
    msg(msgId, why, "warn");
    if (TS.failed && TS.failed()) turnstileBrokenNote(TS_SLOTS[state.mode]);
    return true;
  }

  function turnstileHideNotes() {
    Object.keys(TS_SLOTS).forEach(function (k) {
      var note = $("ts-broken-" + TS_SLOTS[k]);
      if (note) { hide(note); text(note, ""); }
    });
  }

  function turnstileReset() {
    if (TS && TS.reset) { try { TS.reset(); } catch (e) {  } }
  }

  // 当前那一枚令牌（没配人机校验时恒为空串 —— 服务端那时也 skipped，两边对称）。
  // ⚠️ 走到提交这一刻才取，不在页面打开时取一次存着：widget 的
  //    `expired-callback` 会把令牌清掉（js/turnstile.js），存着的那一份
  //    就成了一个早就过期的值，而服务端只会回一句「人机校验没通过」。
  function turnstileToken() {
    if (!TS || !TS.token) return "";
    try { return TS.token() || ""; } catch (e) { return ""; }
  }

  var MODES = ["pw", "code", "register", "verify", "unverified", "forgot", "done"];
  function setMode(mode) {
    if (MODES.indexOf(mode) < 0) mode = "pw";
    state.mode = mode;

    var tabPw = $("tab-pw"), tabCode = $("tab-code");
    var isPw = mode === "pw" || mode === "register" || mode === "forgot";
    if (tabPw) tabPw.setAttribute("aria-selected", isPw ? "true" : "false");
    if (tabCode) tabCode.setAttribute("aria-selected", isPw ? "false" : "true");
    hide($("auth-tabs"));
    if (mode === "pw" || mode === "code") show($("auth-tabs"));

    // 「一屏」= 一个 pane（或 done / unverified 那两个 account-step）。
    // ⚠️ `pw` / `code` 这两屏**各自还有两个内层 step**（快捷登录的
    //    「填邮箱」与「填码」），所以切屏时要连内层一起复位 —— 否则用户从
    //    注册屏回到快捷登录屏，看到的还是上一次「已发码」那一屏。
    var panes = { pw: $("pane-pw"), code: $("pane-code"), register: $("pane-register"),
      verify: $("pane-verify"), forgot: $("pane-forgot") };
    Object.keys(panes).forEach(function (k) {
      var el = panes[k];
      if (!el) return;
      if (k === mode) show(el); else hide(el);
    });

    // ⚠️ 人机校验的槽位**不跟着 pane 走**：`ts-pw` 住在 `pane-pw` 里、
    //    `ts-reg` 住在 `pane-register` 里，而 pane 被 `hide()` 收走时
    //    槽位自己那一份 `hidden` 还留着 —— 于是「切走再切回来」或者
    //    「同一个槽位被 show() 过之后又切走」都会让它**在隐藏的 pane 里
    //    保持可见态**（实测：切到快捷登录后 `#ts-pw` 的 `hidden` 仍是 false）。
    //    它对外看不见（父级 hidden），但它会被 `mountTurnstile` 的返回值
    //    继续当成「已安装」，而用户切回来时看到的是上一次那份旧 widget。
    //
    //    所以：不在当前这一屏的槽位，一律先收掉；当前这一屏的槽位由
    //    `mountTurnstile` 在 widget 真的画出来之后再显形。
    Object.keys(TS_SLOTS).forEach(function (k) {
      var slot = $(TS_SLOTS[k]);
      if (slot && k !== mode) hide(slot);
    });

    if (mode === "done") show($("step-done")); else hide($("step-done"));
    if (mode === "unverified") show($("step-unverified")); else hide($("step-unverified"));
    if (mode === "code") { show($("step-email")); hide($("step-code")); }

    // 有 TS_SLOTS 的 mode 一共就这几个；切屏时把上一屏的失败提示收掉，
    // 免得「注册」那一屏的红字留在「登录」屏上。
    //
    // 顺带把方框挂到这一屏 —— 用户切过来的这一下就开始画了，不用等他点提交
    // （Issue #276）。TS_SLOTS 里没有的 mode（完成屏 / 未确认屏）会原样返回。
    // ⚠️ 密码登录那一屏**现在也在 TS_SLOTS 里**（Issue #278 第四轮）：
    //    服务端那条路挂上了人机校验，前端就得画出方框来。
    turnstileHideNotes();
    if (TS && mode !== "done") mountTurnstile(mode);

    var firstField = {
      pw: "input-pw-email",
      code: "input-email",
      register: "input-reg-email",
      verify: "input-verify-email",
      forgot: "input-forgot-email"
    }[mode];
    if (firstField && $(firstField)) $(firstField).focus();
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function passwordChannel(msgId) {
    if (!api) {
      msg(msgId, "这个站点没有连上服务器，暂时不能注册或改密码。你仍然可以用「快捷登录」的随机码进来。", "warn");
      return null;
    }
    return api;
  }

  function bindEye(btnId, inputId) {
    var btn = $(btnId), input = $(inputId);
    if (!btn || !input) return;
    function render(shown) {
      btn.innerHTML = shown
        ? '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 6.2A10.7 10.7 0 0 1 12 6c6 0 9.5 6 9.5 6a15.6 15.6 0 0 1-2.1 2.8M6.2 6.2A15.8 15.8 0 0 0 2.5 12s3.5 6 9.5 6a10.5 10.5 0 0 0 3.8-.7"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>'
        : '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>';
      btn.setAttribute("aria-label", shown ? "隐藏密码" : "显示密码");
      btn.setAttribute("title", shown ? "隐藏密码" : "显示密码");
      btn.setAttribute("aria-pressed", shown ? "true" : "false");
    }
    btn.addEventListener("click", function () {
      var shown = input.type === "text";
      input.type = shown ? "password" : "text";
      render(!shown);
    });
    render(input.type === "text");
  }

  function buildCodeRow(rowId) {
    var row = $(rowId);
    if (!row) return [];
    row.innerHTML = "";
    var boxes = [];
    for (var i = 0; i < A.CODE_LEN; i++) {
      var b = document.createElement("input");
      b.className = "code-box";
      b.type = "text";
      b.inputMode = "numeric";
      b.pattern = "[0-9]*";
      b.maxLength = 1;
      b.autocomplete = "one-time-code";
      b.setAttribute("aria-label", "第 " + (i + 1) + " 位验证码");
      b.dataset.idx = String(i);
      row.appendChild(b);
      boxes.push(b);
    }
    row.addEventListener("input", function (e) {
      var el = e.target;
      if (!/^[0-9]?$/.test(el.value)) { el.value = el.value.replace(/\D/g, "").slice(-1); }
      el.classList.toggle("filled", !!el.value);
      var i = Number(el.dataset.idx);
      if (el.value && boxes[i + 1]) boxes[i + 1].focus();
    });
    row.addEventListener("keydown", function (e) {
      var el = e.target;
      var i = Number(el.dataset.idx);
      if (e.key === "Backspace" && !el.value && boxes[i - 1]) {
        boxes[i - 1].focus();
        boxes[i - 1].value = "";
        boxes[i - 1].classList.remove("filled");
        e.preventDefault();
      }
      if (e.key === "ArrowLeft" && boxes[i - 1]) { boxes[i - 1].focus(); e.preventDefault(); }
      if (e.key === "ArrowRight" && boxes[i + 1]) { boxes[i + 1].focus(); e.preventDefault(); }
      if (e.key === "Enter") { e.preventDefault(); verify(); }
    });
    row.addEventListener("paste", function (e) {
      var txt = (e.clipboardData || window.clipboardData).getData("text") || "";
      var digits = String(txt).replace(/\D/g, "").slice(0, A.CODE_LEN);
      if (!digits) return;
      e.preventDefault();
      setCode(boxes, digits);
    });
    return boxes;
  }

  function setCode(boxes, digits) {
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].value = digits[i] || "";
      boxes[i].classList.toggle("filled", !!boxes[i].value);
    }
    var last = Math.min(digits.length, boxes.length - 1);
    if (boxes[last]) boxes[last].focus();
  }

  function readCode(boxes) {
    return boxes.map(function (b) { return b.value || ""; }).join("").replace(/\D/g, "");
  }

  function startTick(boxes) {
    stopTick();
    function update() {
      if (!state.expiresAt) { stopTick(); return; }
      var left = Math.max(0, Math.round((state.expiresAt - Date.now()) / 1000));
      var mm = Math.floor(left / 60);
      var ss = String(left % 60).padStart(2, "0");
      text($("code-timer"), left > 0 ? "剩余 " + mm + " 分 " + ss + " 秒" : "已过期，请重新发送");

      var cd = Math.max(0, Math.round((state.cooldown - Date.now()) / 1000));
      var again = $("btn-resend");
      if (again) {
        again.disabled = cd > 0;
        again.textContent = cd > 0 ? "重新发送（" + cd + " 秒）" : "重新发送";
      }
      if (!left && $("btn-verify")) $("btn-verify").disabled = false;
      void boxes;
    }
    update();
    state.tick = setInterval(update, 1000);
  }

  function stopTick() {
    if (state.tick) { clearInterval(state.tick); state.tick = null; }
  }

  function onRegister() {
    return submitPending("btn-register", "注册中…", function () {
    var ch = passwordChannel("msg-reg");
    if (!ch) return;
    var email = (($("input-reg-email") || {}).value || "").trim();
    var pw = ($("input-reg-pw") || {}).value || "";
    var pw2 = ($("input-reg-pw2") || {}).value || "";

    if (!A.isEmailShape(A.normalizeEmail(email))) {
      msg("msg-reg", email ? A.ERR.E_EMAIL_FORMAT : A.ERR.E_EMAIL_EMPTY, "warn");
      return;
    }
    if (!pw) { msg("msg-reg", ch.messageOf("E_PW_EMPTY") || "请先填密码", "warn"); return; }
    if (pw.length < 8) { msg("msg-reg", "密码至少 8 位", "warn"); return; }
    if (pw !== pw2) { msg("msg-reg", "两次填的密码不一样", "warn"); return; }

    if (turnstileBlocked("msg-reg")) return;

    msg("msg-reg", "");
    return ch.register({ email: email, password: pw }).then(function (r) {

      turnstileReset();

      if ($("input-reg-pw")) $("input-reg-pw").value = "";
      if ($("input-reg-pw2")) $("input-reg-pw2").value = "";
      if (!r.ok) {
        msg("msg-reg", r.message, "warn");
        return null;
      }
      state.regEmail = A.maskEmail(email);
      var vInput = $("input-verify-email");
      if (vInput) vInput.value = email;

      var gated = r.requiresVerification === true;
      if (!gated) {

        if (r.verifySent) {
          note("verify-fail-note", "当前无需验证邮箱即可登录；完成验证后可使用密码找回功能。", "warn");
          text($("verify-lead"), "验证邮件已发往 " + state.regEmail + "。");
        } else {
          text($("verify-lead"), "账号已创建。验证邮件暂时无法发送，请稍后重试。");
          note("verify-fail-note", "当前无需验证邮箱即可登录；完成验证后可使用密码找回功能。", "warn");
        }
      } else if (r.verifySent) {
        note("verify-fail-note", "", "");
        text($("verify-lead"), "验证邮件已发往 " + state.regEmail + "。完成验证后即可登录。");
        note("verify-fail-note", "请打开收件箱中的链接验证邮箱。", "warn");
      } else {
        text($("verify-lead"), "账号已创建。验证邮件暂时无法发送，请稍后重试。");
        note("verify-fail-note", "完成邮箱验证后才能登录。如问题持续，请联系管理员。", "warn");
      }
      // 分流只有一处判据：服务端回的 `requiresVerification`。
      //   · 要验证（默认）：停在「去收件箱点链接」那一屏，那一屏本身就是
      //     完整的下一步（点开链接即登录，见 js/verify.js）；
      //   · 不必验证（运维把闸关了）：账号这一刻就能用，直接进门 ——
      //     原先无论哪一档都停在「请点邮件链接」，对着一个关掉闸的服务器
      //     说一句做不到的话。
      if (!gated) {
        showToast(r.created ? "账号已建好，已登录" : "账号信息已更新");
        onSignedIn({
          account: {
            uid: r.uid || "",
            nickname: r.nickname || "",
            identities: [{ channel: "email", mask: r.emailMask || state.regEmail || "" }],
            createdAt: 0, lastLoginAt: 1
          },
          remote: true,
          emailVerified: r.emailVerified === true
        });
        return r;
      }

      showToast(r.created ? "账号已建好" : "账号信息已更新");
      setMode("verify");
      return r;
    }, function () {
      msg("msg-reg", "连不上服务器，请稍后再试", "warn");
    });
    });
  }

  function onLogin() {
    return submitPending("btn-login", "登录中…", function () {
    var ch = passwordChannel("msg-pw");
    if (!ch) return;
    var email = (($("input-pw-email") || {}).value || "").trim();
    var pw = ($("input-pw") || {}).value || "";
    if (!A.isEmailShape(A.normalizeEmail(email))) {
      msg("msg-pw", email ? A.ERR.E_EMAIL_FORMAT : A.ERR.E_EMAIL_EMPTY, "warn");
      return;
    }
    if (!pw) { msg("msg-pw", ch.messageOf("E_PW_EMPTY") || "请先填密码", "warn"); return; }

    // 人机校验：与发码 / 注册 / 忘记密码那几处同一道闸、同一句提示（Issue #278）。
    // ⚠️ 它必须落在**本地那几条校验之后**：先告诉他「两次密码不一样」这种
    //    自己就能改的事，再让他去过人机校验 —— 反过来会让人先勾方框、
    //    送出去，再被一句「密码至少 8 位」退回来重勾一次。
    if (turnstileBlocked("msg-pw")) return;

    msg("msg-pw", "");
    return ch.login({ email: email, password: pw, turnstileToken: turnstileToken() }).then(function (r) {
      // 令牌一次性：无论成没成都作废（成功那条已经用掉了，失败那条更要换一枚）。
      turnstileReset();
      if ($("input-pw")) $("input-pw").value = "";
      if (!r.ok) {

        if (r.code === "E_EMAIL_UNVERIFIED") { showUnverified(r); return null; }
        msg("msg-pw", r.message, "warn");
        return null;
      }

      onSignedIn({
        account: {
          uid: r.account.uid,
          nickname: r.account.nickname || "",
          identities: [{ channel: "email", mask: r.account.mask || "" }],
          createdAt: 0, lastLoginAt: 1
        },
        remote: true,
        emailVerified: r.account.emailVerified === true
      });

      return r;
    }, function () {
      msg("msg-pw", "连不上服务器，请稍后再试", "warn");
    });
    });
  }

  function onForgotSend() {
    return submitPending("btn-forgot-send", "发送中…", function () {
    var ch = passwordChannel("msg-forgot");
    if (!ch) return;
    var email = (($("input-forgot-email") || {}).value || "").trim();
    if (!A.isEmailShape(A.normalizeEmail(email))) {
      msg("msg-forgot", email ? A.ERR.E_EMAIL_FORMAT : A.ERR.E_EMAIL_EMPTY, "warn");
      return;
    }
    if (turnstileBlocked("msg-forgot")) return;
    msg("msg-forgot", "");
    return ch.resetRequest({ email: email }).then(function (r) {
      turnstileReset();
      if (!r.ok) { msg("msg-forgot", r.message, "warn"); return null; }

      var mailOk = (r.mailConfigured !== false) && mailDelivered !== false;
      if (mailOk) {
        msg("msg-forgot", "若该邮箱已注册，重设链接已发出。", "ok");
      } else {
        msg("msg-forgot", mailOutcome("若该邮箱已注册，重设链接已发出。", email), "warn");
      }
      showToast("请查收邮件");
      return r;
    }, function () {
      msg("msg-forgot", "连不上服务器，请稍后再试", "warn");
    });
    });
  }

  function sendCode() {
    if (!store) { msg("msg-email", "浏览器不允许保存数据，本次登录刷新后会失效", "warn"); }
    var msgId = "msg-email";
    var email = (($("input-email") || {}).value || "").trim();

    var shaped = A.isEmailShape(A.normalizeEmail(email));
    if (!shaped) {
      msg(msgId, email ? A.ERR.E_EMAIL_FORMAT : A.ERR.E_EMAIL_EMPTY, "warn");
      return Promise.resolve(null);
    }

    if (api && !api.degraded()) return sendCodeRemote("login", email, msgId);
    return Promise.resolve(sendCodeLocal("login", email, msgId));
  }

  function sendCodeRemote(purpose, email, msgId) {

    if (turnstileBlocked(msgId)) return Promise.resolve(null);
    return api.sendCode({ email: email, purpose: purpose }).then(function (r) {
      turnstileReset();
      if (!r.ok) {
        if (r.code === "E_NOT_CONFIGURED" || r.code === "E_OFFLINE" || r.code === "E_TIMEOUT") {
          msg(msgId, r.message, "warn");
          return sendCodeLocal("login", email, msgId);
        }
        if (r.retryAfter) {
          state.cooldown = Date.now() + r.retryAfter * 1000;
          startTick(codeBoxes);
        }
        hideNotes();
        msg(msgId, r.message, "warn");
        return null;
      }
      state.purpose = "login";
      state.codeId = r.codeId;
      state.code = r.devCode || "";
      state.sentTo = A.maskEmail(email);
      state.expiresAt = r.expiresAt;
      state.cooldown = Date.now() + (r.cooldown || 60) * 1000;
      state.remote = true;
      return afterSent("login", r.delivered ? "已发往 " + state.sentTo : "已生成随机码，将发往 " + state.sentTo,
        r.delivered ? "验证码已发出" : "已生成随机码");
    });
  }

  function sendCodeLocal(purpose, email, msgId) {
    state.remote = false;
    var r = A.requestCode(store, { channel: "email", value: email }, purpose, { code: undefined });

    if (!r.ok) {
      if (r.retryAfter) { state.cooldown = Date.now() + r.retryAfter * 1000; startTick(codeBoxes); }
      msg(msgId, r.message, "warn");
      return null;
    }

    if (r.disposable) {
      msg(msgId, "这是临时邮箱，收不到后续邮件，可能丢失账号。仍可继续。", "warn");
    } else if (r.hint) {
      msg(msgId, r.hint, "warn");
    } else {
      msg(msgId, "");
    }
    state.remote = false;
    return afterSent(purpose, "随机码已生成，将发往 " + r.sentTo,
      r.isNewAccount ? "这是一封新账号的随机码" : "已生成随机码");
  }

  function afterSent(purpose, sentToLine, toast) {
    showToast(toast);
    renderLocalOnlyTools();
    text($("code-sent-to"), sentToLine);
    setMode("code");
    hide($("step-email"));
    show($("step-code"));
    codeBoxes = buildCodeRow("code-row");
    setCode(codeBoxes, "");
    if (codeBoxes[0]) codeBoxes[0].focus();
    startTick(codeBoxes);
    return true;
  }

  function hideNotes() {
    var localNote = $("local-note"), remoteNote = $("remote-note"), tools = $("code-tools");
    if (localNote) localNote.hidden = true;
    if (remoteNote) remoteNote.hidden = true;
    if (tools) tools.hidden = true;
  }

  function renderLocalOnlyTools() {
    var local = isLocal();
    var canInspectCode = local || !!state.code;
    var copy = $("btn-copy-code"), mailBtn = $("btn-mail-code");
    var tools = $("code-tools"), localNote = $("local-note"), remoteNote = $("remote-note");
    if (copy) copy.hidden = !canInspectCode;
    if (mailBtn) mailBtn.hidden = !canInspectCode;
    if (tools) tools.hidden = !canInspectCode;
    if (localNote) localNote.hidden = !local;
    if (remoteNote) remoteNote.hidden = local;
  }

  var codeBoxes = [];

  function onSend(event) {
    if (event && event.currentTarget && event.currentTarget.id === "btn-resend") {
      return submitPending("btn-resend", "发送中…", sendCode).then(function (result) {
        startTick(codeBoxes);
        return result;
      });
    }
    return submitPending("btn-send", "发送中…", sendCode);
  }

  function verify() {
    var digits = readCode(codeBoxes);
    if (digits.length < A.CODE_LEN) {
      msg("msg-code", "请输入 6 位验证码。", "warn");
      return;
    }
    if (state.expiresAt && Date.now() > state.expiresAt) {
      msg("msg-code", A.ERR.E_CODE_EXPIRED, "warn");
      return;
    }
    if (state.remote) return verifyRemote(digits);

    var r = A.verifyCode(store, state.codeId, digits, state.purpose);
    if (!r.ok) {
      msg("msg-code", r.message, "warn");
      if (r.code === "E_CODE_VOID" || r.code === "E_CODE_USED") state.cooldown = 0;
      startTick(codeBoxes);
      return;
    }
    onSignedIn(r);
  }

  function verifyRemote(digits) {
    return api.verifyCode({ codeId: state.codeId, code: digits }).then(function (r) {
      if (!r.ok) {
        if (r.code === "E_EMAIL_UNVERIFIED") {

          text($("verify-lead"), "这个邮箱还没确认。");

          note("verify-fail-note", "请打开收件箱中的验证邮件；未收到可重新发送。", "warn");
          setMode("verify");
          return;
        }
        if (r.code === "E_OFFLINE" || r.code === "E_TIMEOUT" || r.code === "E_NOT_CONFIGURED") {
          msg("msg-code", r.message, "warn");
          state.cooldown = 0;
          startTick(codeBoxes);
          return;
        }

        if (r.code === "E_EMAIL_UNVERIFIED") { showUnverified(r); return; }
        msg("msg-code", r.message, "warn");
        if (r.code === "E_CODE_VOID" || r.code === "E_CODE_USED") state.cooldown = 0;
        startTick(codeBoxes);
        return;
      }
      onSignedIn({
        account: {
          uid: r.account.uid,
          nickname: r.account.nickname || "",
          identities: [{ channel: "email", mask: r.account.mask || "" }],
          createdAt: 0, lastLoginAt: 1
        },
        remote: true,
        emailVerified: r.account.emailVerified === true
      });
    });
  }

  function onSignedIn(r) {
    stopTick();
    setMode("done");

    var isNew = !r.account.lastLoginAt || r.account.lastLoginAt === r.account.createdAt;
    text($("done-lead"), (isNew ? "账号已建好 · " : "已登录 · ") +
      (Ent ? Ent.tierLabel(Ent.identity().tier) : "Free") +
      " · " + (r.account.identities[0] ? r.account.identities[0].mask : ""));

    var nickInput = $("input-nickname");
    if (nickInput) {
      var cur = window.Avatar && Avatar.nickname ? Avatar.nickname(backing) : "";
      nickInput.value = cur || "";
      nickInput.focus();
    }

    if (r.remote) {
      showToast("登录成功：进度已可跨设备同步");
    } else if (r.isLocalOnly) {
      showToast("浏览器不允许保存数据：本次登录刷新后会失效");
    } else {
      showToast("登录成功（本机体验版）");
    }
  }

  // 从别的页面被送过来登录的（例如未登录时点「打印清单」），
  // 登录完要回得去它原来站着的那一页（?next=/settings/lists/）。
  // 只认本站的站内路径：一个 / 开头、第二个字符不是 /、也不带 '\'，
  // 防着把 /login/?next=https://别处 当成开放跳板。
  function nextUrl() {
    var raw = "";
    try {
      raw = (new URLSearchParams(location.search)).get("next") || "";
    } catch (e) {
      var m = /[?&]next=([^&#]*)/.exec(location.search || "");
      try { raw = m ? decodeURIComponent(m[1]) : ""; } catch (e2) { raw = ""; }
    }
    if (raw.charAt(0) !== "/") return "";
    if (raw.charAt(1) === "/" || raw.charAt(1) === "\\") return "";
    return raw;
  }

  // 昵称是**账号域**的东西（Issue #278）：原先只写本机 localStorage，
  // 服务器上那一列永远是空的 —— 换台设备名字就没了，管理端名录也认不出人。
  //
  // 现在的顺序是「本机先写、服务器后跟」：本机那一份是头像 / 顶栏
  // 立刻要用的那一份，不能等一次网络往返；服务器那一份失败也**不拦人**
  // （名字没同步上比进不去轻得多），只是如实说一句。
  //
  // 落点是**这一屏的那一句提示**，不是 toast —— toast 两秒就没了，
  // 而用户需要知道的是「这个名字到底存下来没有」。
  function saveNicknameAndGo() {
    var v = ($("input-nickname") || {}).value || "";
    var clean = String(v).trim().slice(0, 12);
    if (window.Avatar && Avatar.saveNickname) {
      try { Avatar.saveNickname(backing, clean); } catch (e) {  }
    }
    if (A.setNickname && store) { try { A.setNickname(store, clean); } catch (e) {  } }

    function leave(noteText, level) {
      if (noteText) note("done-note", noteText, level);
      location.href = nextUrl() || "/mine/";
    }

    // 没起名就别发请求（空串会把服务器上已有的名字抹掉）。
    if (!clean || !api || isLocal()) { leave("", ""); return; }

    var Acct = window.AccountApi;
    if (!Acct || !Acct.bind) { leave("", ""); return; }

    msg("msg-done", "");
    return submitPending("btn-finish", "保存中…", function () {
      return Acct.bind({}).setNickname({ nickname: clean }).then(function (r) {
        if (r && r.ok) { leave("", ""); return r; }
        if (r && r.reason === "not-configured") { leave("这台服务器没有开放云端账号，昵称只存在本机。", "warn"); return r; }
        leave("昵称暂时没能同步到服务器（连不上或服务不可用），本机这一份还在；进去之后可以在「设置」里再改一次。", "warn");
        return r;
      });
    });
  }

  function onFinish() { return saveNicknameAndGo(); }

  function showUnverified(r) {
    stopTick();
    setMode("unverified");
    text($("unverified-lead"), r.message || "邮箱尚未验证，请打开验证邮件中的链接。");

    if (r.verifySent === true) {
      note("unverified-note", "我们又发了一封，发往 " + (r.emailMask || "你的邮箱") + "。", "ok");
    } else if (r.verifySent === false) {
      note("unverified-note", "本次未重复发送，可稍后重试。", "");
    } else {
      note("unverified-note", "", "");
    }
    msg("msg-unverified", "");
    var lead = $("unverified-lead");
    if (lead) lead.focus && lead.focus();
  }

  function onUnverifiedResend() {
    return submitPending("btn-unverified-resend", "发送中…", function () {
    var ch = passwordChannel("msg-unverified");
    if (!ch) return;
    if (!ch.resendVerificationByEmail) {
      msg("msg-unverified", "这个页面是旧缓存，刷新一下再试", "warn");
      return;
    }
    var email = (($("input-pw-email") || {}).value || (($("input-email") || {}).value || "")).trim();
    if (!A.isEmailShape(A.normalizeEmail(email))) {
      msg("msg-unverified", "请回到登录那一屏填上邮箱，再点这颗键", "warn");
      return;
    }
    if (turnstileBlocked("msg-unverified")) return;
    msg("msg-unverified", "");
    return ch.resendVerificationByEmail({ email: email }).then(function (r) {
      turnstileReset();
      if (!r.ok) { msg("msg-unverified", r.message, "warn"); return null; }

      if (r.alreadyVerified) {
        msg("msg-unverified", "这个邮箱已经确认过了，直接回「密码登录」进来即可。", "ok");
      } else if (r.verifySent) {
        msg("msg-unverified", "验证邮件已发往 " + (r.emailMask || "你的邮箱") + "。", "ok");
      } else {
        msg("msg-unverified", "这台服务器现在没能把邮件发出去（发信商还没配好），稍后再试。", "warn");
      }
      return r;
    }, function () {
      msg("msg-unverified", "连不上服务器，请稍后再试", "warn");
    });
    });
  }

  function onResendVerify() {
    return submitPending("btn-resend-verify", "发送中…", function () {
    var ch = passwordChannel("msg-verify");
    if (!ch) return;
    if (!ch.resendVerification) {
      msg("msg-verify", "这个页面是旧缓存，刷新一下再试", "warn");
      return;
    }

    var emailInput = $("input-verify-email");
    var email = ((emailInput || {}).value || "").trim();
    var sess = A.session(store);
    var signedIn = !!(sess && sess.account);
    if (!signedIn && !email) {
      msg("msg-verify", "请先填邮箱", "warn");
      return;
    }
    if (turnstileBlocked("msg-verify")) return;
    msg("msg-verify", "");
    return ch.resendVerification(signedIn ? {} : { email: email }).then(function (r) {
      turnstileReset();
      if (!r.ok) { msg("msg-verify", r.message, "warn"); return null; }
      if (r.alreadyVerified) {
        msg("msg-verify", "这个邮箱已经确认过了，不用再发。", "ok");
        return r;
      }

      if (signedIn && r.verifySent) {
        msg("msg-verify", mailOutcome(
          "验证邮件已发往 " + (r.emailMask || state.regEmail) + "。",
          r.emailMask || state.regEmail), mailDelivered === false ? "warn" : "ok");
      } else if (signedIn) {

        msg("msg-verify", "这台服务器现在没能把邮件发出去（已试 " + (Number(r.verifyAttempts) || 1)
          + " 次）。稍后再试。", "warn");
      } else {

        msg("msg-verify", mailDelivered === false
          ? mailNotConfiguredNote("")
          : "若该邮箱已注册且尚未验证，验证邮件已发出。",
          mailDelivered === false ? "warn" : "ok");
      }
      return r;
    }, function () {
      msg("msg-verify", "连不上服务器，请稍后再试", "warn");
    });
    });
  }

  function renderTrust() {
    var acc = A.trustedAccount(store);
    var panel = $("trust-panel");
    if (!acc) { hide(panel); return; }
    var mask = (acc.identities[0] && acc.identities[0].mask) || "";
    var btn = $("btn-trust");
    if (btn) btn.textContent = "继续以 " + mask + " 进入";
    show(panel);
  }

  function onTrust() {
    var r = A.signInTrusted(store);
    if (!r.ok) { msg("msg-email", r.message, "warn"); hide($("trust-panel")); return; }
    onSignedIn({ account: r.account, isLocalOnly: !store.persistent() });
  }

  function onCopyCode() {
    var code = state.code || "";
    if (!code) { showToast("请先发送随机码"); return; }
    var done = function () { showToast("随机码已复制，请自己保管好"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done, function () { showToast("复制失败，请手动抄下：" + code); });
    } else {
      showToast("请手动抄下：" + code);
    }
  }

  function onMailCode() {
    var code = state.code || "";
    if (!code) { showToast("请先发送随机码"); return; }
    var subject = "【跬步】登录随机码 " + code;
    var body = "跬步登录随机码：" + code + "\n有效期 10 分钟，仅能使用一次。\n"
      + "这是「本地体验版」：本站没有服务器，这封邮件由你自己发出、自己保管。";
    window.location.href = "mailto:?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  }

  var inited = false;
  function init() {
    if (inited) return;
    inited = true;
    if (!A || !store) {
      msg("msg-email", "账号内核没有加载成功，请刷新页面重试", "warn");
      return;
    }
    renderTrust();
    preloadTurnstileScript();

    if (TS && api && api.config) {
      api.config().then(function (r) {
        if (!r || !r.ok) return;

        if (r.mail && typeof r.mail.delivered === "boolean") mailDelivered = r.mail.delivered;
        if (!r.turnstile) return;
        tsConfig.enabled = r.turnstile.enabled === true;
        tsConfig.siteKey = r.turnstile.siteKey || "";

        if (tsConfig.enabled) mountTurnstile(state.mode);
      }, function () {  });
    }

    $("tab-pw").addEventListener("click", function () { setMode("pw"); msg("msg-pw", ""); });
    $("tab-code").addEventListener("click", function () { setMode("code"); msg("msg-email", ""); });

    $("btn-login").addEventListener("click", onLogin);
    $("btn-register").addEventListener("click", onRegister);
    $("btn-forgot-send").addEventListener("click", onForgotSend);
    $("btn-resend-verify").addEventListener("click", onResendVerify);
    $("btn-unverified-resend").addEventListener("click", onUnverifiedResend);
    $("btn-unverified-back").addEventListener("click", function () { setMode("pw"); });
    $("btn-go-register").addEventListener("click", function () { setMode("register"); msg("msg-reg", ""); });
    $("btn-forgot").addEventListener("click", function () { setMode("forgot"); msg("msg-forgot", ""); });
    $("btn-back-login").addEventListener("click", function () { setMode("pw"); });
    $("btn-back-login2").addEventListener("click", function () { setMode("pw"); });

    var later = $("btn-verify-later");
    if (later) later.addEventListener("click", function () { setMode("pw"); });
    bindEye("btn-pw-eye", "input-pw");
    bindEye("btn-reg-eye", "input-reg-pw");
    bindEye("btn-reg-eye2", "input-reg-pw2");

    $("btn-send").addEventListener("click", onSend);
    $("btn-edit-email").addEventListener("click", function () {
      hide($("step-code"));
      show($("step-email"));
      stopTick();
      msg("msg-code", "");
      msg("msg-email", "");
    });
    $("btn-resend").addEventListener("click", onSend);
    $("btn-verify").addEventListener("click", verify);
    $("btn-finish").addEventListener("click", onFinish);
    $("btn-trust").addEventListener("click", onTrust);
    $("btn-trust-other").addEventListener("click", function () {
      hide($("trust-panel"));
      setMode("pw");
    });
    $("btn-copy-code").addEventListener("click", onCopyCode);
    $("btn-mail-code").addEventListener("click", onMailCode);

    [["input-pw-email", onLogin], ["input-pw", onLogin],
      ["input-reg-email", onRegister], ["input-reg-pw", onRegister], ["input-reg-pw2", onRegister],
      ["input-forgot-email", onForgotSend],
      ["input-email", onSend]].forEach(function (pair) {
      var el = $(pair[0]);
      if (!el) return;
      el.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); pair[1](); }
      });
    });

    var sess = A.session(store);
    if (sess && sess.account) {
      onSignedIn({ account: sess.account, isLocalOnly: !store.persistent() });
      return;
    }
    setMode("pw");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.LoginPage = {
    state: state,
    MODES: MODES,
    mountTurnstile: mountTurnstile,
    preloadTurnstileScript: preloadTurnstileScript,
    buildCodeRow: buildCodeRow,
    readCode: readCode,
    setCode: setCode,
    sendCode: sendCode,
    setMode: setMode,
    isLocal: isLocal,
    passwordNeedsServer: passwordNeedsServer,
    esc: esc
  };
})();
