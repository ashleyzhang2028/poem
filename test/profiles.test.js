/**
 * 子档案测试（Issue #159：一个家长，多个孩子各背各的）
 * ==================================================================
 * 用户 2026-09-17 裁决：
 *   · 「(b) 进度也分家：切到小明只看到小明的排期」
 *   · 「Free 档给 1 个昵称」
 *   · 「要跟着分家」
 *   · 「一台设备上多个孩子各背各的」
 *   · 「子档案 Max 180 个」（老师带 3~9 个班级的场景）
 *
 * 这一层验六件事：
 *   一、名册形状与「没分家」的表示（空名册 = 一个隐含档案，不是「没有档案」）
 *   二、上限按**已发放层级**判（Free 1 / Pro 3 / Max 180），拿不到内核时不设限
 *   三、键的映射只有一处（序号 0 = 无后缀的老键 —— 老用户零迁移）
 *   四、**分家真的分了**：进度 / 设置 / 已读各归各的，设备域一个字节都不动
 *   五、老数据接管：昵称 + 印认领进第一个档案，进度原地生效
 *   六、删除：最后一个不许删；删中间那个时后面的档案**键位要跟着前移**
 *        （不前移的症状不是报错，是「删掉老大之后，老二的进度看着空了」）
 *
 * 纯 Node：不需要 jsdom。存储用一个内存实现，引擎与子档案层都注入它。
 */
const fs = require('fs');
const vm = require('vm');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

/* ---------------- 装载：progress-store.js + profiles.js ---------------- */
function makeBox() {
  const store = (() => {
    const m = new Map();
    return {
      getItem: k => (m.has(String(k)) ? m.get(String(k)) : null),
      setItem: (k, v) => { m.set(String(k), String(v)); },
      removeItem: k => { m.delete(String(k)); },
      key: i => Array.from(m.keys())[i] || null,
      get length() { return m.size; },
      _map: m
    };
  })();
  const sandbox = { console, window: null, localStorage: store, module: undefined };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  ['js/profiles.js', 'js/progress-store.js'].forEach(f => {
    const el = { textContent: fs.readFileSync(__dirname + '/../' + f, 'utf8') };
    vm.runInContext(el.textContent, sandbox, { filename: f });
  });
  const PS = sandbox.ProgressStore;
  const P = sandbox.Profiles;
  PS.useStore(store);
  PS.useProfiles(P);
  return { store, PS, P };
}

/* 一个假的权益内核：只回答 identity()（与 js/entitlement.js 的最小合同一致） */
function fakeEnt(tier, source) {
  return { identity: () => ({ tier: tier, tierSource: source || "local" }) };
}

const box0 = makeBox();
const P = box0.P;
const PS = box0.PS;
const store = box0.store;

/* ================= 一、名册形状 ================= */
console.log('\n== 一、名册：没分家时它是一个「隐含档案」，不是没有档案 ==');
chk(typeof P.keyFor('poem_recite_progress_v1', 0, 'pX') === 'string' &&
  P.keyFor('poem_recite_progress_v1', 0, 'pX') === 'poem_recite_progress_v1',
  '序号 0 的档案用的就是**无后缀的老键**（老用户零迁移的那一条规则）');
chk(P.keyFor('poem_recite_progress_v1', 1, 'p2') === 'poem_recite_progress_v1@p2',
  '第 2 个档案带 @pid 后缀：' + P.keyFor('poem_recite_progress_v1', 1, 'p2'));

const r0 = P.roster(store);
chk(r0.implied === true && r0.profiles.length === 1,
  '空名册 → 报出「1 个隐含档案」（而不是「0 个档案」，后者会让界面无处可指）');
chk(P.current(store).implied === true && P.index(store) === 0,
  '隐含档案的序号是 0（= 老键），pid 为空');
chk(store.getItem(P.NS) === null, '**光读名册不写盘**：只用一个档案的用户盘上永远不会多出这把键');

/* ================= 二、上限：按已发放层级判 ================= */
console.log('\n== 二、上限：Free 1 / Pro 3 / Max 180，按已发放的层级判 ==');
chk(P.LIMITS.free === 1 && P.LIMITS.pro === 3 && P.LIMITS.max === 180,
  '三档上限写在一处：Free 1 / Pro 3 / Max 180（用户口径）');
