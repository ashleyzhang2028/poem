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

const files = ['data/text-master',
  'data/poems-1','data/poems-2','data/poems-3','data/poems-4','data/poems-5','data/poems-6',
  'data/poems-7','data/poems-8','data/poems-9','data/poems-10','data/poems-11','data/poems-12','data/index',
  'js/storage','js/scheduler'];
files.forEach(f => vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', f + '.js'), 'utf8'), sandbox, { filename: f }));

const { Scheduler, Storage } = sandbox;
let fails = 0;
function assert(c, m) { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); }

assert(sandbox.POEMS_ALL.length === 251, '诗词总数 251（实际 ' + sandbox.POEMS_ALL.length + '）');
const ids = new Set();
sandbox.POEMS_ALL.forEach(p => { if (ids.has(p.id)) throw new Error('重复 id ' + p.id); ids.add(p.id); });
assert(true, '诗词 id 无重复');

const plain = s => String(s || '').replace(/\s/g, '');
const noTrans = sandbox.POEMS_ALL.filter(p => !plain(p.translation));
assert(noTrans.length === 0,
  '全库译文齐全（缺 ' + noTrans.length + ' 首：' + noTrans.map(p => p.id).join(',') + '）');

const thinTrans = sandbox.POEMS_ALL.filter(p => {
  const tl = plain(p.translation).length, xl = plain(p.text).length;
  const need = xl <= 40 ? 0.9 : xl <= 120 ? 0.85 : 0.7;
  return tl < 20 || tl < xl * need;
});
assert(thinTrans.length === 0,
  '没有译文过短的篇目（可疑 ' + thinTrans.length + ' 首：' + thinTrans.map(p => p.id).join(',') + '）');

const copyTrans = sandbox.POEMS_ALL.filter(p => plain(p.translation) === plain(p.text));
assert(copyTrans.length === 0, '译文中没有与原文完全相同的（' + copyTrans.map(p => p.id).join(',') + '）');

const trOf = t => sandbox.POEMS_ALL.filter(p => p.title === t).map(p => p.translation);
assert(trOf('题西林壁').length && trOf('题西林壁').every(t => t.includes('庐山')),
  '《题西林壁》译文点出「庐山」');
assert(trOf('岳阳楼记').every(t => t.includes('先天下之忧而忧') || t.includes('天下人忧愁')),
  '《岳阳楼记》译文含「先天下之忧而忧」的名句意译');
assert(trOf('琵琶行').every(t => t.includes('天涯')), '《琵琶行》译文含「同是天涯沦落人」');
assert(trOf('琵琶行并序').length === 0 || trOf('琵琶行并序').every(t => t.includes('浔阳江')),
  '《琵琶行并序》译文含「浔阳江」');

const SRC_KEYS = Object.keys(sandbox.TRANSLATION_SOURCES || {});
assert(SRC_KEYS.length === 4, '译文来源口径共 4 类（实际 ' + SRC_KEYS.join('/') + '）');
const noSrc = sandbox.POEMS_ALL.filter(p => !plain(p.translation) ? false : !p.translationSource);
assert(noSrc.length === 0,
  '全库每首译文都标了来源（缺 ' + noSrc.length + ' 首：' + noSrc.map(p => p.id).join(',') + '）');
const badSrc = sandbox.POEMS_ALL.filter(p => p.translationSource && SRC_KEYS.indexOf(p.translationSource) < 0);
assert(badSrc.length === 0,
  '译文来源取值都在允许范围（异常 ' + badSrc.length + ' 首：' + badSrc.map(p => p.id + ':' + p.translationSource).join(',') + '）');

assert(sandbox.POEMS_ALL.every(p => (sandbox.translationSourceText(p) || '').length > 10),
  '每首都取得到一句可读的来源说明（译文框下方会照实显示）');

assert(sandbox.POEMS_ALL.every(p => p.translationSource !== 'public-domain'),
  '课内诗词不得标 public-domain（公有领域只用于小古文一类的古代文本整理）');
assert(sandbox.POEMS_ALL.filter(p => p.dynasty !== '现代').every(p => p.translationSource !== 'modern'),
  '非现代作品不得标 modern');

const MODERN_SET = ['沁园春·雪', '我爱这土地', '乡愁', '沁园春·长沙'];
assert(sandbox.POEMS_ALL.filter(p => MODERN_SET.indexOf(p.title) > -1)
  .every(p => p.translationSource === 'modern'),
  '初高中现代作品（' + MODERN_SET.join(' / ') + '）标 modern，不冒充公有领域也不含糊说课内');
assert(sandbox.POEMS_ALL.filter(p => p.dynasty === '现代' && MODERN_SET.indexOf(p.title) < 0)
  .every(p => p.translationSource === 'school'),
  '小学课内的毛泽东诗词标 school（译文只讲字面，与小学课本口径一致）');
assert(sandbox.POEMS_ALL.filter(p => p.title === '观沧海' || p.title === '琵琶行并序')
  .every(p => p.translationSource === 'academic'),
  '鉴赏辞典收录的名家名篇标 academic（观沧海 / 琵琶行并序）');

