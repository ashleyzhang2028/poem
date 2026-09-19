const { JSDOM } = require('jsdom');
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
chk(sandbox.SITE_BOOKS.length === 7 &&
  sandbox.SITE_BOOKS.map(b => b.page).join(',') ===
    '/,/classic/,/tangshi/,/songci/,/guwen/,/zhaoming/,/yuanqu/',
  '七部集子的索引页地址依次为 / · /classic/ · /tangshi/ · /songci/ · /guwen/ · /zhaoming/ · /yuanqu/');

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

const dom = new JSDOM(classicHtml, { runScripts: 'dangerously', url: 'https://local.test/classic/' });
const w = dom.window;

w.scrollTo = function () {};
scriptOrder.forEach(f => {
  const el = w.document.createElement('script');
  el.textContent = fs.readFileSync(path + f, 'utf8');
  w.document.body.appendChild(el);
});

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

  const sa = w.document.querySelector('#rootA [data-gw="search"]');
  sa.value = '司马光';
  sa.dispatchEvent(new w.Event('input', { bubbles: true }));
  chk(A.querySelectorAll('.item').length === 1 && B.querySelectorAll('.item').length === 4,
    '在甲集里搜索只筛甲集（乙集一条不少）');

  const sb = w.document.querySelector('#rootB [data-gw="search"]');
  sb.value = '弟子规';
  sb.dispatchEvent(new w.Event('input', { bubbles: true }));
  chk(B.querySelectorAll('.item').length === 0 && A.querySelectorAll('.item').length === 1,
    '两部集子的搜索条件各记各的（乙集搜「弟子规」被筛空，甲集的「司马光」结果不受影响）');

  sb.value = '';
  sb.dispatchEvent(new w.Event('input', { bubbles: true }));
  chk(B.querySelectorAll('.item').length === 4, '清空搜索后乙集恢复全部 4 篇');

  const beforeB = w.document.querySelector('#rootB [data-gw="count"]').textContent;
  chk(beforeB === '', '引擎不再往挂载点里那枚 [data-gw=count] 写数（页顶那一枚已撤）');

  b.open(w.POEMS_CLASSIC[6].id);
  const metaText = w.document.querySelector('#rd-meta').textContent;
  chk(metaText.length > 0 && !/\d\s*\/\s*\d+\s*(篇|首)/.test(metaText),
    '详情页状态栏里没有「N / M 篇」这类读数，只剩朝代 / 作者 / 出处（实际「' + metaText + '」）');
  chk(w.document.querySelectorAll('#rd-meta .rd-count').length === 0,
    '状态栏里连 .rd-count 这个节点都不再产生（不是「有节点但空着」）');

  chk(typeof a.total === 'function' && a.total() === 6, 'mount 返回的实例带本集子自己的 total()');
  chk(a.words.list === '甲集' && b.words.list === '乙集',
    'mount 返回的实例带自己的文案表（两部集子的措辞可以不一样）');
  chk(typeof b.open === 'function' && typeof b.words === 'object', 'mount 返回的实例带 open() 与 words');

  const classicSrc = fs.readFileSync(path + 'js/classic.js', 'utf8');
  chk(/readStore:\s*"poem_classic_read_v1"/.test(classicSrc),
    '小古文仍用老的已读键 poem_classic_read_v1（换引擎不清空用户数据）');
  chk(!/poem_recite_settings_v1/.test(classicSrc),
    '小古文页不再自己读写 settings（用户名 / 阅读辅助由引擎统一管）');

  console.log('');
  console.log(fails === 0 ? '🎉 古籍阅读库（引擎层）测试全部通过' : '❌ 古籍阅读库测试 ' + fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
}, 60);
