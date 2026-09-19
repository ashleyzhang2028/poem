const fs = require('fs');
const path = __dirname + '/../';
const read = f => fs.readFileSync(path + f, 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const app = read('js/app.js');
const html = read('index.html');
const classicHtml = read('classic/index.html');

const legalHtml = read('terms/index.html') + read('privacy/index.html');
const allSrc = app + html + classicHtml + legalHtml + read('js/classic.js') + read('js/reader-core.js') + read('js/pwa.js');

chk(app.indexOf('这首歌按遗忘曲线到期了') === -1, '不再出现「这首歌按遗忘曲线到期了」');
chk(/APP_NAME\s*=\s*"跬步"/.test(app), '应用正式名称为「跬步」');
chk(html.indexOf('<title>跬步 · 课内背诵</title>') !== -1, '首页标题为「跬步 · 课内背诵」');
chk(!/积跬步古诗词/.test(html + legalHtml), '页面不再出现「积跬步古诗词」旧名');
chk(/"name":\s*"跬步/.test(read('manifest.webmanifest')), 'PWA 清单名称为跬步');

chk(/这首诗按" \+ algoShort\(\) \+ "到期了/.test(app),
  '到期提示改为「这首诗按 XX 到期了」（XX 是当前算法，随设置切换）');
chk(!/这首歌/.test(allSrc), '全站不再出现把诗词称作「歌」的措辞');

chk(html.indexOf('>今日背诵<') !== -1 && html.indexOf('今日背诵任务') === -1,
  '首页标题为「今日背诵」，不再写「今日背诵任务」');

const reader = read('js/reader.js');

const visibleText = (reader.match(/>[^<>{}]*</g) || []).join('');
chk(!/暂停|继续|下一篇|停止|正在朗读|播放/.test(visibleText),
  '播放栏可见文案里不再出现「暂停 / 继续 / 下一篇 / 停止 / 正在朗读」');
chk(/iconPlay|iconPause|iconStop|iconPrev|iconNext/.test(reader), '播放栏改用 SVG 图标表达状态');
const appSrc = read('js/app.js');
chk(!/"今日 " \+ todayPlan\.length \+ " 首"/.test(appSrc), '播放栏不再显示「今日 N 首」');

const css = read('css/style.css');
const classicCss = read('css/classic.css');

const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ');

chk(/\.today-read\s*\{[^}]*border-radius:\s*50%/.test(css), '今日朗读按钮是圆形（与 0/5 圆环成对）');

const todayActionsCss = (css.match(/\.today-actions \{([^}]*)\}/) || [, ''])[1];
const todaySize = todayActionsCss.match(/--today-btn-size:\s*(\d+)px/);
chk(!!todaySize, '今日条声明两颗圆的统一外盒尺寸 --today-btn-size（' + (todaySize && todaySize[1]) + 'px）');

const todayRingW = todayActionsCss.match(/--today-btn-ring:\s*([\d.]+)px/);
chk(!!todayRingW, '今日条声明播放键那圈边框的宽度 --today-btn-ring（' + (todayRingW && todayRingW[1]) + 'px）');
chk(todayRingW && todayRingW[1] === '1',
  '播放键边框 1px（小数边框会被浏览器取整，写整数这一步才算得准）');
chk(todaySize && todaySize[1] === '40',
  '播放键外盒 40px = 画出来的圆 40px，与进度环的最大外径同径（实际 ' + (todaySize && todaySize[1]) + 'px）');

chk(!/\.today-read \{[^}]*?(width|height):\s*\d+px/.test(stripComments(css)) &&
  !/\.ring \{[^}]*?(width|height):\s*\d+px/.test(stripComments(css)),
  '播放键与进度环都不另写死尺寸，只由 --today-btn-size（± 边框）推出（改一处即可整体收放）');

const todayScope = [
  (css.match(/\.today-actions \{([^}]*)\}/) || [, ''])[1],
  (css.match(/\.today-read \{([^}]*)\}/) || [, ''])[1],
  (css.match(/\.ring \{([^}]*)\}/) || [, ''])[1]
].map(stripComments).join('\n');
chk(!/46px/.test(todayScope) && !/43px/.test(todayScope),
  '今日条声明里不再残留前几轮的 46px / 43px（外径只有一个来源）');
const readCss = (css.match(/\.today-read \{([^}]*)\}/) || [, ''])[1];

chk(/width:\s*calc\(\s*var\(--today-btn-size\)\s*-\s*var\(--today-btn-ring\)\s*\*\s*2\s*\)/.test(readCss) &&
  /height:\s*calc\(\s*var\(--today-btn-size\)\s*-\s*var\(--today-btn-ring\)\s*\*\s*2\s*\)/.test(readCss),
  '左侧朗读圆键的宽高都取「外缘 − 两侧边框」，画出来的圆才等于 --today-btn-size');
chk(/box-sizing:\s*content-box/.test(readCss),
  '播放键改用 content-box（那圈 1px 边框往外长，不再把圆吃小）');
chk(/border:\s*var\(--today-btn-ring\)/.test(readCss),
  '边框宽度走 --today-btn-ring（唯一来源，不在这里另写数值）');

