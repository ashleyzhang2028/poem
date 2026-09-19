const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const LOAD = [
  'data/text-master.js',
  'data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js',
  'data/poems-5.js', 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js',
  'data/poems-9.js', 'data/poems-10.js', 'data/poems-11.js', 'data/poems-12.js',
  'data/index.js', 'data/poems-classic.js', 'data/poems-tangshi.js',
  'data/poems-songci.js', 'data/poems-guwen.js', 'data/poems-zhaoming.js', 'data/poems-yuanqu.js',
  'data/site-index.js', 'data/works-map.js', 'data/works-index.js'
];

const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
LOAD.forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
});

const byId = {};
sandbox.SITE_INDEX.forEach(function (p) { byId[p.id] = p; });
const WI = sandbox.WorksIndex;

const FULL_BOOKS = ['zhaoming', 'guwen', 'songci', 'tangshi', 'classic', 'yuanqu'];

const prev = {};
try {
  const prevSandbox = { window: {}, console };
  prevSandbox.window = prevSandbox;
  vm.createContext(prevSandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'data/text-master.js'), 'utf8'),
    prevSandbox, { filename: 'data/text-master.js' });
  (prevSandbox.TEXT_MASTER || []).forEach(function (m) { if (m && m.id) prev[m.id] = m; });
} catch (e) {  }

function textOfEntry(entry, masterId) {
  if (entry && (entry.text || entry.translation)) {
    return { text: entry.text || "", translation: entry.translation || "",
      translationSource: entry.translationSource || "" };
  }
  const old = prev[masterId] || prev[entry && entry.id];
  if (old) {
    return { text: old.text || "", translation: old.translation || "",
      translationSource: old.translationSource || "" };
  }
  return { text: "", translation: "", translationSource: "" };
}

const sig = function (t) { return String(t || '').replace(/\s+/g, ''); };

const master = [];
WI.works.forEach(function (w) {
  if (w.entries.length < 2) return;
  const rep = WI.repOf(w.entries[0]);
  const repEntry = byId[rep];
  if (!repEntry) return;
  const t = textOfEntry(repEntry, rep);
  master.push({
    work: w.wid,
    id: rep,
    title: repEntry.title,
    entries: w.entries.slice(),
    text: t.text,
    translation: t.translation,
    translationSource: t.translationSource
  });
});
master.sort(function (a, b) { return a.id < b.id ? -1 : 1; });

const seen = {};
master.forEach(function (m) { (m.entries || []).forEach(function (e) { seen[e] = true; }); });

const fullBooksReport = [];
const FULL_BOOK_SET = {};
FULL_BOOKS.forEach(function (b) { FULL_BOOK_SET[b] = true; });

sandbox.SITE_INDEX.forEach(function (p) {
  if (!p || p.isBook || !p.id) return;

  if (!FULL_BOOK_SET[p.book]) return;
  if (seen[p.id]) return;
  if (!p.text && !p.translation) return;
  const t = textOfEntry(p, p.id);
  master.push({
    work: 'w-' + p.id,
    id: p.id,
    title: p.title,
    entries: [p.id],
    text: t.text,
    translation: t.translation,
    translationSource: t.translationSource
  });
  seen[p.id] = true;
  const rec = fullBooksReport.filter(function (r) { return r.book === p.book; })[0];
  if (rec) rec.n += 1;
  else fullBooksReport.push({ book: p.book, n: 1 });
});
master.sort(function (a, b) { return a.id < b.id ? -1 : 1; });

const notInMaster = [];
sandbox.SITE_INDEX.forEach(function (p) {
  if (!p || p.isBook || !p.id) return;
  if (!FULL_BOOK_SET[p.book]) return;
  if (!p.text && !p.translation) return;
  if (seen[p.id]) return;
  notInMaster.push(p.id + '（' + (p.book || '?') + '）');
});
if (notInMaster.length) {
  console.error('✗ 清单点名的部里有 ' + notInMaster.length + ' 条「有正文」的条目没有进主表：' +
    notInMaster.slice(0, 8).join('、'));
  console.error('  多半是忘了重跑本脚本，或那一条的 textRef / id 拼错了。');
  process.exit(1);
}

const BOOK_FILES = [
  'data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js',
  'data/poems-5.js', 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js',
  'data/poems-9.js', 'data/poems-10.js', 'data/poems-11.js', 'data/poems-12.js',
  'data/poems-classic.js', 'data/poems-tangshi.js', 'data/poems-songci.js',
  'data/poems-guwen.js', 'data/poems-zhaoming.js', 'data/poems-yuanqu.js'
];

void fullBooksReport;

