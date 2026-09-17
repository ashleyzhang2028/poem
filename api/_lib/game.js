"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var ROOT = path.join(__dirname, "..", "..");

var BOOKS = [
  { id: "poems",    files: ["data/poems-1.js", "data/poems-2.js", "data/poems-3.js", "data/poems-4.js",
                            "data/poems-5.js", "data/poems-6.js", "data/poems-7.js", "data/poems-8.js",
                            "data/poems-9.js", "data/poems-10.js", "data/poems-11.js", "data/poems-12.js"],
    varName: "POEMS_ALL", needsIndex: true },
  { id: "classic",  files: ["data/poems-classic.js"],  varName: "POEMS_CLASSIC" },
  { id: "tangshi",  files: ["data/poems-tangshi.js"],  varName: "POEMS_TANGSHI" },
  { id: "songci",   files: ["data/poems-songci.js"],   varName: "POEMS_SONGCI" },
  { id: "guwen",    files: ["data/poems-guwen.js"],    varName: "POEMS_GUWEN" },
  { id: "zhaoming", files: ["data/poems-zhaoming.js"], varName: "POEMS_ZHAOMING" }
];

var cache = null;

function runInSandbox(files) {
  var sandbox = { window: {}, console: { log: function () {}, warn: function () {} } };
  sandbox.globalThis = sandbox;
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  files.forEach(function (f) {
    var src = fs.readFileSync(path.join(ROOT, f), "utf8");
    vm.runInContext(src, sandbox, { filename: f });
  });
  return sandbox.window;
}

function corpus() {
  if (cache) return cache;
  var out = [];
  BOOKS.forEach(function (b) {
    var files = b.files.filter(function (f) { return fs.existsSync(path.join(ROOT, f)); });
    if (!files.length) return;
    var win = runInSandbox(files);
    if (b.needsIndex) {

      var idx = "data/index.js";
      if (fs.existsSync(path.join(ROOT, idx))) {
        var w2 = runInSandbox(files.concat([idx, "data/text-master.js"]));
        win = w2;
      }
    }
    var list = win[b.varName] || [];
    list.forEach(function (p) {
      if (!p || !p.id) return;
      out.push({
        id: p.id, book: b.id, title: p.title || "", author: p.author || "",
        dynasty: p.dynasty || "", text: p.text || "", translation: p.translation || "",
        gradeGroup: p.gradeGroup || p.selection || "", source: p.source || ""
      });
    });
  });
  cache = out;
  return cache;
}

function quiz() {
  return require(path.join(ROOT, "js", "quiz.js"));
}

var bankCache = null;
function bank() {
  if (bankCache) return bankCache;
  bankCache = quiz().buildBank(corpus(), { perPoem: 1, options: 4 });
  return bankCache;
}

function rebuild(input) {
  var Q = quiz();
  var b = bank();
  var id = input && (input.bankId || input.questionId);
  var poemId = input && input.poemId;
  if (id) {
    for (var i = 0; i < b.length; i++) if (b[i].id === id) {
      return Q.pick({ bank: b, id: id, options: 4, seed: String(input.seed || id) });
    }
    return null;
  }
  if (poemId) {
    for (var j = 0; j < b.length; j++) if (b[j].poemId === poemId) {
      return Q.pick({ bank: b, id: b[j].id, options: 4, seed: String(input.seed || b[j].id) });
    }
  }
  return null;
}

function checkFly(input) {
  var Q = quiz();
  var cps = corpus();
  var chars = (input.chars || [input.char]).filter(Boolean).map(String);
  if (!chars.length) return { bad: "E_CHARS", message: "请先给一个令字" };
  var said = String(input.said == null ? "" : input.said).replace(/\s/g, "");
  if (!said) return { bad: "E_BODY", message: "请把你想起来的那一句填上" };
  var hit = Q.flyFlower({ poems: cps, chars: chars });
  var exact = hit.rows.filter(function (r) { return r.text === said; })[0] || null;
  return {
    ok: true, kind: "fly", chars: chars, said: said,
    found: !!exact,
    poemId: exact ? exact.id : null,
    title: exact ? exact.title : null,

    total: hit.count
  };
}

module.exports = {
  corpus: corpus,
  bank: bank,
  quiz: quiz,
  rebuild: rebuild,
  checkFly: checkFly,
  BOOKS: BOOKS,

  _reset: function () { cache = null; bankCache = null; }
};
