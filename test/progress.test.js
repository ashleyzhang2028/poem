/**
 * 背诵进度总览（/progress/）测试
 *
 * 需求（Issue #69 后续，用户原话）：
 *   「背诵进度可视化（到期日历 / 掌握度分布 —— 现在只看得到「第几轮」，
 *     看不到「下次何时到期」）」
 *
 * 原先「第几轮 / 掌握度 / 下次复习」只在**单篇**的详情弹层里看得到。
 * 这一层验四件事：
 *   1. Scheduler.overview() / daysUntilDue() 的聚合口径
 *      —— 到期归档、逾期合并、掌握度分档、归一化用的 maxDay；
 *   2. Scheduler.dueList() 的篇目清单口径
 *      —— 「哪天是**哪几篇**」，与 overview() 的日历**同一本账**（数对得上）；
 *   3. 页面真的把两类图渲染出来了（日历 14 格 / 掌握度 5 档 / 阶段 10 档），
 *      以及「全部到期篇目」那一块（哪天该背哪几篇、点篇名回首页）；
 *   4. 这一页**只读**：进页面不改任何一篇的进度、不写已读、不重排今日任务；
 *   5. 入口接上了：设置页有进这一页的链接、页签「背诵」在进度页保持选中。
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const vm = require('vm');
const path = __dirname + '/../';

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const APP_JSON = 'data/poems-1.js,data/poems-2.js,data/poems-3.js,data/poems-4.js,data/poems-5.js,' +
  'data/poems-6.js,data/poems-7.js,data/poems-8.js,data/poems-9.js,data/poems-10.js,data/poems-11.js,' +
  'data/poems-12.js,data/index.js';

/* ================= 一、聚合口径（纯 vm，无 DOM） ================= */
const sb = { window: {}, console };
sb.window = sb;
vm.createContext(sb);
APP_JSON.split(',').concat(['js/scheduler.js']).forEach(f =>
  vm.runInContext(fs.readFileSync(path + f, 'utf8'), sb, { filename: f }));
const S = sb.Scheduler;

chk(typeof S.overview === 'function', 'Scheduler 暴露 overview()');
chk(typeof S.daysUntilDue === 'function', 'Scheduler 暴露 daysUntilDue()');

const DAY = 86400000;
const today0 = S.startOfDay(Date.now());
const recs = {
  // 逾期 3 天 → 并进「今天」这一格
  overdue3: { level: 0, learned: true, nextReviewAt: today0 - 3 * DAY, lapses: 0, reviewCount: 1 },
  // 逾期 9 天 → 单列「逾期 7 天以上」，不进日历
  overdue9: { level: 1, learned: true, nextReviewAt: today0 - 9 * DAY, lapses: 0, reviewCount: 1 },
  // 今天到期
  due0: { level: 2, learned: true, nextReviewAt: today0 + 3600000, lapses: 0, reviewCount: 2 },
  // 第 3 天到期（日历上 offset=3）
  due3: { level: 3, learned: true, nextReviewAt: today0 + 3 * DAY, lapses: 0, reviewCount: 3 },
  // 第 20 天到期 → 超出 14 天窗口，日历上不出现，但也没逾期
  due20: { level: 4, learned: true, nextReviewAt: today0 + 20 * DAY, lapses: 0, reviewCount: 4 }
};
const pool = ['overdue3', 'overdue9', 'due0', 'due3', 'due20', 'never'].map(id => ({ id: id, title: id }));
const o = S.overview(pool, id => recs[id] || null, { days: 14 });

chk(o.total === 6 && o.learned === 5 && o.unlearned === 1,
  '总览账目：6 首里已学 5 首、未学过 1 首（实际 ' + o.learned + '/' + o.unlearned + '）');
chk(o.calendar.length === 14, '日历 14 格（含今天）');
chk(o.calendar[0].count === 2, '「今天」这一格 = 今天到期的 1 首 + 逾期 3 天那 1 首（实际 ' + o.calendar[0].count + '）');
chk(o.calendar[3].count === 1, '第 3 天那一格有 1 首（实际 ' + o.calendar[3].count + '）');
chk(o.calendar.reduce((a, d) => a + d.count, 0) === 3,
  '超出 14 天窗口的（第 20 天）不进日历，未来更远的不占格');
chk(o.overdue === 1, '逾期 7 天以上的单列一条（实际 ' + o.overdue + '）');
chk(o.calendar[0].count + o.overdue === o.dueToday,
  'dueToday = 今天这一格 + 逾期七天以上（不会漏掉也不会重复算）');
chk(o.maxDay === 2, 'maxDay 取最忙的那一天（画竖条要用它归一，实际 ' + o.maxDay + '）');

