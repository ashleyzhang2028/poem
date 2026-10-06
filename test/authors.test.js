// 作者索引（Issue #480，用户 2026-10-06）
//
// 用户原话：
//   「我想把作者索引从搜索页进，而不是从课外阅读集子页进，可以吗？」
//
// 所以本测试守三件事：
//   ① 作者索引只在**搜索页**有入口（`/library/` 不许多一颗）；
//   ② 页面是 `/authors/`，底栏高亮归「搜索」；
//   ③ 索引只收文学作品的十部集子，不收词条式的（名家 / 帝王 / 常识 / 名著 / 成语），
//      且按朝代归一铺在同一条时间轴上。
//
// 界面测试层已按 Issue #278 删除，所以这里做**数据层 + 静态判据**（读源码 +
// vm 沙盒起真数据），不起浏览器。
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.join(__dirname, '..');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const sb = { window: {}, console, document: { readyState: 'complete', addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } } };
sb.window = sb;
vm.createContext(sb);

[
  'data/text-master.js',
  'data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js', 'data/poems-5.js',
  'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js', 'data/poems-9.js', 'data/poems-10.js',
  'data/poems-11.js', 'data/poems-12.js', 'data/index.js',
  'data/poems-classic.js', 'data/poems-yuefu.js', 'data/poems-tangshi.js', 'data/poems-gushi.js',
  'data/poems-songci.js', 'data/poems-guwen.js', 'data/poems-zhaoming.js', 'data/zhaoming-dynasty.js', 'data/poems-yuanqu.js',
  'data/poems-jinxiandai.js', 'data/poems-chengyu.js', 'data/poems-changshi.js',
  'data/poems-mingshu.js', 'data/poems-mingren-cn.js', 'data/poems-mingren-foreign.js',
  'data/poems-emperor-cn.js', 'data/poems-emperor-waiguo.js',
  'data/site-books.js', 'data/site-index.js', 'data/works-map.js', 'data/works-index.js',
  // 名册本身那一份（朝代归一表 + 异名表 + 收哪十部）—— `AuthorsPage.index()`
  // 要的那三张表就是它铺出来的（Issue #480 第二轮并入时补上）
  'data/author-index.js'
].forEach(f => vm.runInContext(read(f), sb, { filename: f }));

vm.runInContext(read('js/authors.js'), sb, { filename: 'js/authors.js' });
chk(!!(sb.AuthorsPage && sb.AuthorsPage.index), 'js/authors.js 挂出了 AuthorsPage.index()');

const idx = sb.AuthorsPage.index();
chk(idx.authors.length > 300, '作者索引成表（作者 ' + idx.authors.length + ' 位）');

const BOOKS_OF_WORKS = {};
idx.authors.forEach(a => a.works.forEach(w => { BOOKS_OF_WORKS[w.book] = (BOOKS_OF_WORKS[w.book] || 0) + 1; }));
const BAD = ['mingren', 'mingren-waiguo', 'dwang', 'dwang-waiguo', 'changshi', 'mingshu', 'chengyu'];
const leaked = BAD.filter(b => BOOKS_OF_WORKS[b]);
chk(leaked.length === 0, '词条式集子（名家 / 帝王 / 常识 / 名著 / 成语）不混进作者索引（泄漏：' + (leaked.join('、') || '无') + '）');

const WANT = ['poems', 'classic', 'yuefu', 'tangshi', 'gushi', 'songci', 'yuanqu', 'guwen', 'jinxiandai', 'zhaoming'];
const missing = WANT.filter(b => !BOOKS_OF_WORKS[b]);
chk(missing.length === 0, '文学作品十部都在（缺：' + (missing.join('、') || '无') + '）');

const keys = [];
idx.authors.forEach(a => { if (keys.indexOf(a.key) < 0) keys.push(a.key); });
chk(keys.join('>').indexOf('先秦>秦>汉>三国>晋') === 0,
  '朝代按时间轴排（前五段：' + keys.slice(0, 5).join(' / ') + '）');
chk(idx.byAuthor['李白'] && idx.byAuthor['李白'].key === '唐', '李白归一在「唐」');
chk(idx.byAuthor['曹植'] && idx.byAuthor['曹植'].key === '三国', '曹植（三国魏）归一在「三国」，不再落到唐');
chk(idx.byAuthor['曹植'].works.some(w => w.title === '七步诗' && w.book === 'gushi'),
  '曹植《七步诗》在作者索引里认得出，归属已归位到《古诗「非唐代」》');
chk(!idx.authors.some(a => !a.key), '没有作者掉出时间轴（朝代空的情况：'
  + (idx.authors.filter(a => !a.key).map(a => a.name).join('、') || '无') + '）');

const jys = idx.authors.filter(a => a.works.some(w => w.title === '静夜思' || w.title === '夜思'));
const jysCount = jys.reduce((n, a) => n + a.works.filter(w => w.title === '静夜思' || w.title === '夜思').length, 0);
chk(jysCount <= 1, '同一篇跨集重复只算一次（《静夜思》出现 ' + jysCount + ' 次）');

const searchHtml = read('search/index.html');
chk(/id="author-entry"/.test(searchHtml), '搜索页上有「作者索引」的入口（#author-entry）');
chk(/id="authors-index"/.test(searchHtml), '搜索页上有名册容器（#authors-index）');

// 名册那一层的阅读器列表与搜索页自己的命中列表是两个容器：
// 后者不归阅读器，前者归（这样「点作者 → 他的作品」才不会被搜索层抢走）
chk(/id="site-gw-list"/.test(searchHtml), '搜索页自己的命中列表是 #site-gw-list');
chk(/id="gw-list"/.test(searchHtml), '作者作品列表是阅读器的 #gw-list');

