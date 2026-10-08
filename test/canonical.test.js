
const fs = require('fs');
const vm = require('vm');
const path = __dirname + '/../';
const read = f => fs.readFileSync(path + f, 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const norm = t => String(t || '').replace(/\s+/g, '');
const sig = norm;

const sb = { window: {}, console, document: { readyState: 'complete', addEventListener() {}, querySelector() { return null; } } };
sb.window = sb;
vm.createContext(sb);
const { loadData } = require('./master-env');

loadData(sb, [
  'data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js', 'data/poems-5.js',
  'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js', 'data/poems-9.js', 'data/poems-10.js',
  'data/poems-11.js', 'data/poems-12.js', 'data/index.js', 'data/poems-classic.js',
  'data/poems-yuefu.js', 'data/poems-tangshi.js', 'data/poems-gushi.js', 'data/poems-songci.js', 'data/poems-guwen.js', 'data/poems-zhaoming.js', 'data/poems-yuanqu.js',
  'data/poems-jinxiandai.js', 'data/poems-chengyu.js', 'data/poems-changshi.js',
  'data/poems-mingshu.js', 'data/poems-mingren-cn.js', 'data/poems-mingren-foreign.js',
  'data/poems-emperor-cn.js', 'data/poems-emperor-waiguo.js',
  'data/site-index.js', 'data/works-map.js', 'data/works-index.js',
  'data/canonical-texts.js'
]);

const MASTER = sb.TEXT_MASTER;
const CANON = sb.CANONICAL_TEXTS;
const WI = sb.WorksIndex;
const byId = {};
sb.SITE_INDEX.forEach(p => { byId[p.id] = p; });

// 「全量收归主表」的各部：除课内（poems）外的每一部集子，一律从 SITE_BOOKS 取，
// 不写死名单 —— 加第十一部时这里自己跟着算（Issue #342）
const FULL_BOOKS = (sb.SITE_BOOKS || []).map(function (b) { return b.id; })
  .filter(function (id) { return id !== 'poems'; });
const FULL_BOOK_SET = {};
FULL_BOOKS.forEach(b => { FULL_BOOK_SET[b] = true; });

// 词条式集子（文学常识一类）：正文即释义，本来就没有白话译文
/* 词条式集子（正文即释义 / 词条，本来就没有白话译文）。
   Issue #399：历代名家拆两部，两卷同属这一族。 */
const NO_TRANS = ['changshi', 'mingshu', 'mingren', 'mingren-waiguo', 'dwang', 'dwang-waiguo'];

const multiEntries = MASTER.filter(m => m.entries.length >= 2);
const singleEntries = MASTER.filter(m => m.entries.length === 1);
chk(multiEntries.length === 189,
  '主表里有 189 条「跨集重复」的作品（乐府集与课内 / 其余集子重篇 + 成语故事原文与古文 / 诗篇同篇，' +
  'Issue #244 / #308；二批带来源的古文 / 诗篇条目并入原篇，再加《求之不得》↔《人言可畏》一类同源对；' +
  'Issue #339 拆掉 5 组错并（愚公移山 / 卧薪尝胆 / 礼贤下士 / 不自量力 / 东道主），' +
  '又合入 1 组真同篇（卧薪尝胆 ↔ 小古文《卧薪尝胆》），再拆开 众志成城 / 众口铄金 一组；' +
  '本轮把正文里的编者括注搬走、正文露出本来面目后，蚌鹬相持/坐收渔利、' +
  '近水楼台/近水楼台先得月 两组判为同篇；' +
  'Issue #461 补篇后又添 3 组（子路曾皙冉有公西华侍坐 / 长相思 / 偶成 与课内或他集合流）；' +
  '第四轮决赛冷门再添 2 组（子罕弗受玉 ↔ 小古文《子罕辞玉》、近试上张籍水部 ↔ 唐诗《近试上张水部》）；' +
  'Issue #461 古文观止对齐 222 篇：新增 12 组（过秦论上/过秦论、治安策一/治安策、' +
  '上书谏猎/司马相如上书谏猎、春夜宴从弟桃花园序/春夜宴桃李园序、大铁椎传、湖心亭看雪、' +
  '师说、六国论、游褒禅山记、上枢密韩太尉书 与课内或他集合流）；' +
  'Issue #471 第二轮又添 3 组（书愤 / 临安春雨初霁 与课内合流、' +
  '《鹊桥仙·华灯纵博》与集内旧条 sc-281 合流）；第三轮再添 1 组' +
  '（《闲居初夏午睡起·其一》的《唐诗》壳 ts-390 ↔《古诗「非唐代」》gs-55）；' +
  'Issue #505 第一批：古文 5 篇合流 + 古诗 17 首合流（其中 10 首课内单篇本条原来不在主表，' +
  '本轮由合流带进主表），共添 16 组；第二批：古文 13 篇合流 + 古诗 3 首合流，共添 12 组；' +
  '第三批：古文 5 篇（魏文侯期猎 / 响遏行云 / 黠狼 / 神龟 / 偷鸡者辩解）与《古文》集内旧条合流，' +
  '另 15 篇新落库的古文各成一条，共添 5 组；' +
  '实际 ' + multiEntries.length + '）');
const fullExpected = [];
FULL_BOOKS.forEach(book => {
  sb.SITE_INDEX.forEach(p => {
    if (!p || p.isBook || p.book !== book || !p.id) return;
    if (NO_TRANS.indexOf(book) >= 0 ? !p.text : (!p.text || !p.translation)) return;
    fullExpected.push(p.id);
  });
});
chk(singleEntries.length + multiEntries.length === MASTER.length,
  '主表条目只有两类：跨集重复（多条目）与全量收归部的单篇（单条目）');
chk(singleEntries.every(m => m.entries[0] === m.id),
  '全量收归的单篇条目：主条目就是它自己（entries 只有一条）');
chk(singleEntries.every(m => fullExpected.indexOf(m.id) >= 0),
  '单篇条目全部来自 FULL_BOOKS 点名的部（多收的：' +
  (singleEntries.filter(m => fullExpected.indexOf(m.id) < 0).map(m => m.id).slice(0, 6).join('、') || '无') + '）');
chk(fullExpected.every(id => singleEntries.some(m => m.id === id)) ||
  fullExpected.every(id => MASTER.some(m => (m.entries || []).indexOf(id) >= 0)),
  'FULL_BOOKS 点名的部里，每个有正文的条目都进了主表（漏收的：' +
  (fullExpected.filter(id => !MASTER.some(m => (m.entries || []).indexOf(id) >= 0)).slice(0, 6).join('、') || '无') + '）');
chk(MASTER.every(m => m.id && m.work && Array.isArray(m.entries) && m.entries.length >= 1),
  '每条都带 id / work / entries（跨集重复至少两条条目指它）');
chk(MASTER.every(m => m.text && (m.translation || NO_TRANS.some(b => m.id.indexOf(b + '-') === 0))),
  '每条都有正文（词条式集子无译文，其余都要求正文与译文齐备；主表是唯一一份正文，不许有空文）');

const noCourse = multiEntries.filter(m => m.id.indexOf('poems-') !== 0);
chk(noCourse.every(m => m.entries.every(e => e.indexOf('poems-') !== 0)),
  '主条目不是课内条目的那些，entries 里也确实没有课内条目（不该有人放着课内不用）');
chk(noCourse.every(m => m.id === WI.repOf(m.entries[0])) &&
  noCourse.every(m => m.entries.indexOf(m.id) >= 0),
  '没有课内可比时，主条目就是 data/works-index.js 认的那一条' +
  '（出处集子优先于成语故事、同档取序号最小的 id，与 works-index 同口径；' +
  noCourse.length + ' 篇，多是唐诗 ↔ 乐府集、古文 ↔ 成语故事的重篇）');
chk(multiEntries.filter(m => m.id.indexOf('poems-') === 0).length === multiEntries.length - noCourse.length,
  '其余 ' + (multiEntries.length - noCourse.length) + ' 篇的主条目都是课内条目（教材口径优先）');

chk(singleEntries.every(m => FULL_BOOKS.some(b => m.id.indexOf(b + '-') === 0)),
  '全量收归部的单篇：主条目 id 带自己那一部的前缀');
chk(multiEntries.every(m => WI.repOf(m.entries[0]) === m.id),
  '跨集重复的 id 就是这一篇的主条目（与 data/works-index.js 同口径）');

chk(MASTER.every(m => byId[m.id]), '主表 id 全部能在站点索引里找到（没有拼错的影子条目）');

chk(MASTER.every(m => norm(byId[m.id].text) === norm(m.text)),
  '主表里的正文与主条目在站点索引里的正文逐字相同');

const resolveOne = (raw, book) => (sb.masterTextOf ? sb.masterTextOf(raw, book) : raw);

const SPOT = [
  ['classic', sb.POEMS_CLASSIC, 'gw-60'],
  ['tangshi', sb.POEMS_TANGSHI, 'ts-6'],
  ['songci', sb.POEMS_SONGCI, 'sc-183'],
  ['guwen', sb.POEMS_GUWEN, 'gwj-88'],
  ['poems', sb.POEMS_ALL, 'cz8-14']
];
SPOT.forEach(row => {
  const book = row[0], list = row[1], id = row[2];
  const raw = (list || []).filter(p => p.id === id)[0];
  if (!raw) return;
  const got = resolveOne(raw, book);
  const masterId = raw.textRef;
  const m = MASTER.filter(x => x.id === masterId)[0];
  chk(!!m && norm(got.text) === norm(m.text),
    book + ' 的 ' + id + ' 按 textRef 取回主表那一份正文');
});

const mismatch = [];
MASTER.forEach(m => {
  const books = m.entries.map(e => e.split('-')[0]);
  const texts = [];
  m.entries.forEach(eid => {
    const book = eid.split('-')[0];
    const localId = eid.replace(new RegExp('^' + book + '-'), '');
    const pools = {
      poems: sb.POEMS_ALL, classic: sb.POEMS_CLASSIC, tangshi: sb.POEMS_TANGSHI,
      songci: sb.POEMS_SONGCI, guwen: sb.POEMS_GUWEN, zhaoming: sb.POEMS_ZHAOMING
    };
    const raw = (pools[book] || []).filter(p => p.id === localId)[0];
    if (!raw) return;
    texts.push({ eid: eid, t: norm(resolveOne(raw, book).text) });
  });
  if (texts.length < 2) return;
  const first = texts[0].t;
  if (texts.some(x => x.t !== first)) mismatch.push(m.id);
});
chk(mismatch.length === 0,
  '60 篇作品在七部集子里读到的正文逐字相同（不一致：' + (mismatch.slice(0, 5).join('、') || '无') + '）');

// 词条式集子（文学常识 / 名著导读 / 历代名家）：正文是排版好的项目表，
// 一个「类」占一条；列表用 excerpt，正文由阅读器认成真 <table>。
// 这三部各有自己的用例文件（test/mingshu.test.js / test/mingren.test.js），
// 这里只核最要紧的一条：正文里那张表真的解得出来，不是一坨竖线。
(function () {
  const TABLE_BOOKS = ['mingshu', 'mingren'];
  /* Issue #399：历代名家拆两部 —— 两卷各是一份壳、各占一行台账。 */
const LISTS = { mingshu: sb.POEMS_MINGSHU, mingren: sb.POEMS_MINGREN_CN, 'mingren-waiguo': sb.POEMS_MINGREN_FOREIGN };
  const bad = [];
  TABLE_BOOKS.forEach(book => {
    (LISTS[book] || []).forEach(p => {
      const t = resolveOne(p, book).text || '';
      const lines = t.split('\n');
      let rows = 0;
      let cols = 0;
      lines.forEach((line, i) => {
        const s = line.trim();
        if (s.charAt(0) !== '│' || s.charAt(s.length - 1) !== '│') return;
        const cells = s.split('│').slice(1, -1).map(x => x.trim());
        if (i === 0 || cells.length < 2) return;
        if (!cols) cols = cells.length;
        if (cells.length !== cols) bad.push(p.id + ' 第 ' + (i + 1) + ' 行 ' + cells.length + ' 列（应为 ' + cols + '）');
        rows++;
      });
      if (rows < 2) bad.push(p.id + ' 正文里没有可解析的表格行');
    });
  });
  chk(bad.length === 0,
    '名著导读与历代名家的正文都画得出真表格（列数齐、行数足；异常：' + (bad.slice(0, 5).join('、') || '无') + '）');
})();

const masterFlat = [];
MASTER.forEach(m => (m.entries || []).forEach(e => masterFlat.push(e)));

const byDedupeKey = {};
sb.SITE_INDEX.forEach(p => {
  if (!p || p.isBook || !p.text || !p.id) return;
  const k = WI.dedupKey(p.text);
  if (!k) return;
  (byDedupeKey[k] = byDedupeKey[k] || []).push(p.id);
});
const dupEntries = [];
Object.keys(byDedupeKey).forEach(k => {
  if (byDedupeKey[k].length > 1) dupEntries.push.apply(dupEntries, byDedupeKey[k]);
});
const covered = {};
MASTER.forEach(m => (m.entries || []).forEach(e => { covered[e] = 1; }));
const uncovered = dupEntries.filter(e => !covered[e]);
chk(uncovered.length === 0,
  '「同篇判重键下有两条及以上」的条目共 ' + dupEntries.length + ' 条，全部收进了主表（未收：' +
  (uncovered.slice(0, 6).join('、') || '无') + '）');
chk(dupEntries.length === 404,
  '重复条目恰为 404 条（162 篇：多数 × 2，少数 × 3 或 4；乐府集与成语故事收进来的一批重篇，' +
  'Issue #244 / #308；Issue #339 拆开 5 组错并后由 303 降为 297；' +
  '又拆开 众志成城 / 众口铄金 一组降为 295；' +
  '本轮正文括注搬走后新增 蚌鹬相持/坐收渔利、近水楼台/近水楼台先得月 两组，升为 299；' +
  'Issue #461 补篇后再添 3 组重篇，升为 305；第四轮决赛冷门再添 2 组，升为 309；' +
  'Issue #461 古文观止对齐 222 篇再添 12 条重篇，升为 329；' +
  'Issue #471 第二轮再添 3 条重篇（书愤 / 临安春雨初霁 / 鹊桥仙·华灯纵博），升为 335；' +
  '第三轮再添 3 条 —— 新落库的 2 条唐诗（ts-388 杜牧《题乌江亭》、ts-389 刘禹锡《庭竹》）'
  + '各 +1，另《闲居初夏午睡起·其一》在 gs-55 / ts-390 两个条目上成一束、多出 1 条，升为 338；' +
  'Issue #505 第一批再添 40 —— 古文 5 篇、古诗 17 首合流各 +1（其中 10 首课内单篇本条已经算在' +
  '判重键里，不重复计），另 18 条新落库的古文 / 古诗各 +1（单条不进这一束，只有合流的才算），升为 378；' +
  'Issue #505 第二批再添 16 —— 古文 4 篇合流、古诗 3 首合流各 +1，另 20 篇新落库的' +
  '古文各 +1（它们自己成束），升为 394；Issue #505 第三批再添 10 —— 古文 5 篇合流各 +1，' +
  '另 5 篇题名各异的壳（魏文侯期猎 / 响遏行云 / 黠狼 / 神龟 / 偷鸡者辩解）与集内那一篇合成一束、' +
  '各再 +1；实际 ' +
  dupEntries.length + '）');

const expectFlat = dupEntries.slice();
fullExpected.forEach(id => { if (expectFlat.indexOf(id) < 0) expectFlat.push(id); });
const sortJoin = arr => arr.slice().sort().join('|');
chk(sortJoin(masterFlat) === sortJoin(expectFlat),
  '主表登记的条目 = 判重条目全集 + FULL_BOOKS 各部条目（主表 ' + masterFlat.length +
  ' 条，应收 ' + expectFlat.length + ' 条）');

const seenOnce = {};
let overlapped = [];
masterFlat.forEach(e => {
  if (seenOnce[e]) overlapped.push(e);
  seenOnce[e] = 1;
});
chk(overlapped.length === 0, '没有条目被两篇作品同时登记（重叠：' + (overlapped.join('、') || '无') + '）');
chk(MASTER.every(m => m.entries.indexOf(m.id) >= 0),
  '每条主表的 entries 里都有它自己（否则那一篇的正文谁也取不到）');

const inScope = sb.SITE_INDEX.filter(p => p && !p.isBook && p.id &&
  (p.text || p.translation) && FULL_BOOK_SET[p.book]);
const missingFromMaster = inScope.filter(p => !masterFlat.some(e => e === p.id));
chk(missingFromMaster.length === 0,
  '清单点名的七部里，有正文的 ' + inScope.length + ' 条条目全部登记进了主表（未登记：' +
  (missingFromMaster.slice(0, 6).map(p => p.id).join('、') || '无') + '）');

const keNei = sb.SITE_INDEX.filter(p => p && !p.isBook && p.book === 'poems' && p.id);
const keNeiLostText = keNei.filter(p => !p.text && !p.translation);
chk(keNeiLostText.length === 0,
  '课内 ' + keNei.length + ' 首都有正文（主表里那一份，或自己内联的那一份；' +
  '实际缺：' + (keNeiLostText.slice(0, 6).map(p => p.id).join('、') || '无') + '）');

chk(masterFlat.every(id => byId[id] && !byId[id].isBook),
  '主表登记的每一条都是站点索引里的真实篇目（不是书本身、不是拼错的 id）');

chk(FULL_BOOKS.every(b => sb.SITE_INDEX.some(p => p.book === b)),
  'FULL_BOOKS 点名的各部在站点索引里都在册（实际：' +
  FULL_BOOKS.filter(b => !sb.SITE_INDEX.some(p => p.book === b)).join('、') + '）');

const BOOK_VARS = {
  poems: ['data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js',
    'data/poems-5.js', 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js',
    'data/poems-9.js', 'data/poems-10.js', 'data/poems-11.js', 'data/poems-12.js'],
  classic: ['data/poems-classic.js'],
  yuefu: ['data/poems-yuefu.js'],
  tangshi: ['data/poems-tangshi.js'],
  gushi: ['data/poems-gushi.js'],
  songci: ['data/poems-songci.js'],
  guwen: ['data/poems-guwen.js'],
  zhaoming: ['data/poems-zhaoming.js'],
  yuanqu: ['data/poems-yuanqu.js'],
  yuefu: ['data/poems-yuefu.js'],
  jinxiandai: ['data/poems-jinxiandai.js'],
  chengyu: ['data/poems-chengyu.js'],
  changshi: ['data/poems-changshi.js'],
  mingshu: ['data/poems-mingshu.js'],
  mingren: ['data/poems-mingren-cn.js'],
  'mingren-waiguo': ['data/poems-mingren-foreign.js'],
  /* Issue #407：帝王两卷 —— 与历代名家同属「词条式」，两份壳各自一个号段。 */
  dwang: ['data/poems-emperor-cn.js'],
  'dwang-waiguo': ['data/poems-emperor-waiguo.js']
};

const stripped = [];
const leftover = [];
/* ⚠️ Issue #399：历代名家拆两部 —— 两卷的主表 id 前缀都是 `mingren`
   （mingren-mr-c-xx / mingren-mr-w-xx），而壳里的 id 是 mr-c-xx / mr-w-xx。
   所以这里收一份「壳 id → 文件」的对照，按**壳里写着的 id** 认，而不是
   按前缀切（切出来的是另一半，对不上）。 */
const SHELL_IDS = {};
Object.keys(BOOK_VARS).forEach(book => {
  BOOK_VARS[book].forEach(f => {
    const src = read(f);

    const entries = src.split(/\n(?=\s*\{)/);
    entries.forEach(blk => {
      const refM = blk.match(/textRef:\s*"([^"]+)"/);
      if (!refM) return;

      const idM = blk.match(/\bid:\s*"([^"]+)"/);
      if (!idM) return;
      const key = book + ':' + idM[1];
      stripped.push(key);
      /* 主表那一条的 id：一般是 textRef（拆两部后的两卷即此）；
         成语故事里还有「跨集判重」的条目，正文挂在**另一条**上 ——
         那种情况主表 id 是 `<book>-<shell id>`，一并认。 */
      SHELL_IDS[refM[1]] = key;
      SHELL_IDS[book + '-' + idM[1]] = key;
      if (/^\s+text:\s*"/m.test(blk) || /^\s+translation:\s*"/m.test(blk)) {
        leftover.push(key);
      }
    });
  });
});

