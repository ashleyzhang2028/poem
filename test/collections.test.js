const { JSDOM } = require('jsdom');
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

const dom0 = new JSDOM('<!doctype html><html><body></body></html>',
  { runScripts: 'dangerously', url: 'https://local.test/' });
const w0 = dom0.window;

['data/text-master.js'].concat(DATA).forEach(f => {
  const el = w0.document.createElement('script');
  el.textContent = fs.readFileSync(path + f, 'utf8');
  w0.document.body.appendChild(el);
});
const colEl = w0.document.createElement('script');
colEl.textContent = fs.readFileSync(path + 'js/collections.js', 'utf8');
w0.document.body.appendChild(colEl);
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

const html = fs.readFileSync(path + 'classic/index.html', 'utf8');
const order = html.match(/<script src="([^"]+)"><\/script>/g).map(s => s.match(/src="([^"]+)"/)[1]);
chk(order.indexOf('data/works-map.js') >= 0 && order.indexOf('data/works-index.js') >= 0,
  '集子索引页加载了同篇对照表与作品主表（判重靠它）');
chk(order.indexOf('js/collections.js') >= 0, '集子索引页加载了 js/collections.js');
chk(order.indexOf('data/works-index.js') < order.indexOf('js/collections.js'),
  '作品主表排在自选集合模块之前（collections 判重要读它）');
chk(/data-gw="recite"/.test(html), '阅读器工具条上有一枚「加入背诵」键（data-gw="recite"）');

const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://local.test/classic/' });
const w = dom.window;
w.scrollTo = function () {};
order.forEach(f => {
  const el = w.document.createElement('script');
  el.textContent = fs.readFileSync(path + f, 'utf8');
  w.document.body.appendChild(el);
});

