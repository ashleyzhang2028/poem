// 古文观止（/guwen/ 页）端到端测试：目录完整性 + 卷次分组 + 收录状态 + 列表/搜索 + 阅读器
//
// 十二卷 167 篇这一轮**全部收齐**（每篇都有原文、白话译文、名句摘句）。
// 所以这里验的是：
//   1. 目录完整（167 篇 / 12 卷 / 篇名朝代作者出处齐备）；
//   2. 正文确实属于这一篇（逐篇用开篇句当指纹比对 —— 这条来自一次真实事故，
//      见文件中部 OPENINGS 那段说明）；
//   3. 已经不存在「待补」条目（引擎与样式的待补分支仍保留，见 assertions 末尾）。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const vm = require('vm');
const path = __dirname + '/../';

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

/* ---------- 一、数据层（纯 vm，无 DOM） ---------- */
const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
// 正文存储主表：被主表收编的条目只存归属（textRef），正文要按它取回
const { loadData, resolve } = require('./master-env');
loadData(sandbox, ['data/poems-classic.js', 'data/poems-guwen.js', 'data/site-index.js']);

const GW = resolve(sandbox, sandbox.POEMS_GUWEN, 'guwen');
chk(Array.isArray(GW) && GW.length === 167,
  '古文观止目录十二卷共 167 篇（实际 ' + (GW ? GW.length : 'undefined') + '）');

const ids = new Set();
let dup = 0;
GW.forEach(p => { if (ids.has(p.id)) dup++; ids.add(p.id); });
chk(dup === 0, '古文 id 无重复（重复 ' + dup + ' 个）');

chk(GW.every(p => p.title && p.source && p.dynasty && p.author),
  '每篇都有 标题/出处/朝代/作者');
// 出处 = 这一篇**真正的成书之处**（《左传》《震川先生集》……），
// 不是选本名《古文观止》—— 选本名退到 selection（Issue #69 收尾）。
chk(GW.every(p => p.source && p.source !== '《古文观止》'),
  '每篇的出处是真实来源书，不是选本名《古文观止》');
chk(GW.every(p => p.selection === '《古文观止》'),
  '每篇另用 selection 标出「从《古文观止》这本选里读到」');
chk(GW.every(p => /^卷[一二三四五六七八九十]+ /.test(p.gradeGroup || '')),
  '每篇都归入某一卷（gradeGroup 形如「卷N XX」）');

// 收录状态：十二卷 167 篇**全部收齐**（原文 + 白话译文 + 摘句）
const done = GW.filter(p => p.text && p.translation);
const pending = GW.filter(p => !p.text && !p.translation);
chk(done.length === GW.length,
  '167 篇全部收录（已收录 ' + done.length + ' · 待补 ' + pending.length + '）');
chk(pending.length === 0, '没有待补条目：目录里每一篇都能点开就读');
chk(done.length === sandbox.guwenDoneCount(),
  'guwenDoneCount() 与实际收录数一致（' + done.length + '）');
chk(done.length + pending.length === GW.length,
  '每一篇要么已收录、要么标着待补，没有「有正文没译文」的半成品'
  + '（已收录 ' + done.length + ' · 待补 ' + pending.length + '）');
chk(done.every(p => p.excerpt),
  '已收录的每一篇都给了列表用摘句（excerpt）');
// 古文观止原文属公有领域，译文据公认注本整理 → public-domain。
// ⚠️ 例外：与课内同篇的《桃花源记》《陋室铭》，正文收归主表后译文取自课本口径，
//    来源是 school（译文确实换成了教材那一份）。
const GW_SRC_OK = ['public-domain', 'school'];
chk(done.every(p => GW_SRC_OK.indexOf(p.translationSource) >= 0),
  '已收录的每一篇都标了译文来源且取值在允许范围（异常 ' +
  done.filter(p => GW_SRC_OK.indexOf(p.translationSource) < 0).length + ' 篇）');
chk(done.every(p => /^《.+》$/.test(p.source || '')),
  '每篇出处形如《书名》');

// 十二卷齐备
const groups = sandbox.getGuwenGroups();
chk(groups.length === 12, '按卷次聚合出 12 组（实际 ' + groups.length + '）');
chk(groups.reduce((n, g) => n + g.items.length, 0) === 167, '各组篇目合计 167');
const want = ['卷一 周文', '卷二 周文', '卷三 周文', '卷四 秦文', '卷五 汉文', '卷六 汉文',
  '卷七 六朝唐文', '卷八 唐文', '卷九 唐宋文', '卷十 宋文', '卷十一 宋文', '卷十二 明文'];
chk(want.every(w => groups.some(g => g.name === w)),
  '卷一至卷十二的卷次名齐备（缺 ' + want.filter(w => !groups.some(g => g.name === w)).join('/') + '）');

