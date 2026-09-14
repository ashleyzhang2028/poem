/**
 * 背诵 App 主逻辑（课内古诗词 · 按遗忘曲线复习）
 */
(function () {
  "use strict";

  const $ = function (sel, root) {
    return (root || document).querySelector(sel);
  };
  const $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  const STAGES = {
    primary: { name: "小学", grades: [1, 2, 3, 4, 5, 6] },
    middle: { name: "初中", grades: [7, 8, 9] },
    high: { name: "高中", grades: [10, 11, 12] }
  };

  // 应用正式名称（固定，不随用户名变化）
  const APP_NAME = "跬步";

  /* 字号六档：古诗词默认比小古文再小一号（19 → 17），长诗一屏能多读两行；
     最小的 13px 是 Issue #55 追加的一档 —— 默认档不动，A－ 在最细处多点一次仍有效果 */
  const FONT_KEY = "poem_font_v1";
  const FONT_SIZES = [13, 15, 17, 19, 21, 23];
  const DEFAULT_FONT = 17;

  /* 正文对齐两档：left / center，默认居中（与小古文详情页一致）
     文章一律横排，右对齐没有使用场景，故不设。 */
  const ALIGN_KEY = "poem_align_v1";
  const ALIGNS = ["left", "center"];
  const DEFAULT_ALIGN = "center";

  // 注音档位：off 关闭 ｜ rare 只标生字（默认）｜ all 全文注音
  const PINYIN_KEY = "poem_helper_pinyin_v1";
  const PINYIN_MODES = ["off", "rare", "all"];
  const DEFAULT_PINYIN_MODE = "rare"; // 新版默认「只标生字」

  let settings = Storage.getSettings();
  let todayPlan = [];
  let currentPoem = null;
  let todayKey = "";
  /** 组合播放键当前读的是哪一段：「原文」/「译文」 */
  let speakingTarget = "原文";

  /* ---------------- 阅读辅助：注音 / 朗读 ---------------- */
  /**
   * 「阅读辅助」是全局开关，开启与关闭有**可见差别**：
   *   开启 —— 打开任意一首诗，正文自动逐字注音（可随时手动关掉）
   *   关闭 —— 打开诗词是纯文本，需要时才手动点「标注拼音」
   * 朗读按钮两种状态下都可用（它需要用户手势，本就不做自动播放）。
   */
  function helperEnabled() {
    return settings.helper !== "off";
  }

  /**
   * 当前注音档位。
   *
   * 关键：总开关是「权威」。
   *   关闭 —— 无论此前存过什么档位，一律返回 off，
   *           否则会出现「阅读辅助 = 关闭」却仍然满屏拼音，开关形同失效；
   *   开启 —— 用用户手动选过的档位，没选过就用出厂档位「只标生字」。
   *
   * 兼容旧版布尔开关：旧值 "1" ⇒ 只标生字（新版默认），"0" ⇒ 视为未选。
   */
  function pinyinMode() {
    // 总开关关闭 → 一律不注音（权威）
    if (!helperEnabled()) return "off";
    const v = localStorage.getItem(PINYIN_KEY);
    // 手动选过的档位优先（「不注音」会同步把总开关关掉，不会走到这里）
    if (PINYIN_MODES.indexOf(v) > -1) return v;
    return DEFAULT_PINYIN_MODE;
  }

  function setPinyinMode(mode) {
    const m = PINYIN_MODES.indexOf(mode) > -1 ? mode : "off";
    localStorage.setItem(PINYIN_KEY, m);
    // 两处状态必须一致：选「不注音」= 关掉阅读辅助；选「生字/全文」= 打开阅读辅助
    const want = m !== "off";
    if (helperEnabled() !== want) {
      settings.helper = want ? "on" : "off";
      Storage.saveSettings(settings);
      renderGradeChips();
    }
  }

  /** 是否处于注音状态（rare / all 都算开启） */
  function pinyinOn() {
    return pinyinMode() !== "off";
  }

  /** 传给 Pinyin.annotateHtml 的模式："all" 或 "rare" */
  function pinyinRenderMode() {
    return pinyinMode() === "all" ? "all" : "rare";
  }

  /**
   * 切换「阅读辅助」全局开关后，让差别当场可见：
   *   开启 —— 回到默认档位「只标生字」；关闭 —— 回到「不注音」。
   * 手动选过的档位不跨开关保留，避免开关看起来没反应。
   */
  function resetPinyinMode() {
    localStorage.setItem(PINYIN_KEY, helperEnabled() ? DEFAULT_PINYIN_MODE : "off");
    if (currentPoem) renderPoemText(currentPoem);
    syncPinyinBtn();
  }


  /* ---------------- 工具 ---------------- */
  function todayKeyStr() {
    const d = new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  /** 用户名：留空时用默认名称「Ashley」，顶栏与标题都按它显示 */
  const DEFAULT_USER = "Ashley";

  function userName() {
    const n = String(settings.username == null ? "" : settings.username).trim();
    return n || DEFAULT_USER;
  }

  /**
   * 页面主标题：应用正式名固定为「跬步」，用户名永远显示
   * → 「跬步 · Ashley的背诵」（用户没填名字时用默认名，不留一段空白）
   *
   * 措辞：「XX的古诗词」→「XX的背诵」。这一页管的是
   * 「按遗忘曲线安排复习、今天背这一首」这件事，名字上就该说清 ——
   * 「古诗词」是体裁（站上还有小古文、唐诗、宋词、古文观止），
   * 「背诵」才是这一页在干的事。
   */
  function appTitle() {
    return APP_NAME + " · " + userName() + "的背诵";
  }

  /**
   * 把应用名同步到页面标题、顶栏「跬步 · XX的背诵」、iOS 桌面名与 PWA 清单。
   *
   * 顶栏第一行是「跬步 · 当前页名」：首页写「XX的背诵」，
   * 其余页面由各页自己给页名（见 js/chrome.js 的 data-page）。
   * 用户名留空时用默认名 Ashley，不留空档。
   */
  function applyAppName() {
    const title = appTitle();
    // <title>：「XX的背诵 · 跬步」—— 应用名在后，与其余各页同一口径。
    // 曾写「跬步 · XX的古诗词 · 古诗词背诵」，同一句话里出现两次「背诵」、
    // 应用名还前后各一份，读起来像三条不同的信息。
    document.title = title + " · " + APP_NAME;
    const h1 = $("#brand-name");
    if (h1) h1.textContent = APP_NAME;
    // 第一行页面名：首页是「XX的古诗词」，与「跬步」同字体、同一行
    syncBrandPage();

    $$('meta[name="apple-mobile-web-app-title"]').forEach(function (m) {
      m.setAttribute("content", title);
    });

    // 安卓/桌面安装后的应用名同步为「跬步」
    const link = $('link[rel="manifest"]');
    if (link && window.Blob && window.URL && URL.createObjectURL) {
      try {
        const manifest = JSON.parse(JSON.stringify(window.__manifest || {}));
        if (manifest.name) {
          manifest.name = title;
          manifest.short_name = APP_NAME;
          const blob = new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" });
          const url = URL.createObjectURL(blob);
          if (link.dataset.blobUrl) URL.revokeObjectURL(link.dataset.blobUrl);
          link.dataset.blobUrl = url;
          link.href = url;
        }
      } catch (e) {
        /* 清单更新失败不影响主流程 */
      }
    }

    // 第二行副标题跟着当前复习算法走（「按 X 复习」）
    applyAlgoSub();
  }

  /**
   * 顶栏第一行的页面名：首页写「XX的背诵」，排在「跬步」右侧。
   * js/chrome.js 渲染完顶栏会派发 chrome:ready，收到后再写一次，
   * 否则刷新页面时 app.js 先跑、DOM 里还没有 #brand-page-text，用户名就丢了。
   */
  function syncBrandPage() {
    const el = $("#brand-page-text");
    const page = $("#brand-page");
    if (!el) return;
    el.textContent = userName() + "的背诵";
    if (page) page.hidden = false;
    // 默认名 Ashley 与用户自己的名字在视觉上要做区分：默认名走淡墨
    el.classList.toggle("is-default", !String(settings.username || "").trim());
  }

  function stageOf(grade) {
    if (grade <= 6) return "primary";
    if (grade <= 9) return "middle";
    return "high";
  }

  function gradeName(g) {
    return window.GRADE_NAMES[g] || (g + "年级");
  }

  function termName(t) {
    return t === 1 ? "上学期" : "下学期";
  }

  function provider(grade, term) {
    return window.getPoemsByGradeTerm(grade, term);
  }

  /** 当前背诵范围配置（见 js/scheduler.js 的 SCOPES） */
  function scopeKey() {
    return Scheduler.SCOPES[settings.scope] ? settings.scope : Scheduler.DEFAULT_SCOPE;
  }

  /**
   * 当前复习调度算法（见 js/review-models.js）。
   *
   * 认不出来的一律退回出厂默认「遗忘曲线」—— 本机存了个野生值时，
   * **界面上说的**与**引擎真正用的**必须是同一个（否则用户看到「按 FSRS 复习」，
   * 排出来的却是固定间隔表）。
   */
  function algoKey() {
    if (!window.ReviewModels) return "ebbinghaus";
    return window.ReviewModels.known(settings.algo) ? settings.algo : window.ReviewModels.DEFAULT_KEY;
  }

  /**
   * 顶栏第二行 = 「按 X 复习」，跟着当前算法走。
   *
   * 需求原话：「背诵页面现在的副标题是『按遗忘曲线复习』，以后用户选择哪种，
   * 就显示哪种，例如『按 SM-2 复习』，或者『按 FSRS 复习』」。
   *
   * ⚠️ 普通 DOM 赋值 + 在 chrome:ready 之后再写一次 —— 顶栏是 js/chrome.js
   *    重建的，它读的是 `<body data-sub>`。所以顺手把 data-sub 也改掉：
   *    这样即便顶栏晚一步重建（或用户切页签回来），也还是当前算法那句。
   */
  function applyAlgoSub() {
    const sub = window.ReviewModels
      ? window.ReviewModels.subFor(algoKey())
      : "按遗忘曲线复习";
    document.body.setAttribute("data-sub", sub);
    const el = $("#brand-sub");
    if (el) el.textContent = sub;
  }

  function scopeInfo() {
    return Scheduler.scopeOf(scopeKey());
  }

  /** 「全部诗词」面板当前展示的诗词（跟随背诵范围） */
  function currentScopePoems() {
    const scope = scopeInfo();
    if (scope.random) {
      const pool = Scheduler.poolForScope({ grade: settings.grade, term: settings.term, scope: scopeKey() });
      return pool.slice().sort(function (a, b) {
        return (a.grade - b.grade) || (a.term - b.term);
      });
    }
    return provider(settings.grade, settings.term);
  }

  function getRecord(id) {
    return Storage.get(id);
  }

  function showToast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      t.hidden = true;
    }, 1800);
  }

  /* ---------------- 今日任务缓存 ---------------- */
  /**
   * 自选集合的「版本号」：集合内容一变就跟着变。
   *
   * 为什么要把它编进缓存键：当天计划是缓存在 sessionStorage 里的
   * （`poem_plan_...`），原先靠「改动时主动 invalidatePlan()」清缓存，
   * 只在**监听得到事件的那些入口**有效 —— 集子页点了「加入背诵」后
   * 直接刷新首页、或另开一个标签页，这份缓存还在，刚加的那一篇当天就不出现。
   * 把「集合里有哪些篇、各在哪几个集合」压成一个短串编进键里，
   * 缓存自然跟着失效，不再依赖「谁记得清缓存」。
   */
  function collectionsKey() {
    if (!window.ReciteCollections) return "0";
    try {
      const cols = window.ReciteCollections.list() || [];
      const raw = cols
        .map(function (c) {
          return (c.items || []).map(function (it) {
            return typeof it === "string" ? it : it.id;
          }).join(",");
        })
        .join("|");
      let h = 5381;
      for (let i = 0; i < raw.length; i += 1) h = ((h * 33) ^ raw.charCodeAt(i)) >>> 0;
      return raw.length + "-" + h.toString(36);
    } catch (e) {
      return "0";
    }
  }

  function planCacheKey() {
    return (
      "poem_plan_" + todayKeyStr() + "_" + settings.grade + "_" + settings.term + "_" +
      scopeKey() + "_" + settings.dailyCount + "_" + collectionsKey()
    );
  }

  /**
   * 自选集合交给遗忘曲线的篇目（js/collections.js）。
   *
   * 只存引用、不存正文，正文从站点索引取；站点索引在这里一定齐备
   * （首页加载了六部数据，见 index.html 的 script 顺序）。
   * 与课内同篇的会并到课内那一份进度上（poemIdFor → WorksIndex.repOf），
   * 所以「在唐诗页把《静夜思》加入背诵」不会让它与课内那一条各背一遍。
   */
  function extraPoems() {
    if (!window.ReciteCollections) return [];
    return window.ReciteCollections.scheduleItems(window.SITE_INDEX || []);
  }

  /** 自选集合变化时重排今日任务（用户刚加一篇，今天就该排上） */
  function invalidateAndRefreshPlan() {
    invalidatePlan();
    todayPlan = buildTodayPlan();
    renderToday();
    renderAll();
  }

  function buildTodayPlan() {
    // 同一天同一配置下计划保持稳定，避免刷新后跳变
    const key = planCacheKey();
    const cached = sessionStorage.getItem(key);
    if (cached) {
      try {
        const ids = JSON.parse(cached);
        const map = {};
        window.POEMS_ALL.forEach(function (p) {
          map[p.id] = p;
        });
        // 自选篇目不在 POEMS_ALL 里，回填时也要认它们
        extraPoems().forEach(function (p) {
          map[p.id] = p;
        });
        const restored = ids
          .map(function (it) {
            return { poem: map[it.id], reason: it.reason, reviewRound: it.reviewRound, lastReviewAt: it.lastReviewAt };
          })
          .filter(function (it) {
            return !!it.poem;
          });
        if (restored.length === ids.length) return restored;
      } catch (e) {
        /* ignore */
      }
    }

    const plan = Scheduler.generateDailyPlan({
      grade: settings.grade,
      term: settings.term,
      count: settings.dailyCount,
      scope: scopeKey(),
      provider: provider,
      getRecord: getRecord,
      extraPoems: extraPoems()
    });

    sessionStorage.setItem(
      key,
      JSON.stringify(
        plan.map(function (it) {
          return { id: it.poem.id, reason: it.reason, reviewRound: it.reviewRound, lastReviewAt: it.lastReviewAt };
        })
      )
    );
    return plan;
  }

  function invalidatePlan() {
    Object.keys(sessionStorage)
      .filter(function (k) {
        return k.indexOf("poem_plan_") === 0;
      })
      .forEach(function (k) {
        sessionStorage.removeItem(k);
      });
  }

  /* ---------------- 渲染：年级选择 ---------------- */
  function renderGradeChips() {
    const stage = stageOf(settings.grade);
    const grades = STAGES[stage].grades;
    const box = $("#grade-chips");
    if (!box) return;
    box.innerHTML = "";
    grades.forEach(function (g) {
      const b = document.createElement("button");
      b.textContent = gradeName(g);
      b.dataset.grade = g;
      if (g === settings.grade) b.className = "active";
      b.addEventListener("click", function () {
        settings.grade = g;
        saveAndRefresh(true);
      });
      box.appendChild(b);
    });
    $$("#seg-stage button").forEach(function (b) {
      b.classList.toggle("active", b.dataset.stage === stage);
    });
    $$("#seg-term button").forEach(function (b) {
      b.classList.toggle("active", Number(b.dataset.term) === settings.term);
    });
    const sc = $("#seg-count");
    if (sc) {
      $$("button", sc).forEach(function (b) {
        b.classList.toggle("active", Number(b.dataset.count) === settings.dailyCount);
      });
    }
    const ssc = $("#seg-scope");
    if (ssc) {
      $$("button", ssc).forEach(function (b) {
        b.classList.toggle("active", b.dataset.scope === scopeKey());
      });
    }
    const hint = $("#scope-hint");
    if (hint) hint.textContent = "当前：" + scopeInfo().scopeName;
    const sh = $("#seg-helper");
    if (sh) {
      $$("button", sh).forEach(function (b) {
        b.classList.toggle("active", (b.dataset.helper === "on") === helperEnabled());
      });
    }
  }

  /* ---------------- 渲染：今日列表 ---------------- */
  function renderToday() {
    const list = $("#today-list");
    list.innerHTML = "";

    if (!todayPlan.length) {
      list.innerHTML = '<div class="card empty">' + esc(scopeInfo().scopeName) + '暂无诗词数据</div>';
      return;
    }

    todayPlan.forEach(function (item, idx) {
      const p = item.poem;
      const rec = getRecord(p.id);
      const done = !!(rec && rec.learned && Scheduler.isDue(rec) === false && rec.lastReviewAt && sameDay(rec.lastReviewAt, Date.now()));
      // 自选集合的篇目不在教材里，没有年级学期 —— 出处改成它所在的集子名
      // （「唐诗三百首 · 卷一 五言古诗」这种），不能让 gradeName(undefined) 露出来。
      const metaTail = p.custom
        ? esc((p.bookName || "自选") + (p.source && p.source !== p.bookName ? " · " + p.source : ""))
        : esc(gradeName(p.grade) + termName(p.term));
      const el = document.createElement("div");
      el.className = "item " + (item.reason === "review" ? "review" : "new") +
        (p.custom ? " optional" : "") + (done ? " done" : "");
      el.dataset.id = p.id;
      el.innerHTML =
        '<div class="item-main">' +
        // 序号圆挪进标题行、排在篇名前面（不再是独占一列的 30px 圆）：
        // 标题行的起点就是圆的起点，圆形与字号同高，一屏能多读几行字（Issue #55 第三条）
        '<h3 class="item-title"><span class="item-num">' + (idx + 1) + "</span>" + esc(p.custom ? showTitle(p.title) : p.title) +
        '<span class="item-reason ' + (item.reason === "review" ? "review" : "") + '">' +
        (item.reason === "review" ? "复习 · 第" + (item.reviewRound || 1) + "轮"
          : item.reason === "extra" ? "巩固"
          : item.reason === "optional" ? "自选" : "新学") +
        "</span></h3>" +
        // 「作者 · 朝代 · 出处」按**有哪栏排哪栏**拼（见下方 metaLine）——
        // 自选集合里可能有《昭明文选》的篇目，而文选题署只给作者的字、
        // 不留朝代（见 data/poems-zhaoming.js 文件头），
        // 写死位置会渲染出以「·」开头的残句。
        '<div class="item-meta">' + metaLine([p.author, p.dynasty, metaTail]) + "</div>" +
        (rec && rec.learned
          ? '<div class="mbar"><i style="width:' + Scheduler.mastery(rec) + '%"></i></div>'
          : "") +
        "</div>" +
        '<button type="button" class="item-read" title="朗读这一首" aria-label="朗读 ' + esc(p.custom ? showTitle(p.title) : p.title) + '">' +
        playGlyph() + "</button>" +
        '<div class="item-arrow">' + arrowGlyph() + "</div>";
      el.addEventListener("click", function () {
        openPoem(p, item);
      });
      const readBtn = el.querySelector(".item-read");
      readBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        readOne(p, readBtn);
      });
      list.appendChild(el);
    });

    // 顶部进度
    const doneCount = todayPlan.filter(function (it) {
      const rec = getRecord(it.poem.id);
      return rec && rec.lastReviewAt && sameDay(rec.lastReviewAt, Date.now());
    }).length;
    const pct = todayPlan.length ? Math.round((doneCount / todayPlan.length) * 100) : 0;
    $("#ring-fg").setAttribute("stroke-dasharray", pct + ", 100");
    $("#ring-text").textContent = doneCount + "/" + todayPlan.length;
    const reviewN = todayPlan.filter(function (it) {
      return it.reason === "review";
    }).length;
    $("#today-sub").textContent =
      "共 " + todayPlan.length + " 首 · 待复习 " + reviewN + " · 新学 " + (todayPlan.length - reviewN);

    syncTodayReadBtn();
  }

  /**
   * 列表项右侧的播放键图标（内联 SVG，跨设备一致）
   * 播放中换成「暂停」两竖条：一眼就能看出点它可以停
   *
   * ▶ 是**空心描边三角**（Issue #55 后续）：只留轮廓、不填色，
   * 描边色即外层圆键的 `color`（currentColor）—— 圆环与三角同色，
   * 与「列表序号空心圆」「折叠箭头空心三角」同一套空心描边语言。
   *
   * 描边宽 1.5（Issue #55 本轮，原 2.4）：用户要求「所有播放键里面的三角形
   * 边框宽度只允许 1px」。描边写在 24 的 viewBox 里、会跟着图标框一起缩放，
   * 所以「屏幕上 1px」要看这一档的图标框：列表项圆键是 16px，
   * 1px → stroke-width = 1 × 24 ÷ 16 = 1.5。全站各档的取值与换算过程
   * 统一记在 css/classic.css 顶部那张表里，改这里前先看它。
   * ⚠️ 改这里必须同步 js/classic.js、js/reader.js 与两个 index.html ——
   * 全站播放键共用同一枚三角。
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
   * 列表项右侧的「向右」箭头（内联 SVG，与折叠箭头同一枚图标）
   * 需求（Issue #55）：小古文列表的「›」、首页古诗词列表的「›」、
   * 首页「全部诗词」的展开 / 收缩箭头，三处大小必须一致。
   * 原先前两处是文本字符「›」（font-size 18px，字形只有约 9px 高），
   * 第三处是 18×18 的 SVG 三角 —— 摆在一起一胖一瘦、一深一浅。
   * 现在三处统一用同一枚 18×18 描边箭头：尺寸与笔画都来自同一份定义，
   * 不会再随字体、字号或系统字体回退而变样。
   */
  function arrowGlyph() {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M9.8 6.6 15.2 12l-5.4 5.4" /></svg>'
    );
  }

  function sameDay(a, b) {
    const d1 = new Date(a);
    const d2 = new Date(b);
    return (
      d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate()
    );
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /**
   * 列表条目那一行「朝代 · 作者 · 出处」。
   *
   * ⚠️ 每一栏都可能为空 —— 不是「大概不会空」，是**确定会有空值**：
   *    自选集合里能加进《昭明文选》的篇目，而《文选》的题署只给作者的字、
   *    不留朝代（那朝代是后人按人名表推的，已按「补出来的信息一律留空」清掉，
   *    见 data/poems-zhaoming.js 文件头）。早前这里把 `p.dynasty` 直接塞进模板，
   *    空值会渲染成「 · 徐陵」这种以分隔符开头的残句。
   *
   * 规矩：**空值连同它那一枚分隔符一起不渲染**，最后把剩下的用「·」串起来。
   * 传进来的值按原样转义 —— 有的栏本身就是拼好的 HTML 片段（如出处那一段），
   * 转义与否由调用方决定，这里只做「排布」这一件事。
   */
  function metaLine(parts) {
    const out = [];
    (parts || []).forEach(function (v) {
      const t = v == null ? "" : String(v);
      if (!t) return;
      if (out.length) out.push('<span>·</span>');
      out.push('<span>' + t + "</span>");
    });
    return out.join("");
  }

  /* ---------------- 渲染：全部诗词 ---------------- */
  function renderAll() {
    const scope = scopeInfo();
    const poems = currentScopePoems();
    $("#all-count").textContent = poems.length;

    const label = $("#all-label");
    if (label) label.textContent = scope.random ? scope.scopeName + "全部诗词" : "本年级本学期全部诗词";

    const st = Scheduler.stats(poems, getRecord);
    $("#stats-row").innerHTML =
      '<div class="stat"><b>' + st.total + "</b><span>诗词总数</span></div>" +
      '<div class="stat"><b>' + st.learned + "</b><span>已学</span></div>" +
      '<div class="stat"><b>' + st.mastered + "</b><span>较牢固</span></div>" +
      '<div class="stat review"><b>' + st.dueToday + "</b><span>待复习</span></div>";

    const box = $("#all-list");
    box.innerHTML = "";
    if (!poems.length) {
      box.innerHTML = '<div class="empty">暂无数据</div>';
      return;
    }
    poems.forEach(function (p, i) {
      const rec = getRecord(p.id);
      const el = document.createElement("div");
      el.className = "item";
      el.innerHTML =
        '<div class="item-main">' +
        // 同上：序号圆在标题行内，排在篇名前面
        '<h3 class="item-title"><span class="item-num">' + (i + 1) + "</span>" + esc(p.title) + "</h3>" +
        '<div class="item-meta">' +
        metaLine([p.dynasty, p.author].concat(
          // ⚠️ 年级 / 掌握度这两栏是**无条件**跟着的（各带一个前置「·」），
          // 所以 metaLine 里那些「空值即不渲染分隔符」的规矩到第一栏之后就得让位 ——
          // 这里把后面的尾巴拼成一段「整串」，再交给 metaLine 排在末尾：
          // 朝代一空时只省掉它自己，不会把「· 二年级上」那一截也吞掉。
          [scope.random ? gradeName(p.grade) + termName(p.term) : "",
           rec && rec.learned ? Scheduler.levelName(rec.level, rec) : "未学过"]
            .filter(Boolean).join(" · "))) +
        "</div>" +
        (rec && rec.learned ? '<div class="mbar"><i style="width:' + Scheduler.mastery(rec) + '%"></i></div>' : "") +
        "</div>" +
        '<div class="item-arrow">' + arrowGlyph() + "</div>";
      el.addEventListener("click", function () {
        openPoem(p, null);
      });
      box.appendChild(el);
    });
  }

  /**
   * 篇名显示名：去掉语料内部用来区分同名词作的「其一 / 其二 / 其三」。
   *
   * 用户原话「去掉自选集合中其一其二这些你不清楚的」——那个编号是整理宋词时
   * 按目录次序补的序号（同一作者同一词牌好几首，清单里没有首句可以分辨），
   * 不是选本原名：「木兰花·其二」看不出是哪一首，反像漏了半句。
   * 只改**显示**，集合里存的仍是完整 id（`tangshi-ts-1` / `-2` 分得清）。
   *
   * ⚠️ 这一份留在首页是**因为首页要用**，不是因为自选清单还在这儿：
   *    今日任务里混着自选篇目（它们与课内 261 首一起排），
   *    列表、弹层标题、朗读文案都要用显示名 —— 见下面四处 `p.custom ? showTitle(...)`。
   *    自选清单本身的增删改查已经搬到设置整页（/settings/ 的「我的清单」），
   *    那一份在 js/settings.js 里，与这里同口径。
   */
  function showTitle(title) {
    if (window.ReciteCollections && window.ReciteCollections.displayTitle) {
      return window.ReciteCollections.displayTitle(title);
    }
    return title;
  }

  /**
   * 自选篇目 → 详情弹层认的篇目对象。
   *
   * 详情弹层（openPoem）读 `p.grade` / `p.term` 显示年级学期，自选篇目没有；
   * 补 `custom: true` 让那一格改显示集子名（见 openPoem）。
   * 译文来源口径也一并带上，详情页底部的来源注脚才出得来。
   */
  function customPoem(p, repId, entryId) {
    const src = (window.SITE_INDEX || []).filter(function (x) { return x.id === (entryId || repId); })[0];
    return Object.assign({}, p, {
      id: repId,
      custom: true,
      bookName: (src && src.bookName) || p.bookName || "",
      translationSource: (src && src.translationSource) || p.translationSource
    });
  }

  /**
   * 首页只加载课内 12 册（约 52KB），五部集子那 4.4MB 不加载，
   * 自选篇目的正文只能靠加入时存的快照。
   *
   * 「加入背诵」那一刻存下的快照是**当时**的语料：集子里那一篇后来订正了
   * （标题改了、正文改了、译文补上了），首页若一直不再打开那一页，
   * 快照就一直是旧的 —— 显示的还是旧题名，或「暂未收录译文」。
   * 集子页 / 搜索页会就地刷新快照，但**用户不再打开那一页**这条路走不到。
   *
   * 所以在首页启动时补一道刷新：
   *   · 课内那几篇（首页索引里查得到）直接就地更新；
   *   · 课外那几篇首页拿不到新语料，标成 `stale`，等下次进集子页时再刷新 ——
   *     这一趟不派发 change 事件，免得与「集合变化 → 重排今日任务」打转。
   */
  function backfillSnapshots() {
    if (!window.ReciteCollections) return;
    const C = window.ReciteCollections;
    C.refreshSnapshots(window.SITE_INDEX || []);
    if (C.markStale) C.markStale(window.SITE_INDEX || []);
  }

  /* ---------------- 语料订正后的漂移自动刷新 ----------------
     上一轮补的是「首页启动时刷一次快照 + 标 stale」：课内那几篇当场更新，
     课外那几篇（首页不加载那几部集子）留一个标记，等下次进集子页 / 搜索页再刷。

     这条路的缺口在于：**集子页 / 搜索页是另一个页面**，用户在首页停留的整个
     会话里都不会经过它。于是「加了自选、语料后来订正过」这一篇，可能连着
     好几天显示的还是旧题名或「暂未收录译文」—— 除非他恰好又打开那一页。

     所以这里补一条**按需拉取**：首页启动时若发现还有 `stale` 标记的条目，
     就把它所属那一部集子的**数据文件**取回来（那是一个普通 JS 文件，
     与页面里 <script> 加载的是同一份），用它刷新快照。三条约束：

       · **只拉真正需要的**：一部都没涉及就不发请求；
       · **一次只拉一部**：`book → 数据文件 → 全局变量名` 的对应写死在
         BOOK_SOURCES，拉回来的文件按全局名取值，不 eval 任何东西；
       · **拉不到就算了**：离线、文件被改坏、网络不通都不影响用 ——
         老快照照常显示，`stale` 标记留着，下次再试。
     拉完只派发一次集合变化事件（走的是 refreshSnapshots 里那套），
     今日任务与自选列表跟着重画一遍。
     ------------------------------------------------------------------ */
  /** 集子 id → 数据文件与它挂在 window 上的全局名（与各页面 <script> 一致） */
  const BOOK_SOURCES = {
    classic: { file: "data/poems-classic.js", global: "POEMS_CLASSIC" },
    tangshi: { file: "data/poems-tangshi.js", global: "POEMS_TANGSHI" },
    songci: { file: "data/poems-songci.js", global: "POEMS_SONGCI" },
    guwen: { file: "data/poems-guwen.js", global: "POEMS_GUWEN" },
    zhaoming: { file: "data/poems-zhaoming.js", global: "POEMS_ZHAOMING" }
  };

  /**
   * 还有哪些条目的快照是旧的、各自属于哪一部集子。
   * @returns {Object} { bookId: [条目 id, ...] }
   */
  function staleByBook() {
    const out = {};
    const C = window.ReciteCollections;
    if (!C || !C.list) return out;
    const idx = {};
    (window.SITE_INDEX || []).forEach(function (p) { idx[p.id] = p; });
    C.list().forEach(function (col) {
      (col.items || []).forEach(function (it) {
        if (!it || typeof it !== "object" || !it.stale || !it.id) return;
        const p = idx[it.id];
        // 站点索引里查得到的（课内那几篇）由 refreshSnapshots 就地更新，
        // 走不到这一支；真要走到也用不着拉文件。
        if (p) return;
        // 快照里记着 book（哪一部集子），没有就按条目 id 前缀猜一次
        const book = (it.snap && it.snap.book) || guessBook(it.id);
        if (!book || !BOOK_SOURCES[book]) return;
        (out[book] = out[book] || []).push(it.id);
      });
    });
    return out;
  }

  /** 条目 id 前缀 → 集子 id（快照里没记 book 时的兜底） */
  function guessBook(entryId) {
    const m = String(entryId).match(/^([a-z]+)-/);
    if (!m) return "";
    const pre = m[1];
    return BOOK_SOURCES[pre] ? pre : "";
  }

  /**
   * 按需拉回某一部集子的数据文件，刷新快照。返回拉了几篇（0 表示没成）。
   *
   * ⚠️ 手动 `document.createElement("script")` 而不是 fetch + eval：
   *    与页面里那些 <script> 走**同一条路**（同一个 Service Worker 缓存、
   *    同一套相对路径解析），不必自己处理「解析出来的文本怎么变成数据」，
   *    也就不会出现「页面上是对的、这里解析错」的分叉。
   */
  function pullBook(bookId) {
    const src = BOOK_SOURCES[bookId];
    if (!src) return Promise.resolve(0);
    if (window[src.global]) return Promise.resolve(refreshFromGlobal(bookId, src));
    return new Promise(function (resolve) {
      const el = document.createElement("script");
      el.src = src.file;
      el.async = true;
      el.onload = function () {
        resolve(refreshFromGlobal(bookId, src));
        el.parentNode && el.parentNode.removeChild(el);
      };
      el.onerror = function () {
        el.parentNode && el.parentNode.removeChild(el);
        resolve(0);
      };
      (document.head || document.body).appendChild(el);
    });
  }

  /** 拿刚加载进来的那一部数据，按站点索引的口径刷新快照 */
  function refreshFromGlobal(bookId, src) {
    const list = window[src.global];
    if (!Array.isArray(list) || !list.length) return 0;
    // 复用站点索引那一套构造（同一份 buildSiteIndex 口径）：
    // 直接调它比在这里重抄一遍字段映射可靠 —— 抄一遍就会与搜索页的口径分叉
    let idx = [];
    if (window.buildSiteIndex) {
      const extra = {};
      extra[bookId] = list;
      idx = window.buildSiteIndex(extra) || [];
    } else {
      idx = (window.SITE_INDEX || []).filter(function (x) { return x.book === bookId; });
    }
    if (!idx.length) return 0;
    return window.ReciteCollections.refreshSnapshots(idx);
  }

  /**
   * 启动时跑一次：把还旧着的快照按集子拉回最新的语料刷新。
   * 返回拉了几篇（0 = 没有需要拉的，或拉失败）。
   */
  function refreshStaleSnapshots() {
    const need = staleByBook();
    const books = Object.keys(need);
    if (!books.length) return Promise.resolve(0);
    // 一部一部来：首页日常只涉及一两部，逐个串行能少发请求，
    // 也免得几部大集子（昭明 480 篇、几 MB）同时进来把首屏拖慢。
    return books.reduce(function (chain, book) {
      return chain.then(function (n) {
        return pullBook(book).then(function (k) {
          if (k) rebuildToday();
          return n + k;
        });
      });
    }, Promise.resolve(0));
  }

  /* ---------------- 深链接：/?poem=<id> ----------------
     「背诵进度总览」（/progress/）里那一份「全部到期篇目」的篇名是指回首页的
     链接（`/?poem=<id>`）—— 日历回答「哪天忙」、清单回答「那天是哪些」，
     点进去才是「就读这一篇」。

     ⚠️ 这一节是 #119 断了的那一头：上一轮把「日历点得进清单」做通了，
     清单里也挂了链接，但**全站没有一处读 `?poem=`** —— 链接指过来，
     首页照常画「今日背诵」，用户点下去只觉得「没反应」（不报错、测试全过、
     因为它验的只是链接形态）。所以这里把它接上。

     口径三条：
       · **只做「落地」不做「状态」**：读完 `?poem=` 就把地址栏那一截抹掉
         （`replaceState`，不新增一条历史）。留在地址栏里的话，用户随手刷新
         又弹一次、返回键也回不到「干净的首页」。
       · **只认首页自己的篇目**：课内 261 首与自选集合里的篇目都能打开
         （自选篇目走 quickPoem 的快照，与自选列表点开是同一套）；
         查不到的 id 一律安静放过 —— 旧链接、手改错的 id 都不该弹同一个黄条。
       · **沿用同一个详情弹层**：`openPoem()` 那一套（正文 / 译文 / 朗读 /
         三个掌握度按钮）照旧，不在这一页另造一个阅读器。
         `planItem` 传 null（它不在今日计划里，底部提示按「背诵后点按钮」走）。 */
  /** 从 `?poem=` / `#poem=` 里取要打开的篇目 id（没有签则返回空串） */
  function deepLinkId() {
    var q = "";
    try {
      q = (window.location && window.location.search) || "";
    } catch (e) {
      q = "";
    }
    var m = /(?:^|[?&])poem=([^&]+)/.exec(q);
    if (!m) {
      // 兜底认一次 hash：有些分享渠道会把 ? 吃掉
      var h = "";
      try { h = (window.location && window.location.hash) || ""; } catch (e2) { h = ""; }
      m = /(?:^|[#&])poem=([^&]+)/.exec(h);
      if (!m) return "";
    }
    var id = m[1];
    try {
      id = decodeURIComponent(id.replace(/\+/g, " "));
    } catch (e3) {
      /* 解不开就按原样认一次：宁可查不到，也不要让首页报错 */
    }
    return String(id || "").trim();
  }

  /** 把地址栏里那一截 `?poem=` 抹掉，不新增历史记录（刷新不再弹、返回键照旧） */
  function clearDeepLink() {
    try {
      if (!window.history || !window.history.replaceState) return;
      var url = window.location.pathname + window.location.hash;
      window.history.replaceState(null, "", url);
    } catch (e) {
      /* 某些内嵌 WebView 禁用 history：抹不掉也不影响打开那一篇 */
    }
  }

  /**
   * 首页的深链接落地：`/?poem=<id>` → 直接打开那一篇的详情弹层。
   * 启动时调一次；`storage` 之类的事件不该重放它（同一次打开只落地一次）。
   */
  function openDeepLink() {
    var id = deepLinkId();
    if (!id) return false;
    // 地址栏先清干净 —— 无论下面找不找得到，这一截都不该留
    clearDeepLink();

    var poem = coursePoem(id) || optionalPoem(id);
    if (!poem || !poem.title) return false;

    // 今日列表先画出来：弹层叠在一张画好的首页上，
    // 关掉之后回到的是「今天背这 5 首」，而不是半张白纸。
    if (!todayPlan.length) buildTodayPlan();
    openPoem(poem, null);
    return true;
  }

  /**
   * 课内 261 首里按 id 取一篇。
   *
   * ⚠️ 不用 `poemForEntry()` —— 那个只查站点索引（SITE_INDEX），而首页
   * 只加载课内 12 册；课内篇目在 POEMS_ALL 里一定有，绕开索引更稳，
   * 也免得「索引里的 id 写法与 POEMS_ALL 不一致」时静默打不开。
   */
  function coursePoem(id) {
    var all = window.POEMS_ALL || [];
    for (var i = 0; i < all.length; i += 1) {
      if (all[i] && all[i].id === id) return all[i];
    }
    return null;
  }

  /**
   * 自选集合里按篇目 id 取一篇（课外的那些）。
   *
   * 走 `ReciteCollections.scheduleItems()` —— 与自选列表、今日任务排程
   * 是**同一个出口**，正文 / 译文取不到索引里那份时自动回落到加入时的快照，
   * 返回的对象也自带 `custom: true`（弹层那一格才改显示集子名）。
   * 另起一个查询就会与列表那边分叉：列表点得开、深链接点不开。
   */
  function optionalPoem(id) {
    if (!window.ReciteCollections || !window.ReciteCollections.scheduleItems) return null;
    var items = window.ReciteCollections.scheduleItems(window.SITE_INDEX || []);
    for (var i = 0; i < items.length; i += 1) {
      if (items[i] && items[i].id === id) return items[i];
    }
    return null;
  }

  /* ---------------- 弹层 ---------------- */
  function openPoem(p, planItem) {
    currentPoem = p;
    const rec = getRecord(p.id);
    // 自选篇目的篇名去掉「其一 / 其二」（见 showTitle）——
    // 课内那 261 首一个字不动：那里的「其一」是教材原名
    $("#m-title").textContent = p.custom ? showTitle(p.title) : p.title;
    // 朝代可能为空：《昭明文选》的题署只给作者的字、不留朝代
    // （那朝代是后人按人名表推的，已按「补出来的信息一律留空」清掉，见
    //   data/poems-zhaoming.js 文件头）。空值不渲染这一枚标签 ——
    // 否则会露出一对「〔〕」空括号，像是数据坏了。
    const dynEl = $("#m-dynasty");
    dynEl.textContent = p.dynasty ? "〔" + p.dynasty + "〕" : "";
    dynEl.hidden = !p.dynasty;
    $("#m-author").textContent = p.author;
    // 自选篇目没有年级学期，这一格改显示它所在的集子；
    // 否则会露出「undefined年级 undefined学期」。
    $("#m-grade").textContent = p.custom
      ? (p.bookName || "自选篇目")
      : gradeName(p.grade) + " " + termName(p.term);
    $("#m-trans-text").textContent = hasTranslation(p) ? p.translation : "（暂未收录译文）";
    // 译文来源注脚：与译文正文同进同退，没标注就留空（.trans-src:empty 不占位）
    const srcEl = $("#m-trans-src");
    if (srcEl) {
      srcEl.textContent = hasTranslation(p) && window.translationSourceText
        ? window.translationSourceText(p) : "";
    }
    renderPoemText(p);
    applyFont();
    applyAlign();
    syncAlignButtons();
    syncPinyinBtn();
    showTransBox(false);
    speakingTarget = "原文";
    syncReadBtn();

    const info = [];
    if (rec && rec.learned) {
      info.push("<span>记忆阶段：<b>" + Scheduler.levelName(rec.level, rec) + "</b></span>");
      info.push("<span>掌握度：<b>" + Scheduler.mastery(rec) + "%</b></span>");
      info.push("<span>已复习：<b>" + rec.reviewCount + "</b> 次</span>");
      info.push(
        "<span>下次复习：<b>" +
          new Date(rec.nextReviewAt).toLocaleDateString("zh-CN") +
          "</b></span>"
      );
    } else {
      info.push("<span>还没有学习记录，选择下方结果开始记忆</span>");
    }
    $("#m-progress").innerHTML = info.join("");

    $("#m-hint").textContent = planItem
      ? planItem.reason === "review"
        ? "这首诗按遗忘曲线到期了，复习后请如实选择掌握程度"
        : "新学的诗，今天先记一遍"
      : "背诵后点击按钮，系统会安排下次复习时间";

    $("#modal").hidden = false;
    document.body.style.overflow = "hidden";
    syncBottomGap();
  }

  /** 弹层正文：按注音档位渲染。关闭时为纯文本，保证原有测试与排版不变 */
  function renderPoemText(p) {
    const box = $("#m-text");
    if (pinyinOn() && window.Pinyin) {
      box.innerHTML = window.Pinyin.annotateHtml(p.text, pinyinRenderMode());
      box.classList.add("with-pinyin");
    } else {
      box.textContent = p.text;
      box.classList.remove("with-pinyin");
    }
  }

  /* ---------------- 正文字号 / 对齐（与小古文详情页同一套） ---------------- */

  function fontIdx() {
    const v = Number(localStorage.getItem(FONT_KEY));
    const i = FONT_SIZES.indexOf(v);
    return i === -1 ? FONT_SIZES.indexOf(DEFAULT_FONT) : i;
  }

  function applyFont() {
    const box = $("#m-text");
    if (box) box.style.fontSize = FONT_SIZES[fontIdx()] + "px";
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

  /** data-align 交给 CSS 决定 text-align；块本身的居中由 fit-content + margin auto 保证 */
  function applyAlign() {
    const box = $("#m-text");
    if (box) box.dataset.align = alignMode();
  }

  function syncAlignButtons() {
    const mode = alignMode();
    $$("#m-align-seg button").forEach(function (b) {
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

  /* ---------------- 白话译文 ---------------- */
  function showTransBox(show) {
    const btn = $("#m-trans-toggle");
    const box = $("#m-trans");
    if (!box) return;
    box.hidden = !show;
    if (btn) {
      btn.dataset.on = show ? "1" : "0";
      btn.setAttribute("aria-pressed", show ? "true" : "false");
      btn.title = show ? "隐藏译文" : "显示译文";
      const t = $("#m-trans-toggle-text");
      if (t) t.textContent = show ? "隐藏译文" : "显示译文";
    }
    // 译文框一开一合，译文那颗播放键跟着出现 / 消失，
    // 顺带把它的上一态清掉，避免收起再展开时残留「正在播放」
    if (!show) speakingTarget = speakingTarget === "译文" ? "原文" : speakingTarget;
    syncReadBtn();
  }

  function hasTranslation(p) {
    return !!(p && p.translation && String(p.translation).trim());
  }

  /** 同步弹层的注音档位按钮（关闭 / 只标生字 / 全文注音） */
  function syncPinyinBtn() {
    const seg = $("#m-pinyin-seg");
    if (!seg) return;
    const mode = pinyinMode();
    Array.prototype.forEach.call(seg.querySelectorAll("button"), function (b) {
      const on = b.dataset.mode === mode;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    // 兼容性：保留一个可读状态，供旧测试与无障碍读取
    seg.dataset.on = mode === "off" ? "0" : "1";
  }

  function setPinyinModeFromUI(mode) {
    setPinyinMode(mode);
    if (currentPoem) renderPoemText(currentPoem);
    syncPinyinBtn();
    showToast(
      mode === "off" ? "已隐藏拼音" : mode === "all" ? "已全文注音" : "已只标生字"
    );
  }

  /* ---------------- 自动朗读（不看手机也能听） ---------------- */

  function speechOk() {
    return !!(window.Speech && window.Speech.supported());
  }

  /** 一首诗的朗读文本：标题 + 朝代 + 作者 + 正文 */
  function speechText(p) {
    // 自选篇目读显示名：念出「木兰花其二」会让人以为漏了半句（见 showTitle）
    const head = [(p.custom ? showTitle(p.title) : p.title), p.dynasty, p.author].filter(Boolean).join("，");
    return head + "。" + p.text;
  }

  /** 朗读当天全部：依次读标题、朝代、作者与正文 */
  function readTodayAll() {
    if (!speechOk()) {
      showToast("当前浏览器不支持语音朗读");
      return;
    }
    if (!todayPlan.length) return;

    // 从控制条 / 弹层停止朗读时，也要把「正在朗诵」的高亮与按钮状态复位
    if (window.ReaderPlayer && window.ReaderPlayer.onStop) {
      window.ReaderPlayer.onStop(function () {
        clearHighlight();
        syncItemReadBtns();
        syncTodayReadBtn();
      });
    }
    const items = todayPlan.map(function (it) {
      return {
        title: it.poem.title,
        text: speechText(it.poem),
        onStart: function () { highlightItem(it.poem.id); }
      };
    });

    window.ReaderPlayer.player({
      title: todayPlan.length + " 首连读",
      items: items,
      onIndex: function (i) {
        const it = todayPlan[i];
        if (it) highlightItem(it.poem.id);
      },
      onEnd: function () {
        clearHighlight();
        syncTodayReadBtn();
        syncReadBtn();
        syncItemReadBtns();
      }
    });
    syncTodayReadBtn();
    setTimeout(syncTodayReadBtn, 80);
  }

  /** 朗读单首：再点一次停止 */
  function readOne(p, btn) {
    if (!speechOk()) {
      showToast("当前浏览器不支持语音朗读");
      return;
    }
    if (window.Speech.speaking()) {
      window.Speech.stop();
      showToast("已停止朗读");
    } else {
      const ok = window.Speech.speak(speechText(p));
      showToast(ok ? "开始朗读《" + (p.custom ? showTitle(p.title) : p.title) + "》" : "朗读启动失败，请重试");
    }
    syncTodayReadBtn();
    syncItemReadBtns();
    setTimeout(function () {
      syncTodayReadBtn();
      syncItemReadBtns();
    }, 80);
  }

  function syncTodayReadBtn() {
    const btn = $("#today-read");
    if (!btn) return;
    const ok = speechOk();
    btn.disabled = !ok;
    // 「今日 5 首」不再显示，播放栏会直接报出当前这一首，
    // 所以这里只区分「是否有队列在跑」，用来切换圆形播放键的 ▶ / ⏸
    const on = ok && !!(window.ReaderPlayer && window.ReaderPlayer.isRunning && window.ReaderPlayer.isRunning());
    btn.dataset.on = on ? "1" : "0";
    btn.setAttribute("aria-label", on ? "停止朗读" : "依次朗读今天要背的每一首");
    const text = $("#today-read-text");
    if (text) text.textContent = on ? "播放中" : "播放";
  }

  /** 高亮 / 取消高亮列表里的朗诵条 */
  function highlightItem(id) {
    $$("#today-list .item").forEach(function (el) {
      el.classList.toggle("reading", el.dataset.id === id);
    });
  }

  /** 取消高亮：顺便把「标记已读后整行半透明」的 .done 类清理干净 */
  function clearHighlight() {
    $$("#today-list .item").forEach(function (el) { el.classList.remove("reading"); });
  }

  function syncItemReadBtns() {
    const speaking = speechOk() && window.Speech.speaking();
    $$("#today-list .item-read").forEach(function (b) {
      b.dataset.on = speaking ? "1" : "0";
    });
  }

  /**
   * 同步两颗播放键（原文 / 译文）。
   *
   * 两颗键各自只占一个位置，靠 data-on 在同一处切换 ▶ / ⏸：
   * 播放中显示暂停，停下回到播放，不会同时并排出现两个图标。
   * 「译文」那颗跟着译文框走 —— 译文框收着的时候它根本不在页面上，
   * 所以一篇诗里任何时候只看得到一个播放信号。
   */
  function syncReadBtn() {
    const ok = speechOk();
    const playing = ok && !!window.Speech.speaking();
    const keys = [
      { btn: "#m-read-btn", key: "原文", title: "朗读原文：标题、朝代、作者与正文" },
      { btn: "#m-trans-read", key: "译文", title: "朗读白话译文" }
    ];
    keys.forEach(function (cfg) {
      const btn = $(cfg.btn);
      if (!btn) return;
      const usable = ok && (cfg.key === "原文" || hasTranslation(currentPoem));
      btn.disabled = !usable;
      btn.title = !ok
        ? "当前浏览器不支持语音朗读"
        : cfg.key === "译文" && !hasTranslation(currentPoem)
          ? "本篇暂无译文"
          : cfg.title;
      const on = playing && speakingTarget === cfg.key;
      btn.dataset.on = on ? "1" : "0";
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    // #m-read-text 是给读屏软件的固定文案（.sr-only），不随能力/播放态替换文字，
    // 状态一律由 data-on 切换 ▶ / ⏸ 与 aria-pressed 表达
    const tLabel = $("#m-trans-read-text");
    if (tLabel) {
      tLabel.textContent = playing && speakingTarget === "译文" ? "停止朗读" : "朗读译文";
    }
  }

  /** 原文键：朗读原文（标题 + 朝代 + 作者 + 正文） */
  function toggleRead() {
    if (!currentPoem || !speechOk()) return;
    if (window.Speech.speaking()) {
      window.Speech.stop();
      showToast("已停止朗读");
    } else {
      speakingTarget = "原文";
      const ok = window.Speech.speak(speechText(currentPoem));
      showToast(ok ? "开始朗读" : "朗读启动失败，请重试");
    }
    syncReadBtn();
    setTimeout(syncReadBtn, 60);
    setTimeout(syncReadBtn, 300);
  }

  /** 译文键：只读白话译文，不读原文；译文框没展开时顺手展开 */
  function toggleTransRead() {
    if (!currentPoem || !speechOk()) return;
    if (window.Speech.speaking()) {
      window.Speech.stop();
      showToast("已停止朗读");
    } else {
      if (!hasTranslation(currentPoem)) {
        showToast("本篇暂无译文");
        return;
      }
      if ($("#m-trans").hidden) showTransBox(true);
      speakingTarget = "译文";
      const ok = window.Speech.speak(currentPoem.translation);
      showToast(ok ? "开始朗读译文" : "朗读启动失败，请重试");
    }
    syncReadBtn();
    setTimeout(syncReadBtn, 60);
  }

  function closeModal() {
    if (window.Speech) window.Speech.stop();
    speakingTarget = "原文";
    $("#modal").hidden = true;
    document.body.style.overflow = "";
    currentPoem = null;
    // 关闭弹层后重新量一次底部留白（播放栏可能刚结束）
    syncBottomGap();
  }

  /* ---------------- 底部留白：不被底部导航栏遮挡 ---------------- */
  /**
   * 把「一条底部导航栏的高度」写进 --nav-h（CSS 变量），
   * 所有「fixed 贴底」的元素（播放栏、iOS 引导条、吐司）都按它算避让距离，
   * 页面主体则按它补底部留白 —— 于是：
   *   · 有播放栏时，正文最后一行与 copyright / 法务链接不会被压住
   *   · 没有播放栏时，留白回到 0，页脚贴底且不留空白条
   * 数值由 js/pwa.js 的 syncBottomGap() 统一测量与同步。
   */
  function syncBottomGap() {
    if (window.PWA && window.PWA.syncBottomGap) window.PWA.syncBottomGap();
  }

  /* ---------------- 复习结果处理 ---------------- */
  function handleResult(result) {
    if (!currentPoem) return;
    const rec = Storage.get(currentPoem.id) || Scheduler.createRecord();
    // 按当前选定的算法排下一次（见 js/review-models.js）：换模型之后新复习的
    // 按新模型算，旧记录不做静默改写（换算发生在切模型那一刻，见 adopt()）
    const next = Scheduler.review(rec, result, algoKey());
    Storage.set(currentPoem.id, next);

    /* 结果提示也说当前模型的话：原先写死「12 小时 / 30 分钟」两句其实各模型一致，
       但「记住了！下次复习：X」里那个 X 是新模型算出来的日期 ——
       提示文案统一从模型层取，免得这里再抄一份口径。 */
    showToast(window.ReviewModels
      ? window.ReviewModels.resultHint(algoKey(), result, next)
      : {
        good: "记住了！下次复习：" + new Date(next.nextReviewAt).toLocaleDateString("zh-CN"),
        fuzzy: "有点模糊，12 小时后再复习一次",
        bad: "没关系，30 分钟后再复习一次"
      }[result]);

    // 更新该首在当前计划中的状态
    todayPlan = todayPlan.map(function (it) {
      if (it.poem.id === currentPoem.id) it.reviewRound = next.level + 1;
      return it;
    });
    closeModal();
    renderToday();
    renderAll();
  }

  /* ---------------- 刷新 ---------------- */
  function saveAndRefresh(rebuild) {
    Storage.saveSettings(settings);
    if (rebuild) invalidatePlan();
    renderGradeChips();
    rebuildToday();
    renderAll();
  }

  function rebuildToday() {
    todayPlan = buildTodayPlan();
    renderToday();
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    // 学段 / 年级 / 学期 / 数量 / 范围 / 阅读辅助 / 小古文入口都住在设置整页
    // （/settings/ + js/settings.js）；首页保留同款监听只为向后兼容，取不到就跳过
    $$("#seg-stage button").forEach(function (b) {
      b.addEventListener("click", function () {
        const stage = b.dataset.stage;
        const grades = STAGES[stage].grades;
        if (grades.indexOf(settings.grade) === -1) settings.grade = grades[0];
        saveAndRefresh(true);
      });
    });

    $$("#seg-term button").forEach(function (b) {
      b.addEventListener("click", function () {
        settings.term = Number(b.dataset.term);
        saveAndRefresh(true);
      });
    });

    // 用户名输入：即时生效，失焦/回车时兜底保存
    const uInput = $("#input-username");
    if (uInput) {
      uInput.addEventListener("input", function () {
        settings.username = uInput.value.trim().slice(0, 12);
        Storage.saveSettings(settings);
        applyAppName();
      });
      uInput.addEventListener("change", function () {
        settings.username = uInput.value.trim().slice(0, 12);
        uInput.value = settings.username;
        Storage.saveSettings(settings);
        applyAppName();
      });
      uInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          uInput.blur();
        }
      });
    }

    $$("#modal [data-close]").forEach(function (el) {
      el.addEventListener("click", closeModal);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { closeModal(); }
    });

    $$(".actions .btn").forEach(function (b) {
      b.addEventListener("click", function () {
        handleResult(b.dataset.result);
      });
    });

    $$("#m-pinyin-seg button").forEach(function (b) {
      b.addEventListener("click", function () {
        setPinyinModeFromUI(b.dataset.mode);
      });
    });
    const readBtn = $("#m-read-btn");
    if (readBtn) readBtn.addEventListener("click", toggleRead);
    const transReadBtn = $("#m-trans-read");
    if (transReadBtn) transReadBtn.addEventListener("click", toggleTransRead);
    const transToggle = $("#m-trans-toggle");
    if (transToggle) transToggle.addEventListener("click", function () {
      showTransBox(this.dataset.on !== "1");
    });
    const fontUp = $("#m-font-up");
    if (fontUp) fontUp.addEventListener("click", function () { changeFont(1); });
    const fontDown = $("#m-font-down");
    if (fontDown) fontDown.addEventListener("click", function () { changeFont(-1); });
    $$("#m-align-seg button").forEach(function (b) {
      b.addEventListener("click", function () { setAlign(b.dataset.align); });
    });
    if (window.speechSynthesis && window.speechSynthesis.addEventListener) {
      window.speechSynthesis.addEventListener("end", syncReadBtn);
      window.speechSynthesis.addEventListener("cancel", syncReadBtn);
    }

    $$("#seg-helper button").forEach(function (b) {
      b.addEventListener("click", function () {
        settings.helper = b.dataset.helper === "on" ? "on" : "off";
        Storage.saveSettings(settings);
        renderGradeChips();
        // 让开关立刻体现差别：重新渲染当前打开的诗
        resetPinyinMode();
        showToast(helperEnabled() ? "阅读辅助已开启：打开诗词自动注音" : "阅读辅助已关闭：打开诗词为纯文本");
      });
    });

    const todayRead = $("#today-read");
    if (todayRead) todayRead.addEventListener("click", function () {
      if (window.Speech && window.Speech.speaking()) {
        window.Speech.stop();
        if (window.ReaderPlayer) window.ReaderPlayer.close();
        clearHighlight();
        syncItemReadBtns();
        const t = $("#toast");
        t.textContent = "已停止朗读";
        t.hidden = false;
        clearTimeout(showToast._t);
        showToast._t = setTimeout(function () { t.hidden = true; }, 1800);
      } else {
        readTodayAll();
      }
      syncTodayReadBtn();
      setTimeout(syncTodayReadBtn, 60);
    });

    const btnAll = $("#btn-all");
    if (btnAll) btnAll.addEventListener("click", function () {
      const body = $("#all-body");
      body.hidden = !body.hidden;
      this.classList.toggle("open", !body.hidden);
    });

    $$("#seg-scope button").forEach(function (b) {
      b.addEventListener("click", function () {
        settings.scope = b.dataset.scope;
        saveAndRefresh(true);
        showToast("背诵范围：" + scopeInfo().scopeName);
      });
    });

    $$("#seg-count button").forEach(function (b) {
      b.addEventListener("click", function () {
        settings.dailyCount = Number(b.dataset.count);
        saveAndRefresh(true);
        showToast("已设置为每日 " + settings.dailyCount + " 首");
      });
    });

    const btnReset = $("#btn-reset");
    if (btnReset) btnReset.addEventListener("click", function () {
      if (confirm("确定要清空全部背诵进度吗？此操作不可恢复。")) {
        Storage.clear();
        invalidatePlan();
        rebuildToday();
        renderAll();
        showToast("进度已清空");
      }
    });

    const btnExport = $("#btn-export");
    if (btnExport) btnExport.addEventListener("click", function () {
      const blob = new Blob([Storage.exportJSON()], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "跬步背诵进度-" + todayKeyStr() + ".json";
      a.click();
      URL.revokeObjectURL(a.href);
      showToast("备份已导出");
    });

    const btnImport = $("#btn-import");
    if (btnImport) btnImport.addEventListener("click", function () {
      const fi = $("#file-import");
      if (fi) fi.click();
    });

    const fileImport = $("#file-import");
    if (fileImport) fileImport.addEventListener("change", function (e) {
      const f = e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = function () {
        try {
          Storage.importJSON(reader.result);
          settings = Storage.getSettings();
          invalidatePlan();
          applyAppName();
          renderGradeChips();
          rebuildToday();
          renderAll();
          showToast("备份导入成功");
        } catch (err) {
          showToast("导入失败：" + err.message);
        }
      };
      reader.readAsText(f);
      e.target.value = "";
    });
  }

  /**
   * 供设置整页（/settings/）等外部页面调用：
   * 设置写在 localStorage 里，同窗口内的其他脚本可以据此重新读一次并刷新界面
   * （同一浏览器标签里做「改完设置立刻生效」用得到；跨页面跳转时本就是重新启动）
   */
  window.PoemApp = {
    reloadSettings: function () {
      settings = Storage.getSettings();
      applyAppName();
      renderGradeChips();
      // 阅读辅助开关变了要立刻体现：开启回「只标生字」，关闭回「不注音」
      resetPinyinMode();
      invalidatePlan();
      rebuildToday();
      renderAll();
      return settings;
    }
  };

  /* ---------------- 启动 ---------------- */
  function init() {
    if (!window.POEMS_ALL || !window.POEMS_ALL.length) {
      document.body.innerHTML = '<div class="empty" style="padding:60px 20px">诗词数据加载失败</div>';
      return;
    }
    // 按日期自动重建计划
    todayKey = todayKeyStr();
    setInterval(function () {
      if (todayKeyStr() !== todayKey) {
        todayKey = todayKeyStr();
        invalidatePlan();
        rebuildToday();
      }
    }, 60 * 1000);

    applyAppName();
    // 顶栏由 js/chrome.js 渲染，渲染完成后要再同步一次第二行
    document.addEventListener("chrome:ready", function () {
      applyAppName();
    });
    // 清理已删条目留下的孤儿背诵进度（课内 12 组自身重复去重后的旧键）：
    // 这动的是用户的本地进度，所以口径写死（见 js/storage.js 的 pruneUnknown）、
    // 且在**启动时只做一次** —— 每改一次设置、每排一次任务都扫一遍
    // 既没有必要，也把「什么时候会动用户的进度」这件事变得说不清。
    var pruned = Storage.pruneUnknown((window.POEMS_ALL || []).map(function (p) { return p.id; }));
    if (pruned.length) invalidatePlan();
    renderGradeChips();
    rebuildToday();
    renderAll();
    bindEvents();
    backfillSnapshots();
    // 深链接：`/?poem=<id>`（「背诵进度总览」里那份到期清单指回来的地址）——
    // 落在**首屏画好之后**，用户先看到一张正常的首页，弹层再叠上去；
    // 关掉弹层回到的就是这一张首页，而不是半张白纸。
    openDeepLink();
    // 语料订正过的自选篇目：把还旧着的快照按需拉回来刷新（拉不到就留着 stale，
    // 下次再试）。放在这里而不是 document.ready 之后立刻做 —— 首屏先画出来，
    // 拉取在后台进行，失败也不影响用。
    refreshStaleSnapshots().catch(function () { /* 离线 / 拉取失败：老快照照常显示 */ });
    // 自选集合在别的页面增删之后回到首页：今日任务要立刻跟着变 ——
    // 不补这一条，刚加的一篇要等刷新才排上。
    // 增删的入口有三处：集子索引页 / 搜索页的书签，以及**设置整页的「我的清单」**
    // （Issue #114 第二条把管理入口从首页搬到了那儿，改完回首页就得排上）。
    // 三处派发的都是同一个 recite-collections-change 事件，这里一视同仁。
    window.addEventListener("recite-collections-change", function () {
      invalidatePlan();
      rebuildToday();
    });
    window.addEventListener("storage", function (e) {
      if (!window.ReciteCollections || e.key !== window.ReciteCollections.KEY) return;
      invalidatePlan();
      rebuildToday();
    });
    syncBottomGap();
    window.addEventListener("resize", syncBottomGap);
    window.addEventListener("orientationchange", syncBottomGap);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
