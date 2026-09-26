
const fs = require('fs');
const vm = require('vm');
const path = __dirname + '/../';

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
['data/poems-classic.js', 'data/site-books.js', 'data/site-index.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path + f, 'utf8'), sandbox, { filename: f }));

const IDX = sandbox.SITE_INDEX;
chk(Array.isArray(IDX) && IDX.length === 103,
  '总索引含 102 篇小古文 + 1 条集子条目（实际 ' + (IDX ? IDX.length : 'undefined') + '）');
const ids = new Set();
let dup = 0;
IDX.forEach(x => { if (ids.has(x.id)) dup++; ids.add(x.id); });
chk(dup === 0, '总索引 id 全站唯一（每部集子带自己的前缀）');
chk(IDX.every(x => x.title && x.book && x.bookName && x.page),
  '每条结果都带齐 篇名 / 所属集子 / 集子名 / 跳转地址');
chk(IDX.some(x => x.isBook && x.title === '课外必背小古文'),
  '集子自身也是一条结果（搜「小古文」能直接进那一页）');
// 不写死「几部」，只守有业务含义的相对次序：乐府在唐诗前、元曲在宋词后、
// 昭明与成语在近现代之后（Issue #244 / #308）。集子总数与名单交给下面的同源比对。
(function () {
  const pages = sandbox.SITE_BOOKS.map(b => b.page);
  const at = p => pages.indexOf(p);
  const rel = [
    [at('/yuefu/'), at('/tangshi/'), '乐府集排在唐诗之前'],
    [at('/songci/'), at('/yuanqu/'), '元曲排在宋词之后'],
    [at('/jinxiandai/'), at('/zhaoming/'), '昭明在近现代之后'],
    [at('/zhaoming/'), at('/chengyu/'), '成语故事在昭明之后']
  ];
  rel.forEach(([a, b, m]) => chk(a >= 0 && b >= 0 && a < b, '集子次序：' + m));
})();

// 同源比对：SITE_BOOKS 与 library.js 的 ENTRIES 必须一一对应
// （id 序列相等、页面地址相等）—— 谁都不许单独加部。这样第十一部落地时
// 测试自己跟着算，只在真的漏接线时才红。
(function () {
  const libSrc = fs.readFileSync(path + 'js/library.js', 'utf8');
  const entryIds = [...libSrc.matchAll(/\n\s*id:\s*"([a-z]+)",\n\s*name:/g)].map(m => m[1]);
  const bookIds = sandbox.SITE_BOOKS.map(b => b.id);
  chk(entryIds.length === bookIds.length && entryIds.every((x, i) => x === bookIds[i]),
    'SITE_BOOKS 与 library.js 的 ENTRIES 同源（id 序列一致：实际 ' +
    entryIds.join(',') + ' vs ' + bookIds.join(',') + '）');
})();

const only = sandbox.buildSiteIndex({ tangshi: [{ id: 'ts-1', title: '感遇·其一', author: '张九龄', dynasty: '唐' }] });
chk(only.some(x => x.book === 'tangshi' && x.title === '感遇·其一') &&
  only.some(x => x.book === 'classic'),
  'buildSiteIndex 可显式注入数据源（某部集子还没发布时先顶上）');

const classicHtml = fs.readFileSync(path + 'classic/index.html', 'utf8');
const scriptOrder = classicHtml.match(/<script src="([^"]+)"><\/script>/g)
  .map(s => s.match(/src="([^"]+)"/)[1]);
chk(scriptOrder.indexOf('js/reader-core.js') >= 0, '小古文页加载了 js/reader-core.js');

chk(!/window\.CLASSIC_ALL/.test(fs.readFileSync(path + 'js/reader-core.js', 'utf8')),
  '引擎里不再直接读 window.CLASSIC_ALL（数据一律由 mount 交进来）');

console.log('');
console.log(fails === 0 ? '🎉 古籍阅读库（数据层）测试全部通过' : '❌ 古籍阅读库测试 ' + fails + ' 项失败');
process.exit(fails === 0 ? 0 : 1);
