const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = __dirname + '/../';

const html = fs.readFileSync(path + 'index.html', 'utf8');
// 设置已从「首页弹层」改为独立整页，页脚（版权 + 法务链接）也搬到了这一页
const settingsHtml = fs.readFileSync(path + 'settings.html', 'utf8');
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

setTimeout(async () => {
  const d = window.document;
  let fails = 0;
  const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

  // 需求 9：应用正式名称为「跬步」，不随用户名变化
  chk(d.title === '跬步 · 古诗词背诵', '页面标题为「跬步 · 古诗词背诵」（实际 ' + d.title + '）');
  chk(d.querySelector('.brand-text h1').textContent === '跬步', '品牌标题为「跬步」');
  chk(!/积跬步古诗词/.test(d.documentElement.outerHTML), '页面不出现「积跬步古诗词」旧名');
  // 需求：版权 + 用户协议 / 隐私条款 从首页挪到设置页底部
  chk(d.querySelector('.app > .foot') === null, '首页不再有页脚（版权与法务链接已挪到设置页）');
  const settingsDom = new JSDOM(settingsHtml, { runScripts: 'dangerously', url: 'https://local.test/settings.html' });
  const sw2 = settingsDom.window;
  settingsHtml.match(/<script src="([^"]+)"><\/script>/g)
    .map(x => x.match(/src="([^"]+)"/)[1])
    .forEach(f => {
      const el = sw2.document.createElement('script');
      el.textContent = fs.readFileSync(path + f, 'utf8');
      sw2.document.body.appendChild(el);
    });
  // jsdom 解析完 settings.html 后 DOMContentLoaded 已经触发过，
  // 注入脚本后需要手动补一次，页面逻辑才会初始化
  sw2.document.dispatchEvent(new sw2.Event('DOMContentLoaded', { bubbles: true }));
  const sd = sw2.document;
  const foot = sd.querySelector('.settings-foot');
  chk(!!foot, '设置页有页脚');
  chk(foot.querySelector('.foot-copy').textContent.trim() === '©2026 kuibu.app 积跬步, 至千里', '页脚版权为 ©2026 kuibu.app 积跬步, 至千里（实际 ' + foot.querySelector('.foot-copy').textContent.trim() + '）');
  // 页脚需常驻两个法务入口：用户协议 / 隐私条款
  const footLinks = [...foot.querySelectorAll('.foot-links a')];
  chk(footLinks.map(a => a.textContent.trim()).join('/') === '用户协议/隐私条款', '页脚含「用户协议」「隐私条款」链接');
  chk(footLinks.map(a => a.getAttribute('href')).join('/') === './terms.html/./privacy.html', '页脚两个链接指向 terms.html 与 privacy.html');
  // 页脚必须排在设置项之后（页面最底部）
  const page = sd.querySelector('.settings-page');
  chk(!!page && !!(page.compareDocumentPosition(foot) & window.Node.DOCUMENT_POSITION_FOLLOWING),
    '页脚位于设置项下方（页面底部）');
  chk(d.querySelector('.brand-text p').textContent === '一年级至高三 · 按遗忘曲线复习', '副标题简洁明了（实际 ' + d.querySelector('.brand-text p').textContent + '）');
  chk(d.querySelector('#all-label').textContent === '本年级本学期全部诗词', '全部诗词标题精确为「本年级本学期全部诗词」');
  // 除 😵🤔😄 外，页面图标应为内联 SVG
  chk(d.querySelectorAll('.brand-icon svg, #btn-settings svg, .collapse-icon svg').length === 3, '顶部/设置/全部诗词图标均为 SVG');
  chk(!/📖|⚙|📚/.test(d.querySelector('.app').innerHTML), '页面不再使用 📖 ⚙️ 📚 emoji 图标');
  chk(!d.querySelector('#settings-modal'), '首页不再有「向上弹出的设置卡片」');
  chk(!d.querySelector('.selector.card'), '年级/学期选择不再常驻首页');
  // 设置整页：齿轮是普通链接，点开是全新页面而不是弹层
  const gear = d.querySelector('#btn-settings');
  chk(gear.tagName === 'A' && gear.getAttribute('href') === './settings.html',
    '首页齿轮是跳转设置页的链接（实际 ' + gear.tagName + ' ' + gear.getAttribute('href') + '）');
  chk(sd.querySelectorAll('#seg-stage button').length === 3, '设置页含学段选择');
  chk(sd.querySelectorAll('#seg-term button').length === 2, '设置页含学期选择');
  chk(sd.querySelectorAll('#grade-chips button').length === 6, '设置页含年级选择（默认小学 6 个）');
  chk(!!sd.querySelector('#input-username'), '设置页含用户名输入框');
  chk(sd.querySelector('#brand-name').textContent === '跬步', '设置页顶部标题为「跬步」（跟随用户名前缀）');
  // 小古文入口：独立页面，不进每日计划，位置在「本年级本学期全部诗词」之后
  const entry = d.querySelector('#classic-entry');
  chk(!!entry, '首页有「小古文」入口');
  chk(entry.getAttribute('href') === './classic.html', '入口指向 classic.html');
  chk(d.querySelector('.classic-title').textContent === '小古文', '入口主标题为「小古文」');
  chk(!/课外必背/.test(entry.textContent), '入口不再出现「课外必背」字样');
  chk(/100 篇/.test(entry.textContent), '入口标明 100 篇：' + entry.textContent.replace(/\s+/g, ' ').trim());
  // 需求 3：入口不再出现「《三字经》《世说新语》等 100 篇 · 可注音朗读，不排复习」这类解释性长文案
  chk(!/三字经|世说新语|不排复习|注音朗读/.test(entry.textContent), '入口文案精简，不再罗列书名与说明');
  chk(d.querySelector('#all-count').textContent === '5', '小古文不会混进古诗词列表（仍为 5 首）');
  // 位置：全部诗词面板（.all-section）在前，小古文入口紧跟其后
  const allSection = d.querySelector('.all-section');
  chk(!!allSection && allSection.compareDocumentPosition(entry) & window.Node.DOCUMENT_POSITION_FOLLOWING,
    '小古文入口位于「本年级本学期全部诗词」面板下方');

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

  // 打开诗词详情弹层：点条目 → 显示内容 → 评价 → 进度更新
  const item = d.querySelector('#today-list .item');
  item.dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#modal').hidden === false, '点击后弹层打开');
  chk(d.querySelector('#m-title').textContent.length > 0, '弹层显示标题: ' + d.querySelector('#m-title').textContent);
  chk(d.querySelector('#m-author').textContent.length > 0, '显示作者: ' + d.querySelector('#m-author').textContent);
  chk(d.querySelector('#m-dynasty').textContent.includes('〔'), '显示朝代: ' + d.querySelector('#m-dynasty').textContent);
  chk(d.querySelector('#m-text').textContent.trim().length > 0, '显示正文');

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

  // 全部诗词折叠面板
  d.querySelector('#btn-all').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#all-body').hidden === false, '展开全部诗词');
  chk(d.querySelectorAll('#stats-row .stat').length === 4, '统计条渲染 4 项');
  chk(!!window.localStorage.getItem('poem_recite_progress_v1'), '背诵进度已写入 localStorage');

  // 学段 / 年级 / 学期的切换现在发生在设置整页：改完写同一份 localStorage，
  // 回到首页（重新读一次设置）时计划与「全部诗词」应当跟随
  const bootHome = seed => {
    const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://local.test/' });
    const w2 = dom.window;
    for (const k in seed) w2.localStorage.setItem(k, seed[k]);
    scriptOrder.forEach(f => {
      const el = w2.document.createElement('script');
      el.textContent = fs.readFileSync(path + f, 'utf8');
      w2.document.body.appendChild(el);
    });
    return new Promise(r => setTimeout(() => r(w2), 400));
  };
  const state = which => {
    const seg = which === 'stage' ? sd.querySelector('#seg-stage button.active')
      : which === 'term' ? sd.querySelector('#seg-term button.active')
      : sd.querySelector('#grade-chips button.active');
    if (!seg) return '(无高亮)';
    return seg.dataset[which] || seg.textContent;
  };
  const clickSettings = (sel, key, value) => {
    const b = [...sd.querySelectorAll(sel)].find(x => String(x.dataset[key]) === String(value));
    b.dispatchEvent(new sw2.Event('click', { bubbles: true }));
    return b;
  };
  /** 设置页写下的设置（每个 JSDOM 实例有各自的 localStorage，需显式搬运） */
  const stored = () => sw2.localStorage.getItem('poem_recite_settings_v1');

  // 年级切换（一年级 → 二年级）后回首页：7 首
  clickSettings('#grade-chips button', 'grade', 2);
  chk(String(state('grade')) === '2', '设置页年级高亮切到二年级（实际 ' + state('grade') + '）');
  let home = await bootHome({ poem_recite_settings_v1: stored() });
  chk(home.document.querySelector('#all-count').textContent === '7', '二年级上学期 → 7 首');
  chk(home.document.querySelectorAll('#today-list .item').length === 5, '切换后仍是 5 首计划');

  // 学期切换（上学期 → 下学期）
  clickSettings('#seg-term button', 'term', 2);
  home = await bootHome({ poem_recite_settings_v1: stored() });
  chk(home.document.querySelector('#all-count').textContent === '7', '二年级下学期 → 7 首');

  // 学段切换：小学 → 高中，年级按钮随之变成 3 个，且不会停在「高中 · 一年级」
  clickSettings('#seg-stage button', 'stage', 'high');
  chk(sd.querySelectorAll('#grade-chips button').length === 3, '设置页切到高中后显示 3 个年级');
  chk(state('stage') === 'high', '设置页学段高亮切到高中');
  chk(['10', '11', '12'].indexOf(String(state('grade'))) > -1, '换学段后年级落在新学段内（实际 ' + state('grade') + '）');
  clickSettings('#grade-chips button', 'grade', 12);
  home = await bootHome({ poem_recite_settings_v1: stored() });
  chk(home.document.querySelector('#all-count').textContent === '14', '高三下学期 → 14 首（实际 ' + home.document.querySelector('#all-count').textContent + '）');

  // 背诵范围：7 个选项，切换后高亮跟随并落到 localStorage
  chk(sd.querySelectorAll('#seg-scope button').length === 7, '设置页含 7 个背诵范围选项');
  chk(sd.querySelector('#seg-scope button.active').dataset.scope === 'term', '默认选中「本册」');
  clickSettings('#seg-scope button', 'scope', 'primary');
  chk(sd.querySelector('#seg-scope button.active').dataset.scope === 'primary', '切换后按钮高亮跟随');
  chk(JSON.parse(stored()).scope === 'primary', '背诵范围已持久化');
  home = await bootHome({ poem_recite_settings_v1: stored() });
  chk(home.document.querySelector('#all-count').textContent === '91', '小学随机范围 → 小学 91 首（实际 ' + home.document.querySelector('#all-count').textContent + '）');
  chk(home.document.querySelector('#all-label').textContent === '小学阶段全部诗词', '面板标题跟随范围: ' + home.document.querySelector('#all-label').textContent);
  chk(home.document.querySelectorAll('#today-list .item').length === 5, '随机范围下仍按每日数量出计划');
  chk(home.document.querySelector('#all-list .item .item-meta').textContent.includes('年级') === false ||
    /[一二三四五六]年级/.test(home.document.querySelector('#all-list .item .item-meta').textContent), '随机范围下列表项标注所属年级学期');
  clickSettings('#seg-scope button', 'scope', 'high');
  home = await bootHome({ poem_recite_settings_v1: stored() });
  chk(home.document.querySelector('#all-count').textContent === '69', '高中随机范围 → 高中 69 首（实际 ' + home.document.querySelector('#all-count').textContent + '）');
  clickSettings('#seg-scope button', 'scope', 'term');
  home = await bootHome({ poem_recite_settings_v1: stored() });
  chk(home.document.querySelector('#all-count').textContent === '14', '切回「本册」→ 高三下 14 首');

  // 用户名：设置页输入后持久化，首页标题与品牌标题同步变化
  const sInput = sd.querySelector('#input-username');
  chk(sInput.value === '', '用户名初始为空（使用默认名）');
  sInput.value = '小明';
  sInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  chk(sd.querySelector('#brand-name').textContent === '跬步 · 小明的古诗词', '设置页品牌标题跟随用户名');
  chk(JSON.parse(stored()).username === '小明', '用户名已持久化');
  home = await bootHome({ poem_recite_settings_v1: stored() });
  chk(home.document.title === '跬步 · 小明的古诗词 · 古诗词背诵', '填了用户名后首页标题为「跬步 · 小明的古诗词」（实际 ' + home.document.title + '）');
  chk(home.document.querySelector('.brand-text h1').textContent === '跬步 · 小明的古诗词', '首页品牌标题跟随用户名，前缀固定为跬步');
  chk(home.document.querySelector('meta[name="apple-mobile-web-app-title"]').getAttribute('content') === '跬步 · 小明的古诗词',
    'iOS 桌面名随用户名变化');

  sInput.value = '   ';
  sInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  chk(sd.querySelector('#brand-name').textContent === '跬步', '用户名留空时设置页回到「跬步」');

  // 每日背诵数量：设置页改为 8 首 → 首页计划跟随
  clickSettings('#seg-count button', 'count', 8);
  chk(JSON.parse(stored()).dailyCount === 8, '每日数量已持久化');
  home = await bootHome({ poem_recite_settings_v1: stored() });
  chk(home.document.querySelector('#today-sub').textContent.includes('共 8 首'), '改为每日 8 首生效: ' + home.document.querySelector('#today-sub').textContent);
  // 需求 4：统计文案去掉「首」后缀，避免换行 →「共 N 首 · 待复习 N · 新学 N」
  chk(/^共 \d+ 首 · 待复习 \d+ · 新学 \d+$/.test(home.document.querySelector('#today-sub').textContent),
    '今日统计精简为「共 N 首 · 待复习 N · 新学 N」（实际 ' + home.document.querySelector('#today-sub').textContent + '）');
  chk(!/待复习 \d+ 首/.test(home.document.querySelector('#today-sub').textContent), '待复习数字后不再带「首」');
  chk(home.document.querySelectorAll('#today-list .item').length === 8, '今日列表变为 8 首');

  // 持久化：进度由首页写、设置由设置页写（上面各自已断言）
  home = await bootHome({ poem_recite_settings_v1: stored() });
  chk(!!home.localStorage.getItem('poem_recite_settings_v1'), '设置已写入 localStorage');

  // 设置整页：页面自带返回入口，配置项完整，底部有法务链接
  chk(sd.querySelectorAll('#seg-helper button').length === 2, '设置页含「阅读辅助」开关');
  chk(sd.querySelectorAll('#seg-classic-entry button').length === 2, '设置页含「首页小古文入口」开关');
  chk(sd.querySelectorAll('#seg-count button').length === 4, '设置页含 4 档每日数量');
  chk(sd.querySelectorAll('.settings-btns button').length === 3, '设置页含导出 / 导入 / 清空三个数据按钮');
  chk(/<a[^>]+href="\.\/index\.html"/.test(settingsHtml), '设置页顶部是返回首页的链接（不是弹层的 ✕）');
  chk(!!sd.querySelector('.settings-tip'), '设置页保留复习间隔说明');

  // 设置页与首页共用同一份 localStorage 键名，字段一致
  const storedSettings = JSON.parse(stored());
  chk(Object.keys(storedSettings).sort().join(',') ===
    ['classicEntry', 'dailyCount', 'grade', 'helper', 'scope', 'term', 'username'].join(','),
    '设置页写入的字段与首页一致：' + Object.keys(storedSettings).sort().join(','));

  // 阅读辅助 / 小古文入口开关写进同一份设置，首页据此生效
  clickSettings('#seg-helper button', 'helper', 'on');
  chk(JSON.parse(stored()).helper === 'on', '阅读辅助开关已持久化');
  clickSettings('#seg-classic-entry button', 'entry', 'hide');
  chk(JSON.parse(stored()).classicEntry === 'hide', '小古文入口隐藏已持久化');
  home = await bootHome({ poem_recite_settings_v1: stored() });
  chk(home.document.querySelector('#classic-entry').hidden === true, '设置为隐藏后首页小古文入口消失');

  console.log(fails === 0 ? '\n🎉 UI 测试全部通过' : '\n❌ ' + fails + ' 项失败');
  process.exit(fails ? 1 : 0);
}, 500);
