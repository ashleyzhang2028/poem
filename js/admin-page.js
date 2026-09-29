(function () {
  "use strict";

  var Ent = window.Entitlement;

  function acct() { return window.AccountApi || null; }

  var backing = null;
  try { backing = window.localStorage; } catch (e) { backing = null; }

  var currentAccounts = [];

  var myId = null;

  var ROLE_LABEL = { owner: "所有者", admin: "管理员", user: "普通用户" };

  var STALE = "页面已更新，请刷新后重试。";
  var OFFLINE = "无法连接服务器，请稍后再试。";
  var EXPIRED = "登录已过期，请重新登录。";
  var NO_CLOUD = "服务端尚未开启云端账号。";

  function $(id) { return document.getElementById(id); }
  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function showToast(m) {
    var t = $("toast");
    if (!t) return;
    t.textContent = m;
    t.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { t.hidden = true; }, 2200);
  }
  function msg(id, s, level) {
    var el = $(id);
    if (!el) return;
    el.textContent = s == null ? "" : String(s);
    el.className = "account-msg" + (level ? " " + level : "");
  }

  function roleText(role) {
    var r = String(role || "user").toLowerCase();
    return ROLE_LABEL[r] || r;
  }

    function isOwner(id) {
    if (!id) return Ent.isOwner(backing);
    return Ent.isOwner(backing, { role: id.role, uid: id.uid });
  }

  function fix() { return window.PinyinFix || null; }
  function pinyin() { return window.Pinyin || null; }

  // ---- 注音勘误：找篇目 → 点字 → 点读音 ----

  var catalog = null;
  var booksReady = false;
  var pfResults = [];
  var pfWork = null;
  var pfPick = null;
  var pfTarget = -1;

  function lineMax() { var F = fix(); return (F && F.LINE_MAX) || 120; }
  function lineKey(line) { return String(line == null ? "" : line).trim().slice(0, lineMax()); }

  function widOfPoem(p) {
    var id = (p && p.id) || "";
    if (!id) return "";
    if (window.WorksIndex && typeof window.WorksIndex.widOf === "function") {
      try { return window.WorksIndex.widOf(id) || id; } catch (e) {  }
    }
    return id;
  }

  function bookDefs() {
    var defs = window.SITE_BOOKS_DEF || [];
    return defs.length ? defs : [{ id: "poems", name: "课内诗词", varName: "POEMS_ALL" }];
  }

  function buildCatalog() {
    var out = [];
    var seen = {};
    bookDefs().forEach(function (b) {
      (window[b.varName] || []).forEach(function (raw) {
        var p = raw;
        if (typeof window.masterTextOf === "function") {
          try { p = window.masterTextOf(raw, b.id) || raw; } catch (e) { p = raw; }
        }
        if (!p || !p.id || !p.text) return;
        var k = b.id + "\u0000" + p.id;
        if (seen[k]) return;
        seen[k] = 1;
        out.push({
          id: String(p.id),
          wid: widOfPoem(p),
          title: String(p.title || p.id),
          author: String(p.author || p.authorName || ""),
          text: String(p.text),
          bookName: String(b.name || "")
        });
      });
    });
    return out;
  }

  function allPoems() {
    if (!catalog) catalog = buildCatalog();
    return catalog;
  }

  // Only 课内 ships with the page; the other books load in the background.
  function loadBooks() {
    if (loadBooks.p) return loadBooks.p;
    var want = bookDefs().filter(function (b) { return b.id !== "poems" && !window[b.varName]; });
    loadBooks.p = Promise.all(want.map(function (b) {
      return new Promise(function (done) {
        var s = document.createElement("script");
        s.src = "/data/poems-" + b.id + ".js";
        s.onload = s.onerror = function () { done(); };
        document.head.appendChild(s);
      });
    })).then(function () {
      catalog = null;
      booksReady = true;
    });
    return loadBooks.p;
  }

  function searchPoems(kw) {
    var q = String(kw || "").trim();
    if (!q) return [];
    var scored = [];
    allPoems().forEach(function (p) {
      var s = -1;
      if (p.title === q) s = 0;
      else if (p.title.indexOf(q) === 0) s = 1;
      else if (p.title.indexOf(q) >= 0) s = 2;
      else if (p.author.indexOf(q) >= 0) s = 3;
      else if (p.text.indexOf(q) >= 0) s = 4;
      if (s >= 0) scored.push({ s: s, p: p });
    });
    scored.sort(function (a, b) { return a.s - b.s; });
    return scored.slice(0, 20).map(function (x) { return x.p; });
  }

  function onPinyinSearch() {
    var q = (($("pf-q") || {}).value || "").trim();
    var box = $("pf-results");
    var hint = $("pf-search-hint");
    if (!box || !hint) return;
    pfResults = searchPoems(q);
    if (!q) {
      box.hidden = true;
      box.innerHTML = "";
      hint.hidden = true;
      return;
    }
    if (!pfResults.length) {
      box.hidden = true;
      box.innerHTML = "";
      hint.hidden = false;
      hint.textContent = booksReady
        ? "没有找到「" + q + "」。试试只输入篇名里的两三个字。"
        : "课内诗词里没有找到「" + q + "」，其余集子还在载入，稍等片刻会自动再找一次。";
      return;
    }
    hint.hidden = booksReady;
    hint.textContent = booksReady ? "" : "其余集子还在载入，结果可能不全。";
    box.hidden = false;
    box.innerHTML = pfResults.map(function (p, k) {
      var meta = [p.author, p.bookName].filter(Boolean).join(" · ");
      return '<li><button type="button" class="pf-result" data-pf-open="' + k + '">' +
        '<span class="pf-result-title">《' + esc(p.title) + "》</span>" +
        (meta ? '<span class="pf-result-meta">' + esc(meta) + "</span>" : "") +
        "</button></li>";
    }).join("");
  }

  function onResultClick(e) {
    var b = e.target.closest ? e.target.closest("button[data-pf-open]") : null;
    if (!b) return;
    var p = pfResults[Number(b.getAttribute("data-pf-open"))];
    if (p) openWork(p, "");
  }

  function nthOf(chars, i) {
    var n = 0;
    for (var k = 0; k <= i; k++) if (chars[k] === chars[i]) n++;
    return n;
  }

  function indexOfNth(chars, ch, n) {
    var seen = 0;
    for (var k = 0; k < chars.length; k++) {
      if (chars[k] !== ch) continue;
      seen++;
      if (seen === n) return k;
    }
    return -1;
  }

  function around(chars, idx, r) {
    var a = Math.max(0, idx - r);
    var b = Math.min(chars.length, idx + r + 1);
    return {
      before: (a > 0 ? "…" : "") + chars.slice(a, idx).join(""),
      ch: chars[idx],
      after: chars.slice(idx + 1, b).join("") + (b < chars.length ? "…" : "")
    };
  }

  function findFix(wid, key, n, ch) {
    var F = fix();
    if (!F) return null;
    var hit = null;
    F.list().forEach(function (f) {
      if (f.wid === wid && f.line === key && f.at === n && (!f.ch || f.ch === ch)) hit = f;
    });
    return hit;
  }

  function readLine(wid, line) {
    var P = pinyin();
    var chars = Array.from(line);
    var auto = [];
    var cur = [];
    P.begin("", "");
    chars.forEach(function (ch, i) { auto[i] = P.isHan(ch) ? P.readOf(ch, chars, i) : ""; });
    P.begin(wid, line);
    chars.forEach(function (ch, i) { cur[i] = P.isHan(ch) ? P.readOf(ch, chars, i) : ""; });
    P.end();
    return { chars: chars, auto: auto, cur: cur };
  }

  function workLines() {
    return pfWork ? pfWork.text.split("\n") : [];
  }

  function openWork(p, quote) {
    pfWork = p;
    pfPick = null;
    pfTarget = -1;
    var q = String(quote || "").replace(/\s+/g, "");
    if (q) {
      workLines().some(function (line, li) {
        if (line.replace(/\s+/g, "").indexOf(q) < 0) return false;
        pfTarget = li;
        return true;
      });
    }
    var input = $("pf-q");
    if (input) input.value = "";
    onPinyinSearch();
    var title = $("pf-work-title");
    if (title) {
      var meta = [p.author, p.bookName].filter(Boolean).join(" · ");
      title.innerHTML = "《" + esc(p.title) + "》" + (meta ? '<span class="pf-result-meta">' + esc(meta) + "</span>" : "");
    }
    show($("pf-work"));
    msg("msg-pf", "", "");
    renderLines();
    var focus = pfTarget >= 0 ? document.querySelector('#pf-lines [data-line="' + pfTarget + '"]') : $("pf-work");
    if (focus && focus.scrollIntoView) focus.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function closeWork() {
    pfWork = null;
    pfPick = null;
    hide($("pf-work"));
    var input = $("pf-q");
    if (input && input.focus) input.focus();
  }

  function renderLines() {
    var host = $("pf-lines");
    var P = pinyin();
    if (!host || !pfWork || !P) return;
    var wid = pfWork.wid;
    var html = [];
    workLines().forEach(function (line, li) {
      if (!line.trim()) return;
      var r = readLine(wid, line);
      var key = lineKey(line);
      var cells = [];
      r.chars.forEach(function (ch, i) {
        if (!P.isHan(ch)) {
          var punc = '<span class="pf-punc">' + esc(ch) + "</span>";
          // Keep punctuation glued to the previous character so it never starts a wrapped line.
          if (cells.length) cells[cells.length - 1] = '<span class="pf-nb">' + cells[cells.length - 1] + punc + "</span>";
          else cells.push(punc);
          return;
        }
        var ruby = "<ruby>" + esc(ch) + "<rt>" + esc(r.cur[i]) + "</rt></ruby>";
        if (!P.isPolyphone(ch)) { cells.push('<span class="pf-ch">' + ruby + "</span>"); return; }
        var fixed = !!findFix(wid, key, nthOf(r.chars, i), ch);
        var on = !!pfPick && pfPick.li === li && pfPick.i === i;
        cells.push('<button type="button" class="pf-ch is-poly' + (fixed ? " is-fixed" : "") + (on ? " is-active" : "") + '"' +
          ' data-li="' + li + '" data-i="' + i + '" aria-pressed="' + (on ? "true" : "false") + '"' +
          ' aria-label="' + esc(ch + " 现在读 " + r.cur[i] + (fixed ? "，已改过" : "")) + '">' + ruby + "</button>");
      });
      cells = cells.join("");
      html.push('<div class="pf-line' + (li === pfTarget ? " is-target" : "") + '" data-line="' + li + '">' + cells + "</div>");
      if (pfPick && pfPick.li === li) html.push(panelHtml(wid, key, r));
    });
    host.innerHTML = html.join("");
  }

  function panelHtml(wid, key, r) {
    var P = pinyin();
    var i = pfPick.i;
    var ch = r.chars[i];
    var cur = r.cur[i];
    var auto = r.auto[i];
    var opts = P.readings ? P.readings(ch) : [];
    if (cur && opts.indexOf(cur) < 0) opts.push(cur);
    var fixed = !!findFix(wid, key, nthOf(r.chars, i), ch);
    var pending = pendingQueueEntry(wid, key, nthOf(r.chars, i));
    var head = pending
      ? (pending.status === "approved"
          ? '<p class="pf-panel-head pf-panel-live"><span class="pf-no">3</span>「<b>' + esc(ch) + "</b>」" +
            "已对<strong>所有人</strong>生效，读 <b>" + esc(pending.py) + "</b>。</p>"
          : '<p class="pf-panel-head pf-panel-pending"><span class="pf-no">3</span>「<b>' + esc(ch) + "</b>」" +
            "已提交，读 <b>" + esc(pending.py) + "</b>，正等待审核批准（还没对所有人生效）。</p>")
      : '<p class="pf-panel-head"><span class="pf-no">3</span>「<b>' + esc(ch) + "</b>」在这里应该读：</p>";
    return '<div class="pf-panel" role="group" aria-label="' + esc("「" + ch + "」的正确读音") + '">' +
      head +
      '<div class="pf-readings">' + opts.map(function (o) {
        return '<button type="button" data-pf-py="' + esc(o) + '"' + (o === cur ? ' class="active" aria-pressed="true"' : ' aria-pressed="false"') + ">" +
          esc(o) + (o === auto ? "<small>自动</small>" : "") + "</button>";
      }).join("") + "</div>" +
      '<div class="pf-custom">' +
      '<input id="pf-custom" class="account-input" type="text" maxlength="12" autocomplete="off" spellcheck="false"' +
      ' placeholder="列表里没有？输入带声调的读音" aria-label="其他读音" />' +
      '<button type="button" class="account-btn ghost" data-pf-custom="1">使用</button>' +
      "</div>" +
      (fixed && !(pending && pending.status === "pending" && pending.py === cur)
        ? '<button type="button" class="account-btn" data-pf-submit="1">提交给所有人（需审核批准）</button>'
        : "") +
      '<div class="pf-panel-foot">' +
      (fixed ? '<button type="button" class="pf-link" data-pf-reset="1">恢复自动注音（' + esc(auto) + "）</button>" : "") +
      '<button type="button" class="pf-link" data-pf-close="1">收起</button>' +
      "</div></div>";
  }

  function pendingQueueEntry(wid, line, at) {
    var hit = null;
    pfQueue.forEach(function (p) {
      if (p.wid === wid && p.line === line && p.at === at && (p.status === "pending" || p.status === "approved")) hit = p;
    });
    return hit;
  }

  var PY_RE = /^[a-zāáǎàēéěèīíǐìōóǒòūúǔùüǖǘǚǜńňǹḿ]{1,12}$/;

  function applyReading(val) {
    var F = fix();
    if (!F || !pfWork || !pfPick) { msg("msg-pf", STALE, "warn"); return; }
    var line = workLines()[pfPick.li] || "";
    var r = readLine(pfWork.wid, line);
    var i = pfPick.i;
    var ch = r.chars[i];
    var key = lineKey(line);
    var n = nthOf(r.chars, i);
    var old = findFix(pfWork.wid, key, n, ch);
    var s = around(r.chars, i, 6);
    var where = "《" + pfWork.title + "》「" + s.before + ch + s.after + "」";

    if (val === r.auto[i]) {
      if (old) F.remove(F.keyOf(old));
      msg("msg-pf", "已恢复自动注音：" + where + "中的「" + ch + "」读 " + val + "。", "ok");
      pfPick = null;
    } else {
      var res = F.add({ wid: pfWork.wid, line: key, at: n, ch: ch, py: val });
      if (!res.ok) {
        msg("msg-pf", res.reason === "full" ? ("已达上限 " + F.MAX + " 条，请先删掉一些旧的。") : "没有保存成功，请重试。", "warn");
        return;
      }
      msg("msg-pf", "已改好（只在这台设备上）：" + where + "中的「" + ch + "」读 " + val + "。核对没问题的话，点下面「提交给所有人」。", "ok");
      // Keep the panel open so the admin can immediately submit this exact reading for review.
    }
    renderLines();
    renderFixList();
  }

  function submitProposal() {
    if (!pfWork || !pfPick) return;
    var A = acct();
    if (!A || typeof A.adminPinyinPropose !== "function") { msg("msg-pf", STALE, "warn"); return; }
    var line = workLines()[pfPick.li] || "";
    var r = readLine(pfWork.wid, line);
    var i = pfPick.i;
    var ch = r.chars[i];
    var key = lineKey(line);
    var n = nthOf(r.chars, i);
    var py = r.cur[i];
    var s = around(r.chars, i, 6);
    var where = "《" + pfWork.title + "》「" + s.before + ch + s.after + "」";

    msg("msg-pf", "正在提交……", "");
    Promise.resolve(A.adminPinyinPropose({
      wid: pfWork.wid, line: key, at: n, ch: ch, py: py,
      poemTitle: pfWork.title, book: pfWork.bookName || pfWork.source || ""
    })).then(function (res) {
      if (res && res.ok) {
        msg("msg-pf", "已提交：" + where + "中的「" + ch + "」读 " + py + "，等待管理员审核批准。", "ok");
        loadPinyinQueue().then(renderLines);
        return;
      }
      if (res && res.reason === "guest") { msg("msg-pf", EXPIRED, "warn"); return; }
      if (res && res.reason === "not-configured") { msg("msg-pf", NO_CLOUD, "warn"); return; }
      msg("msg-pf", (res && res.message) || "提交失败，请稍后再试。", "warn");
    })["catch"](function () { msg("msg-pf", OFFLINE, "warn"); });
  }

  function onLinesClick(e) {
    var t = e.target;
    if (!t.closest) return;
    var chBtn = t.closest("button[data-li]");
    if (chBtn) {
      var li = Number(chBtn.getAttribute("data-li"));
      var i = Number(chBtn.getAttribute("data-i"));
      pfPick = (pfPick && pfPick.li === li && pfPick.i === i) ? null : { li: li, i: i };
      renderLines();
      var first = document.querySelector("#pf-lines .pf-readings button");
      if (pfPick && first && first.focus) first.focus();
      return;
    }
    var pyBtn = t.closest("button[data-pf-py]");
    if (pyBtn) { applyReading(pyBtn.getAttribute("data-pf-py")); return; }
    if (t.closest("button[data-pf-custom]")) { applyCustom(); return; }
    if (t.closest("button[data-pf-submit]")) { submitProposal(); return; }
    if (t.closest("button[data-pf-reset]")) {
      var line = workLines()[pfPick.li] || "";
      applyReading(readLine(pfWork.wid, line).auto[pfPick.i]);
      return;
    }
    if (t.closest("button[data-pf-close]")) {
      pfPick = null;
      renderLines();
    }
  }

  function applyCustom() {
    var input = $("pf-custom");
    var v = ((input && input.value) || "").trim().toLowerCase().replace(/v/g, "ü");
    if (!PY_RE.test(v)) {
      msg("msg-pf", "读音要写成带声调的拼音，如 cháng、xíng。", "warn");
      if (input && input.focus) input.focus();
      return;
    }
    applyReading(v);
  }

  function onLinesKey(e) {
    if (e.key === "Enter" && e.target && e.target.id === "pf-custom") {
      e.preventDefault();
      applyCustom();
    }
  }

  function entryByWid(wid) {
    var hit = null;
    allPoems().some(function (p) {
      if (p.wid !== wid) return false;
      hit = p;
      return true;
    });
    return hit;
  }

  function hasLine(text, key) {
    return String(text).split("\n").some(function (l) { return lineKey(l) === key; });
  }

  // Entries saved by the old form stored a character position in `at`; the engine reads it as an occurrence count.
  function migrateLegacy() {
    var F = fix();
    if (!F) return;
    var stale = [];
    var next = [];
    F.list().forEach(function (f) {
      if (!f.ch || f.at < 2) return;
      var chars = Array.from(f.line);
      var total = chars.filter(function (c) { return c === f.ch; }).length;
      if (f.at <= total || chars[f.at - 1] !== f.ch) return;
      stale.push(F.keyOf(f));
      next.push({ wid: f.wid, line: f.line, at: nthOf(chars, f.at - 1), ch: f.ch, py: f.py });
    });
    if (!stale.length) return;
    F.removeMany(stale);
    next.forEach(function (f) { F.add(f); });
  }

  function renderFixList() {
    var box = $("pf-list");
    var F = fix();
    var P = pinyin();
    if (!box || !F) return;
    var list = F.list();
    var empty = $("pf-empty");
    if (empty) empty.hidden = list.length > 0;
    var count = $("pf-count");
    if (count) count.textContent = String(list.length);
    box.innerHTML = list.map(function (f, k) {
      var entry = entryByWid(f.wid);
      var title = entry
        ? "《" + entry.title + "》" + (entry.bookName ? " · " + entry.bookName : "")
        : f.wid;
      var chars = Array.from(f.line);
      var idx = f.ch ? indexOfNth(chars, f.ch, f.at) : -1;
      var s = idx >= 0 ? around(chars, idx, 12) : null;
      var lineHtml = s
        ? esc(s.before) + "<mark>" + esc(s.ch) + "</mark>" + esc(s.after)
        : esc(f.line);
      var warn = "";
      if (f.ch && P && !P.isPolyphone(f.ch)) warn = "「" + f.ch + "」只有一个读音，这一条不起作用，可以删掉。";
      else if (f.ch && idx < 0) warn = "这一句里找不到这个字，这一条不起作用，可以删掉。";
      else if (entry && !hasLine(entry.text, f.line)) warn = "原文已改动，找不到这一句了，可以删掉。";
      return '<li class="pf-fix">' +
        '<div class="pf-fix-main">' +
        '<div class="pf-fix-title">' + esc(title) + "</div>" +
        '<div class="pf-fix-line">' + lineHtml + "</div>" +
        '<div class="pf-fix-py">「' + esc(f.ch || "?") + "」读 <b>" + esc(f.py) + "</b></div>" +
        (warn ? '<div class="pf-fix-warn">' + esc(warn) + "</div>" : "") +
        "</div>" +
        '<div class="pf-fix-acts">' +
        (entry ? '<button type="button" class="pf-link" data-pf-view="' + k + '">查看</button>' : "") +
        '<button type="button" class="pf-link danger" data-unfix="' + k + '">删除</button>' +
        "</div></li>";
    }).join("");
  }

  function onFixListClick(e) {
    var F = fix();
    if (!F || !e.target.closest) return;
    var list = F.list();
    var view = e.target.closest("button[data-pf-view]");
    if (view) {
      var f = list[Number(view.getAttribute("data-pf-view"))];
      var entry = f ? entryByWid(f.wid) : null;
      if (!entry) return;
      openWork(entry, f.line);
      var i = pfTarget >= 0 && f.ch ? indexOfNth(Array.from(workLines()[pfTarget]), f.ch, f.at) : -1;
      if (i >= 0) {
        pfPick = { li: pfTarget, i: i };
        renderLines();
      }
      return;
    }
    var del = e.target.closest("button[data-unfix]");
    if (!del) return;
    var g = list[Number(del.getAttribute("data-unfix"))];
    var r = g ? F.remove(F.keyOf(g)) : { ok: false };
    msg("msg-pf", r.ok ? "已删除，「" + g.ch + "」恢复为自动注音。" : "这一条已经不在了。", r.ok ? "ok" : "warn");
    renderFixList();
    if (pfWork) renderLines();
  }

  function openFromReport(r) {
    var hit = null;
    allPoems().forEach(function (p) {
      if (p.id !== r.poemId) return;
      if (!hit || p.title === r.poemTitle) hit = p;
    });
    if (!hit && !booksReady) {
      msg("msg-pf", "正在载入集子……", "");
      loadBooks().then(function () { openFromReport(r); });
      return;
    }
    var card = $("pinyin-card");
    if (card && card.scrollIntoView) card.scrollIntoView({ block: "start", behavior: "smooth" });
    if (!hit) {
      msg("msg-pf", "找不到《" + (r.poemTitle || r.poemId) + "》，请在上面的搜索框里手动找一下。", "warn");
      return;
    }
    openWork(hit, r.quote || "");
  }

  // ---- 全站生效审核：待审核队列（任何管理员都能提，批准/驳回也走这一闸）----

  var pfQueue = [];
  var pfQueueStatus = "pending";
  var pfQueueCounts = {};
  var PF_QUEUE_STATUSES = ["pending", "approved", "rejected"];

  function pfQueueMsg(text, level) { msg("msg-pf-queue", text, level); }

  function loadPinyinQueue() {
    var A = acct();
    var box = $("pf-queue-list");
    if (!box) return;
    if (!A || typeof A.adminPinyinList !== "function") { pfQueueMsg(STALE, "warn"); return Promise.resolve(); }

    return Promise.resolve(A.adminPinyinList({ status: "all", limit: 300 })).then(function (r) {
      if (r && r.ok) {
        pfQueue = r.proposals || [];
        pfQueueCounts = r.counts || {};
        renderPinyinQueueCounts(pfQueueCounts);
        renderPinyinQueue();
        pfQueueMsg("", "");
        return;
      }
      if (r && r.reason === "guest") { pfQueueMsg(EXPIRED, "warn"); return; }
      if (r && r.reason === "not-configured") { pfQueueMsg(NO_CLOUD, "warn"); return; }
      if (r && r.code === "E_FORBIDDEN") { pfQueueMsg("仅管理员可查看。", "warn"); return; }
      pfQueueMsg(OFFLINE, "warn");
    })["catch"](function () { pfQueueMsg(OFFLINE, "warn"); });
  }

  function pfStatusLabel(s) {
    return { pending: "待审核", approved: "已生效", rejected: "已驳回", superseded: "已替换", all: "全部" }[s] || s;
  }

  function renderPinyinQueueCounts(counts) {
    var host = $("pf-queue-counts");
    if (!host) return;
    var total = 0;
    PF_QUEUE_STATUSES.forEach(function (k) { total += Number(counts && counts[k]) || 0; });
    host.innerHTML = PF_QUEUE_STATUSES.concat(["all"]).map(function (k) {
      var n = k === "all" ? total : (Number(counts && counts[k]) || 0);
      return '<button type="button" class="' + (k === pfQueueStatus ? "active" : "") + '"' +
        ' data-pf-queue-status="' + k + '" aria-pressed="' + (k === pfQueueStatus ? "true" : "false") + '">' +
        esc(pfStatusLabel(k)) + "<span>" + n + "</span></button>";
    }).join("");
  }

  function renderPinyinQueue() {
    var box = $("pf-queue-list");
    var empty = $("pf-queue-empty");
    if (!box) return;
    var list = pfQueue.filter(function (p) {
      return pfQueueStatus === "all" ? true : p.status === pfQueueStatus;
    });
    if (empty) {
      empty.hidden = list.length > 0;
      empty.textContent = pfQueueStatus === "pending" ? "没有待审核的提议。" : "没有「" + pfStatusLabel(pfQueueStatus) + "」的记录。";
    }
    box.innerHTML = list.map(function (p) {
      var title = p.poemTitle ? "《" + p.poemTitle + "》" : "（未知篇目）";
      var line = p.line.length > 30 ? p.line.slice(0, 30) + "…" : p.line;
      var change = p.prevPy ? (esc(p.prevPy) + " → <b>" + esc(p.py) + "</b>") : ("→ <b>" + esc(p.py) + "</b>");
      var who = [p.proposedByName, timeText(p.updatedAt)].filter(Boolean).join(" · ");
      var acts = "";
      if (p.status === "pending") {
        acts = '<button type="button" data-pf-decision="approve" data-fid="' + esc(p.fid) + '">批准生效</button>' +
          '<button type="button" data-pf-decision="reject" data-fid="' + esc(p.fid) + '">驳回</button>';
      } else if (p.status === "approved") {
        acts = '<button type="button" data-pf-decision="reject" data-fid="' + esc(p.fid) + '">下线</button>';
      }
      return '<li class="report-row pf-queue-row report-st-' + esc(p.status) + '" data-fid="' + esc(p.fid) + '">' +
        '<div class="report-row-head">' +
        '<span class="report-title">' + esc(title) + "</span>" +
        '<span class="report-status">' + esc(pfStatusLabel(p.status)) + "</span>" +
        "</div>" +
        '<div class="report-row-quote">' + esc(line) + "</div>" +
        '<div class="report-row-note">「' + esc(p.ch) + "」 " + change + "</div>" +
        (p.note ? '<div class="report-row-reply">' + esc(p.note) + "</div>" : "") +
        '<div class="admin-report-who">' + esc(who) + "</div>" +
        (acts ? '<div class="admin-report-acts">' + acts + "</div>" : "") +
        "</li>";
    }).join("");
  }

  function timeText(ts) {
    var t = Number(ts) || 0;
    if (!t) return "";
    var d = new Date(t);
    var p = function (n) { return n < 10 ? "0" + n : "" + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function onPinyinQueueCountsClick(e) {
    var b = e.target.closest ? e.target.closest("button[data-pf-queue-status]") : null;
    if (!b) return;
    pfQueueStatus = b.getAttribute("data-pf-queue-status") || "pending";
    renderPinyinQueueCounts(pfQueueCounts);
    renderPinyinQueue();
    loadPinyinQueue();
  }

  function onPinyinQueueClick(e) {
    var b = e.target.closest ? e.target.closest("button[data-pf-decision]") : null;
    if (!b) return;
    var fid = b.getAttribute("data-fid");
    var decision = b.getAttribute("data-pf-decision");
    var A = acct();
    if (!A || typeof A.adminPinyinReview !== "function") { pfQueueMsg(STALE, "warn"); return; }

    var note = "";
    if (decision === "reject") {
      note = window.prompt("驳回理由（可留空，会显示给提交人）：", "") || "";
    }

    b.disabled = true;
    pfQueueMsg("正在保存……", "");
    Promise.resolve(A.adminPinyinReview({ fid: fid, decision: decision, note: note })).then(function (r) {
      b.disabled = false;
      if (r && r.ok) {
        pfQueueMsg(r.note || "已保存。", "ok");
        loadPinyinQueue().then(function () { if (pfWork) renderLines(); });
        return;
      }
      if (r && r.code === "E_STATE") { pfQueueMsg((r && r.message) || "这一条现在的状态不能这么操作。", "warn"); return; }
      if (r && r.code === "E_NO_FIX") { pfQueueMsg("这一条已经不存在了。", "warn"); return; }
      pfQueueMsg((r && r.message) || "保存失败，请稍后再试。", "warn");
    })["catch"](function () {
      b.disabled = false;
      pfQueueMsg(OFFLINE, "warn");
    });
  }

    function renderAccounts(data) {
    var box = $("accounts-body");
    if (!box) return;
    var list = (data && data.accounts) || [];
    currentAccounts = list;
    var empty = $("accounts-empty");
    if (empty) empty.hidden = list.length > 0;
    box.innerHTML = list.map(function (a) {
      var mail = a.email || "（无邮箱）";
      var role = String(a.role || "user").toLowerCase();
      var sub = [];
      if (a.nickname) sub.push(esc(a.nickname));
      if (!a.emailVerified || (a.status && a.status === "pending")) sub.push("待验证邮箱");
      else if (a.status && a.status !== "active") sub.push(esc(a.status));
      var note = sub.length ? '<span class="admin-who-note">' + sub.join(" · ") + "</span>" : "";
      return '<tr data-uid="' + esc(a.uid || "") + '">' +
        '<td><span class="admin-mail">' + esc(mail) + "</span>" + note + "</td>" +
        '<td class="admin-role-cell">' + roleCell(a, role) + "</td>" +
        '<td class="admin-tier-cell">' + tierCell(a, mail) + "</td>" +
        "</tr>";
    }).join("");
  }

  function tierCell(a, mail) {
    if (!a.uid) return "";
    var tier = String(a.tier || "free");
    var opts = Ent.TIERS.map(function (t) {
      return '<option value="' + t + '"' + (t === tier ? " selected" : "") + ">" + esc(Ent.tierLabel(t)) + "</option>";
    }).join("");
    return '<select class="admin-role-select" data-tier-of="' + esc(a.uid) + '"' +
      ' data-was="' + esc(tier) + '"' +
      ' aria-label="' + esc(mail + " 的层级") + '">' + opts + "</select>";
  }

  function roleCell(a, role) {
    if (!a.uid) return "";
    if (role === "owner") {
      return '<span class="admin-role-lock" title="所有者由服务端配置，此处不可修改">' + esc(roleText(role)) + "</span>";
    }
    var canAdmin = isOwner(myId);
    var opts = ["user", "admin"].map(function (r) {
      return '<option value="' + r + '"' + (r === role ? " selected" : "") + ">" + esc(roleText(r)) + "</option>";
    }).join("");
    return '<select class="admin-role-select" data-uid="' + esc(a.uid) + '"' +
      ' data-was="' + esc(role) + '"' +
      ' aria-label="' + esc((a.email || "") + " 的角色") + '"' +
      (canAdmin ? "" : ' disabled title="仅所有者可修改角色"') + ">" + opts + "</select>";
  }

  function accountsNote(text, warn) {
    var el = $("accounts-note");
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !text;
    el.className = "account-hint" + (warn ? " warn-hint" : "");
  }

  function loadAccounts() {
    var M = acct();
    if (!M || typeof M.adminAccounts !== "function") {
      accountsNote(STALE, true);
      return;
    }
    Promise.resolve(M.adminAccounts({ backing: backing, A: window.AuthCore, E: Ent })).then(function (r) {
      if (r && r.ok) {
        renderAccounts(r);
        var list = r.accounts || [];
        accountsNote("共 " + list.length + " 个账号。" +
          (isOwner(myId) ? "" : "仅所有者可修改角色。"), false);
        return;
      }
      if (r && r.reason === "guest") { accountsNote(EXPIRED, true); return; }
      if (r && r.reason === "not-configured") { accountsNote(NO_CLOUD, true); return; }
      if (r && r.reason === "no-channel") { accountsNote(STALE, true); return; }
      if (r && r.code === "E_FORBIDDEN") { accountsNote("仅管理员可查看。", true); return; }
      accountsNote(OFFLINE, true);
    })["catch"](function () { accountsNote(OFFLINE, true); });
  }

  function onAccountsChange(e) {
    var sel = e.target.closest ? e.target.closest("select[data-uid]") : null;
    if (!sel) return;
    var uid = sel.getAttribute("data-uid");
    var role = sel.value;
    var row = sel.closest("tr");
    var mail = row ? (row.querySelector(".admin-mail") || {}).textContent || "" : "";
    var was = sel.getAttribute("data-was") || "";

    if (role === "admin" && !window.confirm("将 " + mail + " 设为管理员？管理员可以调整层级、查看账号和处理报告，但不能修改角色。")) {
      sel.value = was || "user";
      return;
    }
    if (role === "user" && was === "admin" && !window.confirm("将 " + mail + " 降为普通用户？对方将无法再进入管理后台。")) {
      sel.value = was;
      return;
    }

    var M = acct();
    if (!M || typeof M.adminSetRole !== "function") {
      sel.value = was || "user";
      msg("msg-accounts", STALE, "warn");
      return;
    }

    sel.disabled = true;
    msg("msg-accounts", "正在保存……", "");
    Promise.resolve(M.adminSetRole({ uid: uid, role: role })).then(function (r) {
      sel.disabled = false;
      if (r && r.ok) {
        sel.setAttribute("data-was", role);
        msg("msg-accounts", (r.email || mail) + " 的角色已设为「" + roleText(role) + "」。", "ok");
        return;
      }
      sel.value = r && r.before ? r.before : (was || "user");
      if (r && r.code === "E_SELF") { msg("msg-accounts", "不能修改自己的角色。", "warn"); return; }
      if (r && r.code === "E_OWNER_LOCKED") { msg("msg-accounts", "所有者由服务端配置，此处不可修改。", "warn"); return; }
      if (r && r.code === "E_FORBIDDEN") { msg("msg-accounts", "仅所有者可修改角色。", "warn"); return; }
      if (r && r.reason === "guest") { msg("msg-accounts", EXPIRED, "warn"); return; }
      if (r && r.reason === "not-configured") { msg("msg-accounts", NO_CLOUD, "warn"); return; }
      msg("msg-accounts", (r && r.message) || "保存失败，请稍后再试。", "warn");
    })["catch"](function () {
      sel.disabled = false;
      sel.value = was || "user";
      msg("msg-accounts", OFFLINE, "warn");
    });
  }

    function onTierChange(e) {
    var sel = e.target.closest ? e.target.closest("select[data-tier-of]") : null;
    if (!sel) return;
    var uid = sel.getAttribute("data-tier-of");
    var tier = sel.value;
    var row = sel.closest("tr");
    var was = sel.getAttribute("data-was") || "free";
    var mail = row ? (row.querySelector(".admin-mail") || {}).textContent || uid : uid;

    var M = acct();
    if (!M || typeof M.adminGrant !== "function") {
      sel.value = was;
      msg("msg-accounts", STALE, "warn");
      return;
    }
    sel.disabled = true;
    msg("msg-accounts", "正在保存……", "");
    Promise.resolve(M.adminGrant({ uid: uid, tier: tier, backing: backing, A: window.AuthCore, E: Ent }))
      .then(function (r) {
        sel.disabled = false;
        if (r && r.ok) {
          sel.setAttribute("data-was", tier);
          msg("msg-accounts", mail + " 的层级已设为 " + Ent.tierLabel(tier) + "。", "ok");
          return;
        }
        sel.value = was;
        var text = (r && r.message) || "保存失败，请稍后再试。";
        if (r && r.reason === "guest") text = EXPIRED;
        else if (r && r.reason === "not-configured") text = NO_CLOUD;
        else if (r && r.reason === "no-channel") text = STALE;
        else if (r && r.reason === "unavailable") text = OFFLINE;
        msg("msg-accounts", text, "warn");
      })["catch"](function () {
        sel.disabled = false;
        sel.value = was;
        msg("msg-accounts", OFFLINE, "warn");
      });
  }

  var currentReports = [];
  var reportStatus = "new";
  var reportCounts = {};
  var STATUS_ORDER = ["new", "read", "accepted", "fixed", "rejected"];

  function statusLabel(s) { var R = window.Report; return R ? R.labelOfStatus(s) : s; }
  function statusDesc(s) { var R = window.Report; return R && R.descOfStatus ? R.descOfStatus(s) : ""; }

  function reportsMsg(text, level) {
    msg("msg-reports", text, level);
  }

  function reportsNote(text, warn) {
    var el = $("reports-note");
    if (!el) return;
    el.textContent = text || "";
    el.className = "account-hint" + (warn ? " warn" : "");
    el.hidden = !text;
  }

  function loadReports() {
    var M = acct();
    var box = $("reports-list");
    if (!box) return;
    if (!M || typeof M.adminReports !== "function") {
      reportsNote(STALE, true);
      return;
    }
    var status = reportStatus;
    reportsMsg("正在读取……", "");

    Promise.resolve(M.adminReports({ status: status, backing: backing, A: window.AuthCore, E: Ent }))
      .then(function (r) {
        if (r && r.ok) {
          currentReports = r.reports || [];
          reportCounts = r.counts || {};
          renderReports(currentReports);
          renderReportCounts(reportCounts, status);
          reportsMsg("", "");
          reportsNote("", false);
          return;
        }
        if (r && r.reason === "guest") { reportsMsg(EXPIRED, "warn"); return; }
        if (r && r.reason === "not-configured") { reportsNote(NO_CLOUD, true); return; }
        if (r && r.reason === "no-channel") { reportsNote(STALE, true); return; }
        if (r && r.code === "E_FORBIDDEN") { reportsNote("仅管理员可查看。", true); return; }
        reportsMsg(OFFLINE, "warn");
      })["catch"](function () { reportsMsg(OFFLINE, "warn"); });
  }

  function renderReportCounts(counts, current) {
    var host = $("report-counts");
    if (!host) return;
    var cur = String(current || "new");
    var total = 0;
    STATUS_ORDER.forEach(function (k) { total += Number(counts && counts[k]) || 0; });
    host.innerHTML = STATUS_ORDER.concat(["all"]).map(function (k) {
      var n = k === "all" ? total : (Number(counts && counts[k]) || 0);
      var label = k === "all" ? "全部" : statusLabel(k);
      return '<button type="button" class="' + (k === cur ? "active" : "") + '"' +
        ' data-count-status="' + esc(k) + '" aria-pressed="' + (k === cur ? "true" : "false") + '">' +
        esc(label) + "<span>" + n + "</span></button>";
    }).join("");
  }

  function onCountsClick(e) {
    var b = e.target.closest ? e.target.closest("button[data-count-status]") : null;
    if (!b) return;
    reportStatus = b.getAttribute("data-count-status") || "new";
    loadReports();
  }

  function emptyText(status) {
    if (status === "new") return "没有待处理的报告。点上方「全部」可以查看处理过的。";
    if (status === "all") return "还没有用户提交过报告。";
    return "没有「" + statusLabel(status) + "」的报告。";
  }

  function renderReports(list) {
    var box = $("reports-list");
    if (!box) return;
    var empty = $("reports-empty");
    if (empty) {
      empty.hidden = (list || []).length > 0;
      empty.textContent = emptyText(reportStatus);
    }
    box.innerHTML = (list || []).map(reportRowHtml).join("");
  }

  function reportField(label, value, cls) {
    return '<div class="admin-report-field' + (cls ? " " + cls : "") + '"><dt>' + esc(label) + "</dt><dd>" + esc(value) + "</dd></div>";
  }

  function reportRowHtml(r, k) {
    var R = window.Report;
    var st = String(r.status || "new");
    var rid = esc(r.rid);
    var fields = [];
    if (r.quote) fields.push(reportField("原句", r.quote, "is-quote"));
    if (r.context && r.context !== r.quote) fields.push(reportField("上下文", r.context));
    if (r.note) fields.push(reportField("问题", r.note));
    if (r.suggestion) fields.push(reportField("建议改为", r.suggestion, "is-sugg"));
    var who = [r.nickname, r.email || "（无邮箱）", reportTime(r.createdAt)].filter(Boolean).join(" · ");
    var title = r.poemTitle ? "《" + r.poemTitle + "》" : "（未指定篇目）";
    return '<li class="report-row admin-report-row report-st-' + esc(st) + '" data-rid="' + rid + '">' +
      '<div class="report-row-head">' +
      '<span class="report-kind">' + esc(R ? R.labelOfKind(r.kind) : r.kind) + "</span>" +
      '<span class="report-title">' + esc(title) + (r.book ? '<span class="admin-report-book">' + esc(r.book) + "</span>" : "") + "</span>" +
      '<span class="report-status">' + esc(statusLabel(st)) + "</span>" +
      "</div>" +
      (fields.length ? '<dl class="admin-report-fields">' + fields.join("") + "</dl>" : "") +
      '<div class="admin-report-who">' + esc(who) + "</div>" +
      '<div class="admin-report-reply">' +
      '<label class="account-label" for="rr-' + k + '">回复用户（选填）</label>' +
      '<div class="admin-report-reply-row">' +
      '<input id="rr-' + k + '" class="account-input" type="text" maxlength="2000" autocomplete="off"' +
      ' data-reply-of="' + rid + '" data-saved="' + esc(r.reply || "") + '" value="' + esc(r.reply || "") + '"' +
      ' placeholder="如：已改正，谢谢指出" />' +
      '<button type="button" class="account-btn ghost" data-reply-save="' + rid + '" hidden>保存回复</button>' +
      "</div></div>" +
      '<div class="admin-report-acts" role="group" aria-label="处理进度">' +
      STATUS_ORDER.map(function (s) { return reportAct(r.rid, s, st); }).join("") +
      (r.kind === "pinyin" && r.poemId ? '<button type="button" class="admin-report-jump" data-report-pinyin="' + rid + '">去改注音</button>' : "") +
      "</div>" +
      '<p class="admin-report-seen">用户看到：' + esc(statusDesc(st)) + "</p>" +
      "</li>";
  }

  function reportAct(rid, status, current) {
    var on = status === current;
    return '<button type="button" data-report-act="' + esc(status) + '" data-rid="' + esc(rid) + '"' +
      ' title="' + esc("用户看到：" + statusDesc(status)) + '"' +
      (on ? ' class="active" aria-pressed="true"' : ' aria-pressed="false"') + ">" +
      esc(statusLabel(status)) + "</button>";
  }

  function reportTime(ts) {
    var t = Number(ts) || 0;
    if (!t) return "";
    try {
      var d = new Date(t);
      var p = function (n) { return n < 10 ? "0" + n : "" + n; };
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
        " " + p(d.getHours()) + ":" + p(d.getMinutes());
    } catch (e) { return ""; }
  }

  function reportByRid(rid) {
    for (var i = 0; i < currentReports.length; i++) if (currentReports[i].rid === rid) return i;
    return -1;
  }

  function rowOf(rid) {
    var hit = null;
    Array.prototype.forEach.call(document.querySelectorAll(".admin-report-row"), function (li) {
      if (li.getAttribute("data-rid") === rid) hit = li;
    });
    return hit;
  }

  function replyInput(rid) {
    var li = rowOf(rid);
    return li ? li.querySelector("input[data-reply-of]") : null;
  }

  function onReplyInput(e) {
    var input = e.target;
    if (!input || !input.getAttribute || !input.hasAttribute("data-reply-of")) return;
    var li = input.closest(".admin-report-row");
    var btn = li ? li.querySelector("button[data-reply-save]") : null;
    if (btn) btn.hidden = input.value.trim() === (input.getAttribute("data-saved") || "");
  }

  function onReplyKey(e) {
    var input = e.target;
    if (e.key !== "Enter" || !input || !input.hasAttribute || !input.hasAttribute("data-reply-of")) return;
    e.preventDefault();
    var rid = input.getAttribute("data-reply-of");
    var k = reportByRid(rid);
    if (k >= 0) patchReport(rid, String(currentReports[k].status || "new"), null);
  }

  function patchReport(rid, status, btn) {
    var M = acct();
    if (!M || typeof M.adminReportPatch !== "function") {
      reportsMsg(STALE, "warn");
      return;
    }
    var k = reportByRid(rid);
    var before = k >= 0 ? currentReports[k] : null;
    var was = before ? String(before.status || "new") : "";
    var input = replyInput(rid);
    var reply = input ? input.value.trim() : (before && before.reply) || "";
    if (before && was === status && reply === (before.reply || "")) return;

    if (status === "rejected" && was !== "rejected" && !reply &&
        !window.confirm("标为「未采纳」？用户会看到「" + statusDesc("rejected") + "」。\n建议先在「回复用户」里写一句原因。")) return;

    if (btn) btn.disabled = true;
    reportsMsg("正在保存……", "");
    Promise.resolve(M.adminReportPatch({ rid: rid, status: status, reply: reply, backing: backing, A: window.AuthCore, E: Ent }))
      .then(function (r) {
        if (btn) btn.disabled = false;
        if (r && r.ok) {
          var next = {};
          Object.keys(before || {}).forEach(function (key) { next[key] = before[key]; });
          if (r.report) Object.keys(r.report).forEach(function (key) { next[key] = r.report[key]; });
          next.status = status;
          next.reply = reply;
          if (k >= 0) currentReports[k] = next;
          if (was && was !== status) {
            reportCounts[was] = Math.max(0, (Number(reportCounts[was]) || 0) - 1);
            reportCounts[status] = (Number(reportCounts[status]) || 0) + 1;
            renderReportCounts(reportCounts, reportStatus);
          }
          var li = rowOf(rid);
          if (li && k >= 0) {
            var tmp = document.createElement("ul");
            tmp.innerHTML = reportRowHtml(next, k);
            li.parentNode.replaceChild(tmp.firstChild, li);
          }
          reportsMsg(was === status
            ? "回复已保存。"
            : "已标为「" + statusLabel(status) + "」，用户会看到：" + statusDesc(status) + (reply ? "（附回复）" : ""), "ok");
          return;
        }
        if (r && r.code === "E_FORBIDDEN") { reportsMsg("仅管理员可操作。", "warn"); return; }
        if (r && r.reason === "guest") { reportsMsg(EXPIRED, "warn"); return; }
        reportsMsg("保存失败，请稍后再试。", "warn");
      })["catch"](function () {
        if (btn) btn.disabled = false;
        reportsMsg(OFFLINE, "warn");
      });
  }

  function onReportsClick(e) {
    if (!e.target.closest) return;
    var jump = e.target.closest("button[data-report-pinyin]");
    if (jump) {
      var k = reportByRid(jump.getAttribute("data-report-pinyin"));
      if (k >= 0) openFromReport(currentReports[k]);
      return;
    }
    var save = e.target.closest("button[data-reply-save]");
    if (save) {
      var rid = save.getAttribute("data-reply-save");
      var j = reportByRid(rid);
      if (j >= 0) patchReport(rid, String(currentReports[j].status || "new"), save);
      return;
    }
    var b = e.target.closest("button[data-report-act]");
    if (!b) return;
    patchReport(b.getAttribute("data-rid"), b.getAttribute("data-report-act"), b);
  }

    var painted = false;
  var paintTimer = null;

  function paintDeny(text) {
    show($("deny-card"));
    var lead = $("deny-lead");
    if (lead) lead.textContent = text;
    if (paintTimer) { clearTimeout(paintTimer); paintTimer = null; }
  }

  function paint() {
    var id = Ent.identity({ backing: backing });
    myId = id;

    if (!isOwner(id)) {
            if (!painted && (!id || !id.uid)) {
        if (!paintTimer) {
          paintTimer = setTimeout(function () {
            if (!painted) paintDeny("只对管理员开放。");
          }, 2500);
        }
        return;
      }
      painted = true;
      paintDeny("只对管理员开放。");
      return;
    }

    painted = true;
    hide($("deny-card"));
    show($("grant-card"));
    show($("reports-card"));
    show($("pinyin-card"));
    if (paintTimer) { clearTimeout(paintTimer); paintTimer = null; }
    if (paint.done) return;
    paint.done = true;

    var who = $("accounts-body");
    if (who) {
      who.addEventListener("change", onAccountsChange);
      who.addEventListener("change", onTierChange);
    }
    if ($("btn-reports-reload")) $("btn-reports-reload").addEventListener("click", loadReports);
    if ($("report-counts")) $("report-counts").addEventListener("click", onCountsClick);
    var rl = $("reports-list");
    if (rl) {
      rl.addEventListener("click", onReportsClick);
      rl.addEventListener("input", onReplyInput);
      rl.addEventListener("keydown", onReplyKey);
    }
    loadAccounts();
    loadReports();

    $("pf-q").addEventListener("input", onPinyinSearch);
    $("pf-results").addEventListener("click", onResultClick);
    $("pf-lines").addEventListener("click", onLinesClick);
    $("pf-lines").addEventListener("keydown", onLinesKey);
    $("btn-pf-change").addEventListener("click", closeWork);
    $("pf-list").addEventListener("click", onFixListClick);
    if ($("btn-pf-queue-reload")) $("btn-pf-queue-reload").addEventListener("click", loadPinyinQueue);
    if ($("pf-queue-counts")) $("pf-queue-counts").addEventListener("click", onPinyinQueueCountsClick);
    if ($("pf-queue-list")) $("pf-queue-list").addEventListener("click", onPinyinQueueClick);
    window.addEventListener("pinyin-fix-change", function () {
      renderFixList();
      if (pfWork) renderLines();
    });
    migrateLegacy();
    renderFixList();
    renderPinyinQueueCounts(pfQueueCounts);
    loadPinyinQueue();
    loadBooks().then(function () {
      renderFixList();
      if ((($("pf-q") || {}).value || "").trim()) onPinyinSearch();
    });
  }

  function init() {
        window.addEventListener("entitlementchange", paint);
    document.addEventListener("entitlementchange", paint);
    paint();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.AdminPage = {
    isOwner: isOwner, esc: esc, roleText: roleText,

    renderAccounts: renderAccounts, loadAccounts: loadAccounts,

    renderReports: renderReports, loadReports: loadReports, reportTime: reportTime,
    renderReportCounts: renderReportCounts,

    searchPoems: searchPoems,
    widOfPoem: widOfPoem,
    renderFixList: renderFixList
  };
})();
