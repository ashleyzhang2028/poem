"use strict";

// ============================================================================
// 「页面归位 + 文案精简」这一轮的守卫（2026-09-21 · Issue #278）
//
// 用户原话：
//   ①「再次梳理所有页面，特别是我的页面，登录各页，自己设置各页，看看哪些
//      分类需要梳理，哪些应该放到我的却放到了设置，等等，请改进」
//   ②「在这些页面中，再次检查各项用户提示，能省则省，能删则删，不要废话太多，
//      不要婆婆妈妈，永远保持简洁，清晰，明了。」
//
// 这一层只守**这一轮定下来的四条**（别的口径各自的守卫在各自那一层里）：
//
//   一、「账号」与「跨设备同步」是「我是谁 / 我的数据」，**只在「我的」页上**，
//       设置那一侧不许有第二份（两份的下场就是改了一处、显示另一处 ——
//       2026-09-20 那次「同一把键两个孩子的分家口径」正是这么炸的）。
//   二、每一件**同一件事**只有一个入口：「用户对比」在一处、法务在一处。
//   三、选中态自己就是当前值 —— 不再在控件下面再回显一行「当前：…」。
//   四、讲「另一个页面在哪」的提示里，地址要能点（不做「口头指路」）。
//
// ⚠️ 这一层不测「哪句话更短」—— 那种断言只会逼后人把注释删掉。
//    它测的是**结构**：哪一处有、哪一处没有、哪个挂载点还在不在。
// ============================================================================

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

let fails = 0;
const chk = (c, m) => { if (!c) { console.log("✗ " + m); fails++; } else console.log("✓ " + m); };

const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const stripHtml = t => t.replace(/<!--[\s\S]*?-->/g, " ");

const MINE = read("mine/index.html");
const MINE_JS = read("js/mine.js");
const GENERAL = read("settings/general/index.html");
const SETTINGS_JS = read("js/settings.js");
const NAV_JS = read("js/settings-nav.js");
const LOGIN = read("login/index.html");
const RECITE = read("settings/recite/index.html");
const APP_JS = read("js/app.js");

// 设置整侧的五张页（主页 + 四张二级页）——「不许出现某控件」都在这几张上扫
const SETTINGS_PAGES = ["settings/index.html", "settings/general/index.html",
  "settings/recite/index.html", "settings/lists/index.html", "settings/reader/index.html"];
const SETTINGS_SRC = SETTINGS_PAGES.map(read);

