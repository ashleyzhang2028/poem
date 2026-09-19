(function () {
  "use strict";

  // 「今日加背」：小朋友今天**主动**想多背的那几篇。
  //
  // 它与「自选集合」（js/collections.js）是两件事，所以不能复用那一份数据：
  //
  //   集合 —— 长期清单（「我要背的」），一次建好、慢慢累积，不跟着日期走；
  //   今日加背 —— 只属于**今天**，明天醒来就该归零（它存在的理由就是
  //              「今天临时多背两首」，留到明天就变成一份没人再维护的清单）。
  //
  // 也不进课内的范围（scope）：那六个范围说的是「课本从哪一册抽」，
  // 小朋友随手加的那一篇可能来自唐诗三百首，与范围无关。
  //
  // 三处口径：
  //   ① 一份数据 = 「今天」+「哪几篇」。跨过 0 点，旧的那份**只读不删**语义上
  //      等于作废：read() 见到日期不是今天就回空，并且把旧的清掉（不清就会
  //      越攒越多，导出备份里还多出一堆早已无用的 id）。
  //   ② 每篇存**快照**（正文 / 译文 / 出处）。搜索页与集子页都是异步取数的，
  //      明天再打开首页时那些脚本不一定已经跑完 —— 只存 id 就会「加进去了，
  //      点开是空的」。
  //   ③ 键名走 ProgressStore 的 childId 机制（与 progress / 已读同一套），
  //      所以一个家长几个孩子各加各的，互不串味。
  //
  // ④ **它上云**（2026-09-19 用户改了口径：「云同步功能不能添加这些吗？」）。
  //    走的是与「自选集合」**同一条路**：不新开表，作为 progress 里的一行
  //    （`daily_extra:v1`）推上去，服务端的 sanitizePayload 给它一条自己的
  //    白名单。所以两端要能**合并**（两台设备各加了两首 → 并起来是四首），
  //    靠的是同一个判据：`date` 相同才并，日期不同以本机为准（换了一天，
  //    旧的那一份本来就该作废 —— 见 read()）。
  //    ⚠️ 跨过 0 点之后**云端那一行不会被主动删掉**，只是第二天读到时日期
  //    不是今天、照旧回空（第二天一旦加了新的一篇，推送就把那一行覆盖成
  //    今天的日期）。这是「明天自动归零」的实现：靠日期判，不靠定时任务。

  var KEY = "poem_daily_extra_v1";
  var MAX = 20;

  // 云端那一行的 poem_id（它是 progress 这张表里的一行，不是新表）。
  // 与 js/sync-store.js、api/_lib/core.js 的 DAILY_EXTRA_ROW_ID 逐字一致。
  var SYNC_ID = "daily_extra:v1";

  function ps() {
    return typeof window !== "undefined" && window.ProgressStore ? window.ProgressStore : null;
  }

  function physKey() {
    var P = ps();
    if (P && typeof P.keyFor === "function") {
      try { return P.keyFor(KEY, P.childId ? P.childId() : ""); } catch (e) {  }
    }
    return KEY;
  }

  function store() {
    var P = ps();
    if (P && typeof P.store === "function") {
      try {
        var s = P.store();
        if (s) return s;
      } catch (e) {  }
    }
    try {
      return typeof window !== "undefined" ? window.localStorage : null;
    } catch (e) {
      return null;
    }
  }

  // 「今天」的判据与首页那份今日计划**必须**是同一个（app.js 的 todayKeyStr
  // 用的是本地时间的 年-月-日，不带补零）。两处若各写一份，0 点之后就出现
  // 「计划已经换了、加背那几篇还挂在昨天」这种对不上的状态。
  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  // 与 sync-store 同一个口径：这一份数据的版本号就是它的「最后改动时刻」。
  // 云端那一行靠它判新旧（老时间戳盖不掉新值 —— 与 progress 那条 where 同源）。
  function nowTs() { return Date.now(); }

  function uidOf(p) {
    if (!p) return "";
    // 一篇作品的「同一性」看 Wid（课内《静夜思》与唐诗《夜思》是同一篇）；
    // 没有作品主表时退回自己的 id。
    var id = p.id || "";
    if (!id) return "";
    if (window.WorksIndex && typeof window.WorksIndex.widOf === "function") {
      try { return window.WorksIndex.widOf(id) || id; } catch (e) {  }
    }
    return id;
  }

  function snapshotOf(p) {
    if (!p) return null;
    return {
      title: p.title || "",
      author: p.author || "",
      authorName: p.authorName || "",
      dynasty: p.dynasty || "",
      source: p.source || "",
      selection: p.selection || "",
      book: p.book || "",
      bookName: p.bookName || "",
      page: p.page || "",
      grade: p.grade,
      term: p.term,
      gradeGroup: p.gradeGroup || "",
      text: p.text || "",
      translation: p.translation || "",
      translationSource: p.translationSource
    };
  }

  function empty() {
    return { v: 1, date: today(), updatedAt: 0, items: [] };
  }

  function read() {
    var s = store();
    if (!s) return empty();
    var raw = null;
    try { raw = s.getItem(physKey()); } catch (e) { raw = null; }
    if (!raw) return empty();

    var data = null;
    try { data = JSON.parse(raw); } catch (e) { data = null; }
    if (!data || typeof data !== "object" || !Array.isArray(data.items)) return empty();

    // 日期不是「今天」—— 旧的那份作废。这里清掉（而不是留着等明天再判），
    // 因为留着的那份在下一次 write() 时会被覆盖，但**中间**这段窗口里
    // 它还会被 exportJSON / 其它读者看见。
    if (String(data.date || "") !== today()) {
      try { s.removeItem(physKey()); } catch (e) {  }
      return empty();
    }
    return normalize(data);
  }

  // 把一份「形状上可能不干净」的数据收成内部那一份（盘上的、云端拉下来的
  // 都要过这一步）：按 wid 去重、丢掉没有 id 的、页数封顶。
  function normalize(data) {
    var seen = {};
    var items = [];
    ((data && data.items) || []).forEach(function (it) {
      if (!it || typeof it !== "object" || !it.id) return;
      var wid = it.wid || uidOf(it);
      if (!wid || seen[wid]) return;
      seen[wid] = true;
      items.push({
        id: it.id,
        wid: wid,
        entryId: it.entryId || it.id,
        snap: it.snap || null,
        at: Number(it.at) > 0 ? Math.round(Number(it.at)) : 0
      });
    });
    return {
      v: 1,
      date: String((data && data.date) || today()),
      updatedAt: Number(data && data.updatedAt) > 0 ? Math.round(Number(data.updatedAt)) : 0,
      items: items.slice(0, MAX)
    };
  }

  function write(data) {
    var s = store();
    if (!s) return false;
    var out = {
      v: 1,
      date: today(),
      updatedAt: nowTs(),
      items: (data && data.items) || []
    };
    out = normalize(out);
    out.date = today();
    out.updatedAt = nowTs();
    try {
      if (!out.items.length) s.removeItem(physKey());
      else s.setItem(physKey(), JSON.stringify(out));
    } catch (e) {
      return false;
    }
    emit(out.items);
    return true;
  }

  function emit(items) {
    try {
      window.dispatchEvent(new CustomEvent("daily-extra-change", {
        detail: { items: (items || []).slice(), count: (items || []).length }
      }));
    } catch (e) {  }
  }

  function has(entryId) {
    if (!entryId) return false;
    var wid = uidOf(entryId && entryId.id ? entryId : { id: entryId });
    return read().items.some(function (it) { return it.wid === wid; });
  }

  function add(p) {
    if (!p || !p.id) return { ok: false, code: "E_NO_POEM" };
    var data = read();
    var wid = uidOf(p);
    if (data.items.some(function (it) { return it.wid === wid; })) {
      return { ok: true, added: false, count: data.items.length };
    }
    if (data.items.length >= MAX) {
      return { ok: false, code: "E_LIMIT", limit: MAX, count: data.items.length };
    }
    data.items.push({
      id: p.id,
      wid: wid,
      entryId: p.id,
      snap: snapshotOf(p),
      at: Date.now()
    });
    if (!write(data)) return { ok: false, code: "E_STORAGE" };
    return { ok: true, added: true, count: data.items.length };
  }

  function remove(entryId) {
    if (!entryId) return false;
    var data = read();
    var wid = uidOf(entryId && entryId.id ? entryId : { id: entryId });
    var before = data.items.length;
    data.items = data.items.filter(function (it) { return it.wid !== wid; });
    if (data.items.length === before) return false;
    write(data);
    return true;
  }

  function removeMany(entryIds) {
    var list = (entryIds || []).filter(Boolean);
    if (!list.length) return 0;
    var data = read();
    var gone = {};
    list.forEach(function (id) { gone[uidOf(id && id.id ? id : { id: id })] = true; });
    var before = data.items.length;
    data.items = data.items.filter(function (it) { return !gone[it.wid]; });
    var n = before - data.items.length;
    if (n) write(data);
    return n;
  }

  function clear() {
    var data = read();
    if (!data.items.length) {
      var s = store();
      if (s) { try { s.removeItem(physKey()); } catch (e) {  } }
      return 0;
    }
    var n = data.items.length;
    write({ items: [] });
    return n;
  }

  // 变成「今日计划」认得的篇目形状（与 js/collections.js 的 scheduleItems
  // 同一个口径：custom=true 表示它不是课内那一篇，首页据此换掉副标题）。
  function poems() {
    return read().items.map(function (it) {
      var snap = it.snap || {};
      var p = {};
      Object.keys(snap).forEach(function (k) { p[k] = snap[k]; });
      p.id = it.id;
      p.title = snap.title || it.id;
      p.custom = true;
      if (!p.bookName) p.bookName = "今日加背";
      return p;
    }).filter(function (p) { return !!p.title; });
  }

  function ids() {
    return read().items.map(function (it) { return it.entryId || it.id; });
  }

  function count() { return read().items.length; }

  function items() { return read().items.slice(); }

  // ---- 云端那一行（sync-store 用）------------------------------------------
  //
  // 与 js/sync-store.js 的 familyRow() 同一个套路：给出一行 progress 记录，
  // 或者 null（没什么要推的）。
  //
  // ⚠️ 它**不能**只在「本机有内容」时给 —— 删到一篇不剩时，云端那一行也得
  //    知道「空了」。所以：本机没有、但之前推过（seen 里留着时间戳）时，
  //    给一行 deleted=1。否则就会出现「A 设备清空了，B 设备还挂着那几篇」。
  function cloudRow(seen) {
    var s = store();
    if (!s) return null;
    var raw = null;
    try { raw = s.getItem(physKey()); } catch (e) { raw = null; }

    var mem = seen || {};
    var known = Number(mem[SYNC_ID]) || 0;

    if (!raw) {
      // 盘上什么都没有：之前推过就补一条删除，从没推过就什么都不用说。
      if (known > 0) {
        var t = nowTs();
        if (t <= known) t = known + 1;
        return { id: SYNC_ID, payload: { v: 1, date: today(), items: [], updatedAt: t }, updatedAt: t, deleted: true };
      }
      return null;
    }

    var data = null;
    try { data = JSON.parse(raw); } catch (e) { data = null; }
    if (!data || !Array.isArray(data.items)) return null;
    if (String(data.date || "") !== today()) return null;

    var ts = Number(data.updatedAt) > 0 ? Math.round(Number(data.updatedAt)) : 0;
    if (ts <= known) return null;
    return { id: SYNC_ID, payload: JSON.parse(raw), updatedAt: ts, deleted: false };
  }

  // 把云端那一行拉下来并进本机。
  //
  // 两条口径（这是两处都能改数据之后**必须**想清楚的部分）：
  //   ① **日期不同就听本机的。** 云端那一行的日期是「别人加背的那一天」——
  //      与今天不同，说明它是过去某天的遗物，本机照旧按今天算（回空）。
  //      反过来，本机今天什么都没加时（无盘上键），云端若写着今天，就认它。
  //   ② **同一天就是「合并」而不是「覆盖」。** 两台设备今天各加了两首，
  //      哪一台都不该把对方那两首抹掉 —— 按 wid 并集（本机的在前，顺序稳定）。
  function applyCloud(row, seen) {
    var payload = (row && row.payload) || null;
    if (!payload || typeof payload !== "object") return "skip";

    var mem = seen || {};
    var known = Number(mem[SYNC_ID]) || 0;
    var cloudTs = Number(row && row.updatedAt) > 0 ? Math.round(Number(row.updatedAt)) : 0;
    var cloudDate = String(payload.date || "");
    var todayStr = today();

    var s = store();
    var raw = null;
    try { raw = s ? s.getItem(physKey()) : null; } catch (e) { raw = null; }
    var local = null;
    try { local = raw ? JSON.parse(raw) : null; } catch (e) { local = null; }
    var localToday = !!(local && Array.isArray(local.items) && String(local.date || "") === todayStr);
    var localItems = localToday ? normalize(local).items : [];

    // 云端写的是**过去**某一天：与本机今天无关。照旧按「今天」算，
    // 但把「见过这一行」记下来，免得每次拉取都当新东西（否则就会反复回空刷新）。
    if (cloudDate !== todayStr) {
      if (localToday) {
        return "skip";
      }
      // 本机没有今天那一份：把盘上残留的旧键清掉，回空（这就是「归零」）。
      try { if (s) s.removeItem(physKey()); } catch (e) {  }
      return "applied";
    }

    // 删除标记：云端说今天加背清空了。
    if (row.deleted) {
      if (!localToday || !localItems.length) return "skip";
      if (known >= cloudTs) return "skip";
      try { if (s) s.removeItem(physKey()); } catch (e) {  }
      emit([]);
      return "applied";
    }

    // 日期同是今天 —— 合并。两边都没有的就什么都不用做。
    var merged = localItems.slice();
    var have = {};
    merged.forEach(function (it) { have[it.wid] = true; });
    var cloudItems = normalize({ date: todayStr, items: payload.items }).items;
    var added = 0;
    cloudItems.forEach(function (it) {
      if (have[it.wid]) return;
      have[it.wid] = true;
      merged.push(it);
      added += 1;
    });
    if (!added && localToday) return "skip";

    // ⚠️ 并完之后本机这一份的 updatedAt **就是云端那个时间戳**（取两者更大的
    //    那个会有个很隐蔽的后果：它比云端那一行新 → 下一轮又被当成「本机改了」
    //    推上去 → push 把 seen 改成新时间 → pull 又拉回同一行 → 每轮同步都重写
    //    一遍本机，首页计划跟着反复重算）。并进来的内容本来就已经在云端那一行
    //    里了，本机不需要再声明一次「我改了」。
    var out = {
      v: 1,
      date: todayStr,
      updatedAt: Math.max(cloudTs, 0),
      items: merged
    };
    try {
      if (!out.items.length) s.removeItem(physKey());
      else s.setItem(physKey(), JSON.stringify(out));
    } catch (e) { return "skip"; }
    emit(out.items);
    return "applied";
  }

  window.DailyExtra = {
    KEY: KEY,
    MAX: MAX,

    physKey: physKey,
    today: today,
    list: items,
    poems: poems,
    ids: ids,
    count: count,
    has: has,
    add: add,
    remove: remove,
    removeMany: removeMany,
    clear: clear,
    reader: read,

    cloudRow: cloudRow,
    applyCloud: applyCloud,
    SYNC_ID: SYNC_ID
  };
})();
