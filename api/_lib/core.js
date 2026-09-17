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
var turnstile = require("./turnstile");

var DAY = 86400000;

/**
 * 猜错计数的命名空间。**两种键，存在同一个频控器里**
 * （`progress` 表是业务数据，不许拿它当安全计数的账本 —— 一个坏客户端
 * 顺手写一行同 id 就能把计数清零，而症状是「封禁时不时失效」）。
 *
 *   · `wrong:<uid>` —— 该账号连续错了多少轮（**判据用 uid，不用邮箱字符串**，
 *                      与本地版 js/auth-core.js 同口径：换大小写 / 别名绕不过）
 *   · `wrongip:<ip>` —— 同一个出口 IP 错了多少次（挡住「换小号猜」那条路）
 *
 * 用频控器的滑动窗口而**不是新开一张表**：新开一张表要再写 memory / supabase
 * 两套实现，而「两个实现的键集合不一致 → 静默失效」是本项目反复踩的坑。
 */
var WRONG = { uid: "wrong:", ip: "wrongip:" };

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
  /* Issue #197 的三档：邮箱确认 / 重设口令 / 口令登录。
     它们**不在 cfg.rate 里**（那四档是「发码」专用的表，
     与 js/auth-core.js 的 RATE 逐字对拍；混进去会让那条对拍断言失准）。
     各自成键，理由与短信档一样：将来单独收紧不必动别的。 */
  if (bucket === "verify") return cfg.rateVerify || [];
  if (bucket === "reset") return cfg.rateReset || [];
  if (bucket === "login") return cfg.rateLogin || [];
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
var FAIL_WIN = 3600000;   // 口令失败窗口：1 小时（与 docs §5.5「锁 1 小时」同档）

function makeRateLimiter() {
  var hits = {};
  var fails = {};
  /** 只判不记（纯查询）—— **不是写路径**，见 take 的说明 */
  function inspect(bucket, key, t) {
    var arr = (hits[bucket + "|" + key] || []).filter(function (x) { return x > t - DAY; });
    hits[bucket + "|" + key] = arr;
    return arr;
  }
  function verdict(cfg, bucket, arr, t) {
    var windows = rateWindow(cfg, bucket);
    for (var i = 0; i < windows.length; i++) {
      var span = windows[i][0], cap = windows[i][1];
      var inWin = arr.filter(function (x) { return x > t - span; });
      if (inWin.length >= cap) {
        return { ok: false, retryAfter: Math.ceil((Math.min.apply(null, inWin) + span - t) / 1000) };
      }
    }
    return { ok: true, retryAfter: 0 };
  }
  function record(bucket, key, t) {
    hits[bucket + "|" + key] = (hits[bucket + "|" + key] || []).concat([t]);
  }
  return {
    check: function (cfg, bucket, key, t) {
      return verdict(cfg, bucket, inspect(bucket, key, t), t);
    },
    hit: function (bucket, key, t) {
      record(bucket, key, t);
    },
    /**
     * **判完当场落账** —— 频控四层的**唯一正确用法**（2A 那两个洞的补法）。
     *
     * ## 为什么必须是一个原子动作
     *
     * 原先的写法是「`check` 一圈 → … 干活 … → `hit` 一圈」，中间隔着
     * `await store.getAccount()`、`putCode()`、**一次真的往发信商发 HTTP** ——
     * 那是几百毫秒到几秒。落账之前，`hits` 里一条记录都没有，于是：
     *   · 同一个客户端并发打 20 次 `/api/send-code`，20 次**全部**
     *     在各自的 `check` 里看到空窗口、全部放行 —— 20 封邮件；
     *   · 更省事的一种坏法：**只调 `check` 不调 `hit` 的路径**在任何一层
     *     都不落账（同一个函数名，两处各写一半，正是本项目反复踩的形状）。
     * 也就是说「一小时 5 封」在并发下不是 5 封，是**不限**。
     *
     * ## 与 cooldown 的关系
     *
     * 冷却（「两次之间至少隔 60 秒」）判的是**上一条记录**，所以落账必须
     * **先于**冷却判定之后的任何分支 —— 包括「拒绝」那一条。
     * 否则连着点两次重发会被当成「从来没发过」，冷却永远不生效：
     * 第一次试通过、第二次试还是通过。
     *
     * @returns {{ok:boolean, retryAfter:number}} 不够就 false，**且什么都不记**
     */
    take: function (cfg, bucket, key, t) {
      var v = verdict(cfg, bucket, inspect(bucket, key, t), t);
      if (!v.ok) return v;
      record(bucket, key, t);
      return { ok: true, retryAfter: 0 };
    },
    /**
     * 「重新发送冷却」：上一次发出去还没到 60 秒就再要一封，直接拒。
     *
     * ⚠️ 它**不是**频控的一档，必须单独判 —— 频控那几档是「一段时间内最多几次」，
     *    而这一条是「两次之间至少隔多久」。混进窗口里写就会出现
     *    「一小时 5 次可以随便连点」这种既能刷、又不像限制的行为
     *    （test/api.test.js 的「60 秒内重复发码被拒」正是它）。
     * ⚠️ 与 take 同一条口径：**判与记必须在同一个同步块里**，
     *    中间不许有 await（`take` 的注释里有实测的现场）。
     */
    cooldown: function (bucket, key, winMs, t) {
      var arr = hits[bucket + "|" + key] || [];
      if (!arr.length) return { ok: true, retryAfter: 0 };
      var last = arr[arr.length - 1];
      /* ⚠️ 三条判据必须是**函数**而不是常量：`winMs` 允许是
         `{email, sms}` 两个值（两条通道的冷却时长各自成键，docs §8.4），
         而调用方只传一个「桶名」。这里按桶取 —— 写成常量的症状是
         「短信那条档位被静默地套用了邮箱的 60 秒」，而代码看起来完全正常。 */
      var win = (winMs && typeof winMs === "object") ? Number(winMs[bucket]) || 0 : Number(winMs) || 0;
      if (!win) return { ok: true, retryAfter: 0 };
      if (last > t - win) return { ok: false, retryAfter: Math.ceil((last + win - t) / 1000) };
      return { ok: true, retryAfter: 0 };
    },

    /* ------------------------------------------------ 口令失败窗口（Issue #197）
       与上面那几个**不是一类**：上面几档记的是「要了多少次」，
       这里记的是「**错了多少次**」，而「成功一次」必须把它清空。

       为什么不能拿 `hits` 凑合：`hits` 是单调累加的（只增不减）。
       拿它当失败计数，症状是「错九次、对一次、再错一次 → 锁号」——
       而那个用户其实只错了一次。所以失败窗口**必须能清空**，
       于是它有自己的两张表（`fails` / `failWin`）。

       ⚠️ 内存实现 = 尽力而为（与上面同一条注释）：实例被回收，
         失败计数就归零。所以「连续失败 10 次锁号」在真库上还**不够硬**，
         真正兜底的是「匿名记名一个 lockedUntil」这件事以后要做的事。
         现在如实这么写，不假装它是分布式的。 */
    fail: function (bucket, key, t) {
      var k = bucket + "|" + key;
      fails[k] = (fails[k] || []).concat([t]);
      return fails[k].length;
    },
    fails: function (bucket, key, t) {
      var k = bucket + "|" + key;
      fails[k] = (fails[k] || []).filter(function (x) { return x > t - FAIL_WIN; });
      return fails[k].length;
    },
    clearFails: function (bucket, key) {
      delete fails[bucket + "|" + key];
      return true;
    },
    _fails: fails,
    _hits: hits
  };
}

/* --------------------------------------------------------- 账号读写 */

