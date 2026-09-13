/* ==========================================================================
   站点篇目总索引（Issue #69 · 基础架构变更）
   --------------------------------------------------------------------------
   把站上**所有**可读篇目汇成一张表，供「搜索」页一次搜全站：
     课内诗词一至高三（window.POEMS_ALL）+ 课外必背小古文（window.POEMS_CLASSIC）
     + 唐诗三百首 + 宋词三百首 + 古文观止 + 昭明文选
     + 各自集子自身（title 命中，用来搜「唐诗三百首」这种集子名）

   为什么单独一个文件、而不是让搜索页去挨个读 window 上的变量：
     · 读法只有一处，加一部新集子时只改这里；
     · 每个条目都带齐「我从哪来」（book / bookName / page），
       搜索结果才能标出「这一篇出自哪一部」并跳到正确的页面；
     · 不做成「搜索时才拼」：拼装过程里任何一部数据缺失都会被静默跳过，
       那样用户看到的不是报错，而是「少了一批结果」——最难查的那种错。

   字段（一条 = 一篇）：
     id       全站唯一（集子前缀 + 原 id / 年级id），避免两部集子撞 id
     title    篇名
     author   作者（选本题署，多为「字」）
     authorName 常用姓名（与 author 不同时另存，供搜索）
     dynasty  朝代
     source   出处（书名 / 词牌选本名）
     book     所属集子 id（poems / classic / tangshi / songci / guwen / zhaoming）
     bookName 集子显示名（搜索页用来标来源）
     page     该集子索引页的地址（点结果直接跳过去）
     grade / term  仅课内诗词有：年级 / 学期
     text / translation  正文与译文（搜索命中用，也便于直接预览）
   ========================================================================== */
(function () {
  "use strict";

  /** 六部集子：id / 显示名 / 索引页地址 / 数据在 window 上的变量名 */
  var BOOKS = [
    { id: "poems", name: "课内诗词", page: "/", varName: "POEMS_ALL", unit: "首" },
    { id: "classic", name: "课外必背小古文", page: "/classic/", varName: "POEMS_CLASSIC", unit: "篇" },
    { id: "tangshi", name: "唐诗三百首", page: "/tangshi/", varName: "POEMS_TANGSHI", unit: "首" },
    { id: "songci", name: "宋词三百首", page: "/songci/", varName: "POEMS_SONGCI", unit: "首" },
    { id: "guwen", name: "古文观止", page: "/guwen/", varName: "POEMS_GUWEN", unit: "篇" },
    // 昭明文选：按**文体**分三十九类（赋 / 诗 / 骚 / 七 / 诏 / 册……），
    // 与其余四部的分类口径都不同，见 js/zhaoming.js 的文件头。
    { id: "zhaoming", name: "昭明文选", page: "/zhaoming/", varName: "POEMS_ZHAOMING", unit: "篇" }
  ];

  /**
   * 组装全站索引。
   * @param {Object} [extra] 可覆盖 / 追加数据源：{ tangshi: [...] } 用来在
   *   某部集子尚未发布时先拿测试数据顶上（搜索页自己也是这么挂的）。
   * @returns {Array} 全部篇目（含集子自身一条）
   */
  function buildSiteIndex(extra) {
    var opt = extra || {};
    var out = [];

    BOOKS.forEach(function (b) {
      var list = opt[b.id] || (typeof window !== "undefined" ? window[b.varName] : null);
      if (!list || !list.length) return;
      list.forEach(function (p) {
        // 还没有正文 / 译文的篇目（标着「待补」的那些）不进全站搜索索引：
        // 搜到一条点进去只有提示，等于把「尚未整理」变成用户的一次白跑。
        // 它们在各自集子的列表里仍然可见。
        //   · 《古文观止》：166 篇已全部收齐，目前不会命中这条；
        //   · 《昭明文选》：原文 480 篇全收，但白话译文只整理了 29 篇名篇，
        //     其余 451 篇走这条 —— 「搜得到篇名、点进去却只有一句提示」
        //     正是要避免的那种白跑。
        if ((b.id === "guwen" || b.id === "zhaoming") && (!p.text || !p.translation)) return;
        out.push({
          id: b.id + "-" + p.id,
          originId: p.id,
          title: p.title,
          author: p.author || "",
          // authorName：选本题署多为「字」（《昭明文选》署「王仲宣」），
          // 这一栏是常用姓名（「王粲」），供搜索与辨认
          authorName: p.authorName || "",
          dynasty: p.dynasty || "",
          source: p.source || "",
          // selection：这一篇「从哪本选里读到」（如《古文观止》）。
          // 与 source（真实出处：《左传》《震川先生集》等）分开带出去，
          // 否则搜索结果里会把「选集名」当成「出处」标错（Issue #69 收尾）。
          selection: p.selection || "",
          grade: p.grade,
          term: p.term,
          gradeGroup: p.gradeGroup || "",
          text: p.text || "",
          translation: p.translation || "",
          translationSource: p.translationSource,
          book: b.id,
          bookName: b.name,
          page: b.page
        });
      });
      // 集子自身也作为一条结果：用户搜「唐诗三百首」时应当能直接进那一页
      out.push({
        id: b.id + "-__book__",
        title: b.name,
        author: "",
        dynasty: "",
        source: b.name + "（共 " + list.length + " " + b.unit + "）",
        text: "",
        translation: "",
        book: b.id,
        bookName: b.name,
        page: b.page,
        isBook: true
      });
    });

    return out;
  }

  /** 六部集子的清单（搜索页用来分组、标注来源） */
  var SITE_BOOKS = BOOKS.map(function (b) {
    return { id: b.id, name: b.name, page: b.page, unit: b.unit };
  });

  window.buildSiteIndex = buildSiteIndex;
  window.SITE_BOOKS = SITE_BOOKS;
  // 数据文件按需加载：三部大集子还没进页面时，这一份只含课内诗词与小古文，
  // 加载之后由搜索页重新调用 buildSiteIndex() 取新的（见 js/search.js）
  window.SITE_INDEX = buildSiteIndex();
})();
