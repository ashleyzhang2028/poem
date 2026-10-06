(function () {
  "use strict";

  // 「以后再背」（Issue #481）
  // ---------------------------------------------------------------------------
  // 背诵列表里每一首的播放键右侧多一颗「以后再背」。点一下，这一首就当没排过：
  // 它从今天的计划里下去，**背完这一趟再说**（今天不再冒出来）。
  //
  // 「延后」不是把这一首永久删掉，而是**按作品把后面几天一起顺延**：
  //
  //     一个作品（WorksIndex 里的那一份，课内/集子里的同文异本算同一份）被延后
  //     一次，它排期的日子就往后挪一天。今天点一次，明天照旧出现；明天再点，
  //     后天再出现。同一首一天点几次都只算一次（同一份「今日顺延」只记一条）。
  //
  // 只记**作品号 + 点它的那一天**，不碰背诵进度里的任何一格（level /
  // nextReviewAt / history 都不动）—— 所以：
  //   · 关掉、刷新、换设备（走同步）都还认得这份延后；
  //   · 「清空进度」不带它走（它不属于进度）；
  //   · 漏掉几天没点，那几天自然不算延后，不会越攒越多。
  //
  // 顺延怎么用：排期算完拿到一首时，看它被延后过几天 —— 那些天的第二天还没到，
  // 就放到那一天再说（见 js/today-plan.js 的 buildTodayPlan 与 js/app.js 的
  // deferToday）。算法本身一个字不改。
  var KEY = "poem_recite_defer_v1";
  var SYNC_ID = "defer:v1";
  var MAX = 400;

  function ps() {
    return typeof window !== "undefined" && window.ProgressStore ? window.ProgressStore : null;
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

  function physKey() {
    var P = ps();
    if (P && typeof P.keyFor === "function") {
      try { return P.keyFor(KEY, P.childId ? P.childId() : ""); } catch (e) {  }
    }
    return KEY;
  }

  // 作品号：同一份作品的不同版本（课内教材本 / 集子本）算同一首。
  //
  // 课内那 251 首在目录（SITE_INDEX）里的号是 `poems-` 前缀的
  // （`poems-xx1-01`，`originId` 才是教材里的 `xx1-01`），而它们进每日计划
  // 走的是 `POEMS_ALL` 里的 `xx1-01` —— 同一首两个号。作品主表（WorksIndex）
  // 只归并「不同集子里同文」的那几组，课内这份别名不在里面，所以这里先剥掉
  // `poems-` 再看作品号（两边都剥，正好落在同一个号上）。
  function stripCoursePrefix(id) {
    return String(id || "").replace(/^poems-/, "");
  }

  function widOf(poemOrId) {
    var id = typeof poemOrId === "string" ? poemOrId : (poemOrId && poemOrId.id) || "";
    if (!id) return "";
    var bare = stripCoursePrefix(id);
    if (window.WorksIndex && typeof window.WorksIndex.widOf === "function") {
      try {
        var wid = window.WorksIndex.widOf(bare) || bare;
        return stripCoursePrefix(wid);
      } catch (e) {  }
    }
    return bare;
  }

  function parseDay(str) {
    var m = String(str == null ? "" : str).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  }

  function startOfDay(ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function todayStr(now) {
    var d = new Date(now === undefined ? Date.now() : now);
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  function stampOf() {
    var s = store();
    var raw = null;
    try { raw = s ? s.getItem(physKey()) : null; } catch (e) { raw = null; }
    var v = null;
    try { v = raw ? JSON.parse(raw) : null; } catch (e) { v = null; }
    return v && Number(v.updatedAt) > 0 ? Math.round(Number(v.updatedAt)) : 0;
  }

  function bump(prev) {
    var t = Date.now();
    return t > prev ? t : prev + 1;
  }

  function normalize(data) {
    var seen = {};
    var items = [];
    ((data && data.items) || []).forEach(function (it) {
      if (!it || typeof it !== "object") return;
      var wid = String(it.wid || "");
      var day = String(it.day || "");
      if (!wid || !parseDay(day)) return;
      var k = wid + "@" + day;
      if (seen[k]) return;
      seen[k] = true;
      items.push({ wid: wid, day: day, at: Number(it.at) > 0 ? Math.round(Number(it.at)) : 0 });
    });
    items.sort(function (a, b) {
      if (a.day !== b.day) return a.day < b.day ? -1 : 1;
      return a.wid < b.wid ? -1 : 1;
    });
    // 只留最近这些天点过的（上限到了先丢最旧的）
    if (items.length > MAX) items = items.slice(items.length - MAX);
    return { v: 1, items: items };
  }

  function read() {
    var s = store();
    if (!s) return { v: 1, updatedAt: 0, items: [] };
    var raw = null;
    try { raw = s.getItem(physKey()); } catch (e) { raw = null; }
    if (!raw) return { v: 1, updatedAt: 0, items: [] };
    var data = null;
    try { data = JSON.parse(raw); } catch (e) { data = null; }
    if (!data || typeof data !== "object") return { v: 1, updatedAt: 0, items: [] };
    var out = normalize(data);
    out.updatedAt = Number(data.updatedAt) > 0 ? Math.round(Number(data.updatedAt)) : 0;
    return out;
  }

  function write(items, at) {
    var s = store();
    if (!s) return false;
    var out = normalize({ items: items });
    // 空名单也照落一份带时间戳的空壳：不然「全撤了」这件事上不了云
    out.updatedAt = typeof at === "number" ? at : bump(stampOf());
    try { s.setItem(physKey(), JSON.stringify(out)); } catch (e) {
      return false;
    }
    emit(out.items);
    return true;
  }

  function emit(items) {
    try {
      window.dispatchEvent(new CustomEvent("recite-defer-change", {
        detail: { items: (items || []).slice(), count: (items || []).length }
      }));
    } catch (e) {  }
  }

  // 某一首被延后过几天（按作品算）
  function days(poemOrId) {
    var wid = widOf(poemOrId);
    if (!wid) return 0;
    var n = 0;
    read().items.forEach(function (it) {
      if (it.wid === wid) n += 1;
    });
    return n;
  }

  function has(poemOrId) {
    return days(poemOrId) > 0;
  }

  // 今天点过没有 —— 今天点过就不再多点一次（一天一次就够）
  function deferredToday(poemOrId, now) {
    var wid = widOf(poemOrId);
    if (!wid) return false;
    var today = todayStr(now);
    return read().items.some(function (it) { return it.wid === wid && it.day === today; });
  }

  function defer(poemOrId, now) {
    if (typeof poemOrId !== "string" && !(poemOrId && poemOrId.id)) {
      return { ok: false, code: "E_NO_POEM", days: 0 };
    }
    var wid = widOf(poemOrId);
    if (!wid) return { ok: false, code: "E_NO_POEM", days: 0 };
    if (deferredToday(wid, now)) {
      return { ok: true, added: false, days: days(wid) };
    }
    var data = read();
    data.items.push({ wid: wid, day: todayStr(now), at: Date.now() });
    if (!write(data.items)) return { ok: false, code: "E_STORAGE", days: days(wid) };
    return { ok: true, added: true, days: days(wid) };
  }

  // 撤销今天的这一次（孩子点了又后悔）
  function undo(poemOrId, now) {
    var wid = widOf(poemOrId);
    if (!wid) return false;
    var today = todayStr(now);
    var data = read();
    var before = data.items.length;
    data.items = data.items.filter(function (it) {
      return !(it.wid === wid && it.day === today);
    });
    if (data.items.length === before) return false;
    write(data.items);
    return true;
  }

  function clearAll() {
    var data = read();
    var n = data.items.length;
    write([]);
    return n;
  }

  // 一首今天该不该压着不排 —— 要压就回「该等到哪一天」（当天 0 点的时间戳），
  // 不压回 null。
  //
  // 一次延后 = 往后挪一天：点的那一天（含当天）先不见，第二天照旧。
  // 今天已经背掉的（有 lastReviewAt）不压 —— 它本来就该留在计划里，压下去
  // 只会让「今天背过」的那一格凭空消失。
  function holdUntil(poemOrId, rec, now) {
    if (rec && rec.lastReviewAt) return null;
    var wid = widOf(poemOrId);
    if (!wid) return null;
    var t0 = startOfDay(now === undefined ? Date.now() : now);
    var last = null;
    read().items.forEach(function (it) {
      if (it.wid !== wid) return;
      var ts = parseDay(it.day);
      // 只认今天及今天的点法：昨天的那一次今天已经顺过去了，不该再往后推
      if (ts != null && ts <= t0) last = ts;
    });
    if (last == null) return null;
    return last + 24 * 60 * 60 * 1000;
  }

  function holdToday(poemOrId, rec, now) {
    var until = holdUntil(poemOrId, rec, now);
    if (until == null) return false;
    return until > startOfDay(now === undefined ? Date.now() : now);
  }

  function count() { return read().items.length; }

  function items() { return read().items.slice(); }

  // ---- 上云（与「今日加背」同一套口径：账号域、按作品比对、时间戳取新的） ----
  function cloudRow(seen) {
    var s = store();
    if (!s) return null;
    var raw = null;
    try { raw = s.getItem(physKey()); } catch (e) { raw = null; }

    var mem = seen || {};
    var known = Number(mem[SYNC_ID]) || 0;

    if (!raw) {
      if (known > 0) {
        var t = Date.now();
        if (t <= known) t = known + 1;
        return { id: SYNC_ID, payload: { v: 1, items: [], updatedAt: t }, updatedAt: t, deleted: true };
      }
      return null;
    }

    var data = null;
    try { data = JSON.parse(raw); } catch (e) { data = null; }
    if (!data || !Array.isArray(data.items)) return null;

    var ts = Number(data.updatedAt) > 0 ? Math.round(Number(data.updatedAt)) : 0;
    if (ts <= known) return null;
    return { id: SYNC_ID, payload: JSON.parse(raw), updatedAt: ts, deleted: false };
  }

  function applyCloud(row, seen) {
    var payload = (row && row.payload) || null;
    if (!payload || typeof payload !== "object") return "skip";

    var mem = seen || {};
    var known = Number(mem[SYNC_ID]) || 0;
    var cloudTs = Number(row && row.updatedAt) > 0 ? Math.round(Number(row.updatedAt)) : 0;
    var s = store();
    var raw = null;
    try { raw = s ? s.getItem(physKey()) : null; } catch (e) { raw = null; }
    var local = null;
    try { local = raw ? JSON.parse(raw) : null; } catch (e) { local = null; }
    var localItems = normalize(local).items;

    if (row.deleted) {
      if (!localItems.length) return "skip";
      if (known >= cloudTs) return "skip";
      try { if (s) s.setItem(physKey(), JSON.stringify({ v: 1, updatedAt: cloudTs, items: [] })); }
      catch (e) {  }
      emit([]);
      return "applied";
    }

    var merged = localItems.slice();
    var have = {};
    merged.forEach(function (it) { have[it.wid + "@" + it.day] = true; });
    var cloudItems = normalize({ items: payload.items }).items;
    var added = 0;
    cloudItems.forEach(function (it) {
      var k = it.wid + "@" + it.day;
      if (have[k]) return;
      have[k] = true;
      merged.push(it);
      added += 1;
    });
    if (!added) return "skip";

    var out = normalize({ items: merged });
    out.updatedAt = Math.max(cloudTs, 0);
    try { s.setItem(physKey(), JSON.stringify(out)); } catch (e) { return "skip"; }
    emit(out.items);
    return "applied";
  }

  window.ReciteDefer = {
    KEY: KEY,
    SYNC_ID: SYNC_ID,
    MAX: MAX,

    physKey: physKey,
    widOf: widOf,
    list: items,
    count: count,
    days: days,
    has: has,
    holdUntil: holdUntil,
    holdToday: holdToday,
    deferredToday: deferredToday,
    defer: defer,
    undo: undo,
    clear: clearAll,

    cloudRow: cloudRow,
    applyCloud: applyCloud
  };
})();
