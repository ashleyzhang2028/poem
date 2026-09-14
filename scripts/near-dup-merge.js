/**
 * 近重复合并：同一篇、两种写法的那些，按用字口径并成一篇
 * ==========================================================================
 * Issue #69 收尾的最后一轮。上一轮（PR #100）把「一字之差」的那些登记成
 * `WORKS_NEAR_DUP` / `TEXT_NEAR_DUP`，**并列而不合并** —— 当时的理由是
 * 「选本原貌 vs 教材 / 通行字」是两条文本传统，谁对谁错没人能裁。
 *
 * 用户这一轮给了裁定口径（原话）：
 *
 *   「近重复的那批，合并，以教材为准，没有教材的，以简体字为准，
 *     无法裁决的，自行判断并合并」
 *
 * 于是裁定分三档，逐条按序判：
 *
 *   1. **有教材的 → 以教材为准。** 课内作「**唯**见长江天际流」（人教版
 *      四年级下册）、选本作「惟见」→ 取教材的「唯」；
 *      课内作「回乐**烽**前沙似雪」（统编版七年级上册，教材注「烽，烽火台」）、
 *      选本作「回乐峰」→ 取教材的「烽」。
 *   2. **没有教材的 → 以简体字为准。** 贺铸《蝶恋花》两条都在《宋词三百首》里，
 *      一作「白**苹**花满湔裙处」、一作「白**蘋**」→ 取简体的「苹」。
 *   3. **都裁不了的 → 自行判断。** 本批没有落到这一档的；
 *      机制保留，遇到时在 `note` 里写明判断依据。
 *
 * ## 「合并」合并的是什么
 *   两条原本各存一份正文（只差一个字），于是同一首：
 *     · 在两个集子的列表里各出现一次（学生翻唐诗看到「惟见」、翻课内看到「唯见」）；
 *     · 全站搜索里并排站着两条，点哪条读到的字还不一样。
 *
 *   这一轮把「用字」统一到裁定后的那一种，然后**按同一篇收归**：
 *     · 留下那一条（课内优先）自入选本对应条目仍在，各集子的列表照旧完整；
 *     · 两条的正文收归 `data/text-master.js` 那唯一一份（用字已统一），
 *       另一条退化成只存 `textRef` 的归属条目 —— 与全站其余 57 篇同一套机制；
 *     · 判重/搜索/自选集合据此把两条认成**同一篇**（`works-map.js` 归组），
 *       搜索只出一条、自选集合里加不进第二遍、排程只排一次。
 *
 * ## 落地顺序（本脚本只登记裁定；改语料由既有的三个生成器完成）
 *   1. `node scripts/near-dup-merge.js --apply`  本脚本：统一用字（改正文里那一个字）
 *   2. `node scripts/build-works-map.js`         判重表：两组各并成一篇
 *   3. `node scripts/build-text-master.js`       存储主表：收归这两篇
 *   4. `node scripts/apply-text-master.js`       把选本那一条的内联正文摘成 textRef
 *   5. `node scripts/build-canonical-texts.js`   显示层裁定表（预期 0 条）
 *
 * ⚠️ 逐组的裁定依据写在下面的 `note` 里，测试逐条守着（见 test/dedup.test.js
 *    第「七、近重复合并」节）—— 以后谁改了用字或撤了合并，都会红。
 *
 * 用法：node scripts/near-dup-merge.js            # 预演（只报告，不改文件）
 *       node scripts/near-dup-merge.js --apply    # 真改（只改用字那一处）
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* --------------------------------------------------------------------------
   裁定表：每组登记「用哪一种写法、依据是什么」。
   `keep` = 教材口径的那一条（课内优先）；`drop` = 跟它并成一篇的那一条。
   `word` / `fromWord`：要把 `drop` 那一条的正文里哪个字改成哪个字。
   ⚠️ 只改正文与译文里的这**一个字**，题名 / 作者 / 卷次 / 出处一律不动 ——
      它们是「从哪本选里读到这一篇」的归属信息，两份是各自选本的口径。
   -------------------------------------------------------------------------- */
