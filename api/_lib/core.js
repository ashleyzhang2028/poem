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
    mask: acc.email_mask || "***"
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

/** 与 js/entitlement.js 的能力表同源。1A 只把「层级」接通，清单按同一张表给 */
function featuresFor(cfg, tier) {
  var base = ["recite.daily", "library.read", "helper.pinyin", "export.json", "speech.read"];
  var pro = ["sync.multiDevice", "game.flyingFlower", "game.exam", "ai.explain"];
  var max = ["export.siteWide", "ai.explain.quota.large"];
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
      var code = buckets[i][0] === "email" || buckets[i][0] === "phone" ? "E_RATE_EMAIL"
        : buckets[i][0] === "device" ? "E_RATE_DEVICE"
          : buckets[i][0] === "ip" ? "E_RATE_IP" : "E_RATE_GLOBAL";
      return Promise.resolve(err(429, code, "发得太快了，请稍后再试", { retryAfter: g.retryAfter }));
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
  publicAccount: publicAccount,
  featuresFor: featuresFor,
  planTier: planTier,
  normalizeGrants: normalizeGrants,
  sanitizePayload: sanitizePayload,
  makeRateLimiter: makeRateLimiter,
  uniqueId: uniqueId,
  dayKey: dayKey
};
