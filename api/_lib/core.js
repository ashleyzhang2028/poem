/**
 * 1A 期的**业务内核**：六个接口的全部逻辑都写在这里，
 *  `api/*.js` 那几个文件只做「读请求 → 调这里 → 写响应」。
 *
 * 这么切的原因很实：Vercel 的 handler 里没法好好写测试 ——
 * 而这一期的验收标准（docs §4.6）第 4/5 条是「频控四层生效」「注销可用」，
 * 都是必须真跑一遍的事。放在这里就能在 Node 里直接调、不联网。
 *
 * 五条来自 docs §4.3 的 review checklist（**写代码时逐条对照**）：
 *   1. 明文验证码不进任何日志 —— 本文件**没有任何 console.log**，
 *      日志一律走 http.js 的 log()，而它会把 code 抹掉
 *   2. 权益只从 /api/me 来 —— 客户端传上来的 plan 字段一律忽略（见 normalizeGrants）
 *   3. 所有写接口都要频控 —— send-code / verify-code / sync-push / account 全有
 *   4. 无论邮箱是否存在，响应完全一致（防用户枚举）
 *   5. 时间倒退作废全部未用码（本地版已有，服务端照做）
 */
"use strict";

var id = require("./identity");
var mail = require("./mail");
var session = require("./session");

var DAY = 86400000;

/* ------------------------------------------------------------- 工具 */

function ok(body) { return { status: 200, body: body }; }
function err(status, code, message, extra) {
  var body = { code: code, message: message };
  if (extra) Object.keys(extra).forEach(function (k) { body[k] = extra[k]; });
  return { status: status, body: body };
}

function dayKey(ts) { return new Date(ts).toISOString().slice(0, 10); }

/**
 * 生成一个未被占用的 id。
 * ⚠️ 刻意**不写 while 重试**：随机源一旦退化（被 patch 的 crypto、测试注入）
 *    就是死循环。改成「随机取一次 + 确定性线性探测」，步数上限明确。
 *    这条与 js/auth-core.js 的 uniqueId 是同一条教训。
 */
function uniqueId(taken, base) {
  if (!taken || !taken[base]) return base;
  for (var i = 1; i <= 32; i++) if (!taken[base + "-" + i]) return base + "-" + i;
  return base + "-" + Date.now();
}

/* ------------------------------------------------------------- 频控 */

/**
 * 取某一档的窗口定义。
 *
 * ⚠️ `phone` 必须从这里就能认出来 —— 若只写 `cfg.rate.phone`，而 config 里那张表
 *    叫 `rateSms.phone`，取到的就是空数组 = **该档实际不限速**，
 *    而代码看起来「写了限制」。这正是 2A 那两个洞的同款：
 *    限制写在 A 处、读取在 B 处，谁也不报错。
 *    test/api.test.js 里「短信日上限严格小于邮箱」那条就是钉这件事的。
 */
function rateWindow(cfg, bucket) {
  if (bucket === "phone") return (cfg.rateSms && cfg.rateSms.phone) || [];
  return cfg.rate[bucket] || [];
}

/**
 * 超限时回哪个码 —— 与前端 `js/auth-core.js` 的 `rateCode()` **逐字同表**。
 *
 * 服务端 429 的码是**直接回给界面看的**（前端 `messageOf` 认它），
 * 所以「哪一层报哪个码」两端必须一模一样，否则同一个超限在本机版与服务端版
 * 会说出两句不同的话。这类「两端各写一份、谁也不报错」的漂移由
 * test/api.test.js 第十九节的对拍守着。
 */
function rateCode(bucket) {
  if (bucket === "email" || bucket === "phone") return "E_RATE_EMAIL";
  if (bucket === "device") return "E_RATE_DEVICE";
  if (bucket === "ip") return "E_RATE_IP";
  return "E_RATE_GLOBAL";
}

/** 每一层各自的文案（docs §13）—— 前端 ERR 表里那几句的同文，逐字对齐 */
var RATE_MSG = {
  E_RATE_EMAIL: "发得太快了，请稍后再试",
  E_RATE_DEVICE: "这台设备今天发送次数有点多，稍后再试",
  E_RATE_IP: "网络有点异常，稍后再试",
  E_RATE_GLOBAL: "服务忙，请稍后再试"
};

/**
 * 四层频控：邮箱 / 设备 / IP / 全局（docs §4.6 第 4 条）。
 * 每层独立计时，**取最严**：任一层超限即拒，并回该层的 retryAfter。
 *
 * 实现放在内存里（单实例内的滑动窗口）。
 * ⚠️ 这在 Vercel 上是**尽力而为**的 —— 实例会被拉起又回收，
 *    所以真正的防刷主力是「邮箱层 + 码的失败上限」，
 *    内存层只是把「一秒内同一个 IP 打一千次」挡掉。
 *    要严格限流必须上共享存储，那是 2 期的事（免费档不做 Redis）。
 */
function makeRateLimiter() {
  var hits = {};
  return {
    check: function (cfg, bucket, key, t) {
      var windows = rateWindow(cfg, bucket);
      var k = bucket + "|" + key;
      var arr = (hits[k] || []).filter(function (x) { return x > t - DAY; });
      hits[k] = arr;
      for (var i = 0; i < windows.length; i++) {
        var span = windows[i][0], cap = windows[i][1];
        var inWin = arr.filter(function (x) { return x > t - span; });
        if (inWin.length >= cap) {
          return { ok: false, retryAfter: Math.ceil((Math.min.apply(null, inWin) + span - t) / 1000) };
        }
      }
      return { ok: true, retryAfter: 0 };
    },
    hit: function (bucket, key, t) {
      var k = bucket + "|" + key;
      hits[k] = (hits[k] || []).concat([t]);
    },
    /**
     * 「重新发送冷却」：上一次发出去还没到 60 秒就再要一封，直接拒。
     *
     * ⚠️ 它**不是**频控的一档，必须单独判 —— 频控那几档是「一段时间内最多几次」，
     *    而这一条是「两次之间至少隔多久」。混进窗口里写就会出现
     *    「一小时 5 次可以随便连点」这种既能刷、又不像限制的行为
     *    （test/api.test.js 的「60 秒内重复发码被拒」正是它）。
     */
    cooldown: function (bucket, key, winMs, t) {
      var arr = hits[bucket + "|" + key] || [];
      if (!arr.length) return { ok: true, retryAfter: 0 };
      var last = arr[arr.length - 1];
      if (last > t - winMs) return { ok: false, retryAfter: Math.ceil((last + winMs - t) / 1000) };
      return { ok: true, retryAfter: 0 };
    },
    _hits: hits
  };
}

/* --------------------------------------------------------- 账号读写 */

/** 落库的账号形状（**白名单**：多一个字段都不写，免得把不该存的存进去） */
function accountRow(_identityValue, hash, mask, now) {
  return {
    uid: id.newUid(),
    email_hash: hash,
    email_mask: mask,
    nickname: "",
    plan: "free",
    plan_until: null,
    role: "user",
    created_at: now,
    last_login_at: now,
    status: "active"
  };
}

