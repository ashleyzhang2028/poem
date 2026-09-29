/* ==========================================================================
   名著导读 · 书目表守卫（Issue #381 第二轮）
   --------------------------------------------------------------------------
   这一份守的是 scripts/data/mingshu-books.js —— 那张 1614 部的书目表。
   它不是站点数据（列表页读的是 data/poems-mingshu.js，只收素材就绪的那批），
   但它是「总量」这个指标的落点，所以要独立守：

     · 数量：国内 ≥190（上一轮 19 部的 10 倍）、世界 ≥300（用户原话）
     · 无重书：一部书只能出现一次（换译名重复收录要被抓出来）
     · id 号段：上一轮那 36 部沿用旧号，新书从 ms-37 起续编，不许重号
     · 字段齐全：每行都有书名 / 作者 / 国别·时代 / 摘句
     · 分组：七组一个不少，且每组都非空
     · 覆盖：中小学必读那批必须都在（点名抽查）
   ========================================================================== */
const BOOKS_DEF = require('../scripts/data/mingshu-books.js');
const GROUPS = BOOKS_DEF.GROUPS;
const LEGACY = BOOKS_DEF.LEGACY || [];

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const GROUP_NAMES = [
  '中国古典小说', '中国现代小说', '中国当代小说',
  '中国现代散文', '中国现当代诗歌', '中国现代戏剧', '外国文学'
];

chk(GROUPS.length === GROUP_NAMES.length, '书目表恰有七组（实际 ' + GROUPS.length + '）');
GROUP_NAMES.forEach(g => {
  chk(GROUPS.some(p => p[0] === g), '书目表里有分组：' + g);
});

const rows = [];
GROUPS.forEach(pair => pair[1].forEach(r => rows.push({ group: pair[0], row: r })));

let cn = 0, world = 0;
rows.forEach(x => { if (x.group === '外国文学') world++; else cn++; });

chk(cn >= 190, '国内名著不少于 190 部（上一轮 19 部的 10 倍；实际 ' + cn + '）');
chk(world >= 300, '世界名著不少于 300 部（用户原话；实际 ' + world + '）');

let bad = [];
rows.forEach(x => {
  const r = x.row;
  if (!Array.isArray(r) || r.length < 4) { bad.push(x.group + ' 行字段不足'); return; }
  ['书名', '作者', '国别 / 时代', '摘句'].forEach((label, i) => {
    if (!r[i] || !String(r[i]).trim()) bad.push(x.group + ' · ' + (r[0] || '?') + ' 缺' + label);
  });
});
chk(bad.length === 0, '书目表每行都有书名 / 作者 / 国别·时代 / 摘句（异常：' +
  (bad.slice(0, 5).join('、') || '无') + '）');

const seen = {};
const dup = [];
rows.forEach(x => {
  const t = x.row[0];
  if (seen[t]) dup.push(x.group + ' · ' + t); else seen[t] = true;
});
chk(dup.length === 0, '没有一部书被收两次（重复：' + (dup.slice(0, 5).join('、') || '无') + '）');

/* 国内外禁书一律不收（Issue #381 · 用户原话「如果含有国内外禁书的，一律
   删除」）。名单连同查禁来由记在 scripts/data/mingshu-corpus.js 的 BANNED；
   这一条把「书目表」与「素材库」两处一起钉住：谁把它们加回来，当场点名。 */
const BANNED = require('../scripts/data/mingshu-corpus.js').BANNED || [];
const bannedInList = BANNED.filter(t => seen[t]);
chk(bannedInList.length === 0,
  '国内外禁书一部都不在书目表里（在册：' + (bannedInList.join('、') || '无') + '）');
const CORPUS = require('../scripts/data/mingshu-corpus.js').CORPUS;
const bannedInCorpus = BANNED.filter(t => CORPUS[t]);
chk(bannedInCorpus.length === 0,
  '禁书的素材也已剔除（还在：' + (bannedInCorpus.join('、') || '无') + '）');
chk(BANNED.length === 9, '禁书名单是 9 部（实际 ' + BANNED.length + '）');

chk(LEGACY.length === 36, '上一轮那 36 部的名单在册（实际 ' + LEGACY.length + ' 部）');
const legacyMissing = LEGACY.filter(t => !seen[t]);
chk(legacyMissing.length === 0,
  '上一轮的 36 部在新书目表里一部没丢（缺：' + (legacyMissing.join('、') || '无') + '）');

/* id 号段：旧 36 部沿用 ms-01…ms-36，新书从 ms-37 起，不许重号 */
const idOf = {};
LEGACY.forEach((t, i) => { idOf[t] = 'ms-' + String(i + 1).padStart(2, '0'); });
let auto = LEGACY.length + 1;
rows.forEach(x => {
  if (!idOf[x.row[0]]) idOf[x.row[0]] = 'ms-' + String(auto++).padStart(2, '0');
});
const idSeen = {};
const idDup = [];
Object.keys(idOf).forEach(t => {
  const id = idOf[t];
  if (idSeen[id]) idDup.push(id + '（' + idSeen[id] + ' / ' + t + '）'); else idSeen[id] = t;
});
chk(idDup.length === 0, 'id 号段没有重号（冲突：' + (idDup.slice(0, 5).join('、') || '无') + '）');
chk(Object.keys(idOf).length === rows.length,
  '每一部书都分到了 id（书 ' + rows.length + ' 部 / id ' + Object.keys(idOf).length + ' 个）');

