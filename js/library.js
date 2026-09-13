/**
 * 课外阅读入口页（/library/）
 * ==========================================================================
 * 这一页不读文章，只做一件事：**把四部集子摆出来让你挑**。
 *
 * 为什么要有这一页：
 *   底部页签那一行每格只有两三个字，装得下「设置」，装不下
 *   「古文观止」这类书名 —— 以前只在页签上写「小古文」，
 *   于是另外三部集子（唐诗 / 宋词 / 古文观止）虽然做完了，却没有入口。
 *   现在页签写「课外」（短、且不偏向任何一部），点进来这一页把四部
 *   连同各自篇数一次列清，再各自进自己的索引页。
 *
 * 篇数从 data/site-index.js 实时算，不写死：
 *   日后哪一部增补了篇目（例如某部集子先收一部分、后来补齐），
 *   这一页的数字自动跟上，不会出现「卡片写 100 篇、点进去 155 篇」。
 */
(function () {
  "use strict";

  /** 四部集子的入口说明：顺序即页面上的排布顺序（按篇幅由短到长） */
  var ENTRIES = [
    {
      id: "classic",
      name: "课外必背小古文",
      short: "小古文",
      page: "/classic/",
      unit: "篇",
      desc: "蒙学识字、寓言故事到诸子论道，百字上下，最适合起步"
    },
    {
      id: "tangshi",
      name: "唐诗三百首",
      short: "唐诗",
      page: "/tangshi/",
      unit: "首",
      desc: "按卷一至卷八编排：五言古诗、七言乐府、律诗、绝句"
    },
    {
      id: "songci",
      name: "宋词三百首",
      short: "宋词",
      page: "/songci/",
      unit: "首",
      desc: "按词牌分组，一调之下诸家并列，可直接比对同调之作"
    },
    {
      id: "guwen",
      name: "古文观止",
      short: "古文",
      page: "/guwen/",
      unit: "篇",
      desc: "十二卷自周文至明文，历代文章的选本经典"
    }
  ];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /** 取某一部已收录的篇数（从总索引算，排除「集子自身」那一条） */
  function countOf(bookId) {
    var idx = window.SITE_INDEX || [];
    return idx.filter(function (p) { return p.book === bookId && !p.isBook; }).length;
  }

  function render() {
    var grid = document.getElementById("library-grid");
    if (!grid) return;
    var html = "";
    ENTRIES.forEach(function (it) {
      var n = countOf(it.id);
      html +=
        '<a class="library-card" href="' + it.page + '" data-book="' + it.id + '">' +
        '<span class="library-card-head">' +
        '<span class="library-card-name">' + esc(it.name) + "</span>" +
        '<span class="library-card-count">' + n + " " + it.unit + "</span>" +
        "</span>" +
        '<span class="library-card-desc">' + esc(it.desc) + "</span>" +
        '<span class="library-card-go" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
        'stroke-linecap="round" stroke-linejoin="round"><path d="M9.4 5.6 15.8 12l-6.4 6.4"/></svg>' +
        "</span></a>";
    });
    grid.innerHTML = html;
  }

  function boot() {
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.LibraryPage = {
    entries: function () { return ENTRIES.slice(); },
    countOf: countOf
  };
})();
