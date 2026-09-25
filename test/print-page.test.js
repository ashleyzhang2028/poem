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
  /* ⚠️ 页脚（`<footer class="foot settings-foot">`）已在上一轮全站删除，
     纸面上要收的只剩页签那一条。原先这条是「`.dock` 与 `.foot` 都在」，
     页脚一走它就永远判假 —— 不是「纸面漏了页脚」，是它找的那件东西
     已经不存在了。改成**正向**只认 `.dock`，并加一条**反向**守：
     样式表里不许再冒出 `.foot` 的孤儿规则（页脚回来了也得先过这条）。 */
  chk(/\.dock/.test(block),
    '页签在纸上收起来（屏幕上不是内容的东西一件都不上纸）');
  chk(!/\.foot\b/.test(block),
    '纸面上不再为已删除的页脚留规则（页脚全站已删）');

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

  // jsdom 不会真的导航（跳走就是一句 "Not implemented: navigation"），
  // 而「未登录就跳去登录页」正是这一轮要守的那一条。所以给这一份 jsdom
  // 配一个记账用的 location：跳哪儿了、带了什么参数，都记在 nav 上，
  // 测试照旧问 nav.pathname / nav.search。真正的跳转仍由 js/print.js 里
  // 那句 location.href = ... 发起（见下方对脚本源码的那一处替换）。
  const nav = {
    url: 'https://local.test/settings/lists/',
    pathname: '/settings/lists/',
    get search() { return new URL(nav.url, 'https://local.test').search; },
    get href() { return nav.url; },
    set href(t) {
      nav.url = String(t);
      nav.pathname = new URL(nav.url, 'https://local.test').pathname;
    }
  };
  w.__nav = nav;
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
    let src = fs.readFileSync(path + f.replace(/^\//, ''), 'utf8');
    // jsdom 里 location 是不可换的（换成假的会触发真的导航），而
    // 「跳去登录页」正是这一轮要守的行为。所以在**这一份 jsdom 副本**里
    // 只把 location 换成记账用的假货 —— 仓库里的 js/print.js 一个字不动，
    // 跳转这件事仍然由它自己那句 location.href = ... 发起。
    src = src.replace(/\bvar Ent = window\.Entitlement;/,
      'var loc = window.__nav;\n  var Ent = window.Entitlement;');
    src = src.replace(/location\.href = /g, 'loc.href = ');
    src = src.replace(/location\.pathname/g, 'loc.pathname');
    src = src.replace(/if \(!entryUrl\) entryUrl = String\(location\.href\);/,
      'if (!entryUrl) entryUrl = String(loc.href);');
    const el = w.document.createElement('script');
    el.textContent = src;
    w.document.body.appendChild(el);
  });
  return { w: w, d: w.document, dom: dom, nav: nav };
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
  console.log('\n=== 四、未登录：不摆卡片，直接送去登录页（Issue #229）===');
  {
    const { w, d, nav } = boot({ localStorage: FIXTURE });
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

    eq(host.hidden, true, '未登录点入口：那一层仍然收着（不铺卡片、不铺预览）');
    eq(host.innerHTML, '', '未登录点入口：这一层里一个字都没画出来');
    eq(nav.pathname, '/login/', '未登录点入口：直接跳到 /login/（jsdom 里 location 换不掉，跳转由这一段记账）');
    eq(nav.search, '?next=' + encodeURIComponent('/settings/lists/'),
      '跳转带上回来的路（?next= 当前页路径）');
    chk(!d.querySelector('[data-print-paper]'), '未登录时一个纸型键都不画');
    chk(!d.querySelector('[data-print-run]'), '未登录时也没有「打印 / 存 PDF」那颗键');

    // 卡片里的那两句与那颗键都该没了：未登录的人根本走不到这一层
    const js = read('js/print.js');
    chk(!/data-print-go/.test(js), 'js/print.js 里没有「去登录」那颗键了（不再摆登录按钮）');
    chk(!/用邮箱建一个账号/.test(js), 'js/print.js 里没有「用邮箱建一个账号」（注册的活在登录页上）');
    chk(!/登录可用/.test(read('js/entitlement.js')) || /reason === "login"/.test(read('js/entitlement.js')),
      '「登录可用」只作为 entitlement 的通用拒绝文案存在，不再被打印页印到卡片上');
    chk(!/account-btn[\s\S]{0,80}\/login\//.test(js),
      '这一层的卡片里不再有往登录页去的按钮');

    // 上一步点入口已经跳到 /login/ 了：把记的账放回原页，问它「从这一页
    // 被送走的话，回来的路是什么」。
    nav.pathname = '/settings/lists/';
    nav.url = 'https://local.test/settings/lists/';
    const lu = w.PrintPage.loginUrl() || '';
    chk(lu.indexOf('/login/?next=') === 0,
      'loginUrl() 是 /login/?next=... 的形状（实际 ' + lu + '）');
    eq(decodeURIComponent(lu.split('next=')[1] || ''),
      '/settings/lists/', 'loginUrl() 给的 next 就是当前页（未登录时唯一的去处）');

    const opened = w.PrintPage.open({ collectionId: 'c-test' });
    await wait(40);
    eq(opened, false, '未登录直接喊 open()：如实返回 false（没打开）');
    eq(host.innerHTML, '', '未登录直接喊 open()：仍然一个字都不画');

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
    chk(!/登录可用/.test(ft), '那张卡片里没有「登录可用」这句话（他已经登录了）');
    chk(!/用邮箱建一个账号/.test(ft), '那张卡片里没有创建账号的按钮');
    chk(!free.d.querySelector('[data-print-go]'), '那张卡片里没有往登录页去的键');
    chk(/四种用户对比/.test(ft), '只留下如实的一句：层级由管理员发放 + 去哪看对照表');
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
