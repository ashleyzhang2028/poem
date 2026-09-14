/**
 * 全站 UI 一致性 / 响应式守卫（Issue #122）
 * ==========================================================================
 * 用户原话：
 *   「对所有页面的 UI 组件等等进行审核，确保一致性和没有任何界面问题，
 *     大小不一致，行为不统一等等尽量避免。
 *     目前主要是手机端，请同样考虑平板和桌面端的响应式布局及显示问题的修复。」
 *
 * 这一层守着三类事（每一类都是「不靠肉眼看截图」能判的）：
 *
 *   一、同一套组件在不同页面上**长得一样**
 *       —— 圆角 / 内边距 / 字号 / 尺寸都只有一个来源（变量或同一条规则），
 *          某一页单独写死一个数值，就是下一次「两页并排看着不一样」的种子。
 *
 *   二、「画出来的尺寸」必须等于声明的尺寸
 *       —— box-sizing 与边框的关系最容易算错（content-box 下边框是另加的）。
 *          今日条那颗播放键就栽在这里：CSS 写 40px、真机画出来 42px，
 *          与旁边 40px 的进度环并排差 2px。这里按**算式**判，
 *          而不是按「某个数值等于 40」判 —— 换尺寸时算式仍成立。
 *
 *   三、宽屏（平板 / 桌面）不许把组件拉变形
 *       —— 页签四格、入口页卡片、设置页选项、进度日历这几处，
 *          窄屏是竖排 / 横滑，宽屏必须换一种排布（均分 / 两列 / 一屏放全）。
 *          守着「宽屏那一档的媒体查询真的存在」，而不是守具体像素。
 *
 * 运行：node test/ui-consistency.test.js
 */
