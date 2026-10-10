// 「集子页顶上那颗连读键」挂得上钩子吗（Issue #535 回归）
//
// 症状与根因：`/library/` 里进任何一个集子，页顶「全部 / 未读」右边那颗
// 连读键点了没反应；下面每个分类卡片右上角那颗却是好的。
//
// 不是语音、不是登录 —— 是**属性名对不上**。`js/reader-core.js` 只认
// `[data-gw="random"]` 这一颗钩子（`syncRandomReadButton` 找它、绑事件也
// 找它）。别的十六个集子页写的都是 `data-gw="random"`，唯独 `/library/`
// 那一页写成了 `data-lib-part="random"` —— 于是脚本既没给它同步状态
// （`disabled` / `title` 一直是 HTML 里的死值），也没绑点击。卡片上那颗
// 走的是另一条路（`[data-random-group]`，在列表容器里就地委托），所以照常работ。
//
// 界面测试层按 Issue #278 删了，于是只做静态判据：凡是页面上摆出
// `.gw-play-main` 这颗「主连读键」的页面，都必须带 `data-gw="random"`。
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

function htmlFiles(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) htmlFiles(p, out);
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

// 带上「主连读键」的页面 —— 按 class 认，不按 id 认（id 各页不同：
// gw-random-read / lib-gw-random-read）。
const withMain = [];
htmlFiles(root, []).forEach(function (f) {
  const src = fs.readFileSync(f, 'utf8');
  if (!/class="[^"]*\bgw-play-main\b/.test(src)) return;
  withMain.push({ file: path.relative(root, f), src: src });
});

console.log('=== 摆出主连读键的页面共 ' + withMain.length + ' 个 ===');
chk(withMain.length >= 18, '摆出主连读键的页面都在（实际 ' + withMain.length + ' 个）');

withMain.forEach(function (it) {
  // 把带 gw-play-main 的那个 button 开标签整段抠出来
  const m = it.src.match(/<button[^>]*class="[^"]*\bgw-play-main\b[^"]*"[^>]*>/);
  const tag = m ? m[0] : '';
  chk(/\bdata-gw="random"/.test(tag),
    it.file + ' 的主连读键带 data-gw="random"（否则 reader-core 认不出它）');
});

// 反向也钉一道：reader-core 认的就是这一个钩子。改了名字两边就得一起改。
const core = fs.readFileSync(path.join(root, 'js/reader-core.js'), 'utf8');
chk(/\$\('\[data-gw="random"\]'\)/.test(core) || /\[data-gw="random"\]/.test(core),
  'reader-core.js 仍以 [data-gw="random"] 作为主连读键的钩子');

console.log('');
if (fails) { console.log('失败 ' + fails + ' 项'); process.exit(1); }
console.log('全部通过');