setTimeout(() => {
  const list = w.document.querySelector('#gw-list');
  chk(list.querySelectorAll('.item').length === 100, '小古文列表照旧渲染 100 篇');
  chk(list.querySelectorAll('.item .item-recite').length === 100,
    '每条右侧都有一枚「加入背诵」圆键（索引列表这一条入口）');

  const first = list.querySelector('.item');
  const firstId = first.dataset.id;
  first.querySelector('.item-recite').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  chk(w.localStorage.getItem('poem_recite_collections_v1') !== null,
    '从索引列表点「加入背诵」写入了自选集合');
  chk(w.ReciteCollections.has(firstId), '点过的那一篇已在自选集合里');
  chk(first.querySelector('.item-recite').dataset.on === '1',
    '点过之后圆键进入「已加入」态（data-on="1"）');
  chk(first.querySelector('.item-recite').title === w.ReaderEngine.words.reciteIn,
    '圆键的 title 变成「已在背诵」');

  const item2 = list.querySelectorAll('.item')[1];
  const id2 = item2.dataset.id;
  item2.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const rd = w.document.querySelector('#gw-reader');
  chk(rd.hidden === false, '详情页打开');
  const reciteBtn = rd.querySelector('[data-gw="recite"]');
  chk(!!reciteBtn && reciteBtn.hidden === false, '详情页工具条上的「加入背诵」可见');
  reciteBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

  const pickerEl = w.document.getElementById('gw-recite-picker');
  chk(pickerEl && !pickerEl.hidden, '详情页点「加入背诵」弹出集合选择器');
  const colOpt = pickerEl.querySelector('.recite-col');
  chk(!!colOpt, '选择器里列出已有集合');
  colOpt.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  chk(w.ReciteCollections.has(id2), '从详情页选择集合后加入背诵（详情页这一条入口）');

  const sHtml = fs.readFileSync(path + 'search/index.html', 'utf8');
  chk(/data-gw="recite"/.test(sHtml), '搜索页阅读器也有「加入背诵」键');

  const picker = w.document.getElementById('gw-recite-picker');
  chk(!!picker, '集合选择器（弹层）已就绪');

  chk(picker.parentNode === w.document.body,
    '集合选择器挂在 <body> 下（不在 .reader 里，不受那一层层叠上下文限制）');
  chk(/\bmodal\b/.test(picker.className),
    '集合选择器带 .modal 类（继承全站弹层层级，实际 ' + picker.className + '）');

  const stored = JSON.parse(w.localStorage.getItem('poem_recite_collections_v1'));
  const firstItem = stored.collections[0].items[0];
  chk(typeof firstItem === 'object' && !!firstItem.snap,
    '加入时顺手存了一份最小快照（首页不加载六部集子，靠它显示与排程）');
  chk(!!firstItem.snap.text && !!firstItem.snap.title,
    '快照里带着正文与题名（首页每日任务要读正文）');

  const zmCol = C.create('文选选背');
  C.add('zhaoming-zm-246', zmCol.id);
  const zmSnap = C.snapshotOf('zhaoming-zm-246', w.SITE_INDEX);
  chk(!!zmSnap && zmSnap.title === '古诗十九首', '《古诗十九首》进了快照');
  chk(zmSnap.dynasty === '', '快照里朝代照旧留空，不回落成「未知」（实际 ' +
    JSON.stringify(zmSnap.dynasty) + '）');
  const zmItems = C.scheduleItems(w.SITE_INDEX).filter(p => p.id === 'zhaoming-zm-246');
  chk(zmItems.length === 1 && zmItems[0].dynasty === '' && zmItems[0].author,
    '排程拿到的这一篇：朝代空、作者在（留空的是朝代，不是作者）');
  C.removeItem('zhaoming-zm-246', zmCol.id);
  C.remove(zmCol.id);

  const noIndex = C.scheduleItems([]);
  chk(noIndex.length === C.count() && noIndex.every(p => p.title && p.text),
    '没有站点索引时（首页情形）自选篇目仍带题名与正文（走快照）');

  const home = fs.readFileSync(path + 'index.html', 'utf8');
  const homeOrder = home.match(/<script src="([^"]+)"><\/script>/g).map(x => x.match(/src="([^"]+)"/)[1]);
  chk(homeOrder.indexOf('js/collections.js') < homeOrder.indexOf('js/scheduler.js'),
    '首页脚本顺序：自选集合模块排在 scheduler 之前（排程要读它）');
  chk(homeOrder.indexOf('data/works-index.js') < homeOrder.indexOf('js/collections.js'),
    '首页脚本顺序：作品主表排在自选集合模块之前');

  const domH = new JSDOM(home, { runScripts: 'dangerously', url: 'https://local.test/' });
  const wh = domH.window;
  wh.scrollTo = function () {};
  homeOrder.forEach(f => {
    const el = wh.document.createElement('script');
    el.textContent = fs.readFileSync(path + f, 'utf8');
    wh.document.body.appendChild(el);
  });

  setTimeout(() => {
    const S = wh.Scheduler;
    chk(!!S, '首页的 Scheduler 就绪');
    const getRecord = function () { return null; };
    const extra = [{
      id: 'tangshi-ts-1', custom: true, title: '感遇·其一',
      author: '张九龄', dynasty: '唐', text: '孤鸿海上来……'
    }];

    const plan = S.generateDailyPlan({
      grade: 1, term: 1, count: 30, scope: 'term',
      provider: function (g, t) { return wh.getPoemsByGradeTerm(g, t); }, getRecord: getRecord,
      extraPoems: extra
    });
    const hit = plan.filter(it => it.poem.id === 'tangshi-ts-1')[0];
    chk(!!hit && hit.reason === 'optional',
      '自选篇目能补进每日任务（标记 reason=optional，文案显示「自选」）');

    const idxCustom = plan.indexOf(hit);
    const firstAdjacent = plan.map((it, i) => (!it.poem.custom && it.poem.grade !== 1 ? i : -1))
      .reduce((a, b) => (b >= 0 && (a < 0 || b < a) ? b : a), -1);
    chk(!!hit && idxCustom > 0 && plan.slice(0, idxCustom).every(it => !it.poem.custom),
      '自选篇目排在本册课内篇目之后（教材当册是主线）');
    chk(!hit || firstAdjacent < 0 || idxCustom < firstAdjacent,
      '自选篇目排在「相邻年级补位」之前（用户显式加背的优先于系统凑数）');

    const today = Date.now();
    const due = S.generateDailyPlan({
      grade: 1, term: 1, count: 3, scope: 'term',
      provider: function () { return []; },
      getRecord: function (id) {
        return id === 'tangshi-ts-1'
          ? { level: 2, learned: true, nextReviewAt: today - 1000, lastReviewAt: today - 3 * 86400000, reviewCount: 2, lapses: 0 }
          : null;
      },
      extraPoems: extra
    });
    chk(due.some(it => it.poem.id === 'tangshi-ts-1' && it.reason === 'review'),
      '到期的自选篇目按遗忘曲线排成「复习」任务');

    const C2 = w0.ReciteCollections;
    const beforeSnaps = JSON.stringify(C2.list());
    const marked = C2.markStale(w0.SITE_INDEX || []);
    chk(typeof marked === 'number', 'markStale() 返回被标记的条数（' + marked + '）');
    const afterList = C2.list();
    const snapsNow = JSON.stringify(afterList);
    chk(JSON.parse(beforeSnaps).length === JSON.parse(snapsNow).length,
      'markStale() 不改集合数量');

    const stripStale = o => JSON.parse(JSON.stringify(o, (k, v) => (k === 'stale' ? undefined : v)));
    chk(JSON.stringify(stripStale(JSON.parse(beforeSnaps))) ===
      JSON.stringify(stripStale(JSON.parse(snapsNow))),
      'markStale() 只标状态，不动快照里的任何正文');

    C2.markStale([]);
    C2.refreshSnapshots(w0.SITE_INDEX || []);
    const stillStale = C2.list().reduce((n, c) => n + c.items.filter(it => it.stale).length, 0);
    chk(stillStale === 0, '索引齐备时 refreshSnapshots() 会把 stale 标记清掉（残留 ' + stillStale + '）');

    const appSrc = fs.readFileSync(path + 'js/app.js', 'utf8');
    chk(/function collectionsKey\(/.test(appSrc),
      'js/app.js 有 collectionsKey()（把自选集合压进今日计划缓存键）');
    const keyFn = appSrc.slice(appSrc.indexOf('function planCacheKey()'));
    chk(/collectionsKey\(\)/.test(keyFn.slice(0, keyFn.indexOf('}'))),
      '今日计划的缓存键里编进了自选集合的版本（集合一变，当天缓存自动失效）');
    chk(!/function planCacheKey\([\s\S]{0,400}?settings\.dailyCount\s*\)\s*;/.test(appSrc),
      '缓存键不再只由「日期 / 年级 / 学期 / 范围 / 数量」决定（少了集合这一维就会拿到旧计划）');

    const C3 = w0.ReciteCollections;
    C3.list().slice().forEach(c => C3.remove(c.id));
    const cc = C3.create('排序测试');
    ['tangshi-ts-1', 'tangshi-ts-2', 'tangshi-ts-3'].forEach(id => C3.add(id, cc.id));
    const idsOf = () => C3.get(cc.id).items.map(it => typeof it === 'string' ? it : it.id);
    chk(idsOf().join(',') === 'tangshi-ts-1,tangshi-ts-2,tangshi-ts-3',
      '新加入的排在末尾（顺序=数组顺序）');
    chk(C3.moveUp(cc.id, 2) === true && idsOf().join(',') === 'tangshi-ts-1,tangshi-ts-3,tangshi-ts-2',
      '下一条上移一位，其余顺次让位');
    chk(C3.moveDown(cc.id, 0) === true && idsOf().join(',') === 'tangshi-ts-3,tangshi-ts-1,tangshi-ts-2',
      '首条下移一位');
    chk(C3.moveItem(cc.id, 2, 0) === true && idsOf().join(',') === 'tangshi-ts-2,tangshi-ts-3,tangshi-ts-1',
      'moveItem 可以把一项挪到任意位置');
    chk(C3.moveUp(cc.id, 0) === false && C3.moveDown(cc.id, 2) === false,
      '已经在队首 / 队尾时上下移返回 false（调用方照此禁用按钮）');
    chk(C3.moveItem(cc.id, 9, 0) === false && idsOf().length === 3,
      '越界的位置原样返回，不会动到清单');

    C3.list().slice().forEach(c => C3.remove(c.id));
    const cg = C3.create('整组测试');
    ['tangshi-ts-1', 'tangshi-ts-2', 'songci-sc-1', 'guwen-gwj-1'].forEach(id => C3.add(id, cg.id));
    const groupOf = id => {
      const p = (w0.SITE_INDEX || []).filter(x => x.id === id)[0];
      return p ? (p.bookName || '') + ' · ' + (p.gradeGroup || '') : '未分组';
    };
    const tangshiGroup = groupOf('tangshi-ts-1');
    const n = C3.removeGroup(cg.id, tangshiGroup, groupOf);
    chk(n === 2, '整组移出移掉了这一组的 2 篇唐诗（实际 ' + n + '）');
    chk(C3.get(cg.id).items.length === 2 &&
      C3.get(cg.id).items.every(it => groupOf(it.id) !== tangshiGroup),
      '整组移出后，这一组一篇不剩，其他组原样保留');
    chk(C3.removeGroup(cg.id, '不存在的组', groupOf) === 0,
      '整组移出时组名对不上就一篇不动（不会误伤）');

    C3.list().slice().forEach(c => C3.remove(c.id));
    const cu = C3.create('未分组');
    C3.add('tangshi-ts-1', cu.id);
    chk(C3.removeGroup(cu.id, '未分组', () => '未分组') === 1,
      '索引里查不到的条目算「未分组」，同样可整组移出');

    C3.list().slice().forEach(c => C3.remove(c.id));
    const ce = C3.create('给奶奶的清单');
    ['tangshi-ts-1', 'songci-sc-1'].forEach(id => C3.add(id, ce.id));
    const labels = {};
    C3.get(ce.id).items.forEach(it => {
      const p = (w0.SITE_INDEX || []).filter(x => x.id === it.id)[0] || {};
      labels[it.id] = (p.title || it.id);
    });
    const text = C3.exportText(ce.id, labels);
    chk(text.indexOf('tangshi-ts-1') >= 0 && text.indexOf('songci-sc-1') >= 0,
      '导出文本里有全部条目 id');
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
    const before0 = C3.list().length;
    const res = C3.importText(messy, '别人的清单', w0.SITE_INDEX || []);
    chk(C3.list().length === before0 + 1, '导入总是新建一个集合（不往已有集合里塞）');
    chk(res.collection.name === '别人的清单', '导入的集合名沿用清单里的名字');
    chk(res.added === 3, '导入收进 3 篇（注释 / 空行 / 重复 / 无效行都不算）实际 ' + res.added);
    chk(res.dropped === 1, '认不出的那条如实报数（dropped=1，实际 ' + res.dropped + '）');
    chk(res.collection.items.every(it => it.snap && it.snap.title),
      '导入时顺手给每一篇存了快照（首页不加载那几部集子，靠它显示）');

    const res2 = C3.importText('tangshi-ts-1\nfoo-bar', '裸清单', []);
    chk(res2.added === 2 && res2.dropped === 0,
      '没有站点索引时按原样收（不因查不到就丢掉用户贴的东西）');

    const res3 = C3.importText('tangshi-ts-1\nsongci-sc-1', '裸清单2', w0.SITE_INDEX || []);
    chk(res3.added === 2, '只贴一串 id 的裸清单同样能导入');

    const imported = C3.scheduleItems(w0.SITE_INDEX);
    chk(imported.every(p => p.title && p.text),
      '导入进来的篇目照样带题名与正文（能排进今日任务）');

    const setSrc = fs.readFileSync(path + 'settings/lists/index.html', 'utf8');
    const setJs = fs.readFileSync(path + 'js/settings.js', 'utf8');
    chk(/id="btn-collections-import"/.test(setSrc),
      '设置页有「导入清单」键（id=btn-collections-import）');
    chk(/id="text-dialog"/.test(setSrc) && /id="text-dialog-text"/.test(setSrc),
      '设置页有导入 / 导出用的纯文本对话框');
    chk(/id="collections-list"/.test(setSrc) && /id="collections-tip"/.test(setSrc),
      '设置页有清单容器与说明行');

    chk(/id="collections-tip"[^>]*hidden/.test(setSrc),
      '说明行默认收起（空态才由 js/settings.js 打开并填字）');
    const tipBlock = (setJs.match(/const tip = \$\("#collections-tip"\)[\s\S]{0,320}?\n    \}/) || [''])[0];
    chk(/tip\.hidden = total > 0/.test(tipBlock),
      '有篇目时不写那句「与课内诗词一起排进每日任务；↑↓ 调顺序。」（Issue #163）');
    chk(!/["']与课内诗词一起排进每日任务/.test(setJs),
      '那句话作为**用户可见的文案**全句已删（维护者注释里留着它的来历）');

    const homeSrc2 = fs.readFileSync(path + 'index.html', 'utf8');
    chk(!/id="btn-collections-import"/.test(homeSrc2) && !/id="collections-list"/.test(homeSrc2),
      '首页不再有自选背诵的管理界面（整块搬去设置）');
    chk(!/id="collections-section"/.test(homeSrc2) && !/id="btn-collections"/.test(homeSrc2),
      '首页那张「自选背诵」折叠卡已整个移除（不留空壳）');

    const listsCss = fs.readFileSync(path + 'css/style.css', 'utf8');
    const classicCss = fs.readFileSync(path + 'css/classic.css', 'utf8');
    chk(/class="library-grid" id="collections-list"/.test(setSrc),
      '清单容器就是 «课外阅读» 那一页的 .library-grid（同一份排版）');
    chk(/className = "library-card collection-card"/.test(setJs),
      '一张集合一张卡，类名带上 .library-card（复用那一页的描边 / 圆角 / 纸底）');
    chk(/\.collection-card \{[\s\S]{0,200}?border-left: 3px solid var\(--line\)/.test(classicCss),
      '集合卡把左色条换成卡片边框同色的一条 3px 边（「里面没有绿色竖线」）');
    chk(/\.collection-body \.item \{[\s\S]{0,600}?border-left: none/.test(listsCss) &&
        /\.collection-body \.item \{[\s\S]{0,600}?border-top: 1px solid var\(--line\)/.test(listsCss),
      '卡内条目去掉竖色条，横着用与边框同一个 --line 的细线隔开');
    chk(/link rel="stylesheet" href="css\/classic\.css"/.test(setSrc),
      '这一页加载了 css/classic.css（卡片的稿子只有那一处，不抄第二份）');
    chk(!/\.item\.optional \{ border-left-color: var\(--blue/.test(listsCss) ||
        /\.collection-body \.item/.test(listsCss),
      '「蓝竖条」那一档在卡内被清掉（.optional 的 border-left-color 落不到卡里）');
    chk(/data-export=/.test(setJs), '每个集合头上有「导出」键（data-export）');
    chk(/data-up=|data-down=/.test(setJs), '每个条目有上移 / 下移键');
    chk(/data-group=/.test(setJs) && /removeGroup\(/.test(setJs),
      '分组行上有「整组移出」键，并且真的调用 removeGroup');
    chk(/function exportCollection\(/.test(setJs) && /function importCollection\(/.test(setJs),
      'js/settings.js 里有导入 / 导出的入口函数');

    const appSrc2 = fs.readFileSync(path + 'js/app.js', 'utf8');
    chk(/function extraPoems\(/.test(appSrc2) && /ReciteCollections\.scheduleItems/.test(appSrc2),
      '首页仍把自选篇目并进每日任务（搬走的只是管理入口）');
    chk(/recite-collections-change/.test(appSrc2),
      '首页仍监听自选集合变化并重排今日任务（在设置里改完回首页立刻生效）');
    chk(!/function renderCollections\(/.test(appSrc2),
      '首页不再渲染自选清单（那一套整体搬到了 js/settings.js）');

    chk(typeof C3.displayTitle === 'function', 'js/collections.js 暴露 displayTitle()');
    chk(C3.displayTitle('感遇·其一') === '感遇', '「感遇·其一」显示为「感遇」');
    chk(C3.displayTitle('木兰花·其三') === '木兰花', '「木兰花·其三」显示为「木兰花」');
    chk(C3.displayTitle('四时田园杂兴（其二）') === '四时田园杂兴',
      '括号形态的「（其二）」同样去掉');
    chk(C3.displayTitle('江城子·乙卯正月二十日夜记梦') === '江城子·乙卯正月二十日夜记梦',
      '副题里出现别的字（乙卯正月二十日）不会被误伤');
    chk(C3.displayTitle('夜思') === '夜思' && C3.displayTitle('') === '',
      '没有编号的篇名原样返回，空值不抛错');

    C3.list().slice().forEach(c => C3.remove(c.id));
    const cd = C3.create('同名测试');
    C3.add('tangshi-ts-1', cd.id);
    C3.add('tangshi-ts-2', cd.id);
    const dTitles = C3.get(cd.id).items.map(it => C3.displayTitle(
      ((w0.SITE_INDEX || []).filter(x => x.id === it.id)[0] || {}).title || ''));
    chk(dTitles.length === 2, '两条同名篇目仍各占一条（去的是显示上的编号，不是条目）');
    chk(dTitles[0] === dTitles[1],
      '去编号后两条显示同名（用户看不清的编号不再出现在界面上）');
    const appSrc3 = fs.readFileSync(path + 'js/app.js', 'utf8');
    chk(/function showTitle\(/.test(appSrc3) &&
      (appSrc3.match(/showTitle\(/g) || []).length >= 5,
      'js/app.js 里自选列表 / 今日任务 / 弹层标题 / 朗读都用显示名（用到 ' +
      (appSrc3.match(/showTitle\(/g) || []).length + ' 处）');
    chk(/p\.custom \? showTitle\(p\.title\) : p\.title/.test(appSrc3),
      '课内篇目不走去编号（那里的「其一」是教材原名，一个字不能动）');

    const settingsHtml = fs.readFileSync(path + 'settings/lists/index.html', 'utf8');
    const setOrder = settingsHtml.match(/<script src="([^"]+)"><\/script>/g)
      .map(x => x.match(/src="([^"]+)"/)[1]);
    chk(setOrder.indexOf('/js/collections.js') >= 0 && setOrder.indexOf('/js/collections.js') < setOrder.indexOf('/js/settings.js'),
      '设置页加载了 js/collections.js，且排在 js/settings.js 之前');
    chk(setOrder.indexOf('/data/site-index.js') >= 0,
      '设置页加载了站点总索引（清单里每一篇要靠它认题名 / 作者 / 集子名）');

    const domS = new JSDOM(settingsHtml, { runScripts: 'dangerously', url: 'https://local.test/settings/lists/', base: 'https://local.test/settings/lists/' });
    const ws = domS.window;

    ws.localStorage.setItem('poem_recite_collections_v1', JSON.stringify({
      version: 1,
      collections: [{
        id: 'c-set', name: '我要背的', createdAt: Date.now(),
        items: [
          'poems-xx1-01',
          { id: 'tangshi-ts-1', snap: { title: '感遇', author: '张九龄', dynasty: '唐', book: 'tangshi', bookName: '唐诗三百首', gradeGroup: '卷一 五言古诗', text: '孤鸿海上来', translation: '' } }
        ]
      }]
    }));
    ws.localStorage.setItem('poem_recite_progress_v1', JSON.stringify({
      'poems-xx1-01': { level: 4, learned: true, reviewCount: 4, nextReviewAt: Date.now(), lapses: 0 }
    }));

    setOrder.forEach(f => {
      const el = ws.document.createElement('script');
      el.textContent = fs.readFileSync(path + f.replace(/^\//, ''), 'utf8');
      ws.document.body.appendChild(el);
    });

    setTimeout(() => {
      const ds = ws.document;
      const items = () => [...ds.querySelectorAll('#collections-list .item')];
      chk(items().length === 2,
        '设置页把集合里那两篇都画出来了（课内走索引、唐诗走快照；实际 ' + items().length + '）');
      chk(items().map(e => e.querySelector('.item-title').textContent).join('/') === '咏鹅/感遇',
        '篇名正确：' + items().map(e => e.querySelector('.item-title').textContent).join(' / '));
      chk(/骆宾王/.test(items()[0].querySelector('.item-meta').textContent) &&
        /张九龄/.test(items()[1].querySelector('.item-meta').textContent),
        '元信息（作者 / 朝代 / 集子名）都有 —— 快照那一条也画全了');
      chk(/第 5 轮|较牢固|掌握/.test(items()[0].querySelector('.item-meta').textContent) ||
        items()[0].querySelector('.mbar') !== null,
        '背过的那一篇显示记忆阶段 / 掌握度（设置页也加载了 js/scheduler.js）');
      chk(items()[1].querySelector('.item-meta').textContent.indexOf('未学过') >= 0,
        '没背过的那一篇如实写「未学过」（不冒充 0 轮）');
      chk([...ds.querySelectorAll('.collection-group-name')].map(x => x.textContent).join(' / ') ===
        '课内诗词 / 唐诗三百首 · 卷一 五言古诗',
        '分组行按「集子 · 卷次」成组：' +
        [...ds.querySelectorAll('.collection-group-name')].map(x => x.textContent).join(' / '));

      const idsOf = () => JSON.parse(ws.localStorage.getItem('poem_recite_collections_v1'))
        .collections[0].items.map(it => typeof it === 'string' ? it : it.id);
      const down = [...ds.querySelectorAll('[data-down]')].find(b => !b.disabled);
      chk(!!down, '首条下方那颗「下移」键可用（队尾那颗是禁用的）');
      chk(down.getAttribute('data-up') === null && down.getAttribute('data-down') === '0',
        '这颗键挂在首条（data-down=0）—— 两颗箭头各认自己那一条');
      down.dispatchEvent(new ws.MouseEvent('click', { bubbles: true }));
      chk(idsOf().join(',') === 'tangshi-ts-1,poems-xx1-01',
        '点「下移」就地换两位（实际 ' + idsOf().join(',') + '）');
      chk(items().map(e => e.querySelector('.item-title').textContent).join('/') === '感遇/咏鹅',
        '列表跟着重画，顺序当场可见');

      const oldPrompt = ws.prompt;
      ws.prompt = () => '新名字';
      ds.querySelector('[data-rename]').dispatchEvent(new ws.MouseEvent('click', { bubbles: true }));
      chk(JSON.parse(ws.localStorage.getItem('poem_recite_collections_v1')).collections[0].name === '新名字',
        '「改名」写进了同一份 localStorage');
      chk(ds.querySelector('.collection-name').textContent === '新名字', '列表上的集合名跟着换');

      ds.querySelector('[data-export]').dispatchEvent(new ws.MouseEvent('click', { bubbles: true }));
      chk(!ds.querySelector('#text-dialog').hidden, '「导出」弹出纯文本对话框');
      chk(/tangshi-ts-1/.test(ds.querySelector('#text-dialog-text').value),
        '对话框里是这一份清单的条目 id（可直接复制发出去）');
      chk(ds.querySelector('#text-dialog-text').readOnly === true, '导出的文本框是只读的');
      ds.querySelector('#text-dialog-cancel').dispatchEvent(new ws.MouseEvent('click', { bubbles: true }));
      chk(ds.querySelector('#text-dialog').hidden, '点「关闭」收起对话框');

      ws.Entitlement.writeTier(ws.localStorage, 'pro');
      ds.querySelector('#btn-collections-import').dispatchEvent(new ws.MouseEvent('click', { bubbles: true }));
      chk(!ds.querySelector('#text-dialog').hidden, '「导入清单」弹出对话框');
      ds.querySelector('#text-dialog-text').value = 'poems-xx1-02\nnot-a-real-id';
      ds.querySelector('#text-dialog-ok').dispatchEvent(new ws.MouseEvent('click', { bubbles: true }));
      const cols2 = JSON.parse(ws.localStorage.getItem('poem_recite_collections_v1')).collections;
      chk(cols2.length === 2, '导入新建了一个集合（不动已有的那几个；实际 ' + cols2.length + '）');
      chk(cols2[1].items.length === 1 && cols2[1].items[0].id === 'poems-xx1-02',
        '只收进认得出的那一行（认不出的如实跳过，不装作没发生）');

      const colsNow = ws.ReciteCollections.list();
      ws.ReciteCollections.remove(colsNow[1].id);
      chk(ws.ReciteCollections.list().length === 1, '只留一个集合，后面逐步对账');

      const colId = ws.ReciteCollections.list()[0].id;
      const lenOf = id => (ws.ReciteCollections.get(id) || { items: [] }).items.length;

      const before = lenOf(colId);
      chk(items().length === before, '列表上画出的条数与集合里的条数一致（' + before + '）');
      items()[0].querySelector('.item-remove').dispatchEvent(new ws.MouseEvent('click', { bubbles: true }));
      chk(lenOf(colId) === before - 1,
        '「移出」把这一篇从集合里拿掉（' + before + ' → ' + lenOf(colId) + '）');
      chk(items().length === lenOf(colId),
        '列表跟着重画（界面上少一行，不只是本地存的那份变了）');

      ws.confirm = () => true;
      const gbtn = ds.querySelector('[data-group]');
      chk(!!gbtn, '每个分组行上有「整组移出」键');
      const gname = gbtn.getAttribute('data-group');
      const nInGroup = items().length;
      gbtn.dispatchEvent(new ws.MouseEvent('click', { bubbles: true }));
      const leftGroups = [...ds.querySelectorAll('.collection-group-name')].map(x => x.textContent);
      chk(leftGroups.indexOf(gname) === -1,
        '整组移出之后这一组从列表上消失（' + gname + '；组内 ' + nInGroup + ' 篇）');
      chk(lenOf(colId) === 0,
        '整组移出把这一组的篇目一篇不剩地拿掉（本地存的那份也是 0）');

      chk(ws.ReciteCollections.list().length === 1, '删除前还剩 1 个集合');
      ds.querySelector('[data-drop="' + colId + '"]').dispatchEvent(new ws.MouseEvent('click', { bubbles: true }));
      chk(ws.ReciteCollections.list().length === 0, '「删除」删掉了一整个集合');
      chk(ws.ReciteCollections.get(colId) === null, '删掉的那个集合在本地存的那份里也没了');
      chk(ds.querySelector('#collections-list .empty') !== null,
        '一个集合都没有时清单区给一句「还没有自选篇目」，不是一片白');
      chk(ds.querySelector('[data-drop]') === null, '一个集合都没有时界面上没有「删除」键');
      chk(ds.querySelector('#btn-collections-import') !== null,
        '一个集合都没有时「导入清单」键也始终在（家长发来清单，第一件事就是导进来）');

      ds.querySelector('#btn-collections-import').dispatchEvent(new ws.MouseEvent('click', { bubbles: true }));
      ds.querySelector('#text-dialog-text').value = 'poems-xx1-01';
      ds.querySelector('#text-dialog-ok').dispatchEvent(new ws.MouseEvent('click', { bubbles: true }));
      chk(items().length === 1, '空清单状态下也能直接导入（不逼用户先建一个集合）');
      chk(ds.querySelector('#collections-list .empty') === null,
        '导入之后那句「还没有自选篇目」跟着消失');
      ws.prompt = oldPrompt;

      console.log('\n' + (fails ? '❌ ' + fails + ' 项失败' : '🎉 自选集合测试全部通过'));
      process.exit(fails ? 1 : 0);
    }, 60);
  }, 60);
}, 60);

setTimeout(function () {
  const domT = new JSDOM('<!doctype html><html><body></body></html>',
    { runScripts: 'dangerously', url: 'https://limit.test/' });
  const wt = domT.window;
  ['js/entitlement.js', 'js/collections.js'].forEach(f => {
    const el = wt.document.createElement('script');
    el.textContent = fs.readFileSync(path + f, 'utf8');
    wt.document.body.appendChild(el);
  });
  const L = wt.ReciteCollections;
  const E2 = wt.Entitlement;
  const clearAll = () => {
    L.list().slice().forEach(c => L.remove(c.id));
    E2.clearTier(wt.localStorage);
  };

  setTimeout(function () {
    chk(typeof L.limit === 'function' && typeof L.remaining === 'function',
      'js/collections.js 暴露 limit() / remaining()');

    clearAll();
    chk(L.limit() === L.FREE_COLLECTIONS, 'free：上限 = ' + L.limit() + ' 个');

    let fb = 0;
    for (let i = 0; i < 12; i++) { const r = L.create('f' + i); if (r && r.id) fb++; }
    chk(fb === L.FREE_COLLECTIONS, 'free 正好建到 ' + L.FREE_COLLECTIONS + ' 个就停（实际 ' + fb + '）');
    const fLast = L.create('free 第 11 个');
    chk(fLast && fLast.error === 'E_LIMIT', 'free 第 11 个：被拦（E_LIMIT，不是静默丢掉）');
    const imp = L.importText('poems-xx1-01', '', wt.SITE_INDEX || []);
    chk(imp.error === 'E_LIMIT' && imp.collection === null,
      'free 满额时导入也被拦（与 create 同一条不变量，绝不悄悄丢一半）');

    clearAll();
    E2.writeTier(wt.localStorage, 'pro');
    chk(L.limit() === L.PRO_COLLECTIONS, 'Pro：上限 = ' + L.limit() + ' 个');
    let built = 0;
    for (let i = 0; i < L.PRO_COLLECTIONS + 5; i++) { const r = L.create('p' + i); if (r && r.id) built++; }
    chk(built === L.PRO_COLLECTIONS, 'Pro 正好建到 ' + L.PRO_COLLECTIONS + ' 个就停（实际 ' + built + '）');

    clearAll();
    E2.writeTier(wt.localStorage, 'max');
    chk(L.limit() === L.MAX_COLLECTIONS, 'Max：上限 = ' + L.limit() + ' 个（不再是 Infinity）');

    let b2 = 0;
    for (let j = 0; j < 30; j++) { const r = L.create('m' + j); if (r && r.id) b2++; }
    chk(b2 === 30, 'Max 连建 30 个全成功（实际 ' + b2 + '）');
    chk(L.remaining() === L.MAX_COLLECTIONS - 30, 'Max 的 remaining() = 5000 − 已建数');

    const cap = E2.CAPS['collections.many'];
    chk(L.FREE_COLLECTIONS === E2.quotaFor(cap, 'free'), 'Free 的 ' + L.FREE_COLLECTIONS + ' 个与内核 quotas 是同一个数');
    chk(L.PRO_COLLECTIONS === E2.quotaFor(cap, 'pro'), 'Pro 的 ' + L.PRO_COLLECTIONS + ' 个与内核 quotas 是同一个数');
    chk(L.MAX_COLLECTIONS === E2.quotaFor(cap, 'max'), 'Max 的 ' + L.MAX_COLLECTIONS + ' 个与内核 quotas 是同一个数');
    chk(!/自选清单不限|20 个/.test(cap.name) && cap.name === '自选清单', '能力名收成「自选清单」（额度归 quotas，不写在名字里）');

    chk(!E2.cap('collections.unlimited'), 'collections.unlimited 能力已删除（Max 的额度归 collections.many 的 5000）');
    chk(E2.compare({}).rows.every(r => r.cap !== 'collections.unlimited'),
      '对比表里不再单列一行「自选清单不限」');

    const saved = wt.Entitlement;
    delete wt.Entitlement;
    chk(L.limit() === Infinity, '读不到 Entitlement 时不设限（宁可不判，也不误拦）');
    wt.Entitlement = saved;

    console.log('\n' + (fails ? '❌ ' + fails + ' 项失败（含上限一节）' : '🎉 自选集合测试全部通过（含上限一节）'));
    process.exit(fails ? 1 : 0);
  }, 60);
}, 120);
