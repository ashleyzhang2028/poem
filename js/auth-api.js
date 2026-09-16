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
    E_MASK: "邮箱掩码形状不对（形如 a***@qq.com，与账号页上显示的那串一致）",

    /* ---- Issue #197：完整登录流程那五条 ----
       ⚠️ 这一组**没有一条是「降级」**：服务端是通的，只是这件事没成。
          尤其 E_LOGIN_FAIL —— 它必须原样说「邮箱或密码不对」，
          客户端不许把它改写成更具体的任何一种（那就成了邮箱枚举）。 */
    E_LOGIN_FAIL: "邮箱或密码不对",
    E_PW_EMPTY: "请先填密码",
    E_PW_SHORT: "密码太短了（至少 8 位）",
    E_PW_LONG: "密码太长了（最多 72 个字符）",
    E_CONFIRM_PW: "两次填的密码不一样",
    E_NO_TOKEN: "链接不完整，请重新发一封邮件",
    E_TOKEN_INVALID: "这个链接不对，请重新发一封邮件",
    E_TOKEN_USED: "这个链接已经用过了",
    E_TOKEN_EXPIRED: "链接已过期，请重新发一封邮件",
    E_VERIFY_MAIL_FAIL: "确认邮件没能发出去，请稍后再试",
    E_RESET_MAIL_FAIL: "重设邮件没能发出去，请稍后再试",
    /* Issue #197 后半段：**邮箱没确认就不让登录**。
       ⚠️ 这一条同样**不是降级**：服务端是通的、口令也是对的，
          只是这一步没成。**绝不**把它说成「连不上服务端」——
          那会让用户一直重试登录，而他要做的是去收件箱。
       文案里那句「去收件箱点确认」是**唯一有用**的下一步，别删。 */
    E_EMAIL_UNVERIFIED: "邮箱还没确认：请点开注册时那封确认邮件里的链接。没收到就点「重新发一封」。"
  };

  /**
   * **口令那几条路专用**的传输失败文案（Issue #197）。
   *
   * ⚠️ 必须与 `TRANSPORT_ERR` 分开，而且这一分是**非做不可的**：
   *    通用那一份写的是「已切回本机体验版」—— 对随机码那条路是**真的**
   *    （它确实会回落到本机内核），但对注册 / 密码登录 / 忘记密码 / 重设
   *    **是假的**：那四件事压根没有本机版本（口令摘要要有服务端 pepper、
   *    要落库，在浏览器里存一份等于把「谁都改得动」的东西当凭据）。
   *    照抄通用文案的下场是实测到的这个：服务端连不上时界面上写着
   *    「已切回本机体验版」，而用户什么都做不了 —— 一句当场被自己推翻的话。
   */
  var PASSWORD_ERR = {
    E_NOT_CONFIGURED: "这台服务器还没开放云端账号，暂时不能注册或改密码",
    E_OFFLINE: "连不上服务器，暂时不能注册或改密码",
    E_TIMEOUT: "服务端响应太慢，暂时不能注册或改密码",
    E_INTERNAL: "服务端出了点问题，稍后再试"
  };

  function messageOf(code, fallback) {
    return TRANSPORT_ERR[code] || fallback || "操作没成功，请稍后再试";
  }

  /** 口令那几条路的传输失败文案（见 `PASSWORD_ERR` 那段说明） */
  function passwordMessageOf(code, fallback) {
    return PASSWORD_ERR[code] || messageOf(code, fallback);
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

    /**
     * @param {string} path
     * @param {object} body
     * @param {object|null} errs  这一条路自己的**传输失败文案表**。
     *   不传就用通用那一份（会说「已切回本机体验版」）。
     *   口令那几条必须传 `PASSWORD_ERR` —— 理由见那张表的注释。
     */
    function post(path, body, errs) {
      return call(path, "POST", body, errs);
    }

    function call(path, method, body, errs) {
      var em = errs
        ? function (c) { return errs[c] || messageOf(c); }
        : messageOf;
      if (!doFetch) {
        state.degraded = true;
        state.lastError = "E_OFFLINE";
        return Promise.resolve({ ok: false, code: "E_OFFLINE", message: em("E_OFFLINE") });
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
            return { ok: false, code: "E_INTERNAL", message: em("E_INTERNAL"), status: res.status };
          }
          /* 503 = 服务端没配好：这不是错误，是「本期还没开放」，
             据实标成降级，界面据此继续用本机体验版 */
          if (res.status === 503 || data.code === "E_NOT_CONFIGURED") {
            state.degraded = true;
            state.lastError = "E_NOT_CONFIGURED";
            return { ok: false, code: "E_NOT_CONFIGURED", message: em("E_NOT_CONFIGURED"), status: res.status };
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
            /* ------------------------------------------------------------------
               `E_EMAIL_UNVERIFIED` 那三个附带字段（Issue #197 后半段）
               ------------------------------------------------------------------
               它们是**给界面说实话用的**，不是给界面做判断用的：
                 · emailMask      —— 回显「发往哪个邮箱」（掩码，不是明文）
                 · verifySent     —— 刚才这一下**真的**又发了一封没有
                 · verifyTransport—— 走的是哪个通道（console = 真实用户收不到）
               不把这些带出来的下场实测过：界面只能写一句笼统的
               「邮箱还没确认」——而用户最需要知道的恰恰是
               「信到底发出去了没有／这台服务器发不发得出去」。
               ⚠️ 别把它们与「这条错误是不是降级」混在一起：
                  它仍然是一条**实打实的失败**（ok:false）。
               ------------------------------------------------------------------ */
            emailMask: data.emailMask,
            verifySent: data.verifySent,
            verifyTransport: data.verifyTransport,
            emailVerified: data.emailVerified,
            requiresVerification: data.requiresVerification,
            status: res.status
          };
        });
      }).catch(function (e) {
        if (timer) clearTimeout(timer);
        var code = (e && e.name === "AbortError") ? "E_TIMEOUT" : "E_OFFLINE";
        // 连不上 = 降级，**不是**错误弹窗 —— docs §10「会话过期静默降级」
        state.degraded = true;
        state.lastError = code;
        return { ok: false, code: code, message: em(code) };
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

      /* ------------------------------------------------ 完整登录流程（Issue #197）
         六条路：注册 / 口令登录 / 确认邮箱 / 重发确认 / 忘记密码两步。
         ⚠️ 传输层只做一件事：把参数送到，把 `{ok, code, message}` 带回来。
            业务规则（口令多长、令牌怎么校验）全在服务端内核里，
            这一层**一条都不新造** —— 造一条就是两处规则开始漂移。 */

      /** POST /api/register —— 注册（邮箱 + 口令）。**注册完还要确认邮件** */
      register: function (input) {
        input = input || {};
        return post("/register", {
          email: input.email,
          password: input.password,
          deviceId: deviceId
        }, PASSWORD_ERR);
      },

      /** POST /api/login —— 邮箱 + 口令登录（与随机码那条路签发同一枚会话） */
      login: function (input) {
        input = input || {};
        return post("/login", {
          email: input.email,
          password: input.password,
          deviceId: deviceId
        }, PASSWORD_ERR);
      },

      /** POST /api/verify-email —— 点邮件里那条链接确认邮箱（不需要登录） */
      verifyEmail: function (input) {
        input = input || {};
        return post("/verify-email", { vid: input.vid, token: input.token }, PASSWORD_ERR);
      },

      /** POST /api/resend-verification —— 重发确认邮件（**要登录**） */
      resendVerification: function () {
        return post("/resend-verification", { deviceId: deviceId }, PASSWORD_ERR);
      },

      /**
       * POST /api/resend-verification-by-email —— 重发确认邮件（**匿名**）。
       *
       * ⚠️ 为什么要有一条匿名的：默认口径是「没确认就不让登录」，
       *    而**登不进来的人正是最需要重发那封信的人**。
       *    只留要登录那一条的话，界面上那颗「重新发一封」是一颗
       *    点了必然 401 的假键 —— 比不摆它更糟（用户会以为是自己点错了）。
       */
      resendVerificationByEmail: function (input) {
        input = input || {};
        return post("/resend-verification-by-email", { email: input.email, deviceId: deviceId }, PASSWORD_ERR);
      },

      /** POST /api/reset-request —— 忘记密码第一步：发重设邮件 */
      resetRequest: function (input) {
        input = input || {};
        return post("/reset-request", { email: input.email, deviceId: deviceId }, PASSWORD_ERR);
      },

      /** POST /api/reset-confirm —— 忘记密码第二步：真正换掉口令 */
      resetConfirm: function (input) {
        input = input || {};
        return post("/reset-confirm", {
          rid: input.rid,
          token: input.token,
          password: input.password,
          deviceId: deviceId
        }, PASSWORD_ERR);
      },

      /** POST /api/admin/accounts —— 列出全部账号（只读，**回明文邮箱**） */
      accounts: function () { return post("/admin/accounts", { deviceId: deviceId }); },

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
    passwordMessageOf: passwordMessageOf,
    TRANSPORT_ERR: TRANSPORT_ERR,
    PASSWORD_ERR: PASSWORD_ERR,
    BASE: BASE,
    TIMEOUT_MS: TIMEOUT_MS
  };
});
