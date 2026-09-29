/* ==========================================================================
   历代名家 · 装机（脚本）
   --------------------------------------------------------------------------
   这个脚本有两件事：**改正文主表**（增 / 删 / 重编 id）与**出壳文件**
   （data/poems-mingren.js）。壳文件不再是手改的 —— 它由主表生成。

   ## 为什么这样改（Issue #381 第六轮的教训）
   前五轮这个脚本是「只增不改」的：它把新名单往主表末尾追加，再照着
   「壳里已有哪些人」算新号。第六轮要**删条目**，一删，后面所有号都要
   重编，而「壳里已有哪些人」这件事就不足为凭 —— 壳正是要重写的东西。

   于是反过来：**data/text-master.js 是唯一真相来源**。
     · 已在主表里的条目：title / 正文 从主表读，一个字段都不动；
     · 要删的：从主表整条摘掉（真删，不是标注「未收录」）；
     · 新增的：算好正文后定点插进主表；
     · 号段：按 GROUP_ORDER + 旧号次序重排，从 mr-01 起连续给号，
       再按「旧号 → 新号」对照表重写主表里那一段的 id / work / entries。
       对照表**不落盘**，每次现算 —— 落了盘，下一次运行就会把过期的
       对照当成既成事实（上一轮真踩过这个坑）。

   ## 分组从哪来
   data/text-master.js 的条目本身不带分组，分组只在名单里。所以每次运行的
   输入 = 现存的（title, 正文）+ 名单里的（title → 分组）+ DROP 名单。
   想给某人换组，就在名单里重给一行 —— 按名字认，不按 id 认。

   用具：
     node scripts/build-mingren.js             # 只出壳（不动主表）
     node scripts/build-mingren.js --master    # 同时改写 data/text-master.js
     node scripts/build-mingren.js --check     # 只校验，不写盘
     node scripts/build-mingren.js --renumber  # 只重编号（同上，写盘）
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const T = require('./lib/table.js');
const P = require('./lib/entry-patch.js');

const ROOT = path.join(__dirname, '..');
const SHELL = path.join(ROOT, 'data/poems-mingren.js');
const MASTER_FILE = path.join(ROOT, 'data/text-master.js');

/* ── 本轮名单（Input）────────────────────────────────────────────────── */
const ROUND5 = require('./data/mingren-round5.js');   // 要删的（按名字）
const POL = require('./data/mingren-politics.js');    // 政治家 中外
const MIL = require('./data/mingren-military.js');    // 军事家 中外
const OLD = require('./data/mingren-new.js');         // 前几轮的名单

/* ── 分组次序：与 js/mingren.js 的 MINGREN_GROUP_ORDER 一字不差 ───────── */
const GROUP_ORDER = [
  '政治家', '文学家', '史学家', '思想家', '哲学家', '军事家',
  '科学家', '医学家', '音乐家', '建筑家', '戏曲家',
  '外国名人'
];

/* 本轮名单：分组 → 行。同一名字出现两次即报错（一人一处）。 */
/* 本轮要删的（先算出来，PLAN 校验与装配都要用） */
const DROP_EARLY = require('./data/mingren-round5.js').DROP;
const dropSetEarly = {};
DROP_EARLY.forEach(function (t) { dropSetEarly[t] = true; });

const PLAN = [
  { group: '政治家', rows: POL.TP_CN },
  { group: '政治家', rows: POL.TP_WORLD },
  { group: '文学家', rows: OLD.TY },
  { group: '思想家', rows: OLD.TZ },
  { group: '哲学家', rows: OLD.TW },
  { group: '军事家', rows: MIL.TB_CN },
  { group: '军事家', rows: MIL.TB_WORLD },
  { group: '外国名人', rows: OLD.TA }
];

const FIELDS = ['姓名', '朝代', '字 / 号', '生卒', '籍贯', '家世亲属',
  '生平', '作品风格', '流派', '主要作品 / 贡献', '特殊意义'];
const MIN_TOTAL = 400;   // 正文净字数下限

const PUNCT = /[\s·，。、；：「」『』（）()《》〈〉—…？！“”‘’\-－/、]+/g;
function nchars(s) { return String(s == null ? '' : s).replace(PUNCT, '').length; }

/* 正文：十一行表 + 一句话。与前几轮同一种形状。 */
function bodyOf(r) {
  const rows = FIELDS.map(function (label, i) { return [label, r[i]]; });
  return [T.box(rows), '', '【一句话】' + r[r.length - 1]].join('\n');
}

/* ── 主表：唯一真相来源 ─────────────────────────────────────────────── */
let SRC = fs.readFileSync(MASTER_FILE, 'utf8');
const MASTER = (function () {
  const s = { window: {}, console };
  s.window = s;
  vm.createContext(s);
  vm.runInContext(SRC, s, { filename: MASTER_FILE });
  return s.TEXT_MASTER || [];
})();
const mrOf = MASTER.filter(function (m) { return /^mingren-mr-\d+$/.test(String(m.id)); });