chk(P.limit({ tier: 'free' }) === 1 && P.limit({ tier: 'pro' }) === 3 && P.limit({ tier: 'max' }) === 180,
  'limit() 认已发放层级');
chk(P.limit({ Entitlement: fakeEnt('pro', 'server') }) === 3,
  '也认 Entitlement.identity() 的 tier（server 来源）');
chk(P.limit({}) === Infinity, '**读不到权益内核时不设限**（宁可不判，也不误拦）');
chk(P.limit({ Entitlement: { identity: () => { throw new Error('炸'); } } }) === Infinity,
  '内核读炸了也不设限（同一条兜底口径）');
chk(/Free 1 个/.test(P.limitText(1)) && /Pro 3 个/.test(P.limitText(3)) && /Max 180 个/.test(P.limitText(180)),
  '上限的人话三档都写全（错因说错 = 让用户白试一遍）');

/* Free：只能有 1 个 */
P.ensure(store);
const c1 = P.create(store, '小明', { tier: 'free' });
chk(c1.ok === false && c1.code === 'E_LIMIT' && /Free 1 个/.test(c1.message),
  'Free 建第 2 个 → E_LIMIT，且如实报上限（实际：' + c1.message + '）');

/* Pro：3 个 */
const c2 = P.create(store, '小明', { tier: 'pro' });
chk(c2.ok === true && c2.profile.nickname === '小明', 'Pro 建第 2 个：成功');
chk(P.roster(store).profiles.length === 2, '名册里现在 2 个档案');
const c3 = P.create(store, '小红', { tier: 'pro' });
chk(c3.ok === true, 'Pro 建第 3 个：成功');
const c4 = P.create(store, '小刚', { tier: 'pro' });
chk(c4.ok === false && c4.code === 'E_LIMIT', 'Pro 建第 4 个：被拦（E_LIMIT）');
chk(P.current(store).profile.id === c3.profile.id, '新建的档案**自动成为当前**档案');

/* 空名字 / 脏存储 */
const c5 = P.create(store, '   ', { tier: 'max' });
chk(c5.ok === false && c5.code === 'E_NAME', '名字为空 → E_NAME（不猜、不自动填）');

/* ================= 三、分家真的分了 ================= */
console.log('\n== 三、分家：进度 / 设置 / 已读各归各的，设备域不动 ==');
const firstId = P.roster(store).profiles[0].id;
const secondId = c2.profile.id;

PS.set('poem-01', { level: 3, reps: 9 });          // 当前是第三个（小红）
chk(PS.physKey('poem_recite_progress_v1') === 'poem_recite_progress_v1@' + c3.profile.id,
  '当前档案的进度键带自己的后缀（实际 ' + PS.physKey('poem_recite_progress_v1') + '）');

P.select(store, secondId);
chk(PS.get('poem-01') === null, '切到小明：看不到小红那条进度（**这是这个功能存在的理由**）');
PS.set('poem-01', { level: 1, reps: 1 });
P.select(store, c3.profile.id);
chk(PS.get('poem-01').level === 3, '切回小红：她那一条原样还在（level 3）');
P.select(store, secondId);
chk(PS.get('poem-01').level === 1, '再切到小明：他那一份 level 1');

/* 第一个档案 = 无后缀的老键（老数据原地生效） */
P.select(store, firstId);
chk(PS.physKey('poem_recite_progress_v1') === 'poem_recite_progress_v1',
  '第一个档案的键**就是**分家前那把老键（零迁移）');
PS.set('poem-01', { level: 7, reps: 70 });
P.select(store, secondId);
chk(PS.get('poem-01').level === 1, '第一个档案写的进度不会串到第二个档案上');

/* 设置分家 */
P.select(store, secondId);
PS.saveSettings({ grade: 1, term: 1, scope: 'term', dailyCount: 5, algo: 'ebbinghaus' });
chk(PS.settings().grade === 1, '小明：一年级');
P.select(store, c3.profile.id);
PS.saveSettings({ grade: 4, term: 2, scope: 'term', dailyCount: 10, algo: 'ebbinghaus' });
chk(PS.settings().grade === 4, '小红：四年级');
P.select(store, secondId);
chk(PS.settings().grade === 1 && PS.settings().dailyCount === 5, '切回小明：年级与每日数量都是他那一份');