const fs = require('fs');
const path = __dirname + '/../';
const read = f => fs.readFileSync(path + f, 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const css = read('css/style.css');
const classicCss = read('css/classic.css');
const legalCss = read('css/legal.css');
const chromeJs = read('js/chrome.js');

/** 注释一律先剥掉：注释里会写历史数值（「40 + 12 = 52px」），
    不剥掉就会对着自己的说明判红，也会把注释里的 `{` `}` 当成规则边界。
    ⚠️ 下面所有断言一律对着 `*Code`（已剥注释）版本，
      不要再拿原始源码去跑正则 —— 那样注释里的括号会把规则切歪。 */
const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ');
const cssCode = strip(css);
const classicCode = strip(classicCss);
const legalCode = strip(legalCss);

/**
 * 取某个选择器**累积**的声明（同名规则后写的覆盖先写的，与浏览器一致）。
 *
 * ⚠️ 不能只取「最后一条匹配」：同一个选择器常写在好几处
 *   （`.app` 的 max-width 在文件中部、padding 在 PWA 一节），
 *   只取最后一条会漏掉前一条里真正想查的声明。
 * ⚠️ 选择器要**整条**相等才算命中，不能用「包含」：
 *   `.app` 与 `.app, #app` 是两条不同的选择器组，
 *   而 `#app` 那条里也有 max-width —— 用包含匹配就会张冠李戴。
 * 做法：先把 @media 外壳剥掉、把里面的规则提到顶层（只关心「某档是否存在这条声明」），
 * 再按顺序把「选择器组里恰好含这一条」的规则块累加。
 */
function ruleOf(src, sel) {
  const flat = src.replace(/@media[^{]+\{/g, '{');
  let acc = '';
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(flat))) {
    const sels = m[1].split(',').map(x => x.trim());
    if (sels.includes(sel)) acc += ';' + m[2];
  }
  return acc;
}

/* ==========================================================================
   一、同一套组件在六个集子页 + 搜索页上共用同一条声明
   ========================================================================== */

/* 六个集子索引页（poems / classic / tangshi / songci / guwen / zhaoming）
   与搜索页共用同一份引擎 js/reader-core.js、同一张样式表 css/classic.css。
   所以「同一枚控件各页尺寸一致」不需要逐页断言 —— 只要它不是靠
   页面级选择器（body[data-nav=...]）各写一份数值就行。
   搜索页那一排（.search-hero 里的 52px 大框）是**有意**不同的唯一例外，
   它由 body[data-nav="search"] 明确接管，独立成档。 */
const itemRead = ruleOf(classicCode, '.item-read');
chk(!/body\[data-nav/.test(itemRead),
  '列表播放键 .item-read 不按页面分叉（六部集子共用同一条声明）');

/* 列表条目右侧那两枚圆键（「加入背诵」书签 · 播放）必须一样大
   --------------------------------------------------------------------------
   用户原话：「将各个索引页卡片中的播放按钮调整得和添加到自定义背诵按钮一样大小」。
   原先两枚键**各写一套尺寸**：.item-read 36px（css/style.css）、
   .item-recite 30px（css/classic.css），并排量出来一大一小。

   现在两枚键都读全站唯一那颗 `--item-btn`，且**不许**再写死 width / height ——
   写死的那一刻，这条「一样大」就靠两处数值巧合维持着了。
   ⚠️ 判的是「两个选择器是否读同一个变量」，不是「两个数值是否都等于 36px」：
      后者在换尺寸的那天仍会一起变，前者才是这一轮真正的意图。 */
chk(/--item-btn:\s*36px/.test(ruleOf(cssCode, ':root')),
  '圆键直径 --item-btn: 36px 在 :root 里定义（全站唯一来源）');
const readRule = ruleOf(cssCode, '.item-read');
const reciteRule = ruleOf(classicCode, '.item-recite');
chk(/width:\s*var\(--item-btn\)/.test(readRule) && /height:\s*var\(--item-btn\)/.test(readRule),
  '播放键 .item-read 的宽高读 --item-btn（不再写死 36px）');
chk(/width:\s*var\(--item-btn\)/.test(reciteRule) && /height:\s*var\(--item-btn\)/.test(reciteRule),
  '「加入背诵」键 .item-recite 的宽高读同一个 --item-btn（与播放键同大）');
chk(!/width:\s*\d+px/.test(readRule) && !/width:\s*\d+px/.test(reciteRule),
  '两枚圆键都不再写死直径（写死就退回「两处数值各自巧合相等」）');
/* 图标框与直径是**一对**（三角的 1px 描边就靠这个配对，见 css/classic.css 顶部），
   两枚圆键读同一个 --item-icon。
   ⚠️ 不写成「直径 − 6px」：那不是这条比例的含义 —— 三角的 1px 由
      「图标框 16px ↔ viewBox 里的 stroke 1.5」算出来（1.5 ÷ 24 × 16 = 1px），
      跟直径差几像素没有关系。 */
const readSvg = ruleOf(cssCode, '.item-read svg');
const reciteSvg = ruleOf(classicCode, '.item-recite svg');
chk(/--item-icon:\s*16px/.test(ruleOf(cssCode, ':root')),
  '圆键图标框 --item-icon: 16px 在 :root 里定义（全站唯一来源）');
chk(/width:\s*var\(--item-icon\)/.test(readSvg) && /width:\s*var\(--item-icon\)/.test(reciteSvg),
  '两枚圆键的图标框都读同一个 --item-icon（与直径成对，不各写一个数）');
chk(!/width:\s*15px/.test(reciteSvg) && !/width:\s*16px/.test(readSvg),
  '两枚圆键的图标框都不再写死 px（写死就与直径脱钩）');

/* 序号圆与条目标题同高：两处都读 --item-num，不同源就会「圆比字大一圈」 */
const numRule = ruleOf(cssCode, '.item-num');
chk(/--item-num:\s*16\.5px/.test(numRule),
  '序号圆直径走 --item-num（与条目标题 16.5px 同源，不是各写一个数）');
const titleRule = ruleOf(cssCode, '.item-title');
chk(/font-size:\s*16\.5px/.test(titleRule),
  '条目标题 16.5px 与序号圆同一档');

/* 余下的圆键档（26 / 30px）—— 每一档都写在**同一个文件**里，
   不允许某一页给同名控件另开一个尺寸。
   （列表条目那两枚键已不再是「写死的档位」：它们读 --item-btn，见上。） */
["30px", "26px"].forEach(sz => {
  chk(new RegExp('width:\\s*' + sz).test(cssCode) || new RegExp('width:\\s*' + sz).test(classicCode),
    '圆键的 ' + sz + ' 这一档由样式表统一定义（各页不另写尺寸）');
});

/* 卡片圆角：全站只走 --radius / --radius-sm / --radius-md 三个变量，
   不许某一页写死一个 px（写死的那一页日后换主题就跟不上） */
const cardRule = ruleOf(cssCode, '.card');
chk(/border-radius:\s*var\(--radius\)/.test(cardRule),
  '.card 圆角走 --radius 变量（不写死 px）');
const libCardRule = ruleOf(classicCode, '.library-card');
chk(/border-radius:\s*var\(--radius-md\)/.test(libCardRule),
  '入口页卡片圆角走 --radius-md（与译文框同一档，同是「卡片与卡片之间」的中间档）');

/* 法务页的 .legal 与全站 .card 同为「一张纸」：圆角、阴影都该同源 */
const legalRule = ruleOf(legalCode, '.legal');
chk(/border-radius:\s*var\(--radius\)/.test(legalRule) && /box-shadow:\s*var\(--shadow\)/.test(legalRule),
  '法务页正文那张纸与全站 .card 同圆角同阴影（不另起一套）');

/* ==========================================================================
   二、「画出来的尺寸」必须等于声明的尺寸
   ========================================================================== */

/* 今日条那颗播放键：box-sizing: content-box 下，
   **画出来的圆外缘 = 内容区 + 两侧边框**。所以 width 必须是
   `calc(var(--today-btn-size) - var(--today-btn-ring) * 2)`。
   只写 `var(--today-btn-size)` 会画出 42px（40 + 1 + 1），
   与右边 40px 的进度环差 2px —— 用户连着报了几轮「一大一小」。
   ⚠️ 这里判的是**算式**而不是数值：换成 44px 也照样成立。 */
const todayRead = ruleOf(cssCode, '.today-read');
const sizeExpr = 'calc\\(\\s*var\\(--today-btn-size\\)\\s*-\\s*var\\(--today-btn-ring\\)\\s*\\*\\s*2\\s*\\)';
chk(new RegExp('width:\\s*' + sizeExpr).test(todayRead),
  '今日条播放键的 width 扣掉两侧边框（content-box 下边框是另加的，不扣就画大一圈）');
chk(new RegExp('height:\\s*' + sizeExpr).test(todayRead),
  '今日条播放键的 height 同样扣掉两侧边框（宽高同源，圆才是圆）');
chk(/box-sizing:\s*content-box/.test(todayRead),
  '播放键仍是 content-box（那圈 1px 边框往外长，不把圆吃小）');
chk(/padding:\s*0/.test(todayRead),
  '播放键显式 padding: 0 —— <button> 的 UA 默认 1px 6px 会把它撑宽 12px');

/* 进度环那一枚：svg overflow: hidden 会把骑在边界的描边裁进盒内，
   所以盒子的 --today-btn-size 就是画出来的最大直径，不能做任何补偿 */
const ringRule = ruleOf(cssCode, '.ring');
chk(/width:\s*var\(--today-btn-size/.test(ringRule) &&
  /height:\s*var\(--today-btn-size/.test(ringRule),
  '进度环最大外径就是 --today-btn-size（描边被 svg 裁进盒内，不做补偿）');
chk(/min-height:\s*0/.test(ringRule),
  '进度环 min-height 归零 —— 否则 flex 行会把它纵向撑高、圆变椭圆');

/* 三角播放键：图标框与描边值是一对比例（描边写在 24 的 viewBox 里会一起缩放），
   「屏幕上量到 1px」靠的是两者配对。这里只锁「各档的图标框都在样式表里有出处」。 */
["17px", "16px", "15px", "12px"].forEach(sz => {
  const hit = new RegExp('width:\\s*' + sz).test(cssCode) || new RegExp('width:\\s*' + sz).test(classicCode);
  chk(hit, '播放键图标框的 ' + sz + ' 这一档有出处（换算表在 css/classic.css 顶部）');
});

/* ==========================================================================
   三、宽屏（平板 / 桌面）不许把组件拉变形
   ========================================================================== */

/* 页签：外层整宽（底纹 / 描金线 / 安全区），内层限宽居中（四格不被拉成巨板）。
   1920px 屏上不限定内层，每格会宽到 477px，一颗 22px 图标孤零零挂在正中。 */
/* 列宽走**一个令牌** --col-w：顶栏 / 页签内层 / 正文列都读它。
   令牌本身在 :root 里定义一次（手机 720px），平板那一档覆写成更宽的一档（见下）。 */
chk(/:root\s*\{[^}]*--col-w:\s*720px/s.test(cssCode),
  '「一列纸」的宽度只有 --col-w 一个来源（手机档 720px）');
chk(/\.dock-inner\s*\{[^}]*max-width:\s*var\(--col-w/s.test(cssCode),
  '页签内层读 --col-w（与内容区同源，四格不会被拉成巨板）');
chk(/\.dock-inner\s*\{[^}]*margin:\s*0 auto/s.test(cssCode),
  '页签内层居中（与内容区共用一条竖轴）');
chk(/\.dock-inner\s*\{[^}]*width:\s*100%/s.test(cssCode),
  '页签内层占满外层宽度（窄屏上仍是整宽四格）');
/* 外层必须保持整宽：给 .dock 自己写 max-width 会把固定定位的底线一起收掉，
   屏幕左右两侧露出「没有页签」的空白 */
const dockRule = ruleOf(cssCode, '.dock');
chk(!/max-width/.test(dockRule),
  '页签外层不写 max-width（写了会连底线一起收掉，两侧露白）');
/* 底部安全区必须留在外层：iPhone 横条按屏幕底边算，与内层多宽无关 */
chk(/--safe-bottom/.test(dockRule),
  '底部安全区留在页签外层（按屏幕底边算，不随内层宽度走）');
/* 结构上真的套了两层：JS 渲染时就要带 .dock-inner，只写 CSS 是空规则 */
chk(/class="dock"[\s\S]{0,80}dock-inner/.test(chromeJs),
  'js/chrome.js 渲染页签时带了 .dock-inner 这一层（不是只写了一条 CSS）');

/* 入口页六张卡：窄屏竖排、宽屏两列 */
chk(/@media \(min-width:\s*560px\)[\s\S]{0,400}\.library-grid\s*\{[^}]*flex-direction:\s*row/s.test(classicCode),
  '入口页卡片在 ≥560px 排成两列（竖排的六条长横条在宽屏上太空）');
chk(/\.library-card\s*\{[^}]*max-width:\s*calc\(50% - 6px\)/s.test(classicCode),
  '入口页卡片在宽屏收住宽度（奇数张时最后一张不撑满一行）');

/* 设置页两栏选项：连读方式五档、复习算法四张卡 */
chk(/@media \(min-width:\s*560px\)[\s\S]{0,400}#seg-play\s*\{[^}]*flex-direction:\s*row/s.test(cssCode),
  '设置页「连读方式」在 ≥560px 排成两列（一行一档时右边半张卡全是空白）');
chk(/@media \(min-width:\s*560px\)[\s\S]{0,400}#seg-algo\s*\{[^}]*flex-direction:\s*row/s.test(cssCode),
  '设置页「复习算法」在 ≥560px 排成两列（与连读方式同一套排布）');
chk(/#seg-play \.play-mode-opt\s*\{[^}]*max-width:\s*calc\(50% - 4px\)/s.test(cssCode),
  '连读方式的奇数张不撑满一行（与上排同宽、左对齐）');
chk(/#seg-algo \.algo-opt\s*\{[^}]*max-width:\s*calc\(50% - 4px\)/s.test(cssCode),
  '复习算法的奇数张不撑满一行');

/* 进度日历：手机 14 格横滑，宽屏一屏放全 */
chk(/@media \(min-width:\s*700px\)[\s\S]{0,400}\.cal\s*\{[^}]*overflow-x:\s*visible/s.test(classicCode),
  '进度日历在 ≥700px 不再横滑（14 格 × 34px 只有 476px，692px 的列宽放得下）');
chk(/\.cal-cell\s*\{[^}]*flex:\s*1 1 0/s.test(classicCode),
  '宽屏下日历格子均分列宽（不再定宽 34px、右边留一大片空白）');
chk(/\.cal-cell\s*\{[^}]*max-width:\s*64px/s.test(classicCode),
  '日历格子有宽度上限（均分后每格 80 多像素又变成另一头的「空格子」）');

/* 内容列宽：全站只有一个 720px 来源。
   顶栏、阅读器正文列、页签内层都是它 —— 三处必须同值，
   否则「内容与顶栏对不齐」这类错位会一处一处冒出来。 */
const appRule = ruleOf(cssCode, '.app');
chk(/max-width:\s*var\(--col-w/.test(appRule), '内容区列宽走 --col-w');
chk(/max-width:\s*var\(--col-w/.test(ruleOf(cssCode, '.topbar')),
  '顶栏列宽与内容区同源（--col-w）');
chk(/width:\s*var\(--col-w/.test(ruleOf(classicCode, '.reader-body')),
  '阅读器正文列宽与内容区同源（--col-w）');
chk(/max-width:\s*var\(--col-w/.test(ruleOf(cssCode, '.dock-inner')),
  '页签内层与内容区同源（--col-w）');
/* 令牌只能有**两档**：手机 720px、平板一档。写死第三处 720px 就是下次走散的种子。 */
chk(!/max-width:\s*720px/.test(cssCode) || /max-width:\s*720px/.test(ruleOf(cssCode, '.cal')),
  '样式表里不再有第二处写死的 max-width: 720px（一律走 --col-w）');

/* ==========================================================================
   四、平板（≥768px）—— 不是把手机布局拉宽，而是换一种排布
   --------------------------------------------------------------------------
   用户原话（Issue #122 后续）：
     「不仅仅是简单的修复，我们更应该考虑的是平板里桌面环境的排版设计，
       需要以他们的屏幕大小进行重新设计，而不是完全照搬手机布局。」

   判据不是「某个像素等于多少」，而是**平板那一档有没有换排布**：
     · 列宽从 720px 变宽（多出来的每一寸都有人用）；
     · 长列表 / 卡片组 / 设置分组 / 进度卡在这些宽度上**排成两列**；
     · 正文列反而**收窄**（行宽不跟着屏幕走）。
   守着「这一档的媒体查询真的存在、且换的是排布而不是数值」。
   ========================================================================== */

/* 列宽令牌：手机 720px、平板一档更宽 —— 只有两档，不跟视口线性放大 */
const tabletRoot = /@media \(min-width:\s*768px\)\s*\{[^@]*:root\s*\{[^}]*--col-w:\s*(\d+)px/s.exec(cssCode);
chk(!!tabletRoot, '平板（≥768px）那一档把 --col-w 放宽了一档（不是把手机那一列拉宽）');
if (tabletRoot) {
  const w = Number(tabletRoot[1]);
  chk(w > 720 && w <= 1200,
    '平板列宽 ' + w + 'px 落在「比手机宽、又不到桌面无限」这一档内');
}

/* 篇目列表：手机一列、平板两列 */
chk(/@media \(min-width:\s*768px\)[\s\S]{0,400}\.list\s*\{[^}]*flex-direction:\s*row/s.test(cssCode),
  '篇目列表在 ≥768px 排成两列（1040px 里一行只放一篇，右边的空白比字还宽）');
chk(/\.list\s*>\s*\.item\s*\{[^}]*max-width:\s*calc\(50%/s.test(cssCode),
  '两列的条目收住宽度（flex-basis 百分比不减掉半个列距就溢出）');

/* 入口页：≥560px 两列，平板三列 */
chk(/@media \(min-width:\s*768px\)[\s\S]{0,400}\.library-card\s*\{[^}]*33\.333%/s.test(classicCode),
  '入口页六张卡在 ≥768px 排成三列（两列时每张 514px，空白比内容宽）');

/* 集子目录页：卡内篇目清单两列。
   ⚠️ 这里守着两件事，都是**踩过的坑**，不是审美：
     ① 条目是 .group-card 的**直接子元素**（引擎 appendChild 到卡上，
        卡里没有 .list 这一层）—— 所以两列必须落在这条关系上，
        选择器要写 `>`。写成 `.group-card .list` 既命不中任何一篇
        （卡里没有 .list），又会把 .group-card .list 当成容器去排 ——
        真机上量到过后果：卡被排成横向、卡内条目被压成 102px 一条、
        卡片高度从 1752px 炸到 2511px。
     ② 卡自己要先成为 flex 行容器，否则给条目的 flex-basis 不生效。 */
chk(/@media \(min-width:\s*768px\)[\s\S]{0,600}\.group-card\s*>\s*\.item\s*\{[^}]*max-width:\s*calc\(50%/s.test(classicCode),
  '集子目录页的篇目在 ≥768px 排成两列（选择器落在「卡 → 条目」这条真实关系上）');
chk(/@media \(min-width:\s*768px\)[\s\S]{0,600}\.group-card\s*\{[^}]*flex-wrap:\s*wrap/s.test(classicCode),
  '卡片自己在 ≥768px 变成 flex 行容器（否则条目的 flex-basis 无从生效）');
chk(!/^\.group-card \.list/sm.test(classicCode),
  '没有把「卡内的 .list」当容器（卡里没有这一层，写了就是空规则 + 排错对象）');
chk(/\.group-card\s*>\s*\.group-head\s*\{[^}]*flex:\s*1 1 100%/s.test(classicCode),
  '卡头在两列排布里独占整行（卷名 / 篇数 / 连读圆键不该被挤进半栏）');

/* 设置页：分组之间排两列；跨列的那一项自己占满一行 */
chk(/@media \(min-width:\s*768px\)[\s\S]{0,400}\.settings-groups\s*\{[^}]*flex-wrap:\s*wrap/s.test(cssCode),
  '设置页的分组在 ≥768px 排成两列（纵向堆五组，每组只用掉一行的宽度）');
chk(/\.settings-group\s*\{[^}]*max-width:\s*calc\(50% - 18px\)/s.test(cssCode),
  '设置分组收住半栏宽度（flex 不减半列距就溢出）');
chk(/\.settings-item\.wide\s*\{[^}]*max-width:\s*100%/s.test(cssCode),
  '「我的清单」那一项跨列（清单面板与两排按钮挤在半栏里会折行）');

/* 进度页：四张卡排两列，概览那张整行 */
chk(/@media \(min-width:\s*768px\)[\s\S]{0,400}\.progress-main\s*\{[^}]*flex-wrap:\s*wrap/s.test(classicCode),
  '进度页四张卡在 ≥768px 排成两列');
chk(/\.progress-card\.wide\s*\{[^}]*max-width:\s*100%/s.test(classicCode),
  '进度概览那一块占满整行（它只有一行数字，挤在半栏里更难读）');

/* 阅读器：栏变宽了，**正文反而收窄** —— 行宽 35~40 字是阅读上限 */
chk(/@media \(min-width:\s*768px\)[\s\S]{0,400}\.reader-text\s*\{[^}]*max-width:\s*720px/s.test(classicCode),
  '阅读器正文列在 ≥768px 封顶 720px（栏宽了，一行字数不跟着涨）');

/* 页内工具栏与搜索区：宽栏里封顶居中，不被拉成一整条横带 */
chk(/@media \(min-width:\s*768px\)[\s\S]{0,400}\.toolbar:not\(\.search-toolbar\)\s*\{[^}]*max-width:\s*720px/s.test(classicCode),
  '集子页工具栏在 ≥768px 封顶居中（搜索框一个人吃掉 900px，右边两枚隔着半屏）');
chk(/@media \(min-width:\s*768px\)[\s\S]{0,400}\.search-hero\s*\{[^}]*max-width:\s*520px/s.test(classicCode),
  '搜索页 hero 在 ≥768px 封顶 520px（竖屏高度按视口算，横着拉满就成一条横带）');

/* 进度日历与进度条：均分上限只在手机那一档成立，平板要收回来 */
chk(/@media \(min-width:\s*768px\)[\s\S]{0,400}\.cal,[\s\S]{0,80}max-width:\s*720px/s.test(classicCode),
  '进度日历在 ≥768px 收回 720px（14 格均分 1040px 会把格子拉成 64px 的宽方块）');
chk(/@media \(min-width:\s*768px\)[\s\S]{0,600}\.bars\s*\{[^}]*max-width:\s*720px/s.test(classicCode),
  '掌握度进度条在 ≥768px 收回 720px（轨道 900px 长时，走两成也像快满了）');

/* 结构：两列排布要靠 HTML 里的容器才生效，只写 CSS 是空规则 */
chk(/class="settings-groups"/.test(read('settings/index.html')),
  '设置页真的套了 .settings-groups（不是只写了一条 CSS）');
chk(/class="settings-item wide"/.test(read('settings/index.html')),
  '「我的清单」那一项真的带了 .wide');
chk(/class="progress-main"/.test(read('progress/index.html')),
  '进度页真的套了 .progress-main');
chk(/class="card progress-card wide"/.test(read('progress/index.html')),
  '进度概览那张卡真的带了 .wide');
chk(/class="today-list"/.test(read('index.html')),
  '首页今日列表套了容器（两列只作用在 .list 的直接子元素上）');

/* iOS 横屏「按宽度放大文字」的默认行为要关掉，否则同一段说明
   在竖屏 / 横屏下字号不同（这与台式机的响应式不是一件事） */
chk(/-webkit-text-size-adjust:\s*100%/.test(cssCode),
  '关掉了 iOS 的横屏文字自动放大（字号只由样式表决定）');

/* ==========================================================================
   五、各页顶栏结构一致（同一套 chrome 渲染）
   ========================================================================== */

const pages = ['index.html', 'poems/index.html', 'library/index.html', 'classic/index.html',
  'tangshi/index.html', 'songci/index.html', 'guwen/index.html', 'zhaoming/index.html',
  'search/index.html', 'settings/index.html', 'progress/index.html',
  'terms/index.html', 'privacy/index.html'];
pages.forEach(f => {
  const html = read(f);
  chk(/<header class="topbar/.test(html) || /class="topbar[^"]*"/.test(html),
    f + ' 有顶栏挂载点（由 js/chrome.js 统一渲染，不自造一套）');
  chk(/<script src="[^"]*js\/chrome\.js"><\/script>/.test(html),
    f + ' 加载了 js/chrome.js（顶栏 + 页签的唯一来源）');
  chk(/data-nav="/.test(html), f + ' body 上标了 data-nav（页签选中态按它定）');
});

/* 页签四格的图标与文字：全站一套，不按页分叉 */
chk(/DOCK_ITEMS\s*=\s*\[[\s\S]*?背诵[\s\S]*?课外[\s\S]*?搜索[\s\S]*?设置/.test(chromeJs),
  '页签四格（背诵 / 课外 / 搜索 / 设置）只在 js/chrome.js 定义一次');

console.log(fails === 0 ? '\n🎉 UI 一致性 / 响应式守卫全部通过' : '\n❌ ' + fails + ' 项失败');
process.exit(fails ? 1 : 0);
