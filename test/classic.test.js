const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = __dirname + '/../';

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const vm = require('vm');
const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(path + 'data/text-master.js', 'utf8'), sandbox, { filename: 'text-master.js' });
vm.runInContext(fs.readFileSync(path + 'data/poems-classic.js', 'utf8'), sandbox, { filename: 'poems-classic.js' });

var CLS = sandbox.POEMS_CLASSIC.map(function (raw) {
  return sandbox.masterTextOf ? sandbox.masterTextOf(raw, 'classic') : raw;
});
chk(Array.isArray(CLS) && CLS.length === 100, '小古文共 100 篇（实际 ' + (CLS ? CLS.length : 'undefined') + '）');
const ids = new Set();
CLS.forEach(p => {
  if (ids.has(p.id)) throw new Error('重复 id ' + p.id);
  ids.add(p.id);
});
chk(true, '小古文 id 无重复');
chk(CLS.every(p => p.title && p.source && p.text && p.translation), '每篇都有 标题/出处/原文/译文');

const CLS_SRC_OK = ['public-domain', 'school'];
chk(CLS.every(p => CLS_SRC_OK.indexOf(p.translationSource) >= 0),
  '100 篇小古文都标了译文来源且取值在允许范围（异常 ' +
  CLS.filter(p => CLS_SRC_OK.indexOf(p.translationSource) < 0).length + ' 篇）');
chk(CLS.filter(p => p.translationSource === 'public-domain').length === 99,
  '其中 99 篇标 public-domain（与课内同篇的 1 篇取自课本口径，标 school）');
chk(CLS.some(p => p.text.length > 100), '含长篇（>100 字）古文，验证长文场景');

const need = ['人之初', '弟子规（节选）', '司马光', '守株待兔', '精卫填海', '王戎不取道旁李', '囊萤夜读',
  '铁杵成针', '少年中国说（节选）', '古人谈读书', '自相矛盾', '杨氏之子', '伯牙鼓琴', '书戴嵩画牛', '学弈',
  '两小儿辩日', '盘古开天地', '女娲造人', '夸父逐日', '后羿射日', '曹冲称象', '掩耳盗铃', '画蛇添足',
  '刻舟求剑', '郑人买履', '叶公好龙', '揠苗助长', '滥竽充数', '买椟还珠'];
const titles = CLS.map(p => p.title);
const missing = need.filter(t => !titles.includes(t));
chk(missing.length === 0, '需求清单篇目齐备（缺 ' + missing.join('/') + '）');

chk(sandbox.POEMS_ALL === undefined, '小古文不写入 POEMS_ALL，不影响每日计划');
const groups = sandbox.getClassicGroups();
chk(groups.length >= 6, '按主题分组聚合出 ' + groups.length + ' 组');
chk(groups.reduce((n, g) => n + g.items.length, 0) === 100, '分组内篇目合计 100');

const html = fs.readFileSync(path + 'classic/index.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://local.test/classic/', base: 'https://local.test/classic/' });
const { window } = dom;

window.SpeechSynthesisUtterance = function (t) { this.text = t; };
window.speechSynthesis = {
  speaking: false, speak() { this.speaking = true; }, cancel() { this.speaking = false; },
  getVoices() { return []; }, addEventListener() {}
};
window.__setSpeechGate = function (on) {
  if (window.Speech && window.Speech.setGate) window.Speech.setGate(function () { return { ok: on, hint: '' }; });
};

(function seedSignedIn() {
  const A = require(path + 'js/auth-core.js');
  const mem = {};
  const backing = {
    getItem: k => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; }
  };
  const store = A.makeStore(backing);
  const req = A.requestCode(store, { channel: 'email', value: 'zhangmin@163.com' }, 'login', { code: '246810' });
  A.verifyCode(store, req.codeId, '246810', 'login');
  window.localStorage.setItem(A.NS, mem[A.NS]);
})();
const scriptOrder = html.match(/<script src="([^"]+)"><\/script>/g).map(s => s.match(/src="([^"]+)"/)[1]);
chk(scriptOrder.indexOf('data/poems-classic.js') >= 0, '页面引用了小古文数据');
scriptOrder.forEach(f => {
  const el = window.document.createElement('script');
  el.textContent = fs.readFileSync(path + f, 'utf8');
  window.document.body.appendChild(el);
});

