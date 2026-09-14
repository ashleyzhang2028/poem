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

/* ================= 一、数据层 ================= */
const sb = { window: {}, console, document: { readyState: 'complete', addEventListener() {}, querySelector() { return null; } } };
sb.window = sb;
vm.createContext(sb);
const DATA = [
  'data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js', 'data/poems-5.js',
  'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js', 'data/poems-9.js', 'data/poems-10.js',
  'data/poems-11.js', 'data/poems-12.js', 'data/index.js', 'data/poems-classic.js',
  'data/poems-tangshi.js', 'data/poems-songci.js', 'data/poems-guwen.js', 'data/poems-zhaoming.js',
  'data/site-index.js', 'data/works-map.js', 'data/works-index.js',
  'data/canonical-texts.js'
];
DATA.forEach(f => vm.runInContext(read(f), sb, { filename: f }));

const CANON = sb.CANONICAL_TEXTS;
const WI = sb.WorksIndex;
const byId = {};
sb.SITE_INDEX.forEach(p => { byId[p.id] = p; });

chk(Array.isArray(CANON) && CANON.length > 0,
  'data/canonical-texts.js 有内容（' + (CANON || []).length + ' 条）');
chk(CANON.every(r => r.id && r.of && r.ofEntry && typeof r.text === 'boolean' &&
  typeof r.translation === 'boolean' && (r.text || r.translation)),
  '每条都带 id / of / ofEntry / text / translation（且至少换一样）');
// id 与 ofEntry 都是站点索引口径（带集子前缀）；of 是集子内 id，供集子页命中
chk(CANON.every(r => byId[r.id] && byId[r.ofEntry]),
  '表里的条目 id 全部能在站点索引里找到（没有拼错的影子条目）');
chk(CANON.every(r => r.ofEntry === 'poems-' + r.of),
  'of 就是 ofEntry 去掉「poems-」前缀（主条目一律是课内条目，集子内 id 不带前缀）');
// 口径：of 必须是这一篇的**主条目**（课内优先），且两边确实同篇
chk(CANON.every(r => WI.repOf(r.id) === r.ofEntry),
  'of 一律是这一篇的主条目（课内优先）—— 与作品主表同口径');
chk(CANON.every(r => WI.same(r.id, r.ofEntry)),
  '登记的每一条都与 of 判为同一篇作品（判重口径一致）');

// 与 data/works-map.js 一样：这层是生成文件，必须与「按规则现算」的结果一致
const want = [];
WI.works.forEach(w => {
  if (w.entries.length < 2) return;
  const rep = WI.repOf(w.entries[0]);
  const repEntry = byId[rep];
  if (!repEntry) return;
  w.entries.forEach(id => {
    if (id === rep) return;
    const p = byId[id];
    if (!p) return;
    const needText = sig(p.text) !== sig(repEntry.text);
    const needTrans = p.translation && repEntry.translation &&
      sig(p.translation) !== sig(repEntry.translation);
    if (needText || needTrans) {
      want.push({ id, of: rep.replace(/^[a-z]+-/, ''), ofEntry: rep,
        text: needText, translation: !!needTrans });
    }
  });
});
want.sort((a, b) => (a.id < b.id ? -1 : 1));
chk(JSON.stringify(want) === JSON.stringify(CANON),
  '裁定表与现算结果逐条一致（改了语料要重跑 scripts/build-canonical-texts.js）');

// 《静夜思》：课内与唐诗《夜思》正文都要等于教材文本
const jys = byId['poems-xx1-09'];
const yt = byId['tangshi-ts-231'];
const JYS = '床前明月光，疑是地上霜。举头望明月，低头思故乡。';
chk(norm(jys.text) === norm(JYS), '课内《静夜思》正文 = 教材文本「床前明月光……」（实际：' + jys.text.replace(/\n/g, '') + '）');
chk(norm(yt.text) === norm(JYS), '唐诗三百首《夜思》正文 = 教材文本（「静夜思全部改成……」）');
chk(sb.SITE_INDEX.filter(p => String(p.text || '').indexOf('看月光') >= 0).length === 0,
  '全站没有「床前看月光」的残留');

/* ================= 二、引擎层：按裁定表换正文 ================= */
const html = read('classic/index.html');
const order = html.match(/<script src="([^"]+)"><\/script>/g).map(s => s.match(/src="([^"]+)"/)[1]);
chk(order.indexOf('data/canonical-texts.js') >= 0, '集子页加载了正文裁定表');
chk(order.indexOf('data/canonical-texts.js') < order.indexOf('js/reader-core.js'),
  '裁定表排在引擎之前（mount 时就要读它）');

const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://local.test/classic/' });
const w = dom.window;
w.scrollTo = function () {};
order.forEach(f => {
  const el = w.document.createElement('script');
  el.textContent = read(f);
  w.document.body.appendChild(el);
});

