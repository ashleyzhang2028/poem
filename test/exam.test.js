const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const Ex = require(path.join(ROOT, 'js', 'exam.js'));
const Q = require(path.join(ROOT, 'js', 'quiz.js'));
const { loadData, resolve } = require('./master-env');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };
const eq = (a, b, m) => chk(a === b, m + '（实际 ' + JSON.stringify(a) + '）');

// 语料：课内 12 册 + 各部集子，顺序读法与 api/_lib/game.js 的那一份同源。
const sandbox = { window: {}, console };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
loadData(sandbox, [
  'data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js',
  'data/poems-5.js', 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js',
  'data/poems-9.js', 'data/poems-10.js', 'data/poems-11.js', 'data/poems-12.js',
  'data/index.js'
]);
const BOOKS = [
  { id: 'poems', file: null, varName: 'POEMS_ALL' },
  { id: 'tangshi', file: 'data/poems-tangshi.js', varName: 'POEMS_TANGSHI' },
  { id: 'changshi', file: 'data/poems-changshi.js', varName: 'POEMS_CHANGSHI' }
];

const CORPUS = [];
BOOKS.forEach(function (b) {
  if (b.file) loadData(sandbox, [b.file]);
  resolve(sandbox, sandbox[b.varName], b.id).forEach(function (p) {
    if (!p || !p.id) return;
    CORPUS.push(Object.assign({ book: b.id }, p));
  });
});

console.log('\n=== 一、形态表：三种考试与两个既有玩法，门槛与旋钮都在内核里 ===');
{
  const ids = Ex.VARIANTS.map(v => v.id);
  eq(ids.join(','), 'practice,mock,formal', '三种考试形态齐备：题库复习 / 模拟考试 / 正式考试');
  Ex.VARIANTS.forEach(v => {
    chk(!!v.cap && !!v.tier && !!v.name && Array.isArray(v.sizes) && v.sizes.indexOf(v.size) >= 0,
      v.id + ' 三要素齐全，默认题量在可选档里');
    chk(v.judge === 'instant' || v.judge === 'after', v.id + ' 判分时机只有两种：即时 / 交卷后');
  });
  const formal = Ex.variant('formal');
  chk(formal.timed && formal.minutes > 0, '正式考试限时（默认 ' + formal.minutes + ' 分钟）');
  chk(formal.judge === 'after' && formal.record, '正式考试交卷后统一批 + 留记录');
  const mock = Ex.variant('mock');
  chk(!mock.timed && mock.judge === 'instant' && mock.record,
    '模拟考试不限时、逐题给对错、留记录');
  chk(!Ex.variant('practice').record, '题库复习不留记录（与既有行为一致）');
}

console.log('\n=== 二、范围：名单的唯一来源是 SITE_BOOKS，不另列一份集子名单 ===');
{
  const siteSrc = fs.readFileSync(path.join(ROOT, 'data/site-books.js'), 'utf8');
  const bookIds = (siteSrc.match(/id:\s*"([a-z]+)"/g) || []).map(s => s.match(/"([a-z]+)"/)[1]);
  const books = bookIds.map(id => ({ id: id, name: id }));

  const list = Ex.scopes(CORPUS, { books: books });
  const ids = list.map(s => s.id);
  chk(ids.indexOf('all') === 0, '第一个范围是「全部」');
  books.forEach(b => {
    // 语料里真有的集子才该出现 —— 这里 CORPUS 只放了 poems / tangshi / changshi。
    const have = CORPUS.some(p => p.book === b.id);
    eq(ids.indexOf('book:' + b.id) >= 0, have,
      '范围里' + (have ? '有' : '没有') + ' book:' + b.id + '（与语料一致）');
  });
  chk(ids.indexOf('poems:primary') >= 0 && ids.indexOf('poems:middle') >= 0 && ids.indexOf('poems:high') >= 0,
    '课内再按学段切出小学 / 初中 / 高中三个范围');

  // 加一部集子，范围自己多一个 —— 考试层里没有第二份名单。
  const more = books.concat([{ id: 'zhaoming', name: '昭明文选' }]);
  const cps2 = CORPUS.concat([{ id: 'zm-1', book: 'zhaoming', title: 'x', text: '甲。乙。' }]);
  const ids2 = Ex.scopes(cps2, { books: more }).map(s => s.id);
  chk(ids2.indexOf('book:zhaoming') >= 0, '语料里多一部集子，范围自动多一个（不用改代码）');

  chk(Ex.scopes(CORPUS, { books: books }).every(s => s.count > 0),
    '每一个范围都真的有内容（count > 0，不摆空壳）');
}

