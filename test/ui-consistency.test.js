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
const accountCss = read('css/account.css');
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
  /* 造一份带样式的真页面：**必须把样式表真的挂进去**。
     --------------------------------------------------------------------
     ⚠️ 这是这一层先前失效的地方（既有失败 3 项的根因）：
        jsdom 的 `getComputedStyle` 在**没有样式表**时，`width` / `max-width`
        一律返回空串（`''`），而不是 `'auto'` / `'none'`。
        原先的判据写的是 `cs.width === 'auto' ? 'auto' : 'set'` ——
        于是「宽度收窄」这一支对**每一个元素**都成立，
        整把尺子退化成「数一数 DOM 套了几层」：

          · 真页面上，内容比顶栏多套一层（library 的 data-lib-view、
            settings 的 .settings-page），就判红 —— 而它们在水平方向
            一个像素都没缩进（.settings-page 只有 padding-bottom；
            [data-lib-view="book"] 的左右内边距已被清零）；
          · 反过来，真正该抓的「第二层 .app」（max-width: var(--col-w)）
            反而抓不到 —— 合成样本里根本没挂样式表。

        现在两条都修：样式表挂进去（`styled()`），判据改成「真的能算出来的
        那种收窄」—— 左右内边距 / 左右外边距，或者**声明过**的
        max-width / width。jsdom 只对「没声明」的取空串，
        对 `max-width: var(--col-w)` 会原样返回那个字符串，
        所以这一条既能判、也不会误伤。
     -------------------------------------------------------------------- */

  /* 样式表的唯一一份挂载入口：jsdom 默认不去取 `<link>` 的外链，
     所以**必须**把 css/style.css、css/legal.css、css/classic.css 的内容
     手动插进 head，`getComputedStyle` 才算得出宽度 / 内边距。 */
  const SHEETS = [css, legalCss, classicCss]
    .map(t => '<style>' + t.replace(/<\/style>/gi, '') + '</style>')
    .join('\n');
  /** 挂一份带样式的真页面（文件 → JSDOM 实例）。 */
  const styled = (markupOrFile, url) => {
    // 传进来的是文件名（真页面）时读文件；否则当成一段 HTML（合成样本）。
    const html = /^[\w./-]+\.html$/.test(markupOrFile) ? read(markupOrFile) : markupOrFile;
    const d0 = new JSDOM(html, { url: 'https://local.test' + url });
    d0.window.document.head.insertAdjacentHTML('beforeend', SHEETS);
    return d0;
  };

  /**
   * 数一数：从 body 到 el 之间，有几层**真的在水平方向上又缩进了一圈**的容器。
   *
   * 判据（任何一条成立即算一层）：
   *   · 盒子有左右内边距 —— 孩子可用的宽度因此比盒子窄；
   *   · 盒子有左右外边距 —— 盒子自己比父亲窄；
   *   · 盒子**声明过** max-width / width（收窄自己，例如 .app 的
   *     `max-width: var(--col-w)`）。
   * ⚠️ 第三条只在「声明过」时算：jsdom 对没声明的取空串，
   *    拿 `cs.width !== 'auto'` 当判据会把每个元素都数进来。
   */
  const insets = (win, doc, el) => {
    let n = 0;
    for (let p = el; p && p !== doc.body; p = p.parentElement) {
      const cs = win.getComputedStyle(p);
      const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const mar = parseFloat(cs.marginLeft) + parseFloat(cs.marginRight);
      const declared = cs.maxWidth !== '' || (cs.width !== '' && cs.width !== 'auto');
      if (pad > 0 || mar > 0 || declared) n += 1;
    }
    return n;
  };

  /* --------------------------------------------------------------------
     另一把尺（两版合并时保留下来的那个口径）：数一数这条路径上有几个 `.app`。
     --------------------------------------------------------------------
     ⚠️ 两版的判据各修了对方的一个盲点，所以这里**两把都留**：
        · `insets`（宽度 / 内边距那一支）—— 真机上「卡片比顶栏窄一条边」
          量到的就是这条边，写法换成 margin 也照样抓得住；
        · `appCountOf` —— `.app` 这个**类**在 DOM 里，与布局引擎无关，
          在任何 jsdom 里都量得准，是 `insets` 失效时的安全带。
     它们各守一句，两句都不是空的（下面每条断言都配了反面样本）。
     -------------------------------------------------------------------- */

  /* 数一数：从 body 到 el 之间套了几层 `.app`（「一列纸」的唯一载体）。
     ⚠️ 判据刻意用 `.app` 这个**类**、而不是量出来的宽度 / 内边距：
        前者在 DOM 里，量得准；后者要靠布局引擎，而 jsdom 只对**声明过的**
        宽度 / 内边距给得出值（没声明的取空串），量出来会漂。 */
  const appCountOf = (ddoc, el) => {
    let n = 0;
    for (let p = el; p && p !== ddoc.body; p = p.parentElement) {
      if (p.classList && p.classList.contains('app')) n += 1;
    }
    return n;
  };

  // 造一份「页面那条顶栏 + 一列纸 + 纸里的内容」的最小结构（与全站约定一致）。
  // ⚠️ 顶栏里要**真的**放上品牌区与右侧簇（品牌区 + `.top-slot` + 恒定锚点）——
  //    这就是 chrome.js 的 headerHtml 渲染出来的那一行。少了右侧簇，
  //    jsdom 里盒模型虽然算不出宽度，但「同一把尺子量到底」的前提就丢了：
  //    量点与被量点必须处在同一份真实结构上，否则这条断言问的不是它想问的事。
  // ⚠️ 合成样本里**顶栏与纸是兄弟**（都住在同一个 `.app` 里），这不是笔误：
  //      · `bar`（`.topbar`）自己就带一层 —— `max-width: var(--content-w)`；
  //      · `paper`（纸里的内容）不带，它那「一层」来自**共同的祖先** `.app`
  //        （`max-width: var(--col-w)` + 左右各一条 `--col-side` 的边）。
  //    所以两者数出来必然是「2 / 1」—— 差的就是顶栏自己那一条 --content-w。
  //    这一层想问的**不是**让这两个数相等，而是问「`paper` 那 1 层是不是
  //    **正好**就是 `--col-w` 那一层、没有再套第二层」——见下面 `paperN`。
  // ⚠️ 反面样本 `nested` 是在 `paper` 里**再套一层 `.app`**：这正是 #147
  //    的复发形态。`--col-w` / 左右各一条边会被算第二遍，必须被数出来。
  //    样本**必须挂上与真页面同一份样式表**（`styled()`），否则
  //    `max-width: var(--col-w)` 在 jsdom 里取到空串，宽度那一支就是哑的。
  const sample = styled('<div class="app">' +
    '<header class="topbar"><div class="brand"></div>' +
    '<span class="top-slot"></span><span class="top-user"></span></header>' +
    '<div class="paper"></div>' +
    '<div class="nested"><div class="app"></div></div>' +
    '</div>', '/library/');
  const sd = sample.window.document;
  const sw = sample.window;
  const bar = sd.querySelector('.topbar');           // 页顶那一行（自带 --content-w）
  const paper = sd.querySelector('.paper');          // 纸里的内容（不该再缩进一次）
  const leaf = sd.querySelector('.app');        // 一列纸那一层（缩进的唯一正当来源）
  const nested = sd.querySelector('.nested > .app');  // 误写的那种：又套一层 .app

  // ⚠️ 判据是「纸里的内容**正好**等于一列纸那一层」，不是与顶栏相等 ——
  //    顶栏天然多一层（它自己那条 --content-w），拿相等当判据是错的前提。
  chk(insets(sw, sd, paper) === insets(sw, sd, leaf),
    '纸里的内容正好只缩进一列纸那一层（实际 ' +
    insets(sw, sd, paper) + ' / ' + insets(sw, sd, leaf) + '）—— ' +
    '这一层是 .app 自己（--col-w），多出来的任何一层都是第二层 .app（#147）');
  chk(insets(sw, sd, bar) > insets(sw, sd, paper),
    '页顶那一行自带的 --content-w 不算「多套一层」（实际 ' +
    insets(sw, sd, bar) + ' > ' + insets(sw, sd, paper) + '）—— ' +
    '它是顶栏自己的列宽，不是纸里被算了两遍的那条边');
  // ⚠️ 上面那条是**相等**，而顶栏自己就带一层（max-width + margin: auto）——
  //    所以「真页面」那几条写成 `<=` 时，纸里多套一层也能凑出 2 <= 2 蒙混过去。
  //    真页面过的这把尺要更严：内容的缩进层数必须**正好**等于一列纸那一层，
  //    多出来的任何一层都是 #147。
  // ⚠️ 两版这一条都写着「反面样本必须被数出来」，只是**量法相反**：
  //    一边用 `insets`（宽度 / 内边距），一边用 `.app` 层数（DOM）。
  //    两把尺子管两件事，所以两条都留下，各自配自己的反面样本：
  //      · `insets` 那一支：样本挂了样式表，`.app` 的
  //        `max-width: var(--col-w)` 在 jsdom 里真的量得出来 ——
  //        「再套一层会多算一层」这句话在这一支上是真的；
  //      · `appCountOf` 那一支：与布局引擎无关，所以在任何 jsdom 里
  //        都量得准，是上一支**万一**又变哑时的安全带。
  // 反面样本一：纸里再套一层 .app（max-width: var(--col-w) 又算一遍）
  chk(insets(sw, sd, nested) > insets(sw, sd, paper),
    '纸里再套一层 .app 会被数出来（实际 ' +
    insets(sw, sd, nested) + ' > ' + insets(sw, sd, paper) + '）—— ' +
    '这条是 #147 的复发线，量不出来这层守卫就是空的');
  // 反面样本二：同一件事换算 `.app` 层数，必须正好多一个
  chk(appCountOf(sd, nested) === appCountOf(sd, paper) + 1,
    '反面样本换个口径也对得上：纸里多套一层 .app → 多算一个（实际 ' +
    appCountOf(sd, nested) + ' / ' + appCountOf(sd, paper) + '）—— ' +
    '这一支与布局引擎无关，保证上面那把尺子不是哑的');
  // 同一路径上的两个量点必须落在同一份结构上（顶栏住在纸里，不在纸外）
  chk(appCountOf(sd, bar) === appCountOf(sd, paper),
    '页顶那一行与纸里的内容处在同一层 .app 上（实际 ' +
    appCountOf(sd, bar) + ' / ' + appCountOf(sd, paper) + '）—— ' +
    '量点与被量点共用一个祖先，两个数才可比');

  // 真正的页面也要过同一把尺
  for (const [file, url, sel] of [
    ['library/index.html', '/library/', '.toolbar'],
    ['poems/index.html', '/poems/', '.toolbar'],
    ['settings/index.html', '/settings/', '#settings-index']
  ]) {
    const d2 = styled(file, url);
    const dd = d2.window.document;
    const box = dd.querySelector(sel);
    // 两把尺子都量：「宽度 / 内边距缩进」（insets）与 `.app` 层数（appCountOf）。
    // ⚠️ 原先这里量的是「宽度 / 内边距缩进」，而那把尺子在**没挂样式表**的
    //    jsdom 里量不到任何东西（详见 `insets` 的注释）。现在样本走 `styled()`
    //    把样式表真的挂进去了，两把尺子才都量得准 —— 于是两条都留下来，
    //    一条守「缩进正好等于一列纸那一层」，一条守「一个 `.app` 都没多套」。
    const n = insets(d2.window, dd, box);
    const m = insets(d2.window, dd, dd.querySelector('.topbar'));
    // 一列纸（.app）那一层：全站唯一一个有权收窄宽度的盒子
    const paperN = insets(d2.window, dd, dd.querySelector('.app'));
    const na = appCountOf(dd, box);
    const ma = appCountOf(dd, dd.querySelector('.topbar'));
    chk(n <= m,
      file + ' 里 ' + sel + ' 套的 .app 不多于页顶那一行（实际 ' + n + ' / ' + m + '）—— ' +
      '页顶与内容必须落在同一条竖轴上');
    chk(n === paperN,
      file + ' 里 ' + sel + ' 的缩进层数正好等于一列纸那一层（实际 ' + n + ' / ' + paperN + '）—— ' +
      '多出来的一层就是第二层 .app，卡片会比顶栏窄一条边（#147）');
    // 同一件事换算 `.app` 层数：页顶上下的内容必须套一样多的纸
    chk(na === ma,
      file + ' 里 ' + sel + ' 套的 .app 与页顶那一行一样多（实际 ' + na + ' / ' + ma + '）—— ' +
      '多出来的一层 .app 就是把「一列纸」的宽度算了两次（#147）');
    // ⚠️ 反面样本：给内容自己再套一层 .app（源码断言抓不到的那种写法），
    //    上面两条必须变红 —— 否则它们只是「数出来总是 1」的空规则。
    //    （2026-09-15：上一版恒红正是因为判据把每个元素都数成一层，
    //      红与绿都与 DOM 无关；这里把「这把尺子真的有牙」写进断言。）
    const probe = dd.createElement('div');
    probe.className = 'app';
    box.appendChild(probe);
    chk(appCountOf(dd, probe) === ma + 1,
      file + ' 的反面样本被数出来了（给内容多套一层 .app → ' + appCountOf(dd, probe) +
      ' / 页顶 ' + ma + '）—— 这把尺子不是空的');
    // ⚠️ 探针只加不改：量完就摘掉，别把被测页面留在改动过的状态里。
    probe.remove();
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
  chk(/\.top-slot \+ \.top-user,[\s\S]{0,200}\.top-act-spacer[\s\S]{0,120}margin-left:\s*var\(--top-gap\)/.test(cssCode),
    '槽与恒定锚点之间的间距只有一个来源（--top-gap）');

  // 阅读器那条顶栏的恒定锚点（Issue #147 后续）：一枚**不可见占位**，与头像同径。
  // 原先那里是一枚「翻开的这一册」（.top-slot-mark / GLYPHS.reader），
  // 用户 2026-09-15 二次确认「删除详情页中右上角书一样的图标」—— 书撤了，
  // 但像素位仍得占住，否则「合上」会横跳 50px。
  const spacerRule = ruleOf(cssCode, '.top-act-spacer');
  chk(/width:\s*var\(--top-slot\)/.test(spacerRule) &&
    /height:\s*var\(--top-slot\)/.test(spacerRule),
    '阅读器里的恒定锚点与头像同径（返回键因此原地不动，不横跳 50px）');
  chk(/isReader[\s\S]{0,300}'<span class="top-act-spacer"/.test(chromeJs),
    '阅读器那条顶栏由 chrome.js 补上这一枚不可见占位（书撤了，像素位仍占住）');
  chk(!/\.top-slot-mark/.test(cssCode),
    '样式表里不再留 `.top-slot-mark` 规则（僵尸规则会误导下一个改样式的人）');
  chk(!/GLYPHS\.reader/.test(chromeJs.replace(/\/\/[^\n]*/g, ' ')),
    '那枚「书」图标（GLYPHS.reader）连同定义一起删掉，不留没人用的图形');

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

/* ==========================================================================
   十一、详情页里不许再冒出「读了 N / M 篇 / 首」这类读数
   --------------------------------------------------------------------------
   用户原话（2026-09-15）：「删除所有详情页中的 0 / 167 篇及类似的」。

   这一枚数在 Issue #147 里走过两站：先由**页顶那一行**挪进**详情页状态栏**
   （朝代 · 作者 · 出处 · N / M 首，同一行），用户看过之后仍嫌它占地方，
   于是连状态栏那一枚也一起撤了。读了多少改在两处看：列表页每条自己的已读标记，
   与 /progress/ 那页总览；详情页上真正属于「这一篇」的是「读第几篇」，
   由正文里的「上一篇 / 下一篇」表达。

   这一段守的是**源码层面**的那条线，三件事：
     ① 引擎不再生成 .rd-count 节点；
     ② 样式表里不再留 .rd-count 规则（留着的唯一后果是下一个人以为还有一枚）；
     ③ 真页面的 HTML 里 #rd-meta 那一段不再写死任何读数。
   —— 与各集子测试里那几条「渲染出来没有这一枚」的断言合起来，
      源码与渲染两头都堵上：只堵一头的话，换一种写法就漏了。
   ========================================================================== */
const PAGE_FILES = ['classic/index.html', 'guwen/index.html', 'songci/index.html',
  'tangshi/index.html', 'zhaoming/index.html', 'poems/index.html',
  'library/index.html', 'search/index.html'];
const engineJs = read('js/reader-core.js');

chk(!/<span class="rd-count"/.test(engineJs) && !/createElement\("span"\)[\s\S]{0,80}rd-count/.test(engineJs),
  '引擎不再生成 .rd-count 那一枚已读读数（详情页里没有这一枚了）');
chk(!/\.rd-count\s*[,{]/.test(classicCss),
  '样式表里不再留 .rd-count 规则（不是「留着但没人用」）');
// 反向样本：判据本身得是有牙的 —— 拿一段真的写着读数的 HTML 试一下
chk(/\d\s*\/\s*\d+\s*(篇|首)/.test('<span class="rd-count">0 / 167 篇</span>'),
  '那段正则真的能抓到「0 / 167 篇」（这把尺子不是空的）');
PAGE_FILES.forEach(f => {
  const html = read(f);
  // 只取详情页状态栏那一段（#rd-meta 所在的那个 div），别把整页正文误伤
  const m = /<div class="meta rd-meta" id="rd-meta">([^]*?)<\/div>/.exec(html);
  chk(!!m, f + ' 的详情页状态栏节点还在（撤的是读数，不是这一行本身）');
  chk(!!m && !/\d\s*\/\s*\d+\s*(篇|首)/.test(m[1]),
    f + ' 的详情页状态栏里不写死任何「N / M 篇 / 首」读数（实际「' + (m ? m[1] : '') + '」）');
});
// 页顶那一条也不许冒出来 —— 六部集子 + 课外阅读入口页 + 搜索页
['classic/index.html', 'guwen/index.html', 'songci/index.html', 'tangshi/index.html',
 'zhaoming/index.html', 'poems/index.html', 'library/index.html', 'search/index.html'].forEach(f => {
  const m = /<header class="topbar">([^]*?)<\/header>/.exec(read(f));
  chk(m && !/count-badge|\d\s*\/\s*\d+\s*(篇|首)/.test(m[1]),
    f + ' 的页顶那一行不挂任何读数（Issue #147 撤干净，不留死节点）');
});

/* ==========================================================================
   十二、顶栏返回键**不能全删**：这三处它是唯一的出口
   --------------------------------------------------------------------------
   Issue #147 里用户问：「我后来想，手机界面我们需要标题栏中的后退按钮吗？
   如果不需要，是不是可以全部删除？」
   答案是不能全删 —— 有一条硬性的结构约束把它钉住，且**只有三处**：

     · 阅读器是全屏沉浸层（position: fixed; inset: 0; z-index: 66），
       比底部页签（z-index: 65）高一层。开着阅读器时，页签整个被盖住点不到，
       于是顶栏那颗「合上」就是**唯一**的出口；
     · 阅读器**不写 history**（全站无 pushState / #read），
       所以手机的浏览器返回手势在 PWA 独立窗口里回不到「列表」这一层；
       桌面还能按 Esc，手机没有 Esc。
     · 另外六页刻意关掉页签（body data-dock="off"）：登录 / 个人中心 /
       管理后台 / 层级对比 / 用户协议 / 隐私条款 —— 它们没有页签可回，
       顶栏那颗「返回」是唯一的上一层。

   反过来，**有页签的页**（首页 / 课外阅读 / 六个集子 / 搜索 / 设置 / 进度）
   返回键确实与页签重复 —— 但保留它有三个理由，所以这一轮**不动**：
     · 深一层的地方它指向的不是页签那一格（设置的四张二级页 data-back 回设置主页，
       不是回首页）；
     · 手机上的拇指够不到页签时，右上角那颗仍是最短的退路；
     · 删掉它要同时改「右侧簇只放头像」的布局口径，收益不抵风险。

   这一节**不测「有没有返回键」**（那是功能选择），只把上面那几条
   **结构约束**钉住：约束一旦被改（阅读器不再全屏 / 页签不再被盖 /
   那六页重新装上页签），这条结论就该被重新评估 —— 那时这几条断言会先红。 */
(function backButtonIsIndispensable() {
  // ① 阅读器全屏且高于页签：开着时页签点不到，「合上」是唯一出口
  const readerRule = ruleOf(classicCode, '.reader');
  chk(/position:\s*fixed/.test(readerRule) && /inset:\s*0/.test(readerRule),
    '阅读器是全屏层（fixed + inset:0）—— 所以它必须自带一枚出口');
  const readerZ = /z-index:\s*(\d+)/.exec(readerRule);
  const dockZ = /z-index:\s*(\d+)/.exec(ruleOf(cssCode, '.dock'));
  chk(!!readerZ && !!dockZ && Number(readerZ[1]) > Number(dockZ[1]),
    '阅读器（z-index ' + (readerZ ? readerZ[1] : '?') + '）压在底部页签（z-index ' +
    (dockZ ? dockZ[1] : '?') + '）之上 —— 页签在阅读器里点不到，' +
    '顶栏那颗「合上」是唯一的出口');

  // ② 阅读器不写 history：手机的浏览器返回手势回不到列表那一层
  const readerJs = read('js/reader-core.js');
  chk(!/pushState|replaceState/.test(readerJs.replace(/\/\/[^\n]*/g, ' ')),
    '阅读器不往 history 里压栈（没有浏览器返回键可关它）—— 所以要用界面上的那一颗');
  chk(/keydown[\s\S]{0,200}Escape/.test(readerJs),
    '桌面还能按 Esc 合上（手机没有 Esc —— 这正是手机更要那颗按钮的原因）');

  // ③ 六页刻意关掉页签：它们没有页签可回，返回键是唯一的上一层
  const DOCKLESS = ['login/index.html', 'profile/index.html', 'admin/index.html',
    'plans/index.html', 'terms/index.html', 'privacy/index.html'];
  DOCKLESS.forEach(f => {
    chk(/data-dock="off"/.test(stripHtml(read(f))),
      f + ' 关着底部页签（data-dock="off"）—— 它只能靠顶栏那颗返回键上一层');
  });
  // 反向：有页签的页不该关页签，否则「页签是退路」这条前提也塌了
  ['search/index.html', 'settings/index.html', 'library/index.html'].forEach(f => {
    chk(!/data-dock="off"/.test(stripHtml(read(f))),
      f + ' 有页签（页签是它的退路之一）');
  });
})();

/* ==========================================================================
   十三、开关：外观与尺寸只有一个来源，且真的画得出来（Issue #163）
   --------------------------------------------------------------------------
   用户原话：「跨设备同步选择框太丑了，改进。」

   旧样子是浏览器默认的 `<input type=checkbox>`：一颗 13px 的方框，
   白底、灰勾、圆角 2px —— 与全站的纸面 / 描金细线 / 深绿实底是两套语言；
   状态还要靠旁边一颗写着「关」/「开」的文字来表达。

   新样子是自绘的胶囊开关：深天青实底 = 开着（与「年级」那些药丸同一句
   「实底 + 米白 + 金线」）、纸底描边 = 关着、圆滑块在轨道里走。

   这一节守三件事：
     ① 外观自绘（appearance: none），不吃各浏览器默认样式；
     ② 尺寸只有一份（轨道 40×24 / 滑块 18 / 左 2），**且行程是按这三个值算的**——
        写死一个 translateX 而不跟着尺寸走，改一次尺寸滑块就会越界；
     ③ 真渲染出来确实是这个尺寸、滑块确实在轨道里（不是只在源码里写着）。
   ========================================================================== */
{
  const box = ruleOf(cssCode, '.switch-input');
  chk(/appearance:\s*none/.test(box),
    '开关外观自绘（appearance: none）—— 各浏览器给不出两样的方框');

  /* 尺寸：先从声明里读出来，再用它算行程，最后拿渲染结果核对。
     ⚠️ 三处判据共用同一组数值：换尺寸时这三条要么一起绿、要么一起红，
        不会出现「尺寸改了、行程断言还在守旧值」那种过期守卫。 */
  const px = (src, prop) => {
    const m = new RegExp(prop + ':\\s*([\\d.]+)px').exec(src);
    return m ? Number(m[1]) : NaN;
  };
  const trackW = px(box, 'width'), trackH = px(box, 'height');
  const knob = ruleOf(cssCode, '.switch-track');
  const knobW = px(knob, 'width');
  const left = px(knob, 'left');
  chk(trackW > 0 && trackH > 0 && knobW > 0,
    '开关的轨道 / 滑块尺寸写在一条规则里（轨道 ' + trackW + '×' + trackH +
    '、滑块 ' + knobW + '）');

  /* 行程 = 轨道宽 − 边框×2 − 滑块宽 − 起点×2。
     开着时滑块应当走到「右端对齐」——写死 16px 而尺寸一改就越界，
     所以这里判的是**算出来的值**，不是源码里有没有 16 这个数字。 */
  const onKnob = ruleOf(cssCode, '.switch-input:checked + .switch-track');
  const shift = (/-?translateX\((\d+)px\)/.exec(onKnob) || [])[1];
  const borderW = Number((/border:\s*([\d.]+)px/.exec(box) || [])[1]);
  const expect = trackW - 2 * borderW - knobW - 2 * left;
  chk(Number(shift) === expect,
    '滑块的行程与尺寸同源（轨道 ' + trackW + ' − 边框 ' + borderW + '×2 − 滑块 ' +
    knobW + ' − 起点 ' + left + '×2 = ' + expect + '，源码写的 ' + shift + '）');

  /* 开 / 关两种状态必须是**两种颜色**：全站「选中」都是深天青实底 + 描金内边 */
  const onTrack = ruleOf(cssCode, '.switch-input:checked');
  chk(/background:\s*var\(--green\)/.test(onTrack),
    '开着 = 深天青实底（与全站选中态同一个令牌）');
  chk(/box-shadow:\s*inset[^;]*240,\s*205,\s*124/.test(onTrack),
    '开着时带描金内边（与药丸 / 主按钮同一手法）');
  chk(/background:\s*var\(--card\)/.test(box) || /background:\s*var\(--card-2\)/.test(box),
    '关着 = 纸底（不是浏览器默认的白底方框）');

  /* 置灰：服务端未开放同步时开关不可点，但**不许**长得和「关着能点」一样 */
  const offTrack = ruleOf(cssCode, '.switch-input:disabled');
  chk(/cursor:\s*not-allowed/.test(offTrack) && /background:/.test(offTrack),
    '置灰态有自己的一句（不可点的开关与「关着但能点」必须看得出不同）');

  /* 原生结构：轨道是 input 的**紧邻兄弟**（CSS 用 `+` 找它，不用 :has()——
     :has() 在老的安卓 WebView 上会静默失效，失效后开关就变成一块空轨） */
  chk(!/:has\(/.test(box) && !/:has\(/.test(knob),
    '开关的样式不依赖 :has()（老 WebView 上会静默失效）');

  /* 页面结构：同样的 HTML 也只有一个来源 —— 设置页那一项 */
  const genHtml = read('settings/general/index.html');
  chk(/class="switch"[\s\S]{0,400}class="switch-input"[\s\S]{0,200}class="switch-track"/.test(genHtml),
    '设置页的开关是 <label.switch> 包着 input 与轨道（点文字 = 点开关）');
  chk(/id="toggle-sync"[\s\S]{0,200}role="switch"/.test(genHtml),
    '开关带 role="switch"（读屏念得出「开关」，而不是「复选框」）');
  chk(!/id="sync-label"/.test(genHtml),
    '旧的那颗「关」/「开」文字标签已经拿掉（状态由开关本体表达）');

  /* 真渲染：把样式表挂进去，量一遍画出来的结果 —— 上面全是源码断言，
     换一种写法（例如给 track 一条 margin）源码看不出来，用户看到的却不对。 */
  if (!JSDOM) {
    console.log('(未安装 jsdom，跳过「开关真的画得出来」的真实渲染断言 —— npm i jsdom 可启用)');
  } else {
    const sheet = '<style>' + css.replace(/<\/style>/gi, '') + '</style>';
    const d = new JSDOM(genHtml, { url: 'https://local.test/settings/general/' });
    d.window.document.head.insertAdjacentHTML('beforeend', sheet);
    const win = d.window, doc = win.document;
    const input = doc.getElementById('toggle-sync');
    chk(!!input, '设置 · 通用里能取到那颗同步开关');
    if (input) {
      const cs = win.getComputedStyle(input);
      chk(cs.width === trackW + 'px' && cs.height === trackH + 'px',
        '画出来的轨道就是声明的尺寸（' + cs.width + '×' + cs.height + '）');
      chk(cs.borderRadius === '999px',
        '轨道是胶囊（画出来的圆角 999px，不是方框）');
      const knobEl = input.nextElementSibling;
      chk(!!knobEl && knobEl.classList.contains('switch-track'),
        '轨道是 input 的紧邻兄弟（CSS 的 `+` 才找得到它）');
      if (knobEl) {
        const kcs = win.getComputedStyle(knobEl);
        chk(kcs.width === knobW + 'px', '滑块也是声明尺寸（' + kcs.width + '）');
        /* 滑块必须在轨道里：左起点 + 滑块宽 ≤ 轨道宽 —— 越界就是「画歪了」 */
        const l = parseFloat(kcs.left) || 0;
        chk(l + knobW <= trackW,
          '滑块落在轨道内（起点 ' + l + ' + 滑块 ' + knobW + ' ≤ 轨道 ' + trackW + '）');
      }
    }
  }
}

/* ==========================================================================
   七、页脚 + 危险按钮：一处定义、全站一样（Issue #163）
   --------------------------------------------------------------------------
   用户原话：
     「我看到设置里无数啰啰嗦嗦的段落及解释，无法容忍。我看到重复的发邮件框，
       发现重复的注册按钮…… 保持页面元素的统一，ui 一致性等等。」

   这一段守的是「统一」那一半里**能判的两类**：
     · 页脚：版权 + 法务链接的样式只有一个来源 ——
       原先法务两页写的是 `.foot`、其余九页写的是 `.foot settings-foot`，
       同一个组件两种写法，改一处另一处不会跟着走；
     · 危险色：不可逆动作（清空进度 / 注销账号）的底色与描边只有一个来源 ——
       原先 .danger-btn 与 .account-btn.danger 各自写了一遍相同色值。
   ========================================================================== */
{
  // ① 页脚：十一张挂页脚的页面用同一个类名（不允许再出现裸 .foot）
  const FOOT_PAGES = ['settings/index.html', 'settings/general/index.html',
    'settings/recite/index.html', 'settings/lists/index.html', 'settings/reader/index.html',
    'login/index.html', 'profile/index.html', 'admin/index.html', 'plans/index.html',
    'terms/index.html', 'privacy/index.html'];
  FOOT_PAGES.forEach(f => {
    chk(/<footer class="foot settings-foot">/.test(read(f)),
      f + ' 的页脚是同一套写法（class="foot settings-foot"）');
  });
  chk(!/<footer class="foot">/.test(read('terms/index.html') + read('privacy/index.html')),
    '法务两页不再用裸 .foot（与其余九页同一条规则）');

  // ② 危险色：只有一个来源，两处按钮都读它
  const rootRule = ruleOf(cssCode, ':root');
  chk(/--danger-bg:\s*#[0-9a-f]{6}/.test(rootRule) && /--danger-line:\s*#[0-9a-f]{6}/.test(rootRule),
    '危险色令牌 --danger-bg / --danger-line 在 :root 里定义（全站唯一来源）');
  chk(/var\(--danger-line\)/.test(ruleOf(cssCode, '.danger-btn')) &&
      /var\(--danger-bg\)/.test(ruleOf(cssCode, '.danger-btn')),
    '设置页的 .danger-btn 读危险色令牌（不再写死 #ecd2cd）');
  // ⚠️ 与上面同一把尺子：account.css 的那条规则夹在大段注释之间，
  //    不先剥注释就会把注释里的 `{` 当成规则边界（ruleOf 会返回空串）。
  chk(/var\(--danger-line\)/.test(ruleOf(strip(accountCss), '.account-btn.danger')) &&
      /var\(--danger-bg\)/.test(ruleOf(strip(accountCss), '.account-btn.danger')),
    '账号页的 .account-btn.danger 读同一条危险色令牌（两种页面同一个底色）');
  // 反向：两处都不许再写死那一对色值（写死的那一刻，「一处定义」就退回巧合）
  const dangerWriters = (cssCode + '\n' + accountCss).replace(/^\s*:root\s*\{[\s\S]*?\}/m, '');
  chk(!/#ecd2cd/.test(dangerWriters.replace(/\/\*[\s\S]*?\*\//g, ' ')),
    '除 :root 外没有第二处写死 #ecd2cd（危险按钮的描边只有一个来源）');
}


/* ==========================================================================
   Issue #163 续：页脚横线 / 链接下划线 / 开关样式
   ==========================================================================
   用户原话：「©2026 kuibu.app 积跬步, 至千里 上面的横线删除，
   有些页面链接样式不对，甚至还有下划线那么丑。」

   这一段守三件事，每一件都是**「这类元素出现了几次」的判据**，
   不是「某个 id 在不在」—— 免得哪天换个写法又悄悄长回来：

     1. 页脚与正文之间不再画那条 `border-top`；
     2. 全站**所有** <a> 都不长下划线（不是某一处去掉、另一处忘了写）；
     3. 同步开关那三个类名真的被样式表接管了（不许只有 HTML 没有 CSS）。
   ========================================================================== */
{
  // ① 页脚上面的横线：.settings-foot 不许再声明 border-top
  chk(!/border-top/.test(ruleOf(cssCode, '.settings-foot')),
    '页脚 .settings-foot 不再画上边框（「©2026 kuibu.app」上面那条横线已删）');
  chk(/padding-top/.test(ruleOf(cssCode, '.settings-foot')),
    '页脚与正文之间的间距改用留白表达（padding-top 还在）');

  // ② 链接下划线：全局唯一一条默认，且是 none
  chk(/a\s*\{[^}]*text-decoration:\s*none/.test(cssCode),
    '全局 `a { text-decoration: none }` 存在（全站唯一一条「不给下划线」的默认）');
  // 反向：页脚链接 hover 时也不许把下划线加回来（原先就是 hover 加回来的）
  const footRule = ruleOf(cssCode, '.foot-links a:hover');
  chk(/text-decoration:\s*none/.test(footRule) || !/text-decoration/.test(footRule),
    '页脚链接 hover 不再把下划线加回来（反馈只走颜色一档）');
  // 反向：正文里那几个没类名的链接（个人中心「查看」）归了本页的配色规则
  // ⚠️ 判的是「有自己的颜色」而不是「有 text-decoration: none」——
  //    下划线那件事现在只有全局一条规则在管，本页再写一遍反而是第二个来源。
  chk(/\.kv-v a\s*\{[^}]*color:\s*var\(--green\)/.test(strip(accountCss)),
    '个人中心「关于」里的「查看」链接有自己的配色规则（不再是浏览器默认的蓝紫链接）');
  // 反向：全站样式表里再没有一条 `text-decoration: underline`
  //（那条「链接默认长下划线」的行为已由全局规则统一去掉；按钮样的「重新发送」
  //  也改走加粗 + 天青，与链接同一套语言）
  const underlines = (cssCode + '\n' + accountCss + '\n' + legalCode)
    .match(/text-decoration:\s*underline/g) || [];
  chk(underlines.length === 0,
    '全站样式表里没有一条 `text-decoration: underline`（实际 ' + underlines.length + ' 条）');
  // 反向：六处「各写一遍 text-decoration: none」已收归全局那一条
  //（这一条守的是「别再长回来」：除全局规则外，其余文件里不许再出现它）
  const noneWriters = (cssCode.replace(/^[^\n]*\ba\s*\{[^}]*text-decoration:\s*none[^}]*\}[^\n]*$/m, '')
    + '\n' + strip(classicCss) + '\n' + strip(legalCss) + '\n' + strip(accountCss))
    .match(/text-decoration:\s*none/g) || [];
  chk(noneWriters.length <= 1,
    '除全局那条外，各页面文件里不再各写一遍 text-decoration: none（实际 ' + noneWriters.length + ' 条）');

  // ③ 同步开关：HTML 里写的类名，样式表里必须真的存在
  //
  // ⚠️ HTML 只用 .switch（整行，含 <label> 语义）/ .switch-input（真实输入框）
  //    / .switch-track（可见的胶囊轨道）三个 —— 后两者由最后的「开关（跨设备同步）」
  //    那一节定义，**各只有一条规则**。
  //    原先这里还钉着 .switch-row 与 .switch-label：这两个类名在 HTML 里早已
  //    无人使用（它们属于旧版「并排的轨道 + 关/开 文字标签」），样式表里却
  //    还留着一整节 —— 于是 .switch-input / .switch-track 被先后定义两遍
  //    （CSS 层叠取后者），真实几何与源码里量到的不一致。那一节既已删除，
  //    这两条断言也就失去了对象。
  ['switch', 'switch-track', 'switch-input'].forEach(cls => {
    chk(new RegExp('\\.' + cls + '\\s*[,{]').test(cssCode),
      '开关的 .' + cls + ' 在样式表里有规则（HTML 写了就得画出来）');
  });
  // 旧结构（并排的「关 / 开」文字标签）的遗留类名：结构已在 1B 期换成
  // .switch > input + .switch-track，样式与类名一起删干净 ——
  // 留着无人使用的规则，下一个改样式的人会以为它还在某页上画着。
  ['switch-row', 'switch-label'].forEach(cls => {
    chk(!new RegExp('\\.' + cls + '\\s*[,{]').test(cssCode),
      '样式表里不再留 .' + cls + ' 规则（没人用的类名不留僵尸规则）');
  });
  // 「开」/「未开放」两态：CSS 用相邻兄弟选择器 `.switch-input:checked + .switch-track`
  // 与 `.switch-input:disabled + .switch-track`（不用 :has()，老 WebView 上会静默失效）。
  // ⚠️ 正则里要带上 `.switch-input` 这个**宿主类名**：只写 `input:checked + ...`
  //    会连 `body[data-x] input:checked + .switch-track` 那种别的写法一起放过，
  //    判不出这条相邻选择器找的到底是不是这颗开关。
  chk(/\.switch-input:checked\s*\+\s*\.switch-track\s*\{/.test(cssCode),
    '开关的「开」态由 .switch-input:checked + .switch-track 表达（不是靠原生 checkbox）');
  chk(/\.switch-input:disabled\s*\+\s*\.switch-track/.test(cssCode),
    '开关的「未开放」态也有样式（置灰，不是原生 disabled 的样子）');
  // 真实输入框留着（键盘 / 读屏要用），只是不再是**看得见的那只盒子**。
  // ⚠️ 「不可见」有两种成立写法：`opacity: 0`（透明覆盖层），或
  //    `appearance: none` 之后自己把背景 / 边框收掉再画。这里判的是结果，
  //    只钉 `opacity: 0` 会把「自绘但保留 input」的实现误判为回归。
  {
    const inpDecl = ruleOf(cssCode, '.switch-input');
    chk(/opacity:\s*0\b/.test(inpDecl) ||
        (/appearance:\s*none/.test(inpDecl) && /background:/.test(inpDecl)),
      '.switch-input 不再是看得见的那只盒子（透明覆盖层，或外观自绘）—— 不删 input，键盘与读屏照旧');
  }
  // 两只盒子各自把 width / height 写全 ——
  // ⚠️ 判的是「两侧的盒子都量得出来」，**不是**「两者同尺寸」：
  //    旧版里 .switch-input 自己就是可见的轨道本体、透明层是另一只 span，
  //    所以当时要求两者同值；现在可见的轨道是 .switch-track，
  //    .switch-input 只剩 opacity:0 + position:absolute（不参与布局），
  //    再要求同值就是拿旧形状的尺子量新结构。
  const sizeOf = (code, sel) => {
    const decl = ruleOf(code, sel);
    const w = /(?:^|[;{\s])width:\s*([^;]+)/.exec(decl);
    const h = /(?:^|[;{\s])height:\s*([^;]+)/.exec(decl);
    return { w: w ? w[1].trim() : '', h: h ? h[1].trim() : '' };
  };
  const trk = sizeOf(cssCode, '.switch-track');
  chk(!!trk.w && !!trk.h,
    '可见的轨道 .switch-track 把尺寸写全（' + trk.w + '×' + trk.h + '）—— 点哪儿就是哪儿');
}

/* ==========================================================================
   十二、开关真的画出来了（Issue #163，真实渲染几何）
   --------------------------------------------------------------------------
   用户原话：「跨设备同步选择框太丑了，改进。」
   丑的根因是**没有样式**：HTML 从 1B 起就用 .switch-row / .switch-track /
   .switch-label 三个类名写着结构，样式表里却一条都没有 ——
   于是那颗 <input type=checkbox> 一直以浏览器原生的样子露在纸面上。

   上面第 ⑨ 段判的是「样式表里有没有这几条规则」；这一段判的是**画出来的结果**：
   那三个 span 真的被挂上、真的在一个 flex 行里、真的不是 display:none。
   两段合起来才闭环 —— 只判源码，把 display:none 写进去也是绿的。
   ========================================================================== */
if (JSDOM) {
  const doc = new JSDOM(read('settings/general/index.html'),
    { url: 'https://local.test/settings/general/' }).window.document;
  // 结构（对照 settings/general/index.html）：
  //   <label class="switch"><span class="settings-label" id="switch-sync-name">名字</span>
  //     <input class="switch-input" id="toggle-sync">  <span class="switch-track"></span>
  //   </label>
  // ⚠️ 项名写在 input **之前**、轨道写在 input **之后**，所以三样不是连成一串。
  //    原先这里按「input → 轨道 → 状态字」的顺序判、又要求状态字是
  //    `<span class="switch-label">` —— 那是旧版「名字 + 轨道 + 关/开 文字」的
  //    形状；状态字已撤（状态由开关本体表达），项名改用 .settings-label。
  const box = doc.querySelector('.switch');
  const input = doc.getElementById('toggle-sync');
  const track = doc.querySelector('.switch-track');
  chk(!!box && !!input && !!track, '开关的 input / 轨道两样都在 DOM 里');
  const name = doc.getElementById('switch-sync-name');
  chk(!!name && !!name.textContent.trim(), '开关的项名在 DOM 里（读屏靠 aria-labelledby 取它）');
  chk(!!box && box.tagName === 'LABEL',
    '两样包在同一个 <label.switch> 里（点名字与轨道任意处都切得动，iOS 上也是）');
  chk(!!box && box.contains(name) && box.contains(input) && box.contains(track),
    '项名 / input / 轨道在同一个 .switch 行里（不是散在页面上）');
  // 相邻：input 的下一个兄弟节点就是轨道 ——
  // CSS 的 `.switch-input:checked + .switch-track` 靠的就是这个相邻关系。
  chk(!!input && input.nextElementSibling === track,
    'input 紧邻轨道（`:checked + .switch-track` 这条相邻选择器才对得上）');
} else {
  console.log('- (未安装 jsdom，跳过开关的真实渲染几何一节)');
}

console.log(fails === 0 ? '\n🎉 UI 一致性 / 响应式守卫全部通过' : '\n❌ ' + fails + ' 项失败');
process.exit(fails ? 1 : 0);
