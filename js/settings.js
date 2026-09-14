/**
 * 设置页逻辑（/settings/）
 *
 * 设置从「首页向上弹出的卡片」改为**独立整页**：
 *   · 首页齿轮 → 跳转到本页（/settings/），不再有弹层
 *   · 页底常驻「版权 + 用户协议 / 隐私条款」，且不被底部导航栏（播放栏 / 引导条）遮挡
 *   · 仍然与首页共用同一份存储（poem_recite_settings_v1），改完即生效
 *
 * 分组（功能变多后的归类，见 settings/index.html）：
 *   · 通用     —— 用户名、数据管理（全站共用）
 *   · 古诗词背诵 —— 学段 / 年级 / 学期 / 背诵范围 / 每日数量（只作用于「古诗词」页）
 *   · 阅读辅助  —— 古诗词与小古文共用的注音总开关
 *   · 朗读播放  —— 五档连读方式（与集子页圆键菜单读写同一份 poem_play_mode_v1）
 *   本文件不关心分组的具体归类，只按 id 回显与写值；
 *   分组会把 DOM 包一层 .settings-group，选择器一律用 id，所以不受影响。
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

  // 应用正式名称（固定，不随用户名变化），与 js/app.js 保持一致
  const APP_NAME = "跬步";
  const SETTINGS_KEY = "poem_recite_settings_v1";
  // 计划缓存按天 + 配置缓存，改了学段/年级/范围就需要失效，否则首页还是旧计划
  const PLAN_PREFIX = "poem_plan_";

  // 与 Scheduler.SCOPES 的默认值保持一致；本页不加载调度器（省流量），只做回显
  const DEFAULT_SCOPE = "term";
  const KNOWN_SCOPES = ["term", "upto", "primary", "middle", "primary_middle", "high", "all"];
  // 「背诵范围」的读法：与 js/scheduler.js 的 SCOPES[].scopeName 保持一致（本页不加载调度器）
  const SCOPE_NAMES = {
    term: "本年级本学期",
    upto: "本年级本学期及之前",
    primary: "小学阶段",
    middle: "初中阶段",
    primary_middle: "小学及初中阶段",
    high: "高中阶段",
    all: "全部阶段"
  };

  const DEFAULTS = {
    username: "",
    grade: 1,
    term: 1,
    scope: DEFAULT_SCOPE,
    helper: "off",
    dailyCount: 5,
    // 复习调度算法，见 js/review-models.js（键名即模型名）
    algo: "ebbinghaus"
  };

  let settings = null;

  /** 读取设置：以 js/storage.js 为准，本页兜底，避免首页/设置页字段漂移 */
  function loadSettings() {
    let raw = null;
    if (window.Storage && window.Storage.getSettings) {
      raw = window.Storage.getSettings();
    } else {
      try {
        raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      } catch (e) {
        raw = {};
      }
    }
    const merged = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      merged[k] = DEFAULTS[k];
    });
    Object.keys(raw || {}).forEach(function (k) {
      merged[k] = raw[k];
    });
    if (KNOWN_SCOPES.indexOf(merged.scope) === -1) merged.scope = DEFAULT_SCOPE;
    // 认不出来的算法键一律退回出厂默认 —— 界面说的与引擎用的必须是同一个
    if (!algoModels() || !algoModels().known(merged.algo)) merged.algo = DEFAULTS.algo;
    if (!STAGES[stageOf(merged.grade)]) merged.grade = DEFAULTS.grade;
    return merged;
  }

  function saveSettings() {
    if (window.Storage && window.Storage.saveSettings) {
      window.Storage.saveSettings(settings);
    } else {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }
  }

  function stageOf(grade) {
    if (grade <= 6) return "primary";
    if (grade <= 9) return "middle";
    return "high";
  }

  function gradeName(g) {
    return (window.GRADE_NAMES && window.GRADE_NAMES[g]) || g + "年级";
  }

  function showToast(msg) {
    const t = $("#toast");
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      t.hidden = true;
    }, 1800);
  }

  /** 页面标题：与首页同一条命名规则（跬步 · 设置） */
  function appTitle() {
    return APP_NAME + " · 设置";
  }

  /**
   * 顶栏由 js/chrome.js 统一渲染（第一行固定「跬步」，右侧是页面名）。
   * 这里只负责页面标题与 iOS 桌面名，顶栏文字交给 chrome.js，
   * 用户名改动后同步刷新一次顶栏右侧的页面名（若是首页语义则跟随用户名）。
   */
  function applyAppName() {
    document.title = appTitle() + " · " + APP_NAME;
    const meta = $('meta[name="apple-mobile-web-app-title"]');
    if (meta) meta.setAttribute("content", appTitle());
  }

  /** 改了配置就让首页的「今日计划」重新生成，否则回到首页仍是旧计划 */
  function invalidatePlan() {
    Object.keys(sessionStorage)
      .filter(function (k) {
        return k.indexOf(PLAN_PREFIX) === 0;
      })
      .forEach(function (k) {
        sessionStorage.removeItem(k);
      });
  }

  /* ---------------- 回显 ---------------- */
  function renderControls() {
    const stage = stageOf(settings.grade);
    const grades = STAGES[stage].grades;

    const box = $("#grade-chips");
    if (box) {
      box.innerHTML = "";
      grades.forEach(function (g) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = gradeName(g);
        b.dataset.grade = g;
        if (g === settings.grade) b.className = "active";
        box.appendChild(b);
      });
    }

    const mark = function (sel, key, value) {
      const seg = $(sel);
      if (!seg) return;
      $$("button", seg).forEach(function (b) {
        b.classList.toggle("active", String(b.dataset[key]) === String(value));
      });
    };
    mark("#seg-stage", "stage", stage);
    mark("#seg-term", "term", settings.term);
    mark("#seg-scope", "scope", settings.scope);
    mark("#seg-count", "count", settings.dailyCount);
    mark("#seg-helper", "helper", settings.helper === "on" ? "on" : "off");

    // 「背诵范围」下方回显当前范围：设置页此前是空的一块，回首页才知道选了什么
    const scopeHint = $("#scope-hint");
    if (scopeHint) scopeHint.textContent = "当前：" + (SCOPE_NAMES[settings.scope] || SCOPE_NAMES[DEFAULT_SCOPE]);

    const uInput = $("#input-username");
    if (uInput) uInput.value = String(settings.username == null ? "" : settings.username);

    renderPlayModes();
    renderAlgos();
  }

  /* ---------------- 复习算法（四张模型） ----------------
     选项定义在 js/review-models.js，与首页 / 进度页同源：
     这里只负责「画出来、标上当前那张、写回 poem_recite_settings_v1」，
     不把各模型的说明另抄一份 —— 抄一份就会与首页副标题分叉。 */
  function algoModels() {
    return (typeof window !== "undefined" && window.ReviewModels) || null;
  }

  /** 画一遍四张模型，并把当前那张标成选中 */
  function renderAlgos() {
    const RM = algoModels();
    const box = $("#seg-algo");
    if (!box) return;
    if (!RM) {
      // 脚本没加载（或顺序错）时不要留一块空白：明说一句，别让人以为是没做完
      box.innerHTML = '<div class="settings-hint">复习算法加载失败：请刷新页面重试。</div>';
      return;
    }
    const cur = RM.known(settings.algo) ? settings.algo : RM.DEFAULT_KEY;
    box.innerHTML = RM.keys().map(function (k) {
      const m = RM.describe(k);
      return '<button type="button" role="radio" class="algo-opt' + (k === cur ? " active" : "") +
        '" data-algo="' + m.key + '" aria-checked="' + (k === cur ? "true" : "false") + '">' +
        '<span class="algo-name">' + m.name +
        '<span class="algo-years">' + m.years + "</span></span>" +
        '<span class="algo-blurb">' + m.blurb + "</span>" +
        "</button>";
    }).join("");

    const m = RM.describe(cur);
    const hint = $("#algo-hint");
    if (hint) {
      hint.textContent = "当前：" + m.name + "（背诵页副标题会写「" + m.sub + "」）";
    }
    const iv = $("#algo-interval");
    if (iv) iv.textContent = intervalText(cur);
  }

  /**
   * 「复习间隔」那一行的说明：每张模型的口径不同，**照实说**。
   * ⚠️ 不把所有模型都写成同一句「当天 → 1 → 2 → 4 …天」——
   *    那是遗忘曲线那一张的表，Leitner / SM-2 / FSRS 的间隔是走出来的，
   *    不是一张固定表；写错比不写更误导。
   */
  function intervalText(key) {
    if (key === "leitner") return "五个盒子：1 / 2 / 4 / 8 / 16 天，答对往后挪一盒、答错退回第一盒";
    if (key === "sm2") return "间隔 × 简易度：1 → 3 → 7 天，之后每次乘简易度（出厂 2.5，最低 1.3）";
    if (key === "fsrs") return "按稳定天数 S 算：曲线衰减到九成时到期，越稳固间隔越长";
    return "固定表：当天 → 1 → 2 → 4 → 7 → 15 → 30 → 60 → 120 → 240 天";
  }

  /**
   * 把已有进度**换算**到新算法上（不清进度）。
   *
   * 这一步在切算法时做一次、且只做一次：已经把每条记录的状态换算成新模型的
   * 落点（见 ReviewModels.adopt），之后新做的评价就按新模型算。
   * 为什么不留给首页懒换算：用户换完算法可能先去看进度总览，
   * 那时记录还挂着旧模型的状态，阶段名会说成旧模型的话。
   *
   * ⚠️ 换算**不动** nextReviewAt —— 「什么时候到期」是用户已经排好的事，
   *    换一套算「以后怎么排」的公式，不该顺手把他今天的任务也挪了。
   */
  function adoptProgress(key) {
    const RM = algoModels();
    const S = window.Storage;
    if (!RM || !S || !S.all || !S.setMany) return 0;
    const all = S.all() || {};
    const list = [];
    Object.keys(all).forEach(function (id) {
      const rec = all[id];
      if (!rec || rec.algo === key) return;
      list.push({ id: id, rec: RM.adopt(rec, key) });
    });
    if (list.length) S.setMany(list);
    return list.length;
  }

  /** 换算法：写进设置，并把已有进度换算到新模型（不清零） */
  function setAlgo(key) {
    const RM = algoModels();
    if (!RM || !RM.known(key) || key === settings.algo) {
      renderAlgos();
      return;
    }
    settings.algo = key;
    saveSettings();
    const n = adoptProgress(key);
    renderAlgos();
    const m = RM.describe(key);
    showToast("复习算法已改为「" + m.name + "」" + (n ? "，已换算 " + n + " 篇的进度" : ""));
  }

  /* ---------------- 朗读播放（五档连读方式） ----------------
     这一组的选项**不写进 poem_recite_settings_v1**，而是写进朗读偏好自己的
     poem_play_mode_v1 —— 与集子页那颗圆键菜单是同一份。理由是它本来就是
     「播放档位」，跨集子共用；若塞进背诵设置，导出备份就会把两件事混在一起，
     而且集子页（不加载本页脚本）也读不到。
     档位定义取自 js/play-modes.js，与阅读器同源，不在本文件里另抄一份。 */
  function playModes() {
    return (typeof window !== "undefined" && window.PlayModes) || null;
  }

  /** 当前档位（本机存值；缺 js/play-modes.js 时退回出厂档，不猜） */
  function currentPlayMode() {
    const PM = playModes();
    if (!PM) return "";
    return PM.read();
  }

  /** 画一遍五档单选项，并把当前档位标成选中 */
  function renderPlayModes() {
    const PM = playModes();
    const box = $("#seg-play");
    if (!box) return;
    if (!PM) {
      // 脚本没加载（或顺序错）时**不要留一块空白**：明确说出来，别让人以为是没做完
      box.innerHTML = '<div class="settings-hint">播放档位加载失败：请刷新页面重试。</div>';
      return;
    }
    const cur = PM.read();
    box.innerHTML = PM.LIST.map(function (m) {
      return '<button type="button" role="radio" class="play-mode-opt' + (m.id === cur ? " active" : "") +
        '" data-play-mode="' + m.id + '" aria-checked="' + (m.id === cur ? "true" : "false") + '">' +
        '<span class="play-mode-name">' + m.label + "</span>" +
        (m.note ? '<span class="play-mode-note">' + m.note + "</span>" : "") +
        "</button>";
    }).join("");

    const hint = $("#play-hint");
    if (hint) {
      const m = PM.of(cur) || PM.of(PM.DEFAULT);
      hint.textContent = "当前：" + m.short + (m.note ? "（" + m.note + "）" : "");
    }
  }

  /** 改档位：与集子页同一条路 —— 走 PlayModes.write 再通知 */
  function setPlayMode(id) {
    const PM = playModes();
    if (!PM || !PM.write(id)) return;
    PM.emit(id);
    renderPlayModes();
    const m = PM.of(id);
    if (m) showToast("连读方式已改为「" + m.label + "」");
  }

  /* ---------------- 事件 ---------------- */
  function bindEvents() {
    $$("#seg-stage button").forEach(function (b) {
      b.addEventListener("click", function () {
        const stage = b.dataset.stage;
        const grades = STAGES[stage] ? STAGES[stage].grades : null;
        if (!grades) return;
        // 换学段时年级要跟着落在该学段内，否则会停在「高中 · 一年级」这种组合
        if (grades.indexOf(settings.grade) === -1) settings.grade = grades[0];
        saveSettings();
        invalidatePlan();
        renderControls();
        showToast("已切换到" + STAGES[stage].name);
      });
    });

    const chips = $("#grade-chips");
    if (chips) {
      chips.addEventListener("click", function (e) {
        const b = e.target.closest("button");
        if (!b || !b.dataset.grade) return;
        settings.grade = Number(b.dataset.grade);
        saveSettings();
        invalidatePlan();
        renderControls();
        showToast("已切换到" + gradeName(settings.grade));
      });
    }

    $$("#seg-term button").forEach(function (b) {
      b.addEventListener("click", function () {
        settings.term = Number(b.dataset.term);
        saveSettings();
        invalidatePlan();
        renderControls();
        showToast(settings.term === 1 ? "已切换到上学期" : "已切换到下学期");
      });
    });

    $$("#seg-scope button").forEach(function (b) {
      b.addEventListener("click", function () {
        settings.scope = b.dataset.scope;
        saveSettings();
        invalidatePlan();
        renderControls();
      });
    });

    $$("#seg-count button").forEach(function (b) {
      b.addEventListener("click", function () {
        settings.dailyCount = Number(b.dataset.count);
        saveSettings();
        invalidatePlan();
        renderControls();
        showToast("已设置为每日 " + settings.dailyCount + " 首");
      });
    });

    $$("#seg-helper button").forEach(function (b) {
      b.addEventListener("click", function () {
        settings.helper = b.dataset.helper === "on" ? "on" : "off";
        saveSettings();
        renderControls();
        showToast(settings.helper === "on" ? "阅读辅助已开启：打开诗词自动注音" : "阅读辅助已关闭：打开诗词为纯文本");
      });
    });

    const playBox = $("#seg-play");
    if (playBox) {
      playBox.addEventListener("click", function (e) {
        const b = e.target.closest("button[data-play-mode]");
        if (!b) return;
        setPlayMode(b.dataset.playMode);
      });
    }

    const algoBox = $("#seg-algo");
    if (algoBox) {
      algoBox.addEventListener("click", function (e) {
        const b = e.target.closest("button[data-algo]");
        if (!b) return;
        setAlgo(b.dataset.algo);
      });
    }

    const uInput = $("#input-username");
    if (uInput) {
      const commit = function () {
        settings.username = uInput.value.trim().slice(0, 12);
        saveSettings();
        applyAppName();
      };
      uInput.addEventListener("input", function () {
        settings.username = uInput.value.trim().slice(0, 12);
        saveSettings();
        applyAppName();
      });
      uInput.addEventListener("change", function () {
        commit();
        uInput.value = settings.username;
      });
      uInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          uInput.blur();
        }
      });
    }

    const reset = $("#btn-reset");
    if (reset) {
      reset.addEventListener("click", function () {
        if (!confirm("确定要清空全部背诵进度吗？此操作不可恢复。")) return;
        if (window.Storage && window.Storage.clear) {
          window.Storage.clear();
        } else {
          Object.keys(localStorage)
            .filter(function (k) {
              return k.indexOf("poem_") === 0;
            })
            .forEach(function (k) {
              localStorage.removeItem(k);
            });
          // 清空进度不该顺手把设置也抹掉，这里按首页的行为补回设置
          saveSettings();
        }
        invalidatePlan();
        showToast("进度已清空");
      });
    }

    const exportBtn = $("#btn-export");
    if (exportBtn) {
      exportBtn.addEventListener("click", function () {
        const d = new Date();
        const day = d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
        const json = window.Storage && window.Storage.exportJSON
          ? window.Storage.exportJSON()
          : JSON.stringify({ settings: settings, progress: {} });
        const blob = new Blob([json], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "跬步背诵进度-" + day + ".json";
        a.click();
        URL.revokeObjectURL(a.href);
        showToast("备份已导出");
      });
    }

    const importBtn = $("#btn-import");
    const fileInput = $("#file-import");
    if (importBtn && fileInput) {
      importBtn.addEventListener("click", function () {
        fileInput.click();
      });
      fileInput.addEventListener("change", function (e) {
        const f = e.target.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = function () {
          try {
            if (!window.Storage || !window.Storage.importJSON) throw new Error("当前浏览器不支持导入");
            window.Storage.importJSON(reader.result);
            settings = loadSettings();
            invalidatePlan();
            applyAppName();
            renderControls();
            showToast("备份导入成功");
          } catch (err) {
            showToast("导入失败：" + err.message);
          }
        };
        reader.readAsText(f);
        e.target.value = "";
      });
    }
  }

  /* ---------------- 底部留白：不被底部导航栏遮挡 ---------------- */
  /**
   * 底部导航栏 = 播放栏（.player-bar，z-index 70，fixed 贴底）；
   * iOS 引导条（.ios-install-tip，z-index 40）出现时会压住页面最后一行的法务链接。
   * 两者都收在 js/pwa.js / js/reader.js 里统一同步，这里只负责告诉它们「先算上完整导航栏高度」。
   */
  function syncNavGap() {
    document.documentElement.style.setProperty("--nav-h", "0px");
    document.body.classList.add("no-player");
    if (window.PWA && window.PWA.syncBottomGap) {
      window.PWA.syncBottomGap();
    } else {
      const tip = $("#ios-install-tip");
      document.body.classList.toggle("has-install-tip", !!(tip && !tip.hidden));
    }
  }

  function init() {
    settings = loadSettings();
    applyAppName();
    renderControls();
    bindEvents();
    // 另一个标签页改了播放档位（集子页那颗圆键）时，本页单选项跟着变 ——
    // storage 事件只在「别的标签页」触发，正是这里需要的方向。
    window.addEventListener("storage", function (e) {
      const PM = playModes();
      if (!PM || e.key !== PM.KEY) return;
      renderPlayModes();
    });
    if (window.PlayModes && window.PlayModes.subscribe) {
      window.PlayModes.subscribe(function () { renderPlayModes(); });
    }
    syncNavGap();
    window.addEventListener("resize", syncNavGap);
    window.addEventListener("orientationchange", syncNavGap);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
