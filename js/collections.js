(function () {
  "use strict";

  var KEY = "poem_recite_collections_v1";
  var NAME_MAX = 12;
  var DEFAULT_NAME = "我要背的";

  var FALLBACK = { free: 10, pro: 100, max: 5000 };

  function limitFor(E, tier) {
    var n = null;
    if (E && typeof E.quotaFor === "function" && E.CAPS) {
      n = E.quotaFor(E.CAPS["collections.many"], tier);
    }
    if (typeof n !== "number") n = FALLBACK[tier];
    return typeof n === "number" ? n : FALLBACK.free;
  }

  function limit() {
    var E = (typeof window !== "undefined" && window.Entitlement) || null;

    if (!E || !E.identity) return Infinity;
    var id = null;
    try { id = E.identity({ backing: window.localStorage }); } catch (e) { id = null; }
    if (!id) return Infinity;

    return limitFor(E, id.tier);
  }

  function remaining() {
    return Math.max(0, limit() - read().collections.length);
  }

  function now() { return Date.now(); }

  function uid() {
    return "c-" + now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }

  function read() {
    try {
      var v = JSON.parse((storeOf() || { getItem: function () { return null; } }).getItem(physKey()) || "null");
      if (!v || typeof v !== "object") return { version: 1, collections: [] };
      if (!Array.isArray(v.collections)) v.collections = [];
      v.collections.forEach(function (c) {
        if (!Array.isArray(c.items)) c.items = [];
      });
      return v;
    } catch (e) {
      return { version: 1, collections: [] };
    }
  }

  function write(data) {

    data.updatedAt = bump(Number(data.updatedAt) > 0 ? Math.round(Number(data.updatedAt)) : stampOf());
    try {
      storeOf().setItem(physKey(), JSON.stringify(data));
    } catch (e) {
      return false;
    }

    clearPlanCache();
    try {
      window.dispatchEvent(new CustomEvent("recite-collections-change", {
        detail: { collections: data.collections }
      }));
    } catch (e) {  }
    return true;
  }

  function cleanName(name) {
    var s = String(name == null ? "" : name).trim().replace(/\s+/g, " ");
    if (!s) s = DEFAULT_NAME;
    return s.slice(0, NAME_MAX);
  }

  function snapshotOf(entryId, index) {
    var list = index || window.SITE_INDEX || [];
    var p = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === entryId) { p = list[i]; break; }
    }
    if (!p) return null;
    return {
      title: p.title, author: p.author || "", authorName: p.authorName || "",
      dynasty: p.dynasty || "", source: p.source || "", selection: p.selection || "",
      book: p.book || "", bookName: p.bookName || "", page: p.page || "",
      text: p.text || "", translation: p.translation || "",
      translationSource: p.translationSource
    };
  }

  function displayTitle(title) {
    var t = String(title == null ? "" : title);

    t = t.replace(/[·・]?其[一二三四五六七八九十]\s*$/, "");
    t = t.replace(/[（(]\s*其[一二三四五六七八九十]\s*[）)]\s*$/, "");
    return t.replace(/[·・\s]+$/, "");
  }

  function widOf(entryId) {
    if (window.WorksIndex && window.WorksIndex.widOf) return window.WorksIndex.widOf(entryId) || entryId;
    return entryId;
  }

  function itemId(it) { return typeof it === "string" ? it : (it && it.id) || ""; }

  function itemSnap(it) { return (it && typeof it === "object" && it.snap) ? it.snap : null; }

  function collectionsOf(entryId) {
    var wid = widOf(entryId);
    return read().collections.filter(function (c) {
      return c.items.some(function (it) { return widOf(itemId(it)) === wid; });
    });
  }

  function has(entryId) {
    return collectionsOf(entryId).length > 0;
  }

  function add(entryId, collectionId) {
    if (!entryId) return null;
    var data = read();
    var created = false;
    var col = null;

    if (collectionId) {
      col = data.collections.filter(function (c) { return c.id === collectionId; })[0] || null;
    }
    if (!col) {
      col = data.collections[0] || null;
    }
    if (!col) {
      col = { id: uid(), name: DEFAULT_NAME, createdAt: now(), items: [] };
      data.collections.push(col);
      created = true;
    }

    var wid = widOf(entryId);
    var exists = col.items.some(function (it) { return widOf(itemId(it)) === wid; });
    if (!exists) {
      col.items.push({ id: entryId, snap: snapshotOf(entryId) });
    }
    write(data);
    return { collection: col, added: !exists, created: created };
  }

  function remove(entryId, collectionId) {
    var data = read();
    var wid = widOf(entryId);
    var col = collectionId
      ? data.collections.filter(function (c) { return c.id === collectionId; })[0]
      : null;
    if (!col) return false;
    var before = col.items.length;
    col.items = col.items.filter(function (it) { return widOf(itemId(it)) !== wid; });
    if (col.items.length === before) return false;
    write(data);
    return true;
  }

  function removeEverywhere(entryId) {
    var data = read();
    var wid = widOf(entryId);
    var hit = false;
    data.collections.forEach(function (c) {
      var before = c.items.length;
      c.items = c.items.filter(function (it) { return widOf(itemId(it)) !== wid; });
      if (c.items.length !== before) hit = true;
    });
    if (hit) write(data);
    return hit;
  }

  function create(name) {
    var data = read();
    var lim = limit();
    if (data.collections.length >= lim) {
      return { error: "E_LIMIT", limit: lim, count: data.collections.length };
    }
    var col = { id: uid(), name: cleanName(name), createdAt: now(), items: [] };
    data.collections.push(col);
    write(data);
    return col;
  }

  function rename(collectionId, name) {
    var data = read();
    var col = data.collections.filter(function (c) { return c.id === collectionId; })[0];
    if (!col) return null;
    col.name = cleanName(name);
    write(data);
    return col;
  }

  function drop(collectionId) {
    var data = read();
    var before = data.collections.length;
    data.collections = data.collections.filter(function (c) { return c.id !== collectionId; });
    if (data.collections.length === before) return false;
    write(data);
    return true;
  }

  function moveItem(collectionId, from, to) {
    var data = read();
    var col = data.collections.filter(function (c) { return c.id === collectionId; })[0];
    if (!col) return false;
    var n = col.items.length;
    var i = Number(from);
    var j = Number(to);
    if (!(i >= 0 && i < n) || !(j >= 0 && j < n) || i === j) return false;
    var it = col.items.splice(i, 1)[0];
    col.items.splice(j, 0, it);
    write(data);
    return true;
  }

  function moveUp(collectionId, index) { return moveItem(collectionId, index, index - 1); }

  function moveDown(collectionId, index) { return moveItem(collectionId, index, index + 1); }

  function removeGroup(collectionId, group, groupOf) {
    var data = read();
    var col = data.collections.filter(function (c) { return c.id === collectionId; })[0];
    if (!col) return 0;
    var g = String(group);
    var before = col.items.length;
    col.items = col.items.filter(function (it) {
      return groupKeyOf(itemId(it), groupOf) !== g;
    });
    var removed = before - col.items.length;
    if (removed) write(data);
    return removed;
  }

  function groupKeyOf(entryId, groupOf) {
    if (typeof groupOf === "function") {
      var k = groupOf(entryId);
      if (k) return String(k);
    }
    return "未分组";
  }

  function exportText(collectionId, labels) {
    var col = read().collections.filter(function (c) { return c.id === collectionId; })[0];
    if (!col) return "";
    var lines = [
      "# 跬步 · 自选集合：" + col.name + "（" + col.items.length + " 篇）",
      "# 一行一条条目 id；以 # 开头的行是说明，导入时会跳过",
      "# 导入方法：跬步首页 → 自选背诵 → 导入"
    ];
    col.items.forEach(function (it) {
      var id = itemId(it);
      if (!id) return;
      var label = labels && labels[id];
      lines.push("# " + (label || id));
      lines.push(id);
    });
    return lines.join("\n") + "\n";
  }

  function importText(text, name, index) {

    if (read().collections.length >= limit()) {
      return { collection: null, added: 0, dropped: 0,
               error: "E_LIMIT", limit: limit() };
    }
    var src = String(text == null ? "" : text).split(/\r?\n/);
    var known = null;
    var list = index || window.SITE_INDEX || [];
    if (list && list.length) {
      known = {};
      list.forEach(function (p) { known[p.id] = p; });
    }
    var ids = [];
    var seen = {};
    var dropped = 0;
    src.forEach(function (line) {
      var t = String(line).trim();
      if (!t || t.charAt(0) === "#") return;
      var id = t.split(/\s+/)[0];
      if (!id) return;

      if (known && !known[id]) { dropped += 1; return; }
      if (seen[id]) return;
      seen[id] = true;
      ids.push(id);
    });

    var snapshots = window.SITE_INDEX || [];
    var col = {
      id: uid(),
      name: cleanName(name || DEFAULT_NAME),
      createdAt: now(),
      items: ids.map(function (id) {
        return { id: id, snap: snapshotOf(id, snapshots) };
      })
    };
    var data = read();
    data.collections.push(col);
    write(data);
    return { collection: col, added: col.items.length, dropped: dropped };
  }

  function allEntries() {
    var data = read();
    var seen = {};
    var out = [];
    data.collections.forEach(function (c) {
      c.items.forEach(function (it) {
        var id = itemId(it);
        var wid = widOf(id);
        if (seen[wid]) return;
        seen[wid] = true;
        out.push({ wid: wid, entryId: id, collectionId: c.id, snapshot: itemSnap(it) });
      });
    });
    return out;
  }

  function count() { return allEntries().length; }

  function poemIdFor(entryId) {
    if (window.WorksIndex && window.WorksIndex.repOf) return window.WorksIndex.repOf(entryId);
    return entryId;
  }

  function scheduleItems(index) {
    var idx = index || window.SITE_INDEX || [];
    var byId = {};
    idx.forEach(function (p) { byId[p.id] = p; });

    var seen = {};
    var out = [];
    allEntries().forEach(function (it) {
      var repEntry = poemIdFor(it.entryId);
      var wid = widOf(it.entryId);
      if (seen[wid]) return;

      var p = byId[repEntry] || byId[it.entryId];
      var snap = it.snapshot || {};
      if (!p && !snap.text) return;
      seen[wid] = true;
      out.push({
        id: repEntry,

        sourceEntryId: it.entryId,
        wid: wid,
        title: (p && p.title) || snap.title || "",
        author: (p && p.author) || snap.author || "",
        dynasty: (p && p.dynasty) || snap.dynasty || "",
        source: (p && p.source) || snap.source || "",
        selection: (p && p.selection) || snap.selection || "",
        book: (p && p.book) || snap.book || "",
        bookName: (p && p.bookName) || snap.bookName || "",
        page: (p && p.page) || snap.page || "",
        text: (p && p.text) || snap.text || "",
        translation: (p && p.translation) || snap.translation || "",
        translationSource: (p && p.translationSource) || snap.translationSource,
        custom: true
      });
    });
    return out;
  }

  var SYNC_ID = "collections:v1";

  function storeOf() {
    var ps = typeof window !== "undefined" && window.ProgressStore ? window.ProgressStore : null;
    if (ps && typeof ps.store === "function") {
      try {
        var s = ps.store();
        if (s) return s;
      } catch (e) {  }
    }
    try {
      return typeof localStorage !== "undefined" ? localStorage : null;
    } catch (e) {
      return null;
    }
  }

  function physKey() {
    var ps = typeof window !== "undefined" && window.ProgressStore ? window.ProgressStore : null;
    if (ps && typeof ps.keyFor === "function") {
      try { return ps.keyFor(KEY, ps.childId ? ps.childId() : ""); } catch (e) {  }
    }
    return KEY;
  }

  function nowTs() { return Date.now(); }

  function stampOf() {
    try {
      var v = JSON.parse((storeOf() || { getItem: function () { return null; } }).getItem(KEY) || "null");
      return v && Number(v.updatedAt) > 0 ? Math.round(Number(v.updatedAt)) : 0;
    } catch (e) { return 0; }
  }

  function bump(prev) {
    var t = nowTs();
    return t > prev ? t : prev + 1;
  }

  function cloudRow(seen) {
    var s = storeOf();
    if (!s) return null;
    var raw = null;
    try { raw = s.getItem(physKey()); } catch (e) { raw = null; }

    var mem = seen || {};
    var known = Number(mem[SYNC_ID]) || 0;

    if (!raw) {

      if (known > 0) {
        var t = bump(known);
        return { id: SYNC_ID, payload: { v: 1, collections: [], updatedAt: t },
                 updatedAt: t, deleted: true };
      }
      return null;
    }

    var data = null;
    try { data = JSON.parse(raw); } catch (e) { data = null; }
    if (!data || !Array.isArray(data.collections)) return null;

    var ts = Number(data.updatedAt) > 0 ? Math.round(Number(data.updatedAt)) : 0;
    if (!ts) {

      ts = bump(known);
      data.updatedAt = ts;
      try { s.setItem(physKey(), JSON.stringify(data)); } catch (e) { return null; }
    }
    if (ts <= known) return null;
    return { id: SYNC_ID, payload: data, updatedAt: ts, deleted: false };
  }

  function applyCloud(row, seen) {
    var payload = (row && row.payload) || null;
    if (!payload || typeof payload !== "object") return "skip";

    var mem = seen || {};
    var known = Number(mem[SYNC_ID]) || 0;
    var cloudTs = Number(row && row.updatedAt) > 0 ? Math.round(Number(row.updatedAt)) : 0;

    var s = storeOf();
    if (!s) return "skip";

    if (row && row.deleted) {
      try { s.removeItem(physKey()); } catch (e) { return "skip"; }
      emitChange([]);
      return "applied";
    }

    var localTs = stampOf();
    if (cloudTs && cloudTs < localTs) return "skip";
    if (cloudTs && cloudTs === localTs && known === cloudTs) return "skip";

    var clean = {
      version: 1,
      updatedAt: cloudTs || nowTs(),
      collections: (Array.isArray(payload.collections) ? payload.collections : []).map(function (c) {
        return {
          id: c && c.id,
          name: cleanName(c && c.name),
          createdAt: Number(c && c.createdAt) > 0 ? Math.round(Number(c.createdAt)) : 0,
          items: (c && Array.isArray(c.items) ? c.items : []).map(function (it) {
            var id = itemId(it);
            if (!id) return null;
            var snap = itemSnap(it);
            return snap ? { id: id, snap: snap } : { id: id };
          }).filter(Boolean)
        };
      }).filter(function (c) { return !!c.id; })
    };

    try { s.setItem(physKey(), JSON.stringify(clean)); } catch (e) { return "skip"; }
    emitChange(clean.collections);
    return "applied";
  }

  function emitChange(collections) {
    clearPlanCache();
    try {
      window.dispatchEvent(new CustomEvent("recite-collections-change", {
        detail: { collections: (collections || []).slice() }
      }));
    } catch (e) {  }
  }

  function clearPlanCache() {
    try {
      Object.keys(sessionStorage)
        .filter(function (k) { return k.indexOf("poem_plan_") === 0; })
        .forEach(function (k) { sessionStorage.removeItem(k); });
    } catch (e) {  }
  }

  window.ReciteCollections = {
    KEY: KEY,
    SYNC_ID: SYNC_ID,
    DEFAULT_NAME: DEFAULT_NAME,
    NAME_MAX: NAME_MAX,

    cloudRow: cloudRow,
    applyCloud: applyCloud,
    stamp: stampOf,

    FREE_COLLECTIONS: FALLBACK.free,
    PRO_COLLECTIONS: FALLBACK.pro,
    MAX_COLLECTIONS: FALLBACK.max,
    FALLBACK: FALLBACK,
    limit: limit,
    remaining: remaining,
    cleanName: cleanName,
    list: function () { return read().collections; },
    get: function (id) { return read().collections.filter(function (c) { return c.id === id; })[0] || null; },
    create: create,
    rename: rename,
    remove: drop,
    add: add,
    removeItem: remove,

    moveItem: moveItem,
    moveUp: moveUp,
    moveDown: moveDown,
    removeGroup: removeGroup,
    exportText: exportText,
    importText: importText,
    removeEverywhere: removeEverywhere,
    collectionsOf: collectionsOf,
    has: has,
    allEntries: allEntries,
    snapshotOf: snapshotOf,

    displayTitle: displayTitle,

    refreshSnapshots: function (index) {
      var list = index || window.SITE_INDEX || [];
      if (!list.length) return 0;
      var data = read();
      var n = 0;
      data.collections.forEach(function (c) {
        c.items = c.items.map(function (it) {
          var wasStr = typeof it === "string";
          if (wasStr) it = { id: it, snap: null };
          var fresh = snapshotOf(it.id, list);
          if (!fresh) return it;

          var hadStale = !!it.stale;
          if (hadStale) delete it.stale;

          if (wasStr || hadStale || JSON.stringify(it.snap) !== JSON.stringify(fresh)) {
            it.snap = fresh;
            n += 1;
          }
          return it;
        });
      });
      if (n) write(data);

      if (n) {
        try {
          window.dispatchEvent(new CustomEvent("recite-snapshots-refresh", {
            detail: { refreshed: n }
          }));
        } catch (e) {  }
      }
      return n;
    },

    markStale: function (index) {
      var list = index || window.SITE_INDEX || [];
      var byId = {};
      list.forEach(function (p) { byId[p.id] = p; });
      var data = read();
      var n = 0;
      data.collections.forEach(function (c) {
        c.items.forEach(function (it) {
          if (!it || typeof it !== "object" || !it.id || !it.snap) return;
          var fresh = byId[it.id];

          var stale = !fresh;
          if (!!it.stale !== stale) {
            if (stale) it.stale = true; else delete it.stale;
            n += 1;
          }
        });
      });
      if (n) {

        try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {  }
      }
      return n;
    },
    count: count,
    widOf: widOf,
    poemIdFor: poemIdFor,
    scheduleItems: scheduleItems
  };
})();
