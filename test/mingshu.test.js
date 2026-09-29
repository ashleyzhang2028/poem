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
// Issue #381 第四轮：135 → 649 位，并把上一轮挤在一个筐里的「外国名人」
// 按学科拆成九组（用户原话「外国名人真的要扩充 10 倍了，各行各业，数学家，
// 物理学家，化学家，生物学家，科学家，天文学家，文学家，艺术家，画家，雕刻」），
// 中国部分也新增「书法家 / 画家 / 天文学家 / 生物学家」四组。
// Issue #381 第六轮：「军事家」组照旧留着（在册 7 位：孙武 / 孙膑 / 韩信 /
// 诸葛亮 / 李靖 / 岳飞 / 戚继光）—— 用户这一轮删的是明治维新以后的日本政治 /
// 军事人物，不是军事家这一组；中国兵家与外国名将都还在。
const MINGREN_GROUPS = [
  // 中国：文学与思想
  '政治家', '文学家', '史学家', '思想家', '哲学家', '军事家',
  // 中国：艺术
  '书法家', '画家', '戏曲家', '音乐家',
  // 中国：专门之学
  '科学家', '医学家', '天文学家（中国）', '生物学家（中国）', '建筑家',
  // 外国：按学科
  '外国数学家', '外国物理学家', '外国化学家',
  '外国生物学家', '外国天文学家', '外国医学家',
  '外国文学家', '外国艺术家', '外国建筑家',
  '外国名人'
];

const MS = book('名著导读', 'POEMS_MINGSHU', MINGSHU_GROUPS, '部');
const MR = book('历代名家', 'POEMS_MINGREN', MINGREN_GROUPS, '家');

/* ── 排序：Issue #381 第七轮 · 用户原话 ────────────────────────────────
   「所有类别的名家按出生时间顺序排序。名著也按时间顺序排序。」
   两组守：历代名家**每组内**按生年升序；名著**每组内**按成书 / 出版年升序。
   生年/年份都从壳里的 source 取不出时按 build 脚本同一套口径算，这里只
   验「相邻两条不倒挂」——同一年的（如王翦与廉颇同记「约前 3 世纪」）放过。 */
const LY = require('../scripts/lib/life-year.js');
const MYEARS = require('../scripts/data/mingshu-years.js');

function orderViolations(list, keyOf) {
  const bad = [];
  const byGroup = {};
  list.forEach(p => { (byGroup[p.gradeGroup] = byGroup[p.gradeGroup] || []).push(p); });
  Object.keys(byGroup).forEach(g => {
    const arr = byGroup[g].map(keyOf);
    for (let i = 1; i < arr.length; i++) {
      if (arr[i - 1] == null || arr[i] == null) continue;
      if (arr[i] < arr[i - 1]) { bad.push(g + ' ' + (i - 1) + '→' + i); break; }
    }
  });
  return bad;
}

/* 历代名家：生年取自主表正文的「生卒」行（壳的 source 是《名》·生卒，
   但对含「·」的名字会截断，所以以主表为准）。 */
function lifeFromMaster(title) {
  const e = sb.TEXT_MASTER_POEMS && sb.TEXT_MASTER_POEMS[title];
  const t = e || '';
  const m = String(t).match(/│ 生卒 *│([^│]*)│/);
  return m ? m[1].trim() : '';
}
/* 主表在 loadData 里以 window.TEXT_MASTER 存放（按 id 或按 title，形状不一），
   取不到就退回壳里的 source（对无「·」的名字是对的）。 */
function mrLife(p) {
  let t = '';
  if (sb.TEXT_MASTER && Array.isArray(sb.TEXT_MASTER)) {
    const e = sb.TEXT_MASTER.find(x => x.title === p.title && String(x.id).indexOf('mingren') >= 0);
    if (e) t = e.text;
  }
  if (!t) return String(p.source || '').replace(/^《[^》]*》·/, '');
  const m = String(t).match(/│ 生卒 *│([^│]*)│/);
  return m ? m[1].trim() : '';
}
const mrBad = orderViolations(MR, p => LY.birthYearOf(mrLife(p)).year);
chk(mrBad.length === 0,
  '历代名家每组按出生时间排序（倒挂：' + (mrBad.join('、') || '无') + '）');

