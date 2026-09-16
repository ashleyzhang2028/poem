/**
 * 古诗词大会 · 出题内核测试（3 期 · 不花钱的那一层）
 * ==========================================================================
 * 用户 2026-09-17 的裁决（Issue #159）：
 *   「现场考试和飞花令归 max 所有，题库归 pro.」
 *
 * 这一层验**内核**（`js/quiz.js`，纯 Node，零 DOM、零网络、零依赖）：
 *   1. 断句：标点切干净、空句丢掉、同一篇里的重复行只留一行；
 *   2. 飞花令：令字候选**从语料现算**（不写死字表）、命中的字由内核给出；
 *   3. 题库：一篇一条、干扰项的三条规矩（长度档 / 不重字过半 / 不同篇）；
 *   4. 判分：纯比对，不读时钟、不读存储、同样输入同样输出；
 *   5. 抽卷：同一套卷子里不重复同一篇，种子一样结果一样（可复现）。
 *
 * 跑法：`node test/game.test.js`（纯 Node，不联网、不装依赖）
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const Q = require(path.join(ROOT, 'js', 'quiz.js'));
const { loadData, resolve } = require('./master-env');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };
const eq = (a, b, m) => chk(a === b, m + '（实际 ' + JSON.stringify(a) + '）');

/* ---------------------------------------------------------- 语料 */

const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
loadData(sandbox, [
  'data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js',
  'data/poems-5.js', 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js',
  'data/poems-9.js', 'data/poems-10.js', 'data/poems-11.js', 'data/poems-12.js',
  'data/index.js', 'data/poems-classic.js'
]);
const ALL = resolve(sandbox, sandbox.POEMS_ALL, 'poems');
const CLASSIC = resolve(sandbox, sandbox.POEMS_CLASSIC, 'classic');
chk(ALL.length === 261, '课内语料 261 首（实际 ' + ALL.length + '）');

/* ============ 一、断句 ============ */
console.log('\n=== 一、断句：标点切干净、空句丢掉、同篇重复行只留一条 ===');
{
  const ss = Q.splitLines('鹅，鹅，鹅，\n曲项向天歌。\n白毛浮绿水，\n红掌拨清波。');
  eq(ss.join('|'), '鹅|鹅|鹅|曲项向天歌|白毛浮绿水|红掌拨清波',
    '逗号与换行都切开，标点不留');
  chk(ss.every(s => !/[，。！？；、：\n]/.test(s)), '切出来的每一句里都没有标点');

  eq(Q.splitLines('').length, 0, '空正文切出 0 句（不抛）');
  eq(Q.splitLines(null).length, 0, 'null 正文切出 0 句（不抛）');
  eq(Q.splitLines('。。。').length, 0, '全是标点时切出 0 句（空句被丢掉）');
  /* ⚠️ 断句**不去重** —— 去重是 Q.lines() 那一层的事。
     《咏鹅》开头的「鹅，鹅，鹅」原本就是三句，合并成一句就把原文改掉了。 */
  eq(Q.splitLines('鹅，鹅，鹅').length, 3, '断句不去重：《咏鹅》开头三声「鹅」是三句');

  // 《江南》那种「鱼戏莲叶东/西/南/北」：四句都在，不能被合并
  const jiangnan = ALL.filter(p => p.title === '江南')[0];
  const lines = Q.splitLines(jiangnan.text);
  /* 《江南》里「鱼戏莲叶间 / 东 / 西 / 南 / 北」是**五句**（「间」那一句也算，
     它是原诗的第一句）。断句不许把它们合并 —— 飞花令里五句是五个可想的答案。 */
  chk(lines.filter(s => /鱼戏莲叶/.test(s)).length === 5,
    '《江南》里「鱼戏莲叶…」五句各留一条（实际 ' +
    lines.filter(s => /鱼戏莲叶/.test(s)).length + '）');

  /* 去重发生在 Q.lines()：同一篇里一字不差的两行只留一行。
     ⚠️ 只去**同一篇内**的重复 —— 不同篇里出现同一句是正常的（引用 / 集子重收），
        跨篇去重会把两部集子里各自的那一篇吞掉一份。 */
  const dupPoem = { id: 'dup1', title: '重复', text: '白日依山尽。白日依山尽。' };
  eq(Q.lines([dupPoem]).length, 1, '同一篇里一字不差的两行只留一行（数据录入留下的重复）');
  const dupTwo = [{ id: 'a', title: 'A', text: '白日依山尽' }, { id: 'b', title: 'B', text: '白日依山尽' }];
  eq(Q.lines(dupTwo).length, 2, '**不同篇**里的同一句各留一条（跨篇去重会吞掉一整篇）');

  // 句子表：每一行都带得回出处
  const rows = Q.lines(ALL);
  chk(rows.length > 2000, '课内摊成 ' + rows.length + ' 句');
  chk(rows.every(r => r.id && r.title && r.text), '每一行都带 id / 标题 / 正文');
  chk(rows.every(r => r.source), '每一行都带出处（列表与结果里那一行小字要用）');
}

