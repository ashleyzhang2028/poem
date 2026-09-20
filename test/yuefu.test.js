// 乐府集（精选 103 首）—— 课外阅读的第二部集子（Issue #244）。
//
// 一句话说清这一部与其余七部的不同：它是**一个体制**（乐府）跨汉魏、南朝、
// 唐、五代的选本，所以目录按**时代次第**分卷（卷一 汉魏 → 卷二 南朝 →
// 卷三 唐代 → 卷四 唐五代 → 卷五 乐府歌辞），而不是按体裁或词牌。
//
// 这一层守四件事：
//   ① 一百零三首齐备、字段齐全、分组落在这五卷里；
//   ② 与课内 / 唐诗重篇的那几十首走同一条判重与正文收归的路（作品主表里合并、
//      正文只在存储主表落一份）—— 乐府集自己不留第二份正文；
//   ③ 集子页能读、能搜、能分组，正文由 textRef 取回；
//   ④ 排序与注册：乐府集排在《唐诗三百首》之前，元曲排在《宋词三百首》之后。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const vm = require('vm');
const path = __dirname + '/../';
const read = f => fs.readFileSync(path + f, 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);

const { loadData, resolve } = require('./master-env');
loadData(sandbox, ['data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js',
  'data/poems-5.js', 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js', 'data/poems-9.js',
  'data/poems-10.js', 'data/poems-11.js', 'data/poems-12.js', 'data/index.js',
  'data/poems-classic.js', 'data/poems-yuefu.js', 'data/poems-tangshi.js', 'data/poems-songci.js',
  'data/poems-guwen.js', 'data/poems-zhaoming.js', 'data/poems-yuanqu.js',
  'data/site-index.js', 'data/works-map.js', 'data/works-index.js']);

console.log('=== 一、一百首：数量、id、字段、分组 ===');
const YF = resolve(sandbox, sandbox.POEMS_YUEFU, 'yuefu');
chk(Array.isArray(YF) && YF.length === 103,
  '乐府集精选 103 首（实际 ' + (YF ? YF.length : 'undefined') + '）');

const ids = new Set();
let dup = 0;
YF.forEach(p => { if (ids.has(p.id)) dup++; ids.add(p.id); });
chk(dup === 0, '一百首 id 无重复（重复 ' + dup + ' 个）');

chk(YF.every(p => p.title && p.source && p.dynasty && p.author && p.text && p.translation),
  '每首都齐全：标题 / 出处 / 朝代 / 作者 / 原文 / 译文');
chk(YF.every(p => p.excerpt && p.excerpt.length <= 28 && p.excerpt.indexOf('\n') < 0),
  '每首都给了列表用摘句（excerpt，单行、不长于 28 字）');
// 与课内 / 唐诗重篇的那几十首，译文与来源**跟着主表走**（教材口径优先）——
// 所以这里的取值是三种：自己的一份是 public-domain，重篇的可能是 school / academic。
const YF_SRC_OK = ['public-domain', 'school', 'academic'];
chk(YF.every(p => YF_SRC_OK.indexOf(p.translationSource) >= 0),
  '一百首都标了译文来源且取值在允许范围（异常 ' +
  YF.filter(p => YF_SRC_OK.indexOf(p.translationSource) < 0).length + ' 首）');
chk(YF.filter(p => p.translationSource === 'public-domain').length >= 60,
  '多数篇目用自己的 public-domain 那一份（重篇才跟着主表走；实际 ' +
  YF.filter(p => p.translationSource === 'public-domain').length + ' 首）');
chk(YF.every(p => /^[。！？]$/.test(p.text.trim().slice(-1))),
  '每首正文都以句末标点收尾（没有录入截断的半截篇）');

const GROUPS = ['卷一 汉魏乐府', '卷二 南朝乐府', '卷三 唐代乐府', '卷四 唐五代乐府', '卷五 乐府歌辞'];
const haveGroups = new Set(YF.map(p => p.gradeGroup));
chk(GROUPS.every(g => haveGroups.has(g)) && haveGroups.size === GROUPS.length,
  '五卷分组齐备、且没有凭空多出的卷名（实际：' + [...haveGroups].join(' / ') + '）');

const groups = sandbox.getYuefuGroups();
chk(groups.length === GROUPS.length, '按卷聚合出 ' + groups.length + ' 组（实际 ' + groups.length + '）');
chk(groups.reduce((n, g) => n + g.items.length, 0) === 103, '各组篇目合计 103');

