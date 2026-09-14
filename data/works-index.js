/* ==========================================================================
   作品主表（Issue #69 收尾 · 主表裁定规则）
   --------------------------------------------------------------------------
   全站有六部集子，同一篇作品常常既在课内教材里、又在某一部选本里
   （《静夜思》课内一年级上、唐诗三百首卷七；《桃花源记》课内八年级下、
   古文观止卷六；《念奴娇·赤壁怀古》课内高一上、宋词三百首……）。
   各集子的数据文件**各自存一份完整副本**，谁也不引用谁 ——
   搜一次出来两条、每日任务里同一首诗出现两次，都是这么来的。

   这一份文件把「哪些条目其实是同一篇作品」这张对照表提供出来，
   供搜索去重、向自选集合加入时判重、以及遗忘曲线排程时按作品去重。
   它**不改动任何一部集子的数据文件**：各集子照旧各存各的正文，
   这一层只在上面叠一张「同一篇」的关系表。

   ## 主表的正文本以谁为准：课内以教材为准，选集以选本原貌为准

   教材与选本的文本**真会不一样**，是文献上的差别、不是录入出错：

     · 《静夜思》 教材与《唐诗三百首》正文一致 → 合并为同一篇
     · 《陋室铭》 教材作「孔子云何陋之有」、古文观止作「孔子云『何陋之有』」→
                  引号剥掉后正文一致，合并
     · 《夜上受降城闻笛》 教材作「回乐烽」、唐诗三百首作「回乐峰」→
                  一字之差，是两种文本，**分成两条并列的作品**，各背各的

   规则一句话：**课内以教材文本为准，选集以选本原貌为准，冲突时分成两条并列的作品**。

   ## 两种取数方式（页面加载量不同，结果一致）

   1. `window.WORKS_GROUPS`（data/works-map.js，8KB 静态表）——
      集子索引页只加载自己那一部的数据，判重就靠它。这是**默认**路径。
   2. 站点总索引齐备时（搜索页、首页）可以现算一份更全的，
      顺带能用 `dedupKey` 对新语料做校验。两条路径的判重口径一样：
      **正文去标点后一致 = 同一篇作品**（见 dedupKey）。

   ## 字段

     wid      作品 id（`w-` + 首个条目 id），全站唯一
     key      判重键：正文去标点、去空白、转小写（仅现算路径有）
     title    作品题名（有课内条目时取教材题名）
     titles   这一篇出现过的全部题名（同诗异题）
     text     正文（仅现算路径有）
     entries  收录这一篇的全部站点条目 id

   条目 id 与 data/site-index.js 的口径一致（集子前缀 + 集子内 id）。
   ========================================================================== */
