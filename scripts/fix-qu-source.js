/* ==========================================================================
   曲 · 出处精细化（Issue #512）
   --------------------------------------------------------------------------
   《曲》集子 31 条，`source` 原先一律写总集名「《全元散曲》」—— 详情页只读
   `source`，于是《天净沙·秋思》读到「《全元散曲》」，看不出它出自马致远的
   《东篱乐府》。

   按《唐诗》《词》《昭明文选》《古文观止》那套口径改为两重出处：

     source     这首曲**所出之书**（曲家散曲别集 / 辑本，如《东篱乐府》）
     selection  收它的**总集**（《全元散曲》）

   详情页两枚标签并列（`source` 实心在前、`selection` 浅色在后），于是
   《天净沙·秋思》读到的是「元 · 马致远 · 《东篱乐府》 · 《全元散曲》」。

   精确出处怎么定：
     · **表定** —— 曲家在 scripts/data/qu-works.js 里的散曲别集 / 辑本；
     · **总集** —— 无散曲专集、零篇散见的，表里退到《全元散曲》。

   幂等：只处理 `source` 仍是「《全元散曲》」且尚无 `selection` 的那些。
   `id` / 正文 / 题名 / 作者 / 朝代 / 宫调一律不动，进度键不断链。

   ⚠️ 这是脚本、不是数据 —— 表在 scripts/data/qu-works.js，改完重跑即可。
      用法：node scripts/fix-qu-source.js
   ========================================================================== */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TARGET = path.join(ROOT, 'data/poems-yuanqu.js');
const ZONGJI = '《全元散曲》';

function loadWorks() {
  const sandbox = { window: {}, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'data/qu-works.js'), 'utf8'), sandbox);
  return sandbox.window.QU_WORKS;
}

function loadItems() {
  const sandbox = { window: {}, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(TARGET, 'utf8'), sandbox, { filename: TARGET });
  return sandbox.window.POEMS_YUANQU;
}

const BOOK = loadWorks();
const items = loadItems();

const missing = {};
items.forEach(function (p) {
  if (!BOOK[p.author]) (missing[p.author] = missing[p.author] || []).push(p.id);
});
if (Object.keys(missing).length) {
  console.error('✗ 下列曲家的所出之书没有裁定，表不全：');
  Object.keys(missing).forEach(function (a) { console.error('  ' + a + ' → ' + missing[a].join(', ')); });
  process.exit(1);
}

const targets = items.filter(function (p) { return p.source === ZONGJI && !p.selection; })
  .map(function (p) { return p.id; });
const targetSet = {};
targets.forEach(function (id) { targetSet[id] = true; });

let src = fs.readFileSync(TARGET, 'utf8');
let touched = 0;
const report = {};

items.forEach(function (p) {
  if (!targetSet[p.id]) return;
  const want = BOOK[p.author];
  const block = 'id: "' + p.id + '"';
  const at = src.indexOf(block);
  if (at < 0) throw new Error('找不到条目 ' + p.id);
  const end = src.indexOf('\n  },', at);
  if (end < 0) throw new Error('条目 ' + p.id + ' 的结尾找不到');
  let seg = src.slice(at, end);

  const before = seg;
  seg = seg.replace(/source: "[^"]*"/, 'source: ' + JSON.stringify(want));
  if (/\n/.test(seg)) {
    if (/selection: "[^"]*"/.test(seg)) {
      seg = seg.replace(/selection: "[^"]*"/, 'selection: ' + JSON.stringify(ZONGJI));
    } else {
      seg = seg.replace(/(\n\s*)dynasty:/, '$1selection: ' + JSON.stringify(ZONGJI) + ',$1dynasty:');
    }
  } else {
    seg = seg.replace(/(source: "[^"]*",\s*)/, '$1selection: ' + JSON.stringify(ZONGJI) + ', ');
  }
  if (seg === before) throw new Error(p.id + ' 的出处字段没换到');

  src = src.slice(0, at) + seg + src.slice(end);
  touched++;
  report[want] = (report[want] || 0) + 1;
});

fs.writeFileSync(TARGET, src);

const after = loadItems();
/* 只验这一轮该动的：现在每条都该有 selection；source 允许仍为《全元散曲》
   （无散曲别集的曲家，总集就是它的所出之书）。 */
const stillOld = after.filter(function (p) { return targetSet[p.id] && !p.selection; });
console.log('✔ data/poems-yuanqu.js：出处精细化 ' + touched + ' 条，剩余旧写法 ' + stillOld.length + ' 条');
console.log('  按所出之书：' + Object.keys(report).sort().map(function (k) {
  return k + ' ' + report[k];
}).join(' / '));
if (stillOld.length) {
  console.error('✗ 仍有旧写法：' + stillOld.slice(0, 10).map(function (p) { return p.id + '(' + p.author + ')'; }).join(', '));
  process.exit(1);
}
