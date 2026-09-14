/**
 * 自选集合（给自己加背的篇目）
 * ==========================================================================
 * 「中小学古诗词」那一套（每日 5 首、按遗忘曲线复习）只认教材里的 261 首。
 * 孩子想多背一篇《木兰诗》、家长想让孩子加背《论语》里的一段，
 * 现在没有地方放。这一份文件就是那个地方。
 *
 * ## 与「唐诗三百首」「古文观止」那几部集子不是一回事
 *
 * 那几部是**既定的选本**：篇目、卷次、词牌都照着书排，一个字不能改。
 * 自选集合是**用户自己的清单**：想加就加、想删就删，随时改名，
 * 一部集子里挑两篇、另一部挑三篇，混在一个集合里也完全可以 ——
 * 所以集合里**不分卷次、不分词牌、不分任何组**，就是一串篇目。
 * （用户原话：「集合没有必要添加分组了」。）
 *
 * ## 存的是什么：引用 + 一份小快照
 *
 * 主体是**引用**：条目 id 用 data/site-index.js 的口径
 * （`tangshi-ts-12` / `songci-sc-4` / `classic-ck-3` …），那是全站唯一键。
 *
 * 但**光有引用不够**：首页要排每日任务、要显示「自选背诵」清单，
 * 而首页只加载课内 12 册的数据（不加载五部集子那 4.4MB）。
 * 若首页拿不到正文，今日任务里那一篇就是空壳。
 * 所以「加入背诵」时**顺手存一份最小快照**（题名 / 作者 / 朝代 / 出处 /
 * 集子名与页址 / 正文 / 译文 / 译文来源）—— 只存用户**主动加进来**的那些，
 * 几十条的量级，不是把整部集子抄一遍。
 * 哪个页面加载了完整索引（集子页 / 搜索页），就把这些快照**就地刷新一次**，
 * 让老快照跟上语料订正。
 *
 * 判重按**作品**（data/works-index.js 的 wid）：课内《静夜思》与唐诗《夜思》
 * 正文一致、是同一篇，只要在其中任一条上点过「加入背诵」，
 * 另一条也会显示「已在背诵」；每日任务里也只会出现一次。
 * 正文有出入的（教材本与选本原貌不同）本就是两篇作品，两条可以各自加入。
 *
 * ## 存储
 *
 * localStorage · `poem_recite_collections_v1`
 *   {
 *     version: 1,
 *     collections: [
 *       { id: "c-...", name: "我要背的", createdAt: 1699.., items: ["tangshi-ts-12", ...] }
 *     ]
 *   }
 * 一个集合是一张清单；同一篇可以同时属于多个集合（各存一份引用），
 * 排每日任务时按 wid 去重，不会因此多背一遍。
 * ========================================================================== */
