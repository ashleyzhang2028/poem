/**
 * 设置页逻辑（/settings/）
 *
 * 设置从「首页向上弹出的卡片」改为**独立整页**：
 *   · 首页齿轮 → 跳转到本页（/settings/），不再有弹层
 *   · 页底常驻「版权 + 用户协议 / 隐私条款」，且不被底部导航栏（播放栏 / 引导条）遮挡
 *   · 仍然与首页共用同一份存储（poem_recite_settings_v1），改完即生效
 *
 * 二级设置页（Issue #132 后续）：
 *   设置项多了以后，六组摊成三页二级页，本文件仍是**三页共用**的那一份逻辑：
 *     /settings/general/  通用     —— 用户名 / 头像印记 / 本机账号 / 数据管理
 *     /settings/recite/   背诵     —— 学段 / 年级 / 学期 / 范围 / 数量
 *                                     + 复习算法 + 进度总览入口
 *     /settings/lists/    我的清单 —— 自选背诵：导入 / 导出 / 改名 / 删除 / 整组移出 / 顺顺序
 *     /settings/reader/   阅读与朗读 —— 注音总开关 + 五档连读
 *   主页（/settings/）只列入口 + 法务链接，不加载本文件。
 *
 *   ⚠️ 本文件**一页一实例**：每张页只放自己那几组控件，
 *      所有回显 / 写值都走「取不到就跳过」（`$()` 返回 null 时直接 return），
 *      所以同一份逻辑在四张页上都跑得对，不靠「哪张页必须有哪几个 id」的假设。
 *   ⚠️ 分组的容器仍是 .settings-group / .settings-groups，
 *      本文件不关心分组，只按 id 回显与写值。
 *
 * 「我的清单」那一组（Issue #114 第二条）原先是**首页**底部那张「自选背诵」折叠卡，
 * 用户原话：「所有导入，导出，重命名，删除等等应该全部在设置中进行」。
 * 搬过来的是**管理入口** —— 自选篇目照旧跟课内 261 首一起排每日任务，
 * 首页该背的还在今日列表里（见 index.html 里那段说明）。
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

  /**
   * 改昵称（Issue #132 · 2026-09-15）：老键 + 账号域新键一起写。
   * 镜像实现收在 `Avatar.saveNickname` 一处（与首页 js/app.js 同源），
   * 本页不许自己拼两处 setItem。
   */
  function commitNickname(value) {
    const clean = String(value == null ? "" : value).trim().slice(0, 12);
    settings.username = clean;
    saveSettings();
    const A = window.Avatar;
    if (A && typeof A.saveNickname === "function") {
      try { A.saveNickname(window.localStorage, clean); } catch (e) { /* 隐私模式：老键已写 */ }
    }
  }

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

    renderAvatar();
    renderAccount();
    renderAlgos();
    renderPlayModes();
    renderCollections();
  }

  /* ---------------- 我的清单：自选背诵（Issue #114 第二条） ----------------
     除教材之外，用户自己加进来要背的篇目（见 js/collections.js）。

     ⚠️ 这一块原先长在**首页**底部（那张「自选背诵」折叠卡）。搬过来的是
        **管理入口**，不是这些篇目的背诵：自选篇目本来就跟课内 261 首一起
        按遗忘曲线排每日任务，排上了就混在首页的今日列表里。
        两页读同一份 localStorage 键 poem_recite_collections_v1，改完即生效。

     ⚠️ 与首页那边同一套逻辑、同一套 DOM id（#collections-list / #collections-tools /
        #btn-collections-import / data-rename / data-export / data-drop /
        data-up / data-down / data-group）—— 两处不是各写一份实现，
        只是各有一套同名的 DOM。上次搬家时按这个口径搬，下次再动时才找得到。
     ------------------------------------------------------------------ */

  /** 篇名显示名：去掉语料内部用来区分同名词作的「其一 / 其二 / 其三」。
     用户原话「去掉自选集合中其一其二这些你不清楚的」——那个编号只是整理
     宋词时按目录次序补的序号，不是选本原名。只改**显示**，存的是完整 id。 */
  function showTitle(title) {
    if (window.ReciteCollections && window.ReciteCollections.displayTitle) {
      return window.ReciteCollections.displayTitle(title);
    }
    return title;
  }

  /** 条目 id → 篇目对象（站点索引优先；本页只加载了课内与站点索引，
      课外那些篇目靠加入时存下的**快照**兜底，见 renderCollections） */
  function poemForEntry(entryId) {
    const repId = window.ReciteCollections.poemIdFor(entryId);
    const idx = window.SITE_INDEX || [];
    return idx.filter(function (x) { return x.id === entryId || x.id === repId; })[0] || null;
  }

  /** 条目 id → 导出时的注释行（「集子 · 卷次 篇名」这种，家长看得懂） */
  function collectionLabelOf(entryId) {
    const p = poemForEntry(entryId);
    if (!p) return entryId;
    const bits = [p.bookName || p.source || "", p.gradeGroup || "", showTitle(p.title)];
    return bits.filter(Boolean).join(" · ") || entryId;
  }

  /**
   * 自选篇目的「组」：集子 + 卷次 / 词牌 / 文体（与集子页上的分组同一口径）。
   *
   * ⚠️ 回落要拿到**快照**：本页只加载课内与站点索引，五部集子那 4.4MB 语料
   *    没有；唐诗 / 宋词 那些篇目在站点索引里查不到，只有一个加入时存下的
   *    最小快照（里面有 bookName / gradeGroup）。不读快照的话这些篇目会
   *    一律算「未分组」—— 组名与「整组移出」的范围就对不上了
   *    （列表上写着「唐诗三百首 · 卷一 五言古诗」，移的却是「未分组」）。
   *    所以这里与 renderCollections 走**同一条取数路径**：先索引、后快照。
   */
  function groupInfoOf(item) {
    const entryId = typeof item === "string" ? item : item.id;
    const snap = (item && typeof item === "object" && item.snap) || {};
    const p = poemForEntry(entryId) || snap;
    const book = p.bookName || p.source || "";
    const group = book ? (p.gradeGroup ? book + " · " + p.gradeGroup : book) : "未分组";
    return { id: entryId, group: group };
  }

  /**
   * 条目 id → 分组名（`removeGroup` 比对时逐条回调它，传进来的是**条目 id**）。
   *
   * ⚠️ 这里收的只有 id 一个字串，拿不到那一条的快照 —— 而本页认不出的
   *    课外篇目（唐诗 / 宋词 ……）恰恰只能靠快照认出分组。所以先从当前
   *    加载的清单里把那一条**原样**找回来，再走 groupInfoOf：
   *    否则「整组移出」会按「未分组」比对，用户看着「唐诗三百首 · 卷一 五言古诗」
   *    这一组点了移出，实际一篇都没动（或者动了别的组）。
   */
  function collectionGroupOf(entryId) {
    const id = String(entryId == null ? "" : entryId);
    if (!window.ReciteCollections) return groupInfoOf(id).group;
    const cols = window.ReciteCollections.list();
    for (let i = 0; i < cols.length; i += 1) {
      const hit = (cols[i].items || []).filter(function (it) {
        return (typeof it === "string" ? it : it.id) === id;
      })[0];
      if (hit) return groupInfoOf(hit).group;
    }
    return groupInfoOf(id).group;
  }

  /** 与首页同款的分隔线拼接（空值即省掉分隔符） */
  function metaLine(parts) {
    const out = [];
    (parts || []).forEach(function (v) {
      const t = v == null ? "" : String(v);
      if (!t) return;
      if (out.length) out.push("<span>·</span>");
      out.push("<span>" + t + "</span>");
    });
    return out.join("");
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /** 一篇的背诵档案（掌握度那一栏要用）。本页不加载调度器，取不到就显示「未学过」。 */
  function getRecord(id) {
    if (window.Storage && window.Storage.get) return window.Storage.get(id);
    return null;
  }

  function levelName(rec) {
    if (window.Scheduler && window.Scheduler.levelName) {
      return window.Scheduler.levelName(rec.level);
    }
    return "第 " + (Number(rec.level) + 1) + " 轮";
  }

  function mastery(rec) {
    if (window.Scheduler && window.Scheduler.mastery) return window.Scheduler.mastery(rec);
    return 0;
  }

  /** 下载一段文本（手机浏览器会把 .txt 存进「文件」里，可再转发） */
  function downloadText(filename, text) {
    try {
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 0);
    } catch (e) {
      showToast("下载失败，请手动全选复制");
    }
  }

  /* ---- 纯文本对话框（导入 / 导出用） ----
     设置页此前没有这一件，随「我的清单」一起搬过来：
     结构与首页那一套完全一致（.modal.text-modal），样式也共用同一份 CSS。 */
  function textDialog(opts) {
    const box = $("#text-dialog");
    if (!box) return;
    $("#text-dialog-title").textContent = opts.title || "";
    $("#text-dialog-tip").textContent = opts.tip || "";
    const ta = $("#text-dialog-text");
    ta.value = opts.text || "";
    ta.readOnly = !!opts.readOnly;
    $("#text-dialog-ok").textContent = opts.okText || "确定";
    $("#text-dialog-ok").hidden = !!opts.hideOk;
    $("#text-dialog-cancel").textContent = opts.cancelText || "关闭";
    box.hidden = false;
    textDialog._onOk = opts.onOk || null;
    // 导出时全选，用户少按一次 —— 手机上「全选 → 复制」本就是两步
    if (opts.readOnly) {
      setTimeout(function () { ta.focus(); ta.select(); }, 30);
    }
  }

  function closeTextDialog() {
    const box = $("#text-dialog");
    if (box) box.hidden = true;
    textDialog._onOk = null;
  }

  /** 导出一个集合：先落一段文本，再让用户复制（也支持下载成 .txt） */
  function exportCollection(col) {
    const labels = {};
    col.items.forEach(function (it) {
      const id = typeof it === "string" ? it : it.id;
      if (id) labels[id] = collectionLabelOf(id);
    });
    const text = window.ReciteCollections.exportText(col.id, labels);
    textDialog({
      title: "导出「" + col.name + "」",
      tip: "全选复制即可发出去。对方打开跬步 → 设置 → 我的清单 → 导入，粘贴进来就是同一个清单。",
      text: text,
      readOnly: true,
      okText: "下载为文本",
      onOk: function () {
        downloadText("跬步-自选集合-" + col.name + ".txt", text);
        closeTextDialog();
        showToast("已导出 " + col.items.length + " 篇");
      }
    });
  }

  /** 导入：粘贴文本 → 新建一个集合 */
  function importCollection() {
    textDialog({
      title: "导入清单",
      tip: "把清单文本粘贴进来（一行一条，以 # 开头的是说明行，会跳过）。导入会新建一个集合，不动你已有的那几个。",
      text: "",
      okText: "导入",
      onOk: function () {
        const text = $("#text-dialog-text").value;
        if (!text.trim()) {
          showToast("还没有粘贴内容");
          return false;
        }
        const res = window.ReciteCollections.importText(text, "", window.SITE_INDEX || []);
        closeTextDialog();
        if (!res.added) {
          showToast("没认出清单里的篇目" + (res.dropped ? "（" + res.dropped + " 行对不上本站篇目）" : ""));
          return;
        }
        renderCollections();
        showToast("已导入 " + res.added + " 篇" +
          (res.dropped ? "，另有 " + res.dropped + " 行对不上本站篇目，已跳过" : ""));
      }
    });
  }

  /**
   * 画一遍「我的清单」。
   *
   * 集合里的每一篇：先查站点索引（本页加载了课内 + 站点索引），
   * 查不到就回落到加入时存下的**快照** —— 快照里带着题名 / 作者 / 朝代 / 集子名，
   * 足够把这一行画出来（正文要读的话，点进去由首页那套弹层按快照显示）。
   */
  function renderCollections() {
    const box = $("#collections-list");
    if (!box || !window.ReciteCollections) return;

    const cols = window.ReciteCollections.list();
    const total = window.ReciteCollections.count();

    const tip = $("#collections-tip");
    if (tip) {
      tip.textContent = total
        ? "下面这些篇目与课内古诗词一起按遗忘曲线复习。到课外集子或搜索页，点篇目右边的书签即可再加；↑↓ 可调顺序，一组的篇目可整卷移出。"
        : "还没有自选篇目。到「课外」任一集子或「搜索」页，点篇目右边的书签，就能把它加进来一起背。";
    }

    // 一个集合都没有时也留着「导入」—— 家长发来一串清单，
    // 第一件事就是导进来，不该先逼他建一个集合。
    const tools = $("#collections-tools");
    if (tools) tools.hidden = false;

    if (!cols.length) {
      box.innerHTML = '<div class="empty">还没有自选篇目</div>';
      return;
    }

    // 站点索引 + 快照两条取数路径（与首页那一套一致）
    const map = {};
    (window.SITE_INDEX || []).forEach(function (p) { map[p.id] = p; });
    (window.POEMS_ALL || []).forEach(function (p) { if (!map[p.id]) map[p.id] = p; });

    box.innerHTML = "";
    cols.forEach(function (col) {
      const head = document.createElement("div");
      head.className = "collection-head";
      head.innerHTML =
        '<span class="collection-name">' + esc(col.name) + "</span>" +
        '<span class="collection-count">' + col.items.length + " 篇</span>" +
        '<button type="button" class="collection-act" data-rename="' + esc(col.id) + '" title="重命名" aria-label="重命名 ' + esc(col.name) + '">改名</button>' +
        '<button type="button" class="collection-act" data-export="' + esc(col.id) + '" title="导出成文本，可发给别的家长" aria-label="导出集合 ' + esc(col.name) + '">导出</button>' +
        '<button type="button" class="collection-act danger" data-drop="' + esc(col.id) + '" title="删除集合" aria-label="删除集合 ' + esc(col.name) + '">删除</button>';
      box.appendChild(head);

      // 按组切段：同一部集子 / 同一个卷次文体连在一起，段头上给「整组移出」。
      // 分组只为「让用户一次拿掉一组」，不改变集合的顺序 ——
      // 顺序仍是 col.items 的顺序，用户自己排的。
      let lastGroup = null;
      col.items.forEach(function (it, index) {
        const entryId = typeof it === "string" ? it : it.id;
        const snap = (it && typeof it === "object" && it.snap) || {};
        const repId = window.ReciteCollections.poemIdFor(entryId);
        const p = map[repId] || map[entryId] || Object.assign({ id: repId }, snap);
        if (!p || !p.title) return;

        // 分组：先站点索引、后快照（与 groupInfoOf 同一条取数路径，
        // 「整组移出」按同一口径数篇数 —— 两边各算一遍迟早算出两个数）
        const group = groupInfoOf(it).group;
        if (group !== lastGroup) {
          lastGroup = group;
          const gh = document.createElement("div");
          gh.className = "collection-group";
          gh.innerHTML =
            '<span class="collection-group-name">' + esc(group) + "</span>" +
            '<button type="button" class="collection-group-drop" data-group="' + esc(group) + '" ' +
            'data-col="' + esc(col.id) + '" title="把这一组的篇目整组移出" ' +
            'aria-label="把 ' + esc(group) + ' 这一组整组移出">整组移出</button>';
          box.appendChild(gh);
        }

        const rec = getRecord(repId);
        const el = document.createElement("div");
        el.className = "item optional";
        el.innerHTML =
          '<div class="item-main">' +
          '<h3 class="item-title">' + esc(showTitle(p.title)) + "</h3>" +
          '<div class="item-meta">' +
          metaLine([esc(p.author || ""), esc(p.dynasty || ""), esc(p.bookName || ""),
            // 掌握度那一栏无条件跟着（空值也显示「未学过」），
            // 所以它不参与「空值即省分隔符」的排布，直接拼成一段尾巴
            rec && rec.learned ? levelName(rec) : "未学过"]) +
          "</div>" +
          (rec && rec.learned ? '<div class="mbar"><i style="width:' + mastery(rec) + '%"></i></div>' : "") +
          "</div>" +
          // 上移 / 下移：集合里只有它自己排的草稿顺序，没有卷次词牌可依，
          // 所以给的是两颗小箭头，而不是「按某某排序」
          '<button type="button" class="item-move" data-up="' + index + '" data-col="' + esc(col.id) + '"' +
          (index === 0 ? " disabled" : "") +
          ' title="上移一位" aria-label="把 ' + esc(showTitle(p.title)) + ' 上移一位">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6.6 14.2 12 8.8l5.4 5.4"/></svg>' +
          "</button>" +
          '<button type="button" class="item-move" data-down="' + index + '" data-col="' + esc(col.id) + '"' +
          (index === col.items.length - 1 ? " disabled" : "") +
          ' title="下移一位" aria-label="把 ' + esc(showTitle(p.title)) + ' 下移一位">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6.6 9.8 12 15.2l5.4-5.4"/></svg>' +
          "</button>" +
          '<button type="button" class="item-remove" title="移出背诵" aria-label="把 ' + esc(showTitle(p.title)) + ' 移出背诵">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M7 12h10"/></svg>' +
          "</button>";
        const rm = el.querySelector(".item-remove");
        rm.addEventListener("click", function (e) {
          e.stopPropagation();
          window.ReciteCollections.removeItem(entryId, col.id);
          renderCollections();
          showToast("已移出「" + col.name + "」");
        });
        box.appendChild(el);
      });
    });
  }

  /** 「我的清单」那一组的事件（与首页那一套逐条对应） */
  function bindCollections() {
    const importBtn = $("#btn-collections-import");
    if (importBtn) importBtn.addEventListener("click", importCollection);

    const tdOk = $("#text-dialog-ok");
    if (tdOk) {
      tdOk.addEventListener("click", function () {
        const fn = textDialog._onOk;
        if (typeof fn === "function") {
          if (fn() === false) return;   // 回调里校验不过就留着对话框
        }
        closeTextDialog();
      });
    }
    const tdCancel = $("#text-dialog-cancel");
    if (tdCancel) tdCancel.addEventListener("click", closeTextDialog);
    const tdMask = $("#text-dialog .modal-mask");
    if (tdMask) tdMask.addEventListener("click", closeTextDialog);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeTextDialog();
    });

    const colBox = $("#collections-list");
    if (!colBox) return;
    colBox.addEventListener("click", function (e) {
      // 整组移出挂在分组行上（不在条目里），单独先认一遍
      const gbtn = e.target.closest ? e.target.closest("[data-group]") : null;
      if (gbtn && window.ReciteCollections) {
        e.stopPropagation();
        const col = window.ReciteCollections.get(gbtn.getAttribute("data-col"));
        if (!col) return;
        const group = gbtn.getAttribute("data-group");
        // 与列表上的分组走**同一条取数路径**（先索引、后快照），
        // 否则「整组移出」数的篇数与用户看到的那一组对不上
        const n = col.items.filter(function (it) { return groupInfoOf(it).group === group; }).length;
        if (!n) return;
        if (!window.confirm("把「" + group + "」这一组的 " + n + " 篇整组移出「" + col.name + "」？")) return;
        const removed = window.ReciteCollections.removeGroup(col.id, group, collectionGroupOf);
        renderCollections();
        showToast("已整组移出 " + removed + " 篇");
        return;
      }
      // 上移 / 下移：就地换两位，刷新列表让顺序当场可见
      const mv = e.target.closest ? e.target.closest("[data-up], [data-down]") : null;
      if (mv && window.ReciteCollections && !mv.disabled) {
        e.stopPropagation();
        const cid = mv.getAttribute("data-col");
        const up = mv.getAttribute("data-up");
        const moved = up !== null
          ? window.ReciteCollections.moveUp(cid, Number(up))
          : window.ReciteCollections.moveDown(cid, Number(mv.getAttribute("data-down")));
        if (moved) renderCollections();
        return;
      }
      const t = e.target.closest ? e.target.closest("[data-rename], [data-drop], [data-export]") : null;
      if (!t || !window.ReciteCollections) return;
      e.stopPropagation();
      const rid = t.getAttribute("data-rename");
      const did = t.getAttribute("data-drop");
      const eid = t.getAttribute("data-export");
      if (eid) {
        const col = window.ReciteCollections.get(eid);
        if (!col) return;
        exportCollection(col);
      } else if (rid) {
        const col = window.ReciteCollections.get(rid);
        if (!col) return;
        const name = window.prompt("给这个集合改个名字（最多 12 字）", col.name);
        if (name === null) return;
        window.ReciteCollections.rename(rid, name);
        renderCollections();
        showToast("已改名为「" + window.ReciteCollections.get(rid).name + "」");
      } else if (did) {
        const col = window.ReciteCollections.get(did);
        if (!col) return;
        if (!window.confirm("删除集合「" + col.name + "」？它里面的 " + col.items.length + " 篇也会一并移出背诵。")) return;
        window.ReciteCollections.remove(did);
        renderCollections();
        showToast("已删除「" + col.name + "」");
      }
    });

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

  /* ---------------- 头像印记（Issue #132 · 2026-09-15） ----------------
     字符印：从**固定字集**挑一个字 + 固定四色，全部存本机 `poem_profile_v1`。
     不弹文件选择框、不上传图片 —— `/privacy/` 的「不收集」承诺因此不受影响。
     尺寸、圆角、字族在 css/style.css 的 .seal-avatar；**画印只有 js/avatar.js 一处**，
     本页不许自己拼一份渐变（test/avatar.test.js 有源码扫描守着）。
     ------------------------------------------------------------------ */

  /** 取 Avatar 模块（脚本顺序不对 / 老缓存时返回 null，宁可不画也不报错） */
  function avatarMod() {
    return window.Avatar || null;
  }

  /** 重画设置页那枚印（昵称变了、字/色改了都要重画） */
  function renderAvatar() {
    const A = avatarMod();
    const slot = $("#avatar-slot");
    if (!A || !slot) return;
    let html = "";
    try { html = A.html(window.localStorage, { size: 40 }); } catch (e) { html = ""; }
    slot.innerHTML = html;
    if (html) slot.removeAttribute("aria-hidden");   // 有内容就给读屏软件读
    else slot.setAttribute("aria-hidden", "true");
    renderSealPicker();
  }

  /** 画字集 / 印色选择器，并把当前选择标出来 */
  function renderSealPicker() {
    const A = avatarMod();
    const charBox = $("#seal-chars");
    const inkBox = $("#seal-inks");
    const hint = $("#seal-hint");
    if (!A || !charBox || !inkBox) return;
    const cur = A.display(window.localStorage);

    // 字：一排常用字，不弹键盘（固定集合 → 杜绝生僻字与真名）
    charBox.innerHTML = "";
    A.CHARS.forEach(function (c) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "seal-chip" + (c === cur.char && cur.source === "chosen" ? " active" : "");
      b.dataset.sealChar = c;
      b.textContent = c;
      b.setAttribute("aria-label", "用「" + c + "」字");
      charBox.appendChild(b);
    });

    // 色：四个传统色圆点
    inkBox.innerHTML = "";
    A.INK_KEYS.forEach(function (k) {
      const info = A.INKS[k];
      const b = document.createElement("button");
      b.type = "button";
      b.className = "seal-ink" + (k === cur.ink ? " active" : "");
      b.dataset.sealInk = k;
      b.style.background = info.bg;
      b.setAttribute("aria-label", "印色：" + info.name);
      b.title = info.name;
      inkBox.appendChild(b);
    });

    // 如实写清这枚印是怎么来的 + 它存在哪里（合规口径，别让用户以为传上去了）
    if (hint) {
      const from = cur.source === "chosen" ? "你选的字"
        : (cur.source === "nickname" ? "取自昵称首字" : "默认字");
      hint.textContent = "当前：" + cur.char + "字 · " + A.INKS[cur.ink].name +
        "（" + from + "）。印记只存在本机，不上传。";
    }
  }

  /* ---------------- 本机账号（Issue #132 · 二级页「通用」） ----------------
     本期没有服务端：账号记录（`poem_auth_v1`）与学习进度一样只存在本机，
     `/privacy/` 里那句「不上传、不云同步」仍然成立。
     这一块只做**只读展示 + 退出**：
       · 层级徽章与「当前权限」清单读 js/entitlement.js（全站唯一判据），
         本页不自己拼 plan / tier（有源码扫描守着）；
       · 「退出」只清会话，绝不碰任何进度数据（AuthCore.signOut 的口径）；
       · 注销账号要求重输一次邮箱 —— 但那一步依赖 `/profile/`（还没建），
         所以这里只给退出，并如实写明「注销在 /profile/ 里做」，不假装有。
     ------------------------------------------------------------------ */

  /** 取 AuthCore / Entitlement（脚本顺序不对或老缓存时返回 null，宁可不画也不报错） */
  function authMod() {
    return window.AuthCore || null;
  }
  function entitlementMod() {
    return window.Entitlement || null;
  }

  /** 当前身份（会话 + 本机名单合成）：页面上只准用它，不自己拼 ctx */
  function currentIdentity() {
    const E = entitlementMod();
    if (!E) return null;
    try {
      return E.identity({ backing: window.localStorage });
    } catch (e) {
      return null;
    }
  }

  /** 画「账号」这一项：已登录 / 未登录两种形态，文案如实 */
  function renderAccount() {
    const box = $("#account-panel");
    if (!box) return;
    const A = authMod();
    const E = entitlementMod();
    const ident = currentIdentity();

    if (!A || !E || !ident) {
      box.innerHTML = '<p class="settings-hint">账号信息加载失败：请刷新页面重试。</p>';
      return;
    }

    const badge = '<span class="tier-badge tier-' + ident.tier + '" id="account-tier">' +
      E.tierLabel(ident.tier) + "</span>";

    if (!ident.signedIn) {
      box.innerHTML =
        '<p class="account-line"><span class="account-state" id="account-state">未登录</span>' +
        "（游客）" + badge + "</p>" +
        '<p class="settings-hint">不登录也能用全部功能；账号只影响「语音朗读」与将来的同步。' +
        "登录入口在 <code>/login/</code>，还没建（见 docs/auth-design.md §11）。</p>" +
        '<p class="settings-hint">本机账号与学习进度一样<strong>只存在本机</strong>，不上传、不云同步。</p>';
      return;
    }

    const rows = E.matrix(ident).map(function (m) {
      const mark = m.ok ? "✓" : "·";
      const tail = m.ok ? (m.hint ? "（" + m.hint + "）" : "") : "（" + m.hint + "）";
      return '<li class="account-cap' + (m.ok ? " ok" : " off") + '">' +
        '<span class="cap-mark" aria-hidden="true">' + mark + "</span>" +
        '<span class="cap-name">' + m.name + "</span>" +
        '<span class="cap-hint">' + tail + "</span></li>";
    }).join("");

    box.innerHTML =
      '<p class="account-line"><span class="account-state ok" id="account-state">已登录</span>' +
      '<span class="account-mask" id="account-mask">' + (ident.mask || "本机账号") + "</span>" + badge + "</p>" +
      '<ul class="account-caps" id="account-caps">' + rows + "</ul>" +
      '<div class="settings-btns"><button class="btn ghost-btn" id="btn-signout" type="button">退出登录</button></div>' +
      '<p class="settings-hint">退出只结束这次登录，不会删掉任何背诵进度。' +
      "本机账号与进度一样只存在本机，不上传、不云同步；注销账号在个人中心（/profile/）里做。</p>";
  }

  /** 「退出登录」：只清会话，不碰进度 */
  function bindAccount() {
    const btn = $("#btn-signout");
    if (!btn) return;
    btn.addEventListener("click", function () {
      if (!window.confirm("退出登录？背诵进度不会受影响。")) return;
      const A = authMod();
      try {
        if (A && A.makeStore) A.signOut(A.makeStore(window.localStorage));
      } catch (e) { /* 存储不可用：至少把界面还原成未登录 */ }
      renderAccount();
      showToast("已退出登录，进度都还在这台设备上");
    });
  }

  /** 换字 / 换色 / 还原默认：写 `poem_profile_v1`，再让顶栏重画 */
  function applySeal(patch) {
    const A = avatarMod();
    if (!A) return;
    const r = patch && patch.reset
      ? A.resetAvatar(window.localStorage)
      : A.setAvatar(window.localStorage, patch);
    if (!r || !r.ok) {
      showToast((r && r.message) || "这个值不在可选范围里");
      return;
    }
    renderAvatar();
    // 顶栏那枚印是 chrome.js 一次画好的，不重画就要刷新页面才看得到
    if (window.SiteChrome && window.SiteChrome.refreshUser) window.SiteChrome.refreshUser();
    showToast("头像印记已更新");
  }

  function bindSealPicker() {
    const charBox = $("#seal-chars");
    if (charBox) {
      charBox.addEventListener("click", function (e) {
        const b = e.target.closest("button[data-seal-char]");
        if (!b) return;
        applySeal({ char: b.dataset.sealChar });
      });
    }
    const inkBox = $("#seal-inks");
    if (inkBox) {
      inkBox.addEventListener("click", function (e) {
        const b = e.target.closest("button[data-seal-ink]");
        if (!b) return;
        applySeal({ ink: b.dataset.sealInk });
      });
    }
    const reset = $("#btn-seal-reset");
    if (reset) {
      reset.addEventListener("click", function () { applySeal({ reset: true }); });
    }
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
      // 昵称属账号域：除老键外还要镜像到 poem_profile_v1（头像与昵称同一份档案），
      // 收在 commitNickname 一处 —— 见 docs/auth-design.md §2.3.1
      const commit = function () {
        commitNickname(uInput.value);
        applyAppName();
      };
      uInput.addEventListener("input", function () {
        commitNickname(uInput.value);
        applyAppName();
      });
      uInput.addEventListener("change", function () {
        commit();
        uInput.value = settings.username;
      });
      // 改昵称 → 印要跟着重画（印的兜底是「昵称首字」，昵称变了印也变）
      uInput.addEventListener("input", function () { renderAvatar(); });
      uInput.addEventListener("change", function () { renderAvatar(); });
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
    bindCollections();
    bindSealPicker();
    bindAccount();
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
    // 自选集合在**别处**变了（集子页 / 搜索页点了「加入背诵」，或另一个标签页
    // 改了同一份键）时，这一页的清单跟着重画 —— 与首页监听同一个事件。
    // 本页自己那套增删改查是「先改数据、再 renderCollections()」，
    // 这里兜的是外部来源：不补这一条，别处加过一篇回到这一页就看不到。
    window.addEventListener("recite-collections-change", function () { renderCollections(); });
    window.addEventListener("storage", function (e) {
      if (window.ReciteCollections && e.key === window.ReciteCollections.KEY) renderCollections();
    });
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
