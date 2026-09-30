/* ==========================================================================
   帝王「中国」/「外国」· 语料与边界（Issue #407）
   --------------------------------------------------------------------------
   用户原话：

     「课外阅读添加集子如下：帝王「中国」、帝王「外国」。
       中国需要列出夏商周春秋战国直至清末的所有帝王，皇帝，姓名，年号，
       在位年，谥号，庙号，生平，谱系，以及如下
         1. 政治：制度、吏治、集权   2. 经济：赋税、生产、民生
         3. 军事：拓土、平乱、边防   4. 文化：典籍、思想、文教
         5. 民族外交：民族关系、对外交往   6. 个人：品行、用人、晚年得失
       外国帝王至少覆盖教科书小初高大学阶段所有提及的。」

   这一份把那些要求变成**可执行的断言**：
     一、结构：两卷在册、id 不重、每条的字段齐、正文画了表格；
     二、七格：每位都有 姓名 / 年号 / 在位 / 谥号 / 庙号 / 谱系 + 生平，
         以及六维评价（政治 / 经济 / 军事 / 文化 / 民族外交 / 个人）；
     三、次序：中国卷按二十七个时期的先后（传说时代 → 清），外国卷按五个时期；
     四、覆盖：中国卷到最后一位是清逊帝（帝制终），外国卷点名抽查
         教科书里那些必有的（金字塔 / 汉谟拉比 / 亚历山大 / 凯撒 /
         奥古斯都 / 查理曼 / 拿破仑 / 维多利亚 / 明治 / 裕仁）；
     五、传说时代（Issue #407 的追问）：三皇五帝与同时诸家另立首段、
         不混进「夏」，且「年号 / 谥号 / 庙号」三格如实标「无」——
         不把传说写成信史。
     六、东周诸侯（Issue #407 的第三次追问）：「补齐东周后期 春秋战国各主要
         诸侯国诸侯王的世系及数据 正确按时间排序」—— 十三个主要诸侯国
         （晋楚齐秦宋鲁郑吴越赵魏韩燕）另立一段，与「东周（春秋）」
         「东周（战国）」两段并列（那两段是周天子）；每位多一格「世系」
         （一国一条，按在位先后连起来）；**段内按国、一国之内按在位年
         先后**排；年号 / 庙号两格如实标「无」（年号起于汉武帝、庙号始于汉）；
         号段另起 em-c-vassal-NN，老号段一位不动。
   ========================================================================== */
const fs = require('fs');
const vm = require('vm');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const { loadData, resolve } = require('./master-env');
const sb = { window: {}, console };
sb.window = sb;
vm.createContext(sb);
loadData(sb, ['data/poems-emperor-cn.js', 'data/poems-emperor-waiguo.js']);

const CN = resolve(sb, sb.POEMS_EMPEROR_CN, '帝王「中国」');
const W = resolve(sb, sb.POEMS_EMPEROR_FOREIGN, '帝王「外国」');

/* ── 一、结构 ─────────────────────────────────────────────────────────── */
chk(CN.length > 600, '帝王「中国」六百位以上（实际 ' + CN.length + '）');
chk(W.length >= 60, '帝王「外国」六十位以上（实际 ' + W.length + '）');

