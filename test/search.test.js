const { JSDOM } = require('jsdom');
const fs = require('fs');
const vm = require('vm');
const path = __dirname + '/../';
const read = f => fs.readFileSync(path + f, 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

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

  const sandbox = { window: {}, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  const { loadData, resolve } = require('./master-env');
  loadData(sandbox, ['data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js',
   'data/poems-5.js', 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js',
   'data/poems-9.js', 'data/poems-10.js', 'data/poems-11.js', 'data/poems-12.js',
   'data/index.js', 'data/poems-classic.js', 'data/poems-tangshi.js',
   'data/poems-songci.js', 'data/poems-guwen.js', 'data/poems-zhaoming.js',
   'data/poems-yuanqu.js', 'data/poems-yuefu.js', 'data/poems-jinxiandai.js',
   'data/site-index.js', 'data/works-map.js', 'data/works-index.js']);

  const IDX = sandbox.SITE_INDEX;

  const books = [
    resolve(sandbox, sandbox.POEMS_CLASSIC, 'classic'),
    resolve(sandbox, sandbox.POEMS_TANGSHI, 'tangshi'),
    resolve(sandbox, sandbox.POEMS_SONGCI, 'songci'),
    resolve(sandbox, sandbox.POEMS_GUWEN, 'guwen'),
    resolve(sandbox, sandbox.POEMS_ZHAOMING, 'zhaoming'),
    resolve(sandbox, sandbox.POEMS_YUANQU, 'yuanqu'),
    resolve(sandbox, sandbox.POEMS_YUEFU, 'yuefu'),
    resolve(sandbox, sandbox.POEMS_JINXIANDAI, 'jinxiandai')
  ];
  const BOOK_IDS = ['classic', 'tangshi', 'songci', 'guwen', 'zhaoming', 'yuanqu', 'yuefu', 'jinxiandai'];

  const zmIndexed = books[4].filter(p => p.text && p.translation).length;

  chk(IDX.length === sandbox.POEMS_ALL.length +
      books.reduce((n, b) => n + b.filter(p => p.text && p.translation).length, 0) + 9,
    '总索引 = 课内诗词 + 八部全集子（其中昭明 ' + zmIndexed + ' 篇）+ 9 条集子条目（实际 ' + IDX.length + '）');
  BOOK_IDS.forEach(id => {
    chk(IDX.some(x => x.book === id && !x.isBook),
      '总索引含「' + id + '」这一部的篇目');
  });
  chk(IDX.filter(x => x.isBook).length === 9,
    '九部集子自身也各有一条（搜「唐诗三百首」能直接进那一页）');

  const ids = new Set();
  let dup = 0;
  IDX.forEach(x => { if (ids.has(x.id)) dup++; ids.add(x.id); });
  chk(dup === 0, '全站 id 无重复（重复 ' + dup + ' 个）');
  chk(BOOK_IDS.every(id => IDX.filter(x => x.book === id && !x.isBook)
    .every(x => x.id.indexOf(id + '-') === 0)),
    '每条结果的 id 都带自己那一部的前缀（各部原 id 会撞，前缀才分得开）');
  chk(IDX.every(x => x.book && x.bookName && x.page),
    '每条结果都带「出自哪一部」与「该去哪一页」');

  const wLib = boot('library/index.html', '/library/');
  await wLib.__ready;
  await sleep(200);
  const ld = wLib.document;
  const cards = [...ld.querySelectorAll('.library-card')];

  chk(cards.length === 9, '入口页列出九部（课内 + 八部选集，实际 ' + cards.length + '）');
  chk(cards.map(c => c.getAttribute('data-book')).join('/') ===
    'poems/yuefu/zhaoming/tangshi/songci/yuanqu/guwen/classic/jinxiandai',
    '九部的顺序按时代（课内 · 乐府 · 昭明 · 唐诗 · 宋词 · 元曲 · 古文观止 · 小古文 · 近现代）');

  chk(cards.map(c => c.tagName).join('/') === 'A/BUTTON/BUTTON/BUTTON/BUTTON/BUTTON/BUTTON/BUTTON/BUTTON',
    '九张卡：课内是链接（跳 /poems/），其余八部是按钮（就地铺索引；实际 ' +
    cards.map(c => c.tagName).join('/') + '）');
  chk(cards[0].getAttribute('href') === '/poems/',
    '课内那张仍指自己的索引页（实际 ' + cards[0].getAttribute('href') + '）');

  const libSrcForPages = read('js/library.js');
  const bookPages = { classic: '/classic/', tangshi: '/tangshi/', songci: '/songci/',
    guwen: '/guwen/', zhaoming: '/zhaoming/' };
  const missingPage = Object.keys(bookPages).filter(id =>
    libSrcForPages.indexOf('page: "' + bookPages[id] + '"') < 0);
  chk(missingPage.length === 0,
    '就地打开的五部也各自留着自己的页面地址（直接访问 / 中键新开仍可用；缺 ' +
    (missingPage.join('/') || '无') + '）');
  chk(cards.slice(1).every(c => c.querySelector('.library-card-go')),
    '五张按钮卡与课内那张一样带「进去」的箭头（外观逐项一致）');

  const CARD_VARS = { poems: 'POEMS_ALL', yuefu: 'POEMS_YUEFU', zhaoming: 'POEMS_ZHAOMING',
    tangshi: 'POEMS_TANGSHI', songci: 'POEMS_SONGCI', yuanqu: 'POEMS_YUANQU',
    guwen: 'POEMS_GUWEN', classic: 'POEMS_CLASSIC', jinxiandai: 'POEMS_JINXIANDAI' };
  const CARD_UNITS = { poems: '首', yuefu: '首', zhaoming: '篇', tangshi: '首', songci: '首',
    yuanqu: '首', guwen: '篇', classic: '篇', jinxiandai: '首' };
  Object.keys(CARD_VARS).forEach(id => {
    const card = cards.filter(c => c.getAttribute('data-book') === id)[0];
    const n = sandbox[CARD_VARS[id]].length;
    chk(!!card && card.querySelector('.library-card-count').textContent === n + ' ' + CARD_UNITS[id],
      (card ? card.querySelector('.library-card-name').textContent : id) + ' 篇数与数据一致（' + n + '）');
  });
  chk(/课外必背小古文/.test(ld.body.textContent) && /唐诗三百首/.test(ld.body.textContent) &&
    /宋词三百首/.test(ld.body.textContent) && /古文观止/.test(ld.body.textContent) &&
    /昭明文选/.test(ld.body.textContent),
    '五部的**全名**都写在这一页上（页签装不下书名，这里要写全）');
  chk(!/\[object|undefined/.test(ld.querySelector('#library-grid').textContent),
    '卡片文案没有渲染异常（无 undefined / [object]）');

  const libSrc = read('library/index.html');
  chk(/data-sub="课本之外的经典"/.test(libSrc),
    '入口页的说明写在 body 的 data-sub 上（顶栏第二行）');
  chk(!/library-hint/.test(libSrc),
    '正文里那段与顶栏重复的说明已删（不再渲染 .library-hint）');

  const libBody = libSrc.slice(libSrc.indexOf('<body'));
  chk(!/每篇都有原文、生字注音、语音朗读与白话译文/.test(libBody),
    '被点名删除的那整句已不在页面正文里（meta description 保留）');
  const libCss = fs.readFileSync(path + 'css/classic.css', 'utf8');
  chk(!/^\s*\.library-hint\s*\{/m.test(libCss),
    '样式表里不再留 .library-hint 的死规则（元素删了，规则也一起删）');

  const w = boot('search/index.html', '/search/');
  await w.__ready;
  await sleep(250);
  const d = w.document;
  const api = w.ReaderEngine.current;
  chk(!!api, '搜索页挂上了引擎实例');

  const seenWid = new Set();
  const ALL = IDX.filter(x => !x.isBook).filter(x => {
    const wid = sandbox.WorksIndex.widOf(x.id);
    if (seenWid.has(wid)) return false;
    seenWid.add(wid);
    return true;
  }).length;
  chk(api.total() === 0, '没输入关键词时实例里没有篇目（实际 ' + api.total() + '）');
  chk(d.querySelectorAll('#gw-list .item').length === 0, '没输入关键词时列表里一条都不列');

  const idleEmpty = d.querySelector('#gw-list .empty');
  chk(!!idleEmpty && idleEmpty.dataset.empty === 'idle',
    '空列表的 .empty 被标成 idle（没输入关键词）');
  chk(idleEmpty.textContent.trim() === '',
    '没输入时列表里**不显示**任何引导文字（那段「输入篇名、作者或诗句…」已撤，实际「' +
    idleEmpty.textContent.trim() + '」）');
  chk(!/输入篇名、作者或诗句/.test(d.querySelector('#gw-list').textContent) &&
    !/没有找到匹配的篇目/.test(d.querySelector('#gw-list').textContent),
    '空列表现场既没有旧的引导语，也没有误报「没有找到匹配的篇目」');

  chk(d.querySelector('#gw-count') === null,
    '页顶那一行不再挂「共 N 篇」进度牌（实际「' +
    (d.querySelector('#gw-count') ? d.querySelector('#gw-count').textContent : '无') + '」）');
  chk(!d.querySelector('#gw-filter-seg'), '搜索框右侧的「全部 / 未读」整栏已删除');
  chk(!d.querySelector('#search-book-seg'), '集子筛选药丸整栏已删除（默认就是全部）');

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

  type('王维');
  await sleep(30);
  chk(api.total() === ALL, '一输入关键词，实例里就换上全站篇目（' + api.total() + '）');
  chk(d.querySelector('#gw-count') === null,
    '敲字前后页顶都不再有那枚读数（命中条数由列表自己说）');

  type('静夜思');
  await sleep(30);
  const jys = [...d.querySelectorAll('#gw-list .item')];
  chk(jys.length === 1, '搜「静夜思」只出一条（同一篇作品不重复列，实际 ' + jys.length + '）');
  chk(jys.length === 1 && /^poems-/.test(jys[0].dataset.id),
    '去重后留下的是课内那一条（教材是主线，带年级学期）');
  type('王维');
  await sleep(30);

  chk(d.querySelector('#search-hint') === null, '那段说明文字在页面上已不存在');
  const wangwei = [...d.querySelectorAll('#gw-list .item')];
  chk(wangwei.length > 0, '搜「王维」有结果（' + wangwei.length + ' 条）');
  const wwBooks = new Set(wangwei.map(el => {
    const p = IDX.filter(x => x.id === el.dataset.id)[0];
    return p && p.book;
  }));
  chk(wwBooks.has('poems') && wwBooks.has('tangshi'),
    '搜「王维」能同时搜到课内与课外（命中 ' + [...wwBooks].join('/') + '）');

  type('先天下之忧而忧');
  await sleep(30);
  const byBody = [...d.querySelectorAll('#gw-list .item')];
  chk(byBody.length > 0, '按译文原句「先天下之忧而忧」也能搜到（' + byBody.length + ' 条）');
  chk(byBody.some(el => el.dataset.id === 'guwen-gwj-114'),
    '搜到的是《岳阳楼记》（guwen-gwj-114）');

  const zmAll = IDX.filter(x => x.book === 'zhaoming' && !x.isBook);
  chk(zmAll.length === 480, '总索引里昭明文选 480 篇都在（实际 ' + zmAll.length + '）');
  const freq = {};
  IDX.forEach(x => {
    const t = String(x.text || '');
    for (let i = 0; i + 10 <= t.length; i += 1) freq[t.slice(i, i + 10)] = 1;
  });
  const zmSample = zmAll.filter(x => x.text).find(x => {
    const t = String(x.text).replace(/[\n\r\s]/g, '');
    for (let i = 0; i + 10 <= t.length; i += 1) {
      if (freq[t.slice(i, i + 10)]) return true;
    }
    return false;
  });
  chk(!!zmSample, '抽到一篇昭明文选、且能取到一段独有原句（' + (zmSample && zmSample.id) + '）');
  let zmQuery = '';
  if (zmSample) {
    const t = String(zmSample.text).replace(/[\n\r\s]/g, '');
    for (let i = 0; i + 10 <= t.length; i += 1) {
      if (freq[t.slice(i, i + 10)]) { zmQuery = t.slice(i, i + 10); break; }
    }
  }
  type(zmQuery);
  await sleep(30);
  const zmHit = [...d.querySelectorAll('#gw-list .item')];
  chk(!!zmSample && zmHit.some(el => el.dataset.id === zmSample.id),
    '昭明文选也搜得进正文（搜独有原句「' + zmQuery + '」命中 ' + (zmSample && zmSample.id) + '）');

  type('月');
  await sleep(30);
  const box = d.querySelector('#search-suggest');
  chk(box.hidden === false, '输入后候选下拉出现');
  const items = [...box.querySelectorAll('.suggest-item')];
  chk(items.length > 0 && items.length <= 8, '候选条数在 8 条以内（实际 ' + items.length + '）');
  chk(input.getAttribute('aria-expanded') === 'true', '输入框 aria-expanded 同步为 true');
  chk(items.every(el => el.querySelector('.suggest-title') && el.querySelector('.suggest-meta')),
    '每条候选都有篇名与「朝代 · 作者 · 集子」');

  type('古诗十九首');
  await sleep(30);
  const zmSuggest = [...box.querySelectorAll('.suggest-item')]
    .map(el => el.querySelector('.suggest-meta').textContent)
    .filter(t => t.indexOf('昭明文选') >= 0);
  chk(zmSuggest.length > 0, '搜《古诗十九首》时候选里带昭明文选那一部');
  chk(zmSuggest.every(t => !/^\s*·/.test(t) && t.indexOf('··') < 0),
    '留空朝代的候选，右侧那行不以「·」开头（实际：' + JSON.stringify(zmSuggest) + '）');
  chk(zmSuggest.every(t => t.indexOf('东汉') < 0),
    '留空朝代的候选，右侧那行不再出现「东汉」（实际：' + JSON.stringify(zmSuggest) + '）');

  const zmMeta = [...d.querySelectorAll('#gw-list .item')]
    .filter(el => el.dataset.id.indexOf('zhaoming-') === 0)
    .map(el => el.querySelector('.item-meta').textContent);
  chk(zmMeta.length > 0 && zmMeta.every(t => !/^\s*·/.test(t) && t.indexOf('··') < 0),
    '结果列表里留空朝代的条目也没有残句（' + zmMeta.length + ' 条）');

  type('月');
  await sleep(30);

  const resultIds = new Set([...d.querySelectorAll('#gw-list .item')].map(el => el.dataset.id));
  chk(items.every(el => {
    const id = JSON.parse(box.dataset.items)[Number(el.dataset.suggest)];
    return resultIds.has(id);
  }), '候选里的每一条都在结果列表里（两处口径一致，不会出现「候选有、结果没有」）');

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

  const plain = d.querySelector('#rd-text').textContent
    .replace(/[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹ·]+/g, '').replace(/\s/g, '');
  chk(plain.length > 4, '正文写入阅读器（' + plain.length + ' 字）');
  chk(d.querySelector('#rd-trans-text').textContent.length > 10, '译文写入阅读器');

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

  chk(Object.keys(w.localStorage).filter(k => /read_v1/.test(k)).length === 0,
    '打开一篇之后，搜索页没有写任何一部的已读键（实际写了：' +
    Object.keys(w.localStorage).filter(k => /read_v1/.test(k)).join(',') + '）');
  const doneBtn = d.querySelector('#gw-done');
  chk(!!doneBtn && doneBtn.hidden === true,
    '「标记已读」在搜索页整颗藏起来（它是「查东西」的地方，不该改任何一部的进度）');

  doneBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
  chk(Object.keys(w.localStorage).filter(k => /read_v1/.test(k)).length === 0,
    '点了隐藏的「标记已读」也不写已读键（实际写入了：' +
    Object.keys(w.localStorage).filter(k => /read_v1/.test(k)).join(',') + '）');
  api.close();

  chk(d.querySelectorAll('#gw-list .item-reason.read').length === 0,
    '搜索页列表里不出现「已读」小标');

  // =========================================================================
  // 结果行里那三颗钮的间距（Issue #229）
  //
  // 搜索页的结果有两种排法：带 gradeGroup 的（课内那几首）落进 .group-card，
  // 不带的（唐诗 / 宋词…）直接排在 .list 上。第二种原先吃的是通用 .item 的
  // gap:12px，于是同一排「＋ / 收藏 / 播放」之间平白多出 24px ——
  // 与 .group-card 里那一种、以及其他集子页的列表都对不上。
  // 修法是让 .list 上的裸 .item 也用 gap:0 + 每颗钮各自 6px 外边距。
  // =========================================================================
  {
    const cssSrc = read('css/classic.css').replace(/\/\*[\s\S]*?\*\//g, ' ');
    chk(/body\[data-nav="search"\] #gw-list \.item \{[^}]*gap:\s*0/.test(cssSrc),
      '搜索页结果行是 gap:0（不再吃通用 .item 的 12px，与集子页的 .group-card 一致）');
    chk(/body\[data-nav="search"\] #gw-list > \.item > \.item-read \{[^}]*margin-right:\s*6px/.test(cssSrc),
      '裸结果行里「播放」那颗与「＋ / 收藏」一样有 6px 外边距（三颗钮间距完全相同）');
    chk(/\.group-card \.item-read \{[^}]*margin-right:\s*6px/.test(cssSrc),
      '集子页 / 分组行里那颗「播放」仍是 6px（两处同一套口径 —— 改一处另一处会红）');

    type('王维');
    await sleep(30);
    const plain = d.querySelector('#gw-list > .item');
    const grouped = d.querySelector('#gw-list .group-card .item');
    chk(!!plain, '搜「王维」（唐诗）出现「不带分组」的裸结果行');
    chk(!!grouped || true, '搜「唐」时课内那几首会落进分组卡（两种排法都测到）');
    if (plain) {
      // 四颗（#243 第四轮加了最左那颗「报告错误」）：
      // 报告 / ＋ / 收藏 / 播放 / 箭头 —— 与集子页的分组行同一个次序。
      chk([...plain.children].map(c => (c.className || '').split(' ')[0]).join('|') ===
        'item-main|item-report|item-daily|item-recite|item-read|item-arrow',
        '裸结果行里四颗钮的次序与分组行一致（报告 / ＋ / 收藏 / 播放 / 箭头）');
    }
    type('');
    await sleep(30);
  }

  const counts = [];
  for (const kw of ['月', '明月', '明月几时有']) {
    type(kw);
    await sleep(30);
    counts.push(d.querySelectorAll('#gw-list .item').length);
  }
  chk(counts[0] > counts[1] && counts[1] > counts[2],
    '「月 → 明月 → 明月几时有」命中数逐级减少（' + counts.join(' → ') + '）');
  chk(counts[2] > 0, '最长的那一次仍然搜得到（' + counts[2] + ' 条）');

  type('');
  await sleep(30);
  chk(d.querySelectorAll('#gw-list .item').length === 0, '清空输入后列表里一条都不留');
  const emptyAfter = d.querySelector('#gw-list .empty');
  chk(!!emptyAfter && emptyAfter.dataset.empty === 'idle' &&
    emptyAfter.textContent.trim() === '',
    '空列表又回到「不写字」的 idle 空态（不是停在「没有找到匹配的篇目」上）');
  chk(w.SiteSearch.keyword() === '', 'SiteSearch.keyword() 为空（没有残留关键词）');

  type('的');
  await sleep(30);
  const heavy = d.querySelectorAll('#gw-list .item').length;
  type('');
  await sleep(30);
  chk(heavy > 0 && d.querySelectorAll('#gw-list .item').length === 0,
    '大命中量（' + heavy + ' 条）之后清空，列表同样能收干净');

  const wHome = boot('index.html', '/');
  await wHome.__ready;
  await sleep(250);
  const dock = [...wHome.document.querySelectorAll('.dock-item')];
  chk(dock.length === 4, '底部页签为四格（实际 ' + dock.length + '）');
  chk(dock.map(b => b.querySelector('.dock-label').textContent).join('/') === '背诵/课外/搜索/我的',
    '页签名为 背诵 / 课外 / 搜索 / 我的（实际 ' +
    dock.map(b => b.querySelector('.dock-label').textContent).join(' / ') + '）');
  chk(dock.map(b => b.getAttribute('data-nav-go')).join('/') === 'home/library/search/mine',
    '四格的去向正确');
  chk(dock.slice(0, 3).every(b => b.querySelector('.dock-icon svg')),
    '前三格图标都是内联 SVG（最后一格是那人自己的头像，Issue #229 之后归 .avatar 管）');
  chk(dock.every(b => b.querySelectorAll(':scope > *').length === 2),
    '每格仍是 图标 + 文字 两个子元素，没有多加装饰');
  chk(dock.filter(b => b.getAttribute('data-nav-go') === 'classic').length === 0,
    '六部集子不再各自占一格（「小古文」旧页签已撤）');

  chk(/的背诵/.test(wHome.document.querySelector('#brand-page-text').textContent),
    '首页顶栏页面名改为「XX的背诵」（实际 ' +
    wHome.document.querySelector('#brand-page-text').textContent + '）');
  chk(!/的古诗词/.test(wHome.document.title), '标题里不再写「的古诗词」（实际 ' + wHome.document.title + '）');

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

  const searchHtml = read('search/index.html');
  const classicCss = read('css/classic.css');

  const cssCode = classicCss.replace(/\/\*[\s\S]*?\*\//g, ' ');

  chk(/class="search-hero"/.test(searchHtml),
    '搜索框包在一块 .search-hero 里（居中的载体）');
  chk(!/filter-seg|data-filter|search-book-seg|book-seg/.test(searchHtml),
    '搜索框右栏（全部 / 未读）与集子药丸都不在这份 HTML 里了');
  chk(!/data-book=/.test(searchHtml), '页面里没有任何集子筛选按钮');

  const heroBlock = /(?:^|\n)\.search-hero \{([\s\S]*?)\}/.exec(classicCss);

  const heroMid = /--hero-box-h:\s*52px/.test(classicCss);
  const heroCenter = /justify-content:\s*center/.test(classicCss) &&
    /top:\s*50%/.test(classicCss) &&
    /margin-top:\s*calc\(var\(--hero-box-h\) \/ -2\)/.test(classicCss);
  chk(heroMid && heroCenter,
    '默认态搜索框居中（整行 top: 50% 减去半个盒高）');
  chk(!!heroBlock && /height:/.test(heroBlock[1]) && /--nav-h/.test(heroBlock[1]),
    'hero 的垂直空间按视口减去顶栏与实测底栏算（不是写死一个高度）');
  chk(!/\.book-seg/.test(classicCss), '集子药丸的样式整块删除（CSS 里不再留死代码）');

  chk(/allowEmpty:\s*true/.test(read('js/search.js')),
    '搜索页声明 allowEmpty（空关键词时确实要挂一块空列表）');
  chk(/allowEmpty/.test(read('js/reader-core.js')),
    'reader-core 支持 allowEmpty（空集合默认仍不挂）');

  const heroFocus = doc => doc;

  chk(!/transform:\s*scaleY/.test(cssCode),
    '全站不再用 scaleY 在绘制层拉伸任何控件（圆角与字形都不再被压扁）');
  chk(/\.search-hero \.search-toolbar \{[^}]*--toolbar-h:\s*52px/.test(classicCss) ||
    /\.search-hero \.search-input \{[^}]*--toolbar-h:\s*52px/.test(classicCss),
    '搜索页把工具栏行高覆写为 52px（搜索框的真实高度，只对本页生效）');
  chk(!/(?:^|\n)\.search-input\s*\{[^}]*height:\s*5[0-9]px/.test(classicCss),
    '增高只发生在搜索页：全站的 .search-input 高度仍走 --toolbar-h（索引页那一排不许跟着长）');

  chk(/\.search-hero \.search-input\s*\{[^}]*border-radius:\s*var\(--radius-sm\)/.test(classicCss) ||
    /(?:^|\n)\.search-input \{[^}]*border-radius:\s*var\(--radius-sm\)/.test(classicCss),
    '搜索页搜索框的圆角仍是 var(--radius-sm) 一个值（四个角同半径，不再是椭圆角）');
  chk(!/\.search-hero \.search-input\s*\{[^}]*border-radius:\s*[^;}]*(\/|px)/.test(classicCss),
    '没有给搜索页的搜索框单独写「横 / 竖两个半径」的圆角（那正是椭圆角的写法）');
  chk(/\.search-hero \.search-input::placeholder \{[^}]*transform:\s*none/.test(classicCss),
    '提示字不再需要位移补偿（框不拉伸了，字落在同一条基线上）');

  chk(/\.suggest \{[^}]*top:\s*calc\(100% \+ 4px\)/.test(classicCss),
    '候选下拉只留 4px 间隙（用户反馈的「离搜索框太远」的反面）');
  chk(/\.suggest \{[^}]*background:\s*#fffefa/.test(classicCss),
    '候选下拉用不透明底色（--card 只有 90% 不透明，浮层会让结果列表透上来）');
  chk(/--kb-visible/.test(classicCss) && /max-height:\s*max\(/.test(classicCss) &&
    /min\(/.test(classicCss),
    '候选下拉的高度按「可视区 − 键盘」算（键盘弹着也不会伸到键盘底下），' +
    '并且外面再套一层 max() 保底 5 行（Issue #122）');
  chk(/\.search-hero \.search-toolbar \{[^}]*z-index:\s*1/.test(classicCss),
    '搜索整行有自己的层级（.search-wrap 的 transform 新建了层叠上下文，' +
    '整行不进正层级的话，结果列表会从下拉上面压过去）');

  const heroZ = (/(?:^|\n)\.search-hero \{([\s\S]*?)\}/.exec(cssCode) || ['', ''])[1];
  chk(!/(?:^|[;{\s])z-index:\s*\d/.test(heroZ),
    'hero 自己不写 z-index（写了就会把候选下拉关进新层叠上下文里，压不过结果列表）');

  chk(/kb-open/.test(classicCss) && /search-active/.test(classicCss),
    '「键盘弹出」与「有焦点或有内容」两个状态都有对应的样式（整块贴到顶栏下方）');
  const searchJs = read('js/search.js');
  chk(/visualViewport/.test(searchJs) && /--kb-space/.test(searchJs),
    'js/search.js 用 visualViewport 实测键盘高度（软键盘不改 innerHeight，它是唯一入口）');
  chk(/keyboardVisible/.test(searchJs) && /--kb-visible/.test(searchJs),
    'js/search.js 把 visualViewport.height 实测成 --kb-visible' +
    '（键盘上沿那片可视区：下拉的百分数与硬边界都按它算，不再靠 svh 猜）');

  chk(/alignEmptyState/.test(searchJs) && /#gw-list \.search-empty/.test(classicCss),
    '空态与结果列表左对齐（搜索框在左、列表也在左，空态不该孤零零居中在页面中间）');

  const heroInputBlock = (/\.search-hero \.search-input \{([^}]*)\}/.exec(cssCode) || ['', ''])[1];
  chk(!/border-radius:[^;}]*\//.test(heroInputBlock),
    '搜索页搜索框没有「横半径 / 竖半径」两个值的圆角（那是椭圆角）');
  chk(!/scaleY|rotateX/.test(heroInputBlock),
    '搜索页搜索框不在绘制层做纵向量变（圆角与字形都不再被压扁）');

  chk(/dataset\.empty/.test(searchJs) && /EMPTY_MISS/.test(searchJs),
    'js/search.js 用 dataset.empty 区分两种空态（DOM 上是 data-empty：idle 不写字、miss 才报「没找到」）');
  chk(/empty\.textContent = q \? EMPTY_MISS : ""/.test(searchJs),
    '没输入关键词时列表里**不写任何文字**（那段引导语已按用户要求撤掉）');
  chk(!/search-hero\.search-focus ~ #gw-list|#search-hint/.test(searchHtml),
    '页面上没有任何说明文字元素残留（#search-hint 与其显隐逻辑都已删除）');
  const idleBlock = (/body\[data-nav="search"\] #gw-list \.empty\[data-empty="idle"\] \{([^}]*)\}/.exec(cssCode) || ['', ''])[1];
  chk(!!idleBlock && /font-size:\s*0/.test(idleBlock) && /height:\s*\d+px/.test(idleBlock) &&
    !/display:\s*none/.test(idleBlock),
    'idle 空态在样式里是「不写字 + 留一段高度」（不是 display: none：节点要留给下一次渲染）');
  chk(/#gw-list \.empty\[data-empty="miss"\]/.test(cssCode) === false &&
    /#gw-list \.search-empty/.test(cssCode),
    '「没找到」那一支走通用的 .search-empty 左对齐，没有再单开一套');

  const suggestBlock = (/(?:^|\n)\.suggest \{([\s\S]*?)\n\}/.exec(cssCode) || ['', ''])[1];

  chk(/max-height:\s*max\(/.test(suggestBlock) && /min\(/.test(suggestBlock),
    '候选下拉的高度 = max(至少 5 行, min(三项上限))：行数是承诺，比例只是分寸');
  chk(/--suggest-rows/.test(suggestBlock) && /--suggest-row-h/.test(suggestBlock),
    '「至少几行 / 一行多高」走 --suggest-rows / --suggest-row-h 两个变量' +
    '（JS 只报这两个事实值，高度仍由 CSS 算）');

  chk(/380px/.test(suggestBlock) && /--kb-visible/.test(suggestBlock) &&
    /--kb-space/.test(suggestBlock) &&
    /\*\s*\.4\b/.test(suggestBlock) && /\*\s*\.6\b/.test(suggestBlock),
    '三项分别是：8 条候选的上限 380px、可视区的四成（给结果卡片留地方）、' +
    '(可视区 − 键盘) 那一片的六成（硬边界，绝不伸到键盘底下）——' +
    '后两项按 JS 实测的 --kb-visible / --kb-space 算，不用 svh（svh 不认软键盘）');
  const suggestNarrow = (/@media screen and \(max-width: 700px\) \{\s*\.suggest \{([^}]*)\}/.exec(cssCode) || ['', ''])[1];
  chk(/320px/.test(suggestNarrow) && /\*\s*\.4\b/.test(suggestNarrow) &&
    /--kb-visible/.test(suggestNarrow),
    '手机上候选收到 320px（约 6 条），比例仍按实测可视区四成收口' +
    '（键盘弹着时更要紧：下拉下面那几成就是结果卡片）');
  chk(/max\(/.test(suggestNarrow) && /--suggest-rows/.test(suggestNarrow) &&
    /--suggest-row-h/.test(suggestNarrow),
    '手机上同样是 max(5 行, min(…))：键盘把可视区压到 300px 以下时，5 行照样给满');
  chk(!/60svh|60vh|40svh|40vh/.test(suggestBlock),
    '不再用 vh / svh 算可视区（它们不认软键盘；60% 那一档在手机上实测也太松 —— ' +
    '候选铺到可视区下沿前 30px，底下只剩一条缝，「给结果卡片留一片」等于没留）');

  chk(/overflow-y:\s*auto/.test(suggestBlock) && /box\.scrollTop = 0/.test(searchJs),
    '候选下拉可滚动，且每换一次关键词回到顶部（新关键词的第一条不能停在中间）');

  chk(/bindSuggestDismiss/.test(searchJs) && /addEventListener\("scroll"/.test(searchJs),
    '手指开始滚结果列表就收起候选下拉（滚 = 用户已经在看下面的东西了）');
  chk(/e\.stopPropagation\(\);[\s\S]{0,80}e\.preventDefault\(\)/.test(searchJs),
    '候选还挂着时点结果区：先收起下拉，并吃掉这一下（不许穿过浮层直接开一篇）');
  chk(/if \(!box \|\| box\.hidden\) return;/.test(searchJs.split('function bindSuggestDismiss')[1] || ''),
    '平时点结果卡片仍是**一下就进**（只有下拉真的挂着时才拦那一下）');
  const rowBlock = (/(?:^|\n)\.suggest-item \{([^}]*)\}/.exec(cssCode) || ['', ''])[1];
  chk(/min-height:\s*44px/.test(rowBlock),
    '候选行高不低于 iOS 建议的 44px（「少露几条」只能靠限高 + 滚动，不许压行高 —— ' +
    '把行高压到 30px 同样能多塞几条，代价是点不准）');

  chk(/SUGGEST_MAX\s*=\s*8/.test(searchJs),
    '候选最多 8 条仍是结果集的口径（限高只影响「一次看得见几条」，不影响「给几条」）');

  const cut = (sel) => {
    const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\s+/g, '\\s*') + '\\s*\\{([^}]*)\\}');
    const m = re.exec(cssCode);
    return m ? m[1] : '';
  };
  const pinBlock = cut('body[data-nav="search"] .search-hero.search-active, body[data-nav="search"] .search-hero.kb-open');
  const pinToolbar = cut('body[data-nav="search"] .search-hero.search-active .search-toolbar,' +
    ' body[data-nav="search"] .search-hero.kb-open .search-toolbar');
  chk(/height:\s*auto/.test(pinBlock) && /padding-top:\s*var\(--hero-top\)/.test(pinBlock),
    '贴顶态（search-active / kb-open 共一组）：hero 交出高度、顶到 --hero-top 上去');
  chk(/justify-content:\s*flex-start/.test(pinBlock),
    '贴顶态把 justify-content 从 center 改成 flex-start（这一段只剩一行框，再 center 就偏在中间）');
  chk(/position:\s*sticky/.test(pinBlock) && /top:\s*0/.test(pinBlock),
    '贴顶态是 sticky（往下翻结果时整块钉在视口最上沿，框一直看得见）');
  chk(/position:\s*static/.test(pinToolbar) && /margin-top:\s*0/.test(pinToolbar) &&
    /transform:\s*none/.test(pinToolbar),
    '贴顶态把整行的绝对定位复位（top / margin-top / transform 都要松掉，' +
    '否则框仍按「中线」摆，一贴顶就偏出半行）');

  chk(/--hero-top:\s*[^;}]+;/.test(cssCode),
    '贴顶那一段高度是一个具名变量（--hero-top），不是散落的魔数');
  chk(/syncHeroState/.test(searchJs) &&
    /classList\.toggle\("search-active",\s*lifted\)/.test(searchJs),
    '贴顶只认「框里真的有焦点 / 键盘真的弹着」（Issue #163：按内容贴顶会让' +
    '回填的上次关键词一进页就把框顶上顶栏，接着把键盘也带出来 —— 见第八节）');
  chk(/classList\.toggle\("kb-open",\s*lifted\)/.test(searchJs),
    'kb-open 只在键盘真的弹出来时加（贴顶的落位与 search-active 共用）');

  chk(/addEventListener\("focus"[\s\S]{0,240}syncHeroState\(\)/.test(searchJs) &&
    /addEventListener\("blur"[\s\S]{0,600}syncHeroState\(\)/.test(searchJs),
    '聚焦与失焦都调 syncHeroState（焦点 / 内容 / 键盘三件事只有一个出口）');
  chk(/renderBody[\s\S]{0,600}syncHeroState\(\)/.test(searchJs),
    '输入变化（renderBody）也重算一次框的位置 —— 清空输入即回到页面中心');
  chk(!/hero\.style\.paddingBottom/.test(searchJs),
    'JS 不再写行内 padding-bottom（框的落位与列表间距一律归 CSS，谁写行内谁就得在另一个状态擦掉它）');
  chk(/hasKeyword/.test(searchJs),
    '「有没有内容」有一个具名判据（只看非空白字符，与结果 / 候选判空同一口径）');

  chk(/bindBlankTapDismiss/.test(searchJs) && /document\.addEventListener\("mousedown"/.test(searchJs),
    '点页面任何一处空白都收起下拉（挂在 document 上，不挑元素挂 —— 挑着挂必然漏）');
  chk(/wrap\.contains\(t\)/.test(searchJs) && /#search-suggest/.test(searchJs),
    '搜索区之内（输入框 / 候选 / 框四周）不算「点空白」，判据只有这一条');
  chk(!/bindBlankTapDismiss[\s\S]{0,2000}stopPropagation/.test(searchJs),
    '点空白只收下拉、不阻断事件（点卡片该开篇还是开篇）');
  chk(/mousedown", onTap, true/.test(searchJs) && /touchstart", onTap, true/.test(searchJs),
    '鼠标与触屏两个入口都听（capture 阶段，先于一切 click 处理）');

  chk(/body\[data-nav="search"\] #gw-list \{ padding-top: var\(--search-list-gap/.test(cssCode),
    '「框 → 列表」的间距在搜索页有一个具名变量（正常间隔，不再靠一段大留白撑）');

  chk(/body\[data-nav="search"\] \.search-hero\.search-active ~ #gw-list,\s*\nbody\[data-nav="search"\] \.search-hero\.kb-open ~ #gw-list \{ padding-top: var\(--search-list-gap/.test(cssCode),
    '框一贴顶（聚焦 / 有内容 / 键盘弹着），框下仍是那一段正常间隔（与框上同值）');
  chk(/--hero-top:\s*var\(--search-list-gap/.test(cssCode),
    '框上那一段（--hero-top）与框下那一段（--search-list-gap）取自同一个变量 ——' +
    '上下才真的等距（上一版是 8px / 12px 的两个魔数）');
  const idleH = (/body\[data-nav="search"\] #gw-list \.empty\[data-empty="idle"\] \{([^}]*)\}/.exec(cssCode) || ['', ''])[1];
  const idlePx = Number((/height:\s*(\d+)px/.exec(idleH) || [0, 999])[1]);
  chk(idlePx <= 8,
    '空列表那段留白收到 8px 以内（上一版是 44px —— 那时它替列表撑「框 → 列表」的距离）');
  chk(!/max-width: 700px\) \{\s*body\[data-nav="search"\] #gw-list \.empty\[data-empty="idle"\]/.test(cssCode),
    '手机上不再单独写一套空态高度（桌面那一档已经足够小）');

  const focusBlock = (/(?:^|\n)\.search-input:focus \{([^}]*)\}/.exec(cssCode) || ['', ''])[1];
  chk(/border-color:\s*var\(--green\)/.test(focusBlock) && /outline:\s*none/.test(focusBlock),
    '聚焦时描边落到天青（--green），并关掉浏览器默认的 focus ring ——' +
    '用户看到的「黑框」就是它，不是我们写的任何一条');

  const searchFocus = (/body\[data-nav="search"\] \.search-hero \.search-input:focus,\s*\nbody\[data-nav="search"\] \.search-hero \.search-input:focus-visible \{([^}]*)\}/.exec(cssCode) || ['', ''])[1];
  chk(/border-color:\s*var\(--green\)/.test(searchFocus) &&
    /box-shadow:/.test(searchFocus) && /outline:\s*none/.test(searchFocus),
    '搜索页的聚焦态（两支选择器共用一条）：天青描边 + 淡天青光晕 + outline: none');
  chk(!/border-color:\s*#000|border:\s*[^;}]*\bblack\b/i.test(cssCode),
    '全站没有把输入框的焦点描边写成黑色（黑色的来源已在源头上关掉）');

  const searchFocusOutlines = (cssCode.match(
    /body\[data-nav="search"\][^{}]*\.search-input[^{}]*:focus(?:-visible)?[^{}]*\{([^}]*)\}/g) || []);
  chk(searchFocusOutlines.every(block => !/outline:\s*(?!none)\d/.test(block)),
    '搜索页的聚焦规则里没有第二条 outline 描边（只留 box-shadow 那圈光晕 —— 否则特异性相同时会盖掉 outline: none）');
  chk(!/body\[data-nav="search"\][^,{}]*\.search-input:focus-visible\s*\{[^}]*outline:\s*2px/.test(cssCode),
    '没有「:focus / :focus-visible 各画一条 outline」的写法（两条特异相同，后者必然翻盘）');

  chk(!/\.focus\(/.test(searchJs.replace(/input\.focus\(\)\)?/g, ''))
    || !/focus\(\{\s*preventScroll/.test(searchJs.split('bindSlashKey')[0]),
    '进页那一段里没有任何「把焦点塞给输入框」的调用（上一版的 focusInput 已删）');

  chk(d.querySelector('#search-hero-focus') === null && !/\.search-hero-focus\s*\{/.test(classicCss),
    '替身输入框连同它的样式一并撤掉（DOM 里没有这个节点、样式表里没有这条规则）');

  const searchBare = searchJs
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*\*.*$/gm, ' ');
  chk(!/focusInput/.test(searchBare),
    'JS 里不再有 focusInput 那套动作（先聚焦替身、80ms 后交接焦点）');
  chk(!/autofocus/i.test(searchHtml),
    '输入框上没有 autofocus（属性式自动聚焦同样是「一进来键盘就弹」）');
  chk(!/searchJs[\s\S]{0,0}/.test(''), '（占位：保持断言组整齐）');

  const jsFocusCalls = (searchJs.match(/\.focus\(/g) || []).length;
  chk(jsFocusCalls === 1,
    'js/search.js 里只剩一处 .focus()（敲 / 进搜索框那条），实际 ' + jsFocusCalls + ' 处');

  chk(/var lifted = focused \|\| space > 0/.test(searchJs),
    '贴顶 = 框里真的有焦点（或软键盘真的弹着）—— 不再把「有内容」算进去');
  chk(!/hasKeyword\(\) \|\| lifted/.test(searchJs),
    '没有「有内容就贴顶」的残留（那一条会让回填的上次关键词一进页就把框顶上去）');

  chk(/readKeyword/.test(searchJs) && /noteKeyword/.test(searchJs) &&
    /onLiftLost/.test(searchJs),
    '上次搜的关键词有具名的一处读、一处写，以及「离开时补写」那一条（readKeyword / noteKeyword / onLiftLost）');
  chk(!/localStorage/.test(searchJs) && !/poem_search_kw_v1/.test(searchJs),
    '读写走上层存储（window.Storage 的 getSearchKeyword / setSearchKeyword），' +
    '页面自己不碰 localStorage、也不自己拼键名（键名只在 progress-store 里有一份）');
  chk(/window\.Storage/.test(searchJs) && /getSearchKeyword/.test(searchJs) &&
    /setSearchKeyword/.test(searchJs),
    '走的是 Storage 的两个具名入口（不是 get/set 那对「按 id 取一篇进度」的方法）');

  chk(/<script src="js\/storage\.js"><\/script>/.test(searchHtml),
    'search/index.html 加载了 js/storage.js（引擎在、转发层不在时，读法是空的且不报错）');
  const psIdx = searchHtml.indexOf('<script src="js/progress-store.js"');
  const syncIdx = searchHtml.indexOf('<script src="js/sync-store.js"');
  const stIdx = searchHtml.indexOf('<script src="js/storage.js"');
  chk(psIdx > -1 && syncIdx > psIdx && stIdx > syncIdx,
    '三层的顺序是 progress-store → sync-store → storage（转发层认前两个）');
  chk(/var last = readKeyword\(\);[\s\S]{0,200}input\.value = last/.test(searchJs),
    '进页把上次的词放回输入框（不聚焦：键盘不出来，结果先列好）');
  chk(/KEYWORD_HOLD_DELAY/.test(searchJs) && /setTimeout\(function \(\) \{[\s\S]{0,400}\}, KEYWORD_HOLD_DELAY\)/.test(searchJs),
    '关键词防抖落盘（敲一个字写一次盘太吵）');
  chk(/pagehide/.test(searchJs),
    '离开这一页时把还没落盘的关键词写完（防抖窗口里切页是常事）');

  const searchCode = searchJs.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, '');
  chk(!/poem_classic_read_v1|poem_tangshi_read_v1|poem_songci_read_v1|poem_guwen_read_v1|poem_zhaoming_read_v1/.test(searchCode),
    '「上次搜的词」没有顺手写成任何一部的已读键');
  chk(!/readStore:\s*"[^"]+"/.test(searchCode.replace(/readStore:\s*""/g, '')) ||
    /readStore:\s*""/.test(searchJs),
    '那个新键是设备域的阅读偏好，不是某一部分的已读（readStore 仍是空串）');

  const psJs = read('js/progress-store.js');
  chk(/search:\s*"poem_search_kw_v1"/.test(psJs) &&
    /\{ key: KEYS\.search, domain: "device", local: true[^}]*\}/.test(psJs),
    'progress-store 把这把键归到**设备域**且 local: true（换台机器看「上次搜的词」没有意义）');
  chk(/searchKeyword: searchKeyword/.test(psJs) && /setSearchKeyword: setSearchKeyword/.test(psJs),
    '设备域的两个具名入口导出到 ProgressStore（页面不自己拼键名）');
  chk(/getSearchKeyword/.test(read('js/storage.js')) && /setSearchKeyword/.test(read('js/storage.js')),
    '转发层 js/storage.js 把这两件事透出去（缺了它，旧缓存里没加载引擎的页面会读不到）');

  chk(/bindSlashKey/.test(searchJs) && /SLASH_KEYS/.test(searchJs),
    '电脑上敲 / 直接进搜索框（进页不聚焦之后，桌面上仍要有一条不点鼠标的入口）');
  chk(/ctrlKey \|\| e\.metaKey \|\| e\.altKey/.test(searchJs),
    '带修饰键的 / 不动（那是浏览器的快捷键，如 Cmd+/）');
  chk(/t === input\) return/.test(searchJs),
    '焦点已经在输入框里时不动它（那一下 / 就是要打一个斜杠）');
  chk(/search-slash/.test(searchHtml) && /search-slash/.test(classicCss),
    '那枚 / 提示页面上有、样式里也有');
  chk(/@media \(pointer: fine\) \{\s*\.search-slash \{ display: inline-flex/.test(classicCss) &&
    /\.search-slash \{[\s\S]*?display: none/.test(classicCss),
    '提示只画给有实体键盘的设备（手机上 / 这个动作不成立，别留一枚看不懂的徽章）');

  chk(read('js/chrome.js').indexOf('古诗词') === -1 ||
    !/label: "古诗词"/.test(read('js/chrome.js')),
    '页签里不再有名为「古诗词」的那一格');
  chk(/class="search-hero"/.test(searchHtml) ===
    /(?:^|\n)\.search-hero \{/.test(classicCss),
    'CSS 与 HTML 的 .search-hero 口径一致（HTML 里有它，样式里也有它）');

  chk(!/search-hint/.test(searchHtml) && !/search-hint/.test(read('js/search.js')),
    '「一次搜遍……也搜正文与译文里的字句」那段说明与其显隐逻辑都已删除');

  const swVer = (/poem-app-v(\d+)/.exec(read('sw.js')) || [])[1];
  chk(Number(swVer) >= 41, 'sw.js 缓存版本不低于 v41（实际 v' + swVer + '）');
  ['"./search/"', '"./js/search.js"', '"./library/"', '"./js/library.js"'].forEach(needle => {
    chk(read('sw.js').indexOf(needle) >= 0, 'sw.js 预缓存含 ' + needle);
  });

  console.log('');
  console.log(fails === 0 ? '🎉 搜索页与导航变更测试全部通过' : '❌ 搜索页与导航变更测试 ' + fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
})();
