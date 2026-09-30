/* ==========================================================================
   帝王「中国」/「外国」· 装机（脚本）
   --------------------------------------------------------------------------
   Issue #407。用户原话：

     「课外阅读添加集子如下：帝王「中国」、帝王「外国」。
       中国需要列出夏商周春秋战国直至清末的所有帝王，皇帝，姓名，年号，
       在位年，谥号，庙号，生平，谱系，以及如下
         1. 政治：制度、吏治、集权   2. 经济：赋税、生产、民生
         3. 军事：拓土、平乱、边防   4. 文化：典籍、思想、文教
         5. 民族外交：民族关系、对外交往   6. 个人：品行、用人、晚年得失
       外国帝王至少覆盖教科书小初高大学阶段所有提及的。
       所有人物评价按教科书评价方式为准。」

   ## 三层，与「历代名家」「名著导读」同一套形状
     ① scripts/data/emperor/emperor-dynasties-cn.js  分期骨架（夏 → 清）
     ② scripts/data/emperor/emperor-cn-*.js          一位帝王一条（十格）
        scripts/data/emperor/emperor-cn-note.js      生平 + 六维评价（七段）
     ③ 本脚本                                       装正文、出壳、写主表

   ## 正文长什么样
     ┌──────┬──────┐
     │ 皇号 │ …    │   身份档案：姓名 / 年号 / 在位 / 谥号 / 庙号 / 谱系
     │ 姓名 │ …    │   （用户点名要先列的那几项，一格一项）
     └──────┴──────┘
     【生平】…
     【政治】【经济】【军事】【文化】【民族外交】【个人】  ← 六维评价
     【一句话】…

   ## 白话译文（只有东周诸侯那一段有）
     诸侯这 253 位另给一篇**列传体的白话**（scripts/data/emperor/vassal-
     translation-1/2/3.js）：一段话写完一位君主 —— 他是谁、在位多少年、
     做过哪几件要紧事、怎么死的、传给了谁。用户要「补齐数据」，列传体的
     白话正好是史料的现代读法：原文的正文是《史记》世家与《左传》的
     成句，逐句对译会失真；写成一段小传，一国的译文连着读就是一部
     小型的世家。
     ⚠️ 有了译文，「待补」标记就不能再按「全书都没有译文」来算 ——
        见下面 NO_TRANSLATION_SHIM（壳里给 js/reader-core.js 的接线）。

   ## 号段与次序
     中国卷 em-c-01 …，外国卷 em-w-01 …；每卷各自按**在位时间**先后排
     （分期的次序 + 期内在位起始年升序）。id 一旦发出就不再动 ——
     已读记录、搜索索引、外链都在 id 上。

   用法：
     node scripts/build-emperor.js             # 只出壳
     node scripts/build-emperor.js --master    # 同时改写 data/text-master.js
     node scripts/build-emperor.js --check     # 只校验
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const T = require('./lib/table.js');
const { DYNASTIES } = require('./data/emperor/emperor-dynasties-cn.js');
const { NOTE } = require('./data/emperor/emperor-cn-note.js');
/* ⚠️ 传说时代那 16 位写在源表**末尾**，不是开头。
   id（em-c-01…）按源表次序生成，而主表 data/text-master.js 拿 id 当复用的
   钥匙 —— 新段插在最前会把已有几百位的 id 整体挪位，一身正文全对不上号。
   源表按「信史在前」写，段序另由 GROUP_ORDER_CN 排到最前（见 groupSort）。 */
/* ⚠️ 源表里**新增一段，要写在末尾**（这里就是：传说时代在最后）。
   缘由在 id：壳里的 em-c-01…是按这个数组的次序生成的，而主表
   data/text-master.js 拿 id 当「同一人」的钥匙 ——
   在数组中间插队，已有几百条的 id 会整体往后挪一位，正文全串了门
   （名著导读那一卷的 440 / 441 两条就是这么埋下的：正文改了、version 没跟上）。
   entry-patch.applyAll 现在会当场拦下这种挪位（见它的身份行校对）。 */
