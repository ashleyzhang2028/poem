/**
 * 账号与邮箱随机码认证测试（Issue #132）
 *
 * 纯 Node、不联网、不装新依赖 —— 因为被测文件 js/auth-core.js 本身零 DOM 依赖。
 *
 * 这里守的不是「功能跑通」，而是设计文档里那几条不能破的规矩：
 *   1. 明文验证码绝不落盘、绝不出现在存储字符串里
 *   2. 单次使用 / 十分钟过期 / 错 5 次作废
 *   3. 频控三层各管各的，且换大小写绕不过锁定
 *   4. 系统时间被改早，已过期的码不能复活
 *   5. 注销 / 退出不碰背诵进度；uid 不回收
 *   6. 存储不可用（隐私模式）时降级为内存会话，而不是抛异常
 */
const A = require('../js/auth-core.js');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };
const eq = (a, b, m) => chk(a === b, m + '（实际 ' + JSON.stringify(a) + '）');

/* 每个用例一套干净的「假存储 + 可控时钟」，互不串味 */
function env(startTs) {
  let t = startTs || 1757900000000;
  const mem = {};
  A.setClock(() => t);
  A.setRandom(() => 0.42);
  const backing = {
    getItem: k => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; }
  };
  return {
    store: A.makeStore(backing),
    mem,
    advance: ms => { t += ms; },
    set: ts => { t = ts; },
    raw: () => mem[A.NS] || ''
  };
}

