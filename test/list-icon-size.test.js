"use strict";

// ---------------------------------------------------------------------------
// 列表卡片右侧那一组圆钮的尺寸 / 线宽（Issue #329）
// ---------------------------------------------------------------------------
// 用户 2026-09-26：
//   「将列表页的报告错误，加入今日背诵，加入背诵清单，和播放按钮的大小统一
//     缩小成和分组卡片顶部右上角各类别连续播放的按钮一样大小，里面 svg
//     border 宽度统一为 1px。」
//
// 这一层是纯源码断言（不起 jsdom、不起浏览器）：钉住
//
//   1. 尺寸只有一个来源：css/style.css 的 --item-btn / --item-icon，
//      值等于 .gw-play-sm 写死的 26px；
//   2. 建图标的那几个函数（播放 / 书签 / 旗子 / 加号 / 勾）都写 stroke-width="1"；
//   3. 各页面 index.html 里内联的同一批图标也一样；
//   4. 26px / 12px 这两个数不许再散在别处写死（防止下次只改一处）。
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, " ");

let fails = 0;
const chk = (c, m) => { if (!c) { console.log("✗ " + m); fails++; } else console.log("✓ " + m); };
const has = (s, sub, m) => chk(String(s).indexOf(sub) >= 0, m);

console.log("=== 1 · 同一档尺寸只有一个来源 ===");
{
  const style = read("css/style.css");
  const m = /--item-btn:\s*(\d+)px/.exec(style);
  chk(!!m, "css/style.css 里写了 --item-btn（列表圆钮的边长）");
  chk(m && m[1] === "26", "列表圆钮 26px —— 与分组卡片右上角连读钮同尺寸（实际 " + (m && m[1]) + "）");

  const mi = /--item-icon:\s*(\d+)px/.exec(style);
  chk(mi && mi[1] === "12", "列表圆钮里的图标 12px（实际 " + (mi && mi[1]) + "）");

  const cls = strip(read("css/classic.css"));
  const g = /\.gw-play-sm\s*\{[^}]*width:\s*26px[^}]*height:\s*26px/.exec(cls);
  chk(!!g, "分组卡片右上角的连读钮仍然是 26px（基准没被改掉）");
  has(cls, ".gw-play-sm svg { width: 15px; height: 15px; }",
    "连读钮里的三角在同一尺寸圆钮里单独给 15px（跟分组名一个视觉块）");
}

console.log("");
console.log("=== 2 · 列表里的四类圆钮都吃这一档 ===");
{
  const cls = strip(read("css/classic.css"));
  const st = strip(read("css/style.css"));
  ["\\.item-report", "\\.item-daily", "\\.item-recite"].forEach(sel => {
    const re = new RegExp(sel + "\\s*\\{[^}]*width:\\s*var\\(--item-btn\\)[^}]*height:\\s*var\\(--item-btn\\)",
      "s");
    chk(re.test(cls) || re.test(st) || re.test(cls + st), sel.replace(/\\/g, "") + " 走 --item-btn");
  });
  chk(/\.item-read\s*\{[^}]*width:\s*var\(--item-btn\)[^}]*height:\s*var\(--item-btn\)/s.test(st),
    ".item-read 走 --item-btn");
  has(cls, "grid-template-columns: repeat(2, var(--item-btn))",
    "两列排布跟着同一档走（换尺寸不会错位）");
}

