
const fs = require('fs');
const vm = require('vm');
const path = __dirname + '/../';

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const sb = { window: {}, console, sessionStorage: null };
sb.window = sb;
vm.createContext(sb);
const DATA = [
  'data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js', 'data/poems-5.js',
  'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js', 'data/poems-9.js', 'data/poems-10.js',
  'data/poems-11.js', 'data/poems-12.js', 'data/index.js', 'data/poems-classic.js',
  'data/poems-yuefu.js',
  'data/poems-tangshi.js', 'data/poems-songci.js', 'data/poems-guwen.js', 'data/poems-zhaoming.js', 'data/poems-yuanqu.js',
  'data/poems-yuefu.js', 'data/poems-jinxiandai.js', 'data/poems-chengyu.js',
  'data/poems-changshi.js',
  'data/site-index.js', 'data/works-map.js', 'data/works-index.js'
];

const { loadData, resolve } = require('./master-env');
loadData(sb, DATA);
const WI = sb.WorksIndex;

chk(Array.isArray(sb.WORKS_GROUPS) && sb.WORKS_GROUPS.length > 0,
  '同篇对照表 data/works-map.js 有内容（' + (sb.WORKS_GROUPS || []).length + ' 组）');
chk(sb.WORKS_GROUPS.every(g => g.wid && g.title && Array.isArray(g.entries) && g.entries.length >= 2),
  '对照表每组都带 wid / title / entries（且每组至少两条条目）');

const allIds = new Set(sb.SITE_INDEX.map(p => p.id));
chk(sb.WORKS_GROUPS.every(g => g.entries.every(id => allIds.has(id))),
  '对照表里的条目 id 全部能在站点索引里找到（没有拼错的影子条目）');

const liveGroups = WI.works.filter(w => w.entries.length > 1)
  .map(w => w.entries.slice().sort().join('|')).sort();
const staticGroups = sb.WORKS_GROUPS
  .map(g => g.entries.slice().sort().join('|')).sort();
chk(liveGroups.length === staticGroups.length &&
  liveGroups.every((g, i) => g === staticGroups[i]),
  '同篇对照表与现算结果一致（改了语料要重跑 scripts/build-works-map.js）');

chk(WI.same('poems-xx1-09', 'tangshi-ts-231'),
  '《静夜思》（课内）与《夜思》（唐诗三百首）正文一致 → 同一篇作品');
const jys = WI.byWid(WI.widOf('tangshi-ts-231'));
chk(jys && jys.title === '静夜思' && jys.titles.indexOf('夜思') >= 0,
  '合并后主条目题名取教材题名「静夜思」，另一题名「夜思」留在 titles 里（同诗异题）');

chk(WI.same('poems-cz7-23', 'guwen-gwj-97'),
  '《陋室铭》课内 / 古文观止（引号用法不同）剥掉标点后仍判为同一篇');

chk(WI.same('poems-cz7-08', 'tangshi-ts-270'),
  '《夜上受降城闻笛》用字统一（取教材的「烽」）后两条已合为同一篇');
chk(WI.repOf('tangshi-ts-270') === 'poems-cz7-08',
  '合并后代表条目归课内那一条（老进度不丢）');

chk(!WI.same('poems-xx5-01', 'tangshi-ts-160'),
  '同名不同作品（《蝉》两首）→ 不成同一篇（判重只看正文，不看题名）');

chk(WI.dedupKey('床前明月光，疑是地上霜。') === WI.dedupKey('床前明月光 疑是地上霜'),
  '判重键剥掉标点与空白');
chk(WI.dedupKey('孔子云「何陋之有」') === WI.dedupKey('孔子云何陋之有'),
  '判重键剥掉 CJK 引号（《陋室铭》两种引法算同一篇）');

chk(WI.repOf('tangshi-ts-231') === 'poems-xx1-09',
  '《静夜思》的排程代表条目取课内那一条（进度合流、老进度不丢）');
chk(WI.repOf('tangshi-ts-1') === 'tangshi-ts-1',
  '纯课外篇目（无课内对应）代表条目就是它自己');

const dom0 = { window: null };
const w0 = { console: console, Date: Date, JSON: JSON, Math: Math };
w0.window = w0;
w0.localStorage = (function () {
  const mem = {};
  return {
    getItem: (k) => (mem[k] === undefined ? null : mem[k]),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; }
  };
})();
vm.createContext(w0);
require('./master-env').loadData(w0, DATA);
const WCheck = w0.SITE_INDEX;
if (!Array.isArray(WCheck) || !WCheck.length) {
  throw new Error('站点总索引没装进来（SITE_INDEX 为空）—— 快照与判重都靠它');
}
vm.runInContext(fs.readFileSync(path + 'js/collections.js', 'utf8'), w0,
  { filename: 'js/collections.js' });
const C = w0.ReciteCollections;

