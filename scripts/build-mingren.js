/* ==========================================================================
   历代名家 · 装机（脚本）
   --------------------------------------------------------------------------
   两件事：**改正文主表**（增 / 删 / 重编 id）与**出壳文件**
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

   ## 分组从哪来（merge origin/main 之后的新口径）
   主表条目不带分组。分组的唯一出处是**壳里已记的组 + 本轮名单**：
     · 主表现存的每一条，分组从壳读回来（`p.title → p.group`）——
       所以 PR #388 刚落的十四组中国 + 九组外国原样保留，不动一格；
     · 本轮名单（politics / military / mingren-new / mingren-corpus）
       给的行可以**重给分组**，这是「换组」的唯一入口，按名字认、不按 id 认。
   历史上这里还跑过一份 `CN_CATS / WORLD_CATS` 归类表 —— 那是 #388 那一支
   自己造号时用的，与本支的「重编号」叠着用会被覆盖掉，已删。

   用具：
     node scripts/build-mingren.js             # 只出壳（不动主表）
     node scripts/build-mingren.js --master    # 同时改写 data/text-master.js
     node scripts/build-mingren.js --check     # 只校验，不写盘
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const T = require('./lib/table.js');
const P = require('./lib/entry-patch.js');
const LY = require('./lib/life-year.js');
const M = require('./data/mingren-corpus.js');
const LEGACY_SHELL_ROWS = require('./data/mingren-legacy-shell.js').LEGACY_SHELL;

const ROOT = path.join(__dirname, '..');
const MASTER_FILE = path.join(ROOT, 'data/text-master.js');
const SHELL = path.join(ROOT, 'data/poems-mingren.js');


/* ── 名单来源 ────────────────────────────────────────────────────────── */
const LEGACY = M.LEGACY;                     // 已上线的 135 位（id 台账）
const PEOPLE = M.PEOPLE;                     // 第四轮起的素材总表（真源）
const ROUND5   = require('./data/mingren-round5.js');    // 第六轮：要删的
const POL      = require('./data/mingren-politics.js');  // 第六轮：政治家 中外
const MIL      = require('./data/mingren-military.js');  // 第六轮：军事家 中外
const OLD      = require('./data/mingren-new.js');       // 第四轮：文学 / 思想 / 哲学
const AXIS     = require('./data/mingren-axis.js');      // 第七轮：德 / 意 政治与军事

/* ── 分组次序：与 js/mingren.js 的 MINGREN_GROUP_ORDER 一字不差 ─────────
   中国在前、外国在后，各自内部「文学与思想 → 艺术 → 专门之学」。 */
const GROUP_ORDER = [
  '政治家', '文学家', '史学家', '思想家', '哲学家', '军事家',
  // 中国：艺术
  '书法家', '画家', '戏曲家', '音乐家',
  // 中国：专门之学
  '科学家', '医学家', '天文学家（中国）', '生物学家（中国）', '建筑家',
  // 外国：按学科
  '外国数学家', '外国物理学家', '外国化学家', '外国生物学家', '外国天文学家',
  '外国医学家', '外国文学家', '外国艺术家', '外国建筑家',
  '外国名人'
];

/* 本轮名单：分组 → 行。同一名字出现两次即报错（一人一处）。
   ⚠️ 顺序即「组内次序」：已在册的按旧号排，本轮新开的按这里给的次序排。 */
const PLAN = [
  { group: '政治家', rows: POL.TP_CN },
  { group: '政治家', rows: POL.TP_WORLD },
  { group: '政治家', rows: AXIS.TP_AXIS },
  { group: '军事家', rows: MIL.TB_CN },
  { group: '军事家', rows: MIL.TB_WORLD },
  { group: '军事家', rows: AXIS.TB_AXIS },
  /* 第四轮的名单仍要过一遍：它们大多已在册（按旧号排），少数几条
     （#388 之后新落的素材）会在这里第一次开条。 */
  { group: '文学家', rows: OLD.TY },
  { group: '思想家', rows: OLD.TZ },
  { group: '哲学家', rows: OLD.TW },
  { group: '外国名人', rows: OLD.TA }
];