console.log("");
console.log("=== 3 · 图标线宽统一 1px ===");
{
  const core = read("js/reader-core.js");
  has(core, 'd="M8.4 6.1 18.3 12 8.4 17.9Z" fill="none" stroke="currentColor" stroke-width="1"',
    "列表播放三角 1px（原先 1.5）");
  has(core, 'function reciteGlyph', "书签图标还在（加入背诵清单）");
  chk(/stroke-width="1" '[\s\S]{0,160}?M7 4\.6h10/.test(core), "书签 1px（原先 1.8）");
  chk(/M7\.8 5\.4 19 12 7\.8 18\.6Z/.test(core),
    "连读三角换成 recentre 过的坐标（放大到贴边，配 26px 的圆钮才不显小）");

  const rep = read("js/report.js");
  chk(/M6 3\.6v16\.8[\s\S]{0,80}?/.test(rep) && rep.indexOf('stroke-width="1.8"') < 0,
    "报告错误旗子 1px（原先 1.8）");

  const daily = read("js/daily-extra-ui.js");
  chk(daily.indexOf('stroke-width="1.9"') < 0 && daily.indexOf('stroke-width="2.1"') < 0,
    "加入今日背诵的「+」与「✓」都改成 1px（原先 1.9 / 2.1）");

  // 「列表页」的四个按钮，全站不该再出现第 2、3 档线宽
  ["js/reader-core.js", "js/report.js", "js/daily-extra-ui.js"].forEach(f => {
    const s = read(f);
    (s.match(/<svg[\s\S]*?<\/svg>/g) || []).forEach(sv => {
      const marks = ["M8.4 6.1 18.3 12 8.4 17.9Z", "M9.4 6.6 18 12", "M7.8 5.4 19 12",
        "M7 4.6h10", "M6 3.6v16.8", "M5 12.5 10 17.5 19.5 7", "M12 5.4v13.2M5.4 12h13.2"];
      if (!marks.some(mk => sv.indexOf(mk) >= 0)) return;
      const w = /stroke-width="([\d.]+)"/.exec(sv);
      chk(!!w && w[1] === "1", f + " 里这七种图标线宽都是 1px（实际 " + (w ? w[1] : "缺") + "）");
    });
  });
}

console.log("");
console.log("=== 4 · 各页面内联的同一批图标也是 1px ===");
{
  const pages = ["index.html"].concat(
    fs.readdirSync(ROOT)
      .filter(d => fs.existsSync(path.join(ROOT, d, "index.html")))
      .map(d => d + "/index.html")
  );
  const marks = ["M8.4 6.1 18.3 12 8.4 17.9Z", "M9.4 6.6 18 12", "M7.8 5.4 19 12",
    "M7 4.6h10", "M6 3.6v16.8", "M5 12.5 10 17.5 19.5 7", "M12 5.4v13.2M5.4 12h13.2"];
  let bad = [];
  pages.forEach(f => {
    const s = read(f);
    const svgs = s.match(/<svg[\s\S]*?<\/svg>/g) || [];
    svgs.forEach(sv => {
      if (!marks.some(mk => sv.indexOf(mk) >= 0)) return;
      const w = /stroke-width="([\d.]+)"/.exec(sv);
      if (w && w[1] !== "1") bad.push(f + " -> " + w[1]);
      if (!w) bad.push(f + " -> 缺 stroke-width");
    });
  });
  chk(bad.length === 0, "所有页面里这七种图标都是 1px" + (bad.length ? "：" + bad.join(" / ") : ""));
}

console.log("");
console.log("=== 5 · 四颗钮之间的缝隙（Issue #329 后续）===");
{
  // 用户 2026-09-26：
  //   「减少 报告错误 / 加入今日背诵 / 加入背诵清单 / 播放 四个按钮左右及上下的 gap 间距」
  const st = strip(read("css/style.css"));
  const cls = strip(read("css/classic.css"));

  const g = /--item-gap:\s*(\d+)px/.exec(st);
  chk(!!g, "css/style.css 里写了 --item-gap（这四颗钮的缝隙）");
  chk(g && Number(g[1]) < 8, "缝隙比原来的 8px 小（实际 " + (g && g[1]) + "px）");

  has(cls, "gap: 0 var(--item-gap)",
    "左右那一条缝吃 --item-gap（不再由 gap 简写顺带管上下）");
  has(cls, "grid-auto-rows: calc(var(--item-btn) + var(--item-gap))",
    "上下那一条缝也在：行高 = 钮高 + 这一条缝");
  chk(/grid-auto-rows:\s*calc\(var\(--item-btn\)\s*\+\s*var\(--item-gap\)\)/.test(cls),
    "行高写成 calc，不是把两行钮硬压在一起");
  has(cls, "margin-right: var(--item-gap)",
    "到行尾箭头那条缝跟着一起收");

  // ⚠️ 别写 1fr / auto：那样行高会被 .item 的 line-height 带跑偏（26 → 27.19），
  //    两条缝就不一样宽了。这一条守住「行高只由两个变量算出来」。
  chk(!/grid-auto-rows:\s*(1fr|auto|min-content|max-content)/.test(cls),
    "行高不写成 1fr / auto（会被 line-height 带跑偏）");
}

console.log("");
if (fails) { console.log("❌ 列表圆钮尺寸 / 线宽测试 " + fails + " 项失败"); process.exit(1); }
console.log("🎉 列表圆钮尺寸 / 线宽测试全部通过");
