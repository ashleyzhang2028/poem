// Issue #278：页面层（jsdom：mount / 搜索框 / 详情页 / 九部集子逐页真跑）已删除，只留数据层。
const fs = require('fs');
const vm = require('vm');
const path = __dirname + '/../';

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
['data/poems-classic.js', 'data/site-index.js'].forEach(f =>
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
chk(sandbox.SITE_BOOKS.length === 9 &&
  sandbox.SITE_BOOKS.map(b => b.page).join(',') ===
    '/,/classic/,/yuefu/,/tangshi/,/songci/,/yuanqu/,/guwen/,/jinxiandai/,/zhaoming/',
  '九部集子的索引页地址依次为 / · /classic/ · /yuefu/ · /tangshi/ · /songci/ · /yuanqu/ · /guwen/ · /jinxiandai/ · /zhaoming/' +
  '（乐府集排在唐诗之前、元曲排在宋词之后，Issue #244）');

const only = sandbox.buildSiteIndex({ tangshi: [{ id: 'ts-1', title: '感遇·其一', author: '张九龄', dynasty: '唐' }] });
chk(only.some(x => x.book === 'tangshi' && x.title === '感遇·其一') &&
  only.some(x => x.book === 'classic'),
  'buildSiteIndex 可显式注入数据源（某部集子还没发布时先顶上）');

const classicHtml = fs.readFileSync(path + 'classic/index.html', 'utf8');
const scriptOrder = classicHtml.match(/<script src="([^"]+)"><\/script>/g)
  .map(s => s.match(/src="([^"]+)"/)[1]);
chk(scriptOrder.indexOf('js/reader-core.js') >= 0, '小古文页加载了 js/reader-core.js');
chk(scriptOrder.indexOf('js/reader-core.js') < scriptOrder.indexOf('js/classic.js'),
  '引擎排在各集子的挂载脚本之前（否则 mount 还没定义）');
chk(!/window\.CLASSIC_ALL/.test(fs.readFileSync(path + 'js/reader-core.js', 'utf8')),
  '引擎里不再直接读 window.CLASSIC_ALL（数据一律由 mount 交进来）');

// ---------------------------------------------------------------------------
// Issue #278：这一层的主体是「古籍阅读库引擎」的**页面层**（jsdom 里 mount /
// 搜索框敲字 / 详情页 / 九部集子逐页跑一遍）—— 全删。留下的是数据层那几条：
// 总索引的形状、九部集子的地址顺序、挂载脚本顺序的口径。
//
// reader-core.js 是界面引擎，不在「功能验证」的范围内；原先那几条
// 「引擎 mount 回来什么」的断言一并删掉。
// ---------------------------------------------------------------------------
chk(!/window\.CLASSIC_ALL/.test(fs.readFileSync(path + 'js/reader-core.js', 'utf8')),
  '引擎里不再直接读 window.CLASSIC_ALL（数据一律由 mount 交进来）');

console.log('');
console.log(fails === 0 ? '🎉 古籍阅读库（数据层）测试全部通过' : '❌ 古籍阅读库测试 ' + fails + ' 项失败');
process.exit(fails === 0 ? 0 : 1);
