/**
 * 自选集合（除教材之外，用户自己加进来要背的篇目）测试
 *
 * 对应需求（Issue #69 收尾）：
 *   一、主表裁定规则：**课内以教材文本为准，选集以选本原貌为准，
 *       冲突时主表分成两条并列的作品**。
 *       —— 正文（去标点后）一致的合并为同一篇；有出入的分成两条。
 *   二、自选集合：家长 / 学生可创建、编辑、删除**多个**集合用于背诵；
 *       集合**不分任何组**；它与「唐诗三百首」「古文观止」那几部既定集子
 *       是两回事，只是「除中小学古诗词之外，额外想背的篇目」的清单。
 *   三、入口：在课外阅读任一集子的**索引列表或详情页**、以及**搜索页**，
 *       都能把一篇加进自选集合，加进来就跟着遗忘曲线一起复习。
 *
 * 这一层验四件事：
 *   1. data/works-index.js 的判重口径（合并 / 并列各举真例）
 *   2. js/collections.js 的增删改查与判重（按作品，不按条目）
 *   3. 引擎层的「加入背诵」按钮（列表圆键 + 详情页工具条键）
 *   4. js/scheduler.js 把自选篇目并进每日任务，且与课内同篇只排一次
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const vm = require('vm');
const path = __dirname + '/../';

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

/* ================= 一、作品主表：判重口径 ================= */
const sb = { window: {}, console, sessionStorage: null };
sb.window = sb;
vm.createContext(sb);
const DATA = [
  'data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js', 'data/poems-5.js',
  'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js', 'data/poems-9.js', 'data/poems-10.js',
  'data/poems-11.js', 'data/poems-12.js', 'data/index.js', 'data/poems-classic.js',
  'data/poems-tangshi.js', 'data/poems-songci.js', 'data/poems-guwen.js', 'data/poems-zhaoming.js',
  'data/site-index.js', 'data/works-map.js', 'data/works-index.js'
];
DATA.forEach(f => vm.runInContext(fs.readFileSync(path + f, 'utf8'), sb, { filename: f }));
const WI = sb.WorksIndex;

chk(Array.isArray(sb.WORKS_GROUPS) && sb.WORKS_GROUPS.length > 0,
  '同篇对照表 data/works-map.js 有内容（' + (sb.WORKS_GROUPS || []).length + ' 组）');
chk(sb.WORKS_GROUPS.every(g => g.wid && g.title && Array.isArray(g.entries) && g.entries.length >= 2),
  '对照表每组都带 wid / title / entries（且每组至少两条条目）');
// 静态表里的每一条目也必须在站点索引里真实存在 —— 拼错一个 id 就会静默少判一次重
const allIds = new Set(sb.SITE_INDEX.map(p => p.id));
chk(sb.WORKS_GROUPS.every(g => g.entries.every(id => allIds.has(id))),
  '对照表里的条目 id 全部能在站点索引里找到（没有拼错的影子条目）');

// 漂移防线：静态表必须与「按判重键现算」的结果一致。
// 改了语料（某篇正文订正）却忘了重跑 scripts/build-works-map.js 时，
// 集子页（读静态表）与搜索页（读现算）的判重结果就会不一致 —— 这条会红。
const liveGroups = WI.works.filter(w => w.entries.length > 1)
  .map(w => w.entries.slice().sort().join('|')).sort();
const staticGroups = sb.WORKS_GROUPS
  .map(g => g.entries.slice().sort().join('|')).sort();
chk(liveGroups.length === staticGroups.length &&
  liveGroups.every((g, i) => g === staticGroups[i]),
  '同篇对照表与现算结果一致（改了语料要重跑 scripts/build-works-map.js）');

// —— 合并例：《静夜思》课内与唐诗三百首正文一致，是同一篇 ——
chk(WI.same('poems-xx1-09', 'tangshi-ts-231'),
  '《静夜思》（课内）与《夜思》（唐诗三百首）正文一致 → 同一篇作品');
const jys = WI.byWid(WI.widOf('tangshi-ts-231'));
chk(jys && jys.title === '静夜思' && jys.titles.indexOf('夜思') >= 0,
  '合并后主条目题名取教材题名「静夜思」，另一题名「夜思」留在 titles 里（同诗异题）');

// —— 合并例：《陋室铭》课内用「」，古文观止用『』，剥掉引号后正文一致 ——
chk(WI.same('poems-cz7-23', 'guwen-gwj-97'),
  '《陋室铭》课内 / 古文观止（引号用法不同）剥掉标点后仍判为同一篇');

