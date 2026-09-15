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
// 正文存储主表：被主表收编的条目只存归属（textRef），正文要按它取回
const { loadData, resolve } = require('./master-env');
loadData(sandbox, ['data/poems-classic.js', 'data/poems-songci.js', 'data/site-index.js']);

const SC = resolve(sandbox, sandbox.POEMS_SONGCI, 'songci');
chk(Array.isArray(SC) && SC.length === 283,
  '宋词三百首共 283 首（近重复合并掉 1 条自拟编号的重复条目）（实际 ' + (SC ? SC.length : 'undefined') + '）');

const ids = new Set();
let dup = 0;
SC.forEach(p => { if (ids.has(p.id)) dup++; ids.add(p.id); });
chk(dup === 0, '宋词 id 无重复（重复 ' + dup + ' 个）');

chk(SC.every(p => p.title && p.source && p.dynasty && p.author && p.text && p.translation),
  '每首都有 标题/出处/朝代/作者/原文/译文');
chk(SC.every(p => p.excerpt), '每首都给了列表用摘句（excerpt）');
// 译文来源：宋词原文属公有领域，据通行译注整理 → public-domain。
// ⚠️ 例外：与课内同篇的那几条，正文收归主表后译文取自课本口径，来源是 school。
const SC_SRC_OK = ['public-domain', 'school', 'academic', 'modern'];
chk(SC.every(p => SC_SRC_OK.indexOf(p.translationSource) >= 0),
  '283 首宋词都标了译文来源且取值在允许范围（异常 ' +
  SC.filter(p => SC_SRC_OK.indexOf(p.translationSource) < 0).length + ' 首）');
chk(SC.filter(p => p.translationSource === 'public-domain').length >= 250,
  '绝大多数标 public-domain（与课内同篇的数首取课本口径，标 school）');
chk(SC.every(p => p.source === '《宋词三百首》'), '出处统一为《宋词三百首》');
chk(SC.every(p => p.dynasty === '宋'), '朝代统一为宋');
chk(SC.some(p => p.text.length > 200), '含长篇（>200 字）宋词，验证长文场景');

// 词牌分组：gradeGroup 一律是「词牌 · XXX」
chk(SC.every(p => /^词牌 · /.test(p.gradeGroup || '')),
  '每首都归入某个词牌（gradeGroup 形如「词牌 · XXX」）');
const groups = sandbox.getSongciGroups();
const groupNames = groups.map(g => g.name);
chk(new Set(groupNames).size === groupNames.length, '词牌分组名不重复');
chk(groups.reduce((n, g) => n + g.items.length, 0) === 283, '各组篇目合计 283');
chk(groupNames.length >= 120 && groupNames.length <= 150,
  '按词牌聚合出 ' + groupNames.length + ' 组（同一词牌下的多首各自成条）');

// 挂载脚本里的词牌顺序表必须与实际分组**完全一致**：
// 少写一个词牌，那一组就会被引擎排到最后（而不是报错），是最容易漏的那种错
const ssrc = fs.readFileSync(path + 'js/songci.js', 'utf8');
const listed = JSON.parse('[' + ssrc.match(/var GROUP_ORDER = (?:window\.SONGCI_GROUP_ORDER = )?\[([\s\S]*?)\];/)[1].replace(/,\s*$/, '') + ']');
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
  '江城子·乙卯正月二十日夜记梦', '踏莎行', '青玉案', '西河·金陵怀古',
  '卜算子·咏梅', '钗头凤', '摸鱼儿', '永遇乐·京口北固亭怀古', '扬州慢', '暗香', '疏影',
  '双双燕·咏燕', '莺啼序', '声声慢', '一剪梅', '醉花阴', '武陵春·风住尘香花已尽'];
const titles = SC.map(p => p.title);
const missing = need.filter(t => !titles.includes(t));
chk(missing.length === 0, '需求清单里的名篇齐备（缺 ' + missing.join('/') + '）');

// 同一作者同一词牌的多首：副题取首句区分，不能两条同名
const seen = {};
let sameName = 0;
SC.forEach(p => {
  const k = p.author + '|' + p.title;
  if (seen[k]) sameName++;
  seen[k] = 1;
});
chk(sameName === 0, '同一作者的篇名不重复（重名的以首句副题区分，重复 ' + sameName + '）');

