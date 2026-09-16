/**
 * 古诗词大会 · 页面层测试（3 期 · /poems/ 上就地铺开的那一层）
 * ==========================================================================
 * 用户 2026-09-17 的裁决（Issue #159）：
 *   「现场考试和飞花令归 max 所有，题库归 pro.」
 *
 * 这一层验**真页面**（jsdom 里把 /poems/ 整页跑起来），守四件事：
 *   1. **入口在索引页上，不是新的一站** —— 底部四个页签一个都不加；
 *      点那颗键**就地**铺开（地址栏不动），返回键一层退一层；
 *   2. **不提前渲染一个字** —— 未登录时三张卡都锁着，且只显示
 *      「要哪一层 / 怎么拿到」，绝不写「即将上线」；
 *   3. **判权一律走 Entitlement.can()** —— 页面不自己比 tier；
 *   4. **答案先不给** —— 飞花令的「看答案」是点开才生成内容
 *      （不是拿 CSS 遮住），点开之后能跳到原文。
 *
 * 跑法：`node test/game-page.test.js`（需要 jsdom；没有就跳过）
 */
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

/* ================= 一、结构：入口在索引页上，页签一个都不加 ================= */
console.log('=== 一、结构：入口在索引页上，底部页签一个都不加 ===');
{
  const html = read('poems/index.html');
  const chrome = read('js/chrome.js');

  chk(/data-poems-view="game"/.test(html), '/poems/ 里有这一层的挂载点');
  chk(/data-game-open/.test(html), '/poems/ 上有进这一层的键');
  /* ⚠️ 判据是「那个 div 的**标签之间**没有东西」，不是「整页里没有这句话」——
     那段说明就写在它头顶的注释里（注释里的字不渲染，也不是提前渲染）。 */
  const slot = html.replace(/<!--[\s\S]*?-->/g, '')
    .match(/<div[^>]*data-poems-view="game"[^>]*>([\s\S]*?)<\/div>/);
  chk(!!slot, '那一层的挂载点是个 div');
  eq((slot ? slot[1] : 'x').trim(), '',
    '那一层是空容器（内容全部由 js/game.js 渲染，HTML 里不写死一句话）');

  // 底部页签仍是四个，一个都不加（大会挂在索引页里，不是新的一站）
  const items = (chrome.match(/var DOCK_ITEMS = \[([\s\S]*?)\];/) || [, ''])[1];
  const n = (items.match(/\{ key:/g) || []).length;
  eq(n, 4, '底部仍是四个页签（古诗词大会不占页签位）');
  chk(!/game|大会/.test(items), '页签里没有「大会」这一格');

  // 路由认得 /poems/（这一层住在它里面，地址栏不动）
  chk(/poems: "\/poems\/"/.test(chrome), 'js/chrome.js 的 ROUTES 里有 /poems/');

  // 脚本顺序：权益层 → 接线层 → 内核 → 本页
  const order = html.match(/<script src="([^"]+)"><\/script>/g)
    .map(s => s.match(/src="([^"]+)"/)[1]);
  const at = f => order.indexOf(f);
  chk(at('js/entitlement.js') >= 0, '/poems/ 加载了权益层 js/entitlement.js');
  chk(at('js/auth-api.js') >= 0 && at('js/auth-api.js') < at('js/account-api.js'),
    'auth-api 排在 account-api 之前（前者是后者的传输依赖）');
  chk(at('js/entitlement.js') < at('js/account-api.js'),
    'entitlement 排在 account-api 之前（要先把权益层装上）');
  chk(at('js/quiz.js') >= 0, '/poems/ 加载了出题内核 js/quiz.js');
  chk(at('js/quiz.js') < at('js/game.js'), '内核排在 js/game.js 之前');
  chk(at('js/game.js') < at('js/chrome.js'), 'js/game.js 排在 js/chrome.js 之前（顶栏要读它）');
  chk(/css\/account\.css/.test(html), '/poems/ 加载了 css/account.css（这一层与账号页共用卡片）');
}

