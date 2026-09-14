/* ==========================================================================
   同篇对照表（主表裁定规则的静态成果）
   --------------------------------------------------------------------------
   由 scripts/build-works-map.js 离线算出：**正文（去标点后）一致 = 同一篇作品**。
   只登记「在两部及以上集子里重复出现」的那些作品（共 57 组），
   单条的作品不必登记 —— 它本来就只出现一次，条目 id 自己就是作品 id。

   ⚠️ 这是**生成文件**，改动请改 scripts/build-works-map.js 后重跑，
      不要手改这里 —— 下次重新生成会把手工改动覆盖掉。

   为什么要单独落成一份**静态数据**而不是每页现算：
     现算要先备齐六部集子的全部数据（约 3MB）。集子索引页只加载自己那一部，
     它也要判重（「这篇是不是已经在课内背过了」），现算就会得到一张残表。
     这一份 8KB，任何页面都能引，判重口径全站一致。

   ## 为什么不是所有同名篇目都合并

   教材与选本的文本**真会不一样**，是文献上的差别、不是录入出错：
     · 《静夜思》 教材与《唐诗三百首》正文一致（都是「床前明月光」的教材文本）
       → 合并为同一篇（titles 记两个题名）
     · 《陋室铭》 教材作「孔子云何陋之有」、古文观止作「孔子云『何陋之有』」→ 引号剥掉后
       正文一致，合并
     · 《夜上受降城闻笛》 教材作「回乐烽」、唐诗三百首作「回乐峰」→ 一字之差，是两种文本，
       **分成两条并列的作品**，各背各的
   规则一句话：**课内以教材文本为准，选集以选本原貌为准，冲突时分两条并列**。

   至于同一篇作品「用哪一份正文」，那是另一份静态表的裁定 ——
   见 data/canonical-texts.js（课内优先，同一篇只留一份正文）。

   ## 课内自身重复已按「低年级版本为准」去重

   课内数据里曾有 12 组篇目在两个年级各存一份（正文一字不差），是逐页录入留下的
   自身重复（《绝句》二年级下 / 三年级下、《师说》高一上 / 高三下……）。
   已各删一条、保留低年级那条，课内条目由 273 降到 261，本表组数由 66 降到 57。
   跨集那 3 组只删课内自身那份，与选集的判重照旧。

   字段：
     wid     作品 id（`w-` 加首个条目 id）
     title   主条目题名（有课内条目时取教材题名）
     titles  这一篇出现过的全部题名（同诗异题：《夜思》与《静夜思》）
     entries 收录这一篇的全部站点条目 id，与 data/site-index.js 同口径
   ========================================================================== */