setTimeout(() => {
  const api = w.ReaderEngine.current;
  chk(!!api, '小古文页挂上了引擎实例');

  // 课内那一份（主条目）取到之后，把「同一篇的选本那一条」开出来：
  // 阅读器里读到的该是主条目那一份正文与译文。
  // ⚠️ 集子页内的 id 不带集子前缀（gw-60）；前缀只在全站索引里出现（classic-gw-60）。
  const repInPage = w.POEMS_ALL.filter(p => p.id === 'cz8-02')[0];
  const rd = w.document.querySelector('#gw-reader');
  // 集子页自己不加载全站索引（那是首页 / 搜索页的事），而主条目的正文在课内那一册里。
  // 引擎取主条目正文只认索引 —— 所以要先把这本页已有的课内篇目摆进索引，
  // 再让 api 按同一条规则重判一次（这正是 refreshCanonical 的用途）。
  w.SITE_INDEX = w.POEMS_ALL.map(p => ({ id: 'poems-' + p.id, text: p.text, translation: p.translation }));
  api.refreshCanonical();
  api.open('gw-60');   // 《答谢中书书》：课内八年级上 + 小古文，课内是主条目
  const shown = rd.querySelector('#rd-text').textContent.replace(/[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹ·]+/g, '');
  chk(norm(shown) === norm(repInPage.text),
    '在小古文页读《答谢中书书》，正文就是课内那一份（教材口径）');
  const trans = rd.querySelector('#rd-trans-text').textContent;
  chk(norm(trans) === norm(repInPage.translation),
    '译文同样是课内那一份（同一篇不该给学生两段不同的白话）');

  // 拿不到主条目正文时不许猜、不许拼：索引里没有那一条就照原样显示
  w.SITE_INDEX = [];
  api.refreshCanonical();
  api.open('gw-60');
  chk(rd.querySelector('#rd-text').textContent.indexOf('山川之美') >= 0,
    '索引里查不到主条目时照原样显示（既不空着，也不拿别篇的正文顶上）');

  // 传进来的数据对象不许被就地改写：那会污染集子自己的语料
  const local = w.POEMS_CLASSIC.filter(p => p.id === 'gw-60')[0];
  chk(local && norm(local.text).indexOf('山川之美') >= 0,
    '页面数据里那一篇仍是它本来的正文（裁定只影响显示，不改语料）');

  /* ============ 二之二、每一部集子页都按裁定表读（不止小古文） ============
     裁定表里 57 条散在五部集子里，而且**集子页不加载全站索引** ——
     引擎要能自己从 window.POEMS_ALL 里取到主条目那一份。
     只验小古文一部，会漏掉「古文观止 / 宋词 / 唐诗这几页根本没换」这种整页失效。 */
  const PAGES = [
    ['guwen/index.html', '/guwen/', 'POEMS_GUWEN', 'guwen', 'guwen-gwj-'],
    ['songci/index.html', '/songci/', 'POEMS_SONGCI', 'songci', 'songci-sc-'],
    ['tangshi/index.html', '/tangshi/', 'POEMS_TANGSHI', 'tangshi', 'tangshi-ts-']
  ];
  const strip = t => norm(String(t || '')).replace(/[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹ·]+/g, '');
  function checkPages(row) {
    const page = row[0], url = row[1], poolVar = row[2], book = row[3], prefix = row[4];
    const pHtml = read(page);
    const pOrder = pHtml.match(/<script src="([^"]+)"><\/script>/g).map(x => x.match(/src="([^"]+)"/)[1]);
    chk(pOrder.indexOf('data/canonical-texts.js') >= 0, page + ' 加载了正文裁定表');
    chk(pOrder.indexOf('data/poems-1.js') >= 0 && pOrder.indexOf('data/index.js') >= 0,
      page + ' 也加载了课内 12 册（主条目正文在课内那一份里）');
    chk(pOrder.indexOf('data/index.js') < pOrder.indexOf('js/reader-core.js'),
      page + ' 课内数据排在引擎之前（mount 时就要用它取主条目）');

    const dp = new JSDOM(pHtml, { runScripts: 'dangerously', url: 'https://local.test' + url });
    const wp = dp.window;
    wp.scrollTo = function () {};
    pOrder.forEach(f => {
      const el = wp.document.createElement('script');
      el.textContent = read(f);
      wp.document.body.appendChild(el);
    });
    // 挂载脚本在 DOMContentLoaded 之后才跑，等一拍让引擎挂上
    // 挂载脚本在 DOMContentLoaded 之后才跑：等一拍再验
    return new Promise(function (resolve) {
      setTimeout(function () {
        const api = wp.ReaderEngine.current;
        chk(!!api, page + ' 挂上了引擎实例');
        const rules = CANON.filter(r => r.id.indexOf(prefix) === 0);
        let checked = 0;
        const bad = [];
        rules.forEach(function (r) {
          const localId = r.id.replace(new RegExp('^' + book + '-'), '');
          if (!(wp[poolVar] || []).filter(function (p) { return p.id === localId; }).length) return;
          const course = wp.POEMS_ALL.filter(function (p) { return p.id === r.of; })[0];
          if (!course || !api) return;
          checked += 1;
          api.open(localId);
          const rdr = wp.document.querySelector('#gw-reader');
          const okText = r.text ? strip(rdr.querySelector('#rd-text').textContent) === strip(course.text) : true;
          const okTr = r.translation ? rdr.querySelector('#rd-trans-text').textContent === course.translation : true;
          if (!okText || !okTr) bad.push(localId + (okText ? '' : ' 正文'));
        });
        chk(checked > 0 && bad.length === 0,
          page + ' 里 ' + checked + ' 条同篇都读主条目那一份正文与译文' +
          (bad.length ? '（不符：' + bad.join('、') + '）' : ''));
        resolve();
      }, 150);
    });
  }

  // 逐页串行跑（每页都要等它自己的挂载完成）
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
