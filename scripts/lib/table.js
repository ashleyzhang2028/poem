var PIPE = "│";
var CELLW = 2;
var HALFW = 1;

function width(text) {
  var n = 0;
  Array.from(String(text == null ? "" : text)).forEach(function (ch) {
    n += ch.codePointAt(0) > 0xff ? CELLW : HALFW;
  });
  return n;
}

function pad(text, w) {
  var fill = w - width(text);
  return String(text) + (fill > 0 ? " ".repeat(fill) : "");
}

function box(rows) {
  rows = (rows || []).map(function (r) { return r.map(function (c) { return String(c == null ? "" : c); }); });
  if (!rows.length) return "";

  var cols = rows[0].length;
  rows.forEach(function (r, i) {
    if (r.length !== cols) {
      throw new Error("表格第 " + (i + 1) + " 行有 " + r.length + " 列，表头有 " + cols + " 列");
    }
  });

  var w = [];
  for (var c = 0; c < cols; c++) {
    var m = 0;
    rows.forEach(function (r) { m = Math.max(m, width(r[c])); });
    w.push(m);
  }

  var line = function (left, mid, right) {
    return left + w.map(function (n) { return "─".repeat(n + 2); }).join(mid) + right;
  };
  var body = function (r) {
    return PIPE + " " + r.map(function (cell, i) { return pad(cell, w[i]); }).join(" " + PIPE + " ") + " " + PIPE;
  };

  var out = [line("┌", "┬", "┐"), body(rows[0]), line("├", "┼", "┤")];
  rows.slice(1).forEach(function (r) { out.push(body(r)); });
  out.push(line("└", "┴", "┘"));
  return out.join("\n");
}

function grid(rows) {
  rows = (rows || []).map(function (r) { return r.map(function (c) { return String(c == null ? "" : c); }); });
  if (!rows.length) return "";
  var cols = rows[0].length;
  var head = rows[0].join(" ｜ ");
  var rule = rows[0].map(function (c) { return "─".repeat(Math.max(4, width(c))); }).join(" ｜ ");
  var body = rows.slice(1).map(function (r) { return r.join(" ｜ "); });
  void cols;
  return [head, rule].concat(body).join("\n");
}

module.exports = { box: box, grid: grid, width: width };
