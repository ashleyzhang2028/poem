(function () {
  "use strict";

  var Ent = window.Entitlement;

  var backing = null;
  try { backing = window.localStorage; } catch (e) { backing = null; }

  function acct() { return window.AccountApi || null; }

  function $(id) { return document.getElementById(id); }
  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // 绿色那颗「可用」的记号（Issue #229 第二轮）：**不用字体里的 ✓** ——
  // 「✓」是各家字体的自由发挥，笔形带一点手写的歪劲（用户点名：「需要换一个
  // 很正的 √，现在看上去有点手写的样子」）。改画一枚 SVG：两条线段按坐标落，
  // 任何机器上都是同一个形状，与字号 / 字体无关。
  //
  // 三条线段端点在 24 的方格上：起笔 (5,12.6) → 折点 (10,17.4) → 收笔 (19.2,6.2)。
  // 收笔那一笔比起笔长（7.6 : 2.0 的斜度差），看着才是「一条撇、一条长捺」的
  // 正勾，不是两条等长的斜线拼出来的手写样。stroke-linecap: round ——
  // 两个笔尖是圆的，和胶囊一样不是刀切的方头。
  var CHECK_PATH = "M5 12.6 10 17.4 19.2 6.2";

  function markOkSvg() {
    return '<svg class="plans-mark-svg" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="3.2" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      '<path d="' + CHECK_PATH + '" /></svg>';
  }

  // 「不可用」仍是字体里的叉（它是灰色、不承担「正不正」的观感），
  // 但形状交给同一格：都装进 .plans-mark 那个圆里。
  var MARK_NO = "✕";

  function nameHtml(row) {
    return esc(row.name);
  }

  function renderHead(cmp, current) {
    var head = $("plans-head");
    if (!head) return;
    var html = '<tr><th class="plans-th-cap" scope="col">功能</th>';
    cmp.cols.forEach(function (col) {
      var mine = col.id === current ? ' class="plans-col-me"' : "";
      var now = col.id === current
        ? '<span class="plans-you">现在</span>'
        : "";
      html += '<th scope="col"' + (mine ? ' class="plans-col-me"' : "") + '>' +
        '<span class="plans-col-label">' + esc(col.label) + "</span>" + now + "</th>";
    });
    head.innerHTML = html + "</tr>";
  }

  function renderBody(cmp, current) {
    var body = $("plans-body");
    if (!body) return;
    var html = "";
    cmp.groups.forEach(function (g) {

      var gnote = g.note ? '<span class="plans-group-note">' + esc(g.note) + "</span>" : "";
      html += '<tr class="plans-group"><th colspan="' + (cmp.cols.length + 1) + '" scope="colgroup">' +
        esc(g.title) + gnote + "</th></tr>";
      g.rows.forEach(function (row) {
        html += '<tr><th class="plans-th-cap" scope="row">' + nameHtml(row) +
          (row.quota ? '<span class="plans-quota">每月 ' + esc(row.quota) + " 次</span>" : "") +
          "</th>";
        row.cells.forEach(function (cell, i) {
          var col = cmp.cols[i];
          var mine = col.id === current ? " plans-col-me" : "";

          var inner = cell.ok
            ? '<span class="plans-mark ok" aria-hidden="true">' + markOkSvg() + "</span>"
            : '<span class="plans-mark no" aria-hidden="true">' + MARK_NO + "</span>";
          var hint = cell.hint
            ? '<span class="plans-cell-hint">' + esc(cell.hint) + "</span>"
            : "";
          html += '<td class="plans-cell' + mine + (cell.ok ? " on" : " off") + '"' +
            ' data-cap="' + esc(row.cap) + '" data-col="' + esc(col.id) + '">' +
            '<span class="plans-v">' + inner + "</span>" + hint + "</td>";
        });
        html += "</tr>";
      });
    });
    body.innerHTML = html;
  }

  function renderFoot(cmp) {
    var foot = $("plans-foot");
    if (!foot) return;
    var html = '<tr><th class="plans-th-cap" scope="row">合计</th>';
    cmp.summary.forEach(function (s) {
      html += '<td class="plans-sum">' + esc(s.ok) +
        '<span class="plans-sum-of">/ ' + esc(s.total) + "</span></td>";
    });
    foot.innerHTML = html + "</tr>";
  }

  function currentColumn(id) {

    if (!id.signedIn) return "guest";
    return id.tier;
  }

  function paint() {
    var id = Ent.identity({ backing: backing });
    var cmp = Ent.compare({});
    var current = currentColumn(id);

    renderHead(cmp, current);
    renderBody(cmp, current);
    renderFoot(cmp);
  }

  function init() {
    if (!Ent) return;
    paint();

    var M = acct();
    if (M && M.refreshMe) {
      Promise.resolve(M.refreshMe({ backing: backing, E: Ent })).then(function (r) {
        if (!r || !r.ok) return;
        paint();
      })["catch"](function () {  });
    }

  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
