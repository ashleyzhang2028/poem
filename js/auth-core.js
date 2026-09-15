/**
 * 账号与随机码认证内核（纯逻辑，零 DOM 依赖）
 *
 * 设计全文见 docs/auth-design.md（Issue #132）。三条边界：
 *   1. 不花钱、不备案也能跑 —— 本期所有校验都发生在用户自己的浏览器里
 *   2. 不破坏「打开即用、可离线」 —— 未登录用户的功能与今天完全一致
 *   3. 不假装安全 —— 本期是「身份与数据的归属登记」，不是防篡改的鉴权，
 *      因此严禁拿它当收费/权益凭据
 *
 * 本文件可以在 Node 里直接 require（见 test/auth.test.js），因此：
 *   · 不碰 window / document / localStorage（存储由调用方注入）
 *   · 不 import 任何东西（无依赖）
 *   · 不打印任何含明文验证码的日志
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AuthCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ---------------------------------------------------------------- 常量 */

  var NS = "poem_auth_v1";
  var SESSION_DAYS = 30;          // 会话有效期（天）
  var SESSION_RENEW_DAYS = 15;    // 剩余不足这么多天时静默续期
  var TRUST_DAYS = 30;            // 设备信任期（天），信任期内可一键进入
  var CODE_TTL_MS = 10 * 60 * 1000;
  var CODE_LEN = 6;               // 6 位纯数字：邮箱里好认好输，无 O/0 混淆
  var CODE_MAX_ATTEMPTS = 5;      // 单码失败上限，超过即作废
  var RESEND_COOLDOWN_MS = 60 * 1000;
  // 短信重发冷却：与服务端 `SMS_RESEND_COOLDOWN_MS`（config.smsResendCooldownMs）同值。
  // **独立成键**是为了「将来单独收紧短信」时不必动邮箱那一条（docs/auth-design.md §8）。
  var SMS_RESEND_COOLDOWN_MS = 60 * 1000;
  var PURPOSES = ["login", "reset"];   // login = 注册+登录合一；reset = 重设凭证
  var CHANNELS = ["email", "sms"];     // sms 只留口子（2B），流程见 docs/auth-design.md §8

  var RATE = {
    // email 的第一档是「重新发送冷却」，单独判定；这里只留小时 / 日两档
    email: [[3600000, 5], [86400000, 10]],
    device: [[3600000, 10], [86400000, 30]],
    /**
     * IP 档（2C 补上）：**与服务端 `config.rate.ip` 同一把尺子**。
     *
     * ⚠️ 本机版没有真的 IP 可取 —— 这条档位存在的意义不是「现在能拦住谁」，
     *    而是**两端同一张表**：服务端那一档超限时回 `E_RATE_IP`，
     *    若前端连这个档位都没有，同一份签名在两边的行为就会不一样
     *    （这类漂移正是 2A/2B 反复踩的那类「写了但没接上」）。
     *    真正喂给它的 key 由调用方决定（浏览器里就是「本机」这一个桶）。
     */
    ip: [[3600000, 30], [86400000, 100]],
    global: [[3600000, 20], [86400000, 60]]
  };

  /**
   * 短信档：**比邮箱更严**（docs/auth-design.md §8）。
   * 60 秒 1 次、日 5 次、月 15 次。与服务端 config.rateSms 同值 ——
   * 本地体验版与服务端若给两套阈值，用户会在两种模式下遇到两种限制。
   * ⚠️ 本地版**不真的发短信**（本节不实现投递），这张表只是把「将来接上短信后
   *    会怎么限速」先钉在代码里，免得开通时又变成一次设计。
   */
  var RATE_SMS = {
    phone: [[3600000, 2], [86400000, 5], [2592000000, 15]]
  };

  // 一次性邮箱前缀：命中只提示、不阻断（挡住的是真用户，挡不住有心人）
  var DISPOSABLE = [
    "mailinator", "10minutemail", "guerrillamail", "trashmail", "yopmail",
    "temp-mail", "tempmail", "sharklasers", "getnada", "throwaway",
    "dispostable", "mailnesia", "maildrop", "fakeinbox", "spambox"
  ];

  var ERR = {
    E_EMAIL_EMPTY: "请先填邮箱",
    E_EMAIL_FORMAT: "这个邮箱看起来不太对，再检查一下",
    E_PHONE_FORMAT: "这个手机号看起来不太对，再检查一下",
    E_RATE_EMAIL: "发得太快了，请稍后再试",
    E_RATE_DEVICE: "这台设备今天发送次数有点多，稍后再试",
    E_RATE_IP: "网络有点异常，稍后再试",
    E_RATE_GLOBAL: "服务忙，请稍后再试",
    E_NO_CODE: "请先获取验证码",
    E_CODE_EXPIRED: "验证码已过期，点「重新发送」",
    E_CODE_WRONG: "验证码不对，再检查一下",
    E_CODE_USED: "这个验证码已经用过了，请重新发送",
    E_CODE_VOID: "请用最新收到的验证码",
    E_LOCKED: "为了安全，请稍后再试",
    E_CHANNEL: "暂时不支持这种登录方式",
    E_SMS_NOT_OPEN: "短信登录还没开通（需要先签短信商并完成模板报备）。当前可用邮箱随机码登录",
    E_PURPOSE: "验证码用途不匹配，请重新获取",
    E_IDENTITY: "这个账号没有登记该登录方式",
    E_STORAGE: "浏览器不允许保存数据，本次登录刷新后会失效"
  };

  /* ------------------------------------------------------------ 基础工具 */

  // 可注入的时钟与随机源：测试里替换即可复现「过期 / 时间倒退 / 码碰撞」
  var now = function () { return Date.now(); };
  var rnd = function () { return Math.random(); };

  function setClock(fn) { now = typeof fn === "function" ? fn : function () { return Date.now(); }; }
  function setRandom(fn) { rnd = typeof fn === "function" ? fn : function () { return Math.random(); }; }

  function randHex(bytes) {
    var s = "";
    for (var i = 0; i < bytes; i++) {
      s += ("0" + Math.floor(rnd() * 256).toString(16)).slice(-2);
    }
    return s;
  }

  function digits(len) {
    var s = "";
    for (var i = 0; i < len; i++) s += String(Math.floor(rnd() * 10));
    return s;
  }

  /**
   * 极简同步摘要（FNV-1a 64 位，输出 16 位 hex）。
   *
   * 为什么不直接用 crypto.subtle：它是异步的，而 verifyCode 需要同步返回；
   * 且 WebCrypto 在非安全上下文（http 局域网预览）下不存在。
   * 摘要在这里**只用于「不以明文落盘」**，不是抗爆破手段 ——
   * 抗爆破靠 CODE_MAX_ATTEMPTS + 频控（docs 第 5.5 节）。
   * 服务端版必须换成服务端的强哈希，本函数不得照搬。
   */
  function digest(str) {
    var h1 = 0x811c9dc5, h2 = 0x9e3779b9, i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 = (h2 + c) >>> 0; h2 = Math.imul(h2 ^ (h2 >>> 13), 0x85ebca6b) >>> 0;
    }
    var a = ("00000000" + h1.toString(16)).slice(-8);
    var b = ("00000000" + h2.toString(16)).slice(-8);
    return a + b;
  }

  function codeDigest(uid, purpose, code, salt) {
    return digest(String(uid) + "|" + String(purpose) + "|" + String(code) + "|" + String(salt));
  }

  /* -------------------------------------------------------- 邮箱归一化 */

  /**
   * 邮箱归一化：trim → 去零宽字符 → 小写。
   *
   * 本地部分（@ 前）按 RFC 5321 其实区分大小写，但现实中没有一家主流邮箱
   * 这么用，反而是「手机上自动首字母大写」造成的登录失败最常见。
   * 这里刻意全小写，并在 docs 里写明这一裁定。
   */
  function normalizeEmail(input) {
    if (typeof input !== "string") return "";
    return input
      .replace(/[\u200b-\u200d\ufeff]/g, "")   // 零宽字符：复制粘贴常见
      .replace(/\s+/g, "")
      .toLowerCase();
  }

  var EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

  function isEmailShape(email) {
    if (!email) return false;
    if (email.length > 254) return false;
    var at = email.indexOf("@");
    if (at <= 0 || at !== email.lastIndexOf("@")) return false;
    if (at > 64) return false;                 // 本地部分上限
    var domain = email.slice(at + 1);
    if (domain.length > 253 || domain[0] === "." || domain.slice(-1) === ".") return false;
    if (domain.indexOf("..") >= 0) return false;              // 域名不许连续的点
    if (email.slice(0, at).indexOf("..") >= 0) return false;  // 本地部分同样（RFC 5321）
    return EMAIL_RE.test(email);
  }

  /** 桌面端常见的「域名写漏了」—— 只提示，不自动补，避免替用户做决定 */
  var TYPO_DOMAINS = ["163.com", "qq.com", "126.com", "gmail.com", "outlook.com", "sina.com", "foxmail.com"];
  var TYPO_MAP = {
    "163.con": "163.com", "163.co": "163.com", "163.om": "163.com",
    "qq.con": "qq.com", "q.com": "qq.com", "qq.co": "qq.com",
    "126.con": "126.com", "gmail.con": "gmail.com", "gmial.com": "gmail.com",
    "outlook.con": "outlook.com", "hotnail.com": "hotmail.com"
  };

  function emailHint(email) {
    var e = normalizeEmail(email);
    var at = e.indexOf("@");
    if (at < 0) return null;
    var domain = e.slice(at + 1);
    if (TYPO_MAP[domain]) return "是不是想填 " + e.slice(0, at + 1) + TYPO_MAP[domain] + "？";
    if (TYPO_DOMAINS.indexOf(domain) < 0 && domain.indexOf(".") > 0) return null;
    return null;
  }

  function isDisposable(email) {
    var e = normalizeEmail(email);
    if (e.indexOf("@") < 0) return false;
    var domain = e.split("@").pop();
    return DISPOSABLE.some(function (d) { return domain.indexOf(d) >= 0; });
  }

  /** 掩码：a@b.com → a***@b.com；界面回显「已发往」用，日志里也必须用它 */
  function maskEmail(email) {
    var e = normalizeEmail(email);
    var at = e.indexOf("@");
    if (at <= 0) return "***";
    var name = e.slice(0, at);
    var head = name.slice(0, 1);
    return head + "***@" + e.slice(at + 1);
  }

  /**
   * 手机号掩码：138****8000（短信通道只留口子，本期不启用）。
   *
   * ⚠️ 必须先走 normalizePhone 再掩码 —— 否则 `+86 138…` 会掩成 `+86****8000`
   *    （前 3 位是区号不是号段），而服务端那份是归一化后再掩的。两边不一致 =
   *    「回显给用户看的号」与「后端认的号」对不上，是最难查的那种 bug。
   *    一致性由 test/api.test.js 的双端对拍守着。
   */
  function maskPhone(v) {
    var s = normalizePhone(v);
    // 非手机号形态一律 `***`（与服务端 identity.maskPhone 同规则），
    // 不截字母、不猜——掩码只对「确实是手机号」的值才有意义
    if (!isPhoneShape(s)) return "***";
    return s.slice(0, 3) + "****" + s.slice(-4);
  }

  /**
   * 手机号归一化：去空格 / 横线 / 括号 / 点，`+86` / `86` / `0086` 前缀统一成裸 11 位。
   *
   * ⚠️ 规则必须与**服务端** `api/_lib/identity.js` 的 normalizePhone 逐条一致 ——
   *    两边各存一份是**故意**的（前端这份不能持有 pepper、也绝不做哈希），
   *    但归一化规则不一致的后果是「前端说这个号没问题、后端说形状不对」，
   *    用户被拦在一个看不懂的提示前。一致性由 test/auth.test.js 守着。
   */
  function normalizePhone(input) {
    var s = String(input == null ? "" : input).replace(/[\s\-()\.]/g, "");
    return s.replace(/^\+?0*86/, "");
  }

  /** 是否中国大陆手机号形状：1 开头、第二位 3-9、共 11 位（与服务端同规则） */
  function isPhoneShape(v) {
    return /^1[3-9]\d{9}$/.test(normalizePhone(v));
  }

  /* -------------------------------------------------------------- 存储 */

  function emptyState() {
    return {
      v: 1, accounts: {}, codes: {}, sessions: {}, rate: {},
      trusted: {}, profile: null, pepper: null, deviceId: null, tz: null
    };
  }

  /** 注入式存储：默认 localStorage；不可用时降级为内存（隐私模式） */
  function makeStore(backing) {
    var mem = {};
    var usable = true;
    if (!backing) {
      try { backing = typeof localStorage !== "undefined" ? localStorage : null; }
      catch (e) { backing = null; }               // 隐私模式下取用即抛
    }
    if (backing) { try { backing.getItem(NS); } catch (e) { usable = false; } }   // 构造时先探一次
    function raw() {
      if (!backing || !usable) return mem[NS];
      try { return backing.getItem(NS); } catch (e) { usable = false; return mem[NS]; }
    }
    function put(text) {
      mem[NS] = text;
      if (!backing || !usable) return;
      try { backing.setItem(NS, text); }
      catch (e) { usable = false; }               // 写满 / 被禁：继续用内存
    }
    return {
      read: function () {
        var t = raw();
        if (!t) return emptyState();
        try {
          var o = JSON.parse(t);
          return o && typeof o === "object" ? sanitize(o) : emptyState();
        } catch (e) { return emptyState(); }      // 脏数据：整份回落，不抛
      },
      write: function (state) { put(JSON.stringify(state)); },
      persistent: function () { return !!backing && usable; }
    };
  }

  /** 运行时校验：手改 localStorage 也不该让应用崩掉 */
  function sanitize(o) {
    var s = emptyState();
    if (!o || typeof o !== "object") return s;
    ["accounts", "codes", "sessions", "rate", "trusted"].forEach(function (k) {
      if (o[k] && typeof o[k] === "object" && !Array.isArray(o[k])) s[k] = o[k];
    });
    if (typeof o.pepper === "string" && o.pepper) s.pepper = o.pepper;
    if (typeof o.deviceId === "string" && /^d_[0-9a-f]{8}$/.test(o.deviceId)) s.deviceId = o.deviceId;
    if (o.profile && typeof o.profile === "object") s.profile = o.profile;
    if (typeof o.tz === "number") s.tz = o.tz;
    Object.keys(s.accounts).forEach(function (uid) {
      var a = s.accounts[uid];
      if (!a || typeof a !== "object" || typeof a.uid !== "string" || !Array.isArray(a.identities)) {
        delete s.accounts[uid];
      }
    });
    Object.keys(s.codes).forEach(function (id) {
      var c = s.codes[id];
      if (!c || typeof c !== "object" || typeof c.codeHash !== "string") delete s.codes[id];
    });
    return s;
  }

  /* -------------------------------------------------------- 账号与身份 */

  function newUid() { return "u_" + randHex(4); }
  function newCodeId() { return "c_" + randHex(6); }

  /**
   * 生成一个当前未占用的 id（codeId / sid 等）。
   *
   * ⚠️ 这里**刻意不写成 `while (taken(x)) x = rand()`**。那种写法把「不撞」寄托在
   * 随机源不重复上，一旦随机源退化（测试注入的固定源、被 hook 的环境、
   * 某些 WebView 的 Math.random 补丁）就是**死循环**。
   * 现在的写法是「随机取一次 + 确定性线性探测」，步数上限明确，必然收敛。
   *
   * @param {Object} taken 已占用的 id 表（state.codes / state.sessions / state.accounts）
   * @param {string} base  形如 "c_6b6b…" / "u_6b6b…"
   */
  function uniqueId(taken, base) {
    if (!taken || !taken[base]) return base;
    for (var i = 1; i <= 32; i++) {
      var cand = base + "-" + i;
      if (!taken[cand]) return cand;
    }
    return base + "-" + Date.now();     // 兜底：时间戳后缀，不会与既有 id 相同
  }

  function nextCodeId(state) { return uniqueId(state.codes, newCodeId()); }

  function normIdentity(identity) {
    if (!identity || typeof identity !== "object") return null;
    var ch = identity.channel;
    if (CHANNELS.indexOf(ch) < 0) return null;
    var value = ch === "email" ? normalizeEmail(identity.value) : normalizePhone(identity.value);
    if (!value) return null;
    return { channel: ch, value: value };
  }

  function identityKey(id) { return id.channel + ":" + digest(id.value); }

  function findAccount(state, identity) {
    var id = normIdentity(identity);
    if (!id) return null;
    var key = identityKey(id);
    var uids = Object.keys(state.accounts);
    for (var i = 0; i < uids.length; i++) {
      var acc = state.accounts[uids[i]];
      for (var j = 0; j < acc.identities.length; j++) {
        if (acc.identities[j].key === key) return acc;
      }
    }
    return null;
  }

  function createAccount(state, identity) {
    var id = normIdentity(identity);
    var t = now();
    var uid = uniqueId(state.accounts, newUid());   // uid 永不复用，但也不能死循环找
    var acc = {
      uid: uid,
      identities: [{ channel: id.channel, key: identityKey(id), mask: maskEmail(id.value), verifiedAt: t }],
      profile: { nickname: "" },
      createdAt: t, updatedAt: t, lastLoginAt: t,
      status: "active",
      plan: { tier: "free", until: null },
      security: { codesToday: 0, codesDay: dayKey(t), failCount: 0, lockedUntil: null, pwVersion: null }
    };
    state.accounts[uid] = acc;
    return acc;
  }

  function dayKey(ts) { return new Date(ts).toISOString().slice(0, 10); }

  function ensureBase(state) {
    if (!state.pepper) state.pepper = randHex(16);
    if (!state.deviceId) state.deviceId = "d_" + randHex(4);
    return state;
  }

  /* ----------------------------------------------------------- 频控 */

  /**
   * 这一档的窗口定义：`phone` 走更严的 RATE_SMS，其余走 RATE。
   * ⚠️ 认档必须发生在**同一个地方** —— 若 rateCheck 不认 phone 档，
   *    `RATE_SMS.phone` 就永远读不到，短信实际是**不限速**的，
   *    而代码看起来「写了限制」（这类「写了但没接上」正是 2A 那两个洞的同款）。
   */
  function windowsFor(bucket) {
    if (bucket === "phone") return RATE_SMS.phone || [];
    return RATE[bucket] || [];
  }

  /**
   * 超限时回哪个错误码 —— **服务端 `core.js` 里那张一模一样的表**。
   *
   * ⚠️ 这里必须把 `phone` 与 `email` 一起折进 `E_RATE_EMAIL`，且**与线的另一端
   *    逐字一致**。原先服务端那张表是 `"email" || "phone" ? E_RATE_EMAIL : …`，
   *    前端只有 email 没 phone —— 两边对着同一份 `sendCode` 签名，
   *    回的具体码却可能不一样。服务端 429 的码是直接回给界面看的，
   *    于是症状是「同一个超限，本机版说一句话、服务端版说另一句话」。
   *    这类「两端各写一份、谁也不报错」的漂移由 test/api.test.js 的对拍守着。
   */
  function rateCode(bucket) {
    if (bucket === "email" || bucket === "phone") return "E_RATE_EMAIL";
    if (bucket === "device") return "E_RATE_DEVICE";
    if (bucket === "ip") return "E_RATE_IP";
    return "E_RATE_GLOBAL";
  }

  function rateCounts(state, bucket, key, t) {
    var id = bucket + ":" + key;
    // 最长窗口是「月」档（短信 30 天），保留 30 天内的记录
    var arr = (state.rate[id] || []).filter(function (ts) { return ts > t - 2592000000; });
    state.rate[id] = arr;
    return arr;
  }

  function rateCheck(state, bucket, key, t) {
    var windows = windowsFor(bucket);
    var arr = rateCounts(state, bucket, key, t);
    for (var i = 0; i < windows.length; i++) {
      var span = windows[i][0], cap = windows[i][1];
      var hit = arr.filter(function (ts) { return ts > t - span; });
      if (hit.length >= cap) {
        var oldest = Math.min.apply(null, hit);
        return { ok: false, retryAfter: Math.ceil((oldest + span - t) / 1000) };
      }
    }
    return { ok: true, retryAfter: 0 };
  }

  function rateHit(state, bucket, key, t) {
    var id = bucket + ":" + key;
    state.rate[id] = (state.rate[id] || []).concat([t]);
  }

  /* --------------------------------------------------------- 时间倒退 */

  /**
   * 系统时间被改早 —— 会让「已过期的码」重新变成有效码，是绕过期最容易的路。
   * 处理：记录上一次见过的时刻 tz；发现倒退就作废全部未用码。
   */
  function guardClock(state, t) {
    if (typeof state.tz === "number" && t < state.tz - 60000) {
      Object.keys(state.codes).forEach(function (k) {
        if (!state.codes[k].consumedAt) state.codes[k].consumedAt = t;
      });
      // 只作废验证码，不动会话：会话过期在 session() 里按 expiry 正常处理，
      // 顺手清会话会把「到期」误判成「有人改了系统时间」。
      state.clockRewound = true;
      state.tz = t;
      return { rewound: true };
    }
    state.tz = Math.max(t, typeof state.tz === "number" ? state.tz : t);
    return { rewound: false };
  }

  /* ------------------------------------------------------- 发码 */

  function requestCode(store, identity, purpose, opts) {
    opts = opts || {};
    purpose = purpose || "login";
    if (PURPOSES.indexOf(purpose) < 0) return { ok: false, code: "E_PURPOSE", message: ERR.E_PURPOSE };

    var id = normIdentity(identity);
    if (!id) {
      var ch = identity && identity.channel;
      return { ok: false, code: ch && CHANNELS.indexOf(ch) < 0 ? "E_CHANNEL" : "E_EMAIL_EMPTY", message: ERR[ch && CHANNELS.indexOf(ch) < 0 ? "E_CHANNEL" : "E_EMAIL_EMPTY"] };
    }
    if (id.channel === "sms" && !isPhoneShape(id.value)) {
      return { ok: false, code: "E_PHONE_FORMAT", message: ERR.E_PHONE_FORMAT };
    }
    if (id.channel === "email" && !isEmailShape(id.value)) {
      return { ok: false, code: "E_EMAIL_FORMAT", message: ERR.E_EMAIL_FORMAT };
    }
    var sentTo = id.channel === "email" ? maskEmail(id.value) : maskPhone(id.value);

    var state = ensureBase(store.read());
    var t = now();
    guardClock(state, t);

    var key = identityKey(id);
    // 通道各自一档：短信走 RATE_SMS（更严），邮箱走 RATE.email。
    var bucket = id.channel === "sms" ? "phone" : "email";
    var gate = rateCheck(state, bucket, key, t);
    if (!gate.ok) {
      var gc = rateCode(bucket);
      return { ok: false, code: gc, retryAfter: gate.retryAfter, message: ERR[gc] };
    }
    // 「重新发送」是重发一封，不是"上一封还没收到就再要一封"，因此冷却不参与封禁判定
    // ⚠️ 冷却时长与桶**同源**：短信走短信那一档（服务端 `smsResendCooldownMs` 与它同值）。
    //    原先两条通道共用 RESEND_COOLDOWN_MS 一个常量，而服务端是**两个键** ——
    //    「将来单独收紧短信」那天，两端就会各说各的秒数。2C 把这条也并到一处。
    var coolMs = bucket === "phone" ? SMS_RESEND_COOLDOWN_MS : RESEND_COOLDOWN_MS;
    var sent = rateCounts(state, bucket, key, t);
    if (sent.length && sent[sent.length - 1] > t - coolMs) {
      var wait = Math.ceil((sent[sent.length - 1] + coolMs - t) / 1000);
      return { ok: false, code: "E_RATE_EMAIL", retryAfter: wait, message: ERR.E_RATE_EMAIL };
    }
    gate = rateCheck(state, "device", state.deviceId, t);
    if (!gate.ok) return { ok: false, code: "E_RATE_DEVICE", retryAfter: gate.retryAfter, message: ERR.E_RATE_DEVICE };
    gate = rateCheck(state, "global", "all", t);
    if (!gate.ok) return { ok: false, code: "E_RATE_GLOBAL", retryAfter: gate.retryAfter, message: ERR.E_RATE_GLOBAL };
    /* ⚠️ 本机版**不判 IP 档**，但它**有这张表**（见上面的 RATE.ip）。
       为什么「有表不判」：浏览器里拿不到可信的出口地址 —— 服务端那条路有
       `x-forwarded-for` 可读，而这里只能拿到「本机」这一个桶。
       按一个假 key 去限速只会把「同一个人多试两次」判成「有人攻击」。
       保留这张表的理由是**两端同一张表**：真实部署里 `sendCode` 两端都只连服务端，
       而表只在一端存在，就是下一个人踩坑的地方（`rateCode` 认 ip 那句同理）。*/

    var acc = findAccount(state, id) || createAccount(state, id);

    // 锁定检查按 uid 计，不按邮箱字符串 —— 否则换大小写就能绕过
    if (acc.security.lockedUntil && acc.security.lockedUntil > t) {
      return { ok: false, code: "E_LOCKED", retryAfter: Math.ceil((acc.security.lockedUntil - t) / 1000), message: ERR.E_LOCKED };
    }

    // 同 uid + purpose 只保留最新一枚：发新的即作废旧记录
    Object.keys(state.codes).forEach(function (cid) {
      var c = state.codes[cid];
      if (c.uid === acc.uid && c.purpose === purpose && !c.consumedAt) c.consumedAt = t;
    });

    if (acc.security.codesDay !== dayKey(t)) { acc.security.codesDay = dayKey(t); acc.security.codesToday = 0; }
    acc.security.codesToday += 1;
    if (acc.security.codesToday > 10) {
      acc.security.lockedUntil = t + 3600000;
      store.write(state);
      return { ok: false, code: "E_LOCKED", retryAfter: 3600, message: ERR.E_LOCKED };
    }

    var code = opts.code || digits(CODE_LEN);
    var salt = randHex(8);
    // codeId 必须唯一：**绝不能写成 do…while 重试** —— 重试依赖随机源不重复，
    // 一旦随机源退化（测试注入的固定源、或某些被 hook 的环境）就是死循环。
    // 这里改成「撞了就换下一个序号」，确定性、有限步。
    var rec = {
      codeId: nextCodeId(state),
      uid: acc.uid, purpose: purpose, channel: id.channel,
      sentTo: sentTo,
      codeHash: codeDigest(acc.uid, purpose, code, salt),
      salt: salt,
      issuedAt: t, expiresAt: t + CODE_TTL_MS,
      attempts: 0, consumedAt: null
    };
    state.codes[rec.codeId] = rec;
    rateHit(state, bucket, key, t);
    rateHit(state, "device", state.deviceId, t);
    rateHit(state, "global", "all", t);
    store.write(state);

    // ⚠️ 只把明文码交给调用方（用于本地体验版的复制/mailto），绝不落盘、绝不打日志
    return {
      ok: true, codeId: rec.codeId, code: code, purpose: purpose, channel: id.channel,
      sentTo: rec.sentTo, expiresAt: rec.expiresAt, cooldown: Math.ceil(RESEND_COOLDOWN_MS / 1000),
      isNewAccount: acc.createdAt === acc.updatedAt,
      disposable: id.channel === "email" && isDisposable(id.value),
      hint: id.channel === "email" ? emailHint(id.value) : null
    };
  }

  /* ------------------------------------------------------- 校验 */

  function issueSession(state, acc, scope, t) {
    var sid = uniqueId(state.sessions, "s_" + randHex(8));
    var sess = { sid: sid, uid: acc.uid, scope: scope, iat: t, exp: t + SESSION_DAYS * 86400000, nonce: randHex(8) };
    state.sessions[sid] = sess;
    return sess;
  }

  function verifyCode(store, codeId, code, purpose) {
    purpose = purpose || "login";
    if (!codeId) return { ok: false, code: "E_NO_CODE", message: ERR.E_NO_CODE };
    var state = ensureBase(store.read());
    var t = now();
    guardClock(state, t);

    var rec = state.codes[codeId];
    if (!rec) return { ok: false, code: "E_CODE_VOID", message: ERR.E_CODE_VOID };
    if (rec.purpose !== purpose) return { ok: false, code: "E_PURPOSE", message: ERR.E_PURPOSE };
    if (rec.consumedAt) return { ok: false, code: "E_CODE_USED", message: ERR.E_CODE_USED };
    if (rec.expiresAt <= t) return { ok: false, code: "E_CODE_EXPIRED", message: ERR.E_CODE_EXPIRED };
    if (rec.attempts >= CODE_MAX_ATTEMPTS) return { ok: false, code: "E_CODE_VOID", message: ERR.E_CODE_VOID };

    var acc = state.accounts[rec.uid];
    if (!acc) return { ok: false, code: "E_CODE_VOID", message: ERR.E_CODE_VOID };
    if (acc.security.lockedUntil && acc.security.lockedUntil > t) {
      return { ok: false, code: "E_LOCKED", retryAfter: Math.ceil((acc.security.lockedUntil - t) / 1000), message: ERR.E_LOCKED };
    }

    var given = String(code == null ? "" : code).replace(/\D/g, "");
    var expect = codeDigest(acc.uid, purpose, given, rec.salt);
    // 定长比较，失败也走完全程，不早退（防时序侧信道；服务端实现同样要求）
    var same = given.length === CODE_LEN && expect === rec.codeHash ? 1 : 0;

    if (!same) {
      rec.attempts += 1;
      acc.security.failCount += 1;
      if (rec.attempts >= CODE_MAX_ATTEMPTS) {
        rec.consumedAt = t;                                        // 该码作废，必须重发
        acc.security.failRounds = (acc.security.failRounds || 0) + 1;   // 一整轮「发码后全错」
      }
      // 不能按 failCount >= 3 锁：单码本身就能错 5 次，正常用户打错三次就被锁一天，
      // 那是事故不是防护。该锁的是「整轮失败」：连续 3 轮发码后一次都没对。
      if ((acc.security.failRounds || 0) >= 3) acc.security.lockedUntil = t + 86400000;
      store.write(state);
      var left = CODE_MAX_ATTEMPTS - rec.attempts;
      if (!left) return { ok: false, code: "E_CODE_VOID", message: ERR.E_CODE_VOID };
      return {
        ok: false, code: "E_CODE_WRONG", attemptsLeft: left,
        message: ERR.E_CODE_WRONG + "，还可以再试 " + left + " 次"
      };
    }

    rec.consumedAt = t;                       // 单次使用，成功即失效
    acc.lastLoginAt = t;
    acc.updatedAt = t;
    acc.security.failCount = 0;
    var sess = issueSession(state, acc, "account", t);
    state.trusted[acc.uid] = t + TRUST_DAYS * 86400000;
    store.write(state);
    return { ok: true, session: sess, account: publicAccount(acc), isLocalOnly: !store.persistent() };
  }

  /* ------------------------------------------------------- 会话 */

  function publicAccount(acc) {
    return {
      uid: acc.uid, status: acc.status,
      nickname: (acc.profile && acc.profile.nickname) || "",
      identities: acc.identities.map(function (i) { return { channel: i.channel, mask: i.mask, verifiedAt: i.verifiedAt }; }),
      plan: acc.plan, createdAt: acc.createdAt, lastLoginAt: acc.lastLoginAt
    };
  }

  function session(store) {
    var state = ensureBase(store.read());
    var t = now();
    guardClock(state, t);
    var sids = Object.keys(state.sessions);
    if (!sids.length) return null;
    var sid = sids[sids.length - 1];
    var sess = state.sessions[sid];
    if (!sess || sess.exp <= t) {
      if (sess) { delete state.sessions[sid]; store.write(state); }
      return null;
    }
    if (sess.exp - t < SESSION_RENEW_DAYS * 86400000) {   // 静默续期
      sess.exp = t + SESSION_DAYS * 86400000;
      store.write(state);
    }
    var acc = state.accounts[sess.uid];
    if (!acc || acc.status !== "active") return null;
    return { scope: sess.scope, exp: sess.exp, account: publicAccount(acc) };
  }

  function trustedAccount(store) {
    var state = ensureBase(store.read());
    var t = now();
    var hit = Object.keys(state.trusted).filter(function (uid) { return state.trusted[uid] > t; });
    if (hit.length !== 1) return null;                 // 多个/零个都不自动进入
    var acc = state.accounts[hit[0]];
    return acc && acc.status === "active" ? publicAccount(acc) : null;
  }

  function signOut(store) {
    var state = ensureBase(store.read());
    state.sessions = {};
    state.codes = {};
    store.write(state);
    return { ok: true };                                // 只清会话，绝不碰进度数据
  }

  function signInTrusted(store) {
    var state = ensureBase(store.read());
    var t = now();
    var hit = Object.keys(state.trusted).filter(function (uid) { return state.trusted[uid] > t; });
    if (hit.length !== 1) return { ok: false, code: "E_IDENTITY", message: ERR.E_IDENTITY };
    var acc = state.accounts[hit[0]];
    if (!acc || acc.status !== "active") return { ok: false, code: "E_IDENTITY", message: ERR.E_IDENTITY };
    acc.lastLoginAt = t;
    var sess = issueSession(state, acc, "account", t);
    store.write(state);
    return { ok: true, session: sess, account: publicAccount(acc) };
  }

  /* ------------------------------------------------- 重设凭证 / 注销 */

  /**
   * 本期没有密码，"找回密码"等价于：用 login 码之外的独立 purpose 验证身份后
   * 吊销全部会话 + 取消全部设备信任，然后让用户重新登录。
   * 接服务端后这里还要踢掉服务端会话（docs 第 4 节）。
   */
  function resetCredential(store, codeId, code) {
    var r = verifyCode(store, codeId, code, "reset");
    if (!r.ok) return r;
    var state = ensureBase(store.read());
    state.sessions = {};
    state.trusted = {};
    Object.keys(state.accounts).forEach(function (uid) {
      var a = state.accounts[uid];
      if (a.uid === r.account.uid) { a.security.failCount = 0; a.security.lockedUntil = null; }
    });
    store.write(state);
    return { ok: true, account: r.account };
  }

  /**
   * 注销账号：调用方必须先做二次确认 + 重输邮箱确认。
   * 本函数只清账号与会话；**进度数据是否一并清空由调用方另外询问**
   * （绝不在这里顺手删别人的背诵记录）。
   */
  function deleteAccount(store, emailConfirm) {
    var state = ensureBase(store.read());
    var t = now();
    var sess = session(store);
    if (!sess) return { ok: false, code: "E_IDENTITY", message: ERR.E_IDENTITY };
    var acc = state.accounts[sess.account.uid];
    if (!acc) return { ok: false, code: "E_IDENTITY", message: ERR.E_IDENTITY };
    var emailId = acc.identities.filter(function (i) { return i.channel === "email"; })[0];
    var want = emailId ? digest(normalizeEmail(emailConfirm)) : null;
    if (!want || want !== emailId.key.split(":")[1]) {
      return { ok: false, code: "E_EMAIL_FORMAT", message: "请输入注册时用的完整邮箱以确认" };
    }
    acc.status = "deleted";
    delete state.accounts[acc.uid];
    delete state.trusted[acc.uid];
    state.sessions = {};
    state.codes = {};
    store.write(state);
    return { ok: true, uid: acc.uid, t: t };            // uid 不回收
  }

  /* ------------------------------------------------- 进度归属（合并） */

  /**
   * 登录时把本机已有进度「认领」进账号 —— 不这么做，用户一注册就丢光数据。
   * 只决定"用谁的"，不写任何东西：真正的落盘由调用方按返回的 action 处理。
   * 合并粒度只到进度记录 + 昵称 + 账号域设置，设备偏好一律不同步。
   */
  function mergePolicy(local, remote) {
    var l = local || {}, r = remote || {};
    var localIds = Object.keys(l.recs || {});
    var remoteIds = Object.keys(r.recs || {});
    if (!localIds.length && !remoteIds.length) return { action: "none", put: {}, take: [] };
    if (localIds.length && !remoteIds.length) return { action: "adoptLocal", put: l.recs, take: [] };
    if (!localIds.length && remoteIds.length) return { action: "takeRemote", put: {}, take: remoteIds };
    var put = {}, take = [], conflict = [];
    localIds.forEach(function (id) {
      var a = l.recs[id], b = r.recs[id];
      if (!b) { put[id] = a; return; }
      // 打卡要单调：取复习次数多、下次复习更晚的那一份，绝不因合并回退
      var better = (a.reps || 0) > (b.reps || 0) ? a
        : (a.reps || 0) < (b.reps || 0) ? b
        : (a.nextReviewAt || 0) >= (b.nextReviewAt || 0) ? a : b;
      if (better === b) take.push(id);
      else if (better === a) put[id] = a;
      else conflict.push(id);
    });
    remoteIds.forEach(function (id) { if (!put[id] && localIds.indexOf(id) < 0) take.push(id); });
    if (conflict.length) return { action: "ask", conflict: conflict, put: put, take: take };
    return { action: "merge", put: put, take: take };
  }

  function nickname(store) {
    var p = store.read().profile;
    return p && typeof p.nickname === "string" ? p.nickname : "";
  }

  function setNickname(store, name) {
    var state = ensureBase(store.read());
    var n = String(name == null ? "" : name).replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 12);
    state.profile = state.profile || {};
    state.profile.nickname = n;
    state.sessions && Object.keys(state.sessions).forEach(function (sid) {
      var acc = state.accounts[state.sessions[sid].uid];
      if (acc) { acc.profile.nickname = n; acc.updatedAt = now(); }
    });
    store.write(state);
    return n;
  }

  /* -------------------------------------------------------------- 导出 */

  return {
    NS: NS, PURPOSES: PURPOSES, CHANNELS: CHANNELS, RATE: RATE, RATE_SMS: RATE_SMS, ERR: ERR,
    CODE_LEN: CODE_LEN, CODE_TTL_MS: CODE_TTL_MS, CODE_MAX_ATTEMPTS: CODE_MAX_ATTEMPTS,
    RESEND_COOLDOWN_MS: RESEND_COOLDOWN_MS, SMS_RESEND_COOLDOWN_MS: SMS_RESEND_COOLDOWN_MS,
    rateCode: rateCode,
    SESSION_DAYS: SESSION_DAYS, TRUST_DAYS: TRUST_DAYS, RATE: RATE,
    makeStore: makeStore, emptyState: emptyState,
    setClock: setClock, setRandom: setRandom,
    normalizeEmail: normalizeEmail, isEmailShape: isEmailShape, emailHint: emailHint,
    isDisposable: isDisposable, maskEmail: maskEmail, maskPhone: maskPhone,
    normalizePhone: normalizePhone, isPhoneShape: isPhoneShape,
    digest: digest, codeDigest: codeDigest,
    requestCode: requestCode, verifyCode: verifyCode,
    session: session, trustedAccount: trustedAccount, signInTrusted: signInTrusted,
    signOut: signOut, resetCredential: resetCredential, deleteAccount: deleteAccount,
    mergePolicy: mergePolicy, nickname: nickname, setNickname: setNickname,
    publicAccount: publicAccount
  };
});