/* ============ 二、飞花令 ============ */
console.log('\n=== 二、飞花令：候选从语料现算，命中的字由内核给出 ===');
{
  const cand = Q.candidates(ALL, { min: 6 });
  chk(cand.length > 100, '课内语料里有 ' + cand.length + ' 个字够格当令字');
  chk(cand.indexOf('月') >= 0, '「月」是候选（能对上很多句）');

  // 排序：能凑出的句子多的在前
  const f0 = Q.candidates(ALL, { min: 2 })[0];
  const cnt = Q.flyFlower({ poems: ALL, chars: [f0] }).count;
  chk(cnt >= 100, '排第一的令字能对上 ' + cnt + ' 句（按条数从多到少）');

  // 门槛真的生效
  const few = Q.candidates(ALL, { min: 200 });
  chk(few.length < cand.length, '门槛提高后候选变少（min=200 → ' + few.length + ' 个）');
  chk(few.every(c => Q.flyFlower({ poems: ALL, chars: [c] }).count >= 200),
    '筛出来的每一个令字都真的能对上至少 min 句（门槛不是摆设）');

  // 至少在两篇里出现
  const onePoemOnly = Q.lines(ALL).length;   // 语法占位，真正的判据在下面
  chk(Q.candidates(ALL, { min: 1 }).every(c => {
    const r = Q.flyFlower({ poems: ALL, chars: [c] });
    const ids = {};
    r.rows.forEach(x => { ids[x.id] = 1; });
    return Object.keys(ids).length >= 2;
  }), '每个候选令字都至少在**两篇**里出现（都在同一篇里等于考背诵，不是考联想）');

  // 飞花令的结果本身
  const ff = Q.flyFlower({ poems: ALL, chars: ['月'] });
  chk(ff.count > 0, '「月」在课内语料里能对上 ' + ff.count + ' 句');
  chk(ff.rows.every(r => r.text.indexOf('月') >= 0), '每一条结果都真的带这个字');
  chk(ff.rows.every(r => Array.isArray(r.hit) && r.hit.indexOf('月') >= 0),
    '每一条都带上「命中的是哪几个字」（内核给出，界面不自己再扫一遍）');
  eq(ff.byChar['月'], ff.count, '按字统计的条数与总条数一致');

  // 两个字一起：两字都命中的排在只命中一个的前面
  const two = Q.flyFlower({ poems: ALL, chars: ['月', '江'] });
  chk(two.rows[0].hit.length === 2, '两个字一起查时，两个都命中的排最前');
  chk(two.count >= ff.count, '两个字一起查的条数不少于单查（并集）');

  // exclude / limit
  const firstId = ff.rows[0].id;
  const ex = Q.flyFlower({ poems: ALL, chars: ['月'], exclude: [firstId] });
  chk(ex.rows.every(r => r.id !== firstId), 'exclude 里的那一篇被排除了');
  const lim = Q.flyFlower({ poems: ALL, chars: ['月'], limit: 5 });
  eq(lim.rows.length, 5, 'limit 只截返回的行数');
  eq(lim.count, ff.count, 'count 仍是**总数**（不是截断后的条数，界面要如实说能对上几句）');

  // 一个不存在的字：如实回 0，不抛
  const none = Q.flyFlower({ poems: ALL, chars: ['猫'] });
  eq(none.count, 0, '语料里没有的令字：回 0 条（不抛、不假装）');
  eq(none.rows.length, 0, '回 0 条时结果数组为空');

  // 全站语料也不该崩
  const big = Q.flyFlower({ poems: ALL.concat(CLASSIC), chars: ['月'] });
  chk(big.count >= ff.count, '六部集子一起查的条数不少于只查课内（' + big.count + ' ≥ ' + ff.count + '）');
}