const gradeCount = g => sandbox.POEMS_ALL.filter(p => p.grade === g).length;
assert([1,2,3,4,5,6].map(gradeCount).reduce((a,b)=>a+b,0) === 119,
  '小学共 119 首（实际 ' + [1,2,3,4,5,6].map(gradeCount).reduce((a,b)=>a+b,0) + '）');
assert(gradeCount(1) === 13 && gradeCount(2) === 14 && gradeCount(3) === 17 &&
  gradeCount(4) === 23 && gradeCount(5) === 23 && gradeCount(6) === 29,
  '各年级首数：一 13 / 二 14 / 三 17 / 四 23 / 五 23 / 六 29（实际 ' +
  [1,2,3,4,5,6].map(gradeCount).join(' / ') + '）');

const REQUIRED = [
  ['画鸡', 1, 2, '唐寅'], ['汉江临泛', 4, 1, '王维'], ['鹿柴', 4, 1, '王维'],

  ['秋夜将晓出篱门迎凉有感', 4, 2, '陆游'],
  ['嫦娥', 4, 1, '李商隐'], ['竹枝词', 4, 2, '刘禹锡'], ['芙蓉楼送辛渐', 4, 2, '王昌龄'],
  ['黄鹤楼送孟浩然之广陵', 4, 2, '李白'], ['渔歌子', 5, 1, '张志和'], ['观书有感（其一）', 5, 1, '朱熹'],
  ['长歌行', 5, 2, '汉乐府'], ['赴戍登程口占示家人', 5, 2, '林则徐'], ['送元二使安西', 5, 2, '王维'],
  ['寒菊', 5, 2, '郑思肖'], ['乡村四月', 5, 2, '翁卷'], ['过故人庄', 6, 1, '孟浩然'],
  ['七律·长征', 6, 1, '毛泽东'], ['春日', 6, 1, '朱熹'], ['天净沙·秋思', 6, 2, '马致远'],
  ['过零丁洋', 6, 2, '文天祥'], ['马诗', 6, 2, '李贺'], ['采薇（节选）', 6, 2, '佚名'],
  ['春夜喜雨', 6, 2, '杜甫'], ['江畔独步寻花（其六）', 6, 1, '杜甫'], ['早春呈水部张十八员外', 6, 2, '韩愈'],
  ['江上渔者', 6, 2, '范仲淹'], ['泊船瓜洲', 6, 2, '王安石']
];
let reqOk = true;
REQUIRED.forEach(function (r) {
  const hit = sandbox.POEMS_ALL.find(function (p) { return p.title === r[0]; });
  if (!hit) { reqOk = false; console.log('  缺篇目：' + r[0]); return; }
  if (hit.grade !== r[1] || hit.term !== r[2]) {
    reqOk = false; console.log('  ' + r[0] + ' 年级学期错：' + hit.grade + '-' + hit.term + '，期望 ' + r[1] + '-' + r[2]);
  }
  if (r[3] && hit.author !== r[3]) {
    reqOk = false; console.log('  ' + r[0] + ' 作者错：' + hit.author + '，期望 ' + r[3]);
  }
});
assert(reqOk, '按清单补齐的篇目都在标注的年级学期上');

const dupKey = {};
let dupHit = [];
sandbox.POEMS_ALL.forEach(function (p) {
  const k = p.grade + '-' + p.term + '-' + p.title;
  if (dupKey[k]) dupHit.push(k);
  dupKey[k] = 1;
});
assert(dupHit.length === 0, '同一学期内无重复篇目（' + (dupHit.join('、') || '无') + '）');

assert(JSON.stringify(Scheduler.INTERVALS) === JSON.stringify([0,1,2,4,7,15,30,60,120,240]), '遗忘曲线间隔序列正确');

let rec = Scheduler.createRecord();
for (let i = 0; i < 3; i++) rec = Scheduler.review(rec, 'good');
assert(rec.level === 3, '连续记住 3 次 → level=3（实际 ' + rec.level + '）');

const DAY = 86400000;
const targetDay = (function () {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime() + 4 * DAY + 9 * 60 * 60 * 1000;
})();
assert(Math.abs(rec.nextReviewAt - targetDay) < 1000, '下次复习约 4 天后');

let r2 = Scheduler.createRecord();
r2 = Scheduler.review(r2, 'good');
const lv = r2.level;
r2 = Scheduler.review(r2, 'fuzzy');
assert(r2.level === lv, '模糊不升级');
assert(r2.nextReviewAt > Date.now() && r2.nextReviewAt < Date.now() + 13*3600000, '模糊 12 小时后再复习');

let r3 = Scheduler.createRecord();
r3 = Scheduler.review(r3, 'good');
r3 = Scheduler.review(r3, 'good');
const before = r3.level;
r3 = Scheduler.review(r3, 'bad');
assert(r3.level === before - 1, '忘记降一级（' + before + '→' + r3.level + '）');
assert(r3.lapses === 1, '记录遗忘次数');
assert(r3.nextReviewAt < Date.now() + 31*60000, '30 分钟后再复习');

