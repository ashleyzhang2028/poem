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

/* ---- 1.1 主表本身 ---- */
chk(Array.isArray(MASTER) && MASTER.length === 57,
  'data/text-master.js 有 57 条（两部及以上集子重复出现的作品数；实际 ' +
  (MASTER ? MASTER.length : 'undefined') + '）');
chk(MASTER.every(m => m.id && m.work && Array.isArray(m.entries) && m.entries.length >= 2),
  '每条都带 id / work / entries（且至少两条条目指向它）');
chk(MASTER.every(m => m.text && m.translation),
  '每条都有正文与译文（主表是唯一一份正文，不许有空文）');
chk(MASTER.every(m => m.id.indexOf('poems-') === 0),
  '主条目一律是课内条目（教材口径优先）—— 与作品主表同口径');
chk(MASTER.every(m => WI.repOf(m.entries[0]) === m.id),
  '主表的 id 就是这一篇的主条目（与 data/works-index.js 同口径）');
// 主表里的 id 必须都是站点索引里真实存在的条目 —— 拼错一个就会静默丢一份正文
chk(MASTER.every(m => byId[m.id]), '主表 id 全部能在站点索引里找到（没有拼错的影子条目）');
// 主表的文本是**全站唯一一份**：正文逐字等于主条目在站点索引里的那一份
chk(MASTER.every(m => norm(byId[m.id].text) === norm(m.text)),
  '主表里的正文与主条目在站点索引里的正文逐字相同');

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
    const entries = src.split(/\n(?=  \{)/);
    entries.forEach(blk => {
      const refM = blk.match(/textRef:\s*"([^"]+)"/);
      if (!refM) return;
      stripped.push(book + ':' + refM[1]);
      if (/^\s+text:\s*"/m.test(blk) || /^\s+translation:\s*"/m.test(blk)) {
        leftover.push(book + ':' + refM[1]);
      }
    });
  });
});
chk(stripped.length === 114,
  '六部集子里共 114 条条目已退化成只存归属（textRef；实际 ' + stripped.length + '）');
chk(leftover.length === 0,
  '带 textRef 的条目里不再内联 text / translation（残留：' +
  (leftover.slice(0, 8).join('、') || '无') + '）');

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
  '57 篇作品在六部集子里读到的正文逐字相同（不一致：' + (mismatch.slice(0, 5).join('、') || '无') + '）');

/* ---- 1.4b 主表收齐了「同一篇的重复条目」全集 ---- */
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
chk(dupEntries.length === 114,
  '重复条目恰为 114 条（57 篇 × 2；实际 ' + dupEntries.length + '）');

/* 主表的 entries 一个不多、一个不少：多出来的等于把单条也收进来白占地方，
   少一条就等于漏收 —— 两头都要挡。 */
const masterFlat = [];
MASTER.forEach(m => (m.entries || []).forEach(e => masterFlat.push(e)));
chk(masterFlat.length === dupEntries.length &&
  masterFlat.slice().sort().join('|') === dupEntries.slice().sort().join('|'),
  '主表登记的全部条目与「重复条目全集」逐条对上（主表 ' + masterFlat.length + ' 条）');

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
