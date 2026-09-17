const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const LOAD = [
  'data/text-master.js',
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

const byId = {};
(sandbox.SITE_INDEX || []).forEach(function (p) { if (p && p.id) byId[p.id] = p; });

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
out += '     · 《静夜思》 教材与《唐诗三百首》正文一致（都是「床前明月光」的教材文本）\n';
out += '       → 合并为同一篇（titles 记两个题名）\n';
out += '     · 《陋室铭》 教材作「孔子云何陋之有」、古文观止作「孔子云『何陋之有』」→ 引号剥掉后\n';
out += '       正文一致，合并\n';
out += '     · 《夜上受降城闻笛》 教材作「回乐烽」、唐诗三百首作「回乐峰」→ 一字之差，是两种文本，\n';
out += '       **分成两条并列的作品**，各背各的\n';
out += '   规则一句话：**课内以教材文本为准，选集以选本原貌为准，冲突时分两条并列**。\n';
out += '\n';
out += '   至于同一篇作品「用哪一份正文」，那是另一份静态表的裁定 ——\n';
out += '   见 data/canonical-texts.js（课内优先，同一篇只留一份正文）。\n';
out += '\n';
out += '   ## 课内自身重复已按「低年级版本为准」去重\n';
out += '\n';
out += '   课内数据里曾有 12 组篇目在两个年级各存一份（正文一字不差），是逐页录入留下的\n';
out += '   自身重复（《绝句》二年级下 / 三年级下、《师说》高一上 / 高三下……）。\n';
out += '   已各删一条、保留低年级那条，课内条目由 273 降到 261，本表组数由 66 降到 57。\n';
out += '   跨集那 3 组只删课内自身那份，与选集的判重照旧。\n';
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

const VARIANT = [
  ['惟', '唯'], ['霪', '淫'], ['蘋', '苹'], ['翦', '剪'], ['皇', '凰'],
  ['懃', '勤'], ['絜', '洁'], ['岀', '出'], ['閒', '闲'], ['彊', '强']
];
function loose(t) {
  let s = String(t || '').replace(/\s+/g, '');
  VARIANT.forEach(function (p) { s = s.split(p[0]).join(p[1]); });
  return s;
}
const NEAR = {};
sandbox.SITE_INDEX.forEach(function (p) {
  if (!p || p.isBook || !p.text || !p.id) return;
  const k = loose(p.text);
  if (!k) return;
  (NEAR[k] = NEAR[k] || []).push(p.id);
});
const nearPairs = [];
Object.keys(NEAR).forEach(function (k) {
  const ids = NEAR[k];
  if (ids.length < 2) return;

  const strict = {};
  ids.forEach(function (id) {
    const t = String((byId[id] || {}).text || '').replace(/\s+/g, '');
    (strict[t] = strict[t] || []).push(id);
  });
  if (Object.keys(strict).length < 2) return;
  nearPairs.push({
    entries: ids.slice(),
    reason: '一字之差的两条文本传统（选本原貌 vs 教材 / 通行字），并列而不合并'
  });
});
nearPairs.sort(function (a, b) { return a.entries[0] < b.entries[0] ? -1 : 1; });

out += '/* ==========================================================================\n';
out += '   近重复对（看着像同一篇、**故意不合并**的那些）\n';
out += '   --------------------------------------------------------------------------\n';
out += '   共 ' + nearPairs.length + ' 组，由 scripts/build-works-map.js 与上面那张表一起算出。\n';
out += '\n';
out += '   判重键是「正文去标点后逐字相同」。下面这些是**再走一步**才能对上、\n';
out += '   却仍然不该并的：一字之差的两种文本传统 ——\n';
out += '\n';
out += '     《将进酒》  课内「但愿长醉不愿醒」 vs 唐诗「但愿长醉不复醒」\n';
out += '     《岳阳楼记》古文观止「霪雨霏霏」   vs 课内「淫雨霏霏」\n';
out += '     《天香》    宋词「剪春灯」         vs 宋词「翦春灯」（籀文正体）\n';
out += '     《北山移文》古文观止「比洁」       vs 昭明「比絜」（选本用本字）\n';
out += '     《答苏武书》古文观止「勤勤」       vs 昭明「懃懃」（选本用本字）\n';
out += '\n';
out += '   按本表的规则（课内以教材为准、选集以选本原貌为准、冲突时分两条并列），\n';
out += '   它们**各背各的**。写在同一处，是因为它们最容易被顺手合并：\n';
out += '   正文差不多、题名往往只差一点、搜出来还并排站着。一旦并了，\n';
out += '   学生的课本作「淫雨霏霏」，页面上却成了「霪雨霏霏」—— 不报错，只是变了。\n';
out += '\n';
out += '   ⚠️ 这是**生成文件**，改动请改 scripts/build-works-map.js 后重跑。\n';
out += '   字段：entries 条目 id（两条及以上）；reason 为什么不并\n';
out += '   ========================================================================== */\n';
out += 'window.WORKS_NEAR_DUP = [\n';
nearPairs.forEach(function (p) {
  out += '  { entries: [' + p.entries.map(function (e) { return JSON.stringify(e); }).join(', ') +
    '], reason: ' + JSON.stringify(p.reason) + ' },\n';
});
out += '];\n';
out += '\n';
const target = path.join(ROOT, 'data/works-map.js');
const prev = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
fs.writeFileSync(target, out);
console.log('data/works-map.js: ' + groups.length + ' 组' +
  (prev === out ? '（内容无变化）' : '（已更新）'));