const MERGES = [
  {
    keep: 'poems-xx4-23', drop: 'tangshi-ts-259',
    rule: 'course',
    title: '黄鹤楼送孟浩然之广陵',
    word: '唯', fromWord: '惟',
    note: '教材（人教版四年级下册）作「唯见长江天际流」，选本作「惟见」——有教材，以教材为准'
  },
  {
    keep: 'poems-cz7-08', drop: 'tangshi-ts-270',
    rule: 'course',
    title: '夜上受降城闻笛',
    word: '烽', fromWord: '峰',
    note: '教材（统编版七年级上册）作「回乐烽前沙似雪」并注「烽，烽火台」，选本作「回乐峰」——有教材，以教材为准'
  },
  {
    keep: 'poems-gz11-06', drop: 'tangshi-ts-78',
    rule: 'course',
    title: '将进酒',
    word: '愿', fromWord: '复',
    note: '教材（统编版高二下）作「但愿长醉不愿醒」，选本作「但愿长醉不复醒」——有教材，以教材为准；' +
      '另有「五花马、千金裘」与「五花马，千金裘」的顿号 / 逗号之别，一并按教材写法统一'
  },
  {
    /* 留下 sc-134：它的题名是选本原名（《蝶恋花·改徐冠卿词》）；
       sc-127 的「蝶恋花·其一」是补录时按目录先后自拟的编号，不是选本原名
       （见 data/poems-songci.js 文件头「篇名校正」一节），删掉它不丢选本信息。 */
    keep: 'songci-sc-134', drop: 'songci-sc-127',
    rule: 'simplified',
    title: '蝶恋花·改徐冠卿词',
    /* ⚠️ 这一组「用字要改的是**留下**的那一条」：留下的是选本原名标题
       （《蝶恋花·改徐冠卿词》），但它的正文作「白蘋」；按「以简体字为准」
       要改成「白苹」。另一条（sc-127）本就作「白苹」，只是题名是自拟编号。 */
    keepWord: '苹', keepFromWord: '蘋',
    word: '蘋', fromWord: '苹',
    remove: true,
    note: '两条同在《宋词三百首》（贺铸），没有教材可比；「苹」是简体写法，按简体字为准取「苹」'
  }
];

/* 各集子的数据文件 */
const BOOK_FILE = {
  classic: 'data/poems-classic.js',
  tangshi: 'data/poems-tangshi.js',
  songci: 'data/poems-songci.js',
  guwen: 'data/poems-guwen.js',
  zhaoming: 'data/poems-zhaoming.js'
};
const POEMS_FILES = [];
for (let i = 1; i <= 12; i++) POEMS_FILES.push('data/poems-' + i + '.js');
function filesOf(siteId) {
  const book = siteId.split('-')[0];
  return book === 'poems' ? POEMS_FILES : [BOOK_FILE[book]];
}

const ENTRY_START = /^  \{/;
const ENTRY_END = /^  \},?\s*$/;
const ID_LINE = /(?:^\s*|\{\s*)id:\s*"([^"]+)"/;

/** 把一条条目原文切出来（含起止行），找不到返回 null */
function findEntry(file, innerId) {
  const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!ENTRY_START.test(lines[i])) continue;
    let j = i;
    while (j < lines.length && !ENTRY_END.test(lines[j])) j++;
    const block = lines.slice(i, j + 1);
    const m = block.join('\n').match(ID_LINE);
    if (m && m[1] === innerId) return { start: i, end: j, block: block, file: file };
    i = j;
  }
  return null;
}
function locate(siteId) {
  const innerId = siteId.slice(siteId.indexOf('-') + 1);
  let hit = null;
  filesOf(siteId).forEach(function (f) { if (!hit) hit = findEntry(f, innerId); });
  return hit;
}

module.exports = { MERGES };

/* ---------------------------------- 主流程 --------------------------------- */
if (require.main !== module) return;

const APPLY = process.argv.indexOf('--apply') >= 0;
const vm = require('vm');

