/**
 * 课外必背小古文 · 学习库
 * ---------------------------------------------------
 * 设计说明：
 * 1. 小古文篇幅长、以「读懂」为主，不适合按遗忘曲线一天排几篇，
 *    因此本页只做「列出 + 点击学习」：不生成每日任务、不做复习排期。
 * 2. 搜索 + 「全部 / 未读」筛选，快速找到想读的一篇。
 * 3. 阅读用**整页阅读器**（reader），而不是卡片弹窗：
 *    长文可整屏滚动，配上字号调节，手机上读着不憋屈。
 * 4. 唯一的进度记录：localStorage 里的「已读」标记（poem_classic_read_v1）。
 */
(function () {
  "use strict";

  const $ = function (sel, root) {
    return (root || document).querySelector(sel);
  };
  const $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };
  const STORE_KEY = "poem_classic_read_v1";
  const FONT_KEY = "poem_classic_font_v1";
  const PINYIN_KEY = "poem_helper_pinyin_v1";
  const FONT_SIZES = [17, 19, 21, 23, 26];

  const MATCH_GROUP = "课外必背";

  let current = null;
  let keyword = "";
  let filter = "all";
  let pinyinOn = localStorage.getItem(PINYIN_KEY) === "1";

  /* ---------------- 进度存储（与古诗词进度相互独立） ---------------- */
  function readMap() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      return v && typeof v === "object" ? v : {};
    } catch (e) {
      return {};
    }
  }

  function isRead(id) {
    return !!readMap()[id];
  }

  function setRead(id, val) {
    const map = readMap();
    if (val) {
      const old = map[id] || {};
      map[id] = { read: true, at: old.at || Date.now(), times: (old.times || 0) + 1 };
    } else {
      delete map[id];
    }
    localStorage.setItem(STORE_KEY, JSON.stringify(map));
  }

  /* ---------------- 列表 ---------------- */
  function allItems() {
    return (window.CLASSIC_ALL || []).slice();
  }

  function visibleItems() {
    const kw = keyword.trim();
    return allItems().filter(function (p) {
      if (filter === "unread" && isRead(p.id)) return false;
      if (!kw) return true;
      return (p.title + p.source + p.author + p.dynasty).indexOf(kw) !== -1;
    });
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function renderList() {
    const box = $("#gw-list");
    const items = visibleItems();
    const total = allItems().length;
    const readCount = allItems().filter(function (p) { return isRead(p.id); }).length;

    $("#gw-count").textContent = readCount + " / " + total + " 篇";

    box.innerHTML = "";
    if (!items.length) {
      box.innerHTML = '<div class="empty">' + (allItems().length ? "没有匹配的小古文" : "小古文数据加载失败") + "</div>";
      return;
    }

    let index = 0;
    let lastGroup = "";
    items.forEach(function (p) {
      index += 1;
      if (p.gradeGroup && p.gradeGroup !== lastGroup) {
        lastGroup = p.gradeGroup;
        const head = document.createElement("div");
        head.className = "group-head";
        head.innerHTML = '<span class="group-name">' + esc(p.gradeGroup) + "</span>" +
          '<span class="group-count">' + items.filter(function (x) { return x.gradeGroup === lastGroup; }).length + " 篇</span>";
        box.appendChild(head);
      }

      const read = isRead(p.id);
      const el = document.createElement("div");
      el.className = "item" + (read ? " done" : "") + (p.gradeGroup === MATCH_GROUP ? "" : " in-book");
      el.innerHTML =
        '<div class="item-index">' + index + "</div>" +
        '<div class="item-main">' +
        '<h3 class="item-title">' + esc(p.title) +
        (read ? '<span class="item-reason read">已读</span>' : "") +
        "</h3>" +
        '<div class="item-meta"><span>' + esc(p.source) + "</span>" +
        (p.dynasty ? '<span>·</span><span>' + esc(p.dynasty) + "</span>" : "") +
        (p.author ? '<span>·</span><span>' + esc(p.author) + "</span>" : "") +
        '<span>·</span><span>' + esc(p.text.replace(/\n/g, "").slice(0, 16)) + "…</span>" +
        "</div>" +
        "</div>" +
        '<div class="item-arrow">›</div>';
      el.addEventListener("click", function () { openReader(p); });
      box.appendChild(el);
    });
  }

  /* ---------------- 阅读器 ---------------- */
  function idIndex(p) {
    const list = allItems();
    for (let i = 0; i < list.length; i++) if (list[i].id === p.id) return i;
    return -1;
  }

  function openReader(p) {
    current = p;
    const idx = idIndex(p);
    $("#rd-title").textContent = p.title;
    $("#rd-meta").innerHTML =
      '<span class="tag">' + esc(p.source) + "</span>" +
      (p.dynasty ? '<span class="tag ghost">' + esc(p.dynasty) + "</span>" : "") +
      (p.author ? '<span class="tag ghost">' + esc(p.author) + "</span>" : "");
    renderReaderText();
    $("#rd-trans-text").textContent = p.translation || "（暂未收录译文）";
    $("#gw-progress").textContent = "第 " + (idx + 1) + " / " + allItems().length + " 篇";
    $("#rd-trans").hidden = true;
    $("#rd-trans-toggle").dataset.on = "0";
    $("#rd-trans-toggle").textContent = "显示译文";
    applyFont();
    syncPinyinButton();
    syncReadButton();
    syncDoneButton();
    $("#gw-reader").hidden = false;
    document.body.classList.add("reader-open");
    window.scrollTo(0, 0);
  }

  /* ---------------- 正文渲染：生字注音 ---------------- */

  /** 按当前注音开关渲染正文。关闭时纯文本，打开时逐字标拼音 */
  function renderReaderText() {
    if (!current) return;
    const box = $("#rd-text");
    if (pinyinOn && window.Pinyin) {
      box.innerHTML = window.Pinyin.annotateHtml(current.text);
      box.classList.add("with-pinyin");
    } else {
      box.textContent = current.text;
      box.classList.remove("with-pinyin");
    }
  }

  function syncPinyinButton() {
    const btn = $("#rd-pinyin-toggle");
    btn.dataset.on = pinyinOn ? "1" : "0";
    btn.setAttribute("aria-pressed", pinyinOn ? "true" : "false");
    btn.textContent = pinyinOn ? "隐藏拼音" : "标注拼音";
  }

  function togglePinyin() {
    pinyinOn = !pinyinOn;
    localStorage.setItem(PINYIN_KEY, pinyinOn ? "1" : "0");
    renderReaderText();
    syncPinyinButton();
    showToast(pinyinOn ? "已标注拼音" : "已隐藏拼音");
  }

  /* ---------------- 正文朗读 ---------------- */

  function syncReadButton() {
    const btn = $("#rd-read-btn");
    const ok = !!(window.Speech && window.Speech.supported());
    btn.disabled = !ok;
    btn.title = ok ? "用手机语音朗读这篇古文" : "当前浏览器不支持语音朗读";
    if (!ok) {
      $("#rd-read-text").textContent = "不支持朗读";
      btn.dataset.on = "0";
      return;
    }
    const on = window.Speech.speaking();
    btn.dataset.on = on ? "1" : "0";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    $("#rd-read-text").textContent = on ? "停止朗读" : "朗读全文";
  }

  function toggleRead() {
    if (!window.Speech || !window.Speech.supported() || !current) return;
    if (window.Speech.speaking()) {
      window.Speech.stop();
      showToast("已停止朗读");
    } else {
      // 朗读时把标题与出处也读进去，孩子能听清「这是哪一篇」
      const head = [current.title, current.dynasty, current.author].filter(Boolean).join("，");
      const ok = window.Speech.speak(head + "。" + current.text);
      showToast(ok ? "开始朗读" : "朗读启动失败，请重试");
    }
    syncReadButton();
    setTimeout(syncReadButton, 60);
    setTimeout(syncReadButton, 300);
  }

  function closeReader() {
    if (window.Speech) window.Speech.stop();
    $("#gw-reader").hidden = true;
    document.body.classList.remove("reader-open");
    current = null;
    renderList();
  }

  function syncDoneButton() {
    if (!current) return;
    const read = isRead(current.id);
    const btn = $("#gw-done");
    btn.classList.toggle("is-done", read);
    $("#gw-done-text").textContent = read ? "已读" : "标记已读";
    btn.setAttribute("aria-pressed", read ? "true" : "false");
  }

  /* ---------------- 字号 ---------------- */
  function fontIdx() {
    const v = Number(localStorage.getItem(FONT_KEY));
    return FONT_SIZES.indexOf(v) === -1 ? 1 : FONT_SIZES.indexOf(v);
  }

  function applyFont() {
    $("#rd-text").style.fontSize = FONT_SIZES[fontIdx()] + "px";
  }

  function changeFont(step) {
    let i = fontIdx() + step;
    i = Math.max(0, Math.min(FONT_SIZES.length - 1, i));
    localStorage.setItem(FONT_KEY, String(FONT_SIZES[i]));
    applyFont();
  }

  function showToast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { t.hidden = true; }, 1600);
  }

  /* ---------------- 事件 ---------------- */
  function bindEvents() {
    const search = $("#gw-search");
    search.addEventListener("input", function () {
      keyword = search.value;
      renderList();
    });

    $$("[data-filter]").forEach(function (b) {
      b.addEventListener("click", function () {
        filter = b.dataset.filter;
        $$("[data-filter]").forEach(function (x) { x.classList.toggle("active", x === b); });
        renderList();
      });
    });

    $("#gw-back").addEventListener("click", closeReader);

    $("#gw-done").addEventListener("click", function () {
      if (!current) return;
      const now = isRead(current.id);
      setRead(current.id, !now);
      syncDoneButton();
      showToast(now ? "已取消「已读」" : "已标记为已读");
      $("#gw-count").textContent =
        allItems().filter(function (p) { return isRead(p.id); }).length + " / " + allItems().length + " 篇";
    });

    $("#rd-trans-toggle").addEventListener("click", function () {
      const on = this.dataset.on === "1";
      this.dataset.on = on ? "0" : "1";
      this.textContent = on ? "显示译文" : "隐藏译文";
      $("#rd-trans").hidden = on;
    });

    $("#rd-font-up").addEventListener("click", function () { changeFont(1); });
    $("#rd-font-down").addEventListener("click", function () { changeFont(-1); });

    $("#rd-pinyin-toggle").addEventListener("click", togglePinyin);
    $("#rd-read-btn").addEventListener("click", toggleRead);

    // 语音朗读结束（自然播完）后同步按钮状态
    if (window.Speech && window.Speech.supported() && window.speechSynthesis) {
      window.speechSynthesis.addEventListener("end", syncReadButton);
      window.speechSynthesis.addEventListener("cancel", syncReadButton);
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && current) closeReader();
    });

    // 列表 → 支持浏览器返回键关掉阅读器
    window.addEventListener("hashchange", function () {
      if (location.hash !== "#read" && current) closeReader();
    });
  }

  function init() {
    if (!window.CLASSIC_ALL || !window.CLASSIC_ALL.length) {
      $("#gw-list").innerHTML = '<div class="empty">小古文数据加载失败</div>';
      return;
    }
    bindEvents();
    renderList();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.ClassicProse = {
    isRead: isRead,
    total: function () { return allItems().length; },
    annotate: function () { return window.Pinyin ? window.Pinyin.annotateHtml(current ? current.text : "") : ""; }
  };
})();