/**
 * 对外的账号形状：**掩码，不是明文邮箱**；不含 email_hash。
 *
 * `role` 也要下发 —— 客户端那边「谁能进管理后台」的唯一判据是
 * `Entitlement.isOwner()`，而它在拿到服务端角色时**以服务端为准**
 * （否则一个把本机存储改空的游客照样是 owner）。
 * 这条链路在 2 期「补洞」之前是断的：`publicAccount` 从来没回过 role，
 * 客户端也就永远走本机兜底 —— 那时「服务端角色优先」只是一句注释。
 *
 * ⚠️ `role` 与 `plan` 是**两条正交的轴**（谁能管理 ≠ 能用什么）：
 *    店长不是 VIP，下发时也不许把 role 折叠进 tier。
 */
function publicAccount(cfg, acc) {
  var role = String(acc.role || "user").toLowerCase();
  if (["owner", "admin", "user"].indexOf(role) < 0) role = "user";
  return {
    uid: acc.uid,
    nickname: acc.nickname || "",
    plan: { tier: planTier(acc), until: acc.plan_until || null },
    role: role,
    features: featuresFor(cfg, planTier(acc)),
    mask: acc.email_mask || "***",
    /* 服务端**如实自报**当前开通到哪一步（2C）。
       ⚠️ 三个字段都是**事实**，不是「尽力」的判断：
         · mail   —— 真信走哪个通道（"console" 就是「真实用户收不到」，如实说）
         · db     —— 账号与进度落在哪（"memory" 就是「重启即丢」，如实说）
         · sms    —— 短信通道是否真的能发（没接商就是 false，与 2B 的 503 同口径）
       界面据此标注「由服务器判定」时才有资格自称权威：一个连着内存盘、
       发信靠 console 的实例，说的话与一个配齐的实例不是同一件事。
       这一份**不落盘、不参与判权**（客户端只用来如实标注，见 js/account-api.js）。 */
    channel: channelFacts(cfg)
  };
}

/**
 * 服务端当前**开通到哪一步**（2C）。
 *
 * 为什么要把这三件事下发到界面：docs §4.9 第 2 条那条「不假装」——
 * 说了「由服务器判定」，就得让用户看得见**这台服务器是什么状态**。
 * 三个字段全部取自既有的判定函数（`cfg.mail()` / `cfg.hasDb()`），
 * 这里**不重算一份**（重算的下场见 config.mail() 那段注释：假绿且不报错）。
 *
 * ⚠️ 未登录时 `/api/me` 回 401，因此这三项**不会**给到未授权的人。
 */
function channelFacts(cfg) {
  var mail = typeof cfg.mail === "function" ? cfg.mail() : "console";
  var hasDb = typeof cfg.hasDb === "function" ? !!cfg.hasDb() : false;
  return {
    mail: mail,
    delivered: mail !== "console",                  // console 发的信真实用户收不到
    db: hasDb ? "db" : "memory",                    // memory = 重启即丢，如实标出来
    sms: !!(cfg.smsEnabled && cfg.smsTransport)     // 与 2B 的 503 同口径
  };
}

/**
 * 权益：**服务端唯一判定点**（docs §2.4 第 8 条）。
 * 层级来自 `accounts.plan`，到期即回落 free。
 * `role`（谁能管理）与 `plan`（能用什么）是**两条正交的轴** —— 与
 * js/entitlement.js 的口径一致，服务端这里不再重复一套矩阵，
 * 只把「层级」算准，能力清单由 featuresFor 按同一张表给出。
 */
function planTier(acc) {
  var p = String(acc.plan || "free").toLowerCase();
  if (["free", "pro", "max"].indexOf(p) < 0) return "free";
  if (acc.plan_until && Number(acc.plan_until) <= Date.now()) return "free";
  return p;
}

/**
 * 能力清单：与 `js/entitlement.js` 的 `CAPS` **同一张表**。
 *
 * ⚠️ 键名必须逐字一致（`test/api.test.js` 有对拍断言）。
 *    原先这里写的是 `game.flyingFlower` / `game.exam`，而客户端那一份写的是
 *    `feihualing` / `exam.paper` —— 两边**各自都觉得对**，症状是
 *    「界面把飞花令点亮了，服务端判分口回 403」。这正是 2A 那两个洞的形状：
 *    限制写在 A 处、读取在 B 处，谁也不报错。
 *
 * ⚠️ 用户 2026-09-17 的裁决在这里落地：**飞花令与现场考试归 Max，题库复习归 Pro**。
 *    Max 是「Pro 之上再加」，所以那两条只进 max 那一档（不是 pro）。
 */
function featuresFor(cfg, tier) {
  /* 逐字对齐 js/entitlement.js 的 CAPS 键名（有对拍断言守着）。
     · free 那一档五项与客户端完全同一个名字（原先这里是 recite.daily /
       library.read / helper.pinyin / export.json / speech.read 五个别名，
       与客户端的 recite.basic / library.all / pinyin.helper / export.progress /
       read.aloud **一一对不上** —— 接口照常回 200，界面照着做，谁也发现不了）。
     · quiz.review 是 3 期新增的那一档（题库复习，归 Pro）。 */
  var base = ["recite.basic", "library.all", "read.aloud", "pinyin.helper", "export.progress"];
  var pro = ["collections.many", "sync.multiDevice", "export.paper",
             "profile.family", "quiz.review"];
  var max = ["export.all", "collections.unlimited",
             "feihualing", "exam.paper"];
  /* ⚠️ 这里**没有** ai.explain / ai.explain.big —— 已被删除（用户 2026-09-17：
     「把需要收我 app 费用的功能删除」）。AI 讲解 / 纠音是每调一次都真花钱的
     那一类，与「本站不收款」放在一起就是每用一次亏一次。客户端 CAPS 同步删除，
     两端逐字对拍由 test/api.test.js 与 test/ops.test.js 守着。 */
  var out = base.slice();
  if (tier === "pro" || tier === "max") out = out.concat(pro);
  if (tier === "max") out = out.concat(max);
  return out;
}

/**
 * ⚠️ 第 2 条 checklist：**客户端传上来的 plan 一律忽略**。
 * 这个函数的唯一作用就是「证明它被忽略」——
 * 任何想从请求体里读权益的地方都必须经由它，而它只回一个常量。
 * （写成函数而不是删掉，是为了让「这里发生过一次忽略」在代码里可见，
 *   并有 test/api.test.js 的对应断言钉住。）
 */
function normalizeGrants(_untrusted) {
  return "free";
}

/* ------------------------------------------------------- 发码 */

/**
 * 找到或新建账号。
 *
 * ⚠️ **摘要按 channel 分开命名空间**（email 走 emailHash、sms 走 phoneHash）：
 *    两条通道的值空间不同（一个含 @、一个是 11 位数字），
 *    若共用一个 hash 函数，理论上存在「某手机号串正好等于某邮箱串」的交叉命中。
 *    分命名空间后这种可能被彻底排除，表结构不变（还是 accounts.email_hash 那一列，
 *    它现在存的是「该身份标识的摘要」，列名是历史包袱，见 §8 第 1 条）。
 */