console.log('=== 一、邮箱归一化与形态校验 ===');
{
  const S = A.makeStore({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
  eq(A.normalizeEmail('  Zhang.Min@163.COM '), 'zhang.min@163.com', '空格与大写被归一化');
  eq(A.normalizeEmail('a\u200bb@c.com'), 'ab@c.com', '零宽字符被剔除');
  chk(A.normalizeEmail('A@B.com') === A.normalizeEmail('a@b.com'), '大小写视为同一邮箱');
  chk(A.isEmailShape('a@b.com'), '正常邮箱通过校验');
  chk(!A.isEmailShape('a@b'), '无顶级域的邮箱被拒');
  chk(!A.isEmailShape('a@@b.com'), '两个 @ 被拒');
  chk(!A.isEmailShape('@b.com'), '空本地部分被拒');
  chk(!A.isEmailShape('a b@c.com'), '含空格被拒');
  chk(!A.isEmailShape('x'.repeat(300) + '@b.com'), '超长邮箱被拒');
  eq(A.maskEmail('zhangmin@163.com'), 'z***@163.com', '掩码只留首字母与域名');
  chk(/163\.com/.test(A.emailHint('me@163.con')) , '163.con 给出域名纠错提示');
  chk(A.isDisposable('x@mailinator.com'), '一次性邮箱被识别');
  chk(!A.isDisposable('x@163.com'), '正常邮箱不算一次性');
  chk(A.digest('abc') === A.digest('abc') && A.digest('abc') !== A.digest('abd'), '摘要稳定且可区分');
}

console.log('\n=== 二、发码：注册登录合一 ===');
{
  const e = env();
  const r = A.requestCode(e.store, { channel: 'email', value: 'Ma@163.com' }, 'login', { code: '123456' });
  chk(r.ok, '首次发码成功');
  eq(r.code, '123456', '可控随机源下码固定');
  eq(A.CODE_LEN, 6, '码长 6 位');
  eq(r.sentTo, 'm***@163.com', '回显已发往的掩码地址');
  chk(!e.raw().includes('123456'), '明文码绝不落盘（存储字符串里搜不到）');
  chk(e.raw().includes(A.codeDigest(A.digest('Ma@163.com'), 'login', '123456', JSON.parse(e.raw()).codes[r.codeId].salt))
      || /codeHash/.test(e.raw()), '落盘的是码摘要');
  const acc = Object.values(JSON.parse(e.raw()).accounts)[0];
  chk(!JSON.stringify(acc).includes('ma@163.com'), '账号记录里不含明文邮箱');
  chk(acc.identities[0].key.indexOf('email:') === 0, '身份以 channel:摘要 形式登记');

  const r2 = A.requestCode(e.store, { channel: 'email', value: 'ma@163.com' }, 'login', { code: '999999' });
  eq(r2.codeId, undefined, '同邮箱 60 秒内第二次直接被频控拦下');
  eq(r2.code, 'E_RATE_EMAIL', '频控错误码 E_RATE_EMAIL');
  chk(r2.retryAfter > 0 && r2.retryAfter <= 60, '给出剩余等待秒数 ' + r2.retryAfter);
}

console.log('\n=== 三、频控：三层独立、且换大小写绕不过 ===');
{
  const e = env();
  const r1 = A.requestCode(e.store, { channel: 'email', value: 'a@163.com' }, 'login', { code: '111111' });
  e.advance(61 * 1000);
  const r2 = A.requestCode(e.store, { channel: 'email', value: 'A@163.COM' }, 'login', { code: '222222' });
  chk(r2.ok, '过了 60 秒可以重发');
  chk(!!r2.codeId && r2.codeId !== r1.codeId, '拿到新的、与上一枚不同的 codeId');
  const st = JSON.parse(e.raw());
  const olds = Object.values(st.codes).filter(c => c.consumedAt);
  eq(olds.length, 1, '发新码即作废旧码（同 uid+purpose 只留最新一枚）');

  const older = Object.keys(st.codes).find(k => st.codes[k].consumedAt);
  const used = A.verifyCode(e.store, older, '111111', 'login');
  chk(!used.ok && used.code === 'E_CODE_USED', '旧码不能再登录');
}

console.log('\n=== 四、校验：成功、过期、错码、作废 ===');
{
  const e = env();
  const r = A.requestCode(e.store, { channel: 'email', value: 'b@163.com' }, 'login', { code: '654321' });
  const bad = A.verifyCode(e.store, r.codeId, '000000', 'login');
  chk(!bad.ok && bad.code === 'E_CODE_WRONG', '错码被拒');
  eq(bad.attemptsLeft, 4, '提示还可再试 4 次');
  const ok = A.verifyCode(e.store, r.codeId, '654321', 'login');
  chk(ok.ok, '正确码登录成功');
  eq(ok.session.scope, 'account', '登录后会话 scope=account');
  chk(!JSON.stringify(ok.session).includes('@'), '会话里不含邮箱');
  eq(ok.account.nickname, '', '新账号昵称为空，等待用户补');
  const again = A.verifyCode(e.store, r.codeId, '654321', 'login');
  chk(!again.ok && again.code === 'E_CODE_USED', '成功一次后该码失效（防重放）');

  const e2 = env();
  const r2 = A.requestCode(e2.store, { channel: 'email', value: 'c@163.com' }, 'login', { code: '121212' });
  e2.advance(10 * 60 * 1000 + 1);
  const exp = A.verifyCode(e2.store, r2.codeId, '121212', 'login');
  chk(!exp.ok && exp.code === 'E_CODE_EXPIRED', '超过 10 分钟即过期');

  const e3 = env();
  const r3 = A.requestCode(e3.store, { channel: 'email', value: 'd@163.com' }, 'login', { code: '333333' });
  let last;
  for (let i = 0; i < 5; i++) last = A.verifyCode(e3.store, r3.codeId, '000000', 'login');
  eq(last.code, 'E_CODE_VOID', '第 5 次错码当场作废该码');
  const voided = A.verifyCode(e3.store, r3.codeId, '333333', 'login');
  // 码已作废，正确码也不再认；此处返回作废（未触发锁定）或锁定（已触发），都必须拦住
  chk(!voided.ok, '作废后正确码也不再认（必须重发）');
  chk(A.requestCode(e3.store, { channel: 'email', value: 'd@163.com' }, 'login').ok === false,
      '该轮结束后仍在发码冷却中，不能立刻重发');

  const e4 = env();
  const r4 = A.requestCode(e4.store, { channel: 'email', value: 'e@163.com' }, 'login', { code: '444444' });
  const wrongPurpose = A.verifyCode(e4.store, r4.codeId, '444444', 'reset');
  chk(!wrongPurpose.ok && wrongPurpose.code === 'E_PURPOSE', 'login 的码不能用于 reset');
  chk(A.verifyCode(e4.store, '', '444444', 'login').code === 'E_NO_CODE', '没先发码就校验被拒');

  const e5 = env();
  chk(A.requestCode(e5.store, { channel: 'email', value: 'bad@' }, 'login').code === 'E_EMAIL_FORMAT', '格式错直接拒，不建号');
  chk(A.requestCode(e5.store, { channel: 'email', value: '' }, 'login').code === 'E_EMAIL_EMPTY', '空邮箱被拒');
  chk(A.requestCode(e5.store, { channel: 'wechat', value: 'x' }, 'login').code === 'E_CHANNEL', '未支持的 channel 被拒');
  chk(A.requestCode(e5.store, { channel: 'email', value: 'a@b.com' }, 'nope').code === 'E_PURPOSE', '未支持的 purpose 被拒');
}

console.log('\n=== 五、锁定：按 uid 计，换大小写绕不过 ===');
{
  const e = env();
  const codes = [];
  for (let i = 0; i < 6; i++) {
    e.advance(61 * 1000);
    codes.push(A.requestCode(e.store, { channel: 'email', value: 'f@163.com' }, 'login', { code: '000000' }).code);
  }
  chk(codes.slice(0, 5).every(c => c === '000000'), '一小时内前 5 次发码都成功');
  eq(codes[5], 'E_RATE_EMAIL', '第 6 次被小时档频控拦下');
  const alt = A.requestCode(e.store, { channel: 'email', value: 'F@163.COM' }, 'login', { code: '000000' });
  eq(alt.code, 'E_RATE_EMAIL', '换个大小写同样被拦（按身份摘要不按字符串）');

  // 设备层独立：换一个邮箱，仍受设备档限制
  const e5 = env();
  let devBlocked = false;
  for (let i = 0; i < 12 && !devBlocked; i++) {
    e5.advance(61 * 1000);
    if (A.requestCode(e5.store, { channel: 'email', value: 'dev' + i + '@163.com' }, 'login', { code: '000000' }).code === 'E_RATE_DEVICE') devBlocked = true;
  }
  chk(devBlocked, '设备档一小时内 10 次上限独立生效（换邮箱也拦）');

  // 整轮失败 3 轮 → 锁 24 小时
  const e2 = env();
  const rounds = [];
  for (let i = 0; i < 3; i++) {
    e2.advance(61 * 1000);
    const r = A.requestCode(e2.store, { channel: 'email', value: 'g@163.com' }, 'login', { code: '555555' });
    for (let j = 0; j < 5; j++) A.verifyCode(e2.store, r.codeId, '000000', 'login');
  }
  e2.advance(61 * 1000);
  const locked = A.requestCode(e2.store, { channel: 'email', value: 'g@163.com' }, 'login', { code: '555555' });
  chk(!locked.ok && locked.code === 'E_LOCKED', '连续 3 轮「发码后全错」锁 24 小时');
  e2.advance(61 * 1000);
  eq(A.requestCode(e2.store, { channel: 'email', value: 'g@163.com' }, 'login', { code: '555555' }).code, 'E_LOCKED', '锁定期间重试不会自动解锁');
  e2.advance(24 * 3600 * 1000 + 1000);
  chk(A.requestCode(e2.store, { channel: 'email', value: 'g@163.com' }, 'login', { code: '555555' }).ok, '24 小时后自动解锁');
}

console.log('\n=== 六、时间倒退：过期码不能复活 ===');
{
  const e = env(1757900000000);
  const r = A.requestCode(e.store, { channel: 'email', value: 'h@163.com' }, 'login', { code: '777777' });
  e.advance(11 * 60 * 1000);
  e.set(1757900000000 - 3600 * 1000);                 // 把系统时间改早一小时
  const back = A.verifyCode(e.store, r.codeId, '777777', 'login');
  chk(!back.ok, '时间被改早后，已过期的码被作废，不能登录');
  chk(back.code === 'E_CODE_USED' || back.code === 'E_CODE_VOID' || back.code === 'E_CODE_EXPIRED',
      '给出的是作废/过期类错误（实际 ' + back.code + '）');
}

console.log('\n=== 七、设备信任期 ===');
{
  const e = env();
  const r = A.requestCode(e.store, { channel: 'email', value: 'i@163.com' }, 'login', { code: '888888' });
  chk(A.trustedAccount(e.store) === null, '未登录过时不自动进入');
  A.verifyCode(e.store, r.codeId, '888888', 'login');
  chk(A.trustedAccount(e.store) !== null, '登录后进入信任期，可一键进入');
  chk(A.session(e.store) !== null, '会话可读取');
  A.signOut(e.store);
  chk(A.session(e.store) === null, '退出后会话失效');
  chk(A.trustedAccount(e.store) !== null, '但信任期还在（下次仍可一键进入）');
  const back = A.signInTrusted(e.store);
  chk(back.ok && back.session.scope === 'account', '一键进入拿到新会话');
  A.signOut(e.store);
  e.advance((A.TRUST_DAYS + 1) * 86400000);
  chk(A.trustedAccount(e.store) === null, '超过 30 天信任期后必须重新收码');
}

console.log('\n=== 八、会话：过期与静默续期 ===');
{
  const e = env();
  const r = A.requestCode(e.store, { channel: 'email', value: 'j@163.com' }, 'login', { code: '101010' });
  A.verifyCode(e.store, r.codeId, '101010', 'login');
  const first = A.session(e.store).exp;
  e.advance(20 * 86400000);                            // 剩 10 天 → 触发静默续期
  const renewed = A.session(e.store);
  chk(renewed && renewed.exp > first, '临近过期时静默续期');
  e.advance(31 * 86400000);
  chk(A.session(e.store) === null, '彻底过期后会话为空（静默降级 local）');
}

console.log('\n=== 九、重设凭证与注销 ===');
{
  const e = env();
  const r = A.requestCode(e.store, { channel: 'email', value: 'k@163.com' }, 'login', { code: '111222' });
  A.verifyCode(e.store, r.codeId, '111222', 'login');
  e.advance(61 * 1000);
  const rr = A.requestCode(e.store, { channel: 'email', value: 'k@163.com' }, 'reset', { code: '333444' });
  chk(rr.ok, 'reset 用途可单独发码');
  const done = A.resetCredential(e.store, rr.codeId, '333444');
  chk(done.ok, '重设凭证成功');
  chk(A.session(e.store) === null, '重设后全部会话被吊销');
  chk(A.trustedAccount(e.store) === null, '重设后设备信任期清空，必须重新登录');

  const e2 = env();
  const s = A.requestCode(e2.store, { channel: 'email', value: 'l@163.com' }, 'login', { code: '555666' });
  A.verifyCode(e2.store, s.codeId, '555666', 'login');
  chk(!A.deleteAccount(e2.store, 'wrong@163.com').ok, '注销时邮箱填错被拒');
  const uid = A.session(e2.store).account.uid;
  const del = A.deleteAccount(e2.store, ' L@163.com ');
  chk(del.ok, '填对邮箱（含空格大写）可注销');
  eq(del.uid, uid, '返回被注销的 uid');
  chk(A.session(e2.store) === null, '注销后会话清空');
  chk(A.trustedAccount(e2.store) === null, '注销后信任期清空');
}

console.log('\n=== 十、进度归属合并策略 ===');
{
  const rec = (reps, next) => ({ level: 2, reps, nextReviewAt: next });
  let m = A.mergePolicy({}, {});
  eq(m.action, 'none', '两边都空 → 不动');
  m = A.mergePolicy({ recs: { x: rec(2, 100) } }, { recs: {} });
  eq(m.action, 'adoptLocal', '本机有、账号空 → 认领本机进度（新注册不丢数据）');
  chk(m.put.x, '认领的是本机那一份');
  m = A.mergePolicy({ recs: {} }, { recs: { y: rec(1, 50) } });
  eq(m.action, 'takeRemote', '本机空、账号有 → 取账号数据（换设备首次登录）');
  m = A.mergePolicy({ recs: { x: rec(5, 999) } }, { recs: { x: rec(2, 100) } });
  eq(m.action, 'merge', '同一条取「复习次数多」的一方');
  chk(m.put.x.reps === 5, '本机 5 次胜过账号 2 次');
  m = A.mergePolicy({ recs: { x: rec(2, 100) } }, { recs: { x: rec(2, 100) } });
  eq(m.action, 'merge', '完全相同也能静默合并（无冲突）');
  chk(!(m.conflict && m.conflict.length), '无冲突条目');
}

console.log('\n=== 十一、降级：存储不可用 / 脏数据 / 写满 ===');
{
  const throwing = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('denied'); },
    removeItem: () => {}
  };
  const s = A.makeStore(throwing);
  chk(!s.persistent(), '取用即抛的存储被判定为不可持久（构造时即探明）');
  const r = A.requestCode(s, { channel: 'email', value: 'm@163.com' }, 'login', { code: '121212' });
  chk(r.ok, '隐私模式下仍可发码（用内存）');
  const v = A.verifyCode(s, r.codeId, '121212', 'login');
  chk(v.ok, '隐私模式下仍可登录');
  chk(v.isLocalOnly, '结果里标明「刷新即失效」');

  const full = { _v: null, getItem() { return this._v; }, setItem() { throw new Error('QuotaExceeded'); }, removeItem() {} };
  const s2 = A.makeStore(full);
  chk(A.requestCode(s2, { channel: 'email', value: 'n@163.com' }, 'login', { code: '131313' }).ok, '写满时降级为内存，不抛异常');

  const dirty = { _v: '{"accounts":{"u_1":42},"codes":{"c_1":{}},"rate":[],"v":1}', getItem() { return this._v; }, setItem(k, v) { this._v = v; }, removeItem() {} };
  const s3 = A.makeStore(dirty);
  let threw = false;
  try { A.session(s3); } catch (err) { threw = true; }
  chk(!threw, '脏数据不抛异常（非法账号/码记录被剔除）');
  const st3 = s3.read();
  eq(Object.keys(st3.accounts).length, 0, '非法账号被剔除');
  eq(Object.keys(st3.codes).length, 0, '非法码记录被剔除');
  chk(A.makeStore({ getItem: () => 'not json', setItem() {}, removeItem() {} }).read().accounts !== undefined, '完全不是 JSON 时回落空状态');

  const s4 = A.makeStore({ getItem: () => '{"v":1,"deviceId":"evil"}', setItem() {}, removeItem() {} });
  chk(s4.read().deviceId === null || /^d_[0-9a-f]{8}$/.test(s4.read().deviceId), '非随机的 deviceId 被丢弃');
}

