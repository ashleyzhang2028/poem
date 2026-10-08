/* ==========================================================================
   唐诗 · 选本条目出处精细化（Issue #512）
   --------------------------------------------------------------------------
   《唐诗》里 318 条是《唐诗三百首》选本条目，`source` 原先一律写选本名
   「《唐诗三百首》」—— 详情页只读 `source`，于是《望岳》读到「《唐诗三百首》」，
   看不出它出自《杜工部集》。PR #526 已按《古文观止》那套口径把其中 19 条
   改成「`source` = 精确集名 + `selection` = 选本名」，本脚本把余下 299 条补齐。

   ## 精确出处怎么定（三条路，优先级从高到低）

     ① **可借** —— 站内别处已经有这一条作品的精确出处，直接搬：
          · 课内篇目（`poems-*` 与它同篇）—— 课内一律记《全唐诗》
            （课本古诗词的通行著录），`poems-eclassic.js` 里那 4 条已标明；
          · 同部另一条（`ts-16 / ts-448` 那种「同篇两条」）—— 搬兄弟条的；
          · 跨部（乐府 `yuefu-*` 那种）—— **不搬**，那记的是《乐府诗集》
            这部乐府总集、不是诗人别集，搬过来会把「所出之书」指错。
     ② **表定** —— 诗人在 `scripts/data/tangshi-works.js` 里的别集（逐家考订）；
     ③ **总集** —— 表里没有的作者，退到《全唐诗》。

   ## 与 PR #526 的关系

   #526 已改的 19 条一律**不动**（幂等）：本脚本只处理 `source` 仍是
   「《唐诗三百首》」的那些。

   ## 不动什么

   `id` / `textRef` / 正文 / 题名 / 作者 / 朝代 / 分卷一律不动，进度键不断链。
   只动 `source`、`selection` 与语料表里对应的那两行。

   ⚠️ 这是脚本、不是数据 —— 表在 scripts/data/tangshi-works.js，改完重跑即可。
      用法：node scripts/fix-tangshi-source.js
   ========================================================================== */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* 课内古诗词的通行著录：课本篇目一律《全唐诗》。 */
const COURSE_BOOK = '《全唐诗》';
const XUANBEN = '《唐诗三百首》';

/* 本批额外补的选本条目（自身不在 data/poems-tangshi.js 里，
   但 site-index 已收录、同样要吃这一轮口径）。 */
/* 集内既有条目里，同一个诗人名下的集名写法不止一种 —— 这一轮顺手并成一种：
   《孟浩然集》并入《孟襄阳集》（ts-230 春晓、ts-127 临洞庭 用的都是后者，
   诗人名下 13 条不该出现两部书）。逐条定点替换，不碰列传体。 */
const ALIAS_MERGE = [
  { file: 'data/poems-tangshi.js', from: '《孟浩然集》', to: '《孟襄阳集》' },
  { file: 'scripts/data/poems-corpus-516a.js', from: '《孟浩然集》', to: '《孟襄阳集》' }
];

const EXTRA_SHELL_FILES = [
  { file: 'scripts/data/poems-corpus-516a.js', v: 'POEMS_CORPUS_516A' },
  { file: 'scripts/data/poems-corpus-516b.js', v: 'POEMS_CORPUS_516B' }
];

function load(file, varName) {
  const sandbox = { window: {}, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
  return varName ? sandbox[varName] : sandbox;
}

/* ---------------------------------------------------------------------------
   1 · 建站（与 test 里同一套加载顺序）：要判重表，才知道哪一条与课内同篇。
   --------------------------------------------------------------------------- */
const sb = (function () {
  const sandbox = { window: {}, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const FILES = [
    'data/text-master.js',
    'data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js',
    'data/poems-5.js', 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js',
    'data/poems-9.js', 'data/poems-10.js', 'data/poems-11.js', 'data/poems-12.js',
    'data/index.js', 'data/poems-classic.js', 'data/poems-tangshi.js', 'data/poems-gushi.js',
    'data/poems-songci.js', 'data/poems-yuefu.js', 'data/poems-guwen.js',
    'data/poems-zhaoming.js', 'data/poems-yuanqu.js',
    'scripts/data/poems-corpus-516a.js', 'scripts/data/poems-corpus-516b.js',
    'data/site-books.js', 'data/site-index.js', 'data/works-map.js', 'data/works-index.js'
  ];
  FILES.forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  });
  return sandbox;
})();

const WI = sb.WorksIndex;
const SITE = sb.SITE_INDEX || [];
const byId = {};
SITE.forEach(function (p) { if (p && p.id) byId[p.id] = p; });

/* ---------------------------------------------------------------------------
   2 · 逐条定精确出处。
   --------------------------------------------------------------------------- */
const WORKS = load('scripts/data/tangshi-works.js', 'TANGSHI_WORKS');

const rows = [];          /* { id, title, author, book, from } */
const unresolved = [];

function bookOf(entry) {
  /* ① 可借：课内同篇（一律《全唐诗》）、同部兄弟条（搬它的 source）。 */
  const w = WI.works.filter(function (x) { return x.entries.indexOf(entry.id) >= 0; })[0];
  const others = w ? w.entries.filter(function (e) { return e !== entry.id; }) : [];
  const course = others.filter(function (e) { return /^poems-/.test(e); });
  if (course.length) return { book: COURSE_BOOK, from: 'course:' + course.join(',') };
  const sameBook = others.filter(function (e) { return /^tangshi-/.test(e); })
    .map(function (e) { return byId[e]; })
    .filter(function (p) { return p && p.source && p.source !== XUANBEN; });
  if (sameBook.length) return { book: sameBook[0].source, from: 'sibling:' + sameBook[0].id };
  /* ② 表定。 */
  if (WORKS[entry.author]) return { book: WORKS[entry.author], from: 'table' };
  /* ③ 总集。 */
  return { book: null, from: 'unknown' };
}

