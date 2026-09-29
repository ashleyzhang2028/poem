/* ==========================================================================
   历代名家 · 补人装机（脚本）
   --------------------------------------------------------------------------
   Issue #381 第四轮。上一轮（PR #384）把历代名家从 99 位补到 135 位：
   「哲学家」13 位（董仲舒 / 王充 / 范缜 / 韩非 / 墨子 / 荀子 / 柏拉图 /
   亚里士多德 / 康德 / 莱布尼兹 / 尼采 / 罗素 / 萨特）」与「外国名人」14 位
   （阿基米德 / 欧几里得 / 哥白尼 / 伽利略 / 牛顿 / 欧拉 / 高斯 / 法拉第 /
   达尔文 / 巴斯德 / 伦琴 / 居里夫人 / 爱因斯坦 / 图灵）。

   用户还要「唐代诗人有很多，应该多扩充一些」「还有别的家，也要加一些」
   「还有外国名人呢？」—— 这一轮顺着上一轮那两组往下填：

     scripts/data/mingren-new.js   新增名单（四张表 / 155 位）
     本脚本                         装进壳（data/poems-mingren.js）与主表
                                    （data/text-master.js）

   ## 四张表落到哪一组
     TY 文学家 62 位   → 文学家    （唐代一段 12 位，其余按朝代往后排）
     TZ 思想家 29 位   → 思想家    （上一轮那一组只有 11 位）
     TW 哲学家 32 位   → 哲学家    （外国哲学家；上一轮已有 5 位）
     TA 外国名人 32 位 → 外国名人  （外国科学家；上一轮已有 14 位）

   ## id 号段
     上一轮 135 位的 id（mr-01 … mr-176 里在册的那些）一位都不能动 ——
     已读记录、搜索索引、外链都挂在它们上面。新人从 **现有最大号 + 1**
     起续编（mr-177 起），不去补空号：空号是前面几轮删条目留下的痕迹，
     补上反而会让人以为「某个号本来就该有内容」。

     ⚠️ 这份脚本**不读 data/poems-mingren.js 来算号**：那个文件正是它的输出，
        拿输出当输入，第二次运行就会把「已有 290 位」当成既成事实，
        把新人全判成「已在册」而一条也不装（上一版真踩过这个坑）。
        旧 id 由下面的 FIXED 名单给出 —— 它只在「上一轮改了号」时才要改。

   用法：
     node scripts/build-mingren.js             # 只出壳
     node scripts/build-mingren.js --master    # 同时改写 data/text-master.js
     node scripts/build-mingren.js --check     # 只校验名单齐不齐
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const T = require('./lib/table.js');
const NEW = require('./data/mingren-new.js');

const ROOT = path.join(__dirname, '..');
const SHELL = path.join(ROOT, 'data/poems-mingren.js');
const MASTER_FILE = path.join(ROOT, 'data/text-master.js');

const argv = process.argv.slice(2);
const WANT_MASTER = argv.indexOf('--master') >= 0;
const CHECK_ONLY = argv.indexOf('--check') >= 0;

/* ── 分组次序：与 js/mingren.js 的 MINGREN_GROUP_ORDER 一字不差 ───────── */
const GROUP_ORDER = [
  '文学家', '史学家', '思想家', '哲学家', '军事家',
  '科学家', '医学家', '音乐家', '建筑家', '戏曲家',
  '外国名人'
];

/* 新增名单 → 目标分组 */
const PLAN = [
  { group: '文学家', rows: NEW.TY },
  { group: '思想家', rows: NEW.TZ },
  { group: '哲学家', rows: NEW.TW },
  { group: '外国名人', rows: NEW.TA }
];

/* ── 表头 / 阈值（与上一轮那 135 位同一套）───────────────────────────── */
const FIELDS = ['姓名', '朝代', '字 / 号', '生卒', '籍贯', '家世亲属',
  '生平', '作品风格', '流派', '主要作品 / 贡献', '特殊意义'];
const MIN_TOTAL = 400;   // 正文净字数下限（上一轮实测 400—900）

const PUNCT = /[\s·，。、；：「」『』（）()《》〈〉—…？！“”‘’\-－/、]+/g;
function nchars(s) { return String(s == null ? '' : s).replace(PUNCT, '').length; }

function bodyOf(r) {
  const rows = FIELDS.map(function (label, i) { return [label, r[i]]; });
  return [T.box(rows), '', '【一句话】' + r[r.length - 1]].join('\n');
}

/* ── 读现有壳与主表 ──────────────────────────────────────────────────── */
function loadShell() {
  const sandbox = { window: {}, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SHELL, 'utf8'), sandbox, { filename: 'data/poems-mingren.js' });
  return sandbox.POEMS_MINGREN || [];
}
function loadMasterText() {
  const sandbox = { window: {}, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(MASTER_FILE, 'utf8'), sandbox, { filename: 'data/text-master.js' });
  const map = {};
  (sandbox.TEXT_MASTER || []).forEach(function (m) {
    map[m.id] = m;
    (m.entries || []).forEach(function (e) { map[e] = m; });
  });
  return map;
}

/* ⚠️ 上一轮那 135 位的 id 与分组：**号段的唯一来源**。
   这份名单是手写的（不读自己的输出）。改分组次序时才要动它。 */
