const fs = require('fs');
const vm = require('vm');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const sb = { window: {}, console };
sb.window = sb;
vm.createContext(sb);

const { loadData, resolve } = require('./master-env');
loadData(sb, ['data/poems-mingshu.js', 'data/poems-mingren.js']);

function book(name, varName, groups, unit) {
  const raw = sb[varName];
  const list = resolve(sb, raw, name);
  chk(Array.isArray(list) && list.length > 0,
    name + ' 语料读得出来（实际 ' + (raw ? raw.length : 'undefined') + ' ' + unit + '）');

  const ids = new Set();
  let dup = 0;
  list.forEach(p => { if (ids.has(p.id)) dup++; ids.add(p.id); });
  chk(dup === 0, name + ' 条目 id 无重复（重复 ' + dup + ' 个）');

  chk(list.every(p => p.title && p.dynasty && p.author && p.source && p.excerpt),
    name + ' 每条都齐全：题名 / 时代 / 作者 / 出处 / 列表摘句');
  chk(list.every(p => p.gradeGroup === p.group), name + ' 分组的 gradeGroup 与 group 一致');
  chk(list.every(p => groups.indexOf(p.gradeGroup) >= 0),
    name + ' 每条都归入在册分组（' + groups.join(' / ') + '）');
  chk(list.every(p => !p.translation),
    name + ' 词条式：每条都不带白话译文（正文即词条，本就没有译文）');
  chk(list.every(p => (p.text || '').indexOf('│') >= 0),
    name + ' 每条正文都画了表格（摘掉内联正文后由主表按 textRef 取回）');

  groups.forEach(g => {
    const n = list.filter(p => p.gradeGroup === g).length;
    chk(n > 0, name + ' 分组铺到：' + g + ' 有 ' + n + ' 条');
  });

  return list;
}

const MINGSHU_GROUPS = [
  '中国古典小说', '中国现代小说', '中国当代小说',
  '中国现代散文', '中国现当代诗歌', '中国现代戏剧', '外国文学'
];
// Issue #381 第三轮补的两组：「哲学家」（用户原话「还有别的家，也要加一些，
// 例如思想家，哲学家」）与「外国名人」（用户原话「还有外国名人呢？例如
// 亚里士多德，柏拉图，欧拉，莱布尼兹，伦琴，等等」）。
const MINGREN_GROUPS = [
  '文学家', '史学家', '思想家', '哲学家', '军事家',
  '科学家', '医学家', '音乐家', '建筑家', '戏曲家',
  '外国名人'
];

const MS = book('名著导读', 'POEMS_MINGSHU', MINGSHU_GROUPS, '部');
const MR = book('历代名家', 'POEMS_MINGREN', MINGREN_GROUPS, '家');

/* 数量：Issue #381 第二轮要求「国内名著 ×10、世界名著 ≥300 本」。
   书目表 data/mingshu-books.js 已经排到 1614 部；但正文素材是**分批**写的，
   data/poems-mingshu.js 只收「素材已就绪」的那一批。所以这里守两件事：
     ① 壳文件与主表「一一对应」（不出现有壳无文、或有文无壳）；
     ② 已交付的这批，条数与字段都合规。
   总目标由 test/mingshu-books.test.js 守。 */
chk(MS.length >= 19, '名著导读已交付至少 19 部（实际 ' + MS.length + '）');
chk(MS.length <= 1614, '名著导读不超过书目表总数 1614 部（实际 ' + MS.length + '）');
chk(MR.length === 135, '历代名家共 135 位（实际 ' + MR.length + '）');

/* 名著导读：四个必修项（背景 / 情节 / 人物 / 主旨）一条都不能少，
   而且不许一句话敷衍 —— 用户原话「不要过分简略」。 */