/* Issue #381 第十一轮：用户点名先补完的 22 部中国古典小说。
   用户原话先列了 22 个书名（《三国演义》…《孽海花》），再说「然后按你的
   计划继续补充」—— 前六部（四大名著 + 儒林外史 + 聊斋志异）上一轮已在册，
   其余十六部这一轮补进书目表，古典小说组由 6 部到 22 部。
   这一条守的是「这 22 个书名以后不许再丢」。 */
const CLASSIC_22 = [
  '三国演义', '水浒传', '西游记', '红楼梦', '儒林外史', '封神演义',
  '东周列国志', '隋唐演义', '镜花缘', '三侠五义', '说岳全传', '聊斋志异',
  '世说新语', '喻世明言', '警世通言', '醒世恒言', '初刻拍案惊奇',
  '二刻拍案惊奇', '官场现形记', '二十年目睹之怪现状', '老残游记', '孽海花'
];
const c22missing = CLASSIC_22.filter(t => !seen[t]);
chk(c22missing.length === 0,
  '用户点名的 22 部古典小说都在书目表里（缺：' + (c22missing.join('、') || '无') + '）');
const classicRows = rows.filter(x => x.group === '中国古典小说').map(x => x.row[0]);
chk(classicRows.length >= 22,
  '「中国古典小说」组已收满 22 部（实际 ' + classicRows.length + '）');

/* 中小学必读 / 常见必读的点名抽查 */
const MUST = [
  '西游记', '三国演义', '水浒传', '红楼梦', '朝花夕拾', '骆驼祥子', '城南旧事',
  '格列佛游记', '鲁滨逊漂流记', '汤姆·索亚历险记', '钢铁是怎样炼成的',
  '海底两万里', '昆虫记', '简·爱', '老人与海', '安徒生童话', '格林童话',
  '爱的教育', '小王子', '童年', '在人间', '我的大学', '名人传', '夏洛的网',
  '绿山墙的安妮', '八十天环游地球', '格列佛游记', '雾都孤儿', '双城记',
  '巴黎圣母院', '悲惨世界', '战争与和平', '安娜·卡列尼娜', '复活',
  '大卫·科波菲尔', '呼啸山庄', '傲慢与偏见', '哈姆雷特', '堂·吉诃德',
  '一千零一夜', '伊索寓言', '希腊神话故事', '木偶奇遇记', '金银岛',
  '柳林风声', '绿野仙踪', '秘密花园', '小妇人', '彼得·潘', '爱丽丝漫游奇境',
  '森林报', '假如给我三天光明'
];
const absent = MUST.filter(t => !seen[t]);
chk(absent.length === 0,
  '中小学必读那一批（' + MUST.length + ' 部点名）都在册（缺：' + (absent.join('、') || '无') + '）');

/* id 黏住不动：往书目表「中间」插书，不许让它后面已发号的书改号。
   —— Issue #381 第十一轮真踩过这个坑：往「中国古典小说」组里插了 16 部，
   原来沿着书目表走一遍发号的写法，把 `坟` 从 ms-211 挪成了 ms-226、
   `匆匆` 从 ms-221 挪成了 ms-237。列表页读壳、正文按 textRef 读主表，
   两边一起动，页面上看不出异常，但已读记录与外部链接会指到别人头上。
   这条断言把「现有壳文件里已经发出去的号」钉住：跑完 build 脚本，
   壳里每一条老书的号必须与底册相同。（判据取自 git 里那份壳，见下方
   fixtures —— 这里只钉一批在前几轮就已经发过号、且以后不会再改的书。） */
