/* Issue #516 · 第二批（收尾批）· 清单里最后真缺的 20 篇
   --------------------------------------------------------------------------
   用户 2026-10-08 点名的第二批，按全站的**朝代口径**落库：
   《唐诗》5 条（ts-461…ts-465 唐人 + ts-468 颜真卿《劝学》、ts-469 司空曙
   《江村即事》；后两条清单挂在《古诗》那堆里，实为唐人）；
   《古诗「非唐代」》15 条（gs-113…gs-126 + 许淑慧《菩萨蛮·大柏地》gs-114，
   其中 gs-125 苏轼《赠刘景文》、gs-126 张俞《蚕妇》是清单挂在《唐诗》里、
   实为宋人的两条）。
   
   《赋新月》作者第一批误作「杜甫」，本轮订正为「缪氏子」（见 ts-456 语料注释）。
   本文件是**源语料表**：正文只此一份落在这里，各集子的壳挂 textRef 指过来；
   不跑生成器，改这里就是对数据本身动手。
   
   ⚠️ 「题名异写合流」没有在本表里登记：合流靠正文判重（data/works-map.js）
      自动合成一篇，titles 里记下另一个题名，不需要另写一行。
   
   `aliases` 字段：用户点名要的「又名 xxxx」——展示在阅读器标题下方，
   只在题名与主条目不同、又不是同一首的异写时写。
   -------------------------------------------------------------------------- */
