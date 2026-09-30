// 页面脚本可解析性（Issue #356 回归）
//
// 症状与根因：/dahui/ 点进去一片空白。不是登录、不是权限 ——
// js/game.js 里多出一个 `}`，整个脚本解析失败，`<div data-poems-view="game">`
// 永远不会被填内容，页面就是白的。
//
// 界面测试删掉之后，没有任何一层会「把页面脚本读一遍」。这个测试只做一件事：
// 把每个 HTML 页面引到的本地 JS 逐个用 vm.Script 编译一次。语法错就在这一层
// 现形 —— 比等用户点进去看到空白快得多，也不依赖 jsdom / 浏览器。
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.join(__dirname, '..');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

// 收集所有 HTML 入口
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

const scripts = new Set();
for (const html of htmlFiles(root, [])) {
  const src = fs.readFileSync(html, 'utf8');
  const re = /<script[^>]+src="([^"]+)"/g;
  let m;
  while ((m = re.exec(src))) {
    let s = m[1];
    if (/^https?:|^\/\//.test(s)) continue; // 外链跳过
    s = s.replace(/^\//, '').split('?')[0].split('#')[0];
    scripts.add(s);
  }
}

console.log('=== 页面引到的本地脚本共 ' + scripts.size + ' 个 ===');
let checked = 0, missing = 0;
for (const s of scripts) {
  const abs = path.join(root, s);
  if (!fs.existsSync(abs)) { console.log('✗ 页面引了但文件不存在：' + s); missing++; continue; }
  const code = fs.readFileSync(abs, 'utf8');
  try {
    new vm.Script(code, { filename: s });
    checked++;
  } catch (e) {
    chk(false, s + ' 无法解析：' + e.message);
  }
}
chk(missing === 0, '页面引用的脚本都有对应文件（缺 ' + missing + ' 个）');
chk(checked === scripts.size - missing, '全部 ' + checked + ' 个页面脚本都能解析（语法错 = 整页空白）');

console.log('');
if (fails) { console.log('失败 ' + fails + ' 项'); process.exit(1); }
console.log('全部通过');