/* ---------- 一b、「其一 / 其二 / 其三」自拟编号已全部撤销 ---------- */
/**
 * 需求原话（Issue #69 · 本 PR）：
 *   「宋词那批『其一 / 其二 / 其三』编号是我上轮为分辨同名条目加的自拟编号，
 *     不是选本原名。=> 请去掉并改成首句副题。」
 *
 * 《宋词三百首》目录里同一词牌下的多首**本无序号**，编排次序各本之间还有出入；
 * 写成「其一」等于替选本定了一个它没有的篇次，用户点开也看不出是哪一首。
 * 下面这张表**逐条列出**改过的 20 条，锁住「标题 = 词牌·首句」这件事 ——
 * 日后谁再想加自拟编号，这里会先红。
 */
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

/**
 * 取首句作副题：截到第一个逗号为止。
 *   · 首句本身就是词牌（「长相思，在长安」）时，取到第二个逗号；
 *   · 「庭院深深深几许？杨柳堆烟」这种首个逗号前以问号收束的，
 *     短到只剩一句问话会认不出是哪一首，一并带上下一句 —— 与语料里的取法一致。
 */
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

// 反向防线：全库不得再出现形如「某某·其一」的标题
const SEQ_RE = /[（(·]其[一二三四五六七八九十]+[）)·]?$/;
const leftover = SC.filter(p => SEQ_RE.test(p.title));
chk(leftover.length === 0,
  '《宋词三百首》里没有残留的自拟「其N」编号（残留 ' +
  leftover.map(p => p.title).join('、') + '）');

// 副题是从**本篇正文里取的字**，不是补出来的信息 —— 只对上面那 20 条成立。
// （其余词作的副题是**选本原名**，如「宴山亭·北行见杏花」「江城子·乙卯正月二十日夜记梦」，
//   那是选本目录里就有的题，不该拿首句去要求它。）
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

  chk(d.querySelectorAll('#gw-list .item').length === 283,
    '列表渲染 283 首（实际 ' + d.querySelectorAll('#gw-list .item').length + '）');
  chk(d.querySelector('#gw-count') === null,
    '页顶那一行不再挂已读进度牌（Issue #147：读数挪到详情页状态栏）');
  // 分组卡：分组数与词牌数一致
  chk(d.querySelectorAll('#gw-list .group-card').length === groupNames.length,
    '按词牌渲染 ' + groupNames.length + ' 张分组卡');

  // 挂载点对外接口
  const api = w.ReaderEngine.current;
  chk(!!api, '引擎挂上了宋词实例');
  chk(api.total() === 283, '实例 total() 为 283');

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
  // Issue #147：用户原话「将 0 / 283 首 挪到详情页的 宋 张先《宋词三百首》的后面，同一行」——
  // 所以这一枚数必须与朝代 / 作者 / 出处同处一行，且报的是「已读 / 总数 首」。
  const scRdCount = d.querySelector('#rd-meta .rd-count');
  chk(!!scRdCount && scRdCount.textContent === '0 / 283 首',
    '详情页状态栏里有「0 / 283 首」且与元信息同一行（实际「' +
    (scRdCount ? scRdCount.textContent : '无') + '」；整行「' +
    d.querySelector('#rd-meta').textContent + '」）');
  chk(!!scRdCount && scRdCount.parentElement === d.querySelector('#rd-meta'),
    '这一枚 .rd-count 是 .rd-meta 的直接子元素（同一行，不另起一行）');
  const plain = d.querySelector('#rd-text').textContent
    .replace(/[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹ·]+/g, '').replace(/\s/g, '');
  chk(/寻寻觅觅/.test(plain), '正文已写入阅读器');
  chk(/冷冷清清/.test(d.querySelector('#rd-trans-text').textContent), '白话译文已写入阅读器');

  // 搜索：按作者筛，且只筛宋词这一部
  api.setKeyword('李清照');
  const nLi = d.querySelectorAll('#gw-list .item').length;
  chk(nLi > 0 && nLi < 283, '按作者「李清照」搜索得到子集（' + nLi + ' 首）');

  console.log('');
  console.log(fails === 0 ? '🎉 宋词三百首测试全部通过' : '❌ 宋词三百首测试 ' + fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
}, 120);
