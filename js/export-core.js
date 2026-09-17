(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ExportCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SCOPES = {

    custom: {
      id: "custom",
      name: "自选清单",
      unit: "篇",

      books: null
    },

    poems: {
      id: "poems",
      name: "课内诗词",
      unit: "首",
      books: ["poems"]
    }
  };

  var GRADE_NAMES = {
    1: "一年级", 2: "二年级", 3: "三年级", 4: "四年级",
    5: "五年级", 6: "六年级", 7: "七年级", 8: "八年级",
    9: "九年级", 10: "高一", 11: "高二", 12: "高三"
  };

  function gradeName(g) {
    return GRADE_NAMES[Number(g)] || (g ? g + "年级" : "");
  }

  function termName(t) {
    return Number(t) === 2 ? "下" : "上";
  }

  function volumeOf(p) {
    if (!p || p.grade == null) return "";
    return gradeName(p.grade) + termName(p.term);
  }

  function scopes() {
    return Object.keys(SCOPES).map(function (k) {
      var s = SCOPES[k];
      return { id: s.id, name: s.name, unit: s.unit };
    });
  }

  function scopeInfo(id) {
    return SCOPES[id] || null;
  }

  function pick(index, scope) {
    var s = SCOPES[scope];
    if (!s || !Array.isArray(index)) return [];
    return index.filter(function (p) {
      if (!p || p.isBook) return false;
      if (s.books) return s.books.indexOf(p.book) >= 0;
      return !!p.id;
    });
  }

  function order(list, scope) {
    var arr = (list || []).slice();
    if (scope !== "poems") return arr;
    var rank = {};
    for (var g = 1; g <= 12; g += 1) {
      rank[volumeOf({ grade: g, term: 1 })] = (g - 1) * 2;
      rank[volumeOf({ grade: g, term: 2 })] = (g - 1) * 2 + 1;
    }
    var pos = {};
    arr.forEach(function (p, i) { pos[p && p.id] = i; });
    arr.sort(function (a, b) {
      var ra = volumeOf(a) in rank ? rank[volumeOf(a)] : 99;
      var rb = volumeOf(b) in rank ? rank[volumeOf(b)] : 99;
      if (ra !== rb) return ra - rb;
      return (pos[a.id] || 0) - (pos[b.id] || 0);
    });
    return arr;
  }

  function headLine(p) {
    var title = String((p && p.title) || "").trim();
    var author = String((p && p.author) || "").trim();
    var dynasty = String((p && p.dynasty) || "").trim();
    var tail = author || dynasty
      ? "　" + author + (dynasty ? "（" + dynasty + "）" : "")
      : "";
    return title + tail;
  }

  function bodyLines(p) {
    return String((p && p.text) || "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map(function (l) { return l.replace(/\s+$/, ""); });
  }

  function build(o) {
    var opt = o || {};
    var s = SCOPES[opt.scope] || SCOPES.poems;
    var list = Array.isArray(opt.items) ? opt.items.slice() : [];

    var out = [];
    var title = String(opt.title || (s.name + "（跬步导出）")).trim();
    out.push(title);
    out.push("共 " + list.length + " " + s.unit + " · 跬步 kuibu.app");
    if (opt.now) {
      var d = opt.now instanceof Date ? opt.now : new Date(opt.now);
      if (!isNaN(d.getTime())) {
        out.push("导出于 " + d.getFullYear() + "-" +
          ("0" + (d.getMonth() + 1)).slice(-2) + "-" +
          ("0" + d.getDate()).slice(-2));
      }
    }
    out.push("");

    var groups = 0;
    var written = 0;
    var skipped = 0;
    var lastGroup = null;

    list.forEach(function (p) {
      if (!p || !p.id) return;
      var g = s.id === "poems" ? volumeOf(p) : "";
      if (g && g !== lastGroup) {
        lastGroup = g;
        groups += 1;
        out.push("");
        out.push("【" + g + "】");
        out.push("");
      }
      var lines = bodyLines(p);
      var hasBody = lines.some(function (l) { return l.trim() !== ""; });
      if (!hasBody) {

        skipped += 1;
        return;
      }
      written += 1;
      out.push(headLine(p));
      lines.forEach(function (l) { if (l.trim() !== "") out.push(l); });
      if (opt.withTranslation && p.translation) {
        out.push("");
        out.push("白话译文：" + String(p.translation).replace(/\s+/g, " ").trim());
      }
      out.push("");
    });

    var text = out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "") + "\n";
    return { text: text, count: written, skipped: skipped, groups: groups };
  }

  function fileName(scope, now) {
    var s = SCOPES[scope] || SCOPES.poems;
    var d = now instanceof Date ? now : new Date(now || Date.now());
    var stamp = !isNaN(d.getTime())
      ? d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2)
      : "";
    return "跬步-" + s.name + (stamp ? "-" + stamp : "") + ".txt";
  }

  return {
    SCOPES: SCOPES,
    scopes: scopes,
    scopeInfo: scopeInfo,
    pick: pick,
    order: order,
    volumeOf: volumeOf,
    headLine: headLine,
    build: build,
    fileName: fileName
  };
});
