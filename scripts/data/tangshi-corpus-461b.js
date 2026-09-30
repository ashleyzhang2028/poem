/* ==========================================================================
   唐诗 · 补充语料（二）（Issue #461 · 大会 / 阅读大赛冷门拓展）
   --------------------------------------------------------------------------
   用户清单里「唐代的诗一律归唐诗」的后续：这一份补的是**上海古诗文大会
   历年决赛 / 附加阅读**里出现、而全站此前没有的唐诗。

   已在他处的按现行判重表合流，此处不重录（正文比对，不看题名）：
     听蜀僧浚弹琴（李白）  —— 已有 ts-108《听蜀僧濬弹琴》（濬 / 浚 异体）
     楚江怀古·其一（马戴） —— 已有 ts-167《楚江怀古》
     台城（韦庄）          —— 已有 ts-292（正文即台城，本轮把它的题名订正为《台城》）
     春宫曲（王昌龄）      —— 已有 ts-257《春宫曲》
     江乡故人偶集客舍（戴叔伦）—— 已有 ts-148
   ========================================================================== */
(function (root) {
  "use strict";

  var POEMS = [
    {
      id: "ts-346", title: "山中", source: "《王子安集》", dynasty: "唐",
      author: "王勃", gradeGroup: "卷七 五言绝句",
      text: "长江悲已滞，万里念将归。\n况属高风晚，山山黄叶飞。",
      translation: "长江仿佛因我的悲愁而凝滞不流，万里之外我思念着将归的故乡。\n何况又逢秋风萧瑟的傍晚，满山满岭的黄叶纷纷飘落。",
      translationSource: "public-domain"
    },
    {
      id: "ts-347", title: "秋夜喜遇王处士", source: "《王无功文集》", dynasty: "唐",
      author: "王绩", gradeGroup: "卷七 五言绝句",
      text: "北场芸藿罢，东皋刈黍归。\n相逢秋月满，更值夜萤飞。",
      translation: "在北边的场圃锄完豆子，从东边的高地收割黍子归来。\n与你相逢，正当秋月圆满；更赶上夜色里萤火虫飞舞。",
      translationSource: "public-domain"
    },
    {
      id: "ts-348", title: "丹阳送韦参军", source: "《全唐诗》", dynasty: "唐",
      author: "严维", gradeGroup: "卷八 七言绝句",
      text: "丹阳郭里送行舟，一别心知两地秋。\n日晚江南望江北，寒鸦飞尽水悠悠。",
      translation: "在丹阳城外送你乘舟远行，一别之后，我知道两地都是秋色。\n傍晚时我在江南遥望江北，寒鸦飞尽了，只有江水悠悠不尽。",
      translationSource: "public-domain"
    },
    {
      id: "ts-349", title: "与浩初上人同看山寄京华亲故", source: "《柳河东集》", dynasty: "唐",
      author: "柳宗元", gradeGroup: "卷八 七言绝句",
      text: "海畔尖山似剑铓，秋来处处割愁肠。\n若为化得身千亿，散上峰头望故乡。",
      translation: "海边的尖山像剑锋一样，秋天来了，处处都割着我的愁肠。\n怎样才能化作千万个身子，散落到各个峰顶去遥望故乡？",
      translationSource: "public-domain"
    },
    {
      id: "ts-350", title: "鹧鸪", source: "《云台编》", dynasty: "唐",
      author: "郑谷", gradeGroup: "卷六 七言律诗",
      text: "暖戏烟芜锦翼齐，品流应得近山鸡。\n雨昏青草湖边过，花落黄陵庙里啼。\n游子乍闻征袖湿，佳人才唱翠眉低。\n相呼相应湘江阔，苦竹丛深日向西。",
      translation: "在暖烟笼罩的草地嬉戏，锦缎般的双翼整齐，它的品位应当与山鸡相近。\n在雨昏中从青草湖边飞过，在落花里于黄陵庙中啼鸣。\n游子乍一听就湿了衣袖，佳人刚开口唱就低垂了翠眉。\n在辽阔的湘江上彼此呼应，苦竹丛深，夕阳已偏西。",
      translationSource: "public-domain"
    },
    {
      id: "ts-351", title: "小松", source: "《唐风集》", dynasty: "唐",
      author: "杜荀鹤", gradeGroup: "卷七 五言绝句",
      text: "自小刺头深草里，而今渐觉出蓬蒿。\n时人不识凌云木，直待凌云始道高。",
      translation: "它从小就冒尖长在深草里，如今渐渐高出蓬蒿。\n世上的人不认识这是将来能高耸入云的树，直到它真的长得凌云才说它高。",
      translationSource: "public-domain"
    },
    {
      id: "ts-352", title: "宿翠微寺", source: "《全唐诗》", dynasty: "唐",
      author: "马戴", gradeGroup: "卷五 五言律诗",
      text: "处处松阴满，樵开一径通。\n鸟归云壑静，僧语石楼空。\n积翠含微月，遥泉韵细风。\n经行心不厌，忆在故山中。",
      translation: "到处都满是松树的浓荫，樵夫开出一条小路相通。\n鸟儿归巢，云谷静寂；僧人谈语，石楼空阔。\n层层翠色含着淡淡的月色，远处泉声应和着微风。\n在此经行，心里不觉厌倦，仿佛回到了故乡的山中。",
      translationSource: "public-domain"
    },
    {
      id: "ts-353", title: "赠卖松人", source: "《全唐诗》", dynasty: "唐",
      author: "于武陵", gradeGroup: "卷五 五言律诗",
      text: "入市虽求利，怜君意独真。\n劚将寒涧树，卖与翠楼人。\n瘦叶几经雪，淡花应少春。\n长安重桃李，徒染六街尘。",
      translation: "你入市虽然是为求利，我怜惜你心意独真。\n挖来寒涧边的松树，要卖给翠楼中的贵人。\n瘦叶几经霜雪，淡花该少了春意。\n可长安城里看重的是桃李，这松树只是白白沾染了六街的尘土。",
      translationSource: "public-domain"
    },
    {
      id: "ts-354", title: "贫女", source: "《全唐诗》", dynasty: "唐",
      author: "秦韬玉", gradeGroup: "卷六 七言律诗",
      text: "蓬门未识绮罗香，拟托良媒益自伤。\n谁爱风流高格调，共怜时世俭梳妆。\n敢将十指夸针巧，不把双眉斗画长。\n苦恨年年压金线，为他人作嫁衣裳。",
      translation: "生在蓬门小户，从没见识过绮罗的芳香，想托个好媒人，反而更添感伤。\n有谁赏识风流高雅的格调？人们都喜爱时兴的俭朴梳妆。\n我敢用十指夸耀针线精巧，却不愿描长双眉与人争妍。\n最恨年年压线刺绣，都是替别人做嫁衣。",
      translationSource: "public-domain"
    },
    {
      id: "ts-355", title: "金乡送韦八之西京", source: "《李太白集》", dynasty: "唐",
      author: "李白", gradeGroup: "卷五 五言律诗",
      text: "客自长安来，还归长安去。\n狂风吹我心，西挂咸阳树。\n此情不可道，此别何时遇？\n望望不见君，连山起烟雾。",
      translation: "你从长安来，又要回到长安去。\n狂风把我的心思吹起，向西挂在了咸阳的树上。\n这份情意没法说出口，此番分别何时才能重逢？\n一次次远望也看不见你，只有连绵的山上腾起烟雾。",
      translationSource: "public-domain"
    },
    {
      id: "ts-356", title: "长安秋望", source: "《樊川文集》", dynasty: "唐",
      author: "杜牧", gradeGroup: "卷七 五言绝句",
      text: "楼倚霜树外，镜天无一毫。\n南山与秋色，气势两相高。",
      translation: "楼阁高倚在经霜的树林之外，明净的天空像镜子般没有一丝云翳。\n终南山与这秋色，气象势态两相争高。",
      translationSource: "public-domain"
    },
    {
      id: "ts-357", title: "长安月夜", source: "《白氏长庆集》", dynasty: "唐",
      author: "白居易", gradeGroup: "卷五 五言律诗",
      text: "喧喧车骑帝王州，羁病无心逐胜游。\n明月春风三五夜，万人行乐一人愁。",
      translation: "车马喧闹，这是帝王之都；我羁旅抱病，无心去追逐名胜游赏。\n明月的春风，正月十五的夜晚，万人都在行乐，只有我一人发愁。",
      translationSource: "public-domain"
    },
    {
      id: "ts-358", title: "宿云门寺阁", source: "《全唐诗》", dynasty: "唐",
      author: "孙逖", gradeGroup: "卷五 五言律诗",
      text: "香阁东山下，烟花象外幽。\n悬灯千嶂夕，卷幔五湖秋。\n画壁余鸿雁，纱窗宿斗牛。\n更疑天路近，梦与白云游。",
      translation: "香阁坐落在东山下，烟花缭绕，有尘世之外的幽静。\n高悬的灯火映着千重山嶂的暮色，卷起帷幔，五湖已是一片秋光。\n彩画的壁上只剩鸿雁，纱窗外仿佛宿着斗牛星宿。\n更疑心天路很近，梦里与白云同游。",
      translationSource: "public-domain"
    },
    {
      /* 与 ts-292 是两首：ts-292 正文是《台城》（江雨霏霏江草齐），
         这首才是《金陵图》——「谁谓伤心画不成」。 */
      id: "ts-359", title: "金陵图", source: "《浣花集》", dynasty: "唐",
      author: "韦庄", gradeGroup: "卷八 七言绝句",
      text: "谁谓伤心画不成，画人心逐世人情。\n君看六幅南朝事，老木寒云满故城。",
      translation: "谁说伤心的景致画不成？只是画家的心追逐着世俗的人情。\n你看这六幅描绘南朝旧事的画，老树寒云布满整座故城。",
      translationSource: "public-domain"
    }
  ];

  root.TANGSHI_CORPUS_461B = POEMS;
})(typeof window !== "undefined" ? window : globalThis);