console.log('\n=== 三、select：按范围取条目，不认识的范围如实回空 ===');
{
  eq(Ex.select(CORPUS, 'all').length, CORPUS.length, '「全部」= 整个语料');
  const ts = Ex.select(CORPUS, 'book:tangshi');
  chk(ts.length > 0 && ts.every(p => p.book === 'tangshi'), 'book:tangshi 只取唐诗那一部');
  const pri = Ex.select(CORPUS, 'poems:primary');
  chk(pri.length > 0 && pri.every(p => p.book === 'poems' && p.grade <= 6),
    'poems:primary 只取课内一到六年级');
  eq(Ex.select(CORPUS, 'book:nope').length, 0, '不认识的集子回空（不悄悄退回全部）');
  eq(Ex.select(CORPUS, 'poems:nope').length, 0, '不认识的学段回空');
}

console.log('\n=== 四、组卷：范围 × 形态 × 题量，题上带 origin ===');
{
  const plan = Ex.build(CORPUS, { kind: 'mock', scope: 'all', size: 8, seed: 's1' });
  eq(plan.kind, 'mock', '卷子记住自己的形态');
  eq(plan.scope, 'all', '卷子记住自己的范围');
  eq(plan.questions.length, 8, '题量按设置来（8 题）');
  chk(plan.questions.every(q => q.origin === 'kernel'),
    'P1 的题全是内核出的（origin: "kernel"；人工题是 P3 的事）');
  chk(plan.questions.every(q => q.stem && q.answer && Array.isArray(q.options) && q.options.length === 4),
    '每道题形状齐备（题干 / 答案 / 四个选项）');
  chk(plan.questions.every(q => q.options[q.answerIndex] === q.answer),
    'answerIndex 指的就是答案那一项（选项被洗过牌也要对得上）');

  // 范围真的生效：只考唐诗时，每一题都落到唐诗那一部。
  const tsPlan = Ex.build(CORPUS, { kind: 'mock', scope: 'book:tangshi', size: 5, seed: 's2' });
  const byId = {};
  CORPUS.forEach(p => { byId[p.id] = p; });
  chk(tsPlan.questions.length > 0 && tsPlan.questions.every(q => byId[q.poemId] && byId[q.poemId].book === 'tangshi'),
    '只考唐诗时，每一题都落在唐诗那一部（范围真的生效）');

  // 同一批参数抽两次要一样（种子固定），换种子应不一样。
  const a = Ex.build(CORPUS, { kind: 'mock', scope: 'all', size: 6, seed: 'same' });
  const b = Ex.build(CORPUS, { kind: 'mock', scope: 'all', size: 6, seed: 'same' });
  eq(a.questions.map(q => q.id).join(','), b.questions.map(q => q.id).join(','),
    '同一颗种子抽两次是同一副卷子（可复现）');

  // 语料不够时如实回题数，并给出 short。
  const tiny = Ex.build([CORPUS[0]], { kind: 'formal', scope: 'all', size: 10, seed: 's3' });
  chk(tiny.questions.length <= 1, '语料只够 1 题时就出 1 题');
  chk(tiny.short === 10, 'short 如实回「本来要 10 题」（界面据此说清，不假装）');
}

console.log('\n=== 五、判分：只判对错、算出「几题对几题」，不出水平分 ===');
{
  const plan = Ex.build(CORPUS, { kind: 'formal', scope: 'all', size: 5, seed: 's4' });
  const picks = plan.questions.map((q, i) => (i % 2 === 0 ? q.answer : '不是答案'));
  const b = Ex.batch(plan.questions, picks);
  eq(b.total, 5, '总数是题量');
  eq(b.right, 3, '对的就是选的（3 题）');
  eq(b.wrong, 2, '错的是剩下的');
  chk(/这次 5 题对 3 题/.test(b.text), '文案只报「这次几题对几题」');
  chk(!/水平|得分/.test(b.text), '文案里不出现「水平」「得分」这类能力评估');

  const empty = Ex.batch([], []);
  eq(empty.total, 0, '空卷不会崩');
  chk(!/0\/0|NaN/.test(empty.text), '空卷的文案不出现 NaN / 0/0');
}

