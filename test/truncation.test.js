/* ==========================================================================
   正文不许被截断（Issue #243 / #517）
   --------------------------------------------------------------------------
   ⚠️ 这一层在 Issue #278「只留功能验证、界面层整层删除」时被一并删掉 ——
   但它**不是界面测试**：整份文件只读数据、一条 DOM 都不碰。而它守的那件事
   在 Issue #517 又踩了一次：《守株待兔》《买椟还珠》《画蛇添足》《司马光》
   《程门立雪》在库里存的是**节选 / 半篇**（正文到「而身为宋国笑」就断了、
   《司马光》只有砸瓮那一句），用户要的是全篇。补回时只留数据层，
   页面段（jsdom 起小古文页）不恢复 —— 那一条确实是界面测试。
   --------------------------------------------------------------------------
   用户 2026-09-19 报：《滕王阁序》正文里夹着一串「……」，中段大段文字不见了，
   译文也跟着少译。查下来这不是显示问题，是**数据本身就只录了残篇** ——
   初高中一部长篇（《滕王阁序》《赤壁赋》《师说》《六国论》……）当初录入时
   只填了开头几段 + 中间几句 + 结尾，中间用「……」顶掉，译文同步少译。

   守两层：
     1. **课内 261（现 251）首 + 七部集子的正文 / 译文里，除个别「真的省略号」
        外，一律不许出现「……」**。真的省略号逐个列在 ALLOW 里（《我爱这土地》
        「无比温柔的黎明……」是艾青原诗的标点，不是截断）。
     2. 同一篇作品若在课内与集子里都出现，**课内那一条必须是完整正文**：
        要么内联，要么按主表 textRef 取回 —— 取回后不为空、且不含「……」。
   ========================================================================== */
const fs = require('fs');
const vm = require('vm');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const FILES = [
  'data/poems-1.js', 'data/poems-2.js', 'data/poems-3.js', 'data/poems-4.js',
  'data/poems-5.js', 'data/poems-6.js', 'data/poems-7.js', 'data/poems-8.js',
  'data/poems-9.js', 'data/poems-10.js', 'data/poems-11.js', 'data/poems-12.js',
  'data/poems-classic.js', 'data/poems-tangshi.js', 'data/poems-songci.js',
  'data/poems-guwen.js', 'data/poems-zhaoming.js', 'data/poems-yuanqu.js'
];
const VARS = [
  'POEMS_1', 'POEMS_2', 'POEMS_3', 'POEMS_4', 'POEMS_5', 'POEMS_6',
  'POEMS_7', 'POEMS_8', 'POEMS_9', 'POEMS_10', 'POEMS_11', 'POEMS_12',
  'POEMS_CLASSIC', 'POEMS_TANGSHI', 'POEMS_SONGCI', 'POEMS_GUWEN',
  'POEMS_ZHAOMING', 'POEMS_YUANQU', 'POEMS_YUEFU', 'POEMS_JINXIANDAI'
];

const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
['data/text-master.js'].concat(FILES).forEach(f =>
  vm.runInContext(fs.readFileSync(f, 'utf8'), sandbox, { filename: f }));

// 「……」是原诗标点、不是截断的例外（逐条写清理由）
const ALLOW = {
  'poems-cz9-02': '《我爱这土地》「无比温柔的黎明……」「我对这土地爱得深沉……」——艾青原作的省略号'
};

const EL = '\u2026\u2026';
const offenders = [];
VARS.forEach(v => {
  (sandbox[v] || []).forEach(p => {
    if (!p || !p.id) return;
    if (ALLOW['poems-' + p.id]) return;
    const t = p.text || '';
    const tr = p.translation || '';
    if (t.indexOf(EL) >= 0 || tr.indexOf(EL) >= 0) {
      offenders.push('poems-' + p.id + '（' + p.title + '）' +
        (t.indexOf(EL) >= 0 ? '[正文]' : '') + (tr.indexOf(EL) >= 0 ? '[译文]' : ''));
    }
  });
});
chk(offenders.length === 0,
  '全部课内 / 集子正文与译文里没有残留的「……」截断标记（残留：' +
  (offenders.slice(0, 10).join('、') || '无') + '）');

