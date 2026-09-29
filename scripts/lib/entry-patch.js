/* ==========================================================================
   正文主表的「按 id 定点改写」小工具
   --------------------------------------------------------------------------
   data/text-master.js 是生成文件（scripts/build-text-master.js 的产物），
   但它自己没有「改写某一条的正文」这一层 —— 上一轮的文学常识十三张表是
   在 scripts/changshi-tables.js 里自己写了一遍「找到 id 那一行、只换 text
   那一行」的代码。这一轮名著导读要改四百多条、历代名家要改六百多条，
   再抄一遍就成了三份各自维护的定位代码。

   所以抽到这里：给一张 { id: 新正文 } 的表，就地改写 text-master.js 的
   那一条条目。三条约束，缺一条就报错退出，不静默改错地方：

     · 找不到 id           → 报错（拼错了、或上一轮改了 id 号段）
     · 文件内容与读出的对象不一致 → 报错（说明该先重跑 build-text-master.js）
     · 条目已被上过表        → 按 --force 决定跳过还是重写

   ⚠️ 只动「该 id 的那一条」的 text 一行（以及可选的 translation 一行）。
      换行、缩进、条目的其余字段一个字不动 —— 生成的 diff 才看得清。
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const FILE = path.join(ROOT, 'data/text-master.js');

function load() {
  const sandbox = { window: {}, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox, { filename: 'data/text-master.js' });
  const MASTER = sandbox.TEXT_MASTER || [];
  const byId = {};
  MASTER.forEach(function (m) { if (m && m.id) byId[m.id] = m; });
  return { MASTER: MASTER, byId: byId };
}

/** 只替换某一个 id 那一条的 text（可选 translation）。 */
function apply(id, newText, opt) {
  const o = opt || {};
  const state = o.state || load();
  const m = state.byId[id];
  if (!m) throw new Error('主表里没有 ' + id);

  const marker = '    id: ' + JSON.stringify(id) + ',';
  const at = o.src.indexOf(marker);
  if (at < 0) throw new Error('文件里找不到 ' + id + ' 那一条');

  let out = o.src;
  const replaceField = function (field, value) {
    const from = out.indexOf('    ' + field + ': ', at);
    if (from < 0) throw new Error(id + ' 那一条没有 ' + field + ' 字段');
    const lineEnd = out.indexOf('\n', from);
    const oldLine = out.slice(from, lineEnd);
    const oldValue = JSON.parse(oldLine.slice(('    ' + field + ': ').length).replace(/,$/, ''));
    if (oldValue !== (m[field] || '')) {
      throw new Error(id + ' 的文件内容与读出的对象不一致，先重跑 scripts/build-text-master.js');
    }
    out = out.slice(0, from) + '    ' + field + ': ' + JSON.stringify(value) + ',' + out.slice(lineEnd);
    m[field] = value;
  };

  replaceField('text', newText);
  if (o.translation != null) replaceField('translation', o.translation);
  return out;
}

/**
 * 批量改写。patch 是 { id: 新正文 }，也可以给 { id: { text, translation } }。
 * 返回 { changed, skipped, src }。写盘由调用方决定（一般直接 write）。
 */
function applyAll(patch, opt) {
  const o = opt || {};
  const state = load();
  let src = fs.readFileSync(FILE, 'utf8');
  const changed = [];
  const skipped = [];
  const already = o.alreadyTable ? o.alreadyTable : function () { return false; };
  Object.keys(patch).forEach(function (id) {
    const v = patch[id];
    const text = typeof v === 'string' ? v : v.text;
    if (already(state.byId[id], id) && !o.force) { skipped.push(id); return; }
    src = apply(id, text, {
      state: state, src: src, force: o.force,
      translation: typeof v === 'string' ? null : v.translation
    });
    changed.push(id);
  });
  return { changed: changed, skipped: skipped, src: src };
}

function write(src) { fs.writeFileSync(FILE, src, 'utf8'); }


/* ==========================================================================
   新增条目（主表里还没有的那些）
   --------------------------------------------------------------------------
   applyAll 只管「改已有的」，新人（历代名家第四轮一次加五百余位）没有
   现成的条目可改 —— 需要「排到文件末尾、按同一套字段形状追加」。两个函数
   分开是刻意的：改正与新增是两件事，混在一起出错不好定位。

   字段顺序与生成文件一致：work / id / title / entries / text / translation /
   translationSource / version。version 由内容算出（与 build-text-master.js
   同一套 djb2 摘要），这样客户端能据它认出「这一条是新的」。
   ========================================================================== */
function versionOf(text, translation, src) {
  const raw = [text, translation || '', src || ''].join('\u0001');
  let h = 5381;
  for (let i = 0; i < raw.length; i += 1) h = ((h * 33) ^ raw.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function entryBlock(o) {
  const q = function (v) { return JSON.stringify(v == null ? '' : v); };
  return [
    '  {',
    '    work: ' + q(o.work || ('w-' + o.id)) + ',',
    '    id: ' + q(o.id) + ',',
    '    title: ' + q(o.title) + ',',
    '    entries: [' + JSON.stringify(o.id) + '],',
    '    text: ' + q(o.text) + ',',
    '    translation: ' + q(o.translation) + ',',
    '    translationSource: ' + q(o.translationSource) + ',',
    '    version: ' + q(versionOf(o.text, o.translation, o.translationSource)),
    '  },'
  ].join('\n');
}

/** 把一批新条目追加到主表末尾（只加主表里没有的 id）。 */
function insertAll(list, opt) {
  const o = opt || {};
  const state = load();
  let src = fs.readFileSync(FILE, 'utf8');
  const added = [];
  const exists = [];
  const blocks = [];
  list.forEach(function (it) {
    if (!it || !it.id) return;
    if (state.byId[it.id]) { exists.push(it.id); return; }
    blocks.push(entryBlock(it));
    added.push(it.id);
  });
  if (!blocks.length) return { added: added, exists: exists, src: src };
  // 主表数组的结尾从**第一行 `];`** 处找 —— 这个文件后面还有别的数组
  // （近重复对、站点索引那一段），用 lastIndexOf 会追加到别处去。
  const start = src.indexOf('window.TEXT_MASTER = [');
  if (start < 0) throw new Error('找不到 window.TEXT_MASTER = [ —— 文件形状变了，脚本要跟着改');
  const at = src.indexOf('\n];', start);
  if (at < 0) throw new Error('主表数组的结尾（第一处「\n];」）找不到 —— 文件形状变了');
  src = src.slice(0, at) + (src.charAt(at - 1) === ',' ? '' : ',') + '\n' +
    blocks.join('\n') + src.slice(at);
  return { added: added, exists: exists, src: src };
}

module.exports = { load: load, applyAll: applyAll, insertAll: insertAll, versionOf: versionOf, write: write, FILE: FILE, ROOT: ROOT };
