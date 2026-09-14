/**
 * 正文收归主表 · 第二步：把各集子的重复条目退化成「只存归属」
 * ==========================================================================
 * 第一步 scripts/build-text-master.js 已算出 data/text-master.js（文本只落一份）。
 * 这一步把各集子数据文件里**已被主表收编的条目**的内联正文摘掉：
 *
 *   删掉   text / translation / translationSource 三行
 *   加入   textRef: "<主条目站点 id>"
 *
 * 于是「同一篇作品的正文」在磁盘上只剩一份（主表里那一份），
 * 其余集子的条目只留「我是哪一篇」（题名 / 作者 / 朝代 / 卷次 …… 归属信息）。
 * 正文由引擎（js/reader-core.js）按 textRef 到主表取。
 *
 * ⚠️ 本脚本**直接改语料文件**。差分应当只含「摘内联正文 + 加 textRef」两类改动 ——
 *    跑完请 `git diff` 逐条看，任何别的改动都说明脚本改错了。
 *
 * ## 两种条目写法都要认（数据文件前后期不统一）
 *   A（展开式，poems-1..6 / classic / tangshi / songci / guwen / zhaoming）：
 *       ```
 *         {
 *           id: "ts-6",
 *           ...
 *           text: "...",
 *       ```
 *   B（紧凑式，poems-7..12）：
 *       ```
 *         { id: "cz8-01", title: "三峡", ..., 
 *           text: "..." ,
 *       ```
 *   两者**条目起止行都是 `  {` 开头 / `  },` 收尾**，字段行以 `text:` 等开头，
 *   所以按「行首缩进 + 字段名」处理，不依赖 `{` 与 `id` 是否同行。
 *
 * 用法：
 *   node scripts/build-text-master.js     # 先算表
 *   node scripts/apply-text-master.js     # 再摘内联正文（本脚本）
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* 载入主表：只认已经生成好的 data/text-master.js */
const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'data/text-master.js'), 'utf8'), sandbox,
  { filename: 'data/text-master.js' });
const MASTER = sandbox.TEXT_MASTER || [];
if (!MASTER.length) {
  console.error('✗ data/text-master.js 是空的 —— 先跑 node scripts/build-text-master.js');
  process.exit(1);
}

/* 站点索引 id → 主条目 id（同一个作品的全部条目都指向主条目） */
const ref = {};
MASTER.forEach(function (m) {
  (m.entries || []).forEach(function (e) { ref[e] = m.id; });
});

/* 各集子数据文件 → 集子前缀（站点索引 id = 前缀 + 集子内 id） */
const BOOKS = [
  { file: 'data/poems-1.js', prefix: 'poems-' },
  { file: 'data/poems-2.js', prefix: 'poems-' },
  { file: 'data/poems-3.js', prefix: 'poems-' },
  { file: 'data/poems-4.js', prefix: 'poems-' },
  { file: 'data/poems-5.js', prefix: 'poems-' },
  { file: 'data/poems-6.js', prefix: 'poems-' },
  { file: 'data/poems-7.js', prefix: 'poems-' },
  { file: 'data/poems-8.js', prefix: 'poems-' },
  { file: 'data/poems-9.js', prefix: 'poems-' },
  { file: 'data/poems-10.js', prefix: 'poems-' },
  { file: 'data/poems-11.js', prefix: 'poems-' },
  { file: 'data/poems-12.js', prefix: 'poems-' },
  { file: 'data/poems-classic.js', prefix: 'classic-' },
  { file: 'data/poems-tangshi.js', prefix: 'tangshi-' },
  { file: 'data/poems-songci.js', prefix: 'songci-' },
  { file: 'data/poems-guwen.js', prefix: 'guwen-' },
  { file: 'data/poems-zhaoming.js', prefix: 'zhaoming-' }
];

/* 字段行：行首 2~6 空格 + 字段名 + 冒号 + 双引号值。
   ⚠️ 兼容紧凑式的 `text: "..." ,`（引号后多一个空格再接逗号）——
      这里只判断行首字段名，值长什么样不关心。 */
