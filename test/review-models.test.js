const { JSDOM } = require('jsdom');
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
chk(RM.subFor('ebbinghaus') === '按遗忘曲线复习' &&
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

const settingsHtml = fs.readFileSync(path + 'settings/recite/index.html', 'utf8');
const homeHtml = fs.readFileSync(path + 'index.html', 'utf8');

chk(/id="seg-algo"/.test(settingsHtml), '设置页有「复习算法」选择器（id="seg-algo"）');
chk(/js\/review-models\.js/.test(settingsHtml), '设置页加载 js/review-models.js（清单不另抄一份）');
const sOrder = settingsHtml.match(/<script src="([^"]+)"><\/script>/g)
  .map(x => x.match(/src="([^"]+)"/)[1]);
chk(sOrder.indexOf('/js/review-models.js') < sOrder.indexOf('/js/settings.js'),
  '设置页脚本顺序：review-models 先于 settings（回显要读模型清单）');
const hOrder = homeHtml.match(/<script src="([^"]+)"><\/script>/g)
  .map(x => x.match(/src="([^"]+)"/)[1]);
chk(hOrder.indexOf('js/review-models.js') < hOrder.indexOf('js/scheduler.js'),
  '首页脚本顺序：review-models 先于 scheduler（review() 一进来就转交给它）');
chk(hOrder.indexOf('js/review-models.js') < hOrder.indexOf('js/app.js'),
  '首页脚本顺序：review-models 先于 app（副标题要读它）');

class RepoLoader {
  constructor() { this._userAgent = 'jsdom-test'; this._strictSSL = true; this._proxy = undefined; }
  fetch(url) {
    const file = require('path').join(path, decodeURIComponent(new URL(url).pathname));
    if (fs.existsSync(file)) return Promise.resolve(fs.readFileSync(file));
    return Promise.reject(new Error('not found: ' + url));
  }
}
const _probe = new JSDOM('', { resources: 'usable' });
const _realProto = Object.getPrototypeOf(_probe.window._resourceLoader || {});
if (_realProto && _realProto.fetch) Object.setPrototypeOf(RepoLoader.prototype, _realProto);
Object.defineProperty(RepoLoader, 'name', { value: 'ResourceLoader' });

const sdom = new JSDOM(settingsHtml, {
  runScripts: 'dangerously', resources: new RepoLoader(), url: 'https://local.test/settings/recite/'
});
const sd = sdom.window.document;

function bootSettled() {
  if (sd.readyState === 'loading') return setTimeout(bootSettled, 30);
  sd.dispatchEvent(new sdom.window.Event('DOMContentLoaded', { bubbles: true }));
  setTimeout(body, 60);
}
setTimeout(bootSettled, 30);