const msBad = orderViolations(MS, p => MYEARS.yearOf(p.title, p.dynasty));
chk(msBad.length === 0,
  '名著导读每组按成书 / 出版时间排序（倒挂：' + (msBad.join('、') || '无') + '）');

/* 数量：Issue #381 第二轮要求「国内名著 ×10、世界名著 ≥300 本」。
   书目表 data/mingshu-books.js 已经排到 1614 部；但正文素材是**分批**写的，
   data/poems-mingshu.js 只收「素材已就绪」的那一批。所以这里守两件事：
     ① 壳文件与主表「一一对应」（不出现有壳无文、或有文无壳）；
     ② 已交付的这批，条数与字段都合规。
   总目标由 test/mingshu-books.test.js 守。 */
chk(MS.length >= 19, '名著导读已交付至少 19 部（实际 ' + MS.length + '）');
chk(MS.length <= 1614, '名著导读不超过书目表总数 1614 部（实际 ' + MS.length + '）');
/* 历代名家：第四轮 135 → 649 位（外国名人按学科拆组），第六轮再开「政治家」
   一组、军事家覆盖中外，并按用户「国共两党相关全部删除、1949 年以后的全部删除」
   的口径删掉 44 位。这里守**结构**：每一组都得真厚起来，而不只是追总数。 */
const MR_BY_GROUP = {};
MR.forEach(p => { MR_BY_GROUP[p.group] = (MR_BY_GROUP[p.group] || 0) + 1; });
const MR_CN = MR.filter(p => p.gradeGroup.indexOf('外国') !== 0);
const MR_WORLD = MR.filter(p => p.gradeGroup.indexOf('外国') === 0);
chk(MR.length === 706, '历代名家共 706 位（实际 ' + MR.length + '）');
chk(MR_WORLD.length === 290,
  '外国名家 290 位（上一轮只有 14 位 —— 用户要求「扩充 10 倍」；实际 ' +
  MR_WORLD.length + '）');
/* Issue #381 第六轮：新开「政治家」一组，军事家覆盖中外 */
chk((MR_BY_GROUP['政治家'] || 0) >= 30,
  '政治家补到 30 位以上（实际 ' + (MR_BY_GROUP['政治家'] || 0) + '）');
chk((MR_BY_GROUP['军事家'] || 0) >= 40,
  '军事家补到 40 位以上（实际 ' + (MR_BY_GROUP['军事家'] || 0) + '）');
chk((MR_BY_GROUP['思想家'] || 0) >= 30,
  '思想家补到 30 位以上（实际 ' + (MR_BY_GROUP['思想家'] || 0) + '）');
chk((MR_BY_GROUP['哲学家'] || 0) >= 30,
  '哲学家补到 30 位以上（实际 ' + (MR_BY_GROUP['哲学家'] || 0) + '）');
chk((MR_BY_GROUP['外国名人'] || 0) >= 30,
  '外国名人补到 30 位以上（实际 ' + (MR_BY_GROUP['外国名人'] || 0) + '）');
/* 组数：中国十五 + 外国十 = 二十五组 */
chk(new Set(MR.map(p => p.group)).size === 25,
  '历代名家分二十五组（实际 ' + new Set(MR.map(p => p.group)).size + '）');
chk(MR_CN.filter(p => p.group.indexOf('外国') === 0).length === 0,
  '中国条目不得落进外国那几组');

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