[['帝王「中国」', CN], ['帝王「外国」', W]].forEach(function (row) {
  const name = row[0], list = row[1];
  const ids = new Set();
  let dup = 0;
  list.forEach(p => { if (ids.has(p.id)) dup++; ids.add(p.id); });
  chk(dup === 0, name + ' id 无重复（重复 ' + dup + '）');
  chk(list.every(p => p.title && p.dynasty && p.author && p.source && p.excerpt),
    name + ' 每条都有题名 / 时期 / 姓名 / 出处 / 一句话');
  chk(list.every(p => p.gradeGroup === p.group), name + ' 分组的 gradeGroup 与 group 一致');
  /* 词条式：整部不带白话译文 —— **只对「外国」卷**说。
     中国卷的东周诸侯那一段是例外：253 位各有一篇列传体的白话译文
     （Issue #407 的第三次追问：「补齐……世系及数据」）。见下面那一组断言。 */
  if (name === '帝王「外国」') {
    chk(list.every(p => !p.translation), name + ' 词条式：每条都不带白话译文');
  } else {
    const stray = list.filter(p => p.translation && p.group !== '东周·诸侯（春秋战国）');
    chk(stray.length === 0,
      '除东周诸侯那一段外，中国卷别的段不带白话译文（实际带着译文的：' +
        (stray.map(p => p.title).slice(0, 5).join('、') || '无') + '）');
  }
  chk(list.every(p => (p.text || '').indexOf('│') >= 0),
    name + ' 每条正文都画了表格（身份档案那一张）');
  /* 六维评价 + 生平：每一条都要有 */
  const miss = [];
  list.forEach(p => {
    ['姓名', '年号', '在位', '谥号', '庙号', '谱系'].forEach(k => {
      if (String(p.text || '').indexOf('│ ' + k) < 0) miss.push(p.title + ' 缺' + k);
    });
    /* 东周诸侯那一段多一格「世系」（一国一条的世系图，见 build-emperor.js
       的 lineageOf）；别的段不该有这一格。 */
    const hasChart = String(p.text || '').indexOf('│ 世系') >= 0;
    if (p.group === '东周·诸侯（春秋战国）' && !hasChart) miss.push(p.title + ' 缺世系图');
    if (p.group !== '东周·诸侯（春秋战国）' && hasChart) miss.push(p.title + ' 多出世系图');
    ['生平', '政治', '经济', '军事', '文化', '民族外交', '个人'].forEach(k => {
      if (String(p.text || '').indexOf('【' + k + '】') < 0) miss.push(p.title + ' 缺【' + k + '】');
    });
  });
  chk(miss.length === 0, name + ' 每位都有七格 + 六维评价（异常：' +
    (miss.slice(0, 5).join('、') || '无') + '）');
  /* 六段不许敷衍：每段都要有一句实质内容。
     ⚠️ 阈值取 7 字而不是 20 —— 夏商与十六国那些只有一两句记载的君主
     （扃、皋、廑……），「军事」一栏本来就只能是「无战事记载」一句。
     要求它们写满二十字，等于逼着编造史实，与本卷「只写有定论的」那条
     口径相违。所以守的是「没有空段」，不是「每段都很长」。 */
  const thin = [];
  list.forEach(p => {
    ['生平', '政治', '经济', '军事', '文化', '民族外交', '个人'].forEach(k => {
      const m = String(p.text || '').match(new RegExp('【' + k + '】([^\\n]*)'));
      if (!m || m[1].replace(/\s/g, '').length < 7) thin.push(p.title + ' 的【' + k + '】过短');
    });
  });
  chk(thin.length === 0, name + ' 六段与生平都不敷衍（异常：' +
    (thin.slice(0, 5).join('、') || '无') + '）');
  /* 段间空行（Issue #407 第四次追问）：
     「所有帝王 生平，政治，经济，军事，文化，民族外交，个人以及一句话
     直接增加间隔（或者空白行）」。九段（生平 + 六维 + 一句话）之间一律
     夹一个空行 —— 阅读器把空行渲染成一次换行，段与段才分得开。
     表格与【生平】之间也留一行，别贴在框线上。 */
  const noGap = [];
  list.forEach(p => {
    const seg = ['生平', '政治', '经济', '军事', '文化', '民族外交', '个人', '一句话'];
    for (let i = 0; i < seg.length - 1; i += 1) {
      const re = new RegExp('【' + seg[i] + '】[^\\n]*\\n\\n【' + seg[i + 1] + '】');
      if (!re.test(String(p.text || ''))) {
        noGap.push(p.title + ' 的【' + seg[i] + '】与【' + seg[i + 1] + '】之间没有空行');
      }
    }
    if (!/┘\n\n【生平】/.test(String(p.text || ''))) {
      noGap.push(p.title + ' 的表格与【生平】之间没有空行');
    }
  });
  chk(noGap.length === 0, name + ' 九段之间都留了空行（异常：' +
    (noGap.slice(0, 5).join('、') || '无') + '）');
});