/* 本轮要删的（先算出来，PLAN 校验与装配都要用） */
const DROP_EARLY = ROUND5.DROP;
const dropSetEarly = {};
DROP_EARLY.forEach(function (t) { dropSetEarly[t] = true; });

/* ── 不许进册的 · 明治维新以后的日本政治 / 军事人物 ─────────────────────
   用户原话（Issue #381）：「轴心国除了日本的政治军事家，其他国家的政治，
   军事家可以添加，但是要从雅尔塔会议，开罗宣言以及二战后的国际秩序角度
   进行评价。帮我清理删除明治维新以后的日本的政治家军事家，如果有的话」

   尺子一条：**明治维新（1868）以后**的日本**政治 / 军事人物**全删
   （含明治、大正、昭和三个时期）；文学家、艺术家、科学家照旧保留 ——
   川端康成 / 夏目漱石 / 芥川龙之介 / 三岛由纪夫是作家，留。
   收进来之前先过一遍这条尺子，别等收了再删（另见 scripts/remove-mingren-jp.js：
   那一份负责排查「已在壳里的」，这一道闸负责拦截「还没进册的」）。

   判据是「分组 + 国别 + 生卒」三件套，两个坑写在下面。 */
/* 判据三件套：① 身份落在政治 / 军事两组；② 朝代 / 国别栏是日本；
   ③ **活在明治维新（1868）以后**。三条同时成立才拦。

   ③ 这条为什么不用「生于 1868 以后」：
   明治维新的主角大多**生在 1868 以前** —— 伊藤博文（1841—1909）、
   大久保利通（1830—1878）、山县有朋（1838—1922）、东乡平八郎（1848—1934）
   都是幕末出生、明治当政。按生年卡，这几位会一个个从尺子里漏过去，
   而用户点名的正是他们。所以判的是**卒年**：卒于 1868 年以后的，
   说明他的政治 / 军事生涯横跨明治维新之后，拦下。

   ⚠️ 另两个坑（也都真踩过）：
   · **不能只看年代**：丘吉尔（1874—1965）、戴高乐（1890—1970）、
     甘地（1869—1948）卒年都在 1868 之后 —— 只看年份会把上一轮刚收的
     外国政治家一并误杀。国别那一栏是必须的。
   · **不能只看国别**：在册的 4 位日本文学家（川端康成 / 夏目漱石 /
     芥川龙之介 / 三岛由纪夫）朝代栏写的正是「日本」，但那一条靠
     「分组不是政治 / 军事」留下来 —— 文学家、艺术家、科学家照旧保留。 */
const MEIJI = 1868;
function isPostMeijiJapanPolitical(group, dynasty, life) {
  if (group !== '政治家' && group !== '军事家') return false;
  if (!/日本/.test(String(dynasty || ''))) return false;
  /* 生卒栏形如「1841—1909」「1890—1970」「1841—（在世）」「？—1945」。
     取**最后一个** 3—4 位数字当卒年（在世 / 卒年不详 → 当作活到 1868 之后）。
     带「前」的（公元前）一律不算明治以后。 */
  const t = String(life || '');
  if (/前s*\d/.test(t)) return false;
  const ys = t.match(/\d{3,4}/g);
  if (!ys) return true;
  return parseInt(ys[ys.length - 1], 10) >= MEIJI;
}

const FIELDS = ['姓名', '朝代', '字 / 号', '生卒', '籍贯', '家世亲属',
  '生平', '作品风格', '流派', '主要作品 / 贡献', '特殊意义'];
const MIN_TOTAL = 400;   // 正文净字数下限（表格线不计）

const problems = [];     // 校验积攒下来的问题，有一条就不写盘

/* 正文净字数：表格线与标点都不算 */
const PUNCT = /[\s·，。、；：「」『』（）()《》〈〉—…？！“”‘’\-－/、]+/g;
function nchars(s) { return String(s == null ? '' : s).replace(PUNCT, '').length; }

