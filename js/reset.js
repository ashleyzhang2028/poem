(function () {
  "use strict";

  var api = (window.AuthApi && window.AuthApi.supported()) ? window.AuthApi.create({}) : null;

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

  function bindEye(btnId, inputId) {
    var button = $(btnId), input = $(inputId);
    if (!button || !input) return;
    function render(shown) {
      button.innerHTML = shown
        ? '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 6.2A10.7 10.7 0 0 1 12 6c6 0 9.5 6 9.5 6a15.6 15.6 0 0 1-2.1 2.8M6.2 6.2A15.8 15.8 0 0 0 2.5 12s3.5 6 9.5 6a10.5 10.5 0 0 0 3.8-.7"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>'
        : '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>';
      button.setAttribute("aria-label", shown ? "隐藏密码" : "显示密码");
      button.setAttribute("title", shown ? "隐藏密码" : "显示密码");
      button.setAttribute("aria-pressed", shown ? "true" : "false");
    }
    button.addEventListener("click", function () {
      var shown = input.type === "text";
      input.type = shown ? "password" : "text";
      render(!shown);
    });
    render(input.type === "text");
  }

  var rid = "";

  function confirmReset() {
    return submitPending("btn-reset-confirm", "重设中…", function () {
    if (!api) { msg("连不上服务器，请稍后再试", "warn"); return; }
    var pw = ($("input-new-pw") || {}).value || "";
    var pw2 = ($("input-new-pw2") || {}).value || "";
    var token = param("token") || resetToken;
    if (!pw) { msg("请先填新密码", "warn"); return; }
    if (pw.length < 8) { msg("密码至少 8 位", "warn"); return; }
    if (pw !== pw2) { msg("两次填的密码不一样", "warn"); return; }
    if (!token) { state("none"); return; }

    msg("");
    return api.resetConfirm({ rid: rid, token: token, password: pw }).then(function (r) {

      if ($("input-new-pw")) $("input-new-pw").value = "";
      if ($("input-new-pw2")) $("input-new-pw2").value = "";

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

          hint.textContent = "邮箱尚未验证，请先在登录页重新发送验证邮件。";
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

    bindEye("btn-new-eye", "input-new-pw");
    bindEye("btn-new-eye2", "input-new-pw2");
    ["input-new-pw", "input-new-pw2"].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); confirmReset(); } });
    });

    if (!rid || !resetToken) { state("none"); return; }

    state("form");
    if ($("input-new-pw")) $("input-new-pw").focus();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.ResetPage = { param: param, state: state };
})();
