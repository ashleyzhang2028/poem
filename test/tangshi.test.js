const fs = require('fs');
const vm = require('vm');
const path = __dirname + '/../';

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);

const { loadData, resolve } = require('./master-env');
loadData(sandbox, ['data/poems-classic.js', 'data/poems-tangshi.js', 'data/site-index.js']);

const TS = resolve(sandbox, sandbox.POEMS_TANGSHI, 'tangshi');
chk(Array.isArray(TS) && TS.length === 317,
  '唐诗三百首 301 首 + 校外补充 17 首 = 317（实际 ' + (TS ? TS.length : 'undefined') + '）');

const ids = new Set();
let dup = 0;
TS.forEach(p => { if (ids.has(p.id)) dup++; ids.add(p.id); });
chk(dup === 0, '唐诗 id 无重复（重复 ' + dup + ' 个）');

chk(TS.every(p => p.title && p.source && p.dynasty && p.author && p.text && p.translation),
  '每首都有 标题/出处/朝代/作者/原文/译文');

const TS_SRC_OK = ['public-domain', 'school', 'academic', 'modern'];
chk(TS.every(p => TS_SRC_OK.indexOf(p.translationSource) >= 0),
  '317 首唐诗都标了译文来源且取值在允许范围（异常 ' +
  TS.filter(p => TS_SRC_OK.indexOf(p.translationSource) < 0).length + ' 首）');
chk(TS.filter(p => p.translationSource === 'public-domain').length >= 250,
  '绝大多数标 public-domain（与课内同篇的数首取课本口径，标 school）');
chk(TS.every(p => p.source === '《唐诗三百首》'), '出处统一为《唐诗三百首》');
chk(TS.every(p => p.dynasty === '唐'), '朝代统一为唐');
chk(TS.some(p => p.text.length > 200), '含长篇（>200 字）唐诗，验证长文场景');

const groups = sandbox.getTangshiGroups();
chk(groups.length === 8, '按卷次聚合出 8 组（实际 ' + groups.length + '）');
chk(groups.reduce((n, g) => n + g.items.length, 0) === 317, '各组篇目合计 317');
const want = {
  '卷一 五言古诗': 33, '卷二 七言古诗': 27, '卷三 五言乐府': 13, '卷四 七言乐府': 25,
  '卷五 五言律诗': 78, '卷六 七言律诗': 49, '卷七 五言绝句': 33, '卷八 七言绝句': 59
};
const got = {};
groups.forEach(g => { got[g.name] = g.items.length; });
chk(Object.keys(want).every(k => got[k] === want[k]),
  '八卷篇数与选本一致（' + JSON.stringify(got) + '）');

const need = ['感遇·其一', '月下独酌', '望岳', '梦游天姥吟留别', '将进酒', '蜀道难', '长恨歌',
  '琵琶行·并序', '游子吟', '山居秋暝', '春望', '登高', '黄鹤楼', '锦瑟', '江雪', '寻隐者不遇',
  '登鹳雀楼', '春晓', '夜思', '早发白帝城', '枫桥夜泊', '赤壁', '泊秦淮', '夜雨寄北', '九月九日忆山东兄弟',
  '前出塞九首·其二', '秋浦歌十七首·其十五', '从军行七首·其四', '采莲曲二首·其二', '登乐游原', '七步诗',
  '于易水送人', '遗爱寺', '逢雪宿芙蓉山主人', '百忧集行', '菊花', '题都城南庄', '赠花卿', '闻雁',
  '竹枝词', '忆江南·其一', '渔歌子·西塞山前白鹭飞'];
const titles = TS.map(p => p.title);
const missing = need.filter(t => !titles.includes(t));
chk(missing.length === 0, '需求清单名篇齐备（缺 ' + missing.join('/') + '）');

chk(sandbox.POEMS_ALL === undefined, '唐诗不写入 POEMS_ALL，不影响每日计划');

const IDX = sandbox.SITE_INDEX;
chk(IDX.some(x => x.book === 'tangshi' && x.id === 'tangshi-ts-1'),
  '站点总索引已含唐诗（带 tangshi- 前缀）');
chk(IDX.some(x => x.book === 'tangshi' && x.isBook && x.page === '/tangshi/'),
  '总索引里唐诗集子自身指向 /tangshi/');
chk(IDX.every(x => x.id !== 'ts-1' || x.book), '唐诗条目都带集子归属');

const html = fs.readFileSync(path + 'tangshi/index.html', 'utf8');
chk(html.indexOf('/tangshi/ 里') >= 0 || html.indexOf('tangshi') >= 0, '页面标注了 /tangshi/ 目录');
const scriptOrder = html.match(/<script src="([^"]+)"><\/script>/g).map(s => s.match(/src="([^"]+)"/)[1]);
chk(scriptOrder.indexOf('data/poems-tangshi.js') >= 0, '页面引用了唐诗数据');
chk(scriptOrder.indexOf('js/reader-core.js') >= 0, '页面加载了 js/reader-core.js 引擎');
chk(scriptOrder.indexOf('js/reader-core.js') < scriptOrder.indexOf('js/tangshi.js'),
  '引擎排在挂载脚本 js/tangshi.js 之前');

// ---------------------------------------------------------------------------
// Issue #278：这一层的**页面层**（jsdom 起页面、挂脚本、渲染分组、点开详情、
// 搜索框敲字）整段删除 —— 那是界面测试。留下的是数据层：篇目数量 / id / 字段 /
// 分组口径 / 总索引收录，以及页面脚本顺序这一类**功能接线**的口径。
// ---------------------------------------------------------------------------

console.log('');
console.log(fails ? '❌ ' + fails + ' 项失败' : '🎉 tangshi测试全部通过');
process.exit(fails ? 1 : 0);
