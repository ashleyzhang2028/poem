(function () {
  "use strict";

  var KEY = "poem_reports_v1";
  var LOCAL_MAX = 50;

  var LIMITS = {
    quote: 200,
    context: 2000,
    note: 2000,
    suggestion: 2000
  };

  var KINDS = [
    { key: "text", label: "正文", hint: "正文有错字、漏字、缺段", seed: "正文" },
    { key: "translation", label: "译文", hint: "白话译文译错了或漏了", seed: "译文" },
    { key: "pinyin", label: "注音", hint: "拼音标错了（如「长」「行」这类多音字）", seed: "注音" },
    { key: "audio", label: "朗读", hint: "读出来的音不对、断句不对", seed: "朗读" },
    { key: "ui", label: "界面", hint: "排版、按钮、显示不对", seed: "界面" },
    { key: "other", label: "其它", hint: "上面都不是", seed: "" }
  ];

  var STATUS_LABEL = {
    new: "已收到",
    read: "已看过",
    accepted: "已确认",
    fixed: "已修复",
    rejected: "未采纳"
  };

  function labelOfStatus(s) {
    return STATUS_LABEL[String(s || "new")] || "已收到";
  }

  function labelOfKind(k) {
    for (var i = 0; i < KINDS.length; i++) if (KINDS[i].key === k) return KINDS[i].label;
    return "其它";
  }

  function kindOf(k) {
    for (var i = 0; i < KINDS.length; i++) if (KINDS[i].key === k) return KINDS[i];
    return KINDS[KINDS.length - 1];
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function clip(s, max) {
    var v = String(s == null ? "" : s);
    return v.length > max ? v.slice(0, max) : v;
  }

  function backing() {
    try { return window.localStorage || null; } catch (e) { return null; }
  }

  function readLocal() {
    var b = backing();
    if (!b) return [];
    try {
      var v = JSON.parse(b.getItem(KEY) || "null");
      if (!v || typeof v !== "object" || !Array.isArray(v.reports)) return [];
      return v.reports;
    } catch (e) { return []; }
  }

  function writeLocal(list) {
    var b = backing();
    if (!b) return list;
    try {
      b.setItem(KEY, JSON.stringify({ v: 1, reports: list.slice(0, LOCAL_MAX), updatedAt: Date.now() }));
    } catch (e) { }
    return list;
  }

  function recordLocal(row) {
    var list = readLocal();
    var hit = -1;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].rid === row.rid) hit = i;
    if (hit >= 0) list[hit] = row; else list.unshift(row);
    writeLocal(list);
    return list;
  }

  function mergeLocal(remote) {
    var list = readLocal();
    var byRid = {};
    list.forEach(function (r) { if (r && r.rid) byRid[r.rid] = r; });
    var rows = (remote || []);
    rows.forEach(function (r) { if (r && r.rid) byRid[r.rid] = r; });

    var out = Object.keys(byRid).map(function (k) { return byRid[k]; });
    out.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    return out.slice(0, LOCAL_MAX);
  }

  function signedIn() {
    var Ent = window.Entitlement || null;
    if (!Ent || typeof Ent.identity !== "function") return false;
    try {
      var id = Ent.identity({ backing: backing() });
      return !!(id && id.signedIn);
    } catch (e) { return false; }
  }

  function accountApi() { return window.AccountApi || null; }

  function now() { return Date.now(); }

  function create(input) {
    var o = input || {};
    var kind = kindOf(o.kind).key;

    var payload = {
      kind: kind,
      poemId: clip(o.poemId, 80),
      poemTitle: clip(o.poemTitle, 120),
      book: clip(o.book, 60),
      quote: clip(o.quote, LIMITS.quote),
      context: clip(o.context, LIMITS.context),
      note: clip(o.note, LIMITS.note).trim(),
      suggestion: clip(o.suggestion, LIMITS.suggestion).trim(),
      ua: clip(navigator && navigator.userAgent, 240),

      localOnly: false
    };

    if (!payload.note && !payload.quote && !payload.suggestion) {
      return Promise.resolve({ ok: false, reason: "empty", message: "请写一句「哪里不对」" });
    }

    if (!signedIn()) {
      return Promise.resolve({
        ok: false,
        reason: "guest",
        message: "报告要登录后才能发（这样才认得出是谁报的、修好之后能回你一句）。"
      });
    }

    var A = accountApi();
    if (!A || typeof A.report !== "function") {
      return Promise.resolve({ ok: false, reason: "no-channel", message: "页面脚本版本对不上，刷新一次即可。" });
    }

    return Promise.resolve(A.report(payload)).then(function (r) {
      if (r && r.ok) {
        var row = {
          rid: r.rid,
          kind: kind,
          status: "new",
          poemId: payload.poemId,
          poemTitle: payload.poemTitle,
          book: payload.book,
          quote: payload.quote,
          context: payload.context,
          note: payload.note,
          suggestion: payload.suggestion,
          createdAt: r.createdAt || now(),
          updatedAt: r.createdAt || now(),
          handledAt: 0,
          reply: "",
          localOnly: false
        };
        recordLocal(row);
        return { ok: true, rid: r.rid, remaining: r.remaining, report: row };
      }

      var code = (r && r.code) || "E_OFFLINE";
      var reason = "unavailable";
      var message = (r && r.message) || "连不上服务端，这一条没发出去。";
      if (code === "E_NO_SESSION") { reason = "guest"; }
      else if (code === "E_NOT_CONFIGURED") { reason = "not-configured"; message = "这台服务器还没配好（服务端未启用）。想提意见可以直接开一个 Issue。"; }
      else if (code === "E_RATE_DEVICE" || code === "E_RATE_REPORT") { reason = "rate"; }
      else if (code === "E_EMPTY" || code === "E_BAD_BODY") { reason = "empty"; }
      return { ok: false, reason: reason, code: code, message: message };
    })["catch"](function () {
      return { ok: false, reason: "unavailable", message: "连不上服务端，这一条没发出去。" };
    });
  }

  function mine(opt) {
    var A = accountApi();
    if (!A || typeof A.myReports !== "function" || !signedIn()) {
      return Promise.resolve({ ok: true, local: true, reports: readLocal() });
    }
    return Promise.resolve(A.myReports({ limit: (opt && opt.limit) || 50 }))
      .then(function (r) {
        if (r && r.ok && Array.isArray(r.reports)) {

          return { ok: true, local: false, reports: mergeLocal(r.reports), serverOnly: r.reports };
        }
        return { ok: true, local: true, reports: readLocal(), serverOnly: [] };
      })["catch"](function () {
        return { ok: true, local: true, reports: readLocal(), serverOnly: [] };
      });
  }

  function pendingLocal(remote) {
    var have = {};
    (remote || []).forEach(function (r) { if (r && r.rid) have[r.rid] = 1; });
    return readLocal().filter(function (r) { return r && r.rid && !have[r.rid]; });
  }

  function resend() {
    if (!signedIn()) {
      return Promise.resolve({ ok: false, reason: "guest", sent: 0, pending: readLocal().length,
        message: "还没登录 —— 先登录，再回到这一页点重发。" });
    }
    var A = accountApi();
    if (!A || typeof A.report !== "function") {
      return Promise.resolve({ ok: false, reason: "no-channel", sent: 0, pending: readLocal().length,
        message: "页面脚本版本对不上，刷新一次即可。" });
    }

    var list = readLocal();
    var sent = 0;
    var failed = 0;
    var chain = Promise.resolve();
    list.forEach(function (r) {
      if (!r || !r.rid) return;
      chain = chain.then(function () {
        return Promise.resolve(A.report({
          rid: r.rid,
          kind: r.kind,
          poemId: r.poemId,
          poemTitle: r.poemTitle,
          book: r.book,
          quote: r.quote,
          context: r.context,
          note: r.note,
          suggestion: r.suggestion,
          ua: r.ua || clip(navigator && navigator.userAgent, 240),
          localOnly: false
        })).then(function (res) {
          if (res && res.ok) sent++;
          else failed++;
        }, function () { failed++; });
      });
    });

    return chain.then(function () {
      return {
        ok: sent > 0,
        sent: sent,
        failed: failed,
        pending: readLocal().length,
        message: failed
          ? (sent ? ("发出去 " + sent + " 条，另有 " + failed + " 条还是没发出去。") : "一条都没发出去（可能断网了）。")
          : ""
      };
    });
  }

  function clearLocal() {
    var b = backing();
    if (!b) return true;
    try { b.removeItem(KEY); } catch (e) { }
    return true;
  }

  function flagGlyph() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M6 3.6v16.8" />' +
      '<path d="M6 4.6h11.4l-2.2 3.6 2.2 3.6H6Z" />' +
      "</svg>";
  }

  function detailBtn() {
    return '<button type="button" class="mini-btn report-btn" id="gw-report" data-gw="report" ' +
      'title="报告这一篇的错误">' +
      '<span class="btn-icon">' + flagGlyph() + "</span>" +
      '<span class="sr-only">报告错误</span>' +
      "</button>";
  }

  function itemBtn(p) {
    var title = (p && p.title) || "";
    return '<button type="button" class="item-report" data-report="' + esc((p && p.id) || "") + '" ' +
      'title="报告这一篇的错误" aria-label="报告错误：' + esc(title) + '">' +
      flagGlyph() + "</button>";
  }

  var box = null;
  var ctx = { poemId: "", poemTitle: "", book: "", quote: "", context: "" };
  var pickedKind = "other";
  var onDone = null;

  function ensureBox() {
    if (box) return box;

    box = document.createElement("div");
    box.className = "modal report-modal";
    box.id = "report-dialog";
    box.hidden = true;
    box.innerHTML =
      '<div class="modal-mask" data-close="1"></div>' +
      '<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="report-dialog-title">' +
      '<button class="modal-close" data-close="1" aria-label="关闭">✕</button>' +
      '<div class="modal-head"><h2 id="report-dialog-title">报告错误</h2></div>' +
      '<p class="report-sub" id="report-sub"></p>' +

      '<div class="report-kinds" id="report-kinds" role="group" aria-label="报哪一类问题"></div>' +

      '<div class="report-quote" id="report-quote-wrap" hidden>' +
      '<span class="report-quote-label">这一段</span>' +
      '<blockquote id="report-quote"></blockquote>' +
      "</div>" +

      '<div class="account-field">' +
      '<label class="account-label" for="report-note">哪里不对</label>' +
      '<textarea id="report-note" class="account-input report-textarea" rows="2" ' +
      'maxlength="' + LIMITS.note + '" placeholder="例：「长」这里该读 cháng，不是 zhǎng"></textarea>' +
      '<p class="account-hint" id="report-note-hint"></p>' +
      "</div>" +

      '<div class="account-field">' +
      '<label class="account-label" for="report-suggestion">应该是什么（可留空）</label>' +
      '<textarea id="report-suggestion" class="account-input report-textarea" rows="2" ' +
      'maxlength="' + LIMITS.suggestion + '" placeholder="例：应读 cháng，或写作「明月光」"></textarea>' +
      "</div>" +

      '<p class="account-msg" id="report-msg"></p>' +

      '<div class="actions report-actions">' +
      '<button type="button" class="btn" id="report-cancel">取消</button>' +
      '<button type="button" class="btn good primary-btn" id="report-send">发送</button>' +
      "</div>" +
      '<p class="report-foot" id="report-foot"></p>' +
      "</div>";

    document.body.appendChild(box);

    box.addEventListener("click", function (e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute("data-close")) { close(); return; }
      var k = t && t.closest ? t.closest("button[data-kind]") : null;
      if (k) { pickKind(k.getAttribute("data-kind")); return; }
    });

    var send = $("#report-send", box);
    if (send) send.addEventListener("click", function () { submit(); });
    var cancel = $("#report-cancel", box);
    if (cancel) cancel.addEventListener("click", function () { close(); });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && box && !box.hidden) close();
    });

    renderKinds();
    return box;
  }

  function renderKinds() {
    var host = $("#report-kinds", box);
    if (!host) return;
    host.innerHTML = KINDS.map(function (k) {
      var on = k.key === pickedKind;
      return '<button type="button" data-kind="' + k.key + '"' +
        (on ? ' class="active" aria-pressed="true"' : ' aria-pressed="false"') +
        ' title="' + esc(k.hint) + '">' + esc(k.label) + "</button>";
    }).join("");
  }

  function pickKind(key) {
    pickedKind = kindOf(key).key;
    renderKinds();

    var note = $("#report-note", box);
    var seed = kindOf(pickedKind).seed;
    if (note && seed && !note.dataset.touched) note.value = seed;
  }

  function open(o) {
    var opt = o || {};
    ensureBox();
    ctx = {
      poemId: clip(opt.poemId, 80),
      poemTitle: clip(opt.poemTitle, 120),
      book: clip(opt.book, 60),
      quote: clip(opt.quote, LIMITS.quote),
      context: clip(opt.context, LIMITS.context)
    };
    pickedKind = kindOf(opt.kind || "other").key;

    var sub = $("#report-sub", box);
    if (sub) {
      sub.textContent = ctx.poemTitle
        ? "《" + ctx.poemTitle + "》" + (ctx.book ? " · " + ctx.book : "")
        : "把看到的问题告诉管理员";
    }

    var qw = $("#report-quote-wrap", box);
    var q = $("#report-quote", box);
    if (qw && q) {
      if (ctx.quote) { q.textContent = ctx.quote; qw.hidden = false; } else { qw.hidden = true; }
    }

    var note = $("#report-note", box);
    if (note) {
      note.value = "";
      note.dataset.touched = "";
      var seed = kindOf(pickedKind).seed;
      if (seed && !opt.quote) note.value = seed;
    }
    var sug = $("#report-suggestion", box);
    if (sug) sug.value = "";

    msg("", "");
    renderKinds();
    box.hidden = false;

    var wide = false;
    try { wide = window.matchMedia && window.matchMedia("(min-width: 768px)").matches; } catch (e) { wide = false; }
    if (wide && note && note.focus) note.focus();
  }

  function close() {
    if (box) box.hidden = true;
  }

  function msg(text, level) {
    var el = box ? $("#report-msg", box) : null;
    if (!el) return;
    el.textContent = text || "";
    el.className = "account-msg" + (level ? " " + level : "");
  }

  function submit() {
    var note = $("#report-note", box);
    var sug = $("#report-suggestion", box);
    var btn = $("#report-send", box);
    var noteText = note ? note.value : "";
    var sugText = sug ? sug.value : "";

    if (!String(noteText).trim() && !ctx.quote && !String(sugText).trim()) {
      msg("请写一句「哪里不对」（哪怕两个字：如「注音」）", "warn");
      if (note && note.focus) note.focus();
      return;
    }

    if (btn) btn.disabled = true;
    msg("正在发送……", "");

    create({
      kind: pickedKind,
      poemId: ctx.poemId,
      poemTitle: ctx.poemTitle,
      book: ctx.book,
      quote: ctx.quote,
      context: ctx.context,
      note: noteText,
      suggestion: sugText
    }).then(function (r) {
      if (btn) btn.disabled = false;
      if (r && r.ok) {
        close();
        toast("收到了，管理员会看到这一条");
        if (typeof onDone === "function") onDone(r);
        try {
          window.dispatchEvent(new CustomEvent("report-created", { detail: r }));
        } catch (e) { }
        return;
      }
      var reason = r && r.reason;
      if (reason === "guest") {
        msg("报告要登录后才能发。点「去登录」—— 登录后回来再点一次「发送」，写好的内容还在。", "warn");
        showLoginHint();
        return;
      }
      msg((r && r.message) || "没发出去，稍后再试。", "warn");
    })["catch"](function () {
      if (btn) btn.disabled = false;
      msg("没发出去，稍后再试。", "warn");
    });
  }

  function showLoginHint() {
    var foot = box ? $("#report-foot", box) : null;
    if (!foot) return;
    foot.innerHTML = '<a class="report-login-link" href="/login/">去登录</a>';
  }

  function toast(text) {
    var el = document.getElementById("toast");
    if (!el) {
      try { window.alert(text); } catch (e) { }
      return;
    }
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 2400);
  }

  var bubble = null;

  function ensureBubble() {
    if (bubble) return bubble;
    bubble = document.createElement("button");
    bubble.type = "button";
    bubble.className = "report-bubble";
    bubble.hidden = true;
    bubble.innerHTML = flagGlyph() + "<span>报这一段</span>";
    bubble.addEventListener("mousedown", function (e) { e.preventDefault(); });
    bubble.addEventListener("touchstart", function (e) { e.preventDefault(); }, { passive: false });
    bubble.addEventListener("click", function (e) {
      e.stopPropagation();
      var pick = bubble._pick || null;
      bubble.hidden = true;
      if (!pick) return;
      open(pick);
    });
    document.body.appendChild(bubble);
    return bubble;
  }

  function hideBubble() {
    if (bubble) bubble.hidden = true;
  }

  function selectionIn(host) {
    if (!host) return "";
    var sel = null;
    try { sel = window.getSelection ? window.getSelection() : null; } catch (e) { sel = null; }
    if (!sel || sel.isCollapsed) return "";
    var text = String(sel.toString() || "").trim();
    if (text.length < 2) return "";

    try {
      if (sel.rangeCount && host.contains && !host.contains(sel.getRangeAt(0).commonAncestorContainer)) return "";
    } catch (e) { }
    return text;
  }

  function sentenceAround(full, pick) {
    var src = String(full || "");
    var at = src.indexOf(pick);
    if (at < 0) return src.slice(0, 200);
    var stop = /[。！？；\n]/;
    var start = at;
    while (start > 0 && !stop.test(src.charAt(start - 1))) start -= 1;
    var end = at + pick.length;
    while (end < src.length && !stop.test(src.charAt(end))) end += 1;
    if (end < src.length) end += 1;
    return clip(src.slice(start, end).trim(), 200);
  }

  function bindSelection(host, getCtx) {
    if (!host) return function () { };
    var timer = null;

    function refresh() {
      var pick = selectionIn(host);
      if (!pick) { hideBubble(); return; }
      var full = String(host.textContent || "");
      var base = (typeof getCtx === "function" ? getCtx() : null) || {};
      var b = ensureBubble();
      b._pick = {
        kind: "other",
        poemId: base.poemId || "",
        poemTitle: base.poemTitle || "",
        book: base.book || "",
        quote: clip(pick, LIMITS.quote),
        context: sentenceAround(full, pick)
      };
      b.hidden = false;
    }

    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(refresh, 180);
    }

    document.addEventListener("selectionchange", schedule);
    host.addEventListener("mouseup", schedule);
    host.addEventListener("touchend", schedule);
    document.addEventListener("mousedown", function (e) {
      if (e.target === bubble || (bubble && bubble.contains(e.target))) return;
      hideBubble();
    });

    return function unbind() {
      document.removeEventListener("selectionchange", schedule);
      host.removeEventListener("mouseup", schedule);
      host.removeEventListener("touchend", schedule);
      hideBubble();
    };
  }

  function renderList(host, reports, opt) {
    if (!host) return;
    var list = reports || [];
    var o = opt || {};

    var head = o.local
      ? '<p class="account-hint">本机的（服务端暂时读不到）。</p>'
      : "";
    if (!list.length) {
      host.innerHTML = head + '<p class="account-hint">还没有报过。<br>看到错字、标错的注音、翻错的译文，' +
        '点篇目上方那颗<strong>小旗</strong>就能报。</p>';
      return;
    }
    host.innerHTML = head + '<ul class="report-list">' + list.map(function (r) {
      var st = String(r.status || "new");
      return '<li class="report-row report-st-' + esc(st) + '">' +
        '<div class="report-row-head">' +
        '<span class="report-kind">' + esc(labelOfKind(r.kind)) + "</span>" +
        '<span class="report-title">' + esc(r.poemTitle || "（未指定篇目）") + "</span>" +
        '<span class="report-status">' + esc(labelOfStatus(st)) + "</span>" +
        "</div>" +
        (r.quote ? '<div class="report-row-quote">「' + esc(r.quote) + "」</div>" : "") +
        (r.note ? '<div class="report-row-note">' + esc(r.note) + "</div>" : "") +
        (r.reply ? '<div class="report-row-reply">管理员：' + esc(r.reply) + "</div>" : "") +
        '<div class="report-row-time">' + esc(timeText(r.createdAt)) + "</div>" +
        "</li>";
    }).join("") + "</ul>";
  }

  function timeText(ts) {
    var t = Number(ts) || 0;
    if (!t) return "";
    try {
      var d = new Date(t);
      var p = function (n) { return n < 10 ? "0" + n : "" + n; };
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
        " " + p(d.getHours()) + ":" + p(d.getMinutes());
    } catch (e) { return ""; }
  }

  window.Report = {
    KINDS: KINDS,
    LIMITS: LIMITS,
    STATUS_LABEL: STATUS_LABEL,
    KEY: KEY,
    labelOfKind: labelOfKind,
    labelOfStatus: labelOfStatus,
    flagGlyph: flagGlyph,
    detailBtn: detailBtn,
    itemBtn: itemBtn,
    open: open,
    close: close,
    create: create,
    mine: mine,
    readLocal: readLocal,
    writeLocal: writeLocal,
    pendingLocal: pendingLocal,
    resend: resend,
    mergeLocal: mergeLocal,
    clearLocal: clearLocal,
    renderList: renderList,
    sentenceAround: sentenceAround,
    bindSelection: bindSelection,
    hideBubble: hideBubble,
    isSignedIn: signedIn,
    onDone: function (fn) { onDone = fn; }
  };
})();
