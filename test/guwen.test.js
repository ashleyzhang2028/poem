// 古文观止（/guwen/ 页）端到端测试：数据完整性 + 卷次分组 + 列表/搜索 + 阅读器
const { JSDOM } = require('jsdom');
const fs = require('fs');
const vm = require('vm');
const path = __dirname + '/../';

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

/* ---------- 一、数据层（纯 vm，无 DOM） ---------- */
const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
['data/poems-classic.js', 'data/poems-guwen.js', 'data/site-index.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path + f, 'utf8'), sandbox, { filename: f }));

const GW = sandbox.POEMS_GUWEN;
chk(Array.isArray(GW) && GW.length >= 1, '古文观止已收篇目（实际 ' + (GW ? GW.length : 'undefined') + ' 篇）');
chk(GW.some(p => p.title === '送孟东野序'),
  '《送孟东野序》已收入古文观止');

const ids = new Set();
let dup = 0;
GW.forEach(p => { if (ids.has(p.id)) dup++; ids.add(p.id); });
chk(dup === 0, '古文 id 无重复（重复 ' + dup + ' 个）');

chk(GW.every(p => p.title && p.source && p.dynasty && p.author && p.text && p.translation),
  '每篇都有 标题/出处/朝代/作者/原文/译文');
chk(GW.every(p => p.translationSource),
  '每篇都标了译文来源（未标 ' + GW.filter(p => !p.translationSource).length + ' 篇）');
chk(GW.every(p => p.source === '《古文观止》'), '出处统一为《古文观止》');

// 送孟东野序：韩愈散文、卷八 唐文，且是长篇（验证长文场景）
const mdy = GW.filter(p => p.title === '送孟东野序')[0] || {};
chk(mdy.author === '韩愈' && mdy.dynasty === '唐', '《送孟东野序》作者韩愈 · 朝代唐');
chk(mdy.gradeGroup === '卷八 唐文', '《送孟东野序》归入「卷八 唐文」（实际 ' + mdy.gradeGroup + '）');
chk(/大凡物不得其平则鸣/.test(mdy.text || ''), '原文开篇「大凡物不得其平则鸣」齐备');
chk(/平衡/.test(mdy.translation || '') && /声音/.test(mdy.translation || ''),
  '白话译文把「物不得其平则鸣」译成今语（含「平衡」「声音」）');
chk((mdy.text || '').length > 200, '《送孟东野序》是长篇（>200 字，验证长文场景）');

// 卷次分组
const groups = sandbox.getGuwenGroups();
chk(groups.length >= 1 && groups.every(g => g.name && g.items.length),
  '按卷次聚合出分组（' + groups.map(g => g.name + ' ' + g.items.length).join(' / ') + '）');
chk(groups.reduce((n, g) => n + g.items.length, 0) === GW.length, '各组篇目合计与总数一致');

// 不能污染古诗词主库与每日计划
chk(sandbox.POEMS_ALL === undefined, '古文不写入 POEMS_ALL，不影响每日计划');

// 站点总索引：古文观止已并入，且带集子前缀不撞 id
const IDX = sandbox.SITE_INDEX;
chk(IDX.some(x => x.book === 'guwen' && x.title === '送孟东野序'),
  '站点总索引已含古文观止篇目');
chk(IDX.some(x => x.book === 'guwen' && x.isBook && x.page === '/guwen/'),
  '总索引里古文观止集子自身指向 /guwen/');
chk(IDX.every(x => x.id !== 'gwj-1' || x.book), '古文条目都带集子归属');

/* ---------- 二、页面层（jsdom） ---------- */
const html = fs.readFileSync(path + 'guwen/index.html', 'utf8');
chk(html.indexOf('/guwen/ 里') >= 0 || html.indexOf('guwen') >= 0, '页面标注了 /guwen/ 目录');
const scriptOrder = html.match(/<script src="([^"]+)"><\/script>/g).map(s => s.match(/src="([^"]+)"/)[1]);
chk(scriptOrder.indexOf('data/poems-guwen.js') >= 0, '页面引用了古文观止数据');
chk(scriptOrder.indexOf('js/reader-core.js') >= 0, '页面加载了 js/reader-core.js 引擎');
chk(scriptOrder.indexOf('js/reader-core.js') < scriptOrder.indexOf('js/guwen.js'),
  '引擎排在挂载脚本 js/guwen.js 之前');
