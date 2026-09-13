// 古文观止（/guwen/ 页）端到端测试：目录完整性 + 卷次分组 + 收录状态 + 列表/搜索 + 阅读器
//
// 这一层与 test/tangshi.test.js 的差别在于：唐诗是「全收」（301 首全有正文译文），
// 古文观止是**十二卷 155 篇的目录 + 分批收录**：目录里所有篇目都列得出来，
// 但只有一部分已经整理好正文与白话译文。所以这里除了验「收了什么」，
// 还要验「没收的那些是怎么呈现的」——「待补」条目必须照常可见、
// 点开有明确说明、且不会混进全站搜索索引（搜到点进去只有提示＝白跑一趟）。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const vm = require('vm');
const path = __dirname + '/../';

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

/* ---------- 一、数据层（纯 vm，无 DOM） ---------- */
const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
['data/poems-classic.js', 'data/poems-guwen.js', 'data/site-index.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path + f, 'utf8'), sandbox, { filename: f }));

const GW = sandbox.POEMS_GUWEN;
chk(Array.isArray(GW) && GW.length === 155,
  '古文观止目录十二卷共 155 篇（实际 ' + (GW ? GW.length : 'undefined') + '）');

const ids = new Set();
let dup = 0;
GW.forEach(p => { if (ids.has(p.id)) dup++; ids.add(p.id); });
chk(dup === 0, '古文 id 无重复（重复 ' + dup + ' 个）');

chk(GW.every(p => p.title && p.source && p.dynasty && p.author),
  '每篇都有 标题/出处/朝代/作者');
chk(GW.every(p => p.source === '《古文观止》'), '出处统一为《古文观止》');
chk(GW.every(p => /^卷[一二三四五六七八九十]+ /.test(p.gradeGroup || '')),
  '每篇都归入某一卷（gradeGroup 形如「卷N XX」）');

// 收录状态：已收录的必须正文 + 译文 + 摘句齐全；未收录的必须三者皆空
const done = GW.filter(p => p.text && p.translation);
const pending = GW.filter(p => !p.text && !p.translation);
chk(done.length === sandbox.guwenDoneCount(),
  'guwenDoneCount() 与实际收录数一致（' + done.length + '）');
chk(done.length + pending.length === GW.length,
  '每一篇要么已收录、要么标着待补，没有「有正文没译文」的半成品'
  + '（已收录 ' + done.length + ' · 待补 ' + pending.length + '）');
chk(done.every(p => p.excerpt),
  '已收录的每一篇都给了列表用摘句（excerpt）');
chk(done.every(p => p.translationSource === 'public-domain'),
  '已收录的每一篇都标了译文来源 public-domain');
chk(done.every(p => p.book && /^《.+》$/.test(p.book)),
  '已收录的每一篇都标了出自哪部书（book）');

// 十二卷齐备
const groups = sandbox.getGuwenGroups();
chk(groups.length === 12, '按卷次聚合出 12 组（实际 ' + groups.length + '）');
chk(groups.reduce((n, g) => n + g.items.length, 0) === 155, '各组篇目合计 155');
const want = ['卷一 周文', '卷二 周文', '卷三 周文', '卷四 秦文', '卷五 汉文', '卷六 汉文',
  '卷七 六朝唐文', '卷八 唐文', '卷九 唐宋文', '卷十 宋文', '卷十一 宋文', '卷十二 明文'];
chk(want.every(w => groups.some(g => g.name === w)),
  '卷一至卷十二的卷次名齐备（缺 ' + want.filter(w => !groups.some(g => g.name === w)).join('/') + '）');

// 需求清单抽查：卷一名篇与常用选篇必须在库中
const need = ['郑伯克段于鄢', '曹刿论战', '烛之武退秦师', '蹇叔哭师', '召公谏厉王弭谤',
  '邹忌讽齐王纳谏', '唐雎不辱使命', '冯谖客孟尝君', '谏逐客书', '屈原列传', '过秦论（上）',
  '前出师表', '陈情表', '兰亭集序', '归去来兮辞', '桃花源记', '谏太宗十思疏', '滕王阁序',
  '陋室铭', '阿房宫赋'];
const titles = GW.map(p => p.title);
const missing = need.filter(t => !titles.includes(t));
chk(missing.length === 0, '清单里的名篇齐备（缺 ' + missing.join('/') + '）');

/**
 * 收录篇目的「正文确实属于这一篇」防线。
 *
 * 这条断言来自一次真实事故：整理语料时按「篇名反查」兜底配对，把
 * 《召公谏厉王弭谤》的正文挂到了《晏子不死君难》名下 —— 列表、阅读器、
 * 搜索全都正常，只有点进去读两行才会发现张冠李戴。
 * 所以每一篇「已收录」的，都要能用**它自己开头的那一句**在原文里对上号：
 * 开篇句是这一篇最稳定的指纹，且《古文观止》各篇开篇几乎不重样。
 */
const OPENINGS = {
  '郑伯克段于鄢': '初，郑武公娶于申',
  '曹刿论战': '十年春，齐师伐我',
  '烛之武退秦师': '晋侯、秦伯围郑',
  '蹇叔哭师': '杞子自郑使告于秦曰',
  '召公谏厉王弭谤': '厉王虐，国人谤王',
  '邹忌讽齐王纳谏': '邹忌修八尺有余',
  '唐雎不辱使命': '秦王使人谓安陵君曰',
  '冯谖客孟尝君': '齐人有冯谖者',
  '谏逐客书': '臣闻吏议逐客',
  '屈原列传': '屈原者，名平，楚之同姓也',
  '报任安书': '古者富贵而名摩灭',
  '过秦论（上）': '秦孝公据崤函之固',
  '前出师表': '先帝创业未半而中道崩殂',
  '陈情表': '臣密言：臣以险衅',
  '兰亭集序': '永和九年，岁在癸丑',
  '归去来兮辞': '归去来兮，田园将芜胡不归',
  '桃花源记': '晋太元中，武陵人捕鱼为业',
  '谏太宗十思疏': '臣闻求木之长者',
  '滕王阁序': '豫章故郡，洪都新府',
  '陋室铭': '山不在高，有仙则名',
  '阿房宫赋': '六王毕，四海一',
};
const misassigned = done.filter(p => {
  const open = OPENINGS[p.title];
  return open && String(p.text).replace(/\s/g, '').indexOf(open.replace(/\s/g, '')) < 0;
});
chk(misassigned.length === 0,
  '已收录篇目的正文与篇名对得上（每篇开篇句能对上号；错配：'
  + misassigned.map(p => p.title).join('/') + '）');
// 反向：上面这份「开篇句清单」要覆盖全部已收录篇目，避免日后新增篇目时忘了补
const uncovered = done.filter(p => !OPENINGS[p.title]);
chk(uncovered.length === 0,
  '开篇句清单覆盖全部已收录篇目（漏：' + uncovered.map(p => p.title).join('/') + '）');

// 长篇场景：卷一的《郑伯克段于鄢》是长篇（验证长文阅读）
const zw = GW.filter(p => p.title === '郑伯克段于鄢')[0] || {};
chk(zw.author === '左丘明' && zw.dynasty === '东周', '《郑伯克段于鄢》作者左丘明 · 朝代东周');
chk(zw.gradeGroup === '卷一 周文', '《郑伯克段于鄢》归入「卷一 周文」（实际 ' + zw.gradeGroup + '）');
chk(/郑武公娶于申/.test(zw.text || ''), '原文开篇「郑武公娶于申」齐备');
chk(/郑武公/.test(zw.translation || '') && /姜氏/.test(zw.translation || ''),
  '白话译文把人物译成今语（含「郑武公」「姜氏」）');
chk((zw.text || '').length > 300, '《郑伯克段于鄢》是长篇（>300 字，验证长文场景）');

// 不能污染古诗词主库与每日计划
chk(sandbox.POEMS_ALL === undefined, '古文不写入 POEMS_ALL，不影响每日计划');

// 站点总索引：只收「有正文」的篇目，待补的不进搜索
const IDX = sandbox.SITE_INDEX;
const idxGuwen = IDX.filter(x => x.book === 'guwen' && !x.isBook);
chk(idxGuwen.length === done.length,
  '总索引只含已收录的 ' + done.length + ' 篇（实际 ' + idxGuwen.length + '）');
chk(idxGuwen.every(x => x.text && x.translation),
  '总索引里的古文条目都带正文与译文（搜到就能读）');
chk(IDX.some(x => x.book === 'guwen' && x.isBook && x.page === '/guwen/'),
  '总索引里古文观止集子自身指向 /guwen/');
chk(IDX.every(x => x.id !== 'gwj-1' || x.book), '古文条目都带集子归属');

/* ---------- 二、页面层（jsdom） ---------- */
const html = fs.readFileSync(path + 'guwen/index.html', 'utf8');
const scriptOrder = html.match(/<script src="([^"]+)"><\/script>/g).map(s => s.match(/src="([^"]+)"/)[1]);
chk(scriptOrder.indexOf('data/poems-guwen.js') >= 0, '页面引用了古文观止数据');
chk(scriptOrder.indexOf('js/reader-core.js') >= 0, '页面加载了 js/reader-core.js 引擎');
chk(scriptOrder.indexOf('js/reader-core.js') < scriptOrder.indexOf('js/guwen.js'),
  '引擎排在挂载脚本 js/guwen.js 之前');
