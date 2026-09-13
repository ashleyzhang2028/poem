#!/usr/bin/env node
/**
 * 译文体检工具
 *
 * 全库逐首检查白话译文是否齐全、是否疑似漏写或敷衍：
 *   1. 缺译文（translation 为空 / 只有空白）
 *   2. 译文过短（相对原文长度低于阈值，疑似没写完）
 *   3. 译文与原文完全相同（粘贴错误）
 *   4. 没标来源口径（translationSource 缺失）
 *   5. 来源口径取值不认识（不在 data/index.js 的四类里）
 *   6. 统计各学段、各年级的覆盖率，给出总覆盖率
 *
 * 用法：
 *   node scripts/audit-translations.js            # 体检报告，有不达标项时退出码 1
 *   node scripts/audit-translations.js --json     # 输出 JSON，便于接进 CI
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const GRADES = 12;

/** 装载 data/poems-N.js，返回全部诗词（grade 由文件序号回填） */
function loadPoems() {
  const sandbox = { window: {}, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (let i = 1; i <= GRADES; i++) {
    const file = path.join(ROOT, 'data', `poems-${i}.js`);
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
    (sandbox[`POEMS_${i}`] || []).forEach(p => { p.grade = i; });
  }
  return sandbox;
}

/** 相对原文长度的最低译文比（正文越短，留的余量越大） */
function minRatio(textLen) {
  if (textLen <= 40) return 0.9;    // 五绝一类的短诗，译文不该比原文还短
  if (textLen <= 120) return 0.85;  // 律诗、中调词
  return 0.7;                        // 长词、文言文
}

/** 允许的译文来源口径（与 data/index.js 的 TRANSLATION_SOURCES 一一对应） */
const SOURCES = ['academic', 'school', 'public-domain', 'modern'];

const plain = s => String(s || '').replace(/\s/g, '');
const sandbox = loadPoems();
const poems = [];
for (let i = 1; i <= GRADES; i++) poems.push(...(sandbox[`POEMS_${i}`] || []));

// 小古文同样体检：它也是「译文」，来源标注不能只有课内诗词有
const classicFile = path.join(ROOT, 'data', 'poems-classic.js');
vm.runInContext(fs.readFileSync(classicFile, 'utf8'), sandbox, { filename: classicFile });
const classics = sandbox.POEMS_CLASSIC || [];

const problems = { missing: [], tooShort: [], sameAsText: [], noSource: [], badSource: [] };
poems.forEach(p => {
  const tr = String(p.translation || '').trim();
  const textLen = plain(p.text).length;
  if (!tr) { problems.missing.push(p); return; }
  if (plain(tr).length < 20 || plain(tr).length < textLen * minRatio(textLen)) {
    problems.tooShort.push({ p, len: plain(tr).length, textLen, need: Math.ceil(textLen * minRatio(textLen)) });
  }
  if (plain(tr) === plain(p.text)) problems.sameAsText.push(p);
});

// 来源标注：译文与原文都齐了，还得说得清「这段译文是怎么来的」
poems.concat(classics).forEach(p => {
  if (!String(p.translation || '').trim()) return; // 缺译文的已单独报
  const src = p.translationSource;
  if (!src) problems.noSource.push(p);
  else if (SOURCES.indexOf(src) < 0) problems.badSource.push({ p, src });
});

// 分年级覆盖率
const byGrade = {};
poems.forEach(p => {
  byGrade[p.grade] = byGrade[p.grade] || { total: 0, done: 0 };
  byGrade[p.grade].total++;
  if (String(p.translation || '').trim()) byGrade[p.grade].done++;
});
const total = poems.length;
const done = total - problems.missing.length;
const coverage = total ? done / total : 1;

// 来源口径分布（含小古文），报告里亮出来，读者一眼能看到「各占多少」
const sourceDist = {};
poems.concat(classics).forEach(p => {
  const k = p.translationSource || '(未标)';
  sourceDist[k] = (sourceDist[k] || 0) + 1;
});

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    total, done, coverage,
    missing: problems.missing.map(p => p.id),
    tooShort: problems.tooShort.map(x => ({ id: x.p.id, len: x.len, need: x.need })),
    sameAsText: problems.sameAsText.map(p => p.id),
    noSource: problems.noSource.map(p => p.id),
    badSource: problems.badSource.map(x => ({ id: x.p.id, src: x.src })),
    sourceDist,
    byGrade
  }, null, 2));
  process.exit(problems.missing.length || problems.tooShort.length || problems.sameAsText.length ||
    problems.noSource.length || problems.badSource.length ? 1 : 0);
}

const GRADE_NAMES = {
  1: '一年级', 2: '二年级', 3: '三年级', 4: '四年级', 5: '五年级', 6: '六年级',
  7: '七年级', 8: '八年级', 9: '九年级', 10: '高一', 11: '高二', 12: '高三'
};
console.log('译文体检 · 全库 ' + total + ' 首');
console.log('总覆盖率 ' + (coverage * 100).toFixed(1) + '%（' + done + '/' + total + '）');
console.log('');
Object.keys(byGrade).sort((a, b) => a - b).forEach(g => {
  const v = byGrade[g];
  const flag = v.done === v.total ? '✓' : '✗';
  console.log('  ' + flag + ' ' + GRADE_NAMES[g] + ' ' + v.done + '/' + v.total);
});
console.log('');

console.log('来源口径分布：' + Object.keys(sourceDist).sort()
  .map(k => k + ' ' + sourceDist[k]).join(' · '));
console.log('');

const bad = problems.missing.length + problems.tooShort.length + problems.sameAsText.length +
  problems.noSource.length + problems.badSource.length;
if (problems.missing.length) {
  console.log('✗ 缺译文 ' + problems.missing.length + ' 首：');
  problems.missing.forEach(p => console.log('    ' + p.id + ' ' + p.title));
}
if (problems.tooShort.length) {
  console.log('✗ 译文过短 ' + problems.tooShort.length + ' 首：');
  problems.tooShort.forEach(x => console.log('    ' + x.p.id + ' ' + x.p.title + '：' + x.len + ' 字（建议 ≥ ' + x.need + '）'));
}
if (problems.sameAsText.length) {
  console.log('✗ 译文与原文相同 ' + problems.sameAsText.length + ' 首：');
  problems.sameAsText.forEach(p => console.log('    ' + p.id + ' ' + p.title));
}
if (problems.noSource.length) {
  console.log('✗ 没标译文来源 ' + problems.noSource.length + ' 首，跑 scripts/tag-translation-source.js 补：');
  problems.noSource.forEach(p => console.log('    ' + p.id + ' ' + p.title));
}
if (problems.badSource.length) {
  console.log('✗ 译文来源取值不认识 ' + problems.badSource.length + ' 首（只能是 ' + SOURCES.join(' / ') + '）：');
  problems.badSource.forEach(x => console.log('    ' + x.p.id + ' ' + x.p.title + '：' + x.src));
}
console.log(bad === 0 ? '🎉 全库译文齐全、来源口径清楚，没有发现敷衍或漏写' : '❌ 共 ' + bad + ' 项需要处理');
process.exit(bad === 0 ? 0 : 1);
