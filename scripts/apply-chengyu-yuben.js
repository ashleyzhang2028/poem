#!/usr/bin/env node
/* 把「（语本）」占位正文换成可查证的原句
   --------------------------------------------------------------------------
   原先 76 则语本类成语的正文与摘句都写着「（语本）某某」—— 那不是任何一部
   书里的句子，是编者自造的占位串。真正的原句住在 data/chengyu-support.js
   里，本脚本做两件事：

     ① 正文（text）换成补充材料给的原句，译文缺的补上；
     ② 摘句（excerpt）跟着改成新正文的前一段 —— 原来的摘句也是占位串，
        不改的话「摘句与正文对不上」的防回归断言会红。

   为什么不直接改 data/text-master.js：那是一份**生成文件**，重跑
   build-text-master.js 会把手工改动覆盖掉。真身在补充材料，这里是执行处；
   在 scripts/build-chengyu.js 的流水线里排在收归主表之后、重算同篇表之前。
*/
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const MASTER_FILE = path.join(ROOT, 'data/text-master.js');
const CY_FILE = path.join(ROOT, 'data/poems-chengyu.js');

const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
['data/chengyu-support.js', 'data/poems-chengyu.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
});
const SUPPORT = sandbox.CHENGYU_SUPPORT || [];
const CY = sandbox.POEMS_CHENGYU || [];

const idOfTitle = {};
CY.forEach(function (p) { idOfTitle[p.title] = 'chengyu-' + p.id; });

// 摘句取正文的第一句（到第一个句号 / 感叹号 / 问号为止），最多 24 字
function excerptOf(text) {
  const flat = String(text || '').replace(/\n/g, '').trim();
  const m = flat.match(/^[^。！？]*[。！？]/);
  const s = (m ? m[0] : flat).replace(/[。！？]$/, '');
  return s.length > 24 ? s.slice(0, 24) : s;
}

let src = fs.readFileSync(MASTER_FILE, 'utf8');
const misses = [];
SUPPORT.forEach(function (s) {
  const id = idOfTitle[s.title];
  if (!id) { misses.push(s.title); return; }
  const at = src.indexOf('    id: ' + JSON.stringify(id) + ',\n');
  if (at < 0) { misses.push(s.title + '（主表无此条）'); return; }
  const start = src.lastIndexOf('  {\n', at);
  const end = src.indexOf('\n  },', at);
  if (start < 0 || end < 0) { misses.push(s.title + '（切块失败）'); return; }
  let block = src.slice(start, end);
  block = block.replace(/text:\s*"(?:[^"\\]|\\.)*"/, 'text: ' + JSON.stringify(s.text));
  if (s.translation) {
    block = block.replace(/translation:\s*"(?:[^"\\]|\\.)*"/, 'translation: ' + JSON.stringify(s.translation));
  }
  src = src.slice(0, start) + block + src.slice(end);
});
if (misses.length) {
  console.error('✗ 补充材料里这些找不到对应主表条目：');
  misses.slice(0, 10).forEach(function (x) { console.error('    ' + x); });
  process.exit(1);
}
fs.writeFileSync(MASTER_FILE, src, 'utf8');

// 出处与朝代也照补充材料对齐：语本类成语常被后人挂到「成书更早、但不是它」
// 的那部书上（最典型：众口铄金 被挂到《国语》那条谚语下，而它的书证是
// 邹阳《狱中上书》）。补充材料给的出处是这一轮核校后的裁定。
let cyc = fs.readFileSync(CY_FILE, 'utf8');
let resourced = 0;
cyc = cyc.split(/\n(?=  \{)/).map(function (blk) {
  const tm = blk.match(/^\s*title:\s*"([^"]+)",$/m);
  if (!tm) return blk;
  const sup = SUPPORT.filter(function (x) { return x.title === tm[1]; })[0];
  if (!sup || !sup.source) return blk;
  let next = blk.replace(/^(\s*)source:\s*"(?:[^"\\]|\\.)*"/m,
    function (all, indent) { return indent + 'source: ' + JSON.stringify(sup.source); });
  if (sup.dynasty) {
    next = next
      .replace(/^(\s*)dynasty:\s*"(?:[^"\\]|\\.)*"/m,
        function (all, indent) { return indent + 'dynasty: ' + JSON.stringify(sup.dynasty); })
      .replace(/^(\s*)gradeGroup:\s*"(?:[^"\\]|\\.)*"/m,
        function (all, indent) { return indent + 'gradeGroup: ' + JSON.stringify(sup.dynasty); });
  }
  if (next !== blk) resourced += 1;
  return next;
}).join('\n');
fs.writeFileSync(CY_FILE, cyc, 'utf8');

// 摘句：只改 supplement 点名的那些条目
let cy = fs.readFileSync(CY_FILE, 'utf8');
const named = {};
SUPPORT.forEach(function (s) { named[s.title] = s.text; });
let excerpted = 0;
cy = cy.split(/\n(?=  \{)/).map(function (blk) {
  const tm = blk.match(/^\s*title:\s*"([^"]+)",$/m);
  if (!tm || !named[tm[1]]) return blk;
  const ex = excerptOf(named[tm[1]]);
  if (/^\s*excerpt:\s*"/m.test(blk)) {
    const next = blk.replace(/^(\s*)excerpt:\s*"(?:[^"\\]|\\.)*"/m,
      function (all, indent) { return indent + 'excerpt: ' + JSON.stringify(ex); });
    if (next !== blk) excerpted += 1;
    return next;
  }
  return blk;
}).join('\n');
fs.writeFileSync(CY_FILE, cy, 'utf8');

console.log('✓ 语本类成语：正文 / 译文换成原句 ' + SUPPORT.length + ' 则，摘句同步更新 ' +
  excerpted + ' 则，出处 / 朝代对齐 ' + resourced + ' 则。');
