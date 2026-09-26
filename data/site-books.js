// 全站集子清单 —— **唯一一份**。
//
// 这里只放清单本身（哪几部、叫什么、住在哪个地址、数据挂在哪个全局变量上），
// 不构建索引、不碰其它数据 —— 所以「考试层要一份范围名单」这种只想读清单的
// 场景可以直接加载本文件，不必把整张总索引（`data/site-index.js`）也拉进来。
//
// ⚠️ 加一部集子时改**这一处**：总索引、考试层的范围、入口页卡片都从它算。
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

  window.SITE_BOOKS_DEF = BOOKS;
  window.SITE_BOOKS = BOOKS.map(function (b) {
    return { id: b.id, name: b.name, page: b.page, unit: b.unit };
  });
})();