const CN_ROWS = [].concat(
  require('./data/emperor/emperor-cn-1.js').CN_1,
  require('./data/emperor/emperor-cn-2.js').CN_2,
  require('./data/emperor/emperor-cn-3.js').CN_3,
  require('./data/emperor/emperor-cn-4.js').CN_4,
  require('./data/emperor/emperor-legend.js').CN_LEGEND,
  require('./data/emperor/emperor-cn-vassal-1.js').CN_VASSAL_1,
  require('./data/emperor/emperor-cn-vassal-2.js').CN_VASSAL_2
);
const FOREIGN = require('./data/emperor/emperor-foreign.js');

/* 诸侯那一段的白话译文（列传体，一段一位）。三份按国分卷。 */
const VASSAL_TR = Object.assign({},
  require('./data/emperor/vassal-translation-1.js').VASSAL_TR_1,
  require('./data/emperor/vassal-translation-2.js').VASSAL_TR_2,
  require('./data/emperor/vassal-translation-3.js').VASSAL_TR_3);

const ROOT = path.join(__dirname, '..');
const SHELL_CN = path.join(ROOT, 'data/poems-emperor-cn.js');
const SHELL_FOREIGN = path.join(ROOT, 'data/poems-emperor-waiguo.js');

const argv = process.argv.slice(2);
const WANT_MASTER = argv.indexOf('--master') >= 0;
const CHECK_ONLY = argv.indexOf('--check') >= 0;
const STRICT = argv.indexOf('--strict') >= 0;

/* ── 分期骨架：组就是「分期」，列表页的索引卡按它分段 ──────────────────
   明清两代帝王多，一组一段；先秦的夏商周各自成段。 */
const DYN = {};      // 分期键 → [key, 名称, 起, 讫, 备注]
DYNASTIES.forEach(function (d) { DYN[d[0]] = d; });
const PERIOD_OF = {}; // 分期键 → 分期名（列表页分段用）

const GROUP_ORDER_CN = DYNASTIES
  .filter(function (d) { return d[0] !== 'minguo'; })
  .map(function (d) { return d[1]; });

const GROUP_ORDER_FOREIGN = require('./data/emperor/emperor-foreign.js').GROUP_ORDER;

/* ── 一国之内的世系图（Issue #407 追问：「世系及数据」） ──────────────
   东周诸侯那一段的抬头（第一格）除了国名，还给一张该国的**世系图**：
   按源表次序（就是在位先后）把这一国诸君连起来写。它回答的是「世系」，
   与第七格「谱系」（承谁之统、传与谁）互为表里 —— 后者是一位一条，
   前者是一国一条。别的段（天子、传说时代等）不画。 */
function lineageOf(list, country) {
  return list.filter(function (r) { return r.country === country; })
    .map(function (r, i) { return (i === 0 ? '' : ' → ') + r.name + '（' + r.reign + '）'; })
    .join('');
}

/* ── 正文装配 ─────────────────────────────────────────────────────────── */
const IDENT_ROWS = [
  ['姓名', 'name'], ['年号', 'era'], ['在位', 'reign'],
  ['谥号', 'posthumous'], ['庙号', 'temple'], ['谱系', 'lineage']
];
const DIM = [
  ['politics', '政治'], ['economy', '经济'], ['military', '军事'],
  ['culture', '文化'], ['diplomacy', '民族外交'], ['person', '个人']
];

/* 诸侯那一段的段名。世系图只在这一段出现（见 lineageOf）。 */
const VASSAL_GROUP = '东周·诸侯（春秋战国）';

