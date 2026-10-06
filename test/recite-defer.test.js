/* 「以后再背」（Issue #481）
   ---------------------------------------------------------------------------
   用户原话：
     「背诵列表，在播放键的右侧加一个以后再背的按钮……当用户点击该按钮后，
       该诗在用户背诵范围内在当前的背诵算法下，推迟延后列出。
       当用户点击一次以后再背按钮减掉一个古诗后，自动在背诵列表的最后补上
       一篇古诗，用以满足每日背诵数量的需求。」

   两件事，一行一条：
     ① 点一下 = 这一首从今天的计划里下去，**顺延一天**（明天照旧上榜）；
        进度一格不动 —— 它是「今天不背」，不是「没背过」。
     ② 下去一首，末尾补一首：总数还是每日数量（这里取 5）。

   界面层已按 Issue #278 删除，所以这里跑**真数据 + 真算法**（scheduler 与
   两份新脚本都在 vm 沙盒里），只做静态判据的地方另行标注。
   --------------------------------------------------------------------------- */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };
const eq = (a, b, m) => chk(a === b, m + '（实际 ' + JSON.stringify(a) + '）');

function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }

/* ---------- 沙盒：真数据 + 真算法 ---------- */
const store = {};
const ss = {};
const sandbox = {
  console,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: i => Object.keys(store)[i]
  },
  sessionStorage: {
    getItem: k => (k in ss ? ss[k] : null),
    setItem: (k, v) => { ss[k] = String(v); },
    removeItem: k => { delete ss[k]; },
    get length() { return Object.keys(ss).length; },
    key: i => Object.keys(ss)[i]
  },
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  Date: Date,
  Math: Math,
  JSON: JSON,
  Object: Object,
  Array: Array,
  String: String,
  Number: Number,
  isFinite: isFinite,
  Promise: Promise,
  CustomEvent: function (t, o) { this.type = t; this.detail = (o || {}).detail; },
  dispatchEvent: function () { return true; },
  addEventListener: function () {}
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.dispatchEvent = sandbox.dispatchEvent;
sandbox.window.addEventListener = sandbox.addEventListener;
vm.createContext(sandbox);

['data/text-master', 'data/poems-1', 'data/poems-2', 'data/poems-3', 'data/poems-4',
  'data/poems-5', 'data/poems-6', 'data/poems-7', 'data/poems-8', 'data/poems-9',
  'data/poems-10', 'data/poems-11', 'data/poems-12', 'data/index', 'data/works-index',
  'js/storage', 'js/review-models', 'js/scheduler', 'js/recite-defer', 'js/today-plan']
  .forEach(f => vm.runInContext(read(f + '.js'), sandbox, { filename: f }));

const { Scheduler, Storage, ReciteDefer, TodayPlan, POEMS_ALL } = sandbox;

/* 首页那一套：等级学期、范围、每日数量 */
const SETTINGS = { grade: 3, term: 1, dailyCount: 5, scope: 'upto' };
const getRecord = id => Storage.get(id);

function plan() {
  const msgs = [];
  const out = TodayPlan.arrange({
    grade: SETTINGS.grade,
    term: SETTINGS.term,
    count: SETTINGS.dailyCount,
    scope: SETTINGS.scope,
    provider: sandbox.getPoemsByGradeTerm,
    getRecord: getRecord,
    extraPoems: []
  }, { provider: sandbox.getPoemsByGradeTerm });
  void msgs;
  return out;
}

const idsOf = p => p.map(it => it.poem.id);

// 排期那一趟的 filter（与 TodayPlan.plan 里那条一字不差）
const filterSees = p => !TodayPlan.heldToday(p, { provider: sandbox.getPoemsByGradeTerm }, getRecord);

console.log('');
console.log('=== 一、点名的那一首从今天的计划里下去（顺延一天） ===');

let p1 = plan();
eq(p1.length, 5, '起手排 5 首（每日数量）');
const first = p1[0].poem;
chk(!!ReciteDefer, 'js/recite-defer.js 在（名单有地方落）');
chk(ReciteDefer.days(first) === 0, '还没点过，「延后天数」是 0');

const r = ReciteDefer.defer(first);
chk(r.ok && r.added, '点了「以后再背」，记下来了');
chk(ReciteDefer.days(first) === 1, '这一首延后 1 天');
chk(ReciteDefer.holdToday(first, getRecord), '今天压着不排');
chk(ReciteDefer.deferredToday(first), '同一天点第二次只算一次');
ReciteDefer.defer(first);
chk(ReciteDefer.days(first) === 1, '同一天点两次还是 1 天（不叠加）');

