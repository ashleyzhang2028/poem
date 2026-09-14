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
 * ## 顺序 / 整组移出 / 导入导出（Issue #69 后续）
 *
 * 集合里的顺序 = 数组里的顺序：**用户自己排的，不由系统重排**。
 * 新建加入的排在末尾；「上移 / 下移」就地交换两项；「整组移出」把某一组
 * 一次挑出来（按同一部集子 / 同一个卷次文体分），不必逐篇点。
 *
 * 导入导出是**纯文本**：一整个集合就是一串条目 id，一行一条（`#` 开头是
 * 注释行，导出时写进集合名与篇名，方便家长之间对对清单）。
 * 文本只有几 KB，微信 / 短信里直接发得出去；也接受只贴 id 的裸清单。
 *
 * ## 显示的篇名不带「其一 / 其二」
 *
 * 宋词里同一作者同一词牌有好几首（晏殊三个《木兰花》、贺连两个《蝶恋花》），
 * 原始清单没有首句可以分辨，整理时按目录先后标了「其一 / 其二 / 其三」。
 * 用户的原话是「去掉自选集合中其一其二这些你不清楚的」——
 * 那个编号**只作语料内部的条目区分**，不是选本原名，不该端到用户面前。
 *
 * 所以自选集合这一块显示篇名时，一律用 displayTitle() 去掉这个尾巴。
 * 集合里存的仍是**完整的原 id**，`tangshi-ts-1` 与 `tangshi-ts-2` 分得清；
 * 去掉的只是「给人看的那一行字」。
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

  /**
   * 篇目的**显示名**：去掉语料内部用来区分同名词作的「其一 / 其二 / 其三」。
   *
   * 用户原话「去掉自选集合中其一其二这些你不清楚的」——
   * 那个编号是整理宋词时按目录次序补的序号（同一作者同一词牌好几首，
   * 原始清单里没有首句可以分辨），不是选本原名，对用户没有意义：
   * 「木兰花·其二」看不出是哪一首，反而像漏了前半句。
   *
   * 只去尾巴：`感遇·其一` → `感遇`、`木兰花·其二` → `木兰花`；
   * 句中出现的「其一」不动（`四时田园杂兴（其二）` 另有括号形态，一并去）。
   *
   * ⚠️ 目录里**不改名** —— 集合存的仍是完整 id（`tangshi-ts-1` / `-2` 仍分得清），
   *    去编号只发生在这里，是「给人看的那一行字」。
   */
  function displayTitle(title) {
    var t = String(title == null ? "" : title);
    // 「·其一」「其一」「（其一）」「(其一)」四种写法在语料里都出现过
    t = t.replace(/[·・]?其[一二三四五六七八九十]\s*$/, "");
    t = t.replace(/[（(]\s*其[一二三四五六七八九十]\s*[）)]\s*$/, "");
    return t.replace(/[·・\s]+$/, "");
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

  // ---------------- 顺序：上移 / 下移 / 移到指定位置 ----------------

  /**
   * 把集合里的第 i 项挪到第 j 项的位置（其余顺次让位）。
   *
   * 只动这一条数组 —— 集合的顺序就是数组顺序，不另存一份「排序字段」，
   * 免得日后两份顺序各说各话。越界时原样返回，调用方不必先自己夹一遍。
   */
  function moveItem(collectionId, from, to) {
    var data = read();
    var col = data.collections.filter(function (c) { return c.id === collectionId; })[0];
    if (!col) return false;
    var n = col.items.length;
    var i = Number(from);
    var j = Number(to);
    if (!(i >= 0 && i < n) || !(j >= 0 && j < n) || i === j) return false;
    var it = col.items.splice(i, 1)[0];
    col.items.splice(j, 0, it);
    write(data);
    return true;
  }

  /** 上移一位（已经在最前就不动） */
  function moveUp(collectionId, index) { return moveItem(collectionId, index, index - 1); }

  /** 下移一位（已经在最后就不动） */
  function moveDown(collectionId, index) { return moveItem(collectionId, index, index + 1); }

  // ---------------- 整组移出 ----------------

  /**
   * 把某个集合里「同一组」的篇目一次移出。
   *
   * 「组」= 这一篇所在的集子 + 卷次 / 词牌 / 文体（`book + "|" + group`），
   * 与集子页上的分组是同一个口径。用户从唐诗里挑了几十篇，想整卷拿掉时，
   * 不必逐篇点。
   *
   * `groupOf` 由调用方给（首页把站点索引的字段取出来），这一层不猜结构；
   * 给不出组的（索引里查不到的旧快照）算作「未分组」，也能整组移出。
   *
   * @param {string} collectionId
   * @param {string} group  组的键，见 groupKeyOf()
   * @param {Function} groupOf 条目 id → 组键
   * @returns {number} 实际移出的篇数
   */
  function removeGroup(collectionId, group, groupOf) {
    var data = read();
    var col = data.collections.filter(function (c) { return c.id === collectionId; })[0];
    if (!col) return 0;
    var g = String(group);
    var before = col.items.length;
    col.items = col.items.filter(function (it) {
      return groupKeyOf(itemId(it), groupOf) !== g;
    });
    var removed = before - col.items.length;
    if (removed) write(data);
    return removed;
  }

  /**
   * 组的键：集子 + 卷次 / 词牌 / 文体。
   *
   * 首页只加载课内 12 册，课外那些篇目查不到站点索引，只有一个最小快照
   * （快照里记了 book / bookName，够认出是哪一部集子）。这时按「集子」成组，
   * 卷次那一段拿不到 —— 用户在这儿看到的就是「唐诗三百首」这一组，
   * 点「整组移出」移的是这一部，与列表上显示的分组一致（不多不少）。
   */
  function groupKeyOf(entryId, groupOf) {
    if (typeof groupOf === "function") {
      var k = groupOf(entryId);
      if (k) return String(k);
    }
    return "未分组";
  }

  // ---------------- 导入 / 导出 ----------------

  /**
   * 导出一个集合为纯文本。
   *
   * 一整个集合就是一串条目 id —— 导出时顺手写上集合名与篇名当注释，
   * 家长之间互传时对方看得懂；导入时 `#` 行会被跳过。
   *
   *   # 跬步 · 自选集合：我要背的（12 篇）
   *   # 导入方法：跬步首页 → 自选背诵 → 导入
   *   # 唐诗三百首 卷一 五言古诗 感遇·其一
   *   tangshi-ts-1
   *
   * @param {string} collectionId
   * @param {Object} [labels] 条目 id → 一行说明（篇名 / 集子），可省
   */
  function exportText(collectionId, labels) {
    var col = read().collections.filter(function (c) { return c.id === collectionId; })[0];
    if (!col) return "";
    var lines = [
      "# 跬步 · 自选集合：" + col.name + "（" + col.items.length + " 篇）",
      "# 一行一条条目 id；以 # 开头的行是说明，导入时会跳过",
      "# 导入方法：跬步首页 → 自选背诵 → 导入"
    ];
    col.items.forEach(function (it) {
      var id = itemId(it);
      if (!id) return;
      var label = labels && labels[id];
      lines.push("# " + (label || id));
      lines.push(id);
    });
    return lines.join("\n") + "\n";
  }

  /**
   * 从纯文本导入，返回**新建**的集合。
   *
   * 宽松解析：`#` 开头的行、空行都跳过；每行取第一个字段（兼容
   * 「id 空格 篇名」这种从别处抄来的写法）。认不出的行不算数，
   * 导入完把「收了几条 / 丢了几条」一并返回，让界面如实告诉用户。
   *
   * 导入**总是新建一个集合**，不往已有集合里塞 —— 家长传来的清单
   * 与自己的那几份混在一起，事后没人分得清哪条是谁的。
   *
   * @param {string} text
   * @param {string} [name] 新集合名；空则用文件名之外的一个默认名
   * @param {Array}  [index] 站点索引：有它才认得出哪些 id 真的存在
   */
  function importText(text, name, index) {
    var src = String(text == null ? "" : text).split(/\r?\n/);
    var known = null;
    var list = index || window.SITE_INDEX || [];
    if (list && list.length) {
      known = {};
      list.forEach(function (p) { known[p.id] = p; });
    }
    var ids = [];
    var seen = {};
    var dropped = 0;
    src.forEach(function (line) {
      var t = String(line).trim();
      if (!t || t.charAt(0) === "#") return;      // 说明行 / 空行
      var id = t.split(/\s+/)[0];
      if (!id) return;
      // 索引齐备时只收真实存在的条目：贴错一个 id 不该凭空多出一条
      // 「没有正文的空壳」在今日任务里占位。索引不在（首页之外的页面）
      // 只能照收 —— 那几页拿不到全站 id 清单。
      if (known && !known[id]) { dropped += 1; return; }
      if (seen[id]) return;
      seen[id] = true;
      ids.push(id);
    });

    var snapshots = window.SITE_INDEX || [];
    var col = {
      id: uid(),
      name: cleanName(name || DEFAULT_NAME),
      createdAt: now(),
      items: ids.map(function (id) {
        return { id: id, snap: snapshotOf(id, snapshots) };
      })
    };
    var data = read();
    data.collections.push(col);
    write(data);
    return { collection: col, added: col.items.length, dropped: dropped };
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
    // 顺序（Issue #69 后续）：集合的顺序就是数组顺序，用户自己排
    moveItem: moveItem,
    moveUp: moveUp,
    moveDown: moveDown,
    removeGroup: removeGroup,
    exportText: exportText,
    importText: importText,
    removeEverywhere: removeEverywhere,
    collectionsOf: collectionsOf,
    has: has,
    allEntries: allEntries,
    snapshotOf: snapshotOf,
    // 显示名去掉「其一 / 其二」（只改显示，不改 id）
    displayTitle: displayTitle,
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
      // 写库时 write() 已经派发过「集合内容变了」；这一条是**另一种**通知：
      // 「快照刷新过了」。两者的处理不同 —— 内容变了要重排今日任务，
      // 只刷了快照则不必（题目没换、篇目没增删，排期一个字都不用动），
      // 但列表仍要重画，否则屏幕上还是旧题名（Issue #69 后续）。
      if (n) {
        try {
          window.dispatchEvent(new CustomEvent("recite-snapshots-refresh", {
            detail: { refreshed: n }
          }));
        } catch (e) { /* 无 CustomEvent 的环境忽略 */ }
      }
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