const ysrc = read('js/yuefu.js');
const listed = JSON.parse('[' + ysrc.match(/var GROUP_ORDER = window\.YUEFU_GROUP_ORDER = \[([\s\S]*?)\];/)[1].replace(/,\s*$/, '') + ']');
chk(listed.length === GROUPS.length && GROUPS.every(g => listed.indexOf(g) >= 0),
  '挂载脚本的卷次顺序表与实际分组一致（表 ' + listed.length + ' · 实际 ' + groups.length + '）');
chk(listed.join('/') === GROUPS.join('/'),
  '卷次顺序就是面板上的呈现顺序：汉魏 → 南朝 → 唐代 → 唐五代 → 乐府歌辞');

console.log('\n=== 二、名篇齐备、正文对得上篇名 ===');
const NEED = ['孔雀东南飞', '有所思', '迢迢牵牛星',
  '木兰诗', '敕勒歌', '西洲曲', '陌上桑', '十五从军征', '长歌行', '上邪',
  '饮马长城窟行', '观沧海', '龟虽寿', '短歌行', '燕歌行', '白马篇', '七哀诗', '胡笳十八拍·其一',
  '子夜歌·其一', '子夜四时歌·春歌', '读曲歌', '华山畿', '莫愁乐', '折杨柳歌辞', '陇头歌辞',
  '春江花月夜', '蜀道难', '将进酒', '行路难', '长相思', '关山月', '长干行', '塞下曲',
  '凉州词', '出塞', '从军行·其四', '琵琶行', '长恨歌', '茅屋为秋风所破歌', '石壕吏',
  '杜陵叟', '田家行', '野老歌', '游子吟', '节妇吟', '江南曲', '渔翁', '忆江南', '竹枝词',
  '乌衣巷', '秋词', '菩萨蛮', '梦江南', '虞美人', '相见欢', '静夜思', '月下独酌', '玉阶怨',
  '秋浦歌', '早发白帝城', '望庐山瀑布', '望天门山', '独坐敬亭山', '赠汪伦', '春思',
  '黄鹤楼送孟浩然之广陵', '峨眉山月歌', '把酒问月', '清平调', '金缕衣', '春望', '绝句',
  '江畔独步寻花', '江南逢李龟年'];
const titles = YF.map(p => p.title);
const missing = NEED.filter(t => titles.indexOf(t) < 0);
chk(missing.length === 0, '选本名篇齐备（缺 ' + (missing.join('/') || '无') + '）');

const OPENINGS = {
  '孔雀东南飞': '序曰', '有所思': '有所思', '迢迢牵牛星': '迢迢牵牛星',
  '木兰诗': '唧唧复唧唧', '敕勒歌': '敕勒川，阴山下', '西洲曲': '忆梅下西洲',
  '陌上桑': '日出东南隅', '十五从军征': '十五从军征', '长歌行': '青青园中葵',
  '上邪': '上邪', '观沧海': '东临碣石', '龟虽寿': '神龟虽寿', '短歌行': '对酒当歌',
  '白马篇': '白马饰金羁', '春江花月夜': '春江潮水连海平', '蜀道难': '噫吁嚱',
  '将进酒': '君不见', '行路难': '金樽清酒斗十千', '关山月': '明月出天山',
  '长干行': '妾发初覆额', '琵琶行': '浔阳江头夜送客', '长恨歌': '汉皇重色思倾国',
  '茅屋为秋风所破歌': '八月秋高风怒号', '石壕吏': '暮投石壕村', '游子吟': '慈母手中线',
  '忆江南': '江南好', '竹枝词': '杨柳青青江水平', '乌衣巷': '朱雀桥边野草花',
  '虞美人': '春花秋月何时了', '相见欢': '无言独上西楼', '静夜思': '床前明月光',
  '月下独酌': '花间一壶酒', '玉阶怨': '玉阶生白露', '早发白帝城': '朝辞白帝彩云间',
  '望庐山瀑布': '日照香炉生紫烟', '独坐敬亭山': '众鸟高飞尽', '赠汪伦': '李白乘舟将欲行',
  '春望': '国破山河在', '绝句': '两个黄鹂鸣翠柳', '江畔独步寻花': '黄四娘家花满蹊'
};
const badOpening = Object.keys(OPENINGS).filter(n => {
  const p = YF.filter(x => x.title === n)[0];
  if (!p) return true;
  return (p.text.split('\n')[0] || '').indexOf(OPENINGS[n]) === -1;
});
chk(badOpening.length === 0,
  '抽查 ' + Object.keys(OPENINGS).length + ' 首的正文开篇句与篇名对得上（不符 ' + (badOpening.join('/') || '无') + '）');

