/**
 * 古诗词背诵 App 主逻辑
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

  /* 正文对齐三档：left / center / right，默认居中（与小古文详情页一致） */
  const ALIGN_KEY = "poem_align_v1";
  const ALIGNS = ["left", "center", "right"];
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
   * → 「跬步 · Ashley的古诗词」（用户没填名字时用默认名，不留一段空白）
   */
  function appTitle() {
    return APP_NAME + " · " + userName() + "的古诗词";
  }

  /**
   * 把应用名同步到页面标题、顶栏「跬步 · XX的古诗词」、iOS 桌面名与 PWA 清单。
   *
   * 顶栏第一行是「跬步 · 当前页名」：首页写「XX的古诗词」，
   * 小古文页与法务页由各页自己给页名（见 js/chrome.js 的 data-page）。
   * 用户名留空时用默认名 Ashley，不留空档。
   */
  function applyAppName() {
    const title = appTitle();
    document.title = title + " · 古诗词背诵";
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
  }

  /**
   * 顶栏第一行的页面名：首页写「XX的古诗词」，排在「跬步」右侧。
   * js/chrome.js 渲染完顶栏会派发 chrome:ready，收到后再写一次，
   * 否则刷新页面时 app.js 先跑、DOM 里还没有 #brand-page-text，用户名就丢了。
   */
  function syncBrandPage() {
    const el = $("#brand-page-text");
    const page = $("#brand-page");
    if (!el) return;
    el.textContent = userName() + "的古诗词";
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
  function planCacheKey() {
    return (
      "poem_plan_" + todayKeyStr() + "_" + settings.grade + "_" + settings.term + "_" +
      scopeKey() + "_" + settings.dailyCount
    );
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
        const restored = ids
          .map(function (it) {
            return { poem: map[it.id], reason: it.reason, reviewRound: it.reviewRound, lastReviewAt: it.lastReviewAt };
          })
          .filter(function (it) {
            return !!it.poem;
          });
        if (restored.length) return restored;
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
      getRecord: getRecord
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
      const el = document.createElement("div");
      el.className = "item " + (item.reason === "review" ? "review" : "new") + (done ? " done" : "");
      el.dataset.id = p.id;
      el.innerHTML =
        '<div class="item-index">' + (idx + 1) + "</div>" +
        '<div class="item-main">' +
        '<h3 class="item-title">' + esc(p.title) +
        '<span class="item-reason ' + (item.reason === "review" ? "review" : "") + '">' +
        (item.reason === "review" ? "复习 · 第" + (item.reviewRound || 1) + "轮" : item.reason === "extra" ? "巩固" : "新学") +
        "</span></h3>" +
        '<div class="item-meta"><span>' + esc(p.author) + "</span><span>·</span><span>" + esc(p.dynasty) + "</span>" +
        '<span>·</span><span>' + gradeName(p.grade) + termName(p.term) + "</span></div>" +
        (rec && rec.learned
          ? '<div class="mbar"><i style="width:' + Scheduler.mastery(rec) + '%"></i></div>'
          : "") +
        "</div>" +
        '<button type="button" class="item-read" title="朗读这一首" aria-label="朗读 ' + esc(p.title) + '">' +
        playGlyph() + "</button>" +
        '<div class="item-arrow">›</div>';
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
   */
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
        '<div class="item-index">' + (i + 1) + "</div>" +
        '<div class="item-main">' +
        '<h3 class="item-title">' + esc(p.title) + "</h3>" +
        '<div class="item-meta"><span>' + esc(p.dynasty) + "</span><span>·</span><span>" + esc(p.author) + "</span>" +
        (scope.random ? "<span>·</span><span>" + esc(gradeName(p.grade) + termName(p.term)) + "</span>" : "") +
        (rec && rec.learned
          ? '<span>·</span><span>' + Scheduler.levelName(rec.level) + "</span>"
          : '<span>·</span><span>未学过</span>') +
        "</div>" +
        (rec && rec.learned ? '<div class="mbar"><i style="width:' + Scheduler.mastery(rec) + '%"></i></div>' : "") +
        "</div>" +
        '<div class="item-arrow">›</div>';
      el.addEventListener("click", function () {
        openPoem(p, null);
      });
      box.appendChild(el);
    });
  }

  /* ---------------- 弹层 ---------------- */
  function openPoem(p, planItem) {
    currentPoem = p;
    const rec = getRecord(p.id);
    $("#m-title").textContent = p.title;
    $("#m-dynasty").textContent = "〔" + p.dynasty + "〕";
    $("#m-author").textContent = p.author;
    $("#m-grade").textContent = gradeName(p.grade) + " " + termName(p.term);
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
      info.push("<span>记忆阶段：<b>" + Scheduler.levelName(rec.level) + "</b></span>");
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
    showToast(mode === "left" ? "正文左对齐" : mode === "right" ? "正文右对齐" : "正文居中对齐");
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
    const head = [p.title, p.dynasty, p.author].filter(Boolean).join("，");
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
      showToast(ok ? "开始朗读《" + p.title + "》" : "朗读启动失败，请重试");
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
    const next = Scheduler.review(rec, result);
    Storage.set(currentPoem.id, next);

    const msgMap = {
      good: "记住了！下次复习：" + new Date(next.nextReviewAt).toLocaleDateString("zh-CN"),
      fuzzy: "有点模糊，12 小时后再复习一次",
      bad: "没关系，30 分钟后再复习一次"
    };
    showToast(msgMap[result]);

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
      if (e.key === "Escape") closeModal();
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
    renderGradeChips();
    rebuildToday();
    renderAll();
    bindEvents();
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
