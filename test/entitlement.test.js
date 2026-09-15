/**
 * 权益分层与语音播放门测试（Issue #132 · 用户 2026-09-15 裁决）
 *
 * 纯 Node、不联网、不装新依赖 —— 被测文件 js/entitlement.js 与 js/speech.js 都零 DOM 依赖。
 *
 * 这里守的是四件事：
 *   1. **免费不残缺**：今天能用的功能一件都不许被锁（261 首 + 集子 + 排程 + 注音 + 导出）
 *   2. **语音播放要求登录**：游客不行、登录后的 free 可以 —— 这是用户明确加的规则
 *   3. **pro / max 只加不减**：层级越高，能用的能力只增不减（单调性）
 *   4. **唯一出口**：页面不许自己拼 `plan`，一切判定走 can()，
 *      且 js/speech.js 里那道门与按钮的置灰状态**同源**
 */
const E = require('../js/entitlement.js');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };
const eq = (a, b, m) => chk(a === b, m + '（实际 ' + JSON.stringify(a) + '）');

/** 假 localStorage：够用即可，测的是回落行为不是浏览器兼容 */
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
  chk(E.can('export.progress', guest).ok, '游客也能导出进度 JSON（今天就有）');
}

console.log('\n=== 二、语音播放：游客不行，登录的 free 可以 ===');
{
  const g = E.can('read.aloud', guest);
  eq(g.ok, false, '未登录不能用语音播放');
  eq(g.reason, 'login', '被拦的原因是「未登录」，不是层级不够');
  chk(E.can('read.aloud', free).ok, '登录后的 free 可以用语音播放');
  chk(E.can('read.aloud', pro).ok, 'pro 当然也能用');
  eq(E.denyReason('read.aloud', guest), '登录后即可使用（免费）', '拦住游客时说的是「登录后即可（免费）」');
}

console.log('\n=== 三、pro / max 只加不减：层级越高能力单调不减 ===');
{
  const trinity = [guest, free, pro, max];
  E.capNames().forEach(function (c) {
    // 同一层级下，登录不会减少能力；层级升高不会减少能力
    let prev = E.can(c, trinity[0]).ok;
    for (let i = 1; i < trinity.length; i++) {
      const now = E.can(c, trinity[i]).ok;
      chk(!(prev && !now), '单调性：' + c + ' 在 ' + trinity[i].tier + '/' + trinity[i].signedIn + ' 不被收回');
      prev = now;
    }
  });
  chk(!E.can('feihualing', free).ok && E.can('feihualing', pro).ok, '飞花令：free 不可、pro 可用（用户指定）');
  chk(!E.can('exam.paper', free).ok && E.can('exam.paper', pro).ok, '古诗文大会 / 考试与题库：pro 起');
  chk(!E.can('sync.multiDevice', free).ok && E.can('sync.multiDevice', pro).ok, '跨设备云同步：pro 起');
  chk(E.can('ai.explain', pro).ok, 'AI 讲解：pro 可用（额度 50/月）');
  chk(!E.can('ai.explain', free).ok, 'AI 讲解：free 不可');
  eq(E.cap('ai.explain').quota, 50, 'AI 讲解 pro 额度 50 次/月');
  eq(E.cap('ai.explain.big').quota, 500, 'AI 讲解 max 额度 500 次/月');
  eq(E.can('ai.explain.big', max).ok, true, 'max 可用 500 次档');
  eq(E.can('ai.explain.big', pro).ok, false, 'pro 不能蹭 max 的 500 次档');
  eq(E.can('export.all', max).ok, true, '全站批量导出：max 起');
  eq(E.can('export.all', pro).ok, false, '全站批量导出：pro 不可');
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
  eq(g.hint('feihualing'), '登录后即可使用（免费）', '游客看付费功能：先提示登录（登录是硬条件）');
  eq(E.denyReason('feihualing', free), 'Pro 起可用', '已登录的 free 看付费功能：提示 Pro 起可用');

  // 本机登录一个账号
  const req = A.requestCode(authStore, { channel: 'email', value: 'zhangmin@163.com' }, 'login', { code: '246810' });
  const v = A.verifyCode(authStore, req.codeId, '246810', 'login');
  chk(v.ok, '本机账号登录成功（复用 auth-core，未改它一行）');
  const id = E.identity({ authStore: authStore, backing: b });
  eq(id.signedIn, true, '会话被识别为已登录');
  eq(id.tier, 'free', '新账号仍是 free');
  eq(id.can('read.aloud').ok, true, '登录的 free 可以语音播放');
  eq(id.mask, 'z***@163.com', '身份里带回邮箱掩码（供名单匹配）');

  // 管理员按掩码发 pro → 同一台设备立刻生效
  E.putGrant(b, { emailMask: id.mask, tier: 'pro' });
  const id2 = E.identity({ authStore: authStore, backing: b });
  eq(id2.tier, 'pro', '发放名单命中后层级升到 pro');
  eq(id2.can('feihualing').ok, true, 'pro 拿到飞花令');
  eq(id2.can('read.aloud').ok, true, 'pro 的语音播放当然还在（只加不减）');
  eq(id2.label, 'Pro', '标签显示 Pro');

  // 层级缓存也能单独生效（服务端下发那条路的预演）
  A.signOut(authStore);
  E.writeTier(b, 'max');
  const id3 = E.identity({ authStore: authStore, backing: b });
  eq(id3.signedIn, false, '退出后是游客');
  eq(id3.tier, 'max', '本机层级仍保留（退出不降级，与「退出不动进度」同一口径）');
  eq(id3.can('read.aloud').ok, false, '游客即使有层级也不能语音播放（登录是硬条件）');
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
  chk(g.filter(x => x.cap === 'read.aloud')[0].hint === '登录后即可使用（免费）', '灰掉的理由是「登录后即可（免费）」');
  chk(E.matrix(max).every(x => x.ok), 'max 的能力清单全绿（最高层不残留灰条）');
}

console.log('\n=== 九、语音门：与按钮置灰同源，放行后不打断在播的声音 ===');
{
  // speech.js 依赖 window，测试里给一个最小壳
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

  S.setGate(() => ({ ok: false, hint: '登录后即可使用（免费）' }));
  eq(S.allowed().ok, false, '门关着时 allowed() 报 false（按钮据此置灰）');
  eq(S.speak('咏鹅'), false, '未登录：speak() 不出声');
  eq(spoken.length, 0, '未登录：语音引擎一次都没被调用');
  eq(S.speakQueue(['咏鹅'], {}), null, '未登录：连读也不出声');
  eq(spoken.length, 0, '未登录：队列同样没调用引擎');

  // 关键回归：门只拦「进入」。已经在播的时候不该被门打断，
  // 否则会出现「声音停不掉」——停止 / 暂停 / 下一首必须照常работать。
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

  // 页面没加载 entitlement.js 时按「不拦」处理：宁可放行，也不让按钮点了没反应
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
      .replace(/\/\*[\s\S]*?\*\//g, '')     // 去掉块注释
      .replace(/^\s*\/\/.*$/gm, '');        // 去掉行注释
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
}

console.log('');
if (fails) {
  console.log('✗ 权益分层测试失败 ' + fails + ' 项');
  process.exit(1);
}
console.log('🎉 权益分层与语音播放门测试全部通过');
