// 按需取片：两处「取了不该取的片」与「该取的片没取」（Issue #554）
//
// 用户原话：
//   「搜索页 → 作者索引 → 选择 先秦 → 选择 曾子 现在干脆进不去曾子页面了」
//
// 病根不在数据 —— `classic-gw-69`《大学之道》的正文与译文都在主表里，
// `曾子` 名下就这一条。病在 Issue #550 加的那道「片没到就先取再挂」的口子：
//
//   ① `shardOf(cfg.id)` 把**认不出的 id 原样回传**，而作者索引那条会话的
//      id 是 `authors`（`js/authors.js` 的 `mountConfig`）—— 它压根不是集子。
//      于是 `mount` 去取 `data/text-master/authors.js`，404；
//      拒绝分支里「不挂」，页面一动不动、也不报错。
//   ② 课内那一课用 `<script src="data/text-master/poems.js">` **同步引**了
//      那一片，页面里没有一句 `TextShards` 的声明；而 `books()` 返回的是
//      `TEXT_SHARD_BOOKS` 全量，`js/search.js` 只对「本页引了壳」的部取片，
//      search 页引了 `POEMS_ALL`（课内的壳）—— 两边一凑，课内那一片
//      永远不在取片清单里：搜正文搜不到课内篇目，界面上看不出差。
//
// 这一层就守这几条（界面层已按 Issue #278 删除，所以做数据 + 源码判据）。
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* 起一个只装「页面上引的 data/*.js」的沙盒：壳、索引、集子清单都按真次序走。 */
function shellSandbox(htmlFile) {
  const sb = { console };
  sb.window = sb;
  sb.document = { readyState: 'complete', addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } };
  vm.createContext(sb);
  const src = read(htmlFile);
  [...src.matchAll(/<script src="(data\/[^"]+\.js)"><\/script>/g)]
    .map(m => m[1])
    .forEach(f => vm.runInContext(read(f), sb, { filename: f }));
  vm.runInContext(read('js/text-shards.js'), sb, { filename: 'js/text-shards.js' });
  return sb;
}

/* ------------------------------------------------------------------
   1 · 认不出的会话 id 不许去取片（哪怕它「像」一个集子 id）
   ------------------------------------------------------------------ */
{
  const coreSrc = read('js/reader-core.js');

  /* shardOf 的末了那一句是 `return bookId;`（原样回传）—— 认不出来的 id
     因此变成了一次 404 的取片请求。这一句是那条 404 的唯一来源。 */
  chk(/if \(!bookId\) return "";/.test(coreSrc), 'shardOf() 空 id 回空串');
  chk(!/return bookId;\s*\n\s*\}/.test(coreSrc),
    'shardOf() 不把认不出的 id 原样回传 —— 那等于宣布「这一片本页没有」，取它必然 404');

  /* mount 里那道口子只对「认得出来的集子 id」开。 */
  chk(/var shard = shardOf\(cfg\.id\);\s*\n\s*if \(shard && window\.TextShards/.test(coreSrc),
    'mount() 只对 shardOf 认得出来的 cfg.id 取片');

  /* 作者索引那条会话的 id 就是 `authors`，它不是集子 —— 与上面的判据一起，
     这一条钉住「点谁都没反应」那个病不会再回来。 */
  const authorsSrc = read('js/authors.js');
  chk(/id: "authors"/.test(authorsSrc),
    '作者索引会话的 id 仍是 "authors"（它不在集子清单里，故不归任何一片）');
}