// 需求清单抽查：卷一名篇与常用选篇必须在库中
const need = ['郑伯克段于鄢', '曹刿论战', '烛之武退秦师', '蹇叔哭师', '召公谏厉王弭谤',
  '邹忌讽齐王纳谏', '唐雎不辱使命', '冯谖客孟尝君', '谏逐客书', '屈原列传', '过秦论（上）',
  '前出师表', '陈情表', '兰亭集序', '归去来兮辞', '桃花源记', '谏太宗十思疏', '滕王阁序',
  '陋室铭', '阿房宫赋'];
const titles = GW.map(p => p.title);
const missing = need.filter(t => !titles.includes(t));
chk(missing.length === 0, '清单里的名篇齐备（缺 ' + missing.join('/') + '）');


// 出处逐篇核对（Issue #69 收尾）：用户清单里「篇名 朝代 作者 出处」的那一列，
// 抽样覆盖十二卷、各来源书。抽查不通过就是「有人顺手把 source 改回选本名」
// 或「补录时填错了书」—— 这两类都只有逐个比对才查得出来。
const SOURCE_SPOT = [
  ['郑伯克段于鄢', '《左传》'], ['曹刿论战', '《左传》'], ['烛之武退秦师', '《左传》'],
  ['召公谏厉王弭谤', '《国语》'], ['邹忌讽齐王纳谏', '《战国策》'], ['冯谖客孟尝君', '《战国策》'],
  ['触龙说赵太后', '《战国策》'], ['唐雎不辱使命', '《战国策》'], ['谏逐客书', '《史记》'],
  ['卜居', '《楚辞》'], ['宋玉对楚王问', '《楚辞》'], ['五帝本纪赞', '《史记》'],
  ['报任安书', '《史记》'], ['过秦论（上）', '《新书》'], ['论贵粟疏', '《汉书》'],
  ['答苏武书', '《文选》'], ['前出师表', '《三国志》'], ['陈情表', '《文选》'],
  ['兰亭集序', '《兰亭帖》'], ['归去来兮辞', '《陶渊明集》'], ['桃花源记', '《陶渊明集》'],
  ['北山移文', '《文选》'], ['滕王阁序', '《王子安集》'], ['与韩荆州书', '《李太白集》'],
  ['春夜宴桃李园序', '《李太白集》'], ['陋室铭', '《全唐文》'], ['阿房宫赋', '《樊川文集》'],
  ['原道', '《昌黎先生集》'], ['捕蛇者说', '《柳河东集》'], ['小石城山记', '《柳河东集》'],
  ['待漏院记', '《小畜集》'], ['岳阳楼记', '《范文正公集》'], ['醉翁亭记', '《欧阳文忠公集》'],
  ['五代史伶官传序', '《新五代史》'], ['留侯论', '《东坡七集》'], ['前赤壁赋', '《东坡七集》'],
  ['阅江楼记', '《宋学士文集》'], ['卖柑者言', '《诚意伯文集》'], ['深虑论', '《逊志斋集》'],
  ['尊经阁记', '《王文成公全书》'], ['报刘一丈书', '《宗子相集》'], ['吴山图记', '《震川先生集》'],
  ['沧浪亭记', '《震川先生集》'], ['青霞先生文集序', '《茅鹿门集》'], ['亲政篇', '《震泽集》'],
  ['义田记', '《古文苑》'], ['司马季主论卜', '《诚意伯文集》']
];
const srcWrong = SOURCE_SPOT.filter(([t, s]) => {
  const p = GW.filter(x => x.title === t)[0];
  return !p || p.source !== s;
});
chk(srcWrong.length === 0,
  '抽样 47 篇的出处与清单一致（不符 ' + srcWrong.map(x => x[0]).join('/') + '）');

/**
 * 收录篇目的「正文确实属于这一篇」防线。
 *
 * 这条断言来自一次真实事故：整理语料时按「篇名反查」兜底配对，把
 * 《召公谏厉王弭谤》的正文挂到了《晏子不死君难》名下 —— 列表、阅读器、
 * 搜索全都正常，只有点进去读两行才会发现张冠李戴。
 * 所以每一篇「已收录」的，都要能用**它自己开头的那一句**在原文里对上号：
 * 开篇句是这一篇最稳定的指纹，且《古文观止》各篇开篇几乎不重样。
 */
