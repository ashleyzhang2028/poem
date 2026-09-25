(function () {
  "use strict";

  var api = (window.AuthApi && window.AuthApi.supported()) ? window.AuthApi.create({}) : null;

  function $(id) { return document.getElementById(id); }
  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }
  function text(el, s) { if (el) el.textContent = s == null ? "" : String(s); }

  // 解一个 URL 参数：**永不抛**。
  //
  // `decodeURIComponent("...%zz")` 会抛 URIError，而这里是在**页面初始化**时
  // 被调的 —— 一抛，整个脚本停在这一句，`/verify/`（`/reset/` 同理）就僵在
  // 出厂那一屏：用户点开邮件链接、看到的却是一句「链接不完整」，
  // 甚至什么都不显示。而真正的原因（邮件客户端把 token 里的 % 弄坏 /
  // 手动截断了链接）一个字都没露。
  //
  // 口径与 `api/_lib/session.js` 的 `safeDecode` 同源：读不动就**按原样**
  // 还回去，交给下游如实判「这不是一个完整的链接」。
  function safeDecodeParam(v) {
    var raw = String(v == null ? "" : v);
    try {
      return decodeURIComponent(raw);
    } catch (e) {

      return raw;
    }
  }

  function param(name) {
    var q = String(location.search || "").replace(/^\?/, "");
    var parts = q ? q.split("&") : [];
    for (var i = 0; i < parts.length; i++) {
      var eq = parts[i].indexOf("=");
      if (eq < 0) continue;
      if (safeDecodeParam(parts[i].slice(0, eq)) === name) {
        return safeDecodeParam(parts[i].slice(eq + 1).replace(/\+/g, " "));
      }
    }
    return "";
  }

  function state(s) {
    hide($("verify-none")); hide($("verify-busy")); hide($("verify-ok")); hide($("verify-bad"));
    if (s === "none") show($("verify-none"));
    else if (s === "busy") show($("verify-busy"));
    else if (s === "ok") show($("verify-ok"));
    else show($("verify-bad"));
  }

  function toLogin() { location.href = "/login/"; }

  // 「下一步去哪」只有一处判据（Issue #278）。
  // 确认成功 = 已经登录（服务端在同一个响应里签了会话），于是那颗按钮
  // 不再是「去登录」而是「开始背诵」，落点是首页；没拿到会话时才回落
  // 到登录页 —— 两种情形如实分开，不说做不到的话。
  var signedIn = false;

  function nextStep() {
    location.href = signedIn ? "/mine/" : "/login/";
  }

  function renderNextStep() {
    var btn = $("btn-verify-login");
    if (btn) btn.textContent = signedIn ? "开始背诵" : "去登录";
  }

  function init() {
    var vid = param("vid");
    var token = param("token");

    $("btn-verify-to-login").addEventListener("click", toLogin);
    $("btn-verify-login").addEventListener("click", nextStep);
    $("btn-verify-retry-login").addEventListener("click", toLogin);

    if (!vid || !token) { state("none"); return; }

    try {
      if (window.history && history.replaceState) history.replaceState(null, "", "/verify/");
    } catch (e) {  }

    if (!api) { state("bad"); text($("verify-bad-lead"), "连不上服务器，请稍后再试。"); return; }

    state("busy");
    api.verifyEmail({ vid: vid, token: token }).then(function (r) {
      if (r.ok) {
        state("ok");
        signedIn = r.signedIn === true;
        renderNextStep();

        text($("verify-ok-lead"), signedIn
          ? "邮箱已确认，已经帮你登录：" + (r.emailMask || r.email || "") + "。"
          : "邮箱已确认：" + (r.emailMask || r.email || "") + "。");

        var hint = $("verify-ok-hint");
        if (hint) {
          hint.textContent = signedIn
            ? "不用再回登录页了，已经进来了。下次换设备用这个邮箱加密码登录即可。"
            : "现在可以回登录页用这个邮箱登录了。";
        }
        return;
      }
      state("bad");
      text($("verify-bad-lead"), r.message || "这个确认链接不对，请重新发一封确认邮件。");
    }, function () {
      state("bad");
      text($("verify-bad-lead"), "连不上服务器，请稍后再试。");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.VerifyPage = { param: param, nextStep: nextStep, isSignedIn: function () { return signedIn; } };
})();
