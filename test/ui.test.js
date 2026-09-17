const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = __dirname + '/../';

const html = fs.readFileSync(path + 'index.html', 'utf8');
// 设置已从「底部弹出的卡片」改为独立整页（/settings/），页脚也搬到了这一页；
// 再进一步（Issue #132 后续）拆成**二级设置页**：
//   /settings/          主页：四个入口 + 页脚
//   /settings/general/  通用     —— 用户名 / 头像印记 / 数据管理
//   /settings/recite/   背诵     —— 学段 / 年级 / 学期 / 范围 / 数量 + 复习算法
//   /settings/lists/    我的清单 —— 自选背诵的增删改查
//   /settings/reader/   朗读 —— 注音总开关 + 五档连读方式
// 下面这一条路径映射同时给「源码扫描」与「起页实例」两处用。
const SETTINGS_PAGE = {
  'settings/index.html': '/settings/',
  'settings/general/index.html': '/settings/general/',
  'settings/recite/index.html': '/settings/recite/',
  'settings/lists/index.html': '/settings/lists/',
  'settings/reader/index.html': '/settings/reader/'
};

/** 起一张设置页实例（主页 + 四张二级页共用同一套起页方式） */
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
  // jsdom 解析完 HTML 后 DOMContentLoaded 已触发过，注入脚本后手动补一次
  sw.document.dispatchEvent(new sw.Event('DOMContentLoaded', { bubbles: true }));
  return { window: sw, doc: sw.document };
}

const dom = new JSDOM(html, { runScripts: 'dangerously', resources: undefined, url: 'https://local.test/' });