/* 在册条目的当前分组：从壳文件读（壳是上一轮的产物，但分组信息只在它里面；
   本轮名单里重给的行会覆盖它 —— 这就是「换组」的入口）。 */
const SHELL_GROUP = (function () {
  const s = { window: {}, console };
  s.window = s;
  vm.createContext(s);
  vm.runInContext(fs.readFileSync(SHELL, 'utf8'), s, { filename: SHELL });
  const map = {};
  (s.POEMS_MINGREN || []).forEach(function (p) { map[p.title] = p.group; });
  return map;
})();

const byTitle = {};
mrOf.forEach(function (m) { byTitle[m.title] = m; });

/* ── 校验名单 ────────────────────────────────────────────────────────── */
const problems = [];
const seenName = {};
const added = [];
PLAN.forEach(function (plan) {
  if (GROUP_ORDER.indexOf(plan.group) < 0) {
    problems.push('分组不在 GROUP_ORDER：' + plan.group);
    return;
  }
  plan.rows.forEach(function (r) {
    if (r.length !== FIELDS.length + 1) {
      problems.push((r[0] || '?') + ' 字段数 ' + r.length + '（应为 ' + (FIELDS.length + 1) + '）');
      return;
    }
    FIELDS.forEach(function (f, i) {
      if (!String(r[i] || '').trim()) problems.push((r[0] || '?') + ' 缺' + f);
    });
    if (nchars(bodyOf(r)) < MIN_TOTAL) {
      problems.push(r[0] + ' 正文 ' + nchars(bodyOf(r)) + ' 字（下限 ' + MIN_TOTAL + '）');
    }
    /* 前几轮的名单里可能有本轮要删的人（名单是累积的）—— 删的优先级最高 */
    if (dropSetEarly[r[0]]) return;
    if (seenName[r[0]]) { problems.push('名单里出现两次：' + r[0]); return; }
    seenName[r[0]] = true;
    added.push({ group: plan.group, row: r });
  });
});

/* ── 删除：按名字从主表摘掉 ─────────────────────────────────────────── */
const DROP = DROP_EARLY.slice();
/* 要删的条目主表里没有 → **不算错**：上一轮已经删过，本次是重跑。
   名单本身就是「哪些人该在 / 不该在」的落点（不是差量），
   所以每次运行都拿它当全集衡量，而不是拿「上次删了什么」。 */
const dropGone = DROP.filter(function (t) { return !byTitle[t]; });
if (dropGone.length) console.log('（其中 ' + dropGone.length + ' 位早已不在主表：' +
  dropGone.slice(0, 6).join('、') + (dropGone.length > 6 ? ' …' : '') + '）');
const dropSet = {};
DROP.forEach(function (t) { dropSet[t] = true; });

/* ── 组装最终名册 ───────────────────────────────────────────────────── */
/* PLAN 里给过的行：按名字建 index（换组也走这里） */
const REPLAN = {};
added.forEach(function (a) { REPLAN[a.row[0]] = a; });

const ROSTER = [];
/* ① 在册未删的：正文与 title 从主表来，分组从名单 / 壳来 */
mrOf.forEach(function (m) {
  if (dropSet[m.title]) return;
  const a = REPLAN[m.title];
  const group = a ? a.group : (SHELL_GROUP[m.title] || '文学家');
  if (GROUP_ORDER.indexOf(group) < 0) {
    problems.push(m.title + ' 的分组不在 GROUP_ORDER：' + group);
    return;
  }
  /* 名单里重给过的，正文一并换新（名单是更新的一份） */
  ROSTER.push({
    title: m.title, group: group, oldId: m.id,
    text: a ? bodyOf(a.row) : m.text,
    replace: !!a
  });
});
/* ② 新开条的：正文算出来 */
const FRESH = [];
added.forEach(function (a) {
  if (byTitle[a.row[0]]) return;      // 已在册，上面处理过了
  const rec = { title: a.row[0], group: a.group, text: bodyOf(a.row), row: a.row, replace: false };
  ROSTER.push(rec);
  FRESH.push(rec);
});

if (problems.length) {
  console.error('✗ 有 ' + problems.length + ' 项不合规（前 20）：' + problems.slice(0, 20).join('、'));
  process.exit(1);
}

