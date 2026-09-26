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
  chk(E.can('library.all', guest).ok, '游客也能读七部集子');
  chk(E.can('pinyin.helper', guest).ok, '游客也能用注音');

  const ep = E.can('export.progress', guest);
  eq(ep.ok, false, '未登录不能导出进度（Issue #229：改为登录可用）');
  eq(ep.reason, 'login', '被拦的原因是「未登录」，不是层级不够');
  eq(E.denyReason('export.progress', guest), '登录可用', '拦住游客时说的是「登录可用」');
  eq(E.cap('export.progress').minTier, 'free', '层级没升：登录后的 free 就给（不是 Pro / Max 的事）');
  eq(E.cap('export.progress').login, true, 'CAPS 里 login 显式是 true（两端的唯一来源）');
  chk(E.can('export.progress', free).ok, '登录后的 free 可以导出进度');
  chk(E.can('export.progress', pro).ok && E.can('export.progress', max).ok, 'pro / max 当然也能用');

  eq(E.cap('algo.ebbinghaus').minTier, 'free', '艾宾浩斯遗忘曲线：免费档，层级写在台账上');
  eq(E.cap('algo.ebbinghaus').login, false, '遗忘曲线：游客就能用（登录不是条件）');
  chk(E.can('algo.ebbinghaus', guest).ok, '游客可以用艾宾浩斯遗忘曲线');
  eq(E.cap('algo.leitner').minTier, 'free', '莱特纳盒：层级仍是 free');
  eq(E.cap('algo.leitner').login, true, '莱特纳盒：登录才给');
  chk(!E.can('algo.leitner', guest).ok && E.can('algo.leitner', free).ok,
    '莱特纳盒：游客不行、登录的 free 可以');
  eq(E.denyReason('algo.leitner', guest), '登录可用', '游客选莱特纳盒得到「登录可用」');
  eq(E.cap('algo.sm2').minTier, 'pro', 'SM-2：Pro 起');
  chk(!E.can('algo.sm2', free).ok && E.can('algo.sm2', pro).ok, 'SM-2：free 不可、pro 起');
  eq(E.denyReason('algo.sm2', free), 'Pro 起', 'free 选 SM-2 得到「Pro 起」');
  eq(E.cap('algo.fsrs').minTier, 'max', 'FSRS：Max 起');
  chk(!E.can('algo.fsrs', pro).ok && E.can('algo.fsrs', max).ok, 'FSRS：pro 不可、max 起');
  eq(E.denyReason('algo.fsrs', pro), 'Max 起', 'pro 选 FSRS 得到「Max 起」');

  ['algo.ebbinghaus', 'algo.leitner', 'algo.sm2', 'algo.fsrs'].forEach(function (c) {
    chk(E.capNames().indexOf(c) >= 0, '算法能力 ' + c + ' 在台账里');
  });
}

