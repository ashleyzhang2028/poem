const fs = require('fs');
const vm = require('vm');
const path = __dirname + '/../';
const read = f => fs.readFileSync(path + f, 'utf8');

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
chk(Array.isArray(CY) && CY.length >= 300,
  '中华成语故事已收 300 则以上（实际 ' + (CY ? CY.length : 'undefined') + '）');

const ids = new Set();
let dup = 0;
CY.forEach(p => { if (ids.has(p.id)) dup++; ids.add(p.id); });
chk(dup === 0, '成语 id 无重复（重复 ' + dup + ' 个）');

chk(CY.every(p => p.title && p.source && p.dynasty && p.text && p.translation),
  '每则都齐全：标题 / 出处 / 朝代 / 原文 / 译文');
chk(CY.every(p => p.excerpt), '每则都给了列表用摘句（excerpt）');
chk(CY.every(p => p.translationSource === 'public-domain'),
  '译文来源统一标注为公有领域（原文属公有领域）');

const GROUPS = ['上古传说', '夏', '商', '西周', '春秋', '战国', '秦', '西汉', '东汉', '三国',
  '两晋南北朝', '隋', '唐', '五代', '宋', '辽金', '元', '明', '清'];
chk(CY.every(p => GROUPS.indexOf(p.gradeGroup) >= 0), '每则都归入十九个朝代分组之一');

const need = ['女娲补天', '精卫填海', '夸父逐日', '愚公移山', '一鼓作气', '大义灭亲',
  '唇亡齿寒', '防民之口，甚于防川', '开卷有益', '胸有成竹', '黄粱一梦', '青梅竹马'];
const titles = CY.map(p => p.title);
chk(need.every(t => titles.indexOf(t) >= 0),
  '代表性成语一则不少（缺：' + need.filter(t => titles.indexOf(t) < 0).join('/') + '）');

const 上古 = CY.filter(p => p.gradeGroup === '上古传说').length;
const 宋 = CY.filter(p => p.gradeGroup === '宋').length;
const 战国 = CY.filter(p => p.gradeGroup === '战国').length;
chk(上古 === 11 && 宋 > 0 && 战国 > 0,
  '神话归「上古传说」、其余按最早出处归朝代（上古 ' + 上古 + '、战国 ' + 战国 + '、宋 ' + 宋 + '）');

const 黄粱 = CY.filter(p => p.title === '黄粱一梦')[0];
chk(!!黄粱 && 黄粱.dynasty === '唐' && /枕中记/.test(黄粱.source),
  'Issue #308 点名的校正已落实：黄粱一梦归「唐」、出自《枕中记》');

const 亡羊 = CY.filter(p => p.title === '亡羊补牢')[0];
chk(!!亡羊 && 亡羊.dynasty === '战国' && /战国策/.test(亡羊.source),
  'Issue #308 点名的校正已落实：亡羊补牢归「战国」、出自《战国策·楚策四》');

const 掩耳 = CY.filter(p => p.title === '掩耳盗铃')[0];
chk(!!掩耳 && 掩耳.dynasty === '战国' && /吕氏春秋/.test(掩耳.source),
  '掩耳盗铃归「战国」、出自《吕氏春秋·自知》（原清单误列入清）');

const idx = sandbox.SITE_INDEX.filter(x => x.book === 'chengyu' && !x.isBook);
chk(idx.length === CY.length, '总索引收了全部成语（实际 ' + idx.length + ' / ' + CY.length + '）');
chk(idx.every(x => x.text && x.translation), '进索引的每一则原文与译文齐备');
chk(sandbox.SITE_INDEX.some(x => x.book === 'chengyu' && x.isBook),
  '「中华成语故事」本身也作为一条结果（搜集子名能直接进那一页）');

const src = read('data/poems-chengyu.js');
const inline = [];
src.split(/\n(?=\s*\{)/).forEach(blk => {
  if (/^\s+text:\s*"/m.test(blk) || /^\s+translation:\s*"/m.test(blk)) inline.push(blk.slice(0, 40));
});
chk(inline.length === 0,
  'data/poems-chengyu.js 里正文只留 textRef（不内联副本；实际残留 ' + inline.length + ' 处）');

const sw = read('sw.js');
chk(/\.\/chengyu\//.test(sw) && /js\/chengyu\.js/.test(sw) && /data\/poems-chengyu\.js/.test(sw),
  '成语页 / 脚本 / 数据都进了 Service Worker 预缓存（断网也能读）');
chk(/poem_chengyu_read_v1/.test(read('js/read-sync.js')),
  '已读那一族认得 poem_chengyu_read_v1（跨设备并集合并）');
chk(/poem_chengyu_read_v1/.test(read('js/sync-coverage.js')),
  '同步边界总表里有这一把已读键（否则「表外键」那条守卫会红）');

console.log('');
console.log(fails ? '❌ ' + fails + ' 项失败' : '🎉 中华成语故事测试全部通过');
process.exit(fails ? 1 : 0);
