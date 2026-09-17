/**
 * 重设密码页（/reset/）—— 处理邮件里那条链接（Issue #197）
 * ==========================================================================
 * 与 /verify/ 是同一种页（都是「点开邮件里那条链接」），四处做法也一致：
 *   ① 不要求登录  ② 结果文案由服务端给  ③ 读出参数即抹掉地址栏  ④ 不写任何存储
 *
 * 另外**多一条这一页独有的**：重设完之后要**明确告诉用户「其它设备上的登录
 * 已全部退出」**。这不是一句可选的提示 —— 它是「重设密码」这件事的
 * 一半含义（另一半是新密码生效）。用户不知道的话，会在另一台设备上
 * 发现自己莫名其妙被登出了。
 *
 * ⚠️ 新口令**只活在内存里**：发完请求就清空两个输入框，
 *    绝不写 localStorage、不进 URL、不进日志。
 */
(function () {
  "use strict";

  var api = (window.AuthApi && window.AuthApi.supported()) ? window.AuthApi.create({}) : null;
  /* 人机校验（Issue #197 后续）。**可能是 undefined** —— 每一处都按
     「没有它也能跑」写：真闸在服务端，这里少一个模块只意味着少一次前置判断。 */
  var TS = window.Turnstile || null;
  var tsConfig = { enabled: false, siteKey: "" };

  function $(id) { return document.getElementById(id); }
  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }
  function text(el, s) { if (el) el.textContent = s == null ? "" : String(s); }
  function msg(s, level) {
    var el = $("msg-reset");
    if (!el) return;
    el.textContent = s == null ? "" : String(s);
    el.className = "account-msg" + (level ? " " + level : "");
  }

  function param(name) {
    var q = String(location.search || "").replace(/^\?/, "");
    var parts = q ? q.split("&") : [];
    for (var i = 0; i < parts.length; i++) {
      var eq = parts[i].indexOf("=");
      if (eq < 0) continue;
      if (decodeURIComponent(parts[i].slice(0, eq)) === name) {
        return decodeURIComponent(parts[i].slice(eq + 1).replace(/\+/g, " "));
      }
    }
    return "";
  }

  /** 四个状态互斥地切 */
  function state(s) {
    hide($("reset-none")); hide($("reset-form")); hide($("reset-ok")); hide($("reset-bad"));
    if (s === "none") show($("reset-none"));
    else if (s === "form") show($("reset-form"));
    else if (s === "ok") show($("reset-ok"));
    else show($("reset-bad"));
  }

  function toLogin() { location.href = "/login/"; }

  var rid = "";

  /**
   * 人机校验的空壳（**没配时什么都不做**）。
   *
   * ⚠️ 本页与 /login/ 那一份的差别只有一处：这里**没有**把「没过就拦住」
   *    做成硬拦 —— 重设口令这条路**服务端不挂校验**（见 api/_lib/core.js
   *    的 humanGuard），所以在客户端拦下来等于凭空多出一道谁也绕不过的门。
   *    判据仍走 `TS.gate()`（那一个函数决定「没配」要不要放行），
   *    只是**只在服务端真的挂了校验时才拦** —— 而这一页无从知道服务端挂没挂，
   *    所以它**不拦**，只把 token 带上（服务端要不要它，由那边决定）。
   */
  function mountTurnstile() {
    if (!TS || !TS.mount) return;
    var el = $("ts-reset");
    if (!el) return;
    TS.mount(el, { siteKey: tsConfig.siteKey, enabled: tsConfig.enabled }).then(function (st) {
      if (st && st.configured) show(el);
    });
  }

  function confirmReset() {
    if (!api) { msg("连不上服务器，请稍后再试", "warn"); return; }
    var pw = ($("input-new-pw") || {}).value || "";
    var pw2 = ($("input-new-pw2") || {}).value || "";
    var token = param("token") || resetToken;
    if (!pw) { msg("请先填新密码", "warn"); return; }
    if (pw.length < 8) { msg("密码至少 8 位", "warn"); return; }
    if (pw !== pw2) { msg("两次填的密码不一样", "warn"); return; }
    if (!token) { state("none"); return; }

    msg("");
    api.resetConfirm({ rid: rid, token: token, password: pw }).then(function (r) {
      // 口令用完就清（无论成没成）
      if ($("input-new-pw")) $("input-new-pw").value = "";
      if ($("input-new-pw2")) $("input-new-pw2").value = "";
      /* 人机校验的 token 也是一次性的（提交即废） */
      if (TS && TS.reset) { try { TS.reset(); } catch (e) { /* 没有 widget：空操作 */ } }
      if (!r.ok) {
        /* 「链接过期 / 用过 / 不对」三种情形要**换一屏**说（那是链接的问题，
           不是表单填错了）。而「密码太短」留在这张表单上就地提示。 */
        if (/^E_TOKEN_/.test(r.code) || r.code === "E_NO_TOKEN") {
          state("bad");
          text($("reset-bad-lead"), r.message);
          return;
        }
        msg(r.message, "warn");
        return;
      }
      state("ok");
      text($("reset-ok-lead"), "密码已重设。为了安全，你在其它设备上的登录已全部退出。");
      /* ------------------------------------------------------------------
         邮箱还没确认时**必须**多说一句，否则用户会掉进一个死循环
         ------------------------------------------------------------------
         实测过的那种投诉：走完「忘记密码」整套流程（收信 → 点链接 →
         填新口令 → 看到「请用新密码登录」），回去一登 —— 403「邮箱还没确认」。
         他会以为新口令没生效，于是再来一遍。服务端把事实放在
         `emailVerified` 里（它**不会**顺手把确认状态改掉，那两件事各写各的），
         这一页照着说，并给出**唯一那一步的入口在哪儿**。
         ------------------------------------------------------------------ */
      var hint = $("reset-ok-hint");
      if (hint) {
        if (r.emailVerified === false) {
          hint.hidden = false;
          hint.className = "account-note warn";
          /* Issue #197：这一句原先 56 字，只留「新密码登不进去 + 去哪解决」。 */
          hint.textContent = "新密码还用不了：邮箱未确认，需先去登录页重发确认邮件。";
        } else {
          hint.hidden = true;
          hint.textContent = "";
        }
      }
      try {
        if (window.history && history.replaceState) history.replaceState(null, "", "/reset/");
      } catch (e) { /* 不抛 */ }
    }, function () {
      msg("连不上服务器，请稍后再试", "warn");
    });
  }

  var resetToken = "";

  function init() {
    rid = param("rid");
    resetToken = param("token");

    $("btn-reset-to-login").addEventListener("click", toLogin);
    $("btn-reset-login").addEventListener("click", toLogin);
    $("btn-reset-retry").addEventListener("click", toLogin);
    $("btn-reset-confirm").addEventListener("click", confirmReset);

    var eye = $("btn-new-eye"), input = $("input-new-pw");
    if (eye && input) {
      eye.addEventListener("click", function () {
        var shown = input.type === "text";
        input.type = shown ? "password" : "text";
        eye.textContent = shown ? "显示" : "隐藏";
        eye.setAttribute("aria-label", shown ? "显示密码" : "隐藏密码");
      });
    }
    ["input-new-pw", "input-new-pw2"].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); confirmReset(); } });
    });

    /* 人机校验：先问「要不要」，再挂（与 /login/ 同一套；失败不拦） */
    if (TS && api && api.config) {
      api.config().then(function (r) {
        if (!r || !r.ok || !r.turnstile) return;
        tsConfig.enabled = r.turnstile.enabled === true;
        tsConfig.siteKey = r.turnstile.siteKey || "";
        if (tsConfig.enabled) mountTurnstile();
      }, function () { /* 拿不到就保持「没配」那一档 */ });
    }

    if (!rid || !resetToken) { state("none"); return; }
    /* ⚠️ 地址栏里的令牌**先不抹** —— 这一页要等用户填完两次口令才发请求，
       所以令牌得留着。它只在**提交成功之后**抹（那时已经用掉了）。
       这与 /verify/ 那一页不同：那边是「打开即用」，所以「读出即抹」。
       两处的差异是刻意的，不是漏了一处。 */
    state("form");
    if ($("input-new-pw")) $("input-new-pw").focus();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.ResetPage = { param: param, state: state };
})();
