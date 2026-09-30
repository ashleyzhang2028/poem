/* 今日背诵进度：加背一首之后，已经背过的不能掉（Issue #370）
   ---------------------------------------------------------------------------
   用户反馈：进度 3/6，在「今日加背」里添一首，进度变成 0/7 —— 按说是 3/7。

   根因在计划的**重建**：加背会换掉计划缓存的 key，于是 generateDailyPlan 从头
   再算一遍。今天背过的那几首 nextReviewAt 已经跳到了明天，isDue 为假，于是被
   排除在计划之外，空出的位置又拿全新诗词补上 —— 分母 6→7 是对的，分子 3→0 是错的。

   修法：重建计划时把今天**已经背过**的条目接回计划里（占回名额，不额外膨胀）。
   这里直接从 js/app.js 里取 pinTodayDone 的实现来跑，钉住「分子不掉」这条不变量。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const appSrc = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');

/* 把 pinTodayDone 那一段（连同它依赖的小工具）从 app.js 原样抠出来跑，
   避免测试里再抄一份实现 —— 抄的那份永远不会跟产品一起坏。 */
function extract(name) {
  const at = appSrc.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('app.js 里找不到 ' + name + '()');
  let i = appSrc.indexOf('{', at);
  let depth = 0;
  for (let j = i; j < appSrc.length; j += 1) {
    if (appSrc[j] === '{') depth += 1;
    else if (appSrc[j] === '}') { depth -= 1; if (!depth) return appSrc.slice(at, j + 1); }
  }
  throw new Error(name + ' 括号不配对');
}

const store = {};
const sandbox = {
  window: {},
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  console
};
sandbox.window = sandbox;
vm.createContext(sandbox);

['data/text-master', 'data/poems-1', 'data/poems-2', 'data/poems-3', 'data/poems-4',
  'data/poems-5', 'data/poems-6', 'data/poems-7', 'data/poems-8', 'data/poems-9',
  'data/poems-10', 'data/poems-11', 'data/poems-12', 'data/index',
  'js/storage', 'js/review-models', 'js/scheduler', 'js/daily-extra']
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f + '.js'), 'utf8'), sandbox, { filename: f }));

const { Scheduler, Storage, DailyExtra } = sandbox;

/* 首页里 pinTodayDone 用的这几样，等价地在这儿搭一份 */
sandbox.getRecord = id => Storage.get(id);
sandbox.widOf = id => id;
sandbox.sameDay = (a, b) => {
  const d1 = new Date(a), d2 = new Date(b);
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
};
sandbox.settings = { grade: 1, term: 1, dailyCount: 6 };
sandbox.todayPlan = [];

vm.runInContext([
  extract('todayDoneOf'),
  extract('pinTodayDone'),
  'window.__pinTodayDone = pinTodayDone;'
].join('\n'), sandbox, { filename: 'app.js:pinTodayDone' });

const pinTodayDone = sandbox.__pinTodayDone;

/* 复刻首页的 withTodayExtra + 计划生成，只为把「加背」这件事摆出来 */
function basePlan() {
  return Scheduler.generateDailyPlan({
    grade: 1, term: 1, count: sandbox.settings.dailyCount, scope: 'upto',
    provider: null, getRecord: sandbox.getRecord, extraPoems: []
  });
}
function withTodayExtra(list) {
  const out = list.slice();
  const seen = {};
  out.forEach(it => { seen[it.poem.id] = true; });
  DailyExtra.poems().forEach(p => {
    if (seen[p.id]) return;
    seen[p.id] = true;
    const rec = sandbox.getRecord(p.id);
    out.push({ poem: p, reason: 'pinned', reviewRound: rec && rec.learned ? rec.level + 1 : 1, lastReviewAt: rec ? rec.lastReviewAt : null });
  });
  return out;
}

/* 用户看到的那个数字：今天背了几首 / 计划几首 */
function progress(plan) {
  const done = plan.filter(it => {
    const rec = sandbox.getRecord(it.poem.id);
    return rec && rec.lastReviewAt && sandbox.sameDay(rec.lastReviewAt, Date.now());
  }).length;
  return done + '/' + plan.length;
}

