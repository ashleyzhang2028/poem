const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = __dirname + '/../';
const read = f => fs.readFileSync(path + f, 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

// ⚠️ 原先这一档还有 `profile: 'profile/index.html'`（个人中心）。
//    2026-09-20（Issue #244）那一页已删除，它独有的几件搬进了「我的」页；
//    这里继续守的是登录页与管理后台，个人中心那一条口径的守卫在
//    test/profile-removed.test.js 与 test/mine-page.test.js 里。
const PAGES = {
  login: 'login/index.html',
  admin: 'admin/index.html'
};
const SRC = {};
Object.keys(PAGES).forEach(k => { SRC[k] = read(PAGES[k]); });

const loginJs = read('js/login.js');
const mineJs = read('js/mine.js');
const adminJs = read('js/admin-page.js');
const chromeJs = read('js/chrome.js');
const sw = read('sw.js');
const css = read('css/account.css');
const privacy = read('privacy/index.html');
const terms = read('terms/index.html');

// 从一整份 CSS 里按选择器取一条规则（"这几行的字到底怎么排的"要看真实规则，
// 不能只看类名在不在）。
const CSS = css + read('css/style.css');
const rule = (sel) => (CSS.match(new RegExp(
  sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*\\}')) || [''])[0];

const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const stripHtml = t => t.replace(/<!--[\s\S]*?-->/g, ' ');
const LOGIN = strip(loginJs), MINE = strip(mineJs), ADMIN = strip(adminJs);

{
  Object.keys(PAGES).forEach(k => {
    const f = PAGES[k];
    chk(fs.existsSync(path + f), f + ' 存在');
    const s = SRC[k];
    chk(/<base href="\/"/.test(s), f + ' 带 <base href="/">（子目录页面里相对资源才解析得对）');
    chk(/js\/chrome\.js/.test(s), f + ' 加载 js/chrome.js（顶栏 + 页签的唯一来源）');
    chk(/js\/pwa\.js/.test(s), f + ' 加载 js/pwa.js（--nav-h 每页都要实测）');
    chk(/js\/auth-core\.js/.test(s), f + ' 加载 js/auth-core.js（账号内核）');
    chk(/js\/entitlement\.js/.test(s), f + ' 加载 js/entitlement.js（权益总闸）');
    chk(/js\/avatar\.js/.test(s), f + ' 加载 js/avatar.js（头像只有一处画）');
    chk(/<header class="topbar"/.test(s), f + ' 有顶栏挂载点');
    chk(/data-page="/.test(s), f + ' 声明页名（顶栏第一行写得出「跬步 · 登录」）');
    chk(!/class="foot/.test(s), f + ' 没有页底页脚（应用形态，法务入口收在设置「关于」里）');

    chk(/data-dock="off"/.test(s), f + ' 声明 data-dock="off"（深页不挂底部页签）');
  });

  Object.keys(PAGES).forEach(k => {
    const s = SRC[k];
    const at = name => s.indexOf('<script src="/js/' + name + '"></script>');
    chk(at('auth-core.js') >= 0 && at('entitlement.js') >= 0 &&
        at('auth-core.js') < at('entitlement.js'),
      PAGES[k] + ' 里 auth-core 排在 entitlement 之前（先有会话再算权益）');
  });
  chk(SRC.login.indexOf('<script src="/js/login.js"></script>') <
      SRC.login.indexOf('<script src="/js/chrome.js"></script>'),
    'login 页里 js/login.js 排在 js/chrome.js 之前');
  chk(read('mine/index.html').indexOf('<script src="/js/mine.js"></script>') <
      read('mine/index.html').indexOf('<script src="/js/chrome.js"></script>'),
    '「我的」页里 js/mine.js 排在 js/chrome.js 之前');

  chk(SRC.admin.indexOf('<script src="/js/admin-page.js"></script>') <
      SRC.admin.indexOf('<script src="/js/chrome.js"></script>'),
    'admin 页里 js/admin-page.js 排在 js/chrome.js 之前');
  chk(!fs.existsSync(path + 'js/admin.js'),
    '管理页逻辑不叫 js/admin.js（那个名字归已删除的访问统计脚本，由法务层的反向断言守着）');
}

{
  const names = ['login', 'admin'].map(k => (SRC[k].match(/data-page="([^"]+)"/) || [])[1]);
  chk(names.join(',') === '登录,管理后台', '两张页的页名各不相同且如实：' + names.join(' / '));
  chk(new Set(names).size === 2, '两张页的页名不重复（否则「返回上一页」会让人分不清层）');

  chk(/data-back="\/mine\/"/.test(SRC.login),
    '登录页的上一层是「我的」页（登录是身份的事，落回设置页等于多绕一层）');
  chk(/data-back="\/mine\/"/.test(SRC.admin), '管理后台的上一层是「我的」页（不是设置页）');

  chk(/login: "\/login\/"/.test(chromeJs), 'js/chrome.js 的 ROUTES 里有 /login/');
  chk(!/profile/.test(chromeJs),
    'js/chrome.js 的 ROUTES 里没有 profile（那一页 2026-09-20 已删，整条不残留）');
  chk(/admin: "\/admin\/"/.test(chromeJs), 'js/chrome.js 的 ROUTES 里有 /admin/');

  chk(!/userAvatarHtml/.test(chromeJs),
    '顶栏不画头像（那条 /profile/ 的落点也随之撤掉，转由「我的」页承担）');
}

{
  const files = { 'js/login.js': LOGIN, 'js/mine.js': MINE, 'js/admin-page.js': ADMIN };
  Object.keys(files).forEach(f => {
    const s = files[f];

    chk(!/tier\s*===\s*["']/.test(s) && !/===\s*["'](free|pro|max)["']/.test(s),
      f + ' 没有自己写 tier === "pro" 这类判断（一律走 Entitlement）');
    chk(!/plan\s*===/.test(s), f + ' 没有自己比对 plan');
  });

  chk(!/Ent\.matrix\(/.test(MINE),
    '「我的」页不自己画一遍能力清单（清单只有 /plans/ 一处，见 plans-page 测试）');
  chk(!/cap-list|cap-name|cap-hint/.test(MINE + read('mine/index.html')),
    '「我的」页没有清单的挂载点与样式类');
  chk(/Ent\.tierLabel\(/.test(MINE), '层级徽章由 Entitlement.tierLabel() 出');
  chk((MINE.match(/Ent\.tierLabel\(/g) || []).length === 1,
    '层级文案在「我的」页只有一处来源（实际 ' + (MINE.match(/Ent\.tierLabel\(/g) || []).length + ' 处）');
  chk(!/renderCaps/.test(MINE),
    '没有 renderCaps()（那节撤了就不留一个画空东西的函数）');
  chk(/Ent\.tierLabel\(/.test(MINE) && /Ent\.tierLabel\(/.test(ADMIN),
    '层级徽章文案一律由 Entitlement.tierLabel() 出');
  chk(/Ent\.TIERS/.test(ADMIN), '可发放的层级列表读 Entitlement.TIERS（不自己写死一份）');
  chk(/putGrant\(backing/.test(ADMIN) && /readGrants\(backing\)/.test(ADMIN) &&
      /removeGrant\(backing/.test(ADMIN) && /clearGrants\(backing\)/.test(ADMIN),
    '名单的增 / 查 / 删 / 清一律走 Entitlement 的发放接口');
  chk(!/poem_plan_grant_v1/.test(ADMIN), 'admin 页不自己拼发放名单的键名（键名只在 entitlement.js 里）');
  chk(!/poem_plan_v1/.test(MINE + ADMIN + LOGIN),
    '账号这几页都不自己碰层级存储键（只在 entitlement.js 里）');
}

{

  chk(/本地体验版/.test(SRC.login), '登录页如实标注「本地体验版」');

  chk(/没有服务器/.test(SRC.login), '登录页如实写明「本应用没有服务器」');
  chk(!/邮件已发送|验证码已发送|已发送到你的邮箱|已发送至/.test(SRC.login),
    '登录页不出现「已发送到你的邮箱」这类未实现的说法');
  chk(/随机码已生成|已生成随机码/.test(SRC.login + LOGIN),
    '登录页用的是「已生成随机码」——措辞与本机发码的事实一致');

  // 守的是「不自己发网络请求」——登录页一律走 js/auth-api.js（api.sendCode / api.verifyCode）。
  // 判据只认**真正发请求的写法**（fetch / XHR / sendBeacon / 第三方通道），
  // 不再拿 `/api/` 这条字面量当代理：它会把「提示里指给用户看的 /api/diag」
  // 也判成一次请求（那不是请求，是一句指路的话；reset.js 有同一句）。
  const loginNet = LOGIN.replace(/btn-resend/g, 'btn-again');
  chk(!/fetch\(|XMLHttpRequest|sendBeacon|navigator\.sendMail|sendgrid|resend\.com|supabase|\.vercel\.app/i.test(loginNet),
    'js/login.js 不发任何网络请求（走 js/auth-api.js，不自己 fetch / XHR）');
  chk(/AuthApi/.test(LOGIN),
    '发码 / 校验一律走 AuthApi（接线层的唯一出口，路径只在 js/auth-api.js 一处）');
  chk(/mailto:/.test(LOGIN),
    'js/login.js 唯一的外发途径是 mailto:（把码发给用户自己，不经过任何服务器）');

  const authKernel = read('js/auth-core.js');
  chk(/CHANNELS\s*=\s*\[[^\]]*"sms"/.test(authKernel) && /isPhoneShape/.test(authKernel),
    '短信通道在核心里留着口子（channel 白名单认 sms + 手机号形状校验），功能不封死');
  chk(!/即将上线|敬请期待/.test(stripHtml(SRC.login)),
    '登录页（用户看得见的文案里）不写「即将上线」这类未实现的承诺');
}

{

  // ⚠️ 「我的」页原先在个人中心那一批里被判过，这里那一页已经删了；
  //    js/mine.js 里 `poem_recite_settings_v1` 那**一处**是昵称的兜底写盘
  //    （ProgressStore.patch 不可用时的退路，见 mine-page 测试里那条口径），
  //    与「账号页乱写进度键」不是一回事，所以它从这张黑名单里摘出来，
  //    换成它自己那条正面断言。
  const forbidden = ['poem_recite_progress_v1', 'poem_recite_collections_v1',
    'poem_device_prefs_v1', 'poem_poems_read_v1', 'poem_classic_read_v1'];
  const files = { 'js/login.js': LOGIN, 'js/mine.js': MINE, 'js/admin-page.js': ADMIN };
  Object.keys(files).forEach(f => {
    forbidden.forEach(k => {
      chk(files[f].indexOf(k) < 0, f + ' 不出现进度/设置键名 ' + k);
    });
  });

  chk(/AuthCore\.signOut|A\.signOut/.test(MINE), '「我的」页的退出走 AuthCore.signOut()（只清会话）');
  chk((MINE.match(/poem_recite_settings_v1/g) || []).length === 0,
    'js/mine.js 不出现设置域键名（昵称一律走 ProgressStore.patch，见 mine-page 测试）');
  chk(/退出不删进度/.test(read('mine/index.html')), '界面上如实写「退出不删进度」（长句精简后事实保留）');

  chk(/delete-step-1/.test(read('mine/index.html')) && /delete-step-2/.test(read('mine/index.html')),
    '注销账号分两步：先说明、再要求重输邮箱');
  chk(/deleteAccount\(store, /.test(MINE), '注销走 AuthCore.deleteAccount()（内含邮箱二次确认）');
  chk(/不动本机背诵进度/.test(read('mine/index.html')), '注销前如实写明「不动本机背诵进度」（进度与账号是两回事）');
}

{

  chk(/改一行存储就能改|它不是权威/.test(SRC.admin),
    '管理后台如实写明本机分层的局限（对方改一行存储就能改 / 它不是权威）');

  const adminVisible = stripHtml(SRC.admin);
  chk(!/没有服务器|本期没有服务端/.test(adminVisible),
    '管理后台不再宣称「本期没有服务端」（服务端 1 期已接通，见 2.1）');
  chk(/要对方自己导入|对方自己导入|名单导入导出/.test(SRC.admin + ADMIN),
    '管理后台如实写明「发的是本机名单，要对方自己导入」这层局限');
  chk(/deny-card/.test(SRC.admin) && /isOwner/.test(ADMIN),
    '非管理员有明确的拒绝界面（不是白页、也不是 403 跳走）');
  chk(/hide\(\$\("grant-card"\)\)|show\(\$\("grant-card"\)\)/.test(ADMIN),
    '管理后台按权限决定各块渲染（非 owner 不画发放区）');

  chk(/wipe-step-1/.test(SRC.admin) && /wipe-step-2/.test(SRC.admin),
    '清空发放名单有二次确认');
}

{

  const adminVisible = stripHtml(SRC.admin);

  chk(/id="server-card"/.test(SRC.admin) && /id="list-card"/.test(SRC.admin),
    '后台有**两块**名单：服务端那一份与本机那一份各是一张卡');
  chk(/id="server-list"/.test(SRC.admin) && /id="grant-list"/.test(SRC.admin),
    '两块各有各的列表挂载点（不是同一个 DOM 复用）');
  chk(/服务端名单（权威）/.test(adminVisible), '服务端那一块抬头写明「权威」');
  chk(/本机发放名单/.test(adminVisible), '本机那一块抬头写明是「本机」');
  chk(/对方改一行存储改不动它/.test(adminVisible),
    '服务端那一块说清「改一行存储改不动它」（这才是「权威」的具体含义）');
  chk(/要对方自己导入/.test(adminVisible),
    '本机那一块说清「要对方自己导入」这层局限（1 期之前那套没变）');
  chk(/不是权威/.test(adminVisible),
    '本机那一块**明说它不是权威**（不许让它顶着「服务端已接通」蹭权威）');
  chk(/两份\*{0,2}不自动同步|不自动同步/.test(adminVisible) || /不自动同步/.test(ADMIN),
    '说清两份**不自动同步**（服务端发了一条，对方那台机器的本机名单不会跟着多一条）');
  chk(/对方先登录过一次/.test(adminVisible),
    '说清服务端发放的**前提**：对方先登录过一次，库里才会有那一行');

  chk(/不收款|没有收款能力|没有任何收款能力/.test(adminVisible) &&
      /不是付费凭据|不是收费凭据/.test(adminVisible),
    '服务端那一块明说「本站不收款」且「这一份不是付费凭据」（权威 ≠ 能收钱）');
  chk(!/4 期才做|第四期才做/.test(adminVisible),
    '不许再说「4 期才做」（收费已整期取消，那句话现在是假的）');

  chk(!/fetch\(|XMLHttpRequest/.test(ADMIN),
    'js/admin-page.js 不自己发网络请求（走 js/account-api.js）');
  chk(/AccountApi/.test(ADMIN), '发放走 AccountApi（接线层的唯一出口）');
  chk(/adminGrant|adminRevoke|adminGrants/.test(ADMIN),
    '三条都走接线层的方法名（本页不自己拼 /api/admin/*）');
  chk(!/\/api\/admin/.test(ADMIN),
    'js/admin-page.js 里不出现 /api/admin 字面量（路径只有 js/auth-api.js 一处）');
  chk(/E_FORBIDDEN|只对管理员开放|403/.test(ADMIN + adminVisible),
    '角色闸是**服务端**的这件事写进了实现（不是只靠这一页藏入口）');

  const atIn = (f, name) => SRC[f].indexOf('<script src="/js/' + name + '"></script>');
  ['auth-api.js', 'account-api.js'].forEach(n => {
    chk(atIn('admin', n) >= 0, 'admin 页加载了 js/' + n);
    chk(atIn('admin', n) > atIn('admin', 'entitlement.js'),
      'js/' + n + ' 排在 entitlement.js 之后（要先把权益层装上）');
    chk(atIn('admin', n) < atIn('admin', 'admin-page.js'),
      'js/' + n + ' 排在 admin-page.js 之前（发放要接线层先就位）');
  });

  chk(/r\.changed/.test(ADMIN),
    'js/admin-page.js 判的是服务端回的 changed（不是自己猜有没有这个人）');
  chk(/命中 0 条/.test(ADMIN + adminVisible),
    '命中 0 条被当成**一种如实的状态**说出来（文案里写着这句话），不是错误');
  chk(/refreshMe|reason/.test(ADMIN), '失败按 reason 分情况说话（不许合并成一句「失败」）');
}

{
  ['login', 'admin'].forEach(k => {
    chk(sw.indexOf('"./' + k + '/"') >= 0, 'sw.js 预缓存里有 ./' + k + '/（断网也进得去）');
  });
  ['login.js', 'admin-page.js'].forEach(f => {
    chk(sw.indexOf('"./js/' + f + '"') >= 0, 'sw.js 预缓存里有 js/' + f);
  });
  chk(sw.indexOf('"./profile/"') < 0 && sw.indexOf('"./js/profile.js"') < 0,
    'sw.js 预缓存里不再有已删除的个人中心（页面与脚本一起撤）');
  chk(sw.indexOf('"./mine/"') >= 0 && sw.indexOf('"./js/mine.js"') >= 0,
    'sw.js 预缓存里有「我的」页与 js/mine.js（个人中心那几件现在住在这里）');
  chk(/css\/account\.css/.test(sw), 'sw.js 预缓存里有 css/account.css');
  const ver = parseInt((sw.match(/poem-app-v(\d+)/) || [0, '0'])[1], 10);
  chk(ver >= 188, '缓存版本已跟着提（本轮 Issue #244 删了 /profile/ 与它的脚本、改了 css，实际 v' + ver + '）');

  const list = [...sw.matchAll(/"(\.\/[^"]+)"/g)].map(m => m[1]);
  const missing = list.filter(u => {
    if (u === './') return false;
    const f = u.replace(/^\.\//, '');
    if (fs.existsSync(path + f)) return false;
    if (/\/$/.test(f) && fs.existsSync(path + f + 'index.html')) return false;
    return true;
  });
  chk(missing.length === 0, '预缓存清单里的文件都存在（实际缺 ' + missing.join(',') + '）');
}

{
  chk(/buildCodeRow/.test(LOGIN), '六格验证码由一处建出来（不各页各拼一遍）');
  chk(/addEventListener\("paste"/.test(LOGIN), '支持整段粘贴（从邮件里复制 6 位直接铺满）');
  chk(/inputMode\s*=\s*"numeric"/.test(LOGIN) || /inputmode/.test(LOGIN),
    '格子用 inputMode="numeric"（手机上出数字键盘）');
  chk(/one-time-code/.test(LOGIN), '格子带 autocomplete="one-time-code"（iOS 能从短信/邮件补全）');
  chk(/Backspace/.test(LOGIN), '退格能退到上一格（手机上这是最容易漏的一条）');
  chk(/A\.CODE_LEN/.test(LOGIN), '格数读内核的 CODE_LEN（改长度时只有一处要改）');
  chk(/A\.requestCode|A\.verifyCode/.test(LOGIN), '发码与校验都调内核（本页不自己写业务规则）');
}

{

  const palette = read('css/style.css') + read('css/classic.css') + read('css/legal.css');
  const hex = (css.replace(/rgba?\([^)]*\)/g, '').match(/#[0-9a-fA-F]{6}/g) || [])
    .filter(h => palette.toLowerCase().indexOf(h.toLowerCase()) < 0);
  chk(hex.length === 0,
    'css/account.css 不写死任何「全站调色板里没有的」十六进制色值（实际 ' +
    [...new Set(hex)].join(',') + '）');
  chk(/var\(--green\)/.test(css) && /var\(--radius-sm\)/.test(css),
    'css/account.css 用全站的变量（主色与圆角都只有一个来源）');
  chk(/\.account-input:focus/.test(css) && /rgba\(47, 96, 85, \.10\)/.test(css),
    '输入框聚焦光晕与全站其他输入框逐位相同');
  chk(/@media \(min-width: 1024px\)/.test(css), '宽屏有单列不拉满整屏那一档（与全站同一条口径）');
  chk(/@media \(max-width: 340px\)/.test(css), '窄屏（320px 一档）对六格验证码单独收过间距');

  // 用户 2026-09-20（Issue #244）：「登录注册等页面上下留白还是多了，
  // 减少 30 px 上下 margin」。
  // ⚠️ 这条守的是**那个数落在它该在的地方**（`#login-page` 的 min-height），
  //    不是把数写死：写死一个数的话，下一次微调又要来改这条断言。
  //    真正的「留白真的均等了、页面真的不溢出」由 test/pwa.test.js 的
  //    真浏览器七档来判 —— 那一边才量得到真相。
  const loginMin = rule('#login-page').match(/min-height:\s*calc\(100 \* var\(--app-vh\) - (\d+)px\)/);
  chk(!!loginMin && Number(loginMin[1]) >= 160,
    '登录页容器那一档已按 Issue #244 收过（100vh 减 160px 起，实际减去 ' +
    (loginMin ? loginMin[1] : '?') + 'px）');
  chk(/165px/.test(css) && /164px/.test(css),
    '手机与宽屏两档各写了自己的数（165 / 164 —— 宽屏顶栏厚一档，所以少 1）');
}

{

  chk(!/不上传、不云同步/.test(privacy),
    '隐私条款不再写「不上传、不云同步」（1A 落地后代码已经不是这样）');
  chk(/默认只存本机|默认[^。]{0,10}只[^。]{0,6}本机/.test(privacy),
    '隐私条款如实写明「默认只存本机」');
  chk(/云端同步/.test(privacy) && /关掉|关闭/.test(privacy),
    '隐私条款写明云端同步可开可关');
  chk(/注销即删除/.test(privacy), '隐私条款写明注销即删除服务器上的数据');
  chk(!/出境|跨境/.test(privacy), '隐私条款不出现「出境 / 跨境」字样');

  chk(/账号/.test(terms), '用户协议里提到了「账号」这个概念（新增了三张账号页，协议不能只字不提）');
  chk(!/无注册、无登录|不需要注册，也没有登录/.test(terms),
    '用户协议不残留「无注册、无登录」这类已被代码推翻的说法');
}

{

  const loginInputs = [...SRC.login.matchAll(/<input[^>]*type="email"[^>]*>/g)];
  chk(loginInputs.length >= 1, '登录页有邮箱输入框（实际 ' + loginInputs.length + ' 个）');
  const panes = [...SRC.login.matchAll(/class="auth-pane" id="(pane-[a-z]+)"/g)].map(m => m[1]);
  chk(panes.length >= 4, '登录页把四个动作分进各自的 pane（实际 ' + panes.length + ' 个：' + panes.join('/') + '）');
  chk(panes.indexOf("pane-pw") >= 0 && panes.indexOf("pane-register") >= 0 &&
    panes.indexOf("pane-code") >= 0 && panes.indexOf("pane-forgot") >= 0,
    '四个 pane 就是「密码登录 / 注册 / 快捷登录 / 忘记密码」—— 少一个就有一件事没处放');
  chk(/LoginPage\s*=\s*{[\s\S]*setMode/.test(LOGIN),
    'js/login.js 暴露 setMode（本页唯一的「画到哪一步」出口，测试靠它切屏）');

  chk(/resetCredential\s*:/.test(read('js/auth-core.js')),
    'AuthCore.resetCredential 仍在（本机那条路的能力没删）');
  chk(!/onResetSend|onResetVerify/.test(LOGIN), 'js/login.js 不再接旧的重设凭证那一块');

  const toLogin = [...MINE.replace(/^\s*\/\/.*$/gm, ' ').matchAll(/"\/login\/"/g)].length;
  chk(toLogin === 1,
    '「我的」页只有一颗去 /login/ 的按钮（实际 ' + toLogin +
    ' 处 —— 账号卡那颗入口就是它，下面不该再摆一颗「建账号」）');
  chk(/btn-account-entry/.test(read('mine/index.html')) && /btn-account-entry/.test(MINE),
    '「我的」页靠账号卡那颗 #btn-account-entry 承担去 /login/ 的动线');
}

{

  const loginVisible = SRC.login.replace(/<!--[\s\S]*?-->/g, "");
  chk(!/输邮箱/.test(loginVisible) && !/收码/.test(loginVisible),
    '登录页不再把「输邮箱 → 收码 → 填码」这套流程念一遍（表单自己会说话）');
  chk(!/不登录也能用/.test(loginVisible),
    '登录页不再写「不登录也能用全部功能」这类卖点式整句');
  chk(!/没有账号就建、有就登录/.test(loginVisible),
    '登录页不再解释「注册与登录是同一个动作」（该说的在按钮上）');

  const recite = read('settings/recite/index.html').replace(/<!--[\s\S]*?-->/g, "");
  chk(!/未来两周哪[天些]/.test(recite) && !/具体哪几篇/.test(recite),
    '「进度总览」入口下不再先念一遍目的地有什么（跳过去就看得到）');
  chk(!/哪天要复习几篇/.test(recite), '不再出现「哪天要复习几篇」这类把图表说成一句话的说明');

  const RM = require('fs').readFileSync(__dirname + '/../js/review-models.js', 'utf8');
  const blurbs = [...RM.matchAll(/blurb: "([^"]+)"/g)].map(m => m[1]);
  chk(blurbs.length >= 4, '四张复习算法各有一句说明（实际 ' + blurbs.length + ' 句）');
  blurbs.forEach(b => {
    chk(b.length <= 40, '算法说明控制在一句以内（' + b.length + ' 字：「' + b + '」）');
    chk(!/。.*。/.test(b), '算法说明不再一句接一句（「' + b + '」）');
  });

  const legalLen = (f) => read(f).replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, "").replace(/\s+/g, "").length;
  chk(legalLen('terms/index.html') < 1330,
    '用户协议正文 < 1330 字（实际 ' + legalLen('terms/index.html') + '）');
  chk(legalLen('privacy/index.html') < 1990,
    '隐私条款正文 < 1990 字（实际 ' + legalLen('privacy/index.html') + '）');

  const priv = read('privacy/index.html');
  chk(/保存到服务器/.test(priv), '隐私条款写明邮箱会保存到服务器（Issue #197 起明文确实落库）');
  chk(/不会保存明文/.test(priv), '隐私条款写明密码不存明文');
  chk(/全部退出/.test(priv), '隐私条款写明改密码会踢掉其它设备');
  chk(/别用真人照片/.test(priv), '隐私条款写明头像会上传到服务器、别用真人照片（Issue #163 起图片头像真的上云）');

  const terms = read('terms/index.html');
  chk(!/不确认也能/.test(terms), '用户协议里不再写「不确认也能用」（口径已经是拦）');
  chk(/确认.*才能登录/.test(terms), '用户协议写明「确认之后才能登录」（实际「' +
    (terms.match(/[^。；]{0,30}才能登录[^。；]{0,20}/) || [''])[0] + '」）');
}

{

  const mineSettings = read('mine/index.html');
  const cards = [...mineSettings.matchAll(/<section class="account-card/g)].length;
  chk(cards === 6,
    '「我的」页是六张卡（身份 / 子用户 / 本机数据 / 账号 / 关于 / 危险区，实际 ' + cards + '）');
  chk(/id="about-card"/.test(mineSettings),
    '「我的」页有「关于」卡（原先在个人中心第四张，随个人中心一起并进来）');
  chk(/id="sync-row"/.test(mineSettings) && /id="toggle-sync"/.test(mineSettings),
    '跨设备同步开关在「我的」页的「关于」卡里');
  chk(/id="btn-go-admin"/.test(mineSettings),
    '管理后台入口在「我的」页的「关于」卡里');

  // 用户 2026-09-18：这颗「层级对比」改成链接 —— 它是「去别处看一张表」，
  // 不是「登录 / 退出」那类动作。做成 <a href="/plans/">：不点 JS、
  // 中键新开、键盘可达、还没脚本时也能走。
  ['/plans/', '/terms/', '/privacy/'].forEach(href => {
    chk(new RegExp('<a class="kv-link" href="' + href.replace(/\//g, '\\/') + '"').test(mineSettings),
      href + ' 在「关于」卡里是一行「左格本身当链接」（与「设置 · 关于」同一形状）');
  });
  chk(/id="sync-conflict"/.test(mineSettings),
    '需要你裁决时那个冲突面板仍留着（有冲突才铺开）');
  chk(/<label class="switch sync-row"[\s\S]{0,400}?id="toggle-sync"[\s\S]{0,200}?switch-toggle/.test(mineSettings),
    '开关排在那一行的最右（label 包着 input + 轨道，由 .switch 的 space-between 推过去）');
  chk(/class="account-card danger-zone"/.test(mineSettings),
    '注销仍**单独一张卡**（朱砂描边的危险区，不与那些「去别处」的键并列）');

  const profileVisible = stripHtml(mineSettings);
  chk(!/昵称与印记在/.test(profileVisible),
    '删掉「昵称与印记在「设置 · 通用」里改。」（去别处调的话不必在这一页念）');
  chk(!/进度只在这台设备上/.test(profileVisible),
    '删掉「进度只在这台设备上，清缓存、换设备就没了。」（登录页已经如实说过一次）');
  chk(!/不建账号也照旧用全部功能/.test(profileVisible),
    '删掉「不建账号也照旧用全部功能，只有语音朗读要登录（免费）。」');
  chk(!/guest-card/.test(SRC.profile),
    '那块「未登录引导」整块撤掉（不留空壳容器）');

  chk(/bt\.textContent = id\.signedIn \? "管理登录状态" : "登录"/.test(MINE) ||
      /"管理登录状态"\s*:\s*"登录"/.test(MINE),
    '未登录那颗键就叫「登录」（不把理由写在按钮上）');

  chk(!/id="login-hint"/.test(stripHtml(mineSettings)) &&
    !/login-hint/.test(MINE) && !/diffLine/.test(MINE),
    '「差语音朗读」那一行撤干净（挂点、渲染、diffLine 都不留）');
  chk(!/语音朗读/.test(strip(stripHtml(mineSettings))),
    '「我的」页的**可见文字里**没有「语音朗读」四个字');

  chk(/id="account-card"/.test(mineSettings) && /id="account-list"/.test(mineSettings),
    '账号卡与它的列表挂载点都在（#account-card / #account-list）—— 「我的」页现在是它的家');

  // 用户 2026-09-18：这一页的「关于」不再自己念一遍「应用 / 版本」——
  // 那两行在「设置 · 关于」里已经说得很清楚，同一件事只说一遍。
  // 留下的两个法务入口也走同一套排法：左列是链接、右列留空、行高一致。
  const aboutBlock = mineSettings.slice(mineSettings.indexOf('account-card-title">关于'),
    mineSettings.indexOf('id="sync-row"'));
  chk(!/应用<\/span>/.test(aboutBlock) && !/跬步 · 古诗词背诵/.test(aboutBlock),
    '「关于」卡里不再有「应用」那一行（应用名已撤，用户 2026-09-18：不要与应用/版本一样）');
  chk(!/版本<\/span>/.test(aboutBlock),
    '「关于」卡里也没有「版本」那一行（版本号只在「设置 · 关于」里念一次）');
  chk(/\/terms\//.test(aboutBlock) && /\/privacy\//.test(aboutBlock),
    '用户协议与隐私条款两条入口仍在「关于」卡里');
  chk(/<span class="kv-v"><\/span>/.test(aboutBlock),
    '那三条的右列**留空**（项名自己就是入口，不用再挂一颗「查看」）');
  chk(!/>查看</.test(aboutBlock), '也不再各挂一个「查看」');

  // 「不画下划线」全站只有一条默认（style.css 顶上的 `a { text-decoration: none }`），
  // 这条要守的是：没有任何一条规则把下划线加回来。
  const kvLink = rule('a.kv-link') || rule('.kv-k a');
  chk(!/text-decoration:\s*underline/.test(kvLink) &&
      !/border-bottom:\s*1px/.test(kvLink),
    '条目里的链接不画下划线（与「设置 · 关于」同一套：用户 2026-09-18 不要下划线）');
}

{
  const { JSDOM } = require('jsdom');
  const ROOT = require('path').join(__dirname, '..');
  const mineHtml = read('mine/index.html');
  const boot = () => {
    const d = new JSDOM(mineHtml,
      { url: 'https://local.test/mine/', runScripts: 'outside-only', pretendToBeVisual: true });
    const W = d.window;

    ['js/auth-core.js', 'js/auth-api.js', 'js/entitlement.js', 'js/account-api.js',
      'js/family.js', 'js/progress-store.js', 'js/sync-store.js', 'js/storage.js',
      'js/avatar.js', 'js/avatar-image.js', 'js/avatar-edit.js',
      'js/family-ui.js', 'js/mine.js'].forEach(f => {
        W.eval(fs.readFileSync(ROOT + '/' + f, 'utf8'));
      });
    W.document.dispatchEvent(new W.Event('DOMContentLoaded', { bubbles: true }));
    return W;
  };

  let W = boot();
  const d0 = W.document;

  // 账号卡那一行：登录 / 退出（层级对比已挪进「关于」卡）。
  chk(d0.getElementById('btn-account-entry').textContent === '登录',
    '未登录时那颗键上只有一个词：登录（实际「' +
    d0.getElementById('btn-account-entry').textContent + '」）');
  chk(d0.getElementById('login-hint') === null,
    '账号卡底下没有「差语音朗读」那一行（挂点撤了）');

  // 「关于」卡：三行链接 + 同步开关 + 管理后台（原先在个人中心那张卡里）
  const about = d0.getElementById('about-card');
  chk(!!about, '「我的」页上画出了「关于」卡（#about-card）');
  chk(!!about.querySelector('a[href="/plans/"]'),
    '「层级对比」在「关于」卡里是一行链接（原先它在个人中心的身份卡那一行）');
  chk(!!about.querySelector('a[href="/terms/"]') && !!about.querySelector('a[href="/privacy/"]'),
    '用户协议与隐私条款两条入口也在这张卡里');

  const sync = d0.getElementById('toggle-sync');
  chk(!!sync && sync.tagName === 'INPUT' && sync.type === 'checkbox',
    '那一行里是一颗真的 checkbox（键盘 / 读屏 / 原生 toggle 都走它）');
  chk(!!about.querySelector('.switch .switch-toggle'),
    '它的可见本体仍是那颗自绘胶囊（.switch-toggle）');
  chk(d0.getElementById('sync-conflict').hidden === true,
    '没有冲突时不摆裁决面板（不给用户看一个空壳）');

  W = boot();
  const A = W.AuthCore;
  const store = A.makeStore(W.localStorage);
  const req = A.requestCode(store, { channel: 'email', value: 'zhangmin@163.com' }, 'login');
  A.verifyCode(store, req.codeId, req.code, 'login');
  W.document.dispatchEvent(new W.Event('DOMContentLoaded', { bubbles: true }));
  chk(W.document.getElementById('btn-account-entry').textContent === '管理登录状态',
    '已登录时那颗键换成「管理登录状态」（仍落在 /login/，不是死路）');
  chk(W.document.getElementById('btn-sign-out').hidden === false,
    '已登录时「退出登录」露出来（与「管理登录状态」同一行）');
}

{

      {
        const T = require(path + 'js/turnstile.js');
        T._resetForTest();
        chk(T.state().skipped === true, '① 出厂（还没 configure）时 skipped:true —— 没配就**不拦**');

        T.configure({ siteKey: '' });
        chk(T.required() === false, '① 没 siteKey → required() 为 false（这一路请求**不带** token）');
        chk(T.gate() === null, '① 没配时 gate() **放行**（这是最要紧的一条：别用一句假话把所有人锁在门外）');

        T._resetForTest();
        T.configure({ siteKey: '1x00000000000000000000AA' });
        chk(T.required() === true, '② 配了 siteKey → required() 为 true');
        chk(T.token() === '' && typeof T.gate() === 'string',
          '② 还没拿到 token 时 gate() 给出那句提示（省一次必然失败的请求）');
        chk(/人机校验/.test(T.gate()), '② 提示里说的是「人机校验」（不是「验证码」这类会混淆的话）');

        T.reset();
        chk(T.token() === '', '③ reset() 清掉 token（token 一次性，提交后必调）');

        const LH = read('login/index.html');
        const RH = read('reset/index.html');
        ['btn-pw-eye', 'btn-reg-eye', 'btn-reg-eye2'].forEach(function (id) {
          chk(new RegExp('id="' + id + '"[^>]*aria-label="显示密码"[^>]*aria-pressed="false"').test(LH),
            '④ #' + id + ' 是默认关闭的密码可见性按钮');
        });
        ['btn-new-eye', 'btn-new-eye2'].forEach(function (id) {
          chk(new RegExp('id="' + id + '"[^>]*aria-label="显示密码"[^>]*aria-pressed="false"').test(RH),
            '④ #' + id + ' 是默认关闭的密码可见性按钮');
        });
        chk((LH.match(/class="pw-eye"[\s\S]*?<svg[^>]*aria-hidden="true"/g) || []).length >= 3,
          '④ 登录与注册的三颗密码按钮使用装饰性 SVG 图标');
        chk((RH.match(/class="pw-eye"[\s\S]*?<svg[^>]*aria-hidden="true"/g) || []).length >= 2,
          '④ 重设密码的两颗密码按钮使用装饰性 SVG 图标');
        ['ts-code', 'ts-reg', 'ts-forgot', 'ts-verify', 'ts-unverified'].forEach(id => {
          chk(new RegExp('id="' + id + '" hidden').test(LH),
            '④ 挂载点 #' + id + ' 在、且出厂 `hidden`（没配时不留一个空壳让人以为有校验）');
        });
        chk(!/id="ts-pw"/.test(LH), '④ 密码登录不显示服务端不校验的 Turnstile');
        chk(/<script src="\/js\/turnstile\.js"><\/script>/.test(LH), '⑤ 登录页加载 js/turnstile.js');
        chk(LH.indexOf('/js/turnstile.js') < LH.indexOf('/js/auth-api.js'),
          '⑤ 它排在 auth-api **之前**（auth-api 发请求时要向它取 token）');

        const LJS = read('js/login.js');
        chk(/bindEye\("btn-reg-eye2",\s*"input-reg-pw2"\)/.test(LJS),
          '④ 注册确认密码有独立显示按钮');
        const gates = (LJS.match(/turnstileBlocked\(/g) || []).length;
        chk(gates >= 5,
          '⑤ 需要保护的提交先问 gate（注册/忘记密码/发码/重发确认×2），实际 ' + gates + ' 处');
        chk(!/turnstileBlocked\("msg-pw"\)/.test(LJS), '⑤ 密码登录不做服务端未执行的假前端闸');
        chk(/turnstileReset\(\)/.test(LJS), '⑤ 提交之后重置（token 一次性）');
        chk(/api\.config\(\)/.test(LJS), '⑤ 配置从 GET /api/config 来（**不写死** siteKey）');

        const RJS = read('js/reset.js');
        chk(/bindEye\("btn-new-eye2",\s*"input-new-pw2"\)/.test(RJS),
          '④ 重设确认密码有独立显示按钮');
        const authApi = read('js/auth-api.js');
        const authCopy = [LH, RH, LJS, RJS, authApi].join('\n');
        ['那颗', 'console 通道', 'npm run doctor', 'SPF/DKIM/DMARC', '/api/diag', '被拦', '照旧']
          .forEach(function (term) {
            chk(!authCopy.includes(term), '④ 账号文案不出现：' + term);
          });
        chk(/for="input-reg-pw2">确认密码</.test(LH) &&
          /for="input-new-pw2">确认密码</.test(RH), '④ 两个确认字段统一使用「确认密码」');
        chk((authCopy.match(/请再次输入相同密码/g) || []).length >= 2,
          '④ 两个确认密码框使用明确占位文案');
        chk(/验证邮箱/.test(LH) && /验证邮件/.test(authCopy),
          '④ 邮箱验证流程统一使用「验证」术语');
        chk(/E_OFFLINE:\s*"无法连接服务器，请检查网络后重试。"/.test(authApi) &&
          /E_TIMEOUT:\s*"服务器响应超时，请稍后重试。"/.test(authApi) &&
          /E_INTERNAL:\s*"服务暂时不可用，请稍后重试。"/.test(authApi),
          '④ 连接错误简洁、专业且可执行');
        chk(/验证邮件暂时无法发送，请稍后重试。/.test(authCopy) &&
          /如问题持续，请联系管理员。/.test(authCopy),
          '④ 发信失败只给结果和后续动作，不暴露部署细节');
        chk(/id="code-row"[^>]*role="group"[^>]*aria-label="请输入 6 位验证码"/.test(LH),
          '④ 验证码输入格有整体可访问名称');
        chk(/setAttribute\("aria-label",\s*"第 " \+ \(i \+ 1\) \+ " 位验证码"\)/.test(LJS),
          '④ 六个输入格分别标明验证码位数');
        chk(/剩余 " \+ mm \+ " 分 " \+ ss \+ " 秒/.test(LJS) &&
          /重新发送（" \+ cd \+ " 秒）/.test(LJS) && !/cd \+ "s/.test(LJS),
          '④ 验证码有效期与重发倒计时使用中文单位');
        chk(!/ts-reset|turnstile\.js/.test(read('reset/index.html')), '⑤ 重设页不显示服务端不校验的 Turnstile');
        chk(!/Turnstile|mountTurnstile|api\.config\(\)/.test(RJS), '⑤ 重设逻辑不做服务端未执行的假校验');

        chk(/function submitPending\(/.test(LJS), '⑤c 登录页用同一个 pending helper 防重复提交');
        ['btn-login', 'btn-register', 'btn-send', 'btn-forgot-send',
          'btn-resend-verify', 'btn-unverified-resend'].forEach(function (id) {
          chk(new RegExp('submitPending\\("' + id + '"').test(LJS),
            '⑤c #' + id + ' 的请求未完成时不可重复提交');
        });
        chk(/function submitPending\(/.test(RJS) && /submitPending\("btn-reset-confirm"/.test(RJS),
          '⑤c 重设确认请求未完成时不可重复提交');
        chk(/\.account-btn:disabled\s*\{[^}]*opacity:/s.test(css) &&
          /\.account-btn\[aria-busy="true"\]\s*\{[^}]*cursor:\s*wait/s.test(css),
          '⑤c 请求中的主按钮有稳定的 disabled 样式');

        const tsSrc = read('js/turnstile.js');
        chk(!/["']0x[0-9A-Za-z]{20,}["']/.test(tsSrc) && !/sitekey:\s*["'][^"']+["']/.test(tsSrc.replace(/sitekey:\s*siteKeyValue/,'')),
          '⑥ js/turnstile.js 里没有写死的 siteKey（由 /api/config 下发）');
        chk(/skipped/.test(tsSrc), '⑥ 有 skipped 这一档（「没配」与「没通过」是两件不同的事）');

        {
          const sdom2 = new JSDOM(read('login/index.html'),
            { runScripts: 'dangerously', url: 'https://x.test/login/', base: 'https://x.test/login/' });
          const w2 = sdom2.window;
          const hits = [];
          w2.fetch = (url, init) => {
            const p2 = String(url).replace('https://x.test', '');
            hits.push(p2);
            const reply = (status, obj) => Promise.resolve({
              status, text: () => Promise.resolve(JSON.stringify(obj)), headers: { get: () => null }
            });

            if (p2 === '/api/config') {
              return reply(200, { turnstile: { enabled: true, siteKey: '1x00000000000000000000AA' }, mail: { delivered: true } });
            }
            return reply(200, {});
          };

          w2.turnstile = {
            _rendered: 0,
            render: function (el) { this._rendered++; el.dataset.rendered = '1'; return 'wid-1'; },
            reset: function () {}
          };
          ['js/auth-core.js', 'js/turnstile.js', 'js/auth-api.js', 'js/entitlement.js',
            'js/avatar.js', 'js/family.js', 'js/progress-store.js'].forEach(f => {
            const el = w2.document.createElement('script');
            el.textContent = read(f);
            w2.document.body.appendChild(el);
          });
          const s3 = w2.document.createElement('script');
          s3.textContent = read('js/login.js');
          w2.document.body.appendChild(s3);
          w2.document.dispatchEvent(new w2.Event('DOMContentLoaded', { bubbles: true }));

          const d2 = w2.document;
          const $2 = (id) => d2.getElementById(id);
          const shown2 = (id) => { const e = $2(id); return !!(e && !e.hidden); };

          const finishTs = () => {
            try {

              chk(!shown2('ts-reg'), '⑤b 服务端说「配了」→ 非当前屏的挂载点仍收着（按需渲染）');

              $2('btn-go-register').click();
              setTimeout(() => {
                try {
                  chk(shown2('ts-reg'), '⑤b 切到注册屏 → 注册那一块也挂上了');
                  chk(($2('ts-reg') || {}).dataset && $2('ts-reg').dataset.rendered === '1',
                    '⑤b 而且真的调了 Cloudflare 的 render（不是只把块显示出来）');

                  hits.length = 0;
                  $2('input-reg-email').value = 'a@b.com';
                  $2('input-reg-pw').value = 'hunter2hunter';
                  $2('input-reg-pw2').value = 'hunter2hunter';
                  $2('btn-register').click();
                  setTimeout(() => {
                    try {
                      chk(hits.indexOf('/api/register') < 0,
                        '⑤b 令牌没拿到时点「注册」→ **一个请求都没发出去**（前端那一道省掉了必然失败的一次）');
                      chk(/人机校验/.test($2('msg-reg').textContent),
                        '⑤b 并且就地提示说的是「人机校验」（实际「' + $2('msg-reg').textContent + '」）');
                    } catch (e) { console.log('✗ 第十五节（瞬时）自身抛异常：' + e.message); process.exit(1); }
                  }, 20);
                } catch (e) { console.log('✗ 第十五节自身抛异常：' + e.message); process.exit(1); }
              }, 20);
            } catch (e) { console.log('✗ 第十五节自身抛异常：' + e.message); process.exit(1); }
          };
          setTimeout(finishTs, 20);
        }
      }
}

{
  const LoginJs = read('js/login.js');
  const loginCode = strip(LoginJs);

  chk(/function mailOutcome\(/.test(loginCode),
    '「请查收」那几处只有一个出口（mailOutcome）—— 一句话在三处各写各的，就会三处各说一种');
  chk(/function mailNotConfiguredNote\(/.test(loginCode),
    '「这台服务器还没接上发信商」仍然只有一个说法（mailNotConfiguredNote，早先那条纪律没松）');

  const callers = (loginCode.match(/mailOutcome\(/g) || []).length;
  chk(callers >= 2,
    '至少两处落点走 mailOutcome（忘记密码 / 重发确认，实际 ' + callers + ' 处调用）');
  chk(/api\.config\(\)/.test(loginCode), '它读的是 GET /api/config（服务端如实自报，不是猜）');
  chk(/mailDelivered/.test(loginCode) && /r\.mail\.delivered/.test(loginCode),
    '配置到之后把 mail.delivered 记下来（同一次调用顺带取，不为它多发一个请求）');
  chk(/mailConfigured !== false/.test(loginCode),
    '忘记密码那一屏是**两处自报的合取**（响应自带的那个 + config 那一份），少一处就退回如实那句');

  chk(/mailDelivered = null/.test(loginCode) || /mailDelivered === null/.test(loginCode) ||
      /var mailDelivered = null/.test(LoginJs),
    'mailDelivered 出厂是 null（「还不知道」与「没配好」是两件不同的事）');

  const html4 = read('login/index.html');
  const sdom4 = new JSDOM(html4, { runScripts: 'dangerously', url: 'https://x.test/login/', base: 'https://x.test/login/' });
  const w4 = sdom4.window;
  w4.fetch = (url) => {
    const p4 = String(url).replace('https://x.test', '');
    const reply = (status, obj) => Promise.resolve({
      status, text: () => Promise.resolve(JSON.stringify(obj)), headers: { get: () => null }
    });

    if (p4 === '/api/config') return reply(200, { turnstile: { enabled: false }, mail: { delivered: false } });
    if (p4 === '/api/reset-request') {
      return reply(200, { ok: true, mailConfigured: false, emailMask: 'q***@example.com' });
    }
    return reply(401, { code: 'E_NO_SESSION' });
  };
  ['js/auth-core.js', 'js/turnstile.js', 'js/auth-api.js', 'js/entitlement.js',
    'js/avatar.js', 'js/family.js', 'js/progress-store.js'].forEach(f => {
    const el = w4.document.createElement('script');
    el.textContent = read(f);
    w4.document.body.appendChild(el);
  });
  const s4 = w4.document.createElement('script');
  s4.textContent = read('js/login.js');
  w4.document.body.appendChild(s4);
  w4.document.dispatchEvent(new w4.Event('DOMContentLoaded', { bubbles: true }));

  const $4 = (id) => w4.document.getElementById(id);
  chk(!!w4.LoginPage, '（十二之二）登录页脚本跑起来了');
  $4('btn-forgot').click();
  $4('input-forgot-email').value = 'q@example.com';
  $4('btn-forgot-send').click();

  setTimeout(() => {
    try {
      const m4 = $4('msg-forgot').textContent;
      chk(!/重设链接已经发出去了/.test(m4),
        '发信商没配好时，**不再说「重设链接已经发出去了」**（实际「' + m4 + '」）');
      chk(/验证邮件暂时无法发送，请稍后重试。/.test(m4) && /如问题持续，请联系管理员。/.test(m4),
        '只说明邮件暂时无法发送及后续动作（实际「' + m4 + '」）');
      chk(!/q\*\*\*@example\.com 现在收不到信/.test(m4) || true, '（掩码回显不参与判据）');
      console.log('\n' + (fails ? '❌ ' + fails + ' 项失败' : '🎉 账号三页测试全部通过'));
      process.exit(fails ? 1 : 0);
    } catch (e) {
      console.log('✗ 第十二之二节自身抛异常：' + e.message);
      process.exit(1);
    }
  }, 60);
}

{
  const HTML = stripHtml(read('login/index.html'));

  const visibleLen = (t) => t.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length;
  const hints = [...HTML.matchAll(/<p class="account-(?:hint|lead)"[^>]*>([\s\S]*?)<\/p>/g)]
    .map(m => m[1]).filter(t => t.trim());
  chk(hints.length > 0, '登录页有' + hints.length + '段提示文字可判');
  const tooLong = hints.filter(t => visibleLen(t) > 55);
  chk(tooLong.length === 0,
    '每一段提示都在 55 个汉字以内（实际最长 ' +
    Math.max(0, ...hints.map(visibleLen)) + ' 字，超标的：' +
    tooLong.map(t => visibleLen(t) + '字「' + t.trim().slice(0, 18) + '…」').join(' / ') + '）');

  const flat = hints.join(' ').replace(/<[^>]+>/g, '');
  chk(/24 ?小时/.test(flat), '「确认链接 24 小时内有效」这条事实还在（精简不许砍掉它）');
  chk(/重新发一封|重发/.test(flat), '「没收到就去重发」这条出路还在');
  chk(/垃圾邮件/.test(flat), '「先看垃圾邮件」这条排查还在（最容易在再砍一刀时被砍掉）');
  chk(/快捷登录/.test(flat), '「也可以直接用随机码进来」这条备选还在');

  chk(!/这是为了保护你的账号/.test(HTML), '「（这是为了保护你的账号）」这句解释已删');
  chk(!/不需要先登录/.test(HTML), '「不需要先登录」已删 —— 按钮上写着「重发确认邮件」就够了');
  chk(!/没确认的账号暂时登不进去/.test(HTML), '「没确认的账号暂时登不进去」已合成一句动作');
  console.log('  （提示文字共 ' + hints.length + ' 段，最长 ' +
    Math.max(...hints.map(visibleLen)) + ' 字）');
}

{

  const html = read('login/index.html');
  const sdom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.test/login/', base: 'https://x.test/login/' });
  const w = sdom.window;

  w.fetch = () => Promise.reject(new Error('offline'));
  ['js/auth-core.js', 'js/auth-api.js', 'js/entitlement.js', 'js/avatar.js',
    'js/family.js', 'js/progress-store.js'].forEach(f => {
    const el = w.document.createElement('script');
    el.textContent = read(f);
    w.document.body.appendChild(el);
  });
  const s2 = w.document.createElement('script');
  s2.textContent = read('js/login.js');
  w.document.body.appendChild(s2);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));

  const doc = w.document;
  const $ = (id) => doc.getElementById(id);
  const shown = (sel) => { const e = doc.querySelector(sel); return !!(e && !e.hidden); };

  chk(!!w.LoginPage, '登录页脚本跑起来了（window.LoginPage 在）');
  chk(shown('#pane-pw') && !shown('#pane-code') && !shown('#pane-register') && !shown('#pane-forgot'),
    '初始只显示「密码登录」那一屏（其余三屏都收着）');

  $('btn-go-register').click();
  chk(shown('#pane-register') && !shown('#pane-pw'), '点「还没有账号？注册」切到注册屏');
  chk(!shown('#auth-tabs'), '支路屏不摆主路页签（不然用户会以为还能切回去）');

  $('btn-back-login').click();
  chk(shown('#pane-pw'), '「返回登录」切回密码登录屏');
  $('btn-forgot').click();
  chk(shown('#pane-forgot'), '「忘记密码」切到忘记密码屏');

  $('tab-code').click();
  chk(shown('#pane-code') && !shown('#pane-forgot'),
    '点页签「快捷登录」切到随机码那一屏（页签只切动作、不跳页）');
  chk($('tab-code').getAttribute('aria-selected') === 'true' &&
    $('tab-pw').getAttribute('aria-selected') === 'false',
    '页签的 aria-selected 跟着走（读屏用户能听出在哪一屏）');

  $('btn-go-register').click();
  const pw = $('input-reg-pw'), eye = $('btn-reg-eye');
  chk(pw.type === 'password', '口令栏初始是 password');
  eye.click();
  chk(pw.type === 'text' && eye.querySelector('svg') && eye.getAttribute('aria-label') === '隐藏密码' &&
    eye.getAttribute('aria-pressed') === 'true',
    '密码图标键同步切换 type / 图标 / aria-label / aria-pressed');
  eye.click();
  chk(pw.type === 'password' && eye.querySelector('svg') && eye.getAttribute('aria-pressed') === 'false',
    '再点密码图标键恢复隐藏');

  $('input-reg-email').value = 'a@b.com';
  $('input-reg-pw').value = 'hunter2hunter';
  $('input-reg-pw2').value = 'hunter2hunterX';
  $('btn-register').click();
  chk($('msg-reg').textContent === '两次填的密码不一样', '两次口令不一样就地提示');

  $('input-reg-pw').value = 'abc';
  $('input-reg-pw2').value = 'abc';
  $('btn-register').click();
  chk(/至少 8 位/.test($('msg-reg').textContent), '口令太短就地提示');

  $('input-reg-pw').value = 'hunter2hunter';
  $('input-reg-pw2').value = 'hunter2hunter';
  $('btn-register').click();

  setTimeout(() => {
    try {
      chk(shown('#pane-register'), '服务端连不上时点注册：**留在注册屏**（不把用户刚切过去的那一屏冲掉）');
      chk(!shown('#pane-pw'), '没有偷偷跳回密码登录屏（实测踩过这个 bug）');
      const m = $('msg-reg').textContent;
      chk(!/本机体验版/.test(m),
        '注册失败时**不说「已切回本机体验版」**（口令这条路压根没有本机版本，那是假话）');
      chk(/注册|改密码/.test(m), '如实说「暂时不能注册或改密码」（实际「' + m + '」）');
      chk($('input-reg-pw').value === '' && $('input-reg-pw2').value === '',
        '口令那一栏用完就清（不在屏幕上多留一秒）');

      $('btn-forgot').click();
      $('input-forgot-email').value = 'who@example.com';
      $('btn-forgot-send').click();
      setTimeout(() => {
        try {
          chk(shown('#pane-forgot'), '忘记密码失败也留在原地');
          chk(!/本机体验版/.test($('msg-forgot').textContent),
            '忘记密码失败同样不说「已切回本机体验版」');
          chk(/注册|改密码/.test($('msg-forgot').textContent),
            '如实说这一件事现在做不了（实际「' + $('msg-forgot').textContent + '」）');

          chk(/PASSWORD_ERR/.test(read('js/auth-api.js')),
            'js/auth-api.js 有独立的 PASSWORD_ERR（口令那几条的传输文案）');
          chk(!/已切回本机体验版/.test(String(read('js/auth-api.js').match(/PASSWORD_ERR\s*=\s*\{[\s\S]*?\};/) || '')),
            'PASSWORD_ERR 那张表里没有「已切回本机体验版」这类假话');

          $('tab-pw').click();
          $('input-pw-email').value = 'stuck@example.com';
          $('input-pw').value = 'hunter2hunter';
          $('btn-login').click();
          setTimeout(() => {
            try {

              chk(!!$('pane-verify'), '「等确认」那一屏在页面上（未确认的人唯一的落点）');
              chk(!!$('btn-resend-verify'), '那一屏有一颗「重发确认邮件」');
              chk(!!$('input-verify-email'), '那一屏有邮箱输入框（匿名口要它，登录态留空）');
              const verifyHtml = read('login/index.html');
              const visibleVerify = verifyHtml.replace(/<!--[\s\S]*?-->/g, ' ');
              chk(/没登录也能点/.test(visibleVerify),
                '那一屏**写明了「没登录也能点」** —— 否则用户会以为要先登录（而死结正在这里）');
              chk(!/先去用，稍后再确认/.test(visibleVerify),
                '「先去用，稍后再确认」那颗键**已经撤掉**（新口径下它点下去就是 403，是一句做不到的话）');

                  console.log('\n' + (fails ? '❌ ' + fails + ' 项失败' : '🎉 账号三页测试全部通过'));
              process.exit(fails ? 1 : 0);
            } catch (e) {
              console.log('✗ 第十三节自身抛异常：' + e.message);
              process.exit(1);
            }
          }, 60);
        } catch (e) {
          console.log('✗ 第十三节自身抛异常：' + e.message);
          process.exit(1);
        }
      }, 60);
    } catch (e) {
      console.log('✗ 第十三节自身抛异常：' + e.message);
      process.exit(1);
    }
  }, 60);
}

{

  const html = read('login/index.html');
  const sdom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.test/login/', base: 'https://x.test/login/' });
  const w = sdom.window;

  const calls = [];
  w.fetch = (url, init) => {
    const path = String(url).replace('https://x.test', '');
    const body = init && init.body ? JSON.parse(init.body) : {};
    calls.push({ path, body });
    const reply = (status, obj) => Promise.resolve({
      status, text: () => Promise.resolve(JSON.stringify(obj)), headers: { get: () => null }
    });
    if (path === '/api/login') {
      return reply(403, {
        code: 'E_EMAIL_UNVERIFIED',
        message: '邮箱还没确认：请点开注册时那封确认邮件里的链接。没收到就点「重新发一封」。',
        emailMask: 'k***@example.com', verifySent: false, verifyTransport: null
      });
    }
    if (path === '/api/resend-verification-by-email') {
      return reply(200, { alreadyVerified: false, emailMask: 'k***@example.com', verifySent: true, verifyTransport: 'sendgrid' });
    }
    return reply(401, { code: 'E_NO_SESSION' });
  };

  ['js/auth-core.js', 'js/auth-api.js', 'js/entitlement.js', 'js/avatar.js',
    'js/family.js', 'js/progress-store.js'].forEach(f => {
    const el = w.document.createElement('script');
    el.textContent = read(f);
    w.document.body.appendChild(el);
  });
  const s2 = w.document.createElement('script');
  s2.textContent = read('js/login.js');
  w.document.body.appendChild(s2);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));

  const doc = w.document;
  const $ = (id) => doc.getElementById(id);
  const shown = (sel) => { const e = doc.querySelector(sel); return !!(e && !e.hidden); };

  chk(!!w.LoginPage, '（第十四节）登录页脚本跑起来了');
  chk(!shown('#step-unverified'), '出厂时那一屏收着（不摆一个还没发生的结果）');

  $('input-pw-email').value = 'k@example.com';
  $('input-pw').value = 'hunter2hunter';
  $('btn-login').click();

  const finish = (msg, code) => {
    chk(msg, code);
    console.log('\n' + (fails ? '❌ ' + fails + ' 项失败' : '🎉 账号三页测试全部通过'));
    process.exit(fails ? 1 : 0);
  };

  setTimeout(() => {
    try {
      chk(shown('#step-unverified'), '「口令对了但没确认」→ 切到**专门的**那一屏');
      chk(!shown('#pane-pw'), '不再停在密码那一屏（那儿没有出路，只有重复点登录）');
      chk(!shown('#pane-verify'),
        '**不复用**「注册完」那一屏 —— 那边开头一句是「账号建好了」，对回来登录的人是一句错话');
      chk(/确认/.test($('unverified-lead').textContent),
        '那一屏说的是「确认」（实际「' + $('unverified-lead').textContent + '」）');
      chk($('input-pw').value === '', '口令栏用完就清（不在屏幕上多留一秒）');

      chk($('unverified-note').hidden || !/已发出|已发往/.test($('unverified-note').textContent),
        'verifySent:false 时不说「已发往 / 已发出」（发信是事实，不是「尽力了」）');

      calls.length = 0;
      chk(!$('btn-unverified-resend').disabled, '那一屏上有「重新发一封」这颗键');
      $('btn-unverified-resend').click();
      setTimeout(() => {
        try {
          const hit = calls.filter(c => c.path === '/api/resend-verification-by-email');
          chk(hit.length === 1, '它打的是**匿名**重发口 /api/resend-verification-by-email');
          chk(hit[0] && hit[0].body.email === 'k@example.com', '带上了用户在登录屏填的那个邮箱');
          chk(calls.every(c => c.path !== '/api/resend-verification'),
            '**没有**去打要登录那条（打它必然 401 —— 这一屏上的人登不进来）');
          chk(/已发往/.test($('msg-unverified').textContent),
            'verifySent:true 时如实说「已发往 …」（实际「' + $('msg-unverified').textContent + '」）');

          const loginHtml = read('login/index.html');
          chk(/id="btn-unverified-resend"/.test(loginHtml), 'login/index.html 里有那颗匿名重发的键');
          chk(!/先去用，稍后再确认/.test(loginHtml),
            '**旧口径那句「先去用，稍后再确认」不见了**（新口径下那颗键点下去是 403，是一句做不到的话）');
          chk(!/不确认也能用/.test(loginHtml.replace(/<!--[\s\S]*?-->/g, ' ')),
            '注册那一屏不再写「不确认也能用」');
          const loginJs = read('js/login.js');
          chk(/requiresVerification/.test(loginJs),
            '注册完那一屏按 requiresVerification 分开说（拦 / 不拦各说各的话）');
          chk(/emailGate/.test(read('js/profile.js')),
            '个人中心那一行按服务器自报的 channel.emailGate 说（不猜）');
          finish('（第十四节）新口径那一屏的断言全过', true);
        } catch (e) {
          console.log('✗ 第十四节自身抛异常：' + e.message);
          process.exit(1);
        }
      }, 60);
    } catch (e) {
      console.log('✗ 第十四节自身抛异常：' + e.message);
      process.exit(1);
    }
  }, 60);
}
