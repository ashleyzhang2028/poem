/* ==========================================================================
   词 · 选本条目出处精细化（Issue #512）
   --------------------------------------------------------------------------
   《词》集子里 288 条是《宋词三百首》选本条目，`source` 原先一律写选本名
   「《宋词三百首》」—— 详情页只读 `source`，于是《浣溪沙·一曲新词酒一杯》
   读到「《宋词三百首》」，看不出它出自《珠玉词》。

   按《唐诗》《昭明文选》《古文观止》那套口径改为两重出处：

     source     这首词**所出之书**（作者词别集，如《珠玉词》《东坡乐府》）
     selection  收它的**选本**（《宋词三百首》）

   详情页两枚标签并列（`source` 实心在前、`selection` 浅色在后），于是
   《浣溪沙》读到的是「宋 · 晏殊 · 《珠玉词》 · 《宋词三百首》」。

   精确出处怎么定：
     · **表定** —— 词人在 scripts/data/ci-works.js 里的词别集（逐家考订）；
     · **总集** —— 词集失传 / 存词零星的，表里退到《全宋词》。

   幂等：只处理 `source` 仍是「《宋词三百首》」的那些。`id` / 正文 / 题名 /
   作者 / 朝代 / 词牌一律不动，进度键不断链；只动 `source` 与补上 `selection`。

   ⚠️ 这是脚本、不是数据 —— 表在 scripts/data/ci-works.js，改完重跑即可。
      用法：node scripts/fix-songci-source.js
   ========================================================================== */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TARGET = path.join(ROOT, 'data/poems-songci.js');
const XUANBEN = '《宋词三百首》';

function loadWorks() {
  const sandbox = { window: {}, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'data/ci-works.js'), 'utf8'), sandbox);
  return sandbox.window.CI_WORKS;
}

function loadItems() {
  const sandbox = { window: {}, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(TARGET, 'utf8'), sandbox, { filename: TARGET });
  return sandbox.window.POEMS_SONGCI;
}

const BOOK = loadWorks();
const items = loadItems();

/* 表要覆盖所有选本条目里的词人，缺一个就停 —— 不让它悄悄漏过去。 */
const missing = {};
items.forEach(function (p) {
  if (p.source !== XUANBEN) return;
  if (!BOOK[p.author]) (missing[p.author] = missing[p.author] || []).push(p.id);
});
if (Object.keys(missing).length) {
  console.error('✗ 下列词人的所出之书没有裁定，表不全：');
  Object.keys(missing).forEach(function (a) { console.error('  ' + a + ' → ' + missing[a].join(', ')); });
  process.exit(1);
}

/* 本轮该动的条目 id（原 source 是选本名的那些），收尾只验这一批。 */
const targets = items.filter(function (p) { return p.source === XUANBEN; }).map(function (p) { return p.id; });
const targetSet = {};
targets.forEach(function (id) { targetSet[id] = true; });

let src = fs.readFileSync(TARGET, 'utf8');
let touched = 0;
const report = {};

items.forEach(function (p) {
  if (p.source !== XUANBEN) return;
  const want = BOOK[p.author];
  const block = 'id: "' + p.id + '"';
  const at = src.indexOf(block);
  if (at < 0) throw new Error('找不到条目 ' + p.id);
  const end = src.indexOf('\n  },', at);
  if (end < 0) throw new Error('条目 ' + p.id + ' 的结尾找不到');
  let seg = src.slice(at, end);

  const before = seg;
  seg = seg.replace(/source: "[^"]*"/, 'source: ' + JSON.stringify(want));
  /* 单行条目（sc-321 那种一行到底的）：在 source 之后补 selection。 */
  if (/\n/.test(seg)) {
    if (/selection: "[^"]*"/.test(seg)) {
      seg = seg.replace(/selection: "[^"]*"/, 'selection: ' + JSON.stringify(XUANBEN));
    } else {
      seg = seg.replace(/(\n\s*)dynasty:/, '$1selection: ' + JSON.stringify(XUANBEN) + ',$1dynasty:');
    }
  } else {
    seg = seg.replace(/(source: "[^"]*",\s*)/, '$1selection: ' + JSON.stringify(XUANBEN) + ', ');
  }
  if (seg === before) throw new Error(p.id + ' 的出处字段没换到');

  src = src.slice(0, at) + seg + src.slice(end);
  touched++;
  report[want] = (report[want] || 0) + 1;
});

fs.writeFileSync(TARGET, src);

const after = loadItems();
/* 只验这一轮该动的那些：原选本条目 —— 它们现在 source 应是精确集名、selection 应是选本名。
   其余 42 条（sc-290 起，五代 / 金 / 清 / 明 及宋的补录）本就不是选本条目，
   source 早写着自己那一本、没有 selection，不在本轮范围内。 */
const stillOld = after.filter(function (p) {
  return targetSet[p.id] && (p.source === XUANBEN || !p.selection);
});
console.log('✔ data/poems-songci.js：出处精细化 ' + touched + ' 条，剩余旧写法 ' + stillOld.length + ' 条');
console.log('  按所出之书：' + Object.keys(report).sort().map(function (k) {
  return k + ' ' + report[k];
}).join(' / '));
if (stillOld.length) {
  console.error('✗ 仍有旧写法：' + stillOld.slice(0, 10).map(function (p) { return p.id + '(' + p.author + ')'; }).join(', '));
  process.exit(1);
}
