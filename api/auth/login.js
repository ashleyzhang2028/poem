/**
 * POST /api/login —— 邮箱 + 口令登录（Issue #197）。
 *
 * req  { email, password, deviceId }
 * res  200 { account:{uid,nickname,plan,features,mask,email,emailVerified} } + Set-Cookie: kbsid=...
 *      400 { code:"E_LOGIN_FAIL" }   ← 空邮箱 / 空口令，也回这一个码（不区分说出去）
 *      401 { code:"E_LOGIN_FAIL", remaining? }
 *      423 { code:"E_LOCKED", retryAfter }
 *      429 { code:"E_RATE_DEVICE", retryAfter }
 *
 * 三条口径：
 *   1. **「口令错」与「账号不存在」回同一个响应、同一句话**，而且
 *      **耗时也要一样**（不存在时照样算一次 scrypt）。区分开就等于邮箱枚举。
 *   2. **失败计数落在账号上**（撞库打的是同一个账号），连续 10 次锁号；
 *      成功一次把窗口清空（否则「错九次、对一次、再错一次」就锁了）。
 *   3. **随机码那条路一个字没改** —— 口令是加出来的一条路，不是替换。
 *      `sendCode` / `verifyCode` 照旧。
 *
 * ⚠️ 会话与发码那条路**完全同一个** `session.issue`（同一枚 Cookie、同样的 30 天）。
 *    两条路签出来的会话没有区别，下游（/api/me、同步）不必知道用户从哪条路进来。
 *
 * Ref: docs/auth-design.md §4.4、§6.4
 */
"use strict";

var handler = require("../_lib/handler");

module.exports = handler.make("auth.login", ["POST"], function (d, body) {
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。" } };
  }
  return handler.core.loginWithPassword(d, {
    email: body.email,
    value: body.value,
    password: body.password,
    deviceId: body.deviceId || d.deviceId,
    /* ⚠️ 出口 IP 必须传下去：login 的退避档按「设备 + IP」两层记，
       deviceId 是客户端自己给的，换一个就绕过了。 */
    ip: d.ip
  }).then(function (r) {
    if (r.status !== 200 || !r._session) return r;
    var s = r._session;
    return Promise.resolve(d.store.putSession({ sid: s.sid, uid: s.uid, iat: s.iat, exp: s.exp, revoked: 0 }))
      .then(function () {
        var out = { status: r.status, body: r.body, cookies: r.cookies };
        delete r._session;
        return out;
      });
  });
});
