const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const LOAD = [
  'data/text-master.js',
  'data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js',
  'data/poems-5.js', 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js',
  'data/poems-9.js', 'data/poems-10.js', 'data/poems-11.js', 'data/poems-12.js',
  'data/index.js', 'data/poems-classic.js', 'data/poems-tangshi.js', 'data/poems-gushi.js',
  'scripts/data/gushi-corpus.js',
  /* Issue #461：本轮新补的正文语料 —— 唐诗 5 首、小古文 16 篇。 */
  'scripts/data/tangshi-corpus-461.js', 'scripts/data/classic-corpus-461.js',
  'scripts/data/ci-corpus-461.js',
  /* Issue #461：决赛冷门篇目（第三轮）—— 唐诗 / 古诗 / 词 / 小古文各一份。 */
  'scripts/data/tangshi-corpus-461c.js', 'scripts/data/gushi-corpus-461c.js',
  'scripts/data/ci-corpus-461c.js', 'scripts/data/classic-corpus-461c.js',
  /* Issue #461：阅读大赛高中组 / 大会冷门拓展（第二轮）—— 唐诗 / 古诗 / 词 / 曲 / 小古文。 */
  'scripts/data/tangshi-corpus-461b.js', 'scripts/data/gushi-corpus-461b.js',
  'scripts/data/ci-corpus-461b.js', 'scripts/data/qu-corpus-461.js',
  'scripts/data/classic-corpus-461b.js',
  /* Issue #471：含扬州 / 广陵 / 江都的古诗词（第一轮）—— 唐诗 / 古诗 / 词各一份。 */
  'scripts/data/tangshi-corpus-461d.js', 'scripts/data/gushi-corpus-461d.js',
  'scripts/data/ci-corpus-461d.js',
  /* Issue #471：李清照词补录 —— 如梦令·昨夜雨疏风骤、怨王孙·春暮。 */
  'scripts/data/ci-corpus-471.js',
  /* Issue #471 · 第二轮：陆凯《赠范晔诗》+ 陆游十首（《古诗「非唐代」》9 诗 1 词）。 */
  'scripts/data/gushi-corpus-471b.js', 'scripts/data/ci-corpus-471b.js',
  /* Issue #471 · 第三轮：用户点名的名篇 —— 杜牧《题乌江亭》、刘禹锡《庭竹》
     （《唐诗》），杨万里《闲居初夏午睡起二首》+ 苏轼《海棠》（《古诗「非唐代」》）。
     《唐诗》那一条壳（ts-390）与 gs-55 同文，正文只在「古诗」那份语料里写一份。 */
  'scripts/data/tangshi-corpus-471c.js', 'scripts/data/tangshi-corpus-471d.js',
  'scripts/data/gushi-corpus-471c.js',
  /* Issue #480：曹植《七步诗》从《唐诗》归位到《古诗「非唐代」· 汉魏诗》。 */
  'scripts/data/gushi-corpus-480.js',
  /* Issue #461：李清照《减字木兰花·卖花担上》—— 单篇补录（让号到 sc-320）。 */
  'scripts/data/ci-corpus-461e.js',
  /* Issue #461 · 第六轮：苏轼 / 李清照各补 5 篇宋词名篇。 */
  'scripts/data/ci-corpus-461f.js',
  /* Issue #505 · 第一批（50 组）：古文 20 篇 + 古诗 16 首。 */
  'scripts/data/classic-corpus-505a.js',
  'scripts/data/poems-corpus-505a.js',
  /* Issue #505 · 第二批（第 51~100 组）：古文 23 篇 + 古诗 14 首。 */
  'scripts/data/classic-corpus-505b.js',
  'scripts/data/poems-corpus-505b.js',
  /* Issue #505 · 第三批（第 101~150 组）：古文 15 篇（其余与集内旧条同篇合流）。 */
  'scripts/data/classic-corpus-505c.js',
  /* Issue #510 · 第一批（初中课内古诗）：唐诗 14 + 古诗「非唐代」7。 */
  'scripts/data/poems-corpus-510a.js',
  /* Issue #505 · 第四批（末批 · 第 151~200 组）：古文 15 篇 + 古诗 8 首。 */
  'scripts/data/classic-corpus-505d.js',
  'scripts/data/poems-corpus-505c.js',
  /* Issue #516 · 第一批：用户点名的古诗 50 篇（唐诗 35 + 古诗 16）。 */
  'scripts/data/poems-corpus-516a.js',
  /* Issue #516 · 第二批（收尾批）：清单里最后真缺的 20 篇（唐诗 7 + 非唐古诗 13）。 */
  'scripts/data/poems-corpus-516b.js',
  /* Issue #517 · 第一批（课本里的文言短篇）：古文 22 篇。 */
  'scripts/data/classic-corpus-517a.js',
  'data/poems-songci.js', 'data/poems-guwen.js', 'data/poems-zhaoming.js', 'data/poems-yuanqu.js',
  /* Issue #461：古文观止补篇（222 篇对齐）—— 正文语料表，供 textOfEntry 取正文。 */
  'scripts/data/guwen-corpus-222.js',
  'data/poems-yuefu.js', 'data/poems-jinxiandai.js', 'data/poems-chengyu.js',
  'data/poems-changshi.js',
  'data/poems-mingshu.js', 'data/poems-mingren-cn.js', 'data/poems-mingren-foreign.js',
  'data/poems-emperor-cn.js', 'data/poems-emperor-waiguo.js',
  'data/chengyu-support.js',
  'data/site-books.js', 'data/site-index.js', 'data/works-map.js', 'data/works-index.js'
];

const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
LOAD.forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
});

const WI = sandbox.WorksIndex;

const FULL_BOOKS = ['zhaoming', 'guwen', 'songci', 'tangshi', 'gushi', 'classic', 'yuanqu', 'yuefu', 'jinxiandai', 'chengyu', 'changshi', 'mingshu', 'mingren', 'mingren-waiguo', 'dwang', 'dwang-waiguo'];

const prev = {};
try {
  const prevSandbox = { window: {}, console };
  prevSandbox.window = prevSandbox;
  vm.createContext(prevSandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'data/text-master.js'), 'utf8'),
    prevSandbox, { filename: 'data/text-master.js' });

  (prevSandbox.TEXT_MASTER || []).forEach(function (m) {
    if (!m) return;
    if (m.id && !prev[m.id]) prev[m.id] = m;
    (m.entries || []).forEach(function (e) { if (e && !prev[e]) prev[e] = m; });
  });
} catch (e) {  }

