/**
 * 服务端配置：**只从环境变量读**，代码里不写任何密钥。
 *
 * 1A 期的口径（docs/architecture.md §4）：
 *   · 后端是 Vercel Serverless 函数，同一项目的 /api/* 下，同源、无 CORS
 *   · 发信通道写在同一个 transport 接口后面，换商不改业务代码
 *   · 数据库是 Supabase（service key **只在服务端**）
 *
 * ⚠️ 这个文件可以在 Node 里直接 require（见 test/api.test.js），因此：
 *   · 不 import 任何第三方包
 *   · 不碰 process.env 之外的东西
 *   · 启动时校验通过即可用，缺配置时**给出降级路径**（见 isConfigured）
 */
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
  /* ---- 数据库 ---- */
  // Supabase 项目 URL 与 service key。**service key 绝不进浏览器**。
  supabaseUrl: env("SUPABASE_URL"),
  supabaseServiceKey: env("SUPABASE_SERVICE_KEY"),

  /* ---- 会话签名 ---- */
  // 没有它就无法签名 Cookie，此时会话功能整体降级（见 session.js）
  sessionSecret: env("SESSION_SECRET"),

  /* ---- 发信 ---- */
  // 'sendgrid' | 'resend' | 'console'；console 只在无密钥时兜底（把码打到服务端日志）
  mailTransport: env("MAIL_TRANSPORT", null),
  sendgridKey: env("SENDGRID_API_KEY"),
  resendKey: env("RESEND_API_KEY"),
  mailFrom: env("MAIL_FROM", "noreply@mail.kuibu.app"),
  mailFromName: env("MAIL_FROM_NAME", "跬步"),

  /* ---- 短信通道（2B：只留口子，**默认关闭**）----
     ⚠️ 这里没有「密钥」可配 —— 因为**还没有签短信商**。smsEnabled 默认 false，
        打开它也需要同时实现 smsTransport（见 mail/index.js 的口子），
        否则请求会以 E_CHANNEL_NOT_OPEN 被如实拒掉，而不是假装发了短信。 */
  smsEnabled: env("SMS_ENABLED", "0") === "1",
  smsTransport: env("SMS_TRANSPORT", null),

  /* ---- 站点 ---- */
  siteUrl: env("SITE_URL", "https://kuibu.app"),

  /* ---- 数值：与文档定死的一致，改这里就要改文档 ---- */
  codeLength: intEnv("CODE_LENGTH", 6),            // 6 位纯数字
  codeTtlMs: intEnv("CODE_TTL_MS", 10 * 60 * 1000), // 10 分钟
  codeMaxAttempts: intEnv("CODE_MAX_ATTEMPTS", 5),  // 单码失败上限
  resendCooldownMs: intEnv("RESEND_COOLDOWN_MS", 60 * 1000),
  // 短信重发冷却：docs §8 定的是 60 秒，与邮箱同值但**独立成键** ——
  // 将来要单独收紧（比如 120 秒）不必动邮箱那条
  smsResendCooldownMs: intEnv("SMS_RESEND_COOLDOWN_MS", 60 * 1000),
  sessionDays: intEnv("SESSION_DAYS", 30),
  cookieName: env("COOKIE_NAME", "kbsid"),

  /* ---- 频控四层（docs §4.6 第 4 条：邮箱 / 设备 / 全局 / 单账号）---- */
  rate: {
    email: [[3600000, 5], [86400000, 10]],
    device: [[3600000, 10], [86400000, 30]],
    ip: [[3600000, 30], [86400000, 100]],
    global: [[3600000, 200], [86400000, 800]]
  },

  /**
   * 短信通道的频控档（docs/auth-design.md §8：「比邮箱**更严**」）。
   *
   * 为什么必须更严：一条短信是真金白银（0.04 元），而邮箱成本近似为零 ——
   * 邮箱那套「一小时 5 封」放到短信上就是「一小时能烧 0.2 元／人」，
   * 被刷一晚就是几百上千元（§8 明写「短信接口是黑产重点目标」）。
   * 因此短信档对齐 §8 定下的三条：60 秒 1 次、日 5 次、月 15 次。
   */
  rateSms: {
    phone: [[3600000, 2], [86400000, 5], [2592000000, 15]]
  },



  // 冒烟/自测模式：显式打开才允许把明文码回给调用方（**绝不在生产开**）
  allowCodeEcho: env("ALLOW_CODE_ECHO", "0") === "1"
};

/** 数据库是否配好（没配就整体走内存降级，见 store.js） */
CONFIG.hasDb = function () {
  return !!(CONFIG.supabaseUrl && CONFIG.supabaseServiceKey);
};

/** 发信是否真的配好了（有密钥，且**不是** console 那条只写日志的通道） */
CONFIG.hasMail = function () {
  // ⚠️ 读 **this**，与 CONFIG.mail() 同一个理由：写成 CONFIG.mail() 时
  //    `Object.assign({}, CONFIG, { resendKey })` 这类覆盖完全不生效
  var c = (this && this.mailTransport !== undefined) ? this : CONFIG;
  return c.mail() !== "console";
};

/** 会话是否可签名（没配就**不签发会话**，而不是签发一个假的） */
CONFIG.hasSession = function () {
  return !!CONFIG.sessionSecret && CONFIG.sessionSecret.length >= 16;
};

/**
 * 选中的发信通道：显式指定的优先，否则按「有哪个密钥用哪个」推。
 *
 * ⚠️ 这个「用哪个」的顺序（SendGrid 在前）是 **2026-09-16 之前** 的口径。
 *    那天用户在 Issue #159 报「SendGrid 现在已经限时收费了，所以我用的 Resend」——
 *    于是「哪个是主选」从**代码里的顺序**变成了**用户填的那个变量**：
 *    · 只填 RESEND_API_KEY（现在的推荐做法）→ 推断出 resend，无需 MAIL_TRANSPORT
 *    · 两个都填 → 推断仍是 sendgrid（顺序没改，改了会动到既有的断言）
 *      → 这时**必须显式写 MAIL_TRANSPORT=resend**，否则你以为在用 Resend，
 *        实际花的是 SendGrid 那笔钱 —— 而两边都不报错
 *    这条「不报错的错」现在由 `ops.check()` 的 notes 主动提示（见 ops.js）。
 *
 * ⚠️ 必须读 **this**（也就是调用它的那一个 cfg 对象），不能读模块级 CONFIG。
 *    写成 CONFIG.xxx 的后果很隐蔽：`Object.assign({}, CONFIG, { sendgridKey })`
 *    这类覆盖**完全不生效** —— 函数还是照着原来的 CONFIG 判，
 *    症状是「明明给了密钥却仍落到 console」，而且不报任何错。
 *    test/api.test.js 有一条「显式指定的通道优先」就是为这个写的。
 */
CONFIG.mail = function () {
  var c = (this && this.mailTransport !== undefined) ? this : CONFIG;
  if (c.mailTransport) return c.mailTransport;
  if (c.sendgridKey) return "sendgrid";
  if (c.resendKey) return "resend";
  return "console";
};

module.exports = CONFIG;
