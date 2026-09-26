#!/usr/bin/env node
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const JSON_OUT = process.argv.includes('--json');

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

const EDITOR_NOTE = /（(?:语意|字面意思是|此为小说家言|此语出|语出|本指|本意|后世喻|后世语|喻指|即|原文作|同「)[^（）]*）/;

function clauses(s) {
  return String(s || '').split(/[。！？；\n]+/).map(function (x) { return x.trim(); })
    .filter(function (x) { return x && x !== '……'; });
}

function lcsLen(a, b) {
  let best = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = i + best + 1; j <= a.length; j += 1) {
      if (b.indexOf(a.slice(i, j)) >= 0) { best = j - i; } else break;
    }
  }
  return best;
}

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

    if (EDITOR_NOTE.test(trans)) problems.editorNote.push(p.title);

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
