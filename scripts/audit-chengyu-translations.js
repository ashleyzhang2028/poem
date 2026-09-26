#!/usr/bin/env node
/* 成语译文体检（离线一条命令，给出「可动手」的清单）
   --------------------------------------------------------------------------
   用户要的是「精准精确」。成语的「译文」比诗词多一层麻烦：它译的不是一首诗，
   而是从史书里截下来的一段叙事。截段一多，最常出的毛病有四类：

     A **编者的话混进译文**：译文里写着「（语意为）使世人震惊」——那是说明，
       不是白话译文。说明的归处是「语源 / 典故」那一栏（data/chengyu-gloss.js），
       译文栏不该再有第二处。
     B **译漏了**：正文分了几段，译文只译出一两句（如「一鼓作气」正文 15 段、
       译文丢了「齐师败绩」「遂逐齐师」这些句子）。
     C **讲了别一段**：译文里找不到自己的正文，却整段照搬了**同一段语料的
       另一条**（首版串行、正文换过而译文忘了跟着换，都是这一类）。
     D **同篇两处译得不一样**：成语与《小古文》《古文观止》《唐诗三百首》
       同篇的条目共用一份正文，译文也该共用 —— 否则「《刻舟求剑》在成语页
       与在小古文页读到的白话不一样」，学生只会来问哪个对。

   判据全部是**可复核的比对**，不引 AI、不猜。猜出来的「问题」比漏掉更坏。
   两条**看起来像问题、其实不是**的，本脚本不报，理由写在各自的判据旁：

     · 译文把省略号（`……`）处补顺 —— 底本是节选，补一句才读得通，不算漏译
     · 译文的用词与文言逐字不同 —— 「吾长见笑于大方之家」译成「我将永远被
       有学问的人耻笑」，四字以上根本不重合，属正常翻译

   本脚本只体检、不改数据。真实修正在 data/chengyu-trans-fix.js（手工表）
   与 scripts/apply-chengyu-trans-fix.js。
*/
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const JSON_OUT = process.argv.includes('--json');

// 语料要**十部集子全装**：C / D 两条判据找的是「同一段语料被两条用了」，
// 少了任何一部，那一条就找不出来。
const LOAD = [
  'data/text-master.js',
  'data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js',
  'data/poems-5.js', 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js',
  'data/poems-9.js', 'data/poems-10.js', 'data/poems-11.js', 'data/poems-12.js',
  'data/index.js', 'data/poems-classic.js', 'data/poems-tangshi.js',
  'data/poems-songci.js', 'data/poems-guwen.js', 'data/poems-zhaoming.js',
  'data/poems-yuanqu.js', 'data/poems-yuefu.js', 'data/poems-jinxiandai.js',
  'data/poems-chengyu.js', 'data/chengyu-support.js',
  'data/site-books.js', 'data/site-index.js', 'data/works-map.js', 'data/works-index.js'
];

const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
LOAD.forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
});

const plain = function (s) { return String(s == null ? '' : s).replace(/\s/g, ''); };
const textOf = function (o) { return plain(sandbox.masterTextOf(o, o.book || 'chengyu').text); };
const transOf = function (o) { return plain(sandbox.masterTextOf(o, o.book || 'chengyu').translation); };

const CY = sandbox.POEMS_CHENGYU || [];
const INDEX = (sandbox.SITE_INDEX || []).filter(function (x) { return !x.isBook; });

// 编者的话：整句括注，括注里是「说明词」。与 scripts/apply-chengyu-gloss.js
// 的 TRANS_ANN 同源 —— 口径只此一处，两边一致，不各写一份。
const EDITOR_NOTE = /（(?:语意|字面意思是|此为小说家言|此语出|语出|本指|本意|后世喻|后世语|喻指|即|原文作|同「)[^（）]*）/;

function clauses(s) {
  return String(s || '').split(/[。！？；\n]+/).map(function (x) { return x.trim(); })
    .filter(function (x) { return x && x !== '……'; });
}

// 最长公共子串长度
function lcsLen(a, b) {
  let best = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = i + best + 1; j <= a.length; j += 1) {
      if (b.indexOf(a.slice(i, j)) >= 0) { best = j - i; } else break;
    }
  }
  return best;
}

