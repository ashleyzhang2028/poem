// 宋词三百首（/songci/ 页）端到端测试：数据完整性 + 作者/词牌颠倒校正 + 词牌分组 + 阅读器
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
['data/poems-classic.js', 'data/poems-songci.js', 'data/site-index.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path + f, 'utf8'), sandbox, { filename: f }));

const SC = sandbox.POEMS_SONGCI;
chk(Array.isArray(SC) && SC.length === 284,
  '宋词三百首共 284 首（实际 ' + (SC ? SC.length : 'undefined') + '）');

const ids = new Set();
let dup = 0;
SC.forEach(p => { if (ids.has(p.id)) dup++; ids.add(p.id); });
chk(dup === 0, '宋词 id 无重复（重复 ' + dup + ' 个）');

chk(SC.every(p => p.title && p.source && p.dynasty && p.author && p.text && p.translation),
  '每首都有 标题/出处/朝代/作者/原文/译文');
chk(SC.every(p => p.excerpt), '每首都给了列表用摘句（excerpt）');
chk(SC.every(p => p.translationSource === 'public-domain'),
  '284 首宋词都标了译文来源 public-domain（未标 ' + SC.filter(p => !p.translationSource).length + ' 首）');
chk(SC.every(p => p.source === '《宋词三百首》'), '出处统一为《宋词三百首》');
chk(SC.every(p => p.dynasty === '宋'), '朝代统一为宋');
chk(SC.some(p => p.text.length > 200), '含长篇（>200 字）宋词，验证长文场景');

// 词牌分组：gradeGroup 一律是「词牌 · XXX」
chk(SC.every(p => /^词牌 · /.test(p.gradeGroup || '')),
  '每首都归入某个词牌（gradeGroup 形如「词牌 · XXX」）');
const groups = sandbox.getSongciGroups();
const groupNames = groups.map(g => g.name);
chk(new Set(groupNames).size === groupNames.length, '词牌分组名不重复');
chk(groups.reduce((n, g) => n + g.items.length, 0) === 284, '各组篇目合计 284');
chk(groupNames.length >= 120 && groupNames.length <= 150,
  '按词牌聚合出 ' + groupNames.length + ' 组（同一词牌下的多首各自成条）');

// 挂载脚本里的词牌顺序表必须与实际分组**完全一致**：
// 少写一个词牌，那一组就会被引擎排到最后（而不是报错），是最容易漏的那种错
const ssrc = fs.readFileSync(path + 'js/songci.js', 'utf8');
const listed = JSON.parse('[' + ssrc.match(/var GROUP_ORDER = \[([\s\S]*?)\];/)[1].replace(/,\s*$/, '') + ']');
chk(listed.length === groupNames.length,
  '挂载脚本的词牌顺序表条目数与实际分组一致（表 ' + listed.length + ' · 实际 ' + groupNames.length + '）');
const notListed = groupNames.filter(g => listed.indexOf(g) < 0);
const notUsed = listed.filter(g => groupNames.indexOf(g) < 0);
chk(notListed.length === 0, '每个实际词牌都在顺序表里（缺：' + notListed.join('/') + '）');
chk(notUsed.length === 0, '顺序表里没有多余的词牌（多：' + notUsed.join('/') + '）');

// 作者 / 词牌颠倒的校正：原始清单里有一批写成「韩疁 宋 高阳台」这类，必须校正
// 判据：词牌不可能长得像人名（「宴山亭」「高阳台」这类词牌名本身要从词牌表里查），
// 这里抽查几条原始清单里颠倒过的条目
const byTitle = {};
SC.forEach(p => { (byTitle[p.title] = byTitle[p.title] || []).push(p); });
const fixedCases = [
  ['高阳台', '韩疁'], ['汉宫春', '李邴'], ['临江仙', '陈与义'], ['卜算子·咏梅', '陆游'],
  ['钗头凤', '陆游'], ['扬州慢', '姜夔'], ['暗香', '姜夔'], ['疏影', '姜夔'],
  ['声声慢', '李清照'], ['一剪梅', '李清照'], ['醉花阴', '李清照'],
  ['武陵春·风住尘香花已尽', '李清照']
];
const wrong = fixedCases.filter(([t, a]) => !(byTitle[t] || []).some(p => p.author === a));
chk(wrong.length === 0,
  '原始清单里「作者 / 词牌」颠倒的条目已按词牌校正（异常：'
  + wrong.map(x => x.join('/')).join('、') + '）');
// 反向：不能把「作者」当成词牌——词牌组里不该出现人名
const authors = new Set(SC.map(p => p.author));
const groupAsAuthor = groupNames.filter(g => authors.has(g.replace('词牌 · ', '')));
chk(groupAsAuthor.length === 0,
  '没有把作者误当词牌（异常：' + groupAsAuthor.join('/') + '）');

// 需求清单抽查：名家名篇必须在库中
const need = ['宴山亭·北行见杏花', '苏幕遮', '渔家傲', '雨霖铃', '水调歌头', '念奴娇·赤壁怀古',
  '江城子·乙卯正月二十日夜记梦', '踏莎行', '满庭芳·其一', '青玉案', '西河·金陵怀古',
  '卜算子·咏梅', '钗头凤', '摸鱼儿', '永遇乐·京口北固亭怀古', '扬州慢', '暗香', '疏影',
  '双双燕·咏燕', '莺啼序', '声声慢', '一剪梅', '醉花阴', '武陵春·风住尘香花已尽'];
const titles = SC.map(p => p.title);
const missing = need.filter(t => !titles.includes(t));
chk(missing.length === 0, '需求清单里的名篇齐备（缺 ' + missing.join('/') + '）');

// 同一作者同一词牌的多首：标「其一 / 其二 / 其三」区分，不能两条同名
const seen = {};
let sameName = 0;
SC.forEach(p => {
  const k = p.author + '|' + p.title;
  if (seen[k]) sameName++;
  seen[k] = 1;
});
chk(sameName === 0, '同一作者的篇名不重复（重名的已按目录次序标「其一 / 其二」区分，重复 ' + sameName + '）');

// 不能污染古诗词主库与每日计划
chk(sandbox.POEMS_ALL === undefined, '宋词不写入 POEMS_ALL，不影响每日计划');

// 站点总索引：宋词已并入，且带集子前缀不撞 id
const IDX = sandbox.SITE_INDEX;
chk(IDX.some(x => x.book === 'songci' && x.id === 'songci-sc-1'),
  '站点总索引已含宋词（带 songci- 前缀）');
chk(IDX.some(x => x.book === 'songci' && x.isBook && x.page === '/songci/'),
  '总索引里宋词集子自身指向 /songci/');
chk(IDX.every(x => x.id !== 'sc-1' || x.book), '宋词条目都带集子归属');

/* ---------- 二、页面层（jsdom） ---------- */
const html = fs.readFileSync(path + 'songci/index.html', 'utf8');
const scriptOrder = html.match(/<script src="([^"]+)"><\/script>/g).map(s => s.match(/src="([^"]+)"/)[1]);
chk(scriptOrder.indexOf('data/poems-songci.js') >= 0, '页面引用了宋词数据');
chk(scriptOrder.indexOf('js/reader-core.js') >= 0, '页面加载了 js/reader-core.js 引擎');
chk(scriptOrder.indexOf('js/reader-core.js') < scriptOrder.indexOf('js/songci.js'),
  '引擎排在挂载脚本 js/songci.js 之前');