function findOrCreateAccount(store, cfg, identity, t) {
  var ch = identity.channel;
  var hash = ch === "sms"
    ? id.phoneHash(identity.value, cfg.sessionSecret || "no-pepper")
    : id.emailHash(identity.value, cfg.sessionSecret || "no-pepper");
  var mask = ch === "sms" ? id.maskPhone(identity.value) : id.maskEmail(identity.value);
  return Promise.resolve(store.getAccountByHash(hash)).then(function (acc) {
    if (acc && acc.status !== "deleted") return { acc: acc, created: false };
    var row = accountRow(identity.value, hash, mask, t);
    return Promise.resolve(store.putAccount(row)).then(function (saved) {
      return { acc: saved || row, created: true };
    });
  });
}

/**
 * 归一化请求里的身份标识，产出 `{channel, value, mask, bucket}`。
 *
 * ⚠️ 只认 `email` / `sms` 两种（docs/auth-design.md §13：其余 channel 直接拒绝）。
 *    未知 channel **不静默当作 email** —— 那是「把短信请求发成一封邮件」的源头，
 *    而用户会一直等一条永远不来的短信。E_CHANNEL 明确说「不支持」。
 */
function normIdentity(input) {
  var ch = input && input.channel;
  if (ch === undefined || ch === null || ch === "") ch = "email";  // 缺省仍是邮箱（1A 的老行为）
  ch = String(ch).toLowerCase();
  if (ch !== "email" && ch !== "sms") {
    return { bad: "E_CHANNEL", message: "暂时不支持这种登录方式" };
  }
  var raw = input.value != null ? input.value : input.email != null ? input.email : input.phone;
  if (ch === "email") {
    var email = id.normalizeEmail(raw);
    if (!id.isEmailShape(email)) return { bad: "E_EMAIL_FORMAT", message: "这个邮箱看起来不太对，再检查一下" };
    return { channel: ch, value: email, mask: id.maskEmail(email), bucket: "email", key: email };
  }
  var phone = id.normalizePhone(raw);
  if (!id.isPhoneShape(phone)) return { bad: "E_PHONE_FORMAT", message: "这个手机号看起来不太对，再检查一下" };
  return { channel: ch, value: phone, mask: id.maskPhone(phone), bucket: "phone", key: phone };
}

/**
 * 短信通道当前是否可用。
 *
 * ⚠️ 这是 2B 的**核心口径**：`SMS_ENABLED=1` 只是「允许尝试」，
 *    真正能不能发取决于有没有接入短信商（cfg.smsTransport）。
 *    两者都不满足时，请求以 503 + `E_SMS_NOT_OPEN` 被**如实拒掉**。
 *    绝不走 console 兜底把它「成功」掉 —— 一条永远收不到的短信，
 *    和一个「已发送」的提示，加起来就是骗人（§12 总原则：条款不许跑在代码前面）。
 */
function smsReady(cfg) {
  return !!(cfg.smsEnabled && cfg.smsTransport);
}

/**
 * 发码：**响应与请求一律不看账号是否存在**（第 4 条 checklist）。
 * 新老账号走同一条路径，同一个 status、同一个 body 形状。
 *
 * channel 只影响三件事：**归一化规则、频控档、谁去投递**。
 * 状态机、码的生成与摘要、失败上限、时钟回拨保护 —— 两条通道**逐字共用**，
 * 这正是 §8 那句「短信不是另一套流程」在代码里的样子。
 */
function sendCode(deps, input) {
  var cfg = deps.cfg, store = deps.store, limiter = deps.limiter, t = deps.now();

  var who = normIdentity(input);
  if (who.bad) return Promise.resolve(err(400, who.bad, who.message));

  var isSms = who.channel === "sms";
  var purpose = input.purpose === "reset" ? "reset" : "login";
  var device = String(input.deviceId || "unknown").slice(0, 40);
  var ip = String(input.ip || "unknown");

  /* ---- 短信口子：没开通就**如实拒绝**，且不做任何副作用 ---- */
  if (isSms && !smsReady(cfg)) {
    return Promise.resolve(err(503, "E_SMS_NOT_OPEN",
      "短信登录还没开通（需要先签短信商并完成模板报备）。当前可用邮箱随机码登录。"));
  }

  /* ---- 频控 ---- */
  // 短信档**更严**（docs §8）：phone 是独立的一档，且额外叠 60 秒冷却。
  // 邮箱档照旧走 email / device / ip / global 四层。
  var buckets, coolMs, coolBucket, coolKey;
  if (isSms) {
    buckets = [["phone", who.key], ["device", device], ["ip", ip], ["global", "all"]];
    coolBucket = "phone"; coolKey = who.key;
    coolMs = cfg.smsResendCooldownMs || 60000;
  } else {
    buckets = [["email", who.key], ["device", device], ["ip", ip], ["global", "all"]];
    coolBucket = "email"; coolKey = who.key;
    coolMs = cfg.resendCooldownMs;
  }

  for (var i = 0; i < buckets.length; i++) {
    var g = limiter.check(cfg, buckets[i][0], buckets[i][1], t);
    if (!g.ok) {
      var code = rateCode(buckets[i][0]);
      /* ⚠️ 文案按层**分别说**（docs §13：每一行错误码都有一句对应的话）。
         原先四层共用「发得太快了」一句 —— 设备层 / IP 层 / 全局层超限
         也都说「你发得太快」，而用户可能十分钟没点过按钮（是别人在同网段刷）。
         前端内核（js/auth-core.js 的 ERR 表）本来就是分句的，这里对齐到它：
         两端的码与文案由 test/api.test.js 第十九节对拍守着。 */
      return Promise.resolve(err(429, code, RATE_MSG[code] || "发得太快了，请稍后再试", { retryAfter: g.retryAfter }));
    }
  }

  // 重新发送冷却（与频控分开判，见 limiter.cooldown 的说明）
  var cool = limiter.cooldown(coolBucket, coolKey, coolMs, t);
  if (!cool.ok) {
    return Promise.resolve(err(429, "E_RATE_EMAIL", "发得太快了，请稍后再试", { retryAfter: cool.retryAfter }));
  }

  var rawCode = input.code || id.newCode(cfg.codeLength);
  var salt = id.newSalt();

  return findOrCreateAccount(store, cfg, who, t).then(function (r) {
    var acc = r.acc;
    if (acc.status === "locked") return err(423, "E_LOCKED", "为了安全，请稍后再试", { retryAfter: 3600 });

    var codeId = id.newCodeId();
    var rec = {
      code_id: codeId,
      uid: acc.uid,
      purpose: purpose,
      channel: who.channel,
      sent_to: who.mask,              // ⚠️ 落库的也是掩码，不是明文
      code_hash: id.codeHash(acc.uid, purpose, rawCode, salt, cfg.sessionSecret || ""),
      salt: salt,
      issued_at: t,
      expires_at: t + cfg.codeTtlMs,
      attempts: 0,
      consumed_at: null
    };

    // 同 uid + purpose 只留最新一枚
    return Promise.resolve(store.voidCodes(acc.uid, purpose, t))
      .then(function () { return store.putCode(rec); })
      .then(function () {
        buckets.forEach(function (b) { limiter.hit(b[0], b[1], t); });
        return sendVia(cfg, who, rawCode);
      })
      .then(function (sent) {
        // ⚠️ 新老用户回同一个形状。是不是新账号**不在这条响应里**。
        var body = {
          codeId: codeId,
          expiresAt: rec.expires_at,
          cooldown: Math.round(coolMs / 1000),
          // 如实告知通道现状：console 模式真实用户收不到信，不能装作发了
          transport: sent.transport,
          delivered: !!sent.delivered,
          channel: who.channel,
          store: store.kind
        };
        // 冒烟自测口子：**显式**开 ALLOW_CODE_ECHO 才回明文码，默认关
        if (cfg.allowCodeEcho) body.devCode = rawCode;
        return ok(body);
      })
      .catch(function (e) {
        // 发码失败：码已经落库了，但用户收不到 —— 如实回 502，不假装成功。
        // 短信那条路有它自己的错误码（E_SMS_FAIL），因为「短信没发出去」
        // 与「邮件没发出去」对用户的下一步动作不同。
        var isSmsFail = isSms;
        return err(502, isSmsFail ? "E_SMS_FAIL" : "E_MAIL_FAIL",
          isSmsFail ? "短信没发出去，请稍后再试" : "验证码邮件没发出去，请稍后再试",
          { detail: String(e.message || e).slice(0, 120) });
      });
  });
}

