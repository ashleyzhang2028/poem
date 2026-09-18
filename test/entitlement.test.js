const E = require('../js/entitlement.js');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };
const eq = (a, b, m) => chk(a === b, m + '（实际 ' + JSON.stringify(a) + '）');

function mem() {
  const m = {};
  return {
    getItem: k => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: k => { delete m[k]; },
    raw: () => m
  };
}

const guest = { tier: 'free', signedIn: false };
const free = { tier: 'free', signedIn: true };
const pro = { tier: 'pro', signedIn: true };
const max = { tier: 'max', signedIn: true };

console.log('=== 一、免费不残缺：今天能用的，free 登录后一键不少 ===');
{
  ['recite.basic', 'library.all', 'read.aloud', 'pinyin.helper', 'export.progress'].forEach(function (c) {
    chk(E.can(c, free).ok, 'free 可用 ' + c + '（' + E.cap(c).name + '）');
  });
  chk(E.can('recite.basic', guest).ok, '游客也能背诵（打开即用，不被登录拦）');
  chk(E.can('library.all', guest).ok, '游客也能读六部集子');
  chk(E.can('pinyin.helper', guest).ok, '游客也能用注音');

  // Issue #229 第二轮（用户原话）：「层级页面 进度导出 功能改为登录可用，
  // 实际功能也按这个修改。」—— 层级仍是 free（登录后免费就给），
  // 但**未登录不放行**，与语音朗读同一档。
  const ep = E.can('export.progress', guest);
  eq(ep.ok, false, '未登录不能导出进度（Issue #229：改为登录可用）');
  eq(ep.reason, 'login', '被拦的原因是「未登录」，不是层级不够');
  eq(E.denyReason('export.progress', guest), '登录可用', '拦住游客时说的是「登录可用」');
  eq(E.cap('export.progress').minTier, 'free', '层级没升：登录后的 free 就给（不是 Pro / Max 的事）');
  eq(E.cap('export.progress').login, true, 'CAPS 里 login 显式是 true（两端的唯一来源）');
  chk(E.can('export.progress', free).ok, '登录后的 free 可以导出进度');
  chk(E.can('export.progress', pro).ok && E.can('export.progress', max).ok, 'pro / max 当然也能用');
}