chk(!!C, 'js/collections.js 暴露 window.ReciteCollections');
chk(C.KEY === 'poem_recite_collections_v1', '存储键为 poem_recite_collections_v1');
chk(C.list().length === 0, '初始没有任何自选集合');

const r1 = C.add('tangshi-ts-1');
chk(r1 && r1.created && C.list().length === 1 && C.list()[0].name === '我要背的',
  '第一次加入自动新建默认集合「我要背的」');
chk(C.has('tangshi-ts-1'), '加入后 has() 为真');

const c2 = C.create('论语选背');
C.add('guwen-gwj-1', c2.id);
chk(C.list().length === 2, '可以建多个自选集合（实际 ' + C.list().length + '）');
chk(C.collectionsOf('guwen-gwj-1').length === 1 &&
  C.collectionsOf('guwen-gwj-1')[0].name === '论语选背',
  '一篇可以在指定的集合里');

C.add('guwen-gwj-1', C.list()[0].id);
chk(C.collectionsOf('guwen-gwj-1').length === 2, '同一篇可以同时属于多个集合');
chk(C.count() === 2, '自选篇目总数按作品去重（实际 ' + C.count() + '）');

C.add('poems-xx1-09', C.list()[0].id);
const beforeJys = C.count();
chk(beforeJys === 3, '《静夜思》加进来后共 3 篇作品（实际 ' + beforeJys + '）');

C.add('tangshi-ts-231', C.list()[0].id);
chk(C.count() === beforeJys, '从同篇的另一条再加一次，总数不变（按作品判重）');
chk(C.has('poems-xx1-09') && C.has('tangshi-ts-231'),
  '同一篇的两个条目都显示「已在背诵」（哪一条上判重都认）');

const renamed = C.rename(c2.id, '  论语 选背  ');
chk(renamed.name === '论语 选背', '重命名会去掉首尾空白并压缩多余空格');
chk(C.rename(c2.id, '一二三四五六七八九十十一十二十三').name.length === C.NAME_MAX,
  '集合名限长到 ' + C.NAME_MAX + ' 字');
chk(C.rename(c2.id, '   ').name === C.DEFAULT_NAME, '空名回落默认名「我要背的」');

chk(C.removeItem('guwen-gwj-1', c2.id) === true, '可从指定集合移出一篇');
chk(C.collectionsOf('guwen-gwj-1').length === 1, '移出后只剩另一个集合里的那一份');
chk(C.removeEverywhere('guwen-gwj-1') === true && !C.has('guwen-gwj-1'),
  'removeEverywhere 把这一篇从所有集合里拿掉');

const beforeDrop = C.list().length;
chk(C.remove(c2.id) === true && C.list().length === beforeDrop - 1,
  '可以删除整个集合');

C.add('tangshi-ts-1', C.list()[0].id);
const items = C.scheduleItems(w0.SITE_INDEX);
chk(items.length === C.count(), 'scheduleItems 的条数 = 去重后的作品数');
const one = items.filter(p => p.id === 'tangshi-ts-1')[0];
chk(!!one && one.title && one.text && one.custom === true,
  '排程篇目带齐标题 / 正文，并标了 custom（让它与课内篇目分得开）');

const jysItem = C.scheduleItems(w0.SITE_INDEX).filter(p => p.id === 'poems-xx1-09')[0];
chk(!!jysItem, '《静夜思》进了排程篇目，且代表条目是课内那一条（poems-xx1-09）');
chk(!!jysItem && ['poems-xx1-09', 'tangshi-ts-231'].indexOf(jysItem.sourceEntryId) >= 0,
  '原始加入的那一条记在 sourceEntryId（列表里显示用户加的那一条）');

C.list().slice().forEach(c => C.remove(c.id));

