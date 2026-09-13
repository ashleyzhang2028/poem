// 全站搜索页（/search/）+ 课外阅读入口页（/library/）+ 底栏导航变更
// 端到端测试：五部合一的索引 + 输入即出候选 + 集子筛选 + 阅读器 + 不写已读
//
// 这是 Issue #69 的收尾 PR。要验的三件事：
//   1. 搜索页确实**搜遍五部**（不是只搜某一部），且候选 / 结果两处口径一致；
//   2. 搜索页**不碰任何一部的已读**（点开一篇、点「标记已读」都不该写 localStorage）；
//   3. 页签由三格改成四格、名字也改对了，四部集子从入口页进得去。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const vm = require('vm');
const path = __dirname + '/../';
const read = f => fs.readFileSync(path + f, 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

/**
 * 起一个页面：把 <script src> 逐个 eval 进 jsdom。
 *
 * ⚠️ 必须等 jsdom 把文档解析完（readyState 不再是 'loading'）再插脚本。
 * 解析中插入的 script 会挂到**临时的** body 上，等真正的 <body> 解析出来
 * 就被整个丢掉 —— 现象是「脚本明明跑了、window 上也确实有值，
 * 但页面里的列表是空的」，最难查的那种半死不活。
 * 其余几层测的页面脚本少、DOMContentLoaded 恰好赶在前面，
 * 所以没暴露这个问题；搜索页要加载的脚本最多，顺序就翻了。
 */
function boot(file, url) {
  const html = read(file);
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://local.test' + url,
    base: 'https://local.test' + url
  });
  const w = dom.window;
  w.scrollTo = function () {};
  const scripts = html.match(/<script src="([^"]+)"><\/script>/g)
    .map(s => s.match(/src="([^"]+)"/)[1]);
  const ready = new Promise(resolve => {
    if (w.document.readyState !== 'loading') return resolve();
    w.document.addEventListener('DOMContentLoaded', () => resolve());
  });
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
  /* ---------- 一、数据层：总索引确实是五部合起来的一张表 ---------- */
  const sandbox = { window: {}, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  ['data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js',
   'data/poems-5.js', 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js',
   'data/poems-9.js', 'data/poems-10.js', 'data/poems-11.js', 'data/poems-12.js',
   'data/index.js', 'data/poems-classic.js', 'data/poems-tangshi.js',
   'data/poems-songci.js', 'data/poems-guwen.js', 'data/site-index.js'
  ].forEach(f => vm.runInContext(read(f), sandbox, { filename: f }));

  const IDX = sandbox.SITE_INDEX;
  const books = [sandbox.POEMS_CLASSIC, sandbox.POEMS_TANGSHI, sandbox.POEMS_SONGCI, sandbox.POEMS_GUWEN];
  const BOOK_IDS = ['classic', 'tangshi', 'songci', 'guwen'];

  chk(IDX.length === sandbox.POEMS_ALL.length + books.reduce((n, b) => n + b.length, 0) + 5,
    '总索引 = 课内诗词 + 四部集子 + 5 条集子条目（实际 ' + IDX.length + '）');
  BOOK_IDS.forEach(id => {
    chk(IDX.some(x => x.book === id && !x.isBook),
      '总索引含「' + id + '」这一部的篇目');
  });
  chk(IDX.filter(x => x.isBook).length === 5,
    '集子自身也各有一条（搜「唐诗三百首」能直接进那一页）');
  // id 全站唯一：五部各自从 1 排起，必然撞——所以每条都带集子前缀
  const ids = new Set();
  let dup = 0;
  IDX.forEach(x => { if (ids.has(x.id)) dup++; ids.add(x.id); });
  chk(dup === 0, '全站 id 无重复（重复 ' + dup + ' 个）');
  chk(BOOK_IDS.every(id => IDX.filter(x => x.book === id && !x.isBook)
    .every(x => x.id.indexOf(id + '-') === 0)),
    '每条结果的 id 都带自己那一部的前缀（五部原 id 会撞，前缀才分得开）');
  chk(IDX.every(x => x.book && x.bookName && x.page),
    '每条结果都带「出自哪一部」与「该去哪一页」');

  /* ---------- 二、入口页：四部集子都进得去，篇数实时算 ---------- */
  const wLib = boot('library/index.html', '/library/');
  await wLib.__ready;
  await sleep(200);
  const ld = wLib.document;
  const cards = [...ld.querySelectorAll('.library-card')];
  chk(cards.length === 4, '入口页列出四部集子（实际 ' + cards.length + '）');
  chk(cards.map(c => c.getAttribute('data-book')).join('/') === 'classic/tangshi/songci/guwen',
    '四部的顺序与出处正确');
  chk(cards.map(c => c.getAttribute('href')).join(' ') === '/classic/ /tangshi/ /songci/ /guwen/',
    '四张卡各指到自己的索引页（实际 ' + cards.map(c => c.getAttribute('href')).join(' ') + '）');
  // 篇数与总索引一致（不写死数字：日后增补篇目，卡片跟着变）
  BOOK_IDS.forEach((id, i) => {
    const n = IDX.filter(x => x.book === id && !x.isBook).length;
    chk(cards[i].querySelector('.library-card-count').textContent === n + ' ' + (id === 'classic' || id === 'guwen' ? '篇' : '首'),
      cards[i].querySelector('.library-card-name').textContent + ' 篇数与索引一致（' + n + '）');
  });
  chk(/课外必背小古文/.test(ld.body.textContent) && /唐诗三百首/.test(ld.body.textContent) &&
    /宋词三百首/.test(ld.body.textContent) && /古文观止/.test(ld.body.textContent),
    '四部的**全名**都写在这一页上（页签装不下书名，这里要写全）');
  chk(!/\[object|undefined/.test(ld.querySelector('#library-grid').textContent),
    '卡片文案没有渲染异常（无 undefined / [object]）');

  // 需求（Issue #69 后续）：入口页的说明改走顶栏第二行，正文里那段重复文字删掉。
  // 断两层：
  //   1) body 上给出了 data-sub（顶栏第二行由 js/chrome.js 按它渲染）；
  //   2) 那张挂在顶栏外的说明段落（.library-hint）在页面里已经不存在。
  const libSrc = read('library/index.html');
  chk(/data-sub="课本之外的经典，按部就班读下去"/.test(libSrc),
    '入口页的说明写在 body 的 data-sub 上（顶栏第二行）');
  chk(!/library-hint/.test(libSrc),
    '正文里那段与顶栏重复的说明已删（不再渲染 .library-hint）');
  // 只认**可见正文**里那句：<meta name="description"> 里仍保留同义的文案
  // （那是给搜索引擎与分享卡片读的一句话，不属于页面正文，用户没要求删）。
  const libBody = libSrc.slice(libSrc.indexOf('<body'));
  chk(!/每篇都有原文、生字注音、语音朗读与白话译文/.test(libBody),
    '被点名删除的那整句已不在页面正文里（meta description 保留）');
  const libCss = fs.readFileSync(path + 'css/classic.css', 'utf8');
  chk(!/^\s*\.library-hint\s*\{/m.test(libCss),
    '样式表里不再留 .library-hint 的死规则（元素删了，规则也一起删）');

  /* ---------- 三、搜索页：搜遍五部 ---------- */
  const w = boot('search/index.html', '/search/');
  await w.__ready;
  await sleep(250);
  const d = w.document;
  const api = w.ReaderEngine.current;
  chk(!!api, '搜索页挂上了引擎实例');
  chk(api.total() === IDX.filter(x => !x.isBook).length,
    '实例 total() 为全部篇目（' + api.total() + '，不含集子条目）');
  chk(d.querySelector('#gw-count').textContent === '0 / ' + api.total() + ' 篇',
    '顶部显示 0 / ' + api.total() + ' 篇（实际 ' + d.querySelector('#gw-count').textContent + '）');

  // 重复 id 防线（新增两页，一并纳入）
  ['search/index.html', 'library/index.html'].forEach(f => {
    const doc = new JSDOM(read(f)).window.document;
    const seen = {};
    const dups = [];
    doc.querySelectorAll('[id]').forEach(el => {
      if (seen[el.id]) { if (dups.indexOf(el.id) < 0) dups.push(el.id); } else seen[el.id] = 1;
    });
    chk(dups.length === 0, f + ' 无重复 id（重复：' + dups.join(', ') + '）');
  });

  const input = d.querySelector('#gw-search');
  const type = v => {
    input.value = v;
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
  };

  // 集子筛选药丸
  const segBtns = [...d.querySelectorAll('#search-book-seg button')];
  // 五部（课内诗词 + 课外四部）各一颗，再加「全部」＝ 6 颗
  chk(segBtns.length === 6, '集子筛选有「全部 + 五部」六颗药丸（实际 ' + segBtns.length + '）');
  chk(segBtns[0].dataset.book === 'all' && segBtns[0].classList.contains('active'),
    '「全部」是默认选中态');
  BOOK_IDS.forEach(id => {
    const n = IDX.filter(x => x.book === id && !x.isBook).length;
    const btn = segBtns.filter(b => b.dataset.book === id)[0];
    chk(btn && btn.querySelector('.book-count').textContent === String(n),
      id + ' 药丸上的篇数实时算出（' + n + '）');
  });

  // 搜作者：五部都要能搜到（不是只搜某一部）
  type('王维');
  await sleep(30);
  const wangwei = [...d.querySelectorAll('#gw-list .item')];
  chk(wangwei.length > 0, '搜「王维」有结果（' + wangwei.length + ' 条）');
  const wwBooks = new Set(wangwei.map(el => {
    const p = IDX.filter(x => x.id === el.dataset.id)[0];
    return p && p.book;
  }));
  chk(wwBooks.has('poems') && wwBooks.has('tangshi'),
    '搜「王维」能同时搜到课内与课外（命中 ' + [...wwBooks].join('/') + '）');

  // 搜正文 / 译文（只有正文命中才说明「搜遍全站」是真的）
  type('先天下之忧而忧');
  await sleep(30);
  const byBody = [...d.querySelectorAll('#gw-list .item')];
  chk(byBody.length > 0, '按译文原句「先天下之忧而忧」也能搜到（' + byBody.length + ' 条）');
  chk(byBody.some(el => el.dataset.id === 'guwen-gwj-114'),
    '搜到的是《岳阳楼记》（guwen-gwj-114）');

  // 候选下拉
  type('月');
  await sleep(30);
  const box = d.querySelector('#search-suggest');
  chk(box.hidden === false, '输入后候选下拉出现');
  const items = [...box.querySelectorAll('.suggest-item')];
  chk(items.length > 0 && items.length <= 8, '候选条数在 8 条以内（实际 ' + items.length + '）');
  chk(input.getAttribute('aria-expanded') === 'true', '输入框 aria-expanded 同步为 true');
  chk(items.every(el => el.querySelector('.suggest-title') && el.querySelector('.suggest-meta')),
    '每条候选都有篇名与「朝代 · 作者 · 集子」');
  // 候选与结果**同一套匹配**：候选里每一条都必须能在结果列表里找到
  const resultIds = new Set([...d.querySelectorAll('#gw-list .item')].map(el => el.dataset.id));
  chk(items.every(el => {
    const id = JSON.parse(box.dataset.items)[Number(el.dataset.suggest)];
    return resultIds.has(id);
  }), '候选里的每一条都在结果列表里（两处口径一致，不会出现「候选有、结果没有」）');

  // 键盘：下键高亮、回车进阅读器
  input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await sleep(20);
  chk(box.querySelectorAll('.suggest-item.active').length === 1, '下键高亮第一条候选');
  chk(box.querySelector('.suggest-item.active').getAttribute('aria-selected') === 'true',
    '高亮项 aria-selected 为 true');
  input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(40);
  chk(d.querySelector('#gw-reader').hidden === false, '回车直接打开阅读器（不必再点一次）');
  chk(box.hidden === true, '选中候选后下拉收起');
  const openedTitle = d.querySelector('#rd-title').textContent;
  chk(openedTitle.length > 0, '阅读器里是选中的那一篇：' + openedTitle);

  // 阅读器里读得出来（正文 + 译文都写进去了）
  const plain = d.querySelector('#rd-text').textContent
    .replace(/[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹ·]+/g, '').replace(/\s/g, '');
  chk(plain.length > 4, '正文写入阅读器（' + plain.length + ' 字）');
  chk(d.querySelector('#rd-trans-text').textContent.length > 10, '译文写入阅读器');

  /* ---------- 四、搜索页不碰任何一部的已读 ---------- */
  chk(Object.keys(w.localStorage).filter(k => /read_v1/.test(k)).length === 0,
    '打开一篇之后，搜索页没有写任何一部的已读键（实际写了：' +
    Object.keys(w.localStorage).filter(k => /read_v1/.test(k)).join(',') + '）');
  const doneBtn = d.querySelector('#gw-done');
  chk(!!doneBtn && doneBtn.hidden === true,
    '「标记已读」在搜索页整颗藏起来（它是「查东西」的地方，不该改任何一部的进度）');
  // 隐藏了也不该在那儿偷偷写键：直接派一次点击
  doneBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
  chk(Object.keys(w.localStorage).filter(k => /read_v1/.test(k)).length === 0,
    '点了隐藏的「标记已读」也不写已读键（实际写入了：' +
    Object.keys(w.localStorage).filter(k => /read_v1/.test(k)).join(',') + '）');
  api.close();

  // 列表里也不出现「已读」小标
  chk(d.querySelectorAll('#gw-list .item-reason.read').length === 0,
    '搜索页列表里不出现「已读」小标');

  /* ---------- 五、集子筛选与未读筛选能叠加 ---------- */
  type('');
  await sleep(20);
  const totalAll = d.querySelectorAll('#gw-list .item').length;
  d.querySelector('#search-book-seg button[data-book="tangshi"]').dispatchEvent(
    new w.MouseEvent('click', { bubbles: true }));
  await sleep(30);
  const totalTs = d.querySelectorAll('#gw-list .item').length;
  chk(totalTs > 0 && totalTs < totalAll,
    '点「唐诗三百首」只看那一部（' + totalTs + ' / ' + totalAll + '）');
  chk([...d.querySelectorAll('#gw-list .item')].every(el => {
    const p = IDX.filter(x => x.id === el.dataset.id)[0];
    return p && p.book === 'tangshi';
  }), '筛选后列表里确实只有唐诗');
  chk(w.SiteSearch.filter() === 'tangshi', '筛选状态记在会话里（SiteSearch.filter()）');
  // 回到「全部」
  d.querySelector('#search-book-seg button[data-book="all"]').dispatchEvent(
    new w.MouseEvent('click', { bubbles: true }));
  await sleep(30);
  chk(d.querySelectorAll('#gw-list .item').length === totalAll, '切回「全部」恢复全部篇目');

  /* ---------- 六、底栏导航：三格改四格、名字改对 ---------- */
  const wHome = boot('index.html', '/');
  await wHome.__ready;
  await sleep(250);
  const dock = [...wHome.document.querySelectorAll('.dock-item')];
  chk(dock.length === 4, '底部页签为四格（实际 ' + dock.length + '）');
  chk(dock.map(b => b.querySelector('.dock-label').textContent).join('/') === '背诵/课外/搜索/设置',
    '页签名为 背诵 / 课外 / 搜索 / 设置（实际 ' +
    dock.map(b => b.querySelector('.dock-label').textContent).join(' / ') + '）');
  chk(dock.map(b => b.getAttribute('data-nav-go')).join('/') === 'home/library/search/settings',
    '四格的去向正确');
  chk(dock.every(b => b.querySelector('.dock-icon svg')), '四格图标都是内联 SVG');
  chk(dock.every(b => b.querySelectorAll(':scope > *').length === 2),
    '每格仍是 图标 + 文字 两个子元素，没有多加装饰');
  chk(dock.filter(b => b.getAttribute('data-nav-go') === 'classic').length === 0,
    '四部集子不再各自占一格（「小古文」旧页签已撤）');
  // 首页标题措辞：「XX的古诗词」→「XX的背诵」
  chk(/的背诵/.test(wHome.document.querySelector('#brand-page-text').textContent),
    '首页顶栏页面名改为「XX的背诵」（实际 ' +
    wHome.document.querySelector('#brand-page-text').textContent + '）');
  chk(!/的古诗词/.test(wHome.document.title), '标题里不再写「的古诗词」（实际 ' + wHome.document.title + '）');

  // 四部集子页：页签高亮落在「课外」这一格
  for (const [page, url] of [['classic/index.html', '/classic/'],
    ['tangshi/index.html', '/tangshi/'], ['songci/index.html', '/songci/'],
    ['guwen/index.html', '/guwen/']]) {
    const wp = boot(page, url);
    await wp.__ready;
    await sleep(150);
    const on = wp.document.querySelector('.dock-item.active');
    chk(!!on && on.getAttribute('data-nav-go') === 'library',
      page + ' 的页签高亮在「课外」这一格（实际 ' +
      (on ? on.getAttribute('data-nav-go') : '无') + '）');
  }

  /* ---------- 七、法务页与设置页的口径一致 ---------- */
  chk(read('js/chrome.js').indexOf('古诗词') === -1 ||
    !/label: "古诗词"/.test(read('js/chrome.js')),
    '页签里不再有名为「古诗词」的那一格');
  // 版本号只认「比 v41 新」——写死具体版本号的话，后续任何一次改动都要再来改这里
  const swVer = (read('sw.js').match(/poem-app-v(\d+)/) || [])[1];
  chk(!!swVer && Number(swVer) >= 41, 'sw.js 缓存版本不低于 v41（实际 v' + swVer + '）');
  ['"./search/"', '"./js/search.js"', '"./library/"', '"./js/library.js"'].forEach(needle => {
    chk(read('sw.js').indexOf(needle) >= 0, 'sw.js 预缓存含 ' + needle);
  });

  console.log('');
  console.log(fails === 0 ? '🎉 搜索页与导航变更测试全部通过' : '❌ 搜索页与导航变更测试 ' + fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
})();
