const fs = require('fs');
const path = __dirname + '/../';

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };
const eq = (a, b, m) => chk(a === b, m + '（实际 ' + JSON.stringify(a) + '）');

let JSDOM = null;
try { JSDOM = require('jsdom').JSDOM; } catch (e) {
  console.log('(未安装 jsdom，跳过页面层测试。启用：npm i jsdom)');
  process.exit(0);
}

const read = f => fs.readFileSync(path + f, 'utf8');

console.log('=== 一、结构：入口在「我的清单」页上，底部页签一个都不加 ===');
{
  const html = read('settings/lists/index.html');
  const poems = read('poems/index.html');
  const chrome = read('js/chrome.js');

  chk(/data-print-view="sheet"/.test(html), '/settings/lists/ 里有这一层的挂载点');
  chk(/data-print-open/.test(html), '/settings/lists/ 上有进这一层的键');

  const slot = html.replace(/<!--[\s\S]*?-->/g, '')
    .match(/<div[^>]*data-print-view="sheet"[^>]*>([\s\S]*?)<\/div>/);
  chk(!!slot, '那一层的挂载点是个 div');
  eq((slot ? slot[1] : 'x').trim(), '',
    '那一层是空容器（内容全部由 js/print.js 渲染，HTML 里不写死一句话）');

  chk(/data-print-open/.test(poems) && /data-print-poem/.test(poems),
    '/poems/ 详情页工具条上有「这一篇打出来」那颗键（带 data-print-poem）');
  chk(/data-print-view="sheet"/.test(poems), '/poems/ 上也有这一层的挂载点');

  const items = (chrome.match(/var DOCK_ITEMS = \[([\s\S]*?)\];/) || [, ''])[1];
  const n = (items.match(/\{ key:/g) || []).length;
  eq(n, 4, '底部仍是四个页签（打印不占页签位）');
  chk(!/print|打印/.test(items), '页签里没有「打印」这一格');

  const order = html.match(/<script src="([^"]+)"><\/script>/g)
    .map(s => s.match(/src="([^"]+)"/)[1]);
  const at = f => order.indexOf(f);
  chk(at('/js/print-core.js') >= 0, '本页加载了版面内核 js/print-core.js');
  chk(at('/js/print-core.js') < at('/js/print.js'), '内核排在 js/print.js 之前');
  chk(at('/js/collections.js') < at('/js/print.js'),
    '自选清单那一层排在打印之前（打印读的就是它）');
  chk(/css\/account\.css/.test(html), '本页加载了 css/account.css（这一层与账号页共用卡片）');
}

