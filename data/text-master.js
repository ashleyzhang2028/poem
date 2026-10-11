/* ==========================================================================
   正文存储主表（同一篇作品的正文 / 译文只落一份）
   --------------------------------------------------------------------------
   由 scripts/build-text-master.js 离线算出，共 5464 条；
   正文按集子分片落在 data/text-master/，本文件只留取数入口。

   ⚠️ 这是**生成文件**，改动请改 scripts/build-text-master.js 后重跑，
      不要手改这里 —— 下次重新生成会把手工改动覆盖掉。

   ## 它解决什么
   同一篇作品（《答谢中书书》课内八年级上 + 小古文、《登高》课内高一上 +
   唐诗卷五……）此前在每一部集子的数据文件里**各存一份完整正文与译文**。
   显示层虽已按 data/canonical-texts.js 统一成「课本那一份」，
   但磁盘上仍是五份副本：改一处要改五处，漏一处就又不一致。

   这一份把这份文本收归**一处**；其余集子的条目退化成只存归属 ——
   条目上留 `textRef: "<主条目站点 id>"`，正文与译文
   由引擎（js/reader-core.js）按 `textRef` 到这里取。

   ## 收归范围（已收齐）
     ① 「在两部及以上集子里重复出现」的作品 —— 判重表自动收；
     ② FULL_BOOKS 点名的六部集子里**其余全部单篇**（历史声明，
        六部收齐后本表已按「凡在册且带正文的条目一律全收」执行）。
   于是：在册却还带内联正文的条目即为异常（同一个脚本里两处断言会点名）。

   ## 与另外两张表的分工
     data/works-map.js        哪些条目是**同一篇作品**（判重、搜索去重、排程合流）
     data/canonical-texts.js  显示层：同一篇**显示**用哪一份正文（收归之后已收敛为空表，
                              机制留着给日后真出现异文时用）
     data/text-master/*.js    存储层：同一篇的正文 / 译文**只落一份**（按集子分片）
   三张表由同一套口径算出（课内条目为主条目），一起重跑。

   ## 字段
     work        作品 id（与 data/works-map.js 的 wid 一致）
     id          主条目站点索引 id（`poems-cz8-02`，课内优先）
     title       主条目题名
     entries     这一篇的全部站点条目 id（含主条目自己）
     text        正文（**全站唯一一份**）
     translation 白话译文
     translationSource 译文来源
     version     内容的短摘要（版次）—— 客户端据它认出「这一条改过」，
                 好把本机存的老快照刷新掉（见 scripts/build-text-master.js）
   ========================================================================== */

/* ==========================================================================
   正文按集子分片：各片由壳文件加载后交到这里，按 id 去重合一
   --------------------------------------------------------------------------
   跨部同篇的那一行（《心术》既在《古文观止》又在《小古文》）会出现在
   两个片里 —— 两部的页面各自需要它。去重是为了让 window.TEXT_MASTER
   仍是「一行一篇」，各消费方拿到的形状与分片之前一模一样。
   页面引片的次序：本文件在前，data/text-master/<集子>.js 在后。
   ========================================================================== */
window.textMasterAdd = (function () {
  var seen = {};
  return function (rows) {
    var list = window.TEXT_MASTER = window.TEXT_MASTER || [];
    (rows || []).forEach(function (m) {
      if (!m || !m.id || seen[m.id]) return;
      seen[m.id] = true;
      list.push(m);
    });
    /* 片是**后到**的（按需 fetch 或运行时预热），而取数入口的 byId 索引
       算一次就缓存住了。不在这里作废，后到的片就永远查不到 ——
       表现是「正文空白」，不报错。 */
    if (typeof window.textMasterReset === "function") window.textMasterReset();
  };
})();

/* 正文分片的集子清单 —— 由生成器按实际落盘的片写出，唯一一份：
   js/text-shards.js 按它决定「要预取哪几片」，各页不各写一份。 */
window.TEXT_SHARD_BOOKS = ["changshi","chengyu","classic","dwang","gushi","guwen","jinxiandai","mingren","mingshu","poems","songci","tangshi","yuanqu","yuefu","zhaoming"];

/* ==========================================================================
   近重复对：同一篇却有两种写法，**故意不合并**
   --------------------------------------------------------------------------
   下面是「差不多是同一篇、但正文有一字之差」的那些对，共 0 组。
   它们**没有**被收进上面的主表 —— 因为一字之差往往不是录入出错，
   而是两条并列的文本传统：

     · 选本原貌（《文选》作「凤皇」、《古文观止》作「霪雨」）
     · 教材 / 通行字（课本作「凤凰」，今通行本作「淫雨」）

   裁定见 data/works-index.js：「课内以教材文本为准，选集以选本原貌为准，
   冲突时分成两条并列的作品，各背各的」—— 所以这里**只登记事实**，
   不去合并、也不改任何一份正文。主表收归的是「字面完全相同」的那些篇；
   这一份清单是它的边界：谁要是把这几篇也并了，学生就会读到
   与自己课本不一样的那一份《岳阳楼记》。

   ⚠️ 这是**生成文件**，改动请改 scripts/build-text-master.js 后重跑。

   字段：entries 两条（及以上）条目 id；reason 为什么它们「像同一篇而不合并」
   ========================================================================== */