/* ================= 二、离线：新页面与新脚本都进预缓存 ================= */
console.log('\n=== 二、离线：新脚本都进预缓存，版本号跟着提 ===');
{
  const sw = read('sw.js');
  ['js/quiz.js', 'js/game.js'].forEach(f => {
    chk(sw.indexOf('"./' + f + '"') >= 0, 'sw.js 预缓存里有 ' + f);
  });
  chk(sw.indexOf('"./js/account-api.js"') >= 0, 'sw.js 预缓存里有 js/account-api.js（本来就在）');
  const ver = parseInt((sw.match(/poem-app-v(\d+)/) || [0, '0'])[1], 10);
  chk(ver >= 128, '缓存版本已跟着提（本轮新增 2 个脚本，实际 v' + ver + '）');
  const list = [...sw.matchAll(/"(\.\/[^"]+)"/g)].map(m => m[1]);
  const missing = list.filter(u => {
    if (u === './') return false;
    const f = u.replace(/^\.\//, '');
    if (fs.existsSync(path + f)) return false;
    if (/\/$/.test(f) && fs.existsSync(path + f + 'index.html')) return false;
    return true;
  });
  chk(missing.length === 0, '预缓存清单里的文件都存在（实际缺 ' + missing.join(',') + '）');
  // 服务端那一条路由也在（判分口）
  chk(fs.existsSync(path + 'api/game/answer.js'), 'api/game/answer.js 存在（判分口）');
}

/* ================= 三、页面层：锁着 → 解锁，一层退一层 ================= */

/** 把 /poems/ 整页在 jsdom 里跑起来，返回 { w, d } */
function boot(opts) {
  const o = opts || {};
  const html = read('poems/index.html');
  const order = html.match(/<script src="([^"]+)"><\/script>/g)
    .map(s => s.match(/src="([^"]+)"/)[1]);

  /* ⚠️ 必须 `dangerously`：`outside-only` 下用 textContent 注入的 <script>
     不会执行，整页一片空白（`window.Quiz` 也是 undefined，看起来像
     「文件没加载上」，其实是注入方式不对）。与 test/poems-page.test.js 同款。 */
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://local.test/poems/',
    base: 'https://local.test/poems/',
    pretendToBeVisual: true
  });
  const w = dom.window;
  w.scrollTo = function () {};
  // fetch 桩：判分口回 503（服务端没配）—— 于是页面走「本机判分」那一支
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
    el.textContent = fs.readFileSync(path + f, 'utf8');
    w.document.body.appendChild(el);
  });
  return { w: w, d: w.document, dom: dom };
}

const wait = ms => new Promise(r => setTimeout(r, ms));

/**
 * 在这个 jsdom 窗口里造一个**真的已登录会话**。
 *
 * ⚠️ 直接往 localStorage 里塞一个 `poem_plan_v1` 是**不够的**：
 *    那个键只带层级，`identity()` 的 `signedIn` 读的是会话
 *    （`AuthCore.session()`），塞不出「已登录」这一个状态 ——
 *    于是三张卡照旧全锁着，看起来像「Pro 不被认」。
 *    这里走内核**真的那一条路**（请求码 → 校验码），拿到会话，
 *    与浏览器里的登录链路同一份代码。
 */
function signIn(w, tier) {
  const A = w.AuthCore;
  const st = A.makeStore(w.localStorage);
  const identity = { channel: 'email', value: 'player@example.com' };
  const asked = A.requestCode(st, identity, 'login', {});
  if (!asked || !asked.ok) return false;
  const done = A.verifyCode(st, asked.codeId, asked.code || asked.devCode, 'login');
  if (!done || !done.ok) return false;
  if (tier && tier !== 'free') {
    w.localStorage.setItem('poem_plan_v1',
      JSON.stringify({ v: 1, tier: tier, source: 'server', role: 'user' }));
  }
  // 让接线层把服务端那一份落进权益层（这里没有真服务端，直接写那一个键，
  // 与 /api/me 成功返回时写的是同一个形状）
  return !!A.session(st);
}

