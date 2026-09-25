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

  // 没登录那一屏：说一句「登录后才能报告」＋一条去登录的路，不再顺手列本机存稿。
  //
  // ⚠️ 从前这里列的是 `readLocal()` 并带上 `{ local: true }`，于是页面顶上那句
  //    「本机的（服务端暂时读不到）」**在没登录时也会出现** —— 登录状态未知时
  //    说「暂时读不到」，是在替服务端下结论（Issue #327）。
  function renderGuest() {
    var g = $("reports-guest");
    if (g) g.hidden = false;
    var p = $("reports-panel");
    // 服务端明确说没登录（401）时，本机那几条存稿也不该消失 ——
    // 它们是「没发出去的那几条」，与登录状态无关。
    var local = [];
    if (window.Report && typeof window.Report.readLocal === "function") local = window.Report.readLocal();
    if (p && window.Report && local.length) window.Report.renderList(p, local, {});
    else if (p) p.innerHTML = "";
    updateSend([]);
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

  // 这一页的「登录了没」**以服务端那一发为准**（Issue #327）。
  //
  // ⚠️ 从前这里是 `if (!R.isSignedIn())`，判据是本机（`Entitlement.cookieSession()`
  //    读 `poem_plan_v1` 那份缓存）。服务端刚登录、`/api/me` 那一发还没落地时它
  //    是 false —— 于是明明登录着，页面却写「登录后才能报告」＋「还没有报过」，
  //    用户点一下刷新又好了。
  //
  // 现在的次序：
  //   ① 本机判据只用来决定「未登录那一块先显不显」（让首屏不闪）
  //   ② 真打一发 `GET /api/report`，按它的答案定稿 —— 它说 401 才是没登录
  function load() {
    var R = window.Report;
    if (!R) {
      setMsg("页面脚本版本对不上（刷新一次即可）", "warn");
      return;
    }

    var g = $("reports-guest");
    var localHit = R.isSignedIn();
    if (g) g.hidden = localHit;

    R.mine({ limit: 50 }).then(function (r) {
      setMsg("", "");
      if (g) g.hidden = !(r && r.guest);
      if (r && r.guest) { renderGuest(); return; }
      var list = (r && r.reports) || [];
      R.renderList($("reports-panel"), list, { unreachable: !!(r && r.unreachable) });
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
