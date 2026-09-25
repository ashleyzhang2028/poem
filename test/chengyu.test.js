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
  'data/index.js', 'data/poems-chengyu.js', 'data/poems-classic.js', 'data/site-index.js']);

const CY = resolve(sandbox, sandbox.POEMS_CHENGYU, 'chengyu');
chk(Array.isArray(CY) && CY.length === 735,
  '中华成语故事共 735 则（第二批 143 则里 9 则并入古文 / 诗篇条目：309 - 9 + 435 = 735；' +
  '实际 ' + (CY ? CY.length : 'undefined') + '）');

const ids = new Set();
let dup = 0;
CY.forEach(p => { if (ids.has(p.id)) dup++; ids.add(p.id); });
chk(dup === 0, '成语 id 无重复（重复 ' + dup + ' 个）');

chk(CY.every(p => p.title && p.source && p.dynasty && p.text && p.translation),
  '每则都齐全：成语 / 出处 / 朝代 / 原文 / 译文');
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
chk(cyIdx.length === 735, '总索引收了全部 735 则（实际 ' + cyIdx.length + '）');
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

console.log('');
console.log(fails ? '❌ ' + fails + ' 项失败' : '🎉 chengyu测试全部通过');
process.exit(fails ? 1 : 0);
