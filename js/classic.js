/**
 * 小古文 · 学习库
 * ---------------------------------------------------
 * 设计说明：
 * 1. 小古文篇幅长、以「读懂」为主，不做每日排期：本页只做「列出 + 点击学习」。
 * 2. 列表**按主题分类聚合**，不按原书目录顺序：
 *    同一类的篇目无论出自哪本书都排在一起，「蒙学经典」有几篇就显示几篇。
 * 3. 搜索 + 「全部 / 未读」筛选，快速找到想读的一篇。
 * 4. 阅读用**整页阅读器**（reader），而不是卡片弹窗：长文可整屏滚动。
 * 5. 进度只有 localStorage 里的「已读」标记（poem_classic_read_v1）。
 * 6. 阅读辅助（注音 / 朗读 / 译文 / 字号）全部用同一套「组合按钮」样式，
 *    横向排成一行，图标统一 SVG，文案走屏幕阅读器（.sr-only）。
 * 7. 朗读三处入口：
 *    · 阅读器「朗读」——读标题 + 朝代 + 作者 + 正文
 *    · 译文「朗读」——只读白话译文
 *    · 索引页 / 分组「随机连读」——随机抽一篇开读，读完自动跳下一篇（可暂停 / 停止）
 *    自动连读时会同步滚动并高亮当前篇，用户随时能接管。
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

  /* 字号五档：A- 可以一路降到 15px，照顾低龄与弱视用户 */
  const FONT_SIZES = [15, 17, 19, 21, 23];
  const DEFAULT_FONT = 17; // 默认字号降一级（原默认 19）

  /* 注音档位：off 关闭 ｜ rare 只标生字 ｜ all 全文注音 */
  const PINYIN_MODES = ["off", "rare", "all"];
  const DEFAULT_PINYIN_MODE = "rare";

  /* 阅读辅助总开关：开启时打开阅读器即自动注音 */
  function helperOn() {
    try {
      return JSON.parse(localStorage.getItem("poem_recite_settings_v1") || "{}").helper !== "off";
    } catch (e) {
      return true;
    }
  }

  /**
   * 当前应当使用的注音档位。
   *
   * 关键：总开关是「权威」。关闭时无论此前存过什么档位都返回 off，
   * 否则用户会看到「阅读辅助 = 关闭」却仍然满屏拼音（开关形同失效）。
   * 开启时优先用用户手动选过的档位，没选过才用出厂档位「只标生字」。
   */
  function effectivePinyinMode() {
    if (!helperOn()) return "off";
    const v = localStorage.getItem(PINYIN_KEY);
    // 用户在阅读器里手动选过的档位优先（含「不注音」，此时总开关会被同步关掉）
    if (PINYIN_MODES.indexOf(v) > -1) return v;
    return DEFAULT_PINYIN_MODE;
  }

  const MATCH_GROUP = "课外必背";

  let current = null;
  let keyword = "";
  let filter = "all";
  let autoReading = false;
  /**
   * 当前注音档位。兼容旧版布尔值：
   * 旧 "1" ⇒ 只标生字，"0" ⇒ 关闭。
   */
  function pinyinMode() {
    return effectivePinyinMode();
  }

  function setPinyinMode(mode) {
    const m = PINYIN_MODES.indexOf(mode) > -1 ? mode : "off";
    localStorage.setItem(PINYIN_KEY, m);
    // 两处状态必须一致：选「不注音」= 关掉阅读辅助；选「生字/全文」= 打开阅读辅助
    setHelperOn(m !== "off");
  }

  /** 写入「阅读辅助」总开关（与首页设置共用同一份 settings） */
  function setHelperOn(on) {
    let cfg = {};
    try {
      cfg = JSON.parse(localStorage.getItem("poem_recite_settings_v1") || "{}") || {};
    } catch (e) {
      cfg = {};
    }
    if (!cfg || typeof cfg !== "object") cfg = {};
    cfg.helper = on ? "on" : "off";
    localStorage.setItem("poem_recite_settings_v1", JSON.stringify(cfg));
  }

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

  /* ---------------- 数据 ---------------- */

  /**
   * 分类顺序：按「先蒙学识字 → 再故事寓言 → 再神话 → 再写人记事 → 再诸子论道」的
   * 认知顺序排，而不是照抄某一本教材的目录。
   */
  const GROUP_ORDER = [
    "蒙学经典",
    "寓言故事",
    "神话传说",
    "人物故事",
    "志人逸事",
    "治学勤读",
    "山水游记",
    "诸子论道"
  ];

  /**
   * 全部篇目，**按分类重排**。
   * 数据文件里保留原书目录顺序（便于比对教材），这里在展示层聚合：
   * 同类相邻、跨书合并，序号 1…N 连续，「蒙学经典」有几篇就列出几篇。
   */
  function allItems() {
    const list = (window.CLASSIC_ALL || []).slice();
    return list.sort(function (a, b) {
      const ia = GROUP_ORDER.indexOf(a.gradeGroup);
      const ib = GROUP_ORDER.indexOf(b.gradeGroup);
      const ra = ia === -1 ? GROUP_ORDER.length : ia;
      const rb = ib === -1 ? GROUP_ORDER.length : ib;
      if (ra !== rb) return ra - rb;
      // 同类内保持原书目录的相对次序
      return listIndexOf(a) - listIndexOf(b);
    });
  }

  /** 原始目录中的位置，用于分类内稳定排序 */
  function listIndexOf(p) {
    const list = window.CLASSIC_ALL || [];
    for (let i = 0; i < list.length; i++) if (list[i].id === p.id) return i;
    return 0;
  }

  function byId(id) {
    const list = allItems();
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function idIndex(p) {
    const list = allItems();
    for (let i = 0; i < list.length; i++) if (list[i].id === p.id) return i;
    return -1;
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

  /** 列表项右侧的播放键：播放中换成「暂停」两竖条 */
  function playGlyph() {
    return (
      '<span class="play-glyph" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24"><path d="M7.2 4.6 19.4 12 7.2 19.4Z" fill="currentColor" stroke="none" /></svg>' +
      "</span>" +
      '<span class="pause-glyph" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24"><path d="M8.2 5h2.9v14H8.2Z M12.9 5h2.9v14h-2.9Z" fill="currentColor" stroke="none" /></svg>' +
      "</span>"
    );
  }

  /** 列表里高亮所有「正在播放」的条目 */
  function syncItemPlayBtns() {
    const playing = speechSupported() && !!window.Speech.speaking();
    $$("#gw-list .item-read").forEach(function (b) {
      b.dataset.on = playing ? "1" : "0";
    });
  }

  /** 单篇播放 / 暂停：再点一次停止 */
  function readOne(p, btn) {
    if (!speechSupported()) {
      showToast("当前浏览器不支持语音朗读");
      return;
    }
    if (window.Speech.speaking()) {
      autoReading = false;
      window.Speech.stop();
      if (window.ReaderPlayer) window.ReaderPlayer.close();
      showToast("已停止朗读");
    } else {
      const ok = window.Speech.speak(speechText(p));
      showToast(ok ? "开始朗读《" + p.title + "》" : "朗读启动失败，请重试");
    }
    syncItemPlayBtns();
    syncReadButton();
    syncTransReadButton();
    syncRandomReadButton();
    setTimeout(syncItemPlayBtns, 80);
  }

  function speakGlyph(cls) {
    return (
      '<span class="' + (cls || "") + '" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M4 9.5v5h3l4.2 3.4V6.1L7 9.5H4Z" />' +
      '<path d="M15.2 9.2a4 4 0 0 1 0 5.6" />' +
      "</svg></span>"
    );
  }

  /* ---------------- 列表 ---------------- */
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
        head.innerHTML =
          '<span class="group-name">' + esc(p.gradeGroup) + "</span>" +
          '<span class="group-count">' + allItems().filter(function (x) { return x.gradeGroup === lastGroup; }).length + " 篇</span>" +
          '<button type="button" class="group-random" data-random-group="' + esc(p.gradeGroup) + '">' +
          speakGlyph() + "随机连读</button>";
        box.appendChild(head);
      }

      const read = isRead(p.id);
      const el = document.createElement("div");
      el.className = "item" + (read ? " done" : "") + (p.gradeGroup === MATCH_GROUP ? "" : " in-book");
      el.dataset.id = p.id;
      el.innerHTML =
        '<div class="item-index">' + index + "</div>" +
        '<div class="item-main">' +
        '<h3 class="item-title">' + esc(p.title) +
        (read ? '<span class="item-reason read">已读</span>' : "") +
        "</h3>" +
        '<div class="item-meta"><span>' + esc(p.source) + "</span>" +
        (p.dynasty ? "<span>·</span><span>" + esc(p.dynasty) + "</span>" : "") +
        (p.author ? "<span>·</span><span>" + esc(p.author) + "</span>" : "") +
        "<span>·</span><span>" + esc(p.text.replace(/\n/g, "").slice(0, 16)) + "…</span>" +
        "</div>" +
        "</div>" +
        '<button type="button" class="item-read" title="播放这一篇" aria-label="播放 ' + esc(p.title) + '">' +
        playGlyph() + "</button>" +
        '<div class="item-arrow">›</div>';
      el.addEventListener("click", function () { openReader(p); });
      const playBtn = el.querySelector(".item-read");
      playBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        readOne(p, playBtn);
      });
      box.appendChild(el);
    });

    // 列表里已有条目正在播放时，进入本页也要显示「暂停」态
    syncItemPlayBtns();
  }

  /** 当前正在朗读的篇目：列表滚动到可见位置并高亮 */
  function highlightItem(id) {
    const el = $("#gw-list .item[data-id='" + id + "']");
    if (!el) return;
    el.classList.add("reading");
    if (typeof el.scrollIntoView === "function") {
      try {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      } catch (e) { /* 旧内核不支持参数对象 */ }
    }
  }

  function clearHighlight() {
    $$("#gw-list .item.reading").forEach(function (el) { el.classList.remove("reading"); });
  }

  /* ---------------- 阅读器 ---------------- */
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
    syncTransButton();
    renderNav();
    applyFont();
    syncPinyinButton();
    syncReadButton();
    syncTransReadButton();
    syncDoneButton();
    $("#gw-reader").hidden = false;
    document.body.classList.add("reader-open");
    window.scrollTo(0, 0);
  }

  /** 上一篇 / 下一篇按钮：显示目标篇名，到头则禁用 */
  function renderNav() {
    if (!current) return;
    const list = allItems();
    const i = idIndex(current);
    const prev = i > 0 ? list[i - 1] : null;
    const next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
    const prevBtn = $("#rd-prev");
    const nextBtn = $("#rd-next");
    $("#rd-prev-title").textContent = prev ? prev.title : "已是第一篇";
    $("#rd-next-title").textContent = next ? next.title : "已是最后一篇";
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

  /* ---------------- 正文渲染：生字注音 ---------------- */

  function renderReaderText() {
    if (!current) return;
    const box = $("#rd-text");
    const mode = pinyinMode();
    if (mode !== "off" && window.Pinyin) {
      box.innerHTML = window.Pinyin.annotateHtml(current.text, mode === "all" ? "all" : "rare");
      box.classList.add("with-pinyin");
    } else {
      box.textContent = current.text;
      box.classList.remove("with-pinyin");
    }
  }

  function syncPinyinButton() {
    const seg = $("#rd-pinyin-seg");
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

  /* ---------------- 朗读 ---------------- */

  /** 朗读用文本：标题 + 朝代 + 作者 + 正文 */
  function speechText(p) {
    const head = [p.title, p.dynasty, p.author].filter(Boolean).join("，");
    return head + "。" + p.text;
  }

  function speechSupported() {
    return !!(window.Speech && window.Speech.supported());
  }

  function syncReadButton() {
    const btn = $("#rd-read-btn");
    if (!btn) return;
    const ok = speechSupported();
    btn.disabled = !ok;
    btn.title = ok ? "朗读本篇" : "当前浏览器不支持语音朗读";
    if (!ok) {
      btn.dataset.on = "0";
      $("#rd-read-text").textContent = "当前浏览器不支持语音朗读";
      return;
    }
    // 自动连读时不算「本篇朗读中」，避免按钮状态来回跳
    const on = !autoReading && !!window.Speech.speaking();
    btn.dataset.on = on ? "1" : "0";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    $("#rd-read-text").textContent = on ? "停止朗读" : "朗读本篇";
  }

  function toggleRead() {
    if (!speechSupported() || !current) return;
    if (window.Speech.speaking()) {
      autoReading = false;
      window.Speech.stop();
      showToast("已停止朗读");
    } else {
      const ok = window.Speech.speak(speechText(current));
      showToast(ok ? "开始朗读" : "朗读启动失败，请重试");
    }
    syncReadButton();
    setTimeout(syncReadButton, 60);
    setTimeout(syncReadButton, 300);
  }

  function syncTransReadButton() {
    const btn = $("#rd-trans-read");
    if (!btn) return;
    const ok = speechSupported();
    btn.disabled = !ok;
    btn.title = ok ? "朗读译文" : "当前浏览器不支持语音朗读";
    if (!ok) {
      btn.dataset.on = "0";
      $("#rd-trans-read-text").textContent = "当前浏览器不支持语音朗读";
      return;
    }
    const on = !autoReading && !!window.Speech.speaking();
    btn.dataset.on = on ? "1" : "0";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    $("#rd-trans-read-text").textContent = on ? "停止朗读译文" : "朗读译文";
  }

  /**
   * 译文开关按钮：只换图标与配色，可见文案由图标表达，
   * 文字信息给读屏软件（「显示译文 / 隐藏译文」）。
   */
  function syncTransButton() {
    const btn = $("#rd-trans-toggle");
    if (!btn) return;
    const on = btn.dataset.on === "1";
    btn.dataset.on = on ? "1" : "0";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.title = on ? "隐藏译文" : "显示译文";
    $("#rd-trans-text").textContent = on ? "隐藏译文" : "显示译文";
  }

  /** 白话译文朗读：只读译文，不读原文 */
  function toggleTransRead() {
    if (!speechSupported() || !current) return;
    if (window.Speech.speaking()) {
      window.Speech.stop();
      showToast("已停止朗读");
    } else {
      const t = current.translation || "";
      if (!t) {
        showToast("本篇暂无译文");
        return;
      }
      const ok = window.Speech.speak(t);
      showToast(ok ? "开始朗读译文" : "朗读启动失败，请重试");
    }
    syncTransReadButton();
    setTimeout(syncTransReadButton, 60);
  }

  function closeReader() {
    if (window.Speech) window.Speech.stop();
    autoReading = false;
    $("#gw-reader").hidden = true;
    document.body.classList.remove("reader-open");
    current = null;
    renderList();
    syncRandomReadButton();
  }

  function syncDoneButton() {
    if (!current) return;
    const read = isRead(current.id);
    const btn = $("#gw-done");
    btn.classList.toggle("is-done", read);
    $("#gw-done-text").textContent = read ? "已读" : "标记已读";
    btn.setAttribute("aria-pressed", read ? "true" : "false");
  }

  /* ---------------- 随机连读 ---------------- */

  function syncRandomReadButton() {
    const btn = $("#gw-random-read");
    if (!btn) return;
    const ok = speechSupported();
    btn.disabled = !ok;
    // 只有「连读队列真的还在跑」才算进行中：用户中途点「停止」时按钮要立刻复位
    const running = autoReading && !!window.Speech && window.Speech.speaking();
    btn.dataset.on = running ? "1" : "0";
    $("#gw-random-read-text").textContent = running ? "连读中" : "随机连读";
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

  /**
   * 随机连读
   * @param {Array} pool 候选篇目；缺省为当前列表（全部 / 未读）里的篇目
   */
  function startRandomRead(pool) {
    if (!speechSupported()) {
      showToast("当前浏览器不支持语音朗读");
      return;
    }
    // 再点一次 = 停止连读
    if (autoReading && window.Speech.speaking()) {
      window.Speech.stop();
      window.ReaderPlayer.close();
      autoReading = false;
      clearHighlight();
      syncRandomReadButton();
      syncReadButton();
      syncTransReadButton();
      showToast("已停止连读");
      syncItemPlayBtns();
      return;
    }
    const list = shuffle((pool && pool.length ? pool : visibleItems()));
    if (!list.length) {
      showToast("没有可朗读的篇目");
      return;
    }

    autoReading = true;
    syncRandomReadButton();

    window.ReaderPlayer.player({
      title: list.length + " 篇随机连读",
      items: list.map(function (p) {
        return {
          title: p.title,
          text: speechText(p),
          // 每篇读完自动翻到下一篇（阅读器打开的自动翻篇由 onIndex 完成）
          onStart: function () {
            if (!current || current.id !== p.id) openReader(p);
            highlightItem(p.id);
          }
        };
      }),
      onIndex: function (i) {
        const p = list[i];
        if (!p) return;
        if (!current || current.id !== p.id) openReader(p);
      },
      onEnd: function () {
        autoReading = false;
        clearHighlight();
        syncRandomReadButton();
        syncReadButton();
        syncTransReadButton();
        syncItemPlayBtns();
      }
    });
  }

  /* ---------------- 字号 ---------------- */
  function fontIdx() {
    const v = Number(localStorage.getItem(FONT_KEY));
    const i = FONT_SIZES.indexOf(v);
    return i === -1 ? FONT_SIZES.indexOf(DEFAULT_FONT) : i;
  }

  function applyFont() {
    $("#rd-text").style.fontSize = FONT_SIZES[fontIdx()] + "px";
  }

  function changeFont(step) {
    let i = fontIdx() + step;
    i = Math.max(0, Math.min(FONT_SIZES.length - 1, i));
    localStorage.setItem(FONT_KEY, String(FONT_SIZES[i]));
    applyFont();
    showToast("字号 " + FONT_SIZES[i] + "px");
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

    // 「全部 / 未读」是一组组合按钮：同一时刻只有一个是选中态
    $$("[data-filter]").forEach(function (b) {
      b.addEventListener("click", function () {
        filter = b.dataset.filter;
        $$("[data-filter]").forEach(function (x) {
          const on = x === b;
          x.classList.toggle("active", on);
          x.setAttribute("aria-pressed", on ? "true" : "false");
        });
        renderList();
      });
    });

    // 分组「随机连读」：在组内随机，读完自动跳下一篇
    $("#gw-list").addEventListener("click", function (e) {
      const btn = e.target && e.target.closest ? e.target.closest("[data-random-group]") : null;
      if (!btn) return;
      e.stopPropagation();
      const group = btn.dataset.randomGroup;
      startRandomRead(allItems().filter(function (p) { return p.gradeGroup === group; }));
    });

    const randomBtn = $("#gw-random-read");
    if (randomBtn) randomBtn.addEventListener("click", function () { startRandomRead(null); });

    $("#gw-back").addEventListener("click", closeReader);
    $("#rd-prev").addEventListener("click", function () { goSibling(-1); });
    $("#rd-next").addEventListener("click", function () { goSibling(1); });

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
      syncTransButton();
      $("#rd-trans").hidden = on;
      if (on) syncTransReadButton();
    });

    $("#rd-font-up").addEventListener("click", function () { changeFont(1); });
    $("#rd-font-down").addEventListener("click", function () { changeFont(-1); });

    $$("#rd-pinyin-seg button").forEach(function (b) {
      b.addEventListener("click", function () {
        setPinyinModeFromUI(b.dataset.mode);
      });
    });
    $("#rd-read-btn").addEventListener("click", toggleRead);
    const transReadBtn = $("#rd-trans-read");
    if (transReadBtn) transReadBtn.addEventListener("click", toggleTransRead);

    // 语音朗读结束 / 被中止后同步按钮状态（含连读按钮的复位）
    if (window.speechSynthesis && window.speechSynthesis.addEventListener) {
      const syncAll = function () {
        if (!window.Speech.speaking()) autoReading = false;
        syncReadButton();
        syncTransReadButton();
        syncRandomReadButton();
        syncItemPlayBtns();
      };
      window.speechSynthesis.addEventListener("end", syncAll);
      window.speechSynthesis.addEventListener("cancel", syncAll);
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
    // 注音档位由总开关统一裁决（effectivePinyinMode），这里无需预写，
    // 保证「设置里关掉阅读辅助」在任何时候进阅读器都是纯文本。
    bindEvents();
    renderList();
    syncRandomReadButton();
    // 设置页改「阅读辅助」后（另一个标签页 / 返回本页）立刻同步，不再需要刷新
    window.addEventListener("storage", function (e) {
      if (e.key !== "poem_recite_settings_v1" && e.key !== PINYIN_KEY) return;
      renderReaderText();
      syncPinyinButton();
    });
    // 从首页返回（bfcache）时也重新判定一次档位
    window.addEventListener("pageshow", function () {
      if (!current) return;
      renderReaderText();
      syncPinyinButton();
    });
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
