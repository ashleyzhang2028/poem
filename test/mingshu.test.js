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
const MINGREN_GROUPS = [
  '文学家', '史学家', '思想家', '军事家',
  '科学家', '医学家', '音乐家', '建筑家', '戏曲家'
];

const MS = book('名著导读', 'POEMS_MINGSHU', MINGSHU_GROUPS, '部');
const MR = book('历代名家', 'POEMS_MINGREN', MINGREN_GROUPS, '家');

chk(MS.length === 36, '名著导读共 36 部（实际 ' + MS.length + '）');
chk(MR.length === 99, '历代名家共 99 位（实际 ' + MR.length + '）');

/* 名著导读：四个必修项（背景 / 情节 / 人物 / 主旨）一条都不能少，
   而且不许一句话敷衍 —— 用户原话「不要过分简略」。 */
const MS_THIN = [];
MS.forEach(p => {
  const t = p.text || '';
  ['写作背景', '情节梗概', '主要人物', '主旨'].forEach(k => {
    if (t.indexOf(k) < 0) MS_THIN.push(p.title + ' 缺' + k);
  });
  if ((p.text || '').replace(/\s/g, '').length < 240) MS_THIN.push(p.title + ' 正文过短');
});
chk(MS_THIN.length === 0,
  '名著导读每部都有写作背景 / 情节梗概 / 主要人物 / 主旨，且正文不短于 240 字（异常：' +
  (MS_THIN.slice(0, 5).join('、') || '无') + '）');

const MS_PLOT = MS.map(p => (p.text.match(/【情节梗概】([\s\S]*?)【主要人物】/) || ['', ''])[1].replace(/\s/g, '').length);
chk(Math.min.apply(null, MS_PLOT) >= 120,
  '每一部的「情节梗概」都不少于 120 字（最短 ' + Math.min.apply(null, MS_PLOT) + ' 字）');

const MS_PEOPLE = MS.map(p => (p.text.match(/【主要人物】([\s\S]*?)【主旨】/) || ['', ''])[1].split('\n').filter(x => x.trim()).length);
chk(Math.min.apply(null, MS_PEOPLE) >= 3,
  '每一部至少列出 3 位主要人物（最少 ' + Math.min.apply(null, MS_PEOPLE) + ' 位）');

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
  ['简·爱', '夏洛蒂·勃朗特', '罗切斯特'],
  ['钢铁是怎样炼成的', '奥斯特洛夫斯基', '保尔']
];
const msByTitle = {};
MS.forEach(p => { msByTitle[p.title] = p; });
SPOT.forEach(row => {
  const p = msByTitle[row[0]];
  const t = p ? p.text : '';
  chk(!!p && t.indexOf(row[1]) >= 0 && t.indexOf(row[2]) >= 0,
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

console.log('');
console.log(fails ? '❌ ' + fails + ' 项失败' : '🎉 名著导读 / 历代名家语料全部通过');
process.exit(fails ? 1 : 0);
