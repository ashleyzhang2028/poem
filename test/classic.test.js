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
  // 点阅读器顶栏那颗「返回」。顶栏没渲染出 #top-act 时不要对 null 调用 ——
  // 那会让整层测试以 TypeError 崩在无关的地方，把真正的病根埋掉。
  // 兜底：拿不到按钮就把阅读器直接合上，保证后续用例仍从列表页开始。
  const clickReaderBack = function () {
    const btn = d.querySelector('#gw-reader > .topbar #top-act');
    if (!btn) { d.querySelector('#gw-reader').hidden = true; return false; }
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  };
  const rBar = openReaderBar();
  chk(!!rBar, '阅读器里有自己的 .topbar（同一套结构）');
  // 回归：整个小古文页有**两条** .topbar（页面顶部那条 + 阅读器里那条），
  // 两条各自挂着一枚页面小件（列表页的「0 / 100 篇」、阅读器的「第 N / 100 篇」）。
  // chrome.js 的 renderBar 重建顶栏时必须把**每一枚**小件都出栈再插回 ——
  // 只搬第一枚时，阅读器那条顶栏重建后篇号牌整块消失，
  // 下面那句「rBar.querySelector('#top-act')」就会对着 null 调用而整层测试炸掉。
  chk(d.querySelectorAll('.topbar > .count-badge').length === 2,
    '两条顶栏各自的小件都在（列表页 0 / 100 篇 + 阅读器第 N / 100 篇，实际 ' +
    d.querySelectorAll('.topbar > .count-badge').length + ' 枚）');
  chk(!!rBar.querySelector('#gw-progress') && rBar.querySelector('#gw-progress').classList.contains('is-ready'),
    '阅读器顶栏重建后篇号牌仍在（小件按枚迁回，不是只搬第一枚）');
  chk([...rBar.children].map(e => e.className.split(' ')[0]).join('/') === 'brand/count-badge/top-act',
    '阅读器顶栏与列表页同序：品牌区 · 篇号牌 · 返回键（实际 ' +
    [...rBar.children].map(e => e.className).join('/') + '）');
  chk(rBar.querySelector('.brand-page-text').textContent === '小古文',
    '阅读器里的页名同样是「小古文」，与列表页一致');
  // 回归防线：整个页面里 #top-act 只能有一枚 —— 只有阅读器那条顶栏才是动作位。
  // 曾经 setHeaderAction 把 headerAction 挂在**所有**顶栏上，页面那条也跟着渲染成
  // id="top-act"：同一页面出现两枚同名 id（HTML 不合法），并且
  // `readerBar.querySelector('#top-act')` 在 jsdom ≥27 里只认文书里第一枚，
  // 阅读器那条直接查不到按钮 —— 正是 CI 上那三条 ✗ 的病根。
  chk(d.querySelectorAll('#top-act').length === 1,
    '全页只有一枚 #top-act（动作位只归阅读器那条顶栏，实际 ' +
    d.querySelectorAll('#top-act').length + ' 枚）');
  chk(d.querySelectorAll('#top-back').length === 1,
    '全页只有一枚 #top-back（阅读器那条合上时不再跟着渲染第二枚返回键，实际 ' +
    d.querySelectorAll('#top-back').length + ' 枚）');
  // 页面顶部那条顶栏不该被阅读器的动作「换脸」：它仍是「回首页」的返回键
  const appBarBack = d.querySelector('.app > .topbar #top-back');
  chk(!!appBarBack && appBarBack.getAttribute('href') === '/',
    '阅读器打开时，页面顶部那条顶栏仍是「回首页」的返回键（不跟着变成动作按钮）');
  const rBack = rBar.querySelector('#top-act');
  chk(!!rBack && !!rBack.querySelector('svg'), '阅读器返回键走全站动作位（同一颗圆形按钮）');
  // ⚠️ 后面要用这枚按钮做交互，先确认它真的在：曾经 top-act 选不到（当场为 null）时
  // 直接往下跑，下一句对 null 调 dispatchEvent，整层测试以 TypeError 崩掉 ——
  // 报错指向测试代码，真正的病根（顶栏没渲染出动作位）反而被埋掉了。
  // 这里显式收口：拿不到就单独失败并跳过后续依赖它的断言。
  if (!rBack) {
    chk(false, '阅读器顶栏缺少 #top-act，跳过依赖它的后续校验');
    chk(false, '阅读器返回键能合上阅读器（因 #top-act 缺失而跳过）');
    // 把阅读器收回去，后面的用例仍从列表页开始
    d.querySelector('#gw-reader').hidden = true;
  } else {
    chk(!/#top-act[^>]*>[\s\S]{0,200}?M6\.4 6\.4/.test(rBar.innerHTML),
      '动作位画的是返回箭头，不是 ✕（同一种行为全站同一个图标）');
    chk(rBar.querySelector('#gw-progress').textContent === '第 1 / 100 篇' &&
      rBar.querySelector('#gw-progress').classList.contains('count-badge'),
      '篇号牌用列表页同款 .count-badge，挂在品牌区与返回键之间');
    // 收起来，后面的用例仍从列表页开始
    rBack.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    chk(d.querySelector('#gw-reader').hidden === true, '阅读器返回键能合上阅读器');
  }

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
  // 只看**页面顶部那条**顶栏：阅读器那条的动作文案是「返回小古文列表」，
  // 那是刻意的读屏说明，不算「重复页面名」。
  chk(!/小古文[^。]{0,40}小古文/.test(d.querySelector('.app > .topbar').textContent.replace(/\s+/g, '')),
    '页面顶栏整行不出现连着两个「小古文」');
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
  // 卡头一行：组名 / 篇数 / 圆键，三样都在同一行，且圆键是这一行的最后一个
  chk(mh.children.length === 3 && mh.lastElementChild.classList.contains('gw-play-sm'),
    '卡头一行三样：组名 / 篇数 / 随机连读圆键（圆键收在行尾）');
  const allGroupItems = [];
  let node = mh.nextElementSibling;
  while (node && !node.classList.contains('group-head')) {
    if (node.classList.contains('item')) allGroupItems.push(node);
    node = node.nextElementSibling;
  }
  chk(allGroupItems.length === 4, '「蒙学经典」下面真的列出 4 篇（实际 ' + allGroupItems.length + '）');
  // 序号圆现在是标题行的一部分（.item-num），读文案要把序号剔掉再比
  chk(allGroupItems.map(el => el.querySelector('.item-title').textContent.replace('已读', '').trim()
    .replace(/^\d+/, '')).join('/') === '人之初/弟子规（节选）/菊/莲',
    '「蒙学经典」四篇连续排列（' + allGroupItems.map(el => el.querySelector('.item-title').textContent).join('/') + '）');

  // 需求（Issue #55）：同类别的文章合并进**同一张卡片**，不再每篇各占一张卡。
  // 一个主题 = 一张 .group-card（卡头 .group-head + 卡身若干 .item）。
  const cards = [...d.querySelectorAll('#gw-list .group-card')];
  chk(cards.length === 7, '共 7 张主题卡片（实际 ' + cards.length + '）');
  chk(d.querySelectorAll('#gw-list .group-head').length === cards.length,
    '每张卡片一个卡头，卡片数与卡头数一致');
  chk(cards.every(c => !!c.querySelector(':scope > .group-head')),
    '卡头是该卡片的直接子元素（主题名长在卡上，不是飘在卡外）');
  chk(cards.every(c => c.querySelectorAll(':scope > .item').length > 0),
    '每张卡片卡身至少列出一篇（同类文章真的合进了一张卡）');
  const cardItemTotal = cards.reduce((n, c) => n + c.querySelectorAll(':scope > .item').length, 0);
  chk(cardItemTotal === 100, '7 张卡片合计仍是 100 篇（实际 ' + cardItemTotal + '）');
  // 「同一类只在一张卡里」：不出现两张同名卡片
  const cardNames = cards.map(c => c.querySelector('.group-head .group-name').textContent);
  chk(new Set(cardNames).size === cardNames.length, '同一主题只有一张卡片（不同卡片主题名不重复）');
  // 「蒙学经典」4 篇就在同一张卡里
  const mengCard = cards.find(c => c.dataset.group === '蒙学经典');
  chk(!!mengCard, '「蒙学经典」自成一张卡片');
  chk(mengCard.querySelectorAll(':scope > .item').length === 4,
    '「蒙学经典」4 篇并列在同一张卡里（实际 ' +
    (mengCard ? mengCard.querySelectorAll(':scope > .item').length : 0) + '）');
  // 卡片样式：合并后条目不再各自带圆角 / 阴影，只留一条分隔线
  const cardCss = /(^|\n)\.group-card \{([\s\S]*?)\}/.exec(fs.readFileSync(path + 'css/classic.css', 'utf8'));
  chk(!!cardCss && /border-radius:\s*var\(--radius\)/.test(cardCss[2]),
    '主题卡片沿用全站圆角（.group-card 是一张真正的卡片）');
  chk(!!cardCss && /box-shadow:\s*var\(--shadow\)/.test(cardCss[2]), '主题卡片有一层纸阴影');
  chk(/(^|\n)\.group-card \.item \{[\s\S]*?box-shadow:\s*none/.test(fs.readFileSync(path + 'css/classic.css', 'utf8')),
    '卡内条目去掉各自的阴影（合并进卡片后不再是 100 张独立卡片）');

  // 需求（Issue #55 后续）：左侧那道 1px「短竖条」整体去掉（用户要求「直接隐藏」）。
  // 它原先是表达「课内 / 课外」的一枚淡记号，但同一条卡片里序号圆的配色
  // 与卡头分组名已经把这件事说清楚了，竖条既重复、又在视觉上多出一道压在
  // 序号圆左侧的竖线。这里从 CSS 源码锁住「不再渲染 ::before 竖条」。
  const classicCssText = fs.readFileSync(path + 'css/classic.css', 'utf8');
  chk(!!cardCss && /padding:\s*0 0 10px;/.test(cardCss[2]),
    '卡片左右不留白（4px 会在条目内容外侧造出一道更高的「大竖条」）');
  chk(!/\.group-card \.item::before\s*\{/.test(classicCssText),
    '条目短竖条（::before）整体去掉，不再出现第二道竖线');
  chk(!/background:\s*var\(--blue\);\s*\}/.test(classicCssText) ||
      !/\.group-card \.item::before/.test(classicCssText),
    '与短竖条一并去掉的还有 .in-book 的绿色覆盖');
  chk(!/\.group-card \.item\.in-book::before/.test(classicCssText),
    '课内 / 课外改由序号圆配色与卡头分组名表达（不再有 .in-book::before 绿条）');

  // 需求（Issue #55 后续）：条目左内边距 8 → 10px —— 列表内容与卡片左缘之间
  // **只加左侧 2px**；右侧仍是 8px（那是「卡片右缘 → 播放键 / 箭头」的间距，
  // 用户明确要求不要跟着动）。写成四值 padding 而不是 `12px 10px`，
  // 就是为了让「只加左边」这件事在源码里看得见：一旦有人顺手改成 `12px 10px`，
  // 右侧也会被推走 2px，下面的数值断言会红。
  const itemPadBlock = /(^|\n)\.group-card \.item \{([\s\S]*?)\}/.exec(classicCssText);
  chk(!!itemPadBlock && /padding:\s*12px 8px 12px 10px;/.test(itemPadBlock[2]),
    '条目左内边距 10px（+2px）、右内边距仍 8px（只加左侧）');
  chk(!!itemPadBlock && !/padding:\s*12px 10px;/.test(itemPadBlock[2]),
    '右侧内边距没有被一起推走（不能写成 12px 10px 的对称写法）');

  // 需求（Issue #55 后续）：左侧那道「大竖绿线」必须整条去掉。
  // 根子在全站 .item 遗留的 `border-left: 4px solid`：
  // 100 篇合成一张卡片后，7 张卡的小绿条首尾紧贴卡片上下缘，各自连成一道
  // 贯穿整张卡片左边缘的竖线（用户看到的「左侧一整条大竖绿线」）。
  // 这里同时锁住「卡内条目左边框清零」与「前缀只允许 border-left: none」——
  // 不能写成 `border: none`，那会把条目之间那条细分隔线（border-top）一起抹掉。
  chk(!!itemPadBlock && /border-left:\s*none;/.test(itemPadBlock[2]),
    '卡内条目左边框清零（那一整道大竖绿线就是它连成的）');
  chk(!!itemPadBlock && /border-top:\s*1px solid var\(--line\);/i.test(itemPadBlock[2]),
    '条目之间的细分隔线保留（清零的只是左边框）');
  chk(!/border:\s*none;/.test(itemPadBlock[2]) || /border-left:\s*none;/.test(itemPadBlock[2]),
    '用 border-left 定向清零，而不是 border: none 一刀切');

  // 需求（Issue #55 后续）：卡内条目的播放键左侧间距再减 12px。
  // 全站 .item 是 flex + gap: 12px，首页今日条只有「正文 ↔ 一颗圆键」一段间隔；
  // 小古文条目右侧是「圆键 + 箭头」两颗图标，同一份 12px 摊在两段上，
  // 播放键被推得比首页远一倍。现在卡内 gap 清零、两个图标各自给外边距：
  //   正文 … 12px … 圆键 … 6px … 箭头
  // 再按用户要求把「圆键左侧」这段减去 12px：12 - 12 = 0，圆键左缘落在
  // 内容块右缘。右侧那 6px（圆键 ↔ 箭头）与箭头贴边一律不动。
  chk(!!itemPadBlock && /gap:\s*0;/.test(itemPadBlock[2]),
    '卡内条目列距清零（改由播放键 / 箭头各自的外边距给间距）');
  chk(!/gap:\s*12px/.test(itemPadBlock[2].replace(/\/\*[\s\S]*?\*\//g, ' ')),
    '卡内条目不再沿用全站 12px 列距（三样盒子之间不再各留 12px）');
  const itemReadBlock = /(^|\n)\.group-card \.item-read \{([\s\S]*?)\}/.exec(classicCssText);
  chk(!!itemReadBlock && /margin-left:\s*-12px;/.test(itemReadBlock[2]),
    '播放键左侧间距在原 12px 上再减 12px（margin-left: -12px，圆键左缘贴内容块右缘）');
  chk(!!itemReadBlock && /margin-right:\s*6px;/.test(itemReadBlock[2]),
    '播放键右侧（与箭头之间）保持 6px 不动');
  chk(!/^\.item \{[^}]*gap:\s*0/m.test(classicCssText),
    '全站 .item 的 12px 列距不动（首页没有这颗圆键，不该跟着改）');

  // 需求（Issue #55 后续）：序号圆与下方正文左对齐。
  // 此前标题行带 `margin-left: -12px`，把序号圆（连同整个标题行）左移 12px、
  // 让圆「探出」内容块左缘 —— 圆周左缘因此比下方「朝代 · 作者 · 年级」那行
  // 少缩进了 12px，一眼看去圆不在内容块的左基准线上（用户反馈的正是这一点）。
  // 现在负外边距收掉：标题行、序号圆、下方 .item-meta 同起于条目内容左缘。
  const styleCssText = fs.readFileSync(path + 'css/style.css', 'utf8');
  const titleBlock = /(^|\n)\.item-title \{([\s\S]*?)\}/.exec(styleCssText);
  // ⚠️ 注释里也会出现 margin-left / font-size 之类的字样（本仓库注释写得长），
  // 取数值前先把注释剥掉，否则命中的是注释里的那个数。
  const titleDecls = titleBlock[2].replace(/\/\*[\s\S]*?\*\//g, ' ');
  chk(!!titleBlock && /(^|\s)margin-left:\s*0;/.test(titleDecls),
    '标题行不再负向外移（margin-left: 0）：序号圆与下方正文左对齐');
  chk(!!titleBlock && !/margin-left:\s*-\d+px;/.test(titleDecls),
    '标题行不再出现负外边距（圆不会探出内容块左缘）');
  const numBlock = /(^|\n)\.item-num \{([\s\S]*?)\}/.exec(styleCssText);
  // 同理先剥注释：.item-num 的注释里也提到过尺寸与字号
  const numDecls = numBlock[2].replace(/\/\*[\s\S]*?\*\//g, ' ');
  chk(!!numBlock && /--item-num:\s*16\.5px;/.test(numDecls),
    '序号圆直径走 --item-num: 16.5px（与 .item-title 的字号同一个数）');
  chk(!!numBlock && /width:\s*var\(--item-num\)/.test(numDecls) && /height:\s*var\(--item-num\)/.test(numDecls),
    '序号圆的宽高同源（同一个变量），永远是正圆');
  const titleFontSize = parseFloat((titleDecls.match(/font-size:\s*([\d.]+)px/) || [, '0'])[1]);
  const numSize = parseFloat((numDecls.match(/--item-num:\s*([\d.]+)px/) || [, '0'])[1]);
  chk(titleFontSize === numSize,
    '圆的直径与标题字号相等（' + numSize + 'px = ' + titleFontSize + 'px）');
  chk(!!numBlock && /font-size:\s*11px;/.test(numDecls),
    '圆里的序号字号单列一档 11px（16.5px 会顶满圆边，两位数也挤）');
  // 需求（Issue #55 后续）：序号圆去掉淡绿底色，改为与序号同色的 1px 圆形描边，
  // 圈里的数字水平 + 垂直居中。
  chk(!!numBlock && /(^|\s)background:\s*none;/.test(numDecls),
    '序号圆不再铺底色（background: none）');
  chk(!!numBlock && !/background:\s*var\(--(green|blue|amber)-light\)/.test(numDecls),
    '序号圆上不再留任何淡色底（--*-light）');
  chk(!!numBlock && /border:\s*1px solid currentColor;/.test(numDecls),
    '序号圆改 1px 圆形描边，且边框色走 currentColor（与圈里的数字同色）');
  chk(!!numBlock && /box-sizing:\s*border-box;/.test(numDecls),
    '描边占在盒子内（border-box），圆外径仍是 --item-num，不被 1px 撑大');
  chk(!!numBlock && /align-items:\s*center;/.test(numDecls) && /justify-content:\s*center;/.test(numDecls),
    '圈里的数字水平 + 垂直居中（flex 两轴 center）');
  // 真浏览器里量一遍：序号圆、篇名、下方正文三者的左缘必须落在同一条竖线上。
  // jsdom 不算布局，这条只能在浏览器里核（见 test/pwa.test.js 的同类断言），
  // 这里先从源码确认「没有负外边距」这个前提成立，布局断言交给 PWA 层。
  // 空心描边（border-box）不改变圆的占位宽度，所以与「左对齐」并存、不冲突。
  const itemPadL = parseInt((itemPadBlock[2].match(/padding:\s*\d+px \d+px \d+px (\d+)px/) || [, '0'])[1], 10);
  chk(itemPadL === 10,
    '条目左内边距 10px（在原 8px 基础上 +2px，实际 ' + itemPadL + 'px）');
  const itemPadR = parseInt((itemPadBlock[2].match(/padding:\s*\d+px (\d+)px/) || [, '0'])[1], 10);
  chk(itemPadR === 8,
    '条目右内边距保持 8px 不变（实际 ' + itemPadR + 'px）：本轮只加左侧');
  chk(itemPadL === itemPadR + 2,
    '左右差恰好 2px（左 ' + itemPadL + ' / 右 ' + itemPadR + '）：要加的就是这 2px');

  // 需求（Issue #55 第三条）：序号圆从独占一列挪进标题行，排在篇名前面。
  const numEls = [...d.querySelectorAll('#gw-list .item-num')];
  chk(numEls.length === 100, '每一条都有序号圆（' + numEls.length + ' 个）');
  chk(d.querySelectorAll('#gw-list .item-index').length === 0, '旧的独占一列的 .item-index 已全部移除');
  chk(numEls.every(el => el.classList.contains('item-title') === false &&
    el.parentElement.classList.contains('item-title')),
    '序号圆就在标题那一行里（是 .item-title 的子元素，不再另起一列）');
  chk(numEls.every(el => el.parentElement.firstElementChild === el),
    '序号圆排在篇名**前面**（标题行的第一个孩子）');
  chk(numEls[0].textContent === '1', '序号从 1 起（实际 ' + numEls[0].textContent + '）');
  chk(/\.item-index/.test(classicCssText) === false,
    'css/classic.css 里不再留 .item-index 僵尸规则');
  // 空心圆（本 PR）：小古文只改 color，圈线走 currentColor 自动跟随；
  // 与 upstream 的「课内 / 课外由圆的配色表达」意图一致，只是底色换成描边。
  chk(/#gw-list \.item-num \{ color: var\(--blue\); \}/.test(classicCssText) &&
    /#gw-list \.item\.in-book \.item-num \{ color: var\(--green\); \}/.test(classicCssText),
    '小古文的序号圆：课内走天水碧、课外走天青（圈线与数字同色）');
  chk(!/#gw-list \.item-num \{[^}]*background/.test(classicCssText),
    '小古文也不再给序号圆铺底色（只留描边，课内 / 课外由圈线色表达）');
  // ⚠️ 只看 `border-left: none` 还会被「注释里写着 border-left: 4px」骗过去，
  // 所以先把注释剥掉再查：规则体里不能再出现任何 4px 的左边框。
  const itemRules = itemPadBlock[2].replace(/\/\*[\s\S]*?\*\//g, ' ');
  chk(!/border-left:\s*4px/.test(itemRules) && !/border-left-color/.test(itemRules),
    '卡内条目规则体里不再出现 4px 左侧色条（注释里提到不算）');

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

  // 需求（Issue #55 后续）：搜索框与下方「蒙学经典」卡片之间的空档，要和
  // 搜索框与上方页顶那一行之间的空档一致 —— 页首上下等距。
  //   上方：.topbar 的 padding-bottom 12px（全站顶栏，见 css/style.css）
  //   下方：.toolbar 的 margin-bottom 12px（页首专属）
  // 卡片可见边缘就是 .group-card 的顶边，卡头那 12px 上内边距长在卡片**里面**，
  // 不算作卡片上方的空档 —— 所以下方这一段只能写在这里，不能拿卡头的 padding 抵。
  // 曾经这里是 6px（页首收紧那一轮），于是下方只有 12px 的一半，看着「上宽下窄」。
  // 为什么页首那一段写在 .toolbar 上、而不是把 .group-head 的 padding 调来调去：
  //   .group-head 的 padding 同时管着「分组接分组」的那道间隔，动它会连带
  //   挤掉后面每个分组的呼吸；页首专属的间距就该写在页首专属的元素上。
  const headPad = (barCss.match(/\.group-head \{([^}]*)\}/) || [, ''])[1];
  const toolbarBlock = barCss.match(/\.toolbar \{([^}]*)\}/)[1];
  chk(/margin-bottom:\s*12px/.test(toolbarBlock),
    '工具栏下边距 12px（与页顶顶栏的 12px 下内边距一致，搜索框上下等距）');
  chk(/padding:\s*12px 8px 8px/.test(headPad),
    '卡头上内边距 12px（卡顶 → 卡头的呼吸）、下内边距 8px：组名与圆键整体上抬');
  chk(!/\.group-head \{[^}]*padding[^;]*\b8px;/.test(headPad),
    '分组标题不再保留旧的 14px 上内边距留下的三段 padding');
  chk(!/margin-bottom:\s*6px/.test(toolbarBlock),
    '工具栏不再保留旧的 6px 下边距（下方空档曾只有上方的一半）');
  chk(!/padding:\s*14px 2px 8px/.test(headPad),
    '分组标题不再保留旧的 14px 上内边距');
  // 源码级对账：页顶那一行的下内边距（搜索框上方）也必须是 12px，两段同源同值。
  const siteCss = fs.readFileSync(path + 'css/style.css', 'utf8');
  // .topbar 有两条规则（主规则 + 窄屏媒体的 padding-top 覆盖），取含 max-width 的那条主规则
  const topbarBlocks = [...siteCss.matchAll(/\.topbar \{([^}]*)\}/g)].map(m => m[1]);
  const topbarMain = topbarBlocks.find(b => /max-width:\s*720px/.test(b)) || '';
  chk(/padding:[^;]*12px\s*;/.test(topbarMain),
    '顶栏主规则下内边距为 12px：搜索框上方的空档与下方同值，页首上下对称');
  // 需求（Issue #55 第三条）：卡头「蒙学经典 4 篇」与右侧圆键不再压在首条的分隔线上。
  // 两件事一起做：卡头下内边距 0 → 8px；首条不画分隔线（留线会变成「卡头 → 线 → 首条」）。
  chk(/padding:\s*12px 8px 8px/.test(headPad),
    '卡头下内边距 8px：组名与圆键整体上抬，不再贴着下面那条线');
  chk(/\.group-card \.item:first-of-type \{ border-top:\s*1px solid color-mix\(in srgb, var\(--line\) 55%, transparent\); \}/
    .test(classicCssText),
    '首条的分隔线改为 55% 淡线（卡头与首条之间不再是一道重线）');
  chk(/\.group-card \.item \{[\s\S]*?border-top:\s*1px solid var\(--line\);/.test(classicCssText),
    '其余条目之间的分隔线保持原色（卡内节奏不变）');

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

  // 需求（Issue #55）：搜索框里的提示字（「搜索篇名 / 出处 / 作者」）字号太大，
  // 要跟右侧「全部 / 未读」同一个字号 —— 一排三样里最没信息量的一行字不该最抢眼。
  // 关键：**只降 ::placeholder，不动输入框自身的字号**。
  // 输入文字若压到 12.5px，iPhone 上一聚焦就会把整页放大（阈值 16px，
  // 见 css/style.css 末尾的防缩放规则与 theme.test.js 的断言）。
  const classicSheet = fs.readFileSync(path + 'css/classic.css', 'utf8');
  const phCss = classicSheet.match(/\.search-input::placeholder \{([^}]*)\}/);
  chk(!!phCss && /font-size:\s*12\.5px/.test(phCss[1]),
    '搜索框提示字（placeholder）字号压到 12.5px，与右侧「全部 / 未读」同号');

  // 需求（Issue #55 后续）：搜索框里的提示字「搜索篇名 / 出处 / 作者」要垂直居中。
  // 输入框自身字号 16px，提示字 12.5px —— 浏览器按**输入框的**字体排这一行基线，
  // 提示字行盒仍坐在 16px 的基线上，字矮了 3.5px，整个就沉到框的中线以下。
  // 修法：只给 ::placeholder 一个向上 2.25px 的位移（= 两者行盒中心差），
  // 输入的文字（16px）本来就是居中的，绝不能去动输入框本体的 padding / line-height。
  chk(!!phCss && /transform:\s*translateY\(-2\.25px\)/.test(phCss[1]),
    '提示字上抬 2.25px，回到搜索框的水平中轴（只动伪元素，不动输入文字）');
  chk(!/padding(-top|-bottom)?\s*:/.test(phCss[1]) && !/line-height\s*:/.test(phCss[1]),
    '居中的修法不碰输入框本体（提示字用 transform，输入文字仍是居中的 16px）');
  // 「全部 / 未读」实际量出来的字号是 12.5px —— 它由全站 .seg.mini button 给
  // （0,2,1），压过 classic.css 里 .filter-seg button 那条 13.5px（0,1,1）。
  // 所以这里断言的是「全站那个 12.5px 还在」，而不是小古文页自己写的那条。
  const segMini = fs.readFileSync(path + 'css/style.css', 'utf8');
  chk(/\.seg\.mini button \{[^}]*font-size:\s*12\.5px/.test(segMini),
    '「全部 / 未读」实际字号 12.5px（.seg.mini button 压过 .filter-seg button 的 13.5px）');
  const searchCss = barCss.match(/\.search-input \{([^}]*)\}/)[1];
  chk(!/font-size:\s*12\.5px/.test(searchCss),
    '输入框自身字号不跟着压小（否则 iOS 聚焦会放大页面）');
  chk(/font-size:\s*var\(--input-font\)/.test(searchCss),
    '输入框字号走全站统一的 --input-font 变量，不写死数字');
  // 小古文页必须自己兜住窄屏 16px：classic.css 与 style.css 都会加载，
  // 谁写在后面谁生效 —— 规则必须在本表末尾，否则被后加载的那份翻盘。
  const classicTail = classicSheet.slice(classicSheet.lastIndexOf('--input-font-narrow') - 300);
  chk(/\.search-input \{\s*font-size:\s*var\(--input-font-narrow\);\s*\}/.test(classicTail),
    '小古文页在样式表末尾把输入框字号定回 16px（窄屏 iOS 不缩放）');
  chk(/@media screen and \(max-width: 700px\)/.test(classicTail),
    '这条窄屏规则写在媒体查询里（桌面仍是 14px）');

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
  clickReaderBack();
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
  clickReaderBack();

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
