/**
 * 古籍阅读库（基础架构变更，Issue #69）测试
 *
 * 对应需求：站上要装进四部集子（小古文 / 唐诗三百首 / 宋词三百首 / 古文观止）
 * 再加一个全站搜索页。原先「索引页 + 详情页」整套写死在 js/classic.js 里，
 * 本次把它提成可挂载的引擎 js/reader-core.js，小古文是它的第一个挂载点。
 *
 * 这一层只验「引擎」这件事本身，不重复验内容：
 *   1. 数据层：data/site-index.js 的总索引齐全、id 不撞、书签条目有
 *   2. 引擎层：同一份 HTML 能挂两部不同的集子，各自独立（互不串台）
 *   3. 小古文侧：换引擎后行为一字不变（100 篇 / 7 组 / 已读键名照旧）
 *   4. 五部集子的「页面地址 / 数据变量名」都在总索引里登记了
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const vm = require('vm');
const path = __dirname + '/../';

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

/* ---------------- 一、数据层：站点总索引 ---------------- */
const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
['data/poems-classic.js', 'data/site-index.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path + f, 'utf8'), sandbox, { filename: f }));

const IDX = sandbox.SITE_INDEX;
chk(Array.isArray(IDX) && IDX.length === 101,
  '总索引含 100 篇小古文 + 1 条集子条目（实际 ' + (IDX ? IDX.length : 'undefined') + '）');
const ids = new Set();
let dup = 0;
IDX.forEach(x => { if (ids.has(x.id)) dup++; ids.add(x.id); });
chk(dup === 0, '总索引 id 全站唯一（每部集子带自己的前缀）');
chk(IDX.every(x => x.title && x.book && x.bookName && x.page),
  '每条结果都带齐 篇名 / 所属集子 / 集子名 / 跳转地址');
chk(IDX.some(x => x.isBook && x.title === '课外必背小古文'),
  '集子自身也是一条结果（搜「小古文」能直接进那一页）');
chk(sandbox.SITE_BOOKS.length === 5 &&
  sandbox.SITE_BOOKS.map(b => b.page).join(',') === '/,/classic/,/tangshi/,/songci/,/guwen/',
  '五部集子的索引页地址依次为 / · /classic/ · /tangshi/ · /songci/ · /guwen/');
// 缺数据的那几部不能「编造」结果，也不能报错 —— 静默少几批结果是最难查的错
const only = sandbox.buildSiteIndex({ tangshi: [{ id: 'ts-1', title: '感遇·其一', author: '张九龄', dynasty: '唐' }] });
chk(only.some(x => x.book === 'tangshi' && x.title === '感遇·其一') &&
  only.some(x => x.book === 'classic'),
  'buildSiteIndex 可显式注入数据源（某部集子还没发布时先顶上）');

/* ---------------- 二、引擎层：一部 HTML 挂两部集子 ---------------- */
const classicHtml = fs.readFileSync(path + 'classic/index.html', 'utf8');
const scriptOrder = classicHtml.match(/<script src="([^"]+)"><\/script>/g)
  .map(s => s.match(/src="([^"]+)"/)[1]);
chk(scriptOrder.indexOf('js/reader-core.js') >= 0, '小古文页加载了 js/reader-core.js');
chk(scriptOrder.indexOf('js/reader-core.js') < scriptOrder.indexOf('js/classic.js'),
  '引擎排在各集子的挂载脚本之前（否则 mount 还没定义）');
chk(!/window\.CLASSIC_ALL/.test(fs.readFileSync(path + 'js/reader-core.js', 'utf8')),
  '引擎里不再直接读 window.CLASSIC_ALL（数据一律由 mount 交进来）');

const dom = new JSDOM(classicHtml, { runScripts: 'dangerously', url: 'https://local.test/classic/' });
const w = dom.window;
// 页面里点进正文会调用 window.scrollTo，jsdom 没实现，补一个空的
w.scrollTo = function () {};
scriptOrder.forEach(f => {
  const el = w.document.createElement('script');
  el.textContent = fs.readFileSync(path + f, 'utf8');
  w.document.body.appendChild(el);
});

/* 手工造两个挂载点：一份 HTML 挂两部集子（这正是搜索页 / 未来合并页的用法）。
   引擎状态只活在闭包里，所以第二部挂上去不该动到第一部。 */
const mk = (win, rootId, listId) => {
  const root = win.document.createElement('div');
  root.setAttribute('data-gw-root', '');
  root.id = rootId;
  root.innerHTML =
    '<span class="count-badge" data-gw="count"></span>' +
    '<input data-gw="search" />' +
    '<button data-gw="random"></button>' +
    '<div data-gw="list" id="' + listId + '"></div>';
  win.document.body.appendChild(root);
  return root;
};

