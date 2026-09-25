const fs = require('fs');
const vm = require('vm');
const path = __dirname + '/../';

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(path + 'data/text-master.js', 'utf8'), sandbox,
  { filename: 'text-master.js' });
['data/poems-classic.js', 'data/poems-guwen.js', 'data/poems-zhaoming.js', 'data/poems-yuanqu.js',
 'data/site-index.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path + f, 'utf8'), sandbox, { filename: f }));

function resolveZm(list) {
  return list.map(function (raw) {
    return sandbox.masterTextOf ? sandbox.masterTextOf(raw, 'zhaoming') : raw;
  });
}
const ZM = resolveZm(sandbox.POEMS_ZHAOMING);
chk(Array.isArray(ZM) && ZM.length === 480,
  '昭明文选目录六十卷共 480 篇（实际 ' + (ZM ? ZM.length : 'undefined') + '）');

const ids = new Set();
let dup = 0;
ZM.forEach(p => { if (ids.has(p.id)) dup++; ids.add(p.id); });
chk(dup === 0, '文选 id 无重复（重复 ' + dup + ' 个）');

chk(ZM.every(p => p.title && p.source && p.author),
  '每篇都有 标题/出处/作者');

const inferred = ZM.filter(p => p.author && p.author === p.authorName);
chk(inferred.length > 0, '存在「选本只题作者的字」的条目（' + inferred.length + ' 条）');
const stillFilled = inferred.filter(p => p.dynasty);
chk(stillFilled.length === 0,
  '题署只有「字」的条目，朝代一律留空（仍填着 ' + stillFilled.length + ' 条：' +
  stillFilled.slice(0, 3).map(p => p.title + '/' + p.dynasty).join('、') + '）');

const gushi = ZM.filter(p => p.title === '古诗十九首')[0];
chk(!!gushi && !gushi.dynasty,
  '《古诗十九首》的朝代已留空（Issue #69 点名的那一条，实际 ' + JSON.stringify(gushi && gushi.dynasty) + '）');

const KEEP = {
  '两都赋二首': '东汉', '洛神赋': '三国·魏', '登楼赋': '三国·魏',
  '歌': '西汉', '出师表': '三国·蜀',
};
const keepBad = Object.keys(KEEP).filter(n => {
  const p = ZM.filter(x => x.title === n && x.dynasty)[0];
  return !p || p.dynasty !== KEEP[n];
});
chk(keepBad.length === 0,
  '选本自带身份线索的条目，朝代照录（异常：' + keepBad.join('/') + '）');

const geSongs = ZM.filter(p => p.title === '歌');
chk(geSongs.length === 2 &&
  geSongs.filter(p => p.author === '荆卿')[0].dynasty === '' &&
  geSongs.filter(p => p.author === '汉高祖')[0].dynasty === '西汉',
  '同名的两首《歌》按题署分别处理（荆卿留空 / 汉高祖记西汉）');
chk(ZM.filter(p => p.dynasty).length === 335,
  '剩 335 条保留朝代（480 − 145），实际 ' + ZM.filter(p => p.dynasty).length);

const PLACEHOLDER = /^(未知|不详|待考|佚|—|-|N\/A)$/;
const ph = ZM.filter(p => p.dynasty && PLACEHOLDER.test(p.dynasty));
chk(ph.length === 0,
  '留空的朝代就是空串，没有拿「未知 / 不详」占位（异常 ' + ph.length + ' 条）');

chk(ZM.every(p => p.source === '《文选》' && p.selection === '《文选》'),
  '每篇的出处与所在选本都标《文选》');
chk(ZM.every(p => p.authorName),
  '每篇都给了常用姓名 authorName（作者题署多为字，如「班孟坚」）');
chk(ZM.every(p => p.gradeGroup && p.gradeGroup.length > 0),
  '每篇都归入某一文体分组（gradeGroup 形如「赋 · 京都上」「书」）');

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

const subs = ZM.filter(p => p.gradeGroup.indexOf(' · ') > 0);
chk(subs.length > 200, '赋 / 诗下的小类分组在案（' + subs.length + ' 篇带小类）');
['赋 · 京都上', '赋 · 游览', '赋 · 哀伤', '诗 · 赠答二', '诗 · 行旅上',
 '诗 · 杂诗上', '论 · 论一'].forEach(g => {
  chk(ZM.some(p => p.gradeGroup === g), '分组「' + g + '」存在');
});

const groups = sandbox.getZhaomingGroups();
chk(groups.length === 91, '按文体（含小类）聚合出 91 组（实际 ' + groups.length + '）');
chk(groups.reduce((n, g) => n + g.items.length, 0) === 480, '各组篇目合计 480');

const withText = ZM.filter(p => p.text);
const withTrans = ZM.filter(p => p.translation);
chk(withText.length === ZM.length,
  '480 篇原文全部收录（已收录 ' + withText.length + '）');
chk(withText.every(p => p.excerpt),
  '每一篇都给了列表用摘句（excerpt）');
chk(withTrans.length === ZM.length,
  '480 篇白话译文全部整理完成，列表里不再有「待补」（实际 ' + withTrans.length + '）');
// 与课内同篇的条目（正文收归主表后，译文随主条目）—— 主条目是课内的那一条，
// 译文来源自然跟着课内走；这一条例外由 works-map 登记，逐条列在这里。
const COURSE_LINKED = ['过秦论'];
const notPublicDomain = withTrans.filter(p =>
  p.translationSource !== 'public-domain' && COURSE_LINKED.indexOf(p.title) < 0);
chk(notPublicDomain.length === 0,
  '已译的每一篇都标了译文来源 public-domain（与课内同篇的 ' + COURSE_LINKED.join('、') +
  ' 除外；异常：' + notPublicDomain.slice(0, 5).map(p => p.title + '/' + p.translationSource).join('、') + '）');
chk(withTrans.every(p => p.text),
  '有译文的一定有原文（不会出现「有译无文」的半成品）');
chk(withTrans.length === sandbox.zhaomingDoneCount(),
  'zhaomingDoneCount() 与实际已译数一致（' + withTrans.length + '）');
chk(withText.length === sandbox.zhaomingTextCount(),
  'zhaomingTextCount() 与实际原文数一致（' + withText.length + '）');

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

const dirty = ZM.filter(p => /重校刊|赐进士出身|茶陵本|考异：/.test(p.text) ||
  /袁本(?!初)/.test(p.text));
chk(dirty.length === 0,
  '正文里没有混进版刻题名 / 校勘跋语（异常 ' + dirty.length + ' 篇：' +
  dirty.slice(0, 3).map(p => p.title).join('/') + '）');

const MD_IMG = /!\[[^\]]*\]\([^)]*\)/;
const svgRef = /\.svg/;
const fieldsOf = p => [
  ['title', p.title], ['excerpt', p.excerpt], ['text', p.text],
  ['translation', p.translation], ['source', p.source],
];
const dirtyFields = [];
ZM.forEach(p => fieldsOf(p).forEach(([k, v]) => {
  if (v == null) return;
  if (MD_IMG.test(v) || svgRef.test(v)) dirtyFields.push(p.title + '.' + k);
}));
chk(dirtyFields.length === 0,
  '正文 / 译文 / 摘句里没有 markdown 图片语法，也没有 .svg 路径残留（异常 ' +
  dirtyFields.length + ' 处：' + dirtyFields.slice(0, 3).join('/') + '）');

