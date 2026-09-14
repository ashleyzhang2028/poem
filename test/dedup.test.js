/**
 * 课内自身重复去重 + 《静夜思》教材文本裁定（Issue #69 收尾）
 *
 * 需求原话：
 *   · 「课内 12 组自身重复 以低年级版本为准，去重」
 *   · 「静夜思以床前明月光为准，教材为准」
 *
 * 背景：课内 12 组篇目在**两个年级**各收了一份（同一首诗的正文一字不差），
 * 属于逐页录入时留下的自身重复 —— 与「课内 ↔ 选集」的跨集重复不同，
 * 它连出处都不一样，纯粹是同一份教材内容存了两遍：
 *
 *   跨学段：绝句（二年级下 / 三年级下）、望洞庭（三年级上 / 四年级下）、
 *           四时田园杂兴（四年级下 / 五年级下）、天净沙·秋思（六年级下 / 七年级上）
 *   高中段：师说、静女、书愤、临安春雨初霁、李凭箜篌引
 *   另有 3 组同时跨到选集（登高 / 念奴娇·赤壁怀古 / 永遇乐·京口北固亭怀古），
 *   它们的课内两份也一并收敛。
 *
 * 裁定：**以低年级版本为准，去重** —— 保留低年级那一条（学生先学到它），
 * 删掉高年级重复的那一条；作品主表里这一篇的条目数随之减一。
 *
 * 这一层验四件事：
 *   1. 课内 12 组自身重复已消失（data/poems-*.js 与 works-map 两条路径都不得再出现）
 *   2. 保留的是低年级那一条，且正文 / 译文没被改动
 *   3. 《静夜思》课内与唐诗三百首正文都等于教材文本「床前明月光……」
 *   4. 总数、年级分布、排程 / 搜索去重结果与去重后的语料一致
 */
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
  'data/poems-tangshi.js', 'data/poems-songci.js', 'data/poems-guwen.js', 'data/poems-zhaoming.js',
  'data/site-index.js', 'data/works-map.js', 'data/works-index.js'
];
DATA.forEach(f => vm.runInContext(fs.readFileSync(__dirname + '/../' + f, 'utf8'), sb, { filename: f }));
const ALL = sb.POEMS_ALL;
const byId = {};
ALL.forEach(p => { byId[p.id] = p; });
const WI = sb.WorksIndex;

/** 去掉标点空白，只比文字（与 works-index 的判重键同口径） */
const norm = t => String(t || '').replace(/[\s\u3000]+/g, '')
  .replace(/[，。！？；：、,.!?;:"'“”‘’「」『』《》〈〉（）()\[\]【】—－\-…·~～]/g, '');

/* ============ 一、12 组自身重复已消失 ============ */

chk(ALL.length === 261, '课内诗词总数 261（去重前 273，删掉 12 条重复条目；实际 ' + ALL.length + '）');

// 每条被删的高年级条目，现在都不该再出现在数据里
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
];
const PROSE_BY_ID = {};
['data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js', 'data/poems-5.js',
 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js', 'data/poems-9.js', 'data/poems-10.js',
 'data/poems-11.js', 'data/poems-12.js'].forEach(f => {
  const src = fs.readFileSync(__dirname + '/../' + f, 'utf8');
  const m = src.match(/window\.POEMS_(\d+) = (\[[\s\S]*\]);/);
  const arr = vm.runInNewContext('(' + m[2] + ')');
  arr.forEach(p => { PROSE_BY_ID[p.id] = p; });
});

const missing = REMOVED.filter(r => PROSE_BY_ID[r[0]]);
chk(missing.length === 0, '被删的高年级重复条目已从课内数据里消失（残留：' +
  (missing.map(r => r[0]).join('、') || '无') + '）');
const kept = REMOVED.filter(r => !PROSE_BY_ID[r[3].replace('poems-', '')]);
chk(kept.length === 0, '低年级版本全部保留（误删：' + (kept.map(r => r[3]).join('、') || '无') + '）');

/* ============ 二、保留的是低年级那一条，正文未改 ============ */

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
  'poems-gz10-11': '古之学者必有师。师者，所以传道受业解惑也。人非生而知之者，孰能无惑？惑而不从师，其为惑也，终不解矣。是故无贵无贱，无长无少，道之所存，师之所存也。是故弟子不必不如师，师不必贤于弟子。闻道有先后，术业有专攻，如是而已。',
  'poems-gz11-11': '吴丝蜀桐张高秋，空山凝云颓不流。江娥啼竹素女愁，李凭中国弹箜篌。昆山玉碎凤凰叫，芙蓉泣露香兰笑。十二门前融冷光，二十三丝动紫皇。女娲炼石补天处，石破天惊逗秋雨。梦入神山教神妪，老鱼跳波瘦蛟舞。吴质不眠倚桂树，露脚斜飞湿寒兔。',
  'poems-gz10-14': '静女其姝，俟我于城隅。爱而不见，搔首踟蹰。静女其娈，贻我彤管。彤管有炜，说怿女美。自牧归荑，洵美且异。匪女之为美，美人之贻。',
};
const textBad = Object.keys(KEPT_TEXT).filter(id => !PROSE_BY_ID[id.replace('poems-', '')] || norm(PROSE_BY_ID[id.replace('poems-', '')].text) !== norm(KEPT_TEXT[id]));
chk(textBad.length === 0, '保留条目的正文逐字未改（异常：' + (textBad.join('、') || '无') + '）');

