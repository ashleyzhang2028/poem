/**
 * Cloudflare Turnstile —— 人机校验（前端那半边）
 * ==========================================================================
 * 用户 2026-09-17（Issue #197 后续）：登录 / 注册 / 密码找回 / 密码 /
 * 发送随机码等页面都要接入 Turnstile。
 *
 * 这个文件做三件事，一件比一件难：
 *   ① 把 Cloudflare 的 widget 渲染出来（要么真的渲染，要么**如实说不渲染**）
 *   ② 交出一个 `token()`，让各页在发请求时带上
 *   ③ 请求回来是 `E_TURNSTILE` 时，把 widget 重置（token 一次性，用过即废）
 *
 * ## 三条口径（与 `api/_lib/turnstile.js` 那句「前端只做省一次请求」同源）
 *
 *   1. **不假装有人机校验**。没有 siteKey（没配）时，这个模块**不渲染任何东西**，
 *      并在 `state()` 里如实说 `{configured:false, ready:false, skipped:true}`。
 *      页面上**不许**摆一个空壳 widget 让人以为「有校验」——
 *      与 console 发信商那件事是同一条纪律（§12 总原则：不许跑在代码前面）。
 *   2. **不阻塞没有它的实例**。配了才渲染；渲染失败（网络 / 脚本被拦）
 *      一样放行 —— 因为**真闸在服务端**，前端渲染失败不该把用户锁在门外。
 *      ⚠️ 但要如实标出来（`state().err`），而且服务端那一侧仍会按事实回答。
 *   3. **token 一次性**。Cloudflare 的 token 用过即废，所以每次提交后
 *      （无论成没成）都要 `reset()`。不重置的下场是「第二次点按钮必失败」，
 *      而用户看到的是「人机校验没通过」，以为是自己做错了什么。
 *
 * ## 为什么脚本是**动态注入**的，而不是在 HTML 里写一个 <script src>
 *
 * 因为 siteKey 来自服务端（`/api/me` 的 `channel` 里没有它 —— 那是登录后才有的），
 * 而且没配时**一个字都不该发出去**（不发请求给 Cloudflare 的 CDN）。
 * 写死在 HTML 里就必须先有一个 siteKey，而那正是「没配」时没有的东西。
 * 动态注入也顺手避免了「每个页面同步加载一个第三方脚本」。
 *
 * ⚠️ 本文件**不 import 任何东西**，可在 Node 里 require（见 test/account-pages.test.js）。
 *    DOM 只在 `mount()` 里碰，`token()` / `state()` / `reset()` 都是纯读状态。
 */