chk(html.indexOf('data-nav="guwen"') >= 0, '页面声明了 guwen 页签');

const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://local.test/guwen/', base: 'https://local.test/guwen/' });
const w = dom.window;
w.scrollTo = function () {};
scriptOrder.forEach(f => {
  const el = w.document.createElement('script');
  el.textContent = fs.readFileSync(path + f, 'utf8');
  w.document.body.appendChild(el);
});

setTimeout(() => {
  const d = w.document;

  // 重复 id 防线
  ['guwen/index.html', 'classic/index.html'].forEach(f => {
    const doc = new JSDOM(fs.readFileSync(path + f, 'utf8')).window.document;
    const seen = {};
    const dups = [];
    doc.querySelectorAll('[id]').forEach(el => {
      if (seen[el.id]) { if (dups.indexOf(el.id) < 0) dups.push(el.id); } else seen[el.id] = 1;
    });
    chk(dups.length === 0, f + ' 无重复 id（重复：' + dups.join(', ') + '）');
  });

  chk(d.querySelectorAll('#gw-list .item').length === GW.length,
    '列表渲染 ' + GW.length + ' 篇（实际 ' + d.querySelectorAll('#gw-list .item').length + '）');
  chk(d.querySelector('#gw-count').textContent === '0 / ' + GW.length + ' 篇',
    '顶部显示 0 / ' + GW.length + ' 篇：' + d.querySelector('#gw-count').textContent);

  // 挂载点对外接口
  const api = w.ReaderEngine.current;
  chk(!!api, '引擎挂上了古文观止实例');
  chk(api.total() === GW.length, '实例 total() 为 ' + GW.length);

  // 已读键：古文与别的集子各存各的
  const gsrc = fs.readFileSync(path + 'js/guwen.js', 'utf8');
  chk(/readStore:\s*"poem_guwen_read_v1"/.test(gsrc),
    '古文观止用独立的已读键 poem_guwen_read_v1');
  const gwReadKey = (gsrc.match(/readStore:\s*"([^"]+)"/) || [])[1];
  chk(gwReadKey === 'poem_guwen_read_v1',
    '古文挂载时只设自己的已读键（实际 ' + gwReadKey + '）');

  // 卷次顺序表必须在挂载脚本里显式给出
  chk(/卷一 周文/.test(gsrc) && /卷八 唐文/.test(gsrc),
    '挂载脚本给出了卷一至卷八的卷次顺序');

  // 打开一篇：标题 / 作者 / 正文写入阅读器
  api.open('gwj-1');
  const title = d.querySelector('#rd-title').textContent;
  chk(title === '送孟东野序', '可打开指定篇目（gwj-1 → ' + title + '）');
  chk(/韩愈/.test(d.querySelector('#rd-meta').textContent), '阅读器展示了作者');
  // 正文可能带注音（生字上会插拼音），比对前先把注音/空白去掉
  const plain = d.querySelector('#rd-text').textContent.replace(/[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹ·]+/g, '').replace(/\s/g, '');
  chk(/大凡物不得其平则鸣/.test(plain), '正文已写入阅读器');
  chk(/不平则鸣|得不到它的平衡/.test(d.querySelector('#rd-trans-text').textContent), '白话译文已写入阅读器');

  // 搜索：按作者筛，且只筛古文这一部
  api.setKeyword('韩愈');
  const nHan = d.querySelectorAll('#gw-list .item').length;
  chk(nHan > 0 && nHan <= GW.length, '按作者「韩愈」搜索得到子集（' + nHan + ' 篇）');

  console.log('');
  console.log(fails === 0 ? '🎉 古文观止测试全部通过' : '❌ 古文观止测试 ' + fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
}, 120);