/**
 * 把码交给哪个通道送出去。
 * 邮件走 mail.send（sendgrid / resend / console）；短信走同一个适配层，
 * 只是 cfg.mail() 会返回 "sms" —— **业务代码不认识任何短信 API**（§8 第 2 条）。
 */
function sendVia(cfg, who, code) {
  if (who.channel !== "sms") {
    return mail.send(cfg, { to: who.value, mask: who.mask, code: code });
  }
  // 走到这里说明 smsReady(cfg) 已为真（否则上面早返回了）。
  // 复用同一个 mail.send 出口，用一份「短信形态」的 cfg 覆盖通道选择 ——
  // 这样 transports.sms 的实现无需邮件正文，也不会被误当邮件发出去。
  var smsCfg = Object.assign({}, cfg, { mailTransport: "sms" });
  return mail.send(smsCfg, { to: who.value, mask: who.mask, code: code });
}

/**
 * 校验码 → 签发会话。
 * 失败分两类，必须区分开（docs §13）：
 *   · 码本身的问题（错 / 过期 / 已用 / 作废，400）
 *   · 账号被锁（423，带 retryAfter）
 */
function verifyCode_(deps, input) {
  var cfg = deps.cfg, store = deps.store, limiter = deps.limiter, t = deps.now();
  var codeId = String(input.codeId || "");
  var given = String(input.code == null ? "" : input.code).replace(/\D/g, "");
  if (!codeId) return Promise.resolve(err(400, "E_NO_CODE", "请先获取验证码"));
  if (given.length !== cfg.codeLength) return Promise.resolve(err(400, "E_CODE_WRONG", "验证码不对，再检查一下"));

  var gate = limiter.check(cfg, "device", String(input.deviceId || "unknown"), t);
  if (!gate.ok) return Promise.resolve(err(429, "E_RATE_DEVICE", "试得太频繁了，请稍后再试", { retryAfter: gate.retryAfter }));

  return Promise.resolve(store.getCode(codeId)).then(function (rec) {
    if (!rec) return err(400, "E_CODE_VOID", "请用最新收到的验证码");
    // ⚠️ 顺序要紧：**失败次数先判**。错满 5 次时我们顺手把这条记录也标成
    //    「已消费」（等于作废），若先判 consumed_at，用户会看到
    //    「这个验证码已经用过了」—— 而他明明一次都没对。
    //    前端内核（js/auth-core.js 的 verifyCode）判的也是这个顺序，
    //    两边必须一致，否则同一个码在本地版与服务端版给两种说法。
    if (Number(rec.attempts) >= cfg.codeMaxAttempts) return err(400, "E_CODE_VOID", "请用最新收到的验证码");
    if (rec.consumed_at) return err(400, "E_CODE_USED", "这个验证码已经用过了，请重新发送");

    /* ------------------------------------------------------------------
       时钟回拨保护（与本地版 js/auth-core.js 的 guardClock 同一条口径）
       ------------------------------------------------------------------
       服务端时钟当然是可信的，但**「可信」不等于「单调」**：
         · 多实例之间的 NTP 校正会让某个实例的 now 突然退回几百毫秒到几秒
         · 容器迁移 / 快照恢复后的时钟抖动更大
       而这里判的是「码有没有过期」，判据一旦回退，
       已经过期的码就**重新变成有效码** —— 这是绕过过期最省事的一条路。

       判据：这条码记录自己带着 issuedAt；把 **签发时刻** 当成这条记录的水位。
       只要「现在」早于「签发时刻减去两分钟的容差」，就是时钟出了问题，
       此时不猜、不做聪明事，一律当成「这个码不可用」。
       ⚠️ 容差 2 分钟而不是本地版那 60 秒：服务端的这个值要被
          「码在 10 分钟内有效」这条覆盖，容差太大会把正常的轻微抖动判成回拨，
          把真实用户挡在门外 —— 而挡真人比放过一次边界情况更糟。
       ------------------------------------------------------------------ */
    if (t < Number(rec.issued_at) - 120000) return err(400, "E_CODE_VOID", "请用最新收到的验证码");

    if (Number(rec.expires_at) <= t) return err(400, "E_CODE_EXPIRED", "验证码已过期，点「重新发送」");

    var expect = id.codeHash(rec.uid, rec.purpose, given, rec.salt, cfg.sessionSecret || "");
    var same = id.timingSafeEqual(expect, rec.code_hash);

    if (!same) {
      limiter.hit("device", String(input.deviceId || "unknown"), t);
      var next = Number(rec.attempts) + 1;
      var patch = { attempts: next };
      // 超过上限即作废（与本地版同口径）
      if (next >= cfg.codeMaxAttempts) patch.consumed_at = t;
      return Promise.resolve(store.patchCode ? store.patchCode(codeId, patch) : null)
        .then(function () {
          return err(400, "E_CODE_WRONG", "验证码不对，再检查一下", {
            remaining: Math.max(0, cfg.codeMaxAttempts - next)
          });
        });
    }

    // 通过：消费掉码，签发会话
    return Promise.resolve(store.patchCode ? store.patchCode(codeId, { consumed_at: t }) : null)
      .then(function () { return store.getAccount(rec.uid); })
      .then(function (acc) {
        if (!acc || acc.status === "deleted") return err(400, "E_CODE_VOID", "请用最新收到的验证码");
        acc.last_login_at = t;
        return Promise.resolve(store.putAccount(acc)).then(function (saved) {
          var s = session.issue(cfg, acc.uid, t);
          return {
            status: 200,
            body: { account: publicAccount(cfg, saved || acc) },
            // Cookie 只在这里签，别处不签
            cookies: [session.setCookieHeader(cfg, s.token, Math.round((s.exp - t) / 1000))],
            _session: s
          };
        });
      });
  });
}

