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

const textOf = function (p) { return String((p && p.text) || ''); };
const sig = function (t) { return t.replace(/\s+/g, ''); };

const entries = [];
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
