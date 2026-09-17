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
  const SETTINGS_KEY = "poem_recite_settings_v1";

  const PLAN_PREFIX = "poem_plan_";

  const DEFAULT_SCOPE = "upto";
  const KNOWN_SCOPES = ["term", "upto", "primary", "middle", "primary_middle", "high", "all"];

  const SCOPE_NAMES = {
    term: "本学期",
    upto: "本学期及之前",
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

    algo: "ebbinghaus"
  };

  let settings = null;

  function commitNickname(value) {
    const clean = String(value == null ? "" : value).trim().slice(0, 12);
    settings.username = clean;
    saveSettings();
    const A = window.Avatar;
    if (A && typeof A.saveNickname === "function") {

      try { A.saveNickname(window.localStorage, clean); } catch (e) {  }
    }
  }

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

    if (window.ProgressStore && typeof window.ProgressStore.helper === "function") {
      merged.helper = window.ProgressStore.helper();
    }
    if (KNOWN_SCOPES.indexOf(merged.scope) === -1) merged.scope = DEFAULT_SCOPE;

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

  function appTitle() {
    return APP_NAME + " · 设置";
  }

  function applyAppName() {
    document.title = appTitle() + " · " + APP_NAME;
    const meta = $('meta[name="apple-mobile-web-app-title"]');
    if (meta) meta.setAttribute("content", appTitle());
  }

  function invalidatePlan() {
    Object.keys(sessionStorage)
      .filter(function (k) {
        return k.indexOf(PLAN_PREFIX) === 0;
      })
      .forEach(function (k) {
        sessionStorage.removeItem(k);
      });
  }

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

    const scopeHint = $("#scope-hint");
    if (scopeHint) scopeHint.textContent = "当前：" + (SCOPE_NAMES[settings.scope] || SCOPE_NAMES[DEFAULT_SCOPE]);

    const uInput = $("#input-username");
    if (uInput) uInput.value = String(settings.username == null ? "" : settings.username);

    renderAvatar();
    renderFamily();
    renderAccount();
    renderSync();
    renderAlgos();
    renderPlayModes();
    renderCollections();
  }

  function exportMod() { return window.ExportCore || null; }

  function exportItems(scope) {
    const C = exportMod();
    const idx = window.SITE_INDEX || [];
    if (!C) return [];
    return C.order(C.pick(idx, scope), scope);
  }

  function exportPoems(asCopy) {
    const C = exportMod();
    const E = entitlementMod();
    const ident = currentIdentity();
    if (!C || !E || !ident) { showToast("导出组件没有加载成功，请刷新页面重试"); return; }

    if (!E.can("export.all", ident).ok) { showToast(E.denyReason("export.all", ident)); return; }

    const items = exportItems("poems");
    if (!items.length) { showToast("课内诗词数据没加载出来，请刷新页面重试"); return; }

    const r = C.build({ items: items, scope: "poems", now: new Date() });

    const skip = r.skipped ? "（另有 " + r.skipped + " 首没有正文，没有写进去）" : "";

    if (asCopy) {
      textDialog({
        title: "课内诗词（" + r.count + " 首）",
        tip: "全选复制即可粘进任何文档；也可以点下面的按钮存成文本文件。" + skip,
        text: r.text,
        readOnly: true,
        okText: "下载为文本",
        onOk: function () {
          downloadText(C.fileName("poems", new Date()), r.text);
          closeTextDialog();
          showToast("已导出 " + r.count + " 首" + skip);
        }
      });
      return;
    }
    downloadText(C.fileName("poems", new Date()), r.text);
    showToast("已导出 " + r.count + " 首" + skip);
  }

  function showTitle(title) {
    if (window.ReciteCollections && window.ReciteCollections.displayTitle) {
      return window.ReciteCollections.displayTitle(title);
    }
    return title;
  }

  function poemForEntry(entryId) {
    const repId = window.ReciteCollections.poemIdFor(entryId);
    const idx = window.SITE_INDEX || [];
    return idx.filter(function (x) { return x.id === entryId || x.id === repId; })[0] || null;
  }

  function collectionLabelOf(entryId) {
    const p = poemForEntry(entryId);
    if (!p) return entryId;
    const bits = [p.bookName || p.source || "", p.gradeGroup || "", showTitle(p.title)];
    return bits.filter(Boolean).join(" · ") || entryId;
  }

  function groupInfoOf(item) {
    const entryId = typeof item === "string" ? item : item.id;
    const snap = (item && typeof item === "object" && item.snap) || {};
    const p = poemForEntry(entryId) || snap;
    const book = p.bookName || p.source || "";
    const group = book ? (p.gradeGroup ? book + " · " + p.gradeGroup : book) : "未分组";
    return { id: entryId, group: group };
  }

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

    if (opts.readOnly) {
      setTimeout(function () { ta.focus(); ta.select(); }, 30);
    }
  }

  function closeTextDialog() {
    const box = $("#text-dialog");
    if (box) box.hidden = true;
    textDialog._onOk = null;
  }

  function exportCollection(col) {
    const labels = {};
    col.items.forEach(function (it) {
      const id = typeof it === "string" ? it : it.id;
      if (id) labels[id] = collectionLabelOf(id);
    });
    const text = window.ReciteCollections.exportText(col.id, labels);
    textDialog({
      title: "导出「" + col.name + "」",
      tip: "全选复制即可发出去；对方在同一页导入。",
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

  function importCollection() {
    textDialog({
      title: "导入清单",
      tip: "一行一条，# 开头的是说明行，会跳过。导入会新建一个集合，不动已有的。",
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

        if (res.error === "E_LIMIT") {
          const lim = res.limit === Infinity ? "不限" : res.limit + " 个";
          showToast("自选清单已达上限（当前层级最多 " + lim + "）—— " +
            "Free 1 个、Pro 20 个、Max 不限。");
          return;
        }
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

  function renderCollections() {
    const box = $("#collections-list");
    if (!box || !window.ReciteCollections) return;

    const cols = window.ReciteCollections.list();
    const total = window.ReciteCollections.count();

    const tip = $("#collections-tip");
    if (tip) {
      tip.hidden = total > 0;
      if (!total) tip.textContent = "到任一集子页或搜索页点篇目右边的书签即可加进来。";
    }

    const tools = $("#collections-tools");
    if (tools) tools.hidden = false;

    if (!cols.length) {
      box.innerHTML = '<div class="empty">还没有自选篇目</div>';
      return;
    }

    const map = {};
    (window.SITE_INDEX || []).forEach(function (p) { map[p.id] = p; });
    (window.POEMS_ALL || []).forEach(function (p) { if (!map[p.id]) map[p.id] = p; });

    box.innerHTML = "";
    cols.forEach(function (col) {

      const card = document.createElement("div");
      card.className = "library-card collection-card";
      card.setAttribute("data-col", col.id);
      card.innerHTML =
        '<div class="collection-head">' +
        '<span class="collection-name">' + esc(col.name) + "</span>" +
        '<span class="collection-count">' + col.items.length + " 篇</span>" +
        '<button type="button" class="collection-act" data-rename="' + esc(col.id) + '" title="重命名" aria-label="重命名 ' + esc(col.name) + '">改名</button>' +
        '<button type="button" class="collection-act" data-export="' + esc(col.id) + '" title="导出成文本，可发给别的家长" aria-label="导出集合 ' + esc(col.name) + '">导出</button>' +

        '<button type="button" class="collection-act" data-print="' + esc(col.id) + '" title="把这份清单排成一页纸，打印或存成 PDF" aria-label="打印集合 ' + esc(col.name) + '">打印</button>' +
        '<button type="button" class="collection-act danger" data-drop="' + esc(col.id) + '" title="删除集合" aria-label="删除集合 ' + esc(col.name) + '">删除</button>' +
        "</div>" +
        '<div class="collection-body"></div>';
      const body = card.querySelector(".collection-body");
      box.appendChild(card);

      let lastGroup = null;
      col.items.forEach(function (it, index) {
        const entryId = typeof it === "string" ? it : it.id;
        const snap = (it && typeof it === "object" && it.snap) || {};
        const repId = window.ReciteCollections.poemIdFor(entryId);
        const p = map[repId] || map[entryId] || Object.assign({ id: repId }, snap);
        if (!p || !p.title) return;

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
          body.appendChild(gh);
        }

        const rec = getRecord(repId);
        const el = document.createElement("div");
        el.className = "item optional";
        el.innerHTML =
          '<div class="item-main">' +
          '<h3 class="item-title">' + esc(showTitle(p.title)) + "</h3>" +
          '<div class="item-meta">' +
          metaLine([esc(p.author || ""), esc(p.dynasty || ""), esc(p.bookName || ""),

            rec && rec.learned ? levelName(rec) : "未学过"]) +
          "</div>" +
          (rec && rec.learned ? '<div class="mbar"><i style="width:' + mastery(rec) + '%"></i></div>' : "") +
          "</div>" +

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
        body.appendChild(el);
      });
    });
  }

  function bindCollections() {
    const importBtn = $("#btn-collections-import");
    if (importBtn) importBtn.addEventListener("click", importCollection);

    const tdOk = $("#text-dialog-ok");
    if (tdOk) {
      tdOk.addEventListener("click", function () {
        const fn = textDialog._onOk;
        if (typeof fn === "function") {
          if (fn() === false) return;
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

      const gbtn = e.target.closest ? e.target.closest("[data-group]") : null;
      if (gbtn && window.ReciteCollections) {
        e.stopPropagation();
        const col = window.ReciteCollections.get(gbtn.getAttribute("data-col"));
        if (!col) return;
        const group = gbtn.getAttribute("data-group");

        const n = col.items.filter(function (it) { return groupInfoOf(it).group === group; }).length;
        if (!n) return;
        if (!window.confirm("把「" + group + "」这一组的 " + n + " 篇整组移出「" + col.name + "」？")) return;
        const removed = window.ReciteCollections.removeGroup(col.id, group, collectionGroupOf);
        renderCollections();
        showToast("已整组移出 " + removed + " 篇");
        return;
      }

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
      const t = e.target.closest ? e.target.closest("[data-rename], [data-drop], [data-export], [data-print]") : null;
      if (!t || !window.ReciteCollections) return;
      e.stopPropagation();
      const rid = t.getAttribute("data-rename");
      const did = t.getAttribute("data-drop");
      const eid = t.getAttribute("data-export");
      const pid = t.getAttribute("data-print");
      if (pid) {

        if (window.PrintPage) window.PrintPage.open({ collectionId: pid });
        return;
      }
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
        if (!window.confirm("删除集合「" + col.name + "」？里面的 " + col.items.length + " 篇也会移出背诵。")) return;
        window.ReciteCollections.remove(did);
        renderCollections();
        showToast("已删除「" + col.name + "」");
      }
    });

  }

  function algoModels() {
    return (typeof window !== "undefined" && window.ReviewModels) || null;
  }

  function renderAlgos() {
    const RM = algoModels();
    const box = $("#seg-algo");
    if (!box) return;
    if (!RM) {

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

      hint.textContent = "当前：" + m.name;
    }
    const iv = $("#algo-interval");
    if (iv) iv.textContent = intervalText(cur);
  }

  function intervalText(key) {
    if (key === "leitner") return "五个盒子：1 / 2 / 4 / 8 / 16 天";
    if (key === "sm2") return "1 → 3 → 7 天，之后每次乘简易度";
    if (key === "fsrs") return "按稳定天数算：越稳固间隔越长";

    return "当天 → 1 → 2 → 4 → 7 → 15 → 30 → 60 → 120 → 240 天";
  }

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

  function playModes() {
    return (typeof window !== "undefined" && window.PlayModes) || null;
  }

  function currentPlayMode() {
    const PM = playModes();
    if (!PM) return "";
    return PM.read();
  }

  function renderPlayModes() {
    const PM = playModes();
    const box = $("#seg-play");
    if (!box) return;
    if (!PM) {

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

  }

  function setPlayMode(id) {
    const PM = playModes();
    if (!PM || !PM.write(id)) return;
    PM.emit(id);
    renderPlayModes();
    const m = PM.of(id);
    if (m) showToast("连读方式已改为「" + m.label + "」");
  }

  function familyMod() {
    return window.Family || null;
  }

  function renderFamily() {
    const box = $("#family-panel");
    const hint = $("#family-hint");
    if (!box) return;
    const F = familyMod();
    const AV = avatarMod();
    if (!F) { box.innerHTML = ""; if (hint) hint.textContent = ""; return; }

    const data = F.ensureDetailed({ backing: window.localStorage });
    const list = data.data.profiles;
    const at = data.data.at;
    const lim = F.limit({ backing: window.localStorage, E: entitlementMod() });
    const unlimited = lim === Infinity;

    box.innerHTML = "";
    list.forEach(function (p) {
      const row = document.createElement("div");
      row.className = "family-row" + (p.id === at ? " current" : "");
      row.dataset.familyId = p.id;
      const name = p.nickname || "未起名";
      row.innerHTML =
        '<button class="family-pick" type="button" data-family-pick="' + esc(p.id) + '"' +
        (p.id === at ? ' aria-current="true"' : "") + ">" +

        (AV ? AV.htmlFor(p, {}) : "") +
        '<span class="family-name">' + esc(name) + "</span>" +
        (p.id === at ? '<span class="family-now">当前</span>' : "") +
        "</button>" +
        '<span class="family-acts">' +
        '<button class="family-act" type="button" data-family-rename="' + esc(p.id) + '" ' +
        'aria-label="重命名">改名</button>' +
        (list.length > 1
          ? '<button class="family-act danger" type="button" data-family-remove="' + esc(p.id) +
            '" aria-label="删除">删除</button>'
          : "") +
        "</span>";
      box.appendChild(row);
    });

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "family-add";
    btn.id = "btn-family-add";
    btn.textContent = unlimited ? "再建一个" : "再建一个（还可建 " + F.remaining({ backing: window.localStorage, E: entitlementMod() }) + " 个）";
    box.appendChild(btn);

    if (hint) {
      hint.textContent = unlimited
        ? "当前 " + list.length + " 个"
        : "当前 " + list.length + " / " + lim + " 个";
    }
  }

  function switchFamily(id) {
    const F = familyMod();
    if (!F) return;
    const r = F.select(id, { backing: window.localStorage });
    if (!r.ok) { showToast("这个子用户已经不在名册里了"); return; }
    const p = F.current({ backing: window.localStorage });
    showToast("已切到「" + ((p && p.nickname) || "未起名") + "」");

    reloadAll();
  }

  function addFamily() {
    const F = familyMod();
    if (!F) return;
    const r = F.create("", { backing: window.localStorage, E: entitlementMod() });
    if (!r.ok) {

      if (r.code === "E_LIMIT") {
        const name = entitlementMod() && entitlementMod().CAPS["profile.family"]
          ? entitlementMod().CAPS["profile.family"].name : "家庭子用户";
        showToast("子用户已达上限（" + name + "）");
      } else {
        showToast("这一台设备上写不进去（隐私模式？）");
      }
      return;
    }

    F.select(r.profile.id, { backing: window.localStorage });
    renderFamily();
    showToast("建好了，顺手切了过来。给它起个名字。");
    const inp = $("#family-rename-input");
    if (inp) inp.focus();
  }

  function startRenameFamily(id) {
    const F = familyMod();
    if (!F) return;
    const row = document.querySelector('.family-row[data-family-id="' + id + '"]');
    if (!row) return;
    const p = F.list({ backing: window.localStorage }).filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    row.innerHTML =
      '<input class="family-rename" id="family-rename-input" type="text" maxlength="' +
      F.NAME_MAX + '" value="' + esc(p.nickname || "") + '" placeholder="Ashley" ' +
      'aria-label="子用户名称" enterkeyhint="done" />' +
      '<span class="family-acts"><button class="family-act" type="button" ' +
      'data-family-rename-cancel="1">取消</button></span>';
    const inp = $("#family-rename-input");
    if (!inp) return;
    inp.focus();
    inp.select();
    const commit = function () {
      const r = F.rename(id, inp.value, { backing: window.localStorage });
      if (r.ok) {
        renderFamily();

        const F2 = familyMod();
        const cur = F2.current({ backing: window.localStorage });
        if (cur && cur.id === id) {
          const u = $("#input-username");
          if (u) u.value = cur.nickname || "";
          renderAvatar();
        }
        showToast("名字改好了");
      } else {
        showToast("这个子用户已经不在名册里了");
        renderFamily();
      }
    };
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      if (e.key === "Escape") { e.preventDefault(); renderFamily(); }
    });
    inp.addEventListener("blur", function () { commit(); });
  }

  function removeFamily(id) {
    const F = familyMod();
    if (!F) return;
    const p = F.list({ backing: window.localStorage }).filter(function (x) { return x.id === id; })[0];
    const name = (p && p.nickname) || "未起名";
    if (!confirm("删除子用户「" + name + "」？\n\n名册里不再有它；它背过的进度数据仍留在本机（不会连带删除）。")) return;
    const r = F.remove(id, { backing: window.localStorage });
    if (!r.ok) {
      if (r.code === "E_LAST") showToast("至少要留一个子用户");
      else showToast("这个子用户已经不在名册里了");
      renderFamily();
      return;
    }
    showToast("已从名册里删掉「" + name + "」");

    reloadAll();
  }

  function reloadAll() {
    renderControls();
    renderFamily();
    if (window.SiteChrome && window.SiteChrome.refreshUser) window.SiteChrome.refreshUser();
  }

  function bindFamily() {
    const box = $("#family-panel");
    if (!box) return;
    box.addEventListener("click", function (e) {
      const pick = e.target.closest("[data-family-pick]");
      if (pick) { switchFamily(pick.dataset.familyPick); return; }
      const rn = e.target.closest("[data-family-rename]");
      if (rn) { startRenameFamily(rn.dataset.familyRename); return; }
      if (e.target.closest("[data-family-rename-cancel]")) { renderFamily(); return; }
      const rm = e.target.closest("[data-family-remove]");
      if (rm) { removeFamily(rm.dataset.familyRemove); return; }
      if (e.target.closest("#btn-family-add")) { addFamily(); return; }
    });
  }

  function avatarMod() { return window.Avatar || null; }
  function avatarImageMod() { return window.AvatarImage || null; }
  function accountApiMod() { return window.AccountApi || null; }

  var crop = { file: null, url: "", w: 0, h: 0, zoom: 1, ox: 0.5, oy: 0.5, drag: null };

  function renderAvatar() {
    const A = avatarMod();
    const slot = $("#avatar-slot");
    if (!A || !slot) return;
    let html = "";
    try { html = A.html(window.localStorage, { size: 44 }); } catch (e) { html = ""; }
    slot.innerHTML = html;
    if (html) slot.removeAttribute("aria-hidden");
    else slot.setAttribute("aria-hidden", "true");

    const d = (function () { try { return A.display(window.localStorage); } catch (e) { return null; } })();
    const clear = $("#btn-avatar-clear");
    if (clear) clear.hidden = !(d && d.hasImage);
    renderAvatarHint(d);
  }

  function renderAvatarHint(d) {
    const hint = $("#avatar-hint");
    if (!hint || !d) return;
    if (!d.hasImage) hint.textContent = "";
    else if (d.img) hint.textContent = "已同步到服务器";
    else hint.textContent = "已存在本机，还没同步到服务器";
  }

  function onPickFile(input) {
    const AI = avatarImageMod();
    if (!AI) return;
    const file = input && input.files && input.files[0];
    if (!file) return;
    const chk = AI.checkFile(file);
    if (!chk.ok) { showToast(chk.message); input.value = ""; return; }

    AI.decode(file).then(function (src) {
      crop.file = file;
      crop.w = src.width || src.naturalWidth || 0;
      crop.h = src.height || src.naturalHeight || 0;
      crop.zoom = 1; crop.ox = 0.5; crop.oy = 0.5;

      crop.url = (window.URL && URL.createObjectURL) ? URL.createObjectURL(file) : "";
      AI.release(src);
      openCrop();
      input.value = "";
    }).catch(function () {
      showToast("这张图片打不开，请换一张");
      input.value = "";
    });
  }

  function openCrop() {
    const layer = $("#crop-layer");
    const img = $("#crop-img");
    if (!layer || !img) return;
    img.src = crop.url;
    const z = $("#crop-zoom");
    if (z) { z.value = "0"; z.disabled = false; }
    layer.hidden = false;
    document.body.classList.add("crop-open");
    drawCrop();
  }

  function closeCrop() {
    const layer = $("#crop-layer");
    if (layer) layer.hidden = true;
    document.body.classList.remove("crop-open");
    const img = $("#crop-img");
    if (img) img.removeAttribute("src");
    if (crop.url && window.URL && URL.revokeObjectURL) URL.revokeObjectURL(crop.url);
    crop.file = null; crop.url = ""; crop.drag = null;
  }

  function drawCrop() {
    const img = $("#crop-img");
    const box = $("#crop-box");
    if (!img || !box || !crop.w || !crop.h) return;
    const side = box.clientWidth || 260;

    const base = side / Math.min(crop.w, crop.h);
    const k = base * crop.zoom;
    const dispW = crop.w * k;
    const dispH = crop.h * k;

    let left = side / 2 - crop.ox * dispW;
    let top = side / 2 - crop.oy * dispH;
    left = Math.min(0, Math.max(side - dispW, left));
    top = Math.min(0, Math.max(side - dispH, top));
    img.style.width = dispW + "px";
    img.style.height = dispH + "px";
    img.style.transform = "translate(" + left + "px," + top + "px)";
  }

  function onCropDrag(dx, dy) {
    const box = $("#crop-box");
    if (!box || !crop.w || !crop.h) return;
    const side = box.clientWidth || 260;
    const base = side / Math.min(crop.w, crop.h);
    const k = base * crop.zoom;
    const dispW = crop.w * k;
    const dispH = crop.h * k;
    crop.ox -= dx / dispW;
    crop.oy -= dy / dispH;
    const AI = avatarImageMod();
    if (AI && AI.clampOffset) {
      const c = AI.clampOffset(crop.w, crop.h, crop.zoom, crop.ox, crop.oy);
      crop.ox = c.ox; crop.oy = c.oy;
    } else {
      crop.ox = Math.min(1, Math.max(0, crop.ox));
      crop.oy = Math.min(1, Math.max(0, crop.oy));
    }
    drawCrop();
  }

  function setZoomFromSlider(v) {
    const AI = avatarImageMod();
    if (!AI) return;
    const r = AI.zoomRange(crop.w, crop.h);
    const t = Math.min(1, Math.max(0, Number(v) || 0));

    crop.zoom = r.min * Math.pow(r.max / r.min, t);
    const c = AI.clampOffset(crop.w, crop.h, crop.zoom, crop.ox, crop.oy);
    crop.ox = c.ox; crop.oy = c.oy;
    drawCrop();
  }

  function confirmCrop() {
    const AI = avatarImageMod();
    const A = avatarMod();
    const btn = $("#btn-crop-ok");
    if (!AI || !A || !crop.file) return;
    if (btn) { btn.disabled = true; btn.textContent = "处理中…"; }
    const view = { zoom: crop.zoom, ox: crop.ox, oy: crop.oy };
    AI.process(crop.file, view).then(function (blob) {
      return AI.blobToDataUrl(blob).then(function (dataUrl) {
        return { blob: blob, dataUrl: dataUrl };
      });
    }).then(function (out) {

      A.setLocalImage(window.localStorage, out.dataUrl);
      closeCrop();
      renderAvatar();
      refreshUserChrome();
      return uploadAvatar(out.blob);
    }).then(function () {
      if (btn) { btn.disabled = false; btn.textContent = "用这张"; }
    }).catch(function () {
      if (btn) { btn.disabled = false; btn.textContent = "用这张"; }
      showToast("这张图片处理不了，请换一张");
    });
  }

  function uploadAvatar(blob) {
    const Api = accountApiMod();
    if (!Api || !Api.uploadAvatar) return Promise.resolve(false);
    return Api.uploadAvatar({ blob: blob, type: blob.type }).then(function (r) {
      renderAvatar();
      if (r && r.ok) {
        refreshUserChrome();
        showToast("头像已保存");
        return true;
      }
      if (r && r.reason === "guest") showToast("头像已存在本机，登录后才会同步到其它设备");
      else if (r && r.reason === "not-configured") showToast("头像已存在本机（服务器还没开放）");
      else showToast((r && r.message) || "头像已存在本机，还没同步到服务器");
      return false;
    });
  }

  function clearAvatar() {
    const Api = accountApiMod();
    if (!confirm("删除头像？之后显示用户名首字。")) return;
    const done = function () { renderAvatar(); refreshUserChrome(); };
    if (!Api || !Api.deleteAvatar) {
      const A = avatarMod();
      if (A) A.resetAvatar(window.localStorage);
      done(); return;
    }
    Api.deleteAvatar().then(function (r) {
      done();
      if (r && r.remote === "skipped") showToast("本机头像已删除，服务器那份还没删掉");
      else showToast("头像已删除");
    });
  }

  function refreshUserChrome() {
    if (window.SiteChrome && window.SiteChrome.refreshUser) window.SiteChrome.refreshUser();
  }

  function bindCrop() {
    const layer = $("#crop-layer");
    const box = $("#crop-box");
    const zoom = $("#crop-zoom");
    if (!layer) return;
    if (zoom) zoom.addEventListener("input", function () { setZoomFromSlider(zoom.value); });
    const ok = $("#btn-crop-ok");
    if (ok) ok.addEventListener("click", confirmCrop);
    const cancel = $("#btn-crop-cancel");
    if (cancel) cancel.addEventListener("click", closeCrop);
    if (!box) return;

    var pointers = {};
    var pinchDist = 0;

    box.addEventListener("pointerdown", function (e) {
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (box.setPointerCapture) { try { box.setPointerCapture(e.pointerId); } catch (err) {  } }
      var n = Object.keys(pointers).length;
      if (n === 1) {
        crop.drag = { x: e.clientX, y: e.clientY };
      } else if (n === 2) {

        crop.drag = null;
        pinchDist = distOf(pointers);
      }
      e.preventDefault();
    });

    box.addEventListener("pointermove", function (e) {
      if (!pointers[e.pointerId]) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var n = Object.keys(pointers).length;
      if (n >= 2) {
        var d = distOf(pointers);
        if (pinchDist > 0 && d > 0) applyZoomFactor(d / pinchDist);
        pinchDist = d;
        return;
      }
      if (!crop.drag) return;
      var dx = e.clientX - crop.drag.x;
      var dy = e.clientY - crop.drag.y;
      crop.drag.x = e.clientX; crop.drag.y = e.clientY;
      onCropDrag(dx, dy);
    });

    var stop = function (e) {
      if (e && e.pointerId !== undefined) delete pointers[e.pointerId];
      if (Object.keys(pointers).length === 0) { crop.drag = null; pinchDist = 0; }
      else if (Object.keys(pointers).length === 1) {

        crop.drag = null;
        pinchDist = 0;
      }
    };
    box.addEventListener("pointerup", stop);
    box.addEventListener("pointercancel", stop);
    box.addEventListener("pointerleave", stop);

    box.addEventListener("wheel", function (e) {
      e.preventDefault();
      var step = e.shiftKey ? 0.24 : 0.12;
      applyZoomFactor(1 + (e.deltaY < 0 ? step : -step));
    }, { passive: false });
  }

  function distOf(pointers) {
    var keys = Object.keys(pointers);
    if (keys.length < 2) return 0;
    var a = pointers[keys[0]];
    var b = pointers[keys[1]];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function applyZoomFactor(f) {
    const AI = avatarImageMod();
    if (!AI || !crop.w) return;
    const r = AI.zoomRange(crop.w, crop.h);
    crop.zoom = AI.clampZoom(crop.w, crop.h, crop.zoom * f);
    const t = Math.log(crop.zoom / r.min) / Math.log(r.max / r.min || 1);
    const z = $("#crop-zoom");
    if (z) z.value = String(Math.min(1, Math.max(0, t)));
    const c = AI.clampOffset(crop.w, crop.h, crop.zoom, crop.ox, crop.oy);
    crop.ox = c.ox; crop.oy = c.oy;
    drawCrop();
  }

  function bindAvatar() {
    const pick = $("#btn-avatar-pick");
    const file = $("#avatar-file");
    if (pick && file) {
      pick.addEventListener("click", function () { file.click(); });
      file.addEventListener("change", function () { onPickFile(file); });
    }
    const clear = $("#btn-avatar-clear");
    if (clear) clear.addEventListener("click", clearAvatar);
    bindCrop();

    window.addEventListener("resize", function () {
      const layer = $("#crop-layer");
      if (layer && !layer.hidden) drawCrop();
    });
  }

  function authMod() {
    return window.AuthCore || null;
  }
  function entitlementMod() {
    return window.Entitlement || null;
  }

  function currentIdentity() {
    const E = entitlementMod();
    if (!E) return null;
    try {
      return E.identity({ backing: window.localStorage });
    } catch (e) {
      return null;
    }
  }

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
        '<p class="account-line"><span class="account-state" id="account-state">游客</span>' +
        badge + "</p>" +
        '<div class="settings-btns"><a class="btn ghost-btn" id="btn-gologin" href="/login/">用邮箱登录</a></div>';
      return;
    }

    const lacks = E.matrix(ident).filter(function (m) { return !m.ok; });
    const rows = lacks.length
      ? '<p class="settings-hint">还差：' + lacks.map(function (m) {
          return esc(m.name + "（" + m.hint + "）");
        }).join("、") + '</p>'
      : '<p class="settings-hint">全部功能都能用。</p>';

    box.innerHTML =
      '<p class="account-line"><span class="account-state ok" id="account-state">已登录</span>' +
      '<span class="account-mask" id="account-mask">' + (ident.mask || "本机账号") + "</span>" + badge + "</p>" +
      rows +
      '<div class="settings-btns">' +
      '<a class="btn ghost-btn" id="btn-goprofile" href="/profile/">个人中心</a>' +
      '<button class="btn ghost-btn" id="btn-signout" type="button">退出登录</button></div>' +
      '<p class="settings-hint">退出不删进度；注销在个人中心。</p>' +

      '<p class="settings-hint" id="account-tier-src">层级来源：' +
      esc(ident.tierSource === "server" ? "服务器" : "本机登记") + "</p>";
  }

  function bindAccount() {
    const btn = $("#btn-signout");
    if (!btn) return;
    btn.addEventListener("click", function () {
      if (!window.confirm("退出登录？进度不受影响。")) return;
      const A = authMod();
      const S = syncMod();
      try {
        if (A && A.makeStore) A.signOut(A.makeStore(window.localStorage));
      } catch (e) {  }

      try { if (S) S.forget(); } catch (e) {  }

      try {
        const M = window.AccountApi;
        if (M && M.clearServerTier) M.clearServerTier({ backing: window.localStorage, E: entitlementMod() });
      } catch (e) {  }
      renderAccount();
      renderSync();
      showToast("已退出登录，进度都还在这台设备上");
    });
  }

  function syncMod() { return window.SyncStore || null; }

  function renderSync() {
    const input = $("#toggle-sync");
    const hint = $("#sync-hint");
    if (!input || !hint) return;
    const S = syncMod();
    if (!S) {
      input.disabled = true;
      hint.textContent = "同步层没有加载成功，请刷新页面重试（背诵不受影响）。";
      return;
    }
    const st = S.status();
    const on = S.enabled();
    input.checked = on;
    input.disabled = (st === "unavailable");

    if (st === "unavailable") {
      hint.textContent = "本站未开放同步，进度只存本机。";
      return;
    }
    if (st === "tier") {
      hint.textContent = "跨设备云同步要 Pro 起（当前没到这一层）。进度仍在本机、一字不少。";
      return;
    }

    if (!on) {
      hint.textContent = "";
      return;
    }
    if (st === "signin") {
      hint.textContent = "已开启，登录后才会真的同步。";
      return;
    }
    hint.textContent = "开启中：进度与账号设置会同步；本机那份始终完整，断网照常背。";
  }

  function bindSync() {
    const input = $("#toggle-sync");
    if (!input) return;
    input.addEventListener("change", function () {
      const S = syncMod();
      if (!S) return;
      const r = S.setEnabled(input.checked);
      if (!r || !r.ok) {
        input.checked = !!S.enabled();

        if (r && r.code === "E_TIER") showToast(r.hint || "跨设备云同步要 Pro 起");
        else showToast("浏览器不允许保存设置，这次改动没生效");
        renderSync();
        return;
      }
      renderSync();
      renderAccount();
      if (input.checked) {

        try {
          const first = S.firstSync();
          if (first && first.then) first.then(function () { renderSync(); }, function () {  });
        } catch (e) {  }
        showToast(S.status() === "signin" ? "已开启，登录后才会真的同步" : "已开启跨设备同步");
      } else {
        showToast("已关闭同步，进度仍在本机");
      }
    });
  }

  function bindEvents() {
    $$("#seg-stage button").forEach(function (b) {
      b.addEventListener("click", function () {
        const stage = b.dataset.stage;
        const grades = STAGES[stage] ? STAGES[stage].grades : null;
        if (!grades) return;

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
        showToast(settings.helper === "on" ? "自动注音已开启：打开诗词自动注音" : "自动注音已关闭：打开诗词为纯文本");
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

    const poemsBtn = $("#btn-export-poems");
    if (poemsBtn) {
      poemsBtn.addEventListener("click", function (e) {
        exportPoems(!!e.shiftKey);
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

  function refreshServerIdentity() {
    const M = window.AccountApi;
    const box = $("#account-panel");
    if (!M || !M.refreshMe || !box) return;
    Promise.resolve(M.refreshMe({
      backing: window.localStorage,
      A: authMod(),
      E: entitlementMod()
    })).then(function (r) {
      if (!r || !r.ok) return;
      renderAccount();
    })["catch"](function () {  });
  }

  function init() {
    settings = loadSettings();
    applyAppName();
    renderControls();
    bindEvents();
    bindCollections();
    bindAvatar();
    bindFamily();
    bindAccount();
    bindSync();
    refreshServerIdentity();

    window.addEventListener("storage", function (e) {
      const PM = playModes();
      if (!PM || e.key !== PM.KEY) return;
      renderPlayModes();
    });
    if (window.PlayModes && window.PlayModes.subscribe) {
      window.PlayModes.subscribe(function () { renderPlayModes(); });
    }

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
