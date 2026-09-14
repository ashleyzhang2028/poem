/**
 * 生成 data/text-master.js（正文存储主表）
 * ==========================================================================
 * 口径（Issue #69 收尾）：**同一篇作品的正文与译文在存储层只留一份**。
 *
 * 为什么还要一张「存储主表」（与 data/canonical-texts.js 什么关系）：
 *   · data/canonical-texts.js 是**显示层**的裁定 —— 各集子照旧各存一份正文，
 *     显示时才替成主条目那一份。它解决了「学生读到两种写法」，
 *     但没解决「同一篇正文在磁盘上存了五份」。
 *   · 这一份是**存储层**的主表 —— 同一篇作品的正文 / 译文只落一份，
 *     其余集子的条目退化成**只存归属**（`textRef` 指向主条目），
 *     正文由引擎按 `textRef` 取。两份表口径一致（都以课内条目为主条目），
 *     一起重跑。
 *
 * ## 谁进主表
 *   两类：
 *     ① 「在两部及以上集子里重复出现」的作品 —— 自动收（与 data/works-map.js 同口径）；
 *     ② **FULL_BOOKS 点名的部**里其余全部单篇 —— 按部推进，一部一个 PR。
 *   清单没点名的部，单篇正文照旧内联在自己的数据文件里（两种形态并存，
 *   所以每部都能单独落地、单独回退）。
 *
 * ## 主条目取谁的正文
 *   与 data/canonical-texts.js 完全一致：**课内条目优先**（教材口径），
 *   没有课内条目的纯课外篇目取它自己。
 *
 * ## 各集子怎么「退化成只存归属」
 *   本脚本只产出主表；条目的 `textRef` 与内联正文的剥离由
 *   `scripts/apply-text-master.js` 完成（分离成两步：先算表、再改语料，
 *   diff 看得清，也便于回滚）。
 *
 * 什么时候要重跑：
 *   · 某一部集子增补 / 订正了篇目（同篇关系变了）
 *   · data/works-index.js 的判重键（dedupKey）改了
 * 用法：node scripts/build-text-master.js
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// ⚠️ data/text-master.js 排最前：各集子条目只存归属（textRef），
//    正文要按它取回 —— 判重（去标点比正文）没有正文就判不出任何一组。
const LOAD = [
  'data/text-master.js',
  'data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js',
  'data/poems-5.js', 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js',
  'data/poems-9.js', 'data/poems-10.js', 'data/poems-11.js', 'data/poems-12.js',
  'data/index.js', 'data/poems-classic.js', 'data/poems-tangshi.js',
  'data/poems-songci.js', 'data/poems-guwen.js', 'data/poems-zhaoming.js',
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

/* ---------------- 已全量收归主表的「部」 ---------------- */
/* 「跨集重复」的那 60 篇由判重表自动收归；各集子的**单篇**正文默认仍内联在
   自己的数据文件里。这里点名的是「本轮起全量收归」的部 —— 点名一部，
   它**全部**条目的正文 / 译文就都进主表，条目退化成只留 textRef。

   为什么用点名的清单、而不是「所有部一律收归」：
     · 一部一个 PR，落地一部、可回退一部。清单上没点名的部照旧内联，
       两种形态并存 —— 收归中的集子不必等其余几部一起改完才敢合。
     · 反过来，这也是给测试的**权威口径**：主表里「多出来的」条目必须恰好
       来自这里点名的部；哪一部漏收了，也照这一份清单核。

   收谁由这里说了算，部内条目数不必改脚本。下一部要收归时，
   在这里加一个集子 id（并在 apply-text-master.js 已支持的 BOOKS 里存在）。 */
const FULL_BOOKS = ['zhaoming'];

/* 已有的主表：改语料重跑时的**正文兜底**。
   ⚠️ 各集子条目在「收归」之后已摘掉内联正文（只留 textRef），
      若此时重跑本脚本而不带上旧主表，算出来的主表会是一片空文 ——
      「主表是空的」这种错不会报错，只会让全站那一批篇目正文空白，
      正是最难查的一种。所以：内联正文没了就取旧主表那一份。 */
const prev = {};
try {
  const prevSandbox = { window: {}, console };
  prevSandbox.window = prevSandbox;
  vm.createContext(prevSandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'data/text-master.js'), 'utf8'),
    prevSandbox, { filename: 'data/text-master.js' });
  (prevSandbox.TEXT_MASTER || []).forEach(function (m) { if (m && m.id) prev[m.id] = m; });
} catch (e) { /* 首次生成：还没有旧表，正常 */ }

