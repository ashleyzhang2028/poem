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
  { id: "yuefu",    files: ["data/poems-yuefu.js"],    varName: "POEMS_YUEFU" },
  { id: "tangshi",  files: ["data/poems-tangshi.js"],  varName: "POEMS_TANGSHI" },
  { id: "songci",   files: ["data/poems-songci.js"],   varName: "POEMS_SONGCI" },
  { id: "guwen",    files: ["data/poems-guwen.js"],    varName: "POEMS_GUWEN" },
  { id: "zhaoming", files: ["data/poems-zhaoming.js"], varName: "POEMS_ZHAOMING" },
  { id: "yuanqu",   files: ["data/poems-yuanqu.js"],   varName: "POEMS_YUANQU" },
  { id: "jinxiandai", files: ["data/poems-jinxiandai.js"], varName: "POEMS_JINXIANDAI" },
  { id: "chengyu", files: ["data/poems-chengyu.js"], varName: "POEMS_CHENGYU" }
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

    var extra = [];
    if (b.needsIndex && fs.existsSync(path.join(ROOT, "data/index.js"))) {
      extra = ["data/index.js"];
    }
    extra = extra.concat(["data/text-master.js"]);
    extra = extra.filter(function (f) { return fs.existsSync(path.join(ROOT, f)); });
    var win = runInSandbox(files.concat(extra));
    var list = (win[b.varName] || []).map(function (p) {
      return (typeof win.masterTextOf === "function") ? win.masterTextOf(p, b.id) : p;
    });
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

// 范围过滤与前端同源：前端飞花令的令字 / 看答案都按 state.setup.scope 过滤，
// 服务器判分若照旧扫全站语料，两边的「对上 / 没对上」就会各说一套。
// exam.js 是 UMD，Node 下直接 require 得到同一个 Ex.select。
function exam() {
  return require(path.join(ROOT, "js", "exam.js"));
}

// 服务端的语料是**按集子拼的**（见上面的 BOOKS），课内三学段
// （poems:primary / middle / high）在服务端没有 grade 数据 —— 前端那份
// `data/poems-N.js` 才带 grade。所以：
//   · 认得出的集子（book:xxx）按 range 收窄；
//   · 认得出的学段但服务端没数据 —— 退回全站，但**如实报出来**
//     （scoped().exact = false），判分结果里带一个 scopeExact，
//     免得「小学范围」判出个全站的结果还假装是小学的；
//   · 认不出的 scope 一样只退回全站，不抛。
function scoped(scopeId) {
  var cps = corpus();
  var id = String(scopeId == null ? "" : scopeId);
  if (!id || id === "all") return { corpus: cps, id: "all", exact: true };
  var out = null;
  try { out = exam().select(cps, id); } catch (e) { out = null; }
  if (out && out.length) return { corpus: out, id: id, exact: true };
  return { corpus: cps, id: id, exact: false };
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
  // 判分语料跟着用户选的范围走（前端把 scopeId 一起带上来）；
  // 不认这个范围时退回全站 —— 宁可判得宽，也不要因为范围名单对不上而误判「没找到」。
  // scopeExact 如实告诉前端「这次服务端真按这个范围过滤了吗」。
  var sc = scoped(input.scopeId);
  var cps = sc.corpus;
  var chars = (input.chars || [input.char]).filter(Boolean).map(String);
  if (!chars.length) return { bad: "E_CHARS", message: "请先给一个令字" };
  var said = String(input.said == null ? "" : input.said).replace(/\s/g, "");
  if (!said) return { bad: "E_BODY", message: "请把你想起来的那一句填上" };
  var hit = Q.flyFlower({ poems: cps, chars: chars });
  var exact = hit.rows.filter(function (r) { return r.text === said; })[0] || null;
  return {
    ok: true, kind: "fly", chars: chars, said: said,
    scopeId: sc.id, scopeExact: sc.exact,
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
  scoped: scoped,
  BOOKS: BOOKS,

  _reset: function () { cache = null; bankCache = null; }
};
