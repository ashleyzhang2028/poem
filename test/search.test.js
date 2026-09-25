// Issue #278：页面层（jsdom 真跑搜索页 / 入口页 / 真浏览器量样式）已删除，只留数据层与接线口径。
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
   'data/poems-songci.js', 'data/poems-yuefu.js', 'data/poems-guwen.js', 'data/poems-zhaoming.js',
   'data/poems-yuanqu.js', 'data/poems-jinxiandai.js',
   'data/site-index.js', 'data/works-map.js', 'data/works-index.js']);

  const IDX = sandbox.SITE_INDEX;

  const books = [
    resolve(sandbox, sandbox.POEMS_CLASSIC, 'classic'),
    resolve(sandbox, sandbox.POEMS_YUEFU, 'yuefu'),
    resolve(sandbox, sandbox.POEMS_TANGSHI, 'tangshi'),
    resolve(sandbox, sandbox.POEMS_SONGCI, 'songci'),
    resolve(sandbox, sandbox.POEMS_YUANQU, 'yuanqu'),
    resolve(sandbox, sandbox.POEMS_GUWEN, 'guwen'),
    resolve(sandbox, sandbox.POEMS_ZHAOMING, 'zhaoming'),
    resolve(sandbox, sandbox.POEMS_JINXIANDAI, 'jinxiandai')
  ];
  const BOOK_IDS = ['classic', 'yuefu', 'tangshi', 'songci', 'yuanqu', 'guwen', 'jinxiandai', 'zhaoming'];

  const zmIndexed = books[6].filter(p => p.text && p.translation).length;

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

// ---------------------------------------------------------------------------
// Issue #278：这一层的**页面层**（jsdom 起搜索页 / 课外阅读入口页、敲字筛
// 候选、就地叠层、真浏览器量样式，以及成篇的界面文案断言）整段删除。
// 留下的是数据层：全站总索引的形状（九部各有一条、id 前缀、部名与地址），
// 以及搜索页/入口页脚本与预缓存清单这类**功能接线**的口径。
// ---------------------------------------------------------------------------

  // 入口页必须给每部集子留着自己的页面地址（就地叠层之外，直接访问 / 中键
  // 新开仍可用）—— 这是功能口径，不是外观，所以留着。
  const libSrcForPages = read('js/library.js');
  const bookPages = { classic: '/classic/', yuefu: '/yuefu/', tangshi: '/tangshi/', songci: '/songci/',
    yuanqu: '/yuanqu/', guwen: '/guwen/', zhaoming: '/zhaoming/' };
  const missingPage = Object.keys(bookPages).filter(id =>
    libSrcForPages.indexOf('page: "' + bookPages[id] + '"') < 0);
  chk(missingPage.length === 0,
    '就地打开的各部也各自留着自己的页面地址（直接访问 / 中键新开仍可用；缺 ' +
    (missingPage.join('/') || '无') + '）');
  const libJs = read('js/library.js');
  const orderInJs = (libJs.match(/id:\s*"([a-z]+)"/g) || [])
    .map(x => x.match(/id:\s*"([a-z]+)"/)[1]);
  chk(orderInJs.slice(0, 9).join('/') ===
      'poems/classic/yuefu/tangshi/songci/yuanqu/guwen/jinxiandai/zhaoming',
    '九部的顺序以课内为首、乐府在唐诗前、元曲在宋词后、昭明与近现代在后' +
    '（顺序的唯一来源在 js/library.js，Issue #244；实际 ' + orderInJs.slice(0, 9).join('/') + '）');

  const swVer = (/poem-app-v(\d+)/.exec(read('sw.js')) || [])[1];
  chk(Number(swVer) >= 41, 'sw.js 缓存版本不低于 v41（实际 v' + swVer + '）');
  ['./search/', './js/search.js', './library/', './js/library.js'].forEach(needle => {
    chk(read('sw.js').indexOf('"' + needle + '"') >= 0, 'sw.js 预缓存含 "' + needle + '"');
  });
  chk(read('search/index.html').indexOf('js/search.js') >= 0, '搜索页加载了 js/search.js');
  chk(read('library/index.html').indexOf('js/library.js') >= 0, '入口页加载了 js/library.js');

  console.log('');
  console.log(fails === 0 ? '🎉 全站搜索与课外阅读入口（数据层）测试全部通过'
                          : '❌ 搜索页与导航变更测试 ' + fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
})();
