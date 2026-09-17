(function () {
  "use strict";

  var DEFAULT_WORDS = {
    list: "小古文",
    unit: "篇",
    loadingFailed: "小古文数据加载失败",
    empty: "没有匹配的小古文",
    filterAll: "全部",
    filterUnread: "未读",
    matchGroup: "课外必背",
    filterGroup: "",
    filterGroupLabel: "",
    countInvalid: "数据加载失败",
    noReadable: "没有可朗读的篇目",
    backToList: "返回列表",
    readStoreLabel: "已读",

    pendingText: "本篇原文尚在整理中",
    pendingTranslation: "本篇白话译文尚在整理中",
    playerTitle: "",
    randomRead: "随机连读",
    searchPlaceholder: "搜索篇名 / 出处 / 作者",
    version: "",
    readStore: "poem_classic_read_v1",
    appName: "跬步",

    recite: "加入背诵",
    reciteAdd: "加入自选集合",
    reciteIn: "已在背诵",
    reciteRemove: "移出背诵"
  };

  var canonicalById = null;

  function canonicalMap() {
    if (canonicalById) return canonicalById;
    var list = (typeof window !== "undefined" && window.CANONICAL_TEXTS) || [];

    if (!list.length) return {};
    canonicalById = {};
    list.forEach(function (r) { if (r && r.id) canonicalById[r.id] = r; });
    return canonicalById;
  }

  function canonicalRuleFor(p, bookId) {
    var map = canonicalMap();
    var hit = map[p.id];
    if (hit) return hit;

    var book = bookId || (CFG && CFG.id) || "";
    if (book) {
      hit = map[book + "-" + p.id];
      if (hit) return hit;
    }
    return null;
  }

  function withMasterText(p, bookId) {
    if (!p || !p.textRef || p.text) return p;
    var book = bookId || (CFG && CFG.id) || "";
    if (typeof window !== "undefined" && typeof window.masterTextOf === "function") {
      return window.masterTextOf(p, book);
    }
    return p;
  }

  function canonicalOf(p, bookId) {
    if (!p || !p.id) return p;

    p = withMasterText(p, bookId);
    var rule = canonicalRuleFor(p, bookId);
    var book = bookId || (CFG && CFG.id) || "";
    if (!rule || !rule.of || rule.of === p.id || rule.of === book + "-" + p.id) return p;
    var byIdx = (typeof window !== "undefined" && window.SITE_INDEX) || null;

    var fromEntry = null;

    var keys = [rule.ofEntry, rule.of, "poems-" + rule.of];
    if (byIdx) {
      for (var k = 0; k < keys.length && !fromEntry; k++) {
        for (var i = 0; i < byIdx.length; i++) {
          if (byIdx[i].id === keys[k]) { fromEntry = byIdx[i]; break; }
        }
      }
    }

    if (!fromEntry && typeof window !== "undefined") {
      var course = window.POEMS_ALL || [];
      for (var c = 0; c < course.length && !fromEntry; c++) {
        if (course[c].id === rule.of || course[c].id === rule.ofEntry ||
            ("poems-" + course[c].id) === rule.ofEntry) fromEntry = course[c];
      }
    }
    if (!fromEntry) {

      var hits = items.filter(function (x) { return x.id === rule.of; });
      fromEntry = hits.length ? hits[0] : null;
    }
    if (!fromEntry) return p;
    return {
      id: p.id,
      title: p.title,
      author: p.author || "",
      authorName: p.authorName || "",
      dynasty: p.dynasty || "",
      source: p.source || "",
      selection: p.selection || "",
      excerpt: p.excerpt,
      grade: p.grade,
      term: p.term,
      gradeGroup: p.gradeGroup || "",
      translationSource: p.translationSource,
      text: rule.text === true ? (fromEntry.text || "") : (p.text || ""),
      translation: rule.translation === true ? (fromEntry.translation || "") : (p.translation || "")
    };
  }

  var FONT_KEY = "poem_classic_font_v1";

  var PLAY_KEY = (typeof window !== "undefined" && window.PlayModes && window.PlayModes.KEY) ||
    "poem_play_mode_v1";
  var DEFAULT_PLAY_MODE = (typeof window !== "undefined" && window.PlayModes &&
    window.PlayModes.DEFAULT) || "seq-origin";
  var ALIGN_KEY = "poem_classic_align_v1";
  var PINYIN_KEY = "poem_helper_pinyin_v1";
  var SETTINGS_KEY = "poem_recite_settings_v1";

  function $(sel, base) {
    if (base) return base.querySelector(sel);
    var hit = root && root.querySelector(sel);
    if (hit) return hit;
    hit = box && box.querySelector(sel);
    if (hit) return hit;
    return document.querySelector(sel);
  }
  function $$(sel, base) {
    if (base) return Array.prototype.slice.call(base.querySelectorAll(sel));
    var hit = root ? Array.prototype.slice.call(root.querySelectorAll(sel)) : [];
    if (box) {
      Array.prototype.slice.call(box.querySelectorAll(sel)).forEach(function (el) {
        if (hit.indexOf(el) === -1) hit.push(el);
      });
    }
    return hit;
  }

  function hasReadStore() {
    return !!(W && W.readStore);
  }

  function $$all(sel) {
    return Array.prototype.slice.call(document.querySelectorAll(sel));
  }

  function liveTo(s) {
    live = s;
    root = s.root;
    box = s.box;
    CFG = s.cfg;
    W = s.words;
    items = s.items;
    itemsById = s.byId;
    current = s.current;
    keyword = s.keyword;
    filter = s.filter;
    autoReading = s.autoReading;
    playModeId = s.playMode;
    speakingTarget = s.speakingTarget;
  }

  function stash(s) {
    if (!s) return;
    s.current = current;
    s.keyword = keyword;
    s.filter = filter;
    s.autoReading = autoReading;
    s.playMode = playModeId;
    s.speakingTarget = speakingTarget;
  }

  function sessionOf(node) {
    var el = node && node.nodeType === 1 ? node : (node && node.parentElement);
    while (el) {
      for (var i = 0; i < mounts.length; i++) {
        if (el === mounts[i].root || el === mounts[i].box) return mounts[i];
      }
      el = el.parentElement;
    }
    return live;
  }

  function enterLive() { if (live) liveTo(live); }

  const FONT_SIZES = [13, 15, 17, 19, 21, 23];
  const DEFAULT_FONT = 17;

  const ALIGNS = ["left", "center"];
  const DEFAULT_ALIGN = "center";

  const PINYIN_MODES = ["off", "rare", "all"];
  const DEFAULT_PINYIN_MODE = "rare";

  function helperOn() {
    if (typeof window !== "undefined" && window.ProgressStore &&
        typeof window.ProgressStore.helper === "function") {
      return window.ProgressStore.helper() !== "off";
    }
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}").helper !== "off";
    } catch (e) {
      return true;
    }
  }

  function effectivePinyinMode() {
    if (!helperOn()) return "off";
    const v = localStorage.getItem(PINYIN_KEY);

    if (PINYIN_MODES.indexOf(v) > -1) return v;
    return DEFAULT_PINYIN_MODE;
  }

  const APP_NAME = "跬步";

  let live = null;
  let box = null;
  let root = null;
  let CFG = null;
  let W = null;
  let items = [];
  let itemsById = {};
  let current = null;
  let keyword = "";
  let filter = "all";
  let autoReading = false;

  let playModeId = DEFAULT_PLAY_MODE;

  let speakingTarget = "原文";

  function pinyinMode() {
    return effectivePinyinMode();
  }

  function setPinyinMode(mode) {
    const m = PINYIN_MODES.indexOf(mode) > -1 ? mode : "off";
    localStorage.setItem(PINYIN_KEY, m);

    setHelperOn(m !== "off");
  }

  function setHelperOn(on) {
    if (typeof window !== "undefined" && window.ProgressStore &&
        typeof window.ProgressStore.setHelper === "function") {
      window.ProgressStore.setHelper(!!on);
      return;
    }
    let cfg = {};
    try {
      cfg = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {};
    } catch (e) {
      cfg = {};
    }
    if (!cfg || typeof cfg !== "object") cfg = {};
    cfg.helper = on ? "on" : "off";
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(cfg));
  }

  function currentUsername() {
    try {
      var cfg = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {};
      return String(cfg.username == null ? "" : cfg.username).trim();
    } catch (e) {
      return "";
    }
  }

  function paintSub() {
    $$all(".brand-sub").forEach(function (sub) { sub.textContent = CFG.pageSub || ""; });
  }

  function applyAppName() {
    var title = CFG.pageTitle || W.list;
    var name = currentUsername();

    document.title = name ? name + " · " + title + " · " + APP_NAME : title + " · " + APP_NAME;
    $$all('meta[name="apple-mobile-web-app-title"]').forEach(function (m) {
      m.setAttribute("content", name ? name + " · " + title : APP_NAME);
    });
    paintSub();

    var onChrome = function () { paintSub(); };
    document.addEventListener("chrome:ready", onChrome);
  }

  function RS() {
    return typeof window !== "undefined" && window.ProgressStore ? window.ProgressStore : null;
  }

  function readMap() {
    var ps = RS();
    if (ps) { try { return ps.readMap(W.readStore) || {}; } catch (e) {  } }
    try {
      var v = JSON.parse(localStorage.getItem(W.readStore) || "{}");
      return v && typeof v === "object" ? v : {};
    } catch (e) {
      return {};
    }
  }

  function isRead(id) {
    return !!readMap()[id];
  }

  function setRead(id, val) {
    var map = readMap();
    if (val) {
      var old = map[id] || {};
      map[id] = { read: true, at: old.at || Date.now(), times: (old.times || 0) + 1 };
    } else {
      delete map[id];
    }
    var ps = RS();
    if (ps && ps.setReadMap) ps.setReadMap(W.readStore, map);
    else localStorage.setItem(W.readStore, JSON.stringify(map));

    window.dispatchEvent(new CustomEvent("reader-read-change", { detail: { store: W.readStore, id: id, read: !!val } }));
  }

  function onReadChange(e) {
    if (!e.detail || e.detail.store !== W.readStore) return;
    $$('[data-id="' + e.detail.id + '"]', listBox()).forEach(function (el) {
      el.classList.toggle("done", !!e.detail.read);
      var mark = el.querySelector(".item-reason.read");
      if (e.detail.read && !mark) {
        var h = el.querySelector(".item-title");
        if (h) h.insertAdjacentHTML("beforeend", '<span class="item-reason read">' + esc(W.readStoreLabel) + "</span>");
      } else if (!e.detail.read && mark) {
        mark.parentNode.removeChild(mark);
      }
    });
  }

  function allItems() {
    var list = items.slice();
    var order = CFG.groupOrder || [];
    if (!order.length) return list;
    return list.sort(function (a, b) {
      var ia = order.indexOf(a.gradeGroup);
      var ib = order.indexOf(b.gradeGroup);
      var ra = ia === -1 ? order.length : ia;
      var rb = ib === -1 ? order.length : ib;
      if (ra !== rb) return ra - rb;

      return listIndexOf(a) - listIndexOf(b);
    });
  }

  function listIndexOf(p) {
    for (var i = 0; i < items.length; i++) if (items[i].id === p.id) return i;
    return 0;
  }

  function byId(id) {
    return itemsById[id] || null;
  }

  function idIndex(p) {
    var list = allItems();
    for (var i = 0; i < list.length; i++) if (list[i].id === p.id) return i;
    return -1;
  }

  function visibleItems() {
    var kw = keyword.trim().toLowerCase();
    return allItems().filter(function (p) {
      if (W.filterGroup && p.gradeGroup !== W.filterGroup) return false;
      if (filter === "unread" && isRead(p.id)) return false;
      if (!kw) return true;
      return haystack(p).toLowerCase().indexOf(kw) !== -1;
    });
  }

  function haystack(p) {

    return [p.title, p.source, p.selection, p.author, p.authorName, p.dynasty, p.gradeGroup]
      .concat(extraFields(p)).join(" ");
  }

  function extraFields(p) {
    var out = [];
    (CFG.extraFields || []).forEach(function (k) {
      if (p[k]) out.push(String(p[k]));
    });
    return out;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function closeTimeout(t) {
    if (t) clearTimeout(t);
  }

  function playGlyph() {
    return (
      '<span class="play-glyph" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24"><path d="M8.4 6.1 18.3 12 8.4 17.9Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" /></svg>' +
      "</span>" +
      '<span class="pause-glyph" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24"><path d="M8.2 5h2.9v14H8.2Z M12.9 5h2.9v14h-2.9Z" fill="currentColor" stroke="none" /></svg>' +
      "</span>"
    );
  }

  function arrowGlyph() {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M9.8 6.6 15.2 12l-5.4 5.4" /></svg>'
    );
  }

  function playSmGlyph() {
    return (
      '<span class="play-glyph-sm" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24"><path d="M9.4 6.6 18 12 9.4 17.4Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />' +
      "</svg></span>"
    );
  }

  function syncItemPlayBtns() {
    var playing = readingActive();
    $$(".item-read", listBox()).forEach(function (b) {
      b.dataset.on = playing ? "1" : "0";
    });
  }

  function readOne(p, btn) {
    if (!speechReady()) {
      showToast(speechHint());
      return;
    }

    if (readingActive()) {
      autoReading = false;
      window.Speech.stop();
      if (window.ReaderPlayer) window.ReaderPlayer.close();
      showToast("已停止朗读");
    } else {
      const ok = window.Speech.speak(speechText(p));
      showToast(ok ? "开始朗读《" + p.title + "》" : "朗读启动失败，请重试");
    }
    syncAllReadState();
    setTimeout(syncAllReadState, 80);
  }

  function listBox() {
    if (live && live.listEl && live.listEl.isConnected) return live.listEl;

    var el = root && root.classList && root.classList.contains("list") ? root : null;
    if (!el) el = inMount(root, '[data-gw="list"]');
    if (!el && root) el = root.querySelector("#gw-list");
    if (live) live.listEl = el;
    return el;
  }

  function renderList() {
    var listEl = listBox();
    if (!listEl) return;
    var shown = visibleItems();
    var total = allItems().length;
    listEl.innerHTML = "";
    if (!shown.length) {
      listEl.innerHTML = '<div class="empty">' +
        (total ? esc(W.empty) : esc(W.loadingFailed)) + "</div>";
      return;
    }

    var index = 0;
    var groupCard = null;
    var lastGroup = "";
    shown.forEach(function (p) {
      index += 1;

      if (p.gradeGroup && p.gradeGroup !== lastGroup) {
        lastGroup = p.gradeGroup;
        groupCard = document.createElement("section");
        groupCard.className = "group-card";
        groupCard.dataset.group = p.gradeGroup;
        var head = document.createElement("div");

        head.className = "group-head";
        head.innerHTML =
          '<span class="group-name">' + esc(p.gradeGroup) + "</span>" +
          '<span class="group-count">' + allItems().filter(function (x) { return x.gradeGroup === lastGroup; }).length + " " + esc(W.unit) + "</span>" +

          '<button type="button" class="gw-play gw-play-sm" data-random-group="' + esc(p.gradeGroup) + '" data-menu="0"' +
          ">" + playSmGlyph() +
          '<span class="gw-play-input"></span>' +
          '<span class="play-mode" aria-hidden="true"></span>' +
          '<span class="gw-menu" role="menu" hidden></span>' +
          "</button>";
        groupCard.appendChild(head);
        listEl.appendChild(groupCard);
      }

      var read = isRead(p.id);

      var pending = !p.text || !p.translation;
      var el = document.createElement("div");
      el.className = "item" + (read ? " done" : "") + (pending ? " pending" : "") +
        (p.gradeGroup === W.matchGroup ? "" : " in-book");
      el.dataset.id = p.id;
      el.innerHTML =
        '<div class="item-main">' +

        '<h3 class="item-title"><span class="item-num">' + index + "</span>" + esc(p.title) +
        (read && hasReadStore() ? '<span class="item-reason read">' + esc(W.readStoreLabel) + "</span>" : "") +
        (pending ? '<span class="item-reason pending">待补</span>' : "") +
        "</h3>" +

        '<div class="item-meta">' +
        (p.dynasty ? "<span>" + esc(p.dynasty) + "</span>" : "") +
        (p.author ? (p.dynasty ? "<span>·</span>" : "") + "<span>" + esc(p.author) +
          (p.authorName && p.authorName !== p.author ? "（" + esc(p.authorName) + "）" : "") + "</span>" : "") +
        (p.source ? ((p.dynasty || p.author) ? "<span>·</span>" : "") + "<span>" + esc(p.source) + "</span>" : "") +
        (p.selection ? "<span class=\"item-selection\">" + esc(p.selection) + "</span>" : "") +

        (function () {
          var line = p.excerpt != null && String(p.excerpt) !== ""
            ? String(p.excerpt)
            : (p.text ? String(p.text) : "").replace(/\n/g, "").slice(0, 16) + (p.text ? "…" : "");
          return line ? "<span>·</span><span>" + esc(line.replace(/\n/g, "")) + "</span>" : "";
        })() +
        "</div>" +
        "</div>" +

        (CFG.reciteList === false ? "" : reciteItemBtn(p)) +
        '<button type="button" class="item-read" title="播放这一篇" aria-label="播放 ' + esc(p.title) + '">' +
        playGlyph() + "</button>" +
        '<div class="item-arrow">' + arrowGlyph() + "</div>";
      el.addEventListener("click", function () { openReader(p); });
      var playBtn = el.querySelector(".item-read");
      playBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        readOne(p, playBtn);
      });
      var reciteBtn = el.querySelector(".item-recite");
      if (reciteBtn) {
        reciteBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          claim(e);
          startRecite(p);
        });
      }
      (groupCard || listEl).appendChild(el);
    });

    $$(".group-head .gw-play-sm .gw-menu", listEl).forEach(renderPlayMenu);

    syncItemPlayBtns();
    syncPlayBtn();
    syncListItemReciteButtons();
  }

  function highlightItem(id) {
    var el = $(".item[data-id='" + id + "']", listBox());
    if (!el) return;
    el.classList.add("reading");
    if (typeof el.scrollIntoView === "function") {
      try {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      } catch (e) {  }
    }
  }

  function clearHighlight() {
    $$(".item.reading", listBox()).forEach(function (el) { el.classList.remove("reading"); });
  }

  function rd(sel) {
    var el = box ? box.querySelector('[data-gw="' + sel + '"]') : null;
    if (el) return el;
    el = root ? root.querySelector('[data-gw="' + sel + '"]') : null;
    return el || document.querySelector('[data-gw="' + sel + '"]');
  }

  function rdAll(sel) {
    var hits = [];
    [box, root, document].forEach(function (base) {
      if (!base) return;
      Array.prototype.slice.call(base.querySelectorAll('[data-gw="' + sel + '"]')).forEach(function (el) {
        if (hits.indexOf(el) === -1) hits.push(el);
      });
    });
    return hits;
  }

  function inMount(elem, sel) {
    if (!elem || !elem.querySelectorAll) return null;
    var hit = elem.querySelectorAll(sel)[0];
    if (hit) return hit;
    var up = elem.parentNode;
    return up && up.querySelectorAll ? up.querySelectorAll(sel)[0] : null;
  }

  function openReader(p) {

    if (p && p.id && itemsById[p.id]) p = itemsById[p.id];
    current = p;
    var idx = idIndex(p);
    var el = rd("reader");
    if (!el) return;
    el.querySelector('.rd-title, #rd-title').textContent = p.title;
    var meta = el.querySelector('.rd-meta, #rd-meta');

    var authorTag = p.author || "";
    if (p.authorName && p.authorName !== p.author) {
      authorTag = p.author + "（" + p.authorName + "）";
    }

    meta.innerHTML =
      (p.dynasty ? '<span class="tag ghost">' + esc(p.dynasty) + "</span>" : "") +
      (authorTag ? '<span class="tag ghost">' + esc(authorTag) + "</span>" : "") +
      (p.source ? '<span class="tag">' + esc(p.source) + "</span>" : "") +
      (p.selection ? '<span class="tag ghost">' + esc(p.selection) + "</span>" : "");

    renderReaderText();
    el.querySelector('.rd-trans-text, #rd-trans-text').textContent = p.translation || W.pendingTranslation;

    var srcEl = el.querySelector('.rd-trans-src, #rd-trans-src');
    if (srcEl) {
      srcEl.textContent = p.translation && window.translationSourceText
        ? window.translationSourceText(p) : "";
    }

    showTransBox(false);
    speakingTarget = "原文";
    renderNav();
    applyFont();
    applyAlign();
    syncPinyinButton();
    syncReadButtons();
    syncDoneButton();
    syncReciteButtons();
    el.hidden = false;
    document.body.classList.add("reader-open");

    var back = (typeof CFG.openFrom === "function" && CFG.openFrom()) || null;
    if (!back) back = closeReader;
    if (window.SiteChrome) {
      window.SiteChrome.setHeaderAction({ label: W.backToList, onclick: back });

      paintSub();
    }

    var printBtn = document.querySelector("[data-print-open]");
    if (printBtn) printBtn.setAttribute("data-print-poem", p.id || "");
    window.scrollTo(0, 0);
  }

  function renderNav() {
    if (!current) return;
    const list = allItems();
    const i = idIndex(current);
    const prev = i > 0 ? list[i - 1] : null;
    const next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
    const prevBtn = rd("prev");
    const nextBtn = rd("next");
    if (!prevBtn || !nextBtn) return;
    rd("prev-title").textContent = prev ? prev.title : "已是第一篇";
    rd("next-title").textContent = next ? next.title : "已是最后一篇";

    prevBtn.title = prev ? prev.title : "已是第一篇";
    nextBtn.title = next ? next.title : "已是最后一篇";
    prevBtn.disabled = !prev;
    nextBtn.disabled = !next;
    prevBtn.dataset.target = prev ? prev.id : "";
    nextBtn.dataset.target = next ? next.id : "";
  }

  function goSibling(dir) {
    if (!current) return;
    const list = allItems();
    const i = idIndex(current) + dir;
    if (i < 0 || i >= list.length) return;
    if (window.Speech) window.Speech.stop();
    openReader(list[i]);
  }

  function renderReaderText() {
    if (!current) return;
    var el = rd("text");
    if (!el) return;
    if (!current.text) {
      el.classList.remove("with-pinyin");
      el.textContent = W.pendingText;
      return;
    }
    var mode = pinyinMode();
    if (mode !== "off" && window.Pinyin) {
      el.innerHTML = window.Pinyin.annotateHtml(current.text, mode === "all" ? "all" : "rare");
      el.classList.add("with-pinyin");
    } else {
      el.textContent = current.text;
      el.classList.remove("with-pinyin");
    }
  }

  function syncPinyinButton() {
    var seg = rd("reader") && rd("reader").querySelector(".pinyin-seg, #rd-pinyin-seg");
    if (!seg) return;
    const mode = pinyinMode();
    $$("button", seg).forEach(function (b) {
      const on = b.dataset.mode === mode;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    seg.dataset.on = mode === "off" ? "0" : "1";
  }

  function setPinyinModeFromUI(mode) {
    setPinyinMode(mode);
    renderReaderText();
    syncPinyinButton();
    showToast(mode === "off" ? "已隐藏拼音" : mode === "all" ? "已全文注音" : "已只标生字");
  }

  function speechText(p) {
    const head = [p.title, p.dynasty, p.author].filter(Boolean).join("，");
    return head + "。" + p.text;
  }

  function speechSupported() {
    return !!(window.Speech && window.Speech.supported());
  }

  function speechReady() {
    if (!speechSupported()) return false;
    return !!(window.Speech.allowed && window.Speech.allowed().ok);
  }

  function speechHint() {
    if (!speechSupported()) return "当前浏览器不支持语音朗读";
    const a = window.Speech.allowed ? window.Speech.allowed() : { ok: true, hint: "" };

    return a.hint || "登录可用";
  }

  function readingActive() {
    return !!(window.Speech && window.Speech.active && window.Speech.active());
  }

  function handleSpeechStopped() {
    if (window.Speech && window.Speech.active && window.Speech.active()) return;
    autoReading = false;
    clearHighlight();
    syncAllReadState();

    syncPlayBtn();
  }

  function syncAllReadState() {
    syncReadButtons();
    syncTransReadButton();
    syncRandomReadButton();
    syncItemPlayBtns();
  }

  function syncReadButtons() {
    const ok = speechReady();

    const playing = ok && !autoReading && readingActive();

    var btn = rd("read");
    if (btn) {
      btn.disabled = !ok;
      btn.title = ok ? "朗读原文：标题、朝代、作者与正文" : speechHint();
      const on = playing && speakingTarget === "原文";
      btn.dataset.on = on ? "1" : "0";
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }

    syncTransReadButton();
  }

  function toggleRead() {
    if (!current) return;

    if (!speechReady()) {
      showToast(speechHint());
      return;
    }

    autoReading = false;

    if (readingActive() && speakingTarget === "原文") {
      window.Speech.stop();
      showToast("已停止朗读");
    } else {
      speakingTarget = "原文";
      const ok = window.Speech.speak(speechText(current));
      showToast(ok ? "开始朗读" : "朗读启动失败，请重试");
    }
    syncAllReadState();
    setTimeout(syncAllReadState, 60);
    setTimeout(syncAllReadState, 300);
  }

  function toggleTransRead() {
    if (!current) return;
    if (!speechReady()) {
      showToast(speechHint());
      return;
    }
    autoReading = false;

    if (readingActive() && speakingTarget === "译文") {
      window.Speech.stop();
      showToast("已停止朗读");
    } else {
      const t = current.translation || "";
      if (!t) {
        showToast("本篇暂无译文");
        return;
      }
      var tbox = rd("trans");
      if (tbox && tbox.hidden) showTransBox(true);
      speakingTarget = "译文";
      const ok = window.Speech.speak(t);
      showToast(ok ? "开始朗读译文" : "朗读启动失败，请重试");
    }
    syncAllReadState();
    setTimeout(syncAllReadState, 60);
    setTimeout(syncAllReadState, 300);
  }

  function showTransBox(show) {
    var btn = rd("trans-toggle");
    var transBox = rd("trans");
    if (!transBox) return;
    transBox.hidden = !show;
    if (btn) {
      const on = !!show;
      btn.dataset.on = on ? "1" : "0";
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.title = on ? "收起译文" : "显示译文";
      var t = btn && btn.querySelector(".sr-only");
      if (t) t.textContent = on ? "收起译文" : "显示译文";
    }

    if (!show && speakingTarget === "译文") speakingTarget = "原文";
    syncTransReadButton();
  }

  function syncTransReadButton() {
    var btn = rd("trans-read");
    if (!btn) return;
    const ok = speechReady();
    var tbox = rd("trans");
    const boxOpen = !!tbox && !tbox.hidden;
    btn.disabled = !ok;
    btn.title = ok ? "朗读白话译文" : speechHint();

    const on = ok && boxOpen && !autoReading && speakingTarget === "译文" && readingActive();
    btn.dataset.on = on ? "1" : "0";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    var label = btn.querySelector(".trans-read-label");
    if (label) label.textContent = on ? "停止朗读" : "朗读译文";
  }

  function hideReader() {
    if (window.Speech) window.Speech.stop();
    autoReading = false;
    speakingTarget = "原文";
    var el = rd("reader");
    if (el) el.hidden = true;
    document.body.classList.remove("reader-open");
    current = null;
    renderList();
    syncRandomReadButton();

    if (window.SiteChrome && window.SiteChrome.setHeaderAction) {
      window.SiteChrome.setHeaderAction(null);
    }

    return typeof CFG.onHideReader === "function" ? CFG.onHideReader() !== false : false;
  }

  function closeReader() {

    hideReader();
    paintSub();
  }

  function syncDoneButton() {
    if (!current) return;
    var btn = rd("done");
    if (!btn) return;

    btn.hidden = !hasReadStore();
    if (!hasReadStore()) return;
    const read = isRead(current.id);
    btn.classList.toggle("is-done", read);

    btn.title = read ? "已读，再点一次取消" : "标记为已读";
    btn.setAttribute("aria-pressed", read ? "true" : "false");
    var label = btn.querySelector(".sr-only");
    if (label) label.textContent = read ? "已读，再点一次取消" : "标记为已读";
  }

  var PLAY = (typeof window !== "undefined" && window.PlayModes) || null;
  var PLAY_MODES = PLAY ? PLAY.LIST : [];
  function modeOf(id) {
    if (PLAY) return PLAY.of(id);
    for (var i = 0; i < PLAY_MODES.length; i++) {
      if (PLAY_MODES[i].id === id) return PLAY_MODES[i];
    }
    return null;
  }

  function playMode() {
    return PLAY ? PLAY.read() : DEFAULT_PLAY_MODE;
  }

  function playModeInfo() {
    return modeOf(playModeId) || modeOf(playMode()) || modeOf(DEFAULT_PLAY_MODE);
  }

  function playBtnAria(mode) {
    var m = mode || playModeInfo();

    return m.label + (m.note ? "；" + m.note : "");
  }

  function setPlayMode(id) {
    if (!modeOf(id)) return false;

    if (PLAY) { PLAY.write(id); PLAY.emit(id); } else { localStorage.setItem(PLAY_KEY, id); }
    syncPlayBtn();
    showToast(modeOf(id).label);
    return true;
  }

  function syncPlayBtn() {
    var running = autoReading && !!(window.Speech && window.Speech.active && window.Speech.active());
    var label = playBtnAria();
    var info = playModeInfo();
    headPlayBtns().forEach(function (btn) {
      btn.dataset.on = running ? "1" : "0";
      btn.setAttribute("aria-pressed", running ? "true" : "false");
      btn.title = running ? "停止连读" : label;
      btn.setAttribute("aria-label", running ? "停止连读" : label);
      btn.dataset.mode = info.id;

      btn.dataset.playShort = info.short;
    });

    syncRandomReadButton();
  }

  function headPlayBtns(scope) {
    var el = scope || listBox();
    if (!el) return [];
    return $$(".group-head .gw-play-sm", el);
  }

  function closePlayMenus() {
    $$all(".gw-menu").forEach(function (m) {
      m.hidden = true;
      m.setAttribute("aria-hidden", "true");
      var owner = m.parentNode;
      if (owner && owner.removeAttribute) owner.removeAttribute("data-menu");
    });
  }

  function togglePlayMenu(btn) {
    if (!btn) return;
    var menu = btn.querySelector(".gw-menu");
    if (!menu) return;
    var open = menu.hidden;
    closePlayMenus();
    if (!open) return;

    var cur = playModeInfo().id;
    $$("button", menu).forEach(function (m) {
      var on = m.dataset.mode === cur;
      m.classList.toggle("active", on);
      m.setAttribute("aria-checked", on ? "true" : "false");
    });
    btn.dataset.menu = "1";
    menu.hidden = false;

    menu.setAttribute("aria-hidden", "true");
  }

  function renderPlayMenu(menu) {
    var cur = playModeInfo().id;
    menu.innerHTML = PLAY_MODES.map(function (m) {
      return '<button type="button" role="menuitemradio" class="gw-menu-item' +
        (m.id === cur ? " active" : "") + '" data-mode="' + m.id + '"' +
        ' aria-checked="' + (m.id === cur ? "true" : "false") + '">' +
        '<span class="gw-menu-tick" aria-hidden="true"></span>' +
        '<span class="gw-menu-text">' + esc(m.label) + "</span></button>";
    }).join("");
  }

  function playPool(btn) {

    if (!btn) return visibleItems();
    var group = btn.dataset.randomGroup;

    var shown = visibleItems();
    if (!group) return shown;
    return shown.filter(function (p) { return p.gradeGroup === group; });
  }

  function buildQueue(pool, mode) {
    var self = live;
    var out = [];
    pool.forEach(function (p) {
      var text = mode.source === "译文" ? p.translation : speechText(p);
      if (mode.source === "原文+译文" && p.translation) text = speechText(p) + "。" + p.translation;
      if (!text || !String(text).trim()) return;
      out.push({
        id: p.id,
        title: p.title,
        text: text,
        onStart: function () {
          withSession(self, function () {
            if (!current || current.id !== p.id) openReader(p);
            highlightItem(p.id);
          });
        }
      });
    });
    return mode.order === "shuffle" ? shuffle(out) : out;
  }

  function startPlay(btn) {
    if (!speechReady()) {
      showToast(speechHint());
      return;
    }

    if (autoReading && readingActive()) {
      window.Speech.stop();
      if (window.ReaderPlayer) window.ReaderPlayer.close();
      autoReading = false;
      clearHighlight();
      syncPlayBtn();
      syncItemPlayBtns();
      showToast("已停止连读");
      return;
    }
    var list = buildQueue(playPool(btn), playModeInfo());
    if (!list.length) {

      showToast(btn
        ? "本分类暂无" + (playModeInfo().source === "原文" ? "可读篇目" : "译文可读")
        : W.noReadable);
      return;
    }
    closePlayMenus();
    autoReading = true;
    syncPlayBtn();

    var selfSession = live;
    window.ReaderPlayer.player({
      title: playModeInfo().label,
      mode: playModeInfo().short,
      items: list,
      onIndex: function (i) {
        withSession(selfSession, function () {
          var it = list[i];
          if (!it) return;
          if (!current || current.id !== it.id) openReader(byId(it.id) || current);
          syncPlayBtn();
        });
      },
      onEnd: function () {
        withSession(selfSession, function () {
          autoReading = false;
          clearHighlight();
          syncPlayBtn();
          syncReadButtons();
          syncItemPlayBtns();
        });
      }
    });
  }

  function syncRandomReadButton() {
    var btn = $('[data-gw="random"]') || $("#gw-random-read");
    if (!btn) return;
    const ok = speechReady();
    btn.disabled = !ok;
    const running = autoReading && !!(window.Speech && window.Speech.active && window.Speech.active());
    btn.dataset.on = running ? "1" : "0";

    btn.setAttribute("aria-pressed", running ? "true" : "false");

    btn.title = running ? "停止连读" : (ok ? playBtnAria() : speechHint());
  }

  function shuffle(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function fontIdx() {
    const v = Number(localStorage.getItem(FONT_KEY));
    const i = FONT_SIZES.indexOf(v);
    return i === -1 ? FONT_SIZES.indexOf(DEFAULT_FONT) : i;
  }

  function applyFont() {
    var el = rd("text");
    if (el) el.style.fontSize = FONT_SIZES[fontIdx()] + "px";
  }

  function changeFont(step) {
    let i = fontIdx() + step;
    i = Math.max(0, Math.min(FONT_SIZES.length - 1, i));
    localStorage.setItem(FONT_KEY, String(FONT_SIZES[i]));
    applyFont();
    showToast("字号 " + FONT_SIZES[i] + "px");
  }

  function alignMode() {
    const v = localStorage.getItem(ALIGN_KEY);
    return ALIGNS.indexOf(v) > -1 ? v : DEFAULT_ALIGN;
  }

  function applyAlign() {
    var el = rd("text");
    if (!el) return;
    el.dataset.align = alignMode();
  }

  function syncAlignButtons() {
    const mode = alignMode();
    rdAll("align").forEach(function (b) {
      const on = b.dataset.align === mode;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function setAlign(mode) {
    localStorage.setItem(ALIGN_KEY, ALIGNS.indexOf(mode) > -1 ? mode : DEFAULT_ALIGN);
    applyAlign();
    syncAlignButtons();
    showToast(mode === "left" ? "正文左对齐" : "正文居中对齐");
  }

  function showToast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { t.hidden = true; }, 1600);
  }

  function claim(e) {
    var s = sessionOf(e && (e.currentTarget || e.target));
    if (s && s !== live) liveTo(s);
    return s || live;
  }

  function bindEvents() {
    var search = $('[data-gw="search"]') || $("#gw-search");
    if (search) {
      search.addEventListener("input", function (e) {
        var s = claim(e);

        s.keyword = search.value;
        keyword = search.value;
        renderList();
      });
    }

    $$all("[data-filter]").forEach(function (b) {
      b.addEventListener("click", function (e) {
        claim(e);
        filter = b.dataset.filter;
        $$all("[data-filter]").forEach(function (x) {
          if (sessionOf(x) !== live) return;
          var on = x === b;
          x.classList.toggle("active", on);
          x.setAttribute("aria-pressed", on ? "true" : "false");
        });
        renderList();
      });
    });

    var listEl = listBox();
    if (listEl) {
      var menuOpenedAt = 0;
      listEl.addEventListener("click", function (e) {
        var target = e.target;
        if (!target || !target.closest) return;
        claim(e);

        var mi = target.closest(".gw-menu-item");
        if (mi) {
          e.stopPropagation();
          setPlayMode(mi.dataset.mode);
          closePlayMenus();
          startPlay(mi.closest(".gw-play-sm"));
          return;
        }
        var gbtn = target.closest("[data-random-group]") || target.closest("[data-play-group]");
        if (!gbtn) {
          closePlayMenus();
          return;
        }
        e.stopPropagation();

        if (Date.now() - menuOpenedAt < 700) return;
        startPlay(gbtn);
      });

      var pressTimer = null;
      var pressFrom = null;
      var openMenuByPress = function (e) {
        var target = e.target;
        if (!target || !target.closest) return;
        var gbtn = target.closest("[data-random-group]") || target.closest("[data-play-group]");
        if (!gbtn) return;
        claim(e);
        closeTimeout(pressTimer);
        pressFrom = { x: e.clientX, y: e.clientY };
        pressTimer = setTimeout(function () {
          menuOpenedAt = Date.now();
          togglePlayMenu(gbtn);
        }, 500);
      };
      var cancelPress = function () { closeTimeout(pressTimer); };
      listEl.addEventListener("pointerdown", openMenuByPress);
      ["pointerup", "pointercancel", "pointerleave", "scroll"].forEach(function (ev) {
        listEl.addEventListener(ev, cancelPress, true);
      });
      listEl.addEventListener("pointermove", function (e) {
        if (!pressFrom) return;
        if (Math.abs(e.clientX - pressFrom.x) > 8 || Math.abs(e.clientY - pressFrom.y) > 8) cancelPress();
      });

      listEl.addEventListener("contextmenu", function (e) {
        var target = e.target;
        if (!target || !target.closest) return;
        var gbtn = target.closest("[data-random-group]") || target.closest("[data-play-group]");
        if (!gbtn) return;
        claim(e);
        e.preventDefault();
        togglePlayMenu(gbtn);
      });
    }

    document.addEventListener("click", function (e) {
      var t = e.target;
      if (t && t.closest && t.closest("#gw-list [data-random-group], #gw-list [data-play-group]")) return;
      if (t && t.closest && t.closest(".gw-menu")) return;
      closePlayMenus();
    });

    var randomBtn = $('[data-gw="random"]') || $("#gw-random-read");
    if (randomBtn) {

      randomBtn.addEventListener("click", function (e) { claim(e); startPlay(null); });
    }

    var prevBtn = rd("prev");
    var nextBtn = rd("next");
    if (prevBtn) prevBtn.addEventListener("click", function (e) { claim(e); goSibling(-1); });
    if (nextBtn) nextBtn.addEventListener("click", function (e) { claim(e); goSibling(1); });

    var doneBtn = rd("done");
    if (doneBtn) doneBtn.addEventListener("click", function (e) {
      claim(e);
      if (!current) return;
      var now = isRead(current.id);
      setRead(current.id, !now);
      syncDoneButton();
      showToast(now ? "已取消「已读」" : "已标记为已读");
    });

    var reciteBtn = rd("recite");
    if (reciteBtn) reciteBtn.addEventListener("click", function (e) {
      claim(e);
      if (!current) return;
      startRecite(current);
    });

    var transToggle = rd("trans-toggle");
    if (transToggle) transToggle.addEventListener("click", function (e) {
      claim(e);
      var show = this.dataset.on !== "1";

      if (!show && speakingTarget === "译文" && readingActive()) window.Speech.stop();
      showTransBox(show);
      syncAllReadState();
    });

    var fontUp = rd("font-up");
    var fontDown = rd("font-down");
    if (fontUp) fontUp.addEventListener("click", function (e) { claim(e); changeFont(1); });
    if (fontDown) fontDown.addEventListener("click", function (e) { claim(e); changeFont(-1); });

    rdAll("align").forEach(function (b) {
      b.addEventListener("click", function (e) { claim(e); setAlign(b.dataset.align); });
    });

    rdAll("pinyin").forEach(function (b) {
      b.addEventListener("click", function (e) {
        claim(e);
        setPinyinModeFromUI(b.dataset.mode);
      });
    });

    var readBtn = rd("read");
    if (readBtn) readBtn.addEventListener("click", function (e) { claim(e); toggleRead(); });
    var transReadBtn = rd("trans-read");
    if (transReadBtn) transReadBtn.addEventListener("click", function (e) { claim(e); toggleTransRead(); });
  }

  function bindGlobal() {
    if (bindGlobal.done) return;
    bindGlobal.done = true;

    if (window.ReaderPlayer && window.ReaderPlayer.onStop) window.ReaderPlayer.onStop(handleSpeechStopped);

    if (window.speechSynthesis && window.speechSynthesis.addEventListener) {
      var syncAll = function () { handleSpeechStopped(); };
      window.speechSynthesis.addEventListener("end", syncAll);
      window.speechSynthesis.addEventListener("cancel", syncAll);
    }

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      var open = activeMount();
      if (open) open.close();
    });

    window.addEventListener("hashchange", function () {
      if (location.hash === "#read") return;
      var open = activeMount();
      if (open) open.close();
    });

    window.addEventListener("storage", function (e) {
      if (e.key !== SETTINGS_KEY && e.key !== PINYIN_KEY) return;
      mounts.forEach(function (s) {
        withSession(s, function () { renderReaderText(); syncPinyinButton(); });
      });
    });

    window.addEventListener("pageshow", function () {
      mounts.forEach(function (s) {
        withSession(s, function () {
          if (!current) return;
          renderReaderText();
          syncPinyinButton();
        });
      });
    });

    window.addEventListener("recite-collections-change", function () {
      mounts.forEach(function (s) {
        withSession(s, function () {
          syncListItemReciteButtons();
          syncReciteButtons();
          var picker = document.getElementById("gw-recite-picker");
          if (picker && !picker.hidden) renderRecitePicker();
        });
      });
    });

    window.addEventListener("reader-read-change", function (e) {
      mounts.forEach(function (s) {
        if (s.words.readStore !== (e.detail && e.detail.store)) return;
        withSession(s, function () { onReadChange(e); });
      });
    });
  }

  function syncSettingsUI() {
    var input = $("#input-username");
    if (input) input.value = String(currentUsername()).trim().slice(0, 12);
    $$("#seg-helper-c button").forEach(function (b) {
      var on = (b.dataset.helper === "on") === helperOn();
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function openSettings() {
    var modal = document.getElementById("settings-modal");
    if (!modal) return;
    syncSettingsUI();
    modal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeSettings() {
    var modal = document.getElementById("settings-modal");
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = "";
  }

  function saveUsername(v) {
    var cfg = {};
    try {
      cfg = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {};
    } catch (e) {
      cfg = {};
    }
    if (!cfg || typeof cfg !== "object") cfg = {};
    cfg.username = String(v == null ? "" : v).trim().slice(0, 12);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(cfg));
    applyAppName();
  }

  function bindSettings() {
    var modal = document.getElementById("settings-modal");
    if (!modal) return;
    $$("[data-settings-close]").forEach(function (el) {
      el.addEventListener("click", closeSettings);
    });
    var input = $("#input-username");
    if (input) {
      input.addEventListener("change", function () {
        input.value = String(currentUsername()).trim().slice(0, 12);
        saveUsername(input.value);
      });
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); input.blur(); }
      });
    }
    $$("#seg-helper-c button").forEach(function (b) {
      b.addEventListener("click", function () {
        setHelperOn(b.dataset.helper === "on");

        localStorage.setItem(PINYIN_KEY, helperOn() ? DEFAULT_PINYIN_MODE : "off");
        renderReaderText();
        syncPinyinButton();
        syncSettingsUI();
        showToast(helperOn() ? "阅读辅助已开启：打开即自动注音" : "阅读辅助已关闭：打开为纯文本");
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) closeSettings();
    });
  }

  var mounts = [];

  function activeMount() {
    for (var i = 0; i < mounts.length; i++) {
      if (mounts[i].api && mounts[i].api.isOpen()) return mounts[i].api;
    }
    return null;
  }

  function unmount(rootEl) {
    var target = null;
    for (var i = mounts.length - 1; i >= 0; i--) {
      if (!rootEl || mounts[i].root === rootEl) { target = mounts[i]; break; }
    }
    if (!target) return false;
    if (target.api && target.api.isOpen()) withSession(target, function () { closeReader(); });
    mounts.splice(mounts.indexOf(target), 1);
    if (window.ReaderEngine.current === target.api) window.ReaderEngine.current = null;
    return true;
  }

  function mount(config) {
    var cfg = config || {};

    if ((!cfg.items || !cfg.items.length) && !cfg.allowEmpty) return null;
    var rootSel = cfg.root || "[data-gw-root]";
    var rootEl = typeof rootSel === "string" ? document.querySelector(rootSel) : rootSel;
    if (!rootEl) return null;

    for (var i = 0; i < mounts.length; i++) {
      if (mounts[i].root === rootEl && mounts[i].cfg === cfg) return mounts[i];
    }

    var previous = live;
    var session = {
      root: rootEl,
      box: (cfg.reader ? (typeof cfg.reader === "string" ? document.querySelector(cfg.reader) : cfg.reader) : null) || document.querySelector("[data-gw-reader]"),
      cfg: cfg,
      words: Object.assign({}, DEFAULT_WORDS, cfg.words || {}),

      src: cfg.items.slice(),
      items: cfg.items.map(function (p) { return canonicalOf(p, cfg.id); }),
      byId: {},
      current: null,
      keyword: "",
      filter: cfg.initialFilter || "all",
      autoReading: false,
      speakingTarget: "原文",
      listEl: null,
      transBox: null,
      domBound: false,
      listeners: []
    };
    session.items.forEach(function (p) { session.byId[p.id] = p; });

    liveTo(session);
    if (W.version) {

      localStorage.setItem("poem_classic_words_" + W.version, "1");
    }
    init(session);

    session.api = {
      id: cfg.id || "gw",
      words: session.words,
      total: function () { return session.items.length; },
      visible: function () { return withSession(session, function () { return visibleItems().length; }); },
      isOpen: function () { return withSession(session, function () { var el = rd("reader"); return !!el && !el.hidden; }); },
      open: function (id) { withSession(session, function () { var p = byId(id); if (p) openReader(p); }); },
      close: function () { withSession(session, function () { closeReader(); }); },
      align: function () { return alignMode(); },
      setAlign: function (m) { return withSession(session, function () { return setAlign(m); }); },
      setKeyword: function (kw) { withSession(session, function () { keyword = String(kw == null ? "" : kw); renderList(); }); },

      hideReader: function () { return withSession(session, hideReader); },

      refreshCanonical: function () {
        return withSession(session, function () {

          var source = session.src || session.items;
          var book = session.cfg && session.cfg.id;
          var arr = source.map(function (p) { return canonicalOf(p, book); });
          session.items = arr;
          session.byId = {};
          arr.forEach(function (p) { session.byId[p.id] = p; });
          items = arr;
          itemsById = session.byId;
          if (current) {
            var now = itemsById[current.id];
            if (now) current = now;
          }
          var box = rd("reader");
          if (current && box && !box.hidden) {

            renderReaderText();
            var tt = box.querySelector(".rd-trans-text, #rd-trans-text");
            if (tt) tt.textContent = current.translation || W.pendingTranslation;
          }
          renderList();
          return arr.length;
        });
      },

      setItems: function (list) {
        return withSession(session, function () {
          var arr = (list || []).slice();
          session.items = arr;
          session.byId = {};
          arr.forEach(function (p) { session.byId[p.id] = p; });
          items = arr;
          itemsById = session.byId;
          if (current && !itemsById[current.id]) closeReader();
          renderList();
          syncRandomReadButton();
        });
      },
      annotate: function () { return withSession(session, function () { return window.Pinyin ? window.Pinyin.annotateHtml(current ? current.text : "") : ""; }); },
      onSpeechStopped: function () { withSession(session, handleSpeechStopped); },
      root: rootEl,
      box: session.box,
      cfg: cfg
    };
    mounts.push(session);
    window.ReaderEngine.current = session.api;

    if (previous) liveTo(previous);
    return session.api;
  }

  function withSession(session, fn) {
    var prev = live;
    stash(prev);
    liveTo(session);
    var out;
    try {
      out = fn();
    } finally {
      stash(session);
      if (prev && prev !== session) liveTo(prev);
      else enterLive();
    }
    return out;
  }

  function init(session) {
    var s = session || live;

    if (CFG.setTitle !== false) applyAppName();

    if (!s.domBound) {
      s.domBound = true;
      bindEvents();
      bindSettings();
      bindGlobal();
    }

    if (!items.length) {
      var listEl = listBox();
      if (listEl) listEl.innerHTML = '<div class="empty">' +
        esc(CFG.allowEmpty ? W.empty : W.loadingFailed) + "</div>";
      return;
    }
    renderList();
    syncAlignButtons();
    syncRandomReadButton();

    if (window.ReciteCollections && window.ReciteCollections.refreshSnapshots) {
      window.ReciteCollections.refreshSnapshots(window.SITE_INDEX || []);
    }

    if (session.api && session.api.refreshCanonical) session.api.refreshCanonical();
  }

  function reciteState(p) {
    if (!p || !window.ReciteCollections) return { in: false, collections: [] };
    var cols = window.ReciteCollections.collectionsOf(p.id);
    return { in: cols.length > 0, collections: cols };
  }

  function reciteGlyph() {

    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M7 4.6h10a1.4 1.4 0 0 1 1.4 1.4v13.4l-6.4-4.1-6.4 4.1V6a1.4 1.4 0 0 1 1.4-1.4Z"/>' +
      "</svg>";
  }

  function reciteItemBtn(p) {
    var on = reciteState(p).in;
    var label = on ? W.reciteIn : W.reciteAdd;
    return '<button type="button" class="item-recite" data-recite="' + esc(p.id) + '"' +
      ' data-on="' + (on ? "1" : "0") + '"' +
      ' title="' + esc(label) + '" aria-label="' + esc(p.title) + "：" + esc(label) + '"' +
      ' aria-pressed="' + (on ? "true" : "false") + '">' + reciteGlyph() + "</button>";
  }

  function syncListItemReciteButtons() {
    $$(".item-recite", listBox()).forEach(function (b) {
      var id = b.getAttribute("data-recite");
      var p = itemsById[id];
      if (!p) return;
      var on = reciteState(p).in;
      b.dataset.on = on ? "1" : "0";
      var label = on ? W.reciteIn : W.reciteAdd;
      b.title = label;
      b.setAttribute("aria-label", p.title + "：" + label);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function syncReciteButtons() {
    var btn = rd("recite");
    if (!btn) return;
    if (!current || !window.ReciteCollections) {
      btn.hidden = true;
      return;
    }
    btn.hidden = false;
    var on = reciteState(current).in;
    btn.classList.toggle("is-in", on);
    btn.dataset.on = on ? "1" : "0";
    var label = on ? W.reciteIn : W.reciteAdd;
    btn.title = label;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    var lab = btn.querySelector(".sr-only");
    if (lab) lab.textContent = label;
    syncListItemReciteButtons();
  }

  function openRecitePicker(p) {
    if (!p || !window.ReciteCollections) return;
    var C = window.ReciteCollections;
    var cols = C.list();
    var inCols = {};
    C.collectionsOf(p.id).forEach(function (c) { inCols[c.id] = true; });

    var wrap = document.getElementById("gw-recite-picker");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "gw-recite-picker";
      wrap.className = "modal recite-picker";
      wrap.hidden = true;
      wrap.innerHTML =
        '<div class="modal-mask" data-recite-close="1"></div>' +
        '<div class="modal-box small" role="dialog" aria-modal="true" aria-label="加入背诵">' +
        '<button type="button" class="modal-close" data-recite-close="1" aria-label="关闭">✕</button>' +
        '<div class="modal-head"><h2>加入背诵</h2>' +
        '<div class="recite-sub" id="gw-recite-sub"></div></div>' +
        '<div class="recite-cols" id="gw-recite-cols"></div>' +
        '<div class="recite-new">' +
        '<input id="gw-recite-new" class="settings-input" type="text" maxlength="12" ' +
        'placeholder="新建集合，例如：我要背的" autocomplete="off" enterkeyhint="done" />' +
        '<button type="button" class="btn ghost-btn" id="gw-recite-create">新建</button>' +
        "</div>" +
        "</div>";
      document.body.appendChild(wrap);
      bindRecitePicker(wrap);
    }

    wrap.dataset.item = p.id;
    wrap.dataset.title = p.title;
    wrap.hidden = false;

    document.body.style.overflow = "hidden";
    renderRecitePicker();
  }

  function renderRecitePicker() {
    var wrap = document.getElementById("gw-recite-picker");
    if (!wrap || wrap.hidden) return;
    var p = itemsById[wrap.dataset.item] || current;
    var C = window.ReciteCollections;
    if (!p || !C) return;
    var cols = C.list();
    var inCols = {};
    C.collectionsOf(p.id).forEach(function (c) { inCols[c.id] = true; });

    var sub = document.getElementById("gw-recite-sub");
    if (sub) {
      var n = Object.keys(inCols).length;
      sub.textContent = "《" + p.title + "》" + (n ? "已在 " + n + " 个集合里" : "尚未加入任何集合");
    }

    var box = document.getElementById("gw-recite-cols");
    if (!box) return;
    if (!cols.length) {
      box.innerHTML = '<div class="recite-empty">还没有自选集合。在下面输入一个名字新建。</div>';
      return;
    }
    box.innerHTML = cols.map(function (c) {
      var on = !!inCols[c.id];
      return '<button type="button" class="recite-col' + (on ? " on" : "") + '"' +
        ' data-col="' + esc(c.id) + '" aria-pressed="' + (on ? "true" : "false") + '">' +
        '<span class="recite-col-tick" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17.5 19.5 7"/></svg>' +
        "</span>" +
        '<span class="recite-col-name">' + esc(c.name) + "</span>" +
        '<span class="recite-col-count">' + c.items.length + " 篇</span>" +
        "</button>";
    }).join("");
  }

  function closeRecitePicker() {
    var wrap = document.getElementById("gw-recite-picker");
    if (!wrap) return;
    wrap.hidden = true;
    document.body.style.overflow = "";
  }

  function bindRecitePicker(wrap) {
    wrap.addEventListener("click", function (e) {
      var t = e.target;
      if (t.closest && t.closest("[data-recite-close]")) {
        closeRecitePicker();
        return;
      }
      var colBtn = t.closest ? t.closest("[data-col]") : null;
      if (colBtn) {
        var p = itemsById[wrap.dataset.item] || current;
        var C = window.ReciteCollections;
        if (!p || !C) return;
        var cid = colBtn.getAttribute("data-col");
        var was = C.collectionsOf(p.id).some(function (c) { return c.id === cid; });
        if (was) {
          C.removeItem(p.id, cid);
          showToast("已移出「" + (C.get(cid) ? C.get(cid).name : "") + "」的背诵清单");
        } else {
          C.add(p.id, cid);
          stashSnapshot(p);
          showToast("已加入「" + (C.get(cid) ? C.get(cid).name : "") + "」，会排进每日任务");
        }
        renderRecitePicker();
        syncReciteButtons();
        return;
      }
      if (t.id === "gw-recite-create") {
        var input = document.getElementById("gw-recite-new");
        var name = input ? input.value : "";
        var p2 = itemsById[wrap.dataset.item] || current;
        var C2 = window.ReciteCollections;
        if (!p2 || !C2) return;
        var col = C2.create(name);
        C2.add(p2.id, col.id);
        stashSnapshot(p2);
        if (input) input.value = "";
        renderRecitePicker();
        syncReciteButtons();
        showToast("已新建「" + col.name + "」并加入这一篇");
      }
    });
    var input = document.getElementById("gw-recite-new");
    if (input) {
      input.addEventListener("keydown", function (e) {
        if (e.key !== "Enter") return;
        e.preventDefault();
        var btn = document.getElementById("gw-recite-create");
        if (btn) btn.click();
      });
    }
  }

  function stashSnapshot(p) {
    if (!p || !window.ReciteCollections || !p.text) return;
    var snap = {
      title: p.title, author: p.author || "", authorName: p.authorName || "",
      dynasty: p.dynasty || "", source: p.source || "", selection: p.selection || "",
      book: p.book || "", bookName: p.bookName || "", page: p.page || "",
      text: p.text || "", translation: p.translation || "",
      translationSource: p.translationSource
    };
    var idx = (window.SITE_INDEX || []).slice();
    if (!idx.some(function (x) { return x.id === p.id; })) idx.push(Object.assign({ id: p.id }, snap));
    window.ReciteCollections.refreshSnapshots(idx);
  }

  function startRecite(p) {
    if (!p) return;
    if (!window.ReciteCollections) {
      showToast("本机不支持自选集合");
      return;
    }
    var C = window.ReciteCollections;
    if (!C.list().length) {
      var col = C.create("");
      C.add(p.id, col.id);
      stashSnapshot(p);
      syncReciteButtons();
      showToast("已新建「" + col.name + "」并加入这一篇");
      return;
    }
    openRecitePicker(p);
  }

  window.ReaderEngine = {
    mount: mount,
    unmount: unmount,
    active: activeMount,
    words: DEFAULT_WORDS,
    totalItems: function () { return items.length; }
  };

  window.ClassicProse = {
    isRead: function (id) { return isRead(id); },
    align: function () { return alignMode(); },
    setAlign: function (m) { return setAlign(m); },
    annotate: function () { return window.Pinyin ? window.Pinyin.annotateHtml(current ? current.text : "") : ""; },

    onSpeechStopped: handleSpeechStopped
  };

})();
