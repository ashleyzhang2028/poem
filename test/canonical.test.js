/**
 * 正文收归主表 + 孤儿进度清理（Issue #69 收尾）
 *
 * 需求原话三条：
 *   「静夜思全部改成 床前明月光，疑是地上霜。举头望明月，低头思故乡。目的是不干扰学生学习和困惑」
 *   「课内 12 组自身重复：用哪一条的进度？合并进度，暂时用户极少，可以删掉进度，清理无效数据」
 *   「正文收归主表，以课本为主，去重」
 *
 * 这一层验四件事：
 *   1. 裁定表 data/canonical-texts.js 与语料逐条对得上（没有影子条目、口径与主表一致）
 *   2. 引擎按裁定表把正文 / 译文换成主条目那一份（传进来的数据没被就地改写）
 *   3. 同一篇作品在**任何一部**集子里读到的正文逐字相同 —— 学生不会读到两种《桃花源记》
 *   4. 已删条目的旧背诵进度会被清掉；未删的不动；拿不到语料时一个都不删
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const vm = require('vm');
const path = __dirname + '/../';
const read = f => fs.readFileSync(path + f, 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

// 判重键与生成器同一口径：只去空白（标点、断行不属于「正文不同」）
const norm = t => String(t || '').replace(/\s+/g, '');
const sig = norm;

/* ================= 一、存储层：正文只落一份 ================= */
const sb = { window: {}, console, document: { readyState: 'complete', addEventListener() {}, querySelector() { return null; } } };
sb.window = sb;
vm.createContext(sb);
const { loadData } = require('./master-env');
// 正文存储主表须排最前：各集子条目只存归属（textRef），正文按它取回。
loadData(sb, [
  'data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js', 'data/poems-5.js',
  'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js', 'data/poems-9.js', 'data/poems-10.js',
  'data/poems-11.js', 'data/poems-12.js', 'data/index.js', 'data/poems-classic.js',
  'data/poems-tangshi.js', 'data/poems-songci.js', 'data/poems-guwen.js', 'data/poems-zhaoming.js',
  'data/site-index.js', 'data/works-map.js', 'data/works-index.js',
  'data/canonical-texts.js'
]);

const MASTER = sb.TEXT_MASTER;
const CANON = sb.CANONICAL_TEXTS;
const WI = sb.WorksIndex;
const byId = {};
sb.SITE_INDEX.forEach(p => { byId[p.id] = p; });

/* ---- 1.0 「已全量收归的部」清单（权威口径） ----
   与 scripts/build-text-master.js 的 FULL_BOOKS 一致。
   一部一个 PR 地往下收：清单里没点名的部照旧内联，两种形态并存。
   ⚠️ 哪一部漏收了、或哪一部多收了，都由这一份清单核 —— 不靠数总数。 */
const FULL_BOOKS = ['zhaoming', 'guwen', 'songci', 'tangshi'];

/* ---- 1.1 主表本身 ---- */
/* 60（跨集重复的作品：
     57 课内自身重复去重后的跨集重复 + 3 近重复合并进来的
     《黄鹤楼送孟浩然之广陵》《夜上受降城闻笛》《将进酒》）
   + FULL_BOOKS 各部的**单篇**条目 —— 按部推进，点名的部全收：
       昭明文选 480 → 古文观止 167 → 宋词三百首 283 → **唐诗三百首 301（本轮）**。
     ⚠️ 这里**不写死单篇的条数**：那个数字每收一部就变，写死等于每部都要回来改一行，
        而真正要守的是「单篇条目恰好来自清单点名的那些部」——
        多一个少一个都由下面两条断言按清单核，不靠数总数。 */
const multiEntries = MASTER.filter(m => m.entries.length >= 2);
const singleEntries = MASTER.filter(m => m.entries.length === 1);
chk(multiEntries.length === 60,
  '主表里有 60 条「跨集重复」的作品（实际 ' + multiEntries.length + '）');
