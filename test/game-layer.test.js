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
  // ⚠️ 页头那一句「这一页是飞花令与考试 —— 题目、模拟、正式考试都在这里……」
  //    与页底那张「诚实说明」（题目与答案一起发给浏览器、不是防作弊……）
  //    已按用户 2026-09-26 的第二轮原话**整段删掉**（「下面全部删除」/「删除
  //    这一页是飞花令与考试……」）。这一页上不再摆任何说明卡。
  chk(!/这一页是<strong>飞花令与考试<\/strong>/.test(game),
    "页头那张「这一页是飞花令与考试……」说明卡已删（用户原话：删除）");
  chk(!/<h2 class="account-card-title">这一页的诚实说明<\/h2>/.test(game),
    "页底那张「这一页的诚实说明」卡已删（用户原话：下面全部删除）");
  chk(!/不是防作弊|不是古诗词水平评估/.test(game),
    "「诚实说明」那段话一个字都不留（连同「不是防作弊」「不是水平评估」）");
  chk(!/function renderEntryGate\(/.test(game),
    "**没有**一道整页的「集子闸」（renderEntryGate 已删）");
  chk(!/exam\.gathering/.test(game),
    "js/game.js 不再把 exam.gathering（旧的「集子访问」）当门槛");
  chk(/data-game-mode=/.test(game) && /data-locked="1"/.test(game),
    "放不放行由**玩法卡各自**标（锁定那一张写着门槛）");
  chk(!/data-game-close/.test(game),
    "没有 data-game-close 了（那颗「返回诗词列表」随整页闸一起删，不留死监听）");

  // ⚠️ 未登录时**页底只有一颗登录键，不另开卡片**（用户 2026-09-26 原话：
  //    「如果需要登录，页底只显示那个登录 按钮即可，不要额外一张卡片，
  //      然后卡片里只有一个 登录 按钮」）。
  //    那一颗键是**玩法那张卡的最后一个孩子**，页面上不许再出现第二张卡。
  const home = game.slice(game.indexOf("function renderHome"), game.indexOf("function renderFly"));
  chk(!/gateCard/.test(game),
    "gateCard() 整个函数已删（「怎么用上」那张卡随它一起删，不留死代码）");
  chk(!/game-gate/.test(read("css/account.css")),
    "`.game-gate` 那两条样式也随它一起删（没有元素再用这两个类名）");
  chk(!/怎么用上/.test(home), "页面上不再有「怎么用上」这张卡");
  chk(!/用邮箱建一个账号/.test(home),
    "「用邮箱建一个账号」那颗键不再出现在这一页（游客也只给「登录」一颗）");
  chk(/if \(!id\.signedIn\) \{\s*html \+= '<button class="account-btn" type="button" data-game-go="\/login\/">登录<\/button>';/.test(home),
    "未登录时页底只加一颗「登录」键，**不开新卡片**");
  chk((home.match(/<section class="account-card">/g) || []).length === 1,
    "首页只渲染**一张**卡片（玩法那几张是同一条里循环出来的）");

  // 集子归 /library/：大会那一页不进课外阅读入口
  const libJs = read("js/library.js");
  chk(!/dahui/.test(libJs) && !/game/.test(libJs.replace(/game[\w-]*\s*[:=]\s*\{[^}]*\}/g, "")),
    "课外阅读入口 /library/ 里**不**收大会这一页（它没有集子）");
}

console.log("\n=== 3c · 大会那一页的卡片之间要有缝（Issue #356）===");
{
  // 用户 2026-09-26 原话：「这个页面的其他卡片之间需要间隔，不能一点空没有」。
  // 真机量过（修前）：四张卡严丝合缝 —— 一张卡的下边缘与下一张卡的上边缘
  // **是同一个像素**（197 / 578 / 718…）。根子与登录 / 后台那几页同源
  // （Issue #319）：`.account-card` 自己没有外边距，一页好几张卡靠的是父层
  // 的 `gap`，而 `.poems-game` 不是 `.account-page`，于是缝是 0。
  const accountCss = read("css/account.css");
  const block = accountCss.slice(accountCss.indexOf(".poems-game {", accountCss.indexOf(".poems-game[hidden]")));
  chk(/display:\s*flex/.test(block) && /flex-direction:\s*column/.test(block) && /gap:\s*12px/.test(block),
    "`.poems-game` 自己是一条 flex 纵列 + gap: 12px（与 .account-page 同一个数，不另立一套）");
  chk(!/\.account-card\s*\{[^}]*margin-bottom/.test(accountCss.slice(accountCss.indexOf(".account-card {"))),
    "没有回头去给 `.account-card` 加外边距（那条路 Issue #319 已裁定为「卡片之间缝是 0」的根子）");
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