const readNums = (readCss.replace(/\/\*[\s\S]*?\*\//g, ' ').match(/\d+(\.\d+)?px/g) || []).filter(n => n !== '1.5px');
chk(readNums.length === 0,
  '播放键盒子里只剩边框这一个数值（其它都读变量）：' + readNums.join(' / '));
chk(/(^|\s)padding:\s*0;/.test(readCss),
  '播放键显式 padding: 0 —— <button> 的 UA 默认 1px 6px 会把它撑成 52px 宽，'
  + '与 40px 的进度环并排就是「一大一小」（浏览器里量得到、jsdom 量不到）');

const todayInner = (css.match(/\.today-actions \{([^}]*)\}/) || [, ''])[1].match(/--today-btn-inner:\s*([\d.]+)px/);
chk(!!todayInner, '今日条声明内径唯一来源 --today-btn-inner（' + (todayInner && todayInner[1]) + 'px）');
chk(todayInner && todayInner[1] === '17',
  '播放键图标框 17px（三角每边比上一轮的 14px 框再长一档，实际 ' + (todayInner && todayInner[1]) + 'px）');

const edgePx = box => +(15.403 / 24 * box).toFixed(2);
const todayEdge = edgePx(parseFloat(todayInner[1]));
const ringDia = 40;
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

chk(!/width:\s*54px/.test(css) && !/height:\s*54px/.test(css), '不再保留上一轮的 54px 写死尺寸');

chk(/\.item-read\s*\{[^}]*border-radius:\s*50%/.test(css), '列表单项右侧按钮是圆形播放键');

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

chk(/\.mini-btn \.btn-icon/.test(classicCss), '小古文朗读按钮的图标容器样式仍在（纯 SVG 图标）');

chk(/@font-face/.test(css), '样式里声明了 @font-face 自托管字体');
chk(/font-family:\s*"Poem Serif SC"/.test(css), '声明了宋体族 Poem Serif SC');
chk(/--font-poem:/.test(css), '定义了诗词字体变量 --font-poem');
chk(/--font-ui:/.test(css), '定义了界面字体变量 --font-ui');

const fonts = ['NotoSerifSC-400.woff2', 'NotoSerifSC-600.woff2', 'NotoSansSC-400.woff2', 'NotoSansSC-600.woff2'];
fonts.forEach(f => {
  const p = path + 'fonts/' + f;
  const ok = fs.existsSync(p) && fs.statSync(p).size > 1024;
  chk(ok, '字体文件存在且非空：fonts/' + f);
});
chk(fs.readFileSync(path + 'fonts/NotoSerifSC-400.woff2').slice(0, 4).toString('latin1') === 'wOF2',
  '字体为 WOFF2 格式');

chk(/\.item-title\s*\{[^}]*font-family:\s*var\(--font-poem\)/.test(css), '列表诗题使用宋体');
chk(/\.item-meta\s*\{[^}]*font-family:\s*var\(--font-poem\)/.test(css), '列表朝代/作者使用宋体');
chk(/\.modal-head h2[\s\S]{0,300}?var\(--font-poem\)/.test(css), '弹层诗题使用宋体');
chk(/\.poem-text[\s\S]{0,200}?var\(--font-poem\)/.test(css), '诗词正文使用宋体');
chk(/\.tag\s*\{[^}]*font-family:\s*var\(--font-poem\)/.test(css), '朝代/作者标签使用宋体');
chk(/\.reader-text[\s\S]{0,300}?var\(--font-poem\)/.test(classicCss), '小古文正文使用宋体');
chk(/\.reader-body h2[\s\S]{0,300}?var\(--font-poem\)/.test(classicCss), '小古文标题使用宋体');

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

chk(/html, body \{/.test(css), '样式里有 html, body 的页面底声明');
chk(!/--pattern/.test(css) || !/background-image:\s*[^;]*var\(--pattern/.test(css),
  '页面底不再引用任何纹样变量');
chk(/html, body \{[^}]*background:\s*var\(--bg\)/.test(css), '页面底是素绢一色 --bg，没有图案背景');
chk(!/html, body \{[^}]*background-image:\s*url/.test(css), '页面底没有任何图案 background-image 铺装');
chk(!/background-attachment:\s*fixed/.test(css), '不再有平铺的固定底纹');
chk(/--bg:\s*#f6f1e3/.test(css), '素绢底色 --bg 仍为 #f6f1e3');

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

chk(!/祥云纹|云纹|纹样/.test(css), '样式表里连纹样相关的字样都不再有（误加回来的口子已封）');

chk(/\.btn\.primary\s*\{[^}]*background:\s*var\(--green\)/.test(css),
  '一级按钮是平色实底（不再是三段渐变）');
chk(/\.btn\.primary\s*\{[^}]*border-color:\s*var\(--green-dark\)/.test(css),
  '一级按钮仍有一条深天青描边（分级靠描边，不靠立体感）');
chk(/\.ghost-btn\s*\{[\s\S]{0,200}?border:\s*1px solid var\(--line\)/.test(css), '次级按钮为纸底描边');

chk(/\ba\s*\{[^}]*text-decoration:\s*none/.test(css),
  '全站 <a> 默认无下划线（唯一来源，Issue #122 → #163）');
chk(!/\.ghost-btn \{[\s\S]{0,400}?text-decoration:/.test(css),
  '次级按钮不再单独写一遍 text-decoration（下划线归全局那一条管）');

const settingsSrc = read('settings/recite/index.html');
chk(/<a class="btn ghost-btn" href="\/progress\/"/.test(settingsSrc),
  '设置页进「进度总览」的按钮仍是 <a>（因此必须显式去掉链接默认下划线）');

const progressRow = (settingsSrc.match(/<div class="settings-item">\s*<label>进度总览<\/label>[\s\S]{0,400}?<\/div>/) || [''])[0];
chk(!!progressRow, '设置页有「进度总览」这一项（标签已由「背诵进度」改名为「进度总览」）');
chk(!/背诵进度<\/label>/.test(settingsSrc), '设置页不再有「背诵进度」这枚标签（同一件事只说一遍）');
chk(!/看进度总览/.test(settingsSrc), '设置页不再出现「看进度总览」这串旧文案');
chk(/\.danger-btn\s*\{[\s\S]{0,200}?color:\s*var\(--red\)/.test(css), '危险按钮用朱砂色，仅用于不可逆操作');

chk(/\.btn\.good\s*\{[^}]*background:\s*var\(--green\)/.test(css),
  '「记住」是平色实底，与一级按钮同族（不再补描金内边）');

chk(/\.dock\s*\{[^}]*position:\s*fixed/.test(css), '底部导航栏固定定位');
chk(/\.dock-item\.active/.test(css), '页签有选中态样式');

chk(!/\.dock-item::before/.test(css) && !/\.dock-item\.active::before/.test(css),
  '页签选中态不再用 ::before 画「下划线」');
chk(/\.dock-item\.active \.dock-icon \{[^}]*translateY/.test(css), '选中态改由图标轻微抬起表达');
chk(/prefers-reduced-motion[\s\S]{0,160}?\.dock-icon/.test(css), '减少动态偏好下不再位移（无障碍兜底）');

chk(/a \{ text-decoration: none; \}/.test(css),
  '页面链接（含页签里的 <a>）由全站唯一那条 `a { text-decoration: none }` 负责');
chk((css.match(/a \{ text-decoration: none; \}/g) || []).length === 1,
  '这条规则全站只有一处（六处各写一遍就是六个会漏的地方）');

chk(/\.dock-item\.active \{[\s\S]{0,200}?background:\s*rgba\(47,\s*96,\s*85/.test(css),
  '页签选中态有天青药丸底，不只靠文字染色');
chk(/\.brand-mark/.test(css), '顶栏徽标（logo）有独立样式');
chk(/\.top-act/.test(css), '顶栏右侧动作位（设置 / 返回）有独立样式');

chk(!/font-family:\s*"Songti SC"/.test(css), '不再把设备自带 Songti SC 作为首选字体');

const sw = read('sw.js');
chk(sw.indexOf('./fonts/NotoSerifSC-400.woff2') !== -1, 'Service Worker 预缓存宋体字库');
chk(sw.indexOf('./fonts/NotoSansSC-400.woff2') !== -1, 'Service Worker 预缓存黑体字库');
chk(!/fonts\.googleapis|fonts\.gstatic/.test(css + html + classicHtml), '不请求任何第三方字体 CDN');
chk(!/fonts\.googleapis|fonts\.gstatic/.test(legalHtml), '法务页同样不请求第三方字体 CDN');

chk(/\.brand-name-row/.test(css), '顶栏有「跬步 · 页面名」同一行的样式 .brand-name-row');
chk(/\.brand-name-row[\s\S]{0,260}?font-size:\s*19px/.test(css), '页面名与「跬步」同字号（19px）');
chk(/\.brand-page::before[\s\S]{0,120}?content:\s*"·"/.test(css),
  '分隔符「·」由 CSS 生成，页面里不写死标点');

chk(!/一年级至高三 · 按遗忘曲线复习/.test(html + app + read('js/chrome.js')),
  '删掉顶栏的「一年级至高三 · 按遗忘曲线复习」文案');

chk(!/按遗忘曲线复习/.test(read('js/chrome.js').replace(/\/\*[\s\S]*?\*\//g, '')),
  'chrome.js 里不再硬编码「按遗忘曲线复习」');
chk(/data-sub="[^"]+"/.test(html), '首页用 data-sub 给出主标题下的描述文字');
const subMatch = /data-sub="([^"]+)"/.exec(html);
const homeSub = subMatch ? subMatch[1] : '';

chk(/^按.+复习$/.test(homeSub),
  '描述文字是「按 XX 复习」句式（实际「' + homeSub + '」）');
chk(!/一年级|二年级|至高三|小学|初中|高中|年级|学段/.test(homeSub),
  '描述文字里不再出现「一年级到高中」这类年级字样');
chk(!/一年级/.test(read('js/chrome.js').replace(/\/\*[\s\S]*?\*\//g, '')),
  'chrome.js 的代码里不再出现年级字样（注释除外）');

chk(/brand-sub:empty \{ display: none; \}/.test(css), '第二行留空时不占高度（小古文页顶栏只有一行）');

chk(/DEFAULT_USER\s*=\s*"Ashley"/.test(app), 'app.js 定义默认用户名 Ashley');
chk(/username\s*==\s*null \? "" : settings\.username\)\.trim\(\)\s*\|\|\s*DEFAULT_USER|\|\| DEFAULT_USER/.test(app),
  '用户名留空时回落到默认名 Ashley');

const cssPb = css.slice(css.lastIndexOf('.player-bar {'));
chk(/\.pb-btn \{[\s\S]{0,300}?border-radius:\s*50%/.test(cssPb), '播放栏按钮是正圆（border-radius: 50%）');
chk(/\.pb-btn \{[\s\S]{0,400}?border:\s*1px solid rgba\(253, 248, 234/.test(cssPb), '圆形按钮有一圈细描边');
chk(!/\.pb-toggle \{[\s\S]{0,200}?border-radius:\s*10px/.test(cssPb), '播放键不再是圆角方形基座');

chk(/\.collapse-head \.arrow \{[\s\S]{0,220}?display:\s*inline-flex/.test(css),
  '折叠箭头改为内联 SVG（不再是实心 ▾ 字符）');
chk(/\.collapse-head \.arrow svg \{ display: block; width: 18px/.test(css), '箭头尺寸与图标一致');

chk(/\.item-arrow svg \{ display: block; width: 18px; height: 18px; \}/.test(css),
  '列表右侧箭头是 18×18 的内联 SVG（不再是文本字符「›」）');
chk(!/\.item-arrow \{[^}]*font-size:\s*18px/.test(css),
  '列表右侧箭头不再靠 font-size 定大小');

const arrowSvgBlocks = css.match(/\.(?:item-arrow|collapse-head \.arrow) svg \{[^}]*\}/g) || [];
chk(arrowSvgBlocks.length >= 2 &&
  arrowSvgBlocks.every(b => /width:\s*18px/.test(b) && /height:\s*18px/.test(b)),
  '列表箭头与折叠箭头同为 18×18（' + arrowSvgBlocks.length + ' 处）');
chk(/\.collapse-head \.arrow svg \{ display: block; width: 18px/.test(css),
  '折叠箭头那一条样式在（首页那张卡回来了，它才真的守着一处落点）');

chk(!/<div class="item-arrow">›<\/div>/.test(read('js/app.js')) &&
  !/<div class="item-arrow">›<\/div>/.test(read('js/reader-core.js')),
  '列表箭头改由 arrowGlyph() 输出内联 SVG（不再写死「›」字符）');
chk(/function arrowGlyph\(\)/.test(read('js/app.js')) && /function arrowGlyph\(\)/.test(read('js/reader-core.js')),
  '首页与古籍页各自用同一枚 arrowGlyph() 画箭头');

chk(/id="btn-all"[\s\S]{0,900}?class="arrow"[\s\S]{0,260}?stroke-width="1\.8"/.test(html),
  '首页折叠箭头是同一枚 1.8 描边的空心三角（不是实心 ▾ 字符）');
chk(/\.collapse-head\.open \.arrow \{ transform: rotate\(180deg\); \}/.test(css),
  '展开时箭头旋转 180° 朝上');
chk(/\.collapse-head \.arrow[\s\S]{0,200}?color:\s*#9db3a9/.test(css),
  '箭头用与「›」相同的淡墨色，风格统一');

chk(/id="m-actions-main"/.test(html) && /id="m-actions-icons"/.test(html),
  '详情页工具条分两行（对齐/字号/注音 + 播放组合键/译文开关）');
chk(/id="m-align-seg"/.test(html), '详情页有左/中对齐组合按钮');

chk(!/data-align="right"/.test(html), '详情页不再有右对齐按钮');
chk(!/id="m-align-seg"[\s\S]{0,900}?data-align="right"/.test(html), '对齐组合里只剩左 / 中两个按钮');
chk(/id="m-font-seg"/.test(html) && /id="m-font-down"/.test(html) && /id="m-font-up"/.test(html),
  '详情页有 A－ / A＋ 组合按钮');
chk(/id="m-trans-read"/.test(html), '详情页有白话译文朗读（组合键右段）');
chk(/id="m-trans-text"/.test(html), '详情页有白话译文段落');

chk(/id="m-trans-src"/.test(html) && /class="trans-src"/.test(html),
  '详情页译文框有来源注脚 #m-trans-src');
chk(/id="rd-trans-src"/.test(read('classic/index.html')), '小古文阅读器也有同一套来源注脚');
chk(/TRANSLATION_SOURCES/.test(read('data/index.js')), '来源口径文案集中在 data/index.js 一处');
chk(/translationSourceText/.test(read('data/index.js')), 'data/index.js 提供取文案的函数');
chk(/data\/index\.js/.test(read('classic/index.html')),
  '小古文页加载了 data/index.js（否则来源文案取不到，注脚会是空白）');
chk(/\.trans-src/.test(css) && /\.trans-src/.test(read('css/classic.css')),
  'style.css 与 classic.css 都有 .trans-src 样式（两页共用同一套数值）');

['css/style.css', 'css/classic.css'].forEach(f => {
  const c = read(f);
  chk(/\.trans-box p\.trans-src\s*\{/.test(c),
    f + ' 注脚用 .trans-box p.trans-src（0-2-1），压得住 .trans-box p（0-1-1）');
  chk(!/(^|\})\s*\.trans-src\s*\{/m.test(c),
    f + ' 不再留一条低特异性的裸 .trans-src 规则');

  const m = c.match(/\.trans-box p\.trans-src\s*\{([\s\S]{0,200}?)\}/);
  chk(m && /font-size:\s*11\.5px/.test(m[1]) && /line-height:\s*1\.7/.test(m[1]) &&
    /color:\s*var\(--ink-3\)/.test(m[1]),
    f + ' 注脚数值与另一页一致（11.5px / 1.7 / --ink-3）');
});

const CLAIMS_AUTHORITY = [
  /译文[^。；\n]{0,30}(?:以|与|按)[^。；\n]{0,30}(?:教师用书|教参)[^。；\n]{0,10}为准/,
  /(?:教师用书|教参)[^。；\n]{0,6}与课后[^。；\n]{0,10}释义[^。；\n]{0,6}为准/,
  /译文[^。；\n]{0,20}来源[^。；\n]{0,6}以统编版/
];
['README.md', 'index.html', 'classic/index.html', 'terms/index.html', 'privacy/index.html'].forEach(f => {

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

chk(/\.poem-text \{[\s\S]{0,200}?font-size:\s*17px/.test(css), '古诗正文默认字号降为 17px');
chk(/\.poem-text\[data-align="left"\]/.test(css) && !/data-align="right"/.test(css),
  '古诗正文只留左对齐规则，右对齐规则已删除');

chk(/\.modal-box \{[\s\S]{0,500}?max-height:\s*calc\(88vh - var\(--nav-h\)/.test(css),
  '弹层高度扣掉底部导航（--nav-h），最后的评价按钮不被压住');
chk(/\.modal-box \{[\s\S]{0,200}?padding-bottom:\s*calc\(26px \+ var\(--nav-h\) \+ var\(--safe-bottom\)\)/.test(css),
  '弹层底部内边距再垫出底部导航高度，评价按钮整排落在页签上方');
chk(/body\.no-dock \.modal-box \{ padding-bottom:\s*calc\(26px \+ var\(--safe-bottom\)\); \}/.test(css),
  '法务页等无页签页面，弹层不必垫页签高度');
chk(/body\.no-dock \.modal-box \{ max-height: 88vh; \}/.test(css),
  '法务页等无页签页面，弹层照旧铺到底边附近');

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

chk(Number(zDock) < Number(zPlayer),
  '底部页签（' + zDock + '）仍低于播放栏（' + zPlayer + '），两者的让路关系没被改乱');

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

chk(/\.icon-btn \{[^}]*border-radius:\s*50%/.test(css),
  '别处的同类按钮（.icon-btn）仍是圆形纸底 —— 用户点名的只有右上角那一颗');
chk(/\.top-act \{[^}]*border:\s*0[^}]*background:\s*none/.test(css.replace(/\/\*[\s\S]*?\*\//g, ' ')),
  '顶栏那一颗是裸箭头（去圆框、去底色）');
chk(!/<span>小古文<\/span>/.test(classicHtml), '顶栏里不再叠「小古文」三个字');

chk(/--green:\s*#2f6055/.test(css) && /--bg:\s*#f6f1e3/.test(css),
  '调色板仍是宋代那一套取色（雨过天青 + 素绢米灰）');

chk(/--green:\s*#2f6055/.test(css), '主色为加深后的雨过天青 #2f6055');
chk(!/--green:\s*#4d7d74/.test(css), '不再使用对比度不足的旧天青 #4d7d74');

chk(/--bg:\s*#f6f1e3/.test(css), '底色为素绢米灰 #f6f1e3');

chk(/--card:\s*rgba\(255, 254, 250, \.90\)/.test(css),
  '卡片背景改为 90% 不透明的宣纸白 rgba(255,254,250,.90)');
chk(/\.modal-box \{[\s\S]{0,300}?background:\s*rgba\(252, 250, 243, \.90\)/.test(css),
  '古诗 / 设置弹层同为 90% 不透明');
chk(/--ink:\s*#241d18/.test(css), '正文墨色加深到 #241d18（提升对比度）');
chk(/--ink-2:\s*#6b5c4d/.test(css), '次要文字淡墨加深到 #6b5c4d');

[['天青 / 主色', /--green:\s*#2f6055/], ['宣纸 / 卡片', /--card:\s*rgba\(255,\s*254,\s*250/],
 ['琥珀', /--amber:\s*#[0-9a-f]{6}/], ['朱砂', /--red:\s*#[0-9a-f]{6}/],
 ['缃色', /--gold:\s*#[0-9a-f]{6}/], ['天水碧', /--blue:\s*#[0-9a-f]{6}/]]
  .forEach(([n, re]) => chk(re.test(css), '传统色「' + n + '」在调色板里有对应的自定义属性'));

chk(!/#4a7c59/.test(css), '不再使用旧品牌绿 #4a7c59');
chk(!/#4a7c59/.test(html + classicHtml), '页面 theme-color 不再使用旧品牌绿');
chk(!/#4a7c59/.test(legalHtml), '用户协议 / 隐私条款页 theme-color 也不再使用旧品牌绿');
chk(!/#4a7c59/.test(read('manifest.webmanifest')), 'PWA 清单不再使用旧品牌绿');
chk(/"theme_color":\s*"#2f6055"/.test(read('manifest.webmanifest')), 'PWA 清单主题色为加深后的天青');
chk(/"background_color":\s*"#f6f1e3"/.test(read('manifest.webmanifest')), 'PWA 清单背景色为素绢（与 --bg 同步）');

const pbBlock = /(\.player-bar \{[\s\S]*?\n\})/.exec(css);
chk(!!pbBlock, '样式里有 .player-bar（底部播放栏）');
const pb = pbBlock ? pbBlock[1] : '';
chk(/position:\s*fixed/.test(pb), '播放栏固定定位');
chk(/left:\s*0;/.test(pb) && /right:\s*0;/.test(pb), '播放栏左右贴边占满整个底部宽度');
chk(/bottom:\s*0;/.test(pb), '播放栏贴住屏幕底部（不再是 margin 浮起）');
chk(!/border-radius/.test(pb), '播放栏不再有圆角，是整块弹出的播放器');
chk(/linear-gradient/.test(pb), '播放栏用宋式深天青渐变，明暗有层次');
chk(/border-top:\s*1px solid rgba\(240, 205, 124/.test(pb), '顶边一支描金细线（缃色）');

const padNum = (pb.match(/padding:[^;]+;/) || [''])[0].match(/(\d+)px/g) || [];
chk(padNum.length >= 2 && parseInt(padNum[0]) >= 14, '播放栏高度加大（padding ' + padNum.join(' ') + '）');
chk(/\.pb-now\s*\{[^}]*font-size:\s*18px/.test(css), '当前一首用大字号（18px）');
chk(/\.pb-next\s*\{[^}]*font-size:\s*11\.5px/.test(css), '下一首用小字号（11.5px）');
chk(/\.pb-toggle\s*\{[^}]*46px/.test(css), '播放 / 暂停主按钮更大（46px）');
chk(/\.pb-toggle\s*\{[^}]*var\(--gold\)/.test(css), '主按钮用缃色（与进度环同色）');

const playSrcs = {
  'index.html': html,
  'classic/index.html': classicHtml,
  'js/app.js': app,
  'js/reader-core.js': read('js/reader-core.js'),
  'js/reader.js': read('js/reader.js')
};

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

const readerSrc = read('js/reader.js');
['M8\.4 6\.1 18\.3 12 8\.4 17\.9Z', 'M17\.3 6\.1 9\.1 12l8\.2 5\.9Z', 'M6\.7 6\.1l8\.2 5\.9-8\.2 5\.9Z']
  .forEach(function (d) {
    const re = new RegExp('<path d="' + d + '"[^>]*fill="none" stroke="currentColor"');
    chk(re.test(readerSrc), '播放栏的三角 ' + d.slice(0, 12) + '… 为空心描边');
  });

const SVGW = 24;
const SW_RE = /<path d="M8\.4 6\.1 18\.3 12 8\.4 17\.9Z"[^>]*?stroke-width="([\d.]+)"/g;

const SW_RE2 = /<path d="M(?:17\.3 6\.1 9\.1 12l8\.2 5\.9Z|6\.7 6\.1l8\.2 5\.9-8\.2 5\.9Z)"[^>]*?stroke-width="([\d.]+)"/g;
const swList = src => [...src.matchAll(SW_RE)].map(m => m[1])
  .concat([...src.matchAll(SW_RE2)].map(m => m[1]));

const boxOf = {
  'index.html': [17],
  'classic/index.html': [17, 17],
  'js/app.js': [16],
  'js/reader-core.js': [16],
  'js/reader.js': [17, 17, 17]
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

chk(/stroke-width="1\.5"[^>]*\/>/.test(html.indexOf('today-read') > -1 ? html.slice(0, html.indexOf('today-read') + 900) : ''),
  '首页今日条那颗三角的描边值是 1.5（17px 图标框 → 约 1.06px）');
['js/app.js', 'js/reader-core.js'].forEach(function (f) {
  chk(/stroke-width="1\.5"/.test(read(f)), f + ' 里列表项那颗三角的描边值是 1.5（16px 框 → 1px）');
});
chk(/stroke-width="2"[^>]*\/>/.test(read('js/reader-core.js')),
  '分组小号圆键那颗三角的描边值是 2（12px 框 → 1px）');
chk(!/stroke-width="2\.4"/.test(html + classicHtml + app + read('js/reader-core.js') + read('js/reader.js')),
  '全站不再有旧的 2.4 描边（三角边框这一轮统一收细）');

chk(/\.item-read \{[\s\S]*?border:\s*1px solid var\(--line\);[\s\S]*?color:\s*var\(--green\)/.test(css),
  '列表项圆键的 color 就是它的图标色，三角描边取其值');
chk(/\.gw-play \{[\s\S]*?border:\s*1px solid var\(--line\);[\s\S]*?color:\s*var\(--blue\)/.test(classicCss),
  '小古文圆键同上（color 走天水碧，环与三角同源）');

const icon = read('icons/icon.svg');
chk(/<svg/.test(icon), 'favicon 使用 SVG');
chk(!/font-family|text|Noto/.test(icon), 'favicon 用矢量笔画绘制，不依赖字体');
chk(/#4d7d74|#37605a/.test(icon), 'favicon 使用天青主色');
chk(/#a83b32|#c8564a/.test(icon), 'favicon 带朱砂印');
chk(/诗|讠/.test(icon), 'favicon 备注里有「诗」字说明');

['icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-256.png',
 'icons/icon-384.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'].forEach(f => {
  const p = path + f;
  chk(fs.existsSync(p) && fs.statSync(p).size > 1024, '图标存在：' + f);
});

const pngSize = p => {
  const b = fs.readFileSync(path + p);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};
const expected = {
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

// 只留 180 那一张 iOS 主屏图：下面这批重复档已删（Issue #229 之后）
const GONE = ['icons/icon-120.png', 'icons/icon-152.png', 'icons/icon-167.png',
  'icons/icon-180.png', 'icons/favicon.ico', 'icons/favicon-16x16.png',
  'icons/favicon-32x32.png', 'icons/android-chrome-192x192.png'];
const stillThere = GONE.filter(f => fs.existsSync(path + f));
chk(stillThere.length === 0,
  '重复的 <256 图标与 favicon 三件套已删（实际 ' + (stillThere.join('、') || '全部已删') + '）');

const home = read('index.html');
chk(!/sizes="(120x120|152x152|167x167|180x180)"/.test(home),
  '首页不再逐档指定 apple-touch-icon 尺寸（iOS 会自己缩放最接近的一张）');
chk((home.match(/rel="apple-touch-icon"/g) || []).length === 1,
  '首页只留一条 apple-touch-icon');
const manifestTxt = read('manifest.webmanifest');
chk(!/icon-(120|152|167|180)\.png/.test(manifestTxt),
  'manifest 里不再挂 <180 的图标档');
chk(!/icon-(120|152|167|180)\.png/.test(read('sw.js')),
  'sw 预缓存里不再留已删图标');

const norm = fs.readFileSync(path + 'icons/icon-maskable-512.png');
const any = fs.readFileSync(path + 'icons/icon-512.png');
chk(Buffer.compare(norm, any) !== 0, 'maskable 图标与普通图标是两份不同的图');

const settingsHtml = read('settings/index.html');
const SETTINGS_HTML = [
  'settings/general/index.html',
  'settings/recite/index.html',
  'settings/lists/index.html',
  'settings/reader/index.html'
].map(read).join('\n');
const settingsJs = read('js/settings.js');
const NAV_SRC = read('js/settings-nav.js');

const SHARED_TITLE_SELECTORS = ['.settings-group-title', '.settings-link-title',
  '.item-title'];
function sharedTitleRule(code) {
  const m = code.match(/\.settings-group-title,[\s\S]{0,200}?\{([\s\S]{0,400}?)\}/);
  if (!m) return '';
  const block = m[0].slice(0, m[0].indexOf('{'));
  return SHARED_TITLE_SELECTORS.every(sel => block.indexOf(sel) !== -1) ? m[1] : '';
}

const pwaJs = read('js/pwa.js');

chk(html.indexOf('settings-modal') === -1, '首页不再有向上弹出的设置卡片（settings-modal 已删除）');

chk(/href:\s*"\/mine\/"/.test(read('js/chrome.js')), '底部页签「我的」指向 /mine/（目录化路径）');
chk(/settings:\s*"\/settings\/"/.test(read('js/chrome.js')), 'ROUTES 里仍有 /settings/（齿轮那一颗的落点）');
chk(html.indexOf('btn-settings') === -1, '首页顶栏不再有设置齿轮（入口收敛到页签）');
chk(/data-nav="settings"/.test(settingsHtml), '设置主页声明自己是「设置」页签');
chk(/js\/chrome\.js/.test(settingsHtml), '设置页与首页共用同一套顶栏与底部页签');
chk(settingsHtml.indexOf('id="settings-page"') !== -1, '设置主页有独立的整页容器');
chk(settingsHtml.indexOf('settings-modal') === -1, '设置页不再用弹层结构');
chk(settingsHtml.indexOf('class="foot') === -1, '设置主页底部不再有页脚（版权 + 法务链接已删）');

['settings/general/index.html', 'settings/recite/index.html',
 'settings/lists/index.html', 'settings/reader/index.html'].forEach(f => {
  const src = read(f);
  chk(/data-nav="settings"/.test(src), f + ' 声明自己是「设置」页签（页签选中态不漂）');
  chk(/js\/chrome\.js/.test(src), f + ' 共用同一套顶栏与底部页签');
  chk(src.indexOf('id="settings-page"') !== -1, f + ' 有独立的整页容器');
  chk(src.indexOf('class="foot') === -1, f + ' 不再有页脚（版权 + 法务链接已删）');
  chk(src.indexOf('settings-modal') === -1, f + ' 不用弹层结构');

  chk(/data-back="\/settings\/"/.test(src), f + ' 顶栏返回键指回设置主页');
});
chk(/data-back="\/settings\/"/.test(read('settings/general/index.html')),
  '二级页用 data-back 声明上一层（js/chrome.js 读它）');

const PAGE_GROUPS = {
  general: { count: 1, titles: [] },
  recite: { count: 2, titles: ['背诵', '复习算法'] },
  lists: { count: 2, titles: ['打印'] },
  reader: { count: 1, titles: [] }
};
const pageGroups = {};
chk((SETTINGS_HTML.match(/class="settings-group"/g) || []).length === 6,
  '四张设置页合起来是六组：通用 / 背诵 / 复习算法 / 我的清单 / 打印 / 朗读');
Object.keys(PAGE_GROUPS).forEach(k => {
  const src = read('settings/' + k + '/index.html');
  chk((src.match(/class="settings-group"/g) || []).length === PAGE_GROUPS[k].count,
    '「settings/' + k + '」页有 ' + PAGE_GROUPS[k].count + ' 个分组');
  const titles = [...src.matchAll(/settings-group-title[^>]*>([^<]+)</g)].map(m => m[1]);
  chk(titles.join(',') === PAGE_GROUPS[k].titles.join(','),
    '「settings/' + k + '」页的组标题是「' + (PAGE_GROUPS[k].titles.join(',') || '一个都不写') +
    '」（实际 ' + (titles.join(',') || '一个都没有') + '）');
  pageGroups[k] = src;
});
chk(['general', 'reader'].every(k =>
    !/settings-group-title/.test(pageGroups[k]) && /data-page="/.test(pageGroups[k])),
  '只有一组的页不再写正文组标题（组名只留顶栏页名一处）');
chk(/settings-group-title[^>]*>复习算法</.test(pageGroups.recite),
  '「复习算法」仍是分组标题（它是「背诵」页里两段的分界）');
chk(/settings-group-title[^>]*>打印</.test(pageGroups.lists),
  '「打印」仍是分组标题（3 期新增，「我的清单」页里两段的分界）');
chk(!/settings-group-title[^>]*>阅读辅助</.test(SETTINGS_HTML) &&
    !/settings-group-title[^>]*>朗读播放</.test(SETTINGS_HTML),
  '不再有「阅读辅助」「朗读播放」两个组标题（Issue #163 并成「朗读」）');

const blockOf = k => pageGroups[k];
const generalBlock = blockOf('general');
const reciteBlock = blockOf('recite');
const listsBlock = blockOf('lists');
const readerBlock = blockOf('reader');

{

  const groupsSrc = NAV_SRC.slice(NAV_SRC.indexOf('var GROUPS = ['),
    NAV_SRC.indexOf('function esc('));
  const order = [...groupsSrc.matchAll(/key:\s*"([a-z]+)"/g)].map(m => m[1]);
  chk(order.join(',') === 'general,recite,lists,reader',
    '四个入口的顺序为 通用 → 背诵 → 清单 → 朗读（实际 ' + order.join(',') + '）');

  chk(/title:\s*"清单"/.test(groupsSrc), '入口文案是「清单」（用户 2026-09-17 点名改的简称）');

  chk(!/key:\s*"account"/.test(groupsSrc) && !/key:\s*"about"/.test(groupsSrc),
    'GROUPS 表里只有四组（个人中心与关于不在表里 —— 它们不是「一组设置」）');

  const algoTitleAt = reciteBlock.search(/settings-group-title[^>]*>复习算法</);
  const countAt = reciteBlock.indexOf('id="seg-count"');
  chk(algoTitleAt > -1 && countAt > -1 && algoTitleAt > countAt,
    '「复习算法」这一段的标题仍在「背诵」几项之后（两段的分界不丢）');
  const printAt = listsBlock.search(/settings-group-title[^>]*>打印</);
  const colAt = listsBlock.indexOf('id="collections-list"');
  chk(printAt > -1 && colAt > -1 && printAt > colAt,
    '「打印」这一段排在自选清单之后（打的就是这份清单）');
}
chk(!!generalBlock && !!reciteBlock && !!listsBlock && !!readerBlock, '各分组自己的区块都能取到');
chk(!/id="input-username"/.test(generalBlock),
  '「通用」组不再含用户名（用户 2026-09-18：与「我的」页重复了，整块撤掉）');
chk(!/family-panel/.test(generalBlock),
  '「通用」组不再含子用户那一块（整块挪去「我的」页本机数据之上）');
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

chk(!/id="collections-section"/.test(html) && !/id="btn-collections"/.test(html),
  '首页不再有「自选背诵」折叠卡（整块搬进设置，不留两处入口）');
chk(/id="seg-helper"/.test(readerBlock), '「朗读」组含注音总开关');

chk(/id="seg-play"/.test(readerBlock), '「朗读」组有五档单选项容器');

const readerBlockVis = readerBlock.replace(/<!--[\s\S]*?-->/g, ' ');
chk(!/长按|右键/.test(readerBlockVis),
  '「朗读」组里不再教圆键手势（Issue #163：设置页不再啰嗦操作说明）');

chk(/js\/play-modes\.js/.test(SETTINGS_HTML), '设置页加载 js/play-modes.js（与阅读器同源）');
chk(/window\.PlayModes/.test(settingsJs) && /PM*\.(read|LIST|write|of)\b/.test(settingsJs),
  '设置页逻辑从 PlayModes 取档位，而不是另抄一份字面量');
chk(!/seq-origin|shuffle-trans/.test(settingsJs),
  '设置页 JS 里不再出现模式 id 字面量（避免与阅读器错开）');

chk(!/js\/reader-core\.js/.test(SETTINGS_HTML), '设置页不加载阅读器引擎（只引档位定义）');

const titleSize = (css.match(/\.settings-group-title\s*\{([\s\S]{0,600}?)\}/) || ['', ''])[1];
chk(/letter-spacing/.test(titleSize) || /letter-spacing/.test(sharedTitleRule(css)),
  '分组标题有自己的字距（与组内选项区分，不是一列裸字）');

const sharedTitle = sharedTitleRule(css);
const fsMatch = sharedTitle.match(/font-size:\s*([\d.]+)px/);
const titleFs = fsMatch ? parseFloat(fsMatch[1]) : NaN;
chk(!!fsMatch && titleFs >= 17,
  '分组标题是卡片主标题档（≥17px，与集子卷名 / 列表篇名同一档，实际 ' +
  (fsMatch ? fsMatch[1] + 'px' : '未取到') + '）');
chk(/font-weight:\s*(600|700|bold)/.test(sharedTitle),
  '分组标题用主标题的字重（与集子卷名 / 入口标题同为 700）');
chk(/color:\s*var\(--ink\)/.test(sharedTitle),
  '分组标题用正文主色 --ink（与集子卷名同一档）');

(function titleSizeIsOneValue() {
  const px = (src, prop) => {
    const m = new RegExp(prop + ':\\s*([\\d.]+)px').exec(src);
    return m ? m[1] : '';
  };
  const shared = sharedTitleRule(css);
  const sharedFs = px(shared, 'font-size');
  const sharedFw = px(shared, 'font-weight');
  chk(!!sharedFs,
    '卡片主标题那一档（字号 / 字重 / 颜色）在 css/style.css 里只有一个来源');

  const groupName = (classicCss.match(/\.group-name\s*\{([^}]*)\}/) || ['', ''])[1];
  chk(px(groupName, 'font-size') === sharedFs && px(groupName, 'font-weight') === sharedFw,
    '集子卡头卷名（.group-name）与设置页主标题逐位相同（实际 ' +
    px(groupName, 'font-size') + '/' + px(groupName, 'font-weight') + ' vs ' +
    sharedFs + '/' + sharedFw + '）');

  const itemTitleOwn = (css.match(/[^{}]*\.item-title\s*\{([^}]*)\}/g) || [])
    .filter(chunk => chunk.split('{')[0].split(',').map(x => x.trim()).join(',') === '.item-title')
    .map(chunk => chunk.slice(chunk.indexOf('{') + 1))
    .join(';')

    .replace(/\/\*[\s\S]*?\*\//g, ' ');
  chk(!!itemTitleOwn && !/font-size|font-weight|color:/.test(itemTitleOwn),
    '列表篇名那条规则不再另写字号 / 字重 / 颜色（读共用块，只留字体族与字距）');

  chk(!/\.account-entry-name\s*\{/.test(css),
    '主页账号那一行不再自带一份标题样式（读 .settings-link-title，与四组入口同档）');

  chk(px(shared.replace('font-size: 17px', 'font-size: 14px'), 'font-size') !== sharedFs,
    '这一档真的能被改坏（把共用块的 17px 改成 14px 时上面那些断言会红）');
})();

const maxFontSize = function (re) {
  let m, best = 0;
  while ((m = re.exec(css)) !== null) {
    const f = m[1].match(/font-size:\s*([\d.]+)px/);
    if (f) best = Math.max(best, parseFloat(f[1]));
  }
  return best;
};

const brandFs = maxFontSize(/\.brand-name-row\s*\{([\s\S]{0,500}?)\}/g);

const optFs = maxFontSize(/\.settings-page \.seg button,[\s\S]{0,60}?\{([\s\S]{0,500}?)\}/g);
chk(brandFs >= 17 && titleFs < brandFs,
  '分组标题（' + titleFs + 'px）小于页面顶部大标题（' + brandFs + 'px）');

chk(optFs >= 13 && titleFs > optFs,
  '分组标题（' + titleFs + 'px）大于组内选项文字（' + optFs + 'px），主次由字号 + 字重 + 颜色三档一起分');
chk(!/\.settings-group-desc/.test(css), '样式里不再保留二级描述 .settings-group-desc');
chk(!/settings-group-desc/.test(SETTINGS_HTML), '设置页 HTML 里不再有二级描述节点');

{
  const m = css.match(/\.modal-box \.reader-actions \{([\s\S]{0,500}?)\}/);
  const block = m ? m[1] : '';
  chk(/flex-wrap:\s*wrap/.test(block), '详情页工具条允许换行（窄屏不再把「全文」裁成半截）');
  chk(!/overflow-x:\s*auto/.test(block), '详情页工具条不再横向滚动（改成换行后不必两层滚动）');
  chk(/justify-content:\s*center/.test(block), '工具条整行居中，与居中的诗题 / 正文同一条中轴');
}

chk(/body\.has-audio-player \.dock \{[\s\S]{0,140}?visibility:\s*hidden/.test(css),
  '底部播放栏出现时页签彻底让路（不再「被盖住却还能聚焦」）');
chk(/body\.has-audio-player \.dock \{[\s\S]{0,160}?pointer-events:\s*none/.test(css),
  '让路时同时关掉命中测试，不会误接点击');
chk(/body\.reader-open \.dock \{ display: none; \}/.test(classicCss),
  '阅读器打开时页签同样是「让路」而不是被压住（两处口径一致）');

chk(/body\.no-dock \.app,[\s\S]{0,600}?padding-bottom:\s*calc\([\s\S]{0,200}?--safe-bottom/.test(css),
  '无页签页面（法务页）底部留出安全区，页脚不再贴屏底');

for (const f of ['css/style.css', 'css/classic.css', 'css/legal.css']) {
  const src = read(f);
  let depth = 0, stray = false;
  for (let i = 0; i < src.length - 1; i++) {
    if (src[i] === '/' && src[i + 1] === '*') { depth++; i++; }
    else if (src[i] === '*' && src[i + 1] === '/') {
      if (depth === 0) { stray = true; break; }
      depth--; i++;
    }
  }
  chk(!stray && depth === 0,
    f + ' 的注释块闭合（多一个注释闭合符会把它后面那条规则静默吃掉）');
}

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

chk(/--radius-sm:\s*12px/.test(css), '定义卡内小件圆角变量 --radius-sm');
chk(!/border-radius:\s*10px/.test(css) && !/border-radius:\s*10px/.test(classicCss) &&
  !/border-radius:\s*10px/.test(read('css/legal.css')),
  '三张样式表里不再散落 10px 的圆角硬编码（统一走 --radius-sm）');

chk(/\.topbar \{[\s\S]{0,1400}?max-width:\s*var\(--content-w/.test(css),
  '顶栏宽度与内容区同源（--content-w，大屏不与正文错位）');

chk(/\.topbar \{[\s\S]{0,1400}?width:\s*100%/.test(css),
  '顶栏有 width: 100%（只写 max-width 时它会收缩到内容宽，桌面那一档挤成一小截）');

chk(!/\.reader-body \{[\s\S]{0,600}?width:\s*100%/.test(classicCss),
  '阅读器正文不再写 width: 100%（那会让内边距溢出视口、正文贴左边缘被切）');
chk(/\.reader-body \{[\s\S]{0,1200}?box-sizing:\s*border-box/.test(classicCss),
  '阅读器正文显式 border-box，内边距算在 720px 之内');

chk(/\.reader-body \{[\s\S]{0,1200}?width:\s*min\(var\(--content-w/.test(classicCss),
  '阅读器正文用定宽 --content-w，并收回 --read-w 的阅读上限（flex 子项上的 max-width 会退化成 flex-basis）');
chk(/\.reader-body \{[\s\S]{0,1200}?max-width:\s*calc\(100%/.test(classicCss),
  '窄屏由 max-width: calc(100% - 安全区) 收成满宽，宽屏稳定居中');
chk(/\.reader-body \{[\s\S]{0,400}?min-height:\s*0/.test(classicCss),
  '阅读器正文 min-height: 0，否则 flex 项被内容撑开、滚动条永远不出现');

chk(parseInt((read('sw.js').match(/poem-app-v(\d+)/) || [0, '0'])[1], 10) >= 23,
  'Service Worker 缓存版本已升到 v23（本轮改了 css/js/html，不升版本老用户看到的是旧样式）');

chk(/if \(action\) \{[\s\S]{0,700}?GLYPHS\.back/.test(read('js/chrome.js')),
  '顶栏动作位统一用返回箭头（阅读器不再单独长出一个 ✕）');
chk(!/glyph\("close"\)/.test(read('js/classic.js')),
  '小古文页不再要求把动作位换成 ✕（形状交给 chrome.js 统一给）');

chk(/--nav-h:\s*0px/.test(css), '定义了底部导航栏高度变量 --nav-h');

const settingsPad = (css.match(/\.settings-page \{[^}]*?padding-bottom:\s*([^;]+);/) || [,''])[1];
chk(/var\(--nav-h\)/.test(settingsPad) && !/var\(--nav-h\)\s*-/.test(settingsPad),
  '设置页留出导航栏高度，最后一行不会被压住（--nav-h 只加不减）');

chk(!/padding-bottom:\s*calc\(150px/.test(css) && !/padding-bottom:\s*calc\(196px/.test(css),
  '页面留白不再写死 px（150px / 196px 这类硬编码已删除）');
chk(/\.dock \{[\s\S]*?position:\s*fixed[\s\S]*?bottom:\s*0/.test(css), '底部页签是贴底固定导航栏');

const dockPad = (css.match(/body:not\(\.no-dock\) \.app[^{]*\{[^}]*?padding-bottom:\s*([^;]+);/) || [,''])[1];
chk(/var\(--nav-h\)/.test(dockPad) && !/var\(--nav-h\)\s*-/.test(dockPad),
  '有底部页签时，页面留白按实测导航栏高度计算（--nav-h 只加不减）');

chk(!/\.foot|\.settings-foot|--foot-gap-v2/.test(css),
  '页脚删了，样式表里不再留 .foot / .settings-foot / --foot-gap-v2 的孤儿规则');
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

chk(/data-nav-go/.test(read('js/chrome.js')) && /\/settings\//.test(read('js/chrome.js')),
  '设置页可经底部页签回到古诗词 / 小古文');

{
  const subPages = ['classic/index.html', 'settings/index.html', 'terms/index.html', 'privacy/index.html'];
  subPages.forEach(f => {
    const src = read(f);
    const rel = (src.match(/(?:src|href)="(\.\.?\/[^"]*)"/g) || [])
      .filter(x => !/^href="\.\/#/.test(x));

    const hasBase = /<base href="\/"\s*\/>/.test(src);
    chk(hasBase || rel.length === 0,
      f + ' 资源引用不会因目录化而 404（绝对路径或 <base href="/">，实际 ' + rel.join(', ') + '）');
  });

  chk(/navigator\.serviceWorker\.register\("\/sw\.js"\)/.test(read('js/pwa.js')),
    'Service Worker 从站点根注册（/sw.js），子目录页面同样能注册');
  chk(!/register\("\.\/sw\.js"\)/.test(read('js/pwa.js')),
    '不再用相对的 ./sw.js 注册（目录化后会解析成 /settings/sw.js 而 404）');

  {
    const { execFileSync } = require('child_process');
    let swOk = true;
    try { execFileSync(process.execPath, ['--check', __dirname + '/../sw.js'], { stdio: 'pipe' }); }
    catch (e) { swOk = false; }
    chk(swOk, 'sw.js 能通过语法检查（注释块闭合、没有游离的 */ —— 否则 SW 从不注册）');
  }

  {
    const swSrc = read('sw.js');
    const lines = swSrc.split('\n');

    const commented = lines.map((l, i) => [i + 1, l]).filter(([, l]) => {
      const t = l.trim();
      return t.indexOf('//') === 0 || t.indexOf('/*') === 0 ||
             l.indexOf('//') !== -1 || l.indexOf('/*') !== -1 || l.indexOf('*/') !== -1;
    });
    chk(commented.length === 0,
      'sw.js 不含任何注释（用户要求：去除所有注释并禁止再加；' +
      (commented.length ? '实际第 ' + commented.map(c => c[0]).join('、') + ' 行有注释' : '') + '）');
  }

  const swVer = parseInt((sw.match(/poem-app-v(\d+)/) || [0, '0'])[1], 10) || 0;
  chk(swVer >= 21, 'Service Worker 缓存版本已提升（≥v21，实际 v' + swVer + '），老缓存会被清掉');

  chk(/const CACHE_NAME = "poem-app-v\d+";/.test(sw), 'CACHE_NAME 是带版本号的常量');

  const readme = read('README.md');
  chk(/缓存优先/.test(readme) && /升|提升|更新/.test(readme),
    'README.md 里写明「静态资源缓存优先、改动需升级版本」的约定');
  chk(sw.indexOf('缓存优先') === -1,
    'sw.js 里不出现注释形式的约定（注释已全部清空）');

  chk(!fs.existsSync(__dirname + '/../SW-NOTE.md') &&
      !fs.existsSync(__dirname + '/../sw-notes.md') &&
      !fs.existsSync(__dirname + '/../docs/sw-history.md'),
    'SW-NOTE.md / sw-notes.md 已删除（用户要求：删除并禁止再加）');

  chk(!/Issue\s*#\d+/.test(readme) && !/#\d+\s*(后续|第一条|第二条|第三条)/.test(readme),
    'README.md 不再是 changelog（不含 Issue 编号 / 逐条沿革）');

  ['css/style.css', 'css/classic.css', 'css/legal.css'].forEach(function (f) {
    chk(sw.indexOf('./' + f) !== -1, 'PRECACHE 含 ' + f);
  });
  ['js/app.js', 'js/chrome.js', 'js/settings.js', 'js/classic.js'].forEach(function (f) {
    chk(sw.indexOf('./' + f) !== -1, 'PRECACHE 含 ' + f);
  });
}
chk(/invalidatePlan/.test(settingsJs), '设置页改配置后会让首页的今日计划缓存失效');

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

chk(!/\.seg button\.active \{[\s\S]{0,120}?background:\s*var\(--green\)/.test(css),
  '全局 .seg 选中态未被改掉（阅读器 .seg.mini 仍是原样）');

let subsetChecked = false;
try {
  const { execFileSync } = require('child_process');
  execFileSync('python3', ['-c', 'import fontTools'], { stdio: 'ignore' });
  const fontsDir = path + 'fonts/';

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

{

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