// 手动注入脚本（jsdom 不加载外部资源）
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

  // 需求 9：应用正式名称为「跬步」；用户名留空时用默认名 Ashley
  chk(d.title === '跬步 · Ashley的背诵 · 跬步',
    '用户名留空时标题用默认名 Ashley（实际 ' + d.title + '）');
  chk(d.querySelector('.brand-text h1').textContent === '跬步', '品牌标题为「跬步」');
  // 需求：主标题下面的描述文字还原回来，但不再写「一年级到高中」的年级字样
  const sub = d.querySelector('#brand-sub');
  chk(!!sub && /遗忘曲线/.test(sub.textContent),
    '主标题下的描述文字已还原（实际「' + (sub ? sub.textContent : '') + '」）');
  chk(!/年级|至高三|小学|初中|高中/.test(sub.textContent),
    '描述文字里不带一年级到高中这类年级字样');
  // 需求：顶栏第一行是「跬步 · XX的背诵」，页面名与「跬步」同一行、同字体
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

  /* ---------- 顶栏右上角的头像印（Issue #132 · 2026-09-15） ---------- */
  // 头像永远在最右（身份锚点，落点不能变），返回键在它左边；
  // 首页本来右上角是空占位，正好把占位换成头像 —— 顺手补上「四页签根页进不了 profile」的缺口。
  const tuHome = d.querySelector('.topbar #top-user');
  chk(!!tuHome, '首页顶栏有头像入口 #top-user（此前是空占位）');
  chk(tuHome && tuHome.tagName === 'A', '头像是一个真实链接（可键盘、可读屏、不是点了没反应的装饰）');
  chk(!!tuHome.querySelector('.avatar'), '头像里画的是 .avatar（首字 / 图片两档共用同一枚）');
  chk(tuHome.querySelector('.avatar').textContent.length > 0, '没传图时头像里永远有一个字，不会是空白圆');
  chk(d.querySelectorAll('.topbar #top-back').length === 0, '首页没有返回键（本来就无处可退），只有头像');
  chk(d.querySelectorAll('#top-user').length === 1, '全页只有一枚 #top-user（不复用 #top-act / #top-back 的 id）');
  chk(d.querySelectorAll('#top-act').length === 0 && d.querySelectorAll('#top-back').length === 0,
    '头像没有顺手写进 #top-act / #top-back（否则会与「全页只有一枚」那条断言打架）');

  // 深页（设置页）：返回键 + 头像都在，且头像在最右
  const spAvatar = bootSettingsPage(null);
  const spBar = spAvatar.doc.querySelector('.topbar');
  const spIds = [...spBar.querySelectorAll('#top-back, #top-user')].map(e => e.id);
  chk(spIds.join('/') === 'top-back/top-user', '深页右端依次是「返回键 · 头像」，头像在最右（实际 ' + spIds.join('/') + '）');

  // 顶栏那枚头像读的是同一份档案：昵称是「玥玥」，顶栏就得画「玥」（不能偷偷回落成「诗」）
  const spSeal = bootSettingsPage({
    poem_profile_v1: JSON.stringify({ v: 1, nickname: '玥玥', avatar: { img: '' } })
  }, 'settings/general/index.html');
  const sealTop = spSeal.doc.querySelector('.topbar #top-user .avatar');
  chk(!!sealTop && sealTop.textContent === '玥', '顶栏的头像与档案同源（昵称首字是「玥」就画「玥」，实际 ' +
    (sealTop ? sealTop.textContent : '缺失') + '）');
  chk(/玥/.test(sealTop.getAttribute('aria-label')), '头像的读屏标签也写清了是谁');
  const sealSlot = spSeal.doc.querySelector('#avatar-slot .avatar');
  chk(!!sealSlot && sealSlot.textContent === '玥', '「通用」页那枚头像与顶栏是同一枚');
  // 需求：版权 + 用户协议 / 隐私条款 从首页挪到设置整页底部
  chk(d.querySelector('.app > .foot') === null, '首页不再挂页脚（法务链接已挪到设置页底部）');
  const spEarly = bootSettingsPage(null);
  const foot = spEarly.doc.querySelector('.settings-foot');
  chk(!!foot, '设置页底部有页脚');
  chk(foot.querySelector('.foot-copy').textContent.trim() === '©2026 kuibu.app 积跬步, 至千里', '页脚版权为 ©2026 kuibu.app 积跬步, 至千里（实际 ' + foot.querySelector('.foot-copy').textContent.trim() + '）');
  // 页脚需常驻两个法务入口：用户协议 / 隐私条款
  const footLinks = [...foot.querySelectorAll('.foot-links a')];
  chk(footLinks.map(a => a.textContent.trim()).join('/') === '用户协议/隐私条款', '页脚含「用户协议」「隐私条款」链接');
  chk(footLinks.map(a => a.getAttribute('href')).join(' ') === '/terms/ /privacy/',
    '页脚两个链接指向目录化的 /terms/ 与 /privacy/（实际 ' + footLinks.map(a => a.getAttribute('href')).join(' ') + '）');
  chk(!!(spEarly.doc.querySelector('.settings-page').compareDocumentPosition(foot) & window.Node.DOCUMENT_POSITION_FOLLOWING),
    '页脚排在设置项下方（页面最底部）');
  // 需求：删掉「一年级至高三 · 按遗忘曲线复...」这行文案
  chk(!/一年级至高三/.test(d.querySelector('.topbar').textContent),
    '顶栏第一行不再出现「一年级至高三 · 」，只有「跬步 · XX的背诵」');
  // 需求（本次）：顶栏第二行收敛成一句「按遗忘曲线复习」，
  // 不再带「安排复习 · 小古文想读哪篇点哪篇」那截长尾巴
  chk(d.querySelector('#brand-sub').textContent === '按遗忘曲线复习',
    '顶栏第二行精简为「按遗忘曲线复习」（实际「' + d.querySelector('#brand-sub').textContent + '」）');
  chk(!/小古文想读哪篇点哪篇/.test(d.querySelector('.topbar').textContent),
    '顶栏不再出现「小古文想读哪篇点哪篇」');
  chk(d.querySelectorAll('.brand-icon svg').length === 1, '顶栏徽标是内联 SVG');
  /* ⚠️ Issue #209 **那一轮改错了**，这里两处口径都要看仔细：
     ① 用户说「背诵首页的5首诗词下面多了个大卡片」——「下面」指的是
        **今日那 5 条外面包着的那张壳**，把它判成「本年级本学期全部诗词」
        那一张卡是误判，所以那张卡**恢复**了（用户第二轮原话：「#210 搞错了
        请把背诵首页的「全部诗词」整张卡（折叠头 + 统计行 + 篇目列表）恢复！」）；
     ② 用户第二轮又说「5首诗词各自是个卡片，但他们5个被一张卡片包住了，
        我不需要这个包的卡片，直接列出5个卡片！」—— 所以撤掉的是**包着
        今日 5 条的那层壳**，今日那 5 条本身一条都不少。
     自选背诵那张折叠卡更早一步搬去了设置整页（Issue #114 第二条），不动。 */
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
  /* 今日那 5 条**不再套一层卡**：容器是裸的 .list（它自己认领桌面栅格那一格），
     5 条 .item 各自是一张纸。再套回 `.card` 就是把那张壳又包了回去。 */
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
  // 需求：首页右上角的「设置」齿轮删除（底部页签本身就有设置，两个入口重复）
  chk(d.querySelector('.topbar #btn-settings') === null, '首页右上角不再有设置齿轮（交给底部页签）');
  chk(d.querySelector('.topbar .icon-btn') === null, '顶栏不再有圆形图标按钮（设置入口已删）');

  /* ---------- 导航：顶栏 + 底部页签 ---------- */
  chk(!!d.querySelector('.topbar .brand-icon svg'), '顶栏有 logo（内联 SVG 徽标）');
  chk(d.querySelector('#brand-name').textContent === '跬步', '顶栏第一行固定为「跬步」，不随页面变化');
  const dock = d.querySelector('#site-dock');
  chk(!!dock, '首页有底部导航栏');
  const dockItems = [...dock.querySelectorAll('.dock-item')];
  chk(dockItems.length === 4, '底部导航为四个页签（实际 ' + dockItems.length + '）');
  chk(dockItems.map(b => b.querySelector('.dock-label').textContent).join('/') === '背诵/课外/搜索/设置',
    '页签名称为 背诵 / 课外 / 搜索 / 设置');
  chk(dockItems.map(b => b.dataset.navGo).join('/') === 'home/library/search/settings', '页签跳转目标正确');
  chk(dockItems[0].classList.contains('active') && dockItems[0].getAttribute('aria-current') === 'page',
    '当前页（背诵）页签为选中态');
  chk(dockItems.every(b => b.querySelector('.dock-icon svg')), '四个页签图标均为内联 SVG');
  // 需求（本次）：页签选中态不再用「一条短线」，那读起来像「设置」被加了条下划线。
  // 选中只靠天青描色 + 图标微抬表达；对应的 ::before 指示条整段删掉，不留僵尸代码。
  chk(!/\.dock-item::before/.test(fs.readFileSync(path + 'css/style.css', 'utf8')),
    '页签选中态的「下划线」已移除（.dock-item::before 不再存在）');
  chk(dockItems.every(b => b.querySelectorAll(':scope > *').length === 2),
    '每个页签只有图标 + 文字两个子元素，没有额外的划线装饰');
  // 需求（本次）：「设置」页签是 <a>，浏览器默认给链接文字加下划线 ——
  // 用户看到的那条线并不是设计里的装饰，而是这条默认样式漏了出来。
  // 显式 text-decoration: none 之后四个页签外观才一致（样式断言见 theme.test.js，
  // 这里补一条结构断言：设置页签确实是 <a>，所以这条样式不是可有可无的）。
  const settingsItem = dock.querySelector('.dock-item[data-nav-go="settings"]');
  chk(settingsItem.tagName === 'A', '「设置」页签是 <a>（因此必须显式去掉链接默认下划线）');
  // 需求（本次）：设置齿轮原先手工描线、齿距不匀看着「歪」，换成按几何生成的 8 齿对称齿轮
  const gear = d.querySelector('.dock-item[data-nav-go="settings"] .dock-icon svg');
  chk(!!gear, '设置页签有齿轮图标');
  const gearD = gear.querySelector('path').getAttribute('d');
  const gearPts = gearD.match(/-?\d+\.\d+ -?\d+\.\d+/g).map(x => x.split(' ').map(Number));
  const xs = gearPts.map(p => p[0]), ys = gearPts.map(p => p[1]);
  chk(Math.abs(Math.min(...xs) + Math.max(...xs) - 24) < 0.05 &&
      Math.abs(Math.min(...ys) + Math.max(...ys) - 24) < 0.05,
    '齿轮左右 / 上下都关于圆心 (12,12) 对称（不偏不歪）');
  chk(Math.abs(Math.min(...xs) - 2.68) < 0.02 && Math.abs(Math.max(...xs) - 21.32) < 0.02,
    '齿轮首齿正对 12 点钟方向，齿顶圆半径一致（齿距均分）');
  chk(gear.querySelector('circle').getAttribute('r') === '3.2', '齿轮轴孔为整圆 r3.2，居中不动');
  // 页面切换统一走底部页签，顶栏不再各页一套返回键
  chk(d.querySelector('.topbar .back-icon') === null, '顶栏不再有各页自造的返回箭头');
  chk(!!dock.querySelector('[data-nav-go="settings"]'), '「设置」是页签之一，不再只藏在右上角');
  chk(!/📖|⚙|📚/.test(d.querySelector('.app').innerHTML), '页面不再使用 📖 ⚙️ 📚 emoji 图标');
  /* 折叠箭头与列表右侧「›」风格一致（读 #btn-all 里的那枚 SVG）——
     ⚠️ 中间有过一轮把这张卡删掉的改动（Issue #209 的误判），断言在那一轮
        被挪去了样式层；第二轮卡恢复，这条也回到**这里**来判：
        判据是那颗键里真有一枚 18×18、1.8 描边的空心三角。 */
  const allArrow = d.querySelector('#btn-all .arrow svg');
  chk(!!allArrow && allArrow.getAttribute('stroke-width') === '1.8' &&
    /viewBox="0 0 24 24"/.test(allArrow.outerHTML),
    '折叠箭头是空心描边三角（不是实心 ▾ / ▴ 字符）');
  chk(!/▾|▴/.test(d.querySelector('.app').textContent), '首页不再用实心 ▾ / ▴ 字符');
  chk(!d.querySelector('.selector.card'), '年级/学期选择不再常驻首页');
  // 设置是独立整页（不是弹层）：相关内容在 settings.html 里校验
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

  // 主页：只列四个入口 + 页脚，控件都搬到各二级页
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

  // 二级页：每一页只放自己那一组/几组
  chk(!!sgeneral.querySelector('#input-username'), '「通用」页含用户名输入框');
  chk(!!sgeneral.querySelector('#account-panel'), '「通用」页含账号一项');
  chk(!!srecite.querySelector('#seg-stage'), '学段选择在「背诵」页');
  chk(!!srecite.querySelector('#seg-term'), '学期选择在「背诵」页');
  chk(!!srecite.querySelector('#grade-chips'), '年级选择在「背诵」页');
  chk(srecite.querySelectorAll('#grade-chips button').length === 6, '「背诵」页默认小学显示 6 个年级按钮');
  // 需求（本次）：一页里五个组合（学段 / 学期 / 背诵范围 / 注音 / 每日数量）
  // 与「年级」用同一套选中语言 —— 每行都恰好一个选中项，不再出现「这行选了、那行没选」的错觉。
  // ⚠️ 二级页之后这六个组合不再同住一页：背诵三项在「背诵」页、
  //    注音在「朗读」页（Issue #163 改名），所以要按页取（同一条判据仍成立）。
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
  // 选中态是同一套 class（.active），样式由 .settings-page 作用域统一接管，
  // 因此不存在「年级用 .active、别的用另一套」这种分叉。
  chk(comboPages.every(([, doc, sels]) => sels.every(sel => doc.querySelector(sel + ' button.active'))),
    '六个组合的选中态都用同一个 .active 类名，样式可被整段统一');
  // 需求（本轮）：设置项按用途归类成「通用 / 古诗词背诵 / 阅读辅助」三组；
  // 后续（Issue #69）追加「朗读播放」一组 —— 连读档位原先只在圆键菜单里，
  // 界面上没有任何入口，这一组就是补上的显式入口。
  // 分组（Issue #114 第二、三条 + 可切换复习算法那一轮 + Issue #163 精简）：
  //   通用      用户名、头像印记、账号、数据备份 / 清空（全站共用）
  //   背诵      学段 / 年级 / 学期 / 范围 / 数量 / 进度总览
  //   复习算法   四张模型 4 选 1（决定「下次什么时候复习」）
  //   我的清单   自选背诵：导入 / 导出 / 改名 / 删除 / 整组移出 / 调顺序
  //   朗读       自动注音 + 五档连读方式（Issue #163：原先的「阅读辅助」与
  //              「朗读播放」各只有一条设置，两个组标题并成一个）
  // 二级页（Issue #132 后续）不再改变**分组**，只是把它们摊到三张页上：
  //   通用 → /settings/general/      背诵 + 复习算法 → /settings/recite/
  //   我的清单 → /settings/lists/    朗读 → /settings/reader/
  const groupsOf = doc => [...doc.querySelectorAll('#settings-page .settings-group')];
  const groupTitlesOf = doc => groupsOf(doc).map(g => (g.querySelector('.settings-group-title') || {}).textContent);
  /* Issue #163（第二轮）：一页只有一组时，正文顶部**不再**重复写组名 ——
     它已经写在顶栏页名上（`data-page`），正文再写一遍是同一屏里说两次。
     所以这里判的是「分组数」与「还写不写标题」，而不是标题文字：
     单组页 0 个标题，两组的「背诵」页只剩一个（它分的是「背诵 / 复习算法」两段）。 */
  chk(groupsOf(sgeneral).length === 1 && groupTitlesOf(sgeneral).join('/') === '',
    '「通用」页只有一组，且正文不再重复写组名（实际标题「' + groupTitlesOf(sgeneral).join('/') + '」）');
  chk(groupsOf(srecite).length === 2 && groupTitlesOf(srecite).join('/') === '背诵/复习算法',
    '「背诵」页是两组：背诵 + 复习算法（实际 ' + groupTitlesOf(srecite).join('/') + '）');
  /* ⚠️ 「我的清单」这一页现在是**两组**：清单本身 + 打印。
     打印（Pro · export.paper）就长在它下面 —— 要打印的正是这份清单，
     分开两页等于让用户在两张页之间来回搬东西（见 docs §5.2 与 js/print.js）。
     ---- Issue #163（第三轮）：一页只有一组时**正文顶部不再重复写组名**
     （它已经写在顶栏页名上），所以「通用」「朗读」两页 0 颗标题，
     「我的清单」页只留「打印」那一颗（前一组的名字仍是顶栏页名）。 */
  chk(groupsOf(sgeneral).length === 1 && groupTitlesOf(sgeneral).join('/') === '',
    '「通用」页只有一组，且正文不再重复写组名（实际标题「' + groupTitlesOf(sgeneral).join('/') + '」）');
  chk(groupsOf(slists).length === 2 && groupTitlesOf(slists).join('/') === '/打印',
    '「我的清单」页两组，正文只留「打印」那一颗组标题（实际 ' + groupTitlesOf(slists).join('/') + '）');
  chk(groupsOf(sreader).length === 1 && groupTitlesOf(sreader).join('/') === '',
    '「朗读」页只有一组（Issue #163：原「阅读辅助 + 朗读播放」并成「朗读」），正文不重复写组名');
  chk(groupsOf(srecite).length === 2 && groupTitlesOf(srecite).join('/') === '背诵/复习算法',
    '「背诵」页是两组：背诵 + 复习算法（实际 ' + groupTitlesOf(srecite).join('/') + '）');
  // 四张页合起来：组数与顺序不变 —— 拆页不该顺手改分类。
  const allGroupCount = [sgeneral, srecite, slists, sreader]
    .reduce((n, doc) => n + groupsOf(doc).length, 0);
  chk(allGroupCount === 6, '四张二级页合起来是六组（实际 ' + allGroupCount + '）');
  // 页名就是「组名」的唯一一处：单组页的组名写在顶栏页名上，一个字没少。
  ['通用', '背诵', '我的清单', '朗读'].forEach((n, i) => {
    const doc = [sgeneral, srecite, slists, sreader][i];
    chk(doc.body.getAttribute('data-page') === n, '「' + n + '」写在顶栏页名上（data-page）');
  });
  // 需求（本次）：分组标题下的二级描述全部删除，标题下方直接就是选项
  chk([sgeneral, srecite, slists, sreader].every(doc =>
    [...doc.querySelectorAll('.settings-group')].every(g => !g.querySelector('.settings-group-desc'))),
    '每个分组都不再有二级描述文字');
  /* 控件归到哪一组 —— Issue #163 之后**单组页不再写组标题**（组名只在顶栏页名上），
     所以判据改成「落在哪张页的分组里 + 那张页的组名」：
     单组页回它的 `data-page`，两组的页仍按组标题回（那条信息还在）。 */
  const grpOf = (doc, sel) => {
    const el = doc.querySelector(sel);
    const own = el && el.closest('.settings-group');
    if (!own) return null;
    const title = own.querySelector('.settings-group-title');
    return title ? title.textContent : doc.body.getAttribute('data-page');
  };
  chk(grpOf(sgeneral, '#input-username') === '通用', '用户名归到「通用」（古诗词与小古文共用）');
  chk(grpOf(sgeneral, '#btn-export') === '通用' && grpOf(sgeneral, '#btn-reset') === '通用',
    '数据管理归到「通用」');
  chk(grpOf(srecite, '#seg-stage') === '背诵' && grpOf(srecite, '#grade-chips') === '背诵' &&
      grpOf(srecite, '#seg-term') === '背诵', '学段 / 年级 / 学期归到「背诵」');
  chk(grpOf(srecite, '#seg-scope') === '背诵' && grpOf(srecite, '#seg-count') === '背诵',
    '背诵范围 / 每日数量归到「背诵」');
  // 需求（Issue #114 第二条）：自选背诵整块搬进设置的「我的清单」
  chk(!!slists.querySelector('#collections-list') && !!slists.querySelector('#collections-tip'),
    '「我的清单」页有自选背诵清单（#collections-list / #collections-tip）');
  chk(grpOf(slists, '#collections-list') === '我的清单' && grpOf(slists, '#btn-collections-import') === '我的清单',
    '自选背诵（清单 + 导入键）归到「我的清单」');
  // 导入 / 导出用的纯文本对话框也跟着那一页走
  chk(!!slists.querySelector('#text-dialog') && !!slists.querySelector('#text-dialog-text'),
    '「我的清单」页有导入 / 导出用的纯文本对话框');
  chk(grpOf(sreader, '#seg-helper') === '朗读', '注音总开关归到「朗读」组');
  chk(grpOf(sreader, '#seg-play') === '朗读', '连读档位归到「朗读」组');
  chk(grpOf(srecite, '#seg-algo') === '复习算法', '复习算法选择归到「复习算法」组');
  // 只给背诵用的选项不能再出现在「通用」组里（这才是这次需求的重点）
  // 「通用」组的七项：用户名 / 头像印记 / 子用户 / 账号 / 跨设备同步 / 数据管理 /
  // 课内诗词导出
  // （Issue #132 · 用户名旁多了头像印记、二级页补上「账号」、1B 又补上同步开关；
  //  3 期 P1 再补上「子用户」（Issue #159 的 ④）；
  //  Issue #159 · 最后补上「课内诗词导出」——用户点名只要课本那一部分，
  //  且门槛是 Pro。它们都是账号域的身份与数据设置）。
  // 这里守的仍是原来那条重点：**只给背诵用的选项不许混进「通用」**。
  const generalItems = sgeneral.querySelector('#settings-page .settings-group').querySelectorAll('.settings-item');
  chk(generalItems.length === 7,
    '「通用」组是用户名 / 头像印记 / 子用户 / 账号 / 跨设备同步 / 数据管理 / 课内诗词导出七项（实际 ' + generalItems.length + '）');
  chk(!!sgeneral.querySelector('#btn-export-poems'),
    '「通用」里有课内诗词导出（Issue #159：只导课本那 261 首）');
  chk(grpOf(sgeneral, '#btn-export-poems') === '通用',
    '课内诗词导出归到「通用」（与数据管理同一组：都是「把你的东西拿走」）');
  chk(!!sgeneral.querySelector('#toggle-sync'),
    '「通用」里有跨设备同步开关（用户有权拒绝上传，默认关着 —— docs §4.2 第 2 条）');
  /* Issue #163：上一版那套「固定字集 + 固定四色」整块删掉了 —— 这里**反过来守**：
     它们不许再出现在页面上（用户原话「四个颜色背景选择全部删除」）。 */
  chk(!sgeneral.querySelector('#seal-chars') && !sgeneral.querySelector('#seal-inks'),
    '那四个色点与字集选择器都不在了（用户点名删掉的自造流程）');
  chk(!!sgeneral.querySelector('#btn-avatar-pick') && !!sgeneral.querySelector('#avatar-file'),
    '「通用」里有头像上传的入口与文件选择框');
  chk(grpOf(sgeneral, '#btn-avatar-pick') === '通用', '头像归到「通用」（账号域的身份设置）');
  // 拆页之后不能两页都留同一件控件，也不能哪一页都找不到
  const OWNER_OF = {
    '#input-username': [sgeneral], '#btn-avatar-pick': [sgeneral], '#account-panel': [sgeneral],
    '#family-panel': [sgeneral],
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
  // 主页与四张二级页都是独立的整页容器
  [sindex, sgeneral, srecite, slists, sreader].forEach(doc => {
    chk(!!doc.querySelector('#settings-page'), '每一张设置页都有独立的整页容器');
    chk(!!doc.querySelector('.settings-foot'), '每一张设置页都有页脚（版权 + 法务链接）');
  });
  /* 「背诵范围」下回显当前范围（此前设置页留空一块）。
     ⚠️ Issue #209：出厂那一档从「本年级本学期」改成「本册及之前」，
        所以回显的字从「当前：本年级本学期」变成「当前：本学期及之前」。 */
  chk(!!srecite.querySelector('#scope-hint') &&
      srecite.querySelector('#scope-hint').textContent === '当前：本学期及之前',
    '背诵范围下回显当前范围（实际「' + (srecite.querySelector('#scope-hint') || {}).textContent + '」）');
  /* 账号那一项：Issue #209 起未登录那一档写作**「游客」**（用户点名：
     「未登录（游客）修改为 游客」），底下的 sync/登录口径不再是这条断言的对象 ——
     「进度只存在本机」那一句被用户点名删掉，只剩「用邮箱登录」那颗键。
     断言的落点因此从「有没有写未登录」翻成「有没有写游客 + 有没有登录入口」。 */
  chk(sgeneral.querySelector('#account-state').textContent === '游客',
    '「账号」一项未登录时写「游客」（实际「' + sgeneral.querySelector('#account-state').textContent + '」）');
  chk(/用邮箱登录/.test(sgeneral.querySelector('#account-panel').textContent),
    '「账号」一项仍有进 /login/ 的入口（删的是那段解释，不是入口）');
  // 需求：首页下方的「小古文」入口卡片删除（底部页签已承担入口，卡片重复）
  chk(d.querySelector('#classic-entry') === null, '首页不再有小古文入口卡片');
  chk(d.querySelector('.classic-entry') === null, '首页不再有小古文入口卡片（classic-entry 已删）');
  chk(d.querySelector('#classic-title') === null && d.querySelector('.classic-title') === null,
    '不再渲染小古文入口标题');
  chk(![sindex, sgeneral, srecite, slists, sreader].some(doc => doc.querySelector('#seg-classic-entry')),
    '设置里不再有「首页小古文入口」选项（入口已删）');
  chk(![sindex, sgeneral, srecite, slists, sreader].some(doc => /首页小古文入口/.test(doc.body.textContent)),
    '设置页文案里不再出现「首页小古文入口」');
  /* 这一条守的是**件数**：今日任务仍是 5 首，小古文一篇都没混进来。
     （原先把那句「本学期诗词数」的读数从 #all-count 挪走了一轮，
        第二轮卡恢复，两处读数仍然一致 —— 见下面那条。） */
  chk(d.querySelectorAll('#today-list .item').length === 5, '小古文不会混进古诗词列表（仍为 5 首）');
  // 底部页签的「课外」是四部集子的统一入口，指向入口页（不再是某一部直连）
  const dockLibraryCount = [...dock.querySelectorAll('.dock-item')].filter(b => b.dataset.navGo === 'library').length;
  chk(dockLibraryCount === 1, '四部集子的入口只剩底部页签「课外」一处');
  chk(d.querySelector('.dock-item[data-nav-go="library"]').getAttribute('data-href') === '/library/',
    '「课外」页签指向 /library/ 入口页');

  // 底部页签「设置」是通往设置整页的链接（不再是打开弹层）
  const dockSettings = d.querySelector('.dock-item[data-nav-go="settings"]');
  chk(dockSettings.tagName === 'A' && dockSettings.getAttribute('href') === '/settings/',
    '底部页签「设置」指向设置整页（实际 ' + dockSettings.tagName + ' ' + dockSettings.getAttribute('href') + '）');
  chk(d.querySelectorAll('#today-list .item').length === 5, '今日列表渲染 5 首（实际 ' + d.querySelectorAll('#today-list .item').length + '）');
  chk(d.querySelector('#ring-text').textContent === '0/5', '环形进度 0/5');
  // 需求 1：任务条标题改为「今日背诵」
  chk(d.querySelector('.today-title').textContent === '今日背诵',
    '任务条标题为「今日背诵」（实际 ' + d.querySelector('.today-title').textContent + '）');
  // 需求 5：朗读按钮是圆形播放键，不再有「朗读」文字
  chk(d.querySelector('#today-read .play-glyph') !== null, '今日朗读按钮是 ▶ 圆形播放键');
  chk(!/朗读/.test(d.querySelector('#today-read').textContent.replace(/\s/g, '')),
    '今日朗读按钮不再显示「朗读」文字');
  // 需求 4：底部播放栏是贴底整宽、无圆角的播放器
  const pbCss = fs.readFileSync(path + 'css/style.css', 'utf8');
  const pb = /(\.player-bar \{[\s\S]*?\n\})/.exec(pbCss);
  chk(!!pb && /left:\s*0;/.test(pb[1]) && /right:\s*0;/.test(pb[1]) && /bottom:\s*0;/.test(pb[1]),
    '播放栏贴底占满整宽');
  chk(!!pb && !/border-radius/.test(pb[1]), '播放栏不再有圆角');
  chk(/\.player-bar \{[\s\S]*?padding: 14px/.test(pbCss), '播放栏高度加大');
  // 需求 6：列表单项右侧是播放键
  chk(d.querySelectorAll('#today-list .item-read .play-glyph').length === 5,
    '今日每首右侧都是 ▶ 播放键');
  /* 「本学期诗词数」的同一份口径现在有两处：首页「全部诗词」卡上的 `#all-count`
     （Issue #209 误删、第二轮已恢复）与设置页「背诵」那一页的 `#scope-hint`。
     这里读设置页那处 —— 它俩说的是同一件事。 */
  /* ⚠️ Issue #209：界面上删掉了「本年级本学期」那一档（用户点名），出厂范围
     改成「本册及之前」（`upto`）。所以这里守的读数从「当前：本年级本学期」
     翻成「当前：本学期及之前」—— 口径没变，只是出厂那一档换了。 */
  chk(srecite.querySelector('#scope-hint').textContent === '当前：本学期及之前',
    '出厂范围回显正确（实际 ' + srecite.querySelector('#scope-hint').textContent + '）');

  /* 年级 / 学期 / 学段 / 范围 / 数量的切换现在都发生在设置整页：
     设置页写的是同一份 localStorage，改完让首页重读一次设置即可生效 */
  // ⚠️ 这些控件现在住在「背诵」二级页（/settings/recite/），
  //    所以按页取、按页派发事件 —— 写的仍是同一份 localStorage。
  const setOn = (key, val, sel, attr) => {
    const b = [...srecite.querySelectorAll(sel)].find(x => String(x.dataset[attr]) === String(val));
    b.dispatchEvent(new spRecite.window.Event('click', { bubbles: true }));
    window.localStorage.setItem('poem_recite_settings_v1', spRecite.window.localStorage.getItem('poem_recite_settings_v1'));
    window.PoemApp.reloadSettings();
  };

  // 年级切换（一年级 → 二年级）
  setOn('grade', 2, '#grade-chips button', 'grade');
  chk(String(srecite.querySelector('#grade-chips button.active').dataset.grade) === '2', '设置页年级高亮切到二年级（实际 ' + (srecite.querySelector('#grade-chips button.active') ? srecite.querySelector('#grade-chips button.active').textContent : '无') + '）');
  chk(srecite.querySelector('#scope-hint').textContent === '当前：本学期及之前',
    '切到二年级上学期：范围回显仍是「本学期及之前」');
  chk(d.querySelectorAll('#today-list .item').length === 5, '切换后仍是 5 首计划');

  // 学期切换
  setOn('term', 2, '#seg-term button', 'term');
  chk(srecite.querySelector('#chip-grade')
      ? srecite.querySelector('#scope-hint').textContent === '当前：本学期及之前'
      : true, '二年级下学期：范围回显一致');

  // 学段切换：年级必须落在新学段内
  setOn('stage', 'high', '#seg-stage button', 'stage');
  chk(srecite.querySelectorAll('#grade-chips button').length === 3, '设置页切高中后显示 3 个年级');
  chk(['10', '11', '12'].indexOf(String(srecite.querySelector('#grade-chips button.active').dataset.grade)) > -1,
    '换学段后年级落在新学段内');
  setOn('grade', 12, '#grade-chips button', 'grade');
  chk(srecite.querySelector('#scope-hint').textContent === '当前：本学期及之前',
    '高三下学期：范围回显仍是「本学期及之前」');

  /* 需求：古诗词详情页与小古文详情页功能对齐（对齐 / 字号 / 译文 / 播放组合键）。
     先单独验一遍，验完把页面状态恢复成「高三下」，不干扰后面的断言。 */
  {
    // 二年级属于小学学段，先把学段切回小学再选年级；二年级诗篇有白话译文
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
    // 译文来源注脚：白话译诗没有法定教科书版本，界面必须照实说明口径
    const srcEl = d.querySelector('#m-trans-src');
    chk(!!srcEl, '详情页译文框有来源注脚元素 #m-trans-src');
    chk(srcEl && srcEl.textContent.length > 10,
      '详情页照实显示译文来源：' + (srcEl ? srcEl.textContent : ''));
    // 注脚只说口径依据，不再挂「由本项目整理为白话直译」的尾巴（Issue #44 要求删除）；
    // 译文是自拟的这一点由 README / 用户协议承载，界面上照实给出可追溯的口径即可
    chk(srcEl && /依据/.test(srcEl.textContent) && !/本项目整理|本应用整理/.test(srcEl.textContent),
      '来源文案只给口径依据，不含「由本项目整理为白话直译」字样');

    chk(d.querySelector('#m-text').style.fontSize === '17px',
      '古诗正文默认字号小一号 17px（实际 ' + d.querySelector('#m-text').style.fontSize + '）');
    d.querySelector('#m-font-up').dispatchEvent(new window.Event('click', { bubbles: true }));
    chk(d.querySelector('#m-text').style.fontSize === '19px', 'A＋ 放大一级');
    d.querySelector('#m-font-down').dispatchEvent(new window.Event('click', { bubbles: true }));
    chk(d.querySelector('#m-text').style.fontSize === '17px', 'A－ 收小一级');
    // Issue #55：默认档不动，A－ 能一路再降到最细一档 13px（15 之后仍有效果）
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

    // 恢复成「高三下」，不干扰后面的断言
    setOn('stage', 'high', '#seg-stage button', 'stage');
    setOn('grade', 12, '#grade-chips button', 'grade');
  }

  // 点击条目打开弹层
  const item = d.querySelector('#today-list .item');
  const title = item.querySelector('.item-title').textContent.replace(/新学|复习.*|巩固/g, '').trim();
  item.dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#modal').hidden === false, '点击后弹层打开');
  chk(d.querySelector('#m-title').textContent.length > 0, '弹层显示标题: ' + d.querySelector('#m-title').textContent);
  chk(d.querySelector('#m-author').textContent.length > 0, '显示作者: ' + d.querySelector('#m-author').textContent);
  chk(d.querySelector('#m-dynasty').textContent.includes('〔'), '显示朝代: ' + d.querySelector('#m-dynasty').textContent);
  chk(d.querySelector('#m-text').textContent.trim().length > 0, '显示正文');

  // 点击"记住"
  d.querySelector('.btn.good').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#modal').hidden === true, '评价后弹层关闭');
  chk(d.querySelector('#ring-text').textContent === '1/5', '进度更新为 1/5（实际 ' + d.querySelector('#ring-text').textContent + '）');

  // 学完 5 首
  for (let i = 0; i < 4; i++) {
    const it = d.querySelector('#today-list .item:not(.done)');
    if (!it) break;
    it.dispatchEvent(new window.Event('click', { bubbles: true }));
    d.querySelector('.btn.good').dispatchEvent(new window.Event('click', { bubbles: true }));
  }
  chk(d.querySelector('#ring-text').textContent === '5/5', '全部完成 5/5（实际 ' + d.querySelector('#ring-text').textContent + '）');

  /* 展开「全部诗词」：折叠键点得动、统计条与篇目列表都铺出来
     —— 这三样 Issue #209 被误删过一轮，第二轮用户点名要求恢复，所以这里
        判的是**正面**：点一下就展开、再点一下收起来，且内容真的在。 */
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
  // 需求：详情页工具条与小古文对齐一致；标签行、按钮整行居中，底部不被页签压住
  chk(d.querySelectorAll('#m-actions-main > *').length === 3, '详情页第一行：对齐 / 字号 / 注音 三组');
  chk(d.querySelectorAll('#m-actions-icons > *').length === 2, '详情页第二行：正文播放键 + 译文开关');
  // 需求：不再并排「原文 / 译文」两个朗读键 ——
  // 正文那颗 ▶ / ⏸ 在同一位置切换，译文的朗读键挪到译文框里，展开才出现
  chk(d.querySelectorAll('#m-actions-icons #m-read-btn').length === 1, '正文只有一个播放键');
  chk(d.querySelector('#m-read-combo') === null, '不再有两个朗读键组成的「组合键」');
  chk(d.querySelectorAll('#m-trans-read').length === 1 && d.querySelector('#m-trans #m-trans-read') !== null,
    '译文朗读键只出现在白话译文框里（展开才可见）');
  chk(d.querySelector('#m-read-btn .play-glyph') !== null && d.querySelector('#m-read-btn .pause-glyph') !== null,
    '正文播放键的 ▶ / ⏸ 是同键两态，不是两个按钮');
  chk(d.querySelector('#m-trans') !== null && d.querySelector('#m-trans-text') !== null,
    '详情页有白话译文区');

  // 设置整页：回显当前配置
  chk(srecite.querySelector('#seg-stage button.active').dataset.stage === 'high', '设置页回显当前学段高中');
  chk(srecite.querySelector('#seg-term button.active').dataset.term === '2', '设置页回显当前学期下学期');
  chk(srecite.querySelector('#grade-chips button.active').dataset.grade === '12', '设置页回显当前年级高三');

  /* 背诵范围：Issue #209 起 6 个选项（用户点名删掉「本册」= 本年级本学期那一档），
     出厂选中「本册及之前」。 */
  chk(srecite.querySelectorAll('#seg-scope button').length === 6, '设置页含 6 个背诵范围选项');
  chk(srecite.querySelector('#seg-scope button.active').dataset.scope === 'upto', '默认选中「本册及之前」');
  setOn('scope', 'primary', '#seg-scope button', 'scope');
  chk(srecite.querySelector('#seg-scope button.active').dataset.scope === 'primary', '切换后按钮高亮跟随');
  /* 「切换范围 → 首页那张卡与设置页回显都跟着变」：
     设置页读 `#scope-hint` 的「当前：…」，首页读那张「全部诗词」卡的
     `#all-count` / `#all-label`（Issue #209 误删、第二轮已恢复）——
     两处说的是同一件事，两条一起判。 */
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

  // 用户名：在「通用」二级页输入后，首页标题与品牌名同步变化
  const uInput = sgeneral.querySelector('#input-username');
  chk(uInput.value === '', '用户名初始为空（使用默认名 Ashley）');
  uInput.value = '小明';
  uInput.dispatchEvent(new spGeneral.window.Event('input', { bubbles: true }));
  window.localStorage.setItem('poem_recite_settings_v1', spGeneral.window.localStorage.getItem('poem_recite_settings_v1'));
  window.PoemApp.reloadSettings();
  chk(d.title === '跬步 · 小明的背诵 · 跬步', '填了用户名后标题为「小明的背诵 · 跬步」（实际 ' + d.title + '）');
  // 顶栏第一行固定为应用名（不随用户名变），用户名只出现在页面标题与第二行里，
  // 否则进了小古文 / 法务页顶栏也跟着改名，用户认不出自己在哪一页
  chk(d.querySelector('.brand-text h1').textContent === '跬步', '顶栏第一行固定为「跬步」，不随用户名变化');
  chk(/小明/.test(d.querySelector('#brand-page').textContent),
    '页面名跟着用户名走：' + d.querySelector('#brand-page').textContent);
  chk(!d.querySelector('#brand-page-text').classList.contains('is-default'),
    '填了用户名后不再走淡墨（是自己填的名字）');
  chk(d.querySelector('meta[name="apple-mobile-web-app-title"]').getAttribute('content') === '跬步 · 小明的背诵',
    'iOS 桌面名随用户名变化');
  chk(JSON.parse(spGeneral.window.localStorage.getItem('poem_recite_settings_v1')).username === '小明', '用户名已持久化');

  uInput.value = '   ';
  uInput.dispatchEvent(new spGeneral.window.Event('input', { bubbles: true }));
  window.localStorage.setItem('poem_recite_settings_v1', spGeneral.window.localStorage.getItem('poem_recite_settings_v1'));
  window.PoemApp.reloadSettings();
  chk(d.title === '跬步 · Ashley的背诵 · 跬步',
    '用户名留空时回到默认名 Ashley（实际 ' + d.title + '）');

  setOn('count', 8, '#seg-count button', 'count');
  chk(d.querySelector('#today-sub').textContent.includes('共 8 首'), '改为每日 8 首生效: ' + d.querySelector('#today-sub').textContent);
  // 需求 4：统计文案去掉「首」后缀，避免换行 →「共 N 首 · 待复习 N · 新学 N」
  chk(/^共 \d+ 首 · 待复习 \d+ · 新学 \d+$/.test(d.querySelector('#today-sub').textContent),
    '今日统计精简为「共 N 首 · 待复习 N · 新学 N」（实际 ' + d.querySelector('#today-sub').textContent + '）');
  chk(!/待复习 \d+ 首/.test(d.querySelector('#today-sub').textContent), '待复习数字后不再带「首」');
  chk(d.querySelectorAll('#today-list .item').length === 8, '今日列表变为 8 首');

  // 持久化：进度写在首页实例，设置写在设置页实例
  chk(!!window.localStorage.getItem('poem_recite_progress_v1'), '进度已写入 localStorage');
  chk(!!spRecite.window.localStorage.getItem('poem_recite_settings_v1'), '设置已写入 localStorage');

  /* ---------------- 深链接：/?poem=<id> 落地 ----------------
     需求（Issue #114 后续）：/progress/ 那份「全部到期篇目」的篇名是
     `/?poem=<id>` 的链接，但**全站没有一处读它** —— 点过去首页照常画
     「今日背诵」，什么也不弹（不报错、测试也全过，因为它当时只验了链接形态）。
     这里验的就是接上的那一头：地址栏带 poem= 进来，首页把那一篇的详情弹层打开。 */
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
    /* 今日列表照样在弹层下面画好了：关掉弹层回到的是首页，不是半张白纸 */
    chk(dd.querySelectorAll('#today-list .item').length > 0,
      '今日列表照常画出来（弹层关掉之后回到的是它）');
    /** 关掉弹层：首页仍在，没有任何报错 */
    const closeBtn = dd.querySelector('#modal [data-close]');
    if (closeBtn) closeBtn.dispatchEvent(new dl.window.Event('click', { bubbles: true }));
    chk(dd.querySelector('#modal').hidden === true, '关掉弹层后回到首页');

    /* 查不到的 id：安静放过 —— 不该弹一个「找不到」的黄条，也不该报错 */
    const bad = bootHome('?poem=no-such-poem-xyz');
    setTimeout(() => {
      const bd = bad.window.document;
      chk(bd.querySelector('#modal').hidden === true,
        '查不到的 id 不打开弹层（旧链接 / 手改错的 id 都安静放过）');
      chk(bd.querySelector('#toast').hidden === true, '查不到的 id 也不弹一个黄条');
      chk(bd.querySelectorAll('#today-list .item').length > 0, '查不到时首页照常可用');

      /* 没有 poem= 时一切照旧（不能因为加了这一条就让普通访问变了样） */
      const plain = bootHome('');
      setTimeout(() => {
        chk(plain.window.document.querySelector('#modal').hidden === true,
          '没有 ?poem= 时首页不弹任何东西（普通访问不受影响）');

        /* 自选集合里的篇目（课外）：走快照也能打开，且那一格显示集子名 */
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