function bodyOf(rec, group, foreign) {
  const n = NOTE[rec.name];
  if (!n) throw new Error('缺六维素材：' + rec.name);
  const miss = ['life'].concat(DIM.map(function (d) { return d[0]; }))
    .filter(function (k) { return !n[k]; });
  if (miss.length) throw new Error(rec.name + ' 缺字段：' + miss.join('/'));

  const rows = [['皇号', rec.name + '（' + rec.dynastyLabel + '）']];
  if (rec.period === VASSAL_GROUP) rows.push(['世系', rec.lineageChart]);
  /* 外国帝王没有中文意义上的「姓名」—— 那一格原先只有汉译名。Issue #399
     用户原话：「所有外国帝王和名人，请添加他们的英文，以及所在国家语言的
     名字。如果能找到的话。」素材里 `nameFull` 本来就带着外文名（如
     「拿破仑·波拿巴（Napoleon Bonaparte）」），此前只在列表页的
     `author` 里露面，正文的「姓名」一格一直没接上。这里接上 —— 只对外国卷，
     中国卷的「姓名」（姒文命 / 刘彻）是真的姓名，一个字不动。 */
  IDENT_ROWS.forEach(function (r) {
    if (foreign && r[1] === 'name' && rec.nameFull) {
      rows.push([r[0], String(rec.nameFull)]);
      return;
    }
    rows.push([r[0], String(rec[r[1]] == null ? '—' : rec[r[1]])]);
  });
  const out = [T.box(rows)];
  out.push('【生平】' + n.life);
  DIM.forEach(function (d) { out.push('【' + d[1] + '】' + n[d[0]]); });
  out.push('【一句话】' + rec.tag);
  /* 段间一个空行（Issue #407 第四次追问：「生平，政治，经济，军事，文化，
     民族外交，个人以及一句话 直接增加间隔（或者空白行）」）。
     阅读器的渲染把空行译成一次换行（renderBlocks 的 plain）——
     正文是词条式的长段，段与段不空开就糊成一大片，八段挤在一起分不出眉眼。
     表格与【生平】之间同样留一行，不贴在框线上。 */
  return out.join('\n\n');
}

/* ── 条目 ─────────────────────────────────────────────────────────────── */
function buildRows(rows, foreign) {
  const out = [];
  rows.forEach(function (r) {
    const key = r[1];
    /* 分段名（列表页索引卡的那一段）：
       · 中国卷：分期键 → 分期名（夏 / 商 / 西周…）；
       · 外国卷：第 2 格本身就是段名（上古东方 / 希腊与罗马…），第 3 格是国别。 */
    const period = foreign ? r[1] : (DYN[key] ? DYN[key][1] : r[2]);
    out.push({
      name: r[0], key: key, period: period,
      /* 卷别（中国 / 外国）落成字段：正文的「姓名」一格要不要接 `nameFull`
         （外文名）就看它，不靠段名或词表再猜一次。 */
      foreign: !!foreign,
      dynastyLabel: r[2], nameFull: r[3], era: r[4], reign: r[5],
      posthumous: r[6], temple: r[7], lineage: r[8], tag: r[9]
    });
  });
  return out;
}

/* 排序：先按分期的先后（GROUP_ORDER 的次序），组内**保持源表里的次序** ——
   源表就是按在位先后一位一位写下来的（先秦没有年号、在位只记年数，
   按「在位年数」排序会把大禹排到孔甲后面）。分期键决定段，段内不动。 */
const ORDER_OF = {};
function groupSort(list, groupOrder) {
  groupOrder.forEach(function (g, i) { ORDER_OF[g] = i; });
  list.forEach(function (r, i) { r._i = i; });
  list.sort(function (a, b) {
    const ga = ORDER_OF[a.period] == null ? 999 : ORDER_OF[a.period];
    const gb = ORDER_OF[b.period] == null ? 999 : ORDER_OF[b.period];
    if (ga !== gb) return ga - gb;
    return a._i - b._i;
  });
  return list;
}

const CN = groupSort(buildRows(CN_ROWS, false), GROUP_ORDER_CN);

/* 诸侯那一段：按国别给每位补一张一国的世系图。
   ⚠️ 国别取自源表第 3 格（「晋」「楚」「齐」…），与段名分开 ——
      表头第一格写「国别（分期）」，与全卷同一套形状。
   ⚠️ 分两步走：先**全部**标上国别，再算世系图。若在同一个 forEach 里
      边标边算，算到第一条时后面的条目还没有 country，lineageOf 只能
      捕到当前这一条 —— 世系图会退化成一个人（第一版就是这么错的）。 */
