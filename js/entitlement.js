(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Entitlement = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // 本机只剩**一份**权益键（Issue #276）：`poem_plan_v1` 是**服务端答案的缓存**
  // （离线也能按上一次的层级放行），不是「你在这儿登记自己是 Pro」。
  // 原先那两份本机的都删了：
  //   · `poem_plan_grant_v1` —— 「本机发放名单」，要对方自己导入才生效、
  //     且对方改一行存储就能改。用户裁「走数据库的全部走数据库」，它整个下线。
  //   · `poem_owner_v1` —— 「谁打开谁是主人」的本机兜底，正是本轮要拆的东西：
  //     清一次浏览器存储就能当管理员的所谓权限，不是权限。
  var NS = "poem_plan_v1";

  var TIERS = ["free", "pro", "max"];

  var ROLES = ["owner", "admin", "user"];

  var CAPS = {

    "recite.basic":      { minTier: "free", login: false, quota: null, name: "每日背诵" },

    "library.all":       { minTier: "free", login: false, quota: null, name: "课外阅读" },

    "read.aloud":        { minTier: "free", login: true,  quota: null, name: "语音朗读" },
    "pinyin.helper":     { minTier: "free", login: false, quota: null, name: "阅读辅助" },
    // 进度导出（Issue #229 第二轮）：门槛从「打开即用」收到**登录可用** ——
    // 层级仍是 free（免费档登录后就给），但未登录不再放行。改这一行要同时改
    // api/_lib/core.js 的 featuresFor()（两端同源）。
    "export.progress":   { minTier: "free", login: true,  quota: null, name: "进度导出" },

    // 复习算法按层级开放（Issue #229 第四轮，用户原话）：
    //   「游客可以用艾宾浩斯遗忘曲线 / 登录 free 添加莱特纳盒 /
    //     pro 添加 SM-2 / max 再添加 FSRS 支持全部」
    // 四条各是一格（「一格说一件事」），念的是同一组的三个层级。
    // 键名 = "algo." + js/review-models.js 里那张模型的 key（内核据此发问）。
    // name 是**台账里的全名**（Issue #229 第六轮起改叫「艾宾浩斯遗忘曲线」，
    // 此前误写作「斯宾浩斯」）。
    // 对比表那格窄，靠 breaks 在指定处折行（第一行「艾宾浩斯」、第二行
    //保留「遗忘曲线」整词），名字本身一个字不改。
    "algo.ebbinghaus":   { minTier: "free", login: false, quota: null, name: "艾宾浩斯遗忘曲线",
                           breaks: ["遗忘曲线"] },
    "algo.leitner":      { minTier: "free", login: true,  quota: null, name: "莱特纳盒" },
    "algo.sm2":          { minTier: "pro",  login: true,  quota: null, name: "SM-2 复习" },
    "algo.fsrs":         { minTier: "max",  login: true,  quota: null, name: "FSRS 复习" },

    "collections.many":  { minTier: "pro",  login: true,  quota: null, name: "自选清单",
                           quotas: { free: 10, pro: 100, max: 5000 } },
    "sync.multiDevice":  { minTier: "pro",  login: true,  quota: null, name: "设备同步" },
    "export.paper":      { minTier: "pro",  login: true,  quota: null, name: "PDF / 打印" },

    "profile.family":    { minTier: "pro",  login: true,  quota: null, name: "子用户",
                           quotas: { free: 1, pro: 3, max: 180 } },

    "quiz.review":       { minTier: "pro",  login: true,  quota: null, name: "题库" },

    // 名字收成「课内诗词」（Issue #229 第五轮：动作「导出」挪到第二行，
    // 与设置页那一项同名），breaks 把「导出」顶下去。
    "export.all":        { minTier: "pro",  login: true,  quota: null, name: "课内诗词 导出",
                           breaks: ["导出"],
                           quotas: { free: 0, pro: 251, max: 251 } },

    "feihualing":        { minTier: "max",  login: true,  quota: null, name: "飞花令" },
    // 「古诗词」一行、「大会」一行（Issue #229 第五轮）。
    "exam.gathering":    { minTier: "max",  login: true,  quota: null, name: "古诗词 大会",
                           breaks: ["大会"] },
    "exam.paper":        { minTier: "max",  login: true,  quota: null, name: "试题模拟" }

  };

  var ALIAS = {};

  function tierIndex(t) {
    var i = TIERS.indexOf(t);
    return i < 0 ? 0 : i;
  }

  function isTier(t) { return TIERS.indexOf(t) >= 0; }
  function isRole(r) { return ROLES.indexOf(r) >= 0; }

  // 「谁能进管理后台」（Issue #276 重写）。
  //
  // 唯一权威是服务端下发到 `poem_plan_v1` 里的那个 `role`（源头是
  // 数据库 `accounts.role` 那一列）。这一版**删掉了本机兜底** ——
  // 老口径「没有标记 = 你是主人」让 `/admin/` 在没配服务端的机器上
  // 对每个打开它的人都开着，那是个**假的**安全边界。
  //
  // 四条现在的口径：
  //   · **有服务端答案就认它**：`role` 是 owner / admin 才放行。
  //   · **那份答案得是「当前这个人」的**（Issue #276 后续）：缓存里记着
  //     `uid`，与当前会话对不上就不认 —— 同一台机器换个人登录时，上一个人
  //     的 `role` 不许被继承。这是「未登录 / 非管理员时那颗键压根不显示」的
  //     关键一条：光看缓存里的 role，答的是「这台机器上最后一位管理员是谁」。
  //   · **没有服务端答案就不放行**（未登录 / 还没问到 / 服务端没配）——
  //     于是 `/admin/` 会如实说「请先登录，本站管理员由数据库里的角色决定」。
  //   · **不认识的角色一律 user**（与 `core.isAdminRole` 同源，有对拍断言）。
  function isOwner(backing, opt) {
    var opt2 = opt || {};
    var b = backing || defaultBacking();
    var plan = readPlan(b);

    // 调用方手里那份 uid（`mine.js` / `/admin/` 从会话里取的）优先；
    // 没传时自己去会话里问一次 —— 两个入口不许各判各的。
    var uid = opt2.uid !== undefined ? opt2.uid : sessionUid(b, opt2.authStore);

    // ⚠️ **先核对这份答案是不是当前这个人的，再看它说什么**。
    //    次序反过来的话（旧写法：`if (opt.role) return isAdminRole(opt.role)`），
    //    调用方从会话里读到的 `id.role` 就已经是缓存里那份「上一个人是 owner」
    //    的结论 —— 拿它当答案等于没核对，换个人登录照旧继承权限。
    if (!plan || plan.source !== "server" || !ownsPlan(plan, uid)) return false;
    return isAdminRole(plan.role);
  }

  // 当前会话的 uid（没有会话就空串）。`isOwner` 在调用方没传 uid 时用它，
  // 免得每个入口都要自己先把会话读一遍 —— 读两遍必然有人忘读一次。
  // 调用方手里已经有一份 `authStore` 时就用它（`identity()` 就是这么传进来的），
  // 没有才自己去造一份。
  function sessionUid(backing, authStore) {
    var store = authStore || null;
    if (!store) {
      var b = backing || defaultBacking();
      if (!b) return "";
      // ⚠️ 走**模块里那一份**工厂与 `authSession`（都会被 `setAuthCore` 换掉），
      //    不直接摸 `globalThis.AuthCore` —— 两处各读一次，注入的那一份
      //    就有一处读不到（先写的版本正是这么漏的，测试当场照出来了）。
      try { store = authStoreFactory(b); } catch (e) { store = null; }
    }
    if (!store) return "";
    var s = null;
    try { s = authSession(store); } catch (e) { s = null; }
    return (s && s.account && s.account.uid) || "";
  }

  function isAdminRole(role) {
    var r = String(role == null ? "" : role).trim().toLowerCase();
    return r === "owner" || r === "admin";
  }

  function readPlan(backing) {
    if (!backing) return null;
    var text = null;
    try { text = backing.getItem(NS); } catch (e) { return null; }
    if (!text) return null;
    var o = null;
    try { o = JSON.parse(text); } catch (e) { return null; }
    return o && typeof o === "object" ? o : null;
  }

  function readTier(backing) {
    var o = readPlan(backing);
    if (!o) return "free";
    var until = o.until == null ? null : Number(o.until);
    if (until !== null && isFinite(until) && until <= Date.now()) return "free";
    return isTier(o.tier) ? o.tier : "free";
  }

  function readServerTier(backing, uid) {
    var o = readPlan(backing);
    if (!o || o.source !== "server") return null;
    if (uid !== undefined && !ownsPlan(o, uid)) return null;
    var until = o.until == null ? null : Number(o.until);
    if (until !== null && isFinite(until) && until <= Date.now()) return "free";
    return isTier(o.tier) ? o.tier : null;
  }

  // 服务端那份答案「是不是**当前这个人**的」（Issue #276 后续）。
  //
  // 判据只有一条：缓存里的 `uid` 与当前会话的 uid **逐字相同**。
  //   · 两边都有且相同   → 是，认它。
  //   · 缓存里没有 uid   → **不认**（旧版本写下的、不知道是谁的那一份；
  //                        宁可让管理员重登一次，也不把别人的权限借给他）。
  //   · 当前没有登录     → **不认**（未登录的人不该继承上一个人的角色）。
  function ownsPlan(plan, uid) {
    if (!plan || plan.source !== "server") return false;
    var mine = String(uid == null ? "" : uid);
    if (!mine) return false;
    return String(plan.uid == null ? "" : plan.uid) === mine;
  }

  function readServerRole(backing, uid) {
    var o = readPlan(backing);
    if (!o || o.source !== "server") return null;
    if (uid !== undefined && !ownsPlan(o, uid)) return null;
    return isRole(o.role) ? o.role : null;
  }

  function tierSource(backing, uid) {
    var o = readPlan(backing);
    if (!o || o.source !== "server") return "local";
    if (uid !== undefined && !ownsPlan(o, uid)) return "local";
    return "server";
  }

  // ⚠️ 服务端那一份**必须记下它是谁的答案**（`uid`）。
  //
  // 起因（Issue #276 后续）：`poem_plan_v1` 是「服务端答案的缓存」，而它是
  // **按浏览器**存的，不是按账号存的。同一台机器上换个人登录（或退出后别人
  // 用），缓存里那行 `role: "owner"` 还是**上一个人的** —— 于是新登录的普通
  // 用户被当成管理员，「管理后台」那颗键照画不误。把那行答案和它的主人绑在
  // 一起，对不上就不认它（退回游客 / user），是这件事的唯一出口。
  function writeTier(backing, tier, until, opt) {
    if (!backing) return { ok: false, code: "E_STORAGE", message: "浏览器不允许保存数据" };
    if (!isTier(tier)) return { ok: false, code: "E_TIER", message: "不认识的层级" };
    var o = opt || {};
    var payload = { v: 1, tier: tier, until: until == null ? null : Number(until) };
    if (o.source) payload.source = String(o.source);
    if (o.role && isRole(o.role)) payload.role = o.role;
    if (o.uid) payload.uid = String(o.uid);
    try { backing.setItem(NS, JSON.stringify(payload)); } catch (e) {
      return { ok: false, code: "E_STORAGE", message: "浏览器不允许保存数据" };
    }
    announce();
    return { ok: true };
  }

  function clearTier(backing) {
    if (!backing) return { ok: false };
    try { backing.removeItem(NS); } catch (e) {  }
    announce();
    return { ok: true };
  }

  // 权益变了就喊一声（Issue #276 后续）。
  //
  // 为什么要有这一声：层级 / 角色是**异步到位**的（登录回来、`/api/me` 拉到
  // 角色），而按角色开关的界面（`/self-check/` 的入口那一行）在页面加载时
  // 就已经画过一遍了。不喊这一声，它一直停在「那时候还没有答案」的空态上 ——
  // 管理员登录完回到设置页，那一行要等下一次整页刷新才出现。
  //
  // ⚠️ 只在这**一份缓存被写**的那一刻喊（`writeTier` / `clearTier` 是它仅有的
  //    两个写入口），不挂在别处：挂在别处就会有第二个「什么时候重画」的判据。
  //    事件名沿用 `settings-nav.js` 一直在听的那个（它早就写好监听了，
  //    只是从前没人发）—— 两边从此对得上。
  function announce() {
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    if (!g || typeof g.dispatchEvent !== "function" || typeof g.Event !== "function") return;
    try { g.dispatchEvent(new g.Event("entitlementchange")); } catch (e) {  }
  }

  function cap(name) {
    var key = Object.prototype.hasOwnProperty.call(ALIAS, name) ? ALIAS[name] : name;
    return CAPS[key] || null;
  }

  function capNames() {
    var out = Object.keys(CAPS);
    Object.keys(ALIAS).forEach(function (a) { if (out.indexOf(a) < 0) out.push(a); });
    return out.sort();
  }

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

  function denyReason(name, ctx) {
    var r = can(name, ctx);
    if (r.ok) return "";
    if (r.reason === "unknown") return "这个功能暂不可用";
    if (r.reason === "login") return "登录可用";
    return r.minTier === "max" ? "Max 起" : "Pro 起";
  }

  function tierLabel(tier) {
    var t = isTier(tier) ? tier : "free";
    return t === "max" ? "Max" : t === "pro" ? "Pro" : "Free";
  }

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

  var COLUMNS = [
    { id: "guest", tier: "free", guest: true  },
    { id: "free",  tier: "free", guest: false },
    { id: "pro",   tier: "pro",  guest: false },
    { id: "max",   tier: "max",  guest: false }
  ];

  function columnLabel(col) {
    if (!col) return "";
    if (col.guest) return "游客";
    return tierLabel(col.tier);
  }

  function quotaFor(c, tier) {
    if (!c) return null;
    if (c.quotas && typeof c.quotas === "object") {
      if (!isTier(tier)) return null;
      var v = c.quotas[tier];
      return typeof v === "number" ? v : null;
    }
    return c.quota == null ? null : c.quota;
  }

  function quotaText(amount) {
    if (amount === Infinity) return "不限";
    if (amount === 0) return "不支持";
    return String(amount) + " 个";
  }

  function compare(o) {
    var opt = o || {};
    var now = typeof opt.now === "number" ? opt.now : undefined;

    var cols = COLUMNS.map(function (c) {
      return { id: c.id, guest: !!c.guest, tier: c.tier, label: columnLabel(c) };
    });

    var rows = Object.keys(CAPS).map(function (k) {
      var c = CAPS[k];
      var cells = COLUMNS.map(function (col) {

        var ctx = { tier: col.tier, signedIn: !col.guest };
        if (now !== undefined) ctx.now = now;
        var r = can(k, ctx);

        var amount = quotaFor(c, col.tier);
        return {
          ok: r.ok,
          reason: r.ok ? "ok" : r.reason,
          quota: amount,

          hint: r.ok
            ? (amount == null ? (c.quota ? "每月 " + c.quota + " 次" : "") : quotaText(amount))
            : denyReason(k, ctx)
        };
      });
      // breaks 一路带到界面上（对比表在那里折行）—— 名字仍是一个名字，
      // 表里读到的还是整句。
      return { cap: k, name: c.name, breaks: c.breaks || null,
               quota: c.quota, quotas: c.quotas || null,
               unit: c.unit || "", minTier: c.minTier, cells: cells };
    });

    var groups = [];
    var byMin = { free: [], pro: [], max: [] };
    rows.forEach(function (r) {
      (byMin[r.minTier] || byMin.free).push(r);
    });
    [

      { key: "free", title: "所有版本都有" },
      { key: "pro", title: "Pro 起" },
      { key: "max", title: "Max 起" }
    ].forEach(function (g) {
      if (byMin[g.key].length) groups.push({ key: g.key, title: g.title, note: g.note, rows: byMin[g.key] });
    });

    var summary = cols.map(function (col, i) {
      var on = 0;
      rows.forEach(function (r) { if (r.cells[i] && r.cells[i].ok) on += 1; });
      return { id: col.id, label: col.label, ok: on, total: rows.length };
    });

    return { cols: cols, rows: rows, groups: groups, summary: summary };
  }

  function identity(o) {
    var opt = o || {};
    var backing = opt.backing || defaultBacking();
    var t = typeof opt.now === "number" ? opt.now : Date.now();

    var authStore = opt.authStore || (function () {
      var g = typeof globalThis !== "undefined" ? globalThis : null;
      var A = (g && g.AuthCore) || null;
      try { return A && A.makeStore ? A.makeStore(backing) : null; } catch (e) { return null; }
    })();

    var uid = "", mask = "", signedIn = false;

    // ⚠️ **先读会话，再读服务端那份缓存**（Issue #276 后续）。
    //
    // 次序就是这件事的全部：`poem_plan_v1` 那份答案记着它是谁的（`uid`），
    // 要对上当前会话才认。反过来先读缓存的话，拿不到 uid 可比，
    // 只能像从前那样「见到 role=owner 就放行」—— 那正是换个人登录之后
    // 上一个人的管理员身份被继承的原因。
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
      }
    }

    // 只认「当前这个人」的那一份（未登录时 uid 为空 → 一份都不认）。
    var serverTier = readServerTier(backing, uid);
    var serverRole = readServerRole(backing, uid);

    // 角色只从服务端来（Issue #276）：`serverRole` 是 `poem_plan_v1`
    // 里那份服务端答案的 role 字段。没有它（或它不是我的）一律 user。
    var role = isAdminRole(serverRole) ? String(serverRole).toLowerCase() : "user";

    if (signedIn) {
      var acc = null;
      try { acc = authSession(authStore).account; } catch (e) { acc = null; }
      var accTier = acc && acc.plan && acc.plan.tier;
      if (isTier(accTier) && accTier !== "free") {
        return finish(accTier, signedIn, uid, mask, role, "local");
      }
      if (serverTier && serverTier !== "free") {
        return finish(serverTier, signedIn, uid, mask, role, "server");
      }
    }

    // 没有服务端那一份时退回本机缓存（离线也能按上次的层级放行），
    // 但**本机不再有第二条写入口**（旧的管理页「模拟身份」已删）。
    var tier = readTier(backing);

    if (serverTier && tierIndex(serverTier) > tierIndex(tier)) tier = serverTier;
    void t;
    return finish(tier, signedIn, uid, mask, role,
      serverTier && tierIndex(serverTier) >= tierIndex(tier) ? "server" : "local");
  }

  function defaultBacking() {
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    if (!g) return null;
    try {
      return g.localStorage && typeof g.localStorage.getItem === "function" ? g.localStorage : null;
    } catch (e) {
      return null;
    }
  }

  // 会话那两件事（读会话 / 造存储）**走同一个 AuthCore 来源**。
  // 分成两个变量各读一次 `globalThis.AuthCore` 的话，`setAuthCore()` 换了一个、
  // 漏换另一个，症状是「读得到会话、读不到 uid」—— 那次正是这么漏的。
  var authCoreRef = function () {
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    return (g && g.AuthCore) || null;
  };

  var authSession = function (authStore) {
    var A = authCoreRef();
    if (A && A.session) return A.session(authStore);
    return null;
  };

  var authStoreFactory = function (backing) {
    var A = authCoreRef();
    try { return A && A.makeStore ? A.makeStore(backing) : null; } catch (e) { return null; }
  };

  function setAuthCore(A) {
    authCoreRef = function () { return A || null; };
    // 读会话与造存储都跟着换（它们在 `identity()` 里要成对出现）。
    authSession = function (authStore) { return A && A.session ? A.session(authStore) : null; };
    authStoreFactory = function (backing) {
      try { return A && A.makeStore ? A.makeStore(backing) : null; } catch (e) { return null; }
    };
  }

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

  function guestIdentity() { return finish("free", false, "", "", "user", "local"); }

  return {
    NS: NS,
    TIERS: TIERS, ROLES: ROLES, CAPS: CAPS, ALIAS: ALIAS,
    capNames: capNames, cap: cap, can: can, denyReason: denyReason,
    tierLabel: tierLabel, matrix: matrix, compare: compare, COLUMNS: COLUMNS,
    quotaFor: quotaFor, quotaText: quotaText, columnLabel: columnLabel,
    isTier: isTier, isRole: isRole,
    tierIndex: tierIndex,
    readTier: readTier, writeTier: writeTier, clearTier: clearTier,
    readPlan: readPlan, readServerTier: readServerTier,
    readServerRole: readServerRole, tierSource: tierSource,
    isOwner: isOwner, isAdminRole: isAdminRole, ownsPlan: ownsPlan, sessionUid: sessionUid,
    identity: identity, guestIdentity: guestIdentity, setAuthCore: setAuthCore,
    defaultBacking: defaultBacking
  };
});
