(function () {
  "use strict";

  var BOOKS = (typeof window !== "undefined" && window.SITE_BOOKS_DEF) || [];
  if (!BOOKS.length) throw new Error("data/site-books.js 必须先于 data/site-index.js 加载");

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
          gloss: p.gloss || "",
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

  window.buildSiteIndex = buildSiteIndex;

  window.SITE_INDEX = buildSiteIndex();
})();
