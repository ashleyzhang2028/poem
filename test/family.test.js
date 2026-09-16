/**
 * 家庭子档案专项测试（3 期 P1 · `profile.family`）
 * ==========================================================================
 * 用户原话（Issue #159）：「子档案 Max 180 个」。
 *
 * 这一件问的其实是**同一台设备上几套各自独立的背诵进度**，不是「多个昵称随便切」。
 * 所以这一层守五件事：
 *
 *   一、名册：增 / 改名 / 删 / 切换 / 上限，全部拦在**数据层**
 *   二、老用户零感知：`poem_profile_v1` 那份昵称 + 印被认领成第一个子档案，
 *       且**进度 / 设置 / 已读也一并搬过去**（不然升级后进度看着就空了）
 *   三、分家的边界：进度 / 账号域设置 / 已读**跟着孩子走**，设备域**不跟**
 *       （字号是设备的：给小红调了字号，切回小明不该变回去）
 *   四、拼键只有一处（`Family.keyFor`），各处不许自己拼 `::` 后缀
 *   五、上限与内核同源：Free 1 / Pro 3 / **Max 180**（两端逐字对拍）
 *
 * 跑法：`node test/family.test.js`（纯 Node，不联网、不装依赖）
 */
const fs = require('fs');
const path = __dirname + '/../';
const nodePath = require('path');            // 上面那个 `path` 是仓库根前缀（沿用同目录其它测试的写法）
const read = f => fs.readFileSync(path + f, 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };
const eq = (a, b, m) => chk(a === b, m + '（实际 ' + JSON.stringify(a) + '）');

