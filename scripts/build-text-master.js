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
 *   只登记「在两部及以上集子里重复出现」的作品（与 data/works-map.js 同口径）。
 *   单条的作品不必登记 —— 它本来就只存一份，条目自己就是主条目。
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

const WI = sandbox.WorksIndex;
const byId = {};
sandbox.SITE_INDEX.forEach(function (p) { byId[p.id] = p; });

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
