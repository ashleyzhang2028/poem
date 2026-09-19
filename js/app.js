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

  const APP_NAME = "跬步";

  const FONT_KEY = "poem_font_v1";
  const FONT_SIZES = [13, 15, 17, 19, 21, 23];
  const DEFAULT_FONT = 17;

  const ALIGN_KEY = "poem_align_v1";
  const ALIGNS = ["left", "center"];
  const DEFAULT_ALIGN = "center";

  const PINYIN_KEY = "poem_helper_pinyin_v1";
  const PINYIN_MODES = ["off", "rare", "all"];
  const DEFAULT_PINYIN_MODE = "rare";

  let settings = Storage.getSettings();

  function adoptHelperFromDevice() {
    if (!window.ProgressStore || typeof window.ProgressStore.helper !== "function") return;
    try { settings.helper = window.ProgressStore.helper(); } catch (e) {  }
  }
  adoptHelperFromDevice();

  let todayPlan = [];
  let currentPoem = null;
  let todayKey = "";

  let speakingTarget = "原文";

  function helperEnabled() {
    return settings.helper !== "off";
  }

  function pinyinMode() {

    if (!helperEnabled()) return "off";
    const v = localStorage.getItem(PINYIN_KEY);

    if (PINYIN_MODES.indexOf(v) > -1) return v;
    return DEFAULT_PINYIN_MODE;
  }

  function setPinyinMode(mode) {
    const m = PINYIN_MODES.indexOf(mode) > -1 ? mode : "off";
    localStorage.setItem(PINYIN_KEY, m);

    const want = m !== "off";
    if (helperEnabled() !== want) {
      settings.helper = want ? "on" : "off";
      Storage.saveSettings(settings);
      renderGradeChips();
    }
  }

  function pinyinOn() {
    return pinyinMode() !== "off";
  }

  function pinyinRenderMode() {
    return pinyinMode() === "all" ? "all" : "rare";
  }

  function resetPinyinMode() {
    localStorage.setItem(PINYIN_KEY, helperEnabled() ? DEFAULT_PINYIN_MODE : "off");
    if (currentPoem) renderPoemText(currentPoem);
    syncPinyinBtn();
  }

  function todayKeyStr() {
    const d = new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  const DEFAULT_USER = "Ashley";

  function userName() {
    const n = String(settings.username == null ? "" : settings.username).trim();
    return n || DEFAULT_USER;
  }

  function commitNickname(value) {
    const clean = String(value == null ? "" : value).trim().slice(0, 12);
    settings.username = clean;
    Storage.saveSettings(settings);
    const A = window.Avatar;
    if (A && typeof A.saveNickname === "function") {
      try { A.saveNickname(window.localStorage, clean); } catch (e) {  }
    }
  }

  function appTitle() {
    return APP_NAME + " · " + userName() + "的背诵";
  }

  function applyAppName() {
    const title = appTitle();

    document.title = title + " · " + APP_NAME;
    const h1 = $("#brand-name");
    if (h1) h1.textContent = APP_NAME;

    syncBrandPage();

    applyAlgoSub();

    $$('meta[name="apple-mobile-web-app-title"]').forEach(function (m) {
      m.setAttribute("content", title);
    });

    if (window.ManifestSync && typeof window.ManifestSync.apply === "function") {
      window.ManifestSync.apply(title);
    }

  }

  function syncBrandPage() {
    const el = $("#brand-page-text");
    const page = $("#brand-page");
    if (!el) return;
    el.textContent = userName() + "的背诵";
    if (page) page.hidden = false;

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

  function scopeKey() {
    return Scheduler.SCOPES[settings.scope] ? settings.scope : Scheduler.DEFAULT_SCOPE;
  }

  function algoKey() {
    if (!window.ReviewModels) return "ebbinghaus";

    return window.ReviewModels.allowedKey(settings.algo, algoCtx());
  }

  function algoCtx() {
    if (!window.Entitlement || typeof Entitlement.identity !== "function") return undefined;
    try {
      const id = Entitlement.identity();
      return id && id.ctx ? id.ctx : undefined;
    } catch (e) {
      return undefined;
    }
  }

  function algoShort() {
    return window.ReviewModels
      ? window.ReviewModels.describe(algoKey()).short
      : "遗忘曲线";
  }

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
      scopeKey() + "_" + settings.dailyCount + "_" + collectionsKey() + "_" +
      dailyExtraKey() +

      "_algo-" + algoKey()
    );
  }

  // 今日加背的指纹：加 / 删一篇就换一把缓存键，计划随之重算。
  // 取的是**今天**那一份（DailyExtra 自己按日期判），所以跨过 0 点指纹
  // 自己会变 —— 与 todayKeyStr() 那一层双保险。
  function dailyExtraKey() {
    if (!window.DailyExtra) return "0";
    try {
      return window.DailyExtra.today() + "-" + window.DailyExtra.ids().join(",");
    } catch (e) {
      return "0";
    }
  }

  function extraPoems() {
    if (!window.ReciteCollections) return [];
    return window.ReciteCollections.scheduleItems(window.SITE_INDEX || []);
  }

  // 「今日加背」（js/daily-extra.js）：小朋友今天主动多背的那几篇。
  // 它**不走** extraPoems 那条路：extraPoems 进的是 scheduler 的候选池，
  // 池子会被 dailyCount（3/5/8/10）裁掉 —— 用户要的是「点一下，5 首变 6 首」，
  // 被裁掉就成了一句空话。所以它由 withTodayExtra() 在计划生成**之后**并上，
  // 数量无条件累加。
  function todayExtraPoems() {
    if (!window.DailyExtra) return [];
    return window.DailyExtra.poems();
  }

  function invalidateAndRefreshPlan() {
    invalidatePlan();
    todayPlan = buildTodayPlan();
    renderToday();
    renderAll();
  }

  // 把「今日加背」那几篇并进计划**末尾**。
  //
  // 三条口径：
  //   ① 放在末尾 —— 今日背诵列表的第一条永远还是今天该背的那一首
  //      （顺序变了，小孩会以为计划乱了）；
  //   ② 按 wid 去重 —— 课内那首《静夜思》已经在计划里时，再从唐诗页
  //      点一次「加入今日背诵」不会多出重复的一条；
  //   ③ 数量无条件累加 —— 5 首的档加一篇就是 6 首，不被 dailyCount 裁掉。
  function withTodayExtra(plan) {
    const list = (plan || []).slice();
    const extra = todayExtraPoems();
    if (!extra.length) return list;

    const seen = {};
    list.forEach(function (it) {
      if (!it || !it.poem) return;
      seen[widOf(it.poem.id)] = true;
    });

    extra.forEach(function (p) {
      const wid = widOf(p.id);
      if (seen[wid]) return;
      seen[wid] = true;
      const rec = getRecord(p.id);
      list.push({
        poem: p,
        reason: "pinned",
        reviewRound: rec && rec.learned ? rec.level + 1 : 1,
        lastReviewAt: rec ? rec.lastReviewAt : null
      });
    });
    return list;
  }

  function widOf(id) {
    if (window.WorksIndex && typeof window.WorksIndex.widOf === "function") {
      try { return window.WorksIndex.widOf(id) || id; } catch (e) {  }
    }
    return id;
  }

  function buildTodayPlan() {

    const key = planCacheKey();
    const cached = sessionStorage.getItem(key);
    if (cached) {
      try {
        const ids = JSON.parse(cached);
        const map = {};
        window.POEMS_ALL.forEach(function (p) {
          map[p.id] = p;
        });

        extraPoems().forEach(function (p) {
          map[p.id] = p;
        });
        todayExtraPoems().forEach(function (p) {
          map[p.id] = p;
        });
        const restored = ids
          .map(function (it) {
            return { poem: map[it.id], reason: it.reason, reviewRound: it.reviewRound, lastReviewAt: it.lastReviewAt };
          })
          .filter(function (it) {
            return !!it.poem;
          });
        if (restored.length === ids.length) return withTodayExtra(restored);
      } catch (e) {

      }
    }

    const plan = withTodayExtra(Scheduler.generateDailyPlan({
      grade: settings.grade,
      term: settings.term,
      count: settings.dailyCount,
      scope: scopeKey(),
      provider: provider,
      getRecord: getRecord,
      extraPoems: extraPoems()
    }));

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

      const metaTail = p.custom
        ? esc((p.bookName || "自选") + (p.source && p.source !== p.bookName ? " · " + p.source : ""))
        : esc(gradeName(p.grade) + termName(p.term));
      const el = document.createElement("div");
      el.className = "item " + (item.reason === "review" ? "review" : "new") +
        (item.reason === "pinned" ? " pinned" : "") +
        (p.custom ? " optional" : "") + (done ? " done" : "");
      el.dataset.id = p.id;
      el.innerHTML =
        '<div class="item-main">' +

        '<h3 class="item-title"><span class="item-num">' + (idx + 1) + "</span>" + esc(p.custom ? showTitle(p.title) : p.title) +
        '<span class="item-reason ' + (item.reason === "review" ? "review"
          : item.reason === "pinned" ? "pinned" : "") + '">' +
        (item.reason === "review" ? "复习 · 第" + (item.reviewRound || 1) + "轮"
          : item.reason === "extra" ? "巩固"
          : item.reason === "pinned" ? "今日加背"
          : item.reason === "optional" ? "自选" : "新学") +
        "</span></h3>" +

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
    const pinnedN = todayPlan.filter(function (it) { return it.reason === "pinned"; }).length;
    $("#today-sub").textContent =
      "共 " + todayPlan.length + " 首 · 待复习 " + reviewN + " · 新学 " +
      (todayPlan.length - reviewN - pinnedN) +
      (pinnedN ? " · 加背 " + pinnedN : "");

    syncTodayReadBtn();
    if (todaySearchUI) todaySearchUI.refresh();
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

        '<h3 class="item-title"><span class="item-num">' + (i + 1) + "</span>" + esc(p.title) + "</h3>" +
        '<div class="item-meta">' +
        metaLine([p.dynasty, p.author].concat(

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

  function showTitle(title) {
    if (window.ReciteCollections && window.ReciteCollections.displayTitle) {
      return window.ReciteCollections.displayTitle(title);
    }
    return title;
  }

  function customPoem(p, repId, entryId) {
    const src = (window.SITE_INDEX || []).filter(function (x) { return x.id === (entryId || repId); })[0];
    return Object.assign({}, p, {
      id: repId,
      custom: true,
      bookName: (src && src.bookName) || p.bookName || "",
      translationSource: (src && src.translationSource) || p.translationSource
    });
  }

  function backfillSnapshots() {
    if (!window.ReciteCollections) return;
    const C = window.ReciteCollections;
    C.refreshSnapshots(window.SITE_INDEX || []);
    if (C.markStale) C.markStale(window.SITE_INDEX || []);
  }

  const BOOK_SOURCES = {
    classic: { file: "data/poems-classic.js", global: "POEMS_CLASSIC" },
    tangshi: { file: "data/poems-tangshi.js", global: "POEMS_TANGSHI" },
    songci: { file: "data/poems-songci.js", global: "POEMS_SONGCI" },
    guwen: { file: "data/poems-guwen.js", global: "POEMS_GUWEN" },
    zhaoming: { file: "data/poems-zhaoming.js", global: "POEMS_ZHAOMING" },
    yuanqu: { file: "data/poems-yuanqu.js", global: "POEMS_YUANQU" }
  };

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

        if (p) return;

        const book = (it.snap && it.snap.book) || guessBook(it.id);
        if (!book || !BOOK_SOURCES[book]) return;
        (out[book] = out[book] || []).push(it.id);
      });
    });
    return out;
  }

  function guessBook(entryId) {
    const m = String(entryId).match(/^([a-z]+)-/);
    if (!m) return "";
    const pre = m[1];
    return BOOK_SOURCES[pre] ? pre : "";
  }

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

  function refreshFromGlobal(bookId, src) {
    const list = window[src.global];
    if (!Array.isArray(list) || !list.length) return 0;

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

  function refreshStaleSnapshots() {
    const need = staleByBook();
    const books = Object.keys(need);
    if (!books.length) return Promise.resolve(0);

    return books.reduce(function (chain, book) {
      return chain.then(function (n) {
        return pullBook(book).then(function (k) {
          if (k) rebuildToday();
          return n + k;
        });
      });
    }, Promise.resolve(0));
  }

  function deepLinkId() {
    var q = "";
    try {
      q = (window.location && window.location.search) || "";
    } catch (e) {
      q = "";
    }
    var m = /(?:^|[?&])poem=([^&]+)/.exec(q);
    if (!m) {

      var h = "";
      try { h = (window.location && window.location.hash) || ""; } catch (e2) { h = ""; }
      m = /(?:^|[#&])poem=([^&]+)/.exec(h);
      if (!m) return "";
    }
    var id = m[1];
    try {
      id = decodeURIComponent(id.replace(/\+/g, " "));
    } catch (e3) {

    }
    return String(id || "").trim();
  }

  function clearDeepLink() {
    try {
      if (!window.history || !window.history.replaceState) return;
      var url = window.location.pathname + window.location.hash;
      window.history.replaceState(null, "", url);
    } catch (e) {

    }
  }

  function openDeepLink() {
    var id = deepLinkId();
    if (!id) return false;

    clearDeepLink();

    var poem = coursePoem(id) || optionalPoem(id);
    if (!poem || !poem.title) return false;

    if (!todayPlan.length) buildTodayPlan();
    openPoem(poem, null);
    return true;
  }

  function coursePoem(id) {
    var all = window.POEMS_ALL || [];
    for (var i = 0; i < all.length; i += 1) {
      if (all[i] && all[i].id === id) return all[i];
    }
    return null;
  }

  function optionalPoem(id) {
    if (!window.ReciteCollections || !window.ReciteCollections.scheduleItems) return null;
    var items = window.ReciteCollections.scheduleItems(window.SITE_INDEX || []);
    for (var i = 0; i < items.length; i += 1) {
      if (items[i] && items[i].id === id) return items[i];
    }
    return null;
  }

  function openPoem(p, planItem) {
    currentPoem = p;
    const rec = getRecord(p.id);

    $("#m-title").textContent = p.custom ? showTitle(p.title) : p.title;

    const dynEl = $("#m-dynasty");
    dynEl.textContent = p.dynasty ? "〔" + p.dynasty + "〕" : "";
    dynEl.hidden = !p.dynasty;
    $("#m-author").textContent = p.author;

    $("#m-grade").textContent = p.custom
      ? (p.bookName || "自选篇目")
      : gradeName(p.grade) + " " + termName(p.term);
    $("#m-trans-text").textContent = hasTranslation(p) ? p.translation : "（暂未收录译文）";

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
        ? "这首诗按" + algoShort() + "到期了，复习后请如实选择掌握程度"
        : planItem.reason === "pinned"
          ? "今天临时加背的，复习后同样按" + algoShort() + "排下次"
          : "新学的诗，今天先记一遍"
      : "背诵后点击按钮，系统会安排下次复习时间";

    $("#modal").hidden = false;
    document.body.style.overflow = "hidden";
    syncBottomGap();
  }

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

    if (!show) speakingTarget = speakingTarget === "译文" ? "原文" : speakingTarget;
    syncReadBtn();
  }

  function hasTranslation(p) {
    return !!(p && p.translation && String(p.translation).trim());
  }

  function syncPinyinBtn() {
    const seg = $("#m-pinyin-seg");
    if (!seg) return;
    const mode = pinyinMode();
    Array.prototype.forEach.call(seg.querySelectorAll("button"), function (b) {
      const on = b.dataset.mode === mode;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });

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

  function speechOk() {
    return !!(window.Speech && window.Speech.supported());
  }

  function speechReady() {
    if (!speechOk()) return false;
    return !!(window.Speech.allowed && window.Speech.allowed().ok);
  }

  function speechHint() {
    if (!speechOk()) return "当前浏览器不支持语音朗读";
    const a = window.Speech.allowed ? window.Speech.allowed() : { ok: true, hint: "" };

    return a.hint || "登录可用";
  }

  function speechText(p) {

    const head = [(p.custom ? showTitle(p.title) : p.title), p.dynasty, p.author].filter(Boolean).join("，");
    return head + "。" + p.text;
  }

  function readTodayAll() {
    if (!speechReady()) {
      showToast(speechHint());
      return;
    }
    if (!todayPlan.length) return;

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

  function readOne(p, btn) {
    if (!speechReady()) {
      showToast(speechHint());
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
    const ok = speechReady();
    btn.disabled = !ok;

    const on = ok && !!(window.ReaderPlayer && window.ReaderPlayer.isRunning && window.ReaderPlayer.isRunning());
    btn.dataset.on = on ? "1" : "0";
    btn.title = ok ? "依次朗读今天要背的每一首" : speechHint();
    btn.setAttribute("aria-label", ok ? (on ? "停止朗读" : "依次朗读今天要背的每一首") : speechHint());
    const text = $("#today-read-text");
    if (text) text.textContent = on ? "播放中" : "播放";
  }

  function highlightItem(id) {
    $$("#today-list .item").forEach(function (el) {
      el.classList.toggle("reading", el.dataset.id === id);
    });
  }

  function clearHighlight() {
    $$("#today-list .item").forEach(function (el) { el.classList.remove("reading"); });
  }

  function syncItemReadBtns() {
    const speaking = speechReady() && window.Speech.speaking();
    $$("#today-list .item-read").forEach(function (b) {
      b.dataset.on = speaking ? "1" : "0";
    });
  }

  function syncReadBtn() {
    const ok = speechReady();
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
      btn.title = !speechOk()
        ? "当前浏览器不支持语音朗读"
        : !ok
          ? speechHint()
          : cfg.key === "译文" && !hasTranslation(currentPoem)
          ? "本篇暂无译文"
          : cfg.title;
      const on = playing && speakingTarget === cfg.key;
      btn.dataset.on = on ? "1" : "0";
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });

    const tLabel = $("#m-trans-read-text");
    if (tLabel) {
      tLabel.textContent = playing && speakingTarget === "译文" ? "停止朗读" : "朗读译文";
    }
  }

  function toggleRead() {
    if (!currentPoem) return;
    if (!speechReady()) {
      showToast(speechHint());
      return;
    }
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

  function toggleTransRead() {
    if (!currentPoem) return;
    if (!speechReady()) {
      showToast(speechHint());
      return;
    }
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

    syncBottomGap();
  }

  function syncBottomGap() {
    if (window.PWA && window.PWA.syncBottomGap) window.PWA.syncBottomGap();
  }

  function handleResult(result) {
    if (!currentPoem) return;
    const rec = Storage.get(currentPoem.id) || Scheduler.createRecord();

    const next = Scheduler.review(rec, result, algoKey());
    Storage.set(currentPoem.id, next);

    showToast(window.ReviewModels
      ? window.ReviewModels.resultHint(algoKey(), result, next)
      : {
        good: "记住了！下次复习：" + new Date(next.nextReviewAt).toLocaleDateString("zh-CN"),
        fuzzy: "有点模糊，12 小时后再复习一次",
        bad: "没关系，30 分钟后再复习一次"
      }[result]);

    todayPlan = todayPlan.map(function (it) {
      if (it.poem.id === currentPoem.id) it.reviewRound = next.level + 1;
      return it;
    });
    closeModal();
    renderToday();
    renderAll();
  }

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

  let todaySearchUI = null;

  function todayPlanItemOf(id) {
    const list = todayPlan || [];
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].poem && list[i].poem.id === id) return list[i];
    }
    return null;
  }

  // 今日背诵页顶上的「再找一首」——下拉与搜索页一致，多一颗「＋」。
  function bindTodaySearch() {
    if (!window.DailyExtraUI) return;
    const ui = window.DailyExtraUI.bindSuggest({
      input: "#today-search",
      box: "#today-suggest",
      onToast: showToast,
      onOpen: function (p) {
        // 点行本身 = 直接打开这一篇（与搜索页同一个手感）。打开前先把它加进
        // 今天 —— **已经在里面的不许反而被移出**（行与那颗「＋」是两件事：
        // 「＋」是开关，行是「打开看」）。
        if (!window.DailyExtraUI.has(p)) addTodayExtra(p, true);
        const item = todayPlanItemOf(p.id);
        openPoem(item && item.poem ? item.poem : p,
          item || { reason: "pinned", reviewRound: 1, lastReviewAt: null });
      }
    });
    if (ui) todaySearchUI = ui;
  }

  function addTodayExtra(p, quiet) {
    if (!window.DailyExtraUI || !p) return;
    const r = window.DailyExtraUI.toggle(p);
    if (!quiet && r.message) showToast(r.message);
    if (r.ok === false) return;
    if (todaySearchUI) todaySearchUI.refresh();
  }

  function bindEvents() {

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

    const uInput = $("#input-username");
    if (uInput) {
      uInput.addEventListener("input", function () {
        commitNickname(uInput.value);
        applyAppName();
      });
      uInput.addEventListener("change", function () {
        commitNickname(uInput.value);
        uInput.value = settings.username;
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
        if (window.DailyExtra) window.DailyExtra.clear();
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

  window.PoemApp = {
    reloadSettings: function () {
      settings = Storage.getSettings();

      adoptHelperFromDevice();
      applyAppName();
      renderGradeChips();

      resetPinyinMode();
      invalidatePlan();
      rebuildToday();
      renderAll();
      return settings;
    }
  };

  function init() {
    if (!window.POEMS_ALL || !window.POEMS_ALL.length) {
      document.body.innerHTML = '<div class="empty" style="padding:60px 20px">诗词数据加载失败</div>';
      return;
    }

    todayKey = todayKeyStr();
    setInterval(function () {
      if (todayKeyStr() !== todayKey) {
        todayKey = todayKeyStr();
        invalidatePlan();
        rebuildToday();
      }
    }, 60 * 1000);

    applyAppName();

    document.addEventListener("chrome:ready", function () {
      applyAppName();
    });

    document.addEventListener("manifest:ready", function () {
      applyAppName();
    });

    var pruned = Storage.pruneUnknown((window.POEMS_ALL || []).map(function (p) { return p.id; }));
    if (pruned.length) invalidatePlan();
    renderGradeChips();
    rebuildToday();
    renderAll();
    bindEvents();
    bindTodaySearch();
    backfillSnapshots();

    openDeepLink();

    refreshStaleSnapshots().catch(function () {  });

    window.addEventListener("recite-collections-change", function () {
      invalidatePlan();
      rebuildToday();
    });
    window.addEventListener("daily-extra-change", function () {
      invalidateAndRefreshPlan();
    });
    window.addEventListener("storage", function (e) {
      if (!window.ReciteCollections || e.key !== window.ReciteCollections.KEY) return;
      invalidatePlan();
      rebuildToday();
    });
    syncBottomGap();
    window.addEventListener("resize", syncBottomGap);
    window.addEventListener("orientationchange", syncBottomGap);

    startSync();
  }

  function startSync() {
    const S = window.SyncStore;
    if (!S) return;
    try {
      const first = S.firstSync();
      if (first && first.then) first.then(afterSync, function () {  });
    } catch (e) {  }

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "hidden") return;
      try { S.now({ pull: false }); } catch (e) {  }
    });
  }

  function afterSync(r) {

    if (!r || r.skipped) return;
    if (r.pulled || (r.conflicts && r.conflicts)) {
      settings = Storage.getSettings();
      adoptHelperFromDevice();
      applyAppName();
      renderGradeChips();
      invalidatePlan();
      rebuildToday();
      renderAll();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
