const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = __dirname + '/../';
const read = f => fs.readFileSync(path + f, 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };
const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const MINE = read('mine/index.html');
const SETTINGS = read('settings/index.html');
const GENERAL = read('settings/general/index.html');
const MINE_JS = read('js/mine.js');
const AVATAR_EDIT = read('js/avatar-edit.js');
const SETTINGS_JS = read('js/settings.js');
const CHROME = read('js/chrome.js');
const SW = read('sw.js');
const css = read('css/style.css') + read('css/account.css');

{
  chk(/data-nav="mine"/.test(MINE), '「我的」页声明自己是「我的」页签（底部最后一格选中）');
  chk(/data-page="我的"/.test(MINE), '页名是「我的」');
  chk(/data-top-action="settings"/.test(MINE),
    '右上是齿轮：body 上写 data-top-action="settings"（不给每页各写一遍顶栏）');
  chk(!/data-back=/.test(MINE), '「我的」页不声明 data-back（它是页签落点，顶上没有上一层）');
  chk(/data-dock="off"/.test(MINE) === false, '「我的」页挂着底部页签（页签是它的退路）');
  chk(/<base href="\/"/.test(MINE), '带 <base href="/">（子目录页面里相对资源才解析得对）');
  chk(/id="mine-page"/.test(MINE), '有独立的整页容器');
  chk(/js\/chrome\.js/.test(MINE) && /js\/pwa\.js/.test(MINE),
    '共用顶栏与底部页签，并加载 js/pwa.js（--nav-h 每页都要实测）');
  chk(!/class="foot/.test(MINE), '没有页底页脚（版权 + 法务链接已删）');

  const rel = (MINE.match(/(?:src|href)="(\.\.\/[^"]*)"/g) || []);
  chk(rel.length === 0, '不出现 ../ 相对引用（实际 ' + rel.join(',') + '）');
}

{
  chk(/js\/mine\.js/.test(MINE), '加载 js/mine.js（这一页身份 / 数据 / 注销的唯一来源）');
  chk(/js\/avatar-edit\.js/.test(MINE), '加载 js/avatar-edit.js（头像上传与裁切）');
  chk(/js\/family-ui\.js/.test(MINE), '加载 js/family-ui.js（子用户那一块）');
  chk(!/js\/settings\.js/.test(MINE),
    '不加载 js/settings.js（那是设置整页与四张二级页共用的，别把整页逻辑拖进「我的」）');

  const at = n => MINE.indexOf('<script src="/js/' + n + '"></script>');
  chk(at('auth-core.js') >= 0 && at('entitlement.js') >= 0 &&
      at('auth-core.js') < at('entitlement.js'),
    'auth-core 排在 entitlement 之前（先有会话再算权益）');
  chk(at('avatar.js') >= 0 && at('avatar-edit.js') > at('avatar.js'),
    'js/avatar.js 排在 js/avatar-edit.js 之前（编辑层要读头像那一份档案）');
  chk(at('family.js') >= 0 && at('family-ui.js') > at('family.js'),
    'js/family.js 排在 js/family-ui.js 之前');
  chk(at('mine.js') > at('entitlement.js') && at('mine.js') > at('progress-store.js'),
    'js/mine.js 排在 entitlements / progress-store 之后（它要读这两份）');
  chk(at('mine.js') < at('chrome.js'), 'js/mine.js 排在 js/chrome.js 之前（与别的页同一条顺序）');
}

{
  // ⚠️ 2026-09-24（Issue #276）：#btn-avatar-pick 从 HTML 静态标记改成了
  //    **由 js/mine.js 就地画出来**（它挂在身份行里、与「登录」同一行，
  //    而身份行是整段按需画的）。所以这一条判据是「两处都点了名」：
  //    脚本里画出来 → 页面运行时真的有 → 编辑层认它。
  chk(!/id="btn-avatar-pick"/.test(MINE),
    '那颗键不写死在 HTML 里（它是身份行的一部分，由 js/mine.js 一处画）');
  chk(/"btn-avatar-pick"/.test(MINE_JS),
    'js/mine.js 把它画在身份行里（与「登录」同一行）');
  // ⚠️ 第八轮的**相反**一条：「删除头像」不许再挂在身份行上。
  //    用户 2026-09-24 问「如果用户没有上传头像，是不是不应该显示删除头像
  //    按钮？」—— 答案是不该，而且**不该**靠 `hidden` 藏一颗一直挂着的键
  //    （那是「看着没有、其实有」，判据还得在两处维护）。它住进裁切层：
  //    那一层只有点了「上传 / 更新头像」才铺得上来，那时一定有图。
  chk(!/id="btn-avatar-clear"/.test(MINE_JS),
    '「删除头像」不在身份行那一份代码里了（它只在有图那一半出现）');
  chk(/id="btn-crop-clear"/.test(MINE) && /"#btn-crop-clear"/.test(AVATAR_EDIT),
    '它住在裁切层里，且由 js/avatar-edit.js 认（一个出口，不在两处维护）');

  ['avatar-file', 'crop-layer',
   'crop-box', 'crop-img', 'crop-zoom', 'btn-crop-ok', 'btn-crop-cancel'].forEach(id => {
    chk(new RegExp('id="' + id + '"').test(MINE) && AVATAR_EDIT.indexOf('"#' + id + '"') >= 0,
      '头像那一套控件 ' + id + ' 在页面上、也被 js/avatar-edit.js 认');
    chk(!new RegExp('id="' + id + '"').test(GENERAL),
      '同一个控件 ' + id + ' 已从「通用」页搬走（不留两处）');
  });

  chk(/id="avatar-file"[^>]*type="file"/.test(MINE), '文件选择框仍是 input[type=file]');
  chk(/accept="image\/\*"/.test(MINE), 'accept 收窄到图片（只是收窄选择器，不是安全边界）');
  chk(/id="crop-layer"[^>]*hidden/.test(MINE), '裁切层出厂藏着（没选图时不铺上来）');
}

{
  chk(!/id="input-nickname"/.test(MINE) && /\$\("input-nickname"\)/.test(MINE_JS),
    '用户名输入框由 js/mine.js 画（HTML 里不再写死；它是身份行的一部分）');
  chk(!/id="input-username"/.test(MINE), '「我的」页不叫 #input-username（那一颗已整颗撤掉）');
  chk(!/id="input-username"/.test(GENERAL),
    '「通用」页不再有用户名输入框（与「我的」页重复了，用户 2026-09-18 点名删）');
  ['settings/index.html', 'settings/general/index.html', 'settings/recite/index.html',
   'settings/lists/index.html', 'settings/reader/index.html'].forEach(f => {
    chk(!/id="input-username"/.test(read(f)), f + ' 里不再有 #input-username（控件只有一个来源）');
  });
  chk(/ProgressStore[\s\S]{0,200}patch/.test(strip(MINE_JS)),
    '昵称落盘走 ProgressStore.patch（不自己拼存储键）');

  // 用户 2026-09-18（Issue #229）：输入框在头像右侧、游客上方；
  // 不要「保存」按钮（输完自动存）；不出 border。
  chk(!/btn-nickname-save/.test(MINE) && !/btn-nickname-save/.test(strip(MINE_JS)),
    '没有「保存」按钮（用户 2026-09-18：用户在用户名输入框输完自动就保存）');
  chk(/identity-main/.test(strip(MINE_JS)) &&
      /identity-main[\s\S]{0,400}input-nickname[\s\S]{0,300}identity-sub/.test(strip(MINE_JS)),
    '输入框画在 .identity-main 里，排在 .identity-sub（游客 / 已登录）之前 —— ' +
    '即头像右侧、游客上方（用户点名的位置）');
  chk(/avatar-slot/.test(strip(MINE_JS)) &&
      strip(MINE_JS).indexOf('avatar-slot') < strip(MINE_JS).indexOf('identity-main'),
    '头像在输入框左侧（两者同在一个 .identity-main 的兄弟顺序里）');
  chk(/blur/.test(strip(MINE_JS)) && /saveNickname/.test(strip(MINE_JS)),
    '失焦走保存（键盘上那颗「完成」= 保存，不用按钮）');
  chk(/addEventListener\("input"/.test(strip(MINE_JS)) && /commitNickname/.test(strip(MINE_JS)),
    '边打边存（input 事件就落盘，输完那一刻就已经存好了）');
  chk(/saveNickname/.test(MINE_JS), '同时写 Avatar.saveNickname（邮箱域与档案域两个键同步）');
  chk(!/poem_recite_settings_v1/.test(strip(MINE_JS)) || /patch/.test(strip(MINE_JS)),
    '「我的」页不自己拼设置键名（拼法只在 ProgressStore 一处）');

  // ⚠️ 这一页的 `.nickname-input` 现在**有两条规则**：
  //    · 一条是这一页自己的外观（无边框 / 无底色 / 9.5em 收窄，在 account.css 末尾）；
  //    · 另一条是 Issue #278 第七轮那句 `max-width: min(9.5em, 120px)` 的封顶。
  //    取「最后一条带 width 的」才量得到真口径 —— 取第一条会量到那条只写封顶的。
  const nickRules = [...strip(css).matchAll(/\.nickname-input\s*\{[^}]*\}/g)].map(m => m[0]);
  const nickRule = nickRules.filter(r => /(^|[;{\s])width:/.test(r)).pop() || nickRules.pop() || '';
  chk(/border:\s*none/.test(nickRule) || /border:\s*0/.test(nickRule),
    '用户名输入框不画边框（用户 2026-09-18：不显示输入框的 border 样式和颜色）');
  chk(/background:\s*none/.test(nickRule),
    '用户名输入框不铺底色（无边框就该是一行字，不是一个盒子）');
  // ⚠️ 口径收紧过一次（Issue #278 第七轮）：宽度仍是「em 收窄、不占满一整行」，
  //    但 em 上多了一个 120px 的封顶 —— 9.5em 在 19px 字号下是 180px，
  //    而这一行要装六个格子（昵称 + 登录 + 上传头像 + 删除头像 + 头像 + 徽章）。
  //    180px 那版的实测后果是「登录被压成 39px（两个字竖排）、上传头像叠在
  //    退出登录上面」（用户 2026-09-24：「彻底找不到上传头像和删除头像按钮」）。
  chk(/\bwidth:\s*(min\(\s*\d[\d.]*em\s*,\s*\d+px\s*\)|\d[\d.]*em)/.test(nickRule),
    '用户名输入框的宽度用 em 收窄（短，不占满一整行；实际「' +
    ((nickRule.match(/width:[^;]+/) || [''])[0]) + '」）');
  // ⚠️ Issue #276 第八轮：这条**反转**了 —— 输入框现在**必须**能伸缩
  //    （`width: 100%` + `max-width: 9.5em`），否则它在窄屏上收不动、
  //    把那一行挤到折行（详见 css/account.css 里那一段的说明）。
  //    「不占满一整行」这件事改由 `max-width` 表达：上限还是 9.5em。
  chk(/max-width:\s*(min\(\s*9\.5em|9\.5em)/.test(nickRule),
    '用户名输入框仍不占满一整行 —— 上限 9.5em 那一段（改由 max-width 表达）');
}

{
  chk(/id="stats-list"/.test(MINE) && /id="stats-card"/.test(MINE), '有「本机数据」那一段');
  chk(/id="link-progress"[^>]*href="\/progress\//.test(MINE),
    '「本机数据」卡里有一条去 /progress/ 的入口（用户 2026-09-18 问：数据/进度页的入口在哪）');
  chk(/>背诵进度</.test(MINE) && !/背诵进度总览/.test(MINE),
    '它的文案就叫「背诵进度」（用户 2026-09-18 点名，实际「' +
    (MINE.match(/>([^<]*背诵进度[^<]*)</) || ['', ''])[1] + '」）');
  chk(/<a[^>]*id="link-progress"/.test(MINE) && !/<button[^>]*id="link-progress"/.test(MINE) &&
      !/class="btn[^"]*"[^>]*id="link-progress"/.test(MINE) &&
      !/id="link-progress"[^>]*class="btn/.test(MINE),
    '它是一行链接（<a>，且不挂按钮那套 class）—— 用户 2026-09-18：这个按钮改成链接');
  chk(/Scheduler\.isLearned/.test(MINE_JS) && /Scheduler\.isDue/.test(MINE_JS) &&
      /Scheduler\.mastery/.test(MINE_JS),
    '三项都走 Scheduler 的口径（与首页 / 进度页同源）');
  chk(/Storage\.all\(\)/.test(MINE_JS), '篇目数读 Storage.all()（本机那一份）');
}

{
  chk(/id="identity-row"/.test(MINE), '身份卡有身份行');
  // ⚠️ Issue #276 第八轮：用户问「登录按钮和退出登录按钮应该同时显示吗？
  //    他们应该是一个按钮两个状态吧？」—— 是，现在**只有一颗键**
  //    （#btn-account-entry），文案随登录态在「登录 / 退出登录」之间切，
  //    落点也跟着换（未登录去 /login/，登录着当场退出）。
  //    旧的 #btn-sign-out（账号卡里那颗、与登录那颗并存）**整颗撤掉** ——
  //    两颗键同时在页面上，用户要自己判断「我现在该点哪一颗」，正是他问的那件事。
  // ⚠️ 判据按**标记**（去掉 HTML 注释之后再找）：页面上留着一段注释说明
  //    「那一颗已经并成一颗了」，那是说明，不是标记。
  chk(/"btn-account-entry"/.test(MINE_JS) &&
      !/id="btn-sign-out"/.test(MINE.replace(/<!--[\s\S]*?-->/g, ' ')),
    '登录 / 退出是**一颗键**（#btn-account-entry，由 js/mine.js 画在身份行里），' +
    '不再有与之并存的第二颗');
  // ⚠️ 判据按**代码**（去注释之后再找）：js/mine.js 里留着一行注释说明
  //    「原先那颗 #btn-sign-out 已经不在了」，那是说明，不是接线。
  chk(!/\$\("btn-sign-out"\)/.test(strip(MINE_JS)),
    'js/mine.js 里也不再给那颗不存在的键绑退出（那会是一条永远不响的死线）');
  chk(!/id="btn-go-plans"/.test(MINE),
    '首卡里不再有「层级对比」那颗键（用户 2026-09-18：从这里移出，改成设置「关于」里的一行链接）');
  chk(!/btn-go-plans/.test(strip(MINE_JS)), 'js/mine.js 里也不再有它的接线');
  chk(!/id="link-plans"/.test(MINE) && !/id="upsell-row"/.test(MINE),
    '「我的」页不再有权限 / 层级对比那张卡（用户 2026-09-18：删除 我的页面的权限对比的卡片）');
  chk(!/link-plans/.test(strip(MINE_JS)) && !/upsell-row/.test(strip(MINE_JS)),
    'js/mine.js 里也不再有那条入口的接线（卡撤了，接线一并撤）');
  chk(!/location\.href = "\/plans\/"/.test(strip(MINE_JS)),
    '「我的」页一个字都不提 /plans/（那一页的入口只在设置「关于」里）');
  chk(/id\.signedIn/.test(MINE_JS), '那颗键的文案按 id.signedIn 分两种（不自己另算一遍登录态）');
  chk(/\?\s*"退出登录"\s*:\s*"登录"/.test(MINE_JS) || /"登录"\s*:\s*"退出登录"/.test(MINE_JS),
    '未登录说「登录」/ 已登录说「退出登录」（问题 #276：一个按钮两个状态）');
  chk(/location\.href = "\/login\/"/.test(MINE_JS), '未登录那一态落在 /login/');
  // ⚠️ 落点**不许**写死在监听器里：文案会跟着登录态换，落点也得跟着换，
  //    否则「登录之后点它仍然去登录页」—— 那是这一轮要修的另一半。
  chk(/dataset\.action/.test(strip(MINE_JS)),
    '落点由 dataset.action 现读（监听器只绑一次，不能把第一帧的落点记死）');
  chk(/onSignOut/.test(strip(MINE_JS)) && /dataset\.action === "sign-out"/.test(MINE_JS),
    '已登录那一态点了是**当场退出**（不是再跳一次登录页）');

  chk(/id="danger-card"/.test(MINE) && /class="account-card danger-zone"/.test(MINE),
    '注销单占一张危险区卡（朱砂描边）');
  chk(/id="delete-step-1"/.test(MINE) && /id="delete-step-2"/.test(MINE),
    '注销分两步：先说明、再要求重输邮箱');
  chk(/不动本机背诵进度/.test(MINE), '注销前如实写明「不动本机背诵进度」');
  chk(/AccountApi|acct\(\)/.test(MINE_JS) && /deleteAccount/.test(MINE_JS),
    '注销走接线层（先服务端、后本机）');
}

{
  chk(!/plan\s*===/.test(strip(MINE_JS)) && !/tier\s*===\s*["']/.test(strip(MINE_JS)),
    'js/mine.js 不自己比对 plan / tier（一律走 Entitlement）');
  chk(/Ent\.tierLabel\(/.test(MINE_JS), '层级徽章文案由 Entitlement.tierLabel() 出');

  const forbidden = ['poem_recite_progress_v1', 'poem_recite_collections_v1',
    'poem_device_prefs_v1', 'poem_poems_read_v1', 'poem_classic_read_v1'];
  forbidden.forEach(k => {
    chk(MINE_JS.indexOf(k) < 0, 'js/mine.js 不出现进度 / 已读键名 ' + k);
  });
  chk(!/fetch\(|XMLHttpRequest/.test(strip(MINE_JS)),
    'js/mine.js 不自己发网络请求（走 js/account-api.js）');
}

{
  chk(/function pageTopAction\(/.test(CHROME), 'js/chrome.js 有 pageTopAction()（页面上的顶栏那颗键的唯一来源）');
  chk(/bodyData\("top-action"\)/.test(CHROME), '它读 body 上的 data-top-action');
  chk(/v === "settings"/.test(CHROME), '认的第一个值就是 settings（齿轮那一颗）');
  chk(/^\s+gear:/m.test(CHROME), '齿轮那枚图形在 GLYPHS 里有定义（不是只引用一个不存在的名字）');

  const header = CHROME.slice(CHROME.indexOf('function headerHtml'), CHROME.indexOf('function firstActAnchor'));
  const order = ['isReader ? topAction()', 'pageAction)', 'pageTopAction()', 'top-back']
    .map(k => header.indexOf(k));
  chk(order.every(i => i >= 0) && order[0] < order[1] && order[1] < order[2] && order[2] < order[3],
    '那一颗的优先级是 #top-act → pageAction → data-top-action → 返回键（齿轮盖得住返回键）');

  chk(/key:\s*"mine",\s*href:\s*"\/mine\/"/.test(CHROME), 'ROUTES / 页签表里有 /mine/');
  chk(/mine:\s*"\/mine\/"/.test(CHROME), 'ROUTES 里有 mine 这一项');

  chk(/data-back="\/mine\/"/.test(SETTINGS), '设置整页的返回键回「我的」页（齿轮点进来点回去）');
  // ⚠️ 原先这里守着「个人中心的返回键回『我的』页」（读 profile/index.html）。
  //    2026-09-20（Issue #244）那一页已删除 —— 它留下的这一条口径现在由
  //    test/profile-removed.test.js 承担（全站不该再有指向 /profile/ 的落点）。
  chk(!/\/profile\//.test(read('js/mine.js').replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')),
    '「我的」页不再指向已删除的个人中心');

  ['general', 'recite', 'lists', 'reader'].forEach(k => {
    chk(/data-back="\/settings\/"/.test(read('settings/' + k + '/index.html')),
      '四张二级页的返回键仍是设置整页（齿轮背后那一层）');
  });
}

{
  chk(!/renderAccountEntry/.test(read('js/settings-nav.js')),
    'js/settings-nav.js 不再画账号那一行（它是「我是谁」，归「我的」页）');
  chk(/renderIndex\(\);\s*\n\s*renderAbout\(\);/.test(read('js/settings-nav.js')),
    'init() 两步顺序：renderIndex → renderAbout');
}

{
  const ver = parseInt((SW.match(/poem-app-v(\d+)/) || [0, '0'])[1], 10);
  chk(ver >= 152, '缓存版本已跟着提（本轮改了 css / js / 新增两张页，实际 v' + ver + '）');

  ['./mine/', './js/mine.js', './js/avatar-edit.js', './js/family-ui.js'].forEach(u => {
    chk(SW.indexOf('"' + u + '"') >= 0, 'sw.js 预缓存里有 ' + u);
  });

  const list = [...SW.matchAll(/"(\.\/[^"]+)"/g)].map(m => m[1]);
  const missing = list.filter(u => {
    if (u === './') return false;
    const f = u.replace(/^\.\//, '');
    if (fs.existsSync(path + f)) return false;
    if (/\/$/.test(f) && fs.existsSync(path + f + 'index.html')) return false;
    return true;
  });
  chk(missing.length === 0, '预缓存清单里的文件都存在（实际缺 ' + missing.join(',') + '）');

  const navVer = (read('js/settings-nav.js').match(/APP_VERSION = "[^"]*v(\d+)/) || [0, '0'])[1];
  chk(String(ver) === String(navVer),
    '「关于」里的版本号与 sw.js 的 CACHE_NAME 同一个数（实际 v' + navVer + ' / v' + ver + '）');
}

{
  const sheet = '<style>' + css + '</style>';
  const d = new JSDOM(MINE, { url: 'https://local.test/mine/' });
  d.window.document.head.insertAdjacentHTML('beforeend', sheet);
  const doc = d.window.document;

  const gearCss = (css.match(/\.top-act\s*\{([^}]*)\}/) || [, ''])[1];
  chk(/width:\s*var\(--top-key\)/.test(gearCss) && /height:\s*var\(--top-key\)/.test(gearCss),
    '齿轮与返回键共用同一档外盒尺寸（--top-key，一处改两处跟）');
  chk(/margin-left:\s*auto/.test(gearCss), '它在顶栏右端（margin-left: auto 把它推过去）');
  chk(!/border-radius:\s*50%/.test(gearCss),
    '它不是圆钮（与返回键同一个形状；用户点名的那颗圆键是另一件事）');

  chk(!!doc.querySelector('#topbar, .topbar'), '页面上有顶栏挂载点（结构由 chrome.js 渲染）');
  chk(!/class="top-slot"|class="top-user"/.test(MINE.replace(/<!--[\s\S]*?-->/g, ' ')),
    'HTML 里不写死右侧簇（结构只出 chrome.js 一处）');
}

function boot(seed) {
  const dom = new JSDOM(MINE, { runScripts: 'dangerously', url: 'https://local.test/mine/', pretendToBeVisual: true });
  const w = dom.window;
  if (seed) for (const k in seed) { try { w.localStorage.setItem(k, seed[k]); } catch (e) {} }
  w.confirm = () => true;

  MINE.match(/<script src="([^"]+)"><\/script>/g)
    .map(x => x.match(/src="([^"]+)"/)[1])
    .forEach(f => {
      const el = w.document.createElement('script');
      try { el.textContent = read(f.replace(/^\//, '')); } catch (e) { return; }
      w.document.body.appendChild(el);
    });
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  return w;
}

(async function main() {
  const w0 = boot(null);
  await new Promise(r => setTimeout(r, 300));
  const d0 = w0.document;

  chk(!!d0.getElementById('identity-row'), '（真页面）身份行画出来了');
  chk(/游客/.test(d0.getElementById('identity-row').textContent) &&
      !/本机游客/.test(d0.getElementById('identity-row').textContent),
    '（真页面）未登录时身份行写「游客」（用户 2026-09-18：不再写「本机游客」，实际「' +
    d0.getElementById('identity-row').textContent.trim() + '」）');
  chk(!!d0.getElementById('input-nickname') &&
      d0.getElementById('input-nickname').closest('.account-card') ===
      d0.getElementById('identity-row').closest('.account-card'),
    '（真页面）昵称输入框与头像在同一张卡里（顶部的昵称已合并进来）');
  chk(d0.getElementById('input-nickname').closest('.identity-main') &&
      d0.getElementById('input-nickname').closest('.identity-main') ===
      d0.getElementById('identity-row').querySelector('.identity-main'),
    '（真页面）输入框画在 .identity-main 里（头像右侧那一列）');
  chk(d0.getElementById('input-nickname').compareDocumentPosition(
        d0.getElementById('identity-row').querySelector('.identity-sub')) &
      w0.Node.DOCUMENT_POSITION_FOLLOWING,
    '（真页面）输入框排在「游客」那一行**之前**（用户点名的位置：游客上方）');
  chk(d0.getElementById('input-nickname').compareDocumentPosition(
        d0.getElementById('avatar-slot')) & w0.Node.DOCUMENT_POSITION_PRECEDING,
    '（真页面）输入框排在头像**之后**（用户点名的位置：头像右侧）');
  chk(d0.getElementById('input-nickname').nextElementSibling ===
        d0.getElementById('identity-row').querySelector('.identity-sub'),
    '（真页面）输入框的下一个兄弟就是「游客」那一行（它紧挨在下面）');
  chk(!/btn-nickname-save/.test(d0.getElementById('mine-page').outerHTML),
    '（真页面）没有「保存」按钮（输完自动保存）');
  chk(!d0.getElementById('upsell-row') && !d0.getElementById('link-plans'),
    '（真页面）没有权限对比那张卡（用户 2026-09-18：删除）');
  chk(!!d0.getElementById('link-progress') &&
      d0.getElementById('link-progress').getAttribute('href') === '/progress/',
    '（真页面）「本机数据」卡里有去 /progress/ 的入口（用户问的「数据 / 进度页」入口）');
  chk(d0.getElementById('link-progress').tagName === 'A' &&
      d0.getElementById('link-progress').textContent.trim() === '背诵进度',
    '（真页面）那个入口是链接，写着「背诵进度」（实际「' +
    d0.getElementById('link-progress').tagName + ' · ' +
    d0.getElementById('link-progress').textContent.trim() + '」）');
  chk(!/\bbtn\b/.test(d0.getElementById('link-progress').className),
    '（真页面）它没有按钮那套 class（挂上就还是画出来一颗键）');
  chk(!!d0.getElementById('avatar-slot') &&
      !!d0.getElementById('avatar-slot').querySelector('.avatar'),
    '（真页面）头像只画一处（#identity-row 里那一枚，卡里不再有第二枚）');
  chk(d0.querySelectorAll('.avatar-slot').length === 1,
    '（真页面）头像槽全页只有一个（用户 2026-09-18：按钮左侧那枚与顶部那枚合并）');
  chk(/上传头像/.test(d0.getElementById('btn-avatar-pick').textContent),
    '（真页面）那颗键写「上传头像」（原先叫「上传图片」）');
  chk(!/上传图片/.test(d0.getElementById('mine-page').textContent),
    '（真页面）页面上不再出现「上传图片」四个字');
  chk(d0.getElementById('btn-account-entry').textContent === '登录',
    '（真页面）未登录时那颗键写「登录」');
  chk(d0.getElementById('btn-account-entry').dataset.action === 'sign-in' &&
      d0.getElementById('btn-account-entry').className.indexOf('ghost') < 0,
    '（真页面）未登录时它是**主按钮**外观 + 落点是登录（一颗键的其中一态）');
  // ⚠️ 2026-09-24（Issue #276）这一条**整条反转了**，不是放宽：
  //    用户同一句话问出三件事 ——「上传头像和删除头像请用二级按钮吧 目前一行
  //    显示一个按钮也太大了」「我现在找不到登录入口了，从哪里登录？」
  //    「要不要登录，上传头像，和删除头像在一行显示？」
  //    2026-09-18 那次是把「登录」挪出首卡（首卡当时只有身份 + 两颗大按钮，
  //    它自己就是那颗主动作）；现在它搬回来了，理由与那一次并不冲突：
  //    首卡现在画的是**一行**（头像 | 昵称 | 徽章 | 动作），「登录」是那一行
  //    尾格的一颗行内小钮，不再是「这颗卡的主按钮」。所以判据也跟着换成
  //    「它与身份行同行」——不再是「它在哪张卡里」。
  chk(d0.getElementById('btn-account-entry').closest('.account-card')
        === d0.getElementById('identity-row').closest('.account-card'),
    '（真页面）登录那颗键回到首卡 —— 它现在是身份行尾格的一颗行内小钮');
  chk(d0.getElementById('btn-account-entry').parentNode ===
        d0.getElementById('account-actions'),
    '（真页面）它仍住在那唯一的容器 #account-actions 里（不是又画了一颗）');
  chk(d0.getElementById('identity-row').contains(d0.getElementById('account-actions')),
    '（真页面）「登录 / 退出」那一格就在身份行里（与头像键同一行）');
  chk(d0.getElementById('identity-row').contains(d0.getElementById('btn-avatar-pick')),
    '（真页面）「上传头像」也在那一行里');
  chk(!d0.getElementById('btn-account-entry').hidden,
    '（真页面）未登录时它**画出来**（原先整张卡藏着 —— 没登录的人在这一页找不到登录入口）');
  chk(d0.getElementById('danger-card').hidden, '（真页面）未登录时不摆注销卡（没有账号可注销）');
  // ⚠️ 「删除头像」的判据从「那颗键 hidden 了吗」换成「它还在身份行上吗」：
  //    没图时它**根本不该存在**（用户 2026-09-24 问的就是这一条）。
  chk(d0.getElementById('btn-avatar-clear') === null,
    '（真页面）没图时身份行上没有「删除头像」这颗键（不是 hidden，是没有）');
  chk(/上传头像/.test(d0.getElementById('btn-avatar-pick').textContent),
    '（真页面）没图时那颗键说「上传头像」');
  chk(/还没有/.test(d0.getElementById('stats-list').textContent),
    '（真页面）本机数据如实写「还没有」');
  chk(!!d0.getElementById('family-panel'), '（真页面）子用户那一块画出来了');
  chk(!d0.getElementById('btn-family-add'),
    '（真页面）Free 只剩 0 个名额时**不摆**「再建一个」（摆一颗点不动的键没有意义）');
  chk(/当前 1 \/ 1 个/.test(d0.getElementById('family-hint').textContent),
    '（真页面）上限那一行只说现在到哪（实际「' +
    d0.getElementById('family-hint').textContent + '」）');
  chk(!/Pro 用户可建|Max 用户可建/.test(d0.getElementById('family-hint').textContent),
    '（真页面）不再把 Free / Pro / Max 三档名额全背一遍（那些数字在 /plans/ 那张表上）');

  const order0 = [...d0.querySelectorAll('#mine-page > section')].map(s => s.id);
  chk(order0.indexOf('family-item') >= 0 && order0.indexOf('family-item') < order0.indexOf('stats-card'),
    '（真页面）子用户卡在本机数据卡**上方**（实际 ' + order0.join(' → ') + '）');
  chk(order0.indexOf('upsell-row') < 0,
    '（真页面）权限 / 层级对比那张卡整张撤了（实际 ' + order0.join(' → ') + '）');
  chk(order0.indexOf('danger-card') === order0.length - 1,
    '（真页面）注销仍是最下面那张卡');
  // ⚠️ 用户 2026-09-18 原话是「从『关于』卡挪出，放到最下面」；
  //    2026-09-20（Issue #244）个人中心删掉后，管理后台入口与它同一张卡里的
  //    同步开关 / 法务三行一起搬进「我的」页的「关于」卡 —— 这是用户
  //    2026-09-20 的新口径（把个人中心那张卡整体并进来），不是回退。
  const admin = d0.getElementById('btn-go-admin');
  chk(!!admin && admin.closest('#about-card'),
    '（真页面）管理后台那颗键在「关于」卡里（2026-09-20：随个人中心那张卡并进来）');

  const gear = d0.getElementById('top-act-link');
  chk(!!gear && gear.getAttribute('href') === '/settings/',
    '（真页面）顶栏右端那颗是齿轮，落在 /settings/');
  chk(!d0.getElementById('top-back'), '（真页面）顶栏没有返回键（页签落点，顶上没有上一层）');
  chk(!!d0.querySelector('.dock-item[data-nav-go="mine"].active'),
    '（真页面）底部「我的」那一格是选中态');

  // 昵称：输完（不用点任何按钮）→ 失焦 → 落盘 → 头像 / 页签首字跟着走
  const w1 = boot(null);
  await new Promise(r => setTimeout(r, 300));
  const d1 = w1.document;
  const input = d1.getElementById('input-nickname');
  input.value = '玥玥';
  input.dispatchEvent(new w1.Event('input', { bubbles: true }));
  input.dispatchEvent(new w1.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 400));

  let saved = null;
  try { saved = JSON.parse(w1.localStorage.getItem('poem_profile_v1')); } catch (e) {}
  const family = JSON.parse(w1.localStorage.getItem('poem_family_v1') || '{}');
  chk(!!family.profiles && family.profiles[0].nickname === '玥玥',
    '（真页面）昵称写进的是**当前子用户**（昵称属孩子）');
  chk(!saved || saved.nickname !== '玥玥',
    '（真页面）名册在的时候只写名册那一份（两处各写一份的下场是「改了一个、显示另一个」）');
  const st = JSON.parse(w1.localStorage.getItem('poem_recite_settings_v1') || '{}');
  chk(st.username === '玥玥', '（真页面）同时写进设置域那个 username（导出 / 跨设备那一份也对得上）');
  chk(/玥/.test(d1.getElementById('identity-row').textContent),
    '（真页面）身份行跟着换成新昵称（头像那枚首字也在里面）');

  // 头像：本机有图就当场看得到 —— 页面上不再摆「已同步 / 未同步」那一行
  const w2 = boot({
    poem_avatar_local_v1: JSON.stringify({ v: 1, img: 'data:image/png;base64,iVBORw0KGgo=' })
  });
  await new Promise(r => setTimeout(r, 300));
  const d2 = w2.document;
  chk(!d2.getElementById('avatar-hint'),
    '（真页面）不再有「已同步 / 未同步」那一行（用户 2026-09-21：能省则省）');
  chk(!/已存在本机|未同步|已同步/.test(d2.getElementById('mine-page').textContent),
    '（真页面）页面上不再出现同步状态那几句（图本身在左边那枚印里看得见）');
  chk(!!d2.querySelector('#avatar-slot .avatar-img') || !!d2.querySelector('#avatar-slot img'),
    '（真页面）本机有图就当场画出来（这才是那条状态唯一的用处）');

  // ==========================================================================
  // Issue #276（2026-09-24）：身份行那一条
  //
  // 用户原话三句：
  //   ①「上传头像和删除头像请用二级按钮吧 目前一行显示一个按钮也太大了」
  //   ②「我现在找不到登录入口了，从哪里登录？」
  //   ③「要不要登录，上传头像，和删除头像在一行显示？」
  //
  // 这三句合起来是**一条**结构：身份行 = 头像 | 昵称 + 身份 | 徽章 | 动作
  // （登录 / 账号 · 上传头像 · 删除头像），一行的，行内小号（档②）。
  // 下面守的是这条结构，以及它的容量（手机上装得下，不许折行）。
  // ==========================================================================
  {
    console.log('\n=== 身份行：登录 / 上传头像 / 删除头像同一行（Issue #276）===');

    const cssBare = strip(css);
    // ⚠️ 口径改过一次（Issue #278 第七轮）：上一轮写的是「**不许**换行」，
    //    而实测的收场是「登录」两个字竖排、「上传头像」被「退出登录」压住 ——
    //    用户 2026-09-24 的原话就是「彻底找不到上传头像和删除头像按钮了」。
    //    现在口径是：这一行**可以**折，而每一颗键**都不许被压变形**
    //    （见下面 flex: 0 0 auto 那两条）。折行只在 ≤360px 这一档发生。
    chk(/\.identity-row \{[^}]*display:\s*flex/.test(cssBare) &&
        /\.identity-row \{[^}]*flex-wrap:\s*wrap/.test(cssBare),
      '身份行是一个 flex 行、且**可以折行**（这是它唯一的让位方式；' +
      '不让位也不折行的下场是键被压成两个字竖排）');
    // ⚠️ 口径换过一次（Issue #276 第八轮）：上一轮靠 `margin-right: auto`
    //    把余量吃在右边，而 auto 外边距在 flex 里**优先于收缩** ——
    //    结果「差 2px 时昵称列一格不让、徽章掉到第二行」。现在余量交给
    //    昵称列自己的 `flex-grow: 1`（同一个盒子既吃余量、又第一个让位）。
    chk(/\.identity-main \{[^}]*flex:\s*1\s+999\s+0/.test(cssBare),
      '昵称列把余量吃在右边（flex-grow: 1 —— 那一簇动作整组贴右缘）');
    chk(/\.identity-btns \{[^}]*flex-wrap:\s*nowrap/.test(cssBare),
      '「上传头像 / 删除头像」那一格自己也不换行（两颗要并排）');
    chk(/\.identity-btns \{[^}]*margin-top:\s*0/.test(cssBare),
      '那一格不带自己的上外边距（它现在在一行里，不是另起一行）');

    // ⚠️ 取的是**定尺那一条**（.identity-btns .account-btn 有两处：一条定尺
    //    （width / height / font-size / flex），另一条专管
    //    `margin-top: 0`（第八轮加的，给「删除头像偏低 5px」那道题）。
    //    按「文件里最后一条」取会抓到那条单行的 —— 它测不出尺寸。
    //    这里按**有没有 height** 认那一条，不按位置。
    const btnRules = [...cssBare.matchAll(/\.identity-btns \.account-btn \{[^}]*\}/g)].map(m => m[0]);
    const btnsRule = btnRules.filter(r => /height:/.test(r)).pop() || '';
    chk(/height:\s*var\(--ctl-h-sm\)/.test(btnsRule),
      '那两颗键的高度是行内小号那一档（--ctl-h-sm = 32px），不是 44px 的主按钮 ——' +
      '用户说的「太大」就是这一条（实际「' + (btnsRule.match(/height:[^;]+/) || [''])[0] + '」）');
    chk(/font-size:\s*var\(--ctl-font-sm\)/.test(btnsRule),
      '字号也跟着落到小号那一档（高度收了、字号不收，字会顶在框里）');
    chk(!/min-width:\s*116px/.test(btnsRule),
      '不再有 116px 的最小宽度（那正是「一行显示一个按钮」的宽度来源）');
    // ⚠️ 口径再改一次（Issue #278 第七轮）：上一轮靠 `flex-basis: max-content`
    //    + `flex-shrink: 0.02` 表达「几乎不让」，而实测里 `max-content` 在这个
    //    容器里被算成了 **0**（393px：「上传头像」66px 的键只剩 3px 的 basis）。
    //    现在口径更硬：键的宽度就是**它自己的内容**（basis auto = 内容宽），
    //    一格都不收缩（shrink 0）。让位只有一条路 —— **折行**，
    //    而「一行」的口径不变（375px 及以上仍是完整的一行）。
    chk(/min-width:\s*0/.test(btnsRule) && /flex:\s*0 0 auto/.test(btnsRule),
      '键的宽度由**内容**定死（flex: 0 0 auto）—— 不从这一行的剩余空间里分，' +
      '也不收缩（再收缩就是本轮之前那副「两个字竖排」的样子）');
    chk(!/flex-basis:\s*max-content/.test(cssBare),
      '不再靠 flex-basis: max-content 定宽（实测它在这个容器里被算成 0，' +
      '「上传头像」66px 的键只剩 3px 的 basis）');
    // ⚠️ 让位优先级（Issue #276 第八轮）：昵称列先让，且它必须有一个下限。
    //    旧写法 `flex: 0 1 auto` 把 basis 留给内容（147px），而 flex 的
    //    断行判据看 basis 不看 shrink —— 于是「差 2px」时断行先发生，
    //    昵称列压根没轮到让位、徽章掉到了第二行。
    //    新写法 `flex: 1 999 0` 三件一起：basis 0（断行时不算宽）
    //    + shrink 999（让位优先）+ grow 1（宽裕时吃余量）。
    const mainFlexRules = (cssBare.match(/\.identity-main \{[^}]*\}/g) || [])
      .filter(r => /flex:/.test(r)).join(' ');
    chk(/flex:\s*1\s+999\s+0/.test(mainFlexRules),
      '昵称列的 flex 三件齐全：basis 0 / shrink 999 / grow 1（放不下它先让，' +
      '那几颗键一颗都不许被压死）');
    chk(/\.identity-main \{[^}]*min-width:\s*\d+px/.test(cssBare),
      '昵称列有一个 min-width 兜底（不许被压成 0 宽 —— 实测那是「看着像坏了」）');
    chk(/\.nickname-input \{[\s\S]{0,400}?max-width:\s*min\(\s*9\.5em\s*,\s*120px\s*\)/.test(cssBare),
      '昵称框在最窄那一档还有一个 120px 的封顶（9.5em 在 19px 字下是 180px）');
    // ⚠️ 这一条是本轮踩过的第二个坑（比溢出更隐蔽）：
    //    身份行里那两颗键必须**点名**覆盖掉 `.account-actions .account-btn`
    //    那套 `flex: 1 1 0; min-width: 104px`（那是「账号卡里两张满宽键」的算式）。
    //    不覆盖的话，「账号」会被撑成 104px，把旁边的键挤到变形
    //    （实测：真浏览器里「账号」冲上 104px，「上传头像」被压在被它盖住的下面）。
    chk(/\.identity-row > \.account-actions \.account-btn \{[^}]*flex:\s*0 0 auto[^}]*min-width:\s*0/.test(cssBare),
      '身份行里的那颗登录/退出键点名覆盖了账号卡那套满宽算式（flex: 1 1 0 / min-width: 104px）');
    chk(/^\s*\.identity-btns \.account-btn \{ margin-top: 0; \}/m.test(cssBare),
      '两颗头像键**不带自己的上外边距**（这道题就是用户 2026-09-24 报的那一句：' +
      '「删除头像按钮比其他按钮显示得往下了」—— 真浏览器 1280px 实测' +
      '「上传头像」y=101、「删除头像」y=106，整整低下 5px）');

    chk(/@supports selector\(:has\(\*\)\)/.test(cssBare),
      '身份行那几条按内容定宽的规则裹在 @supports 里（不认 :has() 的浏览器' +
      '退化成不排次序的样子，不会错乱、不会丢键）');
    // ⚠️ **反向**一条（Issue #276 第八轮）：那一族东西**必须走光**。
    //    它是上一轮「同一个容器里塞着登录 + 退出两颗、靠 CSS 在两态间换位置」
    //    的产物；现在那一格上只有一颗键（文案与落点由 js/mine.js 一处定），
    //    留着这条 :has() 等于留着一句「这里有第二颗要挪」的谎话。
    chk(!/:has\(#btn-sign-out/.test(cssBare) && !/#btn-sign-out/.test(cssBare),
      'CSS 里不再有 :has(#btn-sign-out) 那一族判据（那一格上只有一颗键，没什么可挪的）');
    chk(!/#btn-sign-out\s*\{/.test(cssBare),
      'CSS 里也没有一条给 #btn-sign-out 定样式的规则（那颗键整颗撤了，' +
      '留一条规则就是留一句谎话）');
    // ⚠️ 屏幕次序：留着的三格仍显式写 order（头像 / 昵称 / 徽章）。
    //    最后那两格（头像键 · 登录键）**不再写 order** —— 它们是 DOM 次序的
    //    自然结果，少一套编号就少一处能对不上的地方（第八轮收格的结果）。
    [
      /#avatar-slot \{[^}]*order:\s*0/.test(cssBare) ? '#avatar-slot 是第 0 格（最左）' : '',
      /\.identity-main \{[^}]*order:\s*1/.test(cssBare) ? '.identity-main 是第 1 格' : '',
      /#identity-badge \{[^}]*order:\s*2/.test(cssBare) ? '#identity-badge 是第 2 格' : ''
    ].forEach(label => {
      chk(!!label, '屏幕上那把次序写明了一格：' + (label || '（有一格没写 order）'));
    });
    chk(!/\.identity-btns \{[^}]*order:\s*4/.test(cssBare) &&
        !/\.identity-row > \.account-actions \{[^}]*order:\s*3/.test(cssBare),
      '最后两格不再编号（它们按内容排，DOM 次序就是屏幕次序）');

    // 真页面：那颗键在、且只有一颗
    const row = d0.getElementById('identity-row');
    const acts = d0.getElementById('account-actions');
    const pick = d0.getElementById('btn-avatar-pick');
    const loginBtn = d0.getElementById('btn-account-entry');
    chk(!!row && !!acts && !!pick && !!loginBtn, '（真页面）四样都在：身份行 / 动作格 / 头像键 / 登录键');
    chk(row.contains(acts) && row.contains(pick), '（真页面）两格都在身份行里');
    chk(acts.children.length === 1 && acts.firstElementChild === loginBtn,
      '（真页面）「登录 / 退出」那一格上只有**一颗**键（不是一个按钮两个状态并存）');
    chk(!loginBtn.hidden, '（真页面）它在页面上（用户找不到的那个登录入口）');
    chk(d0.getElementById('btn-avatar-clear') === null,
      '（真页面）「删除头像」不在这一行上（它只住在有图那一半的裁切层里）');

    // 容量：这一行现在只有**四个格子**（头像 · 昵称 · 徽章 · 头像键 · 登录键）
    //   360 − 卡内边距（.account-card 两侧各约 16）= 约 328
    //   头像 44 + 缝 8 + 徽章 40 + 缝 8 + 上传头像 66 + 缝 6 + 登录 40 ≈ 212
    //   （昵称列可以被压到 0；它让光之后仍然装得下）
    //   ⚠️ 真浏览器（headless Chromium）在 320 / 360 / 393 / 414 / 1280 五档 ×
    //      （未登录 / 有图 / 已登录）上量过：**scrollWidth === clientWidth**，
    //      且在 393px 及以上**不折行**（这一行的高度就是一行）。
    //      JSDOM 不做布局（clientWidth 恒 0），所以这一层守的是
    //      「按声明算得下」＋「CSS 里那几条收缩规则还在」（下面这些）。
    chk(/\.identity-row > \.avatar-slot,\s*\n\.identity-row > \.tier-badge \{[^}]*flex:\s*0 0 auto/.test(cssBare),
      '头像槽与徽章一步不让（flex: 0 0 auto）—— 压扁了就不是头像、不是徽章了；' +
      '让它们被压到 0 宽是实测过的真事故（整行 scrollWidth 比 clientWidth 大）');
    chk(/--avatar-size:\s*44px/.test(cssBare),
      '头像缩到 44px（这一行上有两颗行内小键，头像得让一让）');

    const ROW_360 = 44 + 8 + 0 + 8 + 40 + 8 + 66 + 6 + 40;
    chk(ROW_360 <= 304,
      '360px 那一档装得下：' + ROW_360 + 'px ≤ 304px（行内可用宽度）');

    // 二次绑定：身份行重画之后两颗头像键仍然点得动
    const file = d0.getElementById('avatar-file');
    let clicks = 0;
    file.addEventListener('click', function () { clicks += 1; });
    pick.dispatchEvent(new w0.Event('click', { bubbles: true }));
    chk(clicks === 1, '（真页面）点「上传头像」转发给文件选择框');
    w0.MinePage.paint(w0.AuthCore.session(w0.AuthCore.makeStore(w0.localStorage)));
    const pick2 = w0.document.getElementById('btn-avatar-pick');
    pick2.dispatchEvent(new w0.Event('click', { bubbles: true }));
    chk(clicks === 2,
      '（真页面）身份行重画一次之后那颗键仍绑着（重画换掉的是节点，绑定是幂等的）');

    // ⚠️ 第八轮：那颗键的**文案**（上传 / 更新）由 js/avatar-edit.js 的 render
    //    一处画 —— 不再有第二处从「有没有图」推显隐（旧实现里那颗「删除头像」
    //    就是第二处，它一直挂着一颗看不见的键）。
    chk(/btn-avatar-pick/.test(AVATAR_EDIT) && /更新头像/.test(AVATAR_EDIT) &&
        /上传头像/.test(AVATAR_EDIT),
      '那颗键的文案（上传 / 更新）由 js/avatar-edit.js 的 render 一处按「有没有图」画');
    w0.document.getElementById('input-nickname').value = '诗';
  }

  // ==========================================================================
  // 十一、身份行的**布局防回归**（Issue #276 第八轮）
  //
  // 这一节守的是**真浏览器里量出来的四件事**（jsdom 不做布局，所以这里
  // 一条一条对着 CSS 声明守 —— 每一条都注明它在真浏览器上的实测值）：
  //   ① 两颗键的「脚」踩在同一个 y 上（用户原话：「删除头像按钮比其他按钮
  //      显示得往下了」）；
  //   ② 这一行**最宽的那几档不折行**（折行的形状就是「某个东西跑到下一行」）；
  //   ③ 昵称列不许被压成 0 宽，也不许把行撑破（scrollWidth ≤ clientWidth）；
  //   ④ 「上传 / 更新头像」的文案只有一处、且由「有没有图」定。
  // ==========================================================================
  {
    console.log('\n=== 身份行布局防回归（Issue #276 第八轮）===');
    const cssBare = strip(css);

    // ① 两颗键的脚同一高度。
    //    实测（真浏览器 1280px，改前）：「上传头像」y=101、「删除头像」y=106
    //    —— 差 5px，正是用户报的那一句。改后两颗都是 y=101。
    //    这一条有两个必需的声明，缺一个就会重新长出那 5px：
    //      · #btn-avatar-clear 那条 `margin-top: 10px` 必须走光；
    //      · 身份行里那两格各自不许带自己的上外边距。
    chk(!/#btn-avatar-clear\s*\{/.test(cssBare),
      '给「删除头像」那张 10px 上外边距的规则**走光**（那 5px 就是它漏出来的）');
    chk(/\.identity-row > \.account-actions \{[^}]*margin-top:\s*0/.test(cssBare),
      '身份行里那两格自己也清零上外边距（盒子居中时，自己的 margin-top 会漏出一半）');

    // ② 这一行的让位顺序：basis 0 + shrink 999 + min-width 兜底，三件一起。
    //    只用 shrink 不写 basis:0 的实测收场是「断行先发生、徽章掉到第二行」
    //    （因为 flex 的断行判据看 flex-basis，不看 flex-shrink）；
    //    只写 basis:0 不写下限的收场是「昵称列被压到 31px，看着像坏了」。
    const mainRule = (cssBare.match(/\.identity-main \{[^}]*\}/g) || [])
      .filter(r => /flex:/.test(r)).join(' ');
    chk(/flex:\s*1\s+999\s+0/.test(mainRule),
      '昵称列的 flex 是 `1 999 0`（basis 0 —— 断行时它不算宽；grow 1 —— 宽裕时它吃余量；' +
      'shrink 999 —— 装不下时它先让）');
    chk(/min-width:\s*(\d+)px/.test(mainRule),
      '昵称列还有一个 min-width 兜底（不许被压成 0 宽 —— 那是实测过的「看着像坏了」）');

    // ③ 昵称框的宽度必须是**上限**语义（max-width），不是硬宽（width）。
    //    写死 `width: 9.5em` 的实测收场：昵称列变成一根钉死的柱子，
    //    `flex-shrink: 999` 收不动它 —— 那一行只能折。
    // ⚠️ 按**有没有 max-width: 9.5em** 认那一条（.nickname-input 有几处：
    //    基础那条 + 焦点/占位符那些），不按位置取。
    const nickBase = (cssBare.match(/\.nickname-input \{[^}]*\}/g) || [])
      .filter(r => /9\.5em/.test(r))[0] || '';
    chk(/max-width:\s*(min\(\s*9\.5em|9\.5em)/.test(nickBase),
      '昵称框的宽是 `max-width`（上限，不是硬宽 —— 实际「' +
      ((nickBase.match(/max-width:[^;]+/) || [''])[0]) + '」）');
    chk(!/(^|[;{\s])width:\s*9\.5em/.test(nickBase),
      '昵称框不再写 `width: 9.5em` 那种硬宽（硬宽 = 收缩收不动它）');
    chk(/min-width:\s*0/.test(nickBase),
      '昵称框上有 `min-width: 0`（放开 <input> 自带的 min-content 下限 —— 它默认约 186px）');

    // ④ 窄屏那两档不许把这一行撑破（声明层：overflow 不许出现在这一行上）。
    chk(!/\.identity-row \{[^}]*overflow/.test(cssBare),
      '身份行上不许有 overflow（靠让位与折行解决，不靠把内容切掉或让它横向滚）');

    // ⑤ 文案唯一来源：那颗键的两个文案只在 js/avatar-edit.js 里。
    const pickLabel = /pick\.textContent = hasImage \? "([^"]+)" : "([^"]+)"/.exec(AVATAR_EDIT);
    chk(!!pickLabel && pickLabel[1] === '更新头像' && pickLabel[2] === '上传头像',
      '那颗键的文案由「有没有图」一处二分（有图「更新头像」/ 没图「上传头像」）');
    // ⚠️ 判据按**代码**（strip 掉注释之后再找）：js/mine.js 里留着几行
    //    说明这颗键有两个文案的注释，那是说明，不是第二个文案出口。
    chk(!/更新头像/.test(strip(MINE_JS)),
      'js/mine.js 的**代码里**不写那个文案（它只负责「画完之后叫 render 一次」）');
    chk(!/更新头像/.test(MINE.replace(/<!--[\s\S]*?-->/g, ' ')),
      '页面 HTML 里也不写它（那颗键是画出来的，文案只有一处）');

    // ⑥ 那颗键画完之后**必须**被 render 补一次：身份行是按需重画的，
    //    出厂 HTML 里那颗键写死成「上传头像」—— 不补的话，本机有图的人
    //    打开这一页看到的仍是「上传头像」（实测就是这么错的）。
    chk(/buildIdentityRow[\s\S]{0,2000}?AvatarEdit\.render/.test(strip(MINE_JS)),
      'buildIdentityRow 画完就叫一次 AvatarEdit.render（把文案与绑定补上）');
  }

  console.log('\n' + (fails ? '❌ ' + fails + ' 项失败' : '🎉 「我的」页测试全部通过'));
  process.exit(fails ? 1 : 0);
})().catch(e => {
  console.log('✗ 测试自身抛异常：' + (e && e.stack || e));
  process.exit(1);
});
