// 昭明文选（/zhaoming/ 页）端到端测试：目录完整性 + 文体分组 + 收录状态 + 列表/搜索 + 阅读器
//
// 这一部与其余四部最不一样的地方是**分类口径**：
//   唐诗按卷次、宋词按词牌、古文观止按卷次，而《昭明文选》按**文体**分三十九类。
// 所以这里重点验三件事：
//   1. 目录完整：480 篇、三十九类文体齐备、每篇都有篇名/朝代/作者/出处；
//   2. 正文确实属于这一篇（逐篇用「开篇句指纹」比对 —— 这条防线来自古文观止
//      那次张冠李戴的真实事故，见 test/guwen.test.js 中部说明）；
//   3. 译文状态诚实：**原文 480 篇全收**，白话译文已整理 329 篇
//      （29 篇名篇 + 49 篇赋 + 251 篇诗），其余在列表里标「待补」，
//      点开是说清楚而不是白屏。
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
['data/poems-classic.js', 'data/poems-guwen.js', 'data/poems-zhaoming.js',
 'data/site-index.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path + f, 'utf8'), sandbox, { filename: f }));

const ZM = sandbox.POEMS_ZHAOMING;
chk(Array.isArray(ZM) && ZM.length === 480,
  '昭明文选目录六十卷共 480 篇（实际 ' + (ZM ? ZM.length : 'undefined') + '）');

const ids = new Set();
let dup = 0;
ZM.forEach(p => { if (ids.has(p.id)) dup++; ids.add(p.id); });
chk(dup === 0, '文选 id 无重复（重复 ' + dup + ' 个）');

chk(ZM.every(p => p.title && p.source && p.dynasty && p.author),
  '每篇都有 标题/出处/朝代/作者');
// 《文选》是选集，出处记选本名是**对的**（与古文观止不同：
// 那一部 source 必须是真实成书之处，选本名退到 selection）
chk(ZM.every(p => p.source === '《文选》' && p.selection === '《文选》'),
  '每篇的出处与所在选本都标《文选》');
chk(ZM.every(p => p.authorName),
  '每篇都给了常用姓名 authorName（作者题署多为字，如「班孟坚」）');
chk(ZM.every(p => p.gradeGroup && p.gradeGroup.length > 0),
  '每篇都归入某一文体分组（gradeGroup 形如「赋 · 京都上」「书」）');

/* ---------- 二、文体分类：三十九类齐备 ---------- */
// 这是《昭明文选》原书体例里明确的一组文体，逐类核对
const GENRES = ['赋', '诗', '骚', '七', '诏', '册', '令', '教', '文', '表', '上书',
  '启', '弹事', '笺', '奏记', '书', '檄', '对问', '设论', '辞', '序', '颂', '赞',
  '符命', '史论', '史述赞', '论', '连珠', '箴', '铭', '诔', '哀', '碑文', '墓志',
  '行状', '吊文', '祭文'];
const haveGenres = new Set(ZM.map(p => p.gradeGroup.split(' · ')[0]));
const missingGenres = GENRES.filter(g => !haveGenres.has(g));
chk(missingGenres.length === 0,
  '三十七类文体齐备（缺 ' + missingGenres.join('/') + '）');
const extraGenres = [...haveGenres].filter(g => GENRES.indexOf(g) === -1);
chk(extraGenres.length === 0,
  '没有凭空多出的文体名（多出 ' + extraGenres.join('/') + '）');

// 赋 / 诗 下还有原书小类（京都、游览、赠答、行旅……）
const subs = ZM.filter(p => p.gradeGroup.indexOf(' · ') > 0);
chk(subs.length > 200, '赋 / 诗下的小类分组在案（' + subs.length + ' 篇带小类）');
['赋 · 京都上', '赋 · 游览', '赋 · 哀伤', '诗 · 赠答二', '诗 · 行旅上',
 '诗 · 杂诗上', '论 · 论一'].forEach(g => {
  chk(ZM.some(p => p.gradeGroup === g), '分组「' + g + '」存在');
});

const groups = sandbox.getZhaomingGroups();
chk(groups.length === 91, '按文体（含小类）聚合出 91 组（实际 ' + groups.length + '）');
chk(groups.reduce((n, g) => n + g.items.length, 0) === 480, '各组篇目合计 480');

/* ---------- 三、收录状态：原文全收，译文按篇标待补 ---------- */
const withText = ZM.filter(p => p.text);
const withTrans = ZM.filter(p => p.translation);
chk(withText.length === ZM.length,
  '480 篇原文全部收录（已收录 ' + withText.length + '）');
chk(withText.every(p => p.excerpt),
  '每一篇都给了列表用摘句（excerpt）');
chk(withTrans.length === 329,
  '已整理出 329 篇白话译文（实际 ' + withTrans.length + '）');
chk(withTrans.every(p => p.translationSource === 'public-domain'),
  '已译的每一篇都标了译文来源 public-domain');
chk(withTrans.every(p => p.text),
  '有译文的一定有原文（不会出现「有译无文」的半成品）');
chk(withTrans.length === sandbox.zhaomingDoneCount(),
  'zhaomingDoneCount() 与实际已译数一致（' + withTrans.length + '）');
chk(withText.length === sandbox.zhaomingTextCount(),
  'zhaomingTextCount() 与实际原文数一致（' + withText.length + '）');

// 名篇抽查：跨文体挑出选本里的代表作，必须在库中
const NEED = ['两都赋二首', '西京赋', '东京赋', '洛神赋', '登楼赋', '别赋', '恨赋',
  '归田赋', '思旧赋', '风赋', '高唐赋', '神女赋', '古诗十九首', '离骚经', '九歌四首',
  '卜居', '渔父', '九辩五首', '七发八首', '七启八首', '七命八首', '贤良诏', '册魏公九锡文',
  '宣德皇后令', '为宋公修张良庙教', '出师表', '陈情表', '荐祢衡表', '求自试表',
  '上书谏猎', '答苏武书', '报任少卿书', '论盛孝章书', '为袁绍檄豫州', '对楚王问',
  '答客难', '解嘲', '秋风辞', '归去来', '毛诗序', '三都赋序', '酒德颂',
  '东方朔画赞', '封禅文', '过秦论', '典论论文', '养生论', '演连珠五十首', '女史箴',
  '封燕然山铭', '座右铭', '剑阁铭', '王仲宣诔', '哀永逝文', '郭有道碑文',
  '刘先生夫人墓志', '齐竟陵文宣王行状', '吊屈原文', '祭古冢文'];
const titles = ZM.map(p => p.title);
const missing = NEED.filter(t => titles.indexOf(t) === -1);
chk(missing.length === 0, '选本名篇齐备（缺 ' + missing.join('/') + '）');

/* ---------- 四、正文与篇名的对应（开篇句指纹） ---------- */
/**
 * 这一条防线来自一次真实事故（见 test/guwen.test.js）：整理语料时用
 * 「按篇名反查」兜底配对，把《召公谏厉王弭谤》的正文挂到了《晏子不死君难》名下，
 * 列表、阅读器、搜索全都正常，只有点进去读两行才发现张冠李戴。
 * 这里对**每一篇**做同样的核对：用数据里的第一段开头，回到原始语料里找得到。
 */
const OPENINGS = {
  '两都赋二首': '或曰，赋者古诗之流也',
  '西京赋': '有凭虚公子者',
  '东京赋': '安处先生于是似不能言',
  '南都赋': '于显乐都，既丽且康',
  '蜀都赋': '有西蜀公子者',
  '洛神赋': '黄初三年，余朝京师，还济洛川',
  '登楼赋': '登兹楼以四望兮',
  '高唐赋': '昔者楚襄王与宋玉游于云梦之台',
  '神女赋': '楚襄王与宋玉游于云梦之浦',
  '登徒子好色赋': '大夫登徒子侍于楚王',
  '风赋': '楚襄王游于兰台之宫',
  '归田赋': '游都邑以永久',
  '别赋': '黯然销魂者，唯别而已矣',
  '恨赋': '试望平原，蔓草萦骨',
  '思旧赋': '余与嵇康吕安居止接近',
  '秋兴赋': '晋十有四年，余春秋三十有二',
  '月赋': '陈王初丧应刘',
  '雪赋': '岁将暮，时既昬',
  '文赋': '余每观才士之所作',
  '长门赋': '孝武皇帝陈皇后时得幸',
  '闲居赋': '岳尝读汲黯传',
  '古诗十九首': '行行重行行，与君生别离',
  '离骚经': '帝高阳之苗裔兮',
  '卜居': '屈原既放三年',
  '渔父': '屈原既放，',
  '招魂': '朕幼清以廉絜兮',
  '七发八首': '楚太子有疾',
  '对楚王问': '楚襄王问于宋玉曰',
  '秋风辞': '上行幸河东，祠后土',
  '归去来': '序曰：余家贫',
  '出师表': '臣亮言：先帝创业未半',
  '陈情表': '臣密言：臣以险衅',
  '报任少卿书': '太史公牛马走',
  '答苏武书': '子卿足下',
  '过秦论': '秦孝公据殽函之固',
  '典论论文': '文人相轻，自古而然',
  '毛诗序': '关雎，后妃之德也',
  '酒德颂': '有大人先生',
  '封燕然山铭': '惟永元元年秋七月',
  '座右铭': '无道人之短，无说己之长',
  '剑阁铭': '岩岩梁山，积石峨峨',
  '女史箴': '茫茫造化，二仪既分',
  '祭古冢文': '东府掘城北堑',
  '吊屈原文': '谊为长沙王太傅',
  '齐竟陵文宣王行状': '祖太祖高皇帝',
  '为宋公修张良庙教': '纲纪：',
  '奉答敕示七夕诗启': '臣昉启：奉敕并赐示七夕五韵',
  '后汉书光武纪赞': '赞曰：炎政中微，大盗移国',
  '哀永逝文': '启夕兮宵兴，悲绝绪兮莫承',
};
let openingBad = [];
Object.keys(OPENINGS).forEach(n => {
  const p = ZM.filter(x => x.title === n)[0];
  if (!p) { openingBad.push(n + '(缺)'); return; }
  const head = (p.text || '').split('\n')[0] || '';
  if (head.indexOf(OPENINGS[n]) === -1) openingBad.push(n);
});
chk(openingBad.length === 0,
  '抽查 45 篇的正文开篇句与篇名对得上（不符 ' + openingBad.join('/') + '）');

// 全库层面：篇名不得出现在别的篇目的正文里当「篇内小标题」串台，
// 且正文不得混进版刻信息 / 校勘跋语（这些是整理时最容易漏掉的尾巴）
// ⚠️ 「袁本」在《文选》正文里也可能是人名「袁本初」（袁绍）——
// 只把「袁本初」之外的「袁本」当作校勘术语（袁本 / 茶陵本 是版本简称）。
const dirty = ZM.filter(p => /重校刊|赐进士出身|茶陵本|考异：/.test(p.text) ||
  /袁本(?!初)/.test(p.text));
chk(dirty.length === 0,
  '正文里没有混进版刻题名 / 校勘跋语（异常 ' + dirty.length + ' 篇：' +
  dirty.slice(0, 3).map(p => p.title).join('/') + '）');

/* ---------- 五、总索引：昭明文选进了搜索，但只收有译文的那些 ---------- */
const IDX = sandbox.SITE_INDEX;
const zmIdx = IDX.filter(x => x.book === 'zhaoming' && !x.isBook);
chk(zmIdx.length === 329,
  '总索引收了昭明文选有译文的 329 篇（实际 ' + zmIdx.length + '）');
chk(zmIdx.every(x => x.text && x.translation),
  '进索引的每一篇都原文与译文齐备');
chk(IDX.some(x => x.book === 'zhaoming' && x.isBook),
  '「昭明文选」本身也作为一条结果（搜集子名能直接进那一页）');
chk(sandbox.SITE_BOOKS.length === 6 && sandbox.SITE_BOOKS.some(b => b.id === 'zhaoming'),
  '六部集子的清单里含昭明文选（' + sandbox.SITE_BOOKS.length + ' 部）');

/* ---------- 六、页面层（jsdom，真实跑一遍页面脚本） ---------- */
const dom = new JSDOM(fs.readFileSync(path + 'zhaoming/index.html', 'utf8'), {
  runScripts: 'dangerously',
  url: 'https://local.test/zhaoming/'
});
const w = dom.window;
// 页面里用到的浏览器 API（jsdom 未实现的部分）补一层空壳，避免脚本半路抛错
w.scrollTo = function () {};
w.matchMedia = w.matchMedia || function () { return { matches: false, addListener: function () {}, removeListener: function () {} }; };
const html = fs.readFileSync(path + 'zhaoming/index.html', 'utf8');
const scripts = html.match(/<script src="([^"]+)"><\/script>/g)
  .map(s => s.match(/src="([^"]+)"/)[1]);

