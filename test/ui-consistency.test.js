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
chk(/width:\s*36px/.test(cssCode) && /height:\s*36px/.test(cssCode),
  '列表播放键 36px 是全站同一档（36px × 36px）');

/* 序号圆与条目标题同高：两处都读 --item-num，不同源就会「圆比字大一圈」 */
const numRule = ruleOf(cssCode, '.item-num');
chk(/--item-num:\s*16\.5px/.test(numRule),
  '序号圆直径走 --item-num（与条目标题 16.5px 同源，不是各写一个数）');
const titleRule = ruleOf(cssCode, '.item-title');
chk(/font-size:\s*16\.5px/.test(titleRule),
  '条目标题 16.5px 与序号圆同一档');

/* 圆键三档（36 / 30 / 26）—— 每一档都写在**同一个文件**里，
   不允许某一页给同名控件另开一个尺寸 */
["36px", "30px", "26px"].forEach(sz => {
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
chk(/\.dock-inner\s*\{[^}]*max-width:\s*720px/s.test(cssCode),
  '页签内层有 720px 上限（与内容区同宽，四格不会被拉成巨板）');
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
chk(/max-width:\s*720px/.test(appRule), '内容区列宽仍是 720px');
chk(/max-width:\s*720px/.test(ruleOf(cssCode, '.topbar')),
  '顶栏列宽与内容区同值（720px）');
chk(/width:\s*720px/.test(ruleOf(classicCode, '.reader-body')),
  '阅读器正文列宽与内容区同值（720px）');
chk(/max-width:\s*720px/.test(ruleOf(cssCode, '.dock-inner')),
  '页签内层与内容区同值（720px）');

/* ==========================================================================
   三之二、顶栏在任何容器里都必须占满容器宽（不许被内容顶宽）
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

/* ==========================================================================
   四、各页顶栏结构一致（同一套 chrome 渲染）
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

console.log(fails === 0 ? '\n🎉 UI 一致性 / 响应式守卫全部通过' : '\n❌ ' + fails + ' 项失败');
process.exit(fails ? 1 : 0);
