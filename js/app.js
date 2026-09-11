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

  // 默认用户名：未填写时使用
  const DEFAULT_USERNAME = "Ashley";

  // 若以后课外小古文库收录了与课内同名/同篇的内容，在这里登记：
  // "课内诗题": "gw-xx"，详情弹层就会出现「阅读本篇」入口。
  // 目前课内 242 首（含长文言文）与课外 34 篇无一重名，故留空。
  const CLASSIC_LINKS = {};

  // 注音档位：off 关闭 ｜ rare 只标生字（默认）｜ all 全文注音
  const PINYIN_KEY = "poem_helper_pinyin_v1";
  const PINYIN_MODES = ["off", "rare", "all"];

  let settings = Storage.getSettings();
  let todayPlan = [];
  let currentPoem = null;
  let todayKey = "";

  /* ---------------- 阅读辅助：注音 / 朗读 ---------------- */
  // 设置里的「阅读辅助」是总开关（settings.helper），诗词弹层里的按钮是本次用法。
  // 总开关关闭时，按钮仍然可用，只是不默认打开，避免孩子误触。
  function helperEnabled() {
    return settings.helper !== "off";
  }

  /**
   * 当前注音档位。
   * 兼容旧版布尔开关：旧值 "1" ⇒ 只标生字（新版默认，不再全文注音），"0" ⇒ 关闭。
   */
  function pinyinMode() {
    const v = localStorage.getItem(PINYIN_KEY);
    if (PINYIN_MODES.indexOf(v) > -1) return v;
    return v === "1" ? "rare" : "off";
  }

  function setPinyinMode(mode) {
    localStorage.setItem(PINYIN_KEY, PINYIN_MODES.indexOf(mode) > -1 ? mode : "off");
  }

  /** 是否处于注音状态（rare / all 都算开启） */
  function pinyinOn() {
    return pinyinMode() !== "off";
  }

  /** 传给 Pinyin.annotateHtml 的模式："all" 或 "rare" */
  function pinyinRenderMode() {
    return pinyinMode() === "all" ? "all" : "rare";
  }

  /* ---------------- 工具 ---------------- */
  function todayKeyStr() {
    const d = new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  /** 当前用户名，去空格；为空则退回默认名 */
  function userName() {
    const n = String(settings.username == null ? "" : settings.username).trim();
    return n || DEFAULT_USERNAME;
  }

  /** 页面主标题文案 */
  function appTitle() {
    return userName() + "古诗词";
  }

  /** 把用户名同步到页面标题、品牌标题、iOS 桌面名与 PWA 清单 */
  function applyUserName() {
    const title = appTitle();
    document.title = title + " · 遗忘曲线记忆法";
    const h1 = $("#brand-name");
    if (h1) h1.textContent = title;

    $$('meta[name="apple-mobile-web-app-title"]').forEach(function (m) {
      m.setAttribute("content", title);
    });

    // 安卓/桌面安装后的应用名也跟随用户名
    const link = $('link[rel="manifest"]');
    if (link && window.Blob && window.URL && URL.createObjectURL) {
      try {
        const manifest = JSON.parse(JSON.stringify(window.__manifest || {}));
        if (manifest.name) {
          manifest.name = title;
          manifest.short_name = title;
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
        '<div class="item-arrow">›</div>';
      el.addEventListener("click", function () {
        openPoem(p, item);
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
      "共 " + todayPlan.length + " 首 · 待复习 " + reviewN + " 首 · 新学 " + (todayPlan.length - reviewN) + " 首";
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

    // 若这篇文言文在「课外必背小古文」库里有对应篇目，给一个去读全文的入口
    const extra = $("#m-classic-link");
    const gwId = CLASSIC_LINKS[p.title];
    if (extra) {
      if (gwId) {
        extra.hidden = false;
        extra.href = "./classic.html#" + gwId;
        extra.textContent = "在「课外必背小古文」中阅读本篇 ›";
      } else {
        extra.hidden = true;
      }
    }

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
      mode === "off" ? "已隐藏拼音" : mode === "all" ? "已全文注音" : "只标生字"
    );
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
        applyUserName();
      });
      uInput.addEventListener("change", function () {
        settings.username = uInput.value.trim().slice(0, 12);
        uInput.value = settings.username;
        Storage.saveSettings(settings);
        applyUserName();
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
        showToast(helperEnabled() ? "已开启注音与朗读" : "已关闭阅读辅助");
      });
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
      a.download = userName() + "古诗词背诵进度-" + todayKeyStr() + ".json";
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
          applyUserName();
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

    applyUserName();
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