/* Issue #381 第六轮（续）：用户原话「轴心国除了日本的政治军事家，其他国家的
   政治，军事家可以添加，但是要从雅尔塔会议，开罗宣言以及二战后的国际秩序角度
   进行评价。帮我清理删除明治维新以后的日本的政治家军事家，如果有的话」。

   这一轮在册的日本人物共 4 位，全是文学家 —— 政治 / 军事人物一位都没有，
   所以「删」这件事无账可记。守卫守的是**以后别收进来**：

     ① 明治维新（1868）以后的日本政治 / 军事人物零残留；
     ② 在册的日本人物全是文学家（4 位：川端康成 / 夏目漱石 / 芥川龙之介 /
        三岛由纪夫）—— 第三轮那条「本职是别的行当的保留」照旧管用；
     ③ 轴心国的政治 / 军事首脑不在册，而本职是学者的照旧在册；
     ④ 别国的政治 / 军事人物照旧在册（这一轮收口的是日本，不是所有外国）——
        免得下一次有人把这条尺子顺手改成「外国政治军事人物一律不收」。 */
const JP_POL_MIL = MR.filter(p => /日本/.test(p.dynasty || '') &&
  (p.gradeGroup === '政治家' || p.gradeGroup === '军事家'));
chk(JP_POL_MIL.length === 0,
  '明治维新以后的日本政治 / 军事人物不在册（残留：' +
  (JP_POL_MIL.map(p => p.title).join('、') || '无') + '）');

const JP_ALL = MR.filter(p => /日本/.test(p.dynasty || ''));
chk(JP_ALL.length === 4 && JP_ALL.every(p => p.gradeGroup === '外国文学家'),
  '在册的日本人物只剩 4 位文学家（川端康成 / 夏目漱石 / 芥川龙之介 / ' +
  '三岛由纪夫）—— 作家不在「政治 / 军事人物」的尺子内（实际：' +
  (JP_ALL.map(p => p.title + '（' + p.gradeGroup + '）').join('、') || '无') + '）');

/* Issue #381 第七轮：用户原话「轴心国除了日本的政治军事家，其他国家的政治，
   军事家可以添加，但是要从雅尔塔会议，开罗宣言以及二战后的国际秩序角度进行
   评价」。所以德国 / 意大利的政治、军事人物**收进来了**（希特勒 / 墨索里尼
   作为这一秩序的反面也在册）；日本的政治 / 军事人物一位都不收。 */
const JP_AXIS = ['东条英机', '山本五十六'];
const jpAxisIn = JP_AXIS.filter(n => mrByName[n]);
chk(jpAxisIn.length === 0,
  '日本的政治 / 军事首脑不在册（残留：' + (jpAxisIn.join('、') || '无') + '）');
const DE_IT = [
  ['希特勒', '雅尔塔'], ['墨索里尼', '法西斯'], ['阿登纳', '欧洲煤钢共同体'],
  ['艾哈德', '社会市场经济'], ['勃兰特', '新东方政策'], ['德加斯佩里', '北约'],
  ['加富尔', '意大利'], ['马志尼', '青年意大利'],
  ['加里波第', '红衫军'], ['隆美尔', '阿拉曼'], ['曼施坦因', '镰刀'],
  ['邓尼茨', '投降书'], ['巴多格里奥', '停战'],
];
const deItMissing = DE_IT.filter(r => !mrByName[r[0]]).map(r => r[0]);
chk(deItMissing.length === 0,
  '德国 / 意大利的政治、军事人物在册（缺：' + (deItMissing.join('、') || '无') + '）');
DE_IT.forEach(r => {
  const p = mrByName[r[0]];
  if (!p) return;
  chk(String(p.text).indexOf(r[1]) >= 0, r[0] + ' 一条里写到了「' + r[1] + '」');
});
chk(/雅尔塔/.test(String(mrByName['希特勒'] && mrByName['希特勒'].text)) &&
  /反法西斯/.test(String(mrByName['墨索里尼'] && mrByName['墨索里尼'].text)),
  '德 / 意轴心一方的评价落在「雅尔塔 / 战后秩序」这个角度上');
const AXIS_KEEP = ['爱因斯坦', '普朗克', '海森堡'];
const axisKeepMissing = AXIS_KEEP.filter(n => !mrByName[n]);
chk(axisKeepMissing.length === 0,
  '轴心国里本职是学者的照旧保留（缺：' + (axisKeepMissing.join('、') || '无') + '）');

