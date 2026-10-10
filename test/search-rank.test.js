// 搜索页 / 首页候选的排名（Issue #539，用户 2026-10-10）
//
// 用户原话：
//   「在搜索页的搜索框中输入 王安石，不显示 书湖阴先生壁，但是在首页今日加背
//    输入 王安石，却能显示 书湖阴先生壁。搜索页应该能搜索全部的，不知道为什么」
//
// 根因（不是「搜不到」，是**排不进去**）：
//
//   · 输入一个作者名，命中的十几条**全落在同一档**（作者档 = 3）；
//   · 同分原判据只有「篇名短的在前」——于是《梅花》《元日》在前，
//     《书湖阴先生壁》落到第 10 位；
//   · 候选下拉只留 8 条（SUGGEST_MAX），第 10 位就掉出去了。
//
//   首页那侧之所以「能显示」，是因为它默认只挂着**课内诗词**一部集子，
//   王安石在课内只有 6 首，够不上 8 条的边；搜索页挂着全部集子，
//   同一位作者十几首，就顶掉了。
//
// 修法：同分时**课内诗词排前面**（与 data/works-index.js 的 BOOK_RANK 同口径），
//       两张下拉（搜索页 / 首页）都改，次序一致。
//
// 这一条走**功能判据**：真挂搜索页的数据与脚本，量候选次序。
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

// 搜索页挂的数据（data/ 前缀那一批，顺序照 search/index.html）
const html = fs.readFileSync(path.join(ROOT, 'search/index.html'), 'utf8');
const DATA = html.match(/<script src="(data\/[^"]+)"><\/script>/g)
  .map(s => s.match(/src="([^"]+)"/)[1]);

function makeSandbox() {
  const sb = { console };
  sb.window = sb;
  // boot() 是「DOMContentLoaded 之后」才跑的那一段；让它停在 loading，
  // 这里只借 SiteSearch.suggest() 这枚口子量排名，不起页面。
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
  return sb;
}

const { loadData } = require('./master-env');
const sb = makeSandbox();
vm.createContext(sb);
loadData(sb, DATA);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/search.js'), 'utf8'), sb, { filename: 'js/search.js' });

const S = sb.SiteSearch;
chk(!!S, 'SiteSearch 挂上了');

const items = S.items();
const drop = S.suggest('王安石');
const titles = drop.map(p => p.title);

console.log('');
console.log('=== 一、问题现场：搜作者，课内那首得进候选 ===');
console.log('候选：' + titles.join(' | '));
chk(titles.indexOf('书湖阴先生壁') >= 0, '「王安石」的候选里有《书湖阴先生壁》（原来被截在第 10 位）');
chk(titles.length <= 8, '候选仍在 SUGGEST_MAX = 8 条以内（实际 ' + titles.length + '）');

console.log('');
console.log('=== 二、同分先看集子：课内诗词排在课外前面 ===');
const top6 = drop.slice(0, 6).map(p => p.book);
chk(top6.every(b => b === 'poems'),
  '「王安石」前 6 条全是课内诗词（实际 ' + top6.join(',') + '）');
// 排到课外之后的那几条，作者都还是王安石（分数档没被破坏）
const rest = drop.slice(6);
chk(rest.every(p => (p.author || '').indexOf('王安石') >= 0),
  '候选里课内之外的那些，作者仍命中「王安石」（分数档没乱）');

console.log('');
console.log('=== 三、全量结果不受候选截断影响（「搜全部的」） ===');
const allHits = items.filter(p => (p.author || '').indexOf('王安石') >= 0 || (p.title || '').indexOf('王安石') >= 0);
chk(allHits.some(p => p.title === '书湖阴先生壁'),
  '全站条目（items）里确实有《书湖阴先生壁》（id ' +
  (allHits.filter(p => p.title === '书湖阴先生壁').map(p => p.id).join(',') || '无') + '）');

console.log('');
console.log('=== 四、首页（daily-extra-ui）同一口径 ===');
const uiSrc = fs.readFileSync(path.join(ROOT, 'js/daily-extra-ui.js'), 'utf8');
chk(/function bookRankOf\(p\) \{ return p && p\.book === "poems" \? 0 : 1; \}/.test(uiSrc),
  'daily-extra-ui 也有 bookRankOf（课内优先）');
chk(/var ra = bookRankOf\(a\);\s*var rb = bookRankOf\(b\);/.test(uiSrc),
  'daily-extra-ui 的 suggestOf 同分时按集子排');

console.log('');
if (fails) {
  console.log('✗ ' + fails + ' 项未通过');
  process.exit(1);
}
console.log('全部通过');
