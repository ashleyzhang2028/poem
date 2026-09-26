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
  //    那一颗键是**这一层里的兄弟**（不再是某张卡里的最后一个孩子 —— 见下一节）。
  // ⚠️ 剥掉注释再判（那一节的注释里就写着 `<section class=\"account-card\">` 这个字面量，
  //    拿带注释的原文去判「还有没有」会永远为真 —— 这是本节第一次写时踩的坑）。
  const home = game.slice(game.indexOf("function renderHome"), game.indexOf("function tierText"))
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  chk(!/gateCard/.test(game),
    "gateCard() 整个函数已删（「怎么用上」那张卡随它一起删，不留死代码）");
  chk(!/game-gate/.test(read("css/account.css")),
    "`.game-gate` 那两条样式也随它一起删（没有元素再用这两个类名）");
  chk(!/怎么用上/.test(home), "页面上不再有「怎么用上」这张卡");
  chk(!/用邮箱建一个账号/.test(home),
    "「用邮箱建一个账号」那颗键不再出现在这一页（游客也只给「登录」一颗）");
  chk(/if \(!id\.signedIn\) \{\s*html \+= '<button class="account-btn" type="button" data-game-go="\/login\/">登录<\/button>';/.test(home),
    "未登录时页底只加一颗「登录」键，**不开新卡片**");
  chk(!/<section class="account-card">/.test(home),
    "首页不再渲染「一张围着四颗按钮的卡」（四颗按钮**各自**就是一张卡）");
  chk(!/<section class="game-modes"/.test(home),
    "也没有一层「装四张卡」的外套（那一层在 CSS 上就是 .poems-game 自己）");

  // 集子归 /library/：大会那一页不进课外阅读入口
  const libJs = read("js/library.js");
  chk(!/dahui/.test(libJs) && !/game/.test(libJs.replace(/game[\w-]*\s*[:=]\s*\{[^}]*\}/g, "")),
    "课外阅读入口 /library/ 里**不**收大会这一页（它没有集子）");
}