// 保留的低年级条目都在课内主表里，且年级确实更低
const allById = {};
ALL.forEach(p => { allById[p.id] = p; });
const notInAll = Object.keys(KEPT_TEXT).filter(id => !allById[id.replace('poems-', '')]);
chk(notInAll.length === 0, '保留的低年级条目仍能通过 POEMS_ALL 取到（缺：' + (notInAll.join('、') || '无') + '）');

/* ============ 三、课内自身重复：数据层与主表层都为 0 ============ */

// 数据层：同一首（正文一致）在课内只应有一条
const courseKey = {};
const selfDup = [];
ALL.forEach(p => {
  const k = norm(p.text);
  if (!k) return;
  if (courseKey[k]) selfDup.push(courseKey[k] + ' ↔ ' + p.id);
  else courseKey[k] = p.id;
});
chk(selfDup.length === 0, '课内数据里没有正文相同的两条（残留：' + (selfDup.join('、') || '无') + '）');

// 主表层：同一作品不该有两条及以上课内条目
const dupGroups = WI.works.filter(w => w.entries.filter(e => e.indexOf('poems-') === 0).length > 1);
chk(dupGroups.length === 0, '作品主表里没有「课内自身重复」的组（残留 ' + dupGroups.length +
  ' 组：' + dupGroups.map(w => w.title).join('、') + '）');

// 去重前是 12 组，回归防线：这 12 篇现在各自只剩一条课内条目
const 只有一条 = REMOVED.every(r => {
  const p = allById[r[3].replace('poems-', '')];
  if (!p) return false;
  const sameKey = ALL.filter(x => norm(x.text) === norm(p.text));
  return sameKey.length === 1;
});
chk(只有一条, '12 篇去重后各只剩一条课内条目');

// 跨集重复（课内 ↔ 选集）仍在，没有被误伤
chk(WI.same('poems-xx1-09', 'tangshi-ts-231'), '「课内 ↔ 选集」的跨集判重未受影响（《静夜思》仍与唐诗《夜思》同篇）');
chk(WI.same('poems-gz10-05', 'tangshi-ts-190'), '《登高》课内与唐诗三百首仍判为同一篇（课内只删自身重复那份）');
chk(WI.same('poems-gz10-07', 'songci-sc-67'), '《念奴娇·赤壁怀古》课内与宋词三百首仍判为同一篇');
chk(WI.same('poems-gz10-08', 'songci-sc-183'), '《永遇乐·京口北固亭怀古》课内与宋词三百首仍判为同一篇');