(function () {
  "use strict";

  var KEY = "poem_recite_collections_v1";
  var NAME_MAX = 12;
  var DEFAULT_NAME = "我要背的";

  function now() { return Date.now(); }

  function uid() {
    return "c-" + now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }

  function read() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!v || typeof v !== "object") return { version: 1, collections: [] };
      if (!Array.isArray(v.collections)) v.collections = [];
      v.collections.forEach(function (c) {
        if (!Array.isArray(c.items)) c.items = [];
      });
      return v;
    } catch (e) {
      return { version: 1, collections: [] };
    }
  }

  function write(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
    // 排程缓存（sessionStorage 里的当天计划）按「有没有加过篇目」失效：
    // 加了新篇目当天就要出现在今日任务里，不能等明天。
    try {
      Object.keys(sessionStorage)
        .filter(function (k) { return k.indexOf("poem_plan_") === 0; })
        .forEach(function (k) { sessionStorage.removeItem(k); });
    } catch (e) { /* 无 sessionStorage 的环境（部分隐私模式）忽略 */ }
    window.dispatchEvent(new CustomEvent("recite-collections-change", {
      detail: { collections: data.collections }
    }));
  }

  /** 名称规范化：去首尾空白、限长；空名回落默认名 */
  function cleanName(name) {
    var s = String(name == null ? "" : name).trim().replace(/\s+/g, " ");
    if (!s) s = DEFAULT_NAME;
    return s.slice(0, NAME_MAX);
  }

  /**
   * 从站点索引里给这一条摘一份最小快照（首页排每日任务、显示自选清单要用）。
   * 索引里没有（该页没加载这一部）就返回 null，入库存 null，日后再补。
   */
  function snapshotOf(entryId, index) {
    var list = index || window.SITE_INDEX || [];
    var p = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === entryId) { p = list[i]; break; }
    }
    if (!p) return null;
    return {
      title: p.title, author: p.author || "", authorName: p.authorName || "",
      dynasty: p.dynasty || "", source: p.source || "", selection: p.selection || "",
      book: p.book || "", bookName: p.bookName || "", page: p.page || "",
      text: p.text || "", translation: p.translation || "",
      translationSource: p.translationSource
    };
  }

  /** 条目 id → 作品 id（没有主表时回落自身，判重退化成按条目） */
  function widOf(entryId) {
    if (window.WorksIndex && window.WorksIndex.widOf) return window.WorksIndex.widOf(entryId) || entryId;
    return entryId;
  }

  /** 集合里的条目 → 其 id（兼容早期只存字符串的写法） */
  function itemId(it) { return typeof it === "string" ? it : (it && it.id) || ""; }

  /** 条目 → 它的快照（没有则 null） */
  function itemSnap(it) { return (it && typeof it === "object" && it.snap) ? it.snap : null; }

  /** 这一篇（作品）加在哪些集合里 */
  function collectionsOf(entryId) {
    var wid = widOf(entryId);
    return read().collections.filter(function (c) {
      return c.items.some(function (it) { return widOf(itemId(it)) === wid; });
    });
  }

  /** 这一篇（作品）是否已在某个自选集合里 */
  function has(entryId) {
    return collectionsOf(entryId).length > 0;
  }

  /**
   * 加入背诵。
   * @param {string} entryId  站点条目 id
   * @param {string} [collectionId] 目标集合；不给则放进第一个集合，
   *   一个集合都没有就新建一个
   * @returns {{collection: Object, added: boolean, created: boolean}}
   */
  function add(entryId, collectionId) {
    if (!entryId) return null;
    var data = read();
    var created = false;
    var col = null;

    if (collectionId) {
      col = data.collections.filter(function (c) { return c.id === collectionId; })[0] || null;
    }
    if (!col) {
      col = data.collections[0] || null;
    }
    if (!col) {
      col = { id: uid(), name: DEFAULT_NAME, createdAt: now(), items: [] };
      data.collections.push(col);
      created = true;
    }

    var wid = widOf(entryId);
    var exists = col.items.some(function (it) { return widOf(itemId(it)) === wid; });
    if (!exists) {
      col.items.push({ id: entryId, snap: snapshotOf(entryId) });
    }
    write(data);
    return { collection: col, added: !exists, created: created };
  }

  /** 从某个集合移出这一篇（作品）；返回是否真的移掉了 */
  function remove(entryId, collectionId) {
    var data = read();
    var wid = widOf(entryId);
    var col = collectionId
      ? data.collections.filter(function (c) { return c.id === collectionId; })[0]
      : null;
    if (!col) return false;
    var before = col.items.length;
    col.items = col.items.filter(function (it) { return widOf(itemId(it)) !== wid; });
    if (col.items.length === before) return false;
    write(data);
    return true;
  }

  /** 从全部集合里移出这一篇（作品） */
  function removeEverywhere(entryId) {
    var data = read();
    var wid = widOf(entryId);
    var hit = false;
    data.collections.forEach(function (c) {
      var before = c.items.length;
      c.items = c.items.filter(function (it) { return widOf(itemId(it)) !== wid; });
      if (c.items.length !== before) hit = true;
    });
    if (hit) write(data);
    return hit;
  }

  function create(name) {
    var data = read();
    var col = { id: uid(), name: cleanName(name), createdAt: now(), items: [] };
    data.collections.push(col);
    write(data);
    return col;
  }

  function rename(collectionId, name) {
    var data = read();
    var col = data.collections.filter(function (c) { return c.id === collectionId; })[0];
    if (!col) return null;
    col.name = cleanName(name);
    write(data);
    return col;
  }

  function drop(collectionId) {
    var data = read();
    var before = data.collections.length;
    data.collections = data.collections.filter(function (c) { return c.id !== collectionId; });
    if (data.collections.length === before) return false;
    write(data);
    return true;
  }

  /**
   * 全部自选篇目的**作品**去重清单：排每日任务用这个。
   * 同一篇在多个集合里只算一次。
   * @returns {Array<{wid, entryId}>} 代表条目取先出现的那一个
   */
  function allEntries() {
    var data = read();
    var seen = {};
    var out = [];
    data.collections.forEach(function (c) {
      c.items.forEach(function (it) {
        var id = itemId(it);
        var wid = widOf(id);
        if (seen[wid]) return;
        seen[wid] = true;
        out.push({ wid: wid, entryId: id, collectionId: c.id, snapshot: itemSnap(it) });
      });
    });
    return out;
  }

  /** 自选篇目的总数（按作品去重） */
  function count() { return allEntries().length; }

  /** 一篇作品的**排程代表条目 id**：与课内同篇就并到课内那一份进度上 */
  function poemIdFor(entryId) {
    if (window.WorksIndex && window.WorksIndex.repOf) return window.WorksIndex.repOf(entryId);
    return entryId;
  }

  /**
   * 交给遗忘曲线排程用的篇目对象。
   *
   * 一条 = 一篇作品（去重后的），`id` 是**排程代表条目 id**：
   * 与课内同篇的并到课内那一份（老进度一条不丢），纯课外篇目用它自己。
   * 正文等字段从站点索引取；站点索引里没有的（集子页没加载全站索引）就地跳过 ——
   * 宁可这一篇今天不排，也不能拿一个没有正文的空壳去排。
   *
   * @param {Array} [index] 站点索引，缺省用 window.SITE_INDEX
   */
  function scheduleItems(index) {
    var idx = index || window.SITE_INDEX || [];
    var byId = {};
    idx.forEach(function (p) { byId[p.id] = p; });

    var seen = {};
    var out = [];
    allEntries().forEach(function (it) {
      var repEntry = poemIdFor(it.entryId);
      var wid = widOf(it.entryId);
      if (seen[wid]) return;
      // 正文以「代表条目」为准：与课内同篇时取课内文本（教材口径）。
      // 索引里没有这一条时（首页只加载课内 12 册，不加载五部集子那 4.4MB）
      // 回落到加入时存下的**快照** —— 有快照就排得上、显示得出，
      // 免得「加入背诵」在首页变成一条空壳。
      var p = byId[repEntry] || byId[it.entryId];
      var snap = it.snapshot || {};
      if (!p && !snap.text) return;
      seen[wid] = true;
      out.push({
        id: repEntry,
        // 排程代表条目与用户加入的那一条不是同一条时，记下原始条目：
        // 列表里要显示「你加的这一条」，而不是替他换成课内那一条
        sourceEntryId: it.entryId,
        wid: wid,
        title: (p && p.title) || snap.title || "",
        author: (p && p.author) || snap.author || "",
        dynasty: (p && p.dynasty) || snap.dynasty || "",
        source: (p && p.source) || snap.source || "",
        selection: (p && p.selection) || snap.selection || "",
        book: (p && p.book) || snap.book || "",
        bookName: (p && p.bookName) || snap.bookName || "",
        page: (p && p.page) || snap.page || "",
        text: (p && p.text) || snap.text || "",
        translation: (p && p.translation) || snap.translation || "",
        translationSource: (p && p.translationSource) || snap.translationSource,
        custom: true
      });
    });
    return out;
  }

  window.ReciteCollections = {
    KEY: KEY,
    DEFAULT_NAME: DEFAULT_NAME,
    NAME_MAX: NAME_MAX,
    cleanName: cleanName,
    list: function () { return read().collections; },
    get: function (id) { return read().collections.filter(function (c) { return c.id === id; })[0] || null; },
    create: create,
    rename: rename,
    remove: drop,
    add: add,
    removeItem: remove,
    removeEverywhere: removeEverywhere,
    collectionsOf: collectionsOf,
    has: has,
    allEntries: allEntries,
    snapshotOf: snapshotOf,
    /**
     * 用当前页加载到的站点索引刷新所有快照（集子页 / 搜索页六部齐备时调用）。
     * 语料订正过（比如某篇标题改了）之后，老快照能跟着更新。
     */
    refreshSnapshots: function (index) {
      var list = index || window.SITE_INDEX || [];
      if (!list.length) return 0;
      var data = read();
      var n = 0;
      data.collections.forEach(function (c) {
        c.items = c.items.map(function (it) {
          var wasStr = typeof it === "string";
          if (wasStr) it = { id: it, snap: null };
          var fresh = snapshotOf(it.id, list);
          if (!fresh) return it;
          // 拿到真语料了：顺手清掉「快照待刷新」的标记（见 markStale）
          var hadStale = !!it.stale;
          if (hadStale) delete it.stale;
          // 只在内容真的变了时才写库 —— 否则每次进页面都写一次并派发事件，
          // 会与「集合变化 → 重排今日任务」的事件打转。
          if (wasStr || hadStale || JSON.stringify(it.snap) !== JSON.stringify(fresh)) {
            it.snap = fresh;
            n += 1;
          }
          return it;
        });
      });
      if (n) write(data);
      return n;
    },
    /**
     * 把「这一篇的快照还是旧的」标出来（首页启动时调用一次）。
     *
     * 首页只加载课内 12 册，五部集子那 4.4MB 不加载 —— 课外那些自选篇目
     * 拿不到新语料，只能知道「我手里这份快照是哪一次存的」。
     * 于是把 `stale` 记下来（只记状态，不改任何正文）：
     *   · 课内那几条首页索引里查得到，refreshSnapshots 已经就地把它们刷新了，
     *     不会走到这一支；
     *   · 课外那几条标 `stale: true`，等下次进集子页 / 搜索页时由
     *     refreshSnapshots 用真语料覆盖并清掉这个标记。
     * 这一趟**不派发 change 事件**（标状态不算集合内容变化），
     * 否则会与「集合变化 → 重排今日任务」那个监听打转。
     */
    markStale: function (index) {
      var list = index || window.SITE_INDEX || [];
      var byId = {};
      list.forEach(function (p) { byId[p.id] = p; });
      var data = read();
      var n = 0;
      data.collections.forEach(function (c) {
        c.items.forEach(function (it) {
          if (!it || typeof it !== "object" || !it.id || !it.snap) return;
          var fresh = byId[it.id];
          // 首页索引里查得到（课内）→ 上面那一步已经刷过了，没标 stale 的必要；
          // 查不到（课外）→ 这一份快照来路不明，标上等下次刷新
          var stale = !fresh;
          if (!!it.stale !== stale) {
            if (stale) it.stale = true; else delete it.stale;
            n += 1;
          }
        });
      });
      if (n) {
        // 直接落库、不派发事件：stale 只是「快照待刷新」的标记，
        // 不是集合内容变化，不需要重排今日任务
        try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 隐私模式 */ }
      }
      return n;
    },
    count: count,
    widOf: widOf,
    poemIdFor: poemIdFor,
    scheduleItems: scheduleItems
  };
})();