/* ============ 三、题库与干扰项 ============ */
console.log('\n=== 三、题库：一篇一条、干扰项三条规矩 ===');
{
  const bank = Q.buildBank(ALL);
  chk(bank.length > 0, '课内 261 首建出 ' + bank.length + ' 道题');
  chk(bank.every(q => q.stem && q.answer && q.stem !== q.answer),
    '每道题的题干与答案都存在且不相同');
  chk(bank.every(q => q.id.indexOf(q.poemId + '#') === 0), '每道题的 id 是「篇 id # 序号」');

  /* 题干与答案必须**同一篇正文里的相邻两句**。
     ⚠️ 判「相邻」要用**第一次出现**的位置（indexOf），不能用「哪一句等于它」——
        《咏鹅》里「鹅」出现了三次，答案「曲项向天歌」接的是**第三次**那个「鹅」，
        按 indexOf 会判到第一次上，看起来就像「不相邻」。 */
  const byId = {};
  ALL.forEach(p => { byId[p.id] = p; });
  const badSeq = bank.filter(q => {
    const lines = Q.splitLines(byId[q.poemId].text);
    let at = -1;
    for (let i = 0; i < lines.length - 1; i += 1) {
      if (lines[i] === q.stem && lines[i + 1] === q.answer) { at = i; break; }
    }
    return at < 0;
  });
  eq(badSeq.length, 0, '每道题的答案都是同一篇正文里紧跟题干的那一句（实际错 ' +
    badSeq.length + ' 道）');

  /* 《咏鹅》开头三声「鹅」一字不差 —— 拿它出的题（题干「鹅」、答案「鹅」）
     没有正确答案可言。必须在**出题**这一层挡掉。 */
  const yongeQ = bank.filter(q => q.poemId === 'xx1-01');
  chk(yongeQ.length > 0, '《咏鹅》仍然出得了题（' + yongeQ.length + ' 道）');
  chk(yongeQ.every(q => q.stem !== q.answer),
    '《咏鹅》的题不拿重复的「鹅」当题干 / 答案（实际题干「' +
    (yongeQ[0] ? yongeQ[0].stem : '') + '」、答案「' + (yongeQ[0] ? yongeQ[0].answer : '') + '」）');

  /* 整篇都是一句重复的（极端数据）：不出题，不抛 */
  eq(Q.buildBank([{ id: 'z', title: 'Z', text: '鹅。鹅。鹅。' }]).length, 0,
    '整篇都是同一句时不出题（没有不同的两句可问）');

  /* ⚠️ 题库**按篇去重题干**：同一篇里若有两句一字不差，只出一次题
     （同一道题连着问两遍，用户会以为页面坏了）。 */
  const dupBank = Q.buildBank([{ id: 'q1', title: 'T', text: '甲句。乙句。甲句。' }]);
  eq(dupBank.length, 1, '一篇只出 1 道题（perPoem 默认 1），且题干不重复');
  chk(dupBank.every(q => q.stem !== q.answer), '题干与答案不相同（同一句自己接自己不是一道题）');

  // 只有一句的篇目不进题库（没有上下句可问）
  const oneLine = { id: 'x1', title: '单句', text: '只有一个句子' };
  eq(Q.buildBank([oneLine]).length, 0, '只有一句的篇目不出题（没有下句可问）');

  /* ---- 干扰项的规矩 ---- */
  const qs = [];
  for (let i = 0; i < Math.min(300, bank.length); i += 1) {
    const q = Q.pick({ bank, at: i, seed: 'seed' + i });
    if (q) qs.push(q);
  }
  chk(qs.length > 100, '抽了 ' + qs.length + ' 道题来查干扰项');

  eq(qs.filter(q => q.options.length !== 4).length, 0, '每道题都是四个选项');
  eq(qs.filter(q => new Set(q.options).size !== q.options.length).length, 0,
    '同一道题的四个选项互不重复');
  eq(qs.filter(q => q.options.indexOf(q.answer) < 0).length, 0,
    '答案一定在四个选项里（否则永远答不对）');
  eq(qs.filter(q => q.answerIndex !== q.options.indexOf(q.answer)).length, 0,
    'answerIndex 指向的就是答案那一格');

  // 规矩 ①：长度档相近（差 4 字以内）—— 一眼看出「只有这条长」等于送分
  const longOut = qs.filter(q => q.options.some(o => Math.abs(o.length - q.answer.length) > 4));
  eq(longOut.length, 0, '干扰项与答案的长度差都在 4 字以内（实际超 ' + longOut.length + ' 道）');

  // 规矩 ②：不与答案重字过半
  const tooClose = qs.filter(q => q.options.some(o =>
    o !== q.answer && Q.overlap(o, q.answer) > 0.5));
  eq(tooClose.length, 0, '干扰项与答案的重字不超过一半（否则两个都像对的）');

  // 规矩 ③：干扰项不来自同一篇
  const samePoem = qs.filter(q => q.options.some(o => {
    const lines = Q.splitLines(byId[q.poemId].text);
    return o !== q.answer && lines.indexOf(o) >= 0;
  }));
  eq(samePoem.length, 0, '干扰项不取自本题那一篇（同篇的下一句是唯一的答案）');

  // 可复现：同一个种子两次抽到同一道题（逐字相同）
  const a1 = Q.pick({ bank, at: 7, seed: 'same' });
  const a2 = Q.pick({ bank, at: 7, seed: 'same' });
  eq(JSON.stringify(a1), JSON.stringify(a2), '同样的输入抽两次得到逐字相同的题（不读时钟、不用随机数）');

  // 选项顺序每次现算：不同种子下答案落在不同位置（背位置没用）
  const idx = {};
  for (let i = 0; i < 40; i += 1) {
    const q = Q.pick({ bank, at: 7, seed: 'perm' + i });
    idx[q.answerIndex] = (idx[q.answerIndex] || 0) + 1;
  }
  chk(Object.keys(idx).length >= 3,
    '答案在四个位置上都出现过（实际落在 ' + Object.keys(idx).sort().join('/') + '）');
}

