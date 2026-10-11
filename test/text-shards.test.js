// 正文分片按需加载（Issue #550）
//
// 症状与边界：正文主表按集子切成 15 片之后，页面可以只引壳、用到再取片。
// 这条路有两个必须守的点，错了都不报错、只表现为「正文空白 / 列表短一截」：
//
//   ① 片后到，取数入口 `masterTextOf` 的 byId 索引必须跟着作废
//      （`textMasterAdd` → `textMasterReset`），否则后到的片永远查不到；
//   ② 片后到必须重建 `SITE_INDEX` —— `data/site-index.js` 装配时会丢掉
//      「正文 / 译文为空」的条目（古文、古文观止那一批），片没到就装配，
//      这些条目根本不在索引里。
//
// 这一层就守这两条，外加「同一片不重复取」「失败可重试」。
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* 起一个够用的沙盒：只装「取片」要用的那几件。 */
function makeSandbox() {
  const sb = { console };
  sb.window = sb;
  sb.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  sb.setTimeout = () => 0;
  sb.clearTimeout = () => {};
  vm.createContext(sb);
  return sb;
}

function uniq(a) { return Object.keys(a.reduce(function (o, x) { o[x] = 1; return o; }, {})); }

/* 本页引的 data/*.js（按页面次序；正文片已经摘掉，剩下的就是壳与索引）。 */
function dataScriptsOf(htmlFile) {
  const src = read(htmlFile);
  return [...src.matchAll(/<script src="(data\/[^"]+\.js)"><\/script>/g)].map(m => m[1]);
}

/* ------------------------------------------------------------------
   1 · 页面上不再同步引正文片（省下来的就是那几 MB）
   ------------------------------------------------------------------ */
['search/index.html', 'library/index.html'].forEach(function (f) {
  const src = read(f);
  const shards = [...src.matchAll(/<script src="data\/text-master\/([a-z-]+)\.js"><\/script>/g)];
  chk(shards.length === 0, f + ' 不再同步引正文片（实际 ' + shards.length + ' 片）');
  chk(/<script src="js\/text-shards\.js"><\/script>/.test(src), f + ' 引了 js/text-shards.js');
  chk(/<script src="data\/text-master\.js"><\/script>/.test(src), f + ' 仍引取数入口 data/text-master.js');
});

/* ------------------------------------------------------------------
   2 · 分片清单与落盘的片一一对应
   ------------------------------------------------------------------ */
{
  const sb = makeSandbox();
  vm.runInContext(read('data/text-master.js'), sb, { filename: 'data/text-master.js' });
  const books = sb.TEXT_SHARD_BOOKS || [];
  const onDisk = fs.readdirSync(path.join(ROOT, 'data/text-master'))
    .filter(f => /\.js$/.test(f)).map(f => f.replace(/\.js$/, '')).sort();
  chk(books.length > 0, 'TEXT_SHARD_BOOKS 非空（' + books.length + ' 片）');
  chk(JSON.stringify(books.slice().sort()) === JSON.stringify(onDisk),
    'TEXT_SHARD_BOOKS 与 data/text-master/ 下实际落盘的片一一对应');
}

/* ------------------------------------------------------------------
   3 · 片后到：取数字入口跟着作废（不重建就是永久空白）
   ------------------------------------------------------------------ */
{
  const sb = makeSandbox();
  vm.runInContext(read('data/text-master.js'), sb, { filename: 'data/text-master.js' });
  sb.POEMS_MINGSHU = [{ id: 'ms-227', title: '世说新语', textRef: 'mingshu-ms-227' }];

  const before = sb.masterTextOf(sb.POEMS_MINGSHU[0], 'mingshu');
  chk(!before.text, '片未到：带 textRef 的条目取不到正文（原样返回）');

  vm.runInContext(read('data/text-master/mingshu.js'), sb, { filename: 'mingshu' });
  const after = sb.masterTextOf(sb.POEMS_MINGSHU[0], 'mingshu');
  chk(!!after.text && after.text.length > 100,
    '片到后：同一条目取得到正文（索引已作废重建），长度 ' + (after.text || '').length);
  chk((sb.TEXT_MASTER || []).length > 0, '片到后并进了 window.TEXT_MASTER');
}

/* ------------------------------------------------------------------
   4 · 片后到：SITE_INDEX 必须重建（否则条目静默变少）
   ------------------------------------------------------------------ */
{
  const sb = makeSandbox();
  sb.document = { readyState: 'complete', addEventListener() {} };
  sb.navigator = { userAgent: 'node' };
  // 页面上引的全部 data/*.js，按真页面的次序走一遍
  dataScriptsOf('search/index.html')
    .forEach(f => vm.runInContext(read(f), sb, { filename: f }));

  const before = sb.SITE_INDEX.length && sb.SITE_INDEX.filter(p => !p.isBook).length;

  const searchBooks = uniq(sb.SITE_INDEX.map(p => p.book));
  chk(searchBooks.length === 10, '搜索页收 10 部集子（与页面引的壳一致，实际 ' + searchBooks.length + '）');

  searchBooks.forEach(b => {
    if (!fs.existsSync(path.join(ROOT, 'data/text-master/' + b + '.js'))) return;
    vm.runInContext(read('data/text-master/' + b + '.js'), sb, { filename: b });
  });
  const after = sb.buildSiteIndex().filter(p => !p.isBook).length;

  chk(after > before,
    '片到后重建索引：条目从 ' + before + ' 涨到 ' + after + '（片没到时那批「无正文」的条目是被装配丢掉的）');
}

