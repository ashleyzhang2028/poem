/**
 * SyncStore · 跨设备同步层（Issue #132 · 1 期 1B）
 * ==========================================================================
 * `js/progress-store.js`（0 期）解决的是「**哪些数据跨设备一致、哪些只属于这台设备**」
 * —— 它交出一份可枚举的分域清单，但**只推不拉**：盘上那份始终是本机自己写的。
 * 本文件补上这一步：把**账号域**（进度 + 账号域设置 + 已读）与云端对起来。
 *
 * ## 四条不可退让的边界（1A 立的，1B 一条都不许破）
 *
 * 1. **同步失败不打断背诵** —— 断网、后端挂了、超时、接口 500，
 *    表现一律是「这一次没同步上」，而不是弹窗、不是报错、更不是背不了。
 *    所有网络调用都包在 `guard()` 里，**任何异常都在这里被吞掉**。
 * 2. **本机那份始终完整** —— 云端不是唯一副本（`docs/architecture.md` §1.3）。
 *    关掉开关、退出登录、后端整体停摆，本机进度一字不少。
 * 3. **设备域一律不出本机** —— 字号 / 对齐 / 连读档 / 注音开关：手机上想要拼音，
 *    不该让电脑也满屏拼音。判据只认 `ProgressStore.isLocalKey()`，一处说了算。
 * 4. **不假装同步过** —— 没登录、没开开关、服务端没配好，
 *    `status()` 如实说 `off` / `signin` / `unavailable`，
 *    界面上不许出现「已同步」这种话。这是 1A「不假装有服务器」的同一条纪律。
 *
 * ## 怎么知道「哪一条是本机改的、哪一条是云端拉回来的」
 *
 * 每条记录带一个 `updatedAt`，由**本机写盘那一刻**打上。四个时刻各有一个坑：
 *
 *   · 云端推下来的记录 → 落盘时**保留云端的 updatedAt**，并记进 `seen`
 *     （否则「刚拉回来的 N 条」会在下一轮被当成「本机改的 N 条」又推回去，
 *      来回打转、白白刷爆免费档流量）
 *   · 本机改的记录 → `updatedAt = now()`，且比盘上那份新才写
 *     （手机上刚背完、云端回一个三天前的旧值，绝不能把本机那条**回退**）
 *   · 删除 → 不是删键，是**墓碑** `{deleted:true, updatedAt}`
 *     （直接删键的话，另一台设备下一次 pull 会把它当成「云端还有」又推回来）
 *   · `seen[poemId] < 0` → **冲突标记**：两边都有、又判不出来源，
 *     那时**不自动合并**，等用户在界面上选（docs §4.4 D 项）
 *
 * ## 开关（用户裁决：默认本地，docs §4.2）
 *
 * `poem_sync_pref_v1 = { v:1, enabled:false }` —— 出厂**关着**。
 * 关掉即完全退回 0 期行为：不发一个请求、不留一处云端痕迹。
 *
 * ## 语法与依赖
 *
 * 与 `progress-store.js` / `storage.js` 同一档（只用 var + function，
 * 没有箭头函数 / 模板串 / const-let）—— 这一层要在老 WebView 上被解析，
 * 首行 SyntaxError 会让整站白屏而不是某个功能降级。
 *
 * 依赖方向**单向**：本文件认 `ProgressStore`（读盘、合并、写盘都经它），
 * `ProgressStore` **不认识**本文件 —— 于是「关掉同步」只是这一层不工作，
 * 盘上的分域口径一字不变。
 */
