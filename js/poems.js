/**
 * 课内古诗词索引页（/poems/ · 一至高三 261 首）
 * ==========================================================================
 * 这一页解决的是「课内诗词没有目录」这件事（Issue #114 第一条）。
 *
 * ## 为什么要有这一页
 *
 * 课外阅读入口页（/library/）摆着六张卡：课内诗词 + 五部集子。
 * 另外五张都指各自的**索引页**（/classic/、/tangshi/……），点进去是一份
 * 按卷次 / 词牌 / 文体排好的目录，再点一篇才是详情页。
 * 只有「课内诗词」那张指回了首页（/）—— 而首页是**今日背诵**：
 * 一进去就是按遗忘曲线排的今天那几首、进度环、掌握度。
 *
 * 于是同一个动作（在入口页点一张卡）在这一张卡上得到的结果与其他五张不同：
 * 用户想看的是「课内都收着哪些诗」，落地的却是「今天该背这几首」。
 * 这一页就是那张缺失的目录页：**按年级分册，261 首一首不少，想读哪首点哪首**。
 *
 * ## 与首页（/）的分工 —— 一个字都不重叠
 *
 *   首页 /        今日背诵：按遗忘曲线排今天背哪几首、复习结果、进度环
 *   本页 /poems/  目录：一至高三逐册翻，读、听、注音、看译文
 *
 * 两页读的是**同一份语料**（data/poems-1..12.js + data/index.js），
 * 所以同一首诗在两处显示的正文、译文、出处一字不差。
 * 本页**不做**每日任务、不排程、不写背诵进度 —— 首页那一套（今日背诵 +
 * 遗忘曲线 + 自选集合排程）一个字都不动。
 *
 * ## 「已读」是这一页自己的进度，与背诵进度是两回事
 *
 * 键名 `poem_poems_read_v1`（与五部集子「各存各的已读」同一套口径）。
 * 为什么不能跟首页共用一份：
 *   · 首页的 poem_recite_progress_v1 记的是**遗忘曲线**（第几轮、下次何时复习、
 *     掌握度）——「在这儿翻了一眼」不该给它记一笔复习，否则复习计划会被读乱；
 *   · 已读只是一个「翻到哪儿了」的书签，261 首各有一个勾。
 * 两者互不影响：在这一页读一首，不会让它在首页的今日任务里变成「已复习」。
 *
 * ## 分组是教材的册次，不是自拟的分类
 *
 * 五部集子的分组名是「卷一 五言古诗」「蒙学经典」「赋 · 京都上」这类
 * 由选本给定的分类；课内这一部的天然分法就是**教材册次**：
 * 一年级上、一年级下……高三下，共 24 册 —— 与设置里「学段 / 年级 / 学期」
 * 三档选的正是同一件事。
 * gradeGroup 也**不改数据文件**：data/poems-*.js 里没有这个字段，
 * 是挂载前逐条补上的（引擎只认 gradeGroup 这一个分组口径）。
 *
 * ## 列表上不挂「加入背诵」
 *
 * 五部集子的条目右侧有一枚书签圆键（把课外那一篇收进自选集合，跟着遗忘曲线背）。
 * 课内这 261 首**本来就在每日任务里**（今日背诵按年级学期排的就是它们），
 * 再挂一枚「加入背诵」只会让人以为「不点它就不会被排上」。
 * 所以 `reciteList: false`：列表上不出现那枚圆键。
 * 详情页工具条上那一枚仍然可用（用户明确想把它单列进自己的清单时）。
 */