// 逾期必须并进「今天」那一格，不能画成负数日期
chk(o.calendar.every(d => d.offset >= 0), '日历的格一律是非负偏移（逾期不画成负日期）');
chk(o.calendar[0].due === true, '今天这一格标了 due（页面上要把「今天」描一道边）');

// 掌握度分档：五档，各档之和 = 已学数
const sumBuckets = o.masteryBuckets.reduce((a, b) => a + b, 0);
chk(o.masteryBuckets.length === 5, '掌握度分五档（0-19 / 20-39 / 40-59 / 60-79 / 80-100）');
chk(sumBuckets === o.learned, '五档之和 = 已学数（实际 ' + sumBuckets + ' / ' + o.learned + '）');
chk(o.avgMastery >= 0 && o.avgMastery <= 100, '平均掌握度在 0-100 之间（实际 ' + o.avgMastery + '）');

// 记忆阶段：十档，与 INTERVALS 同长，名字来自 levelName
chk(o.levelCounts.length === S.INTERVALS.length, '记忆阶段十档（与复习间隔同长）');
chk(o.levelCounts[0].name === '新学' &&
  o.levelCounts[o.levelCounts.length - 1].name === '已牢固',
  '阶段名沿用 levelName()（首档「新学」、末档「已牢固」）');
chk(o.levelCounts.reduce((a, l) => a + l.count, 0) === o.learned,
  '各阶段之和 = 已学数');

// daysUntilDue：「下次何时到期」这个数
chk(S.daysUntilDue(recs.due3) === 3, '「还有几天到期」算得准（第 3 天 → 3）');
chk(S.daysUntilDue(recs.overdue3) === -3, '已逾期的返回负数（页面据此显示「已到期」）');
chk(S.daysUntilDue(null) === null, '没学过（无档案）返回 null，不冒充 0');
chk(S.daysUntilDue({ learned: false }) === null, '没学过（learned=false）也返回 null');

/* ---- dueList：日历那一格的展开（「哪天是**哪几篇**」） ----
   口径必须与 overview() 一字不差：日历说今天 3 篇，清单里今天就得是那 3 篇。
   两处各算一遍迟早算出两个数，所以这里逐档对账。 */
chk(typeof S.dueList === 'function', 'Scheduler 暴露 dueList()');
const L = S.dueList(pool, id => recs[id] || null, { days: 14 });
chk(L.days.length === 14, '清单也是 14 档（与日历同长）');
chk(L.days[0].items.map(x => x.id).sort().join(',') === 'due0,overdue3',
  '今天那一档 = 今天到期的 + 逾期 3 天的（逾期一周以内的并进今天，实际 ' +
  L.days[0].items.map(x => x.id).join('、') + '）');
chk(L.days[3].items.length === 1 && L.days[3].items[0].id === 'due3',
  '第 3 天那一档就是 due3 那一篇（日历上第 3 天那格的展开）');
/* 与日历逐格对账 —— 这是这一层最要紧的一条：两边同一本账 */
const mismatchCal = [];
for (let i = 0; i < 14; i += 1) {
  if (L.days[i].items.length !== o.calendar[i].count) {
    mismatchCal.push(i + '（清单 ' + L.days[i].items.length + ' / 日历 ' + o.calendar[i].count + '）');
  }
}
chk(mismatchCal.length === 0,
  '清单每一档的篇数与日历每一格的数逐格相同（不一致：' + (mismatchCal.join('、') || '无') + '）');
chk(L.days[0].items.length + L.backlog.length === o.dueToday,
  '清单今天那一档 + backlog = dueToday（两处同一本账；实际 ' +
  (L.days[0].items.length + L.backlog.length) + ' / ' + o.dueToday + '）');
chk(L.backlog.length === o.overdue && L.backlog[0].id === 'overdue9',
  '逾期一周以上的单列一份 backlog，条数与 overview 的 overdue 相同');
chk(L.farther === 1, '超出 14 天窗口的只报个数（第 20 天那一篇；实际 ' + L.farther + '）');
chk(L.total === 4,
  '清单总篇数 = 今天 3 篇 + 第 3 天 1 篇（超出窗口的不算；实际 ' + L.total + '）');

/* 每一篇都带齐「背的时候要知道的信息」：篇名 / 阶段 / 掌握度 / 还差几天 */
const first = L.days[0].items[0];
chk(first.id && first.title !== undefined && typeof first.level === 'number' &&
  typeof first.mastery === 'number' && typeof first.daysLeft === 'number',
  '清单里每一篇带齐 id / 篇名 / 阶段 / 掌握度 / 还差几天');
chk(first.id === 'overdue3', '今天那一档里最该先背的排最前（逾期最久的在前；实际 ' + first.id + '）');
chk(L.days[0].items.filter(x => x.daysLeft < 0).length === 1 &&
  L.backlog.every(x => x.daysLeft < -7),
  '逾期的那几篇 daysLeft 是负数（页面据此显示「逾期 N 天」；backlog 的都是逾期一周以上）');
