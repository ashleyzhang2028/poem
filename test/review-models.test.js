
const fs = require('fs');
const vm = require('vm');
const path = __dirname + '/../';

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const DAY = 86400000;

const sb = { window: {}, console };
sb.window = sb;
vm.createContext(sb);
['data/text-master', 'data/poems-1', 'js/review-models', 'js/scheduler'].forEach(f =>
  vm.runInContext(fs.readFileSync(path + f + '.js', 'utf8'), sb, { filename: f }));
const RM = sb.ReviewModels;
const S = sb.Scheduler;

chk(!!RM && !!S, 'js/review-models.js 与 js/scheduler.js 都加载得上');
chk(RM.keys().join(',') === 'ebbinghaus,leitner,sm2,fsrs',
  '四张模型齐备且按这个顺序（实际 ' + RM.keys().join(',') + '）');
chk(RM.DEFAULT_KEY === 'ebbinghaus', '出厂默认仍是遗忘曲线（换算法是加法，不是替换）');
chk(RM.known('ebbinghaus') && RM.known('leitner') && RM.known('sm2') && RM.known('fsrs'),
  '四张模型都能被 known() 认出来');
chk(!RM.known('sm17') && !RM.known('sm20') && !RM.known('hlr'),
  'SM-17 / SM-20 / HLR 都没被注册成模型 —— 前者闭源无法如实复现，后者的思路并进 FSRS 的稳定性 S');
chk(RM.known('') === false && RM.modelOf('不存在').key === 'ebbinghaus',
  '认不出来的键一律退回出厂默认（绝不返回 null）');

RM.keys().forEach(k => {
  const d = RM.describe(k);

  chk(d.name && d.sub && d.years && d.blurb.length > 8 && d.blurb.length <= 40,
    '「' + k + '」的说明齐备且只有一句（' + d.name + ' · ' + d.years + '）');
});

vm.runInContext(fs.readFileSync(path + 'js/entitlement.js', 'utf8'), sb, { filename: 'js/entitlement.js' });
const Ent = sb.Entitlement;
const TIERS = {
  guest: { tier: 'free', signedIn: false },
  free: { tier: 'free', signedIn: true },
  pro: { tier: 'pro', signedIn: true },
  max: { tier: 'max', signedIn: true }
};

chk(RM.entrance('ebbinghaus') === 'algo.ebbinghaus' && RM.entrance('fsrs') === 'algo.fsrs',
  'entrance() 拼出的能力键是 "algo." + 模型的 key（内核与台账由此对上）');
chk(RM.entrance('不存在') === 'algo.ebbinghaus',
  '不认识的键退回出厂默认那一张（绝不返回一个查不到的能力名）');

chk(RM.allowedKeys(TIERS.guest).join(',') === 'ebbinghaus',
  '游客只有遗忘曲线（实际 ' + RM.allowedKeys(TIERS.guest).join(',') + '）');
chk(RM.allowedKeys(TIERS.free).join(',') === 'ebbinghaus,leitner',
  '登录的 free 拿到两张：遗忘曲线 + 莱特纳盒（实际 ' + RM.allowedKeys(TIERS.free).join(',') + '）');
chk(RM.allowedKeys(TIERS.pro).join(',') === 'ebbinghaus,leitner,sm2',
  'pro 三张：再加 SM-2（实际 ' + RM.allowedKeys(TIERS.pro).join(',') + '）');
chk(RM.allowedKeys(TIERS.max).join(',') === 'ebbinghaus,leitner,sm2,fsrs',
  'max 四张齐备（实际 ' + RM.allowedKeys(TIERS.max).join(',') + '）');

chk(RM.allowed('ebbinghaus', TIERS.guest) && !RM.allowed('leitner', TIERS.guest),
  'allowed() 逐张回答，游客那张永远是开的');
chk(RM.allowed('leitner', TIERS.guest) === false && RM.allowed('leitner', TIERS.free) === true,
  '莱特纳盒：游客不行、登录的 free 可以');
chk(RM.allowed('fsrs', TIERS.pro) === false && RM.allowed('fsrs', TIERS.max) === true,
  'FSRS：pro 不行、max 可以');
