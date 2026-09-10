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

  chk(d.title === 'Ashley 背古诗词 · 艾宾浩斯记忆曲线', '页面标题为 Ashley 背古诗词');
  chk(d.querySelector('.brand-text h1').textContent === 'Ashley 背古诗词', '品牌标题为 Ashley 背古诗词');
  chk(d.querySelector('.foot').textContent.includes('© 2026 Ashley & Stephanie'), '页脚版权为 © 2026 Ashley & Stephanie');
  chk(!d.querySelector('.selector.card'), '年级/学期选择不再常驻首页');
  chk(!!d.querySelector('#settings-modal #seg-stage'), '学段选择已移入设置');
  chk(!!d.querySelector('#settings-modal #seg-term'), '学期选择已移入设置');
  chk(!!d.querySelector('#settings-modal #grade-chips'), '年级选择已移入设置');

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