const plan = Scheduler.generateDailyPlan({
  grade: 1, term: 1, count: 5,
  provider: sandbox.getPoemsByGradeTerm,
  getRecord: id => Storage.get(id)
});
assert(plan.length === 5, '一年级上学期计划 5 首（实际 ' + plan.length + '）');
assert(plan.every(x => x.reason === 'new'), '全新用户全部为新学');

plan.forEach(it => Storage.set(it.poem.id, Scheduler.review(Scheduler.createRecord(), 'good')));
const plan2 = Scheduler.generateDailyPlan({
  grade: 1, term: 1, count: 5,
  provider: sandbox.getPoemsByGradeTerm,
  getRecord: id => Storage.get(id)
});
assert(plan2.length === 5, '第二天仍生成 5 首');

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

let ok = true;
for (let g = 1; g <= 12; g++) for (let t = 1; t <= 2; t++) {
  const pl = Scheduler.generateDailyPlan({ grade: g, term: t, count: 5, provider: sandbox.getPoemsByGradeTerm, getRecord: id => Storage.get(id) });
  if (pl.length !== 5) { ok = false; console.log('  年级', g, t, '只有', pl.length, '首'); }
}
assert(ok, '全部 24 个年级/学期组合均能生成 5 首计划');

assert(Scheduler.mastery(null) === 0, '未学掌握度 0');
let r4 = Scheduler.createRecord();
for (let i = 0; i < 9; i++) r4 = Scheduler.review(r4, 'good');
assert(Scheduler.mastery(r4) === 100, '全阶段掌握度 100（实际 ' + Scheduler.mastery(r4) + '）');

Storage.clear();
const crossPoem = sandbox.getPoemsByGradeTerm(10, 1)[0];
const rc = Scheduler.review(Scheduler.createRecord(), 'good');
rc.nextReviewAt = Date.now() - 1000;
Storage.set(crossPoem.id, rc);
const planHigh = Scheduler.generateDailyPlan({ grade: 12, term: 2, count: 5, provider: sandbox.getPoemsByGradeTerm, getRecord: id => Storage.get(id) });
assert(planHigh.some(x => x.poem.id === crossPoem.id), '跨年级到期诗会进入今日复习');

const scopeCases = [
  { scope: 'term', label: '本册', ok: p => p.grade === 1 && p.term === 1 },
  { scope: 'upto', label: '本册及之前', ok: p => p.grade === 1 && p.term === 1 },
  { scope: 'primary', label: '小学随机', ok: p => p.grade <= 6 },
  { scope: 'middle', label: '初中随机', ok: p => p.grade >= 7 && p.grade <= 9 },
  { scope: 'primary_middle', label: '小学+初中随机', ok: p => p.grade <= 9 },
  { scope: 'high', label: '高中随机', ok: p => p.grade >= 10 },
  { scope: 'all', label: '全部随机', ok: () => true }
];
assert(Object.keys(Scheduler.SCOPES).length === 7, '背诵范围共 7 个选项');
Storage.clear();
scopeCases.forEach(c => {
  const pl = Scheduler.generateDailyPlan({
    grade: 1, term: 1, count: 5, scope: c.scope,
    provider: sandbox.getPoemsByGradeTerm, getRecord: id => Storage.get(id)
  });
  assert(pl.length === 5 && pl.every(x => c.ok(x.poem)), c.label + ' 范围生成 5 首且内容在范围内');
});

const uptoHigh = Scheduler.poolForScope({ grade: 12, term: 2, scope: 'upto' });
assert(uptoHigh.length === 251, '本册及之前（高三下）= 全部 251 首（实际 ' + uptoHigh.length + '）');

let seenGrades = new Set();
for (let i = 0; i < 30; i++) {
  Scheduler.generateDailyPlan({
    grade: 1, term: 1, count: 8, scope: 'primary',
    provider: sandbox.getPoemsByGradeTerm, getRecord: () => null
  }).forEach(x => seenGrades.add(x.poem.grade));
}
assert(seenGrades.size > 1, '小学随机范围会跨年级抽取（出现 ' + seenGrades.size + ' 个年级）');

Storage.clear();
const legacyPlan = Scheduler.generateDailyPlan({
  grade: 3, term: 2, count: 5,
  provider: sandbox.getPoemsByGradeTerm, getRecord: id => Storage.get(id)
});
assert(legacyPlan.every(x => x.poem.grade === 3 && x.poem.term === 2), '不传 scope 默认本年级本学期');

Storage.clear();
Storage.set('x', Scheduler.createRecord());
assert(!!Storage.get('x'), 'localStorage 读写正常');
const json = Storage.exportJSON();
Storage.clear();
Storage.importJSON(json);
assert(!!Storage.get('x'), '备份导出/导入正常');

console.log(fails === 0 ? '\n🎉 全部测试通过' : '\n❌ ' + fails + ' 项失败');
process.exit(fails ? 1 : 0);