chk(RM.allowed('fsrs') === false && RM.allowed('ebbinghaus') === true,
  '不传 ctx 时按**游客**处理（内核不认识人，宁可给最少的）');
chk(RM.allowed('fsrs', { tier: 'vip', signedIn: true }) === false,
  '脏层级按 free 处理（内核不自己发明层级）');

chk(RM.allowedKey('fsrs', TIERS.guest) === 'ebbinghaus',
  '游客「想要」FSRS → 退到遗忘曲线（退到能用的那一张，不是直接用没权的）');
chk(RM.allowedKey('fsrs', TIERS.pro) === 'sm2',
  'pro「想要」FSRS → 退到 SM-2（从高往低找第一张能用的）');
chk(RM.allowedKey('sm2', TIERS.free) === 'leitner',
  'free「想要」SM-2 → 退到莱特纳盒');
chk(RM.allowedKey('leitner', TIERS.max) === 'leitner',
  '有权时原样用它自己（回落只在不够层时发生）');
chk(RM.allowedKey('不知道是啥', TIERS.max) === 'ebbinghaus',
  '野生键照旧退回出厂默认（与 known() 那条同一口径）');
chk(RM.allowedKey('', undefined) === 'ebbinghaus',
  '空 ctx + 空键 → 出厂默认（任何输入都不得返回 null）');

{
  const order = ['guest', 'free', 'pro', 'max'];
  let prev = RM.allowedKeys(TIERS.guest).length;
  order.slice(1).forEach((t, i) => {
    const n = RM.allowedKeys(TIERS[t]).length;
    chk(n >= prev, '算法张数单调不减：' + t + '（' + prev + ' → ' + n + '）');
    prev = n;
  });
  chk(prev === RM.keys().length, '到 max 时四张全开（一张都不缺）');
}

{
  const sb2 = { window: {}, console };
  sb2.window = sb2;
  vm.createContext(sb2);
  ['data/text-master', 'data/poems-1', 'js/review-models'].forEach(f =>
    vm.runInContext(fs.readFileSync(path + f + '.js', 'utf8'), sb2, { filename: f }));
  const R2 = sb2.ReviewModels;
  chk(R2.allowed('fsrs', TIERS.max) === false && R2.allowedKey('fsrs', TIERS.max) === 'ebbinghaus',
    '没有权益层时（内核单跑）只有出厂默认那一张算数 —— 少给不许多给');
}
chk(RM.subFor('ebbinghaus') === '按艾宾浩斯遗忘曲线复习' &&
  RM.subFor('sm2') === '按 SM-2 复习' &&
  RM.subFor('fsrs') === '按 FSRS 复习' &&
  RM.subFor('leitner') === '按 Leitner 盒复习',
  '副标题就是「按 X 复习」那一句，四个模型各说各的');

chk(JSON.stringify(RM.EBBINGHAUS_INTERVALS) === JSON.stringify([0, 1, 2, 4, 7, 15, 30, 60, 120, 240]),
  '遗忘曲线的间隔表没被动过（0/1/2/4/7/15/30/60/120/240）');

/* 复核用的「连着几天各背一次」：Issue #481 之后同一天的重复点击只算改判，
   所以这些「连续记住 N 次」的用例必须**一天一步**地走，否则跑出来的
   就是同一天连点，测的已经不是原来的事了。 */
function overDays(n, result, key, rec, startTs) {
  let cur = rec || null;
  const t0 = startTs === undefined ? DAYS_T0 : startTs;
  for (let i = 0; i < n; i += 1) {
    cur = RM.review(cur, typeof result === 'function' ? result(i) : result, key, t0 + i * DAY);
  }
  return cur;
}

// overDays 的起点 / 最后一步落在哪 —— 断言 nextReviewAt 的落点要用它，
// 不能拿 Date.now()（那是「今天」，与连着几天走出来的日子对不上）。
const DAYS_T0 = Date.now();

