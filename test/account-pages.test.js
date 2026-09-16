/**
 * 账号三页专项测试（Issue #132 · A→B→C→D 的 B / C）
 * ==========================================================================
 * 三张新页：
 *   /login/    登录（邮箱随机码 · 本地体验版）
 *   /profile/  个人中心（身份 / 权限 / 退出 / 注销）
 *   /admin/    管理后台（按邮箱掩码发放层级）
 *
 * 这一层守四件事（都是「不靠肉眼点一遍就判得出」的那类）：
 *   一、结构：三张页都在、都进了预缓存、都加载了同一套顶栏与内核
 *   二、合规：条款与界面口径一致，「不假装有服务器」有反向断言
 *   三、收口：页面不许自己拼 plan / tier，权限判断只走 Entitlement
 *   四、只读：这几页**一个字节都不写进度键**（首页浏览不该被写盘污染）
 *
 * 跑法：`node test/account-pages.test.js`（纯 Node，不联网、不装依赖）
 */
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

/** 剥注释：注释里会写历史口径，不剥掉就会对着自己的说明判红 */
const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
/** 剥 HTML 注释：**注释里可以写「这条占位不许渲染」的说明**，
    不该被当成「页面上出现了这句话」。判「用户看不看得见」一律对着剥过的版本。 */
const stripHtml = t => t.replace(/<!--[\s\S]*?-->/g, ' ');
const LOGIN = strip(loginJs), PROFILE = strip(profileJs), ADMIN = strip(adminJs);

/* ================= 一、三张页都真的在，且共用同一套壳 ================= */
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
    chk(/js\/avatar\.js/.test(s), f + ' 加载 js/avatar.js（印只有一处画）');
    chk(/<header class="topbar"/.test(s), f + ' 有顶栏挂载点');
    chk(/data-page="/.test(s), f + ' 声明页名（顶栏第一行写得出「跬步 · 登录」）');
    chk(/class="foot settings-foot"/.test(s), f + ' 有页脚（版权 + 法务链接）');
    // 三张页都是「专心做完一件事」的深页，不留底部页签免得误触跳走
    chk(/data-dock="off"/.test(s), f + ' 声明 data-dock="off"（深页不挂底部页签）');
  });

  // 脚本顺序：auth-core → entitlement → 本页逻辑 → chrome（chrome 渲染顶栏要读它们）
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
  // ⚠️ 管理页的逻辑文件叫 `js/admin-page.js`，**不叫 `js/admin.js`**：
  //    早年有一次「访问统计」被整体删除，`js/admin.js` 正是当时那个统计脚本的名字，
  //    而 `test/legal.test.js` 立了一条反向断言「这个文件必须不存在」。
  //    复用同名会让那条正确的防线变红 —— 改名比改断言好（断言守的是事实）。
  chk(SRC.admin.indexOf('<script src="/js/admin-page.js"></script>') <
      SRC.admin.indexOf('<script src="/js/chrome.js"></script>'),
    'admin 页里 js/admin-page.js 排在 js/chrome.js 之前');
  chk(!fs.existsSync(path + 'js/admin.js'),
    '管理页逻辑不叫 js/admin.js（那个名字归已删除的访问统计脚本，由法务层的反向断言守着）');
}

