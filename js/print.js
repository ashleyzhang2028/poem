/**
 * 篇目 PDF / 打印页
 * ==========================================================================
 * 「把我挑的这几十篇排成一页纸，打出来。」—— 这一层只干这一件事。
 *
 * ## 它长在哪儿、为什么长在这儿
 *
 * 入口在 `/settings/lists/`（我的清单）—— **就在自选清单下面**，
 * 因为要打印的正是这份清单。第二入口在 `/poems/` 的详情页工具条上：
 * 「这一篇打出来」。
 *
 * 为什么不新开一页 `/print/`：底部四个页签已经满了（背诵 / 课外 / 搜索 / 设置），
 * 而这一件事**没有自己的状态** —— 它用的就是「哪一份清单」
 * （自选清单 / 当前这一篇）。单开一页等于让用户在两个页面之间来回搬东西。
 * 所以它与「古诗词大会」同一条路子：**就地叠层**，地址栏不动，
 * 返回键一层退一层（见 js/game.js 的文件头）。
 *
 * ## 三条口径
 *
 * 1. **页数说得出来，而且只用一份数字** —— 版面的全部参数在
 *    `js/print-core.js`（纯逻辑、可断言）。页面上写的是「**约** N 张」，
 *    不是「正好 N 张」：真正的字形宽度只有渲染时才知道，
 *    不同设备的中文字体差得很远。去掉「约」就是一句早晚会变假的话。
 *
 * 2. **打的是原文，一个标点都不改** —— 不重排、不转写、不加注音以外的任何东西。
 *    只有两种行会被合并：空行、只有标点的行（数据里的换行留下的）。
 *    拼音与译文是**开关**：关掉它们，纸面上就真的没有那几行
 *    （页数跟着变，所以「约几张」当场就要跟着重算）。
 *
 * 3. **打不出来的东西如实说** —— 没有正文的篇目不排进这一份，
 *    并在界面上写明「另有 N 篇没有正文」。悄悄少一篇比多打一张纸更难发现。
 *
 * ## 与层级的关系（Pro）
 *
 * 能力键是 `export.paper`（Pro）。**入口照旧看得见**：未登录 / 层级不够时
 * 点进来是一张如实说明「这一项要 Pro、怎么才能拿到」的卡 ——
 * 与「古诗词大会」同一套写法。判据一律走 `Entitlement.can()`，
 * 这一层不自己比 tier（有源码扫描守着）。
 */
