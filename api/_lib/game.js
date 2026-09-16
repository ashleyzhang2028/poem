/**
 * 古诗词大会 · 服务端那一半（3 期 · 不花钱的那一层）
 * ==========================================================================
 * 这一份只做三件事：
 *
 *   1. 把**语料**（各集子的数据文件）按需加载进来 —— 判分要它；
 *   2. 用**同一个内核** `js/quiz.js` 重建题目并判分（客户端与服务端同一份代码）；
 *   3. 把请求里那些「客户端说了不算」的字段挑出来（`answer` / `options` 一律忽略）。
 *
 * ## 为什么必须由服务端重建题目
 *
 * 判分口最容易被写成「客户端把题和答案一起传上来，服务端比一比」——
 * 那样改一行请求体就能全对，而服务端**一路都不知道自己判的是什么**。
 * 这里改成：请求只带 `poemId` / `bankId` 与用户选的那一条，
 * 题干与答案由服务端从自己的语料重算。于是：
 *   · 客户端改不了答案；
 *   · 客户端与服务端算出来的题**必然一致**（同一份 quiz.js、同一份语料），
 *     不一致时服务端如实回 `E_STALE`（多半是客户端缓存老了一版）。
 *
 * ## 语料是怎么进来的
 *
 * 各集子的数据文件是**浏览器脚本**（`window.POEMS_X = [...]`），
 * 服务端用 `vm` 把 `window` 装成一个空对象再执行它们 —— 这是同一份文件，
 * 不是另抄一份到 API 里。另抄一份的下场是「题库里有的、正文里搜不到」。
 *
 * ⚠️ 加载结果**进程内缓存**：Serverless 实例存活期间只读一次盘。
 *    语料是只读的静态数据，缓存不会与谁漂移。
 *
 * ⚠️ 这一份**不 import 任何第三方包**（与 api/_lib 其余文件同一条纪律）。
 */
"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var ROOT = path.join(__dirname, "..", "..");

/* ------------------------------------------------------------ 一、语料 */

/** 六部集子各自的「数据文件 → window 变量名」表（与 data/site-index.js 同口径） */
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

/** 在沙箱里执行一份浏览器脚本，返回它写到 sandbox 上的全局对象 */
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

/**
 * 全站篇目（六部集子合起来）。
 *
 * 只加载**存在**的数据文件：某一部还没建起来时跳过（不是报错）——
 * 这一份与 `data/site-index.js` 同一条纪律：不拿「待补」的条目当语料。
 */
function corpus() {
  if (cache) return cache;
  var out = [];
  BOOKS.forEach(function (b) {
    var files = b.files.filter(function (f) { return fs.existsSync(path.join(ROOT, f)); });
    if (!files.length) return;
    var win = runInSandbox(files);
    if (b.needsIndex) {
      // 课内：poems-*.js 只是 12 册的原始数据，汇成 POEMS_ALL 的是 data/index.js
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

/* ------------------------------------------------------------ 二、内核 */

/** 出题内核：与客户端同一个文件（js/quiz.js，UMD 双出口） */
function quiz() {
  return require(path.join(ROOT, "js", "quiz.js"));
}

/** 这一份语料的题库（进程内缓存；语料只读，题库也就只读） */
var bankCache = null;
function bank() {
  if (bankCache) return bankCache;
  bankCache = quiz().buildBank(corpus(), { perPoem: 1, options: 4 });
  return bankCache;
}

/* ----------------------------------------------------------- 三、判分 */

/**
 * 重建一道题。**客户端说了不算的那几个字段全在这里被丢掉**。
 *
 * @param {Object} input { poemId, bankId, kind }
 * @returns {Object|null} 内核给出的题（含 answer / options / answerIndex）
 *
 * 为什么按 `bankId` / `poemId` 找、而不是让客户端把题干传上来：
 *   传题干的话，服务端就成了「字符串比对机」—— 用户选了什么、对不对，
 *   全由客户端那两个字段决定。本题库的题干与答案本来就在自己的语料里，
 *   重算一次的成本是零。
 */
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

/**
 * 飞花令的一「对」：用户报一句，服务端从语料里核这一句是否真的带令字。
 *
 * ⚠️ 这一支**不是**自由文本判分（那需要自然语言理解，也就是 AI、也就是钱）。
 *    它做的事只有一件：把用户报的那一串与语料里那一句**逐字比对**——
 *    对上了就是「这一句确实在那篇里」，对不上就如实说对不上。
 *    所以它既不模糊、也不收费。
 */
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
    /* 这一句在这个令字下**能对上几句**——用户看得见自己的答案不是孤例 */
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
  /* 测试用：清掉进程内缓存（语料是只读的，正常运行时不需要） */
  _reset: function () { cache = null; bankCache = null; }
};