/* 同一天里按「逾期久的 → 掌握度低的 → 篇名」排，从上往下背就是最该先背的 */
const todayItems = L.days[0].items;
chk(todayItems.every((x, i) => i === 0 || todayItems[i - 1].daysLeft <= x.daysLeft),
  '今天那一档按紧迫度排（逾期久的在前）');

// 一篇都没学过：清单是空的，但 14 档仍在（页面据此给「还没有到期的篇目」）
const emptyL = S.dueList(pool, () => null, { days: 14 });
chk(emptyL.days.length === 14 && emptyL.total === 0 && emptyL.backlog.length === 0,
  '一篇都没学过时清单为空、14 档仍在（页面不是白屏，是给一句说明）');
chk(S.dueList([], () => null).days.length === 14, '空候选池也照样给出 14 档');
// 同一篇不许在清单里出现两次（重复 id 会把它画两行）
const dupL = S.dueList([{ id: 'x', title: 'x' }, { id: 'x', title: 'x' }],
  () => ({ level: 1, learned: true, nextReviewAt: Date.now() }), { days: 14 });
chk(dupL.days[0].items.length === 1, '同一篇重复出现在候选池里时只列一次');

// 没学过任何一篇时：不抛错、账目全 0
const empty = S.overview(pool, () => null, { days: 14 });
chk(empty.learned === 0 && empty.dueToday === 0 && empty.avgMastery === 0 &&
  empty.maxDay === 0 && empty.calendar.every(d => d.count === 0),
  '一篇都没学过时不抛错，账目全 0（页面显示「还没有学习记录」）');
chk(empty.unlearned === 6, '一篇都没学过时「尚未学过」= 全部');
chk(S.overview([], () => null).calendar.length === 14,
  '空候选池也照样给出 14 格日历（不至于让页面白屏）');

/* ---- 边界：正好逾期 7 天的那一篇，两边必须归同一档 ----
   #119 留下的真 bug 就在这里：`overview()` 与 `dueList()` 各写了一遍
   「逾期一周以上单列」的归档，且**页面汇总行**又把 backlog 并进了「今天」——
   于是只要有一篇正好 / 超过 7 天逾期，日历说今天 1 篇、清单汇总说 2 篇。
   原先的造数只到「逾期 2 天」，绕过了这个边界；这一层专门造它。 */
const recs7 = {
  // 正好逾期 7 天：**并进今天**（阈值是「超过一周」才单列）
  exactly7: { level: 1, learned: true, nextReviewAt: today0 + 9 * 3600000 - 7 * DAY, lapses: 0, reviewCount: 1 },
  // 逾期 8 天：单列 backlog
  over7: { level: 1, learned: true, nextReviewAt: today0 + 9 * 3600000 - 8 * DAY, lapses: 0, reviewCount: 1 },
  // 逾期 1 天：并进今天
  over1: { level: 1, learned: true, nextReviewAt: today0 + 9 * 3600000 - DAY, lapses: 0, reviewCount: 1 },
  // 今天到期
  zero: { level: 2, learned: true, nextReviewAt: today0 + 9 * 3600000, lapses: 0, reviewCount: 2 }
};
const pool7 = Object.keys(recs7).map(id => ({ id: id, title: id }));
const o7 = S.overview(pool7, id => recs7[id] || null, { days: 14 });
const L7 = S.dueList(pool7, id => recs7[id] || null, { days: 14 });

chk(L7.days[0].items.map(x => x.id).sort().join(',') === 'exactly7,over1,zero',
  '正好逾期 7 天的并进「今天」那一档（阈值是「超过一周」才单列；实际 ' +
  L7.days[0].items.map(x => x.id).join('、') + '）');
chk(L7.backlog.length === 1 && L7.backlog[0].id === 'over7',
  '逾期 8 天的才落进 backlog（实际 ' + L7.backlog.map(x => x.id).join('、') + '）');
chk(L7.days[0].items.length === o7.calendar[0].count,
  '边界上仍然是同一本账：清单「今天」那一档 = 日历「今天」那一格（实际 ' +
  L7.days[0].items.length + ' / ' + o7.calendar[0].count + '）');
chk(L7.days[0].items.length + L7.backlog.length === o7.dueToday,
  'dueToday = 今天那一档 + backlog（含「正好 7 天」这个边界；实际 ' +
  (L7.days[0].items.length + L7.backlog.length) + ' / ' + o7.dueToday + '）');
chk(o7.overdue === 1 && o7.calendar[0].count === 3,
  'overdue 只数「超过一周」的（1）；日历今天那一格含今天到期 + 逾期一周以内（3）');

