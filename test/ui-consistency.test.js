const fs = require('fs');
const path = __dirname + '/../';

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

const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ');

const stripHtml = t => t.replace(/<!--[\s\S]*?-->/g, ' ');
const cssCode = strip(css);
const classicCode = strip(classicCss);
const legalCode = strip(legalCss);

function ruleOf(src, sel) {
  const flat = src.replace(/@media[^{]+\{/g, '{');

  const decls = [];
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(flat))) {
    const sels = m[1].split(',').map(x => x.trim());
    if (!sels.includes(sel)) continue;
    m[2].split(';').forEach(d => {
      if (d.trim()) decls.push(d.trim());
    });
  }

  const last = new Map();
  const order = [];
  decls.forEach(d => {
    const name = d.split(':')[0].trim().toLowerCase();
    if (!last.has(name)) order.push(name);
    last.set(name, d);
  });
  return order.map(n => last.get(n)).join(';');
}

function ruleSegments(src, sel) {
  const flat = src.replace(/@media[^{]+\{/g, '{');
  const out = [];
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(flat))) {
    const sels = m[1].split(',').map(x => x.trim());
    if (sels.includes(sel)) out.push(m[2]);
  }
  return out;
}

const itemRead = ruleOf(classicCode, '.item-read');
chk(!/body\[data-nav/.test(itemRead),
  '列表播放键 .item-read 不按页面分叉（六部集子共用同一条声明）');

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

const readSvg = ruleOf(cssCode, '.item-read svg');
const reciteSvg = ruleOf(classicCode, '.item-recite svg');
chk(/--item-icon:\s*16px/.test(ruleOf(cssCode, ':root')),
  '圆键图标框 --item-icon: 16px 在 :root 里定义（全站唯一来源）');
chk(/width:\s*var\(--item-icon\)/.test(readSvg) && /width:\s*var\(--item-icon\)/.test(reciteSvg),
  '两枚圆键的图标框都读同一个 --item-icon（与直径成对，不各写一个数）');
chk(!/width:\s*15px/.test(reciteSvg) && !/width:\s*16px/.test(readSvg),
  '两枚圆键的图标框都不再写死 px（写死就与直径脱钩）');

const numRule = ruleOf(cssCode, '.item-num');
const titleRule = ruleOf(cssCode, '.item-title');
const pxOfTitle = (src, prop) => {
  const m = new RegExp(prop + ':\\s*([\\d.]+)px').exec(src);
  return m ? m[1] : '';
};
const titleSize = pxOfTitle(titleRule, 'font-size');
chk(/--item-num:\s*[\d.]+px/.test(numRule),
  '序号圆直径走 --item-num（不是各写一个数）');
chk(!!titleSize && new RegExp('--item-num:\\s*' + titleSize).test(numRule),
  '序号圆的直径就是条目标题的字号（实际 ' +
  (numRule.match(/--item-num:\s*([\d.]+px)/) || [0, ''])[1] + ' / ' + titleSize + '）');

["30px", "26px"].forEach(sz => {
  chk(new RegExp('width:\\s*' + sz).test(cssCode) || new RegExp('width:\\s*' + sz).test(classicCode),
    '圆键的 ' + sz + ' 这一档由样式表统一定义（各页不另写尺寸）');
});

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

const cardRule = ruleOf(cssCode, '.card');
chk(/border-radius:\s*var\(--radius\)/.test(cardRule),
  '.card 圆角走 --radius 变量（不写死 px）');
const libCardRule = ruleOf(classicCode, '.library-card');
chk(/border-radius:\s*var\(--radius-md\)/.test(libCardRule),
  '入口页卡片圆角走 --radius-md（与译文框同一档，同是「卡片与卡片之间」的中间档）');

const legalRule = ruleOf(legalCode, '.legal');
chk(/border-radius:\s*var\(--radius\)/.test(legalRule) && /box-shadow:\s*var\(--shadow\)/.test(legalRule),
  '法务页正文那张纸与全站 .card 同圆角同阴影（不另起一套）');

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

const ringRule = ruleOf(cssCode, '.ring');
chk(/width:\s*var\(--today-btn-size/.test(ringRule) &&
  /height:\s*var\(--today-btn-size/.test(ringRule),
  '进度环最大外径就是 --today-btn-size（描边被 svg 裁进盒内，不做补偿）');
chk(/min-height:\s*0/.test(ringRule),
  '进度环 min-height 归零 —— 否则 flex 行会把它纵向撑高、圆变椭圆');

["17px", "16px", "15px", "12px"].forEach(sz => {
  const hit = new RegExp('width:\\s*' + sz).test(cssCode) || new RegExp('width:\\s*' + sz).test(classicCode);
  chk(hit, '播放键图标框的 ' + sz + ' 这一档有出处（换算表在 css/classic.css 顶部）');
});

chk(/:root\s*\{[^}]*--col-w:\s*720px/s.test(cssCode),
  '「一列纸」的宽度只有 --col-w 一个来源（手机档 720px）');
chk(/\.dock-inner\s*\{[^}]*max-width:\s*var\(--content-w/s.test(cssCode),
  '页签内层读 --content-w（与内容区同源，四格不会被拉成巨板）');
chk(/\.dock-inner\s*\{[^}]*margin:\s*0 auto/s.test(cssCode),
  '页签内层居中（与内容区共用一条竖轴）');
chk(/\.dock-inner\s*\{[^}]*width:\s*100%/s.test(cssCode),
  '页签内层占满外层宽度（窄屏上仍是整宽四格）');

const dockRule = ruleOf(cssCode, '.dock');
chk(!/max-width/.test(dockRule),
  '页签外层不写 max-width（写了会连底线一起收掉，两侧露白）');

chk(/--safe-bottom/.test(dockRule),
  '底部安全区留在页签外层（按屏幕底边算，不随内层宽度走）');

chk(/class="dock"[\s\S]{0,80}dock-inner/.test(chromeJs),
  'js/chrome.js 渲染页签时带了 .dock-inner 这一层（不是只写了一条 CSS）');

chk(/@media \(min-width:\s*560px\)[\s\S]{0,400}\.library-grid\s*\{[^}]*flex-direction:\s*row/s.test(classicCode),
  '入口页卡片在 ≥560px 排成两列（竖排的六条长横条在宽屏上太空）');
chk(/\.library-card\s*\{[^}]*max-width:\s*calc\(50% - 6px\)/s.test(classicCode),
  '入口页卡片在宽屏收住宽度（奇数张时最后一张不撑满一行）');

chk(/@media \(min-width:\s*560px\)[\s\S]{0,400}#seg-play\s*\{[^}]*flex-direction:\s*row/s.test(cssCode),
  '设置页「连读方式」在 ≥560px 排成两列（一行一档时右边半张卡全是空白）');
chk(/@media \(min-width:\s*560px\)[\s\S]{0,400}#seg-algo\s*\{[^}]*flex-direction:\s*row/s.test(cssCode),
  '设置页「复习算法」在 ≥560px 排成两列（与连读方式同一套排布）');
chk(/#seg-play \.play-mode-opt\s*\{[^}]*max-width:\s*calc\(50% - 4px\)/s.test(cssCode),
  '连读方式的奇数张不撑满一行（与上排同宽、左对齐）');
chk(/#seg-algo \.algo-opt\s*\{[^}]*max-width:\s*calc\(50% - 4px\)/s.test(cssCode),
  '复习算法的奇数张不撑满一行');

chk(/@media \(min-width:\s*700px\)[\s\S]{0,400}\.cal\s*\{[^}]*overflow-x:\s*visible/s.test(classicCode),
  '进度日历在 ≥700px 不再横滑（14 格 × 34px 只有 476px，692px 的列宽放得下）');
chk(/\.cal-cell\s*\{[^}]*flex:\s*1 1 0/s.test(classicCode),
  '宽屏下日历格子均分列宽（不再定宽 34px、右边留一大片空白）');
chk(/\.cal-cell\s*\{[^}]*max-width:\s*64px/s.test(classicCode),
  '日历格子有宽度上限（均分后每格 80 多像素又变成另一头的「空格子」）');

const appRule = ruleOf(cssCode, '.app');
chk(/max-width:\s*var\(--col-w/.test(appRule), '内容区列宽走 --col-w');

chk(/max-width:\s*var\(--content-w/.test(ruleOf(cssCode, '.topbar')),
  '顶栏列宽与内容区同源（--content-w）');
chk(/width:\s*var\(--content-w/.test(ruleOf(classicCode, '.reader-body')),
  '阅读器正文列宽与内容区同源（--content-w）');
chk(/max-width:\s*var\(--content-w/.test(ruleOf(cssCode, '.dock-inner')),
  '页签内层与内容区同源（--content-w）');

chk(!/max-width:\s*720px/.test(cssCode) || /max-width:\s*720px/.test(ruleOf(cssCode, '.cal')),
  '样式表里不再有第二处写死的 max-width: 720px（一律走 --col-w）');

const tabletRoot = /@media \(min-width:\s*768px\)\s*\{[^@]*:root\s*\{[^}]*--col-w:\s*min\(\s*(\d+)px/s.exec(cssCode);
chk(!!tabletRoot, '平板（≥768px）那一档把 --col-w 放宽了一档（不是把手机那一列拉宽）');
if (tabletRoot) {
  const w = Number(tabletRoot[1]);
  chk(w > 720 && w <= 1200,
    '平板列宽 ' + w + 'px 落在「比手机宽、又不到桌面无限」这一档内');
  chk(/--col-w:\s*min\(\s*\d+px\s*,\s*100vw\s*\)/.test(cssCode),
    '平板列宽取 min(固定值, 100vw)：比那一档还窄的窗口（iPad Pro 竖屏 / 分屏）下不会比视口宽');
}

chk(/@media \(min-width:\s*768px\)[\s\S]{0,400}\.list\s*\{[^}]*flex-direction:\s*row/s.test(cssCode),
  '篇目列表在 ≥768px 排成两列（1040px 里一行只放一篇，右边的空白比字还宽）');
chk(/\.list\s*>\s*\.item\s*\{[^}]*max-width:\s*calc\(50%/s.test(cssCode),
  '两列的条目收住宽度（flex-basis 百分比不减掉半个列距就溢出）');

chk(/@media \(min-width:\s*768px\)[\s\S]{0,400}\.library-card\s*\{[^}]*33\.333%/s.test(classicCode),
  '入口页六张卡在 ≥768px 排成三列（两列时每张 514px，空白比内容宽）');

chk(/@media \(min-width:\s*768px\)[\s\S]{0,600}\.group-card\s*>\s*\.item\s*\{[^}]*max-width:\s*calc\(50%/s.test(classicCode),
  '集子目录页的篇目在 ≥768px 排成两列（选择器落在「卡 → 条目」这条真实关系上）');
chk(/@media \(min-width:\s*768px\)[\s\S]{0,600}\.group-card\s*\{[^}]*flex-wrap:\s*wrap/s.test(classicCode),
  '卡片自己在 ≥768px 变成 flex 行容器（否则条目的 flex-basis 无从生效）');
chk(!/^\.group-card \.list/sm.test(classicCode),
  '没有把「卡内的 .list」当容器（卡里没有这一层，写了就是空规则 + 排错对象）');
chk(/\.group-card\s*>\s*\.group-head\s*\{[^}]*flex:\s*1 1 100%/s.test(classicCode),
  '卡头在两列排布里独占整行（卷名 / 篇数 / 连读圆键不该被挤进半栏）');

chk(/@media \(min-width:\s*768px\)[\s\S]{0,400}\.settings-groups\s*\{[^}]*flex-wrap:\s*wrap/s.test(cssCode),
  '设置页的分组在 ≥768px 排成两列（纵向堆五组，每组只用掉一行的宽度）');
chk(/\.settings-group\s*\{[^}]*max-width:\s*calc\(50% - 18px\)/s.test(cssCode),
  '设置分组收住半栏宽度（flex 不减半列距就溢出）');
chk(/\.settings-item\.wide\s*\{[^}]*max-width:\s*100%/s.test(cssCode),
  '「我的清单」那一项跨列（清单面板与两排按钮挤在半栏里会折行）');

{

  chk(/@media \(min-width:\s*768px\)\s*\{[\s\S]{0,600}\.card \{ padding: 22px; margin-bottom: 26px; \}/.test(cssCode),
    '平板那一档卡片内边距 22px、块距 26px（手机上 14px）');
  chk(/@media \(min-width:\s*1024px\)\s*\{[\s\S]{0,600}\.card \{ padding: 26px; margin-bottom: 26px; \}/.test(cssCode),
    '桌面那一档卡片内边距提到 26px（一列纸跟视口走，卡片里的呼吸也要跟着长）');
  chk(!/@media \(min-width:\s*(768|1024)px\)[\s\S]{0,400}\.card \{[^}]*margin-bottom: 14px/.test(cssCode),
    '宽屏两档里卡片的下边距都不再是手机的 14px（块距与行距由此分开）');
  chk(!/@media \(min-width:\s*1024px\)[\s\S]{0,200}\.list\s*\{[^}]*row-gap:\s*(3[0-9]|[4-9][0-9])px/s.test(cssCode),
    '条目之间的行距仍收在 30px 以内（行距跟块距一起放大，就分不出「一块 / 一组」了）');

  const blockTok = /@media \(min-width:\s*768px\)[\s\S]{0,400}--block-w:\s*(\d+)px/.exec(cssCode);
  chk(!!blockTok, '--block-w（宽屏上「一整块内容」的上限）在 ≥768px 那一档定义');
  if (blockTok) {
    const w = Number(blockTok[1]);
    chk(w >= 800 && w <= 1100,
      '--block-w = ' + w + 'px：落在「比一行字宽、又不到 1600+」这一档' +
      '（1024px 窗口下不缩，1808px 下每张卡不至于拉成一条横幅）');
  }

  chk(!/--col-w:\s*var\(--block-w\)/.test(cssCode),
    '一列纸仍铺满屏幕（没有把 --col-w 换成 --block-w —— 那是「明信片」那一版）');

  ['settings-groups', 'legal', 'progress-main'].forEach(sel => {
    const src = cssCode;

    chk(new RegExp('@media \\(min-width:\\s*1024px\\)[\\s\\S]{0,2000}\\.' + sel +
      '\\s*\\{[^}]*max-width:\\s*var\\(--block-w\\)').test(src),
      '「.' + sel + '」在桌面那一档收进 --block-w（整块不铺满 1808px）');
  });

  const homeGrid = /@media \(min-width:\s*1024px\)[\s\S]{0,900}body\[data-nav="home"\]\s*\.app\s*\{([\s\S]{0,400}?)\}/.exec(cssCode);

  chk(!!homeGrid, '首页在桌面那一档给 .app 排了栅格（三块不再各自一条通栏横带）');
  if (homeGrid) {
    chk(/grid-template-areas/.test(homeGrid[1]),
      '首页三块用 grid-template-areas 定位（不改 DOM 顺序：读屏与 Tab 的次序不变）');
    ['bar', 'today', 'card', 'all'].forEach(name => {
      chk(new RegExp('"?' + name + '\\s+' + name + '"|\\b' + name + '\\b').test(homeGrid[1]),
        '区域图里有「' + name + '」那一格');
    });
  }

  ['today-bar', 'all-section'].forEach(sel => {
    chk(new RegExp('body\\[data-nav="home"\\] \\.' + sel +
      '(?:[^{}]*)?\\{ grid-area:').test(cssCode),
      '首页的 .' + sel + ' 认领了自己那一格（只写容器不写子元素等于没排）');
  });
  chk(/body\[data-nav="home"\] #today-list \{ grid-area: card; \}/.test(cssCode),
    '今日那一格由 #today-list 自己认领（它不再套一层卡，认领者随之改口）');

  chk(/grid-template-areas/.test(homeGrid ? homeGrid[1] : '') &&
      /"bar\s+bar"/.test(homeGrid ? homeGrid[1] : ''),
    '首页栅格给顶栏留了一整行（区域图里要有 bar 那一行）');
  chk(/body\[data-nav="home"\] \.topbar \{ grid-area: bar; \}/.test(cssCode),
    '顶栏真的认领了那一行（只写区域图不写 grid-area，顶栏仍会掉进第一列）');

  ['bar', 'today', 'card'].forEach(name => {
    chk(new RegExp('\\{ grid-area: ' + name + '; \\}').test(cssCode),
      '区域图里的「' + name + '」有一个元素真的认领了（没人认领 = 留下一个空格子）');
  });

  chk(/class="list" id="today-list"/.test(read('index.html')) &&
    !/class="card today-list"/.test(read('index.html')),
    '首页「今日」那 5 条直接列成 5 张独立卡片（没有外包的那层壳）');

  chk(/\.list\s*>\s*\.group-card\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s.test(cssCode.replace(/\/\*[\s\S]*?\*\//g, ' ')),
    '桌面那一档给 .list > .group-card 一条「横跨全列」（否则卡片被当成 320px 的一格，卡内篇目塌成 91px 宽）');

  chk(/#gw-list > \.group-card \{\s*margin-bottom: \d+px;/.test(cssCode.replace(/\/\*[\s\S]*?\*\//g, ' ')),
    '集子页的卷次卡有卡距（否则 1040~1808px 里一张卡就是一条通栏长条）');

  const deskSrc = cssCode + '\n' + strip(accountCss);
  const deskCardGap = [...deskSrc.matchAll(
    /@media \(min-width: 1024px\)[\s\S]{0,300}?\.(?:card|account-card) \{[^}]*margin-bottom: (\d+)px/g)]
    .map(m => Number(m[1]));
  chk(deskCardGap.length >= 2 && deskCardGap.every(n => n >= 20 && n <= 30),
    '桌面那一档的块距都收在 20~30px 这一档（首页/设置 .card 与账号页 .account-card，' +
    '实际 ' + deskCardGap.join(' / ') + 'px）—— 全站「一块 / 另一块」只有一个节奏');

  chk(/@media \(min-width:\s*768px\)\s*\{[\s\S]{0,400}\.settings-groups \{[^}]*row-gap: \d+px/.test(cssCode),
    '设置分组的行距写在容器上（≥768px 那一档的 row-gap），不是各组分担');

  chk(!/@media \(min-width:\s*768px\)\s*\{[\s\S]{0,900}\.settings-group \{[^}]*margin-top/.test(cssCode),
    '宽屏那一档里分组不再写 margin-top（与容器 row-gap 叠加会让行距变成列距的两倍）');
  chk(/\.settings-group \{ margin-top: 26px; \}/.test(cssCode),
    '手机那一档的组距仍由分组自己给（一列到底时容器没有 row-gap 可言）');

  const brokenCard = cssCode.replace('.card { padding: 22px; margin-bottom: 26px; }',
    '.card { padding: 14px; }');
  chk(brokenCard !== cssCode &&
    !/@media \(min-width:\s*768px\)\s*\{[\s\S]{0,600}\.card \{ padding: 22px; margin-bottom: 26px; \}/.test(brokenCard),
    '这一层有牙：把平板那一档的 22px 改回 14px 时，上面那条「按断点升档」会红');
}

chk(/@media \(min-width:\s*768px\)[\s\S]{0,400}\.progress-main\s*\{[^}]*flex-wrap:\s*wrap/s.test(classicCode),
  '进度页四张卡在 ≥768px 排成两列');
chk(/\.progress-card\.wide\s*\{[^}]*max-width:\s*100%/s.test(classicCode),
  '进度概览那一块占满整行（它只有一行数字，挤在半栏里更难读）');

chk(/@media \(min-width:\s*768px\)[\s\S]{0,400}\.reader-text\s*\{[^}]*max-width:\s*var\(--read-w/s.test(classicCode),
  '阅读器正文列在 ≥768px 封顶 --read-w（栏宽了，一行字数不跟着涨）');

chk(/@media \(min-width:\s*768px\)[\s\S]{0,400}\.toolbar:not\(\.search-toolbar\)\s*\{[^}]*max-width:\s*720px/s.test(classicCode),
  '集子页工具栏在 ≥768px 封顶居中（搜索框一个人吃掉 900px，右边两枚隔着半屏）');
chk(/@media \(min-width:\s*1024px\)[\s\S]{0,400}\.toolbar:not\(\.search-toolbar\)\s*\{[^}]*max-width:\s*var\(--content-w/s.test(classicCode),
  '集子页工具栏在 ≥1024px 改跟 --content-w（与下面的卷次卡左右同缘，且不比容器宽）');
chk(/@media \(min-width:\s*768px\)[\s\S]{0,400}\.search-hero\s*\{[^}]*max-width:\s*520px/s.test(classicCode),
  '搜索页 hero 在 ≥768px 封顶 520px（竖屏高度按视口算，横着拉满就成一条横带）');

chk(/@media \(min-width:\s*768px\)[\s\S]{0,400}\.cal,[\s\S]{0,80}max-width:\s*var\(--read-w/s.test(classicCode),
  '进度日历在 ≥768px 收回 --read-w（14 格均分 1040px 会把格子拉成 64px 的宽方块）');
chk(/@media \(min-width:\s*768px\)[\s\S]{0,600}\.bars\s*\{[^}]*max-width:\s*var\(--read-w/s.test(classicCode),
  '掌握度进度条在 ≥768px 收回 --read-w（轨道 900px 长时，走两成也像快满了）');

const deskRoot = /@media \(min-width:\s*1024px\)\s*\{[^@]*:root\s*\{([^}]*)\}/s.exec(cssCode);
chk(!!deskRoot, '桌面（≥1024px）那一档真的存在（不是把平板那一列当桌面用）');
if (deskRoot) {
  const block = deskRoot[1];
  chk(/--col-w:\s*min\(1200px,\s*100vw\)/.test(block),
    '桌面列宽 = min(1200px, 100vw)（超宽屏上内容壳层封顶 1200px，窄窗口仍跟视口走）');
  chk(/--col-side:\s*32px/.test(block),
    '桌面两侧留 32px（壳层封顶后这一段就是「边」，不再随视口一起长）');
  chk(!/--col-w:\s*max\(\s*\d+px/.test(block),
    '桌面列宽不再用 max(固定值, …) 兜底（真机上那会在 1024px 处造出一个 1px 断崖）');
}

chk(/--col-side:\s*32px/.test(cssCode) && !/--col-side:\s*(max|min)\(/.test(cssCode),
  '--col-side 是固定值，不是算式（算式会与 max-width 打架、把内容卡死）');

chk(/--read-w:\s*720px/.test(cssCode),
  '「一行字」的宽度令牌 --read-w 只定义一次，取手机那一档 720px（约 38 个汉字）');
chk(!/--read-w:\s*calc\(100vw/.test(cssCode),
  '--read-w 不跟视口走（行宽跟着屏幕一起涨正是「读一行太累」的成因）');
chk(!/@media[^{]*\{[^@]*--read-w:\s*(?!720px)/.test(cssCode),
  '--read-w 在任何一档里都不被改写（三档同一个值：手机 / 平板 / 桌面一行字一样长）');

chk(/@media \(min-width:\s*1024px\)[\s\S]{0,400}\.list\s*>\s*\.item\s*\{[^}]*33\.333%/s.test(cssCode),
  '篇目列表在 ≥1024px 再排一档（两列时 1808px 里每行 893px，又是「空白比字宽」）');
chk(/@media \(min-width:\s*1024px\)[\s\S]{0,600}\.group-card\s*>\s*\.item\s*\{[^}]*33\.333%/s.test(classicCode),
  '集子页卡内篇目在 ≥1024px 排成三列（与首页同一档，同一条「空白比字宽」的理由）');
chk(/@media \(min-width:\s*1024px\)[\s\S]{0,400}\.settings-group\s*\{[^}]*33\.333%/s.test(cssCode),
  '设置分组在 ≥1024px 排成三列（一列纸 1808px 时两列每栏 886px，一行选项又是一片空白）');

chk(/.group-card\s*>\s*\.item:nth-of-type\(4\)[\s\S]{0,60}border-top:\s*none/s.test(classicCode),
  '三列时第三列的第一条也不画线（nth-of-type 只写到 3 的话会漏一列）');

chk(/@media \(min-width:\s*1024px\)[\s\S]{0,200}\.settings-input\s*\{[^}]*max-width:\s*320px/s.test(cssCode),
  '桌面上的单行输入框封顶 320px（与手机上一整行同档，不跟着栏宽拉长）');

chk(/@media \(min-width:\s*1024px\)[\s\S]{0,900}\.library-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3/s.test(classicCode),
  '桌面入口页换成三列栅格（六张卡排成 3 × 2，不是 4 + 2）');

chk(/@media \(min-width:\s*1024px\)[\s\S]{0,300}\.reader-nav\s*\{[^}]*max-width:\s*var\(--read-w/s.test(classicCode),
  '阅读器「上一篇 / 下一篇」在 ≥1024px 收进 --read-w（不然两枚按钮被推到屏幕两端）');
chk(/\.reader-nav\s*\{[^}]*margin:\s*26px auto\s+calc\(118px/s.test(classicCode),
  '翻页那一排的左右 auto 写在 margin 简写里（另写一条会被简写重置回 0）');

chk(/--content-w:\s*calc\(var\(--col-w\)\s*-\s*2\s*\*\s*var\(--col-side\)\)/.test(cssCode),
  '「内容宽」= 一列纸减掉两侧那条边，只定义一次（顶栏 / 页签内层 / 正文列都读它）');

chk(/--col-side:\s*var\(--safe\)/.test(cssCode) === false &&
  /\.app\s*\{[^}]*padding-left:\s*calc\(var\(--col-side\)/.test(cssCode),
  '左右内边距读同一档 --col-side（不再有一处写死 14px 把三档一起盖掉）');

const linkRule = ruleOf(cssCode, '.settings-link');
chk(/background:\s*var\(--card\)/.test(linkRule),
  '设置主页的四条入口有底色（走全站 --card，不新开色值）');
chk(/border-radius:\s*var\(--radius-md\)/.test(linkRule),
  '入口卡片的圆角走 --radius-md（与 .trans-box / .library-card 同一档）');

const SHARED_TITLE_SELECTORS = ['.settings-group-title', '.settings-link-title',
  '.item-title'];
const sharedTitleRule = (code) => {
  const m = code.match(/\.settings-group-title,[\s\S]{0,200}?\{([\s\S]{0,400}?)\}/);
  if (!m) return '';
  const block = m[0].slice(0, m[0].indexOf('{'));

  return SHARED_TITLE_SELECTORS.every(sel => block.indexOf(sel) !== -1) ? m[1] : '';
};
const groupNameRule = ruleOf(classicCode, '.group-name');
const sizeOf = r => (r.match(/font-size:\s*([\d.]+)px/) || [0, ''])[1];
const weightOf = r => (r.match(/font-weight:\s*(\d+)/) || [0, ''])[1];
chk(sizeOf(sharedTitleRule(cssCode)) !== '',
  '卡片主标题的大小 / 字重 / 颜色只在一个共用块里写一次（四角都在这条列表里）');
SHARED_TITLE_SELECTORS.map(sel => [sel, sharedTitleRule(cssCode)]).forEach(function (pair) {
  chk(sizeOf(pair[1]) === sizeOf(groupNameRule),
    pair[0] + ' 与集子卷名的字号是同一个值（实际 ' + sizeOf(pair[1]) +
    ' / ' + sizeOf(groupNameRule) + '）');
  chk(weightOf(pair[1]) === weightOf(groupNameRule),
    pair[0] + ' 与集子卷名的字重也是同一个值（实际 ' + weightOf(pair[1]) +
    ' / ' + weightOf(groupNameRule) + '）');
});

const ownLinkTitle = (cssCode.match(/[^{}]*\.settings-link-title\s*\{([^}]*)\}/g) || [])
  .filter(sel => sel.split('{')[0].split(',').map(x => x.trim()).join(',') === '.settings-link-title')
  .map(sel => sel.slice(sel.indexOf('{') + 1)).join(';');
chk(!!ownLinkTitle && !/font-size|font-weight|color:/.test(ownLinkTitle),
  '入口标题自己的那条规则只有字体族兜底，不再另写字号 / 字重 / 颜色');
chk(/position:\s*absolute/.test(ruleOf(cssCode, '.settings-link-go')),
  '入口卡片右侧那颗箭头绝对定位在卡里（不让它参与这一行的排布，落点恒定）');

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

chk(/class="list" id="today-list"/.test(read('index.html')),
  '首页今日列表就是裸的 .list（外层那层 .card 壳已撤）');
chk(!/class="card today-list"/.test(read('index.html')),
  '首页不再有包住今日 5 条的卡片（.card today-list 已撤）');

chk(/-webkit-text-size-adjust:\s*100%/.test(cssCode),
  '关掉了 iOS 的横屏文字自动放大（字号只由样式表决定）');

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

const lastRuleOf = (src, sel) => {
  const flat = src.replace(/@media[^{]+\{/g, '{');
  const parts = [];
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(flat))) {
    if (m[1].split(',').map(x => x.trim()).includes(sel)) parts.push(m[2]);
  }
  return parts.length ? parts[parts.length - 1] : '';
};
const actRule = lastRuleOf(cssCode, '.top-act');
chk(/margin-left:\s*auto/.test(actRule),
  '顶栏那一颗由 margin-left: auto 钉在右缘（不随品牌区宽度浮动）');
chk(/flex:\s*none/.test(actRule),
  '顶栏那一颗不参与收缩（窄屏时只允许品牌区被压窄）');
chk(/width:\s*var\(--top-key\)/.test(actRule) && /height:\s*var\(--top-key\)/.test(actRule),
  '顶栏那一颗的宽高读 --top-key（顶栏右侧不出现第二个尺寸来源）');
chk(/--top-key:\s*40px/.test(ruleOf(cssCode, ':root')),
  ':root 里 --top-key 是 40px（顶栏那一颗的点击区）');

chk(!/--top-slot/.test(cssCode),
  '--top-slot 那枚令牌已删（它是头像的直径，与 logo 同径；头像撤了它没有第二个用户）');
chk(!/\.top-user\s*[,{]/.test(cssCode) && !/\.top-act-spacer\s*[,{]/.test(cssCode),
  '样式表里不再留 .top-user / .top-act-spacer 规则（顶栏右端只剩一颗键，没有要对齐的第二件）');
chk(!/\.top-slot\s*[,{]/.test(cssCode),
  '样式表里不再留 .top-slot 规则（那一枚圆槽是给头像托底的）');

chk(!/border-radius/.test(actRule) || /border-radius:\s*0\s*;/.test(actRule),
  '顶栏那一颗不再是圆钮（圆角归零，不是 50% 那种圆钮）');
chk(/border:\s*0/.test(actRule),
  '顶栏那一颗去掉了圆形边框（border: 0）');
chk(/background:\s*none/.test(actRule),
  '顶栏那一颗去掉了背景色（background: none）');

const iconRule = lastRuleOf(cssCode, '.icon-btn');
chk(/border-radius:\s*50%/.test(iconRule) && /border:\s*1px solid var\(--line\)/.test(iconRule),
  '别处的同类按钮 .icon-btn 仍是圆钮（用户点名的只有右上角那一颗）');

chk(/DOCK_ITEMS\s*=\s*\[\s*\{[\s\S]*?key:\s*"home"[\s\S]*?key:\s*"library"[\s\S]*?key:\s*"search"[\s\S]*?key:\s*"mine"/.test(chromeJs) &&
  /label:\s*"我的"/.test(chromeJs),
  '页签四格（背诵 / 课外 / 搜索 / 我的）只在 js/chrome.js 定义一次');

if (!JSDOM) {
  console.log('(未安装 jsdom，跳过「一列纸只缩进一次」的真实渲染断言 —— npm i jsdom 可启用)');
} else {

  const SHEETS = [css, legalCss, classicCss]
    .map(t => '<style>' + t.replace(/<\/style>/gi, '') + '</style>')
    .join('\n');

  const styled = (markupOrFile, url) => {

    const html = /^[\w./-]+\.html$/.test(markupOrFile) ? read(markupOrFile) : markupOrFile;
    const d0 = new JSDOM(html, { url: 'https://local.test' + url });
    d0.window.document.head.insertAdjacentHTML('beforeend', SHEETS);
    return d0;
  };

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

  const appCountOf = (ddoc, el) => {
    let n = 0;
    for (let p = el; p && p !== ddoc.body; p = p.parentElement) {
      if (p.classList && p.classList.contains('app')) n += 1;
    }
    return n;
  };

  const sample = styled('<div class="app">' +
    '<header class="topbar"><div class="brand"></div>' +
    '<span class="top-slot"></span><span class="top-user"></span></header>' +
    '<div class="paper"></div>' +
    '<div class="nested"><div class="app"></div></div>' +
    '</div>', '/library/');
  const sd = sample.window.document;
  const sw = sample.window;
  const bar = sd.querySelector('.topbar');
  const paper = sd.querySelector('.paper');
  const leaf = sd.querySelector('.app');
  const nested = sd.querySelector('.nested > .app');

  chk(insets(sw, sd, paper) === insets(sw, sd, leaf),
    '纸里的内容正好只缩进一列纸那一层（实际 ' +
    insets(sw, sd, paper) + ' / ' + insets(sw, sd, leaf) + '）—— ' +
    '这一层是 .app 自己（--col-w），多出来的任何一层都是第二层 .app（#147）');
  chk(insets(sw, sd, bar) > insets(sw, sd, paper),
    '页顶那一行自带的 --content-w 不算「多套一层」（实际 ' +
    insets(sw, sd, bar) + ' > ' + insets(sw, sd, paper) + '）—— ' +
    '它是顶栏自己的列宽，不是纸里被算了两遍的那条边');

  chk(insets(sw, sd, nested) > insets(sw, sd, paper),
    '纸里再套一层 .app 会被数出来（实际 ' +
    insets(sw, sd, nested) + ' > ' + insets(sw, sd, paper) + '）—— ' +
    '这条是 #147 的复发线，量不出来这层守卫就是空的');

  chk(appCountOf(sd, nested) === appCountOf(sd, paper) + 1,
    '反面样本换个口径也对得上：纸里多套一层 .app → 多算一个（实际 ' +
    appCountOf(sd, nested) + ' / ' + appCountOf(sd, paper) + '）—— ' +
    '这一支与布局引擎无关，保证上面那把尺子不是哑的');

  chk(appCountOf(sd, bar) === appCountOf(sd, paper),
    '页顶那一行与纸里的内容处在同一层 .app 上（实际 ' +
    appCountOf(sd, bar) + ' / ' + appCountOf(sd, paper) + '）—— ' +
    '量点与被量点共用一个祖先，两个数才可比');

  for (const [file, url, sel] of [
    ['library/index.html', '/library/', '.toolbar'],
    ['poems/index.html', '/poems/', '.toolbar'],
    ['settings/index.html', '/settings/', '#settings-index']
  ]) {
    const d2 = styled(file, url);
    const dd = d2.window.document;
    const box = dd.querySelector(sel);

    const n = insets(d2.window, dd, box);
    const m = insets(d2.window, dd, dd.querySelector('.topbar'));

    const paperN = insets(d2.window, dd, dd.querySelector('.app'));
    const na = appCountOf(dd, box);
    const ma = appCountOf(dd, dd.querySelector('.topbar'));
    chk(n <= m,
      file + ' 里 ' + sel + ' 套的 .app 不多于页顶那一行（实际 ' + n + ' / ' + m + '）—— ' +
      '页顶与内容必须落在同一条竖轴上');
    chk(n === paperN,
      file + ' 里 ' + sel + ' 的缩进层数正好等于一列纸那一层（实际 ' + n + ' / ' + paperN + '）—— ' +
      '多出来的一层就是第二层 .app，卡片会比顶栏窄一条边（#147）');

    chk(na === ma,
      file + ' 里 ' + sel + ' 套的 .app 与页顶那一行一样多（实际 ' + na + ' / ' + ma + '）—— ' +
      '多出来的一层 .app 就是把「一列纸」的宽度算了两次（#147）');

    const probe = dd.createElement('div');
    probe.className = 'app';
    box.appendChild(probe);
    chk(appCountOf(dd, probe) === ma + 1,
      file + ' 的反面样本被数出来了（给内容多套一层 .app → ' + appCountOf(dd, probe) +
      ' / 页顶 ' + ma + '）—— 这把尺子不是空的');

    probe.remove();
  }
}

{
  const actRule2 = lastRuleOf(cssCode, '.top-act');
  chk(/margin-left:\s*auto/.test(actRule2),
    '顶栏那一颗由 margin-left: auto 钉在右缘（不随品牌区宽度浮动）');
  chk(/flex:\s*none/.test(actRule2),
    '顶栏那一颗不参与收缩（窄屏时只允许品牌区被压窄）');
  chk(/--top-key:\s*40px/.test(ruleOf(cssCode, ':root')) &&
    /width:\s*var\(--top-key\)/.test(actRule2),
    '顶栏那一颗的直径读 --top-key（顶栏右侧只有一个尺寸来源）');

  const spacerRule = ruleOf(cssCode, '.top-act-spacer');
  chk(!/width:\s*var\(--top-slot\)/.test(spacerRule),
    '阅读器里那枚「不可见占位」不再读 --top-slot（它与头像一起撤了）');
  chk(!/\.top-slot \+ \.top-user/.test(cssCode) && !/--top-gap/.test(cssCode),
    '槽与锚点之间的间距令牌 --top-gap 也一并删掉（没有第二件要跟它对间距了）');

  chk(!/isReader[\s\S]{0,300}'<span class="top-act-spacer"/.test(chromeJs),
    '阅读器那条顶栏不再补那枚不可见占位（它占的是头像的像素位）');
  chk(!/\.top-slot-mark/.test(cssCode),
    '样式表里不再留 `.top-slot-mark` 规则（僵尸规则会误导下一个改样式的人）');
  chk(!/GLYPHS\.reader/.test(chromeJs.replace(/\/\/[^\n]*/g, ' ')),
    '那枚「书」图标（GLYPHS.reader）连同定义一起删掉，不留没人用的图形');

  const headerCode = strip(chromeJs.slice(chromeJs.indexOf('function headerHtml'),
    chromeJs.indexOf('function firstActAnchor'))).replace(/\/\/[^\n]*/g, ' ');
  chk(!/justify-content/.test(headerCode),
    '右侧簇的位置不由 JS 排（分列两端交给 CSS 的 .topbar，JS 只管渲染结构）');
  chk(/var right = rightKey;/.test(headerCode),
    '右端就是那一颗键本身（不再有「槽 + 恒定锚点」—— 头颅那一枚撤了）');

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
    chk(!/class="top-slot"|class="top-user"/.test(stripHtml(read(file))),
      file + ' 的 HTML 里不写死右侧簇（结构只出 chrome.js 一处）');
  });

  const pageNames = ['搜索', '课外阅读', '唐诗三百首', '课外必背小古文'];
  chk(new Set(pageNames.map(n => n.length)).size > 1,
    '被守的页名长短确实不同（' + pageNames.map(n => n.length).join('/') + ' 字）—— ' +
    '上一版正是长度差异把返回键推到了不同位置');
}

const PAGE_FILES = ['classic/index.html', 'guwen/index.html', 'songci/index.html',
  'tangshi/index.html', 'zhaoming/index.html', 'poems/index.html',
  'library/index.html', 'search/index.html'];
const engineJs = read('js/reader-core.js');

chk(!/<span class="rd-count"/.test(engineJs) && !/createElement\("span"\)[\s\S]{0,80}rd-count/.test(engineJs),
  '引擎不再生成 .rd-count 那一枚已读读数（详情页里没有这一枚了）');
chk(!/\.rd-count\s*[,{]/.test(classicCss),
  '样式表里不再留 .rd-count 规则（不是「留着但没人用」）');

chk(/\d\s*\/\s*\d+\s*(篇|首)/.test('<span class="rd-count">0 / 167 篇</span>'),
  '那段正则真的能抓到「0 / 167 篇」（这把尺子不是空的）');
PAGE_FILES.forEach(f => {
  const html = read(f);

  const m = /<div class="meta rd-meta" id="rd-meta">([^]*?)<\/div>/.exec(html);
  chk(!!m, f + ' 的详情页状态栏节点还在（撤的是读数，不是这一行本身）');
  chk(!!m && !/\d\s*\/\s*\d+\s*(篇|首)/.test(m[1]),
    f + ' 的详情页状态栏里不写死任何「N / M 篇 / 首」读数（实际「' + (m ? m[1] : '') + '」）');
});

['classic/index.html', 'guwen/index.html', 'songci/index.html', 'tangshi/index.html',
 'zhaoming/index.html', 'poems/index.html', 'library/index.html', 'search/index.html'].forEach(f => {
  const m = /<header class="topbar">([^]*?)<\/header>/.exec(read(f));
  chk(m && !/count-badge|\d\s*\/\s*\d+\s*(篇|首)/.test(m[1]),
    f + ' 的页顶那一行不挂任何读数（Issue #147 撤干净，不留死节点）');
});

(function backButtonIsIndispensable() {

  const readerRule = ruleOf(classicCode, '.reader');
  chk(/position:\s*fixed/.test(readerRule) && /inset:\s*0/.test(readerRule),
    '阅读器是全屏层（fixed + inset:0）—— 所以它必须自带一枚出口');
  const readerZ = /z-index:\s*(\d+)/.exec(readerRule);
  const dockZ = /z-index:\s*(\d+)/.exec(ruleOf(cssCode, '.dock'));
  chk(!!readerZ && !!dockZ && Number(readerZ[1]) > Number(dockZ[1]),
    '阅读器（z-index ' + (readerZ ? readerZ[1] : '?') + '）压在底部页签（z-index ' +
    (dockZ ? dockZ[1] : '?') + '）之上 —— 页签在阅读器里点不到，' +
    '顶栏那颗「合上」是唯一的出口');

  const readerJs = read('js/reader-core.js');
  chk(!/pushState|replaceState/.test(readerJs.replace(/\/\/[^\n]*/g, ' ')),
    '阅读器不往 history 里压栈（没有浏览器返回键可关它）—— 所以要用界面上的那一颗');
  chk(/keydown[\s\S]{0,200}Escape/.test(readerJs),
    '桌面还能按 Esc 合上（手机没有 Esc —— 这正是手机更要那颗按钮的原因）');

  const DOCKLESS = ['login/index.html', 'profile/index.html', 'admin/index.html',
    'plans/index.html', 'terms/index.html', 'privacy/index.html'];
  DOCKLESS.forEach(f => {
    chk(/data-dock="off"/.test(stripHtml(read(f))),
      f + ' 关着底部页签（data-dock="off"）—— 它只能靠顶栏那颗返回键上一层');
  });

  ['search/index.html', 'settings/index.html', 'library/index.html'].forEach(f => {
    chk(!/data-dock="off"/.test(stripHtml(read(f))),
      f + ' 有页签（页签是它的退路之一）');
  });
})();

{
  const genHtml = read('settings/general/index.html');
  const usedHtml = stripHtml(genHtml);

  chk(/class="switch"[\s\S]{0,400}class="switch-input"[\s\S]{0,200}class="switch-toggle"/.test(usedHtml),
    '设置页的开关是 <label.switch> 包着 input 与轨道（点文字 = 点开关）');
  chk(/id="toggle-sync"[\s\S]{0,200}role="switch"/.test(usedHtml),
    '开关带 role="switch"（读屏念得出「开关」，而不是「复选框」）');
  chk(/aria-labelledby="switch-sync-name"/.test(usedHtml),
    '开关用 aria-labelledby 指向左侧项名（读屏念得出「跨设备同步，开关」）');
  chk(!/id="sync-label"/.test(usedHtml),
    '旧的那颗「关」/「开」文字标签已经拿掉（状态由开关本体表达）');

  chk(!/switch-track/.test(usedHtml),
    'HTML 里不再有独立滑块 .switch-track（上一版它靠 absolute 叠在 input 上）');
  chk(!/\.switch-track\s*[,{]/.test(strip(css)),
    '样式表里也不再留 .switch-track 的规则（结构没了，规则就是僵尸）');

  const track = ruleOf(strip(css), '.switch-toggle');
  chk(/position:\s*relative/.test(track),
    '.switch-toggle 自己是定位包含块（position: relative）—— 滑块跑不出去就靠这一句');
  const px = (src, prop) => {
    const m = new RegExp('(?:^|[;{\\s])' + prop + ':\\s*([\\d.]+)(px)?').exec(src);
    return m ? Number(m[1]) : NaN;
  };
  const trackW = px(track, 'width'), trackH = px(track, 'height');
  const borderW = Number((/border:\s*([\d.]+)px/.exec(track) || [])[1]);
  const knob = ruleOf(strip(css), '.switch-toggle::after');
  const knobW = px(knob, 'width'), knobH = px(knob, 'height');
  const left = px(knob, 'left'), top = px(knob, 'top');
  chk(trackW > 0 && trackH > 0,
    '轨道有声明尺寸（' + trackW + '×' + trackH + '）');
  chk(knobW > 0 && knobH > 0,
    '滑块有声明尺寸（' + knobW + '×' + knobH + '）');

  chk(knobW + 2 * left + 2 * borderW <= trackW,
    '滑块横向落在轨道内（起点 ' + left + ' + 滑块 ' + knobW + ' + 边框 ' +
    borderW + '×2 ≤ 轨道 ' + trackW + '）');
  chk(knobH + 2 * top + 2 * borderW <= trackH,
    '滑块纵向落在轨道内（起点 ' + top + ' + 滑块 ' + knobH + ' + 边框 ' +
    borderW + '×2 ≤ 轨道 ' + trackH + '）');

  chk(knobW === knobH, '滑块是正圆（宽 ' + knobW + ' = 高 ' + knobH + '）');

  const onKnob = ruleOf(strip(css), '.switch-input:checked + .switch-toggle::after');
  const shift = (/-?translateX\((\d+)px\)/.exec(onKnob) || [])[1];
  const expect = trackW - 2 * borderW - knobW - 2 * left;
  chk(Number(shift) === expect,
    '滑块的行程与尺寸同源（轨道 ' + trackW + ' − 边框 ' + borderW + '×2 − 滑块 ' +
    knobW + ' − 起点 ' + left + '×2 = ' + expect + '，源码写的 ' + shift + '）');

  const onTrack = ruleOf(strip(css), '.switch-input:checked + .switch-toggle');
  chk(/background:\s*var\(--green\)/.test(onTrack),
    '开着 = 深青实底（与全站选中态同一个令牌）');

  chk(!/box-shadow:\s*inset/.test(onTrack),
    '开着时不带描金内边（扁平化后「开 / 关」只靠实底与纸底区分）');
  chk(/background:\s*var\(--card\)/.test(track),
    '关着 = 纸底（不是浏览器默认的白底方框）');
  const offTrack = ruleOf(strip(css), '.switch-input:disabled + .switch-toggle');
  chk(/cursor:\s*not-allowed/.test(offTrack) && /background:/.test(offTrack),
    '置灰态有自己的一句（不可点的开关与「关着但能点」必须看得出不同）');
  chk(/background:\s*var\(--line\)/.test(ruleOf(strip(css), '.switch-input:disabled + .switch-toggle::after')),
    '置灰时滑块也一并退到淡墨（不是轨道灰了、圆点还亮着）');

  const inpRule = ruleOf(strip(css), '.switch-input');
  chk(px(inpRule, 'width') === 0 && px(inpRule, 'height') === 0,
    '.switch-input 画成 0 尺寸（真实复选框留着，但不占位）');
  chk(/opacity:\s*0/.test(inpRule) && /position:\s*absolute/.test(inpRule),
    '真实复选框透明且脱流（视觉交给轨道那颗 span）');
  chk(/focus-visible/.test(css) && /\.switch-input:focus-visible\s*\+\s*\.switch-toggle\s*[,{]/.test(strip(css)),
    '焦点环画在**轨道**上（画在那颗 0 尺寸的 input 上等于看不见）');

  chk(!/\.switch-input:focus\s*\{/.test(strip(css)),
    '焦点态只走 :focus-visible（鼠标点轨道不该留下键盘才有的光晕）');

  ['switch', 'switch-input', 'switch-toggle', 'switch-hint'].forEach(cls => {
    const seg = ruleSegments(css, '.' + cls);
    chk(seg.length <= 1,
      '样式表里 .' + cls + ' 只有一段规则（实际 ' + seg.length + ' 段 —— 同名两段会让「按累积读」的断言读到作废的值）');
  });
  chk(!/\.switch-row\s*[,{]/.test(strip(css)) && !/\.switch-label\s*[,{]/.test(strip(css)),
    '样式表里没有 .switch-row / .switch-label 的死规则（HTML 从不使用这两个类名）');

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
      const box = input.nextElementSibling;
      chk(!!box && box.classList.contains('switch-toggle'),
        '轨道是 input 的紧邻兄弟（CSS 的 `+` 才找得到它）');
      if (box) {
        const bcs = win.getComputedStyle(box);
        chk(bcs.position === 'relative',
          '画出来的轨道是定位包含块（position: relative）—— 滑块因此只能落在它里面');
        chk(bcs.width === trackW + 'px' && bcs.height === trackH + 'px',
          '画出来的轨道就是声明的尺寸（' + bcs.width + '×' + bcs.height + '）');
        chk(bcs.borderRadius === '999px',
          '轨道是胶囊（画出来的圆角 999px，不是方框）');

        const ics = win.getComputedStyle(input);
        chk(parseFloat(ics.width) === 0 && parseFloat(ics.height) === 0,
          '画出来的 .switch-input 是 0 尺寸（' + ics.width + '×' + ics.height + '，不占位）');

      }
    }
  }
}

{

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

  const rootRule = ruleOf(cssCode, ':root');
  chk(/--danger-bg:\s*#[0-9a-f]{6}/.test(rootRule) && /--danger-line:\s*#[0-9a-f]{6}/.test(rootRule),
    '危险色令牌 --danger-bg / --danger-line 在 :root 里定义（全站唯一来源）');
  chk(/var\(--danger-line\)/.test(ruleOf(cssCode, '.danger-btn')) &&
      /var\(--danger-bg\)/.test(ruleOf(cssCode, '.danger-btn')),
    '设置页的 .danger-btn 读危险色令牌（不再写死 #ecd2cd）');

  chk(/var\(--danger-line\)/.test(ruleOf(strip(accountCss), '.account-btn.danger')) &&
      /var\(--danger-bg\)/.test(ruleOf(strip(accountCss), '.account-btn.danger')),
    '账号页的 .account-btn.danger 读同一条危险色令牌（两种页面同一个底色）');

  const dangerWriters = (cssCode + '\n' + accountCss).replace(/^\s*:root\s*\{[\s\S]*?\}/m, '');
  chk(!/#ecd2cd/.test(dangerWriters.replace(/\/\*[\s\S]*?\*\//g, ' ')),
    '除 :root 外没有第二处写死 #ecd2cd（危险按钮的描边只有一个来源）');
}

{

  chk(!/border-top/.test(ruleOf(cssCode, '.settings-foot')),
    '页脚 .settings-foot 不再画上边框（「©2026 kuibu.app」上面那条横线已删）');
  chk(/padding-top/.test(ruleOf(cssCode, '.settings-foot')),
    '页脚与正文之间的间距改用留白表达（padding-top 还在）');

  chk(/a\s*\{[^}]*text-decoration:\s*none/.test(cssCode),
    '全局 `a { text-decoration: none }` 存在（全站唯一一条「不给下划线」的默认）');

  const footRule = ruleOf(cssCode, '.foot-links a:hover');
  chk(/text-decoration:\s*none/.test(footRule) || !/text-decoration/.test(footRule),
    '页脚链接 hover 不再把下划线加回来（反馈只走颜色一档）');

  chk(/\.kv-v a\s*\{[^}]*color:\s*var\(--green\)/.test(strip(css)),
    '「关于」里的「查看」链接有自己的配色规则（不再是浏览器默认的蓝紫链接）');

  const underlines = (cssCode + '\n' + accountCss + '\n' + legalCode)
    .match(/text-decoration:\s*underline/g) || [];
  chk(underlines.length === 0,
    '全站样式表里没有一条 `text-decoration: underline`（实际 ' + underlines.length + ' 条）');

  // 全局那条是唯一一处「不给下划线」的默认。别的份数只要不是把下划线
  // 重新加回来（text-decoration: underline），就不算破这条口径 ——
  // 但每多写一条都是同一件事的第二个来源，这里仍按 ≤1 条卡着。
  const noneWriters = (cssCode.replace(/^[^\n]*\ba\s*\{[^}]*text-decoration:\s*none[^}]*\}[^\n]*$/m, '')
    + '\n' + strip(classicCss) + '\n' + strip(legalCss) + '\n' + strip(accountCss))
    .match(/text-decoration:\s*none/g) || [];
  chk(noneWriters.length <= 1,
    '除全局那条外，各页面文件里不再各写一遍 text-decoration: none（实际 ' + noneWriters.length + ' 条）');

  const genHtml0 = read('settings/general/index.html');
  const usedSwitchCls = ['switch', 'switch-input', 'switch-toggle'].filter(cls =>
    new RegExp('class="[^"]*\\b' + cls + '\\b').test(stripHtml(genHtml0)));
  chk(usedSwitchCls.length >= 3, '设置页的开关用到了 switch / switch-input / switch-toggle 三个类名');
  usedSwitchCls.forEach(cls => {
    chk(new RegExp('\\.' + cls + '\\s*[,{]').test(cssCode),
      '开关的 .' + cls + ' 在样式表里有规则（HTML 写了就得画出来）');
  });

  ['switch-row', 'switch-label', 'switch-track'].forEach(cls => {
    chk(!new RegExp('\\.' + cls + '\\s*[,{]').test(strip(cssCode)),
      '样式表里不再有 .' + cls + '（旧写法的残留，与自绘版冲突）');
  });
  chk(/input:checked\s*\+\s*\.switch-toggle/.test(strip(cssCode)),
    '开关的「开」态由 :checked + .switch-toggle 表达（不是靠原生 checkbox）');
  chk(/input:disabled\s*\+\s*\.switch-toggle/.test(strip(cssCode)),
    '开关的「未开放」态也有样式（置灰，不是原生 disabled 的样子）');

  const inpRule = ruleOf(cssCode, '.switch-input');
  chk(/position:\s*absolute/.test(inpRule) && /opacity:\s*0/.test(inpRule),
    '.switch-input 透明且脱流（真实复选框留着，视觉交给轨道那颗 span）');

  chk(/\bwidth:\s*0/.test(inpRule) && /\bheight:\s*0/.test(inpRule),
    '.switch-input 画成 0 尺寸（不占位）');

  chk(/\.switch-toggle::after\s*[,{]/.test(strip(cssCode)),
    '滑块是轨道的 ::after（与轨道同一个盒子，不存在两处分家的可能）');
  const trk = ruleOf(cssCode, '.switch-toggle');
  const knb = ruleOf(cssCode, '.switch-toggle::after');
  chk(/\bwidth:\s*40px/.test(trk) && /\bheight:\s*24px/.test(trk),
    '轨道尺寸写在这一段里（40×24）');
  chk(/\bwidth:\s*18px/.test(knb) && /\bheight:\s*18px/.test(knb),
    '滑块尺寸写在这一段里（18×18）');
  chk(/focus-visible/.test(cssCode) && new RegExp('\\.switch-input:focus-visible\\s*\\+\\s*\\.switch-toggle\\s*[,{]').test(strip(cssCode)),
    '开关有键盘焦点态（focus-visible）—— 画在轨道上，不许把焦点框一起丢掉');

  ['switch-input', 'switch-toggle', 'switch', 'switch-hint'].forEach(cls => {
    const seg = ruleSegments(cssCode, '.' + cls);
    chk(seg.length <= 1,
      '样式表里 .' + cls + ' 只有一段规则（实际 ' + seg.length + ' 段 —— 同名两段会让「按累积读」的断言读到作废的值）');
  });
}

if (JSDOM) {
  const sheet = '<style>' + cssCode + '</style><style>' + classicCode + '</style>';
  const px = (json) => json.fontSize;

  ['settings/general/index.html', 'settings/recite/index.html',
   'settings/lists/index.html', 'settings/reader/index.html'].forEach(function (f) {
    const d = new JSDOM(read(f), { url: 'https://local.test/' + f.replace('index.html', '') });
    d.window.document.head.insertAdjacentHTML('beforeend', sheet);
    const all = [...d.window.document.querySelectorAll('.settings-group-title')];
    if (!all.length) return;
    const bad = all.filter(el => d.window.getComputedStyle(el).fontSize !== sizeOf(groupNameRule) + 'px');
    chk(bad.length === 0,
      f + ' 的分组名画出来和集子卷名同号（实际 ' +
      all.map(el => d.window.getComputedStyle(el).fontSize).join('/') + '）');
  });

  const d2 = new JSDOM(read('settings/index.html'),
    { url: 'https://local.test/settings/', runScripts: 'dangerously' });
  d2.window.document.head.insertAdjacentHTML('beforeend', sheet);
  const sc = d2.window.document.createElement('script');
  sc.textContent = read('js/settings-nav.js');
  d2.window.document.body.appendChild(sc);
  d2.window.document.dispatchEvent(new d2.window.Event('DOMContentLoaded'));
  const titles = [...d2.window.document.querySelectorAll('.settings-link-title')];
  chk(titles.length > 0 &&
    titles.every(el => d2.window.getComputedStyle(el).fontSize === sizeOf(groupNameRule) + 'px'),
    '设置主页四张入口卡的标题画出来也是同一号（' +
    (titles[0] ? d2.window.getComputedStyle(titles[0]).fontSize : '未取到') + '）');

  const d3 = new JSDOM(read('settings/recite/index.html'), { url: 'https://local.test/settings/recite/' });
  d3.window.document.head.insertAdjacentHTML('beforeend', sheet);
  const grp = d3.window.document.querySelector('.settings-group-title');
  chk(titles.length > 0 && grp &&
    d2.window.getComputedStyle(titles[0]).fontSize === d3.window.getComputedStyle(grp).fontSize,
    '设置主页入口标题与二级页分组名画出来一样大（同名同号，不再两套）');
} else {
  console.log('- (未安装 jsdom，跳过卡片主标题的真实渲染一节)');
}

if (JSDOM) {
  const doc = new JSDOM(read('settings/general/index.html'),
    { url: 'https://local.test/settings/general/' }).window.document;
  const input = doc.getElementById('toggle-sync');
  const track = doc.querySelector('.switch-toggle');
  chk(!!input && !!track, '开关的 input / 轨道两样都在 DOM 里（状态由是否选中表达）');
  chk(!!doc.querySelector('label.switch') &&
      doc.querySelector('label.switch').contains(input) &&
      doc.querySelector('label.switch').contains(track),
    '两者包在同一个 <label.switch> 里（点轨道任意处都切得动，iOS 上也是）');

  chk(!!input && input.nextElementSibling === track,
    '轨道是 input 的紧邻兄弟（`:checked + .switch-toggle` 这条相邻选择器才对得上）');

  chk(!doc.querySelector('.switch-track'),
    'HTML 里不再有独立滑块 .switch-track（滑块现在是轨道的 ::after）');

  chk(!doc.querySelector('.switch-row') && !doc.querySelector('.switch-label'),
    'HTML 里不再有 1B 期的 .switch-row / .switch-label（开关只此一套结构）');
} else {
  console.log('- (未安装 jsdom，跳过开关的 DOM 结构一节)');
}

{

  const loginPageRule = ruleOf(strip(accountCss), '#login-page');
  chk(/display:\s*flex/.test(loginPageRule),
    '登录页那一列是 flex 容器（居中要靠它算剩余空间，不是靠外边距拍一个数）');
  chk(/min-height:\s*calc\(100\s*\*\s*var\(--app-vh\)/.test(loginPageRule),
    '容器高度按实测视口算（--app-vh 是 js/pwa.js 量出来的，不是 100vh 在 iOS 上的跳变值）');

  const vhFallbacks = (strip(accountCss).match(/min-height:\s*calc\(100vh\s*-\s*\d+px\)/g) || []).length;
  const vhMeasured = (strip(accountCss).match(/min-height:\s*calc\(100 \* var\(--app-vh\)\s*-\s*\d+px\)/g) || []).length;
  chk(vhFallbacks >= 1 && vhFallbacks === vhMeasured,
    '实测视高（--app-vh）与 100vh 兜底成对出现（各 ' + vhMeasured + ' / ' + vhFallbacks +
    ' 条）—— 没有 js 量过视高的那一档也照样算得出高度');
  chk(vhMeasured >= 2,
    '手机与桌面两档各给自己留了一对（实际 ' + vhMeasured + ' 对 —— 大字号 / 横屏那一档也得算得对）');

  const loginCardRule = ruleOf(strip(accountCss), '#login-page > .account-card');
  chk(/margin-top:\s*auto/.test(loginCardRule) && /margin-bottom:\s*auto/.test(loginCardRule),
    '卡片上下外边距都是 auto（卡片比容器高时退化成 0，顶端仍贴得住 —— ' +
    'justify-content: center 会把顶端顶到容器外，顶栏那一段滚不回来）');
  chk(!/justify-content/.test(loginPageRule),
    '不用 justify-content 居中（溢出时会把卡片顶端推出容器）');

  const plainPage = ruleOf(strip(accountCss), '.account-page');
  chk(!/min-height/.test(plainPage) && !/display:\s*flex/.test(plainPage),
    '只有登录页垂直居中（.account-page 那一档既不定高也不改排布 —— ' +
    '个人中心 / 管理后台是清单页，居中对它们不成立）');
  chk(/#login-page\s*\{/.test(strip(accountCss)) &&
    /<main class="account-page" id="login-page">/.test(read('login/index.html')),
    '那一列真的有 #login-page 这个钩子（HTML 与 CSS 对得上，不是一条空规则）');

  const noCenter = strip(accountCss).replace(/#login-page[^}]*\}/, '');
  chk(!/display:\s*flex/.test(ruleOf(noCenter, '#login-page')),
    '反面样本：抹掉 #login-page 那段之后，这把尺子立刻判它没有 flex（断言不是空的）');

  const acctPrimary = ruleOf(strip(accountCss), '.account-btn');
  const sitePrimary = ruleOf(cssCode, '.btn.primary');
  const threeDee = /linear-gradient|rgba\(\s*240,\s*205,\s*124|0 2px 10px|transform:\s*scale/;
  chk(!threeDee.test(acctPrimary) && !threeDee.test(sitePrimary),
    '两处的一级按钮都是扁平的（无渐变 / 无描金内边 / 无外投影）—— 有一处偷偷立体就判红');
  chk(/background:\s*var\(--green\)/.test(acctPrimary) &&
      /background:\s*var\(--green\)/.test(sitePrimary),
    '两处的一级按钮都是同一个平色块（var(--green)）—— 并排看是同一颗键');
  chk(/border:\s*1px solid var\(--green-dark\)/.test(acctPrimary) &&
      /border-color:\s*var\(--green-dark\)/.test(sitePrimary),
    '描边读 --green-dark（与全站一级按钮同一条边）');

  const acctActive = ruleOf(strip(accountCss), '.account-btn:active');
  const siteActive = ruleOf(cssCode, '.btn.primary:active');
  chk(!threeDee.test(acctActive) && !threeDee.test(siteActive),
    '两处主按钮的按下态都只用颜色（没有缩放 / 描金内边 / 投影）');
  chk(/background/.test(acctActive) && /background/.test(siteActive),
    '两处的按下反馈都写在 background 上（同一种说法：压深一档底色）');
  chk(/font-size:\s*15px/.test(acctPrimary) && /font-size:\s*15px/.test(ruleOf(cssCode, '.btn')),
    '两处主按钮的字号同一档（15px）—— 并排看不会一大一小');

  const acctCode = strip(accountCss).replace(/^\s*:root\s*\{[\s\S]*?\}/m, '');
  chk(!/#2f6055|#234b42|#4f7a6e|#f0cd7c/i.test(acctCode),
    'account.css 里不出现天青 / 缃色的字面量（一律读 css/style.css 的 :root 令牌）');
}

{
  const btnSel = /\.(?:[a-z-]*btn[a-z-]*|account-btn|pw-eye|auth-tab|game-mode|game-opt|tier-pick|switch-toggle|icon-btn|mini-btn|seg-toggle|code-resend|link-btn|grant-del)\b/;
  const blocks = [...strip(cssCode + '\n' + strip(accountCss))
    .matchAll(/([^{}]*)\{([^}]*)\}/g)]
    .map(m => ({ sel: m[1].trim(), body: m[2] }));
  const btnBlocks = blocks.filter(b => btnSel.test(b.sel.split(',').join(' ')));
  chk(btnBlocks.length >= 8, '扫到按钮类规则 ' + btnBlocks.length + ' 条（尺子有牙）');
  const bad = btnBlocks.filter(b => /linear-gradient|radial-gradient|rgba\(\s*240,\s*205,\s*124/.test(b.body));
  chk(bad.length === 0,
    '全站按钮里没有一处渐变或描金内边（立体感的两个来源都要没有；实际：' +
    bad.map(b => b.sel).join(' | ') + '）');
  const scaleActive = btnBlocks.filter(b => /:active/.test(b.sel) && /transform:\s*scale/.test(b.body));
  chk(scaleActive.length === 0,
    '全站按钮的按下态不再缩放（扁平按钮的按下只用颜色；实际：' +
    scaleActive.map(b => b.sel).join(' | ') + '）');
}

{
  const cs = strip(cssCode);
  const cc = strip(accountCss);
  const classicCss = fs.readFileSync(path + 'css/classic.css', 'utf8');
  const cstrip = classicCss.replace(/\/\*[\s\S]*?\*\//g, ' ');

  const itemRule = ruleOf(cs, '.item');
  chk(/box-shadow:\s*var\(--shadow\)/.test(itemRule),
    '背诵首页那条条独立卡片（.item）读 --shadow 令牌');

  const libBlocks = [...cstrip.matchAll(/(?:^|\n)[ \t]*\.library-card\s*\{([^}]*)\}/g)].map(m => m[1]);
  const libRule = libBlocks.filter(b => /background/.test(b)).join(';');
  chk(libBlocks.length >= 1 && /box-shadow:\s*var\(--shadow\)/.test(libRule),
    '课外阅读那几张集子卡（.library-card）读的是**同一个** --shadow（借鉴首页那条）');
  const linkBlocks = [...cs.matchAll(/(?:^|\n)[ \t]*\.settings-link\s*\{([^}]*)\}/g)].map(m => m[1]);
  const linkRule = linkBlocks.join(';');
  chk(/box-shadow:\s*var\(--shadow\)/.test(linkRule),
    '设置主页那四条入口（.settings-link）读的也是同一个 --shadow');

  ['library-card', 'settings-link', 'collection-card'].forEach(cls => {
    const src = cls === 'settings-link' ? cs : cstrip;
    const blocks = [...src.matchAll(new RegExp('(?:^|\\n)[ \\t]*\\.' + cls + '\\s*\\{([^}]*)\\}', 'g'))].map(m => m[1]);
    const badShadow = blocks.filter(b => /box-shadow:/.test(b) && !/box-shadow:\s*var\(--shadow\)/.test(b));
    chk(blocks.length >= 1 && badShadow.length === 0,
      '.' + cls + ' 的阴影只许读 var(--shadow)（不自己写 rgba 深浅；实际 ' +
      badShadow.length + ' 条越界）');
  });

  const collBlocks = [...cstrip.matchAll(/(?:^|\n)[ \t]*\.collection-card\s*\{([^}]*)\}/g)].map(m => m[1]);
  chk(collBlocks.length >= 1 && collBlocks.every(b => !/box-shadow/.test(b)),
    '「我的清单」那张集合卡不自己再写一遍阴影（它复用 .library-card 那一套）');
  chk(/box-shadow:\s*var\(--shadow\)/.test(ruleOf(cs, '.card')),
    '（对照）全站 .card 读的也是这一份令牌 —— 三处 + 卡片层，全站只有一个来源');
}

{
  const barRule = ruleOf(cssCode, '.topbar');
  chk(/padding:\s*calc\(14px \+ var\(--safe-top\)\) 0 12px/.test(barRule),
    '顶栏左右内边距归零（那 2px 是随头像一起撤的那块视觉余量，右端那颗键现在贴边）');
  chk(!/padding:\s*calc\(14px \+ var\(--safe-top\)\) 2px/.test(barRule),
    '顶栏不再留右端那 2px（用户 2026-09-17 点名的「后退键右侧的 padding」）');

  chk(/--scroll-w:\s*0px/.test(ruleOf(cssCode, ':root')),
    ':root 里有 --scroll-w 并且兜底是 0px（手机上不会凭空多出一段空白）');
  const setPage = ruleOf(cssCode, '.settings-page');
  chk(setPage !== '' && !/padding-left/.test(setPage) && !/padding-right/.test(setPage),
    '全屏设置页不再自己写一份左右内边距（右缘因此不会与顶栏 / 页签 / 正文漂开，实际 ' +
      (setPage ? JSON.stringify(setPage.slice(0, 60)) : '规则整条都不见了') + '）');

  const appRule = ruleOf(cssCode, '.app');
  chk(/padding-right:\s*calc\(var\(--col-side\) \+ var\(--safe-right\)\)/.test(appRule),
    '（对照）.app 的右内边距就是设置页抄的那一份');
}

{
  const about = ruleOf(cssCode, '.settings-about');
  chk(/margin-top:\s*\d+px/.test(about),
    '「关于」与上面那几组之间有自己的间距（此前一个字都没有，全挤在一起）');
  const title = ruleOf(cssCode, '.settings-about-title');
  chk(/font-size:\s*\d+px/.test(title) && /font-weight:/.test(title) && /margin:/.test(title),
    '「关于」小标题有字号 / 字重 / 外边距（此前是浏览器默认的 h2，最大最粗）');
  // Issue #229：行距收归 .kv-row 一处 —— 「关于」不再各写一份 padding，
  // 每一行的高度由 min-height 定（这样左边当链接的那几行不会比上面几行高）。
  const row = ruleOf(cssCode, '.kv-row');
  chk(/min-height:\s*\d+px/.test(row) && /padding:\s*0/.test(row),
    '「关于」那几行的行距有自己的来源（.kv-row 的 min-height，且上下不写 padding）');
  chk(!/\.settings-about \.kv-row\s*\{/.test(strip(cssCode)),
    '「关于」不再单独给 .kv-row 补一份 padding（同一件事两处定义必然漂）');

  const navJs = read('js/settings-nav.js');
  chk(/settings-about-title/.test(navJs),
    'js/settings-nav.js 真的给标题挂了这个类名（CSS 与 HTML 两边对得上）');

  const aboutHtml = read('settings/index.html');
  chk(/class="settings-about"/.test(aboutHtml),
    '「我的」页真的有 .settings-about 这个容器（样式不是给空气写）');

  chk(/^\.kv-list\s*\{/m.test(cssCode.replace(/\s/g, ' ').replace(/ ?\.kv-list/, '\n.kv-list')),
    '共享的 .kv-list / .kv-row 一套在 css/style.css 里（「关于」那一块只加载了它）');
  chk(/^\.kv-row\s*\{/m.test(cssCode.replace(/\s/g, ' ').replace(/ ?\.kv-row/, '\n.kv-row')),
    '.kv-row 那一套也在 css/style.css（塞进 account.css 的活，设置整页读不到）');
  chk(!/\.kv-list\s*\{/.test(strip(accountCss)) && !/\.kv-row\s*\{/.test(strip(accountCss)),
    'css/account.css 里不再各写一遍 .kv-list / .kv-row（同一套规则两处定义必然漂）');

  chk(!/<link[^>]*account\.css/.test(aboutHtml),
    '（对照）设置整页确实不加载 css/account.css —— 所以那一套必须住在 style.css 里');
}

/* 三条法务 / 权限链接：左格当链接时的样式，以及页脚那两条的触达面积
   ---------------------------------------------------------------------
   用户 2026-09-18 原话：「下面三个链接样式又丢了，丑 / 权限对比 / 用户协议 /
   隐私条款」。丢的根因是 b5a9cbd 把这三行从「左格文字 + 右格『查看』」
   改成了「左格本身当链接」，而 `.kv-k` 里**从来没有过 a 的规则** ——
   于是这三处落回浏览器默认样子（蓝紫色，13px，无下划线，0 触达高度）。

   这是一条**正面**守卫：不只判「有没有那条 CSS」，而是判那条 CSS 真的
   把颜色 / 下划线 / 触达高度三件都给了，免得下次改令牌时又退回默认样子。 */
{
  const kLink = ruleOf(cssCode, '.kv-k a');
  chk(kLink !== '',
    '.kv-k a 有规则（这三处链接的样式此前一个字都没有，落回浏览器默认的蓝紫色）');
  chk(/color:\s*var\(--green\)/.test(kLink),
    '左格链接走天青主色 var(--green)，不是浏览器默认的蓝（实际 ' +
      (kLink.match(/color:\s*[^;]+/) || ['(无 color)'])[0] + '）');
  // 用户 2026-09-18（两轮口径）：上一轮补的是「一道细线」，这一轮明确
  // **不要下划线**；字号也要和同一行的正文一样（13px），行高才齐。
  // 「不画下划线」全站只有一条默认（css/style.css 顶上的 `a { text-decoration: none }`），
  // 这几行不必再各写一遍：它们要守的是「没有一条规则把下划线又加回来」。
  chk(!/text-decoration:\s*underline/.test(kLink) && !/border-bottom:\s*1px/.test(kLink),
    '左格链接不画下划线（用户 2026-09-18：不要下划线；另一轮补的那道 celadon 细线已撤）');
  chk(!/--celadon/.test(kLink), '那道 celadon 细线不再出现在这条规则里');
  chk(/font-size:\s*13px/.test(kLink),
    '左格链接与同一行的正文同一个字号（13px）不另挑一档');
  chk(/min-height:\s*\d+px/.test(kLink) && parseFloat((kLink.match(/min-height:\s*([\d.]+)px/) || [0, 0])[1], 10) >= 28,
    '左格链接有自己的触达高度（≥ 28px），不是一行 13px 的裸文字');
  chk(/display:\s*inline-flex/.test(kLink),
    '左格链接用 inline-flex 撑起那一行高度（inline 元素拿不到 min-height）');

  chk(!/text-align:\s*right/.test(ruleOf(cssCode, '.kv-v')) ||
      /flex:\s*1 1 auto/.test(ruleOf(cssCode, '.kv-v')),
    '.kv-v 仍可右对齐，但它是弹性列（右列不再靠 text-align 硬顶，多字长值才不会折成碎词）');
  chk(!/word-break:\s*break-all/.test(ruleOf(cssCode, '.kv-v')),
    '.kv-v 不再 word-break: break-all（「跬步 · 古诗词背诵」这类值会被逐字符折断）');
  chk(/overflow-wrap:\s*break-word/.test(ruleOf(cssCode, '.kv-v')),
    '.kv-v 改成 overflow-wrap: break-word（只在必要时断，正常按词 / 标点换行）');
  chk(/word-break:\s*normal/.test(ruleOf(cssCode, '.kv-v')),
    '.kv-v 显式声明 word-break: normal（把继承来的 break-all 口径收干净）');

  const footLink = ruleOf(cssCode, '.foot-links a');
  chk(/min-height:\s*\d+px/.test(footLink) &&
      parseFloat((footLink.match(/min-height:\s*([\d.]+)px/) || [0, 0])[1], 10) >= 28,
    '页脚两条法务链接也补上触达高度（此前是一行 12px 的裸文字，手指点不准）');
  chk(/white-space:\s*nowrap/.test(footLink),
    '页脚两条法务链接不折行（「用户协议 · 隐私条款」这类四字词该整体换行）');
  chk(/display:\s*inline-flex/.test(footLink),
    '页脚链接也用 inline-flex（否则 min-height 在 inline 上不生效）');

  /* 三处链接真的落在左边那一格：两处「关于」都写成了 .kv-k a，
     没有任何一处又退回「左格文字 + 右格『查看』」。 */
  const settingsNav = read('js/settings-nav.js');
  const aboutBlock2 = settingsNav.slice(settingsNav.indexOf('function renderAbout('),
    settingsNav.indexOf('function go()'));
  // 「设置 · 关于」那几行由 link(href, 词) 生成（左格就是那个 <a>），
  // 「个人中心 · 关于」那两行直接写在 HTML 里（同样的 <a class="kv-link">）。
  const profileHtml2 = read('profile/index.html');
  ['/plans/', '/terms/', '/privacy/', '/self-check/'].forEach(href => {
    chk(new RegExp('link\\("' + href + '",').test(aboutBlock2),
      '设置「关于」里 ' + href + ' 那一行是「左格本身当链接」');
  });
  chk(!/class="kv-v"><a/.test(aboutBlock2),
    '设置「关于」里不再有「右格挂一颗『查看』」那种形状');
  ['/terms/', '/privacy/'].forEach(href => {
    chk(new RegExp('class="kv-k"><a class="kv-link" href="' + href + '"').test(profileHtml2),
      '个人中心「关于」里 ' + href + ' 那一行也是「左格本身当链接」');
  });
  chk(!/<span class="kv-v"><a href="\/(terms|privacy)\//.test(profileHtml2),
    '个人中心「关于」里不再留「右格『查看』」（两处形状必须一样，否则同一件事两种长相）');

  /* 反向：整份样式表里，三处链接不许再出现任何「浏览器默认蓝」的兜底色值。 */
  chk(!/#0000ee|#0000ff|rgb\(0,\s*0,\s*238\)/i.test(cssCode),
    'css/style.css 里不写死浏览器默认蓝（写了就等于承认它会露出来）');
}

{
  const gearStart = chromeJs.indexOf('gear:');
  const gear = chromeJs.slice(gearStart, chromeJs.indexOf('tabMineImg:'));
  chk(/M19\.4 15a1\.65/.test(gear),
    '设置那一枚是齿轮（带齿的轮廓），不是一颗太阳');
  chk(!/M12 3\.4v2\.2M12 18\.4v2\.2/.test(gear),
    '那枚「一个圆 + 八根等长射线」的太阳画法已删干净（八个方位的星芒正是太阳的特征）');
  chk((gear.match(/<path/g) || []).length === 1,
    '齿轮只有一条轮廓路径（不再拆成八根线，拆了就退回成太阳）');
  chk(!/M12 3\.4v2\.2/.test(chromeJs),
    'js/chrome.js 里也不留那句射线残留（免得下次又被拼回去）');
}


console.log(fails === 0 ? '\n🎉 UI 一致性 / 响应式守卫全部通过' : '\n❌ ' + fails + ' 项失败');
process.exit(fails ? 1 : 0);