/* ── 二、次序 ─────────────────────────────────────────────────────────── */
const CN_PERIODS = ['传说时代', '夏', '商', '西周', '东周（春秋）', '东周（战国）',
  '东周·诸侯（春秋战国）', '秦',
  '西汉', '新', '东汉', '三国', '西晋', '东晋', '十六国', '南北朝',
  '隋', '唐', '五代十国', '辽', '北宋', '西夏', '金', '南宋',
  '元', '明', '清'];
const seen = [];
CN.forEach(p => { if (seen[seen.length - 1] !== p.group) seen.push(p.group); });
chk(seen.every(g => CN_PERIODS.indexOf(g) >= 0),
  '帝王「中国」的每一段都在册（实际：' + Array.from(new Set(seen)).join('/') + '）');
const order = seen.map(g => CN_PERIODS.indexOf(g));
chk(order.every((v, i) => i === 0 || v > order[i - 1]),
  '帝王「中国」按分期先后排（夏 → 商 → … → 清；实际段序：' + seen.join(' → ') + '）');
chk(seen[0] === '传说时代' && seen[seen.length - 1] === '清',
  '帝王「中国」首段是传说时代、末段是清（实际 ' + seen[0] + ' … ' + seen[seen.length - 1] + '）');

/* ── 三之二、传说时代（Issue #407 追问） ────────────────────────────────
   用户问：「三皇（伏羲、神农、燧人），史记五帝，鲧、禹、丹朱。少昊、
   女娲、有巢氏、玄嚣、象、蚩尤、共工、祝融、帝俊 —— 这些要写吗 靠谱吗？」
   答：写，但**与夏以后分开另立一段**，并如实标出「无纪年 / 无谥法 /
   不立庙」。这一组断言守的就是这条边界。 */
const LEGEND = CN.filter(p => p.group === '传说时代');
chk(LEGEND.length >= 15, '传说时代一段成段（实际 ' + LEGEND.length + ' 位）');
chk(CN[0].group === '传说时代', '传说时代排在全卷最前，不混进「夏」');
const LEG_SPOT = ['伏羲', '神农', '燧人', '黄帝', '颛顼', '帝喾', '尧', '舜',
  '少昊', '玄嚣', '蚩尤', '共工', '祝融', '帝俊', '女娲', '有巢氏'];
const LEGT = new Set(LEGEND.map(p => p.title));
chk(LEG_SPOT.every(t => LEGT.has(t)),
  '传说时代覆盖用户点名的十六位（缺：' + (LEG_SPOT.filter(t => !LEGT.has(t)).join('、') || '无') + '）');
chk(LEGEND.every(p => /—（无纪年）/.test(p.text)),
  '传说时代不编年号：每位的「年号」格都写「—（无纪年）」');
chk(LEGEND.every(p => /—（无谥法）/.test(p.text) && /—（不立庙）/.test(p.text)),
  '传说时代不编谥号 / 庙号：两格都如实标「无」（谥法行于周，庙号始于汉）');
chk(LEGEND.every(p => /谱系/.test(p.text)),
  '传说时代每位的「谱系」格都写清了承谁之统');
/* 传说与信史的分界：段里的正文要能看出「哪些是传说、哪些是神话」 */
const story = LEGEND.filter(p => /相传|传说|文献|神话|《山海经》|《史记》/.test(p.text));
chk(story.length === LEGEND.length,
  '传说时代每位都交代了史料性质（缺：' +
    (LEGEND.filter(p => !/相传|传说|文献|神话|《山海经》|《史记》/.test(p.text))
      .map(p => p.title).join('、') || '无') + '）');
