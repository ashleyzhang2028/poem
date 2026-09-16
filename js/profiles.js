/**
 * Profiles · 子档案（一个家长，多个孩子各背各的）
 * ==========================================================================
 * 用户 2026-09-17 裁决（Issue #159）：
 *   · 「进度也分家：切到小明只看到小明的排期」
 *   · 「Free 档给 1 个昵称」
 *   · 「要跟着分家」
 *   · 「一台设备上多个孩子各背各的」
 *   · 「子档案 Max 180 个」（老师带 3~9 个班级的场景）
 *
 * ## 这一层解决的不是「多个昵称随便切」，是「同一台设备上几套独立的背诵进度」
 *
 * 孩子**不建独立账号**（`docs/auth-design.md` §2.1：只允许成年人建号，
 * 孩子的昵称是账号下的一个展示名 —— 未成年人实名/同意的合规成本高，
 * 产品收益是零）。所以一个子档案 = 一个展示名 + 一份**自己的**进度。
 *
 * ## 分家的边界只有一条判据：这属不属于「孩子自己的东西」
 *
 * | 跟着子档案走 | 不跟 |
 * |---|---|
 * | 背诵进度 | 字号 / 对齐 / 连读档 / 注音开关（同一台平板，字号是设备的） |
 * | 年级 / 学期 / 范围 / 每日数量 | 「上次在这台机器搜了什么」 |
 * | 六部集子的已读 | |
 *
 * ⚠️ 最容易做错的是**粒度选错**：按「每个孩子一份完整存储」做，会连带把
 *    设备偏好也复制两份 —— 症状是「给小红调了字号，切回小明又变回去了」。
 *    所以本层只交出「跟着走的键」的**读写映射**（`keys()`），设备域一个字节不碰。
 *
 * ## 「当前是哪个孩子」放在**账号域**，不放在设备域
 *
 * 一台平板上午小明读、下午小红读，晚上家长拿手机看小明的进度。
 * 放在设备域的症状是「手机上切到小红、平板上还显示小明」。
 * 所以当前选中项跟名册一起存（名册本身就是账号域的一份数据）。
 *
 * ## 盘上形状：一把键，分家前与分家后**同名**
 *
 * ```
 * poem_profiles_v1 = {
 *   v: 2,
 *   profiles: [ { id, nickname, avatar:{char,ink}, born } ],
 *   current: "p1"
 * }
 * ```
 *
 * 分家前的每一份数据都还在**原来的键**上（`poem_recite_progress_v1` 等）——
 * 第一个子档案指的就是那一份，所以老用户升级后**零感知**：
 * 昵称、进度、年级、已读全都在。第二个起才带后缀：
 *
 * ```
 * poem_recite_progress_v1@p2
 * poem_recite_settings_v1@p2
 * poem_tangshi_read_v1@p2
 * ```
 *
 * ⚠️ 为什么不做「一次全量迁移」（把第一个档案也搬到 `@p1` 后缀键）：
 *    那要写「搬一半时断电」的恢复逻辑，而这里**根本不需要搬** ——
 *    零迁移就是零风险。代价是键名规则多一条「无后缀 = 第一个档案」，
 *    这条规则收在 `Physical.keys()` 一处（有断言钉着不许散出去）。
 *
 * ## 老用户的进度是**继承**的，不是复制的
 *
 * 「再建一个」之后新建的档案是**全新空档**（明白说了「新档案是空的」）。
 * 只有**第一个**档案承接原来那份数据 —— 您原来的进度只在一个地方，
 * 不会出现「两个孩子看到同一批进度」。
 *
 * ## 语法：与 `progress-store.js` 同一档（只用 var + function）
 * 首行 SyntaxError 会让整站白屏，而不是某个功能降级。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Profiles = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /** 名册键（账号域）。`v:2` 之后的形状与 `docs/auth-design.md` §2.1 的 `profiles[]` 一致 */
  var NS = "poem_profiles_v1";

  /** 分家后的键名分隔符。选 `@` 而不是 `_`：键名里本来就有下划线 */
  var SEP = "@";

  /** 昵称长度上限，与设置页那个 `maxlength=12` 同一处口径（avatar.js 也是 12） */
  var NAME_MAX = 12;

  /** 三档上限（用户口径：Free 1 / Pro 3 / Max 180） */
  var LIMITS = { free: 1, pro: 3, max: 180 };

  /**
   * 跟着子档案分家的**已读域**六把键。
   * 与 `progress-store.js` 的 `scopes()` 是同一批键，但这一层不依赖它
   * （依赖方向单向：引擎在页面里先加载，本层在后）—— 那张表有断言对拍。
   */
  var READ_KEYS = [
    "poem_poems_read_v1",    // 课内 261 首索引页
    "poem_classic_read_v1",  // 小古文
    "poem_tangshi_read_v1",  // 唐诗三百首
    "poem_songci_read_v1",   // 宋词三百首
    "poem_guwen_read_v1",    // 古文观止
    "poem_zhaoming_read_v1"  // 昭明文选
  ];

  /** 跟着走的键（**顺序即「先写谁」**，导出时也是这个顺序） */
  function sharedKeys() {
    return ["poem_recite_progress_v1", "poem_recite_settings_v1"].concat(READ_KEYS);
  }

  function isSharedKey(key) { return sharedKeys().indexOf(String(key)) >= 0; }

  /* ---------------------------------------------------------------- 盘上形状 */

  function safeParse(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  function cleanName(n) {
    return String(n == null ? "" : n).trim().slice(0, NAME_MAX);
  }

  /**
   * 归一化一个头像字段。非法值回落成**空串**（不是默认「诗」）——
   * 与 `avatar.js` 同一条口径：「盘上没存过字」与「用户主动选了诗字」是两件事。
   */
  function normAvatar(a) {
    var src = a && typeof a === "object" ? a : {};
    return { char: String(src.char == null ? "" : src.char).slice(0, 2), ink: String(src.ink == null ? "" : src.ink).slice(0, 16) };
  }

  /** 档案 id 只认字母数字（它要进键名，绝不能带控制字符或分隔符） */
  function isId(id) { return /^[a-z0-9]{1,16}$/.test(String(id == null ? "" : id)); }

  function normProfile(p) {
    if (!p || typeof p !== "object" || !isId(p.id)) return null;
    return {
      id: String(p.id),
      nickname: cleanName(p.nickname),
      avatar: normAvatar(p.avatar),
      born: Number(p.born) || 0
    };
  }

  /**
   * 读名册。**任何解析失败 / 形状不对 → 空名册**，绝不抛。
   * 空名册的含义是「还没分家」（老用户 / 新用户都落这里），
   * 界面上表现为「只有一个默认档案」，而不是「没有档案」。
   */
  function readRoster(store) {
    if (!store) return { v: 2, profiles: [], current: "" };
    var text = null;
    try { text = store.getItem(NS); } catch (e) { return { v: 2, profiles: [], current: "" }; }
    var o = safeParse(text);
    if (!o || typeof o !== "object" || !Array.isArray(o.profiles)) return { v: 2, profiles: [], current: "" };
    var list = [];
    var seen = {};
    o.profiles.forEach(function (p) {
      var n = normProfile(p);
      if (!n || seen[n.id]) return;               // 脏条目 / 重 id 一律丢掉，不猜
      seen[n.id] = true;
      list.push(n);
    });
    var cur = String(o.current == null ? "" : o.current);
    if (!seen[cur]) cur = list.length ? list[0].id : "";
    return { v: 2, profiles: list, current: cur };
  }

  /** 写名册。写不上（隐私模式 / 配额满）时返回 false，不抛 */
  function writeRoster(store, roster) {
    if (!store) return false;
    var clean = {
      v: 2,
      profiles: (roster.profiles || []).map(normProfile).filter(Boolean),
      current: String(roster.current || "")
    };
    if (!clean.profiles.length) clean.current = "";
    else if (!clean.profiles.some(function (p) { return p.id === clean.current; })) clean.current = clean.profiles[0].id;
    try { store.setItem(NS, JSON.stringify(clean)); return true; }
    catch (e) { return false; }
  }

  /* ---------------------------------------------------------------- 键的物理映射 */

  /**
   * 「这个档案的进度/设置/已读存在哪把键上」—— **全站唯一一处**回答这个问题。
   *
   * `slot` 是档案在名册里的**序号**（不是 id）：
   *   · 0 → 无后缀（分家前那份数据的家，老用户零感知）
   *   · n → `键@pid`
   *
   * ⚠️ 用序号而不是 id 是为了「第一个档案永远指原来的键」——
   *    即使用户把第一个删掉、名册重排，历史数据也仍在看得见的那一份上。
   *    （`remove()` 里对此有专门处理：删第一个会把它的数据与第二个对调后再删。）
   */
  function keyFor(base, slot, pid) {
    var b = String(base || "");
    if (!slot) return b;                          // 序号 0：老键，不加后缀
    return b + SEP + String(pid || "");
  }

  /* ---------------------------------------------------------------- 名册操作 */

  /**
   * 名册 + 是否「已分家」。
   *
   * **名册为空 ≠ 没有档案**：老用户没建过档案，他手上那份昵称与进度
   * 就是唯一的档案（序号 0）。这一层不写盘、不造数据 ——
   * 只是「如实报出：现在有一个 implied 的档案」。
   * 真正落盘发生在用户「再建一个」的时候（`ensure()`）。
   */
  function roster(store) {
    var r = readRoster(store);
    var list = r.profiles.slice();
    var implied = !list.length;
    if (implied) {
      list = [{ id: "", nickname: "", avatar: { char: "", ink: "" }, born: 0 }];
    }
    return { v: 2, profiles: list, current: implied ? "" : r.current, implied: implied };
  }

  /** 当前选中的档案（永远有一个，哪怕名册是空的） */
  function current(store) {
    var r = roster(store);
    if (r.implied) return { profile: r.profiles[0], index: 0, implied: true };
    for (var i = 0; i < r.profiles.length; i++) {
      if (r.profiles[i].id === r.current) return { profile: r.profiles[i], index: i, implied: false };
    }
    return { profile: r.profiles[0], index: 0, implied: false };
  }

  /** 当前档案的序号（键映射用） */
  function index(store) { return current(store).index; }

  function pid(store) {
    var c = current(store);
    return c.implied ? "" : c.profile.id;
  }

  /**
   * 上限：**按已发放的层级判**。
   *
   * ⚠️ 与 `collections.js` 同一条口径 —— 不按 `Entitlement.can()` 判：
   *    那条能力带 `login:true`，「登录过、但会话刚过期」会被判成 free，
   *    症状是「昨天能建 3 个，今天一刷新只剩 1 个」。
   *    这里是产品分层的**软限**（真边界在服务端），按已发放的层级判更稳。
   * ⚠️ 拿不到权益内核时**不设限**（返回 Infinity）—— 脚本顺序不对 / 老缓存时
   *    按 free 卡会让人「突然建不了第二个」，且由加载顺序引起、用户无法自查。
   *    与 `collections.limit()` / `Entitlement.isOwner()` 同一条兜底口径：
   *    **宁可不判，也不误拦**。
   */
  function limit(deps) {
    var d = deps || {};
    var E = d.Entitlement;
    if (d.tier && LIMITS[d.tier] !== undefined) return LIMITS[d.tier];
    if (!E || typeof E.identity !== "function") return Infinity;
    try {
      var id = E.identity() || {};
      var tier = String(id.tier || "free");
      if (id.tierSource && id.tierSource !== "server" && id.tierSource !== "local") {
        /* 认不出来的来源：宁可不判 */
        return LIMITS[tier] !== undefined ? LIMITS[tier] : Infinity;
      }
      return LIMITS[tier] !== undefined ? LIMITS[tier] : LIMITS.free;
    } catch (e) { return Infinity; }
  }

  /** 上限的人话（错因说错 = 让用户白试一遍，所以三档都写出来） */
  function limitText(lim) {
    if (lim === Infinity) return "不限个";
    if (lim === LIMITS.free) return "Free 1 个";
    if (lim === LIMITS.pro) return "Pro 3 个";
    if (lim === LIMITS.max) return "Max 180 个";
    return "上限 " + lim + " 个";
  }

  /** 新档案的 id：`p` + 递增序号，撞了就往后挪（不用随机数，便于人工排查） */
  function nextId(list) {
    var used = {};
    (list || []).forEach(function (p) { used[p.id] = true; });
    for (var i = 1; i < 10000; i++) {
      var id = "p" + i;
      if (!used[id]) return id;
    }
    return "p" + Date.now().toString(36);
  }

  /**
   * 落一次盘：把「还没分家」的现状认定下来（第一个档案正式成立）。
   *
   * 只在用户**真的要第二个档案**时调用 —— 只用一个档案的用户，
   * 盘上永远不会多出这把键（他什么时候升级都是零感知）。
   */
  function ensure(store, deps) {
    var r = readRoster(store);
    if (r.profiles.length) return r;
    /* 第一个档案的 id 从这里开始；昵称留空 = 跟着 `avatar.js` 那份走
       （老用户改名前就是空，界面回落成「Ashley」—— 一个字都不能改） */
    var first = { id: nextId([]), nickname: "", avatar: { char: "", ink: "" }, born: 0 };
    var next = { v: 2, profiles: [first], current: first.id };
    writeRoster(store, next);
    return readRoster(store);
  }

  /**
   * 新建一个档案。**不继承任何数据** —— 新档案是空的，界面必须明白说出来。
   *
   * 返回 `{ ok, profile, code, message }`：
   *   E_LIMIT  已达上限（如实报上限，不说「建不了」）
   *   E_NAME   昵称为空（错因说清楚，别让人猜）
   *   E_WRITE  盘写不上（隐私模式 / 配额满）
   */
  function create(store, name, deps) {
    var lim = limit(deps);
    var r = ensure(store, deps);
    if (r.profiles.length >= lim) {
      return {
        ok: false, code: "E_LIMIT", profile: null,
        message: "子档案已达上限（" + limitText(lim) + "），删掉一个再建"
      };
    }
    var clean = cleanName(name);
    if (!clean) {
      return { ok: false, code: "E_NAME", profile: null, message: "先给这个子档案起个名字" };
    }
    var fresh = { id: nextId(r.profiles), nickname: clean, avatar: normAvatar(null), born: 0 };
    var next = { v: 2, profiles: r.profiles.concat([fresh]), current: fresh.id };
    if (!writeRoster(store, next)) {
      return { ok: false, code: "E_WRITE", profile: null, message: "这个浏览器存不下，换个浏览器或检查隐私模式" };
    }
    return { ok: true, code: "", profile: fresh, message: "已新建「" + clean + "」，它是一个全新的空档案" };
  }

  /**
   * 切换当前档案。返回 `{ ok, changed }`。
   * **切到同一个不算改动**（返回 changed:false，界面据此不重画整页）。
   */
  function select(store, id) {
    var r = readRoster(store);
    var hit = r.profiles.filter(function (p) { return p.id === String(id); })[0];
    if (!hit) return { ok: false, code: "E_NOT_FOUND", changed: false, message: "没有这个子档案" };
    if (r.current === hit.id) return { ok: true, code: "", changed: false, profile: hit };
    r.current = hit.id;
    if (!writeRoster(store, r)) return { ok: false, code: "E_WRITE", changed: false, message: "切换没能存下来" };
    return { ok: true, code: "", changed: true, profile: hit };
  }

  /** 改名 / 换印（印是固定的字与色，合法值由 `avatar.js` 校验） */
  function update(store, id, patch) {
    var r = readRoster(store);
    var hit = null;
    r.profiles.forEach(function (p) { if (p.id === String(id)) hit = p; });
    if (!hit) return { ok: false, code: "E_NOT_FOUND", message: "没有这个子档案" };
    var p = patch || {};
    if (p.nickname != null) {
      var clean = cleanName(p.nickname);
      if (!clean) return { ok: false, code: "E_NAME", message: "名字不能是空的" };
      hit.nickname = clean;
    }
    if (p.avatar != null) hit.avatar = normAvatar(p.avatar);
    if (!writeRoster(store, r)) return { ok: false, code: "E_WRITE", message: "改动没能存下来" };
    return { ok: true, code: "", profile: hit };
  }

  /**
   * 删除一个档案。**最后一个不许删**（删了就没地方背书了）。
   *
   * ⚠️ 两条要命的地方：
   *
   * 1. **「键的序号」要重排**。第一个档案的家是无后缀的老键；删掉它时，
   *    必须把第二个档案的数据搬到无后缀键上 —— 否则它的数据会「找不到」。
   *    （症状不是报错，是「删掉老大之后，老二的进度看着空了」。）
   * 2. **排在后面的档案数据要跟着挪位**。序号是位置，不是 id。
   *    所以删除 = 把被删者之后的每一个档案的键**依次前移一位**。
   */
  function remove(store, id) {
    var r = readRoster(store);
    if (r.profiles.length <= 1) {
      var only = r.profiles.length === 1 ? r.profiles[0].id : "";
      if (only && String(id) === only) {
        return { ok: false, code: "E_LAST", message: "至少要留一个子档案" };
      }
    }
    var at = -1;
    r.profiles.forEach(function (p, i) { if (p.id === String(id)) at = i; });
    if (at < 0) return { ok: false, code: "E_NOT_FOUND", message: "没有这个子档案" };
    if (r.profiles.length <= 1) return { ok: false, code: "E_LAST", message: "至少要留一个子档案" };

    var gone = r.profiles[at];
    var rest = r.profiles.slice(0, at).concat(r.profiles.slice(at + 1));

    /* 先把它那一份数据清掉（清的是**它自己的**那几把键） */
    sharedKeys().forEach(function (base) {
      try { store.removeItem(keyFor(base, at, gone.id)); } catch (e) { /* 盘不可用：不影响名册 */ }
    });

    /* 后面的档案依次前移一位：先搬数据，再改名册。
       ⚠️ 顺序不能反 —— 名册先改的话，搬数据时算出来的「源序号」就错位了 */
    for (var i = at; i < rest.length; i++) {
      shiftSlot(store, rest[i].id, i + 1, i);
    }

    var nextCurrent = r.current === gone.id ? rest[Math.min(at, rest.length - 1)].id : r.current;
    var next = { v: 2, profiles: rest, current: nextCurrent };
    if (!writeRoster(store, next)) return { ok: false, code: "E_WRITE", message: "删除没能存下来" };
    return {
      ok: true, code: "", profile: gone, current: nextCurrent,
      message: "已删除「" + (gone.nickname || "未命名") + "」；它那一份背诵进度与设置也一并删掉了，本机不再留"
    };
  }

  /** 把某个档案的数据从 `from` 序号搬到 `to` 序号（`to` 覆盖，源键清掉） */
  function shiftSlot(store, id, from, to) {
    var keys = sharedKeys();
    /* 先读出来：读的时候源键还在 */
    var buf = keys.map(function (base) {
      var v = null;
      try { v = store.getItem(keyFor(base, from, id)); } catch (e) { v = null; }
      return { base: base, text: v };
    });
    /* 再写目标、清源。目标先写 —— 中途失败也不会两个地方都没有 */
    buf.forEach(function (it) {
      var dst = keyFor(it.base, to, id);
      try {
        if (it.text === null || it.text === undefined) store.removeItem(dst);
        else store.setItem(dst, it.text);
      } catch (e) { /* 单把写不上：其余照旧 */ }
      var src = keyFor(it.base, from, id);
      if (src !== dst) {
        try { store.removeItem(src); } catch (e) { /* 同上 */ }
      }
    });
  }

  /* ---------------------------------------------------------------- 老数据接管 */

  /**
   * 第一次分家时的**零感知接管**：把手上那份昵称搬进第一个档案。
   *
   * 只做一件事：**如果第一个档案还没名字、而盘上有一份昵称，就认领过去**。
   * 进度 / 设置 / 已读**一个字节都不用动** —— 它们本来就在无后缀的老键上，
   * 第一个档案的无后缀规则让它们原地生效。
   *
   * ⚠️ 头像同理：`poem_profile_v1` 里那枚印跟着搬进第一个档案。
   *    不搬的症状是「升级之后印变回默认的诗字」。
   */
  function adopt(store) {
    var r = readRoster(store);
    if (!r.profiles.length) return { ok: true, adopted: false };
    var first = r.profiles[0];
    if (first.nickname || (first.avatar && first.avatar.char)) return { ok: true, adopted: false };

    var legacy = null;
    try { legacy = safeParse(store.getItem("poem_profile_v1")); } catch (e) { legacy = null; }
    var name = "";
    if (legacy && typeof legacy === "object") name = cleanName(legacy.nickname);
    if (!name) {
      /* 更早的家：昵称混在设置对象里（`avatar.js` 的兼容读同一顺序） */
      var s = null;
      try { s = safeParse(store.getItem("poem_recite_settings_v1")); } catch (e) { s = null; }
      if (s && typeof s === "object") name = cleanName(s.username);
    }
    var av = legacy && typeof legacy === "object" ? normAvatar(legacy.avatar) : normAvatar(null);

    first.nickname = name;
    first.avatar = av;
    if (!writeRoster(store, r)) return { ok: false, adopted: false };
    return { ok: true, adopted: true };
  }

  /**
   * 名册与「对外报出的那一个昵称」保持同源。
   *
   * 分家前，昵称住在 `poem_profile_v1`（`avatar.js` 的家）。
   * 分家之后，**名册是正主**：每次切换 / 改名都把它写回 `poem_profile_v1`,
   * 于是顶栏 / 首页 / 设置页那三处画印的地方一个字都不用改
   * （它们读的还是 `Avatar`，只是那份数据现在跟着当前档案走）。
   *
   * ⚠️ 反过来**不自动同步**：用户直接在设置页那个输入框里改名时，
   *    `Avatar.saveNickname()` 写的是 `poem_profile_v1`，
   *    由设置页显式调 `syncCurrentFromProfile()` 把它收进当前档案。
   *    自动监听盘变化没有标准事件（`storage` 事件只跨标签页），不做。
   */
  function mirrorToAvatar(store, deps) {
    var c = current(store);
    var A = (deps || {}).Avatar || null;
    if (!A || typeof A.write !== "function") return false;
    return A.write(store, { nickname: c.profile.nickname || "", avatar: c.profile.avatar || {} });
  }

  /** 把 `poem_profile_v1` 里那份（用户刚在输入框里改的）收进当前档案 */
  function syncCurrentFromProfile(store, deps) {
    var r = readRoster(store);
    if (!r.profiles.length) return { ok: false, code: "E_NOT_SPLIT" };
    var A = (deps || {}).Avatar || null;
    if (!A || typeof A.read !== "function") return { ok: false, code: "E_NO_AVATAR" };
    var p = A.read(store) || {};
    var hit = null;
    r.profiles.forEach(function (x) { if (x.id === r.current) hit = x; });
    if (!hit) return { ok: false, code: "E_NOT_FOUND" };
    hit.nickname = cleanName(p.nickname);
    hit.avatar = normAvatar(p.avatar);
    if (!writeRoster(store, r)) return { ok: false, code: "E_WRITE" };
    return { ok: true, profile: hit };
  }

  return {
    NS: NS, SEP: SEP, NAME_MAX: NAME_MAX, LIMITS: LIMITS, READ_KEYS: READ_KEYS,
    sharedKeys: sharedKeys, isSharedKey: isSharedKey, keyFor: keyFor,
    readRoster: readRoster, writeRoster: writeRoster,
    roster: roster, current: current, index: index, pid: pid,
    limit: limit, limitText: limitText, nextId: nextId,
    ensure: ensure, create: create, select: select, update: update, remove: remove,
    adopt: adopt, mirrorToAvatar: mirrorToAvatar, syncCurrentFromProfile: syncCurrentFromProfile,
    cleanName: cleanName, normAvatar: normAvatar, isId: isId,
    _shiftSlot: shiftSlot
  };
});
