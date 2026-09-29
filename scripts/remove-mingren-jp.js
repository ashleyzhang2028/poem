/* ==========================================================================
   历代名家 · 删除明治维新以后的日本政治、军事人物（Issue #381）
   --------------------------------------------------------------------------
   用户原话：

     「历代名家 轴心国除了日本的政治军事家，其他国家的政治，军事家可以添加，
       但是要从雅尔塔会议，开罗宣言以及二战后的国际秩序角度进行评价。
       帮我清理删除明治维新以后的日本的政治家军事家，如果有的话」

   范围只限**历代名家**这一部集子，别的集子一个字不动。
   尺子一条：**明治维新（1868）以后**的日本**政治 / 军事人物**全删；
   本职是文学家、艺术家、科学家的，即便生在那个年代也照样留（第三轮
   「其他名家例如文学家，作家等等保留」是同一条规矩）。

   ## 摸底：其实一位都没有
   在册的日本人物共 4 位，全是**外国文学家**（川端康成 / 夏目漱石 /
   芥川龙之介 / 三岛由纪夫）—— 他们是作家，不是政治家、军事家，按上面的
   尺子全部保留。也就是说这一轮**没有可删的条目**；脚本照常留在仓库里，
   把「查过什么、按什么尺子判的」记下来，也留给以后：真有人把伊藤博文、
   东乡平八郎一类收进来，这一条守卫就能拦住。

   ## 怎么删（真删人的时候）
     主表 data/text-master.js 与壳 data/poems-mingren.js 都由脚本生成：
       ① 本脚本从壳里删掉名单上的条目；
       ② 重跑 scripts/build-text-master.js（主表按「在册且带正文的条目」重建）；
       ③ 重跑 scripts/build-works-map.js（判重表跟着 SITE_INDEX 走）。
     **id 号段不动**：删掉的号空着，后面的号一个不补、一个不改 ——
     已读记录（poem_mingren_read_v1）、搜索索引、外链都挂在号上。

   用法：
     node scripts/remove-mingren-jp.js            # 只查（并打印命中的条目）
     node scripts/remove-mingren-jp.js --apply    # 改壳 + 重跑主表与判重表
   ========================================================================== */
'use strict';

/* ⚠️ Issue #399（历代名家拆两部）之后，`data/poems-mingren.js` 这个文件
   已不再存在 —— 壳改成两份（poems-mingren-cn.js / poems-mingren-foreign.js），
   由 `scripts/build-mingren.js` 从主表生成。要删人请改名单来源
   （scripts/data/mingren-round5.js 的 DROP 一类），再重跑 build 脚本，
   不要在壳上手工动刀。本脚本不再可用，保留只为留下当时的判定口径。 */
if (require('fs').existsSync(require('path').join(__dirname, '..', 'data/poems-mingren.js')) === false) {
  console.error('✗ data/poems-mingren.js 已不存在（Issue #399 拆两部）。' +
    '\n  用法改为：改 scripts/data/mingren-round5.js 的 DROP → node scripts/build-mingren.js --master');
  process.exit(2);
}


const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SHELL = path.join(ROOT, 'data/poems-mingren.js');
const APPLY = process.argv.slice(2).indexOf('--apply') >= 0;

/* 删除名单：姓名 → 理由。明治维新（1868）以后的日本政治 / 军事人物。
   目前为空 —— 在册的日本人物只有 4 位文学家，不在尺子内。
   真收进来时按这个形状登记，例如：
     '伊藤博文': '明治元老 · 首任内阁总理大臣',
     '东乡平八郎': '海军元帅 · 日俄战争联合舰队司令',
     '东条英机': '陆军大将 · 二战日本首相' */
const REMOVE = {};

/* 判据（守卫里也照这一条写）：明治维新以后 + 日本 + 政治 / 军事人物 */
const MEIJI = 1868;
const JP = /日本/;
const POL_MIL = ['军事家', '政治家', '政治人物'];

function loadShell() {
  const sandbox = { window: {}, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SHELL, 'utf8'), sandbox, { filename: 'data/poems-mingren.js' });
  return sandbox.POEMS_MINGREN || [];
}

const cur = loadShell();
const jp = cur.filter(function (p) { return JP.test(p.dynasty || ''); });

console.log('在册的日本人物 ' + jp.length + ' 位：');
jp.forEach(function (p) {
  console.log('  ' + p.id + ' ' + p.title + '（' + p.gradeGroup + '）' + p.dynasty +
    (REMOVE[p.title] ? '  ← 命中名单：' + REMOVE[p.title] : ''));
});
const stray = jp.filter(function (p) {
  return POL_MIL.some(function (k) { return (p.gradeGroup || '').indexOf(k) >= 0; });
});
console.log('其中政治 / 军事人物：' + (stray.length
  ? stray.map(function (p) { return p.title; }).join('、')
  : '无（' + MEIJI + ' 年以后的政治 / 军事人物一位都没有）'));

const hit = cur.filter(function (p) { return REMOVE[p.id]; });
if (!hit.length) {
  console.log('✓ 壳里没有可删的条目（已经是删过的状态）');
  process.exit(0);
}

console.log('将删除 ' + hit.length + ' 位：');
hit.forEach(function (p) { console.log('  ' + p.id + ' ' + p.title + '（' + p.group + '）— ' + REMOVE[p.id]); });

if (!APPLY) {
  console.log('（dry-run，未写盘；加 --apply 执行）');
  process.exit(0);
}

const kept = cur.filter(function (p) { return !REMOVE[p.id]; });

const lines = [];
lines.push('window.POEMS_MINGREN = [');
kept.forEach(function (s) {
  lines.push('  {');
  lines.push('    textRef: ' + JSON.stringify(s.textRef) + ',');
  lines.push('    id: ' + JSON.stringify(s.id) + ',');
  lines.push('    title: ' + JSON.stringify(s.title) + ',');
  lines.push('    group: ' + JSON.stringify(s.group) + ',');
  lines.push('    gradeGroup: ' + JSON.stringify(s.gradeGroup) + ',');
  lines.push('    dynasty: ' + JSON.stringify(s.dynasty) + ',');
  lines.push('    author: ' + JSON.stringify(s.author) + ',');
  lines.push('    source: ' + JSON.stringify(s.source) + ',');
  lines.push('    excerpt: ' + JSON.stringify(s.excerpt) + ',');
  lines.push('  },');
});
lines.push('];');
fs.writeFileSync(SHELL, lines.join('\n') + '\n', 'utf8');
console.log('✓ data/poems-mingren.js：' + cur.length + ' → ' + kept.length + ' 位');

execFileSync(process.execPath, [path.join(__dirname, 'build-text-master.js')], { stdio: 'inherit' });
execFileSync(process.execPath, [path.join(__dirname, 'build-works-map.js')], { stdio: 'inherit' });
console.log('✓ 主表与判重表已重建');
