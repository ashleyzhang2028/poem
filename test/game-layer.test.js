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
  // ⚠️ 这一条 Issue #370 改过判据：独立页上「退出去」那一支从前写在
  //    `setDockNav("poems")` **之后**，而 `standalone()` 读的正是那个属性 ——
  //    于是它在独立页上永远回 false，那一支永远走不到（顶栏那颗「返回诗词列表」
  //    按下去一动不动）。现在先问一次、**再**改属性，判据也跟着改成
  //    「`standalone()` 在改属性之前被问过一次」。
  chk(/var onOwnPage = standalone\(\);/.test(gameCode) &&
    /if \(onOwnPage\) \{ location\.href = "\/poems\/"; return; \}/.test(gameCode),
    'close() 在独立页上是**退出去**（回 /poems/），不是「收起一层」');
  chk(gameCode.indexOf("standalone()") < gameCode.indexOf('setDockNav(onOwnPage'),
    "`standalone()` 在 `setDockNav()` **之前**问 —— 倒过来写它永远回 false（这是一个真 bug）");

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
  // ⚠️ 首页那两段的小标题（「范围」/「题型」，Issue #356 第九轮）是
  //    `<p class="poems-home-tag">` —— 不是 `.account-card-title`
  //    （那是卡**里面**的标题）。所以判据收窄成「题型那四张卡那一段里没有卡内标题」，
  //    而不是「整个 renderHome() 里不许出现这个类名」。
  // ⚠️ 截到「题型那一段结束」为止（`renderHome()` 那个 `return html;`）——
  //    往后截会把 `renderFly()` 那些卡**里面**的标题一并带进来，判据就变成了
  //    「整份文件里有没有卡内标题」，与这一条问的不是一回事。
  const homeRow = home.slice(home.indexOf('homeTag("题型")'), home.indexOf("return html;", home.indexOf('homeTag("题型")')));
  chk(!/account-card-title/.test(homeRow),
    "题型那一段不再有卡内标题（小标题是层与层之间的 `.poems-home-tag`，不是卡名）");

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

