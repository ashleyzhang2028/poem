/**
 * 匿名访问统计 / 管理页测试
 *
 * 需求 7 的验收点：
 *   1. 管理页存在，但**不被任何页面链接**，且声明 noindex —— 只有知道路径的人能进；
 *   2. 访问统计记录的内容是「匿名编号 + 日期 + 页面 + 来源域名」，
 *      不含 IP / UA / 设备指纹，也不含用户在应用里的输入与背诵内容；
 *   3. 同一设备 6 小时内只上报一次（防刷量），但本机计数每次都 +1；
 *   4. 没有配置令牌时，数据只留在本机（localStorage），不发任何外部请求；
 *   5. 两份法务条款同步披露了「匿名访问统计」，页首更新时间精确到月日。
 *
 * 运行：node test/stats.test.js
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const ROOT = __dirname + '/../';
const read = f => fs.readFileSync(ROOT + f, 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

/** 启动一个页面：seed 预置 localStorage，记录所有 fetch 调用 */
function boot(file, seed) {
  const html = read(file);
  const calls = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://local.test/' + file,
    pretendToBeVisual: true,
    beforeParse(win) {
      win.scrollTo = function () {};
      win.fetch = function (url, opts) {
        calls.push({ url: String(url), opts: opts || {} });
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
      };
    }
  });
  const w = dom.window;
  if (seed) for (const k in seed) w.localStorage.setItem(k, seed[k]);
  (html.match(/<script src="([^"]+)"><\/script>/g) || [])
    .map(x => x.match(/src="([^"]+)"/)[1])
    .forEach(f => {
      const el = w.document.createElement('script');
      el.textContent = read(f);
      w.document.body.appendChild(el);
    });
  return { w, calls, doc: w.document };
}

/* ---------- 一、管理页：只有知道路径的人能进 ---------- */
{
  chk(fs.existsSync(ROOT + 'admin.html'), '管理页 admin.html 存在');
  chk(fs.existsSync(ROOT + 'js/admin.js'), '管理页脚本 js/admin.js 存在');
  const admin = read('admin.html');
  chk(/name="robots"[^>]*noindex/.test(admin), '管理页声明 noindex / nofollow');
  chk(/name="referrer"[^>]*no-referrer/.test(admin), '管理页不外发来源地址');

  // 全站其它页面都不链接 / 不提及管理页路径
  const others = ['index.html', 'classic.html', 'terms.html', 'privacy.html',
    'js/app.js', 'js/classic.js', 'js/pwa.js', 'js/contact.js', 'sw.js', 'manifest.webmanifest'];
  const leaked = others.filter(f => /admin\s*\.html/i.test(read(f)));
  chk(leaked.length === 0, '其它页面不暴露管理页路径（' + (leaked.join(', ') || '无') + '）');
  chk(read('sw.js').indexOf('admin.html') === -1, '管理页不进离线预缓存（避免被离线清单带出来）');
}

/* ---------- 二、统计记录：只有匿名信息 ---------- */
{
  const { w, calls } = boot('admin.html');
  chk(!!w.Stats, '页面加载了匿名统计模块 window.Stats');
  chk(w.Stats.id().startsWith('v-'), '匿名编号格式正确（' + w.Stats.id() + '）');
  chk(!/^\d+$/.test(w.Stats.id().slice(2)), '匿名编号是随机的，不是设备指纹');

  setTimeout(() => {
    const queue = JSON.parse(w.localStorage.getItem('poem_stats_queue_v1') || '[]');
    chk(queue.length === 1, '首次访问记 1 条待上报记录（实际 ' + queue.length + '）');
    const rec = queue[0];
    chk(Object.keys(rec).sort().join(',') === 'date,id,page,ref',
      '记录字段只有 匿名编号/日期/页面/来源域名（' + Object.keys(rec).join(',') + '）');
    chk(!/ip|ua|agent|screen|fingerprint|name|user/i.test(Object.keys(rec).join('')),
      '记录里没有 IP / UA / 设备指纹 / 用户名等字段');
    chk(/^\d{4}-\d{2}-\d{2}$/.test(rec.date), '日期格式为 YYYY-MM-DD（' + rec.date + '）');
    chk(w.localStorage.getItem('poem_stats_local_v1') === '1', '本机访问次数累计为 1');
    chk(calls.length === 0, '未配置令牌时不发任何外部请求（实际 ' + calls.length + ' 次）');

    /* ---------- 三、同一设备 6 小时内只记一次 ---------- */
    const again = boot('admin.html', {
      poem_stats_id_v1: 'v-abcdef1234567890',
      poem_stats_local_v1: '1',
      poem_stats_queue_v1: JSON.stringify(queue),
      poem_stats_sent_v1: String(Date.now())
    });
    setTimeout(() => {
      const q2 = JSON.parse(again.w.localStorage.getItem('poem_stats_queue_v1') || '[]');
      chk(again.w.localStorage.getItem('poem_stats_local_v1') === '2', '本机计数每次访问都 +1');
      chk(q2.length === 1, '6 小时内不重复上报（待同步仍为 1 条）');
      chk(again.w.Stats.id() === 'v-abcdef1234567890', '复用本机既有的匿名编号（换页不换号）');

      /* ---------- 四、法务条款同步披露 ---------- */
      const terms = read('terms.html');
      const privacy = read('privacy.html');
      chk(/访问统计/.test(terms), '用户协议披露了访问统计');
      chk(/匿名访问/.test(terms) && /《隐私条款》/.test(terms), '用户协议指向隐私条款');
      chk(/匿名访问数|匿名访问/.test(privacy), '隐私条款写明匿名访问');
      chk(/不记录 IP/.test(privacy), '隐私条款明确不记录 IP');
      chk(/无埋点/.test(privacy) && /不记录你在背哪首诗|不记录.*背诵/.test(privacy),
        '隐私条款说明不记录用户在应用内的行为');
      // 页首是「跬步 · 更新于 <time>2026 年 9 月 12 日</time>」，两页都要精确到月日
      chk(/<time[^>]*>2026 年 \d{1,2} 月 \d{1,2} 日<\/time>/.test(terms),
        '用户协议更新时间精确到月日');
      chk(/<time[^>]*>2026 年 \d{1,2} 月 \d{1,2} 日<\/time>/.test(privacy),
        '隐私条款更新时间精确到月日');

      /* ---------- 五、统计文件与缓存 ---------- */
      const data = JSON.parse(read('data/visits.json'));
      chk(Array.isArray(data.visits), 'data/visits.json 结构正确');
      chk(data.visits.length === 0, '初始统计文件不含任何个人信息（0 条）');
      chk(read('sw.js').indexOf('./data/visits.json') !== -1, '统计文件进了离线预缓存清单');

      console.log(fails === 0 ? '\n🎉 匿名统计 / 管理页测试全部通过' : '\n❌ ' + fails + ' 项失败');
      process.exit(fails ? 1 : 0);
    }, 200);
  }, 200);
}
