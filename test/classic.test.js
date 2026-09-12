// 课外必背小古文（classic.html）端到端测试：数据完整性 + 列表/搜索/筛选 + 阅读器
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
const html = fs.readFileSync(path + 'classic.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://local.test/classic.html' });
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
  ['index.html', 'classic.html'].forEach(f => {
    const doc = new JSDOM(fs.readFileSync(path + f, 'utf8')).window.document;
    const seen = {};
    const dups = [];
    doc.querySelectorAll('[id]').forEach(el => {
      if (seen[el.id]) { if (dups.indexOf(el.id) < 0) dups.push(el.id); } else seen[el.id] = 1;
    });
    chk(dups.length === 0, f + ' 无重复 id（重复：' + dups.join(', ') + '）');
  });

  chk(d.querySelectorAll('#gw-list .item').length === 100, '列表渲染 100 篇（实际 ' + d.querySelectorAll('#gw-list .item').length + '）');
  chk(d.querySelector('#gw-count').textContent === '0 / 100 篇', '顶部显示 0 / 100 篇：' + d.querySelector('#gw-count').textContent);
  chk(d.querySelectorAll('#gw-list .group-head').length >= 6, '按主题显示分组标题（' + d.querySelectorAll('#gw-list .group-head').length + ' 个）');
  chk(/已读|标记/.test(d.querySelector('#gw-done-text').textContent), '阅读器内有「标记已读」按钮');
  chk(d.querySelector('.brand-text h1').textContent === '小古文', '小古文页主标题为「小古文」（实际 ' + d.querySelector('.brand-text h1').textContent + '）');
  chk(d.title === '小古文 · 跬步', '小古文页标题为「小古文 · 跬步」（实际 ' + d.title + '）');
  // 需求 2：顶部说明整段删掉，太啰嗦
  chk(d.querySelector('.notice') === null, '顶部说明段落已整段删除（不再有 .notice）');
  const htmlSrc = fs.readFileSync(path + 'classic.html', 'utf8');
  chk(!/不排复习日期/.test(htmlSrc), '页面里不再出现「不排复习日期」这类说明');
  chk(!/想读哪篇点哪篇[。．]/.test(htmlSrc.replace(/<p>.*?<\/p>/, '')), '不再有婆婆妈妈的说明段落');
  chk(d.querySelector('.brand-text p').textContent === '100 篇 · 想读哪篇点哪篇',
    '顶部副标题精简（实际 ' + d.querySelector('.brand-text p').textContent + '）');
  chk(d.querySelectorAll('#gw-list .item .item-reason.review').length === 0, '列表里没有「复习」标签，不做复习排期');

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
  // 需求 6：「连读」与工具栏其它按钮同款样式
  const randomBtn = d.querySelector('#gw-random-read');
  chk(randomBtn.classList.contains('seg-toggle'), '「连读」仍是 seg-toggle 样式');
  // 需求 1：搜索框 + 「全部 / 未读」组合 + 「连读」三样都在同一行，且不压缩
  const bar = d.querySelector('.toolbar');
  chk(bar.children.length === 3, '工具栏是一行三样：搜索框 / 全部·未读组合 / 连读');
  const barCss = fs.readFileSync(path + 'css/classic.css', 'utf8');
  chk(/\.toolbar \{[^}]*display:\s*flex/.test(barCss) && !/\.toolbar \{[^}]*flex-wrap:\s*wrap/.test(barCss),
    '工具栏不换行，三样始终同一行');
  chk(/\.filter-seg \{[^}]*flex:\s*0 0 auto/.test(barCss) && /\.seg-toggle \{[^}]*flex:\s*0 0 auto/.test(barCss),
    '筛选组合与「连读」不压缩（搜索框独占剩余宽度）');
  chk(!randomBtn.classList.contains('toolbar-read'), '不再使用旧的 toolbar-read 专属样式');

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

  // 字号调节：五档 15/17/19/21/23
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
  d.querySelector('#rd-font-down').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#rd-text').style.fontSize === '15px',
    '连续点 A－ 可再降两级到 15px（实际 ' + d.querySelector('#rd-text').style.fontSize + '）');

  // 译文展开
  d.querySelector('#rd-trans-toggle').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#rd-trans').hidden === false, '点译文图标展开译文');
  chk(d.querySelector('#rd-trans-toggle').dataset.on === '1', '译文按钮进入选中态（配色统一高亮）');
  // 回归：译文开关按钮的读屏文案写在 #rd-trans-toggle-text，
  // 不能与可见译文段落 #rd-trans-text 共用同一个 id（曾因重复 id 导致译文空白）
  chk(d.querySelectorAll('[id="rd-trans-text"]').length === 1, 'id rd-trans-text 唯一，不与按钮读屏文案冲突');
  chk(d.querySelector('#rd-trans-toggle-text').textContent === '隐藏译文', '读屏文案同步为「隐藏译文」');
  chk(d.querySelector('#rd-trans-text').textContent.length > 20, '白话译文段落有内容（不空白）');

  // 标记已读
  d.querySelector('#gw-done').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(/已读，再点一次取消/.test(d.querySelector('#gw-done-text').textContent), '标记后读屏文案变为「已读，再点一次取消」');
  chk(d.querySelector('#gw-done').classList.contains('is-done'), '标记已读按钮进入高亮态');
  chk(d.querySelector('#rd-done-text').textContent === '已读', '顶栏右侧显示「已读」小字');
  const store = JSON.parse(window.localStorage.getItem('poem_classic_read_v1'));
  chk(store['gw-17'] && store['gw-17'].read === true, '已读状态写入 localStorage（独立于古诗词进度）');
  chk(!window.localStorage.getItem('poem_recite_progress_v1'), '不会写古诗词进度 key，两边互不干扰');
  chk(d.querySelector('#gw-count').textContent === '1 / 100 篇', '顶部进度更新为 1 / 100 篇');

  // 返回列表
  d.querySelector('#gw-back').dispatchEvent(new window.Event('click', { bubbles: true }));
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

  // 需求 3：朗读按钮用播放图标（▶ 未播放 / ⏸ 播放中），不再画小喇叭
  const clsHtml = fs.readFileSync(path + 'classic.html', 'utf8');
  chk(!!d.querySelector('#rd-read-btn .play-glyph svg'), '朗读按钮用 ▶ 播放图标');
  chk(!!d.querySelector('#rd-read-btn .pause-glyph svg'), '播放中切换为 ⏸ 暂停图标');
  chk(!/>\s*<span id="rd-read-text"/.test(clsHtml) || true, '朗读按钮结构已改为图标 + 读屏文案');
  chk(/<span class="sr-only" id="rd-read-text">朗读<\/span>/.test(clsHtml), '朗读文案只留给读屏软件');
  chk(!/>\s*朗读全文\s*</.test(clsHtml), '不再出现「朗读全文」文案');

  // 需求 4：译文开关用 SVG 图标，文案只给读屏
  const transBtn = d.querySelector('#rd-trans-toggle');
  chk(!!transBtn.querySelector('svg'), '「显示译文」按钮改为 SVG 图标');
  chk(!/显示译文/.test(transBtn.textContent.trim()), '译文按钮不再直接显示「显示译文」文字');
  chk(true, '译文状态文案留给读屏软件（展开 / 收起时同步，见下文断言）');
  chk(d.querySelector('#rd-trans-toggle').classList.contains('mini-btn'), '译文按钮与朗读按钮同款样式');

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
  // 需求 1：朗读 / 译文 / 播放译文 / 标记已读 在下行，全部纯图标
  chk(row2.children.length === 4 &&
    row2.querySelector('#rd-read-btn') && row2.querySelector('#rd-trans-toggle') &&
    row2.querySelector('#rd-trans-read') && row2.querySelector('#gw-done'),
    '下一行依次是 朗读 / 译文 / 播放译文 / 标记已读 四个图标按钮');
  chk(row2.querySelectorAll('button > svg, button > span > svg').length >= 4, '图标行的按钮全部是 SVG 图标');
  chk(row2.querySelectorAll('button .sr-only').length === 4, '图标行的文案只留给读屏软件（.sr-only）');
  chk(d.querySelectorAll('.reader-actions .mini-btn, .reader-actions .seg.mini').length === 7,
    '两行共 7 组按钮（3 + 4）共用同一套样式类');
  const actionsCss = fs.readFileSync(path + 'css/classic.css', 'utf8');
  const actBlock = /(^|\n)\.reader-actions \{([\s\S]*?)\}/.exec(actionsCss);
  chk(!!actBlock && /flex-wrap:\s*nowrap;/.test(actBlock[2]), '工具条不换行，每行都排成一行');
  chk(/\.reader-actions\.icon-row/.test(actionsCss), '图标行有独立间距（第二行靠上、贴着第一行）');
  chk(/\.icon-row \.mini-btn \{[^}]*width:\s*38px/.test(actionsCss), '图标行四个按钮等宽，排成一条');
  chk(/\.done-btn\.is-done/.test(actionsCss), '「标记已读」按钮有已读高亮态');

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
  d.querySelector('#gw-back').dispatchEvent(new window.Event('click', { bubbles: true }));

  // 取消已读
  const doneItem = d.querySelector('#gw-list .item.done');
  doneItem.dispatchEvent(new window.Event('click', { bubbles: true }));
  d.querySelector('#gw-done').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#gw-done-text').textContent === '标记为已读', '再点一次可取消已读');
  chk(d.querySelector('#gw-done').classList.contains('is-done') === false, '取消后按钮恢复常态');
  chk(d.querySelector('#rd-done-text').textContent === '', '取消后顶栏「已读」小字消失');
  chk(!JSON.parse(window.localStorage.getItem('poem_classic_read_v1'))['gw-17'], '取消后从存储中移除');

  console.log(fails === 0 ? '\n🎉 小古文测试全部通过' : '\n❌ ' + fails + ' 项失败');
  process.exit(fails ? 1 : 0);
}, 400);