const FIELD = /^(\s+)(text|translation|translationSource):\s*"/;
// 「键名独占一行、值写在下一行」的写法（昭明文选的长译文就是这样排的）：
//     translation:
//       "有人说，赋是古诗的支流。……",
// ⚠️ 只认「键名后直接换行、下一行以引号起头、且这一行就收尾（`",` 或 `"`）」这一种 ——
//    正文里出现一个恰好行首是 `translation:` 的句子时不该被当字段名吃掉，
//    所以不写「跨行找引号」那种宽松正则。
const FIELD_BARE = /^(\s+)(text|translation|translationSource):\s*$/;
const VALUE_ONE_LINE = /^\s+".*",?\s*$/;
/* 条目起止行：`  {` … `  },`（紧凑式则是 `  { id: ...` 起头）。
   ⚠️ 两处都**不限定缩进恰好两格**，而原来写的正是 `/^  \{/` 与 `/^  \},?\s*$/`。
      实测踩到两次，后果都是**静默的**：
        · 《齐桓晋文之事》起头那行是行首**顶格**的 `{` —— 起点不命中，
          这一条从没被处理过，一直保留内联正文；而主表里已经登记了它
          （主表按站点索引算，不看缩进），「主表说有正文、语料里也确实有」，
          两下全对得上，只是「退化成只存归属」这件事悄悄少做了一条。
        · 《展喜犒师》收尾那行**只有一格**缩进 —— 终点不命中，
          块一直往下吃，把后面那一条也吞了进来，于是那一条的 textRef 插不上。
      放宽成「至少一格」之外，本脚本收尾还有一条**逐条对账**
      （见文件末 missingRef），让这类「写法偏一格」当场亮红。 */
const ENTRY_START = /^\s*\{/;
const ENTRY_END = /^\s*\},?\s*$/;
// 两种写法：A 的 `    id: "ts-6",`（独立一行）；B 的 `  { id: "cz8-01", ...`（与 `{` 同行）
/* ⚠️ 这个正则**必须带 `m`（多行）标志**。
   不带时 `^` 只认**整段字符串的开头**，而条目块是以 `  {` 起头的 ——
   于是「`  {` 与 `id:` 不同行」的那些条目（绝大多数，因为 `textRef` 现在
   插在 id 之前）一个都匹配不上：idM 取到空字符串，masterId 自然是 undefined，
   对应条目就**静默地不摘正文**。页面上完全看不出来，只有磁盘上少收了几条。
   带 `m` 之后 `^` 认每一行的行首，`textRef` / `id:` 逐行都能命中。 */
const ID_LINE = /(?:^\s*|\{\s*)id:\s*"([^"]+)"/m;

/**
 * 在一个条目的文本块里摘掉内联正文三行、加入 textRef。
 * 用**逐行**处理而不是整块正则：正文里可能含 `}`、引号、反斜杠、
 * 甚至 `text:` 这样的字串，整块正则很容易吃错边界。
 */
function rewriteEntry(block, masterId) {
  const lines = block.split('\n');
  const kept = [];
  let removed = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (FIELD.test(line)) { removed += 1; continue; }      // 值同行：摘一行
    if (FIELD_BARE.test(line)) {                            // 值在下一行：摘两行
      const next = lines[i + 1];
      if (!next || !VALUE_ONE_LINE.test(next)) {
        throw new Error('「' + line.trim() + '」独占一行，但下一行不是单行字符串值 —— ' +
          '写法变了，脚本要跟着改\n' + block.slice(0, 200));
      }
      removed += 1;
      i += 1;
      continue;
    }
    kept.push(line);
  }
  if (removed !== 3) {
    throw new Error('条目应恰好含 text / translation / translationSource 三行，实际摘掉 ' +
      removed + ' 行 —— 数据文件写法变了，脚本要跟着改\n' + block.slice(0, 200));
  }
  // textRef 插在 `id:` 行之前：位置稳定、diff 也最小
  const idAt = kept.findIndex(function (l) { return ID_LINE.test(l); });
  if (idAt < 0) throw new Error('条目里找不到 id 行：\n' + block.slice(0, 200));
  // B 式里 id 与 `{` 同行（`  { id: "cz8-01", ...`），textRef 得**另起一行**
  // 插在它后面，不能挤在同一行（否则 diff 与格式都乱）；
  // 缩进一律对齐兄弟字段（B 式的字段本身缩进 4 格，不能沿用 `{` 行那 2 格）。
  const isCompact = /^\s*\{/.test(kept[idAt]);
  const indent = isCompact ? '    ' : ((kept[idAt].match(/^(\s+)/) || ['', '    '])[1]);
  if (isCompact) {
    kept.splice(idAt + 1, 0, indent + 'textRef: ' + JSON.stringify(masterId) + ',');
  } else {
    kept.splice(idAt, 0, indent + 'textRef: ' + JSON.stringify(masterId) + ',');
  }
  return kept.join('\n');
}

