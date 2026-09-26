(function () {
  "use strict";

  var PREFIX = "reads:";

  var BOOKS = [
    "poem_poems_read_v1",
    "poem_classic_read_v1",
    "poem_yuefu_read_v1",
    "poem_tangshi_read_v1",
    "poem_songci_read_v1",
    "poem_guwen_read_v1",
    "poem_zhaoming_read_v1",
    "poem_yuanqu_read_v1",
    "poem_yuefu_read_v1",
    "poem_jinxiandai_read_v1",
    "poem_chengyu_read_v1",
    "poem_changshi_read_v1"
  ];

  function ps() {
    return typeof window !== "undefined" && window.ProgressStore ? window.ProgressStore : null;
  }

  function known(key) {
    return BOOKS.indexOf(String(key == null ? "" : key)) > -1;
  }

  function keyOf(rowId) {
    var s = String(rowId == null ? "" : rowId);
    if (s.indexOf(PREFIX) !== 0) return "";
    var k = s.slice(PREFIX.length);
    return known(k) ? k : "";
  }

  function isReadRow(rowId) {
    return !!keyOf(rowId);
  }

  function nowTs() { return Date.now(); }

  function cloudRow(key, seen) {
    var K = keyOf(PREFIX + key) || (known(key) ? key : "");
    if (!K) return null;
    var P = ps();
    var map = null;
    try { map = P && P.readMap ? (P.readMap(K) || {}) : null; } catch (e) { map = null; }
    if (!map) return null;

    var mem = seen || {};
    var rowId = PREFIX + K;
    var knownTs = Number(mem[rowId]) || 0;
    var stamp = Number(mem[rowId + "__at"]) || 0;

    var marks = {};
    var n = 0;
    Object.keys(map).forEach(function (id) {
      if (!id) return;
      var v = map[id];
      if (!v) return;
      var o = (v && typeof v === "object") ? v : {};
      marks[id] = {
        at: Number(o.at) > 0 ? Math.round(Number(o.at)) : 0,
        times: Number(o.times) > 0 ? Math.round(Number(o.times)) : 0
      };
      n++;
    });

    if (!n) {
      if (knownTs > 0) {
        var t = nowTs();
        if (t <= knownTs) t = knownTs + 1;
        return { id: rowId, payload: { v: 1, marks: {}, updatedAt: t }, updatedAt: t, deleted: true };
      }
      return null;
    }

    var ts = stamp;
    if (ts <= knownTs) {

      if (!knownTs) ts = nowTs();
      else return null;
    }
    return { id: rowId, payload: { v: 1, marks: marks, updatedAt: ts }, updatedAt: ts, deleted: false };
  }

  function applyCloud(row, seen) {
    var key = keyOf(row && row.id);
    if (!key) return "skip";
    var payload = (row && row.payload) || null;
    if (!payload || typeof payload !== "object") return "skip";

    var P = ps();
    if (!P || !P.setReadMap) return "skip";

    var rowId = PREFIX + key;
    var mem = seen || {};
    var knownTs = Number(mem[rowId]) || 0;
    var cloudTs = Number(row && row.updatedAt) > 0 ? Math.round(Number(row.updatedAt)) : 0;
    if (cloudTs && cloudTs === knownTs && !row.deleted) return "skip";

    function syncStampTo(ts) {
      try {
        var S = typeof window !== "undefined" ? window.SyncStore : null;
        if (!S || typeof S.markSeen !== "function") return;
        var prev = Number((S.seen ? S.seen() : {})[rowId + "__at"]) || 0;
        if (ts <= prev) return;
        S.markSeen(rowId + "__at", ts);
      } catch (e) {  }
    }

    if (row.deleted) {
      try { P.setReadMap(key, {}); } catch (e) { return "skip"; }
      syncStampTo(cloudTs);
      return "applied";
    }

    var local = {};
    try { local = P.readMap(key) || {}; } catch (e) { local = {}; }

    var next = {};
    Object.keys(local).forEach(function (id) {
      var o = (local[id] && typeof local[id] === "object") ? local[id] : {};
      next[id] = { read: true, at: Number(o.at) > 0 ? Math.round(Number(o.at)) : 0,
                   times: Number(o.times) > 0 ? Math.round(Number(o.times)) : 0 };
    });

    var marks = (payload.marks && typeof payload.marks === "object") ? payload.marks : {};
    var added = 0;
    Object.keys(marks).forEach(function (id) {
      if (!id) return;
      var o = (marks[id] && typeof marks[id] === "object") ? marks[id] : {};
      var at = Number(o.at) > 0 ? Math.round(Number(o.at)) : 0;
      var times = Number(o.times) > 0 ? Math.round(Number(o.times)) : 0;
      var had = next[id];
      if (!had) {
        next[id] = { read: true, at: at, times: times };
        added++;
        return;
      }

      if (at && had.at && at < had.at) had.at = at;
      if (!had.at && at) had.at = at;
      if (times > had.times) had.times = times;
      had.read = true;
    });

    if (!added && knownTs > 0 && knownTs === cloudTs) return "skip";

    try { P.setReadMap(key, next); } catch (e) { return "skip"; }
    syncStampTo(cloudTs);
    return added ? "applied" : "skip";
  }

  function touch(key) {
    var K = String(key == null ? "" : key);
    if (!known(K)) return false;
    try {
      var S = typeof window !== "undefined" ? window.SyncStore : null;
      if (!S || typeof S.markSeen !== "function") return false;
      var mem = S.seen ? (S.seen() || {}) : {};
      var rowId = PREFIX + K;
      var t = nowTs();
      var prev = Number(mem[rowId + "__at"]) || 0;
      if (t <= prev) t = prev + 1;
      S.markSeen(rowId + "__at", t);
      return true;
    } catch (e) {
      return false;
    }
  }

  function stampOf(key) {
    try {
      var S = typeof window !== "undefined" ? window.SyncStore : null;
      if (!S || typeof S.seen !== "function") return 0;
      var mem = S.seen() || {};
      return Number(mem[PREFIX + String(key)] + "__at") || 0;
    } catch (e) {
      return 0;
    }
  }

  window.ReadSync = {
    PREFIX: PREFIX,
    BOOKS: BOOKS,
    MAX: 2000,

    known: known,
    keyOf: keyOf,
    isReadRow: isReadRow,
    rowIdOf: function (key) { return PREFIX + String(key == null ? "" : key); },

    cloudRow: cloudRow,
    applyCloud: applyCloud,
    touch: touch,
    stampOf: stampOf,

    rows: function (seen) {
      var out = [];
      BOOKS.forEach(function (k) {
        var r = null;
        try { r = cloudRow(k, seen) || null; } catch (e) { r = null; }
        if (r) out.push(r);
      });
      return out;
    }
  };
})();

if (typeof module === "object" && module.exports) module.exports = (typeof window !== "undefined" ? window.ReadSync : null);
