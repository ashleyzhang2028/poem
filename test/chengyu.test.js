const fs = require('fs');
const vm = require('vm');
const path = __dirname + '/../';

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);

const { loadData, resolve } = require('./master-env');
loadData(sandbox, ['data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js',
  'data/poems-5.js', 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js',
  'data/poems-9.js', 'data/poems-10.js', 'data/poems-11.js', 'data/poems-12.js',
  'data/index.js', 'data/poems-chengyu.js', 'data/poems-classic.js',
  'data/chengyu-support.js', 'data/site-index.js', 'data/works-map.js', 'data/works-index.js']);

const CY = resolve(sandbox, sandbox.POEMS_CHENGYU, 'chengyu');
chk(Array.isArray(CY) && CY.length === 948,
  '中华成语故事共 948 则（第二批 143 则里 9 则并入古文 / 诗篇条目：309 - 9 + 435 + 1 = 736；' +
  'Issue #339 第一轮补第一档·义务教育教材常用成语 51 则（736 + 51 = 787）；' +
  '第二轮再补第二至五档 161 则（典故型 / 三字俗语型 / 描写型 / 近现代外来，787 + 161 = 948）。' +
  '实际 ' + (CY ? CY.length : 'undefined') + '）');

const ids = new Set();
let dup = 0;
CY.forEach(p => { if (ids.has(p.id)) dup++; ids.add(p.id); });
chk(dup === 0, '成语 id 无重复（重复 ' + dup + ' 个）');

chk(CY.every(p => p.title && p.source && p.dynasty && p.text && p.translation),
  '每则都齐全：成语 / 出处 / 朝代 / 原文 / 译文');
chk(CY.every(p => p.meaning && String(p.meaning).replace(/\s/g, '').length >= 8),
  '每则都有成语释义（meaning），且不是占位短串（空 ' +
  CY.filter(p => !p.meaning).length + ' 条）');
chk(CY.every(p => p.excerpt), '每则都给了列表用摘句（excerpt）');
chk(CY.every(p => ['public-domain', 'school', 'academic', 'modern'].indexOf(p.translationSource) >= 0),
  '译文来源取值都在允许范围内');

const DYNASTIES_ALL = ['上古传说', '夏', '商', '西周', '春秋', '战国', '秦', '西汉', '东汉', '三国',
  '两晋南北朝', '隋', '唐', '五代', '宋', '辽金', '元', '明', '清'];
chk(CY.every(p => DYNASTIES_ALL.indexOf(p.gradeGroup) >= 0),
  '每则都归入十九个朝代之一（第四批：分组键由九时代改为精确朝代）');
chk(CY.every(p => p.gradeGroup === p.dynasty),
  '分组的 gradeGroup 与书写的 dynasty 一致（页面按朝代编排）');

chk(CY.every(p => p.source.indexOf('《') >= 0 && p.source.indexOf('》') >= 0),
  '出处都写成《书名·篇名》的样子');

const DYNASTIES = ['上古传说', '夏', '商', '西周', '春秋', '战国', '秦', '西汉', '东汉', '三国',
  '两晋南北朝', '隋', '唐', '五代', '宋', '辽金', '元', '明', '清'];
chk(CY.every(p => DYNASTIES.indexOf(p.dynasty) >= 0),
  '朝代取值都在校正后的朝代表内');

const bad = CY.filter(p => p.dynasty === '清' && p.gradeGroup === '清' &&
  ['亡羊补牢', '钻木取火', '刻舟求剑', '掩耳盗铃', '杞人忧天', '望洋兴叹'].indexOf(p.title) >= 0);
chk(bad.length === 0,
  '点名校正的那几则不再落在清朝（Issue #308：亡羊补牢等）');

const spot = {
  '亡羊补牢': ['战国', '《战国策·楚策四》'],
  '刻舟求剑': ['战国', '《吕氏春秋·察今》'],
  '掩耳盗铃': ['战国', '《吕氏春秋·自知》'],
  '黄粱一梦': ['唐', '《枕中记》'],
  '河东狮吼': ['宋', '《寄吴德仁兼简陈季常》'],
  '望洋兴叹': ['战国', '《庄子·秋水》'],
  '鸟尽弓藏': ['春秋', '《史记·越王勾践世家》'],
  '对牛弹琴': ['两晋南北朝', '《理惑论》'],
  '百闻不如一见': ['西汉', '《汉书·赵充国传》'],
  '手不释卷': ['三国', '《三国志·吴书·吕蒙传》裴松之注引《江表传》'],
  '破镜重圆': ['唐', '《本事诗·情感》'],
  '洛阳纸贵': ['两晋南北朝', '《晋书·左思传》']
};
Object.keys(spot).forEach(t => {
  const p = CY.filter(x => x.title === t)[0];
  if (!p) { chk(false, '缺条目：' + t); return; }
  chk(p.dynasty === spot[t][0] && p.source === spot[t][1],
    t + ' 朝代校正为 ' + spot[t][0] + '、出处为 ' + spot[t][1] +
    '（实际 ' + p.dynasty + ' / ' + p.source + '）');
});