const OPENINGS = {
  "郑伯克段于鄢": "初，郑武公娶于申，曰武姜",
  "周郑交质": "郑武公、庄公为平王卿士",
  "石碏谏宠州吁": "卫庄公娶于齐东宫得臣之妹，曰庄姜，美而无子，卫人所为赋《硕人》也",
  "臧僖伯谏观鱼": "春，公将如棠观鱼者",
  "郑庄公戒饬守臣": "郑伯将伐许",
  "臧哀伯谏纳郜鼎": "夏四月，取郜大鼎于宋",
  "季梁谏追楚师": "楚武王侵随，使薳章求成焉，军于瑕以待之",
  "曹刿论战": "十年春，齐师伐我",
  "齐桓公伐楚盟屈完": "四年春，齐侯以诸侯之师侵蔡",
  "宫之奇谏假道": "晋侯复假道于虞以伐虢",
  "齐桓下拜受胙": "王使宰孔赐齐侯胙，曰：",
  "阴饴甥对秦伯": "十月，晋阴饴甥会秦伯，盟于王城",
  "子鱼论战": "宋公及楚人战于泓",
  "寺人披见文公": "吕、郤畏逼，将焚公宫而弑晋侯",
  "介之推不言禄": "晋侯赏从亡者，介之推不言禄，禄亦弗及",
  "展喜犒师": "夏，齐孝公伐我北鄙",
  "烛之武退秦师": "晋侯、秦伯围郑，以其无礼于晋，且贰于楚也",
  "蹇叔哭师": "杞子自郑使告于秦曰：",
  "郑子家告赵宣子": "晋侯不见郑伯，以为贰于楚也",
  "王孙满对楚子": "楚子伐陆浑之戎，遂至于洛，观兵于周疆",
  "齐国佐不辱命": "晋师从齐师，入自丘舆，击马陉",
  "楚归晋知罃": "晋人归楚公子穀臣与连尹襄老之尸于楚，以求知罃",
  "吕相绝秦": "夏四月戊午，晋侯使吕相绝秦，曰：",
  "驹支不屈于晋": "会于向，为吴谋楚故也",
  "祁奚请免叔向": "晋侯问叔向之罪于乐王鲋",
  "子产告范宣子轻币": "范宣子为政，诸侯之币重",
  "晏子不死君难": "崔武子见棠姜而美之，遂取之",
  "季札观周乐": "吴公子札来聘，请观于周乐",
  "子产坏晋馆垣": "公薨之月，子产相郑伯以如晋，晋侯以我丧故，未之见也",
  "子产论尹何为邑": "子皮欲使尹何为邑",
  "子产却楚逆女以兵": "郑徐吾犯之妹美，公孙楚聘之矣，公孙黑又使强委禽焉",
  "子革对灵王": "楚子狩于州来，次于颍尾，使荡侯、潘子、司马督、嚣尹午、陵尹喜帅师围徐以惧吴",
  "子产论政宽猛": "郑子产有疾，谓子大叔曰：",
  "吴许越成": "吴子使来儆师伐齐",
  "祭公谏征犬戎": "穆王将征犬戎，祭公谋父谏曰：",
  "召公谏厉王弭谤": "厉王虐，国人谤王",
  "襄王不许请隧": "晋文公既定襄王于郏，王劳之以地，辞，请隧焉",
  "单子知陈必亡": "定王使单襄公聘于宋",
  "展禽论祀爰居": "海鸟曰爰居，止于鲁东门之外",
  "里革断罟匡君": "宣公夏滥于泗渊，里革断其罟而弃之，曰：",
  "敬姜论劳逸": "公父文伯退朝，朝其母，其母方绩",
  "叔向贺贫": "叔向见韩宣子，宣子忧贫，叔向贺之",
  "王孙圉论楚宝": "王孙圉聘于晋，定公飨之",
  "诸稽郢行成于吴": "吴王夫差起师伐越，越王勾践起师逆之",
  "申胥谏许越成": "吴王夫差乃告诸大夫曰：",
  "苏秦以连横说秦": "苏秦始将连横说秦惠王，曰：",
  "司马错论伐蜀": "司马错与张仪争论于秦惠王前",
  "范雎说秦王": "范雎至秦，王庭迎，谓范雎曰：",
  "邹忌讽齐王纳谏": "邹忌修八尺有余，而形貌昳丽",
  "颜斶说齐王": "齐宣王见颜斶，曰：",
  "冯谖客孟尝君": "齐人有冯谖者，贫乏不能自存，使人属孟尝君，愿寄食门下",
  "赵威后问齐使": "齐王使使者问赵威后",
  "庄辛论幸臣": "庄辛谓楚襄王曰：",
  "触龙说赵太后": "赵太后新用事，秦急攻之",
  "鲁仲连义不帝秦": "秦围赵之邯郸",
  "鲁共公择言": "梁王魏婴觞诸侯于范台，酒酣，请鲁君举觞",
  "唐雎不辱使命": "秦王使人谓安陵君曰：",
  "乐毅报燕王书": "昌国君乐毅为燕昭王合五国之兵而攻齐，下七十余城，尽郡县之以属燕",
  "谏逐客书": "臣闻吏议逐客，窃以为过矣",
  "卜居": "屈原既放，三年不得复见",
  "宋玉对楚王问": "楚襄王问于宋玉曰：",
  "五帝本纪赞": "太史公曰：学者多称五帝，尚矣",
  "项羽本纪赞": "太史公曰：吾闻之周生曰",
  "秦楚之际月表": "太史公读秦楚之际，曰：初作难，发于陈涉；虐戾灭秦，自项氏；拨乱诛暴，平定海内，卒践帝祚，成于汉家",
  "高祖功臣侯者年表": "太史公曰：古者人臣功有五品：以德立宗庙定社稷曰勋，以言曰劳，用力曰功，明其等曰伐，积日曰阅",
  "孔子世家赞": "太史公曰：《诗》有之：",
  "外戚世家序": "自古受命帝王及继体守文之君，非独内德茂也，盖亦有外戚之助焉",
  "伯夷列传": "夫学者载籍极博，犹考信于六艺",
  "管晏列传": "管仲夷吾者，颍上人也",
  "屈原列传": "屈原者，名平，楚之同姓也",
  "酷吏列传序": "孔子曰：",
  "游侠列传序": "韩子曰：",
  "滑稽列传": "孔子曰：",
  "货殖列传序": "老子曰：",
  "太史公自序": "太史公曰：",
  "报任安书": "古者富贵而名摩灭，不可胜记，唯倜傥非常之人称焉",
  "过秦论（上）": "秦孝公据崤函之固，拥雍州之地，君臣固守以窥周室，有席卷天下，包举宇内，囊括四海之意，并吞八荒之心",
  "治安策": "管子曰：",
  "论贵粟疏": "圣王在上，而民不冻饥者，非能耕而食之、织而衣之也，为开其资财之道也",
  "狱中上梁王书": "邹阳从梁孝王游，阳为人有智略，慷慨不苟合，介于羊胜、公孙诡之间",
  "司马相如上书谏猎": "臣闻物有同类而殊能者，故力称乌获，捷言庆忌，勇期贲、育",
  "答苏武书": "子卿足下：勤宣令德，策名清时，荣问休畅，幸甚幸甚",
  "前出师表": "先帝创业未半而中道崩殂，今天下三分，益州疲弊，此诚危急存亡之秋也",
  "后出师表": "先帝深虑汉、贼不两立，王业不偏安，故托臣以讨贼也",
  "陈情表": "臣密言：臣以险衅，夙遭闵凶",
  "兰亭集序": "永和九年，岁在癸丑，暮春之初，会于会稽山阴之兰亭，修禊事也",
  "归去来兮辞": "归去来兮，田园将芜胡不归！既自以心为形役，奚惆怅而独悲？悟已往之不谏，知来者之可追",
  "桃花源记": "晋太元中，武陵人捕鱼为业",
  "五柳先生传": "先生不知何许人也，亦不详其姓字",
  "北山移文": "钟山之英，草堂之灵，驰烟驿路，勒移山庭：\n夫以耿介拔俗之标，萧洒出尘之想，度白雪以方洁，干青云而直上，吾方知之矣",
  "谏太宗十思疏": "臣闻求木之长者，必固其根本；欲流之远者，必浚其泉源；思国之安者，必积其德义",
  "代李敬业讨武曌檄": "伪临朝武氏者，性非和顺，地实寒微",
  "滕王阁序": "豫章故郡，洪都新府",
  "与韩荆州书": "白闻天下谈士相聚而言曰：",
  "春夜宴桃李园序": "夫天地者，万物之逆旅也；光阴者，百代之过客也",
  "吊古战场文": "浩浩乎平沙无垠，敻不见人",
  "陋室铭": "山不在高，有仙则名",
  "阿房宫赋": "六王毕，四海一，蜀山兀，阿房出",
  "原道": "博爱之谓仁，行而宜之之谓义，由是而之焉之谓道，足乎己无待于外之谓德",
  "送孟东野序": "大凡物不得其平则鸣：草木之无声，风挠之鸣",
  "原毁": "古之君子，其责己也重以周，其待人也轻以约",
  "获麟解": "麟之为灵，昭昭也",
  "杂说一·龙说": "龙嘘气成云，云固弗灵于龙也",
  "杂说四·马说": "世有伯乐，然后有千里马",
  "祭十二郎文": "年月日，季父愈闻汝丧之七日，乃能衔哀致诚，使建中远具时羞之奠，告汝十二郎之灵：\n呜呼！吾少孤，及长，不省所怙，惟兄嫂是依",
  "柳子厚墓志铭": "子厚，讳宗元",
  "捕蛇者说": "永州之野产异蛇，黑质而白章，触草木尽死；以啮人，无御之者",
  "愚溪诗序": "灌水之阳有溪焉，东流入于潇水",
  "钴鉧潭西小丘记": "得西山后八日，寻山口西北道二百步，又得钴鉧潭",
  "小石城山记": "自西山道口径北，逾黄茅岭而下，有二道：其一西出，寻之无所得；其一少北而东，不过四十丈，土断而川分，有积石横当其垠",
  "待漏院记": "天道不言，而品物亨、岁功成者，何谓也？四时之吏，五行之佐，宣其气矣",
  "黄冈竹楼记": "黄冈之地多竹，大者如椽",
  "书洛阳名园记后": "洛阳处天下之中，挟殽、黾之阻，当秦、陇之襟喉，而赵、魏之走集，盖四方必争之地也",
  "严先生祠堂记": "先生，汉光武之故人也",
  "岳阳楼记": "庆历四年春，滕子京谪守巴陵郡",
  "谏院题名记": "古者谏无官，自公卿大夫至于工商，无不得谏者",
  "义田记": "范文正公，苏人也",
  "袁州州学记": "皇帝二十有三年，制诏州县立学",
  "朋党论": "臣闻朋党之说，自古有之，惟幸人君辨其君子小人而已",
  "纵囚论": "信义行于君子，而刑戮施于小人",
  "释秘演诗集序": "予少以进士游京师，因得尽交当世之贤豪",
  "梅圣俞诗集序": "予闻世谓诗人少达而多穷，夫岂然哉？盖世所传诗者，多出于古穷人之辞也",
  "送杨寘序": "予尝有幽忧之疾，退而闲居，不能治也",
  "五代史伶官传序": "呜呼！盛衰之理，虽曰天命，岂非人事哉！原庄宗之所以得天下，与其所以失之者，可以知之矣",
  "五代史宦者传论": "自古宦者乱人之国，其源深于女祸",
  "相州昼锦堂记": "仕宦而至将相，富贵而归故乡，此人情之所荣，而今昔之所同也",
  "丰乐亭记": "修既治滁之明年，夏，始饮滁水而甘",
  "醉翁亭记": "环滁皆山也",
  "秋声赋": "欧阳子方夜读书，闻有声自西南来者，悚然而听之，曰：",
  "祭石曼卿文": "维治平四年七月日，具官欧阳修，谨遣尚书都省令史李敭，至于太清，以清酌庶羞之奠，致祭于亡友曼卿之墓下，而吊之以文",
  "泷冈阡表": "呜呼！惟我皇考崇公，卜吉于泷冈之六十年，其子修始克表于其阡",
  "留侯论": "古之所谓豪杰之士者，必有过人之节",
  "晁错论": "天下之患，最不可为者，名为治平无事，而其实有不测之忧",
  "上梅直讲书": "轼每读《诗》至《鸱鸮》，读《书》至《君奭》，常窃悲周公之不遇",
  "喜雨亭记": "亭以雨名，志喜也",
  "凌虚台记": "国于南山之下，宜若起居饮食与山接也",
  "超然台记": "凡物皆有可观",
  "放鹤亭记": "熙宁十年秋，彭城大水",
  "石钟山记": "《水经》云：",
  "前赤壁赋": "壬戌之秋，七月既望，苏子与客泛舟游于赤壁之下",
  "后赤壁赋": "是岁十月之望，步自雪堂，将归于临皋",
  "潮州韩文公庙碑": "匹夫而为百世师，一言而为天下法",
  "送天台陈庭学序": "西南山水，惟川蜀最奇",
  "阅江楼记": "金陵为帝王之州",
  "司马季主论卜": "东陵侯既废，过司马季主而卜焉",
  "卖柑者言": "杭有卖果者，善藏柑，涉寒暑不溃",
  "深虑论": "虑天下者，常图其所难，而忽其所易；备其所可畏，而遗其所不疑",
  "豫让论": "士君子立身事主，既名知己，则当竭尽智谋，忠告善道，销患于未形，保治于未然，俾身全而主安",
  "亲政篇": "《易》之《泰》曰：",
  "尊经阁记": "经，常道也",
  "象祠记": "灵博之山，有象祠焉",
  "瘗旅文": "维正德四年秋月三日，有吏目云自京来者，不知其名氏，携一子一仆，将之任，过龙场，投宿土苗家",
  "报刘一丈书": "数千里外，得长者时赐一书，以慰长想，即亦甚幸矣；何至更辱馈遗，则不才益将何以报焉？书中情意甚殷，即长者之不忘老父，知老父之念长者深也",
  "吴山图记": "吴、长洲二县，在郡治所，分境而治",
  "沧浪亭记": "予以罪废，无所归",
  "青霞先生文集序": "青霞沈君，由锦衣经历上书诋宰执，宰执深疾之",
  "齐桓晋文之事": "齐宣王问曰：",
  "春王正月": "元年者何？君之始年也",
  "宋人及楚人平": "外平不书，此何以书？",
  "吴子使札来聘": "吴无君、无大夫，此何以有君、有大夫？",
  "虞师晋师灭夏阳": "非国而曰灭，重夏阳也",
  "晋献公杀世子申生": "晋献公将杀其世子申生",
  "曾子易箦": "曾子寝疾，病",
  "有子之言似夫子": "有子问于曾子曰：",
  "公子重耳对秦客": "晋献公之丧，秦穆公使人吊公子重耳",
  "杜蒉扬觯": "知悼子卒，未葬，平公饮酒",
  "晋献文子成室": "晋献文子成室，晋大夫发焉",
};
const misassigned = done.filter(p => {
  const open = OPENINGS[p.title];
  return open && String(p.text).replace(/\s/g, '').indexOf(open.replace(/\s/g, '')) < 0;
});
chk(misassigned.length === 0,
  '已收录篇目的正文与篇名对得上（每篇开篇句能对上号；错配：'
  + misassigned.map(p => p.title).join('/') + '）');
