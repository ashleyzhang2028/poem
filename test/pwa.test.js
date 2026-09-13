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
    // 目录化 URL：小古文页预缓存的地址是 /classic/（不再是 classic.html）
    check('iPhone: 已预缓存小古文页与数据',
      cached.some(p => /\/classic\/?$/.test(p)) && cached.some(p => /poems-classic\.js$/.test(p)),
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

    // 首页与小古文页的页签同样不能压住内容
    for (const [file, label] of [['', '/（首页）'], ['classic/', '/classic/']]) {
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

    // 断网也能进设置页（法务链接与设置项都必须可达）
    await page.setOfflineMode(true);
    await page.goto(base + 'settings/', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 900));
    const settingsOffline = await page.evaluate(() => ({
      hasPage: !!document.querySelector('#settings-page'),
      hasFoot: !!document.querySelector('.settings-foot a[href*="/terms/"]'),
      hasHelper: !!document.querySelector('#seg-helper')
    }));
    check('iPhone: 断网也能打开设置整页', settingsOffline.hasPage && settingsOffline.hasHelper && settingsOffline.hasFoot,
      JSON.stringify(settingsOffline));
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
      // 「画出来的圆」直径 = 盒子的**内容盒**（width / height 声明值）。
      // 这正是 CSS 里两个变量想表达的东西：width/height = 40px 的圆；
      // `<button>` 的 UA 默认内边距（1px 6px）会让外盒矩形变宽变高
      // （42×42 → 加上内边距就是 52×42），所以只认内容盒尺寸，
      // 内边距一出现就说明有 UA 默认值没被清掉 —— 下面单独断言。
      const paintedCircle = el => {
        const cs = getComputedStyle(el);
        return { w: +parseFloat(cs.width).toFixed(2), h: +parseFloat(cs.height).toFixed(2), box: cs.boxSizing };
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
      + '（' + todayRing.readCircle.box + '，外盒矩形 ' + todayRing.read.w + '×' + todayRing.read.h + '）');
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
          text: el.textContent.trim()
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
        playGapRight: +(arrowRect.left - playRect.right).toFixed(2),
        barContent: bar.content,
        padL: itemPad.paddingLeft,
        padR: itemPad.paddingRight,
        // Issue #55 后续（本轮）：卡头那一行「多 4px」只加在**左侧**，
        // 右侧那颗 26px 圆键的内缘仍与条目里的右箭头同宽（都是 8px）。
        headPadL: getComputedStyle(head).paddingLeft,
        headPadR: getComputedStyle(head).paddingRight,
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
    check('iPhone: 序号圆与右侧箭头内缘只差新加的这 4px（右侧没被一起推走）',
      Math.abs(numState.numLeftInset - (numState.arrowRightInset + 4)) <= 0.5,
      JSON.stringify({ numLeft: numState.numLeftInset, arrowRight: numState.arrowRightInset }));
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
    check('iPhone: 卡头行右端圆键仍贴 8px 右内缘（右侧内缘与条目同值）',
      Math.abs(parseFloat(numState.headPadR) - parseFloat(numState.padR)) <= 0.5,
      JSON.stringify({ head: numState.headPadR, item: numState.padR }));
    // 需求（Issue #55 后续）：左侧那道「短竖条」整体隐藏，不再渲染 ::before
    check('iPhone: 左侧短竖条已隐藏（条目不再渲染 ::before 竖条）',
      !numState.barContent || numState.barContent === 'none',
      JSON.stringify(numState.barContent));
    check('iPhone: 卡头与首条之间留出间距（不再贴着分隔线）',
      numState.gapHeadBtnToItem >= 6, numState.gapHeadBtnToItem + 'px');
    // 需求（Issue #55 后续）：播放键左侧的间距归零，那段空档整个让给正文。
    // 上一轮用 `margin-left: -12px` 去「抵掉」这段间距，量出来的 playGapLeft 是
    // **负的 -12px** —— 圆键压在内容块右缘上画；本轮把负外边距去掉，同时把
    // 内容块改成按内容取宽（见下一条），间距回落成一根线：0 或 1px（子像素取整）。
    check('iPhone: 播放键左侧没有负外边距（圆键不再压住正文）',
      numState.playGapLeft >= 0, numState.playGapLeft + 'px');
    check('iPhone: 播放键左缘就贴在内容块右缘（间距 ≤ 1px）',
      numState.playGapLeft <= 1, numState.playGapLeft + 'px');
    check('iPhone: 圆键本体没被压小（仍是 36px 正圆）',
      Math.abs(numState.playW - 36) <= 0.5, numState.playW + 'px');
    check('iPhone: 播放键右侧（与箭头之间）仍是 6px，未被一起改动',
      Math.abs(numState.playGapRight - 6) <= 0.5, numState.playGapRight + 'px');
    // 需求（Issue #55 后续）：左侧正文的宽度真的放开（本轮的正主）。
    // 只把播放键的间距改小**不会**让正文变长：内容块是全站那句 `flex: 1 1 0%`，
    // 宽度只由「条目宽 − 两侧图标 − 列距 − 内边距」分配而来，与内容宽度无关。
    // 窄屏上它照样被压满整行，而右端三件套（圆键 / 6px / 箭头）钉在原地，
    // 于是内容块名义上「变宽」也只是宽到圆键底下，正文并不会多一个字。
    // 这里量两件事：
    //   1) 内容块宽度小于整行留给它的空间（= 它没有把整行撑满，是按内容取的宽）；
    //   2) 圆键左缘仍在原位（右端三件套没动，正文那一行的可用宽度没被吃掉）。
    check('iPhone: 小古文内容块不再撑满整行（按内容取宽，不是 flex 增长项）',
      numState.mainW < 393 - 12 - 8 - 36 - 6 - 18 - 1,
      numState.mainW + 'px（整行 ' + 393 + 'px）');
    check('iPhone: 内容块宽度仍大于最长标题 / 副信息的自然宽（文字没被压窄）',
      numState.mainW >= 226, numState.mainW + 'px');

    // 需求（Issue #55 后续）：搜索框提示字垂直居中。
    // 提示字走 ::placeholder 伪元素，且比输入文字小一档（12.5px vs 16px）——
    // 浏览器按**输入框的**字体排基线，提示字因此沉到框中线以下。
    // 这里量两件事：
    //   1) ::placeholder 确实带着一个向上的位移（CSS 里写死 2.25px）；
    //   2) 位移量 = 两档字号「行盒中心」的差 =（16px − 12.5px）/ 2 = 1.75px……
    //      实测下沉约 2.25px（含字形墨迹），位移必须为正且落在合理区间，
    //      不能是 0（那样仍偏下），也不能大到把提示字顶出框。
    const phState = await page.evaluate(() => {
      const inp = document.querySelector('.search-input');
      const cs = getComputedStyle(inp);
      const ph = getComputedStyle(inp, '::placeholder');
      const shift = (() => {
        const m = /matrix\(1, 0, 0, 1, 0, (-?[\d.]+)\)/.exec(ph.transform);
        return m ? parseFloat(m[1]) : 0;
      })();
      return {
        phFont: ph.fontSize, inputFont: cs.fontSize,
        shift: +shift.toFixed(2),
        padTop: cs.paddingTop, padBottom: cs.paddingBottom,
        lh: cs.lineHeight
      };
    });
    check('iPhone: 提示字仍比输入文字小一号（辅助文字不抢眼）',
      phState.phFont === '12.5px' && phState.inputFont === '16px',
      JSON.stringify([phState.phFont, phState.inputFont]));
    check('iPhone: 提示字上抬回正中轴（位移 = 两档字号行盒中心差）',
      phState.shift === -2.25, 'shift ' + phState.shift + 'px');
    check('iPhone: 输入框本体不做垂直方向的 padding / line-height 改动',
      parseFloat(phState.padTop) === 0 && parseFloat(phState.padBottom) === 0 &&
      phState.lh === 'normal',
      JSON.stringify([phState.padTop, phState.padBottom, phState.lh]));

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

  await browser.close();

  console.log('\n=== iOS / 多端兼容检查 ===\n');
  Object.keys(results).forEach(k => console.log('  ' + results[k] + ' ' + k));
  console.log('\n共 ' + Object.keys(results).length + ' 项' + (failures ? '，❌ ' + failures + ' 项失败' : '，全部通过 ✅'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