/** 落库的账号形状（**白名单**：多一个字段都不写，免得把不该存的存进去） */
function accountRow(identityValue, hash, mask, now) {
  return {
    uid: id.newUid(),
    /* ⚠️ Issue #197：明文邮箱**落库**（用户 2026-09-16 裁决「邮箱必须记录到数据库」）。
       它是**显示与认人**用的那一份，登录仍走 `email_hash`（那一列的输入做小写归一化）。
       归一化用的是 `normalizeEmailForStore()`（只 trim + 去零宽，**保留大小写**）——
       这样用户在个人中心看到的，就是他注册时真正填的那一串。 */
    email: id.normalizeEmailForStore(identityValue),
    email_hash: hash,
    email_mask: mask,
    /* 邮箱确认与否。`null` = 还没确认（**注册那一刻的常态**）。
       这条时间戳是「确认邮件真的点过」的唯一凭据，
       不许用 `created_at` 冒充 —— 那等于「注册即视为确认」，确认邮件就成了摆设。 */
    email_verified_at: null,
    /* 口令摘要串形如 `scrypt$N$r$p$salt$hash`（见 identity.hashPassword）。
       空串 = 「这个账号还没有口令」，可能是老账号，也可能是只走快捷码的人。 */
    password_hash: "",
    /* 口令盐单独留一列：`password_hash` 里其实已经带了盐，
       这一列是**上一版设计留下的形状**（那时摘要不带盐）。
       留着它并一起写，是为了「只读 password_salt 的那一天」不至于拿到空值 ——
       而验证一律以 `password_hash` 为准。 */
    password_salt: "",
    nickname: "",
    plan: "free",
    plan_until: null,
    role: "user",
    created_at: now,
    last_login_at: now,
    /* 邮件确认这一格里，账号的出厂状态是 **pending**：
       注册写下一行 pending，点了确认邮件才变 active。
       「没确认也能用」在这套设计里是真的（`publicAccount().emailVerified:false`），
       但 `status` 如实写着「还没确认」——两件事不矛盾，各说各的。 */
    status: "pending"
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
    /* Issue #197：**给「自己看自己」的那一份明文邮箱**。
       ⚠️ 它只出现在 `/api/me` 与登录/注册的响应里 —— 那两条都是「你自己」。
          别人的邮箱永远只以掩码出现（管理后台列账号是另一条接口，
          且那条接口本身有 owner / admin 的角色闸）。
       为什么必须下发：个人中心要说「你的邮箱是 xxx」，只说掩码的话
       用户没法确认自己当时填的是哪个（`a***@qq.com` 有几百种可能）。 */
    email: String(acc.email || ""),
    /* 邮箱确认与否：`null` 表示还没确认。界面据此显示「待确认 · 重发确认邮件」。 */
    emailVerifiedAt: acc.email_verified_at == null ? null : Number(acc.email_verified_at),
    emailVerified: acc.email_verified_at != null,
    /* ⚠️ **绝不下发** password_hash / password_salt。
       它们是「能不能登录」的凭据，泄出去等于把离线爆破的门打开。
       这一条不是「顺手不写」，而是「写了就是事故」。 */
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
 * 为什么要把这几件事下发到界面：docs §4.9 第 2 条那条「不假装」——
 * 说了「由服务器判定」，就得让用户看得见**这台服务器是什么状态**。
 * 各项全部取自既有的判定函数（`cfg.mail()` / `cfg.hasDb()`）与配置项本身，
 * 这里**不重算一份**（重算的下场见 config.mail() 那段注释：假绿且不报错）。
 *
 * ⚠️ 未登录时 `/api/me` 回 401，因此这几项**不会**给到未授权的人。
 */
function channelFacts(cfg) {
  var mail = typeof cfg.mail === "function" ? cfg.mail() : "console";
  var hasDb = typeof cfg.hasDb === "function" ? !!cfg.hasDb() : false;
  return {
    mail: mail,
    delivered: mail !== "console",                  // console 发的信真实用户收不到
    db: hasDb ? "db" : "memory",                    // memory = 重启即丢，如实标出来
    sms: !!(cfg.smsEnabled && cfg.smsTransport),    // 与 2B 的 503 同口径
    /* ------------------------------------------------------------------
       这台服务器拦不拦「邮箱没确认」这件事（Issue #197 后半段）
       ------------------------------------------------------------------
       与 `delivered` 同一条纪律：这是一句**关于服务器的事实**，不是一个
       给界面用的开关。界面据它决定说不说「确认之后才能登录」——
       而没有配好发信商的实例上，那句话是假话（信根本送不到），
       界面上必须改口成「这台服务器现在**没有**拦确认」。
       ⚠️ 它**不参与判权**，也不该被客户端拿去绕任何东西：
         真闸在服务端（`emailGate`），这里只是如实自报。
       ⚠️ 只有当「拦」和「能把信送出去」**同时成立**时，界面才可以说
         「去收件箱点确认」，否则那是一句用户照做也走不通的指引。
       ⚠️ 名字用 `emailGate` 而不是 `requireVerified`：闸门的判据在
          `emailGate()` 一处（`api/_lib/core.js`），这个字段只是它的镜像；
          叫 `requireVerified` 会让读的人以为「这里也是一个独立开关」。
       ------------------------------------------------------------------ */
    emailGate: !!requireVerified(cfg),
    /* ⚠️ `requireVerified` 是 `emailGate` 的**别名** —— 同一个值，
       取两个名字只有一个理由：合并时两边的调用点各叫各的
       （界面 `js/*.js` 读 `emailGate`；第廿六节那几条断言读
       `requireVerified`）。让它们**各自读到同一个源**，
       比把某一侧的调用点统统改一遍要稳 —— 改调用点的下场是「漏改一处」，
       而漏改的那一处会以 `undefined` 静默地当成「不拦」。
       ⚠️ 两个名字**永远不许**出现不同的值：它们的来源都只有
       `requireVerified(cfg)` 这一个函数（见上面那段）。 */
    requireVerified: !!requireVerified(cfg),
    emailDeliverable: mail !== "console",
    /* ------------------------------------------------------------------
       人机校验（Cloudflare Turnstile）当前**到底开没开**（Issue #197 后续）
       ------------------------------------------------------------------
       与 `mail: "console"` / `db: "memory"` 同一条纪律：这是一句
       **关于服务器的事实**，界面据它决定说不说「本站已开启人机校验」。

       ⚠️ 它**不参与判权**，也**不是**「客户端可以拿它来跳过校验」的开关：
         真闸在服务端（`humanGuard` → `turnstile.verify()`），这里只是如实自报。
       ⚠️ 名字用 `turnstile`，值是布尔 —— 不给 siteKey（那是另一个字段，
         而且它是否下发由页面自己决定，不从这里出）。
       ⚠️ 刻意**不下发原因**（「没配密钥」还是「旁路开着」）：旁路的存在
         不该出现在任何客户端可见的地方。运维看服务端日志。
       ------------------------------------------------------------------ */
    turnstile: turnstileReady(cfg),
    /* ---------------------------------------------------------------
       `rate: "instance"` —— **登录态的频控与猜错封禁只在本实例内有效**
       ---------------------------------------------------------------
       频控器是一张进程内的 Map（`makeRateLimiter`），它的两条硬约束：
         · 内存存储时**账号本身也活不过一次冷启动**（`db: "memory"`），
           频控跟着丢不是新增问题；
         · 但**配了数据库之后**账号能活下来，而频控仍然只在单实例里 ——
           Serverless 拉起多少个实例就有多少本账，
           「一小时 5 封」「连续 3 轮锁 24 小时」在多实例下都被放大成 N 倍。
       这不是「已经做好了限流」，是「尽力而为」；服务端**如实自报**它，
       免得界面把一句「次数有限」说得比事实更硬（§4.9 第 2 条：不假装）。
       要真正做到跨实例，必须把窗口搬到共享存储（Redis / 库表），
       那是另一件事 —— 在它落地之前，这个字段就得是这个值。
       --------------------------------------------------------------- */
    rate: "instance"
  };
}

/**
 * 人机校验**是否真的开着**（Issue #197 后续）—— 自报用的判据。
 *
 * ⚠️ 与 `api/_lib/turnstile.js` 的 `turnstileReady(cfg)` **同一个判据**
 *    （那边是权威实现，这边只是给 `channelFacts` 用的一句薄壳）：
 *    借它来判，而不是在这里把三个字段另写一遍 ——
 *    写第二遍的下场是「自报说开着、真校验却不校验」，且两边都不报错。
 * ⚠️ 读 `this`（与 `requireVerified` 同一条）：测试里的覆盖必须生效。
 */
function turnstileReady(cfg) {
  return turnstile.turnstileReady(cfg);
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
  /* ⚠️ export.all 原先在 max 那一档，**用户 2026-09-16 把它下到 pro**
     （Issue #159：「顶多支持学校课本部分的全部导出。这个 pro 用户就行」）——
     与 js/entitlement.js 的 CAPS 逐字一致（有对拍断言守着）。 */
  var pro = ["collections.many", "sync.multiDevice", "export.paper",
             "profile.family", "quiz.review", "export.all"];
  /* ⚠️ `collections.unlimited` 已**删除**（用户 2026-09-18，Issue #163：
     「自选清单不限 删除，已经被前面的自选清单代替」）——
     Max 的额度由 `collections.many` 的 `quotas.max = 5000` 表达，
     同一个东西不留两条能力（两条必然开始各说各的，客户端 CAPS 同步删除）。 */
  /* ⚠️ `exam.gathering` 是 2026-09-19（Issue #163）从 `exam.paper` 里**拆出来**的
     第二条能力：《古诗词大会》那个集子的访问权限。用户原话「是要拆成两个表格行，
     不是换行 这是两个功能」—— 一个格子的钩叉答不了两个问题。
     两条都归 Max（沿用户 2026-09-17「现场考试和飞花令归 max 所有」那一档）。*/
  var max = ["feihualing", "exam.gathering", "exam.paper"];
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
 * 摘要用的 pepper（**只有一处读**）。
 *
 * 为什么与「会话签名密钥」分开命名：它们是两件事 ——
 * pepper 决定「库里的 email_hash 能不能被彩虹表反查」，
 * 签名密钥决定「Cookie 能不能被伪造」。串在同一个变量上时，
 * 轮换其中一个就必须连带动另一个（而轮换 pepper 等于让全站账号失联）。
 * 取值顺序与 config.sessionKeyOf 一致，**同源不同名**，免得某天两边配置对不上。
 */
function pepperOf(cfg) {
  if (typeof cfg.sessionKeyOf === "function") return cfg.sessionKeyOf.call(cfg);
  return String(cfg.sessionSecret || cfg.sessionKey || "");
}

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
    ? id.phoneHash(identity.value, pepperOf(cfg))
    : id.emailHash(identity.value, pepperOf(cfg));
  var mask = ch === "sms" ? id.maskPhone(identity.value) : id.maskEmail(identity.value);
  return Promise.resolve(store.getAccountByHash(hash)).then(function (acc) {
    if (acc && acc.status !== "deleted") return { acc: acc, created: false };
    /* ⚠️ 落库的明文邮箱用**用户填的那一串**（`identity.raw`），不是归一化后的小写形态。
       `normIdentity()` 会把 `raw` 留下来 —— 因为「登录标识」必须大小写不敏感，
       而「显示出来的邮箱」必须是用户当时真正填的那个。
       这一处如果写成 `identity.value`，症状是「注册时填的 Parent@Example.com，
       登录后个人中心显示 parent@example.com」—— 用户会以为被改过。 */
    var row = accountRow(identity.raw != null ? identity.raw : identity.value, hash, mask, t);
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
    /* `raw` = 用户真正填的那一串（保留大小写）→ 落库的**明文邮箱**用它
       （`normalizeEmailForStore()` 只 trim + 去零宽）；
       `value` = 小写归一化的**登录标识** → 摘要用它。两者不许混（见 accountRow）。 */
    return { channel: ch, value: email, raw: id.normalizeEmailForStore(raw), mask: id.maskEmail(email), bucket: "email", key: email };
  }
  var phone = id.normalizePhone(raw);
  if (!id.isPhoneShape(phone)) return { bad: "E_PHONE_FORMAT", message: "这个手机号看起来不太对，再检查一下" };
  return { channel: ch, value: phone, raw: phone, mask: id.maskPhone(phone), bucket: "phone", key: phone };
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
 * 人机校验（Cloudflare Turnstile）—— 匿名可写那几条路口的**唯一一处闸**。
 *
 * ## 它挡的是哪些接口，为什么是这几条
 *
 * 挂闸的四条（`send-code` / `register` / `reset-request` /
 * `resend-verification`）有一条共同的形状：**不登录也能调、而且会产生副作用**
 * （发一封信、建一行账号、写一行令牌）。它们正是脚本刷子的目标 ——
 * 而频控只能把「刷多快」压住，压不住「有个真人点一下成本更低」这件事。
 *
 * **不挂闸**的几条：`login` / `verify-code` / `reset-confirm` / `verify-email`。
 * 理由不是「它们不重要」，而是**它们本来就有凭据**：
 *   · 口令 / 随机码 —— 猜中才能过，加人机校验只是多打扰真用户
 *   · reset-confirm / verify-email —— 用户是**点邮件里那条链接**进来的，
 *     那一步已经证明了邮箱可达；在这里弹一个 widget 会让
 *     「手机上点邮件、电脑上填新口令」这种正常动线变得莫名其妙
 * 「每条路都加」看起来更安全，实际是把防线摊薄在不需要它的地方 ——
 * 而真需要它的那四条，反而会被「到处都有」稀释掉注意力。
 *
 * ## 为什么判据只写一份（这一条是本函数存在的全部理由）
 *
 * 把 `turnstile.guard(cfg, ...)` 直接抄进四个函数的开头也能跑，
 * 但那样就有四处「要不要校验」的判断。将来改一处（比如加一个
 * 「登录态的人免校验」）就会出现「三条接口改了、第一条没改」——
 * 而**没改的那一条会静默地不校验**，谁也不报错。这正是本项目
 * 反复踩过的形状（`emailGate` 那段注释里写着同一个教训）。
 *
 * ## 顺序：**先人机校验、后频控**
 *
 * 两个都要，而且顺序是刻意的：被 Turnstile 挡掉的那一次**不占频控额度**。
 * 否则刷子可以用无效 token 把「一小时 5 封」那本账刷满，
 * 于是**真正的用户被挤掉**（一种不需要猜口令就能做的 DoS）。
 *
 * @param {object} deps
 * @param {object} input  请求体（读 `turnstileToken` / `cf-turnstile-response`）
 * @returns {Promise<null|{status,body}>}  null = 放行
 */
function humanGuard(deps, input) {
  var cfg = deps && deps.cfg ? deps.cfg : deps;
  input = input || {};
  /* 两种字段名都认：`cf-turnstile-response` 是 Cloudflare 自己往表单里写的
     那个名字（无 JS 的隐式渲染会用它），`turnstileToken` 是本站前端用的那个。
     只认一个的下场是「某一种渲染方式下 token 送不到」—— 而症状是
     「校验总是失败」，看着像密钥配错了。 */
  var token = input.turnstileToken != null ? input.turnstileToken : input["cf-turnstile-response"];
  return turnstile.guard(cfg, {
    token: token,
    ip: deps && deps.ip,
    fetch: cfg && cfg.turnstileFetch,   // 注入用（测试给假 fetch，不联网）
    now: deps && deps.now
  });
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

  /* ---- 人机校验（Turnstile，Issue #197 后续）----
     ⚠️ 它判在**频控之前**（见 humanGuard 里那段「顺序」的说明）：
        被挡掉的那一次不占频控额度 —— 否则刷子能用无效 token
        把「一小时 5 封」刷满，把真正的用户挤掉（一种不需要猜口令的 DoS）。
     ⚠️ 短信那条路也走它：短信要花钱，比邮箱更该有这一道。 */
  return humanGuard(deps, input).then(function (blocked) {
    if (blocked) return blocked;
    return sendCodeAfterGuard(deps, input, who, isSms, purpose, device, ip);
  });
}

/**
 * `sendCode` 在**过了人机校验之后**的那一段（Issue #197 后续：拆出来只为
 * 让 `humanGuard` 的 `then` 有一个落点，逻辑一个字节都没改）。
 *
 * ⚠️ 拆函数的代价是「多了一个只被调用一次的函数名」，所以这里写清为什么：
 *    人机校验是**异步**的（要往 Cloudflare 打一次 HTTP），而 `sendCode`
 *    原先是一路同步走到 `findOrCreateAccount` 的。把 `humanGuard` 的
 *    `then` 包在整段外面，比在每个 `return` 前面插一个 `await` 更不容易漏 ——
 *    漏掉任一个 `return` 就是「有一条早退路径不校验」，
 *    而那正是本项目踩过的那种形状（`emailGate` 的注释里写着同一个教训）。
 */
function sendCodeAfterGuard(deps, input, who, isSms, purpose, device, ip) {
  var cfg = deps.cfg, store = deps.store, limiter = deps.limiter, t = deps.now();

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

  /* ------------------------------------------------------------------
     顺序：**先冷却、后频控，而且两件都在同一个同步块里**
     ------------------------------------------------------------------
     这条顺序是实测顶出来的，写反过一次，症状是**第一封就发不出去**：
        · `take` 会当场把这一次记进窗口；
        · 而冷却判的是「上一条记录」——
      于是「先 take 后 cooldown」= 拿刚记下的这一条跟自己比，
      永远落在冷却里。`test/api.test.js` 那条「第一次发码回 202」会直接红。
     （同一个坑的另一半：`take` 与 `cooldown` 之间**不许有 await**，
       否则并发下两次请求都过 —— 见 makeRateLimiter().take 的注释。）

     顺序定下来之后，语义也正好是我们想要的：冷却管「两次之间至少隔多久」，
     频控管「这段窗口里一共要了几枚」。被冷却拒掉的那一次**不占频控额度**
     （先判先返回），所以「手抖连点两下」不会把当天的 10 枚额度白扣一枚。
     ------------------------------------------------------------------ */
  var cool = limiter.cooldown(coolBucket, coolKey, coolMs, t);
  if (!cool.ok) {
    return Promise.resolve(err(429, "E_RATE_EMAIL", "发得太快了，请稍后再试", { retryAfter: cool.retryAfter }));
  }

  for (var i = 0; i < buckets.length; i++) {
    /* ⚠️ `take` 不是 `check` —— 判完**当场落账**。原先写成
       「check 一圈 → 发信 → hit 一圈」，中间隔着收信商那次真实的 HTTP，
       于是并发打进来时每一条请求都在空窗口上通过（实测：连点两次重发，
       第二次也放行）。见 makeRateLimiter().take 的注释。 */
    var g = limiter.take(cfg, buckets[i][0], buckets[i][1], t);
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

  /* ⚠️ 明文码**只在这一条调用链里活着**（生成它的那一次函数调用内 + 用户的邮箱里）。
     下面 `closed` 这个名字是刻意的：**只有真送出去了，才允许它随响应回**。 */
  var rawCode = input.code || id.newCode(cfg.codeLength);
  var salt = id.newSalt();
  var echoAllowed = false;

  return findOrCreateAccount(store, cfg, who, t).then(function (r) {
    var acc = r.acc;
    /* ---- 锁定闸（§5.5 那条「锁 24 小时」的读端）----
       ⚠️ 原先这里判的是 `status === "locked"` 而**没有任何地方会把它写回去了** ——
          写进去就永久锁死，「锁 24 小时」变「锁一辈子」，而界面上写着「1 小时后再试」。
          现在锁定带 `locked_until`：
            · 还在锁里 → 423（如实说还剩多久）
            · 已过期   → **当场解锁**再放行，并把连错轮数的账清掉
              （不清的话下一次错一轮就又被锁，用户会觉得「说好 24 小时，怎么又锁了」） */
    if (acc.status === "locked") {
      var until = Number(acc.locked_until) || 0;
      if (until > t) {
        return err(423, "E_LOCKED", "为了安全，这个账号暂时不能收验证码",
          { retryAfter: Math.max(1, Math.ceil((until - t) / 1000)) });
      }
      acc.status = "active";
      acc.locked_until = null;
      /* 连错轮数的账**一并清掉**：不清的话用户等满 24 小时回来，
         错一枚码就又被锁一天（而界面上写的是「24 小时后再试」）。
         ⚠️ 这里清的是 `WRONG.uid` 那一张账（按 uid 计的轮数）；
         `WRONG.ip` 那张是**出口 IP** 的账，与本账号无关，**不许跟着清** ——
         清了等于让攻击者用「换个账号触发解锁」把 IP 计数洗白。 */
      limiter._hits[WRONG.uid + "|" + acc.uid] = [];
      store.putAccount(acc);
    }

    var codeId = id.newCodeId();
    var rec = {
      code_id: codeId,
      uid: acc.uid,
      purpose: purpose,
      channel: who.channel,
      sent_to: who.mask,              // ⚠️ 落库的也是掩码，不是明文
      code_hash: id.codeHash(acc.uid, purpose, rawCode, salt, pepperOf(cfg)),
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
        /* 频控的账**已经**在 take 那一步落好了（不是在这里）。
           原先这里还有一句 `buckets.forEach(hit)` —— 那正是
           「判在 A 处、记在 B 处」的形状：中间隔着网络往返，并发下形同不限。
           留这句注释是为了让下一个人别把它加回来。 */
        return sendVia(cfg, who, rawCode);
      })
      .then(function (sent) {
        echoAllowed = true;
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
        if (cfg.allowCodeEcho && echoAllowed) body.devCode = rawCode;
        return ok(body);
      })
      .catch(function (e) {
        // 发码失败：码已经落库了，但用户收不到 —— 如实回 502，不假装成功。
        // 短信那条路有它自己的错误码（E_SMS_FAIL），因为「短信没发出去」
        // 与「邮件没发出去」对用户的下一步动作不同。
        var isSmsFail = isSms;
        /* ⚠️ 这一条分支**绝不许回 `devCode`** —— 见上面 `echoAllowed` 的说明。
           它真的漏过一次：`catch` 里原样把「已生成的那条响应」回了出去，
           于是**冒烟开关一开，一条连不上发信商的实例（或者任何人拿一个会让
           `sendVia` 抛的输入）就能拿到明文码** —— 而这条路径恰恰是
           `ALLOW_CODE_ECHO` 唯一会被打开的那种环境（本地联调 / 冒烟）。
           现在 `echoAllowed` 只在 `sendVia` 真回来之后才置真，且这里再判一次。 */
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
 * 猜错计数：一轮错完就 +1；连着错够 `wrongRoundsLimit` 轮 → 该账号锁 24 小时。
 *
 * ## 为什么这一条必须存在（而且原先并不存在）
 *
 * docs/auth-design.md §5.5 白纸黑字写着「单账号连续 3 轮『发码后一次都没对』→
 * 锁 24 小时」，并且声称「已钉进测试」。**服务端从来没有实现它** ——
 * 实测（test/api.test.js 第二十一节）：一个坏客户端对同一个邮箱连着发码、
 * 每枚码错 5 次，可以**无限**进行下去，只受设备档（一小时 10 次）这条
 * 与安全无关的频控限制。而「每枚码 5 次」是**每枚码各自**的上限，
 * 换一枚码就重新从 5 次数起 —— 单账号在一天里能试的次数是
 * 「发码枚数 × 5」，不是 5。
 *
 * ## 一轮 = 发一枚码 → 一次都没对
 *
 * 与本地版 js/auth-core.js 的 `roundFailed` 同口径。本地版那条注释说得很清楚：
 * 按「次」计会同时踩两个坑 —— 真用户手抖三次被锁一天，而手改
 * localStorage 清掉计数又能立刻重来。判据从「次」改成「轮」之后，
 * 正常用户不受影响（一轮就是一枚码的整个生命周期），攻击者的成本也不会被
 * 「每枚码 5 次」放大成 5 倍机会。
 *
 * ## 幂等：同一个 uid 的同一轮只记一次
 *
 * 每次猜错都会走到这里，但**只有本轮第一枚码被消费**时才 +1 ——
 * 否则一枚码错 5 次就是 5 轮，正常用户手抖三次就被锁一天（正是上一条要避免的）。
 * 判据是「这一轮里有没有已经记过的轮次标记」。
 *
 * ⚠️ 键是 **uid**，不是邮箱字符串：换大小写、加别名都绕不过（§5.5 末句）。
 */
function bumpWrongRound(deps, uid, t) {
  var cfg = deps.cfg;
  limiterHit(deps, WRONG.uid, uid, t);
  var limit = Number(cfg.wrongRoundsLimit) || 3;
  if (wrongRounds(deps, uid) >= limit) {
    /* 够轮数：**锁**。锁写在账号那一行（`status = "locked"`），
       与 sendCode 里那条 `if (acc.status === "locked") → 423` 是同一个出口 ——
       「锁」这件事只有一处读、一处写。 */
    return Promise.resolve(deps.store.getAccount(uid)).then(function (acc) {
      if (!acc) return null;
      acc.status = "locked";
      acc.locked_until = t + (Number(cfg.lockMs) || 86400000);
      return deps.store.putAccount(acc);
    });
  }
  return null;
}

/**
 * 记一次（薄封装，只为让「记在哪一档」在调用处一眼看得见）。
 *
 * ⚠️ 键**必须带前缀**：`limiter.hit(bucket, key)` 内部拼的是 `bucket + "|" + key`，
 *    所以「`hit("uid", x)` 与 `hit("uid", x, …)`」这种把用户名当桶名的写法
 *    会在两张不同的账上各记一半 —— 而 `wrongRounds()` 只读其中一张，
 *    症状是**封禁永远不生效，却每次都回一句「还能再试 N 轮」**。
 *    计数一律走 `WRONG` 里那两个命名空间。
 */
function limiterHit(deps, ns, key, t) {
  deps.limiter.hit(ns, String(key), t);
}

/** 读某一档的计数（同上，键必须与写的那一处逐字一致） */
function limiterCount(deps, ns, key) {
  return (deps.limiter._hits[ns + "|" + String(key)] || []).length;
}

/**
 * 这个账号连着错了多少轮（**这一条就是 §5.5 那个判据的唯一读端**）。
 *
 * ⚠️ 幂等由**调用处**保证：只在「一枚码刚好被第 5 次错误作废」那一刻记一轮。
 *    不写成「同一秒内只记一次」那种时间窗判据 —— 攻击者只要把请求间隔拉到
 *    一秒以上，一轮就能刷成好几轮；反过来真用户手抖快了又会被漏记。
 *    语义判据（一枚码 = 最多一轮）不依赖时钟，两端也好对拍。
 */
function wrongRounds(deps, uid) {
  return limiterCount(deps, WRONG.uid, uid);
}

/** 这个出口 IP 猜错了多少次（挡住「换小号猜」那条路） */
function wrongByIp(deps, ip) {
  return limiterCount(deps, WRONG.ip, ip);
}

/** 这一轮要不要锁（判据与 bumpWrongRound 同源，不重算一份上限） */
function lockVerdict(deps, uid, t) {
  var cfg = deps.cfg;
  var limit = Number(cfg.wrongRoundsLimit) || 3;
  return wrongRounds(deps, uid) >= limit;
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
  var devKey = String(input.deviceId || "unknown");
  var ipKey = String(input.ip || "unknown");
  if (!codeId) return Promise.resolve(err(400, "E_NO_CODE", "请先获取验证码"));

  /* ------------------------------------------------------------------
     校验口的四层闸（与 sendCode 同一套 take 语义）：
       设备档 → IP 档 → 那枚码自己的 5 次 → 账号的连续失败轮数
     ------------------------------------------------------------------
     ⚠️ 原先这里**只有设备档，而且用的是 check 不是 take** —— 两条都错：
        · 用 check：这个函数里**没有任何一处调 hit**（原来那句 `limiter.hit`
          写在「猜错」分支里，最长的那条错误路径上），于是设备档的账
          只在猜错时才落，而一个手改客户端的人完全可以只猜对的次数……
          更直接的后果是：**任何一种被拒的走法都不落账**，
          包括「码长不对」这条连 store 都不碰的早退路径 —— 也就是
          「限制写在 A 处、读取在 B 处」，本项目反复踩的那一个。
        · 没有 IP 档：deviceId 由客户端自己给，每天换一个就绕过了设备档。
          出口 IP 是唯一一处客户端改不动的东西 —— 它必须进闸。
     ⚠️ `device` 这一档同时被 syncPull / syncPush / familyPut / adminGrant /
        accountDelete 复用（键前缀各不相同），所以这里也用前缀，
        免得「校验码太频繁」把「同步」也一起挡了（那是完全不同的两件事）。
     ------------------------------------------------------------------ */
  var deviceGate = limiter.take(cfg, "device", "verify:" + devKey, t);
  if (!deviceGate.ok) return Promise.resolve(err(429, "E_RATE_DEVICE", RATE_MSG.E_RATE_DEVICE, { retryAfter: deviceGate.retryAfter }));
  var ipGate = limiter.take(cfg, "ip", "verify:" + ipKey, t);
  if (!ipGate.ok) return Promise.resolve(err(429, "E_RATE_IP", RATE_MSG.E_RATE_IP, { retryAfter: ipGate.retryAfter }));
  /* 这个出口 IP 已经猜错了多少次 —— **独立一档**，不借 `rate.ip` 那张表。
     ⚠️ 借那张表的下场是「猜错」与「限流」共用一本账：一次正常的校验请求
        也会记进 ip 档，于是 IP 档的日上限（30）被正常用户自己吃满，
        而真正的猜错计数看起来还很宽松。两件事分开记，各自有各自的读数。 */
  if (wrongByIp(deps, ipKey) >= (Number(cfg.wrongRoundsLimit) || 3) * (Number(cfg.codeMaxAttempts) || 5)) {
    return Promise.resolve(err(429, "E_RATE_IP", "这个网络下猜验证码的次数太多了，稍后再试", { retryAfter: 3600 }));
  }

  /* 格式不对就地拒 —— **在落账之后**。这条早退路径原先一条账都不留，
     而它是「结构化猜」最省事的走法（一次请求一个 6 位串，零成本）。 */
  if (given.length !== cfg.codeLength) return Promise.resolve(err(400, "E_CODE_WRONG", "验证码不对，再检查一下"));

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

    var expect = id.codeHash(rec.uid, rec.purpose, given, rec.salt, pepperOf(cfg));
    var same = id.timingSafeEqual(expect, rec.code_hash);

    if (!same) {
      /* IP 档的猜错计数（挡住「每天换一个 deviceId、换一个邮箱」那条路）。
         它与 uid 那一档是两个不同的判据，所以两处都要记。 */
      limiterHit(deps, WRONG.ip, ipKey, t);
      var next = Number(rec.attempts) + 1;
      var patch = { attempts: next };
      // 超过上限即作废（与本地版同口径）
      if (next >= cfg.codeMaxAttempts) patch.consumed_at = t;
      var voided = next >= cfg.codeMaxAttempts;
      return Promise.resolve(store.patchCode ? store.patchCode(codeId, patch) : null)
        .then(function () {
          /* 这一轮错了 → 记一轮（**只在码被作废那一刻记**，见 bumpWrongRound）。
             够轮数就把账号锁上，并**当场**回 423 —— 不让攻击者再多试一枚码。 */
          if (!voided) {
            return err(400, "E_CODE_WRONG", "验证码不对，再检查一下", {
              remaining: Math.max(0, cfg.codeMaxAttempts - next)
            });
          }
          return Promise.resolve(bumpWrongRound(deps, rec.uid, t)).then(function () {
            if (lockVerdict(deps, rec.uid, t)) {
              return err(423, "E_LOCKED", "为了安全，请 24 小时后再试（也可以换一个网络或用别的邮箱）",
                { retryAfter: Math.round((Number(cfg.lockMs) || 86400000) / 1000) });
            }
            return err(400, "E_CODE_VOID", "这一枚验证码已作废，请重新发送", {
              round: wrongRounds(deps, rec.uid),
              limit: Number(cfg.wrongRoundsLimit) || 3
            });
          });
        });
    }

    // 通过：消费掉码，签发会话
    return Promise.resolve(store.patchCode ? store.patchCode(codeId, { consumed_at: t }) : null)
      .then(function () { return store.getAccount(rec.uid); })
      .then(function (acc) {
        if (!acc || acc.status === "deleted") return err(400, "E_CODE_VOID", "请用最新收到的验证码");
        /* ------------------------------------------------------------------
           码验对了，但邮箱没确认 → 同样不让进（与口令那条路同一处判据）
           ------------------------------------------------------------------
           ⚠️ 这一条**不是可选的补充**，它与口令那条是同一件事的两半：
              只堵口令那条路的话，「注册了不确认」的人换一个页签
              就能用随机码长驱直入 —— 那这道闸等于没做，而界面上
              还写着「确认后才能登录」。限制写在 A 处、绕过在 B 处，
              正是本项目反复踩过的那个形状。
           ⚠️ 顺序：**先把码消费掉再判闸**（上面那一句 patchCode 就是）。
              反过来的话，「没确认」的人每一次都能拿同一枚码再试（码没消费），
              而那一枚码会一直有效到过期 —— 于是「确认完再回来填那枚码」
              也变成一条路，界面上就会写出「刚才那枚码还能用」这种不该有的承诺。
           ⚠️ 这一处**不**顺手发确认邮件（同 emailGate 的说明）：码这条路
              每次被拦都发一封，就等于任何人拿一个已知的未确认邮箱
              反复刷登录即可给机主发垃圾邮件。
           ⚠️ 判据只有一处（`emailGate`），本文件里三条路各读它一次：
              口令登录 / 随机码登录 / 「等确认」那一屏的出路。
           ------------------------------------------------------------------ */
        var gate = emailGate(deps, acc);
        if (gate) return Promise.resolve(gate);
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

/* ==========================================================================
   完整登录流程（Issue #197）
   --------------------------------------------------------------------------
   用户在 Issue #197 里要的是**一套完整的流程**，而不是「一页里再加一块」：

     注册（邮箱 + 口令）→ 确认邮件 → 登录
                              ↓
                          忘记密码 → 重设口令
                              ↓
                          快捷登录（6 位随机码，即原有的无密码路径）

   这一节把其中「服务端这一半」全部落下来。四条口径先立在这里：

   ① **口令与随机码并存，不是替换**。随机码那条路一个字没改
      （`sendCode` / `verifyCode_` 保持原样），口令是**加出来的一条路**。
      理由是产品上的：家长群体记不住口令（`docs/auth-design.md` §3.1 写着
      「忘记密码是最高频的求助」），所以「不想记口令的人」必须还有得走。
      两条路签发的会话完全一样（同一个 `session.issue`）。

   ② **不确认邮箱就不让登录**（用户 2026-09-16 在 Issue #197 裁决，
      推翻了本节前一版「不确认也能用」的口径）。
      这一条只落在**账号那条路**上（注册 / 口令登录 / 快捷码登录），
      而且是三件事一起做的，缺一件就等于没做：
        · `emailGate()` —— 统一判据，登录那一侧**读**它
        · 注册时**立刻发第二封确认邮件** —— 因为「注册完不能登录」
          这条路上，那封信是用户唯一的出路，丢了就彻底卡住
        · 老账号（这条口径之前建的、没确认过的）在**注册路径**上补一封，
          并在前端一屏「去点确认」里给他一个「重新发一封」的键
      ⚠️ 它**不是**「拿功能当人质」：确认之前**一个字都不需要账号** ——
         /login/ 的「快捷登录 · 本地体验版」、全部背诵、全部进度照旧可用
        （`docs/auth-design.md` §1 第 2 条讲的是**现有功能**，不是注册）。
      ⚠️ 应急闸门 `cfg.requireEmailVerified`：没配好发信商的实例上由运维
        显式关掉（默认开）。关掉时界面**如实说明这台服务器没拦确认** —— 
         不许让用户以为「没确认就进不来」。
      确认与否落成 `status='pending'|'active'` 与时间戳两处，界面读 `emailVerified`。

   ③ **明文口令一秒钟都不落任何地方**。库里只有
      `scrypt$N$r$p$salt$hash`（见 `identity.hashPassword`）。
      日志、响应体、错误信息里都不出现口令 —— 与「明文码不进日志」同一条纪律。

   ④ **忘记口令不暴露「这个邮箱注册过没有」**。`resetRequest` 无论邮箱
      存在与否都回**同一个响应**（与发码那条第 4 条 checklist 逐条对齐）。
      这一条是最容易被「为了体验」破掉的：一句「这个邮箱没注册过」
      等于把全站用户名单变成可查询的事实。
   ========================================================================== */

/** 口令形状校验。返回 null 表示通过，否则是 `{code,message}` */
function checkPassword(cfg, pw) {
  var p = String(pw == null ? "" : pw);
  if (!p) return { code: "E_PW_EMPTY", message: "请先填密码" };
  /* ⚠️ 最短长度按**码点**数，不按 UTF-16 长度 —— 一个汉字在 JS 里是 1 个
     长度单位，但一个 emoji 是 2 个。用 `.length` 判的下场是
     「四个 emoji 也算 8 位」。 */
  var n = Array.from ? Array.from(p).length : p.length;
  if (n < (cfg.passwordMin || 8)) {
    return { code: "E_PW_SHORT", message: "密码至少 " + (cfg.passwordMin || 8) + " 位" };
  }
  /* 上限不是「防用户填太长」，是**防 DoS**：scrypt 对超长输入一样要算，
     而 1MB 的口令会让每一次登录烧掉几十毫秒 CPU。与 bcrypt 的 72 字节同理。 */
  if (p.length > (cfg.passwordMax || 72)) {
    return { code: "E_PW_LONG", message: "密码太长了（最多 " + (cfg.passwordMax || 72) + " 个字符）" };
  }
  return null;
}

/**
 * 应急闸门 `REQUIRE_EMAIL_VERIFIED` 的读处 —— **只在这里读一次**。
 *
 * 返回 `true` = 拦（默认）。
 *
 * ⚠️ 读 `this`（与 `cfg.mail()` / `cfg.hasSession()` 同一条纪律）：
 *    测试里 `Object.assign({}, CONFIG, {...})` 这类覆盖必须生效。
 * ⚠️ 判据是 `!== false` 而不是 `=== true`：漏配一项时**拦**是安全的那一侧；
 *    要关掉它必须显式写 `0` / `false`，不打折扣。
 */
function requireVerified(cfg) {
  if (!cfg) return true;
  return cfg.requireEmailVerified !== false;
}

/**
 * 邮箱确认闸（Issue #197）—— **「不确认就不让登录」这条口径的唯一判定点**。
 *
 * 返回 `null` 表示放行，否则是一个已经成形的 403 响应。
 *
 * ## 它为什么必须存在，而且必须只写一处
 *
 * 上一轮（PR #199）把「不确认也能用」定成了口径，并把「不确认就不让登录」
 * 留成一个待用户裁决的选项。用户裁了：**不确认就不让登录**。
 * 但那一次的落地**没有进这个仓库** —— 于是形如：
 *   · 注册完（`status:'pending'`）走随机码路可拿完整会话；
 *   · 走口令路同样可拿；（见 test/api.test.js 第廿六节 ①）
 * 也就是说「邮箱确认」这件事在服务端**一处都没生效过**：
 * 随机码那条路是更早的 1A 就有的、签会话时压根不看账号状态。
 *
 * 这条闸在**口令登录**与**快捷码登录**两条路上生效（两者各读它一次）。
 * 两处各写一遍 `if (!acc.email_verified_at) …` 的下场是「其中一处忘了加」——
 * 而漏掉的那一处恰好就是唯一能被直接打的那个接口（手改客户端即可）。
 * 所以判据、错误码、文案、附带字段全部只在这里写一份。
 *
 * ## 判据为什么落在「口令/码校验之后」
 *
 * 落在**之前**，回话就会区分「这个邮箱注册过但没确认」与「这个邮箱压根不存在」——
 * 那就成了「谁是本站用户」的查询口（本文件里三条反枚举纪律同源）。
 * 落在之后，攻击者得先猜中口令/码才撞得到这道闸，而那时他本来就已经是账号主人。
 *
 * ## 为什么回 403 而不是 401 / 423
 *
 * 401 会被客户端读成「没会话，静默降级」（`js/auth-api.js` 的那条分支）；
 * 423 是「等一会儿再来试」——而这里要做的是**去收件箱**，不是重试登录。
 * 403 + 一个专属码 `E_EMAIL_UNVERIFIED`，界面据此给出一条**出路**（重发确认邮件）。
 *
 * ## 应急闸门 `REQUIRE_EMAIL_VERIFIED`
 *
 * 默认**拦**（`1`）。留 `0` 只有一个理由，且必须写清楚：
 * **发信商没配（console 通道）时，确认邮件送不到真人的收件箱。**
 * 在那台实例上开着这道闸，等于谁也别想注册。所以判据是
 * 「拦，且**只在那台实例发信通不了时才允许关**」—— 关掉时界面必须看得出来
 * （`/api/me` 的 `channel.emailGate` 与注册响应的 `requiresVerification` 都自报），
 * 不然用户会以为「没确认就进不来」而实际上进得来。
 *
 * ## ⚠️ 老账号不倒扣（这一条是从上一版 `verifyGate` 学来的，别删）
 *
 * `status === 'pending'` 才是「流程内如实标着『待确认』」的那一档。
 * Issue #197 之前建的账号没有 `email_verified_at`，但它们**曾经是能用的**：
 * 把它们一并拦下，等于在旧实例上升级一次就锁死全部老用户 ——
 * 而他们连「重发确认邮件」那颗键都找不到（那颗键要登录）。
 * 所以：
 *   · `status === 'pending'` 且没确认 → 拦
 *   · 其余（老行没有这个状态、或 active）→ 放行，但**不假装已确认**
 *     （`publicAccount().emailVerified` 仍如实为 false）
 * 这条不是「网开一面」，是「不把口径变更倒扣到已经存在的账号上」。
 *
 * ## ⚠️ 注册那条路**不读它**
 *
 * 注册要的恰恰是「还没确认的人也走得通」：它的下一步是发一封确认邮件
 * （`core.register`），不是把人挡回去。把闸也加到注册上，就成了一条死循环：
 * 没确认 → 不让注册 → 发不出信 → 永远确认不了。
 * 其余需要登录的接口（`/api/me` / 同步 / 注销 / 重发确认）**也不读它**：
 * 那些接口的会话是登录那一刻签出来的，而登录那一刻已经过闸 ——
 * 在每一处再查一遍不会更安全，只会让「改主邮箱」这类将来的动作
 * 多出一堆要同步修改的地方。
 *
 * ⚠️ 它**不顺手重发确认邮件**：判据里发信 = 每一次失败的登录都烧一封邮件，
 *    而「重发」必须是用户自己的动作（那颗键在界面上）。
 *    也绝不因为「发不出去」就放行 —— 那是拿安全换顺畅。
 */
function emailGate(deps, acc) {
  var cfg = deps && deps.cfg ? deps.cfg : deps;
  if (!requireVerified(cfg)) return null;
  if (acc && acc.email_verified_at != null) return null;
  /* 老账号（`status` 不是 `pending`）放行 —— 见上面那段「老账号不倒扣」。 */
  if (!(acc && acc.status === "pending")) return null;
  return err(403, "E_EMAIL_UNVERIFIED",
    "邮箱还没确认：请点开注册时那封确认邮件里的链接。没收到就点「重新发一封」。",
    {
      /* ⚠️ 掩码**不是**明文邮箱：它给界面回显「发往哪儿」，而明文只在
         `/api/me`（「你自己」那两条）里出现。 */
      emailMask: (acc && acc.email_mask) || "***",
      /* ------------------------------------------------------------------
         `verifySent` / `verifyTransport` 在这里**恒为 false / null**
         ------------------------------------------------------------------
         为什么不干脆不带这两个字段：界面那两处（登录页「等确认」那一屏、
         `js/auth-api.js` 的错误对象）是**同一条渲染**，它按
         `verifySent === true` / `=== false` / 缺省 三档说三句话
         （真发了 / 没发 / 不知道）。缺字段会让「不知道」那一档
         与「确实没发」混成同一个样子 —— 而两者该说的话不一样。
         为什么恒为 false：**这条路上刻意不发信**（见上面那段说明）。
         真正会临时为 true 的地方是**注册**那条路（`core.register` 里
         `verifySent: v.sent` 来自 `issueVerification` 的实测结果）。
         ⚠️ 留成常量是**故意的**：这个字段表示「**刚刚**有没有发」，
            不是「曾经发过没有」。一个「曾经发过」的字段到了界面上
            会变成一句错的现在时（「已经发往…」），而信可能早就过期了。
         ------------------------------------------------------------------ */
      verifySent: false,
      verifyTransport: null
    });
}

/** 一次性令牌的形状校验：64 位 hex。形状不对**不进库**（省一次查询，也少一条脏数据） */
function isTokenShape(t) {
  return /^[0-9a-f]{64}$/.test(String(t || ""));
}

/**
 * 按**明文**邮箱那一列查账号。
 *
 * ⚠️ 这是一次 `listAccounts()` 全表扫描 —— 只给**不需要按摘要命中**的少数
 *    几处用（匿名重发确认邮件、管理路径）。登录/注册那种「按摘要查一行」的
 *    路径走 `store.getAccountByHash`，不要用这一条。
 * ⚠️ 这一条**必须与摘要那条路给出同一个答案**：明文列是老行补上的，
 *    所以这里没有「按 hash 兜底」的第二段 —— 老行（没有明文列）本来就
 *    不该走匿名重发口（那封信当年也没发过）。
 */
function findAccountByEmail(store, email) {
  var want = id.normalizeEmailForStore(email);
  return Promise.resolve(store.listAccounts()).then(function (rows) {
    var hit = null;
    (rows || []).forEach(function (a) {
      if (hit || !a || a.status === "deleted") return;
      if (String(a.email || "") === want) hit = a;
    });
    return hit;
  });
}

/**
 * 注册（`POST /api/register`）。
 *
 * 与发码那条路的形状**刻意不同**：注册要**立刻建号**（不是「收到码才建」），
 * 因为用户在这一步填了口令 —— 没有账号就没地方放那个摘要。
 * 于是产生一个必须说清的中间态：**已建号、邮箱待确认**。
 */
function register(deps, input) {
  var cfg = deps.cfg;
  /* ---- 人机校验：**匿名可写、会建号、会发信**的那条口子（见 humanGuard） ---- */
  return humanGuard(deps, input).then(function (blocked) {
    if (blocked) return blocked;
    return registerAfterGuard(deps, input);
  });
}

/** `register` 过了人机校验之后的那一段（逻辑一字未改，只为给 then 一个落点） */
function registerAfterGuard(deps, input) {
  var cfg = deps.cfg, store = deps.store, limiter = deps.limiter, t = deps.now();
  var email = id.normalizeEmailForStore(input.email != null ? input.email : input.value);
  if (!id.isEmailShape(email)) {
    return Promise.resolve(err(400, "E_EMAIL_FORMAT", "这个邮箱看起来不太对，再检查一下"));
  }
  var bad = checkPassword(cfg, input.password);
  if (bad) return Promise.resolve(err(400, bad.code, bad.message));

  var device = String(input.deviceId || "unknown");
  var ip = String(input.ip || "unknown");
  /* ⚠️ 三层闸，**原子 take**（判完当场落账）：
       设备（客户端给的，换一个就绕过）→ **出口 IP**（唯一改不动的那一个）→ 全局。
     原先只有 device 一档，而且是 `check`（不落账）—— 于是并发下全过，
     而「每天换一个 deviceId」的坏客户端等于**不限速**。
     注册口是匿名可写的（它会建号、会发信），必须按 IP 兜住。 */
  var rBuckets = [[cfg.rate.device ? "device" : "global", "reg:" + device], ["ip", "reg:" + ip]];
  for (var ri = 0; ri < rBuckets.length; ri++) {
    var rg = limiter.take(cfg, rBuckets[ri][0], rBuckets[ri][1], t);
    if (!rg.ok) {
      var rcode = rateCode(rBuckets[ri][0]);
      return Promise.resolve(err(429, rcode, RATE_MSG[rcode] || "稍后再试", { retryAfter: rg.retryAfter }));
    }
  }

  return findOrCreateAccount(store, cfg, { channel: "email", value: email }, t).then(function (r) {
    var acc = r.acc;
    if (acc.status === "locked") return err(423, "E_LOCKED", "为了安全，请稍后再试", { retryAfter: 3600 });

    /* ==================================================================
       ⚠️⚠️ **已有口令的账号不许被「再注册」改掉口令**（Issue #197 复审）
       ==================================================================
       原先这里无条件把 `password_hash` 覆盖成这次请求填的那个，理由写的是
       「老账号（发码那条路建的）没有口令，要给它补上」。那个理由**只对
       没有口令的账号成立** —— 而对已经有口令的账号，这一行就是一个
       **账号接管洞**：

         register("victim@example.com", "attacker-pw")   ← 攻击者只填邮箱
           → 库里那个账号的 password_hash 被换成攻击者的
           → 攻击者用自己的口令登录成功，拿到受害者账号的会话与全部进度

       实测现场（第廿六节 ③）：注册两次，第二次换了口令之后，
       **新口令能登、原主人口令登不进去**。整个洞不需要任何凭据。
       所以判据改成两条：
         · **没有口令的账号**（老行 / 只走随机码的人）→ 补口令（原样保留，
           它是「发码那条路建的账号」的迁移路径，不回「已注册」免得邮箱枚举）
         · **已经有口令的账号** → **一个字都不写**，回同一个响应形状
           （`created:false`），但**绝不覆盖口令、也绝不重发确认邮件**
           （否则任何人都能用它给机主刷确认邮件 —— 那是另一条滥用）。
       ================================================================== */
    if (!r.created && acc.password_hash) {
      return ok({
        uid: acc.uid,
        registerRequested: true,
        created: false,
        /* ⚠️ 关键：**没有** verifySent / devVerifyToken —— 因为真的什么都没发。
           回一个 `verifySent:false` 会引导界面写「没能发出去」，而这里
           是「本来就不该发」（这个邮箱已经有主了）。两件事在界面上
           必须长得不一样，所以这里连字段都不给。 */
        existing: true,
        store: store.kind,
        note: "如果这个邮箱已经注册过，请直接用「密码登录」；忘了密码就用「忘记密码」重设。"
      });
    }

    var salt = id.newPasswordSalt();
    acc.email = email;                              // 明文回填（老行可能没有）
    acc.password_hash = id.hashPassword(String(input.password), salt);
    acc.password_salt = salt;
    if (acc.status === "pending" || acc.status === "active") {
      // 已有确认状态的**不动**：已经确认过的人重新注册，不该被退回未确认
    } else {
      acc.status = "pending";
    }
    return Promise.resolve(store.putAccount(acc)).then(function (saved) {
      var cur = saved || acc;
      /* ------------------------------------------------------------------
         要不要在这儿再发一封确认邮件
         ------------------------------------------------------------------
         口径（Issue #197 后半段）：**只要邮箱还没确认，注册这条路就发信**，
         不管这是全新注册还是老账号重新注册。

         为什么这一条不能省：确认邮件是「没确认就不让登录」这条路上用户
         **唯一的出路**。少发一封的下场是——用户在注册页填完邮箱与口令，
         看到「账号已建好」，然后发现自己**既登不进去、又没有任何办法
         让那封信再来**（重发确认邮件那颗键在个人中心里，而个人中心要登录）。
         那就是一个死结，而且是用户自己造不出来的死结。

         已经确认过的人**不再发**：他不是走不通，是回来重新注册而已
         （保留旧口令 + 保留确认状态，见上面那一段）。
         少发一封也顺手省掉一封垃圾邮件，并且让 `verifySent` 这个字段
         仍然说真话（「这一封是新发的」而不是「顺手又发了一封」）。
         ------------------------------------------------------------------ */
      if (cur.email_verified_at != null) {
        var masked = cur.email_mask || id.maskEmail(email);
        return ok({
          uid: cur.uid,
          registerRequested: true,
          created: r.created,
          store: store.kind,
          emailVerified: true,
          emailMask: masked,
          verifySent: false,
          verifyTransport: null,
          note: "邮箱已经在确认过了 —— 这次只更新了密码，确认状态保持不变。"
        });
      }
      return issueVerification(deps, cur).then(function (v) {
        return ok({
          uid: cur.uid,
          registerRequested: true,
          created: r.created,
          store: store.kind,
          /* ⚠️ 这两个字段是**给界面说实话用的**，不是给用户看的：
             `verifySent` 为 false（console 发信商）时界面必须写
             「本次没能把确认邮件发出去」，绝不写「确认邮件已发出」。 */
          verifySent: v.sent,
          verifyTransport: v.transport,
          /* ⚠️ 试了几次、为什么没成 —— 这是「重试机制」在界面上唯一看得见的部分。
             不带它的话用户只有「没能发出」一句，不知道该等一下还是该找运维。 */
          verifyAttempts: v.attempts || 1,
          verifyReason: v.reason || null,
          /* ⚠️ 确认之前**登不进去**（默认口径），所以界面必须把话说全：
             下一步是去收件箱点链接，不是回登录页。 */
          emailVerified: false,
          emailMask: cur.email_mask || id.maskEmail(email),
          /* 服务端把「这台实例拦不拦未确认邮箱」**如实自报** ——
             运维为了应急关掉闸门（REQUIRE_EMAIL_VERIFIED=0）时，
             界面必须看得出来，否则用户会以为「没确认就进不来」。
             ⚠️ 与 `/api/me` 的 `channel.emailGate` **同一处来源**（`emailGate()`），
                不重算一份：两处各写一遍的下场是某天只改了一处。 */
          requiresVerification: !!requireVerified(cfg),
          /* 冒烟自测口子：与发码的 devCode 同一条纪律 ——
             只有显式开 ALLOW_CODE_ECHO 才回明文令牌，默认关。 */
          devVerifyToken: cfg.allowCodeEcho ? v.token : undefined,
          note: cfg.requireEmailVerified
            ? "邮箱只在你自己主动填时收集；已在库中记下。**邮箱确认之后才能登录**，请去收件箱点那条链接。"
            : "邮箱只在你自己主动填时收集；已在库中记下，供你确认与找回密码。"
        });
      }).then(function (out) {
        // 发信失败不该让「注册」这件事整体失败：账号已经建好了，
        // 用户重发一次即可。如实标出 verifySent:false，界面照实说。
        return out;
      });
    });
  });
}

/**
 * 发一封确认邮件（注册时、以及用户点「重发确认邮件」时都走它）。
 *
 * ⚠️ 返回值里的 `sent` / `transport` 是**事实**：console 发信商下 `sent` 为
 *    false，界面据此写「没能发出」而不是「已发出」（§12 总原则）。
 */
function issueVerification(deps, acc) {
  var cfg = deps.cfg, store = deps.store, t = deps.now();
  var token = id.newToken();
  var salt = id.newSalt();
  var vid = id.newVerifyId();
  var rec = {
    vid: vid,
    uid: acc.uid,
    email_hash: id.emailHash(acc.email || acc.email_mask, cfg.sessionSecret || "no-pepper"),
    token_hash: id.tokenHash(acc.uid, "verify", token, cfg.sessionSecret || "no-pepper"),
    salt: salt,
    issued_at: t,
    expires_at: t + (cfg.verifyTtlMs || 86400000),
    consumed_at: null,
    attempts: 0
  };
  /* 同 uid 同时只留最新一条：发新的即作废旧链接。
     不这么做的下场是「用户把三封确认邮件都点一遍，三次都算数」——
     而每一次都要动 `email_verified_at`，等于多出三个可重放的凭据。 */
  return Promise.resolve(store.voidVerifications(acc.uid, t))
    .then(function () { return store.putVerification(rec); })
    .then(function () {
      /* ⚠️ `vid` 必须一起传 —— 邮件里那条链接是 `/verify/?vid=..&token=..`。
       漏掉 vid 的下场是「链接点开永远说不对」，而包里那个 token 明明是好的：
       这一处最容易在「只测了内核、没点过真链接」时溜过去。 */
      return mail.confirm(cfg, { to: acc.email, mask: acc.email_mask, vid: vid, token: token, ttlMs: cfg.verifyTtlMs });
    })
    .then(function (sent) {
      /* ⚠️ `attempts` / `reason` 是**事实**（试了几次、为什么没成），
         界面据此如实说「试了 3 次都没发出去」。不带上它们的话，
         用户只会看到一句「没能发出」，而无法判断该等一会儿还是该找运维。 */
      return {
        vid: vid, token: token,
        sent: !!sent.delivered,
        transport: sent.transport,
        attempts: Number(sent.attempts) || 1,
        reason: sent.reason || null
      };
    })
    .catch(function (e) {
      /* 发信失败**不抛**：账号已经建好了。把事实（没发出去）回给界面，
         而不是把整个注册回滚 —— 回滚等于「发信商抽风一次，用户就注册不上」。
         ⚠️ `withRetry` 在**放弃重试之后**会把这个异常抛出来（见那边的注释），
            并把 `attempts` / `reason` 挂在它身上 —— 这里如实带上，
            界面才能说「试了 3 次都没发出去」而不是含糊的一句「没能发出」。 */
      return {
        vid: vid, token: token, sent: false, transport: "failed",
        attempts: Number(e && e.attempts) || 1,
        reason: (e && e.reason) || "unknown"
      };
    });
}

/**
 * 确认邮箱（`POST /api/verify-email`）。
 *
 * 令牌是**长随机数**（32 字节），所以「猜」不是威胁模型；
 * 威胁模型是**重放**与**过期**，两条各有一个判据（consumed_at / expires_at）。
 */
function verifyEmail(deps, input) {
  var store = deps.store, cfg = deps.cfg, t = deps.now();
  var vhash = String(input.token || "");
  var vid = String(input.vid || "");
  if (!vid && !vhash) return Promise.resolve(err(400, "E_NO_TOKEN", "确认链接不完整，请重新发一封确认邮件"));

  function act(rec) {
    if (!rec) return err(400, "E_TOKEN_INVALID", "这个确认链接不对，请重新发一封确认邮件");
    if (rec.consumed_at) return err(400, "E_TOKEN_USED", "这个确认链接已经用过了");
    if (t < Number(rec.issued_at) - 120000) return err(400, "E_TOKEN_INVALID", "这个确认链接不对，请重新发一封确认邮件");
    if (Number(rec.expires_at) <= t) return err(400, "E_TOKEN_EXPIRED", "确认链接已过期，请重新发一封确认邮件");
    if (!input.token) {
      /* 只有 vid 没有明文令牌：这是**邮件里那条链接被服务端自己打开**的情形
         （点开链接的是用户的浏览器，令牌确实在 URL 里，所以正常路径总能拿到它）。
         拿不到就如实回绝，不「凭 vid 放行」—— 那等于确认这件事不需要凭据。 */
      return err(400, "E_TOKEN_INVALID", "这个确认链接不对，请重新发一封确认邮件");
    }
    var expect = id.tokenHash(rec.uid, "verify", String(input.token), cfg.sessionSecret || "no-pepper");
    if (!id.timingSafeEqual(expect, rec.token_hash)) {
      var next = Number(rec.attempts || 0) + 1;
      return Promise.resolve(store.patchVerification ? store.patchVerification(rec.vid, { attempts: next }) : null)
        .then(function () { return err(400, "E_TOKEN_INVALID", "这个确认链接不对，请重新发一封确认邮件"); });
    }
    return Promise.resolve(store.patchVerification ? store.patchVerification(rec.vid, { consumed_at: t }) : null)
      .then(function () { return store.getAccount(rec.uid); })
      .then(function (acc) {
        if (!acc || acc.status === "deleted") return err(400, "E_TOKEN_INVALID", "这个确认链接不对，请重新发一封确认邮件");
        acc.email_verified_at = t;
        /* ⚠️ 只把 `pending` 提成 `active`**这一个方向**。
           `suspended` / `locked` 是别的原因，确认邮箱不该把它们解开 ——
           顺手解开的后果是「封掉的账号点一下邮件就复活了」。 */
        if (acc.status === "pending") acc.status = "active";
        return Promise.resolve(store.putAccount(acc)).then(function (saved) {
          return ok({
            verified: true,
            email: String((saved || acc).email || ""),
            emailMask: (saved || acc).email_mask || "***",
            note: "邮箱已确认。现在可以用它找回密码了。"
          });
        });
      });
  }

  if (vid) return Promise.resolve(store.getVerification(vid)).then(act);

  /* ------------------------------------------------------------------
     只给了令牌、没给 vid —— **如实拒绝**
     ------------------------------------------------------------------
     原先这里有一段「按令牌找记录」的代码：把全表拉出来、
     挑**第一条还没消费的**记录、拿它去过 act()。那一段是错的，而且错得危险：

       · 令牌摘要里带 uid（`tokenHash(uid, purpose, token)`），而这里
         挑出来的记录是**任意一条**。于是「拿的是别人的记录、比的是自己的令牌」
         —— 真实的链接永远比对不上，**合法的确认链接会被判成无效**。
       · 它把 `/verify/` 那条链接里的 `vid` 变成了「可有可无」。而邮件里
         那条链接是**我们自己拼的**（`mail.link()` 两个参数都带），
         缺 vid 只可能来自「用户手工拷贝时漏了一段」或「有人在乱试」。
       · 更要紧的是：它是一次**全表扫描**，而入口是匿名的 ——
         每个请求都能让别人付出一次 listAll 的代价。

     所以现在这两条都走 `E_NO_TOKEN`：**不猜、不扫表、不替调用方补参数**。
     判据与 `resetConfirm` 里那条 `if (!rid) → E_NO_TOKEN` 逐字同源。
     ------------------------------------------------------------------ */
  return Promise.resolve(err(400, "E_NO_TOKEN", "确认链接不完整，请重新发一封确认邮件"));
}

/**
 * 口令登录（`POST /api/login`）。
 *
 * ## 为什么失败计数落在**账号**上而不是设备/IP 上
 * 「撞库」打的是**同一个账号**（一份泄露的口令表逐个试）。按 IP 计数拦不住
 * 分布式尝试，按账号计数才拦得住。于是这里用 `accounts.status='locked'`
 * 与一个独立的失败窗口（`rateWindow(cfg,"login")`）两条一起：
 * 前者是**终态**（等时间），后者是**退避**（等一会儿）。
 *
 * ## 为什么「口令错」与「账号不存在」回同一个响应
 * 与 `resetRequest` 同一条：区分开就等于邮箱枚举。
 * 所以这里先算一次 scrypt（对不存在的账号也一样算），
 * 让**耗时**也不透露账号是否存在（防的是计时侧信道）。
 */
function loginWithPassword(deps, input) {
  var cfg = deps.cfg, store = deps.store, limiter = deps.limiter, t = deps.now();
  var email = id.normalizeEmailForStore(input.email != null ? input.email : input.value);
  var pw = String(input.password == null ? "" : input.password);
  var device = String(input.deviceId || "unknown");
  var GREY = { code: "E_LOGIN_FAIL", message: "邮箱或密码不对" };

  if (!id.isEmailShape(email) || !pw) return Promise.resolve(err(400, "E_LOGIN_FAIL", GREY.message));

  /* ⚠️ 原子 take + **退避档用 `login`**：撞库要在**账号**上计数（那是终态），
     但设备/IP 这一层是「退避」—— 两者都要有。原先这里是 `check("device")`
     之后再找地方 `hit`，中间隔着一次 scrypt（约 40ms），并发下全是空窗口。 */
  var loginIp = String(input.ip || "unknown");
  var lgBuckets = [["device", "login:" + device], ["ip", "login:" + loginIp]];
  for (var li = 0; li < lgBuckets.length; li++) {
    var lgate = limiter.take(cfg, lgBuckets[li][0], lgBuckets[li][1], t);
    if (!lgate.ok) {
      var lcode = rateCode(lgBuckets[li][0]);
      return Promise.resolve(err(429, lcode, RATE_MSG[lcode] || "稍后再试", { retryAfter: lgate.retryAfter }));
    }
  }

  return Promise.resolve(store.getAccountByHash(id.emailHash(email, cfg.sessionSecret || "no-pepper")))
    .then(function (acc) {
      if (!acc) {
        /* 账号不存在也**照算一次 scrypt** —— 不然这里会快上两个数量级，
           「这个邮箱注册过没有」就成了一件可以测出来的事。
           算式里的盐用一个固定的常量（不用随机）：随机会让这一条也
           变成一个可以测的差异，而固定的常量每次耗时一致。 */
        id.verifyPassword(pw, id.hashPassword("not-a-real-password", "0000000000000000", { N: 16384, r: 8, p: 1, len: 32 })
          .replace(/\$[0-9a-f]{32}\$/, "$00000000000000000000000000000000$"));
        return err(401, GREY.code, GREY.message);
      }
      if (acc.status === "locked") return err(423, "E_LOCKED", "为了安全，请稍后再试", { retryAfter: 3600 });
      if (acc.status === "deleted") return err(401, GREY.code, GREY.message);

      var okPw = !!acc.password_hash && id.verifyPassword(pw, acc.password_hash);
      if (!okPw) {
        /* 连续失败锁号：窗内 10 次即锁。与发码那条「整轮失败锁 24 小时」
           同一形状 —— 判的是**连续失败**，成功一次就把窗口清空（见下）。 */
        var fails = (limiter.fails ? limiter.fails("login", "uid:" + acc.uid, t) : 0) + 1;
        if (limiter.fail) limiter.fail("login", "uid:" + acc.uid, t);
        if (fails >= 10) {
          acc.status = "locked";
          return Promise.resolve(store.putAccount(acc)).then(function () {
            return err(423, "E_LOCKED", "密码连续输错太多次，1 小时后再试", { retryAfter: 3600 });
          });
        }
        return err(401, GREY.code, GREY.message, { remaining: Math.max(0, 10 - fails) });
      }

      /* ------------------------------------------------------------------
         口令对了，但邮箱没确认 → **仍然不让进**（Issue #197 后半段）
         ------------------------------------------------------------------
         ⚠️ 闸必须在**口令校验之后**判，这一处顺序是有讲究的：
             · 判在前面（拿到账号就判）——「这个邮箱注册过但没确认」
               会与「这个邮箱压根不存在」给出**两种不同的响应**，
               等于把「谁是本站用户」变成可查询的事实（邮箱枚举）。
             · 判在后面（口令对了才判）—— 攻击者先得猜中口令，
               那时他本来就已经是账号主人了，多说一句「去确认邮箱」
               不泄露任何他还不知道的东西。
         这一条与「口令错 / 账号不存在」那句统一文案是同一条纪律的两半：
         在**没有凭据**的时候一个字都不多给，在**有凭据**的时候把路说清。
         ⚠️ 判据只有一处（`emailGate`）—— 随机码那条路读的是同一个函数。
         ------------------------------------------------------------------ */
      var gatePw = emailGate(deps, acc);
      if (gatePw) return Promise.resolve(gatePw);

      /* 成功：清掉失败窗口（否则「错九次、对一次、再错一次」就锁号了） */
      if (limiter.clearFails) limiter.clearFails("login", "uid:" + acc.uid);
      acc.last_login_at = t;
      return Promise.resolve(store.putAccount(acc)).then(function (saved) {
        var s = session.issue(cfg, acc.uid, t);
        return {
          status: 200,
          body: { account: publicAccount(cfg, saved || acc) },
          cookies: [session.setCookieHeader(cfg, s.token, Math.round((s.exp - t) / 1000))],
          _session: s
        };
      });
    });
}

/**
 * 忘记密码第一步（`POST /api/reset-request`）。
 *
 * ⚠️ **响应与请求一律不泄露「这个邮箱注册过没有」**（与发码第 4 条 checklist
 *    逐条同源）：不存在也回 202、也回同一个形状。
 *    区别只有一个：不发信。而那件事用户看不见（他去看自己的收件箱）。
 */
function resetRequest(deps, input) {
  var cfg = deps.cfg;
  /* ---- 人机校验：**匿名可写、会往任意邮箱发信**的那条口子 ---- */
  return humanGuard(deps, input).then(function (blocked) {
    if (blocked) return blocked;
    return resetRequestAfterGuard(deps, input);
  });
}

/** `resetRequest` 过了人机校验之后的那一段（逻辑一字未改） */
function resetRequestAfterGuard(deps, input) {
  var cfg = deps.cfg, store = deps.store, limiter = deps.limiter, t = deps.now();
  var email = id.normalizeEmailForStore(input.email != null ? input.email : input.value);
  var device = String(input.deviceId || "unknown");
  /* 无论邮箱对不对，响应的形状都是这一个 */
  var SAME = {
    requested: true,
    store: store.kind,
    ttlSeconds: Math.round((cfg.resetTtlMs || 3600000) / 1000),
    note: "如果这个邮箱在本站注册过，我们已经把重设链接发了出去。",
    /* ⚠️ 这一条是**事实**（与 register 的 verifySent 同一条纪律），
       而且它**不泄露「这个邮箱注册过没有」** —— 它说的是
       「本站的发信商配好了没有」，那是这台服务器的属性，
       与请求里那个邮箱是谁无关。所以对**不存在的邮箱**它也必须在这里：
       否则「没这一条 = 注册过、有这一条 = 没注册过」就成了新的枚举口
       （`test/api.test.js` 有断言钉着这条：存在与不存在回同一个形状）。 */
    mailConfigured: cfg.mail() !== "console"
  };
  if (!id.isEmailShape(email)) return Promise.resolve(err(400, "E_EMAIL_FORMAT", "这个邮箱看起来不太对，再检查一下"));

  /* ⚠️ 四层闸 + **原子 take**（原先只有 device / email 两层，而且是
     「check 一圈 → 发信 → hit 一圈」—— 中间隔着发信商那次真实的 HTTP，
     并发下每一条请求都在空窗口上通过；而整条路径**没有 IP 那一档**，
     换一个 deviceId 就绕过了）。
     忘记密码口是**匿名可写**的（它会往任意邮箱发信），必须按 IP 兜住：
     实测（第廿六节 ⑤）换邮箱 + 换 deviceId 可以把它刷成发信机。 */
  var ip = String(input.ip || "unknown");
  var rBuckets = [
    ["device", "reset:" + device],
    ["ip", "reset:" + ip],
    ["email", "reset:" + id.emailHash(email, pepperOf(cfg))]
  ];
  for (var bi = 0; bi < rBuckets.length; bi++) {
    var bg = limiter.take(cfg, rBuckets[bi][0], rBuckets[bi][1], t);
    if (!bg.ok) {
      var bcode = rateCode(rBuckets[bi][0]);
      return Promise.resolve(err(429, bcode, RATE_MSG[bcode] || "发得太快了，请稍后再试", { retryAfter: bg.retryAfter }));
    }
  }

  return Promise.resolve(store.getAccountByHash(id.emailHash(email, cfg.sessionSecret || "no-pepper")))
    .then(function (acc) {
      if (!acc || acc.status === "deleted") return null;   // ← 不发信，但响应一模一样
      return issueReset(deps, acc, email).then(function (r) {
        if (cfg.allowCodeEcho) SAME.devResetToken = r.token;
        return r;
      });
    })
    .then(function () { return ok(SAME); });
}

/** 发一封重设口令的邮件。与 `issueVerification` 同一条：`sent` 是事实 */
function issueReset(deps, acc, email) {
  var cfg = deps.cfg, store = deps.store, t = deps.now();
  var token = id.newToken();
  var rid = id.newResetId();
  var rec = {
    rid: rid,
    uid: acc.uid,
    /* 记的是**用户这次填的那个邮箱**（可能与账号上那一个大小写不同）。
       重设链接发往 `accounts.email`，这一列只是留痕，供排查。 */
    email: id.normalizeEmailForStore(email),
    token_hash: id.tokenHash(acc.uid, "reset", token, cfg.sessionSecret || "no-pepper"),
    salt: id.newSalt(),
    issued_at: t,
    expires_at: t + (cfg.resetTtlMs || 3600000),
    consumed_at: null,
    attempts: 0
  };
  return Promise.resolve(store.voidResets(acc.uid, t))
    .then(function () { return store.putReset(rec); })
    .then(function () {
      /* 同上：`rid` 必须在链接里（`/reset/?rid=..&token=..`） */
      return mail.reset(cfg, { to: acc.email, mask: acc.email_mask, rid: rid, token: token, ttlMs: cfg.resetTtlMs });
    })
    .then(function (sent) {
      return {
        rid: rid, token: token,
        sent: !!sent.delivered,
        transport: sent.transport,
        attempts: Number(sent.attempts) || 1,
        reason: sent.reason || null
      };
    })
    .catch(function (e) {
      return {
        rid: rid, token: token, sent: false, transport: "failed",
        attempts: Number(e && e.attempts) || 1,
        reason: (e && e.reason) || "unknown"
      };
    });
}

/**
 * 忘记密码第二步（`POST /api/reset-confirm`）—— 真正把口令换掉。
 *
 * 四条一次做齐（少一条都是半截功能）：
 *   ① 令牌校验（形状 / 过期 / 重放 / 定长比较）
 *   ② 口令形状校验
 *   ③ 写新摘要
 *   ④ **吊销全部会话** —— 这是「重设口令」真正的安全含义：
 *      口令被换了，说明原来那个**可能已经泄露**，那么所有拿旧口令
 *      （或旧会话）进来的人都必须出去。
 *   ⑤ 顺手把 `status` 从 `locked` 里解出来：用户能收到重设邮件、
 *      能点开、能填新口令，说明他就是本人 —— 还锁着就是自相矛盾。
 */
function resetConfirm(deps, input) {
  var cfg = deps.cfg, store = deps.store, limiter = deps.limiter, t = deps.now();
  var rid = String(input.rid || "");
  var bad = checkPassword(cfg, input.password);
  if (bad) return Promise.resolve(err(400, bad.code, bad.message));
  if (!rid) return Promise.resolve(err(400, "E_NO_TOKEN", "重设链接不完整，请重新发一封邮件"));

  var device = String(input.deviceId || "unknown");
  var resetIp = String(input.ip || "unknown");
  /* ⚠️ 原子 take + IP 档：这一条也是匿名可写的（只要拿到 rid + token），
     原先只按设备档 `check`（且落账在最后那一步），等于并发下不限速。 */
  var rcBuckets = [["device", "resetc:" + device], ["ip", "resetc:" + resetIp]];
  var rcBlocked = null;
  for (var ci = 0; ci < rcBuckets.length; ci++) {
    var cg = limiter.take(cfg, rcBuckets[ci][0], rcBuckets[ci][1], t);
    if (!cg.ok) {
      var ccode = rateCode(rcBuckets[ci][0]);
      rcBlocked = err(429, ccode, RATE_MSG[ccode] || "稍后再试", { retryAfter: cg.retryAfter });
      break;
    }
  }
  if (rcBlocked) return Promise.resolve(rcBlocked);

  return Promise.resolve(store.getReset(rid)).then(function (rec) {
    if (!rec) return err(400, "E_TOKEN_INVALID", "这个重设链接不对，请重新发一封邮件");
    if (rec.consumed_at) return err(400, "E_TOKEN_USED", "这个重设链接已经用过了，请重新发一封邮件");
    if (t < Number(rec.issued_at) - 120000) return err(400, "E_TOKEN_INVALID", "这个重设链接不对，请重新发一封邮件");
    if (Number(rec.expires_at) <= t) return err(400, "E_TOKEN_EXPIRED", "重设链接已过期，请重新发一封邮件");
    if (!input.token) return err(400, "E_TOKEN_INVALID", "这个重设链接不对，请重新发一封邮件");
    var expect = id.tokenHash(rec.uid, "reset", String(input.token), cfg.sessionSecret || "no-pepper");
    if (!id.timingSafeEqual(expect, rec.token_hash)) {
      var next = Number(rec.attempts || 0) + 1;
      return Promise.resolve(store.patchReset ? store.patchReset(rid, { attempts: next }) : null)
        .then(function () { return err(400, "E_TOKEN_INVALID", "这个重设链接不对，请重新发一封邮件"); });
    }

    return Promise.resolve(store.patchReset(rid, { consumed_at: t }))
      .then(function () { return store.getAccount(rec.uid); })
      .then(function (acc) {
        if (!acc || acc.status === "deleted") return err(400, "E_TOKEN_INVALID", "这个重设链接不对，请重新发一封邮件");
        var salt = id.newPasswordSalt();
        acc.password_hash = id.hashPassword(String(input.password), salt);
        acc.password_salt = salt;
        /* ⚠️ 邮箱确认与重设口令是**两件事**，但能收到重设邮件本身
           就证明了邮箱可达 —— 所以这里不「顺手」把 email_verified_at 也写掉。
           写成「收到了重设邮件 ⇒ 邮箱一定确认过」在下一次改主邮箱时会出错。 */
        if (acc.status === "locked") acc.status = "active";
        if (acc.status === "pending") { /* 待确认状态**保持**：口令换了不等于邮箱确认了 */ }
        /* ⑤ 全部会话吊销：改口令 = 「原来那个可能泄露了」，所有旧会话必须失效 */
        return Promise.resolve(store.putAccount(acc))
          .then(function () { return store.revokeSessions(acc.uid); })
          .then(function () {
            return ok({
              reset: true,
              emailMask: acc.email_mask || "***",
              sessionsRevoked: true,
              /* ------------------------------------------------------------------
                 邮箱还没确认时，**必须**在这一句里说出来
                 ------------------------------------------------------------------
                 否则就是那个最难查的用户投诉：他走完「忘记密码」整套流程
                 （收信、点链接、填新口令、看到「请用新密码重新登录」），
                 回去一登 —— 403「邮箱还没确认」。
                 他会以为自己刚设的密码没生效，于是再来一遍。
                 ⚠️ 这里**不顺手把他的确认状态改成已确认**（同上面那段：
                    能收到重设邮件 ≠ 点过确认链接；两件事各写各的）。
                    能做的只有「如实告诉他还有一步」——
                    而那一步的入口就在登录页那一刻（那颗「重新发一封」）。
                 ------------------------------------------------------------------ */
              emailVerified: acc.email_verified_at != null,
              note: acc.email_verified_at != null
                ? "密码已重设。为了安全，其它设备上的登录已全部退出，请用新密码重新登录。"
                : "密码已重设。为了安全，其它设备上的登录已全部退出。**但这个邮箱还没确认，暂时登录不了** —— 请到登录页点「重新发一封确认邮件」，点开那封邮件里的链接之后再用新密码登录。"
            });
          });
      });
  });
}

/**
 * 重发确认邮件（`POST /api/resend-verification`）—— **两条入口，一套闸**。
 *
 * ## 两条入口（Issue #197 复审：这一条以前只有「要登录」那一条）
 *
 * 用户裁了「不确认就不让登录」。那之后有一个**死结**：
 * 「注册完没点确认」的人登不进来，而重发确认邮件那颗键原先只住在
 * 个人中心里 —— 个人中心要登录。于是屏幕上**没有任何可点的东西**，
 * 他唯一能做的是再注册一次（而那条路刚刚才被堵上，见 register）。
 *
 * 所以这一条现在有两条入口，**共用同一套闸与同一套文案**：
 *   · 登录态（Cookie）→ 认会话里的 uid
 *   · 匿名（带 `email`）→ 认那个邮箱，**且存在与否回一模一样的话**
 *
 * ## 匿名入口的四条闸（它是全站唯一「不登录也能让本站往外发信」的接口）
 *
 *   ① 频控四层（邮箱 / 设备 / IP / 全局）—— 与发码同一套 take 语义
 *   ② 70 秒冷却（同一邮箱别连点）
 *   ③ **邮箱存在与否 + 已确认与否，回话逐字相同**
 *      —— 否则它就是一个「这个邮箱是谁的、确认了没有」的查询口
 *   ④ 已确认的不发信（发一封「你的邮箱已确认」没有意义，
 *      还会让「重发」这颗键看起来永远有用）
 *
 * ## 为什么必须回「一模一样」而不是「差不多」
 *
 * 这一条原先挂着「要登录」，所以它没有枚举风险。开了匿名口之后
 * **风险形状与 `/api/reset-request` 完全一样**，于是口径也照抄那一条：
 * 同一个状态、同一个 body、同一句条件句。
 */
function resendVerification(deps, input) {
  var cfg = deps.cfg;
  /* ---- 人机校验：**匿名**那条入口是全站唯一「不登录也能让本站往外发信」
     的接口（见 humanGuard 里那张「挂闸四条」的清单）。
     ⚠️ 登录态那条入口**也走它** —— 判据只写一处，不为两条入口各写一份。 ---- */
  return humanGuard(deps, input).then(function (blocked) {
    if (blocked) return blocked;
    return resendVerificationAfterGuard(deps, input);
  });
}

/** `resendVerification` 过了人机校验之后的那一段（逻辑一字未改） */
function resendVerificationAfterGuard(deps, input) {
  var cfg = deps.cfg, store = deps.store, limiter = deps.limiter, t = deps.now();
  var device = String(input.deviceId || "unknown");
  var ip = String(input.ip || "unknown");

  var email = id.normalizeEmailForStore(input.email != null ? input.email : input.value);
  var anon = !deps.account;
  if (anon && !id.isEmailShape(email)) {
    /* ⚠️ 匿名口连邮箱形状都不给时，如实回格式错 —— 这一条**不泄露任何东西**
       （形状是调用方自己给的，与库里有没有这个人无关）。 */
    return Promise.resolve(err(400, "E_EMAIL_FORMAT", "这个邮箱看起来不太对，再检查一下"));
  }

  /* 匿名口回话的**唯一形状**：与「已发出」「不存在」「已确认」逐字一致的那一个。
     只有 `devVerifyToken`（冒烟口，生产永远关着）与 `sent` 这类**我们自己的
     调试事实**允许不同 —— 而它们恰恰是生产看不到的。 */
  var SAME = {
    requested: true,
    alreadyVerified: false,
    verifySent: false,
    store: store.kind,
    note: "如果这个邮箱在本站注册过而且还没确认，我们已经把确认邮件发了出去。"
  };

  /* ---- 闸：四层频控（**原子 take**：判完当场落账）+ 冷却 ---- */
  var buckets = [["email", "resend:" + id.emailHash(email, pepperOf(cfg))],
    ["device", "resend:" + device], ["ip", "resend:" + ip], ["global", "resend-all"]];
  var cool = limiter.cooldown("email", "resend:" + id.emailHash(email, pepperOf(cfg)), cfg.resendCooldownMs || 60000, t);
  if (!cool.ok) {
    return Promise.resolve(err(429, "E_RATE_EMAIL", RATE_MSG.E_RATE_EMAIL, { retryAfter: cool.retryAfter }));
  }
  for (var i = 0; i < buckets.length; i++) {
    var g = limiter.take(cfg, buckets[i][0], buckets[i][1], t);
    if (!g.ok) {
      var code = rateCode(buckets[i][0]);
      return Promise.resolve(err(429, code, RATE_MSG[code] || "发得太快了，请稍后再试", { retryAfter: g.retryAfter }));
    }
  }

  function act(acc) {
    /* 「不存在」与「已确认」走**同一条出口** —— 这一条是反枚举的全部内容。
       两条各写一小段文案的下场是：某天改了一句，两个响应就不再逐字相同，
       而那时没有任何东西会报错。 */
    if (!acc || acc.status === "deleted" || acc.email_verified_at != null) {
      /* ⚠️ 匿名口：**逐字回 SAME**（连字段顺序都一样 —— 用 Object.assign
         从 SAME 复制，不新拼一个对象），已确认与否也**不说**。
         登录态那条入口本来就知道自己是谁，多回几个字段不构成泄露。 */
      if (anon) return ok(Object.assign({}, SAME));
      return ok({
        requested: true,
        alreadyVerified: !!(acc && acc.email_verified_at != null),
        emailMask: (acc && acc.email_mask) || "***",
        verifySent: false,
        store: store.kind,
        note: SAME.note
      });
    }
    return issueVerification(deps, acc).then(function (v) {
      var body;
      if (anon) {
        /* ⚠️ **匿名口逐字回 SAME** —— 一个字段都不许加。
           加 `emailMask` 就等于回答「这个邮箱在我们这儿」（掩码就是从真邮箱算出来的），
           加 `verifyAttempts` 同理（不存在的那一次没有发信这个动作，
           所以它没有「试了几次」）。这两条都是**这一版实测出来的**：
           第一版把 `emailMask` 写进了公共分支，`known` 与 `unknown`
           两个响应于是不再逐字相同 —— 那正是它想守的那条纪律。 */
        body = Object.assign({}, SAME);
      } else {
        /* 登录态那条入口：**自己看自己**，所以可以、也应该回得更细
           （掩码 + 发信通道 + 试了几次、为什么没成）。 */
        body = {
          requested: true,
          alreadyVerified: false,
          emailMask: acc.email_mask || "***",
          verifySent: v.sent,
          verifyTransport: v.transport,
          verifyAttempts: v.attempts || 1,
          verifyReason: v.reason || null,
          note: SAME.note
        };
      }
      /* ⚠️ 冒烟口只在**登录态**那条路上给明文令牌。
         匿名口给的话，它就是一个「凭邮箱取确认令牌」的接口 ——
         而 ALLOW_CODE_ECHO 恰恰只会在本地联调 / CI 里打开，
         那些环境的 MAIL_TRANSPORT 常是 console，令牌本来就只在这一条路上能取到。 */
      if (cfg.allowCodeEcho && !anon) body.devVerifyToken = v.token;
      return ok(body);
    });
  }

  if (!anon) {
    return Promise.resolve(store.getAccount(deps.account.uid)).then(function (acc) {
      if (!acc || acc.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
      return act(acc);
    });
  }
  return Promise.resolve(store.getAccountByHash(id.emailHash(email, pepperOf(cfg)))).then(act);
}

/**
 * 匿名重发确认邮件（`POST /api/resend-verification-by-email`）。
 *
 * ## 为什么有这一条，而它不是第三份实现
 *
 * 上一轮（PR #199 那一支）把匿名口做成了一个**独立函数**，与要登录那条
 * 各写一遍闸、各写一遍 `SAME`。两条各写一遍的下场正是本仓库反复踩过的形状：
 * 某天改了一句文案 / 加了一档频控，只有一条被改到。所以现在
 * **判据、频控、冷区、反枚举响应全部只住在 `resendVerification` 里** ——
 * 这一条只是「强制走匿名分支」的那一个薄壳。
 *
 * ⚠️ 它**不接受 `deps.account`**：这一条的语义就是「我登不进来」。
 *    带着会话调它，应当走要登录那条（那样能回得更细，也是调用方的本意）。
 * ⚠️ 保留它是为了**兼容既有调用点**（`/api/resend-verification-by-email`
 *    那条路由与前端 `js/auth-api.js` 的 `resendVerificationByEmail`）。
 *    新代码请直接用 `resendVerification`：它两条入口都认。
 */
function resendVerificationByEmail(deps, input) {
  var anonDeps = Object.assign({}, deps);
  delete anonDeps.account;      // 「匿名」这件事由**这一条**保证，不由调用方
  return resendVerification(anonDeps, input || {});
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

/**
 * 名册（子档案清单）—— **账号域，本该跨设备**。
 *
 * ## 它为什么在服务端有一份
 *
 * 一台平板上午小明读、下午小红读，晚上爸爸拿手机看小明的进度。
 * 名册只在本机的话，手机根本不知道有「小明」这个人 —— 也就无法切过去。
 * 所以名册与进度**一起上云**，但两者的**键不同域**：
 *   · 名册  `family:v1`      —— `child_id = ''`（账号级，一份）
 *   · 进度  `poem:<篇目>#<child>` —— `child_id = <孩子>`（每个孩子一份）
 *
 * ## ⚠️ 一处刻意的不对称：**它不参与判权**
 *
 * 本机那份名册由 `js/family.js` 自己写盘（它同时服务于**没登录**的用户 ——
 * 离线单机也要能建多个孩子）。服务端这一份只做「另一个设备看得见」这一件事，
 * 于是判权仍只有一处：`/api/me` 下发的 `plan`。
 * 「这个账号里有几个孩子」**不是**权限，别把它读成权限。
 */
function familyGet(deps) {
  var store = deps.store;
  if (!deps.account) return Promise.resolve(err(401, "E_NO_SESSION", "还没有登录"));
  return Promise.resolve(store.listProgress(deps.account.uid, "", 0)).then(function (rows) {
    var row = null;
    (rows || []).forEach(function (r) { if (r.poem_id === FAMILY_ROW_ID) row = r; });
    return ok({
      /* 没有这一行**不是错误** —— 那是「对方还没同步过名册」（新账号的常态）。
         回一份空名册而不是 404：客户端据此知道「服务端还没有我这一份」，
         于是推上去，而不是把本机名册清成空。 */
      family: row && row.payload ? row.payload : { v: 1, at: "", profiles: [] },
      updatedAt: row ? Number(row.updated_at) : 0,
      serverTime: deps.now()
    });
  });
}

/**
 * 写名册（`POST /api/family`）—— 与 `sync/push` **同一把闸**（Pro 起）。
 *
 * ⚠️ 不能绕开 `syncTierGate`：它写的就是云端那份进度表里的一行。
 *    两把闸不同的下场是「界面说 Free 也能跨设备」（因为家庭档案那一项写着 Pro）
 *    而实际推得上去 —— 正是反复踩过的「限制写在 A 处、读取在 B 处」。
 */
function familyPut(deps, input) {
  var store = deps.store, cfg = deps.cfg, t = deps.now(), input2 = input || {};
  var gate = syncTierGate(deps, input2);
  function inner() {
    var g = deps.limiter.check(cfg, "device", "family:" + String(input2.deviceId || "unknown"), t);
    if (!g.ok) return Promise.resolve(err(429, "E_RATE_DEVICE", "同步太频繁了，请稍后再试", { retryAfter: g.retryAfter }));
    deps.limiter.hit("device", "family:" + String(input2.deviceId || "unknown"), t);
    var clean = sanitizeFamily(input2.family);
    return Promise.resolve(store.putProgress(deps.account.uid, "", [{
      poem_id: FAMILY_ROW_ID,
      payload: clean,
      updated_at: t,
      deleted: 0
    }])).then(function () { return ok({ family: clean, serverTime: t }); });
  }
  if (gate) return Promise.resolve(gate).then(function (bad) { return bad || inner(); });
  return inner();
}

/* -------------------------------------------------- 子档案（跨设备分档案） */

/**
 * 子档案 id 的**服务端口径**（`docs/architecture.md` §5.5 / §5.2 ④）。
 *
 * ## 名字为什么叫 child 而不是 profile
 *
 * 客户端那边这东西叫「子档案」（`js/family.js`），库这一列叫 `child_id`。
 * 两个名字指的是同一件事：**账号下的一个孩子 + 一份自己的进度**。
 * 孩子**不建独立账号**（`docs/auth-design.md` §2.1）—— 只是展示名，
 * 因此这里**不做任何权限判定**：它不是身份，是「哪一份数据」。
 *
 * ## 三条铁律
 *
 * 1. **空串 = 第一个孩子那一份**，与 `js/family.js` 的无后缀老键**逐字同源**。
 *    分家前那份数据的 `child_id` 就是空串，不是 `::p1`、不是 `default`。
 *    这是**一次真的数据库迁移**里最容易做错的一处：认领成别的值，
 *    老用户的进度会在升级后「看着空了」（数据还在，只是没人再指得到它）。
 *
 * 2. **长度与字符集都收窄**：id 是客户端生成的，服务端只当它是**一个键**，
 *    当不了任何权限。但它会进 URL 与 SQL 参数，所以必须限长、去掉空白，
 *    且只允许 `[A-Za-z0-9_-]` —— 不这么做的下场是「一个带引号的 id
 *    能在 PostgREST 的查询串里插一段」（构造出来的话，那个 eq. 就不再是等值比较）。
 *
 * 3. **不认识的一律落回空串**（而不是报错、也不是「替他建一个」）：
 *    报错会让一份脏数据把整个同步打死；替他建一个则会造出**永远没人用的行**。
 */
function childId(raw) {
  var c = String(raw == null ? "" : raw).trim();
  if (!c) return "";
  if (c.length > 64) return "";
  if (!/^[A-Za-z0-9_-]+$/.test(c)) return "";
  return c;
}

/** 名册在 progress 表里的位置（账号级：`child_id = ''`）—— 与 js/family.js 同源 */
var FAMILY_ROW_ID = "family:v1";

/**
 * 导出**一个账号下所有孩子**的进度（注销用）。
 *
 * ⚠️ 为什么不能只 `listProgress(uid, child, 0)` 一次：那只能拿到**一个**档案的那一份。
 *    注销之后再没有第二次机会，少导出一个孩子的进度就是**永久丢失** ——
 *    所以这里逐个档案地取。取不漏的判据在测试里：两个各写一份、注销，
 *    导出里两个孩子的记录都在。
 */
function exportAllProgress(deps, uid) {
  var store = deps.store;
  function one(child) {
    return Promise.resolve(store.listProgress(uid, child, 0)).then(function (rows) {
      return (rows || []).map(function (r) {
        return { poem_id: r.poem_id, child_id: child, payload: r.payload, updated_at: r.updated_at, deleted: r.deleted };
      });
    });
  }
  if (!store || !store.listProgress) return Promise.resolve([]);
  /* 名册那一行（账号级）一定在 `''` 里，所以它至少会被取一次。
     其余的孩子从名册里读 —— 名册是**唯一**知道「这个账号有几个孩子」的地方。 */
  return one("").then(function (rows) {
    var reg = null;
    (rows || []).forEach(function (r) {
      if (r.poem_id === FAMILY_ROW_ID && r.payload && Array.isArray(r.payload.profiles)) reg = r.payload;
    });
    var ids = reg ? reg.profiles.map(function (p) { return childId(p && p.id); }).filter(Boolean) : [];
    /* 去重（脏名册里可能两条同 id）且不要重复取空串那一份 */
    var seen = {};
    ids = ids.filter(function (id) { if (seen[id]) return false; seen[id] = true; return true; });
    return Promise.resolve(ids.reduce(function (chain, id) {
      return chain.then(function (all) {
        return one(id).then(function (more) { return all.concat(more); });
      });
    }, Promise.resolve(rows || [])));
  });
}

/* -------------------------------------------------------- 同步 */

/**
 * 跨设备云同步的**能力闸**（`sync.multiDevice`，Pro 起）。
 *
 * ## 为什么这条闸必须补
 *
 * `/plans/` 的对比表是**当场问内核**算出来的，而 `CAPS` 里写着
 * `sync.multiDevice: minTier "pro"` —— 于是页面上公开对用户宣称「跨设备云同步 = Pro」。
 * 但在这一轮之前，**全站 0 处**真的拿这条能力拦过任何人：一个 free 用户
 * 把设置页那颗开关打开，进度就真的推上去了。
 *
 * 也就是说：那条公开宣称是**假话**，而且是对 free 用户**白送**、对 Pro 用户
 * **白收了一道本该有的门**。这与 2A 那两个洞、2.2 的断链、③ 的 `export.all`
 * 是同一个形状 —— 限制写在 A 处（能力表）、读取在别处（没有读取点）。
 *
 * ## 闸拦在哪一层：**服务端**，不是按钮
 *
 * 客户端的开关置灰**不是**安全边界（§3.4 从 1A 起就这么写着）：
 * 直接的 HTTP 请求照样打得到 `/api/sync/push`。所以这一条与 `gameAnswer` 同款 ——
 * 拿账号落库的 `plan` 现判一次，不够就 **403 E_TIER**。
 *
 * ## 401 与 403 分开回
 *
 * 前者是「你还没登录」，后者是「你确实没这个权限」—— 用户看到的下一步动作
 * 完全不同（一个去登录、一个去找管理员发层级）。合并成一句「失败」等于什么也没说。
 *
 * ⚠️ **拉与推都要判**，不是只判推。只判推的话，「关掉同步」这件事仍然做得成，
 *    但一个 free 用户照样能把云端**已有的**那份拉下来（那是别人的进度）。
 */
function syncTierGate(deps, input) {
  var store = deps.store, cfg = deps.cfg;
  if (!deps.account) return Promise.resolve(err(401, "E_NO_SESSION", "还没有登录"));
  return Promise.resolve(store.getAccount(deps.account.uid)).then(function (me) {
    if (!me || me.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    var tier = planTier(me);
    if (!gameAllowed(cfg, tier, "sync.multiDevice")) {
      return err(403, "E_TIER", "跨设备云同步要 Pro 起才能用（当前：" + tier + "）。进度在本机一字不少，背诵不受影响。",
        { cap: "sync.multiDevice", tier: tier, minTier: "pro" });
    }
    return null;
  });
}

/**
 * pull：增量拉。
 * `since` 是客户端上次拿到的服务端时间（`serverTime`），不是「自己最后修改时间」——
 * 用服务端时间做游标，才不会被客户端时钟误差拖出「永远拉不到 / 拉到重复」。
 *
 * ⚠️ 权限闸（`syncTierGate`）在**频控之前**判：不够层级的人反复重试也不该
 *    占掉别人的频控额度，而且他看到的必须是「你没这个权限」而不是「太频繁了」——
 *    后者会让他一直重试（那是完全不同的两件事）。
 */
function syncPull(deps, input) {
  var store = deps.store, cfg = deps.cfg, t = deps.now();
  var gate = syncTierGate(deps, input);
  if (gate) return Promise.resolve(gate).then(function (bad) { return bad || syncPullInner(deps, input); });
  return syncPullInner(deps, input);
}

function syncPullInner(deps, input) {
  var store = deps.store, cfg = deps.cfg, t = deps.now();
  if (!deps.account) return Promise.resolve(err(401, "E_NO_SESSION", "还没有登录"));
  var since = Number(input.since) || 0;
  var child = childId(input.child);
  var g = deps.limiter.check(cfg, "device", "pull:" + String(input.deviceId || "unknown"), t);
  if (!g.ok) return Promise.resolve(err(429, "E_RATE_DEVICE", "同步太频繁了，请稍后再试", { retryAfter: g.retryAfter }));
  deps.limiter.hit("device", "pull:" + String(input.deviceId || "unknown"), t);

  return Promise.resolve(store.listProgress(deps.account.uid, child, since)).then(function (rows) {
    return ok({
      /* ⚠️ 回包里带上 `child`：客户端据此分辨「这一份是谁的」。
         少了它，拉回来的数据会被写进**当前选中**那个孩子的盘上 ——
         而拉的时候选中的可能是另一个（切换发生在请求在途时），
         症状是「两个孩子的进度混了」，且只在慢网络下偶发。 */
      child: child,
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
  var gate = syncTierGate(deps, input);
  if (gate) return Promise.resolve(gate).then(function (bad) { return bad || syncPushInner(deps, input); });
  return syncPushInner(deps, input);
}

function syncPushInner(deps, input) {
  var store = deps.store, cfg = deps.cfg, t = deps.now();
  if (!deps.account) return Promise.resolve(err(401, "E_NO_SESSION", "还没有登录"));

  var g = deps.limiter.check(cfg, "device", "push:" + String(input.deviceId || "unknown"), t);
  if (!g.ok) return Promise.resolve(err(429, "E_RATE_DEVICE", "同步太频繁了，请稍后再试", { retryAfter: g.retryAfter }));

  var child = childId(input.child);
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
      payload: sanitizePayload(r.payload, pid),
      updated_at: Math.round(ts),
      deleted: r.deleted ? 1 : 0
    });
  });
  if (dropped) return Promise.resolve(err(400, "E_BAD_REC", "有 " + dropped + " 条记录缺 id 或时间戳"));

  deps.limiter.hit("device", "push:" + String(input.deviceId || "unknown"), t);

  return Promise.resolve(store.putProgress(deps.account.uid, child, clean)).then(function () {
    return ok({ applied: clean.length, child: child, conflicts: [], serverTime: t });
  });
}

/**
 * 进度载荷的白名单化。
 * ⚠️ 客户端推上来的是**不可信数据**：只收背诵档案认识的几个字段，
 *    并且把长度与数值范围卡死 —— 否则一个坏客户端能把 JSON 塞成任意大小，
 *    免费档那 500MB 与 5GB 出口流量会被人一夜刷爆（docs §4.3 第 3 条）。
 */
function sanitizePayload(p, poemId) {
  var out = {};
  if (!p || typeof p !== "object") return out;

  /* 名册那一行（`family:v1`）是**另一种载荷** —— 它不是一篇诗的背诵档案。
     ⚠️ 走同一条白名单的下场：`sanitizePayload` 不认 `profiles`，
        于是名册推上去变成 `{}`，另一台设备读到的名册是空的 ——
        症状不是报错，是「在平板建的孩子，手机上根本看不见」。
     所以这里按 `poem_id` 分岔，而不是放宽那条白名单（放宽等于让一篇诗的
     档案能塞任意字段，那正是它要挡的）。 */
  if (poemId === "family:v1") return sanitizeFamily(p);

  if (typeof p.level === "number") out.level = Math.max(0, Math.min(99, Math.round(p.level)));
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

/**
 * 名册载荷的白名单化（`family:v1` 那一行）—— 与 `js/family.js` 的盘上形状同源。
 *
 * ```
 * { v:1, at:"f-...", profiles:[{ id, nickname, avatar:{char,ink}, createdAt }] }
 * ```
 *
 * 收得比进度那一份还紧，理由是它**跨设备可写**（谁登录谁就能推）：
 *   · 档案数封顶 **200** —— `js/family.js` 的上限是 Max 180，留出余量；
 *     不封顶的话，一份名册能把免费档那 500MB 撑爆（与进度白名单同一条理由）。
 *   · 昵称截 12 字（与客户端 `NAME_MAX` 同值）、头像字符截 2 字，
 *     颜色只收 `#rrggbb` —— 头像那两个字会进 DOM，长与形状都得收窄。
 *   · `id` 用与 `childId()` **同一把尺子**（同一个值要当键用，两套规则就有一天对不上）。
 *   · **不认的档案整条丢掉**，但**不因此让整份名册失败** ——
 *     一份脏名册把同步打死，比少一个孩子更糟。
 */
/**
 * 头像地址的白名单化（权威那一边的尺子）。
 *
 * 与 `js/avatar.js` 的 `isImgUrl()` **同源但不同宽**：这里的任务不是「能不能画」，
 * 而是「会不会被别的设备拿去 `<img src>`」—— 所以只有 https 与本站的
 * `/api/avatar/` 两条路，**data URL 一律不收**：
 *   · 账号域这一份要被同步（`js/sync-store.js`）与导出（`js/export-core.js`），
 *     一条几十 KB 的 base64 混进每一条进度记录里，会把免费档的 500MB 吃光
 *   · data URL 里能塞任何 MIME，甚至 `data:image/svg+xml`（SVG 内可以带脚本）——
 *     而它画在**别人**的屏幕上
 * 本机那份图（`poem_avatar_local_v1`）走的是另一条路，压根不上云。
 */
function sanitizeImgUrl(u) {
  var s = String(u == null ? "" : u).trim();
  if (!s || s.length > 512) return "";
  if (/^https:\/\/[^\s"'<>]+$/i.test(s)) return s;
  if (s.indexOf("/api/avatar/") === 0 && !/[\s"'<>]/.test(s)) return s;
  return "";
}

function sanitizeFamily(p) {
  var out = { v: 1, at: childId(p && p.at), profiles: [] };
  var list = (p && Array.isArray(p.profiles)) ? p.profiles.slice(0, 200) : [];
  list.forEach(function (q) {
    if (!q || typeof q !== "object") return;
    var id = childId(q.id);
    if (!id) return;
    var name = String(q.nickname == null ? "" : q.nickname).trim().slice(0, 12);
    var av = (q.avatar && typeof q.avatar === "object") ? q.avatar : {};
    out.profiles.push({
      id: id,
      nickname: name,
      /* ⚠️ 头像只有 `img` 一个字段（Issue #163 · 2026-09-19）：上一版的
         `char` / `ink`（固定字 + 固定四色）已被用户点名删掉。这里**不认它们** ——
         认了的话，一台设备推一份老形状的名册上来，另一台就会用一套
         已经不在界面上的东西画头像。丢掉之后两边都画首字印，一致。 */
      avatar: { img: sanitizeImgUrl(av.img) },
      createdAt: Number(q.createdAt) > 0 ? Math.round(Number(q.createdAt)) : 0
    });
  });
  /* 选中的那个必须真的在名册里 —— 不在就落回第一条（与客户端 read() 同款）。
     不这么做的话，名册里 `at` 指向一个已被删除的孩子，另一台设备切过去
     会看到一份空进度，且**没人知道该看谁的**。 */
  var has = out.profiles.some(function (q) { return q.id === out.at; });
  if (!has) out.at = out.profiles.length ? out.profiles[0].id : "";
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
 * 列出**全部账号**（`POST /admin/accounts`，只读）—— Issue #197。
 *
 * # 为什么这件事这一次要做
 *
 * 用户在 Issue #197 里第二次提同一件事，而且这次说清了要什么：
 *
 *   「要求用户邮箱必须记录到数据库，用户名等也要。以及 profile 信息等等。」
 *   「我还是要看到这些用户。」（前一轮的原话）
 *
 * 上一轮我给的答案是「掩码不可逆，认出人做不到」。那个答案在当时是对的
 * （库里确实只有摘要 + 掩码）；但用户现在裁的是**把明文记下来**，
 * 于是「看不到人」这件事的前提就不成立了 —— 这一条据此落地。
 *
 * # 与 `adminGrants` 的分工（两条不是一个东西）
 *
 *   `adminGrants`   —— 「**发过东西的**」（`plan !== free`）。它是一张**发放台账**，
 *                      给的操作是「改层级」。它连 uid 都不回（掩码够用）。
 *   `adminAccounts` —— 「**注册过的**」。它是一张**用户名录**，
 *                      给的操作是「看看都有谁」。所以它必须回明文邮箱 ——
 *                      只回掩码的话，这一页等于没做（掩码认不出人）。
 *
 * 两条都走 `adminGate`（同一个角色闸），且都**只读**。
 *
 * # 四条边界
 *
 *   ① **角色闸在服务端**（`adminGate`）：不是 owner / admin 一律 403。
 *      界面上藏不藏入口从来不是安全边界。
 *   ② **绝不回 `password_hash` / `password_salt`** —— 这两列是「能不能登录」
 *      的凭据，管理员也不需要它们。有断言逐字段守着。
 *   ③ **绝不回 `email_hash`** —— 那是登录标识，泄出去等于把
 *      「这个人是不是本站用户」变成可查询的事实（与 `adminGrants` 同一条）。
 *   ④ **不回进度、不回会话、不回确认令牌** —— 这个接口只回答
 *      「有哪些账号、各自什么状态」，不顺手把别的东西倒出来。
 */
function adminAccounts(deps) {
  var cfg = deps.cfg, store = deps.store;
  var gate = adminGate(deps, cfg);
  if (gate) return Promise.resolve(gate);
  return Promise.resolve(store.getAccount(deps.account.uid)).then(function (me) {
    if (!me || me.status === "deleted") return err(401, "E_NO_SESSION", "还没有登录");
    if (!isAdminRole(me.role)) return err(403, "E_FORBIDDEN", "这一条只对管理员开放");
    return Promise.resolve(store.listAccounts()).then(function (rows) {
      var list = (rows || []).filter(function (a) { return a && a.status !== "deleted"; }).map(function (a) {
        return {
          /* 明文邮箱：**这一条接口存在的理由**。
             ⚠️ 老行可能还没有这一列（Issue #197 之前建的账号）——
             那时如实回空串，界面显示掩码，**不假装有**。 */
          email: String(a.email || ""),
          emailMask: a.email_mask || "***",
          nickname: a.nickname || "",
          tier: planTier(a),
          role: isAdminRole(a.role) ? String(a.role).toLowerCase() : "user",
          /* 注册那一刻的账号状态：pending = 邮箱还没确认。
             这两列**不是同一件事**，别合并：
             `status` 是账号的（可能被 suspended），
             `emailVerified` 是那一封确认邮件的（只有确认过才为真）。 */
          status: String(a.status || "active"),
          emailVerified: a.email_verified_at != null,
          hasPassword: !!a.password_hash,
          createdAt: Number(a.created_at) || 0,
          lastLoginAt: Number(a.last_login_at) || 0
        };
      });
      list.sort(function (x, y) { return y.createdAt - x.createdAt; });
      return ok({
        accounts: list,
        total: list.length,
        store: store.kind,
        note: "这里列的是**注册过的账号**（含邮箱明文）。它与「发放台账」不是一张表：那边只列发过层级的。"
      });
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
 *    · `feihualing`     —— 飞花令（**max**）
 *    · `exam.gathering` —— 《古诗词大会》集子的访问（**max**）
 *    · `exam.paper`     —— 在线试题模拟 · 判分（**max**）
 *    · `quiz.review`    —— 题库复习（**pro**）
 *    对不上的症状是「界面说能用、服务端说不能」—— 而两边都觉得自己是对的。
 *
 * ⚠️ 用户 2026-09-17 的裁决：**「现场考试和飞花令归 max 所有，题库归 pro」**。
 *    与 `docs/auth-design.md` §3.5 那句「飞花令 / 古诗文大会 / 考试与题库 pro 起」
 *    相比，飞花令与现场考试被**上收到 max**，题库复习留在 pro —— 以用户裁决为准。
 *
 * ⚠️ 2026-09-19（Issue #163）：`exam.gathering` 从 `exam.paper` 里拆出来
 *    （集子访问 vs 在线模拟考试，两个功能）。判分口仍然只认 `exam.paper` ——
 *    出题判分是它一直在答的那件事；集子访问不走这个口（它是列表页上的可见性）。
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
  /* ⚠️ 额度记在哪一份？**记在账号那一行（`child_id = ''`），不记在孩子的进度里** ——
     额度是「这个账号这个月用了几次」的账，不是孩子背了多少首。
     记进当前孩子那一份的下场：换个孩子接着刷，额度跟着清零。
     这一条与「不新开一张表」那条判断同源：它借的是 progress 表的位置，
     但**归属是账号级的**，于是这里显式写死空串，不跟着子档案走。 */
  return Promise.resolve(store.listProgress(uid, "", 0)).then(function (rows) {
    (rows || []).forEach(function (r) {
      if (r && r.poem_id === rowId && r.payload && r.payload.month === month) {
        used = Number(r.payload.used) || 0;
      }
    });
    store.putProgress(uid, "", [{
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

  /* ⚠️ 注销导出的必须是**所有孩子**的那一份，不是「当前那个」。
     注销之后再没有第二次机会，少导出一个孩子的进度就是**永久丢失**。
     所以这里逐个档案地取（`listChildren`），而不是只取当前选中的那一个。 */
  return Promise.resolve(exportAllProgress(deps, uid)).then(function (rows) {
    // 导出的是**服务端这一份**（本机那一份由前端自己导出，两边都在用户手里）
    var dump = {
      v: 1,
      exportedAt: t,
      uid: uid,
      recs: (rows || []).map(function (r) {
        return { id: r.poem_id, child: r.child_id || "", payload: r.payload, updatedAt: Number(r.updated_at), deleted: !!r.deleted };
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
  /* ⚠️ **只为测试**：把核心拿到的那一份 mail 模块暴露出来。
     为什么需要它：`test/api.test.js` 的 `boot()` 会清 `api/` 的 require 缓存
     再重新 require，于是「测试文件自己 require 到的那一份」与
     「core 内部持有的那一份」在某些调用顺序下**不是同一个对象**——
     替换其中一个的 `confirm()` 不生效，而症状是「链路没走到发信层」
     这样一个与真正原因完全无关的结论（这个坑实测踩过一次）。
     暴露它是为了**只替换真正被调用的那一个**。生产代码不用它。 */
  __mail: mail,
  err: err,
  sendCode: sendCode,
  verifyCode: verifyCode_,
  me: me,
  syncPull: syncPull,
  syncPush: syncPush,
  familyGet: familyGet,
  familyPut: familyPut,
  childId: childId,
  sanitizeFamily: sanitizeFamily,
  sanitizeImgUrl: sanitizeImgUrl,
  FAMILY_ROW_ID: FAMILY_ROW_ID,
  accountDelete: accountDelete,
  /* Issue #197：完整登录流程那五条 */
  register: register,
  loginWithPassword: loginWithPassword,
  verifyEmail: verifyEmail,
  resendVerificationByEmail: resendVerificationByEmail,
  resendVerification: resendVerification,
  resetRequest: resetRequest,
  resetConfirm: resetConfirm,
  checkPassword: checkPassword,
  isTokenShape: isTokenShape,
  issueVerification: issueVerification,
  issueReset: issueReset,
  findAccountByEmail: findAccountByEmail,
  gameAnswer: gameAnswer,
  gameAllowed: gameAllowed,
  GAME_CAP: GAME_CAP,
  adminGrant: adminGrant,
  adminGrants: adminGrants,
  adminAccounts: adminAccounts,
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
  /* Issue #197 后续：人机校验（Cloudflare Turnstile）*/
  humanGuard: humanGuard,
  turnstileReady: turnstileReady,
  rateCode: rateCode,
  RATE_MSG: RATE_MSG,
  uniqueId: uniqueId,
  dayKey: dayKey
};
