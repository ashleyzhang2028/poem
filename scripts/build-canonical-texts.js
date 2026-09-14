/**
 * 生成 data/canonical-texts.js（正文收归主表）
 * ==========================================================================
 * ⚠️ 存储层收归之后，这张表**通常是空的**（见下「与 text-master 的分工」）。
 *    它的机制仍在，留给「日后真出现异文」的那一天。
 *
 * 口径（Issue #69 收尾，用户原话「正文收归主表，以课本为主，去重」）：
 *
 *   · 课内与选集**同一篇作品**（正文去标点后一致）时，正文只留一份；
 *   · 那一份取**主条目**的正文 —— 主条目 = 课内条目（教材口径优先），
 *     没有对应课内条目的纯课外篇目取它自己；
 *   · 译文同样如此：古文观止与课内同篇时，用课内那一份译文
 *     （用户在同一句里的「以课本为主」，也是对译文的裁定 ——
 *      同一篇给学生读两段不同的白话，只会让人来问「到底哪个对」）；
 *   · 其余各集子（含课内自身）的正文就是主条目那一份，不必登记。
 *
 * 为什么落成一份静态数据而不是改各部数据文件：
 *   选本原貌该不该保留、教材文本该不该覆盖选本，是**主表的裁定**，
 *   不是某一部集子的语料。把它们混写进 data/poems-tangshi.js，
 *   日后重新生成那一部就会把裁定覆盖掉，而且「哪些条目被改过」再也看不出来。
 *   这一份单独列清：哪个条目、用的哪一篇的正文，一目了然，也便于回归。
 *
 * 什么时候要重跑：
 *   · 某一部增补 / 订正了篇目（正文变了，同篇关系就变）
 *   · data/works-index.js 的判重键（dedupKey）改了
 *
 * ## 与 data/text-master.js 的分工（存储层 vs 显示层）
 *
 *   这张表（canonical-texts.js）是**显示层**的裁定：各集子照旧各存一份正文，
 *   显示时才替成主条目那一份。它解决了「学生读到两种写法」，
 *   但没解决「同一篇正文在磁盘上存了五份」。
 *
 *   正文收归主表的**存储层**（data/text-master.js）做完之后，
 *   同一篇的正文本来就只剩一份、各集子条目只存归属（textRef）——
 *   两种写法不复存在，这一张显示层裁定表也就**自然收敛为空表**。
 *   （跑一次本脚本，若输出「0 条」即说明语料里已无绕开主表的异文。）
 *
 *   一旦这张表又非空，说明有某部语料没走主表、自己又存了一份正文 ——
 *   那正是该去查的地方，而不是补进这张表里盖住。
 *
 * 用法：node scripts/build-canonical-texts.js
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

/** 正文是否逐字相同（只忽略空白与换行 —— 断行方式不属于文本差异） */
const textOf = function (p) { return String((p && p.text) || ''); };
const sig = function (t) { return t.replace(/\s+/g, ''); };

const entries = [];   // { id, of, text, translation } —— 只登记「用别人的正文」的条目
GI: for (var i = 0; i < WI.works.length; i++) {
  var w = WI.works[i];
  if (w.entries.length < 2) continue;
  var rep = WI.repOf(w.entries[0]);
  var repEntry = byId[rep];
  if (!repEntry) continue;
  for (var j = 0; j < w.entries.length; j++) {
    var id = w.entries[j];
    if (id === rep) continue;
    var p = byId[id];
    if (!p) continue;
    var needText = sig(textOf(p)) !== sig(textOf(repEntry));
    var needTrans = p.translation && repEntry.translation &&
      sig(p.translation) !== sig(repEntry.translation);
    if (!needText && !needTrans) continue;
    entries.push({
      id: id,
      // of 记**集子内 id**（去掉集子前缀）：两类页面都要能命中 ——
      //   · 集子页里的条目 id 不带前缀（`gw-60`）；
      //   · 首页 / 搜索页里的条目 id 带前缀（`classic-gw-60`，站点索引口径）。
      // id 这一栏仍按站点索引口径（与 data/works-map.js 一致），
      // 引擎查表时两种键都认（见 js/reader-core.js 的 canonicalRuleFor）。
      of: rep.replace(/^[a-z]+-/, ''),
      ofEntry: rep,
      text: needText,
      translation: !!needTrans
    });
  }
}