/** 点一颗键（jsdom 的 click 不冒泡到 document 上时也能用） */
function click(el) {
  el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
}

(async function main() {
  console.log('\n=== 三、未登录：三张卡都锁着，如实说要哪一层 ===');
  {
    const { w, d } = boot({});
    await wait(60);

    const entry = d.querySelector('[data-game-open]');
    chk(!!entry, '工具条上那颗「古诗词大会」键在');
    chk(entry.textContent.indexOf('古诗词大会') >= 0, '那颗键上写着名字');
    chk(entry.getAttribute('aria-hidden') !== 'true', '那颗键**照旧可见**（不许把入口藏起来当权限边界）');

    const host = d.querySelector('[data-poems-view="game"]');
    chk(host.hidden === true, '那一层默认收着（点才铺上来）');
    eq(host.innerHTML, '', '收着时里面一个字都没有（不提前渲染）');

    click(entry);
    await wait(60);
    chk(host.hidden === false, '点一下铺开那一层（就地，地址栏不动）');
    chk(host.textContent.indexOf('**') < 0, '铺开后的文字里也没有 `**`（同一条防线）');
    eq(w.location.pathname, '/poems/', '地址栏仍是 /poems/（就地叠层，不是跳走）');
    chk(d.querySelector('[data-poems-view="list"]').hidden === true,
      '铺开时下面的列表收起来（两层不同时露面）');

    const modes = [...host.querySelectorAll('[data-game-mode]')];
    eq(modes.length, 3, '三个玩法都列出来了');
    eq(modes.map(m => m.getAttribute('data-game-mode')).join(','), 'fly,paper,review',
      '顺序是 飞花令 → 现场考试 → 题库复习');
    eq(modes.filter(m => m.getAttribute('data-locked')).length, 3,
      '未登录时三张卡都锁着');
    chk(modes.every(m => m.getAttribute('data-locked')), '锁着的那三张都带 data-locked（点了不给开）');

    const text = host.textContent;
    chk(/登录/.test(text), '文案说清「要先登录」（不是「层级不够」）');
    /* ⚠️ 界面文字是直接进 innerHTML 的，**Markdown 的 `**加粗**` 会原样显示乘号**
       —— 要强调就用 <strong>。这条是实测踩到的（「**不是防作弊**」把星号画了出来）。 */
    chk(text.indexOf('**') < 0, '界面文字里不出现 Markdown 的 `**`（要强调就用 <strong>）');
    chk(!/即将上线|敬请期待/.test(text), '不写「即将上线」这类跑在代码前面的承诺');
    chk(!/层|Pro|Max/.test(text) || /登录/.test(text), '未登录时先提登录，不先提层级');

    // 点了锁着的卡：不换屏（还在三张卡那一屏）
    click(modes[0]);
    await wait(20);
    chk(!!host.querySelector('[data-game-mode]'), '点锁着的卡不给开局（还在选玩法那一屏）');

    /* 页顶那一行：铺开时换成本页的页名与说明，且动作位是「返回诗词列表」 */
    chk(/古诗词大会/.test(d.querySelector('.topbar').textContent),
      '页顶那一行换成了本页的页名（就地叠层，不是跳走）');
    const backBtn = d.querySelector('.topbar [data-back], .topbar button');
    chk(!!backBtn, '右上角有一颗返回键');

    /* 一层退一层：按返回收掉这一层，回到诗词列表 */
    click(backBtn);
    await wait(30);
    chk(host.hidden === true, '返回键收掉这一层');
    chk(d.querySelector('[data-poems-view="list"]').hidden === false, '收掉之后列表回来了');
    chk(/课内古诗词/.test(d.querySelector('.topbar').textContent),
      '页名换回「课内古诗词」');
  }

  console.log('\n=== 四、Pro：题库复习能开，飞花令与现场考试仍锁着 ===');
  {
    const { w, d } = boot({});
    await wait(60);
    chk(signIn(w, 'pro'), '造出一个真的已登录会话（走内核的请求码 → 校验码）');
    const host = d.querySelector('[data-poems-view="game"]');
    w.PoemGame.open();
    await wait(80);

    const locked = [...host.querySelectorAll('[data-game-mode][data-locked]')]
      .map(m => m.getAttribute('data-game-mode'));
    eq(locked.sort().join(','), 'fly,paper',
      'Pro 时锁着的是飞花令与现场考试（用户裁决：归 Max）');
    const open = [...host.querySelectorAll('[data-game-mode]')]
      .filter(m => !m.getAttribute('data-locked'))
      .map(m => m.getAttribute('data-game-mode'));
    eq(open.join(','), 'review', 'Pro 时能开的是题库复习');

    // 题库复习真能开局：五道题、每题四个选项
    const reviewBtn = host.querySelector('[data-game-mode="review"]');
    click(reviewBtn);
    await wait(180);
    const opts = [...host.querySelectorAll('[data-game-opt]')];
    eq(opts.length, 4, '开局之后是一道四选一的题（四个选项）');
    chk(/第 1 \/ 5 题/.test(host.textContent), '卷子共 5 题（题库复习）');

    // 选一条 → 当场给反馈
    click(opts[0]);
    await wait(60);
    chk(/对了。|这一题答案是：/.test(host.textContent), '选完当场给一次反馈（对 / 错都说得清）');
  }

  console.log('\n=== 五、Max：三个玩法全开 ===');
  {
    const { w, d } = boot({});
    await wait(60);
    chk(signIn(w, 'max'), '造出一个 Max 的已登录会话');
    const host = d.querySelector('[data-poems-view="game"]');
    w.PoemGame.open();
    await wait(80);
    eq(host.querySelectorAll('[data-game-mode][data-locked]').length, 0,
      'Max 时三张卡都解锁');
    chk(host.textContent.indexOf('**') < 0, 'Max 屏的说明文字里也没有 `**`');

    /* 飞花令：**看答案之前一个句子都不给**（不是拿 CSS 遮住） */
    click(host.querySelector('[data-game-mode="fly"]'));
    await wait(260);
    chk(!!host.querySelector('.game-char'), '飞花令开局：给出了令字');
    eq(host.querySelectorAll('.game-line').length, 0,
      '**看答案之前，结果里一句都没有**（内容先不生成，不是遮住）');
    const reveal = host.querySelector('[data-game-reveal]');
    chk(!!reveal, '有一颗「看答案」的键');
    chk(/看答案（\d+ 句）/.test(reveal.textContent),
      '那颗键先报「能对上几句」：' + reveal.textContent.trim());

    click(reveal);
    await wait(80);
    const lines = [...host.querySelectorAll('.game-line')];
    chk(lines.length > 0, '点开之后才生成结果（' + lines.length + ' 句）');
    chk(lines.every(l => l.querySelector('.game-line-text') && l.querySelector('.game-line-src')),
      '每一句都带正文与出处两行');
    chk(host.querySelectorAll('.game-hit').length > 0, '命中的令字被标出来了');

    /* 点一句 → 跳到那一篇的原文（走索引页自己的阅读器） */
    click(lines[0]);
    await wait(120);
    chk(d.querySelector('#gw-reader') && d.querySelector('#gw-reader').hidden === false,
      '点结果里那一句打开了那一篇的原文（阅读器叠上来）');
  }

  console.log('\n' + (fails ? '❌ ' + fails + ' 项失败' : '🎉 古诗词大会页面测试全部通过'));
  process.exit(fails ? 1 : 0);
})().catch(e => {
  console.error('测试自身抛异常（这通常是环境问题，不是被测代码）：', e);
  process.exit(1);
});