/* 载入语料，校验每一对确实「只差一字」、且裁定后的用字确实只差这一处 */
const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
[
  'data/text-master.js',
  'data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js',
  'data/poems-5.js', 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js',
  'data/poems-9.js', 'data/poems-10.js', 'data/poems-11.js', 'data/poems-12.js',
  'data/index.js', 'data/poems-classic.js', 'data/poems-tangshi.js',
  'data/poems-songci.js', 'data/poems-guwen.js', 'data/poems-zhaoming.js',
  'data/site-index.js'
].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
});
const byId = {};
sandbox.SITE_INDEX.forEach(function (p) { byId[p.id] = p; });
const textOf = function (id) {
  const p = byId[id];
  if (!p) return null;
  return sandbox.masterTextOf ? sandbox.masterTextOf(p, p.book).text : p.text;
};
const nz = function (t) { return String(t || '').replace(/\s+/g, ''); };

let bad = 0;
console.log('裁定：有教材以教材为准 → 没有教材以简体字为准 → 都裁不了的自行判断\n');
MERGES.forEach(function (m) {
  const ta = nz(textOf(m.keep)), tb = nz(textOf(m.drop));
  if (!ta || !tb) {
    /* 这一组已经并过了：同集子那组并进来那条已删（两边缺一边），不是错。
       再跑一遍同一份裁定表属于幂等操作。 */
    if (ta || tb) {
      console.log('· ' + m.title + '：已合并（' + (ta ? m.drop : m.keep) + ' 已不在语料里），跳过');
      return;
    }
    console.error('✗ 条目不存在：' + m.keep + ' / ' + m.drop); bad++; return;
  }
  if (ta === tb) { console.log('· ' + m.title + '：两条正文已逐字相同（已合并），跳过'); return; }

  /* 逐字比对：同一篇的两种写法，长度相同，数出**每一处**不同
     （用字那一处是判重键看得见的，其余是标点之类「判重键不看、却要一并统一」的）。
     同时把每一处的位置记进 `posDiff`（`to` = keep 那条用的字、`from` = drop 那条用的字）——
     落地时**按下标**改，绝不做全局替换：全局替换会误伤两条共有的同一个字
     （《将进酒》里「复」有三处，只有第三处是两种写法之别）。 */
  const diffs = [];
  m.posDiff = [];
  if (ta.length !== tb.length) diffs.push('长度不同');
  else for (let i = 0; i < ta.length; i++) {
    if (ta[i] === tb[i]) continue;
    diffs.push(ta[i] + '→' + tb[i]);
    m.posDiff.push({ at: i, to: ta[i], from: tb[i] });
  }
  /* 裁定**之后**这一篇该用的写法：`keepWord` 存在时落在**留下**那条上
     （把 keep 里的 `keepFromWord` 改成 `keepWord`），否则落在 drop 上
     （把 drop 里的 `fromWord` 改成 `word`）。 */
  const finalWord = m.keepWord || m.word;
  /* 校验：只差 1~3 处、且每一处都进了 posDiff（漏一处就会少统一一个写法） */
  const ok = diffs.length >= 1 && diffs.length <= 3 &&
    m.posDiff.length === (ta.length === tb.length ? diffs.length : 0);
  if (!ok) bad++;
  console.log((ok ? '✓ ' : '✗ ') + m.title + '（' + m.keep + ' ↔ ' + m.drop + '）：共 ' +
    diffs.length + ' 处之别' + (diffs.length ? '（' + diffs.join('、') + '）' : ''));
  console.log('    ' + m.note);
});
if (bad) { console.error('\n✗ 有 ' + bad + ' 处对不上，先订正裁定表'); process.exit(1); }

