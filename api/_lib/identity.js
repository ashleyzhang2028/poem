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

/* --------------------------------------------------------- 手机号（短信口） */

/**
 * 手机号归一化：**去空格 / 横线 / 括号 / 点**，`+86` / `86` / `0086` 前缀统一成裸 11 位。
 *
 * ⚠️ 本期**不启用短信通道**，这个函数也不被 sendCode 调用 ——
 *    它存在的唯一理由是：让「加 sms 通道」这件事只差一个「谁去发」的实现，
 *    而不是还要回头改归一化规则（docs/auth-design.md §8）。
 * ⚠️ 只归一化中国大陆手机号（1 开头 11 位）。港澳台 / 海外号码**不在此列**，
 *    将来开通时要另加区号字段，不能靠这个函数硬塞。
 */
function normalizePhone(value) {
  var s = String(value == null ? "" : value).replace(/[\s\-()\.]/g, "");
  s = s.replace(/^\+?0*86/, "");   // +86 / 86 / 0086 / 086 一律剥掉
  return s;
}

/** 是否中国大陆手机号形状：1 开头、第二位 3-9、共 11 位 */
function isPhoneShape(value) {
  return /^1[3-9]\d{9}$/.test(normalizePhone(value));
}

/**
 * 手机号掩码：13800138000 → 138****8000。与前端 js/auth-core.js 的 maskPhone 同规则。
 *
 * ⚠️ 非手机号形态（含字母、位数不够）一律给 `***`，**不截字母** ——
 *    掩码的意义是「让用户认得出是自己的号」，而一串乱码掩成 `abc****hijk`
 *    只会让人以为系统存了什么奇怪的东西；且它可能把脏值里的片段带进回显与日志。
 */
function maskPhone(value) {
  var s = normalizePhone(value);
  if (!isPhoneShape(s)) return "***";
  return s.slice(0, 3) + "****" + s.slice(-4);
}

/**
 * 手机号摘要 = SHA-256(pepper | | 归一化手机号)。
 * 与 emailHash 同一条口径：手机号空间同样很小，裸哈希可被枚举反查。
 */
