"use strict";

// ---------------------------------------------------------------------------
// 底栏五格：中间那一格「大会」（Issue #342）
// ---------------------------------------------------------------------------
// 用户 2026-09-26：
//   「其实我想把这个古诗词大会按钮放到导航栏中间，也就是四个变成五个，
//     很吸引人 需要你匹配一个好看的图标」
//
// 这一层是**纯源码断言**（不 jsdom、不起浏览器），钉住这回改的四件事：
//
//   1. 底栏就五格、次序是 背诵 / 课外 / 大会 / 搜索 / 我的 —— 「大会」正中间；
//   2. 「大会」那一格走的是**它自己的一页** `/dahui/`（Issue #356 拆页）；
//   3. 那一格的图标是一条内联 SVG，五瓣等分（四片由 `<g rotate>` 转出来），
//      花心是暖金实心 —— 这是它「吸引人」的唯一来源；
//   4. 「谁亮」的规则**只有 `dockKey()` 一处**。
//
// ⚠️ 这一层守的是**当前**口径，下面两条都是被推翻过的老口径，别再把它们当依据：
//    · §4.66 ⑨「不在底栏加第五格」（2026-09-26 用户明确要加，作废）；
//    · §4.70 ④「那一格指向 `/poems/?game=1`」（2026-09-26 用户要求拆成独立页，作废）。
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

let fails = 0;
const chk = (c, m) => { if (!c) { console.log("✗ " + m); fails++; } else console.log("✓ " + m); };
const eq = (a, b, m) => chk(a === b, m + "（实际 " + JSON.stringify(a) + "）");

const chrome = read("js/chrome.js");
const game = read("js/game.js");
const style = read("css/style.css");
// 断言「不再有某某老写法」时**先剥掉注释** —— 注释里正记着那些老写法为什么被换掉
// （`test/game-layer.test.js` 查同一类事时也是这么做的）。
const bare = src => src
  .replace(/<!--[\s\S]*?-->/g, " ")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^\s*\/\/.*$/gm, " ");

