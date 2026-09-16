/**
 * POST /api/verify-code —— 校验码，签发会话。
 *
 * req  { codeId, code, deviceId }
 * res  200 { account:{uid,nickname,plan,features,mask}, sessionKept? } + Set-Cookie: kbsid=...
 *      `sessionKept:true` = 这一枚会话还在有效期的前一半里，**原样沿用**
 *      （不发新 Cookie）；不出现它才是续了期。见 session.shouldRenew。
 *      400 { code:"E_CODE_WRONG|E_CODE_EXPIRED|E_CODE_USED|E_CODE_VOID", remaining }
 *      403 { code:"E_EMAIL_UNVERIFIED", emailMask }   ← 码对的、邮箱没确认
 *      423 { code:"E_LOCKED", retryAfter }
 *
 * ⚠️ 校验**不看 channel** —— 码的摘要里带 uid + purpose，通道只决定它怎么送到你手上。
 *    一条短信码和一条邮件码走的是同一个 verifyCode（docs/auth-design.md §8 第 2 条）。
 *
 * ⚠️ 会话是 **HttpOnly + Secure + SameSite=Lax** 的签名 Cookie（docs §2.4）；
 *    localStorage 里不出现任何长寿命 token。
 *
 * ⚠️ Issue #197 后半段：**码验对了但邮箱没确认时同样不签发会话**（403）。
 *    只堵口令那条路的后果是「注册了不确认的人换一个页签就长驱直入」——
 *    而界面上还写着「确认之后才能登录」。判据与口令那条**同一处**
 *    （`core.emailGate()`），不是各写一遍。
 *
 * Ref: docs/architecture.md §4.3
 */
"use strict";

var handler = require("./_lib/handler");
var session = require("./_lib/session");

module.exports = handler.make("verify-code", ["POST"], function (d, body, req) {
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.verifyCode(d, {
    codeId: body.codeId,
    code: body.code,
    deviceId: body.deviceId || d.deviceId,
    /* ⚠️ 出口 IP 必须传下去：校验口按它做猜错计数与粗粒度限流。
       不传的后果不是报错，而是**那一档永远落在 "unknown" 这一个桶里** ——
       单个桶被刷满时**所有用户一起被拒**（DoS），而且真正的攻击者
       换一个网络就绕开了。这种「参数忘了传、限制静默失效」的形状
       与本项目踩过的那几个洞是同一个。 */
    ip: d.ip
  }).then(function (r) {
    // 会话落库：注销时按 uid 整体吊销（签名 Cookie 自己会过期，
    // 但「吊销」这件事必须有服务端记录，否则注销后旧 Cookie 还能用）
    if (r.status !== 200 || !r._session) return r;
    var s = r._session;
    return Promise.resolve(d.store.putSession({
      sid: s.sid, uid: s.uid, iat: s.iat, exp: s.exp, revoked: 0
    })).then(function () {
      /* ------------------------------------------------------------------
         会话续期：**只有快到期才签新 Cookie，其余情况原样沿用旧的那一枚**
         ------------------------------------------------------------------
         docs/auth-design.md §6.4 写的是「剩余 < 15 天且用户有操作时
         静默续到 30 天」，而原先的实现是「每次登录都签一枚新的」——
         那是不设上限的滑动窗口：用户只要别空过 30 天，这个会话就永远活着
         （30 天变 60 天、变 90 天…），而库里那一行 sessions 的 exp
         还停在最初那一刻 —— 「会话 30 天有效」这句话于是不成立。

         现在按 shouldRenew 判：真该续才覆盖 Set-Cookie（浏览器拿到新的一枚，
         旧的立刻作废，因为会话串本身带 exp），不该续就**不发 Set-Cookie**，
         浏览器手里那一枚原封不动 —— `iat` / `exp` 都不变，
         「会话从签发到现在活了多久」这件事才有一个确定的答案。
         ------------------------------------------------------------------ */
      var token = session.fromCookieHeader((req.headers || {}).cookie, d.cfg.cookieName);
      var old = session.read(d.cfg, token, Date.now());
      var renew = !old || session.shouldRenew(d.cfg, old, Date.now());
      var out = { status: r.status, body: r.body };
      if (renew) out.cookies = r.cookies;
      else out.body = Object.assign({}, r.body, { sessionKept: true });
      delete r._session;
      return out;
    });
  });
});
