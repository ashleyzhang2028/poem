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

/* ---------------- 宋式纹样与按钮分级（本次重做导航 / 美化 / 主页面背景去图案） ---------------- */
/* 需求：主页面（首页 / 小古文页 / 设置页 / 法务页）背景删除祥云图案，
   不再使用任何图案背景 —— 页面底只留素绢一色 --bg，长文里没有暗花。 */
const pageBlocks = [...css.matchAll(/(^|\n)html, body \{[\s\S]*?\}/g)].map(m => m[0]);
chk(pageBlocks.length > 0, '样式里有 html, body 的页面底声明');
const pageBlock = pageBlocks[pageBlocks.length - 1];
chk(!/--pattern/.test(pageBlock), '页面底不再引用任何纹样变量（祥云图案已删除）');
chk(/background-image:\s*none/.test(pageBlock), '页面底显式声明不铺图案背景');
chk(/background:\s*var\(--bg\)/.test(pageBlock) || /background:\s*var\(--bg\)/.test(css),
  '页面底是素绢一色 --bg，没有图案背景');
chk(!/background-attachment:\s*fixed/.test(pageBlock), '不再有平铺的固定底纹');
// 三层满铺大纹样（祥云 / 小云脚 / 云纹团花）连同变量一起移除
chk(!/--pattern-xiangyun/.test(css), '变量 --pattern-xiangyun 已删除');
chk(!/--pattern-xiangyun-b/.test(css), '变量 --pattern-xiangyun-b 已删除');
chk(!/--pattern-yunhua/.test(css), '变量 --pattern-yunhua 已删除');
const tiled = [...css.matchAll(/background-image:[^;]*var\(--pattern[^;]*;/g)].map(m => m[0])
  .filter(b => /,(\s*)/.test(b.replace(/url\([^)]*\)/g, 'url')));