/* ── 正文：十一行表 + 一句话。与前几轮同一种形状 ──────────────────────── */
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

/* 在册条目的当前分组：从壳文件读回来。壳是上一轮的产物，但**分组信息只在它
   里面** —— 本轮名单里重给的行会覆盖它，这就是「换组」的入口。 */
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
    /* 明治维新以后的日本政治 / 军事人物：名单里有也直接跳过，不进册 */
    if (isPostMeijiJapanPolitical(plan.group, r[1], r[3])) {
      problems.push('明治维新以后的日本政治 / 军事人物不得入册：' + r[0]);
      return;
    }
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

/* 一人一处：姓名 → PLAN 给的组，本轮的名单优先于壳里记的组 */
const NAME_GROUP = {};
Object.keys(SHELL_GROUP).forEach(function (t) { NAME_GROUP[t] = SHELL_GROUP[t]; });
added.forEach(function (a) { NAME_GROUP[a.row[0]] = a.group; });

const ROSTER = [];
/* ① 在册未删的：正文与 title 从主表来，分组从名单 / 壳来。
      排序先按**组**、再按**旧号** —— 组内次序即老名次，一点不乱。 */
const kept = [];
mrOf.forEach(function (m) {
  if (dropSet[m.title]) return;
  const a = REPLAN[m.title];
  const group = NAME_GROUP[m.title];
  if (!group) { problems.push(m.title + ' 没有分组（壳里也没记）'); return; }
  if (GROUP_ORDER.indexOf(group) < 0) {
    problems.push(m.title + ' 的分组不在 GROUP_ORDER：' + group);
    return;
  }
  if (isPostMeijiJapanPolitical(group, dynastyOf(m.text), lifeOf(m.text))) return;
  kept.push({
    title: m.title, group: group, oldId: m.id,
    /* 名单里重给过的，正文一并换新（名单是更新的一份） */
    text: a ? bodyOf(a.row) : m.text,
    row: a ? a.row : null,
    replace: !!a
  });
});
kept.sort(function (a, b) {
  const ga = GROUP_ORDER.indexOf(a.group), gb = GROUP_ORDER.indexOf(b.group);
  if (ga !== gb) return ga - gb;
  return parseInt(a.oldId.slice(3), 10) - parseInt(b.oldId.slice(3), 10);
});
kept.forEach(function (r) { ROSTER.push(r); });

/* ② 本轮新开条的：正文算出来，次序照 PLAN 给的 */
const FRESH = [];
added.forEach(function (a) {
  const n = a.row[0];
  if (byTitle[n]) return;                 // 已在册，上面处理过了（含换组与换正文）
  if (isPostMeijiJapanPolitical(a.group, a.row[1], a.row[3])) return;
  const rec = { title: n, group: a.group, text: bodyOf(a.row), row: a.row, replace: false };
  ROSTER.push(rec);
  FRESH.push(rec);
});

/* ③ 素材总表（mingren-corpus）里的人：本轮名单没点名、主表里也没有的，
      按 PEOPLE 里记的组补开条 —— 只在 #388 落过素材、且本轮名单未收时才走到。 */
const ROSTER_NAME = {};
ROSTER.forEach(function (r) { ROSTER_NAME[r.title] = true; });
PEOPLE.forEach(function (p) {
  if (ROSTER_NAME[p.name] || dropSetEarly[p.name]) return;
  const group = p.group || GROUP_ORDER[1];
  if (GROUP_ORDER.indexOf(group) < 0) {
    problems.push('素材表的 ' + p.name + ' 分组不在 GROUP_ORDER：' + group);
    return;
  }
  if (isPostMeijiJapanPolitical(group, p.era, p.life)) return;
  const rec = {
    title: p.name, group: group,
    text: bodyOf2(p), row: null, replace: false
  };
  ROSTER.push(rec);
  FRESH.push(rec);
  ROSTER_NAME[p.name] = true;
});