let p2 = plan();
chk(idsOf(p2).indexOf(first.id) < 0, '重排后它不在今天的计划里了');
eq(p2.length, 5, '总数照旧 5 首');

// 作品粒度：课内的同一首在别处（集子）是另一个 entry id，但算同一份
const wid = ReciteDefer.widOf(first.id);
chk(!!wid, '拿得到作品号（' + wid + '）');
const sameWork = POEMS_ALL.filter(x => ReciteDefer.widOf(x.id) === wid);
chk(sameWork.every(x => ReciteDefer.holdToday(x, null)),
  '同一份作品换一个 entry id 也认（' + sameWork.length + ' 个别名）');

console.log('');
console.log('=== 二、减掉一首，末尾补一首（要的还是每日数量） ===');

const before = idsOf(p1);
const after = idsOf(p2);
chk(after.length === before.length, '下去一首、补上来一首，首数不变');
chk(before.indexOf(after[after.length - 1]) < 0,
  '末尾那一首是**新补的**（不是原来计划里的人）');
const kept = before.filter(id => id !== first.id);
const overlap = after.filter(id => kept.indexOf(id) >= 0);
chk(overlap.length === 4, '原来的另外 4 首还在（补位只补那一个空）');
const added = after.filter(id => before.indexOf(id) < 0);
eq(added.length, 1, '只补了 1 首');
chk(!added.some(id => ReciteDefer.holdToday(id, null)), '补上来那一首自己没被延后过');

console.log('');
console.log('=== 三、延后不是「学过了」：进度一格不动 ===');

ReciteDefer.clear();
Storage.clear();
chk(!Storage.get(first.id), '这一首在进度里还是空的（没被写成学过了）');
ReciteDefer.defer(first);
ReciteDefer.undo(first);
chk(ReciteDefer.days(first) === 0, '撤销今天这一次，延后台账清了');

// 今天已经背掉的：即使被点过也不能从计划里掉（否则环形进度会掉数）
const done = sandbox.POEMS_ALL.filter(x => x.id === 'xx3-02')[0];
chk(!!done, '拿得到用来试「今天背过的」那一首（xx3-02）');
Storage.set(done.id, Scheduler.review(Storage.get(done.id), 'good'));
ReciteDefer.defer(done);
chk(ReciteDefer.days(done) === 1, '确实点过了（台账里有它）');
chk(!ReciteDefer.holdToday(done, getRecord(done.id)), '今天背过的压不住（holdToday 放行）');
chk(!TodayPlan.heldToday(done, {}, getRecord), '排期那一道 filter 也放行（不会把它当延后的滤掉）');
chk(filterSees(done), '这一首照旧进得了候选池 —— 它是被「今天背过了」挡下的，不是被延后挡下的');

console.log('');
console.log('=== 四、顺延是「明天照旧」，不是拉黑 ===');

ReciteDefer.clear();
const later = 24 * 60 * 60 * 1000;
const tomorrow = Date.now() + later;
const one = sandbox.POEMS_ALL.filter(x => x.id === 'xx3-01')[0];
ReciteDefer.defer(one);
chk(ReciteDefer.holdToday(one, null), '今天压着');
chk(!ReciteDefer.holdToday(one, null, tomorrow), '第二天它自己回来了（不再压着）');

// 连点两天 = 顺延两天
ReciteDefer.defer(one, tomorrow);
chk(ReciteDefer.days(one) === 2, '第二天再点一次，共 2 天');
chk(ReciteDefer.holdToday(one, null, tomorrow), '第二天点了，第二天仍压着');
ReciteDefer.undo(one, tomorrow);
chk(ReciteDefer.days(one) === 1, '撤掉第二天那一次，回到 1 天');

console.log('');
console.log('=== 五、名单落盘、可清、能上云 ===');

ReciteDefer.clear();
const one2 = sandbox.POEMS_ALL.filter(x => x.id === 'xx3-01')[0];
const two2 = sandbox.POEMS_ALL.filter(x => x.id === 'xx3-02')[0];
ReciteDefer.defer(one2);

chk(ReciteDefer.physKey() === 'poem_recite_defer_v1', '名单落在 localStorage 的 poem_recite_defer_v1');
chk(JSON.parse(store['poem_recite_defer_v1']).items.length === 1, '那一份就是刚才那一条');
const row = ReciteDefer.cloudRow({});
chk(!!row && row.id === 'defer:v1' && row.updatedAt > 0, '推得出一行 defer:v1 给同步层');
eq(Object.keys(row.payload.items[0]).sort().join(','), 'at,day,wid',
  '只带作品号与日期（不带正文、不带进度）');

