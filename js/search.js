(function () {
  "use strict";

  var SLASH_KEYS = ["/", "／"];

  var SUGGEST_MAX = 8;

  var SUGGEST_ROWS = 5;
  var SUGGEST_ROW_H = 44;

  var KB_MIN = 120;

  var FOCUS_LIFT_DELAY = 250;

  var BLUR_SETTLE_DELAY = 220;

  var SUGGEST_BLUR_DELAY = 180;

  var KEYWORD_HOLD_DELAY = 800;

  var SCROLL_HIDE_DELAY = 140;

  var EMPTY_IDLE = "输入篇名、作者或诗句，即可搜遍全部集子";
  var EMPTY_MISS = "没有找到匹配的篇目";

  var api = null;
  var suggestIndex = -1;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function allItems() {
    var list = (window.SITE_INDEX || []).filter(function (p) { return !p.isBook; });

    if (!window.WorksIndex) return list;

    var out = [];
    var slotOf = {};
    list.forEach(function (p) {
      var wid = window.WorksIndex.widOf(p.id);
      var rep = window.WorksIndex.repOf(p.id);
      if (slotOf[wid] === undefined) {
        slotOf[wid] = out.length;
        out.push(p);
        return;
      }

      if (rep === p.id) out[slotOf[wid]] = p;
    });
    return out;
  }

  function suggestBox() { return document.getElementById("search-suggest"); }

  function matchScore(p, q) {
    var title = String(p.title || "").toLowerCase();
    var author = String(p.author || "").toLowerCase();
    var rest = [p.bookName, p.source, p.selection, p.dynasty, p.gradeGroup, p.authorName].join(" ").toLowerCase();
    var body = [p.text, p.translation].join(" ").toLowerCase();
    if (title.indexOf(q) >= 0) return 4;
    if (author.indexOf(q) >= 0) return 3;
    if (rest.indexOf(q) >= 0) return 2;
    if (body.indexOf(q) >= 0) return 1;
    return 0;
  }

  function suggestItems(kw) {
    var q = String(kw || "").trim().toLowerCase();
    if (!q) return [];
    var hit = allItems().filter(function (p) { return matchScore(p, q) > 0; });
    hit.sort(function (a, b) {
      var sa = matchScore(a, q);
      var sb = matchScore(b, q);
      if (sa !== sb) return sb - sa;
      return String(a.title).length - String(b.title).length;
    });
    return hit.slice(0, SUGGEST_MAX);
  }

  function suggestMeta(p) {
    var parts = [];
    if (p.dynasty) parts.push(p.dynasty);
    if (p.author) parts.push(p.author);
    var left = parts.length ? esc(parts.join(" · ")) : "";
    if (!p.bookName) return left;
    return left + (left ? " · " : "") + "<em>" + esc(p.bookName) + "</em>";
  }

  function renderSuggest(kw) {
    var box = suggestBox();
    if (!box) return;
    var list = suggestItems(kw);
    suggestIndex = -1;
    if (!list.length) {
      box.hidden = true;
      box.innerHTML = "";
      box.dataset.items = "";
      setExpanded(false);
      return;
    }
    box.innerHTML = list.map(function (p, i) {
      return '<button type="button" class="suggest-item" role="option" data-suggest="' + i + '"' +
        ' aria-selected="false">' +
        '<span class="suggest-title">' + esc(p.title) + "</span>" +
        '<span class="suggest-meta">' + suggestMeta(p) + "</span></button>";
    }).join("");
    box.dataset.items = JSON.stringify(list.map(function (p) { return p.id; }));

    box.scrollTop = 0;
    box.hidden = false;
    setExpanded(true);
  }

  function setExpanded(on) {
    var input = document.getElementById("gw-search");
    if (input) input.setAttribute("aria-expanded", on ? "true" : "false");
  }

  function hideSuggest() {
    var box = suggestBox();
    if (!box) return;
    box.hidden = true;
    suggestIndex = -1;
    setExpanded(false);
  }

  function moveSuggest(dir) {
    var box = suggestBox();
    if (!box || box.hidden) return false;
    var items = box.querySelectorAll(".suggest-item");
    if (!items.length) return false;
    suggestIndex += dir;
    if (suggestIndex < 0) suggestIndex = items.length - 1;
    if (suggestIndex >= items.length) suggestIndex = 0;
    for (var i = 0; i < items.length; i++) {
      var on = i === suggestIndex;
      items[i].classList.toggle("active", on);
      items[i].setAttribute("aria-selected", on ? "true" : "false");
    }
    return true;
  }

  function suggestIds() {
    var box = suggestBox();
    if (!box || !box.dataset.items) return [];
    try { return JSON.parse(box.dataset.items) || []; } catch (e) { return []; }
  }

  function pickSuggest(i) {
    var ids = suggestIds();
    if (i < 0 || i >= ids.length) return false;
    noteSearchAction();
    if (api) api.open(ids[i]);
    hideSuggest();
    return true;
  }

  var kdTimer = 0;
  var kdPending = null;

  function storage() { return window.Storage || null; }

  function readKeyword() {
    var st = storage();
    if (!st || !st.getSearchKeyword) return "";
    try { return String(st.getSearchKeyword() || ""); } catch (e) { return ""; }
  }

  function writeKeyword(kw) {
    var st = storage();
    if (!st || !st.setSearchKeyword) return;
    try { st.setSearchKeyword(String(kw == null ? "" : kw)); } catch (e) {  }
  }

  function noteKeyword(kw) {
    kdPending = String(kw == null ? "" : kw);
    clearTimeout(kdTimer);
    kdTimer = setTimeout(function () {
      kdTimer = 0;
      var v = kdPending;
      kdPending = null;
      writeKeyword(v);
    }, KEYWORD_HOLD_DELAY);
  }

  function onLiftLost() {
    if (kdPending === null) return;
    var v = kdPending;
    kdPending = null;
    clearTimeout(kdTimer);
    kdTimer = 0;
    writeKeyword(v);
  }

  function renderBody() {
    var input = document.getElementById("gw-search");
    var kw = input ? input.value : "";
    var q = String(kw == null ? "" : kw).trim();

    syncHeroState();
    if (api) {

      api.setItems(q ? allItems() : []);
      api.setKeyword(q);
    }
    annotateMatches(q);
    syncEmptyState(q);

    noteKeyword(q);
  }

  function syncEmptyState(q) {
    var listEl = document.querySelector("#gw-list");
    if (!listEl) return;
    var empty = listEl.querySelector(".empty");
    if (!empty) return;

    empty.textContent = q ? EMPTY_MISS : "";

    alignEmptyState(true);
    syncEmptySpacer(empty, !!q);
  }

  function syncEmptySpacer(empty, q) {
    if (!empty || !empty.dataset) return;
    empty.dataset.empty = q ? "miss" : "idle";
  }

  function annotateMatches(kw) {
    var q = String(kw || "").trim();
    var listEl = document.querySelector("#gw-list");
    if (!listEl || !q) return;
    listEl.querySelectorAll(".item").forEach(function (el) {
      var id = el.dataset.id;
      var p = allItems().filter(function (x) { return x.id === id; })[0];
      if (!p) return;
      var ctx = matchContext(p, q);
      if (!ctx) return;
      var meta = el.querySelector(".item-meta");
      if (!meta) return;
      var old = meta.querySelector(".item-hit");
      if (old) old.parentNode.removeChild(old);
      meta.insertAdjacentHTML("beforeend", '<span class="item-hit">…' + esc(ctx) + "…</span>");
    });
  }

  function matchContext(p, q) {
    var i = String(p.text || "").toLowerCase().indexOf(q.toLowerCase());
    var src = p.text || "";
    if (i < 0) {
      src = p.translation || "";
      i = String(src).toLowerCase().indexOf(q.toLowerCase());
    }
    if (i < 0) return "";
    var a = Math.max(0, i - 12);
    var b = Math.min(src.length, i + q.length + 12);
    return src.slice(a, b).replace(/\s/g, "");
  }

  function keyboardSpace() {
    var vv = window.visualViewport;
    if (!vv) return 0;
    var layoutH = window.innerHeight || vv.height;
    var space = layoutH - vv.height - (vv.offsetTop || 0);
    return space > KB_MIN ? Math.round(space) : 0;
  }

  function keyboardVisible() {
    var vv = window.visualViewport;
    if (!vv || !vv.height) return 0;
    return Math.round(vv.height);
  }

  function heroEl() { return document.getElementById("search-hero"); }

  function hasKeyword() {
    var input = document.getElementById("gw-search");
    return !!input && !!String(input.value || "").trim();
  }

  var searchedThisVisit = false;

  function noteSearchAction() {
    if (searchedThisVisit) return;
    searchedThisVisit = true;
    syncHeroState();
  }

  function syncHeroState() {
    var hero = heroEl();
    if (!hero) return;
    var input = document.getElementById("gw-search");
    var focused = !!input && document.activeElement === input;
    var space = keyboardSpace();

    var lifted = focused || space > 0 || searchedThisVisit;
    setLift(lifted, onLiftLost);
    try {
      hero.classList.toggle("search-active", lifted);
      hero.classList.toggle("kb-open", lifted);
    } catch (e) {  }

    hero.style.setProperty("--kb-space", space + "px");
    var visible = keyboardVisible();
    var box = suggestBox();
    if (visible > 0) {
      hero.style.setProperty("--kb-visible", visible + "px");
      if (box) box.style.setProperty("--kb-visible", visible + "px");
    }
    if (box) box.style.setProperty("--kb-space", space + "px");

    hero.style.setProperty("--suggest-rows", String(SUGGEST_ROWS));
    hero.style.setProperty("--suggest-row-h", SUGGEST_ROW_H + "px");
    if (box) {
      box.style.setProperty("--suggest-rows", String(SUGGEST_ROWS));
      box.style.setProperty("--suggest-row-h", SUGGEST_ROW_H + "px");
    }

    alignEmptyState(lifted);
  }

  function alignEmptyState(on) {
    var empty = document.querySelector("#gw-list .empty");
    if (!empty) return;
    try { empty.classList.toggle("search-empty", on); } catch (e) {  }
  }

  var lift = { on: false, cb: null };
  function setLift(on, cb) {
    var changed = lift.on !== !!on;
    lift.on = !!on;
    if (cb) lift.cb = cb;
    if (changed && !lift.on && lift.cb) lift.cb();
  }

  function bindLightFocus() {
    var input = document.getElementById("gw-search");
    if (!input) return;

    input.addEventListener("pointerdown", function () {
      setLift(true);
      syncHeroState();
      setTimeout(syncHeroState, 0);
    });
  }

  function bindSlashKey() {
    document.addEventListener("keydown", function (e) {
      if (SLASH_KEYS.indexOf(e.key) < 0) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.defaultPrevented) return;
      var input = document.getElementById("gw-search");
      if (!input) return;
      var t = e.target;
      if (t === input) return;
      var tag = t && t.tagName ? String(t.tagName).toLowerCase() : "";
      var typing = tag === "input" || tag === "textarea" || tag === "select" ||
        (t && t.isContentEditable);
      if (typing) return;
      e.preventDefault();
      try { input.focus({ preventScroll: true }); } catch (err) {  }
      setLift(true);
      syncHeroState();
    });
  }

  function bindKeyboardWatchers() {
    var input = document.getElementById("gw-search");
    var hero = heroEl();
    if (hero && input) {
      input.addEventListener("focus", function () {
        hero.classList.add("search-active");
        syncHeroState();

        setTimeout(function () {
          if (document.activeElement === input || hero.classList.contains("kb-open")) {
            hero.classList.add("kb-open");
            syncHeroState();
          }
        }, FOCUS_LIFT_DELAY);
      });
      input.addEventListener("blur", function () {

        setTimeout(function () {
          if (document.activeElement === input) return;
          if (keyboardSpace() === 0) hero.classList.remove("kb-open");

          syncHeroState();
        }, BLUR_SETTLE_DELAY);
      });
    }

    var vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", syncHeroState);
      vv.addEventListener("scroll", syncHeroState);
    }
    window.addEventListener("resize", syncHeroState);
    window.addEventListener("orientationchange", function () {

      setTimeout(syncHeroState, 300);
    });
  }

  function mountCfg() {
    return {
      id: "search",
      items: [],
      allowEmpty: true,
      root: "[data-gw-root]",
      reader: "#gw-reader",

      groupOrder: [],
      pageTitle: "搜索",
      pageSub: "全站篇目，一搜就到",
      extraFields: ["text", "translation", "bookName", "gradeGroup"],
      words: {
        list: "篇目",
        unit: "篇",
        loadingFailed: "全站篇目索引加载失败",

        empty: EMPTY_IDLE,
        matchGroup: "",
        backToList: "返回搜索结果",

        countInvalid: "全站篇目索引加载失败",

        readStore: "",
        playerTitle: "朗读",
        searchPlaceholder: "搜索篇名 / 作者 / 诗句（全站）"
      }
    };
  }

  function boot() {
    if (!window.ReaderEngine) return;
    var all = allItems();
    var listEl = document.querySelector('[data-gw="list"]');
    if (!all.length) {
      if (listEl) listEl.innerHTML = '<div class="empty">全站篇目索引加载失败</div>';
      return;
    }

    api = window.ReaderEngine.mount(mountCfg());
    if (!api) return;

    var input = document.getElementById("gw-search");

    if (input) {
      var last = readKeyword();
      if (last) input.value = last;
    }
    if (input) {
      input.addEventListener("input", function () {

        noteSearchAction();
        renderBody();
        renderSuggest(input.value);
      });
      input.addEventListener("focus", function () {
        if (input.value.trim()) renderSuggest(input.value);
      });
      input.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown") {
          if (moveSuggest(1)) e.preventDefault();
        } else if (e.key === "ArrowUp") {
          if (moveSuggest(-1)) e.preventDefault();
        } else if (e.key === "Enter") {
          if (suggestIndex >= 0 && pickSuggest(suggestIndex)) e.preventDefault();
          else hideSuggest();
        } else if (e.key === "Escape") {
          hideSuggest();
        }
      });
      input.addEventListener("blur", function () {

        setTimeout(hideSuggest, SUGGEST_BLUR_DELAY);
      });
    }

    bindKeyboardWatchers();
    bindLightFocus();
    bindSlashKey();

    var box = suggestBox();
    if (box) {
      box.addEventListener("mousedown", function (e) {

        var btn = e.target.closest ? e.target.closest("[data-suggest]") : null;
        if (!btn) return;
        e.preventDefault();
        pickSuggest(parseInt(btn.getAttribute("data-suggest"), 10));
      });
    }

    bindSuggestDismiss();

    window.addEventListener("pagehide", onLiftLost);

    renderBody();
    syncHeroState();
  }

  function bindSuggestDismiss() {
    var listEl = document.querySelector("#gw-list");
    if (listEl) {
      var timer = 0;
      listEl.addEventListener("scroll", function () {
        var box = suggestBox();
        if (!box || box.hidden) return;
        clearTimeout(timer);
        timer = setTimeout(hideSuggest, SCROLL_HIDE_DELAY);
      }, { passive: true });

      listEl.addEventListener("click", function (e) {
        var box = suggestBox();
        if (!box || box.hidden) return;

        var t = e.target;
        if (t && t.closest && t.closest(".item-daily, .item-recite, .item-read")) return;
        hideSuggest();
        e.stopPropagation();
        e.preventDefault();
      }, true);
    }
    bindBlankTapDismiss();
  }

  function bindBlankTapDismiss() {
    function onTap(e) {
      var box = suggestBox();
      if (!box || box.hidden) return;
      var wrap = document.getElementById("site-search-wrap");
      var t = e.target;

      if (wrap && t && (t === wrap || wrap.contains(t))) return;

      if (t && t.closest && t.closest("#search-suggest")) return;
      hideSuggest();
    }
    document.addEventListener("mousedown", onTap, true);
    document.addEventListener("touchstart", onTap, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.SiteSearch = {
    items: function () { return allItems(); },
    suggest: function (kw) { return suggestItems(kw); },

    keyword: function () {
      var input = document.getElementById("gw-search");
      return input ? input.value : "";
    },

    storedKeyword: function () { return readKeyword(); }
  };
})();