/* 内存存储替身：形状与 localStorage 一致（含 raw()，好让认领那一步扫得出键名） */
function mem(init) {
  const m = Object.assign({}, init || {});
  return {
    getItem: k => (Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: k => { delete m[k]; },
    raw: () => m
  };
}

/**
 * 在一个干净的 window 上装 Family + Avatar + ProgressStore（顺序与页面一致）。
 *
 * ⚠️ progress-store 是挂在 `window` 上的单例，所以每个用例都要**清一次 require 缓存**
 *    —— 与 `test/sync.test.js` 同款。不清的话第二个用例拿到的还是上一个的存储。
 */
function install() {
  global.window = global;
  ['family.js', 'avatar.js', 'progress-store.js'].forEach(f => {
    delete require.cache[require.resolve(path + 'js/' + f)];
  });
  global.Family = require(path + 'js/family.js');
  global.Avatar = require(path + 'js/avatar.js');
  require(path + 'js/progress-store.js');
  return { F: global.Family, A: global.Avatar, PS: global.ProgressStore };
}

/** 装一套：注入内存存储，返回 {b, F, A, PS} */
function sandbox(seed) {
  const b = mem(seed);
  const m = install();
  m.PS.useStore(b);
  return { b: b, F: m.F, A: m.A, PS: m.PS };
}

/* ==========================================================================
   一、名册：增 / 改名 / 删 / 切换 / 上限
   ========================================================================== */
console.log('=== 一、名册：增 / 改名 / 删 / 切换 / 上限 ===');
{
  const { F, b, PS } = sandbox();

  const d0 = F.ensureDetailed({ backing: b });
  eq(d0.created, 1, 'ensure() 名册为空时认领出第一个子档案');
  eq(F.count({ backing: b }), 1, '认领之后名册里正好一条');

  const e2 = F.ensureDetailed({ backing: b });
  eq(e2.created, 0, 'ensure() 幂等：第二次不再建（否则每开一次页面多一个孩子）');

  // 上限：拿不到 Entitlement 时不设限（宁可不判，也不误拦）
  eq(F.limit({ backing: b }), Infinity, '读不到 Entitlement 时不设限（与 collections 同一条兜底）');

  const E = t => ({ identity: () => ({ tier: t }) });
  eq(F.limit({ backing: b, E: E('free') }), 1, 'Free：1 个');
  eq(F.limit({ backing: b, E: E('pro') }), 3, 'Pro：3 个');
  eq(F.limit({ backing: b, E: E('max') }), 180, 'Max：**180 个**（用户 2026-09-17 裁决）');

  // Max 建到正好 180 就停
  let okCount = 0, limited = 0;
  for (let i = 0; i < 190; i++) {
    const r = F.create('k' + i, { backing: b, E: E('max') });
    if (r.ok) okCount++; else if (r.code === 'E_LIMIT') limited++;
  }
  eq(F.count({ backing: b }), 180, 'Max 正好停在 180 个');
  eq(okCount, 179, '除认领那一个之外又成功建了 179 个');
  eq(limited, 11, '越限的 11 次全部如实回 E_LIMIT（不静默丢掉）');

  const overflow = F.create('再多一个', { backing: b, E: E('max') });
  eq(overflow.ok, false, '越限时 ok:false');
  eq(overflow.limit, 180, '回执里带上是哪个上限拦的（limit）');
  eq(overflow.count, 180, '以及当时已经有多少个（count）——错因要说得清');
  chk(!Object.keys(b.raw()).some(k => /再多一个/.test(b.raw()[k])),
    '被拦的那一条**一个字节都没写盘**（不是「写进去再删掉」）');

  /* 改名：空名允许（与用户名同口径，界面回落「Ashley」）；不存在的 id 如实回 E_NOT_FOUND */
  const first = F.list({ backing: b })[0];
  eq(F.rename(first.id, '  小明  ', { backing: b }).ok, true, '改名成功（去首尾空白）');
  eq(F.current({ backing: b }).nickname, '小明', '改名落到那一条上');
  eq(F.rename(first.id, '', { backing: b }).ok, true, '空名允许（用户名那一栏同样允许留空）');
  eq(F.rename('f-不存在', 'x', { backing: b }).code, 'E_NOT_FOUND', '改一个不存在的 id：E_NOT_FOUND');

  /* 切换：不存在的 id **拒绝**（不回落到第一条——那是静默改行为） */
  const secondId = F.list({ backing: b })[1].id;
  eq(F.select(secondId, { backing: b }).ok, true, '切到第二条：成功');
  eq(F.currentId({ backing: b }), secondId, '当前选中跟着换');
  eq(F.select('f-不存在', { backing: b }).code, 'E_NOT_FOUND', '切到不存在的 id：E_NOT_FOUND');
  eq(F.currentId({ backing: b }), secondId, '被拒之后当前选中**没有**被改动');

}

/* ==========================================================================
   二、删：最后一个不许删，且不动那一份进度
   ========================================================================== */
console.log('\n=== 二、删：最后一个不许删，且不动进度数据 ===');
{
  const { F, PS, b } = sandbox();
  F.ensure({ backing: b });
  const one = F.list({ backing: b })[0];
  PS.set('p1', { level: 1, stage: 2 });

  eq(F.remove(one.id, { backing: b }).code, 'E_LAST', '最后一个子档案不许删（0 个档案没有意义）');
  eq(F.count({ backing: b }), 1, '被拒之后名册原样');

  const r2 = F.create('小红', { backing: b });
  F.remove(r2.profile.id, { backing: b });
  eq(F.count({ backing: b }), 1, '有两个时可以删掉一个');
  chk(!!PS.get('p1'), '删名册**不动进度数据**（误删还能当场看出来，连带清进度不可逆）');

  /* 删掉「当前」那一个 → 自动落到第一条，而不是留一个悬空的 at */
  F.create('小红', { backing: b }).ok && F.select(F.list({ backing: b })[1].id, { backing: b });
  const curId = F.currentId({ backing: b });
  F.remove(curId, { backing: b });
  chk(!!F.currentId({ backing: b }) && F.currentId({ backing: b }) !== curId,
    '删掉的正是当前那一个 → 当前选中落到剩下那一条（不留悬空 id）');
}

/* ==========================================================================
   三、老用户零感知：昵称 + 印 + **进度 / 设置 / 已读** 一并认领
   ========================================================================== */
console.log('\n=== 三、老用户零感知：老档案与老数据一并认领 ===');
{
  const b = mem({
    poem_profile_v1: JSON.stringify({ v: 1, nickname: '小明', avatar: { char: '月', ink: 'pine' } }),
    poem_recite_settings_v1: JSON.stringify({ grade: 4, term: 2, scope: 'all', dailyCount: 7, algo: 'sm2' }),
    poem_recite_progress_v1: JSON.stringify({ 'tangshi-ts-1': { level: 3, stage: 5 } }),
    poem_tangshi_read_v1: JSON.stringify({ 'tangshi-ts-1': true })
  });
  const m3 = install();
  const F = m3.F, PS = m3.PS;
  PS.useStore(b);

  // 认领前：还没有子档案 → 引擎读老键（0 期行为一字不动）
  eq(PS.childId(), '', '认领前没有子档案（引擎按 0 期老键读）');
  eq(PS.get('tangshi-ts-1').level, 3, '认领前进度照常读得到（老用户不受影响）');

  const d = F.ensureDetailed({ backing: b });
  eq(d.data.profiles[0].nickname, '小明', '昵称被认领进第一个子档案');
  eq(d.data.profiles[0].avatar.char, '月', '印（选的字）一并认领');
  eq(d.data.profiles[0].avatar.ink, 'pine', '印色一并认领');

  PS.useStore(b);
  eq(PS.childId(), d.data.profiles[0].id, '认领之后引擎认到了当前子档案');
  eq(PS.get('tangshi-ts-1').level, 3, '**进度被搬到新键上**（不然升级后看着就空了）');
  eq(PS.settings().grade, 4, '账号域设置跟着搬（年级 / 学期不丢）');
  eq(PS.settings().dailyCount, 7, '每日数量跟着搬');
  chk(!('poem_recite_progress_v1' in b.raw()), '老进度键搬完就删掉（不让它成为第二份真相）');
  chk(!('poem_recite_settings_v1' in b.raw()), '老设置键同理');
  chk(!('poem_tangshi_read_v1' in b.raw()), '已读键也搬走（读没读过是孩子自己的事）');
  chk(Object.keys(b.raw()).some(k => /^poem_tangshi_read_v1::/.test(k)), '已读键搬到了带子档案后缀的那把');

  /* 幂等：再认领一次不重复搬、也不把数据搬回去 */
  const keysAfter = Object.keys(b.raw()).slice().sort();
  F.ensure({ backing: b });
  eq(JSON.stringify(Object.keys(b.raw()).slice().sort()), JSON.stringify(keysAfter),
    '认领幂等：第二次不再动盘上任何一个键');

  /* 老档案为空时也要认领出一个（否则「新建」的那套上限判断没有起点） */
  const b2 = mem();
  PS.useStore(b2);
  const d2 = F.ensureDetailed({ backing: b2 });
  eq(d2.created, 1, '完全没有老数据时，也认领出一个空子档案');
  eq(d2.data.profiles[0].nickname, '', '认领出来的第一个昵称为空（界面回落「Ashley」）');
}

/* ==========================================================================
   四、分家的边界：进度 / 设置 / 已读跟着孩子，设备域不跟
   ========================================================================== */
console.log('\n=== 四、分家的边界：谁跟着孩子走，谁不跟 ===');
{
  const { F, PS, b } = sandbox();
  F.ensure({ backing: b });
  const a = F.list({ backing: b })[0].id;
  const rb = F.create('小红', { backing: b });
  const c = rb.profile.id;

  // 进度：各背各的
  F.select(a, { backing: b }); PS.set('p1', { level: 1 });
  F.select(c, { backing: b }); PS.set('p1', { level: 9 });
  F.select(a, { backing: b }); eq(PS.get('p1').level, 1, '切到小明：看到小明那份进度');
  F.select(c, { backing: b }); eq(PS.get('p1').level, 9, '切到小红：看到小红那份进度');

  // 账号域设置（年级 / 数量）：跟着分家
  F.select(a, { backing: b }); PS.saveSettings({ grade: 1, dailyCount: 5 });
  F.select(c, { backing: b }); PS.saveSettings({ grade: 3, dailyCount: 9 });
  F.select(a, { backing: b }); eq(PS.settings().grade, 1, '一年级的孩子：年级 = 1');
  F.select(c, { backing: b }); eq(PS.settings().grade, 3, '三年级的孩子：年级 = 3（同一台设备，各是各的）');

  // 已读：跟着分家
  F.select(a, { backing: b }); PS.setRead('poem_tangshi_read_v1', 'tangshi-ts-1', true);
  F.select(c, { backing: b }); eq(PS.readMap('poem_tangshi_read_v1')['tangshi-ts-1'], undefined,
    '已读跟着孩子走：小明读过的，小红那边没有');
  PS.setRead('poem_tangshi_read_v1', 'tangshi-ts-2', true);
  F.select(a, { backing: b }); eq(PS.readMap('poem_tangshi_read_v1')['tangshi-ts-2'], undefined,
    '反向也成立：小红读过的，小明那边没有');

  // 设备域：**不分家**（字号是设备的）
  F.select(a, { backing: b }); PS.setHelper(false);
  F.select(c, { backing: b }); eq(PS.helper(), 'off', '设备域的阅读辅助开关两孩子共用（同一台平板）');
  F.select(a, { backing: b }); eq(PS.helper(), 'off', '切回来还是那一个值（没被复制成两份）');

  // 判据本身
  eq(F.isPerChild('poem_recite_progress_v1'), true, 'isPerChild：进度域 → 分家');
  eq(F.isPerChild('poem_recite_settings_v1'), true, 'isPerChild：账号域设置 → 分家');
  eq(F.isPerChild('poem_device_prefs_v1'), false, 'isPerChild：设备域 → **不**分家');
  eq(F.isPerChild('poem_font_v1'), false, 'isPerChild：字号（设备域老键）→ 不分家');
  eq(F.isPerChild('poem_tangshi_read_v1'), true, 'isPerChild：集子已读 → 分家');
  eq(F.isPerChild('poem_whatever_new_v1'), true,
    '认不出的键按「分家」处理（安全的一侧：多开一份只是多占几 KB，混在一起是数据串了）');

  // 清空进度只清**当前这个孩子**那一条
  F.select(a, { backing: b });
  PS.clearProgress();
  eq(JSON.stringify(PS.all()), '{}', '清空进度：当前孩子那份空了');
  F.select(c, { backing: b });
  eq(PS.get('p1').level, 9, '**另一个孩子的进度一根毫毛都没动**（老 bug 换了个形状）');
}

/* ==========================================================================
   五、拼键只有一处；Family 缺席时退化成 0 期行为
   ========================================================================== */
console.log('\n=== 五、拼键只有一处；Family 缺席时退化 ===');
{
  const F = require(path + 'js/family.js');
  eq(F.keyFor('poem_recite_progress_v1', 'f-abc'), 'poem_recite_progress_v1::f-abc',
    'keyFor：拼法就是「原键::子档案 id」');
  eq(F.keyFor('poem_device_prefs_v1', 'f-abc'), 'poem_device_prefs_v1',
    'keyFor：设备域的键**原样返回**（不拼后缀）');
  eq(F.keyFor('poem_recite_progress_v1', ''), 'poem_recite_progress_v1',
    'keyFor：没有当前子档案时返回原键（0 期形状一字不动）');

  const km = F.keyMap({ backing: F.defaultBacking(), profileId: 'f-x' });
  eq(km.keys.progress, 'poem_recite_progress_v1::f-x', 'keyMap 给得出进度键');
  eq(km.keys.device, 'poem_device_prefs_v1', 'keyMap 里设备键不带后缀');

  /* 源码：拼 `::` 后缀的地方**必须逐一列出来**，不许悄悄多一处。
     ⚠️ 这条断言原先写「只有 family.js」。5.3 之后**多了一处**：
        `js/sync-store.js` 的记账表（`poem_sync_seen_v1`）——
        它**不在** `ProgressStore.KEYS` 里（那是同步层自己的簿记，不是六把域键之一），
        所以走不了 `Family.keyFor` 的转发，只能在那一层里显式拼一次。
        判据因此从「只有一个文件」改成「**就是这两个文件**」：
        名单是白名单，多一个文件就红一次 —— 那正是这条断言要守的
        （防的是「各处各拼一遍」，不是「一个字都不许拼」）。 */
  const files = fs.readdirSync(path + 'js').filter(f => /\.js$/.test(f));
  const splicers = files.filter(f => {
    const src = read('js/' + f).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    return /["']::["']|\+\s*["']::/.test(src) || /::\s*["']\s*\+/.test(src);
  });
  eq(splicers.sort().join(','), 'family.js,sync-store.js',
    'js/ 下拼 `::` 后缀的只有 family.js 与 sync-store.js 的记账表（多一处就红）');

  /* 有子档案时写的是带后缀那把键 / Family 缺席时按老键读 */
  const sb5 = sandbox();
  sb5.F.ensure({ backing: sb5.b });
  sb5.PS.set('p1', { level: 1 });
  const saved = sb5.b.raw()['poem_recite_progress_v1::' + sb5.F.currentId({ backing: sb5.b })];
  chk(!!saved, '有子档案时写的是带后缀那把键');
  chk(!('poem_recite_progress_v1' in sb5.b.raw()), '同一份数据不会同时落在两把键上（不做第二份真相）');

  /* Family 缺席：把 window.Family 摘掉，引擎必须**退回老键**而不是读空表 */
  const sb6 = sandbox();
  sb6.F.ensure({ backing: sb6.b });
  sb6.PS.set('p1', { level: 2 });
  const childKey = sb6.PS.childProgressKey();
  delete global.Family;
  sb6.PS.useStore(sb6.b);
  eq(sb6.PS.childId(), '', 'Family 缺席时 childId 给空串（退化成 0 期行为）');
  eq(sb6.PS.childProgressKey(), 'poem_recite_progress_v1', 'Family 缺席时读的是原键，不拼后缀');
  chk(childKey.indexOf('::') > 0, '（对照）有 Family 时那把键确实带后缀');
  install();
}

/* ==========================================================================
   六、上限与内核同源：Free 1 / Pro 3 / Max 180（两端逐字对拍）
   ========================================================================== */
console.log('\n=== 六、上限与内核同源 ===');
{
  const F = require(path + 'js/family.js');
  const E = require(path + 'js/entitlement.js');
  const cap = E.CAPS['profile.family'];
  chk(!!cap, '内核能力表里有 profile.family');
  eq(cap.minTier, 'pro', 'minTier = pro（Free 那一个不算「能力」，是保底）');
  eq(cap.login, true, '要求登录（层级要登录才拿得到）');
  /* Issue #163：名字里的括号摘掉了（「家庭子档案（Free 1 / Pro 3 / Max 180）」
     →「家庭档案」）—— 三档数字改由 **`quotas`** 承担（对比页在各列直接列出数字，
     不再把三个数字塞进功能名里撑宽那一列）。
     所以判据从「能力名里有没有这三个数」翻成「quotas 里的数与 family.js 同值」。 */
  eq(E.quotaFor(cap, 'free'), F.FREE_PROFILES, '内核 quotas.free 与 family.js 同值');
  eq(E.quotaFor(cap, 'pro'), F.PRO_PROFILES, '内核 quotas.pro 与 family.js 同值');
  eq(E.quotaFor(cap, 'max'), F.MAX_PROFILES, '内核 quotas.max 与 family.js 同值');
  eq(cap.name, '家庭档案', '能力名收成「家庭档案」（额度归 quotas，不写在名字里）');
  chk(!/（/.test(cap.name), '名字里不再带括号（那是三个数字的旧住处）');

  /* 服务端 featuresFor：max 是 pro 的超集，profile.family 只在 pro 那一档列一次 */
  const core = read('api/_lib/core.js');
  chk(/profile\.family/.test(core), '服务端 featuresFor 里有 profile.family');
  chk(!/profile\.family[^\]]*\]/.test(core.replace(/\/\*[\s\S]*?\*\//g, ' ')) ||
      /"profile\.family"/.test(core), '服务端键名与客户端逐字一致（写错就是「界面点亮、服务端 403」）');

  /* 上限拦在数据层：Family.create 自己判，不靠按钮 */
  eq(F.FREE_PROFILES, 1, 'Free 1 个：第一次自动认领的那一份永远放得下');
  eq(F.PRO_PROFILES, 3, 'Pro 3 个');
  eq(F.MAX_PROFILES, 180, 'Max 180 个');

  /* ⚠️ 拿不到内核时**不设限**（返回 Infinity，与 collections 同一条纪律）——
     否则一次加载顺序错误就是「本来有 3 个子档案的人突然只剩 1 个」。 */
  const memB = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  eq(F.limit({ E: null, backing: memB }), Infinity, '读不到内核时不设限（宁可不判，也不误拦）');
}

/* ==========================================================================
   七、源码扫描：设置页接上了，且上限不许写死在页面里
   ========================================================================== */
console.log('\n=== 七、设置页接线与收口 ===');
{
  const gen = read('settings/general/index.html');
  const setJs = read('js/settings.js');
  const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  chk(/id="family-panel"/.test(gen), '设置 · 通用里有子档案那一块（#family-panel）');
  chk(/<script src="\/js\/family\.js"><\/script>/.test(gen), '那一页加载了 js/family.js');
  const atF = gen.indexOf('<script src="/js/family.js"></script>');
  const atPS = gen.indexOf('<script src="/js/progress-store.js"></script>');
  chk(atF >= 0 && atPS >= 0 && atF < atPS,
    'js/family.js 排在 progress-store.js 之前（顺序反了不报错，只是永远读没有后缀的老键）');

  /* 设置页里 Family 是通过家族别名调用的（`const F = familyMod()`），
     所以判据写「`F.` 或 `Family.` 调到了那几个方法」—— 认名字不认写法。 */
  const FAM = '((?:Family|F)\\.)';
  chk(new RegExp(FAM + 'ensureDetailed\\(').test(setJs),
    '设置页先 ensure（认领老档案），再画名册');
  chk(new RegExp(FAM + 'limit\\(').test(setJs), '上限走 Family.limit()（页面不自己判层级）');
  chk(new RegExp(FAM + '(create|rename|remove|select)\\(').test(setJs),
    '增 / 改名 / 删 / 切换全走 Family 的接口');
  chk(/function familyMod\(\)/.test(setJs) && /window\.Family/.test(setJs),
    'Family 现取（脚本顺序不对 / 老缓存时不报错，只是那一块不画）');
  chk(!/tier\s*===\s*["'](pro|max)["']/.test(strip(setJs)),
    'js/settings.js 不自己写 tier === "pro" 这类判断（上限只有一个来源）');
  chk(!/["']::["']/.test(strip(setJs)),
    '设置页不自己拼子档案后缀（拼法只在 family.js 一处）');

  /* 切档必须**整页重画**：只重画那一块会留下「名字换了、年级还是上一个孩子的」 */
  chk(/function reloadAll\(/.test(setJs) && /renderControls\(\)[\s\S]{0,200}renderFamily\(\)/.test(setJs),
    '切档之后整页重画（年级 / 数量 / 进度 / 印 全都要跟着换）');

  /* 上限被拦时要说清「是上限拦的」 */
  chk(/E_LIMIT/.test(setJs), '越限时按 E_LIMIT 分开说话（不笼统说「建不了」）');

  /* 引擎那边：拼键只有一处，且 core 键名不被改 */
  const psSrc = read('js/progress-store.js');
  chk(/F\.keyFor\(key, pid\)/.test(psSrc), 'progress-store 的拼键走 Family.keyFor（不自己拼）');
  chk(/function kk\(key\)/.test(psSrc), '引擎只有一个 kk() 出口在拼键');
  /* ⚠️ 断言的是**语义**（只清进度那一把键），不是字面写法：
     `kk()` 只在 `raw` / `physKey` 这两个读写入口调用一次，
     调用点一律交**逻辑键** —— 在调用点再拼一次会写成双后缀键
     （`…_v1::f-x::f-x`），症状是「写了但读不到」（同步的 updatedAt 那条顶回来的）。 */
  chk(/clearProgress[\s\S]{0,200}drop\(KEYS\.progress\)/.test(psSrc),
    'clearProgress 只清**当前孩子**那一份（清的是逻辑键，后缀由读写入口统一拼）');
  chk(!/kk\(kk\(/.test(psSrc), '引擎里没有双拼（kk(kk(...))）—— 后缀只拼一次');
}

/* ==========================================================================
   七之一、每一张用到档案 / 进度的页面都加载了 js/family.js（且排在前面）
   --------------------------------------------------------------------------
   漏了这一步的症状**不报错**：引擎读的是「没有后缀」那把老键，于是
   「切换孩子后进度为空」。所以这里逐页核对，而不是靠人记得。
   ========================================================================== */
console.log('\n=== 七之一、每一张用到档案 / 进度的页面都加载了 js/family.js ===');
{
  const pages = [];
  (function walk(dir, rel) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'test' || e.name === 'scripts') return;
      const full = nodePath.join(dir, e.name);
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) return walk(full, r);
      if (e.name === 'index.html') pages.push(r);
    });
  })(path + '.', '');

  let withAvatar = 0, withPS = 0;
  pages.forEach(p => {
    const html = read(p);
    const hasAvatar = /js\/avatar\.js/.test(html);
    const hasPS = /js\/progress-store\.js/.test(html);
    if (!hasAvatar && !hasPS) return;
    if (hasAvatar) withAvatar++;
    if (hasPS) withPS++;
    chk(/js\/family\.js/.test(html), p + ' 加载了 js/family.js（否则切换孩子后看到的是空进度）');
    /* 顺序：family 必须排在 avatar 与 progress-store **之前** ——
       后两者都要问它「当前是谁」。顺序反了不报错，只是永远读老键。
       ⚠️ 只在 **`<script src>` 行**里找（注释里也会提到 js/family.js，
          拿整份 HTML 去 indexOf 会命中那段说明，判出来的位置是错的）。 */
    const at = s => {
      let hit = -1;
      html.split('\n').forEach((ln, i) => {
        if (hit >= 0 || ln.indexOf('<script') < 0) return;
        if (ln.indexOf('js/' + s + '.js') > -1) hit = i;
      });
      return hit;
    };
    chk(at('family') < at('avatar') || at('avatar') < 0,
      p + ' 里 js/family.js 排在 js/avatar.js 之前');
    chk(at('family') < at('progress-store') || at('progress-store') < 0,
      p + ' 里 js/family.js 排在 js/progress-store.js 之前');
  });
  chk(withAvatar >= 12, '至少 12 张页在画那枚印（实际 ' + withAvatar + ' 张）');
  chk(withPS >= 12, '至少 12 张页在读进度 / 设置（实际 ' + withPS + ' 张）');

  /* sw.js 预缓存里有 family.js，否则断网时它缺席 —— 而缺席的表现就是「读空进度」 */
  chk(/js\/family\.js/.test(read('sw.js')), 'sw.js 预缓存含 js/family.js（断网也要能读对那一份）');
}

/* ==========================================================================
   七之二、备份：名册跟着走，数据落到对的孩子名下
   ========================================================================== */
console.log('\n=== 七之二、备份：名册跟着走 ===');
{
  const { F, PS, b } = sandbox();
  F.ensure({ backing: b });
  F.create('小红', { backing: b });
  const ids = F.list({ backing: b }).map(p => p.id);
  F.select(ids[0], { backing: b }); PS.set('p1', { level: 1 });
  F.select(ids[1], { backing: b }); PS.set('p1', { level: 9 });

  const dump = JSON.parse(PS.exportJSON());
  chk(!!dump.family && dump.family.profiles.length === 2,
    '备份里带**整份名册**（不是只导当前那一个 —— 少写它的症状是「导入后另外两个孩子不见了」）');
  eq(dump.family.at, ids[1], '备份里记住「当前是哪一个」');
  eq(dump.progress.p1.level, 9, '备份里的进度是**当前那个孩子**的');

  /* 导到一台空设备 */
  const b2 = mem();
  PS.useStore(b2);
  PS.importJSON(JSON.stringify(dump));
  eq(PS.childId(), ids[1], '导入后「当前是哪一个」也跟着回来');
  eq(F.current({ backing: b2 }).nickname, '小红', '导入后当前孩子的名字对得上');
  eq(PS.get('p1').level, 9, '**数据落到了对的孩子名下**（不是落到第一个）');
  eq(F.list({ backing: b2 }).length, 2, '名册两条都在');
}

/* ==========================================================================
   八、真页面上跑一遍（jsdom）：名册真的画得出来，切换真的换进度
   --------------------------------------------------------------------------
   上面七节判的都是**源码与内核**。这一节把 `settings/general/index.html` 真跑起来，
   量一遍「用户看到的东西」—— 源码全都对、页面却画不出来，正是这一层要挡的事。
   ========================================================================== */
let JSDOM = null;
try { JSDOM = require('jsdom').JSDOM; } catch (e) { JSDOM = null; }

if (!JSDOM) {
  console.log('\n(未安装 jsdom，跳过「真页面上跑一遍」一节 —— npm i jsdom 可启用)');
  console.log('');
  console.log(fails === 0 ? '🎉 家庭子档案测试全部通过' : '❌ 家庭子档案测试 ' + fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
} else {
  console.log('\n=== 八、真页面上跑一遍（jsdom）===');

  const SCRIPTS = ['js/auth-core.js', 'js/entitlement.js', 'js/family.js', 'js/avatar.js',
    'js/progress-store.js', 'js/storage.js', 'js/settings.js'];

  /** 起一张真的设置页（按真实顺序注入脚本、按需预置层级与会话） */
  function openPage(tier, signedIn) {
    const dom = new JSDOM(read('settings/general/index.html'),
      { runScripts: 'dangerously', url: 'https://local.test/settings/general/', pretendToBeVisual: true });
    const w = dom.window;
    if (tier) {
      w.localStorage.setItem('poem_plan_v1',
        JSON.stringify({ v: 1, tier: tier, until: null, source: 'server' }));
    }
    if (signedIn) {
      w.localStorage.setItem('poem_auth_v1', JSON.stringify({
        v: 1, account: { uid: 'u1', identities: [{ channel: 'email', mask: 'a***@b.com', value: 'x' }] },
        sessions: [{ sid: 's1', exp: 9e15 }], deviceId: 'd1'
      }));
    }
    /* 删除要过 confirm()：jsdom 没实现它，会往控制台丢一条 not-implemented。
       这里**显式替成「用户点了取消」** —— 于是那一条断言验的正是
       「没确认时什么都没发生」，而不是靠 jsdom 的沉默。 */
    w.confirm = () => false;
    SCRIPTS.forEach(f => {
      const el = w.document.createElement('script');
      el.textContent = read(f);
      w.document.body.appendChild(el);
    });
    return w;
  }

  const wait = () => new Promise(r => setTimeout(r, 250));

  (async function run() {
    /* ---- Free（未登录）：只有 1 个，且再建会被**如实拦住** ---- */
    const wf = openPage(null, false);
    await wait();
    eq(wf.document.querySelectorAll('.family-row').length, 1, '真页面：Free 一进来就有 1 个子档案（认领出来的）');
    chk(/当前 1 \/ 1 个/.test(wf.document.getElementById('family-hint').textContent),
      '真页面：如实写「1 / 1 个」（上限只有一个来源）');
    wf.document.getElementById('btn-family-add').dispatchEvent(new wf.Event('click', { bubbles: true }));
    eq(wf.document.querySelectorAll('.family-row').length, 1, '真页面：Free 再建被拦住（名册没变）');
    const toast = wf.document.querySelector('.toast');
    chk(!!toast && /已达上限/.test(toast.textContent),
      '真页面：拦住时**如实说是上限**（不笼统说「建不了」）：' + (toast ? toast.textContent : '(没有提示)'));

    /* ---- Max（已登录）：180 的上限、真的画得出来、改名与切换都落盘 ---- */
    const w = openPage('max', true);
    await wait();
    eq(w.document.querySelectorAll('.family-row').length, 1, '真页面：Max 也是从 1 个开始');
    chk(/当前 1 \/ 180 个/.test(w.document.getElementById('family-hint').textContent),
      '真页面：Max 的上限如实写 180');

    /* 用户名那一栏写进去 → 落到**当前子档案**（不是那份老档案） */
    const u = w.document.getElementById('input-username');
    u.value = '小明';
    u.dispatchEvent(new w.Event('input', { bubbles: true }));
    const fam = JSON.parse(w.localStorage.getItem('poem_family_v1'));
    eq(fam.profiles[0].nickname, '小明', '真页面：用户名写进的是**当前子档案**（昵称属孩子）');
    chk(/小明字印|头像：小/.test(w.document.getElementById('avatar-slot').innerHTML),
      '真页面：那枚印跟着昵称重画（顶栏 / 设置页同一个来源）');

    /* 改名：点「改名」→ 原地长输入框 → 回车落盘 */
    w.document.querySelector('[data-family-rename]').dispatchEvent(new w.Event('click', { bubbles: true }));
    const rin = w.document.getElementById('family-rename-input');
    chk(!!rin, '真页面：点「改名」原地长出输入框（不用 prompt()）');
    if (rin) {
      rin.value = '小明';
      rin.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      eq(JSON.parse(w.localStorage.getItem('poem_family_v1')).profiles[0].nickname, '小明',
        '真页面：回车即落盘');
    }

    /* 建第二个 → 自动切过去 → 切换回来看到各自的进度 */
    w.document.getElementById('btn-family-add').dispatchEvent(new w.Event('click', { bubbles: true }));
    eq(w.document.querySelectorAll('.family-row').length, 2, '真页面：又建了一个');
    const ids = Array.from(w.document.querySelectorAll('[data-family-pick]')).map(e => e.dataset.familyPick);
    eq(JSON.parse(w.localStorage.getItem('poem_family_v1')).at, ids[1],
      '真页面：新档案建好就**顺手切过去**（不然用户以为没建成功）');

    /* 在各自身份下写一条进度，切回来各自都还在 */
    w.ProgressStore.set('p1', { level: 7 });
    w.document.querySelector('[data-family-pick="' + ids[0] + '"]')
      .dispatchEvent(new w.Event('click', { bubbles: true }));
    await wait();
    eq(JSON.parse(w.localStorage.getItem('poem_family_v1')).at, ids[0], '真页面：点名字就切过去');
    eq(JSON.stringify(w.ProgressStore.get('p1')), 'null',
      '真页面：切到另一个孩子，看到的是**它自己那一份**（小明那份进度是空的）');
    w.ProgressStore.set('p1', { level: 3 });
    eq(w.ProgressStore.get('p1').level, 3, '真页面：在这个身份下写的进度读得回来');

    /* 删：只剩一个时那颗「删除」键根本不该出现 */
    const rows = Array.from(w.document.querySelectorAll('.family-row'));
    eq(rows.length, 2, '（前置）现在有两个');
    Array.from(w.document.querySelectorAll('[data-family-remove]')).length &&
      w.document.querySelector('[data-family-remove]').dispatchEvent(new w.Event('click', { bubbles: true }));
    /* 真页面上删除要先过 confirm()，jsdom 里 confirm 默认返回 false ——
       所以这一下**不该**删掉任何东西。这正是「不可逆动作要二次确认」的证据。 */
    eq(w.document.querySelectorAll('.family-row').length, 2,
      '真页面：删除要过 confirm()，用户没确认时**什么都没发生**');

    console.log('');
    if (fails) { console.log('❌ 家庭子档案测试 ' + fails + ' 项失败'); process.exit(1); }
    console.log('🎉 家庭子档案测试全部通过');
    process.exit(0);
  })();
}
