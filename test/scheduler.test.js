// 模拟浏览器环境
const fs = require('fs');
const vm = require('vm');
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
const files = ['data/poems-1','data/poems-2','data/poems-3','data/poems-4','data/poems-5','data/poems-6',
  'data/poems-7','data/poems-8','data/poems-9','data/poems-10','data/poems-11','data/poems-12','data/index',
  'js/storage','js/scheduler'];
files.forEach(f => vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', f + '.js'), 'utf8'), sandbox, { filename: f }));

const { Scheduler, Storage } = sandbox;
let fails = 0;
function assert(c, m) { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); }

// 1. 数据完整性
assert(sandbox.POEMS_ALL.length === 242, '诗词总数 242（实际 ' + sandbox.POEMS_ALL.length + '）');
const ids = new Set();
sandbox.POEMS_ALL.forEach(p => { if (ids.has(p.id)) throw new Error('重复 id ' + p.id); ids.add(p.id); });
assert(true, '诗词 id 无重复');

// 2. 间隔序列
assert(JSON.stringify(Scheduler.INTERVALS) === JSON.stringify([0,1,2,4,7,15,30,60,120,240]), '艾宾浩斯间隔序列正确');

// 3. 复习升级：good
let rec = Scheduler.createRecord();
for (let i = 0; i < 3; i++) rec = Scheduler.review(rec, 'good');
assert(rec.level === 3, '连续记住 3 次 → level=3（实际 ' + rec.level + '）');
assert(rec.nextReviewAt > Date.now() + 3.5*86400000, '下次复习约 4 天后');

// 4. fuzzy 保持阶段
let r2 = Scheduler.createRecord();
r2 = Scheduler.review(r2, 'good');
const lv = r2.level;
r2 = Scheduler.review(r2, 'fuzzy');
assert(r2.level === lv, '模糊不升级');
assert(r2.nextReviewAt > Date.now() && r2.nextReviewAt < Date.now() + 13*3600000, '模糊 12 小时后再复习');

// 5. bad 降级
let r3 = Scheduler.createRecord();
r3 = Scheduler.review(r3, 'good');
r3 = Scheduler.review(r3, 'good');
const before = r3.level;
r3 = Scheduler.review(r3, 'bad');
assert(r3.level === before - 1, '忘记降一级（' + before + '→' + r3.level + '）');
assert(r3.lapses === 1, '记录遗忘次数');
assert(r3.nextReviewAt < Date.now() + 31*60000, '30 分钟后再复习');

// 6. 每日计划：新用户 5 首全新
const plan = Scheduler.generateDailyPlan({
  grade: 1, term: 1, count: 5,
  provider: sandbox.getPoemsByGradeTerm,
  getRecord: id => Storage.get(id)
});
assert(plan.length === 5, '一年级上学期计划 5 首（实际 ' + plan.length + '）');
assert(plan.every(x => x.reason === 'new'), '全新用户全部为新学');

// 7. 学完后次日仍为 5 首（新诗补充），且到期诗优先
plan.forEach(it => Storage.set(it.poem.id, Scheduler.review(Scheduler.createRecord(), 'good')));
const plan2 = Scheduler.generateDailyPlan({
  grade: 1, term: 1, count: 5,
  provider: sandbox.getPoemsByGradeTerm,
  getRecord: id => Storage.get(id)
});
assert(plan2.length === 5, '第二天仍生成 5 首');

// 8. 把某些诗的下次复习时间设为过去 → 应优先出现
const p1 = sandbox.getPoemsByGradeTerm(1, 1)[0];
const rp = Storage.get(p1.id);
rp.nextReviewAt = Date.now() - 1000;
Storage.set(p1.id, rp);
const plan3 = Scheduler.generateDailyPlan({
  grade: 1, term: 1, count: 5,
  provider: sandbox.getPoemsByGradeTerm,
  getRecord: id => Storage.get(id)
});
assert(plan3[0].poem.id === p1.id && plan3[0].reason === 'review', '到期诗优先出现在第一位');

// 9. 所有 24 个年级学期组合都能生成 5 首
let ok = true;
for (let g = 1; g <= 12; g++) for (let t = 1; t <= 2; t++) {
  const pl = Scheduler.generateDailyPlan({ grade: g, term: t, count: 5, provider: sandbox.getPoemsByGradeTerm, getRecord: id => Storage.get(id) });
  if (pl.length !== 5) { ok = false; console.log('  年级', g, t, '只有', pl.length, '首'); }
}
assert(ok, '全部 24 个年级/学期组合均能生成 5 首计划');

// 10. 掌握度
assert(Scheduler.mastery(null) === 0, '未学掌握度 0');
let r4 = Scheduler.createRecord();
for (let i = 0; i < 9; i++) r4 = Scheduler.review(r4, 'good');
assert(Scheduler.mastery(r4) === 100, '全阶段掌握度 100（实际 ' + Scheduler.mastery(r4) + '）');

// 11. 跨年级复习：高一学过的诗到期后，高三计划里也能出现
Storage.clear();
const crossPoem = sandbox.getPoemsByGradeTerm(10, 1)[0];
const rc = Scheduler.review(Scheduler.createRecord(), 'good');
rc.nextReviewAt = Date.now() - 1000;
Storage.set(crossPoem.id, rc);
const planHigh = Scheduler.generateDailyPlan({ grade: 12, term: 2, count: 5, provider: sandbox.getPoemsByGradeTerm, getRecord: id => Storage.get(id) });
assert(planHigh.some(x => x.poem.id === crossPoem.id), '跨年级到期诗会进入今日复习');

// 12. 持久化
Storage.clear();
Storage.set('x', Scheduler.createRecord());
assert(!!Storage.get('x'), 'localStorage 读写正常');
const json = Storage.exportJSON();
Storage.clear();
Storage.importJSON(json);
assert(!!Storage.get('x'), '备份导出/导入正常');

console.log(fails === 0 ? '\n🎉 全部测试通过' : '\n❌ ' + fails + ' 项失败');
process.exit(fails ? 1 : 0);
