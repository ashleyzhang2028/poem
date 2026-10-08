/* ==========================================================================
   Issue #505 · 古诗 25 首（第二批 —— 用户 2026-10-08 投喂的第 51~100 组）
   --------------------------------------------------------------------------
   本文件放**第二批的 25 首古诗**（用户清单里的偶数号 52、54 … 100）。
   判重键 = 去空白与标点，与**全站**（课内 251 首 + 各集子 + 主表）逐条比过。

     ⚠️ 取号一个都不落：只列「落库」的那 14 条，合流的 11 条各自在别的集子
        里出场（本文件不重录、也不另挂壳）。

     全站真缺、落库 14 条（11 首唐诗入《唐诗》，3 首明 / 宋诗入《古诗「非唐代」》）：
       《唐诗》11 条（ts-402…ts-412）：
         寄外征衣（唐·陈玉兰）   新沙（唐·陆龟蒙）
         山中问答（唐·李白）     绝句四首·其三（唐·杜甫）
         新嫁娘词（唐·王建）     题菊花（唐·黄巢）
         不第后赋菊（唐·黄巢）   剑客（唐·贾岛）
         过华清宫绝句·其一（唐·杜牧） 军城早秋（唐·严武） 乐游原（唐·李商隐）
       《古诗「非唐代」》3 首（gs-72…gs-74）：
         燕子矶口占（明·史可法）  除夜太原寒甚（明·于谦）  陶者（宋·梅尧臣）

     已在全站（**按判重口径合流，不重录**，也不另挂壳）11 首 ——
     它们各自在课内 / 集内出场，本集不为它们多挂一条壳：
       赠刘景文 → poems-xx3-03   送元二使安西 → poems-xx5-23
       饮湖上初晴后雨 → poems-xx3-06   相思 → tangshi-ts-225
       题乌江亭 → tangshi-ts-388（Issue #471 第三轮刚补）
       登飞来峰 → poems-cz7-20    登鹳雀楼 → poems-xx2-03
       夜雨寄北 → poems-cz7-10    咏柳 → poems-xx2-09
       嫦娥 → poems-xx4-18        逢入京使 → poems-cz7-16
       九月九日忆山东兄弟 → poems-xx3-16   早春呈水部张十八员外 → poems-xx6-27
       江南曲 → tangshi-ts-91     十一月四日风雨大作 → poems-cz7-11（其二）
       示儿 → poems-xx5-03        秋词 → poems-cz7-09（其一）
       江雪 → poems-xx2-05        赠汪伦 → poems-xx1-08
       早梅 → tangshi-ts-338      从军行 → poems-xx5-14
       观书有感 → poems-xx5-18（其一） 出塞 → poems-xx4-04
       宿建德江 → poems-xx6-01    枫桥夜泊 → poems-xx5-07

   ⚠️ 取号：接现行末尾 —— 唐诗 ts-402 往下；古诗「非唐代」gs-72 往下。
   ⚠️ 壳文件在 data/poems-tangshi.js / data/poems-gushi.js 补，只挂 textRef。
   ========================================================================== */
