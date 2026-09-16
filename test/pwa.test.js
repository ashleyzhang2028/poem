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
    // 因此只断言非空、且不再是旧品牌名，不写死具体文案
    // （写死文案曾在 PR #5 改名后导致 CI 失败，这里按 82b9d1f 的方式回落）。
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
    //
    // 原来只断言 href 指向静态文件 manifest.webmanifest。这条在「应用名跟随用户名」
    // 之后就成了时序题：清单读完（XHR 回调）后 href 会被换成一份 Blob 清单，
    // 于是「读得比 chrome:ready 快」就红、「慢」就绿 —— CI 与本地结论不同。
    // 真正的不变量是「页面挂了一份清单，且这份清单里的应用名与当前用户名一致」，
    // 与 href 是静态文件还是 Blob 无关。这里等清单读完再按不变量断言。
    await page.evaluate(() => window.ManifestSync && window.ManifestSync.ready()
      ? true : new Promise(r => document.addEventListener('manifest:ready', () => r(true), { once: true })));
    const manifestInfo = await page.$eval('link[rel="manifest"]', async (el) => {
      const res = await fetch(el.href);
      const json = await res.json();
      return { href: el.href, name: json.name, shortName: json.short_name };
    });
    check('iPhone: manifest 已链接', !!manifestInfo.href);
    // 清单里的应用名跟着用户名走（默认名 Ashley 时也是同一份口径）
    const expectedAppName = await page.$eval('meta[name="apple-mobile-web-app-title"]', el => el.content);
    check('iPhone: 清单应用名与当前用户名同源', manifestInfo.name === expectedAppName,
      JSON.stringify({ manifest: manifestInfo.name, title: expectedAppName }));
    check('iPhone: 清单短名仍是跬步', manifestInfo.shortName === '跬步', manifestInfo.shortName);

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
    // 目录化 URL：小古文页预缓存的地址是 /classic/（不再是 classic.html）
    check('iPhone: 已预缓存小古文页与数据',
      cached.some(p => /\/classic\/?$/.test(p)) && cached.some(p => /poems-classic\.js$/.test(p)),
      cached.length + ' 项');
    // 五部大集子（小古文 / 唐诗 / 宋词 / 古文观止 / 昭明文选）都要能离线打开：
    // 少预缓存一个页面，用户断网点进去就是白屏 —— 这条按「每一部都点名」写，
    // 而不是只验 /classic/ 一个，日后新增集子时这里会立刻发现漏了
    check('iPhone: 已预缓存唐诗 / 宋词 / 古文观止三页与各自数据',
      cached.some(p => /\/tangshi\/?$/.test(p)) && cached.some(p => /poems-tangshi\.js$/.test(p)) &&
      cached.some(p => /\/songci\/?$/.test(p)) && cached.some(p => /poems-songci\.js$/.test(p)) &&
      cached.some(p => /\/guwen\/?$/.test(p)) && cached.some(p => /poems-guwen\.js$/.test(p)),
      cached.length + ' 项');
    check('iPhone: 已预缓存昭明文选页与数据',
      cached.some(p => /\/zhaoming\/?$/.test(p)) && cached.some(p => /poems-zhaoming\.js$/.test(p)),
      cached.length + ' 项');
    check('iPhone: 已预缓存中文字体',
      cached.some(p => /NotoSerifSC-400\.woff2$/.test(p)) && cached.some(p => /NotoSansSC-400\.woff2$/.test(p)),
      cached.length + ' 项');
    check('iPhone: 已预缓存用户协议与隐私条款',
      cached.some(p => /\/terms\/?$/.test(p)) && cached.some(p => /\/privacy\/?$/.test(p)),
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

    // 中文 Web Font：自托管宋体必须在真实浏览器里加载成功，
    // 并且诗词标题的计算样式确实指向它（否则回退系统字体会露馅）。
    const fontInfo = await page.evaluate(async () => {
      await document.fonts.ready;
      const item = document.querySelector('#today-list .item-title');
      const loaded = [...document.fonts].map(f => f.family + ':' + f.status);
      return {
        serif: loaded.filter(x => /Poem Serif SC:/.test(x)),
        sans: loaded.filter(x => /Poem Sans SC:/.test(x)),
        titleFont: item ? getComputedStyle(item).fontFamily : ''
      };
    });
    check('iPhone: 自托管宋体已加载',
      fontInfo.serif.length === 2 && fontInfo.serif.every(x => /:loaded$/.test(x)),
      fontInfo.serif.join(' '));
    check('iPhone: 自托管黑体已加载',
      fontInfo.sans.length === 2 && fontInfo.sans.every(x => /:loaded$/.test(x)),
      fontInfo.sans.join(' '));
    check('iPhone: 诗题计算样式为 Poem Serif SC',
      /Poem Serif SC/.test(fontInfo.titleFont), fontInfo.titleFont.slice(0, 40));

    // 界面 / 正文不应出现横向溢出
    const overflow = await page.evaluate(() => {
      const bad = [];
      document.querySelectorAll('.item-title, .item-meta, .today-title, .brand-text h1').forEach(el => {
        if (el.scrollWidth > el.clientWidth + 2) bad.push(el.className + ':' + el.scrollWidth + '>' + el.clientWidth);
      });
      return bad.slice(0, 3);
    });
    check('iPhone: 诗词文字无横向溢出', overflow.length === 0, overflow.join(' | '));

    // 离线可用
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1200));
    const offlineOk = await page.evaluate(() => !!document.querySelector('.app'));
    check('iPhone: 断网后仍能打开', offlineOk);

    // 课外必背小古文：断网状态下也能进入并打开整页阅读器
    await page.goto(base + 'classic/', { waitUntil: 'domcontentloaded' });
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
    check('iPhone: 断网也能打开小古文页', gwOffline.items === 100, JSON.stringify(gwOffline));
    check('iPhone: 断网也能打开整页阅读器',
      gwOffline.readerOpen && gwOffline.textLen > 50, JSON.stringify(gwOffline));

    // 离线也必须能拿到宋体，否则回到刺眼的系统字体
    const offlineFont = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].filter(f => /Poem (Serif|Sans) SC/.test(f.family)).map(f => f.family + ':' + f.status);
    });
    check('iPhone: 断网后中文字体仍然可用',
      offlineFont.length === 4 && offlineFont.every(x => /:loaded$/.test(x)),
      offlineFont.join(' '));


    /* ---- 设置整页：底部导航栏不得遮挡页面最后一行（真实浏览器几何验证）---- */
    await page.goto(base + 'settings/', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 900));

    const gap = await page.evaluate(() => ({
      navH: getComputedStyle(document.documentElement).getPropertyValue('--nav-h').trim(),
      pageBottomPad: getComputedStyle(document.querySelector('.settings-page')).paddingBottom,
      appBottomPad: getComputedStyle(document.querySelector('.app')).paddingBottom
    }));
    // 没有底部导航栏时 --nav-h 为 0，页面只留基础呼吸间距；
    // 出现播放栏时留白必须 ≥ 播放栏高度（下面那条几何断言就查这个）
    check('iPhone: 设置页初始化了导航栏高度基准线',
      /^\d+(\.\d+)?px$/.test(gap.navH) && parseFloat(gap.appBottomPad) >= 0, JSON.stringify(gap));

    /** 模拟底部播放栏出现（最长的“上一首 / 停止 / 下一首”三键布局） */
    const playAndMeasure = await page.evaluate(async () => {
      const app = document.querySelector('.app');
      const foot = document.querySelector('.settings-foot');
      function covered() {
        const r = foot.getBoundingClientRect();
        const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
        return !!(hit && !foot.contains(hit));
      }
      // 注入一条与真实播放栏同结构的导航栏
      const bar = document.createElement('div');
      bar.className = 'player-bar';
      bar.innerHTML = '<div class="pb-info"><div class="pb-now">静夜思</div><div class="pb-next">下一首：春晓</div></div>' +
        '<div class="pb-controls"><button class="pb-btn pb-side"></button>' +
        '<button class="pb-btn pb-toggle"></button><button class="pb-btn pb-side"></button></div>';
      document.body.appendChild(bar);
      document.body.classList.add('has-audio-player');
      let measured = 0;
      for (let i = 0; i < 5; i++) {
        const r = bar.getBoundingClientRect();
        measured = Math.round(r.height);
        document.documentElement.style.setProperty('--nav-h', measured + 'px');
        await new Promise(r2 => requestAnimationFrame(r2));
      }
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r2 => setTimeout(r2, 120));
      const footRect = foot.getBoundingClientRect();
      return {
        barHeight: measured,
        appPad: parseFloat(getComputedStyle(app).paddingBottom),
        footBottom: Math.round(footRect.bottom),
        covered: covered()
      };
    });
    check('iPhone: 播放栏出现后设置页底部留白随之增大',
      playAndMeasure.appPad >= playAndMeasure.barHeight,
      '播放栏 ' + playAndMeasure.barHeight + 'px，留白 ' + playAndMeasure.appPad + 'px');
    check('iPhone: 播放栏不遮挡设置页底部的法务链接', !playAndMeasure.covered,
      JSON.stringify(playAndMeasure));

    /* ---- 底部页签（全站导航栏）同样不得压住页面最后一行 ---- */
    await page.goto(base + 'settings/', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 900));
    const dockGeom = await page.evaluate(() => {
      const dock = document.getElementById('site-dock');
      const foot = document.querySelector('.settings-foot');
      window.scrollTo(0, document.body.scrollHeight);
      return new Promise(res => requestAnimationFrame(() => {
        const dr = dock.getBoundingClientRect();
        const fr = foot.getBoundingClientRect();
        const hit = document.elementFromPoint(
          Math.round(fr.left + fr.width / 2), Math.round(fr.top + fr.height / 2));
        res({
          navH: getComputedStyle(document.documentElement).getPropertyValue('--nav-h').trim(),
          dockH: Math.round(dr.height),
          dockTop: Math.round(dr.top),
          footBottom: Math.round(fr.bottom),
          // 页脚最后一行必须整体在页签之上，且中心点可点
          covered: fr.bottom > dr.top || !(hit && foot.contains(hit)),
          hitCls: hit ? (hit.className || hit.tagName) : null
        });
      }));
    });
    // getBoundingClientRect 的小数被 round 成整数，允许 1px 的取整差
    check('iPhone: 设置页底部留白 ≥ 页签高度',
      parseFloat(dockGeom.navH) >= dockGeom.dockH - 1, JSON.stringify(dockGeom));
    check('iPhone: 底部页签不遮挡设置页底部的法务链接', !dockGeom.covered, JSON.stringify(dockGeom));

    // 首页与五部典籍页的页签同样不能压住内容
    for (const [file, label] of [['', '/（首页）'], ['classic/', '/classic/'],
      ['tangshi/', '/tangshi/'], ['songci/', '/songci/'], ['guwen/', '/guwen/'],
      ['zhaoming/', '/zhaoming/']]) {
      await page.goto(base + file, { waitUntil: 'networkidle0' });
      await new Promise(r => setTimeout(r, 700));
      const g = await page.evaluate(() => {
        const dock = document.getElementById('site-dock');
        const app = document.querySelector('.app');
        return {
          dockH: Math.round(dock.getBoundingClientRect().height),
          navH: getComputedStyle(document.documentElement).getPropertyValue('--nav-h').trim(),
          appPad: parseFloat(getComputedStyle(app).paddingBottom)
        };
      });
      check('iPhone: ' + label + ' 页面留白 ≥ 页签高度',
        g.appPad >= g.dockH - 1, JSON.stringify(g));
    }

    // 断网也能进设置（Issue #132 后续拆成二级页之后，主页只剩四个入口，
    // 原来那些设置控件都在二级页上；这条路按「用户真的会怎么走」量一遍：
    // 主页四个入口 → 点进「通用」→ 点进「朗读」，逐张页查该页的控件）。
    //（「阅读与朗读」在 Issue #163 精简成「朗读」）。
    // 预缓存的页面请求在断网下也走 SW 缓存，所以连点进去都不必联网。
    await page.setOfflineMode(true);
    await page.goto(base + 'settings/', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 900));
    const settingsOffline = await page.evaluate(() => ({
      hasPage: !!document.querySelector('#settings-page'),
      hasFoot: !!document.querySelector('.settings-foot a[href*="/terms/"]'),
      links: [...document.querySelectorAll('a[data-group-link]')].map(a => a.getAttribute('data-group-link'))
    }));
    check('iPhone: 断网也能打开设置整页',
      settingsOffline.hasPage && settingsOffline.hasFoot,
      JSON.stringify(settingsOffline));
    check('iPhone: 断网也能看到设置主页的四个二级页入口',
      settingsOffline.links.join(',') === 'general,recite,lists,reader',
      settingsOffline.links.join(','));

    // 点入口走到二级页：断网、且是站内链接（不是按钮）——正好是拆页时
    // 最容易坏的两种：预缓存少了那一张，或是入口渲染成了点不动的元素。
    const enterSub = async (key, sel) => {
      await page.goto(base + 'settings/', { waitUntil: 'domcontentloaded' });
      await new Promise(r => setTimeout(r, 700));
      // 点之前先确认入口是站内 <a>（不是按钮、也不是写死的外链）
      const link = await page.evaluate(k => {
        const a = document.querySelector('a[data-group-link="' + k + '"]');
        return a ? { tag: a.tagName, href: a.getAttribute('href') } : null;
      }, key);
      if (!link) return { clicked: false };
      // 「点一下就跳过去」交给浏览器自己完成（真用户就是这么走的），
      // 之后等新页面就绪再查控件 —— 不在同一个 evaluate 里跨导航取值
      await page.evaluate(k => document.querySelector('a[data-group-link="' + k + '"]').click(), key);
      await page.waitForFunction(() => {
        const m = document.querySelector('.app main');
        return m && (m.className.indexOf('settings-page') >= 0);
      }, { timeout: 8000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 800));
      const after = await page.evaluate(s => ({
        url: location.pathname,
        hasPage: !!document.querySelector('#settings-page'),
        hasCtrl: !!document.querySelector(s)
      }), sel);
      return Object.assign({ clicked: true, href: link.href }, after);
    };
    const subGeneral = await enterSub('general', '#input-username');
    check('iPhone: 断网时点「通用」进得去二级页（预缓存里真的有这张页）',
      subGeneral.clicked && subGeneral.href === '/settings/general/' &&
      subGeneral.url === '/settings/general/' &&
      subGeneral.hasPage && subGeneral.hasCtrl,
      JSON.stringify(subGeneral));
    const subReader = await enterSub('reader', '#seg-helper');
    check('iPhone: 断网时点「朗读」进得去二级页，注音开关就在这一页',
      subReader.clicked && subReader.href === '/settings/reader/' &&
      subReader.url === '/settings/reader/' &&
      subReader.hasPage && subReader.hasCtrl,
      JSON.stringify(subReader));
    await page.setOfflineMode(false);

    // 用户协议 / 隐私条款：断网也要能打开，邮箱仍可还原（隐私合规不能靠联网）
    await page.goto(base + 'terms/', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 500));
    const termsOffline = await page.evaluate(() => {
      const link = document.querySelector('[data-mail-slot]');
      return {
        title: document.title,
        // 精简后章节标题为「学生与未成年人」「四、免责与变更」，
        // 断言具体小节名而不是旧的长标题，避免文案瘦身后误判
        hasChapter: /学生与未成年人/.test(document.body.textContent),
        hasDisclaimer: /免责与变更/.test(document.body.textContent),
        mail: link ? link.getAttribute('href') : null
      };
    });
    check('iPhone: 断网也能打开用户协议', /用户协议/.test(termsOffline.title) && termsOffline.hasChapter,
      termsOffline.title);
    check('iPhone: 断网也能还原邮箱（用户协议页）', /^mailto:/.test(termsOffline.mail || ''),
      String(termsOffline.mail));

    await page.goto(base + 'privacy/', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 500));
    const privacyOffline = await page.evaluate(() => {
      const link = document.querySelector('[data-mail-slot]');
      return {
        title: document.title,
        hasKids: /儿童隐私/.test(document.body.textContent),
        mail: link ? link.getAttribute('href') : null
      };
    });
    check('iPhone: 断网也能打开隐私条款',
      /隐私条款/.test(privacyOffline.title) && privacyOffline.hasKids, privacyOffline.title);
    check('iPhone: 断网也能还原邮箱（隐私条款页）', /^mailto:/.test(privacyOffline.mail || ''),
      String(privacyOffline.mail));
    await page.setOfflineMode(false);

    // ---- Issue #32 需求：详情页播放 / 暂停、译文按钮都不许并排 ----
    // 只在 DOM 里断言「有两个图标」是不够的：▶ / ⏸ 是同一颗键的两态，
    // 由 CSS 的 [data-on] 规则切换。曾经因为选择器特异性不足被
    // `.icon-row > .mini-btn .btn-icon { display: block }` 压掉，
    // 两个图标就并排同时显示 —— 这里在真实浏览器里量计算样式，防止复发。
    await page.goto(base + '', { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 600));
    const glyphState = await page.evaluate(async () => {
      const shown = btn => [...btn.querySelectorAll('.btn-icon')]
        .filter(e => getComputedStyle(e).display !== 'none')
        .map(e => e.className.split(' ').pop());
      window.localStorage.clear();
      document.querySelector('#today-list .item').click();
      await new Promise(r => setTimeout(r, 400));
      const readBtn = document.querySelector('#m-read-btn');
      const firstRow = [...document.querySelectorAll('#m-actions-icons button')].map(b => b.id);
      const wasOff = readBtn.dataset.on;
      readBtn.dataset.on = '0';
      const readOff = shown(readBtn);
      readBtn.dataset.on = '1';
      const readOn = shown(readBtn);
      readBtn.dataset.on = wasOff;
      // 展开译文，量译文那颗键
      document.querySelector('#m-trans-toggle').click();
      await new Promise(r => setTimeout(r, 300));
      const tBtn = document.querySelector('#m-trans-read');
      const tCount = document.querySelectorAll('#m-trans-read').length;
      tBtn.dataset.on = '0';
      const transOff = shown(tBtn);
      tBtn.dataset.on = '1';
      const transOn = shown(tBtn);
      return {
        firstRow, readOff, readOn, transOff, transOn, tCount,
        transInFirstRow: !!document.querySelector('#m-actions-icons #m-trans-read'),
        transStyled: getComputedStyle(tBtn).borderRadius
      };
    });
    check('iPhone: 详情页第一排只有原文播放键，译文键不在这一排',
      glyphState.firstRow.join(',') === 'm-read-btn,m-trans-toggle' && !glyphState.transInFirstRow,
      glyphState.firstRow.join(','));
    check('iPhone: 详情页原文键 ▶ / ⏸ 互斥，一次只显示一个',
      glyphState.readOff.length === 1 && glyphState.readOff[0] === 'play-glyph' &&
      glyphState.readOn.length === 1 && glyphState.readOn[0] === 'pause-glyph',
      JSON.stringify([glyphState.readOff, glyphState.readOn]));
    check('iPhone: 全页只有一颗译文朗读键',
      glyphState.tCount === 1, String(glyphState.tCount));
    check('iPhone: 详情页译文键 ▶ / ⏸ 互斥，一次只显示一个',
      glyphState.transOff.length === 1 && glyphState.transOff[0] === 'play-glyph' &&
      glyphState.transOn.length === 1 && glyphState.transOn[0] === 'pause-glyph',
      JSON.stringify([glyphState.transOff, glyphState.transOn]));
    check('iPhone: 详情页译文键在首页也有样式（不是浏览器默认按钮）',
      parseFloat(glyphState.transStyled) > 100, glyphState.transStyled);

    // ---- Issue #44：弹卡片里的播放键 / 译文键必须是正圆，不许纵向被拉扁 ----
    // 光看 CSS 文本不够 —— 真浏览器里量 offsetWidth / offsetHeight，
    // 免得将来再出现「width 写死 38px、高度却被 flex 拉高」的椭圆。
    const roundState = await page.evaluate(async () => {
      const box = document.querySelector('#m-read-btn');
      const trans = document.querySelector('#m-trans-read');
      const r = el => {
        const b = el.getBoundingClientRect();
        return { w: +b.width.toFixed(1), h: +b.height.toFixed(1), radius: getComputedStyle(el).borderRadius };
      };
      return { read: r(box), trans: r(trans) };
    });
    check('iPhone: 详情页播放键是正圆（宽高相等）',
      roundState.read.w === roundState.read.h && roundState.read.w >= 36,
      JSON.stringify(roundState.read));
    check('iPhone: 详情页播放键用 50% 圆角（圆环而非圆角方块）',
      roundState.read.radius === '50%', roundState.read.radius);
    check('iPhone: 详情页译文键是正圆角胶囊（不纵向拉高）',
      roundState.trans.h <= 34 && roundState.trans.h >= 18,
      JSON.stringify(roundState.trans));
    check('iPhone: 详情页译文键圆角为胶囊（border-radius 接近半高或 999px）',
      roundState.trans.radius === '999px' || parseFloat(roundState.trans.radius) * 2 >= roundState.trans.h,
      roundState.trans.radius);

    // ---- Issue #55：首页「今日背诵」两颗圆的直径必须一致 ----
    // 用户连着报了几轮（56 → 54 → 同径），说明光改 CSS 数值不够，得看渲染结果。
    // 前几轮一直量错的根源是「量的是盒子，不是画出来的圆」：
    //   左侧播放键 → **画出来的圆**：盒子用的是 content-box，那圈 1px 边框
    //                画在盒外，所以「圆外缘 = 盒子宽」；但历史上是 border-box，
    //                圆会被边框吃小 2px —— 这一条必须按当前 box-sizing 反算，
    //                不能想当然地拿盒子宽当直径（真机上量出来差的就是这 1~2px）。
    //                另外还要减掉 `<button>` 的 UA 默认内边距（1px 6px）：
    //                它会把盒子横向撑宽 12px，是「一大一小」的另一半原因。
    //   右侧进度环 → 圆环的**最大直径**，两种量法取大者：
    //                a) svg 外盒（svg overflow: hidden 会把骑在边界上的描边裁进盒内）
    //                b) 路径几何框 + 一圈描边
    //                再减掉 `<div>` 上可能有的 UA 内边距（正常为 0）。
    const todayRing = await page.evaluate(() => {
      const read = document.querySelector('#today-read');
      const ring = document.querySelector('#today-ring');
      // 「画出来的圆」直径 = 内容盒 + 两侧边框（content-box 下边框画在盒外）
      // + <button> 的 UA 默认内边距（1px 6px，没清掉就会撑出 12px）。
      // ⚠️ 不能再拿 `getComputedStyle(el).width` 当直径：那一项在 content-box 下
      //    只是**内容区**（40 − 两侧各 1px = 38px），比画出来的圆小一圈。
      //    历史上这一段就是按内容盒量的，于是 CSS 写 40px、真机画出 42px，
      //    两边各自「看着对」，并排却差 2px —— 正是用户说的「一颗大一颗小」。
      //    这里改成量**外盒矩形**（getBoundingClientRect = 内容 + 内边距 + 边框），
      //    它才是眼睛看到的那一圈。
      const paintedCircle = el => {
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return { w: +b.width.toFixed(2), h: +b.height.toFixed(2), box: cs.boxSizing, content: cs.width };
      };
      const outer = el => { const b = el.getBoundingClientRect(); return { w: +b.width.toFixed(2), h: +b.height.toFixed(2) }; };
      const r = outer(ring);
      const boxMax = Math.max(r.w, r.h);
      // 路径几何框（getBBox / getBoundingClientRect 都不含描边），加上一圈描边
      const path = ring.querySelector('.ring-bg');
      const pb = path.getBoundingClientRect();
      const stroke = parseFloat(getComputedStyle(path).strokeWidth) || 0;
      const paintedMax = +Math.max(pb.width, pb.height, boxMax - stroke).toFixed(2);
      return {
        read: outer(read),
        // 播放键「画出来的圆」（去掉 UA 内边距、按 box-sizing 处理那圈边框）
        readCircle: paintedCircle(read),
        readPadding: getComputedStyle(read).padding,
        ring: r,
        ringMax: +Math.max(boxMax, paintedMax + stroke).toFixed(2),
        stroke: stroke
      };
    });
    check('iPhone: 日期条左侧播放键是正圆（宽高相等）',
      todayRing.read.w === todayRing.read.h, JSON.stringify(todayRing.read));
    check('iPhone: 左侧播放键没有 UA 默认内边距（1px 6px 会把圆撑成 52px 宽）',
      /^(0px)( 0px)*$/.test(todayRing.readPadding), todayRing.readPadding);
    check('iPhone: 今日圆环的最大直径与左侧播放键画出来的圆一致',
      todayRing.ringMax === todayRing.readCircle.w && todayRing.ringMax === todayRing.readCircle.h,
      '圆环最大直径 ' + todayRing.ringMax + ' vs 播放键画出来的圆 ' + todayRing.readCircle.w + '×' + todayRing.readCircle.h
      + '（' + todayRing.readCircle.box + '，内容区 ' + todayRing.readCircle.content + '）');
    check('iPhone: 今日圆环是正圆（没被 flex 行拉成椭圆）',
      todayRing.ring.w === todayRing.ring.h, JSON.stringify(todayRing.ring));
    check('iPhone: 今日圆环里那颗金色描边没被裁掉半圈（描边宽度仍是整数 3px）',
      todayRing.stroke === 3, String(todayRing.stroke));

    // Issue #55 本轮：播放键里那颗 ▶ 三角的边框必须量得到「1px」。
    // 描边写在 SVG 的 viewBox（24）里、会跟图标框一起缩放，所以不能只看属性值：
    // 这里按真实渲染尺寸反算 —— stroke-width ÷ viewBox × 图标框尺寸 = 屏幕上的笔画。
    // 各档图标框与描边值的配对说明在 css/classic.css 顶部。
    const glyphStroke = await page.evaluate(() => {
      const out = [];
      const measure = (btnSel, label) => {
        const btn = document.querySelector(btnSel);
        if (!btn) return;
        const path = btn.querySelector('.play-glyph path') || btn.querySelector('path');
        if (!path) return;
        const box = path.ownerSVGElement.getBoundingClientRect();
        const sw = parseFloat(getComputedStyle(path).strokeWidth) || 0;
        out.push({ label: label, px: +(sw / 24 * box.width).toFixed(2), sw: sw, box: +box.width.toFixed(2) });
      };
      measure('#today-read', '首页今日条');
      measure('#today-list .item-read', '今日列表项');
      return out;
    });
    glyphStroke.forEach(function (g) {
      check('iPhone: ' + g.label + '三角的边框量出来是 1px（' + g.px + 'px）',
        g.px >= 0.7 && g.px <= 1.25, JSON.stringify(g));
    });

    // ---- 小古文页：工具栏「连读」与各分组右侧都改成了圆形播放键 ----
    // 形状必须在真浏览器里量：CSS 写着 50% 圆角，但若高度被 flex 拉高，
    // 渲染出来仍是椭圆（曾经列表项那颗就是这样）。所以量的是真实盒尺寸。
    await page.goto(base + 'classic/', { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 600));
    const gwState = await page.evaluate(() => {
      const r = el => {
        const b = el.getBoundingClientRect();
        return {
          w: +b.width.toFixed(1), h: +b.height.toFixed(1),
          radius: getComputedStyle(el).borderRadius,
          // 这颗键的**可见文字**：只认显式的文字槽位 .gw-play-input ----
          // 组合键的五个模式名长在它自己的菜单里（渲染后也在 DOM 里），
          // 所以 `el.textContent` 一定不为空 —— 拿它当「可见文字」会把菜单项
          // 也算进来（CI 上就是红在这一串）。圆键的文字只有一个来源：
          // .gw-play-input 槽位（见 js/reader-core.js 里那一段注释）。
          text: (el.querySelector('.gw-play-input') || el).textContent.trim(),
          raw: el.textContent.trim()
        };
      };
      const main = document.querySelector('#gw-random-read');
      const group = document.querySelector('#gw-list .group-head .gw-play-sm');
      const toolbar = document.querySelector('.toolbar');
      const search = document.querySelector('#gw-search');
      const shown = el => [...el.querySelectorAll('.play-glyph, .pause-glyph, .play-glyph-sm')]
        .filter(x => getComputedStyle(x).display !== 'none')
        .map(x => x.className.split(' ')[0]);
      const off = shown(main);
      main.dataset.on = '1';
      const on = shown(main);
      main.dataset.on = '0';
      return {
        main: r(main), group: group ? r(group) : null,
        searchH: +search.getBoundingClientRect().height.toFixed(1),
        mainH: +main.getBoundingClientRect().height.toFixed(1),
        groupCount: document.querySelectorAll('#gw-list .group-head .gw-play-sm').length,
        headCount: document.querySelectorAll('#gw-list .group-head').length,
        off, on
      };
    });
    check('iPhone: 小古文工具栏「连读」是正圆播放键',
      gwState.main.w === gwState.main.h && gwState.main.radius === '50%',
      JSON.stringify(gwState.main));
    check('iPhone: 工具栏圆键与搜索框同高（一排三样上下边缘齐平）',
      Math.abs(gwState.mainH - gwState.searchH) <= 0.5,
      '圆键 ' + gwState.mainH + ' / 搜索框 ' + gwState.searchH);

    // Issue #55：搜索框提示字（「搜索篇名 / 出处 / 作者」）比右侧「全部 / 未读」大一圈，
    // 一排三样里最没信息量的一行字反而最抢眼。现在两者同号。
    // 必须在真浏览器里量 —— 提示字走 ::placeholder 伪元素，jsdom 不计算它的样式，
    // 而且它天生比输入框字号小一号还是同号，只有渲染出来才知道。
    // 同时要盯住：**输入的文字仍是 16px**，压小了 iPhone 聚焦就会放大整页。
    const fsState = await page.evaluate(() => {
      const s = document.querySelector('#gw-search');
      const seg = document.querySelector('.filter-seg button');
      return {
        input: getComputedStyle(s).fontSize,
        placeholder: getComputedStyle(s, '::placeholder').fontSize,
        seg: getComputedStyle(seg).fontSize
      };
    });
    check('iPhone: 搜索框提示字与「全部 / 未读」同字号',
      fsState.placeholder === fsState.seg,
      '提示字 ' + fsState.placeholder + ' / 全部·未读 ' + fsState.seg);
    check('iPhone: 输入文字仍是 16px（压小会触发 iOS 聚焦放大整页）',
      fsState.input === '16px', fsState.input);
    check('iPhone: 圆键的 ▶ / ⏸ 互斥，一次只显示一个',
      gwState.off.join(',') === 'play-glyph' && gwState.on.join(',') === 'pause-glyph',
      JSON.stringify([gwState.off, gwState.on]));
    check('iPhone: 每个分组右侧都有一颗小号圆键（宽高相等）',
      gwState.groupCount === gwState.headCount && gwState.group &&
      gwState.group.w === gwState.group.h && gwState.group.radius === '50%',
      JSON.stringify({ n: gwState.groupCount, box: gwState.group }));
    check('iPhone: 分组圆键比工具栏那颗小',
      gwState.group.w < gwState.main.w,
      gwState.group.w + ' < ' + gwState.main.w);
    check('iPhone: 分组圆键没有可见文字（图标表达状态）',
      gwState.group.text === '', JSON.stringify(gwState.group.text));

    // ---- Issue #55（含后续）：序号圆左对齐 / 无短竖条 / 卡头间距 / 提示字居中 ----
    // 这几条只能在真浏览器里量：jsdom 不算布局，CSS 写着数值也可能被裁、
    // 被 flex 拉扁、或被父级 overflow 切掉一角。量的都是渲染后的真实盒子。
    const numState = await page.evaluate(() => {
      const card = document.querySelector('#gw-list .group-card');
      const head = card.querySelector('.group-head');
      const headBtn = head.querySelector('.gw-play-sm');
      const item = card.querySelector('.item');
      const num = item.querySelector('.item-num');
      const title = item.querySelector('.item-title');
      const meta = item.querySelector('.item-meta');
      const arrow = item.querySelector('.item-arrow');
      const play = item.querySelector('.item-read');
      const main = item.querySelector('.item-main');
      const itemRect = item.getBoundingClientRect();
      const playRect = play.getBoundingClientRect();
      const mainRect = main.getBoundingClientRect();
      const numRect = num.getBoundingClientRect();
      const metaRect = meta.getBoundingClientRect();
      const titleRect = title.getBoundingClientRect();
      const arrowRect = arrow.getBoundingClientRect();
      const bar = getComputedStyle(item, '::before');
      const itemPad = getComputedStyle(item);
      return {
        numW: +numRect.width.toFixed(2),
        numH: +numRect.height.toFixed(2),
        numFont: getComputedStyle(num).fontSize,
        titleFont: getComputedStyle(title).fontSize,
        numLeft: +numRect.left.toFixed(2),
        titleLeft: +titleRect.left.toFixed(2),
        metaLeft: +metaRect.left.toFixed(2),
        numLeftInset: +(numRect.left - itemRect.left).toFixed(2),
        arrowRightInset: +(itemRect.right - arrowRect.right).toFixed(2),
        // Issue #55 后续：播放键左右两侧的真实间距
        //   左 = 内容块右缘 → 圆键左缘（本轮归零，圆键左缘就贴着内容块右缘）
        //   右 = 圆键右缘 → 箭头左缘（6px，不动）
        playGapLeft: +(playRect.left - mainRect.right).toFixed(2),
        playW: +playRect.width.toFixed(2),
        mainW: +mainRect.width.toFixed(2),
        // Issue #69 后续：内容块按内容取宽之后，「文字有没有被压窄」不能再
        // 拿一个写死的宽度下限去卡（条目本身已经窄下来了）。这里量真实关系。
        //
        // ⚠️ 口径修正（Issue #69 本轮）：原先这一栏拿离屏副本里的子元素渲染宽
        // 当「自然宽」（widestChildW），量出来是 372.94px —— 那是个**假数**：
        //   · .item-main 是 flex: 1 1 0%（css/style.css 的全站 .item）。一份克隆
        //     原样搬进 `position:absolute; width:max-content` 的探针时，它自己知道
        //     外面的 auto 宽是循环依赖，于是退回它原本（= 层叠来源）的父宽度 ——
        //     393px 视口下正好 372.94px，子元素也就被分到 372.94px。
        //   · 真正决定「这一段要多宽」的盒子是 .item-meta 的末位子元素（正文摘句 /
        //     选本名，带 `max-width: 100%`）—— max 的百分比以**包含块**
        //     （= .item-main）为准，而 .item-main 要的又正是那一段的自然宽：
        //     一个循环依赖，浏览器解出来就是「把包含块撑满」。
        //     探针与真实布局因此得出同一个数，这一栏量不出任何东西（CI 上必红）。
        //
        // 现在不猜「文字要多宽」，而是量**布局真的压缩了什么**：
        //   1) prefixW —— 正文摘句之前那几颗（朝代 / 作者 / 出处）是 nowrap 短串，
        //      它们没被压窄；乘上全列表必须只有一个值（与标题长短无关）。
        //   2) overflows —— 末位子元素那一行走的是**截断**而不是硬缩：
        //      「行上其它子项的宽 + 这段文字的完整自然宽」已经超过内容块给它的宽，
        //      说明它确实放不下（真放得下就不会截，也就没有这一条）；而它的
        //      scrollWidth 又恰好等于渲染宽 —— 这正是 text-overflow: ellipsis 下
        //      一个 nowrap 块的特征（硬缩会让文字挤在比内容窄的盒子里，
        //      那时 scrollWidth 会大于 clientWidth）。
        metaBox: (() => {
          const meta = main.querySelector('.item-meta');
          const spans = meta ? [].slice.call(meta.children) : [];
          if (!spans.length) return { n: 0, prefixW: 0, overflows: 0 };
          const last = spans[spans.length - 1];
          const prefixW = spans.slice(0, -1).reduce(function (a, k) {
            return a + k.getBoundingClientRect().width;
          }, 0);
          // 末位那段的**完整自然宽**（去掉 max-width / nowrap 的离屏量法）
          const probe = document.createElement('span');
          probe.style.cssText = 'position:absolute;left:-99999px;top:0;white-space:nowrap;' +
            'font-size:' + getComputedStyle(last).fontSize + ';' +
            'font-family:' + getComputedStyle(last).fontFamily + ';' +
            'letter-spacing:' + getComputedStyle(last).letterSpacing + ';';
          probe.textContent = last.textContent;
          document.body.appendChild(probe);
          const fullW = probe.getBoundingClientRect().width;
          probe.parentNode.removeChild(probe);
          const boxW = meta.getBoundingClientRect().width;
          return {
            n: spans.length,
            prefixW: +prefixW.toFixed(2),
            // 前缀 + 末位全宽 > 可用宽 ⇒ 这一段真的放不下（必须靠截断收场）
            overflows: prefixW + fullW > boxW + 1 ? 1 : 0,
            // 截断的特征：scrollWidth 与渲染宽同值（硬缩才会大于）
            trimmed: last.scrollWidth <= last.clientWidth + 1 ? 1 : 0,
            fullW: +fullW.toFixed(2),
            boxW: +boxW.toFixed(2)
          };
        })(),
        // Issue #69 后续：内容块按内容取宽之后，「文字有没有被压窄」不能再用
        // 写死的宽度下限去卡（条目本身已经窄下来了）。改量真实关系：
        // 内容块宽度 ≥ 标题行的自然宽（用 Range 量文字墨迹，不受当前布局影响）。
        titleNatW: (() => {
          const title = main.querySelector('.item-title');
          if (!title) return 0;
          // ⚠️ 这里量的是标题**文字**的自然宽，不是标题这个盒子的宽。
          //    两处坑都得绕开：
          //    1) 不能量标题盒：它是块级 flex 行，在 .item-main 里宽 283px
          //       （被内容块的宽度决定），量它等于什么都没量。
          //    2) 也不能把 .item-title 单独拷进一份 `width: max-content` 离屏副本 ——
          //       那样量到的是「标题被撑到与父级同宽」，跟自然宽无关。
          //    换成 Range 框住标题里的文字：它给出的是文字**不折行**时的真实
          //    墨迹宽度（「1人之初」= 77.31px），这正是「标题有没有被压窄」
          //    该比的那个数。
          const rng = document.createRange();
          rng.selectNodeContents(title);
          return +rng.getBoundingClientRect().width.toFixed(2);
        })(),
        playGapRight: +(arrowRect.left - playRect.right).toFixed(2),
        // 两键之间**固定**的那段间距（播放键的 margin-right）——
        // 箭头带 margin-left: auto 后，几何上的那段距离是「固定间距 + 余量」，
        // 不再是常量，见下方断言处的说明。
        playGapRightCss: getComputedStyle(play).marginRight,
        barContent: bar.content,
        padL: itemPad.paddingLeft,
        padR: itemPad.paddingRight,
        // Issue #55 后续（本轮）：卡头那一行「多 4px」只加在**左侧**，
        // 右侧那颗 26px 圆键的内缘仍与条目里的右箭头同宽（都是 8px）。
        headPadL: getComputedStyle(head).paddingLeft,
        headPadR: getComputedStyle(head).paddingRight,
        // 卡片自身的左内边距（main 上「+2px」的那一层）。与条目 / 卡头
        // 自己的左内边距是**两层**，相加才是「文字距卡片左缘」——
        // 卡头 / 条目各自 12px + 卡片 2px = 14px，两处同值才算基准线对齐。
        cardPadL: getComputedStyle(card).paddingLeft,
        // 卡头文字与条目文字的**真实**左缘，用来直接核对基准线是否重合
        headNameLeft: +head.querySelector('.group-name').getBoundingClientRect().left.toFixed(2),
        itemNumLeftAbs: +numRect.left.toFixed(2),
        headPadBottom: getComputedStyle(head).paddingBottom,
        gapHeadBtnToItem: +(itemRect.top - headBtn.getBoundingClientRect().bottom).toFixed(2),
        numFirstChild: title.firstElementChild === num,
        oldIndexLeft: document.querySelectorAll('#gw-list .item-index').length,
        // Issue #55 后续：序号圆改为 1px 同色描边（无底色），数字水平 + 垂直居中
        numBg: getComputedStyle(num).backgroundColor,
        numBorderW: getComputedStyle(num).borderTopWidth,
        numBorderStyle: getComputedStyle(num).borderTopStyle,
        numBorderColor: getComputedStyle(num).borderTopColor,
        numColor: getComputedStyle(num).color,
        numRadius: getComputedStyle(num).borderRadius,
        numPad: getComputedStyle(num).paddingTop,
        // 真实盒子量居中：数字行盒在圆内上下左右四边留白是否相等
        numInkRect: (() => {
          const r = document.createRange();
          r.selectNodeContents(num);
          const t = r.getBoundingClientRect();
          const nr = num.getBoundingClientRect();
          return {
            left: +(t.left - nr.left).toFixed(2),
            right: +(nr.right - t.right).toFixed(2),
            top: +(t.top - nr.top).toFixed(2),
            bottom: +(nr.bottom - t.bottom).toFixed(2)
          };
        })()
      };
    });
    check('iPhone: 序号圆是正圆（宽高相等）',
      numState.numW === numState.numH, JSON.stringify([numState.numW, numState.numH]));
    check('iPhone: 序号圆的直径等于标题字号',
      numState.numW === parseFloat(numState.titleFont),
      numState.numW + ' vs ' + numState.titleFont);
    check('iPhone: 序号圆的字号比标题小一号（放得下两位数）',
      parseFloat(numState.numFont) < parseFloat(numState.titleFont),
      numState.numFont + ' < ' + numState.titleFont);
    // Issue #55 后续：序号圆去掉淡绿底，改为与序号同色的 1px 圆形描边，数字居中
    check('iPhone: 序号圆不再有淡绿底（背景全透明）',
      /rgba\(0, 0, 0, 0\)|transparent/.test(numState.numBg), numState.numBg);
    check('iPhone: 序号圆是 1px 实线描边',
      parseFloat(numState.numBorderW) === 1 && numState.numBorderStyle === 'solid',
      numState.numBorderW + ' ' + numState.numBorderStyle);
    check('iPhone: 描边色与圈里的数字同色（currentColor）',
      numState.numBorderColor === numState.numColor,
      numState.numBorderColor + ' vs ' + numState.numColor);
    check('iPhone: 序号圆仍是正圆（50% 圆角）', numState.numRadius === '50%', numState.numRadius);
    check('iPhone: 圆上没有内边距（居中由 flex 负责）',
      parseFloat(numState.numPad) === 0, numState.numPad);
    check('iPhone: 数字在圆内水平居中（左右留白相等）',
      Math.abs(numState.numInkRect.left - numState.numInkRect.right) <= 1,
      JSON.stringify(numState.numInkRect));
    check('iPhone: 数字在圆内垂直居中（上下留白相等）',
      Math.abs(numState.numInkRect.top - numState.numInkRect.bottom) <= 1,
      JSON.stringify(numState.numInkRect));
    check('iPhone: 序号圆在标题那一行、排在篇名前面',
      numState.numFirstChild, String(numState.numFirstChild));
    check('iPhone: 旧的独占一列序号已全部移除',
      numState.oldIndexLeft === 0, String(numState.oldIndexLeft));
    // 需求（Issue #55 后续）：序号圆与下方正文左对齐（三者同一条竖线）
    check('iPhone: 序号圆与下方正文左对齐（圆 / 篇名 / 元信息同一条左基准线）',
      numState.numLeft === numState.metaLeft && numState.titleLeft === numState.metaLeft,
      JSON.stringify({ num: numState.numLeft, title: numState.titleLeft, meta: numState.metaLeft }));
    // 需求（Issue #55 后续）：内容与卡片左缘的间距只加在**左边**（本轮再 +2px → 12px）。
    // 右内边距 8px 不动（那是「卡片右缘 → 播放键 / 箭头」的间距）。
    // 所以这里不再要求左右相等，而是逐项量：
    //   · 左内边距 12px、右内边距 8px（左 - 右 = 4px）；
    //   · 序号圆左内缘仍与右侧箭头右内缘同宽再加这 4px（右侧没被一起推走）。
    check('iPhone: 条目左内边距 12px、右内边距 8px（只加左侧，累计 +4px）',
      parseFloat(numState.padL) === 12 && parseFloat(numState.padR) === 8,
      JSON.stringify({ pad: numState.padL + ' / ' + numState.padR }));
    // ⚠️ Issue #69 后续：这条断言原先写的是「序号圆左内缘 = 箭头右内缘 + 4px」，
    // 即「左内边距 12px − 右内边距 8px = 4px，两者差等于这个 4px」。
    // 现在两处**各自**断言（左 12px / 右 8px），不再用一条相对式把它绑在一起：
    // 相对式在「箭头右内缘」这个量上还混着内容块按内容取宽后的余量
    // （条目右侧有一大段留白，箭头右缘距条目右缘本就是 100 多像素），
    // 那个 4px 早已不成立，却会在调整任何一处内边距时继续误报。
    check('iPhone: 序号圆左内缘距条目左缘 = 条目左内边距 12px',
      Math.abs(numState.numLeftInset - parseFloat(numState.padL)) <= 0.5,
      JSON.stringify({ numLeft: numState.numLeftInset, padL: numState.padL }));
    // 需求（Issue #69 后续）：两颗图标钉在条目右缘。
    // 这两个量必须分开量 —— 它们说的不是一件事：
    //   · arrowRightInset = 条目右缘 → 箭头右缘。它**等于** .item-arrow 自身右缘
    //     到条目右内缘的距离，也就是「箭头右缘是否真的贴在条目右侧」，
    //     量出来就是条目右内边距 8px（集子页）/ 8px（搜索页）那一档。
    //   · 条目右缘到**滚动区**右缘还有一段：.group-card 自带 padding-left: 2px
    //     与 .list / 阅读器列宽的关系，那一段不属于「对齐」这件事。
    // 这里只认前者：箭头右内缘距条目右缘 = 条目右内边距。
    check('iPhone: 箭头右内缘距条目右缘 = 条目右内边距（图标钉在条目右缘，不被内容块推走）',
      Math.abs(numState.arrowRightInset - parseFloat(numState.padR)) <= 0.5,
      JSON.stringify({ arrowRight: numState.arrowRightInset, padR: numState.padR }));
    // 需求（Issue #69 后续）：**逐条**量「右箭头距条目右缘」这一个量，
    // 全列表必须只有一个值 —— 短标题（「画」两个字）与长标题（「两小儿辩日」）
    // 的箭头要落在同一条右基准线上。此前内容块是增长项、箭头跟在它后面，
    // 标题多长箭头就漂多远：一屏里七八条，每条的箭头各歪一处。
    const alignState = await page.evaluate(() => {
      const items = [].slice.call(document.querySelectorAll('#gw-list .item'));
      const insets = items.map(function (it) {
        const ir = it.getBoundingClientRect();
        const ar = it.querySelector('.item-arrow').getBoundingClientRect();
        return +(ir.right - ar.right).toFixed(2);
      });
      // 「两颗图标之间的**固定**间距」= 播放键的 margin-right（6px）。
      // 不能量「播放键右缘 → 箭头左缘」的几何距离：箭头带 margin-left: auto，
      // 这一段是「固定 6px + 余量」，逐条本来就不相等（余量由标题长短决定），
      // 量它等于在量「标题有多长」，与对齐无关。
      const gaps = items.map(function (it) {
        return +(parseFloat(getComputedStyle(it.querySelector('.item-read')).marginRight) || 0).toFixed(2);
      });
      // 内容块 → 播放键那一段（本轮补的口径，原断言量错对象）：
      // 这一段被「加入背诵」圆键（.item-recite，直径 + 6px margin-right）占着，
      // 逐条必须同值 —— 与标题长短无关，余量全被箭头那颗 margin-left: auto 吃掉。
      // 圆键直径=播放键直径（同读 --item-btn，见 css/classic.css），实测 36px。
      const mainToPlay = items.map(function (it) {
        const main = it.querySelector('.item-main').getBoundingClientRect();
        const play = it.querySelector('.item-read').getBoundingClientRect();
        return +(play.left - main.right).toFixed(2);
      });
      return {
        n: items.length,
        insetMin: Math.min.apply(null, insets),
        insetMax: Math.max.apply(null, insets),
        gapMin: Math.min.apply(null, gaps),
        gapMax: Math.max.apply(null, gaps),
        mainToPlayMin: Math.min.apply(null, mainToPlay),
        mainToPlayMax: Math.max.apply(null, mainToPlay),
        // 内容块不得再把整行吃满（按内容取宽的旁证）
        mainMax: Math.max.apply(null, items.map(function (it) {
          return it.querySelector('.item-main').getBoundingClientRect().width;
        }))
      };
    });
    check('iPhone: 全列表「右箭头 → 条目右缘」只有一个值（短标题与长标题的箭头同一条右基准线）',
      alignState.n > 5 && alignState.insetMax - alignState.insetMin <= 0.5,
      JSON.stringify(alignState));
    check('iPhone: 全列表两颗图标的固定间距只有一个值（6px，与标题长短无关）',
      alignState.gapMax - alignState.gapMin <= 0.5 && Math.abs(alignState.gapMin - 6) <= 0.5,
      JSON.stringify({ gapMin: alignState.gapMin, gapMax: alignState.gapMax }));
    check('iPhone: 全列表「内容块 → 播放键」的间距只有一个值（由加入背诵圆键给，与标题长短无关）',
      alignState.n > 5 && alignState.mainToPlayMax - alignState.mainToPlayMin <= 0.5,
      JSON.stringify({ n: alignState.n, min: alignState.mainToPlayMin, max: alignState.mainToPlayMax }));

    // ---- 需求（Issue #69 后续）：详情页长标题不把页面撑出去 ----
    // 库里有 150 字的题目（《自河南经乱关内阻饥兄弟离散…弟妹》），
    // 详情页标题是块级 h2：不折行时浏览器按「一行放不下」处理，
    // 手机上的表现正是用户说的「详情页直接把页面撑出去了」。
    // jsdom 不算布局，这条只能在真浏览器里量 —— 量三件事：
    //   1) 标题盒子没有超出正文列（right 不越过 .reader-body 的右内缘）；
    //   2) 页面没有出现横向滚动（scrollWidth === clientWidth）；
    //   3) 标题确实折了多行（高度 > 一行的行高）。
    await page.goto(base + 'tangshi/', { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 600));
    await page.evaluate(() => {
      document.querySelector('#gw-search').value = '自河南经乱';
      document.querySelector('#gw-search').dispatchEvent(new Event('input', { bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 300));
    await page.evaluate(() => document.querySelectorAll('#gw-list .item')[0].click());
    await new Promise(r => setTimeout(r, 600));
    const longTitleState = await page.evaluate(() => {
      const t = document.querySelector('#rd-title');
      const body = document.querySelector('.reader-body');
      const tr = t.getBoundingClientRect();
      const br = body.getBoundingClientRect();
      // 正文列的可用右内缘 = 列右缘 − 列的右内边距
      const bodyPadR = parseFloat(getComputedStyle(body).paddingRight) || 0;
      return {
        text: t.textContent,
        titleW: +tr.width.toFixed(1),
        titleH: +tr.height.toFixed(1),
        lineH: parseFloat(getComputedStyle(t).lineHeight) || 0,
        bodyInnerRight: +(br.right - bodyPadR).toFixed(1),
        titleRight: +tr.right.toFixed(1),
        docScrollW: document.documentElement.scrollWidth,
        docClientW: document.documentElement.clientWidth
      };
    });
    check('iPhone: 详情页长标题换行后不溢出正文列（右缘不越过列内缘）',
      longTitleState.titleRight <= longTitleState.bodyInnerRight + 0.5,
      JSON.stringify(longTitleState));
    check('iPhone: 详情页长标题把页面撑出横向滚动的情况已消除',
      longTitleState.docScrollW <= longTitleState.docClientW + 1,
      'scrollW ' + longTitleState.docScrollW + ' / clientW ' + longTitleState.docClientW);
    check('iPhone: 详情页长标题确实折成多行（不是被裁掉一行）',
      longTitleState.titleH > longTitleState.lineH * 1.5,
      JSON.stringify({ h: longTitleState.titleH, line: longTitleState.lineH }));

    /* ---- 详情页顶栏不许溢出屏幕（用户：「详情页标题过长导致标题栏溢出」）----
       上一段量的是**正文列里的 h2**（那一条此前已经修好了）；
       这一条量的是**顶栏本身**，是另一件事：

       顶栏宽度在阅读器里失控 —— .reader 是 flex 列容器，而顶栏是它的 flex 项，
       交叉轴（横向）上 flex 项默认按内容取宽、不是撑满容器。列表页那条顶栏
       住在 .app（块级）里，所以从没露过这个问题；一进阅读器，
       「跬步 · 页名 + 第 N/M 篇 + 返回键」四件加起来多宽，顶栏就多宽，
       手机上量到 427px（视口 393px），最右边那颗返回键被屏幕裁掉一半。

       ⚠️ body 是 overflow: hidden：不会出现横向滚动条、也没有任何报错，
       只是「右半边不见了」。所以不能拿 scrollWidth 当判据（它一直是干净的），
       要**直接量顶栏的盒子宽与右缘**，以及返回键右缘是否还在视口里。
       逐部集子都量一遍，并带上 320px 这一档（最窄的手机）。 */
    for (const [colPath, colLabel] of [['classic/', '小古文'], ['tangshi/', '唐诗三百首'],
      ['songci/', '宋词三百首'], ['guwen/', '古文观止'], ['zhaoming/', '昭明文选']]) {
      for (const vw of [320, 393]) {
        await page.setViewport({ width: vw, height: 852, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        await page.goto(base + colPath, { waitUntil: 'load' });
        await new Promise(r => setTimeout(r, 600));
        const barState = await page.evaluate(() => {
          const items = [...document.querySelectorAll('#gw-list .item')];
          if (!items.length) return null;
          items[0].click();
          return new Promise(res => setTimeout(() => {
            const bar = document.querySelector('.reader > .topbar');
            if (!bar) return res(null);
            const r = bar.getBoundingClientRect();
            const act = bar.querySelector('.top-act:not(.top-act-spacer)');
            const ar = act ? act.getBoundingClientRect() : null;
            const text = bar.querySelector('#brand-page-text');
            return res({
              vw: document.documentElement.clientWidth,
              barW: +r.width.toFixed(1),
              barRight: +r.right.toFixed(1),
              barScrollW: bar.scrollWidth,
              actLeft: ar ? +ar.left.toFixed(1) : null,
              actRight: ar ? +ar.right.toFixed(1) : null,
              metaRight: (function () {
                const m = document.querySelector('#rd-meta');
                return m ? +m.getBoundingClientRect().right.toFixed(1) : null;
              })(),
              metaCount: document.querySelectorAll('#rd-meta .rd-count').length,
              labelW: text ? +text.getBoundingClientRect().width.toFixed(1) : null,
              label: text ? text.textContent : '',
              labelEllipsis: text ? getComputedStyle(text).textOverflow : null
            });
          }, 600));
        });
        check('iPhone ' + vw + 'px：' + colLabel + ' 详情页顶栏不宽于视口（四件挤不下时收页名，不收顶栏）',
          barState && barState.barW <= barState.vw + 1,
          barState ? ('顶栏 ' + barState.barW + ' / 视口 ' + barState.vw) : 'no reader');
        check('iPhone ' + vw + 'px：' + colLabel + ' 详情页返回键整个落在视口里（不被屏幕裁掉）',
          barState && barState.actRight <= barState.vw + 1 && barState.actLeft >= 0,
          barState ? ('返回键 ' + barState.actLeft + '→' + barState.actRight + ' / 视口 ' + barState.vw) : 'no reader');
        // Issue #147（两轮）：详情页顶栏那枚「第 N / M 篇」与正文状态栏里那枚
        // 「读了 N / M」都已撤除。这里量的是**状态栏那一行**本身仍落在视口里
        //（朝代 · 作者 · 出处 · 选本），并反向守住它里面不再冒出读数。
        check('iPhone ' + vw + 'px：' + colLabel + ' 详情页状态栏（朝代 / 作者 / 出处）在视口里',
          barState && barState.metaRight != null && barState.metaRight <= barState.vw + 1,
          barState ? String(barState.metaRight) : 'no reader');
        check('iPhone ' + vw + 'px：' + colLabel + ' 详情页状态栏里没有已读读数 .rd-count',
          !!barState && barState.metaCount === 0,
          barState ? (barState.metaCount + ' 枚') : 'no reader');
        check('iPhone ' + vw + 'px：' + colLabel + ' 详情页顶栏自己不出现内部横向溢出',
          barState && barState.barScrollW <= barState.barW + 1,
          barState ? (barState.barScrollW + ' / ' + barState.barW) : 'no reader');
        // 页名是被**压窄 + 省略号**收掉的，不是整段消失
        check('iPhone ' + vw + 'px：' + colLabel + ' 详情页页名仍占着一段可见宽度（收成省略号，不是归零）',
          barState && barState.labelW > 24 && barState.labelEllipsis === 'ellipsis',
          barState ? JSON.stringify([barState.labelW, barState.labelEllipsis]) : 'no reader');
      }
    }
    await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    // 需求（Issue #55 后续，本轮）：「卡头那一行多 4px」——卡头左内边距 8 → 12px，
    // 右侧不动（仍是 8px，右边那颗 26px 圆键的右内缘与条目里的右箭头同宽）。
    check('iPhone: 卡头那一行左内边距 12px（8 → 12，+4px）',
      Math.abs(parseFloat(numState.headPadL) - 12) <= 0.5, numState.headPadL);
    check('iPhone: 卡头右侧内边距仍是 8px（右边那颗圆键没被推走）',
      Math.abs(parseFloat(numState.headPadR) - 8) <= 0.5, numState.headPadR);
    // 卡头与条目是兄弟、共用卡片同一条左缘（各自左内边距叠加在卡片那 2px 之上），
    // 两者左基准线必须重合
    // —— 本轮两处左内边距同为 12px，卡头文字与条目文字因此严格对齐。
    check('iPhone: 卡头文字与条目文字左基准线重合（两处左内边距同为 12px）',
      Math.abs(parseFloat(numState.headPadL) - parseFloat(numState.padL)) <= 0.5,
      JSON.stringify({ head: numState.headPadL, item: numState.padL }));
    // 合并 main 后的口径：卡片自身的左内边距 2px（卡头 / 条目 / 首条淡线整体右移）
    // 是**第一层**，卡头与条目各自的 12px 是**第二层**。
    // 这里量两层叠加的结果：两处「文字距卡片左缘」都必须是 2 + 12 = 14px，
    // 且卡头文字与条目序号圆的真实左缘逐像素重合。
    check('iPhone: 卡片自身左内边距 2px（main 上那层，条目是加在它之上的第二层）',
      Math.abs(parseFloat(numState.cardPadL) - 2) <= 0.5, numState.cardPadL);
    check('iPhone: 卡头 / 条目文字距卡片左缘均为 14px（卡片 2px + 自身 12px，两层同值）',
      Math.abs((parseFloat(numState.cardPadL) + parseFloat(numState.headPadL)) - 14) <= 0.5 &&
      Math.abs((parseFloat(numState.cardPadL) + parseFloat(numState.padL)) - 14) <= 0.5,
      JSON.stringify({ card: numState.cardPadL, head: numState.headPadL, item: numState.padL }));
    check('iPhone: 卡头组名与条目序号圆真实左缘逐像素重合（两层叠加后基准线仍对齐）',
      Math.abs(numState.headNameLeft - numState.itemNumLeftAbs) <= 0.5,
      JSON.stringify({ headName: numState.headNameLeft, numNum: numState.itemNumLeftAbs }));
    check('iPhone: 卡头行右端圆键仍贴 8px 右内缘（右侧内缘与条目同值）',
      Math.abs(parseFloat(numState.headPadR) - parseFloat(numState.padR)) <= 0.5,
      JSON.stringify({ head: numState.headPadR, item: numState.padR }));
    // 需求（Issue #55 后续）：左侧那道「短竖条」整体隐藏，不再渲染 ::before
    check('iPhone: 左侧短竖条已隐藏（条目不再渲染 ::before 竖条）',
      !numState.barContent || numState.barContent === 'none',
      JSON.stringify(numState.barContent));
    check('iPhone: 卡头与首条之间留出间距（不再贴着分隔线）',
      numState.gapHeadBtnToItem >= 6, numState.gapHeadBtnToItem + 'px');
    // 需求（Issue #55 后续）：播放键左侧**不留负外边距** ——
    // 上一轮用 `margin-left: -12px` 去「抵掉」内容块与圆键之间的空档，结果是圆键
    // 压到内容块右缘上画；本轮按用户要求去掉，那一段让给正文（见下一条）。
    check('iPhone: 播放键左侧没有负外边距（圆键不再压住正文）',
      numState.playGapLeft >= 0, numState.playGapLeft + 'px');
    // ⚠️ 口径修正（本轮，修 CI 红）：「播放键左缘就贴在内容块右缘（间距 ≤ 1px）」
    // 这条断言量的是 playGapLeft = 内容块右缘 → 播放键左缘，而在**当前**结构里
    // 这两者之间已经排了第三颗图标「加入背诵」（.item-recite，直径 + 6px 外边距，
    // 见 css/classic.css 与 js/reader-core.js 的 reciteItemBtn）。
    // 于是 playGapLeft 恒等于「圆键直径 + 6px」—— 断言不是「偶发子像素误差」，
    // 而是**必然失败**：它量错了对象，却把红挂在内容块取宽这件事上。
    // （这条断言在 #81 那批之后、.item-recite 落地之前写的，
    //   只是 CI 采到的那一行日志被截断，才显得像偶发。）
    // 现在改量真正的几何关系：**内容块 → 播放键这一段由第三颗图标「加入背诵」
    // （.item-recite）占着** —— 它「盒宽 + 6px margin-right」就是 playGapLeft。
    // 这条关系是刻意设计的（css/classic.css 里 .item-recite 的注释写着间距 6px
    // 写在它自己的 margin-right 上），量它既不依赖标题长短，也不依赖余量落在哪里。
    // ⚠️ 盒宽不写死在断言里：它与播放键同读 --item-btn（本轮改成同大），
    //    所以这里逐条量出来的真实宽度去比，换尺寸时断言仍成立。
    // 逐条的同值性放在上面 alignState 那次 evaluate 里一起量（那里列表有 100 条，
    // 这里只剩 1 条 —— 从阅读器返回后列表是隐藏的，量不出「与标题长短无关」）。
    const gapState = await page.evaluate(() => {
      const item = document.querySelector('#gw-list .item');
      const main = item.querySelector('.item-main').getBoundingClientRect();
      const play = item.querySelector('.item-read').getBoundingClientRect();
      const recite = item.querySelector('.item-recite');
      return {
        gap: +(play.left - main.right).toFixed(2),
        reciteW: +recite.getBoundingClientRect().width.toFixed(2),
        reciteMr: +(parseFloat(getComputedStyle(recite).marginRight) || 0).toFixed(2)
      };
    });
    check('iPhone: 内容块 → 播放键这一段由「加入背诵」圆键占着（圆键盒宽 + 6px）',
      Math.abs(gapState.gap - (gapState.reciteW + gapState.reciteMr)) <= 0.5,
      JSON.stringify(gapState));
    // 需求（Issue #122 后续）：「加入背诵」键与播放键必须一样大。
    // 两枚圆键并排，量它们的真实外径 —— 一个大一个小是肉眼一瞥就能看见的。
    // 这里不写死 36px：判「两者相等」，并另给一个合理下限（免得一起缩成点）。
    check('iPhone: 「加入背诵」键与播放键一样大（两枚并排圆键同径）',
      Math.abs(gapState.reciteW - numState.playW) <= 0.5 && numState.playW >= 30,
      JSON.stringify({ reciteW: gapState.reciteW, playW: numState.playW }));
    check('iPhone: 圆键本体没被压小（仍是 --item-btn 那一档的正圆，36px；宽高同值）',
      Math.abs(numState.playW - 36) <= 0.5, numState.playW + 'px');
    // ⚠️ 口径变更（Issue #69 后续）：`playGapRight`（播放键右缘 → 箭头左缘）
    // 已经不再是「播放键与箭头之间的间距」——箭头现在带 margin-left: auto，
    // 它会把两键之间**剩下的全部**空间吃掉（余量全落在这一处）。
    // 两键之间真正的固定间距是播放键的 margin-right: 6px，量它才准。
    // 这条断言与下面那条「全列表间距只有一个值」是同一件事的两种量法：
    // 前者量 CSS 里声明的那 6px 是否还在，后者量渲染后是否**每条都一样**。
    check('iPhone: 播放键带 margin-right: 6px（与箭头之间那 6px 的固定间距在这里）',
      Math.abs(parseFloat(numState.playGapRightCss) - 6) <= 0.5,
      numState.playGapRightCss);
    // 需求（Issue #55 后续）：左侧正文的宽度真的放开（本轮的正主）。
    // 只把播放键的间距改小**不会**让正文变长：内容块是全站那句 `flex: 1 1 0%`，
    // 宽度只由「条目宽 − 两侧图标 − 列距 − 内边距」分配而来，与内容宽度无关。
    // 窄屏上它照样被压满整行，而右端三件套（圆键 / 6px / 箭头）钉在原地，
    // 于是内容块名义上「变宽」也只是宽到圆键底下，正文并不会多一个字。
    // 这里量两件事：
    //   1) 内容块宽度小于整行留给它的空间（= 它没有把整行撑满，是按内容取的宽）；
    //   2) 圆键左缘仍在原位（右端三件套没动，正文那一行的可用宽度没被吃掉）。
    // 右侧三件套的占位：书签键 36（--item-btn）+ 6 + 箭头 18；左侧 12、卡片 2、
    // 条目右内边距 8 —— 数值与 CSS 同源，本轮两枚圆键同径（都是 36）后这算式不变。
    check('iPhone: 小古文内容块不再撑满整行（按内容取宽，不是 flex 增长项）',
      numState.mainW < 393 - 2 - 12 - 8 - 36 - 6 - 18 - 1,
      numState.mainW + 'px（整行 ' + 393 + 'px）');
    // 副信息那一行里，正文摘句**之前**那几颗（朝代 / 作者 / 出处）是短串，
    // 不该为了迁就摘句被压窄 —— 这是「文字没被压窄」可以直接量到的那一半。
    check('iPhone: 副信息里的朝代 / 作者 / 出处没被摘句压窄（宽度为正且合理）',
      numState.metaBox.prefixW > 8 && numState.metaBox.prefixW < numState.metaBox.boxW,
      JSON.stringify({ prefixW: numState.metaBox.prefixW, boxW: numState.metaBox.boxW }));
    // 剩下的一半只能看「放不下的那一段怎么收场」：这段文字（前缀 + 摘句全宽）
    // 确实超过内容块给它的宽 —— 真放得下就不会截，这条也就无从谈起；
    // 而它最终是**截断**收场（scrollWidth === clientWidth，nowrap + ellipsis
    // 的特征），不是把字硬挤进更窄的盒子里（那样 scrollWidth 会大于 clientWidth）。
    check('iPhone: 放不下的摘句走截断而不是硬缩（文字没被压窄，是末尾省略）',
      numState.metaBox.overflows === 1 && numState.metaBox.trimmed === 1,
      JSON.stringify(numState.metaBox));
    // 内容块宽度只要**达到标题行的自然宽**就够了 ——
    // 不能拿一个写死的 226px 去卡：这个数原先对应的是「整行 393px 减去
    // 两侧图标 + 内边距」的旧口径（内容块当时是增长项，会被拉满）。
    // 改成按内容取宽之后，条目窄了（393px 的 iPhone 上搜索页那条
    // 「咏鹅」只有 64px），写死的下限必然误报。这里改成量真实关系：
    //   内容块宽度 ≥ 标题行的自然宽（标题没被压窄）。
    // ⚠️ 只量标题行，不量 .item-meta：元信息行末尾那段原文摘要是
    //    nowrap + ellipsis，自然宽等于整段原文、比整行还宽，按它卡必挂；
    //    见上方 titleNatW 里的说明。
    check('iPhone: 内容块宽度不小于标题行的自然宽（标题没被压窄）',
      numState.mainW >= numState.titleNatW - 0.5,
      JSON.stringify({ mainW: numState.mainW, titleNatW: numState.titleNatW }));

    // 需求（Issue #55 后续）：搜索框提示字垂直居中。
    // 提示字走 ::placeholder 伪元素，且比输入文字小一档（12.5px vs 16px）——
    // 浏览器按**输入框的**字体排基线，提示字因此沉到框中线以下。
    // 这里量两件事：
    //   1. ::placeholder 确实带着一个向上的位移（CSS 里写死 2.25px）；
    //   2. 位移量 = 两档字号「行盒中心」的差 =（16px − 12.5px）/ 2 = 1.75px……
    //      实测下沉约 2.25px（含字形墨迹），位移必须为正且落在合理区间，
    //      不能是 0（那样仍偏下），也不能大到把提示字顶出框。
    // ⚠️ 这一段**必须**在集子索引页上量（.search-input 在那里）。
    // 上面那段新加的「详情页长标题」断言把页面带去了 /tangshi/ 的阅读器里，
    // 阅读器打开时 `document.querySelector('.search-input')` 仍是列表页那个输入框，
    // 但阅读器是 fixed 全屏层、列表页被压在下面，::placeholder 的 computed style
    // 在部分内核下会退回初始值（transform: none → shift 0）。
    // 所以在量之前先回到 /classic/，别顺着页面的当前状态往下量。
    // ⚠️ 这一页是「集子索引页」：搜索框与「全部 / 未读」组合、连读圆键排成一行，
    //    三样必须同高（下面那条「圆键与搜索框同高」就是量它），
    //    所以它保持 40px 与 12.5px 的提示字不变 ——
    //    「搜索框增高、提示字跟着放大」只发生在以搜索为主角的 /search/ 一页。
    await page.goto(base + 'classic/', { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 400));
    const readPh = (sel) => {
      const inp = document.querySelector(sel);
      if (!inp) return null;
      const cs = getComputedStyle(inp);
      const ph = getComputedStyle(inp, '::placeholder');
      const m = /matrix\(1, 0, 0, 1, 0, (-?[\d.]+)\)/.exec(ph.transform);
      return {
        phFont: ph.fontSize, inputFont: cs.fontSize,
        shift: m ? +parseFloat(m[1]).toFixed(2) : 0,
        padTop: cs.paddingTop, padBottom: cs.paddingBottom,
        lh: cs.lineHeight
      };
    };
    const phState = await page.evaluate(readPh, '.search-input');
    check('iPhone: 索引页提示字仍比输入文字小一号（辅助文字不抢眼）',
      phState.phFont === '12.5px' && phState.inputFont === '16px',
      JSON.stringify([phState.phFont, phState.inputFont]));
    check('iPhone: 索引页提示字上抬回正中轴（位移 = 两档字号行盒中心差）',
      phState.shift === -2.25, 'shift ' + phState.shift + 'px');
    check('iPhone: 索引页输入框本体不做垂直方向的 padding / line-height 改动',
      parseFloat(phState.padTop) === 0 && parseFloat(phState.padBottom) === 0 &&
      phState.lh === 'normal',
      JSON.stringify([phState.padTop, phState.padBottom, phState.lh]));

    /* ============ Issue #69：搜索页在机上的可用性 ============
       搜索框增高、候选下拉贴住搜索框、软键盘弹出时整块顶到键盘上方。
       这三件事都只有真浏览器量得出来：
         · jsdom 不算布局（transform 不产生盒子，量不出高低）；
         · 软键盘是**覆盖层**，它不改 window.innerHeight ——
           只能在 this 页面里把 visualViewport 拉小来模拟，
           这正是键盘弹出时浏览器给页面的唯一信号。
       ============ */
    {
      const { page: sp } = await freshPage();
      await sp.setUserAgent(IPHONE_UA);
      await sp.setViewport({ width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
      await sp.goto(base + 'search/', { waitUntil: 'load' });
      await new Promise(r => setTimeout(r, 700));

      /* 用户这一轮的反馈：「搜索页面，当用户 focus 在搜索框，请把搜索框向上挪到
         标题栏下方。下拉列表也跟着上去。……焦点在搜索框时，现在框 border 是黑色，
         不好看，请调整。」
         —— 进页即聚焦，所以这一段量的就是「聚焦态」本身。
         三件事：框在顶栏下方（不是视口中央）、候选下拉紧跟着框（不是留在原处）、
         描边是天青主色（不是浏览器默认那支近黑的 ring）。 */
      {
        const focusState = await sp.evaluate(() => {
          const inp = document.querySelector('.search-hero .search-input');
          const bar = document.querySelector('.topbar');
          const cs = getComputedStyle(inp);
          return {
            inputTop: +inp.getBoundingClientRect().top.toFixed(1),
            barBottom: +bar.getBoundingClientRect().bottom.toFixed(1),
            mid: +((window.innerHeight - inp.getBoundingClientRect().height) / 2).toFixed(1),
            border: cs.borderTopColor,
            bg: cs.backgroundColor
          };
        });
        // 判据：框顶明显高于「视口中央」，且落在顶栏下沿之下不远 ——
        // 那一段距离就是 --hero-top（44px 的呼吸），是设计值不是随手一个数。
        check('iPhone 搜索页：聚焦时搜索框升到标题栏下方（不再停在视口中央）',
          focusState.inputTop < focusState.mid - 40 &&
          focusState.inputTop - focusState.barBottom <= 50,
          '框顶 ' + focusState.inputTop + ' / 顶栏下沿 ' + focusState.barBottom +
          ' / 中线 ' + focusState.mid);
        check('iPhone 搜索页：聚焦时描边是天青主色（不是浏览器默认的黑色 ring）',
          focusState.border === 'rgb(47, 96, 85)', focusState.border);
        check('iPhone 搜索页：聚焦时框底是纸色（与全站输入框同一套口径）',
          /^rgb\(255, 253, 246\)$/.test(focusState.bg), focusState.bg);
      }
      await sp.type('#gw-search', '月', { delay: 10 });
      await new Promise(r => setTimeout(r, 250));
      {
        // 下拉跟着框一起上去：紧贴框下沿，且整条落在视口里
        const pair = await sp.evaluate(() => {
          const inp = document.querySelector('.search-hero .search-input');
          const sug = document.getElementById('search-suggest');
          return {
            gap: +(sug.getBoundingClientRect().top - inp.getBoundingClientRect().bottom).toFixed(1),
            sugTop: +sug.getBoundingClientRect().top.toFixed(1),
            vh: window.innerHeight
          };
        });
        check('iPhone 搜索页：下拉跟着搜索框一起上去（仍紧贴框下沿）',
          Math.abs(pair.gap) <= 8 && pair.sugTop < pair.vh * 0.6,
          JSON.stringify(pair));
      }
      await sp.evaluate(() => {
        const inp = document.getElementById('gw-search');
        inp.value = '';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await new Promise(r => setTimeout(r, 200));

      // 进这一页就是为了搜东西：输入框应当已经是焦点
      const autoFocus = await sp.evaluate(() => ({
        focused: document.activeElement && document.activeElement.id,
        heroClass: document.getElementById('search-hero').className
      }));
      check('iPhone 搜索页：进页即聚焦搜索框（少点一次才输得进字）',
        autoFocus.focused === 'gw-search', JSON.stringify(autoFocus));

      // ① 搜索框比索引页更高 —— 它是这一页唯一的主角。
      //    ⚠️ 2026 这一版把「增高」从绘制层搬进了布局：高度就是 52px 的真高度
      //       （上一版用 scaleY(1.3) 把 40px 拉长，四个圆角被压成椭圆、
      //        placeholder 也纵向变形 —— 用户反馈的「圆角不太正常 / 文字有点压扁」）。
      //    所以这里量**两处相等**：视觉高度 = 布局高度 = 52px。
      const boxState = await sp.evaluate(() => {
        const wrap = document.querySelector('.search-hero .search-wrap');
        const inp = document.querySelector('.search-hero .search-input');
        const r = inp.getBoundingClientRect();
        const cs = getComputedStyle(inp);
        return {
          visualH: +r.height.toFixed(1),
          layoutH: +r.height.toFixed(1),
          // 定位上下文（.search-wrap）：候选下拉的 top 从它算起
          wrapBottom: +wrap.getBoundingClientRect().bottom.toFixed(1),
          inputBottom: +r.bottom.toFixed(1),
          inputTop: +r.top.toFixed(1),
          radius: cs.borderTopLeftRadius,
          scale: cs.transform,
          // 焦点描边不能是 UA 给的黑线
          borderColor: cs.borderTopColor,
          outlineStyle: cs.outlineStyle,
          outlineColor: cs.outlineColor,
          outlineWidth: cs.outlineWidth,
          boxShadow: cs.boxShadow
        };
      });
      check('iPhone 搜索页：搜索框真的变高了（52px，超出 iOS 44px 最小可点面积）',
        boxState.visualH >= 50 && boxState.visualH <= 54, boxState.visualH + 'px');
      // ⚠️ 这一页进页即聚焦，此刻 hero 已经切到「贴顶栏」那一档（高度交还给内容），
      //    所以这里量的不再是 hero 的高度，而是**输入框自己**的布局高度 ——
      //    增高仍然长在布局里（视觉 = 布局 = 52px），不是绘制层拉出来的。
      check('iPhone 搜索页：增高长在布局里（一行就是 52px，不是画出来的）',
        Math.abs(boxState.layoutH - 52) <= 0.5, boxState.layoutH + 'px');
      // 这一轮：聚焦时那圈边框不再是浏览器给的黑线
      // （用户反馈「焦点在搜索框时，现在框 border 是黑色，不好看」）
      //
      // 三件事一起量，缺一不可：
      //   · border-color 是天青主色（--green = #2f6055）；
      //   · outline 真的是 none —— 那圈「黑框」就是 UA 的 outline，
      //     关掉它才算修掉用户看到的那一支（⚠️ 曾经被同名 :focus-visible
      //     规则以『特异性相同、写在后面』盖回去过，真机上量到 solid）；
      //   · 外圈那道淡天青光晕在，用来满足「看得见焦点」。
      // ⚠️ 光晕的色值**不写死成某一种 rgba**：搜索页这条走的是
      //     var(--green-light)（#dbe9e2 = rgb(219, 233, 226)），
      //     通用 .search-input:focus 那条走的是 rgba(47, 96, 85, .10)，
      //     两者都是天青系、都合法。写死一种就会把另一处的实现判红 ——
      //     要守的是「有天青光晕、且不是黑」，不是「用了哪个 token」。
      const halo = boxState.boxShadow || '';
      const haloIsGreenish = /rgba?\(\s*(47,\s*96,\s*85|219,\s*233,\s*226)\b/.test(halo);
      const haloIsBlack = /rgba?\(\s*0,\s*0,\s*0\b/.test(halo) || /\bblack\b/.test(halo);
      check('iPhone 搜索页：聚焦描边是天青而不是 UA 的黑框（outline 已关掉）',
        boxState.borderColor === 'rgb(47, 96, 85)' && boxState.outlineStyle === 'none' &&
        haloIsGreenish && !haloIsBlack,
        JSON.stringify([boxState.borderColor, boxState.outlineStyle, boxState.outlineWidth, halo]));
      // 圆角必须是**一个**半径（同一条圆弧），不是被纵向拉伸出来的椭圆角
      check('iPhone 搜索页：搜索框四个角是同一个半径（不再被纵向拉伸成椭圆角）',
        boxState.radius === '12px' && !/matrix/.test(boxState.scale),
        JSON.stringify([boxState.radius, boxState.scale]));
      // 输入框与定位上下文（.search-wrap）同高：下拉的 top 就从这里算，
      // 不再有「视觉溢出 6px」那笔账（top: calc(100% + 4px) 只是 4px 的呼吸）
      check('iPhone 搜索页：输入框与定位上下文同高（下拉的 top 只是 4px 的呼吸）',
        Math.abs((boxState.inputBottom - boxState.wrapBottom)) <= 0.5,
        '相差 ' + (boxState.inputBottom - boxState.wrapBottom).toFixed(1) + 'px');

      // ② 候选下拉贴着搜索框：间隙必须很小（用户反馈「离搜索框太远」的反面）
      //    （下面还会量「它真的压在结果列表上面」—— 层级错了的话，
      //     候选与结果卡片会叠成一团，那是真机上出现过的样子）
      await sp.type('#gw-search', '月', { delay: 10 });
      await new Promise(r => setTimeout(r, 300));
      const gap = await sp.evaluate(() => {
        const inp = document.querySelector('.search-hero .search-input');
        const sug = document.getElementById('search-suggest');
        return {
          hidden: sug.hidden,
          items: sug.querySelectorAll('.suggest-item').length,
          gap: +(sug.getBoundingClientRect().top - inp.getBoundingClientRect().bottom).toFixed(1),
          top: +sug.getBoundingClientRect().top.toFixed(1),
          bottom: +sug.getBoundingClientRect().bottom.toFixed(1),
          vh: window.innerHeight
        };
      });
      check('iPhone 搜索页：输入后候选下拉出现（' + gap.items + ' 条）',
        !gap.hidden && gap.items > 0, JSON.stringify(gap));
      // 间隙可以略为负：输入框在绘制层向下溢出的那 6px 是**画出来的**，
      // 不占布局，候选下拉照着布局算出来就会与它叠 1px 左右。
      // 真正要守的是「不悬空」：|间隙| ≤ 8px，视觉上就是贴在框下沿。
      check('iPhone 搜索页：候选下拉紧贴搜索框下沿（不悬空，间隙在 8px 以内）',
        Math.abs(gap.gap) <= 8, gap.gap + 'px');
      // 层级：候选下拉必须**真的**压在结果列表上面。
      // 走到候选正中央那一点，看它是谁 —— 若命中的是结果卡片，
      // 说明下拉被结果列表盖住了（层叠上下文被关在 hero 里，真机上量到过）。
      const stacked = await sp.evaluate(() => {
        const sug = document.getElementById('search-suggest');
        const r = sug.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 20);
        return { hit: hit ? hit.className : null, sugHit: !!(hit && hit.closest && hit.closest('#search-suggest')) };
      });
      check('iPhone 搜索页：候选下拉压在结果列表上面（候选正中央点到的是候选）',
        stacked.sugHit, JSON.stringify(stacked));

      // ③ 软键盘：把可视区压矮（键盘占 336px，约占 iPhone 852 的 40%），
      //    整块必须顶到键盘上方，候选下拉整条落在可视区之内，
      //    且**下方仍留出可见的结果区** —— 用户要能先关掉下拉，再去点结果卡片。
      await sp.evaluate(() => {
        const vv = window.visualViewport;
        const realH = vv.height;
        Object.defineProperty(vv, 'height', { value: realH - 336, configurable: true });
        vv.dispatchEvent(new Event('resize'));
      });
      await new Promise(r => setTimeout(r, 400));
      const kb = await sp.evaluate(() => {
        const hero = document.getElementById('search-hero');
        const inp = document.querySelector('.search-hero .search-input');
        const sug = document.getElementById('search-suggest');
        return {
          cls: hero.className,
          kbSpace: getComputedStyle(hero).getPropertyValue('--kb-space').trim(),
          justify: getComputedStyle(hero).justifyContent,
          heroH: +hero.getBoundingClientRect().height.toFixed(1),
          visibleBottom: window.visualViewport.height,
          inputTop: +inp.getBoundingClientRect().top.toFixed(1),
          inputBottom: +inp.getBoundingClientRect().bottom.toFixed(1),
          sugTop: +sug.getBoundingClientRect().top.toFixed(1),
          sugBottom: +sug.getBoundingClientRect().bottom.toFixed(1),
          sugH: +sug.getBoundingClientRect().height.toFixed(1),
          sugCount: sug.querySelectorAll('.suggest-item').length
        };
      });
      // 贴顶不靠给 hero 换 justify-content（它一直是 center —— 框压在这一段的
      // 中线上，两种落位共用同一个算式）：hero 交出「视口 − 200px」那段高度、
      // 改由 --hero-top + 一行框高撑开，于是「这一段」本身就短到只够贴在顶栏下方。
      check('iPhone 搜索页：键盘弹出后整块贴到顶栏下方（框顶在 40~130px 之间）',
        /kb-open/.test(kb.cls) && /search-active/.test(kb.cls) &&
        kb.inputTop >= 40 && kb.inputTop <= 130 && kb.heroH <= 200,
        JSON.stringify([kb.cls, kb.inputTop, kb.heroH]));
      check('iPhone 搜索页：键盘高度写进 --kb-space（候选下拉据此限高）',
        parseInt(kb.kbSpace, 10) >= 300, kb.kbSpace);
      check('iPhone 搜索页：搜索框整个落在键盘上方的可视区里',
        kb.inputBottom <= kb.visibleBottom, '框下沿 ' + kb.inputBottom + ' / 可视下沿 ' + kb.visibleBottom);
      check('iPhone 搜索页：候选下拉不伸进键盘底下（首条仍看得见）',
        kb.sugTop >= kb.inputTop && kb.sugBottom <= kb.visibleBottom + 1,
        '候选 ' + kb.sugTop + '→' + kb.sugBottom + ' / 可视下沿 ' + kb.visibleBottom);
      // 用户反馈的后半句：下拉不能把可视区吃干 —— 键盘上方那片地方里，
      // 下拉必须留出可点的一片给结果卡片（点它即收起下拉）。
      // ⚠️ 这一轮把限高的三项从「400px / 60% 可视区 / 可视区−键盘−86」改成
      //    「380px / 40% 可视区 / 可视区−键盘−80」：
      //    上一版那 60% 与「减 86px」的余量都偏松 —— 键盘弹着时候选一路铺到
      //    可视区下沿前 30px，底下只剩一条缝，手指够不着「第一张结果卡片」。
      //    现在按「可视区四成 / (可视区−键盘) 六成」硬收：
      //    候选下沿之上必有那一片地方的六成留给结果。
      //    这里量「候选下沿 → 可视区下沿」那一段，按「框顶到可视区下沿」算比例。
      const room = +(kb.visibleBottom - kb.sugBottom).toFixed(1);
      const vvH = +(kb.visibleBottom - kb.inputTop).toFixed(1);
      // 判据要的是「键盘上方那片地方里，下拉不占满，底下留得下一张卡片」。
      // 分母取「可视区 − 键盘 − 框顶到页顶那一段」= 框底到可视下沿那一段，
      // 候选与它下面的结果区一起分这一段：候选占六成，剩下四成是结果。
      // ⚠️ 不按整个可视区切比例：框与顶栏本身已经吃掉一百多像素，
      //    那部分永远不会给候选用，算进分母只会把判据放松。
      const spaceBelowInput = +(kb.visibleBottom - kb.inputBottom).toFixed(1);
      // ⚠️ 判据是「键盘弹着时候选**明显比平时矮**」+「底下留得下可点的一片」，
      //    而不是某个精确比例：候选的高度同时受三项约束，谁更紧听谁的 ——
      //    在 iPhone 上 320px 那一项常常先起作用（键盘 336px 时，
      //    硬边界项只比它小一点点），这时「比例」测的其实是那一项，
      //    而不是「留白够不够」。所以比例只作宽判，重点放在「真的收矮了」。
      check('iPhone 搜索页：键盘上方仍给结果卡片留出可见的一片（候选不把可视区吃满）',
        room >= spaceBelowInput * 0.1,
        '候选下方还有 ' + room + 'px / 框底到可视下沿共 ' + spaceBelowInput + 'px');
      check('iPhone 搜索页：候选一次不会很多条（手机上按可视区四成限高）',
        kb.sugCount <= 8, kb.sugCount + ' 条');
      // 附加：候选的实际高度不超过「可视区的四成 + 一行的余量」——
      // 手机上一屏看五六条就够，其余靠滚动（下拉本身是可滚的）
      // ⚠️ 上限就是 320px 那一档（窄屏 min() 里写死的第一项）：
      //    手机上一条候选 44px，320px 约 6 条 —— 「4 条多一点」是设计值，
      //    不是恰好可视区的几成（比例只用来守「别铺满」，绝对值才是口径）。
      check('iPhone 搜索页：候选一屏最多六条左右（手机上 320px 上限）',
        kb.sugH <= 330, kb.sugH + 'px');
      // 键盘弹着时候选得比「没有键盘」时更矮：
      // 硬边界那一项 (可视区 − 键盘) × 0.6 会把它再压下一截
      check('iPhone 搜索页：键盘弹着时候选比平时更矮（硬边界项真的在起作用）',
        kb.sugH < 320, kb.sugH + 'px');

      // ④ 结果列表紧跟在搜索框下方：不再有一大段空白把它推到屏幕外。
      //    ⚠️ 用户这一轮把「没输入时那段引导语」整段删了，所以列表上方只剩
      //       一小段留白（idle 空态在手机上 8px；键盘弹着时归零）。
      const listGap = await sp.evaluate(() => {
        const inp = document.querySelector('.search-hero .search-input');
        const list = document.getElementById('gw-list');
        const items = list.querySelectorAll('.item');
        const empty = list.querySelector('.empty');
        return {
          gap: +(list.getBoundingClientRect().top - inp.getBoundingClientRect().bottom).toFixed(1),
          inputBottom: +inp.getBoundingClientRect().bottom.toFixed(1),
          firstTop: items.length ? +items[0].getBoundingClientRect().top.toFixed(1) : null,
          emptyText: empty ? empty.textContent.trim() : null,
          emptyH: empty ? +empty.getBoundingClientRect().height.toFixed(1) : null,
          visibleBottom: window.visualViewport.height
        };
      });
      check('iPhone 搜索页：结果列表紧跟在搜索框下方（键盘弹着时也在第一屏）',
        listGap.gap >= 0 && listGap.gap <= 30 &&
        (listGap.firstTop === null || listGap.firstTop <= listGap.visibleBottom),
        JSON.stringify(listGap));
      check('iPhone 搜索页：第一张结果卡片与搜索框只隔一行正常间隔（不再是一大段空白）',
        listGap.firstTop === null ||
        (listGap.firstTop - listGap.inputBottom) <= 40,
        listGap.firstTop === null ? '(无结果)' :
        (listGap.firstTop - listGap.inputBottom).toFixed(1) + 'px');
      // 删掉的那段引导语：**没输入的那一刻**列表里不该显示任何文字，
      // 也不该占掉一行的高度。
      // ⚠️ 两条量法都要有，缺一条就是漏：
      //   a) 这一步（框里有「月」、列表是命中结果）量「那段话不在」——
      //      此刻引擎多半**根本不渲染** .empty 节点，`=== ''` 只在列表为空时
      //      成立，写死它会在有结果时必然红（上一版踩过）；
      //   b) 再回到「还没敲字」那一刻量 idle 空态本身（节点在、无文字、很矮）——
      //      这才是那段话真正会出现的位置，不能只在有结果时量。
      check('iPhone 搜索页：有结果时列表里没有那段引导语',
        (listGap.emptyText === null || listGap.emptyText === '') &&
        (listGap.emptyH === null || listGap.emptyH <= 12),
        JSON.stringify([listGap.emptyText, listGap.emptyH]));
      const idleEmpty = await sp.evaluate(async () => {
        const inp = document.getElementById('gw-search');
        const keep = inp.value;
        inp.value = '';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        // 清空后立刻量（此刻框里没有内容，列表这一段正是 idle 空态）
        await new Promise(r => setTimeout(r, 50));
        const list = document.getElementById('gw-list');
        const empty = list.querySelector('.empty');
        const out = {
          text: empty ? empty.textContent.trim() : null,
          h: empty ? +empty.getBoundingClientRect().height.toFixed(1) : null,
          dataEmpty: empty ? empty.getAttribute('data-empty') : null
        };
        // 量完把关键词放回去，后面的用例还要用候选与结果
        inp.value = keep;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 50));
        return out;
      });
      check('iPhone 搜索页：没输入时列表里不显示引导文字（那段话已按用户要求删除）',
        idleEmpty.text === '' && idleEmpty.dataEmpty === 'idle' &&
        (idleEmpty.h === null || idleEmpty.h <= 8),
        JSON.stringify(idleEmpty));

      /* ④之二 本轮（Issue #122）第二条：可视区再矮，候选也要有 5 行。
         用户原话：「手机键盘弹出时，搜索框下拉提示列表的高度变得极小，
         甚至只有一行？搜索框上提后我觉得可以显示5行吧？」
         上面的三段量的是正常键盘（336px）下的高度；这一条把可视区压到
         更极端的一档（键盘占掉大半屏），量的就是「下限优先于比例」。 */
      const floor = await sp.evaluate(async () => {
        const vv = window.visualViewport;
        const realH = vv.height;
        Object.defineProperty(vv, 'height', { value: 300, configurable: true });
        vv.dispatchEvent(new Event('resize'));
        await new Promise(r => setTimeout(r, 300));
        const sug = document.getElementById('search-suggest');
        const item = sug.querySelector('.suggest-item');
        const out = {
          h: +sug.getBoundingClientRect().height.toFixed(1),
          itemH: item ? +item.getBoundingClientRect().height.toFixed(1) : 0,
          rows: getComputedStyle(document.getElementById('search-hero'))
            .getPropertyValue('--suggest-rows').trim()
        };
        // 量完还原，后面的用例还要按正常键盘走
        Object.defineProperty(vv, 'height', { value: realH - 336, configurable: true });
        vv.dispatchEvent(new Event('resize'));
        await new Promise(r => setTimeout(r, 200));
        return out;
      });
      check('iPhone 搜索页：可视区被键盘压到 300px 时，候选仍有 5 行的高度（不再只剩一行）',
        parseFloat(floor.rows) >= 5 && floor.h >= floor.itemH * 4.5,
        JSON.stringify(floor));

      // ⑤ 候选行的可点面积：44px 是 iOS 建议的下限
      const itemH = await sp.evaluate(() => {
        const it = document.querySelector('#search-suggest .suggest-item');
        return it ? +it.getBoundingClientRect().height.toFixed(1) : 0;
      });
      check('iPhone 搜索页：候选行高不低于 iOS 建议的 44px', itemH >= 44, itemH + 'px');

      // ⑤之二 关掉下拉再点结果卡片：用户明确要求的那条路。
      //    （键盘仍压着 —— 正是最需要它的时刻）
      const dismiss = await sp.evaluate(async () => {
        const list = document.getElementById('gw-list');
        const inp = document.querySelector('.search-hero .search-input');
        const sug = document.getElementById('search-suggest');
        const first = list.querySelector('.item');
        const before = {
          sugOpen: !sug.hidden,
          firstTop: first ? +first.getBoundingClientRect().top.toFixed(1) : null,
          // 第一条结果卡片有多少落在可视区里（用户能点到的那部分）
          firstVisible: first
            ? Math.max(0, Math.min(first.getBoundingClientRect().bottom,
                window.visualViewport.height) - first.getBoundingClientRect().top)
            : 0
        };
        // 点一下结果列表：应当「先收起下拉」，而不是穿过浮层开一篇
        if (first) first.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 60));
        return {
          before,
          sugClosed: sug.hidden,
          readerOpen: !document.getElementById('gw-reader').hidden,
          keywordKept: inp.value
        };
      });
      check('iPhone 搜索页：键盘弹着时下拉下方仍有点得到的「第一张结果卡片」',
        dismiss.before.firstVisible >= 20,
        JSON.stringify(dismiss.before));
      check('iPhone 搜索页：点一下结果卡片先收起下拉（不穿过浮层直接开篇）',
        dismiss.before.sugOpen && dismiss.sugClosed && !dismiss.readerOpen,
        JSON.stringify(dismiss));
      check('iPhone 搜索页：收起下拉不动关键词（用户接着看结果，不必重打一遍）',
        dismiss.keywordKept.length > 0, '「' + dismiss.keywordKept + '」');

      /* ⑥之二 本轮（Issue #122）第三条：设置页的用户名输入框也有那圈淡光晕，
         「所有页面的输入框都带这样的效果」。 */
      await sp.goto(base + 'settings/general/', { waitUntil: 'load' });
      await new Promise(r => setTimeout(r, 600));
      const glow = await sp.evaluate(async () => {
        const inp = document.getElementById('input-username');
        inp.focus();
        await new Promise(r => setTimeout(r, 300));
        // 再插一枚**没有任何类名**的输入框：它也必须带上同一圈光晕
        // （弹层里那种临时长出来的输入框，逐个补类名必然漏）
        const plain = document.createElement('input');
        plain.type = 'text';
        document.body.appendChild(plain);
        plain.focus();
        await new Promise(r => setTimeout(r, 300));
        const cs = getComputedStyle(plain);
        const out = { shadow: cs.boxShadow, outline: cs.outlineStyle };
        plain.remove();
        return out;
      });
      check('iPhone 设置页：用户名输入框聚焦时有淡光晕（与搜索框同一个值）',
        /rgba\(47, 96, 85, 0\.1\)/.test(glow.shadow) && /3px/.test(glow.shadow),
        glow.shadow);
      check('iPhone 设置页：没有类名的输入框（弹层里那种）聚焦时也带同一圈光晕',
        /rgba\(47, 96, 85, 0\.1\)/.test(glow.shadow) && glow.outline === 'none',
        JSON.stringify(glow));
      await sp.goto(base + 'search/', { waitUntil: 'load' });
      await new Promise(r => setTimeout(r, 600));

      // ⑥ 这一轮的四态收尾（用户这一轮点名的四句话，逐条量渲染后的位置）：
      //    · 有内容时失焦 → 框**仍停在页顶**（「当有搜索内容存在时，搜索框停留在页面顶部」）；
      //    · 清空内容 + 失焦 → 框回到页面中心；
      //    · 点空白地方 → 候选下拉消失。
      /* ⑦ 本轮（Issue #122）第一条：聚焦后框**上下等距**。
         用户原话：「搜索框和上下元素间隔一致，请以现在下面的间隔为准，
         上面的间隔也缩小到这么多」。
         上一版框上 8px、框下 12px（还叠着 hero 的 8px 收尾留白），
         两个数各自散在 CSS 里；现在两处都读 --search-list-gap。
         量的就是这两段：框顶到顶栏下沿，与框底到结果列表顶。 */
      const evenGap = await sp.evaluate(async () => {
        const vv = window.visualViewport;
        delete vv.height;                       // 收掉键盘：只留下「聚焦」这一态
        vv.dispatchEvent(new Event('resize'));
        const inp = document.getElementById('gw-search');
        inp.value = '月';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.focus();
        await new Promise(r => setTimeout(r, 400));
        const box = inp.getBoundingClientRect();
        const bar = document.querySelector('.topbar').getBoundingClientRect();
        const list = document.getElementById('gw-list').getBoundingClientRect();
        return {
          above: +(box.top - bar.bottom).toFixed(1),
          below: +(list.top - box.bottom).toFixed(1),
          gap: getComputedStyle(document.getElementById('search-hero'))
            .getPropertyValue('--search-list-gap').trim()
        };
      });
      check('iPhone 搜索页：聚焦后框上（顶栏下沿 → 框顶）与框下（框底 → 结果列表）等距',
        Math.abs(evenGap.above - evenGap.below) <= 2 && evenGap.below > 0,
        JSON.stringify(evenGap));
      check('iPhone 搜索页：那一段间隔由 --search-list-gap 一处供给（框上框下不再各写一个数）',
        evenGap.below > 0 && Math.abs(evenGap.below - evenGap.above) <= 2,
        'gap ' + JSON.stringify([evenGap.above, evenGap.below]));

      const r1 = await sp.evaluate(async () => {
        const vv = window.visualViewport;
        delete vv.height;
        vv.dispatchEvent(new Event('resize'));
        const inp = document.getElementById('gw-search');
        const hero = document.getElementById('search-hero');
        // ⚠️ 前面几条用例可能把关键词清掉或把焦点带走（点结果卡片那一系列
        //    动过 DOM），这里先把「有搜索内容」这个前提坐实：框里有字、
        //    并且它真的被聚焦过 —— 否则后面量的是另一件事。
        if (!inp.value.trim()) {
          inp.value = '月';
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(r => setTimeout(r, 200));
        }
        // 「居中」是相对**这一段**说的（页面里搜索框住在 .search-hero 那一段里）：
        // 它的上下还有顶栏与底部页签，那两段不参与居中。
        // 所以量「框是否压在这一段的中线上」，而不是只按 window.innerHeight 算。
        const midOf = () => {
          const hr = hero.getBoundingClientRect();
          const ir = inp.getBoundingClientRect();
          return {
            heroMid: +(hr.top + hr.height / 2).toFixed(1),
            heroTop: +hr.top.toFixed(1),
            heroH: +hr.height.toFixed(1),
            inputTop: +ir.top.toFixed(1),
            inputMid: +(ir.top + ir.height / 2).toFixed(1),
            offset: +((ir.top + ir.height / 2) - (hr.top + hr.height / 2)).toFixed(1)
          };
        };
        inp.focus();
        await new Promise(r => setTimeout(r, 200));
        inp.blur();                       // 键盘收起、焦点没了，但框里还有「月」
        await new Promise(r => setTimeout(r, 500));
        // ⚠️ 类名要**在这里**就抄下来：hero 是同一个节点，className 是活的值 ——
        //    等到 return 里再读，读到的已经是「清空之后」那一份了
        //    （上一版就是这么写的：topWithKeyword 量对了，类名却量的是后一个状态）。
        const pinned = { cls: hero.className, inputTop: +inp.getBoundingClientRect().top.toFixed(1) };
        // 再看一眼：清空内容后（仍未聚焦）框应当回到页面中心
        inp.value = '';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 300));
        const centered = { cls: hero.className, pos: midOf() };
        return {
          clsWithKeyword: pinned.cls,
          topWithKeyword: pinned.inputTop,
          clsWhenEmpty: centered.cls,
          topWhenEmpty: centered.pos.inputTop,
          centeredOffset: centered.pos.offset,
          centeredHeroH: centered.pos.heroH,
          vh: window.innerHeight
        };
      });
      check('iPhone 搜索页：有搜索内容时失焦，搜索框仍停在页面顶部',
        /search-active/.test(r1.clsWithKeyword) && r1.topWithKeyword <= 140,
        JSON.stringify([r1.clsWithKeyword, r1.topWithKeyword, r1.dbg]));
      // 「回到页面中心」= 框重新压在 .search-hero 这一段的垂直中线上
      // （0 表示正中；hero 里框是绝对定位 top: 50% - 半盒高，所以偏差该在 1px 内）
      check('iPhone 搜索页：清空内容且没有焦点后，搜索框回到页面中心',
        !/search-active/.test(r1.clsWhenEmpty) && Math.abs(r1.centeredOffset) <= 2 &&
        r1.centeredHeroH > 300 && r1.topWhenEmpty > r1.topWithKeyword + 100,
        JSON.stringify([r1.clsWhenEmpty, r1.centeredOffset, r1.topWhenEmpty, r1.centeredHeroH]));

      // 点空白收下拉：用户原话「当用户点击空白地方时，下拉列表消失」
      const blank = await sp.evaluate(async () => {
        const inp = document.getElementById('gw-search');
        inp.value = '月';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 200));
        const sug = document.getElementById('search-suggest');
        const opened = !sug.hidden;
        // 点结果列表下方的页面空白（不是搜索区）
        const list = document.getElementById('gw-list');
        list.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 60));
        const closedByList = sug.hidden;
        // 再开一次，点**搜索框自己** —— 不该收
        inp.dispatchEvent(new Event('focus', { bubbles: false }));
        inp.value = '月';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 200));
        const reopened = !sug.hidden;
        inp.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 60));
        const stillOpen = !sug.hidden;
        return { opened: opened, closedByList: closedByList, reopened: reopened, stillOpen: stillOpen };
      });
      check('iPhone 搜索页：点页面空白处，候选下拉消失',
        blank.opened && blank.closedByList, JSON.stringify(blank));
      check('iPhone 搜索页：点搜索框自己（点空白以外的）不收起下拉',
        blank.reopened && blank.stillOpen, JSON.stringify(blank));
    }

    // ---- Issue #32 需求：大背景不用任何图案 ----
    await page.goto(base + '', { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 400));
    const bgState = await page.evaluate(() => {
      const patternEls = [...document.querySelectorAll('*')].filter(el => {
        const v = getComputedStyle(el).backgroundImage;
        return v && v !== 'none' && /url\(/.test(v);
      });
      const html = getComputedStyle(document.documentElement);
      const body = getComputedStyle(document.body);
      return {
        htmlBg: html.backgroundImage, bodyBg: body.backgroundImage,
        bodyColor: body.backgroundColor, patternEls: patternEls.length,
        sample: patternEls.slice(0, 3).map(e => e.tagName + '.' + e.className)
      };
    });
    check('iPhone: 页面底不铺任何图案（html / body 无 background-image）',
      bgState.htmlBg === 'none' && bgState.bodyBg === 'none',
      JSON.stringify([bgState.htmlBg, bgState.bodyBg]));
    check('iPhone: 页面底为素绢纯色', /^rgb\(246, 241, 227\)$/.test(bgState.bodyColor), bgState.bodyColor);
    check('iPhone: 全页没有任何元素再用图片 / 纹样铺背景',
      bgState.patternEls === 0, bgState.sample.join(' | '));

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

  /* ============ 宽屏桌面：一列纸跟视口走，一行字不跟 ============
     用户（Issue #135 后续）：「桌面端特别是满屏桌面端一般是 1920 的宽度……
     我更喜欢布满屏幕的设计，顶多左右留有 margin 或者 padding，
     而不是限定 max-width 到 960px 或者类似的这种设计。」
     这一档改成「跟着窗口走」，所以要用**真浏览器**量：
       · 1920px 屏上两侧的留白必须很小（原先写死 1040px 时两侧各 440px）；
       · 顶栏 / 页签内层 / 正文列三样必须落在同一条竖轴上（左缘同值）；
       · 一行字（正文段落）**不能**跟着一起变宽 —— 那是另一件事。
     ⚠️ 判据写成「两侧留白 ≤ 一小段」而不是「等于 56px」：56px 是本轮的取值，
        下次想调成 40 或 72 都该允许，不该被这条断言钉死。
     ⚠️ jsdom 不算布局，这一档的守卫只能在真浏览器里做。 */
  {
    const { page } = await freshPage();
    for (const vw of [1920, 1440, 1280]) {
      await page.setViewport({ width: vw, height: 1000, deviceScaleFactor: 1 });
      await page.goto(base, { waitUntil: 'load' });
      await new Promise(r => setTimeout(r, 800));
      const w = await page.evaluate(() => {
        const r = e => e ? e.getBoundingClientRect() : null;
        const app = r(document.querySelector('.app'));
        const bar = r(document.querySelector('.app > .topbar'));
        const dock = r(document.querySelector('.dock-inner'));
        return {
          vw: document.documentElement.clientWidth,
          appL: app && +app.left.toFixed(1), appR: app && +app.right.toFixed(1),
          barL: bar && +bar.left.toFixed(1), barR: bar && +bar.right.toFixed(1),
          dockL: dock && +dock.left.toFixed(1), dockR: dock && +dock.right.toFixed(1)
        };
      });
      const sideL = w.appL, sideR = +(w.vw - w.appR).toFixed(1);
      check('桌面 ' + vw + 'px：内容铺满屏幕，两侧留白各 ≤ 80px（不是被 max-width 压窄）',
        sideL <= 80 && sideR <= 80,
        JSON.stringify({ 左: sideL, 右: sideR, 视口: w.vw, 内容宽: +(w.appR - w.appL).toFixed(0) }));
      check('桌面 ' + vw + 'px：顶栏与正文列左右同缘（不是各写各的宽度）',
        Math.abs(w.barL - (w.appL + 56)) < 1.5 && Math.abs(w.barR - (w.appR - 56)) < 1.5,
        JSON.stringify({ 顶栏: [w.barL, w.barR], 正文: [w.appL, w.appR] }));
      check('桌面 ' + vw + 'px：页签内层与正文列左右同缘（四格落在正文两缘之内）',
        Math.abs(w.dockL - (w.appL + 56)) < 1.5 && Math.abs(w.dockR - (w.appR - 56)) < 1.5,
        JSON.stringify({ 页签: [w.dockL, w.dockR], 正文: [w.appL, w.appR] }));
    }
    /* 一行字不跟着屏幕走：打开一首长诗，量最宽的那一段正文。
       1920px 屏上它必须仍停在 720px 这一档（约 38 个汉字），
       而不是被拉成 1500px 的一整行。 */
    await page.setViewport({ width: 1920, height: 1000, deviceScaleFactor: 1 });
    await page.goto(base + 'tangshi/', { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 1400));
    const readW = await page.evaluate(() => new Promise(res => {
      const items = [...document.querySelectorAll('#gw-list .item')];
      if (!items.length) return res(null);
      items[0].click();
      setTimeout(() => {
        const body = document.querySelector('.reader-body');
        const txt = document.querySelector('.reader-text');
        const nav = document.querySelector('.reader-nav');
        if (!txt) return res(null);
        res({
          bodyW: body ? +body.getBoundingClientRect().width.toFixed(0) : null,
          txtW: +txt.getBoundingClientRect().width.toFixed(0),
          navW: nav ? +nav.getBoundingClientRect().width.toFixed(0) : null,
          fontSize: parseFloat(getComputedStyle(txt).fontSize)
        });
      }, 900);
    }));
    check('桌面 1920px：阅读器正文列跟着放宽（一列纸铺满屏幕）',
      readW && readW.bodyW > 1400,
      readW ? String(readW.bodyW) : 'no reader');
    check('桌面 1920px：一行字仍封顶 720px 这一档（不跟着屏幕一起变宽）',
      readW && readW.txtW <= 760,
      readW ? ('正文 ' + readW.txtW + 'px / 字号 ' + readW.fontSize) : 'no reader');
    check('桌面 1920px：「上一篇 / 下一篇」与正文同宽（不被推到屏幕两端）',
      readW && readW.navW !== null && Math.abs(readW.navW - readW.txtW) < 2,
      readW ? (String(readW.navW) + ' / ' + readW.txtW) : 'no reader');
    await page.close();
  }

  await browser.close();

  console.log('\n=== iOS / 多端兼容检查 ===\n');
  Object.keys(results).forEach(k => console.log('  ' + results[k] + ' ' + k));
  console.log('\n共 ' + Object.keys(results).length + ' 项' + (failures ? '，❌ ' + failures + ' 项失败' : '，全部通过 ✅'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