// 例外表本身要对得上：ALLOW 里点名的条目确实还含「……」（不然该删掉这一条）
const allowKey = Object.keys(ALLOW)[0];
const allowEntry = VARS.map(v => sandbox[v] || []).reduce((a, b) => a.concat(b), [])
  .filter(p => p && ('poems-' + p.id) === allowKey)[0];
chk(!!allowEntry && (allowEntry.text || '').indexOf(EL) >= 0,
  '例外表里点名的条目确实含「……」（' + allowKey + '，否则应清掉这条例外）');

// 课内条目取回主表正文后不许为空、也不许含「……」
const POEMS_ALL = [];
for (let i = 1; i <= 12; i++) {
  (sandbox['POEMS_' + i] || []).forEach(raw => {
    const p = sandbox.masterTextOf ? sandbox.masterTextOf(raw, 'poems') : raw;
    POEMS_ALL.push(p);
  });
}
const empty = POEMS_ALL.filter(p => !p.text || !p.text.length);
chk(empty.length === 0,
  '课内每一条取回正文后都非空（空壳：' + empty.map(p => p.id).join('、') || '无' + '）');
const stillEl = POEMS_ALL.filter(p => !ALLOW['poems-' + p.id] && (p.text || '').indexOf(EL) >= 0);
chk(stillEl.length === 0,
  '课内每一条取回后都不含「……」截断（残留：' +
  (stillEl.slice(0, 8).map(p => p.id + ' ' + p.title).join('、') || '无') + '）');

// 译文与正文同步：正文完整了，译文也该完整
const noTrans = POEMS_ALL.filter(p => !p.translation || !p.translation.length);
chk(noTrans.length === 0,
  '课内每一条都有译文（缺译文：' + (noTrans.slice(0, 8).map(p => p.id).join('、') || '无') + '）');

/* ---------------------------------------------------------------------------
   Issue #517：壳里的正文不许再是「半篇」。
   --------------------------------------------------------------------------
   用户 2026-10-08 的原话：「所有小古文中，如果有些只取了部分，而库中是全篇，
   则取全篇。」「半篇」没有机器判据（哪句算完只有文献知道），所以这里只钉
   **被点名补全的那几篇**：它们必须含各自**只在全篇里才出现**的那一句。 */
(function () {
  const FULL = [
    ['gw-282', '守株待兔', '皆守株之类也', '《韩非子》全篇末句'],
    ['gw-281', '司马光', '光生七岁', '《宋史》传文前半'],
    ['gw-286', '程门立雪', '吾道南矣', '《宋史·杨时传》前半'],
    ['gw-285', '心术', '则力有余矣', '苏洵《心术》全篇末句'],
    ['gw-277', '牛郎织女', '许一年一度相会', '全篇末句'],
    ['gw-278', '郑板桥教子', '明理作个好人', '《潍县署中与舍弟墨第二书》末句'],
    ['gw-279', '冠必正', '邪僻事，绝勿问', '《弟子规·谨》全章末句'],
    ['gw-280', '训学斋规', '眼口岂不到乎', '《训学斋规》全篇末句'],
    ['gw-283', '买椟还珠', '善鬻珠也', '《韩非子》全篇末句'],
    ['gw-284', '画蛇添足', '终亡其酒', '《战国策》全篇末句']
  ];
  const byId = {};
  (sandbox.POEMS_CLASSIC || []).forEach(function (p) { byId[p.id] = p; });
  const bad = [];
  FULL.forEach(function (row) {
    const p = byId[row[0]];
    if (!p) { bad.push(row[0] + ' 不在《古文》集里'); return; }
    const t = sandbox.masterTextOf ? sandbox.masterTextOf(p, 'classic') : p;
    if (!t.text || t.text.indexOf(row[2]) < 0) {
      bad.push(row[1] + '（' + row[0] + '）里没有「' + row[2] + '」—— ' + row[3]);
    }
  });
  chk(bad.length === 0,
    'Issue #517 点名补全的 10 篇，正文都是全篇而不是节选（异常：' +
    (bad.slice(0, 4).join('；') || '无') + '）');
})();

console.log('');
if (fails) { console.log('❌ 正文截断守卫测试 ' + fails + ' 项失败'); process.exit(1); }
console.log('🎉 正文截断守卫测试全部通过');