(function () {
  "use strict";

  /** 判重键：去标点、去空白、去换行，转小写。
      · 只比正文，不比题名 —— 同诗异题（《夜思》/《静夜思》）应当认作同一篇；
      · 标点一律不看（「！」「。」之别、宋词断句、CJK 引号各家用法不同）；
      · 引号必须剥掉：《陋室铭》课内作「孔子云何陋之有」、
        古文观止作「孔子云『何陋之有』」，不剥就会被判成两篇不同的作品。 */
  function dedupKey(text) {
    return String(text == null ? "" : text)
      .replace(/[\s\u3000]+/g, "")
      .replace(/[，。！？；：、,.!?;:"'“”‘’「」『』《》〈〉（）()\[\]【】—－\-…·~～]/g, "")
      .toLowerCase();
  }

  /** 课内诗词优先当「主条目」：主表里作品取课内的题名（教材口径）。 */
  var COURSE_BOOK = "poems";

  function bookOf(entryId) {
    return String(entryId || "").split("-")[0];
  }

  /** 从静态表 + 站点索引组装作品列表 */
  function buildFromMap(index) {
    var groups = window.WORKS_GROUPS || [];
    var byWid = {};
    var order = [];
    var byEntry = {};
    var byKey = {};

    // 先把静态表里的多条目作品登记上（集子索引页只加载自己那一部时，靠这一份判重）
    groups.forEach(function (g) {
      if (!byWid[g.wid]) {
        byWid[g.wid] = { wid: g.wid, key: "", title: g.title, titles: (g.titles || []).slice(), text: "", entries: [] };
        order.push(g.wid);
      }
      g.entries.forEach(function (id) {
        byEntry[id] = g.wid;
        if (byWid[g.wid].entries.indexOf(id) === -1) byWid[g.wid].entries.push(id);
      });
    });

    // 站点索引里的每一条：
    //   · 静态表已登记 → 并进那一组；
    //   · 否则**按判重键现算**（正文去标点后一致即同一篇）——
    //     这样加载了完整索引的页面（搜索页 / 首页）拿到的是全量结果，
    //     不依赖静态表是否已跟到最新；
    //   · 再没有同篇的就自成一档（条目 id 就是作品 id）。
    (index || []).forEach(function (p) {
      if (!p || p.isBook || !p.id) return;
      var wid = byEntry[p.id];
      var key = dedupKey(p.text);
      if (!wid) {
        if (key && byKey[key]) {
          wid = byKey[key];
        } else {
          wid = "w-" + p.id;
          if (key) byKey[key] = wid;
        }
        byEntry[p.id] = wid;
        if (!byWid[wid]) {
          byWid[wid] = { wid: wid, key: key, title: p.title, titles: [], text: p.text || "", entries: [] };
          order.push(wid);
        }
      }
      var w = byWid[wid];
      if (w.titles.indexOf(p.title) === -1) w.titles.push(p.title);
      if (w.entries.indexOf(p.id) === -1) w.entries.push(p.id);
      if (!w.text && p.text) w.text = p.text;
      if (!w.key) w.key = key;
      if (key && !byKey[key]) byKey[key] = wid;
      // 主条目题名以课内为准：课内条目出现时把它提上来
      if (bookOf(p.id) === COURSE_BOOK) w.title = p.title;
    });

    return { list: order.map(function (wid) { return byWid[wid]; }), byEntry: byEntry, byWid: byWid };
  }

  var MAP = buildFromMap(window.SITE_INDEX || []);

  /** 作品列表（数组顺序 = 静态表顺序 + 站点索引顺序，课内在前） */
  var WORKS = MAP.list;
  var BY_ENTRY = MAP.byEntry;
  var BY_WID = MAP.byWid;

  window.WorksIndex = {
    works: WORKS,
    /** 判重键（导出给测试与外部核对用） */
    dedupKey: dedupKey,
    /** 站点条目 id → 作品 id（未登记的单条回落自身，判重退化成按条目） */
    widOf: function (entryId) { return BY_ENTRY[entryId] || entryId || ""; },
    /** 作品 id → 作品 */
    byWid: function (wid) { return BY_WID[wid] || null; },
    /** 某条站内条目所属这一篇「同一作品」的全部条目 id */
    entriesOf: function (entryId) {
      var w = BY_WID[BY_ENTRY[entryId]];
      return w ? w.entries.slice() : [];
    },
    /** 两条站内条目是不是同一篇作品（正文一致即同一篇） */
    same: function (a, b) {
      var wa = BY_ENTRY[a];
      var wb = BY_ENTRY[b];
      return !!wa && wa === wb;
    },
    /**
     * 一篇作品的**代表条目**：优先取课内条目，没有则取第一条。
     *
     * 用途：排每日任务时，同一篇作品只认一个进度记录 ——
     * 课内《静夜思》与唐诗《夜思》是同一篇，用户可能在唐诗页点了「加入背诵」，
     * 但这一篇在课内早就背到第 4 轮了。进度必须**合流到同一条**，
     * 否则同一首诗在课内外各存一份进度、各排各的复习，背两遍。
     *
     * 取课内条目还有一层：课内的进度键（`poem_recite_progress_v1`）
     * 从第一天起就是按课内条目 id 存的，**选了课内条目 = 老进度一条不丢**。
     * 找不到对应课内条目的（纯课外篇目，如《高阳台》），就用它自己。
     */
    repOf: function (entryId) {
      var wid = BY_ENTRY[entryId];
      var w = BY_WID[wid];
      if (!w || !w.entries.length) return entryId;
      for (var i = 0; i < w.entries.length; i++) {
        if (bookOf(w.entries[i]) === COURSE_BOOK) return w.entries[i];
      }
      return w.entries.indexOf(entryId) >= 0 ? entryId : w.entries[0];
    },
    /** 重建（搜索页在六部数据齐备后可以调用一次，用现算结果补全） */
    rebuild: function (index) {
      MAP = buildFromMap(index || window.SITE_INDEX || []);
      WORKS = MAP.list;
      BY_ENTRY = MAP.byEntry;
      BY_WID = MAP.byWid;
      window.WorksIndex.works = WORKS;
      window.WORKS_ALL = WORKS;
      return WORKS;
    }
  };

  window.WORKS_ALL = WORKS;
})();