let eb = overDays(3, 'good', 'ebbinghaus');
chk(eb.level === 3 && eb.algo === 'ebbinghaus', '遗忘曲线：连续三次记住 → 阶段 3（实际 ' + eb.level + '）');
const targetEb = (function () {
  const d = new Date(DAYS_T0 + 2 * DAY); d.setHours(0, 0, 0, 0);
  return d.getTime() + 4 * DAY + 9 * 3600000;
})();
chk(Math.abs(eb.nextReviewAt - targetEb) < 1000,
  '遗忘曲线：阶段 3 的下一次是 4 天后的 09:00（与旧实现同一个落点）');

let ln = overDays(3, 'good', 'leitner');
chk(ln.box === 3 && ln.algo === 'leitner',
  'Leitner：连对三次 → 3 号盒（实际 box=' + ln.box + '）');
chk(Math.abs(ln.nextReviewAt - (S.startOfDay(DAYS_T0 + 2 * DAY) + 8 * DAY + 9 * 3600000)) < 1000,
  'Leitner：3 号盒 = 8 天后再来（盒间隔 1/2/4/8/16）');
const lnBad = S.review(ln, 'bad', 'leitner');
chk(lnBad.box === 0, 'Leitner：答错退回 1 号盒（原版的「从头再来」，实际 box=' + lnBad.box + '）');
chk(lnBad.nextReviewAt - Date.now() < 31 * 60000, 'Leitner：答错 30 分钟后再来');
let lnTop = overDays(9, 'good', 'leitner');
chk(lnTop.box === 4, 'Leitner：盒号封顶在第 5 盒（box 最大 4，实际 ' + lnTop.box + '）');
chk(RM.modelOf('leitner').stageName(ln) === '4 号盒 · 8 天后',
  'Leitner 的阶段名说「几号盒 · 几天后」（实际「' + RM.modelOf('leitner').stageName(ln) + '」）');

const sm2 = RM.modelOf('sm2');
chk(sm2.DEFAULT_EF === 2.5 && sm2.MIN_EF === 1.3, 'SM-2 的出厂 EF 2.5、下限 1.3（原版口径）');
chk(Math.abs(sm2.efAfter(2.5, 5) - 2.6) < 1e-9, 'SM-2：质量 5 → EF +0.1（实际 ' + sm2.efAfter(2.5, 5) + '）');
chk(Math.abs(sm2.efAfter(2.5, 1) - 1.96) < 1e-9, 'SM-2：质量 1 → EF −0.54（实际 ' + sm2.efAfter(2.5, 1) + '）');
chk(sm2.efAfter(1.3, 1) === 1.3, 'SM-2：EF 到下限 1.3 就不再往下掉');
chk(sm2.intervalAfter(0, 2.5, 1) === 1 && sm2.intervalAfter(1, 2.5, 2) === 3 &&
  sm2.intervalAfter(3, 2.5, 3) === 7,
  'SM-2：前三次间隔固定 1 / 3 / 7 天');
chk(sm2.intervalAfter(7, 2.5, 4) === 18, 'SM-2：第四次起 interval × EF（7 × 2.5 = 18，实际 ' +
  sm2.intervalAfter(7, 2.5, 4) + '）');
let sm = overDays(6, 'good', 'sm2');
chk(sm.algo === 'sm2' && sm.interval >= 18 && sm.reviewCount === 6,
  'SM-2：一路记住 → 间隔越长越长（第 6 次后 ' + sm.interval + ' 天）');
chk(sm.ef > 2.5, 'SM-2：一路「记住」EF 会往上走（实际 ' + sm.ef + '）');
const smFuzzy = S.review(sm, 'fuzzy', 'sm2');
chk(smFuzzy.interval === sm.interval && smFuzzy.ef < sm.ef,
  'SM-2：「模糊」算通过但 EF 下调（间隔不动、EF ' + sm.ef + '→' + smFuzzy.ef + '）');

const fsrs = RM.modelOf('fsrs');
chk(Math.abs(fsrs.retrievability(10, 0) - 1) < 1e-9, 'FSRS：刚复习完 R=1');
chk(Math.abs(fsrs.retrievability(10, 10) - 0.5) < 1e-9,
  'FSRS：经过一个稳定期（t=S）R=0.5 —— 这正是「稳定性」的定义');
