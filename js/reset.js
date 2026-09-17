(function () {
  "use strict";

  var api = (window.AuthApi && window.AuthApi.supported()) ? window.AuthApi.create({}) : null;

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

  function state(s) {
    hide($("reset-none")); hide($("reset-form")); hide($("reset-ok")); hide($("reset-bad"));
    if (s === "none") show($("reset-none"));
    else if (s === "form") show($("reset-form"));
    else if (s === "ok") show($("reset-ok"));
    else show($("reset-bad"));
  }

  function toLogin() { location.href = "/login/"; }

  var rid = "";

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

      if ($("input-new-pw")) $("input-new-pw").value = "";
      if ($("input-new-pw2")) $("input-new-pw2").value = "";

      if (TS && TS.reset) { try { TS.reset(); } catch (e) {  } }
      if (!r.ok) {

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

      var hint = $("reset-ok-hint");
      if (hint) {
        if (r.emailVerified === false) {
          hint.hidden = false;
          hint.className = "account-note warn";

          hint.textContent = "新密码还用不了：邮箱未确认，需先去登录页重发确认邮件。";
        } else {
          hint.hidden = true;
          hint.textContent = "";
        }
      }
      try {
        if (window.history && history.replaceState) history.replaceState(null, "", "/reset/");
      } catch (e) {  }
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

    if (TS && api && api.config) {
      api.config().then(function (r) {
        if (!r || !r.ok || !r.turnstile) return;
        tsConfig.enabled = r.turnstile.enabled === true;
        tsConfig.siteKey = r.turnstile.siteKey || "";
        if (tsConfig.enabled) mountTurnstile();
      }, function () {  });
    }

    if (!rid || !resetToken) { state("none"); return; }

    state("form");
    if ($("input-new-pw")) $("input-new-pw").focus();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.ResetPage = { param: param, state: state };
})();