{

  vm.runInContext(fs.readFileSync(path + 'js/entitlement.js', 'utf8'), w0,
    { filename: 'js/entitlement.js' });
  const E2 = w0.Entitlement;
  const mem = w0.localStorage;
  const clearAll = () => {
    C.list().slice().forEach(c => C.remove(c.id));
    E2.clearTier(mem);
  };

  chk(typeof C.limit === 'function' && typeof C.remaining === 'function',
    'js/collections.js 暴露 limit() / remaining()');

  clearAll();
  chk(C.limit() === C.FREE_COLLECTIONS, 'free：上限 = ' + C.limit() + ' 个');

  let fb = 0;
  for (let i = 0; i < 12; i++) { const r = C.create('f' + i); if (r && r.id) fb++; }
  chk(fb === C.FREE_COLLECTIONS, 'free 正好建到 ' + C.FREE_COLLECTIONS + ' 个就停（实际 ' + fb + '）');
  const fLast = C.create('free 第 11 个');
  chk(fLast && fLast.error === 'E_LIMIT', 'free 第 11 个：被拦（E_LIMIT，不是静默丢掉）');
  const imp = C.importText('poems-xx1-01', '', w0.SITE_INDEX || []);
  chk(imp.error === 'E_LIMIT' && imp.collection === null,
    'free 满额时导入也被拦（与 create 同一条不变量，绝不悄悄丢一半）');

  clearAll();
  E2.writeTier(mem, 'pro');
  chk(C.limit() === C.PRO_COLLECTIONS, 'Pro：上限 = ' + C.limit() + ' 个');
  let built = 0;
  for (let i = 0; i < C.PRO_COLLECTIONS + 5; i++) { const r = C.create('p' + i); if (r && r.id) built++; }
  chk(built === C.PRO_COLLECTIONS, 'Pro 正好建到 ' + C.PRO_COLLECTIONS + ' 个就停（实际 ' + built + '）');

  clearAll();
  E2.writeTier(mem, 'max');
  chk(C.limit() === C.MAX_COLLECTIONS, 'Max：上限 = ' + C.limit() + ' 个（不再是 Infinity）');

  let b2 = 0;
  for (let j = 0; j < 30; j++) { const r = C.create('m' + j); if (r && r.id) b2++; }
  chk(b2 === 30, 'Max 连建 30 个全成功（实际 ' + b2 + '）');
  chk(C.remaining() === C.MAX_COLLECTIONS - 30, 'Max 的 remaining() = 5000 − 已建数');

  const cap = E2.CAPS['collections.many'];
  chk(C.FREE_COLLECTIONS === E2.quotaFor(cap, 'free'), 'Free 的 ' + C.FREE_COLLECTIONS + ' 个与内核 quotas 是同一个数');
  chk(C.PRO_COLLECTIONS === E2.quotaFor(cap, 'pro'), 'Pro 的 ' + C.PRO_COLLECTIONS + ' 个与内核 quotas 是同一个数');
  chk(C.MAX_COLLECTIONS === E2.quotaFor(cap, 'max'), 'Max 的 ' + C.MAX_COLLECTIONS + ' 个与内核 quotas 是同一个数');
  chk(!E2.cap('collections.unlimited'), 'collections.unlimited 能力已删除（Max 的额度归 collections.many 的 5000）');
}