function textOfEntry(entry, masterId) {
  if (entry && (entry.text || entry.translation)) {
    return { text: entry.text || "", translation: entry.translation || "",
      translationSource: entry.translationSource || "" };
  }
  const old = prev[masterId] || prev[entry && entry.id];
  if (old) {
    return { text: old.text || "", translation: old.translation || "",
      translationSource: old.translationSource || "" };
  }
  /* Issue #505 · 第二批：壳挂的 textRef 指的**就是它自己那个主表键**
     （壳 gw-200 挂 classic-gw-200），而这一轮它正是要进主表的条目 ——
     主表里还没有它，`prev` 自然查不到。这时正文其实就在语料表里
     （RAW_ENTRIES 的同一个键），补取一次，别把新条目判成「无正文」。 */
  var raw = (typeof RAW_ENTRIES !== 'undefined') && RAW_ENTRIES[masterId];
  if (raw && (raw.text || raw.translation)) {
    return { text: raw.text || "", translation: raw.translation || "",
      translationSource: raw.translationSource || "" };
  }
  return { text: "", translation: "", translationSource: "" };
}

var RAW_ENTRIES = {};
(function () {
  var FILES = [
    { f: 'data/poems-1.js', v: 'POEMS_1' }, { f: 'data/poems-2.js', v: 'POEMS_2' },
    { f: 'data/poems-3.js', v: 'POEMS_3' }, { f: 'data/poems-4.js', v: 'POEMS_4' },
    { f: 'data/poems-5.js', v: 'POEMS_5' }, { f: 'data/poems-6.js', v: 'POEMS_6' },
    { f: 'data/poems-7.js', v: 'POEMS_7' }, { f: 'data/poems-8.js', v: 'POEMS_8' },
    { f: 'data/poems-9.js', v: 'POEMS_9' }, { f: 'data/poems-10.js', v: 'POEMS_10' },
    { f: 'data/poems-11.js', v: 'POEMS_11' }, { f: 'data/poems-12.js', v: 'POEMS_12' },
    { f: 'data/poems-classic.js', v: 'POEMS_CLASSIC' },
    /* Issue #461：语料表先于各自的壳文件登记 —— RAW_ENTRIES 后写覆盖前写，
       而壳文件只存归属（无正文），若排在语料之后就会把正文盖掉。 */
    { f: 'data/poems-tangshi.js', v: 'POEMS_TANGSHI' },
    /* 《古诗「非唐代」》的壳文件。它的正文平时来自语料表，所以原先没在这里登记；
       但 Issue #505 的壳里有几条是**指向课内那一篇**的（判重合流，自己不写正文），
       这一类要靠 `RAW_ENTRIES[textRef]` 去取正文 —— 壳文件不登记，就取不到。 */
    { f: 'data/poems-gushi.js', v: 'POEMS_GUSHI' },
    /* Issue #461：《古诗「非唐代」》—— 壳文件只存归属（textRef），正文来自语料表。 */
    { f: 'scripts/data/gushi-corpus.js', v: 'GUSHI_CORPUS', book: 'gushi' },
    { f: 'scripts/data/gushi-corpus-461b.js', v: 'GUSHI_CORPUS_461B', book: 'gushi' },
    { f: 'scripts/data/gushi-corpus-461c.js', v: 'GUSHI_CORPUS_461C', book: 'gushi' },
    { f: 'scripts/data/gushi-corpus-461d.js', v: 'GUSHI_CORPUS_461D', book: 'gushi' },
    { f: 'scripts/data/classic-corpus-461.js', v: 'CLASSIC_CORPUS_461', book: 'classic' },
    { f: 'scripts/data/classic-corpus-461b.js', v: 'CLASSIC_CORPUS_461B', book: 'classic' },
    { f: 'scripts/data/classic-corpus-461c.js', v: 'CLASSIC_CORPUS_461C', book: 'classic' },
    /* Issue #505 · 第一批：古文 20 篇（壳里挂 textRef）。 */
    { f: 'scripts/data/classic-corpus-505a.js', v: 'CLASSIC_CORPUS_505A', book: 'classic' },
    /* Issue #505 · 第二批：古文 23 篇（壳里挂 textRef）。 */
    { f: 'scripts/data/classic-corpus-505b.js', v: 'CLASSIC_CORPUS_505B', book: 'classic' },
    /* Issue #505 · 第三批：古文 15 篇（壳里挂 textRef）。 */
    { f: 'scripts/data/classic-corpus-505c.js', v: 'CLASSIC_CORPUS_505C', book: 'classic' },
    /* Issue #510 · 第一批：唐诗 1 首（雁门太守行）。其余 20 条是壳挂 textRef
       指课内，正文不在这里（跨部的一批语料用 split 亦可，但本批拆分更简单）。 */
    { f: 'scripts/data/poems-corpus-510a.js', v: 'POEMS_CORPUS_510A', book: 'tangshi' },
    /* Issue #505 · 第四批（末批）：古文 15 篇 + 古诗 8 首（一份语料按 id 前缀拆开）。 */
    { f: 'scripts/data/classic-corpus-505d.js', v: 'CLASSIC_CORPUS_505D', book: 'classic' },
    { f: 'scripts/data/poems-corpus-505c.js', v: 'POEMS_CORPUS_505C', split: true },
    /* Issue #516 · 第一批：用户点名的古诗 50 篇 —— 一份语料含《唐诗》ts-* 与
       《古诗「非唐代」》gs-* 两部，按 id 前缀拆开（正文只落这一份）。 */
    { f: 'scripts/data/poems-corpus-516a.js', v: 'POEMS_CORPUS_516A', split: true },
    /* Issue #516 · 第二批（收尾批）：同上，一份语料含 ts-* 与 gs-* 两部。 */
    { f: 'scripts/data/poems-corpus-516b.js', v: 'POEMS_CORPUS_516B', split: true },
    /* Issue #517 · 第一批：古文 22 篇（壳里挂 textRef）。 */
    { f: 'scripts/data/classic-corpus-517a.js', v: 'CLASSIC_CORPUS_517A', book: 'classic' },
    /* Issue #461：唐诗补充 5 首 —— 壳文件排在前面（已在主表索引里），
       语料排在后面，供 `textOfEntry` 从 RAW_ENTRIES 取正文。 */
    { f: 'scripts/data/tangshi-corpus-461.js', v: 'APPEND_461', book: 'tangshi' },
    { f: 'scripts/data/tangshi-corpus-461b.js', v: 'TANGSHI_CORPUS_461B', book: 'tangshi' },
    { f: 'scripts/data/tangshi-corpus-461c.js', v: 'TANGSHI_CORPUS_461C', book: 'tangshi' },
    { f: 'scripts/data/tangshi-corpus-461d.js', v: 'TANGSHI_CORPUS_461D', book: 'tangshi' },
    /* Issue #471 · 第三轮：杜牧《题乌江亭》（ts-388）、刘禹锡《庭竹》（ts-389）。 */
    { f: 'scripts/data/tangshi-corpus-471c.js', v: 'TANGSHI_CORPUS_471C', book: 'tangshi' },
    { f: 'scripts/data/tangshi-corpus-471d.js', v: 'TANGSHI_CORPUS_471D', book: 'tangshi' },
    { f: 'data/poems-songci.js', v: 'POEMS_SONGCI' },
    /* Issue #461：「宋词三百首」改名「词」—— 补五代 / 金 / 清的词。 */
    { f: 'scripts/data/ci-corpus-461.js', v: 'CIWEN_CORPUS_461', book: 'songci' },
    { f: 'scripts/data/ci-corpus-461b.js', v: 'CIWEN_CORPUS_461B', book: 'songci' },
    { f: 'scripts/data/ci-corpus-461c.js', v: 'CIWEN_CORPUS_461C', book: 'songci' },
    { f: 'scripts/data/ci-corpus-461d.js', v: 'CIWEN_CORPUS_461D', book: 'songci' },
    { f: 'scripts/data/ci-corpus-471.js', v: 'CIWEN_CORPUS_471', book: 'songci' },
    /* Issue #471 · 第二轮：陆凯《赠范晔诗》+ 陆游十首。 */
    { f: 'scripts/data/gushi-corpus-471b.js', v: 'GUSHI_CORPUS_471B', book: 'gushi' },
    { f: 'scripts/data/gushi-corpus-480.js', v: 'GUSHI_CORPUS_480', book: 'gushi' },
    /* Issue #471 · 第三轮：杨万里《闲居初夏午睡起二首》+ 苏轼《海棠》。
       ⚠️ 语料表按「一份文件 → 一部集子」一一对应：`book` 只用来建
       `book + '-' + id` 这个取正文的键。同一份语料登记两次，file 推出来的
       `book` 会把 list 里**每一条**都挂到第二个前缀下 —— 生成出
       `gushi-ts-388` 这种谁也不认的影子条目（正文明明只有一份）。
       跨部的那一条壳（《唐诗》ts-390）自己不写正文，壳里挂 `textRef`
       指向 gushi-gs-55；一份正文只落 gs-55 这一处。 */
    { f: 'scripts/data/gushi-corpus-471c.js', v: 'GUSHI_CORPUS_471C', book: 'gushi' },
    /* Issue #505 · 第一批：古诗 16 首（唐诗 4 + 非唐诗 12 混在一份语料里）。
       ⚠️ 一份语料跨两部集子 —— `book` 只用来建「部 + '-' + id」这个取正文的键，
       所以这一份**按 id 前缀自己拆开**（见下面 byFile 的分派），不整个登记两次：
       整份登记两次会按每个前缀把每一条都挂一遍，生成 `gushi-ts-391` 这种影子键。 */
    { f: 'scripts/data/poems-corpus-505a.js', v: 'POEMS_CORPUS_505A', split: true },
    { f: 'scripts/data/poems-corpus-505b.js', v: 'POEMS_CORPUS_505B', split: true },
    { f: 'scripts/data/ci-corpus-471b.js', v: 'CIWEN_CORPUS_471B', book: 'songci' },
    { f: 'scripts/data/ci-corpus-461e.js', v: 'CIWEN_CORPUS_461E', book: 'songci' },
    /* Issue #461 · 第六轮：苏轼 / 李清照宋词名篇各 5 首。 */
    { f: 'scripts/data/ci-corpus-461f.js', v: 'CIWEN_CORPUS_461F', book: 'songci' },
    { f: 'data/poems-guwen.js', v: 'POEMS_GUWEN' },
    /* Issue #461：古文观止补篇（222 篇对齐）—— 壳文件只存归属，
       正文在 scripts/data/guwen-corpus-222.js。语料排在壳文件之后，
       供 `textOfEntry` 从 RAW_ENTRIES 取正文。 */
    { f: 'scripts/data/guwen-corpus-222.js', v: 'GUWEN_CORPUS_222', book: 'guwen' },
    { f: 'data/poems-zhaoming.js', v: 'POEMS_ZHAOMING' },
    { f: 'data/poems-yuanqu.js', v: 'POEMS_YUANQU' },
    { f: 'scripts/data/qu-corpus-461.js', v: 'QU_CORPUS_461', book: 'yuanqu' },
    { f: 'data/poems-yuefu.js', v: 'POEMS_YUEFU' },
    { f: 'data/poems-jinxiandai.js', v: 'POEMS_JINXIANDAI' },
    { f: 'data/poems-chengyu.js', v: 'POEMS_CHENGYU' },
    { f: 'data/poems-changshi.js', v: 'POEMS_CHANGSHI' },
    { f: 'data/poems-mingshu.js', v: 'POEMS_MINGSHU' },
    /* Issue #399：历代名家拆两部 —— 两份壳同属「历代名家」这一族，
       台账前缀都是 mingren（下面 byFile 显式给，不从文件名推）。 */
    { f: 'data/poems-mingren-cn.js', v: 'POEMS_MINGREN_CN', book: 'mingren' },
    { f: 'data/poems-mingren-foreign.js', v: 'POEMS_MINGREN_FOREIGN', book: 'mingren' },
    /* Issue #407：帝王两卷 —— 与历代名家同属「词条式」，两份壳共用一个台账前缀。 */
    { f: 'data/poems-emperor-cn.js', v: 'POEMS_EMPEROR_CN', book: 'dwang' },
    { f: 'data/poems-emperor-waiguo.js', v: 'POEMS_EMPEROR_FOREIGN', book: 'dwang' },
    { f: 'data/chengyu-support.js', v: 'CHENGYU_SUPPORT' }
  ];
  /* 「集子内 id 前缀 → 台账部名前缀」的对照表（只给跨部语料用，见上面的 split 分支）。 */
  var SPLIT_PREFIX = { ts: 'tangshi', gs: 'gushi', sc: 'songci', gw: 'classic', gwj: 'guwen' };

  FILES.forEach(function (o) {
    if (o.v === 'CHENGYU_SUPPORT') return;
    /* `book` 是从**文件名**推的台账前缀，一文件一部。历代名家那两份壳同属
       一部（mingren），名字里却带 `-cn` / `-foreign` —— 所以允许显式给。
       ⚠️ 语料表（`scripts/data/*.js`）不是壳，文件名推不出部名，**必须显式
       给 `book`**；不给就会拿整条路径当前缀（`scripts/data/corpus-471c-gs-55`
       这种谁都不认的影子键），而壳里的 `textRef` 是 `gushi-gs-55` ——
       于是正文取不到、条目掉出主表。 */
    var book = o.book;
    if (!book && !o.split) {
      if (o.f.indexOf('scripts/data/') === 0) {
        throw new Error('语料表必须显式给 book：' + o.f + '（v=' + o.v + '）');
      }
      book = o.f.replace('data/poems-', '').replace('.js', '');
      if (/^\d+$/.test(book)) book = 'poems';
    }
    (sandbox[o.v] || []).forEach(function (p) {
      if (!p || !p.id) return;
      if (o.split) {
        /* 跨部的一份语料：按 id 前缀分派到**各自的台账前缀**（Issue #505 第一批）。
           语料里的 id 是「集子内 id」（ts-391 / gs-58），台账键是「部 + '-' + 集子内 id」
           （tangshi-ts-391 / gushi-gs-58）—— 两个前缀不是同一个词（ts ≠ tangshi，
           gs ≠ gushi），所以要过一张对照表，不能拿 id 前缀直接当台账前缀。 */
        var localPrefix = p.id.split('-')[0];
        var ledger = SPLIT_PREFIX[localPrefix];
        if (!ledger) {
          throw new Error('跨部语料里出现没人认的 id 前缀：' + p.id +
            '（' + o.f + '）—— 到 SPLIT_PREFIX 里补一条对照');
        }
        RAW_ENTRIES[ledger + '-' + p.id] = p;
        return;
      }
      RAW_ENTRIES[book + '-' + p.id] = p;
    });
  });
})();
var inIndex = {};
sandbox.SITE_INDEX.forEach(function (p) { if (p && p.id) inIndex[p.id] = true; });