// 反向：上面这份「开篇句清单」要覆盖全部已收录篇目，避免日后新增篇目时忘了补
const uncovered = done.filter(p => !OPENINGS[p.title]);
chk(uncovered.length === 0,
  '开篇句清单覆盖全部已收录篇目（漏：' + uncovered.map(p => p.title).join('/') + '）');

// 长篇场景：卷一的《郑伯克段于鄢》是长篇（验证长文阅读）
const zw = GW.filter(p => p.title === '郑伯克段于鄢')[0] || {};
chk(zw.author === '左丘明' && zw.dynasty === '东周', '《郑伯克段于鄢》作者左丘明 · 朝代东周');
chk(zw.gradeGroup === '卷一 周文', '《郑伯克段于鄢》归入「卷一 周文」（实际 ' + zw.gradeGroup + '）');
chk(/郑武公娶于申/.test(zw.text || ''), '原文开篇「郑武公娶于申」齐备');
chk(/郑武公/.test(zw.translation || '') && /姜氏/.test(zw.translation || ''),
  '白话译文把人物译成今语（含「郑武公」「姜氏」）');
chk((zw.text || '').length > 300, '《郑伯克段于鄢》是长篇（>300 字，验证长文场景）');

// 「选本名」不当出处 —— 这一条来自一次真实的**整篇丢失**：
//   当初补录《送孟东野序》时把 source 写成选本名《古文观止》，随后另一轮
//   「补齐十二卷目录」把整个数据文件重写了一遍，这篇因为「出处 = 选本名」这个
//   特征列不进任何一卷的真实来源清单，便被静默丢掉 —— 目录、分组、计数、
//   搜索全都不报错，只是少了一篇。上面那条 `source !== '《古文观止》'` 正是
//   为了让「重写时按 source 归类」这件事把每一篇都算进去，这里再点名守一遍，
//   免得日后又有人图省事把 source 改回选本名。
const mustHave = ['送孟东野序', '原道', '杂说四·马说', '祭十二郎文', '捕蛇者说'];
chk(mustHave.every(t => titles.includes(t)),
  '卷八 唐文的名篇都在（缺 ' + mustHave.filter(t => !titles.includes(t)).join('/') + '）');