/* ---------------------------------------------------------- /me */

function me(deps) {
  var cfg = deps.cfg, store = deps.store, acc0 = deps.account;
  if (!acc0) return Promise.resolve(err(401, "E_NO_SESSION", "还没有登录"));
  return Promise.resolve(store.getAccount(acc0.uid)).then(function (acc) {
    if (!acc || acc.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    return ok(publicAccount(cfg, acc));
  });
}

/* -------------------------------------------------------- 同步 */

/**
 * pull：增量拉。
 * `since` 是客户端上次拿到的服务端时间（`serverTime`），不是「自己最后修改时间」——
 * 用服务端时间做游标，才不会被客户端时钟误差拖出「永远拉不到 / 拉到重复」。
 */
function syncPull(deps, input) {
  var store = deps.store, cfg = deps.cfg, t = deps.now();
  if (!deps.account) return Promise.resolve(err(401, "E_NO_SESSION", "还没有登录"));
  var since = Number(input.since) || 0;
  var g = deps.limiter.check(cfg, "device", "pull:" + String(input.deviceId || "unknown"), t);
  if (!g.ok) return Promise.resolve(err(429, "E_RATE_DEVICE", "同步太频繁了，请稍后再试", { retryAfter: g.retryAfter }));
  deps.limiter.hit("device", "pull:" + String(input.deviceId || "unknown"), t);

  return Promise.resolve(store.listProgress(deps.account.uid, since)).then(function (rows) {
    return ok({
      recs: (rows || []).map(function (r) {
        return { id: r.poem_id, payload: r.payload, updatedAt: Number(r.updated_at), deleted: !!r.deleted };
      }),
      serverTime: t
    });
  });
}

/**
 * push：按条覆盖，但**时间戳老的盖不掉新的**。
 * 冲突不在这里静默解决 —— 按 docs §4.4，无法判断来源的一律回 `conflicts`
 * 让客户端弹选择（保留本机 / 保留账号 / 先导出再决定）。
 * 服务端只做「能确定的合并」，判不了的如实上报。
 */
function syncPush(deps, input) {
  var store = deps.store, cfg = deps.cfg, t = deps.now();
  if (!deps.account) return Promise.resolve(err(401, "E_NO_SESSION", "还没有登录"));

  var g = deps.limiter.check(cfg, "device", "push:" + String(input.deviceId || "unknown"), t);
  if (!g.ok) return Promise.resolve(err(429, "E_RATE_DEVICE", "同步太频繁了，请稍后再试", { retryAfter: g.retryAfter }));

  var recs = Array.isArray(input.recs) ? input.recs : [];
  if (recs.length > 2000) return Promise.resolve(err(413, "E_TOO_MANY", "一次推的条数太多了"));

  var clean = [];
  var dropped = 0;
  recs.forEach(function (r) {
    var pid = String((r && r.id) || "").slice(0, 80);
    var ts = Number((r && r.updatedAt) || 0);
    if (!pid || !isFinite(ts) || ts <= 0) { dropped++; return; }
    clean.push({
      poem_id: pid,
      payload: sanitizePayload(r.payload),
      updated_at: Math.round(ts),
      deleted: r.deleted ? 1 : 0
    });
  });
  if (dropped) return Promise.resolve(err(400, "E_BAD_REC", "有 " + dropped + " 条记录缺 id 或时间戳"));

  deps.limiter.hit("device", "push:" + String(input.deviceId || "unknown"), t);

  return Promise.resolve(store.putProgress(deps.account.uid, clean)).then(function () {
    return ok({ applied: clean.length, conflicts: [], serverTime: t });
  });
}

/**
 * 进度载荷的白名单化。
 * ⚠️ 客户端推上来的是**不可信数据**：只收背诵档案认识的几个字段，
 *    并且把长度与数值范围卡死 —— 否则一个坏客户端能把 JSON 塞成任意大小，
 *    免费档那 500MB 与 5GB 出口流量会被人一夜刷爆（docs §4.3 第 3 条）。
 */
function sanitizePayload(p) {
  var out = {};
  if (!p || typeof p !== "object") return out;
  if (typeof p.level === "number") out.level = Math.max(0, Math.min(99, Math.round(p.level)));
  if (typeof p.nextReviewAt === "number") out.nextReviewAt = Math.max(0, Math.round(p.nextReviewAt));
  if (typeof p.learned === "boolean") out.learned = p.learned;
  if (typeof p.reps === "number") out.reps = Math.max(0, Math.min(100000, Math.round(p.reps)));
  if (Array.isArray(p.history)) {
    out.history = p.history.slice(-200).map(function (h) {
      if (!h || typeof h !== "object") return null;
      var r = {};
      if (typeof h.at === "number") r.at = Math.round(h.at);
      if (typeof h.level === "number") r.level = Math.round(h.level);
      return r;
    }).filter(Boolean);
  }
  return out;
}

/* -------------------------------------------------- 权威发放（2.2） */

/**
 * 谁算管理员 —— **服务端这一份是全站唯一判据**（与 `js/entitlement.js` 的
 * `isOwner()` 同口径，但**不是同一套兜底**）。
 *
 * ⚠️ 两边**故意不同**，且这处不同不许被「顺手统一」：
 *    客户端那份在拿不到服务端角色时，会退化成「首次打开的这个浏览器就是主人」
 *    （那时没有服务端，不兜底则 `/admin/` 永远对所有人关着）；
 *    而服务端**没有这种兜底** —— 一个没配 `role` 的账号就是 `"user"`，
 *    因为服务端的判据直接对应「能不能改别人的层级」这个真实权限。
 *    兜底的形态不同，判据的名字与集合必须一致（`owner` / `admin` 才放行），
 *    这一条由 test/api.test.js 拿两边的角色表对拍守着。
 */
function isAdminRole(role) {
  var r = String(role || "user").toLowerCase();
  return r === "owner" || r === "admin";
}

/**
 * 一层「管理员闸」：`POST /admin/grant`、`/admin/grants`、`DELETE /admin/grant`
 * 共用它。**三件事分开回**（未配好 / 未登录 / 没权限），不许合并成一句「失败」——
 * 用户看到的下一步动作完全不同（去配置 / 去登录 / 找管理员）。
 *
 * ⚠️ 没权限回 **403** 而不是 404：这里不玩「假装不存在」那套 ——
 *    接口地址本来就写在 `docs/auth-design.md` §3.5 里，藏着只会让人
 *    以为是自己配错了。
 */
function adminGate(deps, cfg) {
  if (!cfg.hasSession()) {
    return err(503, "E_NOT_CONFIGURED", "服务端还没配置好（缺 SESSION_SECRET）。当前仍可完全离线使用本站。");
  }
  if (!deps.account) return err(401, "E_NO_SESSION", "还没有登录");
  return null;   // 剩下的在 adminGrant 里按**账号的 role** 判（要查一次库）
}

/** 掩码的形状校验：与 `id.maskEmail()` 产出的形态一致（a***@b.com） */
var MASK_RE = /^[^\s@]{1,64}\*{2,}[^\s@]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/**
 * 归一化一条发放请求 → `{ tier, until, mask }` 或 `{ bad, message }`。
 *
 * ⚠️ **只认掩码，不认完整邮箱** —— 界面与管理员手上都只有掩码
 *    （`accounts` 表里也不存明文邮箱，见 §2.4 第 1 条）。
 *    若这里接受明文邮箱再自己掩一次，掩码规则就有了第二份实现，
 *    而两处规则一旦漂移，症状是「管理员明明发了，对方却拿不到」。
 *
 * ⚠️ 层级只认内核那三个值。**不认识的值一律拒**（不是回落 free）——
 *    回落的下场是「管理员手滑写错，用户被降级，而界面说发放成功」。
 */
function normGrantInput(input) {
  var tier = String((input && input.tier) || "").toLowerCase();
  if (["free", "pro", "max"].indexOf(tier) < 0) {
    return { bad: "E_TIER", message: "层级只认 free / pro / max 三个值" };
  }
  var mask = String((input && (input.emailMask || input.mask)) || "").trim().toLowerCase();
  if (!mask) return { bad: "E_MASK", message: "请填邮箱掩码（形如 a***@qq.com）" };
  if (!MASK_RE.test(mask)) {
    return { bad: "E_MASK", message: "掩码形状不对：形如 a***@qq.com，与账号页上显示的那串一致" };
  }
  var until = input && input.until != null && input.until !== "" ? Number(input.until) : null;
  if (until !== null && (!isFinite(until) || until <= 0)) {
    return { bad: "E_UNTIL", message: "到期时刻看不懂（要毫秒时间戳，留空即永久）" };
  }
  return { tier: tier, mask: mask, until: until };
}

/**
 * 发放 / 收回一个层级的**权威名单**（2.2）。
 *
 * ## 与「本机名单」的关系（这条必须说清，否则两边会各说各的）
 *
 *   · 服务端发放 = **权威**。它落在 `accounts.plan` / `accounts.plan_until`，
 *     由 `/api/me` 下发，客户端改一行存储改不动它。
 *   · 本机名单（`poem_plan_grant_v1`）= **手工发邀请码的本机版**，仍在，
 *     没配服务端 / 连不上时的降级路径。它**不是**权威，谁也不许把它说成权威。
 *   · 两者**不自动同步**：服务端发了不等于对方那台机器的本机名单也多一条 ——
 *     那正是「本机名单传不出去」这条局限（docs §3.5）在 2.2 之后仍然成立的部分。
 *
 * ## 按掩码改层级：命中 0 条怎么办
 *
 * **如实回 `matched: 0`，不改任何东西，也不是错误**。理由是本方案里
 * 「发名单」与「对方登录」有必然的先后：对方**先登录一次**（哪怕只是收码进来
 * 又退出去）才会在 `accounts` 里留下一行，管理员才可能拿到他的掩码。
 * 因此 matched:0 的常见成因是「对方还没来过」—— 而这不是可以让代码替他猜的事。
 * ⚠️ 绝不「查不到就先建一条」：那等于按掩码凭空造账号，而掩码是**不可逆**的
 *    （a***@qq.com 对应哪个真实邮箱谁也不知道），造出来的是一个永远登不上的幽灵行。
 *
 * @param {object} input { emailMask, tier, until }
 */
function adminGrant(deps, input) {
  var cfg = deps.cfg, store = deps.store, t = deps.now();

  var gate = adminGate(deps, cfg);
  if (gate) return Promise.resolve(gate);

  var who = normGrantInput(input);
  if (who.bad) return Promise.resolve(err(400, who.bad, who.message));

  return Promise.resolve(store.getAccount(deps.account.uid)).then(function (me) {
    if (!me || me.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    var role = String(me.role || "user").toLowerCase();
    if (!isAdminRole(role)) {
      return err(403, "E_FORBIDDEN", "这一条只对管理员开放（当前角色：" + (role === "user" ? "普通用户" : role) + "）");
    }

    /* 频控：发放是写接口（docs §4.3 第 3 条），走设备档。
       ⚠️ 与同步 / 注销同档同写法，不新开一档 —— 新开一档就要新开一张表，
          而「表写在 A 处、读取在 B 处」正是 2A 那两个洞的形状。 */
    var device = String(input.deviceId || "unknown");
    var g = deps.limiter.check(cfg, "device", "grant:" + device, t);
    if (!g.ok) return err(429, "E_RATE_DEVICE", "操作太频繁了，请稍后再试", { retryAfter: g.retryAfter });
    deps.limiter.hit("device", "grant:" + device, t);

    return Promise.resolve(store.findAccountsByMask(who.mask)).then(function (rows) {
      var hits = (rows || []).filter(function (a) { return a && a.status !== "deleted"; });
      /* 掩码理论上可能撞（a***@qq.com 这样的掩码空间不大）。撞了**不猜**：
         只改第一条，并把 `ambiguous` 如实标出来 —— 猜错等于给另一个人开了 Pro。 */
      var target = hits[0] || null;
      if (!target) {
        return ok({
          matched: 0, changed: false,
          emailMask: who.mask, tier: who.tier, until: who.until,
          note: "这个掩码还没有对应的账号。本方案里「对方先登录一次」才会在库里留下一行 —— 请让对方先登录一次再发。"
        });
      }
      return Promise.resolve(store.patchAccount(target.uid, { plan: who.tier, plan_until: who.until }))
        .then(function () {
          return ok({
            matched: hits.length, changed: true,
            ambiguous: hits.length > 1,
            uid: target.uid,
            emailMask: who.mask,
            /* 回的是**改完之后**的层级 —— 直接复用 publicAccount 的判定，
               不在这里重算一份（重算一份必然与 /api/me 漂移）。 */
            tier: who.tier, until: who.until,
            plan: { tier: who.tier, until: who.until },
            by: me.uid,
            at: t,
            note: "已写进服务端的权威名单：对方下次打开页面（或刷新个人中心）时由服务器判定生效。"
          });
        });
    });
  });
}

/**
 * 列出**权威名单**（`POST /admin/grants`，只读）。
 *
 * ⚠️ 只回掩码，**绝不回 email_hash 或明文**：掩码是给人看的，
 *    摘要泄出去等于把「这个人是不是本站用户」变成可查询的事实。
 * ⚠️ 只列 `plan !== "free"` 的行：那才是「发过东西」的记录。
 *    把全部账号都倒出来不是这一页要做的事（那是「用户列表」，本项目没有它）。
 */
function adminGrants(deps) {
  var cfg = deps.cfg, store = deps.store;
  var gate = adminGate(deps, cfg);
  if (gate) return Promise.resolve(gate);
  return Promise.resolve(store.getAccount(deps.account.uid)).then(function (me) {
    if (!me || me.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    if (!isAdminRole(me.role)) return err(403, "E_FORBIDDEN", "这一条只对管理员开放");
    return Promise.resolve(store.listAccounts()).then(function (rows) {
      var grants = (rows || []).filter(function (a) {
        return a && a.status !== "deleted" && planTier(a) !== "free";
      }).map(function (a) {
        return { emailMask: a.email_mask, tier: planTier(a), until: a.plan_until == null ? null : Number(a.plan_until) };
      });
      return ok({ grants: grants, store: store.kind });
    });
  });
}

/**
 * 收回（`DELETE /admin/grant`）：**等价于发一个 free**，不删账号、不删进度。
 *
 * ⚠️ 刻意不做「删掉那一行的发放记录」这种写法 —— 权威名单**就是** `accounts` 表
 *    里的两个字段，没有第二张表。多一张表就多一处会漂移的地方
 *    （而且那张表一旦与 accounts 对不上，「收回」这件事就有一半不生效）。
 */
function adminRevoke(deps, input) {
  var cfg = deps.cfg, store = deps.store, t = deps.now();
  var gate = adminGate(deps, cfg);
  if (gate) return Promise.resolve(gate);
  var mask = String((input && (input.emailMask || input.mask)) || "").trim().toLowerCase();
  if (!mask || !MASK_RE.test(mask)) return Promise.resolve(err(400, "E_MASK", "掩码形状不对：形如 a***@qq.com"));
  return Promise.resolve(store.getAccount(deps.account.uid)).then(function (me) {
    if (!me || me.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    if (!isAdminRole(me.role)) return err(403, "E_FORBIDDEN", "这一条只对管理员开放");
    var device = String(input.deviceId || "unknown");
    var g = deps.limiter.check(cfg, "device", "grant:" + device, t);
    if (!g.ok) return err(429, "E_RATE_DEVICE", "操作太频繁了，请稍后再试", { retryAfter: g.retryAfter });
    deps.limiter.hit("device", "grant:" + device, t);
    return Promise.resolve(store.findAccountsByMask(mask)).then(function (rows) {
      var hits = (rows || []).filter(function (a) { return a && a.status !== "deleted"; });
      if (!hits.length) return ok({ matched: 0, changed: false, emailMask: mask });
      return Promise.resolve(store.patchAccount(hits[0].uid, { plan: "free", plan_until: null }))
        .then(function () {
          return ok({ matched: hits.length, changed: true, emailMask: mask, tier: "free", by: me.uid, at: t });
        });
    });
  });
}

/* ------------------------------------------------- 古诗词大会（3 期 · 不花钱） */

/**
 * 古诗词大会的三层能力 —— 与 `js/entitlement.js` 的能力表**同一张表**。
 *
 * ⚠️ 这里的键名必须与 `featuresFor()` 和 `js/entitlement.js` 的 `CAPS` 对得上：
 *    · `feihualing` —— 飞花令（**max**）
 *    · `exam.paper` —— 现场考试（**max**）
 *    · `quiz.review` —— 题库复习（**pro**）
 *    对不上的症状是「界面说能用、服务端说不能」—— 而两边都觉得自己是对的。
 *
 * ⚠️ 用户 2026-09-17 的裁决：**「现场考试和飞花令归 max 所有，题库归 pro」**。
 *    与 `docs/auth-design.md` §3.5 那句「飞花令 / 古诗文大会 / 考试与题库 pro 起」
 *    相比，飞花令与现场考试被**上收到 max**，题库复习留在 pro —— 以用户裁决为准。
 */
var GAME_CAP = { fly: "feihualing", paper: "exam.paper", review: "quiz.review" };

/** 这一档能力在给定层级下开不开（与 featuresFor 同源，不另写一套矩阵） */
function gameAllowed(cfg, tier, cap) {
  return featuresFor(cfg, tier).indexOf(cap) >= 0;
}

/**
 * 判分（`POST /api/game/answer`）。
 *
 * 三件事，一件都不许省：
 *
 * ① **能力闸在服务端** —— `featuresFor()` 判，与界面置灰用的是同一张表。
 *    客户端的置灰不是安全边界：直接的 HTTP 请求照样打得到这里。
 *    403 与 401 **分开回**：前者是「你确实没这个权限」，后者是「你还没登录」——
 *    用户看到的下一步动作完全不同，合并成一句「失败」等于什么也没说。
 *
 * ② **题目由服务端重建** —— 请求只带 `bankId` / `poemId` 与 `chosen`。
 *    客户端传上来的 `answer` / `options` 一律忽略（见 api/_lib/game.js）。
 *    重建不出来（题库里没这一条）→ 如实回 400 E_STALE，
 *    **不猜一个」** —— 猜的下场是「服务端判了另一道题，用户答对了却显示错」。
 *
 * ③ **不假装计费** —— 本站**不收款**（用户 2026-09-17：不做收费流程），
 *    所以 `charge` 恒为 false，如实回 `counted:false`、`note` 写明「免费不限次」。
 *    `gameCharge()` 那份按 uid 计数的实现**保留**（万一将来要限次，形状已就位），
 *    但**没有任何调用路径会打开它** —— 一个字都不许写成「已计入额度」。
 */
function gameAnswer(deps, input, extra) {
  var cfg = deps.cfg, t = deps.now();
  var game = (extra && extra.game) || require("./game");

  var kind = String((input && input.kind) || "review").toLowerCase();
  var cap = GAME_CAP[kind];
  if (!cap) return Promise.resolve(err(400, "E_KIND", "不认识的题型（只认 fly / paper / review）"));
  if (!deps.account) {
    return Promise.resolve(err(401, "E_NO_SESSION", "这一项要登录后才能用"));
  }

  return Promise.resolve(deps.store.getAccount(deps.account.uid)).then(function (me) {
    if (!me || me.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    var tier = planTier(me);
    if (!gameAllowed(cfg, tier, cap)) {
      return err(403, "E_TIER", "这一项要 " + (cap === "quiz.review" ? "Pro" : "Max") + " 才能用（当前：" + tier + "）", { cap: cap, tier: tier });
    }

    /* 频控：判分是写接口（它会计数），走设备档 —— 与同步 / 发放同档同写法，
       不新开一档（新开一档就要新开一张表，而「表写在 A 处、读取在 B 处」
       正是 2A 那两个洞的形状）。 */
    var device = String(deps.deviceId || input.deviceId || "unknown");
    var g = deps.limiter.check(cfg, "device", "game:" + device, t);
    if (!g.ok) return err(429, "E_RATE_DEVICE", "答题太频繁了，请稍后再试", { retryAfter: g.retryAfter });
    deps.limiter.hit("device", "game:" + device, t);

    /* 飞花令是一支独立的分支：它判的不是「四个选项里哪一条」，而是
       「你说的这一句在不在语料里」。见 api/_lib/game.js 的 checkFly()。 */
    if (kind === "fly") {
      var fly = game.checkFly(input);
      if (fly.bad) return err(400, fly.bad, fly.message);
      return ok({
        /* ⚠️ `ok` 与 `found` **两个都回**：`ok` 是「这一答算不算对」（与选择题同一个字段，
           客户端不必分两支读），`found` 是「这一句在不在合集里」（飞花令特有的那件事）。
           只回一个的话，界面就得自己判断「哪种题型看哪个字段」——
           那正是「两处各写一遍」的开头。 */
        kind: "fly", ok: fly.found, found: fly.found,
        why: fly.found ? "ok" : "notfound",
        chars: fly.chars, said: fly.said, poemId: fly.poemId, title: fly.title,
        total: fly.total, tier: tier,
        counted: false,
        note: "这一句" + (fly.found ? "在合集里对上了" : "没在合集里找到") +
          "；对上的共 " + fly.total + " 句。判分是逐字比对，不涉及 AI。"
      });
    }

    var q = game.rebuild(input);
    if (!q) return err(400, "E_STALE", "题库里没有这一条（前端缓存可能旧了一版，刷新之后重来）");
    /* ⚠️ 答案从**服务端重建出来的那一份**取，绝不读 input.answer。
       这一行就是「客户端改不了答案」的全部实现 —— 少了它，
       前面那些重建都是白做的。 */
    var r = game.quiz().grade(q, input.chosen);

    var charge = input.charge === true;

    /** 回执：`counted` 只在这个函数里写，别处不许拼一份 */
    function reply(counted) {
      return ok({
        kind: kind, ok: r.ok, why: r.why,
        bankId: q.id, poemId: q.poemId, answer: q.answer,
        tier: tier, cap: cap,
        counted: !!counted,
        note: charge
          ? (counted ? "这一次已计入额度。" : "这次没记上（存储不可用），如实告诉您。")
          : "这一项**免费、不限次**，不计额度（本站不收款，也没有计费）。"
      });
    }

    /* ⚠️ 计费是**异步**的，必须等它回来才回执 —— 写成
       `if (charge) counted = gameCharge(...)` 会拿到一个 Promise，
       于是 `counted` 永远是假值（而响应里那个字段就永远是 false）。
       这是「写了但没接上」的又一处：接口照样回 200，界面照样显示，
       只有账单上什么都没有。 */
    if (!charge) return reply(false);
    return Promise.resolve(gameCharge(deps, me.uid, cap, t)).then(reply);
  });
}

/**
 * 额度计数：**按 uid** 存在 `progress` 表里的一条特殊记录上。
 * 返回 Promise<boolean>（true = 这次真的记上了）。
 *
 * 为什么不新开一张表：额度就是「这个 uid 这个月用了几次」，
 * 而 `progress(uid, poem_id, payload)` 本来就是「按 uid 存一条 JSON」的形状。
 * 新开一张表就要再写一套两个实现（memory / supabase），
 * 而「两个实现键集合不一致 → 静默失效」正是 2.2 那条教训。
 *
 * ⚠️ 月份是**日历月**（`dayKey` 的月档），不是「最近 30 天」——
 *    用户看的账单与日历对得上，才说得清「这个月还剩几次」。
 */
function gameCharge(deps, uid, cap, t) {
  var store = deps.store;
  if (!store || !store.listProgress || !store.putProgress) return false;
  var month = new Date(t).toISOString().slice(0, 7);     // YYYY-MM
  var rowId = "game-quota:" + cap;
  var used = 0;
  return Promise.resolve(store.listProgress(uid, 0)).then(function (rows) {
    (rows || []).forEach(function (r) {
      if (r && r.poem_id === rowId && r.payload && r.payload.month === month) {
        used = Number(r.payload.used) || 0;
      }
    });
    store.putProgress(uid, [{
      poem_id: rowId,
      payload: { v: 1, cap: cap, month: month, used: used + 1 },
      updated_at: t,
      deleted: false
    }]);
    return true;
  })["catch"](function () { return false; });
}

/* -------------------------------------------------------- 注销 */

/**
 * 注销：**先导出、再删行**（docs §4.2 第 3 条：注销即删除 + 数据导出）。
 * 二次确认靠客户端重输一次邮箱（前端做），服务端只认「会话 + 明确意图」。
 */
function accountDelete(deps, input) {
  var store = deps.store, cfg = deps.cfg, t = deps.now();
  if (!deps.account) return Promise.resolve(err(401, "E_NO_SESSION", "还没有登录"));
  if (input.confirm !== true) {
    return Promise.resolve(err(400, "E_CONFIRM", "请先确认要注销这个账号"));
  }
  var uid = deps.account.uid;
  var g = deps.limiter.check(cfg, "device", "del:" + String(input.deviceId || "unknown"), t);
  if (!g.ok) return Promise.resolve(err(429, "E_RATE_DEVICE", "操作太频繁了，请稍后再试", { retryAfter: g.retryAfter }));
  deps.limiter.hit("device", "del:" + String(input.deviceId || "unknown"), t);

  return Promise.resolve(store.listProgress(uid, 0)).then(function (rows) {
    // 导出的是**服务端这一份**（本机那一份由前端自己导出，两边都在用户手里）
    var dump = {
      v: 1,
      exportedAt: t,
      uid: uid,
      recs: (rows || []).map(function (r) {
        return { id: r.poem_id, payload: r.payload, updatedAt: Number(r.updated_at), deleted: !!r.deleted };
      })
    };
    return Promise.resolve(store.deleteProgress(uid))
      .then(function () { return store.revokeSessions(uid); })
      .then(function () { return store.deleteAccount(uid); })
      .then(function () {
        return {
          status: 200,
          body: {
            deleted: true,
            // 不返回 exportUrl —— 本期没有对象存储放导出文件；
            // 数据**直接随响应回**，用户自己存下来。假装有个下载链接更糟。
            export: dump,
            note: "账号与云端进度已删除；本机进度不受影响（本站的本机副本始终是完整的一份）。"
          },
          cookies: [session.clearCookieHeader(cfg)]
        };
      });
  });
}

module.exports = {
  ok: ok,
  err: err,
  sendCode: sendCode,
  verifyCode: verifyCode_,
  me: me,
  syncPull: syncPull,
  syncPush: syncPush,
  accountDelete: accountDelete,
  gameAnswer: gameAnswer,
  gameAllowed: gameAllowed,
  GAME_CAP: GAME_CAP,
  adminGrant: adminGrant,
  adminGrants: adminGrants,
  adminRevoke: adminRevoke,
  isAdminRole: isAdminRole,
  normGrantInput: normGrantInput,
  MASK_RE: MASK_RE,
  publicAccount: publicAccount,
  channelFacts: channelFacts,
  featuresFor: featuresFor,
  planTier: planTier,
  normalizeGrants: normalizeGrants,
  sanitizePayload: sanitizePayload,
  makeRateLimiter: makeRateLimiter,
  rateCode: rateCode,
  RATE_MSG: RATE_MSG,
  uniqueId: uniqueId,
  dayKey: dayKey
};