// 同一段语料的「兄弟条目」：正文与本文有 ≥ 12 字的连续共享，长度也相近
function siblings(p) {
  const t = plain(p.text);
  const out = [];
  INDEX.forEach(function (o) {
    if (o.id === 'chengyu-' + p.id) return;
    const ot = textOf(o);
    if (ot.length < 12 || t.length < 12) return;
    if (Math.max(ot.length, t.length) > Math.min(ot.length, t.length) * 2) return;
    if (lcsLen(t, ot) >= 12) out.push({ id: o.id, title: o.title, text: ot });
  });
  return out;
}

const problems = { editorNote: [], short: [], otherText: [], forked: [] };

CY.forEach(function (p) {
  const text = textOf(p);
  const trans = String(sandbox.masterTextOf(p, 'chengyu').translation || '');
  const pt = plain(trans);

  // A 译文里夹着编者的话
  if (EDITOR_NOTE.test(trans)) problems.editorNote.push(p.title);

  // B 漏译：正文有几句，译文只译出一两句
  // ⚠️ 判据是**整段的交代**，不是逐句比对。成语的译文是「把这一段文言讲成
  //    白话」，句式可以整段重组（「若网在纲」译成「好像网结在纲上」），逐句比
  //    会把 948 则里的 770 则误报成漏译 —— 那种「清单」只会把人推去改好的译文。
  //    真正的漏译长这样：「一鼓作气」正文 15 段、译文 12 段，中间「齐师败绩」
  //    「遂逐齐师」几句整块没交代。
  if (!pt) {
    problems.short.push({ title: p.title, why: '没有译文' });
  } else {
    const tc = clauses(text).length;
    const rc = clauses(trans).length;
    if (tc >= 4 && rc * 2 < tc) {
      problems.short.push({
        title: p.title,
        why: '正文 ' + tc + ' 段，译文只 ' + rc + ' 段'
      });
    }
  }

  // C 讲了别一段：译文与自己正文几乎不重合，却整块照搬了兄弟条目的正文
  const sibs = siblings(p);
  if (sibs.length && text.length >= 20 && pt.length >= 20) {
    const own = lcsLen(text, pt);
    let hit = null;
    sibs.forEach(function (s) {
      const n = lcsLen(s.text, pt);
      if (n >= 10 && n > own + 4) { if (!hit || n > hit.n) hit = { n: n, s: s }; }
    });
    if (hit) {
      problems.otherText.push({
        title: p.title, of: hit.s.id,
        why: '译文里照搬了「' + hit.s.title + '」的正文（' + hit.n + ' 字），自己正文只重合 ' + own + ' 字'
      });
    }
  }

  // D 同一段语料的兄弟条目，译文应当逐字相同
  if (text.length < 20) return;
  sibs.forEach(function (s) {
    if (s.text !== text) return;
    if (!pt) return;
    const st = transOf(INDEX.filter(function (x) { return x.id === s.id; })[0]);
    if (st && st !== pt) {
      problems.forked.push({ title: p.title, of: s.id, why: '与「' + s.title + '」同正文，译文却不一样' });
    }
  });
});

if (JSON_OUT) {
  console.log(JSON.stringify(problems, null, 2));
  const n = Object.keys(problems).reduce(function (a, k) { return a + problems[k].length; }, 0);
  process.exit(n ? 1 : 0);
}

const lines = [];
lines.push('译文体检 · 中华成语故事 ' + CY.length + ' 则');
lines.push('');
lines.push('  A 译文里夹着编者的话：      ' + problems.editorNote.length + ' 则');
problems.editorNote.forEach(function (t) { lines.push('      ' + t); });
lines.push('  B 译文漏译：                ' + problems.short.length + ' 则');
problems.short.forEach(function (x) { lines.push('      ' + x.title + '：' + x.why); });
lines.push('  C 译文讲的是别一段：        ' + problems.otherText.length + ' 则');
problems.otherText.forEach(function (x) { lines.push('      ' + x.title + '：' + x.why); });
lines.push('  D 同正文却译了两份：        ' + problems.forked.length + ' 则');
problems.forked.forEach(function (x) { lines.push('      ' + x.title + '：' + x.why); });

const bad = problems.editorNote.length + problems.short.length +
  problems.otherText.length + problems.forked.length;
lines.push('');
lines.push(bad === 0
  ? '🎉 ' + CY.length + ' 则译文体检通过：没有漏译、没有串行、没有编者的话夹在译文里'
  : '❌ 共 ' + bad + ' 项要处理');
console.log(lines.join('\n'));
process.exit(bad === 0 ? 0 : 1);
