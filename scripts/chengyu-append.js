/* 把一批手工维护的成语追加进 data/poems-chengyu.js（tier1 / tier2 共用）
   --------------------------------------------------------------------------
   数据分别住在 scripts/chengyu-tier1.js 与 scripts/chengyu-tier2.js（纯数据，
   无副作用），本模块只管落库：

     ① 与库内已有的条目比对，重名的直接跳过（幂等，可反复跑）；
     ② 按朝代插进对应段落（全库按十九个朝代分组的次序不能乱）；
     ③ id 续号；正文先内联，随后由 build-text-master.js 收进主表、
        apply-text-master.js 摘去内联副本并补上 textRef —— 与既有流程一致。
        （这里**不写** textRef：写了会让重跑的 build-text-master.js 撞上
        「一边带 textRef、一边还内联正文」的断言。）

   拆出来是因为两批数据的落库规则一字不差，各自再抄一份迟早会走样。
*/
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'data/poems-chengyu.js');

const DYNASTIES = ['上古传说', '夏', '商', '西周', '春秋', '战国', '秦', '西汉', '东汉', '三国',
  '两晋南北朝', '隋', '唐', '五代', '宋', '辽金', '元', '明', '清'];

function entryText(e, id) {
  const [title, source, dynasty, author, group, excerpt, text, translation, meaning] = e;
  // 不写 textRef：新条目先内联正文，由 build-text-master.js 收进主表、
  // apply-text-master.js 摘掉内联副本时再补上（早先在这里写了 textRef，重跑
  // build-text-master.js 会撞上「一边带 textRef、一边还内联正文」的断言）。
  return '  {\n' +
    '    id: ' + JSON.stringify(id) + ',\n' +
    '    title: ' + JSON.stringify(title) + ',\n' +
    '    source: ' + JSON.stringify(source) + ',\n' +
    '    dynasty: ' + JSON.stringify(dynasty) + ',\n' +
    '    author: ' + JSON.stringify(author) + ',\n' +
    '    gradeGroup: ' + JSON.stringify(group) + ',\n' +
    '    meaning: ' + JSON.stringify(meaning) + ',\n' +
    '    excerpt: ' + JSON.stringify(excerpt) + ',\n' +
    '    text: ' + JSON.stringify(text) + ',\n' +
    '    translation: ' + JSON.stringify(translation) + ',\n' +
    '    translationSource: "public-domain",\n' +
    '  }';
}

// label 只用于日志（「第一档」「第二至五档」），不影响落库规则。
function append(entries, label) {
  const sandbox = { window: {}, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  ['data/text-master.js', 'data/poems-chengyu.js'].forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  });
  const CY = sandbox.POEMS_CHENGYU || [];

  const have = {};
  CY.forEach(function (p) { have[p.title] = true; });

  const fresh = entries.filter(function (e) { return !have[e[0]]; });
  const skipped = entries.length - fresh.length;
  if (!fresh.length) {
    console.log('✓ ' + label + '成语都已在库（跳过 ' + skipped + ' 条），无需追加。');
    return;
  }

  let next = 0;
  CY.forEach(function (p) {
    const n = Number(String(p.id).replace('cy-', ''));
    if (n > next) next = n;
  });

  let src = fs.readFileSync(FILE, 'utf8');
  const chunks = src.split(/\n(?=  \{)/);

  const byDyn = {};
  fresh.forEach(function (e) {
    const dyn = e[4];
    if (DYNASTIES.indexOf(dyn) < 0) {
      console.error('✗ 朝代不在朝代表内：' + e[0] + ' → ' + dyn);
      process.exit(1);
    }
    (byDyn[dyn] = byDyn[dyn] || []).push(e);
  });

  const newBlocks = [];
  Object.keys(byDyn).forEach(function (dyn) {
    byDyn[dyn].forEach(function (e) {
      next += 1;
      newBlocks.push({ dyn: dyn, text: entryText(e, 'cy-' + next) });
    });
  });

  // 找到每个朝代最后一行的下标
  const lastOfDyn = {};
  chunks.forEach(function (c, idx) {
    const m = c.match(/^\s*gradeGroup:\s*"([^"]+)",$/m);
    if (!m) return;
    if (DYNASTIES.indexOf(m[1]) >= 0) lastOfDyn[m[1]] = idx;
  });

  const missingDyn = Object.keys(byDyn).filter(function (d) { return lastOfDyn[d] == null; });
  if (missingDyn.length) {
    console.error('✗ 库里找不到这些朝代的段落：' + missingDyn.join('、'));
    process.exit(1);
  }

  const insertAfter = {};
  newBlocks.forEach(function (b) {
    (insertAfter[lastOfDyn[b.dyn]] = insertAfter[lastOfDyn[b.dyn]] || []).push(b.text);
  });

  // 主表收尾的 `];` 挂在最后一段（清的末条）后面，插新条目时不能让它在中间
  const TAIL = /\n\];\s*$/;
  const m = src.match(TAIL);
  if (!m) {
    console.error('✗ 找不到数据文件的收尾 `];` —— 写法变了，脚本要跟着改。');
    process.exit(1);
  }
  const body = src.slice(0, m.index);

  const chunks2 = body.split(/\n(?=  \{)/);
  const out = [];
  chunks2.forEach(function (c, idx) {
    let chunk = c.replace(/\n$/, '');
    if (insertAfter[idx]) {
      // 被插的那条若是本段末条，原先没有尾逗号（数据文件里只有全表末条才省略），
      // 补上，否则新条目会与它黏成一条。
      if (!/,\s*$/.test(chunk)) chunk += ',';
      insertAfter[idx].forEach(function (t) { out.push(t + ','); });
    }
    out.push(chunk);
  });

  src = out.join('\n') + '\n];\n';
  // 新条目后面紧跟 `];` 的那一条不该带逗号
  src = src.replace(/,\n\];\n$/, '\n];\n');

  fs.writeFileSync(FILE, src, 'utf8');
  console.log('✓ 追加' + label + '成语 ' + newBlocks.length + ' 条（跳过已在库 ' + skipped + ' 条）：');
  Object.keys(byDyn).forEach(function (d) {
    console.log('    ' + d + '：' + byDyn[d].map(function (e) { return e[0]; }).join('、'));
  });
  console.log('\n下一步：node scripts/build-text-master.js → apply-text-master.js → build-works-map.js，再跑测试。');
}

module.exports = { append: append };