{
  console.log("\n=== 一、账号与同步只在「我的」页上（设置侧不许有第二份）===");

  ["#account-panel", "#toggle-sync", "#sync-hint", "#account-state", "#account-tier-src",
   "#switch-sync-name"].forEach(sel => {
    const id = sel.replace(/^#/, "");
    const hit = SETTINGS_PAGES.filter((f, i) => new RegExp('id="' + id + '"').test(SETTINGS_SRC[i]));
    chk(hit.length === 0,
      "设置侧五张页都没有 " + sel + "（实际：" + (hit.join(", ") || "哪一页都没有") + "）");
  });

  chk(!/id="account-panel"|renderAccount\s*\(/.test(SETTINGS_JS),
    "js/settings.js 不再有画账号那一块的代码");
  chk(!/function renderSync|function bindSync/.test(SETTINGS_JS),
    "js/settings.js 不再有画同步开关 / 状态的代码（同一条偏好只有一个出画口）");
  // 唯一允许的一次 SyncStore 出现：退出登录时顺手 forget() 掉同步游标。
  chk((SETTINGS_JS.match(/SyncStore/g) || []).length <= 1,
    "js/settings.js 里 SyncStore 至多出现一次（退出登录时的 forget()）");
  chk(!/id="toggle-sync"|id="sync-hint"|id="sync-row"/.test(GENERAL),
    "「设置 · 通用」页面上不再有同步开关的挂载点");

  ["id=\"toggle-sync\"", "id=\"sync-hint\"", "id=\"sync-row\"", "id=\"account-list\""].forEach(m => {
    chk(MINE.indexOf(m) >= 0, "「我的」页上有 " + m + "（它现在唯一的家）");
  });

  // ⚠️ 2026-09-24（Issue #276）那一轮把静态标记又收掉一条：那颗头像键跟着
  //    身份行走（见 mine-page.test.js），这里守的是**别再有人手写第二份**：
  //    那一行里的动作由 js/mine.js 一处画出来，HTML 里连壳都不留。
  //    ⚠️ 第八轮**反向**一条：「删除头像」（#btn-avatar-clear）**撤了** ——
  //    它搬到裁切层里去了（没图时它压根不该存在），所以这里改成三条：
  //    ① 身份行那颗键 HTML 里不写死；② js/mine.js 画它；
  //    ③ 旧的那颗在整个页面上**一个字都不许再出现**。
  ["id=\"btn-avatar-pick\""].forEach(m => {
    chk(MINE.indexOf(m) < 0, "「我的」页 HTML 里不再写死 " + m + "（身份行那一格由 js/mine.js 画）");
    chk(MINE_JS.indexOf(m.replace("id=", "id=\"")) < 0 || MINE_JS.indexOf("'" + m.replace("id=", "") + "'") >= 0 ||
        MINE_JS.indexOf('"' + m.replace("id=", "") + '"') >= 0,
      "js/mine.js 里能查到 " + m + "（它唯一的出画口）");
  });
  chk(MINE.indexOf('id="btn-avatar-clear"') < 0 && MINE_JS.indexOf('"btn-avatar-clear"') < 0,
    "「删除头像」不再挂在身份行上（它只住在有图那一半的裁切层里）");
  chk(MINE.indexOf('id="btn-crop-clear"') >= 0,
    "它现在住在裁切层里（有图那一半的唯一入口就是那儿）");

  // 通用页剩下什么：只有「数据管理」与「课内诗词导出」两块
  const generalItems = (stripHtml(GENERAL).match(/class="settings-item"/g) || []).length;
  chk(generalItems === 2,
    "「设置 · 通用」只剩两块（数据管理 / 课内诗词导出，实际 " + generalItems + "）");
  chk(!/<label>账号<\/label>/.test(stripHtml(GENERAL)),
    "「通用」里不再有「账号」那一项（那一块整块搬走）");
  // 空壳标签也不留：「课内诗词导出」原先自己占一个 <label>，一句话都没有
  chk(!/<label>课内诗词导出<\/label>/.test(stripHtml(GENERAL)),
    "不再摆一个光有标题、一句说明都没有的空壳标签");
  chk(/导出课内诗词/.test(stripHtml(GENERAL)),
    "那一块的动作键自己把话说清（「导出课内诗词」——不靠上面那个标签）");
}

{
  console.log("\n=== 二、同一件事只有一个入口 ===");

  // 「用户对比」：一处（设置 · 关于里那一行）
  chk(!/\/plans\//.test(strip(MINE_JS)) && !/href="\/plans\/"/.test(stripHtml(MINE).replace(/<!--[\s\S]*?-->/g, " ")),
    "「我的」页不再重复收「用户对比」的入口");
  chk(/link\("\/plans\/",\s*"用户对比"\)/.test(NAV_JS),
    "「用户对比」那一行在「设置 · 关于」里（唯一一处）");
  const navPlans = SETTINGS_SRC.filter(s => /href="\/plans\/"/.test(s)).length;
  chk(navPlans === 0, "设置那几张页的 HTML 里不写死 /plans/（入口由 js/settings-nav.js 按数据出）");

  // 法务两条：一处（同上），「我的」页不再重复
  ["/terms/", "/privacy/"].forEach(href => {
    const pagesWithPlain = SETTINGS_PAGES.filter((f, i) => new RegExp('href="' + href + '"').test(SETTINGS_SRC[i]));
    chk(pagesWithPlain.length === 0,
      href + " 不在设置那几张页的 HTML 里手写（由 js/settings-nav.js 一处渲染）");
    chk(new RegExp('link\\("' + href.replace(/\//g, "\\/") + '",\\s*"').test(NAV_JS),
      href + " 在「设置 · 关于」里有一行");
  });

  // 自检 / 我的报告：也只在设置那一边（「我的」页不重复挂）
  chk(!/self-check/.test(MINE) && !/self-check/.test(MINE_JS),
    "「我的」页不再挂「自检」（它在「设置 · 关于」里一行）");
  chk(!/settings\/reports/.test(MINE) && !/settings\/reports/.test(MINE_JS),
    "「我的」页不再挂「我的报告」（同上）");
}

{
  console.log("\n=== 三、选中态自己就是当前值，不再回显一行「当前：…」===");

  chk(/id="scope-hint"/.test(RECITE), "「背诵」页保留 #scope-hint 这个挂载点（位置还在）");
  chk(!/scope-hint[\s\S]{0,200}"当前："/.test(strip(SETTINGS_JS)),
    "js/settings.js 不再往 #scope-hint 写「当前：…」");
  chk(!/scope-hint[\s\S]{0,200}"当前："/.test(strip(APP_JS)),
    "js/app.js 也不再替设置页往那里写（首页不替别的页画字）");
  chk(!/SCOPE_NAMES/.test(strip(SETTINGS_JS)) ||
      !/SCOPE_NAMES\[settings\.scope\]/.test(strip(SETTINGS_JS)),
    "那份「范围名」对照表不再用于回显（选中态就是当前值）");

  // 另一半：范围那几个按钮仍是互斥的一组，且总有一个是 active
  chk(/seg-scope/.test(RECITE) && /data-scope="upto"/.test(RECITE),
    "范围那一组按钮还在（选中态是它唯一的状态表达）");
  chk(/mark\("#seg-scope", "scope", settings\.scope\)/.test(strip(SETTINGS_JS)),
    "js/settings.js 仍按 settings.scope 标出选中那一格");

  // 同步那一行：关着时不再念「进度只存本机，不上传」
  chk(!/只存本机，不上传/.test(strip(MINE_JS)),
    "同步关着时不再念一句「进度只存本机，不上传」（开关自己是关的，这句是复述）");
  chk(/已开启/.test(strip(MINE_JS)),
    "开着时才写一句实话（「已开启：本机那份始终完整，断网照常背。」）");
}

{
  console.log("\n=== 四、讲「另一个页面在哪」时，地址要能点 ===");

  // 注销说明里那句「想连本机一起清」原先只是口头指路（去「设置 · 通用」），
  // 现在是就地一条链接。
  chk(/清空进度/.test(stripHtml(MINE)) && /href="\/settings\/general\/"/.test(stripHtml(MINE)),
    "注销说明里「想连本机一起清」是**一条能点的链接**（不口头指路）");
  chk(!/去「设置 · 通用」/.test(stripHtml(MINE)),
    "不再用「去『设置 · 通用』」这种要用户自己找的话");

  // 登录页那句「可在『设置 · 通用』关掉」也已改到它现在真正住的那一页
  chk(!/「设置 · 通用」关掉/.test(stripHtml(LOGIN)),
    "登录页不再指「设置 · 通用」去关同步（开关已经搬走了）");
  chk(/可在「我的」页关掉/.test(stripHtml(LOGIN)),
    "登录页指的那一处就是同步开关真正住的地方（「我的」页）");
}

{
  console.log("\n=== 五、几处该省的（挂载点、空壳、重复键）===");

  ["#avatar-hint", "#family-lead", "#crop-hint", "#signout-hint", "#identity-hint"].forEach(sel => {
    const id = sel.replace(/^#/, "");
    chk(!new RegExp('id="' + id + '"').test(stripHtml(MINE)),
      "「我的」页不再有 " + sel + "（内容撤了就整块撤，不留空壳）");
  });
  chk(!/renderHint|function synced/.test(strip(read("js/avatar-edit.js"))),
    "js/avatar-edit.js 里那对「已同步 / 未同步」的函数也一起撤（不留没人调用的判断）");

  // 登录页那次重复：**验证那一屏**原先一颗按钮加一条链接，两个都叫「返回登录」。
  const verifyPane = stripHtml(LOGIN).slice(stripHtml(LOGIN).indexOf('id="pane-verify"'),
    stripHtml(LOGIN).indexOf('id="pane-forgot"'));
  const verifyBack = (verifyPane.match(/返回登录/g) || []).length;
  chk(verifyBack === 1,
    "验证那一屏只剩一处「返回登录」（原先一颗按钮 + 一条链接各写一遍；实际 " + verifyBack + " 处）");
  chk(/id="btn-verify-later"/.test(verifyPane),
    "留下的那一处是主键「返回登录」（不是又小又远的那条链接）");
  chk(!/btn-back-login3/.test(LOGIN) && !/btn-back-login3/.test(read("js/login.js")),
    "第二颗「返回登录」连 id 都不留（不留一个没人接的键）");
  chk(!/没登录也能重发/.test(stripHtml(LOGIN)),
    "「邮箱（没登录也能重发）」那半句撤掉（同屏那颗键就写着「重发验证邮件」）");

  // 「关于」里那几行分成「应用」与「页面」两段
  chk(/settings-about-title">页面</.test(NAV_JS),
    "「关于」里那几页入口有自己的段落标题（「页面」），不与「应用 / 版本」混成一堆");
  chk(NAV_JS.indexOf("应用") < NAV_JS.indexOf("页面"),
    "段落顺序：先「应用」再「页面」");
}

{
  console.log("\n=== 六、我的报告那一页：引导语只留一处（Issue #278 第八轮）===");

  // 用户原话：「我的报告页面废话连篇，需要删除或精简」。
  //
  // 这一页原先有**四处**教同一件事（怎么报错）：页首一段「看到错字、标错的注音、
  // 翻错的译文，在篇目页上点那颗小旗（正文里选中一段再点「报这一段」也行）……」、
  // 空列表那一屏、未登录那一屏、以及 JS 里三句。四处说的是同一件事，而这一页
  // 是**回执页** —— 用户来这儿是看「报的处理到哪一步」，不是来学怎么报的。
  //
  // 所以这一轮的口径是：**怎么报错只在空屏那一句里讲**（那是全站唯一一处，
  // 也是用户第一次打开这一页时唯一需要的那句）；别的屏只留自己独有的那半句。
  const REPORTS = read("settings/reports/index.html");
  const REPORTS_JS = read("js/reports-page.js");
  const REPORT_JS = read("js/report.js");

  // 1. 页首那段长引导语整段撤掉
  chk(!/account-lead/.test(stripHtml(REPORTS)),
    "那一页不再有 \`.account-lead\` 那段长引导语（「点那颗小旗（正文里选中一段…」）");
  chk(!/报这一段/.test(REPORTS),
    "那段里「正文里选中一段再点『报这一段』也行」也一个字不留");

  // 2. 「别的入口」那一组（讲 Issue 那条路）整组撤掉
  chk(!/别的入口/.test(REPORTS), "「别的入口」那一组撤掉（整组只讲「去开 Issue」）");
  chk(!/issues/.test(stripHtml(REPORTS)),
    "那一页不再挂 github/cnb 的 Issue 外链（弹层里那条路还在，见下）");

  // 3. 未登录那一屏只留「登录后才能报告」
  chk(/id="reports-guest"/.test(REPORTS),
    "未登录那一句还留着（挂载点 #reports-guest）");
  const guest = stripHtml(REPORTS).slice(stripHtml(REPORTS).indexOf('id="reports-guest"'));
  chk(!/认得出是谁报的|修好之后能回你一句/.test(guest),
    "未登录那一屏不再解释「这样才认得出是谁报的、修好之后能回你一句」");
  chk(/href="\/login\/"/.test(guest),
    "但「去登录」这条路一个字不少（只说结论，路要能走）");

  // 4. 空屏那句是**全站唯一**讲「怎么报错」的地方 —— 它不能再短
  chk(/点篇目上方那颗<strong>小旗<\/strong>就能报/.test(REPORT_JS),
    "空屏那一句仍然讲清「点篇目上方那颗小旗」（全站唯一一处，撤了就没地方知道了）");

  // 5. JS 里的两句长提示收短
  chk(!/已在服务器上|没有压在本机发不出去的/.test(REPORTS_JS),
    "不再报「已在服务器上 N 条 / 没有压在本机发不出去的」（那是用户数得出来的一句话）");
  chk(/还有 \$\{pending\} 条没发出去。/.test(REPORTS_JS),
    "「还有 N 条没发出去」这一句收成一句（原先两句 40+ 字，还带一个因果解释）");
  chk(!/多半是报的时候没登录或断网/.test(REPORTS_JS),
    "那句「（多半是报的时候没登录或断网）」撤掉 —— 原因对用户没有下一步");

  // 6. 本机那一份的横幅收短，但**不能删**（删了用户会以为都收到了）
  chk(/本机的（服务端暂时读不到）/.test(REPORT_JS),
    "「这是本机记下的那一份（服务端暂时读不到，可能是没登录或断网）」收成「本机的（服务端暂时读不到）」");
  chk(!/这是<strong>本机记下<\/strong>的那一份/.test(REPORT_JS),
    "旧的那一版 30 字横幅已撤");
  chk(/serviceWorker|本机/.test(REPORT_JS),
    "「服务端读不到时如实说」这条口径还在（收短，没有删）");
}

{
  console.log("\n=== 七、缓存版本 ===");
  const sw = read("sw.js");
  const ver = parseInt((sw.match(/poem-app-v(\d+)/) || [0, "0"])[1], 10);
  chk(ver >= 194, "缓存版本已提（本轮改了页面 / 脚本 / 样式，实际 v" + ver + "）");
  chk(String(ver) === String((NAV_JS.match(/APP_VERSION = "[^"]*v(\d+)/) || [0, "0"])[1]),
    "「关于」里的版本号与 sw.js 的 CACHE_NAME 同一个数");
}

console.log("\n" + (fails ? "❌ " + fails + " 项失败" : "🎉 页面归位 / 文案精简守卫全部通过"));
process.exit(fails ? 1 : 0);