const expectStripped = masterFlat.length;
const strippedSet = {};
stripped.forEach(k => { strippedSet[k] = 1; });
const notStripped = masterFlat.filter(id => {
  const key = SHELL_IDS[id];
  return !key || !strippedSet[key];
});
chk(stripped.length === expectStripped && notStripped.length === 0,
  '主表登记的 ' + expectStripped + ' 条非主条目都已退化成只存归属（textRef；实际 ' +
  stripped.length + '）' +
  (notStripped.length ? '，未摘：' + notStripped.slice(0, 8).join('、') : ''));
chk(leftover.length === 0,
  '带 textRef 的条目里不再内联 text / translation（残留：' +
  (leftover.slice(0, 8).join('、') || '无') + '）');

chk(Array.isArray(CANON) && CANON.length === 0,
  'data/canonical-texts.js 已收敛为空表（存储层收归后不再有需要替换的条目；' +
  '实际 ' + (CANON || []).length + ' 条）');

const jys = sb.POEMS_ALL.filter(p => p.id === 'xx1-09')[0];
const ytRaw = sb.POEMS_TANGSHI.filter(p => p.id === 'ts-231')[0];
const yt = resolveOne(ytRaw, 'tangshi');
const JYS = '床前明月光，疑是地上霜。举头望明月，低头思故乡。';
chk(norm(jys.text) === norm(JYS), '课内《静夜思》正文 = 教材文本「床前明月光……」');
chk(norm(yt.text) === norm(JYS), '唐诗三百首《夜思》正文 = 同一份教材文本（走主表）');
chk(sb.SITE_INDEX.filter(p => String(p.text || '').indexOf('看月光') >= 0).length === 0,
  '全站没有「床前看月光」的残留');

