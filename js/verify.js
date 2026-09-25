(function () {
  "use strict";

  var api = (window.AuthApi && window.AuthApi.supported()) ? window.AuthApi.create({}) : null;

  function $(id) { return document.getElementById(id); }
  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }
  function text(el, s) { if (el) el.textContent = s == null ? "" : String(s); }

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
