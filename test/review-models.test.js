// Issue #278：页面层（jsdom 三张页）已删除，这里只留算法内核的功能验证。
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

// ---------------------------------------------------------------------------
// 算法按层级开放（Issue #229 第四轮）
//
// 用户原话：「游客可以用艾宾浩斯遗忘曲线 / 登录 free 添加莱特纳盒 /
// pro 添加 SM-2 / max 再添加 FSRS 支持全部」。
//
// 「哪一档能用哪几张」这句话在 js/entitlement.js 的 CAPS 里（四条
// algo.*），内核只是替调用方去问它 —— 所以这一节先把 Entitlement 装进
// 内核那个 vm 沙盒，再逐档对拍。
// ---------------------------------------------------------------------------
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

// 单调性：层级越高，能用的张数只增不减
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

// 内核不自己判层级：把 Entitlement 拿掉后只剩出厂默认那一张
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
let eb = null;
for (let i = 0; i < 3; i += 1) eb = S.review(eb, 'good', 'ebbinghaus');
chk(eb.level === 3 && eb.algo === 'ebbinghaus', '遗忘曲线：连续三次记住 → 阶段 3（实际 ' + eb.level + '）');
const targetEb = (function () {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return d.getTime() + 4 * DAY + 9 * 3600000;
})();
chk(Math.abs(eb.nextReviewAt - targetEb) < 1000,
  '遗忘曲线：阶段 3 的下一次是 4 天后的 09:00（与旧实现同一个落点）');

let ln = null;
for (let i = 0; i < 3; i += 1) ln = S.review(ln, 'good', 'leitner');
chk(ln.box === 3 && ln.algo === 'leitner',
  'Leitner：连对三次 → 3 号盒（实际 box=' + ln.box + '）');
chk(Math.abs(ln.nextReviewAt - (S.startOfDay(Date.now()) + 8 * DAY + 9 * 3600000)) < 1000,
  'Leitner：3 号盒 = 8 天后再来（盒间隔 1/2/4/8/16）');
const lnBad = S.review(ln, 'bad', 'leitner');
chk(lnBad.box === 0, 'Leitner：答错退回 1 号盒（原版的「从头再来」，实际 box=' + lnBad.box + '）');
chk(lnBad.nextReviewAt - Date.now() < 31 * 60000, 'Leitner：答错 30 分钟后再来');
let lnTop = null;
for (let i = 0; i < 9; i += 1) lnTop = S.review(lnTop, 'good', 'leitner');
chk(lnTop.box === 4, 'Leitner：盒号封顶在第 5 盒（box 最大 4，实际 ' + lnTop.box + '）');
chk(RM.modelOf('leitner').stageName(ln) === '4 号盒 · 8 天后',
  'Leitner 的阶段名说「几号盒 · 几天后」（实际「' + RM.modelOf('leitner').stageName(ln) + '」）');

const sm2 = RM.modelOf('sm2');
chk(sm2.DEFAULT_EF === 2.5 && sm2.MIN_EF === 1.3, 'SM-2 的出厂 EF 2.5、下限 1.3（原版口径）');
chk(Math.abs(sm2.efAfter(2.5, 5) - 2.6) < 1e-9, 'SM-2：质量 5 → EF +0.1（实际 ' + sm2.efAfter(2.5, 5) + '）');
chk(Math.abs(sm2.efAfter(2.5, 3) - 2.36) < 1e-9, 'SM-2：质量 3 → EF −0.14（实际 ' + sm2.efAfter(2.5, 3) + '）');
chk(Math.abs(sm2.efAfter(2.5, 1) - 1.96) < 1e-9, 'SM-2：质量 1 → EF −0.54（实际 ' + sm2.efAfter(2.5, 1) + '）');
chk(sm2.efAfter(1.3, 1) === 1.3, 'SM-2：EF 到下限 1.3 就不再往下掉');
chk(sm2.intervalAfter(0, 2.5, 1) === 1 && sm2.intervalAfter(1, 2.5, 2) === 3 &&
  sm2.intervalAfter(3, 2.5, 3) === 7,
  'SM-2：前三次间隔固定 1 / 3 / 7 天');
chk(sm2.intervalAfter(7, 2.5, 4) === 18, 'SM-2：第四次起 interval × EF（7 × 2.5 = 18，实际 ' +
  sm2.intervalAfter(7, 2.5, 4) + '）');
let sm = null;
for (let i = 0; i < 6; i += 1) sm = S.review(sm, 'good', 'sm2');
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
let fz = S.review(null, 'good', 'fsrs');
const s1 = fz.stability;
fz = S.review(fz, 'good', 'fsrs');
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

let deep = null;
for (let i = 0; i < 7; i += 1) deep = S.review(deep, 'good', 'ebbinghaus');
deep = S.review(deep, 'bad', 'ebbinghaus');
deep = S.review(deep, 'bad', 'ebbinghaus');
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
  const nw = RM.review(RM.adopt(deep, k), 'good', k);
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

console.log('');
console.log(fails ? '❌ ' + fails + ' 项失败' : '🎉 复习算法测试全部通过');
process.exit(fails ? 1 : 0);