console.log('\n=== 二、离线：新脚本都进预缓存，版本号跟着提 ===');
{
  const sw = read('sw.js');
  ['js/print-core.js', 'js/print.js'].forEach(f => {
    chk(sw.indexOf('"./' + f + '"') >= 0, 'sw.js 预缓存里有 ' + f);
  });
  const ver = parseInt((sw.match(/poem-app-v(\d+)/) || [0, '0'])[1], 10);
  chk(ver >= 130, '缓存版本已跟着提（本轮新增 2 个脚本，实际 v' + ver + '）');
  const list = [...sw.matchAll(/"(\.\/[^"]+)"/g)].map(m => m[1]);
  const missing = list.filter(u => {
    if (u === './') return false;
    const f = u.replace(/^\.\//, '');
    if (fs.existsSync(path + f)) return false;
    if (/\/$/.test(f) && fs.existsSync(path + f + 'index.html')) return false;
    return true;
  });
  chk(missing.length === 0, '预缓存清单里的文件都存在（实际缺 ' + missing.join(',') + '）');
}

console.log('\n=== 三、打印样式表：收外壳、去颜色，不给纸面上添东西 ===');
{
  const css = read('css/account.css');

  function blockOf(src, at) {

    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const start = stripped.indexOf(at);
    if (start < 0) return '';
    src = stripped;
    let depth = 0;
    for (let i = src.indexOf('{', start); i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') {
        depth -= 1;
        if (depth === 0) return src.slice(start, i + 1);
      }
    }
    return '';
  }
  const block = blockOf(css, '@media print');
  chk(!!block, 'css/account.css 里有 @media print 那一块');

  chk(/\.topbar[^{]*\{[\s\S]{0,200}display:\s*none\s*!important/.test(block),
    '顶栏在纸上收起来');
  chk(/\.dock/.test(block) && /\.foot/.test(block),
    '页签与页脚在纸上收起来（屏幕上不是内容的东西一件都不上纸）');

  chk(/\.print-block \+ \.print-block[^{]*\{[^}]*border-top:\s*0\s*!important/.test(block),
    '预览的辅助虚线在纸上被删掉（纸面上不添横线）');
  chk(/\{[\s\S]*?background:\s*#fff\s*!important/.test(block) || /background:\s*#fff\s*!important/.test(block),
    '底色改白（省墨；彩色打印机上也不会糊）');

  chk(!/font-size/.test(block), '打印样式表里一条 font-size 都没有（不重排、不改字号）');
  chk(!/column-count|columns:/.test(block), '打印样式表里不自己分栏（栏数由版面参数给）');
}

function boot(opts) {
  const o = opts || {};
  const html = read('settings/lists/index.html');
  const order = html.match(/<script src="([^"]+)"><\/script>/g)
    .map(s => s.match(/src="([^"]+)"/)[1]);

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://local.test/settings/lists/',
    base: 'https://local.test/settings/lists/',
    pretendToBeVisual: true
  });
  const w = dom.window;
  w.scrollTo = function () {};
  w.print = function () { w.__printed = (w.__printed || 0) + 1; };
  w.fetch = function () {
    return Promise.resolve({
      ok: false, status: 503,
      text: function () { return Promise.resolve(JSON.stringify({ code: 'E_NOT_CONFIGURED' })); }
    });
  };
  if (o.localStorage) {
    Object.keys(o.localStorage).forEach(k => { w.localStorage.setItem(k, o.localStorage[k]); });
  }
  order.forEach(function (f) {
    const el = w.document.createElement('script');
    el.textContent = fs.readFileSync(path + f.replace(/^\//, ''), 'utf8');
    w.document.body.appendChild(el);
  });
  return { w: w, d: w.document, dom: dom };
}

const wait = ms => new Promise(r => setTimeout(r, ms));
function click(el) {
  el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
}

function signIn(w, tier) {
  const A = w.AuthCore;
  const st = A.makeStore(w.localStorage);
  const identity = { channel: 'email', value: 'parent@example.com' };
  const asked = A.requestCode(st, identity, 'login', {});
  if (!asked || !asked.ok) return false;
  const done = A.verifyCode(st, asked.codeId, asked.code || asked.devCode, 'login');
  if (!done || !done.ok) return false;
  if (tier && tier !== 'free') {
    w.localStorage.setItem('poem_plan_v1',
      JSON.stringify({ v: 1, tier: tier, source: 'server', role: 'user' }));
  }
  return !!A.session(st);
}

const FIXTURE = {
  poem_recite_collections_v1: JSON.stringify({
    version: 1,
    collections: [{
      id: 'c-test', name: '打印试试', createdAt: 1,
      items: [{ id: 'poems-xx1-01' }, { id: 'poems-xx1-02' }]
    }]
  })
};

(async function main() {
  console.log('\n=== 四、未登录：只说要哪一层，入口照旧看得见 ===');
  {
    const { w, d } = boot({ localStorage: FIXTURE });
    await wait(60);

    const entry = d.querySelector('[data-print-open]');
    chk(!!entry, '「打印这份清单」那颗键在（「我的清单」页上）');
    chk(entry.getAttribute('hidden') === null && entry.disabled !== true,
      '那颗键**照旧可点**（不许把入口藏起来当权限边界）');

    const host = d.querySelector('[data-print-view="sheet"]');
    chk(host.hidden === true, '那一层默认收着（点才铺上来）');
    eq(host.innerHTML, '', '收着时里面一个字都没有（不提前渲染）');

    click(entry);
    await wait(60);
    chk(host.hidden === false, '点一下铺开那一层（就地，地址栏不动）');
    eq(w.location.pathname, '/settings/lists/', '地址栏仍是 /settings/lists/（就地叠层，不是跳走）');

    const text = host.textContent;
    chk(/登录/.test(text), '文案说清「要先登录」（不是「层级不够」）');
    chk(!/即将上线|敬请期待|稍后开放/.test(text), '不写「即将上线」（2A 立的规矩：不提前渲染）');
    chk(text.indexOf('**') < 0, '文字里没有裸 `**`（进 innerHTML 的那段不许写 Markdown 加粗）');
    chk(!d.querySelector('[data-print-paper]'), '锁着时一个纸型键都不画');

    chk(!!d.querySelector('#collections-list'), '自选清单照旧渲染（这一层不抢它的活）');
  }

  console.log('\n=== 五、Free（不够）与 Pro（够）分得清 ===');
  {
    const free = boot({ localStorage: FIXTURE });
    await wait(60);
    signIn(free.w, 'free');
    click(free.d.querySelector('[data-print-open]'));
    await wait(60);
    const ft = free.d.querySelector('[data-print-view="sheet"]').textContent;
    chk(/Pro/.test(ft), 'Free 登录后如实说要 Pro（实际含 Pro）');
    chk(!/登录/.test(ft) || /层级/.test(ft), 'Free 时不再说「去登录」（他已经登录了）');
  }
  {
    const { w, d } = boot({ localStorage: FIXTURE });
    await wait(60);
    signIn(w, 'pro');
    click(d.querySelector('[data-print-open]'));
    await wait(60);
    const host = d.querySelector('[data-print-view="sheet"]');
    chk(!!host.querySelector('[data-print-run]'), 'Pro 有「打印 / 存 PDF」那颗键');
    eq(host.querySelectorAll('[data-print-paper]').length, 3, '三种纸型都列出来了');

    const js = read('js/print.js');
    chk(/Ent\.can\(CAP/.test(js), '判权走 Entitlement.can()（不是自己比 tier）');
    chk(!/tier\s*===\s*["']pro|tier\s*===\s*["']max/.test(js), '本文件里没有一处自己比 tier');
    chk(/denyReason/.test(js), '拒绝文案走 denyReason()（页面不自造）');
  }

  console.log('\n=== 六、预览与「约几张」跟着三个块开关走 ===');
  {
    const { w, d } = boot({ localStorage: FIXTURE });
    await wait(60);
    signIn(w, 'pro');
    click(d.querySelector('[data-print-open]'));
    await wait(60);
    const host = d.querySelector('[data-print-view="sheet"]');

    const rowsNow = () => host.querySelectorAll('.print-row').length;
    const sheetsNow = () => Number((host.textContent.match(/约 (\d+) 张/) || [, '0'])[1]);

    const base = rowsNow();
    chk(base > 0, '预览里真的有正文行（实际 ' + base + ' 行）');
    chk(sheetsNow() >= 1, '说清了「约几张」（实际 ' + sheetsNow() + '）');

    const blankBox = host.querySelector('[data-print-toggle="blank"]');
    chk(!!blankBox, '有「注释格线」那个开关');
    blankBox.checked = true;
    blankBox.dispatchEvent(new w.Event('change', { bubbles: true }));
    await wait(40);
    chk(host.querySelectorAll('.print-blank').length > 0,
      '开格线：预览里真的多出空白行（不是只在内存里记了个标志）');

    const transBox = host.querySelector('[data-print-toggle="translation"]');
    transBox.checked = true;
    transBox.dispatchEvent(new w.Event('change', { bubbles: true }));
    await wait(40);
    chk(host.querySelectorAll('.print-row-translation').length > 0,
      '开译文：预览里真的多出译文行');

    const wide = host.querySelector('[data-print-paper="a4wide"]');
    click(wide);
    await wait(40);
    chk(!!host.querySelector('[data-print-paper="a4wide"].active') ||
        /A4 横向/.test(host.textContent), '点一下换纸型，界面跟着重画');

    click(host.querySelector('[data-print-run]'));
    await wait(40);
    eq(w.__printed, 1, '点「打印 / 存 PDF」真的调了浏览器的打印（不假装生成文件）');

    const js = read('js/print.js');
    chk(!/jsPDF|pdfkit|pdf-lib/.test(js), '本文件里没有引任何 PDF 库（引一个就是几百 KB）');
    chk(/window\.print\(\)/.test(js), '走的是浏览器的打印对话框');
  }

  console.log('\n=== 七、打的是原文：一个标点都不改 ===');
  {
    const { w, d } = boot({ localStorage: FIXTURE });
    await wait(60);
    signIn(w, 'pro');
    click(d.querySelector('[data-print-open]'));
    await wait(60);
    const host = d.querySelector('[data-print-view="sheet"]');

    const printed = [...host.querySelectorAll('.print-row-text')].map(e => e.textContent);
    chk(printed.length > 0, '预览里有正文行');

    const idx = w.SITE_INDEX || [];
    const all = idx.map(p => p.text || '').join('\n');
    const bad = printed.filter(t => all.indexOf(t.trim()) < 0);
    eq(bad.length, 0, '预览里每一行都能在原文里逐字找到（没有一行是重排出来的）');

    const lead = printed.filter(t => /^[，。、；：？！]/.test(t.trim()));
    eq(lead.length, 0, '没有一行以标点开头（断行位置正确）');
  }

  console.log('\n=== 八、篇目打印页不自己拼 /api、不写存储 ===');
  {
    const js = read('js/print.js');
    chk(!/fetch\(|XMLHttpRequest/.test(js), 'js/print.js 不自己发网络请求（这一件是全本机的）');
    chk(!/\/api\//.test(js), 'js/print.js 里不出现 /api 字面量');
    chk(!/localStorage\.setItem|Storage\.set\(/.test(js),
      'js/print.js 不写存储（纸型与开关是这一层自己的界面状态，不上本机存储）');
  }

  console.log(fails === 0 ? '\n🎉 篇目打印页 · 页面层测试全部通过' : '\n❌ ' + fails + ' 项失败');
  process.exit(fails ? 1 : 0);
})();