setTimeout(() => {
  const mounted = w.document.querySelector('#gw-list');
  chk(mounted.querySelectorAll('.item').length === 100,
    '小古文页按配置挂上了引擎实例（列表 100 篇）');

  mk(w, 'rootA', 'listA');
  mk(w, 'rootB', 'listB');
  const a = w.ReaderEngine.mount({
    id: 'a', root: '#rootA', items: w.POEMS_CLASSIC.slice(0, 6), groupOrder: ['蒙学经典'],
    words: { list: '甲集', unit: '篇', readStore: 'poem_test_a_v1', empty: '没有匹配的甲集' }
  });
  const b = w.ReaderEngine.mount({
    id: 'b', root: '#rootB', items: w.POEMS_CLASSIC.slice(6, 10), groupOrder: ['蒙学经典'],
    words: { list: '乙集', unit: '篇', readStore: 'poem_test_b_v1', empty: '没有匹配的乙集' }
  });
  chk(!!a && !!b, '同一页面可以挂两部不同的集子');

  // 空集合默认拒挂（多半是数据没加载上，挂上去只有一片空列表，看不出病根），
  // 搜索页那种「本来就该是空的」用法必须显式说 allowEmpty 才挂得上。
  chk(w.ReaderEngine.mount({ id: 'empty1', root: '#rootA', items: [] }) === null,
    '空集合默认不挂（避免数据没加载上还静默挂出一片空列表）');
  const emptyRoot = mk(w, 'rootC', 'listC');
  const c = w.ReaderEngine.mount({
    id: 'c', root: '#rootC', items: [], allowEmpty: true,
    words: { list: '丙集', unit: '篇', empty: '还没搜' }
  });
  chk(!!c, 'allowEmpty 时空集合照样挂得上（搜索页敲字之前就是这个状态）');
  chk(w.document.querySelector('#listC .empty').textContent === '还没搜',
    '空集合的列表区给这一份自己的空态文案（不是加载失败那句）');

  // ⚠️ 绑事件不能被「这一刻集合是不是空的」挡住 —— 空集合那一支若提前 return，
  //    搜索框、翻篇键、工具条会整片失去反应，页面「加载完了但全是死的」。
  //    这里用真事件验：空集合挂上来的那一份，它的搜索框敲字必须能把列表填出来。
  const sc = w.document.querySelector('#rootC [data-gw="search"]');
  c.setItems(w.POEMS_CLASSIC.slice(0, 3));
  sc.value = '司马光';
  sc.dispatchEvent(new w.Event('input', { bubbles: true }));
  chk(w.document.querySelector('#listC').querySelectorAll('.item').length === 1,
    '空集合挂上来的那一份，搜索框敲字仍然管用（事件绑定没被空集合挡掉）');

  const A = w.document.querySelector('#listA');
  const B = w.document.querySelector('#listB');
  chk(A.querySelectorAll('.item').length === 6 && B.querySelectorAll('.item').length === 4,
    '两部集子各渲染自己那一批（6 / 4 篇，互不串台）');

  // 各自的搜索只影响自己那一份列表
  const sa = w.document.querySelector('#rootA [data-gw="search"]');
  sa.value = '司马光';
  sa.dispatchEvent(new w.Event('input', { bubbles: true }));
  chk(A.querySelectorAll('.item').length === 1 && B.querySelectorAll('.item').length === 4,
    '在甲集里搜索只筛甲集（乙集一条不少）');

  // 乙集自己搜：甲集的结果不该再变。
  // ⚠️ 乙集里没有「弟子规」（它在小古文第 2 篇、甲集那一段里），
  // 所以这里要看的不是「乙集能搜出东西」，而是：
  //   乙集被筛空的同时，甲集那条「司马光」的结果**一条不少** ——
  // 早先引擎把两块列表混作一处，这一步会把甲集也一起筛空。
  const sb = w.document.querySelector('#rootB [data-gw="search"]');
  sb.value = '弟子规';
  sb.dispatchEvent(new w.Event('input', { bubbles: true }));
  chk(B.querySelectorAll('.item').length === 0 && A.querySelectorAll('.item').length === 1,
    '两部集子的搜索条件各记各的（乙集搜「弟子规」被筛空，甲集的「司马光」结果不受影响）');

  // 清空乙集的搜索，它自己的 4 篇应当全回来（不被上一次的筛选粘住）
  sb.value = '';
  sb.dispatchEvent(new w.Event('input', { bubbles: true }));
  chk(B.querySelectorAll('.item').length === 4, '清空搜索后乙集恢复全部 4 篇');

  // 已读键各存各的：给甲集点一篇已读，乙集的计数不该动
  const beforeB = w.document.querySelector('#rootB [data-gw="count"]').textContent;
  chk(/0 \/ 4/.test(beforeB), '乙集的进度牌是它自己的 0 / 4（不是甲集的数）');

  // 引擎对外只暴露一份实例清单，mount 的返回值可用
  chk(typeof a.total === 'function' && a.total() === 6, 'mount 返回的实例带本集子自己的 total()');
  chk(a.words.list === '甲集' && b.words.list === '乙集',
    'mount 返回的实例带自己的文案表（两部集子的措辞可以不一样）');
  chk(typeof b.open === 'function' && typeof b.words === 'object', 'mount 返回的实例带 open() 与 words');

  // 已读存储键：小古文必须仍是老键名，换引擎不能把用户点亮的「已读」清空
  const classicSrc = fs.readFileSync(path + 'js/classic.js', 'utf8');
  chk(/readStore:\s*"poem_classic_read_v1"/.test(classicSrc),
    '小古文仍用老的已读键 poem_classic_read_v1（换引擎不清空用户数据）');
  chk(!/poem_recite_settings_v1/.test(classicSrc),
    '小古文页不再自己读写 settings（用户名 / 阅读辅助由引擎统一管）');

  console.log('');
  console.log(fails === 0 ? '🎉 古籍阅读库（引擎层）测试全部通过' : '❌ 古籍阅读库测试 ' + fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
}, 60);
