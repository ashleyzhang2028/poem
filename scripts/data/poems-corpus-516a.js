/* Issue #516 · 古诗第一批 50 篇（用户 2026-10-08 投喂的第 1~100 组）
   --------------------------------------------------------------------------
   《唐诗》19 条（ts-437 / ts-443…ts-460，全站真缺、本文件写正文）。
   原登记的 15 条「集内已有、补壳合流」（ts-427…ts-442）已改为**直接升级
   集内那条的出处**（source=精确集名 + selection=《唐诗三百首》），
   不再另挂壳 —— 详见 Issue #512；
   《古诗「非唐代」》20 条（gs-93…gs-112；15 条真缺落库、1 条集内已有合流、
   3 条跨部合流）。壳挂 textRef，正文只在本文件落一份。 */
(function (root) {
  "use strict";

  var POEMS = [
    /* ── 一 · 《唐诗》卷 · 真缺落库 19 条（本文件写正文） ─────────────── */
    {
      id: "ts-443", title: "咏风", source: "《王子安集》",
      dynasty: "唐", author: "王勃", gradeGroup: "卷八 五言绝句",
      text: "肃肃凉景生，加我林壑清。\n驱烟寻涧户，卷雾出山楹。\n去来固无迹，动息如有情。\n日落山水静，为君起松声。",
      translation: "清凉的风萧萧地吹起来，使我的林壑更加清幽。它驱散烟雾，寻访山涧边的人家；卷走雾气，露出山间的屋柱。来去本来没有踪迹，动静之间却像含着情意。日落之后山水寂静，它又为你吹起满山松涛。",
      translationSource: "public-domain"
    },
    {
      id: "ts-444", title: "野望", source: "《东皋子集》",
      dynasty: "唐", author: "王绩", gradeGroup: "卷五 五言律诗",
      text: "东皋薄暮望，徙倚欲何依。\n树树皆秋色，山山唯落晖。\n牧人驱犊返，猎马带禽归。\n相顾无相识，长歌怀采薇。",
      translation: "傍晚时分，我在东皋远望，徘徊不定，不知何处可以依托。每一棵树都染上秋色，每一座山都罩着落日的余晖。牧人赶着牛犊回家，猎人骑着马带着猎物归来。彼此相看却都不相识，我长声歌唱，怀念那采薇隐居的古人。",
      translationSource: "public-domain"
    },
    {
      id: "ts-445", title: "渡汉江", source: "《宋之问集》",
      dynasty: "唐", author: "宋之问", gradeGroup: "卷八 五言绝句",
      text: "岭外音书断，经冬复历春。\n近乡情更怯，不敢问来人。",
      translation: "贬谪在五岭之外，与家中音信断绝，经过了一个冬天又一个春天。越走近家乡，心里越是胆怯，竟不敢向迎面来的人打听家里的消息。",
      translationSource: "public-domain"
    },
    {
      id: "ts-446", title: "赐萧瑀", source: "《全唐诗》",
      dynasty: "唐", author: "李世民", gradeGroup: "卷八 五言绝句",
      text: "疾风知劲草，板荡识诚臣。\n勇夫安识义，智者必怀仁。",
      translation: "在迅猛的大风中才能看出哪些是坚韧的草，在动荡的时局里才能识别谁是忠诚的臣子。只凭勇力的人哪里懂得道义，真正有智慧的人一定心怀仁德。",
      translationSource: "public-domain"
    },
    {
      id: "ts-447", title: "山中送别", source: "《王右丞集》",
      dynasty: "唐", author: "王维", gradeGroup: "卷八 五言绝句",
      text: "山中相送罢，日暮掩柴扉。\n春草明年绿，王孙归不归？",
      translation: "在山中送走了友人，天色将晚，我掩上柴门。春草到明年又会变绿，远游的人啊，你回不回来呢？",
      translationSource: "public-domain"
    },
    {
      id: "ts-448", title: "秋登万山寄张五", source: "《孟襄阳集》",
      dynasty: "唐", author: "孟浩然", gradeGroup: "卷一 五言古诗",
      text: "北山白云里，隐者自怡悦。\n相望始登高，心随雁飞灭。\n愁因薄暮起，兴是清秋发。\n时见归村人，沙行渡头歇。\n天边树若荠，江畔洲如月。\n何当载酒来，共醉重阳节。",
      translation: "北山隐在白云之中，隐居的人自得其乐。因为思念你，我才登高远望，心随着大雁飞到天边消失。愁绪因傍晚而生，兴致因清秋而发。不时看见回村的人，在沙滩上行走、在渡头歇脚。天边的树小得像荠菜，江边的沙洲弯得像月牙。什么时候你带着酒来，我们一同在重阳节畅饮大醉。",
      translationSource: "public-domain"
    },
    {
      id: "ts-449", title: "夜雪", source: "《白氏长庆集》",
      dynasty: "唐", author: "白居易", gradeGroup: "卷八 五言绝句",
      text: "已讶衾枕冷，复见窗户明。\n夜深知雪重，时闻折竹声。",
      translation: "已经惊讶被子和枕头变得冰冷，又看见窗户外一片明亮。夜深了，知道雪下得很大，不时听到竹子被压断的声音。",
      translationSource: "public-domain"
    },
    {
      id: "ts-450", title: "村夜", source: "《白氏长庆集》",
      dynasty: "唐", author: "白居易", gradeGroup: "卷八 七言绝句",
      text: "霜草苍苍虫切切，村南村北行人绝。\n独出门前望野田，月明荞麦花如雪。",
      translation: "经霜的野草一片苍苍，秋虫切切地鸣叫，村南村北已没有行人。我独自走到门前眺望田野，月光下荞麦花白得像雪一样。",
      translationSource: "public-domain"
    },
    {
      id: "ts-451", title: "戏问花门酒家翁", source: "《岑嘉州集》",
      dynasty: "唐", author: "岑参", gradeGroup: "卷八 七言绝句",
      text: "老人七十仍沽酒，千壶百瓮花门口。\n道旁榆荚巧似钱，摘来沽酒君肯否？",
      translation: "老人家七十岁了还在卖酒，花门楼前摆着千壶百瓮。路旁的榆荚长得像一串串铜钱，我摘下来买你的酒，你肯不肯呢？",
      translationSource: "public-domain"
    },
    {
      id: "ts-452", title: "山亭夏日", source: "《全唐诗》",
      dynasty: "唐", author: "高骈", gradeGroup: "卷八 七言绝句",
      text: "绿树阴浓夏日长，楼台倒影入池塘。\n水晶帘动微风起，满架蔷薇一院香。",
      translation: "绿树浓荫，夏日的白昼显得格外漫长；楼台的倒影映在池塘里。微风一起，水晶帘子轻轻摇动，满架蔷薇送来一院子的香气。",
      translationSource: "public-domain"
    },
    {
      id: "ts-453", title: "江楼感旧", source: "《渭南诗集》",
      dynasty: "唐", author: "赵嘏", gradeGroup: "卷八 七言绝句",
      text: "独上江楼思渺然，月光如水水如天。\n同来望月人何处？风景依稀似去年。",
      translation: "独自登上江边的高楼，思绪悠远迷茫；月光像水一样清亮，水色像天空一样辽阔。当年一同来望月的人如今在哪里呢？眼前的风景还隐约像去年一样。",
      translationSource: "public-domain"
    },
    {
      id: "ts-454", title: "农家", source: "《全唐诗》",
      dynasty: "唐", author: "颜仁郁", gradeGroup: "卷八 七言绝句",
      text: "半夜呼儿趁晓耕，羸牛无力渐艰行。\n时人不识农家苦，将谓田中谷自生。",
      translation: "半夜里就叫起孩子趁着天亮前下地耕作，瘦弱的牛没有力气，越走越艰难。世上的人不懂得农家的辛苦，还以为田里的谷子是自己长出来的。",
      translationSource: "public-domain"
    },
    {
      id: "ts-455", title: "韩冬郎即席为诗相送", source: "《玉溪生诗集》",
      dynasty: "唐", author: "李商隐", gradeGroup: "卷八 七言绝句",
      text: "十岁裁诗走马成，冷灰残烛动离情。\n桐花万里丹山路，雏凤清于老凤声。",
      translation: "你十岁就能作诗，落笔如走马般迅速完成；冷灰残烛之间，牵动了离别的愁情。万里桐花、丹山路上，小凤凰的鸣声比老凤凰更加清亮。",
      translationSource: "public-domain"
    },
    {
      id: "ts-456", title: "赋新月", source: "《全唐诗》",
      /* 作者：清单原写「杜甫」，实为缪氏子（唐开元间神童，玄宗召试应制）。
         用户 2026-10-08 点名订正，本表与第二批语料两处一致。 */
      dynasty: "唐", author: "缪氏子", gradeGroup: "卷八 七言绝句",
      text: "初月如弓未上弦，分明挂在碧霄边。\n时人莫道蛾眉小，三五团圆照满天。",
      translation: "新月像一张弓还没有上弦，清清楚楚地挂在碧蓝的天空边上。世上的人不要嫌它像蛾眉一样细小，等到十五团圆时，它便会照亮整个天空。",
      translationSource: "public-domain"
    },
    {
      id: "ts-457", title: "题李凝幽居", source: "《长江集》",
      dynasty: "唐", author: "贾岛", gradeGroup: "卷五 五言律诗",
      text: "闲居少邻并，草径入荒园。\n鸟宿池边树，僧敲月下门。\n过桥分野色，移石动云根。\n暂去还来此，幽期不负言。",
      translation: "闲居的地方很少有邻居，一条杂草丛生的小径通向荒芜的园子。鸟儿栖息在池边的树上，僧人在月光下敲着门。走过桥去，便分出另一片山野景色；移动山石，竟带动了云雾的根脚。我暂时离去，还会回到这里，约定的幽会之期绝不食言。",
      translationSource: "public-domain"
    },
    {
      id: "ts-458", title: "社日", source: "《全唐诗》",
      dynasty: "唐", author: "王驾", gradeGroup: "卷八 七言绝句",
      text: "鹅湖山下稻梁肥，豚栅鸡栖半掩扉。\n桑柘影斜春社散，家家扶得醉人归。",
      translation: "鹅湖山下稻谷长得肥壮，猪圈鸡窝旁家家半掩着门。桑树柘树的影子斜了，春社的宴饮才散去；家家都搀着喝醉的人回家。",
      translationSource: "public-domain"
    },
    {
      id: "ts-459", title: "雨过山村", source: "《王建诗集》",
      dynasty: "唐", author: "王建", gradeGroup: "卷八 七言绝句",
      text: "雨里鸡鸣一两家，竹溪村路板桥斜。\n妇姑相唤浴蚕去，闲着中庭栀子花。",
      translation: "雨中传来一两户人家的鸡鸣，竹林边的溪水旁、村路上一座板桥斜架着。婆媳互相招呼着去选蚕种，庭院里的栀子花倒闲闲地开着。",
      translationSource: "public-domain"
    },
    {
      id: "ts-460", title: "采莲曲", source: "《全唐诗》",
      dynasty: "唐", author: "刘方平", gradeGroup: "卷八 七言绝句",
      text: "落日清江里，荆歌艳楚腰。\n采莲从小惯，十五即乘潮。",
      translation: "夕阳落在清清的江水里，楚地的歌声动人，女子的腰身窈窕。她从小习惯了采莲，十五岁就能驾着小船乘潮而行。",
      translationSource: "public-domain"
    },
    {
      id: "ts-437", title: "绝句漫兴九首·其五", source: "《杜工部集》",
      dynasty: "唐", author: "杜甫", gradeGroup: "卷八 七言绝句",
      text: "肠断春江欲尽头，杖藜徐步立芳洲。\n颠狂柳絮随风舞，轻薄桃花逐水流。",
      translation: "春江流到尽头，令人伤心肠断；我拄着藜杖慢慢走到芳洲上站住。轻狂的柳絮随风乱舞，轻薄的桃花随水漂流。",
      translationSource: "public-domain"
    },

    /* ── 二 · 《古诗「非唐代」》卷 · 真缺落库 15 条 ───────────────────── */
    {
      id: "gs-93", title: "归园田居·其一", source: "《陶渊明集》",
      dynasty: "东晋", author: "陶渊明", gradeGroup: "六朝诗",
      text: "少无适俗韵，性本爱丘山。\n误落尘网中，一去三十年。\n羁鸟恋旧林，池鱼思故渊。\n开荒南野际，守拙归园田。\n方宅十余亩，草屋八九间。\n榆柳荫后檐，桃李罗堂前。\n暧暧远人村，依依墟里烟。\n狗吠深巷中，鸡鸣桑树颠。\n户庭无尘杂，虚室有余闲。\n久在樊笼里，复得返自然。",
      translation: "从小就没有迎合世俗的性情，本性原本喜爱山川田园。错误地落进官场的罗网之中，一去就是三十年。被关的鸟儿眷恋从前的树林，池中的鱼儿思念原来的深潭。我到南边的荒野去开垦，安守愚拙回到田园。宅地有十多亩，草屋有八九间。榆树柳树遮蔽着后檐，桃树李树排列在堂前。远处的村落隐隐约约，村里的炊烟轻柔缭绕。狗在深巷里吠叫，鸡在桑树顶上啼鸣。庭院里没有尘世的杂事，空静的屋中自有闲暇。长久被困在牢笼里，如今终于又回到自然。",
      translationSource: "public-domain"
    },
    {
      id: "gs-94", title: "咏柳", source: "《元丰类稿》",
      dynasty: "宋", author: "曾巩", gradeGroup: "宋诗",
      text: "乱条犹未变初黄，倚得东风势便狂。\n解把飞花蒙日月，不知天地有清霜。",
      translation: "纷乱的柳条还没有转为初春的嫩黄，一倚仗东风就张狂起来。它只懂得让飞絮遮天蔽日，却不知天地间还有肃杀的清霜。",
      translationSource: "public-domain"
    },
    {
      id: "gs-95", title: "春日偶成", source: "《二程集》",
      dynasty: "宋", author: "程颢", gradeGroup: "宋诗",
      text: "云淡风轻近午天，傍花随柳过前川。\n时人不识余心乐，将谓偷闲学少年。",
      translation: "云淡淡，风轻轻，时近中午；我依傍着花、跟随着柳，走过前面的河川。世人不懂得我心里的快乐，还以为我是偷闲学那些少年嬉游。",
      translationSource: "public-domain"
    },
    {
      id: "gs-96", title: "送春", source: "《广陵先生文集》",
      dynasty: "宋", author: "王令", gradeGroup: "宋诗",
      text: "三月残花落更开，小檐日日燕飞来。\n子规夜半犹啼血，不信东风唤不回。",
      translation: "三月的残花落了又开，矮屋檐下天天有燕子飞来。杜鹃半夜还在啼叫得流出血来，它不相信春风就唤不回来。",
      translationSource: "public-domain"
    },
    {
      id: "gs-97", title: "鄂州南楼书事四首·其一", source: "《山谷集》",
      dynasty: "宋", author: "黄庭坚", gradeGroup: "宋诗",
      text: "四顾山光接水光，凭栏十里芰荷香。\n清风明月无人管，并作南楼一味凉。",
      translation: "四面望去，山光接着水光；靠着栏杆，十里之内都是菱角荷花的清香。清风明月没有人管束，一并化作南楼上这一味清凉。",
      translationSource: "public-domain"
    },
    {
      id: "gs-98", title: "舟过安仁", source: "《诚斋集》",
      dynasty: "宋", author: "杨万里", gradeGroup: "宋诗",
      text: "一叶渔船两小童，收篙停棹坐船中。\n怪生无雨都张伞，不是遮头是使风。",
      translation: "一只小渔船上坐着两个小孩，他们收起竹篙、停下船桨，坐在船中。奇怪的是没有下雨却都张开了伞，原来不是遮头，而是要借风行船。",
      translationSource: "public-domain"
    },
    {
      id: "gs-99", title: "寒夜", source: "《全宋诗》",
      dynasty: "宋", author: "杜耒", gradeGroup: "宋诗",
      text: "寒夜客来茶当酒，竹炉汤沸火初红。\n寻常一样窗前月，才有梅花便不同。",
      translation: "寒冷的夜里来了客人，便以茶代酒；竹炉上的水烧得翻滚，炉火刚刚泛红。窗前还是平常那样的月亮，只因有了梅花，便大不相同了。",
      translationSource: "public-domain"
    },
    {
      id: "gs-100", title: "山雨", source: "《全元诗》",
      dynasty: "元", author: "偰逊", gradeGroup: "元明清诗",
      text: "一夜山中雨，林端风怒号。\n不知溪水长，只觉钓船高。",
      translation: "山中的雨下了一整夜，林梢上狂风怒号。不知道溪水已经涨了，只觉得那钓船渐渐升高。",
      translationSource: "public-domain"
    },
    {
      id: "gs-101", title: "马上作", source: "《止止堂集》",
      dynasty: "明", author: "戚继光", gradeGroup: "元明清诗",
      text: "南北驱驰报主情，江花边草笑平生。\n一年三百六十日，多是横戈马上行。",
      translation: "南征北战，为的是报答朝廷的知遇之情；江南的花、边塞的草，都笑看我这一生。一年三百六十天，多半是横着长戈、骑在马上奔波。",
      translationSource: "public-domain"
    },
    {
      id: "gs-102", title: "出师讨满夷自瓜州至金陵", source: "《延平二王遗集》",
      dynasty: "明", author: "郑成功", gradeGroup: "元明清诗",
      text: "缟素临江誓灭胡，雄狮十万气吞吴。\n试看天堑投鞭渡，不信中原不姓朱。",
      translation: "身穿白色丧服来到江边，立誓要消灭敌人；十万雄师，气势足以吞下吴地。且看我投鞭断流、渡过这天险长江，不信中原不能重归大明的旗下。",
      translationSource: "public-domain"
    },
    {
      id: "gs-103", title: "北风行", source: "《诚意伯文集》",
      dynasty: "明", author: "刘基", gradeGroup: "元明清诗",
      text: "城外萧萧北风起，城上健儿吹落耳。\n将军玉帐貂鼠衣，手持酒杯看雪飞。",
      translation: "城外北风萧萧地刮起来，城头上守边的健儿耳朵都快被吹落。将军在玉帐里穿着貂鼠皮衣，手拿酒杯，悠闲地看雪花飞舞。",
      translationSource: "public-domain"
    },
    {
      id: "gs-104", title: "首夏山中行吟", source: "《祝氏集略》",
      dynasty: "明", author: "祝允明", gradeGroup: "元明清诗",
      text: "梅子青，梅子黄，菜肥麦熟养蚕忙。\n山僧过岭看亭午，村女当垆笑客狂。",
      translation: "梅子青了又黄，菜长得肥、麦子熟了，家家忙着养蚕。山寺的僧人翻过山岭，看看已到正午；村中女子当垆卖酒，笑客人太过疏狂。",
      translationSource: "public-domain"
    },
    {
      id: "gs-105", title: "绝句", source: "《甫田集》",
      dynasty: "明", author: "文徵明", gradeGroup: "元明清诗",
      text: "公事归来衣雪埋，儿童灯火小茅斋。\n人家不必论贫富，才有读书声便佳。",
      translation: "办完公事回来，衣服上落满的雪几乎把人掩埋；茅屋里孩子们正对着灯火读书。居家过日子不必论贫富，只要有读书声，便是好的。",
      translationSource: "public-domain"
    },
    {
      id: "gs-106", title: "就义诗", source: "《杨忠愍公集》",
      dynasty: "明", author: "杨继盛", gradeGroup: "元明清诗",
      text: "浩气还太虚，丹心照千古。\n生平未报国，留作忠魂补。",
      translation: "一身浩然正气归还天地，一片赤诚丹心照耀千古。平生没能报答国家，就把这忠魂留下，来生再作弥补。",
      translationSource: "public-domain"
    },
    {
      id: "gs-107", title: "锦云川", source: "《灵岩山人诗集》",
      dynasty: "清", author: "毕沅", gradeGroup: "元明清诗",
      text: "月华霞彩映晴川，潋滟波光夺目妍。\n试唤乌篷乘兴去，一篙撑上水中天。",
      translation: "月光与霞彩映照着晴明的河川，波光潋滟，鲜艳得耀眼。且唤来一只乌篷船乘兴而去，一篙撑去，仿佛撑上了水中的青天。",
      translationSource: "public-domain"
    },
    {
      id: "gs-108", title: "对酒", source: "《秋瑾集》",
      dynasty: "清", author: "秋瑾", gradeGroup: "元明清诗",
      text: "不惜千金买宝刀，貂裘换酒也堪豪。\n一腔热血勤珍重，洒去犹能化碧涛。",
      translation: "不惜用千金去买一把宝刀，拿貂皮裘衣换酒喝也堪称豪迈。这一腔热血要好好珍重，将来洒出去，还能化作碧色的波涛。",
      translationSource: "public-domain"
    },

    /* ── 三 · 《古诗「非唐代」》卷 · 集内已有、补壳 1 条 ─────────────── */
    { id: "gs-109", title: "赠范晔诗", source: "《太平御览》", dynasty: "南朝·宋", author: "陆凯", gradeGroup: "六朝诗", textRef: "gushi-gs-44" },

    /* ── 四 · 跨部合流（不新挂壳，判重表里与已有那一条合成一篇） ──────── */
    {
      id: "gs-110", title: "明日歌", source: "《鹤滩集》",
      dynasty: "明", author: "钱福", gradeGroup: "元明清诗",
      text: "明日复明日，明日何其多！\n我生待明日，万事成蹉跎。\n世人若被明日累，春去秋来老将至。\n朝看水东流，暮看日西坠。\n百年明日能几何？请君听我明日歌。",
      translation: "一个明天又一个明天，明天是多么多啊！我这一生都在等待明天，结果万事都成了蹉跎。世上的人如果被「明日」拖累，春天过去、秋天到来，老年就要到了。早晨看河水向东流去，傍晚看太阳向西落下。一百年当中能有几个明天呢？请你听我唱一首《明日歌》。",
      translationSource: "public-domain"
    },
    { id: "gs-111", title: "垓下歌", source: "《史记·项羽本纪》", dynasty: "秦末", author: "项羽", gradeGroup: "汉魏诗" },
    { id: "gs-112", title: "短歌行", source: "《乐府诗集》", dynasty: "东汉", author: "曹操", gradeGroup: "汉魏诗" },
  ];

  root.POEMS_CORPUS_516A = POEMS;
})(typeof window !== "undefined" ? window : globalThis);