/* 素材对象 ⇄ 行 两种输入，正文同一个出法 */
function bodyOf2(p) {
  const r = [p.name, p.era, p.zi, p.life, p.origin, p.family,
    p.bio, p.style, p.school, p.works, p.worth, p.tag];
  return bodyOf(r);
}

/* ── 按出生时间排（Issue #381 · 用户原话）────────────────────────────────
   「所有类别的名家按出生时间顺序排序。」

   组与组的先后照 GROUP_ORDER（中国在前、外国在后，各组内部再按生年）。
   组内一律按**生年**升序；生年无从考的用 scripts/lib/life-year.js 的
   粗估键（卒年回推 / 世纪折中），仍排不出的一律沉到该组末尾，且保持
   原有相对次序（Array#sort 在现代 V8 上稳定）。
   生年相同的（如王翦与廉颇同记「约前 3 世纪」）按现有次序，不动。 */
(function sortByBirth() {
  const birthOf = {};
  ROSTER.forEach(function (rec) {
    const life = rec.row ? rec.row[3] : lifeOf(rec.text);
    birthOf[rec.title] = LY.birthYearOf(life);
  });
  ROSTER.sort(function (a, b) {
    const ga = GROUP_ORDER.indexOf(a.group), gb = GROUP_ORDER.indexOf(b.group);
    if (ga !== gb) return ga - gb;
    const c = LY.compareBirth(birthOf[a.title], birthOf[b.title]);
    return c;
  });
})();

/* ── 四、守卫：条数 / 分组 / 字段 / 净字数 ─────────────────────────────── */
const countOf = {};
ROSTER.forEach(function (rec) { countOf[rec.group] = (countOf[rec.group] || 0) + 1; });

console.log('主表在册 ' + mrOf.length + ' 位');
console.log('删除 ' + DROP.length + ' 位' +
  (dropGone.length ? '（其中 ' + dropGone.length + ' 位早已不在主表）' : '') +
  '：' + DROP.join('、'));
console.log('名单 ' + added.length + ' 位：已在册 ' + (added.length - FRESH.length > 0 ? added.length - FRESH.length : 0) +
  ' 位、本轮新开条 ' + FRESH.length + ' 位');
const BODY_COUNT = {};
Object.keys(countOf).forEach(function (g) { BODY_COUNT[g] = countOf[g]; });
console.log('名册共 ' + ROSTER.length + ' 位，号段 mr-01 … mr-' +
  String(ROSTER.length).padStart(2, '0'));
console.log('分组：' + GROUP_ORDER.map(function (g) {
  return g + ' ' + (countOf[g] || 0);
}).join(' · '));

const bodySeen = {};
FRESH.forEach(function (rec) {
  const n = nchars(rec.text);
  if (n < MIN_TOTAL) problems.push(rec.title + ' 正文 ' + n + ' 字（下限 ' + MIN_TOTAL + '）');
  bodySeen[rec.title] = true;
});

/* ── 号段 ────────────────────────────────────────────────────────────── */
const RENUMBER = {};
ROSTER.forEach(function (rec, i) {
  const newId = 'mr-' + String(i + 1).padStart(2, '0');
  if (rec.oldId) RENUMBER[rec.oldId] = newId;
  rec.newId = newId;
});

if (problems.length) {
  console.error('✗ 有 ' + problems.length + ' 项不合规（前 20）：' +
    problems.slice(0, 20).join('、'));
  process.exit(1);
}


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
  lines.push('    excerpt: ' + JSON.stringify(s.excerpt));
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
  const lastAt = src.lastIndexOf('    id: "mingren-');
  if (lastAt < 0) throw new Error('主表里没有 mingren-* 那一段');
  const end = src.indexOf('\n  },', lastAt) + 5;
  return src.slice(0, end) + '\n' + block + src.slice(end);
}
/* 重排 mingren-* 那一段：按 ROSTER 的次序、按新号换 id / work / entries */
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
