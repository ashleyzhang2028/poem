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
 *   2b. **额度数字也不自己拼** —— 「10 个 / 100 个 / 5000 个」「261 首」这些
 *      数字都在 `Entitlement.compare()` 的 cells[].hint 里（内核从 CAPS 的
 *      `quotas` 取），本页只负责把 hint 放进格子。
 *   3. **不假装在卖东西** —— 页面上如实写层级是「服务器判定」还是「本机登记」
 *      「不是付费凭据」；也不写「立即购买」「限时优惠」这类话。
 *      ⚠️ 2.1：这一句**按当前状态分叉**（`renderAbout()`），不再写死
 *      「本期没有服务器」—— 服务端接通之后那句就是假话。
 */
(function () {
  "use strict";

  var Ent = window.Entitlement;

  var backing = null;
  try { backing = window.localStorage; } catch (e) { backing = null; }

  /* 账号接线层（2.1 新增）：`/api/me` 的唯一接入口 —— 与 js/profile.js 同一条口径。
     本页要它只为一件事：「关于这些层级」那一段得如实说清层级**是谁定的**。
     脚本顺序不对或老缓存时它是 undefined —— 那时**本页照旧工作**（纯本机口径），
     不报错、不清数据。 */
  function acct() { return window.AccountApi || null; }

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

  /** 能力名 —— 一格一个名字，名字由内核给（本页一个字都不拼）。 */
  function nameHtml(row) {
    return esc(row.name);
  }

  /**
   * 表头：左上角一格写「功能」，右边四格是四种身份。
   * 「你现在在这」的那一列加一枚高亮角标 —— 对比表最要紧的一眼就是这个。
   *
   * Issue #163：角标文案从「你现在在这」收成「**现在**」（用户点名）；
   * 第一列（游客）的标题也由内核给出（内核那边从「未登录」改成「游客」）。
   */
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
      // 注解缺席就不画那个 span（空 span 会占一行高度）
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
   *
   * Issue #163：这一格从「能用」改称「**合计**」（用户原话）——
   * 同一个数，不再借「能用」那个词替表表态（能用多少项，四列自己看得见）。
   */
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

  /* --------------------------------------------------- 三点五、这些层级是什么 */

  /**
   * 「关于这些层级」那一段 —— **按当前状态如实分叉**。
   *
   * 2.1 之前这里写死一句「本期没有服务器：层级是本机登记的功能标记」。
   * 服务端接通（2 期）之后，对有会话、且层级确实来自服务端的人来说，
   * 这句是**假话** —— 而项目自己有一条红线就是「不假装配齐了」。
   *
   * 但整句删掉也不对：没配后端 / 连不上时，本机那一份确实是「改一行存储
   * 就能改」的。所以两种状态各说各的实话，判据只有一个 —— `id.tierSource`。
   *
   * Issue #163：原先两种状态后面还各接一句「本站无收款、无支付入口，
   * 层级不是付费凭据」—— 那讲的是「本站不卖东西」，不是这一页要回答的
   * 「这些层级是什么」，删掉。**两种状态各说各的实话**这一条照旧：
   * 判据只有 `id.tierSource`（见 entitlement.js 的 identity()）。
   */
  function renderAbout(id) {
    var box = $("plans-about");
    if (!box) return;
    box.textContent = id && id.tierSource === "server"
      ? "层级由服务器判定，本机改不动。"
      : "层级本机登记，改一行存储就能改。";
  }

  /* ------------------------------------------------------------ 四、我在哪一格 */

  /**
   * ⚠️ Issue #209（用户 2026-09-17）：**这一节整节撤掉了**。
   *
   * 原先这里有两段：「你现在的身份」三行（身份 / 层级 / 落在哪一列，挂
   * `#plans-me`）和未登录时补的一句「未登录，只差这一条：登录可用」
   * （挂 `#plans-me-hint`，文案走 `Entitlement.denyReason("read.aloud")`）。
   *
   * 用户原话：
   *   「现在 / 身份 / 游客（本机） / 层级 / Free / 落在哪一列 / 游客 /
   *     层级本机登记，改一行存储就能改。/ 未登录，只差这一条：登录可用
   *     …… 上面这张卡片没有任何存在的意义，删除」
   *
   * 他点的是**整张卡**（不是卡上的某一句话）：这三行回答的「我现在在哪一格」
   * 上面那张对比表已经用**列头角标**（`renderHead()` 里的「你现在在这」）
   * 指出来了；「只差这一条」里的那一条，在同一张表的**游客列**上就是那个叉。
   * 一页里说三遍同一件事，砍到一遍。
   *
   * ⚠️ 因此 `plans/index.html` 里 `#plans-me` / `#plans-me-hint` 两个挂点也一并
   *    撤了，这里**不许**再长出「没有挂点就静默跳过」的孤儿渲染函数。
   *    守卫：`test/plans-page.test.js` 第廿一节。
   */

  /* ------------------------------------------------------------ 初始化 */

  function currentColumn(id) {
    // 游客 ≠ free：游客看的是「游客」那一列的能力（语音朗读那一格差在这里）
    if (!id.signedIn) return "guest";
    return id.tier;
  }

  /** 按当前（本机 + 已落盘的服务端那一份）口径整页重画 */
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

    /* ------------------------------------------------------------------
       「补洞」（Issue #132 · 2 期）的第 N 张页：把 `/api/me` 接上。
       ------------------------------------------------------------------
       为什么这张页也要问：本页那一段「关于这些层级」要如实说清层级**是谁
       定的**。不问的话，一个层级由服务端判定的人会看到「这是本机登记」——
       而项目自己那条红线就是「不假装配齐了」。

       先画**本机口径**、服务端回来再画一遍 —— 与 profile 同款：
       断网时页面已经可用，首屏速度不押在一个请求上。
       ⚠️ 调不到就**什么都不做**（不当成错误、不清层级缓存）。
       ------------------------------------------------------------------ */
    var M = acct();
    if (M && M.refreshMe) {
      Promise.resolve(M.refreshMe({ backing: backing, E: Ent })).then(function (r) {
        if (!r || !r.ok) return;      // 连不上 / 没登录：本机那份照旧，不重画
        paint();
      })["catch"](function () { /* 问不到就算了，页面已经是可用状态 */ });
    }

    /* ⚠️ 这里原先接的是「建一个账号」与「看我的权限」两颗键的跳转 ——
       Issue #209 之后那两颗键连同各自那张卡一并撤掉（用户原话：
       「纯属多余，这俩卡片也全部删除」），于是这一页现在**一颗按钮都没有**。
       留着这条注释是为了让下一次想加键的人先看到「这一页刻意不给动作」。 */
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
