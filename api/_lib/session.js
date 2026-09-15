/**
 * 会话：**签名 HttpOnly Cookie**，不用 localStorage 存任何 token。
 *
 * docs/architecture.md §2.4：
 *   · Cookie 名 `kbsid`，`HttpOnly + Secure + SameSite=Lax`，30 天
 *   · 会话内容**签名**（HMAC-SHA256），服务端不存明文
 *   · `sessions` 表只存 sid 与 uid 的对应（用于注销时整体吊销）
 *
 * 为什么是签名 Cookie 而不是「随机 token 查库」：
 *   两者都要查库（吊销需要），但签名让**会话本身**就能自证 ——
 *   数据库抖一下也不至于把已登录的人踢成游客（那是产品级事故，
 *   与 §1.3「后端挂了照样能背」同一条口径）。
 *
 * ⚠️ 明文验证码不进日志这条同样适用：这里只处理 sid，不碰码。
 */
"use strict";

var crypto = require("crypto");

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s) {
  var t = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return Buffer.from(t, "base64").toString("utf8");
}

function sign(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * 签发一个会话串：`<b64url(json)>.<hmac>`
 * 载荷只有 sid / uid / iat / exp —— **不放昵称、不放邮箱、不放 tier**，
 * 那些每次由 /api/me 从库里现读（权益尤其不许固化在 Cookie 里）。
 */
function issue(cfg, uid, now) {
  var t = now || Date.now();
  var body = {
    s: require("./identity").newSid(),
    u: uid,
    i: t,
    e: t + cfg.sessionDays * 86400000
  };
  var json = JSON.stringify(body);
  var payload = b64url(json);
  /* ⚠️ 把 sid / uid / iat / exp **四个字段全回给调用方**：它们要写进
     sessions 表（`sid` 主键、`uid`/`iat`/`exp` 都是 NOT NULL）。
     少回一个字段在 memoryStore 上完全看不出来（内存里 undefined 照存），
     换到真 Postgres 就是「写会话时报 400」—— 而且只在登录那一刻炸，
     本地与 CI 全绿。test/api.test.js 有一条逐字段断言专门守这件事。 */
  return {
    token: payload + "." + sign(payload, cfg.sessionSecret),
    sid: body.s, uid: body.u, iat: body.i, exp: body.e
  };
}

/** 解签：失败一律返回 null（不区分「格式错」「签名错」「过期」，防探测） */
function read(cfg, token, now) {
  if (!token || typeof token !== "string") return null;
  var dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  var payload = token.slice(0, dot);
  var mac = token.slice(dot + 1);
  var expect = sign(payload, cfg.sessionSecret);
  var a = Buffer.from(mac, "utf8");
  var b = Buffer.from(expect, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  var body;
  try { body = JSON.parse(unb64url(payload)); } catch (e) { return null; }
  if (!body || typeof body.s !== "string" || typeof body.u !== "string") return null;
  var t = now || Date.now();
  if (typeof body.e !== "number" || body.e <= t) return null;
  return { sid: body.s, uid: body.u, exp: body.e };
}

/** 从 Cookie 头里取我们那一枚（手工解析，不引 cookie 包） */
function fromCookieHeader(headerValue, name) {
  var raw = String(headerValue || "");
  var parts = raw.split(";");
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i].trim();
    var eq = p.indexOf("=");
    if (eq < 0) continue;
    if (p.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(p.slice(eq + 1).trim());
  }
  return null;
}

/** Set-Cookie 的值：三个属性一个都不能少 */
function setCookieHeader(cfg, token, maxAgeSec) {
  var attrs = [
    cfg.cookieName + "=" + encodeURIComponent(token),
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=" + String(maxAgeSec)
  ];
  return attrs.join("; ");
}

function clearCookieHeader(cfg) {
  return [
    cfg.cookieName + "=",
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0"
  ].join("; ");
}

module.exports = {
  issue: issue,
  read: read,
  fromCookieHeader: fromCookieHeader,
  setCookieHeader: setCookieHeader,
  clearCookieHeader: clearCookieHeader,
  _sign: sign,
  _b64url: b64url,
  _unb64url: unb64url
};
