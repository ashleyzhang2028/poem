const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* 正文主表按集子分片：页面把该部的片并进 window.TEXT_MASTER，
   用例也照做 —— 单点 data/text-master.js 只会拿到一个空表。 */
function pieceFiles() {
  const dir = path.join(ROOT, 'data/text-master');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort()
    .filter(function (f) { return /\.js$/.test(f); })
    .map(function (f) { return 'data/text-master/' + f; });
}

function loadData(sandbox, files) {
  let list = ['data/text-master.js'].concat(pieceFiles()).concat(files.filter(function (f) {
    return f.replace(/^data\//, '') !== 'text-master.js';
  }));
  // `data/site-index.js` 依赖 `data/site-books.js` 里的集子清单（清单的唯一一份）。
  // 用例里单点 site-index 时把清单插到它前面，免得每个文件都各写一遍。
  if (list.indexOf('data/site-index.js') >= 0 && list.indexOf('data/site-books.js') < 0) {
    list.splice(list.indexOf('data/site-index.js'), 0, 'data/site-books.js');
  }
  list.forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  });
}

function resolve(sandbox, p, book) {
  const fn = sandbox && sandbox.masterTextOf;
  if (typeof fn !== 'function') return p;
  if (Array.isArray(p)) {
    return p.map(function (x) { return fn(x, book); });
  }
  return fn(p, book);
}

/* 不带 .js 的片路径（给 `f + '.js'` 那种老写法用）。 */
function pieceFilesStem() {
  return pieceFiles().map(function (f) { return f.replace(/\.js$/, ''); });
}

/* 把 `data/text-master.js` 展开成「入口 + 各片」；其余路径原样返回。
   给直接跑 vm 的用例用（它们不走 loadData）。 */
function expandMaster(list) {
  const out = [];
  list.forEach(function (f) {
    if (/(^|\/)data\/text-master\.js$/.test(f)) {
      out.push(f);
      pieceFiles().forEach(function (p) { out.push(p); });
    } else {
      out.push(f);
    }
  });
  return out;
}

module.exports = { loadData, resolve, pieceFiles, pieceFilesStem, expandMaster, ROOT };