// 从云端来一份（另一台设备上点了另一首）
const today = new Date();
const dayStr = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
const remote = {
  id: 'defer:v1',
  updatedAt: (row.updatedAt || Date.now()) + 1000,
  deleted: false,
  payload: { v: 1, updatedAt: row.updatedAt + 1000, items: [
    { wid: ReciteDefer.widOf(two2.id), day: dayStr, at: Date.now() }
  ] }
};
const verdict = ReciteDefer.applyCloud(remote, {});
eq(verdict, 'applied', '云端那一条并进来了');
chk(ReciteDefer.days(two2) >= 1, '另一台设备上点的那一首，这一台也认');
chk(ReciteDefer.days(one2) === 1, '本机原来那条没被冲掉（并集）');

chk(ReciteDefer.clear() >= 1, '「清空进度」连带清掉延后台账');
eq(ReciteDefer.count(), 0, '清完是空的');

console.log('');
console.log('=== 六、补位要过集子自己的口径（不补「整部书」那种行） ===');

// 早先的实现会从课外捞回来一条 SITE_INDEX 上 `isBook: true` 的行
// （名著导读里「整部书」那一条），列表不认它 —— 等于空补一首。
const bookRow = { id: 'mingshu-x-book', title: '某部书', book: 'mingshu', isBook: true };
chk(TodayPlan.isBookRow(bookRow), 'isBook 的行认得出来');
chk(!TodayPlan.isBookRow({ id: 'poems-1a', title: '静夜思' }), '普通的行不是');

// conform：把一部的条目按它自己的 config 走一遍（简化 + 规范化 + 不出展的标记）
const cfg = {
  simplify: function (p) {
    return Object.assign({}, p, { title: p.title + '（简）' });
  },
  canonical: function (id) { return id; },
  isListed: function (p) { return p.id !== 'hidden-1'; }
};
const c1 = TodayPlan.conform({ id: 'x-1', title: '甲', text: '甲｜乙\n丙｜丁' }, cfg);
eq(c1.title, '甲（简）', 'simplify 过了');
chk(!TodayPlan.isBookRow(c1), '展得出的行照旧可用');
const c2 = TodayPlan.conform({ id: 'hidden-1', title: '乙' }, cfg);
chk(TodayPlan.isBookRow(c2), '这一部不出展的行被标上 isBook（补位不会捞它）');

const base = TodayPlan.baseOf();
chk(base.length >= 200, '补位的池子是「课内主表 + 全站目录」（' + base.length + ' 行）');
chk(base.every(p => !TodayPlan.isBookRow(p)), '池子里一条 isBook 的行都没有');
chk(new Set(base.map(p => p.id)).size === base.length, '池子里没有重复 id');
chk(base.some(p => p.grade === 3 && p.term === 1), '课内那几首在里面（补位能找到本学期的）');

console.log('');
console.log('=== 七、静态判据：按钮真在播放键右侧 ===');

const appSrc = read('js/app.js');
const css = read('css/style.css');
chk(/item-read/.test(appSrc) && /item-later/.test(appSrc), '两颗粒按钮都在（朗读 + 以后再背）');
chk(appSrc.indexOf('class="item-read"') < appSrc.indexOf('class="item-later"'),
  '「以后再背」排在播放键**右侧**');
chk(/deferToday\(p, laterBtn\)/.test(appSrc), '点它走 deferToday');
chk(/item-later/.test(css), 'CSS 里给它定了样式（不是让浏览器摆烂）');
chk(/\.item-later\s*\{[\s\S]{0,400}?width:\s*var\(--item-btn\)/.test(css),
  '与朗读键同一个尺寸（一排圆键）');
const laterGlyphSrc = appSrc.slice(appSrc.indexOf('function laterGlyph()'), appSrc.indexOf('function playGlyph()'));
chk(/<svg/.test(laterGlyphSrc), '「以后再背」用的是 SVG 图标（不是字符 / emoji）');
chk(laterGlyphSrc.indexOf('d="M4.2 10.2h15.6') > 0, '图是日历（日子照走）而不是叉 / 垃圾桶（不是拉黑）');
chk(/#today-list \.item-main \{ flex: 0 1 auto; \}/.test(css),
  '今日列表先压正文、再给两颗键让位（窄屏不折行）');

console.log('');
if (fails) { console.log('失败 ' + fails + ' 项'); process.exit(1); }
console.log('✓ recite-defer.test.js 全通过');