/* Issue #505 · 第二批：哪些主表键是**壳认领过的**。
   壳与语料共用同一个键时（壳 gw-182 挂 classic-gw-182），语料登记在后会把
   壳那条覆盖掉 —— 之后单看 RAW_ENTRIES 就认不出「这个键原本是壳」了。
   所以这里从原始壳文件（POEMS_* / 各语料表）把 textRef 全收一遍。 */
var CLAIMED = {};
(function () {
  var SHELL_VARS = ['POEMS_CLASSIC', 'POEMS_TANGSHI', 'POEMS_GUSHI', 'POEMS_SONGCI',
    'POEMS_GUWEN', 'POEMS_ZHAOMING', 'POEMS_YUANQU', 'POEMS_YUEFU', 'POEMS_JINXIANDAI',
    'POEMS_CHENGYU', 'POEMS_CHANGSHI', 'POEMS_MINGSHU', 'POEMS_MINGREN_CN',
    'POEMS_MINGREN_FOREIGN', 'POEMS_EMPEROR_CN', 'POEMS_EMPEROR_FOREIGN'];
  SHELL_VARS.forEach(function (v) {
    (sandbox[v] || []).forEach(function (p) { if (p && p.textRef) CLAIMED[p.textRef] = true; });
  });
})();

var BOOTSTRAPPED = [];
Object.keys(RAW_ENTRIES).forEach(function (id) {
  /* Issue #505：条目**已经在 SITE_INDEX 里、但正文是空的**（新加的壳只挂
     textRef，而 textRef 指的那一篇是课内单篇 —— 课内单篇不进主表，
     `masterTextOf` 在装配时取不到正文）。这一条也要从 RAW_ENTRIES 补一次，
     否则它与课文那一条的判重键（空串）对不上、判重表里合不到一处。
     原先只有 `if (inIndex[id]) return;` —— 新壳被静默跳过，正文取不到也无人报错。 */
  var existing = inIndex[id]
    ? sandbox.SITE_INDEX.filter(function (x) { return x && x.id === id; })[0]
    : null;
  if (existing && (existing.text || existing.translation)) return;
  if (existing) {
    var back = RAW_ENTRIES[id];
    var bt = { text: back.text || '', translation: back.translation || '',
      translationSource: back.translationSource || '' };
    if (!bt.text && back.textRef) {
      var bu = RAW_ENTRIES[back.textRef];
      if (bu && bu.text) bt = { text: bu.text || '', translation: bu.translation || '',
        translationSource: bu.translationSource || '' };
    }
    if (!bt.text && back.textRef) {
      var bh = (prev[back.textRef] || prev[id]) || null;
      if (bh && bh.text) bt = { text: bh.text || '', translation: bh.translation || '',
        translationSource: bh.translationSource || '' };
    }
    if (bt.text) {
      existing.text = bt.text;
      existing.translation = bt.translation;
      existing.translationSource = bt.translationSource;
      BOOTSTRAPPED.push(id);
    }
    return;
  }
  var raw = RAW_ENTRIES[id];

  /* Issue #505 · 第二批：语料条目（`classic-gw-182` 这种键）不是「壳」——
     它只供壳挂 textRef 取正文，不给自己进站点索引。判据：**没带 textRef
     却有正文**的，就是语料；但有两类例外要放行：
       ① 壳的 id 与该壳 textRef 指的**是同一个键**（第二批就是这个排法：
          壳 gw-182 挂 classic-gw-182）—— 这时它既是壳又是正文来源；
       ② 壳 id 与语料键不同（gw-187 挂 classic-gw-185）—— 这时语料键只在
          `RAW_ENTRIES` 里供取正文，由壳那一条进索引。 */
  if (raw.text && !raw.textRef && !CLAIMED[id]) return;

  var t = { text: raw.text || '', translation: raw.translation || '',
    translationSource: raw.translationSource || '' };
  if (!t.text && raw.textRef) {
    var up = RAW_ENTRIES[raw.textRef];
    if (up && up.text) t = { text: up.text || '', translation: up.translation || '',
      translationSource: up.translationSource || '' };
  }

  if (!t.text) {
    /* Issue #399（历代名家拆两部）：新 id（mingren-mr-c-xx）在主表里还没有
       正文，但同一个人的正文接在**老号**上 —— 壳里的 `masterRef` 就是这条线。

       ⚠️ 这条兜底**按姓名认，不按 masterRef 里的号去查**。原先写的是
       `prev[raw.masterRef]`，两处都错：
         · `masterRef` 的值是**主表的 id**（`mingren-mr-c-08`），不是别名键；
         · 主表里恰好有一个**同号的别的条目**（`mingren-mr-11` 是恩培多克勒，
           而 `masterRef: "mingren-mr-11"` 是苏格拉底的影子号）—— 一查就查到
           别人头上，静默错、不落空。
       `prev` 是按 id 建的，没有按姓名查的入口；而按姓名认正是这一步的本意：
       壳里那一条的 title 就是主表里那一条的 title。 */
    var byTitle = {};
    Object.keys(prev).forEach(function (k) {
      if (prev[k] && prev[k].title) byTitle[prev[k].title] = k;
    });
    var alias = raw.masterRef || null;
    var hit = prev[id] || (raw.textRef ? prev[raw.textRef] : null)
      || (alias ? prev[alias] : null)
      || (raw.title ? prev[byTitle[raw.title]] : null);
    if (hit) t = { text: hit.text || '', translation: hit.translation || '',
      translationSource: hit.translationSource || '' };
  }
  if (!t.text) return;

  if (id.indexOf('poems-') === 0) return;
  var book = id.indexOf('poems-') === 0 ? 'poems' : id.split('-')[0];
  var localId = id.indexOf('poems-') === 0 ? id.slice(6) : id.slice(book.length + 1);
  sandbox.SITE_INDEX.push({
    id: id, originId: localId, title: raw.title, author: raw.author || '',
    authorName: raw.authorName || '', dynasty: raw.dynasty || '',
    source: raw.source || '', selection: raw.selection || '',
    gradeGroup: raw.gradeGroup || '', meaning: raw.meaning || '', grade: raw.grade, term: raw.term,
    text: t.text, translation: t.translation, translationSource: t.translationSource,
    book: book, bookName: book, page: book + '/'
  });
  inIndex[id] = true;
  BOOTSTRAPPED.push(id);
});

