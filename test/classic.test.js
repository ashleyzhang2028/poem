// 课外必背小古文（/classic/ 页）端到端测试：数据完整性 + 列表/搜索/筛选 + 阅读器
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = __dirname + '/../';

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

/* ---------- 一、数据层（纯 vm，无 DOM） ---------- */
const vm = require('vm');
const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path + 'data/poems-classic.js', 'utf8'), sandbox, { filename: 'poems-classic.js' });

const CLS = sandbox.POEMS_CLASSIC;
chk(Array.isArray(CLS) && CLS.length === 100, '小古文共 100 篇（实际 ' + (CLS ? CLS.length : 'undefined') + '）');
const ids = new Set();
CLS.forEach(p => {
  if (ids.has(p.id)) throw new Error('重复 id ' + p.id);
  ids.add(p.id);
});
chk(true, '小古文 id 无重复');
chk(CLS.every(p => p.title && p.source && p.text && p.translation), '每篇都有 标题/出处/原文/译文');
// 译文来源标注：小古文多为先秦诸子与史传，原文属公有领域，据此标出通行译注口径。
// 不能一篇没有 —— 没有标注，用户就不知道译文是怎么来的（见 README「译文的取舍标准」）
chk(CLS.every(p => p.translationSource === 'public-domain'),
  '100 篇小古文都标了译文来源 public-domain（未标 ' +
  CLS.filter(p => !p.translationSource).length + ' 篇）');
chk(CLS.some(p => p.text.length > 100), '含长篇（>100 字）古文，验证长文场景');

// 需求清单里的篇目必须在库中（抽查关键篇目）
const need = ['人之初', '弟子规（节选）', '司马光', '守株待兔', '精卫填海', '王戎不取道旁李', '囊萤夜读',
  '铁杵成针', '少年中国说（节选）', '古人谈读书', '自相矛盾', '杨氏之子', '伯牙鼓琴', '书戴嵩画牛', '学弈',
  '两小儿辩日', '盘古开天地', '女娲造人', '夸父逐日', '后羿射日', '曹冲称象', '掩耳盗铃', '画蛇添足',
  '刻舟求剑', '郑人买履', '叶公好龙', '揠苗助长', '滥竽充数', '买椟还珠'];
const titles = CLS.map(p => p.title);
const missing = need.filter(t => !titles.includes(t));
chk(missing.length === 0, '需求清单篇目齐备（缺 ' + missing.join('/') + '）');

// 不能污染古诗词主库与每日计划
chk(sandbox.POEMS_ALL === undefined, '小古文不写入 POEMS_ALL，不影响每日计划');
const groups = sandbox.getClassicGroups();
chk(groups.length >= 6, '按主题分组聚合出 ' + groups.length + ' 组');
chk(groups.reduce((n, g) => n + g.items.length, 0) === 100, '分组内篇目合计 100');

/* ---------- 二、页面层（jsdom） ---------- */
/* 目录化 URL：页面真实文件在 classic/index.html，访问地址是 /classic/ */
const html = fs.readFileSync(path + 'classic/index.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://local.test/classic/', base: 'https://local.test/classic/' });
const { window } = dom;
const scriptOrder = html.match(/<script src="([^"]+)"><\/script>/g).map(s => s.match(/src="([^"]+)"/)[1]);
chk(scriptOrder.indexOf('data/poems-classic.js') >= 0, '页面引用了小古文数据');
scriptOrder.forEach(f => {
  const el = window.document.createElement('script');
  el.textContent = fs.readFileSync(path + f, 'utf8');
  window.document.body.appendChild(el);
});