console.log("\n=== 3d · 首页两行：范围在上、题型在下、垂直居中偏上、集子范围真能出题 ===");
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
  const home = game.slice(game.indexOf("function renderHome"), game.indexOf("function scopeRows"));

  // ① 首页两段：**范围在上、题型在下**（第九轮把它定成这个次序）。
  chk(/homeTag\("题型"\)/.test(home), "首页下一段的小标题是「题型」");
  chk(/var html = scopeRows\(\);/.test(home),
    "范围那一段排在最前面（用户原话：「先显示范围，下面再显示题型」）");
  chk(home.indexOf("scopeRows()") < home.indexOf('homeTag("题型")'),
    "次序判据：scopeRows() 在 homeTag(\"题型\") **之前**");
  chk(/class="poems-home-row"/.test(home), "题型那四张装在一个 `.poems-home-row` 里（分栏只管那一行）");
  chk(/var scopeRows = /.test(game) || /function scopeRows\(\)/.test(game), "范围那一段由 scopeRows() 画");

  // ② 名单**不另列一份**：都从 Exam.scopes()（→ SITE_BOOKS）现算。
  chk(!/var FEATURED = \[/.test(game),
    "`FEATURED`（哪几部进首页那张次序表）已删 —— 范围一个不少、全在首页");
  chk(!/MORE_HINT/.test(game), "`MORE_HINT` 也删了（没有「更多范围」那一层可提示）");
  chk(/scopeList\(\)/.test(home) || /scopeList\(\)/.test(game),
    "范围读 scopeList()（→ Exam.scopes() → SITE_BOOKS）");

  // ③ 分组与次序：**在 js/exam.js 一处**（不许在页面里再写一份中文名）。
  const exam = read("js/exam.js");
  chk(/var SCOPES_GROUPS = \["全部", "课内诗词", "其他集子"\]/.test(exam),
    "三块的名字在 `js/exam.js` 一处（SCOPES_GROUPS）");
  chk(/function scopeGroupOf\(scopeId\)/.test(exam), "分块规则也在那里（scopeGroupOf()，判 id 不按名字猜）");
  // ⚠️ 剥掉注释再判：那一节的注释里写着 `SCOPES_GROUPS` 这个字面量。
  const gameLiveD = game.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  chk(!/SCOPES_GROUPS/.test(gameLiveD.replace(/Ex\.SCOPES_GROUPS/g, "")),
    "页面**不另写**那三个中文名（一律经 Ex.SCOPES_GROUPS）");
  chk(/Ex\.scopeGroupOf\(sc\.id\)/.test(game), "页面按 Ex.scopeGroupOf() 分块");

  // ④ 范围**不再问第二遍**：选过的那几格，卷面设置里只念一遍。
  chk(/scopeChosen/.test(game), "`state.setup.scopeChosen` 记「范围是不是用户挑的」");
  chk(/function pickScope\(\)/.test(game), "有 pickScope()：把多选的格子折成一个 scope 交给内核");
  chk(/function scopePickLabel\(/.test(game), "有 scopePickLabel()：那一行把 id 念成人话（含多选合成 id）");
  const start = game.slice(game.indexOf("function start(modeId)"), game.indexOf("function beginExam"));
  chk(/scopeChosen \? state\.setup\.scope : "all"/.test(start),
    "start() **不把范围归零**（用户刚选的那几格要带到卷面设置去）");
  chk(!/id="game-scope"/.test(game),
    "卷面设置里那个 `#game-scope` 下拉**删了**（范围在首页选，不问第二遍）");
  chk(!/function readSetup\(/.test(game), "readSetup()（读那个下拉的）整条删了");

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
  const corpus = game.slice(game.indexOf("function corpus()"),
    game.indexOf("// 展开一条的正文"));
  chk(/function expand\(p, book\)/.test(game), "有 expand()：textRef → data/text-master.js 那一份正文");
  chk(/window\.masterTextOf/.test(game), "expand() 调的是 window.masterTextOf（与 data/index.js 同一句）");
  chk(/expand\(p, "poems"\)/.test(corpus) && /expand\(p, w\.id\)/.test(corpus),
    "corpus() 里课内与集子**都**过 expand()（从前集子那一半没过，于是正文是空的）");
}

console.log("\n=== 3e · 范围并进首页：一行一块的清单、加减号、可多选、题型在下面 ===");
{
  // 用户 2026-09-26 **第九轮**原话，这就是这一节的全部目标：
  //   「要不还是合并范围和更多范围内容到古诗词大会的首页吧。」
  //   「先显示范围，下面再显示题型和题型的田字格卡片。」
  //   「范围用类似搜索的下拉框那种展现形式(直接每一行显示出来，不是下拉框)，
  //     前面有个加号或减号，供用户多选。」
  //   「这样设计，用户先多选范围，再按题型直接进入。」
  //
  // 第八轮那几条（小标题收成两个词、「更多范围」第四张卡、那一层重排）在这一轮
  // **作废了两条**：「更多范围」那一张卡与那一层都不存在了（并进了首页）。
  // 但「小标题只许一个词」「那句『留一份练习记录』删掉」照旧守着。
  const accountCss = read("css/account.css");
  const exam = read("js/exam.js");
  // ⚠️ 判「某句话还在不在**界面上**」必须剥掉注释再判：这几句老文案在**历史注释**里
  //    被引用了（「用户原话是……」），拿带注释的原文去判会永远为真 —— 这是 3b 节
  //    第一次写时踩过的同一个坑。
  const gameLive = game.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  const cssLive = accountCss.replace(/\/\*[\s\S]*?\*\//g, " ");

  // ① 小标题**就是一个词**，且两段的次序是「范围」在前。
  chk(!/同一份语料，四种玩法/.test(gameLive),
    "「同一份语料，四种玩法；想换书的请看下一行」整句删掉（用户原话：不要加任何其他废话）");
  chk(!/只考一部，或点上面的玩法考全部/.test(gameLive),
    "「只考一部，或点上面的玩法考全部」整句删掉（用户原话：不要任何其他废话）");
  const tagFn = game.slice(game.indexOf("  function homeTag("), game.indexOf("\n  }\n", game.indexOf("  function homeTag(")) + 4);
  chk(/function homeTag\(title\)/.test(tagFn), "homeTag() 只收一个标题（不再有第二个「说明」参数）");
  chk(!/poems-home-tag-name|poems-home-tag-note/.test(gameLive),
    "两个 span（名字 / 说明）连同它们的类名一起删了");
  chk(!/poems-home-tag-name|poems-home-tag-note/.test(cssLive),
    "CSS 里也不留这两个用不到的类名（留着下次就会有人往里塞第二句话）");
  chk(/<p class="poems-home-tag">范围<\/p>/.test(game),
    "那一段的小标题就是「范围」两个字");

  // ② 「删除 ，留一份练习记录」—— 模拟考试那句说明里的尾巴（照旧守着）。
  chk(!/留一份练习记录/.test(exam),
    "模拟考试的 desc 里不再有「留一份练习记录」（用户原话：删除）");
  chk(/desc: "抽一套卷子当场做，答完立刻说对错"/.test(exam),
    "那句现在是「抽一套卷子当场做，答完立刻说对错」");
  chk(!/留一份练习记录/.test(game) && !/留一份练习记录/.test(accountCss),
    "「留一份练习记录」在这个页面的任何角落都不再出现");

  // ③ 「更多范围」那一张卡与那一层**都没了** —— 并进了首页。
  chk(!/data-game-scopes/.test(gameLive), "「更多范围」那颗键（data-game-scopes）整条删了");
  chk(!/game-scope-more/.test(gameLive) && !/game-scope-more/.test(cssLive),
    "`.game-scope-more` 那个类名连 CSS 一起删了");
  chk(!/renderScopes/.test(gameLive), "renderScopes()（那一层）整个函数删了");
  chk(!/"scopes"/.test(gameLive), '`render()` 里那个 `"scopes"` 层名也删了（没有第二层可去）');
  chk(!/回到玩法/.test(gameLive), "「回到玩法」这个名字一个字不留");
  chk(!/换一部书/.test(gameLive), "「换一部书」也随那一层一起改了（现在是「换范围」）");
  chk(/data-game-scope-fold/.test(game), "一块范围的头带 `data-game-scope-fold`（点它收放这一块）");
  chk(/data-game-scope-all/.test(game), "段头另有一颗「收起 / 展开」（一块、一整片都能一键收放）");

  // ④ 一行一块的清单：**前头一个加号或减号**，加减号由 CSS 画。
  chk(/class="game-scope-sign" aria-hidden="true"/.test(game),
    "每块行头最前面有个 `.game-scope-sign`（加号 / 减号那个方块）");
  chk(/\.game-scope-sign::before,[\s\S]*?\.game-scope-sign::after \{/.test(accountCss) ||
      /\.game-scope-sign::before,[\s\S]*?content: ""/.test(accountCss),
    "加号 / 减号是 CSS 画的（两条线，不是一个 ± 字面量进 DOM）");
  chk(/\.game-scope-row\[data-folded="1"\] \.game-scope-sign::after \{ opacity: 1; \}/.test(accountCss),
    "收起时才画竖线（两条线都在 = 加号）；展开态只剩横线 = 减号");
  chk(!/±/.test(gameLive), "页面上不出现「±」这个字形（由 CSS 画）");

  // ⑤ 清单**默认展开**（用户原话「直接每一行显示出来」）。
  chk(/scopeOpen: true/.test(game), "`state.scopeOpen` 默认 **true** —— 一进页面就把名目摆出来");
  chk(!/<select/.test(gameLive), "**不是** `<select>` 下拉（用户紧接着补了一句「不是下拉框」）");

  // ⑥ **可多选**：格子是按钮，选中态落在 JS 的状态上。
  chk(/state: \(\) => state/.test(game) || /state: function \(\) \{ return state; \}/.test(game),
    "状态有出口（`PoemGame.state()`），多选状态在 `state.scopes` 上");
  chk(/scopes: \[\]/.test(game), "`state.scopes` 是选中的范围 id（`[]` = 一格没选 = 全部）");
  chk(/var at = state\.scopes\.indexOf\(sid\);/.test(game) &&
      /state\.scopes\.push\(sid\)/.test(game) && /state\.scopes\.splice\(at, 1\)/.test(game),
    "点一格翻一格（有就删、没有就加）—— 这就是「多选」那一条");
  chk(/data-on="1" aria-pressed="true"/.test(game), "选中的格子带 `data-on=\"1\"`（多选是**就地**上色，不换层）");
  chk(/\.game-scope-pick\[data-on="1"\] \{/.test(accountCss),
    "选中态有样式（`.game-scope-pick[data-on=\"1\"]`）");
  chk(!/type="checkbox"/.test(game), "不拿原生复选框当多选（整块格子本身就是那颗键）");

  // ⑦ 多选折成一个 scope：**合成 id 由内核认**（口径只有一处）。
  chk(/function pickScope\(\)/.test(game), "有 pickScope()：多选 → 一个 scope");
  chk(/if \(!on\.length\) return "all";/.test(game), "一格没选 → `all`（什么都考）");
  chk(/if \(on\.indexOf\("all"\) >= 0\) return "all";/.test(game), "选了「全部」那一格 → `all`");
  chk(/if \(on\.length === 1\) return on\[0\];/.test(game), "只选一格 → 就是它（老口径照旧）");
  chk(/return "pick:" \+ on\.join\("\+"\);/.test(game), "选多格 → `pick:<id>+<id>` 合成写法");
  chk(/id\.indexOf\("pick:"\) === 0/.test(exam),
    "内核（js/exam.js 的 select()）认得 `pick:` 这一支 —— 取谁只在这一处判");
  chk(/select\(cps, one\)\.forEach/.test(exam),
    "多选是**并集**（逐格取、再按 id 去重，同一篇不会出两次）");
  chk(/var SCOPES_HIDDEN = \{ "book:poems": 1 \}/.test(exam),
    "`book:poems` 不上首页那一层（它与课内三学段是同一份语料的两种切法，摆两遍是重复）");

  // ⑧ 挑完范围接着点题型**直接进**（用户原话：「再按题型直接进入」）。
  chk(/var scope = pickScope\(\);/.test(game) && /state\.setup\.scope = scope;/.test(game),
    "点题型那一支先把多选折成 scope 落进 setup，再 start()");
  chk(/state\.setup\.scopeChosen = scope !== "all";/.test(game),
    "`scopeChosen` 跟着这个 scope 走（不是 all 才算挑过）");

  // ⑨ 那一层的版式：格子是 grid、一行两张、两张等宽。
  chk(/\.game-scope-grid \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/.test(accountCss),
    "格子是 grid 一行两张、两张等宽（minmax 里的 0 防长名字撑破）");
  chk(/\.poems-game > \.game-back \{[\s\S]*?width: auto/.test(accountCss),
    "飞花令 / 卷面设置 / 考试那三层顶上那颗回退键宽度 auto（不是 `.account-btn` 默认的通栏）");
  chk(!/game-scopes-notice/.test(cssLive), "那一层那句 notice 的样式也随层一起删了");
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