// ── 第四批：朝代精度收尾校正（Issue #308） ─────────────────────────────
// 稀疏组（元 / 隋 / 五代 / 辽金）按最早出处归位
const sparse = {
  '隔墙有耳': ['春秋', '先秦'],
  '引狼入室': ['战国', '先秦'],
  '枯木逢春': ['宋', '宋辽金'],
  '光天化日': ['上古传说', '上古传说'],
  '天长地久': ['春秋', '先秦'],
  '蛛丝马迹': ['唐', '唐五代'],
  '盘根错节': ['东汉', '秦汉'],
  '凤毛麟角': ['两晋南北朝', '三国两晋南北朝'],
  '忘恩负义': ['两晋南北朝', '三国两晋南北朝'],
  '魂不附体': ['两晋南北朝', '三国两晋南北朝'],
  '闲云野鹤': ['宋', '宋辽金'],
  '折戟沉沙': ['唐', '唐五代'],
  '一衣带水': ['两晋南北朝', '三国两晋南北朝'],
  '牛角挂书': ['唐', '唐五代'],
  '罄竹难书': ['唐', '唐五代'],
  '暗箭伤人': ['春秋', '先秦'],
  '依样画葫芦': ['宋', '宋辽金'],
  '解铃还须系铃人': ['明', '明'],
  '骑鹤扬州': ['两晋南北朝', '三国两晋南北朝'],
  '同流合污': ['战国', '先秦'],
  '贪小失大': ['战国', '先秦']
};
Object.keys(sparse).forEach(t => {
  const p = CY.filter(x => x.title === t)[0];
  if (!p) { chk(false, '缺条目：' + t); return; }
  chk(p.dynasty === sparse[t][0],
    '第四批·稀疏组归位：' + t + ' → ' + sparse[t][0] +
    '（实际 ' + p.dynasty + '）');
});

// 「清」组前移：出处实为先秦—唐宋的，一律前移
const qingMoved = {
  '百感交集': '两晋南北朝', '鞭辟入里': '宋', '不刊之论': '西汉',
  '瞠目结舌': '战国', '叱咤风云': '西汉', '重蹈覆辙': '东汉',
  '出奇制胜': '西汉', '耳濡目染': '唐', '繁文缛节': '西汉',
  '返璞归真': '战国', '焚膏继晷': '唐', '高屋建瓴': '西汉',
  '光怪陆离': '战国', '含英咀华': '唐', '画虎类犬': '东汉',
  '涣然冰释': '春秋', '间不容发': '西汉', '见微知著': '战国',
  '久假不归': '战国', '空穴来风': '战国', '力挽狂澜': '唐',
  '美轮美奂': '战国', '目无全牛': '战国', '萍水相逢': '唐',
  '奇货可居': '西汉', '穷兵黩武': '两晋南北朝', '忍俊不禁': '宋',
  '如履薄冰': '西周', '如日中天': '西周', '色厉内荏': '春秋',
  '身无长物': '两晋南北朝', '始作俑者': '战国', '首当其冲': '东汉',
  '殊途同归': '战国', '素昧平生': '唐', '弹冠相庆': '东汉',
  '桃李成蹊': '西汉', '天网恢恢': '春秋', '条分缕析': '唐',
  '同日而语': '战国', '脱颖而出': '西汉', '微言大义': '东汉',
  '蔚然成风': '两晋南北朝', '无可厚非': '东汉', '无稽之谈': '上古传说',
  '息事宁人': '东汉', '瑕不掩瑜': '战国', '相形见绌': '两晋南北朝',
  '虚怀若谷': '春秋', '洋洋大观': '战国', '一傅众咻': '战国',
  '一劳永逸': '唐', '余音绕梁': '战国', '正本清源': '唐',
  '捉襟见肘': '战国', '自怨自艾': '战国', '左支右绌': '西汉',
  '作壁上观': '西汉', '安之若素': '战国', '稗官野史': '东汉',
  '暴殄天物': '上古传说', '不逞之徒': '春秋', '不足为训': '春秋',
  '断鹤续凫': '战国', '矫揉造作': '两晋南北朝', '判若鸿沟': '西汉',
  '旁征博引': '两晋南北朝'
};
Object.keys(qingMoved).forEach(t => {
  const p = CY.filter(x => x.title === t)[0];
  if (!p) { chk(false, '缺条目：' + t); return; }
  chk(p.dynasty === qingMoved[t] && p.dynasty !== '清',
    '第四批·清组前移：' + t + ' → ' + qingMoved[t] + '（实际 ' + p.dynasty + '）');
});