Object.keys(prev).forEach(function (id) {
  if (id.indexOf('poems-') !== 0) return;
  var raw = RAW_ENTRIES[id];
  if (!raw || raw.text) return;
  var t = prev[raw.textRef] || prev[id];
  if (!t || !t.text) return;
  var exist = sandbox.SITE_INDEX.filter(function (x) { return x.id === id; })[0];
  if (exist) {
    if (!exist.text) {
      exist.text = t.text;
      exist.translation = t.translation || "";
      exist.translationSource = t.translationSource;
    }
    inIndex[id] = true;
    return;
  }
  sandbox.SITE_INDEX.push({
    id: id, originId: id.slice(6), title: raw.title, author: raw.author || '',
    authorName: raw.authorName || '', dynasty: raw.dynasty || '',
    source: raw.source || '', selection: raw.selection || '',
    gradeGroup: raw.gradeGroup || '', meaning: raw.meaning || '', grade: raw.grade, term: raw.term,
    text: t.text, translation: t.translation || '',
    translationSource: t.translationSource, book: 'poems', bookName: 'poems', page: '/'
  });
  inIndex[id] = true;
});

if (BOOTSTRAPPED.length) {
  console.log('（' + BOOTSTRAPPED.length + ' 条首次进入主表的条目：' +
    '它们原先只有 textRef、正文取不到，本轮先从原始数据文件那一段补回索引）');
}