/* Issue #480：《昭明文选》原有 145 条 dynasty 是空串（作者 62 位：孙兴公、
   王文考、谢惠连、颜延之……），在按朝代铺开的作者索引里会掉出时间轴。
   已按《文选》李善注所载作者小传补齐，这里守「一条不空」。 */
const zm = sb.POEMS_ZHAOMING || [];
const zmEmpty = zm.filter(p => !String(p.dynasty || '').trim());
chk(zm.length === 480 && zmEmpty.length === 0,
  '《昭明文选》480 条每一条都有朝代（空串：' + (zmEmpty.map(p => p.id).join('、') || '无') + '）');
const zmAuthors = {};
zm.forEach(p => { if (p.dynasty) zmAuthors[p.author] = p.dynasty; });
chk(zmAuthors['谢灵运'] === '南朝·宋' && zmAuthors['魏武帝'] === '三国·魏' &&
    zmAuthors['李斯'] === '秦' && zmAuthors['荆卿'] === '战国·燕',
  '抽样认人：《文选》作者的朝代对得上（谢灵运 · 南朝宋 / 魏武帝 · 三国魏 / 李斯 · 秦 / 荆轲 · 战国燕）');

const html = read('classic/index.html');
const order = html.match(/<script src="([^"]+)"><\/script>/g).map(s => s.match(/src="([^"]+)"/)[1]);
if (order.indexOf('data/site-index.js') >= 0) {
  chk(order.indexOf('data/text-master.js') < order.indexOf('data/site-index.js'),
    '主表排在站点索引之前（索引组装时就要按它取回正文）');
}