console.log('\n=== 六、记录：本机一份练习记录，答错不回流、键名单独 ===');
{
  const mem = {};
  const backing = {
    getItem: k => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; }
  };

  const r = Ex.saveRecord({ kind: 'mock', scope: 'book:tangshi', right: 6, total: 8, at: 111 }, { backing: backing });
  chk(r.ok, '存得进（存储可用）');
  const rows = Ex.readRecords({ backing: backing });
  eq(rows.length, 1, '读回一条');
  eq(rows[0].right + '/' + rows[0].total, '6/8', '记录里是那一卷的对错（不是「水平分」）');
  eq(rows[0].kind, 'mock', '记录带形态');

  chk(/poem_exam_v1/.test(fs.readFileSync(path.join(ROOT, 'js/exam.js'), 'utf8')),
    '键名写作 poem_exam_v1');

  // 只留最近 50 条，不无限增长。
  for (let i = 0; i < 60; i++) Ex.saveRecord({ kind: 'mock', right: 1, total: 2, at: 1000 + i }, { backing: backing });
  const capped = Ex.readRecords({ backing: backing });
  chk(capped.length <= 50, '记录有上限（实际 ' + capped.length + ' 条）');
  eq(capped[capped.length - 1].at, 1059, '留下的是最近的（旧的被挤掉）');

  Ex.clearRecords({ backing: backing });
  eq(Ex.readRecords({ backing: backing }).length, 0, '清得掉');

  chk(!Ex.saveRecord({ kind: 'mock' }, { backing: null }).ok, '没有存储时如实回失败（不假装存上了）');
}

console.log('\n=== 七、接线：范围名单与 SITE_BOOKS 同源、页面层不自己列名单 ===');
{
  const examSrc = fs.readFileSync(path.join(ROOT, 'js/exam.js'), 'utf8');
  const gameSrc = fs.readFileSync(path.join(ROOT, 'js/game.js'), 'utf8');

  chk(/SITE_BOOKS/.test(examSrc), 'js/exam.js 的范围名单取自 SITE_BOOKS');

  // 清单只有一份（`data/site-books.js`）：site-index.js 不再自带列表。
  const idxSrc = fs.readFileSync(path.join(ROOT, 'data/site-index.js'), 'utf8');
  chk(!/id:\s*"tangshi"/.test(idxSrc), 'data/site-index.js 不自带集子清单（唯一一份在 site-books.js）');
  chk(/SITE_BOOKS_DEF/.test(idxSrc), 'data/site-index.js 从 site-books.js 取清单');
  chk(/window\.SITE_BOOKS\s*=/.test(fs.readFileSync(path.join(ROOT, 'data/site-books.js'), 'utf8')),
    'data/site-books.js 导出 SITE_BOOKS');
  chk(!/id:\s*"(tangshi|songci|yuanqu|zhaoming|chengyu|changshi)"/.test(examSrc),
    'js/exam.js 里没有另列一份集子名单（只有 SITE_BOOKS 一个来源）');

  // js/game.js 的 WANTED 是「哪些集子要加载」，其 id 必须与 SITE_BOOKS 逐字相同 ——
  // 不然范围里那几部筛不出语料（scope 从 SITE_BOOKS 来，语料从 WANTED 来，两边要合得上）。
  const siteSrc2 = fs.readFileSync(path.join(ROOT, 'data/site-books.js'), 'utf8');
  const siteIds = (siteSrc2.match(/id:\s*"([a-z]+)"/g) || []).map(x => x.match(/"([a-z]+)"/)[1]);
  const wanted = (gameSrc.match(/var WANTED = \[([\s\S]*?)\];/) || [, ''])[1];
  const wantedIds = (wanted.match(/id:\s*"([a-z]+)"/g) || []).map(x => x.match(/"([a-z]+)"/)[1]);
  const extra = wantedIds.filter(id => siteIds.indexOf(id) < 0);
  eq(extra.join(','), '', 'js/game.js 的集子 id 全在 SITE_BOOKS 里（没有对不上的）');
  chk(wantedIds.length >= siteIds.length - 1,
    '除课内（走 POEMS_ALL）外的每一部集子都在 WANTED 里加载（实际 ' + wantedIds.length + ' 部）');

  chk(/Ex\.build|Exam\.build/.test(gameSrc), 'js/game.js 的卷子由 Exam.build() 组');

  // 用户对比表那张纸：新能力必须在对比表上出现（它当场问内核算）。
  const Ent = require(path.join(ROOT, 'js/entitlement.js'));
  ['exam.paper', 'exam.formal', 'exam.changshi'].forEach(cap => {
    chk(!!Ent.cap(cap), '对比表里有 ' + cap + ' 这一条');
    chk(Ent.cap(cap).name.length <= 8, cap + ' 的名字短到能在一列里放下');
  });

  // 服务端与客户端逐档对拍（新加的两条最容易只改一边）。
  const coreSrc = fs.readFileSync(path.join(ROOT, 'api/_lib/core.js'), 'utf8');
  ['exam.formal', 'exam.changshi'].forEach(cap => {
    chk(coreSrc.indexOf('"' + cap + '"') >= 0, '服务端 featuresFor() 里有 ' + cap);
  });
  chk(/exam\.changshi[\s\S]{0,120}algo\.sm2/.test(coreSrc), 'exam.changshi 落在 pro 那一档（与前端一致）');
  chk(/exam\.formal/.test(coreSrc.split('var max')[1].slice(0, 200)), 'exam.formal 落在 max 那一档');
}