SITE.filter(function (p) {
  return p.book === 'tangshi' && p.source === XUANBEN;
}).forEach(function (p) {
  const r = bookOf(p);
  if (!r.book) { unresolved.push(p.id + '（' + p.author + '）'); return; }
  rows.push({ id: p.id, title: p.title, author: p.author, book: r.book, from: r.from });
});

if (unresolved.length) {
  console.error('✗ 下列条目的精确出处没有裁定：');
  console.error('  ' + unresolved.join('、'));
  process.exit(1);
}

/* ---------------------------------------------------------------------------
   2b · 集名写法并轨。
   --------------------------------------------------------------------------- */
ALIAS_MERGE.forEach(function (m) {
  const abs = path.join(ROOT, m.file);
  const src = fs.readFileSync(abs, 'utf8');
  const n = src.split('source: "' + m.from + '"').length - 1;
  if (!n) return;
  fs.writeFileSync(abs, src.split('source: "' + m.from + '"').join('source: "' + m.to + '"'));
  console.log('  ' + m.file + '  ' + m.from + ' → ' + m.to + '  ' + n + ' 处');
});

/* ---------------------------------------------------------------------------
   3 · 写回。壳文件（data/poems-tangshi.js）与语料表都改 —— 语料表里
      同一条也写着 source / selection，不改就「壳与语料不一致」。
   --------------------------------------------------------------------------- */
const bookById = {};
rows.forEach(function (r) { bookById[r.id] = r.book; });
/* 壳里挂的 textRef 是台账键（tangshi-ts-6）；语料表里 id 是集内 id（ts-6）。 */
const bookByLocal = {};
rows.forEach(function (r) { bookByLocal[r.id.replace(/^tangshi-/, '')] = r.book; });

const targets = [
  { file: 'data/poems-tangshi.js', v: 'POEMS_TANGSHI', prefix: 'tangshi-' }
].concat(EXTRA_SHELL_FILES);

const report = {};
let touched = 0;

targets.forEach(function (t) {
  const abs = path.join(ROOT, t.file);
  let src = fs.readFileSync(abs, 'utf8');
  const list = load(t.file, t.v) || [];
  let n = 0;
  list.forEach(function (p) {
    if (p.source !== XUANBEN) return;
    const book = t.prefix === 'tangshi-'
      ? (bookById[t.prefix + p.id] || null)
      : (bookById[t.prefix + p.id] || bookById[p.id] || null);
    if (!book) return;
    const block = 'id: "' + p.id + '"';
    const at = src.indexOf(block);
    if (at < 0) throw new Error(t.file + ' 里找不到条目 ' + p.id);
    /* 条目边界：从 id 行到它这一块的收尾（换行 + 两个空格 + '},'）——
       只在这一段里换成对，免得改到隔壁条目。 */
    const end = src.indexOf('\n  },', at);
    if (end < 0) throw new Error(t.file + ' 里找不到条目 ' + p.id + ' 的结尾');
    let seg = src.slice(at, end);
    const before = seg;
    seg = seg.replace(/source: "[^"]*"/, 'source: ' + JSON.stringify(book));
    if (seg === before) throw new Error(p.id + ' 的 source 没换到');
    if (/selection: "/.test(seg)) {
      seg = seg.replace(/selection: "[^"]*"/, 'selection: ' + JSON.stringify(XUANBEN));
    } else if (!/^[ \t]*\{/.test(seg) || /source:/.test(seg.split('\n')[0])) {
      /* 多行写法：在 gradeGroup 那一行后面另起一行，与 #526 已改的 19 条同构。 */
      seg = seg.replace(/(\n(\s+)gradeGroup: "[^"]*",)/,
        '$1\n$2selection: ' + JSON.stringify(XUANBEN) + ',');
    } else {
      /* 单行写法：就地把 selection 补在行尾。 */
      seg = seg.replace(/,\s*$/, ', selection: ' + JSON.stringify(XUANBEN));
    }
    src = src.slice(0, at) + seg + src.slice(end);
    n += 1;
    report[book] = (report[book] || 0) + 1;
  });
  if (n) fs.writeFileSync(abs, src);
  touched += n;
  console.log('  ' + t.file + '  ' + n + ' 条');
});

const BY_SOURCE = {};
rows.forEach(function (r) { (BY_SOURCE[r.from.split(':')[0]] = BY_SOURCE[r.from.split(':')[0]] || []).push(r); });
console.log('✔ 选本条目出处精细化 ' + touched + ' 条');
console.log('  定法：可借（课内）' + (BY_SOURCE.course || []).length +
  ' / 可借（同部）' + (BY_SOURCE.sibling || []).length +
  ' / 表定' + (BY_SOURCE.table || []).length +
  ' / 无' + (BY_SOURCE.unknown || []).length);
console.log('  按所出之书：');
Object.keys(report).sort().forEach(function (k) {
  console.log('    ' + k + ' ' + report[k]);
});
