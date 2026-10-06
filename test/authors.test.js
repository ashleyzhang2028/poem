// 作者索引（Issue #480）
//
// 这一页卖的是「朝代 → 作者 → 作品」三级，所以守的也是这三件：
//   1. 朝代归一（二百多种写法收进同一条时间轴，同一朝不散成七八段）
//   2. 作者归并（班孟坚 = 班固；同一个人不许拆成两条）
//   3. 只有十部**作品**类集子进名册（名家 / 帝王 / 成语 / 常识 / 名著不进）
//
// 页面层（点击三级、返回一层退一层）按 Issue #278 由人点一遍，这里只守数据层。
const fs = require('fs');
const vm = require('vm');
const path = require('path');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };
const eq = (a, b, m) => chk(a === b, m + '（实际 ' + JSON.stringify(a) + '）');

const { loadData } = require('./master-env');

const DATA = [
  'data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js', 'data/poems-5.js',
  'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js', 'data/poems-9.js', 'data/poems-10.js',
  'data/poems-11.js', 'data/poems-12.js',
  'data/index.js', 'data/poems-classic.js', 'data/poems-yuefu.js', 'data/poems-tangshi.js',
  'data/poems-gushi.js', 'data/poems-songci.js', 'data/poems-yuanqu.js', 'data/poems-guwen.js',
  'data/poems-jinxiandai.js', 'data/poems-zhaoming.js', 'data/zhaoming-dynasty.js',
  'data/site-index.js', 'data/author-index.js'
];

const sb = { window: {}, console };
sb.window = sb;
vm.createContext(sb);
loadData(sb, DATA);

const AI = sb.AuthorIndex;
chk(!!AI, '作者索引数据层已挂上 window.AuthorIndex');

/* ── 一、只收十部作品类集子 ──────────────────────────────────────────── */
console.log('\n=== 一、名册里全是「作品」的作者，没有词条 ===');

const LIT = ['poems', 'classic', 'yuefu', 'tangshi', 'gushi', 'songci', 'yuanqu', 'guwen', 'jinxiandai', 'zhaoming'];
const litItems = sb.SITE_INDEX.filter(p => !p.isBook && LIT.indexOf(p.book) >= 0);
const idx = sb.SITE_INDEX.filter(p => !p.isBook);

// 十部里的作者数（不去重）应当 ≥ 名册人数 —— 名册只并、不凭空多出来
const litAuthors = new Set(litItems.map(p => String(p.author || '').trim()).filter(Boolean));
chk(AI.total() > 0 && AI.total() <= litAuthors.size + 1,
  '名册人数不超过十部的作者数（' + AI.total() + ' ≤ ' + litAuthors.size + '，+1 是给「礼记」这类书名让路）');

// 名册里不许出现只属于名家 / 帝王 / 成语 / 常识 / 名著的人
const OTHER = {};
idx.filter(p => LIT.indexOf(p.book) < 0).forEach(p => { OTHER[String(p.author || '').trim()] = true; });
const leaked = AI.people().filter(w => OTHER[w.name] && !litAuthors.has(w.name));
eq(leaked.map(w => w.name).join(','), '', '名家 / 帝王 / 成语 / 常识 / 名著里的名字一个都没漏进来');

// 作品数加起来应当正好等于十部的条目数（一条不多、一条不少）
const works = AI.people().reduce((s, w) => s + w.items.length, 0);
const skipped = idx.filter(p => LIT.indexOf(p.book) >= 0 &&
  ['礼记', '论语', '国语', '战国策', '《礼记》', '《论语》'].indexOf(String(p.author || '').trim()) >= 0).length;
eq(works + skipped, litItems.length, '名册覆盖的作品数 = 十部条目数 − 书名当作者的 ' + skipped + ' 条');
chk(skipped === 4, '「作者一格填的是书名」的恰好 4 条（礼记 / 论语 / 国语 / 战国策）');

/* ── 二、朝代归一 ───────────────────────────────────────────────────── */
console.log('\n=== 二、朝代归到同一条时间轴 ===');