chk(GW.filter(p => p.title === '送孟东野序')[0].source === '《昌黎先生集》',
  '《送孟东野序》的出处记《昌黎先生集》，选本名退到 selection'
  + '（出处写成选本名的那一篇，曾在重写数据文件时整篇丢失）');

// 不能污染古诗词主库与每日计划
chk(sandbox.POEMS_ALL === undefined, '古文不写入 POEMS_ALL，不影响每日计划');

// 站点总索引：只收「有正文」的篇目，待补的不进搜索
const IDX = sandbox.SITE_INDEX;
const idxGuwen = IDX.filter(x => x.book === 'guwen' && !x.isBook);
chk(idxGuwen.length === done.length,
  '总索引只含已收录的 ' + done.length + ' 篇（实际 ' + idxGuwen.length + '）');
chk(idxGuwen.every(x => x.text && x.translation),
  '总索引里的古文条目都带正文与译文（搜到就能读）');
chk(IDX.some(x => x.book === 'guwen' && x.isBook && x.page === '/guwen/'),
  '总索引里古文观止集子自身指向 /guwen/');
chk(IDX.every(x => x.id !== 'gwj-1' || x.book), '古文条目都带集子归属');

/* ---------- 二、页面层（jsdom） ---------- */
const html = fs.readFileSync(path + 'guwen/index.html', 'utf8');
const scriptOrder = html.match(/<script src="([^"]+)"><\/script>/g).map(s => s.match(/src="([^"]+)"/)[1]);
chk(scriptOrder.indexOf('data/poems-guwen.js') >= 0, '页面引用了古文观止数据');
chk(scriptOrder.indexOf('js/reader-core.js') >= 0, '页面加载了 js/reader-core.js 引擎');
chk(scriptOrder.indexOf('js/reader-core.js') < scriptOrder.indexOf('js/guwen.js'),
  '引擎排在挂载脚本 js/guwen.js 之前');