// 作品主表组数由 66 降到 57（少了 12 组自身重复，但 3 组跨集仍在 → 66-9=57）
chk(sb.WORKS_GROUPS.length === 57, '同篇对照表由 66 组降到 57 组（实际 ' + sb.WORKS_GROUPS.length + '）');

/* ============ 四、《静夜思》以教材文本为准 ============ */

// 教材（统编版一年级下册）通行文本就是「床前明月光」，不是宋人刻本的「床前看月光」。
// 课内这条是教材口径，唐诗三百首那条正文与它一致（已合并为同一篇）。
const jys = byId['xx1-09'];
chk(!!jys, '课内《静夜思》在库（课内条目 xx1-09）');
chk(norm(jys.text) === norm('床前明月光，疑是地上霜。举头望明月，低头思故乡。'),
  '课内《静夜思》正文 = 教材文本「床前明月光……」（实际：' + jys.text.replace(/\n/g, '') + '）');
chk(jys.text.indexOf('看月光') < 0, '课内《静夜思》不含宋人刻本「床前看月光」');
chk(jys.title === '静夜思', '课内题名作《静夜思》');
chk(jys.grade === 1 && jys.term === 2, '《静夜思》归一年级下册（统编版）');

const yt = sb.POEMS_TANGSHI.filter(p => p.id === 'ts-231')[0];
chk(!!yt, '唐诗三百首《夜思》在库（ts-231）');
chk(norm(yt.text) === norm(jys.text), '唐诗三百首那条正文与教材逐字一致（同一文本才并为一篇）');
chk(yt.text.indexOf('看月光') < 0, '唐诗三百首那条同样不含「床前看月光」');

// 全站不许再有「床前看月光」这一宋人文本混进来
const stale = sb.SITE_INDEX.filter(p => String(p.text || '').indexOf('看月光') >= 0);
chk(stale.length === 0, '全站索引里没有「床前看月光」的残留条目（' + stale.map(p => p.id).join('、') + '）');

/* ============ 五、搜索去重与排程一致 ============ */

// 搜《静夜思》只出一条（同一篇作品不重复列），条目是课内那条（代表条目优先课内）
chk(WI.repOf('tangshi-ts-231') === 'poems-xx1-09', '同一篇的代表条目优先课内那一条（唐诗《夜思》→ 课内《静夜思》）');

// 去重后的课内篇目数：年级分布必须与数据一致
const cnt = {};
ALL.forEach(p => { cnt[p.grade] = (cnt[p.grade] || 0) + 1; });
const primary = [1, 2, 3, 4, 5, 6].map(g => cnt[g] || 0).reduce((a, b) => a + b, 0);
const high = [10, 11, 12].map(g => cnt[g] || 0).reduce((a, b) => a + b, 0);
chk(primary === 119, '小学段 119 首（去重后；实际 ' + primary + '）');
chk(high === 61, '高中段 61 首（去重后；实际 ' + high + '）');
chk(cnt[3] === 17 && cnt[4] === 23 && cnt[5] === 23, '三 / 四 / 五年级各少 1 首（17 / 23 / 23，实际 ' +
  [cnt[3], cnt[4], cnt[5]].join(' / ') + '）');
chk(cnt[10] === 24 && cnt[11] === 19 && cnt[12] === 18, '高一 / 高二 / 高三为 24 / 19 / 18（实际 ' +
  [cnt[10], cnt[11], cnt[12]].join(' / ') + '）');

// 逐条抽查：12 篇被去重的作品，全站索引里各只剩一条课内条目
const thinCourse = REMOVED.filter(r => {
  const base = PROSE_BY_ID[r[3].replace('poems-', '')];
  return sb.SITE_INDEX.filter(x => x.book === 'poems' && norm(x.text) === norm(base.text)).length !== 1;
});
chk(thinCourse.length === 0, '全站索引里 12 篇各只剩一条课内条目（异常：' + thinCourse.map(r => r[1]).join('、') + '）');

console.log('');
if (fails) { console.log('✗ 课内去重 / 《静夜思》测试失败 ' + fails + ' 项'); process.exit(1); }
console.log('🎉 课内去重 / 《静夜思》测试全部通过');