(function () {
  "use strict";

  /** 年级 → 中文名。与 data/index.js 的 window.GRADE_NAMES 同源，缺了就地回落。 */
  function gradeName(g) {
    var names = window.GRADE_NAMES;
    return (names && names[g]) || g + "年级";
  }

  function termName(t) {
    return Number(t) === 2 ? "下" : "上";
  }

  /**
   * 册次顺序：一年级上 → 一年级下 → …… → 高三下，共 24 册。
   * 写出来（而不是让引擎按数据出场顺序推）的理由与五部集子写卷次顺序一样：
   * 日后数据顺序变了，列表的分组顺序不该跟着乱。
   */
  var GROUP_ORDER = (function () {
    var out = [];
    for (var g = 1; g <= 12; g += 1) {
      out.push(gradeName(g) + termName(1));
      out.push(gradeName(g) + termName(2));
    }
    return out;
  })();

  /**
   * 给每一条补上 gradeGroup（引擎按它分组、按它排序）。
   *
   * ⚠️ 不改数据文件：data/poems-*.js 里没有 gradeGroup 这个字段，
   *    也不该有（那是「集子的分类」，课内的分类就是册次，由这一页算出来）。
   *    引擎侧只认 gradeGroup 一个口径，所以这里逐条补一份**副本**。
   */
  function withGroups(all) {
    var list = [];
    var seen = {};
    all.forEach(function (raw) {
      // 同一 id 出现两次时只收一次，免得列表上同一首诗画两行
      if (!raw || !raw.id || seen[raw.id]) return;
      seen[raw.id] = true;
      var p = {};
      Object.keys(raw).forEach(function (k) { p[k] = raw[k]; });
      p.gradeGroup = gradeName(p.grade) + termName(p.term);
      list.push(p);
    });
    var rank = {};
    GROUP_ORDER.forEach(function (name, i) { rank[name] = i; });
    list.sort(function (a, b) {
      return (rank[a.gradeGroup] - rank[b.gradeGroup]) || 0;
    });
    return list;
  }

  function boot() {
    if (!window.ReaderEngine) return;
    var all = window.POEMS_ALL || [];
    var listEl = document.querySelector('[data-gw="list"]');
    if (!all.length) {
      if (listEl) listEl.innerHTML = '<div class="empty">课内诗词数据加载失败</div>';
      return;
    }

    var engine = window.ReaderEngine.mount({
      id: "poems",
      items: withGroups(all),
      root: "[data-gw-root]",
      reader: "#gw-reader",
      groupOrder: GROUP_ORDER,
      // 页面名与 <title> 口径：与 /classic/、/tangshi/ 一致，用**全名**——
      // 「背诵」是页签上的短名（装不下全名），顶栏与 <title> 放得下就该写全。
      pageTitle: "课内古诗词",
      pageSub: "一至高三 · 按年级分册，想读哪首点哪首",
      words: {
        list: "诗词",
        unit: "首",
        loadingFailed: "课内诗词数据加载失败",
        empty: "没有匹配的诗词",
        matchGroup: "课内",
        backToList: "返回诗词列表",
        // 「已读」是这一页自己的书签，与首页的背诵进度分开存（见文件头）
        readStore: "poem_poems_read_v1",
        playerTitle: "课内诗词朗读",
        searchPlaceholder: "搜索诗题 / 作者 / 名句"
      },
      // 列表上不挂「加入背诵」圆键：这一部本来就在每日任务里（见文件头）
      reciteList: false
    });

    /* ------------------------------------------------------------------
       古诗词大会那一层要能「点一句 → 打开那一篇的原文」（3 期）。

       它自己不知道阅读器怎么开 —— 那是这一页与引擎的事。所以它只发一个
       事件（`poems:open`），由这里接住并调 `api.open(id)`。
       **这是这两个模块之间唯一的接口**：那一层不认识 `ReaderEngine`，
       这一页也不认识 `PoemGame` 的内部状态；少一处耦合，就少一处
       「一边改了、另一边还在用老假设」的坑。

       ⚠️ 引擎缺席（老缓存 / 脚本顺序变了）时**什么都不做**：
          那一层照样能玩，只是点句子不开原文 —— 不报错、不打断答题。
       ------------------------------------------------------------------ */
    document.addEventListener("poems:open", function (e) {
      var id = e && e.detail && e.detail.id;
      if (!id || !engine || !engine.open) return;
      /* 大会那一层还盖在上面：先把它收掉，再开阅读器 ——
         否则阅读器叠在大会那一层底下，用户看到的是「点了没反应」。 */
      if (window.PoemGame && window.PoemGame.isOpen && window.PoemGame.isOpen()) {
        window.PoemGame.close();
      }
      engine.open(id);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
