const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function loadData(sandbox, files) {
  let list = ['data/text-master.js'].concat(files.filter(function (f) {
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

module.exports = { loadData, resolve, ROOT };
