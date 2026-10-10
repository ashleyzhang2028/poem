// 候选下拉「滚到底再续一批」（Issue #539 追问，用户 2026-10-10）
//
// 用户原话：
//   「为什么不是当用户下拉到后面，例如第8个，就自动继续加载第二批次的8个，
//    如果有的话，而不是完全没机会显示了」
//
// 这一版就做这件事：候选先铺 `SUGGEST_MAX = 8` 条，框里滚到底
// （差一行以内）再续 `SUGGEST_BATCH = 8` 条，直到把**全量命中**铺完。
//
// 为什么不一次铺完：单字「一」在全站命中 1390+ 条（2033 条共 1391 条），
// 一次铺几百行 DOM 正是 Issue #370 那笔卡顿账。先铺一批、滚了再续，
// 既不挡着「我就想看看第 9 条」的人，也不为没滚到的地方付费。
//
// 判据分两层：
//   ① 量：`SiteSearch.suggest(kw, n)` 的 n 能要到全量 —— 截断不再写死在 8；
//   ② 源：滚动那一段确实挂在候选框上、续的是同一个词、有停的时候。
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const searchSrc = fs.readFileSync(path.join(ROOT, 'js/search.js'), 'utf8');
const uiSrc = fs.readFileSync(path.join(ROOT, 'js/daily-extra-ui.js'), 'utf8');

console.log('');
console.log('=== 一、量：候选不再只给 8 条，能一路要到全量 ===');

const html = fs.readFileSync(path.join(ROOT, 'search/index.html'), 'utf8');
const DATA = html.match(/<script src="(data\/[^"]+)"><\/script>/g)
  .map(s => s.match(/src="([^"]+)"/)[1]);

const sb = { console };
sb.window = sb;
sb.document = {
  readyState: 'loading',
  addEventListener() {},
  getElementById() { return null; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  documentElement: { setAttribute() {}, removeAttribute() {} }
};
sb.setTimeout = () => 0;
sb.clearTimeout = () => {};

const { loadData } = require('./master-env');
vm.createContext(sb);
loadData(sb, DATA);
vm.runInContext(searchSrc, sb, { filename: 'js/search.js' });

const S = sb.SiteSearch;
chk(!!S, 'SiteSearch 挂上了');

const first = S.suggest('王安石');
chk(first.length === 8, '第一批还是 8 条（不打扰原来的手感，实际 ' + first.length + '）');

const batch2 = S.suggest('王安石', 16);
chk(batch2.length === 14, '要 16 条就给到全量 14 条（「王安石」一共只命中 14）');
chk(batch2.slice(0, 8).map(p => p.id).join(',') === first.map(p => p.id).join(','),
  '续上来的那批是接在第一批后面的（前 8 条次序一点没动）');
chk(batch2.slice(8).every(p => (p.author || '').indexOf('王安石') >= 0),
  '第二批仍全是「王安石」的命中（不是乱续别的）');

const one = S.suggest('一', Infinity);
chk(one.length > 1000, '「一」这种单字能要到全量（实际 ' + one.length + ' 条）—— 原来它跟「王安石」一样只看得见 8 条');

console.log('');
console.log('=== 二、源：滚到底续一批，续的是同一个词 ===');

chk(/var SUGGEST_BATCH = 8;/.test(searchSrc), '搜索页有 SUGGEST_BATCH = 8（每批的宽度）');
chk(/function suggestShown\(box, kw\)/.test(searchSrc),
  '铺了多少条记在**框上**（data-kw / data-shown），不跟输入框抢状态');
chk(/box\.dataset\.kw !== kw/.test(searchSrc),
  '换词就从头一批起 —— 不然会把上一个词的条数带到新词上');
chk(/function extendSuggest\(\)/.test(searchSrc) && /insertAdjacentHTML\("beforeend"/.test(searchSrc),
  '续批走 beforeend 追加，不重画整个框（重画会把滚动位置打回顶）');
chk(/if \(shown >= total\) return false;/.test(searchSrc),
  '没有下一批了就不动 —— 铺完自然停');
chk(/hitsOf\(q\)\.slice\(0, Math\.max\(0, cap\)\)/.test(searchSrc),
  'suggestItems 的截断挪到调用方（limit 缺省仍是 8，老调用不受影响）');

const scrollFn = searchSrc.slice(searchSrc.indexOf('function bindSuggestScroll()'),
  searchSrc.indexOf('function bindSuggestDismiss()'));
chk(scrollFn.length > 0, 'bindSuggestScroll() 在');
chk(/box\.addEventListener\("scroll"/.test(scrollFn),
  '滚动监听的挂法是**候选框自己** —— 挂文档上会在页面别处滚时误触');
chk(/passive: true/.test(scrollFn), 'passive 监听，不拦滚动手感');
chk(/nearSuggestBottom\(box\)/.test(scrollFn), '只在快到底时才续（留一行余量）');
chk(/setTimeout\(extendSuggest, SUGGEST_EXTEND_GAP\)/.test(scrollFn),
  '续批合并（滚动一路触发，不能每帧都铺）');
chk(/function nearSuggestBottom\(box\) \{\s*return box\.scrollHeight - box\.scrollTop - box\.clientHeight <= SUGGEST_ROW_H;\s*\}/.test(searchSrc),
  '「快到底」= scrollHeight - scrollTop - clientHeight ≤ 一行高');
chk(/bindSuggestScroll\(\);/.test(searchSrc), 'boot 里挂上了');

console.log('');
console.log('=== 三、首页「今日加背」下拉同一套 ===');

chk(/var SUGGEST_BATCH = 8;/.test(uiSrc), 'daily-extra-ui 也有 SUGGEST_BATCH');
chk(/function suggestOf\(kw, limit\)/.test(uiSrc), 'suggestOf 收得下 limit');
chk(/function extend\(\)/.test(uiSrc) && /box\.insertAdjacentHTML\("beforeend"/.test(uiSrc),
  '首页那侧也是追加');
chk(/box\.addEventListener\("scroll"/.test(uiSrc), '首页那侧也是在框上监听滚动');

console.log('');
if (fails) {
  console.log('✗ ' + fails + ' 项未通过');
  process.exit(1);
}
console.log('全部通过');
