/**
 * Cloudflare Turnstile —— 人机校验（Issue #197 后续）
 * ==========================================================================
 * 用户 2026-09-17 提的需求：**登录 / 注册 / 密码找回 / 密码 / 发送随机码
 * 等页面都要接入 Turnstile**，并说明配置步骤。
 *
 * 这一份是**服务端那半边**：拿到前端 widget 产出的 `token`，
 * 向 Cloudflare 的 siteverify 接口核一次，回答「这一枚 token 是真的吗」。
 * 前端那半边（渲染 widget、把 token 塞进请求体）在 `js/turnstile.js`。
 *
 * ## 为什么必须有一个**服务端**校验
 *
 * 前端的 widget 是**任何人都能绕过的**（改一行 JS、直接 curl 打接口）。
 * 前端渲染只做一件事：**把人挡在提交之前**，省掉一次必然失败的请求。
 * 真正说了算的永远是服务端这一次 siteverify —— 与 `REQUIRE_EMAIL_VERIFIED`
 * 「闸在服务端」是同一条纪律（把入口藏起来不是安全边界，docs §3.5）。
 *
 * ## 三条口径
 *
 *   ① **默认关**（`TURNSTILE_ENABLED` 缺省 0）。理由与 `SMS_ENABLED` 同：
 *      没配好密钥时打开它，等于**谁也别想登录**。开关是给运维的，
 *      不是给代码猜的 —— 「没配密钥」这件事本身已经由 `turnstileReady()`
 *      如实回答了（配了密钥就会自动打开，见下）。
 *
 *   ② **没配密钥时如实降级，不假装拦着**。`turnstileReady()` 为 false 时
 *      服务端**跳过**校验，并把这件事自报在响应/`/api/me` 里
 *      （`channel.turnstile`）—— 与 `mail: "console"`「真实用户收不到信」
 *      是同一种「如实说这台服务器的状态」。
 *
 *   ③ **失败一律 400 + 专属码 `E_TURNSTILE`**，且**不把 Cloudflare 的原始
 *      error-codes 回给客户端**（那些码会把「密钥配错了」这类服务端配置问题
 *      暴露给调用方）。只进服务端日志（经 redact）。
 *
 * ## ⚠️ 与「frequency 频控」的分工（两者都要，谁也不替代谁）
 *
 *   · 频控（core.makeRateLimiter）管的是「**已经进来的人**要了多少次」——
 *     它按邮箱 / 设备 / IP 分桶，是**业务层**的账。
 *   · Turnstile 管的是「**在进来之前**，你是不是一个真人」——
 *     它挡的是脚本批量打（尤其是 `send-code` / `register` / `reset-request`
 *     这三条**匿名可写**、会发信、会建号的口子）。
 * 挡在门外的那一次连频控的账都不落（先校验、后 take），
 * 所以刷子连「一小时 5 封」的额度都占不到别人的。
 *
 * ## 五种「不校验」的情形（**每一种都必须是有意的**）
 *
 *   1. `!turnstileReady(cfg)` —— 没配密钥（默认状态），如实降级
 *   2. `cfg.turnstileBypass === true` —— 测试 / 本地联调用（`TURNSTILE_BYPASS=1`）
 *      ⚠️ 它**只在服务端读**，绝不随响应下发，也不该出现在生产环境
 *   3. `input.skipTurnstile === true` —— **没有这一条**。刻意不支持
 *      「客户端说不用校验就不用校验」：那正是它要防的形状
 *   4. `ALLOW_CODE_ECHO=1` 的冒烟模式**不**自动跳过 —— 两件事分开
 *      （冒烟是「回明文码」，与「要不要做人机校验」无关）
 *   5. 白名单是在**接口层**做的（哪些接口挂它），不在这个文件里
 *
 * ⚠️ 本文件不 import 任何第三方包（只用 Node 内建 https），可在 Node 里直接
 *    require（见 test/api.test.js），所以测试能注入一个假 fetch 而不联网。
 */
"use strict";

var https = require("https");

/** 官方 siteverify 端点（**只有这一个**，不接受配置覆盖 —— 见下方注释） */
var VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * 这台服务器到底能不能做人机校验。
 *
 * 判据**只有一处**：既要有密钥（secret），又要开关是开的。
 * ⚠️ 两个条件缺一不可，而且**两个都读 `this`**（与 `cfg.mail()` /
 *    `cfg.hasSession()` 同一条纪律）：测试里 `Object.assign({}, CONFIG, {...})`
 *    这类覆盖必须生效，否则「明明给了密钥却仍落到不校验」而**不报任何错**。
 *
 * ⚠️ 为什么用一个独立函数而不是让调用方自己 `if (cfg.turnstileEnabled && cfg.turnstileSecretKey)`：
 *    那句判断会被写在**每一个接口**里（五六个地方），而它是安全判据 ——
 *    漏一处就是「那个接口不校验」，且谁也不报错。判据只写一份。
 *
 * @returns {boolean}
 */
function turnstileReady(cfg) {
  var c = (cfg && (cfg.turnstileEnabled !== undefined || cfg.turnstileSecretKey !== undefined)) ? cfg : null;
  if (!c) return false;
  /* ⚠️ 旁路**优先于开关**：`TURNSTILE_BYPASS=1` 是运维在明说「这台别校验」
     （本地开发 / CI）。判据读 `this` 的同一个字段，与 config.js 的
     `CONFIG.turnstileReady()` **逐条对齐** —— 两处不一致的下场是
     「自检说关着、真校验却校验」（或反过来），而两边都不报错。 */
  if (c.turnstileBypass === true) return false;
  if (c.turnstileEnabled !== true) return false;
  return String(c.turnstileSecretKey || "").length > 0;
}

