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
  'data/index.js', 'data/poems-classic.js', 'data/poems-changshi.js',
  'data/site-index.js']);

const CS = resolve(sandbox, sandbox.POEMS_CHANGSHI, 'changshi');
chk(Array.isArray(CS) && CS.length === 204,
  '文学常识第一批共 204 条（实际 ' + (CS ? CS.length : 'undefined') + '）');

const GROUPS = ['文体知识', '作家与作品', '流派与并称', '典籍',
  '称谓与礼俗', '制度与地理', '名句与典故', '现当代文学史事件'];

const ids = new Set();
let dup = 0;
CS.forEach(p => { if (ids.has(p.id)) dup++; ids.add(p.id); });
chk(dup === 0, '条目 id 无重复（重复 ' + dup + ' 个）');

chk(CS.every(p => p.title && p.source && p.dynasty && p.author && p.text),
  '每条都齐全：术语 / 出处 / 时代 / 责任人 / 释义正文');
chk(CS.every(p => p.excerpt), '每条都给了列表用摘句（excerpt）');
chk(CS.every(p => GROUPS.indexOf(p.gradeGroup) >= 0),
  '每条都归入八组之一（文体 / 作家 / 流派 / 典籍 / 称谓 / 制度 / 典故 / 现当代）');
chk(CS.every(p => p.gradeGroup === p.group),
  '分组的 gradeGroup 与书写的 group 一致（页面按组编排）');

// 词条式：正文即释义，本就没有白话译文 —— 数据层不该混入译文
chk(CS.every(p => !p.translation),
  '词条式：每条都不带白话译文（正文即释义；『词条』不是『篇』）');

// 八组都要铺到，不偏科
GROUPS.forEach(g => {
  const n = CS.filter(p => p.gradeGroup === g).length;
  chk(n >= 15, '分组铺到：' + g + ' 有 ' + n + ' 条（≥15）');
});

// 出处都写成《书名》或书名号形式，可追溯
chk(CS.every(p => /《[^》]+》/.test(p.source)),
  '出处都带书名号，可追溯到具体典籍 / 文献');

// 点名抽查：术语与要义不得张冠李戴
const spot = {
  '左联': '中国左翼作家联盟',
  '创造社': '1921 年',
  '《新青年》': '陈独秀',
  '文学革命': '胡适',
  '建安七子': '孔融',
  '唐宋八大家': '韩愈',
  '《史记》': '纪传体通史',
  '科举制': '隋',
  '弱冠': '二十',
  '洛阳纸贵': '左思',
  '《文心雕龙》': '刘勰'
};
Object.keys(spot).forEach(t => {
  const p = CS.filter(x => x.title === t)[0];
  chk(p && p.text.indexOf(spot[t]) >= 0,
    '抽查：' + t + ' 的要义命中「' + spot[t] + '」' +
    (p ? '' : '（缺条目）'));
});

// 来源纪律：不带百科 / 公众号 / 教辅一类的表述
const FORBID = ['百度百科', '百科', '公众号', '教辅', '维基'];
const bad = [];
CS.forEach(p => FORBID.forEach(w => { if (p.text.indexOf(w) >= 0) bad.push(p.title + '·' + w); }));
chk(bad.length === 0, '来源纪律：正文不提百科 / 公众号 / 教辅（实际 ' + bad.length + ' 处）');

// ── 总索引与接线 ────────────────────────────────────────────────
const IDX = sandbox.SITE_INDEX;
const csIdx = IDX.filter(x => x.book === 'changshi' && !x.isBook);
chk(csIdx.length === 204, '总索引收了全部 204 条（实际 ' + csIdx.length + '）');
chk(csIdx.every(x => x.text), '进索引的每一条正文齐备');
chk(IDX.some(x => x.book === 'changshi' && x.isBook),
  '「文学常识」本身也作为一条结果（搜集子名能直接进那一页）');
chk(csIdx.every(x => x.id.indexOf('changshi-') === 0), '条目的 id 都带 changshi- 前缀');

const lib = read('js/library.js');
chk(/id: "changshi"/.test(lib) && /page: "\/changshi\/"/.test(lib),
  '入口页 ENTRIES 有这一部，且留着自己的页面地址');

const books = read('data/site-books.js');
chk(books.indexOf('{ id: "changshi"') > books.indexOf('{ id: "chengyu"'),
  '站点索引里文学常识排在成语故事之后（加在末尾，不动既有次序）');

const sw = read('sw.js');
chk(sw.indexOf('./changshi/') >= 0 && sw.indexOf('js/changshi.js') >= 0 &&
    sw.indexOf('data/poems-changshi.js') >= 0,
  '文学常识页 / 脚本 / 数据都进了 Service Worker 预缓存（断网也能读）');

const rs = read('js/read-sync.js');
chk(/poem_changshi_read_v1/.test(rs), '已读那一族认得 poem_changshi_read_v1（跨设备并集合并）');
chk(/poem_changshi_read_v1/.test(read('js/sync-coverage.js')),
  '同步边界总表里有这一把已读键（否则「表外键」那条守卫会红）');

const html = read('changshi/index.html');
chk(html.indexOf('data-nav="changshi"') >= 0, '常识页 body 标了 data-nav="changshi"');
chk(html.indexOf('data/poems-changshi.js') >= 0 && html.indexOf('js/changshi.js') >= 0,
  '常识页加载了数据与挂载脚本');

const engine = read('js/reader-core.js');
chk(/noTranslation/.test(engine), '引擎认 noTranslation（词条式集子不显示译文开关）');
chk(read('js/changshi.js').indexOf('noTranslation: true') >= 0,
  '挂载脚本声明了 noTranslation: true');

// ── 「不写死部数」的守卫：三道硬编码已改为同源比对 ──────────────
['test/engine.test.js', 'test/search.test.js', 'test/zhaoming.test.js', 'test/yuefu.test.js']
  .forEach(f => {
    const src = read(f);
    chk(!/SITE_BOOKS\.length\s*===\s*\d+/.test(src),
      f + ' 不再把集子部数写死成常量（改为同源 / 相对次序）');
  });

console.log('');
console.log(fails ? '❌ ' + fails + ' 项失败' : '🎉 文学常识测试全部通过');
process.exit(fails ? 1 : 0);
