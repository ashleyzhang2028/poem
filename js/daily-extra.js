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
  // ⚠️ 这份数据**不上云**（sync-store 只搬 progress 与 settings 两域）。
  //    换设备之后今日加背不会跟过去 —— 它是「今天」的东西，跟着设备走反而对。
  //    这一点在设置页那一块如实写着，不假装会同步。

  var KEY = "poem_daily_extra_v1";
  var MAX = 20;

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
    return { v: 1, date: today(), items: [] };
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
    var seen = {};
    var items = [];
    data.items.forEach(function (it) {
      if (!it || typeof it !== "object" || !it.id) return;
      var wid = it.wid || uidOf(it);
      if (!wid || seen[wid]) return;
      seen[wid] = true;
      items.push(it);
    });
    return { v: 1, date: data.date, items: items };
  }

  function write(data) {
    var s = store();
    if (!s) return false;
    var out = { v: 1, date: today(), items: (data && data.items) || [] };
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
    write({ v: 1, date: today(), items: [] });
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
    reader: read
  };
})();
