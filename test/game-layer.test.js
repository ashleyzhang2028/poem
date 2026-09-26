"use strict";

// ---------------------------------------------------------------------------
// 「古诗词大会」那一页，只有题 —— 没有古诗列表、也没有详情页（Issue #356）
// ---------------------------------------------------------------------------
// 用户 2026-09-26 两句原话，就是这一层的全部目标：
//   「现在古诗词大会首页显示的还是普通古诗词列表，再点还是详情页，
//     没看出来各种考试，模拟，答题 什么的？」
//   「拆成独立页 不应该显示各个古诗列表和详情页，而是各种试题，模拟及竞赛吧？」
//
// 第一句（底下那张列表没藏住）已经随拆页**从根上**解决了：那一页上
// 压根没有列表这一层，不必再靠 CSS 去压它。所以这一层换成钉「拆页之后
// 两边各有什么」，全是**纯源码断言**（不起浏览器）：
//
//   1. `/dahui/` 上只有玩法那一个挂载点，没有列表、没有阅读器；
//   2. `/poems/` 上列表与阅读器照旧，大会那一层搬走了；
//   3. `js/game.js` 的两种模式：独立页进来就铺开；点句子按「有没有阅读器」
//      决定就地叠还是跳 `/poems/?poem=<id>`；
//   4. 老地址 `/poems/?game=1` 改道 `/dahui/`。
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

let fails = 0;
const chk = (c, m) => { if (!c) { console.log("✗ " + m); fails++; } else console.log("✓ " + m); };

const game = read("js/game.js");
const poemsHtml = read("poems/index.html");
const dahuiHtml = read("dahui/index.html");
const poemsJs = read("js/poems.js");
const gameCode = game.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const dahuiBare = dahuiHtml.replace(/<!--[\s\S]*?-->/g, " ");
const poemsBare = poemsHtml.replace(/<!--[\s\S]*?-->/g, " ");

console.log("\n=== 1 · `/dahui/` 只有题：一个挂载点，没有列表、没有阅读器 ===");
{
  chk(/data-poems-view="game"/.test(dahuiBare), "有大会那一个挂载点");
  chk(/data-nav="game"/.test(dahuiBare), 'body 上写着 data-nav="game"（底栏那一格与 standalone() 同源）');
  chk(!/data-gw="list"/.test(dahuiBare), "**没有**诗词列表（用户要求：不显示各个古诗列表）");
  chk(!/data-gw="reader"/.test(dahuiBare), "**没有**阅读器（用户要求：不显示详情页）");
  chk(!/data-poems-view="list"/.test(dahuiBare), "也没有列表那个书面名字的挂载点");
  chk(/js\/game\.js/.test(dahuiBare), "这一页跑的是同一个 js/game.js（玩法只有一套实现）");
  chk(/js\/quiz\.js/.test(dahuiBare) && /js\/exam\.js/.test(dahuiBare),
    "出题与组卷两个内核都挂上（题从这两个来）");
  chk(/data\/site-books\.js/.test(dahuiBare), "范围名单的来源（SITE_BOOKS）也挂上 —— 不加载整张索引");
}

console.log("\n=== 2 · `/poems/` 照旧：列表与阅读器都在，大会那一层搬走了 ===");
{
  chk(/data-gw="list"/.test(poemsBare), "列表挂载点还在（那一页没动）");
  chk(/data-gw="reader"/.test(poemsBare), "阅读器也还在");
  chk(!/data-poems-view="game"/.test(poemsBare), "大会那一层不在这一页上了");
  chk(/href="\/dahui\/"/.test(poemsBare), "工具条那颗键改成了去 /dahui/ 的链接");
  chk(!/js\/game\.js/.test(poemsBare), "这一页不再加载 js/game.js（玩法整份搬走）");
  chk(!/js\/quiz\.js/.test(poemsBare) && !/js\/exam\.js/.test(poemsBare),
    "出题与组卷两个内核也不再跟着这一页加载");
}

