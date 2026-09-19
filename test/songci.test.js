const { JSDOM } = require('jsdom');
const fs = require('fs');
const vm = require('vm');
const path = __dirname + '/../';

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);

const { loadData, resolve } = require('./master-env');
loadData(sandbox, ['data/poems-classic.js', 'data/poems-songci.js', 'data/site-index.js']);

const SC = resolve(sandbox, sandbox.POEMS_SONGCI, 'songci');
chk(Array.isArray(SC) && SC.length === 285,
  '宋词三百首 283 首 + 校外补充 2 首 = 285（实际 ' + (SC ? SC.length : 'undefined') + '）');

const ids = new Set();
let dup = 0;
SC.forEach(p => { if (ids.has(p.id)) dup++; ids.add(p.id); });
chk(dup === 0, '宋词 id 无重复（重复 ' + dup + ' 个）');

chk(SC.every(p => p.title && p.source && p.dynasty && p.author && p.text && p.translation),
  '每首都有 标题/出处/朝代/作者/原文/译文');
chk(SC.every(p => p.excerpt), '每首都给了列表用摘句（excerpt）');

const SC_SRC_OK = ['public-domain', 'school', 'academic', 'modern'];
chk(SC.every(p => SC_SRC_OK.indexOf(p.translationSource) >= 0),
  '285 首宋词都标了译文来源且取值在允许范围（异常 ' +
  SC.filter(p => SC_SRC_OK.indexOf(p.translationSource) < 0).length + ' 首）');
chk(SC.filter(p => p.translationSource === 'public-domain').length >= 250,
  '绝大多数标 public-domain（与课内同篇的数首取课本口径，标 school）');
chk(SC.every(p => p.source === '《宋词三百首》'), '出处统一为《宋词三百首》');
chk(SC.every(p => p.dynasty === '宋'), '朝代统一为宋');
chk(SC.some(p => p.text.length > 200), '含长篇（>200 字）宋词，验证长文场景');

chk(SC.every(p => /^词牌 · /.test(p.gradeGroup || '')),
  '每首都归入某个词牌（gradeGroup 形如「词牌 · XXX」）');
const groups = sandbox.getSongciGroups();
const groupNames = groups.map(g => g.name);
chk(new Set(groupNames).size === groupNames.length, '词牌分组名不重复');
chk(groups.reduce((n, g) => n + g.items.length, 0) === 285, '各组篇目合计 285');
chk(groupNames.length >= 120 && groupNames.length <= 150,
  '按词牌聚合出 ' + groupNames.length + ' 组（同一词牌下的多首各自成条）');

const ssrc = fs.readFileSync(path + 'js/songci.js', 'utf8');
const listed = JSON.parse('[' + ssrc.match(/var GROUP_ORDER = (?:window\.SONGCI_GROUP_ORDER = )?\[([\s\S]*?)\];/)[1].replace(/,\s*$/, '') + ']');
chk(listed.length === groupNames.length,
  '挂载脚本的词牌顺序表条目数与实际分组一致（表 ' + listed.length + ' · 实际 ' + groupNames.length + '）');
const notListed = groupNames.filter(g => listed.indexOf(g) < 0);
const notUsed = listed.filter(g => groupNames.indexOf(g) < 0);
chk(notListed.length === 0, '每个实际词牌都在顺序表里（缺：' + notListed.join('/') + '）');
chk(notUsed.length === 0, '顺序表里没有多余的词牌（多：' + notUsed.join('/') + '）');

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

const authors = new Set(SC.map(p => p.author));
const groupAsAuthor = groupNames.filter(g => authors.has(g.replace('词牌 · ', '')));
chk(groupAsAuthor.length === 0,
  '没有把作者误当词牌（异常：' + groupAsAuthor.join('/') + '）');

