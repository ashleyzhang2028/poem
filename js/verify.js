/**
 * 确认邮箱页（/verify/）—— 处理邮件里那条链接（Issue #197）
 * ==========================================================================
 * 这一页只做一件事：读出 URL 里的 `vid` + `token`，交给服务端确认，说清结果。
 *
 * 三条刻意的做法：
 *   1. **不要求登录**：用户可能是在另一台设备上点开邮件的。
 *      要求登录会让「在手机上注册、在电脑上收信」彻底走不通。
 *   2. **结果文案由服务端给**（`r.message`）：过期 / 用过 / 不对三种情形
 *      的措辞只在服务端写一份。本页自己编一份的下场是
 *      「服务端改了口径、这一页还是老话」——而这一页恰恰是用户唯一
 *      会看到那个口径的地方。
 *   3. **参数一读出来就从地址栏抹掉**：`token` 是一次性凭据，
 *      留在地址栏会进浏览器历史、进 Referer、被截图带走。
 *      `history.replaceState` 抹掉它，用户的下一步动作一个字不受影响。
 *
 * ⚠️ 本页**不写任何存储**：确认邮箱是服务端的事，这一页一个字节都不落盘。
 *
 * ⚠️ Issue #197 后半段：默认口径是「**没确认就不让登录**」，所以确认成功
 *    这一屏的下一句话不再是「忘记密码时能重设了」，而是
 *    「**现在可以去登录了**」—— 先说用户真正要的那件事。
 *    这句话**必须按事实说**：站长把闸关掉的实例上（没配好发信商），
 *    说「现在可以去登录了」是一句废话（他本来就能登）。
 *    事实来自 `POST /api/verify-email` 回来之后那一次 `/api/me` 的自报，
 *    不是这一页自己猜的。
 */
(function () {
  "use strict";

  var api = (window.AuthApi && window.AuthApi.supported()) ? window.AuthApi.create({}) : null;

  function $(id) { return document.getElementById(id); }
  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }
  function text(el, s) { if (el) el.textContent = s == null ? "" : String(s); }

  /** 从 `?a=1&b=2` 里取参数。**不引 URLSearchParams**（老 WebView 里没有） */
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

  /** 三个状态互斥地切。合成一处，免得出现「两屏同时亮着」 */
  function state(s) {
    hide($("verify-none")); hide($("verify-busy")); hide($("verify-ok")); hide($("verify-bad"));
    if (s === "none") show($("verify-none"));
    else if (s === "busy") show($("verify-busy"));
    else if (s === "ok") show($("verify-ok"));
    else show($("verify-bad"));
  }

  function toLogin() { location.href = "/login/"; }

  function init() {
    var vid = param("vid");
    var token = param("token");

    $("btn-verify-to-login").addEventListener("click", toLogin);
    $("btn-verify-login").addEventListener("click", toLogin);
    $("btn-verify-retry-login").addEventListener("click", toLogin);

    if (!vid || !token) { state("none"); return; }

    /* ⚠️ 地址栏里的令牌用完即抹（在**发请求之前**抹也行 —— 参数已经读进变量了）。
       留着的代价：进浏览器历史、被分享出去时带走、被截图带走。
       用户的下一步动作一个字不受影响。 */
    try {
      if (window.history && history.replaceState) history.replaceState(null, "", "/verify/");
    } catch (e) { /* 某些内嵌 WebView 不给改 —— 不抛，继续确认 */ }

    if (!api) { state("bad"); text($("verify-bad-lead"), "连不上服务器，请稍后再试。"); return; }

    state("busy");
    api.verifyEmail({ vid: vid, token: token }).then(function (r) {
      if (r.ok) {
        state("ok");
        text($("verify-ok-lead"), "邮箱已确认：" + (r.emailMask || r.email || "") + "。");
        /* 下一步说什么，取决于**这台服务器拦不拦**（见文件头那段）。
           ⚠️ 这一句是**加法不是判断**：拿不到那两项时（老缓存 / 连不上）
              只说最保守的那一句（「可以去找回密码了」），
              绝不替服务器宣称「你被拦着」或「你没被拦」。

              原本这里写的是「确认之后，忘记密码时就能用它重设密码了」，
              在新口径下**不够**：用户走完这一趟最想知道的
              是「我现在能登进去了吗」。
           ⚠️ 用 `me()` 而不是把事实塞进 verify-email 的响应里：
              那一次确认是**匿名**做的（用户可能压根没登录），
              而「这台服务器现在拦不拦」是一条公共事实 —— /api/me 那条
              已经在自报了（`channel.emailGate`），不必再抄一份。 */
        var fallback = "现在可以用它找回密码了。";
        var hint = $("verify-ok-hint");
        if (hint) hint.textContent = fallback;
        if (api.me) {
          api.me().then(function (m) {
            var ch = (m && m.ok && m.channel) || null;
            if (!hint || !ch) return;
            if (ch.emailGate === true) {
              hint.textContent = "现在可以回登录页用这个邮箱登录了。";
            } else if (ch.emailGate === false) {
              hint.textContent = "这台服务器**没有**拦「没确认就不让登录」，确认只影响找回密码。";
            }
          }, function () { /* 拿不到就留着那一句保守的话 */ });
        }
        return;
      }
      state("bad");
      text($("verify-bad-lead"), r.message || "这个确认链接不对，请重新发一封确认邮件。");
    }, function () {
      state("bad");
      text($("verify-bad-lead"), "连不上服务器，请稍后再试。");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.VerifyPage = { param: param };
})();
