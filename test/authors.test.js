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
  'data/poems-songci.js', 'data/poems-guwen.js', 'data/poems-zhaoming.js', 'data/poems-yuanqu.js',
  'data/poems-jinxiandai.js', 'data/poems-chengyu.js', 'data/poems-changshi.js',
  'data/poems-mingshu.js', 'data/poems-mingren-cn.js', 'data/poems-mingren-foreign.js',
  'data/poems-emperor-cn.js', 'data/poems-emperor-waiguo.js',
  'data/site-books.js', 'data/site-index.js', 'data/works-map.js', 'data/works-index.js'
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

const authorsHtml = read('authors/index.html');
chk(fs.existsSync(path.join(root, 'authors/index.html')), '/authors/ 页面在');
chk(authorsHtml.indexOf('js/authors.js') >= 0, '/authors/ 引了 js/authors.js');

const searchHtml = read('search/index.html');
chk(searchHtml.indexOf('/authors/') >= 0, '搜索页有作者索引入口');

const libHtml = read('library/index.html');
const libJs = read('js/library.js');
chk(libHtml.indexOf('/authors/') < 0 && libJs.indexOf('/authors/') < 0,
  '课外阅读集子页（/library/）没有作者索引入口');

const chromeSrc = read('js/chrome.js');
chk(/authors:\s*"\/authors\/"/.test(chromeSrc), 'chrome.js 注册了 /authors/ 路由');
chk(/if \(key === "authors"\) return "search";/.test(chromeSrc),
  '作者索引在底栏高亮「搜索」（挂在搜索下，不单开一格）');

console.log('');
console.log(fails ? '❌ 作者索引测试失败 ' + fails + ' 项' : '🎉 作者索引测试全部通过');
process.exit(fails ? 1 : 0);