/* 超出窗口的 farther 与 backlog 互不串档 */
const farL = S.dueList([{ id: 'a' }], () => ({
  level: 0, learned: true, nextReviewAt: today0 + 30 * DAY
}), { days: 14 });
chk(farL.farther === 1 && farL.total === 0 && farL.backlog.length === 0,
  '超出 14 天窗口的只进 farther，不进 total / backlog（三处各说各的）');

/* ================= 二、页面层：真的把两类图渲染出来 ================= */
/**
 * ⚠️ 页面层的加载方式（这里踩过一次坑，写下来免得后来人再撞）：
 *   jsdom 打开一个带 `<script src="...">` 的页面时，**默认不取这些外部脚本**
 *   （URL 是假的），于是 `window.POEMS_ALL` 始终是 undefined，
 *   测试看起来「页面里什么都没有」。
 *   所以这里传一个 ResourceLoader：把 `https://local.test/xxx` 映射到仓库
 *   真实文件，让 jsdom 像浏览器那样按 `<script src>` 顺序加载。
 *   —— 这也顺带把「页面自己写的 script 顺序对不对」一并验了：顺序错了
 *   （例如 scheduler 排在 data/index.js 之前）这一层就会拿到 undefined 而红。
 */
const html = fs.readFileSync(path + 'progress/index.html', 'utf8');
const order = html.match(/<script src="([^"]+)"><\/script>/g).map(s => s.match(/src="([^"]+)"/)[1]);
chk(order.indexOf('data/index.js') < order.indexOf('js/scheduler.js'),
  '脚本顺序：data/index.js 先于 scheduler（排程要读 POEMS_ALL）');
chk(order.indexOf('js/scheduler.js') < order.indexOf('js/progress.js'),
  '脚本顺序：scheduler 先于 progress（页面要用 overview）');

/**
 * 取脚本的自定义 resource loader：`https://local.test/xxx` → 仓库里的真实文件。
 *
 * 为什么要费这道手续（踩过的坑）：jsdom 对 `resources` 有**两道**检查，
 * 缺一就抛「resources must be an instance of ResourceLoader」——
 *   1) `constructor.name === "ResourceLoader"`；
 *   2) `resources instanceof ResourceLoader`（那是内部类，不从包根导出）。
 * 第 2 条用运行时反查绕开：`resources: "usable"` 会给一个**真实的**
 * ResourceLoader 实例，取其原型挂到我们这类前面即可（instanceof 只认原型链）。
 * 不必真的 `extends` —— jsdom 的 ResourceLoader 构造函数本就是空壳。
 */
class RepoLoader {
  constructor() {
    // ⚠️ 必须自己设 _userAgent / _strictSSL / _proxy：它们是 jsdom 内部
    //    ResourceLoader 的私有字段，而 `resources` **不传**时 jsdom 会
    //    `new ResourceLoader()`（空参）—— 那时 userAgent 变成 undefined，
    //    请求头里就是 "User-Agent: undefined"，node 直接抛
    //    ERR_HTTP_INVALID_HEADER_VALUE。少一个字段就炸在这一步。
    this._userAgent = 'jsdom-test';
    this._strictSSL = true;
    this._proxy = undefined;
  }
  fetch(url) {
    const file = require('path').join(path, decodeURIComponent(new URL(url).pathname));
    if (fs.existsSync(file)) return Promise.resolve(fs.readFileSync(file));
    return Promise.reject(new Error('not found: ' + url));
  }
}
const _probeDom = new JSDOM('', { resources: 'usable' });
const _realProto = Object.getPrototypeOf(_probeDom.window._resourceLoader || {});
void _probeDom;
if (_realProto && _realProto.fetch) Object.setPrototypeOf(RepoLoader.prototype, _realProto);
Object.defineProperty(RepoLoader, 'name', { value: 'ResourceLoader' });

const DAY2 = 86400000;

/** 起一个页面，带上指定的进度 */
function openPage(progress) {
  const d = new JSDOM(html, {
    runScripts: 'dangerously', resources: new RepoLoader(), url: 'https://local.test/progress/'
  });
  if (progress) d.window.localStorage.setItem('poem_recite_progress_v1', JSON.stringify(progress));
  return d;
}

// 第一趟：只为拿 POEMS_ALL（要它才知道篇目 id）
const probe = openPage();

