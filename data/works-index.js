(function () {
  "use strict";

  function dedupKey(text) {
    return String(text == null ? "" : text)
      .replace(/[\s\u3000]+/g, "")
      .replace(/[，。！？；：、,.!?;:"'“”‘’「」『』《》〈〉（）()\[\]【】—－\-…·~～]/g, "")
      .toLowerCase();
  }

  var COURSE_BOOK = "poems";

  // 「正文去标点后逐字相同」是全站的判重键，但它对成语故事有个已知例外：
  // 语本类成语的正文常常**撞巧相同**（众志成城 / 众口铄金 同引《国语》那句
  // 谚语；贻笑大方 / 大方之家 同引《庄子》「见笑于大方之家」），
  // 而它们是两条成语、各有所属，不是同一篇作品。
  // 名单由 data/chengyu-support.js 声明，data/works-map.js 里对应地拆开登记；
  // 这里让判重键对它们失效，两边口径才一致。
  var NO_AUTO_MERGE = {};
  (window.CHENGYU_SUPPORT || []).forEach(function (x) {
    if (x && x.title) NO_AUTO_MERGE[x.title] = true;
  });
  function autoMergeKey(p) {
    // 只有「成语故事的条目」才看这份名单 —— 同一标题在别的集子里照旧判重
    if (bookOf(p.id) === "chengyu" && NO_AUTO_MERGE[p.title]) return "";
    return dedupKey(p.text);
  }

  var BOOK_RANK = { poems: 0, chengyu: 2 };
  var DEFAULT_RANK = 1;

  function rankOf(entryId) {
    var b = bookOf(entryId);
    return BOOK_RANK[b] == null ? DEFAULT_RANK : BOOK_RANK[b];
  }

  function bookOf(entryId) {
    return String(entryId || "").split("-")[0];
  }

  function buildFromMap(index) {
    var groups = window.WORKS_GROUPS || [];
    var byWid = {};
    var order = [];
    var byEntry = {};
    var byKey = {};

    groups.forEach(function (g) {
      if (!byWid[g.wid]) {
        byWid[g.wid] = { wid: g.wid, key: "", title: g.title, titles: (g.titles || []).slice(), text: "", entries: [] };
        order.push(g.wid);
      }
      g.entries.forEach(function (id) {
        byEntry[id] = g.wid;
        if (byWid[g.wid].entries.indexOf(id) === -1) byWid[g.wid].entries.push(id);
      });
    });

    (index || []).forEach(function (p) {
      if (!p || p.isBook || !p.id) return;
      var wid = byEntry[p.id];
      var key = autoMergeKey(p);
      if (!wid) {
        if (key && byKey[key]) {
          wid = byKey[key];
        } else {
          wid = "w-" + p.id;
          if (key) byKey[key] = wid;
        }
        byEntry[p.id] = wid;
        if (!byWid[wid]) {
          byWid[wid] = { wid: wid, key: key, title: p.title, titles: [], text: p.text || "", entries: [] };
          order.push(wid);
        }
      }
      var w = byWid[wid];
      if (w.titles.indexOf(p.title) === -1) w.titles.push(p.title);
      if (w.entries.indexOf(p.id) === -1) w.entries.push(p.id);
      if (!w.text && p.text) w.text = p.text;
      if (!w.key) w.key = key;
      if (key && !byKey[key]) byKey[key] = wid;

      if (bookOf(p.id) === COURSE_BOOK) w.title = p.title;
    });

    return { list: order.map(function (wid) { return byWid[wid]; }), byEntry: byEntry, byWid: byWid };
  }

  var MAP = buildFromMap(window.SITE_INDEX || []);

  var WORKS = MAP.list;
  var BY_ENTRY = MAP.byEntry;
  var BY_WID = MAP.byWid;

  window.WorksIndex = {
    works: WORKS,

    dedupKey: dedupKey,

    widOf: function (entryId) { return BY_ENTRY[entryId] || entryId || ""; },

    byWid: function (wid) { return BY_WID[wid] || null; },

    entriesOf: function (entryId) {
      var w = BY_WID[BY_ENTRY[entryId]];
      return w ? w.entries.slice() : [];
    },

    same: function (a, b) {
      var wa = BY_ENTRY[a];
      var wb = BY_ENTRY[b];
      return !!wa && wa === wb;
    },

    repOf: function (entryId) {
      var wid = BY_ENTRY[entryId];
      var w = BY_WID[wid];
      if (!w || !w.entries.length) return entryId;
      for (var i = 0; i < w.entries.length; i++) {
        if (bookOf(w.entries[i]) === COURSE_BOOK) return w.entries[i];
      }
      // 同档取「id 最小」那一条 —— 但按**数字序号**比，不按字典序：
      // chengyu-cy-48 该排在 chengyu-cy-217 之前（字典序恰好相反）。
      var seq = function (e) {
        var m = String(e).match(/^(.*?)(\d+)$/);
        return [m ? m[1] : String(e), m ? Number(m[2]) : 0];
      };
      var better = function (a, b) {
        var ra = rankOf(a), rb = rankOf(b);
        if (ra !== rb) return ra < rb;
        var ka = seq(a), kb = seq(b);
        if (ka[0] !== kb[0]) return ka[0] < kb[0];
        if (ka[1] !== kb[1]) return ka[1] < kb[1];
        return a < b;
      };
      var best = null;
      for (var j = 0; j < w.entries.length; j++) {
        if (best == null || better(w.entries[j], best)) best = w.entries[j];
      }
      return best;
    },

    rebuild: function (index) {
      MAP = buildFromMap(index || window.SITE_INDEX || []);
      WORKS = MAP.list;
      BY_ENTRY = MAP.byEntry;
      BY_WID = MAP.byWid;
      window.WorksIndex.works = WORKS;
      window.WORKS_ALL = WORKS;
      return WORKS;
    }
  };

  window.WORKS_ALL = WORKS;
})();