setTimeout(() => {
  const d = window.document;

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

  const clsCss = fs.readFileSync(path + 'css/classic.css', 'utf8');
  chk(d.querySelector('.list-head') === null, '内容区不再有单独的进度行（.list-head 已删除）');
  chk(!/list-head/.test(clsCss), 'CSS 里也不留 .list-head 僵尸样式');
  chk(!/list-head/.test(fs.readFileSync(path + 'classic/index.html', 'utf8')), '页面里也不再出现 .list-head');
  chk(d.querySelector('#gw-count') === null, '页顶那一行不再挂已读进度牌 #gw-count（Issue #147）');
  chk(d.querySelectorAll('.topbar > .count-badge').length === 0,
    '全页两条顶栏（列表页 + 阅读器）**一枚 .count-badge 都没有**（实际 ' +
    d.querySelectorAll('.topbar > .count-badge').length + ' 枚）');
  chk(fs.readFileSync(path + 'classic/index.html', 'utf8').indexOf('count-badge') < 0,
    '页面里连 count-badge 这个类名都不再出现（不留死节点）');

  const topbar = d.querySelector('.topbar');
  chk([...topbar.children].map(e => e.className.split(' ')[0]).join('/') === 'brand/top-act',
    '页顶一行是「品牌区 · 返回键」（实际 ' +
    [...topbar.children].map(e => e.className).join('/') + '）');
  chk(topbar.querySelectorAll(':scope > .top-slot, :scope > .top-user').length === 0,
    '顶栏 HTML 里没有槽、也没有头像（结构只出 chrome.js 一处，且都撤了）');

  const cssAll = fs.readFileSync(path + 'css/style.css', 'utf8');
  chk(/\.top-act \{[^}]*margin-left:\s*auto/.test(cssAll),
    '返回键由 margin-left: auto 钉在右缘（不随左边品牌区的宽度浮动）');
  chk(!/\.top-slot\s*[,{]/.test(cssAll.replace(/\/\*[\s\S]*?\*\//g, ' ')),
    '样式表里不再留 .top-slot 规则（那一枚圆槽是头像的，头像撤了它也没了）');
  chk(/\.top-act \{[^}]*width:\s*var\(--top-key\)/.test(cssAll),
    '顶栏那一颗的尺寸只有一个来源 --top-key（顶栏右端现在只有这一件）');

  const readerBarBlock = (/\.reader > \.topbar \{([^}]*)\}/.exec(clsCss) || [, ''])[1];
  chk(/max-width:\s*none/.test(readerBarBlock),
    '阅读器顶栏收回通用 .topbar 的 max-width: var(--content-w)（不然它会比 .app 窄两条边）');
  chk(/margin:\s*0;/.test(readerBarBlock),
    '阅读器顶栏清掉通用 .topbar 的 margin: 0 auto（否则宽屏上左右各多出一条边）');
  chk(/padding-left:\s*calc\(var\(--col-side\) \+ var\(--safe-left\)\)/.test(readerBarBlock) &&
    /padding-right:\s*calc\(var\(--col-side\) \+ var\(--safe-right\)\)/.test(readerBarBlock),
    '阅读器顶栏左右内缩取自 --col-side（与 .app 同一档，返回键不再比列表页更贴边）');
  const backBtn2 = topbar.querySelector('#top-back');
  chk(!!backBtn2 && backBtn2.tagName === 'A' && backBtn2.getAttribute('href') === '/',
    '返回键统一由 chrome.js 渲染（回首页），页面不再自造一颗');
  chk(!!backBtn2.querySelector('svg') && backBtn2.querySelectorAll('svg').length === 1,
    '返回键只有一个箭头图标（不放页名文字）');

  const openReaderBar = function () {
    d.querySelector('#gw-list .item').dispatchEvent(new window.Event('click', { bubbles: true }));
    return d.querySelector('#gw-reader > .topbar');
  };

  const clickReaderBack = function () {
    const btn = d.querySelector('#gw-reader > .topbar #top-act');
    if (!btn) { d.querySelector('#gw-reader').hidden = true; return false; }
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  };
  const rBar = openReaderBar();
  chk(!!rBar, '阅读器里有自己的 .topbar（同一套结构）');

  const rMeta = d.querySelector('#rd-meta');
  chk(rMeta.querySelectorAll('.rd-count').length === 0,
    '详情页状态栏里不再有已读读数 .rd-count（实际 ' +
    rMeta.querySelectorAll('.rd-count').length + ' 枚）');
  chk(!/\d\s*\/\s*\d+\s*(篇|首)/.test(rMeta.textContent),
    '状态栏整行不含「N / M 篇」这类读数（实际「' + rMeta.textContent + '」）');
  chk(!!rMeta.querySelector('.tag') && rMeta.textContent.indexOf('王应麟') >= 0,
    '同一行里朝代 / 作者 / 出处都还在（实际「' + rMeta.textContent + '」）');

  chk([...rBar.children].map(e => e.className.split(' ')[0]).join('/') === 'brand/top-act',
    '阅读器顶栏是「品牌区 · 返回键」，**不含头像 / 篇号牌 / 任何图标**（实际 ' +
    [...rBar.children].map(e => e.className).join('/') + '）');
  chk(!!rBar.querySelector(':scope > #top-act'),
    '阅读器的「合上」就是那颗键本体（与页面那条同一个尺寸，不必再靠占位对齐）');
  chk(d.querySelectorAll('.reader .topbar .top-user').length === 0,
    '阅读器里确实一枚头像都没有（让位给正文）');

  chk(!/\.top-slot-mark/.test(cssAll),
    '样式表里不再留 `.top-slot-mark` 规则（留着下一个人会以为阅读器里还有一枚图标）');
  chk(!/\.top-slot-mark/.test(fs.readFileSync(path + 'js/chrome.js', 'utf8').replace(/\/\/[^\n]*/g, ' ')),
    '引擎的代码里也不再生成 `.top-slot-mark`');
  chk(!/\.top-act-spacer\s*[,{]/.test(cssAll.replace(/\/\*[\s\S]*?\*\//g, ' ')),
    '那枚「不可见占位」也随头像一起撤了（顶栏右端只剩一颗键，没有要对齐的第二件）');
  chk(rBar.querySelector('.brand-page-text').textContent === '课外必背小古文',
    '阅读器里的页名同样是「课外必背小古文」，与列表页一致');

  chk(d.querySelectorAll('#top-act').length === 1,
    '全页只有一枚 #top-act（动作位只归阅读器那条顶栏，实际 ' +
    d.querySelectorAll('#top-act').length + ' 枚）');

  chk(d.querySelectorAll('#top-back').length === 0,
    '阅读器开着时页面那条顶栏不画返回键（动作位归阅读器，全页不出现第二枚顶栏 id，实际 ' +
    d.querySelectorAll('#top-back').length + ' 枚）');
  const rBack = rBar.querySelector('#top-act');
  chk(!!rBack && !!rBack.querySelector('svg'), '阅读器返回键走全站动作位（同一颗按钮）');

  if (!rBack) {
    chk(false, '阅读器顶栏缺少 #top-act，跳过依赖它的后续校验');
    chk(false, '阅读器返回键能合上阅读器（因 #top-act 缺失而跳过）');

    d.querySelector('#gw-reader').hidden = true;
  } else {
    chk(!/#top-act[^>]*>[\s\S]{0,200}?M6\.4 6\.4/.test(rBar.innerHTML),
      '动作位画的是返回箭头，不是 ✕（同一种行为全站同一个图标）');

    rBack.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    chk(d.querySelector('#gw-reader').hidden === true, '阅读器返回键能合上阅读器');

    const appBarBack = d.querySelector('.app > .topbar #top-back');
    chk(!!appBarBack && appBarBack.getAttribute('href') === '/',
      '合上阅读器后，页面顶部那条顶栏露出「回首页」的返回键');
  }

  const appSub = () => d.querySelector('.app > .topbar #brand-sub').textContent;
  const readerSub = () => d.querySelector('#gw-reader > .topbar #brand-sub').textContent;
  chk(readerSub() === '百字上下，最适合起步', '阅读器顶栏的第二行也在（与列表页同一句）');
  chk(appSub() === '百字上下，最适合起步', '合上阅读器后，列表页顶栏的第二行还在（重绘后已补回）');
  chk(topbar.contains(d.querySelector('#brand-name')) && topbar.contains(d.querySelector('#brand-page-text')),
    '顶栏那件「跬步 · 小古文」仍在（撤掉的只是那枚读数）');

  const styleCss0 = fs.readFileSync(path + 'css/style.css', 'utf8');
  const topbarBlock = /(^|\n)\.topbar \{([\s\S]*?)\}/.exec(styleCss0);
  chk(!!topbarBlock && /align-items:\s*center;/.test(topbarBlock[2]),
    '顶栏 flex 垂直居中（徽标 / 页名 / 副标题 / 返回键同一条中轴）');
  chk(!/\.topbar-with-count/.test(clsCss) && !/\.count-badge/.test(clsCss),
    '样式表里不再留 .topbar-with-count / .count-badge 这一套页顶读数样式');

  chk(!/\.rd-count\s*[,{]/.test(clsCss),
    '样式表里不再留 .rd-count 规则（详情页那一枚读数已撤，留着只会让人以为还有一处读数）');
  chk(d.querySelectorAll('#gw-list .group-head').length >= 6, '按主题显示分组标题（' + d.querySelectorAll('#gw-list .group-head').length + ' 个）');

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

  chk(groupBtns.every(b => (b.innerText === undefined ? true : !/连续播放|随机播放/.test(b.innerText))),
    '圆键渲染出来的文字里不含模式名（菜单项在收起的菜单里）');
  chk(groupBtns.every(b => [...b.querySelectorAll('.gw-menu-item')].every(
    x => x.textContent.trim().length > 0)),
    '五个模式名分别挂在各自的菜单项上（不是圆键的可见文字）');

  chk(groupBtns.every(b => /连续播放原文/.test(b.getAttribute('title') || '') &&
    b.getAttribute('title') === b.getAttribute('aria-label')),
    '分组圆键的读屏文案就是当前模式名：' + groupBtns[0].getAttribute('aria-label'));
  chk(groupBtns.every(b => b.parentElement.classList.contains('group-head')),
    '分组圆键就在分组标题那一行里（不另起一行）');

  chk(groupBtns.every(b => !!b.querySelector('.play-mode')),
    '组合键上带一枚模式记号（.play-mode 小点）');

  const menuItems = [...groupBtns[0].querySelectorAll('.gw-menu-item')];
  chk(menuItems.map(x => x.textContent.trim()).join('|') ===
    '连续播放原文|连续播放白话译文|原文白话顺序播放|随机播放原文|随机播放白话译文',
    '菜单里正好五种模式（顺序保持一致）：' + menuItems.map(x => x.textContent.trim()).join('|'));
  chk(groupBtns.every(b => b.querySelector('.gw-menu').hidden),
    '菜单初始收起（不点不占版面）');
  chk(menuItems.every(x => x.getAttribute('role') === 'menuitemradio'),
    '五个模式是互斥的一组（menuitemradio），同一时刻只有一个选中');
  chk(menuItems[0].classList.contains('active') && menuItems[0].getAttribute('aria-checked') === 'true',
    '出厂档是「连续播放原文」（菜单里它才是选中态）');

  const modeJs = fs.readFileSync(path + 'js/reader-core.js', 'utf8');
  const sharedJs = fs.readFileSync(path + 'js/play-modes.js', 'utf8');
  chk(/"seq-origin"/.test(sharedJs) && /"shuffle-trans"/.test(sharedJs) &&
      /var LIST = \[/.test(sharedJs),
    '五种模式在 js/play-modes.js 里有一张单一来源的表');
  chk(!/var PLAY_MODES = \[\s*\{/.test(modeJs),
    '引擎不再自己抄一份模式表（避免与设置页错开）');
  chk(/window\.PlayModes/.test(modeJs), '引擎读的是那份共用定义（PlayModes）');

  const gwSmCss = /(^|\n)\.gw-play-sm \{([\s\S]*?)\}/.exec(clsCss);
  chk(!!gwSmCss && /margin-left:\s*auto/.test(gwSmCss[2]),
    '分组圆键靠右（margin-left: auto，与组名各守一端）');
  chk(!!gwSmCss && /width:\s*26px/.test(gwSmCss[2]) && /height:\s*26px/.test(gwSmCss[2]),
    '分组圆键是 26×26（宽高相等，仍是正圆）');
  const gwMainCss = /(^|\n)\.gw-play-main \{([\s\S]*?)\}/.exec(clsCss);
  const mainSize = gwMainCss ? parseInt((gwMainCss[2].match(/height:\s*var\(--toolbar-h\)/) ? '40' : '0'), 10) : 0;
  chk(mainSize > 26, '分组圆键确实比工具栏那颗小（26 < ' + mainSize + '）');
  chk(/已读|标记/.test(d.querySelector('#gw-done-text').textContent), '阅读器内有「标记已读」按钮');

  chk(d.querySelector('.brand-text h1').textContent === '跬步', '小古文页顶栏第一行同样是「跬步」（全站一致）');

  chk(d.querySelector('#brand-page-text').textContent === '课外必背小古文',
    '页面名紧随「跬步」右侧：' + d.querySelector('#brand-page-text').textContent);
  chk(d.title === '课外必背小古文 · 跬步', '集子页标题为「课外必背小古文 · 跬步」（实际 ' + d.title + '）');

  const sub = d.querySelector('.app > .topbar #brand-sub').textContent;
  chk(sub === '百字上下，最适合起步', '小古文页副标题为这一部的总结（实际 ' + JSON.stringify(sub) + '）');
  chk(!/想读哪篇点哪篇/.test(sub), '副标题不再写「想读哪篇点哪篇」这类口号');
  chk(!/小古文/.test(sub) && !/跬步/.test(sub), '副标题不与第一行重复页面名 / 应用名');

  chk(!/小古文[^。]{0,40}小古文/.test(d.querySelector('.app > .topbar').textContent.replace(/\s+/g, '')),
    '页面顶栏整行不出现连着两个「小古文」');
  const dock = d.querySelector('#site-dock');
  chk(!!dock, '小古文页有底部导航栏');
  const dockItems = [...dock.querySelectorAll('.dock-item')];

  chk(dockItems.map(b => b.querySelector('.dock-label').textContent).join('/') === '背诵/课外/搜索/我的',
    '底部页签与首页一致（背诵/课外/搜索/我的）');
  chk(dockItems[1].classList.contains('active') && dockItems[1].getAttribute('aria-current') === 'page',
    '小古文页签为选中态');
  chk(d.querySelector('#classic-entry') === null, '本页不再自造「返回古诗词」入口（回首页交给页签）');
  chk(!!d.querySelector('#settings-modal'), '小古文页也能打开设置（含用户名与阅读辅助）');
  chk(!!d.querySelector('#settings-modal #input-username'), '小古文页设置里有用户名输入框');

  chk(d.querySelector('.notice') === null, '顶部说明段落已整段删除（不再有 .notice）');
  const htmlSrc = fs.readFileSync(path + 'classic/index.html', 'utf8');
  chk(!/不排复习日期/.test(htmlSrc), '页面里不再出现「不排复习日期」这类说明');
  chk(!/想读哪篇点哪篇[。．]/.test(htmlSrc.replace(/<p>.*?<\/p>/, '')), '不再有婆婆妈妈的说明段落');

  chk(d.querySelector('.app > .topbar #brand-sub').textContent === '百字上下，最适合起步',
    '小古文页有副标题（实际 ' + JSON.stringify(d.querySelector('.app > .topbar #brand-sub').textContent) + '）');
  chk(d.querySelector('#brand-page-text').textContent === '课外必背小古文',
    '页面名与 chrome.js 的 data-page 一致，由 CSS 的 ::before 生成分隔符（不再写死标点）');
  chk(d.querySelectorAll('#gw-list .item .item-reason.review').length === 0, '列表里没有「复习」标签，不做复习排期');

  const readerBar = d.querySelector('#gw-reader > .topbar');
  chk(!!readerBar, '阅读器顶栏复用全站 .topbar（不再是自制的 .reader-bar）');
  chk(d.querySelector('.reader-bar') === null, '自制的 .reader-bar 已删除');
  chk(!d.querySelector('#gw-back'), '不再自造一颗 #gw-back 返回键（交给全站顶栏的动作位）');

  const groupHeads = [...d.querySelectorAll('#gw-list .group-head .group-name')].map(e => e.textContent);
  chk(groupHeads.length === 7, '共 7 个主题分类（实际 ' + groupHeads.length + '）');
  chk(new Set(groupHeads).size === groupHeads.length, '同一分类只出现一个分组标题（分类已聚合，不按书本拆散）');
  const firstGroup = groupHeads[0];
  const firstGroupCount = [...d.querySelectorAll('#gw-list .group-head .group-count')][0].textContent;
  const firstGroupItems = [...d.querySelectorAll('#gw-list .item')].slice(0, parseInt(firstGroupCount));
  chk(firstGroupItems.length === parseInt(firstGroupCount), '分组计数与实际列出的篇数一致：' + firstGroup);
  chk(firstGroupItems.every(el => el.querySelector('.item-meta').textContent.includes(firstGroup) ||
    !/福尔摩斯/.test(el.textContent)), '同一分类的篇目连续排在一起');

  const mh = [...d.querySelectorAll('#gw-list .group-head')].find(h => h.querySelector('.group-name').textContent === '蒙学经典');
  chk(!!mh, '有「蒙学经典」分类');
  chk(/4 篇/.test(mh.querySelector('.group-count').textContent),
    '「蒙学经典」显示 4 篇（实际 ' + mh.querySelector('.group-count').textContent + '）');

  chk(mh.children.length === 3 && mh.lastElementChild.classList.contains('gw-play-sm'),
    '卡头一行三样：组名 / 篇数 / 随机连读圆键（圆键收在行尾）');
  const allGroupItems = [];
  let node = mh.nextElementSibling;
  while (node && !node.classList.contains('group-head')) {
    if (node.classList.contains('item')) allGroupItems.push(node);
    node = node.nextElementSibling;
  }
  chk(allGroupItems.length === 4, '「蒙学经典」下面真的列出 4 篇（实际 ' + allGroupItems.length + '）');

  chk(allGroupItems.map(el => el.querySelector('.item-title').textContent.replace('已读', '').trim()
    .replace(/^\d+/, '')).join('/') === '人之初/弟子规（节选）/菊/莲',
    '「蒙学经典」四篇连续排列（' + allGroupItems.map(el => el.querySelector('.item-title').textContent).join('/') + '）');

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

  const cardNames = cards.map(c => c.querySelector('.group-head .group-name').textContent);
  chk(new Set(cardNames).size === cardNames.length, '同一主题只有一张卡片（不同卡片主题名不重复）');

  const mengCard = cards.find(c => c.dataset.group === '蒙学经典');
  chk(!!mengCard, '「蒙学经典」自成一张卡片');
  chk(mengCard.querySelectorAll(':scope > .item').length === 4,
    '「蒙学经典」4 篇并列在同一张卡里（实际 ' +
    (mengCard ? mengCard.querySelectorAll(':scope > .item').length : 0) + '）');

  const cardCss = /(^|\n)\.group-card \{([\s\S]*?)\}/.exec(fs.readFileSync(path + 'css/classic.css', 'utf8'));
  chk(!!cardCss && /border-radius:\s*var\(--radius\)/.test(cardCss[2]),
    '主题卡片沿用全站圆角（.group-card 是一张真正的卡片）');
  chk(!!cardCss && /box-shadow:\s*var\(--shadow\)/.test(cardCss[2]), '主题卡片有一层纸阴影');
  chk(/(^|\n)\.group-card \.item \{[\s\S]*?box-shadow:\s*none/.test(fs.readFileSync(path + 'css/classic.css', 'utf8')),
    '卡内条目去掉各自的阴影（合并进卡片后不再是 100 张独立卡片）');

  const classicCssText = fs.readFileSync(path + 'css/classic.css', 'utf8');

  chk(!!cardCss && /padding:\s*0 0 10px 2px;/.test(cardCss[2]),
    '卡片左内边距 2px（卡头与左侧边框的间距 +2px）、右内边距仍为 0');

  const cardDeclsOnly = cardCss[2].replace(/\/\*[\s\S]*?\*\//g, ' ');
  chk(!!cardCss && !/padding-left:\s*0\b/.test(cardDeclsOnly),
    '卡片规则里不再有会覆盖左内边距的 padding-left: 0 兜底（它会把 2px 抹回 0）');
  chk(!/\.group-card \.item::before\s*\{/.test(classicCssText),
    '条目短竖条（::before）整体去掉，不再出现第二道竖线');
  chk(!/background:\s*var\(--blue\);\s*\}/.test(classicCssText) ||
      !/\.group-card \.item::before/.test(classicCssText),
    '与短竖条一并去掉的还有 .in-book 的绿色覆盖');
  chk(!/\.group-card \.item\.in-book::before/.test(classicCssText),
    '课内 / 课外改由序号圆配色与卡头分组名表达（不再有 .in-book::before 绿条）');

  const itemPadBlock = /(^|\n)\.group-card \.item \{([\s\S]*?)\}/.exec(classicCssText);
  chk(!!itemPadBlock && /padding:\s*12px 8px 12px 12px;/.test(itemPadBlock[2]),
    '条目左内边距 12px（再 +2px）、右内边距仍 8px（只加左侧）');
  chk(!!itemPadBlock && !/padding:\s*12px 12px;/.test(itemPadBlock[2]),
    '右侧内边距没有被一起推走（不能写成 12px 12px 的对称写法）');

  chk(!!cardCss && /padding:\s*0 0 10px 2px;/.test(cardCss[2]),
    '条目 12px 是加在卡片 2px 之上的第二层（文字距卡片左缘 = 2 + 12 = 14px）');

  chk(!!itemPadBlock && /border-left:\s*none;/.test(itemPadBlock[2]),
    '卡内条目左边框清零（那一整道大竖绿线就是它连成的）');
  chk(!!itemPadBlock && /border-top:\s*1px solid var\(--line\);/i.test(itemPadBlock[2]),
    '条目之间的细分隔线保留（清零的只是左边框）');
  chk(!/border:\s*none;/.test(itemPadBlock[2]) || /border-left:\s*none;/.test(itemPadBlock[2]),
    '用 border-left 定向清零，而不是 border: none 一刀切');

  chk(!!itemPadBlock && /gap:\s*0;/.test(itemPadBlock[2]),
    '卡内条目列距清零（改由播放键 / 箭头各自的外边距给间距）');
  chk(!/gap:\s*12px/.test(itemPadBlock[2].replace(/\/\*[\s\S]*?\*\//g, ' ')),
    '卡内条目不再沿用全站 12px 列距（三样盒子之间不再各留 12px）');
  const itemReadBlock = /(^|\n)\.group-card \.item-read \{([\s\S]*?)\}/.exec(classicCssText);
  chk(!!itemReadBlock && /margin-left:\s*0;/.test(itemReadBlock[2]),
    '播放键左侧间距归零（不再用负外边距把圆键压到正文上）');
  chk(!!itemReadBlock && !/margin-left:\s*-/.test(itemReadBlock[2]),
    '播放键左侧没有负外边距（负值只会让圆键压住正文，正文不会变长）');
  chk(!!itemReadBlock && /margin-right:\s*6px;/.test(itemReadBlock[2]),
    '播放键右侧（与箭头之间）保持 6px 不动');
  chk(!/^\.item \{[^}]*gap:\s*0/m.test(classicCssText),
    '全站 .item 的 12px 列距不动（首页没有这颗圆键，不该跟着改）');

  const arrowAutoBlock = /(^|\n)\.item-arrow \{([\s\S]*?)\}/.exec(classicCssText);
  chk(!!arrowAutoBlock && /margin-left:\s*auto;/.test(arrowAutoBlock[2]),
    '箭头 margin-left: auto（把播放键 + 箭头整组推到条目右缘）');
  chk(!/\.item-main \{[^}]*margin-left:\s*auto/m.test(classicCssText),
    '内容块仍贴左缘（余量交给箭头吃掉，不是把内容块居中）');

  const mainBlock = /(^|\n)#gw-list \.item \.item-main \{([\s\S]*?)\}/.exec(classicCssText);
  chk(!!mainBlock && /flex:\s*0 1 auto;/.test(mainBlock[2]),
    '集子页与搜索页的内容块都按内容取宽（flex: 0 1 auto，不再是全站的增长项 1 1 0%）');
  chk(!!mainBlock && !/flex:\s*0 0 auto;/.test(mainBlock[2]),
    '内容块不写 flex: 0 0 auto（自动宽 + 摘要 ellipsis 两次布局互相依赖，会退回最小宽）');

  const searchPadBlock = /body\[data-nav="search"\] #gw-list \.item \{([\s\S]*?)\}/.exec(classicCssText);
  const searchPad = searchPadBlock ? searchPadBlock[1].replace(/\/\*[\s\S]*?\*\//g, ' ') : '';
  chk(/padding:\s*14px 8px 14px 14px;/.test(searchPad),
    '搜索页条目右内边距收成 8px（与集子页同值，箭头在两页落在同一条右基准线上）');

  const styleCssText = fs.readFileSync(path + 'css/style.css', 'utf8');
  const titleBlock = /(^|\n)\.item-title \{([\s\S]*?)\}/.exec(styleCssText);

  const titleDecls = titleBlock[2].replace(/\/\*[\s\S]*?\*\//g, ' ');
  chk(!!titleBlock && /(^|\s)margin-left:\s*0;/.test(titleDecls),
    '标题行不再负向外移（margin-left: 0）：序号圆与下方正文左对齐');
  chk(!!titleBlock && !/margin-left:\s*-\d+px;/.test(titleDecls),
    '标题行不再出现负外边距（圆不会探出内容块左缘）');
  const numBlock = /(^|\n)\.item-num \{([\s\S]*?)\}/.exec(styleCssText);

  const numDecls = numBlock[2].replace(/\/\*[\s\S]*?\*\//g, ' ');

  chk(!!numBlock && /--item-num:\s*[\d.]+px;/.test(numDecls),
    '序号圆直径走 --item-num（与 .item-title 的字号同一个数）');
  chk(!!numBlock && /width:\s*var\(--item-num\)/.test(numDecls) && /height:\s*var\(--item-num\)/.test(numDecls),
    '序号圆的宽高同源（同一个变量），永远是正圆');

  const sharedTitleBlock = /\.settings-group-title,[\s\S]{0,200}?\{([\s\S]{0,400}?)\}/.exec(styleCssText);
  const sharedTitleDecls = sharedTitleBlock
    ? sharedTitleBlock[1].replace(/\/\*[\s\S]*?\*\//g, ' ') : '';
  const titleFontSize = parseFloat((sharedTitleDecls.match(/font-size:\s*([\d.]+)px/) || [, '0'])[1]);
  chk(titleFontSize >= 17,
    '篇名与设置页的卡片主标题同一档（≥17px，实际 ' + titleFontSize + 'px）—— ' +
    '用户眼里的「诗词标题」就是这一档（Issue #163 第四轮）');
  const numSize = parseFloat((numDecls.match(/--item-num:\s*([\d.]+)px/) || [, '0'])[1]);
  chk(titleFontSize === numSize,
    '圆的直径与标题字号相等（' + numSize + 'px = ' + titleFontSize + 'px）');
  chk(!!numBlock && /font-size:\s*11px;/.test(numDecls),
    '圆里的序号字号单列一档 11px（17px 会顶满圆边，两位数也挤）');

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

  const itemPadL = parseInt((itemPadBlock[2].match(/padding:\s*\d+px \d+px \d+px (\d+)px/) || [, '0'])[1], 10);
  chk(itemPadL === 12,
    '条目左内边距 12px（8 → 10 → 12，累计 +4px，实际 ' + itemPadL + 'px）');
  const itemPadR = parseInt((itemPadBlock[2].match(/padding:\s*\d+px (\d+)px/) || [, '0'])[1], 10);
  chk(itemPadR === 8,
    '条目右内边距保持 8px 不变（实际 ' + itemPadR + 'px）：本轮只加左侧');
  chk(itemPadL === itemPadR + 4,
    '左右差恰好 4px（左 ' + itemPadL + ' / 右 ' + itemPadR + '）：要加的就是这 4px');

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

  chk(/#gw-list \.item-num \{ color: var\(--blue\); \}/.test(classicCssText) &&
    /#gw-list \.item\.in-book \.item-num \{ color: var\(--green\); \}/.test(classicCssText),
    '小古文的序号圆：课内走天水碧、课外走天青（圈线与数字同色）');
  chk(!/#gw-list \.item-num \{[^}]*background/.test(classicCssText),
    '小古文也不再给序号圆铺底色（只留描边，课内 / 课外由圈线色表达）');

  const itemRules = itemPadBlock[2].replace(/\/\*[\s\S]*?\*\//g, ' ');
  chk(!/border-left:\s*4px/.test(itemRules) && !/border-left-color/.test(itemRules),
    '卡内条目规则体里不再出现 4px 左侧色条（注释里提到不算）');

  chk(d.querySelectorAll('#gw-list .item-read').length === 100, '每个列表项都有播放按钮');
  chk(d.querySelectorAll('#gw-list .item .play-glyph').length === 100, '播放键用的是 ▶ 播放图标');

  const filterSeg = d.querySelector('#gw-filter-seg');
  chk(!!filterSeg && filterSeg.classList.contains('seg'), '「全部 / 未读」是组合按钮（.seg 分段控件）');
  chk(d.querySelectorAll('#gw-filter-seg button').length === 2, '组合里正好两档：全部 / 未读');
  chk(d.querySelector('#gw-filter') === null && d.querySelector('#gw-filter-unread') === null,
    '不再使用两个各自独立的 seg-toggle 按钮');
  chk([...d.querySelectorAll('#gw-filter-seg button')].map(b => b.textContent.trim()).join('/') === '全部/未读',
    '组合按钮文案为 全部 / 未读');
  chk(filterSeg.querySelector('button.active').dataset.filter === 'all', '默认选中「全部」');

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

  const readClsCode = readClsJs
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map(l => l.replace(/^\s*\/\/.*$/, ' ')).join('\n');
  chk(!/连读中/.test(randomBtn.textContent) && !/连读中/.test(readClsCode) &&
    !/gw-random-read-text/.test(readClsCode),
    '不再有「连读 / 连读中」这类随状态改写的可见文案（状态交给 ▶ / ⏸ 表达）');

  d.querySelector('#gw-filter-seg button').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(randomBtn.disabled === false, '登录的 free 用户：整页连读键可用（free 不残缺）');
  chk(/连续播放原文/.test(randomBtn.getAttribute('title')) &&
    randomBtn.getAttribute('title') === '连续播放原文',
    '键义就是当前模式名（不再重复「，当前：…」）：' + randomBtn.getAttribute('title'));

  window.AuthCore.signOut(window.AuthCore.makeStore());
  d.querySelector('#gw-filter-seg button').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(randomBtn.disabled === true && /登录可用/.test(randomBtn.getAttribute('title')),
    '退出登录后：整页连读键置灰并说明原因：' + randomBtn.getAttribute('title'));

  (function reSignIn() {
    const r = window.AuthCore.signInTrusted(window.AuthCore.makeStore());
    chk(r.ok, '设备信任期内可一点登回（顺带覆盖 signInTrusted 这条路径）');
  })();
  d.querySelector('#gw-filter-seg button').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(randomBtn.disabled === false, '重新登录后恢复可播');
  chk(randomBtn.dataset.on === '0' && randomBtn.getAttribute('aria-pressed') === 'false',
    '初始为「可播放」态（data-on=0 / aria-pressed=false）');

  const bar = d.querySelector('.toolbar');
  chk(bar.children.length === 3, '工具栏是一行三样：搜索框 / 全部·未读组合 / 连读圆键');
  const barCss = fs.readFileSync(path + 'css/classic.css', 'utf8');
  chk(/\.toolbar \{[^}]*display:\s*flex/.test(barCss) && !/\.toolbar \{[^}]*flex-wrap:\s*wrap/.test(barCss),
    '工具栏不换行，三样始终同一行');
  chk(/\.filter-seg \{[^}]*flex:\s*0 0 auto/.test(barCss) && /\.gw-play-main \{[^}]*flex:\s*0 0 auto/.test(barCss),
    '筛选组合与「连读」圆键不压缩（搜索框独占剩余宽度）');
  chk(!randomBtn.classList.contains('toolbar-read'), '不再使用旧的 toolbar-read 专属样式');
  chk(!/\.seg-toggle/.test(barCss), '样式表里不再留 .seg-toggle 僵尸规则');

  const headPad = (barCss.match(/\.group-head \{([^}]*)\}/) || [, ''])[1];
  const toolbarBlock = barCss.match(/\.toolbar \{([^}]*)\}/)[1];
  chk(/margin-bottom:\s*12px/.test(toolbarBlock),
    '工具栏下边距 12px（与页顶顶栏的 12px 下内边距一致，搜索框上下等距）');
  chk(/padding:\s*12px 8px 8px 12px/.test(headPad),
    '卡头左内边距 12px（本轮 +4px）、上 12px / 右 8px / 下 8px 均不动');
  chk(!/padding:\s*12px 8px 8px;/.test(headPad),
    '卡头不能再写三段 padding（对称写法会把右侧那颗圆键一起推走 4px）');

  const headPadL = parseInt((headPad.match(/padding:\s*\d+px \d+px \d+px (\d+)px/) || [, '0'])[1], 10);
  const headPadR = parseInt((headPad.match(/padding:\s*\d+px (\d+)px/) || [, '0'])[1], 10);
  chk(headPadL === 12, '卡头左内边距 12px（原 8px 基础上 +4px，实际 ' + headPadL + 'px）');
  chk(headPadR === 8, '卡头右内边距仍是 8px（本轮右侧不动，实际 ' + headPadR + 'px）');
  chk(headPadL === itemPadL,
    '卡头与条目左内边距同一数值（两者是兄弟、左基准线对齐：卡头 ' +
    headPadL + ' / 条目 ' + itemPadL + '）');

  const cardDecls = cardCss[2].replace(/\/\*[\s\S]*?\*\//g, ' ');
  const cardPadParts = (cardDecls.match(/padding:\s*([^;]+);/) || [, '']) [1]
    .trim().split(/\s+/).map(v => parseFloat(v));
  const cardPadL = cardPadParts.length === 4 ? cardPadParts[3] : 0;
  chk(cardPadL === 2, '卡片左内边距 2px（main 上已生效的那一层，实际 ' + cardPadL + 'px）');
  chk(cardPadL + headPadL === cardPadL + itemPadL && cardPadL + headPadL === 14,
    '文字距卡片左缘 = 卡片 2px + 自身 12px = 14px（卡头 / 条目同值：' +
    (cardPadL + headPadL) + 'px）');
  chk(!/margin-bottom:\s*6px/.test(toolbarBlock),
    '工具栏不再保留旧的 6px 下边距（下方空档曾只有上方的一半）');
  chk(!/padding:\s*14px 2px 8px/.test(headPad),
    '分组标题不再保留旧的 14px 上内边距');

  const siteCss = fs.readFileSync(path + 'css/style.css', 'utf8');

  const topbarBlocks = [...siteCss.matchAll(/\.topbar \{([^}]*)\}/g)].map(m => m[1]);

  const topbarMain = topbarBlocks.find(b =>
    /max-width:\s*(720px|var\(--col-w|var\(--content-w)/.test(b)) || '';
  chk(/padding:[^;]*12px\s*;/.test(topbarMain),
    '顶栏主规则下内边距为 12px：搜索框上方的空档与下方同值，页首上下对称');

  chk(/padding:\s*12px 8px 8px 12px/.test(headPad),
    '卡头下内边距 8px：组名与圆键整体上抬，不再贴着下面那条线');
  chk(/\.group-card \.item:first-of-type \{ border-top:\s*1px solid color-mix\(in srgb, var\(--line\) 55%, transparent\); \}/
    .test(classicCssText),
    '首条的分隔线改为 55% 淡线（卡头与首条之间不再是一道重线）');
  chk(/\.group-card \.item \{[\s\S]*?border-top:\s*1px solid var\(--line\);/.test(classicCssText),
    '其余条目之间的分隔线保持原色（卡内节奏不变）');

  const toolbarCss = barCss.match(/\.toolbar \{([^}]*)\}/)[1];
  const H = (toolbarCss.match(/--toolbar-h:\s*(\d+)px/) || [])[1];
  chk(!!H, '工具栏声明统一行高变量 --toolbar-h（' + H + 'px）');
  ['\.search-input', '\.gw-play-main'].forEach(sel => {
    const css = barCss.match(new RegExp(sel + ' \\{([^}]*)\\}'))[1];
    chk(/height:\s*var\(--toolbar-h\)/.test(css) && /box-sizing:\s*border-box/.test(css),
      sel + ' 高度取自 --toolbar-h 且含描边（不高出工具栏）');
  });

  const mainCss = barCss.match(/\.gw-play-main \{([^}]*)\}/)[1];
  chk(/width:\s*var\(--toolbar-h\)/.test(mainCss),
    '「连读」圆键宽度与高度同源（--toolbar-h），宽高相等才是正圆');
  chk(/border-radius:\s*50%/.test(barCss.match(/\.gw-play \{([^}]*)\}/)[1]), '圆键 border-radius: 50%');
  chk(/\.gw-play-main \{([^}]*)\}?/.test(barCss) && /padding:\s*0/.test(barCss.match(/\.gw-play \{([^}]*)\}/)[1]),
    '圆键不做内边距（图标由 flex 居中，不靠 padding 撑）');

  chk(/color:\s*var\(--blue\)/.test(barCss.match(/\.gw-play \{([^}]*)\}/)[1]),
    '圆键用天水碧（--blue，小古文页主色）');
  const segCss = barCss.match(/\.filter-seg \{([^}]*)\}/)[1];
  chk(/height:\s*var\(--toolbar-h\)/.test(segCss) && /box-sizing:\s*border-box/.test(segCss)
    && /align-items:\s*stretch/.test(segCss),
    '「全部 / 未读」外框同样定高为 --toolbar-h，内层按钮铺满外框');
  const filterBtnCss = barCss.match(/\.filter-seg button \{([^}]*)\}/)[1];
  chk(/padding:\s*0\s+13px/.test(filterBtnCss) && /align-items:\s*center/.test(filterBtnCss),
    '组合按钮垂直方向只由外框决定高度，压过 .seg.mini button 的 5px 垂直 padding');

  const classicSheet = fs.readFileSync(path + 'css/classic.css', 'utf8');
  const phCss = classicSheet.match(/\.search-input::placeholder \{([^}]*)\}/);
  chk(!!phCss && /font-size:\s*12\.5px/.test(phCss[1]),
    '搜索框提示字（placeholder）字号压到 12.5px，与右侧「全部 / 未读」同号');

  chk(!!phCss && /transform:\s*translateY\(-2\.25px\)/.test(phCss[1]),
    '提示字上抬 2.25px，回到搜索框的水平中轴（只动伪元素，不动输入文字）');
  chk(!/padding(-top|-bottom)?\s*:/.test(phCss[1]) && !/line-height\s*:/.test(phCss[1]),
    '居中的修法不碰输入框本体（提示字用 transform，输入文字仍是居中的 16px）');

  const segMini = fs.readFileSync(path + 'css/style.css', 'utf8');
  chk(/\.seg\.mini button \{[^}]*font-size:\s*12\.5px/.test(segMini),
    '「全部 / 未读」实际字号 12.5px（.seg.mini button 压过 .filter-seg button 的 13.5px）');
  const searchCss = barCss.match(/\.search-input \{([^}]*)\}/)[1];
  chk(!/font-size:\s*12\.5px/.test(searchCss),
    '输入框自身字号不跟着压小（否则 iOS 聚焦会放大页面）');
  chk(/font-size:\s*var\(--input-font\)/.test(searchCss),
    '输入框字号走全站统一的 --input-font 变量，不写死数字');

  const classicTail = classicSheet.slice(classicSheet.lastIndexOf('--input-font-narrow') - 300);
  chk(/\.search-input \{\s*font-size:\s*var\(--input-font-narrow\);\s*\}/.test(classicTail),
    '小古文页在样式表末尾把输入框字号定回 16px（窄屏 iOS 不缩放）');
  chk(/@media screen and \(max-width: 700px\)/.test(classicTail),
    '这条窄屏规则写在媒体查询里（桌面仍是 14px）');

  const mhNow = [...d.querySelectorAll('#gw-list .group-head')].find(h => h.querySelector('.group-name').textContent === '蒙学经典') || mh;
  const mhBtn = mhNow.querySelector('.gw-play-sm');
  mhBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
  const playBar = d.querySelector('#reader-player');
  chk(!!playBar && playBar.hidden === false && window.Speech.active() === true,
    '点分组圆键确实开听了（底部播放栏弹出 + 语音引擎在跑，而不是只弹个提示）');

  if (playBar && !playBar.hidden) d.querySelector('#rp-stop').dispatchEvent(new window.Event('click', { bubbles: true }));

  const search = d.querySelector('#gw-search');
  search.value = '三字经';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  chk(d.querySelectorAll('#gw-list .item').length === 1, '搜索「三字经」命中 1 篇（实际 ' + d.querySelectorAll('#gw-list .item').length + '）');
  search.value = '';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  chk(d.querySelectorAll('#gw-list .item').length === 100, '清空搜索恢复 100 篇');

  const longItem = [...d.querySelectorAll('#gw-list .item')].find(el => el.textContent.includes('盘古开天地'));
  longItem.dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#gw-reader').hidden === false, '点击条目打开整页阅读器');
  chk(d.body.classList.contains('reader-open'), '打开时锁定页面滚动');
  chk(d.querySelector('#rd-title').textContent === '盘古开天地', '阅读器标题正确');
  chk(d.querySelector('#rd-meta').textContent.includes('太平御览'), '阅读器显示出处');
  chk(d.querySelector('#rd-text').textContent.length > 100, '长文完整渲染（' + d.querySelector('#rd-text').textContent.length + ' 字）');

  chk(d.querySelector('#rd-text').style.fontSize === '17px', '默认字号降一级为 17px（实际 ' + d.querySelector('#rd-text').style.fontSize + '）');

  const classicCss = fs.readFileSync(path + 'css/classic.css', 'utf8');
  const rdBlock = /(^|\n)\.reader-text \{([\s\S]*?)\}/.exec(classicCss);
  chk(!!rdBlock && /line-height:\s*1\.8;/.test(rdBlock[2]), '小古文正文行距压紧为 1.8');
  const pyBlock = /(^|\n)\.reader-text\.with-pinyin \{([\s\S]*?)\}/.exec(classicCss);
  chk(!!pyBlock && /line-height:\s*2\.5;/.test(pyBlock[2]), '注音档行距同步压紧为 2.5');

  chk(!!rdBlock && /text-align:\s*center;/.test(rdBlock[2]), '小古文正文文字居中');
  chk(!!rdBlock && /max-width:\s*fit-content;/.test(rdBlock[2]) && /margin:\s*[^;]*\bauto\b/.test(rdBlock[2]),
    '小古文正文块左右居中（fit-content + margin auto）');
  chk(!!pyBlock && /white-space:\s*normal;/.test(pyBlock[2]), '注音档改回 normal，居中时不被保留空白挤歪');
  chk(d.querySelector('#rd-trans').hidden === true, '译文默认折叠');

  d.querySelector('#rd-font-up').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#rd-text').style.fontSize === '19px', '放大字号生效（' + d.querySelector('#rd-text').style.fontSize + '）');
  d.querySelector('#rd-font-down').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#rd-text').style.fontSize === '17px', '缩小字号生效');
  chk(window.localStorage.getItem('poem_classic_font_v1') === '17', '字号记忆持久化');

  const fontSeg = d.querySelector('#rd-font-seg');
  chk(!!fontSeg && fontSeg.classList.contains('seg') && fontSeg.classList.contains('mini'),
    'A－ / A＋ 是组合按钮');
  chk([...fontSeg.querySelectorAll('button')].map(b => b.textContent.trim()).join('/') === 'A－/A＋',
    '组合按钮文案为 A－ / A＋');

  d.querySelector('#rd-font-down').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#rd-text').style.fontSize === '15px',
    '再点 A－ 可降一级到 15px（实际 ' + d.querySelector('#rd-text').style.fontSize + '）');

  for (const px of ['13px', '11px', '9px']) {
    d.querySelector('#rd-font-down').dispatchEvent(new window.Event('click', { bubbles: true }));
    chk(d.querySelector('#rd-text').style.fontSize === px,
      'A－ 可继续降到 ' + px + '（实际 ' + d.querySelector('#rd-text').style.fontSize + '）');
  }
  chk(window.localStorage.getItem('poem_classic_font_v1') === '9', '最细档同样持久化');
  d.querySelector('#rd-font-down').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#rd-text').style.fontSize === '9px',
    '到底后继续点 A－ 不再变化，最小字号锁定 9px（Issue #229）');

  for (let i = 0; i < 8; i++) {
    d.querySelector('#rd-font-up').dispatchEvent(new window.Event('click', { bubbles: true }));
  }
  chk(d.querySelector('#rd-text').style.fontSize === '25px',
    'A＋ 顶到 25px 就停（实际 ' + d.querySelector('#rd-text').style.fontSize + '）');
  d.querySelector('#rd-font-up').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#rd-text').style.fontSize === '25px', '到顶后继续点 A＋ 不再变大');

  for (let i = 0; i < 4; i++) {
    d.querySelector('#rd-font-down').dispatchEvent(new window.Event('click', { bubbles: true }));
  }
  chk(d.querySelector('#rd-text').style.fontSize === '17px',
    '从顶档收四档回到默认 17px（实际 ' + d.querySelector('#rd-text').style.fontSize + '）');

  d.querySelector('#rd-trans-toggle').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#rd-trans').hidden === false, '点译文图标展开译文');
  chk(d.querySelector('#rd-trans-toggle').dataset.on === '1', '译文按钮进入选中态（配色统一高亮）');

  chk(d.querySelectorAll('[id="rd-trans-text"]').length === 1, 'id rd-trans-text 唯一，不与按钮读屏文案冲突');
  chk(d.querySelector('#rd-trans-toggle-text').textContent === '收起译文', '读屏文案同步为「收起译文」');
  chk(d.querySelector('#rd-trans-text').textContent.length > 20, '白话译文段落有内容（不空白）');

  const srcEl = d.querySelector('#rd-trans-src');
  chk(!!srcEl, '译文框有来源注脚元素 #rd-trans-src');
  chk(srcEl && /公有领域|通行译注/.test(srcEl.textContent),
    '阅读器照实显示小古文译文的来源：' + (srcEl ? srcEl.textContent : ''));

  d.querySelector('#gw-done').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(/已读，再点一次取消/.test(d.querySelector('#gw-done-text').textContent), '标记后读屏文案变为「已读，再点一次取消」');
  chk(d.querySelector('#gw-done').classList.contains('is-done'), '标记已读按钮进入高亮态');
  chk(d.querySelectorAll('#rd-meta .rd-count').length === 0,
    '点「标记已读」之后详情页状态栏仍无读数（那一枚已整段撤除，不留死节点）');
  const store = JSON.parse(window.localStorage.getItem('poem_classic_read_v1'));
  chk(store['gw-17'] && store['gw-17'].read === true, '已读状态写入 localStorage（独立于古诗词进度）');
  chk(!window.localStorage.getItem('poem_recite_progress_v1'), '不会写古诗词进度 key，两边互不干扰');
  chk(!/\d\s*\/\s*\d+\s*(篇|首)/.test(d.querySelector('#rd-meta').textContent),
    '全站口径：列表页顶栏与详情页状态栏都不报「读了 N / M」（读了多少看列表的已读标记）');

  clickReaderBack();
  chk(d.querySelector('#gw-reader').hidden === true, '返回后阅读器关闭');
  chk(d.querySelectorAll('#gw-list .item.done').length === 1, '列表中已读条目有已读标记');

  d.querySelector('#gw-filter-seg button[data-filter="unread"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelectorAll('#gw-list .item').length === 99, '「未读」筛选剩 99 篇（实际 ' + d.querySelectorAll('#gw-list .item').length + '）');
  d.querySelector('#gw-filter-seg button[data-filter="all"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelectorAll('#gw-list .item').length === 100, '切回「全部」恢复 100 篇');

  d.querySelector('#gw-list .item').dispatchEvent(new window.Event('click', { bubbles: true }));
  const rdSeg = d.querySelector('#rd-pinyin-seg');
  chk(!!rdSeg, '阅读器有注音档位按钮组');
  chk(rdSeg.querySelectorAll('button').length === 3, '阅读器注音有 3 档');
  chk(!!d.querySelector('#rd-read-btn'), '阅读器有朗读按钮');

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

  const transBtn = d.querySelector('#rd-trans-toggle');
  chk(!!transBtn.querySelector('svg'), '「显示译文」按钮是 SVG 图标');
  chk(!/显示译文/.test(transBtn.cloneNode(true).querySelector('.sr-only') ? transBtn.textContent.replace(transBtn.querySelector('.sr-only').textContent, '') : transBtn.textContent),
    '译文按钮可见文字里不出现「显示译文」（只留在 .sr-only 给读屏软件）');
  chk(d.querySelector('#rd-trans-toggle').classList.contains('mini-btn'), '译文按钮与组合键同款样式');

  const rows = [...d.querySelectorAll('.reader-actions')];
  chk(rows.length === 2, '阅读辅助工具条是两行（实际 ' + rows.length + '）');
  const row1 = d.querySelector('#rd-actions-main');
  const row2 = d.querySelector('#rd-actions-icons');
  chk(!!row1 && !!row2, '两行工具条各有独立容器（主行 / 图标行）');

  chk(row1.children.length === 3 &&
    row1.querySelector('#rd-align-seg') && row1.querySelector('#rd-font-seg') && row1.querySelector('#rd-pinyin-seg'),
    '上一行依次是 对齐 / 字号 / 注音 三组按钮');

  chk(row2.children.length === 5 &&
    row2.querySelector('#rd-read-btn') && row2.querySelector('#rd-trans-toggle') &&
    row2.querySelector('#gw-daily') && row2.querySelector('#gw-done') && row2.querySelector('#gw-recite'),
    '下一行依次是 正文朗读键 / 译文开关 / 加入今日背诵 / 加入背诵 / 标记已读 五组（实际 ' +
    row2.children.length + '）');
  // 顺序（Issue #243 用户点名）：「今日背诵」那一颗插在**译文与加入背诵之间**。
  const iconIds = [...row2.children].map(el => el.id);
  chk(iconIds.join(',') === 'rd-read-btn,rd-trans-toggle,gw-daily,gw-recite,gw-done',
    '五颗的先后就是用户点名的位置（实际 ' + iconIds.join(',') + '）');
  chk(iconIds.indexOf('gw-daily') === iconIds.indexOf('rd-trans-toggle') + 1 &&
    iconIds.indexOf('gw-daily') === iconIds.indexOf('gw-recite') - 1,
    '「加入今日背诵」正插在**译文与加入背诵之间**（Issue #243 用户点名的那一格）');
  chk(row2.querySelectorAll('button > svg, button > span > svg').length >= 5, '图标行的按钮全部是 SVG 图标');
  chk(row2.querySelectorAll(':scope > button .sr-only').length === 5,
    '「正文朗读 / 译文开关 / 加入今日背诵 / 标记已读 / 加入背诵」的文案只留给读屏软件（.sr-only）');
  chk(d.querySelectorAll('.reader-actions .mini-btn, .reader-actions .seg.mini').length === 8,
    '工具条按钮共用同一套样式类（实际 ' +
    d.querySelectorAll('.reader-actions .mini-btn, .reader-actions .seg.mini').length + '）');
  const actionsCss = fs.readFileSync(path + 'css/classic.css', 'utf8');
  const actBlock = /(^|\n)\.reader-actions \{([\s\S]*?)\}/.exec(actionsCss);
  chk(!!actBlock && /flex-wrap:\s*nowrap;/.test(actBlock[2]), '工具条不换行，每行都排成一行');
  chk(/\.reader-actions\.icon-row/.test(actionsCss), '图标行有独立间距（第二行靠上、贴着第一行）');
  chk(/\.icon-row > \.mini-btn \{[^}]*width:\s*38px/.test(actionsCss), '译文开关 / 标记已读等宽，排成一条');

  const iconBtnBlock = /(^|\n)\.icon-row > \.mini-btn \{([\s\S]*?)\}/.exec(actionsCss);
  chk(!!iconBtnBlock && /line-height:\s*0;/.test(iconBtnBlock[2]),
    '图标按钮压掉行盒基线留白（line-height: 0），图标才真居中');

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

  const actionsRow = /(^|\n)\.reader-actions \{([\s\S]*?)\}/.exec(actionsCss);
  chk(!!actionsRow && /justify-content:\s*center;/.test(actionsRow[2]), '工具条两行都整行水平居中');

  chk(/\.trans-read \.btn-icon\.pause-glyph \{ display: none; \}/.test(actionsCss),
    '译文键的 ▶ / ⏸ 互斥显示（互斥规则的 specificity 高于 .btn-icon 的 display）');
  chk(/\.trans-read\[data-on="1"\] \.btn-icon\.play-glyph \{ display: none; \}/.test(actionsCss),
    '译文键播放中原地换成 ⏸，不再显示 ▶');
  chk(/\.trans-read\[data-on="1"\] \.btn-icon\.pause-glyph \{ display: inline-flex; \}/.test(actionsCss),
    '译文键暂停态用同一颗键的 ⏸ 表达');

  const styleCss = fs.readFileSync(path + 'css/style.css', 'utf8');
  const indexHtml = fs.readFileSync(path + 'index.html', 'utf8');
  const indexUsesClassic = /classic\.css/.test(indexHtml);
  const cssForStyle = indexUsesClassic ? styleCss + actionsCss : styleCss;
  chk(/\.trans-box \{/.test(cssForStyle), '首页详情页的译文框有样式（不是裸元素）');
  chk(/\.trans-read \{/.test(cssForStyle), '首页详情页的译文朗读键有样式（不是浏览器默认按钮）');
  chk(/\.trans-read \.btn-icon\.pause-glyph \{ display: none; \}/.test(cssForStyle),
    '首页详情页的译文键 ▶ / ⏸ 同样互斥，不同时并排');
  chk(/\.trans-head \{/.test(cssForStyle), '译文标题与译文键排成一行（标题左、键右）');

  const transReadBlock = /(^|\n)\.trans-read \{([\s\S]*?)\}/.exec(cssForStyle);
  chk(!!transReadBlock && /flex:\s*none;/.test(transReadBlock[2]),
    '译文键 flex: none，不被 .trans-head 的行高拉伸（胶囊不变扁）');
  chk(!!transReadBlock && /line-height:\s*[\d.]+;/.test(transReadBlock[2]),
    '译文键行高明确，高度由自身决定而非被标题撑开');
  chk(/\.done-btn\.is-done/.test(actionsCss), '「标记已读」按钮有已读高亮态');

  const navBlock = /(^|\n)\.reader-nav \{([\s\S]*?)\}/.exec(actionsCss);

  chk(!!navBlock && /margin:\s*26px (auto|0) calc\(118px \+ var\(--safe-bottom\)\)/.test(navBlock[2]),
    '阅读器底部导航预留 118px + 安全区，不被底栏压住');

  const navBtnBlock = /(\.reader-nav button \{)([\s\S]*?)\}/.exec(actionsCss);
  chk(!!navBtnBlock && /border:\s*none;/.test(navBtnBlock[2]),
    '翻篇键去掉边框（写 none，不留一条看不见的 1px 缝）');
  chk(!!navBtnBlock && /background:\s*transparent;/.test(navBtnBlock[2]),
    '翻篇键去掉底色（不写 transparent 时浏览器默认按钮底色会露出来）');
  chk(!!navBtnBlock && /padding:\s*11px 0;/.test(navBtnBlock[2]),
    '翻篇键左右内边距归零（贴齐正文两端）');
  chk(!!navBtnBlock && /border-radius:\s*0;/.test(navBtnBlock[2]),
    '翻篇键圆角归零（没有边框与底色，圆角已无意义）');

  const miniSegBlock = /(^|\n)\.seg\.mini \{([\s\S]*?)\}/.exec(actionsCss);
  chk(!!miniSegBlock && /padding:\s*0;/.test(miniSegBlock[2]),
    '组合框内边距归零 —— 内层按钮铺满框，与框共用同一条 1px 边（不再垫出 4px 的缝）');
  chk(!!miniSegBlock && /gap:\s*0;/.test(miniSegBlock[2]),
    '组合框 gap 归零（块与块之间只留那一条 1px 界行）');

  chk(/\.seg\.mini button:first-child \{ border-radius: var\(--radius-sm\) 0 0 var\(--radius-sm\); \}/.test(actionsCss),
    '首块只在左侧两个角取圆（右侧留给与下一块共用的那条界行）');
  chk(/\.seg\.mini button:last-child \{ border-radius: 0 var\(--radius-sm\) var\(--radius-sm\) 0; \}/.test(actionsCss),
    '末块只在右侧两个角取圆 —— A＋ 左侧是直线（用户点名的那处）');
  chk(/\.seg\.mini button,\s*\n\.seg\.mini button:not\(\.active\),\s*\n\.reader-actions \.seg\.mini button \{ border-radius: 0; \}/.test(actionsCss),
    '除首末块外一律方角（含 .reader-actions 那一份，压过更具体的旧规则）');
  chk(/\.seg\.mini button \+ button,\s*\n\.seg\.mini button\.active \+ button \{ border-left: 1px solid var\(--line\); \}/.test(actionsCss),
    '界行两条：相邻块之间，以及「选中块 → 它后面那块」（选中块自己不带边）');
  chk(/\.seg\.mini button\.active \{ box-shadow: none; \}/.test(actionsCss),
    '选中块的下划线撤掉（选中态由白底 + 字色说清楚，多一条线反而像错位）');

  chk(!/\.reader-actions \.seg\.mini \{ padding: 2px; \}/.test(actionsCss) &&
    !/\.reader-actions \.seg\.mini \{ padding: 3px; \}/.test(actionsCss),
    '阅读器内那一组的旧内边距（2px / 3px）已撤掉，不再把缝垫回来');

  const cssNoComments = actionsCss.replace(/\/\*[\s\S]*?\*\//g, '');
  chk(!/\.reader-actions \.seg\.mini button \{[^}]*border-radius: 8px/.test(cssNoComments),
    '阅读器里那条 8px 圆角已删（它正是把「共用边框」压回去的那一条）');

  const styleSheetText = fs.readFileSync(path + 'css/style.css', 'utf8');
  chk(/\.modal-box \.reader-actions \.seg\.mini button:first-child \{/.test(styleSheetText) &&
    /\.modal-box \.reader-actions \.seg\.mini button:last-child \{/.test(styleSheetText),
    '首页诗词详情页（只引 style.css）同样只给首末块留圆角');
  chk(/\.modal-box \.reader-actions \.seg\.mini \{ padding: 0; \}/.test(styleSheetText),
    '首页诗词详情页的组合框同样不留内边距');
  const readerBlock = /(^|\n)\.reader \{([\s\S]*?)\}/.exec(actionsCss);
  chk(!!readerBlock && /z-index:\s*66/.test(readerBlock[2]),
    '阅读器 z-index（66）高于底部页签（65），页签不浮在正文之上');
  chk(/body\.reader-open \.dock \{ display: none; \}/.test(actionsCss),
    '阅读器打开时收起底部页签，把底部空间让给翻篇导航');

  chk(/\.icon-row > \.mini-btn \{ width: 36px; min-height: 0; height: 36px; \}/.test(actionsCss),
    '窄屏档位的圆形图标键同为 36×36，宽高一致');

  const alignSeg = d.querySelector('#rd-align-seg');
  chk(!!alignSeg, '工具条上有「正文对齐」组合按钮');
  chk([...alignSeg.querySelectorAll('button')].map(b => b.dataset.align).join('/') === 'left/center',
    '对齐两档为 左 / 中');
  chk(alignSeg.querySelectorAll('button svg').length === 2, '两个对齐按钮都是 SVG 图标');
  chk(alignSeg.querySelectorAll('button[data-align="right"]').length === 0,
    '不再有右对齐按钮');
  chk(alignSeg.querySelector('button[data-align="center"]').classList.contains('active'),
    '默认选中「居中对齐」（古诗短句居中好看）');
  chk(d.querySelector('#rd-text').dataset.align === 'center', '正文默认居中（data-align="center"）');
  chk(new RegExp('\\.reader-body \\.reader-text\\[data-align="left"\\]').test(actionsCss),
    'CSS 里有左对齐规则（长古文左对齐更好读）');
  chk(!/reader-text\[data-align="right"\]/.test(actionsCss),
    'CSS 里不再有右对齐规则（右对齐无使用场景）');
  const alignBtn = k => d.querySelector('#rd-align-seg button[data-align="' + k + '"]');
  alignBtn('left').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#rd-text').dataset.align === 'left', '点左对齐立即生效（data-align="left"）');
  chk(alignBtn('left').classList.contains('active') && !alignBtn('center').classList.contains('active'),
    '对齐按钮选中态互斥（同一时刻只有一个是高亮）');
  chk(window.localStorage.getItem('poem_classic_align_v1') === 'left', '对齐方式持久化到 localStorage');

  d.querySelector('#rd-next').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#rd-text').dataset.align === 'left', '翻到下一篇后仍保持用户选的对齐方式');
  chk(alignBtn('left').classList.contains('active'), '翻篇后对齐按钮高亮同步');
  alignBtn('center').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#rd-text').dataset.align === 'center', '切回居中对齐');

  const segLabels = [...d.querySelectorAll('#rd-pinyin-seg button')].map(b => b.textContent.trim());
  chk(segLabels.join('/') === '不注音/生字/全文', '注音档位文案精简为 不注音/生字/全文（' + segLabels.join('/') + '）');

  chk(d.querySelectorAll('#rd-text ruby').length > 5,
    '阅读辅助开启时打开古文自动注音（' + d.querySelectorAll('#rd-text ruby').length + ' 个 ruby）');
  chk(/qū|qǔ/.test(d.querySelector('#rd-text').textContent) === false, '拼音走 rt 标签，不混进正文');

  const rdClick = (m) => d.querySelector('#rd-pinyin-seg button[data-mode="' + m + '"]')
    .dispatchEvent(new window.Event('click', { bubbles: true }));

  rdClick('rare');
  const rdRare = d.querySelectorAll('#rd-text ruby').length;
  const rdTotal = d.querySelector('#rd-text').textContent.replace(/\s/g, '').length;
  chk(rdRare > 0, '「只标生字」能标出生字（' + rdRare + ' 个 ruby）');
  chk(rdRare < rdTotal, '「只标生字」不会把整篇都注上（' + rdRare + ' < ' + rdTotal + '）');
  chk(/qū|qǔ/.test(d.querySelector('#rd-text').textContent) === false, '拼音走 rt 标签，不混进正文');
  chk(window.localStorage.getItem('poem_helper_pinyin_v1') === 'rare', '注音档位持久化为 rare');

  rdClick('all');
  chk(d.querySelectorAll('#rd-text ruby').length > rdRare,
    '「全文注音」比「只标生字」注得多（' + d.querySelectorAll('#rd-text ruby').length + ' > ' + rdRare + '）');

  rdClick('off');
  chk(d.querySelectorAll('#rd-text ruby').length === 0, '选「不注音」关闭注音');
  clickReaderBack();

  const doneItem = d.querySelector('#gw-list .item.done');
  doneItem.dispatchEvent(new window.Event('click', { bubbles: true }));
  d.querySelector('#gw-done').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#gw-done-text').textContent === '标记为已读', '再点一次可取消已读');
  chk(d.querySelector('#gw-done').classList.contains('is-done') === false, '取消后按钮恢复常态');
  chk(d.querySelectorAll('#rd-meta .rd-count').length === 0,
    '取消已读后状态栏照旧没有读数（这一枚已撤，取消不再牵动任何数）');
  chk(!JSON.parse(window.localStorage.getItem('poem_classic_read_v1'))['gw-17'], '取消后从存储中移除');

  console.log(fails === 0 ? '\n🎉 小古文测试全部通过' : '\n❌ ' + fails + ' 项失败');
  process.exit(fails ? 1 : 0);
}, 400);
