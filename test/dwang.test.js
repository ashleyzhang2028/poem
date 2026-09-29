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
     三、次序：中国卷按二十五个时期的先后（夏 → 清），外国卷按五个时期；
     四、覆盖：中国卷到最后一位是清逊帝（帝制终），外国卷点名抽查
         教科书里那些必有的（金字塔 / 汉谟拉比 / 亚历山大 / 凯撒 /
         奥古斯都 / 查理曼 / 拿破仑 / 维多利亚 / 明治 / 裕仁）；
     五、传说时代（Issue #407 的追问）：三皇五帝与同时诸家另立首段、
         不混进「夏」，且「年号 / 谥号 / 庙号」三格如实标「无」——
         不把传说写成信史。
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
chk(CN.length > 300, '帝王「中国」三百位以上（实际 ' + CN.length + '）');
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
  chk(list.every(p => !p.translation), name + ' 词条式：每条都不带白话译文');
  chk(list.every(p => (p.text || '').indexOf('│') >= 0),
    name + ' 每条正文都画了表格（身份档案那一张）');
  /* 六维评价 + 生平：每一条都要有 */
  const miss = [];
  list.forEach(p => {
    ['姓名', '年号', '在位', '谥号', '庙号', '谱系'].forEach(k => {
      if (String(p.text || '').indexOf('│ ' + k) < 0) miss.push(p.title + ' 缺' + k);
    });
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
});

/* ── 二、次序 ─────────────────────────────────────────────────────────── */
const CN_PERIODS = ['传说时代', '夏', '商', '西周', '东周（春秋）', '东周（战国）', '秦',
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
chk(CN.filter(p => p.group !== '传说时代').every(p => /^em-c-\d+$/.test(p.id)),
  '其余各段仍在老号段 em-c-NN（一位不动）');

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
const MR = resolve(sb, sb.POEMS_MINGREN_CN, '历代名家「中国」')
  .concat(resolve(sb, sb.POEMS_MINGREN_FOREIGN, '历代名家「外国」'));
const MRT = new Set(MR.map(p => p.title));
const rulers = ['奥古斯都', '图拉真', '腓特烈二世', '梭伦', '伯里克利', '俾斯麦'];
chk(rulers.every(t => WT.has(t) && !MRT.has(t)),
  '本身即为君主 / 执政元首的 6 位只在帝王卷、不在名家卷（越界：' + rulers.filter(t => MRT.has(t)).join('、') + '）');

console.log('');
console.log(fails === 0 ? '✅ 帝王两卷语料与边界全部通过' : '❌ ' + fails + ' 项失败');
process.exit(fails ? 1 : 0);