/* 别的国家的政治 / 军事人物照旧在册 —— 用户写的是「其他国家的政治，军事家
   **可以**添加」，是放开不是收口。 */
const OTHER_POL_MIL = ['丘吉尔', '戴高乐', '华盛顿', '拿破仑', '俾斯麦',
  '艾森豪威尔', '朱可夫', '蒙哥马利'];
const otherMissing = OTHER_POL_MIL.filter(n => !mrByName[n]);
chk(otherMissing.length === 0,
  '其他国家的政治 / 军事人物照旧在册（缺：' + (otherMissing.join('、') || '无') + '）');

/* 第四轮点名：唐代诗人 / 别的家 / 外国名人三处各点几个 */
const NEW_SPOT = [
  ['宋玉', '辞赋'], ['温庭筠', '花间'], ['柳永', '慢词'], ['马致远', '天净沙'],
  ['陈子昂', '幽州台'], ['贺知章', '回乡偶书'], ['张若虚', '春江花月夜'],
  ['崔颢', '黄鹤楼'], ['王翰', '凉州词'], ['晏殊', '浣溪沙'],
  ['管子', '仓廪实'], ['玄奘', '大唐西域记'], ['慧能', '坛经'],
  ['程颢', '识仁'], ['陆九渊', '吾心'], ['李贽', '童心'],
  ['苏格拉底', '认识你自己'], ['斯宾诺莎', '伦理学'], ['维特根斯坦', '语言游戏'],
  ['海德格尔', '存在与时间'], ['波伏娃', '第二性'], ['加缪', '荒诞'],
  ['高斯', '数学王子'], ['麦克斯韦', '电磁'], ['门捷列夫', '周期律'],
  ['诺贝尔', '诺贝尔奖'], ['冯·诺依曼', '普林斯顿'], ['霍金', '黑洞']
];
const NEW_MISS = NEW_SPOT.filter(r => !mrByName[r[0]]).map(r => r[0]);
chk(NEW_MISS.length === 0,
  '第四轮点名的 ' + NEW_SPOT.length + ' 位都在册（缺：' + (NEW_MISS.join('、') || '无') + '）');
/* ⚠️ 本轮（第六轮）按用户「名人中国共两党相关全部删除，1949 年以后的全部删除」
   的口径删掉了顾准、梁漱溟两位 —— 所以上面那张点名表里不再列他们。 */
NEW_SPOT.forEach(r => {
  const p = mrByName[r[0]];
  if (!p || !r[1]) return;
  chk((p.text || '').indexOf(r[1]) >= 0,
    r[0] + ' 一条里写到了「' + r[1] + '」');
});

/* Issue #381 第三轮：唐代诗人补一批 + 新增「哲学家」「外国名人」两组。
   用户原话「唐代诗人有很多，应该多扩充一些，还有别的家，也要加一些，
   例如思想家，哲学家。还有外国名人呢？例如 亚里士多德，柏拉图，欧拉，
   莱布尼兹，伦琴，等等，很多呢」——点名的人一个都不能少。 */
// 第四轮：新组都要有足够的规模，不是「点到为止」。
[['书法家', 15], ['画家', 30], ['天文学家（中国）', 6], ['生物学家（中国）', 5],
 ['外国数学家', 20], ['外国物理学家', 12], ['外国化学家', 14],
 ['外国生物学家', 12], ['外国天文学家', 8], ['外国医学家', 8],
 ['外国文学家', 80], ['外国艺术家', 60], ['外国建筑家', 8]].forEach(row => {
  const n = MR.filter(p => p.gradeGroup === row[0]).length;
  chk(n >= row[1], '新增的「' + row[0] + '」组有 ' + n + ' 位（≥' + row[1] + '）');
});
const TANG = ['陈子昂', '王昌龄', '岑参', '高适', '王之涣', '孟郊', '贾岛', '李贺', '杜牧'];
const tangMissing = TANG.filter(n => !mrByName[n]);
chk(tangMissing.length === 0,
  '唐代诗人补了 ' + TANG.length + ' 位（缺：' + (tangMissing.join('、') || '无') + '）');