/* Issue #516 · 第二批：**先把语料表的正文刷新回已在索引里的那些条目**。
   `data/site-index.js` 是用上一版主表装配的，主表里有些条目是按题名兜底认
   正文的；新语料里出现**同题不同文**的作品时（《劝学》荀子 / 颜真卿），壳
   挂的 textRef 会先被主表里那条同名条目认领，拿到别人的正文 —— 两条于是
   被误判成「同篇」合流。语料表 RAW_ENTRIES 才是源，先覆盖一遍再重建判重表。 */
(function () {
  function textOf(raw) {
    if (!raw) return null;
    if (raw.text) return { text: raw.text, translation: raw.translation || '',
      translationSource: raw.translationSource || '' };
    /* 壳只挂 textRef 的那些：正文在它指的那一条上（语料表或同部的壳）。 */
    if (raw.textRef && RAW_ENTRIES[raw.textRef]) {
      var up = RAW_ENTRIES[raw.textRef];
      if (up.text) return { text: up.text, translation: up.translation || '',
        translationSource: up.translationSource || '' };
    }
    return null;
  }
  sandbox.SITE_INDEX.forEach(function (p) {
    if (!p || !p.id || p.id.indexOf('poems-') === 0) return;
    var t = textOf(RAW_ENTRIES[p.id])
      || textOf(RAW_ENTRIES[p.book + '-' + p.originId]);
    if (!t) return;
    p.text = t.text;
    p.translation = t.translation;
    p.translationSource = t.translationSource;
  });
})();

(function () {
  const named = {};
  (sandbox.CHENGYU_SUPPORT || []).forEach(function (x) { if (x && x.title) named[x.title] = true; });
  const splitIds = {};
  (sandbox.POEMS_CHENGYU || []).forEach(function (p) {
    if (p && named[p.title]) splitIds['chengyu-' + p.id] = true;
  });
  if (!Object.keys(splitIds).length) return;
  sandbox.WORKS_GROUPS = (sandbox.WORKS_GROUPS || []).map(function (g) {
    const kept = (g.entries || []).filter(function (e) { return !splitIds[e]; });
    if (kept.length === g.entries.length) return g;
    if (kept.length < 2) return null;
    return { wid: g.wid, title: g.title, titles: (g.titles || []).filter(function (t) {
      return !named[t];
    }), entries: kept };
  }).filter(Boolean);
})();

sandbox.WorksIndex.rebuild(sandbox.SITE_INDEX);

const byId = {};
sandbox.SITE_INDEX.forEach(function (p) { byId[p.id] = p; });

const sig = function (t) { return String(t || '').replace(/\s+/g, ''); };

const master = [];

