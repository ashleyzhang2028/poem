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
  'data/index.js', 'data/poems-jinxiandai.js', 'data/poems-classic.js', 'data/site-index.js']);

const JD = resolve(sandbox, sandbox.POEMS_JINXIANDAI, 'jinxiandai');
chk(Array.isArray(JD) && JD.length === 24,
  '近现代诗词共 24 首（实际 ' + (JD ? JD.length : 'undefined') + '）');

const ids = new Set();
let dup = 0;
JD.forEach(p => { if (ids.has(p.id)) dup++; ids.add(p.id); });
chk(dup === 0, '乐府 id 无重复（重复 ' + dup + ' 个）');

chk(JD.every(p => p.title && p.source && p.dynasty && p.author && p.text && p.translation),
  '每首都齐全：标题 / 出处 / 朝代 / 作者 / 原文 / 译文');
chk(JD.every(p => p.excerpt), '每首都给了列表用摘句（excerpt）');

chk(JD.every(p => ['public-domain', 'school', 'academic', 'modern'].indexOf(p.translationSource) >= 0),
  '译文来源取值都在允许范围内（含现代作品的 modern）');

const GROUPS = ['革命岁月', '长征路上', '建国前后', '咏物寄怀', '狱中与就义', '志士之歌'];
chk(JD.every(p => GROUPS.indexOf(p.gradeGroup) >= 0),
  '每首都归入六个分期之一');

const need = ['沁园春·长沙', '西江月·井冈山', '七律·长征', '沁园春·雪', '卜算子·咏梅',
  '梅岭三章', '青松', '就义诗', '自嘲', '望大陆'];
const titles = JD.map(p => p.title);
chk(need.every(t => titles.indexOf(t) >= 0),
  '代表性篇目一篇不少（缺：' + need.filter(t => titles.indexOf(t) < 0).join('/') + '）');

const IDX = sandbox.SITE_INDEX;
const yfIdx = IDX.filter(x => x.book === 'jinxiandai' && !x.isBook);
chk(yfIdx.length === 24, '总索引收了全部 24 首（实际 ' + yfIdx.length + '）');
chk(yfIdx.every(x => x.text && x.translation), '进索引的每一首原文与译文齐备');
chk(IDX.some(x => x.book === 'jinxiandai' && x.isBook),
  '「近现代诗词」本身也作为一条结果（搜集子名能直接进那一页）');

console.log('');
console.log(fails ? '❌ ' + fails + ' 项失败' : '🎉 jinxiandai测试全部通过');
process.exit(fails ? 1 : 0);
