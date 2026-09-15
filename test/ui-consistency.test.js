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
// ⚠️ jsdom 只用于下面「真实渲染几何」那一段（按需加载、失败即跳过）。
//    本层其余断言都是纯正则 + 文件读取，没有 jsdom 也必须能跑完。
let JSDOM = null;
try { JSDOM = require('jsdom').JSDOM; } catch (e) { JSDOM = null; }
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
/** 剥 HTML 注释：注释里会写「这条结构不许写死」的说明 */
const stripHtml = t => t.replace(/<!--[\s\S]*?-->/g, ' ');
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

/* 课外阅读入口页的两层结构（Issue #147）
   --------------------------------------------------------------------------
   用户原话：「在课外阅读页面内，除了课内诗词索引页的卡片宽度没问题之外，
   其他例如唐诗三百首以及其他卡片宽度都莫名奇妙和上面的搜索框行一起
   左右变窄了，我希望都像课内诗词那样。」

   病根在 DOM 而不是在宽度数值上：入口页是**同一页里的两层**（集子目录 +
   就地铺上来的某一部的索引），而第二层原先套的是 <div class="app" ...> ——
   .app 正是全站「一列纸」的宽度来源（max-width: --col-w + 左右各一条
   --col-side 的边）。它套在**外层那个 .app 里面**，于是这一层把列宽与
   两侧的边各算了两遍：里面那张卷次卡与搜索框落在又缩进一条边的位置上
   （手机 14+14=28px、桌面 56+56=112px），而页顶那条顶栏仍在外层的宽度上 ——
   两者左右各差一条边，看着就是「卡片和上面的搜索框行一起变窄了」。

   守着两件事，一在 HTML、一在 CSS：
     · 第二层不再套 .app（宽度只有一个来源）；
     · 第二层的左右内边距一并归 0，且 **> .** 只落到它自己的直接子元素上
       （后代选择器会把卷次卡内部那些自带 padding 的元素一起归零，
        卡片里就再也排不出两列 / 三列）。 */
// ⚠️ 先剥掉 HTML 注释：上面那段说明里就写着老写法
//    （`<div class="app" data-lib-view="book">`）作为反面参照，
//    不剥就会把注释当成真的 DOM，断言反过来判红。
const libHtml43 = read('library/index.html').replace(/<!--[\s\S]*?-->/g, ' ');
chk(/<div data-lib-view="book" hidden>/.test(libHtml43) &&
  !/<div class="app"[^>]*data-lib-view="book"/.test(libHtml43),
  '入口页第二层不再套 .app（列宽与两侧的边只有一个来源，不再被算两遍）');
chk((libHtml43.match(/class="app"/g) || []).length === 1,
  '入口页全页只有一个 .app（第二层住在它里面，宽度由它给）');
chk(/\[data-lib-view="book"\]\s*\{[^}]*padding-left:\s*0/s.test(classicCode) &&
  /\[data-lib-view="book"\]\s*\{[^}]*padding-right:\s*0/s.test(classicCode),
  '入口页第二层的左右内边距归 0（这条是防御：它多一条边就立刻重演 #147）');
chk(/\[data-lib-view="book"\]\s*>\s*\.toolbar/.test(classicCode),
  '第二层的内边距清理只落在**直接子元素**上（后代选择器会把卡内元素的 padding 一起抹掉）');
