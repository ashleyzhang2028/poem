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

  function boot() {
    if (!window.ReaderEngine) return;
    var all = window.CLASSIC_ALL || window.POEMS_CLASSIC || [];
    if (!all.length) {
      var listEl = document.querySelector('[data-gw="list"]');
      if (listEl) listEl.innerHTML = '<div class="empty">小古文数据加载失败</div>';
      return;
    }

    window.ReaderEngine.mount({
      id: "classic",
      items: all,
      root: "[data-gw-root]",
      reader: "#gw-reader",
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
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
