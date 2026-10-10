// 事件上报（Issue #535）—— 静态判据
//
// GA 的 base tag 只报 page_view；这一层守的是「加了事件，别假加了」：
//
//   1. 每个跑 gtag 的页面都引到 js/analytics.js（不引 = 那个页面一个事件都发不出）
//   2. js/analytics.js 自己：没 gtag 时不抛（统计挂了不能带垮功能）、
//      只有白名单里的参数能出去（别把搜索词一类的东西顺手送走）
//   3. 几个约定要报的动作仍在原位 —— 连读、切换集子、翻页。
//      界面层按 Issue #278 删了，跑不了真浏览器，所以这里退一步钉源码：
//      判定的是「那一句还在」，不是「点一下真的报了」。够拦住手滑删掉，
//      拦不住重构 —— 但比没有强。
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.join(__dirname, '..');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// ---------------------------------------------------------------------------
// 1 · analytics.js 本身
// ---------------------------------------------------------------------------
const mod = read('js/analytics.js');
const sandbox = { window: {}, location: { pathname: '/classic/' } };
vm.createContext(sandbox);
new vm.Script(mod, { filename: 'js/analytics.js' }).runInContext(sandbox);
const A = sandbox.window.Analytics;

chk(!!A && typeof A.track === 'function', 'window.Analytics.track 挂上了');
chk(typeof A.defer === 'function', 'Analytics.defer 挂上了（片段里的事件靠它补上下文）');

// gtag 不在时不许抛 —— 脚本被拦、页面没挂 base tag 都会走到这里
let threw = null;
try { A.track('play_start', { mode: 'seq-origin' }); } catch (e) { threw = e; }
chk(!threw, '没有 gtag 时 track 静默返回，不抛（统计挂了不能带垮功能）');

// 有 gtag 时：事件名与参数各自就位
const sent = [];
sandbox.window.gtag = function () { sent.push(Array.prototype.slice.call(arguments)); };
A.track('play_start', { mode: 'seq-origin', source: 'all', 谁也没定义: 'x' });
chk(sent.length === 1 && sent[0][0] === 'event' && sent[0][1] === 'play_start',
  '有 gtag 时按 gtag("event", 名字, 参数) 送出去');
chk(sent.length === 1 && sent[0][2].mode === 'seq-origin' && sent[0][2].source === 'all',
  '白名单里的参数原样送');
chk(sent.length === 1 && !('谁也没定义' in sent[0][2]),
  '白名单外的参数被丢掉（不许顺手把别的东西送进 GA）');
chk(Object.keys(sent[0][2]).every(k => typeof sent[0][2][k] === 'string'),
  '参数一律转成字符串（GA 里混类型会把同一维裂成两列）');

chk(A.pageOf('/classic/') === 'classic' && A.pageOf('/library/index.html') === 'library',
  'pageOf 认得出集子页路径');
chk(A.pageOf('/settings/reader/') === '', 'pageOf 对非集子页给空串，不瞎猜');

// ---------------------------------------------------------------------------
// 2 · 页面引没引到
// ---------------------------------------------------------------------------
function htmlFiles(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) htmlFiles(p, out);
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

const withGA = [];
const noGA = [];
htmlFiles(root, []).forEach(function (f) {
  const src = fs.readFileSync(f, 'utf8');
  const tag = /googletagmanager\.com\/gtag\/js\?id=G-VEFD6BLJV5/.test(src);
  const mod = /js\/analytics\.js/.test(src);
  const rel = path.relative(root, f);
  if (!tag) { noGA.push(rel); return; }
  withGA.push(rel);
  chk(mod, rel + ' 挂了 GA 就引了 js/analytics.js');
  chk((src.match(/js\/analytics\.js/g) || []).length === 1, rel + ' 只引一份 analytics.js');
});
console.log('=== 带 GA 的页面共 ' + withGA.length + ' 个 ===');
chk(withGA.length >= 42, '带 GA 的页面都在（实际 ' + withGA.length + ' 个）');
/* 只有 admin/index-old.html 无引用、无 GA —— 死文件，两样都没有才对。 */
chk(noGA.every(f => f === 'admin/index-old.html'),
  '没挂 GA 的只剩死文件 admin/index-old.html（实际 ' + noGA.join(', ') + '）');

// ---------------------------------------------------------------------------
// 3 · 约定要报的动作还在不在
// ---------------------------------------------------------------------------
const core = read('js/reader-core.js');
const lib = read('js/library.js');
const chrome = read('js/chrome.js');

[
  ['play_start', core, /track\("play_start"/],
  ['play_stop', core, /track\("play_stop"/],
  ['play_mode_switch', core, /track\("play_mode_switch"/],
  ['play_blocked（语音门挡住时也要记一笔）', core, /track\("play_blocked"/],
  ['read_start', core, /track\("read_start"/],
  ['nav_switch（上一篇 / 下一篇）', core, /track\("nav_switch"/],
  ['list_filter（全部 / 未读）', core, /track\("list_filter"/],
  ['reader_open（打开阅读器）', core, /track\("reader_open"/],
  ['reader_close（关掉阅读器）', core, /track\("reader_close"/],
  ['mark_read', core, /track\("mark_read"/],
  ['daily_toggle', core, /track\("daily_toggle"/],
  ['recite_toggle', core, /track\("recite_toggle"/],
  ['book_open（切换集子）', lib, /track\("book_open"/],
  ['nav_go（底部导航）', chrome, /track\("nav_go"/]
].forEach(function (it) {
  chk(it[2].test(it[1]), 'reader-core/library/chrome 里仍有 ' + it[0]);
});

// 连读那颗键的两条路都要能分清来源：顶上（book）与分类卡（group）
chk(/function playLoc\(btn\)/.test(core) && /dataset\.randomGroup \? "group" : "book"/.test(core),
  'playLoc 分得出「分类卡上那颗」与「顶上那颗」');
chk(/enterBook\(bookId, place\)/.test(lib),
  'library 的 enterBook 带 place —— 「从网格进来」与「栏里换一部」得分得开');
chk(/enterBook\(entry\.id, "grid"\)/.test(lib), '网格上点卡的入口报了 from=grid');

console.log('');
if (fails) { console.log('失败 ' + fails + ' 项'); process.exit(1); }
console.log('全部通过');
