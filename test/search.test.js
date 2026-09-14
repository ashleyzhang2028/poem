// 全站搜索页（/search/）+ 课外阅读入口页（/library/）+ 底栏导航变更
// 端到端测试：六部合一的索引 + 输入才出结果 + 候选下拉 + 阅读器 + 不写已读
//
// 要验的四件事：
//   1. 搜索页确实**搜遍六部**（不是只搜某一部），且候选 / 结果两处口径一致；
//   2. 搜索页**输入之前一条都不列**，输入之后才列，且字数越多命中越少；
//   3. 搜索页**不碰任何一部的已读**（点开一篇、点「标记已读」都不该写 localStorage）；
//   4. 页签由三格改成四格、名字也改对了，五部集子从入口页进得去。
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
  /* ---------- 一、数据层：总索引确实是六部合起来的一张表 ---------- */
  const sandbox = { window: {}, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  ['data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js',
   'data/poems-5.js', 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js',
   'data/poems-9.js', 'data/poems-10.js', 'data/poems-11.js', 'data/poems-12.js',
   'data/index.js', 'data/poems-classic.js', 'data/poems-tangshi.js',
   'data/poems-songci.js', 'data/poems-guwen.js', 'data/poems-zhaoming.js',
   'data/site-index.js', 'data/works-map.js', 'data/works-index.js'
  ].forEach(f => vm.runInContext(read(f), sandbox, { filename: f }));

  const IDX = sandbox.SITE_INDEX;
  const books = [sandbox.POEMS_CLASSIC, sandbox.POEMS_TANGSHI, sandbox.POEMS_SONGCI,
    sandbox.POEMS_GUWEN, sandbox.POEMS_ZHAOMING];
  const BOOK_IDS = ['classic', 'tangshi', 'songci', 'guwen', 'zhaoming'];
  // 昭明文选只把**有译文的**那些收进索引（目前 78 篇），其余标「待补」的按约定不进
  // （见 data/site-index.js）；所以它按 zhaomingDoneCount() 算，不是全量 480
  const zmIndexed = books[4].filter(p => p.text && p.translation).length;

  chk(IDX.length === sandbox.POEMS_ALL.length +
      books.slice(0, 4).reduce((n, b) => n + b.length, 0) + zmIndexed + 6,
    '总索引 = 课内诗词 + 四部全集子 + 昭明文选已译 ' + zmIndexed + ' 篇 + 6 条集子条目（实际 ' + IDX.length + '）');
  BOOK_IDS.forEach(id => {
    chk(IDX.some(x => x.book === id && !x.isBook),
      '总索引含「' + id + '」这一部的篇目');
  });
  chk(IDX.filter(x => x.isBook).length === 6,
    '集子自身也各有一条（搜「唐诗三百首」能直接进那一页）');
  // id 全站唯一：六部各自从 1 排起，必然撞——所以每条都带集子前缀
  const ids = new Set();
  let dup = 0;
  IDX.forEach(x => { if (ids.has(x.id)) dup++; ids.add(x.id); });
  chk(dup === 0, '全站 id 无重复（重复 ' + dup + ' 个）');
  chk(BOOK_IDS.every(id => IDX.filter(x => x.book === id && !x.isBook)
    .every(x => x.id.indexOf(id + '-') === 0)),
    '每条结果的 id 都带自己那一部的前缀（六部原 id 会撞，前缀才分得开）');
  chk(IDX.every(x => x.book && x.bookName && x.page),
    '每条结果都带「出自哪一部」与「该去哪一页」');

  /* ---------- 二、入口页：五部集子都进得去，篇数实时算 ---------- */
  const wLib = boot('library/index.html', '/library/');
  await wLib.__ready;
  await sleep(200);
  const ld = wLib.document;
  const cards = [...ld.querySelectorAll('.library-card')];
  chk(cards.length === 5, '入口页列出五部集子（实际 ' + cards.length + '）');
  chk(cards.map(c => c.getAttribute('data-book')).join('/') === 'classic/tangshi/songci/guwen/zhaoming',
    '五部的顺序与出处正确');
  chk(cards.map(c => c.getAttribute('href')).join(' ') === '/classic/ /tangshi/ /songci/ /guwen/ /zhaoming/',
    '五张卡各指到自己的索引页（实际 ' + cards.map(c => c.getAttribute('href')).join(' ') + '）');
  // 篇数与总索引一致（不写死数字：日后增补篇目，卡片跟着变）
  // ⚠️ 卡片上那个数字数的是各集子**自己的数据**，不是搜索索引 ——
  // 索引按约定不收「待补」条目（昭明文选目前 78 篇有译文），拿索引来数
  // 会显示「昭明文选 29 篇」而点进去有 480 篇。见 js/library.js 的 countOf()。
  const CARD_VARS = { classic: 'POEMS_CLASSIC', tangshi: 'POEMS_TANGSHI',
    songci: 'POEMS_SONGCI', guwen: 'POEMS_GUWEN', zhaoming: 'POEMS_ZHAOMING' };
  BOOK_IDS.forEach((id, i) => {
    const n = sandbox[CARD_VARS[id]].length;
    chk(cards[i].querySelector('.library-card-count').textContent ===
      n + ' ' + (id === 'classic' || id === 'guwen' || id === 'zhaoming' ? '篇' : '首'),
      cards[i].querySelector('.library-card-name').textContent + ' 篇数与数据一致（' + n + '）');
  });
  chk(/课外必背小古文/.test(ld.body.textContent) && /唐诗三百首/.test(ld.body.textContent) &&
    /宋词三百首/.test(ld.body.textContent) && /古文观止/.test(ld.body.textContent) &&
    /昭明文选/.test(ld.body.textContent),
    '五部的**全名**都写在这一页上（页签装不下书名，这里要写全）');
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

  /* ---------- 三、搜索页：搜遍六部 ---------- */
  const w = boot('search/index.html', '/search/');
  await w.__ready;
  await sleep(250);
  const d = w.document;
  const api = w.ReaderEngine.current;
  chk(!!api, '搜索页挂上了引擎实例');
  // 输入之前列表里**一条都没有**（用户要求：默认不铺全部列表，加载也更快）。
  // 所以实例的 total() 此刻是 0 —— 它是「当前这份集合的条数」，
  // 关键词一进来就会被 setItems 换成全量（下面 type('王维') 之后再验）。
  // 搜索页按**作品**去重（同一篇只列一条，见 js/search.js 的 allItems）：
  // 课内《静夜思》与唐诗《夜思》是同一篇，结果里不该出现两条。
  // 所以这里算的「全站篇数」也是去重后的 —— 与页面上进度牌报的数字同口径。
  const seenWid = new Set();
  const ALL = IDX.filter(x => !x.isBook).filter(x => {
    const wid = sandbox.WorksIndex.widOf(x.id);
    if (seenWid.has(wid)) return false;
    seenWid.add(wid);
    return true;
  }).length;
  chk(api.total() === 0, '没输入关键词时实例里没有篇目（实际 ' + api.total() + '）');
  chk(d.querySelectorAll('#gw-list .item').length === 0, '没输入关键词时列表里一条都不列');
  chk(d.querySelector('#gw-list .textContent') === null &&
    /输入篇名、作者或诗句/.test(d.querySelector('#gw-list').textContent),
    '空列表给的是「敲几个字就能搜」，不是「没有找到匹配的篇目」');
  chk(d.querySelector('#gw-count').textContent === '0 / 0 篇',
    '顶部进度牌跟着是 0 / 0 篇（实际 ' + d.querySelector('#gw-count').textContent + '）');
  chk(!d.querySelector('#gw-filter-seg'), '搜索框右侧的「全部 / 未读」整栏已删除');
  chk(!d.querySelector('#search-book-seg'), '集子筛选药丸整栏已删除（默认就是全部）');

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

  // 搜作者：六部都要能搜到（不是只搜某一部）
  type('王维');
  await sleep(30);
  chk(api.total() === ALL, '一输入关键词，实例里就换上全站篇目（' + api.total() + '）');
  chk(d.querySelector('#gw-count').textContent === '0 / ' + ALL + ' 篇',
    '顶部进度牌这时报的是全站篇数（实际 ' + d.querySelector('#gw-count').textContent + '）');
  // 去重：同一篇作品只列一条（《静夜思》课内 + 唐诗《夜思》正文一致）
  type('静夜思');
  await sleep(30);
  const jys = [...d.querySelectorAll('#gw-list .item')];
  chk(jys.length === 1, '搜「静夜思」只出一条（同一篇作品不重复列，实际 ' + jys.length + '）');
  chk(jys.length === 1 && /^poems-/.test(jys[0].dataset.id),
    '去重后留下的是课内那一条（教材是主线，带年级学期）');
  type('王维');
  await sleep(30);
  // 说明文字整段已撤（#76 删掉元素、这一版删掉显隐逻辑）：
  // 页面上不该再出现那一行，敲字前后都不该有
  chk(d.querySelector('#search-hint') === null, '那段说明文字在页面上已不存在');
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

  // ⚠️ 事件绑定不能被「这一刻集合是不是空的」挡住。
  //    搜索页 mount 时 items 是空的，早先 init() 一见空集合就 return，
  //    绑定整段被跳过 —— 现象是搜索框打不进字、翻篇键与工具条一概没反应，
  //    页面「看起来加载完了但全是死的」。这里在真事件里逐颗验一遍。
  const nextTitleBefore = d.querySelector('#rd-title').textContent;
  d.querySelector('#rd-next').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(30);
  chk(d.querySelector('#rd-title').textContent !== nextTitleBefore,
    '阅读器「下一篇」点得动（它翻成了「' + d.querySelector('#rd-title').textContent + '」）');
  const fontBefore = d.querySelector('#rd-text').style.fontSize;
  d.querySelector('#rd-font-up').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(20);
  chk(d.querySelector('#rd-text').style.fontSize !== fontBefore,
    '阅读器「A＋」点得动（字号真的变了）');
  d.querySelector('#rd-trans-toggle').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(20);
  chk(d.querySelector('#rd-trans').hidden === false, '阅读器「译文开关」点得动（译文框出来了）');

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

  /* ---------- 五、字越多、命中越少；清空输入回到空列表 ---------- */
  // 这是用户这一轮的核心诉求：「用户填入文字后，下面再列出匹配的古诗词列表，
  // 文字越多，匹配内容越少」。逐字加长，命中数必须单调不增。
  const counts = [];
  for (const kw of ['月', '明月', '明月几时有']) {
    type(kw);
    await sleep(30);
    counts.push(d.querySelectorAll('#gw-list .item').length);
  }
  chk(counts[0] > counts[1] && counts[1] > counts[2],
    '「月 → 明月 → 明月几时有」命中数逐级减少（' + counts.join(' → ') + '）');
  chk(counts[2] > 0, '最长的那一次仍然搜得到（' + counts[2] + ' 条）');

  // 清空输入：列表收干净，且不再有任何条目留在 DOM 里
  type('');
  await sleep(30);
  chk(d.querySelectorAll('#gw-list .item').length === 0, '清空输入后列表里一条都不留');
  chk(/输入篇名、作者或诗句/.test(d.querySelector('#gw-list').textContent),
    '空列表又回到「敲几个字就能搜」的引导语');
  chk(w.SiteSearch.keyword() === '', 'SiteSearch.keyword() 为空（没有残留关键词）');

  // 一次只敲一个字的「重活」：全站命中不会把列表撑到上千条后再也不收
  type('的');
  await sleep(30);
  const heavy = d.querySelectorAll('#gw-list .item').length;
  type('');
  await sleep(30);
  chk(heavy > 0 && d.querySelectorAll('#gw-list .item').length === 0,
    '大命中量（' + heavy + ' 条）之后清空，列表同样能收干净');

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
    '五部集子不再各自占一格（「小古文」旧页签已撤）');
  // 首页标题措辞：「XX的古诗词」→「XX的背诵」
  chk(/的背诵/.test(wHome.document.querySelector('#brand-page-text').textContent),
    '首页顶栏页面名改为「XX的背诵」（实际 ' +
    wHome.document.querySelector('#brand-page-text').textContent + '）');
  chk(!/的古诗词/.test(wHome.document.title), '标题里不再写「的古诗词」（实际 ' + wHome.document.title + '）');

  // 五部集子页：页签高亮落在「课外」这一格
  for (const [page, url] of [['classic/index.html', '/classic/'],
    ['tangshi/index.html', '/tangshi/'], ['songci/index.html', '/songci/'],
    ['guwen/index.html', '/guwen/'], ['zhaoming/index.html', '/zhaoming/']]) {
    const wp = boot(page, url);
    await wp.__ready;
    await sleep(150);
    const on = wp.document.querySelector('.dock-item.active');
    chk(!!on && on.getAttribute('data-nav-go') === 'library',
      page + ' 的页签高亮在「课外」这一格（实际 ' +
      (on ? on.getAttribute('data-nav-go') : '无') + '）');
  }

  /* ---------- 七、搜索页的结构与样式（源码级防线） ---------- */
  const searchHtml = read('search/index.html');
  const classicCss = read('css/classic.css');
  // 搜索框整块居中：HTML 里只有它一个（.search-hero），CSS 走 flex 居中 +
  // 视口高度减去顶栏与底栏 —— 「垂直 + 水平居中」是这条规则的唯一来源
  chk(/class="search-hero"/.test(searchHtml),
    '搜索框包在一块 .search-hero 里（居中的载体）');
  chk(!/filter-seg|data-filter|search-book-seg|book-seg/.test(searchHtml),
    '搜索框右栏（全部 / 未读）与集子药丸都不在这份 HTML 里了');
  chk(!/data-book=/.test(searchHtml), '页面里没有任何集子筛选按钮');
  // 居中：竖向由「视口 − 顶栏 − 底栏」这一段高度 + 搜索框压在中线负责
  // （.search-hero 的 height 算式 + .search-toolbar 的 top: 50%），
  // 横向由整行的 left: 50% + translateX(-50%) 负责。
  // 2026 这一版把 hero 的 min-height 换成了 height：搜索框（绝对定位）
  // 不产生内容高度，hero 必须自己拿着那段高度，才谈得上「居中」。
  const heroBlock = /(?:^|\n)\.search-hero \{([\s\S]*?)\}/.exec(classicCss);
  const heroMid = /--hero-box-h:\s*40px/.test(classicCss);
  const heroCenter = /justify-content:\s*center/.test(classicCss) &&
    /top:\s*50%/.test(classicCss) &&
    /margin-top:\s*calc\(var\(--hero-box-h\) \/ -2\)/.test(classicCss);
  chk(heroMid && heroCenter,
    'hero 在水平与垂直两个方向都居中（整行 top: 50% 减去半个盒高）');
  chk(!!heroBlock && /height:/.test(heroBlock[1]) && /--nav-h/.test(heroBlock[1]),
    'hero 的垂直空间按视口减去顶栏与实测底栏算（不是写死一个高度）');
  chk(!/\.book-seg/.test(classicCss), '集子药丸的样式整块删除（CSS 里不再留死代码）');
  // 空关键词就是「没有结果」：引擎侧靠 setItems([]) 表达，
  // 所以配置里必须允许空集合（否则 mount 直接返回 null，整页挂不上）
  chk(/allowEmpty:\s*true/.test(read('js/search.js')),
    '搜索页声明 allowEmpty（空关键词时确实要挂一块空列表）');
  chk(/allowEmpty/.test(read('js/reader-core.js')),
    'reader-core 支持 allowEmpty（空集合默认仍不挂）');

  /* ---------- 七之二、机上的可用性（Issue #69） ----------
     用户在机上反馈三件事：键盘一弹候选下拉就被盖住、候选离搜索框太远、
     这一页的搜索框该再高一点。三条改动都落在这一页的 HTML / CSS / JS 里，
     真正的验证在 test/pwa.test.js（真浏览器量渲染后的盒子），
     这里守的是源码级的几道防线 —— 改动不依赖某个数字，而是依赖一组关系。 */
  const heroFocus = doc => doc;
  // ① 搜索框增高：只对搜索页生效，且不能长在 hero 的布局高度上
  chk(/\.search-hero \.search-input\s*\{[^}]*transform:\s*scaleY\(1\.3\)/.test(classicCss),
    '搜索页搜索框在绘制层放大到 52px（布局仍是 40px，「居中算式」才不会被带偏）');
  chk(!/(?:^|\n)\.search-input\s*\{[^}]*height:\s*5[0-9]px/.test(classicCss),
    '增高只走 transform：没有把 .search-input 的 height 改成 52px（那会连带改掉索引页）');
  // ② 候选下拉贴住搜索框 / 不透明度 / 层级
  chk(/\.suggest \{[^}]*top:\s*calc\(100% \+ 5px\)/.test(classicCss),
    '候选下拉只留 5px 间隙（用户反馈的「离搜索框太远」的反面）');
  chk(/\.suggest \{[^}]*background:\s*#fffefa/.test(classicCss),
    '候选下拉用不透明底色（--card 只有 90% 不透明，浮层会让结果列表透上来）');
  chk(/--kb-space/.test(classicCss) && /max-height:\s*min\(/.test(classicCss),
    '候选下拉的高度按「可视区 − 键盘」算（键盘弹着也不会伸到键盘底下）');
  chk(/\.search-hero \.search-toolbar \{[^}]*z-index:\s*1/.test(classicCss),
    '搜索整行有自己的层级（.search-wrap 的 transform 新建了层叠上下文，' +
    '整行不进正层级的话，结果列表会从下拉上面压过去）');
  // ③ 屏上键盘：贴顶的两个状态都由 JS 加类、CSS 表现
  chk(/kb-open/.test(classicCss) && /search-focus/.test(classicCss),
    '键盘弹出 / 输入框聚焦两个状态都有对应的样式（整块贴到顶栏下方）');
  const searchJs = read('js/search.js');
  chk(/visualViewport/.test(searchJs) && /--kb-space/.test(searchJs),
    'js/search.js 用 visualViewport 实测键盘高度（软键盘不改 innerHeight，它是唯一入口）');
  chk(/focusInput/.test(searchJs) && /search-hero-focus/.test(searchHtml),
    '进页即聚焦：焦点先落在 hero 里的替身输入框上（键盘应声弹出，且不触发 iOS 自行滚动）');
  const ghostBlock = (/[^}]*\.search-hero-focus \{([^}]*)\}/.exec(classicCss) || ['', ''])[1];
  chk(!!ghostBlock && /width:\s*1px/.test(ghostBlock) && /height:\s*1px/.test(ghostBlock) &&
    !/display:\s*none|visibility:\s*hidden|opacity:\s*0/.test(ghostBlock),
    '替身输入框是一枚真的 1×1 输入框（display: none / visibility: hidden 的元素' +
    '拿不到焦点，iOS 就不会弹键盘）');
  chk(/alignEmptyState/.test(searchJs) && /#gw-list \.search-empty/.test(classicCss),
    '空态与结果列表左对齐（搜索框在左、列表也在左，空态不该孤零零居中在页面中间）');

  /* ---------- 八、法务页与设置页的口径一致 ---------- */
  chk(read('js/chrome.js').indexOf('古诗词') === -1 ||
    !/label: "古诗词"/.test(read('js/chrome.js')),
    '页签里不再有名为「古诗词」的那一格');
  chk(/class="search-hero"/.test(searchHtml) ===
    /(?:^|\n)\.search-hero \{/.test(classicCss),
    'CSS 与 HTML 的 .search-hero 口径一致（HTML 里有它，样式里也有它）');
  // 搜索页的说明文字已撤（main 上的 #76 删掉了它，这一版又撤掉了只服务它的
  // 显隐逻辑）：源码里不该再有 #search-hint / .search-hint 的死引用
  chk(!/search-hint/.test(searchHtml) && !/search-hint/.test(read('js/search.js')),
    '「一次搜遍……也搜正文与译文里的字句」那段说明与其显隐逻辑都已删除');
  // 版本号只验下界：搜索页改版与「出处」修正都把缓存抬到 v42，
  // 若写死具体版本，下次任何一次改动 css/js 都会把这条测试判红。
  // 真正要守的是「改了 css/js 就得抬版本」，所以只比 v41 的下界。
  const swVer = (/poem-app-v(\d+)/.exec(read('sw.js')) || [])[1];
  chk(Number(swVer) >= 41, 'sw.js 缓存版本不低于 v41（实际 v' + swVer + '）');
  ['"./search/"', '"./js/search.js"', '"./library/"', '"./js/library.js"'].forEach(needle => {
    chk(read('sw.js').indexOf(needle) >= 0, 'sw.js 预缓存含 ' + needle);
  });

  console.log('');
  console.log(fails === 0 ? '🎉 搜索页与导航变更测试全部通过' : '❌ 搜索页与导航变更测试 ' + fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
})();