(function () {
  const pages = [];
  (function walk(dir) {
    fs.readdirSync(dir).forEach(function (name) {
      const full = dir + '/' + name;
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        if (name === 'node_modules' || name === '.git') return;
        walk(full);
      } else if (/\.html$/.test(name)) pages.push(full);
    });
  })(__dirname + '/..');
  const bad = [];
  pages.forEach(function (full) {
    const src = fs.readFileSync(full, 'utf8');
    const refs = (src.match(/<script src="([^"]+)"><\/script>/g) || [])
      .map(function (x) { return x.match(/src="([^"]+)"/)[1]; });
    const idxAt = refs.findIndex(function (r) { return /(^|\/)data\/index\.js$/.test(r); });
    if (idxAt < 0) return;
    const tmAt = refs.findIndex(function (r) { return /(^|\/)data\/text-master\.js$/.test(r); });
    if (tmAt < 0 || tmAt > idxAt) {
      bad.push(full.replace(__dirname + '/../', '') + '（主表 ' + (tmAt < 0 ? '未加载' : '#' + tmAt) + '，index.js #' + idxAt + '）');
    }
  });
  chk(bad.length === 0,
    '加载了 data/index.js 的页面都先加载了 data/text-master.js（异常：' + (bad.join('、') || '无') + '）');
})();

