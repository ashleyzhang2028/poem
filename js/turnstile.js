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

  var BROKEN = ["script_error", "script_timeout", "no_render_api", "widget_error", "render_failed"];

  function failed() { return BROKEN.indexOf(st.err) >= 0; }

  function why() {
    if (!st.configured) return "";
    if (st.err === "widget_error" || st.err === "render_failed") {
      return "人机校验的方框没能加载出来（多半是 Site Key 填错了，或本站域名没加进 Cloudflare 那个 widget 的允许列表）。" +
        "这不是你网络的问题，请联系站点管理员；在此之前这类操作暂时做不了。";
    }
    if (st.err === "script_timeout" || st.err === "script_error") {
      return "加载人机校验脚本失败（浏览器拦下了 challenges.cloudflare.com，或网络不通）。" +
        "请关掉广告拦截 / 换一个网络再试；一直不行就联系站点管理员。";
    }
    if (st.err === "no_render_api") {
      return "人机校验脚本没给出可用的接口（多半是被网络中间层改写了）。请联系站点管理员。";
    }
    return "";
  }

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
    var nextContainer = (typeof target === "string") ? d.getElementById(target) : target;
    if (!nextContainer) { st.err = "no_target"; return Promise.resolve(state()); }
    if (st.widgetId !== null && containerEl && containerEl !== nextContainer) {
      if (root.turnstile && typeof root.turnstile.remove === "function") {
        try { root.turnstile.remove(st.widgetId); } catch (e) {  }
      } else if (containerEl.innerHTML !== undefined) {
        containerEl.innerHTML = "";
      }
      st.widgetId = null;

    }
    containerEl = nextContainer;
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

  var scriptPromise = null;

  function loadScript(d) {

    if (d.querySelector && d.querySelector('script[data-kb-turnstile="1"]')) return Promise.resolve();
    if (root.turnstile && typeof root.turnstile.render === "function") return Promise.resolve();
    if (scriptPromise) return scriptPromise;

    scriptPromise = new Promise(function (resolve, reject) {
      var s = d.createElement("script");
      s.src = SCRIPT_SRC;
      s.async = true;
      s.defer = true;
      s.setAttribute("data-kb-turnstile", "1");
      var timer = setTimeout(function () { scriptPromise = null; reject("script_timeout"); }, LOAD_TIMEOUT_MS);
      s.onload = function () { clearTimeout(timer); resolve(); };
      s.onerror = function () { clearTimeout(timer); scriptPromise = null; reject("script_error"); };
      (d.head || d.body).appendChild(s);
    });
    return scriptPromise;
  }

  var preloaded = false;

  function preload() {
    var d = doc();
    if (!d || preloaded) return Promise.resolve(state());
    preloaded = true;
    return loadScript(d).then(function () {

      if (st.configured && st.widgetId === null && containerEl) renderWidget();
      return state();
    }, function () {

      return state();
    });
  }

  function renderWidget() {
    if (!root.turnstile || typeof root.turnstile.render !== "function") {

      st.ready = false;
      return;
    }
    st.err = null;
    if (st.widgetId !== null) {

      try { root.turnstile.reset(st.widgetId); } catch (e) { st.err = "reset_failed"; }
      return;
    }
    try {
      st.widgetId = root.turnstile.render(containerEl, {
        sitekey: siteKeyValue,
        size: "flexible",

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

    if (failed()) return null;
    return "请先完成人机校验（上面那个方框）";
  }

  function _resetForTest() {
    st.configured = false; st.ready = false; st.skipped = true;
    st.err = null; st.tokenValue = ""; st.widgetId = null;
    mounted = false; siteKeyValue = ""; containerEl = null; onTokenCb = null;
    scriptPromise = null; preloaded = false;
  }

  return {
    SCRIPT_SRC: SCRIPT_SRC,
    configure: configure,
    preload: preload,
    mount: mount,
    state: state,
    required: required,
    token: token,
    reset: reset,
    gate: gate,
    failed: failed,
    why: why,
    _resetForTest: _resetForTest
  };
});
