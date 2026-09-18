const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = __dirname + '/../';

const html = fs.readFileSync(path + 'index.html', 'utf8');

const SETTINGS_PAGE = {
  'mine/index.html': '/mine/',
  'settings/index.html': '/settings/',
  'settings/general/index.html': '/settings/general/',
  'settings/recite/index.html': '/settings/recite/',
  'settings/lists/index.html': '/settings/lists/',
  'settings/reader/index.html': '/settings/reader/'
};

function bootSettingsPage(seed, file) {
  const f = file || 'settings/index.html';
  const url = 'https://local.test' + SETTINGS_PAGE[f];
  const src = fs.readFileSync(path + f, 'utf8');
  const sdom = new JSDOM(src, { runScripts: 'dangerously', url: url, base: url });
  const sw = sdom.window;
  if (seed) for (const k in seed) sw.localStorage.setItem(k, seed[k]);
  src.match(/<script src="([^"]+)"><\/script>/g)
    .map(x => x.match(/src="([^"]+)"/)[1])
    .forEach(rel => {
      const el = sw.document.createElement('script');
      el.textContent = fs.readFileSync(path + rel.replace(/^\//, ''), 'utf8');
      sw.document.body.appendChild(el);
    });

  sw.document.dispatchEvent(new sw.Event('DOMContentLoaded', { bubbles: true }));
  return { window: sw, doc: sw.document };
}

const dom = new JSDOM(html, { runScripts: 'dangerously', resources: undefined, url: 'https://local.test/' });

const scriptOrder = html.match(/<script src="([^"]+)"><\/script>/g).map(s => s.match(/src="([^"]+)"/)[1]);
const { window } = dom;
scriptOrder.forEach(f => {
  const code = fs.readFileSync(path + f, 'utf8');
  const el = window.document.createElement('script');
  el.textContent = code;
  window.document.body.appendChild(el);
});

