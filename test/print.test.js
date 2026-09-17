const path = require('path');
const ROOT = path.join(__dirname, '..');
const P = require(path.join(ROOT, 'js', 'print-core.js'));

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };
const eq = (a, b, m) => chk(a === b, m + '（实际 ' + JSON.stringify(a) + '）');

{
  const src = '床前明月光，疑是地上霜。\n举头望明月，低头思故乡。';
  const ls = P.linesOf(src);
  eq(ls.length, 2, '两行原文断成两行（不重排）');
  eq(ls[0], '床前明月光，疑是地上霜。', '第一行**原样**保留（标点照排，不改字）');

  eq(P.linesOf('甲。\n\n　\n，\n乙。').length, 2, '空行 / 全角空格行 / 纯标点行都丢掉（实际 2 行）');

  const q = '朝辞白帝彩云间，千里江陵一日还。两岸猿声啼不住，轻舟已过万重山。';
  eq(P.linesOf(q).length, 1, '长句**不**按字数折行（纸面上的断行就是原文的断行）');
}

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

  const b2 = P.blockOf({ id: 'y', title: '无题', text: '一句。' }, {});
  eq(b2.meta, '', '没有朝代 / 出处时那一行整条不出现（不写「未知」）');
  eq(b2.height, 1 + 1 + P.GAP_ROWS, '出处那一行不占位置（高度跟着少 1）');
}

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

  const pair = P.blockOf(p, { pinyin: true });
  eq(pair.rows[0].kind, 'pinyin', '第一行是拼音（贴在它下面那一行正文的上方）');
  eq(pair.rows[0].text, 'chuáng qián míng yuè guāng', '第一行拼音配的是第一行正文');
  eq(pair.rows[1].kind, 'text', '第二行是正文');

  const short = P.blockOf({ id: 'z', text: '一。\n二。\n三。', pinyin: 'yi' }, { pinyin: true });
  eq(short.rows.filter(r => r.kind === 'pinyin').length, 1, '拼音行比正文少时只贴得上几行就是几行');

  const noPy = P.blockOf({ id: 'z', text: '一句。' }, { pinyin: true });
  eq(noPy.rows.filter(r => r.kind === 'pinyin').length, 0, '这一篇没有注音数据，开关打开也不多一行');

  const none = P.blockOf(p, { blank: true, blankLines: 0 });
  eq(none.rows.filter(r => r.kind === 'blank').length, 0, '格线留 0 行 = 不留（不是留一行）');
}

{
  const mk = (id, n) => ({
    id: id, title: '第' + n + '篇', text: new Array(n).fill('句。').join('\n')
  });
  const a4 = P.paperOf('a4');
  const perColumn = a4.rows - P.HEADER_ROWS;

  const one = P.layout([mk('a', 4)], { paper: 'a4' });
  eq(one.sheets, 1, '一篇 = 1 张纸');

  const many = [];
  const each = 20;
  const fit = Math.floor(perColumn / each);
  for (let i = 0; i < fit; i += 1) many.push(mk('a' + i, each));
  eq(P.layout(many, { paper: 'a4' }).sheets, 1, fit + ' 篇刚好放满一栏 = 1 张纸');
  many.push(mk('overflow', each));
  eq(P.layout(many, { paper: 'a4' }).sheets, 2, '再多一篇就换第 2 张纸（不是硬塞）');

  const wide = P.layout(many, { paper: 'a4wide' });
  const tall = P.layout(many, { paper: 'a4' });
  chk(wide.sheets <= tall.sheets, '横向两栏用的纸不超过纵向（' + wide.sheets + ' ≤ ' + tall.sheets + '）');
  eq(wide.columns, 2, '横向是两栏（版面参数由 Paper 给，不在 CSS 里另写一份）');

  const huge = P.layout([mk('huge', perColumn + 10), mk('after', 3)], { paper: 'a4' });
  eq(huge.oversize.length, 1, '超长的那一篇被如实报出来（oversize）');
  eq(huge.blocks.length, 2, '两篇都还在纸面上（没有被静默丢掉）');

  const mix = P.layout([
    { id: 'ok', title: '有正文', text: '一句。' },
    { id: 'bad', title: '没正文', text: '' }
  ], { paper: 'a4' });
  eq(mix.count, 1, '有正文的那一篇排进去了');
  eq(mix.empty, 1, '没有正文的那一篇被如实数出来（不静默少一篇）');

  const empty = P.layout([], { paper: 'a4' });
  eq(empty.sheets, 0, '一篇都没有时不报「一张纸」');
  eq(empty.count, 0, '空份的篇数是 0');
  eq(P.summary(empty), '这一份里还没有篇目。', '空份的说明照实说');
}

{
  const lay = P.layout([{ id: 'a', title: '甲', text: '一句。\n两句。' }], { paper: 'a4' });
  const s = P.summary(lay);
  chk(s.indexOf('约') === 0, '说的是「约 N 张」（不是「正好」—— 字形宽度渲染时才定得下来）');
  chk(/A4 纵向/.test(s), '带上纸型名（三种纸的页数不一样，必须说清是哪一种）');
  chk(/1 篇/.test(s), '带上篇数');
  chk(!/正好|恰好/.test(s), '没有一个字说成「正好」');
}

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

  eq(P.paperOf('nope').id, 'a4', '不认识的纸型回落 A4（不抛、不白屏）');
  eq(P.paperOf(null).id, 'a4', '纸型缺省时回落 A4');
}

console.log(fails === 0 ? '\n🎉 篇目打印页 · 版面内核测试全部通过' : '\n❌ ' + fails + ' 项失败');
process.exit(fails ? 1 : 0);