const home = read('index.html');
const hOrder = home.match(/<script src="([^"]+)"><\/script>/g).map(x => x.match(/src="([^"]+)"/)[1]);

{
  const sb2 = {
    window: {}, console: console,
    localStorage: (function () {
      const mem = {};
      return {
        getItem: k => (mem[k] === undefined ? null : mem[k]),
        setItem: (k, v) => { mem[k] = String(v); },
        removeItem: k => { delete mem[k]; }
      };
    })(),
    document: { readyState: 'complete', addEventListener() {}, querySelector() { return null; } }
  };
  sb2.window = sb2;
  vm.createContext(sb2);

  const known = sb.SITE_INDEX.map(p => p.id);
  vm.runInContext(read('js/storage.js'), sb2, { filename: 'js/storage.js' });
  const S2 = sb2.Storage;
  const writeRaw = (o) => sb2.localStorage.setItem('poem_recite_progress_v1', JSON.stringify(o));
  const readRaw = () => JSON.parse(sb2.localStorage.getItem('poem_recite_progress_v1') || '{}');

  writeRaw({
    'gz12-06': { level: 3, learned: true, nextReviewAt: Date.now() - 1000, reviewCount: 4, lapses: 0 },
    'gz12-12': { level: 2, learned: true, nextReviewAt: Date.now() - 1000, reviewCount: 3, lapses: 0 },
    'xx1-09': { level: 1, learned: true, nextReviewAt: Date.now() - 1000, reviewCount: 1, lapses: 0 }
  });

  chk(known.indexOf('poems-xx1-09') >= 0, '站点索引里认得出《静夜思》（孤儿清理的判据来自它）');
  known.push('xx1-09');
  S2.pruneUnknown(known);
  const prog = readRaw();
  chk(!prog['gz12-06'] && !prog['gz12-12'],
    '已删的高年级重复条目（gz12-06 / gz12-12）的孤儿进度被清掉');
  chk(!!prog['xx1-09'] && prog['xx1-09'].level === 1 && prog['xx1-09'].reviewCount === 1,
    '真实篇目的进度一个字没动（《静夜思》仍在，轮次 / 复习次数原样）');

  writeRaw({ 'gz12-06': { level: 1 } });
  S2.pruneUnknown([]);
  chk(!!readRaw()['gz12-06'],
    '拿不到语料（空 id 表）时一个键都不删（不误删真实进度）');
}

console.log('');
console.log(fails ? '❌ ' + fails + ' 项失败' : '🎉 正文收归主表测试全部通过');
process.exit(fails ? 1 : 0);