(function () {
  "use strict";

  var NS = {
    pref: "poem_sync_pref_v1",      // 开关（**设备域**：本机自己决定要不要上传）
    /* 记账表（**账号域 × 子档案**）：每条记录「见过的最后一次云端时间戳」+ 游标。
       ⚠️ 它必须跟着孩子分家（见 `seenKey()`）—— 不分家的症状极难查：
          **两个孩子的冲突混在一张表里**，于是界面上弹的
          「保留本机 / 保留账号」争的是**别人家孩子**的那一条。 */
    seen: "poem_sync_seen_v1",
    premerge: "poem_pre_merge_backup_v1"  // 合并前静默快照（「保留账号」前的后悔药）
  };

  /**
   * 「当前是哪个孩子」——同步这一层只认这一件事（`docs/architecture.md` §5.5）。
   *
   * ⚠️ 取不到 `Family` 时给空串（不是报错、也不是「随便挑一个」）：
   *    空串恰好就是**分家之前那一份**的键，于是老缓存里的旧页面、
   *    或 `Family` 没加载上的页面，行为与分家之前**逐字相同**。
   *    服务端 `childId()` 的口径与此完全一致（空串 = 第一个孩子那一份）。
   */
  function childId() {
    var g = typeof window !== "undefined" ? window.Family : null;
    if (!g || typeof g.currentId !== "function") return "";
    /* ⚠️ **显式传当前存储**（`backing()`），不用 Family 自己的默认盘。
       两者在这层里正常情况下是同一个（都是 localStorage），但在
       「注入存储」的场景（测试、将来换存储实现）里不是 ——
       那时 Family 读默认盘得到空串，而同步层读写的是注入那块盘，
       症状是「所有数据都落在第一个孩子那一档」，看着像分家没生效。 */
    try {
      var b = backing();
      return String(b ? g.currentId({ backing: b }) : g.currentId()) || "";
    } catch (e) { return ""; }
  }

  /** 一次最多推几条 —— 与服务端 `E_TOO_MANY`（2000）留出余量 */
  var CHUNK = 500;
  /** 单次请求最长等待：超过就当作「这一轮没同步上」，不阻塞任何交互 */
  var TIMEOUT_MS = 15000;

  /**
   * 记账表的**真键**：跟着当前孩子走。
   *
   * ⚠️ 拼法只有一处（这里）—— 各处各拼一遍的下场与 `Family.keyFor` 那条一样。
   *    这把键**不在** `ProgressStore.KEYS` 里（它是同步层自己的簿记），
   *    所以走不了 `Family.keyFor` 的转发，只能在本文件里显式拼一次。
   */
  function seenKey() {
    var cid = childId();
    return cid ? NS.seen + "::" + cid : NS.seen;
  }

  var deps = {};

  /* 事件名只在**一处**定义：发事件与订阅者拼名字的地方各写一遍字面量，
     早晚有一天只改了一处，订阅者从此静默收不到（不报错、只是不刷新）。 */
  var EVT = {
    applied: "sync:applied",     // 云端有新东西落盘（界面可据此重绘）
    conflict: "sync:conflict",   // 出现「判不出来源」的冲突，需要用户选
    state: "sync:state"          // 开关 / 可同步状态变了（界面重绘徽章）
  };

  function norm(v) { return typeof v === "number" && isFinite(v) ? v : 0; }

  /**
   * 取分域引擎。**每次现取**（不缓存启动时那一份）——
   * 页面里的脚本顺序可能与预期不同，缓存一份的后果是「引擎还没加载时缓存了 null，
   * 之后永远是 null」，而症状是**静默不同步**：不报错、只是这条进度没被记下来。
   * 与 `js/storage.js` 的 `PS()` 同一条教训。
   */
  function engine() {
    if (deps.ProgressStore) return deps.ProgressStore;
    var g = typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null);
    return (g && g.ProgressStore) || null;
  }

  /** 当前挂着的存储（与 ProgressStore 同一份：隐私模式下它会给 null） */
  function backing() {
    try { var e = engine(); return (e && e.store && e.store()) || null; } catch (e2) { return null; }
  }

  /* ------------------------------------------------------------ 开关 */

  function pref() {
    var store = backing();
    var text = null;
    try { text = store ? store.getItem(NS.pref) : null; } catch (e) { text = null; }
    if (!text) return { v: 1, enabled: false };
    var o = null;
    try { o = JSON.parse(text); } catch (e) { o = null; }
    if (!o || typeof o !== "object") return { v: 1, enabled: false };
    return { v: 1, enabled: o.enabled === true };
  }

  /**
   * 层级闸：`sync.multiDevice`（Pro 起）。
   *
   * ## 为什么这一层要有闸
   *
   * `/plans/` 的对比表是**当场问内核**算出来的，内核里写着
   * `sync.multiDevice: minTier "pro"` —— 于是页面上公开对用户宣称
   * 「跨设备云同步 = Pro」。而在补这一条之前，全站**0 处**真的拿它拦过谁：
   * 一个 free 用户把设置页那颗开关打开，进度就真的推上去了。
   * 那条公开宣称因此是**假话**（§1 第 3 条「不假装配齐了」）。
   *
   * ## 闸拦在这里，但**不是**唯一一道
   *
   * 真正的边界在**服务端**（`/api/sync/push` / `/api/sync/pull` 会 403）。
   * 这一层拦的是「界面上的动作」——用户手改 localStorage 绕得过它，
   * 但绕不过服务端那一份。两道都要有：
   *   · 只有服务端没有本地闸 → 用户点开开关、看着「开启中」、实际一条都传不上去，
   *     而且失败是静默的（`guard()` 吞掉异常）→「怎么不同步了」根本查不出来
   *   · 只有本地闸没有服务端 → 那才是真的没拦（§3.4：藏入口不是安全边界）
   *
   * ## 两条不许省的规矩
   *
   * ① **拿不到权益内核时不拦**（返回 ok）。与 `collections.limit()` /
   *    `family` 的上限同一条兜底口径：这一层是**产品分层**，不是安全边界；
   *    脚本加载顺序不对 / 老缓存时把内核读成 null，若此时按 free 拦，
   *    症状是「本来有 Pro 的人突然同步打不开」—— 一个由加载顺序引起的、
   *    用户无法自查的功能倒退。「宁可不判，也不误拦」。
   * ② **关掉永远允许** —— 见 `setEnabled()`。Pro 过期之后若连关都关不掉，
   *    症状是「同步一直在传、用户关不了」，那是最糟的形状。
   */
  function gate() {
    var E = deps.Entitlement ||
      ((typeof window !== "undefined" && window.Entitlement) || null);
    /* 「权益层加载好了没」的判据是 `identity`（全站判权的唯一入口）——
       不要求它自己也带 `can`：真身上两个都有，但**只认一个**作判据，
       免得将来某个精简页面只挂了 identity 时被判成「内核没加载」而放行。 */
    if (!E || typeof E.identity !== "function") return { ok: true, hint: "" };
    var id = null;
    try { id = typeof E.identity === "function" ? E.identity() : E.guestIdentity(); } catch (e) { id = null; }
    if (!id || typeof id.can !== "function") return { ok: true, hint: "" };
    var r = id.can("sync.multiDevice");
    return { ok: !!r.ok, hint: r.ok ? "" : (id.hint ? id.hint("sync.multiDevice") : "Pro 起") };
  }

  /**
   * 开关。
   *
   * @returns {{ok:boolean, enabled:boolean, code?:string, hint?:string}}
   *   `code` = "E_TIER" 时是**层级不够**（不是坏掉）—— 界面据此说「Pro 起」，
   *   而不是说「打不开」。错因说错 = 让用户白试一遍。
   *
   * ⚠️ **打开要过闸，关掉不过闸**。关掉不过闸是刻意的：
   *    一个 Pro 用户的层级过期之后，若「关」也被拦住，症状就是
   *    「同步还在传，用户关不掉」—— 而关掉同步只是停上传，不需要任何权限。
   */
  function setEnabled(on) {
    var want = !!on;
    if (want) {
      var g = gate();
      if (!g.ok) return { ok: false, enabled: enabled(), code: "E_TIER", hint: g.hint };
    }
    var b = backing();
    if (!b) return { ok: false, enabled: enabled(), code: "E_STORAGE" };   // 隐私模式：不假装落上了
    var next = { v: 1, enabled: want };
    try { b.setItem(NS.pref, JSON.stringify(next)); }
    catch (e) { return { ok: false, enabled: enabled(), code: "E_STORAGE" }; }
    emit(EVT.state, { enabled: next.enabled });
    return { ok: true, enabled: next.enabled };
  }

  function enabled() { return pref().enabled; }

  /** 对外只读：这一项该不该置灰。返回 { ok, hint }（与 speech.js 的 allowed() 同款） */
  function allowed() { return gate(); }

  /* ------------------------------------------------------------ 打标 */

  /**
   * 读同步记账表：`{poemId: 见过的云端时间戳}`。
   *
   * ⚠️ **不能用 `ProgressStore.readMap` / `setRead`** —— 那两个是「已读」语义，
   *    只存布尔（`if (val) m[id] = true`）：时间戳 `0` 会被丢掉、`-1`（冲突标记）
   *    会被读成 `true`、`9000` 会被读成 `true`。
   *    把数字塞进去的症状极其隐蔽：**表面上都「有值」**，
   *    于是「刚拉的又被推回去」、冲突永远判不出来、游标永远是 0（每轮全量拉）。
   *    这一张表有自己的读写，与「已读」不是一回事。
   */
  function readSeen() {
    var b = backing();
    if (!b) return {};
    var text = null;
    try { text = b.getItem(seenKey()); } catch (e) { return {}; }
    if (!text) return {};
    var o = null;
    try { o = JSON.parse(text); } catch (e) { return {}; }
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  }

  function writeSeen(map) {
    var b = backing();
    if (!b) return false;
    try { b.setItem(seenKey(), JSON.stringify(map || {})); return true; }
    catch (e) { return false; }
  }

  function markSeen(poemId, ts) {
    if (!poemId) return false;
    var m = readSeen();
    m[poemId] = Math.round(norm(ts));
    return writeSeen(m);
  }

  function markSeenMany(pairs) {
    if (!pairs || !pairs.length) return false;
    var m = readSeen();
    pairs.forEach(function (p) { if (p && p.id) m[p.id] = Math.round(norm(p.ts)); });
    return writeSeen(m);
  }

  /**
   * 本机改动的打标：`updatedAt = now`（比盘上那份旧就 +1，防时钟回拨）。
   *
   * ⚠️ **刻意不写 `seen`**：`seen` 记的是「云端最后给这一条的时间戳」，
   *    本机改动不改变那个事实。写进去的后果是「本机改动看起来已被云端对齐」，
   *    于是这一条永远推不上去 —— 用户的进度就这么安静地留在了本机。
   *    推成功之后才由 `pushPending` 把「云端已经收下了」的事实记回 `seen`。
   */
  function touch(poemId, rec) {
    if (!engine()) return rec;
    /* 同步**关着**时原样落盘、一个字段都不多：
       `updatedAt` 是同步的记账字段，不打算同步的人不该在盘上看到它。
       ——「我不开同步」这件事在数据上也应当是干净的。
       （返回值统一成「落盘后的那条记录」，与开着时同形 —— 调用方不该
        为了「开关开没开」而拿到两种返回类型。） */
    if (!pref().enabled) {
      var e = engine();
      e.set(poemId, rec);
      return e.get(poemId);
    }
    var next = {};
    Object.keys(rec || {}).forEach(function (k) { next[k] = rec[k]; });
    var prev = null;
    try { prev = engine().get(poemId); } catch (e) { prev = null; }
    var now = deps.now ? deps.now() : Date.now();
    if (prev && norm(prev.updatedAt) >= now) next.updatedAt = norm(prev.updatedAt) + 1;
    else next.updatedAt = now;
    try { engine().set(poemId, next); } catch (e) { return next; }
    return next;
  }

  /* ------------------------------------------------------------ 快照（后悔药） */

  function snapshot() {
    var b = backing();
    if (!b) return null;
    var snap = {
      v: 1,
      at: new Date(deps.now ? deps.now() : Date.now()).toISOString(),
      progress: {},
      settings: null
    };
    try { snap.progress = engine().all() || {}; } catch (e) { snap.progress = {}; }
    try { snap.settings = engine().settings() || null; } catch (e) { snap.settings = null; }
    var text = JSON.stringify(snap);
    try { b.setItem(NS.premerge, text); } catch (e) { return null; }
    return snap;
  }

  function snapshotText() {
    var b = backing();
    if (!b) return "";
    try { return b.getItem(NS.premerge) || ""; } catch (e) { return ""; }
  }

  /** 把快照读回来（「保留本机 / 先导出再决定」时用） */
  function readSnapshot() {
    var text = snapshotText();
    if (!text) return null;
    try {
      var o = JSON.parse(text);
      return o && typeof o === "object" ? o : null;
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------------ 冲突 */

  function conflicts() {
    var seen = readSeen();
    return Object.keys(seen).filter(function (id) {
      /* 游标、名册指纹、名册那一行用的是同一张表，但它们都不是「一篇记录」——
         混进冲突清单的下场是界面上弹一个「保留本机 / 保留账号」，
         而争的其实是一个记账标记（用户根本看不懂在问什么）。 */
      return id !== CURSOR_KEY && id !== SIG_KEY && id !== FAMILY_ROW_ID && norm(seen[id]) < 0;
    });
  }

  /**
   * 用户选边。**三种都要能后悔**（docs §4.4 D 项）：
   *   keepLocal  —— 保留本机：把本机那条打上「刚改过」的标，下一轮推上去
   *   keepRemote —— 保留账号：拿快照里的云端那份覆盖本机，并清掉冲突标记
   *   exportFirst—— 先导出再决定：不动任何数据，只把快照给出去
   *
   * ⚠️ `keepRemote` 覆盖前**先静默落一份本机快照** —— 用户点错了还能捞回来。
   *    这是「保留账号」唯一不可逆的动作，必须给他后悔药。
   */
  function resolveConflict(mode, account) {
    var list = conflicts();
    if (!list.length) return { ok: true, applied: 0, mode: mode };
    if (mode === "exportFirst") {
      /* 「先导出再决定」= 用户要看清楚再选。所以：
         ① 快照**一定存在**（没有就现落一份 —— 否则导出的是一张空纸）
         ② 同时把「冲突清单」也放进导出内容，用户在外面才看得出争的是哪几篇 */
      var snap = readSnapshot();
      if (!snap) snap = snapshot();
      var backup = snap ? JSON.parse(JSON.stringify(snap)) : { v: 1, progress: {}, settings: null };
      backup.conflicts = list.slice();
      backup.note = "这份快照含本机当前的全部进度与账号域设置，以及待你裁决的篇目清单。本站没有改动任何数据。";
      return { ok: true, applied: 0, mode: "exportFirst", backup: backup, conflicts: list.slice() };
    }
    if (mode === "keepLocal") {
      var now = deps.now ? deps.now() : Date.now();
      var next = readSeen();
      list.forEach(function (id) {
        var rec = null;
        try { rec = engine().get(id); } catch (e) { rec = null; }
        if (rec) {
          // 重新打标（比盘上那份大，防时钟回拨），下一轮就会被推上去
          rec.updatedAt = norm(rec.updatedAt) >= now ? norm(rec.updatedAt) + 1 : now;
          try { engine().set(id, rec); } catch (e) { /* 写不进就保持冲突，下一轮再问 */ }
        }
        /* ⚠️ 标记清成 **0**（不是本机时间戳）：0 的意思是「云端从没给过这一条」，
           于是 pending() 判定它「不等于云端最后给的时间戳」，下一轮就会推上去。
           写成本机时间戳的话，pending() 会认为「已经和云端对齐了」，永远推不出去。 */
        next[id] = 0;
      });
      writeSeen(next);
      emit(EVT.state, { conflicts: 0 });
      return { ok: true, applied: list.length, mode: "keepLocal" };
    }
    if (mode === "keepRemote") {
      snapshot();                                  // 后悔药：覆盖前先落一份
      var byId = {};
      ((account && account.recs) || []).forEach(function (r) { byId[r.id] = r; });
      var seen = readSeen();
      list.forEach(function (id) {
        var r = byId[id];
        if (r && !r.deleted) {
          var rec = {};
          Object.keys(r.payload || {}).forEach(function (k) { rec[k] = r.payload[k]; });
          rec.updatedAt = norm(r.updatedAt);
          try { engine().set(id, rec); } catch (e) { /* 同上 */ }
          seen[id] = rec.updatedAt;                   // 云端那一版已经在本机了
        } else if (r && r.deleted) {
          try { engine().remove(id); } catch (e) { /* 同上 */ }
          seen[id] = norm(r.updatedAt);               // 墓碑也留个印，免得又被推回来
        } else {
          seen[id] = 0;                               // 云端也没有：清掉标记，别再问
        }
      });
      writeSeen(seen);
      emit(EVT.state, { conflicts: 0 });
      return { ok: true, applied: list.length, mode: "keepRemote" };
    }
    return { ok: false, code: "E_MODE", message: "不认识的合并方式" };
  }

  /* ------------------------------------------------------------ 网络（唯一一处） */

  /**
   * 唯一与网络打交道的地方。**三条纪律**：
   *   1. 任何异常都在这里被吞掉 —— 上层拿到的永远是 `{ok:false, code}`，不是异常
   *   2. 超时算失败（不算成功，也不算崩溃）
   *   3. `notConfigured` 与 `offline` 分得清：前者是「本站还没开放云端账号」，
   *      后者是「这会儿连不上」，界面上说的话不一样
   */
  function request(path, method, body) {
    var f = deps.fetch || (typeof fetch === "function" ? fetch : null);
    if (!f || deps.base === null) {
      return Promise.resolve({ ok: false, code: "E_OFFLINE", message: "连不上服务端" });
    }
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;
    var init = {
      method: method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" }
    };
    if (deps.deviceId) init.headers["x-kb-device"] = deps.deviceId;
    /* ⚠️ **每一个请求都带 `child`**（调用方已给的不覆盖），而不是只在某一路带上。
       漏带的症状是「名册推上去了、进度推的是另一个孩子的」（或反过来），
       而两处都在这一层里，谁也不会去怀疑另一个接口少了个字段。 */
    var outgoing = (body === undefined || body === null) ? null : Object.assign({}, body);
    if (outgoing && outgoing.child === undefined) outgoing.child = childId();
    if (outgoing !== null) init.body = JSON.stringify(outgoing);
    if (ctrl) init.signal = ctrl.signal;

    return f(deps.base + path, init).then(function (res) {
      if (timer) clearTimeout(timer);
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!data || typeof data !== "object") {
          return { ok: false, code: "E_INTERNAL", message: "服务端返回了看不懂的内容" };
        }
        if (res.status === 503 || data.code === "E_NOT_CONFIGURED") {
          return { ok: false, code: "E_NOT_CONFIGURED", message: "这个站点还没开放云端同步" };
        }
        if (res.status === 401) {
          return { ok: false, code: data.code || "E_NO_SESSION", message: "还没有登录" };
        }
        if (res.status >= 200 && res.status < 300) {
          var out = { ok: true, status: res.status };
          Object.keys(data).forEach(function (k) { out[k] = data[k]; });
          return out;
        }
        return { ok: false, code: data.code || "E_INTERNAL", message: data.message || "同步没成功" };
      });
    }).catch(function (e) {
      if (timer) clearTimeout(timer);
      var code = (e && e.name === "AbortError") ? "E_TIMEOUT" : "E_OFFLINE";
      return { ok: false, code: code, message: "这一轮没同步上，进度仍在本机" };
    });
  }

  /** 事件是最不重要的东西：订不上、订错了都不许影响同步 */
  function emit(name, payload) {
    try {
      if (deps.emit && deps.emit !== emit) deps.emit(name, payload || {});
    } catch (e) { /* 订阅者自己抛异常，不该反过来打断同步 */ }
  }

  /* ------------------------------------------------------------ 状态 */

  /**
   * 请求前缀。默认 `/api`（同源）。
   *
   * ⚠️ 缺省值在这里现取，而不是只在 `init()` 里设一次 —— 页面从来不调 `init()`
   *    （它们只加载脚本），于是「默认值只写在 init 里」等于**永远没有默认值**：
   *    `deps.base` 是 undefined，`status()` 恒为 `unavailable`，
   *    开关点了打开也显示「未开放」。这个坑在 jsdom 真页面测试里才看得见。
   */
  function base() {
    if (typeof deps.base === "string" && deps.base) return deps.base;
    return "/api";
  }

  /**
   * 同步的当前状态。**五种各说各的话**，页面不许自己拼：
   *   unavailable —— 不接后端（测试 / 将来「不接后端」的构建）
   *   tier        —— 开关开着，但层级不够（补闸之后新增）：一个 Pro 过期的人
   *                 开关还留在「开」的位置上，这时如实说「要 Pro 起」，
   *                 而不是说 "ready"（那会让界面显示「开启中」，实际一条都传不上去）
   *   off         —— 开关关着（出厂状态）
   *   signin      —— 开着但没登录
   *   ready       —— 真的能同步
   *
   * ⚠️ `tier` 这一档**排在 `off` 之后、`signin` 之前**：开关没开时不谈层级
   *    （没开就是没开，说「要 Pro」会让人以为开了就能用）。
   */
  function status() {
    if (deps.base === null) return "unavailable";     // 显式关掉（测试与将来「不接后端」的构建）
    if (!enabled()) return "off";
    if (!gate().ok) return "tier";
    if (deps.signedIn && !deps.signedIn()) return "signin";
    return "ready";
  }

  /* ------------------------------------------------------------ 合并规则 */

  /**
   * 一条云端记录怎么落到本机。**这是整层最要紧的一段**：
   *
   *   · 云端说删了 → 本机也删（但只在云端那份确实更新时）
   *   · 本机没有 → 直接落盘，**保留云端的 updatedAt**（见文件头）
   *   · 本机已有、且与云端是同一份（相同 updatedAt）→ 什么都不做
   *   · 本机已有、本机更新（本机 updatedAt 更大）→ **保留本机**，
   *     记成 `seen = -1` 的冲突等用户裁决？不 —— 本机赢是明确的，
   *     直接让下一轮推上去（docs §4.4「打卡要单调，绝不因合并回退」）
   *   · 两边都说是自己改的、时间戳又完全一致 → 判不出来源 → `seen = -1`
   *
   * 返回：{ applied, keepLocal, conflict }
   */
  function applyRemote(r) {
    var id = r && r.id;
    if (!id) return "skip";
    var cloudTs = norm(r.updatedAt);
    var seen = readSeen();
    var knownCloud = norm(seen[id]);

    /* ⚠️ **先看冲突标记**：上一次已经判过「两边都动过、来源不明」，
       用户还没选 —— 这时再来一轮不该把它又自动合并掉。
       放在最前面是因为它是「用户欠一个决定」，比任何时间戳比较都优先。 */
    if (knownCloud < 0) return "conflict";

    var local = null;
    try { local = engine().get(id); } catch (e) { local = null; }
    var localTs = local ? norm(local.updatedAt) : 0;

    if (r.deleted) {
      // 云端删除是一条墓碑。只在「本机没有更新的改动」时才生效 —— 本机刚背完的
      // 不能被一条旧墓碑抹掉（墓碑的时间戳与本地一样旧就说明它没带来新信息）。
      if (!local) { markSeen(id, cloudTs); return "skip"; }
      if (cloudTs >= localTs) {
        try { engine().remove(id); } catch (e) { return "skip"; }
        markSeen(id, cloudTs);
        return "applied";
      }
      return "keepLocal";                     // 本机更新：不删，等下一轮把它推上去
    }

    // 云端有、本机没有：直接落盘，**保留云端的时间戳**（文件头第 1 条）
    if (!local) {
      var rec = {};
      Object.keys(r.payload || {}).forEach(function (k) { rec[k] = r.payload[k]; });
      rec.updatedAt = cloudTs;
      try { engine().set(id, rec); } catch (e) { return "skip"; }
      markSeen(id, cloudTs);
      return "applied";
    }

    // 时间戳相同 = 同一份：什么都不做（幂等；不写盘、不推送）
    if (cloudTs === localTs) { markSeen(id, cloudTs); return "skip"; }

    // 云端更新：接受云端那一份
    if (cloudTs > localTs) {
      var next = {};
      Object.keys(r.payload || {}).forEach(function (k) { next[k] = r.payload[k]; });
      next.updatedAt = cloudTs;
      try { engine().set(id, next); } catch (e) { return "skip"; }
      markSeen(id, cloudTs);
      return "applied";
    }

    /* 本机更新（localTs > cloudTs）。这里分两种情况，判据是**「本机这份的改动，
       云端到底知不知道」**，也就是 `seen[id]` 这个「云端最后一次给这条的时间戳」：

         · seen[id] === cloudTs  → 本机这份「跟的就是云端版」之后又改过，
           两边是**同一条线**上的先后 → 本机赢，下一轮推上去（打卡单调，不回退）
         · seen[id] !== cloudTs  → 云端也动过，而两份不是同一条线，
           没有共同祖先可判 → **不自动合并**，打冲突标记等用户选（docs §4.4 D 项）

       用 `!==` 而不是 `<`：`seen[id] = 0`（从没对齐过）同样落在第二支上，
       这正是「本机背了一个月 + 云端也有一份，两边都没对上过」那个场景。 */
    if (knownCloud === cloudTs) return "keepLocal";
    markSeen(id, -1);
    return "conflict";
  }

  /**
   * 把本机「该推的」挑出来。
   *
   * 判据是**本机那份的时间戳 ≠ 云端最后给这一条的时间戳**：
   *   · 相等 → 本机这份就是云端版（或已推成功过），不用再推
   *   · 不等 → 本机改过（或从没对齐过），该推上去
   * ⚠️ 冲突标记（`seen < 0`）的**不推** —— 那是「等用户决定」，推上去等于替用户选了。
   */
  function pending(seen) {
    var out = [];
    var all = {};
    try { all = engine().all() || {}; } catch (e) { all = {}; }
    Object.keys(all).forEach(function (id) {
      var ts = norm(all[id] && all[id].updatedAt);
      if (!ts) return;                       // 0 期老数据、还没打过标：留给 adoptLocal 处理
      var known = norm(seen[id]);
      if (known < 0) return;                 // 冲突待裁决：等用户选，不替他决定
      if (ts !== known) out.push({ id: id, payload: all[id], updatedAt: ts, deleted: false });
    });
    return out;
  }

  /* ------------------------------------------------------------ 推 / 拉 */

  /**
   * 一批推上去（进度或名册，形状一样）。
   * 推成功就打标：**用推上去的那一枚时间戳**，不是「现在」——
   * 一次批量写盘（逐条 setItem 会在 N 条时抖 N 次，且中途失败就只记了一半）。
   */
  function sendBatch(recs, child) {
    return request("/sync/push", "POST", { recs: recs, child: child }).then(function (r) {
      if (!r.ok) return r;
      markSeenMany(recs.map(function (it) { return { id: it.id, ts: it.updatedAt }; }));
      return r;
    });
  }

  function pushPending() {
    if (status() !== "ready") return Promise.resolve({ ok: true, applied: 0, skipped: true });
    var seen = readSeen();
    var list = pending(seen);
    var reg = familyRow();
    if (!list.length && !reg) return Promise.resolve({ ok: true, applied: 0 });

    var sent = 0;
    /* 名册那一行**先推**，且显式用空串（账号级）—— 见 `familyRow()` 的注释。
       先推它的理由：另一台设备拿到名册才知道「有几个孩子」，
       而在那之前，那边拉到任何孩子的进度都不知道该归给谁。 */
    var head = Promise.resolve({ ok: true });
    if (reg) {
      head = sendBatch([reg], "").then(function (r) {
        if (r && r.ok) { sent++; writeSig(cloudSig(reg.payload)); }
        return r;
      });
    }

    return head.then(function (prev) {
      if (prev && prev.ok === false) return prev;
      var chain = Promise.resolve();
      for (var i = 0; i < list.length; i += CHUNK) {
        (function (batch) {
          chain = chain.then(function () {
            if (status() !== "ready") return null;       // 半路被关掉就停手
            return sendBatch(batch, undefined).then(function (r) {
              if (r && r.ok) sent += batch.length;
              return r;
            });
          });
        })(list.slice(i, i + CHUNK));
      }
      return chain;
    }).then(function (last) {
      if (last && last.ok === false) return last;
      return { ok: true, applied: sent };
    });
  }

  function applyPull(r) {
    var rows = (r && r.recs) || [];
    var out = { applied: 0, keepLocal: 0, conflict: 0, family: false, serverTime: norm(r && r.serverTime) };
    rows.forEach(function (row) {
      /* 名册那一行**不是一篇诗的档案**：它不能被按条合并（那份数组要么整份收下、
         要么整份留着），所以走另一条路（`applyRemoteFamily`）。
         走同一条路的症状：名册被当成一篇「诗」，`profiles` 字段在服务端
         白名单化时被丢掉，于是另一台设备收到一份空名册 —— 看着就像「孩子没了」。 */
      if (row && row.id === FAMILY_ROW_ID) {
        var fv = applyRemoteFamily(row);
        if (fv === "applied") { out.applied++; out.family = true; }
        return;
      }
      var verdict = applyRemote(row);
      if (verdict === "applied") out.applied++;
      else if (verdict === "conflict") out.conflict++;
      else if (verdict === "keepLocal") out.keepLocal++;
    });
    if (out.applied) emit(EVT.applied, { count: out.applied });
    if (out.conflict) emit(EVT.conflict, { count: out.conflict });
    return out;
  }

  /**
   * 拉一次。`since` 是**服务端时间**游标（上一轮响应里的 `serverTime`），
   * 不是客户端时钟 —— 用客户端时钟会拖出「永远拉不到 / 拉到一堆重复」。
   *
   * ⚠️ 游标比 `seen` 多一层必要：`seen` 只能回答「这一条云端有没有变过」，
   *    回答不了「云端有没有**新增**过我没见过的篇目」。
   *    所以拉成功之后要把服务端时间记下来，下一轮拿它当 since（增量拉）。
   */
  function pullOnce(since) {
    if (status() !== "ready") return Promise.resolve({ ok: true, applied: 0, skipped: true });
    /* ⚠️ 问的是**谁**：`child` 由 request() 统一带上，但**回来的时候**
       当前选中的孩子可能已经换了（切换正好发生在请求在途时）。
       服务端把它判给了谁回在回包里（`r.child`），这里逐字比对：
       对不上就**整批丢掉**，一个字都不落盘。 */
    var asked = childId();
    return request("/sync/pull", "POST", { since: norm(since) }).then(function (r) {
      if (!r.ok) return r;
      if (String(r.child == null ? "" : r.child) !== asked) {
        return { ok: true, recs: [], serverTime: norm(r.serverTime), stale: true,
                 applied: { applied: 0, keepLocal: 0, conflict: 0 } };
      }
      var applied = applyPull(r);
      var st = norm(r.serverTime);
      if (st > cursor()) setCursor(st);
      return { ok: true, recs: r.recs || [], serverTime: st, applied: applied };
    });
  }

  /** 服务端时间游标（存在 seen 表里的一个约定键上，不另开一把存储键） */
  var CURSOR_KEY = "__cursor__";
  /** 名册那一行在服务端的 id —— 与 `api/_lib/core.js` 的 `FAMILY_ROW_ID` 逐字一致 */
  var FAMILY_ROW_ID = "family:v1";
  /** 上一轮推上去的名册「指纹」（与游标、seen 同一张表，但都不是「一篇篇目」） */
  var SIG_KEY = "__family_sig__";
  function cursor() { return norm(readSeen()[CURSOR_KEY]); }
  function setCursor(ts) {
    markSeen(CURSOR_KEY, ts);
  }

  /* ------------------------------------------------------------ 名册（子档案） */

  /** 名册内核（`js/family.js`）；没加载上就是 null（老缓存里的旧页面） */
  function familyMod() {
    var g = typeof window !== "undefined" ? window.Family : null;
    return g && typeof g.list === "function" ? g : null;
  }

  function familySig() { return String(readSeen()[SIG_KEY] || ""); }

  function writeSig(sig) {
    var m = readSeen();
    m[SIG_KEY] = String(sig || "");
    return writeSeen(m);
  }

  /** 名册内容的可比指纹（判「本机这一份是不是就是云端那一份」） */
  function cloudSig(cloud) {
    return String((cloud && cloud.at) || "") + "|" + ((cloud && cloud.profiles) || []).map(function (p) {
      return [p.id, p.nickname, (p.avatar && p.avatar.char) || "", (p.avatar && p.avatar.ink) || ""].join("~");
    }).join(";");
  }

  /** 本机名册的时间戳：名册自己没有 updatedAt，取各档案 `createdAt` 里最大的那个 */
  function localTs(list) {
    var ts = 0;
    (list || []).forEach(function (p) { var t = norm(p && p.createdAt); if (t > ts) ts = t; });
    return ts;
  }

  /**
   * 把本机名册打包成一条**同步记录**（推上去用）。
   *
   * ⚠️ 名册**不是**进度档案：`js/family.js` 的盘上形状里没有 `updatedAt`
   *    （只有 `v/at/profiles`）。所以这里现配一枚 —— 判据是
   *    「名册最后一次改动是什么时候」，而它**只有本机知道**：
   *    取各档案 `createdAt` 里最大的那个（新加的孩子一定是最新那个动作）。
   *    **不用 `Date.now()`** —— 那会让每一轮都被判成「本机有改动」，
   *    名册于是每轮都往上传一次（白花流量，还会把别的设备刚改的盖回旧的）。
   *
   * 返回 `null` 表示「本机没有名册 / 与上一轮推上去的那一份逐字相同」——
   * 这时**什么都不推**，绝不用一份空名册去覆盖云端那一份。
   */
  function familyRow() {
    var F = familyMod();
    if (!F) return null;
    var b = backing();
    var opt = b ? { backing: b } : undefined;
    var list = [], at = "";
    try { list = F.list(opt) || []; at = String(F.currentId(opt) || ""); } catch (e) { return null; }
    if (!list.length) return null;
    var sig = cloudSig({ at: at, profiles: list });
    if (familySig() === sig) return null;                 // 与上一轮推上去的那一份逐字相同
    var ts = localTs(list);
    var known = norm(readSeen()[FAMILY_ROW_ID]);
    if (!ts) ts = deps.now ? deps.now() : Date.now();
    /* ⚠️ 时间戳要**单调不减**：比 `known`（云端那一份的时间戳）小的话，
       服务端那条 `where excluded.updated_at >= ...` 会把它丢掉 ——
       症状是「改了名册，另一台设备上没变」，而且不报错。 */
    if (ts <= known) ts = known + 1;
    return { id: FAMILY_ROW_ID, payload: { v: 1, at: at, profiles: list, updatedAt: ts }, updatedAt: ts, deleted: false };
  }

  /**
   * 云端下来的名册怎么落到本机。
   *
   * 判据与进度**同一条**（时间戳 + `seen` 记账），但落法完全不同 ——
   * 名册是**一份数组**，不是一篇篇独立的档案：它不能被「按条合并」，
   * 要么整份收下、要么整份留着。所以这里只有两个结论：`applied` / `skip`，
   * **不给 `conflict`** —— 一份名册弹不出「保留本机 / 保留账号」这样的选择，
   * 让用户在两个孩子的名单之间点一个是不负责任的问题。
   *
   * 三条口径：
   *   1. **本机没有名册时直接收下**（新设备第一次登录的常态）
   *   2. **两边都有时按时间戳判**；本机这一份更新（且与云端不是同一条线）时留本机，下一轮推上去
   *   3. **恢复走内核 `Family.restore()`** —— 内核不在或没给这个入口时**不假装落上了**
   *      （返回 `skip`，而不是记一个「已经同步过了」的印）
   */
  function applyRemoteFamily(row) {
    var F = familyMod();
    if (!F) return "skip";
    var cloud = (row && row.payload) || null;
    if (!cloud || !Array.isArray(cloud.profiles) || !cloud.profiles.length) return "skip";
    if (typeof F.restore !== "function") return "skip";     // 内核没给恢复入口：不假装
    var cloudTs = norm(row.updatedAt);
    var known = norm(readSeen()[FAMILY_ROW_ID]);
    if (known === cloudTs) return "skip";                   // 已经是这一份了（幂等）
    var inSig = cloudSig(cloud);
    if (familySig() === inSig) { markSeen(FAMILY_ROW_ID, cloudTs); return "skip"; }
    var b = backing();
    var opt = b ? { backing: b } : undefined;
    var local = [];
    try { local = F.list(opt) || []; } catch (e) { local = []; }
    /* 本机这一份也改过、而且改在云端之后 —— 本机赢，下一轮推上去。
       判据是两边的时间戳：本机的取各档案 `createdAt` 的最大值。 */
    if (local.length && known > 0 && known !== cloudTs && localTs(local) > cloudTs) return "skip";
    var applied = false;
    /* ⚠️ 恢复也传**同步层当前那块盘**（与 `childId()` 同一条口径）——
       不传的话，注入存储的场景下会把云端名册写进默认盘（localStorage），
       而进度在另一块盘上，症状是「名册恢复了、进度还是空的」。 */
    try { applied = !!(opt ? F.restore(cloud, opt) : F.restore(cloud)); } catch (e) { applied = false; }
    markSeen(FAMILY_ROW_ID, cloudTs);
    if (applied) { writeSig(inSig); emit(EVT.applied, { count: 1, family: true }); }
    return applied ? "applied" : "skip";
  }

  /* ------------------------------------------------------------ 认领 / 全面合并 */

  /**
   * 登录时（或服务端数据先到）的第一次合并。走的是**内核的 `mergePolicy`**：
   * 它是全站唯一决定「这份进度算谁的」的地方，各页不许自己再判一遍
   * （自己判一遍的下场：同一个账号在三个入口看到三种合并结果）。
   *
   *   none        —— 两边都空，什么都不做
   *   adoptLocal  —— 账号是空的：**把本机已有进度认领进去**（新注册不丢数据）
   *   takeRemote  —— 本机是空的：把云端那份拉下来
   *   merge       —— 两边都有但同一篇不冲突：合并
   *   ask         —— 判不出来源：**不自动合并**，落一份快照，等用户选
   *
   * 整个过程**不发网络请求**（云端那份由调用方先 pull 下来传进来），
   * 于是「后端挂了会不会卡住登录」这个问题从根上不存在。
   */
  function firstMerge(remoteRecs) {
    var A = deps.AuthCore || null;
    var remoteRecs2 = remoteRecs || null;
    var localRecs = {};
    try { localRecs = engine().all() || {}; } catch (e) { localRecs = {}; }

    /* `updatedAt` 是本机自己的记账字段，云端不认（`sanitizePayload` 会把它丢掉），
       所以给内核看的「本机这一份」要**摘掉它**，免得 mergePolicy 拿它当业务字段比。 */
    var forCore = {};
    Object.keys(localRecs).forEach(function (id) {
      var rec = {};
      Object.keys(localRecs[id] || {}).forEach(function (k) {
        if (k !== "updatedAt") rec[k] = localRecs[id][k];
      });
      forCore[id] = rec;
    });

    var outcome = null;
    if (A && typeof A.mergePolicy === "function") {
      outcome = A.mergePolicy({ recs: forCore }, { recs: remoteRecs2 || {} });
    } else {
      // 内核不在（脚本没加载）：**退回最保守的那一支** —— 只认领，什么都不覆盖
      outcome = Object.keys(forCore).length
        ? { action: Object.keys(remoteRecs2 || {}).length ? "ask" : "adoptLocal" }
        : { action: Object.keys(remoteRecs2 || {}).length ? "takeRemote" : "none" };
    }

    if (outcome.action === "ask") {
      snapshot();          // 后悔药：一见冲突就落，而不是等用户点「保留账号」时才落
      // 冲突条目逐条打标（没有明细时退化成「全部已知条目」）
      var list = outcome.conflict || conflictIds(forCore, remoteRecs2);
      list.forEach(function (id) {
        markSeen(id, -1);
      });
      emit(EVT.conflict, { count: list.length });
    }
    return { action: outcome.action, conflict: outcome.conflict || [] };
  }

  function conflictIds(local, remote) {
    return Object.keys(local).filter(function (id) { return !!remote[id]; });
  }

  /**
   * 第一次同步的编排。**顺序不能反**：先认领（本机已有的进度先上账），
   * 再拉云端（否则远端那几条会被随后的 adoptLocal 覆盖掉）。
   */
  function firstSync() {
    if (status() !== "ready") return Promise.resolve({ ok: true, skipped: true, reason: status() });
    // 1. 认领本机（0 期老数据没有 updatedAt，这一步顺手把它们打上标）
    adoptLocal();
    // 2. 拉云端
    return pullOnce(0).then(function (r) {
      if (!r.ok) return r;
      // 3. 按 mergePolicy 决定这一篇算谁的（本地 vs 云端）
      var remoteMap = {};
      (r.recs || []).forEach(function (row) {
        if (!row.deleted) remoteMap[row.id] = row.payload || {};
      });
      var out = firstMerge(remoteMap);
      var rest = status() === "ready" ? pushPending() : Promise.resolve({ ok: true, applied: 0 });
      return rest.then(function (p) {
        return {
          ok: true,
          pulled: (r.applied && r.applied.applied) || 0,
          conflicts: out.conflict.length,
          pushed: (p && p.applied) || 0,
          action: out.action
        };
      });
    });
  }

  /**
   * 把本机已有的（0 期）进度认领成「本机改动」。
   *
   * **认领 = 打时间戳，但刻意不记进 `seen`** —— 于是这些记录下一轮会被推上去。
   * 记进 `seen` 就等于「本机这份已经和云端对齐了」，而事实恰好相反：
   * 它们是**还没有云端对应**的那一批，正是最该推上去的
   * （用户先在本机背了一个月，然后才建账号 —— 那一批一篇都不能丢）。
   *
   * 只对**没有 updatedAt** 的记录动手：已经打过标的记录一律不碰，
   * 否则每次进首页都会把全部记录重新打一遍标，等于每轮全量推一次。
   * 幂等：跑两次结果一致（第二次没有可认领的对象）。
   */
  function adoptLocal() {
    var all = {};
    try { all = engine().all() || {}; } catch (e) { return { adopted: 0 }; }
    var n = 0;
    Object.keys(all).forEach(function (id) {
      var rec = all[id];
      if (!rec || typeof rec !== "object") return;
      if (norm(rec.updatedAt)) return;                 // 已打过标：不碰
      rec.updatedAt = deps.now ? deps.now() : Date.now();
      try { engine().set(id, rec); } catch (e) { return; }
      n++;
    });
    return { adopted: n };
  }

  /**
   * 一轮同步（推 + 拉）。**这是唯一会被定时器 / 页面调用到的入口**，
   * 于是「什么时候能同步、出错了怎么办」只在这里回答一次。
   */
  function now(opts) {
    var o = opts || {};
    if (status() !== "ready") return Promise.resolve({ ok: true, skipped: true, reason: status() });
    var runPush = o.push !== false;
    var runPull = o.pull !== false;
    var steps = Promise.resolve({ ok: true });
    if (runPush) {
      steps = steps.then(function (prev) {
        if (prev && prev.ok === false) return prev;
        return pushPending();
      });
    }
    if (runPull) {
      steps = steps.then(function (prev) {
        if (prev && prev.ok === false) return prev;
        return pullOnce(cursor());
      });
    }
    return steps;
  }

  /* ------------------------------------------------------------ 显式重置（退出登录） */

  /**
   * 退出登录 / 关掉开关时清掉「同步记账」（seen 与开关以外的一切）。
   * ⚠️ **绝不动进度数据** —— 退出只结束这次登录，本机进度一字不少
   *    （与 `AuthCore.signOut()` 同一条纪律）。
   */
  function forget() {
    var b = backing();
    if (!b) return { ok: true };
    /* ⚠️ 清的是**所有孩子**的记账表，不只当前那一个。
       只清当前那份的下场：退出登录再换个人登录，**上一个账号留下的
       游标与 `seen` 还在别的孩子名下**（那些键按子档案分家），
       于是新账号第一轮同步「以为云端已经给过这些记录了」——
       症状是「换账号之后，有一部分进度怎么都同步不过来」，
       且只在多档案账号上出现。清法与建法必须是同一把尺子：
       `seenKey()` 拼得出哪些键，这里就要清掉哪些键。 */
    var keys = [NS.seen];
    try {
      var g = typeof window !== "undefined" ? window.Family : null;
      if (g && typeof g.list === "function") {
        (g.list({ backing: b }) || []).forEach(function (p) {
          var id = p && p.id ? String(p.id) : "";
          if (id) keys.push(NS.seen + "::" + id);
        });
      }
    } catch (e) { /* 名册读不出来就只清当前那一份 —— 宁少清，不乱清 */ }
    keys.forEach(function (k) {
      try { b.removeItem(k); } catch (e) { /* 隐私模式：没盘可清，也不是错误 */ }
    });
    emit(EVT.state, { conflicts: 0 });
    return { ok: true };
  }

  /* ------------------------------------------------------------ 装配 */

  function init(o) {
    deps = o || {};
    if (deps.base === undefined) deps.base = "/api";
    return api;
  }

  var api = {
    NS: NS, EVT: EVT, CHUNK: CHUNK, TIMEOUT_MS: TIMEOUT_MS,

    init: init,
    /** 注入依赖（测试用）：ProgressStore / fetch / base / signedIn / now / emit / Entitlement */
    use: function (o) { deps = o || {}; return api; },

    pref: pref,
    enabled: enabled,
    setEnabled: setEnabled,
    status: status,
    allowed: allowed,
    gate: gate,

    touch: touch,
    markSeen: markSeen,
    markSeenMany: markSeenMany,
    seen: readSeen,
    conflicts: conflicts,
    resolveConflict: resolveConflict,

    snapshot: snapshot,
    readSnapshot: readSnapshot,
    snapshotText: snapshotText,

    request: request,
    pullOnce: pullOnce,
    pushPending: pushPending,
    pending: function () { return pending(readSeen()); },
    now: now,
    firstSync: firstSync,
    adoptLocal: adoptLocal,
    firstMerge: firstMerge,
    applyRemote: applyRemote,
    forget: forget,

    /** 单条记录的合并结果（给测试直接打） */
    _applyPull: applyPull
  };

  if (typeof window !== "undefined") window.SyncStore = api;
  return api;
})();

/* node 里 require 也能拿到同一份实现（测试层需要） */
if (typeof module === "object" && module.exports) module.exports = (typeof window !== "undefined" ? window.SyncStore : null);