function body() {
  const opts = sd.querySelectorAll('#seg-algo .algo-opt');
  chk(opts.length === 4, '设置页画出四张模型卡（实际 ' + opts.length + '）');
  chk([...opts].map(o => o.dataset.algo).join(',') === 'ebbinghaus,leitner,sm2,fsrs',
    '四张卡的顺序与模型清单一致');
  chk(sd.querySelector('#seg-algo [aria-checked="true"]').dataset.algo === 'ebbinghaus',
    '默认选中出厂默认「遗忘曲线」');
  chk(sd.querySelectorAll('#seg-algo .algo-opt.active').length === 1,
    '四张卡里只有一张是选中态（互斥）');
  chk((sd.querySelector('#algo-hint') || {}).textContent.indexOf('遗忘曲线') >= 0,
    '下方回显当前算法（实际「' + sd.querySelector('#algo-hint').textContent + '」）');
  chk((sd.querySelector('#algo-interval') || {}).textContent.indexOf('当天 → 1 → 2 → 4') >= 0,
    '「复习间隔」那一行说的是**当前模型**的口径（遗忘曲线 = 固定表）');
  chk(sd.querySelector('#seg-algo').getAttribute('role') === 'radiogroup',
    '四张卡是一组单选（role=radiogroup），不是四个各自为政的按钮');
  chk([...opts].every(o => o.getAttribute('role') === 'radio'),
    '每张卡都是 role=radio（读屏能听出「四选一」）');

  const before = sd.querySelector('#seg-algo [aria-checked="true"]').dataset.algo;
  sd.querySelector('#seg-algo [data-algo="fsrs"]').dispatchEvent(
    new sdom.window.Event('click', { bubbles: true }));
  const saved = JSON.parse(sdom.window.localStorage.getItem('poem_recite_settings_v1') || '{}');
  chk(saved.algo === 'fsrs', '点「FSRS」把 algo 写进了设置（' + before + ' → ' + saved.algo + '）');
  chk(sd.querySelector('#seg-algo [aria-checked="true"]').dataset.algo === 'fsrs',
    '选中态跟着切过去');
  chk((sd.querySelector('#algo-interval') || {}).textContent.indexOf('稳定天数') >= 0,
    '「复习间隔」那一行跟着换成 FSRS 的口径（实际「' +
    sd.querySelector('#algo-interval').textContent + '」）');

  const prog = {};
  prog['xx1-01'] = { level: 5, learned: true, nextReviewAt: Date.now() + 3 * DAY,
    lastReviewAt: Date.now() - DAY, reviewCount: 6, lapses: 1, history: [], algo: 'ebbinghaus' };
  sdom.window.localStorage.setItem('poem_recite_progress_v1', JSON.stringify(prog));
  sd.querySelector('#seg-algo [data-algo="sm2"]').dispatchEvent(
    new sdom.window.Event('click', { bubbles: true }));
  const after = JSON.parse(sdom.window.localStorage.getItem('poem_recite_progress_v1'));
  chk(after['xx1-01'].algo === 'sm2',
    '切算法时把已有进度换算到新模型（algo 从 ebbinghaus → ' + after['xx1-01'].algo + '）');
  chk(after['xx1-01'].learned === true && after['xx1-01'].level === 5 &&
    after['xx1-01'].reviewCount === 6,
    '换算**不清进度**：已学 / 阶段 / 复习次数一条不丢');
  chk(after['xx1-01'].nextReviewAt === prog['xx1-01'].nextReviewAt,
    '换算不动「何时到期」（用户已经排好的复习时间不被挪走）');
  chk(typeof after['xx1-01'].interval === 'number' && typeof after['xx1-01'].ef === 'number',
    '换算后带上 SM-2 自己的两个量（interval / ef）');

  const homeDom = new JSDOM(homeHtml, {
    runScripts: 'dangerously', resources: new RepoLoader(), url: 'https://local.test/'
  });
  homeDom.window.localStorage.setItem('poem_recite_settings_v1', JSON.stringify({ algo: 'fsrs' }));
  setTimeout(() => {
    const hd = homeDom.window.document;
    chk(hd.body.getAttribute('data-sub') === '按 FSRS 复习',
      '首页 body 的 data-sub 跟着算法变（实际「' + hd.body.getAttribute('data-sub') + '」）');
    chk((hd.querySelector('#brand-sub') || {}).textContent === '按 FSRS 复习',
      '顶栏第二行写「按 FSRS 复习」（实际「' +
      (hd.querySelector('#brand-sub') || {}).textContent + '」）');
    chk(hd.body.getAttribute('data-sub').indexOf('遗忘曲线') === -1,
      '换成 FSRS 后不再写「遗忘曲线」');

    const wildDom = new JSDOM(homeHtml, {
      runScripts: 'dangerously', resources: new RepoLoader(), url: 'https://local.test/'
    });
    wildDom.window.localStorage.setItem('poem_recite_settings_v1',
      JSON.stringify({ algo: '不知道是啥' }));
    setTimeout(() => {
      const wd = wildDom.window.document;
      chk(wd.body.getAttribute('data-sub') === '按遗忘曲线复习',
        '野生算法键退回出厂默认，副标题写「按遗忘曲线复习」（实际「' +
        wd.body.getAttribute('data-sub') + '」）');

      console.log('\n' + (fails ? '❌ ' + fails + ' 项失败' : '🎉 复习算法测试全部通过'));
      process.exit(fails ? 1 : 0);
    }, 800);
  }, 800);
}
