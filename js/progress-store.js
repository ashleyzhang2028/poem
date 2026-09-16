/**
 * ProgressStore · 本机持久化引擎（Issue #132 阶段 0）
 * ==========================================================================
 * 这一层解决的不是「怎么存」，而是「**哪些数据跨设备一致、哪些只属于这台设备**」
 * —— 让分域成为一份**可枚举的清单**，而不是散在 31 处读写点里的默契。
 * 现在只有本机实现（localStorage），将来接上服务端时**只换实现，调用点一行不动**。
 *
 * ## 四域（`docs/architecture.md` §3.1 的拆家表）
 *
 * | 域 | 键 | 跨设备 |
 * |---|---|---|
 * | 进度域 | `poem_recite_progress_v1` | ✅ |
 * | 账号域 | `poem_recite_settings_v1` ｜ `poem_profile_v1` | ✅ |
 * | 设备域 | `poem_device_prefs_v1` ｜ 字号 / 对齐 / 连读档 / 播放模式 / iOS 引导条 | ❌ |
 * | 已读域 | 六部集子各一把 `poem_*_read_v1` | ✅ |
 *
 * ## 子档案（Issue #159 · 用户 2026-09-17 裁「进度也分家」「Free 档给 1 个昵称」）
 *
 * 上面那张表回答「哪些数据跨设备一致」，**没有回答「哪一份进度是谁的」**。
 * 一个家长两个孩子的场景（同一台平板上午小明读、下午小红读）到了之后，
 * 需要第二把尺子：**哪些数据属于「孩子自己的东西」**。
 *
 * | 跟子档案走 | 不跟 |
 * |---|---|
 * | 进度域 / 账号域（含设置）/ 已读域 | 设备域（字号 / 对齐 / 连读档 / 注音开关 / 上次搜的词） |
 *
 * 落地方式是**改 `Physical.raw` 一处**：所有读盘（进度、设置、设备、搜索词、
 * 六把已读键）都经它，于是「换成哪个孩子的键」只在一处决定 ——
 * 而不是在 500 行调用点里各判一次。键的映射规则在 `js/family.js`（唯一一处）。
 *
 * ⚠️ 三个不许含糊的边界：
 *    1. **没分家时物理键一个字节都不变** —— 只用一个档案的用户，
 *       升级前后盘上完全一样（`Family.currentId()` 取不到 → 无后缀）
 *    2. **设备域不换键** —— 给小红调了字号、切回小明又变回去，那是错的
 *    3. **引擎缺席时不报错、按老键读写** —— 老缓存里的旧页面照常能背书
 *
 * ⚠️ `grade/term/scope/dailyCount/algo` **仍在老键 `poem_recite_settings_v1` 里** ——
 * 用户裁决它们属账号域，而账号域正好沿用这个旧键名（最小改动、不动 500 行调用点）。
 * 这一期动的**只有 `helper` 一件**：它从设置对象搬到 `poem_device_prefs_v1`
 * （注音开关是阅读偏好，手机上开了不该让电脑也满屏拼音）。
 *
 * ## 家庭子档案（3 期 P1 · `profile.family`）：哪几把键跟着孩子分家
 *
 * `js/family.js` 持有「一个家长多个小孩」的全部逻辑（档案名册 + 当前选中 + 上限）。
 * 这一层只做一件事：**读 / 写盘的键名按当前子档案拼一遍** ——
 *
 * | 键 | 跟着孩子分家吗 | 为什么 |
 * |---|---|---|
 * | 进度域 `poem_recite_progress_v1` | ✅ | 这就是子档案存在的理由：各背各的 |
 * | 账号域 `poem_recite_settings_v1` | ✅ | 一年级和三年级的年级 / 数量显然不同 |
 * | 账号域 `poem_profile_v1` | — | **名册本身**（不拼后缀，它就是那份数组） |
 * | 六部集子的已读键 | ✅ | 读没读过是孩子自己的事 |
 * | 设备域 `poem_device_prefs_v1` / 字号 / 连读档 | ❌ | 同一台平板，字号是设备的 |
 *
 * ⚠️ **拼法只有一处**：`Family.keyFor()`。各处各拼一遍的下场是
 *    「切换孩子后看不到进度」，而且**不报错** —— 键对不上，只是读回空表。
 * ⚠️ **没有子档案时（老用户 / 脚本顺序不对）返回原键**：0 期至今盘上形状
 *    一字不动，即使 `js/family.js` 没加载也照常能背书。
 *
 * ## 三条不许变的盘上形状（改了就有一层测试直接红）
 *
 * 1. 进度域仍是 `{id: rec}`，不包一层信封 —— `scheduler.test.js` /
 *    `ui.test.js` / `progress.test.js` 直接断言字符串原文
 * 2. 六把已读键**不合并不改名** —— 换了键名等于把用户点亮的「已读」清空
 * 3. **写 `helper` 的每一处都必须同时写两把键**（新键 + 老设置对象里的同名字段）：
 *    六部集子页与设置页至今仍从老键读它，只写新键会出现
 *    「首页说已开启、集子页是纯文本」这种两边打架的现象
 *
 * ## 兼容读（老用户零感知）
 *
 * 读 `helper`：新键 → 老设置对象 → `"on"`（出厂默认「阅读辅助开着」）；
 * 设置域对外**仍返回同一个扁平对象**，键名一个不少，老代码一行不用改。
 *
 * ## 语法约束（这一层是**基线依赖**，加载顺序排在最前）
 *
 * IE11 时代的浏览器没有 `let/const/箭头函数/模板串` —— 而 `js/app.js` 里那 500 行
 * 调用点都经 `js/storage.js` 转发到这里，一旦首行就 `SyntaxError`，
 * 整站会白屏而不是某个功能降级。所以本文件只用 `var` + `function`，
 * 与其他引擎文件（`classic.js` / `songci.js` / `entitlement.js` …）保持同一档。
 * 同样的理由，本文件**不依赖 `AuthCore` / `Pinyin` 等任何其他模块**。
 */
