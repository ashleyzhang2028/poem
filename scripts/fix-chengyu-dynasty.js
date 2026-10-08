#!/usr/bin/env node
/* ==========================================================================
   成语 · 朝代归位（Issue #512 P2）
   --------------------------------------------------------------------------
   表在 scripts/data/chengyu-dynasty-512.js（判据写在那张表的文件头）。
   这一支只落笔，幂等。

   ⚠️ 只动 **壳**（data/poems-chengyu.js）的 `dynasty` 与 `gradeGroup` 两栏
     —— 集内的导航分组 `gradeGroup` 与朝代是**同一件事**（一个朝代一段），
     改了朝代不同步分组，列表页就分到别人那一段里去了。
     正文 / 译文 / id 一律不动。

   用法：node scripts/fix-chengyu-dynasty.js [--dry]
   ========================================================================== */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { BOOK_DYNASTY, ITEMS } = require('./data/chengyu-dynasty-512.js');
const DRY = process.argv.indexOf('--dry') >= 0;
const FILE = path.join(ROOT, 'data/poems-chengyu.js');

const sb = { window: {}, console }; sb.window = sb; vm.createContext(sb);
vm.runInContext(fs.readFileSync(FILE, 'utf8'), sb, { filename: FILE });
const CY = sb.POEMS_CHENGYU || [];

const DYNASTIES = ['上古传说', '夏', '商', '西周', '春秋', '战国', '秦', '西汉', '东汉',
  '三国', '两晋南北朝', '隋', '唐', '五代', '宋', '辽金', '元', '明', '清'];

function bookKey(p) {
  const m = String(p.source || '').match(/《([^》·]+)(?:·[^》]*)?》/);
  return m ? m[1] : null;
}

/* 先算出每一条应归的朝代。 */
const plan = {};
CY.forEach(function (p) {
  if (Object.prototype.hasOwnProperty.call(ITEMS, p.id)) {
    if (ITEMS[p.id]) plan[p.id] = ITEMS[p.id];
    return;
  }
  const b = bookKey(p);
  if (!b) return;
  const want = BOOK_DYNASTY[b + '|' + p.author];
  if (want && p.dynasty !== want) plan[p.id] = want;
});

const ids = Object.keys(plan);
if (DYNASTIES.indexOf('辽金') >= 0) { /* 朝代表里这一档存在 */ }
ids.forEach(function (id) {
  if (DYNASTIES.indexOf(plan[id]) < 0) {
    console.error('✗ 朝代不在朝代表内：' + id + ' → ' + plan[id]);
    process.exit(1);
  }
});

if (DRY) {
  const byBook = {};
  ids.forEach(function (id) {
    const p = CY.filter(function (x) { return x.id === id; })[0];
    const k = p.source + ' · ' + p.dynasty + ' → ' + plan[id];
    (byBook[k] = byBook[k] || []).push(p.title);
  });
  Object.keys(byBook).sort().forEach(function (k) {
    console.log(k + '（' + byBook[k].length + '）：' + byBook[k].slice(0, 6).join('、') +
      (byBook[k].length > 6 ? ' …' : ''));
  });
  console.log('\n（预演）共 ' + ids.length + ' 条待归位，未改任何文件。');
  process.exit(0);
}

let src = fs.readFileSync(FILE, 'utf8');
let touched = 0;
const report = {};

ids.forEach(function (id) {
  const p = CY.filter(function (x) { return x.id === id; })[0];
  const block = '    id: ' + JSON.stringify(id) + ',';
  const at = src.indexOf(block);
  if (at < 0) throw new Error('找不到条目块：' + id);
  const end = src.indexOf('\n  },', at);
  let seg = src.slice(at, end);
  const before = seg;
  seg = seg.replace(/dynasty: "[^"]*"/, 'dynasty: ' + JSON.stringify(plan[id]));
  /* 导航分组与朝代同源（一个朝代一段），一并同步。 */
  seg = seg.replace(/gradeGroup: "[^"]*"/, 'gradeGroup: ' + JSON.stringify(plan[id]));
  if (seg === before) return;
  src = src.slice(0, at) + seg + src.slice(end);
  touched += 1;
  report[p.dynasty + ' → ' + plan[id]] = (report[p.dynasty + ' → ' + plan[id]] || 0) + 1;
});
fs.writeFileSync(FILE, src, 'utf8');

/* 收尾：复读一遍，确认全表再没有「同一部书同一署名人、朝代却不一致」的。 */
const sb2 = { window: {}, console }; sb2.window = sb2; vm.createContext(sb2);
vm.runInContext(fs.readFileSync(FILE, 'utf8'), sb2, { filename: FILE });
const after = sb2.POEMS_CHENGYU || [];
const stray = after.filter(function (p) {
  if (Object.prototype.hasOwnProperty.call(ITEMS, p.id)) return false;
  const b = bookKey(p);
  if (!b) return false;
  const want = BOOK_DYNASTY[b + '|' + p.author];
  return want && p.dynasty !== want;
});

console.log('✔ 成语朝代归位 ' + touched + ' 条：' + Object.keys(report).sort().map(function (k) {
  return k + ' × ' + report[k];
}).join(' / '));
if (stray.length) {
  console.error('✗ 仍有归位不彻底的：' + stray.slice(0, 8).map(function (p) {
    return p.id + '(' + p.title + ' ' + p.dynasty + ')';
  }).join('、'));
  process.exit(1);
}