console.log('\n=== 三、与课内 / 其余集子重篇：走同一条判重与正文收归的路 ===');
const IDX = sandbox.SITE_INDEX;
const yfIdx = IDX.filter(x => x.book === 'yuefu' && !x.isBook);
chk(yfIdx.length === 103, '总索引收了全部 103 首（实际 ' + yfIdx.length + '）');
chk(yfIdx.every(x => x.text && x.translation), '进索引的每一首原文与译文齐备');
chk(IDX.some(x => x.book === 'yuefu' && x.isBook),
  '「乐府集」本身也作为一条结果（搜集子名能直接进那一页）');

const WI = sandbox.WorksIndex;
const REHEARSED = [['poems-gz10-02', 'yuefu-yf-11', '短歌行'],
  ['poems-cz7-01', 'yuefu-yf-12', '观沧海'],
  ['poems-cz8-11', 'yuefu-yf-13', '龟虽寿'],
  ['poems-cz7-13', 'yuefu-yf-17', '木兰诗'],
  ['poems-xx2-07', 'yuefu-yf-18', '敕勒歌'],
  ['poems-xx1-02', 'yuefu-yf-4', '江南'],
  ['poems-xx1-09', 'yuefu-yf-63', '静夜思'],
  ['poems-cz8-23', 'yuefu-yf-78', '石壕吏'],
  ['poems-cz8-24', 'yuefu-yf-79', '茅屋为秋风所破歌'],
  ['poems-gz10-13', 'yuefu-yf-10', '涉江采芙蓉']];
REHEARSED.forEach(([c, y, name]) => {
  chk(WI.same(c, y), '《' + name + '》课内与乐府集判为同一篇（' + c + ' ↔ ' + y + '）');
});
chk(REHEARSED.every(([c]) => WI.repOf(REHEARSED.filter(r => WI.same(c, r[1]))[0][1]) === c),
  '同一篇的代表条目优先课内那一条（老进度不丢）');

const txtOf = id => {
  const p = IDX.filter(x => x.id === id)[0];
  return p ? (sandbox.masterTextOf ? sandbox.masterTextOf(p, p.book).text : p.text) : '';
};
const norm = t => String(t || '').replace(/\s+/g, '');
REHEARSED.forEach(([c, y, name]) => {
  chk(norm(txtOf(c)) === norm(txtOf(y)),
    '《' + name + '》两条读到的正文逐字相同（正文只在存储主表落一份）');
});
chk(sandbox.TEXT_MASTER.some(m => m.entries.indexOf('yuefu-yf-1') >= 0),
  '乐府集的单篇也进了存储主表（no-yf-1 这种「自己一份」不算例外）');

const MASTER = sandbox.TEXT_MASTER;
const yfEntries = [];
MASTER.forEach(m => (m.entries || []).forEach(e => { if (e.indexOf('yuefu-') === 0) yfEntries.push(e); }));
chk(yfEntries.length === 103, '存储主表收齐乐府集 103 条（实际 ' + yfEntries.length + '）');
chk(new Set(yfEntries).size === 103, '主表里没有重复登记同一条乐府条目');

