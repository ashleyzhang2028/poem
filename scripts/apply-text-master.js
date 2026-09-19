const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

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

const ref = {};
MASTER.forEach(function (m) {
  (m.entries || []).forEach(function (e) { ref[e] = m.id; });
});

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
  { file: 'data/poems-zhaoming.js', prefix: 'zhaoming-' },
  { file: 'data/poems-yuanqu.js', prefix: 'yuanqu-' },
  { file: 'data/poems-yuefu.js', prefix: 'yuefu-' },
  { file: 'data/poems-jinxiandai.js', prefix: 'jinxiandai-' }
];

const FIELD = /^(\s+)(text|translation|translationSource):\s*"/;

const FIELD_BARE = /^(\s+)(text|translation|translationSource):\s*$/;
const VALUE_ONE_LINE = /^\s+".*",?\s*$/;

const ENTRY_START = /^\s*\{/;
const ENTRY_END = /^\s*\},?\s*$/;

const ID_LINE = /(?:^\s*|\{\s*)id:\s*"([^"]+)"/m;

function rewriteEntry(block, masterId) {
  const lines = block.split('\n');
  const kept = [];
  let removed = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (FIELD.test(line)) { removed += 1; continue; }
    if (FIELD_BARE.test(line)) {
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

  const idAt = kept.findIndex(function (l) { return ID_LINE.test(l); });
  if (idAt < 0) throw new Error('条目里找不到 id 行：\n' + block.slice(0, 200));

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
      const siteId = b.prefix + innerId;
      const masterId = ref[siteId];

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

const missingRef = [];
Object.keys(ref).forEach(function (entryId) {
  const m = MASTER.filter(function (x) { return (x.entries || []).indexOf(entryId) >= 0; })[0];
  if (!m) return;
  const book = BOOKS.filter(function (b) { return entryId.indexOf(b.prefix) === 0; })[0];
  if (!book) return;
  const src = fs.readFileSync(path.join(ROOT, book.file), 'utf8');
  const innerId = entryId.slice(book.prefix.length);
  if (src.indexOf('id: ' + JSON.stringify(innerId)) < 0) return;

  if (entryId === m.id) return;
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
