/**
 * 主题专项测试：文案 / Web Font / 传统色 / favicon
 *
 * 对应 Issue #1 的四项需求：
 *   1. 古诗词站不应出现「这首歌」这类措辞
 *   2. 诗词的标题 / 朝代 / 作者 / 正文使用自托管的宋体 Web Font
 *   3. 页面为宋代传统配色（天青 / 宣纸 / 琥珀 / 朱砂 / 缃色）
 *   4. favicon 为重新设计的矢量图标，各尺寸 PNG 齐全
 *
 * 运行：node test/theme.test.js
 */
const fs = require('fs');
const path = __dirname + '/../';
const read = f => fs.readFileSync(path + f, 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

/* ---------------- 1. 文案 ---------------- */
const app = read('js/app.js');
const html = read('index.html');
const classicHtml = read('classic.html');
const allSrc = app + html + classicHtml + read('js/classic.js') + read('js/pwa.js');

chk(app.indexOf('这首歌按遗忘曲线到期了') === -1, '不再出现「这首歌按遗忘曲线到期了」');
chk(app.indexOf('这首诗按遗忘曲线到期了') !== -1, '到期提示改为「这首诗按遗忘曲线到期了」');
chk(!/这首歌/.test(allSrc), '全站不再出现把诗词称作「歌」的措辞');

/* ---------------- 2. Web Font ---------------- */
const css = read('css/style.css');
const classicCss = read('css/classic.css');

chk(/@font-face/.test(css), '样式里声明了 @font-face 自托管字体');
chk(/font-family:\s*"Poem Serif SC"/.test(css), '声明了宋体族 Poem Serif SC');
chk(/--font-poem:/.test(css), '定义了诗词字体变量 --font-poem');
chk(/--font-ui:/.test(css), '定义了界面字体变量 --font-ui');

// 字体文件真的存在，并且是 woff2
const fonts = ['NotoSerifSC-400.woff2', 'NotoSerifSC-600.woff2', 'NotoSansSC-400.woff2', 'NotoSansSC-600.woff2'];
fonts.forEach(f => {
  const p = path + 'fonts/' + f;
  const ok = fs.existsSync(p) && fs.statSync(p).size > 1024;
  chk(ok, '字体文件存在且非空：fonts/' + f);
});
chk(fs.readFileSync(path + 'fonts/NotoSerifSC-400.woff2').slice(0, 4).toString('latin1') === 'wOF2',
  '字体为 WOFF2 格式');

// 诗词的四个元素都走宋体变量
chk(/\.item-title\s*\{[^}]*font-family:\s*var\(--font-poem\)/.test(css), '列表诗题使用宋体');
chk(/\.item-meta\s*\{[^}]*font-family:\s*var\(--font-poem\)/.test(css), '列表朝代/作者使用宋体');
chk(/\.modal-head h2[\s\S]{0,300}?var\(--font-poem\)/.test(css), '弹层诗题使用宋体');
chk(/\.poem-text[\s\S]{0,200}?var\(--font-poem\)/.test(css), '诗词正文使用宋体');
chk(/\.tag\s*\{[^}]*font-family:\s*var\(--font-poem\)/.test(css), '朝代/作者标签使用宋体');
chk(/\.reader-text[\s\S]{0,300}?var\(--font-poem\)/.test(classicCss), '小古文正文使用宋体');
chk(/\.reader-body h2[\s\S]{0,300}?var\(--font-poem\)/.test(classicCss), '小古文标题使用宋体');

// 不再依赖设备自带宋体作为首选
chk(!/font-family:\s*"Songti SC"/.test(css), '不再把设备自带 Songti SC 作为首选字体');

// 关键：字体必须自托管，断网可用（缓存清单里有它）
const sw = read('sw.js');
chk(sw.indexOf('./fonts/NotoSerifSC-400.woff2') !== -1, 'Service Worker 预缓存宋体字库');
chk(sw.indexOf('./fonts/NotoSansSC-400.woff2') !== -1, 'Service Worker 预缓存黑体字库');
chk(!/fonts\.googleapis|fonts\.gstatic/.test(css + html + classicHtml), '不请求任何第三方字体 CDN');

/* ---------------- 3. 传统色（宋代） ---------------- */
chk(/宋代/.test(css), '配色注释标明宋代取色');
// 天青主色
chk(/--green:\s*#4d7d74/.test(css), '主色为雨过天青 #4d7d74');
// 宣纸底
chk(/--bg:\s*#efe7d7/.test(css), '底色为素绢米灰 #efe7d7');
chk(/--card:\s*#fdfaf2/.test(css), '卡片为宣纸白 #fdfaf2');
// 传统色名
['天青', '宣纸', '琥珀', '朱砂', '缃色', '秋香'].forEach(n => chk(css.indexOf(n) !== -1, '出现传统色名「' + n + '」'));
// 不应残留旧绿色
chk(!/#4a7c59/.test(css), '不再使用旧品牌绿 #4a7c59');
chk(!/#4a7c59/.test(html + classicHtml), '页面 theme-color 不再使用旧品牌绿');
chk(!/#4a7c59/.test(read('manifest.webmanifest')), 'PWA 清单不再使用旧品牌绿');
chk(/"theme_color":\s*"#4d7d74"/.test(read('manifest.webmanifest')), 'PWA 清单主题色为天青');
chk(/"background_color":\s*"#efe7d7"/.test(read('manifest.webmanifest')), 'PWA 清单背景色为素绢');

/* ---------------- 4. favicon ---------------- */
const icon = read('icons/icon.svg');
chk(/<svg/.test(icon), 'favicon 使用 SVG');
chk(!/font-family|text|Noto/.test(icon), 'favicon 用矢量笔画绘制，不依赖字体');
chk(/#4d7d74|#37605a/.test(icon), 'favicon 使用天青主色');
chk(/#a83b32|#c8564a/.test(icon), 'favicon 带朱砂印');
chk(/诗|讠/.test(icon), 'favicon 备注里有「诗」字说明');

['icons/icon-120.png', 'icons/icon-152.png', 'icons/icon-167.png', 'icons/icon-180.png',
 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-256.png',
 'icons/icon-384.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'].forEach(f => {
  const p = path + f;
  chk(fs.existsSync(p) && fs.statSync(p).size > 1024, '图标存在：' + f);
});

// PNG 尺寸真的对（读 IHDR）
const pngSize = p => {
  const b = fs.readFileSync(path + p);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};
const expected = {
  'icons/icon-120.png': 120,
  'icons/icon-152.png': 152,
  'icons/icon-167.png': 167,
  'icons/icon-180.png': 180,
  'icons/apple-touch-icon.png': 180,
  'icons/icon-192.png': 192,
  'icons/icon-256.png': 256,
  'icons/icon-384.png': 384,
  'icons/icon-512.png': 512,
  'icons/icon-maskable-512.png': 512
};
Object.keys(expected).forEach(f => {
  const s = pngSize(f);
  chk(s.w === expected[f] && s.h === expected[f], f + ' 尺寸为 ' + expected[f] + '×' + expected[f]);
});

// maskable 与普通图标必须不同（maskable 内容要缩进安全区）
const norm = fs.readFileSync(path + 'icons/icon-maskable-512.png');
const any = fs.readFileSync(path + 'icons/icon-512.png');
chk(Buffer.compare(norm, any) !== 0, 'maskable 图标与普通图标是两份不同的图');

console.log(fails === 0 ? '\n🎉 主题测试全部通过' : '\n❌ ' + fails + ' 项失败');
process.exit(fails ? 1 : 0);
