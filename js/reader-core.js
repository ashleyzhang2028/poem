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
    appName: "跬步",
    // 「加入背诵」（自选集合）的按钮名与提示语，见下方「自选集合」一节
    recite: "加入背诵",
    reciteAdd: "加入自选集合",
    reciteIn: "已在背诵",
    reciteRemove: "移出背诵"
  };

  /* ---------------- 正文收归主表 ----------------
     同一篇作品在几部集子里各存一份正文时（《桃花源记》课内八年级下 + 古文观止卷六、
     《登高》课内高一上 + 唐诗卷五……），正文只该有一份，取**主条目**那一份 ——
     主条目 = 课内条目（教材口径优先）。裁定表在 data/canonical-texts.js，
     由 scripts/build-canonical-texts.js 算出，与 data/works-map.js 同一套口径。

     这一层不改任何一部集子的数据文件：数据照旧各存各的（离线可用、单页只加载自己那一部），
     显示时才替成主条目那一份。于是「学生背的是课本上那一篇」这件事，
     在唐诗页、宋词页、古文观止页里同样成立。

     正文与译文**各自判、各自换**：断行 / 标点不同的（41 条）只有译文要换，
     真正字词有出入的（16 条，如《陋室铭》的引号，《凉州词》的「？」「。」）
     正文才换 —— 选本里那点异文留给校勘，不给学生读两种写法。
     课内条目自己就是主条目，不在表里，读出来仍是它本来的正文。 */
  var canonicalById = null;

  function canonicalMap() {
    if (canonicalById) return canonicalById;
    var list = (typeof window !== "undefined" && window.CANONICAL_TEXTS) || [];
    // ⚠️ 只有**真的拿到表**才缓存 —— 表还没加载进来时缓存一份空表，
    //    之后整页都会「查不到规则」，而现象只是「正文没换」，不报错。
    if (!list.length) return {};
    canonicalById = {};
    list.forEach(function (r) { if (r && r.id) canonicalById[r.id] = r; });
    return canonicalById;
  }

  /**
   * 这一篇的裁定记录。
   *
   * ⚠️ 两种键都要认，因为同一个条目在两类页面里的 id 不一样：
   *   · 集子页里是**集子内 id**（`gw-60`）—— 那一页只加载自己那一部；
   *   · 首页 / 搜索页里是**站点索引 id**（`classic-gw-60`，带集子前缀）。
   * 裁定表按站点索引口径生成（与 data/works-map.js 一致），
   * 所以要再按「所属集子 + 集子内 id」拼一次前缀来找。
   */
  function canonicalRuleFor(p, bookId) {
    var map = canonicalMap();
    var hit = map[p.id];
    if (hit) return hit;
    // 集子页里的 id 没有前缀（`ts-231`），裁定表按站点索引口径记的是
    // `tangshi-ts-231` —— 补上前缀再查一次。
    // ⚠️ 归属要**由调用方传进来**，不能读 CFG：mount 建会话对象时就要求这个值，
    //    而那一刻 liveTo(session) 还没跑，CFG 还是 null（曾因此整张表都对不上）。
    var book = bookId || (CFG && CFG.id) || "";
    if (book) {
      hit = map[book + "-" + p.id];
      if (hit) return hit;
    }
    return null;
  }

  /* ---------------- 正文存储主表（各集子只存归属） ----------------
     同一篇作品的正文 / 译文在磁盘上只落一份，收在 data/text-master.js 的
     window.TEXT_MASTER 里（由 scripts/build-text-master.js 算出）。
     各集子（含课内 12 册）的数据文件里，被主表收编的条目**已摘掉内联正文**，
     改留一行 textRef 指向主条目（`textRef: "poems-cz8-02"`）——
     那一条只存归属（题名 / 作者 / 朝代 / 卷次……），正文由这里按 textRef 取回。

     为什么取回要放在引擎、而不是各页自己拼：
       · 一部集子被六个页面引用（首页、搜索页、四部集子页），
         每个页面各拼一次，迟早有一页忘了拼 —— 表现是「那一页正文空白」，
         不报错、也不在数据层，最难查；
       · 摘内联正文是**存储**决定，仍是**同一份文本**在显示，
         所以这一步对上层（列表、阅读器、朗读、排程、搜索）完全透明。

     ⚠️ 主表没加载（TEXT_MASTER 为空）时**不报错也不糊弄**：
        照原样返回，该条的正文就是空的 —— 与「集子页忘了引 data/text-master.js」
        这个真问题对得上，而不是静默退化成某种看着正常、实则不是原文的东西。
        测试里有一条专门守这件事（见 test/canonical.test.js）。 */
  /**
   * 把条目上的 textRef 展开成正文 / 译文。
   * 取数入口是 data/text-master.js 的 window.masterTextOf —— 站点索引、
   * 搜索页、阅读引擎共用同一个，避免各写一份、某一处忘了取。
   *
   * 主表没加载（TEXT_MASTER 为空）时 masterTextOf 原样返回，
   * 该条正文就是空的 —— 与「这一页忘了引 data/text-master.js」这个真问题对得上，
   * 而不是静默退化成某种看着正常、实则不是原文的东西。
   */
  function withMasterText(p, bookId) {
    if (!p || !p.textRef || p.text) return p;
    var book = bookId || (CFG && CFG.id) || "";
    if (typeof window !== "undefined" && typeof window.masterTextOf === "function") {
      return window.masterTextOf(p, book);
    }
    return p;
  }

  /** 本项目里这一篇**用哪条作品的正文**（没有登记就是它自己） */
  function canonicalOf(p, bookId) {
    if (!p || !p.id) return p;
    // 先按存储主表把 textRef 展开成本条自己的正文 —— 摘掉内联正文的条目
    // 到这里就**重新拿回**正文，后面的显示层裁定、列表、阅读器都不必知道有这回事。
    p = withMasterText(p, bookId);
    var rule = canonicalRuleFor(p, bookId);
    var book = bookId || (CFG && CFG.id) || "";
    if (!rule || !rule.of || rule.of === p.id || rule.of === book + "-" + p.id) return p;
    var byIdx = (typeof window !== "undefined" && window.SITE_INDEX) || null;
    // ⚠️ 变量名不叫 src —— 这个函数上面的作用域里 `$` / `$$` 一族用的是 root / box，
    //    而外层的模块级变量里有一个 `src`（mount 的返回值那个名字在别处），
    //    同名会**遮蔽**外层，取到的就不是主条目那一份了（曾因此正文换了、译文没换）。
    var fromEntry = null;
    // 主条目一律是**课内条目**（裁定表生成时已按这个口径筛过），
    // 而课内条目的 id 只在首页那一套里不带前缀（`cz8-02`），
    // 在站点索引里是 `poems-cz8-02` —— 两种写法都要认。
    var keys = [rule.ofEntry, rule.of, "poems-" + rule.of];
    if (byIdx) {
      for (var k = 0; k < keys.length && !fromEntry; k++) {
        for (var i = 0; i < byIdx.length; i++) {
          if (byIdx[i].id === keys[k]) { fromEntry = byIdx[i]; break; }
        }
      }
    }
    // 集子页（除首页 / 搜索页）**只加载自己那一部**，没有那张全站索引，
    // 但主条目一律是课内条目、课内那 261 首就在 window.POEMS_ALL 里 ——
    // 直接读它，课外各页的裁定才成立（否则「以课本为主」只在首页与搜索页生效）。
    if (!fromEntry && typeof window !== "undefined") {
      var course = window.POEMS_ALL || [];
      for (var c = 0; c < course.length && !fromEntry; c++) {
        if (course[c].id === rule.of || course[c].id === rule.ofEntry ||
            ("poems-" + course[c].id) === rule.ofEntry) fromEntry = course[c];
      }
    }
    if (!fromEntry) {
      // 最后一道兜底：本挂载点若正好就是主条目所在那一部（首页读课内时），
      // 它的篇目里就有那一份。找不到就**照原样显示，不猜** ——
      // 「以课本为主」宁可这一次没生效，也不能拿别篇的正文顶上。
      // （早期这里还有一支「按集子名撞一个」的兜底，那是错的：它会挑中
      //   同一部里**不相干的那一条**，正文换了、译文没换，正是最难发现的那种错。）
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

  /* 全站共用的阅读偏好（不按集子分家）：在唐诗里调过字号，宋词不该又变回去 */
  var FONT_KEY = "poem_classic_font_v1";
  /* 连读偏好的存储键与出厂档：与字号 / 对齐一样是**全站一份** ——
     在小古文里选了「原文 + 白话」，翻到宋词不该又变回随机听原文。
     键名与出厂档**以 js/play-modes.js 为准**（设置页也读那一份），
     这里只是同页取用时的兜底，不再各写一份字面量。 */
  var PLAY_KEY = (typeof window !== "undefined" && window.PlayModes && window.PlayModes.KEY) ||
    "poem_play_mode_v1";
  var DEFAULT_PLAY_MODE = (typeof window !== "undefined" && window.PlayModes &&
    window.PlayModes.DEFAULT) || "seq-origin";
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
    playModeId = s.playMode;
    speakingTarget = s.speakingTarget;
  }

  /** 把当前几个变量的值写回会话（切走之前调一次） */
  function stash(s) {
    if (!s) return;
    s.current = current;
    s.keyword = keyword;
    s.filter = filter;
    s.autoReading = autoReading;
    s.playMode = playModeId;
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

  /* 正文对齐两档：left / center
     古诗短句居中像碑帖，所以默认居中；《少年中国说》这类长古文左对齐更好读，
     由用户在工具条上用图标自己选，选择记在本机。
     文章一律横排，右对齐没有使用场景，故不设。 */
  const ALIGNS = ["left", "center"];
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
  /** 组合播放键选定的播放模式 id（播放偏好，写进本机，跨集子共用一份） */
  let playModeId = DEFAULT_PLAY_MODE;
  /** 组合播放键当前朗读的是哪一段：「原文」/「译文」/「原文+译文」 */
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
    // authorName：选本署「字」而数据另给了常用姓名（《昭明文选》），
    // 两种写法都要能搜到 —— 用户多半记得的是「王粲」而不是「王仲宣」。
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

  /** 清掉一个定时器（可能为 null）—— 长按判定的按下 / 抬起两边都要用 */
  function closeTimeout(t) {
    if (t) clearTimeout(t);
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
   * 分组右侧组合播放键里的图标：一枚 ▶ 与一枚小写法点。
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
          // 分组右侧是**组合播放键**：点一下按当前模式连读本组，
          // 长按 / 右键从五种模式里挑一种（见本节末尾的 PLAY_MODES）。
          // 它仍是全站同一枚圆形播放键的小号档，不带可见文字 ——
          // 但组合键必须让人看出「它不只是随机」：圆环里那颗 ▶ 右下角
          // 缀一枚小写法点（.play-mode），模式名与读屏文案由引擎写入。
          //
          // ⚠️ 圆键的可见文字**只有一个来源**：这枚 .gw-play-input 槽位。
          // 组合键的菜单（五个模式名）就长在这颗按钮里，渲染后一定在 DOM 里 ——
          // 所以「圆键有没有可见文字」既不能用 textContent 量（会量到菜单项），
          // 也不能靠菜单 hidden 与否去猜。槽位之外的一切都不进可见文字：
          //   · .play-mode —— 只画一枚 3.5px 小点，字交给按钮的
          //     aria-label / title（见 syncPlayBtn）；
          //   · .gw-menu  —— 菜单项的文字属于**菜单**；菜单收起时 hidden，
          //     展开时整棵从可访问性树里退出去（aria-hidden + inert，
          //     见 togglePlayMenu），读屏念到的仍是按钮自己那句话。
          // 圆键上要显示文字时（若哪天需要）写进这个槽位，别再往按钮根上写。
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
        (p.author ? (p.dynasty ? "<span>·</span>" : "") + "<span>" + esc(p.author) +
          (p.authorName && p.authorName !== p.author ? "（" + esc(p.authorName) + "）" : "") + "</span>" : "") +
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
        // 右侧三件套：加入背诵（书签）· 播放 · 箭头。
        // 「加入背诵」在最前：它是**选择**（把这一篇收进自己的清单），
        // 播放与箭头是**动作**（现在听 / 进去读），选择排在动作前更像目录。
        // 列表上的「加入背诵」圆键由 config.reciteList 控制：
        //   五部集子（默认 true）挂它 —— 课外那一篇要用户主动收进来才进背诵；
        //   课内诗词索引页（false）不挂 —— 那 261 首本来就在每日任务里，
        //   再挂一枚会让人以为「不点它就不会被排上」（见 js/poems.js 文件头）。
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

    // 每张卡头都补一份模式菜单（节点在模板里，五个模式项在渲染后填）——
    // 用事件委托也会被「列表整块重建」清掉选中态，不如重建时一起写全。
    $$(".group-head .gw-play-sm .gw-menu", listEl).forEach(renderPlayMenu);


    // 列表里已有条目正在播放时，进入本页也要显示「暂停」态
    syncItemPlayBtns();
    syncPlayBtn();
    syncListItemReciteButtons();
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
    // ⚠️ 一律走 itemsById 取「本挂载点里那一份」：传进来的可能是**原始数据对象**
    //    （列表点击传的是重绘时用的 items 元素，那一份已经过主表裁定；
    //     但外部调用 api.open('ts-231') 传的是调用方自己手里的对象），
    //    直接用它就绕过了「正文收归主表」的裁定 —— 正文换了、译文没换的
    //    那种半半拉拉的现象就是这么来的。取不到才退回传进来的那一个。
    if (p && p.id && itemsById[p.id]) p = itemsById[p.id];
    current = p;
    var idx = idIndex(p);
    var el = rd("reader");
    if (!el) return;
    el.querySelector('.rd-title, #rd-title').textContent = p.title;
    var meta = el.querySelector('.rd-meta, #rd-meta');
    // 标签顺序（Issue #55 后续）：朝代 · 作者 · 出处 —— 与列表里的读法一致
    // 作者一栏：选本的题署多为**字**（《昭明文选》署「王仲宣」「班孟坚」），
    // 数据另给了常用姓名 authorName。两者不同时一并显示 ——
    // 只写「王仲宣」认得的人少，只写「王粲」又改了原书的题署。
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
    syncReciteButtons();
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
    // 「上一篇 / 下一篇」的篇名由 .nav-title 的 ellipsis 截断 —— 长篇名
    //（《唐诗三百首》里有 150 字的题目）在这条窄按钮里必然看不全。
    // 给它补一个 title：截断之后仍可悬停 / 长按看到全名。
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
    // 卡头的组合播放键不是 .item-read 那一类，syncAllReadState 管不到它 ——
    // 少了这一句，从播放栏按「停止」之后卡头那颗还亮着 ⏸，用户再点一下
    // 会以为要点第二次才停（其实队列早没了）。
    syncPlayBtn();
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

  /* ---------------- 播放模式（组合播放键） ----------------
     每部集子的**分类卡头**右侧是一颗组合播放键：点一下按当前模式开听，
     长按（或鼠标右键）从五种模式里挑一种。五种模式就是「听什么 × 怎么排」
     两件事的组合：

        听什么         怎么排
        原文           顺序（按目录一篇接一篇）
        白话           随机（打乱后一篇接一篇）

     默认「原文 · 顺序」—— 多数人是坐下来从头听，随机是偶尔的玩法；
     顺序 + 白话 = 一篇文章「原文 → 白话」连着放，等于把每篇读透一遍。
     模式是**偏好**不是状态：选定后写进本机、跨集子共用，下次打开还是它。
     实现上「听什么」交给每一条的文本（原文 / 白话 / 两段连起来），
     「怎么排」交给队列（原序 / 打乱）—— 于是五种模式只落到两个变量上，
     播放栏、暂停 / 继续 / 上一首 / 下一首一概不用分模式改。

     挑模式的三条路（都落在同一颗键上，不额外占版面）：
       · 长按 500ms（触屏）
       · 右键（鼠标）
       · 读屏用户走 aria-label，模式名写全，不依赖菜单

     「原文白话顺序播放」为什么合成**一条**队列而不是两条：
       合成两条（先读完全部原文、再读完全部白话）听感上完全是另一件事；
       用户说的是「顺序播放」，那就一篇一篇来 —— 每篇原文读完接白话，
       白话读完接下一篇。整段文本一次交给语音引擎还有个好处：
       引擎按句读的停顿刚好落在「。原文。白话。」的接缝上，不用自己拼停顿。 */
  /* 五档模式的定义**不在这里** —— 见 js/play-modes.js。
     它同时被设置页（js/settings.js）读，两份各写一遍必然错开，
     所以「有哪五档、存哪个键、出厂是哪一档」只留一份。 */
  var PLAY = (typeof window !== "undefined" && window.PlayModes) || null;
  var PLAY_MODES = PLAY ? PLAY.LIST : [];
  function modeOf(id) {
    if (PLAY) return PLAY.of(id);
    for (var i = 0; i < PLAY_MODES.length; i++) {
      if (PLAY_MODES[i].id === id) return PLAY_MODES[i];
    }
    return null;
  }

  /** 本机存下的播放模式；没存过 / 存了不认识的值 → 出厂档「原文 · 顺序」 */
  function playMode() {
    return PLAY ? PLAY.read() : DEFAULT_PLAY_MODE;
  }

  function playModeInfo() {
    return modeOf(playModeId) || modeOf(playMode()) || modeOf(DEFAULT_PLAY_MODE);
  }

  /**
   * 组合播放键的读屏文案。
   *
   * 可见文字是**没有的**（与全站其它播放键一致，状态只由图标表达），
   * 所以「它现在是哪种模式、点下去会发生什么」必须由 aria / title 说全 ——
   * 读屏用户看不到弹出菜单里的字，只能靠这两处。
   */
  function playBtnAria(mode) {
    var m = mode || playModeInfo();
    return m.label + "，当前：" + m.short + (m.note ? "；" + m.note : "");
  }

  function setPlayMode(id) {
    if (!modeOf(id)) return false;
    // 只改「下次怎么放」，不动正在跑的那一轮：autoReading 是状态，模式是偏好。
    // 刚刚在跑的那一份去 startPlay 里显式复位，别在这里替它下结论。
    if (PLAY) { PLAY.write(id); PLAY.emit(id); } else { localStorage.setItem(PLAY_KEY, id); }
    syncPlayBtn();
    showToast(modeOf(id).label);
    return true;
  }

  /** 同步**本挂载点**每一颗卡头组合键（▶ / ⏸ 原地切换，与全站同一套状态表达） */
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
      // 右下角那枚小点**不写文字**（见 css/classic.css 的 .play-mode）----
      // 它就是一枚「这颗键不止一种用法」的记号，模式名写在按钮自己的
      // aria-label / title 里（上面那句）。原先这里往小点里写 info.short，
      // 「原文 · 顺序」于是进了圆键的 textContent —— 圆键在文本层面不再是空的，
      // 读屏会把五个菜单项连在一起念，PWA 层「没有可见文字」的断言也会红。
      // 留一个 data-short 供排障 / 断言取用，不占可见文本。 */
      btn.dataset.playShort = info.short;
    });
    // 五种模式都是「连读整页」，工具栏那颗圆键与卡头这颗是同一件事的两个入口，
    // 状态必须同步 —— 否则一边 ⏸、一边 ▶，用户会以为有两条队列在跑。
    // 单向：syncPlayBtn → syncRandomReadButton，反向不再调回来（会死循环）。
    syncRandomReadButton();
  }

  /**
   * 本挂载点列表里**每一颗**卡头组合键。
   *
   * 写法必须是「卡头里的 .gw-play-sm」（而不是按 id / 数组下标取第一颗）：
   * 同一份列表会被 renderList 反复重建，而**搜索一次、翻一页、切一次「未读」
   * 之后分组根本不一样** —— 哪一颗是第一颗完全看当下筛出什么。
   * 早先只同步第一颗，于是搜出来只剩「人物故事」一组时，
   * 那颗键的模式记号是空的（用户看着像坏了）。
   */
  function headPlayBtns(scope) {
    var el = scope || listBox();
    if (!el) return [];
    return $$(".group-head .gw-play-sm", el);
  }

  /** 关闭所有卡头的模式菜单 */
  function closePlayMenus() {
    $$all(".gw-menu").forEach(function (m) {
      m.hidden = true;
      m.setAttribute("aria-hidden", "true");
      var owner = m.parentNode;
      if (owner && owner.removeAttribute) owner.removeAttribute("data-menu");
    });
  }

  /** 弹出 / 收起某一颗卡头圆键的模式菜单 */
  function togglePlayMenu(btn) {
    if (!btn) return;
    var menu = btn.querySelector(".gw-menu");
    if (!menu) return;
    var open = menu.hidden;
    closePlayMenus();
    if (!open) return;
    // 菜单是**浮层**，不是这颗按钮的一部分：展开时把它整棵从可访问性树里
    // 退出去（aria-hidden + inert）。菜单项的读屏文案由「键盘 / 指针自己走到
    // 哪一项」那一套给（role=menuitemradio + aria-checked），不需要让它
    // 冒充按钮内容 —— 否则读屏念按钮名时会把五个模式名连起来念一遍。
    var cur = playModeInfo().id;
    $$("button", menu).forEach(function (m) {
      var on = m.dataset.mode === cur;
      m.classList.toggle("active", on);
      m.setAttribute("aria-checked", on ? "true" : "false");
    });
    btn.dataset.menu = "1";
    menu.hidden = false;
    // 展开的菜单是浮层：不进按钮的可见 / 可访问名称（见上方注释与手记）。
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

  /**
   * 某一颗卡头圆键要连读的「池子」（不含顺序；顺序由模式决定）：
   *   · data-random-group → 本组（分类卡头那颗）
   *   · 不传 btn           → 整页（工具栏那颗圆键）
   * **池子一律是「用户眼前这一份可见列表」的子集**：搜索框里敲了字、
   * 或者切到「未读」，连读就该只连读搜到 / 没读的那几篇 ——
   * 「点一颗键，听我现在看到的这些」比「偷偷连读整本集子」好懂。
   */
  function playPool(btn) {
    // 没有元素 = 工具栏那颗「整页」圆键；它与带 data-play-group=all 的那条是同一个池子
    if (!btn) return visibleItems();
    var group = btn.dataset.randomGroup;
    // 两种池子都是「用户眼前这一份可见列表」的子集：
    // 搜索框里敲了字，连读就该只连读搜到的那几篇；切了「未读」同理。
    var shown = visibleItems();
    if (!group) return shown;
    return shown.filter(function (p) { return p.gradeGroup === group; });
  }

  /** 模式 → 队列条目：听什么（source）落成文本，怎么排（order）落成顺序 */
  function buildQueue(pool, mode) {
    var self = live;   // 队列异步跑，onStart 里要回到这一份会话的现场
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

  /**
   * 组合播放键的主入口：按当前模式开听 / 再点停止。
   * 工具栏那颗圆键也走这里（pool 传整页），所以「点哪颗都是同一件事」。
   * @param {HTMLElement} [btn]  卡头圆键；不传 = 整页
   */
  function startPlay(btn) {
    if (!speechSupported()) {
      showToast("当前浏览器不支持语音朗读");
      return;
    }
    // 再点一次 = 停：播放栏、列表高亮、两颗圆键一起复位
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
      // 「整页没得读」与「这一组抽不出可读的篇目」是两回事，文案分开说：
      // 后者多半是选了「白话」而这一组正好都没译文（《古文观止》的待补条目）
      showToast(btn
        ? "本分类暂无" + (playModeInfo().source === "原文" ? "可读篇目" : "译文可读")
        : W.noReadable);
      return;
    }
    closePlayMenus();
    autoReading = true;
    syncPlayBtn();

    // items / onIndex 里的 openReader / highlightItem 读的是**当前会话**的现场，
    // 而队列是异步一条条读的 —— 中间很可能已经切到别的挂载点（搜索页同时挂两部）。
    // 所以这里把现场钉在本会话上，别让「甲组连读」把乙集的阅读器打开。
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

  /* ---------------- 连读圆键的状态（工具栏那颗） ---------------- */

  /**
   * 工具栏那颗圆键（整页连读）的 ▶ / ⏸。
   *
   * ⚠️ 这里**不再自己算 running**：卡头组合键与它管的是同一件事，
   * 状态必须由同一处得出 —— 原先两边各写一遍 autoReading && active()，
   * 一旦有一边漏同步（例如从播放栏停的），另一边的 ▶ 就骗人。
   * 现在由 syncPlayBtn() 统一收口，本函数只负责工具栏那颗自身的属性。
   */
  function syncRandomReadButton() {
    var btn = $('[data-gw="random"]') || $("#gw-random-read");
    if (!btn) return;
    const ok = speechSupported();
    btn.disabled = !ok;
    const running = autoReading && !!(window.Speech && window.Speech.active && window.Speech.active());
    btn.dataset.on = running ? "1" : "0";
    // 与首页「今日背诵」那颗圆键同一套口径：状态只由 ▶ / ⏸ 与 aria-pressed 表达，
    // 可见文案一个字都没有（读屏文案固定，不随播放态改写）。
    btn.setAttribute("aria-pressed", running ? "true" : "false");
    // 键义里带上当前模式：这颗键与卡头那颗同一模式，读屏用户也听得到
    btn.title = running ? "停止连读" : playBtnAria();
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
    showToast(mode === "left" ? "正文左对齐" : "正文居中对齐");
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

    // 分类卡头的组合播放键：点一下按当前模式连读本组，长按 / 右键挑模式。
    // 不能在这里直接 startPlay —— 触摸长按之后浏览器还会补一次 click，
    // 那一下会把刚挑好模式的连读又停掉。所以 click 先过一道「刚刚开过菜单」的门。
    var listEl = listBox();
    if (listEl) {
      var menuOpenedAt = 0;
      listEl.addEventListener("click", function (e) {
        var target = e.target;
        if (!target || !target.closest) return;
        claim(e);
        // 菜单项：先选模式，再就地开听（「选完就放」比「选完再点一次」少一步）
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
        // 这一下是「按一下键」还是「点菜单项」？
        //   点菜单项 → 上面那一支已经处理掉了；
        //   按一下键 → 短按连读、长按弹菜单。
        // 早先想「短按开菜单、长按也弹菜单」，结果两头打架：
        // 长按弹出来的菜单会被紧跟着松手时的那一次 click 收掉（用户看到菜单一闪）。
        // 现在分工明确：短按 = 开听，长按 / 右键 = 挑模式，
        // 长按之后的那一次 click 用时间窗吞掉，不再有第二含义。
        if (Date.now() - menuOpenedAt < 700) return;
        startPlay(gbtn);
      });
      // 长按 = 挑模式。pointerdown / pointerup 在 iOS 上也覆盖触摸，
      // 500ms 与系统长按的体感一致；不动就不认，避免手指划过也弹菜单。
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
      // 鼠标右键：桌面上最直接的「挑模式」
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
    // 点列表以外的地方收起菜单（列表内的点击由上面的委托自己管：
    // 它要区分「收起」「选模式」「开听」三件事，文档级再补一刀会把刚打开的菜单立刻收掉）
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (t && t.closest && t.closest("#gw-list [data-random-group], #gw-list [data-play-group]")) return;
      if (t && t.closest && t.closest(".gw-menu")) return;
      closePlayMenus();
    });

    // 工具栏那颗圆键与卡头那颗是同一件事（连读整页），共用 startPlay ——
    // 只是它不给菜单：整页不归任何分类，模式仍由卡头那颗选定。
    var randomBtn = $('[data-gw="random"]') || $("#gw-random-read");
    if (randomBtn) {
      // 不带元素 = 「整页」这个池子（见 playPool）
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
      syncCount();
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

    // 正文对齐：左 / 中 两个 SVG 图标，选中态持久化（右对齐无使用场景，已删除）
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

    // 自选集合变化（某个页面加了 / 移了一篇）：其余打开着的页面同步按钮状态。
    // 引擎里按钮是现画的，不会自己变 —— 不补这一条，在别的标签页加过之后
    // 回到这一页，那一篇仍显示「未加入」。
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
      // 每一篇都先过一遍主表裁定：正文与译文取主条目那一份
      // （见上方「正文收归主表」）。判重、排程、搜索用的仍是各自的条目 id。
      // src 留着这一部**自己的原稿**：裁定表是覆盖式的，重判必须从原稿起
      // （否则第二次判的就是上一次的结果，规则永远不再生效）。
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
       * 按主表裁定重算一次正文 / 译文。
       *
       * 为什么需要它：裁定表只登记「用哪一条的正文」，真正那一份要从站点索引里取；
       * 而索引是各页自己决定的（集子页只加载自己那一部）。若一类页面先挂载、
       * 之后索引才齐备，挂载那一刻取到的就不是主条目那一份。
       * 重算用的是**同一条规则**，永远不猜、不拼。
       */
      refreshCanonical: function () {
        return withSession(session, function () {
          // ⚠️ 这里要拿 **config 里那份原稿** 重判，不能拿 session.items ——
          //    「用主条目那一份」是个**覆盖**动作：第一次判过之后
          //    items 里已经是主条目的正文了，再判一次只会判它自己
          //    （of === id，规则不生效），于是索引后到的页面永远换不过来。
          //    session.src 是 mount 时留下的那份「这一部自己的语料」，只读、不改。
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
            // 阅读器正开着：正文与译文就地更新一次
            renderReaderText();
            var tt = box.querySelector(".rd-trans-text, #rd-trans-text");
            if (tt) tt.textContent = current.translation || W.pendingTranslation;
          }
          renderList();
          syncCount();
          return arr.length;
        });
      },
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
    // 「输入篇名、作者或诗句，即可搜遍六部集子」，不是一句加载失败。
    if (!items.length) {
      var listEl = listBox();
      if (listEl) listEl.innerHTML = '<div class="empty">' +
        esc(CFG.allowEmpty ? W.empty : W.loadingFailed) + "</div>";
      return;
    }
    renderList();
    syncAlignButtons();
    syncRandomReadButton();
    // 这一页加载了完整的站点索引（搜索页六部齐备）时，顺手把自选集合的
    // 快照刷新一次 —— 语料订正过（标题 / 正文改过）之后，老快照不会一直旧着。
    // 集子页只加载自己那一部，refreshSnapshots 在索引里找得到的那些会更新。
    if (window.ReciteCollections && window.ReciteCollections.refreshSnapshots) {
      window.ReciteCollections.refreshSnapshots(window.SITE_INDEX || []);
    }
    // 主表裁定的正文（data/canonical-texts.js 要查站点索引）在这一刻可能才齐备：
    // 让 api 自己按同一条规则重判一次，免得这一页显示的还是旧的一份正文。
    if (session.api && session.api.refreshCanonical) session.api.refreshCanonical();
  }

/* ---------------- 自选集合：把这一篇「加入背诵」 ----------------
   与「标记已读」是两回事：
     · 已读   —— 这一部集子里的阅读进度（poem_classic_read_v1 等），只为记录
     · 加入背诵 —— 把这一篇放进**用户自己的清单**（js/collections.js），
                   进了清单就会由遗忘曲线安排复习，与课内 261 首同一套排程

   自选集合与「唐诗三百首」那几部集子不是一回事：集子是既定选本、篇目不可改，
   自选集合是用户自己的清单、想加就加想删就删、**不分任何组**
   （用户原话：「集合没有必要添加分组了」）。

   入口有两个（用户原话「在索引列表或者详情页把他们添加到背诵」）：
     · 索引列表 —— 每条右边一枚「加入背诵」圆键（与播放键同一档）
     · 详情页   —— 阅读器工具条上那枚「加入背诵」（与「标记已读」同一行）

   按下之后不是直接塞进某个集合，而是弹一枚**集合选择器**：
   勾选要放进的集合、或新建一个。一篇可以在多个集合里，各存一份引用，
   排每日任务时按作品去重（同一篇只背一次）。
   全部集子页面共用这一份引擎，所以六个页面一处实现、处处可用。 */

  /** 这一篇当前的状态：{ in: bool, collections: [...] } */
  function reciteState(p) {
    if (!p || !window.ReciteCollections) return { in: false, collections: [] };
    var cols = window.ReciteCollections.collectionsOf(p.id);
    return { in: cols.length > 0, collections: cols };
  }

  function reciteGlyph() {
    // 加入背诵：一枚「书签」轮廓，未加入时是空心，加入后填充态由 CSS 给
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M7 4.6h10a1.4 1.4 0 0 1 1.4 1.4v13.4l-6.4-4.1-6.4 4.1V6a1.4 1.4 0 0 1 1.4-1.4Z"/>' +
      "</svg>";
  }

  /** 列表条目右侧的「加入背诵」圆键 */
  function reciteItemBtn(p) {
    var on = reciteState(p).in;
    var label = on ? W.reciteIn : W.reciteAdd;
    return '<button type="button" class="item-recite" data-recite="' + esc(p.id) + '"' +
      ' data-on="' + (on ? "1" : "0") + '"' +
      ' title="' + esc(label) + '" aria-label="' + esc(p.title) + "：" + esc(label) + '"' +
      ' aria-pressed="' + (on ? "true" : "false") + '">' + reciteGlyph() + "</button>";
  }

  /** 同步列表里所有「加入背诵」圆键的状态（列表整块重建后调用） */
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

  /** 详情页工具条上的「加入背诵」：没进阅读器就不显示 */
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

  /** 集合选择器：列出全部自选集合（可多选）+ 新建一个 + 移出全部 */
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
    // 与设置弹层同一套：弹层打开时锁住页面滚动（点击遮罩 / 关闭键再放开）
    document.body.style.overflow = "hidden";
    renderRecitePicker();
  }

  /** 重绘选择器内容（勾选态、集合列表、空态） */
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
      box.innerHTML = '<div class="recite-empty">还没有自选集合。' +
        "下面输入一个名字，新建第一个 —— 加进来的篇目会跟着遗忘曲线一起复习。</div>";
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

  /**
   * 选择器事件绑定（只绑一次）。
   * 勾选 = 加入 / 移出该集合；「新建」= 建一个集合并把这一篇放进去；
   * 每次操作后同步列表与详情页按钮，并给一句 toast 交代结果。
   */
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
          showToast("已加入「" + (C.get(cid) ? C.get(cid).name : "") + "」，跟着遗忘曲线一起复习");
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

  /**
   * 把这一篇的正文顺手存进快照。
   *
   * 集子索引页并不加载全站总索引（只加载自己那一部），
   * 所以 collections.add() 那一刻查不到这一条 —— 首页也就拿不到正文。
   * 这里把当前这一篇（引擎手里的对象就带着正文/译文）直接交给集合模块存下来。
   * 搜索页 / 首页有完整索引时，refreshSnapshots 会再覆盖一次，口径一致。
   */
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

  /**
   * 按下「加入背诵」（列表圆键或详情页按钮）。
   * 集合为空时直接建第一个集合，一步到位（用户在详情页只按了一颗键，
   * 不该再让他先想「放进哪个集合」—— 那正是第一次用这个功能时的样子）；
   * 已经有集合了则弹集合选择器让他挑。
   */
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
