/**
 * 测试用：正文存储主表的取数helper（Issue #69 收尾）
 * ==========================================================================
 * 各集子的数据文件里，被主表收编的条目**已摘掉内联正文**、只留 textRef
 * （见 data/text-master.js 文件头）。测试在「纯 vm 数据层」直接读
 * `window.POEMS_TANGSHI` 这类变量时，拿到的是没正文的条目 —— 那不是数据错，
 * 是**还没按 textRef 取回**。
 *
 * 这个 helper 统一两件事，免得每个测试各写一遍、各写错一遍：
 *   1. loadData()：把 data/text-master.js 排到最前，其余文件照给（顺序不乱）；
 *   2. resolveAll()：把某个集子变量里的条目按 textRef 展开成「带正文的条目」，
 *      与页面里引擎（js/reader-core.js）取到的一致。
 *
 * 用法：
 *   const { loadData, resolve } = require('./master-env');
 *   loadData(sandbox, ['data/poems-tangshi.js', 'data/site-index.js']);
 *   const TS = resolve(sandbox, sandbox.POEMS_TANGSHI, 'tangshi');
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/** 载入数据文件；text-master.js 一定排最前（取数函数要先能读到表）。 */
function loadData(sandbox, files) {
  const list = ['data/text-master.js'].concat(files.filter(function (f) {
    return f.replace(/^data\//, '') !== 'text-master.js';
  }));
  list.forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  });
}

/** 把条目（或其数组）按 textRef 展开；没有 masterTextOf 时原样返回。 */
function resolve(sandbox, p, book) {
  const fn = sandbox && sandbox.masterTextOf;
  if (typeof fn !== 'function') return p;
  if (Array.isArray(p)) {
    return p.map(function (x) { return fn(x, book); });
  }
  return fn(p, book);
}

module.exports = { loadData, resolve, ROOT };
