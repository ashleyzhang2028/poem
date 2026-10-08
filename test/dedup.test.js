const fs = require('fs');
const vm = require('vm');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const sb = { window: {}, console };
sb.window = sb;
vm.createContext(sb);
const DATA = [
  'data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js', 'data/poems-5.js',
  'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js', 'data/poems-9.js', 'data/poems-10.js',
  'data/poems-11.js', 'data/poems-12.js', 'data/index.js', 'data/poems-classic.js',
  'data/poems-tangshi.js', 'data/poems-gushi.js', 'data/poems-songci.js', 'data/poems-yuefu.js', 'data/poems-guwen.js', 'data/poems-zhaoming.js', 'data/poems-yuanqu.js',
  'data/site-index.js', 'data/works-map.js', 'data/works-index.js'
];

const { loadData } = require('./master-env');
loadData(sb, DATA);
const ALL = sb.POEMS_ALL;
const byId = {};
ALL.forEach(p => { byId[p.id] = p; });
const WI = sb.WorksIndex;

const norm = t => String(t || '').replace(/[\s\u3000]+/g, '')
  .replace(/[，。！？；：、,.!?;:"'“”‘’「」『』《》〈〉（）()\[\]【】—－\-…·~～]/g, '');

chk(ALL.length === 251, '课内诗词总数 251（去重前 273，删掉 22 条重复条目；实际 ' + ALL.length + '）');

const REMOVED = [
  ['xx3-10', '绝句', '三年级下', 'poems-xx2-12', '二年级下'],
  ['xx4-14', '望洞庭', '四年级下', 'poems-xx3-07', '三年级上'],
  ['xx5-20', '四时田园杂兴（其二）', '五年级下', 'poems-xx4-09', '四年级下'],
  ['cz7-04', '天净沙·秋思', '七年级上', 'poems-xx6-20', '六年级下'],
  ['gz11-13', '书愤', '高二下', 'poems-gz10-23', '高一上'],
  ['gz11-21', '临安春雨初霁', '高二下', 'poems-gz10-24', '高一上'],
  ['gz12-04', '登高', '高三上', 'poems-gz10-05', '高一上'],
  ['gz12-06', '念奴娇·赤壁怀古', '高三上', 'poems-gz10-07', '高一上'],
  ['gz12-07', '永遇乐·京口北固亭怀古', '高三上', 'poems-gz10-08', '高一上'],
  ['gz12-12', '师说', '高三下', 'poems-gz10-11', '高一上'],
  ['gz12-23', '李凭箜篌引', '高三下', 'poems-gz11-11', '高二下'],
  ['gz12-24', '静女', '高三下', 'poems-gz10-14', '高一下'],

  ['gz12-10', '岳阳楼记', '高三上', 'poems-cz9-04', '九年级上'],
  ['gz12-11', '劝学', '高三下', 'poems-gz10-10', '高一上'],
  ['gz12-08', '阿房宫赋', '高三上', 'poems-gz10-19', '高一下'],
  ['gz12-09', '赤壁赋', '高三上', 'poems-gz10-12', '高一上'],
  ['gz12-03', '蜀道难', '高三上', 'poems-gz11-14', '高二上'],
  ['gz12-13', '陈情表', '高三下', 'poems-gz11-15', '高二上'],
  ['gz12-14', '归去来兮辞', '高三下', 'poems-gz11-16', '高二上'],
  ['gz12-05', '琵琶行', '高三上', 'poems-gz10-06', '高一上'],
  ['gz12-22', '燕歌行', '高三下', 'poems-gz11-10', '高二上'],
  ['gz11-18', '望海潮·东南形胜', '高二上', 'poems-gz10-17', '高一下'],
];
const PROSE_BY_ID = {};
['data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js', 'data/poems-5.js',
 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js', 'data/poems-9.js', 'data/poems-10.js',
 'data/poems-11.js', 'data/poems-12.js'].forEach(f => {
  const src = fs.readFileSync(__dirname + '/../' + f, 'utf8');
  const m = src.match(/window\.POEMS_(\d+) = (\[[\s\S]*\]);/);
  const arr = vm.runInNewContext('(' + m[2] + ')');

  arr.forEach(p => { PROSE_BY_ID[p.id] = sb.masterTextOf ? sb.masterTextOf(p, 'poems') : p; });
});

const missing = REMOVED.filter(r => PROSE_BY_ID[r[0]]);
chk(missing.length === 0, '被删的高年级重复条目已从课内数据里消失（残留：' +
  (missing.map(r => r[0]).join('、') || '无') + '）');
const kept = REMOVED.filter(r => !PROSE_BY_ID[r[3].replace('poems-', '')]);
chk(kept.length === 0, '低年级版本全部保留（误删：' + (kept.map(r => r[3]).join('、') || '无') + '）');

const KEPT_TEXT = {
  'poems-xx2-12': '迟日江山丽，春风花草香。泥融飞燕子，沙暖睡鸳鸯。',
  'poems-xx3-07': '湖光秋月两相和，潭面无风镜未磨。遥望洞庭山水翠，白银盘里一青螺。',
  'poems-xx4-09': '梅子金黄杏子肥，麦花雪白菜花稀。日长篱落无人过，惟有蜻蜓蝴蝶飞。',
  'poems-xx6-20': '枯藤老树昏鸦，小桥流水人家，古道西风瘦马。夕阳西下，断肠人在天涯。',
  'poems-gz10-23': '早岁那知世事艰，中原北望气如山。楼船夜雪瓜洲渡，铁马秋风大散关。塞上长城空自许，镜中衰鬓已先斑。出师一表真名世，千载谁堪伯仲间！',
  'poems-gz10-24': '世味年来薄似纱，谁令骑马客京华？小楼一夜听春雨，深巷明朝卖杏花。矮纸斜行闲作草，晴窗细乳戏分茶。素衣莫起风尘叹，犹及清明可到家。',
  'poems-gz10-05': '风急天高猿啸哀，渚清沙白鸟飞回。无边落木萧萧下，不尽长江滚滚来。万里悲秋常作客，百年多病独登台。艰难苦恨繁霜鬓，潦倒新停浊酒杯。',
  'poems-gz10-07': '大江东去，浪淘尽，千古风流人物。故垒西边，人道是，三国周郎赤壁。乱石穿空，惊涛拍岸，卷起千堆雪。江山如画，一时多少豪杰。遥想公瑾当年，小乔初嫁了，雄姿英发。羽扇纶巾，谈笑间，樯橹灰飞烟灭。故国神游，多情应笑我，早生华发。人生如梦，一尊还酹江月。',
  'poems-gz10-08': '千古江山，英雄无觅，孙仲谋处。舞榭歌台，风流总被，雨打风吹去。斜阳草树，寻常巷陌，人道寄奴曾住。想当年，金戈铁马，气吞万里如虎。元嘉草草，封狼居胥，赢得仓皇北顾。四十三年，望中犹记，烽火扬州路。可堪回首，佛狸祠下，一片神鸦社鼓。凭谁问：廉颇老矣，尚能饭否？',
  'poems-gz10-11': '古之学者必有师。师者，所以传道受业解惑也。人非生而知之者，孰能无惑？惑而不从师，其为惑也，终不解矣。生乎吾前，其闻道也固先乎吾，吾从而师之；生乎吾后，其闻道也亦先乎吾，吾从而师之。吾师道也，夫庸知其年之先后生于吾乎？是故无贵无贱，无长无少，道之所存，师之所存也。嗟乎！师道之不传也久矣！欲人之无惑也难矣！古之圣人，其出人也远矣，犹且从师而问焉；今之众人，其下圣人也亦远矣，而耻学于师。是故圣益圣，愚益愚。圣人之所以为圣，愚人之所以为愚，其皆出于此乎？爱其子，择师而教之；于其身也，则耻师焉，惑矣。彼童子之师，授之书而习其句读者，非吾所谓传其道解其惑者也。句读之不知，惑之不解，或师焉，或不焉，小学而大遗，吾未见其明也。巫医乐师百工之人，不耻相师。士大夫之族，曰师曰弟子云者，则群聚而笑之。问之，则曰：「彼与彼年相若也，道相似也。位卑则足羞，官盛则近谀。」呜呼！师道之不复可知矣。巫医乐师百工之人，君子不齿，今其智乃反不能及，其可怪也欤！圣人无常师。孔子师郯子、苌弘、师襄、老聃。郯子之徒，其贤不及孔子。孔子曰：三人行，则必有我师。是故弟子不必不如师，师不必贤于弟子。闻道有先后，术业有专攻，如是而已。李氏子蟠，年十七，好古文，六艺经传皆通习之，不拘于时，学于余。余嘉其能行古道，作《师说》以贻之。',
  'poems-gz11-11': '吴丝蜀桐张高秋，空山凝云颓不流。江娥啼竹素女愁，李凭中国弹箜篌。昆山玉碎凤凰叫，芙蓉泣露香兰笑。十二门前融冷光，二十三丝动紫皇。女娲炼石补天处，石破天惊逗秋雨。梦入神山教神妪，老鱼跳波瘦蛟舞。吴质不眠倚桂树，露脚斜飞湿寒兔。',
  'poems-gz10-14': '静女其姝，俟我于城隅。爱而不见，搔首踟蹰。静女其娈，贻我彤管。彤管有炜，说怿女美。自牧归荑，洵美且异。匪女之为美，美人之贻。',
};
const textBad = Object.keys(KEPT_TEXT).filter(id => !PROSE_BY_ID[id.replace('poems-', '')] || norm(PROSE_BY_ID[id.replace('poems-', '')].text) !== norm(KEPT_TEXT[id]));
chk(textBad.length === 0, '保留条目的正文逐字未改（异常：' + (textBad.join('、') || '无') + '）');

const allById = {};
ALL.forEach(p => { allById[p.id] = p; });
const notInAll = Object.keys(KEPT_TEXT).filter(id => !allById[id.replace('poems-', '')]);
chk(notInAll.length === 0, '保留的低年级条目仍能通过 POEMS_ALL 取到（缺：' + (notInAll.join('、') || '无') + '）');

const courseKey = {};
const selfDup = [];
ALL.forEach(p => {
  const k = norm(p.text);
  if (!k) return;
  if (courseKey[k]) selfDup.push(courseKey[k] + ' ↔ ' + p.id);
  else courseKey[k] = p.id;
});
chk(selfDup.length === 0, '课内数据里没有正文相同的两条（残留：' + (selfDup.join('、') || '无') + '）');

const dupGroups = WI.works.filter(w => w.entries.filter(e => e.indexOf('poems-') === 0).length > 1);
chk(dupGroups.length === 0, '作品主表里没有「课内自身重复」的组（残留 ' + dupGroups.length +
  ' 组：' + dupGroups.map(w => w.title).join('、') + '）');

const 只有一条 = REMOVED.every(r => {
  const p = allById[r[3].replace('poems-', '')];
  if (!p) return false;
  const sameKey = ALL.filter(x => norm(x.text) === norm(p.text));
  return sameKey.length === 1;
});
chk(只有一条, '12 篇去重后各只剩一条课内条目');

chk(WI.same('poems-xx1-09', 'tangshi-ts-231'), '「课内 ↔ 选集」的跨集判重未受影响（《静夜思》仍与唐诗《夜思》同篇）');
chk(WI.same('poems-gz10-05', 'tangshi-ts-190'), '《登高》课内与唐诗三百首仍判为同一篇（课内只删自身重复那份）');
chk(WI.same('poems-gz10-08', 'songci-sc-183'), '《永遇乐·京口北固亭怀古》课内与宋词三百首仍判为同一篇');

chk(sb.WORKS_GROUPS.length === 184,
  '同篇对照表 176 组（乐府集与成语故事收进来的一批重篇 + 长文补全带来的同篇，Issue #244 / #308；' +
  '二批带来源的古文 / 诗篇条目并回原篇；' +
  'Issue #339 拆掉 5 组错并（愚公移山 / 卧薪尝胆 / 礼贤下士 / 不自量力 / 东道主）由 142 升为 140；' +
  '又拆开 众志成城 / 众口铄金 一组，降为 139；' +
  '本轮把正文里的编者括注搬进「语源 / 典故」栏后，蚌鹬相持/坐收渔利、近水楼台/近水楼台先得月' +
  '两组正文露出本来面目、判为同篇，升为 141；' +
  'Issue #461 补篇后新增 3 组（子路曾皙冉有公西华侍坐 / 长相思 / 偶成 与课内或他集合流），' +
  '升为 144；' +
  'Issue #461 古文观止对齐 222 篇：新增 12 组（过秦论上/过秦论、治安策一/治安策、' +
  '上书谏猎/司马相如上书谏猎、春夜宴从弟桃花园序/春夜宴桃李园序、大铁椎传、湖心亭看雪、' +
  '师说、六国论、游褒禅山记、上枢密韩太尉书 与课内或他集合流）；' +
  'Issue #471 第二轮又添 3 组（书愤 / 临安春雨初霁 与本集合流，' +
  '《鹊桥仙·华灯纵博》与集内旧条 sc-281 合流），升为 159；' +
  'Issue #471 第三轮再添 1 组（《闲居初夏午睡起·其一》在《唐诗》卷七的壳 ts-390 ' +
  '与《古诗「非唐代」》gs-55 同篇），升为 160；' +
  'Issue #505 第一批：古文 5 篇（匡衡凿壁借光 / 割席分坐 / 王戎早慧 / 画龙点睛 / 陶母责子）' +
  '与《古文》集内旧条合流、古诗 17 首与课内或集内合流，共添 16 组，升为 176；' +
  'Issue #505 第二批：古文 2 篇（枭逢鸠 / 锯竿入城）与《古文》集内旧条合流、' +
  '古诗 3 首（杜甫《绝句四首·其三》、王建《新嫁娘词》、李商隐《乐游原》）与集内既有条合流' +
  '（同批另 11 条课内 / 集内已有、本来就在判重键里），共添 8 组，升为 184；实际 ' +
  sb.WORKS_GROUPS.length + '）');

const jys = byId['xx1-09'];
chk(!!jys, '课内《静夜思》在库（课内条目 xx1-09）');
chk(norm(jys.text) === norm('床前明月光，疑是地上霜。举头望明月，低头思故乡。'),
  '课内《静夜思》正文 = 教材文本「床前明月光……」（实际：' + jys.text.replace(/\n/g, '') + '）');
chk(jys.text.indexOf('看月光') < 0, '课内《静夜思》不含宋人刻本「床前看月光」');
chk(jys.title === '静夜思', '课内题名作《静夜思》');
chk(jys.grade === 1 && jys.term === 2, '《静夜思》归一年级下册（统编版）');

const ytRaw = sb.POEMS_TANGSHI.filter(p => p.id === 'ts-231')[0];
const yt = sb.masterTextOf ? sb.masterTextOf(ytRaw, 'tangshi') : ytRaw;
chk(!!yt, '唐诗三百首《夜思》在库（ts-231）');
chk(norm(yt.text) === norm(jys.text), '唐诗三百首那条正文与教材逐字一致（同一文本才并为一篇）');
chk(yt.text.indexOf('看月光') < 0, '唐诗三百首那条同样不含「床前看月光」');

const stale = sb.SITE_INDEX.filter(p => String(p.text || '').indexOf('看月光') >= 0);
chk(stale.length === 0, '全站索引里没有「床前看月光」的残留条目（' + stale.map(p => p.id).join('、') + '）');

chk(WI.repOf('tangshi-ts-231') === 'poems-xx1-09', '同一篇的代表条目优先课内那一条（唐诗《夜思》→ 课内《静夜思》）');

const cnt = {};
ALL.forEach(p => { cnt[p.grade] = (cnt[p.grade] || 0) + 1; });
const primary = [1, 2, 3, 4, 5, 6].map(g => cnt[g] || 0).reduce((a, b) => a + b, 0);
const high = [10, 11, 12].map(g => cnt[g] || 0).reduce((a, b) => a + b, 0);
chk(primary === 119, '小学段 119 首（去重后；实际 ' + primary + '）');
chk(high === 51, '高中段 51 首（去重后；实际 ' + high + '）');
chk(cnt[3] === 17 && cnt[4] === 23 && cnt[5] === 23, '三 / 四 / 五年级各少 1 首（17 / 23 / 23，实际 ' +
  [cnt[3], cnt[4], cnt[5]].join(' / ') + '）');
chk(cnt[10] === 24 && cnt[11] === 18 && cnt[12] === 9, '高一 / 高二 / 高三为 24 / 18 / 9（实际 ' +
  [cnt[10], cnt[11], cnt[12]].join(' / ') + '）');

const thinCourse = REMOVED.filter(r => {
  const base = PROSE_BY_ID[r[3].replace('poems-', '')];
  return sb.SITE_INDEX.filter(x => x.book === 'poems' && norm(x.text) === norm(base.text)).length !== 1;
});
chk(thinCourse.length === 0, '全站索引里 12 篇各只剩一条课内条目（异常：' + thinCourse.map(r => r[1]).join('、') + '）');

const { MERGES } = require('../scripts/near-dup-merge.js');
chk(MERGES.length === 4, '近重复合并共 4 组（实际 ' + MERGES.length + '）');
chk(MERGES.every(m => m.word && m.fromWord && m.note),
  '每组都写明裁定后的用字、原用字与依据');
chk(MERGES.every(m => m.word !== m.fromWord), '裁定的用字与原用字确实不同（否则无所谓合并）');

const BY_RULE = {};
MERGES.forEach(m => { (BY_RULE[m.rule] = BY_RULE[m.rule] || []).push(m); });
chk((BY_RULE.course || []).length === 3, '「有教材 → 以教材为准」3 组（实际 ' +
  ((BY_RULE.course || []).length) + '）');
chk((BY_RULE.simplified || []).length === 1, '「没有教材 → 以简体字为准」1 组（实际 ' +
  ((BY_RULE.simplified || []).length) + '）');
chk(MERGES.some(m => m.keep === 'poems-gz11-06' && m.drop === 'tangshi-ts-78'),
  '《将进酒》也登记进来了（「不愿醒」/「不复醒」，上一轮漏登的一组）');

chk((BY_RULE.course || []).every(m => m.keep.indexOf('poems-') === 0 &&
  m.drop.indexOf('poems-') !== 0),
  '「以教材为准」的两组都留下课内条目、并入选本那一条');

const SITE_BY_ID = {};
sb.SITE_INDEX.forEach(p => { SITE_BY_ID[p.id] = p; });

const txtOf = function (id) {
  const p = SITE_BY_ID[id];
  if (!p) return '';
  return sb.masterTextOf ? sb.masterTextOf(p, p.book).text : p.text;
};

const KEEP_CONTEXT = {
  'poems-xx4-23': ['唯见长江', '惟见长江'],
  'poems-cz7-08': ['回乐烽前', '回乐峰前'],
  'poems-gz11-06': ['但愿长醉不愿醒', '但愿长醉不复醒'],
  'songci-sc-134': ['白苹花满', '白蘋花满']
};
MERGES.forEach(function (m) {
  const t = txtOf(m.keep);
  const pair = KEEP_CONTEXT[m.keep];
  chk(!!pair, m.title + ' 的核对上下文已登记（' + m.keep + '）');
  if (!pair) return;
  chk(t.indexOf(pair[0]) >= 0, m.title + ' 留下的那一条用的是裁定写法「' + pair[0] + '」');
  chk(t.indexOf(pair[1]) < 0, m.title + ' 留下的那一条已不含原写法「' + pair[1] + '」');
});

MERGES.forEach(function (m) {
  if (m.remove) {

    chk(!SITE_BY_ID[m.drop], m.title + ' 同集子重复条目已删（' + m.drop + ' 不在索引里）');
    return;
  }
  chk(WI.same(m.keep, m.drop), m.title + ' 两条已判为同一篇（不再各背各的）');
});
chk(WI.repOf('tangshi-ts-259') === 'poems-xx4-23',
  '唐诗《送孟浩然之广陵》的代表条目归到课内《黄鹤楼送孟浩然之广陵》（老进度不丢）');
chk(WI.repOf('tangshi-ts-270') === 'poems-cz7-08',
  '唐诗《夜上受降城闻笛》的代表条目归到课内那一条');

const twoIds = [['poems-xx4-23', 'tangshi-ts-259', '黄鹤楼送孟浩然之广陵', '唯见长江'],
  ['poems-cz7-08', 'tangshi-ts-270', '夜上受降城闻笛', '回乐烽前'],
  ['poems-gz11-06', 'tangshi-ts-78', '将进酒', '但愿长醉不愿醒']];
twoIds.forEach(function (row) {
  const a = txtOf(row[0]), b = txtOf(row[1]);
  chk(norm(a) === norm(b), row[2] + ' 两条读到的正文逐字相同');
  chk(a.indexOf(row[3]) >= 0, row[2] + ' 取的是教材写法（含「' + row[3] + '」）');
});

chk((sb.WORKS_NEAR_DUP || []).length === 0,
  'WORKS_NEAR_DUP 已清空（这一批已合并，不再并列；实际 ' +
  (sb.WORKS_NEAR_DUP || []).length + ' 组）');
chk((sb.TEXT_NEAR_DUP || []).length === 0,
  'TEXT_NEAR_DUP 已清空（实际 ' + (sb.TEXT_NEAR_DUP || []).length + ' 组）');

const seat = [];
sb.SITE_INDEX.forEach(function (p) {
  if (!p || p.isBook || !p.id) return;
  const t = norm(txtOf(p.id));
  if (t) seat.push({ id: p.id, t: t });
});

function oneCharApart(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i &&
    a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  return Math.max(a.length, b.length) - i - j <= 1;
}
const nearLeft = [];
for (let i = 0; i < seat.length; i++) {
  for (let j = i + 1; j < seat.length; j++) {
    if (oneCharApart(seat[i].t, seat[j].t)) nearLeft.push(seat[i].id + ' / ' + seat[j].id);
  }
}
chk(nearLeft.length === 0,
  '全站没有「只差一字」的两条并存（残留：' + (nearLeft.slice(0, 5).join('；') || '无') + '）');

const masterEntries = {};
(sb.TEXT_MASTER || []).forEach(m => (m.entries || []).forEach(e => { masterEntries[e] = m.id; }));
const uncov = [];
(sb.WORKS_GROUPS || []).forEach(g => g.entries.forEach(e => { if (!masterEntries[e]) uncov.push(e); }));
chk(uncov.length === 0,
  '判重表 117 组的每一条条目都在存储主表里（未覆盖：' + (uncov.slice(0, 6).join('、') || '无') + '）');

// 「全量收归主表」的各部：除课内（poems）外的每一部集子，一律从 SITE_BOOKS 取，
// 不写死名单 —— 加第十一部时这里自己跟着算（Issue #342）
const FULL_BOOKS = (sb.SITE_BOOKS || []).map(function (b) { return b.id; })
  .filter(function (id) { return id !== 'poems'; });
const inFullBooks = e => FULL_BOOKS.some(b => e.indexOf(b + '-') === 0);
const masterInGroups = [];
Object.keys(masterEntries).forEach(e => {
  if (inFullBooks(e)) return;
  if (!(sb.WORKS_GROUPS || []).some(g => g.entries.indexOf(e) >= 0)) masterInGroups.push(e);
});
chk(masterInGroups.length === 0,
  '存储主表里没有判重表不认的条目（全量收归部的单篇除外；多出的：' +
  (masterInGroups.slice(0, 6).join('、') || '无') + '）');

MERGES.forEach(function (m) {
  const hit = (sb.TEXT_MASTER || []).filter(x => x.entries.indexOf(m.keep) >= 0)[0];
  if (m.remove) {

    const stray = [];
    (sb.TEXT_MASTER || []).forEach(x => (x.entries || []).forEach(e => {
      if (e === m.drop) stray.push(x.id);
    }));
    chk(stray.length === 0,
      m.title + ' 已删的 ' + m.drop + ' 不再出现在任何主表条目里（残留于：' +
      (stray.join('、') || '无') + '）');
    return;
  }
  chk(!!hit && hit.entries.indexOf(m.drop) >= 0,
    m.title + ' 两条条目都在同一份主表里（正文只落一份）');
});

{
  const { execFileSync } = require('child_process');
  const before = require('fs').readFileSync(__dirname + '/../data/poems-tangshi.js', 'utf8');
  let out = '';
  try {
    out = execFileSync(process.execPath, [__dirname + '/../scripts/near-dup-merge.js'],
      { encoding: 'utf8', cwd: __dirname + '/..' });
  } catch (e) { out = 'ERR ' + e.message; }
  const after = require('fs').readFileSync(__dirname + '/../data/poems-tangshi.js', 'utf8');
  chk(before === after, '再跑一遍 near-dup-merge.js 不改动语料（幂等）');
  chk(out.indexOf('已合并') >= 0 || out.indexOf('已逐字相同') >= 0,
    '再跑一遍时已并过的组被识别为「已合并」并跳过（输出：' +
    (out.split('\n').filter(l => l.indexOf('·') === 0).length) + ' 行跳过提示）');
}

/* Issue #461：古诗文大会 / 阅读大赛两份清单去重后，词补进《词》（原《宋词三百首》）、
   唐代诗作补进《唐诗》（原《唐诗三百首》），选本外补充，与既有先例一致。
   改名后口径扩大：《词》另收五代 / 金 / 清之作，《唐诗》亦收大会 / 大赛的补充篇目。
   第二轮（文汇历年真题 + 大会冷门拓展）：《唐诗》+13、《词》+12、《曲》+1、
   《古诗「非唐代」》+5、《小古文》+19。
   第四轮（决赛冷门）：《唐诗》+9、《古诗「非唐代」》+5、《词》+2、《小古文》+9。
   Issue #471（含扬州 / 广陵 / 江都）：《唐诗》+11、《古诗「非唐代」》+5、《词》+5；
   同轮李清照词补录：《词》+2（《武陵春·春晚》已在集内，不重录）。
   第五轮（李清照《减字木兰花·卖花担上》）：《词》+1。
   第六轮（苏轼 / 李清照各 5 篇名篇）：《词》+10。
   Issue #471 第二轮（陆游）：《古诗「非唐代」》+10（陆凯《赠范晔诗》+ 陆游 9 首）、
   《词》+1（陆游《诉衷情·当年万里觅封侯》）；其中《书愤》《临安春雨初霁》课内已有、
   《鹊桥仙·华灯纵博》集内旧条已在，按判重口径合流，壳里挂 textRef 指过去。
   Issue #471 第三轮（杜牧《题乌江亭》/ 刘禹锡《庭竹》）：《唐诗》+2；
   （杨万里《闲居初夏午睡起二首》、苏轼《海棠》）：《古诗「非唐代」》+3；
   元稹《菊花》、韦应物《闻雁》两首已在集内，按判重口径不重录。 */
chk((sb.POEMS_SONGCI || []).length === 330,
  '《词》288 首（宋）+ 五代 6 / 清 5 / 金 1 + 历年遗漏 / 大会冷门 / 决赛冷门 + 扬州专辑 5 + 李清照 3 + 苏轼 / 李清照各 5 + 陆游 1 = 330（实际 ' +
  (sb.POEMS_SONGCI || []).length + '）');
chk((sb.POEMS_GUSHI || []).length === 67,
  '《古诗「非唐代」》19 首（首轮）+ 偶成 / 登快阁 + 大会冷门 5 + 决赛冷门 5 + 扬州专辑 5 + 陆凯 / 陆游 10 + 曹植《七步诗》1 + 第三轮 3（杨万里 2 / 苏轼《海棠》）= 50；' +
  'Issue #505 第一批再添 14（4 首落库：乡思 / 病牛 / 野望 / 苔；10 首与课内 / 集内合流：' +
  '敕勒歌 / 赠范晔诗 / 游园不值 / 绝句 / 春日 / 元日 / 泊船瓜洲 / 竹石 / 墨梅 / 江上渔者）= 64；' +
  'Issue #505 第二批再添 3（明代史可法《燕子矶口占》、于谦《除夜太原寒甚》与宋梅尧臣《陶者》；' +
  '同批余下 22 条与课内 / 集内合流，不另挂壳）= 67（实际 ' +
  (sb.POEMS_GUSHI || []).length + '）');
/* ⚠️ Issue #471 第三轮起，《唐诗》的「每一条朝代都含『唐』」这一条基线**放宽**：
   用户点名要收杨万里《闲居初夏午睡起·其一》，而这一条已在本集卷七的
   「通用名篇段」（ts-316 及之后那一段本就是课内 / 课外通用名篇，不全是唐人），
   于是照老例在卷七给它挂一个壳 ts-390，正文与《古诗「非唐代」》gs-55 同篇
   （壳里挂的 `textRef` 指过去）—— 判重表按正文把两条合成一篇。唐代诸家
   （杜牧 / 刘禹锡 / 元稹 / 韦应物…）那条「非唐一律归《古诗「非唐代」》」的
   判据不变，只在 ts-390 这一条壳上开例外。 */
const TANG_EXTRA = ['ts-390'];
chk((sb.POEMS_TANGSHI || []).length === 402,
  '《唐诗》301 首 + 校外补充 66 首 + 扬州专辑 11 首 − 曹植《七步诗》（非唐，已归位）' +
  '+ 第三轮 3（杜牧《题乌江亭》、刘禹锡《庭竹》、杨万里那一条壳）= 380；' +
  'Issue #505 第一批再添 11（2 首落库：陇西行 / 南园；9 首与课内合流：' +
  '蜂 / 山行 / 春晓 / 游子吟 / 滁州西涧 / 回乡偶书 / 黄鹤楼送孟浩然之广陵 / 竹枝词 / 登幽州台歌）；' +
  '第二批再添 11（陈玉兰《寄外征衣》、陆龟蒙《新沙》、李白《山中问答》、杜甫《绝句四首·其三》、' +
  '王建《新嫁娘词》、黄巢《题菊花》《不第后赋菊》、贾岛《剑客》、杜牧《过华清宫绝句·其一》、' +
  '严武《军城早秋》、李商隐《乐游原》）= 402（实际 ' + (sb.POEMS_TANGSHI || []).length + '）');

/* Issue #480：《唐诗》收什么，判据只按**朝代** —— 是唐人的诗就归《唐诗》，
   非唐一律归《古诗「非唐代」》。原先把曹植《七步诗》登记在《唐诗》里是 bug。 */
const TANG_OK = /唐/;
const tangBad = (sb.POEMS_TANGSHI || []).filter(p => !TANG_OK.test(p.dynasty || ''));
chk(tangBad.length <= TANG_EXTRA.length, '《唐诗》里除卷七那一条壳外，每一条的朝代都含「唐」（越界：' +
  (tangBad.map(p => p.id + '（' + p.dynasty + '）').join('、') || '无') + '）');
chk(tangBad.every(p => TANG_EXTRA.indexOf(p.id) >= 0), '越界的只有卷七那一条壳 ts-390');
/* 那一条壳的正文得读得到（它本身只挂 textRef 指向《古诗「非唐代」》gs-55）。 */
const shell390 = (sb.POEMS_TANGSHI || []).filter(p => p.id === 'ts-390')[0];
const t390 = shell390 && sb.masterTextOf ? sb.masterTextOf(shell390, 'tangshi') : null;
chk(!!t390 && t390.text.indexOf('梅子留酸软齿牙') >= 0,
  '唐诗卷七那一条壳从主表取到正文（「梅子留酸软齿牙」）');
const gushi55 = (sb.POEMS_GUSHI || []).filter(p => p.id === 'gs-55')[0];
chk(!!gushi55 && WI.same('gushi-gs-55', 'tangshi-ts-390'),
  '《闲居初夏午睡起·其一》跨《唐诗》与《古诗「非唐代」》判为同一篇');
/* 一条正文只写一份：壳不另存正文，跨部那条由《古诗「非唐代」》那份语料写。 */
const ts390raw = (sb.TANGSHI_CORPUS_471C || []).filter(p => p.id === 'ts-390');
chk(ts390raw.length === 0, '《唐诗》那份语料里不再重复写同文的那一条壳（ts-390）');
const tangCao = (sb.POEMS_TANGSHI || []).filter(p => p.author === '曹植');
chk(tangCao.length === 0, '曹植（三国魏）的诗不再出现在《唐诗》里（残留：' +
  (tangCao.map(p => p.id).join('、') || '无') + '）');
const gushiCao = (sb.POEMS_GUSHI || []).filter(p => p.author === '曹植' && p.title === '七步诗')[0];
chk(!!gushiCao && gushiCao.gradeGroup === '汉魏诗',
  '《七步诗》归位到《古诗「非唐代」· 汉魏诗》，朝代「三国·魏」');
if (gushiCao) {
  const t = sb.masterTextOf ? sb.masterTextOf(gushiCao, 'gushi') : gushiCao;
  chk(!!t.text && t.text.indexOf('本是同根生') >= 0,
    '《七步诗》正文随归位一并可读（主表取到「本是同根生」）');
}
const gushiTang = (sb.POEMS_GUSHI || []).filter(p => (p.dynasty || '').indexOf('唐') >= 0);
chk(gushiTang.length === 0, '《古诗「非唐代」》里没有唐代的诗（越界：' +
  (gushiTang.map(p => p.id + '（' + p.dynasty + '）').join('、') || '无') + '）');
chk(ALL.length === 251, '课内仍 251 首（实际 ' + ALL.length + '）');

console.log('');
if (fails) { console.log('✗ 课内去重 / 《静夜思》测试失败 ' + fails + ' 项'); process.exit(1); }
console.log('🎉 课内去重 / 《静夜思》测试全部通过');