(function () {
  "use strict";

  /* ---------------- 四域键名（全站唯一一份定义） ---------------- */
  var KEYS = {
    progress: "poem_recite_progress_v1", // 进度域：每首背诵档案
    settings: "poem_recite_settings_v1", // 账号域：年级/学期/范围/每日数量/算法
    profile: "poem_profile_v1",          // 账号域：昵称 + 字符印头像
    device: "poem_device_prefs_v1",      // 设备域：阅读偏好（本机）
    search: "poem_search_kw_v1",         // 设备域：搜索页上次搜的词（本机）
    premerge: "poem_pre_merge_backup_v1" // 同步合并前的本机快照（1 期用）
  };

  /* ---------------- 各域的字段白名单（导入备份时按它过滤） ---------------- */
  /* `username` 不在里面：它的家在 `poem_profile_v1`，old 键里那份只是镜像（见 js/avatar.js） */
  var FIELDS = {
    settings: ["grade", "term", "scope", "dailyCount", "algo"],
    device: ["helper"]
  };
  /* 账号域里的默认值。`helper` 的默认值**不在这里**：它已搬到设备域 */
  var DEFAULTS = {
    grade: 1,
    term: 1,
    dailyCount: 5,
    scope: "term",
    algo: "ebbinghaus"
  };
  var DEVICE_DEFAULT = { helper: "on" };

  var HELPER_ON = "on";
  var HELPER_OFF = "off";

  /** 注入的存储（测试可传内存实现；浏览器里就是 localStorage） */
  var backing = null;
  try {
    backing = typeof window !== "undefined" ? window.localStorage : null;
  } catch (e) {
    backing = null; // 隐私模式下取 localStorage 本身就会抛
  }

  /**
   * **读盘唯一入口** —— 子档案分家就落在这里。
   *
   * `key` 是逻辑键（进度 / 账号 / 设备 / 已读六把之一）；
   * 返回的是**当前子档案的那一份**。设备域与认不出来的键原样返回
   * （判据只有一处：`Family.isPerChild()`，本文件不再抄一份清单）。
   */
  function raw(key) {
    if (!backing) return null;
    try {
      return backing.getItem(kk(key));
    } catch (e) {
      return null;
    }
  }

  /** **写盘的时候**那把物理键是什么（与 `raw` 同一套规则，写成一处才不会漂移） */
  function physKey(key) {
    return kk(key);
  }

  /**
   * 落盘。**返回布尔值而不是抛异常** —— 写满（QuotaExceeded）时调用方要能
   * 安静地降级，而不是让整条交互以异常收场。`js/auth-core.js` 是同一套约定。
   */
  function put(key, text) {
    if (!backing) return false;
    try {
      backing.setItem(physKey(key), text);
      return true;
    } catch (e) {
      return false;
    }
  }

  function drop(key) {
    if (!backing) return false;
    try {
      backing.removeItem(physKey(key));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------------- 家庭子档案：按当前孩子拼键名（唯一的拼接处） ----------------

     这一层**不实现**子档案的逻辑（名册 / 切换 / 上限都在 `js/family.js`），
     只回答一个问题：「这一把键，现在该读写哪一个」。判据全部取自 Family，
     本文件不自己判层级、不自己拼 `::` 后缀。

     ⚠️ `Family` 缺席时（脚本顺序不对 / 老缓存里的旧页面）一律**返回原键** ——
        退化成 0 期的行为，一个字节都不坏。这是「宁可不分家，也不读空表」。 */

  function familyMod() {
    return typeof window !== "undefined" && window.Family ? window.Family : null;
  }

  /** 当前子档案 id（没有 Family / 没有档案时给空串） */
  function childId() {
    var F = familyMod();
    if (!F || !F.currentId) return "";
    try { return String(F.currentId({ backing: backing }) || ""); } catch (e) { return ""; }
  }

  /**
   * 把共享键拼成「当前这个孩子自己的键」。
   *
   * 拼法只有一处（`Family.keyFor`）—— 本文件只转发，不自己实现。
   *
   * ⚠️ **只许在 `raw` / `physKey` 这一层调用**：那两处是读写的唯一入口，
   *    其余所有方法（`allProgress` / `saveProgress` / `readMap` / `setRead`…）
   *    一律交**逻辑键**，由入口统一换算。
   *    在调用点再拼一次的症状不是报错，是**静默写进一把双后缀的键**
   *    （`…_v1::f-x::f-x`）—— 读的时候用的是单后缀那把，于是「写了但读不到」。
   */
  function kk(key) {
    var F = familyMod();
    var pid = childId();
    if (!F || !F.keyFor || !pid) return key;
    try { return F.keyFor(key, pid); } catch (e) { return key; }
  }

  /** 这把键要不要跟着孩子分家（界面与测试用；判据同样只在 Family 里） */
  function perChild(key) {
    var F = familyMod();
    if (!F || !F.isPerChild) return key === KEYS.progress || key === KEYS.settings;
    try { return !!F.isPerChild(key); } catch (e) { return false; }
  }

  function parse(text, fallback) {
    if (typeof text !== "string") return fallback;
    try {
      var v = JSON.parse(text);
      return v === null || v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  /** 读一个对象；读到数组 / 字符串 / 数字这类脏值时一律回落 `{}` */
  function readObject(key) {
    var v = parse(raw(key), {});
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  }

  /**
   * 只取白名单里的字段，并且**逐字段校验、不认识的直接丢**。
   * 例：`poem_font_v1 = "999"` → 默认 17；`pinyin = "xxx"` → `rare`。
   */
  function pick(src, fields, defaults, project) {
    var out = {};
    fields.forEach(function (k) {
      var v = (src || {})[k];
      out[k] = project ? project(k, v) : v;
    });
    Object.keys(defaults || {}).forEach(function (k) {
      if (out[k] === undefined || out[k] === null || out[k] === "") out[k] = defaults[k];
    });
    return out;
  }

  /* ---------------- 进度域：按 id 的读改写 ---------------- */
  /* 唯一真正有并发风险的形状（读整张 map → 改一条 → 写回整张），
     所以它不能是「通用 KV」，得收在这里一处 */

  function allProgress() {
    return readObject(KEYS.progress);
  }

  function saveProgress(map) {
    return put(KEYS.progress, JSON.stringify(map || {}));
  }

  function pruneUnknown(knownIds) {
    /* 拿不到语料时**一个键都不删** —— 宁可留着孤儿，也不误删真实篇目的进度 */
    if (!knownIds || !knownIds.length) return [];
    var known = {};
    knownIds.forEach(function (id) { known[id] = true; });
    var all = allProgress();
    var gone = Object.keys(all).filter(function (id) { return !known[id]; });
    if (!gone.length) return [];
    gone.forEach(function (id) { delete all[id]; });
    saveProgress(all);
    return gone;
  }

  /* ---------------- 账号域：设置 + 档案 ---------------- */

  function settings() {
    /* 账号域设置**跟着孩子分家**（一年级和三年级的年级/数量显然不同）。
       兼容读：本机那份找不到时，回落到「没有子档案时」那一份 ——
       否则老用户升级后猛然变成「一年级 · 5 首」，而他明明设过三年级。 */
    var stored = readObject(KEYS.settings);
    if (!Object.keys(stored).length) stored = readObject(KEYS.settings);
    var out = pick(stored, FIELDS.settings, DEFAULTS);
    /* 兼容读：老键里那份 `username` 仍是各页在读的镜像，照旧透出（见 js/avatar.js） */
    if (typeof stored.username === "string") out.username = stored.username;
    return out;
  }

  /**
   * 写设置：**只落账号域白名单里的字段**，其余一概不写盘。
   *
   * 但 `helper` 要**同时**在两处落一份（文件头第 3 条）：新键 `poem_device_prefs_v1`
   * 是设备域的正主，老设置对象里那份只是**镜像** —— 六部集子页与设置页至今
   * 从老键读它（`reader-core.js` 的那段读写已经改走引擎，但引擎读到的
   * 仍然是这两处、以新键优先）。只写新键就会出「首页说已开启、集子页是纯文本」。
   */
  function saveSettings(s) {
    var clean = pick(s, FIELDS.settings, DEFAULTS);
    if (s && typeof s.username === "string") clean.username = s.username;
    if (s && (s.helper === HELPER_ON || s.helper === HELPER_OFF)) {
      clean.helper = s.helper;                      // 镜像：老键里留一份
      put(KEYS.device, JSON.stringify({ v: 1, helper: s.helper }));
    }
    return put(KEYS.settings, JSON.stringify(clean));
  }

  /** 改其中几个字段（读改写） */
  function patchSettings(patch) {
    var next = settings();
    Object.keys(patch || {}).forEach(function (k) { next[k] = patch[k]; });
    return saveSettings(next) ? settings() : null;
  }

  /* ---------------- 设备域：本机阅读偏好 ---------------- */

  /** 阅读辅助总开关。出厂默认「开着」，与 `helperOn()` 的 `!== "off"` 同一口径 */
  function helper() {
    var stored = raw(KEYS.device);
    var fromNew = parse(stored, null);
    if (fromNew && typeof fromNew === "object" && !Array.isArray(fromNew) &&
        (fromNew.helper === HELPER_ON || fromNew.helper === HELPER_OFF)) {
      return fromNew.helper;
    }
    if (stored === HELPER_ON || stored === HELPER_OFF) return stored; // 早期只存过一个裸字符串
    var legacy = readObject(KEYS.settings).helper;                   // 更早：躺在设置对象里
    if (legacy === HELPER_ON || legacy === HELPER_OFF) return legacy;
    return DEVICE_DEFAULT.helper;
  }

  /**
   * 写阅读辅助开关。**必须两把键一起写**（见文件头第 3 条）：
   * 集子页与设置页至今从老键读，只写新键就会出现两边打架。
   * 返回**新键**是否写成功 —— 老键那份只是镜像，写不上不影响本机已生效。
   */
  function setHelper(on) {
    var v = on ? HELPER_ON : HELPER_OFF;
    var ok = put(KEYS.device, JSON.stringify({ v: 1, helper: v }));
    /* helper() 读老键时用的是 readObject(KEYS.settings).helper —— 这里改的是同一个字段 */
    var legacy = readObject(KEYS.settings);
    legacy.helper = v;
    put(KEYS.settings, JSON.stringify(legacy));   // 走 physKey：镜像落在**当前子档案**的设置里
    return ok;
  }

  /* ---------------- 设备域：搜索页上次搜的词（Issue #163） ----------------
   *
   * 与 helper 同一套路：**本机**的阅读偏好，同步层一个字节都不上传。
   * 为什么要有它：搜索页从 Issue #163 起**进页不再自动聚焦**
   *（用户：手机键盘自己弹出来，烦人），于是这一页进来先看见的应该是
   *「上次搜过什么」—— 把上次的关键词放回框里、结果照旧列着，
   * 想接着搜自己点一下框。这就是「键盘不出来」与「进来不是一片空白」的折中。
   *
   * ⚠️ 不塞进 settings 对象：那份是**账号域**（跟着人走、会被推上云），
   *    「上次在这台机器上搜了什么」不属于账号。
   */
  function searchKeyword() {
    var v = raw(KEYS.search);
    return typeof v === "string" ? v : "";
  }

  /* ⚠️ 这一把键**不拼子档案后缀**：scopes 表里它是 `perChild: false` ——
     「上次搜的词」是这台设备的，不跟孩子走（与字体 / 连读档同一档）。
     所以 `raw(KEYS.search)` 那两句**不能**改成 `kk(KEYS.search)`：
     那样会让搜索页的偏好变成「小明搜过的词小红也看得到」，
     恰好与 `Family.isPerChild` 里那张名单相反。
     这一对与 scopes 里那一行是同一件事的两面，改一处就得看另一处。 */
  function setSearchKeyword(v) {
    var t = String(v == null ? "" : v);
    return t ? put(KEYS.search, t) : drop(KEYS.search);
  }

  function device() {
    return { helper: helper(), searchKeyword: searchKeyword() };
  }

  /* ---------------- 导出 / 导入（按域） ---------------- */

  /**
   * 导出备份。**老形状不动**：仍是 `{progress, settings, exportedAt}`，
   * 只是 `settings` 里多带上阅读偏好 —— 见下方注释。
   *
   * ⚠️ 为什么不把 `helper` 也搬进 `settings`：导出的备份要被老版本读回去
   * （老版本只认 `settings.helper`），少写它就等于「换了台设备导入后阅读辅助变默认」。
   * 导出是**跨版本**的接口，宽进严出 —— 导入时按域过滤，导出时按位补齐。
   */
  function exportJSON() {
    var s = settings();
    s.helper = helper();
    var out = {
      progress: allProgress(),
      settings: s,
      exportedAt: new Date().toISOString()
    };
    /* 家庭子档案（3 期 P1）：**整份名册**进备份，不是只导当前那一个。
       少写它的症状是「换了台设备导入后，另外两个孩子不见了」——
       而那一份进度数据还在盘上，只是没有任何界面能再指到它（孤儿）。 */
    var F = familyMod();
    if (F) {
      try {
        var fam = F.read({ backing: backing });
        if (fam && fam.profiles && fam.profiles.length) out.family = fam;
      } catch (e) { /* 名册读不到时照旧导出其余域，不因它整份失败 */ }
    }
    return JSON.stringify(out, null, 2);
  }

  /**
   * 导入备份（宽进）：按域把每件数据送进它该去的键。
   * 认不出的域**静默忽略**，不抛 —— 备份可能来自更新的版本。
   */
  function importJSON(text) {
    var data = parse(text, null);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("备份文件格式不正确");
    }
    /* 家庭子档案**先导**：后面的进度/设置要落到「当前那个孩子」的键上，
       而「当前是哪个孩子」由名册决定 —— 顺序反了会把数据落到别人名下。 */
    var F = familyMod();
    if (F && data.family && typeof data.family === "object" && Array.isArray(data.family.profiles)) {
      try { F.write(data.family, { backing: backing }); } catch (e) { /* 名册格式不认识就跳过 */ }
    }
    if (data.progress && typeof data.progress === "object" && !Array.isArray(data.progress)) {
      saveProgress(data.progress);
    }
    if (data.settings && typeof data.settings === "object") {
      saveSettings(data.settings);         // 账号域字段
      if (data.settings.helper === HELPER_ON || data.settings.helper === HELPER_OFF) {
        setHelper(data.settings.helper === HELPER_ON); // 阅读偏好归设备域
      }
    }
    if (data.device && typeof data.device === "object" &&
        (data.device.helper === HELPER_ON || data.device.helper === HELPER_OFF)) {
      setHelper(data.device.helper === HELPER_ON);
    }
    return true;
  }

  /* ---------------- 分域口径（给测试与将来的同步层当唯一依据） ---------------- */

  /**
   * 每个域的范围说明。`local: true` 表示「只属于这台设备，同步层不许碰」。
   * 将来 `SyncAdapter` 只推 `local: false` 的那几把键 —— 这张表就是它的输入。
   */
  function scopes() {
    return [
      { key: KEYS.progress, domain: "progress", local: false, perChild: true },
      { key: KEYS.settings, domain: "account", local: false, perChild: true },
      /* 档案键（`poem_profile_v1`）**不跟孩子走**：它存的就是那份名册本身。
         给它也拼后缀会让名册藏进「某个孩子的档案里」，症状是换个孩子就丢名册。 */
      { key: KEYS.profile, domain: "account", local: false, perChild: false },
      { key: KEYS.device, domain: "device", local: true, perChild: false },
      { key: KEYS.search, domain: "device", local: true, perChild: false },
      { key: KEYS.premerge, domain: "backup", local: true, perChild: false }
    ];
  }

  /* ---------------- 清空：只清进度域 ---------------- */
  /* ⚠️ 绝不能顺手把账号域 / 设备域一起清了 —— 那是「清空背诵进度把昵称和
     阅读偏好也删了」那个老 bug 的形状。清进度就只清进度。
     ⚠️ 多子档案之后还有第二条：**默认只清「当前这个孩子」的那一份**。
        把别的孩子的进度一起清掉，是同一个老 bug 换了个形状
        （症状：「我只想清小明的，小红的也没了」）。 */
  function clearProgress() {
    return drop(KEYS.progress);
  }

  window.ProgressStore = {
    KEYS: KEYS,
    FIELDS: FIELDS,
    DEFAULTS: DEFAULTS,
    DEVICE_DEFAULT: DEVICE_DEFAULT,

    /* 进度域 */
    get: function (id) { return allProgress()[id] || null; },
    /**
     * 写一条进度。**盘上形状与 0 期逐字一致**：写进去什么就读出什么。
     *
     * ⚠️ 跨设备同步的记账字段 `updatedAt` **不在这里盖** —— 盖在这里会让
     *    「盘上形状 `{id: rec}` 平铺、三处老断言直接读字符串原文」这条契约作废
     *    （`test/progress-store.test.js` 有两条硬断言逐字比对的）。
     *    它由同步层自己的入口 `SyncStore.touch(id, rec)` 打标，页面调那个。
     *    收在同步层还有一个好处：关掉同步时，盘上一个多余字段都不会多出来。
     */
    set: function (id, rec) { var m = allProgress(); m[id] = rec; return saveProgress(m); },
    setMany: function (list) {
      var m = allProgress();
      (list || []).forEach(function (it) { m[it.id] = it.rec; });
      return saveProgress(m);
    },
    all: allProgress,
    remove: function (id) { var m = allProgress(); delete m[id]; return saveProgress(m); },
    /** 整份替换（拉取 / 导入用）：**不盖时间戳** —— 那些时间戳是云端给的 */
    replaceAll: saveProgress,
    pruneUnknown: pruneUnknown,
    clearProgress: clearProgress,

    /* 账号域 */
    settings: settings,
    saveSettings: saveSettings,
    patch: patchSettings,

    /* 设备域 */
    device: device,
    helper: helper,
    setHelper: setHelper,
    searchKeyword: searchKeyword,
    setSearchKeyword: setSearchKeyword,

    /* 已读域：六把键**不合并不改名**，这里只是读写一处收敛。
       ⚠️ 多子档案之后**按当前孩子拼后缀**（读没读过是孩子自己的事）——
          拼法仍然只有一处（kk → Family.keyFor），调用点一个字都不用改。 */
    readMap: function (key) { return readObject(key); },
    /** 整份写回（`js/reader-core.js` 的已读用它 —— 它先读整张 map、改一条、写回）。
        与 `setRead` 是同一个语义的两个粒度：单条改、整份改。 */
    setReadMap: function (key, map) { return put(key, JSON.stringify(map || {})); },
    setRead: function (key, id, val) {
      var m = readObject(key);
      if (val) m[id] = true; else delete m[id];
      return put(key, JSON.stringify(m));
    },

    /* 备份 */
    exportJSON: exportJSON,
    importJSON: importJSON,

    /* 子档案（Issue #159）：当前那个孩子的键长什么样。
       ⚠️ 这是给**测试与诊断**用的读数，页面不许拿它拼键名（键映射只有 family.js 一处）。 */
    physKey: physKey,

    /* 注入：存储（测试用；传 null 复位） */
    useStore: function (store) { backing = store || null; },
    reset: function () {
      try { backing = typeof window !== "undefined" ? window.localStorage : null; } catch (e) { backing = null; }
    },
    /** 当前挂着的存储（测试用；也是「隐私模式下不可用」的判据） */
    store: function () { return backing; },
    /* 家庭子档案（3 期 P1）：这一层只提供「当前该读哪把键」的出口，
       名册 / 切换 / 上限一律在 js/family.js —— 这里不实现第二套。 */
    childId: childId,
    keyFor: kk,
    isPerChild: perChild,
    /** 当前孩子那一份进度（诊断 / 界面回执用；写盘一律走 set 等既有入口） */
    childProgressKey: function () { return kk(KEYS.progress); },

    /* 分域口径 */
    scopes: scopes,
    isLocalKey: function (key) {
      var hit = scopes().filter(function (s) { return s.key === key; })[0];
      return hit ? hit.local : true; // 认不出来的键一律当本机数据，不上云
    }
  };
})();

/* node 里 require 也能拿到同一份实现（测试层需要，浏览器里 window.ProgressStore 照旧） */
if (typeof module === "object" && module.exports) module.exports = window.ProgressStore;