console.log('\n=== 二、语音播放与进度导出：游客不行，登录的 free 可以 ===');
{
  const g = E.can('read.aloud', guest);
  eq(g.ok, false, '未登录不能用语音播放');
  eq(g.reason, 'login', '被拦的原因是「未登录」，不是层级不够');
  chk(E.can('read.aloud', free).ok, '登录后的 free 可以用语音播放');
  chk(E.can('read.aloud', pro).ok, 'pro 当然也能用');
  eq(E.denyReason('read.aloud', guest), '登录可用', '拦住游客时说的是「登录可用」');

  // 登录取向的那几件现在是两件：语音朗读 + 进度导出（Issue #229）。
  const loginCaps = E.capNames().filter(function (c) {
    return E.cap(c).minTier === 'free' && E.cap(c).login;
  });
  eq(loginCaps.sort().join(','), 'export.progress,read.aloud',
    '「免费档但要登录」的恰好是这两件（实际 ' + loginCaps.join(',') + '）');

  E.capNames().forEach(function (c) {
    const h = E.denyReason(c, guest);
    if (h === '登录可用') return;
    chk(h.indexOf('登录') < 0 || h.length <= 6,
      '登录取向的文案都短（' + c + ' → 「' + h + '」）');
  });

  const fs = require('fs');
  const root = require('path').join(__dirname, '..');
  const SRC_FILES = ['js/entitlement.js', 'js/profile.js', 'js/app.js', 'js/reader-core.js',
    'js/settings-nav.js', 'profile/index.html', 'settings/index.html'];
  SRC_FILES.forEach(function (f) {
    const src = fs.readFileSync(root + '/' + f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
      .split('\n').map(l => l.replace(/^\s*\/\/.*$/, ' ')).join('\n');
    chk(src.indexOf('登录可用语音朗读') < 0,
      f + ' 里不再出现「登录可用语音朗读」这一串（按钮写事、理由三个字）');
  });
}

console.log('\n=== 三、pro / max 只加不减：层级越高能力单调不减 ===');
{
  const trinity = [guest, free, pro, max];
  E.capNames().forEach(function (c) {

    let prev = E.can(c, trinity[0]).ok;
    for (let i = 1; i < trinity.length; i++) {
      const now = E.can(c, trinity[i]).ok;
      chk(!(prev && !now), '单调性：' + c + ' 在 ' + trinity[i].tier + '/' + trinity[i].signedIn + ' 不被收回');
      prev = now;
    }
  });

  chk(!E.can('feihualing', pro).ok && E.can('feihualing', max).ok, '飞花令：pro 不可、max 可用（用户指定）');
  chk(!E.can('exam.paper', pro).ok && E.can('exam.paper', max).ok, '试题模拟：pro 不可、max 可用（用户指定）');

  chk(!!E.cap('exam.gathering'), 'exam.gathering 是**独立的一条**能力（集子访问）');
  chk(!E.can('exam.gathering', pro).ok && E.can('exam.gathering', max).ok,
    '古诗词大会集子：pro 不可、max 可用（与试题模拟同一条口径）');
  chk(E.cap('exam.gathering').name === '古诗词大会', '它的名字就叫「古诗词大会」（一格说一件事）');
  chk(!E.can('quiz.review', free).ok && E.can('quiz.review', pro).ok, '题库复习：free 不可、pro 起');
  chk(!E.can('sync.multiDevice', free).ok && E.can('sync.multiDevice', pro).ok, '跨设备云同步：pro 起');

  chk(!E.cap('ai.explain'), 'AI 讲解能力**已删除**（收 app 费用的功能不留）');
  chk(!E.cap('ai.explain.big'), 'AI 讲解 max 档**已删除**');
  chk(E.capNames().every(k => !/^ai\./.test(k)), '能力表里**没有任何** ai.* 能力');

  eq(E.can('export.all', pro).ok, true, '课内诗词导出：pro 起（用户指定）');
  eq(E.can('export.all', max).ok, true, 'max 当然也能用');
  eq(E.can('export.all', free).ok, false, 'free 不可（登录了也不行）');
  chk(/课内/.test(E.cap('export.all').name), '能力名字里写明是「课内」（不许含糊成全站）');

  const renames = {
    'recite.basic': '每日背诵', 'library.all': '课外阅读', 'read.aloud': '语音朗读',
    'pinyin.helper': '阅读辅助', 'export.progress': '进度导出',
    'collections.many': '自选清单', 'sync.multiDevice': '设备同步',
    'export.paper': 'PDF / 打印', 'profile.family': '子用户',
    'quiz.review': '题库', 'export.all': '课内诗词导出',
    'exam.gathering': '古诗词大会', 'exam.paper': '试题模拟'
  };
  Object.keys(renames).forEach(function (k) {
    eq(E.cap(k).name, renames[k], 'Issue #163 改名：' + k + ' → 「' + renames[k] + '」');
  });
  E.capNames().forEach(function (k) {
    const c = E.cap(k);
    if (!c) return;

    chk(c.name.length <= 8, '能力名都短到能在一列里放下：「' + c.name + '」（' + c.name.length + ' 字）');
    chk(c.name.indexOf('（') < 0 && c.name.indexOf('(') < 0,
      '能力名不带括号（括号里的额度搬到 quotas 上）：「' + c.name + '」');
    chk(c.name.indexOf(' · ') < 0, '能力名里不塞两件事：「' + c.name + '」');
  });

  eq(E.quotaFor(E.cap('collections.many'), 'free'), 10, '自选清单 Free 10 个（用户点名）');
  eq(E.quotaFor(E.cap('collections.many'), 'pro'), 100, '自选清单 Pro 100 个（用户点名）');
  eq(E.quotaFor(E.cap('collections.many'), 'max'), 5000, '自选清单 Max 5000 个（用户点名）');
  eq(E.quotaFor(E.cap('profile.family'), 'free'), 1, '子用户 Free 1 个');
  eq(E.quotaFor(E.cap('profile.family'), 'pro'), 3, '子用户 Pro 3 个');
  eq(E.quotaFor(E.cap('profile.family'), 'max'), 180, '子用户 Max 180 个');
  eq(E.quotaFor(E.cap('export.all'), 'pro'), 261, '课内诗词导出 Pro 261 首（用户点名「pro 和 max 列列出 261 首」）');
  eq(E.quotaFor(E.cap('export.all'), 'max'), 261, '课内诗词导出 Max 261 首（同上）');

  eq(E.quotaFor({ quota: 50 }, 'pro'), 50, '没有 quotas 的能力回落 quota');
  eq(E.quotaFor({ quota: null }, 'pro'), null, '既没 quotas 也没 quota → null（这一格没有数字可说）');
  eq(E.quotaText(5000), '5000 个', '额度文案不带千分位（5,000 在窄格子会被读成两个数）');
  eq(E.quotaText(Infinity), '不限', 'Infinity 写作「不限」');
  eq(E.quotaText(0), '不支持', '0 写作「不支持」（不是「0 个」）');
}

console.log('\n=== 四、唯一出口：脏值 / 未知能力 / 缺参一律回落，不抛 ===');
{
  chk(!E.can('不存在的功能', free).ok, '未知能力一律不可用');
  eq(E.can('不存在的功能', free).reason, 'unknown', '未知能力给出 unknown 原因');
  chk(E.can('recite.basic', {}).ok, '缺 ctx 时按游客处理，不抛');
  chk(E.can('recite.basic', null).ok, 'ctx = null 也不抛');
  chk(E.can('feihualing', { tier: 'PRO', signedIn: true }).ok === false, '大小写写错的层级按 free 处理');
  chk(E.can('feihualing', { tier: 'ultra', signedIn: true }).ok === false, '不认识的层级按 free 处理');
  eq(E.tierLabel('ultra'), 'Free', '脏层级标签回落 Free');
  eq(E.tierLabel('max'), 'Max', 'max 标签正确');
  chk(E.capNames().length >= E.capNames().filter(k => !!E.cap(k)).length, 'capNames 里每个名字都能查到能力');
}

console.log('\n=== 五、本机发放名单：可导出可粘贴、脏记录一律丢掉 ===');
{
  const b = mem();
  eq(E.removeGrant(b, 'x@qq.com').removed, 0, '空名单删除返回 0');
  const bad = E.putGrant(b, { tier: 'pro' });
  eq(bad.ok, false, '缺邮箱掩码的发放记录被拒');
  const bad2 = E.putGrant(b, { emailMask: 'a***@qq.com', tier: 'vip' });
  eq(bad2.ok, false, '不认识的层级不被写入（不会悄悄变成 free）');
  const ok = E.putGrant(b, { emailMask: 'A***@QQ.com', tier: 'pro', note: '内测家长' });
  chk(ok.ok, '正常发放记录写入成功');
  eq(E.grantFor(b, 'a***@qq.com').tier, 'pro', '掩码大小写归一化后可匹配');
  E.putGrant(b, { emailMask: 'a***@qq.com', tier: 'max' });
  eq(E.readGrants(b).grants.length, 1, '同掩码只保留最新一条');
  eq(E.grantFor(b, 'a***@qq.com').tier, 'max', '后发的层级覆盖先前那条');
  E.putGrant(b, { emailMask: 'b***@163.com', tier: 'pro', until: 1000 });
  eq(E.grantFor(b, 'b***@163.com', 2000), null, '过期记录不生效');
  chk(!!E.grantFor(b, 'b***@163.com', 500), '未过期记录生效');
  const text = E.exportGrants(b);
  const b2 = mem();
  const imp = E.importGrants(b2, text);
  chk(imp.ok && imp.count === 2, '名单可导出后粘贴进另一台设备');
  eq(E.importGrants(b2, '不是 json').ok, false, '坏名单被拒且不抛');
  eq(E.importGrants(b2, '{"grants":{}}').ok, false, '形状不对的名单被拒');
  E.clearGrants(b);
  eq(E.readGrants(b).grants.length, 0, '清空名单可用');
  chk(E.readGrants(null).grants.length === 0, '没有存储时名单为空，不抛');
}

console.log('\n=== 六、本机会话层级：到期即回落 ===');
{
  const b = mem();
  eq(E.readTier(b), 'free', '没有记录时是 free');
  E.writeTier(b, 'pro');
  eq(E.readTier(b), 'pro', '写入即时生效');
  E.writeTier(b, 'max', Date.now() + 86400000);
  eq(E.readTier(b), 'max', '未到期的 max 生效');
  E.writeTier(b, 'max', Date.now() - 1000);
  eq(E.readTier(b), 'free', '已到期回落 free（不靠后台任务清理）');
  E.writeTier(b, 'pro', null);
  b.setItem(E.NS, '{坏数据');
  eq(E.readTier(b), 'free', '脏存储回落 free，不抛');
  eq(E.writeTier(b, 'vip').ok, false, '写入未知层级被拒');
  E.clearTier(b);
  eq(E.readTier(b), 'free', '清空后回到 free');
  eq(E.writeTier(null, 'pro').ok, false, '没有存储时写入返回失败，不抛');
}

console.log('\n=== 七、身份合成：只认 AuthCore 会话，不认页面自己拼的 ctx ===');
{
  const A = require('../js/auth-core.js');
  E.setAuthCore(A);
  const b = mem();
  const authStore = A.makeStore(b);
  const g = E.identity({ authStore: authStore, backing: b });
  eq(g.signedIn, false, '没有会话时是游客');
  eq(g.tier, 'free', '游客层级是 free');
  eq(g.can('read.aloud').ok, false, '游客不能语音播放');
  eq(g.can('export.progress').ok, false, '游客不能导出进度（Issue #229 第二轮）');
  eq(g.hint('export.progress'), '登录可用', '游客点导出得到的是「登录可用」');
  eq(g.hint('feihualing'), '登录可用', '游客看付费功能：先提示登录（登录是硬条件）');

  eq(E.denyReason('feihualing', free), 'Max 起', '已登录的 free 看飞花令：提示 Max 起');
  eq(E.denyReason('quiz.review', free), 'Pro 起', '已登录的 free 看题库复习：提示 Pro 起');

  const req = A.requestCode(authStore, { channel: 'email', value: 'zhangmin@163.com' }, 'login', { code: '246810' });
  const v = A.verifyCode(authStore, req.codeId, '246810', 'login');
  chk(v.ok, '本机账号登录成功（复用 auth-core，未改它一行）');
  const id = E.identity({ authStore: authStore, backing: b });
  eq(id.signedIn, true, '会话被识别为已登录');
  eq(id.tier, 'free', '新账号仍是 free');
  eq(id.can('read.aloud').ok, true, '登录的 free 可以语音播放');
  eq(id.can('export.progress').ok, true, '登录的 free 也可以导出进度了');
  eq(id.mask, 'z***@163.com', '身份里带回邮箱掩码（供名单匹配）');

  E.putGrant(b, { emailMask: id.mask, tier: 'max' });
  const id2 = E.identity({ authStore: authStore, backing: b });
  eq(id2.tier, 'max', '发放名单命中后层级升到 max');

  eq(id2.can('feihualing').ok, true, '发了 max 之后拿到飞花令');
  eq(id2.can('read.aloud').ok, true, 'pro 的语音播放当然还在（只加不减）');
  eq(id2.label, 'Max', '标签显示 Max');

  A.signOut(authStore);
  E.writeTier(b, 'max');
  const id3 = E.identity({ authStore: authStore, backing: b });
  eq(id3.signedIn, false, '退出后是游客');
  eq(id3.tier, 'max', '本机层级仍保留（退出不降级，与「退出不动进度」同一口径）');
  eq(id3.can('read.aloud').ok, false, '游客即使有层级也不能语音播放（登录是硬条件）');
  eq(id3.can('export.progress').ok, false, '进度导出同样：有层级但没登录也不放行');
  E.clearTier(b);
}

console.log('\n=== 八、能力清单（/profile/ 的「权限」一节）===');
{
  const m = E.matrix(free);
  chk(m.length === Object.keys(E.CAPS).length, '清单条数与能力表一致');
  chk(m.every(x => typeof x.name === 'string' && x.name.length), '每条都有中文名');
  chk(m.filter(x => !x.ok).every(x => x.minTier !== 'free' || x.reason === 'login'), 'free 用不了的条目都写明门槛（不会出现「无理由锁住」）');
  const g = E.matrix(guest);
  chk(g.filter(x => x.cap === 'read.aloud')[0].ok === false, '游客清单里语音播放是灰的');
  chk(g.filter(x => x.cap === 'read.aloud')[0].hint === '登录可用', '灰掉的理由是「登录可用」');
  chk(g.filter(x => x.cap === 'export.progress')[0].ok === false, '游客清单里进度导出也是灰的');
  chk(g.filter(x => x.cap === 'export.progress')[0].hint === '登录可用', '理由同上：登录可用');
  chk(E.matrix(max).every(x => x.ok), 'max 的能力清单全绿（最高层不残留灰条）');
}

console.log('\n=== 九、语音门：与按钮置灰同源，放行后不打断在播的声音 ===');
{

  const spoken = [];
  global.window = {
    speechSynthesis: { speak: u => spoken.push(u), cancel() {}, getVoices: () => [] },
    SpeechSynthesisUtterance: function (t) { this.text = t; }
  };
  const path = require.resolve('../js/speech.js');
  delete require.cache[path];
  require('../js/speech.js');
  const S = global.window.Speech;
  chk(S.supported(), '假语音引擎可用');

  S.setGate(() => ({ ok: false, hint: '登录可用' }));
  eq(S.allowed().ok, false, '门关着时 allowed() 报 false（按钮据此置灰）');
  eq(S.speak('咏鹅'), false, '未登录：speak() 不出声');
  eq(spoken.length, 0, '未登录：语音引擎一次都没被调用');
  eq(S.speakQueue(['咏鹅'], {}), null, '未登录：连读也不出声');
  eq(spoken.length, 0, '未登录：队列同样没调用引擎');

  S.setGate(() => ({ ok: true, hint: '' }));
  eq(S.speak('咏鹅'), true, '登录后：speak() 出声');
  eq(spoken.length, 1, '登录后语音引擎被调用一次');
  S.setGate(() => ({ ok: false, hint: '' }));
  S.stop();
  S.setGate(() => ({ ok: true, hint: '' }));
  eq(S.speak('咏鹅'), true, '重新放行后可以再读');
  S.setGate(() => ({ ok: false, hint: '' }));
  chk(S.active() === true || S.speaking() === true || S.paused() === false,
      '放行之后门再关上，不会把已经出来的声音「锁住」（stop / pause 不受门限制）');
  S.stop();
  eq(S.speaking(), false, '停止永远有效 —— 门不会把人锁在声音里');

  S.setGate(null);
  delete global.window.Entitlement;
  eq(S.allowed().ok, true, '没有权益层时按不拦处理（防漏加载变成「点了没反应」）');
  eq(S.speak('咏鹅'), true, '没有权益层时照常出声');

  S.setGate(() => ({ ok: true }));
  delete global.window;
  delete require.cache[path];
}

console.log('\n=== 十、源码扫描：页面上不许自己拼 plan ===');
{
  const fs = require('fs');
  const files = ['js/app.js', 'js/reader-core.js', 'js/reader.js', 'js/settings.js', 'js/chrome.js'];
  files.forEach(function (f) {
    const src = fs.readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const hit = src.match(/tier\s*===\s*["']|plan\s*===\s*["']|plan\.tier\s*===/);
    chk(!hit, f + ' 里没有直接比较层级（一律走 Entitlement.can）');
  });
  const speechSrc = fs.readFileSync('js/speech.js', 'utf8');
  chk(/Entitlement/.test(speechSrc), 'speech.js 通过 Entitlement 判权益');
  chk(/function gate\(/.test(speechSrc) && /function allowed\(/.test(speechSrc), 'speech.js 有唯一的门与只读状态');
  ['js/app.js', 'js/reader-core.js'].forEach(function (f) {
    const src = fs.readFileSync(f, 'utf8');
    chk(/Speech\.allowed/.test(src), f + ' 的按钮状态读的是 Speech.allowed（与门同源）');
  });

  ['js/login.js', 'js/profile.js', 'js/admin-page.js'].forEach(function (f) {
    const src = fs.readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    chk(!/tier\s*===\s*["']|plan\s*===\s*["']/.test(src),
      f + ' 里没有直接比较层级（一律走 Entitlement）');
    chk(!/poem_plan_v1|poem_plan_grant_v1|poem_owner_v1/.test(src),
      f + ' 不自己拼权益相关的存储键名（键名只在 entitlement.js 里）');
  });
  chk(/isOwner\(backing\)/.test(fs.readFileSync('js/admin-page.js', 'utf8')) &&
      /isOwner\(backing\)/.test(fs.readFileSync('js/profile.js', 'utf8')),
    '「谁能进管理后台」两页走同一个出口 Entitlement.isOwner()');
}

console.log('\n=== 十一、管理员（role）：与层级正交，且是全站唯一出口 ===');
{
  const mem = function (init) {
    const m = Object.assign({}, init || {});
    return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, raw: () => m };
  };

  eq(E.isOwner(mem()), true, '全新机器上是主人（第一次打开后台不该被拒）');
  eq(E.isOwner(mem({ [E.OWNER_NS]: 'owner' })), true, '已落下主人标记 → 是主人');
  eq(E.isOwner(mem({ [E.OWNER_NS]: 'member' })), false, '标记是 member → 不是主人');
  eq(E.isOwner(mem({ [E.OWNER_NS]: '' })), true, '空标记当作「还没决定」→ 仍是主人（幂等）');
  eq(E.isOwner(null), true, '没有任何存储（隐私模式）→ 不拦人也不落标记');

  eq(E.isOwner(mem(), { role: 'user' }), false, '服务端下发的 role=user 优先于本机（1 期的口）');
  eq(E.isOwner(mem({ [E.OWNER_NS]: 'member' }), { role: 'owner' }), true,
    '服务端下发的 role=owner 优先于本机（1 期的口）');

  const b = mem();
  E.markOwner(b);
  eq(b.raw()[E.OWNER_NS], 'owner', 'markOwner 落下 owner 标记');
  E.markOwner(b);
  eq(b.raw()[E.OWNER_NS], 'owner', 'markOwner 连落两次结果一致（幂等）');

  const owner = E.identity({ backing: mem({ [E.OWNER_NS]: 'owner' }), authStore: null });
  eq(owner.role, 'owner', '本机主人：identity().role 是 owner');
  eq(owner.tier, 'free', '…但层级仍是 free —— 管理员不是「买了 Max 的人」');
  const member = E.identity({ backing: mem({ [E.OWNER_NS]: 'member' }), authStore: null });
  eq(member.role, 'user', '非主人：role 是 user');
  eq(E.tierLabel(member.tier), 'Free', '…层级照旧按发放名单算');
}

console.log('\n=== 十二、每条付费能力都得**真的有人管**（不许只写在能力表里）===');
{

  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..');

  function walk(dir, out) {
    fs.readdirSync(dir).forEach(function (name) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) { walk(p, out); return; }
      if (!/\.(js|html)$/.test(name)) return;
      out.push(p);
    });
    return out;
  }

  const files = []
    .concat(walk(path.join(root, 'js'), []))
    .concat(walk(path.join(root, 'api'), []))
    .concat(walk(path.join(root, 'settings'), []))
    .concat(walk(path.join(root, 'profile'), []))
    .concat(walk(path.join(root, 'plans'), []))
    .concat(walk(path.join(root, 'admin'), []));

  const sources = files.map(function (f) {
    return { rel: path.relative(root, f), text: fs.readFileSync(f, 'utf8') };
  });

  const DECL_ONLY = ['js/entitlement.js', 'api/_lib/core.js'];

  const EXEMPT = {

    'recite.basic': '免费档：打开即用，没有需要拦的地方（第一节断言钉着）',
    'library.all': '免费档：六部集子全文，一律可读',
    'pinyin.helper': '免费档：注音是阅读辅助，不做门槛',
    'export.progress': '免费档但要登录（Issue #229）：闸在 js/settings.js 的 #btn-export',
    'read.aloud': '语音播放：闸在 js/speech.js 的 gate()（有专门的第九节验它）',

    'collections.many': '按 tier 判（js/collections.js 的 limit()），读同一个门槛值',
    'collections.unlimited': '同上：max 档 → 不限'
  };

  const paid = E.capNames().filter(function (k) {
    const c = E.cap(k);
    return c && c.minTier !== 'free' && !EXEMPT[k];
  });

  chk(paid.length >= 6, '付费能力至少 6 条（实际 ' + paid.length + ' 条）');

  const unmanaged = paid.filter(function (k) {
    return !sources.some(function (s) {
      if (DECL_ONLY.indexOf(s.rel) >= 0) return false;
      return s.text.indexOf('"' + k + '"') >= 0 || s.text.indexOf("'" + k + "'") >= 0;
    });
  });

  chk(unmanaged.length === 0,
    '每条付费能力都有一处真的读它（没被读的：' + (unmanaged.join('、') || '无') + '）');

  const fake = 'zzz.never.read';
  const hit = sources.some(function (s) {
    if (DECL_ONLY.indexOf(s.rel) >= 0) return false;
    return s.text.indexOf('"' + fake + '"') >= 0;
  });
  chk(!hit, '反面样本：一个谁都不读的能力名，这把尺子判它「没人管」（断言有牙）');

  const ui = sources.filter(function (s) { return s.rel === 'js/sync-store.js'; })[0];
  chk(!!ui && /can\("sync\.multiDevice"\)/.test(ui.text),
    '界面层真的问了 can("sync.multiDevice")（js/sync-store.js）');
  const srv = sources.filter(function (s) { return s.rel === 'api/_lib/core.js'; })[0];
  chk(!!srv && /syncTierGate/.test(srv.text), '服务端有一条层级闸（core.syncTierGate）');
  chk(!!srv && /"sync\.multiDevice"/.test(srv.text), '服务端那道闸用的就是同一个键名');

  // **免费档但要登录**的那几件（minTier: free + login: true）每一件都得有一处
  // 真的问 can()。只在台账上写 login: true、界面上不判 —— 那就是一条写着的规矩而已，
  // 用户点下去照样能用（Issue #229 改的就是这一档）。
  const freeLogin = E.capNames().filter(function (k) {
    var c = E.cap(k);
    return c && c.minTier === 'free' && c.login;
  });
  const unGated = freeLogin.filter(function (k) {
    return !sources.some(function (s) {
      if (DECL_ONLY.indexOf(s.rel) >= 0) return false;
      return s.text.indexOf('can("' + k + '"') >= 0 || s.text.indexOf("can('" + k + "'") >= 0;
    });
  });
  chk(unGated.length === 0,
    '每件「免费但要登录」的能力都有一处真的问 can()（没问的：' + (unGated.join('、') || '无') + '）');
  chk(freeLogin.sort().join(',') === 'export.progress,read.aloud',
    '「免费但要登录」的恰好是「进度导出 + 语音朗读」两件（实际 ' + freeLogin.join(',') + '）');
}

console.log('');
if (fails) {
  console.log('✗ 权益分层测试失败 ' + fails + ' 项');
  process.exit(1);
}
console.log('🎉 权益分层与语音播放门测试全部通过');
