/**
 * 古籍阅读库（可挂载到任意一部集子）
 * ==========================================================================
 * 这个文件是「索引页 + 详情页」的引擎：小古文、唐诗三百首、宋词三百首、
 * 古文观止、全站搜索结果，全都挂它一遍，每个挂载点得到自己的一份状态与 DOM。
 *
 * 为什么要有这一层：
 *   原先只有《课外必背小古文》一部集子，列表、搜索、阅读器、已读、连读、
 *   注音、字号、对齐全写死在 js/classic.js 里。现在要装进四部典籍 + 一个
 *   全站搜索页，如果每部各抄一遍，改一处样式要改五处 —— 抄第五遍的时候
 *   一定会漏。（z-index、空态、顶栏第 N / M 篇…… 都是这么漏掉的。）
 *
 * 设计：
 *   1. mount(option) 只接收两样东西：**数据**（items）与**DOM 根**
 *      （带 data-gw-* 标记的一段 HTML）。没有任何一部集子专属的字面量。
 *   2. 每部集子一份状态，互不串台：在一部里搜索、在另一部里读到第几篇、
 *      各自随机连读，都是独立的。状态只活在闭包里，不写 window 上的全局变量。
 *   3. 已读标记按集子分别存（poem_classic_read_v1 / poem_tangshi_read_v1 …），
 *      字号与对齐是**全站共用**的一份阅读偏好（在唐诗里调大了字号，
 *      翻到宋词不该又变回去）。
 *   4. 对外接口 window.ReaderEngine.mount(config) 返回该挂载点的实例，
 *      便于测试与「搜索页跳转」这类跨页调用。
 *
 * 页面怎么用：
 *   <body data-nav="classic" data-page="小古文">
 *   <div data-gw-root>            ← 一块 data-gw-root 对应一个挂载点
 *     <header class="topbar topbar-with-count">
 *       <span class="count-badge" data-gw="count">0 / 100 篇</span>
 *     </header>
 *     <div class="toolbar"> … <input data-gw="search"> … </div>
 *     <div class="list" data-gw="list"></div>
 *   </div>
 *   <div class="reader" data-gw="reader" hidden> … </div>   ← 也可以放在同一块里
 *   <script>ReaderEngine.mount({ items: …, storeKey: …, readKey: … });</script>
 *
 * 见 js/classic.js（小古文）与 js/library.js（三部大集子 / 搜索页）的挂载示例。
 */
