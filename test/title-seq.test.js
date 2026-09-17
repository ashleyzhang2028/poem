const fs = require('fs');
const vm = require('vm');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const sb = { window: {}, console };
sb.window = sb;
vm.createContext(sb);

const DATA = [
  'data/text-master.js',
  'data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js', 'data/poems-5.js',
  'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js', 'data/poems-9.js', 'data/poems-10.js',
  'data/poems-11.js', 'data/poems-12.js', 'data/index.js', 'data/poems-tangshi.js'
];
DATA.forEach(f => vm.runInContext(fs.readFileSync(__dirname + '/../' + f, 'utf8'), sb, { filename: f }));
const ALL = sb.POEMS_ALL;

const TS = sb.POEMS_TANGSHI.map(p => sb.masterTextOf(p, 'tangshi'));

const norm = t => String(t || '').replace(/\s+/g, '');

const CN_NUM = { '一':1, '二':2, '三':3, '四':4, '五':5, '六':6, '七':7, '八':8, '九':9, '十':10,
  '二十五':25, '三十一':31 };

function seqOf(title) {
  const m = String(title).match(/[（(·]其([一二三四五六七八九十]+)[）)·]?$/);
  if (!m) return null;
  return CN_NUM[m[1]] === undefined ? NaN : CN_NUM[m[1]];
}

const CASES = [

  ['悯农（其二）',       '锄禾日当午',       2],
  ['悯农（其一）',       '春种一粒粟',       1],
  ['四时田园杂兴（其二十五）', '梅子金黄杏子肥',  25],
  ['四时田园杂兴（其三十一）', '昼出耘田夜绩麻',  31],
  ['塞下曲（其三）',     '月黑雁飞高',       3],
  ['塞下曲（其四）',     '野幕敞琼筵',       4],
  ['观书有感（其一）',   '半亩方塘一鉴开',    1],
  ['观书有感（其二）',   '昨夜江边春水生',    2],
  ['浪淘沙（其一）',     '九曲黄河万里沙',    1],
  ['江畔独步寻花（其五）', '黄师塔前江水东',   5],
  ['江畔独步寻花（其六）', '黄四娘家花满蹊',   6],
  ['秋词（其一）',       '自古逢秋悲寂寥',    1],
  ['十一月四日风雨大作（其二）', '僵卧孤村不自哀', 2],
  ['己亥杂诗（其五）',   '浩荡离愁白日斜',    5],
  ['赠从弟（其二）',     '亭亭山上松',       2],
  ['行路难（其一）',     '金樽清酒斗十千',    1],
  ['归园田居（其一）',   '少无适俗韵',       1],
];

const byTitle = {};
ALL.forEach(p => { byTitle[p.title] = p; });

let caseBad = [];
CASES.forEach(c => {
  const [title, head, want] = c;
  const p = byTitle[title];
  if (!p) { caseBad.push(title + '（不在课内语料里）'); return; }
  const n = seqOf(title);
  if (n !== want) caseBad.push(title + ' 标题序号应为其' + want);
  if (norm(p.text).slice(0, head.length) !== norm(head).slice(0, head.length)) {
    caseBad.push(title + ' 正文与标题对不上（实际开头：' + norm(p.text).slice(0, 10) + '）');
  }
});
chk(caseBad.length === 0, '课内带「其N」的标题，序号与正文逐条对得上（异常：' + (caseBad.join('；') || '无') + '）');

const md = byTitle['塞下曲（其三）'];
chk(!!md && norm(md.text).indexOf('月黑雁飞高') === 0, '卢纶《塞下曲（其三）》= 「月黑雁飞高」（原误标「其一」）');
const ym = byTitle['塞下曲（其四）'];
chk(!!ym && norm(ym.text).indexOf('野幕敞琼筵') === 0, '卢纶《塞下曲（其四）》= 「野幕敞琼筵」（原误标「其二」）');

chk(!byTitle['塞下曲（其一）'] && !byTitle['塞下曲（其二）'], '课内不再有「塞下曲（其一）/（其二）」的错标');
chk(!byTitle['江畔独步寻花（其一）'] && !byTitle['江畔独步寻花（其二）'], '课内不再有「江畔独步寻花（其一）/（其二）」的错标');

