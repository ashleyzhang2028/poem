"use strict";

// ---------------------------------------------------------------------------
// 大会那一层掀开时，底下的诗词列表**必须真的看不见**（Issue #356）
// ---------------------------------------------------------------------------
// 用户 2026-09-26：
//   「现在古诗词大会首页显示的还是普通古诗词列表，再点还是详情页，
//     没看出来各种考试，模拟，答题什么的？」
//
// 根因不是「那一层没掀开」—— 它掀开了（`host.hidden = false` 确实生效），
// 是**底下那张列表根本没被藏住**：
//
//   · `#gw-list` 是 `.list`，`css/style.css` 里 `.list { display: flex }`
//     （1024px 起 `display: grid`）；
//   · 而 `hidden` 属性只在浏览器默认样式表里是一条 `[hidden] { display: none }`，
//     **输给**元素上的 `.list { display: ... }`；
//   · 于是 `viewEl.hidden = true` 看着设了、其实没藏住 —— 大会那一层铺在
//     237px 处，底下 14879px 的诗词列表照旧摊着，占满整屏。
//
// 所以这一层钉三件事（**纯源码断言**，不起浏览器）：
//
//   1. `.list` 有一条 `[hidden] { display: none }` 兜底（声明式，别处照旧压得住）；
//   2. 大会那层的容器一亮，底下的列表**在 CSS 里**也必须被压住
//      （老浏览器不支持 `:where()` 时的那条退路）；
//   3. `js/game.js` 掀开 / 收起走的是同一处 `showList()`，不再各写各的
//      `hidden = true / false`。
//
// ⚠️ 这一条**不是**「重复一遍浏览器的默认行为」：`.list` 自己有 display，
//    默认那条就压不住它。不加这一条，谁在 `.list` 上设 `hidden` 都会踩同一个坑。
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

let fails = 0;
const chk = (c, m) => { if (!c) { console.log("✗ " + m); fails++; } else console.log("✓ " + m); };
const has = (src, s, m) => chk(src.indexOf(s) >= 0, m);

const style = read("css/style.css");
const account = read("css/account.css");
const game = read("js/game.js");
const poemsHtml = read("poems/index.html");

console.log("\n=== 1 · `.list` 上的 `hidden` 真的藏得住 ===");
{
  // `.list` 自己的 display 就在这一条前面几行 —— 两处必须离得近、成对看
  has(style, ".list { display: flex; flex-direction: column; gap: 10px; }",
    "`.list` 有 display: flex（这就是默认那条 [hidden] 压不住它的原因）");
  chk(/\.list:where\(\[hidden\]\)\s*\{\s*display:\s*none;?\s*\}/.test(style),
    "`.list` 有一条 [hidden] 兜底：`.list:where([hidden]) { display: none }`");
  chk(/:where\(/.test(style.split(".list:where([hidden])")[0].split("\n").slice(-12).join("\n")),
    "那条用它 :where() —— 不占优先级（0,0,0），别处照旧压得住它");

  // `:where([hidden])` 之后的规则里不许再出现 `.list { display: ... }` 把它顶掉
  const after = style.split(".list:where([hidden])")[1] || "";
  chk(!/^\s*\.list\s*\{[^}]*display\s*:/m.test(after.slice(0, 400)),
    "紧跟着没有第二条 `.list { display: … }` 又把它顶回去");
}

console.log("\n=== 2 · 大会那层一亮，列表在 CSS 里就被压住（老浏览器的退路）===");
{
  has(account, '.poems-game:not([hidden]) ~ [data-poems-view="list"][hidden]',
    "account.css 有 `[data-poems-view=\"list\"][hidden]` 那条（书面名字）");
  has(account, ".poems-game:not([hidden]) ~ #gw-list[hidden]",
    "account.css 也有 `#gw-list[hidden]` 那条（它现在的 id）");
  chk(/display:\s*none\s*!important/.test(account.split("poems-game:not([hidden]) ~ #gw-list[hidden]")[1].slice(0, 120)),
    "两条都用 display: none !important 收口（不然又输给 .list 的 display）");

  // 选择器靠得住的前提：两个元素真是兄弟，而且次序是 game 在前、list 在后
  const g = poemsHtml.indexOf('data-poems-view="game"');
  const l = poemsHtml.indexOf('data-poems-view="list"');
  chk(g >= 0 && l >= 0, "poems/index.html 里那两个容器都在（game 与 list）");
  chk(l < g, "列表在**前**、大会那层在后 —— `~` 才选得中（次序反了这条规则就哑了）");
  chk(poemsHtml.slice(l - 200, l + 80).indexOf("class=\"list\"") >= 0,
    "列表那个容器就是 `.list`（与 style.css 那条对得上）");
}

console.log("\n=== 3 · 掀开 / 收起走同一处 showList() ===");
{
  chk(/function showList\(on\)/.test(game), "js/game.js 有 showList(on) 一处");
  chk(/viewEl\.removeAttribute\("hidden"\)/.test(game), "on 时 removeAttribute('hidden')（不是 = false）");
  chk(/viewEl\.setAttribute\("hidden", ""\)/.test(game), "off 时 setAttribute('hidden')（不是 = true —— 属性在不在是判据）");

  // 三处该管列表的地方都调它：open / close / renderEntryGate
  const calls = (game.match(/showList\((true|false)\)/g) || []).length;
  chk(calls >= 3, "open / close / renderEntryGate 三处都走 showList()（实际 " + calls + " 处）");
  // 注释里提到老写法是**允许的**（那正是它被换掉的原因），所以先把注释剥掉再断言
  const gameCode = game.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  chk(!/viewEl\.hidden\s*=/.test(gameCode), "不再有 `viewEl.hidden = …` 那种写法（两处各写一次就是坑）");

  // `isOpen()` 认的仍是 host.hidden，不是列表
  chk(/function isOpen\(\)\s*\{\s*return !!host && !host\.hidden;\s*\}/.test(game),
    "isOpen() 判的是大会那层自己（host.hidden），与列表无关");
}

if (fails) {
  console.log("\n✗ 大会那一层的显示测试未通过（" + fails + " 项）");
  process.exit(1);
}
console.log("\n🎉 大会那一层的显示测试全部通过");