console.log("\n=== 3 · `js/game.js`：进来就铺开；点句子按「有没有阅读器」分两条路 ===");
{
  chk(/function standalone\(\)/.test(game), "有 standalone() 认「这是大会自己的一页」");
  chk(/getAttribute\("data-nav"\) === "game"/.test(gameCode),
    '判据取 body[data-nav="game"]（与底栏「谁亮」同源，不另立标记）');

  // 独立页：进来即铺开，没有「先落列表再找键」，也没有「收起一层」
  chk(/if \(standalone\(\)\) \{\s*open\(\);/.test(game),
    "standalone() 时直接 open()（不再先过一道整页的闸）");
  chk(/if \(standalone\(\)\) \{ location\.href = "\/poems\/"; return; \}/.test(gameCode),
    'close() 在独立页上是**退出去**（回 /poems/），不是「收起一层」');

  // 点句子：有阅读器就地叠，没有就带着 id 跳过去
  chk(/function hasReader\(\)/.test(game), "有 hasReader()：认这一页上有没有阅读器");
  chk(/document\.querySelector\('\[data-gw="reader"\]'\)/.test(game),
    "判据取那个挂载点在不在（不靠路径名去猜）");
  chk(/location\.href = "\/poems\/\?poem=" \+ encodeURIComponent\(id\)/.test(gameCode),
    "没有阅读器时跳 /poems/?poem=<id>（详情页仍住在诗词页那一层）");
  chk(/dispatchEvent\(ev\)/.test(game) && /poems:open/.test(poemsJs),
    "有阅读器那一条仍是老路：发 `poems:open`，由 js/poems.js 就地叠上去");
  chk(!/!document\.dispatchEvent/.test(gameCode),
    "判据不许拿 dispatchEvent() 的返回值当「有没有人接」（那一处监听并不 preventDefault）");

  // 深链那一头：/poems/ 认 `?poem=`
  chk(/function deepLinkId\(\)/.test(poemsJs), "js/poems.js 认 ?poem=<id> 深链");
  chk(/function clearDeepLink\(\)/.test(poemsJs), "打开之后把参数从地址栏抹掉（刷新不再自己铺开）");
  chk(/engine\.open\(want\)/.test(poemsJs), "走的是引擎那一处 open（不许另写一套开法）");

  // 独立页上不再有「掀层 / 藏列表」这套动作
  chk(!/function dropGameParam\(/.test(game), "没有 dropGameParam()（叠层时代的补丁，已删）");
}

console.log("\n=== 3b · 这一页是「考试页」，不是「集子」（Issue #356）===");
{
  // 用户 2026-09-26 原话：「我说的古诗词大会这个页面就是模拟和考试页面，
  // 不是古诗词大会集子，如果是集子，那还是应该放到课外阅读那里去」。
  // 所以这一页上**不许**再有「古诗词大会的集子」这种说法，也不许有一道
  // 把整页堵住的「集子闸」—— 门槛按玩法各算各的（玩法卡自己标）。

  chk(!/集子/.test(gameCode.replace(/集子清单[\s\S]{0,200}/g, " ")) ||
      !/《古诗词大会》的集子/.test(game), "页面上不再把大会说成「《古诗词大会》的集子」");
  chk(/这一页是<strong>飞花令与考试<\/strong>/.test(game),
    "页头把这一页讲成「飞花令与考试」（题目 / 模拟 / 正式都在这里）");
  chk(!/function renderEntryGate\(/.test(game),
    "**没有**一道整页的「集子闸」（renderEntryGate 已删）");
  chk(!/exam\.gathering/.test(game),
    "js/game.js 不再把 exam.gathering（旧的「集子访问」）当门槛");
  chk(/data-game-mode=/.test(game) && /data-locked="1"/.test(game),
    "放不放行由**玩法卡各自**标（锁定那一张写着门槛）");
  chk(!/data-game-close/.test(game),
    "没有 data-game-close 了（那颗「返回诗词列表」随整页闸一起删，不留死监听）");

  // 集子归 /library/：大会那一页不进课外阅读入口
  const libJs = read("js/library.js");
  chk(!/dahui/.test(libJs) && !/game/.test(libJs.replace(/game[\w-]*\s*[:=]\s*\{[^}]*\}/g, "")),
    "课外阅读入口 /library/ 里**不**收大会这一页（它没有集子）");
}

console.log("\n=== 4 · 老地址改道：/poems/?game=1 → /dahui/ ===");
{
  chk(/function redirectOldGameLink\(\)/.test(poemsJs), "js/poems.js 有 redirectOldGameLink()");
  chk(/\/\(\?:\^\|\[\?&\]\)game=1/.test(poemsJs), "只认 game=1 这一个参数");
  chk(/location\.replace\("\/dahui\/"\)/.test(poemsJs), "用 replace 跳（不留一条「回退又跳回来」的历史）");
  const boot = poemsJs.slice(poemsJs.indexOf("function boot()"), poemsJs.indexOf("if (document.readyState"));
  chk(/redirectOldGameLink\(\)/.test(boot), "boot() 头一件事就是改道（别先渲染一遍列表再跳）");
}

if (fails) {
  console.log("\n✗ 大会那一页的显示测试未通过（" + fails + " 项）");
  process.exit(1);
}
console.log("\n🎉 大会那一页的显示测试全部通过");