/**
 * 取这一条要收进主表的正文 / 译文。
 * 优先用条目内联的那一份；内联已被摘掉（只留 textRef）时，
 * 从旧主表里取 —— 取不到就返回空，由下面的断言拦下，不静默产出空文。
 */
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

/** 正文是否逐字相同（只忽略空白与换行 —— 断行方式不属于文本差异） */
const sig = function (t) { return String(t || '').replace(/\s+/g, ''); };

/**
 * 一张主表：文本只落一份。
 * key 为**主条目的站点索引 id**（课内条目优先），也即 data/canonical-texts.js
 * 的 ofEntry 口径；value 是正文 / 译文，另记 `work` 与 `entries`
 * （这一份文本服务了哪些条目，供核对与测试）。
 */
const master = [];
WI.works.forEach(function (w) {
  if (w.entries.length < 2) return;
  const rep = WI.repOf(w.entries[0]);
  const repEntry = byId[rep];
  if (!repEntry) return;
  const t = textOfEntry(repEntry, rep);
  master.push({
    work: w.wid,
    id: rep,                       // 主条目（课内优先）
    title: repEntry.title,
    entries: w.entries.slice(),    // 收录这一篇的全部条目（含主条目自己）
    text: t.text,
    translation: t.translation,
    translationSource: t.translationSource
  });
});
master.sort(function (a, b) { return a.id < b.id ? -1 : 1; });

/* ---------------- 全量收归的部：单篇也进主表 ----------------
   上面那一段只收「两部及以上重复出现」的作品（判重表里成组的）。
   这一段把 FULL_BOOKS 点名的部里**其余全部单篇**也收进主表 ——
   它们的「作品」就是它自己（只有一条条目），主条目也取它自己。

   已经收过的（跨集重复的那些条目）在 `seen` 里，跳过：
   同一条目不得在主表里出现两次（否则 map()[textRef] 谁赢谁输没有定义）。 */
const seen = {};
master.forEach(function (m) { (m.entries || []).forEach(function (e) { seen[e] = true; }); });

const fullBooksReport = [];
FULL_BOOKS.forEach(function (book) {
  const prefix = book + '-';
  let n = 0;
  /* 按站点索引顺序过一遍 —— 顺序稳定，重跑 diff 才不会抖 */
  sandbox.SITE_INDEX.forEach(function (p) {
    if (!p || p.isBook || p.book !== book || !p.id || p.id.indexOf(prefix) !== 0) return;
    if (seen[p.id]) return;
    if (!p.text && !p.translation) return;   // 空条目（待补）不进主表
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
    n += 1;
  });
  fullBooksReport.push('  ' + book + '  ' + n + ' 条');
});
master.sort(function (a, b) { return a.id < b.id ? -1 : 1; });

/* 断言：全量收归的部里，每个条目都必须进主表（漏一条就是正文空白）。
   只查「有正文的条目」—— 待补条目本来就没有正文，不进主表是对的。 */
FULL_BOOKS.forEach(function (book) {
  const missing = [];
  sandbox.SITE_INDEX.forEach(function (p) {
    if (!p || p.isBook || p.book !== book || !p.id) return;
    if (!p.text && !p.translation) return;
    if (!seen[p.id]) missing.push(p.id);
  });
  if (missing.length) {
    console.error('✗ 「' + book + '」有 ' + missing.length + ' 条条目没有进主表：' +
      missing.slice(0, 8).join('、'));
    process.exit(1);
  }
});