window.WORKS_GROUPS = [
  { wid: "w-poems-cz7-03", title: "次北固山下", titles: ["次北固山下"], entries: ["poems-cz7-03","tangshi-ts-102"] },
  { wid: "w-poems-cz7-06", title: "江南逢李龟年", titles: ["江南逢李龟年"], entries: ["poems-cz7-06","tangshi-ts-262"] },
  { wid: "w-poems-cz7-10", title: "夜雨寄北", titles: ["夜雨寄北"], entries: ["poems-cz7-10","tangshi-ts-295"] },
  { wid: "w-poems-cz7-14", title: "竹里馆", titles: ["竹里馆"], entries: ["poems-cz7-14","tangshi-ts-223"] },
  { wid: "w-poems-cz7-16", title: "逢入京使", titles: ["逢入京使"], entries: ["poems-cz7-16","tangshi-ts-261"] },
  { wid: "w-poems-cz7-18", title: "登幽州台歌", titles: ["登幽州台歌"], entries: ["poems-cz7-18","tangshi-ts-34"] },
  { wid: "w-poems-cz7-19", title: "望岳", titles: ["望岳"], entries: ["poems-cz7-19","tangshi-ts-6"] },
  { wid: "w-poems-cz7-23", title: "陋室铭", titles: ["陋室铭"], entries: ["poems-cz7-23","guwen-gwj-97"] },
  { wid: "w-poems-cz8-02", title: "答谢中书书", titles: ["答谢中书书"], entries: ["poems-cz8-02","classic-gw-60"] },
  { wid: "w-poems-cz8-06", title: "黄鹤楼", titles: ["黄鹤楼"], entries: ["poems-cz8-06","tangshi-ts-173"] },
  { wid: "w-poems-cz8-08", title: "渡荆门送别", titles: ["渡荆门送别"], entries: ["poems-cz8-08","tangshi-ts-106"] },
  { wid: "w-poems-cz8-14", title: "桃花源记", titles: ["桃花源记"], entries: ["poems-cz8-14","guwen-gwj-88"] },
  { wid: "w-poems-cz8-21", title: "送杜少府之任蜀州", titles: ["送杜少府之任蜀州"], entries: ["poems-cz8-21","tangshi-ts-97"] },
  { wid: "w-poems-cz8-22", title: "望洞庭湖赠张丞相", titles: ["望洞庭湖赠张丞相","临洞庭上张丞相"], entries: ["poems-cz8-22","tangshi-ts-128"] },
  { wid: "w-poems-cz8-27", title: "送友人", titles: ["送友人"], entries: ["poems-cz8-27","tangshi-ts-107"] },
  { wid: "w-poems-cz8-28", title: "卜算子·黄州定慧院寓居作", titles: ["卜算子·黄州定慧院寓居作","卜算子·黄州定惠院寓居作"], entries: ["poems-cz8-28","songci-sc-70"] },
  { wid: "w-poems-cz8-29", title: "卜算子·咏梅", titles: ["卜算子·咏梅"], entries: ["poems-cz8-29","songci-sc-173"] },
  { wid: "w-poems-cz9-07", title: "行路难（其一）", titles: ["行路难（其一）","行路难·其一"], entries: ["poems-cz9-07","tangshi-ts-77"] },
  { wid: "w-poems-cz9-10", title: "月夜忆舍弟", titles: ["月夜忆舍弟"], entries: ["poems-cz9-10","tangshi-ts-114"] },
  { wid: "w-poems-cz9-11", title: "长沙过贾谊宅", titles: ["长沙过贾谊宅"], entries: ["poems-cz9-11","tangshi-ts-200"] },
  { wid: "w-poems-cz9-18", title: "渔家傲·秋思", titles: ["渔家傲·秋思","渔家傲"], entries: ["poems-cz9-18","songci-sc-5"] },
  { wid: "w-poems-cz9-23", title: "临江仙·夜登小阁忆洛中旧游", titles: ["临江仙·夜登小阁忆洛中旧游","临江仙"], entries: ["poems-cz9-23","songci-sc-147"] },
  { wid: "w-poems-gz10-05", title: "登高", titles: ["登高"], entries: ["poems-gz10-05","tangshi-ts-190"] },
  { wid: "w-poems-gz10-07", title: "念奴娇·赤壁怀古", titles: ["念奴娇·赤壁怀古"], entries: ["poems-gz10-07","songci-sc-67"] },
  { wid: "w-poems-gz10-08", title: "永遇乐·京口北固亭怀古", titles: ["永遇乐·京口北固亭怀古"], entries: ["poems-gz10-08","songci-sc-183"] },
  { wid: "w-poems-gz10-09", title: "声声慢·寻寻觅觅", titles: ["声声慢·寻寻觅觅","声声慢"], entries: ["poems-gz10-09","songci-sc-249"] },
  { wid: "w-poems-gz10-18", title: "桂枝香·金陵怀古", titles: ["桂枝香·金陵怀古","桂枝香"], entries: ["poems-gz10-18","songci-sc-47"] },
  { wid: "w-poems-gz10-21", title: "登岳阳楼", titles: ["登岳阳楼"], entries: ["poems-gz10-21","tangshi-ts-119"] },
  { wid: "w-poems-gz11-07", title: "江城子·乙卯正月二十日夜记梦", titles: ["江城子·乙卯正月二十日夜记梦"], entries: ["poems-gz11-07","songci-sc-75"] },
  { wid: "w-poems-gz11-12", title: "锦瑟", titles: ["锦瑟"], entries: ["poems-gz11-12","tangshi-ts-213"] },
  { wid: "w-poems-gz11-19", title: "扬州慢·淮左名都", titles: ["扬州慢·淮左名都","扬州慢"], entries: ["poems-gz11-19","songci-sc-192"] },
  { wid: "w-poems-gz11-20", title: "客至", titles: ["客至"], entries: ["poems-gz11-20","tangshi-ts-187"] },
  { wid: "w-poems-xx1-07", title: "春晓", titles: ["春晓"], entries: ["poems-xx1-07","tangshi-ts-230"] },
  { wid: "w-poems-xx1-09", title: "静夜思", titles: ["静夜思","夜思"], entries: ["poems-xx1-09","tangshi-ts-231"] },
  { wid: "w-poems-xx1-10", title: "寻隐者不遇", titles: ["寻隐者不遇"], entries: ["poems-xx1-10","tangshi-ts-247"] },
  { wid: "w-poems-xx2-03", title: "登鹳雀楼", titles: ["登鹳雀楼"], entries: ["poems-xx2-03","tangshi-ts-234"] },
  { wid: "w-poems-xx2-05", title: "江雪", titles: ["江雪"], entries: ["poems-xx2-05","tangshi-ts-242"] },
  { wid: "w-poems-xx2-10", title: "赋得古原草送别", titles: ["赋得古原草送别","草"], entries: ["poems-xx2-10","tangshi-ts-156"] },
  { wid: "w-poems-xx3-08", title: "早发白帝城", titles: ["早发白帝城"], entries: ["poems-xx3-08","tangshi-ts-260"] },
  { wid: "w-poems-xx3-09", title: "采莲曲", titles: ["采莲曲"], entries: ["poems-xx3-09","tangshi-ts-89"] },
  { wid: "w-poems-xx3-16", title: "九月九日忆山东兄弟", titles: ["九月九日忆山东兄弟"], entries: ["poems-xx3-16","tangshi-ts-254"] },
  { wid: "w-poems-xx3-17", title: "滁州西涧", titles: ["滁州西涧"], entries: ["poems-xx3-17","tangshi-ts-263"] },
  { wid: "w-poems-xx4-04", title: "出塞", titles: ["出塞"], entries: ["poems-xx4-04","tangshi-ts-88"] },
  { wid: "w-poems-xx4-05", title: "凉州词", titles: ["凉州词"], entries: ["poems-xx4-05","tangshi-ts-258"] },
  { wid: "w-poems-xx4-17", title: "鹿柴", titles: ["鹿柴"], entries: ["poems-xx4-17","tangshi-ts-222"] },
  { wid: "w-poems-xx4-18", title: "嫦娥", titles: ["嫦娥"], entries: ["poems-xx4-18","tangshi-ts-300"] },
  { wid: "w-poems-xx4-20", title: "芙蓉楼送辛渐", titles: ["芙蓉楼送辛渐"], entries: ["poems-xx4-20","tangshi-ts-255"] },
  { wid: "w-poems-xx5-06", title: "山居秋暝", titles: ["山居秋暝"], entries: ["poems-xx5-06","tangshi-ts-121"] },
  { wid: "w-poems-xx5-07", title: "枫桥夜泊", titles: ["枫桥夜泊"], entries: ["poems-xx5-07","tangshi-ts-264"] },
  { wid: "w-poems-xx5-12", title: "游子吟", titles: ["游子吟"], entries: ["poems-xx5-12","tangshi-ts-67"] },
  { wid: "w-poems-xx5-16", title: "闻官军收河南河北", titles: ["闻官军收河南河北"], entries: ["poems-xx5-16","tangshi-ts-189"] },
  { wid: "w-poems-xx5-23", title: "送元二使安西", titles: ["送元二使安西","渭城曲"], entries: ["poems-xx5-23","tangshi-ts-86"] },
  { wid: "w-poems-xx6-01", title: "宿建德江", titles: ["宿建德江"], entries: ["poems-xx6-01","tangshi-ts-229"] },
  { wid: "w-poems-xx6-07", title: "回乡偶书", titles: ["回乡偶书","回乡偶书·其一"], entries: ["poems-xx6-07","tangshi-ts-251"] },
  { wid: "w-poems-xx6-08", title: "寒食", titles: ["寒食"], entries: ["poems-xx6-08","tangshi-ts-265"] },
  { wid: "w-poems-xx6-14", title: "清平乐·春归何处", titles: ["清平乐·春归何处","清平乐"], entries: ["poems-xx6-14","songci-sc-80"] },
  { wid: "w-poems-xx6-17", title: "过故人庄", titles: ["过故人庄"], entries: ["poems-xx6-17","tangshi-ts-132"] }
];