/* ── 号段 ────────────────────────────────────────────────────────────── */
function oldOrder(rec) {
  if (!rec.oldId) return 1e9;
  return parseInt(String(rec.oldId).replace(/^mingren-mr-/, ''), 10);
}
ROSTER.sort(function (a, b) {
  const ga = GROUP_ORDER.indexOf(a.group), gb = GROUP_ORDER.indexOf(b.group);
  if (ga !== gb) return ga - gb;
  const oa = oldOrder(a), ob = oldOrder(b);
  if (oa !== ob) return oa - ob;
  /* 都是新人：按名单给的次序 */
  return 0;
});
const RENUMBER = {};
ROSTER.forEach(function (rec, i) {
  const newId = 'mr-' + String(i + 1).padStart(2, '0');
  if (rec.oldId) RENUMBER[rec.oldId] = newId;
  rec.newId = newId;
});

console.log('主表在册 ' + mrOf.length + ' 位');
console.log('删除 ' + DROP.length + ' 位：' + DROP.join('、'));
console.log('名单 ' + added.length + ' 位：已在册 ' + (added.length - FRESH.length) +
  ' 位、本轮新开条 ' + FRESH.length + ' 位');
console.log('名册共 ' + ROSTER.length + ' 位，号段 mr-01 … mr-' +
  String(ROSTER.length).padStart(2, '0'));
const g2n = {};
ROSTER.forEach(function (r) { g2n[r.group] = (g2n[r.group] || 0) + 1; });
GROUP_ORDER.forEach(function (g) { if (g2n[g]) console.log('  ' + g + ' ' + g2n[g] + ' 位'); });

/* ── 写主表 ──────────────────────────────────────────────────────────── */
if (process.argv.indexOf('--check') >= 0) process.exit(problems.length ? 1 : 0);

if (process.argv.indexOf('--master') >= 0) {
  /* ① 删：整条摘掉（含 ② 之后的重编号，所以这里只删不改号） */
  let removed = 0;
  DROP.forEach(function (t) {
    const m = byTitle[t];
    if (!m) return;
    SRC = removeEntry(SRC, m.id);
    removed += 1;
  });

  /* ② 已在册但正文要换新的：定点改写 text */
  let refreshed = 0;
  ROSTER.forEach(function (rec) {
    if (!rec.replace || !rec.oldId) return;
    const id = rec.oldId;
    const at = SRC.indexOf('    id: ' + JSON.stringify(id) + ',');
    if (at < 0) throw new Error('找不到 ' + id);
    const from = SRC.indexOf('    text: ', at);
    const lineEnd = SRC.indexOf('\n', from);
    SRC = SRC.slice(0, from) + '    text: ' + JSON.stringify(rec.text) + ',' + SRC.slice(lineEnd);
    refreshed += 1;
  });

  /* ③ 新开条：先用临时 id 插进主表，转圈后再统一编号 */
  const tmpIds = [];
  FRESH.forEach(function (rec) {
    const tmp = 'mingren-TMP' + String(tmpIds.length).padStart(4, '0');
    SRC = insertEntry(SRC, tmp, rec.title, rec.text);
    tmpIds.push({ tmp: tmp, rec: rec });
  });

  /* ④ 重编号：把 mr-* 与 TMP* 一起编成连续号。
       做法：把 mingren-* 那一段整体抽出来按 ROSTER 的次序重排，
       id / work / entries 一起换。 */
  SRC = rebuildBlock(SRC, ROSTER, tmpIds);

  fs.writeFileSync(MASTER_FILE, SRC, 'utf8');
  console.log('✓ data/text-master.js：删除 ' + removed + ' 条、改写 ' + refreshed +
    ' 条正文、新增 ' + FRESH.length + ' 条、全段已重编号');
}

/* ── 出壳：从主表生成 ────────────────────────────────────────────────── */
const shells = ROSTER.map(function (rec) {
  const life = rec.row ? rec.row[3] : lifeOf(rec.text);
  const one = rec.row ? rec.row[rec.row.length - 1] : tailOf(rec.text);
  return {
    id: rec.newId,
    title: rec.title,
    group: rec.group,
    dynasty: rec.row ? rec.row[1] : (dynastyOf(rec.text) || '—'),
    source: '《' + rec.title + '》·' + (life || '生卒不详'),
    excerpt: one || ''
  };
});

const lines = [];
lines.push('window.POEMS_MINGREN = [');
shells.forEach(function (s) {
  lines.push('  {');
  lines.push('    textRef: ' + JSON.stringify('mingren-' + s.id) + ',');
  lines.push('    id: ' + JSON.stringify(s.id) + ',');
  lines.push('    title: ' + JSON.stringify(s.title) + ',');
  lines.push('    group: ' + JSON.stringify(s.group) + ',');
  lines.push('    gradeGroup: ' + JSON.stringify(s.group) + ',');
  lines.push('    dynasty: ' + JSON.stringify(s.dynasty) + ',');
  lines.push('    author: ' + JSON.stringify(s.title) + ',');
  lines.push('    source: ' + JSON.stringify(s.source) + ',');
  lines.push('    excerpt: ' + JSON.stringify(s.excerpt) + ',');
  lines.push('  },');
});
lines.push('];');
lines.push('');
fs.writeFileSync(SHELL, lines.join('\n'), 'utf8');
console.log('✓ data/poems-mingren.js 已写出，共 ' + shells.length + ' 位');

