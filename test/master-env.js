const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function loadData(sandbox, files) {
  const list = ['data/text-master.js'].concat(files.filter(function (f) {
    return f.replace(/^data\//, '') !== 'text-master.js';
  }));
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