const inlineCopies = [];
BOOK_FILES.forEach(function (f) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');

  src.split(/\n(?=\s*\{)/).forEach(function (blk) {
    const refM = blk.match(/textRef:\s*"([^"]+)"/);
    if (!refM) return;
    const idM = blk.match(/\bid:\s*"([^"]+)"/);
    if (!idM) return;
    if (/^\s+text:\s*"/m.test(blk) || /^\s+translation:\s*"/m.test(blk)) {
      inlineCopies.push(f + ' · ' + idM[1]);
    }
  });
});

// 一次收归要跑两步：本脚本把正文收进主表 → apply-text-master.js 摘掉内联副本。
// 所以「在册、本轮才收上来的条目」此刻**还带着**内联正文，是预期之中；
// 只有「上一版主表里已经收过、这一次却还内联着」的才是真的存了两份。
const stale = inlineCopies.filter(function (x) {
  const id = x.split(' · ')[1];
  const file = x.split(' · ')[0];
  const prefix = file.replace('data/poems-', '').replace('.js', '');
  return prev[prefix + '-' + id] || prev[id];
});
if (stale.length) {
  console.error('✗ 有 ' + stale.length + ' 条条目一边带着 textRef、一边还内联着正文：');
  stale.slice(0, 8).forEach(function (x) { console.error('    ' + x); });
  console.error('  这是「同一篇正文在磁盘上存了两份」—— 跑 scripts/apply-text-master.js 摘掉。');
  process.exit(1);
}
if (inlineCopies.length) {
  console.log('（' + inlineCopies.length + ' 条本轮新收的条目：正文收进主表后由 ' +
    'scripts/apply-text-master.js 摘去内联副本）');
}

const NEAR_BY_KEY = {};

const VARIANT = [
  ["惟", "唯"], ["霪", "淫"], ["蘋", "苹"], ["翦", "剪"], ["皇", "凰"],
  ["懃", "勤"], ["絜", "洁"], ["岀", "出"], ["閒", "闲"], ["彊", "强"]
];
function loose(t) {
  let s = String(t || '').replace(/\s+/g, '');
  VARIANT.forEach(function (p) { s = s.split(p[0]).join(p[1]); });
  return s;
}

sandbox.SITE_INDEX.forEach(function (p) {
  if (!p || p.isBook || !p.text || !p.id) return;
  const k = loose(p.text);
  if (!k) return;
  if (!NEAR_BY_KEY[k]) NEAR_BY_KEY[k] = [];
  NEAR_BY_KEY[k].push(p.id);
});
const nearPairs = [];
Object.keys(NEAR_BY_KEY).forEach(function (k) {
  const ids = NEAR_BY_KEY[k];

  const loose2strict = {};
  ids.forEach(function (id) {
    const strict = sig(byId[id].text);
    (loose2strict[strict] = loose2strict[strict] || []).push(id);
  });
  const variants = Object.keys(loose2strict);
  if (variants.length < 2) return;
  nearPairs.push({
    entries: ids.slice(),

    reason: variants.length === 1
      ? "正文在标点 / 断行上不同，字面相同"
      : "一字之差的两条文本传统（选本原貌 vs 教材 / 通行字），并列而不合并"
  });
});
nearPairs.sort(function (a, b) { return a.entries[0] < b.entries[0] ? -1 : 1; });

