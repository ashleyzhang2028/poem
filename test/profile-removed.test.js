"use strict";

// ============================================================================
// 「个人中心（/profile/）已删」的守卫（2026-09-20 · Issue #244）
//
// 用户原话：「现在有了 mine 页面，这个 profile 页面是不是可以删除了？」
//
// 结论是**可以删**：两个页连卡片都长得一样 —— 身份（头像 / 昵称 / 掩码 /
// 层级徽章）、本机数据概览、关于（法务入口 / 同步开关 / 管理后台）、注销，
// 「我的」页一样不少，还多了子用户与头像上传。
//
// ⚠️ 这一层守的是**删干净**，不是「删了但留一堆指路」：
//    页面、脚本、预缓存、路由、返回落点，一处都不留；有谁把 /profile/
//    加回来（比如又在本机数据卡底下挂一行「去个人中心」），这一层先红。
//
// ⚠️ 另一件同样要紧的事：个人中心**独有的那几件**必须真的搬到了「我的」页上，
//    不能跟着页面一起消失。所以下面同时守着「我的」页里那四件还在：
//    法务两条入口 · 用户对比 · 跨设备同步开关 + 冲突裁决 · 管理后台。
// ============================================================================

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const exists = f => fs.existsSync(path.join(ROOT, f));

let fails = 0;
const chk = (c, m) => { if (!c) { console.log("✗ " + m); fails++; } else console.log("✓ " + m); };

const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const stripHtml = t => t.replace(/<!--[\s\S]*?-->/g, " ");

// 只扫**产品源码**（页面 / 脚本 / 样式），不扫 docs（那里在讲这段历史）
// 也不扫 test（那些是守卫自己）。
const sourceFiles = [];
(function walk(dir) {
  fs.readdirSync(dir).forEach(name => {
    if (name === "node_modules" || name === ".git" || name === "docs" || name === "test") return;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) return walk(p);
    if (/\.(html|js|css)$/.test(name)) sourceFiles.push(path.relative(ROOT, p));
  });
})(ROOT);