/* ── 小工具 ──────────────────────────────────────────────────────────── */

/* 从主表的正文里取「一句话」（末段 '【一句话】…'） */
function tailOf(text) {
  const m = String(text).match(/【一句话】(.+)\s*$/);
  return m ? m[1].trim() : '';
}
/* 取「生卒」一行的值 */
function lifeOf(text) {
  const m = String(text).match(/│ 生卒 *│([^│]*)│/);
  return m ? m[1].trim() : '';
}
function dynastyOf(text) {
  const m = String(text).match(/│ 朝代(?: \/ 国别)? *│([^│]*)│/);
  return m ? m[1].trim() : '';
}
/* 整条删除 */
function removeEntry(src, id) {
  const marker = '    id: ' + JSON.stringify(id) + ',';
  const at = src.indexOf(marker);
  if (at < 0) throw new Error('主表里找不到 ' + id);
  const start = src.lastIndexOf('\n  {', at);
  const end = src.indexOf('\n  },', at) + 5;
  return src.slice(0, start) + src.slice(end);
}
/* 定点插入一条（在 mingren-mr-* 段的末尾之后） */
function insertEntry(src, id, title, text) {
  let h = 5381;
  const raw = [text, '', ''].join('\u0001');
  for (let i = 0; i < raw.length; i += 1) h = ((h * 33) ^ raw.charCodeAt(i)) >>> 0;
  const version = h.toString(36);
  const block = [
    '  {',
    '    work: ' + JSON.stringify('w-' + id) + ',',
    '    id: ' + JSON.stringify(id) + ',',
    '    title: ' + JSON.stringify(title) + ',',
    '    entries: [' + JSON.stringify(id) + '],',
    '    text: ' + JSON.stringify(text) + ',',
    '    translation: "",',
    '    translationSource: "",',
    '    version: ' + JSON.stringify(version),
    '  },'
  ].join('\n');
  /* 找 mingren-* 段的最后一条的收尾处 */
  const lastAt = src.lastIndexOf('    id: "mingren-');
  if (lastAt < 0) throw new Error('主表里没有 mingren-* 那一段');
  const end = src.indexOf('\n  },', lastAt) + 5;
  return src.slice(0, end) + '\n' + block + src.slice(end);
}
/* 重排 mingren-* 那一段：按 ROSTER 的次序、按 RENUMBER 换号 */
function rebuildBlock(src, roster, tmpIds) {
  const tmpMap = {};
  tmpIds.forEach(function (t) { tmpMap[t.rec] = t.tmp; });

  const firstAt = src.indexOf('    id: "mingren-');
  const lastAt = src.lastIndexOf('    id: "mingren-');
  const start = src.lastIndexOf('\n  {', firstAt);
  const end = src.indexOf('\n  },', lastAt) + 5;

  const parts = [];
  let i = start;
  while (true) {
    const s = src.indexOf('\n  {', i);
    if (s < 0 || s >= end) break;
    const e = src.indexOf('\n  },', s);
    if (e < 0) break;
    parts.push(src.slice(s, e + 5));
    i = e + 5;
  }
  const byKey = {};
  parts.forEach(function (b) {
    const m = b.match(/^    title: "((?:[^"\\]|\\.)*)",$/m);
    const t = m ? JSON.parse('"' + m[1] + '"') : null;
    byKey[t] = b;
  });

  const out = [];
  roster.forEach(function (rec, idx) {
    const newId = 'mr-' + String(idx + 1).padStart(2, '0');
    let b = byKey[rec.title];
    if (!b) {
      /* 新开条：按临时 id 找 */
      const tmp = tmpMap[rec];
      const at = src.indexOf('    id: ' + JSON.stringify(tmp) + ',');
      if (at < 0) throw new Error('找不到新条目 ' + rec.title);
      const s = src.lastIndexOf('\n  {', at);
      const e = src.indexOf('\n  },', at);
      b = src.slice(s, e + 5);
      byKey[rec.title] = b;
    }
    out.push(b
      .replace(/^    work: "w-[^"]*",$/m, '    work: "w-mingren-' + newId + '",')
      .replace(/^    id: "[^"]*",$/m, '    id: "mingren-' + newId + '",')
      .replace(/^    entries: \["[^"]*"\],$/m, '    entries: ["mingren-' + newId + '"],'));
  });
  return src.slice(0, start) + out.join('\n') + src.slice(end);
}