function rebuild() {
  sandbox.todayPlan = pinTodayDone(withTodayExtra(basePlan()));
  return sandbox.todayPlan;
}

const planIds = () => basePlan().map(it => it.poem.id);
const outsideOf = (set, plan) =>
  sandbox.POEMS_ALL.find(p => !set[p.id] && !plan.some(it => it.poem.id === p.id));

/* ---- 场景重演 ---- */
let plan = rebuild();
chk(progress(plan) === '0/6', '起手 0/6（实际 ' + progress(plan) + '）');

const learned1 = plan.slice(0, 3).map(it => it.poem.id);
plan.slice(0, 3).forEach(it => Storage.set(it.poem.id, Scheduler.review(sandbox.getRecord(it.poem.id), 'good')));
chk(progress(plan) === '3/6', '背完三首 3/6（实际 ' + progress(plan) + '）');

const set1 = {};
planIds().forEach(i => { set1[i] = true; });
const extra = outsideOf(set1, plan);
chk(!!extra, '找得到一首不在今日计划里的诗词来加背');
DailyExtra.add(extra);
plan = rebuild();

chk(progress(plan) === '3/7',
  '加背一首后是 3/7 —— 分子不该掉（实际 ' + progress(plan) + '）');
chk(plan.length === 7, '计划变成 7 首：6 首正课 + 1 首加背（实际 ' + plan.length + '）');
chk(plan.filter(it => it.reason === 'pinned').length === 1, '加背那首挂在 pinned 上');
const doneIds = {};
plan.forEach(it => {
  const rec = sandbox.getRecord(it.poem.id);
  if (rec && rec.lastReviewAt && sandbox.sameDay(rec.lastReviewAt, Date.now())) doneIds[it.poem.id] = true;
});
chk(learned1.every(id => doneIds[id]),
  '背过的三首还在计划里，没被新诗顶掉');

/* 再把加背那首背了 */
const pinned = plan.find(it => it.reason === 'pinned');
Storage.set(pinned.poem.id, Scheduler.review(sandbox.getRecord(pinned.poem.id), 'good'));
plan = rebuild();
chk(progress(plan) === '4/7', '再背掉加背那首 4/7（实际 ' + progress(plan) + '）');

/* 移出加背：已完成的留在计划里，不跟着掉 */
DailyExtra.remove(extra.id);
plan = rebuild();
chk(progress(plan) === '3/6', '移出加背后回 3/6（实际 ' + progress(plan) + '）');

/* 加背不能把正课挤出去。
   先把前一段背掉的加背诗从进度里抹掉，免得它自己也算「今天背过」 */
Storage.clear();
learned1.forEach(id => Storage.set(id, Scheduler.review(null, 'good')));
plan = rebuild();
chk(progress(plan) === '3/6', '清掉加背那首的进度后回到 3/6（实际 ' + progress(plan) + '）');
const keepIds = plan.filter(it => it.reason !== 'pinned').map(it => it.poem.id);
const set2 = {};
planIds().forEach(i => { set2[i] = true; });
const extra2 = outsideOf(set2, plan);
DailyExtra.add(extra2);
plan = rebuild();
const stillDone = plan.filter(it => {
  const rec = sandbox.getRecord(it.poem.id);
  return rec && rec.lastReviewAt && sandbox.sameDay(rec.lastReviewAt, Date.now());
}).map(it => it.poem.id);
chk(learned1.every(id => stillDone.indexOf(id) >= 0),
  '加第二首时已完成的三首仍在（实际 ' + stillDone.length + ' 首已完成）');
chk(stillDone.length === 3, '加第二首后已完成的仍是 3 首，不多算（实际 ' + stillDone.length + '）');
chk(progress(plan) === '3/7', '仍是 3/7（实际 ' + progress(plan) + '）');
chk(keepIds.every(id => plan.some(it => it.poem.id === id)) === false ||
  plan.filter(it => it.reason !== 'pinned').length === 6,
  '正课名额保持 6 首，不被加背挤少（实际 ' + plan.filter(it => it.reason !== 'pinned').length + '）');

console.log(fails ? ('\n失败 ' + fails + ' 条') : '\n✓ today-progress.test.js 全通过');
process.exit(fails ? 1 : 0);