/* 大禹仍在「夏」段 —— 他跨传说与信史，是夏的开国者，别把他挪进传说时代 */
chk(CN.some(p => p.title === '大禹' && p.group === '夏'),
  '大禹仍在「夏」段（传说与信史的交界，不挪进传说时代）');
/* 传说时代那一段另起号 em-c-legend-NN：老号段一位不动，
   否则主表里几百条的正文会跟着 id 整体挪位（名著导读那一卷踩过）。 */
chk(LEGEND.every(p => /^em-c-legend-\d+$/.test(p.id)),
  '传说时代另起号段 em-c-legend-NN（实际：' +
    Array.from(new Set(LEGEND.map(p => p.id.replace(/\d+$/, 'NN')))).join('/') + '）');
chk(CN.filter(p => p.group !== '传说时代' && p.group !== '东周·诸侯（春秋战国）')
  .every(p => /^em-c-\d+$/.test(p.id)),
  '其余各段仍在老号段 em-c-NN（一位不动）');

/* ── 三之三、东周诸侯（Issue #407 第三次追问） ──────────────────────────
   用户原话：「需要补齐东周后期 春秋战国各主要诸侯国诸侯王的世系及数据
   正确按时间排序」。这一段另立在周天子两段之后、秦之前，一节一节守：
   国别齐备、段内按国、一国之内按在位年先后、每位有世系图、年号与庙号
   如实标「无」、号段另起。 */
const VASSAL = CN.filter(p => p.group === '东周·诸侯（春秋战国）');
chk(VASSAL.length >= 250,
  '东周诸侯一段成段（实际 ' + VASSAL.length + ' 位）');
/* 段的位置：紧接「东周（战国）」之后、秦之前 —— 回答「按时间排序」 */
const periodSeq = [];
CN.forEach(p => { if (periodSeq[periodSeq.length - 1] !== p.group) periodSeq.push(p.group); });
const vAt = periodSeq.indexOf('东周·诸侯（春秋战国）');
chk(vAt > periodSeq.indexOf('东周（战国）') && vAt < periodSeq.indexOf('秦'),
  '诸侯段排在「东周（战国）」之后、「秦」之前（实际第 ' + (vAt + 1) + ' 段）');

/* 国别：用户说的是「各主要诸侯国」—— 春秋五霸与战国七雄的所在国都要有 */
const NATIONS = ['晋', '楚', '齐', '秦', '宋', '鲁', '郑', '吴', '越',
  '赵', '魏', '韩', '燕'];
const hasNation = {};
VASSAL.forEach(p => { hasNation[p.dynasty] = (hasNation[p.dynasty] || 0) + 1; });
chk(NATIONS.every(n => hasNation[n] > 0),
  '东周诸侯覆盖用户所说的主要诸侯国（缺：' +
    (NATIONS.filter(n => !hasNation[n]).join('、') || '无') + '；实际：' +
    Object.keys(hasNation).join('/') + '）');
chk(Object.keys(hasNation).every(n => NATIONS.indexOf(n) >= 0),
  '诸侯段的国别栏不出现名单外的国（多出：' +
    (Object.keys(hasNation).filter(n => NATIONS.indexOf(n) < 0).join('、') || '无') + '）');

/* 段内按国排：同一国的君主必须连在一起（列表页的分段与索引卡靠它） */
const nationSeq = [];
VASSAL.forEach(p => { if (nationSeq[nationSeq.length - 1] !== p.dynasty) nationSeq.push(p.dynasty); });
const seenNation = {};
const splitNation = nationSeq.filter(n => {
  if (seenNation[n]) return true;
  seenNation[n] = 1;
  return false;
});
chk(splitNation.length === 0,
  '一国的君主在段内连在一起（被打断的国：' + (splitNation.join('、') || '无') + '）');

/* 一国之内按在位年先后：从即位年里抽第一个公元前年份，必须单调不减 ——
   这就是用户说的「正确按时间排序」。
   ⚠️ 例外：吴太伯 / 吴仲雍 / 燕召公的年代不可考（写「约前 11 世纪」），
      他们在本国的队首，不参与这条检查。 */
