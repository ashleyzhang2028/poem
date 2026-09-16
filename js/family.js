/**
 * 家庭子档案 · 纯逻辑内核（3 期 P1 · `profile.family`）
 * ==========================================================================
 * 一个家长多个小孩：**孩子不建独立账号**（`docs/auth-design.md` §2.1 的裁决：
 * 未成年人实名/同意合规成本高，且无产品收益），只是账号下的一个「展示名 + 一份进度」。
 * 于是「多个小孩」这件事的实质是 **同一台设备上几套各自独立的背诵进度**。
 *
 * ## 四条边界（都是「不这么定就会出别的问题」）
 *
 * 1. **不新增账号、不新增表** —— 与 2.2（服务端发放）同源的判断：
 *    多一张表就多一处会漂移的地方。子档案就是账号域里的一份数组，
 *    权威判权仍只有 `/api/me` 一处。这是它能**不花钱**做完的原因。
 *
 * 2. **「当前是哪个孩子」进账号域，不进设备域** —— 一台平板上午小明读、
 *    下午小红读，晚上爸爸拿手机看小明的进度。这一项若留在设备域，
 *    手机上切到小红、平板上还显示小明。**判据与设备偏好彻底分家**。
 *
 * 3. **分家的边界按域划，不是「每个孩子一份完整存储」** —— 后者会连带把
 *    设备偏好也复制两份，症状是「给小红调了字号，切回小明又变回去了」，
 *    正好踩中 0 期分域那条红线的反面（`js/progress-store.js` 文件头）。
 *
 * 4. **上限拦在数据层** —— 与 `js/collections.js` 的 `limit()` 同一条纪律：
 *    拦在按钮上就只能拦按钮，用户手改存储、或别处直接调用都绕不过。
 *
 * ## 盘上形状（改了就有一层测试直接红）
 *
 * ```
 * poem_family_v1 = {
 *   v: 1,
 *   at: "f-...",                    // 当前选中的子档案 id
 *   profiles: [
 *     { id: "f-...", nickname: "小明", avatar: { char:"", ink:"" }, createdAt: 1699.. }
 *   ]
 * }
 * ```
 *
 * ⚠️ **老数据（0 期至今只有一份档案）零感知升级**：`poem_profile_v1` 里
 *    那份昵称 + 字符印会在第一次读的时候被**认领成第一个子档案**，
 *    昵称与印一个字都不丢。认领是幂等的，且**只在子档案表为空时**发生。
 *
 * ## 语法与依赖
 *
 * 与 `progress-store.js` / `avatar.js` 同一档（只用 var + function）——
 * 这一层要在老 WebView 上被解析，首行 SyntaxError 会让整站白屏而不是功能降级。
 * **零 DOM、零网络、零上传**，可在 Node 里 require。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Family = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /** 账号域：子档案表（跨设备一致 —— 与 `poem_profile_v1` 同一个域） */
  var NS = "poem_family_v1";
  /** 老键：0 期至今那一份「只有昵称 + 头像」的档案，认领成第一个子档案 */
  var LEGACY_PROFILE_NS = "poem_profile_v1";

  /** 昵称长度与 `js/avatar.js` 同一档（同一个字段，不该有两套限长） */
  var NAME_MAX = 12;

  /**
   * 上限 —— **按已经发放的层级判，不按 `can()` 判**。
   *
   * ⚠️ 与 `js/collections.js` 的 `limit()` 逐条同源（那边踩过的坑这里不重踩）：
   *    · 两条能力带 `login:true`，走 `can()` 时「登录过了但会话刚过期」
   *      会被判成 free —— 症状是「昨天有 3 个子档案，今天一刷新只剩 1 个」。
   *    · 拿不到权益内核时**不设限**（返回 Infinity）：脚本顺序不对 / 老缓存时
   *      按 free 卡，症状是一个由加载顺序引起、用户无法自查的功能倒退。
   *
   * 层级对应（用户 2026-09-17 裁决「子档案 Max 180 个」）：
   *   free 1 个 / pro 3 个 / max **180 个**
   *
   * ⚠️ 这三个数是**从内核读的**（`CAPS["profile.family"].quotas`），不是在这里
   *    再抄一份 —— 对比表上写的 1 / 3 / 180 与实际能建几个必须是同一个数。
   *    兜底（读不到内核 / 内核里没写 quotas）留一份与 entitlement.js **同值**的
   *    字面量，`test/family.test.js` 有断言钉住。
   */
  var FALLBACK = { free: 1, pro: 3, max: 180 };

  /* ------------------------------------------------ 存储（薄包装，全部不抛） */

  function safeGet(backing, key) {
    if (!backing) return null;
    try { return backing.getItem(key); } catch (e) { return null; }
  }

  function safeParse(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  /** 落盘。**返回布尔值而不是抛异常** —— 写满（QuotaExceeded）时调用方要能安静降级 */
  function safePut(backing, key, text) {
    if (!backing) return false;
    try { backing.setItem(key, text); return true; } catch (e) { return false; }
  }

  /** 默认存储：浏览器里就是 localStorage；Node 里给不了就返回 null（不抛） */
  function defaultBacking() {
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    if (!g) return null;
    try {
      return g.localStorage && typeof g.localStorage.getItem === "function" ? g.localStorage : null;
    } catch (e) {
      return null;                          // 隐私模式下取用即抛
    }
  }

  function now() { return Date.now(); }

  /**
   * 新 id。**不用昵称、不用序号** —— 昵称可以改、可以重名，序号会与删除撞车。
   * 前缀 `f-` 让排查时一眼看出它是什么（与集合的 `c-` 同一套约定）。
   */
  function uid() {
    return "f-" + now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }

  /* -------------------------------------------------------------- 归一化 */

  /** 昵称规范化：去首尾空白、限长。**允许为空**（界面回落「Ashley」，与用户名同口径） */
  function cleanName(name) {
    return String(name == null ? "" : name).trim().replace(/\s+/g, " ").slice(0, NAME_MAX);
  }

  /**
   * 头像字段归一化：**只留 char / ink 两个键**，其余一概丢掉。
   *
   * ⚠️ 这里**不校验合法性**（不判它是不是固定字集里的那个字）——
   *    合法性只有一个来源：`js/avatar.js` 的 `isChar()` / `isInk()`。
   *    在这层再抄一份判据，两份判据早晚会分叉（分叉的症状是「设置页认、
   *    切换器不认」）。所以这里只做**形状**收敛，合法性交给 Avatar。
   */
  function normAvatar(a) {
    if (!a || typeof a !== "object") return { char: "", ink: "" };
    return {
      char: typeof a.char === "string" ? a.char : "",
      ink: typeof a.ink === "string" ? a.ink : ""
    };
  }

  /** 一条子档案归一化；`id` 缺失就现发一个（脏数据也要能救回来，而不是整份丢掉） */
  function normProfile(p) {
    if (!p || typeof p !== "object") return null;
    var id = String(p.id == null ? "" : p.id).trim();
    return {
      id: id || uid(),
      nickname: cleanName(p.nickname),
      avatar: normAvatar(p.avatar),
      createdAt: Number(p.createdAt) > 0 ? Number(p.createdAt) : now()
    };
  }

  /* ---------------------------------------------------------------- 读 */

  /**
   * 读整张子档案表。**任何解析失败 / 形状不对 → 空表**（不抛）。
   *
   * ⚠️ 不做「读的时候顺手认领老档案」——认领是**写**，写只发生在 `ensure()`。
   *    读的时候写盘会让一次纯渲染也留下副作用（隐私模式下还写不进去），
   *    而症状是「打开设置页就报一个写盘失败」。
   */
  function read(backing) {
    var b = backing === undefined ? defaultBacking() : backing;
    var o = safeParse(safeGet(b, NS));
    if (!o || typeof o !== "object" || !Array.isArray(o.profiles)) {
      return { v: 1, at: "", profiles: [] };
    }
    var list = o.profiles.map(normProfile).filter(function (p) { return !!p; });
    /* 去重：同 id 只留第一条。脏数据里可能出现两条同 id（手改存储 / 半途写坏），
       留着会让「切换」出现两个同名同头像的项、而进度其实是同一份。 */
    var seen = {};
    list = list.filter(function (p) {
      if (seen[p.id]) return false;
      seen[p.id] = true;
      return true;
    });
    var at = String(o.at == null ? "" : o.at);
    if (!at || !seen[at]) at = list.length ? list[0].id : "";   // 选中的那条被删了 → 落回第一条
    return { v: 1, at: at, profiles: list };
  }

  function write(backing, data) {
    var b = backing === undefined ? defaultBacking() : backing;
    var clean = {
      v: 1,
      at: String((data && data.at) || ""),
      profiles: ((data && data.profiles) || []).map(normProfile).filter(function (p) { return !!p; })
    };
    return safePut(b, NS, JSON.stringify(clean));
  }

  /**
   * 列出存储里现有的全部键名。
   *
   * 三种存储实现都要认（**这是「已读键」能被正确认领的前提**）：
   *   · 浏览器 localStorage  → `length` + `key(i)`
   *   · 测试里的内存替身     → `raw()` 返回内部对象
   *   · 更简的替身           → 直接把键挂在对象上（`__keys` / 自身）
   * 扫不出来时返回空数组 —— 调用方据此只搬那两把主键，不因它整件事失败。
   */
  function storeKeys(b) {
    if (!b) return [];
    try {
      if (typeof b.length === "number" && typeof b.key === "function") {
        var out = [];
        for (var i = 0; i < b.length; i++) {
          var k = b.key(i);
          if (k) out.push(k);
        }
        return out;
      }
    } catch (e) { /* 某些实现取 length 就会抛（隐私模式） */ }
    try {
      if (typeof b.raw === "function") return Object.keys(b.raw() || {});
    } catch (e) { /* 同上 */ }
    if (b.__keys && typeof b.__keys === "object") return Object.keys(b.__keys);
    return [];
  }

  /** 老档案（`poem_profile_v1`）里的昵称 + 字符印 —— 认领时要一字不丢地搬过来 */
  function legacyProfile(backing) {
    var b = backing === undefined ? defaultBacking() : backing;
    var o = safeParse(safeGet(b, LEGACY_PROFILE_NS));
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    if (!o.nickname && !o.avatar) return null;
    return { nickname: cleanName(o.nickname), avatar: normAvatar(o.avatar) };
  }

  /**
   * **认领**：子档案表为空时，把老档案搬成第一个子档案。
   *
   * 幂等 —— 表里已经有档案时什么都不做（`created: 0`）。
   * 这是「老用户零感知」的全部实现：他升级之后打开设置页，
   * 用户名与那枚印原样还在，只是现在它叫「子档案 1」。
   *
   * ⚠️ 认领走 `Avatar` 的**读**路径（`Avatar.display()`）而不是读原始 JSON ——
   *    老键里可能只有昵称没有头像、也可能只有头像没有昵称，
   *    三档回落（选的字 / 昵称首字 / 默认诗字）只在 Avatar 里有一份实现。
   */
  function ensure(backing) {
    var b = backing === undefined ? defaultBacking() : backing;
    var data = read(b);
    if (data.profiles.length) return { created: 0, data: data };

    var A = (typeof globalThis !== "undefined" && globalThis.Avatar) || null;
    var legacy = legacyProfile(b);
    var nickname = legacy ? legacy.nickname : "";
    var avatar = legacy ? legacy.avatar : { char: "", ink: "" };
    /* 老档案为空、但 Avatar 已经在场上时，仍走它一次：
       昵称可能只存在更老的 `settings.username` 里（见 avatar.js 的兼容读）。 */
    if (!nickname && A && A.nickname) {
      try { nickname = cleanName(A.nickname(b)); } catch (e) { nickname = ""; }
    }

    var first = normProfile({ id: uid(), nickname: nickname, avatar: avatar, createdAt: now() });
    var next = { v: 1, at: first.id, profiles: [first] };
    var ok = write(b, next);
    if (ok) adoptLegacyData(b, first.id);
    return { created: ok ? 1 : 0, data: read(b), adopted: ok ? first.id : "" };
  }

  /**
   * 认领老档案时**顺手把老数据也搬到第一个子档案名下**。
   *
   * 不做这一步的症状是：老用户升级之后，昵称还在，但**进度空了** ——
   * 因为多子档案一开启，盘上就读 `..._v1::f-xxx` 这把新键，
   * 而他那几个月的进度一直躺在没有后缀的老键里。
   *
   * ⚠️ **搬家是复制 + 删原键，而且是幂等的**：
   *    · 只在老键存在、且目标键**还不存在**时搬（第二次调用什么都不做）；
   *    · 老键删掉**不是**为了省空间，是为了不让「老键里那份」成为第二份真相 ——
   *      留着它，「切换孩子」时两处会各说各话（新档案看到旧进度，
   *      而老键又永远不再被任何人写）。
   *    · 搬的键只有**跟着孩子分家**的那几把（进度 / 设置 / 已读）——
   *      设备域一个字节都不动（字号是设备的）。
   *
   * 认领失败（隐私模式写不进去）时**一个键都不删**：宁可让老数据留在原地，
   * 也不能出现「搬了一半、两边都没有」。
   */
  /**
   * **恢复一份名册**（跨设备分档案：云端那一份落到本机）。
   *
   * 它是 `write()` 之外的**第二个写入口**，刻意做成一个单独的函数而不是
   * 「让调用方自己拼一个对象再写进去」—— 名册是**账号域**里唯一一份数组，
   * 谁都能拼的话，早晚有人拼出一份缺 `at`、或有两条同 id 的脏名册。
   *
   * ## 四条不许省的规矩
   *
   * 1. **先读本机、再决定要不要动**：本机已经一个档案都不少时，
   *    调用方（同步层）按时间戳判过谁新，但**这里再判一次「不许清空」**——
   *    一条脏的云端记录不该把本机名册清成空（那是用户唯一能看到孩子的地方）。
   * 2. **最后一个孩子不许被顶掉**：云端那份是空的 / 全是脏 id 时，**原样返回本机那一份**
   *    （`E_EMPTY`），**不写盘**。与 `remove()` 的 `E_LAST` 是同一条产品口径：
   *    删到最后一个就没地方背书了。
   * 3. **`at` 必须落在名册里**：云端给的 `at` 指向一个不在列表里的 id 时，
   *    落回第一条（`read()` 里那条同款）—— 否则另一台设备切过去会看到一份空进度，
   *    而**没人知道该看谁的**。
   * 4. **不删任何一份进度数据**：本函数只动这一把名册键。
   *    云端少一个孩子时，那个孩子的进度仍在盘上（`poem_recite_progress_v1@<pid>`），
   *    只是当前看不到 —— 由用户自己在设置页决定要不要删
   *    （与 `remove()` 那条「删名册不动那一份进度数据」同口径）。
   *
   * @returns {{ok:boolean, code?:string, data?:object}}
   */
  function restore(cloud, opt) {
    var o = opt || {};
    var backing = o.backing === undefined ? defaultBacking() : o.backing;
    var raw = cloud && typeof cloud === "object" ? cloud : null;
    if (!raw || !Array.isArray(raw.profiles) || !raw.profiles.length) {
      return { ok: false, code: "E_EMPTY" };         // 空名册不是「清空本机」，什么都不动
    }
    var clean = raw.profiles.map(normProfile).filter(function (p) { return !!p; });
    var seen = {};
    clean = clean.filter(function (p) {
      if (seen[p.id]) return false;
      seen[p.id] = true;
      return true;
    });
    if (!clean.length) return { ok: false, code: "E_EMPTY" };
    var at = String(raw.at == null ? "" : raw.at);
    if (!seen[at]) at = clean[0].id;
    var next = { v: 1, at: at, profiles: clean };
    if (!write(backing, next)) return { ok: false, code: "E_WRITE" };
    return { ok: true, data: read(backing) };
  }

  function adoptLegacyData(b, profileId) {
    if (!b || !profileId) return [];
    var moved = [];
    var keysNow = sharedKeys();
    var perChild = [keysNow.progress, keysNow.settings];
    /* 已读键（六部集子各一把）不在 sharedKeys 里 —— 它们由 reader-core 直接写。
       这里按**前缀**扫一遍：`poem_*_read_v1` 都是跟着孩子走的。 */
    try {
      var names = storeKeys(b);
      names.forEach(function (k) {
        if (k && /^poem_.*_read_v1$/.test(k)) perChild.push(k);
      });
    } catch (e) { /* 扫不出来就只搬那两把主键，不因它整件事失败 */ }

    perChild.forEach(function (key) {
      var text = safeGet(b, key);
      if (!text) return;
      var target = keyFor(key, profileId);
      if (target === key) return;                     // 不该分家的键：不动
      if (safeGet(b, target)) return;                 // 已经搬过：幂等，什么都不做
      if (!safePut(b, target, text)) return;          // 写不进去就留在原地（一个都不删）
      try { b.removeItem(key); } catch (e) { /* 删不掉也不影响：目标键已经在 */ }
      moved.push(key);
    });
    return moved;
  }

  /* ---------------------------------------------------------------- 上限 */

  /**
   * 能建几个子档案 —— **全站唯一一处**回答这个问题。
   *
   * 与 `js/collections.js` 的 `limit()` 逐条同源（含「拿不到内核时不设限」那条兜底）。
   * 页面不许自己判层级（有源码扫描守着）。
   */
  function limit(opt) {
    var o = opt || {};
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    var E = o.E || (g && g.Entitlement) || null;
    var backing = o.backing === undefined ? defaultBacking() : o.backing;

    if (!E || !E.identity) return Infinity;               // 宁可不判，也不误拦
    var id = null;
    try { id = E.identity({ backing: backing }); } catch (e) { id = null; }
    if (!id) return Infinity;
    /* 数字取自内核的 CAPS["profile.family"].quotas（与「自选清单」同一套写法），
       `E` 是测试注入的那个内核 —— 拿不到 quotaFor 就回落到与内核同值的兜底。 */
    var n = null;
    if (typeof E.quotaFor === "function" && E.CAPS) {
      n = E.quotaFor(E.CAPS["profile.family"], id.tier);
    }
    if (typeof n !== "number") n = FALLBACK[id.tier];
    return typeof n === "number" ? n : FALLBACK.free;
  }

  /** 还能建几个（Infinity 表示不限） */
  function remaining(opt) {
    var o = opt || {};
    var backing = o.backing === undefined ? defaultBacking() : o.backing;
    return Math.max(0, limit(o) - read(backing).profiles.length);
  }

  /* ---------------------------------------------------------------- 写 */

  /**
   * 新建一个子档案。**超上限时不建**，如实回原因（不抛、不静默截断）。
   * @returns {Object} 成功回 `{ ok:true, profile, data }`；超限回
   *   `{ ok:false, code:"E_LIMIT", limit, count }` —— 用带错误码的对象而不是 null，
   *   是为了让调用方能说清「为什么不给建」（`null` 说不清是上限还是别的原因）。
   */
  function create(name, opt) {
    var o = opt || {};
    var backing = o.backing === undefined ? defaultBacking() : o.backing;
    var data = ensure(backing).data;                      // 先认领老档案，再谈上限
    var lim = limit({ backing: backing, E: o.E });
    if (data.profiles.length >= lim) {
      return { ok: false, code: "E_LIMIT", limit: lim, count: data.profiles.length };
    }
    var p = normProfile({ id: uid(), nickname: name, avatar: o.avatar, createdAt: now() });
    data.profiles.push(p);
    if (!write(backing, data)) return { ok: false, code: "E_WRITE" };
    return { ok: true, profile: p, data: read(backing) };
  }

  /** 改名。空名允许（界面回落「Ashley」）；返回 `{ok, profile}` 或 `{ok:false, code}` */
  function rename(profileId, name, opt) {
    var o = opt || {};
    var backing = o.backing === undefined ? defaultBacking() : o.backing;
    var data = read(backing);
    var hit = null;
    data.profiles.forEach(function (p) { if (p.id === profileId) hit = p; });
    if (!hit) return { ok: false, code: "E_NOT_FOUND" };
    hit.nickname = cleanName(name);
    if (!write(backing, data)) return { ok: false, code: "E_WRITE" };
    return { ok: true, profile: hit };
  }

  /** 改某一个子档案的字 / 印。写的是那一份档案自己的头像字段 */
  function setAvatar(profileId, patch, opt) {
    var o = opt || {};
    var backing = o.backing === undefined ? defaultBacking() : o.backing;
    var data = read(backing);
    var hit = null;
    data.profiles.forEach(function (p) { if (p.id === profileId) hit = p; });
    if (!hit) return { ok: false, code: "E_NOT_FOUND" };
    var p = patch && typeof patch === "object" ? patch : {};
    if (p.char != null) hit.avatar.char = typeof p.char === "string" ? p.char : "";
    if (p.ink != null) hit.avatar.ink = typeof p.ink === "string" ? p.ink : "";
    if (!write(backing, data)) return { ok: false, code: "E_WRITE" };
    return { ok: true, profile: hit };
  }

  /**
   * 删一个子档案。
   *
   * ⚠️ **最后一个不许删**：0 个档案的状态没有意义（没有档案 = 没有进度归属），
   *    而「新建」会自动补一个 —— 于是删除到 0 之后下次打开又冒出一个空档案，
   *    用户看到的是「删了又回来」。所以最后一个如实回 `E_LAST`。
   *
   * ⚠️ 删的是**名册**，**不动那一份进度数据** —— 误删名册还能当场看出来，
   *    连带清进度就是不可逆的（与「清空进度」那颗按钮同一条纪律）。
   *    界面要如实说明这一点。
   */
  function remove(profileId, opt) {
    var o = opt || {};
    var backing = o.backing === undefined ? defaultBacking() : o.backing;
    var data = read(backing);
    if (data.profiles.length <= 1) return { ok: false, code: "E_LAST" };
    var before = data.profiles.length;
    data.profiles = data.profiles.filter(function (p) { return p.id !== profileId; });
    if (data.profiles.length === before) return { ok: false, code: "E_NOT_FOUND" };
    if (data.at === profileId) data.at = data.profiles[0].id;   // 删的正是当前那个 → 落到第一条
    if (!write(backing, data)) return { ok: false, code: "E_WRITE" };
    return { ok: true, data: read(backing) };
  }

  /** 切换当前子档案。不存在的 id 一律拒绝（不回落到第一条 —— 那是静默改行为） */
  function select(profileId, opt) {
    var o = opt || {};
    var backing = o.backing === undefined ? defaultBacking() : o.backing;
    var data = read(backing);
    var hit = false;
    data.profiles.forEach(function (p) { if (p.id === profileId) hit = true; });
    if (!hit) return { ok: false, code: "E_NOT_FOUND" };
    data.at = profileId;
    if (!write(backing, data)) return { ok: false, code: "E_WRITE" };
    return { ok: true, data: read(backing) };
  }

  /* ---------------------------------------------------------------- 取 */

  /** 当前子档案 id（没认领过老档案时给空串 —— 「还没有档案」是如实的状态） */
  function currentId(opt) {
    var o = opt || {};
    var backing = o.backing === undefined ? defaultBacking() : o.backing;
    return read(backing).at;
  }

  /** 当前子档案（没有则 null） */
  function current(opt) {
    var o = opt || {};
    var backing = o.backing === undefined ? defaultBacking() : o.backing;
    var data = read(backing);
    var hit = null;
    data.profiles.forEach(function (p) { if (p.id === data.at) hit = p; });
    return hit;
  }

  function list(opt) {
    var o = opt || {};
    var backing = o.backing === undefined ? defaultBacking() : o.backing;
    return read(backing).profiles;
  }

  function count(opt) {
    return list(opt).length;
  }

  /* --------------------------------------------------- 分域：哪些数据跟着分家 */

  /**
   * 一个键**要不要按子档案分家** —— 全站唯一一处回答这个问题。
   *
   * 判据只有一条：**它属不属于「孩子自己的东西」**。
   * 设备域（字号 / 对齐 / 连读档 / 注音开关）**不跟着分家** ——
   * 同一台平板，字号是设备的，不会因为换了孩子就变回去。
   *
   * ⚠️ 不许按「每个孩子一份完整存储」做：那会连带把设备偏好也复制两份，
   *    症状正是「给小红调了字号，切回小明又变回去了」。
   *
   * 返回的键名 **不含** 子档案 id —— 那是 `keyFor()` 的事（拼法只有一处）。
   */
  function sharedKeys() {
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    var PS = g && g.ProgressStore;
    var K = PS && PS.KEYS ? PS.KEYS : {};
    return {
      progress: K.progress || "poem_recite_progress_v1",
      settings: K.settings || "poem_recite_settings_v1",
      profile: K.profile || "poem_profile_v1",
      device: K.device || "poem_device_prefs_v1"
    };
  }

  /**
   * 这个键要不要跟着子档案走。
   *
   * · 进度域 / 账号域设置 / 账号域档案 → **要**（这就是子档案存在的理由：
   *   一年级和三年的孩子显然该有不同的年级与每日数量）
   * · 设备域 → **不要**（同一台平板，字号不该因为换孩子而变）
   * · 六部集子的已读键（`poem_*_read_v1`）→ **要**（读没读过是孩子自己的事）
   *
   * ⚠️ 认不出来的键**一律按「跟着分家」处理**（安全的一侧）：认不出意味着
   *    它多半是新加的账号域数据；若按「不分家」处理，症状是两个孩子的数据混在
   *    一份里（比多开一份糟得多 —— 多开只是多占几 KB）。
   */
  function isPerChild(key) {
    var k = String(key == null ? "" : key);
    var K = sharedKeys();

    /* ① 先认**已经在册**的几种：判据只此一处，不靠猜 */
    if (k === K.progress || k === K.settings) return true;   // 进度域 / 账号域设置：分家
    if (k === K.profile) return false;                       // 名册本身：不分家
    if (k === K.device) return false;                        // 设备域：不分家

    /* ② 集子已读键（六部各一把 `poem_*_read_v1`）：**读没读过是孩子自己的事**。
       ⚠️ 必须先于下面的「引擎说不算上云的键」判 —— `ProgressStore.isLocalKey()`
          对**认不出的键一律回 true**（那是它自己的安全口径：宁可不推也不误推），
          拿它来判「要不要分家」正好会把这些已读键判成设备域，
          症状是「小明读过的书，小红那边也显示读过」。 */
    if (/^poem_.*_read_v1$/.test(k)) return true;

    /* ③ 设备域的几把老键（字号 / 对齐 / 连读档 / iOS 引导条 / 播放模式）——
       它们**不在** ProgressStore.KEYS 里（那些文件直接写 localStorage），
       所以这里显式列出来。同一台平板上，字号是设备的。 */
    if (/^poem_(font|align|reader|ios_|play)/.test(k)) return false;

    /* ④ 其余：先问引擎「这是不是本机数据」（它认得出设备域与备份域），
       认得出且是本机的 → 不分家；引擎不在或它也不认识 → **按分家处理**。 */
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    var PS = g && g.ProgressStore;
    if (PS && PS.isLocalKey) {
      var known = false;
      try {
        var scopes = PS.scopes ? PS.scopes() : [];
        known = scopes.some(function (sc) { return sc.key === k; });
      } catch (e) { known = false; }
      if (known) {
        try { if (PS.isLocalKey(k)) return false; } catch (e) { /* 落回下面那一支 */ }
      }
    }

    /* 认不出的键按「分家」处理（安全的一侧）：多开一份只是多占几 KB，
       混在一起就是数据串了 —— 两个孩子的进度混在一份里，谁都看不出来。 */
    return true;
  }

  /**
   * 把「共享键」拼成「某个子档案自己的键」。
   *
   * 拼法**只有这一处** —— 各处各拼一遍，早晚有一天只改了一处，
   * 而症状是「切换孩子后看不到进度」（键对不上，不报错）。
   *
   * ⚠️ 没有当前子档案（空串）时**返回原键**：0 期至今那几把键的形状
   *    一字不动，老用户即使脚本顺序不对也能照常背书。
   */
  function keyFor(key, profileId) {
    var pid = String(profileId == null ? "" : profileId);
    if (!pid) return key;
    if (!isPerChild(key)) return key;
    return key + "::" + pid;
  }

  /**
   * 一次性拿到「当前该读哪几把键」。
   * 给 `ProgressStore` 与集子页的已读键用 —— 它们不该各自拼一遍。
   */
  function keyMap(opt) {
    var o = opt || {};
    var backing = o.backing === undefined ? defaultBacking() : o.backing;
    var pid = o.profileId === undefined ? currentId({ backing: backing }) : String(o.profileId || "");
    var K = o.keys || sharedKeys();
    var out = {};
    Object.keys(K).forEach(function (name) { out[name] = keyFor(K[name], pid); });
    return { profileId: pid, keys: out, perChild: !!pid };
  }

  /* ---------------------------------------------------------------- 导出 */

  function backingOf(opt) {
    var o = opt || {};
    return o.backing === undefined ? defaultBacking() : o.backing;
  }

  return {
    NS: NS,
    LEGACY_PROFILE_NS: LEGACY_PROFILE_NS,
    NAME_MAX: NAME_MAX,
    /* 与内核同值的兜底（`test/family.test.js` 拿它对着 CAPS 的 quotas 判） */
    FREE_PROFILES: FALLBACK.free,
    PRO_PROFILES: FALLBACK.pro,
    MAX_PROFILES: FALLBACK.max,
    FALLBACK: FALLBACK,

    cleanName: cleanName,
    normAvatar: normAvatar,
    normProfile: normProfile,

    read: function (opt) { return read(backingOf(opt)); },
    write: function (data, opt) { return write(backingOf(opt), data); },
    ensure: function (opt) {
      var r = ensure(backingOf(opt));
      return r.data;                          // 调用方要的是「现在这份表」，不是认领了几条
    },
    ensureDetailed: function (opt) { return ensure(backingOf(opt)); },
    adoptLegacyData: function (profileId, opt) { return adoptLegacyData(backingOf(opt), profileId); },

    limit: function (opt) { return limit(opt); },
    remaining: function (opt) { return remaining(opt); },

    create: function (name, opt) { return create(name, opt); },
    rename: function (id, name, opt) { return rename(id, name, opt); },
    setAvatar: function (id, patch, opt) { return setAvatar(id, patch, opt); },
    remove: function (id, opt) { return remove(id, opt); },
    select: function (id, opt) { return select(id, opt); },
    /* 跨设备分档案（5.3）：云端那一份名册落到本机。**唯一的第二个写入口**，
       不许调用方自己拼对象再写 —— 见 `restore()` 的注释。 */
    restore: function (cloud, opt) { return restore(cloud, opt); },

    list: function (opt) { return list(opt); },
    count: function (opt) { return count(opt); },
    currentId: function (opt) { return currentId(opt); },
    current: function (opt) { return current(opt); },

    sharedKeys: sharedKeys,
    isPerChild: isPerChild,
    keyFor: keyFor,
    keyMap: keyMap,
    defaultBacking: defaultBacking,
    storeKeys: storeKeys
  };
});
