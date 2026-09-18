"use strict";

const fs = require("fs");
const vm = require("vm");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

let fails = 0;
const chk = (c, m) => { if (!c) { console.log("✗ " + m); fails++; } else console.log("✓ " + m); };
const eq = (a, b, m) => chk(a === b, m + "（实际 " + JSON.stringify(a) + "）");
const has = (s, sub, m) => chk(String(s).indexOf(sub) >= 0, m);

const C = require(path.join(ROOT, "js/export-core.js"));
const E = require(path.join(ROOT, "js/entitlement.js"));

function loadSiteIndex() {
  const sandbox = { window: {}, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const files = ["data/text-master.js"].concat(
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"].map(n => "data/poems-" + n + ".js")
  ).concat([
    "data/index.js", "data/poems-classic.js", "data/poems-tangshi.js",
    "data/poems-songci.js", "data/poems-guwen.js", "data/poems-zhaoming.js",
    "data/site-index.js"
  ]);
  files.forEach(f => vm.runInContext(read(f), sandbox, { filename: f }));
  return sandbox.SITE_INDEX;
}

const INDEX = loadSiteIndex();
const items = C.order(C.pick(INDEX, "poems"), "poems");

console.log("=== 一、内容：只导课内，六部集子**不做**整本导出 ===");
{
  eq(C.SCOPES.poems.books.join(","), "poems",
    "范围表里「课内」只认课内那一部（books: [\"poems\"]）");

  ["classic", "tangshi", "songci", "guwen", "zhaoming"].forEach(b => {
    chk(C.SCOPES.poems.books.indexOf(b) < 0,
      "范围表里**没有** " + b + "（集子不做一次性整本导出）");
  });
  const books = {};
  items.forEach(p => { books[p.book] = (books[p.book] || 0) + 1; });
  eq(Object.keys(books).join(","), "poems", "导出条目只来自课内那一部");
  eq(items.length, 261, "课内 261 首一篇不少（实际 " + items.length + "）");
  chk(items.every(p => !!p.text), "每一首都有正文");

  const other = INDEX.filter(p => !p.isBook && p.book !== "poems");
  chk(other.length > 1000, "站点索引里另有 " + other.length + " 篇集子篇目（刻意不进这份导出）");
  C.pick(INDEX, "poems").forEach(p => {
    chk(p.book === "poems", "挑出来的每一条都属于课内（" + p.title + "）");
  });
}

console.log("\n=== 二、门槛：export.all 从 Max 降到 Pro（名字也一起改） ===");
{
  const ctx = t => ({ tier: t, signedIn: true });
  chk(E.can("export.all", ctx("pro")).ok, "Pro 可用（用户说的「这个 pro 用户就行」）");
  chk(E.can("export.all", ctx("max")).ok, "Max 当然也可用");
  chk(!E.can("export.all", ctx("free")).ok, "free 不可用");
  chk(!E.can("export.all", { tier: "pro", signedIn: false }).ok, "未登录不可用（要登录）");
  has(E.cap("export.all").name, "课内", "能力名字里写明「课内」（不许含糊成全站）");

  chk(!/全站批量导出$/.test(E.cap("export.all").name),
    "名字不再是老的「全站批量导出」（那三个字现在只指向课内）");

  const core = require(path.join(ROOT, "api/_lib/core.js"));
  const cfg = { hasDb: () => true, hasSession: () => true, mail: () => "console" };
  const proFeatures = core.featuresFor(cfg, "pro");
  chk(proFeatures.indexOf("export.all") >= 0, "服务端 pro 那档下发 export.all");
  chk(core.featuresFor(cfg, "max").indexOf("export.all") >= 0, "max 那档也下发");
  chk(core.featuresFor(cfg, "free").indexOf("export.all") < 0, "free 那档不下发");
}

console.log("\n=== 三、顺序：按教材册次排，不跟着数据文件的出场顺序 ===");
{
  const vols = C.build({ items: items, scope: "poems" }).text.match(/【[^】]+】/g) || [];
  eq(vols.length, 24, "24 个册次分组（一年级上 → …… → 高三下）");
  eq(vols[0], "【一年级上】", "第一组是一年级上");
  eq(vols[vols.length - 1], "【高三下】", "最后一组是高三下");

  const order = [];
  for (let g = 1; g <= 12; g++) {
    order.push(C.volumeOf({ grade: g, term: 1 }), C.volumeOf({ grade: g, term: 2 }));
  }
  eq(vols.map(v => v.slice(1, -1)).join(","), order.join(","), "册次顺序与教材一致");
  eq(items[0].title, "咏鹅", "第一首是一年级上的《咏鹅》（" + items[0].title + "）");

  const flipped = [];
  for (let i = 1; i <= 12; i++) {
    flipped.push(C.volumeOf({ grade: i, term: 2 }), C.volumeOf({ grade: i, term: 1 }));
  }
  const reversed = C.order(items.slice().reverse(), "poems");
  const volsOf = list => {
    const out = [];
    list.forEach(p => { const v = C.volumeOf(p); if (out[out.length - 1] !== v) out.push(v); });
    return out;
  };
  eq(volsOf(reversed).join(","), order.join(","),
    "倒着传进去，册次顺序照样是对的（一年级上仍是第一组）");
  eq(volsOf(reversed)[0], "一年级上", "倒着传进去第一组仍是一年级上（实际 " + volsOf(reversed)[0] + "）");
  eq(volsOf(reversed)[1], "一年级下", "第二组仍是一年级下（同册内保持传入次序）");

  const custom = C.order(items.slice(0, 5).reverse(), "custom");
  eq(custom[0].id, items[4].id, "自选范围不动顺序（清单顺序就是导出顺序）");
}

console.log("\n=== 四、正文一字不改：不重排断句、不转标点 ===");
{
  const r = C.build({ items: items, scope: "poems" });
  const lines = r.text.split("\n");

  const pool = items.map(p => String(p.text || "")).join("\n");
  const bad = lines.filter(l => {
    const t = l.trim();
    if (!t || /^【/.test(t) || /^共 /.test(t) || /^导出于 /.test(t) || /^课内诗词（/.test(t)) return false;
    if (items.some(p => C.headLine(p) === t)) return false;
    return pool.indexOf(t) < 0;
  });
  eq(bad.length, 0, "导出里的每一行正文都能在语料里逐字找到" + (bad.length ? "（异常：" + bad[0] + "）" : ""));

  const jing = items.filter(p => p.title === "静夜思")[0];
  chk(!!jing, "语料里有《静夜思》");
  has(r.text, "床前明月光，疑是地上霜。", "正文断句与语料一致");
  chk(/静夜思　李白（唐）/.test(r.text), "题头写全「篇名　作者（朝代）」");
}

console.log("\n=== 五、没有正文的篇目：不写成空条，且如实计数 ===");
{
  const empty = [Object.assign({}, items[0], { id: "x1", title: "空篇", text: "" }),
    Object.assign({}, items[1], { id: "x2", title: "空篇二", text: "\n   \n" })];
  const r = C.build({ items: empty.concat(items.slice(0, 3)), scope: "poems" });
  eq(r.count, 3, "只有 3 篇写进文件");
  eq(r.skipped, 2, "如实报出 2 篇没有正文（不悄悄少一篇）");
  chk(r.text.indexOf("空篇") < 0, "没有正文的篇目**不写成一条只有题名的空条**");
  eq(C.build({ items: items, scope: "poems" }).skipped, 0, "课内 261 首都有正文（skipped = 0）");
}

console.log("\n=== 六、文件头与文件名：说清这是什么、什么时候导的 ===");
{
  const r = C.build({ items: items, scope: "poems", now: new Date("2026-09-16T10:00:00") });
  const head = r.text.split("\n").slice(0, 3).join("\n");
  has(head, "课内诗词", "文件头第一行写明导出的是什么");
  has(head, "261", "文件头写明共 261 首");
  has(head, "2026-09-16", "文件头写明导出日期");

  chk(C.build({ items: items, scope: "poems" }).text.indexOf("导出于") < 0,
    "不传 now 时不写日期行（可复现）");
  eq(C.fileName("poems", new Date("2026-09-16")), "跬步-课内诗词-2026-09-16.txt", "文件名带范围与日期");
  chk(/课内诗词/.test(C.fileName("poems", new Date("2026-09-16"))), "文件名里写明范围");
  chk(r.text.slice(-1) === "\n" && !/\n\n\n/.test(r.text), "文件尾不留一堆空行（粘进文档就是空段落）");
}

console.log("\n=== 七、范围表不认识的范围：一律空，不抛也不偷偷换成别的 ===");
{
  eq(C.pick(INDEX, "不存在的范围").length, 0, "未知范围回空数组");
  eq(C.pick(null, "poems").length, 0, "index 缺失也不抛");
  eq(C.pick(INDEX, "").length, 0, "空范围回空数组");
  chk(C.scopes().every(s => !!C.scopeInfo(s.id)), "scopes() 里每个 id 都查得到范围");
  eq(C.scopes().map(s => s.id).join(","), "custom,poems", "范围清单只有自选清单与课内两项");

  ["classic", "tangshi", "songci", "guwen", "zhaoming"].forEach(b => {
    chk(!C.scopeInfo(b), "范围表里没有 " + b + "（没有「导出这一部」这个选项）");
  });
}

console.log("\n=== 七之二、进度导出（导出备份）是登录可用（Issue #229 第二轮）===");
echo: {
  // 用户原话：「层级页面 进度导出 功能改为登录可用，实际功能也按这个修改。」
  // 台账那一行在 js/entitlement.js（CAPS），真正的按钮在 js/settings.js 的
  // #btn-export —— 两处都得跟着走，否则就是「表上说要登录、实际游客照样导」。
  const cap = E.cap("export.progress");
  chk(!!cap, "进度导出这条能力在（键名 export.progress）");
  eq(cap.login, true, "内核里 export.progress 的 login 是 true");
  eq(cap.minTier, "free", "层级仍是 free：登录后就给，不是 Pro / Max 的事");
  eq(E.can("export.progress", { tier: "free", signedIn: false }).reason, "login",
    "未登录时拦它的是「未登录」");
  chk(E.can("export.progress", { tier: "free", signedIn: true }).ok,
    "登录后的 free 放行");

  const js = read("js/settings.js").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  const at = js.indexOf('const exportBtn = $("#btn-export");');
  chk(at >= 0, "js/settings.js 里有导出备份那颗键（#btn-export）");
  const block = js.slice(at, js.indexOf('const poemsBtn', at));
  has(block, 'E.can("export.progress"', "点它之前真的问一次能力表（不是只写在台账里）");
  has(block, "E.denyReason(", "拦住用户的那句话由 Entitlement.denyReason() 出（页面不自造）");
  chk(block.indexOf("return") >= 0 && block.indexOf("Storage.exportJSON") > block.indexOf('E.can("export.progress"'),
    "拦住时当场 return，不落到导出的那几行（先判后导）");
  chk(!/btn-export[^>]*hidden/.test(read("settings/general/index.html")),
    "按钮**不隐藏**：游客也看得见它，点一下得到「登录可用」（藏起来就成了点了没反应）");
  chk(!/=== *["']pro["']|=== *["']max["']/.test(js), "js/settings.js 仍不自己比 tier");
}

console.log("\n=== 八、接口与页面：拦在数据层，按钮之外也绕不过 ===");
{

  const html = read("settings/general/index.html");
  const js = read("js/settings.js").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  has(html, 'id="btn-export-poems"', "设置 · 通用页有导出按钮");
  chk(!/btn-export-poems[^>]*hidden/.test(html), "按钮**不隐藏**（层级不够时点它得到的是门槛说明）");
  has(js, 'E.can("export.all"', "导出前真的问一次能力表");
  has(js, "E.denyReason(", "拦住用户的那句话由 Entitlement.denyReason() 出（页面不自造）");
  has(js, "C.build(", "文本由导出内核生成，页面不自己拼一份");

  chk(!/=== *["']pro["']|=== *["']max["']/.test(js), "js/settings.js 不自己比 tier");

  const core = read("js/export-core.js")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  chk(!/setItem|localStorage|document\./.test(core), "js/export-core.js 零存储、零 DOM（纯逻辑）");

  const sw = read("sw.js");
  has(sw, '"./js/export-core.js"', "sw.js 预缓存里有 js/export-core.js");
  const ver = parseInt((sw.match(/poem-app-v(\d+)/) || [0, "0"])[1], 10);
  chk(ver >= 160, "缓存版本已跟着提（Issue #229 第二轮动了 js/settings.js，实际 v" + ver + "）");
  has(read("settings/general/index.html"), "/js/export-core.js", "设置页加载了导出内核");
}

console.log("");
if (fails) {
  console.log("✗ 课内诗词导出测试有 " + fails + " 项未通过");
  process.exit(1);
}
console.log("🎉 课内诗词整体导出测试全部通过");