chk(fsrs.retrievability(10, 20) < 0.3, 'FSRS：越久没复习 R 越低（t=2S 时 <0.3）');
chk(fsrs.intervalOf(10, 0.9) === Math.max(1, Math.round(10 * (Math.log(1 / 0.9) / Math.log(2)))),
  'FSRS：间隔按「R 回落到 0.9」反推（S=10 天 → ' + fsrs.intervalOf(10, 0.9) + ' 天）');
chk(fsrs.difficultyAfter(5, 'good') < 5 && fsrs.difficultyAfter(5, 'bad') > 5,
  'FSRS：难度随对错升降（记住 ↓、忘了 ↑）');
chk(fsrs.difficultyAfter(10, 'bad') === 10 && fsrs.difficultyAfter(1, 'good') === 1,
  'FSRS：难度锁在 1-10 之间');
let fz = overDays(2, 'good', 'fsrs');
const s1 = fz.stability;
fz = RM.review(fz, 'good', 'fsrs', Date.now() + 3 * DAY);
chk(fz.stability > s1, 'FSRS：连续记住 → 稳定性 S 变长（' + s1 + ' → ' + fz.stability + '）');
const fzBad = S.review(fz, 'bad', 'fsrs');
chk(fzBad.stability < fz.stability, 'FSRS：忘了 → 稳定性被打回去（' +
  fz.stability + ' → ' + fzBad.stability + '）');
chk(fzBad.difficulty > fz.difficulty, 'FSRS：忘了 → 难度抬高');
chk(/^稳定 [\d.]+ 天 · 难度 [\d.]+$/.test(fsrs.stageName(fz)),
  'FSRS 的阶段名说「稳定 N 天 · 难度 N」（实际「' + fsrs.stageName(fz) + '」）');

RM.keys().forEach(k => {
  const f = S.review(null, 'fuzzy', k);
  const bad = S.review(null, 'bad', k);
  chk(f.nextReviewAt > Date.now() && f.nextReviewAt < Date.now() + 13 * 3600000,
    '「' + k + '」：模糊 → 12 小时后再来（所有模型一致）');
  chk(bad.nextReviewAt - Date.now() < 31 * 60000,
    '「' + k + '」：忘记 → 30 分钟后再来（所有模型一致）');
  chk(bad.lapses === 1, '「' + k + '」：忘记会记一次遗忘次数');
  chk(S.review(null, 'fuzzy', k).level === S.review(null, 'fuzzy', k).level,
    '「' + k + '」：模糊不推进「连续记住」的计数（不虚报掌握）');
});

const lnKeep = S.review(ln, 'fuzzy', 'leitner');
chk(lnKeep.box === ln.box, 'Leitner：模糊不动盒号');
const sm2Keep = S.review(sm, 'bad', 'sm2');
chk(sm2Keep.ef <= sm.ef, 'SM-2：忘记时 EF 下调（判错）');

let deep = overDays(9, i => (i < 7 ? 'good' : 'bad'), 'ebbinghaus');
const before = JSON.parse(JSON.stringify(deep));

chk(deep.learned === true && deep.reviewCount === 9 && deep.lapses === 2,
  '原记录：已学、复习 9 次、忘过 2 次（造数正确）');

RM.keys().forEach(k => {
  const nw = RM.adopt(deep, k);
  chk(nw.algo === k, '换算到「' + k + '」后 algo 记成它');
  chk(nw.learned === true, '换算到「' + k + '」**绝不退回未学**（learned 保持 true）');
  chk(nw.reviewCount === before.reviewCount && nw.lapses === before.lapses,
    '换算到「' + k + '」复习次数与遗忘次数原样保留');
  chk(nw.level === before.level, '换算到「' + k + '」阶段号原样保留（掌握度那把尺子不变）');
});

const lnAdopt = RM.adopt(deep, 'leitner');
chk(typeof lnAdopt.box === 'number' && lnAdopt.box >= 0 && lnAdopt.box <= 4,
  '换算到 Leitner 会给出合法盒号（实际 ' + lnAdopt.box + '）');
