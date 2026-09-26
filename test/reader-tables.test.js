/* ===========================================================================
   详情页表格（Issue #347）
   ---------------------------------------------------------------------------
   守四件事：
     ① 引擎认得出正文里的两种表格画法，渲染成真 <table>；
     ② 界面上那圈 ASCII 框线**不渲染**（否则一张表两道框）；
     ③ 认不出来的（单行竖线排比句、散文里的竖线）**原样输出** ——
        宁可排得平一点，不能把老正文改坏；
     ④ 全部语料里没有「画歪的表格」（列数不齐 / 只剩一行）。
   纯 Node + vm 沙盒，不起页面。
   ========================================================================== */

const fs = require('fs');
const vm = require('vm');
const path = __dirname + '/../';
const read = f => fs.readFileSync(path + f, 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

function bootEngine() {
  const sandbox = {
    window: {}, console,
    document: { querySelector: () => null, addEventListener: () => {}, readyState: 'complete' }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('js/reader-core.js'), sandbox, { filename: 'js/reader-core.js' });
  return sandbox.ReaderEngine;
}

const E = bootEngine();
chk(E && typeof E.textToHtml === 'function' && typeof E.tableIssues === 'function',
  '引擎给出 textToHtml / tableIssues 两个入口（页面与测试共用一套判别）');

const plain = s => s;
const h = doc => E.textToHtml(doc, plain);

// ── ① 有框表 ──────────────────────────────────────────────────
const box = h([
  '说明一句。',
  '',
  '┌──────┬────────┐',
  '│ 年号 │ 帝王   │',
  '├──────┼────────┤',
  '│ 建元 │ 汉武帝 │',
  '│ 元光 │ 汉武帝 │',
  '└──────┴────────┘',
  '',
  '表后一句。'
].join('\n'));

chk(/<table class="rd-table">/.test(box), '有框表渲染成 <table class="rd-table">');
chk(/<thead><tr><th>年号<\/th><th>帝王<\/th><\/tr><\/thead>/.test(box),
  '框线下面第一个框行当表头（<th>）');
chk((box.match(/<td>/g) || []).length === 4, '其余框行当数据行（2 行 × 2 列）');
chk(box.indexOf('┌') < 0 && box.indexOf('│') < 0,
  '**画出来的框线不渲染**（否则页面上同一张表有两道框）');
chk(/说明一句。<br><br><div class="rd-scroll">/.test(box) && /<\/table><\/div><br>表后一句。/.test(box),
  '表前后的话照旧成段，表夹在中间');
chk(/<div class="rd-scroll">/.test(box),
  '表格外面套一层可横向滚动的壳（窄屏上表格滑得动）');

// ── ② 无框表 ──────────────────────────────────────────────────
const grid = h(['文 ｜ 经纬天地', '武 ｜ 刚强直理', '成 ｜ 安民立政'].join('\n'));
chk(/<table class="rd-grid">/.test(grid), '无框对齐表渲染成 <table class="rd-grid">');
chk((grid.match(/<tr>/g) || []).length === 3, '三行都进了表');
chk(grid.indexOf('｜') < 0, '无框表的竖线不渲染（真表格用边框分列）');

const gridHead = h(['年号 ｜ 帝王', '──── ｜ ────', '建元 ｜ 汉武帝', '元光 ｜ 汉武帝'].join('\n'));
chk(/<thead><tr><th>年号<\/th><th>帝王<\/th><\/tr><\/thead>/.test(gridHead),
  '首行下面跟着一条分隔线时，首行当表头');
chk(gridHead.indexOf('────') < 0, '那条分隔线自己不渲染成行');

// 半角竖线也认
const half = h(['a | b', 'c | d'].join('\n'));
chk(/<table class="rd-grid">/.test(half) && (half.match(/<td>/g) || []).length === 4,
  '半角「|」写的无框表也认');

// ── ③ 认不出来就原样输出 ──────────────────────────────────────
const one = h('三套称号可用一图表示：\n谥号 ｜ 评行迹');
chk(one.indexOf('<table') < 0 && one.indexOf('谥号 ｜ 评行迹') >= 0,
  '孤零零一行竖线句**不成表**，原样输出（老正文里这种排比句不少）');

const mixed = h('一句 ｜ 带竖线的话\n\n另一句 ｜ 也是。');
chk(mixed.indexOf('<table') < 0, '空行隔开的两句孤行不被拼成一张表');

const prose = h('正文里出现一次「甲 ｜ 乙」这种写法，下面接着的是散文。\n散文第二行。');
chk(prose.indexOf('<table') < 0, '散文里的竖线不成表');

const unequal = h('a ｜ b\nc ｜ d ｜ e');
chk(unequal.indexOf('<table') < 0, '列数不一样的两行不成表');

// ── ④ 表格 + 注音共存 ────────────────────────────────────────
/* 全文注音是逐字符插 <ruby>。表格必须先切成结构、再只在单元格内部注音，
   否则注音会插进格线里，变成「一列汉字一列拼音」的乱码。 */
const annotated = E.textToHtml([
  '┌────┬────────┐',
  '│ 谥字 │ 字义     │',
  '├────┼────────┤',
  '│ 炀 │ 去礼远众 │',
  '└────┴────────┘'
].join('\n'), s => '<ruby>' + s + '<rt>TEST</rt></ruby>');

chk(/<th><ruby>谥字<rt>TEST<\/rt><\/ruby><\/th>/.test(annotated),
  '注音插在**单元格内部**（不是插进格线里）');
chk(/<td><ruby>去礼远众<rt>TEST<\/rt><\/ruby><\/td>/.test(annotated),
  '说明列 likewise 在单元格内部注音');
chk(annotated.indexOf('<ruby>│') < 0 && annotated.indexOf('<ruby>┌') < 0,
  '框线字符一个都没被注音包住');

// ── ⑤ 语料自查：没有画歪的表 ─────────────────────────────────
const sb = { window: {}, console };
sb.window = sb;
vm.createContext(sb);
vm.runInContext(read('data/text-master.js'), sb, { filename: 'data/text-master.js' });

const bad = [];
let tables = 0;
(sb.TEXT_MASTER || []).forEach(function (m) {
  const issues = E.tableIssues(m.text || '');
  if (issues.length) bad.push(m.id + ' → 第 ' + issues[0].line + ' 行（应 ' + issues[0].want + ' 列）');
  (m.text || '').split('\n').forEach(function (l) {
    if (l.trim().charAt(0) === '┌') tables++;
  });
});
chk(tables >= 9, '正文里已有 ' + tables + ' 张画好的表（≥9）');
chk(bad.length === 0, '全部语料里没有画歪的表格' + (bad.length ? '：' + bad.slice(0, 5).join('；') : ''));

const csChecks = {
  'changshi-cs-206': '谥法分类条改成了表',
  'changshi-cs-207': '美谥字义表改成了表',
  'changshi-cs-208': '恶谥字义表改成了表',
  'changshi-cs-210': '历代帝王谥号（先秦至南北朝）改成了表',
  'changshi-cs-211': '历代帝王谥号（隋至清）改成了表',
  'changshi-cs-214': '历代庙号（汉至唐）改成了表',
  'changshi-cs-215': '历代庙号（宋至清）改成了表',
  'changshi-cs-217': '年号取名用字表改成了表',
  'changshi-cs-218': '历代年号（汉至南北朝）改成了表',
  'changshi-cs-219': '历代年号（隋至清）改成了表',
  'changshi-cs-221': '常见帝王称谓对照表改成了表'
};
const byId = {};
(sb.TEXT_MASTER || []).forEach(function (m) { byId[m.id] = m; });
Object.keys(csChecks).forEach(function (id) {
  const m = byId[id];
  const text = m ? m.text || '' : '';
  const ok = m && /┌/.test(text) &&
    E.textToHtml(text, plain).indexOf('<table') >= 0;
  chk(ok, csChecks[id] + '（' + id + '）');
});

// 表里的内容不许在改写中丢掉 —— 随手抽查几处人名 / 谥字
const spot = {
  'changshi-cs-208': ['隋炀帝', '周厉王', '晋灵公', '夏桀'],
  'changshi-cs-211': ['隋', '唐', '宋', '明', '清', '努尔哈赤', '玄烨'],
  'changshi-cs-215': ['康熙', '乾隆', '光绪', '万历'],
  'changshi-cs-219': ['开皇', '贞观', '洪武', '宣统'],
  'changshi-cs-221': ['汉武帝', '唐太宗', '宋仁宗', '康熙帝']
};
Object.keys(spot).forEach(function (id) {
  const text = (byId[id] || {}).text || '';
  spot[id].forEach(function (w) {
    chk(text.indexOf(w) >= 0, '改写后 ' + id + ' 仍收着「' + w + '」');
  });
});

// ── ⑥ 接线：样式表与页面 ────────────────────────────────────
const css = read('css/reader-tables.css');
chk(/\.rd-table/.test(css) && /\.rd-grid/.test(css) && /\.rd-scroll/.test(css),
  '全局样式表 css/reader-tables.css 里三族表格样式齐备');
chk(/--line\b/.test(css) && /--green\b/.test(css),
  '表格用的是全站主题令牌（换主题时表格跟着变，不另起一套色）');

const pages = read('changshi/index.html');

const sw = read('sw.js');
chk(sw.indexOf('./css/reader-tables.css') >= 0, '表格样式表进了 SW 预缓存（离线也好看）');

// 每一张带阅读器的页面都要有 —— 用户要的是「所有详情页一个样式」
['index.html', 'poems/index.html', 'library/index.html', 'classic/index.html',
 'tangshi/index.html', 'songci/index.html', 'guwen/index.html', 'zhaoming/index.html',
 'yuanqu/index.html', 'yuefu/index.html', 'jinxiandai/index.html',
 'chengyu/index.html', 'changshi/index.html', 'search/index.html',
 'progress/index.html'].forEach(function (p) {
  chk(read(p).indexOf('css/reader-tables.css') >= 0,
    p + ' 带上了全局表格样式表');
});

const gen = read('scripts/changshi-tables.js');
chk(/require\(['"]\.\/lib\/table\.js['"]\)/.test(gen) && /tableIssues/.test(read('test/reader-tables.test.js')),
  '表格是脚本生成的（不是手打的），且生成结果由本测试守着');

console.log('');
console.log(fails ? '❌ ' + fails + ' 项失败' : '🎉 详情页表格测试全部通过');
process.exit(fails ? 1 : 0);
