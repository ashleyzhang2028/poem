/**
 * 认证的服务端通道（1 期 1A 期新增）—— `js/auth-core.js` 的 `transport` 实现。
 * ==========================================================================
 * 现状（0 期 / 1A 期之前）：`js/auth-core.js` 是纯本机内核 —— 码由浏览器生成、
 * 会话也只在本机，那条路**不能承载真实的账号**（换设备就没了）。
 * 本文件补上的就是这一步：把同一套流程接到 `/api/*` 上。
 *
 * 三条边界（沿用 docs/auth-design.md §1，与内核逐条对齐）：
 *   1. **未登录用户的体验与今天逐字一致** —— 后端没配好、挂了、断网，
 *      一律静默降级为「本地体验版」，不弹窗、不打断背诵
 *   2. **不假装有服务器** —— 请求失败时如实说「连不上服务端」，
 *      绝不把本机生成的码说成「已发送」
 *   3. **token 不进 localStorage** —— 会话是服务端签发的 HttpOnly Cookie
 *      （`credentials: "same-origin"`），JS 读不到它，这正是它安全的原因
 *
 * ⚠️ 本文件**不 import 任何东西**、不碰 `document`（除 fetch 与 location），
 *    因此可以在 Node 里 require（见 test/api.test.js）。
 *
 * 用法（页面里）：
 *   var api = window.AuthApi.create();          // 默认 fetch + 同源
 *   api.sendCode({ email, purpose, deviceId })   // → { ok, codeId, ... } | { ok:false, code, message }
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AuthApi = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var BASE = "/api";
  var TIMEOUT_MS = 15000;      // 超过就当作「连不上」，走降级

  /* 错误码 → 给用户看的话。**内核返回什么就说什么**，
     本文件只兜「内核没覆盖到的传输层错误」——重写一份必然与内核漂移。 */
  var TRANSPORT_ERR = {
    E_NOT_CONFIGURED: "这个站点还没开放云端账号，当前是本机体验版",
    E_OFFLINE: "连不上服务端，已切回本机体验版",
    E_TIMEOUT: "服务端响应太慢，已切回本机体验版",
    E_INTERNAL: "服务端出了点问题，稍后再试；期间本站仍可完全离线使用",
    /* 2B：短信通道没开通。**这一条不是「降级」** ——
       服务端是通的、只是短信没接商，所以不许像 E_OFFLINE 那样
       偷偷切回本机体验版（本机版也发不出短信，切过去只是换个说法骗人）。
       界面拿到它应当**如实显示**「还没开通」。 */
    E_SMS_NOT_OPEN: "短信登录还没开通（需要先签短信商并完成模板报备）",
    /* 2.2 权威发放。**这三条都不是「降级」**：服务端是通的，只是这件事没成。
       E_FORBIDDEN 尤其不许被说成「连不上」—— 它是「你确实没这个权限」，
       而用户看到「连不上」会一直重试。 */
    E_FORBIDDEN: "这一条只对管理员开放",
    E_TIER: "层级只认 Free / Pro / Max",
    E_MASK: "邮箱掩码形状不对（形如 a***@qq.com，与账号页上显示的那串一致）"
  };

  function messageOf(code, fallback) {
    return TRANSPORT_ERR[code] || fallback || "操作没成功，请稍后再试";
  }

  /** 有 fetch 才谈得上云端；没有就整体不可用（老 WebView） */
  function supported() {
    return typeof fetch === "function";
  }

  /**
   * 造一个通道。
   *
   * @param {object} opts
   *   · fetch  — 注入用（测试里给假 fetch）；默认用全局那个
   *   · deviceId — 设备标识，随请求带上做频控分桶
   *   · base   — 默认 "/api"
   */
  function create(opts) {
    opts = opts || {};
    var doFetch = opts.fetch || (typeof fetch === "function" ? fetch.bind(typeof globalThis !== "undefined" ? globalThis : this) : null);
    var base = opts.base || BASE;
    var deviceId = opts.deviceId || "";
    var state = {
      /* 最近一次调用是不是「服务端没配好 / 连不上」——
         界面据此展示「本机体验版」，而不是把失败当成功能坏了 */
      degraded: false,
      lastError: null
    };

    function post(path, body) {
      return call(path, "POST", body);
    }

    function call(path, method, body) {
      if (!doFetch) {
        state.degraded = true;
        state.lastError = "E_OFFLINE";
        return Promise.resolve({ ok: false, code: "E_OFFLINE", message: messageOf("E_OFFLINE") });
      }
      var ctrl = typeof AbortController === "function" ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;

      var init = {
        method: method,
        // ⚠️ 会话是 HttpOnly Cookie —— 必须带 credentials，
        //    而 "same-origin"（不是 "include"）能确保只有同源才发 Cookie
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" }
      };
      if (deviceId) init.headers["x-kb-device"] = deviceId;
      if (body !== undefined && body !== null) init.body = JSON.stringify(body);
      if (ctrl) init.signal = ctrl.signal;

      return doFetch(base + path, init).then(function (res) {
        if (timer) clearTimeout(timer);
        return res.text().then(function (text) {
          var data = null;
          try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
          if (!data || typeof data !== "object") {
            state.lastError = "E_INTERNAL";
            return { ok: false, code: "E_INTERNAL", message: messageOf("E_INTERNAL"), status: res.status };
          }
          /* 503 = 服务端没配好：这不是错误，是「本期还没开放」，
             据实标成降级，界面据此继续用本机体验版 */
          if (res.status === 503 || data.code === "E_NOT_CONFIGURED") {
            state.degraded = true;
            state.lastError = "E_NOT_CONFIGURED";
            return { ok: false, code: "E_NOT_CONFIGURED", message: messageOf("E_NOT_CONFIGURED"), status: res.status };
          }
          /* 401 = 没有会话。**不是错误**：未登录是本来的正常状态，
             前端据此保持 local 模式，不弹窗、不打断背诵 */
          if (res.status === 401) {
            state.degraded = false;
            return { ok: false, code: data.code || "E_NO_SESSION", message: messageOf(data.code, data.message), status: 401 };
          }
          if (res.status >= 200 && res.status < 300) {
            state.degraded = false;
            state.lastError = null;
            var out = { ok: true, status: res.status, store: data.store };
            Object.keys(data).forEach(function (k) { out[k] = data[k]; });
            return out;
          }
          state.lastError = data.code || "E_INTERNAL";
          return {
            ok: false,
            code: data.code || "E_INTERNAL",
            message: messageOf(data.code, data.message),
            retryAfter: data.retryAfter,
            remaining: data.remaining,
            status: res.status
          };
        });
      }).catch(function (e) {
        if (timer) clearTimeout(timer);
        var code = (e && e.name === "AbortError") ? "E_TIMEOUT" : "E_OFFLINE";
        // 连不上 = 降级，**不是**错误弹窗 —— docs §10「会话过期静默降级」
        state.degraded = true;
        state.lastError = code;
        return { ok: false, code: code, message: messageOf(code) };
      });
    }

    return {
      degraded: function () { return state.degraded; },
      lastError: function () { return state.lastError; },
      /** 这台设备的标识（随请求带给服务端做频控分桶；拿不到就是空串） */
      deviceId: function () { return deviceId; },

      /** POST /api/send-code */
      /**
       * POST /api/send-code
       * ⚠️ 通道由 `channel` 表达（缺省 "email"，与 1A 的老调用点兼容）：
       *    `value` 是那一通道的标识（邮箱或手机号）。
       *    老字段 `email` 仍然接受，服务端也保留了这个兼容口。
       */
      sendCode: function (input) {
        input = input || {};
        var body = {
          channel: input.channel || "email",
          value: input.value != null ? input.value : (input.channel === "sms" ? input.phone : input.email),
          purpose: input.purpose || "login",
          deviceId: deviceId
        };
        return post("/send-code", body);
      },

      /** POST /api/verify-code —— 成功后服务端会 Set-Cookie */
      verifyCode: function (input) {
        input = input || {};
        return post("/verify-code", {
          codeId: input.codeId,
          code: input.code,
          deviceId: deviceId
        });
      },

      /** GET /api/me —— 权益的唯一来源（服务端判定层级与角色都在这一条上） */
      me: function () { return call("/me", "GET"); },

      /** POST /api/sync/pull */
      pull: function (input) {
        input = input || {};
        return post("/sync/pull", { since: input.since || 0, deviceId: deviceId });
      },

      /** POST /api/sync/push */
      push: function (input) {
        input = input || {};
        return post("/sync/push", { recs: input.recs || [], deviceId: deviceId });
      },

      /* ---------------------------------------------------- 权威发放（2.2）
         这三条**只有管理员用得上**，但传输层不判权限 —— 权限在服务端
         （`accounts.role`）。客户端把入口藏起来不是安全边界（docs §3.5）。
         传输层只做一件事：把参数送到，把 `{ok, code, message}` 带回来。 */

      /** POST /api/admin/grant —— 发放层级（服务端权威名单） */
      grant: function (input) {
        input = input || {};
        return post("/admin/grant", {
          emailMask: input.emailMask,
          tier: input.tier,
          until: input.until == null ? null : input.until,
          deviceId: deviceId
        });
      },

      /** DELETE /api/admin/grant —— 收回（等价于发一个 free） */
      revoke: function (input) {
        input = input || {};
        return call("/admin/grant", "DELETE", {
          emailMask: input.emailMask,
          deviceId: deviceId
        });
      },

      /** POST /api/admin/grants —— 列出服务端那一份权威名单（只读） */
      grants: function () { return post("/admin/grants", { deviceId: deviceId }); },

      /** DELETE /api/account —— 注销（服务端先导出再删行） */
      deleteAccount: function (input) {
        input = input || {};
        return call("/account", "DELETE", { confirm: input.confirm === true, deviceId: deviceId });
      },

      /* ---------------------------------------------------- 古诗词大会（3 期）
         判分口。**它不判权限** —— 权限在服务端（`featuresFor`）。
         这里只把「哪一道题、选了哪一条」送到，把答案带回来。
         ⚠️ 刻意**不传**客户端手上那份答案：传上去也不会被采信
            （服务端从自己的语料重建），传它只会让人误以为「服务端看了客户端的答案」。
            js/game.js 里那一处显式传 `answer` 是**故意留的反例**（有断言守着）。 */
      gameAnswer: function (input) {
        input = input || {};
        return post("/game/answer", {
          kind: input.kind,
          bankId: input.bankId,
          poemId: input.poemId,
          chosen: input.chosen,
          chars: input.chars,
          said: input.said,
          charge: input.charge === true,
          deviceId: deviceId
        });
      }
    };
  }

  return {
    create: create,
    supported: supported,
    messageOf: messageOf,
    TRANSPORT_ERR: TRANSPORT_ERR,
    BASE: BASE,
    TIMEOUT_MS: TIMEOUT_MS
  };
});