function firstYear(reign) {
  const m = String(reign).match(/前\s*(\d+)/);
  return m ? -Number(m[1]) : null;
}
const outOfOrder = [];
NATIONS.forEach(n => {
  const list = VASSAL.filter(p => p.dynasty === n);
  let prev = null;
  list.forEach(p => {
    const y = firstYear(p.reign);
    if (y === null) return;
    if (prev !== null && y < prev) outOfOrder.push(n + '·' + p.title + '（' + p.reign + '）');
    prev = y;
  });
});
chk(outOfOrder.length === 0,
  '一国之内的君主按在位年先后排（乱序：' + (outOfOrder.join('、') || '无') + '）');

/* 世系图：每位都要有，且一张图里写全这一国的君主（按在位先后） */
const chartBad = [];
VASSAL.forEach(p => {
  /* ⚠️ 取「世系」那一格时不能带 \s* —— 表格的补白是空格，而图表内部
     以「 → 」连接，\s* 会把整条行吞成空串（第一版就这么踩了一脚）。 */
  const m = String(p.text || '').match(/│ 世系 │ ([^\n│]+)│/);
  if (!m) { chartBad.push(p.title + ' 无世系行'); return; }
  const names = VASSAL.filter(x => x.dynasty === p.dynasty).map(x => x.title);
  names.forEach(n => { if (m[1].indexOf(n) < 0) chartBad.push(p.title + ' 的世系图里缺 ' + n); });
  if (m[1].indexOf('→') < 0 && names.length > 1) chartBad.push(p.title + ' 的世系图没有连线');
});
chk(chartBad.length === 0,
  '诸侯每位都有一张写全本国君主的世系图（异常：' +
    (chartBad.slice(0, 5).join('、') || '无') + '）');

/* 年号 / 庙号：春秋战国没有年号（起于汉武帝）、诸侯不立庙号（始于汉），
   两格如实标「无」，不假造 —— 与传说时代同一条口径。 */
chk(VASSAL.every(p => /│ 年号 │ —（[^）]*纪年[^）]*）/.test(p.text)),
  '诸侯不编年号：每位的「年号」格都写本国纪年（—（…纪年））');
chk(VASSAL.every(p => /│ 庙号 │ —（不立庙）/.test(p.text)),
  '诸侯不编庙号：每位的「庙号」格都如实标「无」（庙号始于汉）');
/* 谥号：春秋战国的国君大多有谥 —— 有谥的写谥，无谥的如实标出，不许留空 */
chk(VASSAL.every(p => /│ 谥号 │ [^\n]*\S/.test(p.text)),
  '诸侯的「谥号」格要么写谥、要么写明「无谥 / 恶谥」，没有空格子');

/* 号段：诸侯段另起 em-c-vassal-NN，老号段一位不动（与传说时代同一条纪律） */
chk(VASSAL.every(p => /^em-c-vassal-\d+$/.test(p.id)),
  '诸侯段另起号段 em-c-vassal-NN（实际：' +
    Array.from(new Set(VASSAL.map(p => p.id.replace(/\d+$/, 'NN')))).join('/') + '）');
chk(VASSAL.filter(p => /^em-c-vassal-\d+$/.test(p.id)).length === VASSAL.length,
  '诸侯段的号不与其他段混用');
/* 一人一处之外的另一条账：诸侯那一段里的「国别」不能是「周」——
   周天子另有两段，诸侯段只放诸侯。 */
chk(VASSAL.every(p => p.dynasty !== '周'),
  '周天子不混进诸侯段（天子在「东周（春秋）」「东周（战国）」两段）');
/* 与天子两段不重叠：天子的标题里都带「周」，诸侯段里一个都不该有 */
const VASSAL_T = new Set(VASSAL.map(p => p.title));
const SON_OF_TIAN = CN.filter(p => p.group === '东周（春秋）' || p.group === '东周（战国）')
  .map(p => p.title);
