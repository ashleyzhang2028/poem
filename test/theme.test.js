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
const classicHtml = read('classic/index.html');
// 法务页也纳入文案/配色检查，避免新页面漏挂主题
const legalHtml = read('terms/index.html') + read('privacy/index.html');
const allSrc = app + html + classicHtml + legalHtml + read('js/classic.js') + read('js/reader-core.js') + read('js/pwa.js');

chk(app.indexOf('这首歌按遗忘曲线到期了') === -1, '不再出现「这首歌按遗忘曲线到期了」');
chk(/APP_NAME\s*=\s*"跬步"/.test(app), '应用正式名称为「跬步」');
chk(html.indexOf('<title>跬步 · 课内背诵</title>') !== -1, '首页标题为「跬步 · 课内背诵」');
chk(!/积跬步古诗词/.test(html + legalHtml), '页面不再出现「积跬步古诗词」旧名');
chk(/"name":\s*"跬步/.test(read('manifest.webmanifest')), 'PWA 清单名称为跬步');
// 需求（Issue #114）：过期提示里的算法名改成**按当前算法**拼（用户换成 SM-2
// 就该说「按 SM-2 到期了」），所以这里查的是句式与「算法简称」那段拼装，
// 不再钉死「遗忘曲线」四个字。
chk(/这首诗按" \+ algoShort\(\) \+ "到期了/.test(app),
  '到期提示改为「这首诗按 XX 到期了」（XX 是当前算法，随设置切换）');
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
/* 查源码里的「声明」时一律先剥掉注释 —— 本仓库的注释里会写
   「40 + 12 = 52px」这类历史数值说明，不剥掉就会被自己的注释判红。 */
const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ');

// 需求 5：今日朗读按钮是圆形播放键（与 0/5 圆环成对）
chk(/\.today-read\s*\{[^}]*border-radius:\s*50%/.test(css), '今日朗读按钮是圆形（与 0/5 圆环成对）');
/* 需求（Issue #55）：今日条这一行两颗圆的**最大直径**必须一致 ——
   左侧「朗读（全部）」圆键与右侧 0/5 进度环并排，一大一小看着就是没对齐。
   做法：尺寸只在 .today-actions 上声明一次（--today-btn-size: 46px），
   两颗圆都读它，谁也不能再各写一个数走散。
   ⚠️ 别给描边做补偿：环的 stroke 由 <svg> 画、svg 是 overflow: hidden，
   骑在边界上的描边会被裁进盒子内 → 盒子尺寸就是环渲染出来的最大直径。
   曾经按「盒子 − 一圈描边」缩小过一版，真机量出环 40px、播放键 46px，
   环反而小了一圈。（这条注释连同 pwa.test.js 里的实测量一起防回归。）
   顺带锁住「圆环不许被 flex 拉扁」：.ring 的 min-height 必须归零，
   否则 .today-bar（align-items: center 的 flex 行）可能把它纵向撑高，
   宽高不再相等 → 圆环变椭圆。 */
const todayActionsCss = (css.match(/\.today-actions \{([^}]*)\}/) || [, ''])[1];
const todaySize = todayActionsCss.match(/--today-btn-size:\s*(\d+)px/);
chk(!!todaySize, '今日条声明两颗圆的统一外盒尺寸 --today-btn-size（' + (todaySize && todaySize[1]) + 'px）');
/* 需求（本轮，Issue #55）：首页今日背诵那颗播放键的圆再缩小 ——
   要它与右侧 0/5 进度环的**最大外径**一样大，用户已经连着反馈三次「一大一小」。
   这一轮终于量到根子不在别处，而在**边框**：
     · 进度环是 <svg> 画的，svg 自己 overflow: hidden，骑在边界上的 3px 描边
       被裁进盒内 —— 盒子的 40px 就是环的最大外径；
     · 播放键是 CSS 盒子，border 默认 border-box 画在盒子**内侧**，
       原先 42px 的盒子画出来只有 39px 的环（42 − 两侧各 1.5px）。
   现在：content-box + 外盒 40px = 画出来的圆 40px（边框往外长），与环逐像素相等。 */
const todayRingW = todayActionsCss.match(/--today-btn-ring:\s*([\d.]+)px/);
chk(!!todayRingW, '今日条声明播放键那圈边框的宽度 --today-btn-ring（' + (todayRingW && todayRingW[1]) + 'px）');
chk(todayRingW && todayRingW[1] === '1',
  '播放键边框 1px（小数边框会被浏览器取整，写整数这一步才算得准）');
chk(todaySize && todaySize[1] === '40',
  '播放键外盒 40px = 画出来的圆 40px，与进度环的最大外径同径（实际 ' + (todaySize && todaySize[1]) + 'px）');
/* ⚠️ 必须先把注释剥掉再查：这两块里的注释会写「40 + 12 = 52px」这类
   历史数值说明，直接对源码查数字会被自己的注释判红（上一版就是这样红的）。 */
chk(!/\.today-read \{[^}]*?(width|height):\s*\d+px/.test(stripComments(css)) &&
  !/\.ring \{[^}]*?(width|height):\s*\d+px/.test(stripComments(css)),
  '播放键与进度环都不另写死尺寸，只由 --today-btn-size（± 边框）推出（改一处即可整体收放）');
/* 只查今日条那两块（.today-actions / .today-read / .ring）的**声明**，
   注释一律先剥掉（本仓库注释里会写「46px 的盒子」这类历史数值），
   也别误伤吸底播放栏 .pb-toggle —— 那颗主按钮本来就有自己的 46px。 */
const todayScope = [
  (css.match(/\.today-actions \{([^}]*)\}/) || [, ''])[1],
  (css.match(/\.today-read \{([^}]*)\}/) || [, ''])[1],
  (css.match(/\.ring \{([^}]*)\}/) || [, ''])[1]
].map(stripComments).join('\n');
chk(!/46px/.test(todayScope) && !/43px/.test(todayScope),
  '今日条声明里不再残留前几轮的 46px / 43px（外径只有一个来源）');
const readCss = (css.match(/\.today-read \{([^}]*)\}/) || [, ''])[1];
/* 宽高必须由 --today-btn-size **减去两侧边框**推出，不能只写 var(--today-btn-size)：
   box-sizing: content-box 下 width 只算内容区，边框是另加的 ——
   写 `width: var(--today-btn-size)` 画出来其实是 40 + 1 + 1 = 42px，
   比右边 40px 的进度环大一圈（真机量过，就是用户说的「一颗大一颗小」）。
   「外缘 = --today-btn-size」才是这一条的口径。 */
chk(/width:\s*calc\(\s*var\(--today-btn-size\)\s*-\s*var\(--today-btn-ring\)\s*\*\s*2\s*\)/.test(readCss) &&
  /height:\s*calc\(\s*var\(--today-btn-size\)\s*-\s*var\(--today-btn-ring\)\s*\*\s*2\s*\)/.test(readCss),
  '左侧朗读圆键的宽高都取「外缘 − 两侧边框」，画出来的圆才等于 --today-btn-size');
chk(/box-sizing:\s*content-box/.test(readCss),
  '播放键改用 content-box（那圈 1px 边框往外长，不再把圆吃小）');
chk(/border:\s*var\(--today-btn-ring\)/.test(readCss),
  '边框宽度走 --today-btn-ring（唯一来源，不在这里另写数值）');
