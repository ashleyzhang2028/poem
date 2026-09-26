(function () {
  "use strict";

  var BOOKS = [
    { id: "poems", name: "课内诗词", page: "/", varName: "POEMS_ALL", unit: "首" },
    { id: "classic", name: "课外必背小古文", page: "/classic/", varName: "POEMS_CLASSIC", unit: "篇" },
    { id: "yuefu", name: "乐府集", page: "/yuefu/", varName: "POEMS_YUEFU", unit: "首" },
    { id: "tangshi", name: "唐诗三百首", page: "/tangshi/", varName: "POEMS_TANGSHI", unit: "首" },
    { id: "songci", name: "宋词三百首", page: "/songci/", varName: "POEMS_SONGCI", unit: "首" },
    { id: "yuanqu", name: "元曲三百首", page: "/yuanqu/", varName: "POEMS_YUANQU", unit: "首" },
    { id: "guwen", name: "古文观止", page: "/guwen/", varName: "POEMS_GUWEN", unit: "篇" },
    { id: "jinxiandai", name: "近现代诗词", page: "/jinxiandai/", varName: "POEMS_JINXIANDAI", unit: "首" },
    { id: "zhaoming", name: "昭明文选", page: "/zhaoming/", varName: "POEMS_ZHAOMING", unit: "篇" },
    { id: "chengyu", name: "中华成语故事", page: "/chengyu/", varName: "POEMS_CHENGYU", unit: "则" },
    { id: "changshi", name: "文学常识", page: "/changshi/", varName: "POEMS_CHANGSHI", unit: "条" }
  ];

  function buildSiteIndex(extra) {
    var opt = extra || {};
    var out = [];

    BOOKS.forEach(function (b) {
      var list = opt[b.id] || (typeof window !== "undefined" ? window[b.varName] : null);
      if (!list || !list.length) return;
      list.forEach(function (raw) {

        var p = (typeof window.masterTextOf === "function")
          ? window.masterTextOf(raw, b.id) : raw;

        var NEED_TRANS = ["guwen", "yuanqu", "zhaoming", "yuefu", "jinxiandai", "chengyu"];
        if (NEED_TRANS.indexOf(b.id) >= 0 && (!p.text || !p.translation)) return;
        // 文学常识是词条式：正文即释义，本就没有白话译文，只要求有正文
        if (b.id === "changshi" && !p.text) return;
        out.push({
          id: b.id + "-" + p.id,
          originId: p.id,
          title: p.title,
          author: p.author || "",

          authorName: p.authorName || "",
          dynasty: p.dynasty || "",
          source: p.source || "",

          selection: p.selection || "",
          meaning: p.meaning || "",
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

  var SITE_BOOKS = BOOKS.map(function (b) {
    return { id: b.id, name: b.name, page: b.page, unit: b.unit };
  });

  window.buildSiteIndex = buildSiteIndex;
  window.SITE_BOOKS = SITE_BOOKS;

  window.SITE_INDEX = buildSiteIndex();
})();
