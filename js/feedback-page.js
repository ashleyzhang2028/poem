(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var F = null;
  var pickedKind = "feature";
  var threads = [];

  function timeText(ts) {
    var t = Number(ts) || 0;
    if (!t) return "";
    var d = new Date(t);
    var p = function (n) { return n < 10 ? "0" + n : "" + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function setMsg(text, level) {
    var el = $("msg-feedback");
    if (!el) return;
    el.textContent = text || "";
    el.className = "account-msg" + (level ? " " + level : "");
  }

  function renderKinds() {
    var host = $("fb-kinds");
    if (!host) return;
    host.innerHTML = F.KINDS.map(function (k) {
      var on = k.key === pickedKind;
      return '<button type="button" data-fb-kind="' + k.key + '"' +
        (on ? ' class="active" aria-pressed="true"' : ' aria-pressed="false"') +
        ' title="' + esc(k.hint) + '">' + esc(k.label) + "</button>";
    }).join("");
    var box = $("fb-content");
    if (box) box.placeholder = F.kindOf(pickedKind).placeholder || "写下你的想法……";
  }

  function onKindsClick(e) {
    var b = e.target.closest ? e.target.closest("button[data-fb-kind]") : null;
    if (!b) return;
    pickedKind = b.getAttribute("data-fb-kind");
    renderKinds();
  }

  function onSubmit() {
    var box = $("fb-content");
    var btn = $("btn-fb-send");
    var content = ((box && box.value) || "").trim();
    if (!content) {
      setMsg("写点什么再发（哪怕一句话）。", "warn");
      if (box && box.focus) box.focus();
      return;
    }
    if (btn) btn.disabled = true;
    setMsg("正在发送……", "");
    F.create({ kind: pickedKind, content: content }).then(function (r) {
      if (btn) btn.disabled = false;
      if (r && r.ok) {
        if (box) box.value = "";
        setMsg("已发送，管理员看到会在下面回复你。", "ok");
        load();
        return;
      }
      setMsg((r && r.message) || "没发出去，稍后再试。", "warn");
    })["catch"](function () {
      if (btn) btn.disabled = false;
      setMsg("没发出去，稍后再试。", "warn");
    });
  }

  function threadHtml(t, ti) {
    var comments = (t.comments || []).map(function (c, ci) { return commentHtml(t, c, ti, ci); }).join("");
    return '<li class="fb-thread report-st-' + esc(t.status) + '" data-fb-tid="' + esc(t.tid) + '">' +
      '<div class="report-row-head">' +
      '<span class="report-kind">' + esc(F.labelOfKind(t.kind)) + "</span>" +
      '<span class="report-status">' + esc(F.labelOfStatus(t.status)) + "</span>" +
      '<button type="button" class="pf-link danger fb-del-thread" data-fb-del-thread="' + esc(t.tid) + '">删除</button>' +
      "</div>" +
      '<div class="fb-content-text">' + esc(t.content) + "</div>" +
      '<div class="report-row-time">' + esc(timeText(t.createdAt)) + " · " + esc(F.descOfStatus(t.status)) + "</div>" +
      (comments ? '<ul class="fb-comments">' + comments + "</ul>" : "") +
      '<div class="fb-reply-row">' +
      '<textarea class="account-input" rows="2" maxlength="' + F.LIMITS.comment + '" placeholder="追加一句……" data-fb-reply-of="' + esc(t.tid) + '"></textarea>' +
      '<button type="button" class="account-btn ghost" data-fb-send-reply="' + esc(t.tid) + '">发送</button>' +
      "</div>" +
      "</li>";
  }

  function commentHtml(t, c) {
    var isAdmin = c.role === "admin";
    return '<li class="fb-comment' + (isAdmin ? " is-admin" : " is-user") + '">' +
      '<span class="fb-comment-who">' + (isAdmin ? "管理员" : "你") + "</span>" +
      '<span class="fb-comment-text">' + esc(c.content) + "</span>" +
      '<span class="fb-comment-time">' + esc(timeText(c.createdAt)) + "</span>" +
      (isAdmin ? "" : '<button type="button" class="pf-link danger" data-fb-del-comment="' + esc(c.cid) + '">删除</button>') +
      "</li>";
  }

  function renderThreads() {
    var box = $("fb-list");
    var empty = $("fb-empty");
    if (!box) return;
    if (empty) empty.hidden = threads.length > 0;
    box.innerHTML = threads.map(threadHtml).join("");
  }

  function load() {
    F.mine().then(function (r) {
      threads = (r && r.threads) || [];
      renderThreads();
    });
  }

  function onListClick(e) {
    var t = e.target;
    if (!t.closest) return;

    var delThread = t.closest("button[data-fb-del-thread]");
    if (delThread) {
      if (!window.confirm("删除这条反馈？下面的跟帖也会一起删掉，无法恢复。")) return;
      var tid = delThread.getAttribute("data-fb-del-thread");
      F.remove({ tid: tid }).then(function (r) {
        if (r && r.ok) { setMsg("已删除。", "ok"); load(); }
        else setMsg((r && r.message) || "删除失败，请重试。", "warn");
      });
      return;
    }

    var delComment = t.closest("button[data-fb-del-comment]");
    if (delComment) {
      var cid = delComment.getAttribute("data-fb-del-comment");
      F.remove({ cid: cid }).then(function (r) {
        if (r && r.ok) { setMsg("已删除。", "ok"); load(); }
        else setMsg((r && r.message) || "删除失败，请重试。", "warn");
      });
      return;
    }

    var send = t.closest("button[data-fb-send-reply]");
    if (send) {
      var tid2 = send.getAttribute("data-fb-send-reply");
      var box = document.querySelector('textarea[data-fb-reply-of="' + tid2 + '"]');
      var content = ((box && box.value) || "").trim();
      if (!content) { if (box && box.focus) box.focus(); return; }
      send.disabled = true;
      F.addComment(tid2, content).then(function (r) {
        send.disabled = false;
        if (r && r.ok) { load(); }
        else setMsg((r && r.message) || "没发出去，稍后再试。", "warn");
      });
    }
  }

  function init() {
    F = window.Feedback;
    if (!F) { setMsg("页面脚本版本对不上，刷新一次即可。", "warn"); return; }
    renderKinds();
    var kinds = $("fb-kinds");
    if (kinds) kinds.addEventListener("click", onKindsClick);
    var send = $("btn-fb-send");
    if (send) send.addEventListener("click", onSubmit);
    var refresh = $("btn-fb-refresh");
    if (refresh) refresh.addEventListener("click", load);
    var list = $("fb-list");
    if (list) list.addEventListener("click", onListClick);
    load();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
