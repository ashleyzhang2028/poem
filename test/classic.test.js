// Issue #278：页面层（jsdom 真跑小古文页）已删除，只留数据层与接线口径。
const fs = require('fs');
const path = __dirname + '/../';

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const vm = require('vm');
const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(path + 'data/text-master.js', 'utf8'), sandbox, { filename: 'text-master.js' });
vm.runInContext(fs.readFileSync(path + 'data/poems-classic.js', 'utf8'), sandbox, { filename: 'poems-classic.js' });

var CLS = sandbox.POEMS_CLASSIC.map(function (raw) {
  return sandbox.masterTextOf ? sandbox.masterTextOf(raw, 'classic') : raw;
});
chk(Array.isArray(CLS) && CLS.length === 102, '小古文共 102 篇（100 + 千字文 / 百家姓；实际 ' + (CLS ? CLS.length : 'undefined') + '）');
const ids = new Set();
CLS.forEach(p => {
  if (ids.has(p.id)) throw new Error('重复 id ' + p.id);
  ids.add(p.id);
});
chk(true, '小古文 id 无重复');
chk(CLS.every(p => p.title && p.source && p.text && p.translation), '每篇都有 标题/出处/原文/译文');

const CLS_SRC_OK = ['public-domain', 'school'];
chk(CLS.every(p => CLS_SRC_OK.indexOf(p.translationSource) >= 0),
  '102 篇小古文都标了译文来源且取值在允许范围（异常 ' +
  CLS.filter(p => CLS_SRC_OK.indexOf(p.translationSource) < 0).length + ' 篇）');
chk(CLS.filter(p => p.translationSource === 'public-domain').length === 101,
  '其中 101 篇标 public-domain（与课内同篇的 1 篇取自课本口径，标 school）');
chk(CLS.some(p => p.text.length > 100), '含长篇（>100 字）古文，验证长文场景');

const need = ['三字经', '弟子规', '千字文', '百家姓', '司马光', '守株待兔', '精卫填海', '王戎不取道旁李', '囊萤夜读',
  '铁杵成针', '少年中国说（节选）', '古人谈读书', '自相矛盾', '杨氏之子', '伯牙鼓琴', '书戴嵩画牛', '学弈',
  '两小儿辩日', '盘古开天地', '女娲造人', '夸父逐日', '后羿射日', '曹冲称象', '掩耳盗铃', '画蛇添足',
  '刻舟求剑', '郑人买履', '叶公好龙', '揠苗助长', '滥竽充数', '买椟还珠'];
const titles = CLS.map(p => p.title);
const missing = need.filter(t => !titles.includes(t));
chk(missing.length === 0, '需求清单篇目齐备（缺 ' + missing.join('/') + '）');

// 蒙学四篇的完整性：题名去掉了「（节选）」，正文就必须是全文。
// 判据用汉字数下限 —— 这几部书的全文汉字数是定数（三字经 1140 / 弟子规 1080 /
// 千字文 1000 / 百家姓 504 姓），节选版一律不到下限的三分之一。
const MENGXUE_FULL = [
  { title: '三字经', min: 1100, note: '宋·王应麟通行本全文' },
  { title: '弟子规', min: 1000, note: '清·李毓秀全文（含「信/泛爱众/亲仁/余力学文」三章）' },
  { title: '千字文', min: 990, note: '南朝·梁 周兴嗣 1000 字' },
  { title: '百家姓', min: 500, note: '宋·佚名通行本 504 姓' },
];
MENGXUE_FULL.forEach(m => {
  const p = CLS.filter(x => x.title === m.title)[0];
  chk(!!p, '蒙学四篇里有《' + m.title + '》');
  if (!p) return;
  const n = (p.text.match(/[\u4e00-\u9fff]/g) || []).length;
  chk(n >= m.min, '《' + m.title + '》正文是全文，不是节选（' + m.note + '，汉字 ' + n + ' ≥ ' + m.min + '）');
  chk(!/（节选）|\(节选\)/.test(p.title), '《' + m.title + '》题名不再带「（节选）」');
  //《百家姓》是姓字表、没有连贯文义，译文是一段「说明」而不是逐句翻译 ——
  // 这一条按下限单列，不套「译文长度与正文同量级」的判据。
  const tn = (p.translation.match(/[\u4e00-\u9fff]/g) || []).length;
  if (m.title === '百家姓') {
    chk(tn >= 200, '《百家姓》译文如实说明「它是姓字表、不作逐句翻译」（译文汉字 ' + tn + '）');
  } else {
    chk(tn >= m.min * 0.7, '《' + m.title + '》译文也覆盖全文（译文汉字 ' + tn + '，正文 ' + n + ' 的 ' +
      Math.round(tn / n * 100) + '%）');
  }
});