const need = ['宴山亭·北行见杏花', '苏幕遮', '渔家傲', '雨霖铃', '水调歌头', '念奴娇·赤壁怀古',
  '江城子·乙卯正月二十日夜记梦', '踏莎行', '青玉案', '西河·金陵怀古',
  '卜算子·咏梅', '钗头凤', '摸鱼儿', '永遇乐·京口北固亭怀古', '扬州慢', '暗香', '疏影',
  '双双燕·咏燕', '莺啼序', '声声慢', '一剪梅', '醉花阴', '武陵春·风住尘香花已尽'];
const titles = SC.map(p => p.title);
const missing = need.filter(t => !titles.includes(t));
chk(missing.length === 0, '需求清单里的名篇齐备（缺 ' + missing.join('/') + '）');

const seen = {};
let sameName = 0;
SC.forEach(p => {
  const k = p.author + '|' + p.title;
  if (seen[k]) sameName++;
  seen[k] = 1;
});
chk(sameName === 0, '同一作者的篇名不重复（重名的以首句副题区分，重复 ' + sameName + '）');

const SEQ_FIXED = [
  ['sc-13', '浣溪沙·一曲新词酒一杯'], ['sc-14', '浣溪沙·一向年光有限身'],
  ['sc-15', '清平乐·红笺小字'], ['sc-16', '清平乐·金风细细'],
  ['sc-17', '木兰花·燕鸿过后莺归去'], ['sc-18', '木兰花·绿杨芳草长亭路'],
  ['sc-19', '木兰花·池塘水绿风微暖'],
  ['sc-20', '踏莎行·碧海无波'], ['sc-21', '踏莎行·小径红稀'],
  ['sc-28', '蝶恋花·庭院深深深几许？杨柳堆烟'], ['sc-29', '蝶恋花·谁道闲情抛弃久？每到春来'],
  ['sc-30', '蝶恋花·帘幕风轻双语燕'],
  ['sc-51', '蝶恋花·醉别西楼醒不记'], ['sc-52', '蝶恋花·梦入江南烟水路'],
  ['sc-55', '木兰花·秋千院落重帘暮'], ['sc-56', '木兰花·小颦若解愁春暮'],
  ['sc-58', '阮郎归·天边金掌露成霜'], ['sc-59', '阮郎归·旧香残粉似当初'],
  ['sc-87', '满庭芳·山抹微云'], ['sc-88', '满庭芳·碧水惊秋'],
];
const byId = {};
SC.forEach(p => { byId[p.id] = p; });

function firstClause(head, base) {
  var cut = -1;
  for (var i = 0; i < head.length; i++) {
    var ch = head[i];
    if (ch !== '，' && ch !== '、') continue;
    var seg = head.slice(0, i);
    if (seg === base || /[？?]$/.test(seg)) continue;
    cut = i;
    break;
  }
  return cut >= 0 ? head.slice(0, cut) : head;
}
let seqBad = [];
SEQ_FIXED.forEach(([id, want]) => {
  const p = byId[id];
  if (!p) { seqBad.push(id + '(缺)'); return; }
  if (p.title !== want) seqBad.push(id + ' 应为「' + want + '」，实际「' + p.title + '」');
});
chk(seqBad.length === 0,
  '20 条原「其一 / 其二 / 其三」已改为首句副题（异常：' + seqBad.join('；') + '）');

const SEQ_RE = /[（(·]其[一二三四五六七八九十]+[）)·]?$/;
const leftover = SC.filter(p => SEQ_RE.test(p.title));
chk(leftover.length === 0,
  '《宋词三百首》里没有残留的自拟「其N」编号（残留 ' +
  leftover.map(p => p.title).join('、') + '）');

let subBad = [];
SEQ_FIXED.forEach(([id]) => {
  const p = byId[id];
  if (!p) return;
  const i = p.title.indexOf('·');
  const base = p.title.slice(0, i);
  const sub = p.title.slice(i + 1);
  if (base !== p.gradeGroup.replace(/^词牌 · /, '')) { subBad.push(p.title + '(词牌与分组不一致)'); return; }
  const want = firstClause(String(p.text || '').split('\n')[0], base);
  if (sub !== want) subBad.push(p.title + ' 副题应为「' + want + '」');
});
chk(subBad.length === 0,
  '这 20 条的副题都等于本篇正文首句（异常 ' + subBad.length + ' 条：' + subBad.slice(0, 3).join('；') + '）');