let totalTouched = 0;
const report = [];

BOOKS.forEach(function (b) {
  const abs = path.join(ROOT, b.file);
  const lines = fs.readFileSync(abs, 'utf8').split('\n');
  const out = [];
  let i = 0;
  let fileTouched = 0;
  while (i < lines.length) {
    if (ENTRY_START.test(lines[i])) {
      // 收条目块（含起止行）
      let j = i;
      const block = [];
      while (j < lines.length) {
        block.push(lines[j]);
        if (ENTRY_END.test(lines[j])) break;
        j += 1;
      }
      const text = block.join('\n');
      const idM = text.match(ID_LINE);
      const innerId = idM ? idM[1] : '';
      const masterId = ref[b.prefix + innerId];
      // 幂等：块里没有 text: 行（已摘过）就原样放回
      if (masterId && lines.slice(i, j + 1).some(function (l) {
        return FIELD.test(l) || FIELD_BARE.test(l);
      })) {
        out.push(rewriteEntry(text, masterId));
        fileTouched += 1;
      } else {
        out.push(text);
      }
      i = j + 1;
    } else {
      out.push(lines[i]);
      i += 1;
    }
  }
  if (fileTouched) {
    fs.writeFileSync(abs, out.join('\n'), 'utf8');
    totalTouched += fileTouched;
    report.push('  ' + b.file + '  ' + fileTouched + ' 条');
  }
});

/* ---------------- 对账：该摘的条目一条都不能漏 ----------------
   上面按 `  {` … `  },` 切块处理。切块一旦判错（缩进偏一格、写成了别的形态），
   后果是**静默的**：那一条保留内联正文、或者整块被吞掉导致后面几条的
   textRef 插不上 —— 页面上全都正常，只有磁盘上少收了几条。

   所以跑完再按「主表登记的条目 → 该出现 textRef 的行」对一次账：
   主表里登记了、却在语料里找不到 textRef 的，一律中断。 */
const missingRef = [];
Object.keys(ref).forEach(function (entryId) {
  const m = MASTER.filter(function (x) { return (x.entries || []).indexOf(entryId) >= 0; })[0];
  if (!m) return;
  const book = BOOKS.filter(function (b) { return entryId.indexOf(b.prefix) === 0; })[0];
  if (!book) return;                       // 课内条目没有独立的语料文件分组
  const src = fs.readFileSync(path.join(ROOT, book.file), 'utf8');
  const innerId = entryId.slice(book.prefix.length);
  if (src.indexOf('id: ' + JSON.stringify(innerId)) < 0) return;
  // 该条目所在的那一块里必须有 textRef
  const blocks = src.split(/\n(?=\s*\{)/);
  const hit = blocks.filter(function (b) {
    return new RegExp('id:\\s*"' + innerId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"').test(b);
  })[0];
  if (!hit || !/textRef:\s*"/.test(hit)) missingRef.push(book.file + ' ' + entryId);
});
if (missingRef.length) {
  console.error('✗ 有 ' + missingRef.length + ' 条该收归的条目没插上 textRef：');
  console.error('  ' + missingRef.slice(0, 10).join('\n  '));
  console.error('  —— 多半是切块判错了条目边界（缩进 / 写法变了），而非「本来就不该收」。');
  process.exit(1);
}

console.log('✓ 内联正文已摘除，共 ' + totalTouched + ' 条：');
console.log(report.join('\n') || '  （没有需要处理的条目）');
console.log('\n下一步：git diff 逐条核对，只应有「摘三行 + 加 textRef」两类改动。');
