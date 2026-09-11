/**
 * iOS / 多端兼容测试
 *
 * 需要真实浏览器（puppeteer），因此单独一个文件，不放进 test/run.sh 的默认流程。
 * 运行：node test/pwa.test.js       （先执行 node scripts/serve.js 起服务）
 * 可用环境变量 BASE_URL 指定地址，默认 http://localhost:8080/
 */
let puppeteer;
try {
  puppeteer = require("puppeteer");
} catch (e) {
  console.log("跳过 PWA 测试（未安装 puppeteer：npm i -D puppeteer）");
  process.exit(0);
}

const { browserAvailable } = require("./pwa-env");

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const WECHAT_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49';

const results = {};
let failures = 0;

function check(name, cond, extra) {
  const ok = !!cond;
  if (!ok) failures++;
  results[name] = (ok ? '✓' : '✗') + (extra ? ' ' + extra : '');
}

(async () => {
  // 环境缺库（如 libnspr4.so / libatk-1.0.so.0）时 Chrome 无法启动，属于环境问题
  // 而非代码回归，跳过而不是报错。CI 请用 image/Dockerfile 预装依赖。
  if (!(await browserAvailable())) {
    console.log("跳过 PWA 测试（当前环境无法启动 Chrome，通常是缺少系统库 libnspr4 / libnss3 / libatk）");
    process.exit(0);
  }

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  const base = process.env.BASE_URL || 'http://localhost:8080/';
  // 每个场景一个全新上下文，保证 localStorage / SW 互不干扰
  const freshPage = async () => {
    const ctx = await browser.createBrowserContext();
    return { ctx, page: await ctx.newPage() };
  };

  /* ============ iPhone Safari ============ */
  {
    const { page } = await freshPage();
    await page.setUserAgent(IPHONE_UA);
    await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => {
      if (m.type() !== 'error') return;
      const t = m.text();
      // 离线场景下 SW 预缓存请求被中断会打印 error，属预期行为，不计入失败
      if (/Failed to fetch|net::ERR_INTERNET_DISCONNECTED|The network connection was lost/i.test(t)) return;
      errs.push(t);
    });

    await page.goto(base, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 1800));

    // iOS meta
    check('iPhone: apple-mobile-web-app-capable=yes',
      await page.$eval('meta[name="apple-mobile-web-app-capable"]', el => el.content) === 'yes');
    // 应用名会随设置里的用户名联动（见 js/app.js applyUserName），
    // 因此只断言非空、且不再是旧品牌名，不写死具体文案。
    const iosTitle = await page.$eval('meta[name="apple-mobile-web-app-title"]', el => el.content);
    check('iPhone: apple-mobile-web-app-title',
      !!iosTitle && !/背古诗词/.test(iosTitle), iosTitle);
    check('iPhone: status-bar-style',
      !!(await page.$eval('meta[name="apple-mobile-web-app-status-bar-style"]', el => el.content)));

    // apple-touch-icon 各尺寸齐全
    const icons = await page.$$eval('link[rel="apple-touch-icon"]', els =>
      els.map(e => ({ sizes: e.getAttribute('sizes'), href: e.getAttribute('href') })));
    check('iPhone: apple-touch-icon 数量 >= 5', icons.length >= 5, '实际 ' + icons.length);
    const sizesOk = ['120x120', '152x152', '167x167', '180x180'].every(s =>
      icons.some(i => i.sizes === s));
    check('iPhone: 120/152/167/180 四种尺寸齐全', sizesOk);

    // 图标资源真的能加载（非 404）
    const iconStatuses = await page.evaluate(async () => {
      const links = Array.from(document.querySelectorAll('link[rel="apple-touch-icon"]'));
      const out = [];
      for (const l of links) {
        try {
          const r = await fetch(l.href, { method: 'GET' });
          out.push(r.status);
        } catch (e) { out.push('ERR'); }
      }
      return out;
    });
    check('iPhone: 图标资源全部可访问', iconStatuses.every(s => s === 200), JSON.stringify(iconStatuses));

    // viewport 含 viewport-fit=cover（安全区生效前提）
    check('iPhone: viewport-fit=cover',
      /viewport-fit=cover/.test(await page.$eval('meta[name="viewport"]', el => el.content)));

    // manifest
    check('iPhone: manifest 已链接',
      await page.$eval('link[rel="manifest"]', el => /manifest\.webmanifest/.test(el.getAttribute('href'))));

    // Service Worker
    const sw = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'unsupported';
      const reg = await navigator.serviceWorker.getRegistration();
      return reg && reg.active ? 'active' : (reg ? 'registered' : 'none');
    });
    check('iPhone: Service Worker 已激活', sw === 'active', sw);

    // 离线缓存已建立
    const cached = await page.evaluate(async () => {
      if (!window.caches) return [];
      const names = await caches.keys();
      if (!names.length) return [];
      const c = await caches.open(names[0]);
      return (await c.keys()).map(r => new URL(r.url).pathname);
    });
    check('iPhone: 已预缓存诗词数据', cached.some(p => /poems-1\.js$/.test(p)), cached.length + ' 项');
    check('iPhone: 已预缓存样式与脚本',
      cached.some(p => /style\.css$/.test(p)) && cached.some(p => /app\.js$/.test(p)));
    check('iPhone: 已预缓存小古文页与数据',
      cached.some(p => /classic\.html$/.test(p)) && cached.some(p => /poems-classic\.js$/.test(p)),
      cached.length + ' 项');

    // 引导条应出现（iOS + 非 standalone）
    check('iPhone: 显示「添加到主屏幕」引导', await page.$eval('#ios-install-tip', el => !el.hidden));
    check('iPhone: 引导文案为 Safari 分享指引',
      /分享/.test(await page.$eval('#ios-install-tip .ios-tip-text', el => el.textContent)));

    // 关闭后不再打扰，且持久化
    await page.click('#ios-install-close');
    await new Promise(r => setTimeout(r, 300));
    check('iPhone: 点「知道了」后引导关闭', await page.$eval('#ios-install-tip', el => el.hidden));
    const dismissed = await page.evaluate(() => localStorage.getItem('poem-ios-tip-dismissed'));
    check('iPhone: 关闭状态已持久化', dismissed === '1');

    await page.reload({ waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 1600));
    check('iPhone: 重新打开不再弹引导', await page.$eval('#ios-install-tip', el => el.hidden));

    // 功能没被破坏：今日列表 + 详情 + 进度
    const cards = await page.$$eval('#today-list .poem-card, #today-list .item, #today-list > *', els => els.length);
    check('iPhone: 今日列表有内容', cards > 0, cards + ' 项');

    // 离线可用
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1200));
    const offlineOk = await page.evaluate(() => !!document.querySelector('.app'));
    check('iPhone: 断网后仍能打开', offlineOk);

    // 课外必背小古文：断网状态下也能进入并打开整页阅读器
    await page.goto(base + 'classic.html', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 800));
    const gwOffline = await page.evaluate(() => {
      const items = document.querySelectorAll('#gw-list .item');
      if (!items.length) return { items: 0 };
      items[16].click();
      return {
        items: items.length,
        readerOpen: !document.getElementById('gw-reader').hidden,
        textLen: document.getElementById('rd-text').textContent.length
      };
    });
    check('iPhone: 断网也能打开小古文页', gwOffline.items === 34, JSON.stringify(gwOffline));
    check('iPhone: 断网也能打开整页阅读器',
      gwOffline.readerOpen && gwOffline.textLen > 50, JSON.stringify(gwOffline));
    await page.setOfflineMode(false);

    check('iPhone: 无未捕获 JS 异常', errs.length === 0, errs.slice(0, 2).join(' | '));
    await page.screenshot({ path: 'pwa-iphone.png', fullPage: true });
    await page.close();
  }

  /* ============ iPad ============ */
  {
    const { page } = await freshPage();
    await page.setUserAgent(IPAD_UA);
    await page.setViewport({ width: 820, height: 1180, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(base, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 2600));
    const ipadTip = await page.evaluate(() => ({
      hidden: document.getElementById('ios-install-tip').hidden,
      isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent)
    }));
    check('iPad: 识别为 iOS 并显示引导', ipadTip.isIOS && !ipadTip.hidden, JSON.stringify(ipadTip));
    check('iPad: 页面正常渲染', await page.evaluate(() => !!document.querySelector('.app')));
    await page.close();
  }

  /* ============ 安卓 Chrome ============ */
  {
    const { page } = await freshPage();
    await page.setUserAgent(ANDROID_UA);
    await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
    await page.goto(base, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 1600));
    check('Android: 页面正常渲染', await page.evaluate(() => !!document.querySelector('.app')));
    check('Android: SW 已激活', await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return !!(reg && reg.active);
    }));
    // Chrome 若触发 beforeinstallprompt，会展示「安装」入口（平台正确行为）；
    // 关键是不能出现 iOS 专用的「分享」文案
    const androidTip = await page.evaluate(() => {
      const tip = document.getElementById('ios-install-tip');
      const text = tip.querySelector('.ios-tip-text').textContent;
      const btn = document.getElementById('ios-install-close').textContent;
      return { hidden: tip.hidden, text: text, btn: btn, isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent) };
    });
    // 安卓上不允许出现「分享 → 添加到主屏幕」的 iOS 引导。
    // 若 Chrome 触发了安装提示，展示的必须是「安装」按钮而非 iOS 分享文案。
    const showsIOSTip = androidTip.hidden === false && /分享/.test(androidTip.text);
    check('Android: 不出现 iOS 专用分享引导', !showsIOSTip,
      androidTip.hidden ? '(隐藏，符合)' : androidTip.text.trim().slice(0, 24));
    await page.close();
  }

  /* ============ 微信内置浏览器 ============ */
  {
    const { page } = await freshPage();
    await page.setUserAgent(WECHAT_UA);
    await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await page.goto(base, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 1800));
    const tipText = await page.$eval('#ios-install-tip .ios-tip-text', el => el.textContent);
    check('微信: 提示改用 Safari 打开', /Safari/.test(tipText), tipText.trim().slice(0, 30));
    await page.close();
  }

  /* ============ 桌面 Chrome ============ */
  {
    const { page } = await freshPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(base, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 1200));
    check('桌面: 页面正常渲染', await page.evaluate(() => !!document.querySelector('.app')));
    const deskTip = await page.evaluate(() => {
      const tip = document.getElementById('ios-install-tip');
      return { hidden: tip.hidden, text: tip.querySelector('.ios-tip-text').textContent };
    });
    const deskShowsIOS = deskTip.hidden === false && /分享/.test(deskTip.text);
    check('桌面: 不出现 iOS 专用分享引导', !deskShowsIOS,
      deskTip.hidden ? '(隐藏，符合)' : deskTip.text.trim().slice(0, 24));
    await page.close();
  }

  await browser.close();

  console.log('\n=== iOS / 多端兼容检查 ===\n');
  Object.keys(results).forEach(k => console.log('  ' + results[k] + ' ' + k));
  console.log('\n共 ' + Object.keys(results).length + ' 项' + (failures ? '，❌ ' + failures + ' 项失败' : '，全部通过 ✅'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