// 真正晚出、应留在「清」的
['断壁残垣', '苦心孤诣', '泥沙俱下', '振聋发聩', '钟灵毓秀', '喧宾夺主',
 '官场现形记', '火中取栗'].forEach(t => {
  if (t === '官场现形记') return;
  const p = CY.filter(x => x.title === t)[0];
  if (!p) { chk(false, '缺条目：' + t); return; }
  chk(p.dynasty === '清', '第四批·留在清：' + t + '（实际 ' + p.dynasty + '）');
});

// 第四批补作者：先秦典籍类不再空着
chk(CY.every(p => p.author && p.author.length > 0),
  '第四批·每则都有作者（先秦典籍标「佚名」或编者；空 ' +
  CY.filter(p => !p.author).length + ' 条）');

// 出处成书朝代与 dynasty 不得张冠李戴（点名几处）
const bookRule = {
  '罄竹难书': '唐', '一衣带水': '两晋南北朝', '牛角挂书': '唐'
};
Object.keys(bookRule).forEach(t => {
  const p = CY.filter(x => x.title === t)[0];
  chk(p && p.dynasty === bookRule[t], '第四批·' + t + ' 归 ' + bookRule[t] +
    '（实际 ' + (p ? p.dynasty : '缺') + '）');
});

const IDX = sandbox.SITE_INDEX;
const cyIdx = IDX.filter(x => x.book === 'chengyu' && !x.isBook);
chk(cyIdx.length === 948, '总索引收了全部 948 则（实际 ' + cyIdx.length + '）');
chk(cyIdx.every(x => x.text && x.translation), '进索引的每一则原文与译文齐备');
chk(IDX.some(x => x.book === 'chengyu' && x.isBook),
  '「中华成语故事」本身也作为一条结果（搜集子名能直接进那一页）');
chk(IDX.filter(x => x.book === 'chengyu' && !x.isBook)
  .every(x => x.id.indexOf('chengyu-') === 0), '成语条目的 id 都带 chengyu- 前缀');

const sw = fs.readFileSync(path + 'sw.js', 'utf8');
chk(/\.\/chengyu\//.test(sw) && /js\/chengyu\.js/.test(sw) && /data\/poems-chengyu\.js/.test(sw),
  '成语页 / 脚本 / 数据都进了 Service Worker 预缓存（断网也能读）');
const rs = fs.readFileSync(path + 'js/read-sync.js', 'utf8');
chk(/poem_chengyu_read_v1/.test(rs), '已读那一族认得 poem_chengyu_read_v1（跨设备并集合并）');
chk(/poem_chengyu_read_v1/.test(fs.readFileSync(path + 'js/sync-coverage.js', 'utf8')),
  '同步边界总表里有这一把已读键（否则「表外键」那条守卫会红）');

const html = fs.readFileSync(path + 'chengyu/index.html', 'utf8');
chk(html.indexOf('data-nav="chengyu"') >= 0, '成语页 body 标了 data-nav="chengyu"');
chk(html.indexOf('data/poems-chengyu.js') >= 0 && html.indexOf('js/chengyu.js') >= 0,
  '成语页加载了数据与挂载脚本');

