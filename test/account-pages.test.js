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
  chk(/Ent\.matrix\(/.test(PROFILE), '权限清单一律由 Entitlement.matrix() 生成');
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
  chk(/不会删掉任何背诵进度/.test(SRC.profile), '界面上如实写「退出不会删掉任何背诵进度」');
  // 注销必须二次确认
  chk(/delete-step-1/.test(SRC.profile) && /delete-step-2/.test(SRC.profile),
    '注销账号分两步：先说明、再要求重输邮箱');
  chk(/deleteAccount\(store, /.test(PROFILE), '注销走 AuthCore.deleteAccount()（内含邮箱二次确认）');
  chk(/不删背诵进度/.test(SRC.profile), '注销前如实写明「不删背诵进度」（进度与账号是两回事）');
}

/* ================= 六、管理后台的诚实口径 ================= */
{
  chk(/改一行存储就能升级|不是收费凭据|不是安全边界/.test(SRC.admin + ADMIN),
    '管理后台如实写明本机分层的局限（改存储就能升级）');
  chk(/没有服务器|本期没有服务端/.test(SRC.admin + ADMIN),
    '管理后台如实写明「本期没有服务端，发给别人要对方自己导入」');
  chk(/deny-card/.test(SRC.admin) && /isOwner/.test(ADMIN),
    '非管理员有明确的拒绝界面（不是白页、也不是 403 跳走）');
  chk(/hide\(\$\("grant-card"\)\)|show\(\$\("grant-card"\)\)/.test(ADMIN),
    '管理后台按权限决定各块渲染（非 owner 不画发放区）');
  // 危险区要有二次确认
  chk(/wipe-step-1/.test(SRC.admin) && /wipe-step-2/.test(SRC.admin),
    '清空发放名单有二次确认');
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
  chk(ver >= 117, '缓存版本已跟着提（本轮新增 3 页 + 1 表 + 4 脚本，实际 v' + ver + '）');
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
  // 隐私条款此前已按裁决一改写；这一轮新增了三张页，条款必须仍然自洽
  chk(/不上传、不云同步/.test(privacy), '隐私条款仍写着「不上传、不云同步」（本轮没有推翻它）');
  chk(/只存在本机|只保存在你的设备上/.test(privacy), '隐私条款如实写明数据只存在本机');
  chk(!/已接入服务器|云端同步已上线/.test(privacy), '隐私条款不出现「已接入服务器」这类未实现的说法');
  // 用户协议里「账号」这件事这轮之后是否还成立：本轮新增了 /login/ 与 /profile/，
  // 协议若只字不提账号，就成了「条款落后于代码」（比超前更容易被忽略）。
  chk(/账号/.test(terms), '用户协议里提到了「账号」这个概念（新增了三张账号页，协议不能只字不提）');
  chk(!/无注册、无登录|不需要注册，也没有登录/.test(terms),
    '用户协议不残留「无注册、无登录」这类已被代码推翻的说法');
}

console.log('\n' + (fails ? '❌ ' + fails + ' 项失败' : '🎉 账号三页测试全部通过'));
process.exit(fails ? 1 : 0);
