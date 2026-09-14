/**
 * 生成 data/works-map.js（同篇对照表）
 * ==========================================================================
 * 口径：**正文去标点后一致 = 同一篇作品**，只登记「在两部及以上集子里
 * 重复出现」的那些组。单条的作品不必登记 —— 条目 id 自己就是作品 id。
 *
 * 为什么是离线生成的静态表，而不是每页现算：
 *   现算要先备齐六部集子的全部数据（约 3MB）。集子索引页只加载自己那一部，
 *   它也要判重（「这篇是不是已经在课内背过了」），现算得到的是残表。
 *   这一份 8KB，任何页面都能引，判重口径全站一致。
 *
 * 什么时候要重跑：
 *   · 某一部集子增补 / 订正了篇目（正文变了，判重结果就变）
 *   · data/works-index.js 的判重键（dedupKey）改了
 * 跑完记得看 git diff：新多出来的组、消失的组，都该能从改动里解释清楚。
 *
 * 用法：node scripts/build-works-map.js
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const LOAD = [
  'data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js',
  'data/poems-5.js', 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js',
  'data/poems-9.js', 'data/poems-10.js', 'data/poems-11.js', 'data/poems-12.js',
  'data/index.js', 'data/poems-classic.js', 'data/poems-tangshi.js',
  'data/poems-songci.js', 'data/poems-guwen.js', 'data/poems-zhaoming.js',
  'data/site-index.js', 'data/works-index.js'
];

const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
// works-index 依赖 data/works-map.js（有则用、无则空）——
// 生成器自己不必读它，直接现算全量即可
LOAD.forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
});

const WI = sandbox.WorksIndex;
const groups = WI.works
  .filter(function (w) { return w.entries.length > 1; })
  .map(function (w) {
    return { wid: w.wid, title: w.title, titles: w.titles, entries: w.entries };
  });
groups.sort(function (a, b) { return a.entries[0] < b.entries[0] ? -1 : 1; });

const BT = '`';
let out = '';
out += '/* ==========================================================================\n';
out += '   同篇对照表（主表裁定规则的静态成果）\n';
out += '   --------------------------------------------------------------------------\n';
out += '   由 scripts/build-works-map.js 离线算出：**正文（去标点后）一致 = 同一篇作品**。\n';
out += '   只登记「在两部及以上集子里重复出现」的那些作品（共 ' + groups.length + ' 组），\n';
out += '   单条的作品不必登记 —— 它本来就只出现一次，条目 id 自己就是作品 id。\n';
out += '\n';
out += '   ⚠️ 这是**生成文件**，改动请改 scripts/build-works-map.js 后重跑，\n';
out += '      不要手改这里 —— 下次重新生成会把手工改动覆盖掉。\n';
out += '\n';
out += '   为什么要单独落成一份**静态数据**而不是每页现算：\n';
out += '     现算要先备齐六部集子的全部数据（约 3MB）。集子索引页只加载自己那一部，\n';
out += '     它也要判重（「这篇是不是已经在课内背过了」），现算就会得到一张残表。\n';
out += '     这一份 8KB，任何页面都能引，判重口径全站一致。\n';
out += '\n';
out += '   ## 为什么不是所有同名篇目都合并\n';
out += '\n';
out += '   教材与选本的文本**真会不一样**，是文献上的差别、不是录入出错：\n';
out += '     · 《静夜思》 教材与《唐诗三百首》正文一致 → 合并为同一篇（titles 记两个题名）\n';
out += '     · 《陋室铭》 教材作「孔子云何陋之有」、古文观止作「孔子云『何陋之有』」→ 引号剥掉后\n';
out += '       正文一致，合并\n';
out += '     · 《夜上受降城闻笛》 教材作「回乐烽」、唐诗三百首作「回乐峰」→ 一字之差，是两种文本，\n';
out += '       **分成两条并列的作品**，各背各的\n';
out += '   规则一句话：**课内以教材文本为准，选集以选本原貌为准，冲突时分两条并列**。\n';
out += '\n';
out += '   字段：\n';
out += '     wid     作品 id（' + BT + 'w-' + BT + ' 加首个条目 id）\n';
out += '     title   主条目题名（有课内条目时取教材题名）\n';
out += '     titles  这一篇出现过的全部题名（同诗异题：《夜思》与《静夜思》）\n';
out += '     entries 收录这一篇的全部站点条目 id，与 data/site-index.js 同口径\n';
out += '   ========================================================================== */\n';
out += 'window.WORKS_GROUPS = [\n';
groups.forEach(function (g, i) {
  if (i > 0 && groups[i - 1].entries[0].split('-')[0] !== g.entries[0].split('-')[0]) out += '\n';
  out += '  { wid: ' + JSON.stringify(g.wid) + ', title: ' + JSON.stringify(g.title) +
    ', titles: ' + JSON.stringify(g.titles) + ', entries: ' + JSON.stringify(g.entries) + ' }' +
    (i < groups.length - 1 ? ',' : '') + '\n';
});
out += '];\n';

const target = path.join(ROOT, 'data/works-map.js');
const prev = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
fs.writeFileSync(target, out);
console.log('data/works-map.js: ' + groups.length + ' 组' +
  (prev === out ? '（内容无变化）' : '（已更新）'));