/* ================= 二、页名与返回落点 ================= */
{
  const names = ['login', 'profile', 'admin'].map(k => (SRC[k].match(/data-page="([^"]+)"/) || [])[1]);
  chk(names.join(',') === '登录,个人中心,管理后台', '三张页的页名各不相同且如实：' + names.join(' / '));
  chk(new Set(names).size === 3, '三张页的页名不重复（否则「返回上一页」会让人分不清层）');
  // 返回落点：个人中心回设置页（入口在设置 · 通用里），管理后台回个人中心。
  // ⚠️ 登录页的上一层是**个人中心**、不是设置页（D 步改的，理由见
  //    docs/auth-design.md §3.6.2）：进来的人主要从个人中心那颗账号入口来，
  //    而「点账号 → 看自己是谁」比「点账号 → 落回一页设置」更顺。
  chk(/data-back="\/profile\/"/.test(SRC.login),
    '登录页的上一层是个人中心（登录是身份的事，落回设置页等于多绕一层）');
  chk(/data-back="\/settings\/"/.test(SRC.profile), '个人中心的上一层是设置页');
  chk(/data-back="\/profile\/"/.test(SRC.admin), '管理后台的上一层是个人中心（不是设置页）');
  // chrome.js 认得这三条路由
  chk(/login: "\/login\/"/.test(chromeJs), 'js/chrome.js 的 ROUTES 里有 /login/');
  chk(/profile: "\/profile\/"/.test(chromeJs), 'js/chrome.js 的 ROUTES 里有 /profile/');
  chk(/admin: "\/admin\/"/.test(chromeJs), 'js/chrome.js 的 ROUTES 里有 /admin/');
  // 头像落点：/profile/ 建好之后就不该再退回设置页
  chk(/return p \|\| ROUTES\.profile;/.test(chromeJs),
    '顶栏头像的落点是 /profile/（个人中心建好之后不再退回设置页）');
}

/* ================= 三、收口：页面不许自己拼 plan / tier ================= */
{
  const files = { 'js/login.js': LOGIN, 'js/profile.js': PROFILE, 'js/admin-page.js': ADMIN };
  Object.keys(files).forEach(f => {
    const s = files[f];
    // 只允许读 tierLabel / TIERS / matrix / can / identity 这些接口
    chk(!/tier\s*===\s*["']/.test(s) && !/===\s*["'](free|pro|max)["']/.test(s),
      f + ' 没有自己写 tier === "pro" 这类判断（一律走 Entitlement）');
    chk(!/plan\s*===/.test(s), f + ' 没有自己比对 plan');
  });
  /* Issue #163：权限一节从「15 条清单 + 一句说明」收成**一行身份 + 一条链接**。
     —— 清单本身还在，但它只有一处：/plans/ 那张四列表（每格都当场算）。
     这一节守的是「两边不各说一遍」：
       ① 个人中心不再画能力清单（`matrix()` 那一份只给对比页用）
       ② 层级文案仍然只走 `Ent.tierLabel()`（本页不自己比 tier） */
  chk(!/Ent\.matrix\(/.test(PROFILE),
    '个人中心不再自己画一遍能力清单（清单只有 /plans/ 一处，见 plans-page 测试）');
  chk(!/cap-list|cap-name|cap-hint/.test(PROFILE + SRC.profile),
    '个人中心不再有清单的挂载点与样式类（整块收成一行身份）');
  chk(/Ent\.tierLabel\(/.test(PROFILE), '那一行身份仍然由 Entitlement.tierLabel() 出');
  chk(/cap-tier/.test(SRC.profile) && /cap-tier/.test(PROFILE),
    '那一行的挂载点叫 cap-tier（renderCaps() 画的就是它）');
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

/* ================= 四、不假装有服务器（本轮唯一的关键合规点） ================= */
{
  // 本期没有后端，码由本机生成 —— 界面必须如实标注，绝不许写成「邮件已发出」
  chk(/本地体验版/.test(SRC.login), '登录页如实标注「本地体验版」');
  // 精简后那句长成一行短的：只说事实（没有服务器、码由本机生成），
  // 但这一条事实**一个字都不许省** —— 它是「不假装」那条纪律的落点。
  chk(/没有服务器/.test(SRC.login), '登录页如实写明「本应用没有服务器」');
  chk(!/邮件已发送|验证码已发送|已发送到你的邮箱|已发送至/.test(SRC.login),
    '登录页不出现「已发送到你的邮箱」这类未实现的说法');
  chk(/随机码已生成|已生成随机码/.test(SRC.login + LOGIN),
    '登录页用的是「已生成随机码」——措辞与本机发码的事实一致');
  // ⚠️ 先把 `btn-resend` 这颗按钮的 id 抠掉：`resend` 是「重新发送」的按钮名，
  //    不是「用 Resend 发邮件」。拿裸词去扫必然误判（这条一开始就误判过）。
  const loginNet = LOGIN.replace(/btn-resend/g, 'btn-again');
  chk(!/fetch\(|XMLHttpRequest|sendBeacon|navigator\.sendMail|sendgrid|resend\.com|supabase|\.vercel\.app|\/api\//i.test(loginNet),
    'js/login.js 不发任何网络请求（本期没有后端，一个请求都不该有）');
  chk(/mailto:/.test(LOGIN),
    'js/login.js 唯一的外发途径是 mailto:（把码发给用户自己，不经过任何服务器）');
  // 短信只留口子、标签关闭（不许提前写「即将上线」）
  chk(/data-channel="sms"/.test(SRC.login), '登录页留了短信通道的注释占位（口子不封死）');
  chk(/<!--[\s\S]*data-channel="sms"[\s\S]*-->/.test(SRC.login),
    '短信占位是**注释**（现在不渲染，不写「即将上线」这类跑在代码前面的文案）');
  chk(!/即将上线|敬请期待/.test(stripHtml(SRC.login)),
    '登录页（用户看得见的文案里）不写「即将上线」这类未实现的承诺');
}

/* ================= 五、只读：这三页一个字节都不写进度键 ================= */
{
  // 会话 / 码 / 昵称 / 发放名单之外，不许出现任何进度或设置键名
  const forbidden = ['poem_recite_progress_v1', 'poem_recite_collections_v1',
    'poem_device_prefs_v1', 'poem_poems_read_v1', 'poem_classic_read_v1',
    'poem_recite_settings_v1'];
  const files = { 'js/login.js': LOGIN, 'js/profile.js': PROFILE, 'js/admin-page.js': ADMIN };
  Object.keys(files).forEach(f => {
    forbidden.forEach(k => {
      chk(files[f].indexOf(k) < 0, f + ' 不出现进度/设置键名 ' + k);
    });
  });
  // 个人中心的「退出」必须只清会话
  chk(/AuthCore\.signOut|A\.signOut/.test(PROFILE), '个人中心的退出走 AuthCore.signOut()（只清会话）');
  chk(/退出不删进度/.test(SRC.profile), '界面上如实写「退出不删进度」（长句精简后事实保留）');
  // 注销必须二次确认
  chk(/delete-step-1/.test(SRC.profile) && /delete-step-2/.test(SRC.profile),
    '注销账号分两步：先说明、再要求重输邮箱');
  chk(/deleteAccount\(store, /.test(PROFILE), '注销走 AuthCore.deleteAccount()（内含邮箱二次确认）');
  chk(/不动本机背诵进度/.test(SRC.profile), '注销前如实写明「不动本机背诵进度」（进度与账号是两回事）');
}

/* ================= 六、管理后台的诚实口径 ================= */
{
  chk(/改一行存储就能升级|不是收费凭据|不是安全边界/.test(SRC.admin + ADMIN),
    '管理后台如实写明本机分层的局限（改存储就能升级）');
  /* 2.1：服务端已接通，所以**反向**断言 —— 后台不再宣称「本期没有服务端」；
     但仍要如实写明「发的是本机名单，要对方自己导入」这层局限。
     ⚠️ 反向断言要剥掉注释：注释里会写「2.1 更正：不再说『没有服务端』」，
        不剥掉就是拿解释把自己判红。 */
  const adminVisible = stripHtml(SRC.admin);
  chk(!/没有服务器|本期没有服务端/.test(adminVisible),
    '管理后台不再宣称「本期没有服务端」（服务端 1 期已接通，见 2.1）');
  chk(/要对方自己导入|对方自己导入|名单导入导出/.test(SRC.admin + ADMIN),
    '管理后台如实写明「发的是本机名单，要对方自己导入」这层局限');
  chk(/deny-card/.test(SRC.admin) && /isOwner/.test(ADMIN),
    '非管理员有明确的拒绝界面（不是白页、也不是 403 跳走）');
  chk(/hide\(\$\("grant-card"\)\)|show\(\$\("grant-card"\)\)/.test(ADMIN),
    '管理后台按权限决定各块渲染（非 owner 不画发放区）');
  // 危险区要有二次确认
  chk(/wipe-step-1/.test(SRC.admin) && /wipe-step-2/.test(SRC.admin),
    '清空发放名单有二次确认');
}

/* ========== 六之二、2.2：两份名单分开写、分开渲染，一份也不许说成另一份 ========== */
{
  /* 2.2 之后 /admin/ 有**两份名单**，它们不是一回事：
       · 服务端那一份 = 权威（POST /api/admin/grant → accounts.plan）
       · 本机那一份   = 「手工发邀请码的本机版」，只在没配服务端时兜底
     这一节守三件事：
       ① 界面上两块**分开**（各有各的卡片、各有各的说明），不许混成一块
       ② 不许把本机那份说成权威，也不许把服务端那份说成「已经能收费」
       ③ 发放**走接线层**（js/account-api.js），本页不自己 fetch
  */
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
  /* ⚠️ 措辞在 PR #174 里改过：原先写「本站现在没有收款能力」（**暂缓**的语气），
     用户 2026-09-17 裁决「不搞收费」之后改成「不收款（不做支付通道）」（**不做**的语气）。
     断言守的是那件事本身（权威 ≠ 能收钱），不是某一版措辞。 */
  chk(/不收款|没有收款能力/.test(adminVisible),
    '服务端那一块也明说「本站不收款」（权威 ≠ 能收钱 —— 收费整期已取消）');

  /* 发放走接线层：**本页不许自己 fetch**（有源码扫描守着，与 /profile/ 同一条） */
  chk(!/fetch\(|XMLHttpRequest/.test(ADMIN),
    'js/admin-page.js 不自己发网络请求（走 js/account-api.js）');
  chk(/AccountApi/.test(ADMIN), '发放走 AccountApi（接线层的唯一出口）');
  chk(/adminGrant|adminRevoke|adminGrants/.test(ADMIN),
    '三条都走接线层的方法名（本页不自己拼 /api/admin/*）');
  chk(!/\/api\/admin/.test(ADMIN),
    'js/admin-page.js 里不出现 /api/admin 字面量（路径只有 js/auth-api.js 一处）');
  chk(/E_FORBIDDEN|只对管理员开放|403/.test(ADMIN + adminVisible),
    '角色闸是**服务端**的这件事写进了实现（不是只靠这一页藏入口）');

  /* 脚本顺序：auth-api + account-api 都要加载，且排在 entitlement 之后 */
  const atIn = (f, name) => SRC[f].indexOf('<script src="/js/' + name + '"></script>');
  ['auth-api.js', 'account-api.js'].forEach(n => {
    chk(atIn('admin', n) >= 0, 'admin 页加载了 js/' + n);
    chk(atIn('admin', n) > atIn('admin', 'entitlement.js'),
      'js/' + n + ' 排在 entitlement.js 之后（要先把权益层装上）');
    chk(atIn('admin', n) < atIn('admin', 'admin-page.js'),
      'js/' + n + ' 排在 admin-page.js 之前（发放要接线层先就位）');
  });

  /* 失败与「命中 0 条」各说各的话：不许合并成一句「发放失败」 */
  chk(/r\.changed/.test(ADMIN),
    'js/admin-page.js 判的是服务端回的 changed（不是自己猜有没有这个人）');
  chk(/命中 0 条/.test(ADMIN + adminVisible),
    '命中 0 条被当成**一种如实的状态**说出来（文案里写着这句话），不是错误');
  chk(/refreshMe|reason/.test(ADMIN), '失败按 reason 分情况说话（不许合并成一句「失败」）');
}

/* ================= 七、离线：三张页与三份脚本都进预缓存，版本号跟着提 ================= */
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
  // 预缓存清单里的路径必须真的存在，否则 install 时静默失败
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

/* ================= 八、验证码那六格：三件必须做对的事 ================= */
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

/* ================= 九、样式：与全站同一套，不另起一套色 ================= */
{
  /**
   * 色值：**不许出现 style.css 里没有的新颜色**。
   *
   * 判据不是「有没有写十六进制」，而是「这个值在全站调色板里存不存在」——
   * `.settings-input:focus` 的纸底、危险按钮的淡朱砂描边这类，本来就是
   * **逐位相同**地写在 css/style.css 里的，账号页的输入框与按钮必须长一样的样，
   * 改不得。真正要拦的是「账号页自己造了一个新颜色」。
   */
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

/* ================= 十、条款与界面口径一致 ================= */
{
  /* 隐私条款此前已按裁决一改写；这一轮新增了三张页，条款必须仍然自洽。
     ⚠️ 1A 期（服务端 + 云端同步落地）之后，「不上传、不云同步」这句
        被代码推翻了 —— 于是这条断言**从正向翻成反向**（与 test/legal.test.js
        同步改），守的仍然是同一件事：**条款不许与代码背离**。
        反向那一半（「不许写代码没做到的事」）照旧保留。 */
  chk(!/不上传、不云同步/.test(privacy),
    '隐私条款不再写「不上传、不云同步」（1A 落地后代码已经不是这样）');
  chk(/默认只存本机|默认[^。]{0,10}只[^。]{0,6}本机/.test(privacy),
    '隐私条款如实写明「默认只存本机」');
  chk(/云端同步/.test(privacy) && /关掉|关闭/.test(privacy),
    '隐私条款写明云端同步可开可关');
  chk(/注销即删除/.test(privacy), '隐私条款写明注销即删除服务器上的数据');
  chk(!/出境|跨境/.test(privacy), '隐私条款不出现「出境 / 跨境」字样');
  // 用户协议里「账号」这件事这轮之后是否还成立：本轮新增了 /login/ 与 /profile/，
  // 协议若只字不提账号，就成了「条款落后于代码」（比超前更容易被忽略）。
  chk(/账号/.test(terms), '用户协议里提到了「账号」这个概念（新增了三张账号页，协议不能只字不提）');
  chk(!/无注册、无登录|不需要注册，也没有登录/.test(terms),
    '用户协议不残留「无注册、无登录」这类已被代码推翻的说法');
}

/* ================= 十一、一页一件事：同一种动作不摆两颗按钮（Issue #163） ================= */
{
  /* 用户原话：
       「我看到设置里无数啰啰嗦嗦的段落及解释，无法容忍。我看到重复的发邮件框，
         发现重复的注册按钮，不知道怎么想的。」

     这一段把「重复」两类各钉成一条能判的断言：
       ① 登录页只有**一个**邮箱输入框 —— 原先下面还挂着一整张「重设凭证」卡，
          里面是同一个邮箱字段的第二种写法（label 不同、按钮不同、说明又一遍），
          一页里两个「输邮箱 → 收码」的表单；
       ② 个人中心只有**一颗**去 /login/ 的按钮 —— 原先身份卡那颗账号入口
          与下面引导卡那颗「用邮箱建一个账号」是同一个去处。

     ⚠️ 判的是「这类输入框 / 这个去处出现了几次」，不是「某个 id 在不在」：
        id 改名换姓之后这两条仍然成立。 */
  const loginInputs = [...SRC.login.matchAll(/<input[^>]*type="email"[^>]*>/g)].length;
  chk(loginInputs === 1, '登录页只有一个邮箱输入框（实际 ' + loginInputs + ' 个）');
  chk(!/input-reset-email|btn-reset-send|btn-reset-verify/.test(SRC.login),
    '登录页不再挂第二张「重设凭证」卡（同一个动作一个表单）');
  // 内核那一半照旧在：能力没删，删的只是页面入口
  chk(/resetCredential\s*:/.test(read('js/auth-core.js')),
    'AuthCore.resetCredential 仍在（删的是页面入口，不是能力）');
  chk(!/onResetSend|onResetVerify/.test(LOGIN), 'js/login.js 不再接重设凭证那一块');

  // ⚠️ 数 JS 里的**裸地址字面量**（`"/login/"`），不要数 `location.href = ...`：
  //    profile.js 的注释里也写着这串地址（「落到 /login/ 也不是死路」），
  //    拿整句去数必然误判。裸字面量只出现在真的赋值那一行。
  const toLogin = [...PROFILE.replace(/^\s*\/\/.*$/gm, ' ').matchAll(/"\/login\/"/g)].length;
  chk(toLogin === 1,
    '个人中心只有一颗去 /login/ 的按钮（实际 ' + toLogin +
    ' 处 —— 身份卡那颗账号入口就是它，下面不该再摆一颗「建账号」）');
  chk(/btn-account-entry/.test(SRC.profile) && /btn-account-entry/.test(PROFILE),
    '个人中心靠身份卡那颗 #btn-account-entry 承担去 /login/ 的动线');
}

/* ================= 十二、没有一句「废话」：文案守卫（Issue #163 再次清理） ================= */
{
  /* 用户第二次提这件事时点的是具体句子：
       「不登录也能用全部功能。建账号只为让进度不随清缓存丢掉。
         输邮箱 → 收码 → 填码，没有账号就建、有就登录。」
       —— 这是登录页顶上那段**三句并排的自我介绍**：不是表单、不是说明，
          用户打开页面只想知道「填哪里」，不需要先读一段产品介绍。
       「未来两周哪天要复习几篇、具体哪几篇，以及掌握度分布」
       —— 这是设置里「进度总览」入口下的一句，把跳过去之后**会看到什么**
          又先念了一遍。

     这一段把这两类废话各钉成能判的断言。判据取的是**句式**，不是某一句话：
       ① 登录页首屏不许出现「输邮箱 → 收码 → 填码」这种把表单流程念一遍的句子；
       ② 不许出现「不登录也能用全部功能」这种把「免费」当卖点的整句；
       ③ 入口下面的说明不许把目的地**有哪些板块**一条条数出来。
     ⚠️ 事实不许跟着删：「本地体验版 / 没有服务器」「进度只存在本机」这类
        **用户必须知道的事实**在这两条断言之外，另有各自的守卫（见第四、九节）。 */
  const loginVisible = SRC.login.replace(/<!--[\s\S]*?-->/g, "");
  chk(!/输邮箱/.test(loginVisible) && !/收码/.test(loginVisible),
    '登录页不再把「输邮箱 → 收码 → 填码」这套流程念一遍（表单自己会说话）');
  chk(!/不登录也能用/.test(loginVisible),
    '登录页不再写「不登录也能用全部功能」这类卖点式整句');
  chk(!/没有账号就建、有就登录/.test(loginVisible),
    '登录页不再解释「注册与登录是同一个动作」（该说的在按钮上）');

  /* ③ 入口说明不数板块：三条以上并列的「、」+「以及」是最典型的句式。
     先只看被自动测试盯着的两页（设置 · 背诵的「进度总览」那一行、复习算法卡）。 */
  const recite = read('settings/recite/index.html').replace(/<!--[\s\S]*?-->/g, "");
  chk(!/未来两周哪[天些]/.test(recite) && !/具体哪几篇/.test(recite),
    '「进度总览」入口下不再先念一遍目的地有什么（跳过去就看得到）');
  chk(!/哪天要复习几篇/.test(recite), '不再出现「哪天要复习几篇」这类把图表说成一句话的说明');

  /* 复习算法那一栏：说明只留「当前是哪个 + 换算法不清进度」与一行间隔口径。
     ⚠️ 判的是**长度**，不是措辞 —— 措辞会变，而「一张卡的说明长得像一段散文」
        正是用户第二次点名的那件事。 */
  const RM = require('fs').readFileSync(__dirname + '/../js/review-models.js', 'utf8');
  const blurbs = [...RM.matchAll(/blurb: "([^"]+)"/g)].map(m => m[1]);
  chk(blurbs.length >= 4, '四张复习算法各有一句说明（实际 ' + blurbs.length + ' 句）');
  blurbs.forEach(b => {
    chk(b.length <= 40, '算法说明控制在一句以内（' + b.length + ' 字：「' + b + '」）');
    chk(!/。.*。/.test(b), '算法说明不再一句接一句（「' + b + '」）');
  });

  /* 法务两页：这轮又砍了一截 —— 用**字数上限**兜住，免得有一天又长回去。
     （上限取的是本次实测值再加一点余量，不是「刚好卡住现在」。） */
  const legalLen = (f) => read(f).replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, "").replace(/\s+/g, "").length;
  chk(legalLen('terms/index.html') < 1000,
    '用户协议正文 < 1000 字（实际 ' + legalLen('terms/index.html') + '）');
  chk(legalLen('privacy/index.html') < 1400,
    '隐私条款正文 < 1400 字（实际 ' + legalLen('privacy/index.html') + '）');
}

console.log('\n' + (fails ? '❌ ' + fails + ' 项失败' : '🎉 账号三页测试全部通过'));
process.exit(fails ? 1 : 0);
