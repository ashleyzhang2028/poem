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
// 法务页也纳入文案/配色检查，避免新页面漏挂主题
const legalHtml = read('terms.html') + read('privacy.html');
const allSrc = app + html + classicHtml + legalHtml + read('js/classic.js') + read('js/pwa.js');

chk(app.indexOf('这首歌按遗忘曲线到期了') === -1, '不再出现「这首歌按遗忘曲线到期了」');
chk(/APP_NAME\s*=\s*"跬步"/.test(app), '应用正式名称为「跬步」');
chk(html.indexOf('<title>跬步 · 古诗词背诵</title>') !== -1, '首页标题为「跬步 · 古诗词背诵」');
chk(!/积跬步古诗词/.test(html + legalHtml), '页面不再出现「积跬步古诗词」旧名');
chk(/"name":\s*"跬步/.test(read('manifest.webmanifest')), 'PWA 清单名称为跬步');
chk(app.indexOf('这首诗按遗忘曲线到期了') !== -1, '到期提示改为「这首诗按遗忘曲线到期了」');
chk(!/这首歌/.test(allSrc), '全站不再出现把诗词称作「歌」的措辞');
// 需求 1：首页任务条标题精简为「今日背诵」
chk(html.indexOf('>今日背诵<') !== -1 && html.indexOf('今日背诵任务') === -1,
  '首页标题为「今日背诵」，不再写「今日背诵任务」');
// 需求 4：播放栏不再有「正在朗读 / 暂停 / 继续 / 下一篇 / 停止」这些文字
const reader = read('js/reader.js');
// 只看可见文案（HTML 文本节点），aria-label / title 是给读屏软件的，允许保留
const visibleText = (reader.match(/>[^<>{}]*</g) || []).join('');
chk(!/暂停|继续|下一篇|停止|正在朗读|播放/.test(visibleText),
  '播放栏可见文案里不再出现「暂停 / 继续 / 下一篇 / 停止 / 正在朗读」');
chk(/iconPlay|iconPause|iconStop|iconPrev|iconNext/.test(reader), '播放栏改用 SVG 图标表达状态');
const appSrc = read('js/app.js');
chk(!/"今日 " \+ todayPlan\.length \+ " 首"/.test(appSrc), '播放栏不再显示「今日 N 首」');

/* ---------------- 2. Web Font ---------------- */
const css = read('css/style.css');
const classicCss = read('css/classic.css');

// 需求 5：今日朗读按钮是圆形播放键（与 0/5 圆环成对）
chk(/\.today-read\s*\{[^}]*border-radius:\s*50%/.test(css), '今日朗读按钮是圆形（与 0/5 圆环成对）');
// 需求 6：列表单项右侧按钮是圆形播放键
chk(/\.item-read\s*\{[^}]*border-radius:\s*50%/.test(css), '列表单项右侧按钮是圆形播放键');
// 需求 7：详情页仍是「小喇叭 + 朗读」文字按钮，没有被改成纯图标
chk(/\.mini-btn \.btn-icon/.test(classicCss), '详情页朗读按钮保持「小喇叭 + 朗读」文字形态');

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

// 需求：古诗 / 小古文正文居中，行距各降一档，列表副信息行距收紧
const poemBlock = /(^|\n)\.poem-text \{([\s\S]*?)\}/.exec(css);
chk(!!poemBlock && /text-align:\s*center;/.test(poemBlock[2]), '古诗正文文字居中');
chk(!!poemBlock && /max-width:\s*fit-content;/.test(poemBlock[2]) && /margin:\s*[^;]*\bauto\b/.test(poemBlock[2]),
  '古诗正文块左右居中（fit-content + margin auto）');
chk(!!poemBlock && /line-height:\s*1\.5;/.test(poemBlock[2]), '古诗正文行距为 1.5');
const poemPyBlock = /(^|\n)\.poem-text\.with-pinyin \{([\s\S]*?)\}/.exec(css);
chk(!!poemPyBlock && /line-height:\s*2\.3;/.test(poemPyBlock[2]), '古诗注音档行距为 2.3');
chk(!!poemPyBlock && /white-space:\s*normal;/.test(poemPyBlock[2]), '古诗注音档改回 normal，居中时不被保留空白挤歪');
const listMetaBlock = /(^|\n)\.item-meta \{([\s\S]*?)\}/.exec(css);
chk(!!listMetaBlock && /gap:\s*4px;/.test(listMetaBlock[2]), '列表副信息间距收紧为 4px');
const listMetaGaps = (css.match(/\.item-meta \{([\s\S]*?)\}/g) || []).filter(b => /gap:/.test(b));
chk(listMetaGaps.every(b => !/gap:\s*8px;/.test(b)), '不再有残留的 8px 副信息间距');

// 不再依赖设备自带宋体作为首选
chk(!/font-family:\s*"Songti SC"/.test(css), '不再把设备自带 Songti SC 作为首选字体');

// 关键：字体必须自托管，断网可用（缓存清单里有它）
const sw = read('sw.js');
chk(sw.indexOf('./fonts/NotoSerifSC-400.woff2') !== -1, 'Service Worker 预缓存宋体字库');
chk(sw.indexOf('./fonts/NotoSansSC-400.woff2') !== -1, 'Service Worker 预缓存黑体字库');
chk(!/fonts\.googleapis|fonts\.gstatic/.test(css + html + classicHtml), '不请求任何第三方字体 CDN');
chk(!/fonts\.googleapis|fonts\.gstatic/.test(legalHtml), '法务页同样不请求第三方字体 CDN');

/* ---------------- 3. 传统色（宋代） ---------------- */
chk(/宋代/.test(css), '配色注释标明宋代取色');
// 天青主色
// 主色：雨过天青压深到 #2f6055（提升对比度，白底文字过 WCAG AA）
chk(/--green:\s*#2f6055/.test(css), '主色为加深后的雨过天青 #2f6055');
chk(!/--green:\s*#4d7d74/.test(css), '不再使用对比度不足的旧天青 #4d7d74');
// 宣纸底
chk(/--bg:\s*#f6f1e3/.test(css), '底色为素绢米灰 #f6f1e3');
chk(/--card:\s*#fffefa/.test(css), '卡片为宣纸白 #fffefa');
chk(/--ink:\s*#241d18/.test(css), '正文墨色加深到 #241d18（提升对比度）');
chk(/--ink-2:\s*#6b5c4d/.test(css), '次要文字淡墨加深到 #6b5c4d');
// 传统色名
['天青', '宣纸', '琥珀', '朱砂', '缃色', '秋香'].forEach(n => chk(css.indexOf(n) !== -1, '出现传统色名「' + n + '」'));
// 不应残留旧绿色
chk(!/#4a7c59/.test(css), '不再使用旧品牌绿 #4a7c59');
chk(!/#4a7c59/.test(html + classicHtml), '页面 theme-color 不再使用旧品牌绿');
chk(!/#4a7c59/.test(legalHtml), '用户协议 / 隐私条款页 theme-color 也不再使用旧品牌绿');
chk(!/#4a7c59/.test(read('manifest.webmanifest')), 'PWA 清单不再使用旧品牌绿');
chk(/"theme_color":\s*"#2f6055"/.test(read('manifest.webmanifest')), 'PWA 清单主题色为加深后的天青');
chk(/"background_color":\s*"#f6f1e3"/.test(read('manifest.webmanifest')), 'PWA 清单背景色为素绢（与 --bg 同步）');

/* ---------------- 3b. 底部播放栏（宋式美学播放器） ---------------- */
const pbBlock = /(\.player-bar \{[\s\S]*?\n\})/.exec(css);
chk(!!pbBlock, '样式里有 .player-bar（底部播放栏）');
const pb = pbBlock ? pbBlock[1] : '';
chk(/position:\s*fixed/.test(pb), '播放栏固定定位');
chk(/left:\s*0;/.test(pb) && /right:\s*0;/.test(pb), '播放栏左右贴边占满整个底部宽度');
chk(/bottom:\s*0;/.test(pb), '播放栏贴住屏幕底部（不再是 margin 浮起）');
chk(!/border-radius/.test(pb), '播放栏不再有圆角，是整块弹出的播放器');
chk(/linear-gradient/.test(pb), '播放栏用宋式深天青渐变，明暗有层次');
chk(/border-top:\s*1px solid rgba\(240, 205, 124/.test(pb), '顶边一支描金细线（缃色）');
// 高度加大：上下 padding 合计大于旧版 20px
const padNum = (pb.match(/padding:[^;]+;/) || [''])[0].match(/(\d+)px/g) || [];
chk(padNum.length >= 2 && parseInt(padNum[0]) >= 14, '播放栏高度加大（padding ' + padNum.join(' ') + '）');
chk(/\.pb-now\s*\{[^}]*font-size:\s*18px/.test(css), '当前一首用大字号（18px）');
chk(/\.pb-next\s*\{[^}]*font-size:\s*11\.5px/.test(css), '下一首用小字号（11.5px）');
chk(/\.pb-toggle\s*\{[^}]*46px/.test(css), '播放 / 暂停主按钮更大（46px）');
chk(/\.pb-toggle\s*\{[^}]*var\(--gold\)/.test(css), '主按钮用缃色（与进度环同色）');

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


/* ---------------- 7. 设置整页 + 底部导航栏不遮挡 ---------------- */
const settingsHtml = read('settings.html');
const settingsJs = read('js/settings.js');
const pwaJs = read('js/pwa.js');

// 需求：设置不再向上弹卡片，而是全新的整页
chk(html.indexOf('settings-modal') === -1, '首页不再有向上弹出的设置卡片（settings-modal 已删除）');
chk(/href="\.\/settings\.html"/.test(html), '首页齿轮跳转到设置整页');
chk(settingsHtml.indexOf('id="settings-page"') !== -1, '设置页有独立的整页容器');
chk(settingsHtml.indexOf('settings-modal') === -1, '设置页不再用弹层结构');
chk(settingsHtml.indexOf('class="foot settings-foot"') !== -1, '设置页底部有页脚（版权 + 法务链接）');

// 需求：设置页底部不被底部导航栏遮挡 —— 统一由 --nav-h 这条基准线决定
chk(/--nav-h:\s*0px/.test(css), '定义了底部导航栏高度变量 --nav-h');
chk(/\.settings-page \{[\s\S]*?padding-bottom:\s*calc\([^)]*--nav-h/.test(css),
  '设置页留出导航栏高度，最后一行不会被压住');
chk(/body\.has-audio-player \.app/.test(css) && !/padding-bottom:\s*calc\(150px/.test(css),
  '页面留白改为实测高度（不再写死 150px）');
chk(/\.ios-install-tip \{[\s\S]*?bottom:\s*calc\(12px \+ var\(--nav-h\)\)/.test(css),
  'iOS 引导条按基准线避让，不再盖住页脚');
chk(/\.toast \{[\s\S]*?bottom:\s*calc\(24px \+ var\(--nav-h\)\)/.test(css),
  '吐司提示按基准线避让');
chk(/window\.PWA\.syncBottomGap = syncBottomGap/.test(pwaJs),
  'js/pwa.js 暴露 syncBottomGap 供各页统一刷新留白');
chk(/measureBottomNav/.test(pwaJs) && /ResizeObserver/.test(pwaJs),
  '播放栏高度变化时会重新测量底部留白');
chk(/settings\.html/.test(read('sw.js')) && /js\/settings\.js/.test(read('sw.js')),
  'Service Worker 预缓存设置页，断网也可进设置');

// 法务链接在设置页底部；设置页自身也应有返回入口
chk(/返回/.test(settingsHtml) || /href="\.\/index\.html"/.test(settingsHtml),
  '设置页有返回首页的入口');
chk(/invalidatePlan/.test(settingsJs), '设置页改配置后会让首页的今日计划缓存失效');


/* ---------------- 4b. 字体子集必须覆盖站点实际用到的字 ---------------- */
/**
 * 自托管字体是「按站点用字子集化」的，一旦子集做旧了，页面上的字就会
 * 悄悄缺笔画（曾经「用户协议 / 隐私条款」被渲染成「用户 / 隐私条」）。
 * 这里用 fontTools 直接读 cmap 做覆盖校验：CI 装了 fonttools 才校验，
 * 没装则跳过（本地可 pip install fonttools brotli）。
 */
let subsetChecked = false;
try {
  const { execFileSync } = require('child_process');
  execFileSync('python3', ['-c', 'import fontTools'], { stdio: 'ignore' });
  const fontsDir = path + 'fonts/';
  const need = ['用户协议', '隐私条款', '跬步', '设置', '朗读', '拼音', '诗词', '©'];
  const script = `
import sys, json
from fontTools.ttLib import TTFont
chars = sys.argv[1]
out = {}
for name in ['NotoSansSC-400','NotoSansSC-600','NotoSerifSC-400','NotoSerifSC-600']:
    cmap = TTFont('${fontsDir}%s.woff2' % name).getBestCmap()
    out[name] = [c for c in chars if ord(c) not in cmap]
print(json.dumps(out, ensure_ascii=False))
`;
  const res = JSON.parse(execFileSync('python3', ['-c', script, need.join('')], { encoding: 'utf8' }));
  Object.keys(res).forEach(name => {
    chk(res[name].length === 0,
      name + ' 覆盖站会用字（缺失：' + (res[name].join('') || '无') + '）');
  });
  subsetChecked = true;
} catch (e) {
  console.log('(未安装 fonttools，跳过字体子集覆盖检查：pip install fonttools brotli)');
}

console.log(fails === 0 ? '\n🎉 主题测试全部通过' : '\n❌ ' + fails + ' 项失败');
process.exit(fails ? 1 : 0);
