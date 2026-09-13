/* 诗词总索引：按年级聚合 */
(function () {
  const groups = [
    window.POEMS_1, window.POEMS_2, window.POEMS_3, window.POEMS_4,
    window.POEMS_5, window.POEMS_6, window.POEMS_7, window.POEMS_8,
    window.POEMS_9, window.POEMS_10, window.POEMS_11, window.POEMS_12
  ];
  const all = [];
  groups.forEach(function (g, i) {
    (g || []).forEach(function (p) {
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
    "academic": "依据《唐诗鉴赏辞典》《宋词鉴赏辞典》等工具书的通行讲法，由本项目整理为白话直译",
    "school": "依据统编版教材与教师用书课后释义，由本项目整理为白话直译",
    "public-domain": "原文属公有领域，依据公认注本与通行译注，由本项目整理为白话直译",
    "modern": "依据现行通用选本与通行讲法，由本项目整理为白话直译"
  };

  /** 取某首（篇）的译文来源说明；没标注或取值不认识就返回空串 */
  window.translationSourceText = function (p) {
    if (!p) return "";
    return window.TRANSLATION_SOURCES[p.translationSource] || "";
  };
})();
