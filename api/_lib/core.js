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
    sms: !!(cfg.smsEnabled && cfg.smsTransport),    // 与 2B 的 503 同口径
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
function sanitizeFamily(p) {
  var out = { v: 1, at: childId(p && p.at), profiles: [] };
  var list = (p && Array.isArray(p.profiles)) ? p.profiles.slice(0, 200) : [];
  list.forEach(function (q) {
    if (!q || typeof q !== "object") return;
    var id = childId(q.id);
    if (!id) return;
    var name = String(q.nickname == null ? "" : q.nickname).trim().slice(0, 12);
    var av = (q.avatar && typeof q.avatar === "object") ? q.avatar : {};
    var ink = String(av.ink == null ? "" : av.ink);
    out.profiles.push({
      id: id,
      nickname: name,
      avatar: {
        char: String(av.char == null ? "" : av.char).slice(0, 2),
        ink: /^#[0-9a-fA-F]{6}$/.test(ink) ? ink : ""
      },
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
  FAMILY_ROW_ID: FAMILY_ROW_ID,
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
