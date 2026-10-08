#!/usr/bin/env node
/* ==========================================================================
   成语 · 出处 / 朝代勘正（Issue #512）
   --------------------------------------------------------------------------
   表在 scripts/data/chengyu-source-512.js，这一支只负责落笔。幂等：同一条
   落过就不再动。

   ⚠️ 三张表都要改 —— 成语这条线的**唯一源头是流水线里那三张表**：
        data/poems-chengyu.js   壳（title / source / dynasty / author / group）
        data/text-master.js     正文与译文（text / translation / version）
        data/chengyu-meaning.js 释义
        data/chengyu-gloss.js   语源
      只改壳、不改表，下一轮 build-chengyu.js 一跑就被打回原样（#512 之前
      几十则「凭空的原文」就是这么来的 —— 表里写的是编的句子）。

   为什么要动 data/text-master.js：它是**生成文件**，但它同时是
   apply-chengyu-yuben.js 的输入。正文不进主表，摘句与正文就永远对不上。

   用法：node scripts/fix-chengyu-source.js
   ========================================================================== */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TABLES = [
  require('./data/chengyu-source-512.js'),
  require('./data/chengyu-source-512b.js')
];
const TABLE = Object.assign({}, ...TABLES);

const CY_FILE = path.join(ROOT, 'data/poems-chengyu.js');
const MASTER_FILE = path.join(ROOT, 'data/text-master.js');
const MEANING_FILE = path.join(ROOT, 'data/chengyu-meaning.js');
const GLOSS_FILE = path.join(ROOT, 'data/chengyu-gloss.js');

const CY = (function () {
  const sb = { window: {}, console }; sb.window = sb; vm.createContext(sb);
  vm.runInContext(fs.readFileSync(CY_FILE, 'utf8'), sb, { filename: CY_FILE });
  return sb.POEMS_CHENGYU || [];
})();

const byTitle = {};
CY.forEach(function (p) { byTitle[p.title] = p; });

/* ---------- 一 · 壳：source / dynasty / author / gradeGroup ---------- */
let cySrc = fs.readFileSync(CY_FILE, 'utf8');
let shellTouched = 0;

Object.keys(TABLE).forEach(function (title) {
  const want = TABLE[title];
  const p = byTitle[title];
  if (!p) throw new Error('集内找不到成语：' + title);
  if (p.source === want.source && p.author === want.author &&
      p.dynasty === want.dynasty && p.gradeGroup === want.group &&
      (!want.excerpt || p.excerpt === want.excerpt)) return;

  const block = '    id: ' + JSON.stringify(p.id) + ',';
  const at = cySrc.indexOf(block);
  if (at < 0) throw new Error('找不到条目块：' + title);
  const end = cySrc.indexOf('\n  },', at);
  let seg = cySrc.slice(at, end);
  seg = seg.replace(/source: "[^"]*"/, 'source: ' + JSON.stringify(want.source))
           .replace(/dynasty: "[^"]*"/, 'dynasty: ' + JSON.stringify(want.dynasty))
           .replace(/author: "[^"]*"/, 'author: ' + JSON.stringify(want.author))
           .replace(/gradeGroup: "[^"]*"/, 'gradeGroup: ' + JSON.stringify(want.group));
  /* 摘句跟着正文换（摘句是**同步产物**，不是单独一栏 —— 改了正文不换它，
     build-chengyu.js 的自检「正文与摘句对不上」当场判红）。 */
  if (want.excerpt) {
    seg = seg.replace(/excerpt: "(?:[^"\\]|\\.)*"/, 'excerpt: ' + JSON.stringify(want.excerpt));
  }
  cySrc = cySrc.slice(0, at) + seg + cySrc.slice(end);
  shellTouched += 1;
});
fs.writeFileSync(CY_FILE, cySrc, 'utf8');

/* ---------- 二 · 主表：excerpt → text / translation ---------- */
let mMaster = fs.readFileSync(MASTER_FILE, 'utf8');
let masterTouched = 0;