chk(tiled.length === 0, '没有任何一处把多组纹样叠起来满铺（页面底不再是祥云底纹）');
chk(!/var\(--pattern-xiangyun/.test(css) && !/var\(--pattern-yunhua/.test(css),
  '页面样式里不再使用已删除的祥云变量');
// 只在说明「曾经满铺、现已去掉」的历史注释里允许出现旧变量名，正文/变量里不应再有
chk(!/--pattern[^:]*:[^;]*球路/.test(css) && !/--pattern[^:]*:[^;]*ivory/.test(css),
  '纹样变量与说明里不再保留旧版「球路纹」「如意云头纹」的实现');
chk(!/--pattern-luo:/.test(css) && !/--pattern-ivory:/.test(css),
  '旧纹样变量 --pattern-luo / --pattern-ivory 已移除');

// 按钮分级
chk(/@supports not/.test(css), '不支持 mask 的浏览器自动不出纹样（不影响布局）');
chk(/@supports not/.test(css), '不支持 mask 的浏览器自动不出纹样（不影响布局）');
// 按钮分级
chk(/\.btn\.primary\s*\{[^}]*linear-gradient/.test(css), '一级按钮为实底渐变（主操作）');
chk(/\.ghost-btn\s*\{[\s\S]{0,200}?border:\s*1px solid var\(--line\)/.test(css), '次级按钮为纸底描边');
chk(/\.danger-btn\s*\{[\s\S]{0,200}?color:\s*var\(--red\)/.test(css), '危险按钮用朱砂色，仅用于不可逆操作');
chk(/\.btn\.good\s*\{[^}]*inset 0 0 0 1px rgba\(240, 205, 124/.test(css), '「记住」按钮补上描金内边，与一级按钮同族');
// 导航样式
chk(/\.dock\s*\{[^}]*position:\s*fixed/.test(css), '底部导航栏固定定位');
chk(/\.dock-item\.active/.test(css), '页签有选中态样式');
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
// 需求：页面名（XX的古诗词 / 小古文）挪到「跬步」右侧，字体样式与「跬步」一致
chk(/\.brand-name-row/.test(css), '顶栏有「跬步 · 页面名」同一行的样式 .brand-name-row');
chk(/\.brand-name-row[\s\S]{0,260}?font-size:\s*19px/.test(css), '页面名与「跬步」同字号（19px）');
chk(/\.brand-page::before[\s\S]{0,120}?content:\s*"·"/.test(css),
  '分隔符「·」由 CSS 生成，页面里不写死标点');
// 只要求顶栏不再出现；meta description 里保留「一年级至高三古诗词」这句 SEO 描述是合理的
chk(!/一年级至高三 · 按遗忘曲线复习/.test(html + app + read('js/chrome.js')),
  '删掉顶栏的「一年级至高三 · 按遗忘曲线复习」文案');
// 需求（本次）：主标题下的描述文字要还原回来，但**不写年级字样**
// 描述改由页面用 body 上的 data-sub 给出，chrome.js 只负责渲染，文案不硬编码
chk(!/按遗忘曲线复习/.test(read('js/chrome.js')), 'chrome.js 里不再硬编码「按遗忘曲线复习」');
chk(/data-sub="[^"]+"/.test(html), '首页用 data-sub 给出主标题下的描述文字');
const subMatch = /data-sub="([^"]+)"/.exec(html);
const homeSub = subMatch ? subMatch[1] : '';
chk(/遗忘曲线/.test(homeSub), '描述文字里保留「遗忘曲线复习」的说法（实际「' + homeSub + '」）');
chk(/小古文/.test(homeSub), '描述文字同时点出小古文入口');
chk(!/一年级|二年级|至高三|小学|初中|高中|年级|学段/.test(homeSub),
  '描述文字里不再出现「一年级到高中」这类年级字样');
chk(!/一年级/.test(read('js/chrome.js').replace(/\/\*[\s\S]*?\*\//g, '')),
  'chrome.js 的代码里不再出现年级字样（注释除外）');
// 第二行留空时不占高度（页面没写 data-sub 时顶栏只有一行）
chk(/brand-sub:empty \{ display: none; \}/.test(css), '第二行留空时不占高度（小古文页顶栏只有一行）');
// 需求：用户不填名字也要显示「跬步 Ashley的古诗词」
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
chk(/\.collapse-head\.open \.arrow \{ transform: rotate\(180deg\); \}/.test(css),
  '展开时箭头旋转 180° 朝上');
chk(/\.collapse-head \.arrow[\s\S]{0,200}?color:\s*#9db3a9/.test(css),
  '箭头用与「›」相同的淡墨色，风格统一');

// 需求：古诗词详情页与小古文详情页同一套工具条
chk(/id="m-actions-main"/.test(html) && /id="m-actions-icons"/.test(html),
  '详情页工具条分两行（对齐/字号/注音 + 播放组合键/译文开关）');
chk(/id="m-align-seg"/.test(html), '详情页有左/中/右对齐组合按钮');
chk(/id="m-font-seg"/.test(html) && /id="m-font-down"/.test(html) && /id="m-font-up"/.test(html),
  '详情页有 A－ / A＋ 组合按钮');
chk(/id="m-trans-read"/.test(html), '详情页有白话译文朗读（组合键右段）');
chk(/id="m-trans-text"/.test(html), '详情页有白话译文段落');
chk(!/id="gw-done"/.test(html), '古诗词详情页不设「已读」按钮（与小古文唯一区别）');
// 需求：古诗正文默认字号小一号
chk(/\.poem-text \{[\s\S]{0,200}?font-size:\s*17px/.test(css), '古诗正文默认字号降为 17px');
chk(/\.poem-text\[data-align="left"\]/.test(css) && /\.poem-text\[data-align="right"\]/.test(css),
  '古诗正文支持左 / 右对齐切换');
// 需求：详情页三个评价按钮不被底部页签挡住。
// 只压 max-height 还不够 —— 弹层底边仍落在屏幕底边，
// 所以底部内边距也必须垫出页签高度（约 62px）。两条一起才真的「压不住」。
chk(/\.modal-box \{[\s\S]{0,400}?max-height:\s*calc\(88vh - 62px/.test(css),
  '弹层高度扣掉底部页签，最后的评价按钮不被压住');
chk(/\.modal-box \{[\s\S]{0,200}?padding-bottom:\s*calc\(26px \+ 62px \+ var\(--safe-bottom\)\)/.test(css),
  '弹层底部内边距再垫出页签高度，评价按钮整排落在页签上方');
chk(/body\.no-dock \.modal-box \{ padding-bottom:\s*calc\(26px \+ var\(--safe-bottom\)\); \}/.test(css),
  '法务页等无页签页面，弹层不必垫页签高度');
chk(/body\.no-dock \.modal-box \{ max-height: 88vh; \}/.test(css),
  '法务页等无页签页面，弹层照旧铺到底边附近');
// 需求：小古文阅读器顶栏与其他页面统一
// 返回键不再自己写一套圆形样式，而是直接复用全站顶栏的 .top-act
// （圆形纸底 + 40px + 内描边细线），阅读器里的返回与顶栏右侧那颗是同一颗按钮
chk(/\.reader-back \{\s*flex:\s*none/.test(classicCss), '阅读器返回键复用 .top-act，不再另起一套样式');
chk(/\.reader-back \{[\s\S]{0,200}?color:\s*var\(--green\)/.test(classicCss),
  '返回键只用天青一色（箭头不再被页名字样挤成两截）；笔画粗细由 .top-act 统一');
chk(/\.top-act,[\s\S]{0,300}?border-radius:\s*50%/.test(css), '全站顶栏动作位是圆形纸底（返回键与它同款）');
chk(/class="reader-back top-act"/.test(classicHtml), '阅读器返回键用的是全站统一的圆形按钮');
chk(!/<span>小古文<\/span>/.test(classicHtml), '返回键里不再叠「小古文」三个字');
chk(/\.reader-progress \{[\s\S]{0,120}?text-align:\s*center/.test(classicCss),
  '进度精确居中（而不是既没靠右也没居中）');
chk(/\.reader-bar-count \{[\s\S]{0,80}?width:\s*40px/.test(classicCss),
  '右侧等宽占位，保证进度真的落在屏幕正中');

chk(/data:image\/svg\+xml/.test(css), '仅存的纹样仍用内联 SVG data URI，不请求外部图片');
chk(/祥云纹/.test(css), '注释里写明被移除的宋「祥云纹」底纹，避免被误加回来');
/* 需求：卡片角隅 / 今日条的云纹点缀保留，且同步调淡 */
chk(/\.card-pat::before,[\s\S]{0,120}?opacity:\s*\.17;/.test(css), '卡片角隅云纹淡到 17%');
chk(/\.today-bar::after \{[\s\S]{0,400}?opacity:\s*\.14;/.test(css), '今日条云纹淡到 14%');
chk(/\.card-pat::before/.test(css) && /\.card-pat::after/.test(css), '卡片角隅云纹只在 .card-pat 上出现');
chk(/mask-image:\s*linear-gradient/.test(css), '角隅云纹用遮罩从角上透出来，不是贴一张图');
chk(/\.today-bar::after/.test(css), '今日背诵条有云纹点缀（仅存的两处点缀之一）');
chk(/--pattern-cloud:/.test(css), '点缀用的云纹变量 --pattern-cloud 仍在');
const decodedPatterns = [...css.matchAll(/--pattern-[a-z-]+: url\("data:image\/svg\+xml,([^"]+)"\)/g)]
  .map(m => decodeURIComponent(m[1])).join("\n");
chk(/stroke-opacity='\.08'/.test(decodedPatterns), '云纹不透明度 8%');

/* ---------------- 3. 传统色（宋代） ---------------- */
chk(/宋代/.test(css), '配色注释标明宋代取色');
// 天青主色
// 主色：雨过天青压深到 #2f6055（提升对比度，白底文字过 WCAG AA）
chk(/--green:\s*#2f6055/.test(css), '主色为加深后的雨过天青 #2f6055');
chk(!/--green:\s*#4d7d74/.test(css), '不再使用对比度不足的旧天青 #4d7d74');
// 宣纸底
chk(/--bg:\s*#f6f1e3/.test(css), '底色为素绢米灰 #f6f1e3');
// 需求：页面各个卡片的背景色透明度调整为 90%（留 10% 让祥云纹隐隐透出）
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
// 设置的入口是底部页签「设置」，由 js/chrome.js 渲染成真实链接
chk(/href:\s*"\.\/settings\.html"/.test(read('js/chrome.js')), '底部页签「设置」指向设置整页');
chk(html.indexOf('btn-settings') === -1, '首页顶栏不再有设置齿轮（入口收敛到页签）');
chk(/data-nav="settings"/.test(settingsHtml), '设置页声明自己是「设置」页签');
chk(/js\/chrome\.js/.test(settingsHtml), '设置页与首页共用同一套顶栏与底部页签');
chk(settingsHtml.indexOf('id="settings-page"') !== -1, '设置页有独立的整页容器');
chk(settingsHtml.indexOf('settings-modal') === -1, '设置页不再用弹层结构');
chk(settingsHtml.indexOf('class="foot settings-foot"') !== -1, '设置页底部有页脚（版权 + 法务链接）');

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
chk(/sw\.js/.test('sw.js') && /js\/pwa\.js/.test(read('settings.html')) && /js\/pwa\.js/.test(read('classic.html')),
  '所有页都加载 js/pwa.js，--nav-h 每页都会实测');
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

// 法务链接在设置页底部；返回入口交给全站统一的底部页签
chk(/data-nav-go/.test(read('js/chrome.js')) && /settings\.html/.test(read('js/chrome.js')),
  '设置页可经底部页签回到古诗词 / 小古文');
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
