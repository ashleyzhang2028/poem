const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = __dirname + '/../';
const read = f => fs.readFileSync(path + f, 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

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

  const libHtml = read('library/index.html');
  const libJs = read('js/library.js');
  chk(/data-lib-view="grid"/.test(libHtml) && /data-lib-view="book"/.test(libHtml),
    '入口页有两层 DOM：集子目录（grid）+ 就地铺上来的索引（book）');
  chk(/data-lib-view="book"[^>]*hidden/.test(libHtml),
    '第二层默认 hidden（没点卡片之前不占位）');

  chk(/data-lib-part="list"/.test(libHtml), '索引层的列表用 data-lib-part（引擎的 data-gw 让给阅读器）');

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
  chk(d.querySelectorAll('.library-card').length === 7, '七张卡片都在（实际 ' +
    d.querySelectorAll('.library-card').length + '）');
  chk(!gridHidden() && railHidden(), '初始状态：目录可见、索引层隐藏');

  click(d.querySelector('.library-card[data-book="tangshi"]'));
  await sleep(350);
  chk(pageName() === '唐诗三百首', '点卡片后页名换成「唐诗三百首」（实际 ' + pageName() + '）');
  chk(subText() === '按卷一至卷八 · 五言七言 · 律诗绝句',
    '副标题换成这一部的总结，且与 /tangshi/ 那一页的完全一致（同一份 config.pageSub；实际 ' + subText() + '）');
  chk(gridHidden() && !railHidden(), '目录收起、索引铺开（同一页里的两层）');
  chk(d.querySelectorAll('#lib-gw-list .item').length === 317,
    '索引层列出 317 首（实际 ' + d.querySelectorAll('#lib-gw-list .item').length + '）');

  chk(d.querySelector('.app > .topbar .count-badge') === null,
    '页顶那一行不再挂已读进度牌（实际 ' +
    (d.querySelector('.app > .topbar .count-badge') ?
      d.querySelector('.app > .topbar .count-badge').textContent : '无') + '）');
  chk(!/\d\s*\/\s*\d+\s*(篇|首)/.test(d.querySelector('.app > .topbar').textContent),
    '页顶整行不含「N / M 篇」这类读数（实际「' +
    d.querySelector('.app > .topbar').textContent + '」）');
  chk(topActs() === 1 && !!actionBtn() && actionBtn().getAttribute('type') === 'button',
    '索引这一层只有一枚返回键（页面那条顶栏上的 #top-act）');

  click(d.querySelector('#lib-gw-list .item'));
  await sleep(200);
  chk(!readerHidden(), '点一首诗，阅读器那一层打开');
  chk((d.querySelector('#rd-title').textContent || '').length > 0,
    '正文标题写进阅读器（' + d.querySelector('#rd-title').textContent + '）');
  chk(topActs() === 1, '阅读器打开时全页也只有一枚 #top-act（实际 ' + topActs() + '）');
  const readerBack = d.querySelector('#lib-gw-reader #top-act');
  chk(!!readerBack, '阅读器那条顶栏上有返回键');

  click(readerBack);
  await sleep(200);
  chk(readerHidden(), '按返回，阅读器那一层收起来');
  chk(!railHidden() && gridHidden(),
    '★ 落在**唐诗索引**这一层（不是一路退到集子目录）—— 这是 Issue #122 报的那一步');
  chk(pageName() === '唐诗三百首', '页名仍是「唐诗三百首」（实际 ' + pageName() + '）');
  chk(d.querySelectorAll('#lib-gw-list .item').length === 317, '索引仍是完整 317 首');
  chk(topActs() === 1, '退回索引层后仍只有一枚可见的返回键（实际 ' + topActs() + '）');

  const back2 = actionBtn();
  chk(!!back2, '索引层有返回键');
  click(back2);
  await sleep(200);
  chk(railHidden() && !gridHidden(), '★ 再按返回，回到七张卡的集子目录');
  chk(pageName() === '课外阅读', '页名还原成「课外阅读」（实际 ' + pageName() + '）');
  chk(subText() === '课本之外的经典',
    '副标题还原成入口页那一句（实际 ' + subText() + '）');
  chk(d.querySelectorAll('.library-card').length === 7, '七张卡片仍在（退回来时没有把目录清掉）');
  chk(topActs() === 0, '目录这一层不再有返回键（恢复各页默认的「回首页」；实际 ' + topActs() + '）');

  const gs = d.querySelector('[data-lib-part="search"]');
  const gseg = d.querySelector('[data-lib-part="filter-seg"] button[data-filter="unread"]');
  chk(!!gs && !!gseg, '索引层有搜索框与「全部 / 未读」筛选');

  click(d.querySelector('.library-card[data-book="songci"]'));
  await sleep(350);
  chk(pageName() === '宋词三百首', '换成宋词，页名跟着换（实际 ' + pageName() + '）');
  chk(d.querySelectorAll('#lib-gw-list .item').length > 0 &&
    d.querySelectorAll('#lib-gw-list .item').length !== 317,
    '列表换成了宋词的篇目（不再是唐诗的 317 条；实际 ' +
    d.querySelectorAll('#lib-gw-list .item').length + '）');
  chk(d.querySelector('.app > .topbar .count-badge') === null,
    '换一部之后页顶照样没有读数（读数只有详情页那一处）');
  chk(d.querySelector('[data-lib-part="search"]').value === '',
    '换到另一部时搜索框是空的（上一部敲过的字不带过来）');

  click(d.querySelector('.app > .topbar #top-act'));
  await sleep(200);
  click(d.querySelector('.library-card[data-book="tangshi"]'));
  await sleep(350);
  chk(d.querySelectorAll('#lib-gw-list .item').length === 317,
    '换回唐诗仍是完整 317 首（同一块挂载点上重新挂，不复用上一部的实例）');

  click(d.querySelector('.app > .topbar #top-act'));
  await sleep(200);
  const poemsCard = d.querySelector('.library-card[data-book="poems"]');
  chk(poemsCard.tagName === 'A' && poemsCard.getAttribute('href') === '/poems/',
    '课内诗词那张仍是链接、仍指 /poems/（它有自己的索引页，不必在这一页里铺）');

  for (const [f, url, n, name] of [
    ['tangshi/index.html', '/tangshi/', 317, '唐诗三百首'],
    ['songci/index.html', '/songci/', 285, '宋词三百首'],
    ['guwen/index.html', '/guwen/', null, '古文观止'],
    ['zhaoming/index.html', '/zhaoming/', null, '昭明文选'],
    ['yuanqu/index.html', '/yuanqu/', 30, '元曲三百首'],
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
