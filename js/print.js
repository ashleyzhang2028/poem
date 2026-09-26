(function () {
  "use strict";

  var Ent = window.Entitlement;
  var PC = window.PrintCore;

  var CAP = "export.paper";

  var state = {
    open: false,
    scope: "collection",
    collectionId: "",
    poemId: "",
    paper: "a4",
    pinyin: true,
    translation: false,
    blank: false,
    blankLines: 3
  };

  var host = null;
  var entryUrl = null;

  function $(sel, base) { return (base || host || document).querySelector(sel); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function backing() {
    try { return window.localStorage; } catch (e) { return null; }
  }

  function identifier() {
    if (!Ent || !Ent.identity) return null;
    try { return Ent.identity({ backing: backing() }); } catch (e) { return null; }
  }

  function allowed(id) {
    if (!Ent) return { ok: false };
    return Ent.can(CAP, { tier: (id && id.tier) || "free", signedIn: !!(id && id.signedIn) });
  }

  function index() { return window.SITE_INDEX || []; }

  function byId(id) {
    var list = index();
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function withText(p) {
    if (!p) return null;
    if (typeof window.masterTextOf === "function") {
      var full = window.masterTextOf(p) || {};
      return {
        id: full.id || p.id,
        title: full.title || p.title || "",
        author: full.author || p.author || "",
        dynasty: full.dynasty || p.dynasty || "",
        gradeGroup: full.gradeGroup || p.gradeGroup || "",
        selection: full.selection || p.selection || "",
        book: full.book || p.book || "",
        source: full.source || p.source || "",
        text: full.text || p.text || "",
        translation: full.translation || p.translation || "",
        pinyin: full.pinyin || p.pinyin || ""
      };
    }
    return p;
  }

  function poemsFor() {
    if (state.scope === "poem") {
      var one = withText(byId(state.poemId));
      return one ? [one] : [];
    }
    var C = window.ReciteCollections;
    if (!C) return [];
    var col = state.collectionId
      ? { items: (C.get(state.collectionId) || { items: [] }).items }
      : null;
    var items = col ? col.items : null;

    if (!items) {
      return C.allEntries().map(function (e) {
        var p = withText(byId(e.entryId) || byId(e.wid));
        if (p) return p;
        var snap = e.snapshot || {};
        return {
          id: e.entryId, title: snap.title || "", author: snap.author || "",
          dynasty: snap.dynasty || "", source: snap.source || "",
          book: snap.book || "", gradeGroup: snap.gradeGroup || "",
          text: snap.text || "", translation: snap.translation || "", pinyin: ""
        };
      });
    }

    var seen = {};
    var out = [];
    items.forEach(function (it) {
      var id = typeof it === "string" ? it : (it && it.id) || "";
      if (!id) return;
      var wid = C.widOf ? C.widOf(id) : id;
      if (seen[wid]) return;
      seen[wid] = 1;
      var p = withText(byId(id) || byId(wid));
      if (p) { out.push(p); return; }
      var snap = (it && it.snap) || {};
      out.push({
        id: id, title: snap.title || "", author: snap.author || "",
        dynasty: snap.dynasty || "", source: snap.source || "",
        book: snap.book || "", gradeGroup: snap.gradeGroup || "",
        text: snap.text || "", translation: snap.translation || "", pinyin: ""
      });
    });
    return out;
  }

  function layoutNow() {
    if (!PC) return null;
    return PC.layout(poemsFor(), {
      paper: state.paper,

      pinyin: state.pinyin,
      translation: state.translation,
      blank: state.blank,
      blankLines: state.blankLines
    });
  }

  function gateCard(id) {
    var why = (Ent && Ent.denyReason)
      ? Ent.denyReason(CAP, { tier: id.tier, signedIn: id.signedIn })
      : "这一项要 Pro";
    return '<section class="account-card print-gate">' +
      '<h2 class="account-card-title">篇目打印页</h2>' +
      '<p class="account-gate-why">' + esc(why) + "</p>" +
      '<p class="account-hint">层级由管理员发放，对照见 ' +
      '<a href="/plans/">四种用户对比</a>。</p>' +
      "</section>";
  }

  function render() {
    if (!host || !PC) return;
    var id = identifier() || { tier: "free", signedIn: false };

    if (!id.signedIn) { host.hidden = true; host.innerHTML = ""; return; }

    if (!allowed(id).ok) {
      host.innerHTML = gateCard(id);
      bind();
      return;
    }

    var list = poemsFor();
    var lay = layoutNow();

    var html = '<section class="account-card">' +
      '<h2 class="account-card-title">篇目打印页</h2>' +
      '<p class="account-lead">选纸型与内容，然后点「打印 / 存 PDF」——' +
      "浏览器的打印对话框里选「另存为 PDF」就是 PDF。</p>" +
      '<p class="account-hint" id="print-summary">' + esc(PC.summary(lay)) + "</p>" +
      "</section>";

    html += '<section class="account-card"><h2 class="account-card-title">纸型</h2>' +
      '<div class="seg mini print-paper" id="print-paper" role="group" aria-label="纸型">' +
      PC.ORDER.map(function (k) {
        var p = PC.PAPER[k];
        return '<button type="button" data-print-paper="' + esc(k) + '"' +
          (state.paper === k ? ' class="active" aria-pressed="true"' : ' aria-pressed="false"') +
          ">" + esc(p.name) + "</button>";
      }).join("") + "</div>" +
      '<p class="account-hint">横向两栏更适合短篇；纵向一行一篇更适合长诗。</p>' +
      "</section>";

    html += '<section class="account-card"><h2 class="account-card-title">纸上放什么</h2>' +
      blockToggle("pinyin", "拼音行", "正文上面一行为注音，逐行对齐") +
      blockToggle("translation", "白话译文", "整篇之后另起一段（不是逐句对照）") +
      blockToggle("blank", "注释格线", "正文后面留几行空的，给自己写注释") +
      (state.blank
        ? '<div class="account-field print-blank-lines">' +
          '<label class="account-label" for="print-blank-lines">留几行</label>' +
          '<input class="account-input" id="print-blank-lines" type="number" min="0" max="12" ' +
          'step="1" value="' + esc(state.blankLines) + '" />' +
          "</div>"
        : "") +
      "</section>";

    html += '<section class="account-card"><h2 class="account-card-title">预览</h2>' +
      '<p class="account-hint">下面是纸上会有的字。字号与换页由浏览器打印时决定，' +
      "这里只保证内容一致。</p>" +
      '<div class="print-sheet">' + (lay && lay.blocks.length
        ? lay.blocks.map(renderBlock).join("")
        : '<p class="account-hint">这一份里还没有篇目。先去 <a href="/settings/lists/">我的清单</a> 加几篇。</p>') +
      "</div></section>";

    html += '<section class="account-card"><div class="print-actions">' +
      '<button class="account-btn" type="button" data-print-run="1">打印 / 存 PDF</button>' +
      "</div>" +
      '<p class="account-hint">打印对话框里若看不到边距设置，' +
      "默认就是本站排好的那一档。</p></section>";

    host.innerHTML = html;
    bind();
  }

  function blockToggle(key, name, desc) {
    return '<label class="print-opt">' +
      '<span class="print-opt-main">' +
      '<span class="print-opt-name">' + esc(name) + "</span>" +
      '<span class="print-opt-desc">' + esc(desc) + "</span>" +
      "</span>" +
      '<input type="checkbox" class="switch-input print-opt-box" data-print-toggle="' + esc(key) + '"' +
      (state[key] ? " checked" : "") + " />" +
      '<span class="switch-track" aria-hidden="true"></span>' +
      "</label>";
  }

  function renderBlock(b) {
    var rows = b.rows.map(function (r) {
      if (r.kind === "blank") return '<span class="print-blank" aria-hidden="true">　</span>';
      var cls = "print-row print-row-" + r.kind;
      return '<span class="' + cls + '">' + esc(r.text || "　") + "</span>";
    }).join("");
    return '<article class="print-block">' +
      (b.title ? '<h3 class="print-block-title">' + esc(b.title) + "</h3>" : "") +
      (b.meta ? '<p class="print-block-meta">' + esc(b.meta) + "</p>" : "") +
      '<div class="print-block-body">' + rows + "</div>" +
      "</article>";
  }

  function bind() {
    if (!host) return;
    host.onclick = function (e) {
      var t = e.target;
      var hit = function (a) { return t && t.closest ? t.closest("[" + a + "]") : null; };

      var paper = hit("data-print-paper");
      if (paper) { state.paper = paper.getAttribute("data-print-paper"); render(); return; }

      var run = hit("data-print-run");
      if (run) { runPrint(); return; }
    };
    host.onchange = function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var key = t.getAttribute("data-print-toggle");
      if (key) { state[key] = !!t.checked; render(); return; }
      if (t.id === "print-blank-lines") {
        var n = Number(t.value);
        state.blankLines = isFinite(n) ? Math.max(0, Math.min(12, Math.round(n))) : 3;
        render();
      }
    };
  }

  function runPrint() {
    var lay = layoutNow();
    if (!lay || !lay.count) {
      if (window.showToast) window.showToast("这一份里还没有篇目");
      return;
    }
    try { window.print(); }
    catch (e) {
      if (window.showToast) window.showToast("这个浏览器不允许直接打印，请用菜单里的「打印」");
    }
  }

  function paintHeader() {
    var C = window.SiteChrome;
    if (!C) return;
    C.setPage("篇目打印页");
    C.setSub("选纸型 · 选内容 · 打印或存 PDF");
  }

  function paintBack() {
    var C = window.SiteChrome;
    if (!C || !C.setPageAction) return;
    if (!host || host.hidden) { C.setPageAction(null); return; }
    C.setPageAction({ label: "返回上一页", onclick: function () { close(); } });
  }

  function loginUrl() {

    var path = "/";
    try { path = location.pathname || "/"; } catch (e) { path = "/"; }
    return "/login/?next=" + encodeURIComponent(path);
  }

  function open(opt) {
    if (!host) return;
    var o = opt || {};
    state.scope = o.poemId ? "poem" : "collection";
    state.poemId = o.poemId || "";
    state.collectionId = o.collectionId || "";

    var id = identifier() || { tier: "free", signedIn: false };
    if (!id.signedIn) {
      location.href = loginUrl();
      return false;
    }

    host.hidden = false;
    state.open = true;
    if (!entryUrl) entryUrl = String(location.href);
    render();
    paintHeader();
    paintBack();
    window.scrollTo(0, 0);
    return true;
  }

  function close() {
    if (!host) return;
    host.hidden = true;
    state.open = false;
    paintBack();
    var C = window.SiteChrome;
    if (C) { C.setPage(""); C.setSub(""); }
    window.scrollTo(0, 0);
  }

  function bindEntry() {
    var entries = document.querySelectorAll("[data-print-open]");
    Array.prototype.forEach.call(entries, function (entry) {
      if (entry.dataset.printBound === "1") return;
      entry.dataset.printBound = "1";
      entry.addEventListener("click", function (e) {
        e.preventDefault();
        open({
          collectionId: entry.getAttribute("data-print-collection") || "",
          poemId: entry.getAttribute("data-print-poem") || ""
        });
      });
    });
  }

  function init() {
    host = document.querySelector('[data-print-view="sheet"]');
    if (!host) return;
    host.hidden = true;
    bindEntry();
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && state.open) close();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.PrintPage = {
    CAP: CAP,
    open: open,
    close: close,
    bindEntries: bindEntry,
    loginUrl: loginUrl,
    isOpen: function () { return !!state.open; },
    state: function () { return state; },

    poems: poemsFor,
    layout: layoutNow
  };
})();