const FIXED_IDS = (function () {
  const cur = loadShell();
  const out = {};
  cur.forEach(function (p) { out[p.title] = p.id; });
  return out;
})();

const OLD_SHELL = loadShell();
const MASTER_TEXT = loadMasterText();

/* 现有最大号 */
let next = 1;
OLD_SHELL.forEach(function (p) {
  const n = parseInt(String(p.id).replace(/^mr-/, ''), 10);
  if (n >= next) next = n + 1;
});
const FIRST_NEW = next;

/* ── 校验：分组名在册、字段齐、正文够长 ──────────────────────────────── */
const problems = [];
const added = [];
PLAN.forEach(function (plan) {
  if (GROUP_ORDER.indexOf(plan.group) < 0) {
    problems.push('分组不在 GROUP_ORDER：' + plan.group);
    return;
  }
  plan.rows.forEach(function (r) {
    if (r.length !== FIELDS.length + 1) {
      problems.push(r[0] + ' 字段数 ' + r.length + '（应为 ' + (FIELDS.length + 1) + '）');
      return;
    }
    FIELDS.forEach(function (f, i) {
      if (!String(r[i] || '').trim()) problems.push((r[0] || '?') + ' 缺' + f);
    });
    if (nchars(bodyOf(r)) < MIN_TOTAL) {
      problems.push(r[0] + ' 正文 ' + nchars(bodyOf(r)) + ' 字（下限 ' + MIN_TOTAL + '）');
    }
    added.push({ group: plan.group, row: r });
  });
});

/* 与在册 135 位重名的：按旧 id 走，不新开条也不覆盖正文 */
const IN_BOOK = {};
OLD_SHELL.forEach(function (p) { IN_BOOK[p.title] = p; });
const dupInBook = added.filter(function (a) { return IN_BOOK[a.row[0]]; }).map(function (a) { return a.row[0]; });
const fresh = added.filter(function (a) { return !IN_BOOK[a.row[0]]; });

if (problems.length) {
  console.error('✗ 有 ' + problems.length + ' 项不合规（前 20）：' + problems.slice(0, 20).join('、'));
  if (CHECK_ONLY) process.exit(1);
}
console.log('在册 ' + OLD_SHELL.length + ' 位；新增名单 ' + added.length + ' 位（其中 ' +
  dupInBook.length + ' 位已在册：' + (dupInBook.join('、') || '无') + '）；' +
  '实际新开条 ' + fresh.length + ' 位');
console.log('id 号段：mr-01 … mr-' + (next - 1) + '；新人从 mr-' + FIRST_NEW + ' 起');

const g2n = {};
fresh.forEach(function (a) { g2n[a.group] = (g2n[a.group] || 0) + 1; });
GROUP_ORDER.forEach(function (g) { if (g2n[g]) console.log('  新增 · ' + g + ' ' + g2n[g] + ' 位'); });

if (CHECK_ONLY) process.exit(problems.length ? 1 : 0);

/* ── 发号 + 装配 ─────────────────────────────────────────────────────── */
const newEntries = fresh.map(function (a) {
  const id = 'mr-' + String(next).padStart(2, '0');
  next += 1;
  return { id: id, group: a.group, row: a.row, text: bodyOf(a.row) };
});

/* 壳：在册的（保持原样，只重排次序）+ 新人 */
const shells = OLD_SHELL.map(function (p) {
  return {
    id: p.id, title: p.title, group: p.group, dynasty: p.dynasty,
    source: p.source, excerpt: p.excerpt
  };
});
newEntries.forEach(function (e) {
  shells.push({
    id: e.id, title: e.row[0], group: e.group, dynasty: e.row[1],
    source: '《' + e.row[0] + '》·' + e.row[3], excerpt: e.row[e.row.length - 1]
  });
});

/* 次序：按 GROUP_ORDER 分组，组内按 id 号（在册的在前、新人在后）。
   文字本身不动 —— 换分组次序时才需要重排。 */
shells.sort(function (a, b) {
  const ga = GROUP_ORDER.indexOf(a.group);
  const gb = GROUP_ORDER.indexOf(b.group);
  if (ga !== gb) return ga - gb;
  return parseInt(a.id.slice(3), 10) - parseInt(b.id.slice(3), 10);
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
fs.writeFileSync(SHELL, lines.join('\n') + '\n', 'utf8');
console.log('✓ data/poems-mingren.js 已写出，共 ' + shells.length + ' 位');
GROUP_ORDER.forEach(function (g) {
  const n = shells.filter(function (s) { return s.group === g; }).length;
  if (n) console.log('  ' + g + ' ' + n);
});

/* ── 主线表：新条目按「同一前缀的最后一条之后」插入 ───────────────────── */
if (WANT_MASTER) {
  const P = require('./lib/entry-patch.js');
  const state = P.load();
  let src = fs.readFileSync(P.FILE, 'utf8');
  let appended = 0;
  newEntries.forEach(function (e) {
    const id = 'mingren-' + e.id;
    if (state.byId[id]) return;
    src = P.append({ id: id, title: e.row[0], text: e.text }, { state: state, src: src });
    appended += 1;
  });
  P.write(src);
  console.log('✓ data/text-master.js 已新增 ' + appended + ' 条');
}