chk(sandbox.POEMS_ALL === undefined, '宋词不写入 POEMS_ALL，不影响每日计划');

const IDX = sandbox.SITE_INDEX;
chk(IDX.some(x => x.book === 'songci' && x.id === 'songci-sc-1'),
  '站点总索引已含宋词（带 songci- 前缀）');
chk(IDX.some(x => x.book === 'songci' && x.isBook && x.page === '/songci/'),
  '总索引里宋词集子自身指向 /songci/');
chk(IDX.every(x => x.id !== 'sc-1' || x.book), '宋词条目都带集子归属');

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

  ['songci/index.html', 'classic/index.html'].forEach(f => {
    const doc = new JSDOM(fs.readFileSync(path + f, 'utf8')).window.document;
    const seenIds = {};
    const dups = [];
    doc.querySelectorAll('[id]').forEach(el => {
      if (seenIds[el.id]) { if (dups.indexOf(el.id) < 0) dups.push(el.id); } else seenIds[el.id] = 1;
    });
    chk(dups.length === 0, f + ' 无重复 id（重复：' + dups.join(', ') + '）');
  });

  chk(d.querySelectorAll('#gw-list .item').length === 285,
    '列表渲染 285 首（实际 ' + d.querySelectorAll('#gw-list .item').length + '）');
  chk(d.querySelector('#gw-count') === null,
    '页顶那一行不再挂已读进度牌（Issue #147：读数已撤，页顶与详情页都没有）');

  chk(d.querySelectorAll('#gw-list .group-card').length === groupNames.length,
    '按词牌渲染 ' + groupNames.length + ' 张分组卡');

  const api = w.ReaderEngine.current;
  chk(!!api, '引擎挂上了宋词实例');
  chk(api.total() === 285, '实例 total() 为 285');

  const ssrc2 = fs.readFileSync(path + 'js/songci.js', 'utf8');
  const scReadKey = (ssrc2.match(/readStore:\s*"([^"]+)"/) || [])[1];
  chk(scReadKey === 'poem_songci_read_v1',
    '宋词用独立的已读键 poem_songci_read_v1（实际 ' + scReadKey + '）');

  api.open('sc-249');
  const title = d.querySelector('#rd-title').textContent;
  chk(title === '声声慢', '可打开指定篇目（sc-249 → ' + title + '）');
  chk(/李清照/.test(d.querySelector('#rd-meta').textContent), '阅读器展示了作者');

  chk(d.querySelectorAll('#rd-meta .rd-count').length === 0,
    '详情页状态栏里不再有已读读数 .rd-count（实际 ' +
    d.querySelectorAll('#rd-meta .rd-count').length + ' 枚）');
  chk(!/\d\s*\/\s*\d+\s*(篇|首)/.test(d.querySelector('#rd-meta').textContent),
    '状态栏整行不含「0 / 283 首」这类读数（实际「' +
    d.querySelector('#rd-meta').textContent + '」）');
  chk(/李清照/.test(d.querySelector('#rd-meta').textContent),
    '状态栏里的朝代 / 作者 / 出处照旧在');
  const plain = d.querySelector('#rd-text').textContent
    .replace(/[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹ·]+/g, '').replace(/\s/g, '');
  chk(/寻寻觅觅/.test(plain), '正文已写入阅读器');
  chk(/冷冷清清/.test(d.querySelector('#rd-trans-text').textContent), '白话译文已写入阅读器');

  api.setKeyword('李清照');
  const nLi = d.querySelectorAll('#gw-list .item').length;
  chk(nLi > 0 && nLi < 283, '按作者「李清照」搜索得到子集（' + nLi + ' 首）');

  console.log('');
  console.log(fails === 0 ? '🎉 宋词三百首测试全部通过' : '❌ 宋词三百首测试 ' + fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
}, 120);