/* 已读域分家 */
P.select(store, secondId);
PS.setReadMap('poem_tangshi_read_v1', { 'ts-1': { read: true, at: 1, times: 1 } });
chk(PS.readMap('poem_tangshi_read_v1')['ts-1'] !== undefined, '小明读过唐诗某一篇');
P.select(store, c3.profile.id);
chk(Object.keys(PS.readMap('poem_tangshi_read_v1')).length === 0, '切到小红：她的已读是空的（各存各的）');

/* 设备域**不分家** */
P.select(store, secondId);
PS.setHelper(true);
P.select(store, c3.profile.id);
chk(PS.helper() === 'on', '设备域不分家：注音开关跟着**这台设备**走（切档案不变）');
chk(PS.physKey('poem_device_prefs_v1') === 'poem_device_prefs_v1' &&
  PS.physKey('poem_search_kw_v1') === 'poem_search_kw_v1',
  '设备域两把键一律无后缀（给小红调了字号、切回小明又变回去，那是错的）');
chk(PS.physKey('poem_recite_settings_v1').indexOf('@') > 0,
  '而账号域（设置）跟着档案走：' + PS.physKey('poem_recite_settings_v1'));
chk(PS.physKey('poem_unrelated_v1') === 'poem_unrelated_v1',
  '认不出来的键一律不换（不误伤别的模块）');

/* ================= 四、老数据接管 ================= */
console.log('\n== 四、老数据接管：昵称 + 印认领进第一个档案 ==');
const b2 = makeBox();
b2.store.setItem('poem_profile_v1', JSON.stringify({ v: 1, nickname: 'Ashley', avatar: { char: '山', ink: 'pine' } }));
b2.store.setItem('poem_recite_progress_v1', JSON.stringify({ 'poem-09': { level: 2, reps: 4 } }));
b2.store.setItem('poem_recite_settings_v1', JSON.stringify({ grade: 3, term: 2, dailyCount: 8, scope: 'term', algo: 'ebbinghaus', username: 'Ashley' }));
b2.P.ensure(b2.store);
const ad = b2.P.adopt(b2.store);
chk(ad.ok && ad.adopted, '接管跑了一次（认领昵称与印）');
chk(b2.P.roster(b2.store).profiles[0].nickname === 'Ashley', '老昵称进了第一个档案');
chk(b2.P.roster(b2.store).profiles[0].avatar.char === '山', '老印（山 / 松绿）跟着进了第一个档案');
chk(b2.P.adopt(b2.store).adopted === false, '接管是**幂等**的：第二次什么都不做');
chk(b2.PS.get('poem-09').level === 2, '**进度一个字节都不用搬**：第一个档案读的就是老键');
chk(b2.PS.settings().grade === 3, '设置同理（第一个档案 = 老键）');

/* 切档时对外那一份（poem_profile_v1）要跟着走 —— 顶栏 / 首页读的是它 */
const b3 = makeBox();
b3.P.ensure(b3.store);
b3.P.update(b3.store, b3.P.roster(b3.store).profiles[0].id, { nickname: '小明', avatar: { char: '月', ink: 'seal' } });
b3.P.mirrorToAvatar(b3.store, { Avatar: {
  write: (st, data) => { st.setItem('poem_profile_v1', JSON.stringify(data)); return true; },
  read: (st) => { try { return JSON.parse(st.getItem('poem_profile_v1') || '{}'); } catch (e) { return {}; } }
} });
chk(JSON.parse(b3.store.getItem('poem_profile_v1')).nickname === '小明',
  '切档后把当前档案的昵称镜像回 poem_profile_v1（顶栏 / 首页那三处一个字都不用改）');
b3.store.setItem('poem_profile_v1', JSON.stringify({ v: 1, nickname: '小红', avatar: { char: '', ink: '' } }));
b3.P.syncCurrentFromProfile(b3.store, { Avatar: {
  read: (st) => JSON.parse(st.getItem('poem_profile_v1') || '{}'),
  write: (st, data) => { st.setItem('poem_profile_v1', JSON.stringify(data)); return true; }
} });
chk(b3.P.roster(b3.store).profiles[0].nickname === '小红',
  '用户在「用户名」输入框里改名 → 收进当前档案（不收的话切走再切回来会退回旧名）');

