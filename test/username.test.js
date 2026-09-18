const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = __dirname + '/../';
const html = fs.readFileSync(path + 'index.html', 'utf8');

const settingsHtml = fs.readFileSync(path + 'mine/index.html', 'utf8');

function bootIn(pageHtml, file, seed) {
  const dom = new JSDOM(pageHtml, { runScripts: 'dangerously', url: 'https://local.test/' + file });
  const { window } = dom;
  if (seed) {
    for (const k in seed) window.localStorage.setItem(k, seed[k]);
  }
  const order = pageHtml.match(/<script src="([^"]+)"><\/script>/g).map(s => s.match(/src="([^"]+)"/)[1]);
  order.forEach(f => {
    const el = window.document.createElement('script');
    el.textContent = fs.readFileSync(path + f, 'utf8');
    window.document.body.appendChild(el);
  });
  return new Promise(r => setTimeout(() => r({ window, d: window.document }), 400));
}

const boot = seed => bootIn(html, '', seed);

const bootSettings = seed => bootIn(settingsHtml, 'mine/', seed);

(async () => {
  let fails = 0;
  const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

  let r = await boot(null);
  chk(r.d.title === '跬步 · Ashley的背诵 · 跬步',
    '全新用户标题用默认名 Ashley（实际 ' + r.d.title + '）');

  chk(/共 5 首/.test(r.d.querySelector('#today-sub').textContent), '全新用户计划正常');

  r = await boot({ poem_recite_settings_v1: JSON.stringify({ grade: 2, term: 2, dailyCount: 3 }) });
  chk(r.d.title === '跬步 · Ashley的背诵 · 跬步', '旧版设置无 username 时不报错，用默认名 Ashley');
  chk(r.d.querySelector('#today-sub').textContent.includes('共 3 首'), '旧版设置 grade/term/count 仍生效: ' + r.d.querySelector('#today-sub').textContent);
  let s1 = await bootSettings({ poem_recite_settings_v1: JSON.stringify({ grade: 2, term: 2, dailyCount: 3 }) });
  chk(s1.d.querySelector('#input-nickname').value === '',
    '旧版设置无 username 时「我的」页那个昵称框为空（代表用默认名）');

  chk(s1.d.querySelector('#brand-name').textContent === '跬步', '设置页顶栏应用名固定为「跬步」');
  chk(/我的/.test(s1.d.querySelector('#brand-page-text').textContent),
    '「我的」页顶栏页面名为「我的」（昵称现在只在这一页改）');

  r = await boot({
    poem_recite_settings_v1: JSON.stringify({ grade: 1, term: 1, dailyCount: 5, username: '玥玥' })
  });
  chk(r.d.title === '跬步 · 玥玥的背诵 · 跬步', '刷新后标题保持（实际 ' + r.d.title + '）');

  chk(r.d.querySelector('#brand-name').textContent === '跬步', '刷新后品牌名保持为「跬步」，应用名不随用户名变');
  chk(/玥玥/.test(r.d.querySelector('#brand-page-text').textContent), '刷新后用户名仍写在「跬步」右侧');

  s1 = await bootSettings({ poem_recite_settings_v1: JSON.stringify({ grade: 1, term: 1, dailyCount: 5, username: '玥玥' }) });
  chk(s1.d.querySelector('#input-nickname').value === '玥玥',
    '刷新后「我的」页那个昵称框回填 玥玥（旧设置键仍认得出）');

  r = await boot({
    poem_recite_settings_v1: JSON.stringify({ grade: 1, term: 1, dailyCount: 5, username: '<b>坏</b>' })
  });
  const brand = r.d.querySelector('#brand-page-text');
  chk(brand.querySelectorAll('b').length === 0, '用户名不会注入 HTML（未生成 b 元素）');
  chk(r.d.title.indexOf('的背诵') > -1, '页面未崩溃且标题正常');

  chk(brand.textContent === '<b>坏</b>的背诵', '用户名按纯文本渲染（textContent 保留原始字符）');

  r = await boot({ poem_recite_settings_v1: JSON.stringify({ grade: 1, term: 1, dailyCount: 5, classicEntry: 'hide' }) });
  chk(r.d.querySelector('#classic-entry') === null, '首页已无小古文入口卡片（旧设置不再需要）');
  chk(!!r.d.querySelector('.dock-item[data-nav-go="library"]'),
    '四部集子的入口仍在底部页签「课外」上，可正常进入');
  r = await boot({ poem_recite_settings_v1: JSON.stringify({ grade: 1, term: 1, dailyCount: 5 }) });
  chk(r.d.querySelector('#classic-entry') === null, '旧版设置（无 classicEntry）下首页同样没有入口卡片');
  chk(r.d.querySelector('#today-list').querySelectorAll('.item').length === 5, '页面其余部分照常渲染');

  console.log(fails === 0 ? '\n🎉 刷新/兼容测试全部通过' : '\n❌ ' + fails + ' 项失败');
  process.exit(fails ? 1 : 0);
})();
