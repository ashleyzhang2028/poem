/**
 * 权益总闸（纯逻辑，零 DOM 依赖）
 * ---------------------------------------------------
 * 这层存在的唯一理由：**全站只允许有一个地方回答「这个用户能不能用这个功能」。**
 *
 * 为什么必须收口：
 *   · 页面里到处散 `plan === "pro"` 的话，将来「本机发放名单」换成
 *     「服务端 /api/me 下发」时，要改十几处；收口之后只换本文件的一个实现。
 *   · 播放入口同理 —— 判据写在 speech.js（所有声音的唯一出口）里，
 *     app.js / reader-core.js 只是调用方，不各自判断。
 *
 * 本期（0 期，无服务端）的诚实口径：
 *   · `free / pro / max` 三层是**本机演示版分层**，发放名单存本机、可导出粘贴；
 *   · 用户手改 localStorage 就能升级 —— 所以它**不是收费凭据**，
 *     也**不是安全边界**（docs/architecture.md §2.4 收窄口径已写明：
 *     真正的权益判定必须在服务端 /api/me，本期只是先把「唯一出口」留出来）。
 *
 * 与本文件配套的规矩（后面所有页面都要守）：
 *   1. 页面不许直接读 `tier` 做判断，一律走 `Entitlement.can(cap)`
 *   2. 任何「拦住用户」的提示文案，都由 `denyReason()` 出，页面不自造
 *   3. 未登录（游客/本机账号会话失效）与 free 是**两回事**：
 *      游客不能语音播放，free 可以 —— 这是用户 2026-09-15 的裁决
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Entitlement = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var NS = "poem_plan_v1";        // 账号侧：本机会话的层级（1 期改为 /api/me 下发）
  var GRANT_NS = "poem_plan_grant_v1";  // 管理员侧：本机发放名单（可导出粘贴）
  var OWNER_NS = "poem_owner_v1";       // 管理员侧：本机主人标记（谁能进 /admin/）

  var TIERS = ["free", "pro", "max"];

  /** 角色与层级是两条正交的轴：店长不是 VIP（role 管管理，tier 管能力） */
  var ROLES = ["owner", "admin", "user"];

  /**
   * 能力清单 —— 这里是全站唯一的功能矩阵。
   *
   * 分级原则（用户已确认「free 不残缺」）：
   *   · free = 今天能用的东西**一件都不收回**（261 首课内 + 2320 篇集子 + 排程 + 注音 + 语音）
   *   · pro / max 只加「新能力」与「额度」，不拿现有功能当人质
   *   · 唯独一条例外是用户 2026-09-15 明确要求的：**语音播放要求登录**，
   *     未登录（游客）不可用，登录后的 free 可以
   *
   * minTier 之外的两个字段：
   *   login  = true 表示「必须登录」——游客拿不到，free 登录后就能拿到
   *   quota  = 额度（null = 不限；数字 = 每月次数）；本期只做展示，不做计数
   */
  var CAPS = {
    /* ⚠️ 名字被用户改过一次（2026-09-18，Issue #163）：对比页那一列字数长了
       「功能列就占掉半屏」，用户逐个点名要短名 —— 见每条上面的改名注。
       规则只有一条：**短到能在一列里放下，且不许因为短而含糊**。 */
    "recite.basic":      { minTier: "free", login: false, quota: null, name: "每日背诵" },
    /* 「六部集子全文阅读」→「课外阅读」（用户原话）；
       ⚠️ 短名不改内容：六部集子照旧**全文**开放（docs §2.4「免费不残缺」）。 */
    "library.all":       { minTier: "free", login: false, quota: null, name: "课外阅读" },
    /* 「语音朗读（原文 / 译文 / 连读）」→「语音朗读」—— 括号里那三种读法
       是这一条**是什么**，不是**能不能用**；对比表只回答后者。 */
    "read.aloud":        { minTier: "free", login: true,  quota: null, name: "语音朗读" },
    "pinyin.helper":     { minTier: "free", login: false, quota: null, name: "阅读辅助" },
    "export.progress":   { minTier: "free", login: false, quota: null, name: "进度导出" },
    /* 自选清单 —— 用户 2026-09-18 裁决（Issue #163）：
       「自选清单 20 个 改成 自选清单 Free 10个，pro 100个，max 5000个，
        直接在各列列出数字，这个需要改功能代码或者数据」
       → 三档额度**真的是** 10 / 100 / 5000（不只是表格上的字）：
         `quota` 是同一个数的唯一来源，js/collections.js 的 limit() 读它。
       ⚠️ Free 由 1 提到 10（用户点名），Max 由「不限」改成 5000（有天花板的
         数字可比「不限」在表格里更好看明白，也不会变成真正无限）。
       ⚠️ 9000 行以上的大数不写成 `5,000` —— 表格里带千分位会被读成两个数。 */
    "collections.many":  { minTier: "pro",  login: true,  quota: null, name: "自选清单",
                           quotas: { free: 10, pro: 100, max: 5000 } },
    "sync.multiDevice":  { minTier: "pro",  login: true,  quota: null, name: "设备同步" },
    "export.paper":      { minTier: "pro",  login: true,  quota: null, name: "PDF / 打印" },
    /* 家庭子用户 —— 用户 2026-09-17 裁决「子用户 Max 180 个」，
       2026-09-18 又把名字里的括号摘掉（Issue #163：「在各列列出支持的数字」）：
       三档数字与自选清单走同一套 `quotas`，表格里才有一列可对齐。
       ⚠️ Issue #209：名字一度是「子用户」，与设置页那一块的标签「子档案」
          对不上。用户点名「档案」这个词没人懂 → 两处一起收成**子用户**。 */
    "profile.family":    { minTier: "pro",  login: true,  quota: null, name: "子用户",
                           quotas: { free: 1, pro: 3, max: 180 } },

    "quiz.review":       { minTier: "pro",  login: true,  quota: null, name: "题库" },
    /* ⚠️ `export.all` 的门槛与名字**被用户改过一次**（2026-09-16，Issue #159）：
       「为啥要有全站批量导出功能？这不是这个网站的核心资产吗？
        顶多支持学校课本部分的全部导出。这个 pro 用户就行。」
       → 名字从「全站批量导出」改成「全站课内诗词批量导出」（内容 = 课内 261 首），
         门槛从 **max 降到 pro**；六部集子**不做**一次性整本导出。
       ⚠️ 名字、门槛、内容三处必须一起改：名字里写着「全站」而实际只给课内，
         服务端下发的那份 features 与这张表就会开始说谎（两端有逐字对拍）。
       ⚠️ 这条**不是**「保留旧名字但缩水」—— 见 js/export-core.js 文件头。
       2026-09-18（Issue #163）名字再收成「课内诗词导出」，**261 首挪进 quotas**
       —— 用户原话「pro 和 max 列列出 261 首」：数字归右边四列，不归功能名。 */
    "export.all":        { minTier: "pro",  login: true,  quota: null, name: "课内诗词导出",
                           quotas: { free: 0, pro: 261, max: 261 } },
    /* 古诗词大会那几项 —— **归 Max**（用户 2026-09-17 裁决：
       「现场考试和飞花令归 max 所有，题库归 pro」）。
       ⚠️ 与 docs/auth-design.md §3.5 那张老表（「飞花令 / 古诗文大会 / 考试与题库」
          一律 pro 起）相比，这几条**上收到 max**，以用户裁决为准。
       ⚠️ 服务端的 featuresFor() 用的就是这几个键名（有对拍断言守着）。
       2026-09-18（Issue #163）：`exam.paper` 的名字里带了一个 `·`，对比表那一列
       一折行就成了「古诗词大会 ·」/「现场考试」—— 先把名字收成一个词（「试题模拟」），
       由展示层分两行写。
       ⚠️⚠️ 2026-09-19 用户把那个折中**否掉了**（Issue #163 最后一条）：
          「是要拆成两个表格行，不是换行 这是两个功能，一个是古诗词大会的集子的
           访问权限，一个是在线试题模拟的权限」
        → 于是这里**真的拆成两条能力**（不是一个格子里的两行字）：
            · `exam.gathering` —— 《古诗词大会》那个**集子**的访问权限
            · `exam.paper`     —— 在线**试题模拟**（出题 · 判分）
          对比表上因此是两行，各自带自己的钩叉 —— 而原先它们是同一个格子，
          一格的钩叉答不了两个问题（能进集子 ≠ 能考试）。
       ⚠️ 键名 `exam.paper` 一个字都没动（服务端 featuresFor 与 js/game.js 靠它对拍）——
          「试题模拟」本来就是它一直在答的那件事，改的只是旁边多出来的那一条。 */
    "feihualing":        { minTier: "max",  login: true,  quota: null, name: "飞花令" },
    "exam.gathering":    { minTier: "max",  login: true,  quota: null, name: "古诗词大会" },
    "exam.paper":        { minTier: "max",  login: true,  quota: null, name: "试题模拟" }
    /* ⚠️ `collections.unlimited` 已**删除**（用户 2026-09-18，Issue #163：
       「自选清单不限 删除，已经被前面的自选清单代替」）。
       Max 的额度由 `collections.many` 的 quotas.max = 5000 表达 ——
       同一个东西不留两条能力（两条必然开始各说各的）。
       ⚠️ 服务端 featuresFor() 的 max 那一档同步删掉这个键（有对拍断言守着）。 */
    /* ⚠️ 这里**没有** `ai.explain` / `ai.explain.big` —— 它们已被**删除**。
       用户 2026-09-17 裁决：「把需要收我 app 费用的功能删除，我不会去做」。
       AI 讲解 / 背诵纠音是「每调一次都要真花钱」的那一类（调用 AI 商按次计费），
       与「本站不收款、层级不是付费凭据」放在一起就是「每被用一次亏一次」。
       所以不是「暂缓」，是从能力表里**拿掉**：界面不会点亮它、对比表不会列出它、
       服务端 featuresFor() 不会下发它（两端逐字对拍有断言守着）。
       ⚠️ 不要以任何名义把它加回来（免费额度也不行）—— 那是同一笔账。 */
  };

  /**
   * 层级别名：只用于「同一件事的同一个额度档，名称写法不同」这类情况。
   * ⚠️ 不许拿它去表达「额度不同」——曾有一对 `ai.explain`（pro，50 次）与
   * `ai.explain.big`（max，500 次）互为别名，结果 pro 也拿到了 500 次档
   * （测试里那条「pro 不能蹭 max 的额度」就是这么顶回来的）。
   * 那一对本身已在用户 2026-09-17 的裁决下**删除**（见 CAPS 末尾那条注释）。
   * 额度不同 = 两条独立的能力，各自带 minTier 与 quota。
   */
  var ALIAS = {};

  function tierIndex(t) {
    var i = TIERS.indexOf(t);
    return i < 0 ? 0 : i;                     // 脏值一律按 free 处理，不抛
  }

  function isTier(t) { return TIERS.indexOf(t) >= 0; }
  function isRole(r) { return ROLES.indexOf(r) >= 0; }

  /* ------------------------------------------------------- 本机发放名单 */

  function emptyGrants() { return { v: 1, grants: [] }; }

  /**
   * 读发放名单。任何解析失败 / 形状不对 → 回落空名单，绝不抛。
   * @param {Storage} backing localStorage 或任何 getItem/setItem 实现
   */
  function readGrants(backing) {
    if (!backing) return emptyGrants();
    var text = null;
    try { text = backing.getItem(GRANT_NS); } catch (e) { return emptyGrants(); }
    if (!text) return emptyGrants();
    var o = null;
    try { o = JSON.parse(text); } catch (e) { return emptyGrants(); }
    if (!o || typeof o !== "object" || !Array.isArray(o.grants)) return emptyGrants();
    return o;
  }

  function writeGrants(backing, data) {
    if (!backing) return false;
    try { backing.setItem(GRANT_NS, JSON.stringify(data || emptyGrants())); return true; }
    catch (e) { return false; }
  }

  /**
   * 归一化一条发放记录。非法 tier / 缺掩码 → 直接丢掉（不是回落 free，
   * 因为「一条写错的记录」不该悄悄生效成任何层级）。
   */
  function normGrant(g) {
    if (!g || typeof g !== "object") return null;
    var mask = String(g.emailMask == null ? "" : g.emailMask).trim().toLowerCase();
    if (!mask || !isTier(g.tier)) return null;
    var until = g.until == null ? null : Number(g.until);
    if (until !== null && !isFinite(until)) until = null;
    return {
      emailMask: mask, tier: g.tier, until: until,
      by: String(g.by || "").slice(0, 24),
      at: Number(g.at) || 0,
      note: String(g.note == null ? "" : g.note).slice(0, 60)
    };
  }

  /** 管理员发放：同一掩码只保留最新一条 */
  function putGrant(backing, grant) {
    var g = normGrant(grant);
    if (!g) return { ok: false, code: "E_GRANT", message: "发放记录不完整：需要邮箱掩码与层级" };
    var data = readGrants(backing);
    data.grants = data.grants
      .map(normGrant)
      .filter(function (x) { return x && x.emailMask !== g.emailMask; });
    data.grants.push(g);
    writeGrants(backing, data);
    return { ok: true, grant: g };
  }

  function removeGrant(backing, mask) {
    var m = String(mask == null ? "" : mask).trim().toLowerCase();
    var data = readGrants(backing);
    var before = data.grants.length;
    data.grants = data.grants.map(normGrant).filter(function (g) { return g && g.emailMask !== m; });
    writeGrants(backing, data);
    return { ok: true, removed: before - data.grants.length };
  }

  function clearGrants(backing) {
    writeGrants(backing, emptyGrants());
    return { ok: true };
  }

  /** 名单可导出 / 粘贴（本期「发给别人」的诚实做法：对方自己导入） */
  function exportGrants(backing) {
    return JSON.stringify(readGrants(backing), null, 2);
  }

  function importGrants(backing, text) {
    var o = null;
    try { o = JSON.parse(text); } catch (e) { return { ok: false, code: "E_JSON", message: "名单格式不正确" }; }
    if (!o || typeof o !== "object" || !Array.isArray(o.grants)) {
      return { ok: false, code: "E_JSON", message: "名单格式不正确" };
    }
    var clean = o.grants.map(normGrant).filter(Boolean);
    writeGrants(backing, { v: 1, grants: clean });
    return { ok: true, count: clean.length };
  }

  /**
   * 按邮箱掩码匹配名单（本期「认领」的方式：登录取到掩码后再匹配一次）。
   * 已过期（until 早于 now）的记录不生效。
   */
  function grantFor(backing, mask, ts) {
    var m = String(mask == null ? "" : mask).trim().toLowerCase();
    if (!m) return null;
    var t = typeof ts === "number" ? ts : Date.now();
    var hit = readGrants(backing).grants
      .map(normGrant)
      .filter(function (g) { return g && g.emailMask === m; });
    if (!hit.length) return null;
    var g = hit[hit.length - 1];                 // 同掩码只留最新，这里仍取最后一条
    if (g.until != null && g.until <= t) return null;
    return g;
  }

  /* ---------------------------------------------------------- 管理员（谁能管理） */

  /**
   * **谁能进管理后台** —— 这是全站唯一回答这个问题的函数。
   *
   * 为什么单独一个键（`poem_owner_v1`）而不是复用层级：
   *   店长不是 VIP。`role` 管「谁能管理」，`tier` 管「能用什么」，
   *   两条正交的轴。把管理员塞进 `tier: "max"` 里，等于说「买了 Max 就能
   *   给别人发权限」，那是两件完全不同的事，日后做收费时必然出事。
   *
   * **首次打开的浏览器自动成为本机主人**（幂等：标记一旦落下就不再变）。
   * 理由：本期没有服务端，「你就是唯一的权威」—— 没有这个兜底，
   * `/admin/` 会永远对所有人关着，那一页等于不存在。
   * 1 期接服务端后，本函数改为读 `/api/me` 的 `role` 字段，页面一行不动。
   *
   * ⚠️ 与层级同理：本期这是**本机登记**，手改存储就能骗过它。
   *    所以它只用于「谁能进这一页」，**不作为任何安全边界**（文档 §3.4）。
   */
  function isOwner(backing, opt) {
    var opt2 = opt || {};
    /* 服务端下发的 role **优先**（2 期「补洞」已接通 `/api/me`）。
       ⚠️ 只在传了明确角色时生效，且 `"user"` 也算明确 —— 但调用方若把
          `identity().role` 原样传回来（那个值本来就是本函数算出来的），
          这里会退化成「自己问自己」。所以调用方要么不传，要么传服务端来的值；
          `identity()` 内部传的是 **`readServerRole()` 读出来的那份**（不是它自己算的）；
          `js/profile.js` 与 `js/admin-page.js` 仍然不传。 */
    if (opt2.role && isRole(opt2.role)) return opt2.role === "owner" || opt2.role === "admin";
    var b = backing || defaultBacking();
    if (!b) return true;                 // 没有任何存储（隐私模式）：不给落标记，也不拦人
    var raw = null;
    try { raw = b.getItem(OWNER_NS); } catch (e) { raw = null; }
    return raw == null || raw === "" || raw === "owner";
  }

  /** 把「本机主人」这个标记落下（幂等；只有管理员入口与初始化会调它） */
  function markOwner(backing) {
    var b = backing || defaultBacking();
    if (!b) return { ok: false };
    try { b.setItem(OWNER_NS, "owner"); return { ok: true }; } catch (e) { return { ok: false }; }
  }

  /* ---------------------------------------------------------- 层级缓存 */

  /** 读 `poem_plan_v1` 那一份原始对象（解析失败一律 null，绝不抛） */
  function readPlan(backing) {
    if (!backing) return null;
    var text = null;
    try { text = backing.getItem(NS); } catch (e) { return null; }
    if (!text) return null;
    var o = null;
    try { o = JSON.parse(text); } catch (e) { return null; }
    return o && typeof o === "object" ? o : null;
  }

  /**
   * 本机层级缓存。
   *
   * ⚠️ **不含**服务端那一份的判据 —— 服务端那份由 `readServerTier()` 单独回答。
   *    两个问题刻意分开，是因为它们的**权威性不同**：
   *      · 本机这份：手改一行存储就能改（所以它只是「提示」）
   *      · 服务端那份：`source === "server"` 标记过，来自 `/api/me`
   *    合在一个函数里读，调用方就再也分不清自己拿到的是哪一种。
   */
  function readTier(backing) {
    var o = readPlan(backing);
    if (!o) return "free";
    var until = o.until == null ? null : Number(o.until);
    if (until !== null && isFinite(until) && until <= Date.now()) return "free";   // 到期即回落
    return isTier(o.tier) ? o.tier : "free";
  }

  /**
   * **服务端下发的层级**（2 期「补洞」）。
   *
   * 判据只有一条：那份缓存带着 `source: "server"` —— 它是由
   * `js/auth-api.js` 的 `me()` 成功返回后写下来的，别处不写。
   * 于是「本机发放名单写的那一份」（无 source）不会被误当成权威判定。
   *
   * 过期（`until` 早于现在）→ 回落 free，与 `readTier` 同口径。
   */
  function readServerTier(backing) {
    var o = readPlan(backing);
    if (!o || o.source !== "server") return null;
    var until = o.until == null ? null : Number(o.until);
    if (until !== null && isFinite(until) && until <= Date.now()) return "free";
    return isTier(o.tier) ? o.tier : null;
  }

  /** 服务端下发的角色（`/api/me` 的 `role`）。没有就是 null，本机兜底照旧 */
  function readServerRole(backing) {
    var o = readPlan(backing);
    if (!o || o.source !== "server") return null;
    return isRole(o.role) ? o.role : null;
  }

  /** 当前层级是谁定的 —— 给界面如实标注用的，不是判权依据 */
  function tierSource(backing) {
    var o = readPlan(backing);
    return o && o.source === "server" ? "server" : "local";
  }

  /**
   * 写层级缓存。
   *
   * @param {Object} opt  { source: "server", role: "user" }
   *   `source:"server"` 表示这一份来自 `/api/me`，页面上据此标注来源，
   *   而 `identity()` 也据此决定「服务端优先」。
   */
  function writeTier(backing, tier, until, opt) {
    if (!backing) return { ok: false, code: "E_STORAGE", message: "浏览器不允许保存数据" };
    if (!isTier(tier)) return { ok: false, code: "E_TIER", message: "不认识的层级" };
    var o = opt || {};
    var payload = { v: 1, tier: tier, until: until == null ? null : Number(until) };
    if (o.source) payload.source = String(o.source);
    if (o.role && isRole(o.role)) payload.role = o.role;
    try { backing.setItem(NS, JSON.stringify(payload)); } catch (e) {
      return { ok: false, code: "E_STORAGE", message: "浏览器不允许保存数据" };
    }
    return { ok: true };
  }

  function clearTier(backing) {
    if (!backing) return { ok: false };
    try { backing.removeItem(NS); } catch (e) { /* 隐私模式：忽略 */ }
    return { ok: true };
  }

  /* ------------------------------------------------------------ 判定 */

  function cap(name) {
    var key = Object.prototype.hasOwnProperty.call(ALIAS, name) ? ALIAS[name] : name;
    return CAPS[key] || null;
  }

  /** 全部能力名（含别名），供 /profile/ 与测试遍历 */
  function capNames() {
    var out = Object.keys(CAPS);
    Object.keys(ALIAS).forEach(function (a) { if (out.indexOf(a) < 0) out.push(a); });
    return out.sort();
  }

  /**
   * 唯一出口。
   * @param {string} name  能力名，见 CAPS
   * @param {Object} ctx   { tier, signedIn } —— tier 缺省按 free
   * @returns {{ok:boolean, reason:string, minTier:string, quota:number|null, name:string}}
   *          reason: "ok" | "unknown" | "login" | "tier"
   */
  function can(name, ctx) {
    var c = cap(name);
    var k = ctx || {};
    var tier = isTier(k.tier) ? k.tier : "free";
    var signedIn = !!k.signedIn;

    if (!c) {
      return { ok: false, reason: "unknown", minTier: "free", quota: null, name: "" };
    }
    if (c.login && !signedIn) {
      return { ok: false, reason: "login", minTier: c.minTier, quota: c.quota, name: c.name };
    }
    if (tierIndex(tier) < tierIndex(c.minTier)) {
      return { ok: false, reason: "tier", minTier: c.minTier, quota: c.quota, name: c.name };
    }
    return { ok: true, reason: "ok", minTier: c.minTier, quota: c.quota, name: c.name };
  }

  /** 拦住用户时该说的话 —— 页面不自造文案，保证全站口径一致
   *
   *  ⚠️ 门槛那两句是「**Pro 起**」/「**Max 起**」（用户 2026-09-17 点名）——
   *     原文案是「Pro 起可用」/「Max 起可用」，「可用」二字是废话：
   *     这句话本身就只在「不能用」时说，再补一句「可用」既绕口又容易
   *     被读成「开通后就能用了」以外的意思。这里只留门槛，不加尾巴。 */
  function denyReason(name, ctx) {
    var r = can(name, ctx);
    if (r.ok) return "";
    if (r.reason === "unknown") return "这个功能暂不可用";
    if (r.reason === "login") return "登录可用";
    return r.minTier === "max" ? "Max 起" : "Pro 起";
  }

  /** 分层徽章文案，供 /profile/ 顶部展示 */
  function tierLabel(tier) {
    var t = isTier(tier) ? tier : "free";
    return t === "max" ? "Max" : t === "pro" ? "Pro" : "Free";
  }

  /**
   * 能力清单（给 /profile/ 的「权限」一节用）：一条一事，能用的打勾、不能用的写门槛。
   * 返回顺序 = CAPS 的声明顺序（先免费后付费，读起来像菜单）。
   */
  function matrix(ctx) {
    return Object.keys(CAPS).map(function (k) {
      var c = CAPS[k];
      var r = can(k, ctx);
      return {
        cap: k, name: c.name, ok: r.ok, reason: r.reason,
        minTier: c.minTier, quota: c.quota,
        hint: r.ok ? (c.quota ? "每月 " + c.quota + " 次" : "") : denyReason(k, ctx)
      };
    });
  }

  /* ------------------------------------------- 四列（含「未登录」）横向对比 */

  /**
   * 对比页的四列。
   *
   * 前三列是**同一个人升到不同层级**（都按已登录算），第一列是**没登录的游客**。
   * 为什么不把「未登录」写成第四列：游客不是一个层级，`tier` 无论如何都是 free，
   * 他和「登录的 free」之间差的是 `signedIn` 那个布尔 —— 这里把它显式做成
   * 一列（`guest: true`），页面上就不必自己拼 ctx（拼 ctx 正是要收口的东西）。
   */
  var COLUMNS = [
    { id: "guest", tier: "free", guest: true  },
    { id: "free",  tier: "free", guest: false },
    { id: "pro",   tier: "pro",  guest: false },
    { id: "max",   tier: "max",  guest: false }
  ];

  /**
   * 列标题文案 —— 与 tierLabel 同源，不在这里另起一套大小写。
   *
   * ⚠️ 游客那一列写作「**游客**」而不是「未登录」（用户 2026-09-18，Issue #163：
   *   「未登录 / 你现在在这里」→「游客 / 现在」）。
   *   含义一个字都没变（`guest` 那个布尔还是同一个），只是不再把「你没登录」
   *   这句操作状态当身份名念 —— 身份名是「游客」。
   */
  function columnLabel(col) {
    if (!col) return "";
    if (col.guest) return "游客";
    return tierLabel(col.tier);
  }

  /**
   * 这一档的能力额度（数字 / Infinity 表示不限 / null 表示「这条能力没有额度可言」）。
   *
   * 两种写法**各有各的用处**，不是重复：
   *   · `quota`  —— 「每月 50 次」这种**次数**限制，全站一张值（TTS 之类）；
   *   · `quotas` —— 「Free 10 / Pro 100 / Max 5000」这种**逐档不同**的容量上限。
   * 后者是同一个数的唯一来源：`js/collections.js` 的 `limit()`、
   * `js/family.js` 的 `limit()` 都读它 —— 表格上那个数字与实际能建几个
   * 是**同一个数**，不靠人抄对。
   *
   * ⚠️ 找不到 `quotas` 就回落到 `quota`（`null` = 没有额度），不抛。
   */
  function quotaFor(c, tier) {
    if (!c) return null;
    if (c.quotas && typeof c.quotas === "object") {
      if (!isTier(tier)) return null;
      var v = c.quotas[tier];
      return typeof v === "number" ? v : null;
    }
    return c.quota == null ? null : c.quota;
  }

  /** 额度的人话。不写千分位（`5,000` 在窄格子会被读成两个数） */
  function quotaText(amount) {
    if (amount === Infinity) return "不限";
    if (amount === 0) return "不支持";
    return String(amount) + " 个";
  }

  /**
   * 四列能力对比（给 /plans/ 对比页用）。
   *
   * 一条能力一行、一行四格，**每格都是当场问 `can()` 算出来的**，不是手抄的表。
   * 手抄一份的下场：内核加了能力、改了门槛，对比页还是老话 ——
   * 而对比页恰恰是用户唯一会逐条对着看的页面。
   *
   * 返回：
   *   cols   —— 四列的 id / 是否游客 / 层级 / 标题
   *   rows   —— 一条能力一行：{cap, name, quota, cells: [{ok, reason, hint}…]}
   *             cells 的下标与 cols 一一对应
   *   groups —— 一次对比刚好够用的三个分组（一行都不重不漏）
   *   summary—— 每列「能用几项 / 共几项」，给表尾那一行用
   *
   * @param {Object} o { now }   —— 目前只认 now，将来核对「已经买到的层级」时再扩
   */
  function compare(o) {
    var opt = o || {};
    var now = typeof opt.now === "number" ? opt.now : undefined;

    var cols = COLUMNS.map(function (c) {
      return { id: c.id, guest: !!c.guest, tier: c.tier, label: columnLabel(c) };
    });

    var rows = Object.keys(CAPS).map(function (k) {
      var c = CAPS[k];
      var cells = COLUMNS.map(function (col) {
        // 游客列看的是「没登录」那一刻的能力 —— 与 /profile/ 顶部那句
        // 与个人中心那颗登录键的理由必须是同一个答案，所以两边都走 can()。
        var ctx = { tier: col.tier, signedIn: !col.guest };
        if (now !== undefined) ctx.now = now;
        var r = can(k, ctx);
        /* 额度：`quotas` 逐档写着数字的能力（自选清单 / 子用户 / 课内诗词导出）
           直接报**这一档的数字**；`quota` 那种「每月 N 次」的限制照旧。
           额度的读法只有这一处 —— 页面不自己挑字段、也不自己拼「个 / 次」。 */
        var amount = quotaFor(c, col.tier);
        return {
          ok: r.ok,
          reason: r.ok ? "ok" : r.reason,
          quota: amount,
          // 能用的格子：额度数字就是全部信息，没有额度才是空的；
          // 不能用的那一格写清是什么拦的（层级 / 未登录）。
          hint: r.ok
            ? (amount == null ? (c.quota ? "每月 " + c.quota + " 次" : "") : quotaText(amount))
            : denyReason(k, ctx)
        };
      });
      return { cap: k, name: c.name, quota: c.quota, quotas: c.quotas || null,
               unit: c.unit || "", minTier: c.minTier, cells: cells };
    });

    // 分组：只按「这一行从哪一列起全绿」切三刀。能力表本身就是「先免费后付费」
    // 声明的，所以同一个门槛的能力天然是连续的，这里不必再做排序（也不能做 ——
    // 换个顺序就等于替内核重新排了一次优先级）。
    var groups = [];
    var byMin = { free: [], pro: [], max: [] };
    rows.forEach(function (r) {
      (byMin[r.minTier] || byMin.free).push(r);
    });
    [
      /* Issue #163：三组的注解原先各是一句「把表再说一遍」的话
         （「免费且不缩水 —— 课内 261 首、六部集子…一件都不收回」之类），
         用户点名的就是这种。分组名自己已经说完，注解只留一句还有信息量的。 */
      { key: "free", title: "所有版本都有" },
      { key: "pro", title: "Pro 起" },
      { key: "max", title: "Max 起" }
    ].forEach(function (g) {
      if (byMin[g.key].length) groups.push({ key: g.key, title: g.title, note: g.note, rows: byMin[g.key] });
    });

    /* 表尾：这一列有几格是绿的。
       ⚠️ 这一行原先写作「能用」（Issue #163 改称「**合计**」）—— 用户原话
          「能用 改成 合计」。同一个数，不再借「能用」那个词去表态。 */
    var summary = cols.map(function (col, i) {
      var on = 0;
      rows.forEach(function (r) { if (r.cells[i] && r.cells[i].ok) on += 1; });
      return { id: col.id, label: col.label, ok: on, total: rows.length };
    });

    return { cols: cols, rows: rows, groups: groups, summary: summary };
  }

  /* -------------------------------------------------------- 本机分层 */

  /**
   * 把「会话 + 名单」合成当前身份。**页面上只准用它，不准自己拼 ctx。**
   * @param {Object} o  { authStore, backing, now }
   *   authStore = AuthCore.makeStore(...) 的产物（可空）
   */
  function identity(o) {
    var opt = o || {};
    var backing = opt.backing || defaultBacking();
    var t = typeof opt.now === "number" ? opt.now : Date.now();

    // authStore 不传就自己拿一个：页面上写 `Entitlement.identity()` 才是常态，
    // 若要求每个调用方都自己造 store，早晚会有人忘（忘了的症状是「永远游客」）。
    var authStore = opt.authStore || (function () {
      var g = typeof globalThis !== "undefined" ? globalThis : null;
      var A = (g && g.AuthCore) || null;
      try { return A && A.makeStore ? A.makeStore(backing) : null; } catch (e) { return null; }
    })();

    var uid = "", mask = "", signedIn = false;
    /* 服务端下发的那一份（2 期「补洞」新增，`poem_plan_v1` 的 `source:"server"` 段）。
       它是**唯一**能把服务端判定的层级/角色带上页面的通道：
         · 层级：服务端说了算（docs §2.4 第 8 条），本机键只当缓存
         · 角色：`/api/me` 的 `role` 是 owner 时，本机那个「谁打开谁是主人」
           的兜底就必须让位 —— 否则一个把储存改空的游客照样是 owner。
       ⚠️ 只在 `source === "server"` 时认它。本机发放名单写进来的那一份
          （source 缺省）不被当作权威，走的还是下面那套本机口径。 */
    var serverTier = readServerTier(backing);
    var serverRole = readServerRole(backing);

    // 角色：服务端优先，本机兜底（`isOwner` 现在接受明确传入的角色）
    var role = isOwner(backing, serverRole ? { role: serverRole } : undefined)
      ? (serverRole === "owner" || serverRole === "admin" ? serverRole : "owner")
      : "user";
    if (authStore) {
      var s = null;
      try { s = authSession(authStore); } catch (e) { s = null; }
      if (s && s.account) {
        signedIn = true;
        uid = s.account.uid || "";
        var ids = s.account.identities || [];
        for (var i = 0; i < ids.length; i++) {
          if (ids[i] && ids[i].mask) { mask = ids[i].mask; break; }
        }
        // 账号记录里的层级（若该账号已领取过名单，创建账号时已写回）
        var accTier = s.account.plan && s.account.plan.tier;
        if (isTier(accTier) && accTier !== "free") {
          return finish(accTier, signedIn, uid, mask, role, "local");
        }
        // 服务端下发的层级**优先于**本机发放名单（它才是权威判定）
        if (serverTier && serverTier !== "free") {
          return finish(serverTier, signedIn, uid, mask, role, "server");
        }
      }
    }

    // 未登录，或账号层级还是 free：再看本机层级与发放名单
    var tier = readTier(backing);
    // 服务端下发的层级仍然优先（哪怕当下没登录 —— 例如会话刚过期、
    // 但那一份判定还在缓存里；它比手改本机存储可信）
    if (serverTier && tierIndex(serverTier) > tierIndex(tier)) tier = serverTier;
    if (signedIn) {
      var g = grantFor(backing, mask, t);
      if (g && tierIndex(g.tier) > tierIndex(tier)) tier = g.tier;
    }
    return finish(tier, signedIn, uid, mask, role,
      serverTier && tierIndex(serverTier) >= tierIndex(tier) ? "server" : "local");
  }

  /** 默认存储：浏览器里就是 localStorage；Node / 隐私模式下给不了就返回 null（不抛） */
  function defaultBacking() {
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    if (!g) return null;
    try {
      return g.localStorage && typeof g.localStorage.getItem === "function" ? g.localStorage : null;
    } catch (e) {
      return null;                          // 隐私模式下取用即抛
    }
  }

  /**
   * AuthCore 的会话读取。
   *
   * ⚠️ 这里**必须用 globalThis，不能写 `window.AuthCore`**：
   *    本文件在 jsdom（测试）里是作为主 realm 的模块被求值的，
   *    写 `window` 时 iframe / 多 realm 场景下会解析到**另一个 realm 的 window**，
   *    结果是「页面里明明有 window.AuthCore，这里却读到 null」——
   *    症状是全站永远判成游客，语音播放大门永远关着，而且不报任何错。
   *    globalThis 在所有运行环境（浏览器 / jsdom / Node）都指向当前 realm，不会错。
   */
  var authSession = function (authStore) {
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    var A = (g && g.AuthCore) || null;
    if (A && A.session) return A.session(authStore);
    return null;
  };

  /** 允许外部注入 AuthCore（Node 测试 / 未来换实现时用） */
  function setAuthCore(A) {
    authSession = function (authStore) { return A && A.session ? A.session(authStore) : null; };
  }

  /**
   * @param {string} tierSource  "server" | "local" —— 这个层级是**谁定的**。
   *   界面据此如实标注（「由服务器判定」/「本机登记」），
   *   而**不是**拿它当判权依据 —— 判权只看 tier 与 signedIn。
   */
  function finish(tier, signedIn, uid, mask, role, tierSource) {
    var ctx = { tier: tier, signedIn: signedIn };
    return {
      uid: uid, mask: mask, signedIn: signedIn, tier: tier, role: role,
      tierSource: tierSource || "local",
      label: tierLabel(tier),
      ctx: ctx,
      can: function (name) { return can(name, ctx); },
      hint: function (name) { return denyReason(name, ctx); }
    };
  }

  /** 游客身份（没有任何存储也不许抛） */
  function guestIdentity() { return finish("free", false, "", "", "user", "local"); }

  return {
    NS: NS, GRANT_NS: GRANT_NS, OWNER_NS: OWNER_NS,
    TIERS: TIERS, ROLES: ROLES, CAPS: CAPS, ALIAS: ALIAS,
    capNames: capNames, cap: cap, can: can, denyReason: denyReason,
    tierLabel: tierLabel, matrix: matrix, compare: compare, COLUMNS: COLUMNS,
    quotaFor: quotaFor, quotaText: quotaText, columnLabel: columnLabel,
    isTier: isTier, isRole: isRole,
    tierIndex: tierIndex,
    emptyGrants: emptyGrants, readGrants: readGrants, writeGrants: writeGrants,
    normGrant: normGrant, putGrant: putGrant, removeGrant: removeGrant,
    clearGrants: clearGrants, exportGrants: exportGrants, importGrants: importGrants,
    grantFor: grantFor,
    readTier: readTier, writeTier: writeTier, clearTier: clearTier,
    readPlan: readPlan, readServerTier: readServerTier,
    readServerRole: readServerRole, tierSource: tierSource,
    isOwner: isOwner, markOwner: markOwner,
    identity: identity, guestIdentity: guestIdentity, setAuthCore: setAuthCore,
    defaultBacking: defaultBacking
  };
});
