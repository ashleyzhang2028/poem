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

// 全角（占 2 单位）的列，宽度可能是奇数（列里有「李」「的」这种单字标点混排），
// 而半角空格补不满的那一格会在终端里把边框线顶偏一行。补半格看不见，
// 索性把整条**加宽到偶数** —— 正文里多出的那一格是半角空格，肉眼无差别。
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

  // 规则线要与正文行**同宽**。列宽 n 是 width() 算出来的显示单位（全角 2 / 半角 1），
  // 而 "─" 自己也是全角（占 2 单位），一段 n + 2 单位恰好要 (n + 2) / 2 个。
  // 原先写 repeat(n + 2)，规则线整整比正文宽一倍 —— 一百多张表全中招，
  // 只是终端与比例字体里看着"像个框"，没被当回事（Issue #381 的长行表上尤其扎眼）。
  // 列宽含半角字（n 为奇数）时除不尽，就让**正文**多补半格把每列凑成偶数，
  // 差的那一格补在列尾看不见；反过来在规则线上补半角 "-" 一眼就能看见。
  var wEven = w.map(function (n) { return n + (n % 2); });
  var line = function (left, mid, right) {
    return left + wEven.map(function (n) { return "─".repeat((n + 2) / 2); }).join(mid) + right;
  };
  var body = function (r) {
    return PIPE + " " + r.map(function (cell, i) { return pad(cell, wEven[i]); }).join(" " + PIPE + " ") + " " + PIPE;
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
