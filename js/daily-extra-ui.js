(function () {
  "use strict";

  var SUGGEST_MAX = 8;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function mod() {
    return (typeof window !== "undefined" && window.DailyExtra) || null;
  }

  function has(p) {
    var D = mod();
    if (!D || !p || !p.id) return false;
    try { return D.has(p); } catch (e) { return false; }
  }

  function add(p) {
    var D = mod();
    if (!D || !p || !p.id) return { ok: false, code: "E_UNAVAILABLE" };
    try { return D.add(p); } catch (e) { return { ok: false, code: "E_STORAGE" }; }
  }

  function remove(p) {
    var D = mod();
    if (!D || !p || !p.id) return false;
    try { return D.remove(p); } catch (e) { return false; }
  }

  function glyph() {
    return '<svg class="de-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 5.4v13.2M5.4 12h13.2"/></svg>' +
      '<svg class="de-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M5 12.5 10 17.5 19.5 7"/></svg>';
  }

  var STATE_WORDS = {
    add: "加入今日背诵",
    in: "已加入今日背诵",

    remove: "移出今日背诵"
  };

  function stateOf(p) { return has(p) ? "in" : "add"; }

  function labelOf(p) {
    var st = stateOf(p);
    return st === "in" ? STATE_WORDS.in : STATE_WORDS.add;
  }

  function itemBtn(p, opts) {
    var o = opts || {};
    var on = has(p);
    var state = o.state === false ? null : stateOf(p);
    var label = state === "in" ? STATE_WORDS.in : STATE_WORDS.add;
    var cls = "item-daily" + (o.last ? " is-last" : "");
    return '<button type="button" class="' + cls + '" data-daily="' + esc(p.id) + '"' +
      ' data-on="' + (on ? "1" : "0") + '"' +
      ' title="' + esc(on ? STATE_WORDS.remove : label) + '"' +
      ' aria-label="' + esc(p.title || "") + "：" + esc(on ? STATE_WORDS.remove : label) + '"' +
      ' aria-pressed="' + (on ? "true" : "false") + '">' + glyph() + "</button>";
  }

  function detailBtn(p) {
    var on = has(p);
    var label = on ? STATE_WORDS.in : STATE_WORDS.add;
    return '<button type="button" class="mini-btn daily-btn" id="gw-daily" data-daily-detail="1" ' +
      'data-on="' + (on ? "1" : "0") + '" aria-pressed="' + (on ? "true" : "false") + '" ' +
      'title="' + esc(on ? STATE_WORDS.remove : label) + '">' +
      '<span class="btn-icon" aria-hidden="true">' + glyph() + "</span>" +
      '<span class="sr-only" data-daily-label="1">' + esc(label) + "</span>" +
      "</button>";
  }

  function syncOne(btn, p) {
    var on = has(p);
    btn.dataset.on = on ? "1" : "0";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    var label = on ? STATE_WORDS.in : STATE_WORDS.add;

    btn.title = on ? STATE_WORDS.remove : label;
    if (btn.hasAttribute && btn.hasAttribute("aria-label")) {
      btn.setAttribute("aria-label", (p.title || "") + "：" + (on ? STATE_WORDS.remove : label));
    }
    var text = btn.querySelector("[data-daily-label]");
    if (text) text.textContent = label;
  }

  function lookup(id) {
    if (!id) return null;
    var list = window.SITE_INDEX || [];
    for (var i = 0; i < list.length; i += 1) {
      if (list[i] && list[i].id === id) return list[i];
    }
    var books = ["POEMS_ALL", "POEMS_CLASSIC", "POEMS_TANGSHI", "POEMS_SONGCI",
      "POEMS_GUWEN", "POEMS_ZHAOMING"];
    for (var b = 0; b < books.length; b += 1) {
      var l = window[books[b]] || [];
      for (var j = 0; j < l.length; j += 1) {
        var p = l[j];
        if (!p || !p.id) continue;
        if (p.id === id || (books[b] + "-" + p.id) === id) return p;
      }
    }
    return null;
  }

  function toggle(p) {
    if (!p || !p.id) return { ok: false, on: false };
    if (has(p)) {
      remove(p);
      return { ok: true, on: false, message: "已移出今日背诵" };
    }
    var r = add(p);
    if (!r.ok && r.code === "E_LIMIT") {
      return { ok: false, on: false,
        message: "今天已经加了 " + r.limit + " 首，够多了 —— 先背完再加" };
    }
    if (!r.ok) {
      return { ok: false, on: false, message: "加不进去：本机存储用不了（换一个浏览器试试）" };
    }
    return { ok: true, on: true, message: "已加入今日背诵：今天要背的就多这一首" };
  }

  function matchScore(p, q) {
    var title = String(p.title || "").toLowerCase();
    var author = String(p.author || "").toLowerCase();
    var rest = [p.bookName, p.source, p.selection, p.dynasty, p.gradeGroup, p.authorName]
      .join(" ").toLowerCase();
    var body = [p.text, p.translation].join(" ").toLowerCase();
    if (title.indexOf(q) >= 0) return 4;
    if (author.indexOf(q) >= 0) return 3;
    if (rest.indexOf(q) >= 0) return 2;
    if (body.indexOf(q) >= 0) return 1;
    return 0;
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

  function suggestOf(kw) {
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

  function metaOf(p) {
    var parts = [];
    if (p.dynasty) parts.push(p.dynasty);
    if (p.author) parts.push(p.author);
    var left = parts.length ? esc(parts.join(" · ")) : "";
    if (!p.bookName) return left;
    return left + (left ? " · " : "") + "<em>" + esc(p.bookName) + "</em>";
  }

  function bindSuggest(opt) {
    var o = opt || {};
    var input = typeof o.input === "string" ? document.querySelector(o.input) : o.input;
    var box = typeof o.box === "string" ? document.querySelector(o.box) : o.box;
    if (!input || !box) return null;

    var index = -1;
    var items = [];

    function paint(kw) {
      items = suggestOf(kw);
      index = -1;
      if (!items.length) {
        box.hidden = true;
        box.innerHTML = "";
        box.dataset.items = "";
        input.setAttribute("aria-expanded", "false");
        return;
      }
      box.innerHTML = items.map(function (p, i) {
        var on = has(p);
        var label = on ? STATE_WORDS.in : STATE_WORDS.add;
        return '<div class="suggest-row" data-suggest="' + i + '">' +
          '<button type="button" class="suggest-add" data-daily-suggest="' + i + '" ' +
          'data-on="' + (on ? "1" : "0") + '" aria-pressed="' + (on ? "true" : "false") + '" ' +
          'title="' + esc(on ? STATE_WORDS.remove : label) + '" ' +
          'aria-label="' + esc(p.title) + "：" + esc(on ? STATE_WORDS.remove : label) + '">' +
          glyph() + "</button>" +
          '<button type="button" class="suggest-item" data-suggest-open="' + i + '" ' +
          'role="option" aria-selected="' + (i === index ? "true" : "false") + '">' +
          '<span class="suggest-title">' + esc(p.title) + "</span>" +
          '<span class="suggest-meta">' + metaOf(p) + "</span></button>" +
          "</div>";
      }).join("");
      box.dataset.items = JSON.stringify(items.map(function (p) { return p.id; }));
      box.scrollTop = 0;
      box.hidden = false;
      input.setAttribute("aria-expanded", "true");
    }

    function hide() {
      box.hidden = true;
      index = -1;
      input.setAttribute("aria-expanded", "false");
    }

    function move(dir) {
      if (box.hidden || !items.length) return false;
      index += dir;
      if (index < 0) index = items.length - 1;
      if (index >= items.length) index = 0;
      Array.prototype.forEach.call(box.querySelectorAll(".suggest-item"), function (el, i) {
        el.classList.toggle("active", i === index);
        el.setAttribute("aria-selected", i === index ? "true" : "false");
      });
      return true;
    }

    function fire(p, act) {
      if (!p) return;
      var r = act === "remove"
        ? { ok: remove(p), on: false, message: "已移出今日背诵" }
        : toggle(p);
      if (typeof o.onToast === "function" && r.message) o.onToast(r.message);
      if (r.ok !== false && typeof o.onChange === "function") o.onChange(p, !!r.on);

      refreshStates();
      paint(input.value);
    }

    function refreshStates() {

      if (box.hidden) return;
      Array.prototype.forEach.call(box.querySelectorAll("[data-daily-suggest]"), function (btn) {
        var i = Number(btn.getAttribute("data-daily-suggest"));
        var p = items[i];
        if (!p) return;
        var on = has(p);
        btn.dataset.on = on ? "1" : "0";
        btn.setAttribute("aria-pressed", on ? "true" : "false");
        btn.title = on ? STATE_WORDS.remove : STATE_WORDS.add;
      });
    }

    input.addEventListener("input", function () { paint(input.value); });
    input.addEventListener("focus", function () {
      if (input.value.trim()) paint(input.value);
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") {
        if (move(1)) e.preventDefault();
      } else if (e.key === "ArrowUp") {
        if (move(-1)) e.preventDefault();
      } else if (e.key === "Enter") {
        if (index >= 0 && items[index]) {
          fire(items[index], "add");
          e.preventDefault();
        } else {
          hide();
        }
      } else if (e.key === "Escape") {
        hide();
      }
    });
    input.addEventListener("blur", function () {
      setTimeout(function () {
        if (document.activeElement === input) return;
        if (box.contains(document.activeElement)) return;
        hide();
      }, 180);
    });

    box.addEventListener("mousedown", function (e) {

      e.preventDefault();
    });
    box.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest("[data-daily-suggest]")) {
        var addBtn = t.closest("[data-daily-suggest]");
        var i = Number(addBtn.getAttribute("data-daily-suggest"));
        var p = items[i];
        fire(p, has(p) ? "remove" : "add");
        return;
      }
      var openBtn = t.closest("[data-suggest-open]");
      if (!openBtn || typeof o.onOpen !== "function") return;
      var j = Number(openBtn.getAttribute("data-suggest-open"));
      if (items[j]) o.onOpen(items[j]);
      hide();
    });

    return {
      items: function () { return items.slice(); },
      paint: paint,
      hide: hide,
      refresh: refreshStates,
      suggest: suggestOf
    };
  }

  window.DailyExtraUI = {
    SUGGEST_MAX: SUGGEST_MAX,
    WORDS: STATE_WORDS,
    glyph: glyph,
    has: has,
    add: add,
    remove: remove,
    toggle: toggle,
    stateOf: stateOf,
    labelOf: labelOf,
    itemBtn: itemBtn,
    detailBtn: detailBtn,
    syncOne: syncOne,
    lookup: lookup,
    allItems: allItems,
    suggest: suggestOf,
    bindSuggest: bindSuggest
  };
})();
