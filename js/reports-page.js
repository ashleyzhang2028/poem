(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }

  function setMsg(text, level) {
    var el = $("msg-reports");
    if (!el) return;
    el.textContent = text || "";
    el.className = "account-msg" + (level ? " " + level : "");
  }

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

    if (p && window.Report) {
      var localList = window.Report.readLocal();
      window.Report.renderList(p, localList, { local: true });
      updateSend([]);
    }
  }

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

    window.addEventListener("storage", function (e) {
      if (e && e.key === (window.Report && window.Report.KEY)) load();
    });
    window.addEventListener("report-created", function () { load(); });

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