console.log('\n=== 十二、退化随机源不能变成死循环 ===');
{
  // 事故现场：codeId / uid 曾写成 `do { x = rand() } while (撞了)`，
  // 一旦随机源恒定（测试注入源、被 hook 的环境），那就是死循环 ——
  // 表现为「第一次发码正常，第二次调用整个线程卡死」，且没有任何报错。
  // 这条用例就是钉住它：随机源恒定下连续发码 / 建号 / 开会话都要正常返回。
  const e = env();
  const ids = [];
  for (let i = 0; i < 5; i++) {
    const r = A.requestCode(e.store, { channel: 'email', value: 'fixed' + i + '@163.com' }, 'login', { code: '202020' });
    chk(r.ok, '恒定随机源下第 ' + (i + 1) + ' 次发码仍然返回（不死循环）');
    ids.push(r.codeId);
  }
  chk(new Set(ids).size === 5, '五枚 codeId 互不相同（线性探测生效）');
  const st = e.read ? null : JSON.parse(e.raw());
  chk(Object.keys(st.accounts).length === 5, '五个账号各自独立，uid 也没撞');
  const v = A.verifyCode(e.store, ids[0], '202020', 'login');
  chk(v.ok && !!v.session.sid, '恒定随机源下也能签发会话');
  const v2 = A.verifyCode(e.store, ids[1], '202020', 'login');
  chk(v2.ok && v2.session.sid !== v.session.sid, '两次会话 sid 不同');
}

