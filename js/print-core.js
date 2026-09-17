(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PrintCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var PAPER = {
    a4:      { id: "a4",      name: "A4 纵向", columns: 1, rows: 52, isDefault: true },
    a4wide:  { id: "a4wide",  name: "A4 横向", columns: 2, rows: 34 },
    half:    { id: "half",    name: "半张（A5）", columns: 1, rows: 34 }
  };

  var ORDER = ["a4", "a4wide", "half"];

  var HEADER_ROWS = 2;

  var GAP_ROWS = 1;

  function paperOf(id) {
    return PAPER[id] || PAPER.a4;
  }

  function linesOf(text) {
    return String(text == null ? "" : text)
      .split(/\r?\n/)
      .map(function (s) { return s.replace(/[ \t\u3000]+$/g, ""); })
      .filter(function (s) {

        return /[\u3400-\u9fff0-9a-zA-Z]/.test(s);
      });
  }

  function options(poem) {
    var p = poem || {};
    return {
      title: true,
      pinyin: !!p.pinyin,
      translation: !!p.translation,
      blank: false
    };
  }

  function blockOf(poem, o) {
    var p = poem || {};
    var opt = o || {};
    var rows = [];
    var kinds = {};

    function push(text, kind) {
      var s = String(text == null ? "" : text);

      if (!s && kind !== "blank") return;
      kinds[kind] = (kinds[kind] || 0) + 1;
      rows.push({ text: s, kind: kind });
    }

    var body = linesOf(p.text);
    var py = opt.pinyin && p.pinyin ? linesOf(p.pinyin) : [];
    var tr = opt.translation && p.translation ? linesOf(p.translation) : [];

    var bodyFrom = opt.number === false ? 0 : 0;
    body.forEach(function (t, i) {
      if (opt.pinyin && py[i]) push(py[i], "pinyin");
      push(t, "text");

      void bodyFrom;
    });
    if (tr.length) {
      tr.forEach(function (t) { push(t, "translation"); });
    }

    if (opt.blank) {
      var n = opt.blankLines == null ? 3 : Math.max(0, Number(opt.blankLines));
      for (var i = 0; i < n; i += 1) push("", "blank");
    }

    var title = opt.title === false ? "" : String(p.title || "") +
      (p.author ? "　" + p.author : "");
    var meta = [p.dynasty, p.gradeGroup || p.selection || p.book, p.source]
      .filter(Boolean).join(" · ");

    return {
      id: p.id || "",
      title: title.trim(),

      meta: meta,
      rows: rows,
      kinds: kinds,

      height: rows.length +
        (title ? 1 : 0) + (meta ? 1 : 0) + GAP_ROWS
    };
  }

  function layout(poems, o) {
    var opt = o || {};
    var paper = paperOf(opt.paper);

    var list = (poems || []).filter(function (p) { return p && p.id; });
    var blank = opt.blank ? { blank: true, blankLines: opt.blankLines } : {};

    var blocks = list.map(function (p) {
      return blockOf(p, {
        pinyin: !!opt.pinyin,
        translation: !!opt.translation,
        blank: !!opt.blank,
        blankLines: opt.blankLines
      });
    }).filter(function (b) {

      return b.rows.some(function (r) { return r.kind === "text"; });
    });

    var empty = list.length - blocks.length;

    var perColumn = Math.max(1, paper.rows - HEADER_ROWS);
    var perSheet = perColumn * paper.columns;

    var sheets = 1;
    var used = 0;
    var column = 0;
    var oversize = [];
    var placed = [];

    function nextColumn() {
      if (column + 1 >= paper.columns) { column = 0; sheets += 1; }
      else column += 1;
      used = 0;
    }

    if (!blocks.length) sheets = 0;
    blocks.forEach(function (b) {
      if (b.height > perColumn) {

        oversize.push(b.id);
        if (used > 0) nextColumn();
      } else if (used + b.height > perColumn) {
        nextColumn();
      }
      placed.push({ block: b, column: column });
      used += b.height;
    });

    return {
      paper: paper.id,
      paperName: paper.name,
      sheets: sheets,
      columns: paper.columns,
      rows: paper.rows,
      perSheet: perSheet,
      used: blocks.reduce(function (n, b) { return n + b.height; }, 0),
      blocks: blocks,
      placed: placed,
      oversize: oversize,
      empty: empty,
      count: blocks.length
    };
  }

  function summary(lay) {
    if (!lay || !lay.count) return "这一份里还没有篇目。";
    return "约 " + lay.sheets + " 张" + lay.paperName + "（" + lay.count + " 篇" +
      (lay.empty ? "，另有 " + lay.empty + " 篇没有正文、没有排进来" : "") + "）";
  }

  return {
    PAPER: PAPER,
    ORDER: ORDER,
    HEADER_ROWS: HEADER_ROWS,
    GAP_ROWS: GAP_ROWS,
    paperOf: paperOf,
    linesOf: linesOf,
    options: options,
    blockOf: blockOf,
    layout: layout,
    summary: summary
  };
});
