"use strict";

var handler = require("../../_lib/handler");
var session = require("../../_lib/session");

// 「退出登录」（Issue #274）。
//
// ⚠️ 为什么必须有一条**服务端**的退出：会话有两种存在方式 ——
//    本机的 `poem_auth_v1.sessions` 与服务端的 `kbsid` Cookie。
//    原先界面上那颗「退出登录」只清了本机那一份（`AuthCore.signOut`），
//    于是**服务端登录的人点了退出，Cookie 还在**：刷新一下又「登录着」，
//    或者反过来 —— 本机清空了、Cookie 还在，界面以为退了、服务端还认他。
//    两边的登录状态从此各说各话。
//
// 这一条做两件事：
//   1. 把这枚会话在库里标成 `revoked = 1`（`handler.withSession` 认人时会
//      查到它、直接按未登录处理）—— **服务端从此不认这枚 Cookie**；
//   2. 回一发过期 Cookie（`session.clearCookieHeader`），让浏览器把票撕掉。
//
// 三档口径与其它接口一致：没配会话就 503；本来就没登录也**回 200**
// （退出是幂等的，界面不该因为「你本来就没登录」而报错）；库读不动
// 也一样回「已退出」+ 撕票 —— 票在客户端手里，撕掉它不依赖任何上游。
module.exports = handler.make("auth.logout", ["POST"], function (d) {
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }

  var clear = { status: 200, body: { ok: true, signedOut: true }, cookies: [session.clearCookieHeader(d.cfg)] };
  if (!d.account) return clear;

  return Promise.resolve(d.store.revokeSessions(d.account.uid)).then(function () {
    return {
      status: 200,
      body: { ok: true, signedOut: true, note: "本机进度不受影响。" },
      cookies: [session.clearCookieHeader(d.cfg)]
    };
  })["catch"](function () {
    // ⚠️ 库里没标上也要把票撕掉，并且**如实回 200**：用户按了退出就必须出去。
    //    那枚票在浏览器这边已经没了；库里那一行还有效到它自己过期为止 ——
    //    这是「服务端暂时读不动」时唯一还能做的正确事，不必把它说成失败。
    return clear;
  });
});
