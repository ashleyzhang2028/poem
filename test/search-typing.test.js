// 搜索页「敲几个字再删」的性能（Issue #370 第五轮，用户 2026-10-05）
//
// 用户原话：
//   「目前搜索页输完三个字四个字，进行删除的时候，性能特别差 有任何改进的办法吗」
//
// 真机复现（Chromium 153 · CDP）后，量出来的是这一段：
//
//   「春」        →  5.3 s   （1149 行 DOM）
//   「春江」      →  339 ms
//   「春江花月夜」 →  172 ms
//   再删回「春」  →  5.7 s   （同一件事又做一遍）
//
// 两个真账：
//
//   ① **为两千条不展出的条目白建行**。搜索页每敲一个字都
//      `api.setItems(allItems())` —— 阅读器于是把 5405 行 DOM 建起来，
//      再拿 keyword 滤出命中集重画一遍。单字（「春」「一」「月」）在
//      5405 条里命中两千上下，两笔账叠在一起就是秒级。
//   ② **每条重算一遍折叠字段**。matchScore 每个字对 5405 条的正文 / 译文 /
//      释义 / 注脚各折一次大小写 —— 单次翻出去一个字就是十兆字符。
//
// 界面测试层已按 Issue #278 删除，所以这里**只做静态判据**（读源码），
// 不起浏览器。真机对照数见 PR 描述；要自己量，跑 `node scripts/serve.js`
// 再按 PR 里那段 CDP 脚本走一遍。
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const src = fs.readFileSync(path.join(root, 'js/search.js'), 'utf8');

const pick = (head, tail) => {
  const a = src.indexOf(head);
  return a < 0 ? '' : src.slice(a, src.indexOf(tail, a));
};

console.log('');
console.log('=== 一、不再每敲一字重算一遍全表 ===');

const allFn = pick('function allItems()', 'function suggestBox()');
chk(allFn.length > 0, 'allItems() 还在（命中集的底本）');
chk(/allCache/.test(allFn) && /allCacheKey/.test(allFn),
  'allItems() 带缓存 —— 判重结果算一次就够，不再每个字重走 5595 条');
chk(/if \(allCache && allCacheKey === key\) return allCache;/.test(allFn),
  '缓存命中直接返回（SITE_INDEX / WorksIndex 启动后不动，这张表不会过期）');

console.log('');
console.log('=== 二、匹配走预折叠索引，不在每次比对里现折 ===');

chk(/var fieldCache = null;/.test(src) && /function itemFields\(\)/.test(src),
  '预折叠字段表（itemFields）在，一条一项只折一次');
chk(/f\.title\.indexOf\(q\) >= 0\) return 4;/.test(src) &&
    /f\.author\.indexOf\(q\) >= 0\) return 3;/.test(src) &&
    /f\.rest\.indexOf\(q\) >= 0\) return 2;/.test(src) &&
    /f\.body\.indexOf\(q\) >= 0\) return 1;/.test(src),
  '分数档照旧：4 篇名 / 3 作者 / 2 书目 / 1 正文');
chk(!/function matchScore\(/.test(src),
  'matchScore 不再每字现折 —— 那是对 5405 条正文各折一遍大小写的地方');

console.log('');
console.log('=== 三、查询串带缓存（删字时必然重扫同一串） ===');

chk(/var queryCache = \{\};/.test(src) && /var queryOrder = \[\];/.test(src),
  '查询结果按查询串缓存');
chk(/if \(queryCache\[q\]\) return queryCache\[q\];/.test(src),
  '同一条查两次不重扫');
chk(/QUERY_CACHE_MAX/.test(src) && /delete queryCache\[queryOrder\.shift\(\)\]/.test(src),
  '缓存有上界（只留最近 QUERY_CACHE_MAX 条）');

console.log('');
console.log('=== 四、只给「会展出的那一段」建行 ===');

chk(/var SEARCH_MAX = 100;/.test(src), 'SEARCH_MAX = 100');
const renderHits = pick('function renderHits(', 'function suggestMeta(');
chk(renderHits.length > 0, 'renderHits() 在');
chk(/all\.length > SEARCH_MAX \? all\.slice\(0, SEARCH_MAX\) : all/.test(renderHits),
  '按**排名**截到 SEARCH_MAX —— 截掉的一定排在展出之后');
chk(/api\.setItems\(q \? renderHits\(q\) : \[\]\);/.test(src),
  'renderBody 喂给阅读器的是截过的命中集，不再是 allItems() 全表');

console.log('');
console.log('=== 五、keyword 与 items 的顺序（阅读器每次改动都重画列表） ===');

const body = pick('function renderBody()', 'function syncEmptyState(');
chk(/api\.setKeyword\(""\);\s*\n\s*api\.setItems\(/.test(body),
  '先清 keyword 再 setItems —— 否则同一批条目会被重画两遍');

console.log('');
console.log('=== 六、命中行上那句「…上下文…」不再每行扫全表 ===');

const ann = pick('function annotateMatches(', 'function matchContext(');
chk(ann.length > 0, 'annotateMatches() 在');
chk(!/allItems\(\)\.filter/.test(ann),
  '每行不再 allItems().filter(...) 找自己（页均两三千次 × 5405）');
chk(/var byIdMap = \{\};/.test(ann) && /hits\.forEach\(function \(p\) \{ byIdMap\[p\.id\] = p; \}\);/.test(ann),
  '改成按 id 建一张小表，每行 O(1) 取自己');

console.log('');
if (fails) {
  console.log('✗ ' + fails + ' 项未通过');
  process.exit(1);
}
console.log('全部通过');
