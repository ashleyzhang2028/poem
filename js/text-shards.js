/* ==========================================================================
   正文分片按需加载（Issue #550）
   --------------------------------------------------------------------------
   正文主表按集子切成 15 片（data/text-master/*.js），原先各页用 `<script src>`
   全量同步拉下来 —— 首页已改成只引课内那一片，但 `library/` 26 MB、
   `search/` 5.5 MB 仍是这个数。这一层把片改成**用到才取**：

     · library/：首屏只铺集子目录与计数（壳里的索引字段就够），
       点开某一部的详情时才取那一片；
     · search/：命中先按索引字段出（篇名 / 作者 / 朝代 / 出处），
       要搜正文时再取全部分片。

   取回来的片用 `window.textMasterAdd` 并进主表 —— 与 `<script src>` 拉的
   是同一个入口，所以装配期、详情页、搜索看到的形状一模一样。

   ⚠️ 片是后到的，主表取数入口的索引必须跟着作废（`textMasterAdd` 里已调
      `textMasterReset`），否则后到的片查不到、正文空白且不报错。

   ⚠️ **片到了必须重建 `SITE_INDEX`**：`data/site-index.js` 装配时会丢掉
      「正文 / 译文为空」的条目（古文、古文观止那一批），片没到就装配，
      这些条目**根本不在索引里** —— 列表短一截、搜索少一大批，界面都
      不报错。这里在片到齐后由 `rebuildIndex()` 重跑一遍装配。

   ⚠️ 同一片只取一次，失败不缓存（`.catch` 里把在途记录删掉，下次可重试）。
     断网且未缓存时如实失败 —— 调用方据此给提示，不假装有正文。
   ========================================================================== */
