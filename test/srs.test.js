/**
 * 背诵算法可切换（Issue #114）专项测试
 * ==========================================================================
 * 需求原话：
 *   「背诵功能增强，目前默认使用的是斯宾浩斯遗忘曲线，但市面上还有一些其他的……
 *     请帮忙研究有哪些是适用于古诗词和古文背诵的，应用到项目中，
 *     并且允许用户在设置页面进行切换。背诵页面现在的副标题是『按遗忘曲线复习』，
 *     以后用户选择哪种，就显示哪种，例如『按 SM-2 复习』或者『按 FSRS 复习』」
 *
 * 这一层验六件事：
 *   1. 算法注册表的四档（艾宾浩斯 / 莱特纳盒 / SM-2 / FSRS）各自算得出合理的
 *      间隔、阶段名与掌握度，且**互不相同**（否则「可切换」是假的）；
 *   2. 默认档与升级前**逐字一致** —— 间隔表、复盘三支行为、掌握度都相同，
 *      老用户不动设置时看到的界面与排期零变化；
 *   3. 调度器（Scheduler）真的跟着算法走：review / levelName / mastery /
 *      overview 的档位数都随算法变；
 *   4. 设置页能把四档画出来、能选中、写进 poem_recite_settings_v1.srs，
 *      不认识的脏值回默认档；
 *   5. 首页顶栏第二行「按 XX 复习」随算法变，且 body 的 data-sub 同步更新
 *      （不同步的话 chrome.js 下次重绘会把旧文案顶回来）；
 *   6. 切换算法**不重算历史进度**：已形成的档案（level / nextReviewAt 原封不动）。
 *
 * 运行：node test/srs.test.js
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const DAY = 86400000;

/* ================= 一、纯算法层（vm，无 DOM） ================= */
function loadAlgos(settings) {
  const store = {};
  if (settings) store.poem_recite_settings_v1 = JSON.stringify(settings);
  const sb = {
    window: {},
    console,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    }
  };
  sb.window = sb;
  vm.createContext(sb);
  ['js/storage.js', 'js/srs.js'].forEach(f =>
    vm.runInContext(read(f), sb, { filename: f }));
  return sb;
}

const sb = loadAlgos();
const SRS = sb.SRS;

chk(Array.isArray(SRS.ALGOS) && SRS.ALGOS.length === 4,
  '算法注册表有四档（实际 ' + (SRS.ALGOS ? SRS.ALGOS.length : 0) + '）');
chk(SRS.ALGOS.map(a => a.id).join(',') === 'ebbinghaus,leitner,sm2,fsrs',
  '四档依次是 艾宾浩斯遗忘曲线 / 莱特纳盒 / SM-2 / FSRS');
chk(SRS.DEFAULT === 'ebbinghaus', '出厂档仍是艾宾浩斯遗忘曲线（老用户不动设置就零变化）');
chk(SRS.ALGOS.every(a => a.name && a.sub && a.tagline),
  '每档都有正式名、副标题自称与一句话特点（设置页与顶栏都要用）');
chk(SRS.ALGOS.filter(a => /按.+(复习|记忆)/.test(a.sub)).length === 4,
  '每档的副标题都是「按 XX 复习」句式');
chk(SRS.ALGOS.filter(a => a.intro && a.intro.length > 30).length === 4,
  '每档都有一段可读的说明（进设置页直接显示给用户看）');
// 两种没做的：SM-17~20 闭源、HLR 是碎片化语言练习那一路 —— 必须在设置页里说清缘由
const settingsSrc = read('js/srs.js');
chk(/SM-17\s*~\s*SM-20/.test(settingsSrc) && /闭源/.test(settingsSrc),
  'js/srs.js 说明了 SM-17~SM-20 为何做不了（私有闭源）');
chk(/HLR/.test(settingsSrc) && /碎片化/.test(settingsSrc),
  'js/srs.js 说明了 HLR（多邻国）为何没做（碎片化语言练习那一路）');

