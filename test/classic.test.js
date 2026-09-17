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
// 正文存储主表：小古文里被主表收编的条目只存归属（textRef），
// 正文 / 译文在 data/text-master.js 里 —— 先加载它，再按 masterTextOf 取回。
// ⚠️ 必须排在 poems-classic.js 之前（取数函数要能读到表）。
vm.runInContext(fs.readFileSync(path + 'data/text-master.js', 'utf8'), sandbox, { filename: 'text-master.js' });
vm.runInContext(fs.readFileSync(path + 'data/poems-classic.js', 'utf8'), sandbox, { filename: 'poems-classic.js' });

// 数据层这一层拿到的应当是**展开正文后**的条目（与页面里引擎取到的一致）
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
// 译文来源标注：小古文多为先秦诸子与史传，原文属公有领域，据此标出通行译注口径。
// 不能一篇没有 —— 没有标注，用户就不知道译文是怎么来的（见 README「译文的取舍标准」）
// 小古文多为先秦诸子与史传，原文属公有领域，据此标通行译注口径（public-domain）。
// ⚠️ 例外：与课内同篇的那几条（《答谢中书书》等），正文收归主表后译文取自
//    课内那一份，来源随之是 school —— 译文确实换成了课本口径，标 school 才对。
const CLS_SRC_OK = ['public-domain', 'school'];
chk(CLS.every(p => CLS_SRC_OK.indexOf(p.translationSource) >= 0),
  '100 篇小古文都标了译文来源且取值在允许范围（异常 ' +
  CLS.filter(p => CLS_SRC_OK.indexOf(p.translationSource) < 0).length + ' 篇）');
