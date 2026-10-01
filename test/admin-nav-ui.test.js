// 管理后台导航列表左侧 SVG 图标的间距（Issue #370 第四轮，用户 2026-10-01）
//
// 用户原话：
//   「管理后台页面，账号管理，用户报告这些左侧的 SVG 图标过于贴近左侧边框，
//     需要有合理的间隔。」
//
// 不是「顺手多给几像素」，是一条真回退：
//
//   `.admin-nav-item` 桌面端本来就是 `padding: 14px 16px`，图标与卡片边框之间
//   有 16px 的呼吸。可 `css/account.css` 里 480px 以下那条覆盖把它改成了
//      padding: 12px 0px;   /* ← 左右归零 */
//   手机上进管理后台，四行导航的图标就**顶到卡片边框上**了。
//
//   卡片本身也只有 14px 内边距（`.account-card` 是 `padding: 16px 14px`），
//   这一行再不留白，等于双重贴边。
//
// 界面测试层已按 Issue #278 删除，所以这里**只做静态判据**（读 CSS），
// 不起浏览器。要真量像素，跑 `node scripts/serve.js`，390×844 真机看一眼。
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const css = fs.readFileSync(path.join(root, 'css/account.css'), 'utf8');

const pick = (src, head, tail) => {
  const a = src.indexOf(head);
  return a < 0 ? '' : src.slice(a, src.indexOf(tail, a));
};

console.log('');
console.log('=== 一、桌面端本来就有左右内边距 ===');

const item = pick(css, '.admin-nav-item {', '}');
chk(item.length > 0, '.admin-nav-item 的规矩还在');
chk(/padding:\s*14px 16px/.test(item),
  '桌面端 padding: 14px 16px —— 图标与卡片边框之间有 16px 呼吸');
chk(/gap:\s*14px/.test(item),
  '图标与右侧文字之间 gap: 14px —— 两块内容自己也分得开');

console.log('');
console.log('=== 二、窄屏那条覆盖不许把左右抹成 0 ===');

const narrow = pick(css, '@media (max-width: 480px) {\n  .admin-nav-item {', '}');
chk(narrow.length > 0, '480px 以下给 .admin-nav-item 单列了规矩');
chk(!/padding:\s*[^;]*\b0px\b\s*;/.test(narrow) || !/padding:\s*\d+px\s+0px/.test(narrow),
  '左右内边距不是 0px —— 这就是图标贴边的那处回退');
chk(/padding:\s*12px 14px/.test(narrow),
  '窄屏 padding: 12px 14px —— 高度收到 12px，左右照旧留 14px');

console.log('');
console.log('=== 三、图标自己也不该缩到没边 ===');

const icon = pick(css, '.admin-nav-icon {', '}');
chk(/flex:\s*none/.test(icon), '图标 flex: none —— 不被旁边文字挤扁');
chk(/width:\s*28px/.test(icon), '桌面端 28×28');

const iconNarrow = pick(css, '@media (max-width: 480px) {\n  .admin-nav-item {', '\n}\n');
chk(/\.admin-nav-icon\s*\{[^}]*width:\s*24px/.test(iconNarrow) || /width:\s*24px/.test(pick(css, '  .admin-nav-icon {', '}')),
  '窄屏图标 24×24 —— 收了尺寸，但仍与文字对齐');

console.log('');
if (fails) { console.log('失败 ' + fails + ' 项'); process.exit(1); }
console.log('全部通过');