// —— 并列例：《夜上受降城闻笛》教材作「回乐烽」、选本作「回乐峰」——
chk(!WI.same('poems-cz7-08', 'tangshi-ts-270'),
  '《夜上受降城闻笛》一字之差（烽 / 峰）→ 分成两条并列的作品，各背各的');

// —— 并列例：同名不同作品（骆宾王《蝉》与李商隐《蝉》）——
chk(!WI.same('poems-xx5-01', 'tangshi-ts-160'),
  '同名不同作品（《蝉》两首）→ 不成同一篇（判重只看正文，不看题名）');

// —— 判重键：标点、空白、大小写都不影响 ——
chk(WI.dedupKey('床前明月光，疑是地上霜。') === WI.dedupKey('床前明月光 疑是地上霜'),
  '判重键剥掉标点与空白');
chk(WI.dedupKey('孔子云「何陋之有」') === WI.dedupKey('孔子云何陋之有'),
  '判重键剥掉 CJK 引号（《陋室铭》两种引法算同一篇）');

// —— 排程代表条目：优先课内（老进度一条不丢）——
chk(WI.repOf('tangshi-ts-231') === 'poems-xx1-09',
  '《静夜思》的排程代表条目取课内那一条（进度合流、老进度不丢）');
chk(WI.repOf('tangshi-ts-1') === 'tangshi-ts-1',
  '纯课外篇目（无课内对应）代表条目就是它自己');

/* ================= 二、自选集合：增删改查 ================= */
// localStorage 替身：把数据放在内存里，事件用 jsdom 的 window
const dom0 = new JSDOM('<!doctype html><html><body></body></html>',
  { runScripts: 'dangerously', url: 'https://local.test/' });