chk(html.indexOf('data-nav="songci"') >= 0, '页面声明了 songci 页签');

const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://local.test/songci/', base: 'https://local.test/songci/' });
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
  ['songci/index.html', 'classic/index.html'].forEach(f => {
    const doc = new JSDOM(fs.readFileSync(path + f, 'utf8')).window.document;
    const seenIds = {};
    const dups = [];
    doc.querySelectorAll('[id]').forEach(el => {
      if (seenIds[el.id]) { if (dups.indexOf(el.id) < 0) dups.push(el.id); } else seenIds[el.id] = 1;
    });
    chk(dups.length === 0, f + ' 无重复 id（重复：' + dups.join(', ') + '）');
  });

  chk(d.querySelectorAll('#gw-list .item').length === 284,
    '列表渲染 284 首（实际 ' + d.querySelectorAll('#gw-list .item').length + '）');
  chk(d.querySelector('#gw-count').textContent === '0 / 284 首',
    '顶部显示 0 / 284 首：' + d.querySelector('#gw-count').textContent);
  // 分组卡：分组数与词牌数一致
  chk(d.querySelectorAll('#gw-list .group-card').length === groupNames.length,
    '按词牌渲染 ' + groupNames.length + ' 张分组卡');

  // 挂载点对外接口
  const api = w.ReaderEngine.current;
  chk(!!api, '引擎挂上了宋词实例');
  chk(api.total() === 284, '实例 total() 为 284');

  // 已读键：宋词与别的集子各存各的
  const ssrc2 = fs.readFileSync(path + 'js/songci.js', 'utf8');
  const scReadKey = (ssrc2.match(/readStore:\s*"([^"]+)"/) || [])[1];
  chk(scReadKey === 'poem_songci_read_v1',
    '宋词用独立的已读键 poem_songci_read_v1（实际 ' + scReadKey + '）');

  // 打开一首：标题 / 作者 / 正文写入阅读器
  api.open('sc-249');
  const title = d.querySelector('#rd-title').textContent;
  chk(title === '声声慢', '可打开指定篇目（sc-249 → ' + title + '）');
  chk(/李清照/.test(d.querySelector('#rd-meta').textContent), '阅读器展示了作者');
  const plain = d.querySelector('#rd-text').textContent
    .replace(/[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹ·]+/g, '').replace(/\s/g, '');
  chk(/寻寻觅觅/.test(plain), '正文已写入阅读器');
  chk(/冷冷清清/.test(d.querySelector('#rd-trans-text').textContent), '白话译文已写入阅读器');

  // 搜索：按作者筛，且只筛宋词这一部
  api.setKeyword('李清照');
  const nLi = d.querySelectorAll('#gw-list .item').length;
  chk(nLi > 0 && nLi < 284, '按作者「李清照」搜索得到子集（' + nLi + ' 首）');

  console.log('');
  console.log(fails === 0 ? '🎉 宋词三百首测试全部通过' : '❌ 宋词三百首测试 ' + fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
}, 120);