chk(CLS.filter(p => p.translationSource === 'public-domain').length === 99,
  '其中 99 篇标 public-domain（与课内同篇的 1 篇取自课本口径，标 school）');
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
// 假语音引擎 + 假登录：jsdom 默认既没有 SpeechSynthesis 也没有账号，
// 那样这颗键永远是「置灰」态，测不出它真正的键义（Issue #132：未登录禁语音）。
window.SpeechSynthesisUtterance = function (t) { this.text = t; };
window.speechSynthesis = {
  speaking: false, speak() { this.speaking = true; }, cancel() { this.speaking = false; },
  getVoices() { return []; }, addEventListener() {}
};
window.__setSpeechGate = function (on) {
  if (window.Speech && window.Speech.setGate) window.Speech.setGate(function () { return { ok: on, hint: '' }; });
};
// 预置一个**真的**本机会话（调 auth-core，不手拼 JSON）：
// 只开 Speech 的门而没登录，权益层仍会判成游客 —— 测不出「登录后能听」这条。
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
  /* ---------- 已读进度：跟着**详情页状态栏**走（Issue #147） ---------- */
  // 用户原话：「删除所有页面标题栏中的 0 / 0 篇、0 / 283 首这些，节省空间；
  //   将 0 / 283 首 挪到详情页的 宋 张先《宋词三百首》的后面，同一行」。
  // 于是：
  //   · 页顶那一行**一个读数都没有**（原先挂在品牌区与返回键之间的 .count-badge 已撤）；
  //   · 详情页状态栏（.rd-meta：朝代 · 作者 · 出处）里同样一枚读数都没有 ——
  //     上一轮挪进状态栏的那一枚 .rd-count，这一轮按用户的追加要求也撤了
  //     （「删除所有详情页中的 0 / 167 篇及类似的」，见 Issue #147 两轮口径）。
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
  // 页顶那一行留下的只有「品牌区 · 返回键 · 头像」三件，次序不变。
  // Issue #147 之后返回键**住在右侧簇那枚固定圆槽里**（.top-slot）——
  // 顶端两件仍是 brand / 槽，槽里才是返回键，槽右边才是头像；
  // 逐层数下来次序与「品牌区 · 返回键 · 头像」完全一致。
  const topbar = d.querySelector('.topbar');
  const rightSlot = topbar.querySelector(':scope > .top-slot');
  chk([...topbar.children].map(e => e.className.split(' ')[0]).join('/') === 'brand/top-slot/top-user',
    '页顶一行是「品牌区 · 〔返回键槽〕 · 头像」（实际 ' +
    [...topbar.children].map(e => e.className).join('/') + '）');
  chk(!!rightSlot && !!rightSlot.querySelector(':scope > #top-back') &&
    [...rightSlot.children].map(e => e.className.split(' ')[0]).join('/') === 'top-act',
    '返回键就在右侧簇那枚固定圆槽里（槽里只有它一件）');
  // ⚠️ 这一条是 Issue #147 的正题：**返回键与头像的位置不许随页名长短移动**。
  //    上一版返回键直接跟在品牌区后面（整行 space-between），搜索页页名短，
  //    那一颗箭头就比别页左偏 —— 用户的报障正是这个。位置由固定的槽 + 恒定锚点
  //    决定，所以这里守「顶栏右端两件的次序与尺寸都由 .top-slot 一套口径给」。
  const cssAll = fs.readFileSync(path + 'css/style.css', 'utf8');
  chk(/\.top-slot \{[^}]*margin-left:\s*auto/.test(cssAll),
    '返回槽由 margin-left: auto 钉在右侧（不随左边品牌区的宽度浮动）');
  chk(/\.top-slot \{[^}]*width:\s*var\(--top-slot\)/.test(cssAll) &&
    /\.top-user \{[^}]*--user-size:\s*var\(--top-slot\)/.test(cssAll),
    '返回槽与头像取同一枚 --top-slot（顶栏右侧每一件只有一个尺寸来源）');
  const backBtn2 = topbar.querySelector('#top-back');
  chk(!!backBtn2 && backBtn2.tagName === 'A' && backBtn2.getAttribute('href') === '/',
    '返回键统一由 chrome.js 渲染（回首页），页面不再自造一颗');
  chk(!!backBtn2.querySelector('svg') && backBtn2.querySelectorAll('svg').length === 1,
    '返回键只有一个箭头图标（不放页名文字）');

  // 阅读器顶栏与列表页逐项对齐：同一套 .topbar 结构 ——
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
  // 详情页状态栏：朝代 · 作者 · 出处 · 选本，**只有标签、没有读数**（Issue #147 追加一轮）
  const rMeta = d.querySelector('#rd-meta');
  chk(rMeta.querySelectorAll('.rd-count').length === 0,
    '详情页状态栏里不再有已读读数 .rd-count（实际 ' +
    rMeta.querySelectorAll('.rd-count').length + ' 枚）');
  chk(!/\d\s*\/\s*\d+\s*(篇|首)/.test(rMeta.textContent),
    '状态栏整行不含「N / M 篇」这类读数（实际「' + rMeta.textContent + '」）');
  chk(!!rMeta.querySelector('.tag') && rMeta.textContent.indexOf('王应麟') >= 0,
    '同一行里朝代 / 作者 / 出处都还在（实际「' + rMeta.textContent + '」）');
  // ⚠️ 阅读器那条顶栏**没有头像**：阅读器是全屏沉浸层，身份入口不在正文上出现
  //（头像让位给正文，见 js/chrome.js 的 headerHtml）。
  // Issue #147 后续（用户 2026-09-15 二次确认）：那里原先是一枚「翻开的这一册」
  // （`.top-slot-mark`），用户看着像一本多余的书，要求撤掉 —— 于是换成一枚
  // **不可见的占位**（`.top-act-spacer`）：书没了，像素位一个都不动，
  // 阅读器的「合上」仍与页面返回键同处一个像素位。
  chk([...rBar.children].map(e => e.className.split(' ')[0]).join('/') === 'brand/top-slot/top-act-spacer',
    '阅读器顶栏是「品牌区 · 〔返回键槽〕 · 不可见占位」，**不含头像 / 篇号牌 / 任何图标**（实际 ' +
    [...rBar.children].map(e => e.className).join('/') + '）');
  const rSlot = rBar.querySelector(':scope > .top-slot');
  chk(!!rSlot && !!rSlot.querySelector(':scope > #top-act'),
    '阅读器的「合上」也住在同一枚固定圆槽里（与页面那条同一个像素位）');
  chk(d.querySelectorAll('.reader .topbar .top-user').length === 0,
    '阅读器里确实一枚头像都没有（让位给正文）');
  // 反向防线：那枚「书」连同它的样式规则一起清掉，不许留下僵尸
  chk(!/\.top-slot-mark/.test(cssAll),
    '样式表里不再留 `.top-slot-mark` 规则（留着下一个人会以为阅读器里还有一枚图标）');
  chk(!/\.top-slot-mark/.test(fs.readFileSync(path + 'js/chrome.js', 'utf8').replace(/\/\/[^\n]*/g, ' ')),
    '引擎的代码里也不再生成 `.top-slot-mark`');
  chk(/\.top-act-spacer \{[^}]*width:\s*var\(--top-slot\)/.test(cssAll),
    '那枚占位与头像同径（--top-slot），所以返回键原地不动');
  chk(/\.top-slot \+ \.top-user,[\s\S]{0,120}\.top-act-spacer/.test(cssAll),
    '槽与恒定锚点之间的间距只有一个来源（--top-gap）');
  chk(rBar.querySelector('.brand-page-text').textContent === '课外必背小古文',
    '阅读器里的页名同样是「课外必背小古文」，与列表页一致');
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
    '顶栏那件「跬步 · 小古文」仍在（撤掉的只是那枚读数）');
  // 需求（本次）：顶栏整行仍垂直居中 —— 靠 .topbar 的 align-items: center。
  // ⚠️ .topbar-with-count / .count-badge 两条样式已随进度牌一起撤（Issue #147），
  //    这里反向守住：样式表里不该再留着这两位「页顶读数」的僵尸规则 ——
  //    留着的唯一后果是下一个人以为页顶还有一枚牌子，改样式时白改一遍。
  const styleCss0 = fs.readFileSync(path + 'css/style.css', 'utf8');
  const topbarBlock = /(^|\n)\.topbar \{([\s\S]*?)\}/.exec(styleCss0);
  chk(!!topbarBlock && /align-items:\s*center;/.test(topbarBlock[2]),
    '顶栏 flex 垂直居中（徽标 / 页名 / 副标题 / 返回键同一条中轴）');
  chk(!/\.topbar-with-count/.test(clsCss) && !/\.count-badge/.test(clsCss),
    '样式表里不再留 .topbar-with-count / .count-badge 这一套页顶读数样式');
  // ⚠️ 判据要写成「不再有 .rd-count 的**规则**」而不是「不再出现 .rd-count 这几个字」：
  //    上面那段注释里正解释着「为什么这一枚撤了」，注释里提到类名是应当的，
  //    拿 s.indexOf 去卡就把注释也一起卡死了 —— 那会逼着下一个人删掉解释。
  chk(!/\.rd-count\s*[,{]/.test(clsCss),
    '样式表里不再留 .rd-count 规则（详情页那一枚读数已撤，留着只会让人以为还有一处读数）');
  chk(d.querySelectorAll('#gw-list .group-head').length >= 6, '按主题显示分组标题（' + d.querySelectorAll('#gw-list .group-head').length + ' 个）');

  // 需求（Issue #69 本轮）：每个分组右侧那颗播放键改成**组合播放键** ——
  // 点一下按当前模式连读本组，长按 / 右键从五种模式里挑一种。
  // 形状仍是全站那枚小号圆键（26px），但内里多两样：模式菜单 + 一枚模式记号。
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
  // 圆键的**可见文字里不许有模式名**（图标表达状态，键义走 title / aria-label）——
  // 这一条原先写的是 `b.textContent.trim() === ''`，口径太粗：
  // 组合键的菜单（五个模式名）就长在这颗按钮里，渲染后它们当然在 DOM 里，
  // `textContent` 一定不为空。真正要盯的是**这两件事**：
  //   · 圆键的可见文字里不出现模式名（`innerText`，jsdom 未实现 → 退到可见文本）；
  //   · 菜单项的文字分别挂在菜单项自己身上，不会被读成按钮名。
  // 圆键自己的名字（`连续播放原文，当前：原文 · 顺序`）由 title / aria-label 给，
  // 见下一条断言；读屏念按钮时拿到的也是那一句。
  chk(groupBtns.every(b => (b.innerText === undefined ? true : !/连续播放|随机播放/.test(b.innerText))),
    '圆键渲染出来的文字里不含模式名（菜单项在收起的菜单里）');
  chk(groupBtns.every(b => [...b.querySelectorAll('.gw-menu-item')].every(
    x => x.textContent.trim().length > 0)),
    '五个模式名分别挂在各自的菜单项上（不是圆键的可见文字）');
  chk(groupBtns.every(b => /连续播放原文/.test(b.getAttribute('title') || '') &&
    /当前：/.test(b.getAttribute('aria-label') || '')),
    '分组圆键的读屏文案报出「当前是哪种模式」：' + groupBtns[0].getAttribute('aria-label'));
  chk(groupBtns.every(b => b.parentElement.classList.contains('group-head')),
    '分组圆键就在分组标题那一行里（不另起一行）');
  // 组合键必须有可见的「它不止一种用法」记号：▶ 右下角一枚小点
  chk(groupBtns.every(b => !!b.querySelector('.play-mode')),
    '组合键上带一枚模式记号（.play-mode 小点）');

  // 五种模式：连续原文 / 连续白话 / 原文白话顺序 / 随机原文 / 随机白话
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
  // 挑一种模式：菜单项点下去要真换模式，而且就地开听（少一次点击）
  //
  // 这张表**不再写在引擎里**：五档模式 / 存储键 / 出厂档统一收进
  // js/play-modes.js，因为设置页也要读它（Issue #69 后续 A+B）。
  // 两份各写一遍，字或 id 一改就会错开 —— 那时「设置里选中的」与
  // 「圆键实际连读的」不是同一档，而且两边页面都正常，最难查。
  const modeJs = fs.readFileSync(path + 'js/reader-core.js', 'utf8');
  const sharedJs = fs.readFileSync(path + 'js/play-modes.js', 'utf8');
  chk(/"seq-origin"/.test(sharedJs) && /"shuffle-trans"/.test(sharedJs) &&
      /var LIST = \[/.test(sharedJs),
    '五种模式在 js/play-modes.js 里有一张单一来源的表');
  chk(!/var PLAY_MODES = \[\s*\{/.test(modeJs),
    '引擎不再自己抄一份模式表（避免与设置页错开）');
  chk(/window\.PlayModes/.test(modeJs), '引擎读的是那份共用定义（PlayModes）');
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
  chk(d.querySelector('#brand-page-text').textContent === '课外必背小古文',
    '页面名紧随「跬步」右侧：' + d.querySelector('#brand-page-text').textContent);
  chk(d.title === '课外必背小古文 · 跬步', '集子页标题为「课外必背小古文 · 跬步」（实际 ' + d.title + '）');
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
  chk(dockItems.map(b => b.querySelector('.dock-label').textContent).join('/') === '背诵/课外/搜索/设置',
    '底部页签与首页一致（背诵/课外/搜索/设置）');
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
  chk(d.querySelector('#brand-page-text').textContent === '课外必背小古文',
    '页面名与 chrome.js 的 data-page 一致，由 CSS 的 ::before 生成分隔符（不再写死标点）');
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
  // 需求（Issue #55 后续，本轮）：卡头「蒙学经典 4 篇」那一行与左侧边框的间距
  // 再加 2px。加在卡片这层（.group-card 的左内边距 0 → 2px），而不是卡头自己的
  // padding —— 卡头与卡内条目共用同一条左缘，只动 .group-head 会让组名比下面的
  // 篇目多缩进 2px、卡头看着歪出半格。写在卡片上则卡头 / 条目 / 分隔线一起右移，
  // 卡内「条目左 12px / 右 8px」的相对关系一点不变。
  // 原先左内边距是 0（旧版 4px 是给「整条左色条」的，合并成卡片后只剩一道空白，
  // 与条目自己的装饰重复 —— 已收掉）；本轮只加回用户要的 2px，右侧仍是 0。
  chk(!!cardCss && /padding:\s*0 0 10px 2px;/.test(cardCss[2]),
    '卡片左内边距 2px（卡头与左侧边框的间距 +2px）、右内边距仍为 0');
  // 这 2px 与条目 / 卡头自己的左内边距是**两层**，相加才是「文字距卡片左缘」：
  //   卡片 2px + 条目 12px = 14px（条目文字）
  //   卡片 2px + 卡头 12px = 14px（组名）
  // 卡头与条目仍严格落在同一条基准线上（下面几段会分别锁住这两个 12px）。
  // 另：原先紧跟在 `padding` 之后还有一条 `padding-left: 0`（去「大竖绿线」时
  // 顺手留下的兜底）。它会把上面这 2px 静默覆盖回 0 —— 两处都在动左内边距，
  // 留一条「后来的零」在源码里等于给下一次调整埋雷，已一并删除。
  // 断言必须落在**声明**上，不能落在注释文字上 —— 否则注释里引用一下
  // `padding-left: 0` 也会把这条防线点亮（红得莫名其妙）。先剔掉注释再判。
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

  // 需求（Issue #55 后续）：条目左内边距 10 → 12px —— 列表内容与卡片左缘之间
  // **只加左侧 2px**；右侧仍是 8px（那是「卡片右缘 → 播放键 / 箭头」的间距，
  // 用户明确要求不要跟着动）。写成四值 padding 而不是 `12px 12px`，
  // 就是为了让「只加左边」这件事在源码里看得见：一旦有人顺手改成对称写法，
  // 右侧也会被推走，下面的数值断言会红。
  const itemPadBlock = /(^|\n)\.group-card \.item \{([\s\S]*?)\}/.exec(classicCssText);
  chk(!!itemPadBlock && /padding:\s*12px 8px 12px 12px;/.test(itemPadBlock[2]),
    '条目左内边距 12px（再 +2px）、右内边距仍 8px（只加左侧）');
  chk(!!itemPadBlock && !/padding:\s*12px 12px;/.test(itemPadBlock[2]),
    '右侧内边距没有被一起推走（不能写成 12px 12px 的对称写法）');
  // 口径（合并 main 后）：main 上另有「卡片左内边距 2px」的改动，那是**卡片层**，
  // 卡头 / 条目 / 首条淡线整体右移。两层相加才是「文字距卡片左缘」= 2 + 12 = 14px，
  // 条目与卡头的基准线仍重合（卡头左内边距同为 12px，见后面的断言）。
  // 这里锁住「层层只加左边」：卡片的右侧内边距仍是 0。
  chk(!!cardCss && /padding:\s*0 0 10px 2px;/.test(cardCss[2]),
    '条目 12px 是加在卡片 2px 之上的第二层（文字距卡片左缘 = 2 + 12 = 14px）');

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

  // 需求（Issue #55 后续）：卡内条目的播放键左侧间距减到 0，把空档让给正文。
  // 全站 .item 是 flex + gap: 12px，首页今日条只有「正文 ↔ 一颗圆键」一段间隔；
  // 小古文条目右侧是「圆键 + 箭头」两颗图标，同一份 12px 摊在两段上，
  // 播放键被推得比首页远一倍。现在卡内 gap 清零、两个图标各自给外边距：
  //   正文 … 0px … 圆键 … 6px … 箭头 …（条目 8px 右内边距）
  // 播放键左侧**不再用负外边距**（上一轮的 -12px 只会把圆键压到正文上，
  // 正文一个字都不会变长，见下一条断言）；右侧那 6px（圆键 ↔ 箭头）一律不动。
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

  // 需求（Issue #69 后续）：两颗图标钉在条目右缘。
  // 内容块按内容取宽之后，条目右侧空出一大段余量 —— 内容是 flex 项、
  // 不能把余量「放在它后面」，只能让箭头吃掉：margin-left: auto。
  const arrowAutoBlock = /(^|\n)\.item-arrow \{([\s\S]*?)\}/.exec(classicCssText);
  chk(!!arrowAutoBlock && /margin-left:\s*auto;/.test(arrowAutoBlock[2]),
    '箭头 margin-left: auto（把播放键 + 箭头整组推到条目右缘）');
  chk(!/\.item-main \{[^}]*margin-left:\s*auto/m.test(classicCssText),
    '内容块仍贴左缘（余量交给箭头吃掉，不是把内容块居中）');

  // 需求（Issue #55 后续）：左侧正文的宽度真的放开。
  // 这一条是本轮的正主：只把播放键的间距改小**不会**让正文变长 ——
  // 内容块是全站那句 `flex: 1 1 0%`（flex 增长项），宽度只由「条目宽 − 两侧图标
  // − 列距 − 内边距」分配而来，与内容宽度无关。要真正放开，必须把内容块改成
  // 「按内容取宽」，并把播放键左侧那段空档交给正文占用。
  // ⚠️ 选择器是 `#gw-list .item .item-main`（Issue #69 后续改的）：
  // 原先只写 `#gw-list .group-card .item-main`，搜索页的结果不分卷次、不套卡片，
  // 那一句在那里命中不到 —— 搜索页的内容块仍是增长项，右侧两颗图标被顶进条目里、
  // 不贴右缘（用户反馈的「播放和向右箭头不是右侧对齐」）。
  const mainBlock = /(^|\n)#gw-list \.item \.item-main \{([\s\S]*?)\}/.exec(classicCssText);
  chk(!!mainBlock && /flex:\s*0 1 auto;/.test(mainBlock[2]),
    '集子页与搜索页的内容块都按内容取宽（flex: 0 1 auto，不再是全站的增长项 1 1 0%）');
  chk(!!mainBlock && !/flex:\s*0 0 auto;/.test(mainBlock[2]),
    '内容块不写 flex: 0 0 auto（自动宽 + 摘要 ellipsis 两次布局互相依赖，会退回最小宽）');
  // 需求（Issue #69 后续）：搜索页与集子页的条目右内边距必须同值（都是 8px），
  // 否则同一个「箭头 → 条目右缘」的量在两页差 6px，并排看就是箭头缩了一截。
  const searchPadBlock = /body\[data-nav="search"\] #gw-list \.item \{([\s\S]*?)\}/.exec(classicCssText);
  const searchPad = searchPadBlock ? searchPadBlock[1].replace(/\/\*[\s\S]*?\*\//g, ' ') : '';
  chk(/padding:\s*14px 8px 14px 14px;/.test(searchPad),
    '搜索页条目右内边距收成 8px（与集子页同值，箭头在两页落在同一条右基准线上）');

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
  /* ⚠️ 判据从「等于 16.5px」翻成「等于标题字号」：Issue #163 第四轮把
     「一页里最大的那颗标题」这一档从 16.5px 提到 17px（与设置页的卡片主标题、
     集子卡头卷名同一句），序号圆跟着一起走。写死一个数字的守卫会在改口径时
     变成假红 —— 而它真正要守的是「圆与字永远同高」这件事（下面那一条）。 */
  chk(!!numBlock && /--item-num:\s*[\d.]+px;/.test(numDecls),
    '序号圆直径走 --item-num（与 .item-title 的字号同一个数）');
  chk(!!numBlock && /width:\s*var\(--item-num\)/.test(numDecls) && /height:\s*var\(--item-num\)/.test(numDecls),
    '序号圆的宽高同源（同一个变量），永远是正圆');
  /* 标题字号现在写在文件中部那条共用块里（`.settings-group-title,
     .settings-link-title, .account-entry-name, .item-title`），
     `.item-title` 自己那条只管排布 —— 所以这里从共用块取。 */
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
  chk(itemPadL === 12,
    '条目左内边距 12px（8 → 10 → 12，累计 +4px，实际 ' + itemPadL + 'px）');
  const itemPadR = parseInt((itemPadBlock[2].match(/padding:\s*\d+px (\d+)px/) || [, '0'])[1], 10);
  chk(itemPadR === 8,
    '条目右内边距保持 8px 不变（实际 ' + itemPadR + 'px）：本轮只加左侧');
  chk(itemPadL === itemPadR + 4,
    '左右差恰好 4px（左 ' + itemPadL + ' / 右 ' + itemPadR + '）：要加的就是这 4px');

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
  // 工具栏那颗「整页连读」与卡头组合键是同一档模式，title 里也要带上当前模式：
  // 「连续播放原文，当前：原文 · 顺序」——读屏用户靠它知道点下去会怎么放。
  // 预置的会话已登录（见文件头 seedSignedIn），所以这里是「登录的 free 用户」那一档。
  d.querySelector('#gw-filter-seg button').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(randomBtn.disabled === false, '登录的 free 用户：整页连读键可用（free 不残缺）');
  chk(/连续播放原文/.test(randomBtn.getAttribute('title')) &&
    /当前：/.test(randomBtn.getAttribute('title')),
    '键义与当前模式都写在 title 里：' + randomBtn.getAttribute('title'));
  // 反过来：退出登录（清会话）后必须置灰，并说明原因 —— 这是用户明确要的那条规则
  window.AuthCore.signOut(window.AuthCore.makeStore());
  d.querySelector('#gw-filter-seg button').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(randomBtn.disabled === true && /登录可用/.test(randomBtn.getAttribute('title')),
    '退出登录后：整页连读键置灰并说明原因：' + randomBtn.getAttribute('title'));
  // 再登回来，后面的「点分组圆键开听」才有意义。
  // ⚠️ 不能重新发码：60 秒重发冷却会直接挡住（E_RATE_EMAIL）——
  //    走「设备信任期」这条产品里本来就有的路径（30 天内一点即入）。
  (function reSignIn() {
    const r = window.AuthCore.signInTrusted(window.AuthCore.makeStore());
    chk(r.ok, '设备信任期内可一点登回（顺带覆盖 signInTrusted 这条路径）');
  })();
  d.querySelector('#gw-filter-seg button').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(randomBtn.disabled === false, '重新登录后恢复可播');
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
  chk(/padding:\s*12px 8px 8px 12px/.test(headPad),
    '卡头左内边距 12px（本轮 +4px）、上 12px / 右 8px / 下 8px 均不动');
  chk(!/padding:\s*12px 8px 8px;/.test(headPad),
    '卡头不能再写三段 padding（对称写法会把右侧那颗圆键一起推走 4px）');
  // 需求（Issue #55 后续）：「卡头那一行多 4px」——只加左侧 4px，右侧一律不动。
  // 卡头左内边距 8 → 12px（+4px）。它与条目左内边距同样是 12px，但两者是**兄弟**，
  // 且都长在「卡片左内边距 2px」这层之上（合并 main 后的口径）：
  //   · .group-card 的左内边距 2px 让卡头 / 条目 / 首条淡线整体右移，
  //     卡头文字与条目文字都从「卡片左缘 + 2px + 自己的左内边距」起算，
  //     两条左基准线仍严格对齐（2 + 12 = 14px，两处同值）；
  //   · 「多 4px」体现在卡头行本身：组名与右端那颗 26px 圆键之间收窄 4px，
  //     而右侧内缘（8px）没动。
  // 一旦有人把这里写成对称的三值 `12px 8px 8px`，右侧会被一起推走 4px，下面会红；
  // 若有人为了「补」卡片的 2px 把卡头改成 14px，下面的基准线断言同样会红。
  const headPadL = parseInt((headPad.match(/padding:\s*\d+px \d+px \d+px (\d+)px/) || [, '0'])[1], 10);
  const headPadR = parseInt((headPad.match(/padding:\s*\d+px (\d+)px/) || [, '0'])[1], 10);
  chk(headPadL === 12, '卡头左内边距 12px（原 8px 基础上 +4px，实际 ' + headPadL + 'px）');
  chk(headPadR === 8, '卡头右内边距仍是 8px（本轮右侧不动，实际 ' + headPadR + 'px）');
  chk(headPadL === itemPadL,
    '卡头与条目左内边距同一数值（两者是兄弟、左基准线对齐：卡头 ' +
    headPadL + ' / 条目 ' + itemPadL + '）');
  // 两层叠加的口径收口：卡片的 2px 是共同的那一层，卡头 / 条目各自的 12px 是第二层，
  // 于是「文字距卡片左缘」两处都是 2 + 12 = 14px。改任何一层都要连着另一层一起看。
  // .group-card 是四值 `padding: 上 右 下 左`（0 0 10px 2px）—— 第 4 个值才是左内边距。
  // 注意这里的上下两个值是**无单位**的 `0`，所以不能用 `\d+px` 那种写法去量，
  // 得逐个取「数值 + 可选单位」；断言前也先剔掉注释，免得注释里写到的数值被当成声明。
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
  // 源码级对账：页顶那一行的下内边距（搜索框上方）也必须是 12px，两段同源同值。
  const siteCss = fs.readFileSync(path + 'css/style.css', 'utf8');
  // .topbar 有两条规则（主规则 + 窄屏媒体的 padding-top 覆盖），取含 max-width 的那条主规则
  const topbarBlocks = [...siteCss.matchAll(/\.topbar \{([^}]*)\}/g)].map(m => m[1]);
  // ⚠️ 宽度令牌换过两次（720px → var(--col-w) → var(--content-w)，见 css/style.css
  //    里「内容列宽」那一条），所以这里按「含 max-width 且读某个宽度令牌」认主规则，
  //    不再写死具体令牌 —— 这条断言管的是**下内边距 12px**，不该被宽度令牌的改名绊倒。
  const topbarMain = topbarBlocks.find(b =>
    /max-width:\s*(720px|var\(--col-w|var\(--content-w)/.test(b)) || '';
  chk(/padding:[^;]*12px\s*;/.test(topbarMain),
    '顶栏主规则下内边距为 12px：搜索框上方的空档与下方同值，页首上下对称');
  // 需求（Issue #55 第三条）：卡头「蒙学经典 4 篇」与右侧圆键不再压在首条的分隔线上。
  // 两件事一起做：卡头下内边距 0 → 8px；首条不画分隔线（留线会变成「卡头 → 线 → 首条」）。
  chk(/padding:\s*12px 8px 8px 12px/.test(headPad),
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
  // 这一份页面装的是**假语音引擎**且已登录（见文件头 seedSignedIn），所以这一下
  // 应当真的能把本组读起来 —— 播放栏弹出 + 引擎在跑就是证据。
  // mh 是上面几节里抓到的那颗分组卡头，可能已被后续的列表重绘淘汰（换了「未读」筛选
  // 或搜索都会整块重建列表，旧节点成了游离节点 —— 在它上面派发事件不会有人接）。
  // 所以这里**重新取当下的节点**，与「用户在页面上真的点一下」等价。
  const mhNow = [...d.querySelectorAll('#gw-list .group-head')].find(h => h.querySelector('.group-name').textContent === '蒙学经典') || mh;
  const mhBtn = mhNow.querySelector('.gw-play-sm');
  mhBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
  const playBar = d.querySelector('#reader-player');
  chk(!!playBar && playBar.hidden === false && window.Speech.active() === true,
    '点分组圆键确实开听了（底部播放栏弹出 + 语音引擎在跑，而不是只弹个提示）');
  // ⚠️ 阅读器被顺带打开是**预期行为**：连读到某一篇要跟着高亮并展开那一篇。
  //    这里只把播放栏收起，后面几条断言（搜索、点条目开阅读器）才不会互相打架。
  if (playBar && !playBar.hidden) d.querySelector('#rp-stop').dispatchEvent(new window.Event('click', { bubbles: true }));

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
  chk(d.querySelectorAll('#rd-meta .rd-count').length === 0,
    '点「标记已读」之后详情页状态栏仍无读数（那一枚已整段撤除，不留死节点）');
  const store = JSON.parse(window.localStorage.getItem('poem_classic_read_v1'));
  chk(store['gw-17'] && store['gw-17'].read === true, '已读状态写入 localStorage（独立于古诗词进度）');
  chk(!window.localStorage.getItem('poem_recite_progress_v1'), '不会写古诗词进度 key，两边互不干扰');
  chk(!/\d\s*\/\s*\d+\s*(篇|首)/.test(d.querySelector('#rd-meta').textContent),
    '全站口径：列表页顶栏与详情页状态栏都不报「读了 N / M」（读了多少看列表的已读标记）');

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
  // 需求 1：正文朗读键 / 译文开关 / 标记已读 / 加入背诵 在下行。
  // 「加入背诵」（自选集合）加在最后：它把这一篇收进用户自己的清单，
  // 与「标记已读」（记录这一部的阅读进度）是两回事，所以是并列的两颗键。
  chk(row2.children.length === 4 &&
    row2.querySelector('#rd-read-btn') && row2.querySelector('#rd-trans-toggle') &&
    row2.querySelector('#gw-done') && row2.querySelector('#gw-recite'),
    '下一行依次是 正文朗读键 / 译文开关 / 标记已读 / 加入背诵 四组（实际 ' + row2.children.length + '）');
  chk(row2.querySelectorAll('button > svg, button > span > svg').length >= 4, '图标行的按钮全部是 SVG 图标');
  chk(row2.querySelectorAll(':scope > button .sr-only').length === 4,
    '「正文朗读 / 译文开关 / 标记已读 / 加入背诵」的文案只留给读屏软件（.sr-only）');
  chk(d.querySelectorAll('.reader-actions .mini-btn, .reader-actions .seg.mini').length === 7,
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
  // ⚠️ 左右那两个值在桌面那一档要写 auto（居中），所以断言只认上下两段：
  //    上方 26px；下方 118px + 安全区（避开播放栏与页签）。
  //    写成「整条等于 26px 0 calc(…)」的话，桌面那一档的居中就永远过不了。
  chk(!!navBlock && /margin:\s*26px (auto|0) calc\(118px \+ var\(--safe-bottom\)\)/.test(navBlock[2]),
    '阅读器底部导航预留 118px + 安全区，不被底栏压住');
  // 需求（Issue #205）：翻篇键不再是「一枚按钮」的样子 —— 去边框、去底色、左右内边距归零。
  // 用户原话：「把页底上一篇 下一篇两个按钮去除圆形边框，去除背景色，
  //           按钮内部左右padding 也去掉」。
  // ⚠️ 断言按**值**判，不按「有没有这条规则」判：
  //    写成 `border: 1px solid transparent` 也是「看不见」，但它仍占 1px 高度，
  //    这一排会比正文边缘高出一条缝 —— 所以只认 `border: none`。
  const navBtnBlock = /(\.reader-nav button \{)([\s\S]*?)\}/.exec(actionsCss);
  chk(!!navBtnBlock && /border:\s*none;/.test(navBtnBlock[2]),
    '翻篇键去掉边框（写 none，不留一条看不见的 1px 缝）');
  chk(!!navBtnBlock && /background:\s*transparent;/.test(navBtnBlock[2]),
    '翻篇键去掉底色（不写 transparent 时浏览器默认按钮底色会露出来）');
  chk(!!navBtnBlock && /padding:\s*11px 0;/.test(navBtnBlock[2]),
    '翻篇键左右内边距归零（贴齐正文两端）');
  chk(!!navBtnBlock && /border-radius:\s*0;/.test(navBtnBlock[2]),
    '翻篇键圆角归零（没有边框与底色，圆角已无意义）');

  // 需求（Issue #205）：分段组合「选中按钮与组合框共用一条边框」。
  // 用户原话：「组合按钮里面的按钮的边框和组合框上下有 4 个像素左右的间隔，
  //           我不太想要这个间隔，我希望选中的按钮和组合框共用边框。
  //           中间 A+ A- 按钮的 A+ 按钮左侧边框是圆形，也很奇怪，应该是直线。」
  // 病根是一条几何关系：组合框有 1px 描边 + 3px 内边距，选中态又是「白底 + 8px 圆角
  // 的小卡浮在框里」——小卡与框之间必然隔着那 3px，上下各一处就是那「4px 左右」。
  // 所以这里守三件事：① 框没有内边距；② 块与块之间不留缝；③ 只有贴合处才圆角。
  const miniSegBlock = /(^|\n)\.seg\.mini \{([\s\S]*?)\}/.exec(actionsCss);
  chk(!!miniSegBlock && /padding:\s*0;/.test(miniSegBlock[2]),
    '组合框内边距归零 —— 内层按钮铺满框，与框共用同一条 1px 边（不再垫出 4px 的缝）');
  chk(!!miniSegBlock && /gap:\s*0;/.test(miniSegBlock[2]),
    '组合框 gap 归零（块与块之间只留那一条 1px 界行）');
  // ⚠️ 下面这几条必须连**限定形状**一起判：只写 `.seg.mini button`（0-1-1）时，
  //    阅读器那条 `.reader-actions .seg.mini button`（0-2-1）会把圆角压回去——
  //    真机上就是这么退回原样的（框的 padding 归零了，块却还是各自 8px 圆角）。
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
  // 内边距这几处旧值必须**撤干净**，留一个就会把缝垫回来
  chk(!/\.reader-actions \.seg\.mini \{ padding: 2px; \}/.test(actionsCss) &&
    !/\.reader-actions \.seg\.mini \{ padding: 3px; \}/.test(actionsCss),
    '阅读器内那一组的旧内边距（2px / 3px）已撤掉，不再把缝垫回来');
  // 只扫真规则，不扫注释（上方说明里引用了那行旧写法，注释不该被判成「还在」）
  const cssNoComments = actionsCss.replace(/\/\*[\s\S]*?\*\//g, '');
  chk(!/\.reader-actions \.seg\.mini button \{[^}]*border-radius: 8px/.test(cssNoComments),
    '阅读器里那条 8px 圆角已删（它正是把「共用边框」压回去的那一条）');
  // 首页诗词详情页只引 style.css，同一套口径要在那儿也有一份
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
  // 窄屏那一档（36px）同样要宽高相等，否则小屏上又扁回去
  chk(/\.icon-row > \.mini-btn \{ width: 36px; min-height: 0; height: 36px; \}/.test(actionsCss),
    '窄屏档位的圆形图标键同为 36×36，宽高一致');

  // 需求 2：正文对齐两档，左 / 中 都是 SVG 图标，由用户自己选。
  // 文章一律横排，右对齐没有使用场景，按钮与规则都已删除（反向防线在下方）。
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
  // 重新打开阅读器（翻篇）后对齐设置还在
  d.querySelector('#rd-next').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#rd-text').dataset.align === 'left', '翻到下一篇后仍保持用户选的对齐方式');
  chk(alignBtn('left').classList.contains('active'), '翻篇后对齐按钮高亮同步');
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
  chk(d.querySelectorAll('#rd-meta .rd-count').length === 0,
    '取消已读后状态栏照旧没有读数（这一枚已撤，取消不再牵动任何数）');
  chk(!JSON.parse(window.localStorage.getItem('poem_classic_read_v1'))['gw-17'], '取消后从存储中移除');

  console.log(fails === 0 ? '\n🎉 小古文测试全部通过' : '\n❌ ' + fails + ' 项失败');
  process.exit(fails ? 1 : 0);
}, 400);
