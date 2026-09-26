"use strict";

// ---------------------------------------------------------------------------
// 顶栏右上那颗返回键：全站只有这一处，落点按「上一层是谁」分（Issue #370）
// ---------------------------------------------------------------------------
// 用户 2026-09-26 的一轮原话，逐条落：
//
//   「关于所有页面右上角的后退按钮，详情页的返回应该回到各自索引页」
//   「古诗词大会更多范围页面的 后退应该后退到古诗词大会首页」
//   「如果在背诵，课外，搜索，古诗词首页，我的页面，这 5 个有底部导航栏的
//     各自首页，右上角不应该再有后退按钮」
//   「设置页各项右上角返回应该返回到我的页面」（= 设置主页在「我的」底下）
//   「登录页各项返回应该返回到我的页面」
//
// 这一层是**纯源码断言**（不 jsdom、不起浏览器，与 `test/dock-nav.test.js`
// 同一套做法），钉住这回改的四件事：
//
//   1. 落点只有**一处**算：`js/chrome.js` 的 `pageBackHref()` +
//      `BACK_ROUTES` 那张表；`data-back` 仍优先；
//   2. 底栏五格那一层（`/` `/library/` `/dahui/` `/search/` `/mine/`）
//      **不摆**返回键（`topLevelPage()`）；
//   3. 一部集子、一张设置二级页、`/progress/` 的上一层都写在那张表里；
//   4. 大会那一页的回退由**顶栏那一颗**管（三层各一个落点），页内不再各摆一颗。
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

let fails = 0;
const chk = (c, m) => { if (!c) { console.log("✗ " + m); fails++; } else console.log("✓ " + m); };
const eq = (a, b, m) => chk(a === b, m + "（期望 " + JSON.stringify(b) + "，实际 " + JSON.stringify(a) + "）");

const chrome = read("js/chrome.js");
const game = read("js/game.js");
const app = read("js/app.js");

// 查「不再有某某老写法」时**先剥掉注释** —— 注释里正记着那些老写法为什么被换掉。
const bare = src => src
  .replace(/<!--[\s\S]*?-->/g, " ")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^\s*\/\/.*$/gm, " ");

