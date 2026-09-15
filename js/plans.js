/**
 * 层级对比页（/plans/，Issue #132）
 * ---------------------------------------------------
 * 这张页只做一件事：把「未登录 / Free / Pro / Max」四种身份能用的功能
 * **横向摆成一张四列表**，让用户一眼看清差在哪。
 *
 * 三条规矩（与 js/profile.js 同源，都是「不许自己拼一遍」那类）：
 *   1. **每格都当场算** —— 全部来自 `Entitlement.compare()`，本页只负责排版。
 *      手抄一份的下场：内核加了能力、改了门槛，这张表还是老话 ——
 *      而这张表恰恰是用户唯一会逐条对着看的页面。
 *   2. **不出现任何权益存储键名**，也不自己比 tier / plan（有源码扫描守着）。
 *   3. **不假装在卖东西** —— 本期没有服务器、没有支付，页面上如实写「本机登记」
 *      「不是付费凭据」；也不写「立即购买」「限时优惠」这类话。
 */
(function () {
  "use strict";

  var Ent = window.Entitlement;

  var backing = null;
  try { backing = window.localStorage; } catch (e) { backing = null; }

  function $(id) { return document.getElementById(id); }
  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /** 勾 / 叉。禁用文字符（✗ 的字宽与基线在安卓上不一致），用两个实心符号 */
  var MARK_OK = "✓";
  var MARK_NO = "✕";

  /* ------------------------------------------------------------ 一、表头 */

  /**
   * 表头：左上角一格写「功能」，右边四格是四种身份。
   * 「你现在在这」的那一列加一枚高亮角标 —— 对比表最要紧的一眼就是这个。
   */
  function renderHead(cmp, current) {
    var head = $("plans-head");
    if (!head) return;
    var html = '<tr><th class="plans-th-cap" scope="col">功能</th>';
    cmp.cols.forEach(function (col) {
      var mine = col.id === current ? ' class="plans-col-me"' : "";
      var now = col.id === current
        ? '<span class="plans-you">你现在在这</span>'
        : "";
      html += '<th scope="col"' + (mine ? ' class="plans-col-me"' : "") + '>' +
        '<span class="plans-col-label">' + esc(col.label) + "</span>" + now + "</th>";
    });
    head.innerHTML = html + "</tr>";
  }

  /* ------------------------------------------------------------ 二、表身 */

  /**
   * 表身：按「所有版本都有 / Pro 起 / Max 起」分三段。
   *
   * 为什么不像内核那样一条能力一行往下平铺：15 行连排时，「哪些是免费的」
   * 要靠用户自己一列一列去找。分段之后第一段就是「免费不缩水」的证据。
   */
  function renderBody(cmp, current) {
    var body = $("plans-body");
    if (!body) return;
    var html = "";
    cmp.groups.forEach(function (g) {
      html += '<tr class="plans-group"><th colspan="' + (cmp.cols.length + 1) + '" scope="colgroup">' +
        esc(g.title) + '<span class="plans-group-note">' + esc(g.note) + "</span></th></tr>";
      g.rows.forEach(function (row) {
        html += '<tr><th class="plans-th-cap" scope="row">' + esc(row.name) +
          (row.quota ? '<span class="plans-quota">每月 ' + esc(row.quota) + " 次</span>" : "") +
          "</th>";
        row.cells.forEach(function (cell, i) {
          var col = cmp.cols[i];
          var mine = col.id === current ? " plans-col-me" : "";
          // 能用的格子只有一枚打钩；不能用的格子打叉 + 一句「从哪一层起」
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

  /* ------------------------------------------------------------ 三、表尾 */

  /**
   * 表尾：每列「能用几项 / 共几项」。
   * 这一行是把整张表压成一个数字 —— 也是「免费不残缺」最直接的数字证据。
   */
  function renderFoot(cmp) {
    var foot = $("plans-foot");
    if (!foot) return;
    var html = '<tr><th class="plans-th-cap" scope="row">能用多少项</th>';
    cmp.summary.forEach(function (s) {
      html += '<td class="plans-sum">' + esc(s.ok) + '<span class="plans-sum-of">/ ' + esc(s.total) + "</span></td>";
    });
    foot.innerHTML = html + "</tr>";
  }

  /* ------------------------------------------------------------ 四、我在哪一格 */

  /**
   * 「你现在的身份」：如实告诉用户他落在哪一列。
   * 判据只走 `Entitlement.identity()` —— 本页不自己读会话、不自己拼 ctx。
   */
  function renderMe(id) {
    var box = $("plans-me");
    if (!box) return;
    var rows = [
      ["身份", id.signedIn ? "已登录 · " + (id.mask || "（无邮箱）") : "未登录（本机游客）"],
      ["层级", Ent.tierLabel(id.tier)],
      ["落在哪一列", id.signedIn ? esc(Ent.tierLabel(id.tier)) : "未登录"]
    ];
    box.innerHTML = rows.map(function (r) {
      return '<div class="kv-row"><span class="kv-k">' + esc(r[0]) +
        '</span><span class="kv-v">' + esc(r[1]) + "</span></div>";
    }).join("");

    // 登录按钮：已经登录的人不需要再看到它
    if (id.signedIn) hide($("btn-go-login")); else show($("btn-go-login"));

    var hint = $("plans-me-hint");
    if (hint) {
      hint.textContent = id.signedIn
        ? "已登录的账号照样能用免费版的全部功能；Pro / Max 由管理员按邮箱掩码登记。"
        : "不登录也能用免费版的全部功能，只有语音朗读要登录（免费）。账号只是让进度不随缓存丢。";
    }
  }

  /* ------------------------------------------------------------ 初始化 */

  function currentColumn(id) {
    // 未登录 ≠ free：游客看的是「未登录」那一列的能力（语音朗读那一格差在这里）
    if (!id.signedIn) return "guest";
    return id.tier;
  }

  function init() {
    if (!Ent) return;
    var id = Ent.identity({ backing: backing });
    var cmp = Ent.compare({});
    var current = currentColumn(id);

    renderHead(cmp, current);
    renderBody(cmp, current);
    renderFoot(cmp);
    renderMe(id);

    var login = $("btn-go-login");
    if (login) login.addEventListener("click", function () { location.href = "/login/"; });
    var prof = $("btn-go-profile");
    if (prof) prof.addEventListener("click", function () { location.href = "/profile/"; });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
