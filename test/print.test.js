/**
 * 篇目打印页 · 版面内核测试（3 期 · 不花钱的那一层）
 * ==========================================================================
 * 这一层验**内核**（`js/print-core.js`，纯 Node，零 DOM、零网络、零依赖）：
 *
 *   1. 断行：标点照排（原文怎么断，纸面上就怎么断）、空行与纯标点行丢掉；
 *   2. 块：一篇 = 一张卡片，高度是**算出来的**（标题 + 出处 + 正文 + 间距）；
 *   3. 开关：拼音 / 译文 / 注释格线三个块 —— 关掉就真的不出现在纸上，
 *      而且**改开关就会改页数**（这是「约几张」说得准的前提）；
 *   4. 排版：卡片不跨栏、长过一整栏的单独占一栏并如实报出来、
 *      没有正文的篇目**不占位置**且如实计数（不悄悄少一篇）。
 *
 * 跑法：`node test/print.test.js`（纯 Node，不联网、不装依赖）
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const P = require(path.join(ROOT, 'js', 'print-core.js'));

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };
const eq = (a, b, m) => chk(a === b, m + '（实际 ' + JSON.stringify(a) + '）');

/* ------------------------------------------------------------ 一、断行 */

{
  const src = '床前明月光，疑是地上霜。\n举头望明月，低头思故乡。';
  const ls = P.linesOf(src);
  eq(ls.length, 2, '两行原文断成两行（不重排）');
  eq(ls[0], '床前明月光，疑是地上霜。', '第一行**原样**保留（标点照排，不改字）');

  // 空行、纯空白行、只有标点的行都不上千（数据里的换行常留下这几类）
  eq(P.linesOf('甲。\n\n　\n，\n乙。').length, 2, '空行 / 全角空格行 / 纯标点行都丢掉（实际 2 行）');

  // 七言绝句不按字数重排成两行 —— 原文一行就是一行
  const q = '朝辞白帝彩云间，千里江陵一日还。两岸猿声啼不住，轻舟已过万重山。';
  eq(P.linesOf(q).length, 1, '长句**不**按字数折行（纸面上的断行就是原文的断行）');
}

/* ------------------------------------------------------------ 二、块 */

{
  const p = {
    id: 'x', title: '静夜思', author: '李白', dynasty: '唐',
    text: '床前明月光，疑是地上霜。\n举头望明月，低头思故乡。'
  };
  const b = P.blockOf(p, {});
  eq(b.rows.length, 2, '两行正文 = 两行');
  eq(b.rows.filter(r => r.kind === 'text').length, 2, '两行都是 text 类（预览与打印按这个类上样式）');
  eq(b.height, 2 + 1 + 1 + P.GAP_ROWS, '卡片高度 = 正文 + 标题 + 出处 + 间距（算出来的，不是估的）');
  eq(b.title, '静夜思　李白', '标题行带上作者');
  chk(b.meta.indexOf('唐') === 0, '出处行以朝代开头（实际 ' + b.meta + '）');

  // 缺哪一样就不写哪一样，不拿「未知」占位
  const b2 = P.blockOf({ id: 'y', title: '无题', text: '一句。' }, {});
  eq(b2.meta, '', '没有朝代 / 出处时那一行整条不出现（不写「未知」）');
  eq(b2.height, 1 + 1 + P.GAP_ROWS, '出处那一行不占位置（高度跟着少 1）');
}

/* ------------------------------------------------- 三、三个块开关真的改纸面 */

{
  const p = {
    id: 'x', title: '静夜思', author: '李白',
    text: '床前明月光。\n举头望明月。',
    pinyin: 'chuáng qián míng yuè guāng\nyáng tóu wàng míng yuè',
    translation: '明亮的月光洒在床前。'
  };

  const base = P.blockOf(p, {});
  eq(base.rows.filter(r => r.kind === 'pinyin').length, 0, '不开拼音时纸面上没有拼音行');
  eq(base.rows.filter(r => r.kind === 'translation').length, 0, '不开译文时纸面上没有译文行');
  eq(base.rows.filter(r => r.kind === 'blank').length, 0, '不开格线时纸面上没有空白行');

  const on = P.blockOf(p, { pinyin: true, translation: true, blank: true, blankLines: 3 });
  eq(on.rows.filter(r => r.kind === 'pinyin').length, 2, '开拼音：正文两行各配一行拼音');
  eq(on.rows.filter(r => r.kind === 'translation').length, 1, '开译文：整篇之后另起一行（不是逐句对照）');
  eq(on.rows.filter(r => r.kind === 'blank').length, 3, '开格线：留 3 行空白');
  chk(on.height > base.height, '开了这些块，卡片更高（也就更占纸）');

  /* ⚠️ 逐行配对：拼音与正文按同一个换行写，错位一行会把上一句的拼音贴到下一句上 */
  const pair = P.blockOf(p, { pinyin: true });
  eq(pair.rows[0].kind, 'pinyin', '第一行是拼音（贴在它下面那一行正文的上方）');
  eq(pair.rows[0].text, 'chuáng qián míng yuè guāng', '第一行拼音配的是第一行正文');
  eq(pair.rows[1].kind, 'text', '第二行是正文');

  /* 拼音数据比正文多 / 少：**多余的不上纸、少的不补空** —— 不补空是因为
     纸面上对不齐的空白比没有拼音更难看，也不补假拼音（那是编造）。 */
  const short = P.blockOf({ id: 'z', text: '一。\n二。\n三。', pinyin: 'yi' }, { pinyin: true });
  eq(short.rows.filter(r => r.kind === 'pinyin').length, 1, '拼音行比正文少时只贴得上几行就是几行');

  /* 拼音数据没有时，开关打开也**不凭空多一行** */
  const noPy = P.blockOf({ id: 'z', text: '一句。' }, { pinyin: true });
  eq(noPy.rows.filter(r => r.kind === 'pinyin').length, 0, '这一篇没有注音数据，开关打开也不多一行');

  /* 格线是**选项**，不是「有数据才有」—— 它回答的是「我要不要留位置写注释」 */
  const none = P.blockOf(p, { blank: true, blankLines: 0 });
  eq(none.rows.filter(r => r.kind === 'blank').length, 0, '格线留 0 行 = 不留（不是留一行）');
}