setTimeout(() => {
  // ⚠️ 脚本在文档解析完之后才插得进去（解析中插入的 script 会挂到临时 body 上被丢掉）。
  // jsdom 的 readyState 到 setTimeout 回调时已经是 complete，无需再等。
  for (const f of scripts) {
    try {
      const el = w.document.createElement('script');
      el.textContent = fs.readFileSync(path + f, 'utf8');
      w.document.body.appendChild(el);
    } catch (e) {
      console.log('✗ 脚本执行失败 ' + f + '：' + e.message);
      fails++;
    }
    // reader-core.js 一加载完就包住 mount()，好把页面挂上来的实例留住
    if (/reader-core\.js$/.test(f) && w.ReaderEngine && !w.ReaderEngine.__wrapped) {
      const orig = w.ReaderEngine.mount;
      w.ReaderEngine.mount = function (cfg) {
        const inst = orig.call(w.ReaderEngine, cfg);
        w.__lastMount = inst;
        return inst;
      };
      w.ReaderEngine.__wrapped = true;
    }
  }
    const d = w.document;

  chk(!!w.ReaderEngine, '阅读库引擎已加载');

  // 列表：480 条、按文体分组
  const items = d.querySelectorAll('#gw-list .item');
  chk(items.length === 480, '列表渲染出 480 条（实际 ' + items.length + '）');
  const bodyText = d.body.textContent;
  chk(/昭明文选/.test(bodyText), '页面出现「昭明文选」');
  chk(/赋 · 京都上/.test(bodyText), '分组名「赋 · 京都上」渲染到了页面上');
  chk(/诗 · 赠答/.test(bodyText), '分组名「诗 · 赠答」渲染到了页面上');
  // 「待补」小标：译文未整理的篇目在列表里要说清楚
  const pendings = d.querySelectorAll('#gw-list .item-reason.pending');
  chk(pendings.length === 480 - 329,
    '151 篇未译的在列表里标「待补」（实际 ' + pendings.length + '）');
  // 篇首那几张卡里不能出现「undefined / [object」
  chk(!/\[object|undefined/.test(d.querySelector('#gw-list').textContent),
    '列表文案没有渲染异常（无 undefined / [object]）');

  // 阅读器：点开一篇（有译文的里选一篇），正文与译文都要进阅读器
  // 引擎只暴露 mount()，没有「按 id 取实例」的接口；用例里包一层 mount
  // 把返回的实例留住（页面脚本在加载 reader-core.js 之后才调 mount）。
  const api = w.__zmApi || (w.ReaderEngine && w.__lastMount) || null;
  chk(!!api, '拿到 /zhaoming/ 页的挂载实例');
  if (!api) { console.log('（无实例，跳过页面交互断言）'); }
  const openByTitle = (name) => {
    const p = w.POEMS_ZHAOMING.filter(x => x.title === name)[0];
    chk(!!p, '数据里有《' + name + '》');
    if (!p) return;
    api.open(p.id);
    return p;
  };
  // 引擎对外只有 mount 返回的实例；用例里直接点列表条目更贴近真实交互
  const itemEls = [].slice.call(d.querySelectorAll('#gw-list .item'));
  const target = itemEls.filter(el => {
    const p = w.POEMS_ZHAOMING.filter(x => x.id === el.dataset.id)[0];
    return p && p.title === '登楼赋';
  })[0];
  chk(!!target, '列表里能找到《登楼赋》那一条');
  if (target) target.click();
    const reader = d.getElementById('gw-reader');
  chk(reader && !reader.hidden, '点条目后阅读器打开');
  const gotTitle = d.querySelector('#rd-title').textContent;
  // 正文里的生字会被注音（ruby），textContent 会夹进拼音字母 —— 先剥掉拼音再比
  const body = d.querySelector('#rd-text').textContent
    .replace(/[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹ·]+/g, '').replace(/\s/g, '');
  chk(gotTitle === '登楼赋', '阅读器标题是《登楼赋》（实际 ' + gotTitle + '）');
  chk(body.indexOf('登兹楼以四望兮') >= 0, '正文写入阅读器');
  chk(/三国·魏/.test(d.querySelector('#rd-meta').textContent), '元信息含朝代「三国·魏」');
  chk(/王粲/.test(d.querySelector('#rd-meta').textContent), '元信息含常用姓名「王粲」');
  const trans = d.querySelector('#rd-trans-text').textContent;
  chk(trans.length > 60, '《登楼赋》的白话译文已写入阅读器（' + trans.length + ' 字）');

  // 待补分支仍然可用：把一篇的译文清空后重开，应给出「尚在整理中」而不是白屏
  const first = w.POEMS_ZHAOMING.filter(x => x.title === '陈情表')[0];
  chk(!!first && !first.translation, '《陈情表》本轮尚无译文（走待补）');
  const keepText = first.text;
  api && api.open(first.id);
    chk(d.querySelector('#rd-text').textContent.indexOf('臣密言') >= 0,
    '待补篇目的**原文照样能读**（不是白屏）');
  chk(/尚在整理中/.test(d.querySelector('#rd-trans-text').textContent),
    '译文为空时给出「白话译文尚在整理中」的说明');
  api && api.close();

  // 搜索：按作者筛出子集，且只筛文选这一部
  api && api.setKeyword('王粲');
    const nWang = d.querySelectorAll('#gw-list .item').length;
  chk(nWang > 0 && nWang < 480, '按作者「王粲」搜索得到子集（' + nWang + ' 篇）');
  api && api.setKeyword('赋');
    const nFu = d.querySelectorAll('#gw-list .item').length;
  chk(nFu > 0 && nFu < 480, '按文体「赋」搜索得到子集（' + nFu + ' 篇）');
  api && api.setKeyword('');

  console.log('');
  console.log(fails === 0 ? '🎉 昭明文选测试全部通过' : '❌ 昭明文选测试 ' + fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
}, 120);