{
  console.log("\n=== 一、页面与脚本真的不在了 ===");
  chk(!exists("profile/index.html"), "profile/index.html 已删除（不是留个空目录）");
  chk(!exists("profile"), "profile/ 整个目录都没了");
  chk(!exists("js/profile.js"), "js/profile.js 已删除（页面走了，画它的脚本也走）");
  chk(!/\/profile\//.test(read("sw.js")), "sw.js 的预缓存清单里不再有 ./profile/");
  chk(!/js\/profile\.js/.test(read("sw.js")), "sw.js 的预缓存清单里不再有 js/profile.js");
  chk(/js\/mine\.js/.test(read("sw.js")), "「我的」页与 js/mine.js 仍在预缓存里（断网也进得去）");
}

{
  console.log("\n=== 二、全站不再有指向 /profile/ 的动线 ===");
  // ⚠️ 判据看的是**去注释之后**的正文：源码里提一句「原先在 /profile/」
  //    是给后人留的史，不是一条活着的动线。
  const hits = sourceFiles.filter(f => /\/profile\//.test(strip(read(f))));
  chk(hits.length === 0,
    "没有任何页面 / 脚本还写着 /profile/（实际 " + (hits.join(", ") || "无") + "）");

  const chrome = read("js/chrome.js");
  chk(!/profile/.test(chrome), "js/chrome.js 的路由表里没有 profile 这一项（删的是整条不是留个死键）");
  chk(/mine: "\/mine\/"/.test(chrome), "mine 那条路由仍在（它是「我的」页的落点）");

  const login = read("login/index.html");
  chk(/data-back="\/mine\/"/.test(login), "登录页的上一层改成「我的」页（个人中心没了）");
  chk(!/data-back="\/profile\/"/.test(login), "登录页不再退回个人中心");

  const loginJs = read("js/login.js");
  chk(/nextUrl\(\) \|\| "\/mine\/"/.test(loginJs),
    "登录成功后落回「我的」页（原先落个人中心，那一页已经没了）");
  chk(!/"\/profile\/"/.test(strip(loginJs)), "js/login.js 里不残留 /profile/ 这个落点");

  const admin = read("admin/index.html");
  chk(/data-back="\/mine\/"/.test(admin), "管理后台的上一层改成「我的」页");
  chk(!/\/profile\//.test(admin) && !/\/profile\//.test(read("js/admin-page.js")),
    "管理后台的页面与脚本都不再提个人中心");

  const settingsJs = strip(read("js/settings.js"));
  // ⚠️ 原先这里守的是「设置 · 通用里那颗『个人中心』键改成去 /mine/」。
  //    用户 2026-09-21「哪些应该放到我的却放到了设置」之后，**账号那一整项
  //    都从「通用」收回了「我的」页**（连 #account-panel 在内），
  //    那颗键当然也不再需要 —— 守的是它整块不回来，而不是换个地址再挂一颗。
  chk(!/btn-goprofile/.test(settingsJs) && !/id="account-panel"/.test(settingsJs),
    "设置 · 通用里不再有账号那一项（账号归「我的」页，那颗指路的键也随之撤掉）");
  chk(!/\/profile\//.test(settingsJs), "js/settings.js 里不再有 /profile/");
}

{
  console.log("\n=== 三、个人中心独有的那几件，都搬到「我的」页了 ===");
  const mine = read("mine/index.html");
  const mineJs = strip(read("js/mine.js"));

  chk(/id="about-card"/.test(mine), "「我的」页新增「关于」卡（个人中心那张卡的落点）");
  ['/terms/', '/privacy/'].forEach(href => {
    chk(new RegExp('class="kv-k"><a class="kv-link" href="' + href + '"').test(mine),
      "法务入口 " + href + " 出现在「我的」页的「关于」卡里");
  });
  // ⚠️ 用户 2026-09-21：用户对比是**一张表**（一处就够），它留在
  //    「设置 · 关于」那一行；「我的」页不再重复收一份。
  chk(!/href="\/plans\/"/.test(mine),
    "「我的」页不再重复收「用户对比」（只在「设置 · 关于」一处给入口）");
  chk(/link\("\/plans\/",\s*"用户对比"\)/.test(read("js/settings-nav.js")),
    "「用户对比」那一行仍在「设置 · 关于」里（Issue #244 那四件一件没少）");
  chk(/id="sync-row"/.test(mine) && /id="toggle-sync"/.test(mine),
    "跨设备同步开关搬到了「我的」页（项名 + 开关一行）");
  chk(/id="sync-conflict"/.test(mine) && /id="conflict-lead"/.test(mine),
    "冲突裁决面板也一起搬过来了（有冲突才铺开）");
  ['btn-keep-local', 'btn-keep-remote', 'btn-export-first'].forEach(id => {
    chk(new RegExp('id="' + id + '"').test(mine), "裁决三颗键 " + id + " 都在");
  });
  chk(/id="btn-go-admin"/.test(mine), "管理后台入口在「我的」页上");

  chk(/renderSync\(\)/.test(mineJs) && /function renderSync\(/.test(mineJs),
    "js/mine.js 里有 renderSync()（同步那一块唯一的画法）");
  chk(/function onToggleSync\(/.test(mineJs) && /S\.setEnabled/.test(mineJs),
    "开关的接线走 SyncStore.setEnabled（不在本页另造一份偏好）");
  chk(/function renderConflict\(/.test(mineJs) && /S\.conflicts\(\)/.test(mineJs),
    "冲突面板读的是 SyncStore.conflicts()（不自己猜有没有冲突）");
  chk(/function onResolve\(/.test(mineJs) && /S\.resolveConflict/.test(mineJs),
    "裁决走 SyncStore.resolveConflict（三档全在本页接上）");

  chk(!/poem_sync_pref_v1|poem_recite_progress_v1/.test(mineJs),
    "js/mine.js 不自己拼同步 / 进度的存储键名（键名只在引擎里）");
  chk(!/tier\s*===|plan\s*===/.test(mineJs),
    "js/mine.js 不自己比对层级（一律走 Entitlement）");
}

{
  console.log("\n=== 四、「我的」页仍然是一张干净的清单页 ===");
  const mine = read("mine/index.html");
  const cards = [...mine.matchAll(/<section class="account-card/g)].map(m => m[0]).length;
  chk(cards === 6,
    "「我的」页现在是六张卡（身份 / 子用户 / 本机数据 / 账号 / 关于 / 危险区，实际 " + cards + "）");

  const ids = [...mine.matchAll(/<section class="account-card[^"]*"(?: id="([^"]+)")?/g)]
    .map(m => m[1] || "identity");
  chk(ids.join(" > ").indexOf("about-card") < ids.join(" > ").indexOf("danger-card"),
    "「关于」卡排在注销（危险区）之前（去别处看的两行不与危险动作并列，实际 " + ids.join(" > ") + "）");
  // 用户 2026-09-21「再次梳理所有页面」：这一页的次序按「我是谁 → 我的数据 →
  // 我的账号 → 这台应用」走 —— 账号在前（它是这一页的主语之一），
  // 「关于」在后（应用信息的入口），注销垫底。
  chk(ids.join(" > ").indexOf("account-card") < ids.join(" > ").indexOf("about-card"),
    "「账号」卡排在「关于」卡之前（实际 " + ids.join(" > ") + "）");

  chk(!/class="admin-slot"/.test(mine),
    "管理后台那颗键不再单占页尾一块（.admin-slot 随移动一起撤掉）");
  chk(!/个人中心/.test(stripHtml(mine)), "「我的」页上不再出现「个人中心」四个字（那一页已经不存在）");
}

{
  console.log("\n=== 五、其余页面不留旧口径 ===");
  const readme = read("README.md");
  chk(!/账号三页/.test(readme), "README 不再写「账号三页」（现在是两张 + 「我的」页）");
  chk(/\/mine\//.test(readme), "README 里指向的是 /mine/");

  const design = read("docs/auth-design.md");
  chk(!/^\| `\/profile\/` \|/m.test(design),
    "docs/auth-design.md 的页面表里不再列 /profile/（那些行整行删掉，不是留着不更新）");
  chk(/Issue #244/.test(design) && /个人中心.*已删除/.test(design),
    "auth-design.md 里记了「个人中心已并入/删除」这件事（后人不会再问一次）");
  chk(!/\/profile\/\s*→\s*\/mine\//.test(design) || /已删除/.test(design),
    "返回落点表里那两条 /profile/ 已按新动线改写");

  const arch = read("docs/architecture.md");
  chk(!/`\/login\/` `\/profile\/` `\/admin\/`/.test(arch),
    "architecture.md 不再把 /profile/ 与另两张页并列（那一页不存在了）");
}

{
  const sw = read("sw.js");
  const ver = parseInt((sw.match(/poem-app-v(\d+)/) || [0, "0"])[1], 10);
  chk(ver >= 194, "缓存版本已跟着提（本轮收了账号 / 同步两块 + 精简提示，实际 v" + ver + "）");

  const navVer = (read("js/settings-nav.js").match(/APP_VERSION = "[^"]*v(\d+)/) || [0, "0"])[1];
  chk(String(ver) === String(navVer),
    "「关于」里的版本号与 sw.js 的 CACHE_NAME 同一个数（实际 v" + navVer + " / v" + ver + "）");

  const list = [...sw.matchAll(/"(\.\/[^"]+)"/g)].map(m => m[1]);
  const missing = list.filter(u => {
    if (u === "./") return false;
    const f = u.replace(/^\.\//, "");
    if (exists(f)) return false;
    if (/\/$/.test(f) && exists(f + "index.html")) return false;
    return true;
  });
  chk(missing.length === 0, "预缓存清单里的文件都存在（实际缺 " + missing.join(",") + "）");
}

console.log("\n" + (fails ? "❌ " + fails + " 项失败" : "🎉 个人中心删除守卫全部通过"));
process.exit(fails ? 1 : 0);
