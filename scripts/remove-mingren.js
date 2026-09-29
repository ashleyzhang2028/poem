/* ==========================================================================
   历代名家 · 删除国共两党的政治、军事人物（Issue #381）
   --------------------------------------------------------------------------
   用户原话：

     「再次确认，仅限历代名家集子，国共两党的政治，军事人物全删。
       其他名家例如文学家，作家等等保留。」

   范围只限**历代名家**这一部集子，别的集子一个字不动。
   一条尺子：凡身份落在「国共两党的政治人物 / 军事人物」上的，全删；
   文学家、作家、学者、艺术家等名家一律保留。

   删的人（5 位）：
     mr-79   李宗仁   军事家   国民党桂系首领、代总统、战区司令长官
     mr-80   毛泽东   军事家   中共领袖、人民军队缔造者
     mr-81   刘伯承   军事家   中共元帅、军事家
     mr-244  陈独秀   思想家   中共首任总书记
     mr-245  李大钊   思想家   中共创始人、早期马克思主义者

   留下的人（有政党/军政经历，但本职是别的行当，按「其他名家保留」留）：
     蔡元培   教育家 · 北大校长、中央研究院院长（不是党派军政人物）
     顾准     会计学家 · 经济思想史学者
     聂耳     音乐家 · 《义勇军进行曲》作曲者
     徐怀中   作家 · 军旅文学
     胡适 / 康有为 / 梁启超 / 章太炎  清末民初学者，非国共两党人物

   ## 怎么删
     主表 data/text-master.js 与壳 data/poems-mingren.js 都由脚本生成：
       ① 本脚本从壳里删掉那几位的条目；
       ② 重跑 scripts/build-text-master.js（主表按「在册且带正文的条目」重建，
          壳里没了，主表那一条自然不再生成）；
       ③ 重跑 scripts/build-works-map.js（判重表跟着 SITE_INDEX 走）。
     **id 号段不动**：删掉的号（mr-79/80/81/244/245）空着，后面的号一个不补、
     一个不改 —— 已读记录、搜索索引、外链都挂在号上，重编号会把它们指错。

   用法：
     node scripts/remove-mingren.js            # 只改壳（并打印将删的条目）
     node scripts/remove-mingren.js --apply    # 改壳 + 重跑主表与判重表
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SHELL = path.join(ROOT, 'data/poems-mingren.js');
const APPLY = process.argv.slice(2).indexOf('--apply') >= 0;

/* 删除名单：id → 理由（理由只写进注释与日志，不写进数据） */
const REMOVE = {
  'mr-79': '李宗仁 · 国民党军事人物',
  'mr-80': '毛泽东 · 中共政治、军事人物',
  'mr-81': '刘伯承 · 中共军事人物',
  'mr-244': '陈独秀 · 中共政治人物',
  'mr-245': '李大钊 · 中共政治人物'
};

function loadShell() {
  const sandbox = { window: {}, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SHELL, 'utf8'), sandbox, { filename: 'data/poems-mingren.js' });
  return sandbox.POEMS_MINGREN || [];
}

const cur = loadShell();
const hit = cur.filter(function (p) { return REMOVE[p.id]; });
const missing = Object.keys(REMOVE).filter(function (id) {
  return !cur.some(function (p) { return p.id === id; });
});

if (!hit.length) {
  console.log('壳里没有可删的条目（已经是删过的状态）');
  if (missing.length) console.log('  以下 id 本就不在册：' + missing.join('、'));
  process.exit(0);
}

console.log('将删除 ' + hit.length + ' 位：');
hit.forEach(function (p) { console.log('  ' + p.id + ' ' + p.title + '（' + p.group + '）— ' + REMOVE[p.id]); });
if (missing.length) console.log('⚠️ 以下 id 不在册（跳过）：' + missing.join('、'));

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