/* ---- 1.1 各算法真的不一样（否则「切换」等于换个名字） ---- */
function series(algoId, n, result) {
  // ⚠️ 用固定的 now 推进，不要每轮重新取 Date.now()：
  //    下一次复习落在「目标日 09:00」，而 Date.now() 在这段循环里会往前挪，
  //    于是同一轮的天数差额会随运行钟点漂移（夜里跑差 3 天、清早跑差 4 天），
  //    断言就会时红时绿。固定 now + 按上一轮的目标日推进，结果才是确定的。
  let now = Date.now();
  let rec = { level: 0, nextReviewAt: now, lastReviewAt: null, reviewCount: 0, lapses: 0, learned: false, history: [] };
  const days = [];
  for (let i = 0; i < n; i++) {
    const step = SRS.next(algoId, rec, result || 'good', now);
    days.push(Math.round((step.nextReviewAt - now) / DAY));
    rec = Object.assign({}, rec, {
      level: step.level,
      nextReviewAt: step.nextReviewAt,
      lapses: step.lapses,
      learned: true,
      attempted: true,
      reviewCount: i + 1,
      lastReviewAt: now,
      srs: Object.assign({}, rec.srs, { [algoId]: step.vars })
    });
    now = step.nextReviewAt;
  }
  return days;
}

// 序列判的是**相邻两轮的间隔阶梯**（第一轮从「今天 09:00」起算，
// 若此刻已过 09:00 就落在明天，绝对值会随运行钟点差 1 天）
const stepOf = d => d.slice(1).map((v, i) => v - d[i]);
const seriesOf = {};
SRS.ALGOS.forEach(a => { seriesOf[a.id] = series(a.id, 6); });
SRS.ALGOS.forEach(a => {
  const d = seriesOf[a.id];
  chk(d.every((v, i) => i === 0 ? true : v >= d[i - 1] - 1), a.id + ' 的复习间隔整体递增（' + d.join('/') + ' 天）');
});
const uniq = new Set(SRS.ALGOS.map(a => seriesOf[a.id].join(',')));
chk(uniq.size === 4, '四档算出来的间隔序列两两不同（' + uniq.size + ' 种）');
// 目标日固定落在「那天的 09:00」，所以从当前时刻（可能是当天任何钟点）
// 折算出来的天数是 n 或 n+1。这里判的是**轮数阶梯**：相邻两轮的天数差
// 应当等于当前算法定的间隔 —— 那才是真正要验的东西。
chk(stepOf(seriesOf.ebbinghaus).join(',') === '2,2,3,8,15',
  '遗忘曲线档就是原来那张表 1/2/4/7/15/30（阶梯 ' + stepOf(seriesOf.ebbinghaus).join('/') + '）');
chk(stepOf(seriesOf.leitner).join(',') === '2,2,4,8,0',
  '莱特纳盒按盒子递进 1/2/4/8/16 天，出盒后封顶（阶梯 ' + stepOf(seriesOf.leitner).join('/') + '）');
// SM-2 的间隔按 EF 连乘放大：第 3 轮之后进入「乘法区」
chk(seriesOf.sm2[2] > seriesOf.sm2[1] * 2,
  'SM-2 从第 3 轮起按简易度连乘放大（' + seriesOf.sm2.join('/') + ' 天）');
chk(seriesOf.fsrs[5] < seriesOf.sm2[5],
  'FSRS 长期间隔比 SM-2 收敛（' + seriesOf.fsrs.join('/') + ' vs ' + seriesOf.sm2.join('/') + '）');

/* ---- 1.2 三支复盘行为：忘记一定会回到短期、模糊一定不推进 ---- */
SRS.ALGOS.forEach(a => {
  let rec = { level: 4, nextReviewAt: Date.now(), lastReviewAt: Date.now(), reviewCount: 4, lapses: 0, learned: true, attempted: true, history: [] };
  const bad = SRS.next(a.id, rec, 'bad');
  chk(bad.nextReviewAt < Date.now() + 60 * 60 * 1000 && bad.lapses === 1,
    a.id + '：选了「忘记」→ 一小时内再见，且记下一次遗忘（实际 ' +
    Math.round((bad.nextReviewAt - Date.now()) / 60000) + ' 分钟）');
  chk(bad.level < rec.level, a.id + '：选了「忘记」→ 阶段回落（' + rec.level + '→' + bad.level + '）');

  const fuzzy = SRS.next(a.id, rec, 'fuzzy');
  chk(fuzzy.level === rec.level, a.id + '：选了「模糊」→ 阶段不推进');
  chk(fuzzy.nextReviewAt < Date.now() + 24 * 60 * 60 * 1000,
    a.id + '：选了「模糊」→ 当天之内再过一遍');
});