// ---------------------------------------------------------------------------
console.log("=== 1 · 底栏五格，次序里「大会」在正中间 ===");
{
  const block = chrome.slice(chrome.indexOf("var DOCK_ITEMS = ["), chrome.indexOf("];", chrome.indexOf("var DOCK_ITEMS = [")));
  const keys = [...block.matchAll(/key:\s*"([a-z]+)"/g)].map(m => m[1]);
  eq(keys.join(","), "home,library,game,search,mine", "五格的 key 次序：背诵 / 课外 / 大会 / 搜索 / 我的");
  eq(keys.length, 5, "底栏就五格（四格那条口径已被 Issue #342 取代）");
  eq(keys[2], "game", "**中间那一格**是「大会」—— 五格正中，用户要的就是这个位置");

  chk(/label:\s*"大会"/.test(block), '那一格的文字是「大会」（其余四格都是两字，五格才排得齐）');
  chk(/href:\s*"\/dahui\/"/.test(block), "那一格指向 /dahui/（它自己的一页）");
  chk(/desc: "古诗词大会/.test(block), "那一格的 title 说清它是「古诗词大会」（桌面上悬停看得见）");

  // ⚠️ 四个玩法的名字只有三处落点（能力表 / 形态表 / 页面层），
  //    底栏这里再抄一份就多一处会对不上的（test/ops.test.js 同一条纪律）。
  // （注释里那句「不许列」本身会命中正则，所以要先把注释抹掉再查 ——
  //   `test/ops.test.js` 查同一件事时也是这么做的。）
  const bareBlock = bare(block);
  chk(!/飞花令|题库复习|模拟考试|正式考试/.test(bareBlock),
    "那一格的文案**不列**四个玩法的名字（名字只有三处落点）");
}

// ---------------------------------------------------------------------------
console.log("\n=== 2 · 那一格是它自己的一页：/dahui/ ===");
{
  chk(/game:\s*"\/dahui\/"/.test(chrome), "ROUTES 里 game 走 /dahui/");
  chk(!/\/poems\/\?game=1/.test(bare(chrome)), "chrome.js 里不再有 /poems/?game=1 这条参数路由（注释里那段来历不算）");
  chk(fs.existsSync(path.join(ROOT, "dahui/index.html")), "/dahui/ 是一页（自己目录里有 index.html）");
  chk(!/game:\s*"\/game\//.test(chrome), "也不叫 /game/（本仓习惯是拼音目录，与 /yuanqu/ /chengyu/ 同一套）");

  // 全站唯一一条「参数路由」随拆页一起消失：`currentRoute()` 只看路径
  const cr = chrome.slice(chrome.indexOf("function currentRoute()"), chrome.indexOf("function openSettings"));
  chk(/trimHref\(routeHref\(key\)\) === p/.test(cr), "currentRoute() 只按路径比（不再先按含查询串的整条地址比）");
  chk(!/location\.search/.test(cr), "currentRoute() 里不再读查询串 —— 那条特判连同它的坑一起删了");
  chk(/split\("\?"\)\[0\]/.test(chrome), "trimHref() 把查询串摘掉（路由一律只认路径）");

  // 「谁亮」的规则只有 dockKey 一处
  chk(/if \(key === "game"\) return "game";/.test(chrome), "dockKey(): game → game（中间那一格亮）");
  chk(/if \(key === "poems"\) return "library";/.test(chrome), "dockKey(): poems → library（诗词列表仍归「课外」）");
}

console.log("\n=== 3 · 图标：一条内联 SVG，五瓣等分 + 暖金实心花心 ===");
{
  const m = chrome.match(/tabGame:\s*([\s\S]*?)\n\n/);
  chk(!!m, "GLYPHS 里有 tabGame 这一条");
  const g = m ? m[1] : "";

  chk(/<svg /.test(g), "是一条内联 SVG（不是 emoji、不是外链图片）");
  eq((g.match(/<g transform="rotate\(/g) || []).length, 5, "五片花瓣各一片（五瓣等分）");
  ["0 12 12", "72 12 12", "144 12 12", "216 12 12", "288 12 12"].forEach(a =>
    chk(g.indexOf(a) >= 0, "有一片绕 (12,12) 转 " + a.split(" ")[0] + "°（五瓣严格等分）"));
  eq((g.match(/<path d="M12 12\.7/g) || []).length, 5, "五片用的是同一条花瓣路径（不手写五遍）");
  chk(/r="1\.55"/.test(g) && /fill="#cf9a4a"/.test(g), "花心是暖金实心（#cf9a4a，底栏唯一一处彩色）");
  chk(/stroke="currentColor"/.test(g), "花瓣边框仍随文字色（未选中是灰、选中转绿）");
  chk(!/url\(|\bimg\b|<image/.test(g), "图标不引外部资源（离线 / 预缓存都不用管它）");

  // 其余四格的图标不许被顺手涂色 —— 只有中这一格是彩的
  chk((chrome.match(/fill="#cf9a4a"/g) || []).length === 1, "底栏五格里**只有**中间那一格带暖金（其余四格素色）");

  // 五格共用一个尺寸变量
  chk(/--dock-icon-size:\s*26px/.test(style), "五格图标共用一个尺寸变量 --dock-icon-size: 26px");
  chk(/\.dock-icon svg/.test(style), "新那一格与其余四格走同一条 .dock-icon svg 规则（不单独调尺寸）");
}

// ---------------------------------------------------------------------------
console.log("\n=== 4 · 掀开 / 收起时底栏当场变亮 ===");
{
  chk(/function setDockNav\(/.test(game), "js/game.js 有 setDockNav() 一处改 data-nav");
  chk(/setAttribute\("data-nav",\s*v\)/.test(game), "改的是 body 的 data-nav");
  chk(/C\.setDock\(\)/.test(game), "改完喊 SiteChrome.setDock() 重画底栏");

  const openBody = game.slice(game.indexOf("function open()"), game.indexOf("function isOpen()"));
  chk(/setDockNav\("game"\)/.test(openBody), "open() 里把底栏挪到「大会」那一格");
  const closeBody = game.slice(game.indexOf("function close()"), game.indexOf("function standalone"));
  chk(/setDockNav\("poems"\)/.test(closeBody), 'close() 里**还原**成 "poems"（不然退出后底栏还点着「大会」）');

  // 拦住用户那一支（层级不够）：也算「站在大会这一层」，否则从底栏点进来
  // 只会看到「课外」亮着、右边冒出一张卡，像点错了地方。
  const gateBody = game.slice(game.indexOf("function renderEntryGate()"), game.indexOf("function renderHome()"));
  chk(/setDockNav\("game"\)/.test(gateBody), "权限不够、画那张拦住卡时，底栏也照亮点「大会」");

  // ⚠️ 从前的 `dropGameParam()`（退出时把参数从地址栏摘掉）随叠层一起删了：
  //    大会有了自己的页，地址栏上没有参数可摘。
  chk(!/function dropGameParam\(/.test(game), "不再有 dropGameParam()（叠层时代的补丁，已随拆页删掉）");

  chk(/function paintDock\(\)/.test(chrome), "js/chrome.js 有 paintDock()：就地换 active，不重挂 <nav>");
  chk(/id="site-dock"/.test(chrome), "paintDock() 认的是 #site-dock 那一颗现成的 <nav>");
  chk(/dockKey\(pageKey\(\)\)/.test(chrome), "「谁亮」仍是 dockKey(pageKey()) 一处算 —— 页面上不另写一套");

  // 独立页：这一页就是大会，进来即铺开
  chk(/function standalone\(\)/.test(game), "有 standalone() 认「这是大会自己的一页」");
  chk(/data-nav"\s*\)\s*===\s*"game"/.test(game), "判断据取 body[data-nav=\"game\"]（与底栏「谁亮」同源，不另立标记）");
  const initBody = game.slice(game.indexOf("function init()"), game.indexOf("function loadCorpusIntoView"));
  chk(/standalone\(\)/.test(initBody), "init() 里认这一页");
  chk(/capAllowed\(GATHERING_CAP/.test(initBody), "进来**先过权限**（exam.gathering 的门不许绕）");
  chk(/renderEntryGate\(\)/.test(initBody), "不够层级就画那张「为什么点不动」的卡，不留白");

  // 老地址改道：/poems/?game=1 → /dahui/
  chk(/function redirectOldGameLink\(\)/.test(read("js/poems.js")), "js/poems.js 有 redirectOldGameLink()（老地址改道）");
  chk(/location\.replace\("\/dahui\/"\)/.test(read("js/poems.js")), "改道用的是 replace（不留一条「回退又跳回来」的历史）");
}

// ---------------------------------------------------------------------------
console.log("\n=== 5 · 工具条那颗键留在原地（用户只说「挪进导航栏」，没说删） ===");
{
  const poemsHtml = read("poems/index.html");
  chk(/poems-game-entry/.test(poemsHtml), "/poems/ 工具条那颗「古诗词大会」仍在（两条入口、一页）");
  chk(/href="\/dahui\/"/.test(poemsHtml), "它是一条**去 /dahui/ 的链接**（不再就地掀层）");
  chk(!/data-game-open/.test(bare(poemsHtml)), "不再有 data-game-open（注释里那段来历不算）");
  chk(!/data-game-open/.test(bare(game)), "js/game.js 里那段监听也删了（没有对象可挂）");
  chk(!/data-poems-view="game"/.test(poemsHtml), "/poems/ 上不再挂大会那一层");
}

console.log("\n" + (fails ? "❌ " + fails + " 项失败" : "🎉 底栏五格测试全部通过"));
process.exit(fails ? 1 : 0);
