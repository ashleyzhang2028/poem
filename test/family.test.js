const fs = require('fs');
const path = __dirname + '/../';
const nodePath = require('path');
const read = f => fs.readFileSync(path + f, 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };
const eq = (a, b, m) => chk(a === b, m + '（实际 ' + JSON.stringify(a) + '）');

function mem(init) {
  const m = Object.assign({}, init || {});
  return {
    getItem: k => (Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: k => { delete m[k]; },
    raw: () => m
  };
}

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

function sandbox(seed) {
  const b = mem(seed);
  const m = install();
  m.PS.useStore(b);
  return { b: b, F: m.F, A: m.A, PS: m.PS };
}

console.log('=== 一、名册：增 / 改名 / 删 / 切换 / 上限 ===');
{
  const { F, b, PS } = sandbox();

  const d0 = F.ensureDetailed({ backing: b });
  eq(d0.created, 1, 'ensure() 名册为空时认领出第一个子用户');
  eq(F.count({ backing: b }), 1, '认领之后名册里正好一条');

  const e2 = F.ensureDetailed({ backing: b });
  eq(e2.created, 0, 'ensure() 幂等：第二次不再建（否则每开一次页面多一个孩子）');

  eq(F.limit({ backing: b }), Infinity, '读不到 Entitlement 时不设限（与 collections 同一条兜底）');

  const E = t => ({ identity: () => ({ tier: t }) });
  eq(F.limit({ backing: b, E: E('free') }), 1, 'Free：1 个');
  eq(F.limit({ backing: b, E: E('pro') }), 3, 'Pro：3 个');
  eq(F.limit({ backing: b, E: E('max') }), 180, 'Max：**180 个**（用户 2026-09-17 裁决）');

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

  const first = F.list({ backing: b })[0];
  eq(F.rename(first.id, '  小明  ', { backing: b }).ok, true, '改名成功（去首尾空白）');
  eq(F.current({ backing: b }).nickname, '小明', '改名落到那一条上');
  eq(F.rename(first.id, '', { backing: b }).ok, true, '空名允许（用户名那一栏同样允许留空）');
  eq(F.rename('f-不存在', 'x', { backing: b }).code, 'E_NOT_FOUND', '改一个不存在的 id：E_NOT_FOUND');

  const secondId = F.list({ backing: b })[1].id;
  eq(F.select(secondId, { backing: b }).ok, true, '切到第二条：成功');
  eq(F.currentId({ backing: b }), secondId, '当前选中跟着换');
  eq(F.select('f-不存在', { backing: b }).code, 'E_NOT_FOUND', '切到不存在的 id：E_NOT_FOUND');
  eq(F.currentId({ backing: b }), secondId, '被拒之后当前选中**没有**被改动');

}

console.log('\n=== 二、删：最后一个不许删，且不动进度数据 ===');
{
  const { F, PS, b } = sandbox();
  F.ensure({ backing: b });
  const one = F.list({ backing: b })[0];
  PS.set('p1', { level: 1, stage: 2 });

  eq(F.remove(one.id, { backing: b }).code, 'E_LAST', '最后一个子用户不许删（0 个档案没有意义）');
  eq(F.count({ backing: b }), 1, '被拒之后名册原样');

  const r2 = F.create('小红', { backing: b });
  F.remove(r2.profile.id, { backing: b });
  eq(F.count({ backing: b }), 1, '有两个时可以删掉一个');
  chk(!!PS.get('p1'), '删名册**不动进度数据**（误删还能当场看出来，连带清进度不可逆）');

  F.create('小红', { backing: b }).ok && F.select(F.list({ backing: b })[1].id, { backing: b });
  const curId = F.currentId({ backing: b });
  F.remove(curId, { backing: b });
  chk(!!F.currentId({ backing: b }) && F.currentId({ backing: b }) !== curId,
    '删掉的正是当前那一个 → 当前选中落到剩下那一条（不留悬空 id）');
}

console.log('\n=== 三、老用户零感知：老档案与老数据一并认领 ===');
{
  const b = mem({
    poem_profile_v1: JSON.stringify({ v: 1, nickname: '小明', avatar: { img: 'https://x.supabase.co/a.jpg' } }),
    poem_recite_settings_v1: JSON.stringify({ grade: 4, term: 2, scope: 'all', dailyCount: 7, algo: 'sm2' }),
    poem_recite_progress_v1: JSON.stringify({ 'tangshi-ts-1': { level: 3, stage: 5 } }),
    poem_tangshi_read_v1: JSON.stringify({ 'tangshi-ts-1': true })
  });
  const m3 = install();
  const F = m3.F, PS = m3.PS;
  PS.useStore(b);

  eq(PS.childId(), '', '认领前没有子用户（引擎按 0 期老键读）');
  eq(PS.get('tangshi-ts-1').level, 3, '认领前进度照常读得到（老用户不受影响）');

  const d = F.ensureDetailed({ backing: b });
  eq(d.data.profiles[0].nickname, '小明', '昵称被认领进第一个子用户');
  eq(d.data.profiles[0].avatar.img, 'https://x.supabase.co/a.jpg', '头像（图片地址）一并认领');

  PS.useStore(b);
  eq(PS.childId(), d.data.profiles[0].id, '认领之后引擎认到了当前子用户');
  eq(PS.get('tangshi-ts-1').level, 3, '**进度被搬到新键上**（不然升级后看着就空了）');
  eq(PS.settings().grade, 4, '账号域设置跟着搬（年级 / 学期不丢）');
  eq(PS.settings().dailyCount, 7, '每日数量跟着搬');
  chk(!('poem_recite_progress_v1' in b.raw()), '老进度键搬完就删掉（不让它成为第二份真相）');
  chk(!('poem_recite_settings_v1' in b.raw()), '老设置键同理');
  chk(!('poem_tangshi_read_v1' in b.raw()), '已读键也搬走（读没读过是孩子自己的事）');
  chk(Object.keys(b.raw()).some(k => /^poem_tangshi_read_v1::/.test(k)), '已读键搬到了带子用户后缀的那把');

  const keysAfter = Object.keys(b.raw()).slice().sort();
  F.ensure({ backing: b });
  eq(JSON.stringify(Object.keys(b.raw()).slice().sort()), JSON.stringify(keysAfter),
    '认领幂等：第二次不再动盘上任何一个键');

  const b2 = mem();
  PS.useStore(b2);
  const d2 = F.ensureDetailed({ backing: b2 });
  eq(d2.created, 1, '完全没有老数据时，也认领出一个空子用户');
  eq(d2.data.profiles[0].nickname, '', '认领出来的第一个昵称为空（界面回落「Ashley」）');
}

console.log('\n=== 四、分家的边界：谁跟着孩子走，谁不跟 ===');
{
  const { F, PS, b } = sandbox();
  F.ensure({ backing: b });
  const a = F.list({ backing: b })[0].id;
  const rb = F.create('小红', { backing: b });
  const c = rb.profile.id;

  F.select(a, { backing: b }); PS.set('p1', { level: 1 });
  F.select(c, { backing: b }); PS.set('p1', { level: 9 });
  F.select(a, { backing: b }); eq(PS.get('p1').level, 1, '切到小明：看到小明那份进度');
  F.select(c, { backing: b }); eq(PS.get('p1').level, 9, '切到小红：看到小红那份进度');

  F.select(a, { backing: b }); PS.saveSettings({ grade: 1, dailyCount: 5 });
  F.select(c, { backing: b }); PS.saveSettings({ grade: 3, dailyCount: 9 });
  F.select(a, { backing: b }); eq(PS.settings().grade, 1, '一年级的孩子：年级 = 1');
  F.select(c, { backing: b }); eq(PS.settings().grade, 3, '三年级的孩子：年级 = 3（同一台设备，各是各的）');

  F.select(a, { backing: b }); PS.setRead('poem_tangshi_read_v1', 'tangshi-ts-1', true);
  F.select(c, { backing: b }); eq(PS.readMap('poem_tangshi_read_v1')['tangshi-ts-1'], undefined,
    '已读跟着孩子走：小明读过的，小红那边没有');
  PS.setRead('poem_tangshi_read_v1', 'tangshi-ts-2', true);
  F.select(a, { backing: b }); eq(PS.readMap('poem_tangshi_read_v1')['tangshi-ts-2'], undefined,
    '反向也成立：小红读过的，小明那边没有');

  F.select(a, { backing: b }); PS.setHelper(false);
  F.select(c, { backing: b }); eq(PS.helper(), 'off', '设备域的阅读辅助开关两孩子共用（同一台平板）');
  F.select(a, { backing: b }); eq(PS.helper(), 'off', '切回来还是那一个值（没被复制成两份）');

  eq(F.isPerChild('poem_recite_progress_v1'), true, 'isPerChild：进度域 → 分家');
  eq(F.isPerChild('poem_recite_settings_v1'), true, 'isPerChild：账号域设置 → 分家');
  eq(F.isPerChild('poem_device_prefs_v1'), false, 'isPerChild：设备域 → **不**分家');
  eq(F.isPerChild('poem_font_v1'), false, 'isPerChild：字号（设备域老键）→ 不分家');
  eq(F.isPerChild('poem_tangshi_read_v1'), true, 'isPerChild：集子已读 → 分家');
  eq(F.isPerChild('poem_whatever_new_v1'), true,
    '认不出的键按「分家」处理（安全的一侧：多开一份只是多占几 KB，混在一起是数据串了）');

  F.select(a, { backing: b });
  PS.clearProgress();
  eq(JSON.stringify(PS.all()), '{}', '清空进度：当前孩子那份空了');
  F.select(c, { backing: b });
  eq(PS.get('p1').level, 9, '**另一个孩子的进度一根毫毛都没动**（老 bug 换了个形状）');
}

console.log('\n=== 五、拼键只有一处；Family 缺席时退化 ===');
{
  const F = require(path + 'js/family.js');
  eq(F.keyFor('poem_recite_progress_v1', 'f-abc'), 'poem_recite_progress_v1::f-abc',
    'keyFor：拼法就是「原键::子用户 id」');
  eq(F.keyFor('poem_device_prefs_v1', 'f-abc'), 'poem_device_prefs_v1',
    'keyFor：设备域的键**原样返回**（不拼后缀）');
  eq(F.keyFor('poem_recite_progress_v1', ''), 'poem_recite_progress_v1',
    'keyFor：没有当前子用户时返回原键（0 期形状一字不动）');

  const km = F.keyMap({ backing: F.defaultBacking(), profileId: 'f-x' });
  eq(km.keys.progress, 'poem_recite_progress_v1::f-x', 'keyMap 给得出进度键');
  eq(km.keys.device, 'poem_device_prefs_v1', 'keyMap 里设备键不带后缀');

  const files = fs.readdirSync(path + 'js').filter(f => /\.js$/.test(f));
  const splicers = files.filter(f => {
    const src = read('js/' + f).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    return /["']::["']|\+\s*["']::/.test(src) || /::\s*["']\s*\+/.test(src);
  });
  eq(splicers.sort().join(','), 'family.js,sync-store.js',
    'js/ 下拼 `::` 后缀的只有 family.js 与 sync-store.js 的记账表（多一处就红）');

  const sb5 = sandbox();
  sb5.F.ensure({ backing: sb5.b });
  sb5.PS.set('p1', { level: 1 });
  const saved = sb5.b.raw()['poem_recite_progress_v1::' + sb5.F.currentId({ backing: sb5.b })];
  chk(!!saved, '有子用户时写的是带后缀那把键');
  chk(!('poem_recite_progress_v1' in sb5.b.raw()), '同一份数据不会同时落在两把键上（不做第二份真相）');

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

console.log('\n=== 六、上限与内核同源 ===');
{
  const F = require(path + 'js/family.js');
  const E = require(path + 'js/entitlement.js');
  const cap = E.CAPS['profile.family'];
  chk(!!cap, '内核能力表里有 profile.family');
  eq(cap.minTier, 'pro', 'minTier = pro（Free 那一个不算「能力」，是保底）');
  eq(cap.login, true, '要求登录（层级要登录才拿得到）');

  eq(E.quotaFor(cap, 'free'), F.FREE_PROFILES, '内核 quotas.free 与 family.js 同值');
  eq(E.quotaFor(cap, 'pro'), F.PRO_PROFILES, '内核 quotas.pro 与 family.js 同值');
  eq(E.quotaFor(cap, 'max'), F.MAX_PROFILES, '内核 quotas.max 与 family.js 同值');
  eq(cap.name, '子用户', '能力名收成「子用户」（额度归 quotas，不写在名字里）');
  chk(!/（/.test(cap.name), '名字里不再带括号（那是三个数字的旧住处）');

  const core = read('api/_lib/core.js');
  chk(/profile\.family/.test(core), '服务端 featuresFor 里有 profile.family');
  chk(!/profile\.family[^\]]*\]/.test(core.replace(/\/\*[\s\S]*?\*\//g, ' ')) ||
      /"profile\.family"/.test(core), '服务端键名与客户端逐字一致（写错就是「界面点亮、服务端 403」）');

  eq(F.FREE_PROFILES, 1, 'Free 1 个：第一次自动认领的那一份永远放得下');
  eq(F.PRO_PROFILES, 3, 'Pro 3 个');
  eq(F.MAX_PROFILES, 180, 'Max 180 个');

  const memB = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  eq(F.limit({ E: null, backing: memB }), Infinity, '读不到内核时不设限（宁可不判，也不误拦）');
}

console.log('\n=== 七、子用户那一块的接线与收口（js/family-ui.js） ===');
{
  const gen = read('settings/general/index.html');
  const mine = read('mine/index.html');
  const uiJs = read('js/family-ui.js');
  const setJs = read('js/settings.js');
  const mineJs = read('js/mine.js');
  const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  chk(!/id="family-panel"/.test(gen),
    '设置 · 通用里**不再**有子用户那一块（用户 2026-09-18：与「我的」页重复了）');
  chk(!/<script src="\/js\/family\.js"><\/script>/.test(gen) &&
    !/<script src="\/js\/family-ui\.js"><\/script>/.test(gen),
    '那一页也不再加载 family / family-ui（控件搬走了，脚本跟着走）');
  chk(/id="family-panel"/.test(mine), '「我的」页有子用户那一块（子用户是「我是谁」的一部分）');
  chk(/<script src="\/js\/family\.js"><\/script>/.test(mine) &&
    /<script src="\/js\/family-ui\.js"><\/script>/.test(mine),
    '「我的」页加载 family + family-ui（那一块的渲染与交互只有一份）');

  const atF = mine.indexOf('<script src="/js/family.js"></script>');
  const atPS = mine.indexOf('<script src="/js/progress-store.js"></script>');
  chk(atF >= 0 && atPS >= 0 && atF < atPS,
    'js/family.js 排在 progress-store.js 之前（顺序反了不报错，只是永远读没有后缀的老键）');

  const FAM = '((?:Family|F)\\.)';
  chk(new RegExp(FAM + 'ensureDetailed\\(').test(uiJs),
    '那一块先 ensure（认领老档案），再画名册');
  chk(new RegExp(FAM + 'limit\\(').test(uiJs), '上限走 Family.limit()（页面不自己判层级）');
  chk(new RegExp(FAM + '(create|rename|remove|select)\\(').test(uiJs),
    '增 / 改名 / 删 / 切换全走 Family 的接口');
  chk(/function familyMod\(\)/.test(uiJs) && /window\.Family/.test(uiJs),
    'Family 现取（脚本顺序不对 / 老缓存时不报错，只是那一块不画）');
  chk(!/tier\s*===\s*["'](pro|max)["']/.test(strip(uiJs)),
    'js/family-ui.js 不自己写 tier === "pro" 这类判断（上限只有一个来源）');
  chk(!/["']::["']/.test(strip(uiJs)),
    '不自己拼子用户后缀（拼法只在 family.js 一处）');
  chk(!/ensureDetailed|Family\.limit|Family\.create/.test(strip(setJs)) &&
      !/ensureDetailed|Family\.limit|Family\.create/.test(strip(mineJs)),
    '两张页的脚本都不再自己碰 Family（一律经 js/family-ui.js 一个出口）');

  chk(/E_LIMIT/.test(uiJs), '越限时按 E_LIMIT 分开说话（不笼统说「建不了」）');
  chk(/family-change/.test(uiJs) && /family-change/.test(mineJs),
    '切档之后「我的」页会收到通知重画（年级 / 数量 / 进度 / 印 全都要跟着换）');
  chk(/__reloadSettingsControls/.test(setJs) && /renderControls\(\)/.test(setJs),
    '「通用」页那一路仍是整页重画（renderControls 还在）');

  // ---- Issue #209：名额用完了就别摆那颗点不动的键 ----
  chk(/left > 0/.test(uiJs),
    '「再建一个」只在下限允许时才画出来（left > 0）—— ' +
    '只能建 0 个时那颗键没有意义，不如不显示（用户 2026-09-18 点名）');
  chk(/if \(left > 0\) \{[\s\S]{0,200}btn-family-add/.test(uiJs),
    '那颗键整块在 left > 0 的分支里（不是在画完之后再拿 CSS 遮住）');

  // ---- Issue #209：上限那一行把各层的名额一并写出来 ----
  chk(/Pro 用户可建/.test(uiJs) && /Max 用户可建/.test(uiJs),
    '上限那一行写出 Pro / Max 各能建几个（用户 2026-09-18 要给的那句话）');
  chk(/CAPS\["profile\.family"\]|CAPS\['profile\.family'\]/.test(uiJs),
    '名额数字取自 Entitlement.CAPS["profile.family"]（不手抄一份 3 / 180）');
  chk(!/180/.test(strip(uiJs)) && !/\b3\b/.test(strip(uiJs).replace(/zh-CN|UTF-8/g, '')),
    'js/family-ui.js 里不出现写死的 3 / 180（数字只有一个来源）');
  chk(/quotas/.test(uiJs), '它读的是内核能力表里的 quotas 那一栏');
}

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

  const b2 = mem();
  PS.useStore(b2);
  PS.importJSON(JSON.stringify(dump));
  eq(PS.childId(), ids[1], '导入后「当前是哪一个」也跟着回来');
  eq(F.current({ backing: b2 }).nickname, '小红', '导入后当前孩子的名字对得上');
  eq(PS.get('p1').level, 9, '**数据落到了对的孩子名下**（不是落到第一个）');
  eq(F.list({ backing: b2 }).length, 2, '名册两条都在');
}

let JSDOM = null;
try { JSDOM = require('jsdom').JSDOM; } catch (e) { JSDOM = null; }

if (!JSDOM) {
  console.log('\n(未安装 jsdom，跳过「真页面上跑一遍」一节 —— npm i jsdom 可启用)');
  console.log('');
  console.log(fails === 0 ? '🎉 家庭子用户测试全部通过' : '❌ 家庭子用户测试 ' + fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
} else {
  console.log('\n=== 八、真页面上跑一遍（jsdom）===');

  const SCRIPTS = ['js/auth-core.js', 'js/entitlement.js', 'js/family.js', 'js/family-ui.js',
    'js/avatar.js', 'js/avatar-image.js', 'js/account-api.js', 'js/progress-store.js',
    'js/storage.js', 'js/scheduler.js', 'js/mine.js'];

  // 子用户那一块现在住在「我的」页（Issue #209），所以真页面测试也开在 /mine/ 上。
  function openPage(tier, signedIn) {
    const dom = new JSDOM(read('mine/index.html'),
      { runScripts: 'dangerously', url: 'https://local.test/mine/', pretendToBeVisual: true });
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

    const wf = openPage(null, false);
    await wait();
    eq(wf.document.querySelectorAll('.family-row').length, 1, '真页面：Free 一进来就有 1 个子用户（认领出来的）');
    const freeHint = wf.document.getElementById('family-hint').textContent;
    chk(/当前 1 \/ 1 个/.test(freeHint), '真页面：如实写「1 / 1 个」（上限只有一个来源）');
    chk(/Pro 用户可建 3 个/.test(freeHint) && /Max 用户可建 180 个/.test(freeHint),
      '真页面：同一行写出 Pro / Max 各能建几个（实际「' + freeHint + '」）');
    chk(!/Free 用户可建/.test(freeHint),
      '真页面：当前就是 Free，不再重复写一遍「Free 用户可建 1 个」');
    chk(!wf.document.getElementById('btn-family-add'),
      '真页面：Free 只剩 0 个时**不摆**「再建一个」（只能建 0 个，那颗键没有意义）');

    const w = openPage('max', true);
    await wait();
    eq(w.document.querySelectorAll('.family-row').length, 1, '真页面：Max 也是从 1 个开始');
    chk(/当前 1 \/ 180 个/.test(w.document.getElementById('family-hint').textContent),
      '真页面：Max 的上限如实写 180');
    chk(!/Max 用户可建/.test(w.document.getElementById('family-hint').textContent),
      '真页面：当前就是 Max，不再重复写一遍「Max 用户可建 180 个」');
    chk(!!w.document.getElementById('btn-family-add'),
      '真页面：还有名额时那颗「再建一个」照旧在');

    const u = w.document.getElementById('input-nickname');
    u.value = '小明';
    u.dispatchEvent(new w.Event('input', { bubbles: true }));
    u.dispatchEvent(new w.Event('change', { bubbles: true }));
    const fam = JSON.parse(w.localStorage.getItem('poem_family_v1'));
    eq(fam.profiles[0].nickname, '小明', '真页面：昵称写进的是**当前子用户**（昵称属孩子）');
    chk(!!w.document.getElementById('family-panel').querySelector('.family-row'),
      '真页面：子用户那一行仍画在页面上（头像搬去「我的」页之后仍要画）');
    await wait();
    chk(/小明/.test(w.document.getElementById('family-panel').innerHTML),
      '真页面：子用户那一行的名字跟着昵称重画（同一个来源）');

    w.document.querySelector('[data-family-rename]').dispatchEvent(new w.Event('click', { bubbles: true }));
    const rin = w.document.getElementById('family-rename-input');
    chk(!!rin, '真页面：点「改名」原地长出输入框（不用 prompt()）');
    if (rin) {
      rin.value = '小明';
      rin.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      eq(JSON.parse(w.localStorage.getItem('poem_family_v1')).profiles[0].nickname, '小明',
        '真页面：回车即落盘');
    }

    w.document.getElementById('btn-family-add').dispatchEvent(new w.Event('click', { bubbles: true }));
    eq(w.document.querySelectorAll('.family-row').length, 2, '真页面：又建了一个');
    const ids = Array.from(w.document.querySelectorAll('[data-family-pick]')).map(e => e.dataset.familyPick);
    eq(JSON.parse(w.localStorage.getItem('poem_family_v1')).at, ids[1],
      '真页面：新档案建好就**顺手切过去**（不然用户以为没建成功）');

    w.ProgressStore.set('p1', { level: 7 });
    w.document.querySelector('[data-family-pick="' + ids[0] + '"]')
      .dispatchEvent(new w.Event('click', { bubbles: true }));
    await wait();
    eq(JSON.parse(w.localStorage.getItem('poem_family_v1')).at, ids[0], '真页面：点名字就切过去');
    eq(JSON.stringify(w.ProgressStore.get('p1')), 'null',
      '真页面：切到另一个孩子，看到的是**它自己那一份**（小明那份进度是空的）');
    w.ProgressStore.set('p1', { level: 3 });
    eq(w.ProgressStore.get('p1').level, 3, '真页面：在这个身份下写的进度读得回来');

    const rows = Array.from(w.document.querySelectorAll('.family-row'));
    eq(rows.length, 2, '（前置）现在有两个');
    Array.from(w.document.querySelectorAll('[data-family-remove]')).length &&
      w.document.querySelector('[data-family-remove]').dispatchEvent(new w.Event('click', { bubbles: true }));

    eq(w.document.querySelectorAll('.family-row').length, 2,
      '真页面：删除要过 confirm()，用户没确认时**什么都没发生**');

    console.log('');
    if (fails) { console.log('❌ 家庭子用户测试 ' + fails + ' 项失败'); process.exit(1); }
    console.log('🎉 家庭子用户测试全部通过');
    process.exit(0);
  })();
}
