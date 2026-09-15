/**
 * 小古文（/classic/ · 课外必背 100 篇）
 * ==========================================================================
 * 这个文件现在很薄：它只做三件事 ——
 *   1. 把《课外必背小古文》这**一部集子**的配置交给 js/reader-core.js 的
 *      ReaderEngine.mount()：数据、分类顺序、文案、已读存的键名。
 *   2. 「已读」进度由引擎统一维护；本页不再自己管 localStorage。
 *   3. 保留少量页面级的收尾（标题第二行、注音档位随设置变化）。
 *
 * 为什么清单会这么短：
 *   列表、搜索、筛选、阅读器、上一篇 / 下一篇、随机连读、注音、字号、对齐、
 *   「标记已读」这一整套，原先都写在 js/classic.js 里。现在要装进四部典籍
 *   （小古文 / 唐诗三百首 / 宋词三百首 / 古文观止）再加一个全站搜索页，
 *   五份各抄一遍必然走样，于是把它们整体提到了 js/reader-core.js ——
 *   本文件只剩「这一部是什么」。
 *
 * ⚠️ 本页所有篇目共用一个已读键 poem_classic_read_v1：
 *    它从第一版小古文就在用，改键名等于把用户已经点亮的「已读」全清空，
 *    所以即便引擎换了，这个键名一个字都不能动。
 */
(function () {
  "use strict";

  /** 分类顺序：按「先蒙学识字 → 再故事寓言 → 再神话 → 再写人记事 → 再诸子论道」的
      认知顺序排，而不是照抄某一本教材的目录。 */
  var GROUP_ORDER = [
    "蒙学经典",
    "寓言故事",
    "神话传说",
    "人物故事",
    "志人逸事",
    "治学勤读",
    "山水游记",
    "诸子论道"
  ];

  /**
   * 这一部的**挂载配置**（不含数据与 DOM 根）。
   *
   * 单独拎出来，是因为同一部集子有两个入口：
   *   1. 直接打开本页（下面的 boot()）；
   *   2. 在课外阅读入口页 /library/ 里点开这一部，把索引**就地**铺上来
   *      （见 js/library.js 的 enterBook）。
   * 两处必须挂**同一份配置**：分组顺序、页名、文案、已读键名（poem_classic_read_v1）
   * 一个都不能不一样 —— 各写一份迟早出现「同一部集子两个样子」的病
   * （从这一页进去显示 N 篇、从入口页进去少几篇），而且两处都「看起来对」，最难查。
   */
  function bookConfig() {
    return {
      id: "classic",
      groupOrder: GROUP_ORDER,
      // 页面名与 <title> 口径：与 /guwen/、/tangshi/、/songci/ 一致，用**全名** ——
      // 「小古文」是页签上的短名（装不下全名），顶栏与 <title> 放得下就该写全。
      pageTitle: "课外必背小古文",
      pageSub: "想读哪篇点哪篇",
      words: {
        list: "小古文",
        unit: "篇",
        loadingFailed: "小古文数据加载失败",
        empty: "没有匹配的小古文",
        matchGroup: "课外必背",
        backToList: "返回小古文列表",
        readStore: "poem_classic_read_v1",
        playerTitle: "小古文朗读"
      }
    };
  }

  function boot() {
    if (!window.ReaderEngine) return;
    var all = window.CLASSIC_ALL || window.POEMS_CLASSIC || [];
    if (!all.length) {
      var listEl = document.querySelector('[data-gw="list"]');
      if (listEl) listEl.innerHTML = '<div class="empty">小古文数据加载失败</div>';
      return;
    }

    var cfg = bookConfig();
    cfg.items = all;
    cfg.root = "[data-gw-root]";
    cfg.reader = "#gw-reader";
    window.ReaderEngine.mount(cfg);
  }

  /* 课外阅读入口页（/library/）就地铺这一部时用它取数据与配置 */
  window.ClassicBook = {
    config: bookConfig,
    items: function () { return window.POEMS_CLASSIC || []; }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
