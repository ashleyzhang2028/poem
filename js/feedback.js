(function () {
  "use strict";

  var KINDS = [
    { key: "feature", label: "功能建议", hint: "希望增加的新功能或改进", placeholder: "例：希望能有夜间模式" },
    { key: "problem", label: "使用问题", hint: "用起来卡壳、不顺手的地方（不针对某一篇，那类问题用篇目页的小旗）", placeholder: "例：切换设备后同步一直转圈" },
    { key: "other", label: "其它", hint: "上面都不是", placeholder: "" }
  ];

  var LIMITS = { content: 2000, comment: 2000 };

  var SEEN_KEY = "poem_feedback_seen_v1";

  function backingStore() { try { return window.localStorage || null; } catch (e) { return null; } }

  // 同一种水位线做法（见 js/report.js）：只记「看到过多新的那一刻」。
  function seenAt() {
    var b = backingStore();
    if (!b) return 0;
    try { return Number(b.getItem(SEEN_KEY)) || 0; } catch (e) { return 0; }
  }

  function markSeen(ts) {
    var b = backingStore();
    if (!b) return;
    var next = Math.max(seenAt(), Number(ts) || Date.now());
    try { b.setItem(SEEN_KEY, String(next)); } catch (e) { }
  }

  // 「有进展」= 管理员回复过或标了状态（不再是 open）。首次调用没有水位线，
  // 直接把当前最新时刻当基线，不然一上线就把所有旧反馈当成新进展弹出来。
  function pendingUpdates(list) {
    var rows = list || [];
    var seen = seenAt();
    if (!seen) {
      var maxTs = 0;
      rows.forEach(function (t) { maxTs = Math.max(maxTs, Number(t.updatedAt) || 0); });
      markSeen(maxTs);
      return [];
    }
    return rows.filter(function (t) {
      return String(t.status || "open") !== "open" && (Number(t.updatedAt) || 0) > seen;
    });
  }

  var STATUS_LABEL = { open: "待处理", replied: "已回复", closed: "已解决" };

  var STATUS_DESC = {
    open: "已送达，等待管理员查看",
    replied: "管理员已回复，见下方",
    closed: "已标记为解决"
  };

  function labelOfKind(k) {
    for (var i = 0; i < KINDS.length; i++) if (KINDS[i].key === k) return KINDS[i].label;
    return "其它";
  }
  function kindOf(k) {
    for (var i = 0; i < KINDS.length; i++) if (KINDS[i].key === k) return KINDS[i];
    return KINDS[KINDS.length - 1];
  }
  function labelOfStatus(s) { return STATUS_LABEL[String(s || "open")] || STATUS_LABEL.open; }
  function descOfStatus(s) { return STATUS_DESC[String(s || "open")] || STATUS_DESC.open; }

  function accountApi() { return window.AccountApi || null; }

  function signedIn() {
    var Ent = window.Entitlement || null;
    if (!Ent || typeof Ent.cookieSession !== "function") return false;
    try { return !!Ent.cookieSession({ backing: window.localStorage }); } catch (e) { return false; }
  }

  function create(input) {
    var o = input || {};
    var A = accountApi();
    if (!A || typeof A.feedbackCreate !== "function") {
      return Promise.resolve({ ok: false, reason: "no-channel", message: "页面脚本版本对不上，刷新一次即可。" });
    }
    return Promise.resolve(A.feedbackCreate({ kind: kindOf(o.kind).key, content: o.content })).then(function (r) {
      if (r && r.ok) return { ok: true, thread: r.thread, note: r.note };
      var code = (r && r.code) || "E_OFFLINE";
      var message = (r && r.message) || "没发出去，稍后再试。";
      if (code === "E_NOT_CONFIGURED") message = "这台服务器还没配好（服务端未启用）。想提意见可以直接开一个 Issue。";
      return { ok: false, reason: "unavailable", code: code, message: message };
    })["catch"](function () {
      return { ok: false, reason: "unavailable", message: "没发出去，稍后再试。" };
    });
  }

  function mine() {
    var A = accountApi();
    if (!A || typeof A.feedbackMine !== "function") {
      return Promise.resolve({ ok: false, reason: "no-channel", threads: [] });
    }
    return Promise.resolve(A.feedbackMine()).then(function (r) {
      if (r && r.ok) return { ok: true, threads: r.threads || [], noIdentity: !!r.noIdentity };
      return { ok: false, reason: "unavailable", threads: [] };
    })["catch"](function () { return { ok: false, reason: "unavailable", threads: [] }; });
  }

  function addComment(tid, content) {
    var A = accountApi();
    if (!A || typeof A.feedbackComment !== "function") {
      return Promise.resolve({ ok: false, reason: "no-channel", message: "页面脚本版本对不上，刷新一次即可。" });
    }
    return Promise.resolve(A.feedbackComment({ tid: tid, content: content })).then(function (r) {
      if (r && r.ok) return { ok: true, comment: r.comment };
      var code = (r && r.code) || "E_OFFLINE";
      return { ok: false, code: code, message: (r && r.message) || "没发出去，稍后再试。" };
    })["catch"](function () { return { ok: false, message: "没发出去，稍后再试。" }; });
  }

  function remove(target) {
    var A = accountApi();
    if (!A || typeof A.feedbackDelete !== "function") {
      return Promise.resolve({ ok: false, reason: "no-channel", message: "页面脚本版本对不上，刷新一次即可。" });
    }
    return Promise.resolve(A.feedbackDelete(target || {})).then(function (r) {
      if (r && r.ok) return { ok: true, deleted: r.deleted };
      return { ok: false, code: (r && r.code) || "", message: (r && r.message) || "删除失败，请重试。" };
    })["catch"](function () { return { ok: false, message: "删除失败，请重试。" }; });
  }

  window.Feedback = {
    KINDS: KINDS,
    LIMITS: LIMITS,
    STATUS_LABEL: STATUS_LABEL,
    STATUS_DESC: STATUS_DESC,
    SEEN_KEY: SEEN_KEY,
    labelOfKind: labelOfKind,
    labelOfStatus: labelOfStatus,
    descOfStatus: descOfStatus,
    kindOf: kindOf,
    isSignedIn: signedIn,
    create: create,
    mine: mine,
    seenAt: seenAt,
    markSeen: markSeen,
    pendingUpdates: pendingUpdates,
    addComment: addComment,
    remove: remove
  };
})();
