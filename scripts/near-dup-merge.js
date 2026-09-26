const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const MERGES = [
  {
    keep: 'poems-xx4-23', drop: 'tangshi-ts-259',
    rule: 'course',
    title: '黄鹤楼送孟浩然之广陵',
    word: '唯', fromWord: '惟',
    note: '教材（人教版四年级下册）作「唯见长江天际流」，选本作「惟见」——有教材，以教材为准'
  },
  {
    keep: 'poems-cz7-08', drop: 'tangshi-ts-270',
    rule: 'course',
    title: '夜上受降城闻笛',
    word: '烽', fromWord: '峰',
    note: '教材（统编版七年级上册）作「回乐烽前沙似雪」并注「烽，烽火台」，选本作「回乐峰」——有教材，以教材为准'
  },
  {
    keep: 'poems-gz11-06', drop: 'tangshi-ts-78',
    rule: 'course',
    title: '将进酒',
    word: '愿', fromWord: '复',
    note: '教材（统编版高二下）作「但愿长醉不愿醒」，选本作「但愿长醉不复醒」——有教材，以教材为准；' +
      '另有「五花马、千金裘」与「五花马，千金裘」的顿号 / 逗号之别，一并按教材写法统一'
  },
  {

    keep: 'songci-sc-134', drop: 'songci-sc-127',
    rule: 'simplified',
    title: '蝶恋花·改徐冠卿词',

    keepWord: '苹', keepFromWord: '蘋',
    word: '蘋', fromWord: '苹',
    remove: true,
    note: '两条同在《宋词三百首》（贺铸），没有教材可比；「苹」是简体写法，按简体字为准取「苹」'
  }
];

const BOOK_FILE = {
  classic: 'data/poems-classic.js',
  yuefu: 'data/poems-yuefu.js',
  tangshi: 'data/poems-tangshi.js',
  songci: 'data/poems-songci.js',
  guwen: 'data/poems-guwen.js',
  zhaoming: 'data/poems-zhaoming.js',
  yuanqu: 'data/poems-yuanqu.js',
  yuefu: 'data/poems-yuefu.js',
  jinxiandai: 'data/poems-jinxiandai.js'
};
const POEMS_FILES = [];
for (let i = 1; i <= 12; i++) POEMS_FILES.push('data/poems-' + i + '.js');
function filesOf(siteId) {
  const book = siteId.split('-')[0];
  return book === 'poems' ? POEMS_FILES : [BOOK_FILE[book]];
}

const ENTRY_START = /^  \{/;
const ENTRY_END = /^  \},?\s*$/;
const ID_LINE = /(?:^\s*|\{\s*)id:\s*"([^"]+)"/;

function findEntry(file, innerId) {
  const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!ENTRY_START.test(lines[i])) continue;
    let j = i;
    while (j < lines.length && !ENTRY_END.test(lines[j])) j++;
    const block = lines.slice(i, j + 1);
    const m = block.join('\n').match(ID_LINE);
    if (m && m[1] === innerId) return { start: i, end: j, block: block, file: file };
    i = j;
  }
  return null;
}
function locate(siteId) {
  const innerId = siteId.slice(siteId.indexOf('-') + 1);
  let hit = null;
  filesOf(siteId).forEach(function (f) { if (!hit) hit = findEntry(f, innerId); });
  return hit;
}

module.exports = { MERGES };

if (require.main !== module) return;

const APPLY = process.argv.indexOf('--apply') >= 0;
const vm = require('vm');

const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
[
  'data/text-master.js',
  'data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js',
  'data/poems-5.js', 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js',
  'data/poems-9.js', 'data/poems-10.js', 'data/poems-11.js', 'data/poems-12.js',
  'data/index.js', 'data/poems-classic.js', 'data/poems-tangshi.js',
  'data/poems-songci.js', 'data/poems-guwen.js', 'data/poems-zhaoming.js',
  'data/poems-yuanqu.js', 'data/poems-yuefu.js',
  'data/site-books.js',
  'data/site-index.js'
].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
});
const byId = {};
sandbox.SITE_INDEX.forEach(function (p) { byId[p.id] = p; });
const textOf = function (id) {
  const p = byId[id];
  if (!p) return null;
  return sandbox.masterTextOf ? sandbox.masterTextOf(p, p.book).text : p.text;
};
const nz = function (t) { return String(t || '').replace(/\s+/g, ''); };

