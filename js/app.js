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

  // 注音档位：off 关闭 ｜ rare 只标生字（默认）｜ all 全文注音
  const PINYIN_KEY = "poem_helper_pinyin_v1";
  const PINYIN_MODES = ["off", "rare", "all"];
  const DEFAULT_PINYIN_MODE = "rare"; // 新版默认「只标生字」

  let settings = Storage.getSettings();
  let todayPlan = [];
  let currentPoem = null;
  let todayKey = "";

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

  /** 旧版设置没有 classicEntry 字段，默认显示入口 */
  function classicEntryVisible() {
    return settings.classicEntry !== "hide";
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

  /**
   * 页面主标题：应用正式名固定为「跬步」，填了用户名时展示为「跬步 · 小明的古诗词」
   * （应用名不因用户名而变，避免出现「XX古诗词」这种花名）
   */
  function appTitle() {
    const n = String(settings.username == null ? "" : settings.username).trim();
    return n ? APP_NAME + " · " + n + "的古诗词" : APP_NAME;
  }

  /** 把应用名同步到页面标题、品牌标题、iOS 桌面名与 PWA 清单 */
  function applyAppName() {
    const title = appTitle();
    document.title = title + " · 古诗词背诵";
    const h1 = $("#brand-name");
    if (h1) h1.textContent = title;

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
    const uInput = $("#input-username");
    if (uInput) uInput.value = String(settings.username == null ? "" : settings.username);
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
    const se = $("#seg-classic-entry");
    if (se) {
      const hidden = settings.classicEntry === "hide";
      $$("button", se).forEach(function (b) {
        b.classList.toggle("active", (b.dataset.entry === "hide") === hidden);
      });
    }
  }

  /** 首页「小古文」入口的显示 / 隐藏（页面里仍可直达 classic.html） */
  function applyClassicEntry() {
    const entry = $("#classic-entry");
    if (entry) entry.hidden = !classicEntryVisible();
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
        readGlyph() + "</button>" +
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

  /** 朗读按钮图标（内联 SVG，跨设备一致） */
  function readGlyph() {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M4 9.5v5h3l4.2 3.4V6.1L7 9.5H4Z" />' +
      '<path d="M15.2 9.2a4 4 0 0 1 0 5.6" />' +
      "</svg>"
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
    renderPoemText(p);
    syncPinyinBtn();
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
      title: "今日 " + todayPlan.length + " 首",
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
    const on = ok && window.Speech.speaking() && !(window.ReaderPlayer && window.ReaderPlayer.isOpen());
    btn.dataset.on = on ? "1" : "0";
    $("#today-read-text").textContent = on ? "停止" : "朗读";
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

  function syncReadBtn() {
    const btn = $("#m-read-btn");
    if (!btn) return;
    const ok = !!(window.Speech && window.Speech.supported());
    btn.disabled = !ok;
    btn.title = ok ? "用手机语音朗读这首诗" : "当前浏览器不支持语音朗读";
    const on = ok && window.Speech.speaking();
    $("#m-read-text").textContent = ok ? (on ? "停止朗读" : "朗读") : "不支持朗读";
    btn.dataset.on = on ? "1" : "0";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function toggleRead() {
    if (!currentPoem || !window.Speech || !window.Speech.supported()) return;
    if (window.Speech.speaking()) {
      window.Speech.stop();
      showToast("已停止朗读");
    } else {
      const head = [currentPoem.title, currentPoem.dynasty, currentPoem.author].filter(Boolean).join("，");
      const ok = window.Speech.speak(head + "。" + currentPoem.text);
      showToast(ok ? "开始朗读" : "朗读启动失败，请重试");
    }
    // 立即同步一次（不等语音回调），并用定时器兜底处理引擎延迟
    syncReadBtn();
    setTimeout(syncReadBtn, 60);
    setTimeout(syncReadBtn, 300);
  }

  function closeModal() {
    if (window.Speech) window.Speech.stop();
    $("#modal").hidden = true;
    $("#settings-modal").hidden = true;
    document.body.style.overflow = "";
    currentPoem = null;
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

    $("#btn-settings").addEventListener("click", function () {
      renderGradeChips();
      $("#settings-modal").hidden = false;
      document.body.style.overflow = "hidden";
    });

    $$("[data-close]").forEach(function (el) {
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

    $$("#seg-classic-entry button").forEach(function (b) {
      b.addEventListener("click", function () {
        settings.classicEntry = b.dataset.entry === "hide" ? "hide" : "show";
        Storage.saveSettings(settings);
        applyClassicEntry();
        renderGradeChips();
        showToast(settings.classicEntry === "hide" ? "已隐藏首页小古文入口" : "已显示首页小古文入口");
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

    $("#btn-all").addEventListener("click", function () {
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

    $("#btn-reset").addEventListener("click", function () {
      if (confirm("确定要清空全部背诵进度吗？此操作不可恢复。")) {
        Storage.clear();
        invalidatePlan();
        rebuildToday();
        renderAll();
        showToast("进度已清空");
      }
    });

    $("#btn-export").addEventListener("click", function () {
      const blob = new Blob([Storage.exportJSON()], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "跬步背诵进度-" + todayKeyStr() + ".json";
      a.click();
      URL.revokeObjectURL(a.href);
      showToast("备份已导出");
    });

    $("#btn-import").addEventListener("click", function () {
      $("#file-import").click();
    });

    $("#file-import").addEventListener("change", function (e) {
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
    applyClassicEntry();
    renderGradeChips();
    rebuildToday();
    renderAll();
    bindEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