Object.keys(TABLE).forEach(function (title) {
  const want = TABLE[title];
  const p = byTitle[title];
  const entryId = 'chengyu-' + p.id;
  const at = mMaster.indexOf('    id: ' + JSON.stringify(entryId) + ',\n');
  if (at < 0) throw new Error('主表里找不到：' + entryId + '（' + title + '）');
  const start = mMaster.lastIndexOf('  {\n', at);
  const end = mMaster.indexOf('\n  },', at);
  if (start < 0 || end < 0) throw new Error('主表切块失败：' + entryId);
  let block = mMaster.slice(start, end);

  if (want.text) {
    block = block.replace(/text:\s*"(?:[^"\\]|\\.)*"/, 'text: ' + JSON.stringify(want.text));
  }
  if (want.translation) {
    block = block.replace(/translation:\s*"(?:[^"\\]|\\.)*"/, 'translation: ' + JSON.stringify(want.translation));
  }
  mMaster = mMaster.slice(0, start) + block + mMaster.slice(end);
  masterTouched += 1;
});
fs.writeFileSync(MASTER_FILE, mMaster, 'utf8');

/* ---------- 三 · 释义表 / 语源表 ---------- */
function patchMap(file, constName, field, key) {
  let src = fs.readFileSync(file, 'utf8');
  let n = 0;
  Object.keys(TABLE).forEach(function (title) {
    const want = TABLE[title];
    if (!want[key]) return;
    const at = src.indexOf(JSON.stringify(title) + ':');
    if (at < 0) throw new Error(file + ' 里找不到：' + title);
    const lineEnd = src.indexOf('\n', at);
    const line = src.slice(at, lineEnd);
    if (line.indexOf(JSON.stringify(want[key])) >= 0) return;
    src = src.slice(0, at) + JSON.stringify(title) + ': ' + JSON.stringify(want[key]) + ',' + src.slice(lineEnd);
    n += 1;
  });
  fs.writeFileSync(file, src, 'utf8');
  return n;
}
const meaningTouched = patchMap(MEANING_FILE, 'CHENGYU_MEANING', 'meaning', 'meaning');
const glossTouched = patchMap(GLOSS_FILE, 'CHENGYU_GLOSS', 'gloss', 'gloss');

/* ---------- 自检：壳 / 表 / 主表三处必须一致 ---------- */
const sb = { window: {}, console }; sb.window = sb; vm.createContext(sb);
['data/text-master.js', 'data/poems-chengyu.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
});
const MASTER = {};
(sb.TEXT_MASTER || []).forEach(function (m) { (m.entries || []).forEach(function (e) { MASTER[e] = m; }); });
const CY2 = {};
(sb.POEMS_CHENGYU || []).forEach(function (p) { CY2[p.title] = p; });

const bad = [];
Object.keys(TABLE).forEach(function (title) {
  const want = TABLE[title];
  const p = CY2[title];
  const m = MASTER['chengyu-' + (p && p.id)];
  if (!p) { bad.push(title + '：集内没有'); return; }
  if (p.source !== want.source) bad.push(title + ' 的 source 没落到壳上');
  if (want.text && (!m || m.text !== want.text)) bad.push(title + ' 的正文没落到主表上');
  if (want.text && p.excerpt !== want.excerpt) bad.push(title + ' 的摘句没跟着换');
});

console.log('✔ 成语出处勘正 ' + Object.keys(TABLE).length + ' 则：');
console.log('    壳 ' + shellTouched + ' 条 / 主表 ' + masterTouched + ' 条 / 释义 ' + meaningTouched +
  ' 条 / 语源 ' + glossTouched + ' 条');
Object.keys(TABLE).forEach(function (t) {
  console.log('    ' + t + ' → ' + TABLE[t].source + '（' + TABLE[t].dynasty + ' · ' + TABLE[t].author + '）');
});
if (bad.length) {
  console.error('\n✗ 自检未过：');
  bad.forEach(function (x) { console.error('    ' + x); });
  process.exit(1);
}