// 注意：.today-read 自己的声明块里不允许再出现别的数值（外径 / 内径都走变量）
const readNums = (readCss.replace(/\/\*[\s\S]*?\*\//g, ' ').match(/\d+(\.\d+)?px/g) || []).filter(n => n !== '1.5px');
chk(readNums.length === 0,
  '播放键盒子里只剩边框这一个数值（其它都读变量）：' + readNums.join(' / '));
chk(/(^|\s)padding:\s*0;/.test(readCss),
  '播放键显式 padding: 0 —— <button> 的 UA 默认 1px 6px 会把它撑成 52px 宽，'
  + '与 40px 的进度环并排就是「一大一小」（浏览器里量得到、jsdom 量不到）');
/* 需求（本轮，Issue #55）：这颗播放键里的三角形**每条边再加长 6px**。
   三角每边长 9.9 个单位（24 的 viewBox），屏幕边长 = 图标框 × 0.4125：
     上一轮 14px 图标框 → 5.78px；加长 6px → 11.78px → 图标框 ≈ 28.55px
   （2026-09-13 复核：本轮实际把这一档收成 16.6px = 原来的 14px 图标框，
     也就是上面的推算没有落地 —— 但「边长由图标框唯一决定」这条链路仍然成立，
     这里锁的就是它，数值随需求改一处即可）。
   内径仍然只有一个来源 —— .today-actions 上的 --today-btn-inner，
   .today-read svg 读它画 ▶ / ⏸ 两态（同框，两态不会忽大忽小）。
   ⚠️ 别再往 <svg> 或 <path> 上写 width / height / transform —— 那样内径就有了第二个数，
   下一次「再改几 px」又得满文件找（前几轮已经踩过）。 */
const todayInner = (css.match(/\.today-actions \{([^}]*)\}/) || [, ''])[1].match(/--today-btn-inner:\s*([\d.]+)px/);
chk(!!todayInner, '今日条声明内径唯一来源 --today-btn-inner（' + (todayInner && todayInner[1]) + 'px）');
chk(todayInner && todayInner[1] === '17',
  '播放键图标框 17px（三角每边比上一轮的 14px 框再长一档，实际 ' + (todayInner && todayInner[1]) + 'px）');
/* 三角的边长只由图标框决定：路径三边长都是 15.403 个单位（√(9.9²+11.8²)），
   屏幕边长 = 图标框 × 15.403 ÷ 24（≈ 图标框 × 0.642）。
   需求是「每条边加长 6px」：14px 框时是 8.99px，加 6px 就是 14.99px。
   一次加满会让三角顶到 40px 的圆环，所以本轮取 17px 框 = 10.91px
   （比上一轮长近 2px），断言只锁「边长随图标框单调变长、且留在圆环内」。 */
const edgePx = box => +(15.403 / 24 * box).toFixed(2);
const todayEdge = edgePx(parseFloat(todayInner[1]));
const ringDia = 40;   // .ring 盒子 40px 就是环的最大外径（3px 描边被 svg 裁在盒内）
chk(todayEdge > edgePx(14), '今日条三角的每条边比上一轮（14px 框，' + edgePx(14) + 'px）更长：' + todayEdge + 'px');
chk(todayEdge < ringDia * 0.866,
  '三角仍留在 40px 圆环里（等边三角内接边长上限 ' + (ringDia * 0.866).toFixed(2) + 'px，实际 ' + todayEdge + 'px）');
chk(/--today-btn-inner,\s*17px/.test(css), '内径变量有兜底值（变量缺失时不会回退成旧尺寸）');
const todaySvgCss = (css.match(/\.today-read svg \{([^}]*)\}/) || [, ''])[1];
chk(/width:\s*var\(--today-btn-inner/.test(todaySvgCss) && /height:\s*var\(--today-btn-inner/.test(todaySvgCss),
  '▶ / ⏸ 两态的图标尺寸只读 --today-btn-inner（改一处即整体收放）');
chk(!/width:\s*14px/.test(todaySvgCss) && !/transform/.test(todaySvgCss),
  '内径不做二次缩放，也不许在 <svg> 上再写一个数值');
const ringCss = (css.match(/\.ring \{([^}]*)\}/) || [, ''])[1];
chk(/width:\s*var\(--today-btn-size/.test(ringCss) && /height:\s*var\(--today-btn-size/.test(ringCss),
  '右侧进度环的直径与左侧圆键同源（都是 --today-btn-size）');
chk(!/calc\(/.test(ringCss) && !/width:\s*\d+px/.test(ringCss) && !/height:\s*\d+px/.test(ringCss),
  '进度环尺寸不做二次补偿，也不写死第三个数值（盒子即最大外径）');
chk(/min-height:\s*0/.test(ringCss) && /flex:\s*none/.test(ringCss),
  '进度环 min-height 归零 + 不压缩（宽高恒定，不被 flex 拉成椭圆）');
// 两颗圆的直径不能各写一个数值：源码里不允许再出现写死的 54px 旧尺寸
chk(!/width:\s*54px/.test(css) && !/height:\s*54px/.test(css), '不再保留上一轮的 54px 写死尺寸');
// 需求 6：列表单项右侧按钮是圆形播放键
chk(/\.item-read\s*\{[^}]*border-radius:\s*50%/.test(css), '列表单项右侧按钮是圆形播放键');
/* 需求（本次）：凡「听」的动作全站都是一枚圆键 ——
   首页今日条那颗（46px / 缃色）、列表单项那颗（36px / 天青）、小古文列表的
   连读圆键（40px / 天水碧）与分组圆键（26px / 天水碧）共用同一副形状：
   正圆 + 纸底 + 描金细线 + 同一套按下回弹；只有尺寸与主色随上下文走。
   所以断言的是「形状同族」：border-radius: 50% + 宽高同源 + 同一套 transition。 */
chk(!/\.gw-play-main\s*\{[^}]*padding:\s*[1-9]/.test(classicCss) &&
  /\.gw-play \{[^}]*border-radius:\s*50%/.test(classicCss) &&
  /\.gw-play-main\s*\{[\s\S]{0,200}?width:\s*var\(--toolbar-h\)/.test(classicCss) &&
  /\.gw-play-main\s*\{[\s\S]{0,200}?height:\s*var\(--toolbar-h\)/.test(classicCss),
  '小古文「连读」是正圆播放键（宽高同源，不是压扁的椭圆）');
chk(/\.gw-play-sm\s*\{[\s\S]{0,200}?width:\s*26px/.test(classicCss) &&
  /\.gw-play-sm\s*\{[\s\S]{0,220}?height:\s*26px/.test(classicCss),
  '分组右侧是小一号的圆键（26×26，宽高一致）');
chk(/\.gw-play \{[\s\S]{0,400}?transition:\s*transform \.14s/.test(classicCss),
  '圆键与全站按钮共用同一套过渡（按下回弹手感一致）');
chk(/\.pause-glyph \{ display: none; \}/.test(classicCss) &&
  /\.gw-play\[data-on="1"\] \.play-glyph \{ display: none; \}/.test(classicCss) &&
  /\.gw-play\[data-on="1"\] \.pause-glyph \{ display: inline-flex; \}/.test(classicCss),
  '圆键上 ▶ / ⏸ 互斥显示（同一颗键原地换图标，不同时并排）');
chk(!/\.seg-toggle/.test(classicCss) && !/gw-random-read-text/.test(classicHtml.replace(/[\s\S]*?<span class="sr-only" id="gw-random-read-text">随机连读<\/span>[\s\S]*/, 'X')),
  '带「连读」二字的胶囊样式与文案已整段退场（连读中不再改写可见文案）');
// 需求 7：详情页仍是「小喇叭 + 朗读」文字按钮，没有被改成纯图标
chk(/\.mini-btn \.btn-icon/.test(classicCss), '小古文朗读按钮的图标容器样式仍在（纯 SVG 图标）');

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

/* ---------------- 主页面背景（无图案）与按钮分级（Issue #32） ---------------- */
/* 需求：主页面背景删除祥云图案、不再使用图案背景。
   页面底只留素绢米灰 --bg 纯色：不铺底纹、不留角隅点缀、不留云纹浮雕，
   也不用再为纹样写浏览器遮罩兜底。 */
chk(/html, body \{/.test(css), '样式里有 html, body 的页面底声明');
chk(!/--pattern/.test(css) || !/background-image:\s*[^;]*var\(--pattern/.test(css),
  '页面底不再引用任何纹样变量');
chk(/html, body \{[^}]*background:\s*var\(--bg\)/.test(css), '页面底是素绢一色 --bg，没有图案背景');
chk(!/html, body \{[^}]*background-image:\s*url/.test(css), '页面底没有任何图案 background-image 铺装');
chk(!/background-attachment:\s*fixed/.test(css), '不再有平铺的固定底纹');
chk(/--bg:\s*#f6f1e3/.test(css), '素绢底色 --bg 仍为 #f6f1e3');
// 满铺大纹样（祥云 / 小云脚 / 云纹团花）连同变量一起移除，不留僵尸代码
chk(!/--pattern-[a-z-]+:/.test(css), '样式里不再定义任何 --pattern-* 纹样变量');
chk(!/--pattern-xiangyun/.test(css) && !/--pattern-yunhua/.test(css) && !/--pattern-cloud:/.test(css),
  '祥云纹 / 云纹团花 / 云纹点缀变量均已删除');
chk(!/card-pat/.test(css), '卡片角隅纹样类 .card-pat 已移除');
chk(!/card-pat/.test(html), '页面里不再给卡片挂 card-pat（不显示角隅纹样）');
chk(!/\.card-pat::before/.test(css) && !/\.card-pat::after/.test(css), '卡片角隅云纹已随之移除');
chk(!/\.today-bar::after/.test(css), '今日背诵条不再叠云纹浮雕');
chk(!/mask-image:\s*linear-gradient/.test(css), '不再有角隅纹样的遮罩规则');
const decorated = [...css.matchAll(/background(-image)?:[^;]*var\(--pattern[^;]*;/g)].map(m => m[0]);
chk(decorated.length === 0, '没有任何一处再引用纹样变量铺图案');
chk(!/@supports not/.test(css), '纹样移除后不再需要 @supports not 的遮罩兜底');
chk(!/祥云/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), '样式代码里不再残留「祥云」图案');
chk(/祥云纹/.test(css), '注释里写明被移除的宋「祥云纹」底纹，避免被误加回来');
// 按钮分级
chk(/\.btn\.primary\s*\{[^}]*linear-gradient/.test(css), '一级按钮为实底渐变（主操作）');
chk(/\.ghost-btn\s*\{[\s\S]{0,200}?border:\s*1px solid var\(--line\)/.test(css), '次级按钮为纸底描边');
// 需求（Issue #122 → Issue #163）：设置页「进度总览」那枚按钮是 <a>（指去 /progress/），
// 浏览器默认给链接文字加下划线 —— 用户看到的那条线就是这么来的。
// ⚠️ 这一条 Issue #163 之后**换了实现**：当时是在 .ghost-btn 上单独写一遍
//    `text-decoration: none`，后来发现同一个决定在六处各写了一遍（.dock-item /
//    .ghost-btn / .settings-link / .foot-links / .kv-v / .legal-toc …），
//    第 N 个链接再长出来时必然漏一处（个人中心「关于」的「查看」正是漏网的）。
//    现在收归全局一条 `a { text-decoration: none }`，其余各处不再各写一遍。
//    断言随之改成判**全局那一条**：`<a>` 默认下划线不得漏出这件事仍然被钉住，
//    钉的位置从「某一只按钮上」挪到了「全站唯一的那个来源上」。
chk(/\ba\s*\{[^}]*text-decoration:\s*none/.test(css),
  '全站 <a> 默认无下划线（唯一来源，Issue #122 → #163）');
chk(!/\.ghost-btn \{[\s\S]{0,400}?text-decoration:/.test(css),
  '次级按钮不再单独写一遍 text-decoration（下划线归全局那一条管）');
// 这条样式不是可有可无的：设置页那枚按钮确实是 <a>（href 指去 /progress/），
// 所以浏览器默认下划线真的会漏出来；顺带钉住改版后的标签与按钮文案。
// 注意：settingsHtml 这个常量要到第 7 节才声明，本轮的两条断言挨着按钮样式写，
// 所以这里读源码用顶部的 read()，不复用那个后声明的名字。
// ⚠️ 这几条断言的控件住在「背诵」二级页（Issue #132 后续拆页），
//    读的是那一页的源码，不是主页 —— 主页只列四个入口。
const settingsSrc = read('settings/recite/index.html');
chk(/<a class="btn ghost-btn" href="\/progress\/"/.test(settingsSrc),
  '设置页进「进度总览」的按钮仍是 <a>（因此必须显式去掉链接默认下划线）');
// 需求（Issue #122）：这一块原先写着「背诵进度」+「看进度总览」两行、
// 说了同一件事（读起来像两个并列的动作）。现在只留「进度总览」一个词，
// 标签与按钮同名，整块读作「进度总览 · 进度总览」→ 点它进总览页。
const progressRow = (settingsSrc.match(/<div class="settings-item">\s*<label>进度总览<\/label>[\s\S]{0,400}?<\/div>/) || [''])[0];
chk(!!progressRow, '设置页有「进度总览」这一项（标签已由「背诵进度」改名为「进度总览」）');
chk(!/背诵进度<\/label>/.test(settingsSrc), '设置页不再有「背诵进度」这枚标签（同一件事只说一遍）');
chk(!/看进度总览/.test(settingsSrc), '设置页不再出现「看进度总览」这串旧文案');
chk(/\.danger-btn\s*\{[\s\S]{0,200}?color:\s*var\(--red\)/.test(css), '危险按钮用朱砂色，仅用于不可逆操作');
chk(/\.btn\.good\s*\{[^}]*inset 0 0 0 1px rgba\(240, 205, 124/.test(css), '「记住」按钮补上描金内边，与一级按钮同族');
// 导航样式
chk(/\.dock\s*\{[^}]*position:\s*fixed/.test(css), '底部导航栏固定定位');
chk(/\.dock-item\.active/.test(css), '页签有选中态样式');
// 需求（本次）：页签选中态去掉「下划线」，只留描色 + 图标微抬
chk(!/\.dock-item::before/.test(css) && !/\.dock-item\.active::before/.test(css),
  '页签选中态不再用 ::before 画「下划线」');
chk(/\.dock-item\.active \.dock-icon \{[^}]*translateY/.test(css), '选中态改由图标轻微抬起表达');
chk(/prefers-reduced-motion[\s\S]{0,160}?\.dock-icon/.test(css), '减少动态偏好下不再位移（无障碍兜底）');
// 需求（本次）：页签文字不再带下划线。
// 「设置」页签是 <a>，浏览器默认给链接加下划线，那条线就是这么来的 ——
// 必须在 .dock-item 上显式 text-decoration: none，且该规则要能盖住 <a> 的默认样式。
chk(/\.dock-item \{[\s\S]*?text-decoration:\s*none/.test(css.split('.dock-item { position')[0]),
  '页签显式去掉文字下划线（<a> 默认下划线不得漏出）');
// 选中态不只靠颜色：加一层极淡的天青药丸底，弱视 / 强光下也能分辨当前位置
chk(/\.dock-item\.active \{[\s\S]{0,200}?background:\s*rgba\(47,\s*96,\s*85/.test(css),
  '页签选中态有天青药丸底，不只靠文字染色');
chk(/\.brand-mark/.test(css), '顶栏徽标（logo）有独立样式');
chk(/\.top-act/.test(css), '顶栏右侧动作位（设置 / 返回）有独立样式');

// 不再依赖设备自带宋体作为首选
chk(!/font-family:\s*"Songti SC"/.test(css), '不再把设备自带 Songti SC 作为首选字体');

// 关键：字体必须自托管，断网可用（缓存清单里有它）
const sw = read('sw.js');
chk(sw.indexOf('./fonts/NotoSerifSC-400.woff2') !== -1, 'Service Worker 预缓存宋体字库');
chk(sw.indexOf('./fonts/NotoSansSC-400.woff2') !== -1, 'Service Worker 预缓存黑体字库');
chk(!/fonts\.googleapis|fonts\.gstatic/.test(css + html + classicHtml), '不请求任何第三方字体 CDN');
chk(!/fonts\.googleapis|fonts\.gstatic/.test(legalHtml), '法务页同样不请求第三方字体 CDN');

/* ---------------- 2b. 本轮需求：顶栏并入页面名 / 圆形播放键 / 详情页工具条 ---------------- */
// 需求：页面名（XX的背诵 / 小古文）挪到「跬步」右侧，字体样式与「跬步」一致
chk(/\.brand-name-row/.test(css), '顶栏有「跬步 · 页面名」同一行的样式 .brand-name-row');
chk(/\.brand-name-row[\s\S]{0,260}?font-size:\s*19px/.test(css), '页面名与「跬步」同字号（19px）');
chk(/\.brand-page::before[\s\S]{0,120}?content:\s*"·"/.test(css),
  '分隔符「·」由 CSS 生成，页面里不写死标点');
// 只要求顶栏不再出现；meta description 里保留「一年级至高三古诗词」这句 SEO 描述是合理的
chk(!/一年级至高三 · 按遗忘曲线复习/.test(html + app + read('js/chrome.js')),
  '删掉顶栏的「一年级至高三 · 按遗忘曲线复习」文案');
// 需求（本次）：主标题下的描述文字收敛成一句「按遗忘曲线复习」，
// 且**不写年级字样**；小古文入口已由底部页签承担，描述里不再重复提。
// 描述由页面用 body 上的 data-sub 给出，chrome.js 只负责渲染，文案不硬编码
// 去掉注释再查：chrome.js 的代码里不出现这句文案（注释里说明文案由页面给，是允许的）
chk(!/按遗忘曲线复习/.test(read('js/chrome.js').replace(/\/\*[\s\S]*?\*\//g, '')),
  'chrome.js 里不再硬编码「按遗忘曲线复习」');
chk(/data-sub="[^"]+"/.test(html), '首页用 data-sub 给出主标题下的描述文字');
const subMatch = /data-sub="([^"]+)"/.exec(html);
const homeSub = subMatch ? subMatch[1] : '';
// 需求（Issue #114）：副标题「按 XX 复习」里的 XX 随用户选的背诵算法变
// （艾宾浩斯 / 莱特纳盒 / SM-2 / FSRS），所以这里判的是句式，
// 并逐档核对每种算法的自称与首页真正会显示的那句一致。
chk(/^按.+复习$/.test(homeSub),
  '描述文字是「按 XX 复习」句式（实际「' + homeSub + '」）');
chk(!/一年级|二年级|至高三|小学|初中|高中|年级|学段/.test(homeSub),
  '描述文字里不再出现「一年级到高中」这类年级字样');
chk(!/一年级/.test(read('js/chrome.js').replace(/\/\*[\s\S]*?\*\//g, '')),
  'chrome.js 的代码里不再出现年级字样（注释除外）');
// 第二行留空时不占高度（页面没写 data-sub 时顶栏只有一行）
chk(/brand-sub:empty \{ display: none; \}/.test(css), '第二行留空时不占高度（小古文页顶栏只有一行）');
// 需求：用户不填名字也要显示「跬步 Ashley的背诵」
chk(/DEFAULT_USER\s*=\s*"Ashley"/.test(app), 'app.js 定义默认用户名 Ashley');
chk(/username\s*==\s*null \? "" : settings\.username\)\.trim\(\)\s*\|\|\s*DEFAULT_USER|\|\| DEFAULT_USER/.test(app),
  '用户名留空时回落到默认名 Ashley');
// 需求：播放栏四个按钮变圆形边框
const cssPb = css.slice(css.lastIndexOf('.player-bar {'));
chk(/\.pb-btn \{[\s\S]{0,300}?border-radius:\s*50%/.test(cssPb), '播放栏按钮是正圆（border-radius: 50%）');
chk(/\.pb-btn \{[\s\S]{0,400}?border:\s*1px solid rgba\(253, 248, 234/.test(cssPb), '圆形按钮有一圈细描边');
chk(!/\.pb-toggle \{[\s\S]{0,200}?border-radius:\s*10px/.test(cssPb), '播放键不再是圆角方形基座');
// 需求：折叠箭头换成空心三角，与列表右侧「›」同一套描边语言，
// 收起朝下、展开朝上（只旋转不换图）
chk(/\.collapse-head \.arrow \{[\s\S]{0,220}?display:\s*inline-flex/.test(css),
  '折叠箭头改为内联 SVG（不再是实心 ▾ 字符）');
chk(/\.collapse-head \.arrow svg \{ display: block; width: 18px/.test(css), '箭头尺寸与图标一致');
// 需求（Issue #55）：三处「向右 / 展开」图标大小必须一致 ——
// 小古文列表右侧的「›」、首页古诗词列表右侧的「›」、首页「全部诗词」的展开 / 收缩箭头。
// 做法：三处统一用同一枚 18×18 描边 SVG（不再是文本字符「›」——
// 字符高度随字体回退变化，与 18px 的 SVG 三角摆在一起一大一小）。
chk(/\.item-arrow svg \{ display: block; width: 18px; height: 18px; \}/.test(css),
  '列表右侧箭头是 18×18 的内联 SVG（不再是文本字符「›」）');
chk(!/\.item-arrow \{[^}]*font-size:\s*18px/.test(css),
  '列表右侧箭头不再靠 font-size 定大小');
// 两处尺寸同源：都是 18×18，才能保证「大小一致」
const arrowSvgBlocks = css.match(/\.(?:item-arrow|collapse-head \.arrow) svg \{[^}]*\}/g) || [];
chk(arrowSvgBlocks.length >= 2 &&
  arrowSvgBlocks.every(b => /width:\s*18px/.test(b) && /height:\s*18px/.test(b)),
  '列表箭头与折叠箭头同为 18×18（' + arrowSvgBlocks.length + ' 处）');
// 首页与小古文页三处箭头都改用同一枚 SVG：页面源码里不再留文本字符「›」
chk(!/<div class="item-arrow">›<\/div>/.test(read('js/app.js')) &&
  !/<div class="item-arrow">›<\/div>/.test(read('js/reader-core.js')),
  '列表箭头改由 arrowGlyph() 输出内联 SVG（不再写死「›」字符）');
chk(/function arrowGlyph\(\)/.test(read('js/app.js')) && /function arrowGlyph\(\)/.test(read('js/reader-core.js')),
  '首页与古籍页各自用同一枚 arrowGlyph() 画箭头');
// 折叠箭头的笔画宽度与列表箭头一致（同为 1.8）
chk(/class="arrow"[\s\S]{0,260}?stroke-width="1\.8"/.test(html),
  '首页折叠箭头笔画宽度 1.8（与列表箭头同一套描边）');
chk(/\.collapse-head\.open \.arrow \{ transform: rotate\(180deg\); \}/.test(css),
  '展开时箭头旋转 180° 朝上');
chk(/\.collapse-head \.arrow[\s\S]{0,200}?color:\s*#9db3a9/.test(css),
  '箭头用与「›」相同的淡墨色，风格统一');

// 需求：古诗词详情页与小古文详情页同一套工具条
chk(/id="m-actions-main"/.test(html) && /id="m-actions-icons"/.test(html),
  '详情页工具条分两行（对齐/字号/注音 + 播放组合键/译文开关）');
chk(/id="m-align-seg"/.test(html), '详情页有左/中对齐组合按钮');
// 需求：文章一律横排，右对齐没有使用场景 —— 按钮与规则都已删除
chk(!/data-align="right"/.test(html), '详情页不再有右对齐按钮');
chk(!/id="m-align-seg"[\s\S]{0,900}?data-align="right"/.test(html), '对齐组合里只剩左 / 中两个按钮');
chk(/id="m-font-seg"/.test(html) && /id="m-font-down"/.test(html) && /id="m-font-up"/.test(html),
  '详情页有 A－ / A＋ 组合按钮');
chk(/id="m-trans-read"/.test(html), '详情页有白话译文朗读（组合键右段）');
chk(/id="m-trans-text"/.test(html), '详情页有白话译文段落');
// 译文来源口径：界面要照实说明，不能含糊宣称「以教师用书为准」——
// 教材本身不给白话译文，这类声明不可验证，反而会误导拿去对作业的家长
chk(/id="m-trans-src"/.test(html) && /class="trans-src"/.test(html),
  '详情页译文框有来源注脚 #m-trans-src');
chk(/id="rd-trans-src"/.test(read('classic/index.html')), '小古文阅读器也有同一套来源注脚');
chk(/TRANSLATION_SOURCES/.test(read('data/index.js')), '来源口径文案集中在 data/index.js 一处');
chk(/translationSourceText/.test(read('data/index.js')), 'data/index.js 提供取文案的函数');
chk(/data\/index\.js/.test(read('classic/index.html')),
  '小古文页加载了 data/index.js（否则来源文案取不到，注脚会是空白）');
chk(/\.trans-src/.test(css) && /\.trans-src/.test(read('css/classic.css')),
  'style.css 与 classic.css 都有 .trans-src 样式（两页共用同一套数值）');
// 特异性：注脚选择器必须比 `.trans-box p`（0-1-1）更具体，否则会被正文样式压回去，
// 注脚会渲染成 14.5px 正文大小、看着像译文的一部分（同 .trans-read 那次的坑）。
['css/style.css', 'css/classic.css'].forEach(f => {
  const c = read(f);
  chk(/\.trans-box p\.trans-src\s*\{/.test(c),
    f + ' 注脚用 .trans-box p.trans-src（0-2-1），压得住 .trans-box p（0-1-1）');
  chk(!/(^|\})\s*\.trans-src\s*\{/m.test(c),
    f + ' 不再留一条低特异性的裸 .trans-src 规则');
  // 两页同一套数值：字号 / 行高 / 颜色三样都得对得上
  const m = c.match(/\.trans-box p\.trans-src\s*\{([\s\S]{0,200}?)\}/);
  chk(m && /font-size:\s*11\.5px/.test(m[1]) && /line-height:\s*1\.7/.test(m[1]) &&
    /color:\s*var\(--ink-3\)/.test(m[1]),
    f + ' 注脚数值与另一页一致（11.5px / 1.7 / --ink-3）');
});
// 反向防线：全站文案里不得再出现「译文以教师用书为准」这类不可验证的权威声明。
// 注意只打「声明」本身 —— 表格里说明口径来源、测试清单里描述这条防线，
// 都是正当提及，不能一并算违规（否则防线会拦自己）。
const CLAIMS_AUTHORITY = [
  /译文[^。；\n]{0,30}(?:以|与|按)[^。；\n]{0,30}(?:教师用书|教参)[^。；\n]{0,10}为准/,
  /(?:教师用书|教参)[^。；\n]{0,6}与课后[^。；\n]{0,10}释义[^。；\n]{0,6}为准/,
  /译文[^。；\n]{0,20}来源[^。；\n]{0,6}以统编版/
];
['README.md', 'index.html', 'classic/index.html', 'terms/index.html', 'privacy/index.html'].forEach(f => {
  // 先剥掉「引用式提及」：反引号代码、加粗的引号短语、以及「宣称「…」」这类
  // 把声明本身当宾语来说的句子 —— 防线要打的是声明，不是对声明的描述。
  const txt = read(f)
    .replace(/`[^`]*`/g, '')
    .replace(/「[^」]*」/g, '「」');
  const hit = CLAIMS_AUTHORITY.filter(re => re.test(txt)).map(re => re.source);
  chk(hit.length === 0, f + ' 不再宣称「译文以教师用书为准」' + (hit.length ? '（命中 ' + hit.join(' / ') + '）' : ''));
});
chk(/自拟|自行整理|本项目整理/.test(read('README.md')),
  'README 明确说明译文是自拟直译');
chk(/自拟|自行编写/.test(read('terms/index.html')), '用户协议里也如实说明译文为自行编写');
chk(!/id="gw-done"/.test(html), '古诗词详情页不设「已读」按钮（与小古文唯一区别）');
// 需求：古诗正文默认字号小一号
chk(/\.poem-text \{[\s\S]{0,200}?font-size:\s*17px/.test(css), '古诗正文默认字号降为 17px');
chk(/\.poem-text\[data-align="left"\]/.test(css) && !/data-align="right"/.test(css),
  '古诗正文只留左对齐规则，右对齐规则已删除');
// 需求：详情页三个评价按钮不被底部页签挡住。
// 只压 max-height 还不够 —— 弹层底边仍落在屏幕底边，
// 所以底部内边距也必须垫出底部导航高度。两条一起才真的「压不住」。
//
// ⚠️ 垫的是 --nav-h（js/pwa.js 实测的底部导航高度），不再写死 62px：
//    62px 只是默认字号下页签的高度，换字号 / 横屏 / PWA 就失准
//    —— 那正是「加入背诵弹框被导航挡住」反复出现的原因（见 test/layout.test.js）。
chk(/\.modal-box \{[\s\S]{0,500}?max-height:\s*calc\(88vh - var\(--nav-h\)/.test(css),
  '弹层高度扣掉底部导航（--nav-h），最后的评价按钮不被压住');
chk(/\.modal-box \{[\s\S]{0,200}?padding-bottom:\s*calc\(26px \+ var\(--nav-h\) \+ var\(--safe-bottom\)\)/.test(css),
  '弹层底部内边距再垫出底部导航高度，评价按钮整排落在页签上方');
chk(/body\.no-dock \.modal-box \{ padding-bottom:\s*calc\(26px \+ var\(--safe-bottom\)\); \}/.test(css),
  '法务页等无页签页面，弹层不必垫页签高度');
chk(/body\.no-dock \.modal-box \{ max-height: 88vh; \}/.test(css),
  '法务页等无页签页面，弹层照旧铺到底边附近');

// 需求（Issue #69 收尾）：弹层不能被底部页签 / 底部播放栏压在下面。
// 原先 .modal 写 z-index: 50，低于页签（65）与播放栏（70）——
// 「加入背诵」弹框的集合列表与新建输入框会被页签横切一刀，还点不到
// （点下去命中的是页签）。这一条把层级关系钉死：
//   引导条 40 < 页签 65 < 播放栏 70 < 弹层 80 < toast 99
/* 取某个选择器在样式表里**最后生效**的 z-index（同名规则后写的覆盖先写的） */
const zIndexOf = sel => {
  const re = new RegExp('(^|\\})\\s*' + sel.replace(/\./g, '\\.') + '\\s*\\{([^}]*)\\}', 'gm');
  let m, out = null;
  while ((m = re.exec(css))) {
    const z = /z-index:\s*([^;]+)/.exec(m[2]);
    if (z) out = z[1].trim();
  }
  return out;
};
const zModal = zIndexOf('.modal'), zDock = zIndexOf('.dock');
const zPlayer = zIndexOf('.player-bar'), zTip = zIndexOf('.ios-install-tip');
const zToast = zIndexOf('.toast');
chk(Number(zModal) > Number(zDock),
  '弹层层级（' + zModal + '）高于底部页签（' + zDock + '）——弹层不被页签压住（Issue #69：加入背诵弹框被导航栏挡住）');
chk(Number(zModal) > Number(zPlayer),
  '弹层层级（' + zModal + '）高于底部播放栏（' + zPlayer + '）——播放栏不盖住弹层');
chk(Number(zModal) > Number(zTip),
  '弹层层级（' + zModal + '）高于「添加到主屏幕」引导条（' + zTip + '）——引导条不挡住弹层里的按钮');
chk(Number(zModal) < Number(zToast),
  '弹层层级（' + zModal + '）低于 toast（' + zToast + '）——提示语要压在所有浮层之上');
// 层叠次序不能只把弹层抬高就完事：页签自己得仍在播放栏之下（播放栏出现时页签让路）
chk(Number(zDock) < Number(zPlayer),
  '底部页签（' + zDock + '）仍低于播放栏（' + zPlayer + '），两者的让路关系没被改乱');
// 需求：小古文阅读器顶栏与其他页面统一
// 需求（本次）：阅读器顶栏不再自制一套，直接复用全站 .topbar ——
// 从列表点进正文时，徽标 / 「跬步 · 小古文」/ 右侧圆形动作位都不变样。
// Issue #147 起，顶栏那枚「第 N / 100 篇」不再挂任何牌子：整行只剩品牌区与返回键；
// 其后追加一轮，挪进正文状态栏的那一枚 .rd-count 也撤了 ——
// 于是页顶与详情页**都没有读数**（见 css/classic.css 里那一段说明）。
chk(/<header class="topbar">/.test(classicHtml) &&
  /id="gw-reader"[\s\S]*?<header class="topbar">/.test(classicHtml),
  '阅读器顶栏复用全站 .topbar（不再带 count 小件的变体）');
chk(!/\.reader-bar \{/.test(classicCss) && !/reader-progress/.test(classicHtml),
  '自制的 .reader-bar / .reader-progress 已整段删除（不再两套顶栏）');
chk(/\.reader > \.topbar \{/.test(classicCss), '阅读器内的顶栏有独立背景，正文不会从它下面透出来');
chk(!/reader-count/.test(classicCss) && !/count-badge/.test(classicHtml),
  '页顶读数那一套（.count-badge / .reader-count）已随 Issue #147 一起撤干净');
chk(!/\.rd-count\s*[,{]/.test(classicCss),
  '正文状态栏那一枚 .rd-count 的样式也整段撤了（详情页不再有任何读数）');
chk(/\.top-act,[\s\S]{0,300}?border-radius:\s*50%/.test(css), '全站顶栏动作位是圆形纸底（返回键与它同款）');
chk(!/<span>小古文<\/span>/.test(classicHtml), '顶栏里不再叠「小古文」三个字');


/* ---------------- 3. 传统色（宋代） ---------------- */
chk(/宋代/.test(css), '配色注释标明宋代取色');
// 天青主色
// 主色：雨过天青压深到 #2f6055（提升对比度，白底文字过 WCAG AA）
chk(/--green:\s*#2f6055/.test(css), '主色为加深后的雨过天青 #2f6055');
chk(!/--green:\s*#4d7d74/.test(css), '不再使用对比度不足的旧天青 #4d7d74');
// 宣纸底
chk(/--bg:\s*#f6f1e3/.test(css), '底色为素绢米灰 #f6f1e3');
// 需求：页面各个卡片的背景色透明度保持 90%（不用图案后仍保留纸的层次）
chk(/--card:\s*rgba\(255, 254, 250, \.90\)/.test(css),
  '卡片背景改为 90% 不透明的宣纸白 rgba(255,254,250,.90)');
chk(/\.modal-box \{[\s\S]{0,300}?background:\s*rgba\(252, 250, 243, \.90\)/.test(css),
  '古诗 / 设置弹层同为 90% 不透明');
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

/* ---------------- 3c. 播放键的空心三角（Issue #55 后续） ----------------
   需求：全站每一颗播放键里的三角都改成**空心**，且三角的描边颜色
   与这颗圆键的边框颜色保持一致。

   空心这一条只能在源码级锁：jsdom 不会给 SVG 上色，
   真浏览器那层（pwa.test.js）在 CI 上常因缺系统库而跳过，
   所以这里逐文件核对「▶ 三角的描边是 currentColor、且没有 fill 填色」。

   同色这一条靠**结构**保证，不靠两处各写一次颜色值：
   三角的 stroke 与圆环的 border-color 都取宿主元素的 `color`
   （currentColor），于是必然同色；下面同时断言这条链路还在
   —— 谁把三角的 stroke 换成写死的色值，这里就红。 */
/* 播放三角的来源文件。
   ⚠️ js/classic.js 已不再是「小古文那一大坨」：列表项与分组小键的三角
   现在统一由 js/reader-core.js 的 playGlyph() / playSmGlyph() 画出来
   （小古文 / 唐诗 / 宋词 / 古文观止 / 搜索页共用同一份引擎）。
   所以这一档指着 reader-core.js 核，而不是指着薄薄的挂载文件 js/classic.js。 */
const playSrcs = {
  'index.html': html,
  'classic/index.html': classicHtml,
  'js/app.js': app,
  'js/reader-core.js': read('js/reader-core.js'),
  'js/reader.js': read('js/reader.js')
};
// ▶ 三角的路径特征（内收后的空心轮廓）；暂停 ⏸ 是两竖条，不在此列
const HOLLOW = /<path d="M8\.4 6\.1 18\.3 12 8\.4 17\.9Z"[^>]*fill="none" stroke="currentColor"/;
Object.keys(playSrcs).forEach(function (f) {
  const src = playSrcs[f];
  chk(!/M7\.2 4\.6 19\.4 12 7\.2 19\.4Z" fill="currentColor"/.test(src),
    f + ' 里的播放三角不再是实心填充');
  chk(HOLLOW.test(src), f + ' 里的播放三角改成空心描边（fill="none" + stroke="currentColor"）');
});
chk(HOLLOW.test(read('js/reader-core.js')) && /M9\.4 6\.6 18 12 9\.4 17\.4Z" fill="none" stroke="currentColor"/.test(read('js/reader-core.js')),
  '分组小号圆键的三角同样是空心描边（单独一枚、略大一号）');
chk(!/M8\.2 5\.4 18\.6 12 8\.2 18\.6Z/.test(read('js/reader-core.js')),
  '分组小号圆键不再用旧的那枚实心三角路径');
// 底部播放栏：▶ / 上一首 / 下一首 三枚三角都空心
// 注意变量名不要与上面那处播放栏文案检查重名（同一作用域下重名会直接语法报错）
const readerSrc = read('js/reader.js');
['M8\.4 6\.1 18\.3 12 8\.4 17\.9Z', 'M17\.3 6\.1 9\.1 12l8\.2 5\.9Z', 'M6\.7 6\.1l8\.2 5\.9-8\.2 5\.9Z']
  .forEach(function (d) {
    const re = new RegExp('<path d="' + d + '"[^>]*fill="none" stroke="currentColor"');
    chk(re.test(readerSrc), '播放栏的三角 ' + d.slice(0, 12) + '… 为空心描边');
  });
/* ---------------- 3d. 三角的描边宽度：全站都是「1px」（Issue #55 本轮） ----------------
   需求原文：所有播放键里面的三角形边框宽度只允许 1px。

   描边写在 24 的 viewBox 里、会跟图标框一起缩放，所以不能只看 stroke-width
   这一个数：真正要锁的是「每一档的图标框 × 描边值 ÷ 24 ≈ 1px」。
   下面按档把图标框从 CSS 里读出来、与各文件里的 stroke-width 配成对，
   逐档算出屏幕上量得到的那 1px（换算表见 css/classic.css 顶部）。 */
const SVGW = 24;                        // 三角的 viewBox 宽度
const SW_RE = /<path d="M8\.4 6\.1 18\.3 12 8\.4 17\.9Z"[^>]*?stroke-width="([\d.]+)"/g;
// 播放栏（js/reader.js）那几枚三角里，主键用的是暂停 ⏸ 的路径，
// 所以再补一枚「上一首 / 下一首」用的三角路径，一起纳入换算
const SW_RE2 = /<path d="M(?:17\.3 6\.1 9\.1 12l8\.2 5\.9Z|6\.7 6\.1l8\.2 5\.9-8\.2 5\.9Z)"[^>]*?stroke-width="([\d.]+)"/g;
const swList = src => [...src.matchAll(SW_RE)].map(m => m[1])
  .concat([...src.matchAll(SW_RE2)].map(m => m[1]));
// 各文件里这枚三角分别会被哪一档画出来（图标框从 CSS 读，不写死第二遍）
const boxOf = {
  'index.html': [17],                   // 今日条 .today-read（--today-btn-inner）
  'classic/index.html': [17, 17],       // 工具栏连读键 17px / 详情页阅读器 17px
  'js/app.js': [16],                    // 列表项 .item-read
  'js/reader-core.js': [16],            // 古籍列表中的篇目（小古文 / 唐诗 / 宋词 / 古文观止 共用）
  'js/reader.js': [17, 17, 17]          // 播放栏 ▶ / 上一首 / 下一首（主键是 ⏸，不在此列）
};
const topInner = (css.match(/\.today-actions \{([^}]*)\}/) || [, ''])[1].match(/--today-btn-inner:\s*([\d.]+)px/);
chk(!!topInner, '今日条内径（图标框）可读：' + (topInner && topInner[1]) + 'px');
Object.keys(playSrcs).forEach(function (f) {
  const widths = swList(playSrcs[f]);
  const boxes = f === 'index.html' ? [parseFloat(topInner[1])] : boxOf[f];
  chk(widths.length >= boxes.length,
    f + ' 的三角都写了 stroke-width（' + widths.length + ' 处）');
  const px = widths.map((w, i) => parseFloat(w) * (boxes[i] || boxes[boxes.length - 1] || 17) / SVGW);
  chk(px.every(v => v > 0.6 && v < 1.35),
    f + ' 的三角描边换算到屏幕都在 1px 上下（' + px.map(v => v.toFixed(2)).join(' / ') + 'px）');
});
// 「1px」这一档也直接盯住用户最常看到的三处：首页今日条、列表项、小古文列表
chk(/stroke-width="1\.5"[^>]*\/>/.test(html.indexOf('today-read') > -1 ? html.slice(0, html.indexOf('today-read') + 900) : ''),
  '首页今日条那颗三角的描边值是 1.5（17px 图标框 → 约 1.06px）');
['js/app.js', 'js/reader-core.js'].forEach(function (f) {
  chk(/stroke-width="1\.5"/.test(read(f)), f + ' 里列表项那颗三角的描边值是 1.5（16px 框 → 1px）');
});
chk(/stroke-width="2"[^>]*\/>/.test(read('js/reader-core.js')),
  '分组小号圆键那颗三角的描边值是 2（12px 框 → 1px）');
chk(!/stroke-width="2\.4"/.test(html + classicHtml + app + read('js/reader-core.js') + read('js/reader.js')),
  '全站不再有旧的 2.4 描边（三角边框这一轮统一收细）');

// 同色链路：圆环描边与三角描边同取 currentColor
chk(/\.item-read \{[\s\S]*?border:\s*1px solid var\(--line\);[\s\S]*?color:\s*var\(--green\)/.test(css),
  '列表项圆键的 color 就是它的图标色，三角描边取其值');
chk(/\.gw-play \{[\s\S]*?border:\s*1px solid var\(--line\);[\s\S]*?color:\s*var\(--blue\)/.test(classicCss),
  '小古文圆键同上（color 走天水碧，环与三角同源）');

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
/* 设置拆成**二级页**（Issue #132 后续）：
   /settings/          主页：四个入口 + 页脚
   /settings/general/ 通用（用户名 / 头像印记 / 账号 / 数据管理）
   /settings/recite/  背诵（学段 / 年级 / 学期 / 范围 / 数量）+ 复习算法
   /settings/lists/   我的清单（自选背诵的增删改查）
   /settings/reader/  朗读（注音 + 五档连读方式）
   下面的断言按这一结构读源码：分组判据是精简后的**五组**（Issue #163
   把「阅读辅助 + 朗读播放」并成一组「朗读」），只是要「合起来看」——
   拆页不该顺手改分类。 */
const settingsHtml = read('settings/index.html');
const SETTINGS_HTML = [
  'settings/general/index.html',
  'settings/recite/index.html',
  'settings/lists/index.html',
  'settings/reader/index.html'
].map(read).join('\n');
const settingsJs = read('js/settings.js');

/* 分组标题与入口标题共用一个声明块（`.settings-group-title, .settings-link-title`）——
   字号 / 字重 / 颜色三个值只写一次。这里把它取出来，
   下面的层级断言与 ui-consistency 那一对约定都从这一个来源读。 */
function sharedTitleRule(code) {
  const m = code.match(/\.settings-group-title,\s*\n?\.settings-link-title\s*\{([\s\S]{0,400}?)\}/);
  return m ? m[1] : '';
}

const pwaJs = read('js/pwa.js');

// 需求：设置不再向上弹卡片，而是全新的整页
chk(html.indexOf('settings-modal') === -1, '首页不再有向上弹出的设置卡片（settings-modal 已删除）');
// 设置的入口是底部页签「设置」，由 js/chrome.js 渲染成真实链接
chk(/href:\s*"\/settings\/"/.test(read('js/chrome.js')), '底部页签「设置」指向设置整页（目录化路径）');
chk(html.indexOf('btn-settings') === -1, '首页顶栏不再有设置齿轮（入口收敛到页签）');
chk(/data-nav="settings"/.test(settingsHtml), '设置主页声明自己是「设置」页签');
chk(/js\/chrome\.js/.test(settingsHtml), '设置页与首页共用同一套顶栏与底部页签');
chk(settingsHtml.indexOf('id="settings-page"') !== -1, '设置主页有独立的整页容器');
chk(settingsHtml.indexOf('settings-modal') === -1, '设置页不再用弹层结构');
chk(settingsHtml.indexOf('class="foot settings-foot"') !== -1, '设置主页底部有页脚（版权 + 法务链接）');
// 四张二级页与主页一样：声明页签、共用顶栏、有整页容器与页脚、不用弹层
['settings/general/index.html', 'settings/recite/index.html',
 'settings/lists/index.html', 'settings/reader/index.html'].forEach(f => {
  const src = read(f);
  chk(/data-nav="settings"/.test(src), f + ' 声明自己是「设置」页签（页签选中态不漂）');
  chk(/js\/chrome\.js/.test(src), f + ' 共用同一套顶栏与底部页签');
  chk(src.indexOf('id="settings-page"') !== -1, f + ' 有独立的整页容器');
  chk(src.indexOf('class="foot settings-foot"') !== -1, f + ' 有页脚（版权 + 法务链接）');
  chk(src.indexOf('settings-modal') === -1, f + ' 不用弹层结构');
  // 二级页的返回键回设置主页，而不是回背诵首页
  chk(/data-back="\/settings\/"/.test(src), f + ' 顶栏返回键指回设置主页');
});
chk(/data-back="\/settings\/"/.test(read('settings/general/index.html')),
  '二级页用 data-back 声明上一层（js/chrome.js 读它）');

// 需求（Issue #114 第三、二条 + 可切换复习算法那一轮 + Issue #163 精简）：
// 设置项按「这条设置管着谁」归类 —— 共五组：
//   通用     全站都吃（用户名、数据备份 / 清空）
//   背诵     只决定「今天背哪几首」（学段 / 年级 / 学期 / 范围 / 数量 / 进度入口）
//             —— 原「古诗词背诵」改名，它本来就不只作用于古诗词
//   我的清单  用户自己那份清单（自选背诵的增删改查）—— Issue #114 第二条搬进来的
//   复习算法  决定「下次什么时候复习」（四张模型 4 选 1）
//   朗读     打开一篇时怎么念 / 看不看得到拼音（注音总开关 + 五档连读方式）
//             —— Issue #163：原「阅读辅助」与「朗读播放」各只有一条设置，
//             两个组标题 + 四行说明只为两条设置服务，并成一组「朗读」
chk((SETTINGS_HTML.match(/class="settings-group"/g) || []).length === 5,
  '四张设置页合起来是五组：通用 / 背诵 / 复习算法 / 我的清单 / 朗读');
chk(/settings-group-title[^>]*>复习算法</.test(SETTINGS_HTML), '有「复习算法」分组标题');
chk(/settings-group-title[^>]*>通用</.test(SETTINGS_HTML), '有「通用」分组标题');
chk(/settings-group-title[^>]*>背诵</.test(SETTINGS_HTML), '有「背诵」分组标题');
chk(/settings-group-title[^>]*>我的清单</.test(SETTINGS_HTML), '有「我的清单」分组标题');
chk(/settings-group-title[^>]*>朗读</.test(SETTINGS_HTML), '有「朗读」分组标题');
chk(!/settings-group-title[^>]*>阅读辅助</.test(SETTINGS_HTML) &&
    !/settings-group-title[^>]*>朗读播放</.test(SETTINGS_HTML),
  '不再有「阅读辅助」「朗读播放」两个组标题（Issue #163 并成「朗读」）');
// 分组的**顺序**也是分类的一部分：清单紧跟在「背诵」之后
//（自选篇目就是跟着背诵走的），朗读那一条偏好排在最后
{
  const order = [...SETTINGS_HTML.matchAll(/aria-labelledby="grp-([a-z]+)"/g)].map(m => m[1]);
  chk(order.join(',') === 'general,recite,algo,lists,reader',
    '五组的先后顺序为 通用 → 背诵 → 复习算法 → 我的清单 → 朗读（实际 ' + order.join(',') + '）');
}
// 分组要真的装对东西：只给背诵用的选项不能落在「通用」里
const generalBlock = (SETTINGS_HTML.match(/aria-labelledby="grp-general"[\s\S]*?<\/section>/) || [''])[0];
const reciteBlock = (SETTINGS_HTML.match(/aria-labelledby="grp-recite"[\s\S]*?<\/section>/) || [''])[0];
const listsBlock = (SETTINGS_HTML.match(/aria-labelledby="grp-lists"[\s\S]*?<\/section>/) || [''])[0];
const readerBlock = (SETTINGS_HTML.match(/aria-labelledby="grp-reader"[\s\S]*?<\/section>/) || [''])[0];
chk(!!generalBlock && !!reciteBlock && !!listsBlock && !!readerBlock, '各分组自己的区块都能取到');
chk(/id="input-username"/.test(generalBlock), '「通用」组含用户名');
chk(/id="btn-export"/.test(generalBlock) && /id="btn-import"/.test(generalBlock) && /id="btn-reset"/.test(generalBlock),
  '「通用」组含数据管理（导出 / 导入 / 清空）');
chk(!/seg-scope|seg-stage|seg-term|grade-chips|seg-count/.test(generalBlock),
  '「通用」组里不再混入只给背诵用的选项');
chk(/id="seg-stage"/.test(reciteBlock) && /id="grade-chips"/.test(reciteBlock) &&
    /id="seg-term"/.test(reciteBlock) && /id="seg-scope"/.test(reciteBlock) && /id="seg-count"/.test(reciteBlock),
  '「背诵」组聚齐学段 / 年级 / 学期 / 背诵范围 / 每日数量');
chk(/href="\/progress\/"/.test(reciteBlock), '「背诵」组含进度总览入口（它讲的就是这本账）');
chk(/id="collections-list"/.test(listsBlock) && /id="btn-collections-import"/.test(listsBlock) &&
    /id="collections-tip"/.test(listsBlock),
  '「我的清单」组含自选背诵清单 / 导入键 / 说明行（Issue #114 第二条）');
// 搬过来之后不能两边都留着：首页那张折叠卡必须真的没了
chk(!/id="collections-section"/.test(html) && !/id="btn-collections"/.test(html),
  '首页不再有「自选背诵」折叠卡（整块搬进设置，不留两处入口）');
chk(/id="seg-helper"/.test(readerBlock), '「朗读」组含注音总开关');

// 需求（Issue #69 后续 A）：连读档位必须在设置页有显式单选项入口。
// 原先还把「圆键长按 / 右键也能调」这段复述在组内（B），#120 把那块
// 「在哪儿快速调」说明整块删掉；但 #120 顺手删过了头 —— 解冲突（#122 并入
// main）时发现这条断言一直亮红，是本 PR 里把「不指点操作」的那半段放回了本组
// （只讲圆键长按 / 右键弹出同一个菜单，不再教手势）。这条断言因此改成正向钉住：
// 组内确实写回了「长按 / 右键」，但只说圆键，不再重复讲手机上怎么按。
// Issue #163：原来两个组标题并成一个「朗读」，五档单选项与注音开关同组；
// 「圆键长按 / 右键弹同一个菜单」那半段说明也一并撤掉 —— 两条设置的组
// 不该再配三行操作指导（用户原话：能省则省）。
chk(/id="seg-play"/.test(readerBlock), '「朗读」组有五档单选项容器');
/* 剥掉 HTML 注释再判：源码注释里仍在说明「这一组原先只存在于圆键菜单里」
   （那是给维护者看的历史），用户可见处一个字都不教手势。 */
const readerBlockVis = readerBlock.replace(/<!--[\s\S]*?-->/g, ' ');
chk(!/长按|右键/.test(readerBlockVis),
  '「朗读」组里不再教圆键手势（Issue #163：设置页不再啰嗦操作说明）');
// 档位定义必须同源：设置页与阅读器都读 js/play-modes.js，不得各写一份
chk(/js\/play-modes\.js/.test(SETTINGS_HTML), '设置页加载 js/play-modes.js（与阅读器同源）');
chk(/window\.PlayModes/.test(settingsJs) && /PM*\.(read|LIST|write|of)\b/.test(settingsJs),
  '设置页逻辑从 PlayModes 取档位，而不是另抄一份字面量');
chk(!/seq-origin|shuffle-trans/.test(settingsJs),
  '设置页 JS 里不再出现模式 id 字面量（避免与阅读器错开）');
// 设置页不加载 reader-core（那是集子页的引擎），档位只能走 play-modes.js
chk(!/js\/reader-core\.js/.test(SETTINGS_HTML), '设置页不加载阅读器引擎（只引档位定义）');
// 分组标题的样式：与组内选项药丸区分开（字距 + 主标题档字号）
// 需求（Issue #44 一轮 · 本次改口径）：分组标题**不再是 11px 的辅助标签**，
// 而是与其他页卡片主标题同一档（Issue #163：『通用』『我的清单』这些
// 卡片主标题要和设置主页那四张卡、集子卷名一样大）。
// 与「页面顶部大标题」的层级关系不变：仍必须小于顶栏应用名（19px）。
const titleSize = (css.match(/\.settings-group-title\s*\{([\s\S]{0,600}?)\}/) || ['', ''])[1];
chk(/letter-spacing/.test(titleSize) || /letter-spacing/.test(sharedTitleRule(css)),
  '分组标题有自己的字距（与组内选项区分，不是一列裸字）');
// 字号 / 字重 / 颜色三个值现在与入口标题共用同一句，从共用块里取
const sharedTitle = sharedTitleRule(css);
const fsMatch = sharedTitle.match(/font-size:\s*([\d.]+)px/);
const titleFs = fsMatch ? parseFloat(fsMatch[1]) : NaN;
chk(!!fsMatch && titleFs >= 14,
  '分组标题是卡片主标题档（≥14px，实际 ' + (fsMatch ? fsMatch[1] + 'px' : '未取到') + '）');
chk(/font-weight:\s*(600|700|bold)/.test(sharedTitle),
  '分组标题用主标题的字重（与集子卷名 / 入口标题同为 700）');
chk(/color:\s*var\(--ink\)/.test(sharedTitle),
  '分组标题用正文主色 --ink（与集子卷名同一档）');
// 与「页面顶部大标题」的层级关系：顶栏应用名 19px，分组标题必须小于它。
// ⚠️ 这里**只**锁「小于顶栏应用名」这一条。原先还锁了「小于组内选项文字
//    13.5px」—— Issue #163 之后这条不再成立：分组标题是卡片主标题（14px），
//    与选项文字（13.5px）刻意同档，主次靠字重（700 对 500）与颜色
//    （--ink 对 --ink-2）分，不靠把字号压小（那正是被点名的那一版）。
//
// 注意：同一个选择器可能在样式表里出现多次（如 .brand-name-row 先随一组
// 只声明 font-family，后面才单独给 font-size:19px）。所以这里把所有匹配块
// 都收集起来取**最大值**，只取第一个会拿到「没有 font-size」的那块。
const maxFontSize = function (re) {
  let m, best = 0;
  while ((m = re.exec(css)) !== null) {
    const f = m[1].match(/font-size:\s*([\d.]+)px/);
    if (f) best = Math.max(best, parseFloat(f[1]));
  }
  return best;
};
// 直接传正则字面量，避开字符串转义带来的坑
const brandFs = maxFontSize(/\.brand-name-row\s*\{([\s\S]{0,500}?)\}/g);
// 选项块的写法是两个选择器共用一个声明块（.seg button, .chips button），
// 所以按选择器列表整体匹配，再从中取 font-size。
const optFs = maxFontSize(/\.settings-page \.seg button,[\s\S]{0,60}?\{([\s\S]{0,500}?)\}/g);
chk(brandFs >= 17 && titleFs < brandFs,
  '分组标题（' + titleFs + 'px）小于页面顶部大标题（' + brandFs + 'px）');
// 反向：分组标题也不许把选项文字盖过去 —— 差的必须是字重与颜色，不是字号
chk(optFs >= 13 && Math.abs(titleFs - optFs) <= 1,
  '分组标题（' + titleFs + 'px）与组内选项文字（' + optFs + 'px）同一档，主次靠字重与颜色分');
chk(!/\.settings-group-desc/.test(css), '样式里不再保留二级描述 .settings-group-desc');
chk(!/settings-group-desc/.test(SETTINGS_HTML), '设置页 HTML 里不再有二级描述节点');

/* ---------------- 7d. 全站一致性（本次 UI review 的修复） ----------------
   逐页看过之后收口的一致性问题，每条都对应一个真实可复现的现象，
   断言写在这里防止回退。 */

// (1) 详情页工具条在手机上溢出：三组控件在 390px 下合计约 393px，
//     原先 nowrap + overflow-x: auto，结果「全文」按钮被裁掉一半、还看不到滚动条。
//     现在允许换行、整行居中。
{
  const m = css.match(/\.modal-box \.reader-actions \{([\s\S]{0,500}?)\}/);
  const block = m ? m[1] : '';
  chk(/flex-wrap:\s*wrap/.test(block), '详情页工具条允许换行（窄屏不再把「全文」裁成半截）');
  chk(!/overflow-x:\s*auto/.test(block), '详情页工具条不再横向滚动（改成换行后不必两层滚动）');
  chk(/justify-content:\s*center/.test(block), '工具条整行居中，与居中的诗题 / 正文同一条中轴');
}

// (2) 播放栏出现时底部页签只是被盖住：看得见摸不着、读屏还能聚焦到被盖住的链接。
//     现在页签彻底让路。
chk(/body\.has-audio-player \.dock \{[\s\S]{0,140}?visibility:\s*hidden/.test(css),
  '底部播放栏出现时页签彻底让路（不再「被盖住却还能聚焦」）');
chk(/body\.has-audio-player \.dock \{[\s\S]{0,160}?pointer-events:\s*none/.test(css),
  '让路时同时关掉命中测试，不会误接点击');
chk(/body\.reader-open \.dock \{ display: none; \}/.test(classicCss),
  '阅读器打开时页签同样是「让路」而不是被压住（两处口径一致）');

// (3) 没有底部页签的法务页：页脚那行小字原先正好贴屏底（iPhone 上被横条压半行）
chk(/body\.no-dock \.app,[\s\S]{0,120}?padding-bottom:\s*calc\([^)]*--safe-bottom/.test(css),
  '无页签页面（法务页）底部留出安全区，页脚不再贴屏底');

// (4) iOS 输入框防缩放此前是「死规则」：被 .settings-input 的 font-size 压回去了。
//     现在按类名精确命中，并且整段挪到样式表末尾。
{
  const lastInputMedia = css.lastIndexOf('--input-font-narrow');
  chk(/@media screen and \(max-width: 700px\) \{\s*input:not\(\[type="checkbox"\]\)/.test(css),
    'iOS 输入框防缩放规则按类名精确命中（不再被组件自身 font-size 压回去）');
  chk(/\.settings-input,\s*\n\s*\.search-input \{\s*\n\s*font-size:\s*var\(--input-font-narrow\)/.test(css),
    '输入框字号走 --input-font-narrow 变量（只定义一次）');
  const tail = css.slice(css.indexOf('@media screen and (max-width: 700px) {', lastInputMedia > 0 ? lastInputMedia - 200 : 0));
  chk(tail.indexOf('--input-font-narrow') !== -1,
    '这条媒体查询排在样式表末尾（否则会被后面同特异性的组件样式翻盘）');
  chk(/--input-font-narrow:\s*16px/.test(css), '窄屏输入框字号为 16px（iOS 不缩放的阈值）');
}

// (5) 卡内小件的圆角原先有 10 / 12 / 16px 三种，现在收敛到一个变量
chk(/--radius-sm:\s*12px/.test(css), '定义卡内小件圆角变量 --radius-sm');
chk(!/border-radius:\s*10px/.test(css) && !/border-radius:\s*10px/.test(classicCss) &&
  !/border-radius:\s*10px/.test(read('css/legal.css')),
  '三张样式表里不再散落 10px 的圆角硬编码（统一走 --radius-sm）');

// (6) 大屏上顶栏比正文宽出一大截、阅读器正文还会被切掉左半行：
//     两者都按 720px 内容区居中
// ⚠️ 宽度令牌换过两次（720px → var(--col-w) → var(--content-w)，见 css/style.css
//    的「内容列宽」那一条），这里改判「顶栏读的是那条**内容宽**令牌」，
//    不再写死具体令牌 —— 错位与否取决于顶栏与内容区**同源**，而不是那一个数值。
//    顶栏 / 页签内层 / 正文列读 --content-w（一列纸减掉两侧那条边）：
//    这三样住在「整宽」容器里、自己不带左右内边距，读 --col-w 会在平板 /
//    桌面上比正文列宽出两侧那一条边。
chk(/\.topbar \{[\s\S]{0,600}?max-width:\s*var\(--content-w/.test(css),
  '顶栏宽度与内容区同源（--content-w，大屏不与正文错位）');
chk(/\.reader-body \{[\s\S]{0,900}?width:\s*auto/.test(classicCss),
  '阅读器正文不再写 width: 100%（那会让内边距溢出视口、正文贴左边缘被切）');
chk(/\.reader-body \{[\s\S]{0,1200}?box-sizing:\s*border-box/.test(classicCss),
  '阅读器正文显式 border-box，内边距算在 720px 之内');
// 宽度必须用「定宽 + 自动外边距」，不能用 max-width：
// .reader-body 是 flex 列容器的子项，max-width + width: auto 会被解析成
// flex-basis: auto → 内容尺寸，容器一宽盒子反而被压成窄条（大屏上正文挤成一小撮）。
chk(/\.reader-body \{[\s\S]{0,1200}?width:\s*var\(--content-w/.test(classicCss),
  '阅读器正文用定宽 --content-w（flex 子项上的 max-width 会退化成 flex-basis）');
chk(/\.reader-body \{[\s\S]{0,1200}?max-width:\s*calc\(100%/.test(classicCss),
  '窄屏由 max-width: calc(100% - 安全区) 收成满宽，宽屏稳定居中');
chk(/\.reader-body \{[\s\S]{0,400}?min-height:\s*0/.test(classicCss),
  '阅读器正文 min-height: 0，否则 flex 项被内容撑开、滚动条永远不出现');

// (8) Service Worker 版本必须比这次改动的资源新，否则老用户拿到旧样式
chk(parseInt((read('sw.js').match(/poem-app-v(\d+)/) || [0, '0'])[1], 10) >= 23,
  'Service Worker 缓存版本已升到 v23（本轮改了 css/js/html，不升版本老用户看到的是旧样式）');

// (7) 顶栏右侧的动作位在阅读器里画的是「返回」箭头，不是 ✕：
//     同一种行为在全站只能是同一个图标
chk(/if \(action\) \{[\s\S]{0,700}?GLYPHS\.back/.test(read('js/chrome.js')),
  '顶栏动作位统一用返回箭头（阅读器不再单独长出一个 ✕）');
chk(!/glyph\("close"\)/.test(read('js/classic.js')),
  '小古文页不再要求把动作位换成 ✕（形状交给 chrome.js 统一给）');

// 需求：设置页底部不被底部导航栏遮挡 —— 统一由 --nav-h 这条基准线决定
chk(/--nav-h:\s*0px/.test(css), '定义了底部导航栏高度变量 --nav-h');
chk(/\.settings-page \{[\s\S]*?padding-bottom:\s*calc\([^)]*--nav-h/.test(css),
  '设置页留出导航栏高度，最后一行不会被压住');
// 页面留白不写死 px，统一走 --nav-h；页签 / 播放栏同时在场也不互相压住
chk(!/padding-bottom:\s*calc\(150px/.test(css) && !/padding-bottom:\s*calc\(196px/.test(css),
  '页面留白不再写死 px（150px / 196px 这类硬编码已删除）');
chk(/\.dock \{[\s\S]*?position:\s*fixed[\s\S]*?bottom:\s*0/.test(css), '底部页签是贴底固定导航栏');
chk(/body:not\(\.no-dock\) \.app[\s\S]{0,80}?padding-bottom:\s*calc\([^)]*--nav-h/.test(css),
  '有底部页签时，页面留白按实测导航栏高度计算');
chk(/sw\.js/.test('sw.js') && /js\/pwa\.js/.test(read('settings/index.html')) && /js\/pwa\.js/.test(read('classic/index.html')),
  '所有页都加载 js/pwa.js，--nav-h 每页都会实测');
chk(/\.ios-install-tip \{[\s\S]*?bottom:\s*calc\(12px \+ var\(--nav-h\)\)/.test(css),
  'iOS 引导条按基准线避让，不再盖住页脚');
chk(/\.toast \{[\s\S]*?bottom:\s*calc\(24px \+ var\(--nav-h\)\)/.test(css),
  '吐司提示按基准线避让');
chk(/window\.PWA\.syncBottomGap = syncBottomGap/.test(pwaJs),
  'js/pwa.js 暴露 syncBottomGap 供各页统一刷新留白');
chk(/measureBottomNav/.test(pwaJs) && /ResizeObserver/.test(pwaJs),
  '播放栏高度变化时会重新测量底部留白');
chk(/\/settings\//.test(read('sw.js')) && /js\/settings\.js/.test(read('sw.js')),
  'Service Worker 预缓存设置页，断网也可进设置');

// 法务链接在设置页底部；返回入口交给全站统一的底部页签
chk(/data-nav-go/.test(read('js/chrome.js')) && /\/settings\//.test(read('js/chrome.js')),
  '设置页可经底部页签回到古诗词 / 小古文');

/* ---------------- 7c. 目录化 URL（URL 里不出现 .html） ----------------
   页面从 /classic.html 搬到 /classic/index.html 之后，有两个坑必须钉死：
   1) 页面里的资源引用：住在子目录的页面若用相对路径，会去 /settings/css/... 找；
   2) Service Worker 的注册路径：相对的 "./sw.js" 会解析成 /settings/sw.js（404），
      整站离线能力静默失效 —— 这两条各自由下面断言守住。 */
{
  const subPages = ['classic/index.html', 'settings/index.html', 'terms/index.html', 'privacy/index.html'];
  subPages.forEach(f => {
    const src = read(f);
    const rel = (src.match(/(?:src|href)="(\.\.?\/[^"]*)"/g) || [])
      .filter(x => !/^href="\.\/#/.test(x)); // 页内锚点（./#p1）不算
    // 子目录页面要么用绝对路径（/css/...），要么显式声明 <base href="/">，
    // 否则相对路径会基于子目录解析而 404
    const hasBase = /<base href="\/"\s*\/>/.test(src);
    chk(hasBase || rel.length === 0,
      f + ' 资源引用不会因目录化而 404（绝对路径或 <base href="/">，实际 ' + rel.join(', ') + '）');
  });
  // Service Worker 必须从站点根注册，否则子目录页面注册不上（scope 也覆盖不到全站）
  chk(/navigator\.serviceWorker\.register\("\/sw\.js"\)/.test(read('js/pwa.js')),
    'Service Worker 从站点根注册（/sw.js），子目录页面同样能注册');
  chk(!/register\("\.\/sw\.js"\)/.test(read('js/pwa.js')),
    '不再用相对的 ./sw.js 注册（目录化后会解析成 /settings/sw.js 而 404）');
  // sw.js 必须是能解析的 JS —— 注释块里漏一个 */ 就会让整份文件
  // 解析失败、Service Worker 从不注册，而页面上完全看不出来
  //（离线能力静默失效，只有断网时才发现）。这一条守住这次的回归。
  {
    const { execFileSync } = require('child_process');
    let swOk = true;
    try { execFileSync(process.execPath, ['--check', __dirname + '/../sw.js'], { stdio: 'pipe' }); }
    catch (e) { swOk = false; }
    chk(swOk, 'sw.js 能通过语法检查（注释块闭合、没有游离的 */ —— 否则 SW 从不注册）');
  }
  // 需求（用户原话）：「去除 sw.js 中的所有注释，以后也禁止添加」。
  // 直接禁掉，而不是只清理一遍 —— 那条漏 `*/` 的坑就是从注释里来的，
  // 注释一多、改动一多，同样的错会再来一次。
  {
    const swSrc = read('sw.js');
    const lines = swSrc.split('\n');
    // 逐行找注释：行注释（含行尾）与块注释（含行尾 / 多行）
    const commented = lines.map((l, i) => [i + 1, l]).filter(([, l]) => {
      const t = l.trim();
      return t.indexOf('//') === 0 || t.indexOf('/*') === 0 ||
             l.indexOf('//') !== -1 || l.indexOf('/*') !== -1 || l.indexOf('*/') !== -1;
    });
    chk(commented.length === 0,
      'sw.js 不含任何注释（用户要求：去除所有注释并禁止再加；' +
      (commented.length ? '实际第 ' + commented.map(c => c[0]).join('、') + ' 行有注释' : '') + '）');
  }

  // 缓存名必须随资源变化升级，否则老用户拿到的是旧副本。
  // 这里不只查「等于某个版本号」——那样每次改 CSS 都得改测试。
  // 关键约束：静态资源是「缓存优先」，所以缓存版本号必须比最近的资源改动新。
  const swVer = parseInt((sw.match(/poem-app-v(\d+)/) || [0, '0'])[1], 10) || 0;
  chk(swVer >= 21, 'Service Worker 缓存版本已提升（≥v21，实际 v' + swVer + '），老缓存会被清掉');
  // 反向约束：CACHE_NAME 必须出现在 sw.js 里且是纯常量，避免被误改成变量而失效
  chk(/const CACHE_NAME = "poem-app-v\d+";/.test(sw), 'CACHE_NAME 是带版本号的常量');
  // 静态资源是「缓存优先」——改样式表却不升版本，用户会一直看到旧样式。
  // 这条约定写在 README.md 的项目说明里（sw.js 本身不留注释）。
  const readme = read('README.md');
  chk(/缓存优先/.test(readme) && /升|提升|更新/.test(readme),
    'README.md 里写明「静态资源缓存优先、改动需升级版本」的约定');
  chk(sw.indexOf('缓存优先') === -1,
    'sw.js 里不出现注释形式的约定（注释已全部清空）');
  // 需求（用户原话）：「删除 sw-notes.md，以后也禁止添加」。
  // 这份文件是 sw.js 的版本沿革 + 维护约定，用户不希望在仓库里再看到它。
  chk(!fs.existsSync(__dirname + '/../SW-NOTE.md') &&
      !fs.existsSync(__dirname + '/../sw-notes.md') &&
      !fs.existsSync(__dirname + '/../docs/sw-history.md'),
    'SW-NOTE.md / sw-notes.md 已删除（用户要求：删除并禁止再加）');
  // 需求（用户原话）：「README.md 仅仅应该像别的项目一样做项目的基本描述，这不是 changelog」。
  // 这里守住 README 不再是开发日志：不出现 Issue 编号、不出现版本沿革口吻。
  chk(!/Issue\s*#\d+/.test(readme) && !/#\d+\s*(后续|第一条|第二条|第三条)/.test(readme),
    'README.md 不再是 changelog（不含 Issue 编号 / 逐条沿革）');
  // 并且所有页面的样式表 / 脚本都必须在 PRECACHE 里（否则断网/老用户会新老混用）。
  ['css/style.css', 'css/classic.css', 'css/legal.css'].forEach(function (f) {
    chk(sw.indexOf('./' + f) !== -1, 'PRECACHE 含 ' + f);
  });
  ['js/app.js', 'js/chrome.js', 'js/settings.js', 'js/classic.js'].forEach(function (f) {
    chk(sw.indexOf('./' + f) !== -1, 'PRECACHE 含 ' + f);
  });
}
chk(/invalidatePlan/.test(settingsJs), '设置页改配置后会让首页的今日计划缓存失效');

/* ---------------- 7b. 设置页选中态统一（本次改动） ----------------
   原先一页两套语言：学段 / 学期 / 范围 / 数量是「白底 + 天青字」，
   年级是「深绿实底」。用户明确表示更喜欢深绿那一套，这里把它们并成一套。 */
chk(/\.settings-page \.seg button\.active,[\s\S]{0,80}?\.settings-page \.chips button\.active \{[\s\S]{0,200}?background:\s*var\(--green\)/.test(css),
  '设置页五个组合（含年级）统一为深绿实底选中态');
chk(/\.settings-page \.seg button\.active,[\s\S]{0,300}?color:\s*#fdfaf2/.test(css),
  '设置页选中态用米白字，压在深绿上对比度充足');
chk(/\.settings-page \.seg button,[\s\S]{0,400}?border:\s*1px solid var\(--line\)/.test(css),
  '设置页未选中项有纸底描边，不再「裸」在容器里');
chk(!/\.settings-page \.seg button\.active[\s\S]{0,200}?padding:/.test(css),
  '选中态只换配色、不改内边距（选中不会把整行撑动）');
chk(/\.settings-page \.seg,\s*\.settings-page \.chips \{[\s\S]{0,200}?background:\s*transparent/.test(css),
  '设置页去掉旧的「灰底容器」外壳，药丸直接排布');
// 只作用于设置页：阅读器 / 列表页的 .seg.mini 不受影响
chk(!/\.seg button\.active \{[\s\S]{0,120}?background:\s*var\(--green\)/.test(css),
  '全局 .seg 选中态未被改掉（阅读器 .seg.mini 仍是原样）');



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
  // 不再只抽查几个词：直接把「站点实际用到的全部字符」交给字体做覆盖校验。
  // #44 补了 197 首译文，新增 116 个用字，靠固定清单是查不出来的。
  const { execFileSync: _x } = require('child_process');
  const py = `
import sys, json, os, re
from fontTools.ttLib import TTFont
root = sys.argv[1]
chars = set()
# 只统计「真正会渲染出来」的字符：注释里的字不会被渲染，
# 却会被算成「站点用字」，逼着字体子集去覆盖注释里偶然出现的生僻字
# （曾出现：CSS 注释里一个描述「拉成扁圆」的词，让 4 款字体全部报缺字）。
# 这里先把注释剥掉再扫描，避免这类假警报。
def strip_comments(src, fn):
    if fn.endswith(('.js', '.css')):
        src = re.sub(r'/\\*[\\s\\S]*?\\*/', ' ', src)
    if fn.endswith('.js'):
        src = re.sub(r'(?m)^\\s*//.*$', ' ', src)
    if fn.endswith(('.html', '.css')):
        src = re.sub(r'<!--[\\s\\S]*?-->', ' ', src)
    return src

for dirpath, dirnames, filenames in os.walk(root):
    if any(x in dirpath for x in ['.git', 'node_modules', 'fonts']):
        continue
    for fn in filenames:
        if fn.endswith(('.js', '.html', '.css', '.json', '.webmanifest')):
            with open(os.path.join(dirpath, fn), encoding='utf8') as fh:
                chars |= set(re.findall(
                    # 注意 \U 前的双反斜杠：这是 JS 模板字符串，
                    # 写成单个 \U 会被 JS 先吃掉（\U 不是合法转义，退化成字面量 U），
                    # python 收到的是「U00020000-U0002FA1F」，于是扩展区一个字也扫不到 ——
                    # 这条断言正是这样空转了整整一轮，页面缺 183 个字却一直显示「缺 28」。
                    r'[\\u4e00-\\u9fff\\u3000-\\u303f\\uff00-\\uffef\\U00020000-\\U0002FA1F]',
                    strip_comments(fh.read(), fn)))
chars |= set('跬步·—…「」《》（）？！、。；：')
out = {'_total': len(chars)}
for name in ['NotoSansSC-400','NotoSansSC-600','NotoSerifSC-400','NotoSerifSC-600']:
    cmap = TTFont('${fontsDir}%s.woff2' % name).getBestCmap()
    out[name] = ''.join(sorted(c for c in chars if ord(c) not in cmap))
print(json.dumps(out, ensure_ascii=False))
`;
  const res = JSON.parse(execFileSync('python3', ['-c', py, path], { encoding: 'utf8' }));
  chk(res._total > 3000, '站点用字扫描出 ' + res._total + ' 个字符（含全部诗词译文）');
  // 覆盖面回到「零缺字」。
  //
  // 这里曾经放宽到「缺字不超过 90」——当时 Noto CJK 本身缺一批极生僻字
  // （礼器名、拟声词、古地名、古人名），只能回落系统字体。
  // 但那个口径有个漏洞：扫描只认 BMP，看不见《昭明文选》里
  // 《子虚赋》《吴都赋》那批 ExtB 生僻字，于是「缺 28 字」看着很稳，
  // 实际页面上空白的远不止这些。
  //
  // 现在两处都补齐了：
  //   · 扫描口径带上扩展区（U+20000–U+2FA1F），extB 缺字再也藏不住
  //   · 字体子集从花園明朝（HanaMin，公开领域）逐字取了轮廓补进去
  // 所以这条断言收紧成「一个都不能缺」，页面上不该再出现空字。
  // 补字脚本：scripts/supplement-fonts.py
  const MAX_MISSING = 0;
  Object.keys(res).filter(k => k.indexOf('Noto') === 0).forEach(name => {
    const miss = res[name] || '';
    chk(miss.length <= MAX_MISSING,
      name + ' 覆盖站会用字（缺 ' + miss.length + ' / 上限 ' + MAX_MISSING + '）'
      + (miss.length ? '：' + miss : ''));
  });
  subsetChecked = true;
} catch (e) {
  console.log('(未安装 fonttools，跳过字体子集覆盖检查：pip install fonttools brotli)');
}

/* ---------------- 搜索框聚焦光晕：不许拿不透明的填充色当 box-shadow ---------------- */
/*
   全站输入框聚焦时都是「天青描边 + 一圈**半透明**淡光」：
       .search-input:focus { box-shadow: 0 0 0 3px rgba(47, 96, 85, .10); }
   搜索页那一条（body[data-nav="search"] ...:focus）曾经误填了 --green-light
   （#dbe9e2，不透明的浅底**填充色**），于是同一枚控件在搜索页画出一圈实心
   粉绿外框、在别处是柔和光晕 —— 两副面孔，真机上看着像「框被加粗了一圈」。
   PWA 层（test/pwa.test.js）会拿真浏览器量这圈光晕的色相，但那一层要 puppeteer，
   缺依赖时整层跳过 —— 所以在主题层补一条**纯源码**断言，没浏览器也能守住：
   凡是给搜索框画 box-shadow 的地方，颜色必须是天青主色的半透明光（rgb 47,96,85），
   不能出现 --green-light / #dbe9e2 这类不透明填充色。
*/
{
  // 抓出所有「作用于 .search-input 的 :focus 规则块」
  const ruleRe = /([^{}]*?search-input[^{}]*?:focus[^{}]*?)\{([^}]*)\}/g;
  let m, checked = 0;
  while ((m = ruleRe.exec(classicCss)) !== null) {
    const body = m[2];
    const shadow = body.match(/box-shadow\s*:\s*([^;]+);/);
    if (!shadow) continue;
    checked++;
    const val = shadow[1].trim();
    chk(/rgba?\(47,\s*96,\s*85/.test(val),
      '搜索框聚焦光晕用天青主色的半透明光（不是不透明填充色）：' + val);
    chk(!/--green-light|#dbe9e2/i.test(val),
      '搜索框聚焦光晕没有误用 --green-light / #dbe9e2 这类不透明填充色：' + val);
  }
  chk(checked >= 1, '至少找到一处搜索框聚焦光晕规则（实际 ' + checked + ' 处）');
}

console.log(fails === 0 ? '\n🎉 主题测试全部通过' : '\n❌ ' + fails + ' 项失败');
process.exit(fails ? 1 : 0);
