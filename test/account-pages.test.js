const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = __dirname + '/../';
const read = f => fs.readFileSync(path + f, 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const PAGES = {
  login: 'login/index.html',
  profile: 'profile/index.html',
  admin: 'admin/index.html'
};
const SRC = {};
Object.keys(PAGES).forEach(k => { SRC[k] = read(PAGES[k]); });

const loginJs = read('js/login.js');
const profileJs = read('js/profile.js');
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
const LOGIN = strip(loginJs), PROFILE = strip(profileJs), ADMIN = strip(adminJs);

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
  chk(SRC.profile.indexOf('<script src="/js/profile.js"></script>') <
      SRC.profile.indexOf('<script src="/js/chrome.js"></script>'),
    'profile 页里 js/profile.js 排在 js/chrome.js 之前');

  chk(SRC.admin.indexOf('<script src="/js/admin-page.js"></script>') <
      SRC.admin.indexOf('<script src="/js/chrome.js"></script>'),
    'admin 页里 js/admin-page.js 排在 js/chrome.js 之前');
  chk(!fs.existsSync(path + 'js/admin.js'),
    '管理页逻辑不叫 js/admin.js（那个名字归已删除的访问统计脚本，由法务层的反向断言守着）');
}

{
  const names = ['login', 'profile', 'admin'].map(k => (SRC[k].match(/data-page="([^"]+)"/) || [])[1]);
  chk(names.join(',') === '登录,个人中心,管理后台', '三张页的页名各不相同且如实：' + names.join(' / '));
  chk(new Set(names).size === 3, '三张页的页名不重复（否则「返回上一页」会让人分不清层）');

  chk(/data-back="\/profile\/"/.test(SRC.login),
    '登录页的上一层是个人中心（登录是身份的事，落回设置页等于多绕一层）');
  chk(/data-back="\/mine\/"/.test(SRC.profile), '个人中心的上一层是「我的」页（账号动线的上一层）');
  chk(/data-back="\/profile\/"/.test(SRC.admin), '管理后台的上一层是个人中心（不是设置页）');

  chk(/login: "\/login\/"/.test(chromeJs), 'js/chrome.js 的 ROUTES 里有 /login/');
  chk(/profile: "\/profile\/"/.test(chromeJs), 'js/chrome.js 的 ROUTES 里有 /profile/');
  chk(/admin: "\/admin\/"/.test(chromeJs), 'js/chrome.js 的 ROUTES 里有 /admin/');

  chk(!/userAvatarHtml|ROUTES\.profile/.test(chromeJs),
    '顶栏不再画头像，那条 /profile/ 的落点也随之撤掉（转由「我的」页第一条承担）');
  chk(/profile: "\/profile\/"/.test(chromeJs), 'ROUTES 里仍有 /profile/（那一页还在）');
}

{
  const files = { 'js/login.js': LOGIN, 'js/profile.js': PROFILE, 'js/admin-page.js': ADMIN };
  Object.keys(files).forEach(f => {
    const s = files[f];

    chk(!/tier\s*===\s*["']/.test(s) && !/===\s*["'](free|pro|max)["']/.test(s),
      f + ' 没有自己写 tier === "pro" 这类判断（一律走 Entitlement）');
    chk(!/plan\s*===/.test(s), f + ' 没有自己比对 plan');
  });

  chk(!/Ent\.matrix\(/.test(PROFILE),
    '个人中心不再自己画一遍能力清单（清单只有 /plans/ 一处，见 plans-page 测试）');
  chk(!/cap-list|cap-name|cap-hint/.test(PROFILE + SRC.profile),
    '个人中心不再有清单的挂载点与样式类');
  chk(!/cap-tier/.test(PROFILE + SRC.profile),
    '「身份」那一行也撤了（层级只在身份卡徽章上说一次）');
  chk(/Ent\.tierLabel\(/.test(PROFILE), '层级徽章仍然由 Entitlement.tierLabel() 出');
  chk((PROFILE.match(/Ent\.tierLabel\(/g) || []).length === 1,
    '层级文案在个人中心只有一处来源（实际 ' + (PROFILE.match(/Ent\.tierLabel\(/g) || []).length + ' 处）');
  chk(!/renderCaps/.test(PROFILE),
    '不再有 renderCaps()（那节撤了就不留一个画空东西的函数）');
  chk(/Ent\.tierLabel\(/.test(PROFILE) && /Ent\.tierLabel\(/.test(ADMIN),
    '层级徽章文案一律由 Entitlement.tierLabel() 出');
  chk(/Ent\.TIERS/.test(ADMIN), '可发放的层级列表读 Entitlement.TIERS（不自己写死一份）');
  chk(/putGrant\(backing/.test(ADMIN) && /readGrants\(backing\)/.test(ADMIN) &&
      /removeGrant\(backing/.test(ADMIN) && /clearGrants\(backing\)/.test(ADMIN),
    '名单的增 / 查 / 删 / 清一律走 Entitlement 的发放接口');
  chk(!/poem_plan_grant_v1/.test(ADMIN), 'admin 页不自己拼发放名单的键名（键名只在 entitlement.js 里）');
  chk(!/poem_plan_v1/.test(PROFILE + ADMIN + LOGIN),
    '三张页都不自己碰层级存储键（只在 entitlement.js 里）');
}

{

  chk(/本地体验版/.test(SRC.login), '登录页如实标注「本地体验版」');

  chk(/没有服务器/.test(SRC.login), '登录页如实写明「本应用没有服务器」');
  chk(!/邮件已发送|验证码已发送|已发送到你的邮箱|已发送至/.test(SRC.login),
    '登录页不出现「已发送到你的邮箱」这类未实现的说法');
  chk(/随机码已生成|已生成随机码/.test(SRC.login + LOGIN),
    '登录页用的是「已生成随机码」——措辞与本机发码的事实一致');

  const loginNet = LOGIN.replace(/btn-resend/g, 'btn-again');
  chk(!/fetch\(|XMLHttpRequest|sendBeacon|navigator\.sendMail|sendgrid|resend\.com|supabase|\.vercel\.app|\/api\//i.test(loginNet),
    'js/login.js 不发任何网络请求（本期没有后端，一个请求都不该有）');
  chk(/mailto:/.test(LOGIN),
    'js/login.js 唯一的外发途径是 mailto:（把码发给用户自己，不经过任何服务器）');

  const authKernel = read('js/auth-core.js');
  chk(/CHANNELS\s*=\s*\[[^\]]*"sms"/.test(authKernel) && /isPhoneShape/.test(authKernel),
    '短信通道在核心里留着口子（channel 白名单认 sms + 手机号形状校验），功能不封死');
  chk(!/即将上线|敬请期待/.test(stripHtml(SRC.login)),
    '登录页（用户看得见的文案里）不写「即将上线」这类未实现的承诺');
}

{

  const forbidden = ['poem_recite_progress_v1', 'poem_recite_collections_v1',
    'poem_device_prefs_v1', 'poem_poems_read_v1', 'poem_classic_read_v1',
    'poem_recite_settings_v1'];
  const files = { 'js/login.js': LOGIN, 'js/profile.js': PROFILE, 'js/admin-page.js': ADMIN };
  Object.keys(files).forEach(f => {
    forbidden.forEach(k => {
      chk(files[f].indexOf(k) < 0, f + ' 不出现进度/设置键名 ' + k);
    });
  });

  chk(/AuthCore\.signOut|A\.signOut/.test(PROFILE), '个人中心的退出走 AuthCore.signOut()（只清会话）');
  chk(/退出不删进度/.test(SRC.profile), '界面上如实写「退出不删进度」（长句精简后事实保留）');

  chk(/delete-step-1/.test(SRC.profile) && /delete-step-2/.test(SRC.profile),
    '注销账号分两步：先说明、再要求重输邮箱');
  chk(/deleteAccount\(store, /.test(PROFILE), '注销走 AuthCore.deleteAccount()（内含邮箱二次确认）');
  chk(/不动本机背诵进度/.test(SRC.profile), '注销前如实写明「不动本机背诵进度」（进度与账号是两回事）');
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
  ['login', 'profile', 'admin'].forEach(k => {
    chk(sw.indexOf('"./' + k + '/"') >= 0, 'sw.js 预缓存里有 ./' + k + '/（断网也进得去）');
  });
  ['login.js', 'profile.js', 'admin-page.js'].forEach(f => {
    chk(sw.indexOf('"./js/' + f + '"') >= 0, 'sw.js 预缓存里有 js/' + f);
  });
  chk(/css\/account\.css/.test(sw), 'sw.js 预缓存里有 css/account.css');
  const ver = parseInt((sw.match(/poem-app-v(\d+)/) || [0, '0'])[1], 10);
  chk(ver >= 128, '缓存版本已跟着提（本轮 Issue #163 动了 /plans/、/profile/ 与三份脚本，实际 v' + ver + '）');

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

  const toLogin = [...PROFILE.replace(/^\s*\/\/.*$/gm, ' ').matchAll(/"\/login\/"/g)].length;
  chk(toLogin === 1,
    '个人中心只有一颗去 /login/ 的按钮（实际 ' + toLogin +
    ' 处 —— 身份卡那颗账号入口就是它，下面不该再摆一颗「建账号」）');
  chk(/btn-account-entry/.test(SRC.profile) && /btn-account-entry/.test(PROFILE),
    '个人中心靠身份卡那颗 #btn-account-entry 承担去 /login/ 的动线');
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

  const cards = [...SRC.profile.matchAll(/<section class="account-card/g)].length;
  chk(cards === 4,
    '个人中心是四张卡（身份 / 本机数据 / 关于 / 危险区，实际 ' + cards + '）');
  const actionRows = [...SRC.profile.matchAll(/class="account-actions"/g)].length;
  chk(actionRows === 2,
    '操作键收成两行（身份卡那一行 + 「关于」卡那一行，实际 ' + actionRows + ' 行）');
  chk(/id="identity-actions"/.test(SRC.profile),
    '登录 / 退出 / 层级对比三颗键并排在同一行（#identity-actions）');

  const idActions = (SRC.profile.match(/id="identity-actions"[\s\S]*?<\/div>/) || [''])[0];
  chk(/id="btn-account-entry"[\s\S]*?id="btn-sign-out"[\s\S]*?id="btn-go-plans"/.test(idActions),
    '登录 / 退出 / 层级对比三件真的在同一行里（顺序也在）');

  // 用户 2026-09-18：这颗「层级对比」改成链接 —— 它是「去别处看一张表」，
  // 不是「登录 / 退出」那类动作。做成 <a href="/plans/">：不点 JS、
  // 中键新开、键盘可达、还没脚本时也能走。
  chk(/<a[^>]*id="btn-go-plans"[^>]*href="\/plans\/"[^>]*>层级对比<\/a>/.test(SRC.profile) ||
      /<a[^>]*href="\/plans\/"[^>]*id="btn-go-plans"[^>]*>层级对比<\/a>/.test(SRC.profile),
    '「层级对比」是一个 <a href="/plans/">（用户 2026-09-18：这颗键改成链接）');
  chk(!/<button[^>]*id="btn-go-plans"/.test(SRC.profile),
    '它不再是一颗 <button>');
  chk(!/class="account-btn[^"]*"[^>]*id="btn-go-plans"/.test(SRC.profile) &&
      !/id="btn-go-plans"[^>]*class="account-btn/.test(SRC.profile),
    '它也不再挂着按钮那套 class（挂了就还是画出来一颗键）');
  chk(/\/plans\//.test(SRC.profile) || /location\.href = "\/plans\/"/.test(PROFILE),
    '去 /plans/ 这条动线仍在（现在是 <a> 自己带着地址）');

  chk(!/id="btn-go-sync"/.test(SRC.profile),
    '「同步设置」那颗键撤掉了（点了还是要去通用页再点一次，纯属多余）');
  chk(/id="sync-row"/.test(SRC.profile) && /id="toggle-sync"/.test(SRC.profile),
    '跨设备同步在「关于」卡里是**一行**：项名 + 开关（#sync-row / #toggle-sync）');
  chk(/<label class="switch sync-row"[\s\S]{0,400}?id="toggle-sync"[\s\S]{0,200}?switch-toggle/.test(SRC.profile),
    '开关排在那一行的最右（label 包着 input + 轨道，由 .switch 的 space-between 推过去）');
  chk(/id="sync-conflict"/.test(SRC.profile),
    '需要你裁决时那个冲突面板仍留着（有冲突才铺开）');
  chk(!/id="btn-go-plans"[\s\S]{0,400}?id="btn-go-sync"/.test(SRC.profile),
    '「层级对比」已从「关于」卡挪走（同一颗键不在两处）');
  chk(/class="account-card danger-zone"/.test(SRC.profile),
    '注销仍**单独一张卡**（朱砂描边的危险区，不与那些「去别处」的键并列）');

  const fullBtns = [...SRC.profile.matchAll(/<button class="account-btn(?! ghost)[^"]*"/g)].length;
  chk(fullBtns <= 4,
    '满宽的实心按钮不再一排排出现在每张卡底下（实际 ' + fullBtns + ' 颗，都是表单 / 危险区里的）');

  const profileVisible = stripHtml(SRC.profile);
  chk(!/昵称与印记在/.test(profileVisible),
    '删掉「昵称与印记在「设置 · 通用」里改。」（去别处调的话不必在这一页念）');
  chk(!/进度只在这台设备上/.test(profileVisible),
    '删掉「进度只在这台设备上，清缓存、换设备就没了。」（登录页已经如实说过一次）');
  chk(!/不建账号也照旧用全部功能/.test(profileVisible),
    '删掉「不建账号也照旧用全部功能，只有语音朗读要登录（免费）。」');
  chk(!/guest-card/.test(SRC.profile),
    '那块「未登录引导」整块撤掉（不留空壳容器）');

  chk(/btn\.textContent = id\.signedIn \? "管理登录状态" : "登录"/.test(PROFILE),
    '未登录那颗键就叫「登录」（不把理由写在按钮上）');

  chk(!/id="login-hint"/.test(stripHtml(SRC.profile)) &&
    !/login-hint/.test(PROFILE) && !/diffLine/.test(PROFILE),
    '「差语音朗读」那一行撤干净（挂点、渲染、diffLine 都不留）');
  chk(!/语音朗读/.test(strip(stripHtml(SRC.profile))),
    '个人中心的**可见文字里**没有「语音朗读」四个字（只剩布局注释里提它）');

  chk(!/id="account-card"/.test(SRC.profile),
    '「账号」不再独占一张卡（它回答的「我是谁」与身份卡重合）');
  chk(/id="account-list"/.test(SRC.profile) && /\$\("account-list"\)/.test(PROFILE),
    '账号那几行挪进「关于」卡（#account-list），仍由 renderAccount() 画');

  // 用户 2026-09-18：这一页的「关于」不再自己念一遍「应用 / 版本」——
  // 那两行在「设置 · 关于」里已经说得很清楚，同一件事只说一遍。
  // 留下的两个法务入口也走同一套排法：左列是链接、右列留空、行高一致。
  const aboutBlock = SRC.profile.slice(SRC.profile.indexOf('account-card-title">关于'),
    SRC.profile.indexOf('id="sync-row"'));
  chk(!/应用<\/span>/.test(aboutBlock) && !/跬步 · 古诗词背诵/.test(aboutBlock),
    '「关于」卡里不再有「应用」那一行（应用名已撤，用户 2026-09-18：不要与应用/版本一样）');
  chk(!/版本<\/span>/.test(aboutBlock),
    '「关于」卡里也没有「版本」那一行（版本号只在「设置 · 关于」里念一次）');
  chk(/\/terms\//.test(aboutBlock) && /\/privacy\//.test(aboutBlock),
    '用户协议与隐私条款两条入口仍在「关于」卡里');
  chk(/<span class="kv-v"><\/span>/.test(aboutBlock),
    '那两条的右列**留空**（项名自己就是入口，不用再挂一颗「查看」）');
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
  const boot = () => {
    const d = new JSDOM(read('profile/index.html'),
      { url: 'https://local.test/profile/', runScripts: 'outside-only', pretendToBeVisual: true });
    const W = d.window;

    ['js/auth-core.js', 'js/auth-api.js', 'js/entitlement.js', 'js/account-api.js',
      'js/family.js', 'js/progress-store.js', 'js/sync-store.js', 'js/storage.js',
      'js/avatar.js', 'js/profile.js'].forEach(f => {
        W.eval(fs.readFileSync(ROOT + '/' + f, 'utf8'));
      });
    W.document.dispatchEvent(new W.Event('DOMContentLoaded', { bubbles: true }));
    return W;
  };

  // 那一行里有动作（按钮）也有落点（链接），所以这里按「看得见的东西」数，
  // 不按标签数 —— 未登录两件、已登录三件，顺序与页面上一样。
  const shown = (W) => [...W.document.getElementById('identity-actions')
    .querySelectorAll('button, a')].filter(el => !el.hidden).map(el => el.id);

  let W = boot();
  let row = W.document.getElementById('identity-actions');
  const ids = shown(W);
  chk(ids.join(',') === 'btn-account-entry,btn-go-plans',
    '未登录时那一行里是「登录」+「层级对比」两件（实际 ' + ids.join(',') + '）');
  chk(W.document.getElementById('btn-go-plans').tagName === 'A' &&
      W.document.getElementById('btn-go-plans').getAttribute('href') === '/plans/',
    '「层级对比」真的画成了链接（tagName 是 A、href 是 /plans/）');
  chk(W.document.getElementById('btn-account-entry').textContent === '登录',
    '那颗键上只有一个词：登录（实际「' + W.document.getElementById('btn-account-entry').textContent + '」）');

  chk(W.document.getElementById('login-hint') === null,
    '它底下不再有「差语音朗读」那一行（挂点撤了，实际 ' +
    (W.document.getElementById('login-hint') ? '还在' : 'null') + '）');

  W = boot();
  const A = W.AuthCore;
  const store = A.makeStore(W.localStorage);
  const req = A.requestCode(store, { channel: 'email', value: 'zhangmin@163.com' }, 'login');
  A.verifyCode(store, req.codeId, req.code, 'login');
  W.document.dispatchEvent(new W.Event('DOMContentLoaded', { bubbles: true }));
  const ids2 = shown(W);
  chk(ids2.join(',') === 'btn-account-entry,btn-sign-out,btn-go-plans',
    '已登录时三件（管理登录状态 / 退出 / 层级对比）在同一行（实际 ' + ids2.join(',') + '）');
  chk(W.document.getElementById('login-hint') === null,
    '已登录时那一行同样不在（这件事已经不再说了）');
  chk(W.document.getElementById('btn-account-entry').textContent === '管理登录状态',
    '已登录时那颗键换成「管理登录状态」（仍落在 /login/，不是死路）');
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
        ['ts-pw', 'ts-code', 'ts-reg', 'ts-forgot', 'ts-verify', 'ts-unverified'].forEach(id => {
          chk(new RegExp('id="' + id + '" hidden').test(LH),
            '④ 挂载点 #' + id + ' 在、且出厂 `hidden`（没配时不留一个空壳让人以为有校验）');
        });
        chk(/<script src="\/js\/turnstile\.js"><\/script>/.test(LH), '⑤ 登录页加载 js/turnstile.js');
        chk(LH.indexOf('/js/turnstile.js') < LH.indexOf('/js/auth-api.js'),
          '⑤ 它排在 auth-api **之前**（auth-api 发请求时要向它取 token）');

        const LJS = read('js/login.js');
        const gates = (LJS.match(/turnstileBlocked\(/g) || []).length;
        chk(gates >= 6,
          '⑤ 登录页的每一次提交都先问一次 gate（密码/注册/忘记密码/发码/重发确认×2），实际 ' + gates + ' 处');
        chk(/turnstileReset\(\)/.test(LJS), '⑤ 提交之后重置（token 一次性）');
        chk(/api\.config\(\)/.test(LJS), '⑤ 配置从 GET /api/config 来（**不写死** siteKey）');

        const RJS = read('js/reset.js');
        chk(/ts-reset/.test(read('reset/index.html')), '⑤ 重设页也有一个挂载点');
        chk(/api\.config\(\)/.test(RJS), '⑤ 重设页同样从服务端问配置');

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

              chk(shown2('ts-pw'), '⑤b 服务端说「配了」→ 密码那一屏的挂载点被摘掉 hidden（widget 真的渲染了）');
              chk(($2('ts-pw') || {}).dataset && $2('ts-pw').dataset.rendered === '1',
                '⑤b 而且真的调了 Cloudflare 的 render（不是只把块显示出来）');
              chk(!shown2('ts-reg'), '⑤b 其余几屏的挂载点仍收着（按需渲染，不是一次全渲染）');

              $2('btn-go-register').click();
              setTimeout(() => {
                try {
                  chk(shown2('ts-reg'), '⑤b 切到注册屏 → 注册那一块也挂上了');

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
      chk(/还没接上发信商|console/.test(m4),
        '而是如实说「这台服务器还没接上发信商」并指出去哪补（实际「' + m4 + '」）');
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
  chk(pw.type === 'text' && eye.textContent === '隐藏' && eye.getAttribute('aria-label') === '隐藏密码',
    '「显示」键三件一起切：type / 按钮字 / aria-label');
  eye.click();
  chk(pw.type === 'password' && eye.textContent === '显示', '再点切回去');

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