// 同一朝的不同写法必须落到同一个段名
const SAME = [
  ['宋', '北宋'], ['宋', '南宋'], ['宋', '两宋之交'],
  ['三国', '三国·魏'], ['三国', '三国魏'], ['三国', '三国·蜀'],
  ['南北朝', '南朝·宋'], ['南北朝', '南朝宋'], ['南北朝', '南朝·梁'], ['南北朝', '北朝'],
  ['先秦', '东周'], ['先秦', '春秋'], ['先秦', '战国'],
  ['近现代', '现代'], ['近现代', '民国'],
  ['五代十国', '五代'], ['五代十国', '十国·南唐']
];
SAME.forEach(([a, b]) => eq(AI.eraName(a), AI.eraName(b), '「' + a + '」与「' + b + '」算同一朝（' + AI.eraName(a) + '）'));

// 时间轴上的顺序：先秦在唐前，唐在宋前，宋在清前
chk(AI.eraOf('先秦') < AI.eraOf('唐'), '先秦排在唐之前');
chk(AI.eraOf('唐') < AI.eraOf('宋'), '唐排在宋之前');
chk(AI.eraOf('宋') < AI.eraOf('清'), '宋排在清之前');
chk(AI.eraOf('清') < AI.eraOf('近现代'), '清排在近现代之前');

// 一条都掉不出时间轴：每位作者都有一朝（不再有「其他」堆）
eq(AI.people().filter(w => !w.at).length, 0, '没有一位作者掉在时间轴之外');
const OTHER_ERA = AI.groups().filter(g => g.name === '其他');
chk(OTHER_ERA.length === 0 || OTHER_ERA[0].count === 0,
  '「其他」那一段是空的（' + JSON.stringify(OTHER_ERA) + '）');

// 《昭明文选》那 145 条空朝代真的补上了
const zmEmpty = sb.POEMS_ZHAOMING.filter(p => !String(p.dynasty || '').trim());
chk(zmEmpty.length === 145, '《昭明文选》里空朝代的恰好 145 条（补录的输入）');
const patch = sb.ZHAOMING_AUTHOR_DYNASTY;
const zmAuthors = new Set(zmEmpty.map(p => String(p.author || '').trim()));
const unp = [...zmAuthors].filter(a => !patch[a]);
eq(unp.join(','), '', '那 145 条的作者朝代补录表一位不缺（缺 ' + unp.length + ' 位）');
const zmPeople = AI.people().filter(w => w.items.some(p => p.book === 'zhaoming') && w.at);
chk(zmPeople.length >= 60, '《昭明文选》的补录作者进了时间轴（' + zmPeople.length + ' 位）');

/* ── 三、作者归并 ───────────────────────────────────────────────────── */
console.log('\n=== 三、同一个人不许拆成两条 ===');

eq(AI.byName('班孟坚'), null, '《文选》用的字「班孟坚」已并入「班固」');
chk(AI.byName('班固') && AI.byName('班固').items.some(p => p.book === 'zhaoming'),
  '「班固」名下有《昭明文选》的作品');
eq(AI.byName('屈平'), null, '「屈平」已并入「屈原」');
eq(AI.byName('谢玄晖'), null, '「谢玄晖」已并入「谢朓」');
eq(AI.byName('诸葛孔明'), null, '「诸葛孔明」已并入「诸葛亮」');
eq(AI.byName('魏武帝'), null, '「魏武帝」已并入「曹操」');
chk(AI.byName('曹植') && AI.byName('曹植').items.length >= 2, '「曹植」名下不止一条（《文选》+ 别处）');

// 归并之后不许有重名两条
const names = AI.people().map(w => w.name);
eq(names.filter((n, i) => names.indexOf(n) !== i).join(','), '', '名册里没有重名两条');

// 别名不许指回自己（写错一行会静默吃掉一个人）
eq(AI.aliasOf('李白'), '李白', '没给「李白」编别名（原样返回）');
eq(AI.aliasOf(' 李白 '), '李白', '别名查表前先 trim（空格不算另一个人）');

/* ── 四、同作者的下一页 / 上一页（详情页要的那一份 items） ───────────── */
console.log('\n=== 四、一位作者的作品，一条不丢、一条不多 ===');

const libai = AI.byName('李白');
chk(!!libai, '名册里有「李白」');
const libaiFromIndex = litItems.filter(p => String(p.author || '').trim() === '李白');
eq(AI.itemsOf(libai).length, libaiFromIndex.length, '李白的作品数 = 十部里署名李白的条目数');
eq(AI.itemsOf(libai).filter(p => !p.author).length, 0, '交给阅读器的每一条都带着作者（详情页元信息要用）');