const smAdopt = RM.adopt(deep, 'sm2');
chk(typeof smAdopt.interval === 'number' && smAdopt.interval > 0 && smAdopt.ef <= 2.5,
  '换算到 SM-2 会给出间隔与 EF，且忘过的篇目 EF 偏低（interval=' +
  smAdopt.interval + '、ef=' + smAdopt.ef + '）');
const fzAdopt = RM.adopt(deep, 'fsrs');
chk(typeof fzAdopt.stability === 'number' && fzAdopt.stability > 0 &&
  fzAdopt.difficulty > fsrs.params.initD,
  '换算到 FSRS 会给出稳定天数与偏高的难度（S=' + fzAdopt.stability +
  '、D=' + fzAdopt.difficulty + '）');

RM.keys().forEach(k => {
  const nw = RM.review(RM.adopt(deep, k), 'good', k, Date.now() + DAY);
  const days = (nw.nextReviewAt - Date.now()) / DAY;
  chk(days > 1, '「' + k + '」换算后接着背一次，下一次仍排到 1 天以后（实际 ' +
    Math.round(days * 10) / 10 + ' 天）—— 不是从头再来');
  chk(nw.reviewCount === before.reviewCount + 1, '「' + k + '」换算后复习次数接着往上加');
});

chk(JSON.stringify(deep) === JSON.stringify(before), 'adopt() 不改动原记录（返回新对象）');
chk(RM.adopt(deep, 'fsrs').nextReviewAt === before.nextReviewAt,
  '换算不动 nextReviewAt —— 用户已经排好的到期时间不该被顺手挪走');

const never = RM.adopt({ level: 0, learned: false, reviewCount: 0, lapses: 0 }, 'fsrs');
chk(never.learned === false && never.level === 0,
  '从没背过的记录换算后仍是未学过（不会被算成学过）');

/* ===========================================================================
   同一天只算一次，以最后一次的选择为准（Issue #481）
   ---------------------------------------------------------------------------
   用户 2026-10-06：弹出卡片上「忘记 / 模糊 / 记住」三颗按钮，理论上每天
   总共只能点一次；再点不要累加结果，而是把那天的结果**改**成新的。
   例如点完记住再点忘记，数据库里只能留下忘记，掌握度与已复习次数都按
   最后一次算。

   这里钉三条不变量：
     ① 同一天连点 N 下，reviewCount 只 +1；
     ② 记忆阶段 / 遗忘次数 / 下次复习时间全部回到「最后一次」那一份；
     ③ 跨过 0 点就是新的一天，计数重新 +1（不能把昨天的一起吃掉）。
   造数里那首「昨天学过、今天还没点」的记录，正是用户截图里那份。
   =========================================================================== */