entries.sort(function (a, b) { return a.id < b.id ? -1 : 1; });

const divergent = entries.filter(function (e) { return e.text; });
const transOnly = entries.filter(function (e) { return !e.text; });

let out = '';
out += '/* ==========================================================================\n';
out += '   正文收归主表（主表裁定规则的静态成果）\n';
out += '   --------------------------------------------------------------------------\n';
out += '   由 scripts/build-canonical-texts.js 离线算出。\n';
out += '\n';
out += '   ⚠️ 这是**生成文件**，改动请改 scripts/build-canonical-texts.js 后重跑，\n';
out += '      不要手改这里 —— 下次重新生成会把手工改动覆盖掉。\n';
out += '\n';
out += '   ## 它解决什么\n';
out += '\n';
out += '   同一篇作品在几部集子里各存一份正文时（《桃花源记》课内八年级下 +\n';
out += '   古文观止卷六、《登高》课内高一上 + 唐诗卷五……），两份的断行、标点\n';
out += '   甚至个别字会不一样。学生背的是课本上那一篇，读到另一部里同一篇时\n';
out += '   却看到另一种写法，只会来问「到底哪个对」。\n';
out += '\n';
out += '   裁定一句话：**课内以教材为准，正文只留一份 —— 用主条目（课内条目）那一份**；\n';
out += '   译文同理（同一篇给学生读两段不同的白话，是同一个问题）。\n';
out += '\n';
out += '   ## 与 data/works-map.js 的分工\n';
out += '\n';
out += '     works-map.js        哪些条目是**同一篇作品**（判重、搜索去重、排程合流）\n';
out += '     canonical-texts.js  同一篇作品**用哪一份正文**（本文件）\n';
out += '   两张表都由同一套口径算出，一起重跑。\n';
out += '\n';
out += '   ## 字段\n';
out += '\n';
out += '     id           站点条目 id（与 data/site-index.js 同口径，带集子前缀）\n';
out += '     of           取哪一条的正文，记的是**集子内 id**（`gw-60` / `cz8-14`）——\n';
out += '                  集子页里的条目 id 本来就不带前缀，这样两类页面都能命中\n';
out += '     ofEntry      同一条的站点索引 id（`classic-gw-60` / `poems-cz8-02`），供核对\n';
out += '     text         true = 正文改用主条目那一份\n';
out += '     translation  true = 译文改用主条目那一份（见 js/reader-core.js 的\n';
out += '                  canonicalTextOf —— 正文与译文各自判、各自换）\n';
out += '\n';
out += '   本表共 ' + entries.length + ' 条：正文有出入的 ' + divergent.length +
  ' 条、只有译文不同的 ' + transOnly.length + ' 条。\n';
out += '   正文逐字相同的那些重复条目**不必登记** —— 用谁的都一样，\n';
out += '   登记进来只会让表变长，却说明不了任何事。\n';
out += '   ========================================================================== */\n';
out += 'window.CANONICAL_TEXTS = [\n';
entries.forEach(function (e, i) {
  out += '  { id: ' + JSON.stringify(e.id) + ', of: ' + JSON.stringify(e.of) +
    ', ofEntry: ' + JSON.stringify(e.ofEntry) +
    ', text: ' + e.text + ', translation: ' + e.translation + ' }' +
    (i < entries.length - 1 ? ',' : '') + '\n';
});
out += '];\n';

const target = path.join(ROOT, 'data/canonical-texts.js');
const prev = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
fs.writeFileSync(target, out);
console.log('data/canonical-texts.js: ' + entries.length + ' 条（正文 ' + divergent.length +
  ' / 仅译文 ' + transOnly.length + '）' + (prev === out ? '（内容无变化）' : '（已更新）'));