let bad = 0;
console.log('裁定：有教材以教材为准 → 没有教材以简体字为准 → 都裁不了的自行判断\n');
MERGES.forEach(function (m) {
  const ta = nz(textOf(m.keep)), tb = nz(textOf(m.drop));
  if (!ta || !tb) {

    if (ta || tb) {
      console.log('· ' + m.title + '：已合并（' + (ta ? m.drop : m.keep) + ' 已不在语料里），跳过');
      return;
    }
    console.error('✗ 条目不存在：' + m.keep + ' / ' + m.drop); bad++; return;
  }
  if (ta === tb) { console.log('· ' + m.title + '：两条正文已逐字相同（已合并），跳过'); return; }

  const diffs = [];
  m.posDiff = [];
  if (ta.length !== tb.length) diffs.push('长度不同');
  else for (let i = 0; i < ta.length; i++) {
    if (ta[i] === tb[i]) continue;
    diffs.push(ta[i] + '→' + tb[i]);
    m.posDiff.push({ at: i, to: ta[i], from: tb[i] });
  }

  const finalWord = m.keepWord || m.word;

  const ok = diffs.length >= 1 && diffs.length <= 3 &&
    m.posDiff.length === (ta.length === tb.length ? diffs.length : 0);
  if (!ok) bad++;
  console.log((ok ? '✓ ' : '✗ ') + m.title + '（' + m.keep + ' ↔ ' + m.drop + '）：共 ' +
    diffs.length + ' 处之别' + (diffs.length ? '（' + diffs.join('、') + '）' : ''));
  console.log('    ' + m.note);
});
if (bad) { console.error('\n✗ 有 ' + bad + ' 处对不上，先订正裁定表'); process.exit(1); }

if (!APPLY) {
  console.log('\n共 ' + MERGES.length + ' 组。（预演，未改任何文件；加 --apply 才真改）');
} else {

  let changed = 0;
  MERGES.forEach(function (m) {
    const target = m.keepWord ? m.keep : m.drop;
    const fromChar = m.keepWord ? m.keepFromWord : m.fromWord;
    const toChar = m.keepWord ? m.keepWord : m.word;
    const hit = locate(target);
    if (!hit) throw new Error('找不到条目 ' + target);
    let block = hit.block.join('\n');

    const mText = block.match(/(text:\s*")((?:[^"\\]|\\.)*)(")/);
    if (!mText) throw new Error(target + ' 里找不到 text 字段');
    const raw = mText[2];

    const map = [];
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === '\\') { i++; continue; }
      map.push(i);
    }
    let chars = raw.split('');
    let touched = 0;
    (m.posDiff || []).forEach(function (d) {

      const at = map[d.at];
      if (at == null) return;
      const want = m.keepWord ? d.to : d.from;
      const next = m.keepWord ? d.from : d.to;
      if (chars[at] === next) return;
      if (chars[at] !== want) return;
      chars[at] = next;
      touched++;
    });
    if (touched) {
      const newer = chars.join('');
      block = block.replace(raw, newer);
      const lines = fs.readFileSync(path.join(ROOT, hit.file), 'utf8').split('\n');
      lines.splice(hit.start, hit.end - hit.start + 1, block);
      fs.writeFileSync(path.join(ROOT, hit.file), lines.join('\n'), 'utf8');
    }
    console.log('✓ ' + hit.file + ' ' + target + '：统一写法「' + fromChar + '」→「' + toChar +
      '」（共 ' + touched + ' 处，' + (m.rule === 'course' ? '以教材为准' : '以简体字为准') + '）');
    changed++;

    if (m.remove) {
      const hit = locate(m.drop);
      if (!hit) throw new Error('找不到条目 ' + m.drop);
      const lines = fs.readFileSync(path.join(ROOT, hit.file), 'utf8').split('\n');
      let start = hit.start;
      while (start > 0 && /^\s*(\/\/|\/\*|\*)/.test(lines[start - 1])) start--;
      lines.splice(start, hit.end - start + 1);
      fs.writeFileSync(path.join(ROOT, hit.file), lines.join('\n'), 'utf8');
      console.log('✓ ' + hit.file + ' 删掉 ' + m.drop + '（自拟编号的那条并入「' + m.title + '」）');
      changed++;
    }
  });
  console.log('\n用字统一完成，共 ' + changed + ' 条。下一步（顺序不能换）：');
  console.log('  1. node scripts/build-works-map.js          # 判重表：两组各并成一篇');
  console.log('  2. node scripts/build-text-master.js        # 存储主表：收归这两篇');
  console.log('  3. node scripts/apply-text-master.js        # 选本那一条的正文摘成 textRef');
  console.log('  4. node scripts/build-canonical-texts.js    # 显示层裁定表（预期 0 条）');
}
