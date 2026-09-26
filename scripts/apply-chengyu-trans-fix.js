#!/usr/bin/env node
/* 把 data/chengyu-trans-fix.js 里的手工修订落到译文上
   --------------------------------------------------------------------------
   译文住在 data/text-master.js（生成物）里，直接改会被下一次重跑覆盖。
   本脚本排在流水线的最后一步（build-works-map.js 之后），按标题找到主表里的
   那一条，把 translation 换成修订表里的那一句 —— 幂等，反复跑结果不变。

   只改译文，不动正文、不动条目表（正文的改动归 apply-chengyu-gloss.js 等
   各管一段）。改完自己核对：修订表点名的每一条都命中了，没命中就判红。
*/
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const MASTER_FILE = path.join(ROOT, 'data/text-master.js');

const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
['data/chengyu-trans-fix.js', 'data/poems-chengyu.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
});
const FIX = sandbox.CHENGYU_TRANS_FIX || {};
const ID_OF = {};
(sandbox.POEMS_CHENGYU || []).forEach(function (p) { ID_OF[p.title] = 'chengyu-' + p.id; });

let src = fs.readFileSync(MASTER_FILE, 'utf8');
const missed = [];
let changed = 0;

Object.keys(FIX).forEach(function (title) {
  const id = ID_OF[title];
  if (!id) { missed.push(title + '（库里没有这一条）'); return; }

  const at = src.indexOf('    id: ' + JSON.stringify(id) + ',\n');
  if (at < 0) { missed.push(title + '（主表里没有 ' + id + '）'); return; }
  const start = src.lastIndexOf('  {\n', at);
  const end = src.indexOf('\n  },', at);
  if (start < 0 || end < 0) { missed.push(title + '（主表里的条目读不出来）'); return; }

  let block = src.slice(start, end);
  const m = block.match(/translation:\s*("(?:[^"\\]|\\.)*")/);
  if (!m) { missed.push(title + '（这一条没有 translation 一行）'); return; }

  const want = JSON.stringify(FIX[title].translation);
  if (m[1] === want) return;                       // 已经是改过的样子
  block = block.replace(/translation:\s*"(?:[^"\\]|\\.)*"/, 'translation: ' + want);
  src = src.slice(0, start) + block + src.slice(end);
  changed += 1;
});

fs.writeFileSync(MASTER_FILE, src, 'utf8');

if (missed.length) {
  console.error('✗ 修订表里这几条没落到译文上：' + missed.join('、'));
  process.exit(1);
}

// 复读一次，确认改后的译文真的进了主表（而不是只改了字符串）
const check = { window: {}, console };
check.window = check;
vm.createContext(check);
['data/text-master.js', 'data/poems-chengyu.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), check, { filename: f });
});
const bad = Object.keys(FIX).filter(function (title) {
  const p = (check.POEMS_CHENGYU || []).filter(function (x) { return x.title === title; })[0];
  if (!p) return false;
  return check.masterTextOf(p, 'chengyu').translation !== FIX[title].translation;
});
if (bad.length) {
  console.error('✗ 改过的译文读回来对不上：' + bad.join('、'));
  process.exit(1);
}

console.log('✓ 译文修订：改动 ' + changed + ' 则（表内共 ' + Object.keys(FIX).length + ' 则），已复读核对。');