chk(!/\[data-lib-view="book"\]\s+\.group-card/.test(classicCode),
  '没有用后代选择器去清理第二层内部的卡（卡内两列 / 三列靠那些 padding）');

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
chk(/\.dock-inner\s*\{[^}]*max-width:\s*var\(--content-w/s.test(cssCode),
  '页签内层读 --content-w（与内容区同源，四格不会被拉成巨板）');
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
/* ⚠️ 顶栏 / 页签内层 / 阅读器正文读的是 --content-w（= --col-w 减掉两侧的
   --col-side），不是 --col-w 本身：这三样住在「整宽」的容器里（.app 的
   padding 之外，或 body 直下），自己不带左右内边距 —— 直接读 --col-w 的话
   在平板 / 桌面上会比正文列宽出两侧那一条边（实测 1918px 屏上顶栏左移 42px）。
   这四条是「四样东西落在同一条竖轴上」的唯一保障，不许只改其中一条。 */
chk(/max-width:\s*var\(--content-w/.test(ruleOf(cssCode, '.topbar')),
  '顶栏列宽与内容区同源（--content-w）');
chk(/width:\s*var\(--content-w/.test(ruleOf(classicCode, '.reader-body')),
  '阅读器正文列宽与内容区同源（--content-w）');
chk(/max-width:\s*var\(--content-w/.test(ruleOf(cssCode, '.dock-inner')),
  '页签内层与内容区同源（--content-w）');
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

/* 列宽令牌：手机 720px、平板一档更宽、桌面跟着视口走。
   ⚠️ 平板那一档写的是 min(1040px, 100vw)：1040px 是握在手里的平板那一档，
      但 iPad Pro 竖屏 / 分屏窗口比它窄，写死会让一列纸比视口还宽
      （真机上量到过：顶栏被挤出屏幕、与正文对不齐）。 */
const tabletRoot = /@media \(min-width:\s*768px\)\s*\{[^@]*:root\s*\{[^}]*--col-w:\s*min\(\s*(\d+)px/s.exec(cssCode);
chk(!!tabletRoot, '平板（≥768px）那一档把 --col-w 放宽了一档（不是把手机那一列拉宽）');
if (tabletRoot) {
  const w = Number(tabletRoot[1]);
  chk(w > 720 && w <= 1200,
    '平板列宽 ' + w + 'px 落在「比手机宽、又不到桌面无限」这一档内');
  chk(/--col-w:\s*min\(\s*\d+px\s*,\s*100vw\s*\)/.test(cssCode),
    '平板列宽取 min(固定值, 100vw)：比那一档还窄的窗口（iPad Pro 竖屏 / 分屏）下不会比视口宽');
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

/* 阅读器：栏变宽了，**正文反而收窄** —— 行宽 35~40 字是阅读上限。
   令牌是 --read-w（= 手机那一档 720px，也是「一行字」的唯一来源，
   见 css/style.css 的 :root）：一列纸在桌面上跟视口走，
   但一行字 / 一条进度条轨道 / 一格日历不跟 —— 那是「读一行太累」的问题。 */
chk(/@media \(min-width:\s*768px\)[\s\S]{0,400}\.reader-text\s*\{[^}]*max-width:\s*var\(--read-w/s.test(classicCode),
  '阅读器正文列在 ≥768px 封顶 --read-w（栏宽了，一行字数不跟着涨）');

/* 页内工具栏与搜索区：宽栏里封顶居中，不被拉成一整条横带。
   ⚠️ 工具栏那一档在桌面上从 720px 改成 var(--col-w)：一排控件必须与它下面
      那张卡片左右同缘，否则前者居中 720px、后者 1808px，左缘差出 400 多 px
      （见 css/classic.css 的 toolbar 桌面那一档）。 */
chk(/@media \(min-width:\s*768px\)[\s\S]{0,400}\.toolbar:not\(\.search-toolbar\)\s*\{[^}]*max-width:\s*720px/s.test(classicCode),
  '集子页工具栏在 ≥768px 封顶居中（搜索框一个人吃掉 900px，右边两枚隔着半屏）');
chk(/@media \(min-width:\s*1024px\)[\s\S]{0,400}\.toolbar:not\(\.search-toolbar\)\s*\{[^}]*max-width:\s*var\(--content-w/s.test(classicCode),
  '集子页工具栏在 ≥1024px 改跟 --content-w（与下面的卷次卡左右同缘，且不比容器宽）');
chk(/@media \(min-width:\s*768px\)[\s\S]{0,400}\.search-hero\s*\{[^}]*max-width:\s*520px/s.test(classicCode),
  '搜索页 hero 在 ≥768px 封顶 520px（竖屏高度按视口算，横着拉满就成一条横带）');

/* 进度日历与进度条：均分上限只在手机那一档成立，平板起要收回来 */
chk(/@media \(min-width:\s*768px\)[\s\S]{0,400}\.cal,[\s\S]{0,80}max-width:\s*var\(--read-w/s.test(classicCode),
  '进度日历在 ≥768px 收回 --read-w（14 格均分 1040px 会把格子拉成 64px 的宽方块）');
chk(/@media \(min-width:\s*768px\)[\s\S]{0,600}\.bars\s*\{[^}]*max-width:\s*var\(--read-w/s.test(classicCode),
  '掌握度进度条在 ≥768px 收回 --read-w（轨道 900px 长时，走两成也像快满了）');

/* ==========================================================================
   四之二、桌面（≥1024px）—— 一列纸跟视口走，其余东西收在「一行」的宽度里
   --------------------------------------------------------------------------
   用户原话（Issue #135 后续）：
     「桌面端特别是满屏桌面端一般是 1920 的宽度，这种情况下页面有限宽吗，
       我更喜欢布满屏幕的设计，顶多左右留有 margin 或者 padding，
       而不是限定 max-width 到 960px 或者类似的这种设计。」

   原先桌面与平板共用同一档：一列纸写死 1040px —— 1920px 屏上两侧各空
   440px（占屏 46%），一屏里近一半是空白。
   这一档换掉的是「一列纸的宽度从哪来」：平板是握在手里的固定屏宽（给一个
   数值），桌面是用户自己拉的窗口（跟着视口走，两侧只留一条边）。

   ⚠️ 这一档**不是**把「行宽上限」取消掉。两件事原先都塞给了同一个 720px：
     · 页面两侧要不要留白 —— 由一列纸决定（桌面：跟视口走）；
     · 一行字该有多长 —— 由 --read-w 决定（三档都是 720px，永远不跟视口走）。
    守着「桌面那一档真的换了列宽来源」，同时守着「行宽令牌没有被顺手拉宽」。
   ========================================================================== */

/* 桌面那一档的列宽由视口算出来（不是又一个写死的数值）：
   --col-w 就是视口宽，.app 是 border-box，两侧由 --col-side 的 padding 收 ——
   于是内容宽 = 100vw − 112px，窗口一宽就宽。
   ⚠️ 写过 max(1040px, 100vw - 112px)：真机上 1023 → 1024 那一步内容从 979
      掉到 912（max() 取到 1040 下限再减 112），窗口宽 1px、内容窄 67px。
      写成 100vw 之后 1024px 起内容是一条单调斜线（1040 → 1808）。 */
const deskRoot = /@media \(min-width:\s*1024px\)\s*\{[^@]*:root\s*\{([^}]*)\}/s.exec(cssCode);
chk(!!deskRoot, '桌面（≥1024px）那一档真的存在（不是把平板那一列当桌面用）');
if (deskRoot) {
  const block = deskRoot[1];
  chk(/--col-w:\s*100vw/.test(block),
    '桌面列宽 = 视口宽（内容宽随之 = 100vw − 两侧的边，跟着窗口走）');
  chk(/--col-side:\s*56px/.test(block),
    '桌面两侧留 56px（边固定、内容跟视口走 —— 这才叫「布满屏幕」而不是「拉满」）');
  chk(!/--col-w:\s*max\(\s*\d+px/.test(block),
    '桌面列宽不再用 max(固定值, …) 兜底（真机上那会在 1024px 处造出一个 1px 断崖）');
}
/* 两侧那条边必须是一个值（不是 max()/min() 算式）：算式会让内容被永久卡在
   上限上 —— 真机上量到过「1920px 屏内容仍是 1040px、两侧各空 440px」。 */
chk(/--col-side:\s*56px/.test(cssCode) && !/--col-side:\s*(max|min)\(/.test(cssCode),
  '--col-side 是固定值，不是算式（算式会与 max-width 打架、把内容卡死）');

/* 「一行字」的宽度是全站唯一来源 --read-w，且三档都是 720px */
chk(/--read-w:\s*720px/.test(cssCode),
  '「一行字」的宽度令牌 --read-w 只定义一次，取手机那一档 720px（约 38 个汉字）');
chk(!/--read-w:\s*calc\(100vw/.test(cssCode),
  '--read-w 不跟视口走（行宽跟着屏幕一起涨正是「读一行太累」的成因）');
chk(!/@media[^{]*\{[^@]*--read-w:\s*(?!720px)/.test(cssCode),
  '--read-w 在任何一档里都不被改写（三档同一个值：手机 / 平板 / 桌面一行字一样长）');

/* 桌面上的排布：长列表 / 卡内篇目 / 设置分组都再排一档（两列 → 三列） */
chk(/@media \(min-width:\s*1024px\)[\s\S]{0,400}\.list\s*>\s*\.item\s*\{[^}]*33\.333%/s.test(cssCode),
  '篇目列表在 ≥1024px 再排一档（两列时 1808px 里每行 893px，又是「空白比字宽」）');
chk(/@media \(min-width:\s*1024px\)[\s\S]{0,600}\.group-card\s*>\s*\.item\s*\{[^}]*33\.333%/s.test(classicCode),
  '集子页卡内篇目在 ≥1024px 排成三列（与首页同一档，同一条「空白比字宽」的理由）');
chk(/@media \(min-width:\s*1024px\)[\s\S]{0,400}\.settings-group\s*\{[^}]*33\.333%/s.test(cssCode),
  '设置分组在 ≥1024px 排成三列（一列纸 1808px 时两列每栏 886px，一行选项又是一片空白）');
/* 三列时「每列第一条不画线」要按**每一列**算：卡头占第一位 →
   孩子序号 2 / 3 / 4。只写 2、3 的话第三列第一条会凭空多一道横线。 */
chk(/.group-card\s*>\s*\.item:nth-of-type\(4\)[\s\S]{0,60}border-top:\s*none/s.test(classicCode),
  '三列时第三列的第一条也不画线（nth-of-type 只写到 3 的话会漏一列）');

/* 输入框：桌面不跟着栏宽拉长（一个「用户名」值只有几个字，框却有 578px 宽） */
chk(/@media \(min-width:\s*1024px\)[\s\S]{0,200}\.settings-input\s*\{[^}]*max-width:\s*320px/s.test(cssCode),
  '桌面上的单行输入框封顶 320px（与手机上一整行同档，不跟着栏宽拉长）');

/* 入口页六张卡：桌面换成**三列栅格**，列数是说出来的、不由卡宽与容器宽的
   除法决定。真机上踩过：flex-basis 三分之一 + max-width 收上限的结果是
   一行 4 张、第二行 2 张（收窄之后容器里还放得下第 4 张）。 */
chk(/@media \(min-width:\s*1024px\)[\s\S]{0,900}\.library-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3/s.test(classicCode),
  '桌面入口页换成三列栅格（六张卡排成 3 × 2，不是 4 + 2）');

/* 翻页那一排与正文同宽。
   ⚠️ 居中必须写在 .reader-nav 的 margin 简写里（`26px auto …`），
      不能另写一条 media query 只加 margin-left/right auto ——
      margin 简写会把后写的左右值重置回 0，媒体查询又不加特异性。
      真机上踩过：max-width 生效了（720px），但整排贴在正文左缘、没有居中。 */
chk(/@media \(min-width:\s*1024px\)[\s\S]{0,300}\.reader-nav\s*\{[^}]*max-width:\s*var\(--read-w/s.test(classicCode),
  '阅读器「上一篇 / 下一篇」在 ≥1024px 收进 --read-w（不然两枚按钮被推到屏幕两端）');
chk(/\.reader-nav\s*\{[^}]*margin:\s*26px auto\s+calc\(118px/s.test(classicCode),
  '翻页那一排的左右 auto 写在 margin 简写里（另写一条会被简写重置回 0）');

/* 三样东西必须读同一条「内容宽」令牌，而不是各自读 --col-w ——
   见上面第三段那四条断言（顶栏 / 页签内层 / 正文列 / 阅读器正文）。 */
chk(/--content-w:\s*calc\(var\(--col-w\)\s*-\s*2\s*\*\s*var\(--col-side\)\)/.test(cssCode),
  '「内容宽」= 一列纸减掉两侧那条边，只定义一次（顶栏 / 页签内层 / 正文列都读它）');
/* 左右内边距只能有一个来源：真机上曾因为后出现的 .app{padding-left:14px}
   把三档的 --col-side 整条盖掉（1918px 屏上顶栏左移 42px、与正文对不齐）。 */
chk(/--col-side:\s*var\(--safe\)/.test(cssCode) === false &&
  /\.app\s*\{[^}]*padding-left:\s*calc\(var\(--col-side\)/.test(cssCode),
  '左右内边距读同一档 --col-side（不再有一处写死 14px 把三档一起盖掉）');

/* 设置主页的四条入口：一张卡 + 标题与集子索引页的分组名同档（Issue #147）
   --------------------------------------------------------------------------
   用户原话：「设置页首页，四个卡片是不是应该有背景色？另外四个标题字号需要变大，
   可以和其他索引页页面例如集子的标题字号一样大。」

   两件事各自都要有一个**可判的**落点，否则改完只是「看着像」：
     · 背景色 = 走全站那一条 --card（不新开一个色值）；
     · 标题字号 = 与集子索引页的卷名 .group-name 同一个值。
       这一条是本文件里唯一一处「跨两张表」的约定：设置入口在 css/style.css，
       集子卷名在 css/classic.css。两条规则各在一张表里，只能靠这对断言绑住 ——
       改一边就会红，谁也加不进第三个近似值（14.5px 那档就是这么来的）。 */
const linkRule = ruleOf(cssCode, '.settings-link');
chk(/background:\s*var\(--card\)/.test(linkRule),
  '设置主页的四条入口有底色（走全站 --card，不新开色值）');
chk(/border-radius:\s*var\(--radius-md\)/.test(linkRule),
  '入口卡片的圆角走 --radius-md（与 .trans-box / .library-card 同一档）');
const linkTitleRule = ruleOf(cssCode, '.settings-link-title');
const groupNameRule = ruleOf(classicCode, '.group-name');
const sizeOf = r => (r.match(/font-size:\s*([\d.]+)px/) || [0, ''])[1];
const weightOf = r => (r.match(/font-weight:\s*(\d+)/) || [0, ''])[1];
chk(sizeOf(linkTitleRule) !== '' && sizeOf(linkTitleRule) === sizeOf(groupNameRule),
  '设置入口标题与集子卷名的字号是同一个值（实际 ' + sizeOf(linkTitleRule) +
  ' / ' + sizeOf(groupNameRule) + '）');
chk(weightOf(linkTitleRule) !== '' && weightOf(linkTitleRule) === weightOf(groupNameRule),
  '设置入口标题与集子卷名的字重也是同一个值（实际 ' + weightOf(linkTitleRule) +
  ' / ' + weightOf(groupNameRule) + '）');
chk(/position:\s*absolute/.test(ruleOf(cssCode, '.settings-link-go')),
  '入口卡片右侧那颗箭头绝对定位在卡里（不让它参与这一行的排布，落点恒定）');

/* 结构：两列排布要靠 HTML 里的容器才生效，只写 CSS 是空规则 */
// ⚠️ Issue #132 后续把设置拆成二级页：主页套 .settings-groups（入口清单），
//    「我的清单」那一条 .wide 住在它自己的二级页上。
chk(/class="settings-groups/.test(read('settings/index.html')),
  '设置主页真的套了 .settings-groups（不是只写了一条 CSS）');
chk(/class="settings-item wide"/.test(read('settings/lists/index.html')),
  '「我的清单」那一项真的带了 .wide');
chk(read('settings/index.html').indexOf('id="settings-index"') !== -1,
  '设置主页有入口清单容器 #settings-index（四个二级页入口由 js/settings-nav.js 生成）');
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
   五、顶栏在任何容器里都必须占满容器宽（不许被内容顶宽）
   --------------------------------------------------------------------------
   现象（用户报的）：详情页标题栏溢出。
   根因不在「标题会不会折行」——是顶栏**自己**的宽度失控：
     · 列表页那条顶栏住在 .app（块级）里，块级子元素天然占满一行，
       所以从来没露过这个问题；
     · 阅读器那条顶栏住在 .reader 里，而 .reader 是 `display: flex;
       flex-direction: column`。顶栏作为 flex 项，**交叉轴（横向）默认按
       内容取宽**，不是撑满容器。于是「跬步 · 页名 + 进度牌 + 返回键」
       四件加起来多宽，顶栏就多宽 —— 手机上量到 427px（视口 393px）。
     · body 是 `overflow: hidden`，所以既不出现横向滚动条、也没有报错，
       只是最右边那颗返回键被屏幕裁掉一半、点不着。
   判据写成**结构 + 声明**两半（jsdom 不算布局，真浏览器那一半在 pwa.test.js）：
     1) 阅读器顶栏显式定住宽度；
     2) 品牌区 / 页名 / 说明都允许被压窄（min-width: 0），
        且页名不再按视口比例写死上限（那条上限与顶栏结构无关）。
   ========================================================================== */
const readerBar = ruleOf(classicCode, '.reader > .topbar');
chk(/width:\s*100%/.test(readerBar),
  '阅读器顶栏定住 width: 100%（flex 列容器里不靠内容取宽）');
chk(/min-width:\s*0/.test(readerBar),
  '阅读器顶栏 min-width: 0（长页名不许把它顶宽）');

const brandRule = ruleOf(cssCode, '.brand');
chk(/min-width:\s*0/.test(brandRule), '品牌区 min-width: 0（可被压窄，不做「不收到内容以下」）');
chk(/overflow:\s*hidden/.test(brandRule), '品牌区 overflow: hidden（内部有多宽都不外溢到顶栏）');
chk(/min-width:\s*0/.test(ruleOf(cssCode, '.brand-text')),
  '品牌文字区 min-width: 0（页名那一行参与收缩）');
chk(/min-width:\s*0/.test(ruleOf(cssCode, '.brand-page')), '页名块 min-width: 0');
const pageTextRule = ruleOf(cssCode, '.brand-page-text');
chk(/min-width:\s*0/.test(pageTextRule), '页名文字 min-width: 0（压窄后走 ellipsis）');
chk(/text-overflow:\s*ellipsis/.test(pageTextRule), '页名压窄后仍是省略号收尾');
chk(!/max-width:\s*\d+vw/.test(pageTextRule),
  '页名不再按视口比例写死上限（46vw 这类数会重新把顶栏顶宽）');
chk(!/max-width:\s*\d+vw/.test(ruleOf(cssCode, '.brand-sub')),
  '顶栏第二行说明也不再按视口比例写死上限（52vw 同理）');
chk(/flex:\s*none/.test(ruleOf(cssCode, '.brand-name-row h1')),
  '「跬步」两字钉住不参与收缩（要收就收页名，不许把应用名压成「跬」）');

/* ---------- 顶栏右上角那枚头像：**与 logo 一模一样的圆** ----------
   用户原话（Issue #132 · 2026-09-15）：
     「右上角方形圆角还是替换成和 logo 一模一样大小的圆形吧。」
   三个「一模一样」都要能判：
     1) 同**直径** —— 头像的 --user-size 与徽标 .brand-mark 的 width 同一个数值
     2) 同**形状** —— 头像整圆（border-radius 50%），不再是 26% 的「圆的方角」
     3) 印色**铺满** —— 内层 .seal-avatar 在顶栏里被覆写成 100% 满幅，
        否则圆里还缩着一个小一号的方角印，「一模一样大」当场不成立
   为什么按算式判而不是写死 42：下次要调尺寸时，这两条断言仍会自动成立
   （它们守的是「两处同源」，不是「等于某个数」）。 */
const markRule = ruleOf(cssCode, '.brand-mark');
const userRule = ruleOf(cssCode, '.top-user');
// ⚠️ Issue #147 把这一条从「两个数值相等」升级成「**同一条令牌**」：
//    原先徽标写 42px、头像写 --user-size: 42px，相等全靠人抄对；
//    现在右侧簇里每一件（徽标 / 返回槽 / 头像 / 阅读器那枚印 / 兜底占位）
//    都读 :root 的 --top-slot —— 相等是 structural 的，改一处两处一起走。
const slotTok = (ruleOf(cssCode, ':root').match(/--top-slot:\s*(\d+)px/) || [])[1];
const markW = (markRule.match(/width:\s*(\d+)px/) || [])[1];
chk(!!slotTok && markW === slotTok,
  '顶栏右侧的直径令牌 --top-slot 就是品牌徽标的 42px（.brand-mark ' + markW +
  'px vs :root --top-slot ' + slotTok + 'px）');
chk(/--user-size:\s*var\(--top-slot\)/.test(userRule),
  '头像直径读 --top-slot（与徽标同一条令牌，不再两处各写一个 42）');
chk(/width:\s*var\(--user-size\)/.test(userRule) && /height:\s*var\(--user-size\)/.test(userRule),
  '头像的宽高都读 --user-size（尺寸只有一个来源，不两处各写一个数）');
chk(/border-radius:\s*50%/.test(userRule),
  '头像外框是整圆（不是 26% 的「圆的方角」—— 用户要的是「圆形」）');
const sealInUser = ruleOf(cssCode, '.top-user > .seal-avatar');
chk(/width:\s*100%/.test(sealInUser) && /height:\s*100%/.test(sealInUser),
  '顶栏那一枚印铺满整圆（width/height 100%，不在圆里再缩一圈）');
chk(/border-radius:\s*50%/.test(sealInUser),
  '顶栏那一枚印自身也是圆（印色满幅 + 圆边，两处口径一致）');
chk(/--seal-size:\s*var\(--user-size\)/.test(sealInUser),
  '印的字号基准也读 --user-size（字随圆走，圆变大字跟着变大）');
chk(/--seal-size:\s*\d+px/.test(ruleOf(cssCode, '.seal-avatar-top')),
  '顶栏那一枚留了兜底直径（万一 .top-user 那段没生效也不退化成零尺寸空圆）');
chk(/width:\s*var\(--top-slot\)/.test(ruleOf(cssCode, '.top-act-spacer')),
  '头像渲染不出来时的兜底占位与头像同档（顶栏左右两栏才配平）');

/* ==========================================================================
   六、各页顶栏结构一致（同一套 chrome 渲染）
   ==========================================================================

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

/* ==========================================================================
   六、「一列纸」的两条边只允许被算一次（Issue #147，真实渲染几何）
   --------------------------------------------------------------------------
   上面第 一 段守的是「源码里没有第二层 .app」；这一段守的是**画出来的结果**，
   两者不是一件事：换一种写法（例如给第二层写一条 margin）源码断言抓不到，
   而用户看到的仍然是「卡片比顶栏窄一条边」。

   做法：用 jsdom 把页面挂起来，然后在**从 body 往下的一串祖先**里找
   「有没有哪一个盒子又额外缩进了一圈」—— 也就是那种「只缩进、不撑宽」的块级
   容器（左右各留了内边距 / 外边距或收窄了宽度）。全站只有 .app 这一个盒子
   有权这么做，而它全站只有一层。

   ⚠️ 判据刻意写成「数一数有几层缩进」，而不是「量一下宽不等于多少 px」：
      前者换断点 / 换列宽数值都照样成立，后者是硬编码的像素。
   ========================================================================== */
if (!JSDOM) {
  console.log('(未安装 jsdom，跳过「一列纸只缩进一次」的真实渲染断言 —— npm i jsdom 可启用)');
} else {
  const html = read('library/index.html');
  const dom = new JSDOM(html, { url: 'https://local.test/library/' });
  const doc = dom.window.document;

  /**
   * 数一数：从 body 到 el 之间，有几层「又缩进了一圈」的容器。
   *
   * 「又缩进了一圈」的判据（任何一条成立即算一层）：
   *   · 盒子里有左右内边距 —— 第一个孩子的可用宽度因此比盒子窄；
   *   · 盒子里有左右外边距 —— 盒子自己比父亲窄；
   *   · 盒子宽度被写死（不是 auto，例如 .app 的 max-width: --col-w）。
   * ⚠️ 这三条合起来正好描述 .app 那一种盒子；也正是 #147 里被套了两遍的东西。
   *
   * ⚠️ 下面三处量法原先各写了一遍，并且都把「宽度」判成
   *    `cs.width === 'auto' ? 'auto' : 'set'`。这条判据在**真的浏览器**里成立，
   *    在这套用 jsdom 挂起来的页面里却整个是反的：
   *      · 这些页面只 `<link>` 了 css/style.css，而测试里的 JSDOM 一律
   *        `resources` 缺省（不去取外链），于是**一份样式表都没挂上**；
   *      · 没有样式表 → jsdom 又不做布局 → 任何块级盒的 `cs.width` 都取到
   *        **空串**（不是 'auto'），`'' === 'auto'` 为假 → 一律判成 'set'。
   *    结果是从 body 到量点的**每一个**祖先都被数成「缩进了一层」，
   *    「几层」这个数只反映 DOM 有多深，与有没有多套一层 .app 毫无关系 ——
   *    一条永远什么都不验、还随时会因别处 DOM 加深而变红的哑断言
   *    （lib 的三个页面就是这么红的：`.toolbar` 比 `.topbar` 多一个祖先，
   *      于是恒为「3 / 2」；而 poems 恰好同为 2 个祖先，就一直绿着）。
   *
   *    所以判据改成「**量得出来**的宽度才算数」：空串 / 'auto' / NaN 一律
   *    视为「撑满父亲，不算一层」。这才是这条断言本来想问的事 ——
   *    「有没有哪个盒子又收窄了一圈」，而不是「DOM 有几层」。
   *    内边距那一支不受影响（jsdom 对 `padding: 14px` 这种常量是算得出来的）。
   */
  /* 数一数：从 body 到 el 之间套了几层 `.app`（「一列纸」的唯一载体）。
     ⚠️ 判据刻意用 `.app` 这个**类**、而不是量出来的宽度 / 内边距：
        前者在 DOM 里，量得准；后者要靠布局引擎，而测试里的 jsdom
        一份样式表都没挂上（见 `insetsOf` 的注释），量出来永远是空的。 */
  const appCountOf = (ddoc, el) => {
    let n = 0;
    for (let p = el; p && p !== ddoc.body; p = p.parentElement) {
      if (p.classList && p.classList.contains('app')) n += 1;
    }
    return n;
  };

  const insetsOf = (win, el) => {
    const ddoc = win.document;
    let n = 0;
    for (let p = el; p && p !== ddoc.body; p = p.parentElement) {
      const cs = win.getComputedStyle(p);
      const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const mar = parseFloat(cs.marginLeft) + parseFloat(cs.marginRight);
      const w = cs.width;
      const narrowed = w !== '' && w !== 'auto' && !isNaN(parseFloat(w));
      if (pad > 0 || mar > 0 || narrowed) n += 1;
    }
    return n;
  };

  const insets = el => insetsOf(dom.window, el);

  const mkEl = (tag, cls, parent) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    (parent || doc.body).appendChild(e);
    return e;
  };

  // 造一份「页面那条顶栏 + 一列纸 + 纸里的内容」的最小结构（与全站约定一致）。
  // ⚠️ 顶栏里要**真的**放上品牌区与右侧簇（品牌区 + `.top-slot` + 恒定锚点）——
  //    这就是 chrome.js 的 headerHtml 渲染出来的那一行。少了右侧簇，
  //    jsdom 里盒模型虽然算不出宽度，但「同一把尺子量到底」的前提就丢了：
  //    量点与被量点必须处在同一份真实结构上，否则这条断言问的不是它想问的事。
  // ⚠️ 顶栏必须**住在 .app 里面** —— 真页面就是这么写的
  //    （index.html / poems / settings / library 全是 `.app > header.topbar`）。
  //    早先这里把顶栏与 .app 摆成**兄弟**，于是「页顶那一行」与「纸里的内容」
  //    天然差一个 .app，量出来的两个数永远不可能相等 —— 一条自己写错前提、
  //    注定红的断言。量点与被量点要先处在同一份真实结构上。
  const paper = mkEl('div', 'app');
  const bar = mkEl('header', 'topbar', paper);
  mkEl('div', 'brand', bar);
  mkEl('span', 'top-slot', bar);
  mkEl('span', 'top-user', bar);
  const inner = mkEl('div', '', paper);          // 纸里的内容（不该再缩进一次）
  const nested = mkEl('div', 'app', inner);      // 误写的那种：第二层又套一个 .app

  const a = insets(bar);
  const b = insets(inner);
  const c = insets(nested);

  chk(b === a,
    '一列纸里的内容与页顶那一行缩进**层数相同**（实际 ' + b + ' / ' + a + '）—— ' +
    '任一方多一层，画出来就是「卡片比顶栏窄一条边」');

  /* 反面样本：多套一层必须真的被数出来。
     ⚠️ 上一版这条写成「不断言」（只数内边距那一支），理由是「jsdom 不做布局，
        `max-width: var(--col-w)` 算不出来」—— 那个理由对**宽度**那一支成立，
        却顺手把这条断言变成了哑的：既然什么都不验，它就只剩「随时可能红」。
        而它确实红了（见下面那三条页面断言）。

        真正的做法不是放弃，而是**换一个 jsdom 看得见的口径**：
        全站「一列纸」这件事只有一个载体 —— `.app` 这个类本身。
        「有没有又缩进一圈」在结构与真机上都是同一件事：**这条路径上有几个 .app**。
        这个数完全在 DOM 里，与布局引擎无关，所以它量得准、也不会漂。
        （`insetsOf` 那两支保留着，但它们**不参与**这两条 ——
          它们在无样式表的 jsdom 里是哑的，参与了就等于没验。） */
  const appCount = el => appCountOf(doc, el);
  chk(appCount(inner) === appCount(bar),
    '一列纸里的内容与页顶那一行**套了同样多个 .app**（实际 ' +
    appCount(inner) + ' / ' + appCount(bar) + '）');
  chk(appCount(nested) === appCount(inner) + 1,
    '反面样本对得上：多套一层 .app 必须多算一个（实际 ' +
    appCount(nested) + ' / ' + appCount(inner) + '）—— ' +
    '这一条保证上面那把尺子不是哑的');

  // 真正的页面也要过同一把尺
  for (const [file, url, sel] of [
    ['library/index.html', '/library/', '.toolbar'],
    ['poems/index.html', '/poems/', '.toolbar'],
    ['settings/index.html', '/settings/', '#settings-index']
  ]) {
    const d2 = new JSDOM(read(file), { url: 'https://local.test' + url });
    const dd = d2.window.document;
    const box = dd.querySelector(sel);
    // ⚠️ 口径换成 `.app` 层数（原先这里量的是「宽度 / 内边距缩进」，
    //    而那把尺子在测试里量不到任何东西 —— 详见 `insetsOf` 的注释）。
    const n = appCountOf(dd, box);
    const m = appCountOf(dd, dd.querySelector('.topbar'));
    chk(n <= m,
      file + ' 里 ' + sel + ' 套的 .app 不多于页顶那一行（实际 ' + n + ' / ' + m + '）—— ' +
      '页顶与内容必须落在同一条竖轴上');
  }
}

/* ==========================================================================
   十、顶栏右端是**固定位**：返回键与头像不随页名长短移动（Issue #147）
   --------------------------------------------------------------------------
   用户原话（2026-09-15）：
     「搜索页面后退按钮离 profile 头像太远了，他俩应该靠近并固定位置，
       所有页面都应该如此，而不是因为搜索页面标题太短，位置就可以左移。」

   病根在**排版方式**，不在某个数值：顶栏是 `justify-content: space-between`
   的两栏，而右侧簇原先只有「返回键 + 头像」两颗、返回键直接跟在**品牌区**
   后面（`.brand` 之后的第一个 flex 项）。页名一短，左右两栏一分摊，
   那一颗箭头就跟着往左跑：真机实测（Chrome 153 · 393px 视口）
   「跬步 · 搜索」比「课外阅读」短 60px，返回键与头像之间因此空出 56px，
   而别页只有 10~18px —— 用户点名的正是搜索页。

   修法是把「位置」这件事从**内容流**里拿出来：返回键住进一枚固定圆槽
   （`.top-slot`，由 `margin-left: auto` 钉住），头像做恒定锚点钉在最右。
   两颗的像素位此后只由「两栏 + 槽宽 + 间距」决定，与页名长短无关。

   这一层守四件事，缺一条都会以「某个页面上箭头位置又不对了」的形式复发：
     ① 槽钉得住（`margin-left: auto`）、槽与锚点都不收缩（`flex: none`）；
     ② 尺寸只有一个来源：徽标 / 槽 / 头像 / 阅读器那枚印全部读 `--top-slot`；
     ③ 每个页面都走同一份模板，右侧簇的次序恒为「槽 → 恒定锚点」；
     ④ 阅读器那条顶栏也补上同径的锚点 —— 否则正文一开一合，那颗箭头
        相对页面其他位置横跳 50px（头像 42 + 间距 8）。
   ========================================================================== */
{
  const rightSlotRule = ruleOf(cssCode, '.top-slot');
  chk(/margin-left:\s*auto/.test(rightSlotRule),
    '返回槽由 margin-left: auto 钉在右侧（不随品牌区宽度浮动）');
  chk(/flex:\s*none/.test(rightSlotRule),
    '返回槽不参与收缩（窄屏时只允许品牌区被压窄）');
  chk(/width:\s*var\(--top-slot\)/.test(rightSlotRule) &&
    /height:\s*var\(--top-slot\)/.test(rightSlotRule),
    '槽的宽高读 --top-slot（顶栏右侧不出现第二个尺寸来源）');
  chk(/--top-slot:\s*42px/.test(ruleOf(cssCode, ':root')),
    ':root 里 --top-slot 是 42px（= 品牌徽标 .brand-mark 的直径，顶栏左右配平）');
  chk(/flex:\s*none/.test(ruleOf(cssCode, '.top-user')),
    '头像不参与收缩（它是恒定锚点，一个像素都不许动）');
  // 返回键自己那颗按钮仍比槽小一档（40 / 42），但尺寸也从同一族令牌来
  chk(/--top-key:\s*40px/.test(ruleOf(cssCode, ':root')) &&
    /width:\s*var\(--top-key\)/.test(ruleOf(cssCode, '.top-slot > .top-act')),
    '槽里的返回键直径读 --top-key（圆槽 → 圆环 → 头像三枚同一套口径）');
  // 槽与恒定锚点之间的间距只有一个来源
  chk(/\.top-slot \+ \.top-user,[\s\S]{0,200}\.top-slot-mark[\s\S]{0,120}margin-left:\s*var\(--top-gap\)/.test(cssCode),
    '槽与恒定锚点之间的间距只有一个来源（--top-gap）');

  // 阅读器那条顶栏的「这一册的印」：与头像同径，占住同一个像素位
  const markSlotRule = ruleOf(cssCode, '.top-slot-mark');
  chk(/width:\s*var\(--top-slot\)/.test(markSlotRule) &&
    /height:\s*var\(--top-slot\)/.test(markSlotRule),
    '阅读器里的恒定锚点与头像同径（返回键因此原地不动，不横跳 50px）');
  chk(/top-slot-mark/.test(chromeJs) && /GLYPHS\.reader/.test(chromeJs),
    '阅读器那条顶栏由 chrome.js 补上这一枚锚点');

  // ③ 结构：右侧簇恒为「槽 → 恒定锚点」，页名与它无关（只有品牌区可收缩）
  const headerFn = strip(chromeJs.slice(chromeJs.indexOf('function headerHtml'),
    chromeJs.indexOf('function firstActAnchor')));
  // ⚠️ 只看**代码**：那段注释里正讲着旧的 `justify-content: space-between`，
  //    拿裸词扫整个函数体必然误判（这个坑与 account-entry 里那条同源）。
  const headerCode = strip(chromeJs.slice(chromeJs.indexOf('function headerHtml'),
    chromeJs.indexOf('function firstActAnchor'))).replace(/\/\/[^\n]*/g, ' ');
  chk(/right =[\s\S]{0,200}'<span class="top-slot">' \+ leftOfCluster \+ "<\/span>" \+ anchor;/.test(headerCode),
    '右侧簇恒为「返回槽 → 恒定锚点」，页名与它无关');
  chk(!/justify-content/.test(headerCode),
    '右侧簇的位置不由 JS 排（分列两端交给 CSS 的 .topbar，JS 只管渲染结构）');
  // 每一页都真的能起出顶栏，且都不自己另写一套
  const PAGES = [
    ['index.html', '/'],
    ['search/index.html', '/search/'],
    ['settings/index.html', '/settings/'],
    ['library/index.html', '/library/'],
    ['poems/index.html', '/poems/'],
    ['profile/index.html', '/profile/'],
    ['login/index.html', '/login/'],
    ['terms/index.html', '/terms/']
  ];
  PAGES.forEach(([file, url]) => {
    const d3 = new JSDOM(read(file), { url: 'https://local.test' + url }).window.document;
    chk(!!d3.querySelector('.topbar'),
      file + ' 有顶栏（唯一那条由 chrome.js 统一渲染）');
    chk(!/class="top-slot"/.test(stripHtml(read(file))),
      file + ' 的 HTML 里不写死右侧簇（结构只出 chrome.js 一处）');
  });
  // 被守的页名长短要真的不同 —— 否则这一层看着绿，其实什么都没区分开
  const pageNames = ['搜索', '课外阅读', '唐诗三百首', '课外必背小古文'];
  chk(new Set(pageNames.map(n => n.length)).size > 1,
    '被守的页名长短确实不同（' + pageNames.map(n => n.length).join('/') + ' 字）—— ' +
    '上一版正是长度差异把返回键推到了不同位置');
}

console.log(fails === 0 ? '\n🎉 UI 一致性 / 响应式守卫全部通过' : '\n❌ ' + fails + ' 项失败');
process.exit(fails ? 1 : 0);