const inline = [];
read('data/poems-yuefu.js').split(/\n(?=\s*\{)/).forEach(blk => {
  if (/^\s+text:\s*"/m.test(blk) || /^\s+translation:\s*"/m.test(blk)) inline.push(blk.slice(0, 40));
});
chk(inline.length === 0,
  'data/poems-yuefu.js 里正文只留 textRef（不内联副本；实际残留 ' + inline.length + ' 处）');

console.log('\n=== 四、注册与排序：乐府集在唐诗前，元曲在宋词后 ===');
chk(sandbox.SITE_BOOKS.map(b => b.id).join(',') ===
  'poems,classic,yuefu,tangshi,songci,yuanqu,guwen,jinxiandai,zhaoming',
  'SITE_BOOKS 的次序正确（Issue #244）：课内 · 小古文 · 乐府集 · 唐诗 · 宋词 · 元曲 · 古文观止 · 近现代诗词 · 昭明文选');
chk(sandbox.SITE_BOOKS.filter(b => b.id === 'yuefu')[0].name === '乐府集',
  '集子名写作「乐府集」');

const lib = read('js/library.js');
const libOrder = (lib.match(/id: "([a-z]+)",\n      name:/g) || []).map(s => s.match(/id: "([a-z]+)"/)[1]);
chk(libOrder.join(',') === 'poems,classic,yuefu,tangshi,songci,yuanqu,guwen,jinxiandai,zhaoming',
  '入口页卡片次序与 SITE_BOOKS 同源（实际 ' + libOrder.join(',') + '）');

const si = read('data/site-index.js');
chk(si.indexOf('{ id: "yuefu"') > -1 && si.indexOf('{ id: "yuefu"') < si.indexOf('{ id: "tangshi"'),
  '站点索引里乐府集排在唐诗之前');
chk(si.indexOf('{ id: "yuanqu"') < si.indexOf('{ id: "guwen"'),
  '站点索引里元曲排在宋词之后（元曲 → 古文观止）');

const sw = read('sw.js');
chk(/\.\/yuefu\//.test(sw) && /js\/yuefu\.js/.test(sw) && /data\/poems-yuefu\.js/.test(sw),
  '乐府页 / 脚本 / 数据都进了 Service Worker 预缓存（断网也能读）');

const wr = read('js/read-sync.js');
chk(/poem_yuefu_read_v1/.test(wr), '已读那一族认得 poem_yuefu_read_v1（跨设备并集合并）');
chk(/poem_yuefu_read_v1/.test(read('js/sync-coverage.js')),
  '同步边界总表里有这一把已读键（否则「表外键」那条守卫会红）');

console.log('\n=== 五、集子页：分组渲染、正文取回、按作者搜索 ===');
const dom = new JSDOM(read('yuefu/index.html'), {
  runScripts: 'dangerously',
  url: 'https://local.test/yuefu/'
});
const w = dom.window;
w.scrollTo = function () {};
const scripts = read('yuefu/index.html').match(/<script src="([^"]+)"><\/script>/g)
  .map(s => s.match(/src="([^"]+)"/)[1]);

setTimeout(() => {
  for (const f of scripts) {
    try {
      const el = w.document.createElement('script');
      el.textContent = read(f);
      w.document.body.appendChild(el);
    } catch (e) {
      console.log('✗ 脚本执行失败 ' + f + '：' + e.message);
      fails++;
    }
  }
  const d = w.document;

  chk(!!w.ReaderEngine, '阅读库引擎已加载');
  const items = d.querySelectorAll('#gw-list .item');
  chk(items.length === 103, '列表渲染出 103 条（实际 ' + items.length + '）');
  chk(/乐府集/.test(d.body.textContent), '页面出现「乐府集」');
  chk(/卷一 汉魏乐府/.test(d.body.textContent), '卷名「卷一 汉魏乐府」渲染到了页面上');
  chk(/卷五 乐府歌辞/.test(d.body.textContent), '卷名「卷五 乐府歌辞」渲染到了页面上');
  chk(!/\[object|undefined/.test(d.querySelector('#gw-list').textContent),
    '列表文案没有渲染异常（无 undefined / [object]）');

  const api = w.ReaderEngine.current;
  chk(!!api, '拿到 /yuefu/ 页的挂载实例');
  if (api) {
    api.open('yf-17');
    const rd = d.querySelector('#gw-reader');
    chk(/木兰诗/.test(rd.querySelector('#rd-title').textContent),
      '点开《木兰诗》，标题对得上（实际 ' + rd.querySelector('#rd-title').textContent + '）');
    const strip2 = t => String(t || '').replace(/[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹ·\s]+/gi, '');
    chk(strip2(rd.querySelector('#rd-text').textContent).indexOf('唧唧复唧唧') >= 0,
      '正文由 textRef 取回主表那一份（实际「' +
      strip2(rd.querySelector('#rd-text').textContent).slice(0, 12) + '…」）');
    chk(strip2(rd.querySelector('#rd-trans-text').textContent).length > 40,
      '译文同样由主表取回');

    api.setKeyword('曹操');
    const nCao = d.querySelectorAll('#gw-list .item').length;
    chk(nCao > 0 && nCao < 103, '按作者「曹操」搜索得到子集（' + nCao + ' 首）');

    api.setKeyword('木兰');
    chk(d.querySelectorAll('#gw-list .item').length === 1,
      '搜「木兰」只出《木兰诗》一条');
    api.setKeyword('');

    chk(d.querySelectorAll('#gw-list .item').length === 103, '清空关键词后回到 103 条');
  }

  chk(Object.keys(w.localStorage).filter(k => /read_v1/.test(k)).length === 0,
    '只读不标，页面没有写任何一部的已读键');

  console.log('');
  console.log(fails === 0 ? '🎉 乐府集测试全部通过' : '❌ 乐府集测试 ' + fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
}, 260);
