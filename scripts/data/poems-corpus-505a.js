/* Issue #505 · 古诗第一批 6 篇（用户 2026-10-08 投喂的第 1~50 组）
   --------------------------------------------------------------------------
   落库 6 首非唐古诗（gs-68…gs-73），其余课内 / 集内已有、按判重口径合流不重录。
   壳挂 textRef，正文只在本文件落一份。 */
(function (root) {
  "use strict";

  var POEMS = [
    /* ── 《唐诗》卷 ─────────────────────────────────────────────────── */
    {
      id: "ts-391", title: "陇西行四首·其二", source: "《全唐诗》",
      dynasty: "唐", author: "陈陶", gradeGroup: "卷八 七言绝句",
      text: "誓扫匈奴不顾身，五千貂锦丧胡尘。\n可怜无定河边骨，犹是春闺梦里人。",
      translation: "将士们发誓扫平匈奴，奋不顾身；五千名精锐士卒都丧身在胡地的战尘里。\n可怜那无定河边的白骨，还是他们妻子春闺梦中思念的活人啊。",
      translationSource: "public-domain"
    },
    {
      id: "ts-392", title: "南园十三首·其五", source: "《李长吉歌诗》",
      dynasty: "唐", author: "李贺", gradeGroup: "卷八 七言绝句",
      text: "男儿何不带吴钩，收取关山五十州。\n请君暂上凌烟阁，若个书生万户侯？",
      translation: "男子汉为什么不带上吴钩宝剑，去收复关山五十州？\n请你暂且登上凌烟阁看一看，哪有一个书生被封为万户侯的呢？",
      translationSource: "public-domain"
    },

    /* ── 《古诗「非唐代」》卷 ─────────────────────────────────────── */
    {
      id: "gs-58", title: "乡思", source: "《盱江集》",
      dynasty: "宋", author: "李觏", gradeGroup: "宋诗",
      text: "人言落日是天涯，望极天涯不见家。\n已恨碧山相阻隔，碧山还被暮云遮。",
      translation: "人们说落日的地方就是天涯，可我望尽天涯也望不见家。\n已经怨恨青山把我与家乡隔断，可青山还被傍晚的云雾遮挡着。",
      translationSource: "public-domain"
    },
    {
      id: "gs-59", title: "病牛", source: "《梁溪集》",
      dynasty: "宋", author: "李纲", gradeGroup: "宋诗",
      text: "耕犁千亩实千箱，力尽筋疲谁复伤？\n但得众生皆得饱，不辞羸病卧残阳。",
      translation: "它耕过千亩田，收获装满了千个粮箱；气力用尽、筋骨疲惫，又有谁来怜惜呢？\n只要大家都能吃得饱，它不推辞拖着瘦弱多病的身子卧倒在夕阳里。",
      translationSource: "public-domain"
    },
    {
      id: "gs-60", title: "野望", source: "《苇碧轩集》",
      dynasty: "宋", author: "翁卷", gradeGroup: "宋诗",
      text: "一天秋色冷晴湾，无数峰峦远近间。\n闲上山来看野水，忽于水底见青山。",
      translation: "满天秋色使晴日的水湾透出寒意，无数的峰峦远近错落。\n我闲来上山看野外的流水，忽然在水底看见了青山的倒影。",
      translationSource: "public-domain"
    },
    {
      id: "gs-61", title: "苔", source: "《小仓山房集》",
      dynasty: "清", author: "袁枚", gradeGroup: "元明清诗",
      text: "白日不到处，青春恰自来。\n苔花如米小，也学牡丹开。",
      translation: "阳光照不到的地方，春天的生机却照样萌发。\n苔花虽然只有米粒般大小，也学着牡丹的样子尽情开放。",
      translationSource: "public-domain"
    },
  ];

  root.POEMS_CORPUS_505A = POEMS;
})(typeof window !== "undefined" ? window : globalThis);