const astralInCorpus = new Set();
ZM.forEach(p => {
  const all = [p.text, p.translation, p.excerpt].filter(Boolean).join('');
  for (const ch of all) {
    if (ch.codePointAt(0) >= 0x20000 && ch.codePointAt(0) <= 0x2FA1F) astralInCorpus.add(ch);
  }
});
chk(astralInCorpus.size >= 150,
  '扩展区生僻字原样保留在正文里（' + astralInCorpus.size + ' 个不同字，不少于 150）');

const zhaoYin = ZM.filter(p => p.title === '招隐士').map(p => p.text).join('');
chk(/林木茇\u{29A12}/u.test(zhaoYin),
  '《招隐士》「林木茇𩨒」的𩨒回到正文里了（摘句里也曾被截成「林木茇![」）');
const ziXu = ZM.filter(p => /子虚赋|上林赋/.test(p.title)).map(p => [p.text, p.translation].join('')).join('');
chk(/[\u{20000}-\u{2FA1F}]/u.test(ziXu),
  '《子虚赋》《上林赋》一类鸟兽名篇的扩展区生僻字在位');

chk(ZM.every(p => !/[!\[(]$/.test(String(p.excerpt || '').trim())),
  '摘句不是被截断的半截字符串');

const IDX = sandbox.SITE_INDEX;
const zmIdx = IDX.filter(x => x.book === 'zhaoming' && !x.isBook);
chk(zmIdx.length === 480,
  '总索引收了昭明文选全部 480 篇（实际 ' + zmIdx.length + '）');
chk(zmIdx.every(x => x.text && x.translation),
  '进索引的每一篇都原文与译文齐备');
chk(IDX.some(x => x.book === 'zhaoming' && x.isBook),
  '「昭明文选」本身也作为一条结果（搜集子名能直接进那一页）');
chk(sandbox.SITE_BOOKS.length === 9 && sandbox.SITE_BOOKS.some(b => b.id === 'zhaoming'),
  '九部集子的清单里含昭明文选（' + sandbox.SITE_BOOKS.length + ' 部）');

// ---------------------------------------------------------------------------
// Issue #278：这一层的**页面层**（jsdom 起页面、挂脚本、渲染分组、点开详情、
// 搜索框敲字）整段删除 —— 那是界面测试。留下的是数据层：篇目数量 / id / 字段 /
// 分组口径 / 总索引收录，以及页面脚本顺序这一类**功能接线**的口径。
// ---------------------------------------------------------------------------

console.log('');
console.log(fails ? '❌ ' + fails + ' 项失败' : '🎉 zhaoming测试全部通过');
process.exit(fails ? 1 : 0);
