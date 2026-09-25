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
chk(Array.isArray(CY) && CY.length === 736,
  '中华成语故事共 736 则（实际 ' + (CY ? CY.length : 'undefined') + '）');

const ids = new Set();
let dup = 0;
CY.forEach(p => { if (ids.has(p.id)) dup++; ids.add(p.id); });
chk(dup === 0, '成语 id 无重复（重复 ' + dup + ' 个）');

chk(CY.every(p => p.title && p.source && p.dynasty && p.text && p.translation),
  '每则都齐全：成语 / 出处 / 朝代 / 原文 / 译文');
chk(CY.every(p => p.excerpt), '每则都给了列表用摘句（excerpt）');

chk(CY.every(p => ['public-domain', 'school', 'academic', 'modern'].indexOf(p.translationSource) >= 0),
  '译文来源取值都在允许范围内');

const GROUPS = ['上古传说', '先秦', '秦汉', '三国两晋南北朝', '唐五代', '宋辽金', '元', '明', '清'];
chk(CY.every(p => GROUPS.indexOf(p.gradeGroup) >= 0),
  '每则都归入九个时代之一');

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

const IDX = sandbox.SITE_INDEX;
const cyIdx = IDX.filter(x => x.book === 'chengyu' && !x.isBook);
chk(cyIdx.length === 736, '总索引收了全部 736 则（实际 ' + cyIdx.length + '）');
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
