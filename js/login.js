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

    return "这台服务器还没接上发信商（现在是 console 通道：只往服务端日志写一行，不往外发信）。" +
      "要收信得请运维在托管平台的环境变量里补上发信密钥 —— 步骤：在终端跑 " +
      "`npm run doctor -- --steps`，第 C 步写的就是它" +
      "（托管平台环境变量填密钥 + 在 Resend 后台验发信子域 SPF/DKIM/DMARC 三条 DNS）。" +
      (masked ? "这一步只能由运维做，所以 " + masked + " 现在收不到信。" : "");
  }

  var TS_SLOTS = {
    pw: "ts-pw",
    code: "ts-code",
    register: "ts-reg",
    forgot: "ts-forgot",
    verify: "ts-verify",
    unverified: "ts-unverified"
  };

  var tsMounted = {};

  function mountTurnstile(slotKey) {
    if (!TS || !TS.mount || !slotKey) return;
    var slotId = TS_SLOTS[slotKey];
    var el = slotId ? $(slotId) : null;
    if (!el) return;
    TS.mount(el, { siteKey: tsConfig.siteKey, enabled: tsConfig.enabled }).then(function (st) {

      if (st && st.configured) show(el);
    });
  }

  function turnstileBlocked(msgId) {
    if (!TS || !TS.gate) return false;
    var why = TS.gate();
    if (!why) return false;
    msg(msgId, why, "warn");
    return true;
  }

  function turnstileReset() {
    if (TS && TS.reset) { try { TS.reset(); } catch (e) {  } }
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

    var panes = { pw: $("pane-pw"), code: $("pane-code"), register: $("pane-register"),
      verify: $("pane-verify"), forgot: $("pane-forgot") };
    Object.keys(panes).forEach(function (k) {
      var el = panes[k];
      if (!el) return;
      if (k === mode) show(el); else hide(el);
    });

    if (mode === "done") show($("step-done")); else hide($("step-done"));
    if (mode === "unverified") show($("step-unverified")); else hide($("step-unverified"));
    if (mode === "code") { show($("step-email")); hide($("step-code")); }

    if (TS && mode !== "done") mountTurnstile(mode);
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
    btn.addEventListener("click", function () {
      var shown = input.type === "text";
      input.type = shown ? "password" : "text";
      btn.textContent = shown ? "显示" : "隐藏";
      btn.setAttribute("aria-label", shown ? "显示密码" : "隐藏密码");
    });
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
      b.setAttribute("aria-label", "第 " + (i + 1) + " 位随机码");
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
    state.tick = setInterval(function () {
      if (!state.expiresAt) { stopTick(); return; }
      var left = Math.max(0, Math.round((state.expiresAt - Date.now()) / 1000));
      var mm = Math.floor(left / 60);
      var ss = String(left % 60).padStart(2, "0");
      text($("code-timer"), left > 0 ? "有效 " + mm + ":" + ss : "已过期，请重新发送");

      var cd = Math.max(0, Math.round((state.cooldown - Date.now()) / 1000));
      var again = $("btn-resend");
      if (again) {
        again.disabled = cd > 0;
        again.textContent = cd > 0 ? "重新发送（" + cd + "s）" : "重新发送";
      }
      if (!left && $("btn-verify")) $("btn-verify").disabled = false;
      void boxes;
    }, 1000);
  }

  function stopTick() {
    if (state.tick) { clearInterval(state.tick); state.tick = null; }
  }

  function onRegister() {
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
          note("verify-fail-note", "这台服务器现在**没有**拦「邮箱没确认」——不点也能登录，确认只是为了将来能找回密码。", "warn");
          text($("verify-lead"), "确认邮件已发往 " + state.regEmail + "。");
        } else {
          text($("verify-lead"), "账号建好了。但这台服务器现在**没能把确认邮件发出去**（发信商还没配好）。");
          note("verify-fail-note", "这台服务器也没拦「邮箱没确认」：现在就可以回「密码登录」用刚才那个密码进来。", "warn");
        }
      } else if (r.verifySent) {
        note("verify-fail-note", "", "");
        text($("verify-lead"), "确认邮件已发往 " + state.regEmail + "。点开那条链接之后就能登录。");
        note("verify-fail-note", "**邮箱确认之后才能登录**：请现在去收件箱点开那条链接。", "warn");
      } else {

        var tries = Number(r.verifyAttempts) || 1;
        text($("verify-lead"), "账号建好了。但这台服务器现在**没能把确认邮件发出去**（已试 "
          + tries + " 次）。");
        note("verify-fail-note", "而这台服务器**要求邮箱确认之后才能登录**。" +
          mailNotConfiguredNote(state.regEmail) +
          " 请稍后点下面那颗「重发确认邮件」，或者联系站长先把发信商配好。", "warn");
      }
      showToast(r.created ? "账号已建好" : "账号信息已更新");
      setMode("verify");
      return r;
    }, function () {
      msg("msg-reg", "连不上服务器，请稍后再试", "warn");
    });
  }

  function onLogin() {
    var ch = passwordChannel("msg-pw");
    if (!ch) return;
    var email = (($("input-pw-email") || {}).value || "").trim();
    var pw = ($("input-pw") || {}).value || "";
    if (!A.isEmailShape(A.normalizeEmail(email))) {
      msg("msg-pw", email ? A.ERR.E_EMAIL_FORMAT : A.ERR.E_EMAIL_EMPTY, "warn");
      return;
    }
    if (!pw) { msg("msg-pw", ch.messageOf("E_PW_EMPTY") || "请先填密码", "warn"); return; }

    if (turnstileBlocked("msg-pw")) return;
    msg("msg-pw", "");
    return ch.login({ email: email, password: pw }).then(function (r) {
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
  }

  function onForgotSend() {
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
    var copy = $("btn-copy-code"), mailBtn = $("btn-mail-code");
    var tools = $("code-tools"), localNote = $("local-note"), remoteNote = $("remote-note");
    if (copy) copy.hidden = !local;
    if (mailBtn) mailBtn.hidden = !local;
    if (tools) tools.hidden = !local;
    if (localNote) localNote.hidden = !local;
    if (remoteNote) remoteNote.hidden = local;
  }

  var codeBoxes = [];

  function onSend() {
    return sendCode();
  }

  function verify() {
    var digits = readCode(codeBoxes);
    if (digits.length < A.CODE_LEN) {
      msg("msg-code", "请填满 6 位随机码", "warn");
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

          note("verify-fail-note", "去收件箱点开确认邮件；没收到就点下面那颗重发。", "warn");
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

  function onFinish() {
    var v = ($("input-nickname") || {}).value || "";
    var clean = String(v).trim().slice(0, 12);
    if (window.Avatar && Avatar.saveNickname) {
      try { Avatar.saveNickname(backing, clean); } catch (e) {  }
    }
    if (A.setNickname && store) { try { A.setNickname(store, clean); } catch (e) {  } }
    location.href = nextUrl() || "/profile/";
  }

  function showUnverified(r) {
    stopTick();
    setMode("unverified");
    text($("unverified-lead"), r.message || "邮箱还没确认：请点开注册时那封确认邮件里的链接。");

    if (r.verifySent === true) {
      note("unverified-note", "我们又发了一封，发往 " + (r.emailMask || "你的邮箱") + "。", "ok");
    } else if (r.verifySent === false) {
      note("unverified-note", "这一次没有重复发信 —— 稍后点下面那颗「重新发一封」即可。", "");
    } else {
      note("unverified-note", "", "");
    }
    msg("msg-unverified", "");
    var lead = $("unverified-lead");
    if (lead) lead.focus && lead.focus();
  }

  function onUnverifiedResend() {
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
        msg("msg-unverified", "确认邮件已发往 " + (r.emailMask || "你的邮箱") + "。", "ok");
      } else {
        msg("msg-unverified", "这台服务器现在没能把邮件发出去（发信商还没配好），稍后再试。", "warn");
      }
      return r;
    }, function () {
      msg("msg-unverified", "连不上服务器，请稍后再试", "warn");
    });
  }

  function onResendVerify() {
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
          "确认邮件已发往 " + (r.emailMask || state.regEmail) + "。",
          r.emailMask || state.regEmail), mailDelivered === false ? "warn" : "ok");
      } else if (signedIn) {

        msg("msg-verify", "这台服务器现在没能把邮件发出去（已试 " + (Number(r.verifyAttempts) || 1)
          + " 次）。稍后再试。", "warn");
      } else {

        msg("msg-verify", mailDelivered === false
          ? mailNotConfiguredNote("")
          : "若该邮箱已注册且未确认，确认邮件已发出。",
          mailDelivered === false ? "warn" : "ok");
      }
      return r;
    }, function () {
      msg("msg-verify", "连不上服务器，请稍后再试", "warn");
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
    $("btn-back-login3").addEventListener("click", function () { setMode("pw"); });

    var later = $("btn-verify-later");
    if (later) later.addEventListener("click", function () { setMode("pw"); });
    bindEye("btn-pw-eye", "input-pw");
    bindEye("btn-reg-eye", "input-reg-pw");

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
