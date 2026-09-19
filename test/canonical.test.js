const { JSDOM } = require('jsdom');
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
  'data/poems-tangshi.js', 'data/poems-songci.js', 'data/poems-guwen.js', 'data/poems-zhaoming.js', 'data/poems-yuanqu.js',
  'data/site-index.js', 'data/works-map.js', 'data/works-index.js',
  'data/canonical-texts.js'
]);

const MASTER = sb.TEXT_MASTER;
const CANON = sb.CANONICAL_TEXTS;
const WI = sb.WorksIndex;
const byId = {};
sb.SITE_INDEX.forEach(p => { byId[p.id] = p; });

const FULL_BOOKS = ['zhaoming', 'guwen', 'songci', 'tangshi', 'classic', 'yuanqu'];
const FULL_BOOK_SET = {};
FULL_BOOKS.forEach(b => { FULL_BOOK_SET[b] = true; });

const multiEntries = MASTER.filter(m => m.entries.length >= 2);
const singleEntries = MASTER.filter(m => m.entries.length === 1);
chk(multiEntries.length === 68,
  '主表里有 68 条「跨集重复」的作品（实际 ' + multiEntries.length + '）');
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
chk(dupEntries.length === 137,
  '重复条目恰为 137 条（68 篇：多数 × 2，少数 × 3；实际 ' + dupEntries.length + '）');

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
  '清单点名的六部里，有正文的 ' + inScope.length + ' 条条目全部登记进了主表（未登记：' +
  (missingFromMaster.slice(0, 6).map(p => p.id).join('、') || '无') + '）');

const keNei = sb.SITE_INDEX.filter(p => p && !p.isBook && p.book === 'poems' && p.id);
const keNeiLostText = keNei.filter(p => !p.text && !p.translation);
chk(keNeiLostText.length === 0,
  '课内 ' + keNei.length + ' 首都有正文（主表里那一份，或自己内联的那一份；' +
  '实际缺：' + (keNeiLostText.slice(0, 6).map(p => p.id).join('、') || '无') + '）');

chk(masterFlat.every(id => byId[id] && !byId[id].isBook),
  '主表登记的每一条都是站点索引里的真实篇目（不是书本身、不是拼错的 id）');

chk(FULL_BOOKS.every(b => sb.SITE_INDEX.some(p => p.book === b)),
  'FULL_BOOKS 点名的六部在站点索引里都在册（实际：' +
  FULL_BOOKS.filter(b => !sb.SITE_INDEX.some(p => p.book === b)).join('、') + '）');

const BOOK_VARS = {
  poems: ['data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js',
    'data/poems-5.js', 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js',
    'data/poems-9.js', 'data/poems-10.js', 'data/poems-11.js', 'data/poems-12.js'],
  classic: ['data/poems-classic.js'],
  tangshi: ['data/poems-tangshi.js'],
  songci: ['data/poems-songci.js'],
  guwen: ['data/poems-guwen.js'],
  zhaoming: ['data/poems-zhaoming.js'],
  yuanqu: ['data/poems-yuanqu.js']
};

const stripped = [];
const leftover = [];
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
      if (/^\s+text:\s*"/m.test(blk) || /^\s+translation:\s*"/m.test(blk)) {
        leftover.push(key);
      }
    });
  });
});

// 口径没变：**主表登记过的每一条**都要退化成只存归属（textRef），
// 正文只在主表那一份。主条目自己也带 textRef（指向自己）——
// 第一层「一份正文」不是靠「哪个文件存着」表达的，而是靠「只有主表存着」。
const expectStripped = masterFlat.length;
const strippedSet = {};
stripped.forEach(k => { strippedSet[k] = 1; });
const notStripped = masterFlat.filter(id => {
  const book = Object.keys(BOOK_VARS).filter(b => id.indexOf(b + '-') === 0)[0];
  return !book || !strippedSet[book + ':' + id.slice(book.length + 1)];
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

  const repInPage = w.POEMS_ALL.filter(p => p.id === 'cz8-02')[0];
  const rd = w.document.querySelector('#gw-reader');
  api.open('gw-60');
  const shown = strip2(rd.querySelector('#rd-text').textContent);
  chk(shown.length > 0 && norm(shown) === norm(repInPage.text),
    '在小古文页读《答谢中书书》，正文由 textRef 取回主表那一份（教材口径）');
  const trans = rd.querySelector('#rd-trans-text').textContent;
  chk(norm(trans) === norm(repInPage.translation),
    '译文同样由主表取回（同一篇不该给学生两段不同的白话）');

  const noRef = { id: 'x', title: '没有 textRef 的条目' };
  chk(sb.masterTextOf(noRef, 'classic') === noRef, '没有 textRef 的条目原样返回（不是主表的活）');
  const badRef = { id: 'y', textRef: '根本不存在的-id' };
  chk(sb.masterTextOf(badRef, 'classic') === badRef, 'textRef 查不到时原样返回（不猜一篇顶上）');

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

  const home = read('index.html');
  const hOrder = home.match(/<script src="([^"]+)"><\/script>/g).map(x => x.match(/src="([^"]+)"/)[1]);
  chk(hOrder.indexOf('js/storage.js') >= 0, '首页加载了 js/storage.js（进度库）');
  chk(/pruneUnknown/.test(read('js/app.js')),
    '首页启动时会清一次孤儿进度（js/app.js 调 Storage.pruneUnknown）');

  const domH = new JSDOM(home, {
    runScripts: 'dangerously', url: 'https://local.test/',
    beforeParse(win) {

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

  setTimeout(function () {
    const prog = JSON.parse(wh.localStorage.getItem('poem_recite_progress_v1') || '{}');

    chk(!prog['gz12-06'], '已删的高年级重复条目（gz12-06）的孤儿进度被清掉');
    chk(!prog['gz12-12'], '已删的高年级重复条目（gz12-12）的孤儿进度被清掉');
    chk(!!prog['xx1-09'], '真实篇目的进度一个字没动（《静夜思》仍在）');
    chk(prog['xx1-09'].level === 1 && prog['xx1-09'].reviewCount === 1,
      '真实篇目的进度内容也原样保留（轮次 / 复习次数都没改）');

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