// ---------------------------------------------------------------------------
console.log("=== 1 · 落点只有一处算：pageBackHref() + BACK_ROUTES 那张表 ===");
{
  chk(/function pageBackHref\(\)/.test(chrome), "chrome.js 有 pageBackHref()（顶栏那颗键的落点）");
  chk(/function pageBackRoute\(/.test(chrome), "有 pageBackRoute()：按路由推上一层");
  chk(/var BACK_ROUTES = \{/.test(chrome), "「上一层是谁」只有 BACK_ROUTES 一张表");

  // ① `data-back` 仍优先（页面对「上一层是谁」比 chrome 清楚）
  const fn = chrome.slice(chrome.indexOf("function pageBackHref()"), chrome.indexOf("function pageBackRoute("));
  chk(/bodyData\("back"\)/.test(fn) && fn.indexOf('bodyData("back")') < fn.indexOf("pageBackRoute("),
    "页面自己写的 `data-back` **先**判（它在表前面）");
  chk(/if \(route\) return route;/.test(fn), "表里有就按表走");
  chk(/if \(dockEnabled\(\)\) return routeHref\("mine"\);/.test(fn),
    "两处都落不下来才认底栏那一颗「我的」（兜底不再是「去首页」）");

  // ② 「详情页回各自索引页」：一部集子的上一层是课外阅读入口
  ["poems", "classic", "yuefu", "tangshi", "songci", "guwen", "zhaoming", "yuanqu",
    "jinxiandai", "chengyu", "changshi"].forEach(k => {
      chk(new RegExp("^\\s*" + k + ":\\s*routeHref\\(\"library\"\\)", "m").test(chrome),
        k + " 的上一层是 /library/（课外阅读入口）");
    });

  // ③ 设置：主页在「我的」底下，四张二级页在设置主页底下
  chk(/settings:\s*routeHref\("mine"\)/.test(chrome), "设置的上一层是 /mine/（用户：设置页返回我的）");
  ["general", "recite", "lists", "reader", "reports"].forEach(k => {
    chk(new RegExp('"settings/' + k + '":\\s*routeHref\\("settings"\\)').test(chrome),
      "设置 · " + k + " 的上一层是设置主页");
  });

  // ④ 登录页各项与其余几张「附在一页底下」的小页
  chk(/login:\s*routeHref\("mine"\)/.test(chrome), "登录页的上一层是 /mine/（用户：登录页返回我的）");
  chk(/progress:\s*ROUTES\.home/.test(chrome), "/progress/ 的上一层是首页（它在「我的」底下的入口）");
  chk(/"selfCheck":\s*"\/settings\/general\/"/.test(chrome) ||
    /selfCheck:\s*"\/settings\/general\/"/.test(chrome), "自检的上一层是设置 · 通用");
  chk(/plans:\s*routeHref\("settings"\)/.test(chrome), "用户对比的上一层是设置主页");
  chk(/terms:\s*ROUTES\.home/.test(chrome) && /privacy:\s*ROUTES\.home/.test(chrome),
    "用户协议 / 隐私条款的上一层是首页");

  // ⑤ 这些路由键**真的认得出来**（表里写了，pageKey() 也得给得出）
  // 源码里的正则写作 `/^\/settings\/general\/?$/`（`\/` 是转义的斜杠）——
  // 断言也照那个样子拼，免得把「转义写没写」也变成一条会漂的判据。
  ["settings/general", "settings/recite", "settings/lists", "settings/reader",
    "settings/reports", "self-check", "terms", "privacy"].forEach(seg => {
      var src = "/^\\/" + seg.replace("/", "\\/") + "\\/?$/";
      chk(chrome.indexOf(src) >= 0,
        "pageKey() 认得出 /" + seg + "/（那一条正则就写在 pageKey 里）");
    });
}

// ---------------------------------------------------------------------------
console.log("\n=== 2 · 底栏五格那一层不摆返回键（用户原话：这 5 个首页右上角不应该再有） ===");
{
  chk(/function topLevelPage\(\)/.test(chrome), "有 topLevelPage()：认「这是底栏五格那一层」");
  const t = chrome.slice(chrome.indexOf("function topLevelPage()"), chrome.indexOf("function pageBackHref()"));
  ["home", "library", "game", "search", "mine"].forEach(k => {
    chk(new RegExp('key === "' + k + '"').test(t), "五格之一 " + k + " 算「最上一层」");
  });

  // 两条分支（齿轮键 / 返回键）都挂了 `!topLevelPage()`
  const hh = chrome.slice(chrome.indexOf("function headerHtml("), chrome.indexOf("function firstActAnchor("));
  eq((hh.match(/!topLevelPage\(\)/g) || []).length, 2,
    "两颗键（设置齿轮 / 返回）都判 `!topLevelPage()`");
  chk(!/key !== "home"/.test(hh), "不再按「是不是首页」一条判（要判的是五格那一层）");

  // 「我的」页那颗齿轮还留着（它不在五格那一层里被撤 —— 它是「我的」自己的入口）
  chk(/data-top-action="settings"/.test(read("mine/index.html")), "「我的」页还是那个「设置」齿轮");
  chk(/pageTopAction\(\)/.test(chrome), "齿轮那条路（pageTopAction）还在");
}

// ---------------------------------------------------------------------------
console.log("\n=== 3 · 大会那一页：回退只有顶栏一颗，三层各一个落点（Issue #370） ===");
{
  chk(/data-back="\/dahui\/"/.test(read("dahui/index.html")),
    "大会那一页声明了 `data-back=\"/dahui\/\"`（它自己那一层）");

  // 「更多范围」这一层里那颗「返回」按钮撤掉
  chk(!/data-game-back="1">返回<\/button>/.test(game),
    "「更多范围」里不再有自己那颗「返回」按钮");

  // 顶栏那一颗跟着层走
  const pb = game.slice(game.indexOf("function paintBack()"), game.indexOf("function showList("));
  chk(/var inLayer = !!state\.mode;/.test(pb), "落点按「在不在首页那一层」分");
  chk(/"返回古诗词大会"/.test(pb), "在层里 → 回大会首页（用户：更多范围的后退回大会首页）");
  chk(/"返回诗词列表"/.test(pb), "在首页 → 退出这一页，回诗词列表");
  chk(/if \(inLayer\) \{ render\(\); return; \}/.test(pb), "在层里只换层、不退出这一页");
  chk(!/if \(standalone\(\)\) return;/.test(pb), "不再因为「独立页」整颗键不画（那样连退出的路都没了）");

  // 每一层重画时都跟上
  const renderFn = game.slice(game.indexOf("function render()"), game.indexOf("function startFly("));
  chk(/paintBack\(\);/.test(renderFn), "每次 render() 都重画那颗键（换一层就跟上）");
}

// ---------------------------------------------------------------------------
console.log("\n=== 4 · 首页详情那一层：开着就有返回键，收起就摘掉（Issue #370） ===");
{
  chk(/function paintModalBack\(\)/.test(app), "js/app.js 有 paintModalBack()");
  const openFn = app.slice(app.indexOf("function openPoem("), app.indexOf("function pinyinWidOf("));
  chk(/paintModalBack\(\);/.test(openFn), "详情铺开时挂上那颗键");
  const closeFn = app.slice(app.indexOf("function closeModal()"), app.indexOf("function syncBottomGap("));
  chk(/paintModalBack\(\);/.test(closeFn), "详情收起时把它摘掉");
  const pm = app.slice(app.indexOf("function paintModalBack()"), app.indexOf("function paintModalBack()") + 420);
  chk(/setPageAction\(\$\("#modal"\)\.hidden/.test(pm), "挂着 / 摘掉按 `#modal` 的 hidden 判");
  chk(/onclick: closeModal/.test(pm), "它的 onclick 就是 closeModal()（收起这一层）");
  chk(!/location\.href|history\.back/.test(bare(pm)),
    "**不写第二套历史**：不碰 location，也不调 history.back()");
}

// ---------------------------------------------------------------------------
console.log("\n=== 5 · 顺手修掉的真 bug：独立页上 close() 一动不动 ===");
{
  // standalone() 读的是 body[data-nav]，而 setDockNav("poems") 改的正是它 ——
  // 两句倒过来写，独立页上「退出去」那一支永远走不到。
  const closeFn = game.slice(game.indexOf("function close()"), game.indexOf("function paintHeader("));
  chk(/var onOwnPage = standalone\(\);/.test(closeFn),
    "close() 先把 standalone() 问一次、存下来");
  chk(closeFn.indexOf("standalone()") < closeFn.indexOf("setDockNav("),
    "`standalone()` 在 `setDockNav()` **之前**问（倒过来写它永远回 false）");
  chk(/if \(onOwnPage\) \{ location\.href = "\/poems\/"; return; \}/.test(closeFn),
    "确认是自己那一页 → 真退出去（回 /poems/）");
}

console.log("\n" + (fails ? "❌ " + fails + " 项失败" : "🎉 返回键落点测试全部通过"));
process.exit(fails ? 1 : 0);
