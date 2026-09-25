(function () {
  "use strict";

  var KEY = "poem_daily_extra_v1";
  var MAX = 20;

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

  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  function nowTs() { return Date.now(); }

  function uidOf(p) {
    if (!p) return "";

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

    if (String(data.date || "") !== today()) {
      try { s.removeItem(physKey()); } catch (e) {  }
      return empty();
    }
    return normalize(data);
  }

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

  function cloudRow(seen) {
    var s = store();
    if (!s) return null;
    var raw = null;
    try { raw = s.getItem(physKey()); } catch (e) { raw = null; }

    var mem = seen || {};
    var known = Number(mem[SYNC_ID]) || 0;

    if (!raw) {

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

    if (cloudDate !== todayStr) {
      if (localToday) {
        return "skip";
      }

      try { if (s) s.removeItem(physKey()); } catch (e) {  }
      return "applied";
    }

    if (row.deleted) {
      if (!localToday || !localItems.length) return "skip";
      if (known >= cloudTs) return "skip";
      try { if (s) s.removeItem(physKey()); } catch (e) {  }
      emit([]);
      return "applied";
    }

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