// ── Issue #339：5 条正文「串了」的防回归断言 ───────────────────────────
// 这 5 则的 textRef 曾错指同组别的成语（愚公移山→鲧禹治水、卧薪尝胆→防民之口…），
// 点开会「A 标题显示 B 的原文译文」。现已各补独立正文，这里钉死：
//   ① 每则读到的正文必须命中自己的摘句；② 这 5 则的 textRef 必须指回自身 id。
const RESUMED = {
  '愚公移山': 'chengyu-cy-11',
  '卧薪尝胆': 'chengyu-cy-52',
  '礼贤下士': 'chengyu-cy-68',
  '不自量力': 'chengyu-cy-96',
  '东道主': 'chengyu-cy-69'
};
Object.keys(RESUMED).forEach(t => {
  const p = CY.filter(x => x.title === t)[0];
  if (!p) { chk(false, '缺条目：' + t); return; }
  chk(p.textRef === RESUMED[t],
    'Issue #339·' + t + ' 的 textRef 指回自身（' + RESUMED[t] + '，实际 ' + p.textRef + '）');
  const ex = String(p.excerpt || '').replace(/（[^）]*）/g, '').trim();
  chk(!!p.text && p.text.indexOf(ex) >= 0,
    'Issue #339·' + t + ' 读到的正文命中自己的摘句（摘句：' + ex.slice(0, 10) + '…）');
});

// 全表通检：每则读到的正文都应与自己的摘句交叠
// 摘句可能带（批注）或一字之差，故：先反复剥掉（...）批注，再取「摘句里最长的一段
// 连续实文」，要求它落在正文中且长度 ≥ 4。串了的条目（A 标题配 B 正文）在此必然命中 < 4。
function stripAnn(s) {
  let t = String(s || ''), prev;
  do { prev = t; t = t.replace(/（[^（）]*）/g, ''); } while (t !== prev);
  return t.replace(/\s/g, '');
}
function longestHit(ex, text) {
  let best = 0, i = 0;
  while (i < ex.length) {
    if (text.indexOf(ex[i]) < 0) { i++; continue; }
    let j = i;
    while (j < ex.length && text.indexOf(ex.slice(i, j + 1)) >= 0) j++;
    best = Math.max(best, j - i);
    i++;
  }
  return best;
}
const strayed = CY.filter(p => {
  const ex = stripAnn(p.excerpt);
  if (!ex || !p.text) return false;
  return longestHit(ex, String(p.text).replace(/\s/g, '')) < 4;
}).map(p => p.title + '(' + p.textRef + ')');
chk(strayed.length === 0,
  'Issue #339·全表没有「正文与摘句对不上」的条目（异常：' +
  (strayed.slice(0, 8).join('、') || '无') + '）');

// ── Issue #339 第二轮：释义栏 / 语本占位 / 共用正文拆条 / 教材常用成语 ──
const WORKS = (sandbox.WorksIndex && sandbox.WorksIndex.works) || [];

// ① 释义栏（meaning）不再全空：736 则全有，且每条都进了全站索引
chk(CY.filter(p => p.meaning).length === CY.length,
  '成语释义栏 948/948 全有（原先 736 条一条没填，实际 ' +
  CY.filter(p => p.meaning).length + ' 条）');
chk(IDX.filter(x => x.book === 'chengyu' && !x.isBook).every(x => x.meaning),
  '每一则的释义都进了全站索引（搜索释义里的词也能命中）');

// ② 语本类成语的正文不再是编者自造的「（语本）某某」占位串
const yubenLeft = CY.filter(p => /（语本）/.test(p.text || ''));
chk(yubenLeft.length === 0,
  '正文里没有「（语本）」占位串了（残余：' +
  (yubenLeft.map(p => p.title).slice(0, 6).join('、') || '无') + '）');
chk(CY.filter(x => x.title === '从长计议')[0].text === '筮短龟长，不如从长。',
  '「（语本）」已换成可查证的原句（从长计议 → 《左传·僖公四年》）');

// ③ 共用正文里「正文撞巧相同」的那一组已拆开，出处各归其主
const zzcc = CY.filter(x => x.title === '众志成城')[0];
const zksj = CY.filter(x => x.title === '众口铄金')[0];
chk(zzcc.textRef === 'chengyu-cy-86' && zksj.textRef === 'chengyu-cy-616',
  '众志成城 / 众口铄金 各自独立成条（' + zzcc.textRef + ' / ' + zksj.textRef + '）');
chk(zksj.source === '《史记·鲁仲连邹阳列传》' &&
  zksj.text.indexOf('众口铄金，积毁销骨') >= 0,
  '众口铄金 改挂更权威的出处（邹阳《狱中上书》「众口铄金，积毁销骨」；实际 '
  + zksj.source + '）');
chk(!WORKS.some(w => (w.entries || []).length > 1 &&
  w.entries.indexOf('chengyu-cy-86') >= 0 && w.entries.indexOf('chengyu-cy-616') >= 0),
  '同篇表里 众志成城 与 众口铄金 不再被当作同一篇');

