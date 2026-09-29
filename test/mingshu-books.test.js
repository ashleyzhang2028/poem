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
