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

  // 圆里那两颗记号（Issue #229 第二轮画勾 / 第五轮把两颗都画成 SVG）：
  //
  // **勾**：不用字体里的 ✓ —— 它是各家字体的自由发挥，笔形带一点手写的歪劲
  // （用户点名：「需要换一个很正的 √，现在看上去有点手写的样子」）。
  // 三个端点在 24 的方格上：起笔 (6.5,12.6) → 折点 (10.5,17) → 收笔 (18,7)。
  // 收笔那一笔比起笔长（7.5 : 4.0 的斜度差），看着才是「一条撇、一条长捺」的
  // 正勾，不是两条等长的斜线拼出来的手写样。
  //
  // **叉**：以前是字体里的 ✕（Issue #229 第五轮用户点名「打叉图标好像在圆形
  // 背景里垂直方向有一点点偏下」）。字符的墨迹盒由字体自己定：11px 的 ✕ 墨迹
  // 只有 7px 高、还挂在基线上方 —— 装进 18px 的圆里重心飘着，圆底空一块。
  // 换成 SVG 之后，几何中心由坐标说了算，与字体无关。
  //
  // 两颗都描边、笔尖都圆，都装在同一个 24 的方格上，所以下面那一条「居中」
  // 对两者一视同仁 —— 圆心对圆心，不靠各自的墨迹盒碰运气。
  var CHECK_PATH = "M6 12.4 10.5 17 18 7";

  // 叉的两笔：左上 → 右下、右上 → 左下，端点在 (7,7) 与 (17,17)，
  // 外接盒 10×10 正落在 24 的方格中央（墨迹中心 = (12,12)）。
  // 比勾的外接盒（6.5→18、12.5 宽 8.5 高）略大一点 —— 勾有折角显得满，
  // 叉是两条直线、同样外接盒看着会小一圈。
  var CROSS_PATH = "M7 7 17 17M17 7 7 17";

  function markSvg(path) {
    return '<svg class="plans-mark-svg" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="3.2" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      '<path d="' + path + '" /></svg>';
  }

  function markOkSvg() { return markSvg(CHECK_PATH); }
  function markNoSvg() { return markSvg(CROSS_PATH); }

  // 功能名按台账里的 breaks 折行（Issue #229 第五轮）：名字本身一个字不改，
  // 折行点由内核给的那一处说了算 —— 页面不自己猜「哪两个字断开」。
  // 名字里没有那一截（台账改了、页面没跟上）时原样输出，宁可长一行也不吞字。
  //
  // 「折断的那一截」在名字最前面（at === 0）不算一处折行 —— 折行是为了把
  // 后半截顶下去，前头一个空行不是折行。台账里那一处一律是**后半截**。
  function nameHtml(row) {
    var name = row.name;
    var breakAt = row.breaks && row.breaks.length ? row.breaks[0] : null;
    if (!breakAt) return esc(name);
    var at = name.indexOf(breakAt);
    if (at <= 0) return esc(name);
    return esc(name.slice(0, at)) +
      '<br /><span class="plans-th-rest">' + esc(name.slice(at)) + "</span>";
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
            : '<span class="plans-mark no" aria-hidden="true">' + markNoSvg() + "</span>";
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
