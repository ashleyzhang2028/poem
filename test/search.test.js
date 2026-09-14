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
  // 正文存储主表：被主表收编的条目只存归属（textRef），正文要按它取回 ——
  // loadData 会把 data/text-master.js 排到最前（data/index.js 聚合时就要用它）。
  const { loadData, resolve } = require('./master-env');
  loadData(sandbox, ['data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js',
   'data/poems-5.js', 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js',
   'data/poems-9.js', 'data/poems-10.js', 'data/poems-11.js', 'data/poems-12.js',
   'data/index.js', 'data/poems-classic.js', 'data/poems-tangshi.js',
   'data/poems-songci.js', 'data/poems-guwen.js', 'data/poems-zhaoming.js',
   'data/site-index.js', 'data/works-map.js', 'data/works-index.js']);

  const IDX = sandbox.SITE_INDEX;
  // 五部集子各自按 textRef 展开（与页面里引擎取到的一致），再数「有正文的篇数」
  const books = [
    resolve(sandbox, sandbox.POEMS_CLASSIC, 'classic'),
    resolve(sandbox, sandbox.POEMS_TANGSHI, 'tangshi'),
    resolve(sandbox, sandbox.POEMS_SONGCI, 'songci'),
    resolve(sandbox, sandbox.POEMS_GUWEN, 'guwen'),
    resolve(sandbox, sandbox.POEMS_ZHAOMING, 'zhaoming')
  ];
  const BOOK_IDS = ['classic', 'tangshi', 'songci', 'guwen', 'zhaoming'];
  // 昭明文选的译文已全部补齐（480 篇），进索引的条数因此等于它自己的篇数。
  // 那层「待补不进索引」的过滤仍然保留在 data/site-index.js 里（给下一部集子用的），
  // 所以这里照 `text && translation` 算，而不是直接拿全量 —— 哪一天又有新部集子
  // 带「待补」条目进来，这一行会自动跟上，不必再改。
  const zmIndexed = books[4].filter(p => p.text && p.translation).length;

  chk(IDX.length === sandbox.POEMS_ALL.length +
      books.reduce((n, b) => n + b.filter(p => p.text && p.translation).length, 0) + 6,
    '总索引 = 课内诗词 + 五部全集子（其中昭明 ' + zmIndexed + ' 篇）+ 6 条集子条目（实际 ' + IDX.length + '）');
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

  /* ---------- 二、入口页：六部集子都进得去，篇数实时算 ---------- */
  const wLib = boot('library/index.html', '/library/');
  await wLib.__ready;
  await sleep(200);
  const ld = wLib.document;
  const cards = [...ld.querySelectorAll('.library-card')];
  // 六部 = 课内诗词（第一张卡指回首页）+ 五部选集。
  // 课内不是「课外」，但它也该从这张目录进得去 —— 用户在这一页看到的是
  // 「站上有哪几部、各多少篇」的完整账，而不是缺了课内的一份残表。
  chk(cards.length === 6, '入口页列出六部（课内 + 五部选集，实际 ' + cards.length + '）');
  chk(cards.map(c => c.getAttribute('data-book')).join('/') ===
    'poems/classic/tangshi/songci/guwen/zhaoming',
    '六部的顺序与出处正确');
  chk(cards.map(c => c.getAttribute('href')).join(' ') ===
    '/ /classic/ /tangshi/ /songci/ /guwen/ /zhaoming/',
    '六张卡各指到自己的索引页（实际 ' + cards.map(c => c.getAttribute('href')).join(' ') + '）');
  // 篇数与各集子**自己的数据**一致（不写死数字：日后增补篇目，卡片跟着变）
  // ⚠️ 卡片上那个数字不能拿搜索索引来数 —— 索引按约定不收「待补」条目，
  // 拿它来数会出现「卡片写 480 篇、索引里只有几十条」。见 js/library.js 的 countOf()。
  const CARD_VARS = { poems: 'POEMS_ALL', classic: 'POEMS_CLASSIC', tangshi: 'POEMS_TANGSHI',
    songci: 'POEMS_SONGCI', guwen: 'POEMS_GUWEN', zhaoming: 'POEMS_ZHAOMING' };
  const CARD_UNITS = { poems: '首', classic: '篇', tangshi: '首',
    songci: '首', guwen: '篇', zhaoming: '篇' };
  Object.keys(CARD_VARS).forEach((id, i) => {
    const n = sandbox[CARD_VARS[id]].length;
    chk(cards[i].querySelector('.library-card-count').textContent === n + ' ' + CARD_UNITS[id],
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
  // 用户要求删掉「输入篇名、作者或诗句，即可搜遍六部集子」这段文字：
  // 空列表**一个字都不显示**（视觉上只剩一段留白，见 css/classic.css 的
  // `#gw-list .empty[data-empty="idle"]`）。
  // 这里守两层：
  //   ① 节点仍在、且被标成 idle —— 它是列表容器的状态位，清空后还要能被替换；
  //   ② 文本里**不能**出现那句已撤的引导语，也**不能**是「没有找到匹配的篇目」
  //      （后者只在「输入过但没命中」时才允许出现）。
  const idleEmpty = d.querySelector('#gw-list .empty');
  chk(!!idleEmpty && idleEmpty.dataset.empty === 'idle',
    '空列表的 .empty 被标成 idle（没输入关键词）');
  chk(idleEmpty.textContent.trim() === '',
    '没输入时列表里**不显示**任何引导文字（那段「输入篇名、作者或诗句…」已撤，实际「' +
    idleEmpty.textContent.trim() + '」）');
  chk(!/输入篇名、作者或诗句/.test(d.querySelector('#gw-list').textContent) &&
    !/没有找到匹配的篇目/.test(d.querySelector('#gw-list').textContent),
    '空列表现场既没有旧的引导语，也没有误报「没有找到匹配的篇目」');
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

  // 搜正文 / 译文（只有正文命中才说明「搜遍全站」是真的（六部各抽一篇））
  type('先天下之忧而忧');
  await sleep(30);
  const byBody = [...d.querySelectorAll('#gw-list .item')];
  chk(byBody.length > 0, '按译文原句「先天下之忧而忧」也能搜到（' + byBody.length + ' 条）');
  chk(byBody.some(el => el.dataset.id === 'guwen-gwj-114'),
    '搜到的是《岳阳楼记》（guwen-gwj-114）');

  // 六部都要「搜得进正文」—— 尤其昭明文选：它是最后加的一部，也是唯一
  // 一部「一部集子里同时有诗、又有散文」的，句型与其余五部都不同。
  // 抽它的一篇正文原句，确认这一部的语料确实进了搜索索引。
  // 抽一句**只在昭明这一篇里出现**的原文（取 10 个连续汉字，去库里确认唯一），
  // 否则「多处命中」会让结果列表里未必列得到这一条 —— 那是抽样问题，不是覆盖问题。
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

  // 候选右侧那一行**按有哪栏排哪栏**：昭明文选的 145 条题署只有作者的字、
  // 朝代留空（见 data/poems-zhaoming.js 文件头），朝代一空不能渲染成
  // 「 · 徐陵」这种以分隔符开头的残句。
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

  // 结果列表里也不该出现「· 佚名」这类残句
  const zmMeta = [...d.querySelectorAll('#gw-list .item')]
    .filter(el => el.dataset.id.indexOf('zhaoming-') === 0)
    .map(el => el.querySelector('.item-meta').textContent);
  chk(zmMeta.length > 0 && zmMeta.every(t => !/^\s*·/.test(t) && t.indexOf('··') < 0),
    '结果列表里留空朝代的条目也没有残句（' + zmMeta.length + ' 条）');

  type('月');
  await sleep(30);
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
  const emptyAfter = d.querySelector('#gw-list .empty');
  chk(!!emptyAfter && emptyAfter.dataset.empty === 'idle' &&
    emptyAfter.textContent.trim() === '',
    '空列表又回到「不写字」的 idle 空态（不是停在「没有找到匹配的篇目」上）');
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
  // ⚠️ 样式断言一律拿**剥掉注释**的正文来判：
  //    本仓库的 CSS 注释里大量引用旧写法（「上一版是 scaleY(1.3)」这类），
  //    直接对整张表做正则会命中说明文字，把已经改对的东西判成没改。
  const cssCode = classicCss.replace(/\/\*[\s\S]*?\*\//g, ' ');
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
  // 2026 这一版：搜索框「增高」改成**真实高度**（52px，不再用 scaleY 拉伸绘制层），
  // 于是布局高度与视觉高度一致，半盒高就是 26px。
  const heroMid = /--hero-box-h:\s*52px/.test(classicCss);
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
  // ① 搜索框增高：走**真实高度**，不再用 transform 拉伸
  //    （拉伸会把 12px 的圆角压成椭圆、把提示字纵向拉长 —— 用户反馈的
  //      「四个圆角不太正常 / placeholder 有点压扁」正是它）
  chk(!/transform:\s*scaleY/.test(cssCode),
    '全站不再用 scaleY 在绘制层拉伸任何控件（圆角与字形都不再被压扁）');
  chk(/\.search-hero \.search-toolbar \{[^}]*--toolbar-h:\s*52px/.test(classicCss) ||
    /\.search-hero \.search-input \{[^}]*--toolbar-h:\s*52px/.test(classicCss),
    '搜索页把工具栏行高覆写为 52px（搜索框的真实高度，只对本页生效）');
  chk(!/(?:^|\n)\.search-input\s*\{[^}]*height:\s*5[0-9]px/.test(classicCss),
    '增高只发生在搜索页：全站的 .search-input 高度仍走 --toolbar-h（索引页那一排不许跟着长）');
  // 圆角必须仍是同一个变量：四个角就是同一个半径的圆弧，没有被单独拉伸过
  chk(/\.search-hero \.search-input\s*\{[^}]*border-radius:\s*var\(--radius-sm\)/.test(classicCss) ||
    /(?:^|\n)\.search-input \{[^}]*border-radius:\s*var\(--radius-sm\)/.test(classicCss),
    '搜索页搜索框的圆角仍是 var(--radius-sm) 一个值（四个角同半径，不再是椭圆角）');
  chk(!/\.search-hero \.search-input\s*\{[^}]*border-radius:\s*[^;}]*(\/|px)/.test(classicCss),
    '没有给搜索页的搜索框单独写「横 / 竖两个半径」的圆角（那正是椭圆角的写法）');
  chk(/\.search-hero \.search-input::placeholder \{[^}]*transform:\s*none/.test(classicCss),
    '提示字不再需要位移补偿（框不拉伸了，字落在同一条基线上）');
  // ② 候选下拉贴住搜索框 / 不透明度 / 层级
  chk(/\.suggest \{[^}]*top:\s*calc\(100% \+ 4px\)/.test(classicCss),
    '候选下拉只留 4px 间隙（用户反馈的「离搜索框太远」的反面）');
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
  chk(/keyboardVisible/.test(searchJs) && /--kb-visible/.test(searchJs),
    'js/search.js 把 visualViewport.height 实测成 --kb-visible' +
    '（键盘上沿那片可视区：下拉的百分数与硬边界都按它算，不再靠 svh 猜）');
  chk(/focusInput/.test(searchJs) && /search-hero-focus/.test(searchHtml),
    '进页即聚焦：焦点先落在 hero 里的替身输入框上（键盘应声弹出，且不触发 iOS 自行滚动）');
  const ghostBlock = (/[^}]*\.search-hero-focus \{([^}]*)\}/.exec(classicCss) || ['', ''])[1];
  chk(!!ghostBlock && /width:\s*1px/.test(ghostBlock) && /height:\s*1px/.test(ghostBlock) &&
    !/display:\s*none|visibility:\s*hidden|opacity:\s*0/.test(ghostBlock),
    '替身输入框是一枚真的 1×1 输入框（display: none / visibility: hidden 的元素' +
    '拿不到焦点，iOS 就不会弹键盘）');
  chk(/alignEmptyState/.test(searchJs) && /#gw-list \.search-empty/.test(classicCss),
    '空态与结果列表左对齐（搜索框在左、列表也在左，空态不该孤零零居中在页面中间）');

  /* ---------- 七之三、这一轮的三条机上反馈（Issue #69 后续·再续）----------
     用户在机上又提了三件事，逐条落到源码层面各守一道：
       ① 搜索框四个圆角不正常、placeholder 压扁 → 增高不再用 scaleY 拉伸；
       ② 「输入篇名、作者或诗句，即可搜遍六部集子」这段删掉 → 空态不写字；
       ③ 下拉下面几条被键盘盖住 + 要能关掉下拉去点结果卡片 → 高度三重约束。
     真正量渲染后盒子的是 test/pwa.test.js，这里守的是「改动依赖哪一组关系」。 */

  // ① 圆角与字形：见上面「增高走真实高度」那几条 —— 再补一道「圆角不被单侧拉伸」的防线。
  //    椭圆角的写法是 `border-radius: 12px / 15.6px` 或 `border-radius: 12px 12px`，
  //    两者都出现在横 / 竖半径分开给的场合；这里确认搜索页没有这类声明。
  const heroInputBlock = (/\.search-hero \.search-input \{([^}]*)\}/.exec(cssCode) || ['', ''])[1];
  chk(!/border-radius:[^;}]*\//.test(heroInputBlock),
    '搜索页搜索框没有「横半径 / 竖半径」两个值的圆角（那是椭圆角）');
  chk(!/scaleY|rotateX/.test(heroInputBlock),
    '搜索页搜索框不在绘制层做纵向量变（圆角与字形都不再被压扁）');

  // ② 空态不写字：JS 侧「没输入时不写文案」+ CSS 侧「idle 那一支不显示文字」
  chk(/data-empty/.test(searchJs) && /EMPTY_MISS/.test(searchJs),
    'js/search.js 用 data-empty 区分两种空态（idle 不写字、miss 才报「没找到」）');
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

  // ③ 下拉的高度：三重约束（400px / 可视区的四成 / 键盘上沿）
  const suggestBlock = (/(?:^|\n)\.suggest \{([^}]*)\}/.exec(cssCode) || ['', ''])[1];
  chk(/max-height:\s*min\(/.test(suggestBlock),
    '候选下拉的高度用 min() 取三项里最小者（不是一个写死的高度）');
  // ⚠️ 口径修正（本轮，修 CI 红）：百分比那一项不再用 svh ——
  //    svh 量的是「视口最小时的高度」，它**不认软键盘**（键盘是覆盖层，不改视口），
  //    在部分内核 / 无头环境里甚至与 vh 相等（实测都是 852）。
  //    于是「可视区的四成 / 六成」在键盘弹着时按整屏算，候选下拉一路铺到键盘上沿，
  //    把下方的结果卡片全吃掉（正是用户反馈的后半句）。
  //    现在两项都改按 JS 实测的可视区（--kb-visible）算：
  //      · 百分数项 calc(var(--kb-visible, 100vh) * 0.6 / 0.4)
  //      · 硬边界 calc(var(--kb-visible, 100vh) - 86px)
  //    --kb-visible 由 js/search.js 的 keyboardVisible() 写（visualViewport.height），
  //    没有键盘时就是整屏，键盘弹起时就是键盘上沿。
  chk(/400px/.test(suggestBlock) && /--kb-visible/.test(suggestBlock) &&
    /\*\s*0\.6\b/.test(suggestBlock) && /-\s*86px/.test(suggestBlock),
    '三项分别是：8 条候选的上限 400px、可视区的六成（给结果卡片留地方）、' +
    '可视区 − 86px（硬边界，绝不伸到键盘底下）——' +
    '后两项按 JS 实测的 --kb-visible 算，不用 svh（svh 不认软键盘）');
  const suggestNarrow = (/@media screen and \(max-width: 700px\) \{\s*\.suggest \{([^}]*)\}/.exec(cssCode) || ['', ''])[1];
  chk(/\*\s*0\.4\b/.test(suggestNarrow) && /--kb-visible/.test(suggestNarrow),
    '手机上候选只占可视区四成（键盘弹着时更要紧：下拉下面那几成就是结果卡片）');

  // 下拉可滚动：条数被限住之后，剩下的要靠滚动看，滚动位置每次换关键词都回到顶部
  chk(/overflow-y:\s*auto/.test(suggestBlock) && /box\.scrollTop = 0/.test(searchJs),
    '候选下拉可滚动，且每换一次关键词回到顶部（新关键词的第一条不能停在中间）');
  // ④ 「怎么把下拉关掉」不能只留 Escape / 退输入 / blur 三条触屏上会落空的路：
  //     滚结果列表 → 收；点结果区 → 先收且不穿过去开篇
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
  // 候选的「最多 8 条」是结果集的口径（SUGGEST_MAX），不是高度公式推出来的：
  // 高度受限时靠滚动看全，而不是悄悄少给几条
  chk(/SUGGEST_MAX\s*=\s*8/.test(searchJs),
    '候选最多 8 条仍是结果集的口径（限高只影响「一次看得见几条」，不影响「给几条」）');

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
