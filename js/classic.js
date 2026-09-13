/**
 * 小古文 · 学习库
 * ---------------------------------------------------
 * 设计说明：
 * 1. 小古文篇幅长，卡片弹窗装不下，因此不做每日排期、只在本页「列出 + 整页阅读」：
 *    这只是排版与入口安排，不对「背还是读」作任何引导。
 * 2. 列表**按主题分类聚合**，不按原书目录顺序：
 *    同一类的篇目无论出自哪本书都排在一起，「蒙学经典」有几篇就显示几篇。
 * 3. 搜索 + 「全部 / 未读」筛选，快速找到想读的一篇。
 * 4. 阅读用**整页阅读器**（reader），而不是卡片弹窗：长文可整屏滚动。
 * 5. 进度只有 localStorage 里的「已读」标记（poem_classic_read_v1）。
 * 6. 阅读辅助工具条分两行排：
 *    第一行 = 正文对齐（左 / 中 / 右 SVG 图标）+ 字号（A－ / A＋ 组合）+ 注音档位；
 *    第二行 = 朗读 / 译文开关 / 播放译文 / 标记已读，全部纯 SVG 图标，文案走屏幕阅读器。
 *    对齐方式可持久化：古诗居中好看，长古文左对齐更好读。
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
  const ALIGN_KEY = "poem_classic_align_v1";
  const PINYIN_KEY = "poem_helper_pinyin_v1";

  /* 字号五档：A- 可以一路降到 15px，照顾低龄与弱视用户 */
  const FONT_SIZES = [15, 17, 19, 21, 23];
  const DEFAULT_FONT = 17; // 默认字号降一级（原默认 19）

  /* 正文对齐三档：left / center / right
     古诗短句居中像碑帖，所以默认居中；《少年中国说》这类长古文左对齐更好读，
     由用户在工具条上用图标自己选，选择记在本机。 */
  const ALIGNS = ["left", "center", "right"];
  const DEFAULT_ALIGN = "center";

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

  /** 应用名固定为「跬步」 */
  const APP_NAME = "跬步";

  let current = null;
  let keyword = "";
  let filter = "all";
  let autoReading = false;
  /** 组合播放键当前朗读的是哪一段：「原文」/「译文」 */
  let speakingTarget = "原文";
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

  /**
   * 页面标题与副标题。
   *
   * 顶栏第一行固定是「跬步 · 页面名」（页面名由 chrome.js 按 data-page=小古文 渲染），
   * 所以第二行只补「这一页是干什么的」= 想读哪篇点哪篇，**不再重复「小古文」**。
   * <title> 与全站一致：主标题在后、页面名在前 —— 「小古文 · 跬步」；
   * 填过用户名时带上首页那层（「小明 · 小古文 · 跬步」）。
   */
  function currentUsername() {
    try {
      var cfg = JSON.parse(localStorage.getItem("poem_recite_settings_v1") || "{}") || {};
      return String(cfg.username == null ? "" : cfg.username).trim();
    } catch (e) {
      return "";
    }
  }

  function applyAppName() {
    const name = currentUsername();
    // 与顶栏同一口径：用户名只作为限定词前置，不改变「跬步」是应用名这件事
    document.title = name ? name + " · 小古文 · " + APP_NAME : "小古文 · " + APP_NAME;
    $$('meta[name="apple-mobile-web-app-title"]').forEach(function (m) {
      m.setAttribute("content", name ? name + " · 小古文" : APP_NAME);
    });
    // 顶栏第二行：页面名已经在第一行（「跬步 · 小古文」），这里只补一句「这一页是干什么的」，
    // 所以**不再重复「小古文」**（早先写成「小古文 · 想读哪篇点哪篇」，
    // 与第一行连起来看就是「小古文 小古文 · 想读哪篇点哪篇」）。
    // chrome.js 渲染完顶栏会派发 chrome:ready，所以这里写在事件里，
    // 否则会被它随后重建的顶栏覆盖。
    const setSub = function () {
      const sub = $("#brand-sub");
      if (sub) sub.textContent = "想读哪篇点哪篇";
    };
    setSub();
    document.addEventListener("chrome:ready", setSub);
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
    const playing = readingActive();
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
    // 再点一次 = 停止当前朗读（含已暂停的情况）
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

    var countEl = $("#gw-count");
    if (countEl) countEl.textContent = readCount + " / " + total + " 篇";

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
    showTransBox(false);
    speakingTarget = "原文";
    renderNav();
    applyFont();
    applyAlign();
    syncPinyinButton();
    syncReadButtons();
    syncDoneButton();
    $("#gw-reader").hidden = false;
    document.body.classList.add("reader-open");
    // 顶栏动作位换成「关闭」：阅读器是全屏层，此时「回首页」不如「合上」直接
    if (window.SiteChrome) {
      window.SiteChrome.setHeaderAction({
        icon: window.SiteChrome.glyph("close"),
        label: "关闭阅读器",
        onclick: closeReader
      });
    }
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

  /**
   * 当前是否有「朗读任务」在跑（**含暂停中**）。
   * 只看 speaking() 会漏掉「已暂停」：部分设备 pause() 之后 speaking 会变成
   * false，但队列 / 单条朗读还在，点按钮应当继续或停止，而不是又开一遍。
   */
  function readingActive() {
    return !!(window.Speech && window.Speech.active && window.Speech.active());
  }

  /**
   * 外部（测试 / 宿主页面 / 播放栏停止键）主动停止朗读后的兜底复位：
   * 语音引擎的 cancel 事件并不保证一定回调，所以提供一个显式入口。
   */
  function handleSpeechStopped() {
    if (window.Speech && window.Speech.active && window.Speech.active()) return;
    autoReading = false;
    clearHighlight();
    syncAllReadState();
  }

  /** 一次同步所有朗读相关按钮（译文键也归这里管，避免只同步一半） */
  function syncAllReadState() {
    syncReadButtons();
    syncTransReadButton();
    syncRandomReadButton();
    syncItemPlayBtns();
  }

  /**
   * 同步正文那颗播放键：▶ 与 ⏸ 是**同一个按钮的两种状态**，
   * 播放中原地换成暂停，停下换回播放 —— 绝不同时并排出现两个图标。
   * 译文框里那颗键由 syncTransReadButton() 管，只在译文展开时可见。
   */
  function syncReadButtons() {
    const ok = speechSupported();
    // 自动连读中不算「本篇朗读中」（避免按钮来回跳）；暂停中仍算朗读中，点它即停止
    const playing = ok && !autoReading && readingActive();

    const btn = $("#rd-read-btn");
    if (btn) {
      btn.disabled = !ok;
      btn.title = ok ? "朗读原文：标题、朝代、作者与正文" : "当前浏览器不支持语音朗读";
      const on = playing && speakingTarget === "原文";
      btn.dataset.on = on ? "1" : "0";
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }

    // #rd-read-text 是给读屏软件的固定文案（.sr-only），不随能力 / 播放态替换文字，
    // 状态一律由 data-on 切换 ▶ / ⏸ 与 aria-pressed 表达
    syncTransReadButton();
  }

  /** 正文播放键：朗读原文（标题 + 朝代 + 作者 + 正文） */
  function toggleRead() {
    if (!speechSupported() || !current) return;
    // 点播放键即接管朗读：无论开始还是停止，都退出「随机连读」状态，
    // 否则 autoReading 残留会让播放键一直显示不出播放态
    autoReading = false;
    // 「再点一次 = 停止」只针对**正在读正文**这件事：
    //   · 暂停中也算（部分设备 pause 后 speaking 会变 false，认 readingActive()）
    //   · 正在读译文时点正文键 = 切换到读正文，不能把它当成「停止译文后什么都不做」
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

  /** 译文播放键：只读白话译文，不读原文；译文没展开时顺手展开，省一次点击 */
  function toggleTransRead() {
    if (!speechSupported() || !current) return;
    autoReading = false;
    // 暂停中同样能停：认 readingActive()（含暂停中），不认 speaking() ——
    // 部分设备 pause 之后 speaking 会变 false，此时点它应当是停下来，
    // 而不是又发起一层译文朗读。
    if (readingActive() && speakingTarget === "译文") {
      window.Speech.stop();
      showToast("已停止朗读");
    } else {
      const t = current.translation || "";
      if (!t) {
        showToast("本篇暂无译文");
        return;
      }
      if ($("#rd-trans").hidden) showTransBox(true);
      speakingTarget = "译文";
      const ok = window.Speech.speak(t);
      showToast(ok ? "开始朗读译文" : "朗读启动失败，请重试");
    }
    syncAllReadState();
    setTimeout(syncAllReadState, 60);
    setTimeout(syncAllReadState, 300);
  }

  /**
   * 展开 / 收起白话译文。
   * 只切 box.hidden 与按钮状态，**不再往任何元素写按钮文案** ——
   * 早先这里同时写了按钮文字，正好和译文段落抢过 id，导致译文一片空白。
   */
  function showTransBox(show) {
    const btn = $("#rd-trans-toggle");
    const box = $("#rd-trans");
    if (!box) return;
    box.hidden = !show;
    if (btn) {
      const on = !!show;
      btn.dataset.on = on ? "1" : "0";
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.title = on ? "收起译文" : "显示译文";
      const t = $("#rd-trans-toggle-text");
      if (t) t.textContent = on ? "收起译文" : "显示译文";
    }
    // 译文框一开一合，译文那颗播放键跟着出现 / 消失。
    // 这里**只切界面状态，不动朗读**：连读自动翻篇也会走到这里（openReader → 收起译文），
    // 若在这里 cancel 会把整个「随机连读」队列一起杀掉、播放栏卡在原篇。
    // 用户主动收起译文时要停下正在读的译文，交给收起按钮的处理函数。
    if (!show && speakingTarget === "译文") speakingTarget = "原文";
    syncTransReadButton();
  }

  /**
   * 译文标题右侧那颗播放键：只在译文框展开时出现，
   * 状态同样靠 data-on 原地切换 ▶ / ⏸，与正文那颗不同时显示两个播放信号。
   */
  function syncTransReadButton() {
    const btn = $("#rd-trans-read");
    if (!btn) return;
    const ok = speechSupported();
    const boxOpen = !$("#rd-trans").hidden;
    btn.disabled = !ok;
    btn.title = ok ? "朗读白话译文" : "当前浏览器不支持语音朗读";
    // 暂停中仍是「在读译文」：按钮点下去就是停下来，不会再重读一遍
    const on = ok && boxOpen && !autoReading && speakingTarget === "译文" && readingActive();
    btn.dataset.on = on ? "1" : "0";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    const label = $("#rd-trans-read-text");
    if (label) label.textContent = on ? "停止朗读" : "朗读译文";
  }

  function closeReader() {
    if (window.Speech) window.Speech.stop();
    autoReading = false;
    speakingTarget = "原文";
    $("#gw-reader").hidden = true;
    document.body.classList.remove("reader-open");
    // 顶栏动作位还原为「回首页」
    if (window.SiteChrome) window.SiteChrome.setHeaderAction(null);
    current = null;
    renderList();
    syncRandomReadButton();
  }

  function syncDoneButton() {
    if (!current) return;
    const read = isRead(current.id);
    const btn = $("#gw-done");
    btn.classList.toggle("is-done", read);
    // 「标记已读」现在是一个 SVG 勾选图标，可见文案只保留顶栏右侧的「已读」小字
    btn.title = read ? "已读，再点一次取消" : "标记为已读";
    btn.setAttribute("aria-pressed", read ? "true" : "false");
    $("#gw-done-text").textContent = read ? "已读，再点一次取消" : "标记为已读";
    // 顶栏右侧那一格只是「与返回键等宽的占位」，让进度真正居中；
    // 已读时点亮一个小小的勾，不做成第二个按钮。
    const tip = $("#rd-done-text");
    if (tip) {
      tip.textContent = read ? "✓" : "";
      tip.setAttribute("aria-hidden", "true");
      tip.classList.toggle("is-done", read);
    }
  }

  /* ---------------- 随机连读 ---------------- */

  function syncRandomReadButton() {
    const btn = $("#gw-random-read");
    if (!btn) return;
    const ok = speechSupported();
    btn.disabled = !ok;
    // 只有「连读队列真的还在跑」才算进行中：用户中途点「停止」时按钮要立刻复位。
    // 这里认 active()（含暂停中），不能只看 speaking()：部分设备暂停后 speaking 会变 false，
    // 那样按钮会误判成「没在连读」，再点一下就会重新开一轮而不是停下来。
    const running = autoReading && !!(window.Speech && window.Speech.active && window.Speech.active());
    btn.dataset.on = running ? "1" : "0";
    // 工具栏一行排满，文案精简成「连读 / 连读中」（完整说明在 title 里）
    $("#gw-random-read-text").textContent = running ? "连读中" : "连读";
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
    if (autoReading && readingActive()) {
      window.Speech.stop();
      window.ReaderPlayer.close();
      autoReading = false;
      clearHighlight();
      syncRandomReadButton();
      syncReadButtons();
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
        syncRandomReadButton();
      },
      onEnd: function () {
        autoReading = false;
        clearHighlight();
        syncRandomReadButton();
        syncReadButtons();
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

  /* ---------------- 正文对齐 ---------------- */

  function alignMode() {
    const v = localStorage.getItem(ALIGN_KEY);
    return ALIGNS.indexOf(v) > -1 ? v : DEFAULT_ALIGN;
  }

  /** data-align 交给 CSS 决定 text-align；块本身的居中由 fit-content + margin auto 保证 */
  function applyAlign() {
    const box = $("#rd-text");
    if (!box) return;
    box.dataset.align = alignMode();
  }

  function syncAlignButtons() {
    const mode = alignMode();
    $$("#rd-align-seg button").forEach(function (b) {
      const on = b.dataset.align === mode;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function setAlign(mode) {
    localStorage.setItem(ALIGN_KEY, ALIGNS.indexOf(mode) > -1 ? mode : DEFAULT_ALIGN);
    applyAlign();
    syncAlignButtons();
    showToast(mode === "left" ? "正文左对齐" : mode === "right" ? "正文右对齐" : "正文居中对齐");
  }

  function showToast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { t.hidden = true; }, 1600);
  }

  /* ---------------- 设置面板（顶栏 / 底部页签统一入口） ----------------
     小古文页也要能改用户名、年级、阅读辅助，否则用户必须退回首页。
     为不让本页背上首页那套调度逻辑，这里只放与本页相关的几项。 */
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

  /** 用户名：与首页共用同一份设置，改完本页顶栏与标题立刻跟着变 */
  function syncSettingsUI() {
    var input = document.getElementById("input-username");
    if (input) input.value = currentUsername();
    $$("#seg-helper-c button").forEach(function (b) {
      var on = (b.dataset.helper === "on") === helperOn();
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function currentUsername() {
    try {
      var cfg = JSON.parse(localStorage.getItem("poem_recite_settings_v1") || "{}") || {};
      return String(cfg.username == null ? "" : cfg.username);
    } catch (e) {
      return "";
    }
  }

  function saveUsername(name) {
    var cfg = {};
    try {
      cfg = JSON.parse(localStorage.getItem("poem_recite_settings_v1") || "{}") || {};
    } catch (e) {
      cfg = {};
    }
    if (!cfg || typeof cfg !== "object") cfg = {};
    cfg.username = String(name || "").slice(0, 12);
    localStorage.setItem("poem_recite_settings_v1", JSON.stringify(cfg));
    // 小古文页的页面名固定是「小古文」（顶栏第一行「跬步 · 小古文」），
    // 用户名只影响页面标题，不改页面名 —— 否则用户会认不出自己在哪一页。
    var n = cfg.username.trim();
    document.title = n ? n + "的小古文 · 跬步" : "小古文 · 跬步";
  }

  function bindSettings() {
    document.addEventListener("settings:open", openSettings);
    var modal = document.getElementById("settings-modal");
    if (!modal) return;
    $$("[data-settings-close]", modal).forEach(function (el) {
      el.addEventListener("click", closeSettings);
    });
    var input = document.getElementById("input-username");
    if (input) {
      input.addEventListener("input", function () { saveUsername(input.value); });
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
        // 总开关口径与首页一致：关闭时无论此前存过什么档位都不注音
        localStorage.setItem(PINYIN_KEY, helperOn() ? DEFAULT_PINYIN_MODE : "off");
        renderReaderText();
        syncPinyinButton();
        syncSettingsUI();
        showToast(helperOn() ? "阅读辅助已开启：打开古文自动注音" : "阅读辅助已关闭：打开古文为纯文本");
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) closeSettings();
    });
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
      const show = this.dataset.on !== "1";
      // 用户主动收起译文框时，若正在读译文，先把这一条停下来
      // （openReader 翻篇时的自动收起走 showTransBox(false)，那里不停朗读 ——
      //   否则会把正在跑的「随机连读」队列一起 cancel 掉）
      if (!show && speakingTarget === "译文" && readingActive()) window.Speech.stop();
      showTransBox(show);
      syncAllReadState();
    });

    $("#rd-font-up").addEventListener("click", function () { changeFont(1); });
    $("#rd-font-down").addEventListener("click", function () { changeFont(-1); });

    // 正文对齐：左 / 中 / 右 三个 SVG 图标，选中态持久化
    $$("#rd-align-seg button").forEach(function (b) {
      b.addEventListener("click", function () { setAlign(b.dataset.align); });
    });

    $$("#rd-pinyin-seg button").forEach(function (b) {
      b.addEventListener("click", function () {
        setPinyinModeFromUI(b.dataset.mode);
      });
    });
    $("#rd-read-btn").addEventListener("click", toggleRead);
    const transReadBtn = $("#rd-trans-read");
    if (transReadBtn) transReadBtn.addEventListener("click", toggleTransRead);

    // 播放栏上的「停止」按钮：用户主动停止连读后立刻复位
    if (window.ReaderPlayer && window.ReaderPlayer.onStop) window.ReaderPlayer.onStop(handleSpeechStopped);

    // 语音朗读结束 / 被中止后同步按钮状态（含连读按钮的复位）
    if (window.speechSynthesis && window.speechSynthesis.addEventListener) {
      const syncAll = function () { handleSpeechStopped(); };
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
    applyAppName();
    bindEvents();
    bindSettings();
    renderList();
    syncAlignButtons();
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
    align: alignMode,
    setAlign: setAlign,
    total: function () { return allItems().length; },
    annotate: function () { return window.Pinyin ? window.Pinyin.annotateHtml(current ? current.text : "") : ""; },
    // 朗读被外部停止（例如系统打断、播放栏停止）后的兜底复位
    onSpeechStopped: handleSpeechStopped
  };
})();