const hp = byTitle['江畔独步寻花（其五）'];
chk(!!hp && norm(hp.text).indexOf('黄师塔前江水东') === 0, '杜甫《江畔独步寻花（其五）》= 「黄师塔前江水东」（原误标「其二」）');
const h4 = byTitle['江畔独步寻花（其六）'];
chk(!!h4 && norm(h4.text).indexOf('黄四娘家花满蹊') === 0, '杜甫《江畔独步寻花（其六）》= 「黄四娘家花满蹊」（原误标「其一」）');

const groups = {};
CASES.forEach(c => {
  const p = byTitle[c[0]];
  if (!p) return;
  const base = String(p.title).replace(/[（(]其[一二三四五六七八九十]+[）)]$/, '');
  const key = p.author + '|' + base;
  (groups[key] = groups[key] || []).push(seqOf(p.title));
});
let dupBad = [];
Object.keys(groups).forEach(k => {
  const arr = groups[k];
  const uniq = new Set(arr);
  if (uniq.size !== arr.length) dupBad.push(k + ' 序号重复：' + arr.join('、'));
});
chk(dupBad.length === 0, '同一作者同一题名的同组诗，序号互不重复（异常：' + (dupBad.join('；') || '无') + '）');

const selfClaim1 = CASES.filter(c => seqOf(c[0]) === 1 &&
  ['塞下曲（其三）', '塞下曲（其四）', '江畔独步寻花（其五）', '江畔独步寻花（其六）'].indexOf(c[0]) >= 0);
chk(selfClaim1.length === 0, '补录篇目不得把组诗第一首之外的诗标成「其一」');

const TS_CASES = [
  ['感遇·其一', '孤鸿海上来', 1], ['感遇·其二', '兰叶春葳蕤', 2],
  ['梦李白·其一', '死别已吞声', 1], ['梦李白·其二', '浮云终日行', 2],
  ['长相思·其一', '长相思', 1], ['长相思·其二', '日色欲尽花含烟', 2],
  ['行路难·其一', '金樽清酒斗十千', 1],
  ['咏怀古迹·其一', '支离东北风尘际', 1], ['咏怀古迹·其二', '摇落深知宋玉悲', 2],
  ['咏怀古迹·其三', '群山万壑赴荆门', 3], ['咏怀古迹·其四', '蜀主窥吴幸三峡', 4],
  ['咏怀古迹·其五', '诸葛大名垂宇宙', 5],
  ['遣悲怀·其一', '谢公最小偏怜女', 1], ['遣悲怀·其二', '昔日戏言身后意', 2],
  ['遣悲怀·其三', '闲坐悲君亦自悲', 3],
  ['回乡偶书·其一', '少小离家老大回', 1], ['回乡偶书·其二', '离别家乡岁月多', 2],
  ['集灵台·其一', '日光斜照集灵台', 1], ['集灵台·其二', '虢国夫人承主恩', 2],
  ['赠别·其一', '娉娉袅袅十三余', 1], ['赠别·其二', '多情却似总无情', 2],
];
const tsByTitle = {};
TS.forEach(p => { tsByTitle[p.title] = p; });
let tsBad = [];
TS_CASES.forEach(c => {
  const [title, head, want] = c;
  const p = tsByTitle[title];
  if (!p) { tsBad.push(title + '（不在库）'); return; }
  if (seqOf(title) !== want) tsBad.push(title + ' 序号应为其' + want);
  if (norm(p.text).slice(0, norm(head).length) !== norm(head)) tsBad.push(title + ' 正文与序号对不上');
});
chk(tsBad.length === 0, '唐诗三百首带「其N」的篇目是选本原名，逐条对得上（异常：' + (tsBad.join('；') || '无') + '）');

const 长相思 = TS.filter(p => p.title.indexOf('长相思·') === 0).sort((a, b) => seqOf(a.title) - seqOf(b.title));
chk(长相思.length === 2 && norm(长相思[0].text).indexOf('长相思') === 0 && norm(长相思[1].text).indexOf('日色欲尽') === 0,
  '《长相思》两组序号与正文一一对应（其一「长相思」/ 其二「日色欲尽花含烟」）');

const all = ALL.concat(TS);
const bogus = all.filter(p => /其[零〇0-9]/.test(String(p.title)));
chk(bogus.length === 0, '全库没有「其零」这类无效序号（异常：' + bogus.map(p => p.title).join('、') + '）');

console.log('');
if (fails) { console.log('✗ 「其N」编号核对测试失败 ' + fails + ' 项'); process.exit(1); }
console.log('🎉 「其N」编号核对测试全部通过');