// 光比字数还可能被「同长度的另一段」蒙过去，再点名几句**只在全文里出现**的句子。
// 三字经：香九龄（第 9 句，节选版止于第 8 句「习礼仪」）、清祚终 / 戒之哉（史事段与末句）。
// 弟子规：信为先（「信」章后半，节选版止于「业无变」）、凡是人（「泛爱众」章）、可驯致（末句）。
(function () {
  const get = t => CLS.filter(x => x.title === t)[0];
  const SPOT = [
    ['三字经', '香九龄', '节选止于「亲师友，习礼仪」，全文才有的第 9 句'],
    ['三字经', '戒之哉', '全文末句「戒之哉，宜勉力」'],
    ['三字经', '清祚终', '历代史事段（清十二世）'],
    ['弟子规', '信为先', '「信」章开头，节选止于「业无变」'],
    ['弟子规', '凡是人', '「泛爱众」章开头'],
    ['弟子规', '可驯致', '全文末句「圣与贤，可驯致」'],
  ];
  SPOT.forEach(([title, phrase, why]) => {
    const p = get(title);
    chk(!!p && p.text.indexOf(phrase) >= 0, '《' + title + '》含「' + phrase + '」（' + why + '）');
  });
  const SPTRANS = [
    ['三字经', '勤奋就有功效', '末句译文'],
    ['弟子规', '读书的方法', '「余力学文」章译文'],
  ];
  SPTRANS.forEach(([title, phrase, why]) => {
    const p = get(title);
    chk(!!p && p.translation.indexOf(phrase) >= 0, '《' + title + '》译文含「' + phrase + '」（' + why + '）');
  });
})();

chk(sandbox.POEMS_ALL === undefined, '小古文不写入 POEMS_ALL，不影响每日计划');
const groups = sandbox.getClassicGroups();
chk(groups.length >= 6, '按主题分组聚合出 ' + groups.length + ' 组');
chk(groups.reduce((n, g) => n + g.items.length, 0) === 102, '分组内篇目合计 102');

// ---------------------------------------------------------------------------
// Issue #278：这一层的**页面层**（jsdom 起小古文页、渲染 102 篇、点已读、
// 朗读、重复 id 扫描、样式扫描）整段删除 —— 那是界面测试。
// 留下的是数据层：102 篇的数量 / id / 字段 / 分组 / 已读键，以及页面加载了
// 数据与引擎这一类**功能接线**的口径。
// ---------------------------------------------------------------------------
const html = fs.readFileSync(path + 'classic/index.html', 'utf8');
const scriptOrder = html.match(/<script src="([^"]+)"><\/script>/g).map(s => s.match(/src="([^"]+)"/)[1]);
chk(scriptOrder.indexOf('data/poems-classic.js') >= 0, '页面引用了小古文数据');
chk(scriptOrder.indexOf('js/reader-core.js') >= 0, '页面加载了 js/reader-core.js 引擎');
chk(scriptOrder.indexOf('js/reader-core.js') < scriptOrder.indexOf('js/classic.js'),
  '引擎排在挂载脚本 js/classic.js 之前');

console.log('');
console.log(fails ? '❌ ' + fails + ' 项失败' : '🎉 小古文测试全部通过');
process.exit(fails ? 1 : 0);