setTimeout(() => {
  const d = window.document;
  let fails = 0;
  const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

  chk(d.title === '跬步 · Ashley的背诵 · 跬步',
    '用户名留空时标题用默认名 Ashley（实际 ' + d.title + '）');
  chk(d.querySelector('.brand-text h1').textContent === '跬步', '品牌标题为「跬步」');

  const sub = d.querySelector('#brand-sub');
  chk(!!sub && /遗忘曲线/.test(sub.textContent),
    '主标题下的描述文字已还原（实际「' + (sub ? sub.textContent : '') + '」）');
  chk(!/年级|至高三|小学|初中|高中/.test(sub.textContent),
    '描述文字里不带一年级到高中这类年级字样');

  const brandPage = d.querySelector('#brand-page');
  chk(!!brandPage && /Ashley的背诵/.test(brandPage.textContent),
    '页面名排在「跬步」右侧：' + (brandPage ? brandPage.textContent : '缺失'));
  chk(brandPage.querySelector('.brand-page-text').classList.contains('is-default'),
    '默认名 Ashley 走淡墨，与用户自己填的名字区分');
  const brandRowCss = fs.readFileSync(path + 'css/style.css', 'utf8');
  chk(/\.brand-name-row \{[\s\S]{0,200}?font-family:\s*var\(--font-poem\)/.test(brandRowCss) ||
      /--font-poem[\s\S]{0,120}?brand-name-row/.test(brandRowCss) ||
      /\.brand-name-row[\s\S]{0,80}?font-size: 19px/.test(brandRowCss),
    '页面名与「跬步」共用同一套字体样式（.brand-name-row）');
  chk(!/积跬步古诗词/.test(d.documentElement.outerHTML), '页面不出现「积跬步古诗词」旧名');

  chk(d.querySelectorAll('.topbar .top-user').length === 0,
    '顶栏上一枚头像都没有（含首页：右端是空的）');
  chk(d.querySelectorAll('.topbar .avatar-top').length === 0,
    '顶栏也不再画 .avatar-top 那一档头像');
  chk(/\.top-user\s*\{/.test(fs.readFileSync(path + 'css/style.css', 'utf8')) === false,
    '样式表里不再留 .top-user 规则（顶栏没有头像了，留着是僵尸）');
  chk(d.querySelectorAll('.topbar #top-back').length === 0,
    '首页没有返回键（本来就无处可退），顶栏右端因此是空的');
  chk(d.querySelectorAll('.topbar #top-act').length === 0 && d.querySelectorAll('.topbar #top-user').length === 0,
    '首页顶栏不出现任何顶栏 id（#top-act / #top-back / #top-user 都没有）');

  const spAvatar = bootSettingsPage(null);
  const spBar = spAvatar.doc.querySelector('.topbar');
  chk([...spBar.querySelectorAll('#top-back, #top-user, #top-act-link, #top-act')].map(e => e.id).join('/') === 'top-back',
    '深页顶栏右端只有「返回键」这一颗（实际 ' +
    [...spBar.querySelectorAll('#top-back, #top-user, #top-act-link, #top-act')].map(e => e.id).join('/') + '）');
  chk(spBar.querySelectorAll('.top-user').length === 0, '深页顶栏也没有头像（同一套 chrome，一处改全站改）');

  chk(spBar.querySelector('#top-back').getAttribute('href') === '/mine/',
    '「设置」整页的返回键回「我的」页（层级：我的 → 设置）');

  const spMine = bootSettingsPage(null, 'mine/index.html');
  const mineBar = spMine.doc.querySelector('.topbar');
  const gear = mineBar.querySelector('#top-act-link');
  chk(!!gear && gear.getAttribute('href') === '/settings/',
    '「我的」页顶栏右端是齿轮，点了去设置整页（实际 ' +
    (gear ? gear.getAttribute('href') : '缺失') + '）');
  chk(!!gear && !!gear.querySelector('svg'),
    '齿轮是一枚内联 SVG（不是字符 / emoji）');
  chk(!mineBar.querySelector('#top-back'),
    '「我的」页顶栏没有返回键（它是页签落点，顶上没有上一层）');

  const spSeal = bootSettingsPage({
    poem_profile_v1: JSON.stringify({ v: 1, nickname: '玥玥', avatar: { img: '' } })
  }, 'mine/index.html');
  const sealSlot = spSeal.doc.querySelector('#avatar-slot .avatar');
  chk(!!sealSlot && sealSlot.textContent === '玥', '「我的」页那枚头像与档案同源（昵称首字是「玥」就画「玥」，实际 ' +
    (sealSlot ? sealSlot.textContent : '缺失') + '）');

  chk(d.querySelector('.app > .foot') === null, '首页不再挂页脚（法务链接已挪到设置页底部）');
  const spEarly = bootSettingsPage(null);
  const foot = spEarly.doc.querySelector('.settings-foot');
  chk(!!foot, '设置页底部有页脚');
  chk(foot.querySelector('.foot-copy').textContent.trim() === '©2026 kuibu.app 积跬步, 至千里', '页脚版权为 ©2026 kuibu.app 积跬步, 至千里（实际 ' + foot.querySelector('.foot-copy').textContent.trim() + '）');

  const footLinks = [...foot.querySelectorAll('.foot-links a')];
  chk(footLinks.map(a => a.textContent.trim()).join('/') === '用户协议/隐私条款', '页脚含「用户协议」「隐私条款」链接');
  chk(footLinks.map(a => a.getAttribute('href')).join(' ') === '/terms/ /privacy/',
    '页脚两个链接指向目录化的 /terms/ 与 /privacy/（实际 ' + footLinks.map(a => a.getAttribute('href')).join(' ') + '）');
  chk(!!(spEarly.doc.querySelector('.settings-page').compareDocumentPosition(foot) & window.Node.DOCUMENT_POSITION_FOLLOWING),
    '页脚排在设置项下方（页面最底部）');

  chk(!/一年级至高三/.test(d.querySelector('.topbar').textContent),
    '顶栏第一行不再出现「一年级至高三 · 」，只有「跬步 · XX的背诵」');

  chk(d.querySelector('#brand-sub').textContent === '按遗忘曲线复习',
    '顶栏第二行精简为「按遗忘曲线复习」（实际「' + d.querySelector('#brand-sub').textContent + '」）');
  chk(!/小古文想读哪篇点哪篇/.test(d.querySelector('.topbar').textContent),
    '顶栏不再出现「小古文想读哪篇点哪篇」');
  chk(d.querySelectorAll('.brand-icon svg, .brand-icon img').length === 1, '顶栏徽标只画一枚（内联 SVG 或位图，实际 ' + d.querySelectorAll('.brand-icon svg, .brand-icon img').length + ' 枚）');

  const collapseHeads = d.querySelectorAll('.collapse-head');
  chk(collapseHeads.length === 1,
    '首页有且只有一张折叠卡（全部诗词，实际 ' + collapseHeads.length + ' 张）');
  chk(!!d.querySelector('#btn-all') && !!d.querySelector('#all-label') &&
    !!d.querySelector('#all-count') && !!d.querySelector('#all-body') &&
    !!d.querySelector('#stats-row') && !!d.querySelector('#all-list'),
    '「全部诗词」整张卡都在：折叠头 + 徽章 + 统计行 + 篇目列表');
  chk(d.querySelector('#all-label').textContent.length > 0 &&
    +d.querySelector('#all-count').textContent > 0,
    '那张卡的标题与篇目数都画出来了（' + d.querySelector('#all-label').textContent +
    ' · ' + d.querySelector('#all-count').textContent + ' 首）');
  chk(d.querySelector('#collections-section') === null && d.querySelector('#btn-collections') === null,
    '首页不再有「自选背诵」折叠卡（已搬去设置整页）');

  chk(d.querySelector('#today-card') === null,
    '今日 5 条不再被一张卡片包住（#today-card 那层壳已撤）');
  const todayList = d.querySelector('#today-list');
  chk(!!todayList && todayList.tagName === 'DIV' && todayList.classList.contains('list'),
    '今日列表的容器就是 #today-list 自己的 .list（父元素是 .app）');
  chk(!!todayList && todayList.parentElement.classList.contains('app'),
    '今日列表直接挂在 .app 下（中间不再夹一层卡）');
  chk(d.querySelectorAll('#today-list > .item').length === 5 &&
    [...d.querySelectorAll('#today-list > .item')].every(el => el.classList.contains('item')),
    '直接列出的就是 5 张独立卡片（.item），不是一组裹在一张卡里');

  chk(d.querySelector('.topbar #btn-settings') === null, '首页右上角不再有设置齿轮（交给底部页签）');
  chk(d.querySelector('.topbar .icon-btn') === null, '顶栏不再有圆形图标按钮（设置入口已删）');

  chk(!!d.querySelector('.topbar .brand-icon svg, .topbar .brand-icon img'), '顶栏有 logo（内联 SVG 或位图徽标）');
  chk(d.querySelector('#brand-name').textContent === '跬步', '顶栏第一行固定为「跬步」，不随页面变化');
  const dock = d.querySelector('#site-dock');
  chk(!!dock, '首页有底部导航栏');
  const dockItems = [...dock.querySelectorAll('.dock-item')];
  chk(dockItems.length === 4, '底部导航为四个页签（实际 ' + dockItems.length + '）');

  chk(dockItems.map(b => b.querySelector('.dock-label').textContent).join('/') === '背诵/课外/搜索/我的',
    '页签名称为 背诵 / 课外 / 搜索 / 我的');
  chk(dockItems.map(b => b.dataset.navGo).join('/') === 'home/library/search/mine', '页签跳转目标正确');
  chk(dockItems[0].classList.contains('active') && dockItems[0].getAttribute('aria-current') === 'page',
    '当前页（背诵）页签为选中态');
  chk(dockItems.every(b => b.querySelector('.dock-icon svg')), '四个页签图标均为内联 SVG');

  chk(!/\.dock-item::before/.test(fs.readFileSync(path + 'css/style.css', 'utf8')),
    '页签选中态的「下划线」已移除（.dock-item::before 不再存在）');
  chk(dockItems.every(b => b.querySelectorAll(':scope > *').length === 2),
    '每个页签只有图标 + 文字两个子元素，没有额外的划线装饰');

  const settingsItem = dock.querySelector('.dock-item[data-nav-go="mine"]');
  chk(settingsItem.tagName === 'A', '「我的」页签是 <a>（因此必须显式去掉链接默认下划线）');

  const mineIcon = settingsItem.querySelector('.dock-icon svg');
  chk(!!mineIcon, '「我的」页签有图标');
  chk(!mineIcon.querySelector('path'), '它不再是齿轮（没有那条齿形 path）');
  const mineCircle = mineIcon.querySelector('circle');
  chk(!!mineCircle && mineCircle.getAttribute('cx') === '12' &&
    mineCircle.getAttribute('cy') === '12' && mineCircle.getAttribute('r') === '10',
    '它是一枚居中的整圆（圆心 12,12 · r10 = 圆形头像）');
  const mineChar = mineIcon.querySelector('text');
  chk(!!mineChar && mineChar.textContent.trim() === '诗',
    '圆里是那个人自己的首字；没起名时回落默认字「诗」（与全站头像同源，实际「' +
    (mineChar ? mineChar.textContent : '缺失') + '」）');
  chk(!/__CHAR__/.test(settingsItem.innerHTML),
    '占位符 __CHAR__ 已被真的首字替换（不留模板残渣）');

  chk(d.querySelector('.topbar .back-icon') === null, '顶栏不再有各页自造的返回箭头');
  chk(!!dock.querySelector('[data-nav-go="mine"]'), '「我的」是页签之一，设置整页藏在它右上角那颗齿轮后面');
  chk(!/📖|⚙|📚/.test(d.querySelector('.app').innerHTML), '页面不再使用 📖 ⚙️ 📚 emoji 图标');

  const allArrow = d.querySelector('#btn-all .arrow svg');
  chk(!!allArrow && allArrow.getAttribute('stroke-width') === '1.8' &&
    /viewBox="0 0 24 24"/.test(allArrow.outerHTML),
    '折叠箭头是空心描边三角（不是实心 ▾ / ▴ 字符）');
  chk(!/▾|▴/.test(d.querySelector('.app').textContent), '首页不再用实心 ▾ / ▴ 字符');
  chk(!d.querySelector('.selector.card'), '年级/学期选择不再常驻首页');

  chk(d.querySelector('#settings-modal') === null, '首页不再有「向上弹出的设置卡片」');
  const spGeneral = bootSettingsPage(null, 'settings/general/index.html');
  const sgeneral = spGeneral.doc;
  const spRecite = bootSettingsPage(null, 'settings/recite/index.html');
  const srecite = spRecite.doc;
  const spLists = bootSettingsPage(null, 'settings/lists/index.html');
  const slists = spLists.doc;
  const spReader = bootSettingsPage(null, 'settings/reader/index.html');
  const sreader = spReader.doc;
  const spIndex = bootSettingsPage(null);
  const sindex = spIndex.doc;

  chk(sindex.querySelectorAll('#settings-index a.settings-link').length === 4,
    '设置主页有四个二级页入口（实际 ' + sindex.querySelectorAll('#settings-index a.settings-link').length + '）');
  chk([...sindex.querySelectorAll('#settings-index a.settings-link')].map(a => a.getAttribute('href')).join(' ') ===
    '/settings/general/ /settings/recite/ /settings/lists/ /settings/reader/',
    '四个入口指向目录化的二级页地址（不带 .html）');
  chk(!sindex.querySelector('#input-username') && !sindex.querySelector('#seg-stage') &&
    !sindex.querySelector('#collections-list') && !sindex.querySelector('#seg-play'),
    '主页不再堆控件（用户名 / 学段 / 清单 / 连读都搬去各二级页）');
  chk(!/<script src="[^"]*js\/settings\.js"><\/script>/.test(fs.readFileSync(path + 'settings/index.html', 'utf8')),
    '主页不加载 js/settings.js（它只管进哪一页）');
  chk(/<script src="\/js\/settings-nav\.js"><\/script>/.test(fs.readFileSync(path + 'settings/index.html', 'utf8')),
    '主页加载 js/settings-nav.js（四个入口的唯一来源）');
  chk(!!sindex.querySelector('.settings-foot'), '设置主页底部仍有页脚');

  chk(!sgeneral.querySelector('#input-username'),
    '「通用」页不再有用户名输入框（与「我的」页重复了，用户 2026-09-18 点名删）');
  chk(!sgeneral.querySelector('#family-panel'),
    '「通用」页不再有子用户那一块（整块挪去「我的」页）');
  chk(!!sgeneral.querySelector('#account-panel'), '「通用」页含账号一项');
  chk(!!srecite.querySelector('#seg-stage'), '学段选择在「背诵」页');
  chk(!!srecite.querySelector('#seg-term'), '学期选择在「背诵」页');
  chk(!!srecite.querySelector('#grade-chips'), '年级选择在「背诵」页');
  chk(srecite.querySelectorAll('#grade-chips button').length === 6, '「背诵」页默认小学显示 6 个年级按钮');

  const activeOne = (doc, sel) => {
    const btns = [...doc.querySelectorAll(sel + ' button')];
    return btns.length > 0 && btns.filter(b => b.classList.contains('active')).length === 1;
  };
  const comboPages = [
    ['背诵', srecite, ['#seg-stage', '#seg-term', '#seg-scope', '#seg-count', '#grade-chips']],
    ['朗读', sreader, ['#seg-helper']]
  ];
  chk(comboPages.every(([, doc, sels]) => sels.every(sel => activeOne(doc, sel))),
    '每个组合都恰好一个选中项（学段/学期/范围/数量/年级 · 注音）');

  chk(comboPages.every(([, doc, sels]) => sels.every(sel => doc.querySelector(sel + ' button.active'))),
    '六个组合的选中态都用同一个 .active 类名，样式可被整段统一');

  const groupsOf = doc => [...doc.querySelectorAll('#settings-page .settings-group')];
  const groupTitlesOf = doc => groupsOf(doc).map(g => (g.querySelector('.settings-group-title') || {}).textContent);

  chk(groupsOf(sgeneral).length === 1 && groupTitlesOf(sgeneral).join('/') === '',
    '「通用」页只有一组，且正文不再重复写组名（实际标题「' + groupTitlesOf(sgeneral).join('/') + '」）');
  chk(groupsOf(srecite).length === 2 && groupTitlesOf(srecite).join('/') === '背诵/复习算法',
    '「背诵」页是两组：背诵 + 复习算法（实际 ' + groupTitlesOf(srecite).join('/') + '）');

  chk(groupsOf(sgeneral).length === 1 && groupTitlesOf(sgeneral).join('/') === '',
    '「通用」页只有一组，且正文不再重复写组名（实际标题「' + groupTitlesOf(sgeneral).join('/') + '」）');
  chk(groupsOf(slists).length === 2 && groupTitlesOf(slists).join('/') === '/打印',
    '「我的清单」页两组，正文只留「打印」那一颗组标题（实际 ' + groupTitlesOf(slists).join('/') + '）');
  chk(groupsOf(sreader).length === 1 && groupTitlesOf(sreader).join('/') === '',
    '「朗读」页只有一组（Issue #163：原「阅读辅助 + 朗读播放」并成「朗读」），正文不重复写组名');
  chk(groupsOf(srecite).length === 2 && groupTitlesOf(srecite).join('/') === '背诵/复习算法',
    '「背诵」页是两组：背诵 + 复习算法（实际 ' + groupTitlesOf(srecite).join('/') + '）');

  const allGroupCount = [sgeneral, srecite, slists, sreader]
    .reduce((n, doc) => n + groupsOf(doc).length, 0);
  chk(allGroupCount === 6, '四张二级页合起来是六组（实际 ' + allGroupCount + '）');

  ['通用', '背诵', '我的清单', '朗读'].forEach((n, i) => {
    const doc = [sgeneral, srecite, slists, sreader][i];
    chk(doc.body.getAttribute('data-page') === n, '「' + n + '」写在顶栏页名上（data-page）');
  });

  chk([sgeneral, srecite, slists, sreader].every(doc =>
    [...doc.querySelectorAll('.settings-group')].every(g => !g.querySelector('.settings-group-desc'))),
    '每个分组都不再有二级描述文字');

  const grpOf = (doc, sel) => {
    const el = doc.querySelector(sel);
    const own = el && el.closest('.settings-group');
    if (!own) return null;
    const title = own.querySelector('.settings-group-title');
    return title ? title.textContent : doc.body.getAttribute('data-page');
  };
  chk(grpOf(sgeneral, '#btn-export') === '通用' && grpOf(sgeneral, '#btn-reset') === '通用',
    '数据管理归到「通用」');
  chk(grpOf(srecite, '#seg-stage') === '背诵' && grpOf(srecite, '#grade-chips') === '背诵' &&
      grpOf(srecite, '#seg-term') === '背诵', '学段 / 年级 / 学期归到「背诵」');
  chk(grpOf(srecite, '#seg-scope') === '背诵' && grpOf(srecite, '#seg-count') === '背诵',
    '背诵范围 / 每日数量归到「背诵」');

  chk(!!slists.querySelector('#collections-list') && !!slists.querySelector('#collections-tip'),
    '「我的清单」页有自选背诵清单（#collections-list / #collections-tip）');
  chk(grpOf(slists, '#collections-list') === '我的清单' && grpOf(slists, '#btn-collections-import') === '我的清单',
    '自选背诵（清单 + 导入键）归到「我的清单」');

  chk(!!slists.querySelector('#text-dialog') && !!slists.querySelector('#text-dialog-text'),
    '「我的清单」页有导入 / 导出用的纯文本对话框');
  chk(grpOf(sreader, '#seg-helper') === '朗读', '注音总开关归到「朗读」组');
  chk(grpOf(sreader, '#seg-play') === '朗读', '连读档位归到「朗读」组');
  chk(grpOf(srecite, '#seg-algo') === '复习算法', '复习算法选择归到「复习算法」组');

  const generalItems = sgeneral.querySelector('#settings-page .settings-group').querySelectorAll('.settings-item');
  chk(generalItems.length === 4,
    '「通用」组只剩账号 / 跨设备同步 / 数据管理 / 课内诗词导出四项' +
    '（用户名与子用户整块撤掉 —— 它们都是「我是谁」，归「我的」页；实际 ' + generalItems.length + '）');
  chk(!!sgeneral.querySelector('#btn-export-poems'),
    '「通用」里有课内诗词导出（Issue #159：只导课本那 261 首）');
  chk(grpOf(sgeneral, '#btn-export-poems') === '通用',
    '课内诗词导出归到「通用」（与数据管理同一组：都是「把你的东西拿走」）');
  chk(!!sgeneral.querySelector('#toggle-sync'),
    '「通用」里有跨设备同步开关（用户有权拒绝上传，默认关着 —— docs §4.2 第 2 条）');

  chk(!sgeneral.querySelector('#seal-chars') && !sgeneral.querySelector('#seal-inks'),
    '那四个色点与字集选择器都不在了（用户点名删掉的自造流程）');
  chk(!sgeneral.querySelector('#btn-avatar-pick') && !sgeneral.querySelector('#avatar-file'),
    '头像上传已从「通用」搬走（那一组不再混入「我是谁」的控件）');

  const smine = bootSettingsPage(null, 'mine/index.html').doc;
  chk(!!smine.querySelector('#btn-avatar-pick') && !!smine.querySelector('#avatar-file'),
    '「我的」页有头像上传的入口与文件选择框');
  chk(!!smine.querySelector('#input-nickname'), '「我的」页有昵称输入框');
  chk(!!smine.querySelector('#stats-list'), '「我的」页有本机数据那几行');
  chk(!!smine.querySelector('#danger-card'), '「我的」页有注销那一张危险区卡');

  const OWNER_OF = {
    '#account-panel': [sgeneral],
    '#btn-export': [sgeneral], '#btn-import': [sgeneral], '#btn-reset': [sgeneral],
    '#seg-stage': [srecite], '#grade-chips': [srecite], '#seg-term': [srecite],
    '#seg-scope': [srecite], '#seg-count': [srecite], '#seg-algo': [srecite],
    '#collections-list': [slists], '#btn-collections-import': [slists],
    '#seg-helper': [sreader], '#seg-play': [sreader]
  };
  Object.keys(OWNER_OF).forEach(sel => {
    const docs = [sgeneral, srecite, slists, sreader];
    const owners = OWNER_OF[sel];
    const found = docs.filter(doc => doc.querySelector(sel));
    chk(found.length === owners.length && owners.every(o => found.indexOf(o) !== -1),
      '设置项 ' + sel + ' 只在它该在的那一页（实际 ' + found.length + ' 页）');
  });

  [sindex, sgeneral, srecite, slists, sreader].forEach(doc => {
    chk(!!doc.querySelector('#settings-page'), '每一张设置页都有独立的整页容器');
    chk(!!doc.querySelector('.settings-foot'), '每一张设置页都有页脚（版权 + 法务链接）');
  });

  chk(!!srecite.querySelector('#scope-hint') &&
      srecite.querySelector('#scope-hint').textContent === '当前：本学期及之前',
    '背诵范围下回显当前范围（实际「' + (srecite.querySelector('#scope-hint') || {}).textContent + '」）');

  chk(sgeneral.querySelector('#account-state').textContent === '游客',
    '「账号」一项未登录时写「游客」（实际「' + sgeneral.querySelector('#account-state').textContent + '」）');
  chk(/用邮箱登录/.test(sgeneral.querySelector('#account-panel').textContent),
    '「账号」一项仍有进 /login/ 的入口（删的是那段解释，不是入口）');

  chk(d.querySelector('#classic-entry') === null, '首页不再有小古文入口卡片');
  chk(d.querySelector('.classic-entry') === null, '首页不再有小古文入口卡片（classic-entry 已删）');
  chk(d.querySelector('#classic-title') === null && d.querySelector('.classic-title') === null,
    '不再渲染小古文入口标题');
  chk(![sindex, sgeneral, srecite, slists, sreader].some(doc => doc.querySelector('#seg-classic-entry')),
    '设置里不再有「首页小古文入口」选项（入口已删）');
  chk(![sindex, sgeneral, srecite, slists, sreader].some(doc => /首页小古文入口/.test(doc.body.textContent)),
    '设置页文案里不再出现「首页小古文入口」');

  chk(d.querySelectorAll('#today-list .item').length === 5, '小古文不会混进古诗词列表（仍为 5 首）');

  const dockLibraryCount = [...dock.querySelectorAll('.dock-item')].filter(b => b.dataset.navGo === 'library').length;
  chk(dockLibraryCount === 1, '四部集子的入口只剩底部页签「课外」一处');
  chk(d.querySelector('.dock-item[data-nav-go="library"]').getAttribute('data-href') === '/library/',
    '「课外」页签指向 /library/ 入口页');

  const dockSettings = d.querySelector('.dock-item[data-nav-go="mine"]');
  chk(dockSettings.tagName === 'A' && dockSettings.getAttribute('href') === '/mine/',
    '底部页签「我的」指向 /mine/（实际 ' + dockSettings.tagName + ' ' + dockSettings.getAttribute('href') + '）');
  chk(d.querySelectorAll('#today-list .item').length === 5, '今日列表渲染 5 首（实际 ' + d.querySelectorAll('#today-list .item').length + '）');
  chk(d.querySelector('#ring-text').textContent === '0/5', '环形进度 0/5');

  chk(d.querySelector('.today-title').textContent === '今日背诵',
    '任务条标题为「今日背诵」（实际 ' + d.querySelector('.today-title').textContent + '）');

  chk(d.querySelector('#today-read .play-glyph') !== null, '今日朗读按钮是 ▶ 圆形播放键');
  chk(!/朗读/.test(d.querySelector('#today-read').textContent.replace(/\s/g, '')),
    '今日朗读按钮不再显示「朗读」文字');

  const pbCss = fs.readFileSync(path + 'css/style.css', 'utf8');
  const pb = /(\.player-bar \{[\s\S]*?\n\})/.exec(pbCss);
  chk(!!pb && /left:\s*0;/.test(pb[1]) && /right:\s*0;/.test(pb[1]) && /bottom:\s*0;/.test(pb[1]),
    '播放栏贴底占满整宽');
  chk(!!pb && !/border-radius/.test(pb[1]), '播放栏不再有圆角');
  chk(/\.player-bar \{[\s\S]*?padding: 14px/.test(pbCss), '播放栏高度加大');

  chk(d.querySelectorAll('#today-list .item-read .play-glyph').length === 5,
    '今日每首右侧都是 ▶ 播放键');

  chk(srecite.querySelector('#scope-hint').textContent === '当前：本学期及之前',
    '出厂范围回显正确（实际 ' + srecite.querySelector('#scope-hint').textContent + '）');

  const setOn = (key, val, sel, attr) => {
    const b = [...srecite.querySelectorAll(sel)].find(x => String(x.dataset[attr]) === String(val));
    b.dispatchEvent(new spRecite.window.Event('click', { bubbles: true }));
    window.localStorage.setItem('poem_recite_settings_v1', spRecite.window.localStorage.getItem('poem_recite_settings_v1'));
    window.PoemApp.reloadSettings();
  };

  setOn('grade', 2, '#grade-chips button', 'grade');
  chk(String(srecite.querySelector('#grade-chips button.active').dataset.grade) === '2', '设置页年级高亮切到二年级（实际 ' + (srecite.querySelector('#grade-chips button.active') ? srecite.querySelector('#grade-chips button.active').textContent : '无') + '）');
  chk(srecite.querySelector('#scope-hint').textContent === '当前：本学期及之前',
    '切到二年级上学期：范围回显仍是「本学期及之前」');
  chk(d.querySelectorAll('#today-list .item').length === 5, '切换后仍是 5 首计划');

  setOn('term', 2, '#seg-term button', 'term');
  chk(srecite.querySelector('#chip-grade')
      ? srecite.querySelector('#scope-hint').textContent === '当前：本学期及之前'
      : true, '二年级下学期：范围回显一致');

  setOn('stage', 'high', '#seg-stage button', 'stage');
  chk(srecite.querySelectorAll('#grade-chips button').length === 3, '设置页切高中后显示 3 个年级');
  chk(['10', '11', '12'].indexOf(String(srecite.querySelector('#grade-chips button.active').dataset.grade)) > -1,
    '换学段后年级落在新学段内');
  setOn('grade', 12, '#grade-chips button', 'grade');
  chk(srecite.querySelector('#scope-hint').textContent === '当前：本学期及之前',
    '高三下学期：范围回显仍是「本学期及之前」');

  {

    setOn('stage', 'primary', '#seg-stage button', 'stage');
    setOn('grade', 2, '#grade-chips button', 'grade');

    d.querySelector('#today-list .item').dispatchEvent(new window.Event('click', { bubbles: true }));
    chk(d.querySelectorAll('#m-actions-main > *').length === 3, '详情页第一行：对齐 / 字号 / 注音 三组');
    chk(d.querySelectorAll('#m-actions-icons > *').length === 2, '详情页第二行：播放组合键 + 译文开关');
    chk(!/暂未收录/.test(d.querySelector('#m-trans-text').textContent),
      '带译文的诗篇显示白话译文：' + d.querySelector('#m-trans-text').textContent.slice(0, 12) + '…');
    d.querySelector('#m-trans-toggle').dispatchEvent(new window.Event('click', { bubbles: true }));
    chk(d.querySelector('#m-trans').hidden === false, '点译文图标展开白话译文');
    chk(d.querySelectorAll('[id="m-trans-text"]').length === 1, '译文段落 id 唯一（不重蹈重复 id 的覆辙）');
    chk(d.querySelector('#m-trans-text').textContent.length > 10, '译文内容非空');

    const srcEl = d.querySelector('#m-trans-src');
    chk(!!srcEl, '详情页译文框有来源注脚元素 #m-trans-src');
    chk(srcEl && srcEl.textContent.length > 10,
      '详情页照实显示译文来源：' + (srcEl ? srcEl.textContent : ''));

    chk(srcEl && /依据/.test(srcEl.textContent) && !/本项目整理|本应用整理/.test(srcEl.textContent),
      '来源文案只给口径依据，不含「由本项目整理为白话直译」字样');

    chk(d.querySelector('#m-text').style.fontSize === '17px',
      '古诗正文默认字号小一号 17px（实际 ' + d.querySelector('#m-text').style.fontSize + '）');
    d.querySelector('#m-font-up').dispatchEvent(new window.Event('click', { bubbles: true }));
    chk(d.querySelector('#m-text').style.fontSize === '19px', 'A＋ 放大一级');
    d.querySelector('#m-font-down').dispatchEvent(new window.Event('click', { bubbles: true }));
    chk(d.querySelector('#m-text').style.fontSize === '17px', 'A－ 收小一级');

    for (const px of ['15px', '13px']) {
      d.querySelector('#m-font-down').dispatchEvent(new window.Event('click', { bubbles: true }));
      chk(d.querySelector('#m-text').style.fontSize === px,
        'A－ 可继续降到 ' + px + '（实际 ' + d.querySelector('#m-text').style.fontSize + '）');
    }
    d.querySelector('#m-font-down').dispatchEvent(new window.Event('click', { bubbles: true }));
    chk(d.querySelector('#m-text').style.fontSize === '13px', '到底后继续点 A－ 仍停在 13px');
    for (let i = 0; i < 2; i++) {
      d.querySelector('#m-font-up').dispatchEvent(new window.Event('click', { bubbles: true }));
    }
    chk(d.querySelector('#m-text').style.fontSize === '17px',
      'A＋ 回到默认档 17px（实际 ' + d.querySelector('#m-text').style.fontSize + '）');

    chk(d.querySelectorAll('#m-align-seg button').length === 2 &&
      d.querySelectorAll('#m-align-seg button[data-align="right"]').length === 0,
      '详情页对齐组合只剩 左 / 中 两个按钮（右对齐无使用场景）');
    d.querySelector('#m-align-seg button[data-align="left"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    chk(d.querySelector('#m-text').dataset.align === 'left', '切到左对齐生效');
    chk(window.localStorage.getItem('poem_align_v1') === 'left', '对齐方式已持久化');
    d.querySelector('#m-align-seg button[data-align="center"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    chk(d.querySelector('#m-text').dataset.align === 'center', '切回居中对齐');
    d.querySelector('#modal [data-close]').dispatchEvent(new window.Event('click', { bubbles: true }));

    setOn('stage', 'high', '#seg-stage button', 'stage');
    setOn('grade', 12, '#grade-chips button', 'grade');
  }

  const item = d.querySelector('#today-list .item');
  const title = item.querySelector('.item-title').textContent.replace(/新学|复习.*|巩固/g, '').trim();
  item.dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#modal').hidden === false, '点击后弹层打开');
  chk(d.querySelector('#m-title').textContent.length > 0, '弹层显示标题: ' + d.querySelector('#m-title').textContent);
  chk(d.querySelector('#m-author').textContent.length > 0, '显示作者: ' + d.querySelector('#m-author').textContent);
  chk(d.querySelector('#m-dynasty').textContent.includes('〔'), '显示朝代: ' + d.querySelector('#m-dynasty').textContent);
  chk(d.querySelector('#m-text').textContent.trim().length > 0, '显示正文');

  d.querySelector('.btn.good').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#modal').hidden === true, '评价后弹层关闭');
  chk(d.querySelector('#ring-text').textContent === '1/5', '进度更新为 1/5（实际 ' + d.querySelector('#ring-text').textContent + '）');

  for (let i = 0; i < 4; i++) {
    const it = d.querySelector('#today-list .item:not(.done)');
    if (!it) break;
    it.dispatchEvent(new window.Event('click', { bubbles: true }));
    d.querySelector('.btn.good').dispatchEvent(new window.Event('click', { bubbles: true }));
  }
  chk(d.querySelector('#ring-text').textContent === '5/5', '全部完成 5/5（实际 ' + d.querySelector('#ring-text').textContent + '）');

  {
    const body = d.querySelector('#all-body');
    const btn = d.querySelector('#btn-all');
    chk(body.hidden === true, '「全部诗词」默认是收起的');
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    chk(body.hidden === false && btn.classList.contains('open'), '点折叠头展开（箭头朝上）');
    chk(d.querySelectorAll('#stats-row .stat').length === 4,
      '展开后有四格统计（总数 / 已学 / 较牢固 / 待复习，实际 ' +
      d.querySelectorAll('#stats-row .stat').length + ' 格）');
    chk(+d.querySelector('#all-count').textContent === d.querySelectorAll('#all-list .item').length,
      '篇目列表的条数与徽章上的数字一致（' +
      d.querySelectorAll('#all-list .item').length + ' 条）');
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    chk(body.hidden === true && !btn.classList.contains('open'), '再点一下收起');
  }
  chk(d.querySelectorAll('#today-list > .item').length === 5,
    '今日那 5 张独立卡片与「全部诗词」那张卡各是各的（不互相包）');

  chk(d.querySelectorAll('#m-actions-main > *').length === 3, '详情页第一行：对齐 / 字号 / 注音 三组');
  chk(d.querySelectorAll('#m-actions-icons > *').length === 2, '详情页第二行：正文播放键 + 译文开关');

  chk(d.querySelectorAll('#m-actions-icons #m-read-btn').length === 1, '正文只有一个播放键');
  chk(d.querySelector('#m-read-combo') === null, '不再有两个朗读键组成的「组合键」');
  chk(d.querySelectorAll('#m-trans-read').length === 1 && d.querySelector('#m-trans #m-trans-read') !== null,
    '译文朗读键只出现在白话译文框里（展开才可见）');
  chk(d.querySelector('#m-read-btn .play-glyph') !== null && d.querySelector('#m-read-btn .pause-glyph') !== null,
    '正文播放键的 ▶ / ⏸ 是同键两态，不是两个按钮');
  chk(d.querySelector('#m-trans') !== null && d.querySelector('#m-trans-text') !== null,
    '详情页有白话译文区');

  chk(srecite.querySelector('#seg-stage button.active').dataset.stage === 'high', '设置页回显当前学段高中');
  chk(srecite.querySelector('#seg-term button.active').dataset.term === '2', '设置页回显当前学期下学期');
  chk(srecite.querySelector('#grade-chips button.active').dataset.grade === '12', '设置页回显当前年级高三');

  chk(srecite.querySelectorAll('#seg-scope button').length === 6, '设置页含 6 个背诵范围选项');
  chk(srecite.querySelector('#seg-scope button.active').dataset.scope === 'upto', '默认选中「本册及之前」');
  setOn('scope', 'primary', '#seg-scope button', 'scope');
  chk(srecite.querySelector('#seg-scope button.active').dataset.scope === 'primary', '切换后按钮高亮跟随');

  chk(srecite.querySelector('#scope-hint').textContent === '当前：小学阶段',
    '小学随机范围 → 设置页回显「当前：小学阶段」（实际 ' + srecite.querySelector('#scope-hint').textContent + '）');
  chk(/小学阶段/.test(d.querySelector('#all-label').textContent),
    '小学随机范围 → 首页那张卡的标题跟着变成「' + d.querySelector('#all-label').textContent + '」');
  chk(+d.querySelector('#all-count').textContent > 5,
    '小学随机范围 → 那张卡的篇目数跟着变（' + d.querySelector('#all-count').textContent + ' 首）');
  chk(d.querySelectorAll('#today-list .item').length === 5, '随机范围下仍按每日数量出计划');
  chk(JSON.parse(spRecite.window.localStorage.getItem('poem_recite_settings_v1')).scope === 'primary', '背诵范围已持久化');
  setOn('scope', 'high', '#seg-scope button', 'scope');
  chk(srecite.querySelector('#scope-hint').textContent === '当前：高中阶段',
    '高中随机范围 → 设置页回显「当前：高中阶段」');
  setOn('scope', 'upto', '#seg-scope button', 'scope');
  chk(srecite.querySelector('#scope-hint').textContent === '当前：本学期及之前',
    '切回「本册及之前」→ 设置页回显「当前：本学期及之前」');

  const spMineN = bootSettingsPage(null, 'mine/index.html');
  const uInput = spMineN.doc.querySelector('#input-nickname');
  chk(uInput.value === '', '昵称初始为空（使用默认名 Ashley）');

  chk(!!spMineN.doc.querySelector('#btn-nickname-save'),
    '昵称旁边那颗「保存」在（用户输完即保存的落点）');
  uInput.value = '小明';
  spMineN.doc.querySelector('#btn-nickname-save')
    .dispatchEvent(new spMineN.window.Event('click', { bubbles: true }));

  const seeded = spMineN.window.localStorage.getItem('poem_recite_settings_v1');
  chk(!!seeded && JSON.parse(seeded).username === '小明',
    '点「保存」后昵称已落盘（写进设置域那个 username —— ' +
    '导出 / 标题 / 跨设备那一份读的就是它）');
  window.localStorage.setItem('poem_recite_settings_v1', seeded);
  window.PoemApp.reloadSettings();
  chk(d.title === '跬步 · 小明的背诵 · 跬步', '保存昵称后标题为「小明的背诵 · 跬步」（实际 ' + d.title + '）');

  chk(d.querySelector('.brand-text h1').textContent === '跬步', '顶栏第一行固定为「跬步」，不随用户名变化');
  chk(/小明/.test(d.querySelector('#brand-page').textContent),
    '页面名跟着用户名走：' + d.querySelector('#brand-page').textContent);
  chk(!d.querySelector('#brand-page-text').classList.contains('is-default'),
    '填了用户名后不再走淡墨（是自己填的名字）');
  chk(d.querySelector('meta[name="apple-mobile-web-app-title"]').getAttribute('content') === '跬步 · 小明的背诵',
    'iOS 桌面名随用户名变化');

  uInput.value = '   ';
  spMineN.doc.querySelector('#btn-nickname-save')
    .dispatchEvent(new spMineN.window.Event('click', { bubbles: true }));
  window.localStorage.setItem('poem_recite_settings_v1',
    spMineN.window.localStorage.getItem('poem_recite_settings_v1'));
  window.PoemApp.reloadSettings();
  chk(d.title === '跬步 · Ashley的背诵 · 跬步',
    '用户名留空时回到默认名 Ashley（实际 ' + d.title + '）');

  setOn('count', 8, '#seg-count button', 'count');
  chk(d.querySelector('#today-sub').textContent.includes('共 8 首'), '改为每日 8 首生效: ' + d.querySelector('#today-sub').textContent);

  chk(/^共 \d+ 首 · 待复习 \d+ · 新学 \d+$/.test(d.querySelector('#today-sub').textContent),
    '今日统计精简为「共 N 首 · 待复习 N · 新学 N」（实际 ' + d.querySelector('#today-sub').textContent + '）');
  chk(!/待复习 \d+ 首/.test(d.querySelector('#today-sub').textContent), '待复习数字后不再带「首」');
  chk(d.querySelectorAll('#today-list .item').length === 8, '今日列表变为 8 首');

  chk(!!window.localStorage.getItem('poem_recite_progress_v1'), '进度已写入 localStorage');
  chk(!!spRecite.window.localStorage.getItem('poem_recite_settings_v1'), '设置已写入 localStorage');

  function bootHome(search, seed) {
    const hdom = new JSDOM(html, {
      runScripts: 'dangerously', resources: undefined,
      url: 'https://local.test/' + (search || '')
    });
    if (seed) for (const k in seed) hdom.window.localStorage.setItem(k, seed[k]);
    scriptOrder.forEach(f => {
      const el = hdom.window.document.createElement('script');
      el.textContent = fs.readFileSync(path + f, 'utf8');
      hdom.window.document.body.appendChild(el);
    });
    return hdom;
  }

  const targetId = (window.POEMS_ALL || [])[0].id;
  const targetTitle = window.POEMS_ALL[0].title;
  const dl = bootHome('?poem=' + encodeURIComponent(targetId));
  setTimeout(() => {
    const dd = dl.window.document;
    chk(dd.querySelector('#modal') && dd.querySelector('#modal').hidden === false,
      '带 ?poem=<id> 进首页，详情弹层真的打开了（不是「没反应」）');
    chk(dd.querySelector('#m-title').textContent === targetTitle,
      '弹层里就是链接指的那一篇（' + targetTitle + '）');
    chk(dd.querySelector('#m-text').textContent.length > 0, '那一篇的正文渲染出来了');
    chk(/\?poem=/.test(dl.window.location.search) === false,
      '读完就把地址栏那一截抹掉（replaceState —— 刷新不再弹、返回键回得到干净的首页）');

    chk(dd.querySelectorAll('#today-list .item').length > 0,
      '今日列表照常画出来（弹层关掉之后回到的是它）');

    const closeBtn = dd.querySelector('#modal [data-close]');
    if (closeBtn) closeBtn.dispatchEvent(new dl.window.Event('click', { bubbles: true }));
    chk(dd.querySelector('#modal').hidden === true, '关掉弹层后回到首页');

    const bad = bootHome('?poem=no-such-poem-xyz');
    setTimeout(() => {
      const bd = bad.window.document;
      chk(bd.querySelector('#modal').hidden === true,
        '查不到的 id 不打开弹层（旧链接 / 手改错的 id 都安静放过）');
      chk(bd.querySelector('#toast').hidden === true, '查不到的 id 也不弹一个黄条');
      chk(bd.querySelectorAll('#today-list .item').length > 0, '查不到时首页照常可用');

      const plain = bootHome('');
      setTimeout(() => {
        chk(plain.window.document.querySelector('#modal').hidden === true,
          '没有 ?poem= 时首页不弹任何东西（普通访问不受影响）');

        const entryId = 'tangshi-ts-1';
        const withCol = bootHome('?poem=' + encodeURIComponent(entryId), {
          poem_recite_collections_v1: JSON.stringify({
            version: 1,
            collections: [{
              id: 'c-dl', name: '深链接', createdAt: Date.now(),
              items: [{
                id: entryId,
                snap: {
                  title: '感遇·其一', author: '张九龄', dynasty: '唐',
                  source: '《唐诗三百首》', selection: '《唐诗三百首》',
                  book: 'tangshi', bookName: '唐诗三百首', page: '/tangshi/',
                  text: '孤鸿海上来，池潢不敢顾。', translation: '',
                  translationSource: 'public-domain'
                }
              }]
            }]
          })
        });
        setTimeout(() => {
          const cd = withCol.window.document;
          chk(cd.querySelector('#modal').hidden === false,
            '自选集合里的课外篇目也能被 ?poem= 打开（回落到加入时的快照）');
          chk(cd.querySelector('#m-title').textContent.indexOf('感遇') >= 0,
            '打开的是那一篇（' + cd.querySelector('#m-title').textContent + '）');
          chk(cd.querySelector('#m-grade').textContent.indexOf('唐诗三百首') >= 0,
            '自选篇目的出处那一格显示集子名（不是「undefined年级 undefined学期」；实际「' +
            cd.querySelector('#m-grade').textContent + '」）');

          console.log(fails === 0 ? '\n🎉 UI 测试全部通过' : '\n❌ ' + fails + ' 项失败');
          process.exit(fails ? 1 : 0);
        }, 300);
      }, 300);
    }, 300);
  }, 300);
}, 500);