window.TEXT_NEAR_DUP = [
];

/* ==========================================================================
   取数入口：把条目上的 textRef 展开成正文 / 译文
   --------------------------------------------------------------------------
   摘掉内联正文的条目只留一行 textRef，正文从这里取回。
   各消费方（站点索引、阅读引擎、搜索页……）都调这一个函数 ——
   各写一份迟早有一处忘了取，而表现只是「那一处正文空白」，不报错。

   ⚠️ 带 textRef 的条目**一律以主表为准**，哪怕它在数据文件里还内联着一份
      正文。两处各存一份就是两个真相：换正文 / 换译文时改一处忘一处，
      表现是「同一部作品在两个页面上读到两种白话」——读者只会来问哪个对
      （Issue #339 要求「精准精确」，这一条是它的落点）。

   ⚠️ 没有 textRef、或主表里查不到时**原样返回**，不做任何猜测：
      猜出来的正文比空白更糟 —— 空白一眼可见，取错一篇却看着正常。
   ========================================================================== */
(function () {
  "use strict";

  var byId = null;
  window.textMasterReset = function () { byId = null; };
  function map() {
    if (byId) return byId;
    byId = {};
    (window.TEXT_MASTER || []).forEach(function (m) {
      if (!m) return;
      if (m.id) byId[m.id] = m;
      (m.entries || []).forEach(function (e) { if (e && !byId[e]) byId[e] = m; });
    });
    /* Issue #399（历代名家真拆两部）：两卷各出一份壳，正文仍只有一份
       （同一个人不抄两遍）。两份壳的主表 id 已各自落在主表上，平时一条
       别名都不写；这一段是**兜底** —— 万一主表里只有上一轮的老 id
       （mingren-mr-xx）、壳却是新的（mr-c-xx / mr-w-xx），就认回来。

       ⚠️ 认法是**按姓名**，不是按 masterRef 里的号。原先写的是
       `byId[sh.masterRef]`，那一步会走到**同号的另一个条目**上：
       masterRef 的值是主表 id（mingren-mr-c-08），而主表里恰好有一个
       id 相同的别的条目（mingren-mr-11 / mingren-mr-12 …）—— 一查就
       查到了别人，静默错、不落空（#420 报的那次 413 条错位就是它）。
       按姓名认则天然对齐：壳里那一条的 title 就是正文那一条的 title。

       排序用「名 → 主表 id」的索引，**不进 byId 的键空间** —— 别名键与
       真 id 同形（都是 mingren-*），混在一起迟早被人当成真条目。
       ⚠️ 只在**查不到**时兜底，不覆盖任何实条目。 */
    (function () {
      var shells = [].concat(
        window.POEMS_MINGREN_CN || [],
        window.POEMS_MINGREN_FOREIGN || []
      );
      var pending = [];
      shells.forEach(function (sh) {
        if (!sh || !sh.textRef || !sh.title) return;
        if (byId[sh.textRef]) return;
        pending.push(sh);
      });
      if (!pending.length) return;
      var byTitle = {};
      (window.TEXT_MASTER || []).forEach(function (m) {
        if (m && m.title && !byTitle[m.title]) byTitle[m.title] = m;
      });
      pending.forEach(function (sh) {
        var m = byTitle[sh.title];
        if (m) byId[sh.textRef] = m;
      });
    })();
    return byId;
  }

  /**
   * 取这一条的正文 / 译文。
   * @param {Object} p      条目（可能带 textRef）
   * @param {String} [book] 所属集子 id —— textRef 记的是集子内 id 时补前缀再查
   * @returns {Object} 展开后的条目（无 textRef 或查不到时原样返回）
   */
  window.masterTextOf = function (p, book) {
    if (!p || !p.textRef) return p;
    var m = map()[p.textRef];
    if (!m && book) m = map()[book + "-" + p.textRef];
    if (!m) return p;
    var out = {};
    Object.keys(p).forEach(function (k) { if (k !== "text" && k !== "translation" && k !== "translationSource") out[k] = p[k]; });
    out.text = m.text || "";
    out.translation = m.translation || "";
    out.translationSource = m.translationSource || p.translationSource;
    out.version = m.version || "";
    return out;
  };

  /**
   * 取这一条的**版次**（内容摘要）。
   * @param {Object} p      条目（可能带 textRef）
   * @param {String} [book] 所属集子 id
   * @returns {String} 版次；主表里查不到时回空串（不猜）
   */
  window.textVersionOf = function (p, book) {
    if (!p || !p.textRef) return "";
    var m = map()[p.textRef];
    if (!m && book) m = map()[book + "-" + p.textRef];
    return (m && m.version) || "";
  };
})();

