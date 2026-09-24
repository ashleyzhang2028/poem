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

  // 装了、也配了，但**校验根本跑不起来**。三种成因：
  //   script_error / script_timeout —— Cloudflare 的脚本压根没加载（公司网、广告拦截、CSP、断网）
  //   no_render_api                —— 脚本加载了但没给出 render API
  //   widget_error / render_failed —— widget 渲染失败：**Site Key 填错**，或
  //                                   本站域名没加进那个 widget 的允许列表（最常见）
  // 这些情况下页面上**没有方框可勾**。旧版把「没 token」一律说成
  // 「请先完成人机校验（上面那个方框）」—— 用户对着一个不存在的方框干等，
  // 而真正的修法（去 Cloudflare 改域名 / 换 Site Key）一个字都没露。
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

  // 挂载点是「用户打开这一屏」时，不是「用户点提交」时（Issue #276）。
  //
  // 用户 2026-09-21 报的就是这条时序：注册页填完邮箱密码、点下「注册」按钮，
  // 验证框才**开始**弹出来，还慢慢转圈。原因不在 Cloudflare，在这儿 ——
  // 页面上只有**提交那一下**才调 mount()，于是「拉脚本(最多 8s) + 渲染 widget
  // + 等 Cloudflare 判人机」这一整段全压在提交后：用户以为卡住了，
  // 服务端还会在 token 没到时回 400 E_TURNSTILE。
  //
  // 现在起的叫法（js/login.js）是「切到哪一屏就挂哪一屏」，所以这里要能扛住
  // 两种新时序，且**都不许把用户挡在门外**：
  //   ① 页面刚打开就挂，脚本还在路上 —— 这不是失败，如实记着，不拦也不报假故障；
  //   ② 挂完这一屏又切到另一屏 —— 方框跟着挪（挪走旧的、在新面板补一个）。
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
      // 老实现这里顺手把 token 也清了。token 是全局的（Cloudflare 只按 widget
      // 回调给值），用户在注册页填表期间切一下屏就会把它抹掉，提交时又变成
      // 「没勾」—— 与 #276 是同一个病灶的另一半。过期由 expired-callback 管，
      // 提交成功后由 reset() 管，**换面板不该管**。
    }
    containerEl = nextContainer;
    if (mounted) { renderWidget(); return Promise.resolve(state()); }

    return loadScript(d).then(function () {
      mounted = true;
      // 上一次挂载已经画过一个方框（这次只是换面板）时，renderWidget 自己会
      // 走 remove + 重新 render 那条路；没画过就直接画。
      renderWidget();
      return state();
    }, function (why) {
      st.err = why || "script_load_failed";
      return state();
    });
  }

  // 同一个页面只挂一次 <script>：谁先到谁算（preload 常常是先到的那一个）。
  // 要是各挂各的，页面打开时 preload 插一个、拿到 siteKey 后 mount 又插一个，
  // 用户会看到两个方框。
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

  // 页面一打开就叫它：先把 Cloudflare 的脚本拉起来（这时多半还没拿到 siteKey，
  // 所以不等它渲染）。这是 Issue #276 的正解 —— 原先「拉脚本（最多 8 秒）+
  // 渲染 widget + 等 Cloudflare 判人机」这一整段都压在点提交之后，
  // 用户看到的就是「点完按钮，验证框才慢慢冒出来」。
  // 现在：脚本在用户**还在读登录页**时就已经在路上。
  var preloaded = false;

  function preload() {
    var d = doc();
    if (!d || preloaded) return Promise.resolve(state());
    preloaded = true;
    return loadScript(d).then(function () {
      // 脚本到了，而 widget 还没画（拿到了 siteKey 但脚本后到的那条路）：
      // 补画一次。已经画过就什么都不做。
      if (st.configured && st.widgetId === null && containerEl) renderWidget();
      return state();
    }, function () {
      // 加载失败先不声张：页面上可能压根没配人机校验，这时报「坏了」是假故障。
      // 真需要拦人的那一步（mount / gate）会自己把话说清楚。
      return state();
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
    // 校验跑不起来 = 没有方框可勾。这里必须放行：否则用户会被一句
    // 「请先完成人机校验」钉死在页面上，而那个方框永远不会出现。
    // 闸门仍在服务端 —— 真绕过前端提交，服务端回 400 E_TURNSTILE。
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