/* ------------------------------------------------------------------
   2 · 该取的片：课内那一片（页面同步引过，页面里没有声明）
   ------------------------------------------------------------------ */
{
  const sb = shellSandbox('search/index.html');

  /* `books()` 是「片清单 ∩（varName 真有值的那些壳）」—— 课内那一片正是
     靠这一条回来的：search 页引了 `POEMS_ALL`，页面里一个字都没声明。 */
  const books = sb.TextShards.books();
  const shells = sb.TextShards.shellBooks();

  chk(books.indexOf('poems') >= 0,
    '课内那一片（poems）在自己的壳被引了就进清单 —— 页面没声明也认（实际：' + books.join(',') + '）');
  chk(shells.indexOf('poems') >= 0 && shells.indexOf('zhaoming') >= 0,
    'shellBooks() 认得本页真引了的壳（按 varName 判，不按 id 反查片名）');

  const onDisk = fs.readdirSync(path.join(ROOT, 'data/text-master'))
    .filter(f => /\.js$/.test(f)).map(f => f.replace(/\.js$/, ''));
  chk(books.every(b => onDisk.indexOf(b) >= 0),
    'books() 给出的每一片都在 data/text-master/ 下落着盘（不会取到不存在的文件）');

  /* ⚠️ 两处名字不是一回事：片名是正文分片的片名（mingren / dwang），
     集子 id 是页面上那一部（mingren-waiguo，refPrefix 才是片名）。
     按 id 反查片清单，外国那两卷会被判成「本页没有它的片」而不取 ——
     点进《名家「外国」》就永远挂着不显示。
     ⚠️ 这两卷的壳在 library 页（search 页不收人物那几部），所以这一条
     在 library 的沙盒里判。 */
  const lib = shellSandbox('library/index.html');
  const libShells = lib.TextShards.shellBooks();
  chk(libShells.indexOf('mingren') >= 0 && libShells.indexOf('mingren-waiguo') < 0,
    'shellBooks() 给出的是**片名**（mingren），不是集子 id（mingren-waiguo）');
  chk(libShells.indexOf('dwang') >= 0 && libShells.indexOf('dwang-waiguo') < 0,
    '帝王那两卷同理（片名 dwang，集子 id dwang-waiguo）');
  chk(lib.TextShards.books().length === lib.TextShards.books().filter(function (b, i, a) {
    return a.indexOf(b) === i;
  }).length, 'books() 里没有重复的片名（两卷同一片只算一次）');
}

/* ------------------------------------------------------------------
   3 · library 那一页仍是「全取」—— 它按部点开，不是按会话挂
   ------------------------------------------------------------------ */
{
  const libSrc = read('js/library.js');
  chk(/T\.needAll\(\)/.test(libSrc), 'library 仍用 needAll() 全取 15 片（那一页按部点开）');
}

/* ------------------------------------------------------------------
   4 · 正文落空：片到了要把「攥着旧索引」的那几处一起重装配
   ------------------------------------------------------------------ */
{
  const sb = shellSandbox('search/index.html');
  vm.runInContext(read('js/dom.js'), sb, { filename: 'js/dom.js' });

  /* 片没到就装配：`SITE_INDEX` 里这一条没有正文（`data/site-index.js` 对
     古文那几部会连条目一起丢掉，这里只取「留下但正文空」的那一种）。 */
  sb.SITE_INDEX = [
    { id: 'classic-gw-69', originId: 'gw-69', title: '大学之道', author: '曾子',
      dynasty: '先秦', source: '《大学》', book: 'classic', bookName: '古文',
      text: '', translation: '' }
  ];
  sb.WORKS_GROUPS = [];
  vm.runInContext(read('data/works-map.js'), sb, { filename: 'data/works-map.js' });
  vm.runInContext(read('data/works-index.js'), sb, { filename: 'data/works-index.js' });

  vm.runInContext(read('js/text-shards.js'), sb, { filename: 'js/text-shards.js' });
  vm.runInContext(read('data/author-index.js'), sb, { filename: 'data/author-index.js' });

  chk(!!sb.AuthorIndex.byName('曾子'), '片没到也成表：名册里有「曾子」那一格');
  chk((sb.AuthorIndex.itemsOf('曾子')[0].text || '').length === 0,
    '片没到时那一条的正文是空的（此刻空是如实的，不是错）');

  /* 片后到，重装配（`rebuildIndex` 的顺序：索引 → 判重表 → 名册）。 */
  vm.runInContext(read('data/text-master/classic.js'), sb, { filename: 'classic' });
  sb.SITE_INDEX = sb.buildSiteIndex();
  sb.rebuildSiteTables();

  const item = sb.AuthorIndex.itemsOf('曾子')[0];
  chk(!!item && (item.text || '').length > 50,
    '重装配之后名册那一条取得到正文（长度 ' + (item ? (item.text || '').length : 0) + '）');
  chk(!!item && (item.translation || '').length > 50,
    '译文同样取得回来（长度 ' + (item ? (item.translation || '').length : 0) + '）');

  /* ⚠️ 归堆只认 author / dynasty：重装配前后人数与条数不许变。 */
  const before = sb.AuthorIndex.total();
  sb.rebuildSiteTables();
  chk(sb.AuthorIndex.total() === before,
    '重装配不改变人数（' + before + ' → ' + sb.AuthorIndex.total() + '）');
}

console.log('');
console.log(fails ? '❌ 按需取片的片名测试失败 ' + fails + ' 项' : '🎉 按需取片的片名测试全部通过');
process.exit(fails ? 1 : 0);