/* ============ 四、判分 ============ */
console.log('\n=== 四、判分：纯比对，不读时钟、不读存储 ===');
{
  const q = { answer: '白毛浮绿水' };
  eq(Q.grade(q, '白毛浮绿水').ok, true, '选对了 → ok:true');
  eq(Q.grade(q, '白毛浮绿水').why, 'ok', 'why 是 ok');
  eq(Q.grade(q, '红掌拨清波').ok, false, '选错了 → ok:false');
  eq(Q.grade(q, '红掌拨清波').why, 'wrong', 'why 是 wrong');
  eq(Q.grade(q, '').why, 'empty', '没选 → why 是 empty（界面据此说「还没选」）');
  eq(Q.grade(q, null).why, 'empty', 'null 也是 empty');
  eq(Q.grade(null, 'x').why, 'noAnswer', '没有题 → why 是 noAnswer');
  eq(Q.grade(q, '白毛浮绿水'.replace('绿', '')).ok, false, '少一个字就是错的（逐字比对，不模糊）');
}

/* ============ 五、抽卷 ============ */
console.log('\n=== 五、抽卷：同一套卷子不重复同一篇，种子一样结果一样 ===');
{
  const bank = Q.buildBank(ALL);
  const paper = Q.paper({ bank, size: 8, seed: 'exam1' });
  eq(paper.length, 8, '抽出一套 8 题的卷子');
  const pids = paper.map(q => q.poemId);
  eq(new Set(pids).size, pids.length, '同一套卷子里不重复同一篇（连着问同一首诗等于只考了一首）');
  paper.forEach(q => chk(q.options.indexOf(q.answer) >= 0, '卷子里每一题都有可选的答案：' + q.title));

  const again = Q.paper({ bank, size: 8, seed: 'exam1' });
  eq(JSON.stringify(paper), JSON.stringify(again), '同一个种子抽两次是同一套卷子（可复现）');
  const other = Q.paper({ bank, size: 8, seed: 'exam2' });
  chk(JSON.stringify(paper) !== JSON.stringify(other), '换一个种子是另一套卷子');

  // 卷子比题库还大时：有多少给多少，不重复、不抛
  const small = Q.paper({ bank: bank.slice(0, 3), size: 10, seed: 's' });
  chk(small.length <= 3, '题库只有 3 道时最多出 3 题（实际 ' + small.length + '）');
  eq(Q.paper({ bank: [], size: 5 }).length, 0, '空题库 → 空卷子（不抛）');

  // 卷内每题的四条选项各自独立且都合法
  const badOpt = paper.filter(q => q.options.length !== 4 || new Set(q.options).size !== 4);
  eq(badOpt.length, 0, '卷子里每一题都是四个互不重复的选项');
}

