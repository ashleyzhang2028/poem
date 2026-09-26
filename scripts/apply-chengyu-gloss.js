#!/usr/bin/env node
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const MASTER_FILE = path.join(ROOT, 'data/text-master.js');
const CY_FILE = path.join(ROOT, 'data/poems-chengyu.js');

const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
['data/chengyu-gloss.js', 'data/poems-chengyu.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
});
const GLOSS = sandbox.CHENGYU_GLOSS || {};
const CY = sandbox.POEMS_CHENGYU || [];

const idOf = {};
CY.forEach(function (p) { idOf[p.title] = 'chengyu-' + p.id; });

const LEAD = /^（[^（）]*）\s*/;
const TRANS_ANN = /（(?:字面意思是|此为小说家言|此语出|语出|本指|喻指|即|原文作|同)[^（）]*）/g;

function stripText(text) {
  let t = String(text || '');
  let moved = 0;
  while (true) {
    const m = t.match(LEAD);
    if (!m) break;
    t = t.slice(m[0].length);
    moved += 1;
  }
  const tail = t.match(/（[^（）]*）\s*$/);
  if (tail) { t = t.slice(0, t.length - tail[0].length); moved += 1; }
    const MID = /（[^（）]*(语本|佛典|后世语|现代语|诗法|元曲|小说家言|禅典|西洋寓言|法寓言|原文作|同「|本《|见《|见宋人|宋人书)[^（）]*）\s*/g;
  t = t.replace(MID, function () { moved += 1; return ''; });
  return { text: t.trim(), moved: moved };
}

function stripTrans(tr) {
  const s = String(tr || '');
  const out = s.replace(TRANS_ANN, '').replace(/。\s*。+/g, '。').trim();
  return out || s;
}

let src = fs.readFileSync(MASTER_FILE, 'utf8');
let touched = 0;
const report = [];
Object.keys(GLOSS).forEach(function (title) {
  const id = idOf[title];
  if (!id) return;
  const at = src.indexOf('    id: ' + JSON.stringify(id) + ',\n');
  if (at < 0) return;
  const start = src.lastIndexOf('  {\n', at);
  const end = src.indexOf('\n  },', at);
  if (start < 0 || end < 0) return;
  let block = src.slice(start, end);

  const tm = block.match(/text:\s*("(?:[^"\\]|\\.)*")/);
  if (!tm) return;
  const oldText = JSON.parse(tm[1]);
  const st = stripText(oldText);
  if (st.moved) {
    block = block.replace(/text:\s*"(?:[^"\\]|\\.)*"/, 'text: ' + JSON.stringify(st.text));
    const trm = block.match(/translation:\s*("(?:[^"\\]|\\.)*")/);
    if (trm) {
      const nt = stripTrans(JSON.parse(trm[1]));
      if (nt !== JSON.parse(trm[1])) {
        block = block.replace(/translation:\s*"(?:[^"\\]|\\.)*"/, 'translation: ' + JSON.stringify(nt));
      }
    }
    touched += 1;
    report.push(title + '（摘 ' + st.moved + ' 处）');
  }
  src = src.slice(0, start) + block + src.slice(end);
});
fs.writeFileSync(MASTER_FILE, src, 'utf8');

const STAMP_EX = /（[^（）]*(语本|佛典|后世语|现代语|诗法|元曲|小说家言|禅典|西洋寓言|法寓言|原文作|同「|本《|见《|见宋人|宋人书|贾谊《|元诗选)/;
let cy = fs.readFileSync(CY_FILE, 'utf8');
let glossed = 0;
let clipped = 0;
cy = cy.split(/\n(?=  \{)/).map(function (blk) {
  const tm = blk.match(/^\s*title:\s*"([^"]+)",$/m);
  if (!tm) return blk;
  let out = blk;

    const em = out.match(/^(\s*)excerpt:\s*"((?:[^"\\]|\\.)*)"/m);
  if (em) {
    let val = JSON.parse('"' + em[2] + '"');
    const before = val;
    while (true) {
      const m = val.match(/^（[^（）]*）\s*/);
      if (!m || !STAMP_EX.test(m[0])) break;
      val = val.slice(m[0].length);
    }
    val = val.replace(/…+$/, '');
    if (val !== before) {
      out = out.replace(/^(\s*)excerpt:\s*"(?:[^"\\]|\\.)*"/m,
        function (all, ind) { return ind + 'excerpt: ' + JSON.stringify(val); });
      clipped += 1;
    }
  }

  const g = GLOSS[tm[1]];
  if (!g) return out;
  if (/^\s*gloss:\s*"/m.test(out)) {
    const next = out.replace(/^(\s*)gloss:\s*"(?:[^"\\]|\\.)*"/m, function (all, ind) {
      return ind + 'gloss: ' + JSON.stringify(g);
    });
    if (next !== out) glossed += 1;
    return next;
  }
  glossed += 1;
  return out.replace(/^(\s*)meaning:/m, function (all, ind) {
    return ind + 'gloss: ' + JSON.stringify(g) + ',\n' + ind + 'meaning:';
  });
}).join('\n');
fs.writeFileSync(CY_FILE, cy, 'utf8');

const check = { window: {}, console };
check.window = check;
vm.createContext(check);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'data/chengyu-gloss.js'), 'utf8'), check,
  { filename: 'data/chengyu-gloss.js' });
const s2 = { window: {}, console };
s2.window = s2;
vm.createContext(s2);
['data/text-master.js', 'data/chengyu-support.js', 'data/poems-chengyu.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), s2, { filename: f });
});
const MARK = /（[^（）]*(语本|佛典|后世语|现代语|诗法|元曲|小说家言|禅典|西洋寓言|法寓言|原文作|同「|本《|见《|见宋人|宋人书|贾谊《|元诗选|淮南子·天文训|楚国先贤传)[^（）]*）/;
const left = (s2.POEMS_CHENGYU || []).filter(function (p) {
  const t = s2.masterTextOf(p, 'chengyu');
  return MARK.test(t.text || '');
}).map(function (p) { return p.title; });
if (left.length) {
  console.error('✗ 还有 ' + left.length + ' 则正文带着编者括注：' + left.slice(0, 10).join('、'));
  process.exit(1);
}
const noGloss = (s2.POEMS_CHENGYU || []).filter(function (p) {
  const t = s2.masterTextOf(p, 'chengyu');
  return /^（[^（）]*）/.test(t.text || '');
}).map(function (p) { return p.title; });
if (noGloss.length) {
  console.error('✗ 还有 ' + noGloss.length + ' 则正文以括注开头：' + noGloss.slice(0, 10).join('、'));
  process.exit(1);
}

console.log('✓ 语源 / 典故：正文摘去编者括注 ' + touched + ' 则，条目写入 gloss ' + glossed +
  ' 则，摘句同步去掉编者括注 ' + clipped + ' 则。');
console.log('  自检：正文再无「（佛典 / 语本 / 后世语 / 苏秦）」这类编者括注。');