const STICKY_IDS = {
  '西游记': 'ms-01', '三国演义': 'ms-02', '水浒传': 'ms-03', '红楼梦': 'ms-04',
  '儒林外史': 'ms-05', '聊斋志异': 'ms-06', '骆驼祥子': 'ms-07', '家': 'ms-08',
  '呐喊': 'ms-09', '朝花夕拾': 'ms-10', '雷雨': 'ms-11', '围城': 'ms-12',
  '边城': 'ms-13', '城南旧事': 'ms-14', '活着': 'ms-15', '平凡的世界': 'ms-16',
  '红岩': 'ms-17', '艾青诗选': 'ms-18', '昆虫记': 'ms-24', '彷徨': 'ms-37',
  '故事新编': 'ms-38', '四世同堂': 'ms-39', '月牙儿': 'ms-40', '猫城记': 'ms-41',
  '二马': 'ms-42', '春': 'ms-43', '秋': 'ms-44', '子夜': 'ms-46',
  '林家铺子': 'ms-47', '春蚕': 'ms-48', '腐蚀': 'ms-49', '长河': 'ms-50',
  '湘行散记': 'ms-51', '呼兰河传': 'ms-52', '生死场': 'ms-53', '小城三月': 'ms-54',
  '沉沦': 'ms-55', '春风沉醉的晚上': 'ms-56', '故都的秋': 'ms-57',
  '野草': 'ms-210', '坟': 'ms-211', '华盖集': 'ms-212', '且介亭杂文': 'ms-213',
  '两地书': 'ms-214', '背影': 'ms-219', '荷塘月色': 'ms-220', '匆匆': 'ms-221'
};
const shellSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'data/poems-mingshu.js'), 'utf8');
const shellIdOf = {};
shellSrc.split('\n  },').forEach(chunk => {
  const t = chunk.match(/title:\s*"((?:[^"\\]|\\.)*)"/);
  const i = chunk.match(/\bid:\s*"(ms-\d+)"/);
  if (t && i) shellIdOf[JSON.parse('"' + t[1] + '"')] = i[1];
});
const moved = Object.keys(STICKY_IDS).filter(t => shellIdOf[t] && shellIdOf[t] !== STICKY_IDS[t]);
chk(moved.length === 0,
  '前几轮已发号的书，id 一个也没挪（挪了：' +
  (moved.map(t => t + ' ' + STICKY_IDS[t] + '→' + shellIdOf[t]).join('、') || '无') + '）');
/* 书目表尺寸：上一轮精简到 816 部；Issue #381「禁书剔除」删去 9 部
   （国内 8 + 国外 1，见 BANNED），故底数为 807。这一条只钉「不缩水」。 */
chk(classicRows.length === 22 && rows.length >= 807,
  '书目表规模不缩水（数量 ' + rows.length + '，底册 ' + Object.keys(STICKY_IDS).length + ' 条全部对得上）');

/* 四部谴责小说与五部话本集都要在册点名：
   《官场现形记》《二十年目睹之怪现状》《老残游记》《孽海花》是晚清四大
   谴责小说，三言二拍是白话短篇小说的两大源头 —— 这几部是这一轮新开的
   「演义 / 话本 / 笔记 / 晚清谴责」四片里的骨干，单独点名守一道。 */
const NEW_CLASSIC = ['封神演义', '东周列国志', '隋唐演义', '镜花缘', '三侠五义',
  '说岳全传', '世说新语', '官场现形记', '二十年目睹之怪现状', '老残游记', '孽海花',
  '喻世明言', '警世通言', '醒世恒言', '初刻拍案惊奇', '二刻拍案惊奇'];
const ncMissing = NEW_CLASSIC.filter(t => !seen[t]);
chk(ncMissing.length === 0,
  '这一轮新补的 16 部（演义 / 话本 / 笔记 / 晚清谴责）都在册（缺：' +
  (ncMissing.join('、') || '无') + '）');

/* 世界名著的地区覆盖面：不能只有英美法俄 */
const REGIONS = [
  ['英国', /英国/], ['美国', /美国/], ['法国', /法国/], ['德国', /德国/],
  ['奥地利', /奥地利/], ['俄国', /俄国/], ['苏联', /苏联/], ['意大利', /意大利/],
  ['西班牙', /西班牙/], ['日本', /日本/], ['印度', /印度/], ['阿拉伯', /阿拉伯/],
  ['丹麦', /丹麦/], ['瑞典', /瑞典/], ['挪威', /挪威/], ['波兰', /波兰/],
  ['捷克', /捷克/], ['古希腊', /古希腊/], ['古罗马', /古罗马/], ['加拿大', /加拿大/],
  ['爱尔兰', /爱尔兰/], ['以色列', /以色列/], ['智利', /智利/], ['阿根廷', /阿根廷/],
  ['葡萄牙', /葡萄牙/], ['芬兰', /芬兰/], ['冰岛', /冰岛/], ['朝鲜', /朝鲜/]
];
const worldRows = rows.filter(x => x.group === '外国文学').map(x => x.row);
const noRegion = REGIONS.filter(([n, re]) => !worldRows.some(r => re.test(r[2]))).map(([n]) => n);
chk(noRegion.length === 0,
  '世界名著覆盖 ' + REGIONS.length + ' 个文学传统（缺：' + (noRegion.join('、') || '无') + '）');

console.log('');
console.log('书目表：国内 ' + cn + ' 部 · 世界 ' + world + ' 部 · 合计 ' + rows.length + ' 部');
GROUP_NAMES.forEach(g => {
  const n = rows.filter(x => x.group === g).length;
  console.log('  ' + g + ' ' + n);
});
console.log('');
console.log(fails ? '❌ ' + fails + ' 项失败' : '🎉 名著导读书目表全部通过');
process.exit(fails ? 1 : 0);
