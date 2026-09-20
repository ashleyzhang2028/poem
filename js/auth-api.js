(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AuthApi = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var BASE = "/api";
  var TIMEOUT_MS = 15000;

  var TRANSPORT_ERR = {
    E_NOT_CONFIGURED: "这个站点还没开放云端账号，当前是本机体验版",
    E_OFFLINE: "无法连接服务器，请检查网络后重试。",
    E_TIMEOUT: "服务器响应超时，请稍后重试。",
    E_INTERNAL: "服务暂时不可用，请稍后重试。",

    E_SMS_NOT_OPEN: "短信登录还没开通（需要先签短信商并完成模板报备）",

    E_FORBIDDEN: "这一条只对管理员开放",
    E_TIER: "层级只认 Free / Pro / Max",
    E_MASK: "邮箱掩码形状不对（形如 a***@qq.com，与账号页上显示的那串一致）",

    E_LOGIN_FAIL: "邮箱或密码不对",
    E_PW_EMPTY: "请先填密码",
    E_PW_SHORT: "密码太短了（至少 8 位）",
    E_PW_LONG: "密码太长了（最多 72 个字符）",
    E_CONFIRM_PW: "两次填的密码不一样",
    E_NO_TOKEN: "链接不完整，请重新发一封邮件",
    E_TOKEN_INVALID: "这个链接不对，请重新发一封邮件",
    E_TOKEN_USED: "这个链接已经用过了",
    E_TOKEN_EXPIRED: "链接已过期，请重新发一封邮件",
    E_VERIFY_MAIL_FAIL: "验证邮件暂时无法发送，请稍后重试。",
    E_RESET_MAIL_FAIL: "重设邮件暂时无法发送，请稍后重试。",

    E_EMAIL_UNVERIFIED: "邮箱尚未验证，请打开验证邮件中的链接。",

    E_TURNSTILE: "人机校验没通过，请刷新页面再试一次"
  };

  var AVATAR_ERR = {
    E_NOT_CONFIGURED: "这台服务器还没开放云端账号，头像只存在本机",
    E_OFFLINE: "连不上服务端，头像已存在本机、还没同步到服务器",
    E_TIMEOUT: "传得太慢了，头像已存在本机、还没同步到服务器",
    E_NO_SESSION: "登录之后才能把头像同步到其它设备",
    E_TYPE: "只支持 PNG / JPG 图片",
    E_TOO_BIG: "图片太大了（请选 1MB 以内的）",
    E_NO_BODY: "没有收到图片数据，请重选一次",
    E_UPSTREAM: "头像没能传上去，请稍后再试",
    E_NO_BUCKET: "服务器上的图片存储还没建好，头像暂时只存在本机",
    E_RATE_DEVICE: "换头像太频繁了，请稍后再试"
  };

  var PASSWORD_ERR = {
    E_NOT_CONFIGURED: "这台服务器还没开放云端账号，暂时不能注册或改密码",
    E_OFFLINE: "无法连接服务器，请检查网络后重试。",
    E_TIMEOUT: "服务器响应超时，请稍后重试。",
    E_INTERNAL: "服务暂时不可用，请稍后重试。"
  };

  function messageOf(code, fallback) {
    return TRANSPORT_ERR[code] || fallback || "操作没成功，请稍后再试";
  }

  function passwordMessageOf(code, fallback) {
    return PASSWORD_ERR[code] || messageOf(code, fallback);
  }

  function turnstileToken() {
    try {
      var g = (typeof globalThis !== "undefined") ? globalThis : null;
      var T = g ? g.Turnstile : null;
      if (T && typeof T.token === "function") return String(T.token() || "");
    } catch (e) {  }
    return "";
  }

  function supported() {
    return typeof fetch === "function";
  }

  function create(opts) {
    opts = opts || {};
    var doFetch = opts.fetch || (typeof fetch === "function" ? fetch.bind(typeof globalThis !== "undefined" ? globalThis : this) : null);
    var base = opts.base || BASE;
    var deviceId = opts.deviceId || "";
    var state = {

      degraded: false,
      lastError: null
    };

    function post(path, body, errs) {
      return call(path, "POST", body, errs);
    }

    function call(path, method, body, errs) {
      return send(path, method, errs, function (init) {
        init.headers["Content-Type"] = "application/json";
        if (body !== undefined && body !== null) init.body = JSON.stringify(body);
      });
    }

    function callBinary(path, method, bytes, type, errs) {
      var size = (bytes && bytes.length) || (bytes && bytes.size) || 0;
      var limit = TIMEOUT_MS + Math.min(45000, Math.round(size / 1024) * 300);
      return send(path, method, errs, function (init) {
        init.headers["Content-Type"] = type || "application/octet-stream";
        if (bytes !== undefined && bytes !== null) init.body = bytes;
      }, limit);
    }

    function send(path, method, errs, shape, timeoutMs) {
      var em = errs
        ? function (c) { return errs[c] || messageOf(c); }
        : messageOf;
      if (!doFetch) {
        state.degraded = true;
        state.lastError = "E_OFFLINE";
        return Promise.resolve({ ok: false, code: "E_OFFLINE", message: em("E_OFFLINE") });
      }
      var ctrl = typeof AbortController === "function" ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || TIMEOUT_MS) : null;

      var init = {
        method: method,

        credentials: "same-origin",
        headers: {}
      };
      if (deviceId) init.headers["x-kb-device"] = deviceId;
      if (shape) shape(init);
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

          if (res.status === 503 || data.code === "E_NOT_CONFIGURED") {
            state.degraded = true;
            state.lastError = "E_NOT_CONFIGURED";
            return { ok: false, code: "E_NOT_CONFIGURED", message: em("E_NOT_CONFIGURED"), status: res.status };
          }

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

        state.degraded = true;
        state.lastError = code;
        return { ok: false, code: code, message: em(code) };
      });
    }

    return {
      degraded: function () { return state.degraded; },
      lastError: function () { return state.lastError; },

      deviceId: function () { return deviceId; },

      sendCode: function (input) {
        input = input || {};
        var body = {
          channel: input.channel || "email",
          value: input.value != null ? input.value : (input.channel === "sms" ? input.phone : input.email),
          purpose: input.purpose || "login",
          deviceId: deviceId
        };

        if (input.turnstileToken != null) body.turnstileToken = input.turnstileToken;
        else body.turnstileToken = turnstileToken();
        return post("/send-code", body);
      },

      verifyCode: function (input) {
        input = input || {};
        return post("/verify-code", {
          codeId: input.codeId,
          code: input.code,
          deviceId: deviceId
        });
      },

      register: function (input) {
        input = input || {};
        return post("/register", {
          email: input.email,
          password: input.password,
          deviceId: deviceId,
          turnstileToken: input.turnstileToken != null ? input.turnstileToken : turnstileToken()
        }, PASSWORD_ERR);
      },

      login: function (input) {
        input = input || {};
        return post("/login", {
          email: input.email,
          password: input.password,
          deviceId: deviceId
        }, PASSWORD_ERR);
      },

      verifyEmail: function (input) {
        input = input || {};
        return post("/verify-email", { vid: input.vid, token: input.token }, PASSWORD_ERR);
      },

      resendVerification: function (input) {
        input = input || {};
        var body = { deviceId: deviceId };
        if (input.email) body.email = input.email;
        body.turnstileToken = input.turnstileToken != null ? input.turnstileToken : turnstileToken();
        return post("/resend-verification", body, PASSWORD_ERR);
      },

      resendVerificationByEmail: function (input) {
        input = input || {};
        return post("/resend-verification-by-email", {
          email: input.email,
          deviceId: deviceId,
          turnstileToken: input.turnstileToken != null ? input.turnstileToken : turnstileToken()
        }, PASSWORD_ERR);
      },

      resetRequest: function (input) {
        input = input || {};
        return post("/reset-request", {
          email: input.email,
          deviceId: deviceId,
          turnstileToken: input.turnstileToken != null ? input.turnstileToken : turnstileToken()
        }, PASSWORD_ERR);
      },

      resetConfirm: function (input) {
        input = input || {};
        return post("/reset-confirm", {
          rid: input.rid,
          token: input.token,
          password: input.password,
          deviceId: deviceId
        }, PASSWORD_ERR);
      },

      accounts: function () { return post("/admin/accounts", { deviceId: deviceId }); },

      // 用户报告 / 勘误（Issue #243 第四轮）
      report: function (input) {
        input = input || {};
        return post("/report", {
          kind: input.kind,
          poemId: input.poemId,
          poemTitle: input.poemTitle,
          book: input.book,
          quote: input.quote,
          context: input.context,
          note: input.note,
          suggestion: input.suggestion,
          ua: input.ua,
          deviceId: deviceId
        });
      },

      myReports: function (input) {
        input = input || {};
        // GET 用查询串，**不发请求体**：`send()` 只在 POST/PATCH 那两条路上
        // 挂 Content-Type 与 body，而中间那些代理对「GET 带请求体」的处理
        // 各家不一样（有的直接丢掉）—— 丢掉的下场是「limit 传了等于没传」。
        var qs = input.limit ? "?limit=" + encodeURIComponent(String(input.limit)) : "";
        return call("/report" + qs, "GET");
      },

      adminReports: function (input) {
        input = input || {};
        return post("/admin/reports", { status: input.status, poemId: input.poemId, limit: input.limit });
      },

      adminReportPatch: function (input) {
        input = input || {};
        return post("/admin/reports", { rid: input.rid, status: input.status, reply: input.reply });
      },

      me: function () { return call("/me", "GET"); },

      config: function () { return call("/config", "GET"); },

      uploadAvatar: function (input) {
        input = input || {};
        return callBinary("/avatar", "POST", input.blob, input.type, AVATAR_ERR);
      },

      deleteAvatar: function () { return call("/avatar", "DELETE", { deviceId: deviceId }, AVATAR_ERR); },

      pull: function (input) {
        input = input || {};
        return post("/sync/pull", { since: input.since || 0, deviceId: deviceId });
      },

      push: function (input) {
        input = input || {};
        return post("/sync/push", { recs: input.recs || [], deviceId: deviceId });
      },

      grant: function (input) {
        input = input || {};
        return post("/admin/grant", {
          emailMask: input.emailMask,
          tier: input.tier,
          until: input.until == null ? null : input.until,
          deviceId: deviceId
        });
      },

      revoke: function (input) {
        input = input || {};
        return call("/admin/grant", "DELETE", {
          emailMask: input.emailMask,
          deviceId: deviceId
        });
      },

      grants: function () { return post("/admin/grants", { deviceId: deviceId }); },

      setRole: function (input) {
        input = input || {};
        return post("/admin/role", { uid: input.uid, role: input.role, deviceId: deviceId });
      },

      deleteAccount: function (input) {
        input = input || {};
        return call("/account", "DELETE", { confirm: input.confirm === true, deviceId: deviceId });
      },

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
    turnstileToken: turnstileToken,
    messageOf: messageOf,
    passwordMessageOf: passwordMessageOf,
    TRANSPORT_ERR: TRANSPORT_ERR,
    PASSWORD_ERR: PASSWORD_ERR,
    AVATAR_ERR: AVATAR_ERR,
    BASE: BASE,
    TIMEOUT_MS: TIMEOUT_MS
  };
});
