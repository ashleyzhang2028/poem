/**
 * 课内诗词整体导出专项测试（Issue #159 · 用户 2026-09-16 裁决）
 * ==========================================================================
 * 这一层守的是**口径**，不是排版：用户把「全站批量导出」这条改过一次，原话 ——
 *
 *   「为啥要有全站批量导出功能？这不是这个网站的核心资产吗？
 *    顶多支持学校课本部分的全部导出。这个 pro 用户就行。」
 *
 * 于是三处一起改，这一层逐个钉住：
 *   ① **内容**：只导课内 261 首（`js/export-core.js` 的范围表只有「课内」）；
 *      六部集子**不做**一次性整本导出 —— 那是站点整理的内容资产，用户点名不要
 *   ② **门槛**：`export.all` 从 Max **降到 Pro**
 *   ③ **名字**：从「全站批量导出」改成「全站课内诗词批量导出 261 首」，
 *      与服务端下发的 features 逐字一致（两端各说各话是 2A 那个坑）
 *
 * 另外守三件「导出本身别骗人」的事：
 *   · 排序按**教材册次**（一年级上 → …… → 高三下），不跟着数据文件的出场顺序走
 *   · 正文**一字不改**（不重排断句、不转标点）—— 这份纸的用处之一正是拿去抄
 *   · 没有正文的篇目**不写成空条**，并如实计数
 *
 * 跑法：`node test/export-core.test.js`（纯 Node，不联网、不装依赖）
 */
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

/* ---------- 载入站点索引（与页面里同一串顺序、同一份文件） ---------- */
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
  /* 这是本轮最要紧的一条断言：集子一旦被加进范围表，就等于把站点整理的内容
     整本交出去 —— 用户 2026-09-16 明确不要。加回来必须先改这条断言与文档。 */
  ["classic", "tangshi", "songci", "guwen", "zhaoming"].forEach(b => {
    chk(C.SCOPES.poems.books.indexOf(b) < 0,
      "范围表里**没有** " + b + "（集子不做一次性整本导出）");
  });
  const books = {};
  items.forEach(p => { books[p.book] = (books[p.book] || 0) + 1; });
  eq(Object.keys(books).join(","), "poems", "导出条目只来自课内那一部");
  eq(items.length, 261, "课内 261 首一篇不少（实际 " + items.length + "）");
  chk(items.every(p => !!p.text), "每一首都有正文");

  /* 站点索引里确实有集子那 1300+ 篇 —— 它不是「没数据」，是**故意不导** */
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
  /* 名字、门槛、内容三处必须一起改：只改名字不改门槛，对比表与实际行为就分叉了 */
  chk(!/全站批量导出$/.test(E.cap("export.all").name),
    "名字不再是老的「全站批量导出」（那三个字现在只指向课内）");

  /* 服务端下发的 features 与客户端能力表**逐字一致**（2A 那个坑） */
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
  /* 逐册顺序必须严格递增：数据文件重排之后，用户手里的导出顺序不该跟着乱 */
  const order = [];
  for (let g = 1; g <= 12; g++) {
    order.push(C.volumeOf({ grade: g, term: 1 }), C.volumeOf({ grade: g, term: 2 }));
  }
  eq(vols.map(v => v.slice(1, -1)).join(","), order.join(","), "册次顺序与教材一致");
  eq(items[0].title, "咏鹅", "第一首是一年级上的《咏鹅》（" + items[0].title + "）");
  /* 把数组**倒过来**传：排出来仍是册次顺序，只有同册之内跟着传入次序 ——
     也就是说「排序真的在起作用」，不是数据文件碰巧已经排好了。
     同一册之内保持传入顺序是**故意的**：教材里那一册的篇目次序由语料给，
     内核不去替它重排（重排就得再维护一份「册内次序」表）。 */
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
  /* 自选清单不分册次：它导的是用户自己挑的那几篇，顺序就是清单顺序 */
  const custom = C.order(items.slice(0, 5).reverse(), "custom");
  eq(custom[0].id, items[4].id, "自选范围不动顺序（清单顺序就是导出顺序）");
}

console.log("\n=== 四、正文一字不改：不重排断句、不转标点 ===");
{
  const r = C.build({ items: items, scope: "poems" });
  const lines = r.text.split("\n");
  /* 每一行正文都要能在站点索引里逐字找到 —— 「不转写、不改字」的判据 */
  const pool = items.map(p => String(p.text || "")).join("\n");
  const bad = lines.filter(l => {
    const t = l.trim();
    if (!t || /^【/.test(t) || /^共 /.test(t) || /^导出于 /.test(t) || /^课内诗词（/.test(t)) return false;
    if (items.some(p => C.headLine(p) === t)) return false;
    return pool.indexOf(t) < 0;
  });
  eq(bad.length, 0, "导出里的每一行正文都能在语料里逐字找到" + (bad.length ? "（异常：" + bad[0] + "）" : ""));
  /* 断句照原文：拿一首多行诗对一下 */
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
  /* 不传 now 就不写日期 —— 测试要可复现（有日期的那份每次都不等） */
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
  /* 集子不在范围清单里 = 界面上连「那一项」都不会出现 */
  ["classic", "tangshi", "songci", "guwen", "zhaoming"].forEach(b => {
    chk(!C.scopeInfo(b), "范围表里没有 " + b + "（没有「导出这一部」这个选项）");
  });
}

console.log("\n=== 八、接口与页面：拦在数据层，按钮之外也绕不过 ===");
{
  /* ① 按钮不隐藏（藏入口不是权限边界，docs §3.4） */
  const html = read("settings/general/index.html");
  const js = read("js/settings.js").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  has(html, 'id="btn-export-poems"', "设置 · 通用页有导出按钮");
  chk(!/btn-export-poems[^>]*hidden/.test(html), "按钮**不隐藏**（层级不够时点它得到的是门槛说明）");
  has(js, 'E.can("export.all"', "导出前真的问一次能力表");
  has(js, "E.denyReason(", "拦住用户的那句话由 Entitlement.denyReason() 出（页面不自造）");
  has(js, "C.build(", "文本由导出内核生成，页面不自己拼一份");
  /* ② 页面不自己拼门槛 / 不手抄篇数：261 这个数字要来自内核挑出来的条目 */
  chk(!/=== *["']pro["']|=== *["']max["']/.test(js), "js/settings.js 不自己比 tier");
  /* ③ 导出**不写盘**：导一次不该改用户任何数据 */
  const core = read("js/export-core.js")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  chk(!/setItem|localStorage|document\./.test(core), "js/export-core.js 零存储、零 DOM（纯逻辑）");
  /* ④ 离线也要能导：脚本进预缓存、版本号跟着提 */
  const sw = read("sw.js");
  has(sw, '"./js/export-core.js"', "sw.js 预缓存里有 js/export-core.js");
  const ver = parseInt((sw.match(/poem-app-v(\d+)/) || [0, "0"])[1], 10);
  chk(ver >= 131, "缓存版本已跟着提（实际 v" + ver + "）");
  has(read("settings/general/index.html"), "/js/export-core.js", "设置页加载了导出内核");
}

console.log("");
if (fails) {
  console.log("✗ 课内诗词导出测试有 " + fails + " 项未通过");
  process.exit(1);
}
console.log("🎉 课内诗词整体导出测试全部通过");