/* ---- 1.3 掌握度：未学过为 0，走到末档接近 100，且都在 0~100 内 ---- */
SRS.ALGOS.forEach(a => {
  const top = { level: a.maxLevel(), nextReviewAt: Date.now(), lastReviewAt: Date.now(), reviewCount: 9, lapses: 0, learned: true, attempted: true };
  const m = a.mastery(top);
  chk(m >= 80 && m <= 100, a.id + '：走完全程的掌握度在 80~100（实际 ' + m + '）');
  const low = a.mastery({ level: 0, lapses: 4, learned: true });
  chk(low >= 0 && low <= 45, a.id + '：新学且频繁忘记的掌握度偏低（实际 ' + low + '）');
});

/* ---- 1.4 档案里各算法的私有变量各存一格，互不覆盖 ---- */
let rec = { level: 0, nextReviewAt: Date.now(), lastReviewAt: null, reviewCount: 0, lapses: 0, learned: false, history: [] };
const sm2Step = SRS.next('sm2', rec, 'good');
const fsrsStep = SRS.next('fsrs', rec, 'good');
chk(sm2Step.vars && typeof sm2Step.vars.ef === 'number' && sm2Step.vars.ef <= 2.5,
  'SM-2 在档案里留下简易度 EF（' + (sm2Step.vars && sm2Step.vars.ef) + '）');
chk(fsrsStep.vars && typeof fsrsStep.vars.s === 'number' && typeof fsrsStep.vars.d === 'number',
  'FSRS 在档案里留下稳定性 S 与难度 D');
chk(Object.keys(sm2Step.vars).join(',') === 'ef' && Object.keys(fsrsStep.vars).join(',') === 's,d',
  '两档各写各的一格（SM-2: ef ｜ FSRS: s,d），彼此不覆盖');

/* ================= 二、调度器跟着算法走（vm，无 DOM） ================= */
function loadScheduler(settings) {
  const store = {};
  if (settings) store.poem_recite_settings_v1 = JSON.stringify(settings);
  const sb = {
    window: {},
    console,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  };
  sb.window = sb;
  vm.createContext(sb);
  ['data/text-master',
    'data/poems-1', 'data/poems-2', 'data/poems-3', 'data/poems-4', 'data/poems-5', 'data/poems-6',
    'data/poems-7', 'data/poems-8', 'data/poems-9', 'data/poems-10', 'data/poems-11', 'data/poems-12', 'data/index',
    'js/storage', 'js/srs', 'js/scheduler'].forEach(f =>
      vm.runInContext(read(f + '.js'), sb, { filename: f }));
  return sb;
}

const dflt = loadScheduler();
const S = dflt.Scheduler;
chk(S.algo().id === 'ebbinghaus', '调度器默认取到的就是艾宾浩斯档');
chk(JSON.stringify(S.INTERVALS) === JSON.stringify([0, 1, 2, 4, 7, 15, 30, 60, 120, 240]),
  '默认档的间隔序列与升级前逐字一致（老用户的排期零变化）');
chk(S.stages().length === 10 && S.stages()[1] === '1天后' && S.stages()[9] === '已牢固',
  '默认档的 10 档阶段名与升级前一致');

// 默认档下三支复盘行为与升级前逐条对照（这些数字是站上跑了很久的原有口径）
let r3 = S.createRecord();
for (let i = 0; i < 3; i++) r3 = S.review(r3, 'good');
chk(r3.level === 3, '默认档：连续记住 3 次 → level=3');
const d0 = new Date(); d0.setHours(0, 0, 0, 0);
const targetDay = d0.getTime() + 4 * DAY + 9 * 3600000;
chk(Math.abs(r3.nextReviewAt - targetDay) < 1000, '默认档：第 3 阶段的下次复习仍在第 4 天 09:00');
let rf = S.createRecord(); rf = S.review(rf, 'good'); const lv0 = rf.level; rf = S.review(rf, 'fuzzy');
chk(rf.level === lv0 && rf.nextReviewAt < Date.now() + 13 * 3600000 + 1000,
  '默认档：模糊不升级、12 小时后再来');