chk(SON_OF_TIAN.every(t => !VASSAL_T.has(t)),
  '周天子的 25 位一个也没落进诸侯段（重叠：' +
    SON_OF_TIAN.filter(t => VASSAL_T.has(t)).join('、') + '）');

/* 白话译文（诸侯独有）：253 位都要有一篇，且要真的是一篇话 ——
   长度下限取 40 字，一位君主的生平（谁、在位几年、做了哪几件事、传给谁）
   少了这几十字就写不完整。 */
const transMiss = VASSAL.filter(p => !p.translation || String(p.translation).length < 40);
chk(transMiss.length === 0,
  '东周诸侯每位都有白话译文、且不是一句敷衍（异常：' +
    (transMiss.slice(0, 5).map(p => p.title).join('、') || '无') + '）');
/* ⚠️ 译文走的也是主表那条路：壳里只留 hasTranslation 的标记，
   正文与译文都在 data/text-master.js（唯一一份，见 test/canonical.test.js）。 */
chk(VASSAL.every(p => p.hasTranslation === true),
  '诸侯每条在壳里都标了 hasTranslation（列表页据它挂译文入口）');
/* ⚠️ CN 是**取回主表之后**的条目（masterTextOf 会把译文一起贴回来），
   所以要判「壳里有没有内联译文」，得直接读壳那份数据文件 —— 有翻译
   字段就是内联了（第 40 行起的 `translation:` 是唯一判据）。 */
chk(fs.readFileSync(require('path').join(__dirname, '../data/poems-emperor-cn.js'), 'utf8')
  .indexOf('translation:') < 0,
  '译文不内联在壳里（正文与译文都收归 data/text-master.js 那一份）');
/* 译文与正文不要是同一段话（复制过去凑数是最容易犯的错） */
chk(VASSAL.every(p => String(p.translation).indexOf('【生平】') < 0 &&
  String(p.translation).indexOf('│') < 0),
  '诸侯的白话译文是独立的列传体，不是把正文复制一份');
/* 译文的取材要落在史料上：不能只写「他在位若干年」——
   要么给出公元前年份 / 公元，要么点出文献（《史记》《左传》…），
   要么写清楚是谁的儿子（承谁之统）。三条里有一条就算落到实处。
   ⚠️ 「在位若干年」不算 —— 那正是只抄了表格里一格的样子。 */
const vague = VASSAL.filter(p => !/前\s*\d|公元\d|《/.test(String(p.translation)) &&
  !/的儿子|的弟弟|的孙子|的哥哥|之后|之子/.test(String(p.translation)));
chk(vague.length === 0,
  '诸侯的译文都落在具体的年份 / 文献 / 承统上（含糊：' +
    (vague.slice(0, 5).map(p => p.title).join('、') || '无') + '）');

const W_PERIODS = ['上古东方', '希腊与罗马', '中世纪与伊斯兰', '近代欧洲', '现代'];
const wseen = [];
W.forEach(p => { if (wseen[wseen.length - 1] !== p.group) wseen.push(p.group); });
const worder = wseen.map(g => W_PERIODS.indexOf(g));
chk(worder.every(v => v >= 0) && worder.every((v, i) => i === 0 || v > worder[i - 1]),
  '帝王「外国」按五个时期先后排（实际段序：' + wseen.join(' → ') + '）');

/* ── 三、覆盖：中国卷到清末 ───────────────────────────────────────────── */
const CN_SPOT = ['大禹', '商汤', '周武王', '周平王', '秦始皇', '汉高祖', '汉武帝',
  '魏文帝', '晋武帝', '隋文帝', '唐太宗', '武则天', '宋太祖', '元太祖', '明太祖', '清圣祖', '清德宗'];
const CNT = new Set(CN.map(p => p.title));
chk(CN_SPOT.every(t => CNT.has(t)),
  '中国卷覆盖各代代表帝王（缺：' + (CN_SPOT.filter(t => !CNT.has(t)).join('、') || '无') + '）');