if (!APPLY) {
  console.log('\n共 ' + MERGES.length + ' 组。（预演，未改任何文件；加 --apply 才真改）');
} else {
  /* 统一写法：两处要改的地方，规则很直白 ——
       · 有 `keepWord`（第 3 组）：要改的是**留下**那条，把 `keepFromWord` 改成 `keepWord`；
       · 否则：要改的是**并进来**那条（drop），把 `fromWord` 改成 `word`。
     改法一律**按下标逐处替换**，绝不做全局替换 —— 全局替换会误伤两条共有的
     同一个字：《将进酒》里「复」出现三处（不复回 / 还复来 / 不复醒），
     前两处是两条共有的，只有第三处才是两种写法之别；全局替换会把
     前两处一起改成「不愿回」「还愿来」，把教材文本改坏。
     ⚠️ 只动正文与译文 —— 题名 / 作者 / 卷次 / 出处是「从哪本选里读到」的
        归属信息，两份各按各的选本口径，一律不碰。 */
  let changed = 0;
  MERGES.forEach(function (m) {
    const target = m.keepWord ? m.keep : m.drop;
    const fromChar = m.keepWord ? m.keepFromWord : m.fromWord;
    const toChar = m.keepWord ? m.keepWord : m.word;
    const hit = locate(target);
    if (!hit) throw new Error('找不到条目 ' + target);
    let block = hit.block.join('\n');
    /* 定位 `text:` 字段的值，在**值里**按下标改 —— posDiff 的下标是
       「去掉空白后的正文」里的位置，而值里含 `\n` 转义，逐个跳过即可。 */
    const mText = block.match(/(text:\s*")((?:[^"\\]|\\.)*)(")/);
    if (!mText) throw new Error(target + ' 里找不到 text 字段');
    const raw = mText[2];
    /* 原始值 → 去空白后的字符位置映射 */
    const map = [];
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === '\\') { i++; continue; }     /* 转义（\n）整体跳过 */
      map.push(i);
    }
    let chars = raw.split('');
    let touched = 0;
    (m.posDiff || []).forEach(function (d) {
      /* posDiff 的口径是「keep 用 to、drop 用 from」；
         要改 drop 时取 `from → to`，要改 keep 时取 `to → from`。 */
      const at = map[d.at];
      if (at == null) return;
      const want = m.keepWord ? d.to : d.from;   /* 改之前该是哪个字 */
      const next = m.keepWord ? d.from : d.to;   /* 改之后是哪个字 */
      if (chars[at] === next) return;            /* 已统一 */
      if (chars[at] !== want) return;            /* 下标对不上，保守跳过 */
      chars[at] = next;
      touched++;
    });
    if (touched) {
      const newer = chars.join('');
      block = block.replace(raw, newer);
      const lines = fs.readFileSync(path.join(ROOT, hit.file), 'utf8').split('\n');
      lines.splice(hit.start, hit.end - hit.start + 1, block);
      fs.writeFileSync(path.join(ROOT, hit.file), lines.join('\n'), 'utf8');
    }
    console.log('✓ ' + hit.file + ' ' + target + '：统一写法「' + fromChar + '」→「' + toChar +
      '」（共 ' + touched + ' 处，' + (m.rule === 'course' ? '以教材为准' : '以简体字为准') + '）');
    changed++;
    /* 同集子内的那一组：删掉题名是**自拟编号**的那一条（`remove: true`），
       两条并成一条 —— 只把用字改齐、两条都留着，等于同一首在列表里出现
       两次、搜索里并排两条，还是没「合并」。题名是选本原名的那一条留下。 */
    if (m.remove) {
      const hit = locate(m.drop);
      if (!hit) throw new Error('找不到条目 ' + m.drop);
      const lines = fs.readFileSync(path.join(ROOT, hit.file), 'utf8').split('\n');
      let start = hit.start;
      while (start > 0 && /^\s*(\/\/|\/\*|\*)/.test(lines[start - 1])) start--;
      lines.splice(start, hit.end - start + 1);
      fs.writeFileSync(path.join(ROOT, hit.file), lines.join('\n'), 'utf8');
      console.log('✓ ' + hit.file + ' 删掉 ' + m.drop + '（自拟编号的那条并入「' + m.title + '」）');
      changed++;
    }
  });
  console.log('\n用字统一完成，共 ' + changed + ' 条。下一步（顺序不能换）：');
  console.log('  1. node scripts/build-works-map.js          # 判重表：两组各并成一篇');
  console.log('  2. node scripts/build-text-master.js        # 存储主表：收归这两篇');
  console.log('  3. node scripts/apply-text-master.js        # 选本那一条的正文摘成 textRef');
  console.log('  4. node scripts/build-canonical-texts.js    # 显示层裁定表（预期 0 条）');
}
