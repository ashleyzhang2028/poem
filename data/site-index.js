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

    { id: "zhaoming", name: "昭明文选", page: "/zhaoming/", varName: "POEMS_ZHAOMING", unit: "篇" }
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

        if ((b.id === "guwen" || b.id === "yuanqu" || b.id === "zhaoming") &&
            (!p.text || !p.translation)) return;
        out.push({
          id: b.id + "-" + p.id,
          originId: p.id,
          title: p.title,
          author: p.author || "",

          authorName: p.authorName || "",
          dynasty: p.dynasty || "",
          source: p.source || "",

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
