
const fs = require('fs');
const vm = require('vm');
const path = __dirname + '/../';

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const APP_JSON = 'data/poems-1.js,data/poems-2.js,data/poems-3.js,data/poems-4.js,data/poems-5.js,' +
  'data/poems-6.js,data/poems-7.js,data/poems-8.js,data/poems-9.js,data/poems-10.js,data/poems-11.js,' +
  'data/poems-12.js,data/index.js';

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

  overdue3: { level: 0, learned: true, nextReviewAt: today0 - 3 * DAY, lapses: 0, reviewCount: 1 },

  overdue9: { level: 1, learned: true, nextReviewAt: today0 - 9 * DAY, lapses: 0, reviewCount: 1 },

  due0: { level: 2, learned: true, nextReviewAt: today0 + 3600000, lapses: 0, reviewCount: 2 },

  due3: { level: 3, learned: true, nextReviewAt: today0 + 3 * DAY, lapses: 0, reviewCount: 3 },

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

chk(o.calendar.every(d => d.offset >= 0), '日历的格一律是非负偏移（逾期不画成负日期）');
chk(o.calendar[0].due === true, '今天这一格标了 due（页面上要把「今天」描一道边）');

const sumBuckets = o.masteryBuckets.reduce((a, b) => a + b, 0);
chk(o.masteryBuckets.length === 5, '掌握度分五档（0-19 / 20-39 / 40-59 / 60-79 / 80-100）');
chk(sumBuckets === o.learned, '五档之和 = 已学数（实际 ' + sumBuckets + ' / ' + o.learned + '）');
chk(o.avgMastery >= 0 && o.avgMastery <= 100, '平均掌握度在 0-100 之间（实际 ' + o.avgMastery + '）');

chk(o.levelCounts.length === S.INTERVALS.length, '记忆阶段十档（与复习间隔同长）');
chk(o.levelCounts[0].name === '新学' &&
  o.levelCounts[o.levelCounts.length - 1].name === '已牢固',
  '阶段名沿用 levelName()（首档「新学」、末档「已牢固」）');
chk(o.levelCounts.reduce((a, l) => a + l.count, 0) === o.learned,
  '各阶段之和 = 已学数');

chk(S.daysUntilDue(recs.due3) === 3, '「还有几天到期」算得准（第 3 天 → 3）');
chk(S.daysUntilDue(recs.overdue3) === -3, '已逾期的返回负数（页面据此显示「已到期」）');
chk(S.daysUntilDue(null) === null, '没学过（无档案）返回 null，不冒充 0');
chk(S.daysUntilDue({ learned: false }) === null, '没学过（learned=false）也返回 null');

chk(typeof S.dueList === 'function', 'Scheduler 暴露 dueList()');
const L = S.dueList(pool, id => recs[id] || null, { days: 14 });
chk(L.days.length === 14, '清单也是 14 档（与日历同长）');
chk(L.days[0].items.map(x => x.id).sort().join(',') === 'due0,overdue3',
  '今天那一档 = 今天到期的 + 逾期 3 天的（逾期一周以内的并进今天，实际 ' +
  L.days[0].items.map(x => x.id).join('、') + '）');
chk(L.days[3].items.length === 1 && L.days[3].items[0].id === 'due3',
  '第 3 天那一档就是 due3 那一篇（日历上第 3 天那格的展开）');

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

const first = L.days[0].items[0];
chk(first.id && first.title !== undefined && typeof first.level === 'number' &&
  typeof first.mastery === 'number' && typeof first.daysLeft === 'number',
  '清单里每一篇带齐 id / 篇名 / 阶段 / 掌握度 / 还差几天');
chk(first.id === 'overdue3', '今天那一档里最该先背的排最前（逾期最久的在前；实际 ' + first.id + '）');
chk(L.days[0].items.filter(x => x.daysLeft < 0).length === 1 &&
  L.backlog.every(x => x.daysLeft < -7),
  '逾期的那几篇 daysLeft 是负数（页面据此显示「逾期 N 天」；backlog 的都是逾期一周以上）');

const todayItems = L.days[0].items;
chk(todayItems.every((x, i) => i === 0 || todayItems[i - 1].daysLeft <= x.daysLeft),
  '今天那一档按紧迫度排（逾期久的在前）');

const emptyL = S.dueList(pool, () => null, { days: 14 });
chk(emptyL.days.length === 14 && emptyL.total === 0 && emptyL.backlog.length === 0,
  '一篇都没学过时清单为空、14 档仍在（页面不是白屏，是给一句说明）');
chk(S.dueList([], () => null).days.length === 14, '空候选池也照样给出 14 档');

const dupL = S.dueList([{ id: 'x', title: 'x' }, { id: 'x', title: 'x' }],
  () => ({ level: 1, learned: true, nextReviewAt: Date.now() }), { days: 14 });
chk(dupL.days[0].items.length === 1, '同一篇重复出现在候选池里时只列一次');

const empty = S.overview(pool, () => null, { days: 14 });
chk(empty.learned === 0 && empty.dueToday === 0 && empty.avgMastery === 0 &&
  empty.maxDay === 0 && empty.calendar.every(d => d.count === 0),
  '一篇都没学过时不抛错，账目全 0（页面显示「还没有学习记录」）');
chk(empty.unlearned === 6, '一篇都没学过时「尚未学过」= 全部');
chk(S.overview([], () => null).calendar.length === 14,
  '空候选池也照样给出 14 格日历（不至于让页面白屏）');

const recs7 = {

  exactly7: { level: 1, learned: true, nextReviewAt: today0 + 9 * 3600000 - 7 * DAY, lapses: 0, reviewCount: 1 },

  over7: { level: 1, learned: true, nextReviewAt: today0 + 9 * 3600000 - 8 * DAY, lapses: 0, reviewCount: 1 },

  over1: { level: 1, learned: true, nextReviewAt: today0 + 9 * 3600000 - DAY, lapses: 0, reviewCount: 1 },

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

const farL = S.dueList([{ id: 'a' }], () => ({
  level: 0, learned: true, nextReviewAt: today0 + 30 * DAY
}), { days: 14 });
chk(farL.farther === 1 && farL.total === 0 && farL.backlog.length === 0,
  '超出 14 天窗口的只进 farther，不进 total / backlog（三处各说各的）');

const html = fs.readFileSync(path + 'progress/index.html', 'utf8');
const order = html.match(/<script src="([^"]+)"><\/script>/g).map(s => s.match(/src="([^"]+)"/)[1]);
chk(order.indexOf('data/index.js') < order.indexOf('js/scheduler.js'),
  '脚本顺序：data/index.js 先于 scheduler（排程要读 POEMS_ALL）');
chk(order.indexOf('js/scheduler.js') < order.indexOf('js/progress.js'),
  '脚本顺序：scheduler 先于 progress（页面要用 overview）');

console.log('');
console.log(fails ? '❌ ' + fails + ' 项失败' : '🎉 背诵进度总览（数据层）测试全部通过');
process.exit(fails ? 1 : 0);