setTimeout(() => {
  const all = probe.window.POEMS_ALL;
  chk(all && all.length === 261, '课内 261 首批入（实际 ' + (all ? all.length : 'undefined') + '）');

  /* 造一份真进度：逾期 2 天 1 首、3 天后到期 1 首、已牢固 1 首，
     外加**逾期 9 天 1 首** —— 它是 #119 那个 bug 的触发条件：
     有 backlog 时，原先的汇总行把 backlog 并进了「今天」，
     与日历「今天」那一格的数对不上（详见下面那几条断言）。 */
  const progress = {};
  progress[all[0].id] = { level: 0, learned: true, nextReviewAt: Date.now() - 2 * DAY2,
    lapses: 0, reviewCount: 1, lastReviewAt: Date.now() - 2 * DAY2, history: [] };
  progress[all[1].id] = { level: 3, learned: true, nextReviewAt: Date.now() + 3 * DAY2,
    lapses: 0, reviewCount: 3, lastReviewAt: Date.now(), history: [] };
  progress[all[2].id] = { level: 9, learned: true, nextReviewAt: Date.now() + 200 * DAY2,
    lapses: 0, reviewCount: 9, lastReviewAt: Date.now(), history: [] };
  progress[all[3].id] = { level: 1, learned: true, nextReviewAt: Date.now() - 9 * DAY2,
    lapses: 0, reviewCount: 2, lastReviewAt: Date.now() - 9 * DAY2, history: [] };

  const dom = openPage(progress);
  const w2 = dom.window;
  w2.scrollTo = function () {};

  setTimeout(() => {
    const d = w2.document;
    const cells = d.querySelectorAll('#progress-calendar .cal-cell');
    chk(cells.length === 14, '日历画了 14 格（实际 ' + cells.length + '）');
    chk(cells[0].textContent.indexOf('今天') >= 0, '第一格写「今天」');
    chk(Number(cells[0].querySelector('.cal-count').textContent) >= 1,
      '今天这一格显示到期的篇数（逾期 2 天那首并进今天）');
    const barH = cells[0].querySelector('.cal-bar i').style.height;
    chk(barH && parseInt(barH, 10) > 0, '今天这一格的竖条画出来了（高度 ' + barH + '）');
    chk(d.querySelectorAll('#progress-calendar .cal-cell.today').length === 1,
      '「今天」这一格被单独标出来');
    chk(cells[3].querySelector('.cal-count').textContent === '1',
      '第 3 天那一格显示 1 首（3 天后到期那首）');
    chk(cells[1].querySelector('.cal-count').textContent === '',
      '没到期的那几天不显数字（空着才是「这天没事」）');

    const mRows = d.querySelectorAll('#progress-mastery .bar-row');
    chk(mRows.length === 5, '掌握度分布画了 5 档（实际 ' + mRows.length + '）');
    // 第 0 阶（新学）那首掌握度 5%、逾期 9 天那首（第 1 阶）掌握度 16% → 都在第一档
    chk(mRows[0].querySelector('.bar-count').textContent === '2',
      '掌握度第一档（0-19%）显示 2 篇（第 0 阶那首 5% + 第 1 阶那首 16%）');
    const lRows = d.querySelectorAll('#progress-levels .bar-row');
    chk(lRows.length === 10, '记忆阶段画了 10 档（实际 ' + lRows.length + '）');
    chk(lRows[lRows.length - 1].querySelector('.bar-count').textContent === '1',
      '「已牢固」那一档显示 1 篇（第 9 阶那首）');

    /* ---- 全部到期篇目：日历那一格的展开 ---- */
    const dueBlocks = d.querySelectorAll('#progress-duelist .duelist-day');
    chk(dueBlocks.length >= 2, '到期篇目清单画出了分档（今天 + 第 3 天；实际 ' +
      dueBlocks.length + ' 档）');
    chk(dueBlocks[0].classList.contains('today'), '第一档是「今天」');
    chk(dueBlocks[0].textContent.indexOf('今天') >= 0, '第一档写着「今天」');
    /* 造的三篇进度：all[0] 逾期 2 天（并进今天）、all[1] 第 3 天到期、
       all[2] 已牢固（第 200 天到期 → 超出窗口，只报个数）。 */
    /* 今天那一档 = 逾期 2 天那 1 篇（逾期 9 天那篇进 backlog，另挂一截 ——
       `.duelist-items.late` 也在 `dueBlocks[0]` 里，所以按「非 late」数）。 */
    chk(dueBlocks[0].querySelectorAll('.duelist-items:not(.late) .duelist-item').length === 1,
      '今天那一档列出逾期一周以内那 1 篇（实际 ' +
      dueBlocks[0].querySelectorAll('.duelist-items:not(.late) .duelist-item').length + '）');
    chk(dueBlocks[0].querySelector('.duelist-due').textContent.indexOf('逾期') >= 0,
      '逾期的那一篇标出「逾期 N 天」（实际「' +
      dueBlocks[0].querySelector('.duelist-due').textContent + '」）');
    const day3 = d.querySelector('#progress-duelist .duelist-day[data-offset="3"]');
    chk(!!day3 && day3.querySelectorAll('.duelist-item').length === 1,
      '第 3 天那一档正是 3 天后到期那一篇');
    chk(day3.querySelector('.duelist-due').textContent.indexOf('还有 3 天') >= 0,
      '第 3 天那一档标出「还有 3 天」');
    /* 与日历对账：日历第 3 格写 1，清单里第 3 档也是 1 篇 */
    chk(d.querySelector('#progress-duelist .duelist-day[data-offset="3"] .duelist-count')
      .textContent === cells[3].querySelector('.cal-count').textContent + ' 篇',
      '清单第 3 档的篇数与日历第 3 格一致（同一本账）');
    /* 篇名可点，回首页去背（这一页只读，不在原地改进度） */
    const dueLink = dueBlocks[0].querySelector('.duelist-item');
    chk(dueLink && /^\/\?poem=/.test(dueLink.getAttribute('href')),
      '篇名是指回首页的链接（/?poem=<id>；这一页只读，不在原地改）');
    chk((d.querySelector('#duelist-note') || {}).textContent.indexOf('更远还有 1 篇') >= 0,
      '超出 14 天窗口的那一篇只报个数（「更远还有 1 篇」，写在脚注里）');
    /* ---- 逾期超过一周的那一篇：单独一截，**不并进**今天的天数 ----
       这是 #119 留下那个 bug 的正面验证：有 backlog 时，
       「今天 N 篇」这个 N 必须仍等于**日历上今天那一格**的数。 */
    const lateHead = d.querySelector('#progress-duelist .duelist-overdue-head');
    chk(!!lateHead && lateHead.textContent.indexOf('逾期超过一周 · 1 篇') >= 0,
      '逾期超过一周的另挂一截「逾期超过一周 · 1 篇」（实际「' +
      (lateHead ? lateHead.textContent : '（没有这一截）') + '」）');
    const lateItems = d.querySelectorAll('#progress-duelist .duelist-items.late .duelist-item');
    chk(lateItems.length === 1 &&
      lateItems[0].getAttribute('href') === '/?poem=' + encodeURIComponent(all[3].id),
      '那一截里列出逾期 9 天那一篇，篇名同样指回首页（实际 ' +
      (lateItems[0] ? lateItems[0].getAttribute('href') : '（没有）') + '）');
    /* 关键对账：页面上今天那一档的表头数 = 日历今天那一格的数
       （backlog 不并进来；并进来就成了「日历 2、清单 3」） */
    const todayBlockHead = dueBlocks[0].querySelector('.duelist-count').textContent;
    chk(todayBlockHead === cells[0].querySelector('.cal-count').textContent + ' 篇',
      '清单「今天」那一档的表头 = 日历「今天」那一格（backlog 不并进今天；实际 ' +
      todayBlockHead + ' / ' + cells[0].querySelector('.cal-count').textContent + ' 篇）');
    /* 汇总行：今天 N 篇 / 逾期超过一周 M 篇 / 未来两周共 T 篇 —— 三项各说一件事，
       「今天 N 篇」里的 N 仍与日历对齐 */
    const sub0 = (d.querySelector('#duelist-sub') || {}).textContent || '';
    chk(sub0.indexOf('今天 ' + cells[0].querySelector('.cal-count').textContent + ' 篇') >= 0,
      '汇总行的「今天 N 篇」与日历今天那一格同数（实际「' + sub0 + '」）');
    chk(sub0.indexOf('逾期超过一周 1 篇') >= 0,
      '汇总行把逾期超过一周的单独说一句，不混进「今天」（实际「' + sub0 + '」）');

    /* 日历格子可点（要跳得下来），且挂着 role=button */
    chk(cells[3].getAttribute('data-offset') === '3' && cells[3].getAttribute('role') === 'button',
      '日历每一格带 data-offset，挂 role=button（点了跳到那一档）');

    const stats = d.querySelectorAll('#progress-stats .stat');
    chk(stats.length === 4, '总览四格（已学 / 待复习 / 平均掌握 / 尚未学过）');
    chk(d.querySelector('#progress-stats').textContent.indexOf('已学') >= 0,
      '四格里第一格是「已学」');
    chk(d.querySelector('#progress-stats').textContent.indexOf('257') >= 0,
      '「尚未学过」= 261 - 4 = 257（实际那一格：' +
      d.querySelectorAll('#progress-stats .stat')[3].textContent + '）');

    /* ---- 这一页只读：不许动进度 ---- */
    chk(w2.localStorage.getItem('poem_recite_progress_v1') === JSON.stringify(progress),
      '进这一页**一个字节都没改进度**（这是「看进度」的地方，不是改的地方）');
    chk(w2.localStorage.getItem('poem_classic_read_v1') === null,
      '不写任何一部的「已读」标记');
    chk(w2.sessionStorage.length === 0,
      '不排今日任务、不写计划缓存（sessionStorage 空）');

    /* ---- 一篇都没学过时：给一句解释，不是白屏 ---- */
    const blank = openPage(null);
    blank.window.scrollTo = function () {};
    setTimeout(() => {
      const db = blank.window.document;
      chk(db.querySelectorAll('#progress-calendar .cal-cell').length === 14,
        '一篇都没学过时日历照样画出来（不是白屏）');
      chk((db.querySelector('#progress-tip') || {}).textContent.indexOf('还没有学习记录') >= 0,
        '一篇都没学过时给一句「还没有学习记录」的说明');
      chk(db.querySelectorAll('#progress-levels .bar-row').length === 10,
        '一篇都没学过时阶段分布也画全 10 档（全 0，图形不塌）');
      chk(db.querySelectorAll('#progress-duelist .duelist-item').length === 0,
        '一篇都没学过时到期篇目清单是空的（不硬凑出几篇）');
      chk((db.querySelector('#progress-duelist .duelist-empty') || {}).textContent
        .indexOf('还没有到期的篇目') >= 0,
        '一篇都没学过时清单给一句说明（不是白屏）');

      /* ---- 入口：设置页进得来、页签「背诵」保持选中 ---- */
      const settingsHtml = fs.readFileSync(path + 'settings/index.html', 'utf8');
      chk(/href="\/progress\/"/.test(settingsHtml),
        '设置页有进「进度总览」的链接（/progress/）');
      // 需求（Issue #122）：标签与按钮都收敛成「进度总览」一个词
      //（原先写「背诵进度」+「看进度总览」，一行里说了两遍同一件事）
      chk(/<label>进度总览<\/label>/.test(settingsHtml),
        '设置页这一项的标签就叫「进度总览」');
      chk(!/背诵进度<\/label>/.test(settingsHtml) && !/看进度总览/.test(settingsHtml),
        '设置页不再出现「背诵进度 · 看进度总览」这组旧文案');
      const chrome = fs.readFileSync(path + 'js/chrome.js', 'utf8');
      chk(/if \(key === "progress"\) return "home";/.test(chrome),
        '进度页的页签选中态落在「背诵」这一格（它就是课内背诵那本账）');
      chk(/data-nav="progress"/.test(html), '进度页 body 上标了 data-nav="progress"');
      chk(/<base href="\/" \/>/.test(html), '进度页带了 <base href="/">（目录化 URL 下的相对资源才解析得对）');
      const sw = fs.readFileSync(path + 'sw.js', 'utf8');
      chk(/\.\/progress\//.test(sw) && /js\/progress\.js/.test(sw),
        '进度页进了 Service Worker 预缓存清单（断网也能看）');

      /* ================= 三、语料订正后的漂移自动刷新 ================= */
      /**
       * 需求（Issue #69 后续，用户原话）：
       *   「首页快照与语料订正的漂移自动刷新（现在只在打开集子页/搜索页时才刷新）」
       *
       * 上一轮只做到「首页启动刷一次 + 课外那些标 stale 等下次进集子页」——
       * 而**用户在首页停留的整个会话里都不会经过集子页**，于是那一篇可能
       * 连着好几天显示旧题名。这一层验的就是补上的那半条：首页自己按需把
       * 那一部集子的数据文件拉回来刷新，不必等用户去开别的页面。
       */
      const appSrc4 = fs.readFileSync(path + 'js/app.js', 'utf8');
      chk(/function backfillSnapshots\(/.test(appSrc4),
        '首页启动时仍会刷新一次快照（课内那几条就地更新）');
      chk(/function refreshStaleSnapshots\(/.test(appSrc4),
        '首页有「按需拉回集子数据、刷新旧快照」的入口 refreshStaleSnapshots()');
      chk(/function staleByBook\(/.test(appSrc4),
        '按集子把还旧着的快照挑出来（staleByBook）');
      chk(/refreshStaleSnapshots\(\)/.test(appSrc4),
        'refreshStaleSnapshots() 真的挂在启动流程里（不是写了不调）');

      // 一部都没涉及就不许发请求：这是「只拉真正需要的」那一条
      chk(/if \(!books\.length\) return Promise\.resolve\(0\);/.test(appSrc4),
        '没有任何旧快照时不发请求（一部都不涉及就直接返回）');
      chk(/const BOOK_SOURCES = \{/.test(appSrc4) &&
        ['classic', 'tangshi', 'songci', 'guwen', 'zhaoming'].every(b =>
          new RegExp(b + ':').test(appSrc4)),
        '五部集子的数据文件与全局名写死在 BOOK_SOURCES（不 eval 任何东西）');
      chk(/el\.src = src\.file/.test(appSrc4) && /document\.createElement\("script"\)/.test(appSrc4),
        '拉取走的是「新建 <script>」——与页面里那些 <script> 同一条路（同一个 SW 缓存）');
      chk(/\.catch\(function \(\) \{ \/\* 离线 \/ 拉取失败：老快照照常显示 \*\/ \}\)/.test(appSrc4),
        '拉取失败不影响用（离线时老快照照常显示，stale 留着下次再试）');

      // 行为层：真起一个首页，塞一条 stale 的课外快照，看它是否把数据拉回来刷新
      const homeHtml = fs.readFileSync(path + 'index.html', 'utf8');
      const homeOrder = homeHtml.match(/<script src="([^"]+)"><\/script>/g)
        .map(x => x.match(/src="([^"]+)"/)[1]);
      const homeDom = new JSDOM(homeHtml, {
        runScripts: 'dangerously', resources: new RepoLoader(), url: 'https://local.test/'
      });
      const wh = homeDom.window;
      wh.scrollTo = function () {};
      // 塞一条「加入时存的是旧题名」的快照：集子里那一篇后来被订正过。
      // 用真实的唐诗条目（数据文件里查得到），才能验「拉回来之后对得上」。
      const realTitle = '感遇·其一';
      wh.localStorage.setItem('poem_recite_collections_v1', JSON.stringify({
        version: 1,
        collections: [{
          id: 'c-stale', name: '漂移测试', createdAt: Date.now(),
          items: [{
            id: 'tangshi-ts-1',
            snap: {
              title: '感遇（旧题名）', author: '张九龄', dynasty: '唐',
              source: '《唐诗三百首》', selection: '《唐诗三百首》',
              book: 'tangshi', bookName: '唐诗三百首', page: '/tangshi/',
              text: '孤鸿海上来，池潢不敢顾。', translation: '', translationSource: 'public-domain'
            },
            stale: true
          }]
        }]
      }));
      // 首屏先画一遍：这时显示的还是旧快照里的旧题名
      homeOrder.forEach(f => {
        const el = wh.document.createElement('script');
        el.textContent = fs.readFileSync(path + f, 'utf8');
        wh.document.body.appendChild(el);
      });

      setTimeout(() => {
        // 首屏那一帧画的是什么，取决于本地文件回来的快慢（jsdom 里常常几十毫秒
        // 就回来了），所以这里不咬「此刻一定还是旧题名」——那条断言会随机器快慢
        // 抖。只咬真正要守的两条：列表**画出来了**（不是空白），以及刷新之后
        // 跟着**重画成新题名**（下面几行）。
        // ⚠️ 自选清单的界面（列表 / 改名 / 删除 …）Issue #114 第二条起住在
        //   设置整页，首页**不再渲染**它 —— 这一段要验的「首页按需拉回集子数据
        //   刷新旧快照」仍然成立，只是刷新之后不再重画那张清单（它已经不在了）。
        //   所以这里改成：清单容器在首页确实不存在（搬走了），
        //   而快照本身照旧被刷新（下面几条断言）。

        // 再等数据文件拉回来（走的是我们那个 loader → 仓库真实文件）
        setTimeout(() => {
          const snap = JSON.parse(wh.localStorage.getItem('poem_recite_collections_v1'))
            .collections[0].items[0];
          chk(snap.snap && snap.snap.title === realTitle,
            '首页自己把那一部集子拉回来，快照刷成了最新语料（题名 ' +
            (snap.snap && snap.snap.title) + '）');
          chk(snap.snap.text && snap.snap.text.length > 20,
            '刷回来的正文也是完整的（旧快照里那句只有 22 字的残句被换掉）');
          chk(!snap.stale, '刷新成功后 stale 标记被清掉（下次启动就不会再拉一遍）');
          // ⚠️ 自选清单的界面（列表 / 改名 / 删除 …）Issue #114 第二条起住在
          //    设置整页的「我的清单」，首页不再渲染它。这一段要验的
          //    「首页按需拉回集子数据、刷新旧快照」仍然成立 —— 所以
          //    上面几条断言的是**存进去的快照**（localStorage 里那一份），
          //    与界面在哪一页无关。下面再补一条：首页确实不再有那张清单。
          chk(wh.document.querySelector('#collections-list') === null,
            '首页不再渲染自选清单（那一块搬去了设置整页，不带半截残留）');
          chk(wh.ReciteCollections.displayTitle(realTitle) === '感遇',
            '显示名照旧去掉「其一 / 其二」（这一段与界面搬不搬无关）');

          console.log('\n' + (fails ? '❌ ' + fails + ' 项失败' : '🎉 背诵进度可视化测试全部通过'));
          process.exit(fails ? 1 : 0);
        }, 900);
      }, 200);
    }, 200);
  }, 200);
}, 200);