const fullExpected = [];
FULL_BOOKS.forEach(book => {
  sb.SITE_INDEX.forEach(p => {
    if (!p || p.isBook || p.book !== book || !p.id) return;
    if (!p.text && !p.translation) return;
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
chk(MASTER.every(m => m.text && m.translation),
  '每条都有正文与译文（主表是唯一一份正文，不许有空文）');
chk(multiEntries.every(m => m.id.indexOf('poems-') === 0),
  '跨集重复的主条目一律是课内条目（教材口径优先）—— 与作品主表同口径');
// 全量收归部的单篇，主条目就是它自己：id 必须带**自己那一部**的前缀
chk(singleEntries.every(m => FULL_BOOKS.some(b => m.id.indexOf(b + '-') === 0)),
  '全量收归部的单篇：主条目 id 带自己那一部的前缀');
chk(multiEntries.every(m => WI.repOf(m.entries[0]) === m.id),
  '跨集重复的 id 就是这一篇的主条目（与 data/works-index.js 同口径）');
// 主表里的 id 必须都是站点索引里真实存在的条目 —— 拼错一个就会静默丢一份正文
chk(MASTER.every(m => byId[m.id]), '主表 id 全部能在站点索引里找到（没有拼错的影子条目）');
// 主表的文本是**全站唯一一份**：正文逐字等于主条目在站点索引里的那一份
chk(MASTER.every(m => norm(byId[m.id].text) === norm(m.text)),
  '主表里的正文与主条目在站点索引里的正文逐字相同');

/* ---- 1.3 textRef 能取回正文，且与主表逐字相同 ---- */
const resolveOne = (raw, book) => (sb.masterTextOf ? sb.masterTextOf(raw, book) : raw);
// 抽查五个集子各一条
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

/* ---- 1.4 同一篇在**任何一部**集子里读到的正文逐字相同 ---- */
// 这是「学生不会读到两种《桃花源记》」这条线 —— 存储层把它从「显示时替换」
// 变成「本来就只有一份」，所以每一部集子页读出来的都必须一致。
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
  '60 篇作品在六部集子里读到的正文逐字相同（不一致：' + (mismatch.slice(0, 5).join('、') || '无') + '）');

/* ---- 1.4b 主表收齐了「同一篇的重复条目」全集 ---- */
/* 主表登记的全部条目 id（1.4 / 1.2 两段都要用） */
const masterFlat = [];
MASTER.forEach(m => (m.entries || []).forEach(e => masterFlat.push(e)));

/* 1.4 说的是「收进来的都对」；这一条说的是「该收的一条都没漏」——
   漏一条的表现不是报错，而是**那一篇的正文在磁盘上又存了一份**，
   日后改一处、漏一处，正是这一层要根除的东西。 */
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
chk(dupEntries.length === 120,
  '重复条目恰为 120 条（60 篇 × 2；实际 ' + dupEntries.length + '）');

/* 主表的收归范围**两头都要挡**：
     · 收多了 = 把没点名的部的单篇也搬了（那一条的正文会从自己数据文件里消失）
     · 收少了 = 点名的部里有条目还内联着正文
   所以判据不是数总数，而是「主表登记的条目 = 判重条目全集 ∪ FULL_BOOKS 各部条目」。 */
const expectFlat = dupEntries.slice();
fullExpected.forEach(id => { if (expectFlat.indexOf(id) < 0) expectFlat.push(id); });
const sortJoin = arr => arr.slice().sort().join('|');
chk(sortJoin(masterFlat) === sortJoin(expectFlat),
  '主表登记的条目 = 判重条目全集 + FULL_BOOKS 各部条目（主表 ' + masterFlat.length +
  ' 条，应收 ' + expectFlat.length + ' 条）');

/* 每一的主条目都在自己那一组里，且组内条目互不重叠 ——
   重叠了就是同一条被两篇作品认领，正文取谁的都会有人读错。 */
const seenOnce = {};
let overlapped = [];
masterFlat.forEach(e => {
  if (seenOnce[e]) overlapped.push(e);
  seenOnce[e] = 1;
});
chk(overlapped.length === 0, '没有条目被两篇作品同时登记（重叠：' + (overlapped.join('、') || '无') + '）');
chk(MASTER.every(m => m.entries.indexOf(m.id) >= 0),
  '每条主表的 entries 里都有它自己（否则那一篇的正文谁也取不到）');

/* ---- 1.2 各集子条目「只存归属」：不再内联正文 ---- */
const BOOK_VARS = {
  poems: ['data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js',
    'data/poems-5.js', 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js',
    'data/poems-9.js', 'data/poems-10.js', 'data/poems-11.js', 'data/poems-12.js'],
  classic: ['data/poems-classic.js'],
  tangshi: ['data/poems-tangshi.js'],
  songci: ['data/poems-songci.js'],
  guwen: ['data/poems-guwen.js'],
  zhaoming: ['data/poems-zhaoming.js']
};
// 各集子数据文件里，被主表收编的条目应**只剩 textRef**，不得再存 text / translation。
// 直接从源码里数 —— 走 window 变量的话，data/index.js 之类已经把它们展开回来了。
const stripped = [];
const leftover = [];
Object.keys(BOOK_VARS).forEach(book => {
  BOOK_VARS[book].forEach(f => {
    const src = read(f);
    // 逐个条目看：带 textRef 的条目不得同时带 text:
    // ⚠️ 切条目**不能按「恰好两格缩进的 {」切**：data/poems-guwen.js 里有一条
    //    （《齐桓晋文之事》）起头是顶格的 `{` —— 用 `/\n(?=  \{)/` 切，
    //    它会粘在上一条的块里，于是「上一条同时有 textRef 和 text」这条断言
    //    会**误报**，而真正的问题（那一条压根没被摘）反而被掩过去。
    //    缩进一律放宽成「至少一格」，与 scripts/apply-text-master.js 同口径。
    const entries = src.split(/\n(?=\s*\{)/);
    entries.forEach(blk => {
      const refM = blk.match(/textRef:\s*"([^"]+)"/);
      if (!refM) return;
      // ⚠️ 记的是**条目自己**的 id，不是 textRef 的值 ——
      //    textRef 存的是**主条目**的 id：跨集重复时两者不同
      //    （唐诗的 ts-102 指向课内的 poems-cz7-03）。按 textRef 的值登记，
      //    等于把这 46 条重复条目记成了「课内那些条」，下面逐条对账就会
      //    把它们全判成「漏摘」—— 而真正漏摘的那一条反而淹在里面。
      const idM = blk.match(/\bid:\s*"([^"]+)"/);
      if (!idM) return;
      const key = book + ':' + idM[1];
      stripped.push(key);
      if (/^\s+text:\s*"/m.test(blk) || /^\s+translation:\s*"/m.test(blk)) {
        leftover.push(key);
      }
    });
  });
});
/* 「该摘的条目」= 主表登记的全部条目（跨集重复 120 条 + FULL_BOOKS 各部条目）。
   ⚠️ 这里刻意**不再按「120 + 各部条目数」数总数** —— 那样只要任一条漏摘，
      报出来的只是「实际 764」，看不出少的是哪一条。改成从主表出发逐条对，
      漏摘的那一条能被点名。 */
const expectStripped = masterFlat.length;
const strippedSet = {};
stripped.forEach(k => { strippedSet[k] = 1; });
const notStripped = masterFlat.filter(id => {
  const book = Object.keys(BOOK_VARS).filter(b => id.indexOf(b + '-') === 0)[0];
  // ⚠️ 站点索引 id 带集子前缀（`guwen-gwj-1`），语料里的条目 id 不带（`gwj-1`）——
  //    拼对账键时要把前缀**去掉**，否则永远拼成 `guwen:guwen-gwj-1`、
  //    一个都对不上，断言会把 765 条全判成「漏摘」。
  return !book || !strippedSet[book + ':' + id.slice(book.length + 1)];
});
chk(stripped.length === expectStripped && notStripped.length === 0,
  '主表登记的 ' + expectStripped + ' 条条目都已退化成只存归属（textRef；实际 ' +
  stripped.length + '）' +
  (notStripped.length ? '，未摘：' + notStripped.slice(0, 8).join('、') : ''));
chk(leftover.length === 0,
  '带 textRef 的条目里不再内联 text / translation（残留：' +
  (leftover.slice(0, 8).join('、') || '无') + '）');


/* ---- 1.5 显示层裁定表：正文已收归存储层，不再需要替换 ---- */
// data/canonical-texts.js 是「显示时把正文换成主条目那一份」的裁定表。
// 存储层收归之后，各集子的正文本来就取自主表，**不再存在两种写法** ——
// 这张表因此变成空表。保留它（与引擎里的机制）是给日后真出现异文时用的；
// 一旦它又非空，说明有语料绕过了主表，这里要亮红提醒。
chk(Array.isArray(CANON) && CANON.length === 0,
  'data/canonical-texts.js 已收敛为空表（存储层收归后不再有需要替换的条目；' +
  '实际 ' + (CANON || []).length + ' 条）');

/* ---- 1.6 《静夜思》：课内与唐诗都等于教材文本 ---- */
const jys = sb.POEMS_ALL.filter(p => p.id === 'xx1-09')[0];
const ytRaw = sb.POEMS_TANGSHI.filter(p => p.id === 'ts-231')[0];
const yt = resolveOne(ytRaw, 'tangshi');
const JYS = '床前明月光，疑是地上霜。举头望明月，低头思故乡。';
chk(norm(jys.text) === norm(JYS), '课内《静夜思》正文 = 教材文本「床前明月光……」');
chk(norm(yt.text) === norm(JYS), '唐诗三百首《夜思》正文 = 同一份教材文本（走主表）');
chk(sb.SITE_INDEX.filter(p => String(p.text || '').indexOf('看月光') >= 0).length === 0,
  '全站没有「床前看月光」的残留');

/* ================= 二、引擎层：页面能按 textRef 取回正文 ================= */
const html = read('classic/index.html');
const order = html.match(/<script src="([^"]+)"><\/script>/g).map(s => s.match(/src="([^"]+)"/)[1]);
chk(order.indexOf('data/text-master.js') >= 0, '集子页加载了正文存储主表');
chk(order.indexOf('data/text-master.js') < order.indexOf('js/reader-core.js'),
  '主表排在引擎之前（mount 时就要按它取回正文）');
if (order.indexOf('data/site-index.js') >= 0) {
  chk(order.indexOf('data/text-master.js') < order.indexOf('data/site-index.js'),
    '主表排在站点索引之前（索引组装时就要按它取回正文）');
}

const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://local.test/classic/' });
const w = dom.window;
w.scrollTo = function () {};
order.forEach(f => {
  const el = w.document.createElement('script');
  el.textContent = read(f);
  w.document.body.appendChild(el);
});

const strip2 = t => norm(String(t || '')).replace(/[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹ·]+/g, '');

setTimeout(() => {
  const api = w.ReaderEngine.current;
  chk(!!api, '小古文页挂上了引擎实例');
  // 打开被主表收编的《答谢中书书》（gw-60）：条目里已没有正文，引擎须按 textRef 取回
  const repInPage = w.POEMS_ALL.filter(p => p.id === 'cz8-02')[0];
  const rd = w.document.querySelector('#gw-reader');
  api.open('gw-60');
  const shown = strip2(rd.querySelector('#rd-text').textContent);
  chk(shown.length > 0 && norm(shown) === norm(repInPage.text),
    '在小古文页读《答谢中书书》，正文由 textRef 取回主表那一份（教材口径）');
  const trans = rd.querySelector('#rd-trans-text').textContent;
  chk(norm(trans) === norm(repInPage.translation),
    '译文同样由主表取回（同一篇不该给学生两段不同的白话）');

  // 主表取数入口的行为（数据层）：没有 textRef 原样返回、查不到也原样返回 ——
  // 宁可留空，也不猜、不拼（空文一眼可见，取错一篇却看着正常）。
  const noRef = { id: 'x', title: '没有 textRef 的条目' };
  chk(sb.masterTextOf(noRef, 'classic') === noRef, '没有 textRef 的条目原样返回（不是主表的活）');
  const badRef = { id: 'y', textRef: '根本不存在的-id' };
  chk(sb.masterTextOf(badRef, 'classic') === badRef, 'textRef 查不到时原样返回（不猜一篇顶上）');

  /* ---- 每一部集子页都按 textRef 取回（不止小古文） ---- */
  const PAGES = [
    ['guwen/index.html', '/guwen/', 'POEMS_GUWEN', 'guwen'],
    ['songci/index.html', '/songci/', 'POEMS_SONGCI', 'songci'],
    ['tangshi/index.html', '/tangshi/', 'POEMS_TANGSHI', 'tangshi']
  ];
  function checkPages(row) {
    const page = row[0], url = row[1], poolVar = row[2], book = row[3];
    const pHtml = read(page);
    const pOrder = pHtml.match(/<script src="([^"]+)"><\/script>/g).map(x => x.match(/src="([^"]+)"/)[1]);
    chk(pOrder.indexOf('data/text-master.js') >= 0, page + ' 加载了正文存储主表');
    chk(pOrder.indexOf('data/text-master.js') < pOrder.indexOf('js/reader-core.js'),
      page + ' 主表排在引擎之前');

    const dp = new JSDOM(pHtml, { runScripts: 'dangerously', url: 'https://local.test' + url });
    const wp = dp.window;
    wp.scrollTo = function () {};
    pOrder.forEach(f => {
      const el = wp.document.createElement('script');
      el.textContent = read(f);
      wp.document.body.appendChild(el);
    });
    return new Promise(function (resolve) {
      setTimeout(function () {
        const api2 = wp.ReaderEngine.current;
        chk(!!api2, page + ' 挂上了引擎实例');
        // 这一部里被主表收编的条目：打开它，正文须等于主表那一份。
        // ⚠️ 主表条目的 id 一律是**课内**条目（poems- 开头），要找的是
        //    「entries 里有这一部的条目」的那一条。
        const m = MASTER.filter(x => (x.entries || []).some(e => e.indexOf(book + '-') === 0))[0];
        if (!m) { chk(false, page + ' 里找不到被主表收编的条目（测试用例要跟着语料改）'); resolve(); return; }
        const eid = m.entries.filter(e => e.indexOf(book + '-') === 0)[0];
        const localId = eid.replace(new RegExp('^' + book + '-'), '');
        const rawEntry = (wp[poolVar] || []).filter(p => p.id === localId)[0];
        api2.open(localId);
        const rdr = wp.document.querySelector('#gw-reader');
        const got = strip2(rdr.querySelector('#rd-text').textContent);
        chk(!!rawEntry && norm(got) === norm(m.text),
          page + ' 里 ' + localId + ' 读到的正文 = 主表那一份');
        resolve();
      }, 150);
    });
  }
  (async function () {
    for (let i = 0; i < PAGES.length; i += 1) await checkPages(PAGES[i]);
    afterPages();
  })();

  function afterPages() {
  /* ================= 三、孤儿背诵进度清理 ================= */
  const home = read('index.html');
  const hOrder = home.match(/<script src="([^"]+)"><\/script>/g).map(x => x.match(/src="([^"]+)"/)[1]);
  chk(hOrder.indexOf('js/storage.js') >= 0, '首页加载了 js/storage.js（进度库）');
  chk(/pruneUnknown/.test(read('js/app.js')),
    '首页启动时会清一次孤儿进度（js/app.js 调 Storage.pruneUnknown）');

  const domH = new JSDOM(home, {
    runScripts: 'dangerously', url: 'https://local.test/',
    beforeParse(win) {
      // 埋一份「12 组自身重复」的旧进度：被删掉的高年级那一条留着，
      // 保留的那一条与一篇真实课内篇目也各留一份。
      win.localStorage.setItem('poem_recite_progress_v1', JSON.stringify({
        'gz12-06': { level: 3, learned: true, nextReviewAt: Date.now() - 1000, reviewCount: 4, lapses: 0 },
        'gz12-12': { level: 2, learned: true, nextReviewAt: Date.now() - 1000, reviewCount: 3, lapses: 0 },
        'xx1-09': { level: 1, learned: true, nextReviewAt: Date.now() - 1000, reviewCount: 1, lapses: 0 }
      }));
    }
  });
  const wh = domH.window;
  wh.scrollTo = function () {};
  hOrder.forEach(f => {
    const el = wh.document.createElement('script');
    el.textContent = read(f);
    wh.document.body.appendChild(el);
  });

  // 首页的 init() 在 DOMContentLoaded 之后跑（我们插的脚本晚于解析），
  // 孤儿清理挂在 init 里 —— 等一拍再读进度库。
  setTimeout(function () {
    const prog = JSON.parse(wh.localStorage.getItem('poem_recite_progress_v1') || '{}');
    // 用户原话：「合并进度，暂时用户极少，可以删掉进度，清理无效数据」→ 删掉孤儿键。
    chk(!prog['gz12-06'], '已删的高年级重复条目（gz12-06）的孤儿进度被清掉');
    chk(!prog['gz12-12'], '已删的高年级重复条目（gz12-12）的孤儿进度被清掉');
    chk(!!prog['xx1-09'], '真实篇目的进度一个字没动（《静夜思》仍在）');
    chk(prog['xx1-09'].level === 1 && prog['xx1-09'].reviewCount === 1,
      '真实篇目的进度内容也原样保留（轮次 / 复习次数都没改）');
    // 拿不到语料时一个都不删 —— 这条是「宁可留孤儿也别误删」的防线
    const keep = { 'gz12-06': { level: 1 } };
    wh.localStorage.setItem('poem_recite_progress_v1', JSON.stringify(keep));
    wh.Storage.pruneUnknown([]);
    chk(!!JSON.parse(wh.localStorage.getItem('poem_recite_progress_v1') || '{}')['gz12-06'],
      '拿不到语料（空 id 表）时一个键都不删（不误删真实进度）');

    console.log('\n' + (fails ? '❌ ' + fails + ' 项失败' : '🎉 正文收归主表测试全部通过'));
    process.exit(fails ? 1 : 0);
  }, 150);
  }
}, 80);