function phoneHash(value, pepper) {
  return crypto.createHash("sha256")
    .update(String(pepper || "") + "|phone|" + normalizePhone(value), "utf8")
    .digest("hex");
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


/* ------------------------------------------------- 邮箱明文、口令与一次性令牌 */

/**
 * 落库的**邮箱明文**（归一化之后）。
 *
 * ## 口径变更（Issue #197）：从「只存摘要 + 掩码」改成「明文也存一份」
 *
 * 之前那一版**只**存 `email_hash`（SHA-256 + pepper）与 `email_mask`，
 * 用户原话是「我还是要看到这些用户」—— 而掩码 `a***@qq.com` **认不出是谁**，
 * 摘要又不可逆。于是「谁是本站用户」这个管理员必须回答的问题，
 * 在库里根本没有答案。用户 2026-09-16 就此裁了第二次：
 * **邮箱必须记录到数据库**。这一版据此落地。
 *
 * ## 一并改掉的三条口径（不藏着）
 *
 * 1. 归一化**不再做小写折叠**。`normalizeEmailForStore()` 只 trim + 去零宽，
 *    大小写原样保留 —— 这是「显示用的是用户真正填的那个邮箱」的前提。
 *    登录识别仍走 `email_hash`，它的输入**继续**做小写归一化，
 *    所以「大小写不同算同一个账号」这条历史行为一个字都没变。
 * 2. `email_hash` **保留**，且仍是唯一索引与登录查找的那一列。
 *    留着的理由有两条：老数据平滑（老行不必回填明文就能继续登录），
 *    以及「按明文查账号」这条路永远不必开。
 * 3. 明文只在**服务端**出现：`/privacy/` 已如实写出「邮箱会保存到服务器」。
 *    给用户看的回显仍以掩码为准（`publicAccount().mask`），
 *    明文只下发给**管理员**那一条接口（`POST /api/admin/accounts`）。
 *
 * ⚠️ 与 `normalizeEmail()` 的关系：那是**登录标识**的归一化（含小写），
 *    这是**落库明文**的归一化。两者故意分开 —— 合成一个函数的后果是
 *    「为了显示原样大小写，把登录标识也变成大小写敏感」。
 */
function normalizeEmailForStore(value) {
  return String(value == null ? "" : value)
    .replace(ZERO_WIDTH, "")
    .trim();
}

/**
 * 口令摘要：`scrypt(N=16384, r=8, p=1, 32 字节)` + 每账号 16 字节随机盐。
 *
 * 为什么不引 bcrypt / argon2：本项目**零运行时依赖**是硬约束
 * （`api/_lib/` 下每一个文件都在 Node 里直接 require，测试不装任何包）。
 * `crypto.scrypt` 是 Node 自带的，参数是 OWASP 推荐的那一档。
 *
 * ⚠️ 摘要串形如 `scrypt$16384$8$1$<saltHex>$<hashHex>`：**参数写在串里**。
 *    参数不写进串的下场是「将来调 N 值，老用户全部登录不上」——
 *    而那时没有任何办法区分「口令错」与「参数变了」。
 */
function newPasswordSalt() {
  return crypto.randomBytes(16).toString("hex");
}

function hashPassword(password, salt, params) {
  var p = params || { N: 16384, r: 8, p: 1, len: 32 };
  var dk = crypto.scryptSync(String(password == null ? "" : password), String(salt || ""), p.len, {
    N: p.N, r: p.r, p: p.p,
    // scrypt 的默认 maxmem 是 32MB，而 N=16384,r=8 需要约 16MB ——
    // 恰好卡在边界上，Node 会以 "memory limit exceeded" 抛错。
    // 显式放宽到 64MB，别让它成为一个「换台机器就登录不上」的玄学问题。
    maxmem: 64 * 1024 * 1024
  });
  return "scrypt$" + p.N + "$" + p.r + "$" + p.p + "$" + String(salt) + "$" + dk.toString("hex");
}

/** 现算一遍再定长比较（与 codeHash 同一条：失败也走完全程） */
function verifyPassword(password, stored) {
  var parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  var p = { N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]), len: 32 };
  if (!(p.N > 0) || !(p.r > 0) || !(p.p > 0)) return false;
  var expect;
  try { expect = hashPassword(password, parts[4], p); } catch (e) { return false; }
  return timingSafeEqual(expect, stored);
}

/**
 * 一次性令牌摘要（邮箱确认 / 重设口令都用它）。
 *
 * 令牌是 32 字节随机数的 hex（64 个字符），存的是
 * `SHA-256(pepper | purpose | uid | token)`。带 pepper 与 purpose 的理由
 * 与 `codeHash` 逐条相同：邮箱确认令牌与重设令牌**必须互不通用**。
 */
function newToken() {
  return crypto.randomBytes(32).toString("hex");
}

function tokenHash(uid, purpose, token, pepper) {
  return crypto.createHash("sha256")
    .update([String(pepper || ""), String(purpose || ""), String(uid || ""), String(token || "")].join("|"), "utf8")
    .digest("hex");
}

/** 业务 id：`v_` 邮箱确认 / `r_` 重设口令。不依赖随机源不重复（撞了由调用方线性探测） */
function newVerifyId() {
  return "v_" + crypto.randomBytes(8).toString("hex");
}

function newResetId() {
  return "r_" + crypto.randomBytes(8).toString("hex");
}

function newSalt() {
  return crypto.randomBytes(8).toString("hex");
}

module.exports = {
  normalizeEmail: normalizeEmail,
  normalizeEmailForStore: normalizeEmailForStore,
  newPasswordSalt: newPasswordSalt,
  hashPassword: hashPassword,
  verifyPassword: verifyPassword,
  newToken: newToken,
  tokenHash: tokenHash,
  newVerifyId: newVerifyId,
  newResetId: newResetId,
  normalizePhone: normalizePhone,
  isPhoneShape: isPhoneShape,
  maskPhone: maskPhone,
  phoneHash: phoneHash,
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
