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


// ---------------------------------------------------------------------------
// 另一半：**脚本改好了，老用户的缓存里还是坏的**
//
// Issue #356 第一次修完（PR #442）用户回来说「还是空白」—— 因为 sw.js 的
// CACHE_NAME 一个字没动。这个 SW 对 js/css 是**缓存优先**（先 caches.match，
// 命中就不发网络），而 CACHE_NAME 不变 → activate 不删旧缓存 →
// 浏览器拿不到新版 js/game.js，白屏照旧。
//
// 所以「改了页面脚本」这件事，必须同时把缓存版本推一格。这里把它钉住：
// 版本号只许往上、且不低于 #442 之后的 310。
// ---------------------------------------------------------------------------
const swSrc = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const ver = parseInt((swSrc.match(/poem-app-v(\d+)/) || [0, '0'])[1], 10);
chk(ver >= 310, 'sw.js 缓存版本 ≥ v310（改过 game.js 就必须推，否则老用户仍是坏的缓存，实际 v' + ver + '）');

// 页面脚本这一层是缓存优先的：先查缓存、命中即返回，不发网络。
// 只有版本号变了（CACHE_NAME 变 → activate 删旧缓存）才换得到新的。
chk(/caches\.match\(req\)\.then/.test(swSrc),
  '页面脚本走缓存优先（所以版本号是唯一的换新开关 —— 改脚本必须推它）');
chk(/k === CACHE_NAME \? null : caches\.delete\(k\)/.test(swSrc),
  'activate 里删掉所有非当前版本的缓存（版本一推，旧缓存即清）');

// /dahui/ 那一页的脚本清单里必须有 game.js，且它进得了预缓存
chk(/\.\/js\/game\.js/.test(swSrc), 'game.js 在 SW 预缓存清单里（离线也读得到那一页）');


console.log('');
if (fails) { console.log('失败 ' + fails + ' 项'); process.exit(1); }
console.log('全部通过');
