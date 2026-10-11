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

  /* 片到之后重跑一遍站点索引装配。
     ⚠️ 只在**本页引了装配脚本**时做（`data/site-index.js` 暴露 `buildSiteIndex`）；
     没引的页（首页 / 集子页）跳过 —— 它们的 `POEMS_ALL` 由 `data/index.js` 管，
     那边的取数入口在 `masterTextOf` 上，片一到就自动查得到。 */
  function rebuildIndex() {
    if (typeof window.buildSiteIndex !== "function") return;
    window.SITE_INDEX = window.buildSiteIndex();
  }

  var listeners = [];

  function notify() {
    listeners.slice().forEach(function (fn) {
      try { fn(); } catch (e) { /* 订阅方自己的错不该拖垮取片流程 */ }
    });
  }

  window.TextShards = {
    books: function () { return (window.TEXT_SHARD_BOOKS || []).slice(); },
    need: load,
    /* 页面用 `<script src>` 同步引过某一片时声明一下（`index.html` 那一路）——
       免得同一片再 fetch 一遍。 */
    mark: function (book) { if (book) done[book] = true; },
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
