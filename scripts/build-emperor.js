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
const CN_ROWS = [].concat(
  require('./data/emperor/emperor-cn-1.js').CN_1,
  require('./data/emperor/emperor-cn-2.js').CN_2,
  require('./data/emperor/emperor-cn-3.js').CN_3,
  require('./data/emperor/emperor-cn-4.js').CN_4
);
const FOREIGN = require('./data/emperor/emperor-foreign.js');

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

/* ── 正文装配 ─────────────────────────────────────────────────────────── */
const IDENT_ROWS = [
  ['姓名', 'name'], ['年号', 'era'], ['在位', 'reign'],
  ['谥号', 'posthumous'], ['庙号', 'temple'], ['谱系', 'lineage']
];
const DIM = [
  ['politics', '政治'], ['economy', '经济'], ['military', '军事'],
  ['culture', '文化'], ['diplomacy', '民族外交'], ['person', '个人']
];

function bodyOf(rec, group) {
  const n = NOTE[rec.name];
  if (!n) throw new Error('缺六维素材：' + rec.name);
  const miss = ['life'].concat(DIM.map(function (d) { return d[0]; }))
    .filter(function (k) { return !n[k]; });
  if (miss.length) throw new Error(rec.name + ' 缺字段：' + miss.join('/'));

  const rows = [['皇号', rec.name + '（' + rec.dynastyLabel + '）']];
  IDENT_ROWS.forEach(function (r) { rows.push([r[0], String(rec[r[1]] == null ? '—' : rec[r[1]])]); });
  const out = [T.box(rows)];
  out.push('【生平】' + n.life);
  DIM.forEach(function (d) { out.push('【' + d[1] + '】' + n[d[0]]); });
  out.push('【一句话】' + rec.tag);
  return out.join('\n');
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
if (problems.length) {
  console.error('✗ ' + problems.length + ' 处缺漏：');
  problems.slice(0, 30).forEach(function (p) { console.error('   ' + p); });
  if (STRICT) process.exit(1);
}

/* ── 出壳 ─────────────────────────────────────────────────────────────── */
function shells(list, prefix, varName, bookId) {
  const lines = ['window.' + varName + ' = ['];
  list.forEach(function (r, i) {
    const id = (prefix === 'em-c' ? 'em-c-' : 'em-w-') + String(i + 1).padStart(2, '0');
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
    try { bodyOf(r, r.period); } catch (e) { console.error('✗ ' + e.message); bad++; }
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
    return {
      id: 'dwang-' + r.id,
      title: r.name,
      entries: ['dwang-' + r.id],
      text: bodyOf(r, r.period)
    };
  });
  const fresh = all.filter(function (it) { return !state.byId[it.id]; });
  if (fresh.length) {
    const ins = P.insertAll(fresh);
    P.write(ins.src);
    console.log('✓ data/text-master.js 追加 ' + ins.added.length + ' 条');
  }
  const patch = {};
  all.forEach(function (it) { patch[it.id] = it.text; });
  const res = P.applyAll(patch, { force: argv.indexOf('--force') >= 0 });
  P.write(res.src);
  console.log('✓ data/text-master.js 改写 ' + res.changed.length + ' 条' +
    (res.skipped.length ? '（跳过 ' + res.skipped.length + '）' : ''));
}
