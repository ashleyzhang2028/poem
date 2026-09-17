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

  var MARK_OK = "✓";
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
            ? '<span class="plans-mark ok" aria-hidden="true">' + MARK_OK + "</span>"
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

  function renderAbout(id) {
    var box = $("plans-about");
    if (!box) return;
    box.textContent = id && id.tierSource === "server"
      ? "层级由服务器判定，本机改不动。"
      : "层级本机登记，改一行存储就能改。";
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
    renderAbout(id);
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