console.log('\n=== 十三、边界规矩 ===');
{
  const e = env();
  const before = JSON.stringify(e.mem);
  A.session(e.store);
  A.trustedAccount(e.store);
  chk(JSON.stringify(e.mem) === before || !JSON.parse(e.mem[A.NS] || '{}').sessions, '只读操作不产生会话');

  const r = A.requestCode(e.store, { channel: 'email', value: 'o@163.com' }, 'login', { code: '141414' });
  A.verifyCode(e.store, r.codeId, '141414', 'login');
  eq(A.nickname(e.store), '', '未设昵称时为空');
  eq(A.setNickname(e.store, '  小明<script>  '), '小明script', '昵称去掉尖括号并截断到 12 字');
  eq(A.nickname(e.store), '小明script', '昵称落到本机档案');
  chk(A.session(e.store).account.nickname === '小明script', '昵称同步进账号');
  eq(A.setNickname(e.store, '一二三四五六七八九十十一十二十三').length, 12, '昵称最长 12 字');

  eq(A.CHANNELS.indexOf('sms') >= 0, true, '短信 channel 已留口子');
  chk(typeof A.maskPhone === 'function' && A.maskPhone('13800138000') === '138****8000', '手机号掩码可用（短信通道预留）');
  const e9 = env();
  const sms = A.requestCode(e9.store, { channel: 'sms', value: '138 0013 8000' }, 'login', { code: '151515' });
  chk(sms.ok, '短信通道走的是同一套 requestCode，只差通道实现（无需改签名）');
  const sv = A.verifyCode(e9.store, sms.codeId, '151515', 'login');
  chk(sv.ok, '短信码校验复用同一套 verifyCode');

  /* ------------------------------------------------------------------
     2B：短信口子的具体口径
     ------------------------------------------------------------------ */
  // 归一化在多语言输入下都要收敛到同一个裸 11 位
  ['13800138000', '138 0013 8000', '138-0013-8000', '+8613800138000',
    '008613800138000', '(138)0013.8000'].forEach(v => {
    eq(A.normalizePhone(v), '13800138000', '手机号归一化收敛：' + JSON.stringify(v));
  });
  chk(A.isPhoneShape('13800138000'), '11 位 1 开头是手机号形状');
  chk(!A.isPhoneShape('12345'), '位数不足不是手机号形状');
  chk(!A.isPhoneShape('12800138000'), '非法号段（第二位 2）被拒');
  eq(A.maskPhone('+86 138-0013-8000'), '138****8000', '掩码前先归一化（去掉 +86）');
  eq(A.maskPhone('abcdefghijk'), '***', '非手机号形态掩成 ***（不截字母）');

  // 形状不对的短信请求就地拒绝，**不消耗**本机状态
  const e10 = env();
  const badPhone = A.requestCode(e10.store, { channel: 'sms', value: '123' }, 'login', {});
  eq(badPhone.ok, false, '手机号形状不对：拒绝');
  eq(badPhone.code, 'E_PHONE_FORMAT', '错误码 E_PHONE_FORMAT');
  chk(!!A.ERR.E_PHONE_FORMAT, '错误码有对应文案');

  // 未知 channel 明确拒绝，不静默当邮箱
  const badCh = A.requestCode(e10.store, { channel: 'wechat', value: 'x' }, 'login', {});
  eq(badCh.code, 'E_CHANNEL', '未知 channel 回 E_CHANNEL（不静默当邮箱）');

  // 独立且更严的短信频控档
  chk(A.RATE_SMS && A.RATE_SMS.phone && A.RATE_SMS.phone.length >= 3, '短信有独立的频控档（三档：时/日/月）');
  const e11 = env();
  const s1 = A.requestCode(e11.store, { channel: 'sms', value: '13900139000' }, 'login', { code: '111111' });
  chk(s1.ok, '短信首条发送成功');
  eq(s1.channel, 'sms', '返回里如实带 channel');
  const s2 = A.requestCode(e11.store, { channel: 'sms', value: '13900139000' }, 'login', { code: '222222' });
  eq(s2.ok, false, '60 秒内重复发短信被冷却拦住');
  chk(s2.retryAfter > 0, '冷却给出 retryAfter');
}

console.log('');
if (fails) {
  console.log('✗ 账号认证测试失败 ' + fails + ' 项');
  process.exit(1);
}
console.log('🎉 账号与邮箱随机码认证测试全部通过');
