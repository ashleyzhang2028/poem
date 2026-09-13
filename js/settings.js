/**
 * 设置页逻辑（/settings/）
 *
 * 设置从「首页向上弹出的卡片」改为**独立整页**：
 *   · 首页齿轮 → 跳转到本页（/settings/），不再有弹层
 *   · 页底常驻「版权 + 用户协议 / 隐私条款」，且不被底部导航栏（播放栏 / 引导条）遮挡
 *   · 仍然与首页共用同一份存储（poem_recite_settings_v1），改完即生效
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

  const DEFAULTS = {
    username: "",
    grade: 1,
    term: 1,
    scope: DEFAULT_SCOPE,
    helper: "off",
    dailyCount: 5
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
    document.title = appTitle() + " · 古诗词背诵";
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

    const uInput = $("#input-username");
    if (uInput) uInput.value = String(settings.username == null ? "" : settings.username);
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
