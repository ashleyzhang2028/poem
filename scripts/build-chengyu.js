#!/usr/bin/env node
const { execFileSync } = require('child_process');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const STEPS = [
  ['apply-chengyu-meaning.js', '写「成语释义」栏'],
  ['apply-chengyu-tier1.js', '追加第一档教材常用成语'],
  ['apply-chengyu-tier2.js', '追加第二至五档常用成语'],
  ['build-text-master.js', '正文收归主表'],
  ['apply-text-master.js', '摘去内联正文副本'],
  ['apply-chengyu-yuben.js', '把「（语本）」占位换成原句并同步摘句'],
  ['apply-chengyu-gloss.js', '把正文里的编者括注搬进「语源 / 典故」栏'],
  ['build-works-map.js', '重算同篇对照表'],
  ['apply-chengyu-trans-fix.js', '把手工表里的译文修订落到译文上']
];

STEPS.forEach(function (s) {
  console.log('\n── ' + s[1] + '（scripts/' + s[0] + '）');
  process.stdout.write(execFileSync(process.execPath, [path.join(ROOT, 'scripts', s[0])],
    { encoding: 'utf8' }));
});

console.log('\n── 自检');
const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
['data/text-master.js', 'data/chengyu-support.js', 'data/poems-chengyu.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
});
const CY = sandbox.POEMS_CHENGYU || [];
const expanded = CY.map(function (p) { return sandbox.masterTextOf(p, 'chengyu'); });

const ids = CY.map(function (p) { return p.id; });
const dupIds = ids.filter(function (x, i) { return ids.indexOf(x) !== i; });
const noMeaning = CY.filter(function (p) { return !p.meaning; });
const yuben = expanded.filter(function (p) { return /（语本）/.test(p.text || ''); });
const noText = expanded.filter(function (p) { return !p.text || !p.translation; });
const PAT = /（[^（）]*(语本|佛典|后世语|现代语|诗法|元曲|小说家言|禅典|西洋寓言|法寓言|原文作|同「|本《|见《|见宋人|宋人书|贾谊《|元诗选)/;
const stamped = expanded.filter(function (p) { return PAT.test(p.text || ''); });
function cleanX(s) { return String(s || '').replace(/（[^）]*）/g, '').replace(/\s/g, ''); }
const stray = expanded.filter(function (p) {
  const ex = cleanX(p.excerpt);
  if (!ex || !p.text) return false;
  return cleanX(p.text).indexOf(ex) < 0;
});

const rawSrc = fs.readFileSync(path.join(ROOT, 'data/poems-chengyu.js'), 'utf8')
  .split('\n');
const REF_LINE = /^\s*textRef:\s*"[^"]*",?\s*$/;
const dupRefs = [];
for (let i = 1; i < rawSrc.length; i += 1) {
  if (REF_LINE.test(rawSrc[i]) && REF_LINE.test(rawSrc[i - 1])) dupRefs.push(i + 1);
}

const bad = [];
if (dupIds.length) bad.push('重复 id：' + dupIds.join('、'));
if (noMeaning.length) bad.push('缺释义：' + noMeaning.length + ' 条');
if (yuben.length) bad.push('正文仍是「（语本）」占位：' + yuben.map(function (p) { return p.title; }).join('、'));
if (noText.length) bad.push('缺正文 / 译文：' + noText.map(function (p) { return p.title; }).join('、'));
if (dupRefs.length) bad.push('有条目连着两行 textRef（行号 ' + dupRefs.join('、') + '）');
if (stamped.length) bad.push('正文里还有编者括注：' + stamped.map(function (p) { return p.title; }).join('、'));
if (stray.length) bad.push('正文与自己的摘句对不上：' + stray.map(function (p) { return p.title; }).join('、'));

console.log('  成语总数：' + CY.length);
console.log('  释义覆盖：' + (CY.length - noMeaning.length) + '/' + CY.length);
console.log('  正文占位：「（语本）」剩 ' + yuben.length + ' 条');
console.log('  重复 textRef：' + dupRefs.length + ' 处');
console.log('  正文带编者括注：' + stamped.length + ' 则');
console.log('  正文与摘句对不上：' + stray.length + ' 则');
if (bad.length) {
  console.error('\n✗ 自检未过：');
  bad.forEach(function (x) { console.error('    ' + x); });
  process.exit(1);
}
console.log('\n✅ 成语流水线跑完，自检通过。');