// 课内条目里也有「与集子同篇」的那些（《天净沙·秋思》课内 + 元曲、
// 《山坡羊·骊山怀古》课内 + 元曲……）。上面那两轮按「跨集重复」已经收过；
// 剩下的就是**课内独有**的条目 —— 它们不进主表（主表的边界是
// 「同一篇落一份」，课内独苗本来就只有一份，由自己的数据文件持有）。
// 所以这里只查一件事：同一条条目**不许**既被主表收着、又还内联着正文。
const dupInline = [];
master.forEach(function (m) {
  (m.entries || []).forEach(function (eid) {
    if (m.id === eid) return;
    const book = eid.split('-')[0];
    const files = book === 'poems'
      ? ['data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js',
         'data/poems-5.js', 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js',
         'data/poems-9.js', 'data/poems-10.js', 'data/poems-11.js', 'data/poems-12.js']
      : ['data/poems-' + book + '.js'];
    const localId = eid.slice(book.length + 1);
    files.forEach(function (f) {
      if (!fs.existsSync(path.join(ROOT, f))) return;
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      const hit = src.split(/\n(?=\s*\{)/).filter(function (blk) {
        return new RegExp('id:\\s*"' + localId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"').test(blk) &&
          /^\s+text:\s*"/m.test(blk);
      })[0];
      if (hit) dupInline.push(eid + '（与主表 ' + m.id + ' 同时带正文）');
    });
  });
});
// ⚠️ 这一条**不拦**：它报的正是「主表刚收上来、副本还没摘」的那个中间态
// （一次收归 = build-text-master 收 + apply-text-master 摘，两步）。
// 谁要是只跑了前一步就提交，测试层的 canonical.test.js 会拦下来 ——
// 那里查的是「磁盘上还剩几份」，比这里更准。
if (dupInline.length) {
  console.log('（' + dupInline.length + ' 条条目与主表那一份同时带着正文 —— ' +
    '本轮刚收上来的，接着跑 scripts/apply-text-master.js 摘去内联副本）');
}

const empty = master.filter(function (m) { return !m.text; });
if (empty.length) {
  console.error('✗ 有 ' + empty.length + ' 条主表条目的正文为空：' +
    empty.map(function (m) { return m.id; }).join('、'));
  console.error('  多半是先跑了 apply-text-master.js（已摘内联正文）又重跑本脚本，');
  console.error('  而 data/text-master.js 已被清空 —— 先从 git 取回旧表再来。');
  process.exit(1);
}

const BT = '`';
let out = '';
out += '/* ==========================================================================\n';
out += '   正文存储主表（同一篇作品的正文 / 译文只落一份）\n';
out += '   --------------------------------------------------------------------------\n';
out += '   由 scripts/build-text-master.js 离线算出，共 ' + master.length + ' 条。\n';
out += '\n';
out += '   ⚠️ 这是**生成文件**，改动请改 scripts/build-text-master.js 后重跑，\n';
out += '      不要手改这里 —— 下次重新生成会把手工改动覆盖掉。\n';
out += '\n';
out += '   ## 它解决什么\n';
out += '   同一篇作品（《答谢中书书》课内八年级上 + 小古文、《登高》课内高一上 +\n';
out += '   唐诗卷五……）此前在每一部集子的数据文件里**各存一份完整正文与译文**。\n';
out += '   显示层虽已按 data/canonical-texts.js 统一成「课本那一份」，\n';
out += '   但磁盘上仍是五份副本：改一处要改五处，漏一处就又不一致。\n';
out += '\n';
out += '   这一份把这份文本收归**一处**；其余集子的条目退化成只存归属 ——\n';
out += '   条目上留 ' + BT + 'textRef: "<主条目站点 id>"' + BT + '，正文与译文\n';
out += '   由引擎（js/reader-core.js）按 ' + BT + 'textRef' + BT + ' 到这里取。\n';
out += '\n';
out += '   ## 收归范围（已收齐）\n';
out += '     ① 「在两部及以上集子里重复出现」的作品 —— 判重表自动收；\n';
out += '     ② FULL_BOOKS 点名的六部集子里**其余全部单篇**（历史声明，\n';
out += '        六部收齐后本表已按「凡在册且带正文的条目一律全收」执行）。\n';
out += '   于是：在册却还带内联正文的条目即为异常（同一个脚本里两处断言会点名）。\n';
out += '\n';
out += '   ## 与另外两张表的分工\n';
out += '     data/works-map.js        哪些条目是**同一篇作品**（判重、搜索去重、排程合流）\n';
out += '     data/canonical-texts.js  显示层：同一篇**显示**用哪一份正文（收归之后已收敛为空表，\n';
out += '                              机制留着给日后真出现异文时用）\n';
out += '     data/text-master.js      存储层：同一篇的正文 / 译文**只落一份**（本文件）\n';
out += '   三张表由同一套口径算出（课内条目为主条目），一起重跑。\n';
out += '\n';
out += '   ## 字段\n';
out += '     work        作品 id（与 data/works-map.js 的 wid 一致）\n';
out += '     id          主条目站点索引 id（' + BT + 'poems-cz8-02' + BT + '，课内优先）\n';
out += '     title       主条目题名\n';
out += '     entries     这一篇的全部站点条目 id（含主条目自己）\n';
out += '     text        正文（**全站唯一一份**）\n';
out += '     translation 白话译文\n';
out += '     translationSource 译文来源\n';
out += '   ========================================================================== */\n';
out += 'window.TEXT_MASTER = [\n';
master.forEach(function (m) {
  out += '  {\n';
  out += '    work: ' + JSON.stringify(m.work) + ',\n';
  out += '    id: ' + JSON.stringify(m.id) + ',\n';
  out += '    title: ' + JSON.stringify(m.title) + ',\n';
  out += '    entries: [' + m.entries.map(function (e) { return JSON.stringify(e); }).join(', ') + '],\n';
  out += '    text: ' + JSON.stringify(m.text) + ',\n';
  out += '    translation: ' + JSON.stringify(m.translation) + ',\n';
  out += '    translationSource: ' + JSON.stringify(m.translationSource) + '\n';
  out += '  },\n';
});
out += '];\n';
out += '\n';
out += '/* ==========================================================================\n';
out += '   近重复对：同一篇却有两种写法，**故意不合并**\n';
out += '   --------------------------------------------------------------------------\n';
out += '   下面是「差不多是同一篇、但正文有一字之差」的那些对，共 ' + nearPairs.length + ' 组。\n';
out += '   它们**没有**被收进上面的主表 —— 因为一字之差往往不是录入出错，\n';
out += '   而是两条并列的文本传统：\n';
out += '\n';
out += '     · 选本原貌（《文选》作「凤皇」、《古文观止》作「霪雨」）\n';
out += '     · 教材 / 通行字（课本作「凤凰」，今通行本作「淫雨」）\n';
out += '\n';
out += '   裁定见 data/works-index.js：「课内以教材文本为准，选集以选本原貌为准，\n';
out += '   冲突时分成两条并列的作品，各背各的」—— 所以这里**只登记事实**，\n';
out += '   不去合并、也不改任何一份正文。主表收归的是「字面完全相同」的那些篇；\n';
out += '   这一份清单是它的边界：谁要是把这几篇也并了，学生就会读到\n';
out += '   与自己课本不一样的那一份《岳阳楼记》。\n';
out += '\n';
out += '   ⚠️ 这是**生成文件**，改动请改 scripts/build-text-master.js 后重跑。\n';
out += '\n';
out += '   字段：entries 两条（及以上）条目 id；reason 为什么它们「像同一篇而不合并」\n';
out += '   ========================================================================== */\n';
out += 'window.TEXT_NEAR_DUP = [\n';
nearPairs.forEach(function (p) {
  out += '  {\n';
  out += '    entries: [' + p.entries.map(function (e) { return JSON.stringify(e); }).join(', ') + '],\n';
  out += '    reason: ' + JSON.stringify(p.reason) + '\n';
  out += '  },\n';
});
out += '];\n';
out += '\n';
out += '/* ==========================================================================\n';
out += '   取数入口：把条目上的 textRef 展开成正文 / 译文\n';
out += '   --------------------------------------------------------------------------\n';
out += '   摘掉内联正文的条目只留一行 textRef，正文从这里取回。\n';
out += '   各消费方（站点索引、阅读引擎、搜索页……）都调这一个函数 ——\n';
out += '   各写一份迟早有一处忘了取，而表现只是「那一处正文空白」，不报错。\n';
out += '\n';
out += '   ⚠️ 没有 textRef、或主表里查不到时**原样返回**，不做任何猜测：\n';
out += '      猜出来的正文比空白更糟 —— 空白一眼可见，取错一篇却看着正常。\n';
out += '   ========================================================================== */\n';
out += '(function () {\n';
out += '  "use strict";\n';
out += '\n';
out += '  var byId = null;\n';
out += '  function map() {\n';
out += '    if (byId) return byId;\n';
out += '    byId = {};\n';
out += '    (window.TEXT_MASTER || []).forEach(function (m) {\n';
out += '      if (!m) return;\n';
out += '      if (m.id) byId[m.id] = m;\n';
out += '      (m.entries || []).forEach(function (e) { if (e && !byId[e]) byId[e] = m; });\n';
out += '    });\n';
out += '    return byId;\n';
out += '  }\n';
out += '\n';
out += '  /**\n';
out += '   * 取这一条的正文 / 译文。\n';
out += '   * @param {Object} p      条目（可能带 textRef）\n';
out += '   * @param {String} [book] 所属集子 id —— textRef 记的是集子内 id 时补前缀再查\n';
out += '   * @returns {Object} 展开后的条目（无 textRef 或查不到时原样返回）\n';
out += '   */\n';
out += '  window.masterTextOf = function (p, book) {\n';
out += '    if (!p || !p.textRef || p.text) return p;\n';
out += '    var m = map()[p.textRef];\n';
out += '    if (!m && book) m = map()[book + "-" + p.textRef];\n';
out += '    if (!m) return p;\n';
out += '    var out = {};\n';
out += '    Object.keys(p).forEach(function (k) { if (k !== "text" && k !== "translation" && k !== "translationSource") out[k] = p[k]; });\n';
out += '    out.text = m.text || "";\n';
out += '    out.translation = m.translation || "";\n';
out += '    out.translationSource = m.translationSource || p.translationSource;\n';
out += '    return out;\n';
out += '  };\n';
out += '})();\n';
out += '\n';

fs.writeFileSync(path.join(ROOT, 'data/text-master.js'), out, 'utf8');
console.log('✓ data/text-master.js 已生成，共 ' + master.length + ' 条');