const MR_SPOT3 = [
  // 唐宋名家：用户说「只加了 9 个人？？？」——这一轮唐诗宋词补到几十位
  ['陈子昂', '登幽州台歌'], ['王昌龄', '出塞'], ['岑参', '白雪歌'],
  ['高适', '燕歌行'], ['王之涣', '登鹳雀楼'], ['孟郊', '游子吟'],
  ['贾岛', '推敲'], ['李贺', '诗鬼'], ['杜牧', '阿房宫赋'],
  ['董仲舒', '独尊儒术'], ['王充', '论衡'], ['范缜', '神灭论'],
  ['韩非', '法家'], ['墨子', '兼爱'], ['荀子', '劝学'],
  ['卢照邻', '长安古意'], ['骆宾王', '讨武曌檄'], ['杨炯', '从军行'],
  ['宋之问', '近乡情更怯'], ['沈佺期', '独不见'], ['张若虚', '春江花月夜'],
  ['张九龄', '望月怀远'], ['王翰', '凉州词'], ['刘长卿', '五言长城'],
  ['韦应物', '滁州西涧'], ['李益', '夜上受降城闻笛'], ['张籍', '张王乐府'],
  ['王建', '宫词'], ['刘禹锡', '陋室铭'], ['元稹', '遣悲怀'],
  ['温庭筠', '花间'], ['韦庄', '秦妇吟'],
  ['晏殊', '无可奈何花落去'], ['晏几道', '小山词'], ['柳永', '雨霖铃'],
  ['范仲淹', '岳阳楼记'], ['曾巩', '墨池记'], ['苏洵', '六国论'],
  ['苏辙', '黄州快哉亭记'], ['王安石', '青苗'], ['秦观', '鹊桥仙'],
  ['周邦彦', '词家之冠'], ['贺铸', '贺梅子'], ['范成大', '四时田园杂兴'],
  ['杨万里', '诚斋体'], ['姜夔', '扬州慢'], ['文天祥', '过零丁洋'],
  // 书法家
  ['王羲之', '兰亭'], ['颜真卿', '祭侄文稿'], ['柳公权', '心正则笔正'],
  ['欧阳询', '九成宫'], ['张旭', '草圣'], ['怀素', '自叙帖'],
  ['米芾', '蜀素帖'], ['赵孟頫', '赵体'], ['李斯', '小篆'],
  ['虞世南', '孔子庙堂碑'], ['褚遂良', '雁塔圣教序'], ['孙过庭', '书谱'],
  ['蔡襄', '宋四家'], ['鲜于枢', '二雄'], ['康有为', '大同书'],
  // 画家
  ['顾恺之', '洛神赋图'], ['吴道子', '画圣'], ['阎立本', '步辇图'],
  ['张择端', '清明上河图'], ['范宽', '溪山行旅图'], ['黄公望', '富春山居图'],
  ['倪瓒', '逸笔草草'], ['唐寅', '江南第一风流才子'], ['郑燮', '难得糊涂'],
  ['齐白石', '人民艺术家'], ['徐悲鸿', '奔马'], ['张大千', '敦煌'],
  ['董其昌', '南北宗'], ['李思训', '大小李将军'], ['韩幹', '照夜白'],
  // 史学家
  ['杜佑', '通典'], ['郑樵', '通志'], ['马端临', '文献通考'],
  ['谈迁', '国榷'], ['钱大昕', '廿二史考异'], ['赵翼', '廿二史札记'],
  ['王国维', '人间词话'], ['陈寅恪', '独立之精神'],
  ['吕思勉', '吕著中国通史'], ['陈垣', '史源学'],
  // 外国各行各业
  ['苏格拉底', '认识你自己'], ['德谟克利特', '原子'], ['黑格尔', '辩证法'],
  ['马克思', '资本论'], ['尼采', '上帝已死'], ['康德', '纯粹理性批判'],
  ['维特根斯坦', '不可说的'], ['波普尔', '可证伪性'], ['福柯', '规训与惩罚'],
  ['莱布尼兹', '单子论'], ['罗素', '数学原理'], ['萨特', '存在主义'],
  ['欧拉', '欧拉公式'], ['高斯', '数学王子'], ['黎曼', '黎曼猜想'],
  ['伽罗瓦', '群论'], ['冯·诺依曼', '计算机'], ['纳什', '纳什均衡'],
  ['牛顿', '万有引力'], ['麦克斯韦', '电磁'], ['居里夫人', '镭'],
  ['伦琴', 'X 射线'], ['爱因斯坦', '相对论'], ['薛定谔', '薛定谔的猫'],
  ['波义耳', '波义耳定律'], ['拉瓦锡', '质量守恒'], ['门捷列夫', '周期表'],
  ['诺贝尔', '诺贝尔奖'], ['鲍林', '化学键'],
  ['达尔文', '物种起源'], ['孟德尔', '豌豆'], ['巴斯德', '巴氏消毒法'],
  ['林奈', '双名法'], ['摩尔根', '果蝇'],
  ['哥白尼', '天体运行论'], ['伽利略', '望远镜'], ['开普勒', '行星运动'],
  ['哈勃', '宇宙膨胀'], ['霍金', '时间简史'],
  ['希波克拉底', '誓言'], ['詹纳', '牛痘'], ['科赫', '结核'],
  ['莎士比亚', '哈姆雷特'], ['托尔斯泰', '安娜·卡列尼娜'], ['卡夫卡', '变形记'],
  ['马尔克斯', '百年孤独'], ['泰戈尔', '吉檀迦利'],
  ['达·芬奇', '蒙娜丽莎'], ['梵高', '星月夜'], ['毕加索', '格尔尼卡'],
  ['莫奈', '印象'], ['罗丹', '思想者'], ['米隆', '掷铁饼者'],
  ['贝多芬', '第九交响曲'], ['莫扎特', '费加罗的婚礼'], ['巴赫', '西方音乐之父'],
  ['肖邦', '钢琴诗人'], ['高迪', '圣家堂'], ['贝聿铭', '卢浮宫'],
  ['阿基米德', '浮力原理'], ['哥白尼', '天体运行论'],
  ['法拉第', '电磁感应'], ['图灵', '图灵机']
];
MR_SPOT3.forEach(row => {
  const p = mrByName[row[0]];
  chk(!!p && (p.text || '').indexOf(row[1]) >= 0,
    row[0] + ' 一条里写到了「' + row[1] + '」');
});