(function () {
  "use strict";

  var Ent = window.Entitlement;
  var PC = window.PrintCore;

  var CAP = "export.paper";

  var state = {
    open: false,
    scope: "collection",   // collection（这一份清单）| poem（就这一篇）
    collectionId: "",
    poemId: "",
    paper: "a4",
    pinyin: true,
    translation: false,
    blank: false,
    blankLines: 3
  };

  var host = null;      // 挂载点
  var entryUrl = null;  // 叠层之前的地址（关掉时还原滚动位置用）

  function $(sel, base) { return (base || host || document).querySelector(sel); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function backing() {
    try { return window.localStorage; } catch (e) { return null; }
  }

  function identifier() {
    if (!Ent || !Ent.identity) return null;
    try { return Ent.identity({ backing: backing() }); } catch (e) { return null; }
  }

  /** 能不能开 —— **全站唯一那个出口**，本页不自己比 tier */
  function allowed(id) {
    if (!Ent) return { ok: false };
    return Ent.can(CAP, { tier: (id && id.tier) || "free", signedIn: !!(id && id.signedIn) });
  }

  /* ------------------------------------------------------------ 取篇目 */

  /**
   * 站点索引 —— 与首页 / 集子页同一份（`data/site-index.js`）。
   * 索引里的条目**不带正文**（正文在主表里），所以还要走 `masterTextOf`。
   */
  function index() { return window.SITE_INDEX || []; }

  function byId(id) {
    var list = index();
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  /**
   * 给一条索引条目补上正文 —— **走全站同一份主表**（`data/text-master.js`）。
   *
   * ⚠️ 正文只在主表里有一份（docs §2.4：各集子条目只存 `textRef`）。
   *    所以这里不读 `p.text`（那是快照，可能是旧版），一律走 `masterTextOf()`
   *    —— 「排版用的正文」与「阅读器里读的正文」必须是同一份，
   *    否则打印出来的与屏幕上读到的会出现两个版本。
   */
  function withText(p) {
    if (!p) return null;
    if (typeof window.masterTextOf === "function") {
      var full = window.masterTextOf(p) || {};
      return {
        id: full.id || p.id,
        title: full.title || p.title || "",
        author: full.author || p.author || "",
        dynasty: full.dynasty || p.dynasty || "",
        gradeGroup: full.gradeGroup || p.gradeGroup || "",
        selection: full.selection || p.selection || "",
        book: full.book || p.book || "",
        source: full.source || p.source || "",
        text: full.text || p.text || "",
        translation: full.translation || p.translation || "",
        pinyin: full.pinyin || p.pinyin || ""
      };
    }
    return p;
  }

  /**
   * 这一份要打的篇目。
   *
   * `collection` 走自选清单的**作品去重**口径（`allEntries()`）——
   * 与每日任务同一份，所以「打出来的就是我在背的那些」。
   * 清单里查不到正文的条目（站点索引里没有）**照旧排**，
   * 靠加入时存下的快照；快照里也没有正文的会被 `layout()` 报进 `empty`。
   */
  function poemsFor() {
    if (state.scope === "poem") {
      var one = withText(byId(state.poemId));
      return one ? [one] : [];
    }
    var C = window.ReciteCollections;
    if (!C) return [];
    var col = state.collectionId
      ? { items: (C.get(state.collectionId) || { items: [] }).items }
      : null;
    var items = col ? col.items : null;

    /* 没有指定集合时打**全部自选**（按作品去重，与每日任务一致） */
    if (!items) {
      return C.allEntries().map(function (e) {
        var p = withText(byId(e.entryId) || byId(e.wid));
        if (p) return p;
        var snap = e.snapshot || {};
        return {
          id: e.entryId, title: snap.title || "", author: snap.author || "",
          dynasty: snap.dynasty || "", source: snap.source || "",
          book: snap.book || "", gradeGroup: snap.gradeGroup || "",
          text: snap.text || "", translation: snap.translation || "", pinyin: ""
        };
      });
    }

    var seen = {};
    var out = [];
    items.forEach(function (it) {
      var id = typeof it === "string" ? it : (it && it.id) || "";
      if (!id) return;
      var wid = C.widOf ? C.widOf(id) : id;
      if (seen[wid]) return;
      seen[wid] = 1;
      var p = withText(byId(id) || byId(wid));
      if (p) { out.push(p); return; }
      var snap = (it && it.snap) || {};
      out.push({
        id: id, title: snap.title || "", author: snap.author || "",
        dynasty: snap.dynasty || "", source: snap.source || "",
        book: snap.book || "", gradeGroup: snap.gradeGroup || "",
        text: snap.text || "", translation: snap.translation || "", pinyin: ""
      });
    });
    return out;
  }

  /* -------------------------------------------------------------- 排版 */

  function layoutNow() {
    if (!PC) return null;
    return PC.layout(poemsFor(), {
      paper: state.paper,
      /* ⚠️ 拼音与译文的开关**按篇目手上有没有数据**再收一道：
         没有注音数据的篇目不会因为开关打开就凭空多出一行
         （`layout()` 自己判 `p.pinyin` 有没有，这里传的是用户的意愿）。 */
      pinyin: state.pinyin,
      translation: state.translation,
      blank: state.blank,
      blankLines: state.blankLines
    });
  }

  /* -------------------------------------------------------------- 渲染 */

  /** 要哪一层、怎么拿到 —— 与 /plans/ 那一页同口径，文案走 denyReason() */
  function gateCard(id) {
    var why = (Ent && Ent.denyReason)
      ? Ent.denyReason(CAP, { tier: id.tier, signedIn: id.signedIn })
      : "这一项要 Pro。";
    var html = '<section class="account-card print-gate">' +
      '<h2 class="account-card-title">篇目打印页</h2>' +
      '<p class="account-gate-why">' + esc(why) + "</p>";
    html += id.signedIn
      ? '<p class="account-hint">层级由管理员按邮箱掩码发放。四种身份的对照见 ' +
        '<a href="/plans/">四种身份对比</a>。</p>'
      : '<button class="account-btn" type="button" data-print-go="/login/">用邮箱建一个账号</button>';
    /* ⚠️ 不写「即将上线」—— 它就是**做完了**，只是要 Pro（2A 立的规矩） */
    html += "</section>";
    return html;
  }

  function render() {
    if (!host || !PC) return;
    var id = identifier() || { tier: "free", signedIn: false };

    if (!allowed(id).ok) {
      host.innerHTML = gateCard(id);
      bind();
      return;
    }

    var list = poemsFor();
    var lay = layoutNow();

    var html = '<section class="account-card">' +
      '<h2 class="account-card-title">篇目打印页</h2>' +
      '<p class="account-lead">选纸型与内容，然后点「打印 / 存 PDF」——' +
      "浏览器的打印对话框里选「另存为 PDF」就是 PDF。</p>" +
      '<p class="account-hint" id="print-summary">' + esc(PC.summary(lay)) + "</p>" +
      "</section>";

    /* 纸型与内容：三张纸 + 三个块开关 */
    html += '<section class="account-card"><h2 class="account-card-title">纸型</h2>' +
      '<div class="seg mini print-paper" id="print-paper" role="group" aria-label="纸型">' +
      PC.ORDER.map(function (k) {
        var p = PC.PAPER[k];
        return '<button type="button" data-print-paper="' + esc(k) + '"' +
          (state.paper === k ? ' class="active" aria-pressed="true"' : ' aria-pressed="false"') +
          ">" + esc(p.name) + "</button>";
      }).join("") + "</div>" +
      '<p class="account-hint">横向两栏更适合短篇；纵向一行一篇更适合长诗。</p>' +
      "</section>";

    html += '<section class="account-card"><h2 class="account-card-title">纸上放什么</h2>' +
      blockToggle("pinyin", "拼音行", "正文上面一行为注音，逐行对齐") +
      blockToggle("translation", "白话译文", "整篇之后另起一段（不是逐句对照）") +
      blockToggle("blank", "注释格线", "正文后面留几行空的，给自己写注释") +
      (state.blank
        ? '<div class="account-field print-blank-lines">' +
          '<label class="account-label" for="print-blank-lines">留几行</label>' +
          '<input class="account-input" id="print-blank-lines" type="number" min="0" max="12" ' +
          'step="1" value="' + esc(state.blankLines) + '" />' +
          "</div>"
        : "") +
      "</section>";

    /* 预览：**屏幕上看到的就是纸上那些内容**（同一份数据、同一个断行），
       但字号与换页是浏览器打印时才定的 —— 所以这里不假装是「所见即所得」 */
    html += '<section class="account-card"><h2 class="account-card-title">预览</h2>' +
      '<p class="account-hint">下面是纸上会有的字。字号与换页由浏览器打印时决定，' +
      "这里只保证内容一致。</p>" +
      '<div class="print-sheet">' + (lay && lay.blocks.length
        ? lay.blocks.map(renderBlock).join("")
        : '<p class="account-hint">这一份里还没有篇目。先去 <a href="/settings/lists/">我的清单</a> 加几篇。</p>') +
      "</div></section>";

    html += '<section class="account-card"><div class="print-actions">' +
      '<button class="account-btn" type="button" data-print-run="1">打印 / 存 PDF</button>' +
      "</div>" +
      '<p class="account-hint">打印对话框里若看不到边距设置，' +
      "默认就是本站排好的那一档。</p></section>";

    host.innerHTML = html;
    bind();
  }

  function blockToggle(key, name, desc) {
    return '<label class="print-opt">' +
      '<span class="print-opt-main">' +
      '<span class="print-opt-name">' + esc(name) + "</span>" +
      '<span class="print-opt-desc">' + esc(desc) + "</span>" +
      "</span>" +
      '<input type="checkbox" class="switch-input print-opt-box" data-print-toggle="' + esc(key) + '"' +
      (state[key] ? " checked" : "") + " />" +
      '<span class="switch-track" aria-hidden="true"></span>' +
      "</label>";
  }

  /** 预览里的一块 = 纸上一张卡片。与 print-core 的 `blockOf()` 同一份数据 */
  function renderBlock(b) {
    var rows = b.rows.map(function (r) {
      if (r.kind === "blank") return '<span class="print-blank" aria-hidden="true">　</span>';
      var cls = "print-row print-row-" + r.kind;
      return '<span class="' + cls + '">' + esc(r.text || "　") + "</span>";
    }).join("");
    return '<article class="print-block">' +
      (b.title ? '<h3 class="print-block-title">' + esc(b.title) + "</h3>" : "") +
      (b.meta ? '<p class="print-block-meta">' + esc(b.meta) + "</p>" : "") +
      '<div class="print-block-body">' + rows + "</div>" +
      "</article>";
  }

  /* -------------------------------------------------------------- 交互 */

  function bind() {
    if (!host) return;
    host.onclick = function (e) {
      var t = e.target;
      var hit = function (a) { return t && t.closest ? t.closest("[" + a + "]") : null; };

      var go = hit("data-print-go");
      if (go) { location.href = go.getAttribute("data-print-go"); return; }

      var paper = hit("data-print-paper");
      if (paper) { state.paper = paper.getAttribute("data-print-paper"); render(); return; }

      var run = hit("data-print-run");
      if (run) { runPrint(); return; }
    };
    host.onchange = function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var key = t.getAttribute("data-print-toggle");
      if (key) { state[key] = !!t.checked; render(); return; }
      if (t.id === "print-blank-lines") {
        var n = Number(t.value);
        state.blankLines = isFinite(n) ? Math.max(0, Math.min(12, Math.round(n))) : 3;
        render();
      }
    };
  }

  /**
   * 打印。
   *
   * ⚠️ **不自己生成 PDF** —— 本站没有 PDF 库（引一个就是几百 KB，
   *    而浏览器的打印对话框里「另存为 PDF」本来就是同一件事，且各平台都有）。
   *    界面上写的就是这一步，不写「导出 PDF」（那会让人以为点了就落一个文件）。
   */
  function runPrint() {
    var lay = layoutNow();
    if (!lay || !lay.count) {
      if (window.showToast) window.showToast("这一份里还没有篇目");
      return;
    }
    try { window.print(); }
    catch (e) {
      if (window.showToast) window.showToast("这个浏览器不允许直接打印，请用菜单里的「打印」");
    }
  }

  /* -------------------------------------------------------- 与页面的衔接 */

  function paintHeader() {
    var C = window.SiteChrome;
    if (!C) return;
    C.setPage("篇目打印页");
    C.setSub("选纸型 · 选内容 · 打印或存 PDF");
  }

  function paintBack() {
    var C = window.SiteChrome;
    if (!C || !C.setPageAction) return;
    if (!host || host.hidden) { C.setPageAction(null); return; }
    C.setPageAction({ label: "返回上一页", onclick: function () { close(); } });
  }

  /**
   * 打开这一层。
   * @param {Object} [opt] { collectionId, poemId }
   *   给了 `poemId` 就是「就这一篇」（从诗词详情页进）；
   *   给了 `collectionId` 就是「这一份清单」；都不给就是「全部自选」。
   */
  function open(opt) {
    if (!host) return;
    var o = opt || {};
    state.scope = o.poemId ? "poem" : "collection";
    state.poemId = o.poemId || "";
    state.collectionId = o.collectionId || "";
    host.hidden = false;
    state.open = true;
    if (!entryUrl) entryUrl = String(location.href);
    render();
    paintHeader();
    paintBack();
    window.scrollTo(0, 0);
  }

  function close() {
    if (!host) return;
    host.hidden = true;
    state.open = false;
    paintBack();
    var C = window.SiteChrome;
    if (C) { C.setPage(""); C.setSub(""); }
    window.scrollTo(0, 0);
  }

  /** 打开这一层的那颗键装在哪儿 —— 由各页面自己放槽位，这里只绑它 */
  function bindEntry() {
    var entry = document.querySelector("[data-print-open]");
    if (!entry) return;
    entry.addEventListener("click", function (e) {
      e.preventDefault();
      open({
        collectionId: entry.getAttribute("data-print-collection") || "",
        poemId: entry.getAttribute("data-print-poem") || ""
      });
    });
  }

  function init() {
    host = document.querySelector('[data-print-view="sheet"]');
    if (!host) return;
    host.hidden = true;
    bindEntry();
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && state.open) close();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.PrintPage = {
    CAP: CAP,
    open: open,
    close: close,
    isOpen: function () { return !!state.open; },
    state: function () { return state; },
    /* 测试用：不点界面直接取这一份的篇目与排版 */
    poems: poemsFor,
    layout: layoutNow
  };
})();