// ⚠️ 作者索引是 `/search/` 里的**一层**，不是另一个页面（Issue #480 第二轮）——
// `/authors/` 这个目录已经不存在，chrome 路由表里也不许再有它，
// 否则它会被认成顶层页、右上角顶一颗「返回课外阅读」的箭头。
chk(!fs.existsSync(path.join(root, 'authors/index.html')), '/authors/ 目录已撤（它不是一个页面）');
chk(searchHtml.indexOf('href="/authors/"') < 0, '搜索页的入口不是一条链去 /authors/ 的链接');

const libJs = read('js/library.js');
chk(libJs.indexOf('id: "authors"') < 0, '课外阅读的入口表里没有「作者索引」这一条');
chk(!/crossCardHtml/.test(libJs), '课外阅读不再为跨集子入口单开一张卡（crossCardHtml 已删）');
chk(read('css/classic.css').indexOf('library-cross') < 0, 'CSS 里那条 .library-cross 也删干净了');

const chromeSrc = read('js/chrome.js');
chk(!/authors:\s*"\/authors\/"/.test(chromeSrc), 'chrome 的路由表里没有 /authors/（它不是一个页面）');

// 入口那件事归 js/authors.js（搜索页那一层）
const authorsJs = read('js/authors.js');
chk(/bindEntry\(/.test(authorsJs), 'js/authors.js 里有入口绑定（bindEntry）');
chk(/setSearchLayer/.test(authorsJs), '名册展开时把搜索层收起来（setSearchLayer）');

// ── 搜索页 hero 里的搜索框与它的候选框（Issue #480 第二轮的两个回退）─────
//
// 用户 2026-10-06 报的两条：
//   「作者索引链接距离搜索框的距离过大了」
//   「自从有了作者索引链接，好像搜索框下拉列表不见了」
//
// 两条同源：那一轮往 hero 里添了「作者索引」入口条，顺手把 `#search-suggest`
// 从 hero 的搜索框搬去（新加的）作者层那颗 `#gw-search` 名下 —— 于是
//   ① 入口条的位置是另算的 `50% + boxH/2 + gap`，没算 `.toolbar` 那条全局
//      `margin-bottom: 12px`，缝从 10px 变成 22px；
//   ② js/search.js 的 `suggestBox()` 按 id 拿到的是作者层那一个，而它在
//      `[data-lib-view="author"][hidden]` 里 → 候选下拉永远看不见。
//
// 这里把两件事都钉住，免得下次再「顺手搬一下」。
const heroWrap = (searchHtml.match(/<div class="search-wrap" id="site-search-wrap">[\s\S]*?<\/div>/) || [''])[0];
chk(/id="site-search-suggest"/.test(heroWrap),
  'hero 那颗搜索框（#site-search-wrap）自带候选框 #site-search-suggest');

// 全页只有一个候选框，且它就是 js/search.js 认的那一个 —— 多一个同名 id
// 就会让 getElementById 拿到「另一颗搜索框的」那一个（正是这次的病根）。
const suggestIds = searchHtml.match(/id="[^"]*suggest[^"]*"/g) || [];
chk(suggestIds.length === 1 && suggestIds[0] === 'id="site-search-suggest"',
  '全页只有一个候选框，且 id 是 site-search-suggest（实际：' + suggestIds.join(', ') + '）');

const searchJsSrc = read('js/search.js');
chk(/getElementById\("site-search-suggest"\)/.test(searchJsSrc),
  'js/search.js 的 suggestBox() 认的是 hero 那颗搜索框的候选框');
chk(!/getElementById\("search-suggest"\)/.test(searchJsSrc),
  'suggestBox() 不再认旧 id search-suggest（那是作者层那颗搜索框的名下）');
chk(/aria-controls="site-search-suggest"/.test(searchHtml),
  '#site-search 的 aria-controls 指着它自己的候选框');

// 入口条的缝只由 --hero-gap 一处说了算：它必须是工具栏里的正常流，
// 不能再自己算一遍 `50% + boxH/2 + gap` 的定位（那正是 22px 的来源）。
const entryRule = (read('css/classic.css').match(/\.search-entry \{[\s\S]*?\}/) || [''])[0];
chk(/position:\s*static|margin-top:\s*var\(--hero-gap\)/.test(entryRule),
  '入口条在正常流里、缝取 --hero-gap（不再自算 50% + boxH/2 + gap）');
chk(!/calc\(50% \+ var\(--hero-box-h\)/.test(read('css/classic.css')),
  'CSS 里没有「50% + boxH/2」那种入口条定位（漏算 toolbar 下边距的就是它）');
chk(/\.search-hero \.search-toolbar \{[\s\S]*?margin-bottom:\s*0/.test(read('css/classic.css')),
  'hero 的工具栏归零了全局 .toolbar 那条 margin-bottom: 12px');

// 搜索页自己铺命中行，行的长相从 reader-core 借（不另画一套）
chk(/window\.ReaderList/.test(read('js/search.js')), '搜索页的行渲染借 window.ReaderList');
chk(/window\.ReaderList = \{/.test(read('js/reader-core.js')), 'reader-core 暴露了 ReaderList');
chk(/window\.ReaderSearch = \{/.test(read('js/reader-core.js')), 'reader-core 暴露了 ReaderSearch（按条开阅读器）');

console.log('');
console.log(fails ? '❌ 作者索引测试失败 ' + fails + ' 项' : '🎉 作者索引测试全部通过');
process.exit(fails ? 1 : 0);