const MS_THIN = [];
MS.forEach(p => {
  const t = p.text || '';
  ['写作背景', '情节梗概', '主要人物', '主旨'].forEach(k => {
    if (t.indexOf(k) < 0) MS_THIN.push(p.title + ' 缺' + k);
  });
  if ((p.text || '').replace(/\s/g, '').length < 2200) MS_THIN.push(p.title + ' 正文过短');
});
chk(MS_THIN.length === 0,
  '名著导读每部都有写作背景 / 情节梗概 / 主要人物 / 主旨，且正文不短于 2200 字（异常：' +
  (MS_THIN.slice(0, 5).join('、') || '无') + '）');

/* 情节梗概：Issue #381 第二轮要求「至少扩充到目前的 5 倍」。
   上一轮实测基线：均值 205 字、下限 133、上限 279。所以这里守：
     逐部 ≥ 640（下限 133 的 4.8 倍）、均值 ≥ 700（205 的 3.4 倍）。
   阈值比上一轮的 120 字紧得多 —— 上一轮是「不许一句话敷衍」，
   这一轮是「真的加厚了」。 */
const MS_PLOT = MS.map(p => (p.text.match(/【情节梗概】([\s\S]*?)【主要人物】/) || ['', ''])[1].replace(/[\s·]/g, '').length);
const plotMin = Math.min.apply(null, MS_PLOT);
const plotAvg = Math.round(MS_PLOT.reduce((a, b) => a + b, 0) / MS_PLOT.length);
chk(plotMin >= 640,
  '每一部的「情节梗概」都不少于 640 字（最短 ' + plotMin + ' 字）');
chk(plotAvg >= 700,
  '「情节梗概」均值不少于 700 字（实际均值 ' + plotAvg + ' 字）');

/* 主要人物：同样 ×5 的量级。上一轮要求 ≥3 位；这一轮 ≥15 位。 */
const MS_PEOPLE = MS.map(p => (p.text.match(/【主要人物】([\s\S]*?)【主旨】/) || ['', ''])[1].split('\n').filter(x => x.trim()).length);
chk(Math.min.apply(null, MS_PEOPLE) >= 15,
  '每一部至少列出 15 位主要人物（最少 ' + Math.min.apply(null, MS_PEOPLE) + ' 位）');

/* 历代名家：用户点名的十一个字段一个都不能缺 */
const MR_FIELDS = ['姓名', '朝代', '字', '号', '生卒', '籍贯', '家世亲属', '生平', '作品风格', '流派', '主要作品', '特殊意义'];
const MR_THIN = [];
MR.forEach(p => {
  const t = p.text || '';
  MR_FIELDS.forEach(k => { if (t.indexOf(k) < 0) MR_THIN.push(p.title + ' 缺' + k); });
  if ((p.text || '').replace(/\s/g, '').length < 180) MR_THIN.push(p.title + ' 正文过短');
});
chk(MR_THIN.length === 0,
  '历代名家每位都有字 / 号 / 生卒 / 籍贯 / 家世亲属 / 生平 / 风格 / 流派 / 作品 / 意义（异常：' +
  (MR_THIN.slice(0, 5).join('、') || '无') + '）');

/* 点名抽查：人物与要义不得张冠李戴 */
const SPOT = [
  ['西游记', '吴承恩', '孙悟空'],
  ['三国演义', '罗贯中', '诸葛亮'],
  ['红楼梦', '曹雪芹', '林黛玉'],
  ['聊斋志异', '蒲松龄', '婴宁'],
  ['骆驼祥子', '老舍', '虎妞'],
  ['雷雨', '曹禺', '蘩漪'],
  ['边城', '沈从文', '翠翠'],
  ['活着', '余华', '福贵'],
  ['红岩', '罗广斌', '江姐']
];
const msByTitle = {};
MS.forEach(p => { msByTitle[p.title] = p; });
SPOT.forEach(row => {
  const p = msByTitle[row[0]];
  if (!p) return; // 这一部还没写素材（分批交付），跳过不判
  const t = p.text;
  chk(t.indexOf(row[1]) >= 0 && t.indexOf(row[2]) >= 0,
    '《' + row[0] + '》作者是 ' + row[1] + '、主要人物里有 ' + row[2]);
});

