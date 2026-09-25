(function () {
  "use strict";

  var KEY = "poem_pinyin_fix_v1";

  var SYNC_ID = "pinyin_fix:v1";

  var MAX = 500;

  var LINE_MAX = 120;

  var PY_MAX = 12;

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

  function nowTs() { return Date.now(); }

  function read() {
    var s = store();
    var raw = null;
    try { raw = s ? s.getItem(physKey()) : null; } catch (e) { raw = null; }
    var o = null;
    try { o = raw ? JSON.parse(raw) : null; } catch (e) { o = null; }
    if (!o || typeof o !== "object") return { v: 1, updatedAt: 0, fixes: [] };
    return { v: 1, updatedAt: Number(o.updatedAt) || 0, fixes: normList(o.fixes) };
  }

  function writeFix(data, at) {
    var s = store();
    if (!s) return false;
    var out = { v: 1, updatedAt: Number(at) || nowTs(), fixes: normList(data && data.fixes) };
    try {
      if (!out.fixes.length) s.removeItem(physKey());
      else s.setItem(physKey(), JSON.stringify(out));
    } catch (e) {
      return false;
    }
    return out;
  }

  function normOne(f) {
    if (!f || typeof f !== "object") return null;
    var wid = String(f.wid == null ? "" : f.wid).trim().slice(0, 80);
    var line = String(f.line == null ? "" : f.line).trim().slice(0, LINE_MAX);
    var py = String(f.py == null ? "" : f.py).trim().slice(0, PY_MAX);
    var ch = String(f.ch == null ? "" : f.ch).trim().slice(0, 1);
    if (!wid || !line || !py) return null;
    var at = Number(f.at);
    at = isFinite(at) && at >= 0 ? Math.round(at) : 0;
    return { wid: wid, line: line, at: at, ch: ch, py: py };
  }

  function normList(list) {
    if (!Array.isArray(list)) return [];
    var seen = {};
    var out = [];
    list.forEach(function (f) {
      var o = normOne(f);
      if (!o) return;
      var k = keyOf(o);
      if (seen[k]) return;
      seen[k] = 1;
      out.push(o);
    });
    return out.slice(0, MAX);
  }

  function keyOf(f) {
    var o = (f && typeof f === "object") ? f : { wid: f };
    return String(o.wid == null ? "" : o.wid) + "\u0000" +
           String(o.line == null ? "" : o.line) + "\u0000" +
           String(Number(o.at) || 0);
  }

  function stamp() {
    var prev = read().updatedAt;
    var t = nowTs();
    return t <= prev ? prev + 1 : t;
  }

  function commit(fixes) {
    var out = writeFix({ fixes: fixes }, stamp());
    if (out) emit();
    return out;
  }

  function add(patch) {
    var o = normOne(patch);
    if (!o) return { ok: false, reason: "bad" };
    var cur = read().fixes;
    var k = keyOf(o);
    var hit = false;
    var next = cur.map(function (f) {
      if (keyOf(f) !== k) return f;
      hit = true;
      return o;
    });
    if (!hit) next.push(o);
    if (next.length > MAX) return { ok: false, reason: "full", max: MAX };
    commit(next);
    return { ok: true, fix: o, replaced: hit };
  }

  function remove(key) {
    var k = String(typeof key === "object" && key ? keyOf(key) : key || "");
    if (!k) return { ok: false, reason: "missing" };
    var cur = read().fixes;
    var next = cur.filter(function (x) { return keyOf(x) !== k; });
    if (next.length === cur.length) return { ok: false, reason: "missing" };
    commit(next);
    return { ok: true, removed: cur.length - next.length };
  }

  function removeMany(keys) {
    var set = {};
    (keys || []).forEach(function (k) { set[String(k)] = 1; });
    var cur = read().fixes;
    var next = cur.filter(function (x) { return !set[keyOf(x)]; });
    var n = cur.length - next.length;
    if (!n) return { ok: false, reason: "missing" };
    commit(next);
    return { ok: true, removed: n };
  }

  function clear() {
    var n = read().fixes.length;
    if (!n) return { ok: true, removed: 0 };
    commit([]);
    return { ok: true, removed: n };
  }

  function mapOf(wid) {
    var w = String(wid == null ? "" : wid);
    var out = {};
    if (!w) return out;
    read().fixes.forEach(function (f) {
      if (f.wid !== w) return;
      out[f.line + "\u0000" + f.at] = f.py;
    });
    return out;
  }

  function count() { return read().fixes.length; }

  function list() { return read().fixes.slice(); }

  function updatedAt() { return read().updatedAt; }

  function emit() {
    try {
      if (typeof window === "undefined" || !window.dispatchEvent) return;
      var ev = null;
      if (typeof window.CustomEvent === "function") ev = new window.CustomEvent("pinyin-fix-change");
      else if (window.Event) ev = new window.Event("pinyin-fix-change");
      if (ev) window.dispatchEvent(ev);
    } catch (e) {  }
  }

  function cloudRow(seen) {
    var data = read();
    var rowId = SYNC_ID;
    var okTs = Number((seen || {})[rowId]) || 0;
    var ts = Number(data.updatedAt) || 0;
    if (ts <= okTs) {

      if (!okTs) ts = nowTs();
      else return null;
    }
    return {
      id: rowId,
      payload: { v: 1, fixes: data.fixes, updatedAt: ts },
      updatedAt: ts,
      deleted: !data.fixes.length
    };
  }

  function applyCloud(row, seen) {
    var payload = (row && row.payload) || null;
    if (!payload || typeof payload !== "object") return "skip";
    var rowId = SYNC_ID;
    var knownTs = Number((seen || {})[rowId]) || 0;
    var cloudTs = Number(row && row.updatedAt) > 0 ? Math.round(Number(row.updatedAt)) : 0;
    if (cloudTs && cloudTs === knownTs && !row.deleted) return "skip";

    var local = read();

    if (cloudTs && local.updatedAt && cloudTs < local.updatedAt) return "keepLocal";

    var out = writeFix({ fixes: row.deleted ? [] : payload.fixes }, cloudTs || local.updatedAt);
    if (!out) return "skip";
    emit();
    return "applied";
  }

  window.PinyinFix = {
    KEY: KEY,
    SYNC_ID: SYNC_ID,
    MAX: MAX,
    LINE_MAX: LINE_MAX,
    PY_MAX: PY_MAX,

    physKey: physKey,
    read: read,
    list: list,
    count: count,
    updatedAt: updatedAt,
    mapOf: mapOf,
    keyOf: keyOf,
    normOne: normOne,

    add: add,
    remove: remove,
    removeMany: removeMany,
    clear: clear,
    emit: emit,

    cloudRow: cloudRow,
    applyCloud: applyCloud
  };
})();

if (typeof module === "object" && module.exports) module.exports = (typeof window !== "undefined" ? window.PinyinFix : null);