(function (root) {
  "use strict";

  var POEMS = [
    /* ── 《赋新月》作者订正（第一批落库、本批改作者） ─────────────────── */

    {
      id: "ts-456", title: "赋新月", source: "《全唐诗》",
      dynasty: "唐", author: "缪氏子", gradeGroup: "卷八 七言绝句",
      /* 作者订正：第一批照清单原样落成「杜甫」，实为缪氏子（唐开元间一童子，
         玄宗召试，以「初月如弓」应制）。见 data/poems-tangshi.js 里的同一处。 */
      text: "初月如弓未上弦，分明挂在碧霄边。\n时人莫道蛾眉小，三五团圆照满天。",
      translation: "新月像一张弓还没有上弦，清清楚楚地挂在碧蓝的天空边上。世上的人不要嫌它像蛾眉一样细小，等到十五团圆时，它便会照亮整个天空。",
      translationSource: "public-domain"
    },

    /* ── 《唐诗》卷 · 真缺落库（5 唐人 + 2 实为唐人的） ─────────────── */

    {
      id: "ts-461", title: "过华清宫绝句三首·其一", source: "《樊川文集》",
      dynasty: "唐", author: "杜牧", gradeGroup: "卷八 七言绝句",
      text: "长安回望绣成堆，\n山顶千门次第开。\n一骑红尘妃子笑，\n无人知是荔枝来。",
      translation: "从长安回头望去，骊山上一片锦绣堆叠；山顶上重重宫门一扇接一扇地打开。一名骑手扬起红尘飞驰而来，杨贵妃见了开颜一笑——没有人知道，那是为她送荔枝来了。",
      translationSource: "public-domain"
    },

    {
      id: "ts-462", title: "寄扬州韩绰判官", source: "《樊川文集》",
      dynasty: "唐", author: "杜牧", gradeGroup: "卷八 七言绝句",
      text: "青山隐隐水迢迢，\n秋尽江南草未凋。\n二十四桥明月夜，\n玉人何处教吹箫？",
      translation: "青山隐隐约约，绿水长流迢迢。秋已深了，江南的草木还没有凋零。二十四桥上明月当空的夜里，你在哪里教美人吹箫呢？",
      translationSource: "public-domain"
    },

    {
      id: "ts-463", title: "题乌江亭", source: "《樊川文集》",
      dynasty: "唐", author: "杜牧", gradeGroup: "卷八 七言绝句",
      text: "胜败兵家事不期，\n包羞忍耻是男儿。\n江东子弟多才俊，\n卷土重来未可知。",
      translation: "胜败是兵家常事，难以预料；能忍辱含垢，才算得是真正的男子汉。江东的子弟人才济济，若能重整旗鼓卷土重来，胜负也还说不定呢。",
      translationSource: "public-domain"
    },

    {
      id: "ts-464", title: "竹枝词·山桃红花满上头", source: "《刘宾客文集》",
      dynasty: "唐", author: "刘禹锡", gradeGroup: "卷八 七言绝句",
      text: "山桃红花满上头，\n蜀江春水拍山流。\n花红易衰似郎意，\n水流无限似侬愁。",
      translation: "山桃花红艳艳地开满山头，蜀江的春水拍着山脚奔流。花红容易凋谢，就像情郎的心意；水流没有尽头，就像我的愁绪。",
      translationSource: "public-domain"
    },

    {
      id: "ts-465", title: "南园十三首·其五", source: "《李长吉歌诗》",
      dynasty: "唐", author: "李贺", gradeGroup: "卷七 七言乐府",
      text: "男儿何不带吴钩，\n收取关山五十州。\n请君暂上凌烟阁，\n若个书生万户侯？",
      translation: "男子汉为什么不佩上吴钩宝刀，去收复被割据的关山五十州？请你暂且上凌烟阁看看，那些画像里的功臣，有哪一个是书生封了万户侯的？",
      translationSource: "public-domain"
    },

    {
      id: "ts-468", title: "劝学", source: "《全唐诗》",
      dynasty: "唐", author: "颜真卿", gradeGroup: "唐诗",
      /* ⚠️ 跨集同篇：全站另有一条《劝学》是古文 gw-114（荀子），正文一字不同，
         判重键对不上，两条并列是对的；这里补一条**展示用**的区分说明，
         免得在搜索里撞见两条同名、以为其中一条是重录。 */
      note: "非荀子《劝学》，是颜真卿那首七言诗。",
      text: "三更灯火五更鸡，\n正是男儿读书时。\n黑发不知勤学早，\n白首方悔读书迟。",
      translation: "三更的灯火、五更的鸡鸣，正是男儿读书的好时候。年轻黑发时不知道要及早勤学，等到白头了才后悔读书读得太迟。",
      translationSource: "public-domain"
    },

    {
      id: "ts-469", title: "江村即事", source: "《全唐诗》",
      dynasty: "唐", author: "司空曙", gradeGroup: "唐诗",
      text: "钓罢归来不系船，\n江村月落正堪眠。\n纵然一夜风吹去，\n只在芦花浅水边。",
      translation: "钓完鱼回来，船也不系缆绳；江村的月亮已经落下，正是好睡的时候。就算一夜风吹把船飘走，也不过是停在芦花的浅水边罢了。",
      translationSource: "public-domain"
    },

    /* ── 《古诗「非唐代」》卷 · 真缺落库 12 条 ─────────────────────── */

    {
      id: "gs-113", title: "归园田居·其三", source: "《陶渊明集》",
      dynasty: "东晋", author: "陶渊明", gradeGroup: "六朝诗",
      text: "种豆南山下，\n草盛豆苗稀。\n晨兴理荒秽，\n带月荷锄归。\n道狭草木长，\n夕露沾我衣。\n衣沾不足惜，\n但使愿无违。",
      translation: "在南山下种豆子，地里野草长得茂盛，豆苗却稀稀拉拉。清早起来下地锄草，直到夜里披着月色扛锄回家。田间小路狭窄，草木又长得深，傍晚的露水打湿了我的衣裳。衣裳打湿了并不值得可惜，只要不违背自己的心愿就好。",
      translationSource: "public-domain"
    },

    {
      id: "gs-114", title: "菩萨蛮·大柏地", source: "《全清词钞》",
      dynasty: "清", author: "许淑慧", gradeGroup: "清词",
      text: "斜辉漠漠东风骤。绿阴影里雏莺瘦。\n罗袖薄如烟。清明欲暮天。\n海棠开也未。一枕江南睡。\n莫倚玉阑干。东风作晚寒。",
      translation: "斜阳淡淡，东风忽然转急。绿荫影里，雏莺显得格外清瘦。轻罗的衣袖薄得像烟一样。清明将近，天色已是傍晚。海棠花开了没有？枕上做着一个江南的梦。不要倚着玉栏杆——东风带来的是晚来的寒意。",
      translationSource: "public-domain"
    },

    {
      id: "gs-115", title: "绝句四首·其四", source: "《后山诗注》",
      dynasty: "宋", author: "陈师道", gradeGroup: "宋诗",
      text: "书当快意读易尽，\n客有可人期不来。\n世事相违每如此，\n好怀百岁几回开。",
      translation: "读书正当畅快的时候，书却很快读完了；客人中有中意的，偏偏左等右等不来。世间的事每每与人的心愿相违，就是这样；一辈子百年之中，好心情能有几回舒展呢。",
      translationSource: "public-domain"
    },

    {
      id: "gs-116", title: "题青泥市壁", source: "《岳忠武王文集》",
      dynasty: "宋", author: "岳飞", gradeGroup: "宋诗",
      text: "雄气堂堂贯斗牛，\n誓将贞节报君仇。\n斩除顽恶还车驾，\n不问登坛万户侯。",
      translation: "堂堂的雄壮之气直贯斗牛星宿，我发誓要以忠贞的节操为君王报仇。铲除凶顽、迎回皇帝的车驾，我不去问什么登坛拜将、封万户侯。",
      translationSource: "public-domain"
    },

    {
      id: "gs-117", title: "论诗五绝·其二", source: "《瓯北集》",
      dynasty: "清", author: "赵翼", gradeGroup: "元明清诗",
      text: "李杜诗篇万口传，\n至今已觉不新鲜。\n江山代有才人出，\n各领风骚数百年。",
      translation: "李白、杜甫的诗篇千百年为人传诵，到今天已经觉得不新鲜了。江山代代都有才华出众的人出现，各自引领文坛风骚数百年。",
      translationSource: "public-domain"
    },

    {
      id: "gs-118", title: "塞外杂咏", source: "《云左山房诗钞》",
      dynasty: "清", author: "林则徐", gradeGroup: "元明清诗",
      text: "天山万笏耸琼瑶，\n导我西行伴寂寥。\n我与山灵相对笑，\n满头晴雪共难消。",
      translation: "天山千万座山峰像朝笏一样耸立，上头覆盖着美玉般的积雪；它们引导我向西而行，陪伴我的寂寥。我与山神相对而笑——它满头的晴日积雪，和我满头的白发一样，都难以消融。",
      translationSource: "public-domain"
    },

    {
      id: "gs-119", title: "题花山寺壁", source: "《苏学士文集》",
      dynasty: "宋", author: "苏舜钦", gradeGroup: "宋诗",
      text: "寺里山因花得名，\n繁英不见草纵横。\n栽培剪伐须勤力，\n花易凋零草易生。",
      translation: "花山寺里的山因为花而得名，如今却看不见繁盛的花朵，只有杂草纵横。栽花剪草必须勤加用力——花容易凋零，草却容易滋生。",
      translationSource: "public-domain"
    },

    {
      id: "gs-120", title: "自菩提步月归广化寺", source: "《欧阳文忠公集》",
      dynasty: "宋", author: "欧阳修", gradeGroup: "宋诗",
      text: "春岩瀑泉响，\n夜久山已寂。\n明月净松林，\n千峰同一色。",
      translation: "春天的岩石上瀑布泉声轰响，夜已深了，山中归于寂静。明月把松林洗得洁净，千座山峰在月光下是同一种颜色。",
      translationSource: "public-domain"
    },

    {
      id: "gs-121", title: "江上", source: "《临川先生文集》",
      dynasty: "宋", author: "王安石", gradeGroup: "宋诗",
      text: "江水漾西风，\n江花脱晚红。\n离情被横笛，\n吹过乱山东。",
      translation: "西风吹起，江面上水波荡漾；江边的花朵脱去了傍晚的红色。离别的情思被一支笛子承载着，吹过了乱山的东边。",
      translationSource: "public-domain"
    },

    {
      id: "gs-123", title: "秋日湖上", source: "《全宋诗》",
      dynasty: "宋", author: "徐元杰", gradeGroup: "宋诗",
      text: "花开红树乱莺啼，\n草长平湖白鹭飞。\n风物晴和人意好，\n夕阳箫鼓几船归。",
      translation: "红树上花开似锦，黄莺乱啼；湖岸草长，平湖之上白鹭飞翔。风光晴和，人的心情也好；夕阳里箫鼓声中，几只船载着游兴归去。",
      translationSource: "public-domain"
    },

    {
      id: "gs-125", title: "赠刘景文", source: "《苏轼诗集》",
      dynasty: "宋", author: "苏轼", gradeGroup: "卷八 七言绝句",
      text: "荷尽已无擎雨盖，\n菊残犹有傲霜枝。\n一年好景君须记，\n最是橙黄橘绿时。",
      translation: "荷花凋尽了，再没有遮雨的圆叶；菊花也残了，却还剩下傲霜的枝条。一年中最好的景致你要记住——正是橙子发黄、橘子尚绿的时候。",
      translationSource: "public-domain"
    },

    {
      id: "gs-126", title: "蚕妇", source: "《全宋诗》",
      dynasty: "宋", author: "张俞", gradeGroup: "卷八 五言绝句",
      /* 与《古诗「非唐代」》gs-78 的陆游《蚕妇》（「莫笑农家腊酒浑」）同题不同篇，别混。 */
      text: "昨日入城市，\n归来泪满巾。\n遍身罗绮者，\n不是养蚕人。",
      translation: "昨天进城去卖蚕丝，回来时泪水湿透了手巾。那些浑身上下穿着绫罗绸缎的人，没有一个是养蚕的人。",
      translationSource: "public-domain"
    },
  ];

  root.POEMS_CORPUS_516B = POEMS;
})(typeof window !== "undefined" ? window : globalThis);