(function () {
  "use strict";

  var DIR = "/data/text-master/";

  var pending = {};

  var done = {};

  function load(book) {
    if (!book) return Promise.reject(new Error("缺少集子 id"));
    if (loaded(book)) return Promise.resolve(true);
    if (pending[book]) return pending[book];

    var url = DIR + book + ".js";
    pending[book] = fetch(url, { credentials: "same-origin" })
      .then(function (res) {
        if (!res || !res.ok) throw new Error("正文分片加载失败：" + url + "（HTTP " + (res && res.status) + "）");
        return res.text();
      })
      .then(function (code) {
        /* 片是自足的 IIFE（`window.textMasterAdd([...])`），与 `<script src>`
           执行的是同一段代码 —— 用 new Function 走一遍，作用域同全局。
           ⚠️ 这里**不 eval 用户输入**：取的只有本站自己的生成文件。 */
        new Function(code)();
        done[book] = true;
        delete pending[book];
        rebuildIndex();
        notify();
        return true;
      })
      .catch(function (err) {
        delete pending[book];
        throw err;
      });

    return pending[book];
  }

  function all() {
    var list = window.TEXT_SHARD_BOOKS || [];
    return Promise.all(list.map(function (b) {
      return load(b).catch(function () { return false; });
    }));
  }

  /* 这一部的片在不在。

     ⚠️ **只认「本层真取过 / 页面显式声明过」，不去猜**：想从主表反推是
     反推不出来的 —— 《唐诗》那一片里有一批跨部的行（`id` 是
     `poems-cz7-02`、`entries` 里带着 `tangshi-ts-413`），反过来课内那一片
     也带着 `tangshi-*` 的 entries。按「主表里有没有 tangshi- 的 id」判，
     课内片一到就会把「唐诗片已到」判成真 —— 于是唐诗那 364 条正文的搜索
     静默少一大批。宁可多取一次（同一 URL 走 SW 缓存），也不猜。 */
  function loaded(book) { return !!done[book]; }

  /* 片到之后重跑一遍站点索引装配，**并且把「同一份索引」那几处跟着换掉**。

     ⚠️ 只在**本页引了装配脚本**时做（`data/site-index.js` 暴露 `buildSiteIndex`）；
     没引的页（首页 / 集子页）跳过 —— 它们的 `POEMS_ALL` 由 `data/index.js` 管，
     那边的取数入口在 `masterTextOf` 上，片一到就自动查得到。

     ⚠️ 「把索引重算一遍」与「各消费方拿到的是新那一份」是两件事。重建出
     一个**新的数组**只换掉 `window.SITE_INDEX` 这个变量，而底下这几处都
     攥着**旧那一份**（`data/author-index.js` 的 `raw`、`data/works-index.js`
     的 `BY_ENTRY`……）—— 它们在装配那一刻就把条目摊平收好了：
       · 作者名册：`raw` 里那些条目正文是空的 → 名册里点谁进谁那一页，
         列表每行挂着「待补」、详情页写「本篇原文尚在整理中」；
       · 判重表：按旧那份算出的 `wid` 与「谁代表这一篇」双双过期。
     重建之后**逐个重新装配**（各表自己的 `rebuild` 口子），一把换齐。

     ⚠️ 次序：索引先，然后才是从它派生出来的那些（作者名册、判重表）。 */
  function rebuildIndex() {
    if (typeof window.buildSiteIndex !== "function") return;
    window.SITE_INDEX = window.buildSiteIndex();

    if (window.WorksIndex && typeof window.WorksIndex.rebuild === "function") {
      window.WorksIndex.rebuild(window.SITE_INDEX);
    }
    if (typeof window.rebuildSiteTables === "function") window.rebuildSiteTables();
  }

  var listeners = [];

  function notify() {
    listeners.slice().forEach(function (fn) {
      try { fn(); } catch (e) { /* 订阅方自己的错不该拖垮取片流程 */ }
    });
  }

  window.TextShards = {
    /* 这一页该取的片 = 片清单 ∩（`varName` 真有值的那些壳）。

       ⚠️ **不按 id 反查**：集子清单里那两个名字不是一回事 ——
       片名是「正文按集子分片」的片名（`mingren` / `dwang`），
       集子 id 是页面上那一部（`mingren-waiguo` 那份壳、`refPrefix` 才是片名）。
       拿 id 去片清单里对，外国那两卷会被判成「本页没有它的片」而不取，
       点进《名家「外国」》就是永远挂着不显示（`mount` 里同步取数的那一路
       要等片到）—— 而且不报错。

       也不按「本页引了哪几片」反推：课内那一课（`index.html`）用
       `<script src>` 同步引过 `data/text-master/poems.js`，页面里没有
       一句 `TextShards` 的声明 —— 反推就把课内那一片漏了。 */
    books: function () {
      var all = window.TEXT_SHARD_BOOKS || [];
      var shells = window.TextShards.shellBooks();
      return all.filter(function (b) { return shells.indexOf(b) >= 0; });
    },
    need: load,
    /* 页面用 `<script src>` 同步引过某一片时声明一下（`index.html` 那一路）——
       免得同一片再 fetch 一遍。 */
    mark: function (book) { if (book) done[book] = true; },

    /* 本页真挂了壳（`data/poems-<...>.js`）的那几部 —— 片清单里与它取交集，
       就是「这一页该取的片」。各页不各写一份 8 行、10 行、15 行的硬编码：
       加一部集子时只往 `data/site-books.js` 添一行。

       判「壳在不在」用 `varName`，**不用 `id !== 片名` 去反查片清单** ——
       同一部集子在两处的名字并不总是同一个（见下面 `books()` 的说明）。 */
    shellBooks: function () {
      var defs = (typeof window !== "undefined" && window.SITE_BOOKS_DEF) || [];
      var out = [];
      defs.forEach(function (d) {
        if (d && window[d.varName]) out.push(d.refPrefix || d.id);
      });
      return out;
    },
    needAll: all,
    loaded: loaded,
    allLoaded: function () {
      var list = window.TEXT_SHARD_BOOKS || [];
      return list.length > 0 && list.every(loaded);
    },
    /* 片到一片调一次 —— 订阅方拿它把「按正文算出来的东西」重算一遍
       （搜索页的字段缓存 / 当前查询）。返回一个退订函数。 */
    onArrive: function (fn) {
      if (typeof fn !== "function") return function () {};
      listeners.push(fn);
      return function () {
        var i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    }
  };
})();