CN.forEach(function (r) {
  if (r.period !== VASSAL_GROUP) return;
  r.country = r.dynastyLabel;
});
CN.forEach(function (r) {
  if (r.period !== VASSAL_GROUP) return;
  r.lineageChart = lineageOf(CN, r.country);
});
const FOREIGN_ROWS = groupSort(buildRows(FOREIGN.ROWS, true), GROUP_ORDER_FOREIGN);

console.log('帝王「中国」' + CN.length + ' 位 · 帝王「外国」' + FOREIGN_ROWS.length + ' 位');

/* 查缺：一个一个点名，不静默跳过 */
const problems = [];
CN.concat(FOREIGN_ROWS).forEach(function (r) {
  const n = NOTE[r.name];
  if (!n) { problems.push(r.name + ' 缺六维素材'); return; }
  ['life'].concat(DIM.map(function (d) { return d[0]; })).forEach(function (k) {
    if (!n[k]) problems.push(r.name + ' 缺 ' + k);
  });
});
/* 诸侯那一段：每位都要有白话译文，缺一篇就点名（不静默出一条没有译文的）。 */
CN.forEach(function (r) {
  if (r.period !== VASSAL_GROUP) return;
  const t = VASSAL_TR[r.name];
  if (!t) { problems.push(r.name + ' 缺白话译文'); return; }
  if (String(t).length < 40) problems.push(r.name + ' 的白话译文过短（' + String(t).length + ' 字）');
});
/* 反向：译文表里不能有源表没有的键（拼错了名字会静默多出一条没人用的译文） */
Object.keys(VASSAL_TR).forEach(function (k) {
  if (!CN.some(function (r) { return r.name === k && r.period === VASSAL_GROUP; })) {
    problems.push('译文表里有源表没有的键：' + k);
  }
});
if (problems.length) {
  console.error('✗ ' + problems.length + ' 处缺漏：');
  problems.slice(0, 30).forEach(function (p) { console.error('   ' + p); });
  if (STRICT) process.exit(1);
}

/* ── 出壳 ─────────────────────────────────────────────────────────────── */
/* id 的号段：传说时代一段单独走 em-c-legend-NN。
   缘由还是 id 与「同一人」的绑定 —— 这一段是 Issue #407 追问之后补的，
   **排在卷首**（段序最前），若照样按位次编号，已有 340 位的 id 会整体
   推后一位、主表里的正文全部错位（名著导读那一卷就吃过这个亏）。
   另开一段号，老 id（em-c-01…）按原样不动，新段用新号。 */
function shells(list, prefix, varName, bookId) {
  const lines = ['window.' + varName + ' = ['];
  let legend = 0;
  let vassal = 0;
  let seq = 0;
  list.forEach(function (r) {
    /* 传说时代那一段另起号（见上），其余按位次 —— 老 id 一位不动。
       ⚠️ 位次 **不数传说时代那几位**：它们排在卷首，却是后补的，
          若把它们的位次算进去，老条目照样整体推后一位。 */
    /* ⚠️ 与传说时代同一条纪律：这一段排在东周两段之后、秦之前（组序见
       GROUP_ORDER_CN），若照样按位次编号，已有 356 位的 id 会从「秦」起
       整体推后 —— 又是名著导读踩过的那个坑。所以诸侯那一段**另起号段**
       em-c-vassal-NN，老号段一位不动，两段新老之间互不影响。 */
    const id = (prefix === 'em-c' && r.period === '传说时代')
      ? 'em-c-legend-' + String((legend += 1)).padStart(2, '0')
      : (prefix === 'em-c' && r.period === VASSAL_GROUP)
        ? 'em-c-vassal-' + String((vassal += 1)).padStart(2, '0')
        : (prefix === 'em-c' ? 'em-c' : 'em-w') + '-' + String((seq += 1)).padStart(2, '0');
    r.id = id;
    const sh = {
      textRef: 'dwang-' + id,
      id: id,
      title: r.name,
      group: r.period,
      gradeGroup: r.period,
      dynasty: r.dynastyLabel,
      author: r.nameFull,
      source: '《' + r.name + '》·' + r.reign,
      excerpt: r.tag
    };
    /* 白话译文：只有诸侯那一段有（列传体）。**不内联在壳里** ——
       data/text-master.js 是正文与译文的唯一一份（Issue #342 起各部一律
       如此，test/canonical.test.js 也守着这一条）。这里只留一个
       `hasTranslation` 的标记：列表页据它决定要不要挂「译文」入口。 */
    if (prefix === 'em-c' && r.period === VASSAL_GROUP) {
      sh.hasTranslation = true;
    }
    lines.push('  {');
    Object.keys(sh).forEach(function (k){
      lines.push('    ' + k + ': ' + JSON.stringify(sh[k]) + ',');
    });
    lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, '');
    lines.push('  },');
  });
  lines.push('];');
  return lines.join('\n') + '\n';
}