chk(html.indexOf('data-nav="guwen"') >= 0, '页面声明了 guwen 页签');

const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://local.test/guwen/', base: 'https://local.test/guwen/' });
const w = dom.window;
w.scrollTo = function () {};
scriptOrder.forEach(f => {
  const el = w.document.createElement('script');
  el.textContent = fs.readFileSync(path + f, 'utf8');
  w.document.body.appendChild(el);
});

setTimeout(() => {
  const d = w.document;

  // 重复 id 防线
  ['guwen/index.html', 'songci/index.html', 'classic/index.html'].forEach(f => {
    const doc = new JSDOM(fs.readFileSync(path + f, 'utf8')).window.document;
    const seen = {};
    const dups = [];
    doc.querySelectorAll('[id]').forEach(el => {
      if (seen[el.id]) { if (dups.indexOf(el.id) < 0) dups.push(el.id); } else seen[el.id] = 1;
    });
    chk(dups.length === 0, f + ' 无重复 id（重复：' + dups.join(', ') + '）');
  });

  chk(d.querySelectorAll('#gw-list .item').length === 155,
    '列表渲染 155 篇目录（实际 ' + d.querySelectorAll('#gw-list .item').length + '）');
  chk(d.querySelectorAll('#gw-list .item.pending').length === pending.length,
    '其中 ' + pending.length + ' 篇标着「待补」');
  chk(d.querySelectorAll('#gw-list .item-reason.pending').length === pending.length,
    '待补条目在标题旁有「待补」小标，点开前就看得出来');
  chk(d.querySelector('#gw-count').textContent === '0 / 155 篇',
    '顶部显示 0 / 155 篇：' + d.querySelector('#gw-count').textContent);

  // 挂载点对外接口
  const api = w.ReaderEngine.current;
  chk(!!api, '引擎挂上了古文观止实例');
  chk(api.total() === 155, '实例 total() 为 155');

  // 已读键：古文与别的集子各存各的
  const gsrc = fs.readFileSync(path + 'js/guwen.js', 'utf8');
  const gwReadKey = (gsrc.match(/readStore:\s*"([^"]+)"/) || [])[1];
  chk(gwReadKey === 'poem_guwen_read_v1',
    '古文观止用独立的已读键 poem_guwen_read_v1（实际 ' + gwReadKey + '）');

  // 卷次顺序表必须在挂载脚本里显式给出，且覆盖十二卷
  chk(/卷一 周文/.test(gsrc) && /卷十二 明文/.test(gsrc),
    '挂载脚本给出了卷一至卷十二的卷次顺序');

  // 打开一篇已收录的：标题 / 作者 / 正文写入阅读器
  api.open('gwj-1');
  const title = d.querySelector('#rd-title').textContent;
  chk(title === '郑伯克段于鄢', '可打开指定篇目（gwj-1 → ' + title + '）');
  chk(/左丘明/.test(d.querySelector('#rd-meta').textContent), '阅读器展示了作者');
  const plain = d.querySelector('#rd-text').textContent
    .replace(/[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹ·]+/g, '').replace(/\s/g, '');
  chk(/郑武公娶于申/.test(plain), '正文已写入阅读器');
  chk(/郑武公/.test(d.querySelector('#rd-trans-text').textContent), '白话译文已写入阅读器');

  // 打开一篇「待补」的：要有明确提示，不能白屏 / 不能是假内容
  const pendingId = (pending[0] || {}).id;
  api.open(pendingId);
  chk(/尚在整理中/.test(d.querySelector('#rd-text').textContent),
    '待补篇目点开后给出「原文尚在整理中」的说明（实际：'
    + d.querySelector('#rd-text').textContent.slice(0, 20) + '）');
  chk(/尚在整理中/.test(d.querySelector('#rd-trans-text').textContent),
    '待补篇目的译文区也给出「尚在整理中」的说明');
  api.close();

  // 搜索：按作者筛，且只筛古文这一部
  api.setKeyword('左丘明');
  const nZuo = d.querySelectorAll('#gw-list .item').length;
  chk(nZuo > 0 && nZuo < 155, '按作者「左丘明」搜索得到子集（' + nZuo + ' 篇）');
  api.setKeyword('');

  console.log('');
  console.log(fails === 0 ? '🎉 古文观止测试全部通过' : '❌ 古文观止测试 ' + fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
}, 120);
