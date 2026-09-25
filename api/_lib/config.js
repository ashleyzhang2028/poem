"use strict";

function env(name, fallback) {
  var v = process.env && process.env[name];
  if (v === undefined || v === null || v === "") return fallback === undefined ? null : fallback;
  return String(v);
}

function intEnv(name, fallback) {
  var v = env(name);
  if (v === null) return fallback;
  var n = parseInt(v, 10);
  return isFinite(n) && n > 0 ? n : fallback;
}

var CONFIG = {

  supabaseUrl: env("SUPABASE_URL"),
  supabaseServiceKey: env("SUPABASE_SERVICE_KEY"),

  sessionSecret: env("SESSION_SECRET"),

  mailTransport: env("MAIL_TRANSPORT", null),
  sendgridKey: env("SENDGRID_API_KEY"),
  resendKey: env("RESEND_API_KEY"),
  mailFrom: env("MAIL_FROM", "noreply@mail.kuibu.app"),
  mailFromName: env("MAIL_FROM_NAME", "跬步"),

  sessionKey: env("SESSION_KEY"),

  smsEnabled: env("SMS_ENABLED", "0") === "1",
  smsTransport: env("SMS_TRANSPORT", null),

  siteUrl: env("SITE_URL", "https://kuibu.app"),

  turnstileEnabled: env("TURNSTILE_ENABLED", "0") === "1",
  turnstileSiteKey: env("TURNSTILE_SITE_KEY"),
  turnstileSecretKey: env("TURNSTILE_SECRET_KEY"),

  turnstileBypass: env("TURNSTILE_BYPASS", "0") === "1",

  requireEmailVerified: env("REQUIRE_EMAIL_VERIFIED", "1") !== "0",

  // 管理员怎么诞生（Issue #276）：**名单在环境变量里，判定在服务端**。
  // OWNER_EMAILS 是逗号 / 空格分隔的**完整邮箱**（不是掩码 —— 掩码是给人看的，
  // 授权要唯一）。这一串里的邮箱在**注册 / 确认 / 登录**时被认成 owner
  // （见 core.claimOwnerRole），从此角色的权威在 `accounts.role` 那一列。
  // 不填的后果是「一个 owner 都没有」：这时 /admin/ 对所有人关门（如实拒绝），
  // 而不是退回「谁打开谁是主人」——那条兜底正是 Issue #276 要拆掉的东西。
  ownerEmails: env("OWNER_EMAILS", ""),

  passwordMin: intEnv("PASSWORD_MIN", 8),
  passwordMax: intEnv("PASSWORD_MAX", 72),
  verifyTtlMs: intEnv("VERIFY_TTL_MS", 24 * 60 * 60 * 1000),
  resetTtlMs: intEnv("RESET_TTL_MS", 60 * 60 * 1000),

  rateVerify: [[3600000, 5], [86400000, 10]],
  rateReset: [[3600000, 5], [86400000, 10]],
  rateLogin: [[3600000, 20], [86400000, 60]],

  codeLength: intEnv("CODE_LENGTH", 6),
  codeTtlMs: intEnv("CODE_TTL_MS", 10 * 60 * 1000),
  codeMaxAttempts: intEnv("CODE_MAX_ATTEMPTS", 5),
  resendCooldownMs: intEnv("RESEND_COOLDOWN_MS", 60 * 1000),

  smsResendCooldownMs: intEnv("SMS_RESEND_COOLDOWN_MS", 60 * 1000),
  sessionDays: intEnv("SESSION_DAYS", 30),
  cookieName: env("COOKIE_NAME", "kbsid"),

  mailRetryMax: intEnv("MAIL_RETRY_MAX", 2),
  mailRetryBudgetMs: intEnv("MAIL_RETRY_BUDGET_MS", 6000),

  // 重试的退避基数（400ms × 3ⁿ 里那个 400）。留成旋钮是为了让**测试**
  // 不必真的等到线上该等的时间：重试的判据（该不该重试、最多几次、
  // 预算怎么算）与「等多久」是两件事，后者只该由生产口径决定
  // （默认值不变，线上一个字都不改）—— Issue #278。
  mailRetryBaseMs: intEnv("MAIL_RETRY_BASE_MS", 400),

  requireEmailVerified: env("REQUIRE_EMAIL_VERIFIED", "1") !== "0",

  wrongRoundsLimit: intEnv("WRONG_ROUNDS_LIMIT", 3),
  lockMs: intEnv("ACCOUNT_LOCK_MS", 24 * 3600 * 1000),

  rate: {
    email: [[3600000, 5], [86400000, 10]],
    device: [[3600000, 10], [86400000, 30]],
    ip: [[3600000, 30], [86400000, 100]],
    global: [[3600000, 200], [86400000, 800]]
  },

  rateSms: {
    phone: [[3600000, 2], [86400000, 5], [2592000000, 15]]
  },

  avatarBucket: env("SUPABASE_AVATAR_BUCKET", "avatars"),
  avatarMaxBytes: intEnv("AVATAR_MAX_BYTES", 1024 * 1024),
  rateAvatar: [[3600000, 10], [86400000, 30]],

  allowCodeEcho: env("ALLOW_CODE_ECHO", "0") === "1"
};

CONFIG.turnstileReady = function () {
  var c = (this && this.turnstileEnabled !== undefined) ? this : CONFIG;
  if (c.turnstileBypass === true) return false;
  return c.turnstileEnabled === true && String(c.turnstileSecretKey || "").length > 0;
};

CONFIG.hasAvatarStore = function () {
  return !!(this.hasDb ? this.hasDb() : CONFIG.hasDb());
};

CONFIG.avatarPath = function (uid) {
  var u = String(uid || "").replace(/[^A-Za-z0-9_-]/g, "");
  if (u.length < 2) return "";
  return u.slice(0, 2) + "/" + u + "/avatar.jpg";
};

CONFIG.avatarBucketUrl = function () {
  var base = String(CONFIG.supabaseUrl || "").replace(/\/+$/, "");
  if (!base) return "";
  return base + "/storage/v1/object/public/" + String(CONFIG.avatarBucket || "avatars");
};

CONFIG.avatarPublicUrl = function (uid) {
  var b = CONFIG.avatarBucketUrl();
  var p = CONFIG.avatarPath(uid);
  return (b && p) ? b + "/" + p : "";
};

CONFIG.hasDb = function () {
  return !!(CONFIG.supabaseUrl && CONFIG.supabaseServiceKey);
};

CONFIG.sessionKeyOf = function () {
  var c = (this && (this.sessionSecret !== undefined || this.sessionKey !== undefined)) ? this : CONFIG;
  var v = c.sessionSecret || c.sessionKey || "";
  return String(v);
};

CONFIG.hasMail = function () {

  var c = (this && this.mailTransport !== undefined) ? this : CONFIG;
  return c.mail() !== "console";
};

CONFIG.hasSession = function () {
  return CONFIG.sessionKeyOf.call(this).length >= 16;
};

CONFIG.mail = function () {
  var c = (this && this.mailTransport !== undefined) ? this : CONFIG;
  if (c.mailTransport) return c.mailTransport;
  if (c.sendgridKey) return "sendgrid";
  if (c.resendKey) return "resend";
  return "console";
};

module.exports = CONFIG;
