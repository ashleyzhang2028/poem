#!/usr/bin/env node
/* 成语集的完整离线流水线
   --------------------------------------------------------------------------
   成语这一部有手工维护的几份表，散着跑容易漏一步（漏了不报错，只是内容
   悄悄退回旧样）。把次序固定在这里，一条命令跑完：

     ① apply-chengyu-meaning.js   给首版 736 则写「成语释义」栏
     ② apply-chengyu-tier1.js     追加第一档教材常用成语（按朝代插段落）
     ③ apply-chengyu-tier2.js     追加第二至五档常用成语（同上）
     ④ build-text-master.js       正文收归主表（含拆条裁定）
     ⑤ apply-text-master.js       摘去内联副本 + 把拆过条的 textRef 指回自身
     ⑥ build-works-map.js         重算同篇对照表

   只改文本、不改结构，所以任何一步都可以反复跑（幂等）。
   跑完自己会核对：条数、释义覆盖、有没有重复 id、原文里还有没有「（语本）」占位。
*/
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

// ── 自检 ──────────────────────────────────────────────────────────────────
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
// 正文里不该再有编者括注（「（佛典）」「（语本元曲）」「（苏秦）」…）——
// 它们已被 apply-chengyu-gloss.js 搬进 gloss 一栏，混在正文里读者分不清哪句是古人说的。
const stamped = expanded.filter(function (p) { return PAT.test(p.text || ''); });
// 每一则读到的正文都该命中自己的摘句
function cleanX(s) { return String(s || '').replace(/（[^）]*）/g, '').replace(/\s/g, ''); }
const stray = expanded.filter(function (p) {
  const ex = cleanX(p.excerpt);
  if (!ex || !p.text) return false;
  return cleanX(p.text).indexOf(ex) < 0;
});

// 数据文件里每个条目只该有一行 textRef —— 早先的插入写法会给手工表带的 textRef
// 再插一行，留下两行同名字段（曾在 51 条第一档成语上出现过）。
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
