// 「考试记录」页的排版（Issue #356，用户 2026-09-30 裁决）
//
// 用户看到的是（390×844，真机）：
//
//     ┌──────────────┐
//     │ 考试记录      │   ← 第一张卡，卡里就这五个字
//     └──────────────┘
//         ↕ 12px 的缝里什么都没有
//     ┌──────────────┐
//     │ 4 / 5  [删除] │   ← 第二张卡
//     └──────────────┘
//
// 两件事要守：
//   ① **标题与清单同一张卡** —— 从前标题单独占一张卡（`.game-head`），下面另起
//      一张装清单，两张卡之间那道 12px 的缝里什么都没有，标题卡看着就是
//      「一块被撑开的空行」。用户的原话是「如果是两张卡片那考试记录卡片请
//      垂直居中显示或者删除可能的空行」。
//   ② **「删除」是次要动作，用小一号的次一级按钮** —— 从前它是 `.account-btn`
//      （44px 高、15px 字、通栏 220px 宽），跟「开始」「交卷」一个体量。
//      真机量过：390×844 上 220×44，一行里最打眼的就是它。
//
// 界面测试层已按 Issue #278 删除，所以这里**只做静态判据**（读源码 + 读 CSS），
// 不起浏览器。要真量像素，跑 `node scripts/serve.js` 自己看一眼。
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const game = fs.readFileSync(path.join(root, 'js/game.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/account.css'), 'utf8');

// 只取 renderHistory() 那一段，别把 renderSetup / renderPaper 一起读进来
const at = game.indexOf('function renderHistory()');
chk(at >= 0, '在 js/game.js 里找得到 renderHistory()');
const body = game.slice(at, game.indexOf('\n  }\n', at));

console.log('');
console.log('=== 一、标题与清单是同一张卡（不再有那道空缝） ===');

// 整段只许出现**一个** `<section class="account-card`，且它同时装着标题与清单
const sections = body.match(/<section class="account-card/g) || [];
chk(sections.length === 1,
  'renderHistory() 只开一张 .account-card（实际 ' + sections.length + ' 张）');
chk(/<section class="account-card game-head">'[\s\S]{0,80}?account-card-title">考试记录/.test(body),
  '「考试记录」标题就在这张卡的第一行');
chk(/game-history-list/.test(body),
  '清单（.game-history-list）也在这同一张卡里 —— 中间没有另起一张卡');
chk(!/<\/section>[\s\S]+?<section class="account-card"><div class="game-history-list">/.test(body),
  '不再有「标题卡封口 → 又开一张清单卡」这个形状');

console.log('');
console.log('=== 二、「删除」是次一级按钮 ===');

chk(/class="mini-btn"[^>]*data-game-history-del/.test(body),
  '删除键用 .mini-btn（32px 高 / 13px 字），不再是 .account-btn');
chk(!/class="account-btn ghost"[^>]*data-game-history-del/.test(body),
  '删除键不再是 .account-btn.ghost（那是「开始」「交卷」的体量）');

// .mini-btn 本体：比 .account-btn 小一档，且不是通栏（它住在 classic.css）
const classic = fs.readFileSync(path.join(root, 'css/classic.css'), 'utf8');
chk(classic.indexOf('.mini-btn,') >= 0, '在 css/classic.css 里找得到 .mini-btn 本体');
const miniBody = classic.slice(classic.indexOf('.mini-btn,'), classic.indexOf('.mini-btn:hover'));
chk(/min-height:\s*var\(--ctl-h-sm\)/.test(miniBody),
  '.mini-btn 用 --ctl-h-sm（32px），比 .account-btn 的 --ctl-h-lg（44px）小一档');
chk(/font-size:\s*var\(--ctl-font-sm\)/.test(miniBody),
  '.mini-btn 字号用 --ctl-font-sm（13px），比 .account-btn 的 15px 小一档');
chk(/display:\s*inline-flex/.test(miniBody),
  '.mini-btn 是 inline-flex —— 一行里按内容宽，不会通栏');

// 行内那一条：右侧固定住，别被左边挤扁
chk(/\.game-history-row \.mini-btn\s*\{[\s\S]{0,200}?flex:\s*none/.test(css),
  '.game-history-row .mini-btn 固定宽度（flex: none），不被左边那条挤扁');

console.log('');
if (fails) { console.log('失败 ' + fails + ' 项'); process.exit(1); }
console.log('全部通过');
