#!/usr/bin/env node
/* 把正文里的编者括注搬进「语源 / 典故」栏
   --------------------------------------------------------------------------
   首版录入时，151 则成语的正文前面（或后面、或夹在中间）挂着一段编者写的
   括注：「（佛典）」「（语本元曲）」「（苏秦）」「（原文作『众心成城』）」……
   那不是任何一本书里的句子，却和原文混在同一栏里 —— 读者分不清哪句是古人
   说的、哪句是编者加的。

   本脚本做三件事（幂等，反复跑结果不变）：

     ① 正文（text）：把那段括注摘掉，只留干净的原文；
     ② 译文（translation）：译文里若混着同一段括注的直译（「（字面意思是）…」
        「（此为小说家言）」），一并摘掉；
     ③ 「语源 / 典故」（gloss）：从 data/chengyu-gloss.js 写入一句大白话说明。

   data/text-master.js 是生成物，所以正文与译文的改动**落在这里、放在流水线
   最后**：scripts/apply-chengyu-gloss.js 排在 build-works-map.js 之后，
   重跑 build-text-master.js 也不会把改动丢掉（它从 data/poems-chengyu.js
   的差异里恢复会失效，故本脚本直接改主表，并在 data/poems-chengyu.js 上
   同步 gloss 一栏 —— 两处都改，一处不落）。
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
['data/chengyu-gloss.js', 'data/poems-chengyu.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
});
const GLOSS = sandbox.CHENGYU_GLOSS || {};
const CY = sandbox.POEMS_CHENGYU || [];

const idOf = {};
CY.forEach(function (p) { idOf[p.title] = 'chengyu-' + p.id; });

// 括注：一段「（…）」，正文里至多两处（开头、结尾，或开头 + 中间），
// 中间那处后面还跟着正文时不算（那是原书里的人物夹注，如「师（达摩）终日面壁」）。
const LEAD = /^（[^（）]*）\s*/;
// 译文里的编者附注：整句括起来的「（字面意思是…）」「（此为小说家言…）」等
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
  // 剩下的中间括注：只有整句括注、且括注里含「语本 / 佛典 / 后世语 / 现代语 /
  // 诗法 / 元曲 / 小说家言 / 禅典 / 西洋寓言 / 法寓言 / 原文作 / 同「」这类
  // 编者标记时才摘 —— 原书的人物夹注留着。
  const MID = /（[^（）]*(语本|佛典|后世语|现代语|诗法|元曲|小说家言|禅典|西洋寓言|法寓言|原文作|同「|本《|见《|见宋人|宋人书)[^（）]*）\s*/g;
  t = t.replace(MID, function () { moved += 1; return ''; });
  return { text: t.trim(), moved: moved };
}

function stripTrans(tr) {
  const s = String(tr || '');
  const out = s.replace(TRANS_ANN, '').replace(/。\s*。+/g, '。').trim();
  return out || s;
}

// ── ① 主表：摘括注、写 gloss ────────────────────────────────────────────
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

// ── ② 条目表：写 gloss 一栏，并把摘句里的编者括注一并摘掉 ────────────────
//    摘句（excerpt）是列表 / 搜索结果里那一行摘要，原先也带着同一段括注 ——
//    正文搬了、摘句不搬，列表上仍是「（佛典）守口如瓶」这种编者的话。
//    注意只摘**编者标记**的括注；原书里的夹注（「师（达摩）终日面壁而坐」）
//    是原文的一部分，留着。
const STAMP_EX = /（[^（）]*(语本|佛典|后世语|现代语|诗法|元曲|小说家言|禅典|西洋寓言|法寓言|原文作|同「|本《|见《|见宋人|宋人书|贾谊《|元诗选)/;
let cy = fs.readFileSync(CY_FILE, 'utf8');
let glossed = 0;
let clipped = 0;
cy = cy.split(/\n(?=  \{)/).map(function (blk) {
  const tm = blk.match(/^\s*title:\s*"([^"]+)",$/m);
  if (!tm) return blk;
  let out = blk;

  // 摘句：剥掉开头的编者括注（可能连着两段）
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

// ── 自检 ────────────────────────────────────────────────────────────────
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