(function (root) {
  "use strict";

  var POEMS = [
    /* ── 《唐诗》卷 ─────────────────────────────────────────────────── */
    {
      id: "ts-402", title: "寄外征衣", source: "《全唐诗》",
      dynasty: "唐", author: "陈玉兰", gradeGroup: "卷八 七言绝句",
      text: "夫戍边关妾在吴，西风吹妾妾忧夫。\n一行书信千行泪，寒到君边衣到无？",
      translation: "丈夫戍守边关，我留在吴地；西风吹着我，我心中忧虑丈夫。\n写一行书信就流下千行泪水 —— 严寒到了你身边时，我寄的寒衣到了没有？",
      translationSource: "public-domain"
    },
    {
      id: "ts-403", title: "新沙", source: "《甫里先生集》",
      dynasty: "唐", author: "陆龟蒙", gradeGroup: "卷八 七言绝句",
      text: "渤澥声中涨小堤，官家知后海鸥知。\n蓬莱有路教人到，应亦年年税紫芝。",
      translation: "在渤海的涛声中涨起一道小堤，官府知道后海鸥才知道。\n倘若蓬莱仙山有路能让人到达，怕也会年年被征收紫芝的税。",
      translationSource: "public-domain"
    },
    {
      id: "ts-404", title: "山中问答", source: "《李太白集》",
      dynasty: "唐", author: "李白", gradeGroup: "卷七 五言绝句",
      text: "问余何事栖碧山，笑而不答心自闲。\n桃花流水窅然去，别有天地非人间。",
      translation: "有人问我为什么栖居在碧山，我笑而不答，心里自有一份安闲。\n桃花随着流水远远流去 —— 这里另有一番天地，不是人间。",
      translationSource: "public-domain"
    },
    {
      id: "ts-405", title: "绝句四首·其三", source: "《杜工部集》",
      dynasty: "唐", author: "杜甫", gradeGroup: "卷八 七言绝句",
      text: "两个黄鹂鸣翠柳，一行白鹭上青天。\n窗含西岭千秋雪，门泊东吴万里船。",
      translation: "两只黄鹂在翠绿的柳树上鸣叫，一行白鹭飞上青天。\n窗口正对着西岭上千年不化的积雪，门外停泊着将去东吴的万里行船。",
      translationSource: "public-domain"
    },
    {
      id: "ts-406", title: "新嫁娘词", source: "《王建诗集》",
      dynasty: "唐", author: "王建", gradeGroup: "卷七 五言绝句",
      text: "三日入厨下，洗手作羹汤。\n未谙姑食性，先遣小姑尝。",
      translation: "新婚三天就下厨房，洗净手做一碗羹汤。\n还不熟悉婆婆的口味，先请小姑尝一尝。",
      translationSource: "public-domain"
    },
    {
      id: "ts-407", title: "题菊花", source: "《全唐诗》",
      dynasty: "唐", author: "黄巢", gradeGroup: "卷八 七言绝句",
      text: "飒飒西风满院栽，蕊寒香冷蝶难来。\n他年我若为青帝，报与桃花一处开。",
      translation: "满院栽的菊花在西风中飒飒作响，花蕊清寒、香气冷冽，蝴蝶也难飞来。\n将来我若做了司春的青帝，定要让它与桃花在同一时节开放。",
      translationSource: "public-domain"
    },
    {
      id: "ts-408", title: "不第后赋菊", source: "《全唐诗》",
      dynasty: "唐", author: "黄巢", gradeGroup: "卷八 七言绝句",
      text: "待到秋来九月八，我花开后百花杀。\n冲天香阵透长安，满城尽带黄金甲。",
      translation: "等到秋天九月初八，我的菊花一开，别的花就都凋零了。\n冲天而起的香气阵阵透入长安，满城都披上了金黄的铠甲。",
      translationSource: "public-domain"
    },
    {
      id: "ts-409", title: "剑客", source: "《长江集》",
      dynasty: "唐", author: "贾岛", gradeGroup: "卷七 五言绝句",
      text: "十年磨一剑，霜刃未曾试。\n今日把示君，谁有不平事？",
      translation: "十年磨成一把剑，雪亮的锋刃还不曾试过。\n今天把它拿出来给你看 —— 谁有不平的事？",
      translationSource: "public-domain"
    },
    {
      id: "ts-410", title: "过华清宫绝句·其一", source: "《樊川文集》",
      dynasty: "唐", author: "杜牧", gradeGroup: "卷八 七言绝句",
      text: "长安回望绣成堆，山顶千门次第开。\n一骑红尘妃子笑，无人知是荔枝来。",
      translation: "从长安回望骊山，林木花卉像一堆锦绣；山顶上重重宫门一扇扇打开。\n一骑快马扬起红尘，杨贵妃笑了 —— 没有人知道是为了荔枝送来。",
      translationSource: "public-domain"
    },
    {
      id: "ts-411", title: "军城早秋", source: "《全唐诗》",
      dynasty: "唐", author: "严武", gradeGroup: "卷八 七言绝句",
      text: "昨夜秋风入汉关，朔云边月满西山。\n更催飞将追骄虏，莫遣沙场匹马还。",
      translation: "昨夜秋风吹进汉家关塞，北地的云与边塞的月布满西山。\n（主帅）再催飞将军追击骄横的敌骑，不要让一匹马从沙场上回去。",
      translationSource: "public-domain"
    },
    {
      id: "ts-412", title: "乐游原", source: "《李义山诗集》",
      dynasty: "唐", author: "李商隐", gradeGroup: "卷七 五言绝句",
      text: "向晚意不适，驱车登古原。\n夕阳无限好，只是近黄昏。",
      translation: "傍晚时心情不畅，驱车登上古老的乐游原。\n夕阳真是无限美好，只是已近黄昏。",
      translationSource: "public-domain"
    },

    /* ── 《古诗「非唐代」》卷（明 / 宋，唐代的诗一律归《唐诗》）──────── */
    {
      id: "gs-72", title: "燕子矶口占", source: "《史忠正公集》",
      dynasty: "明", author: "史可法", gradeGroup: "元明清诗",
      text: "来家不面母，咫尺犹千里。\n矶头洒清泪，滴滴沉江底。",
      translation: "回到家乡却见不到母亲，近在咫尺却像隔着千里。\n在燕子矶头洒下清泪，一滴一滴沉到江底。",
      translationSource: "public-domain"
    },
    {
      id: "gs-73", title: "除夜太原寒甚", source: "《于忠肃集》",
      dynasty: "明", author: "于谦", gradeGroup: "元明清诗",
      text: "寄语天涯客，轻寒底用愁。\n春风来不远，只在屋东头。",
      translation: "捎句话给天涯的旅人：一点点轻寒哪里值得发愁。\n春风来的时候不远了，就在屋子的东头。",
      translationSource: "public-domain"
    },
    {
      id: "gs-74", title: "陶者", source: "《宛陵先生集》",
      dynasty: "宋", author: "梅尧臣", gradeGroup: "宋诗",
      text: "陶尽门前土，屋上无片瓦。\n十指不沾泥，鳞鳞居大厦。",
      translation: "陶工烧砖挖尽了门前的泥土，自家的屋顶上却没有一片瓦。\n那些十指不沾泥土的人，却住着瓦像鱼鳞一样密密排列的高楼大厦。",
      translationSource: "public-domain"
    }
  ];

  root.POEMS_CORPUS_505B = POEMS;
})(typeof window !== "undefined" ? window : globalThis);