(function (root, factory) {
  /* ⚠️ `root` **必须传进工厂**（`factory(root)`），不能只在外层用它挂 `Turnstile` ——
     厂里那几处 `root.turnstile.*`（Cloudflare 的全局）与 `root` 上挂的
     那个自定义事件用的是**同一个 root**。少传一个参数的下场实测过：
     厂里的 `root` 解析成 `undefined`，`root.turnstile` 抛异常，
     而它被 try/catch 吞成 `err: {}` —— 界面上表现为「widget 不渲染」，
     却看不出任何原因（这个坑正是本节测试 ⑤b 抓出来的）。 */
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else root.Turnstile = factory(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  var LOAD_TIMEOUT_MS = 8000;    // 脚本 8 秒没来就当作「加载失败」，不把用户晾着

  /* 默认**不渲染**、**不加载**。`mount()` 被叫到、而且拿到了 siteKey，才动。 */
  var st = {
    configured: false,   // 有没有 siteKey（没有 = 这台服务器没开人机校验）
    ready: false,        // widget 渲染好了没有
    skipped: true,       // 这一路请求**要不要**带 token（false = 必须带）
    err: null,           // 加载 / 渲染失败的原因（给控制台与测试看，不上屏）
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

  /** 当前状态（**只读**）—— 给页面与测试用 */
  function state() {
    return {
      configured: st.configured,
      ready: st.ready,
      skipped: st.skipped,
      err: st.err,
      token: st.tokenValue
    };
  }

  /**
   * 配没配 —— 页面据此决定要不要给「提交」那颗键挂一道前置检查。
   *
   * ⚠️ 判据是 `skipped`：它表示「这一路请求**不需要**带 token」。
   *    没配（或旁路开着）时为 true，页面**不该**因为拿不到 token 就拦住用户。
   */
  function required() { return !st.skipped; }

  /** 把服务端自报的开关与 page 上拿到的 siteKey 设进来 */
  function configure(opts) {
    opts = opts || {};
    var key = String(opts.siteKey == null ? "" : opts.siteKey).trim();
    siteKeyValue = key;
    st.configured = key.length > 0 && opts.enabled !== false;
    /* 没配 / 被显式关掉 → 这一路请求**不带 token**，也不渲染任何东西。
       把 `ready` 留成 false 是刻意的：界面据此知道「没有人机校验」这件事。 */
    st.skipped = !st.configured;
    if (!st.configured) { st.err = null; st.ready = false; }
    return state();
  }

  /**
   * 渲染 widget。
   *
   * @param {Element|string} target  容器元素，或它的 id
   * @param {object} opts            { siteKey, enabled, theme, onToken, onError }
   * @returns {Promise<object>}      解析成 `state()`
   *
   * ⚠️ **任何一步失败都不抛**，一律 resolve（并把 `err` 记在 state 里）：
   *    人机校验是「多一道门」，不该因为 CDN 抖一下就把整页功能弄坏。
   *    真正的裁决在服务端，前端这里失败只意味着「这一次没带 token」。
   */
  function mount(target, opts) {
    opts = opts || {};
    onTokenCb = typeof opts.onToken === "function" ? opts.onToken : null;
    var cfgState = configure({ siteKey: opts.siteKey, enabled: opts.enabled });
    /* 没配：**一个字节都不发出去**（连 Cloudflare 的脚本都不加载）。
       返回的就是「如实说不渲染」的那一份状态。 */
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

  /** 注入 Cloudflare 的脚本（**只注一次**；已存在就不重复注） */
  function loadScript(d) {
    return new Promise(function (resolve, reject) {
      /* 已经注过（页面里两次调用 mount）→ 直接过 */
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

  /** 真渲染。`turnstile.render` 是脚本给自己的全局函数 */
  function renderWidget() {
    if (!root.turnstile || typeof root.turnstile.render !== "function") {
      st.err = "no_render_api";
      return;
    }
    if (st.widgetId !== null) {
      /* 已经渲染过：`reset()` 就够了（第二次渲染会在同一个容器里叠一个） */
      try { root.turnstile.reset(st.widgetId); } catch (e) { st.err = "reset_failed"; }
      return;
    }
    try {
      st.widgetId = root.turnstile.render(containerEl, {
        sitekey: siteKeyValue,
        /* `appearance: "always"`：这一页只有这一件事要做，
           不必用 Cloudflare 那套「交互式才现身」的省地方模式。 */
        appearance: "always",
        callback: function (tok) {
          st.tokenValue = String(tok || "");
          st.ready = true;
          if (onTokenCb) onTokenCb(st.tokenValue);
        },
        "error-callback": function () {
          st.err = "widget_error";
          return true;      // 返回 true = 让 widget 自己重试一次
        },
        "expired-callback": function () {
          /* 过期的 token **不能再当可用** —— 留着它，提交时会拿到服务端的
             「人机校验没通过」，而用户以为自己刚做过。清掉才是诚实的。 */
          st.tokenValue = "";
        }
      });
    } catch (e) {
      st.err = "render_failed";
      st.widgetId = null;
    }
  }

  /**
   * 取当前 token（**可能为空**）。
   *
   * ⚠️ 空的含义有两档，页面**必须分得清**：
   *   · `skipped:true`（没配）→ 空是正常的，照常提交（服务端会跳过校验）
   *   · `skipped:false` 而空 → 用户还没勾 / token 过期 → 提交会被服务端拒
   * 页面据 `required()` 判，不要自己看 `token === ""`（那会把「没配」也拦下来）。
   */
  function token() { return st.tokenValue; }

  /**
   * 重置（token 一次性，提交后必调）。
   *
   * 没渲染 / 没配时是个**安全的空操作** —— 页面可以无条件调它，
   * 不必先判「有没有 widget」（判断散在各页就是漂移的开始）。
   */
  function reset() {
    st.tokenValue = "";
    st.ready = false;
    if (!st.configured || st.widgetId === null) return state();
    if (root.turnstile && typeof root.turnstile.reset === "function") {
      try { root.turnstile.reset(st.widgetId); } catch (e) { st.err = "reset_failed"; }
    }
    return state();
  }

  /**
   * 页面提交前的**前置判断**（省一次必然失败的请求）。
   *
   * @returns {null|string}  null = 放行；字符串 = 该就地提示的那句话
   *
   * ⚠️ 没配（`skipped`）时**永远放行** —— 这是本节最要紧的一条：
   *    在一个没配 siteKey 的实例上，如果这里因为「拿不到 token」拦住用户，
   *    那就是**用一句假话把所有人锁在门外**（那儿压根没有人机校验）。
   */
  function gate() {
    if (st.skipped) return null;
    if (st.tokenValue) return null;
    if (st.err === "script_error" || st.err === "script_timeout" || st.err === "no_render_api") {
      /* 脚本没加载出来：**不拦**（真闸在服务端），但也不装没这回事 —— 让服务端说。 */
      return null;
    }
    return "请先完成人机校验（上面那个方框）";
  }

  /** 测试 / 调试用：把内部状态清干净（重新 mount 时用） */
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
