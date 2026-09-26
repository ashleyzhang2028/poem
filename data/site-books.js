(function () {
  "use strict";

  var BOOKS = [
    { id: "poems", name: "课内诗词", page: "/", varName: "POEMS_ALL", unit: "首" },
    { id: "classic", name: "小古文", page: "/classic/", varName: "POEMS_CLASSIC", unit: "篇" },
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

  window.SITE_BOOKS_DEF = BOOKS;
  window.SITE_BOOKS = BOOKS.map(function (b) {
    return { id: b.id, name: b.name, page: b.page, unit: b.unit };
  });
})();
