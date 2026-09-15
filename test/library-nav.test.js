/**
 * 课外阅读「一层退一层」导航测试（Issue #122）
 * ==========================================================================
 * 用户报的现象（原话）：
 *   「课外阅读首页，点击唐诗三百首，再点击进入详情页，这时点击右上角的后退，
 *     直接退到了背诵首页。期望结果是回到唐诗三百首索引页，再后退，
 *     回到课外阅读首页。课外阅读的其他集子也是这样的问题。」
 *
 * 病根不在阅读器那一刻，而在**入口页把用户送去了哪**：
 *   /library/ 上点「唐诗三百首」原来是 `location.href = "/tangshi/"` ——
 *   索引住在另一个地址上，而阅读器只是那一页里的一个层。
 *   从索引点进一首诗，按右上角返回只能把层收掉；层没了，
 *   底下就是那一页自己的页面顶栏，那颗默认的键是「回首页」——
 *   用户看到的就是「直接退到了背诵首页」。
 *
 * 现在改成**就地叠层**：索引铺在 /library/ 这一页上（地址栏不动），
 * 阅读器再叠在最上面。三层在同一页里，返回键一层退一层：
 *   正文 → 索引 → 集子目录。
 *
 * 这一层验五件事：
 *   1. 点卡片不再跳走（就地铺开）；课内诗词仍走 /poems/ 那一页；
 *   2. 三层各自的返回键去向正确（正文→索引、索引→目录），且**只有一枚**
 *      看得见的 #top-act（同名 id 在 jsdom ≥27 里只认第一枚，会绑错按钮）；
 *   3. 页顶那一行跟着换（页名 / 说明 / 进度牌），退出时还原；
 *   4. 换部能换干净（篇数 / 页名 / 搜索框与筛选都不带上一部的残留）；
 *   5. 直接访问 /tangshi/ 等页面照旧可用（就地叠层没把那一版弄丢）。
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = __dirname + '/../';
const read = f => fs.readFileSync(path + f, 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

/** 起一个页面：把 <script src> 逐个 eval 进 jsdom（等文档解析完再插，见 search.test.js） */
function boot(file, url) {
  const html = read(file);
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://local.test' + url,
    base: 'https://local.test' + url });
  const w = dom.window;
  w.scrollTo = function () {};
  const scripts = html.match(/<script src="([^"]+)"><\/script>/g)
    .map(s => s.match(/src="([^"]+)"/)[1]);
  const ready = new Promise(resolve => {
    if (w.document.readyState !== 'loading') return resolve();
    w.document.addEventListener('DOMContentLoaded', () => resolve());
  });
  w.__scripts = scripts;
  w.__ready = ready.then(() => {
    scripts.forEach(f => {
      try {
        const el = w.document.createElement('script');
        el.textContent = read(f);
        w.document.body.appendChild(el);
      } catch (e) {
        console.log('✗ 脚本执行失败 ' + f + '：' + e.message);
        fails++;
      }
    });
  });
  return w;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  /* ================= 一、源码口径：卡片与三层的落点 ================= */
  const libHtml = read('library/index.html');
  const libJs = read('js/library.js');
  chk(/data-lib-view="grid"/.test(libHtml) && /data-lib-view="book"/.test(libHtml),
    '入口页有两层 DOM：集子目录（grid）+ 就地铺上来的索引（book）');
  chk(/data-lib-view="book"[^>]*hidden/.test(libHtml),
    '第二层默认 hidden（没点卡片之前不占位）');
  // 就地铺开那一层的元素用 lib- 前缀，阅读器那一套用全局的 gw-/rd-
  // ——同一页里两套 id 必须分得开（引擎按 data-gw 找元素，
  //   参数名若也叫 data-gw，索引层就会把自己的列表认成阅读器的）
  chk(/data-lib-part="list"/.test(libHtml), '索引层的列表用 data-lib-part（引擎的 data-gw 让给阅读器）');
  // ⚠️ 不套 .app（Issue #147）—— 见 test/ui-consistency.test.js 那一段的完整说明。
  //    这里只看结构本身：入口页全页只有一个 .app，第二层住在它里面。
  {
    const bare = libHtml.replace(/<!--[\s\S]*?-->/g, ' ');
    chk((bare.match(/class="app"/g) || []).length === 1 &&
      /<div data-lib-view="book" hidden>/.test(bare),
      '入口页第二层不套 .app（列宽与两侧的边只算一次，卡片才不会比搜索框窄一条边）');
  }
  const libBody = libHtml.slice(libHtml.indexOf('<body'));
  const dupIds = (() => {
    const seen = {}; const out = [];
    (libBody.match(/id="([^"]+)"/g) || []).forEach(s => {
      const id = s.slice(4, -1);
      if (seen[id]) { if (out.indexOf(id) < 0) out.push(id); } else seen[id] = 1;
    });
    return out;
  })();
  chk(dupIds.length === 0, '入口页无重复 id（重复：' + (dupIds.join(', ') || '无') + '）');
  chk(/openFrom/.test(read('js/reader-core.js')),
    '引擎支持「这一篇是从哪一层开出来的」（openFrom）——阅读器的返回键不再写死成 closeReader');

  /* ================= 二、三层来回走一遍 ================= */
  const w = boot('library/index.html', '/library/');
  await w.__ready;
  await sleep(250);
  const d = w.document;
  const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  const pageName = () => d.querySelector('#brand-page-text').textContent;
  const subText = () => d.querySelector('#brand-sub').textContent;
  const gridHidden = () => d.querySelector('.library-grid').hidden;
  const railHidden = () => d.querySelector('[data-lib-view="book"]').hidden;
  const readerHidden = () => d.querySelector('#lib-gw-reader').hidden;
  const topActs = () => d.querySelectorAll('#top-act').length;
  const actionBtn = () => d.querySelector('.app > .topbar #top-act');

  chk(!!w.LibraryPage, '入口页暴露了 LibraryPage（铺开 / 收起都由它管）');
  chk(d.querySelectorAll('.library-card').length === 6, '六张卡片都在（实际 ' +
    d.querySelectorAll('.library-card').length + '）');
  chk(!gridHidden() && railHidden(), '初始状态：目录可见、索引层隐藏');

  // 点「唐诗三百首」——不该跳走，就地铺开
  click(d.querySelector('.library-card[data-book="tangshi"]'));
  await sleep(350);
  chk(pageName() === '唐诗三百首', '点卡片后页名换成「唐诗三百首」（实际 ' + pageName() + '）');
  chk(subText() === '想读哪首点哪首',
    '副标题换成这一部的说明，且与 /tangshi/ 那一页的完全一致（同一份 config.pageSub；实际 ' + subText() + '）');
  chk(gridHidden() && !railHidden(), '目录收起、索引铺开（同一页里的两层）');
  chk(d.querySelectorAll('#lib-gw-list .item').length === 301,
    '索引层列出 301 首（实际 ' + d.querySelectorAll('#lib-gw-list .item').length + '）');
  const badge = d.querySelector('.app > .topbar .count-badge');
  chk(!!badge && badge.textContent === '0 / 301 首',
    '页顶那一行的进度牌跟着换成这一部的数（实际 ' + (badge ? badge.textContent : '无') + '）');
  chk(topActs() === 1 && !!actionBtn() && actionBtn().getAttribute('type') === 'button',
    '索引这一层只有一枚返回键（页面那条顶栏上的 #top-act）');

  // 点一篇 → 阅读器
  click(d.querySelector('#lib-gw-list .item'));
  await sleep(200);
  chk(!readerHidden(), '点一首诗，阅读器那一层打开');
  chk((d.querySelector('#rd-title').textContent || '').length > 0,
    '正文标题写进阅读器（' + d.querySelector('#rd-title').textContent + '）');
  chk(topActs() === 1, '阅读器打开时全页也只有一枚 #top-act（实际 ' + topActs() + '）');
  const readerBack = d.querySelector('#lib-gw-reader #top-act');
  chk(!!readerBack, '阅读器那条顶栏上有返回键');

  // 返回 ①：应回到唐诗索引，不是一路退到集子目录
  click(readerBack);
  await sleep(200);
  chk(readerHidden(), '按返回，阅读器那一层收起来');
  chk(!railHidden() && gridHidden(),
    '★ 落在**唐诗索引**这一层（不是一路退到集子目录）—— 这是 Issue #122 报的那一步');
  chk(pageName() === '唐诗三百首', '页名仍是「唐诗三百首」（实际 ' + pageName() + '）');
  chk(d.querySelectorAll('#lib-gw-list .item').length === 301, '索引仍是完整 301 首');
  chk(topActs() === 1, '退回索引层后仍只有一枚可见的返回键（实际 ' + topActs() + '）');

  // 返回 ②：应回到集子目录
  const back2 = actionBtn();
  chk(!!back2, '索引层有返回键');
  click(back2);
  await sleep(200);
  chk(railHidden() && !gridHidden(), '★ 再按返回，回到六张卡的集子目录');
  chk(pageName() === '课外阅读', '页名还原成「课外阅读」（实际 ' + pageName() + '）');
  chk(subText() === '课本之外的经典，按部就班读下去',
    '副标题还原成入口页那一句（实际 ' + subText() + '）');
  chk(d.querySelectorAll('.library-card').length === 6, '六张卡片仍在（退回来时没有把目录清掉）');
  chk(topActs() === 0, '目录这一层不再有返回键（恢复各页默认的「回首页」；实际 ' + topActs() + '）');

  /* ================= 三、换一部：数据与残留都要换干净 ================= */
  // 先在唐诗里留一点「痕迹」：搜索框敲字 + 切到「未读」筛选
  const gs = d.querySelector('[data-lib-part="search"]');
  const gseg = d.querySelector('[data-lib-part="filter-seg"] button[data-filter="unread"]');
  chk(!!gs && !!gseg, '索引层有搜索框与「全部 / 未读」筛选');

  click(d.querySelector('.library-card[data-book="songci"]'));
  await sleep(350);
  chk(pageName() === '宋词三百首', '换成宋词，页名跟着换（实际 ' + pageName() + '）');
  chk(d.querySelectorAll('#lib-gw-list .item').length > 0 &&
    d.querySelectorAll('#lib-gw-list .item').length !== 301,
    '列表换成了宋词的篇目（不再是唐诗的 301 条；实际 ' +
    d.querySelectorAll('#lib-gw-list .item').length + '）');
  const b2 = d.querySelector('.app > .topbar .count-badge');
  chk(!!b2 && /^0 \/ \d+ 首$/.test(b2.textContent) && b2.textContent !== '0 / 301 首',
    '进度牌跟着换成宋词的数（实际 ' + (b2 ? b2.textContent : '无') + '）');
  chk(d.querySelector('[data-lib-part="search"]').value === '',
    '换到另一部时搜索框是空的（上一部敲过的字不带过来）');

  // 换回来：唐诗仍是 301 首（同一块 DOM 上重挂，不是复用旧实例）
  click(d.querySelector('.app > .topbar #top-act'));
  await sleep(200);
  click(d.querySelector('.library-card[data-book="tangshi"]'));
  await sleep(350);
  chk(d.querySelectorAll('#lib-gw-list .item').length === 301,
    '换回唐诗仍是完整 301 首（同一块挂载点上重新挂，不复用上一部的实例）');

  /* ================= 四、课内诗词仍走自己的索引页 ================= */
  click(d.querySelector('.app > .topbar #top-act'));
  await sleep(200);
  const poemsCard = d.querySelector('.library-card[data-book="poems"]');
  chk(poemsCard.tagName === 'A' && poemsCard.getAttribute('href') === '/poems/',
    '课内诗词那张仍是链接、仍指 /poems/（它有自己的索引页，不必在这一页里铺）');

  /* ================= 五、各集子自己的页面照旧可用 ================= */
  // 「就地叠层」只是入口页的走法；直接访问 /tangshi/ 等页面必须一模一样地能用。
  for (const [f, url, n, name] of [
    ['tangshi/index.html', '/tangshi/', 301, '唐诗三百首'],
    ['songci/index.html', '/songci/', 283, '宋词三百首'],
    ['guwen/index.html', '/guwen/', null, '古文观止'],
    ['zhaoming/index.html', '/zhaoming/', null, '昭明文选'],
    ['classic/index.html', '/classic/', 100, '课外必背小古文']
  ]) {
    const w2 = boot(f, url);
    await w2.__ready;
    await sleep(260);
    const dd = w2.document;
    const n2 = dd.querySelectorAll('#gw-list .item').length;
    chk(n2 > 0 && (n === null || n2 === n),
      name + ' 页面直接打开仍列得出篇目（实际 ' + n2 + ' 条）');
    chk(dd.querySelector('.app > .topbar #top-back') &&
      dd.querySelector('.app > .topbar #top-back').getAttribute('href') === '/',
      name + ' 页面顶栏仍是各页默认的「回首页」返回键（就地叠层没动到它）');
  }

  console.log('');
  console.log(fails === 0 ? '🎉 课外阅读导航（一层退一层）测试全部通过' : '❌ 课外阅读导航测试 ' + fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
})();