(function () {
  "use strict";

  /* ---------------- 页面文案（全站一份，按集子覆盖） ----------------
     曾经这些字面量散在函数体里（「返回小古文列表」「没有匹配的小古文」…），
     换一部集子就得改代码。现在集中成一张表，mount 时按 config.words 覆盖。 */
  var DEFAULT_WORDS = {
    list: "小古文",
    unit: "篇",
    loadingFailed: "小古文数据加载失败",
    empty: "没有匹配的小古文",
    filterAll: "全部",
    filterUnread: "未读",
    matchGroup: "课外必背",
    filterGroup: "",        // 非空时只显示该分组（如搜索结果只显示「课内诗词」）
    filterGroupLabel: "",
    countInvalid: "数据加载失败",
    noReadable: "没有可朗读的篇目",
    backToList: "返回列表",
    readStoreLabel: "已读",
    // 正文 / 译文尚未整理的篇目（《古文观止》目录里的「待补」条目）：
    // 点进去要说清「这篇为什么是空的、以后会有」，而不是白屏或假内容
    pendingText: "本篇原文尚在整理中",
    pendingTranslation: "本篇白话译文尚在整理中",
    playerTitle: "",        // 底部播放栏的读屏名，留空用默认
    randomRead: "随机连读",
    searchPlaceholder: "搜索篇名 / 出处 / 作者",
    version: "",            // 一次性文案版本号，用于清掉老版本写下的缓存
    readStore: "poem_classic_read_v1",
    appName: "跬步"
  };

  /* 全站共用的阅读偏好（不按集子分家）：在唐诗里调过字号，宋词不该又变回去 */
  var FONT_KEY = "poem_classic_font_v1";
  var ALIGN_KEY = "poem_classic_align_v1";
  var PINYIN_KEY = "poem_helper_pinyin_v1";
  var SETTINGS_KEY = "poem_recite_settings_v1";

  /* 作用域查询：默认在本挂载点里找，找不到再退到整篇文档 ——
     HTML 片段可能与挂载点不在一起（搜索页的阅读器放在页面底部），
     但绝不能**跨挂载点**串台：所以先 root/box，最后才是 document。

     ⚠️ 这两个函数只看**本挂载点**（live），不看「最后挂上的那一个」。
     一部页面同时挂两部集子时（搜索页要挂全站索引 + 自己的列表），
     谁在做事、就查谁的地盘 —— 早期版本这里是读模块级闭包的，
     结果搜甲集把乙集的列表筛空了。 */
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
  /**
   * 本挂载点是否维护「已读」进度。
   *
   * 四部集子各有各的键（poem_classic_read_v1 等），**搜索页的键是空串** ——
   * 搜索页是「查东西」的地方，点开一篇不该改动任何一部的进度。
   * 于是本页不显示「标记已读」按钮、不写任何 localStorage 键、
   * 列表里也不出现「已读」小标（见 renderList / syncDoneButton / syncCount）。
   */
  function hasReadStore() {
    return !!(W && W.readStore);
  }

  /** 整篇文档范围（顶栏那条在挂载点之外，例如 .brand-sub） */
  function $$all(sel) {
    return Array.prototype.slice.call(document.querySelectorAll(sel));
  }

  /**
   * 切换「现在干活的是哪一份挂载会话」。
   * 每个会话自己一份 DOM 根、数据、文案、搜索词、已读快照 —— mount 时建立，
   * 之后每次读写都先 liveTo() 切过去。
   */
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
    speakingTarget = s.speakingTarget;
  }

  /** 把当前几个变量的值写回会话（切走之前调一次） */
  function stash(s) {
    if (!s) return;
    s.current = current;
    s.keyword = keyword;
    s.filter = filter;
    s.autoReading = autoReading;
    s.speakingTarget = speakingTarget;
  }

  /** DOM 事件里的元素属于哪一份会话：靠最近的 data-gw-root / data-gw-reader 认领 */
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

  /** 回到当前会话的现场 */
  function enterLive() { if (live) liveTo(live); }

  /* 字号六档：A- 可以一路降到 13px，照顾低龄与弱视用户。
     最细那档是 Issue #55 追加的 —— 默认档仍是 17px，只是 A－ 能再多点一次 */
  const FONT_SIZES = [13, 15, 17, 19, 21, 23];
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
      return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}").helper !== "off";
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

  /** 应用名固定为「跬步」 */
  const APP_NAME = "跬步";

  /* ---- 每次 mount 一份的实例状态（不写 window 上的全局变量） ----
     这些变量在每次 mount() 时由 live() 重新指向**那一份**会话（见文件末尾的
     mount / live）。之所以把它们留在这里而不是包成对象到处传：
     引擎里上百处调用点都是直接读 root / W / items，一个个改成 this.xxx
     才是真正容易漏改出 bug 的做法。 */
  let live = null;          // 当前这一份挂载会话（mount 时切换）
  let box = null;           // 阅读器全局层（可与 root 不同，搜索页把它放在页面底部）
  let root = null;          // 本挂载点的 DOM 根（data-gw-root）
  let CFG = null;           // 本挂载点的完整配置
  let W = null;             // 本挂载点的文案表
  let items = [];           // 本集子的全部篇目（顺序即目录顺序）
  let itemsById = {};
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
      cfg = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {};
    } catch (e) {
      cfg = {};
    }
    if (!cfg || typeof cfg !== "object") cfg = {};
    cfg.helper = on ? "on" : "off";
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(cfg));
  }

    /* ---------------- 页面标题 / 副标题（按集子） ----------------
     顶栏第一行固定是「跬步 · 页面名」（chrome.js 按页面 body 上的 data-page 渲染），
     第二行只补「这一页是干什么的」，**不再重复页面名**。
     <title> 与全站一致：主标题在后、页面名在前 —— 「小古文 · 跬步」；
     填过用户名时带上首页那层（「小明 · 小古文 · 跬步」）。
     这几处原先都写死「小古文」，现在按挂载点的 pageTitle / pageSub 走。 */
  function currentUsername() {
    try {
      var cfg = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {};
      return String(cfg.username == null ? "" : cfg.username).trim();
    } catch (e) {
      return "";
    }
  }

  /**
   * 顶栏第二行。
   *
   * 顶栏有**两条**（页面顶部那条 + 阅读器里那条），而且每次开 / 关阅读器、
   * 每次换顶栏动作位都会整体重绘，重绘后第二行是空的 ——
   * 所以这里写的不是一个「初始化」函数，而是「重绘之后随时补一次」的函数。
   * 少补一次，用户就会看到页名下面那句说明忽有忽无。
   */
  function paintSub() {
    $$all(".brand-sub").forEach(function (sub) { sub.textContent = CFG.pageSub || ""; });
  }

  function applyAppName() {
    var title = CFG.pageTitle || W.list;
    var name = currentUsername();
    // 与顶栏同一口径：用户名只作为限定词前置，不改变「跬步」是应用名这件事
    document.title = name ? name + " · " + title + " · " + APP_NAME : title + " · " + APP_NAME;
    $$all('meta[name="apple-mobile-web-app-title"]').forEach(function (m) {
      m.setAttribute("content", name ? name + " · " + title : APP_NAME);
    });
    paintSub();

    // 已读进度牌（0 / 100 篇）也在页顶那一行里，chrome.js 重建顶栏时会把它原样留着
    // （见 chrome.js 的 renderBar），所以这里只要在它渲染完之后补一次数字。
    var onChrome = function () { paintSub(); syncCount(); };
    document.addEventListener("chrome:ready", onChrome);
  }

  /* 进度牌文案：已读 / 总数。页顶与「标记已读」共用这一处口径 */
  function syncCount() {
    var el = $('[data-gw="count"]') || $("#gw-count");
    if (!el) return;
    el.textContent = allItems().filter(function (p) { return isRead(p.id); }).length +
      " / " + allItems().length + " " + W.unit;
  }

  /* ---------------- 进度存储（每部集子一份，互不干扰） ---------------- */
  function readMap() {
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
    localStorage.setItem(W.readStore, JSON.stringify(map));
    // 各挂载点各自维护一份内存里的已读快照：同时挂载的其它集子（搜索页）
    // 才能在自己重绘时拿到最新结果，而不必回头再读一遍 localStorage。
    window.dispatchEvent(new CustomEvent("reader-read-change", { detail: { store: W.readStore, id: id, read: !!val } }));
  }

  /** 已读快照变化时刷新本挂载点的计数与列表状态（不重排列表，避免翻页时跳动） */
  function onReadChange(e) {
    if (!e.detail || e.detail.store !== W.readStore) return;
    syncCount();
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

  /* ---------------- 数据 ---------------- */

  /**
   * 一部集子的目录顺序。
   *
   * 数据文件里保留原书目录顺序（便于比对教材 / 选本），展示层再按分类聚合：
   *   同类相邻、序号 1…N 连续，「蒙学经典」有几篇就列出几篇。
   *
   * 分类顺序由各集子自己给（config.groupOrder），不是写死在这里 ——
   * 小古文按「先蒙学识字 → 再故事寓言 → 再诸子论道」的认知顺序，
   * 唐诗按原书卷一…卷八，宋词按词牌，古文观止按卷一…卷十二，
   * 每一部的「什么顺序才对」根本不是同一个答案。
   * groupOrder 为空数组（搜索结果页）时按传入顺序原样展示，不做重排。
   */
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
      // 同类内保持原书目录的相对次序
      return listIndexOf(a) - listIndexOf(b);
    });
  }

  /** 原始目录中的位置，用于分类内稳定排序 */
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

  /**
   * 当前列表要显示的篇目。
   *
   * 关键词命中范围：篇名 / 出处 / 作者 / 朝代 —— 再加 config.extraSearch 给的
   * 额外面（小古文 + 副标题，搜索结果页 + 集子名），这样「唐诗三百首」
   * 这种集子名也能搜到。
   */
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
    return [p.title, p.source, p.selection, p.author, p.dynasty].concat(extraFields(p)).join(" ");
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

  /**
   * 列表项右侧的播放键：播放中换成「暂停」两竖条
   * ▶ 空心描边三角，描边色即外层圆键的 currentColor（Issue #55 后续），
   * 与 js/app.js 的 playGlyph 是同一枚三角。
   * 描边宽 1.5（Issue #55 本轮，原 2.4）：这一档的图标框是 16px，
   * 1.5 × 16 ÷ 24 = 1px —— 即用户要的「三角形边框 1px」。
   */
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

  /**
   * 列表项右侧的「向右」箭头（内联 SVG，与首页折叠箭头同一枚图标）。
   * 需求（Issue #55）：小古文列表的「›」、首页古诗词列表的「›」、
   * 首页「全部诗词」的展开 / 收缩箭头，三处大小必须一致 —— 见 js/app.js 的 arrowGlyph。
   * 之前这里是文本字符「›」（font-size 18px，字形仅约 9px 高），
   * 与首页那颗 18×18 的 SVG 三角摆在一起一大一小；改用同一枚 18×18 描边箭头，
   * 尺寸与笔画都不再随字体回退而变。
   */
  function arrowGlyph() {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M9.8 6.6 15.2 12l-5.4 5.4" /></svg>'
    );
  }

  /**
   * 分组右侧小号圆键里的图标：只有一个 ▶ 三角。
   * 与其它档一样是**空心描边**（Issue #55 后续）。
   * 描边宽 2（Issue #55 本轮，原 2.6）：这一档的图标框只有 12px，
   * 2 × 12 ÷ 24 = 1px —— 与全站其余播放键的三角边框同宽（见 css/classic.css 顶部的换算表）。
   *
   * 它不需要 ⏸ —— 「现在读到哪一篇」由列表里的高亮 + 底部播放栏表达，
   * 分组键偏「从这里开始听」，做成一颗会翻状态的键反而多一层状态要管。
   * viewBox 略小、三角略内收，缩到 26px 时与 26px 的圆环留出一样的呼吸感。
   */
  function playSmGlyph() {
    return (
      '<span class="play-glyph-sm" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24"><path d="M9.4 6.6 18 12 9.4 17.4Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />' +
      "</svg></span>"
    );
  }

  /** 列表里高亮所有「正在播放」的条目 */
  function syncItemPlayBtns() {
    var playing = readingActive();
    $$(".item-read", listBox()).forEach(function (b) {
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

  /* ---------------- 列表 ---------------- */

  /**
   * 本挂载点的列表容器。
   *
   * 注意 **不能**退回 document.querySelector("#gw-list")：
   * 一部页面同时挂两部集子时（搜索页 / 合并展示页），
   * 文档里会有两块 [data-gw=…list]，退回文档范围就会写错那一块 ——
   * 用户看到的现象是「在甲集里敲字，乙集的列表被筛空了」，
   * 而甲集自己纹丝不动。列表容器跟随会话，不跟随「文档里的第一个」。
   * （#gw-list 这个老 id 只在会话自己找不到标记时才当兜底。）
   */
  function listBox() {
    if (live && live.listEl && live.listEl.isConnected) return live.listEl;
    var el = root ? root.querySelector('[data-gw="list"]') : null;
    if (!el && root) el = root.querySelector("#gw-list");
    if (live) live.listEl = el;
    return el;
  }

  function renderList() {
    var listEl = listBox();
    if (!listEl) return;
    var shown = visibleItems();
    var total = allItems().length;
    var readCount = allItems().filter(function (p) { return isRead(p.id); }).length;

    // 页顶那一行里的「0 / 100 篇」：与列表同一次渲染，保证首屏就是准数
    // （chrome:ready 早于本函数执行，所以进度牌这时已经在 DOM 里了）
    syncCount();

    listEl.innerHTML = "";
    if (!shown.length) {
      listEl.innerHTML = '<div class="empty">' +
        (total ? esc(W.empty) : esc(W.loadingFailed)) + "</div>";
      return;
    }

    // 同一分类的篇目合并进**一张卡片**：卡头是分类名 + 篇数 + 组内随机连读，
    // 卡身按顺序列出这一类的每一篇（不再每篇各占一张卡）。
    // 目的：一眼看出「这几篇是一类的」，卡片数量从上百张降到十几张，列表不再碎成一片。
    var index = 0;
    var groupCard = null;
    var lastGroup = "";
    shown.forEach(function (p) {
      index += 1;
      // 只有当这一条**确实有分类**、且与上一条不同时才开一张新卡。
      // 搜索页的条目没有 gradeGroup（它们来自五部，卷次词牌各说各话，
      // 硬塞一个分类名只会误导），`groupCard` 因此一直是 null ——
      // 条目就直接挂到列表容器上，不再套卡。
      // ⚠️ 这里必须判空再 append：早先的写法无条件用 groupCard，
      // 搜索页一挂上来就整层抛 TypeError（列表一条都出不来）。
      // 同一个坑在下面 `groupCard.appendChild(el)` 那一处也有。
      if (p.gradeGroup && p.gradeGroup !== lastGroup) {
        lastGroup = p.gradeGroup;
        groupCard = document.createElement("section");
        groupCard.className = "group-card";
        groupCard.dataset.group = p.gradeGroup;
        var head = document.createElement("div");
        // 卡头直接长在卡上：12px 上内边距是卡顶与页首那一段呼吸，
        // 下内边距交给卡内条目自己的 12px（见 css/classic.css 的 .group-head）
        head.className = "group-head";
        head.innerHTML =
          '<span class="group-name">' + esc(p.gradeGroup) + "</span>" +
          '<span class="group-count">' + allItems().filter(function (x) { return x.gradeGroup === lastGroup; }).length + " " + esc(W.unit) + "</span>" +
          // 分组右侧是「在组内随机连读」：与工具栏那颗同一套圆形播放键，只是小一号
          // （不再带「随机连读」四个字：这一行已有组名与篇数，键义由 title / 读屏文案说明）
          '<button type="button" class="gw-play gw-play-sm" data-random-group="' + esc(p.gradeGroup) + '"' +
          ' title="随机连读「' + esc(p.gradeGroup) + '」：随机抽一篇开读，读完自动跳下一篇"' +
          ' aria-label="随机连读' + esc(p.gradeGroup) + '">' +
          playSmGlyph() + "</button>";
        groupCard.appendChild(head);
        listEl.appendChild(groupCard);
      }

      var read = isRead(p.id);
      // 「待补」= 正文或译文还没整理好（《古文观止》目录里保留的那些条目）：
      // 列表里照常列出并明确标注，用户不会以为是自己点的这一下有毛病。
      var pending = !p.text || !p.translation;
      var el = document.createElement("div");
      el.className = "item" + (read ? " done" : "") + (pending ? " pending" : "") +
        (p.gradeGroup === W.matchGroup ? "" : " in-book");
      el.dataset.id = p.id;
      el.innerHTML =
        '<div class="item-main">' +
        // 序号圆挪进标题行、排在篇名前面：与小古文首页、古诗词列表同一套（Issue #55 第三条）
        '<h3 class="item-title"><span class="item-num">' + index + "</span>" + esc(p.title) +
        (read && hasReadStore() ? '<span class="item-reason read">' + esc(W.readStoreLabel) + "</span>" : "") +
        (pending ? '<span class="item-reason pending">待补</span>' : "") +
        "</h3>" +
        // 顺序（Issue #55 后续）：朝代 · 作者 · 出处 —— 「宋 · 王应麟 ·《三字经》」，
        // 与阅读器 / 详情页「朝代 + 作者 + 书名」的读法一致，出处作为落款压在最后。
        '<div class="item-meta">' +
        (p.dynasty ? "<span>" + esc(p.dynasty) + "</span>" : "") +
        (p.author ? (p.dynasty ? "<span>·</span>" : "") + "<span>" + esc(p.author) + "</span>" : "") +
        (p.source ? ((p.dynasty || p.author) ? "<span>·</span>" : "") + "<span>" + esc(p.source) + "</span>" : "") +
        (p.selection ? "<span class=\"item-selection\">" + esc(p.selection) + "</span>" : "") +
        // 正文摘句：优先用数据自带的 p.excerpt ——
        // 《宋词三百首》《古文观止》的作品长，截前 16 字往往是「庆历四年春，滕子京谪守巴陵」这类
        // 交代性开头，看不出是哪一篇；语料整理者给出的摘句（多为名句）才能真正认出作品。
        //
        // 但**没有 excerpt 的集子必须回落到「原文前 16 字 + 省略号」**，不能整段不显示：
        //   · 少了摘句那一行，.item-meta 只剩「朝代 · 作者 · 出处」，
        //     卡内 .item-main 又是 `flex: 0 1 auto`（按内容取宽，见 css/classic.css），
        //     内容块于是塌到 141px / 167px，条目右半边空出一大片
        //     （小古文 149.88px、唐诗 124.08px 的空白）——
        //     这正是 Issue #55 要消灭的那种「文字没占满、右边空一截」。
        //   · 小古文与唐诗的数据本来就只有 text，没有 excerpt 字段，
        //     回落就是这两部集子在提取引擎之前一直用的口径（见旧 js/classic.js）。
        // 有 excerpt 的集子（宋词 / 古文观止）行为不变，仍只显示整理者给的摘句。
        (function () {
          var line = p.excerpt != null && String(p.excerpt) !== ""
            ? String(p.excerpt)
            : (p.text ? String(p.text) : "").replace(/\n/g, "").slice(0, 16) + (p.text ? "…" : "");
          return line ? "<span>·</span><span>" + esc(line.replace(/\n/g, "")) + "</span>" : "";
        })() +
        "</div>" +
        "</div>" +
        '<button type="button" class="item-read" title="播放这一篇" aria-label="播放 ' + esc(p.title) + '">' +
        playGlyph() + "</button>" +
        '<div class="item-arrow">' + arrowGlyph() + "</div>";
      el.addEventListener("click", function () { openReader(p); });
      var playBtn = el.querySelector(".item-read");
      playBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        readOne(p, playBtn);
      });
      (groupCard || listEl).appendChild(el);
    });

    // 列表里已有条目正在播放时，进入本页也要显示「暂停」态
    syncItemPlayBtns();
  }

  /** 当前正在朗读的篇目：列表滚动到可见位置并高亮 */
  function highlightItem(id) {
    var el = $(".item[data-id='" + id + "']", listBox());
    if (!el) return;
    el.classList.add("reading");
    if (typeof el.scrollIntoView === "function") {
      try {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      } catch (e) { /* 旧内核不支持参数对象 */ }
    }
  }

  function clearHighlight() {
    $$(".item.reading", listBox()).forEach(function (el) { el.classList.remove("reading"); });
  }

  /* ---------------- 阅读器 ---------------- */

  /** 阅读器里的元素（可能在 root 里，也可能作为页面底部的全局层） */
  function rd(sel) {
    var el = box ? box.querySelector('[data-gw="' + sel + '"]') : null;
    if (el) return el;
    el = root ? root.querySelector('[data-gw="' + sel + '"]') : null;
    return el || document.querySelector('[data-gw="' + sel + '"]');
  }

  /** 阅读器里的元素组（对齐 / 注音按钮那一类） */
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

  function openReader(p) {
    current = p;
    var idx = idIndex(p);
    var el = rd("reader");
    if (!el) return;
    el.querySelector('.rd-title, #rd-title').textContent = p.title;
    var meta = el.querySelector('.rd-meta, #rd-meta');
    // 标签顺序（Issue #55 后续）：朝代 · 作者 · 出处 —— 与列表里的读法一致
    meta.innerHTML =
      (p.dynasty ? '<span class="tag ghost">' + esc(p.dynasty) + "</span>" : "") +
      (p.author ? '<span class="tag ghost">' + esc(p.author) + "</span>" : "") +
      (p.source ? '<span class="tag">' + esc(p.source) + "</span>" : "") +
      (p.selection ? '<span class="tag ghost">' + esc(p.selection) + "</span>" : "");
    renderReaderText();
    el.querySelector('.rd-trans-text, #rd-trans-text').textContent = p.translation || W.pendingTranslation;
    // 译文来源注脚：与首页详情页同一套文案（data/index.js 的 TRANSLATION_SOURCES）
    var srcEl = el.querySelector('.rd-trans-src, #rd-trans-src');
    if (srcEl) {
      srcEl.textContent = p.translation && window.translationSourceText
        ? window.translationSourceText(p) : "";
    }
    // 「第 N / 100 篇」挂在顶栏品牌区与返回键之间，与列表页顶部的「0 / 100 篇」
    // 是同一枚 .count-badge：整行导航只换内容、不换结构。
    var progEl = el.querySelector('.count-badge, #gw-progress');
    if (progEl) {
      progEl.textContent = "第 " + (idx + 1) + " / " + allItems().length + " " + W.unit;
      progEl.classList.toggle("is-done", isRead(p.id));
      progEl.classList.add("is-ready");
    }
    showTransBox(false);
    speakingTarget = "原文";
    renderNav();
    applyFont();
    applyAlign();
    syncPinyinButton();
    syncReadButtons();
    syncDoneButton();
    el.hidden = false;
    document.body.classList.add("reader-open");
    // 顶栏动作位换成「返回」：阅读器是全屏层，这一颗合上它、回到列表；
    // 图标形状由 chrome.js 统一给（与其它页面的返回键同一个箭头），
    // 这里只交代「点了干什么」。
    if (window.SiteChrome) {
      window.SiteChrome.setHeaderAction({ label: W.backToList, onclick: closeReader });
      // setHeaderAction 会按顺序重绘**所有**顶栏，重绘后顶栏是空的，
      // 第二行要再补一次（chrome:ready 那套不会为它触发）。
      paintSub();
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
    const prevBtn = rd("prev");
    const nextBtn = rd("next");
    if (!prevBtn || !nextBtn) return;
    rd("prev-title").textContent = prev ? prev.title : "已是第一篇";
    rd("next-title").textContent = next ? next.title : "已是最后一篇";
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

    var btn = rd("read");
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

  /**
   * 展开 / 收起白话译文。
   * 只切 box.hidden 与按钮状态，**不再往任何元素写按钮文案** ——
   * 早先这里同时写了按钮文字，正好和译文段落抢过 id，导致译文一片空白。
   */
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
    var btn = rd("trans-read");
    if (!btn) return;
    const ok = speechSupported();
    var tbox = rd("trans");
    const boxOpen = !!tbox && !tbox.hidden;
    btn.disabled = !ok;
    btn.title = ok ? "朗读白话译文" : "当前浏览器不支持语音朗读";
    // 暂停中仍是「在读译文」：按钮点下去就是停下来，不会再重读一遍
    const on = ok && boxOpen && !autoReading && speakingTarget === "译文" && readingActive();
    btn.dataset.on = on ? "1" : "0";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    var label = btn.querySelector(".trans-read-label");
    if (label) label.textContent = on ? "停止朗读" : "朗读译文";
  }

  function closeReader() {
    if (window.Speech) window.Speech.stop();
    autoReading = false;
    speakingTarget = "原文";
    var el = rd("reader");
    if (el) el.hidden = true;
    document.body.classList.remove("reader-open");
    // 顶栏动作位还原为「回首页」；这一次重绘同样会清掉第二行，要跟着补回来 ——
    // 漏了这一句，读完一篇返回列表，页名下面那句「想读哪篇点哪篇」就整行消失了。
    if (window.SiteChrome) window.SiteChrome.setHeaderAction(null);
    paintSub();
    current = null;
    renderList();
    syncRandomReadButton();
  }

  function syncDoneButton() {
    if (!current) return;
    var btn = rd("done");
    if (!btn) return;
    // 本挂载点没有已读进度（搜索页）→ 整颗「标记已读」藏起来。
    // 藏而不是删：同一份 HTML 被五页共用，删掉这一颗，另外四页就没了。
    btn.hidden = !hasReadStore();
    if (!hasReadStore()) return;
    const read = isRead(current.id);
    btn.classList.toggle("is-done", read);
    // 「标记已读」现在是一个 SVG 勾选图标，可见文案只保留顶栏右侧的「已读」小字
    btn.title = read ? "已读，再点一次取消" : "标记为已读";
    btn.setAttribute("aria-pressed", read ? "true" : "false");
    var label = btn.querySelector(".sr-only");
    if (label) label.textContent = read ? "已读，再点一次取消" : "标记为已读";
    // 顶栏的篇号牌同步「已读」状态：读过的那篇整枚牌子转成深绿实底，
    // 与列表页里未读 / 已读的区分同一套语言（不再另加一颗小勾图标）。
    var progEl = rd("reader") && rd("reader").querySelector(".count-badge, #gw-progress");
    if (progEl) progEl.classList.toggle("is-done", read);
  }

  /* ---------------- 随机连读 ---------------- */

  function syncRandomReadButton() {
    var btn = $('[data-gw="random"]') || $("#gw-random-read");
    if (!btn) return;
    const ok = speechSupported();
    btn.disabled = !ok;
    // 只有「连读队列真的还在跑」才算进行中：用户中途点「停止」时按钮要立刻复位。
    // 这里认 active()（含暂停中），不能只看 speaking()：部分设备暂停后 speaking 会变 false，
    // 那样按钮会误判成「没在连读」，再点一下就会重新开一轮而不是停下来。
    const running = autoReading && !!(window.Speech && window.Speech.active && window.Speech.active());
    btn.dataset.on = running ? "1" : "0";
    // 与首页「今日背诵」那颗圆键同一套口径：状态只由 ▶ / ⏸ 与 aria-pressed 表达，
    // 可见文案一个字都没有（读屏文案固定，不随播放态改写）。
    btn.setAttribute("aria-pressed", running ? "true" : "false");
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

  /* ---------------- 正文对齐 ---------------- */

  function alignMode() {
    const v = localStorage.getItem(ALIGN_KEY);
    return ALIGNS.indexOf(v) > -1 ? v : DEFAULT_ALIGN;
  }

  /** data-align 交给 CSS 决定 text-align；块本身的居中由 fit-content + margin auto 保证 */
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
    showToast(mode === "left" ? "正文左对齐" : mode === "right" ? "正文右对齐" : "正文居中对齐");
  }

  function showToast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { t.hidden = true; }, 1600);
  }

    /* ---------------- 事件 ---------------- */

  /**
   * 处理函数进门第一句：认领这段 DOM 属于哪一份会话。
   * e.currentTarget 一定落在某一部的 root / box 里，所以能精确认出来；
   * 认出来之后就 liveTo 切过去，后面所有函数读到的 root / items / W
   * 都是「用户刚点的这一部」的，不会串到另一部去。
   */
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
        // 关键词写回本会话：同一页挂两部集子时，甲集里敲的字不能跑到乙集
        s.keyword = search.value;
        keyword = search.value;
        renderList();
      });
    }

    // 「全部 / 未读」是一组组合按钮：同一时刻只有一个是选中态
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

    // 分组「随机连读」：在组内随机，读完自动跳下一篇
    var listEl = listBox();
    if (listEl) {
      listEl.addEventListener("click", function (e) {
        var gbtn = e.target && e.target.closest ? e.target.closest("[data-random-group]") : null;
        if (!gbtn) return;
        claim(e);
        e.stopPropagation();
        var group = gbtn.dataset.randomGroup;
        startRandomRead(allItems().filter(function (p) { return p.gradeGroup === group; }));
      });
    }

    var randomBtn = $('[data-gw="random"]') || $("#gw-random-read");
    if (randomBtn) randomBtn.addEventListener("click", function (e) { claim(e); startRandomRead(null); });

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
      syncCount();
    });

    var transToggle = rd("trans-toggle");
    if (transToggle) transToggle.addEventListener("click", function (e) {
      claim(e);
      var show = this.dataset.on !== "1";
      // 用户主动收起译文框时，若正在读译文，先把这一条停下来
      // （openReader 翻篇时的自动收起走 showTransBox(false)，那里不停朗读 ——
      //   否则会把正在跑的「随机连读」队列一起 cancel 掉）
      if (!show && speakingTarget === "译文" && readingActive()) window.Speech.stop();
      showTransBox(show);
      syncAllReadState();
    });

    var fontUp = rd("font-up");
    var fontDown = rd("font-down");
    if (fontUp) fontUp.addEventListener("click", function (e) { claim(e); changeFont(1); });
    if (fontDown) fontDown.addEventListener("click", function (e) { claim(e); changeFont(-1); });

    // 正文对齐：左 / 中 / 右 三个 SVG 图标，选中态持久化
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

  /**
   * 全站只装一次的监听。
   *   · 语音引擎的 end / cancel —— 停下时把各部的按钮一起复位
   *   · Esc 关阅读器、浏览器返回键关阅读器
   *   · 设置里改「阅读辅助」后（另一个标签页 / 返回本页）立刻同步
   *   · 某一点亮「已读」后，另一部里同一本书的计数跟着刷新
   * 这些都不属于某一块 DOM，所以不进 bindEvents()。
   */
  function bindGlobal() {
    if (bindGlobal.done) return;
    bindGlobal.done = true;

    // 播放栏上的「停止」按钮：用户主动停止连读后立刻复位
    if (window.ReaderPlayer && window.ReaderPlayer.onStop) window.ReaderPlayer.onStop(handleSpeechStopped);

    // 语音朗读结束 / 被中止后同步按钮状态（含连读按钮的复位）
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

    // 列表 → 支持浏览器返回键关掉阅读器
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

    // 从别的页面返回（bfcache）时也重新判定一次档位
    window.addEventListener("pageshow", function () {
      mounts.forEach(function (s) {
        withSession(s, function () {
          if (!current) return;
          renderReaderText();
          syncPinyinButton();
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

/* ---------------- 设置面板（用户名 / 阅读辅助） ----------------
     小古文、唐诗、宋词、古文观止四页都放同一张设置卡片（classic/index.html
     里那份），逻辑也走同一处。这里只处理与本页相关的几项，
     其它设置（年级 / 学期 / 数据备份）仍在设置整页里。 */
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
        // 总开关口径与首页一致：关闭时无论此前存过什么档位都不注音
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

  /* ---------------- 对外接口：一个挂载点一份实例 ---------------- */

  /** 已经挂上的集子（一份 mount 一条） */
  var mounts = [];

  /** 当前打开阅读器的那个挂载点（「返回上一页」时用它收起阅读器） */
  function activeMount() {
    for (var i = 0; i < mounts.length; i++) {
      if (mounts[i].api && mounts[i].api.isOpen()) return mounts[i].api;
    }
    return null;
  }

  function mount(config) {
    var cfg = config || {};
    // 空集合默认不挂（多半是数据没加载上，挂上去只会得到一片空列表）。
    // 例外是 **allowEmpty**：搜索页在用户敲字之前本来就该是空的，
    // 那时列表空是「对的样子」而不是故障（见 js/search.js）。
    if ((!cfg.items || !cfg.items.length) && !cfg.allowEmpty) return null;
    var rootSel = cfg.root || "[data-gw-root]";
    var rootEl = typeof rootSel === "string" ? document.querySelector(rootSel) : rootSel;
    if (!rootEl) return null;
    // 同一块挂在两处 / 重复 mount：退回已有那一个，不再建第二份
    for (var i = 0; i < mounts.length; i++) {
      if (mounts[i].root === rootEl && mounts[i].cfg === cfg) return mounts[i];
    }

    var previous = live;
    var session = {
      root: rootEl,
      box: (cfg.reader ? (typeof cfg.reader === "string" ? document.querySelector(cfg.reader) : cfg.reader) : null) || document.querySelector("[data-gw-reader]"),
      cfg: cfg,
      words: Object.assign({}, DEFAULT_WORDS, cfg.words || {}),
      items: cfg.items.slice(),
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
      // 文案版本号：老版本写下的缓存键跟着一起翻
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
      /**
       * 换掉这一份挂载点所辖的篇目（搜索页的「只看某一部」用它）。
       *
       * 为什么不重新 mount()：mount() 对「同一个 root 又传一份新 config」
       * 有防重 —— 它把第二份当成「同一块挂在两处」而退回**已有那个实例**
       * （一个页面里同一块 DOM 上挂两份实例，两边会互相覆盖状态，
       * 所以那条防重是对的）。于是「改筛选就再 mount 一次」根本不会生效，
       * 页面看起来毫无反应。换篇目是**同一份实例的数据变化**，
       * 该由这里接手：重建 id 索引、重排列表、清掉当前打开的那一篇（它可能
       * 已不在新集合里），其余（已读、注音、对齐、连读）一概不动。
       */
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
    // 交还给上一份会话，免得刚挂完就把别人脚下的变量换了
    if (previous) liveTo(previous);
    return session.api;
  }

  /** 在某一份会话里执行一段代码（执行前后都把现场切回原处） */
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
    // 注音档位由总开关统一裁决（effectivePinyinMode），这里无需预写，
    // 保证「设置里关掉阅读辅助」在任何时候进阅读器都是纯文本。
    if (CFG.setTitle !== false) applyAppName();
    // DOM 事件只在第一份会话建立时绑一次；每颗处理函数进门先认领
    // 「这段 DOM 属于哪一份会话」，所以同一份 HTML 挂多部集子也不会错认。
    //
    // ⚠️ 绑事件必须排在「这一份集合是不是空的」那个判断**之前**：
    //    搜索页在用户敲字之前 items 是空的（见 js/search.js 的 allowEmpty），
    //    早先这里一发现空集合就 return，绑定整段被跳过 ——
    //    搜索框打不进字、候选点不开、阅读器的翻篇键与工具条一概没反应，
    //    页面看起来「加载完了但全是死的」，正是最难查的那种安静失败。
    if (!s.domBound) {
      s.domBound = true;
      bindEvents();
      bindSettings();
      bindGlobal();
    }
    // 空集合：只有 allowEmpty 的挂载点会走到这里（其余各页数据没加载上时
    // 在自己 boot 里就写好了「XX 数据加载失败」，压根挂不到这一步）。
    // 这一支给的是「这一份自己的空态文案」—— 搜索页要的是
    // 「输入篇名、作者或诗句，即可搜遍全站」，不是一句加载失败。
    if (!items.length) {
      var listEl = listBox();
      if (listEl) listEl.innerHTML = '<div class="empty">' +
        esc(CFG.allowEmpty ? W.empty : W.loadingFailed) + "</div>";
      return;
    }
    renderList();
    syncAlignButtons();
    syncRandomReadButton();
  }

  window.ReaderEngine = {
    mount: mount,
    active: activeMount,
    words: DEFAULT_WORDS,
    totalItems: function () { return items.length; }
  };

  /**
   * 兼容别名：小古文页原先对外暴露 window.ClassicProse（测试与宿主页面用它
   * 复位朗读状态）。引擎化之后这套接口由 ReaderEngine 提供，
   * 但 **ClassicProse 这个名字必须留着** —— 改掉它等于把已经跑通的那些
   * 导入 / 自动化脚本悄悄改坏，而调用方只会看到「onSpeechStopped 不存在」。
   * 这里把它指向「当前挂载点」的同一组方法。
   */
  window.ClassicProse = {
    isRead: function (id) { return isRead(id); },
    align: function () { return alignMode(); },
    setAlign: function (m) { return setAlign(m); },
    annotate: function () { return window.Pinyin ? window.Pinyin.annotateHtml(current ? current.text : "") : ""; },
    // 朗读被外部停止（例如系统打断、播放栏停止）后的兜底复位
    onSpeechStopped: handleSpeechStopped
  };

})();
