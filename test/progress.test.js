const { JSDOM } = require('jsdom');
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

// 页面里那些 `src="js/xxx.js"` 要按仓库根目录解析 —— 这一步在各版 jsdom 上
// 走的是**两套不同的口子**：
//   · jsdom 26 及以前：`resources` 收一个自定义 loader（必须**继承真实的
//     ResourceLoader**，不然 jsdom 会静默忽略它、所有脚本都不加载 ——
//     症状是「课内 261 首都没进来」，而报错指向一个无关的断言）；
//   · jsdom 27 起：私有的 `window._resourceLoader` 没了，`resources` 改成
//     `{ interceptors }`（官方的 `requestInterceptor`）。
// 两种都认，谁在就用谁。
function repoResources(root) {
  const jd = require('jsdom');
  if (typeof jd.ResourceLoader === 'function') {
    class RepoLoader extends jd.ResourceLoader {
      fetch(url) {
        const file = require('path').join(root, decodeURIComponent(new URL(url).pathname));
        if (fs.existsSync(file)) return Promise.resolve(fs.readFileSync(file));
        return Promise.reject(new Error('not found: ' + url));
      }
    }
    return new RepoLoader({ userAgent: 'jsdom-test' });
  }
  return {
    interceptors: [
      jd.requestInterceptor(async request => {
        let file = null;
        try { file = require('path').join(root, decodeURIComponent(new URL(request.url).pathname)); }
        catch (e) { return undefined; }
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return undefined;
        const body = fs.readFileSync(file);
        const type = file.endsWith('.css') ? 'text/css'
          : file.endsWith('.json') ? 'application/json'
          : file.endsWith('.js') ? 'text/javascript'
          : 'application/octet-stream';
        return new Response(body, { headers: { 'Content-Type': type } });
      })
    ]
  };
}

const DAY2 = 86400000;

function openPage(progress) {
  const d = new JSDOM(html, {
    runScripts: 'dangerously', resources: repoResources(path), url: 'https://local.test/progress/'
  });
  if (progress) d.window.localStorage.setItem('poem_recite_progress_v1', JSON.stringify(progress));
  return d;
}

const probe = openPage();