/* ============ 六、令字说明与出处 ============ */
console.log('\n=== 六、令字说明：只报事实，不做评价 ===');
{
  const sum = Q.charSummary(ALL, ['月', '江']);
  chk(sum.total > 0, '两个字一起的合计条数 ' + sum.total);
  chk(/月 \d+ 句/.test(sum.text) && /江 \d+ 句/.test(sum.text),
    '说明行按字分别报数：' + sum.text);
  chk(!/厉害|太棒|加油/.test(sum.text), '只报事实，不写「你太厉害了」这类评价');

  /* 出处：册次优先，其次是集子的卷次 / 词牌，最后才退回 book 名。
     ⚠️ gradeGroup 是**页面挂载时逐条补上的**（data/poems-*.js 里没有这个字段，
        见 js/poems.js 的 withGroups），所以这里自己补一份来验。 */
  const p = {};
  Object.keys(ALL[0]).forEach(k => { p[k] = ALL[0][k]; });
  p.gradeGroup = '一年级上';
  chk(Q.sourceOf(p).indexOf('一年级上') >= 0, '出处里写册次：' + Q.sourceOf(p));
  eq(Q.sourceOf({ selection: '卷一 五言古诗', dynasty: '唐', author: '李白' }),
    '卷一 五言古诗 · 唐 · 李白', '没有册次时退回集子的卷次 / 词牌');
  eq(Q.sourceOf({ book: '唐诗三百首' }), '唐诗三百首', '两样都没有时退回集子名');
  eq(Q.sourceOf(null), '', '空条目 → 空出处（不抛）');
}