if (CHECK_ONLY) {
  let bad = 0;
  CN.concat(FOREIGN_ROWS).forEach(function (r) {
    try { bodyOf(r, r.period, !!r.foreign); } catch (e) { console.error('✗ ' + e.message); bad++; }
  });
  if (bad) process.exit(1);
  console.log('✓ 校验通过：' + (CN.length + FOREIGN_ROWS.length) + ' 位帝王六维齐备');
  process.exit(0);
}

fs.writeFileSync(SHELL_CN, shells(CN, 'em-c', 'POEMS_EMPEROR_CN', 'emperor-cn'));
fs.writeFileSync(SHELL_FOREIGN, shells(FOREIGN_ROWS, 'em-w', 'POEMS_EMPEROR_FOREIGN', 'emperor-waiguo'));
console.log('✓ data/poems-emperor-cn.js（' + CN.length + ' 条）');
console.log('✓ data/poems-emperor-waiguo.js（' + FOREIGN_ROWS.length + ' 条）');

/* ── 写主表 ───────────────────────────────────────────────────────────── */
if (WANT_MASTER) {
  const P = require('./lib/entry-patch.js');
  const state = P.load();
  const all = CN.concat(FOREIGN_ROWS).map(function (r) {
    const it = {
      id: 'dwang-' + r.id,
      title: r.name,
      entries: ['dwang-' + r.id],
      text: bodyOf(r, r.period, !!r.foreign)
    };
    /* 白话译文也要进主表 —— 主表是正文与译文的唯一一份（Issue #342 起
       各部的正文都收归主表，壳体只留 textRef）。诸侯这 253 位是唯一
       带译文的帝王条目。 */
    if (r.period === VASSAL_GROUP) it.translation = VASSAL_TR[r.name];
    return it;
  });
  const fresh = all.filter(function (it) { return !state.byId[it.id]; });
  if (fresh.length) {
    const ins = P.insertAll(fresh);
    P.write(ins.src);
    console.log('✓ data/text-master.js 追加 ' + ins.added.length + ' 条');
  }
  const patch = {};
  all.forEach(function (it) {
    patch[it.id] = it.translation == null
      ? it.text
      : { text: it.text, translation: it.translation };
  });
  const res = P.applyAll(patch, { force: argv.indexOf('--force') >= 0, syncVersion: true });
  P.write(res.src);
  console.log('✓ data/text-master.js 改写 ' + res.changed.length + ' 条' +
    (res.skipped.length ? '（跳过 ' + res.skipped.length + '）' : ''));

  /* 正文写完，**再校一遍 version**。
     客户端的「这条是不是新的」认的是 version（内容摘要），
     而 version 是 build-text-master.js 生成时算的。新写进去的条目
     一路走过来没问题，但早先那几百条里若有过「正文被 service 改动、
     version 没跟上」的，客户端会认不出 —— 这里按当前正文重算一遍，
     只改 version 一行，不动文本一个字。 */
  const ids = all.map(function (it) { return it.id; });
  const again = P.rehashAll(ids);
  if (again.missing.length) {
    console.error('✗ 主表里缺 ' + again.missing.length + ' 条：' + again.missing.slice(0, 5).join('、'));
    process.exit(1);
  }
  P.write(again.src);
  console.log('✓ data/text-master.js 校版次：' + again.changed.length + ' 条 version 与正文不符，已按正文重算');
}
