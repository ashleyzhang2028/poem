"use strict";

var https = require("https");

var VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function turnstileReady(cfg) {
  var c = (cfg && (cfg.turnstileEnabled !== undefined || cfg.turnstileSecretKey !== undefined)) ? cfg : null;
  if (!c) return false;

  if (c.turnstileBypass === true) return false;
  if (c.turnstileEnabled !== true) return false;
  return String(c.turnstileSecretKey || "").length > 0;
}

function verify(cfg, input) {
  input = input || {};
  if (!turnstileReady(cfg)) {

    var bypassed = !!(cfg && cfg.turnstileBypass === true);
    return Promise.resolve({ ok: true, skipped: true, reason: bypassed ? "bypass" : "not_configured" });
  }
  var token = String(input.token == null ? "" : input.token).trim();

  if (!token) return Promise.resolve({ ok: false, reason: "missing_token", codes: ["missing-input-response"] });

  var doFetch = input.fetch || (typeof fetch === "function" ? fetch : null);
  var body = new URLSearchParams();
  body.set("secret", String(cfg.turnstileSecretKey));
  body.set("response", token);
  if (input.ip && input.ip !== "unknown") body.set("remoteip", String(input.ip));

  if (!doFetch) {

    return Promise.resolve({ ok: false, reason: "no_fetch" });
  }

  var ctrl = typeof AbortController === "function" ? new AbortController() : null;

  var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 5000) : null;
  var init = {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  };
  if (ctrl) init.signal = ctrl.signal;

  return doFetch(VERIFY_URL, init).then(function (res) {
    if (timer) clearTimeout(timer);
    return res.text().then(function (text) {
      var data = null;
      try { data = JSON.parse(text); } catch (e) { data = null; }
      if (!data || data.success !== true) {

        return { ok: false, reason: "rejected", codes: (data && data.error_codes) || [] };
      }

      var want = hostOf(cfg.siteUrl);
      var got = String(data.hostname || "");
      if (want && got && want !== got) {
        return { ok: false, reason: "hostname_mismatch", codes: [] };
      }
      return { ok: true, reason: "ok" };
    });
  }).catch(function (e) {
    if (timer) clearTimeout(timer);

    return { ok: false, reason: (e && e.name === "AbortError") ? "timeout" : "network" };
  });
}

function hostOf(url) {
  try { return String(new URL(String(url || "")).host || "").toLowerCase(); } catch (e) { return ""; }
}

function guard(cfg, input) {
  return verify(cfg, input).then(function (r) {
    if (r.ok) return null;
    return {
      status: 400,
      body: {
        code: "E_TURNSTILE",
        message: "人机校验没通过，请刷新页面再试一次",

        turnstile: r.reason === "missing_token" ? "missing" : "failed"
      },

      _codes: r.codes || []
    };
  });
}

module.exports = {
  VERIFY_URL: VERIFY_URL,
  turnstileReady: turnstileReady,
  verify: verify,
  guard: guard,
  hostOf: hostOf
};