setTimeout(() => {
  const all = probe.window.POEMS_ALL;
  chk(all && all.length === 251, '课内 251 首批入（实际 ' + (all ? all.length : 'undefined') + '）');

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

    chk(mRows[0].querySelector('.bar-count').textContent === '2',
      '掌握度第一档（0-19%）显示 2 篇（第 0 阶那首 5% + 第 1 阶那首 16%）');
    const lRows = d.querySelectorAll('#progress-levels .bar-row');
    chk(lRows.length === 10, '记忆阶段画了 10 档（实际 ' + lRows.length + '）');
    chk(lRows[lRows.length - 1].querySelector('.bar-count').textContent === '1',
      '「已牢固」那一档显示 1 篇（第 9 阶那首）');

    const dueBlocks = d.querySelectorAll('#progress-duelist .duelist-day');
    chk(dueBlocks.length >= 2, '到期篇目清单画出了分档（今天 + 第 3 天；实际 ' +
      dueBlocks.length + ' 档）');
    chk(dueBlocks[0].classList.contains('today'), '第一档是「今天」');
    chk(dueBlocks[0].textContent.indexOf('今天') >= 0, '第一档写着「今天」');

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

    chk(d.querySelector('#progress-duelist .duelist-day[data-offset="3"] .duelist-count')
      .textContent === cells[3].querySelector('.cal-count').textContent + ' 篇',
      '清单第 3 档的篇数与日历第 3 格一致（同一本账）');

    const dueLink = dueBlocks[0].querySelector('.duelist-item');
    chk(dueLink && /^\/\?poem=/.test(dueLink.getAttribute('href')),
      '篇名是指回首页的链接（/?poem=<id>；这一页只读，不在原地改）');
    chk((d.querySelector('#duelist-note') || {}).textContent.indexOf('更远还有 1 篇') >= 0,
      '超出 14 天窗口的那一篇只报个数（「更远还有 1 篇」，写在脚注里）');

    const lateHead = d.querySelector('#progress-duelist .duelist-overdue-head');
    chk(!!lateHead && lateHead.textContent.indexOf('逾期超过一周 · 1 篇') >= 0,
      '逾期超过一周的另挂一截「逾期超过一周 · 1 篇」（实际「' +
      (lateHead ? lateHead.textContent : '（没有这一截）') + '」）');
    const lateItems = d.querySelectorAll('#progress-duelist .duelist-items.late .duelist-item');
    chk(lateItems.length === 1 &&
      lateItems[0].getAttribute('href') === '/?poem=' + encodeURIComponent(all[3].id),
      '那一截里列出逾期 9 天那一篇，篇名同样指回首页（实际 ' +
      (lateItems[0] ? lateItems[0].getAttribute('href') : '（没有）') + '）');

    const todayBlockHead = dueBlocks[0].querySelector('.duelist-count').textContent;
    chk(todayBlockHead === cells[0].querySelector('.cal-count').textContent + ' 篇',
      '清单「今天」那一档的表头 = 日历「今天」那一格（backlog 不并进今天；实际 ' +
      todayBlockHead + ' / ' + cells[0].querySelector('.cal-count').textContent + ' 篇）');

    const sub0 = (d.querySelector('#duelist-sub') || {}).textContent || '';
    chk(sub0.indexOf('今天 ' + cells[0].querySelector('.cal-count').textContent + ' 篇') >= 0,
      '汇总行的「今天 N 篇」与日历今天那一格同数（实际「' + sub0 + '」）');
    chk(sub0.indexOf('逾期超一周 1 篇') >= 0,
      '汇总行把逾期超过一周的单独说一句，不混进「今天」（实际「' + sub0 + '」）');

    chk(cells[3].getAttribute('data-offset') === '3' && cells[3].getAttribute('role') === 'button',
      '日历每一格带 data-offset，挂 role=button（点了跳到那一档）');

    const stats = d.querySelectorAll('#progress-stats .stat');
    chk(stats.length === 4, '总览四格（已学 / 待复习 / 平均掌握 / 尚未学过）');
    chk(d.querySelector('#progress-stats').textContent.indexOf('已学') >= 0,
      '四格里第一格是「已学」');
    chk(d.querySelector('#progress-stats').textContent.indexOf('247') >= 0,
      '「尚未学过」= 251 - 4 = 247（实际那一格：' +
      d.querySelectorAll('#progress-stats .stat')[3].textContent + '）');

    chk(w2.localStorage.getItem('poem_recite_progress_v1') === JSON.stringify(progress),
      '进这一页**一个字节都没改进度**（这是「看进度」的地方，不是改的地方）');
    chk(w2.localStorage.getItem('poem_classic_read_v1') === null,
      '不写任何一部的「已读」标记');
    chk(w2.sessionStorage.length === 0,
      '不排今日任务、不写计划缓存（sessionStorage 空）');

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

      const settingsHtml = fs.readFileSync(path + 'settings/recite/index.html', 'utf8');
      chk(/href="\/progress\/"/.test(settingsHtml),
        '设置页有进「进度总览」的链接（/progress/）');

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

      const appSrc4 = fs.readFileSync(path + 'js/app.js', 'utf8');
      chk(/function backfillSnapshots\(/.test(appSrc4),
        '首页启动时仍会刷新一次快照（课内那几条就地更新）');
      chk(/function refreshStaleSnapshots\(/.test(appSrc4),
        '首页有「按需拉回集子数据、刷新旧快照」的入口 refreshStaleSnapshots()');
      chk(/function staleByBook\(/.test(appSrc4),
        '按集子把还旧着的快照挑出来（staleByBook）');
      chk(/refreshStaleSnapshots\(\)/.test(appSrc4),
        'refreshStaleSnapshots() 真的挂在启动流程里（不是写了不调）');

      chk(/if \(!books\.length\) return Promise\.resolve\(0\);/.test(appSrc4),
        '没有任何旧快照时不发请求（一部都不涉及就直接返回）');
      chk(/const BOOK_SOURCES = \{/.test(appSrc4) &&
        ['classic', 'tangshi', 'songci', 'guwen', 'zhaoming', 'yuanqu'].every(b =>
          new RegExp(b + ':').test(appSrc4)),
        '七部集子的数据文件与全局名写死在 BOOK_SOURCES（不 eval 任何东西）');
      chk(/el\.src = src\.file/.test(appSrc4) && /document\.createElement\("script"\)/.test(appSrc4),
        '拉取走的是「新建 <script>」——与页面里那些 <script> 同一条路（同一个 SW 缓存）');

      chk(/refreshStaleSnapshots\(\)\.catch\(function \(\) \{[^}]*\}\)/.test(appSrc4),
        '拉取失败不影响用（catch 吞掉错误：离线时老快照照常显示，stale 留着下次再试）');

      const homeHtml = fs.readFileSync(path + 'index.html', 'utf8');
      const homeOrder = homeHtml.match(/<script src="([^"]+)"><\/script>/g)
        .map(x => x.match(/src="([^"]+)"/)[1]);
      const homeDom = new JSDOM(homeHtml, {
        runScripts: 'dangerously', resources: repoResources(path), url: 'https://local.test/'
      });
      const wh = homeDom.window;
      wh.scrollTo = function () {};

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

      homeOrder.forEach(f => {
        const el = wh.document.createElement('script');
        el.textContent = fs.readFileSync(path + f, 'utf8');
        wh.document.body.appendChild(el);
      });

      setTimeout(() => {

        setTimeout(() => {
          const snap = JSON.parse(wh.localStorage.getItem('poem_recite_collections_v1'))
            .collections[0].items[0];
          chk(snap.snap && snap.snap.title === realTitle,
            '首页自己把那一部集子拉回来，快照刷成了最新语料（题名 ' +
            (snap.snap && snap.snap.title) + '）');
          chk(snap.snap.text && snap.snap.text.length > 20,
            '刷回来的正文也是完整的（旧快照里那句只有 22 字的残句被换掉）');
          chk(!snap.stale, '刷新成功后 stale 标记被清掉（下次启动就不会再拉一遍）');

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
