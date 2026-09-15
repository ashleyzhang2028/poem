/**
 * 字符印头像测试（Issue #132 · 用户 2026-09-15 裁决「头像听你的」）
 *
 * 纯 Node、不联网、不装新依赖 —— 被测文件 js/avatar.js 零 DOM 依赖。
 *
 * 这里守的是五件事：
 *   1. **合规**：不收集任何东西 —— 只有「从固定集合里挑的一个索引」，
 *      不弹文件框、不存 base64、不请求任何接口、不用邮箱首字母
 *   2. **永不空**：三档回落（用户选的字 → 昵称首字 → 默认「诗」），任何脏值都不出裂图
 *   3. **分域正确**：头像与昵称住 `poem_profile_v1`（账号域），
 *      **不写** `poem_device_prefs_v1`（设备域）、**不写** `poem_recite_progress_v1`
 *   4. **兼容读**：昵称取值 `poem_profile_v1` → 老 `settings.username` → 空串；
 *      写昵称一律写新键并清掉老字段（幂等）
 *   5. **非枚举值不生效**：自由输入的字 / 任意色值一律拒收（不写盘），不静默变默认
 */
const A = require('../js/avatar.js');

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

console.log('=== 一、三档回落：任何情况下都有一枚印，绝不空 ===');
{
  const b = mem();
  let d = A.display(b);
  eq(d.char, '诗', '全新用户 → 默认「诗」字');
  eq(d.source, 'default', '来源如实标为「默认字」');
  eq(d.ink, 'seal', '默认印色是朱砂');
  chk(d.char.length > 0 && d.bg && d.fg, '默认印有字、有底色、有字色（不是空白圆）');

  A.setNickname(b, '玥玥');
  d = A.display(b);
  eq(d.char, '玥', '没选过字时，取昵称首字');
  eq(d.source, 'nickname', '来源如实标为「取自昵称首字」');

  A.setAvatar(b, { char: '梅' });
  d = A.display(b);
  eq(d.char, '梅', '选过字后，以用户选的为准（昵称变了也不跟着变）');
  eq(d.source, 'chosen', '来源如实标为「你选的字」');

  A.setNickname(b, '');
  eq(A.display(b).char, '梅', '清空昵称后，已选的字仍在（印不跟着昵称一起丢）');
}

console.log('\n=== 二、脏值一律回落，绝不抛、绝不留空 ===');
{
  eq(A.display(mem({ poem_profile_v1: 'not-json' })).char, '诗', '档案不是 JSON → 回落默认');
  eq(A.display(mem({ poem_profile_v1: '[1,2]' })).char, '诗', '档案不是对象 → 回落默认');
  eq(A.normAvatar(null).char, '', 'normAvatar(null) 回落到空（由 display 兜底）');
  eq(A.normAvatar({ char: '龘' }).char, '', '字不在固定集合里 → 归一化为空');
  eq(A.normAvatar({ ink: '#ff0000' }).ink, '', '任意色值 → 归一化为空');
  const dirty = mem({ poem_profile_v1: JSON.stringify({ avatar: { char: 42, ink: {} } }) });
  eq(A.display(dirty).char, '诗', '非字符串的字 → 走上位兜底');
  eq(A.display(dirty).ink, 'seal', '非字符串的色 → 朱砂');
}

console.log('\n=== 三、固定集合：自由输入的字 / 任意色一律拒收（不写盘） ===');
{
  const b = mem();
  const r1 = A.setAvatar(b, { char: '龘' });
  eq(r1.ok, false, '集合外的字拒收');
  eq(r1.code, 'E_CHAR', '给出可读的错误码');
  eq(A.display(b).char, '诗', '拒收后盘上仍是默认，没有被悄悄改成脏值');

  const r2 = A.setAvatar(b, { ink: 'gold' });
  eq(r2.ok, false, '集合外的色拒收');
  eq(r2.code, 'E_INK', '给出可读的错误码');

  A.CHARS.forEach(function (c) { chk(A.isChar(c), '可选字集合里有「' + c + '」'); });
  A.INK_KEYS.forEach(function (k) { chk(A.isInk(k), '可选印色里有 ' + k + '（' + A.INKS[k].name + '）'); });
  eq(A.CHARS.length, 12, '固定 12 个字（不弹键盘、杜绝生僻字与真名）');
  eq(A.INK_KEYS.length, 4, '固定 4 色，全部取自传统色');
  chk(A.CHARS.indexOf('诗') >= 0, '默认字「诗」在集合里（与 App 图标同源）');
}

