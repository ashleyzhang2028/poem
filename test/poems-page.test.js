const { JSDOM } = require('jsdom');
const fs = require('fs');
const vm = require('vm');
const path = __dirname + '/../';

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const { loadData, resolve } = require('./master-env');

const libSrc = fs.readFileSync(path + 'js/library.js', 'utf8');
const libEntries = (function () {
  const sandbox = { window: {}, document: {
    readyState: 'complete',
    addEventListener: function () {},
    getElementById: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  } };
  sandbox.window = sandbox;
  sandbox.window.document = sandbox.document;
  sandbox.window.SITE_INDEX = [];
  vm.createContext(sandbox);
  vm.runInContext(libSrc, sandbox, { filename: 'js/library.js' });
  return sandbox.LibraryPage.entries();
})();
chk(libEntries.length === 9, '入口页是九张卡（课内 + 八部集子；实际 ' + libEntries.length + '）');
const courseCard = libEntries.filter(function (e) { return e.id === 'poems'; })[0];
chk(!!courseCard, '入口页第一张卡是课内诗词');
chk(courseCard.page === '/poems/', '课内诗词那张卡指向索引页 /poems/（实际 ' + courseCard.page + '）');
chk(courseCard.page !== '/', '课内诗词那张卡不再指回背诵首页');
chk(libEntries.every(function (e) { return /^\/[a-z]+\/$/.test(e.page); }),
  '九张卡的去处都是目录化索引页：' + libEntries.map(function (e) { return e.page; }).join(' '));

const html = fs.readFileSync(path + 'poems/index.html', 'utf8');
const order = html.match(/<script src="([^"]+)"><\/script>/g).map(function (s) { return s.match(/src="([^"]+)"/)[1]; });
chk(order.indexOf('js/reader-core.js') >= 0, '/poems/ 加载了共用引擎 js/reader-core.js');
chk(order.indexOf('js/reader-core.js') < order.indexOf('js/poems.js'),
  '引擎排在挂载脚本 js/poems.js 之前');
chk(order.indexOf('data/index.js') < order.indexOf('js/poems.js'),
  'data/index.js（汇成 POEMS_ALL）排在挂载脚本之前');
chk(order.indexOf('data/text-master.js') < order.indexOf('data/index.js'),
  '正文主表排在 data/index.js 之前（POEMS_ALL 汇总时要按 textRef 取回正文）');
chk(order.indexOf('js/collections.js') >= 0, '/poems/ 也加载了自选集合模块（详情页那枚键要用）');
chk(/data-nav="poems"/.test(html), 'body 上标了 data-nav="poems"');
chk(/<base href="\/" \/>/.test(html), '/poems/ 带了 <base href="/">（目录化 URL 下相对资源才解析得对）');
chk(/data-page="课内古诗词"/.test(html), '页面名写作「课内古诗词」（与六部集子的命名口径一致）');

{
  const doc = new JSDOM(html).window.document;
  const seen = {};
  const dups = [];
  doc.querySelectorAll('[id]').forEach(function (el) {
    if (seen[el.id]) { if (dups.indexOf(el.id) < 0) dups.push(el.id); } else { seen[el.id] = 1; }
  });
  chk(dups.length === 0, '/poems/index.html 无重复 id（重复：' + dups.join(', ') + '）');
}

const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
loadData(sandbox, [
  'data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js',
  'data/poems-5.js', 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js',
  'data/poems-9.js', 'data/poems-10.js', 'data/poems-11.js', 'data/poems-12.js',
  'data/index.js'
]);
const ALL = sandbox.POEMS_ALL;
chk(ALL && ALL.length === 261, '课内一共 261 首（实际 ' + (ALL ? ALL.length : 'undefined') + '）');
chk(resolve(sandbox, ALL, 'poems').every(function (p) { return p.text && p.translation; }),
  '261 首按 textRef 取回后都带正文与译文（不是空壳）');