const w0 = dom0.window;
// 把先前的数据模块灌进这个 window
DATA.forEach(f => {
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

// 第一次「加入背诵」：没有集合时自动建一个（用户在详情页只按了一颗键）
const r1 = C.add('tangshi-ts-1');
chk(r1 && r1.created && C.list().length === 1 && C.list()[0].name === '我要背的',
  '第一次加入自动新建默认集合「我要背的」');
chk(C.has('tangshi-ts-1'), '加入后 has() 为真');

// 再建一个集合，放到第二个里
const c2 = C.create('论语选背');
C.add('guwen-gwj-1', c2.id);
chk(C.list().length === 2, '可以建多个自选集合（实际 ' + C.list().length + '）');
chk(C.collectionsOf('guwen-gwj-1').length === 1 &&
  C.collectionsOf('guwen-gwj-1')[0].name === '论语选背',
  '一篇可以在指定的集合里');

// 同一篇再放进另一个集合：允许（各存一份引用）
C.add('guwen-gwj-1', C.list()[0].id);
chk(C.collectionsOf('guwen-gwj-1').length === 2, '同一篇可以同时属于多个集合');
chk(C.count() === 2, '自选篇目总数按作品去重（实际 ' + C.count() + '）');

// 判重按作品：《静夜思》（课内条目）加进来
C.add('poems-xx1-09', C.list()[0].id);
const beforeJys = C.count();
chk(beforeJys === 3, '《静夜思》加进来后共 3 篇作品（实际 ' + beforeJys + '）');
// 再从同篇的另一条（唐诗《夜思》）加一次，不该变成两篇
C.add('tangshi-ts-231', C.list()[0].id);
chk(C.count() === beforeJys, '从同篇的另一条再加一次，总数不变（按作品判重）');
chk(C.has('poems-xx1-09') && C.has('tangshi-ts-231'),
  '同一篇的两个条目都显示「已在背诵」（哪一条上判重都认）');

// 重命名 / 限长 / 空名回落
const renamed = C.rename(c2.id, '  论语 选背  ');
chk(renamed.name === '论语 选背', '重命名会去掉首尾空白并压缩多余空格');
chk(C.rename(c2.id, '一二三四五六七八九十十一十二十三').name.length === C.NAME_MAX,
  '集合名限长到 ' + C.NAME_MAX + ' 字');
chk(C.rename(c2.id, '   ').name === C.DEFAULT_NAME, '空名回落默认名「我要背的」');

// 移出
chk(C.removeItem('guwen-gwj-1', c2.id) === true, '可从指定集合移出一篇');
chk(C.collectionsOf('guwen-gwj-1').length === 1, '移出后只剩另一个集合里的那一份');
chk(C.removeEverywhere('guwen-gwj-1') === true && !C.has('guwen-gwj-1'),
  'removeEverywhere 把这一篇从所有集合里拿掉');

// 删除集合
const beforeDrop = C.list().length;
chk(C.remove(c2.id) === true && C.list().length === beforeDrop - 1,
  '可以删除整个集合');

/* ---- 排程篇目：交给遗忘曲线的对象 ---- */
C.add('tangshi-ts-1', C.list()[0].id);
const items = C.scheduleItems(w0.SITE_INDEX);
chk(items.length === C.count(), 'scheduleItems 的条数 = 去重后的作品数');
const one = items.filter(p => p.id === 'tangshi-ts-1')[0];
chk(!!one && one.title && one.text && one.custom === true,
  '排程篇目带齐标题 / 正文，并标了 custom（让它与课内篇目分得开）');
// 与课内同篇时，排程代表条目是课内那一条（老进度不丢）
const jysItem = C.scheduleItems(w0.SITE_INDEX).filter(p => p.id === 'poems-xx1-09')[0];
chk(!!jysItem, '《静夜思》进了排程篇目，且代表条目是课内那一条（poems-xx1-09）');
chk(!!jysItem && ['poems-xx1-09', 'tangshi-ts-231'].indexOf(jysItem.sourceEntryId) >= 0,
  '原始加入的那一条记在 sourceEntryId（列表里显示用户加的那一条）');

/* ================= 三、引擎层：加入背诵入口 ================= */
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

  // 点列表里的圆键：没有集合时自动建一个并加入
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

  // 详情页那一枚：点开一篇，按下工具条上的「加入背诵」
  const item2 = list.querySelectorAll('.item')[1];
  const id2 = item2.dataset.id;
  item2.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const rd = w.document.querySelector('#gw-reader');
  chk(rd.hidden === false, '详情页打开');
  const reciteBtn = rd.querySelector('[data-gw="recite"]');
  chk(!!reciteBtn && reciteBtn.hidden === false, '详情页工具条上的「加入背诵」可见');
  reciteBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  // 已经有集合了 → 点这颗键弹的是集合选择器（让用户挑放进哪一个）
  const pickerEl = w.document.getElementById('gw-recite-picker');
  chk(pickerEl && !pickerEl.hidden, '详情页点「加入背诵」弹出集合选择器');
  const colOpt = pickerEl.querySelector('.recite-col');
  chk(!!colOpt, '选择器里列出已有集合');
  colOpt.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  chk(w.ReciteCollections.has(id2), '从详情页选择集合后加入背诵（详情页这一条入口）');

  // 搜索页也带这一枚（同一份引擎，六页共用）
  const sHtml = fs.readFileSync(path + 'search/index.html', 'utf8');
  chk(/data-gw="recite"/.test(sHtml), '搜索页阅读器也有「加入背诵」键');

  // 集合变化事件：别的页面加过之后，这一页的按钮要跟着变
  const picker = w.document.getElementById('gw-recite-picker');
  chk(!!picker, '集合选择器（弹层）已就绪');

  /* ---- 快照：集子索引页不加载全站索引，靠加入时存下的最小快照 ---- */
  const stored = JSON.parse(w.localStorage.getItem('poem_recite_collections_v1'));
  const firstItem = stored.collections[0].items[0];
  chk(typeof firstItem === 'object' && !!firstItem.snap,
    '加入时顺手存了一份最小快照（首页不加载五部集子，靠它显示与排程）');
  chk(!!firstItem.snap.text && !!firstItem.snap.title,
    '快照里带着正文与题名（首页每日任务要读正文）');
  // 首页只加载课内 12 册：用空索引模拟首页取数，仍应拿得出这一篇
  const noIndex = C.scheduleItems([]);
  chk(noIndex.length === C.count() && noIndex.every(p => p.title && p.text),
    '没有站点索引时（首页情形）自选篇目仍带题名与正文（走快照）');

  /* ================= 四、遗忘曲线：自选篇目排进每日任务 ================= */
  // 在**首页**那一套（含 scheduler）里验：自选篇目要跟着一起排复习，
  // 且与课内同篇时只排一次（不能因为「在唐诗页加过」就多背一遍）。
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
    // 课内优先、自选补位：本册只有 5 首左右，把每日数量开到 30，
    // 自选篇目必然被排进来（reason=optional，文案显示「自选」）。
    const plan = S.generateDailyPlan({
      grade: 1, term: 1, count: 30, scope: 'term',
      provider: function (g, t) { return wh.getPoemsByGradeTerm(g, t); }, getRecord: getRecord,
      extraPoems: extra
    });
    const hit = plan.filter(it => it.poem.id === 'tangshi-ts-1')[0];
    chk(!!hit && hit.reason === 'optional',
      '自选篇目能补进每日任务（标记 reason=optional，文案显示「自选」）');
    // 顺序：本册（教材当册）的课内篇目排在自选之前，自选再排在
    // 「从相邻年级补」的那些之前 —— 既保证教材是主线，
    // 又让用户显式加进来的篇目优先于系统替他凑数的相邻学期内容。
    const idxCustom = plan.indexOf(hit);
    const firstAdjacent = plan.map((it, i) => (!it.poem.custom && it.poem.grade !== 1 ? i : -1))
      .reduce((a, b) => (b >= 0 && (a < 0 || b < a) ? b : a), -1);
    chk(!!hit && idxCustom > 0 && plan.slice(0, idxCustom).every(it => !it.poem.custom),
      '自选篇目排在本册课内篇目之后（教材当册是主线）');
    chk(!hit || firstAdjacent < 0 || idxCustom < firstAdjacent,
      '自选篇目排在「相邻年级补位」之前（用户显式加背的优先于系统凑数）');

    // 到期复习优先于新学：给自选篇目造一条「今天到期」的记录
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

    /* ---------- 五、两个「回来之后」的老问题 ---------- */
    // 1) 快照待刷新标记：首页启动时跑一遍 markStale()，
    //    课外那些首页拿不到新语料的条目要被标出来，等下次进集子页再刷新；
    //    这一趟不许动任何正文（只标状态）。
    const C2 = w0.ReciteCollections;
    const beforeSnaps = JSON.stringify(C2.list());
    const marked = C2.markStale(w0.SITE_INDEX || []);
    chk(typeof marked === 'number', 'markStale() 返回被标记的条数（' + marked + '）');
    const afterList = C2.list();
    const snapsNow = JSON.stringify(afterList);
    chk(JSON.parse(beforeSnaps).length === JSON.parse(snapsNow).length,
      'markStale() 不改集合数量');
    // 快照正文一个字不许动（只允许多一个 stale 标记）
    const stripStale = o => JSON.parse(JSON.stringify(o, (k, v) => (k === 'stale' ? undefined : v)));
    chk(JSON.stringify(stripStale(JSON.parse(beforeSnaps))) ===
      JSON.stringify(stripStale(JSON.parse(snapsNow))),
      'markStale() 只标状态，不动快照里的任何正文');
    // 进集子页 / 搜索页（索引齐备）刷新之后，stale 标记要被清掉
    C2.markStale([]);
    C2.refreshSnapshots(w0.SITE_INDEX || []);
    const stillStale = C2.list().reduce((n, c) => n + c.items.filter(it => it.stale).length, 0);
    chk(stillStale === 0, '索引齐备时 refreshSnapshots() 会把 stale 标记清掉（残留 ' + stillStale + '）');

    // 2) 今日计划缓存键要跟着自选集合走：加了 / 删了一篇，当天的缓存必须失效。
    //    这是实测踩到的坑 —— 原先只在「监听得到事件」的入口清缓存，
    //    在集子页加完篇目后**直接刷新首页**时缓存还在，刚加的那篇当天不出现。
    const appSrc = fs.readFileSync(path + 'js/app.js', 'utf8');
    chk(/function collectionsKey\(/.test(appSrc),
      'js/app.js 有 collectionsKey()（把自选集合压进今日计划缓存键）');
    const keyFn = appSrc.slice(appSrc.indexOf('function planCacheKey()'));
    chk(/collectionsKey\(\)/.test(keyFn.slice(0, keyFn.indexOf('}'))),
      '今日计划的缓存键里编进了自选集合的版本（集合一变，当天缓存自动失效）');
    chk(!/function planCacheKey\([\s\S]{0,400}?settings\.dailyCount\s*\)\s*;/.test(appSrc),
      '缓存键不再只由「日期 / 年级 / 学期 / 范围 / 数量」决定（少了集合这一维就会拿到旧计划）');

    console.log('\n' + (fails ? '❌ ' + fails + ' 项失败' : '🎉 自选集合测试全部通过'));
    process.exit(fails ? 1 : 0);
  }, 60);
}, 60);