console.log('\n=== 四、合规：不收集、不上传、不存图 ===');
{
  const b = mem();
  A.setAvatar(b, { char: '竹', ink: 'pine' });
  A.setNickname(b, '小明');
  const stored = b.raw()[A.NS];
  chk(stored.length < 120, '盘上只存一个索引，字节数极小（实际 ' + stored.length + ' 字节）');
  chk(!/data:image|base64|blob:/i.test(stored), '绝不存 base64 图片（不撑爆 localStorage、不污染导出备份）');
  const parsed = JSON.parse(stored);
  eq(parsed.avatar.char, '竹', '存的是字');
  eq(parsed.avatar.ink, 'pine', '存的是色名，不是色值（换主色不改用户的选择）');

  // 关键：不用邮箱首字母 —— 那等于把邮箱摘要的一半画在屏幕上
  const mail = mem({ poem_auth_v1: JSON.stringify({ profile: { nickname: '' } }) });
  eq(A.display(mail).char, '诗', '没有昵称时不会去抠邮箱首字母，而是回默认字');

  // 渲染出来的 HTML 里不许有任何外部地址
  const html = A.html(b);
  chk(!/https?:\/\//.test(html), '渲染出的 HTML 不含任何外部地址（零请求）');
  chk(!/<img/i.test(html), '渲染的是字符，不是 <img>（断网也画得出）');
  chk(/seal-avatar/.test(html), '带统一的类名（三处显示共用一套样式）');
}

console.log('\n=== 五、分域：头像属账号域，不碰设备域与进度域 ===');
{
  const b = mem();
  A.setNickname(b, '玥玥');
  A.setAvatar(b, { char: '云', ink: 'celadon' });
  const keys = b.keys();
  chk(keys.indexOf(A.NS) >= 0, '写进了账号域 ' + A.NS);
  eq(keys.indexOf('poem_device_prefs_v1'), -1, '没写设备域 poem_device_prefs_v1（手机与电脑同一枚印）');
  eq(keys.indexOf('poem_recite_progress_v1'), -1, '没写进度域（改头像不影响背诵进度）');
  eq(keys.indexOf('poem_plan_grant_v1'), -1, '没写发放名单（头像与权益是两件事）');
}

console.log('\n=== 六、兼容读：老 `settings.username` 仍认，镜像写两处一致 ===');
{
  const b = mem({
    poem_recite_settings_v1: JSON.stringify({ grade: 2, term: 1, username: '玥玥' })
  });
  eq(A.nickname(b), '玥玥', '老用户只在设置里存过用户名，仍读得到（不会忽然变成默认名）');
  eq(A.display(b).char, '玥', '老用户的印也随之取到昵称首字');

  // 镜像写：新键与老键一起更新，且不动老键里的其它设置
  A.saveNickname(b, '新名字');
  const legacy = JSON.parse(b.raw()['poem_recite_settings_v1']);
  eq(legacy.username, '新名字', '老键被镜像更新（各页仍在读它，不能只写新键）');
  eq(legacy.grade, 2, '镜像写不动老键里的其它设置（年级还在）');
  eq(JSON.parse(b.raw()[A.NS]).nickname, '新名字', '新键也写到了账号域');
  eq(A.nickname(b), '新名字', '两个键一致，读回来是新名字');

  // 幂等：连写两次结果一致
  A.saveNickname(b, '新名字');
  eq(A.nickname(b), '新名字', '连写两次结果一致（幂等）');
  eq(JSON.parse(b.raw()[A.NS]).v, 1, '档案带版本号 v1（供将来迁移）');

  // 清老字段这一动作本轮不调用，但实现要在（阶段 0 的迁移用它）
  eq(typeof A.clearLegacyNickname, 'function', '提供 clearLegacyNickname 供阶段 0 迁移调用');
  eq(A.nickname(b), '新名字', '阶段 0 之前老字段仍在（不清 = 老代码零改动）');
}

console.log('\n=== 七、昵称首字按码点取，不劈开 emoji ===');
{
  eq(A.firstCharOf('玥玥'), '玥', '中文取第一个字');
  eq(A.firstCharOf('  Ashley '), 'A', '两侧空白先 trim');
  eq(A.firstCharOf('🐟鱼'), '🐟', 'emoji 整个取出（charAt(0) 会劈成半个代理对）');
  eq(A.firstCharOf('   '), '', '全空白 → 空（由 display 兜底为默认字）');
  eq(A.firstCharOf(null), '', 'null 不抛');
  const b = mem();
  A.setNickname(b, '🐟');
  eq(A.display(b).char, '🐟', 'emoji 昵称的印是整个 emoji，不是乱码方块');
}

console.log('\n=== 八、还原默认印不动昵称 ===');
{
  const b = mem();
  A.setNickname(b, '小明');
  A.setAvatar(b, { char: '菊', ink: 'ochre' });
  const r = A.resetAvatar(b);
  eq(r.ok, true, '还原成功');
  eq(A.display(b).char, '小', '还原后回到三档回落的起点：取昵称首字「小」…');
  chk(A.display(b).source === 'nickname', '…且来源如实标为「取自昵称首字」');
  eq(A.nickname(b), '小明', '还原默认印不动昵称');
  eq(A.avatar(b).ink, '', '盘上不再存色（回到三档回落的起点，不是「用户选了朱砂」）');
  eq(A.display(b).ink, 'seal', '显示出来是默认朱砂');
}

console.log('\n=== 九、没有存储也不许抛（隐私模式 / 无 localStorage） ===');
{
  eq(A.display(null).char, '诗', '没有存储 → 默认印');
  eq(A.nickname(null), '', '没有存储 → 空昵称');
  eq(A.setNickname(null, 'x'), false, '写不进去时返回 false，不抛');
  eq(A.setAvatar(null, { char: '山' }).ok, false, '写不进去时 ok:false，不抛');
  const throwing = {
    getItem: () => { throw new Error('QuotaExceeded / 隐私模式'); },
    setItem: () => { throw new Error('QuotaExceeded'); }
  };
  eq(A.display(throwing).char, '诗', '取用即抛的存储 → 仍回落到默认印');
  eq(A.nickname(throwing), '', '取用即抛的存储 → 昵称空串');
}

console.log('\n=== 十、每张加载了顶栏的页面都加载了 js/avatar.js ===');
{
  const fs = require('fs');
  const glob = require('path');
  const pages = ['index.html'].concat(
    fs.readdirSync('.').filter(function (f) {
      try { return fs.statSync(glob.join(f, 'index.html')).isFile(); } catch (e) { return false; }
    }).map(function (d) { return d + '/index.html'; })
  );
  const withChrome = pages.filter(function (f) {
    return /<script src="\/?js\/chrome\.js"><\/script>/.test(fs.readFileSync(f, 'utf8'));
  });
  chk(withChrome.length >= 13, '找到全部加载顶栏的页面（实际 ' + withChrome.length + ' 张）');
  withChrome.forEach(function (f) {
    const src = fs.readFileSync(f, 'utf8');
    chk(/<script src="\/?js\/avatar\.js"><\/script>/.test(src), f + ' 加载了 js/avatar.js');
    // 顺序：avatar.js 的 <script> 必须在 chrome.js 的 <script> **之前** ——
    // chrome.js 渲染顶栏时要读它。⚠️ 按 <script> 标签位置比，不按子串第一次出现比：
    // 各页顶部的 HTML 注释里就写了「由 js/chrome.js 统一渲染」，
    // 拿 indexOf 比会永远判成「chrome 在前」（那是注释，不是脚本）。
    const atAvatar = src.indexOf('<script src="js/avatar.js"></script>') >= 0
      ? src.indexOf('<script src="js/avatar.js"></script>')
      : src.indexOf('<script src="/js/avatar.js"></script>');
    const atChrome = src.indexOf('<script src="js/chrome.js"></script>') >= 0
      ? src.indexOf('<script src="js/chrome.js"></script>')
      : src.indexOf('<script src="/js/chrome.js"></script>');
    chk(atAvatar >= 0 && atChrome >= 0 && atAvatar < atChrome,
      f + ' 里 js/avatar.js 的 <script> 排在 js/chrome.js 之前（顶栏渲染时它得先就位）');
  });
}

console.log('\n=== 十一、源码扫描：页面不许自己拼一套印 ===');
{
  const fs = require('fs');
  const files = ['js/chrome.js', 'js/app.js', 'js/settings.js', 'js/reader-core.js'];
  files.forEach(function (f) {
    const src = fs.readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    chk(!/linear-gradient\(150deg/.test(src), f + ' 没自己复制一份印色渐变（一律走 Avatar.html）');
  });
  const html = A.html(mem());
  chk(/linear-gradient/.test(html), '渐变只由 Avatar 这一处画出来');
}

console.log('');
if (fails) {
  console.log('✗ 字符印头像测试失败 ' + fails + ' 项');
  process.exit(1);
}
console.log('🎉 字符印头像测试全部通过');