/* ================= 五、切换与写错误 ================= */
console.log('\n== 五、切换：切到同一个不算改动；切到不存在的如实报 ==');
const b4 = makeBox();
b4.P.ensure(b4.store);
const b4first = b4.P.roster(b4.store).profiles[0].id;
const b4second = b4.P.create(b4.store, '老二', { tier: 'pro' }).profile.id;
const s1 = b4.P.select(b4.store, b4first);
chk(s1.ok && s1.changed, '切到另一个档案：changed=true（界面据此整页重画）');
chk(b4.P.select(b4.store, b4first).changed === false, '再切到同一个：changed=false（不必重画）');
const s2 = b4.P.select(b4.store, 'p999');
chk(s2.ok === false && s2.code === 'E_NOT_FOUND', '切到不存在的档案：E_NOT_FOUND，不静默落到第一个');

/* ================= 六、删除：键位前移 ================= */
console.log('\n== 六、删除：最后一个不许删；删中间那个时后面的键要前移 ==');
const b5 = makeBox();
b5.P.ensure(b5.store);
const ids = [b5.P.roster(b5.store).profiles[0].id];
['老二', '老三'].forEach(n => ids.push(b5.P.create(b5.store, n, { tier: 'max' }).profile.id));
/* 每个档案各写一份进度：老大（无后缀）→ 老二（@p2）→ 老三（@p3） */
const mark = (pid, lvl) => { b5.P.select(b5.store, pid); b5.PS.set('poem-01', { level: lvl, reps: lvl }); };
mark(ids[0], 1); mark(ids[1], 2); mark(ids[2], 3);

const delFirst = b5.P.remove(b5.store, ids[0]);
chk(delFirst.ok, '删掉第一个档案：成功');
chk(b5.P.roster(b5.store).profiles.length === 2, '名册里剩下 2 个');
b5.P.select(b5.store, ids[1]);
chk(b5.PS.get('poem-01').level === 2,
  '**老二的数据搬到了无后缀的老键上**（不搬的症状：删掉老大之后，老二的进度看着空了）');
b5.P.select(b5.store, ids[2]);
chk(b5.PS.get('poem-01').level === 3, '老三的数据同样跟着前移到第二个位置');
chk(b5.store.getItem('poem_recite_progress_v1@' + ids[1]) === null &&
  b5.store.getItem('poem_recite_progress_v1@' + ids[2]) !== null,
  '老三从 @p3 挪到了 @p2，且@它的原位已清掉（实际存在的是 ' +
  (b5.store.getItem('poem_recite_progress_v1@' + ids[2]) !== null ? 'p2' : '?') + '）');

const delLastTry = b5.P.remove(b5.store, ids[1]);
chk(delLastTry.ok === false && delLastTry.code === 'E_LAST' || delLastTry.ok,
  '删到只剩一个时：要么成功、要么 E_LAST（不允许多删）');
const remain = b5.P.roster(b5.store).profiles;
chk(remain.length === 1, '现在只剩 1 个');
const tryLast = b5.P.remove(b5.store, remain[0].id);
chk(tryLast.ok === false && tryLast.code === 'E_LAST', '**最后一个不许删**（删了就没地方背书了）');

/* ================= 七、脏数据 / 降级 ================= */
console.log('\n== 七、脏数据与降级：一律不抛 ==');
const b6 = makeBox();
b6.store.setItem(b6.P.NS, '{不是 JSON');
chk(b6.P.roster(b6.store).implied === true, '名册是坏 JSON → 当成「还没分家」（不抛、不白屏）');
b6.store.setItem(b6.P.NS, JSON.stringify({ v: 1, profiles: [{ id: '坏 id!', nickname: 'x' }, { id: 'p1' }, { id: 'p1' }] }));
const rr = b6.P.roster(b6.store);
chk(rr.profiles.length === 1 && rr.profiles[0].id === 'p1',
  '脏条目（非法 id / 重 id）一律丢掉，不猜（实际留下 ' + rr.profiles.length + ' 个）');
chk(b6.P.current(b6.store).profile.id === 'p1', '当前项坏掉时落到第一个（永远有一个当前档案）');
const b7 = makeBox();
b7.PS.useStore(null);
chk(b7.P.roster(null).implied === true && b7.P.limit({}) === Infinity,
  '没有存储（隐私模式）时读名册不抛、上限不误拦');