console.log("\n=== 3c · 四张玩法卡：各自一张、一行两张、与「每日背诵」的标题同一个口径 ===");
{
  // 用户 2026-09-26 第二轮原话，这就是这一节的全部目标：
  //   「飞花令四种玩法各自一个卡片」
  //   「各个玩法标题字体，大小，颜色等等是不是应该和每日背诵页面的那些卡片标题一致？」
  //   「pro 登录可用，直接改成 Pro 可用 和 Max 可用」
  //   「你看看可不可以手机屏幕中 一行显示两个卡片，这样就是田字格四个卡片」
  //   「登录按钮和卡片要有 gap 间隔，而不是完全没有 margin」
  const accountCss = read("css/account.css");
  const styleCss = read("css/style.css");
  const home = game.slice(game.indexOf("function renderHome"), game.indexOf("function tierText"));
  // ⚠️ tierText() 排在 renderFly() **后面** —— 截到 renderFly 会得到一个空串，
  //    于是「有没有那句」永远为假。截到下一个函数（renderPaper）为止。
  const tier = game.slice(game.indexOf("function tierText"), game.indexOf("\n  }\n", game.indexOf("function tierText")) + 4);

  // ① 四种玩法各自一张卡：一颗按钮同时是 `.account-card`（卡片外观）与
  //    `.game-mode`（能点的键）—— 两套外观各写一次，不再互相套着。
  chk(/class="account-card game-mode"/.test(home),
    "四个玩法**各自是一张卡**（同一颗按钮既是 .account-card 又是 .game-mode）");
  chk(!/game-mode-main/.test(game),
    "「选一个玩法」那张外套卡整个撤掉（连着它那个 .game-mode-main 也让位了）");
  // ⚠️ 首页现在**多了一行小标题**（「考哪一类题」/「考哪一部书」，Issue #356
  //    第七轮），它是 `<p class="poems-home-tag">` —— 不是 `.account-card-title`
  //    （那是卡**里面**的标题）。所以判据收窄成「玩法卡那一行里没有卡内标题」，
  //    而不是「整个 renderHome() 里不许出现这个类名」。
  const homeRow = home.slice(home.indexOf("poems-home-row"), home.indexOf("考哪一部书"));
  chk(!/account-card-title/.test(homeRow),
    "玩法那一行不再有卡内标题（小标题是层与层之间的 `.poems-home-tag`，不是卡名）");

  // ② 标题与「每日背诵」页（/settings/recite/ 的今日加背清单）逐字同档。
  //    ⚠️ 判据写成**两边同数**：任一边单独改动都会红。
  // ⚠️ 上一轮这里判的是「玩法标题与每日背诵**逐字同数**」；这一轮用户把问题
  //    问回去了：「你也没按照首页古诗列表卡片里的字体和样式来啊？」——
  //    他比的是**首页列表的篇目标题**（17px / 700 / 宋体），不是「每日背诵」。
  //    所以判据换成「三处的数字都出自 `:root` 那两条 token」，而不是
  //    「某两处写着一模一样的字」：写死的数字从三份收成一份。
  const rootRule = styleCss.slice(styleCss.indexOf("--title-1:"));
  chk(/--title-1:\s*700 17px\/1\.5 var\(--font-poem\)/.test(rootRule),
    "`--title-1`（列表 / 卡片那一档）是 700 17px 宋体 —— 首页与诗词页的篇目就是它");
  chk(/--title-2:\s*600 14\.5px\/1\.4 var\(--font-ui\)/.test(rootRule),
    "`--title-2`（密集清单那一档）是 600 14.5px 黑体");
  chk(!/font-size:\s*17px/.test(styleCss.slice(styleCss.indexOf(".settings-group-title,"), styleCss.indexOf(".settings-group-title,") + 400)),
    "`.item-title` 那一组不再自己写 17px（数字只在 `--title-1` 一处）");
  // ⚠️ 从**规则体那一处**起算（`.daily-row .daily-title {` 这个字面量在
  //    `:root` 那段注释里也出现过 —— 拿 `indexOf(".daily-row .daily-title")`
  //    起算会切到注释里，`}` 也就在注释里，永远判不出真话来）。
  const dailyRule = styleCss.slice(styleCss.indexOf("\n.daily-row .daily-title {"));
  chk(/font:\s*var\(--title-2\)/.test(dailyRule.slice(0, dailyRule.indexOf("}"))),
    "「每日背诵」的标题走 `--title-2`（不再自己写第二份数字）");
  const nameRule = accountCss.slice(accountCss.indexOf("\n.game-mode-name {"));
  chk(/font:\s*var\(--title-2\)/.test(nameRule.slice(0, nameRule.indexOf("}"))),
    "玩法标题也走 `--title-2`（同一格，不是硬抄别处的字）");
  chk(/color:\s*var\(--ink\)/.test(nameRule.slice(0, nameRule.indexOf("}"))), "颜色 var(--ink)");

  // ③ 门槛小标：「Pro 可用」/「Max 可用」，放行的说层级名字。
  chk(/function tierText\(m, r\)/.test(game), "门槛文案收在 tierText() 一处");
  chk(/if \(r\.ok\) return Ent\.tierLabel\(m\.tier\)/.test(tier),
    "放行时只说层级名字（「Pro」/「Max」）");
  chk(/\+ " 可用"/.test(tier) && /tierLabel\(r\.minTier/.test(tier),
    "拦住时说「X 可用」，层级取自**能力本身** r.minTier（不是玩法表里那个字面量）");
  chk(/Ent\.denyReason\(m\.cap/.test(tier),
    "「登录可用」那句照抄 denyReason()（一句话的出处只有一处，页面不自造）");
  chk(/"登录可用"/.test(tier) && !/登录可用" \+/.test(tier),
    "没登录时说「登录可用」（一处只念一件事，不再叠成「Pro · 登录可用」）");
  chk(!/Ent\.tierLabel\(m\.tier\) \+/.test(home),
    "玩法卡不再把「层级」与「拒绝原因」拼在一行里");

  // ④ 手机竖屏一行两张卡（田字格）。
  chk(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/.test(accountCss),
    "一行两张卡（repeat(2, minmax(0, 1fr))）—— minmax 里的 0 是防长句撑破格子");
  // ⚠️ 判据用 `:has(.game-mode)`（**后代**）而不是 `:has(> .game-mode)`
  //    （直接子）：玩法卡现在装在 `.poems-home-row` 里（首页两行各一个），
  //    「直接子」那一问永远为假 —— 这一层于是既分不了栏、也居不了中。
  chk(/\.poems-game:has\(\.game-mode\)/.test(accountCss),
    "分列的判据取 `:has(.game-mode)`（后代）：有玩法卡才分栏，别的层自然落回一列");
  chk(!/\.poems-game:has\(> \.game-mode\)/.test(accountCss),
    "**没有** `:has(> .game-mode)` 那种直接子写法（卡在 .poems-home-row 里，那样写永远不命中）");
  chk(!/max-width:\s*768px[\s\S]{0,300}grid-template-columns/.test(accountCss),
    "不按设备类型 / 屏宽分栏（横屏放得下就该还是两张）");

  // ⑤「登录」那颗键与卡片之间留缝：缝只由父层的 gap 一处给。
  chk(/grid-column:\s*1 \/ -1/.test(accountCss),
    "「登录」那颗键跨满一行（它是底下一颗通栏的键，不是第三张卡）");
  const gapRule = accountCss.slice(accountCss.indexOf(".poems-game {"), accountCss.indexOf(".poems-game:has"));
  chk(/display:\s*flex/.test(gapRule) && /gap:\s*12px/.test(gapRule),
    "`.poems-game` 是 flex 纵列 + gap: 12px（卡片之间、卡片与登录键之间都是这一条）");
  // `.game-mode` 那条规则体里**不许有 margin** —— 缝只由父层的 gap 一处给。
  // ⚠️ 只查 `.game-mode` 自己这一条，不查它里面两个孩子（`.game-mode-desc` 的
  //    `margin-top: 4px` 是卡**里面**的间距、`.game-mode-tier` 的 `margin-top: auto`
  //    是把门槛那行顶到卡底 —— 都不是「卡片之间那条缝」）。
  // 从**规则体**那一处起算（`.game-mode {` 这个字面量在注释里也出现过一次）。
  const modeRule = accountCss.slice(accountCss.indexOf("\n.game-mode {"), accountCss.indexOf("\n}", accountCss.indexOf("\n.game-mode {")));
  chk(!/margin/.test(modeRule),
    "`.game-mode` 自己不带 margin（缝只有父层 gap 一处 —— 从前那条 margin-bottom " +
    "让「卡内按钮之间」有缝、「卡底按钮与卡片边缘」没缝）");
}

console.log("\n=== 3d · 首页两行卡：题型与范围并列、垂直居中偏上、集子范围真能出题 ===");
{
  // 用户 2026-09-26 第七轮原话，这就是这一节的全部目标：
  //   「飞花令四张卡片标题字体，样式，大小，颜色 你也没按照首页古诗列表卡片里的
  //     字体和样式来啊？」
  //   「四卡片和登录按钮 在页面中垂直居中，或者稍微偏上一些」
  //   「登录可用 改成 Pro 可用，Max 可用，按用户对比里的权限设置来」
  //   「这四张卡片目前是按题型来的，我记得还有按范围来的，例如只考唐诗三百首，
  //     只考文学常识，只考成语故事，你觉得应该怎么组织合适？还是在点击四张
  //     卡片后再设置范围？」
  const accountCss = read("css/account.css");
  const home = game.slice(game.indexOf("function renderHome"), game.indexOf("function homeTag"));

  // ① 首页两行：题型一行、范围一行，各由 `.poems-home-row` 装着。
  chk(/homeTag\("考哪一类题"/.test(home), "首页上一行的小标题是「考哪一类题」");
  chk(/homeTag\("考哪一部书"/.test(home), "首页下一行的小标题是「考哪一部书」");
  chk(/class="poems-home-row"/.test(home), "两行各装在一个 `.poems-home-row` 里（分栏只管一行）");
  chk(/data-game-scope=/.test(home), "范围卡带 `data-game-scope`（不是 data-game-mode）");
  chk(/data-game-scopes="1"/.test(home), "有「更多范围」那颗通栏键");

  // ② 首页那三张范围卡**不在这里另列名单**：名字与条数全从 Exam.scopes() 现算。
  chk(/var FEATURED = \[/.test(game), "首页那三部由 `FEATURED` 一张次序表点出来");
  const feat = game.slice(game.indexOf("var FEATURED"), game.indexOf("];", game.indexOf("var FEATURED")));
  chk(/book:tangshi/.test(feat) && /book:changshi/.test(feat) && /book:chengyu/.test(feat),
    "FEATURED 里是用户点名的那三部（唐诗 / 文学常识 / 成语故事）");
  chk(!/name:\s*"/.test(feat), "FEATURED 里**不写名字**（名字从 SITE_BOOKS 现算，不另列一份）");
  chk(/scopeList\(\)/.test(home), "首页那一行读 scopeList()（→ Exam.scopes() → SITE_BOOKS）");

  // ③ 「更多范围」那一层：全部 / 课内三学段 / 其余集子，一个不少。
  chk(/function renderScopes\(\)/.test(game), "有 renderScopes() 那一层");
  chk(/state\.mode === "scopes"/.test(game), "render() 认 `scopes` 这个层名");
  chk(/scopeGroup\("整个语料"/.test(game) && /scopeGroup\("课内诗词按学段"/.test(game) &&
      /scopeGroup\("其他集子"/.test(game),
    "那一层分三组：整个语料 / 课内诗词按学段 / 其他集子");
  chk(/sc\.id === "all"/.test(game) && /indexOf\("poems:"\) === 0/.test(game),
    "分组按 id 判（all / poems: / 其余集子），不按名字猜");

  // ④ 范围**不再问第二遍**：选过的那一部，卷面设置里只念一遍。
  chk(/scopeChosen/.test(game), "`state.setup.scopeChosen` 记「范围是不是用户挑的」");
  chk(/var chosen = state\.setup\.scope && state\.setup\.scope !== "all";/.test(game),
    "范围不是默认的「全部」时，卷面设置里不再摆那个下拉");
  chk(/换一部书/.test(game), "改写：那一张卡给一颗「换一部书」回首页/更多范围");
  const start = game.slice(game.indexOf("function start(modeId)"), game.indexOf("function beginExam"));
  chk(/scopeChosen \? state\.setup\.scope : "all"/.test(start),
    "start() **不把范围归零**（用户刚选的那一部要带到卷面设置去）");

  // ⑤ 垂直居中偏上：两条 `flex-grow` 按 1 : 2 分余量。
  chk(/min-height: calc\(100 \* var\(--app-vh\) - var\(--nav-h\) - 96px\)/.test(accountCss),
    "首页那一层按**可视区**给 min-height（--app-vh 减真实底栏 --nav-h）");
  chk(/\.poems-game:has\(\.game-mode\)::before \{ flex-grow: 1; \}/.test(accountCss) &&
      /\.poems-game:has\(\.game-mode\)::after \{ flex-grow: 2; \}/.test(accountCss),
    "上 1 : 下 2 两条空行 —— 整块因此落在偏上三分之一处，不是正中间");
  chk(/justify-content: center/.test(accountCss.slice(accountCss.indexOf("min-height: calc(100 * var(--app-vh) - var(--nav-h) - 96px)"), accountCss.indexOf("min-height: calc(100 * var(--app-vh) - var(--nav-h) - 96px)") + 200)),
    "那一层同时 justify-content: center（居中由这一条收口）");

  // ⑥ **真 bug**：`corpus()` 从前不展开正文 —— 集子那几部上出 0 题。
  //    真机量过（修前）：`Exam.build(corpus, {scope:'book:tangshi'})` → 0 题。
  //    这里判「修的那一句在不在」：`corpus()` 必须过一遍 `masterTextOf`。
  // ⚠️ `expand()` 排在 `corpus()` **后面**（函数声明抬升，调用没问题）——
  //    截到 `function expand(` 会得到一个空的语料函数体。截到它的**注释头**为止。
  const corpus = game.slice(game.indexOf("function corpus()"),
    game.indexOf("// 展开一条的正文"));
  chk(/function expand\(p, book\)/.test(game), "有 expand()：textRef → data/text-master.js 那一份正文");
  chk(/window\.masterTextOf/.test(game), "expand() 调的是 window.masterTextOf（与 data/index.js 同一句）");
  chk(/expand\(p, "poems"\)/.test(corpus) && /expand\(p, w\.id\)/.test(corpus),
    "corpus() 里课内与集子**都**过 expand()（从前集子那一半没过，于是正文是空的）");
  chk(/if \(!m && book\) m = map\(\).*\n?/.test(game) || /masterTextOf\(p, book\)/.test(game),
    "主表查不到时原样返回（不猜、不塞空串）");
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
