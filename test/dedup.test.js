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
  'data/poems-tangshi.js', 'data/poems-songci.js', 'data/poems-guwen.js', 'data/poems-zhaoming.js', 'data/poems-yuanqu.js',
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
  // 2026-09-19（Issue #243 后续）：一批高年级长文此前只录了残篇（夹 ……），
  // 补全后与低年级同篇条目的正文逐字一致 —— 按「低年级版本为准」删掉高年级那份。
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
chk(WI.same('poems-gz10-07', 'songci-sc-67'), '《念奴娇·赤壁怀古》课内与宋词三百首仍判为同一篇');
chk(WI.same('poems-gz10-08', 'songci-sc-183'), '《永遇乐·京口北固亭怀古》课内与宋词三百首仍判为同一篇');

chk(sb.WORKS_GROUPS.length === 81,
  '同篇对照表 81 组（60 原有 + 8 新收唐诗/元曲 + 13 组长文补全后与选集同篇）（实际 ' +
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
  '判重表 59 组的每一条条目都在存储主表里（未覆盖：' + (uncov.slice(0, 6).join('、') || '无') + '）');

const FULL_BOOKS = ['zhaoming', 'guwen', 'songci', 'tangshi', 'classic', 'yuanqu'];
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

chk((sb.POEMS_SONGCI || []).length === 285,
  '《宋词三百首》283 首 + 校外补充 2 首 = 285（实际 ' + (sb.POEMS_SONGCI || []).length + '）');
chk((sb.POEMS_TANGSHI || []).length === 317,
  '《唐诗三百首》301 首 + 校外补充 16 首 = 317（并进去的那三条仍在选本列表里；实际 ' +
  (sb.POEMS_TANGSHI || []).length + '）');
chk(ALL.length === 251, '课内仍 251 首（实际 ' + ALL.length + '）');

console.log('');
if (fails) { console.log('✗ 课内去重 / 《静夜思》测试失败 ' + fails + ' 项'); process.exit(1); }
console.log('🎉 课内去重 / 《静夜思》测试全部通过');