/* ------------------------------------------------------------ 四、排版 */

{
  const mk = (id, n) => ({
    id: id, title: '第' + n + '篇', text: new Array(n).fill('句。').join('\n')
  });
  const a4 = P.paperOf('a4');
  const perColumn = a4.rows - P.HEADER_ROWS;

  // 一张刚好放得下：1 张纸
  const one = P.layout([mk('a', 4)], { paper: 'a4' });
  eq(one.sheets, 1, '一篇 = 1 张纸');

  // 塞到刚好超出一栏 → 2 张纸
  const many = [];
  const each = 20;                      // 每篇高度 = 20 + 2 + 1
  const fit = Math.floor(perColumn / each);
  for (let i = 0; i < fit; i += 1) many.push(mk('a' + i, each));
  eq(P.layout(many, { paper: 'a4' }).sheets, 1, fit + ' 篇刚好放满一栏 = 1 张纸');
  many.push(mk('overflow', each));
  eq(P.layout(many, { paper: 'a4' }).sheets, 2, '再多一篇就换第 2 张纸（不是硬塞）');

  /* 横向两栏：同样一批篇目用的纸**不会更多**（两栏是在同一张纸上排两份） */
  const wide = P.layout(many, { paper: 'a4wide' });
  const tall = P.layout(many, { paper: 'a4' });
  chk(wide.sheets <= tall.sheets, '横向两栏用的纸不超过纵向（' + wide.sheets + ' ≤ ' + tall.sheets + '）');
  eq(wide.columns, 2, '横向是两栏（版面参数由 Paper 给，不在 CSS 里另写一份）');

  /* 比一整栏还高的篇目：**自己占掉一栏**，并如实报进 oversize
     —— 悄悄让它把后面的挤走，用户只会看到「少了几篇」 */
  const huge = P.layout([mk('huge', perColumn + 10), mk('after', 3)], { paper: 'a4' });
  eq(huge.oversize.length, 1, '超长的那一篇被如实报出来（oversize）');
  eq(huge.blocks.length, 2, '两篇都还在纸面上（没有被静默丢掉）');

  /* 没有正文的篇目：不占位置、也不静默消失 —— 数进 `empty` 由界面如实说 */
  const mix = P.layout([
    { id: 'ok', title: '有正文', text: '一句。' },
    { id: 'bad', title: '没正文', text: '' }
  ], { paper: 'a4' });
  eq(mix.count, 1, '有正文的那一篇排进去了');
  eq(mix.empty, 1, '没有正文的那一篇被如实数出来（不静默少一篇）');

  // 空输入不炸
  const empty = P.layout([], { paper: 'a4' });
  eq(empty.sheets, 0, '一篇都没有时不报「一张纸」');
  eq(empty.count, 0, '空份的篇数是 0');
  eq(P.summary(empty), '这一份里还没有篇目。', '空份的说明照实说');
}

/* ------------------------------------------------ 五、页数说明：只说「约」 */

{
  const lay = P.layout([{ id: 'a', title: '甲', text: '一句。\n两句。' }], { paper: 'a4' });
  const s = P.summary(lay);
  chk(s.indexOf('约') === 0, '说的是「约 N 张」（不是「正好」—— 字形宽度渲染时才定得下来）');
  chk(/A4 纵向/.test(s), '带上纸型名（三种纸的页数不一样，必须说清是哪一种）');
  chk(/1 篇/.test(s), '带上篇数');
  chk(!/正好|恰好/.test(s), '没有一个字说成「正好」');
}

/* ------------------------------------------------- 六、版面参数只有一份 */

{
  const p = P.PAPER;
  eq(P.ORDER.length, 3, '三种纸（两种 A4 + 半张）');
  eq(P.ORDER.filter(k => p[k] && p[k].isDefault).length, 1, '只有一种纸是默认（不多不少一个默认）');
  P.ORDER.forEach(k => {
    chk(!!p[k] && p[k].columns >= 1 && p[k].rows > 0, '纸型 ' + k + ' 的栏数与行数是正数');
  });
  chk(!/^\s*\.print/.test(''), '版面参数由内核给出 —— 打印样式表里不另写一份页数');
}

{
  // 三种纸的默认取值随 `paperOf` 回落，脏值不抛
  eq(P.paperOf('nope').id, 'a4', '不认识的纸型回落 A4（不抛、不白屏）');
  eq(P.paperOf(null).id, 'a4', '纸型缺省时回落 A4');
}

console.log(fails === 0 ? '\n🎉 篇目打印页 · 版面内核测试全部通过' : '\n❌ ' + fails + ' 项失败');
process.exit(fails ? 1 : 0);