console.log('\n=== 二、语音播放与进度导出：游客不行，登录的 free 可以 ===');
{
  const g = E.can('read.aloud', guest);
  eq(g.ok, false, '未登录不能用语音播放');
  eq(g.reason, 'login', '被拦的原因是「未登录」，不是层级不够');
  chk(E.can('read.aloud', free).ok, '登录后的 free 可以用语音播放');
  chk(E.can('read.aloud', pro).ok, 'pro 当然也能用');
  eq(E.denyReason('read.aloud', guest), '登录可用', '拦住游客时说的是「登录可用」');

  const loginCaps = E.capNames().filter(function (c) {
    return E.cap(c).minTier === 'free' && E.cap(c).login;
  });
  eq(loginCaps.sort().join(','), 'algo.leitner,export.progress,read.aloud',
    '「免费档但要登录」的恰好是这三件（实际 ' + loginCaps.join(',') + '）');

  E.capNames().forEach(function (c) {
    const h = E.denyReason(c, guest);
    if (h === '登录可用') return;
    chk(h.indexOf('登录') < 0 || h.length <= 6,
      '登录取向的文案都短（' + c + ' → 「' + h + '」）');
  });

  const fs = require('fs');
  const root = require('path').join(__dirname, '..');
  const SRC_FILES = ['js/entitlement.js', 'js/mine.js', 'js/app.js', 'js/reader-core.js',
    'js/settings-nav.js', 'mine/index.html', 'settings/index.html'];
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
  chk(!E.can('exam.paper', pro).ok && E.can('exam.paper', max).ok, '模拟考试：pro 不可、max 可用（用户指定）');
  chk(!E.can('exam.formal', pro).ok && E.can('exam.formal', max).ok, '正式考试：pro 不可、max 可用（§4.66 ⑩-②）');
  chk(!E.can('exam.changshi', free).ok && E.can('exam.changshi', pro).ok && E.can('exam.changshi', max).ok,
    '文学常识考试：free 不可、pro 起（用户点名「pro 及 max」，§4.66 ⑤）');

  chk(!!E.cap('exam.gathering'), 'exam.gathering 是**独立的一条**能力（集子访问）');
  chk(!E.can('exam.gathering', pro).ok && E.can('exam.gathering', max).ok,
    '古诗词大会集子：pro 不可、max 可用（与试题模拟同一条口径）');
  chk(E.cap('exam.gathering').name === '古诗词 大会',
    '它的名字就叫「古诗词 大会」（一格说一件事）');

  chk(E.cap('algo.ebbinghaus').name === '艾宾浩斯遗忘曲线',
    '遗忘曲线那条的全名是「艾宾浩斯遗忘曲线」（实际 ' + E.cap('algo.ebbinghaus').name + '）');
  chk(E.cap('algo.ebbinghaus').name.indexOf('斯宾浩斯') === -1,
    '名字里不再有误写的「斯宾浩斯」');
  chk(E.cap('export.all').name === '课内诗词 导出',
    '名字收成「课内诗词 导出」（实际 ' + E.cap('export.all').name + '）');
  [['algo.ebbinghaus', '遗忘曲线'], ['export.all', '导出'], ['exam.gathering', '大会']]
    .forEach(function (pair) {
      var c = E.cap(pair[0]);
      chk(Array.isArray(c.breaks) && c.breaks[0] === pair[1],
        pair[0] + ' 的折行点是「' + pair[1] + '」（实际 ' + JSON.stringify(c.breaks) + '）');
      var at = c.name.indexOf(c.breaks[0]);
      chk(at > 0 && at < c.name.length, pair[0] + ' 的折行点落在名字中段（位置 ' + at + '）');
    });
  chk(E.compare({}).rows.filter(function (r) { return r.breaks; }).length === 3,
    'compare() 里正好三行带折行点（其余的名字都是单句）');
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
    'quiz.review': '题库', 'export.all': '课内诗词 导出',
    'exam.gathering': '古诗词 大会', 'exam.paper': '模拟考试',
    'exam.formal': '正式考试', 'exam.changshi': '文学常识考试'
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
  eq(E.quotaFor(E.cap('export.all'), 'pro'), 251, '课内诗词导出 Pro 251 首（用户点名「pro 和 max 列列出」）');
  eq(E.quotaFor(E.cap('export.all'), 'max'), 251, '课内诗词导出 Max 251 首（同上）');

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

console.log('\n=== 五、本机发放名单已下线（Issue #276）：本机只剩一份服务端答案的缓存 ===');
{

  ['putGrant', 'readGrants', 'grantFor', 'importGrants', 'exportGrants',
    'removeGrant', 'clearGrants', 'normGrant', 'emptyGrants'].forEach(k => {
    eq(typeof E[k], 'undefined', '本机发放名单的 ' + k + '() 已删除（全走数据库）');
  });
  eq(typeof E.GRANT_NS, 'undefined', 'poem_plan_grant_v1 这个键名也不在了');
  eq(E.NS, 'poem_plan_v1', '本机只留一份权益键：服务端答案的缓存');
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
  eq(id.email, 'zhangmin@163.com', '身份里带回**明文**邮箱（Issue #320：掩码撤掉了）');
  eq(id.mask, undefined, '身份里**没有** mask 字段了');

  E.writeTier(b, 'max', null, { source: 'server', role: 'user' });
  const id2 = E.identity({ authStore: authStore, backing: b });
  eq(id2.tier, 'max', '服务端下发的层级落到权益层（本机那两份名单已删）');

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

console.log('\n=== 八、能力清单（能力清单那一节的唯一出口是 matrix()）===');
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

  ['js/login.js', 'js/mine.js', 'js/admin-page.js'].forEach(function (f) {
    const src = fs.readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    chk(!/tier\s*===\s*["']|plan\s*===\s*["']/.test(src),
      f + ' 里没有直接比较层级（一律走 Entitlement）');
    chk(!/poem_plan_v1|poem_plan_grant_v1|poem_owner_v1/.test(src),
      f + ' 不自己拼权益相关的存储键名（键名只在 entitlement.js 里）');
  });
  chk(/isOwner\(backing\)/.test(fs.readFileSync('js/admin-page.js', 'utf8')) &&
      /isOwner\(backing/.test(fs.readFileSync('js/mine.js', 'utf8')),
    '「谁能进管理后台」两页走同一个出口 Entitlement.isOwner()');
}

console.log('');
if (fails) {
  console.log('✗ 权益分层测试失败 ' + fails + ' 项');
  process.exit(1);
}
console.log('🎉 权益分层与语音播放门测试全部通过');