setTimeout(() => {
  const d = window.document;

  // 回归防线：页面里不允许出现重复 id —— 曾因 #rd-trans-text 同时用在
  // 译文开关的读屏文案与可见译文段落上，导致译文被写进隐藏标签、正文空白
  ['index.html', 'classic/index.html'].forEach(f => {
    const doc = new JSDOM(fs.readFileSync(path + f, 'utf8')).window.document;
    const seen = {};
    const dups = [];
    doc.querySelectorAll('[id]').forEach(el => {
      if (seen[el.id]) { if (dups.indexOf(el.id) < 0) dups.push(el.id); } else seen[el.id] = 1;
    });
    chk(dups.length === 0, f + ' 无重复 id（重复：' + dups.join(', ') + '）');
  });

  chk(d.querySelectorAll('#gw-list .item').length === 100, '列表渲染 100 篇（实际 ' + d.querySelectorAll('#gw-list .item').length + '）');
  chk(!!d.querySelector('#gw-count'), '页顶那一行有已读进度牌 #gw-count');
  chk(d.querySelectorAll('#gw-count').length === 1, '进度牌只有一块（顶栏重建后插回，不重复插入）');
  chk(d.querySelector('#gw-count').textContent === '0 / 100 篇', '顶部显示 0 / 100 篇：' + d.querySelector('#gw-count').textContent);

  /* ---------- 已读进度牌：页顶一行内、紧挨底部页签 ---------- */
  // 需求（本次）：原先它挂在内容区最上面一行（.list-head，右对齐），
  // 在标题栏下方平白多占一行；现在挪进页顶那一行，与品牌区同处一行。
  // 「右下角」＝ 该行最右端，语序上就在底部页签那一栏的正上方，一眼能看见。
  chk(d.querySelector('.list-head') === null, '内容区不再有单独的进度行（.list-head 已删除）');
  const clsCss = fs.readFileSync(path + 'css/classic.css', 'utf8');
  chk(!/list-head/.test(clsCss), 'CSS 里也不留 .list-head 僵尸样式');
  chk(!/list-head/.test(fs.readFileSync(path + 'classic/index.html', 'utf8')), '页面里也不再出现 .list-head');
  const topbar = d.querySelector('.topbar');
  const countInTopbar = d.querySelector('.topbar #gw-count');
  chk(!!countInTopbar, '进度牌 #gw-count 在页顶栏 .topbar 里');
  chk(countInTopbar.parentElement === topbar, '进度牌是页顶那一行的直接子元素（与品牌区同一行）');
  chk([...topbar.children].map(e => e.className.split(' ')[0]).join('/') === 'brand/count-badge/top-act',
    '页顶一行依次是「品牌区 · 进度牌 · 返回键」，进度牌就在返回键左侧（实际 ' +
    [...topbar.children].map(e => e.className).join('/') + '）');
  const backBtn2 = topbar.querySelector('#top-back');
  chk(!!backBtn2 && backBtn2.tagName === 'A' && backBtn2.getAttribute('href') === '/',
    '返回键统一由 chrome.js 渲染（回首页），页面不再自造一颗、也不会与进度牌打架');
  chk(!!backBtn2.querySelector('svg') && backBtn2.querySelectorAll('svg').length === 1,
    '返回键只有一个箭头图标（不放页名文字）');
  chk(countInTopbar.compareDocumentPosition(backBtn2) & window.Node.DOCUMENT_POSITION_FOLLOWING,
    '进度牌确实排在返回键左侧（DOM 顺序就是视觉顺序）');

  // 阅读器顶栏与列表页逐项对齐：同一套 .topbar 结构、同一枚进度牌位置 ——
  // 从列表点进正文时整行导航不「换脸」（原先阅读器自带一套 reader-bar，
  // 返回键在左、页名只有一处居中进度，和列表页完全不在一根轴上）
  const openReaderBar = function () {
    d.querySelector('#gw-list .item').dispatchEvent(new window.Event('click', { bubbles: true }));
    return d.querySelector('#gw-reader > .topbar');
  };
  const rBar = openReaderBar();
  chk(!!rBar, '阅读器里有自己的 .topbar（同一套结构）');
  chk([...rBar.children].map(e => e.className.split(' ')[0]).join('/') === 'brand/count-badge/top-act',
    '阅读器顶栏与列表页同序：品牌区 · 篇号牌 · 返回键（实际 ' +
    [...rBar.children].map(e => e.className).join('/') + '）');
  chk(rBar.querySelector('.brand-page-text').textContent === '小古文',
    '阅读器里的页名同样是「小古文」，与列表页一致');
  const rBack = rBar.querySelector('#top-act');
  chk(!!rBack && !!rBack.querySelector('svg'), '阅读器返回键走全站动作位（同一颗圆形按钮）');
  chk(!/#top-act[^>]*>[\s\S]{0,200}?M6\.4 6\.4/.test(rBar.innerHTML),
    '动作位画的是返回箭头，不是 ✕（同一种行为全站同一个图标）');
  chk(rBar.querySelector('#gw-progress').textContent === '第 1 / 100 篇' &&
    rBar.querySelector('#gw-progress').classList.contains('count-badge'),
    '篇号牌用列表页同款 .count-badge，挂在品牌区与返回键之间');
  // 收起来，后面的用例仍从列表页开始
  rBar.querySelector('#top-act').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  chk(d.querySelector('#gw-reader').hidden === true, '阅读器返回键能合上阅读器');

  // 回归：顶栏第二行是「每次重绘后补一次」的，不是一次性的初始化 ——
  // 开 / 关阅读器都会整体重绘顶栏，漏补一次，页名下面那句说明就会整行消失。
  // （曾经就是这样：读完一篇返回列表，「想读哪篇点哪篇」不见了。）
  const appSub = () => d.querySelector('.app > .topbar #brand-sub').textContent;
  const readerSub = () => d.querySelector('#gw-reader > .topbar #brand-sub').textContent;
  chk(readerSub() === '想读哪篇点哪篇', '阅读器顶栏的第二行也在（与列表页同一句）');
  chk(appSub() === '想读哪篇点哪篇', '合上阅读器后，列表页顶栏的第二行还在（重绘后已补回）');
  chk(topbar.contains(d.querySelector('#brand-name')) && topbar.contains(d.querySelector('#brand-page-text')),
    '进度牌与「跬步 · 小古文」同处一行');
  // 需求（本次）：这一行所有元素垂直居中 —— 靠 .topbar 的 align-items: center，
  // 具体到小古文页，还要保证进度牌本身不拉伸、不与品牌区贴在一起
  const styleCss0 = fs.readFileSync(path + 'css/style.css', 'utf8');
  const topbarBlock = /(^|\n)\.topbar \{([\s\S]*?)\}/.exec(styleCss0);
  chk(!!topbarBlock && /align-items:\s*center;/.test(topbarBlock[2]),
    '顶栏 flex 垂直居中（徽标 / 页名 / 副标题 / 进度牌同一条中轴）');
  const badgeBlock0 = /(^|\n)\.count-badge \{([\s\S]*?)\}/.exec(clsCss);
  chk(!!badgeBlock0 && /flex:\s*none;/.test(badgeBlock0[2]),
    '进度牌 flex: none —— 不被拉伸撑成整行高，只按自身高度居中');
  const withCountBlock = /(^|\n)\.topbar-with-count \{([\s\S]*?)\}/.exec(clsCss);
  chk(!!withCountBlock && /gap:\s*10px;/.test(withCountBlock[2]),
    '进度牌与品牌区之间留 10px（长页名 / 长用户名也不会贴在一起）');
  chk(d.querySelectorAll('#gw-list .group-head').length >= 6, '按主题显示分组标题（' + d.querySelectorAll('#gw-list .group-head').length + ' 个）');

  // 需求（本次）：每个分组右侧的「随机连读」也是圆形播放键 —— 比工具栏那颗小一号。
  // 原先是一枚带「随机连读」四字的胶囊，整行被它压向右边；现在是一颗 26px 的圆键。
  const groupBtns = [...d.querySelectorAll('#gw-list .group-head .gw-play')];
  chk(groupBtns.length === d.querySelectorAll('#gw-list .group-head').length,
    '每个分组右侧都有一颗圆形播放键（' + groupBtns.length + ' 颗）');
  chk(groupBtns.every(b => b.classList.contains('gw-play-sm')),
    '分组圆键用「小号档」类名 .gw-play-sm（与工具栏那颗同族不同尺寸）');
  chk(groupBtns.every(b => b.hasAttribute('data-random-group')), '分组圆键带着本组的分组名');
  chk(groupBtns.every(b => !!b.querySelector('.play-glyph-sm svg')),
    '分组圆键画一个 ▶ 三角（.play-glyph-sm）');
  chk(groupBtns.every(b => !b.querySelector('.pause-glyph')),
    '分组圆键不带 ⏸（进行中的状态由列表高亮 + 底部播放栏表达，圆键保持单一含义）');
  chk(groupBtns.every(b => b.textContent.trim() === ''), '分组圆键没有可见文字');
  chk(groupBtns.every(b => /随机连读/.test(b.getAttribute('title') || '') &&
    /随机连读/.test(b.getAttribute('aria-label') || '')),
    '分组圆键的读屏文案与 title 都说明是「随机连读」');
  chk(groupBtns.every(b => b.parentElement.classList.contains('group-head')),
    '分组圆键就在分组标题那一行里（不另起一行）');
  // 样式：小号档比工具栏那颗小，且仍是正圆（宽高同源）
  const gwSmCss = /(^|\n)\.gw-play-sm \{([\s\S]*?)\}/.exec(clsCss);
  chk(!!gwSmCss && /margin-left:\s*auto/.test(gwSmCss[2]),
    '分组圆键靠右（margin-left: auto，与组名各守一端）');
  chk(!!gwSmCss && /width:\s*26px/.test(gwSmCss[2]) && /height:\s*26px/.test(gwSmCss[2]),
    '分组圆键是 26×26（宽高相等，仍是正圆）');
  const gwMainCss = /(^|\n)\.gw-play-main \{([\s\S]*?)\}/.exec(clsCss);
  const mainSize = gwMainCss ? parseInt((gwMainCss[2].match(/height:\s*var\(--toolbar-h\)/) ? '40' : '0'), 10) : 0;
  chk(mainSize > 26, '分组圆键确实比工具栏那颗小（26 < ' + mainSize + '）');
  chk(/已读|标记/.test(d.querySelector('#gw-done-text').textContent), '阅读器内有「标记已读」按钮');
  /* ---------- 导航：与首页同一套顶栏 + 底部页签 ---------- */
  chk(d.querySelector('.brand-text h1').textContent === '跬步', '小古文页顶栏第一行同样是「跬步」（全站一致）');
  // 需求：页面名紧随「跬步」，显示为「跬步 · 小古文」
  chk(d.querySelector('#brand-page-text').textContent === '小古文',
    '页面名紧随「跬步」右侧：' + d.querySelector('#brand-page-text').textContent);
  chk(d.title === '小古文 · 跬步', '小古文页标题为「小古文 · 跬步」（实际 ' + d.title + '）');
  // 需求：下面补一句副标题，且不重复页面名（「小古文 · 小古文」是重复）
  const sub = d.querySelector('.app > .topbar #brand-sub').textContent;
  chk(sub === '想读哪篇点哪篇', '小古文页副标题为「想读哪篇点哪篇」（实际 ' + JSON.stringify(sub) + '）');
  chk(!/小古文/.test(sub) && !/跬步/.test(sub), '副标题不与第一行重复页面名 / 应用名');
  chk(!/小古文[^。]{0,40}小古文/.test(d.querySelector('.topbar').textContent.replace(/\s+/g, '')),
    '顶栏整行不出现连着两个「小古文」');
  const dock = d.querySelector('#site-dock');
  chk(!!dock, '小古文页有底部导航栏');
  const dockItems = [...dock.querySelectorAll('.dock-item')];
  chk(dockItems.map(b => b.querySelector('.dock-label').textContent).join('/') === '古诗词/小古文/设置',
    '底部页签与首页一致（古诗词/小古文/设置）');
  chk(dockItems[1].classList.contains('active') && dockItems[1].getAttribute('aria-current') === 'page',
    '小古文页签为选中态');
  chk(d.querySelector('#classic-entry') === null, '本页不再自造「返回古诗词」入口（回首页交给页签）');
  chk(!!d.querySelector('#settings-modal'), '小古文页也能打开设置（含用户名与阅读辅助）');
  chk(!!d.querySelector('#settings-modal #input-username'), '小古文页设置里有用户名输入框');
  // 需求 2：顶部说明整段删掉，太啰嗦
  chk(d.querySelector('.notice') === null, '顶部说明段落已整段删除（不再有 .notice）');
  const htmlSrc = fs.readFileSync(path + 'classic/index.html', 'utf8');
  chk(!/不排复习日期/.test(htmlSrc), '页面里不再出现「不排复习日期」这类说明');
  chk(!/想读哪篇点哪篇[。．]/.test(htmlSrc.replace(/<p>.*?<\/p>/, '')), '不再有婆婆妈妈的说明段落');
  // 需求：标题行下面补一句副标题（页面名已在第一行，这里不再重复「小古文」）
  chk(d.querySelector('.app > .topbar #brand-sub').textContent === '想读哪篇点哪篇',
    '小古文页有副标题「想读哪篇点哪篇」（实际 ' + JSON.stringify(d.querySelector('.app > .topbar #brand-sub').textContent) + '）');
  chk(d.querySelector('#brand-page-text').textContent === '小古文',
    '页面名就是「小古文」，由 CSS 的 ::before 生成分隔符（不再写死标点）');
  chk(d.querySelectorAll('#gw-list .item .item-reason.review').length === 0, '列表里没有「复习」标签，不做复习排期');

  // 需求：阅读器顶栏不再自制一套 —— 直接复用全站 .topbar（徽标 + 跬步 · 小古文 +
  // 右侧动作位），从列表点进正文时整行导航不「换脸」
  const readerBar = d.querySelector('#gw-reader > .topbar');
  chk(!!readerBar, '阅读器顶栏复用全站 .topbar（不再是自制的 .reader-bar）');
  chk(d.querySelector('.reader-bar') === null, '自制的 .reader-bar 已删除');
  chk(!d.querySelector('#gw-back'), '不再自造一颗 #gw-back 返回键（交给全站顶栏的动作位）');

  // 需求 3：按主题分类聚合，不再按原书目录顺序
  const groupHeads = [...d.querySelectorAll('#gw-list .group-head .group-name')].map(e => e.textContent);
  chk(groupHeads.length === 7, '共 7 个主题分类（实际 ' + groupHeads.length + '）');
  chk(new Set(groupHeads).size === groupHeads.length, '同一分类只出现一个分组标题（分类已聚合，不按书本拆散）');
  const firstGroup = groupHeads[0];
  const firstGroupCount = [...d.querySelectorAll('#gw-list .group-head .group-count')][0].textContent;
  const firstGroupItems = [...d.querySelectorAll('#gw-list .item')].slice(0, parseInt(firstGroupCount));
  chk(firstGroupItems.length === parseInt(firstGroupCount), '分组计数与实际列出的篇数一致：' + firstGroup);
  chk(firstGroupItems.every(el => el.querySelector('.item-meta').textContent.includes(firstGroup) ||
    !/福尔摩斯/.test(el.textContent)), '同一分类的篇目连续排在一起');
  // 蒙学经典：4 篇必须全部出现在同一个分组里（此前只显示 2 篇）
  const mh = [...d.querySelectorAll('#gw-list .group-head')].find(h => h.querySelector('.group-name').textContent === '蒙学经典');
  chk(!!mh, '有「蒙学经典」分类');
  chk(/4 篇/.test(mh.querySelector('.group-count').textContent),
    '「蒙学经典」显示 4 篇（实际 ' + mh.querySelector('.group-count').textContent + '）');
  const allGroupItems = [];
  let node = mh.nextElementSibling;
  while (node && !node.classList.contains('group-head')) {
    if (node.classList.contains('item')) allGroupItems.push(node);
    node = node.nextElementSibling;
  }
  chk(allGroupItems.length === 4, '「蒙学经典」下面真的列出 4 篇（实际 ' + allGroupItems.length + '）');
  chk(allGroupItems.map(el => el.querySelector('.item-title').textContent.replace('已读', '').trim()).join('/') ===
    '人之初/弟子规（节选）/菊/莲',
    '「蒙学经典」四篇连续排列（' + allGroupItems.map(el => el.querySelector('.item-title').textContent).join('/') + '）');

  // 需求 6：列表每项右侧是播放键（不再是喇叭）
  chk(d.querySelectorAll('#gw-list .item-read').length === 100, '每个列表项都有播放按钮');
  chk(d.querySelectorAll('#gw-list .item .play-glyph').length === 100, '播放键用的是 ▶ 播放图标');

  // 需求 1：「全部 / 未读」是一组组合按钮（同一容器，同一时刻只有一个选中）
  const filterSeg = d.querySelector('#gw-filter-seg');
  chk(!!filterSeg && filterSeg.classList.contains('seg'), '「全部 / 未读」是组合按钮（.seg 分段控件）');
  chk(d.querySelectorAll('#gw-filter-seg button').length === 2, '组合里正好两档：全部 / 未读');
  chk(d.querySelector('#gw-filter') === null && d.querySelector('#gw-filter-unread') === null,
    '不再使用两个各自独立的 seg-toggle 按钮');
  chk([...d.querySelectorAll('#gw-filter-seg button')].map(b => b.textContent.trim()).join('/') === '全部/未读',
    '组合按钮文案为 全部 / 未读');
  chk(filterSeg.querySelector('button.active').dataset.filter === 'all', '默认选中「全部」');
  // 需求（本次）：工具栏「连读」不再是带字的胶囊，改成**圆形播放键** ——
  // 与首页「今日背诵」右侧那颗同一个组件：同一颗键上 ▶ / ⏸ 两态、无可见文字。
  // 全站凡「听」的动作都是一枚圆键，工具栏这颗不该是唯一的方胶囊。
  const readClsJs = fs.readFileSync(path + 'js/classic.js', 'utf8');
  const randomBtn = d.querySelector('#gw-random-read');
  chk(randomBtn.classList.contains('gw-play'), '「连读」是圆形播放键（.gw-play，与首页 today-read 同一套组件）');
  chk(!randomBtn.classList.contains('seg-toggle'), '不再用 seg-toggle 那副「带字胶囊」的样子');
  chk(!!randomBtn.querySelector('.play-glyph svg') && !!randomBtn.querySelector('.pause-glyph svg'),
    '圆键同时带 ▶ 与 ⏸ 两套图标（同键两态，不是两个按钮）');
  chk(randomBtn.querySelectorAll('svg').length === 2, '圆键里只有 ▶ / ⏸ 两个图标，没有别的图形');
  chk(randomBtn.textContent.trim() === '随机连读' &&
    randomBtn.querySelector('.sr-only').textContent === '随机连读',
    '可见文字为空、说明只留给读屏软件（唯一的文本节点是 .sr-only「随机连读」）');
  // 源码里连注释一起查会误伤（注释本来就在说明「连读中」这件事），先剥注释再查
  const readClsCode = readClsJs
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map(l => l.replace(/^\s*\/\/.*$/, ' ')).join('\n');
  chk(!/连读中/.test(randomBtn.textContent) && !/连读中/.test(readClsCode) &&
    !/gw-random-read-text/.test(readClsCode),
    '不再有「连读 / 连读中」这类随状态改写的可见文案（状态交给 ▶ / ⏸ 表达）');
  chk(/随机连读/.test(randomBtn.getAttribute('title')), '键义写在 title 里：' + randomBtn.getAttribute('title'));
  chk(randomBtn.dataset.on === '0' && randomBtn.getAttribute('aria-pressed') === 'false',
    '初始为「可播放」态（data-on=0 / aria-pressed=false）');
  // 需求 1：搜索框 + 「全部 / 未读」组合 + 「连读」圆键三样都在同一行，且不压缩
  const bar = d.querySelector('.toolbar');
  chk(bar.children.length === 3, '工具栏是一行三样：搜索框 / 全部·未读组合 / 连读圆键');
  const barCss = fs.readFileSync(path + 'css/classic.css', 'utf8');
  chk(/\.toolbar \{[^}]*display:\s*flex/.test(barCss) && !/\.toolbar \{[^}]*flex-wrap:\s*wrap/.test(barCss),
    '工具栏不换行，三样始终同一行');
  chk(/\.filter-seg \{[^}]*flex:\s*0 0 auto/.test(barCss) && /\.gw-play-main \{[^}]*flex:\s*0 0 auto/.test(barCss),
    '筛选组合与「连读」圆键不压缩（搜索框独占剩余宽度）');
  chk(!randomBtn.classList.contains('toolbar-read'), '不再使用旧的 toolbar-read 专属样式');
  chk(!/\.seg-toggle/.test(barCss), '样式表里不再留 .seg-toggle 僵尸规则');

  // 需求：工具栏三样（搜索框 / 全部·未读组合 / 连读圆键）高度必须一致。
  // 组合的高度由「内层按钮 + 内边距 + 描边」叠出，曾因全局 .seg.mini button 的
  // 5px 垂直 padding 只有 37px，比搜索框与「连读」（40px）矮一截；
  // 现在三样统一读同一个高度变量，谁也不能再各算各的。
  const toolbarCss = barCss.match(/\.toolbar \{([^}]*)\}/)[1];
  const H = (toolbarCss.match(/--toolbar-h:\s*(\d+)px/) || [])[1];
  chk(!!H, '工具栏声明统一行高变量 --toolbar-h（' + H + 'px）');
  ['\.search-input', '\.gw-play-main'].forEach(sel => {
    const css = barCss.match(new RegExp(sel + ' \\{([^}]*)\\}'))[1];
    chk(/height:\s*var\(--toolbar-h\)/.test(css) && /box-sizing:\s*border-box/.test(css),
      sel + ' 高度取自 --toolbar-h 且含描边（不高出工具栏）');
  });
  // 圆键要真正「方圆」：宽度也取自同一个高度，宽高相等才是正圆（否则会压成椭圆）
  const mainCss = barCss.match(/\.gw-play-main \{([^}]*)\}/)[1];
  chk(/width:\s*var\(--toolbar-h\)/.test(mainCss),
    '「连读」圆键宽度与高度同源（--toolbar-h），宽高相等才是正圆');
  chk(/border-radius:\s*50%/.test(barCss.match(/\.gw-play \{([^}]*)\}/)[1]), '圆键 border-radius: 50%');
  chk(/\.gw-play-main \{([^}]*)\}?/.test(barCss) && /padding:\s*0/.test(barCss.match(/\.gw-play \{([^}]*)\}/)[1]),
    '圆键不做内边距（图标由 flex 居中，不靠 padding 撑）');
  // 配色走天水碧（小古文主色），与首页那颗走缃色是同一个道理：主色随页面走
  chk(/color:\s*var\(--blue\)/.test(barCss.match(/\.gw-play \{([^}]*)\}/)[1]),
    '圆键用天水碧（--blue，小古文页主色）');
  const segCss = barCss.match(/\.filter-seg \{([^}]*)\}/)[1];
  chk(/height:\s*var\(--toolbar-h\)/.test(segCss) && /box-sizing:\s*border-box/.test(segCss)
    && /align-items:\s*stretch/.test(segCss),
    '「全部 / 未读」外框同样定高为 --toolbar-h，内层按钮铺满外框');
  const filterBtnCss = barCss.match(/\.filter-seg button \{([^}]*)\}/)[1];
  chk(/padding:\s*0\s+13px/.test(filterBtnCss) && /align-items:\s*center/.test(filterBtnCss),
    '组合按钮垂直方向只由外框决定高度，压过 .seg.mini button 的 5px 垂直 padding');

  // 分组圆键点了要真能连读本组：它是 <button> 不是摆设图标，而且点击不该冒泡到条目上。
  // 这一份 jsdom 没装假语音引擎（Speech.supported() 为 false），所以点击后的
  // 结果应当是「提示不支持语音」而不是「什么都没发生」—— 这刚好证明事件确实接到了按钮上。
  const mhBtn = mh.querySelector('.gw-play-sm');
  mhBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
  const toast = d.querySelector('.toast');
  chk(!!toast && /语音朗读/.test(toast.textContent),
    '点分组圆键确实触发了连读（无语音环境时提示「不支持语音朗读」：' +
    (toast ? toast.textContent : '无提示') + '）');
  chk(d.querySelector('#gw-reader') === null || d.querySelector('#gw-reader').hidden === true,
    '分组圆键的点击没有冒泡到条目本身（不会顺手打开某篇阅读器）');

  // 搜索
  const search = d.querySelector('#gw-search');
  search.value = '三字经';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  chk(d.querySelectorAll('#gw-list .item').length === 1, '搜索「三字经」命中 1 篇（实际 ' + d.querySelectorAll('#gw-list .item').length + '）');
  search.value = '';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  chk(d.querySelectorAll('#gw-list .item').length === 100, '清空搜索恢复 100 篇');

  // 打开阅读器（长文整页阅读，而不是卡片弹窗）
  const longItem = [...d.querySelectorAll('#gw-list .item')].find(el => el.textContent.includes('盘古开天地'));
  longItem.dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#gw-reader').hidden === false, '点击条目打开整页阅读器');
  chk(d.body.classList.contains('reader-open'), '打开时锁定页面滚动');
  chk(d.querySelector('#rd-title').textContent === '盘古开天地', '阅读器标题正确');
  chk(d.querySelector('#rd-meta').textContent.includes('太平御览'), '阅读器显示出处');
  chk(d.querySelector('#rd-text').textContent.length > 100, '长文完整渲染（' + d.querySelector('#rd-text').textContent.length + ' 字）');
  // 需求 10：默认字号降一级（19 → 17）
  chk(d.querySelector('#rd-text').style.fontSize === '17px', '默认字号降一级为 17px（实际 ' + d.querySelector('#rd-text').style.fontSize + '）');
  // 需求 7：小古文正文行距继续压紧（2.2 → 2.0 → 1.8）—— jsdom 不计算继承行高，改从 CSS 源码校验
  const classicCss = fs.readFileSync(path + 'css/classic.css', 'utf8');
  const rdBlock = /(^|\n)\.reader-text \{([\s\S]*?)\}/.exec(classicCss);
  chk(!!rdBlock && /line-height:\s*1\.8;/.test(rdBlock[2]), '小古文正文行距压紧为 1.8');
  const pyBlock = /(^|\n)\.reader-text\.with-pinyin \{([\s\S]*?)\}/.exec(classicCss);
  chk(!!pyBlock && /line-height:\s*2\.5;/.test(pyBlock[2]), '注音档行距同步压紧为 2.5');
  // 正文与标题居中：text-align 管行内居中，fit-content + margin auto 管整块居中
  chk(!!rdBlock && /text-align:\s*center;/.test(rdBlock[2]), '小古文正文文字居中');
  chk(!!rdBlock && /max-width:\s*fit-content;/.test(rdBlock[2]) && /margin:\s*[^;]*\bauto\b/.test(rdBlock[2]),
    '小古文正文块左右居中（fit-content + margin auto）');
  chk(!!pyBlock && /white-space:\s*normal;/.test(pyBlock[2]), '注音档改回 normal，居中时不被保留空白挤歪');
  chk(d.querySelector('#rd-trans').hidden === true, '译文默认折叠');

  // 字号调节：六档 13/15/17/19/21/23
  d.querySelector('#rd-font-up').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#rd-text').style.fontSize === '19px', '放大字号生效（' + d.querySelector('#rd-text').style.fontSize + '）');
  d.querySelector('#rd-font-down').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#rd-text').style.fontSize === '17px', '缩小字号生效');
  chk(window.localStorage.getItem('poem_classic_font_v1') === '17', '字号记忆持久化');
  // 需求 2：A－ / A＋ 是一组组合按钮（同一容器）
  const fontSeg = d.querySelector('#rd-font-seg');
  chk(!!fontSeg && fontSeg.classList.contains('seg') && fontSeg.classList.contains('mini'),
    'A－ / A＋ 是组合按钮');
  chk([...fontSeg.querySelectorAll('button')].map(b => b.textContent.trim()).join('/') === 'A－/A＋',
    '组合按钮文案为 A－ / A＋');
  // 需求 10：A- 可以再减两级（17 → 15）
  d.querySelector('#rd-font-down').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#rd-text').style.fontSize === '15px',
    '再点 A－ 可降一级到 15px（实际 ' + d.querySelector('#rd-text').style.fontSize + '）');
  // Issue #55：默认档不动，A－ 在 15px 之下还能再多点一次（15 → 13），到 13px 才到底
  d.querySelector('#rd-font-down').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#rd-text').style.fontSize === '13px',
    'A－ 在 15px 之下仍能再降一档到 13px（实际 ' + d.querySelector('#rd-text').style.fontSize + '）');
  chk(window.localStorage.getItem('poem_classic_font_v1') === '13', '最细档同样持久化');
  d.querySelector('#rd-font-down').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#rd-text').style.fontSize === '13px',
    '到底后继续点 A－ 不再变化，最小字号锁定 13px');
  // 恢复默认档，后续断言不受影响
  d.querySelector('#rd-font-up').dispatchEvent(new window.Event('click', { bubbles: true }));
  d.querySelector('#rd-font-up').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#rd-text').style.fontSize === '17px',
    'A＋ 回到默认档 17px（实际 ' + d.querySelector('#rd-text').style.fontSize + '）');

  // 译文展开
  d.querySelector('#rd-trans-toggle').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#rd-trans').hidden === false, '点译文图标展开译文');
  chk(d.querySelector('#rd-trans-toggle').dataset.on === '1', '译文按钮进入选中态（配色统一高亮）');
  // 回归：译文开关按钮的读屏文案写在 #rd-trans-toggle-text，
  // 不能与可见译文段落 #rd-trans-text 共用同一个 id（曾因重复 id 导致译文空白）
  chk(d.querySelectorAll('[id="rd-trans-text"]').length === 1, 'id rd-trans-text 唯一，不与按钮读屏文案冲突');
  chk(d.querySelector('#rd-trans-toggle-text').textContent === '收起译文', '读屏文案同步为「收起译文」');
  chk(d.querySelector('#rd-trans-text').textContent.length > 20, '白话译文段落有内容（不空白）');
  // 译文框下方照实显示来源口径 —— 用户看得见「这段译文是怎么来的」
  const srcEl = d.querySelector('#rd-trans-src');
  chk(!!srcEl, '译文框有来源注脚元素 #rd-trans-src');
  chk(srcEl && /公有领域|通行译注/.test(srcEl.textContent),
    '阅读器照实显示小古文译文的来源：' + (srcEl ? srcEl.textContent : ''));

  // 标记已读
  d.querySelector('#gw-done').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(/已读，再点一次取消/.test(d.querySelector('#gw-done-text').textContent), '标记后读屏文案变为「已读，再点一次取消」');
  chk(d.querySelector('#gw-done').classList.contains('is-done'), '标记已读按钮进入高亮态');
  chk(d.querySelector('#gw-progress').classList.contains('is-done'),
    '已读后顶栏篇号牌转成深绿实底（与列表页未读 / 已读同一套语言）');
  const store = JSON.parse(window.localStorage.getItem('poem_classic_read_v1'));
  chk(store['gw-17'] && store['gw-17'].read === true, '已读状态写入 localStorage（独立于古诗词进度）');
  chk(!window.localStorage.getItem('poem_recite_progress_v1'), '不会写古诗词进度 key，两边互不干扰');
  chk(d.querySelector('#gw-count').textContent === '1 / 100 篇', '顶部进度更新为 1 / 100 篇');
  chk(d.querySelector('.topbar #gw-count').textContent === '1 / 100 篇',
    '进度更新的是页顶那一行里的同一块牌子（不是另开一份）');

  // 返回列表：阅读器顶栏的动作位由全站渲染，测试里直接调 closeReader 的入口（点击返回）
  d.querySelector('#gw-reader > .topbar #top-act').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  chk(d.querySelector('#gw-reader').hidden === true, '返回后阅读器关闭');
  chk(d.querySelectorAll('#gw-list .item.done').length === 1, '列表中已读条目有已读标记');

  // 未读筛选
  d.querySelector('#gw-filter-seg button[data-filter="unread"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelectorAll('#gw-list .item').length === 99, '「未读」筛选剩 99 篇（实际 ' + d.querySelectorAll('#gw-list .item').length + '）');
  d.querySelector('#gw-filter-seg button[data-filter="all"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelectorAll('#gw-list .item').length === 100, '切回「全部」恢复 100 篇');

  // 注音与朗读（阅读辅助）
  d.querySelector('#gw-list .item').dispatchEvent(new window.Event('click', { bubbles: true }));
  const rdSeg = d.querySelector('#rd-pinyin-seg');
  chk(!!rdSeg, '阅读器有注音档位按钮组');
  chk(rdSeg.querySelectorAll('button').length === 3, '阅读器注音有 3 档');
  chk(!!d.querySelector('#rd-read-btn'), '阅读器有朗读按钮');

  // 需求：播放与暂停不再并排显示 —— 同一颗键上 ▶ / ⏸ 互斥切换；
  // 白话译文的朗读键也不再和正文键并排（挪进译文框，展开才出现）
  const clsHtml = fs.readFileSync(path + 'classic/index.html', 'utf8');
  chk(d.querySelector('#rd-read-combo') === null, '不再有「原文 / 译文」并排的组合键');
  const readBtn = d.querySelector('#rd-read-btn');
  chk(!!readBtn, '阅读器有正文朗读键');
  chk(!!readBtn.querySelector('.play-glyph svg') && !!readBtn.querySelector('.pause-glyph svg'),
    '正文键同时带 ▶ 与 ⏸ 两套图标（同键两态，不是两个按钮）');
  chk(readBtn.classList.contains('mini-btn') && !readBtn.querySelector('.play-glyph').classList.contains('btn-icon') === false,
    '正文键与译文开关同款样式');
  const transReadBtn = d.querySelector('#rd-trans-read');
  chk(!!transReadBtn, '译文有独立朗读键');
  chk(transReadBtn.closest('#rd-actions-icons') === null, '译文朗读键不在第一排工具条里（不与正文键并排）');
  chk(transReadBtn.closest('.trans-box') !== null, '译文朗读键在译文框里，展开译文才出现');
  chk(d.querySelectorAll('.reader-actions #rd-read-btn, .reader-actions #rd-trans-read').length === 1,
    '工具条上只有一个播放信号');
  chk(!/>\s*朗读全文\s*</.test(clsHtml), '不再出现「朗读全文」文案');

  // 译文开关仍是纯图标按钮，文案只给读屏
  const transBtn = d.querySelector('#rd-trans-toggle');
  chk(!!transBtn.querySelector('svg'), '「显示译文」按钮是 SVG 图标');
  chk(!/显示译文/.test(transBtn.cloneNode(true).querySelector('.sr-only') ? transBtn.textContent.replace(transBtn.querySelector('.sr-only').textContent, '') : transBtn.textContent),
    '译文按钮可见文字里不出现「显示译文」（只留在 .sr-only 给读屏软件）');
  chk(d.querySelector('#rd-trans-toggle').classList.contains('mini-btn'), '译文按钮与组合键同款样式');

  // 需求：阅读辅助工具条拆成两行，每行都排成一行（不再折成七八个换行）
  const rows = [...d.querySelectorAll('.reader-actions')];
  chk(rows.length === 2, '阅读辅助工具条是两行（实际 ' + rows.length + '）');
  const row1 = d.querySelector('#rd-actions-main');
  const row2 = d.querySelector('#rd-actions-icons');
  chk(!!row1 && !!row2, '两行工具条各有独立容器（主行 / 图标行）');
  // 需求 1：对齐 / 字号 / 注音 在上一行
  chk(row1.children.length === 3 &&
    row1.querySelector('#rd-align-seg') && row1.querySelector('#rd-font-seg') && row1.querySelector('#rd-pinyin-seg'),
    '上一行依次是 对齐 / 字号 / 注音 三组按钮');
  // 需求 1：正文朗读键 / 译文开关 / 标记已读 在下行
  chk(row2.children.length === 3 &&
    row2.querySelector('#rd-read-btn') && row2.querySelector('#rd-trans-toggle') &&
    row2.querySelector('#gw-done'),
    '下一行依次是 正文朗读键 / 译文开关 / 标记已读 三组（实际 ' + row2.children.length + '）');
  chk(row2.querySelectorAll('button > svg, button > span > svg').length >= 3, '图标行的按钮全部是 SVG 图标');
  chk(row2.querySelectorAll(':scope > button .sr-only').length === 3,
    '「正文朗读 / 译文开关 / 标记已读」的文案只留给读屏软件（.sr-only）');
  chk(d.querySelectorAll('.reader-actions .mini-btn, .reader-actions .seg.mini').length === 6,
    '工具条按钮共用同一套样式类（实际 ' +
    d.querySelectorAll('.reader-actions .mini-btn, .reader-actions .seg.mini').length + '）');
  const actionsCss = fs.readFileSync(path + 'css/classic.css', 'utf8');
  const actBlock = /(^|\n)\.reader-actions \{([\s\S]*?)\}/.exec(actionsCss);
  chk(!!actBlock && /flex-wrap:\s*nowrap;/.test(actBlock[2]), '工具条不换行，每行都排成一行');
  chk(/\.reader-actions\.icon-row/.test(actionsCss), '图标行有独立间距（第二行靠上、贴着第一行）');
  chk(/\.icon-row > \.mini-btn \{[^}]*width:\s*38px/.test(actionsCss), '译文开关 / 标记已读等宽，排成一条');
  // 需求：第二排图标必须真正水平居中（flex 居中 + 去掉 SVG 行内基线留白）
  const iconBtnBlock = /(^|\n)\.icon-row > \.mini-btn \{([\s\S]*?)\}/.exec(actionsCss);
  chk(!!iconBtnBlock && /line-height:\s*0;/.test(iconBtnBlock[2]),
    '图标按钮压掉行盒基线留白（line-height: 0），图标才真居中');
  // 需求（Issue #44）：圆形图标键必须是正圆，不许纵向被拉扁。
  // 成因：基础规则只给 `min-height: 38px`（下限），本行内容一高就被 flex 拉到
  // 40 多 px，而 width 钉死 38px —— 于是圆环变椭圆，看着「不够圆、纵向有点扁」。
  // 解法：min-height 归零 + height 写死同一个值 + 禁止 flex-shrink。
  chk(!!iconBtnBlock && /min-height:\s*0;/.test(iconBtnBlock[2]),
    '圆形图标键的 min-height 归零（下限交还给 height，避免被 flex 拉高）');
  chk(!!iconBtnBlock && /height:\s*38px;/.test(iconBtnBlock[2]),
    '圆形图标键显式 height: 38px（与 width 相等，才成正圆）');
  chk(!!iconBtnBlock && /flex:\s*0 0 auto;/.test(iconBtnBlock[2]),
    '圆形图标键禁止 flex-shrink（排不下时整行横滑，也不压扁圆）');
  const iconW = /width:\s*(\d+)px/.exec(iconBtnBlock ? iconBtnBlock[2] : '');
  const iconH = /height:\s*(\d+)px/.exec(iconBtnBlock ? iconBtnBlock[2] : '');
  chk(!!iconW && !!iconH && iconW[1] === iconH[1],
    '圆形图标键的宽高取同一个数值（' + (iconW && iconW[1]) + ' / ' + (iconH && iconH[1]) + '）');
  // 需求：两排按钮都整行居中（与小古文正文、古诗正文共用同一条中轴）
  const actionsRow = /(^|\n)\.reader-actions \{([\s\S]*?)\}/.exec(actionsCss);
  chk(!!actionsRow && /justify-content:\s*center;/.test(actionsRow[2]), '工具条两行都整行水平居中');
  // 需求：译文键的 ▶ / ⏸ 是同一颗键的两态。
  // 光断言「有这两条规则」不够 —— 还要保证它们真正生效：
  //   `.trans-read .btn-icon { display: inline-flex }` 是 0-2-0，
  //   若互斥规则只有 0-2-0（`.trans-read .pause-glyph`），后者会被前者
  //   按「同特异性、后写胜出」压回去，▶ 与 ⏸ 就并排同时显示。
  //   所以互斥规则必须带上 `.btn-icon` 把特异性抬到 0-3-0。
  chk(/\.trans-read \.btn-icon\.pause-glyph \{ display: none; \}/.test(actionsCss),
    '译文键的 ▶ / ⏸ 互斥显示（互斥规则的 specificity 高于 .btn-icon 的 display）');
  chk(/\.trans-read\[data-on="1"\] \.btn-icon\.play-glyph \{ display: none; \}/.test(actionsCss),
    '译文键播放中原地换成 ⏸，不再显示 ▶');
  chk(/\.trans-read\[data-on="1"\] \.btn-icon\.pause-glyph \{ display: inline-flex; \}/.test(actionsCss),
    '译文键暂停态用同一颗键的 ⏸ 表达');
  // 「首页诗词详情页」用的是同一套译文键，但它只引 style.css。
  // 组件样式必须住在两页都会加载的 style.css 里，否则首页那颗键完全没样式，
  // 且互斥规则不生效 —— 两个图标并排显示。
  const styleCss = fs.readFileSync(path + 'css/style.css', 'utf8');
  const indexHtml = fs.readFileSync(path + 'index.html', 'utf8');
  const indexUsesClassic = /classic\.css/.test(indexHtml);
  const cssForStyle = indexUsesClassic ? styleCss + actionsCss : styleCss;
  chk(/\.trans-box \{/.test(cssForStyle), '首页详情页的译文框有样式（不是裸元素）');
  chk(/\.trans-read \{/.test(cssForStyle), '首页详情页的译文朗读键有样式（不是浏览器默认按钮）');
  chk(/\.trans-read \.btn-icon\.pause-glyph \{ display: none; \}/.test(cssForStyle),
    '首页详情页的译文键 ▶ / ⏸ 同样互斥，不同时并排');
  chk(/\.trans-head \{/.test(cssForStyle), '译文标题与译文键排成一行（标题左、键右）');
  // 需求（Issue #44）：译文键是可圆角胶囊，纵向不许被 flex 拉高。
  // .trans-head 是 flex 行，按钮若默认 stretch，标题一换行胶囊就跟着变高变扁。
  const transReadBlock = /(^|\n)\.trans-read \{([\s\S]*?)\}/.exec(cssForStyle);
  chk(!!transReadBlock && /flex:\s*none;/.test(transReadBlock[2]),
    '译文键 flex: none，不被 .trans-head 的行高拉伸（胶囊不变扁）');
  chk(!!transReadBlock && /line-height:\s*[\d.]+;/.test(transReadBlock[2]),
    '译文键行高明确，高度由自身决定而非被标题撑开');
  chk(/\.done-btn\.is-done/.test(actionsCss), '「标记已读」按钮有已读高亮态');
  // 需求：上一篇 / 下一篇必须避开底部播放栏 / 页签，否则被压掉约三成、点不着
  const navBlock = /(^|\n)\.reader-nav \{([\s\S]*?)\}/.exec(actionsCss);
  chk(!!navBlock && /margin:\s*26px 0 calc\(118px \+ var\(--safe-bottom\)\)/.test(navBlock[2]),
    '阅读器底部导航预留 118px + 安全区，不被底栏压住');
  const readerBlock = /(^|\n)\.reader \{([\s\S]*?)\}/.exec(actionsCss);
  chk(!!readerBlock && /z-index:\s*66/.test(readerBlock[2]),
    '阅读器 z-index（66）高于底部页签（65），页签不浮在正文之上');
  chk(/body\.reader-open \.dock \{ display: none; \}/.test(actionsCss),
    '阅读器打开时收起底部页签，把底部空间让给翻篇导航');
  // 窄屏那一档（36px）同样要宽高相等，否则小屏上又扁回去
  chk(/\.icon-row > \.mini-btn \{ width: 36px; min-height: 0; height: 36px; \}/.test(actionsCss),
    '窄屏档位的圆形图标键同为 36×36，宽高一致');

  // 需求 2：正文对齐三档，左 / 中 / 右 都是 SVG 图标，由用户自己选
  const alignSeg = d.querySelector('#rd-align-seg');
  chk(!!alignSeg, '工具条上有「正文对齐」组合按钮');
  chk([...alignSeg.querySelectorAll('button')].map(b => b.dataset.align).join('/') === 'left/center/right',
    '对齐三档为 左 / 中 / 右');
  chk(alignSeg.querySelectorAll('button svg').length === 3, '三个对齐按钮都是 SVG 图标');
  chk(alignSeg.querySelector('button[data-align="center"]').classList.contains('active'),
    '默认选中「居中对齐」（古诗短句居中好看）');
  chk(d.querySelector('#rd-text').dataset.align === 'center', '正文默认居中（data-align="center"）');
  chk(new RegExp('\\.reader-body \\.reader-text\\[data-align="left"\\]').test(actionsCss),
    'CSS 里有左对齐规则（长古文左对齐更好读）');
  chk(new RegExp('\\.reader-body \\.reader-text\\[data-align="right"\\]').test(actionsCss),
    'CSS 里有右对齐规则');
  const alignBtn = k => d.querySelector('#rd-align-seg button[data-align="' + k + '"]');
  alignBtn('left').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#rd-text').dataset.align === 'left', '点左对齐立即生效（data-align="left"）');
  chk(alignBtn('left').classList.contains('active') && !alignBtn('center').classList.contains('active'),
    '对齐按钮选中态互斥（同一时刻只有一个是高亮）');
  chk(window.localStorage.getItem('poem_classic_align_v1') === 'left', '对齐方式持久化到 localStorage');
  alignBtn('right').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#rd-text').dataset.align === 'right', '点右对齐立即生效');
  // 重新打开阅读器（翻篇）后对齐设置还在
  d.querySelector('#rd-next').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#rd-text').dataset.align === 'right', '翻到下一篇后仍保持用户选的对齐方式');
  chk(alignBtn('right').classList.contains('active'), '翻篇后对齐按钮高亮同步');
  alignBtn('center').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#rd-text').dataset.align === 'center', '切回居中对齐');
  // 需求：注音档位文案精简为 不注音 / 生字 / 全文
  const segLabels = [...d.querySelectorAll('#rd-pinyin-seg button')].map(b => b.textContent.trim());
  chk(segLabels.join('/') === '不注音/生字/全文', '注音档位文案精简为 不注音/生字/全文（' + segLabels.join('/') + '）');
  // 阅读辅助默认开启 → 打开古文即自动注音（需求 5：开关要有可见差别）
  chk(d.querySelectorAll('#rd-text ruby').length > 5,
    '阅读辅助开启时打开古文自动注音（' + d.querySelectorAll('#rd-text ruby').length + ' 个 ruby）');
  chk(/qū|qǔ/.test(d.querySelector('#rd-text').textContent) === false, '拼音走 rt 标签，不混进正文');

  const rdClick = (m) => d.querySelector('#rd-pinyin-seg button[data-mode="' + m + '"]')
    .dispatchEvent(new window.Event('click', { bubbles: true }));

  // 只标生字：注音量少于全文，且不注音的常见字保留为纯文本
  rdClick('rare');
  const rdRare = d.querySelectorAll('#rd-text ruby').length;
  const rdTotal = d.querySelector('#rd-text').textContent.replace(/\s/g, '').length;
  chk(rdRare > 0, '「只标生字」能标出生字（' + rdRare + ' 个 ruby）');
  chk(rdRare < rdTotal, '「只标生字」不会把整篇都注上（' + rdRare + ' < ' + rdTotal + '）');
  chk(/qū|qǔ/.test(d.querySelector('#rd-text').textContent) === false, '拼音走 rt 标签，不混进正文');
  chk(window.localStorage.getItem('poem_helper_pinyin_v1') === 'rare', '注音档位持久化为 rare');

  // 全文注音
  rdClick('all');
  chk(d.querySelectorAll('#rd-text ruby').length > rdRare,
    '「全文注音」比「只标生字」注得多（' + d.querySelectorAll('#rd-text ruby').length + ' > ' + rdRare + '）');

  // 关闭
  rdClick('off');
  chk(d.querySelectorAll('#rd-text ruby').length === 0, '选「不注音」关闭注音');
  d.querySelector('#gw-reader > .topbar #top-act').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

  // 取消已读
  const doneItem = d.querySelector('#gw-list .item.done');
  doneItem.dispatchEvent(new window.Event('click', { bubbles: true }));
  d.querySelector('#gw-done').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#gw-done-text').textContent === '标记为已读', '再点一次可取消已读');
  chk(d.querySelector('#gw-done').classList.contains('is-done') === false, '取消后按钮恢复常态');
  chk(d.querySelector('#gw-progress').classList.contains('is-done') === false,
    '取消已读后顶栏篇号牌恢复常态');
  chk(!JSON.parse(window.localStorage.getItem('poem_classic_read_v1'))['gw-17'], '取消后从存储中移除');

  console.log(fails === 0 ? '\n🎉 小古文测试全部通过' : '\n❌ ' + fails + ' 项失败');
  process.exit(fails ? 1 : 0);
}, 400);
