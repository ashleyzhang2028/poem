#!/usr/bin/env node
/* 把「第一档 · 义务教育教材常用成语」追加进 data/poems-chengyu.js
   --------------------------------------------------------------------------
   数据的真身在 scripts/chengyu-tier1.js（纯数据，无副作用），本脚本负责：

     ① 与库内已有的 736 则比对，重名的直接跳过（幂等，可反复跑）；
     ② 按朝代插进对应段落（全库按十九个朝代分组的次序不能乱）；
     ③ id 续号，并给新条目补 textRef（正文随后由 build-text-master.js
        收进主表、apply-text-master.js 摘去内联副本 —— 与既有流程一致）。
*/
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'data/poems-chengyu.js');

const TIER1 = require('./chengyu-tier1.js').ENTRIES;

const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
['data/text-master.js', 'data/poems-chengyu.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
});
const CY = sandbox.POEMS_CHENGYU || [];

const have = {};
CY.forEach(function (p) { have[p.title] = true; });

const DYNASTIES = ['上古传说', '夏', '商', '西周', '春秋', '战国', '秦', '西汉', '东汉', '三国',
  '两晋南北朝', '隋', '唐', '五代', '宋', '辽金', '元', '明', '清'];

const fresh = TIER1.filter(function (e) { return !have[e[0]]; });
const skipped = TIER1.length - fresh.length;
if (!fresh.length) {
  console.log('✓ 第一档成语都已在库（跳过 ' + skipped + ' 条），无需追加。');
  process.exit(0);
}

let next = 0;
CY.forEach(function (p) {
  const n = Number(String(p.id).replace('cy-', ''));
  if (n > next) next = n;
});

function entryText(e, id) {
  const [title, source, dynasty, author, group, excerpt, text, translation, meaning] = e;
  return '  {\n' +
    '    textRef: ' + JSON.stringify('chengyu-' + id) + ',\n' +
    '    id: ' + JSON.stringify(id) + ',\n' +
    '    title: ' + JSON.stringify(title) + ',\n' +
    '    source: ' + JSON.stringify(source) + ',\n' +
    '    dynasty: ' + JSON.stringify(dynasty) + ',\n' +
    '    author: ' + JSON.stringify(author) + ',\n' +
    '    gradeGroup: ' + JSON.stringify(group) + ',\n' +
    '    meaning: ' + JSON.stringify(meaning) + ',\n' +
    '    excerpt: ' + JSON.stringify(excerpt) + ',\n' +
    '    text: ' + JSON.stringify(text) + ',\n' +
    '    translation: ' + JSON.stringify(translation) + ',\n' +
    '    translationSource: "public-domain",\n' +
    '  }';
}

let src = fs.readFileSync(FILE, 'utf8');
const chunks = src.split(/\n(?=  \{)/);

const byDyn = {};
fresh.forEach(function (e, k) {
  const dyn = e[4];
  if (DYNASTIES.indexOf(dyn) < 0) {
    console.error('✗ 朝代不在朝代表内：' + e[0] + ' → ' + dyn);
    process.exit(1);
  }
  (byDyn[dyn] = byDyn[dyn] || []).push(e);
});

const newBlocks = [];
Object.keys(byDyn).forEach(function (dyn) {
  byDyn[dyn].forEach(function (e) {
    next += 1;
    newBlocks.push({ dyn: dyn, text: entryText(e, 'cy-' + next) });
  });
});

// 找到每个朝代最后一行的下标
const lastOfDyn = {};
chunks.forEach(function (c, idx) {
  const m = c.match(/^\s*gradeGroup:\s*"([^"]+)",$/m);
  if (!m) return;
  if (DYNASTIES.indexOf(m[1]) >= 0) lastOfDyn[m[1]] = idx;
});

const missingDyn = Object.keys(byDyn).filter(function (d) { return lastOfDyn[d] == null; });
if (missingDyn.length) {
  console.error('✗ 库里找不到这些朝代的段落：' + missingDyn.join('、'));
  process.exit(1);
}

const insertAfter = {};
newBlocks.forEach(function (b) {
  (insertAfter[lastOfDyn[b.dyn]] = insertAfter[lastOfDyn[b.dyn]] || []).push(b.text);
});

// 主表收尾的 `];` 挂在最后一段（清的末条）后面，插新条目时不能让它在中间
const TAIL = /\n\];\s*$/;
const m = src.match(TAIL);
if (!m) {
  console.error('✗ 找不到数据文件的收尾 `];` —— 写法变了，脚本要跟着改。');
  process.exit(1);
}
const body = src.slice(0, m.index);

const chunks2 = body.split(/\n(?=  \{)/);
const out = [];
chunks2.forEach(function (c, idx) {
  out.push(c.replace(/\n$/, ''));
  if (insertAfter[idx]) {
    // 被插的那一条原先如果是末条（没有尾逗号），先补上
    const last = out[out.length - 1];
    if (last && !/,$/.test(last.trim()) && /^\s*\{$/.test(last.split('\n').slice(-1)[0] || '')) {
      out[out.length - 1] = last + ',';
    }
    Object.keys(insertAfter).forEach(function (k) { void k; });
    insertAfter[idx].forEach(function (t) { out.push(t + ','); });
  }
});

src = out.join('\n') + '\n];\n';
// 新条目后面紧跟 `];` 的那一条不该带逗号
src = src.replace(/,\n\];\n$/, '\n];\n');

fs.writeFileSync(FILE, src, 'utf8');
console.log('✓ 追加第一档成语 ' + newBlocks.length + ' 条（跳过已在库 ' + skipped + ' 条）：');
Object.keys(byDyn).forEach(function (d) {
  console.log('    ' + d + '：' + byDyn[d].map(function (e) { return e[0]; }).join('、'));
});
console.log('\n下一步：node scripts/build-text-master.js → apply-text-master.js → build-works-map.js，再跑测试。');
