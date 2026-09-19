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

  if (!(await browserAvailable())) {
    console.log("跳过 PWA 测试（当前环境无法启动 Chrome，通常是缺少系统库 libnspr4 / libnss3 / libatk）");
    process.exit(0);
  }

  const browser = await puppeteer.launch({

    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  const base = process.env.BASE_URL || 'http://localhost:8080/';

  const freshPage = async () => {
    const ctx = await browser.createBrowserContext();
    return { ctx, page: await ctx.newPage() };
  };

  {
    const { page } = await freshPage();
    await page.setUserAgent(IPHONE_UA);
    await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => {
      if (m.type() !== 'error') return;
      const t = m.text();

      if (/Failed to fetch|net::ERR_INTERNET_DISCONNECTED|The network connection was lost/i.test(t)) return;
      errs.push(t);
    });

    await page.goto(base, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 1800));

    check('iPhone: apple-mobile-web-app-capable=yes',
      await page.$eval('meta[name="apple-mobile-web-app-capable"]', el => el.content) === 'yes');

    const iosTitle = await page.$eval('meta[name="apple-mobile-web-app-title"]', el => el.content);
    check('iPhone: apple-mobile-web-app-title',
      !!iosTitle && !/背古诗词/.test(iosTitle), iosTitle);
    check('iPhone: status-bar-style',
      !!(await page.$eval('meta[name="apple-mobile-web-app-status-bar-style"]', el => el.content)));

    const icons = await page.$$eval('link[rel="apple-touch-icon"]', els =>
      els.map(e => ({ sizes: e.getAttribute('sizes'), href: e.getAttribute('href') })));
    check('iPhone: apple-touch-icon 数量 >= 5', icons.length >= 5, '实际 ' + icons.length);
    const sizesOk = ['120x120', '152x152', '167x167', '180x180'].every(s =>
      icons.some(i => i.sizes === s));
    check('iPhone: 120/152/167/180 四种尺寸齐全', sizesOk);

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

    check('iPhone: viewport-fit=cover',
      /viewport-fit=cover/.test(await page.$eval('meta[name="viewport"]', el => el.content)));

    await page.evaluate(() => window.ManifestSync && window.ManifestSync.ready()
      ? true : new Promise(r => document.addEventListener('manifest:ready', () => r(true), { once: true })));
    const manifestInfo = await page.$eval('link[rel="manifest"]', async (el) => {
      const res = await fetch(el.href);
      const json = await res.json();
      return { href: el.href, name: json.name, shortName: json.short_name };
    });
    check('iPhone: manifest 已链接', !!manifestInfo.href);

    const expectedAppName = await page.$eval('meta[name="apple-mobile-web-app-title"]', el => el.content);
    check('iPhone: 清单应用名与当前用户名同源', manifestInfo.name === expectedAppName,
      JSON.stringify({ manifest: manifestInfo.name, title: expectedAppName }));
    check('iPhone: 清单短名仍是跬步', manifestInfo.shortName === '跬步', manifestInfo.shortName);

    const sw = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'unsupported';
      const reg = await navigator.serviceWorker.getRegistration();
      return reg && reg.active ? 'active' : (reg ? 'registered' : 'none');
    });
    check('iPhone: Service Worker 已激活', sw === 'active', sw);

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
      cached.some(p => /\/classic\/?$/.test(p)) && cached.some(p => /poems-classic\.js$/.test(p)),
      cached.length + ' 项');

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

    check('iPhone: 显示「添加到主屏幕」引导', await page.$eval('#ios-install-tip', el => !el.hidden));
    check('iPhone: 引导文案为 Safari 分享指引',
      /分享/.test(await page.$eval('#ios-install-tip .ios-tip-text', el => el.textContent)));

    await page.click('#ios-install-close');
    await new Promise(r => setTimeout(r, 300));
    check('iPhone: 点「知道了」后引导关闭', await page.$eval('#ios-install-tip', el => el.hidden));
    const dismissed = await page.evaluate(() => localStorage.getItem('poem-ios-tip-dismissed'));
    check('iPhone: 关闭状态已持久化', dismissed === '1');

    await page.reload({ waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 1600));
    check('iPhone: 重新打开不再弹引导', await page.$eval('#ios-install-tip', el => el.hidden));

    const cards = await page.$$eval('#today-list .poem-card, #today-list .item, #today-list > *', els => els.length);
    check('iPhone: 今日列表有内容', cards > 0, cards + ' 项');

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

    const overflow = await page.evaluate(() => {
      const bad = [];
      document.querySelectorAll('.item-title, .item-meta, .today-title, .brand-text h1').forEach(el => {
        if (el.scrollWidth > el.clientWidth + 2) bad.push(el.className + ':' + el.scrollWidth + '>' + el.clientWidth);
      });
      return bad.slice(0, 3);
    });
    check('iPhone: 诗词文字无横向溢出', overflow.length === 0, overflow.join(' | '));

    await page.setOfflineMode(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1200));
    const offlineOk = await page.evaluate(() => !!document.querySelector('.app'));
    check('iPhone: 断网后仍能打开', offlineOk);

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

    const offlineFont = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].filter(f => /Poem (Serif|Sans) SC/.test(f.family)).map(f => f.family + ':' + f.status);
    });
    check('iPhone: 断网后中文字体仍然可用',
      offlineFont.length === 4 && offlineFont.every(x => /:loaded$/.test(x)),
      offlineFont.join(' '));

    await page.goto(base + 'settings/', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 900));

    const gap = await page.evaluate(() => ({
      navH: getComputedStyle(document.documentElement).getPropertyValue('--nav-h').trim(),
      pageBottomPad: getComputedStyle(document.querySelector('.settings-page')).paddingBottom,
      appBottomPad: getComputedStyle(document.querySelector('.app')).paddingBottom
    }));

    check('iPhone: 设置页初始化了导航栏高度基准线',
      /^\d+(\.\d+)?px$/.test(gap.navH) && parseFloat(gap.appBottomPad) >= 0, JSON.stringify(gap));

    const playAndMeasure = await page.evaluate(async () => {
      const app = document.querySelector('.app');
      // 页底页脚已删，量「关于」最末一行那个法务入口（页面里最靠下的一行）。
      const foot = [...document.querySelectorAll('#settings-about .kv-link')].pop();
      function covered() {
        const r = foot.getBoundingClientRect();
        const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
        return !!(hit && !foot.contains(hit));
      }

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
    check('iPhone: 播放栏不遮挡设置页底部的法务入口', !playAndMeasure.covered,
      JSON.stringify(playAndMeasure));

    const breath = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const page = document.querySelector('.settings-page');
      const dock = document.getElementById('site-dock');
      const pad = parseFloat(getComputedStyle(page).paddingBottom);
      const navH = parseFloat(root.getPropertyValue('--nav-h')) || 0;
      return {
        pad: pad,

        breath: Math.round((pad - Math.max(0, navH - 40)) * 10) / 10,
        dockH: Math.round(dock.getBoundingClientRect().height * 10) / 10,
        navH: navH,
        dockHidden: getComputedStyle(dock).visibility === 'hidden'
      };
    });

    check('iPhone: 减掉 40px 之后剩下的呼吸仍 ≥ 页签高度（40px 没减进避让区）',
      breath.dockHidden || breath.breath >= breath.dockH - 1,
      JSON.stringify(breath));

    await page.goto(base + 'settings/', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 900));
    const dockGeom = await page.evaluate(() => {
      const dock = document.getElementById('site-dock');
      const last = [...document.querySelectorAll('#settings-about .kv-link')].pop();
      window.scrollTo(0, document.body.scrollHeight);
      return new Promise(res => requestAnimationFrame(() => {
        const dr = dock.getBoundingClientRect();
        const fr = last.getBoundingClientRect();
        const hit = document.elementFromPoint(
          Math.round(fr.left + fr.width / 2), Math.round(fr.top + fr.height / 2));
        res({
          navH: getComputedStyle(document.documentElement).getPropertyValue('--nav-h').trim(),
          dockH: Math.round(dr.height),
          dockTop: Math.round(dr.top),
          footBottom: Math.round(fr.bottom),

          covered: fr.bottom > dr.top || !(hit && last.contains(hit)),
          hitCls: hit ? (hit.className || hit.tagName) : null
        });
      }));
    });

    check('iPhone: 设置页底部留白 ≥ 页签高度',
      parseFloat(dockGeom.navH) >= dockGeom.dockH - 1, JSON.stringify(dockGeom));
    check('iPhone: 底部页签不遮挡「关于」最末一行的法务入口', !dockGeom.covered, JSON.stringify(dockGeom));

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

    await page.setOfflineMode(true);
    await page.goto(base + 'settings/', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 900));
    const settingsOffline = await page.evaluate(() => ({
      hasPage: !!document.querySelector('#settings-page'),
      hasLaw: !!document.querySelector('#settings-about a[href*="/terms/"]'),
      links: [...document.querySelectorAll('a[data-group-link]')].map(a => a.getAttribute('data-group-link'))
    }));
    check('iPhone: 断网也能打开设置整页',
      settingsOffline.hasPage && settingsOffline.hasLaw,
      JSON.stringify(settingsOffline));
    check('iPhone: 断网也能看到设置主页的四个二级页入口',
      settingsOffline.links.join(',') === 'general,recite,lists,reader',
      settingsOffline.links.join(','));

    const enterSub = async (key, sel) => {
      await page.goto(base + 'settings/', { waitUntil: 'domcontentloaded' });
      await new Promise(r => setTimeout(r, 700));

      const link = await page.evaluate(k => {
        const a = document.querySelector('a[data-group-link="' + k + '"]');
        return a ? { tag: a.tagName, href: a.getAttribute('href') } : null;
      }, key);
      if (!link) return { clicked: false };

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
    const subGeneral = await enterSub('general', '#toggle-sync');
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

    await page.goto(base + 'terms/', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 500));
    const termsOffline = await page.evaluate(() => {
      const link = document.querySelector('[data-mail-slot]');
      return {
        title: document.title,

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

    const todayRing = await page.evaluate(() => {
      const read = document.querySelector('#today-read');
      const ring = document.querySelector('#today-ring');

      const paintedCircle = el => {
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return { w: +b.width.toFixed(2), h: +b.height.toFixed(2), box: cs.boxSizing, content: cs.width };
      };
      const outer = el => { const b = el.getBoundingClientRect(); return { w: +b.width.toFixed(2), h: +b.height.toFixed(2) }; };
      const r = outer(ring);
      const boxMax = Math.max(r.w, r.h);

      const path = ring.querySelector('.ring-bg');
      const pb = path.getBoundingClientRect();
      const stroke = parseFloat(getComputedStyle(path).strokeWidth) || 0;
      const paintedMax = +Math.max(pb.width, pb.height, boxMax - stroke).toFixed(2);
      return {
        read: outer(read),

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

    await page.goto(base + 'classic/', { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 600));
    const gwState = await page.evaluate(() => {
      const r = el => {
        const b = el.getBoundingClientRect();
        return {
          w: +b.width.toFixed(1), h: +b.height.toFixed(1),
          radius: getComputedStyle(el).borderRadius,

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

        playGapLeft: +(playRect.left - mainRect.right).toFixed(2),
        playW: +playRect.width.toFixed(2),
        mainW: +mainRect.width.toFixed(2),

        metaBox: (() => {
          const meta = main.querySelector('.item-meta');
          const spans = meta ? [].slice.call(meta.children) : [];
          if (!spans.length) return { n: 0, prefixW: 0, overflows: 0 };
          const last = spans[spans.length - 1];
          const prefixW = spans.slice(0, -1).reduce(function (a, k) {
            return a + k.getBoundingClientRect().width;
          }, 0);

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

            overflows: prefixW + fullW > boxW + 1 ? 1 : 0,

            trimmed: last.scrollWidth <= last.clientWidth + 1 ? 1 : 0,
            fullW: +fullW.toFixed(2),
            boxW: +boxW.toFixed(2)
          };
        })(),

        titleNatW: (() => {
          const title = main.querySelector('.item-title');
          if (!title) return 0;

          const rng = document.createRange();
          rng.selectNodeContents(title);
          return +rng.getBoundingClientRect().width.toFixed(2);
        })(),
        playGapRight: +(arrowRect.left - playRect.right).toFixed(2),

        playGapRightCss: getComputedStyle(play).marginRight,
        barContent: bar.content,
        padL: itemPad.paddingLeft,
        padR: itemPad.paddingRight,

        headPadL: getComputedStyle(head).paddingLeft,
        headPadR: getComputedStyle(head).paddingRight,

        cardPadL: getComputedStyle(card).paddingLeft,

        headNameLeft: +head.querySelector('.group-name').getBoundingClientRect().left.toFixed(2),
        itemNumLeftAbs: +numRect.left.toFixed(2),
        headPadBottom: getComputedStyle(head).paddingBottom,
        gapHeadBtnToItem: +(itemRect.top - headBtn.getBoundingClientRect().bottom).toFixed(2),
        numFirstChild: title.firstElementChild === num,
        oldIndexLeft: document.querySelectorAll('#gw-list .item-index').length,

        numBg: getComputedStyle(num).backgroundColor,
        numBorderW: getComputedStyle(num).borderTopWidth,
        numBorderStyle: getComputedStyle(num).borderTopStyle,
        numBorderColor: getComputedStyle(num).borderTopColor,
        numColor: getComputedStyle(num).color,
        numRadius: getComputedStyle(num).borderRadius,
        numPad: getComputedStyle(num).paddingTop,

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

    check('iPhone: 序号圆与下方正文左对齐（圆 / 篇名 / 元信息同一条左基准线）',
      numState.numLeft === numState.metaLeft && numState.titleLeft === numState.metaLeft,
      JSON.stringify({ num: numState.numLeft, title: numState.titleLeft, meta: numState.metaLeft }));

    check('iPhone: 条目左内边距 12px、右内边距 8px（只加左侧，累计 +4px）',
      parseFloat(numState.padL) === 12 && parseFloat(numState.padR) === 8,
      JSON.stringify({ pad: numState.padL + ' / ' + numState.padR }));

    check('iPhone: 序号圆左内缘距条目左缘 = 条目左内边距 12px',
      Math.abs(numState.numLeftInset - parseFloat(numState.padL)) <= 0.5,
      JSON.stringify({ numLeft: numState.numLeftInset, padL: numState.padL }));

    check('iPhone: 箭头右内缘距条目右缘 = 条目右内边距（图标钉在条目右缘，不被内容块推走）',
      Math.abs(numState.arrowRightInset - parseFloat(numState.padR)) <= 0.5,
      JSON.stringify({ arrowRight: numState.arrowRightInset, padR: numState.padR }));

    const alignState = await page.evaluate(() => {
      const items = [].slice.call(document.querySelectorAll('#gw-list .item'));
      const insets = items.map(function (it) {
        const ir = it.getBoundingClientRect();
        const ar = it.querySelector('.item-arrow').getBoundingClientRect();
        return +(ir.right - ar.right).toFixed(2);
      });

      const gaps = items.map(function (it) {
        return +(parseFloat(getComputedStyle(it.querySelector('.item-read')).marginRight) || 0).toFixed(2);
      });

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

        check('iPhone ' + vw + 'px：' + colLabel + ' 详情页状态栏（朝代 / 作者 / 出处）在视口里',
          barState && barState.metaRight != null && barState.metaRight <= barState.vw + 1,
          barState ? String(barState.metaRight) : 'no reader');
        check('iPhone ' + vw + 'px：' + colLabel + ' 详情页状态栏里没有已读读数 .rd-count',
          !!barState && barState.metaCount === 0,
          barState ? (barState.metaCount + ' 枚') : 'no reader');
        check('iPhone ' + vw + 'px：' + colLabel + ' 详情页顶栏自己不出现内部横向溢出',
          barState && barState.barScrollW <= barState.barW + 1,
          barState ? (barState.barScrollW + ' / ' + barState.barW) : 'no reader');

        check('iPhone ' + vw + 'px：' + colLabel + ' 详情页页名仍占着一段可见宽度（收成省略号，不是归零）',
          barState && barState.labelW > 24 && barState.labelEllipsis === 'ellipsis',
          barState ? JSON.stringify([barState.labelW, barState.labelEllipsis]) : 'no reader');
      }
    }
    await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

    check('iPhone: 卡头那一行左内边距 12px（8 → 12，+4px）',
      Math.abs(parseFloat(numState.headPadL) - 12) <= 0.5, numState.headPadL);
    check('iPhone: 卡头右侧内边距仍是 8px（右边那颗圆键没被推走）',
      Math.abs(parseFloat(numState.headPadR) - 8) <= 0.5, numState.headPadR);

    check('iPhone: 卡头文字与条目文字左基准线重合（两处左内边距同为 12px）',
      Math.abs(parseFloat(numState.headPadL) - parseFloat(numState.padL)) <= 0.5,
      JSON.stringify({ head: numState.headPadL, item: numState.padL }));

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

    check('iPhone: 左侧短竖条已隐藏（条目不再渲染 ::before 竖条）',
      !numState.barContent || numState.barContent === 'none',
      JSON.stringify(numState.barContent));
    check('iPhone: 卡头与首条之间留出间距（不再贴着分隔线）',
      numState.gapHeadBtnToItem >= 6, numState.gapHeadBtnToItem + 'px');

    check('iPhone: 播放键左侧没有负外边距（圆键不再压住正文）',
      numState.playGapLeft >= 0, numState.playGapLeft + 'px');

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

    check('iPhone: 「加入背诵」键与播放键一样大（两枚并排圆键同径）',
      Math.abs(gapState.reciteW - numState.playW) <= 0.5 && numState.playW >= 30,
      JSON.stringify({ reciteW: gapState.reciteW, playW: numState.playW }));
    check('iPhone: 圆键本体没被压小（仍是 --item-btn 那一档的正圆，36px；宽高同值）',
      Math.abs(numState.playW - 36) <= 0.5, numState.playW + 'px');

    check('iPhone: 播放键带 margin-right: 6px（与箭头之间那 6px 的固定间距在这里）',
      Math.abs(parseFloat(numState.playGapRightCss) - 6) <= 0.5,
      numState.playGapRightCss);

    check('iPhone: 小古文内容块不再撑满整行（按内容取宽，不是 flex 增长项）',
      numState.mainW < 393 - 2 - 12 - 8 - 36 - 6 - 18 - 1,
      numState.mainW + 'px（整行 ' + 393 + 'px）');

    check('iPhone: 副信息里的朝代 / 作者 / 出处没被摘句压窄（宽度为正且合理）',
      numState.metaBox.prefixW > 8 && numState.metaBox.prefixW < numState.metaBox.boxW,
      JSON.stringify({ prefixW: numState.metaBox.prefixW, boxW: numState.metaBox.boxW }));

    check('iPhone: 放不下的摘句走截断而不是硬缩（文字没被压窄，是末尾省略）',
      numState.metaBox.overflows === 1 && numState.metaBox.trimmed === 1,
      JSON.stringify(numState.metaBox));

    check('iPhone: 内容块宽度不小于标题行的自然宽（标题没被压窄）',
      numState.mainW >= numState.titleNatW - 0.5,
      JSON.stringify({ mainW: numState.mainW, titleNatW: numState.titleNatW }));

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

    {
      const { page: sp } = await freshPage();
      await sp.setUserAgent(IPHONE_UA);
      await sp.setViewport({ width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
      await sp.goto(base + 'search/', { waitUntil: 'load' });
      await new Promise(r => setTimeout(r, 700));

      {
        const restState = await sp.evaluate(() => {
          const inp = document.querySelector('.search-hero .search-input');
          const hero = document.getElementById('search-hero');
          const hr = hero.getBoundingClientRect();
          const ir = inp.getBoundingClientRect();
          return {
            cls: hero.className,
            focused: document.activeElement === inp,
            inputTop: +ir.top.toFixed(1),

            offset: +((ir.top + ir.height / 2) - (hr.top + hr.height / 2)).toFixed(1)
          };
        });
        check('iPhone 搜索页：进页停在静止态（不自动聚焦、框压在页面中心）',
          !restState.focused && !/search-active/.test(restState.cls) &&
          Math.abs(restState.offset) <= 2 && restState.inputTop > 200,
          JSON.stringify([restState.cls, restState.focused, restState.inputTop, restState.offset]));

        await sp.focus('#gw-search');
        await new Promise(r => setTimeout(r, 250));
        const focusState = await sp.evaluate(() => {
          const inp = document.querySelector('.search-hero .search-input');
          const bar = document.querySelector('.topbar');
          const cs = getComputedStyle(inp);
          return {
            focused: document.activeElement === inp,
            inputTop: +inp.getBoundingClientRect().top.toFixed(1),
            barBottom: +bar.getBoundingClientRect().bottom.toFixed(1),
            mid: +((window.innerHeight - inp.getBoundingClientRect().height) / 2).toFixed(1),
            border: cs.borderTopColor,
            bg: cs.backgroundColor
          };
        });

        check('iPhone 搜索页：聚焦时搜索框升到标题栏下方（不再停在视口中央）',
          focusState.focused &&
          focusState.inputTop < focusState.mid - 40 &&
          focusState.inputTop - focusState.barBottom <= 50,
          '框顶 ' + focusState.inputTop + ' / 顶栏下沿 ' + focusState.barBottom +
          ' / 中线 ' + focusState.mid + ' / 聚焦 ' + focusState.focused);
        check('iPhone 搜索页：聚焦时描边是天青主色（不是浏览器默认的黑色 ring）',
          focusState.focused && focusState.border === 'rgb(47, 96, 85)',
          focusState.border + ' / 聚焦 ' + focusState.focused);
        check('iPhone 搜索页：聚焦时框底是纸色（与全站输入框同一套口径）',
          /^rgb\(255, 253, 246\)$/.test(focusState.bg), focusState.bg);
      }
      await sp.type('#gw-search', '月', { delay: 10 });
      await new Promise(r => setTimeout(r, 250));
      {

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

      const autoFocus = await sp.evaluate(() => ({
        focused: document.activeElement && document.activeElement.id,
        heroClass: document.getElementById('search-hero').className
      }));
      check('iPhone 搜索页：进页即聚焦搜索框（少点一次才输得进字）',
        autoFocus.focused === 'gw-search', JSON.stringify(autoFocus));

      const boxState = await sp.evaluate(() => {
        const wrap = document.querySelector('.search-hero .search-wrap');
        const inp = document.querySelector('.search-hero .search-input');
        const r = inp.getBoundingClientRect();
        const cs = getComputedStyle(inp);
        return {
          visualH: +r.height.toFixed(1),
          layoutH: +r.height.toFixed(1),

          wrapBottom: +wrap.getBoundingClientRect().bottom.toFixed(1),
          inputBottom: +r.bottom.toFixed(1),
          inputTop: +r.top.toFixed(1),
          radius: cs.borderTopLeftRadius,
          scale: cs.transform,

          borderColor: cs.borderTopColor,
          outlineStyle: cs.outlineStyle,
          outlineColor: cs.outlineColor,
          outlineWidth: cs.outlineWidth,
          boxShadow: cs.boxShadow
        };
      });
      check('iPhone 搜索页：搜索框真的变高了（52px，超出 iOS 44px 最小可点面积）',
        boxState.visualH >= 50 && boxState.visualH <= 54, boxState.visualH + 'px');

      check('iPhone 搜索页：增高长在布局里（一行就是 52px，不是画出来的）',
        Math.abs(boxState.layoutH - 52) <= 0.5, boxState.layoutH + 'px');

      const halo = boxState.boxShadow || '';
      const haloIsGreenish = /rgba?\(\s*(47,\s*96,\s*85|219,\s*233,\s*226)\b/.test(halo);
      const haloIsBlack = /rgba?\(\s*0,\s*0,\s*0\b/.test(halo) || /\bblack\b/.test(halo);
      check('iPhone 搜索页：聚焦描边是天青而不是 UA 的黑框（outline 已关掉）',
        boxState.borderColor === 'rgb(47, 96, 85)' && boxState.outlineStyle === 'none' &&
        haloIsGreenish && !haloIsBlack,
        JSON.stringify([boxState.borderColor, boxState.outlineStyle, boxState.outlineWidth, halo]));

      check('iPhone 搜索页：搜索框四个角是同一个半径（不再被纵向拉伸成椭圆角）',
        boxState.radius === '12px' && !/matrix/.test(boxState.scale),
        JSON.stringify([boxState.radius, boxState.scale]));

      check('iPhone 搜索页：输入框与定位上下文同高（下拉的 top 只是 4px 的呼吸）',
        Math.abs((boxState.inputBottom - boxState.wrapBottom)) <= 0.5,
        '相差 ' + (boxState.inputBottom - boxState.wrapBottom).toFixed(1) + 'px');

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

      check('iPhone 搜索页：候选下拉紧贴搜索框下沿（不悬空，间隙在 8px 以内）',
        Math.abs(gap.gap) <= 8, gap.gap + 'px');

      const stacked = await sp.evaluate(() => {
        const sug = document.getElementById('search-suggest');
        const r = sug.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 20);
        return { hit: hit ? hit.className : null, sugHit: !!(hit && hit.closest && hit.closest('#search-suggest')) };
      });
      check('iPhone 搜索页：候选下拉压在结果列表上面（候选正中央点到的是候选）',
        stacked.sugHit, JSON.stringify(stacked));

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

      const room = +(kb.visibleBottom - kb.sugBottom).toFixed(1);
      const vvH = +(kb.visibleBottom - kb.inputTop).toFixed(1);

      const spaceBelowInput = +(kb.visibleBottom - kb.inputBottom).toFixed(1);

      check('iPhone 搜索页：键盘上方仍给结果卡片留出可见的一片（候选不把可视区吃满）',
        room >= spaceBelowInput * 0.1,
        '候选下方还有 ' + room + 'px / 框底到可视下沿共 ' + spaceBelowInput + 'px');
      check('iPhone 搜索页：候选一次不会很多条（手机上按可视区四成限高）',
        kb.sugCount <= 8, kb.sugCount + ' 条');

      check('iPhone 搜索页：候选一屏最多六条左右（手机上 320px 上限）',
        kb.sugH <= 330, kb.sugH + 'px');

      check('iPhone 搜索页：键盘弹着时候选比平时更矮（硬边界项真的在起作用）',
        kb.sugH < 320, kb.sugH + 'px');

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

      check('iPhone 搜索页：有结果时列表里没有那段引导语',
        (listGap.emptyText === null || listGap.emptyText === '') &&
        (listGap.emptyH === null || listGap.emptyH <= 12),
        JSON.stringify([listGap.emptyText, listGap.emptyH]));
      const idleEmpty = await sp.evaluate(async () => {
        const inp = document.getElementById('gw-search');
        const keep = inp.value;
        inp.value = '';
        inp.dispatchEvent(new Event('input', { bubbles: true }));

        await new Promise(r => setTimeout(r, 50));
        const list = document.getElementById('gw-list');
        const empty = list.querySelector('.empty');
        const out = {
          text: empty ? empty.textContent.trim() : null,
          h: empty ? +empty.getBoundingClientRect().height.toFixed(1) : null,
          dataEmpty: empty ? empty.getAttribute('data-empty') : null
        };

        inp.value = keep;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 50));
        return out;
      });
      check('iPhone 搜索页：没输入时列表里不显示引导文字（那段话已按用户要求删除）',
        idleEmpty.text === '' && idleEmpty.dataEmpty === 'idle' &&
        (idleEmpty.h === null || idleEmpty.h <= 8),
        JSON.stringify(idleEmpty));

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

        Object.defineProperty(vv, 'height', { value: realH - 336, configurable: true });
        vv.dispatchEvent(new Event('resize'));
        await new Promise(r => setTimeout(r, 200));
        return out;
      });
      check('iPhone 搜索页：可视区被键盘压到 300px 时，候选仍有 5 行的高度（不再只剩一行）',
        parseFloat(floor.rows) >= 5 && floor.h >= floor.itemH * 4.5,
        JSON.stringify(floor));

      const itemH = await sp.evaluate(() => {
        const it = document.querySelector('#search-suggest .suggest-item');
        return it ? +it.getBoundingClientRect().height.toFixed(1) : 0;
      });
      check('iPhone 搜索页：候选行高不低于 iOS 建议的 44px', itemH >= 44, itemH + 'px');

      const dismiss = await sp.evaluate(async () => {
        const list = document.getElementById('gw-list');
        const inp = document.querySelector('.search-hero .search-input');
        const sug = document.getElementById('search-suggest');
        const first = list.querySelector('.item');
        const before = {
          sugOpen: !sug.hidden,
          firstTop: first ? +first.getBoundingClientRect().top.toFixed(1) : null,

          firstVisible: first
            ? Math.max(0, Math.min(first.getBoundingClientRect().bottom,
                window.visualViewport.height) - first.getBoundingClientRect().top)
            : 0
        };

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

      await sp.goto(base + 'mine/', { waitUntil: 'load' });
      await new Promise(r => setTimeout(r, 600));

      // 用户 2026-09-18（Issue #229）：用户名输入框在头像右侧、游客上方；
      // 短（不占满一行）、无边框无底色；没有「保存」按钮。
      const nick = await sp.evaluate(() => {
        const row = document.getElementById('identity-row');
        const av = row.querySelector('.avatar-slot').getBoundingClientRect();
        const inp = document.getElementById('input-nickname');
        const ir = inp.getBoundingClientRect();
        const sub = row.querySelector('.identity-sub').getBoundingClientRect();
        const card = row.closest('.account-card').getBoundingClientRect();
        const cs = getComputedStyle(inp);
        return {
          avRight: +av.right.toFixed(1), inLeft: +ir.left.toFixed(1),
          inTop: +ir.top.toFixed(1), inBottom: +ir.bottom.toFixed(1),
          subTop: +sub.top.toFixed(1), cardRight: +card.right.toFixed(1),
          cardLeft: +card.left.toFixed(1), inWidth: +ir.width.toFixed(1),
          border: cs.borderTopWidth + '/' + cs.borderTopStyle,
          bg: cs.backgroundColor,
          hasSave: !!document.getElementById('btn-nickname-save'),
          hasUpsell: !!document.getElementById('upsell-row')
        };
      });
      check('iPhone 我的页：用户名输入框在头像右侧（框左缘 ≥ 头像右缘）',
        nick.inLeft >= nick.avRight, '头像右 ' + nick.avRight + ' / 框左 ' + nick.inLeft);
      check('iPhone 我的页：用户名输入框在「游客」那一行上方（框底 ≤ 游客顶）',
        nick.inBottom <= nick.subTop + 0.5, '框底 ' + nick.inBottom + ' / 游客顶 ' + nick.subTop);
      check('iPhone 我的页：输入框不是整行宽（收窄到卡片宽的三分之二以内）',
        nick.inWidth <= (nick.cardRight - nick.cardLeft) * 0.66,
        '框宽 ' + nick.inWidth + ' / 卡片宽 ' + (nick.cardRight - nick.cardLeft).toFixed(1));
      check('iPhone 我的页：输入框不画边框、不铺底色',
        /^0(px)?\/none$/.test(nick.border) && /rgba\(0, 0, 0, 0\)|transparent/.test(nick.bg),
        nick.border + ' / ' + nick.bg);
      check('iPhone 我的页：没有「保存」按钮（输完自动保存）', nick.hasSave === false, String(nick.hasSave));
      check('iPhone 我的页：没有权限对比那张卡', nick.hasUpsell === false, String(nick.hasUpsell));

      const glow = await sp.evaluate(async () => {
        const inp = document.getElementById('input-nickname');
        inp.focus();
        await new Promise(r => setTimeout(r, 300));

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
      check('iPhone 我的页：昵称输入框聚焦时有淡光晕（与搜索框同一个值）',
        /rgba\(47, 96, 85, 0\.1\)/.test(glow.shadow) && /3px/.test(glow.shadow),
        glow.shadow);
      check('iPhone 我的页：没有类名的输入框（弹层里那种）聚焦时也带同一圈光晕',
        /rgba\(47, 96, 85, 0\.1\)/.test(glow.shadow) && glow.outline === 'none',
        JSON.stringify(glow));
      await sp.goto(base + 'search/', { waitUntil: 'load' });
      await new Promise(r => setTimeout(r, 600));

      const evenGap = await sp.evaluate(async () => {
        const vv = window.visualViewport;
        delete vv.height;
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

        if (!inp.value.trim()) {
          inp.value = '月';
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(r => setTimeout(r, 200));
        }

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
        const focusedState = {
          cls: hero.className,
          inputTop: +inp.getBoundingClientRect().top.toFixed(1),
          focused: document.activeElement === inp
        };
        inp.value = '';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.blur();
        await new Promise(r => setTimeout(r, 500));
        const centered = { cls: hero.className, pos: midOf(), focused: document.activeElement === inp };
        return {
          clsFocused: focusedState.cls,
          topFocused: focusedState.inputTop,
          focusedFlag: focusedState.focused,
          clsWhenEmpty: centered.cls,
          topWhenEmpty: centered.pos.inputTop,
          focusedWhenEmpty: centered.focused,
          centeredOffset: centered.pos.offset,
          centeredHeroH: centered.pos.heroH,
          vh: window.innerHeight
        };
      });

      check('iPhone 搜索页：聚焦时搜索框贴到页顶（清空回中的前提是它先真的贴过顶）',
        /search-active/.test(r1.clsFocused) && r1.focusedFlag &&
        r1.topFocused <= 140 && r1.topFocused < 336 - 100,
        JSON.stringify([r1.clsFocused, r1.topFocused, r1.focusedFlag]));

      check('iPhone 搜索页：清空内容且没有焦点后，搜索框回到页面中心',
        !/search-active/.test(r1.clsWhenEmpty) && !r1.focusedWhenEmpty &&
        Math.abs(r1.centeredOffset) <= 2 &&
        r1.centeredHeroH > 300 && r1.topWhenEmpty > r1.topFocused + 100,
        JSON.stringify([r1.clsWhenEmpty, r1.centeredOffset, r1.topWhenEmpty, r1.centeredHeroH]));

      const blank = await sp.evaluate(async () => {
        const inp = document.getElementById('gw-search');
        inp.value = '月';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 200));
        const sug = document.getElementById('search-suggest');
        const opened = !sug.hidden;

        const list = document.getElementById('gw-list');
        list.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 60));
        const closedByList = sug.hidden;

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

    const androidTip = await page.evaluate(() => {
      const tip = document.getElementById('ios-install-tip');
      const text = tip.querySelector('.ios-tip-text').textContent;
      const btn = document.getElementById('ios-install-close').textContent;
      return { hidden: tip.hidden, text: text, btn: btn, isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent) };
    });

    const showsIOSTip = androidTip.hidden === false && /分享/.test(androidTip.text);
    check('Android: 不出现 iOS 专用分享引导', !showsIOSTip,
      androidTip.hidden ? '(隐藏，符合)' : androidTip.text.trim().slice(0, 24));
    await page.close();
  }

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
        const appStyle = getComputedStyle(document.querySelector('.app'));
        return {
          vw: document.documentElement.clientWidth,
          appL: app && +app.left.toFixed(1), appR: app && +app.right.toFixed(1),
          barL: bar && +bar.left.toFixed(1), barR: bar && +bar.right.toFixed(1),
          dockL: dock && +dock.left.toFixed(1), dockR: dock && +dock.right.toFixed(1),
          padL: parseFloat(appStyle.paddingLeft), padR: parseFloat(appStyle.paddingRight)
        };
      });
      const sideL = w.appL, sideR = +(w.vw - w.appR).toFixed(1);
      check('桌面 ' + vw + 'px：内容壳层居中且宽度不超过 1200px',
        Math.abs(sideL - sideR) < 1.5 && w.appR - w.appL <= 1200,
        JSON.stringify({ 左: sideL, 右: sideR, 视口: w.vw, 内容宽: +(w.appR - w.appL).toFixed(0) }));
      check('桌面 ' + vw + 'px：顶栏与正文列左右同缘（不是各写各的宽度）',
        Math.abs(w.barL - (w.appL + w.padL)) < 1.5 && Math.abs(w.barR - (w.appR - w.padR)) < 1.5,
        JSON.stringify({ 顶栏: [w.barL, w.barR], 正文: [w.appL, w.appR] }));
      check('桌面 ' + vw + 'px：页签内层与正文列左右同缘（四格落在正文两缘之内）',
        Math.abs(w.dockL - (w.appL + w.padL)) < 1.5 && Math.abs(w.dockR - (w.appR - w.padR)) < 1.5,
        JSON.stringify({ 页签: [w.dockL, w.dockR], 正文: [w.appL, w.appR] }));
    }

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
    check('桌面 1920px：阅读器正文壳层跟随 1200px 内容上限',
      readW && readW.bodyW >= 1000 && readW.bodyW <= 1200,
      readW ? String(readW.bodyW) : 'no reader');
    check('桌面 1920px：一行字仍封顶 720px 这一档（不跟着屏幕一起变宽）',
      readW && readW.txtW <= 760,
      readW ? ('正文 ' + readW.txtW + 'px / 字号 ' + readW.fontSize) : 'no reader');
    check('桌面 1920px：「上一篇 / 下一篇」与正文同宽（不被推到屏幕两端）',
      readW && readW.navW !== null && Math.abs(readW.navW - readW.txtW) < 2,
      readW ? (String(readW.navW) + ' / ' + readW.txtW) : 'no reader');
    await page.close();
  }

  {
    const { page } = await freshPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(base + 'settings/general/', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 600));

    const seed = await page.evaluate(() => {
      const A = window.AuthCore;
      if (!A) return null;
      const store = A.makeStore(window.localStorage);
      const rc = A.requestCode(store, { channel: 'email', value: 'pro@example.com' }, 'login');
      const v = A.verifyCode(store, rc.codeId, rc.code, 'login');
      if (!v || !v.ok) return null;
      return {
        auth: window.localStorage.getItem('poem_auth_v1'),
        plan: JSON.stringify({ v: 1, tier: 'pro', until: null, source: 'server' })
      };
    });
    if (seed) {
      await page.evaluate((s) => {
        window.localStorage.setItem('poem_auth_v1', s.auth);
        window.localStorage.setItem('poem_plan_v1', s.plan);
      }, seed);
      await page.reload({ waitUntil: 'networkidle0' });
      await new Promise(r => setTimeout(r, 600));
    }

    const pre = await page.evaluate(() => {
      const i = document.getElementById('toggle-sync');
      return {
        pro: !!(window.Entitlement && window.Entitlement.identity
          && window.Entitlement.identity().can
          && window.Entitlement.identity().can('sync.multiDevice').ok),
        hint: (document.getElementById('sync-hint') || {}).textContent || '',
        disabled: i ? i.disabled : null
      };
    });
    check('同步开关：这台设备上确实登录着 Pro（不满足时下面五条必红，与滑块无关）',
      pre.pro === true, 'sync.multiDevice 放行=' + pre.pro + ' / 提示「' + pre.hint + '」');

    const measure = () => page.evaluate(() => {
      const input = document.getElementById('toggle-sync');
      if (!input) return null;
      const track = input.nextElementSibling;
      const tr = track.getBoundingClientRect();
      const ir = input.getBoundingClientRect();
      const after = getComputedStyle(track, '::after');
      const tcs = getComputedStyle(track);
      return {
        sibling: track.className,
        checked: input.checked,
        track: { x: tr.x, y: tr.y, w: tr.width, h: tr.height, radius: tcs.borderRadius, pos: tcs.position },
        input: { w: ir.width, h: ir.height },
        label: (() => {
          const lr = track.closest('label').getBoundingClientRect();
          const lbl = track.closest('label').querySelector('.settings-label').getBoundingClientRect();
          return {
            display: getComputedStyle(track.closest('label')).display,
            justify: getComputedStyle(track.closest('label')).justifyContent,
            w: +lr.width.toFixed(1),
            gapRight: +(lr.right - tr.right).toFixed(1),
            textRight: +lbl.right.toFixed(1),
            textToTrack: +(tr.x - lbl.right).toFixed(1)
          };
        })(),
        knob: {
          w: parseFloat(after.width), h: parseFloat(after.height),
          left: parseFloat(after.left), top: parseFloat(after.top),
          position: after.position,

          dx: (() => { const m = /matrix\(([^)]+)\)/.exec(after.transform); return m ? parseFloat(m[1].split(',')[4]) : 0; })()
        }
      };
    });

    const off = await measure();
    check('同步开关：轨道画出来了（轨道是 input 的紧邻兄弟）',
      off && /switch-toggle/.test(off.sibling),
      off ? off.sibling : 'no switch');
    if (off) {
      check('同步开关：轨道是 40×24 的胶囊',
        Math.abs(off.track.w - 40) < 0.6 && Math.abs(off.track.h - 24) < 0.6 && off.track.radius === '999px',
        '轨道 ' + off.track.w + '×' + off.track.h + ' 圆角 ' + off.track.radius);
      check('同步开关：真实复选框不占位（视觉交给轨道那颗 span）',
        off.input.w === 0 && off.input.h === 0,
        'input ' + off.input.w + '×' + off.input.h);
      check('同步开关：轨道是定位包含块（滑块只能落在它里面）',
        off.track.pos === 'relative', off.track.pos);

      // 用户 2026-09-18（Issue #229）：一行显示，选项放在最右面 —— iPhone 设置那样。
      // 之前 `.settings-item label` 的 display:block 盖掉了 `.switch` 的 flex，
      // 开关被挤到文字右边的紧邻位置（右侧留一大片空白）。
      check('同步开关：那一行是 flex + space-between（选项能被推到最右）',
        off.label.display === 'flex' && off.label.justify === 'space-between',
        off.label.display + ' / ' + off.label.justify);
      check('同步开关：轨道紧贴卡片右缘（选项在最右面，不在文字旁边）',
        Math.abs(off.label.gapRight) <= 1,
        '右侧空出 ' + off.label.gapRight + 'px');
      check('同步开关：文字与轨道之间是「推过去」的距离（不是紧贴）',
        off.label.textToTrack > 40,
        '文字右缘 → 轨道左缘 ' + off.label.textToTrack + 'px');
      check('同步开关：滑块是轨道的 ::after（不是另一个能到处跑的元素）',
        off.knob.position === 'absolute' && off.knob.w > 0,
        'position ' + off.knob.position + ' / ' + off.knob.w + '×' + off.knob.h);

      check('同步开关（关）：滑块落在轨道内（不越界）',
        off.knob.left >= 0 && off.knob.top >= 0 &&
        off.knob.left + off.knob.w <= off.track.w &&
        off.knob.top + off.knob.h <= off.track.h,
        'left ' + off.knob.left + ' + ' + off.knob.w + ' ≤ ' + off.track.w);
      check('同步开关（关）：滑块停在左端（未位移）',
        off.knob.dx === 0, '位移 ' + off.knob.dx + 'px');
    }

    await page.evaluate(() => {
      const t = document.querySelector('.switch-toggle');
      if (t) t.scrollIntoView({ block: 'center' });
    });
    await new Promise(r => setTimeout(r, 300));

    const hit = await page.evaluate(() => {
      const t = document.querySelector('.switch-toggle');
      if (!t) return null;
      const r = t.getBoundingClientRect();
      const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { y: Math.round(r.y), hitCls: el ? (el.className || el.tagName) : null };
    });
    check('同步开关：轨道几何中心没有被别的元素盖住（点得着）',
      !!hit && /switch-toggle/.test(String(hit.hitCls)),
      hit ? ('轨道 y=' + hit.y + '，命中 ' + hit.hitCls) : 'no switch');

    let clicked = true;
    try { await page.click('.switch-toggle', { timeout: 5000 }); }
    catch (e) { clicked = false; }
    check('同步开关：轨道是可以点到的实体（点它 = 切开关）', clicked,
      clicked ? '(点到了)' : '点不到 .switch-toggle');
    await new Promise(r => setTimeout(r, 600));
    const on = await measure();

    const bg = await page.evaluate(() => {
      const t = document.querySelector('.switch-toggle');
      return t ? getComputedStyle(t).backgroundColor : null;
    });
    if (!on) check('同步开关：轨道那颗 span 还在（结构回归了）', false, '取不到 input.nextElementSibling');
    if (on) {
      check('同步开关：点轨道真的把它打开了', on.checked === true, String(on.checked));
      check('同步开关（开）：轨道换成深青实底',
        bg !== null && /rgb\(47, 96, 85\)|rgba\(47, 96, 85/.test(bg),
        String(bg));
      check('同步开关（开）：滑块右移了（不是一颗不动的点）',
        on.knob.dx > 0, '位移 ' + on.knob.dx + 'px');

      check('同步开关（开）：滑块仍在轨道内，右端不越界',
        on.knob.left + on.knob.dx + on.knob.w <= on.track.w,
        '起点 ' + on.knob.left + ' + 位移 ' + on.knob.dx + ' + 滑块 ' + on.knob.w +
        ' ≤ 轨道 ' + on.track.w);

      check('同步开关（开）：滑块没有跑到页面别处（与轨道同一个高度带）',
        Math.abs(on.knob.top) < on.track.h,
        '滑块 top ' + on.knob.top + ' / 轨道高 ' + on.track.h);
    }
    await page.close();
  }

  {
    const { page } = await freshPage();
    const SHELF = [
      ['/poems/', 'poems'],
      ['/tangshi/', 'tangshi'],
      ['/classic/index.html', 'classic'],
      ['/guwen/', 'guwen'],
      ['/songci/', 'songci'],
      ['/zhaoming/', 'zhaoming']
    ];

    for (const vw of [1024, 1280, 1440, 1920]) {
      await page.setViewport({ width: vw, height: 900, deviceScaleFactor: 1 });
      for (const [url, name] of SHELF) {
        await page.goto(base.replace(/\/$/, '') + url, { waitUntil: 'load' });
        await new Promise(r => setTimeout(r, 700));
        const m = await page.evaluate(() => {
          const card = document.querySelector('.group-card');
          const item = card && card.querySelector('.item');
          const title = item && item.querySelector('.item-title');
          if (!card || !item) return null;
          const app = document.querySelector('.app');

          const acs = getComputedStyle(app);
          const contentW = app.getBoundingClientRect().width
            - parseFloat(acs.paddingLeft) - parseFloat(acs.paddingRight);
          return {
            cardW: Math.round(card.getBoundingClientRect().width),
            contentW: Math.round(contentW),
            itemW: Math.round(item.getBoundingClientRect().width),
            titleH: Math.round(title.getBoundingClientRect().height),
            lineH: Math.round(parseFloat(getComputedStyle(title).lineHeight)
              || parseFloat(getComputedStyle(title).fontSize) * 1.4),

            titleW: Math.round(title.getBoundingClientRect().width),

            minTitleW: Math.min(...[...card.querySelectorAll('.item-title')]
              .map(t => t.getBoundingClientRect().width))
          };
        });
        if (!m) { check('集子页 ' + name + ' @' + vw + '：量得到一张卷次卡', false, 'no card'); continue; }
        check('集子页 ' + name + ' @' + vw + '：卷次卡横跨整行（没被 auto-fill 栅格当成一条篇目）',
          m.cardW >= m.contentW - 2,
          '卡 ' + m.cardW + ' / 内容宽 ' + m.contentW);

        check('集子页 ' + name + ' @' + vw + '：卡内篇名不折成竖排（标题有正常的横向宽度）',
          m.minTitleW > m.itemW * 0.4,
          '条目 ' + m.itemW + ' / 最窄的标题 ' + m.minTitleW + 'px（首条 '
            + m.titleW + '×' + m.titleH + '，行高 ' + m.lineH + '）');
      }
    }

    for (const vw of [1024, 1280, 1440, 1920]) {
      await page.setViewport({ width: vw, height: 900, deviceScaleFactor: 1 });
      await page.goto(base, { waitUntil: 'load' });
      await new Promise(r => setTimeout(r, 800));
      const m = await page.evaluate(() => {

        const items = [...document.querySelectorAll('#today-list .item')];
        if (!items.length) return null;
        const cs = getComputedStyle(items[0].querySelector('.item-title'));
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
        return {
          ws: items.map(i => Math.round(i.getBoundingClientRect().width)),
          hs: items.map(i => Math.round(i.getBoundingClientRect().height)),
          lineH: Math.round(lh)
        };
      });
      if (!m) { check('首页今日 @' + vw + '：量得到今日条目', false, 'none'); continue; }
      const minW = Math.min(...m.ws), maxW = Math.max(...m.ws);
      check('首页今日 @' + vw + '：每条都够宽（≥300px，篇名不折行）',
        minW >= 300, '最窄 ' + minW + 'px');
      check('首页今日 @' + vw + '：每条都没被拉成一条长横带（≤480px）',
        maxW <= 480, '最宽 ' + maxW + 'px');

      check('首页今日 @' + vw + '：条目仍是一行一条（高度没被折行撑起来）',
        Math.max(...m.hs) <= m.lineH * 3.5,
        '最高 ' + Math.max(...m.hs) + 'px（行高 ' + m.lineH + '）');
    }

    for (const vw of [320, 360, 375, 393, 414]) {
      await page.setViewport({ width: vw, height: 800, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await page.goto(base.replace(/\/$/, '') + '/poems/', { waitUntil: 'load' });
      await new Promise(r => setTimeout(r, 700));
      const m = await page.evaluate(() => {
        const de = document.documentElement;
        const btn = document.querySelector('.poems-game-entry');
        const tb = document.querySelector('.toolbar');
        const out = [];
        if (tb) [...tb.children].forEach(c => out.push({ cls: c.className.split(' ')[0], r: Math.round(c.getBoundingClientRect().right) }));
        return {
          overflow: de.scrollWidth - de.clientWidth,
          btnRight: btn ? Math.round(btn.getBoundingClientRect().right) : null,
          vw: de.clientWidth,
          toolbarRight: tb ? Math.round(tb.getBoundingClientRect().right) : null,
          kids: out
        };
      });
      check('/poems/ @' + vw + 'px：工具条不横向溢出',
        m.overflow <= 0,
        '溢出 ' + m.overflow + 'px' + (m.kids.length ? ' / 最右 ' + JSON.stringify(m.kids[m.kids.length - 1]) : ''));
      check('/poems/ @' + vw + 'px：「古诗词大会」那颗键整个落在屏幕内（点得着）',
        m.btnRight !== null && m.btnRight <= m.vw,
        '键右缘 ' + m.btnRight + ' / 视口 ' + m.vw);
    }
    await page.close();
  }

  {
    const { page } = await freshPage();
    const LOGIN = base.replace(/\/$/, '') + '/login/';
    for (const [vw, vh, label] of [[320, 568, 'iPhone SE1'], [360, 640, '安卓小屏'],
      [393, 852, 'iPhone 14'], [768, 1024, 'iPad 竖屏'], [1024, 768, 'iPad 横屏'],
      [1440, 900, '桌面'], [1920, 1080, '大屏桌面']]) {
      await page.setViewport({ width: vw, height: vh, deviceScaleFactor: 1 });
      await page.goto(LOGIN, { waitUntil: 'networkidle0' });
      await new Promise(r => setTimeout(r, 700));
      const m = await page.evaluate(() => {
        const de = document.documentElement;
        const card = document.querySelector('#login-page > .account-card');
        // ⚠️ 页脚删掉之后，「下面还剩多少」不能再量 scrollHeight：
        // 登录页不溢出，scrollHeight 就等于视口高 —— 那样算出来的是
        // 「卡片下缘到视口底」，`margin: auto` 把卡片顶到上半屏之后它
        // 永远是上面那侧的近两倍（852 上量得 上 150 / 下 290），
        // 与卡片居不居中无关。
        //
        // 居中这件事真正的两侧留白是：**上** = 顶栏下缘 → 卡片上缘，
        // **下** = 卡片下缘 → 内容盒（`.app` 去掉它自己那条 padding）下缘。
        // 两侧都由 `#login-page` 的 `min-height` 与 `margin: auto` 决定，
        // 卡片居中时两处相当。
        const cr = card.getBoundingClientRect();
        const tb = document.querySelector('.topbar').getBoundingClientRect();
        const ab = document.querySelector('.app').getBoundingClientRect();
        const padB = parseFloat(getComputedStyle(document.querySelector('.app')).paddingBottom) || 0;
        return {
          vw: de.clientWidth, vh: window.innerHeight,
          overflow: de.scrollHeight - window.innerHeight,
          cardTop: Math.round(cr.top), cardBottom: Math.round(cr.bottom),

          above: Math.round(cr.top - tb.bottom),
          below: Math.round(ab.bottom - padB - cr.bottom)
        };
      });
      check('登录页 @' + vw + '×' + vh + '（' + label + '）：页面不溢出',
        m.overflow <= 0, '溢出 ' + m.overflow + 'px');

      check('登录页 @' + vw + '×' + vh + '（' + label + '）：卡片整张落在视口里',
        m.cardBottom <= m.vh && m.cardTop >= 0,
        '卡片 ' + m.cardTop + '~' + m.cardBottom + ' / 视口 ' + m.vh);

      check('登录页 @' + vw + '×' + vh + '（' + label + '）：卡片顶端没被顶出屏幕',
        m.cardTop >= 0, '卡片顶 ' + m.cardTop + 'px');

      if (m.above >= 0) {
        check('登录页 @' + vw + '×' + vh + '（' + label + '）：卡片仍垂直居中（上下留白相当）',
          Math.abs(m.above - m.below) <= 60,
          '上 ' + m.above + ' / 下 ' + m.below);
      }

      /* ⚠️ 光有「相差 ≤ 60px」这一条**抓不住**「整张卡一起挪」那种改坏：
         `#login-page` 的 `min-height` 里那几笔是「顶栏 + 页脚 + 收尾」的
         和（css/account.css 那一大段注释），页脚（`.foot`）全站删掉之后
         算式没跟着改，卡片按矮了 63px 的盒子重新居中 —— 七档**整齐地**
         偏 140px，而 60px 的容差只比它的一半多一点，**七档全红**。
         量得准的那一条（相对偏差）能把它按「差了多少」直接说出来：
         实测正常值最紧的一档是 58 / 156 ≈ 37%（320×568：屏幕矮、
         卡片几乎占满一屏，上下本来就没多少余量），改动后 140 / 440 ≈ 32%
         —— 短屏那几档（上留白 < 100px）**量不出好阈值**：筛选阀拿掉之后
         正常值最紧的档是 25.4%，与改动后的 32% 挤在一起，分不开。
         所以下面只管屏幕够高的这几档（60 不够，实测要 100），
         它们正常值 ≤ 16%、改动后 ≥ 32%，阈值取 25% 两边都留得住余量。 */
      const span = m.above + m.below;
      // 屏幕够高的档才判（短屏上卡片已占满一屏，量不出「居中」）
      if (m.above >= 100) {
        check('登录页 @' + vw + '×' + vh + '（' + label + '）：卡片几乎就在正中间（相对偏差 ≤ 25%）',
          span > 0 && Math.abs(m.above - m.below) / span <= 0.25,
          '偏差 ' + (span > 0 ? Math.round(Math.abs(m.above - m.below) / span * 1000) / 10 : '-') + '%'
            + '（上 ' + m.above + ' / 下 ' + m.below + '）');
      }
    }
    await page.close();
  }

  await browser.close();

  console.log('\n=== iOS / 多端兼容检查 ===\n');
  Object.keys(results).forEach(k => console.log('  ' + results[k] + ' ' + k));
  console.log('\n共 ' + Object.keys(results).length + ' 项' + (failures ? '，❌ ' + failures + ' 项失败' : '，全部通过 ✅'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
