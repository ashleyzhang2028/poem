/**
 * 身份归一化与摘要 —— **服务端的唯一一份**。
 *
 * 与前端 js/auth-core.js 的关系：
 *   前端那份负责「输入校验与提示」（邮箱格式、错别字域名），
 *   服务端这份负责「落库用的摘要与掩码」。
 *   ⚠️ 两份**故意不共用代码**：前端那份不能持有 pepper，也绝不能做哈希。
 *      共用的只是**规则**：trim → 去零宽 → 小写；掩码 a***@b.com。
 *      规则一致性由测试守着（test/api.test.js 拿前端同一个输入对两边的掩码）。
 *
 * 三条口径（docs/architecture.md §2.4）：
 *   1. 登录标识是 `email_hash`（SHA-256 + 服务端 pepper），**不存明文邮箱**
 *   2. 落库的掩码形如 `a***@b.com`，供界面回显；日志里也只许用掩码
 *   3. `uid` = `u_` + 8 位，**永不复用**，注销也不回收
 */
"use strict";

var crypto = require("crypto");

var ZERO_WIDTH = /[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g;

/** 与前端 js/auth-core.js 的 normalizeEmail 规则逐条一致 */
function normalizeEmail(value) {
  return String(value == null ? "" : value)
    .replace(ZERO_WIDTH, "")
    .trim()
    .toLowerCase();
}

/** 域名部分不许出现连续的「..」、不许以 . 开头 / 结尾 —— 与前端同规则 */
function isEmailShape(email) {
  var e = normalizeEmail(email);
  if (!e || e.length > 254) return false;
  var at = e.lastIndexOf("@");
  if (at <= 0 || at === e.length - 1) return false;
  var name = e.slice(0, at);
  var domain = e.slice(at + 1);
  if (name.length > 64 || /\s/.test(name) || name[0] === "." || name.slice(-1) === ".") return false;
  if (name.indexOf("..") >= 0) return false;      // 本地部分也不许连续的点（RFC 5321）
  if (domain.indexOf(".") <= 0) return false;
  if (domain.length > 253 || domain[0] === "." || domain.slice(-1) === ".") return false;
  if (domain.indexOf("..") >= 0) return false;
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(e);
}

/** 掩码：a@b.com → a***@b.com。界面回显与日志**一律**用它 */
function maskEmail(email) {
  var e = normalizeEmail(email);
  var at = e.indexOf("@");
  if (at <= 0) return "***";
  return e.slice(0, 1) + "***@" + e.slice(at + 1);
}

/**
 * 邮箱摘要 = SHA-256(pepper | 归一化邮箱)。
 *
 * 为什么必须带 pepper：邮箱空间很小，裸 SHA-256 可被彩虹表反查。
 * pepper 只存在于服务端环境变量里，泄露数据库不等于泄露邮箱。
 */
function emailHash(email, pepper) {
  return crypto.createHash("sha256")
    .update(String(pepper || "") + "|" + normalizeEmail(email), "utf8")
    .digest("hex");
}

/** 验证码摘要：同样带 pepper —— 6 位码空间只有 1e6，不带 pepper 等于明文 */
function codeHash(uid, purpose, code, salt, pepper) {
  return crypto.createHash("sha256")
    .update([pepper || "", uid, purpose, String(code || ""), salt].join("|"), "utf8")
    .digest("hex");
}

/**
 * 定长比较：失败也走完全程，不早退（防时序侧信道）。
 * 与前端 js/auth-core.js 的那条注释同源 —— 服务端实现同样要求。
 */
function timingSafeEqual(a, b) {
  var x = Buffer.from(String(a || ""), "utf8");
  var y = Buffer.from(String(b || ""), "utf8");
  if (x.length !== y.length) {
    // 长度不同也做一次同长比较，避免用「返回快」泄露长度
    crypto.timingSafeEqual(x, x);
    return false;
  }
  return crypto.timingSafeEqual(x, y);
}

/** uid：u_ + 8 位 hex。不依赖随机源不重复（撞了就由调用方线性探测） */
function newUid() {
  return "u_" + crypto.randomBytes(4).toString("hex");
}

/** 会话 id：s_ + 16 位 hex */
function newSid() {
  return "s_" + crypto.randomBytes(8).toString("hex");
}

/** 验证码记录 id：c_ + 12 位 hex */
function newCodeId() {
  return "c_" + crypto.randomBytes(6).toString("hex");
}

/** 6 位纯数字码。用 crypto 而不是 Math.random —— 后者可预测 */
function newCode(len) {
  var n = len || 6;
  var s = "";
  while (s.length < n) s += String(crypto.randomInt(0, 10));
  return s.slice(0, n);
}

function newSalt() {
  return crypto.randomBytes(8).toString("hex");
}

module.exports = {
  normalizeEmail: normalizeEmail,
  isEmailShape: isEmailShape,
  maskEmail: maskEmail,
  emailHash: emailHash,
  codeHash: codeHash,
  timingSafeEqual: timingSafeEqual,
  newUid: newUid,
  newSid: newSid,
  newCodeId: newCodeId,
  newCode: newCode,
  newSalt: newSalt
};
