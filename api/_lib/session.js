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

/**
 * 会话密钥（**只有一处读**）：与 config.sessionKeyOf 同源。
 * 读 cfg.sessionSecret 而不读 CONFIG —— 测试注入的 cfg 才生效。
 */
function keyOf(cfg) {
  if (typeof cfg.sessionKeyOf === "function") return cfg.sessionKeyOf.call(cfg);
  return String(cfg.sessionSecret || cfg.sessionKey || "");
}

function sign(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * 签发一个会话串：`<b64url(json)>.<hmac>`
 * 载荷只有 sid / uid / iat / exp —— **不放昵称、不放邮箱、不放 tier**，
 * 那些每次由 /api/me 从库里现读（权益尤其不许固化在 Cookie 里）。
 *
 * ## ⚠️ iat 只对**新会话**有意义（续期那一条踩过的坑）
 *
 * 原先 think 是「`iat` 是这条会话的出生时间」。但**每一次登录都会
 * 从这里签发一枚新 Cookie**（信任期内「一点即入」、以及换设备重新收码），
 * 而服务端**从来没有在原地续过期** —— 于是 30 天的会话在用户天天来、
 * 每次都「一点即入」的那台设备上，其实是**每次登录重新起 30 天**：
 * 一个会话可以活 60 天、90 天、无限期，只要用户别空过 30 天。
 * 这与 docs/auth-design.md §6.4 写的「剩余 < 15 天且用户有操作时
 * **静默续到 30 天**」是两件事：设计里那一条是**受限的**（只在快到期时、
 * 且只续一次窗口），实现在做的是**无条件的滑动窗口**。
 *
 * 现在这条口径交给调用处（`verify-code.js`）：只有「确实该续」才签新 Cookie，
 * 否则**原样把旧 Cookie 回给浏览器**（会话的 iat / exp 一个字不动）。
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
    token: payload + "." + sign(payload, keyOf(cfg)),
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
  var expect = sign(payload, keyOf(cfg));
  var a = Buffer.from(mac, "utf8");
  var b = Buffer.from(expect, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  var body;
  try { body = JSON.parse(unb64url(payload)); } catch (e) { return null; }
  if (!body || typeof body.s !== "string" || typeof body.u !== "string") return null;
  var t = now || Date.now();
  if (typeof body.e !== "number" || body.e <= t) return null;
  /* iat 也回出去：会话续期要判「这一枚还剩多久」，
     而「还剩多久」只有 exp 一个数也能算 —— 回 iat 是为了让
     「原始有效期」与「已过多久」都能被如实报出来（界面上那句
     「还需等待」/「还有 N 天」用的是同一对数字）。 */
  return { sid: body.s, uid: body.u, iat: typeof body.i === "number" ? body.i : null, exp: body.e };
}

/**
 * 会话该不该续（docs/auth-design.md §6.4）。
 *
 * ```
 * 续期：剩余 < 15 天且用户有操作时静默续到 30 天
 * ```
 *
 * ⚠️ 这一条**不许**被写成「每次登录都重新签一枚」：
 *    那样 30 天的会话会变成**无上限的滑动窗口**（用户只要不空过 30 天，
 *    这个会话就永远活着）—— 而设计里写的是「快到期时续一次窗口」。
 *    更糟的是它**没有上限**：一枚 2024 年签发的 Cookie，只要用户
 *    每 29 天来一次，2030 年照样能用，而库里那一行 sessions 的
 *    `exp` 还是 2024 年那一个（续期从不落库）。
 *
 * @returns {boolean} true = 该续（由调用处签一枚新的）
 */
function shouldRenew(cfg, s, now) {
  if (!s || typeof s.exp !== "number") return false;
  var t = now || Date.now();
  var days = Number(cfg.sessionDays) || 30;
  var full = days * 86400000;
  /* 只在「剩余不足一半」时才续 —— 写死 15 天会把 7 天有效期之类的配置
     算成「永远该续」（每来一次续一次），于是又滑回去了。 */
  return (s.exp - t) < full / 2;
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
  shouldRenew: shouldRenew,
  fromCookieHeader: fromCookieHeader,
  setCookieHeader: setCookieHeader,
  clearCookieHeader: clearCookieHeader,
  _sign: sign,
  _b64url: b64url,
  _unb64url: unb64url
};