/* ---------------- 近重复对：同篇但字有出入，**故意不合并** ----------------
   判重键是「正文去标点后逐字相同」。可文献里常见的是一字之差的两种文本：

     《将进酒》  课内「但愿长醉不愿醒」 vs 唐诗「但愿长醉不复醒」      一字
     《岳阳楼记》古文观止「霪雨霏霏」   vs 课内「淫雨霏霏」（课本通行字） 一字
     《天香》    宋词「剪春灯」         vs 宋词「翦春灯」（籀文正体）    一字
     《北山移文》古文观止「比洁」       vs 昭明「比絜」（选本用本字）      一字
     《宋玉对楚王问》古文观止「凤凰」   vs 昭明「凤皇」（《文选》作皇）    一字

   这些**不是录入出错**，是两条并列的文本传统（选本原貌 vs 教材 / 通行字），
   见 data/works-index.js 的裁定：「课内以教材文本为准，选集以选本原貌为准，
   冲突时分成两条并列的作品，各背各的」。所以主表**不去合并它们** ——
   合并就是把一种写法盖在另一种上，谁对谁错没人能裁。

   那为什么还要在这张**存储**主表里列出这一份清单：因为它们正是「同一篇
   却存了两份正文」的残余。哪些是真异文、哪些本就是两篇，必须逐条写下来、
   由测试逐条守着 —— 否则日后有人看见「差不多的两篇」，顺手一合并，
   又回到「学生读到两种《岳阳楼记》」的老问题上。

   ⚠️ 这一节**只登记事实**，不产出文本、不参与 textRef 的落位。 */
const NEAR_BY_KEY = {};
/* 判重再走一步：把常见异体字**归一后**若逐字相同，那就是一篇的两个版本 */
const VARIANT = [
  ["惟", "唯"], ["霪", "淫"], ["蘋", "苹"], ["翦", "剪"], ["皇", "凰"],
  ["懃", "勤"], ["絜", "洁"], ["岀", "出"], ["閒", "闲"], ["彊", "强"]
];
function loose(t) {
  let s = String(t || '').replace(/\s+/g, '');
  VARIANT.forEach(function (p) { s = s.split(p[0]).join(p[1]); });
  return s;
}
/* 从**全站**扫描、而不是只扫作品表里的那 57 组：像《岳阳楼记》那样
   「课内 + 古文观止」的一字之差，在判重表里根本没成组 —— 正因为没成组，
   才要用归一后的写法把它们翻出来（扫作品表就恰好漏掉这一批）。

   只算正文，不比对译文：译文各家各写，比对不上是常态、说明不了任何事。 */
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
  /* 只剩一条的说明这一组已经严格同文（前面 master 里收过），不是异文对 */
  const loose2strict = {};
  ids.forEach(function (id) {
    const strict = sig(byId[id].text);
    (loose2strict[strict] = loose2strict[strict] || []).push(id);
  });
  const variants = Object.keys(loose2strict);
  if (variants.length < 2) return;
  nearPairs.push({
    entries: ids.slice(),
    /* 只有正文逐字相同的那些才轮得到主表收归；字面有出入的归上面那一节守 */
    reason: variants.length === 1
      ? "正文在标点 / 断行上不同，字面相同"
      : "一字之差的两条文本传统（选本原貌 vs 教材 / 通行字），并列而不合并"
  });
});
nearPairs.sort(function (a, b) { return a.entries[0] < b.entries[0] ? -1 : 1; });

/* 断言：主表是「唯一一份正文」，算出空文就是致命的 —— 宁可中断也不产出空表。
   （重跑顺序错（先摘后算）会让这里亮红，比全站正文空白之后再回查便宜得多。） */
const empty = master.filter(function (m) { return !m.text; });
if (empty.length) {
  console.error('✗ 有 ' + empty.length + ' 条主表条目的正文为空：' +
    empty.map(function (m) { return m.id; }).join('、'));
  console.error('  多半是先跑了 apply-text-master.js（已摘内联正文）又重跑本脚本，');
  console.error('  而 data/text-master.js 已被清空 —— 先从 git 取回旧表再来。');
  process.exit(1);
}

/* ---------------- 产出 ---------------- */
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
out += '   ## 收归范围（按部推进）\n';
out += '     ① 「在两部及以上集子里重复出现」的作品 —— 判重表自动收；\n';
out += '     ② FULL_BOOKS 点名的部里其余全部单篇（本轮：' + FULL_BOOKS.join('、') + '）。\n';
out += '   清单没点名的部，单篇正文照旧内联在自己的数据文件里。\n';
out += '\n';
out += '   ## 与另外两张表的分工\n';
out += '     data/works-map.js        哪些条目是**同一篇作品**（判重、搜索去重、排程合流）\n';
out += '     data/canonical-texts.js  显示层：同一篇**显示**用哪一份正文（本轮起多数条目改走\n';
out += '                              本表，这张显示裁定表只留「仍有内联副本」的条目兜底）\n';
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
out += '    (window.TEXT_MASTER || []).forEach(function (m) { if (m && m.id) byId[m.id] = m; });\n';
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