{
  C.list().slice().forEach(c => C.remove(c.id));
  const cc = C.create('排序测试');
  ['tangshi-ts-1', 'tangshi-ts-2', 'tangshi-ts-3'].forEach(id => C.add(id, cc.id));
  const idsOf = () => C.get(cc.id).items.map(it => typeof it === 'string' ? it : it.id);
  chk(idsOf().join(',') === 'tangshi-ts-1,tangshi-ts-2,tangshi-ts-3', '新加入的排在末尾（顺序=数组顺序）');
  chk(C.moveUp(cc.id, 2) === true && idsOf().join(',') === 'tangshi-ts-1,tangshi-ts-3,tangshi-ts-2',
    '下一条上移一位，其余顺次让位');
  chk(C.moveDown(cc.id, 0) === true && idsOf().join(',') === 'tangshi-ts-3,tangshi-ts-1,tangshi-ts-2',
    '首条下移一位');
  chk(C.moveItem(cc.id, 2, 0) === true && idsOf().join(',') === 'tangshi-ts-2,tangshi-ts-3,tangshi-ts-1',
    'moveItem 可以把一项挪到任意位置');
  chk(C.moveUp(cc.id, 0) === false && C.moveDown(cc.id, 2) === false,
    '已经在队首 / 队尾时上下移返回 false');
  chk(C.moveItem(cc.id, 9, 0) === false && idsOf().length === 3, '越界的位置原样返回，不会动到清单');

  C.list().slice().forEach(c => C.remove(c.id));
  const cg = C.create('整组测试');
  ['tangshi-ts-1', 'tangshi-ts-2', 'songci-sc-1', 'guwen-gwj-1'].forEach(id => C.add(id, cg.id));
  const groupOf = id => {
    const p = (w0.SITE_INDEX || []).filter(x => x.id === id)[0];
    return p ? (p.bookName || '') + ' · ' + (p.gradeGroup || '') : '未分组';
  };
  const tangshiGroup = groupOf('tangshi-ts-1');
  const n = C.removeGroup(cg.id, tangshiGroup, groupOf);
  chk(n === 2, '整组移出移掉了这一组的 2 篇唐诗（实际 ' + n + '）');
  chk(C.get(cg.id).items.length === 2 && C.get(cg.id).items.every(it => groupOf(it.id) !== tangshiGroup),
    '整组移出后，这一组一篇不剩，其他组原样保留');
  chk(C.removeGroup(cg.id, '不存在的组', groupOf) === 0, '整组移出时组名对不上就一篇不动（不会误伤）');

  C.list().slice().forEach(c => C.remove(c.id));
  const cu = C.create('未分组');
  C.add('tangshi-ts-1', cu.id);
  chk(C.removeGroup(cu.id, '未分组', () => '未分组') === 1,
    '索引里查不到的条目算「未分组」，同样可整组移出');

  C.list().slice().forEach(c => C.remove(c.id));
  const ce = C.create('给奶奶的清单');
  ['tangshi-ts-1', 'songci-sc-1'].forEach(id => C.add(id, ce.id));
  const labels = {};
  C.get(ce.id).items.forEach(it => {
    const p = (w0.SITE_INDEX || []).filter(x => x.id === it.id)[0] || {};
    labels[it.id] = (p.title || it.id);
  });
  const text = C.exportText(ce.id, labels);
  chk(text.indexOf('tangshi-ts-1') >= 0 && text.indexOf('songci-sc-1') >= 0, '导出文本里有全部条目 id');
  chk(text.split('\n').filter(l => l.charAt(0) === '#').length >= 3,
    '导出文本带说明行（集合名 / 用法 / 每篇的篇名），对方看得懂');
  chk(text.indexOf('❌') === -1 && /# 跬步 · 自选集合：给奶奶的清单（2 篇）/.test(text),
    '导出文本第一行写明集合名与篇数');

  const messy = [
    '# 跬步 · 自选集合：别人的清单（3 篇）',
    '',
    'tangshi-ts-1',
    '  ',
    '# 感遇·其一',
    'tangshi-ts-1      # 重复的一条',
    'songci-sc-1',
    'not-a-real-id',
    'guwen-gwj-1'
  ].join('\n');
  const before0 = C.list().length;
  const res = C.importText(messy, '别人的清单', w0.SITE_INDEX || []);
  chk(C.list().length === before0 + 1, '导入总是新建一个集合（不往已有集合里塞）');
  chk(res.collection.name === '别人的清单', '导入的集合名沿用清单里的名字');
  chk(res.added === 3, '导入收进 3 篇（注释 / 空行 / 重复 / 无效行都不算）实际 ' + res.added);
  chk(res.dropped === 1, '认不出的那条如实报数（dropped=1，实际 ' + res.dropped + '）');
  chk(res.collection.items.every(it => it.snap && it.snap.title),
    '导入时顺手给每一篇存了快照（首页不加载那几部集子，靠它显示）');

  const res2 = C.importText('tangshi-ts-1\nfoo-bar', '裸清单', []);
  chk(res2.added === 2 && res2.dropped === 0, '没有站点索引时按原样收（不因查不到就丢掉用户贴的东西）');

  const noIndex = C.scheduleItems([]);
  chk(noIndex.length >= 2 && noIndex.every(p => p.title && p.text),
    '没有站点索引时（首页情形）认得出的自选篇目仍带题名与正文（走快照，实际 ' +
    noIndex.length + ' 篇）');
  chk(noIndex.filter(p => p.id === 'tangshi-ts-1' && p.title && p.text).length === 1,
    '连「裸清单」里那一篇也带着快照 —— 传空索引时不看站点索引');

  const imported = C.scheduleItems(w0.SITE_INDEX || []);
  chk(imported.every(p => p.title && p.text), '导入进来的篇目照样带题名与正文（能排进今日任务）');

  chk(typeof C.displayTitle === 'function', 'js/collections.js 暴露 displayTitle()');
  chk(C.displayTitle('感遇·其一') === '感遇', '「感遇·其一」显示为「感遇」');
  chk(C.displayTitle('木兰花·其三') === '木兰花', '「木兰花·其三」显示为「木兰花」');
  chk(C.displayTitle('四时田园杂兴（其二）') === '四时田园杂兴', '括号形态的「（其二）」同样去掉');
  chk(C.displayTitle('江城子·乙卯正月二十日夜记梦') === '江城子·乙卯正月二十日夜记梦',
    '副题里出现别的字（乙卯正月二十日）不会被误伤');
  chk(C.displayTitle('夜思') === '夜思' && C.displayTitle('') === '', '没有编号的篇名原样返回，空值不抛错');

  const beforeSnaps = JSON.stringify(C.list());
  const marked = C.markStale(w0.SITE_INDEX || []);
  chk(typeof marked === 'number', 'markStale() 返回被标记的条数（' + marked + '）');
  const stripStale = o => JSON.parse(JSON.stringify(o, (k, v) => (k === 'stale' ? undefined : v)));
  chk(JSON.stringify(stripStale(JSON.parse(beforeSnaps))) ===
    JSON.stringify(stripStale(JSON.parse(JSON.stringify(C.list())))),
    'markStale() 只标状态，不动快照里的任何正文');
}

console.log('');
console.log(fails ? '❌ ' + fails + ' 项失败' : '🎉 自选集合测试全部通过');
process.exit(fails ? 1 : 0);
