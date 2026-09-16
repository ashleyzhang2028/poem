/**
 * ProgressStore 分域测试（Issue #132 阶段 0 / `docs/architecture.md` §3）
 *
 * 纯 Node、不联网、不装新依赖。被测文件 js/progress-store.js 用 `useStore()`
 * 注入内存存储，与 js/avatar.js 的测试同一套路。
 *
 * 这一层守的是**三件比接口更要紧的事**：
 *   1. **分域隔离**：改字号不写进度、改昵称不写设备域、清进度不删账号与设备偏好
 *      （「清空背诵进度顺手把昵称删了」是今天真实存在的 bug 形状）
 *   2. **设置域拆家**：`helper` 搬到 `poem_device_prefs_v1`（设备域），
 *      而 `grade/term/scope/dailyCount/algo` 仍在老键（账号域，跨设备一致）；
 *      对外**仍返回同一个扁平对象**，老代码一行不用改
 *   3. **网页端接线**：正文里出现 `js/progress-store.js` 的每一页，
 *      它都必须**排在 js/storage.js 之前**（顺序反了不报错，只是少数据）
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

global.window = global;
require('../js/progress-store.js');
const PS = global.ProgressStore;

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };
const eq = (a, b, m) => chk(a === b, m + '（实际 ' + JSON.stringify(a) + '）');

/** 假 localStorage */
function mem(init) {
  const m = Object.assign({}, init || {});
  return {
    getItem: k => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: k => { delete m[k]; },
    keys: () => Object.keys(m),
    raw: () => m
  };
}
/** 写满的存储：setItem 一律抛 QuotaExceeded，读得到旧值 */
function full(init) {
  const inner = mem(init);
  return Object.assign({}, inner, {
    setItem: () => { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
  });
}
const K = PS.KEYS;

console.log('=== 一、进度域：形状与老实现逐字一致 ===');
{
  const b = mem();
  PS.useStore(b);
  eq(PS.get('p1'), null, '没写过的 id 读回 null（不是 undefined、不是 {}）');
  PS.set('p1', { level: 2, learned: true });
  eq(JSON.stringify(PS.get('p1')), '{"level":2,"learned":true}', '写进去什么就读出什么');
  eq(b.raw()[K.progress], '{"p1":{"level":2,"learned":true}}',
    '盘上形状仍是 {id: rec} 平铺，没有包一层信封（三处老断言直接读它）');
  PS.setMany([{ id: 'p2', rec: { level: 1 } }, { id: 'p3', rec: { level: 3 } }]);
  eq(Object.keys(PS.all()).length, 3, 'setMany 是追加而不是覆盖整张表');
  PS.remove('p2');
  eq(PS.get('p2'), null, 'remove 删掉一条');
  eq(Object.keys(PS.all()).length, 2, 'remove 不动其他条目');
  PS.replaceAll({ zzz: { level: 9 } });
  eq(JSON.stringify(PS.all()), '{"zzz":{"level":9}}', 'replaceAll 整份替换（拉取 / 导入用）');
}

console.log('\n=== 二、pruneUnknown：拿不到语料时一个键都不删 ===');
{
  const b = mem({ [K.progress]: JSON.stringify({ known: { level: 1 }, orphan: { level: 2 } }) });
  PS.useStore(b);
  eq(JSON.stringify(PS.pruneUnknown([])), '[]', '空语料 → 一个都不删（宁可留孤儿也不误删）');
  eq(JSON.stringify(PS.pruneUnknown(null)), '[]', 'null 语料 → 一个都不删');
  eq(Object.keys(PS.all()).length, 2, '删过之后两条都还在');
  eq(JSON.stringify(PS.pruneUnknown(['known'])), '["orphan"]', '有语料时才动手，返回被清掉的 id');
  eq(JSON.stringify(PS.all()), '{"known":{"level":1}}', '只删孤儿，真实篇目的进度留住');
}

console.log('\n=== 三、设置域拆家：账号域字段留下，helper 归设备域 ===');
{
  const b = mem();
  PS.useStore(b);
  eq(JSON.stringify(PS.settings().scope), '"term"', '什么盘都没有时给出厂默认（term）');
  eq(PS.settings().grade, 1, '默认年级 1');
  eq(PS.helper(), 'on', 'helper（设备域）的出厂默认是「阅读辅助开着」');
  eq(PS.settings().helper, undefined, '设置对象里不再出现 helper —— 它已搬去设备域');

  PS.saveSettings({ grade: 3, term: 2, scope: 'term', dailyCount: 8, algo: 'fsrs', helper: 'off' });
  const acct = JSON.parse(b.raw()[K.settings] || '{}');
  eq(acct.grade, 3, 'grade 落在账号域老键里（跨设备一致）');
  eq(acct.algo, 'fsrs', 'algo 落在账号域老键里');
  eq(JSON.stringify(acct.device), undefined, '账号域里不生造 device 字段');
  eq(acct.helper, 'off',
    'helper 在老键里仍留一份镜像（六部集子页还在读它，只写新键会两边打架）');
  eq(JSON.parse(b.raw()[K.device] || '{}').helper, 'off', 'helper 同时写进设备域新键');

  /* 白名单：不在表里的字段一律不落盘 */
  PS.saveSettings({ grade: 2, helper: 'on', 野生字段: 1, plan: 'max' });
  const acct2 = JSON.parse(b.raw()[K.settings] || '{}');
  eq(acct2.野生字段, undefined, '认不出的字段不写盘（导入脏备份也进不来）');
  eq(acct2.plan, undefined, 'plan 这类权益字段不属于设置域，不写盘');
  eq(acct2.grade, 2, '白名单里的字段照写');

  /* patch：读改写 */
  PS.patch({ dailyCount: 10 });
  eq(PS.settings().dailyCount, 10, 'patch 改得进');
  eq(PS.settings().grade, 2, 'patch 不动别的字段');
  eq(PS.settings().username, undefined, '没写过 username 时它不凭空出现');
}

console.log('\n=== 四、兼容读：老用户的盘（helper 还在设置对象里）照样认 ===');
{
  const legacy = mem({ [K.settings]: JSON.stringify({ grade: 4, helper: 'off', scope: 'all' }) });
  PS.useStore(legacy);
  eq(PS.helper(), 'off', '老键里的 helper=off 读得出来（老用户零感知）');
  eq(PS.settings().grade, 4, '老键里的 grade 也照读');
  eq(PS.settings().scope, 'all', '老键里的 scope 也照读');
  legacy.setItem(K.device, JSON.stringify({ v: 1, helper: 'on' }));
  eq(PS.helper(), 'on', '两处不一致时以设备域新键为准');

  const dirty = mem({ [K.device]: JSON.stringify({ helper: '不知道是啥' }) });
  PS.useStore(dirty);
  eq(PS.helper(), 'on', '设备域里的脏值回落出厂默认，不抛');
  PS.useStore(mem({ [K.device]: JSON.stringify([1, 2]) }));
  eq(PS.helper(), 'on', '设备域存了个数组也回落（不被 Array.isArray 之外的形状骗过）');
  PS.useStore(mem({ [K.settings]: '{坏 JSON' }));
  eq(PS.settings().grade, 1, '设置不是 JSON → 整份回落默认，不抛');
  eq(PS.helper(), 'on', '设置坏了 helper 也回落默认');
  PS.useStore(mem({ [K.device]: 'off' }));
  eq(PS.helper(), 'off', '早期只存过一个裸字符串的形态也认（迁移期不留坑）');
}

console.log('\n=== 五、分域隔离：改一处不许碰另一处 ===');
{
  const b = mem({
    [K.progress]: JSON.stringify({ p1: { level: 1 } }),
    [K.settings]: JSON.stringify({ grade: 3, helper: 'on' }),
    [K.profile]: JSON.stringify({ v: 1, nickname: '玥玥' })
  });
  PS.useStore(b);
  const before = JSON.stringify(b.raw());

  PS.setHelper(false);
  const afterHelper = b.raw();
  eq(JSON.parse(afterHelper[K.progress])['p1'].level, 1, '改注音开关不动进度域');
  eq(JSON.parse(afterHelper[K.profile]).nickname, '玥玥', '改注音开关不动账号域档案');
  eq(JSON.parse(afterHelper[K.settings]).grade, 3, '改注音开关不动账号域其他字段（读改写不整份覆盖）');

  // 反向：写设置不许碰设备域与进度域
  PS.useStore(mem({ [K.settings]: JSON.stringify({}), [K.profile]: JSON.stringify({ nickname: '小明' }) }));
  const b2 = PS.store();
  PS.saveSettings({ grade: 5, helper: 'on' });
  eq(b2.raw()[K.progress], undefined, '写设置不写进度域');
  eq(JSON.parse(b2.raw()[K.settings]).username, undefined,
    '写设置不把 username 带进去（它住 poem_profile_v1，见 js/avatar.js）');
  eq(JSON.parse(b2.raw()[K.profile]).nickname, '小明', '写设置不动档案');

  // 清进度：只清进度域
  const b3 = mem({
    [K.progress]: JSON.stringify({ p1: { level: 1 } }),
    [K.settings]: JSON.stringify({ grade: 3 }),
    [K.profile]: JSON.stringify({ nickname: '玥玥' }),
    [K.device]: JSON.stringify({ v: 1, helper: 'off' })
  });
  PS.useStore(b3);
  PS.clearProgress();
  eq(b3.raw()[K.progress], undefined, 'clearProgress 清掉进度域');
  eq(JSON.parse(b3.raw()[K.profile]).nickname, '玥玥', '清进度**不删**昵称（守住那个误删 bug）');
  eq(JSON.parse(b3.raw()[K.device]).helper, 'off', '清进度**不删**设备偏好（阅读辅助别被一起清掉）');
  eq(JSON.parse(b3.raw()[K.settings]).grade, 3, '清进度不删账号域设置');
  chk(before.length > 0, '（分隔：上面那轮用的是另一份存储，互不干扰）');
}

console.log('\n=== 六、已读域：六把键不合并不改名，只是读写一处收敛 ===');
{
  const b = mem({ poem_classic_read_v1: JSON.stringify({ 'gw-1': true }) });
  PS.useStore(b);
  eq(JSON.stringify(PS.readMap('poem_classic_read_v1')), '{"gw-1":true}', '读得回老的已读映射');
  PS.setRead('poem_classic_read_v1', 'gw-2', true);
  eq(JSON.parse(b.raw().poem_classic_read_v1)['gw-2'], true, '标记已读');
  PS.setRead('poem_classic_read_v1', 'gw-1', false);
  eq(JSON.parse(b.raw().poem_classic_read_v1)['gw-1'], undefined, '取消已读是删键不是写 false');
  eq(PS.readMap('poem_no_such_read_v1').constructor, Object, '没存过的已读键读出空对象，不抛');
}

console.log('\n=== 七、导出 / 导入：宽进严出，老版本也读得懂 ===');
{
  const b = mem({
    [K.progress]: JSON.stringify({ p1: { level: 2 } }),
    [K.settings]: JSON.stringify({ grade: 6, scope: 'all' }),
    [K.device]: JSON.stringify({ v: 1, helper: 'off' })
  });
  PS.useStore(b);
  const json = PS.exportJSON();
  const data = JSON.parse(json);
  chk(!!data.exportedAt, '导出带 exportedAt（老形状不动）');
  eq(data.progress.p1.level, 2, '导出带进度域');
  eq(data.settings.grade, 6, '导出带账号域设置');
  eq(data.settings.helper, 'off', '导出的 settings 里补上 helper —— 老版本导入后才不会把它变回默认');

  /* 导入到一份干净盘：每件数据各回各的域 */
  const b2 = mem();
  PS.useStore(b2);
  PS.importJSON(json);
  eq(JSON.parse(b2.raw()[K.progress]).p1.level, 2, '导入把进度写回进度域');
  eq(JSON.parse(b2.raw()[K.settings]).grade, 6, '导入把 grade 写回账号域');
  eq(JSON.parse(b2.raw()[K.device]).helper, 'off', '导入把 helper 写回设备域（没有写进设置对象）');
  eq(PS.helper(), 'off', '导入后读出来的阅读辅助就是备份里那一档');

  /* 老备份（没有 device 域，helper 混在 settings 里） */
  const b3 = mem();
  PS.useStore(b3);
  PS.importJSON(JSON.stringify({ progress: { p9: { level: 1 } }, settings: { helper: 'on', grade: 2 } }));
  eq(JSON.parse(b3.raw()[K.device]).helper, 'on', '老备份里的 helper 也迁到设备域');
  eq(PS.settings().grade, 2, '老备份里的账号域字段照收');

  /* 脏备份：认不出的域静默忽略，格式错才抛 */
  const b4 = mem();
  PS.useStore(b4);
  PS.importJSON(JSON.stringify({ progress: 'not-an-object', settings: { grade: 7 }, 未来字段: 1 }));
  eq(b4.raw()[K.progress], undefined, 'progress 不是对象 → 不写盘（宁可少收也不写坏）');
  eq(PS.settings().grade, 7, '同一份备份里合法的部分照收');
  let threw = false;
  try { PS.importJSON('不是 JSON'); } catch (e) { threw = /格式不正确/.test(e.message); }
  chk(threw, '不是 JSON 时抛出「格式不正确」（与老实现同一句文案）');
  threw = false;
  try { PS.importJSON('[1,2]'); } catch (e) { threw = true; }
  chk(threw, 'JSON 是数组也拒绝（老实现同一口径）');
}

console.log('\n=== 八、降级：存储不可用 / 写满，一律不抛 ===');
{
  PS.useStore(null);
  eq(JSON.stringify(PS.all()), '{}', '没有存储时读回空表，不抛');
  eq(PS.set('p1', { level: 1 }), false, '没有存储时 set 返回 false（调用方据此降级）');
  eq(PS.settings().grade, 1, '没有存储时给出厂默认');
  eq(PS.helper(), 'on', '没有存储时 helper 给出厂默认');
  eq(JSON.stringify(PS.pruneUnknown(['a'])), '[]', '没有存储时 pruneUnknown 返回空数组');
  chk(!!JSON.parse(PS.exportJSON()).progress, '没有存储时导出仍是一份合法备份');

  PS.useStore(full({ [K.settings]: JSON.stringify({ grade: 3 }) }));
  eq(PS.set('p1', { level: 1 }), false, '写满时 set 返回 false 而不是抛');
  eq(PS.settings().grade, 3, '写满时旧值仍读得回来（没有被写坏）');
  let resetThrew = false;
  try { PS.reset(); } catch (e) { resetThrew = true; }
  chk(!resetThrew, 'reset() 之后不抛（回到环境默认存储）');
  eq(JSON.stringify(PS.all()), '{}', 'reset 后回到环境默认存储（node 里没有 localStorage，读回空表）');
}

console.log('\n=== 九、分域口径：哪把键能上云，由这一张表说了算 ===');
{
  const scopes = PS.scopes();
  const map = {};
  scopes.forEach(s => { map[s.key] = s; });
  eq(map[K.progress].local, false, '进度域：跨设备一致（将来要上云）');
  eq(map[K.settings].domain, 'account', '设置域属账号域');
  eq(map[K.profile].local, false, '档案（昵称 + 字符印）属账号域');
  eq(map[K.device].local, true, '设备域：本机数据，同步层不许碰');
  eq(PS.isLocalKey(K.device), true, 'isLocalKey 认得出设备域');
  eq(PS.isLocalKey(K.progress), false, 'isLocalKey 认得出账号域');
  eq(PS.isLocalKey('poem_something_else_v1'), true, '认不出的键一律当本机数据（不上云是安全的一侧）');
  eq(PS.isLocalKey('poem_font_v1'), true, '字号是本机数据（原地不动的老键）');
}

console.log('\n=== 十、设置域拆家后的字段表：账号域不含 helper、设备域只有 helper ===');
{
  chk(PS.FIELDS.settings.indexOf('helper') === -1, '账号域白名单里没有 helper（它搬去设备域了）');
  ['grade', 'term', 'scope', 'dailyCount', 'algo'].forEach(k =>
    chk(PS.FIELDS.settings.indexOf(k) > -1, '账号域白名单含 ' + k + '（用户裁决：跨设备一致）'));
  eq(JSON.stringify(PS.FIELDS.device), '["helper"]', '设备域当前只有 helper 一件');
  chk(PS.FIELDS.settings.indexOf('username') === -1,
    'username 不在设置域白名单里（它住 poem_profile_v1）');
}

console.log('\n=== 十一、源码扫描：加载了 storage.js 的页面必须先加载 progress-store.js ===');
{
  const pages = [];
  (function walk(dir, rel) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'test' || e.name === 'scripts') return;
      const full = path.join(dir, e.name);
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) return walk(full, r);
      if (e.name === 'index.html') pages.push(r);
    });
  })(ROOT, '');

  let withStorage = 0;
  pages.forEach(p => {
    const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
    if (!/js\/storage\.js/.test(html)) return;
    withStorage++;
    chk(/js\/progress-store\.js/.test(html), p + ' 加载了 progress-store.js（storage.js 是它的转发层）');
    /* 只看 <script src> 行 —— 行号差直接比会踩到注释里那句「必须排在 storage.js 之前」 */
    const order = [];
    html.split('\n').forEach((ln, i) => {
      if (ln.indexOf('<script') === -1) return;
      if (ln.indexOf('js/progress-store.js') > -1) order.push(['ps', i]);
      if (ln.indexOf('js/storage.js') > -1) order.push(['st', i]);
    });
    chk(order.length && order[0][0] === 'ps',
      p + ' 里 progress-store.js 排在 storage.js 之前（顺序反了不报错、只少数据）');
  });
  chk(withStorage >= 12, '至少 12 张页在读设置 / 进度（实际 ' + withStorage + ' 张）');

  /* ⚠️ 反向那一条（Issue #163）：**加载了引擎的页面也必须加载转发层**。
     六部集子页与搜索 / 课外入口页此前只加载 progress-store.js、没加载
     js/storage.js —— 页面上 window.Storage 一直是 undefined，
     凡走它的地方都静默退化成「读不到」。这条不是「少数据」，是「整层不在」，
     却同样不报错：搜索页接上「上次搜的词」时才被翻出来。 */
  pages.forEach(p => {
    const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
    if (!/js\/progress-store\.js/.test(html)) return;
    chk(/js\/storage\.js/.test(html),
      p + ' 加载了 progress-store.js，也加载了它的转发层 js/storage.js');
  });

  /* 六部集子页与设置页**直接**读 helper / 已读键，它们不经过 storage.js ——
     但 reader-core.js 里那段读写必须与引擎同源，不能各写各的字面量 */
  const rc = fs.readFileSync(path.join(ROOT, 'js/reader-core.js'), 'utf8');
  chk(/ProgressStore/.test(rc), 'js/reader-core.js 的阅读偏好走 ProgressStore（不自己拼键名）');
  chk(/ProgressStore\.helper\(\)/.test(rc), '集子页的「阅读辅助」开关就是引擎里那一份（同源）');
  chk(/ProgressStore\.setHelper\(/.test(rc), '集子页写开关也走引擎（不自己拼两处 setItem）');
  const eng = fs.readFileSync(path.join(ROOT, 'js/progress-store.js'), 'utf8');
  chk(/poem_device_prefs_v1/.test(eng), '设备域键名只在引擎里有一份定义');
  chk(/poem_recite_progress_v1/.test(eng), '进度域键名只在引擎里有一份定义');
  const st = fs.readFileSync(path.join(ROOT, 'js/storage.js'), 'utf8');
  chk(!/function readAll/.test(st), 'storage.js 已不再自带一份 readAll 实现（只是转发层）');
  chk(/ProgressStore/.test(st), 'storage.js 明写它转发给 ProgressStore');
}

console.log('\n=== 十二、契约：Storage 的对外签名一个都没改 ===');
{
  const st = fs.readFileSync(path.join(ROOT, 'js/storage.js'), 'utf8');
  ['get', 'set', 'setMany', 'all', 'clear', 'pruneUnknown', 'exportJSON', 'importJSON',
    'getSettings', 'saveSettings'].forEach(fn => {
      chk(new RegExp('\\n\\s{4}' + fn + ':').test(st), 'Storage.' + fn + ' 仍在（老调用点 500 处不用改）');
    });
  chk(!/=>/.test(st), 'storage.js 里没有箭头函数（与引擎同一档语法，老浏览器白屏风险为零）');
  chk(!/\b(const|let)\s+\w+\s*=/.test(st.replace(/\/\*[\s\S]*?\*\//g, '')), 'storage.js 不用 const/let');
}

console.log('');
console.log(fails === 0 ? '🎉 ProgressStore 分域测试全部通过' : '❌ ProgressStore 测试 ' + fails + ' 项失败');
process.exit(fails === 0 ? 0 : 1);
