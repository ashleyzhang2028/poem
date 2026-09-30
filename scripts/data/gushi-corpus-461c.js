/* ==========================================================================
   Issue #461 · 上海古诗文大会 / 阅读大赛决赛冷门篇目（第四轮）
   《古诗「非唐代」》补充 5 首 —— 宋诗 2（约客 / 山行即事）、明诗 2（观书 / 夜泉）、清诗 1（马嵬）。
   逐条拿正文与全站文本主表 + 课内各册比对，已有的略过、只按现行判重表合流。
   这份语料只存本轮真缺的正文，壳文件（data/poems-*.js）里挂 textRef 指过来。
   ========================================================================== */
(function (root) {
  "use strict";

  var POEMS = [
    {
      id: "gs-34", title: "约客", source: "《清苑斋集》",
      dynasty: "宋", author: "赵师秀", gradeGroup: "宋诗",
      text: "黄梅时节家家雨，青草池塘处处蛙。\n有约不来过夜半，闲敲棋子落灯花。",
      translation: "黄梅时节家家户户都下着雨，长满青草的池塘里处处是蛙声。\n有约的人没有来，已过了半夜，我闲来敲着棋子，看灯花落下。",
      translationSource: "public-domain"
    },
    {
      id: "gs-35", title: "观书", source: "《于忠肃集》",
      dynasty: "明", author: "于谦", gradeGroup: "元明清诗",
      text: "书卷多情似故人，晨昏忧乐每相亲。\n眼前直下三千字，胸次全无一点尘。\n活水源流随处满，东风花柳逐时新。\n金鞍玉勒寻芳客，未信我庐别有春。",
      translation: "书卷多情就像老朋友，早晚忧乐时都与我亲近。\n眼前一口气读下三千字，胸中全无一点尘俗之气。\n像活水源头一样到处充盈，像东风里的花柳一样时时更新。\n那些骑着金鞍玉勒去寻芳的人，不会相信我书斋里另有一番春天。",
      translationSource: "public-domain"
    },
    {
      id: "gs-36", title: "马嵬", source: "《小仓山房集》",
      dynasty: "清", author: "袁枚", gradeGroup: "元明清诗",
      text: "莫唱当年长恨歌，人间亦自有银河。\n石壕村里夫妻别，泪比长生殿上多。",
      translation: "不要再唱当年的《长恨歌》了，人间也自有一条隔开夫妻的银河。\n石壕村里夫妻生离死别，流的泪比长生殿上还要多。",
      translationSource: "public-domain"
    },
    {
      id: "gs-37", title: "山行即事", source: "《雪山集》",
      dynasty: "宋", author: "王质", gradeGroup: "宋诗",
      text: "浮云在空碧，来往议阴晴。\n荷雨洒衣湿，蘋风吹袖清。\n鹊声喧日出，鸥性狎波平。\n山色不言语，醒醉两般情。",
      translation: "浮云飘在碧空里，来来去去像是在商议是阴还是晴。\n荷叶上的雨点洒湿了衣裳，掠过苹草的风吹得袖子清爽。\n鹊声喧闹，太阳出来了；鸥鸟性喜亲近，水波平静。\n山色一言不发，看它的人醒着和醉着，是两种心情。",
      translationSource: "public-domain"
    },
    {
      id: "gs-38", title: "夜泉", source: "《珂雪斋集》",
      dynasty: "明", author: "袁中道", gradeGroup: "元明清诗",
      text: "山白鸟忽鸣，石冷霜欲结。\n流泉得月光，化为一溪雪。",
      translation: "山头泛白，鸟儿忽然叫了一声，石头清冷，霜快要凝结。\n流动的泉水得到月光，化成了一溪白雪。",
      translationSource: "public-domain"
    },
  ];

  root.GUSHI_CORPUS_461C = POEMS;
})(typeof window !== "undefined" ? window : globalThis);