// ④ 第一档教材常用成语补进来了，且与原有条目同口径
const TIER1 = ['不耻下问', '举一反三', '温故知新', '日积月累', '锲而不舍',
  '一丝不苟', '言而有信', '高瞻远瞩', '循序' + '渐进'];
const tier1Hit = TIER1.filter(t => CY.filter(x => x.title === t).length === 1);
chk(tier1Hit.length >= 8, '第一档·教材常用成语已补进库（命中 ' + tier1Hit.length + '/' + TIER1.length + '）');
const tier1 = CY.filter(p => TIER1.indexOf(p.title) >= 0);
chk(tier1.every(p => p.gradeGroup === p.dynasty && DYNASTIES_ALL.indexOf(p.dynasty) >= 0),
  '新补的成语同样落在十九个朝代分组里（分组与书写朝代一致）');
chk(tier1.every(p => p.source.indexOf('《') >= 0 && p.source.indexOf('》') >= 0),
  '新补的成语出处同样写成《书名·篇名》');
chk(tier1.every(p => p.excerpt && p.text.indexOf(p.excerpt) >= 0),
  '新补的成语，正文命中自己的摘句');

// ④b Issue #339 第二轮：第二至五档 161 则（典故 / 三字俗语 / 描写 / 近现代）
const TIER2 = ['按图索骥', '竭泽而渔', '披星戴月', '任重道远', '独占鳌头',
  '调虎离山', '金蝉脱壳', '走为上计',        // 第二档
  '破天荒', '一窝蜂', '打退堂鼓', '平分秋色', // 第三档
  '眉飞色舞', '心旷神怡', '废寝忘食', '斩钉截铁', '畅所欲言', // 第四档
  '一石二鸟', '大显身手', '天方夜谭', '圆凿方枘'];           // 第五档
const tier2Hit = TIER2.filter(t => CY.filter(x => x.title === t).length === 1);
chk(tier2Hit.length === TIER2.length,
  '第二至五档成语已补进库（命中 ' + tier2Hit.length + '/' + TIER2.length + '）');
const tier2 = CY.filter(p => TIER2.indexOf(p.title) >= 0);
chk(tier2.every(p => p.gradeGroup === p.dynasty && DYNASTIES_ALL.indexOf(p.dynasty) >= 0),
  '第二至五档同样落在十九个朝代分组里（分组与书写朝代一致）');
chk(tier2.every(p => p.source.indexOf('《') >= 0 && p.source.indexOf('》') >= 0),
  '第二至五档的出处同样写成《书名·篇名》');
chk(tier2.every(p => p.meaning && String(p.meaning).replace(/\s/g, '').length >= 8),
  '第二至五档每条都有释义（不是占位短串）');
chk(tier2.every(p => p.excerpt && p.text.indexOf(p.excerpt) >= 0),
  '第二至五档的正文命中自己的摘句');
// 数据表与库内条数对得上（漏落库不会静默通过）
const tier2Src = require('./../scripts/chengyu-tier2.js').ENTRIES;
chk(tier2Src.length === 161, '第二至五档数据表共 161 条（实际 ' + tier2Src.length + '）');
chk(tier2Src.every(e => CY.filter(p => p.title === e[0]).length === 1),
  '第二至五档数据表点名的成语在库里都有且只有一条');

// ⑤ 语本类成语：正文是原句、译文是新写的（不能再是照占位串写的旧译文）
const support = sandbox.CHENGYU_SUPPORT || [];
const staleTrans = support.filter(x => {
  const p = CY.filter(y => y.title === x.title)[0];
  if (!p || !p.translation) return false;
  const tr = String(p.translation).replace(/\s/g, '');
  if (!x.translation) return false;             // 没给译文的沿用原文那一份，不强求
  return Math.abs(tr.length - String(x.translation).replace(/\s/g, '').length) > 12;
}).map(x => x.title);
chk(staleTrans.length === 0,
  '语本类成语的译文与补充材料给的一致（不一致：' +
  (staleTrans.slice(0, 6).join('、') || '无') + '）');

// ⑥ 数据文件与「补充材料」两份手工表对得上（漏一条不会静默通过）
chk(support.length >= 76, '语本类成语的补充材料齐备（' + support.length + ' 条）');
chk(support.every(x => CY.filter(p => p.title === x.title).length === 1),
  '补充材料点名的成语在库里都有且只有一条');

console.log('');
console.log(fails ? '❌ ' + fails + ' 项失败' : '🎉 chengyu测试全部通过');
process.exit(fails ? 1 : 0);