function versionOf(m) {
  const raw = [m.text, m.translation, m.translationSource].join('\u0001');
  let h = 5381;
  for (let i = 0; i < raw.length; i += 1) h = ((h * 33) ^ raw.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
WI.works.forEach(function (w) {
  if (w.entries.length < 2) return;
  const rep = WI.repOf(w.entries[0]);
  const repEntry = byId[rep];
  if (!repEntry) return;
  const t = textOfEntry(repEntry, rep);
  master.push({
    work: w.wid,
    id: rep,
    title: repEntry.title,
    entries: w.entries.slice(),
    text: t.text,
    translation: t.translation,
    translationSource: t.translationSource
  });
});
const SPLIT = {};
(sandbox.CHENGYU_SUPPORT || []).forEach(function (s) {
  if (s && s.title) SPLIT['chengyu-' + s.title] = true;
});
const splitTitles = {};
(sandbox.POEMS_CHENGYU || []).forEach(function (p) {
  if (p && SPLIT['chengyu-' + p.title]) splitTitles['chengyu-' + p.id] = p;
});
if (Object.keys(splitTitles).length) {
  master.forEach(function (m) {
    const keep = (m.entries || []).filter(function (e) { return !splitTitles[e]; });
    if (keep.length === (m.entries || []).length) return;
    if (!keep.length) return;
    m.entries = keep;
        const rep = WI.repOf(keep[0]);
    const repEntry = byId[rep] || byId[keep[0]];
    if (!repEntry) return;
    const t = textOfEntry(repEntry, rep);
    m.work = WI.widOf(rep) || ('w-' + rep);
    m.id = rep;
    m.title = repEntry.title;
    m.text = t.text;
    m.translation = t.translation;
    m.translationSource = t.translationSource;
  });
  Object.keys(splitTitles).forEach(function (id) {
    if (master.some(function (m) { return m.id === id; })) return;
    const p = byId[id];
    if (!p) return;
    const s = (sandbox.CHENGYU_SUPPORT || []).filter(function (x) {
      return 'chengyu-' + x.title === 'chengyu-' + p.title;
    })[0] || {};
    master.push({
      work: 'w-' + id,
      id: id,
      title: p.title,
      entries: [id],
      text: s.text || p.text || '',
      translation: s.translation || p.translation || '',
      translationSource: p.translationSource || 'public-domain'
    });
  });
}

master.sort(function (a, b) { return a.id < b.id ? -1 : 1; });

const seen = {};
master.forEach(function (m) { (m.entries || []).forEach(function (e) { seen[e] = true; }); });

const fullBooksReport = [];
const FULL_BOOK_SET = {};
FULL_BOOKS.forEach(function (b) { FULL_BOOK_SET[b] = true; });

sandbox.SITE_INDEX.forEach(function (p) {
  if (!p || p.isBook || !p.id) return;

  if (!FULL_BOOK_SET[p.book]) return;
  if (seen[p.id]) return;
  /* Issue #461：新增的唐诗补充条目，壳里只挂 textRef、正文在语料表
     （scripts/data/tangshi-corpus-461.js）—— 这里先从 RAW_ENTRIES 取一份
     再判断，否则「有正文」的条目会被当成「空条目」漏掉。 */
  if ((!p.text && !p.translation) && RAW_ENTRIES[p.id]
      && (RAW_ENTRIES[p.id].text || RAW_ENTRIES[p.id].translation)) {
    const raw = RAW_ENTRIES[p.id];
    p.text = raw.text || '';
    p.translation = raw.translation || '';
    p.translationSource = raw.translationSource || '';
  }
  if (!p.text && !p.translation) return;
  const t = textOfEntry(p, p.id);
  master.push({
    work: 'w-' + p.id,
    id: p.id,
    title: p.title,
    entries: [p.id],
    text: t.text,
    translation: t.translation,
    translationSource: t.translationSource
  });
  seen[p.id] = true;
  const rec = fullBooksReport.filter(function (r) { return r.book === p.book; })[0];
  if (rec) rec.n += 1;
  else fullBooksReport.push({ book: p.book, n: 1 });
});
master.sort(function (a, b) { return a.id < b.id ? -1 : 1; });

const notInMaster = [];
sandbox.SITE_INDEX.forEach(function (p) {
  if (!p || p.isBook || !p.id) return;
  if (!FULL_BOOK_SET[p.book]) return;
  if (!p.text && !p.translation) return;
  if (seen[p.id]) return;
  notInMaster.push(p.id + '（' + (p.book || '?') + '）');
});
if (notInMaster.length) {
  console.error('✗ 清单点名的部里有 ' + notInMaster.length + ' 条「有正文」的条目没有进主表：' +
    notInMaster.slice(0, 8).join('、'));
  console.error('  多半是忘了重跑本脚本，或那一条的 textRef / id 拼错了。');
  process.exit(1);
}

const BOOK_FILES = [
  'data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js',
  'data/poems-5.js', 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js',
  'data/poems-9.js', 'data/poems-10.js', 'data/poems-11.js', 'data/poems-12.js',
  'data/poems-classic.js', 'data/poems-tangshi.js', 'data/poems-gushi.js', 'data/poems-songci.js',
  'data/poems-guwen.js', 'data/poems-zhaoming.js', 'data/poems-yuanqu.js',
  'data/poems-yuefu.js', 'data/poems-jinxiandai.js', 'data/poems-chengyu.js',
  'data/poems-changshi.js'
];

void fullBooksReport;

const inlineCopies = [];
BOOK_FILES.forEach(function (f) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');

  src.split(/\n(?=\s*\{)/).forEach(function (blk) {
    const refM = blk.match(/textRef:\s*"([^"]+)"/);
    if (!refM) return;
    const idM = blk.match(/\bid:\s*"([^"]+)"/);
    if (!idM) return;
    if (/^\s+text:\s*"/m.test(blk) || /^\s+translation:\s*"/m.test(blk)) {
      inlineCopies.push(f + ' · ' + idM[1]);
    }
  });
});

const stale = inlineCopies.filter(function (x) {
  const id = x.split(' · ')[1];
  const file = x.split(' · ')[0];
  const prefix = file.replace('data/poems-', '').replace('.js', '');
  return prev[prefix + '-' + id] || prev[id];
});
if (stale.length) {
  console.error('✗ 有 ' + stale.length + ' 条条目一边带着 textRef、一边还内联着正文：');
  stale.slice(0, 8).forEach(function (x) { console.error('    ' + x); });
  console.error('  这是「同一篇正文在磁盘上存了两份」—— 跑 scripts/apply-text-master.js 摘掉。');
  process.exit(1);
}
if (inlineCopies.length) {
  console.log('（' + inlineCopies.length + ' 条本轮新收的条目：正文收进主表后由 ' +
    'scripts/apply-text-master.js 摘去内联副本）');
}

const NEAR_BY_KEY = {};

const VARIANT = [
  ["惟", "唯"], ["霪", "淫"], ["蘋", "苹"], ["翦", "剪"], ["皇", "凰"],
  ["懃", "勤"], ["絜", "洁"], ["岀", "出"], ["閒", "闲"], ["彊", "强"]
];
function loose(t) {
  let s = String(t || '').replace(/\s+/g, '');
  VARIANT.forEach(function (p) { s = s.split(p[0]).join(p[1]); });
  return s;
}

sandbox.SITE_INDEX.forEach(function (p) {
  if (!p || p.isBook || !p.text || !p.id) return;
  const k = loose(p.text);
  if (!k) return;
  if (!NEAR_BY_KEY[k]) NEAR_BY_KEY[k] = [];
  NEAR_BY_KEY[k].push(p.id);
});
const nearPairs = [];
Object.keys(NEAR_BY_KEY).forEach(function (k) {
  const ids = NEAR_BY_KEY[k];

  const loose2strict = {};
  ids.forEach(function (id) {
    const strict = sig(byId[id].text);
    (loose2strict[strict] = loose2strict[strict] || []).push(id);
  });
  const variants = Object.keys(loose2strict);
  if (variants.length < 2) return;
  nearPairs.push({
    entries: ids.slice(),

    reason: variants.length === 1
      ? "正文在标点 / 断行上不同，字面相同"
      : "一字之差的两条文本传统（选本原貌 vs 教材 / 通行字），并列而不合并"
  });
});
nearPairs.sort(function (a, b) { return a.entries[0] < b.entries[0] ? -1 : 1; });

