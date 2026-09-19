(function () {
  "use strict";

  // 设置 · 我的报告（Issue #243 第四轮）
  //
  // 这一页只做一件事：把 `Report.mine()` 拿到的那一份画出来。
  // 图形与文案全在 js/report.js 的 `renderList` 里（与「我报过的」同一份），
  // 所以这里没有第二套 DOM 结构。
  //
  // 一条口径：**服务端读不到时如实说**。没登录 / 断网时画的是本机记下的那一份，
  // 顶部会写一句「这是本机记下的」—— 不写的话，用户会以为
  // 「我报的都还在、都收到了」，而实际上有几条根本没发出去。

  function $(id) { return document.getElementById(id); }

  function show(el) { if (el) el.hidden = false; }

  function setMsg(text, level) {
    var el = $("msg-reports");
    if (!el) return;
    el.textContent = text || "";
    el.className = "account-msg" + (level ? " " + level : "");
  }

  function renderGuest() {
    var g = $("reports-guest");
    if (g) g.hidden = false;
    var p = $("reports-panel");
    // 未登录仍然把本机那一份画出来 —— 那几条大多是「试着发但没发出去」的，
    // 用户最需要看到的就是它们。顶部那句话由 renderList 的 `local` 档写。
    if (p && window.Report) {
      window.Report.renderList(p, window.Report.readLocal(), { local: true });
    }
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

    setMsg("正在读取……", "");
    R.mine({ limit: 50 }).then(function (r) {
      setMsg("", "");
      R.renderList($("reports-panel"), (r && r.reports) || [], { local: !!(r && r.local) });
    })["catch"](function () {
      setMsg("读取失败，稍后再试", "warn");
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

    load();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
