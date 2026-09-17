(function (root, factory) {

  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else root.Turnstile = factory(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  var LOAD_TIMEOUT_MS = 8000;

  var st = {
    configured: false,
    ready: false,
    skipped: true,
    err: null,
    tokenValue: "",
    widgetId: null
  };

  var mounted = false;
  var siteKeyValue = "";
  var containerEl = null;
  var onTokenCb = null;

  function doc() {
    return (typeof document !== "undefined") ? document : null;
  }

  function state() {
    return {
      configured: st.configured,
      ready: st.ready,
      skipped: st.skipped,
      err: st.err,
      token: st.tokenValue
    };
  }

  function required() { return !st.skipped; }

  function configure(opts) {
    opts = opts || {};
    var key = String(opts.siteKey == null ? "" : opts.siteKey).trim();
    siteKeyValue = key;
    st.configured = key.length > 0 && opts.enabled !== false;

    st.skipped = !st.configured;
    if (!st.configured) { st.err = null; st.ready = false; }
    return state();
  }

  function mount(target, opts) {
    opts = opts || {};
    onTokenCb = typeof opts.onToken === "function" ? opts.onToken : null;
    var cfgState = configure({ siteKey: opts.siteKey, enabled: opts.enabled });

    if (!st.configured) return Promise.resolve(cfgState);

    var d = doc();
    if (!d) { st.err = "no_dom"; return Promise.resolve(state()); }
    containerEl = (typeof target === "string") ? d.getElementById(target) : target;
    if (!containerEl) { st.err = "no_target"; return Promise.resolve(state()); }
    if (mounted) { renderWidget(); return Promise.resolve(state()); }

    return loadScript(d).then(function () {
      mounted = true;
      renderWidget();
      return state();
    }, function (why) {
      st.err = why || "script_load_failed";
      return state();
    });
  }

  function loadScript(d) {
    return new Promise(function (resolve, reject) {

      if (d.querySelector && d.querySelector('script[data-kb-turnstile="1"]')) return resolve();
      if (root.turnstile && typeof root.turnstile.render === "function") return resolve();
      var s = d.createElement("script");
      s.src = SCRIPT_SRC;
      s.async = true;
      s.defer = true;
      s.setAttribute("data-kb-turnstile", "1");
      var timer = setTimeout(function () { reject("script_timeout"); }, LOAD_TIMEOUT_MS);
      s.onload = function () { clearTimeout(timer); resolve(); };
      s.onerror = function () { clearTimeout(timer); reject("script_error"); };
      (d.head || d.body).appendChild(s);
    });
  }

  function renderWidget() {
    if (!root.turnstile || typeof root.turnstile.render !== "function") {
      st.err = "no_render_api";
      return;
    }
    if (st.widgetId !== null) {

      try { root.turnstile.reset(st.widgetId); } catch (e) { st.err = "reset_failed"; }
      return;
    }
    try {
      st.widgetId = root.turnstile.render(containerEl, {
        sitekey: siteKeyValue,

        appearance: "always",
        callback: function (tok) {
          st.tokenValue = String(tok || "");
          st.ready = true;
          if (onTokenCb) onTokenCb(st.tokenValue);
        },
        "error-callback": function () {
          st.err = "widget_error";
          return true;
        },
        "expired-callback": function () {

          st.tokenValue = "";
        }
      });
    } catch (e) {
      st.err = "render_failed";
      st.widgetId = null;
    }
  }

  function token() { return st.tokenValue; }

  function reset() {
    st.tokenValue = "";
    st.ready = false;
    if (!st.configured || st.widgetId === null) return state();
    if (root.turnstile && typeof root.turnstile.reset === "function") {
      try { root.turnstile.reset(st.widgetId); } catch (e) { st.err = "reset_failed"; }
    }
    return state();
  }

  function gate() {
    if (st.skipped) return null;
    if (st.tokenValue) return null;
    if (st.err === "script_error" || st.err === "script_timeout" || st.err === "no_render_api") {

      return null;
    }
    return "请先完成人机校验（上面那个方框）";
  }

  function _resetForTest() {
    st.configured = false; st.ready = false; st.skipped = true;
    st.err = null; st.tokenValue = ""; st.widgetId = null;
    mounted = false; siteKeyValue = ""; containerEl = null; onTokenCb = null;
  }

  return {
    SCRIPT_SRC: SCRIPT_SRC,
    configure: configure,
    mount: mount,
    state: state,
    required: required,
    token: token,
    reset: reset,
    gate: gate,
    _resetForTest: _resetForTest
  };
});