chk(html.indexOf('data-nav="guwen"') >= 0, '页面声明了 guwen 页签');

const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://local.test/guwen/', base: 'https://local.test/guwen/' });
const w = dom.window;
w.scrollTo = function () {};
scriptOrder.forEach(f => {
  const el = w.document.createElement('script');
  el.textContent = fs.readFileSync(path + f, 'utf8');
  w.document.body.appendChild(el);
});

setTimeout(() => {
  const d = w.document;

  // 重复 id 防线
  ['guwen/index.html', 'songci/index.html', 'classic/index.html'].forEach(f => {
    const doc = new JSDOM(fs.readFileSync(path + f, 'utf8')).window.document;
    const seen = {};
    const dups = [];
    doc.querySelectorAll('[id]').forEach(el => {
      if (seen[el.id]) { if (dups.indexOf(el.id) < 0) dups.push(el.id); } else seen[el.id] = 1;
    });
    chk(dups.length === 0, f + ' 无重复 id（重复：' + dups.join(', ') + '）');
  });

  chk(d.querySelectorAll('#gw-list .item').length === 167,
    '列表渲染 167 篇目录（实际 ' + d.querySelectorAll('#gw-list .item').length + '）');
  chk(d.querySelectorAll('#gw-list .item.pending').length === 0,
    '列表里没有「待补」条目（167 篇全都有正文与译文）');
  chk(d.querySelectorAll('#gw-list .item-reason.pending').length === 0,
    '列表里也没有「待补」小标');
  chk(d.querySelector('#gw-count').textContent === '0 / 167 篇',
    '顶部显示 0 / 167 篇：' + d.querySelector('#gw-count').textContent);

  // 挂载点对外接口
  const api = w.ReaderEngine.current;
  chk(!!api, '引擎挂上了古文观止实例');
  chk(api.total() === 167, '实例 total() 为 167');

  // 已读键：古文与别的集子各存各的
  const gsrc = fs.readFileSync(path + 'js/guwen.js', 'utf8');
  const gwReadKey = (gsrc.match(/readStore:\s*"([^"]+)"/) || [])[1];
  chk(gwReadKey === 'poem_guwen_read_v1',
    '古文观止用独立的已读键 poem_guwen_read_v1（实际 ' + gwReadKey + '）');

  // 卷次顺序表必须在挂载脚本里显式给出，且覆盖十二卷
  chk(/卷一 周文/.test(gsrc) && /卷十二 明文/.test(gsrc),
    '挂载脚本给出了卷一至卷十二的卷次顺序');

  // 打开一篇已收录的：标题 / 作者 / 正文写入阅读器
  api.open('gwj-1');
  const title = d.querySelector('#rd-title').textContent;
  chk(title === '郑伯克段于鄢', '可打开指定篇目（gwj-1 → ' + title + '）');
  chk(/左丘明/.test(d.querySelector('#rd-meta').textContent), '阅读器展示了作者');
  // Issue #69 收尾：列表与阅读器里的「出处」都必须是真实来源书《左传》，
  // 选本名《古文观止》只能作为淡色括注出现，不能顶替出处。
  const firstItem = d.querySelector('#gw-list .item[data-id="gwj-1"]');
  const itemMeta = firstItem.querySelector('.item-meta').textContent;
  chk(itemMeta.includes('《左传》'), '列表条目显示真实出处《左传》（' + itemMeta + '）');
  chk(itemMeta.includes('《古文观止》'),
    '列表条目另以括注标出选本《古文观止》');
  const rdMeta = d.querySelector('#rd-meta').textContent;
  chk(rdMeta.includes('《左传》'), '阅读器显示真实出处《左传》');
  chk(rdMeta.includes('《古文观止》'), '阅读器另标出选本《古文观止》');
  const plain = d.querySelector('#rd-text').textContent
    .replace(/[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹ·]+/g, '').replace(/\s/g, '');
  chk(/郑武公娶于申/.test(plain), '正文已写入阅读器');
  chk(/郑武公/.test(d.querySelector('#rd-trans-text').textContent), '白话译文已写入阅读器');

  // 抽查几篇后补的：正文与译文都要真的写进阅读器（不是空壳）
  [['gwj-68', '伯夷列传', '夫学者载籍极博'], ['gwj-127', '醉翁亭记', '环滁皆山也'],
   ['gwj-155', '青霞先生文集序', '青霞沈君']].forEach(([id, name, opening]) => {
    api.open(id);
    const got = d.querySelector('#rd-title').textContent;
    // 正文里的生字会被注音（ruby），textContent 会夹进拼音字母 —— 先剥掉拼音再比
    const body = d.querySelector('#rd-text').textContent
      .replace(/[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹ·]+/g, '').replace(/\s/g, '');
    const trans = d.querySelector('#rd-trans-text').textContent;
    chk(got === name && body.indexOf(opening) >= 0,
      name + ' 可打开，正文写入阅读器');
    chk(trans.length > 60, name + ' 的白话译文已写入阅读器（' + trans.length + ' 字）');
  });
  // 待补分支仍然可用：把一篇的正文 / 译文清空后重开，应给出「尚在整理中」
  // 而不是白屏。（引擎与样式的待补机制不因本集收齐而删除 —— 下一部集子还要用它。）
  //
  // ⚠️ 清的是**主表里那一份**，不是条目上的。
  //    正文收归主表后条目上只剩 textRef，引擎渲染时按 textRef 到主表取 ——
  //    只改条目上的 `text` 已经影响不到页面（改了个没人读的字段，
  //    于是这条断言测的东西悄悄失效：页面照旧显示正文，测试却以为验过了）。
  const GM = w.TEXT_MASTER || [];
  const masterRows = GM.filter(m => (m.entries || []).indexOf('guwen-gwj-1') >= 0);
  chk(masterRows.length === 1, '《郑伯克段于鄢》在主表里正好登记一条（待补分支的试验对象）');
  const keep = { text: masterRows[0].text, translation: masterRows[0].translation };
  masterRows[0].text = '';
  masterRows[0].translation = '';
  // 重新挂一个实例（换一个 root 与一份新配置）。
  // ⚠️ 必须**重新 mount**，不能只改数据再 open 一次：引擎在 mount 时就把每一篇的
  //    textRef 展开好了，`itemsById` 里留的是展开后的那一份 —— 只改主表 / 条目，
  //    页面照旧显示旧正文，这条断言就成了「看着绿、其实什么都没验」。
  //    这也正是「清空正文」这个场景的真实形态：语料本来就是重新加载的。
  const box = d.createElement('div');
  box.setAttribute('data-gw-root', '');
  // 阅读器内部用 class（.rd-title / .rd-meta / .rd-trans-src）与 data-gw 两种找法，
  // 这里照 guwen/index.html 的原样给齐，别只给一半 —— 缺一个就是 openReader 里
  // 对 null 设 textContent，整段以 TypeError 断掉（看着像引擎坏了，其实是替身没搭全）。
  box.innerHTML = '<div data-gw="list"></div>' +
    '<section id="probe-reader" data-gw="reader">' +
    '<h2 class="rd-title"></h2><div class="rd-meta"></div>' +
    '<div data-gw="text"></div>' +
    '<div class="rd-trans-text"></div>' +
    '<div class="rd-trans-src"></div>' +
    '</section>';
  d.body.appendChild(box);
  const probe = w.ReaderEngine.mount({
    id: 'guwen-probe',
    items: w.POEMS_GUWEN.map(p => Object.assign({}, p)),
    root: box,
    reader: '#probe-reader',
    groupOrder: [],
    words: { readStore: 'poem_probe_read_v1', pendingText: '本篇原文尚在整理中',
      pendingTranslation: '本篇白话译文尚在整理中' }
  });
  chk(!!probe, '待补分支试验用的实例已挂上');
  probe.open('gwj-1');
  const probeText = box.querySelector('[data-gw="text"]').textContent;
  const probeTrans = box.querySelector('.rd-trans-text').textContent;
  chk(/尚在整理中/.test(probeText),
    '正文为空时给出「原文尚在整理中」的说明（引擎的待补分支仍生效）');
  chk(/尚在整理中/.test(probeTrans),
    '译文为空时给出「白话译文尚在整理中」的说明');
  masterRows[0].text = keep.text;
  masterRows[0].translation = keep.translation;
  box.remove();
  api.close();

  // 搜索：按作者筛，且只筛古文这一部
  api.setKeyword('左丘明');
  const nZuo = d.querySelectorAll('#gw-list .item').length;
  chk(nZuo > 0 && nZuo < 167, '按作者「左丘明」搜索得到子集（' + nZuo + ' 篇）');
  api.setKeyword('');

  console.log('');
  console.log(fails === 0 ? '🎉 古文观止测试全部通过' : '❌ 古文观止测试 ' + fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
}, 120);
