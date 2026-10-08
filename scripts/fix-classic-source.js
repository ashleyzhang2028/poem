#!/usr/bin/env node
/* ==========================================================================
   小古文 · 出处勘正（Issue #512）
   --------------------------------------------------------------------------
   表在 scripts/data/classic-source-512.js，这一支只落笔。幂等。

   ⚠️ 小古文这条线的源头是**壳**（data/poems-classic.js）：source / dynasty /
      author 都在壳里，正文与译文在主表（data/text-master.js）。本轮只动出处
      那一栏，正文一个字不改 —— 所以主表不用碰。

   用法：node scripts/fix-classic-source.js
   ========================================================================== */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TABLE = require('./data/classic-source-512.js');
const FILE = path.join(ROOT, 'data/poems-classic.js');

const sb = { window: {}, console }; sb.window = sb; vm.createContext(sb);
vm.runInContext(fs.readFileSync(FILE, 'utf8'), sb, { filename: FILE });
const byId = {};
(sb.POEMS_CLASSIC || []).forEach(function (p) { byId[p.id] = p; });

const missing = Object.keys(TABLE).filter(function (id) { return !byId[id]; });
if (missing.length) {
  console.error('✗ 集内找不到这些条目：' + missing.join('、'));
  process.exit(1);
}

let src = fs.readFileSync(FILE, 'utf8');
let touched = 0;

Object.keys(TABLE).forEach(function (id) {
  const want = TABLE[id];
  const p = byId[id];
  if (p.source === want.source && p.dynasty === want.dynasty && p.author === want.author) return;

  const block = '    id: ' + JSON.stringify(id) + ',';
  const at = src.indexOf(block);
  if (at < 0) throw new Error('找不到条目块：' + id);
  const end = src.indexOf('\n  },', at);
  let seg = src.slice(at, end);
  if (want.source) seg = seg.replace(/source: "[^"]*"/, 'source: ' + JSON.stringify(want.source));
  if (want.dynasty) seg = seg.replace(/dynasty: "[^"]*"/, 'dynasty: ' + JSON.stringify(want.dynasty));
  if (want.author) seg = seg.replace(/author: "[^"]*"/, 'author: ' + JSON.stringify(want.author));
  src = src.slice(0, at) + seg + src.slice(end);
  touched += 1;
});
fs.writeFileSync(FILE, src, 'utf8');

const sb2 = { window: {}, console }; sb2.window = sb2; vm.createContext(sb2);
vm.runInContext(fs.readFileSync(FILE, 'utf8'), sb2, { filename: FILE });
const after = {};
(sb2.POEMS_CLASSIC || []).forEach(function (p) { after[p.id] = p; });

const bad = [];
Object.keys(TABLE).forEach(function (id) {
  const want = TABLE[id];
  const p = after[id];
  if (want.source && p.source !== want.source) bad.push(id + ' 的 source 没落到壳上');
});

console.log('✔ 小古文出处勘正 ' + Object.keys(TABLE).length + ' 条（本轮改动 ' + touched + ' 条）：');
Object.keys(TABLE).forEach(function (id) {
  const p = after[id];
  console.log('    ' + p.title + '（' + id + '） → ' + p.source + '（' + p.dynasty + ' · ' + p.author + '）');
});
if (bad.length) {
  console.error('\n✗ 自检未过：');
  bad.forEach(function (x) { console.error('    ' + x); });
  process.exit(1);
}