chk(CNT.has('清逊帝') && CN[CN.length - 1].title === '清逊帝',
  '中国卷排到最后一位是清逊帝（帝制终；实际 ' + CN[CN.length - 1].title + '）');
const qing = CN.filter(p => p.group === '清').map(p => p.title);
chk(qing.indexOf('清宣宗') >= 0 && qing.indexOf('清德宗') >= 0,
  '清末自道光以后是近代史主线，一路收到宣统（实际：' + qing.join('、') + '）');

/* ── 四、覆盖：外国卷教科书点名 ───────────────────────────────────────── */
const W_SPOT = ['胡夫', '汉谟拉比', '居鲁士二世', '亚历山大大帝', '凯撒', '奥古斯都',
  '查士丁尼一世', '穆罕默德', '查理大帝', '路易十四', '拿破仑一世', '维多利亚',
  '明治天皇', '尼古拉二世', '裕仁'];
const WT = new Set(W.map(p => p.title));
chk(W_SPOT.every(t => WT.has(t)),
  '外国卷覆盖教科书点名的各国君主（缺：' + (W_SPOT.filter(t => !WT.has(t)).join('、') || '无') + '）');

/* 帝王两卷与历代名家两卷之间：**同一个「一人一处」的账** —— 以帝王身份
   为主要身份的人只在帝王卷，不在名家卷（见 scripts/data/mingren-round11.js）。 */
loadData(sb, ['data/poems-mingren-cn.js', 'data/poems-mingren-foreign.js']);
const MR = resolve(sb, sb.POEMS_MINGREN_CN, '名家「中国」')
  .concat(resolve(sb, sb.POEMS_MINGREN_FOREIGN, '名家「外国」'));
const MRT = new Set(MR.map(p => p.title));
const rulers = ['奥古斯都', '图拉真', '腓特烈二世', '梭伦', '伯里克利', '俾斯麦'];
chk(rulers.every(t => WT.has(t) && !MRT.has(t)),
  '本身即为君主 / 执政元首的 6 位只在帝王卷、不在名家卷（越界：' + rulers.filter(t => MRT.has(t)).join('、') + '）');

/* ── 五、外国帝王「姓名」一格放外文名（Issue #399）────────────────────
   用户 2026-09-30 的话：「所有外国帝王和名人，请添加他们的英文，以及所在
   国家语言的名字。如果能找到的话。」

   帝王没有中文意义上的「字 / 号」，对应的一格是「姓名」。外国帝王那一格
   先前只写汉译名，本轮起接上素材里的 `nameFull`（含外文名）。守两条：
     · 外国卷**每一条**的「姓名」格里都得有西文字母；
     · 中国卷的「姓名」（姒文命 / 刘彻）是真的姓名，一条都不许出现西文字母。 */
const wNoLatin = W.filter(function (p) {
  const m = String(p.text).match(/│ 姓名 *│([^│]*)│/);
  const cell = m ? m[1].trim() : '';
  return !/[A-Za-z\u00C0-\u024F\u0400-\u04FF]/.test(cell);
});
chk(wNoLatin.length === 0,
  '帝王「外国」' + W.length + ' 位的「姓名」格都有外文名（无西文：' +
  (wNoLatin.map(p => p.title).join('、') || '无') + '）');

const cnLatin = CN.filter(function (p) {
  const m = String(p.text).match(/│ 姓名 *│([^│]*)│/);
  const cell = m ? m[1].trim() : '';
  return /[A-Za-z\u00C0-\u024F\u0400-\u04FF]/.test(cell);
});
chk(cnLatin.length === 0,
  '帝王「中国」' + CN.length + ' 位的「姓名」格不含西文（混入：' +
  (cnLatin.map(p => p.title).join('、') || '无') + '）');

console.log('');
console.log(fails === 0 ? '✅ 帝王两卷语料与边界全部通过' : '❌ ' + fails + ' 项失败');
process.exit(fails ? 1 : 0);