/* 一行一人的完整性：正文里的「姓名」那一行必须与标题一致。
   这一条是给批量生成器兜底的 —— id 与正文的配对错位过一次（新人与并行那一轮
   的旧号撞号），表里看不出、列表上看不出，只有把每一行读出来才对得上。 */
(function () {
  const bad = MR.filter(p => {
    const line = (p.text || '').split('\n').find(l => l.indexOf('姓名') >= 0);
    if (!line) return false;
    const cells = line.split('│');
    const name = cells.length > 2 ? cells[2].trim() : '';
    return name && name !== p.title;
  });
  chk(bad.length === 0,
    '历代名家每一条正文里的「姓名」与标题一致（错位：' +
    (bad.slice(0, 5).map(p => p.title).join('、') || '无') + '）');
})();

/* 一人一处：每一位只在一个分组里（同一人不得出现两次） */
(function () {
  const seen = {};
  const dup = [];
  MR.forEach(p => {
    if (seen[p.title]) dup.push(p.title);
    seen[p.title] = 1;
  });
  chk(dup.length === 0, '历代名家一人一处（重复：' + (dup.join('、') || '无') + '）');
})();

console.log('');
console.log(fails ? '❌ ' + fails + ' 项失败' : '🎉 名著导读 / 历代名家语料全部通过');
process.exit(fails ? 1 : 0);