// 每条都带 id / title / book（阅读器读这几格）
const bad = AI.itemsOf(libai).filter(p => !p.id || !p.title);
eq(bad.length, 0, '每条都有 id 与 title');

// 一位作者的作品不许混进别人的
const dup = AI.itemsOf(libai).filter(p => String(p.author || '').trim() !== '李白');
eq(dup.length, 0, '李白的列表里没有别人的作品');

// 一位只在一部集子里的作者：作品数应当等于他在那一部的条数
const suishi = AI.byName('隋') || AI.people().filter(w => w.name === '杨广')[0];
if (suishi) eq(AI.itemsOf(suishi).length, suishi.items.length, '「' + suishi.name + '」的作品数自洽');

/* ── 五、索引卡的三个数 ─────────────────────────────────────────────── */
console.log('\n=== 五、索引卡上的家数 / 条数 ===');

const groups = AI.groups();
chk(groups.length >= 12, '朝代表上有 ' + groups.length + ' 段（先秦至近现代）');
chk(groups.every(g => g.name && g.count > 0), '每一段都有名字、都有人');
eq(groups.reduce((s, g) => s + g.count, 0), AI.total(), '各段家数之和 = 名册总人数');
eq(groups.reduce((s, g) => s + g.works, 0), works, '各段条数之和 = 名册作品总数');
chk(groups.every(g => g.works >= g.count), '每一段的条数 ≥ 家数（一个人至少一条作品）');

const tang = groups.filter(g => g.name === '唐')[0];
chk(tang && tang.count > 50 && tang.works > 300,
  '唐那一段家数与条数都是大数（' + JSON.stringify(tang) + '）');

/* ── 六、入口在搜索页，不在课外阅读（Issue #480 第二轮） ─────────────── */
console.log('\n=== 六、入口在搜索页，不在课外阅读 ===');

const src = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const searchPage = src('search/index.html');
chk(/id="author-entry"/.test(searchPage), '搜索页上有「作者索引」的入口（#author-entry）');
chk(/id="authors-index"/.test(searchPage), '搜索页上有名册容器（#authors-index）');

// 名册那一层的阅读器列表与搜索页自己的命中列表是两个容器：
// 后者不归阅读器，前者归（这样「点作者 → 他的作品」才不会被搜索层抢走）
chk(/id="site-gw-list"/.test(searchPage), '搜索页自己的命中列表是 #site-gw-list');
chk(/id="gw-list"/.test(searchPage), '作者作品列表是阅读器的 #gw-list');

// 课外阅读那一页不许再挂这一个入口。
// ⚠️ `library/index.html` 里仍然加载 `data/author-index.js` 那**一份**脚本，
//    但那是给《昭明文选》的作者朝代补录用的（`data/zhaoming-dynasty.js`
//    的存在意义就靠它索引卡上的朝代段）—— 所以这里守的是「入口表里没有
//    这一条」，不是「脚本里没有这个名字」。
const libJs = src('js/library.js');
chk(!/id: "authors"/.test(libJs), '课外阅读的入口表里没有「作者索引」这一条');
chk(!/crossCardHtml/.test(libJs), '课外阅读不再为跨集子入口单开一张卡（crossCardHtml 已删）');
chk(!/library-cross/.test(src('css/classic.css')), 'CSS 里那条 .library-cross 也删干净了');

// chrome 路由里也不许把它当一页
const chrome = src('js/chrome.js');
chk(!/authors: "\/authors\//.test(chrome), 'chrome 的路由表里没有 /authors/（它不是一个页面）');

// 入口那件事归 js/authors.js（搜索页那一层）
const authorsJs = src('js/authors.js');
chk(/bindEntry\(/.test(authorsJs), 'js/authors.js 里有入口绑定（bindEntry）');
chk(/setSearchLayer/.test(authorsJs), '名册展开时把搜索层收起来（setSearchLayer）');

// 搜索页自己铺命中行，行的长相从 reader-core 借（不另画一套）
const searchJs = src('js/search.js');
chk(/window\.ReaderList/.test(searchJs), '搜索页的行渲染借 window.ReaderList');
const core = src('js/reader-core.js');
chk(/window\.ReaderList = \{/.test(core), 'reader-core 暴露了 ReaderList');
chk(/window\.ReaderSearch = \{/.test(core), 'reader-core 暴露了 ReaderSearch（按条开阅读器）');

console.log('');
if (fails) { console.log('失败 ' + fails + ' 项'); process.exit(1); }
console.log('全部通过');