const dupInline = [];
master.forEach(function (m) {
  (m.entries || []).forEach(function (eid) {
    if (m.id === eid) return;
    const book = eid.split('-')[0];
    const files = book === 'poems'
      ? ['data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js',
         'data/poems-5.js', 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js',
         'data/poems-9.js', 'data/poems-10.js', 'data/poems-11.js', 'data/poems-12.js']
      : ['data/poems-' + book + '.js'];
    const localId = eid.slice(book.length + 1);
    files.forEach(function (f) {
      if (!fs.existsSync(path.join(ROOT, f))) return;
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      const hit = src.split(/\n(?=\s*\{)/).filter(function (blk) {
        return new RegExp('id:\\s*"' + localId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"').test(blk) &&
          /^\s+text:\s*"/m.test(blk);
      })[0];
      if (hit) dupInline.push(eid + '（与主表 ' + m.id + ' 同时带正文）');
    });
  });
});

if (dupInline.length) {
  console.log('（' + dupInline.length + ' 条条目与主表那一份同时带着正文 —— ' +
    '本轮刚收上来的，接着跑 scripts/apply-text-master.js 摘去内联副本）');
}

/* 让号重排最容易犯的错是「重号」：两个语料文件各按「集内末尾 +1」取号，
   分头开发时看不到对方，合流时撞在同一个坑里（#461 的 sc-318 撞上 #471 的
   sc-318）。这里当场点名 —— 拼错 id 的那份语料会被覆盖掉一个，静默丢篇。 */
(function () {
  const byEntry = {};
  master.forEach(function (m) {
    (m.entries || []).forEach(function (e) {
      (byEntry[e] = byEntry[e] || []).push(m.id);
    });
  });
  const clash = Object.keys(byEntry).filter(function (e) { return byEntry[e].length > 1; });
  if (clash.length) {
    console.error('✗ 有 ' + clash.length + ' 个条目 id 挂在主表的多条记录上：');
    clash.slice(0, 8).forEach(function (e) {
      console.error('    ' + e + ' → ' + byEntry[e].join('、'));
    });
    console.error('  多半是两份语料各行其是、取了同一个号 —— 让晚占的那篇移号。');
    process.exit(1);
  }
})();

const empty = master.filter(function (m) { return !m.text; });
if (empty.length) {
  console.error('✗ 有 ' + empty.length + ' 条主表条目的正文为空：' +
    empty.map(function (m) { return m.id; }).join('、'));
  console.error('  多半是先跑了 apply-text-master.js（已摘内联正文）又重跑本脚本，');
  console.error('  而 data/text-master.js 已被清空 —— 先从 git 取回旧表再来。');
  process.exit(1);
}

const BT = '`';
let out = '';
out += '/* ==========================================================================\n';
out += '   正文存储主表（同一篇作品的正文 / 译文只落一份）\n';
out += '   --------------------------------------------------------------------------\n';
out += '   由 scripts/build-text-master.js 离线算出，共 ' + master.length + ' 条。\n';
out += '\n';
out += '   ⚠️ 这是**生成文件**，改动请改 scripts/build-text-master.js 后重跑，\n';
out += '      不要手改这里 —— 下次重新生成会把手工改动覆盖掉。\n';
out += '\n';
out += '   ## 它解决什么\n';
out += '   同一篇作品（《答谢中书书》课内八年级上 + 小古文、《登高》课内高一上 +\n';
out += '   唐诗卷五……）此前在每一部集子的数据文件里**各存一份完整正文与译文**。\n';
out += '   显示层虽已按 data/canonical-texts.js 统一成「课本那一份」，\n';
out += '   但磁盘上仍是五份副本：改一处要改五处，漏一处就又不一致。\n';
out += '\n';
out += '   这一份把这份文本收归**一处**；其余集子的条目退化成只存归属 ——\n';
out += '   条目上留 ' + BT + 'textRef: "<主条目站点 id>"' + BT + '，正文与译文\n';
out += '   由引擎（js/reader-core.js）按 ' + BT + 'textRef' + BT + ' 到这里取。\n';
out += '\n';
out += '   ## 收归范围（已收齐）\n';
out += '     ① 「在两部及以上集子里重复出现」的作品 —— 判重表自动收；\n';
out += '     ② FULL_BOOKS 点名的六部集子里**其余全部单篇**（历史声明，\n';
out += '        六部收齐后本表已按「凡在册且带正文的条目一律全收」执行）。\n';
out += '   于是：在册却还带内联正文的条目即为异常（同一个脚本里两处断言会点名）。\n';
out += '\n';
out += '   ## 与另外两张表的分工\n';
out += '     data/works-map.js        哪些条目是**同一篇作品**（判重、搜索去重、排程合流）\n';
out += '     data/canonical-texts.js  显示层：同一篇**显示**用哪一份正文（收归之后已收敛为空表，\n';
out += '                              机制留着给日后真出现异文时用）\n';
out += '     data/text-master.js      存储层：同一篇的正文 / 译文**只落一份**（本文件）\n';
out += '   三张表由同一套口径算出（课内条目为主条目），一起重跑。\n';
out += '\n';
out += '   ## 字段\n';
out += '     work        作品 id（与 data/works-map.js 的 wid 一致）\n';
out += '     id          主条目站点索引 id（' + BT + 'poems-cz8-02' + BT + '，课内优先）\n';
out += '     title       主条目题名\n';
out += '     entries     这一篇的全部站点条目 id（含主条目自己）\n';
out += '     text        正文（**全站唯一一份**）\n';
out += '     translation 白话译文\n';
out += '     translationSource 译文来源\n';
out += '     version     内容的短摘要（版次）—— 客户端据它认出「这一条改过」，\n';
out += '                 好把本机存的老快照刷新掉（见 scripts/build-text-master.js）\n';
out += '   ========================================================================== */\n';
out += 'window.TEXT_MASTER = [\n';
master.forEach(function (m) {
  out += '  {\n';
  out += '    work: ' + JSON.stringify(m.work) + ',\n';
  out += '    id: ' + JSON.stringify(m.id) + ',\n';
  out += '    title: ' + JSON.stringify(m.title) + ',\n';
  out += '    entries: [' + m.entries.map(function (e) { return JSON.stringify(e); }).join(', ') + '],\n';
  out += '    text: ' + JSON.stringify(m.text) + ',\n';
  out += '    translation: ' + JSON.stringify(m.translation) + ',\n';
  out += '    translationSource: ' + JSON.stringify(m.translationSource) + ',\n';
  out += '    version: ' + JSON.stringify(versionOf(m)) + '\n';
  out += '  },\n';
});
out += '];\n';
out += '\n';
out += '/* ==========================================================================\n';
out += '   近重复对：同一篇却有两种写法，**故意不合并**\n';
out += '   --------------------------------------------------------------------------\n';
out += '   下面是「差不多是同一篇、但正文有一字之差」的那些对，共 ' + nearPairs.length + ' 组。\n';
out += '   它们**没有**被收进上面的主表 —— 因为一字之差往往不是录入出错，\n';
out += '   而是两条并列的文本传统：\n';
out += '\n';
out += '     · 选本原貌（《文选》作「凤皇」、《古文观止》作「霪雨」）\n';
out += '     · 教材 / 通行字（课本作「凤凰」，今通行本作「淫雨」）\n';
out += '\n';
out += '   裁定见 data/works-index.js：「课内以教材文本为准，选集以选本原貌为准，\n';
out += '   冲突时分成两条并列的作品，各背各的」—— 所以这里**只登记事实**，\n';
out += '   不去合并、也不改任何一份正文。主表收归的是「字面完全相同」的那些篇；\n';
out += '   这一份清单是它的边界：谁要是把这几篇也并了，学生就会读到\n';
out += '   与自己课本不一样的那一份《岳阳楼记》。\n';
out += '\n';
out += '   ⚠️ 这是**生成文件**，改动请改 scripts/build-text-master.js 后重跑。\n';
out += '\n';
out += '   字段：entries 两条（及以上）条目 id；reason 为什么它们「像同一篇而不合并」\n';
out += '   ========================================================================== */\n';
out += 'window.TEXT_NEAR_DUP = [\n';
nearPairs.forEach(function (p) {
  out += '  {\n';
  out += '    entries: [' + p.entries.map(function (e) { return JSON.stringify(e); }).join(', ') + '],\n';
  out += '    reason: ' + JSON.stringify(p.reason) + '\n';
  out += '  },\n';
});
out += '];\n';
out += '\n';
out += '/* ==========================================================================\n';
out += '   取数入口：把条目上的 textRef 展开成正文 / 译文\n';
out += '   --------------------------------------------------------------------------\n';
out += '   摘掉内联正文的条目只留一行 textRef，正文从这里取回。\n';
out += '   各消费方（站点索引、阅读引擎、搜索页……）都调这一个函数 ——\n';
out += '   各写一份迟早有一处忘了取，而表现只是「那一处正文空白」，不报错。\n';
out += '\n';
out += '   ⚠️ 带 textRef 的条目**一律以主表为准**，哪怕它在数据文件里还内联着一份\n';
out += '      正文。两处各存一份就是两个真相：换正文 / 换译文时改一处忘一处，\n';
out += '      表现是「同一部作品在两个页面上读到两种白话」——读者只会来问哪个对\n';
out += '      （Issue #339 要求「精准精确」，这一条是它的落点）。\n';
out += '\n';
out += '   ⚠️ 没有 textRef、或主表里查不到时**原样返回**，不做任何猜测：\n';
out += '      猜出来的正文比空白更糟 —— 空白一眼可见，取错一篇却看着正常。\n';
out += '   ========================================================================== */\n';
out += '(function () {\n';
out += '  "use strict";\n';
out += '\n';
out += '  var byId = null;\n';
out += '  function map() {\n';
out += '    if (byId) return byId;\n';
out += '    byId = {};\n';
out += '    (window.TEXT_MASTER || []).forEach(function (m) {\n';
out += '      if (!m) return;\n';
out += '      if (m.id) byId[m.id] = m;\n';
out += '      (m.entries || []).forEach(function (e) { if (e && !byId[e]) byId[e] = m; });\n';
out += '    });\n';
out += '    /* Issue #399（历代名家真拆两部）：两卷各出一份壳，正文仍只有一份\n';
out += '       （同一个人不抄两遍）。两份壳的主表 id 已各自落在主表上，平时一条\n';
out += '       别名都不写；这一段是**兜底** —— 万一主表里只有上一轮的老 id\n';
out += '       （mingren-mr-xx）、壳却是新的（mr-c-xx / mr-w-xx），就认回来。\n';
out += '\n';
out += '       ⚠️ 认法是**按姓名**，不是按 masterRef 里的号。原先写的是\n';
out += '       `byId[sh.masterRef]`，那一步会走到**同号的另一个条目**上：\n';
out += '       masterRef 的值是主表 id（mingren-mr-c-08），而主表里恰好有一个\n';
out += '       id 相同的别的条目（mingren-mr-11 / mingren-mr-12 …）—— 一查就\n';
out += '       查到了别人，静默错、不落空（#420 报的那次 413 条错位就是它）。\n';
out += '       按姓名认则天然对齐：壳里那一条的 title 就是正文那一条的 title。\n';
out += '\n';
out += '       排序用「名 → 主表 id」的索引，**不进 byId 的键空间** —— 别名键与\n';
out += '       真 id 同形（都是 mingren-*），混在一起迟早被人当成真条目。\n';
out += '       ⚠️ 只在**查不到**时兜底，不覆盖任何实条目。 */\n';
out += '    (function () {\n';
out += '      var shells = [].concat(\n';
out += '        window.POEMS_MINGREN_CN || [],\n';
out += '        window.POEMS_MINGREN_FOREIGN || []\n';
out += '      );\n';
out += '      var pending = [];\n';
out += '      shells.forEach(function (sh) {\n';
out += '        if (!sh || !sh.textRef || !sh.title) return;\n';
out += '        if (byId[sh.textRef]) return;\n';
out += '        pending.push(sh);\n';
out += '      });\n';
out += '      if (!pending.length) return;\n';
out += '      var byTitle = {};\n';
out += '      (window.TEXT_MASTER || []).forEach(function (m) {\n';
out += '        if (m && m.title && !byTitle[m.title]) byTitle[m.title] = m;\n';
out += '      });\n';
out += '      pending.forEach(function (sh) {\n';
out += '        var m = byTitle[sh.title];\n';
out += '        if (m) byId[sh.textRef] = m;\n';
out += '      });\n';
out += '    })();\n';
out += '    return byId;\n';
out += '  }\n';
out += '\n';
out += '  /**\n';
out += '   * 取这一条的正文 / 译文。\n';
out += '   * @param {Object} p      条目（可能带 textRef）\n';
out += '   * @param {String} [book] 所属集子 id —— textRef 记的是集子内 id 时补前缀再查\n';
out += '   * @returns {Object} 展开后的条目（无 textRef 或查不到时原样返回）\n';
out += '   */\n';
out += '  window.masterTextOf = function (p, book) {\n';
out += '    if (!p || !p.textRef) return p;\n';
out += '    var m = map()[p.textRef];\n';
out += '    if (!m && book) m = map()[book + "-" + p.textRef];\n';
out += '    if (!m) return p;\n';
out += '    var out = {};\n';
out += '    Object.keys(p).forEach(function (k) { if (k !== "text" && k !== "translation" && k !== "translationSource") out[k] = p[k]; });\n';
out += '    out.text = m.text || "";\n';
out += '    out.translation = m.translation || "";\n';
out += '    out.translationSource = m.translationSource || p.translationSource;\n';
out += '    out.version = m.version || "";\n';
out += '    return out;\n';
out += '  };\n';
out += '\n';
out += '  /**\n';
out += '   * 取这一条的**版次**（内容摘要）。\n';
out += '   * @param {Object} p      条目（可能带 textRef）\n';
out += '   * @param {String} [book] 所属集子 id\n';
out += '   * @returns {String} 版次；主表里查不到时回空串（不猜）\n';
out += '   */\n';
out += '  window.textVersionOf = function (p, book) {\n';
out += '    if (!p || !p.textRef) return "";\n';
out += '    var m = map()[p.textRef];\n';
out += '    if (!m && book) m = map()[book + "-" + p.textRef];\n';
out += '    return (m && m.version) || "";\n';
out += '  };\n';
out += '})();\n';
out += '\n';

fs.writeFileSync(path.join(ROOT, 'data/text-master.js'), out, 'utf8');
console.log('✓ data/text-master.js 已生成，共 ' + master.length + ' 条');