/* ------------------------------------------------------------------
   5 · 加载层：同片只取一次、失败可重试、绝不假装有正文
   ------------------------------------------------------------------ */
{
  const sb = makeSandbox();
  vm.runInContext(read('data/text-master.js'), sb, { filename: 'data/text-master.js' });
  vm.runInContext(read('data/text-master/poems.js'), sb, { filename: 'poems' });
  vm.runInContext(read('js/text-shards.js'), sb, { filename: 'js/text-shards.js' });

  const calls = [];
  sb.fetch = function (url) {
    calls.push(url);
    const p = url.replace(/^\//, '');
    const ok = fs.existsSync(path.join(ROOT, p));
    return Promise.resolve({
      ok: ok, status: ok ? 200 : 404,
      text: () => Promise.resolve(ok ? read(p) : '')
    });
  };

  /* 片是不是「已到」，**不许从主表反推** —— 《唐诗》那一片里有跨部的行
     （id 是 poems-*、entries 里带 tangshi-*），反过来课内那一片也带着
     tangshi-* 的 entries。按 id 前缀猜，课内片一到就会把唐诗判成「已到」，
     唐诗那几百条正文的搜索静默少一批。所以只认显式声明（mark）。 */
  chk(!sb.TextShards.loaded('poems'),
    '不靠主表反推「已到」：只同步引了 poems 的片，未 mark 时判为未到');
  sb.TextShards.mark('poems');
  chk(sb.TextShards.loaded('poems'), 'mark() 之后判为已到');

  sb.TextShards.need('poems').then(function () {
    chk(calls.length === 0, '已声明引过的片不再 fetch（实际 ' + calls.length + ' 次）');

    // 这一片本层没取过、也没声明过，并发取两次
    const p1 = sb.TextShards.need('tangshi');
    const p2 = sb.TextShards.need('tangshi');
    chk(calls.filter(u => /tangshi/.test(u)).length === 1, '同一片并发只取一次（实际 ' +
      calls.filter(u => /tangshi/.test(u)).length + ' 次）');
    return Promise.all([p1, p2]);
  }).then(function () {
    chk(sb.TextShards.loaded('tangshi'), '取回来的片记成「已到」');

    return sb.TextShards.need('__nope__');
  }).catch(function (err) {
    chk(/加载失败/.test(err.message), '取不到的片如实抛错，不假装成功');
    chk(sb.TextShards.loaded('__nope__') === false, '失败的片不记成「已到」（下次还能重试）');
    return true;
  }).then(function () {
    // ── 不是「集子」的会话不许当成片的主人（Issue #480 追问）────────────
    //
    // 用户报的病：
    //   「作者索引页没在 近现代 看到 陈毅，数据库里是有他的作品的……
    //     是不是有其他作者也有类似的被遗漏？」
    //
    // 名册那边是**装配时机**（另见 test/authors.test.js）。这里守的是同一条
    // 链上的第二处：`shardOf()` 原来对清单里找不到的 id 走
    // `return bookId` 兜底，于是 `mount()` 里
    // `TextShards.loaded("authors")` 永远为假、作者详情页一直挂不上。
    // 判据改成「只在 SITE_BOOKS_DEF 里真有这个 id 时才算片的主人」。
    const coreSrc = read('js/reader-core.js');
    const shardFn = (coreSrc.match(/function shardOf\(bookId\) \{[\s\S]*?\n  \}/) || [''])[0];
    chk(!!shardFn, 'reader-core 里有 shardOf()');
    chk(!/return bookId;\s*\n  \}/.test(shardFn),
      'shardOf() 不再拿「不在清单里就当成片名」兜底（它就是 authors 挂不上的原因）');
    chk(/defs\[i\]\.id === bookId/.test(shardFn),
      'shardOf() 认 SITE_BOOKS_DEF 里真有的那个 id');

    // 数据层再核一遍：清单里没有 "authors"，所以它不再被当成片
    const defs = (sb.SITE_BOOKS_DEF || []);
    chk(!defs.some(function (d) { return d.id === 'authors'; }),
      '集子清单里没有 authors（它本来就不是一部集子）');
    chk(sb.TextShards.loaded('authors') === false,
      'TextShards 不认 authors 这一片（原来它永远「没到」，页面就一直挂不上）');

    chk(fails === 0, '分片加载层全部通过');
    console.log('');
    if (fails) { console.log('✗ 分片按需加载测试失败 ' + fails + ' 项'); process.exit(1); }
    console.log('🎉 正文分片按需加载测试全部通过');
  });
}