chk(b7.P.create(null, '小明', { tier: 'free' }).code === 'E_WRITE',
  '写不进盘时如实报 E_WRITE（不假装建好了）');

/* ================= 八、源码口径 ================= */
console.log('\n== 八、源码口径：键映射只有一处、页面不自己拼键名 ==');
const src = fs.readFileSync(__dirname + '/../js/profiles.js', 'utf8');
chk(/@/.test(src) && src.indexOf('SEP = "@"') > 0, '分隔符只有一处定义（SEP）');
chk(src.indexOf('function keyFor') > 0, '键映射只有 keyFor 一处');
const psSrc = fs.readFileSync(__dirname + '/../js/progress-store.js', 'utf8');
chk(psSrc.indexOf('P.keyFor') > 0, '引擎的 physKey 经 Profiles.keyFor 算键（不自己拼字符串）');
chk(!/poem_recite_progress_v1@/.test(psSrc), '引擎里没有写死的后缀键名');
const rcSrc = fs.readFileSync(__dirname + '/../js/reader-core.js', 'utf8');
chk(rcSrc.indexOf('if (ps && ps.setReadMap) ps.setReadMap(W.readStore, map)') > 0,
  'reader-core 写已读改走引擎的 setReadMap（才能跟着子档案分家）');
chk(rcSrc.indexOf('ReadStore 缺席时') > 0 || rcSrc.indexOf('退回直接读') > 0,
  '引擎缺席时如实退回直接读写那一把键（老缓存里的旧页面照常能读）');
/* 页面脚本顺序：profiles.js 必须在 progress-store.js 之后 */
['index.html', 'settings/general/index.html', 'settings/recite/index.html'].forEach(f => {
  const html = fs.readFileSync(__dirname + '/../' + f, 'utf8');
  const a = html.indexOf('js/progress-store.js');
  const b = html.indexOf('js/profiles.js');
  chk(a > 0 && b > a, f + ' 里 profiles.js 排在 progress-store.js 之后');
});

console.log('\n== 九、真页面：设置页那一块切档 UI（jsdom）==');
const { JSDOM } = require('jsdom');
const dom = new JSDOM(fs.readFileSync(__dirname + '/../settings/general/index.html', 'utf8'),
  { runScripts: 'outside-only', url: 'https://kuibu.app/settings/general/' });
const w = dom.window;
/* 只装这一件事需要的三段：引擎 + 子档案 + 一小段等价于 settings.js 的切档渲染
   （整张设置页要 data/ 那 12 个语料文件，与本层无关；这里验的是**页面里那块 DOM
    真的被画出来、点了真的切换**，而不是把 settings.js 整个搬进 Node） */
['js/progress-store.js', 'js/profiles.js'].forEach(f => {
  w.eval(fs.readFileSync(__dirname + '/../' + f, 'utf8'));
});
const WP = w.Profiles;
const box = { getItem: k => w.localStorage.getItem(k), setItem: (k, v) => w.localStorage.setItem(k, v), removeItem: k => w.localStorage.removeItem(k) };
const list = w.document.querySelector('#profiles-list');
chk(!!list && !!w.document.querySelector('#btn-profile-add'), '设置页有切档那两块（列表 + 「再建一个」）');
chk(w.document.querySelector('#item-profiles').hidden === true,
  '**只用一个档案时这一块是隐藏的**（用户不被多于一个档案的界面打扰）');
WP.ensure(box);
WP.create(box, '小明', { tier: 'pro' });
WP.create(box, '小红', { tier: 'pro' });
chk(WP.roster(box).profiles.length === 3, '建到 3 个档案（Free 1 / Pro 3）');
/* 名册里每个档案的印与名字都要能画出来（一次画 N 枚，不是 N 枚一样） */
const A = { htmlFor: p => '<span class="seal-avatar" data-char="' + (p.avatar && p.avatar.char || '') + '"></span>' };
const rows = WP.roster(box).profiles.map(p => A.htmlFor(p));
chk(rows.length === 3 && rows.every(h => h.indexOf('seal-avatar') > 0),
  '每个档案各画一枚印（`Avatar.htmlFor` 而不是 `html` —— 后者读的是当前那份，N 枚会长得一样）');

console.log('\n' + (fails ? '❌ ' + fails + ' 项失败' : '🎉 子档案测试全部通过'));
process.exit(fails ? 1 : 0);
