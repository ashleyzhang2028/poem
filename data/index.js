/* 诗词总索引：按年级聚合 */
(function () {
  const groups = [
    window.POEMS_1, window.POEMS_2, window.POEMS_3, window.POEMS_4,
    window.POEMS_5, window.POEMS_6, window.POEMS_7, window.POEMS_8,
    window.POEMS_9, window.POEMS_10, window.POEMS_11, window.POEMS_12
  ];
  const all = [];
  groups.forEach(function (g, i) {
    (g || []).forEach(function (raw) {
      // 正文收归主表（Issue #69 收尾）：课内这 12 册里被主表收编的条目
      // 已摘掉内联正文、只留 textRef，这里按它取回，再交出去 ——
      // 上层（排程、复习、朗读、列表）拿到的仍是**带正文的条目**，
      // 不必知道正文是从哪一份存的。取数走 data/text-master.js 的
      // window.masterTextOf（各消费方共用同一个入口）。
      var p = (typeof window.masterTextOf === "function")
        ? window.masterTextOf(raw, "poems") : raw;
      p.grade = i + 1;
      all.push(p);
    });
  });
  window.POEMS_ALL = all;

  window.GRADE_NAMES = {
    1: "一年级", 2: "二年级", 3: "三年级", 4: "四年级",
    5: "五年级", 6: "六年级", 7: "七年级", 8: "八年级",
    9: "九年级", 10: "高一", 11: "高二", 12: "高三"
  };

  window.PRIMARY_GRADES = [1, 2, 3, 4, 5, 6];
  window.MIDDLE_GRADES = [7, 8, 9];
  window.HIGH_GRADES = [10, 11, 12];

  window.getPoemsByGradeTerm = function (grade, term) {
    return window.POEMS_ALL.filter(function (p) {
      return p.grade === Number(grade) && p.term === Number(term);
    });
  };

  /* ------------------------------------------------------------------
     译文来源标注
     ------------------------------------------------------------------
     白话译诗没有法定教科书版本，教材本身只给原文与注释，市面上的
     《XX 全解》都是各家编者的演绎。所以这里不宣称「以教师用书为准」，
     而是逐首标出真实可追溯的口径，四类取值见 data/poems-*.js 的
     translationSource 字段（由 scripts/tag-translation-source.js 写入）。

     界面上只在译文框下方显示一行小字，不做弹窗、不做链接：
     用户看得见「这段译文是怎么来的」，就够了。
     ------------------------------------------------------------------ */
  window.TRANSLATION_SOURCES = {
    "academic": "依据《唐诗鉴赏辞典》《宋词鉴赏辞典》等工具书的通行讲法",
    "school": "依据统编版教材与教师用书课后释义",
    "public-domain": "原文属公有领域，依据公认注本与通行译注",
    "modern": "依据现行通用选本与通行讲法"
  };

  /** 取某首（篇）的译文来源说明；没标注或取值不认识就返回空串 */
  window.translationSourceText = function (p) {
    if (!p) return "";
    return window.TRANSLATION_SOURCES[p.translationSource] || "";
  };
})();
