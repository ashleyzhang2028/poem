const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'data/poems-chengyu.js');

const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
['data/chengyu-meaning.js', 'data/poems-chengyu.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
});

const M = sandbox.CHENGYU_MEANING || {};
const CY = sandbox.POEMS_CHENGYU || [];

// ① 释义表与条目表必须一一对应 —— 多一条少一条都要当场说清楚。
//   例外：条目自己已经带 meaning 的（第一档新收的成语，释义随条目一起录入），
//   不必在这张表里再有一条，不然同一份释义要维护两处。
const titles = CY.map(function (p) { return p.title; });
const selfCoded = {};
CY.forEach(function (p) { if (p.meaning) selfCoded[p.title] = true; });
const missing = titles.filter(function (t) { return !M[t] && !selfCoded[t]; });
const extra = Object.keys(M).filter(function (t) { return titles.indexOf(t) < 0; });
if (missing.length || extra.length) {
  console.error('✗ 释义表与成语表对不上：');
  if (missing.length) console.error('    缺释义（' + missing.length + '）：' + missing.slice(0, 10).join('、'));
  if (extra.length) console.error('    多释义（' + extra.length + '）：' + extra.slice(0, 10).join('、'));
  process.exit(1);
}

const tooShort = titles.filter(function (t) {
  const v = M[t] || (CY.filter(function (p) { return p.title === t; })[0] || {}).meaning;
  return String(v || '').replace(/\s/g, '').length < 8;
});
if (tooShort.length) {
  console.error('✗ 释义过短（< 8 字），像是占位：' + tooShort.join('、'));
  process.exit(1);
}

// ② 写回 data/poems-chengyu.js：每则加一行 meaning: "..."，插在 excerpt 之前
let src = fs.readFileSync(FILE, 'utf8');
let touched = 0;
const blocks = src.split(/\n(?=  \{)/);
const out = blocks.map(function (blk) {
  const tm = blk.match(/^\s*title:\s*"([^"]+)",$/m);
  if (!tm) return blk;
  const title = tm[1];
  const mean = M[title];
  if (!mean) return blk;                             // 条目自带 meaning，略过
  if (/^\s*meaning:\s*"/m.test(blk)) return blk;      // 已经写过，幂等
  touched += 1;
  return blk.replace(/^(\s*)excerpt:/m, function (all, indent) {
    return indent + 'meaning: ' + JSON.stringify(mean) + ',\n' + indent + 'excerpt:';
  });
});

if (!touched) {
  console.log('✓ 条目上已有 meaning（无需改动）。');
  process.exit(0);
}
src = out.join('\n');
fs.writeFileSync(FILE, src, 'utf8');
console.log('✓ 已给 ' + touched + ' 则成语写入 meaning（释义）一栏。');