/**
 * 向 Cloudflare 核一枚 token。
 *
 * @param {object} cfg       CONFIG（或测试里造的同形状对象）
 * @param {object} input     { token, ip, fetch?, now? }
 *   · token —— 前端 widget 产出的那一串（`cf-turnstile-response`）
 *   · ip    —— 可选，出口 IP。Cloudflare 拿它做风控；不传也能核，
 *              但传了更准（**只发给 Cloudflare**，本站不落库）
 *   · fetch —— 注入用（测试给假 fetch，不联网）
 * @returns {Promise<{ok:boolean, skipped?:boolean, reason?:string, codes?:string[]}>}
 *   · ok:true  —— 核过了，**或者**这台服务器压根没配（skipped:true）
 *   · ok:false —— 没核过（token 空 / 过期 / 重放 / 不是这个站点的）
 *
 * ⚠️ **网络失败时回 ok:false（fail-closed）**，这一条是刻意的：
 *    连不上 Cloudflare 时若放行，那「拔网线」就成了绕过人机校验的办法。
 *    代价是 Cloudflare 抖动会让登录短暂不可用 —— 但这一层本来就是
 *    **可关的应急闸**（`TURNSTILE_ENABLED=0` 一行就能绕开），
 *    而反过来（fail-open）没有任何紧急开关能补救一个已经被刷穿的窗口。
 *    ⚠️ 但**没配密钥**那一档不是「网络失败」：那是运维明示的「这台没开」，
 *       走 skipped（不拦），两件事不许混为一谈。
 */
function verify(cfg, input) {
  input = input || {};
  if (!turnstileReady(cfg)) {
    /* 两档都**不拦**，但要分得清（服务端日志里看得出来是哪一档）：
       · bypass —— 运维明示「这台别校验」（本地开发 / CI）
       · not_configured —— 压根没配（密钥 / 开关不齐） */
    var bypassed = !!(cfg && cfg.turnstileBypass === true);
    return Promise.resolve({ ok: true, skipped: true, reason: bypassed ? "bypass" : "not_configured" });
  }
  var token = String(input.token == null ? "" : input.token).trim();
  /* 空 token 不进网络（省一次往返），直接拒 —— 这一条也是「前端没渲染出来 /
     用户没勾」的如实回答，而不是让 Cloudflare 去替我们说一遍。 */
  if (!token) return Promise.resolve({ ok: false, reason: "missing_token", codes: ["missing-input-response"] });

  var doFetch = input.fetch || (typeof fetch === "function" ? fetch : null);
  var body = new URLSearchParams();
  body.set("secret", String(cfg.turnstileSecretKey));
  body.set("response", token);
  if (input.ip && input.ip !== "unknown") body.set("remoteip", String(input.ip));

  if (!doFetch) {
    /* 没有任何 fetch 实现（老 Node？）—— 当作**核不了**，fail-closed。
       如实回一个理由，别假装核过了。 */
    return Promise.resolve({ ok: false, reason: "no_fetch" });
  }

  var ctrl = typeof AbortController === "function" ? new AbortController() : null;
  /* 超时压在 5 秒：Cloudflare 正常在 100ms 级；5 秒还没回来，
     按「核不了」处理（fail-closed）。比 Serverless 函数超时先收手。 */
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
        /* ⚠️ `error-codes` **只回给调用方做日志**，绝不原样给客户端。
           它会把「invalid-input-secret」这类服务端配置问题暴露出去。 */
        return { ok: false, reason: "rejected", codes: (data && data.error_codes) || [] };
      }
      /* hostname 校验：核过的 token 必须属于**本站**（防「拿别人站点的 token
         来糊弄我们」）。Cloudflare 的响应里有 hostname，但只有在我们
         自己传了 `expected hostname` 时才有意义 —— 这里用 `siteUrl` 的
         host 比一次。对不上按拒绝处理。 */
      var want = hostOf(cfg.siteUrl);
      var got = String(data.hostname || "");
      if (want && got && want !== got) {
        return { ok: false, reason: "hostname_mismatch", codes: [] };
      }
      return { ok: true, reason: "ok" };
    });
  }).catch(function (e) {
    if (timer) clearTimeout(timer);
    /* fail-closed：连不上 = 核不过（见上面那段说明）。
       `reason` 里带上错误名，供服务端日志排查；不进客户端响应。 */
    return { ok: false, reason: (e && e.name === "AbortError") ? "timeout" : "network" };
  });
}

/** 取一个 URL 的 host（拿不到就空串 —— 空串表示「不比」） */
function hostOf(url) {
  try { return String(new URL(String(url || "")).host || "").toLowerCase(); } catch (e) { return ""; }
}

/**
 * 把 `verify()` 的结果翻成内核那套 `{status, body}` —— **只有这一处**。
 *
 * 为什么要有这个薄壳：每一条接口各自拼一遍错误响应，就会出现
 * 「send-code 回 403、register 回 400」这类不一致，而它们该说的是同一件事。
 */
function guard(cfg, input) {
  return verify(cfg, input).then(function (r) {
    if (r.ok) return null;   // null = 放行
    return {
      status: 400,
      body: {
        code: "E_TURNSTILE",
        message: "人机校验没通过，请刷新页面再试一次",
        /* ⚠️ 这里**只有**一个布尔与一个笼统的理由分类 —— 没有 Cloudflare
           的 error-codes，也没有「密钥配错了」这类服务端细节。
           理由分类只区分「你没带 token」与「token 没用」，
           后者对用户是同一件事（重试）。 */
        turnstile: r.reason === "missing_token" ? "missing" : "failed"
      },
      /* ⚠️ `_codes` 是**给服务端日志用的**（handler 会 redact），
         不进响应体。前缀 `_` 与其它内部字段同一条约定。 */
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