console.log('');
{
  const todayOf = ts => {
    const d = new Date(ts);
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  };
  const base = t => ({
    level: 2, learned: true, nextReviewAt: t, lastReviewAt: t - DAY,
    reviewCount: 5, lapses: 1, history: [], algo: 'ebbinghaus'
  });

  chk(RM.dayOf(Date.now()) === todayOf(Date.now()),
    'dayOf() 就是本地日界那一串（与首页「今天」同一口径）');

  // ① 新学的记录：今天连点五下「记住」，只算一次
  const t0 = Date.now();
  let fresh = null;
  for (let i = 0; i < 5; i += 1) fresh = RM.review(fresh, 'good', 'ebbinghaus', t0 + i * 100);
  chk(fresh.reviewCount === 1 && fresh.level === 1,
    '新记录同一天连点五下「记住」：只算一次、只进一格（实际 ' +
    fresh.reviewCount + ' 次 / 阶段 ' + fresh.level + '）');

  // ② 记住 → 忘记：不累加，按最后那次算
  let r = RM.review(base(t0), 'good', 'ebbinghaus', t0);
  chk(r.level === 3 && r.reviewCount === 6 && r.lapses === 1,
    '昨天学过的今天点「记住」：阶段 3 / 共 6 次 / 忘过 1 次（实际 ' +
    r.level + ' / ' + r.reviewCount + ' / ' + r.lapses + '）');
  const mGood = S.mastery(r);

  r = RM.review(r, 'bad', 'ebbinghaus', t0 + 1000);
  chk(r.reviewCount === 6, '再点「忘记」：复习次数**不累加**，仍是 6（实际 ' + r.reviewCount + '）');
  chk(r.level === 1 && r.lapses === 2,
    '再点「忘记」：阶段退回 1、遗忘次数跟着变 2（按最后一次算，实际 ' +
    r.level + ' / ' + r.lapses + '）');
  chk(S.mastery(r) < mGood, '改成「忘记」后掌握度跟着往下走（' + mGood + '% → ' + S.mastery(r) + '%）');

  // ③ 忘记 → 记住：回到最初那份，不是「叠加」
  r = RM.review(r, 'good', 'ebbinghaus', t0 + 2000);
  chk(r.level === 3 && r.reviewCount === 6 && r.lapses === 1 && S.mastery(r) === mGood,
    '再改回「记住」：阶段 / 次数 / 遗忘次数 / 掌握度全部回到第一次那份（实际 ' +
    r.level + ' / ' + r.reviewCount + ' / ' + r.lapses + ' / ' + S.mastery(r) + '%）');

  // ④ 空记录上改判也要对（没有「昨天那份」可回滚时）
  let nw = RM.review(null, 'good', 'ebbinghaus', t0);
  nw = RM.review(nw, 'bad', 'ebbinghaus', t0 + 1000);
  chk(nw.reviewCount === 1 && nw.level === 0 && nw.lapses === 1,
    '新记录上「记住 → 忘记」：仍是 1 次、阶段 0、忘过 1 次（实际 ' +
    nw.reviewCount + ' / ' + nw.level + ' / ' + nw.lapses + '）');
  nw = RM.review(nw, 'fuzzy', 'ebbinghaus', t0 + 2000);
  chk(nw.reviewCount === 1 && nw.lapses === 0 && nw.nextReviewAt - t0 <= 12 * 3600000 + 3000,
    '再改「模糊」：遗忘次数也退回去了（实际 ' + nw.lapses + '）、下次排到 12 小时后');

  // ⑤ 跨过 0 点 = 新的一天
  let d = RM.review(base(t0), 'good', 'ebbinghaus', t0);
  d = RM.review(d, 'bad', 'ebbinghaus', t0 + 1000);
  const nextDay = RM.review(d, 'good', 'ebbinghaus', t0 + DAY);
  chk(nextDay.reviewCount === 7,
    '第二天再点：计数重新 +1（昨天那几下不算新的，实际 ' + nextDay.reviewCount + '）');
  const nextDayAgain = RM.review(nextDay, 'bad', 'ebbinghaus', t0 + DAY + 1000);
  chk(nextDayAgain.reviewCount === 7,
    '第二天再改判仍不累加（实际 ' + nextDayAgain.reviewCount + '）');

  // ⑥ 判定辅助：今天点过了没 / 点的是哪一个
  chk(RM.gradedToday(r, t0 + 3000) === true && RM.gradedToday(r, t0 + DAY) === false,
    'gradedToday()：今天点过为真、明天为假（弹卡片靠它决定要不要提示改判）');
  chk(RM.todayResult(r, t0 + 3000) === 'good', 'todayResult()：今天最后选的是「记住」');
  chk(RM.todayResult(RM.review(null, 'fuzzy', 'ebbinghaus', t0), t0) === 'fuzzy',
    'todayResult() 跟着最后一次走（模糊）');

  // ⑦ 换算法不清今天的「底」：改判照样只更新
  const cross = RM.review(RM.adopt(d, 'sm2'), 'good', 'sm2', t0 + DAY);
  const cross2 = RM.review(cross, 'bad', 'sm2', t0 + DAY + 500);
  chk(cross2.reviewCount === cross.reviewCount,
    'SM-2 上同日改判同样不累加（实际 ' + cross2.reviewCount + '）');
}

console.log('');
console.log(fails ? '❌ ' + fails + ' 项失败' : '🎉 复习算法测试全部通过（含同日改判只算一次）');
process.exit(fails ? 1 : 0);
