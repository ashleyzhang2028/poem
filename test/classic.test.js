
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

  const tn = (p.translation.match(/[\u4e00-\u9fff]/g) || []).length;
  if (m.title === '百家姓') {
    chk(tn >= 200, '《百家姓》译文如实说明「它是姓字表、不作逐句翻译」（译文汉字 ' + tn + '）');
  } else {
    chk(tn >= m.min * 0.7, '《' + m.title + '》译文也覆盖全文（译文汉字 ' + tn + '，正文 ' + n + ' 的 ' +
      Math.round(tn / n * 100) + '%）');
  }
});

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

const html = fs.readFileSync(path + 'classic/index.html', 'utf8');
const scriptOrder = html.match(/<script src="([^"]+)"><\/script>/g).map(s => s.match(/src="([^"]+)"/)[1]);
chk(scriptOrder.indexOf('data/poems-classic.js') >= 0, '页面引用了小古文数据');
chk(scriptOrder.indexOf('js/reader-core.js') >= 0, '页面加载了 js/reader-core.js 引擎');
chk(scriptOrder.indexOf('js/reader-core.js') < scriptOrder.indexOf('js/classic.js'),
  '引擎排在挂载脚本 js/classic.js 之前');

console.log('');
console.log(fails ? '❌ ' + fails + ' 项失败' : '🎉 小古文测试全部通过');
process.exit(fails ? 1 : 0);
