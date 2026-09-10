/**
 * 用户名设置专项测试（刷新持久化 / 旧版设置兼容 / 注入防护）
 *
 * 这些场景 jsdom 单页测试覆盖不到：需要「带初始 localStorage 重新启动应用」，
 * 因此这里每个用例都新起一个 JSDOM 实例。
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = __dirname + '/../';
const html = fs.readFileSync(path + 'index.html', 'utf8');

function boot(seed) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://local.test/' });
  const { window } = dom;
  if (seed) {
    for (const k in seed) window.localStorage.setItem(k, seed[k]);
  }
  const order = html.match(/<script src="([^"]+)"><\/script>/g).map(s => s.match(/src="([^"]+)"/)[1]);
  order.forEach(f => {
    const el = window.document.createElement('script');
    el.textContent = fs.readFileSync(path + f, 'utf8');
    window.document.body.appendChild(el);
  });
  return new Promise(r => setTimeout(() => r({ window, d: window.document }), 400));
}

(async () => {
  let fails = 0;
  const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

  // 1. 全新用户（无 settings）
  let r = await boot(null);
  chk(r.d.title === 'Ashley古诗词背诵 · 艾宾浩斯记忆曲线', '全新用户标题 Ashley古诗词背诵');
  chk(r.d.querySelector('#all-count').textContent === '5', '全新用户计划正常');

  // 2. 老版本设置（无 username 字段，兼容性）
  r = await boot({ poem_recite_settings_v1: JSON.stringify({ grade: 2, term: 2, dailyCount: 3 }) });
  chk(r.d.title === 'Ashley古诗词背诵 · 艾宾浩斯记忆曲线', '旧版设置无 username 时不报错，回落 Ashley');
  chk(r.d.querySelector('#today-sub').textContent.includes('共 3 首'), '旧版设置 grade/term/count 仍生效: ' + r.d.querySelector('#today-sub').textContent);
  chk(r.d.querySelector('#input-username').value === '', '旧版设置无 username 时输入框为空（代表用默认名）');

  // 3. 已有用户名 → 刷新后保持
  r = await boot({
    poem_recite_settings_v1: JSON.stringify({ grade: 1, term: 1, dailyCount: 5, username: '玥玥' })
  });
  chk(r.d.title === '玥玥古诗词背诵 · 艾宾浩斯记忆曲线', '刷新后标题保持 玥玥古诗词背诵（实际 ' + r.d.title + '）');
  chk(r.d.querySelector('#brand-name').textContent === '玥玥古诗词背诵', '刷新后品牌标题保持');
  chk(r.d.querySelector('#input-username').value === '玥玥', '刷新后输入框回填 玥玥');

  // 4. XSS 防护：用户名写入应作为纯文本
  r = await boot({
    poem_recite_settings_v1: JSON.stringify({ grade: 1, term: 1, dailyCount: 5, username: '<b>坏</b>' })
  });
  const brand = r.d.querySelector('#brand-name');
  chk(brand.querySelectorAll('b').length === 0, '用户名不会注入 HTML（未生成 b 元素）');
  chk(r.d.title.indexOf('古诗词背诵') > -1, '页面未崩溃且标题正常');
  // 用户名原样文本渲染，不被当成 HTML 解析执行
  chk(brand.textContent.indexOf('<b>坏</b>') === 0, '用户名按纯文本渲染（textContent 保留原始字符）');

  console.log(fails === 0 ? '\n🎉 刷新/兼容测试全部通过' : '\n❌ ' + fails + ' 项失败');
  process.exit(fails ? 1 : 0);
})();
