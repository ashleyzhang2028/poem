const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = __dirname + '/../';

const html = fs.readFileSync(path + 'index.html', 'utf8');
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
  chk(d.title === '跬步 · Ashley的古诗词 · 古诗词背诵',
    '用户名留空时标题用默认名 Ashley（实际 ' + d.title + '）');
  chk(d.querySelector('.brand-text h1').textContent === '跬步', '品牌标题为「跬步」');
  // 需求：顶栏第一行是「跬步 · XX的古诗词」，页面名与「跬步」同一行、同字体
  const brandPage = d.querySelector('#brand-page');
  chk(!!brandPage && /Ashley的古诗词/.test(brandPage.textContent),
    '页面名排在「跬步」右侧：' + (brandPage ? brandPage.textContent : '缺失'));
  chk(brandPage.querySelector('.brand-page-text').classList.contains('is-default'),
    '默认名 Ashley 走淡墨，与用户自己填的名字区分');
  const brandRowCss = fs.readFileSync(path + 'css/style.css', 'utf8');
  chk(/\.brand-name-row \{[\s\S]{0,200}?font-family:\s*var\(--font-poem\)/.test(brandRowCss) ||
      /--font-poem[\s\S]{0,120}?brand-name-row/.test(brandRowCss) ||
      /\.brand-name-row[\s\S]{0,80}?font-size: 19px/.test(brandRowCss),
    '页面名与「跬步」共用同一套字体样式（.brand-name-row）');
  chk(!/积跬步古诗词/.test(d.documentElement.outerHTML), '页面不出现「积跬步古诗词」旧名');
  const foot = d.querySelector('.foot');
  chk(foot.querySelector('.foot-copy').textContent.trim() === '©2026 kuibu.app 积跬步, 至千里', '页脚版权为 ©2026 kuibu.app 积跬步, 至千里（实际 ' + foot.querySelector('.foot-copy').textContent.trim() + '）');
  // 页脚需常驻两个法务入口：用户协议 / 隐私条款
  const footLinks = [...foot.querySelectorAll('.foot-links a')];
  chk(footLinks.map(a => a.textContent.trim()).join('/') === '用户协议/隐私条款', '页脚含「用户协议」「隐私条款」链接');
  chk(footLinks.map(a => a.getAttribute('href')).join('/') === './terms.html/./privacy.html', '页脚两个链接指向 terms.html 与 privacy.html');
  // 需求：删掉「一年级至高三 · 按遗忘曲线复...」这行文案
  chk(!/一年级至高三/.test(d.querySelector('.topbar').textContent),
    '顶栏第一行不再出现「一年级至高三 · 」，只有「跬步 · XX的古诗词」');
  chk(!/按遗忘曲线复习/.test(d.querySelector('.topbar').textContent),
    '顶栏不再出现「按遗忘曲线复习」长文案');
  chk(d.querySelector('#all-label').textContent === '本年级本学期全部诗词', '全部诗词标题精确为「本年级本学期全部诗词」');
  // 顶栏图标：徽标 + 全部诗词折叠图标，全部是内联 SVG
  chk(d.querySelectorAll('.brand-icon svg, .collapse-icon svg').length === 2, '顶栏徽标与全部诗词图标均为 SVG');
  // 需求：首页右上角的「设置」齿轮删除（底部第三个页签就是设置，两个入口重复）
  chk(d.querySelector('.topbar #btn-settings') === null, '首页右上角不再有设置齿轮（交给底部页签）');
  chk(d.querySelector('.topbar .icon-btn') === null, '顶栏不再有圆形图标按钮（设置入口已删）');

  /* ---------- 导航：顶栏 + 底部三页签（本次重做） ---------- */
  chk(!!d.querySelector('.topbar .brand-icon svg'), '顶栏有 logo（内联 SVG 徽标）');
  chk(d.querySelector('#brand-name').textContent === '跬步', '顶栏第一行固定为「跬步」，不随页面变化');
  const dock = d.querySelector('#site-dock');
  chk(!!dock, '首页有底部导航栏');
  const dockItems = [...dock.querySelectorAll('.dock-item')];
  chk(dockItems.length === 3, '底部导航为三个页签（实际 ' + dockItems.length + '）');
  chk(dockItems.map(b => b.querySelector('.dock-label').textContent).join('/') === '古诗词/小古文/设置',
    '页签名称为 古诗词 / 小古文 / 设置');
  chk(dockItems.map(b => b.dataset.navGo).join('/') === 'home/classic/settings', '页签跳转目标正确');
  chk(dockItems[0].classList.contains('active') && dockItems[0].getAttribute('aria-current') === 'page',
    '当前页（古诗词）页签为选中态');
  chk(dockItems.every(b => b.querySelector('.dock-icon svg')), '三个页签图标均为内联 SVG');
  // 页面切换统一走底部页签，顶栏不再各页一套返回键
  chk(d.querySelector('.topbar .back-icon') === null, '顶栏不再有各页自造的返回箭头');
  chk(!!dock.querySelector('[data-nav-go="settings"]'), '「设置」是页签之一，不再只藏在右上角');
  chk(!/📖|⚙|📚/.test(d.querySelector('.app').innerHTML), '页面不再使用 📖 ⚙️ 📚 emoji 图标');
  chk(!!d.querySelector('#settings-modal #input-username'), '设置内含用户名输入框');
  chk(!d.querySelector('.selector.card'), '年级/学期选择不再常驻首页');
  chk(!!d.querySelector('#settings-modal #seg-stage'), '学段选择已移入设置');
  chk(!!d.querySelector('#settings-modal #seg-term'), '学期选择已移入设置');
  chk(!!d.querySelector('#settings-modal #grade-chips'), '年级选择已移入设置');
  // 需求：首页下方的「小古文」入口卡片删除（底部页签已承担入口，卡片重复）
  chk(d.querySelector('#classic-entry') === null, '首页不再有小古文入口卡片');
  chk(d.querySelector('.classic-entry') === null, '首页不再有小古文入口卡片（classic-entry 已删）');
  chk(d.querySelector('#classic-title') === null && d.querySelector('.classic-title') === null,
    '不再渲染小古文入口标题');
  chk(d.querySelector('#seg-classic-entry') === null, '设置里不再有「首页小古文入口」选项（入口已删）');
  chk(!/首页小古文入口/.test(d.querySelector('#settings-modal').textContent),
    '设置面板文案里不再出现「首页小古文入口」');
  chk(d.querySelector('#all-count').textContent === '5', '小古文不会混进古诗词列表（仍为 5 首）');
  // 底部页签的「小古文」仍是唯一入口，指向独立页面
  const dockClassicCount = [...dock.querySelectorAll('.dock-item')].filter(b => b.dataset.navGo === 'classic').length;
  chk(dockClassicCount === 1, '小古文入口只剩底部页签一处');

  // 先打开设置才能操作年级/学期；入口只剩底部页签的「设置」
  d.querySelector('.dock-item[data-nav-go="settings"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#settings-modal').hidden === false, '底部页签「设置」能打开设置面板');
  d.querySelector('[data-close]').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelectorAll('#grade-chips button').length === 6, '小学显示 6 个年级按钮');
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

  // 年级切换
  const g2 = [...d.querySelectorAll('#grade-chips button')].find(b => b.textContent === '二年级');
  g2.dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#all-count').textContent === '7', '切到二年级上学期 → 7 首');
  chk(d.querySelectorAll('#today-list .item').length === 5, '切换后仍是 5 首计划');

  // 学期切换
  const t2 = [...d.querySelectorAll('#seg-term button')].find(b => b.dataset.term === '2');
  t2.dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#all-count').textContent === '7', '二年级下学期 → 7 首');

  // 学段切换
  const high = [...d.querySelectorAll('#seg-stage button')].find(b => b.dataset.stage === 'high');
  high.dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelectorAll('#grade-chips button').length === 3, '高中显示 3 个年级');
  const g3b = [...d.querySelectorAll('#grade-chips button')].find(b => b.textContent === '高三');
  g3b.dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#all-count').textContent === '14', '高三下学期 → 14 首（实际 ' + d.querySelector('#all-count').textContent + '）');

  /* 需求：古诗词详情页与小古文详情页功能对齐（对齐 / 字号 / 译文 / 播放组合键）。
     先单独验一遍，验完把页面状态恢复成「高三下」，不干扰后面的断言。 */
  {
    const gradeChip = g => [...d.querySelectorAll('#grade-chips button')].find(b => b.textContent === g);
    const openSettings = () => d.querySelector('.dock-item[data-nav-go="settings"]')
      .dispatchEvent(new window.Event('click', { bubbles: true }));
    const toGrade = (grade) => {
      openSettings();
      gradeChip(grade).dispatchEvent(new window.Event('click', { bubbles: true }));
      d.querySelector('#settings-modal').hidden = true;
    };
    // 二年级属于小学学段，先把学段切回小学再选年级
    d.querySelector('.dock-item[data-nav-go="settings"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    [...d.querySelectorAll('#seg-stage button')].find(b => b.dataset.stage === 'primary')
      .dispatchEvent(new window.Event('click', { bubbles: true }));
    d.querySelector('#settings-modal').hidden = true;
    toGrade('二年级'); // 二年级诗篇有白话译文

    d.querySelector('#today-list .item').dispatchEvent(new window.Event('click', { bubbles: true }));
    chk(d.querySelectorAll('#m-actions-main > *').length === 3, '详情页第一行：对齐 / 字号 / 注音 三组');
    chk(d.querySelectorAll('#m-actions-icons > *').length === 2, '详情页第二行：播放组合键 + 译文开关');
    chk(!/暂未收录/.test(d.querySelector('#m-trans-text').textContent),
      '带译文的诗篇显示白话译文：' + d.querySelector('#m-trans-text').textContent.slice(0, 12) + '…');
    d.querySelector('#m-trans-toggle').dispatchEvent(new window.Event('click', { bubbles: true }));
    chk(d.querySelector('#m-trans').hidden === false, '点译文图标展开白话译文');
    chk(d.querySelectorAll('[id="m-trans-text"]').length === 1, '译文段落 id 唯一（不重蹈重复 id 的覆辙）');
    chk(d.querySelector('#m-trans-text').textContent.length > 10, '译文内容非空');

    chk(d.querySelector('#m-text').style.fontSize === '17px',
      '古诗正文默认字号小一号 17px（实际 ' + d.querySelector('#m-text').style.fontSize + '）');
    d.querySelector('#m-font-up').dispatchEvent(new window.Event('click', { bubbles: true }));
    chk(d.querySelector('#m-text').style.fontSize === '19px', 'A＋ 放大一级');
    d.querySelector('#m-font-down').dispatchEvent(new window.Event('click', { bubbles: true }));
    chk(d.querySelector('#m-text').style.fontSize === '17px', 'A－ 收小一级');

    d.querySelector('#m-align-seg button[data-align="left"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    chk(d.querySelector('#m-text').dataset.align === 'left', '切到左对齐生效');
    chk(window.localStorage.getItem('poem_align_v1') === 'left', '对齐方式已持久化');
    d.querySelector('#m-align-seg button[data-align="center"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    chk(d.querySelector('#m-text').dataset.align === 'center', '切回居中对齐');
    d.querySelector('[data-close]').dispatchEvent(new window.Event('click', { bubbles: true }));

    d.querySelector('.dock-item[data-nav-go="settings"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    [...d.querySelectorAll('#seg-stage button')].find(b => b.dataset.stage === 'high')
      .dispatchEvent(new window.Event('click', { bubbles: true }));
    d.querySelector('#settings-modal').hidden = true;
    toGrade('高三');
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
  chk(d.querySelectorAll('#all-list .item').length === 14, '高三下 14 条全部列出');
  chk(d.querySelectorAll('#stats-row .stat').length === 4, '统计条渲染 4 项');
  // 需求：详情页工具条与小古文对齐一致；标签行、按钮整行居中，底部不被页签压住
  chk(d.querySelectorAll('#m-actions-main > *').length === 3, '详情页第一行：对齐 / 字号 / 注音 三组');
  chk(d.querySelectorAll('#m-actions-icons > *').length === 2, '详情页第二行：播放组合键 + 译文开关');
  chk(d.querySelectorAll('#m-read-combo .combo-seg').length === 2, '朗读是「原文 / 译文」组合键');
  chk(d.querySelector('#m-trans') !== null && d.querySelector('#m-trans-text') !== null,
    '详情页有白话译文区');

  // 设置
  d.querySelector('#settings-modal').hidden = true;
  d.querySelector('.dock-item[data-nav-go="settings"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#settings-modal').hidden === false, '设置弹层打开');
  chk(d.querySelector('#settings-modal #seg-stage').querySelector('button.active').dataset.stage === 'high', '设置中回显当前学段高中');

  // 背诵范围：7 个选项，切换后计划与「全部诗词」跟随
  chk(d.querySelectorAll('#seg-scope button').length === 7, '设置内含 7 个背诵范围选项');
  chk(d.querySelector('#seg-scope button.active').dataset.scope === 'term', '默认选中「本册」');
  const scopeBtn = k => [...d.querySelectorAll('#seg-scope button')].find(b => b.dataset.scope === k);
  scopeBtn('primary').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#seg-scope button.active').dataset.scope === 'primary', '切换后按钮高亮跟随');
  chk(d.querySelector('#all-count').textContent === '91', '小学随机范围 → 小学 91 首（实际 ' + d.querySelector('#all-count').textContent + '）');
  chk(d.querySelector('#all-label').textContent === '小学阶段全部诗词', '面板标题跟随范围: ' + d.querySelector('#all-label').textContent);
  chk(d.querySelectorAll('#today-list .item').length === 5, '随机范围下仍按每日数量出计划');
  chk(d.querySelector('#all-list .item .item-meta').textContent.includes('年级') === false ||
    /[一二三四五六]年级/.test(d.querySelector('#all-list .item .item-meta').textContent), '随机范围下列表项标注所属年级学期');
  chk(JSON.parse(window.localStorage.getItem('poem_recite_settings_v1')).scope === 'primary', '背诵范围已持久化');
  scopeBtn('high').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#all-count').textContent === '69', '高中随机范围 → 高中 69 首（实际 ' + d.querySelector('#all-count').textContent + '）');
  scopeBtn('term').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#all-count').textContent === '14', '切回「本册」→ 高三下 14 首');

  // 用户名：输入后页面标题与品牌标题同步变化
  const uInput = d.querySelector('#input-username');
  chk(uInput.value === '', '用户名初始为空（使用默认名）');
  uInput.value = '小明';
  uInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  chk(d.title === '跬步 · 小明的古诗词 · 古诗词背诵', '填了用户名后标题为「跬步 · 小明的古诗词」（实际 ' + d.title + '）');
  // 顶栏第一行固定为应用名（不随用户名变），用户名只出现在页面标题与第二行里，
  // 否则进了小古文 / 法务页顶栏也跟着改名，用户认不出自己在哪一页
  chk(d.querySelector('.brand-text h1').textContent === '跬步', '顶栏第一行固定为「跬步」，不随用户名变化');
  chk(/小明/.test(d.querySelector('#brand-page').textContent),
    '页面名跟着用户名走：' + d.querySelector('#brand-page').textContent);
  chk(!d.querySelector('#brand-page-text').classList.contains('is-default'),
    '填了用户名后不再走淡墨（是自己填的名字）');
  chk(d.querySelector('meta[name="apple-mobile-web-app-title"]').getAttribute('content') === '跬步 · 小明的古诗词',
    'iOS 桌面名随用户名变化');
  chk(JSON.parse(window.localStorage.getItem('poem_recite_settings_v1')).username === '小明', '用户名已持久化');

  uInput.value = '   ';
  uInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  chk(d.title === '跬步 · Ashley的古诗词 · 古诗词背诵',
    '用户名留空时回到默认名 Ashley（实际 ' + d.title + '）');
  const c8 = [...d.querySelectorAll('#seg-count button')].find(b => b.dataset.count === '8');
  c8.dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#today-sub').textContent.includes('共 8 首'), '改为每日 8 首生效: ' + d.querySelector('#today-sub').textContent);
  // 需求 4：统计文案去掉「首」后缀，避免换行 →「共 N 首 · 待复习 N · 新学 N」
  chk(/^共 \d+ 首 · 待复习 \d+ · 新学 \d+$/.test(d.querySelector('#today-sub').textContent),
    '今日统计精简为「共 N 首 · 待复习 N · 新学 N」（实际 ' + d.querySelector('#today-sub').textContent + '）');
  chk(!/待复习 \d+ 首/.test(d.querySelector('#today-sub').textContent), '待复习数字后不再带「首」');
  chk(d.querySelectorAll('#today-list .item').length === 8, '今日列表变为 8 首');

  // 持久化
  chk(!!window.localStorage.getItem('poem_recite_progress_v1'), '进度已写入 localStorage');
  chk(!!window.localStorage.getItem('poem_recite_settings_v1'), '设置已写入 localStorage');

  console.log(fails === 0 ? '\n🎉 UI 测试全部通过' : '\n❌ ' + fails + ' 项失败');
  process.exit(fails ? 1 : 0);
}, 500);