/* ============ 七、与页面/内核的接线 ============ */
console.log('\n=== 七、接线：能力键名两端同源、页面不提前渲染 ===');
{
  /* 三层各自的能力键：服务端 core.GAME_CAP 与客户端 js/game.js 的 MODES
     必须**逐字一致** —— 对不上的症状是「界面点亮了，服务端判分口回 403」。 */
  const coreSrc = fs.readFileSync(path.join(ROOT, 'api/_lib/core.js'), 'utf8');
  const gameSrc = fs.readFileSync(path.join(ROOT, 'js/game.js'), 'utf8');
  const caps = (coreSrc.match(/var GAME_CAP = \{([^}]+)\}/) || [, ''])[1];
  chk(/fly:\s*"feihualing"/.test(caps), '服务端：飞花令那一档写作 feihualing');
  chk(/paper:\s*"exam\.paper"/.test(caps), '服务端：现场考试那一档写作 exam.paper');
  chk(/review:\s*"quiz\.review"/.test(caps), '服务端：题库复习那一档写作 quiz.review');
  ['feihualing', 'exam.paper', 'quiz.review'].forEach(cap => {
    chk(gameSrc.indexOf('"' + cap + '"') >= 0, 'js/game.js 里用的是同一个键名：' + cap);
  });

  /* 用户裁决：飞花令与现场考试归 max、题库归 pro —— 两端必须一致 */
  const Ent = require(path.join(ROOT, 'js/entitlement.js'));
  const ctx = t => ({ tier: t, signedIn: true });
  chk(!Ent.can('feihualing', ctx('pro')).ok && Ent.can('feihualing', ctx('max')).ok,
    '飞花令：Pro 不可、Max 可（用户裁决）');
  chk(!Ent.can('exam.paper', ctx('pro')).ok && Ent.can('exam.paper', ctx('max')).ok,
    '现场考试：Pro 不可、Max 可（用户裁决）');
  chk(Ent.can('quiz.review', ctx('pro')).ok, '题库复习：Pro 可（用户裁决）');
  chk(!Ent.can('quiz.review', ctx('free')).ok, '题库复习：free 不可');

  /* 服务端能力清单与客户端 CAPS 两端对拍：同一个层级下两个集合必须逐字相同 */
  const cps = {};
  ALL.forEach(p => { cps[p.id] = p; });
  const coreMod = (function () {
    const saved = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = 'test-secret-at-least-16-chars';
    Object.keys(require.cache).forEach(k => { if (k.indexOf('api') >= 0) delete require.cache[k]; });
    const m = require(path.join(ROOT, 'api/_lib/core.js'));
    if (saved === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = saved;
    return m;
  })();
  const cfg = { sessionSecret: 'test-secret-at-least-16-chars' };
  ['free', 'pro', 'max'].forEach(tier => {
    const server = coreMod.featuresFor(cfg, tier).slice().sort().join(',');
    const client = Object.keys(Ent.CAPS)
      .filter(c => Ent.can(c, ctx(tier)).ok).sort().join(',');
    eq(server, client,
      tier + ' 那一档：**服务端能力清单与客户端 CAPS 逐字相同**（不一致就是「界面点亮、接口 403」）');
  });

  /* 页面：不许提前渲染一句话（2A 立的规矩） */
  const poemsHtml = fs.readFileSync(path.join(ROOT, 'poems/index.html'), 'utf8');
  chk(/data-poems-view="game"/.test(poemsHtml), '/poems/ 里有古诗词大会那一层的挂载点');
  chk(/data-game-open/.test(poemsHtml), '/poems/ 工具条上有进那一层的键');
  chk(/hidden/.test(poemsHtml.split('data-poems-view="game"')[1].slice(0, 40)),
    '那一层默认 hidden（点才铺上来，地址栏不动）');
  /* 「不提前渲染」的判据：源码里不许出现「即将上线 / 敬请期待」这类承诺。
     ⚠️ 判的是**字符串字面量**，不是注释 —— 这一段注释里正好写着那句话（说明为什么要禁）。 */
  const gameCode = gameSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  chk(!/即将上线|敬请期待/.test(gameCode),
    'js/game.js 里不写「即将上线」这类跑在代码前面的承诺');

  /* 页面不许自己拼 tier / plan（与 /plans/ 同一条纪律） */
  const g = gameSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  chk(/Ent\.can\(/.test(g), '能不能用一律走 Entitlement.can()');
  chk(!/tier\s*===\s*["']/.test(g), 'js/game.js 不自己写 tier === "pro" 这类判断');
  chk(/Ent\.denyReason\(/.test(g), '拦住用户那句话由 Entitlement.denyReason() 出，页面不自造');

  /* 判分只传题的标识与用户选的那一条 —— 不把客户端手上的答案传上去 */
  const body = gameSrc.slice(gameSrc.indexOf('function submit'), gameSrc.indexOf('function checkSaid'));
  chk(/bankId:\s*q\.id/.test(body), '交卷时传的是 bankId（服务端据此重建题目）');
  chk(!/answer:\s*q\.answer/.test(body), '交卷时**不传** answer（传了也不会被采信）');

  /* 索引页的已读键不许被这一层写脏 */
  chk(gameSrc.indexOf('poem_poems_read_v1') < 0 && gameSrc.indexOf('poem_recite_progress_v1') < 0,
    'js/game.js 不碰任何进度 / 已读存储键（答题不留记录）');
}

console.log('\n' + (fails ? '❌ ' + fails + ' 项失败' : '🎉 古诗词大会内核测试全部通过'));
process.exit(fails ? 1 : 0);
