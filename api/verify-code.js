/**
 * POST /api/verify-code —— 校验码，签发会话。
 *
 * req  { codeId, code, deviceId }
 * res  200 { account:{uid,nickname,plan,features,mask} } + Set-Cookie: kbsid=...
 *      400 { code:"E_CODE_WRONG|E_CODE_EXPIRED|E_CODE_USED|E_CODE_VOID", remaining }
 *      423 { code:"E_LOCKED", retryAfter }
 *
 * ⚠️ 会话是 **HttpOnly + Secure + SameSite=Lax** 的签名 Cookie（docs §2.4）；
 *    localStorage 里不出现任何长寿命 token。
 *
 * Ref: docs/architecture.md §4.3
 */
"use strict";

var handler = require("./_lib/handler");

module.exports = handler.make("verify-code", ["POST"], function (d, body) {
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.verifyCode(d, {
    codeId: body.codeId,
    code: body.code,
    deviceId: body.deviceId || d.deviceId
  }).then(function (r) {
    // 会话落库：注销时按 uid 整体吊销（签名 Cookie 自己会过期，
    // 但「吊销」这件事必须有服务端记录，否则注销后旧 Cookie 还能用）
    if (r.status !== 200 || !r._session) return r;
    var s = r._session;
    return Promise.resolve(d.store.putSession({
      sid: s.sid, uid: s.uid, iat: s.iat, exp: s.exp, revoked: 0
    })).then(function () {
      var out = { status: r.status, body: r.body, cookies: r.cookies };
      delete r._session;
      return out;
    });
  });
});
