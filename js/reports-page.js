(function () {
  "use strict";

  // 设置 · 我的报告（Issue #243 第四轮）
  //
  // 这一页只做一件事：把 `Report.mine()` 拿到的那一份画出来。
  // 图形与文案全在 js/report.js 的 `renderList` 里（与「我报过的」同一份），
  // 所以这里没有第二套 DOM 结构。
  //
  // 一条口径：**服务端读不到时如实说**。没登录 / 断网时画的是本机记下的那一份，
  // 顶部会写一句「本机的」—— 不写的话，用户会以为
  // 「我报的都还在、都收到了」，而实际上有几条根本没发出去。
  //
  // 一条口径之二：**引导语只留一处**。这一页原先有四处教用户「点那颗小旗」
  // （页首一段、未登录一屏、空列表一屏、JS 里三句），用户原话是「废话连篇」。
  // 各屏只留它**独有**的那半句：怎么报错是 `renderList` 空屏那一句的事，
  // 这一页不再复述。

  function $(id) { return document.getElementById(id); }

  function setMsg(text, level) {
    var el = $("msg-reports");
    if (!el) return;
    el.textContent = text || "";
    el.className = "account-msg" + (level ? " " + level : "");
  }

  // 本机还压着几条没发出去 —— 只在这一页说，且只说这一个数。
  //
  // ⚠️ 「本机压着几条」**不能拿画出来的那一列去比**：那一列是
  //    `Report.mine()` 把服务端那份与本机那份**并起来**的结果
  //    （`mergeLocal`），本机那几条本来就在里面 —— 拿它当「服务端那份」
  //    去比，每一条都成了「服务端已经有了」，`pending` 永远是 0。
  //    所以这里比的是**服务端那一份原样**（`serverOnly`），它由调用方传进来。
  //
  // ⚠️ 「没有压着的那几条」**不写**：一句「服务器上 N 条」在用户看过的
  //    那一列里数得出来，写在这里只是把同一件事再说一遍。
  //    （要留也可以，但那正是「废话」这两个字指的东西。）
  function updateSend(serverOnly) {
    var btn = $("btn-reports-send");
    var hint = $("reports-send-hint");
    if (!btn || !hint) return;

    var pending = 0;
    var R = window.Report;
    if (R && typeof R.pendingLocal === "function") {
      pending = R.pendingLocal(serverOnly || []).length;
    }

    btn.hidden = !pending;
    hint.hidden = !pending;
    if (pending) hint.textContent = `还有 ${pending} 条没发出去。`;
  }

  function renderGuest() {
    var g = $("reports-guest");
    if (g) g.hidden = false;
    var p = $("reports-panel");
    // 未登录仍然把本机那一份画出来 —— 那几条大多是「试着发但没发出去」的，
    // 用户最需要看到的就是它们。顶部那句话由 renderList 的 `local` 档写。
    if (p && window.Report) {
      var localList = window.Report.readLocal();
      window.Report.renderList(p, localList, { local: true });
      updateSend([]);
    }
  }

  // 补发本机那几条。发完无论成败都重读一遍 —— 页面上那几个数才是真的。
  function resend() {
    var R = window.Report;
    if (!R || typeof R.resend !== "function") {
      setMsg("页面脚本版本对不上（刷新一次即可）", "warn");
      return;
    }
    var btn = $("btn-reports-send");
    if (btn) btn.disabled = true;
    Promise.resolve(R.resend()).then(function (r) {
      if (btn) btn.disabled = false;
      // 发出去的那几条不另报数：列表重读完就摆在那儿。
      // ⚠️ 一句都不写是**不行**的：一条都没送出去时必须说，否则
      //    「点了一下什么也没发生」就等于骗人（这一页就靠这一句兜底）。
      if (r && r.ok) setMsg("", "");
      else setMsg((r && r.message) || "没发出去，稍后再试。", "warn");
      load();
    })["catch"](function () {
      if (btn) btn.disabled = false;
      setMsg("没发出去，稍后再试。", "warn");
    });
  }

  function load() {
    var R = window.Report;
    if (!R) {
      setMsg("页面脚本版本对不上（刷新一次即可）", "warn");
      return;
    }

    var g = $("reports-guest");
    if (g) g.hidden = R.isSignedIn();
    if (!R.isSignedIn()) { renderGuest(); return; }

    R.mine({ limit: 50 }).then(function (r) {
      setMsg("", "");
      var list = (r && r.reports) || [];
      R.renderList($("reports-panel"), list, { local: !!(r && r.local) });
      updateSend((r && r.serverOnly) || []);
    })["catch"](function () {
      setMsg("读取失败，稍后再试。", "warn");
    });
  }

  function init() {
    var b = $("btn-reports-refresh");
    if (b) b.addEventListener("click", load);

    // 在别的标签页报了错，回到这一页时自动刷一次 —— 与收藏 / 进度那几处同源。
    window.addEventListener("storage", function (e) {
      if (e && e.key === (window.Report && window.Report.KEY)) load();
    });
    window.addEventListener("report-created", function () { load(); });

    // 报告**发到服务器**（权威那一份在 `public.reports`，服务端只读回自己那几条）。
    // 这一页原先没有任何「发出去没有」的出口：用户在篇目页报完，
    // 切到这一页只看得到列表，发没发成、服务端认没认，一个字都没有。
    // 这里给出「还有几条没发出去」，点一下就能把本机那几条再发一次。
    var send = $("btn-reports-send");
    if (send) send.addEventListener("click", resend);

    load();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
