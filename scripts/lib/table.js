/* ===========================================================================
   文档表格生成器（Issue #347 的内容侧）
   ---------------------------------------------------------------------------

   阅读器认两种**纯文本**表格（见 js/reader-core.js 的 renderBlocks）：

     ① 有框表：画出框线的一整块
     ② 无框表：`a ｜ b` 连着两行以上

   手写长表（历朝全录那种二三十行）会出现「某一行少打一根竖线」——
   读者看到的是**整段退回纯文本**，跟没写过表格一样，而作者肉眼很难发现。
   所以内容侧一律用这里的 `box()` 生成，宽度按最长一格自动对齐；
   生成完再拿 `js/reader-core.js` 的 `tableIssues()` 过一遍
   （test/changshi.test.js 里有这条断言）。
   ========================================================================== */

var PIPE = "│";
var CELLW = 2;      // 全角字符宽
var HALFW = 1;      // 半角字符宽

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

/* rows[0] 是表头。表头下的那条分隔线由本函数画，不用传 */
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

/* 无框表：表头 + 「──── ｜ ────」分隔线 + 数据行。列数少、只要对齐关系的用这个 */
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
