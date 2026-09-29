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

module.exports = { load: load, applyAll: applyAll, write: write, FILE: FILE, ROOT: ROOT };