const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://local.test/poems/', base: 'https://local.test/poems/' });
const w = dom.window;
w.scrollTo = function () {};
order.forEach(function (f) {
  const el = w.document.createElement('script');
  el.textContent = fs.readFileSync(path + f, 'utf8');
  w.document.body.appendChild(el);
});

setTimeout(function () {
  const d = w.document;

  chk(d.querySelectorAll('#gw-list .item').length === 261,
    '列表渲染 261 首（实际 ' + d.querySelectorAll('#gw-list .item').length + '）');
  chk(d.querySelector('#gw-count') === null,
    '页顶那一行不再挂已读进度牌（Issue #147：读数已撤，页顶与详情页都没有）');

  const groups = [].slice.call(d.querySelectorAll('#gw-list .group-name')).map(function (x) { return x.textContent; });
  chk(groups.length === 24, '按教材册次分 24 组（实际 ' + groups.length + '）');
  const WANT_GROUPS = ['一年级上', '一年级下', '二年级上', '二年级下', '三年级上', '三年级下',
    '四年级上', '四年级下', '五年级上', '五年级下', '六年级上', '六年级下',
    '七年级上', '七年级下', '八年级上', '八年级下', '九年级上', '九年级下',
    '高一上', '高一下', '高二上', '高二下', '高三上', '高三下'];
  chk(groups.join(',') === WANT_GROUPS.join(','),
    '册次顺序是一年级上 → …… → 高三下（实际 ' + groups.slice(0, 3).join('/') + ' … ' + groups.slice(-1)[0] + '）');

  const bad = [];
  [].slice.call(d.querySelectorAll('#gw-list .group-card')).forEach(function (card) {
    const name = card.querySelector('.group-name').textContent;
    const headN = parseInt(card.querySelector('.group-count').textContent, 10);
    const realN = card.querySelectorAll('.item').length;

    if (headN !== realN) bad.push(name + '（组头 ' + headN + ' / 组内 ' + realN + '）');
  });
  chk(bad.length === 0, '每组组头的篇数与组内条目数一致（不一致：' + (bad.join('、') || '无') + '）');
  const sumItems = [].slice.call(d.querySelectorAll('#gw-list .group-card')).reduce(function (n, c) {
    return n + c.querySelectorAll('.item').length;
  }, 0);
  chk(sumItems === 261, '各组条目数合计 261（实际 ' + sumItems + '）');

  chk(d.querySelectorAll('#gw-list .item-recite').length === 0,
    '列表上不挂「加入背诵」圆键（课内 261 首本来就在每日任务里）');
  chk(/reciteList:\s*false/.test(fs.readFileSync(path + 'js/poems.js', 'utf8')),
    '挂载脚本里显式写了 reciteList: false');

  chk(!!d.querySelector('#gw-reader [data-gw="recite"]'),
    '详情页工具条上的「加入背诵」仍在（只是列表上不挂）');

  const api = w.ReaderEngine.current;
  chk(!!api && api.total() === 261, '引擎挂上了课内实例，total() = 261');
  api.open('xx1-01');
  chk(d.querySelector('#rd-title').textContent === '咏鹅',
    '可打开指定篇目（xx1-01 → ' + d.querySelector('#rd-title').textContent + '）');
  const meta = d.querySelector('#rd-meta').textContent;
  chk(meta.indexOf('唐') >= 0 && meta.indexOf('骆宾王') >= 0,
    '详情页展示朝代与作者（实际「' + meta + '」）');

  const body = d.querySelector('#rd-text').textContent.replace(/[a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹ\s]/g, '');
  chk(body.indexOf('曲项向天歌') >= 0, '正文已写入阅读器（实际「' + body.slice(0, 12) + '…」）');
  chk(/弯着脖子/.test(d.querySelector('#rd-trans-text').textContent), '白话译文已写入阅读器');

  chk(d.querySelector('#gw-progress') === null,
    '详情页顶栏不再挂篇号牌（页面里已无该节点）');
  chk(d.querySelectorAll('#rd-meta .rd-count').length === 0,
    '详情页状态栏里也不再有已读读数 .rd-count');
  chk(!/\d\s*\/\s*\d+\s*(篇|首)/.test(d.querySelector('#rd-meta').textContent),
    '详情页状态栏整行不含「0 / 261 首」这类读数（实际「' +
    d.querySelector('#rd-meta').textContent + '」）');

  api.open('xx1-06');
  chk(d.querySelector('#rd-title').textContent === '风',
    '可打开一年级上第 6 首（xx1-06 → ' + d.querySelector('#rd-title').textContent + '）');

  api.setKeyword('李白');
  const nLi = d.querySelectorAll('#gw-list .item').length;
  chk(nLi > 0 && nLi < 261, '按作者「李白」能筛出子集（' + nLi + ' 首）');
  api.setKeyword('');

  const poSrc = fs.readFileSync(path + 'js/poems.js', 'utf8');
  chk(/readStore:\s*"poem_poems_read_v1"/.test(poSrc),
    '课内索引页用独立的已读键 poem_poems_read_v1');

  const poCode = poSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  chk(poCode.indexOf('poem_recite_progress_v1') === -1,
    '挂载脚本的代码里不碰首页的背诵进度键 poem_recite_progress_v1（只在注释里说明二者之别）');

  chk(/readStore:\s*"poem_poems_read_v1"/.test(poCode) &&
      /reciteList:\s*false/.test(poCode) &&
      poCode.indexOf('poem_recite_progress_v1') === -1,
    '「已读 ≠ 背诵进度」由行为钉住：独立已读键 + 列表不挂背诵圆键 + 不碰首页进度键');

  chk(w.sessionStorage.length === 0,
    '这一页不排今日任务、不写计划缓存（sessionStorage 空）');
  chk(w.localStorage.getItem('poem_recite_progress_v1') === null,
    '这一页一个字节都没写背诵进度（那是首页的事）');

  const active = d.querySelector('.dock-item.active');
  chk(active && active.dataset.navGo === 'library',
    '/poems/ 上页签停在「课外」这一格（用户是从那一页点进来的；实际 ' + (active ? active.dataset.navGo : '无') + '）');
  const chrome = fs.readFileSync(path + 'js/chrome.js', 'utf8');
  chk(/if \(key === "poems"\) return "library";/.test(chrome),
    'js/chrome.js 里 /poems/ 归到「课外」这一格');
  chk(/if \(key === "progress"\) return "home";/.test(chrome),
    '进度页仍归「背诵」那一格（这一条没被这次的改动带偏）');
  chk(/poems: "\/poems\/"/.test(chrome), '路由表里有 poems: /poems/');
  chk(chrome.indexOf('home: "/"') >= 0 && /DOCK_ITEMS[\s\S]{0,200}key: "home", href: "\/"/.test(chrome),
    '首页仍是 /，页签第一条仍是「背诵」指向它');

  const sw = fs.readFileSync(path + 'sw.js', 'utf8');
  chk(/\.\/poems\//.test(sw) && /js\/poems\.js/.test(sw),
    '/poems/ 与 js/poems.js 进了 Service Worker 预缓存清单（断网也能打开）');

  const homeSrc = fs.readFileSync(path + 'index.html', 'utf8');
  chk(/data-nav="home"/.test(homeSrc) && /id="today-list"/.test(homeSrc),
    '首页仍是「今日背诵」（today-list 还在）');
  const appSrc = fs.readFileSync(path + 'js/app.js', 'utf8');
  chk(/Scheduler/.test(appSrc) && /poem_recite_progress_v1|Storage\.get/.test(appSrc),
    '首页的遗忘曲线排程一个字没动');

  console.log('');
  console.log(fails === 0 ? '🎉 课内诗词索引页测试全部通过' : '❌ 课内诗词索引页测试 ' + fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
}, 200);
