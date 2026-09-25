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

function keyOf(cfg) {
  if (typeof cfg.sessionKeyOf === "function") return cfg.sessionKeyOf.call(cfg);
  return String(cfg.sessionSecret || cfg.sessionKey || "");
}

function sign(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

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

  return {
    token: payload + "." + sign(payload, keyOf(cfg)),
    sid: body.s, uid: body.u, iat: body.i, exp: body.e
  };
}

function read(cfg, token, now) {
  if (!token || typeof token !== "string") return null;
  var dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  var payload = token.slice(0, dot);
  var mac = token.slice(dot + 1);
  var expect = sign(payload, keyOf(cfg));
  var a = Buffer.from(mac, "utf8");
  var b = Buffer.from(expect, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  var body;
  try { body = JSON.parse(unb64url(payload)); } catch (e) { return null; }
  if (!body || typeof body.s !== "string" || typeof body.u !== "string") return null;
  var t = now || Date.now();
  if (typeof body.e !== "number" || body.e <= t) return null;

  return { sid: body.s, uid: body.u, iat: typeof body.i === "number" ? body.i : null, exp: body.e };
}

function shouldRenew(cfg, s, now) {
  if (!s || typeof s.exp !== "number") return false;
  var t = now || Date.now();
  var days = Number(cfg.sessionDays) || 30;
  var full = days * 86400000;

  return (s.exp - t) < full / 2;
}

// 解一枚 Cookie 值：**永不抛异常**。
//
// 为什么必须写成「不抛」：`decodeURIComponent` 碰到一个孤零零的 `%`
// （或 `%zz`、被截断的 `%E4`）会抛 `URIError: URI malformed`，而
// `fromCookieHeader` 是在**路由之前**被调的 —— 一抛，`withSession` 整个
// reject，`handler.make` 的 catch 把**任何**请求（连登录都算）回成
// 500 E_INTERNAL，前端 auth-api 翻成「**服务暂时不可用，请稍后重试。**」。
//
// 实测（2026-09-25，对着线上 kuibu.app）：
//   curl -X POST .../api/login -H 'Cookie: kbsid=abc%zz' -d '{...}'
//     → 500 {"code":"E_INTERNAL",...}     ← 用户看到的那句话，且**每一发都这样**
//   GET /api/config 带上同一枚 Cookie 也是 500（连「本站配没配人机校验」都问不出来）
// 也就是说：只要浏览器里存着**任何一枚**我们读不动的 Cookie，整站的接口
// 就全哑了 —— 而用户完全看不到「是 Cookie 坏了」，只看到「服务暂时不可用」。
//
// 口径：读不动就**按原样**还回去，不猜、不吞键。那一串随后必然过不了
// `read()` 的签名校验（HMAC 不是它），于是如实按「没有会话」处理 ——
// 登录照常走得下去，用户不用清 Cookie。
function safeDecode(value) {
  var raw = String(value == null ? "" : value).trim();
  try {
    return decodeURIComponent(raw);
  } catch (e) {

    return raw;
  }
}

function fromCookieHeader(headerValue, name) {
  var raw = String(headerValue || "");
  var parts = raw.split(";");
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i].trim();
    var eq = p.indexOf("=");
    if (eq < 0) continue;
    if (p.slice(0, eq).trim() !== name) continue;
    return safeDecode(p.slice(eq + 1));
  }
  return null;
}

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
  shouldRenew: shouldRenew,
  fromCookieHeader: fromCookieHeader,
  setCookieHeader: setCookieHeader,
  clearCookieHeader: clearCookieHeader,
  _sign: sign,
  _b64url: b64url,
  _unb64url: unb64url
};