let rb = S.createRecord(); rb = S.review(rb, 'good'); rb = S.review(rb, 'good');
const b0 = rb.level; rb = S.review(rb, 'bad');
chk(rb.level === b0 - 1 && rb.lapses === 1 && rb.nextReviewAt < Date.now() + 31 * 60000 + 1000,
  '默认档：忘记降一级、记一次遗忘、30 分钟后再来');
chk(S.mastery(S.review(S.createRecord(), 'good')) === 16,
  '默认档：第一次记住后的掌握度仍是 16%（与升级前同一个算式）');

// 换算法：档位数、档名、掌握度、间隔都得跟着变
const lt = loadScheduler({ grade: 1, term: 1, dailyCount: 5, srs: 'leitner' });
chk(lt.Scheduler.algo().id === 'leitner', '换成莱特纳盒后调度器取到的是这一档');
chk(lt.Scheduler.stages().length === 6, '莱特纳盒只有 6 盒 —— 阶段数跟着算法变（实际 ' + lt.Scheduler.stages().length + '）');
chk(/第1盒/.test(lt.Scheduler.stages()[0]), '莱特纳盒的阶段名是「第 N 盒」（' + lt.Scheduler.stages()[0] + '）');
chk(lt.Scheduler.overview([{ id: 'x' }], () => null).levelCounts.length === 6,
  '进度总览按当前算法铺刻度（6 档），不写死成 10 档');

const sm = loadScheduler({ grade: 1, term: 1, dailyCount: 5, srs: 'sm2' });
chk(sm.Scheduler.algo().id === 'sm2', '换成 SM-2 后调度器取到的是这一档');
let sr = sm.Scheduler.createRecord();
sr = sm.Scheduler.review(sr, 'good');
sr = sm.Scheduler.review(sr, 'good');
chk(sm.Scheduler.levelName(sr.level, sr) === '6天后',
  'SM-2 的阶段名就是间隔本身（第 2 轮 = 6 天后，实际 ' + sm.Scheduler.levelName(sr.level, sr) + '）');
chk(sr.srs && sr.srs.sm2 && typeof sr.srs.sm2.ef === 'number',
  'SM-2 的 EF 真的写进了档案的 srs.sm2 那一格');

const fs_ = loadScheduler({ grade: 1, term: 1, dailyCount: 5, srs: 'fsrs' });
chk(fs_.Scheduler.algo().id === 'fsrs', '换成 FSRS 后调度器取到的是这一档');
let fr = fs_.Scheduler.createRecord();
fr = fs_.Scheduler.review(fr, 'good');
chk(fr.srs && fr.srs.fsrs && fr.srs.fsrs.s > 0, 'FSRS 的稳定性 S 真的写进了档案');
chk(/刚记住|较牢|牢固/.test(fs_.Scheduler.stages()[1]), 'FSRS 的阶段名是人话档名（' + fs_.Scheduler.stages()[1] + '）');

// 脏值 / 老档（没有 srs 字段）→ 回默认档，不猜
const dirty = loadScheduler({ grade: 1, term: 1, dailyCount: 5, srs: 'super-memo-20' });
chk(dirty.Scheduler.algo().id === 'ebbinghaus',
  '设置里是不认识的算法（如私有闭源的 SM-20）→ 回落默认档，不猜');
const legacy = loadScheduler({ grade: 1, term: 1, dailyCount: 5 });
chk(legacy.Scheduler.algo().id === 'ebbinghaus', '老档（没有 srs 字段）→ 仍是艾宾浩斯，与升级前一致');

// 老档的档案（没有 attempted 字段）照样算「已学过、该复习」
chk(S.isDue({ level: 2, learned: true, nextReviewAt: Date.now() - 1000 }) === true,
  '老档案（只有 learned，没有 attempted）照旧算到期');
chk(S.isDue({ level: 0, nextReviewAt: Date.now() - 1000 }) === false,
  '没背过的篇目不算「到期」（那条路是今天新学）');

