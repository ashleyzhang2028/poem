(function () {
  "use strict";

  var api = (window.AuthApi && window.AuthApi.supported()) ? window.AuthApi.create({}) : null;

  function $(id) { return document.getElementById(id); }
  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }
  function text(el, s) { if (el) el.textContent = s == null ? "" : String(s); }

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

  function state(s) {
    hide($("verify-none")); hide($("verify-busy")); hide($("verify-ok")); hide($("verify-bad"));
    if (s === "none") show($("verify-none"));
    else if (s === "busy") show($("verify-busy"));
    else if (s === "ok") show($("verify-ok"));
    else show($("verify-bad"));
  }

  function toLogin() { location.href = "/login/"; }

  function init() {
    var vid = param("vid");
    var token = param("token");

    $("btn-verify-to-login").addEventListener("click", toLogin);
    $("btn-verify-login").addEventListener("click", toLogin);
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
        text($("verify-ok-lead"), "邮箱已确认：" + (r.emailMask || r.email || "") + "。");

        var fallback = "现在可以用它找回密码了。";
        var hint = $("verify-ok-hint");
        if (hint) hint.textContent = fallback;
        if (api.me) {
          api.me().then(function (m) {
            var ch = (m && m.ok && m.channel) || null;
            if (!hint || !ch) return;
            if (ch.emailGate === true) {
              hint.textContent = "现在可以回登录页用这个邮箱登录了。";
            } else if (ch.emailGate === false) {
              hint.textContent = "这台服务器**没有**拦「没确认就不让登录」，确认只影响找回密码。";
            }
          }, function () {  });
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

  window.VerifyPage = { param: param };
})();