console.log('\n=== 八、语料必须带正文：集子那几部不能是空条目（Issue #356 第七轮）===');
{
  // 这是查出来的**真 bug**：集子那十部数据文件里一个字的正文都没有 ——
  // 正文存在 data/text-master.js 那一张主表里，靠 textRef 取。
  // 从前 js/game.js 的 corpus() 直接拿 window[w.v] 原样返回，于是那些条目
  // `text` 是空的：**「考哪一部书」这些范围一道题都出不来**。
  // （真机量过修前：Exam.build(corpus, {scope:'book:tangshi'}) → 0 题。）
  //
  // 这一节守两件事：
  //   ① 数据文件里确实没有正文（所以「展开」这一步不能省）；
  //   ② 展开之后每一条都有正文，且范围里每一部都能出题。
  const tangshiRaw = (function () {
    const box = { window: {}, console };
    box.window = box; box.globalThis = box;
    vm.createContext(box);
    loadData(box, ['data/poems-tangshi.js']);
    return box.POEMS_TANGSHI || [];
  })();
  const withTextRaw = tangshiRaw.filter(p => p && p.text && String(p.text).trim()).length;
  eq(withTextRaw, 0, '数据文件里**没有**内联正文（正文在主表里，靠 textRef 取）');

  const expanded = resolve(sandbox, sandbox.POEMS_TANGSHI, 'tangshi');
  const withTextExpanded = expanded.filter(p => p && p.text && String(p.text).trim()).length;
  eq(withTextExpanded, expanded.length, '过了 masterTextOf 之后**每一条**都有正文');

  // 拿修好的那一步（expand 同一句）喂给内核，看是不是真能出题。
  const cps = CORPUS;
  chk(cps.every(p => p && p.text && String(p.text).trim()),
    '本用例的语料每条都带正文（CORPUS 走的就是 expand 那一句）');

  ['all', 'book:poems', 'book:tangshi', 'book:changshi'].forEach(scope => {
    const plan = Ex.build(cps, { kind: 'practice', scope: scope, size: 5, seed: 'exp' });
    chk(plan.questions.length > 0,
      scope + ' 出得来题（实际 ' + plan.questions.length + ' 题）');
    chk(plan.questions.every(q => q.stem && q.answer),
      scope + ' 每道题都有题干与答案（不是空壳）');
  });

  // 范围里每一部都要出得来题 —— 一部都不许是空壳。
  const books = Ex.scopes(cps, { books: booksOf(sandbox) })
    .filter(sc => sc.id.indexOf('book:') === 0);
  chk(books.length > 0, '语料里有可考的集子（' + books.length + ' 部）');
  books.forEach(sc => {
    const plan = Ex.build(cps, { kind: 'practice', scope: sc.id, size: 3, seed: 'b' });
    chk(plan.questions.length > 0,
      sc.name + '（' + sc.id + '）出得来题（' + plan.questions.length + ' 题）');
  });
}

function booksOf(box) {
  const src = fs.readFileSync(path.join(ROOT, 'data/site-books.js'), 'utf8');
  const ids = (src.match(/id:\s*"([a-z]+)"/g) || []).map(x => x.match(/"([a-z]+)"/)[1]);
  return ids.map(id => ({ id: id, name: id }));
}

console.log('\n' + (fails ? '❌ ' + fails + ' 项失败' : '🎉 考试层内核测试全部通过'));