// 每日计划：换算法后照样排满，且不重算历史进度
function planOf(sbw) {
  return sbw.Scheduler.generateDailyPlan({
    grade: 1, term: 1, count: 5,
    provider: sbw.getPoemsByGradeTerm,
    getRecord: id => sbw.Storage.get(id)
  });
}
SEARCH: for (const [name, env] of [['默认', dflt], ['莱特纳盒', lt], ['SM-2', sm], ['FSRS', fs_]]) {
  const p = planOf(env);
  chk(p.length === 5, name + ' 档下每日计划照样 5 首（实际 ' + p.length + '）');
}

/* ================= 三、设置页（jsdom） ================= */
const settingsHtml = read('settings/index.html');

function bootSettings(seed) {
  const dom = new JSDOM(settingsHtml, { runScripts: 'dangerously', url: 'https://local.test/settings/' });
  const { window } = dom;
  if (seed) Object.keys(seed).forEach(k => window.localStorage.setItem(k, seed[k]));
  const order = settingsHtml.match(/<script src="([^"]+)"><\/script>/g)
    .map(s => s.match(/src="([^"]+)"/)[1]);
  order.forEach(f => {
    const el = window.document.createElement('script');
    el.textContent = read(f.replace(/^\//, ''));
    window.document.body.appendChild(el);
  });
  return new Promise(r => setTimeout(() => r({ window, d: window.document }), 300));
}

(async () => {
  // 3.1 四档都画出来了
  let s = await bootSettings(null);
  const opts = [...s.d.querySelectorAll('#seg-srs .srs-opt')];
  chk(opts.length === 4, '设置页渲染出四档背诵算法（实际 ' + opts.length + '）');
  chk(s.d.querySelector('#seg-srs').getAttribute('role') === 'radiogroup' &&
    opts.every(b => b.getAttribute('role') === 'radio'),
    '四档是一组单选（radiogroup + radio），不是四个各自为政的按钮');
  chk(opts.filter(b => b.getAttribute('aria-checked') === 'true').length === 1 &&
    opts.find(b => b.classList.contains('active')).dataset.srs === 'ebbinghaus',
    '默认选中艾宾浩斯遗忘曲线');
  chk(opts.map(b => b.querySelector('.play-mode-name').textContent).join('/') ===
    '艾宾浩斯遗忘曲线/莱特纳盒/SM-2/FSRS',
    '四档的正式名与需求里列的一致（' + opts.map(b => b.querySelector('.play-mode-name').textContent).join('/') + '）');
  chk(opts.map(b => b.querySelector('.play-mode-note').textContent.match(/^(\d{4})/)[1]).join(',') ===
    '1885,1972,1987,2022',
    '每档都标了提出年份（1885 / 1972 / 1987 / 2022）');
  const hint = s.d.querySelector('#srs-hint').textContent;
  chk(/当前：艾宾浩斯遗忘曲线/.test(hint), '档位下方回显当前算法（' + hint + '）');
  chk(s.d.querySelector('#srs-intro').textContent.length > 30, '当前算法有一段说明文字');
  chk(/0 → 1 → 2 → 4 → 7 → 15 → 30 → 60 → 120 → 240/.test(s.d.querySelector('#srs-intervals').textContent),
    '「当前算法的节奏」列出这张间隔表（' + s.d.querySelector('#srs-intervals').textContent.slice(0, 40) + '…）');

  // 3.2 换档：写设置 + 选中态立刻跟上 + 说明与间隔表跟着换
  s.d.querySelector('#seg-srs .srs-opt[data-srs="fsrs"]')
    .dispatchEvent(new s.window.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 80));
  const saved = JSON.parse(s.window.localStorage.getItem('poem_recite_settings_v1'));
  chk(saved.srs === 'fsrs', '设置页选档写进 poem_recite_settings_v1 的 srs 字段（实际 ' + saved.srs + '）');
  chk(s.d.querySelectorAll('#seg-srs .srs-opt.active').length === 1 &&
    s.d.querySelector('#seg-srs .srs-opt.active').dataset.srs === 'fsrs',
    '选中态立刻跟着走，且仍只有一个');
  chk(/当前：FSRS/.test(s.d.querySelector('#srs-hint').textContent),
    '回显跟着换成 FSRS（' + s.d.querySelector('#srs-hint').textContent.slice(0, 24) + '…）');
  chk(/三变量|稳定性/.test(s.d.querySelector('#srs-intro').textContent),
    '说明文字跟着换成这一档的（FSRS 那段）');
  chk(s.d.querySelector('#srs-intervals').textContent === '复习间隔（天）：0 → 1 → 4 → 11 → 27 → 65',
    '间隔表跟着换成 FSRS 的（实际「' + s.d.querySelector('#srs-intervals').textContent + '」）');
  chk(/不会重算/.test(s.d.querySelector('#srs-note').textContent),
    '页面写明「切换不重算已有进度」，避免用户以为进度被动过');
  // 换档后原先那份设置里的其它字段不能被冲掉
  chk(saved.grade !== undefined && saved.dailyCount !== undefined,
    '换算法只改 srs 一个字段，其余设置原样保留');

  // 3.3 刷新后保持（读的是同一份 localStorage）
  const s2 = await bootSettings({ poem_recite_settings_v1: JSON.stringify({ grade: 1, term: 1, dailyCount: 5, srs: 'sm2' }) });
  chk(s2.d.querySelector('#seg-srs .srs-opt.active').dataset.srs === 'sm2',
    '刷新后仍停在用户选的那一档（SM-2）');
  // 3.4 脏值 → 选中项落在默认档
  const s3 = await bootSettings({ poem_recite_settings_v1: JSON.stringify({ grade: 1, term: 1, dailyCount: 5, srs: 'no-such-algo' }) });
  chk(s3.d.querySelectorAll('#seg-srs .srs-opt.active').length === 1 &&
    s3.d.querySelector('#seg-srs .srs-opt.active').dataset.srs === 'ebbinghaus',
    '本机值不认识时选中项落在默认档（显示的就是真正会跑的那一档）');
  chk(![...s3.d.querySelectorAll('#seg-srs .srs-opt')].some(b => b.dataset.srs === 'no-such-algo'),
    '那个野生值不会出现在选项里');

  // 3.5 两组单选互不干扰：换算法不该把「连读方式」的选中态弄乱
  s3.window.localStorage.setItem('poem_play_mode_v1', 'seq-trans');
  const s4 = await bootSettings({
    poem_recite_settings_v1: JSON.stringify({ grade: 1, term: 1, dailyCount: 5, srs: 'leitner' }),
    poem_play_mode_v1: 'seq-trans'
  });
  chk(s4.d.querySelectorAll('#seg-play .play-mode-opt').length === 5 &&
    s4.d.querySelector('#seg-play .play-mode-opt.active').dataset.playMode === 'seq-trans',
    '新增的算法单选不影响「连读方式」那一组（两组各五个/四个选项互不干扰）');

  /* ================= 四、首页副标题「按 XX 复习」 ================= */
  const homeHtml = read('index.html');

  function bootHome(seed) {
    const dom = new JSDOM(homeHtml, { runScripts: 'dangerously', url: 'https://local.test/' });
    const { window } = dom;
    if (seed) Object.keys(seed).forEach(k => window.localStorage.setItem(k, seed[k]));
    const order = homeHtml.match(/<script src="([^"]+)"><\/script>/g)
      .map(x => x.match(/src="([^"]+)"/)[1]);
    order.forEach(f => {
      const el = window.document.createElement('script');
      // 数据文件很大，但 jsdom 里跑得动；ct 之外没有别的依赖
      el.textContent = read(f);
      window.document.body.appendChild(el);
    });
    return new Promise(r => setTimeout(() => r({ window, d: window.document }), 600));
  }

  const cases = [
    [null, '按遗忘曲线复习'],
    ['ebbinghaus', '按遗忘曲线复习'],
    ['leitner', '按莱特纳盒复习'],
    ['sm2', '按 SM-2 复习'],
    ['fsrs', '按 FSRS 复习']
  ];
  for (const [srsId, expect] of cases) {
    const seed = srsId ? { poem_recite_settings_v1: JSON.stringify({ grade: 1, term: 1, dailyCount: 5, srs: srsId }) } : null;
    const h = await bootHome(seed);
    const sub = h.d.querySelector('#brand-sub');
    chk(sub && sub.textContent === expect,
      (srsId || '默认') + ' → 顶栏第二行「' + expect + '」（实际「' + (sub ? sub.textContent : '缺失') + '」）');
    // chrome.js 重绘顶栏时会读 body 的 data-sub；它必须同步，否则旧文案会被顶回来
    chk(h.d.body.getAttribute('data-sub') === expect,
      (srsId || '默认') + ' → body 的 data-sub 同步为「' + expect + '」（否则顶栏下次重绘会顶回旧文案）');
  }

  // 需求里点名的那两种：「按 SM-2 复习」「按 FSRS 复习」确实出现
  const hSm = await bootHome({ poem_recite_settings_v1: JSON.stringify({ grade: 1, term: 1, dailyCount: 5, srs: 'sm2' }) });
  chk(/SM-2/.test(hSm.d.querySelector('#brand-sub').textContent), '用户原话里的「按 SM-2 复习」真的是这样显示');
  const hF = await bootHome({ poem_recite_settings_v1: JSON.stringify({ grade: 1, term: 1, dailyCount: 5, srs: 'fsrs' }) });
  chk(hF.d.querySelector('#brand-sub').textContent === '按 FSRS 复习', '「按 FSRS 复习」真的是这样显示');

  // 首页不再硬编码某一种算法名（以后加档不用回来改页面）
  chk(!/按遗忘曲线复习/.test(homeHtml.replace(/<!--[\s\S]*?-->/g, '')),
    'index.html 的 data-sub 不再写死「按遗忘曲线复习」（算法名由 JS 按设置写）');

  /* ================= 五、切换不重算历史进度 ================= */
  // 先按遗忘曲线背出几首，形成 level / nextReviewAt；再换算法启动，档案必须一字不动
  // 先把「按遗忘曲线背过几轮」的进度写进一份 localStorage（这就是老用户的现状），
  // 再用同一份进度 + 换成 FSRS 启动一次，看它是否被重写
  const seedProgress = {
    'p-1': {
      level: 4, learned: true, attempted: true, lastReviewAt: Date.now() - DAY,
      nextReviewAt: Date.now() + 5 * DAY, reviewCount: 5, lapses: 0, history: []
    }
  };
  const before = loadScheduler({ grade: 1, term: 1, dailyCount: 5 });
  before.localStorage.setItem('poem_recite_progress_v1', JSON.stringify(seedProgress));
  const snapshot = before.localStorage.getItem('poem_recite_progress_v1');

  const after = loadScheduler({ grade: 1, term: 1, dailyCount: 5, srs: 'fsrs' });
  after.localStorage.setItem('poem_recite_progress_v1', snapshot);
  // 真正「用一遍」：排出今日计划、读一遍档案（这一步最可能顺手动数据）
  after.Scheduler.generateDailyPlan({
    grade: 1, term: 1, count: 5,
    provider: after.getPoemsByGradeTerm,
    getRecord: id => after.Storage.get(id)
  });
  after.Storage.get('p-1');
  const afterRaw = after.localStorage.getItem('poem_recite_progress_v1');
  const a1 = JSON.parse(snapshot)['p-1'];
  const a2 = JSON.parse(afterRaw)['p-1'];
  chk(snapshot === afterRaw,
    '启动时按新算法读一遍，不会重写已形成的档案（level / 下次复习时间原封不动）');
  chk(a2.level === 4 && a2.nextReviewAt === a1.nextReviewAt,
    '换了算法之后这一篇仍在第 4 阶段、下次复习仍是原来那一天');
  // 但「下一次复习」按新算法算
  const afterRec = after.Storage.get('p-1');
  const stepped = after.Scheduler.review(afterRec, 'good');
  chk(stepped.srs && stepped.srs.fsrs && stepped.srs.fsrs.s > 0,
    '换档之后新产生的复习记录按新算法走（FSRS 写下了 S）');
  chk(after.Scheduler.levelName(stepped.level, stepped) !==
    before.Scheduler.levelName(stepped.level, stepped),
    '同一阶段在两种算法下的档名不同（界面上的说法真的跟着算法走了）');

  console.log('');
  if (fails) {
    console.log('❌ ' + fails + ' 项失败');
    process.exit(1);
  }
  console.log('🎉 背诵算法切换测试全部通过');
})();
