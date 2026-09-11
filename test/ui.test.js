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

  chk(d.title === 'Ashley古诗词 · 遗忘曲线记忆法', '页面标题为 Ashley古诗词（实际 ' + d.title + '）');
  chk(d.querySelector('.brand-text h1').textContent === 'Ashley古诗词', '品牌标题为 Ashley古诗词');
  const foot = d.querySelector('.foot');
  chk(foot.querySelector('.foot-copy').textContent.trim() === '©2026 kuibu.app 积跬步, 至千里', '页脚版权为 ©2026 kuibu.app 积跬步, 至千里（实际 ' + foot.querySelector('.foot-copy').textContent.trim() + '）');
  // 页脚需常驻两个法务入口：用户协议 / 隐私条款
  const footLinks = [...foot.querySelectorAll('.foot-links a')];
  chk(footLinks.map(a => a.textContent.trim()).join('/') === '用户协议/隐私条款', '页脚含「用户协议」「隐私条款」链接');
  chk(footLinks.map(a => a.getAttribute('href')).join('/') === './terms.html/./privacy.html', '页脚两个链接指向 terms.html 与 privacy.html');
  chk(d.querySelector('.brand-text p').textContent === '一年级至高三 · 遗忘曲线记忆法', '副标题为「一年级至高三 · 遗忘曲线记忆法」');
  chk(d.querySelector('#all-label').textContent === '本年级本学期全部诗词', '全部诗词标题精确为「本年级本学期全部诗词」');
  // 除 😵🤔😄 外，页面图标应为内联 SVG
  chk(d.querySelectorAll('.brand-icon svg, #btn-settings svg, .collapse-icon svg').length === 3, '顶部/设置/全部诗词图标均为 SVG');
  chk(!/📖|⚙|📚/.test(d.querySelector('.app').innerHTML), '页面不再使用 📖 ⚙️ 📚 emoji 图标');
  chk(!!d.querySelector('#settings-modal #input-username'), '设置内含用户名输入框');
  chk(!d.querySelector('.selector.card'), '年级/学期选择不再常驻首页');
  chk(!!d.querySelector('#settings-modal #seg-stage'), '学段选择已移入设置');
  chk(!!d.querySelector('#settings-modal #seg-term'), '学期选择已移入设置');
  chk(!!d.querySelector('#settings-modal #grade-chips'), '年级选择已移入设置');
  // 课外必背小古文入口：独立页面，不进每日计划
  const entry = d.querySelector('#classic-entry');
  chk(!!entry, '首页有「课外必背小古文」入口');
  chk(entry.getAttribute('href') === './classic.html', '入口指向 classic.html');
  chk(/100 篇/.test(entry.textContent), '入口标明 100 篇：' + entry.textContent.replace(/\s+/g, ' ').trim());
  chk(d.querySelector('#all-count').textContent === '5', '小古文不会混进古诗词列表（仍为 5 首）');

  // 先打开设置才能操作年级/学期
  d.querySelector('#btn-settings').dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#settings-modal').hidden === false, '首页即可打开设置');
  chk(d.querySelectorAll('#grade-chips button').length === 6, '小学显示 6 个年级按钮');
  chk(d.querySelectorAll('#today-list .item').length === 5, '今日列表渲染 5 首（实际 ' + d.querySelectorAll('#today-list .item').length + '）');
  chk(d.querySelector('#ring-text').textContent === '0/5', '环形进度 0/5');
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

  // 设置
  d.querySelector('#settings-modal').hidden = true;
  d.querySelector('#btn-settings').dispatchEvent(new window.Event('click', { bubbles: true }));
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
  chk(d.title === '小明古诗词 · 遗忘曲线记忆法', '页面标题随用户名变化: ' + d.title);
  chk(d.querySelector('.brand-text h1').textContent === '小明古诗词', '品牌标题随用户名变化');
  chk(d.querySelector('meta[name="apple-mobile-web-app-title"]').getAttribute('content') === '小明古诗词',
    'iOS 桌面名随用户名变化');
  chk(JSON.parse(window.localStorage.getItem('poem_recite_settings_v1')).username === '小明', '用户名已持久化');

  uInput.value = '   ';
  uInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  chk(d.title === 'Ashley古诗词 · 遗忘曲线记忆法', '留空回退默认名 Ashley（实际 ' + d.title + '）');
  const c8 = [...d.querySelectorAll('#seg-count button')].find(b => b.dataset.count === '8');
  c8.dispatchEvent(new window.Event('click', { bubbles: true }));
  chk(d.querySelector('#today-sub').textContent.includes('共 8 首'), '改为每日 8 首生效: ' + d.querySelector('#today-sub').textContent);
  chk(d.querySelectorAll('#today-list .item').length === 8, '今日列表变为 8 首');

  // 持久化
  chk(!!window.localStorage.getItem('poem_recite_progress_v1'), '进度已写入 localStorage');
  chk(!!window.localStorage.getItem('poem_recite_settings_v1'), '设置已写入 localStorage');

  console.log(fails === 0 ? '\n🎉 UI 测试全部通过' : '\n❌ ' + fails + ' 项失败');
  process.exit(fails ? 1 : 0);
}, 500);
