const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = __dirname + '/../';

const html = fs.readFileSync(path + 'index.html', 'utf8');
// 设置已从「底部弹出的卡片」改为独立整页（/settings/），页脚也搬到了这一页
const settingsHtml = fs.readFileSync(path + 'settings/index.html', 'utf8');

/** 起一个设置整页实例（供读取设置项回显 / 改写配置） */
function bootSettingsPage(seed) {
  const sdom = new JSDOM(settingsHtml, { runScripts: 'dangerously', url: 'https://local.test/settings/', base: 'https://local.test/settings/' });
  const sw = sdom.window;
  if (seed) for (const k in seed) sw.localStorage.setItem(k, seed[k]);
  settingsHtml.match(/<script src="([^"]+)"><\/script>/g)
    .map(x => x.match(/src="([^"]+)"/)[1])
    .forEach(f => {
      const el = sw.document.createElement('script');
      el.textContent = fs.readFileSync(path + f, 'utf8');
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
  chk(d.querySelector('#all-label').textContent === '本年级本学期全部诗词', '全部诗词标题精确为「本年级本学期全部诗词」');
  // 顶栏图标：徽标 + 两张折叠卡（全部诗词 / 自选背诵）的图标，全部是内联 SVG。
  // 自选背诵是后加的一张卡，同样用一枚书签 SVG 作折叠头图标，
  // 数量因此由 2 变 3 —— 这里按「枚数 = 徽标 1 + 折叠头 N」判，
  // 再往后添折叠卡时只需改这个 N，不会因为多一张卡就红。
  chk(d.querySelectorAll('.brand-icon svg').length === 1, '顶栏徽标是内联 SVG');
  const collapseHeads = d.querySelectorAll('.collapse-head');
  chk(collapseHeads.length === 2, '首页两张折叠卡：全部诗词 + 自选背诵（实际 ' + collapseHeads.length + '）');
  chk([...collapseHeads].every(h => h.querySelector('.collapse-icon svg')),
    '每张折叠卡的折叠头图标都是内联 SVG');
  chk(d.querySelectorAll('.collapse-icon svg').length === collapseHeads.length,
    '折叠头图标数 = 折叠卡数（都是 SVG，不用文本字符）');
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
  // 需求：折叠箭头与列表右侧「›」风格一致 —— 空心描边三角，且能上下切换
  const arrow = d.querySelector('#btn-all .arrow');
  chk(!!arrow && !!arrow.querySelector('svg'), '「全部诗词」折叠键用内联 SVG 三角（不再是实心 ▾）');
  chk(arrow.querySelector('svg').getAttribute('fill') === 'none', '三角是空心的（fill: none + 描边）');
  chk(!/▾|▴/.test(d.querySelector('#btn-all').textContent), '不再用实心 ▾ / ▴ 字符');
  chk(!d.querySelector('.selector.card'), '年级/学期选择不再常驻首页');
  // 设置是独立整页（不是弹层）：相关内容在 settings.html 里校验
  chk(d.querySelector('#settings-modal') === null, '首页不再有「向上弹出的设置卡片」');
  const sp = bootSettingsPage(null);
  const sd = sp.doc;
  chk(!!sd.querySelector('#input-username'), '设置页含用户名输入框');
  chk(!!sd.querySelector('#seg-stage'), '学段选择已移入设置');
  chk(!!sd.querySelector('#seg-term'), '学期选择已移入设置');
  chk(!!sd.querySelector('#grade-chips'), '年级选择已移入设置');
  chk(sd.querySelectorAll('#grade-chips button').length === 6, '设置页默认小学显示 6 个年级按钮');
  // 需求（本次）：一页里五个组合（学段 / 学期 / 背诵范围 / 阅读辅助 / 每日数量）
  // 与「年级」用同一套选中语言 —— 每行都恰好一个选中项，不再出现「这行选了、那行没选」的错觉。
  const groups = ['#seg-stage', '#seg-term', '#seg-scope', '#seg-helper', '#seg-count', '#grade-chips'];
  chk(groups.every(sel => {
    const btns = [...sd.querySelectorAll(sel + ' button')];
    return btns.length > 0 && btns.filter(b => b.classList.contains('active')).length === 1;
  }), '设置页每个组合都恰好一个选中项（学段/学期/范围/辅助/数量/年级）');
  // 选中态是同一套 class（.active），样式由 .settings-page 作用域统一接管，
  // 因此不存在「年级用 .active、别的用另一套」这种分叉。
  chk(groups.every(sel => sd.querySelector(sel + ' button.active')),
    '六个组合的选中态都用同一个 .active 类名，样式可被整段统一');
  // 需求（本次）：设置项按用途归类成「通用 / 古诗词背诵 / 阅读辅助」三组
  const setGroups = [...sd.querySelectorAll('#settings-page .settings-group')];
  chk(setGroups.length === 3, '设置页渲染出三组（实际 ' + setGroups.length + '）');
  const groupTitles = setGroups.map(g => (g.querySelector('.settings-group-title') || {}).textContent);
  chk(groupTitles.join('/') === '通用/古诗词背诵/阅读辅助',
    '分组顺序与标题正确：' + groupTitles.join(' / '));
  // 需求（本次）：分组标题下的二级描述全部删除，标题下方直接就是选项
  chk(setGroups.every(g => !g.querySelector('.settings-group-desc')),
    '每个分组都不再有二级描述文字');
  const grpOf = sel => {
    const el = sd.querySelector(sel);
    const own = el && el.closest('.settings-group');
    return own ? own.querySelector('.settings-group-title').textContent : null;
  };
  chk(grpOf('#input-username') === '通用', '用户名归到「通用」（古诗词与小古文共用）');
  chk(grpOf('#btn-export') === '通用' && grpOf('#btn-reset') === '通用',
    '数据管理归到「通用」');
  chk(grpOf('#seg-stage') === '古诗词背诵' && grpOf('#grade-chips') === '古诗词背诵' &&
      grpOf('#seg-term') === '古诗词背诵', '学段 / 年级 / 学期归到「古诗词背诵」');
  chk(grpOf('#seg-scope') === '古诗词背诵' && grpOf('#seg-count') === '古诗词背诵',
    '背诵范围 / 每日数量归到「古诗词背诵」');
  chk(grpOf('#seg-helper') === '阅读辅助', '注音总开关归到「阅读辅助」组');
  // 只给背诵用的选项不能再出现在「通用」组里（这才是这次需求的重点）
  const generalItems = setGroups[0].querySelectorAll('.settings-item');
  chk(generalItems.length === 2, '「通用」组只有用户名与数据管理两项（实际 ' + generalItems.length + '）');
  // 设置项都还在，没有在搬动过程中被漏掉
  ['#input-username', '#seg-stage', '#grade-chips', '#seg-term', '#seg-scope',
   '#seg-count', '#seg-helper', '#btn-export', '#btn-import', '#btn-reset'].forEach(sel => {
    chk(!!sd.querySelector(sel), '分组后设置项仍在：' + sel);
  });
  // 「背诵范围」下回显当前范围（此前设置页留空一块）
  chk(!!sd.querySelector('#scope-hint') && /^当前：/.test(sd.querySelector('#scope-hint').textContent),
    '背诵范围下回显当前范围（实际「' + (sd.querySelector('#scope-hint') || {}).textContent + '」）');
  chk(!!sd.querySelector('#settings-page'), '设置页是独立的整页容器');
  // 需求：首页下方的「小古文」入口卡片删除（底部页签已承担入口，卡片重复）
  chk(d.querySelector('#classic-entry') === null, '首页不再有小古文入口卡片');
  chk(d.querySelector('.classic-entry') === null, '首页不再有小古文入口卡片（classic-entry 已删）');
  chk(d.querySelector('#classic-title') === null && d.querySelector('.classic-title') === null,
    '不再渲染小古文入口标题');
  chk(sd.querySelector('#seg-classic-entry') === null, '设置里不再有「首页小古文入口」选项（入口已删）');
  chk(!/首页小古文入口/.test(sd.body.textContent), '设置页文案里不再出现「首页小古文入口」');
  chk(d.querySelector('#all-count').textContent === '5', '小古文不会混进古诗词列表（仍为 5 首）');
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
  chk(d.querySelector('#all-count').textContent === '5', '本学期诗词数 5');

  /* 年级 / 学期 / 学段 / 范围 / 数量的切换现在都发生在设置整页：
     设置页写的是同一份 localStorage，改完让首页重读一次设置即可生效 */
  const setOn = (key, val, sel, attr) => {
    const b = [...sd.querySelectorAll(sel)].find(x => String(x.dataset[attr]) === String(val));
    b.dispatchEvent(new sp.window.Event('click', { bubbles: true }));
    window.localStorage.setItem('poem_recite_settings_v1', sp.window.localStorage.getItem('poem_recite_settings_v1'));
    window.PoemApp.reloadSettings();
  };

  // 年级切换（一年级 → 二年级）
  setOn('grade', 2, '#grade-chips button', 'grade');
  chk(String(sd.querySelector('#grade-chips button.active').dataset.grade) === '2', '设置页年级高亮切到二年级（实际 ' + (sd.querySelector('#grade-chips button.active') ? sd.querySelector('#grade-chips button.active').textContent : '无') + '）');
  chk(d.querySelector('#all-count').textContent === '7', '切到二年级上学期 → 7 首');
  chk(d.querySelectorAll('#today-list .item').length === 5, '切换后仍是 5 首计划');

  // 学期切换
  setOn('term', 2, '#seg-term button', 'term');
  chk(d.querySelector('#all-count').textContent === '7', '二年级下学期 → 7 首');

  // 学段切换：年级必须落在新学段内
  setOn('stage', 'high', '#seg-stage button', 'stage');
  chk(sd.querySelectorAll('#grade-chips button').length === 3, '设置页切高中后显示 3 个年级');
  chk(['10', '11', '12'].indexOf(String(sd.querySelector('#grade-chips button.active').dataset.grade)) > -1,
    '换学段后年级落在新学段内');
  setOn('grade', 12, '#grade-chips button', 'grade');
  chk(d.querySelector('#all-count').textContent === '14', '高三下学期 → 14 首（实际 ' + d.querySelector('#all-count').textContent + '）');

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

  // 全部诗词折叠
  d.querySelector('#btn-all').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#all-body').hidden === false, '展开全部诗词');
  // 需求：展开后箭头朝上（只旋转同一枚空心三角，不换图）
  chk(d.querySelector('#btn-all').classList.contains('open'), '展开后折叠键进入 open 态（箭头靠 CSS 旋转朝上）');
  chk(d.querySelectorAll('#all-list .item').length === 14, '高三下 14 条全部列出');
  chk(d.querySelectorAll('#stats-row .stat').length === 4, '统计条渲染 4 项');
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
  chk(sd.querySelector('#seg-stage button.active').dataset.stage === 'high', '设置页回显当前学段高中');
  chk(sd.querySelector('#seg-term button.active').dataset.term === '2', '设置页回显当前学期下学期');
  chk(sd.querySelector('#grade-chips button.active').dataset.grade === '12', '设置页回显当前年级高三');

  // 背诵范围：7 个选项，切换后计划与「全部诗词」跟随
  chk(sd.querySelectorAll('#seg-scope button').length === 7, '设置页含 7 个背诵范围选项');
  chk(sd.querySelector('#seg-scope button.active').dataset.scope === 'term', '默认选中「本册」');
  setOn('scope', 'primary', '#seg-scope button', 'scope');
  chk(sd.querySelector('#seg-scope button.active').dataset.scope === 'primary', '切换后按钮高亮跟随');
  chk(d.querySelector('#all-count').textContent === '122', '小学随机范围 → 小学 122 首（实际 ' + d.querySelector('#all-count').textContent + '）');
  chk(d.querySelector('#all-label').textContent === '小学阶段全部诗词', '面板标题跟随范围: ' + d.querySelector('#all-label').textContent);
  chk(d.querySelectorAll('#today-list .item').length === 5, '随机范围下仍按每日数量出计划');
  chk(d.querySelector('#all-list .item .item-meta').textContent.includes('年级') === false ||
    /[一二三四五六]年级/.test(d.querySelector('#all-list .item .item-meta').textContent), '随机范围下列表项标注所属年级学期');
  chk(JSON.parse(sp.window.localStorage.getItem('poem_recite_settings_v1')).scope === 'primary', '背诵范围已持久化');
  setOn('scope', 'high', '#seg-scope button', 'scope');
  chk(d.querySelector('#all-count').textContent === '69', '高中随机范围 → 高中 69 首（实际 ' + d.querySelector('#all-count').textContent + '）');
  setOn('scope', 'term', '#seg-scope button', 'scope');
  chk(d.querySelector('#all-count').textContent === '14', '切回「本册」→ 高三下 14 首');

  // 用户名：在设置整页输入后，首页标题与品牌名同步变化
  const uInput = sd.querySelector('#input-username');
  chk(uInput.value === '', '用户名初始为空（使用默认名 Ashley）');
  uInput.value = '小明';
  uInput.dispatchEvent(new sp.window.Event('input', { bubbles: true }));
  window.localStorage.setItem('poem_recite_settings_v1', sp.window.localStorage.getItem('poem_recite_settings_v1'));
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
  chk(JSON.parse(sp.window.localStorage.getItem('poem_recite_settings_v1')).username === '小明', '用户名已持久化');

  uInput.value = '   ';
  uInput.dispatchEvent(new sp.window.Event('input', { bubbles: true }));
  window.localStorage.setItem('poem_recite_settings_v1', sp.window.localStorage.getItem('poem_recite_settings_v1'));
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
  chk(!!sp.window.localStorage.getItem('poem_recite_settings_v1'), '设置已写入 localStorage');

  console.log(fails === 0 ? '\n🎉 UI 测试全部通过' : '\n❌ ' + fails + ' 项失败');
  process.exit(fails ? 1 : 0);
}, 500);