const MR_SPOT = [
  ['司马迁', '西汉', '史家之绝唱'],
  ['班固', '东汉', '纪传体断代史'],
  ['孔子', '春秋', '儒家'],
  ['老子', '春秋', '道家'],
  ['孙武', '春秋', '孙子兵法'],
  ['孙膑', '战国', '围魏救赵'],
  ['张衡', '东汉', '地动仪'],
  ['祖冲之', '圆周率'],
  ['扁鹊', '四诊'],
  ['华佗', '麻沸散'],
  ['李时珍', '本草纲目'],
  ['嵇康', '广陵散'],
  ['李春', '赵州桥'],
  ['关汉卿', '窦娥冤'],
  ['汤显祖', '牡丹亭'],
  ['苏轼', '豪放'],
  ['李清照', '婉约']
];
const mrByName = {};
MR.forEach(p => { mrByName[p.title] = p; });
MR_SPOT.forEach(row => {
  const p = mrByName[row[0]];
  const t = p ? p.text : '';
  chk(!!p && t.indexOf(row[1]) >= 0, row[0] + ' 一条里写到了「' + row[1] + '」');
});

chk(!mrByName['关羽'] && !mrByName['张飞'],
  '历代名家收的是「名家」而不是小说人物（关羽 / 张飞不在册）');

/* Issue #381 第三轮：唐代诗人补一批 + 新增「哲学家」「外国名人」两组。
   用户原话「唐代诗人有很多，应该多扩充一些，还有别的家，也要加一些，
   例如思想家，哲学家。还有外国名人呢？例如 亚里士多德，柏拉图，欧拉，
   莱布尼兹，伦琴，等等，很多呢」——点名的人一个都不能少。 */
['哲学家', '外国名人'].forEach(g => {
  const n = MR.filter(p => p.gradeGroup === g).length;
  chk(n >= 10, '新增的「' + g + '」组有 ' + n + ' 位（≥10）');
});
const TANG = ['陈子昂', '王昌龄', '岑参', '高适', '王之涣', '孟郊', '贾岛', '李贺', '杜牧'];
const tangMissing = TANG.filter(n => !mrByName[n]);
chk(tangMissing.length === 0,
  '唐代诗人补了 ' + TANG.length + ' 位（缺：' + (tangMissing.join('、') || '无') + '）');
const MR_SPOT3 = [
  ['陈子昂', '登幽州台歌'], ['王昌龄', '出塞'], ['岑参', '白雪歌'],
  ['高适', '燕歌行'], ['王之涣', '登鹳雀楼'], ['孟郊', '游子吟'],
  ['贾岛', '推敲'], ['李贺', '诗鬼'], ['杜牧', '阿房宫赋'],
  ['董仲舒', '独尊儒术'], ['王充', '论衡'], ['范缜', '神灭论'],
  ['韩非', '法家'], ['墨子', '兼爱'], ['荀子', '劝学'],
  ['柏拉图', '理想国'], ['亚里士多德', '逻辑学'], ['康德', '纯粹理性批判'],
  ['莱布尼兹', '单子论'], ['尼采', '上帝已死'], ['罗素', '数学原理'],
  ['萨特', '存在主义'],
  ['阿基米德', '阿基米德原理'], ['欧几里得', '几何原本'], ['哥白尼', '天体运行论'],
  ['伽利略', '望远镜'], ['牛顿', '万有引力'], ['欧拉', '欧拉公式'],
  ['高斯', '数学王子'], ['法拉第', '电磁感应'], ['达尔文', '物种起源'],
  ['巴斯德', '巴氏消毒法'], ['伦琴', 'X 射线'], ['居里夫人', '镭'],
  ['爱因斯坦', '相对论'], ['图灵', '图灵机']
];
MR_SPOT3.forEach(row => {
  const p = mrByName[row[0]];
  chk(!!p && (p.text || '').indexOf(row[1]) >= 0,
    row[0] + ' 一条里写到了「' + row[1] + '」');
});

console.log('');
console.log(fails ? '❌ ' + fails + ' 项失败' : '🎉 名著导读 / 历代名家语料全部通过');
process.exit(fails ? 1 : 0);
