/**
 * 账号入口动线专项测试（Issue #132 · A→B→C→D 的 D）
 * ==========================================================================
 * 账号三页（/login/ /profile/ /admin/）落地之后，还差**最后一块**：
 * 从一个「未登录的人」到 `/login/` 的路。这一层就是守那条路。
 *
 * 为什么不能靠肉眼点一遍就下结论：动线的毛病全是**静默**的 ——
 *   入口指向一个 404（`/login/` 建好之前就是这么摆的）；返回键落回设置页
 *   而不是个人中心；「管理后台」入口在个人中心里看得见、点进去却被拒；
 *   顶栏那枚印没画（`Avatar.html(null, …)` 那个坑，表现是「只有顶栏还是诗」）。
 *
 * 三个真实存在的落地点，一处都不能少：
 *   ① 顶栏那枚印  → `/profile/`（每页都有，未登录也画）—— 由 chrome.js 出
 *   ② 个人中心    → 身份卡里的账号入口 → `/login/`
 *   ③ 设置主页    → 「账号」卡（未登录给登录、已登录给个人中心）→ 由 settings-nav.js 出
 *
 * 另外守两条口径：
 *   · `/login/` 的返回落点是 `/profile/`（登录是身份的事，不是设置的事）
 *   · 页面 / 脚本里**不许自己拼 plan / tier**，判据一律走 Entitlement
 *
 * 跑法：`node test/account-entry.test.js`（jsdom + 源码扫描，不联网、不装依赖）
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = __dirname + '/../';
const read = f => fs.readFileSync(path + f, 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

/** 剥注释：注释里会写历史口径，不剥掉就会对着自己的说明判红 */
const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
/** 剥 HTML 注释：注释里可以写「这条占位不许渲染」的说明 */
const stripHtml = t => t.replace(/<!--[\s\S]*?-->/g, ' ');

const SETTINGS_HOME = 'settings/index.html';
const PROFILE = 'profile/index.html';
const LOGIN = 'login/index.html';

const SRC = {
  home: read(SETTINGS_HOME),
  profile: read(PROFILE),
  login: read(LOGIN)
};
const NAV = read('js/settings-nav.js');
const PROFILE_JS = read('js/profile.js');
const LOGIN_JS = read('js/login.js');
const CHROME = read('js/chrome.js');
const SW = read('sw.js');

/**
 * 起一张真页。
 *
 * 与 test/ui.test.js 同一套起页方式（jsdom 不加载外部资源，脚本按 HTML 里的
 * 声明顺序手动读进来注入 —— **顺序本身就是被测口径的一部分**），
 * 但这里多三步，都是「不补就测不出真东西」的：
 *
 *   1. **先注入内核**（auth-core / entitlement）：设置主页的 HTML 里没有它们，
 *      而账号卡要读；不注入的话测的是「拿不到内核 → 整卡不画」那条降级分支。
 *   2. **内核之间显式对接**（`Entitlement.setAuthCore(AuthCore)`）：
 *      `identity()` 要从会话里取账号，靠的是这个显式注入，不是「读完两个文件
 *      就自动连上」。少这一步的症状正是「盘上明明有会话，账号卡却永远
 *      画成未登录」—— 与 test/entitlement.test.js 里那条跨 realm 的坑同源。
 *   3. **最后补一次 DOMContentLoaded**：jsdom 构造时 `readyState` 是
 *      `loading`，页面脚本于是把 `init()` 挂到 DOMContentLoaded 上等 ——
 *      不补这一下，账号卡永远停在 HTML 里那个 `hidden`（测出来是「没渲染」，
 *      而真相只是「还没轮到它跑」）。
 */
function boot(file, url, seed) {
  const src = read(file);
  const sdom = new JSDOM(src, { runScripts: 'dangerously', url: url, base: url });
  const w = sdom.window;
  if (seed) for (const k in seed) { try { w.localStorage.setItem(k, seed[k]); } catch (e) {} }

  ['js/auth-core.js', 'js/entitlement.js'].forEach(f => {
    const el = w.document.createElement('script');
    el.textContent = read(f);
    w.document.body.appendChild(el);
  });
  if (w.Entitlement && w.Entitlement.setAuthCore) w.Entitlement.setAuthCore(w.AuthCore);

  (src.match(/<script src="([^"]+)"><\/script>/g) || [])
    .map(x => x.match(/src="([^"]+)"/)[1])
    .forEach(rel => {
      const el = w.document.createElement('script');
      el.textContent = read(rel.replace(/^\//, ''));
      w.document.body.appendChild(el);
    });

  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  return { window: w, doc: w.document };
}

/**
 * 在**同一份** storage 上建会话（不是两处各写一遍）。
 *
 * ⚠️ 会话键（`poem_auth_v1`）由内核写进它拿到的那个 storage，所以
 *    必须先在这张页自己的 localStorage 上建会话，再让账号卡重画 ——
 *    分两处写会得到「页面里看着有账号、Entitlement 却判成游客」那种
 *    最难查的不一致。这也正是账号卡要读 `Entitlement.identity()`、
 *    而不是自己另判一遍会话的原因。
 */
function signIn(w, email) {
  const A = w.AuthCore;
  const store = A.makeStore(w.localStorage);
  const id = { channel: 'email', value: email };
  const r = A.requestCode(store, id, 'login');
  const v = A.verifyCode(store, r.codeId, r.code, 'login');
  if (!v || !v.ok) throw new Error('测试里的登录没能建立会话：' + JSON.stringify(v));
  return v;
}

/** 让两张设置页的卡按当前盘上状态重画一遍（补一次 DCL 就够） */
function repaint(p) {
  p.doc.dispatchEvent(new p.window.Event('DOMContentLoaded', { bubbles: true }));
}

/* ================= 一、顶栏右端没有头像（Issue #209 第二轮） ================= */
{
  /* 用户 2026-09-17：「所有页面右上角的头像全部删除，这个位置现在有后退键代替」。
     于是这一节从「顶栏那枚印指哪」翻面成「顶栏上不再有那枚印」。
     翻面之后真正要守的是**动线不能断**：那枚印曾经是「未登录的人走到 /login/」
     的第一条路，它撤了之后，那条路必须由「我的」页第一条完整接住
     （见下面第三节）。 */
  chk(!/userAvatarHtml|userHref|__AVATAR_PAGE__/.test(CHROME),
    'chrome.js 不再画顶栏头像，那条 /profile/ 的落点也整件撤掉');
  // ⚠️ 剥注释再判：注释里正讲着「不再有 #top-user」这句沿革。
  chk(!/top-user/.test(strip(CHROME)) && !/avatar-top/.test(strip(CHROME)),
    '顶栏那枚头像相关的类名也从引擎里删干净（不留没人用的渲染分支）');
}

/* ================= 二、个人中心：身份卡里的账号入口 ================= */
{
  chk(/id="btn-account-entry"/.test(SRC.profile),
    '/profile/ 的身份卡里有账号入口（它是账号三页唯一的枢纽）');
  chk(/renderAccountEntry\(id\)/.test(PROFILE_JS),
    '那颗入口的文案由 profile.js 按登录态写（不在 HTML 里写死两处）');
  chk(/location\.href = "\/login\/"/.test(PROFILE_JS),
    '账号入口落在 /login/');
  chk(/id\.signedIn/.test(PROFILE_JS.slice(PROFILE_JS.indexOf('function renderAccountEntry'))),
    '入口文案按 id.signedIn 分两种（不是自己另算一遍登录态）');
  // ⚠️ 不做「到了 /login/ 就把已登录的人弹回来」那种聪明
  chk(!/replace\(\s*"\/profile\//.test(PROFILE_JS) && !/history\.back/.test(PROFILE_JS),
    '个人中心不做「跳回来」的花招（点一下就被弹回去，用户只会以为按钮坏了）');
}

/* ================= 三、「我的」页：第一条是个人中心 =================
   Issue #209（用户 2026-09-17）原话：
     「将右下角设置改成 我的 …… 用户点击我的之后，转到我的页面，
       显示之前四个设置项，包括 通用 背诵 我的清单 朗读，
       把我的清单改成 清单，另外在通用上面加一个 个人中心，
       最下面加一个 关于」

   于是这一节判三件事：
     · 那一行仍与四组入口**同一张清单**（不是另起一处）；
     · 它排在**第一条**（用户点名的位置：「在通用上面」）；
     · 末尾多一条「关于」（只读信息那一块，由 renderAbout 渲染）。 */
{
  chk(!/id="account-entry"/.test(SRC.home),
    '不再有独立的账号卡容器（#account-entry 整块撤了，不留空壳）');
  chk(/settings-nav\.js/.test(SRC.home), '「我的」页加载 js/settings-nav.js（这一页唯一的脚本）');
  chk(/renderAccountEntry/.test(NAV), '账号那一行由 js/settings-nav.js 的 renderAccountEntry 画');
  chk(/renderIndex\(\);\s*\n\s*renderAccountEntry\(\);\s*\n\s*renderAbout\(\);/.test(NAV),
    'init() 三步顺序：renderIndex → renderAccountEntry → renderAbout');
  chk(/insertBefore\(el, box\.firstChild\)/.test(NAV) && /querySelector\("#settings-index"\)/.test(NAV),
    '账号那一行是**插进 #settings-index 这张清单的头一条**（用户点名的位置）');
  chk(/a\.className = "settings-item settings-link"/.test(NAV),
    '与「通用」等四行同一个类名（同一套卡片 / 内边距 / hover / 右箭头）');
  // 入口地址由 JS 给，不在 HTML 里写死（写死就两处各一份）
  chk(!/href="\/login\/"/.test(stripHtml(SRC.home)), '页面 HTML 里不写死 /login/（地址只在 JS 一处）');
  chk(/"\/login\/"/.test(NAV) && /"\/profile\/"/.test(NAV),
    '那一行的两个落点（/login/ 与 /profile/）都在 js/settings-nav.js 里');
}

/* ================= 四、真跑一遍：四种状态下第一条长什么样 ================= */
{
  const URL_HOME = 'https://local.test/settings/';
  /** 「我的」页上「一张清单」里那几行 —— 判「并在一起」，不是判某个选择器在不在 */
  const rowsOf = (p) => [...p.doc.querySelectorAll('#settings-index > .settings-link')];
  const firstRow = (p) => rowsOf(p)[0];

  // ① 全新（未登录）
  let p = boot(SETTINGS_HOME, URL_HOME, {});
  const E = p.window.Entitlement, A = p.window.AuthCore;
  chk(!!E && !!A, '「我的」页上 Entitlement 与 AuthCore 都在（第一条要读它们）');
  let rows = rowsOf(p);
  /* ⚠️ Issue #209 之后这张清单里是**五条**：个人中心 + 四组入口。
     「关于」不是分组入口（它由 renderAbout 渲染成另一块），所以不算在这五条里。 */
  chk(rows.length === 5, '清单里是五条：个人中心 + 四组入口（实际 ' + rows.length + '）');
  chk(!!p.doc.querySelector('#settings-about .kv-list'), '末尾还有「关于」那一块（只读信息 + 法务）');
  chk(p.doc.querySelectorAll('.settings-index').length === 1,
    '全页只有一张清单（不是「一张卡 + 一张清单」两处）');
  /* ⚠️ 判 href 要走 `getAttribute`：`outerHTML` 里那一串是**解析后**的绝对地址
     （jsdom 与浏览器一致），拿 `/login/` 去匹配必然落空。 */
  chk(firstRow(p).id === 'btn-entry-login' &&
    firstRow(p).getAttribute('href') === '/login/',
    '未登录时第一条给的是去 /login/ 的入口（实际 ' + firstRow(p).id + '）');
  chk(firstRow(p).getAttribute('data-group-link') === 'account',
    '第一条标着 data-group-link="account"（它为「我是谁」这一档，不是第五组设置）');
  const out = stripHtml(firstRow(p).outerHTML);
  /* ⚠️ 标题是「个人中心」（不是「登录」）：这一页现在叫「我的」，
     第一条必须回答「我在这台机器上是谁」，而不是把人推到一张登录表单上。
     「去哪儿登录」由 href 表达（点进 /login/ 那一页自己会说）。 */
  chk(/个人中心/.test(out), '第一条的标题是「个人中心」（这一页的主语）');
  chk(!/btn-entry-profile/.test(out), '未登录时那条路指向 /login/，不是 /profile/');
  chk(/Free/.test(out), '未登录也是 Free 徽章（徽章文案由 Entitlement.tierLabel 出，不自己拼）');
  chk(!/登录可用/.test(out), '那一行不出现「登录可用……」这一串理由（Issue #163 已删）');
  chk(!/语音朗读/.test(out), '这一行也不写「差语音朗读」（Issue #209 整句删除）');

  // ② 已登录（free）：给「个人中心」+ 昵称
  // 先在真页上起盘，再建会话，最后重放一遍 DOMContentLoaded 让那行重画
  p = boot(SETTINGS_HOME, URL_HOME, {});
  signIn(p.window, 'belem@example.com');
  repaint(p);
  rows = rowsOf(p);
  chk(rows.length === 5, '已登录时清单仍是五条（第一条换内容，不新增一行）');
  const inn = stripHtml(firstRow(p).outerHTML);
  chk(/btn-entry-profile/.test(inn) &&
    firstRow(p).getAttribute('href') === '/profile/',
    '已登录时第一条给的是去 /profile/ 的「个人中心」（实际 ' + firstRow(p).id + '）');
  chk(!/btn-entry-login/.test(inn),
    '已登录时**不**再摆「去登录」（再摆一次是自相矛盾的）');
  chk(/未起名|belem/.test(inn), '已登录时第一条的主标题是昵称（还没起名时如实写「未起名」）：' +
    stripHtml(firstRow(p).innerHTML));
  chk(!/belem@example\.com/.test(inn), '页面上不出现明文邮箱（掩码之外一个字符都不露）');

  // ③ 层级换了 → 徽章跟着换（判据只在 Entitlement 里，页面不缓存一份）
  const E2 = p.window.Entitlement;
  E2.writeTier(p.window.localStorage, 'max');
  repaint(p);
  const inn2 = stripHtml(firstRow(p).outerHTML);
  const badge = (inn2.match(/tier-badge[^>]*>([^<]*)/) || ['', ''])[1];
  chk(/Max/.test(badge), '层级改成 max 后徽章跟着变（实际「' + badge + '」）');
  chk(/Free/.test(out) && !/Free/.test(inn2), '徽章的取数随盘上层级走，不是页面里写死的');

  // ④ 页面上不出现权益存储键名（判据只在 entitlement.js 里）
  ['poem_plan_v1', 'poem_plan_grant_v1'].forEach(k => {
    chk(strip(NAV).indexOf(k) < 0, 'js/settings-nav.js 不出现权益存储键名 ' + k);
  });
  // ⚠️ 同样要剥注释再判：文件头就写着「没有任何 `plan === 'pro'` 这类判断」
  const navCode = strip(NAV);
  chk(!/plan\s*===/.test(navCode) && !/tier\s*===\s*["']/.test(navCode),
    'js/settings-nav.js 不自己比对 plan / tier（一律走 Entitlement）');
  chk(/E\.identity\(/.test(navCode) && /E\.tierLabel\(/.test(navCode),
    '第一条的登录态与徽章文案都取自 Entitlement');

  /* ⑤ 「关于」那一块（Issue #209：「最下面加一个 关于」）
     它是只读信息 + 两条外链，不是第三条二级页 —— 判的是「就地渲染 + 说得出话」 */
  const about = p.doc.querySelector('#settings-about');
  const aboutText = stripHtml(about ? about.innerHTML : '');
  chk(/跬步/.test(aboutText), '「关于」里写着应用名');
  chk(/\/terms\//.test(aboutText) && /\/privacy\//.test(aboutText),
    '「关于」里有用户协议与隐私条款两条入口');
  chk(/离线/.test(aboutText), '「关于」里有离线缓存那一行（读 Service Worker 的真实状态）');
}

/* ================= 五、返回落点：登录 → 个人中心 → 设置主页 ================= */
{
  chk(/data-back="\/profile\/"/.test(SRC.login),
    '登录页的返回落点是个人中心（登录是身份的事，落回设置页等于又多绕一层）');
  chk(/data-back="\/settings\/"/.test(SRC.profile),
    '个人中心的返回落点仍是设置主页');
  chk(!/data-back="\/settings\/"/.test(SRC.login), '登录页不再退回设置页（两处落点会打架）');
  // 登录成功之后去哪：与返回落点同一条动线
  chk(/location\.href = "\/profile\/"/.test(LOGIN_JS),
    '登录成功后回个人中心（权限那一节就在那里，登录完最该看见的是「我在哪一层」）');
  chk(!/\/settings\/general\//.test(LOGIN_JS), '登录页里不再有回设置 · 通用的老落点');
  // chrome.js 认得这两条路由
  chk(/login: "\/login\/"/.test(CHROME) && /profile: "\/profile\/"/.test(CHROME),
    'js/chrome.js 的 ROUTES 里有 /login/ 与 /profile/');
}

/* ================= 六、收敛：动线不互斥、也不留死路 ================= */
{
  /**
   * 从一个未登录的人出发，必须**至少**有两条独立的路到 /login/：
   *   路一：个人中心那一页 → 身份卡里的账号入口
   *   路二：「我的」页清单里的第一条
   * Issue #209 之后又**少了一条**（顶栏那枚印撤了）—— 所以这两条更不能断：
   * 各自由不同的文件渲染，任一文件漏了，未登录的人就真的没有入口。
   */
  chk(/location\.href = "\/login\/"/.test(PROFILE_JS), '路一：/profile/ → /login/');
  chk(/"\/login\//.test(NAV), '路二：「我的」页清单第一条 → /login/');
  // 死路检查：落点必须都真的存在
  ['login', 'profile', 'admin', 'settings', 'settings/general'].forEach(f => {
    chk(fs.existsSync(path + f + '/index.html'), '落点真的有那张页：/' + f + '/');
  });
  // 登录页自己也要能出去（它不是一站，是一条路）
  chk(/id="top-back"|data-back=/.test(SRC.login) || /top-back/.test(CHROME),
    '登录页有返回键（深页不留底部页签，只能靠顶栏退出）');
  chk(/data-dock="off"/.test(SRC.login) && /data-dock="off"/.test(SRC.profile),
    '登录页与个人中心都不挂底部页签（专心做完一件事，免得误触跳走）');
}

/* ================= 七、登录页的两条路（1A 期：服务端 + 本机回落）=================
   1A 之前这张页只有一个「本机」分支，源码扫描就够。
   现在它有**两条**路，而「走哪条」是运行时才定的 —— 扫描看不见，
   必须起真页面、塞一个假 fetch 跑一遍。

   判的只有一件事：**说明与走向必须一致**。
     · 摆着「本应用没有服务器」而实际在跟服务器说话 —— 说谎
     · 摆着「进度会上传到服务器」而其实全在本机 —— 也说谎
   两条都发生过（本机版是上一轮，服务端版是这一轮新加的），所以两条都守。
   ========================================================================= */
{
  const fsMod = require('fs');
  const pathMod = require('path');
  const ROOT = pathMod.join(__dirname, '..');

  const boot = (fetchImpl) => {
    const d = new JSDOM(read('login/index.html'),
      { url: 'https://local.test/login/', runScripts: 'outside-only', pretendToBeVisual: true });
    const W = d.window;
    if (fetchImpl) W.fetch = fetchImpl;
    ['js/auth-core.js', 'js/auth-api.js', 'js/entitlement.js', 'js/avatar.js', 'js/login.js']
      .forEach(f => W.eval(fsMod.readFileSync(pathMod.join(ROOT, f), 'utf8')));
    // jsdom 构造时 readyState 是 loading，page 脚本把 init 挂在 DOMContentLoaded 上等
    W.document.dispatchEvent(new W.Event('DOMContentLoaded'));
    return W;
  };
  const send = (W, email) => {
    W.document.getElementById('input-email').value = email || 'a@b.com';
    W.document.getElementById('btn-send').click();
    return new Promise(r => setTimeout(r, 60)).then(() => W.document);
  };

  const W1 = boot(async (u) => u.endsWith('/send-code')
    ? { status: 202, text: async () => JSON.stringify({ codeId: 'c_1', expiresAt: Date.now() + 6e5, cooldown: 60, transport: 'sendgrid', delivered: true, store: 'supabase' }) }
    : { status: 404, text: async () => '{}' });
  const W2 = boot(async () => ({ status: 503, text: async () => '{"code":"E_NOT_CONFIGURED"}' }));
  const W3 = boot(async () => { throw new Error('boom'); });
  const W4 = boot(null);
  const W5 = boot(async () => ({
    status: 429, text: async () => '{"code":"E_RATE_EMAIL","retryAfter":42,"message":"发得太快了，请稍后再试"}'
  }));

  Promise.all([send(W1), send(W2), send(W3), send(W4), send(W5)]).then(([d1, d2, d3, d4, d5]) => {
    const n = d => ({
      local: d.getElementById('local-note').hidden,
      remote: d.getElementById('remote-note').hidden,
      tools: d.getElementById('code-tools').hidden
    });

    chk(n(d1).remote === false && n(d1).local === true,
      '服务端可用：只摆「进度会保存到服务器」，不摆「本应用没有服务器」');
    chk(n(d1).tools === true, '服务端可用：收起「复制随机码 / 自己发信」（码在用户邮箱里）');
    chk(/已发往/.test(d1.getElementById('code-sent-to').textContent),
      '服务端可用：文案是「已发往 a***@b.com」');

    [['503 没配好', d2], ['网络异常', d3], ['没有 fetch', d4]].forEach(([label, d]) => {
      chk(n(d).local === false && n(d).remote === true,
        label + '：回落本机，如实摆「本应用没有服务器」（不许假装走了服务端）');
      chk(n(d).tools === false, label + '：露出「复制随机码」（本机版的码只能用户自己保管）');
      chk(/随机码已生成/.test(d.getElementById('code-sent-to').textContent),
        label + '：文案是「已生成」而不是「已发送」');
      chk(d.getElementById('step-code').hidden === false, label + '：仍进填码屏（不打断用户）');
    });

    chk(n(d5).local === true && n(d5).remote === true,
      '服务端明确回绝（429）时两块说明都收起来 —— 这一屏还没决定走哪条路');
    chk(d5.getElementById('step-code').hidden === true, '429 时不进填码屏');
    chk(/太快/.test(d5.getElementById('msg-email').textContent), '429 如实回显服务端的话');

    /* 源码层：两条路的**判据只能有一处**。
       各处分别写 `if (api)` 的后果是「服务端先成功、后失败」时两处不一致，
       而那种 bug 只在网络抖动时出现，肉眼测不出来。 */
    chk(/function isLocal\(\)/.test(LOGIN_JS), '登录页把「走哪条路」收在一个判据函数里');
    chk(/AuthApi/.test(LOGIN_JS) && /auth-api\.js/.test(read('login/index.html')),
      '登录页加载了 js/auth-api.js（通道）');
    // 传输层必须在登录页脚本之前 —— 加载顺序错了，window.AuthApi 就是 undefined
    const html = read('login/index.html');
    chk(html.indexOf('/js/auth-api.js') > 0 &&
      html.indexOf('/js/auth-api.js') < html.indexOf('/js/login.js'),
      'js/auth-api.js 排在 js/login.js 之前（顺序错了通道就是 undefined）');
    chk(/state\.remote/.test(LOGIN_JS),
      '校验那一步按「这次发码走的是哪条路」判（不是按 degraded()）');

    console.log('\n' + (fails ? '❌ ' + fails + ' 项失败' : '🎉 账号入口动线测试全部通过'));
    process.exit(fails ? 1 : 0);
  }).catch(e => {
    console.log('✗ 登录页两条路断言自身抛异常：' + e.message);
    process.exit(1);
  });
}

/* ================= 八、离线与文档 ================= */
{
  chk(/\.\/settings\//.test(SW) && /\.\/js\/settings-nav\.js/.test(SW),
    '设置主页与 js/settings-nav.js 都在预缓存清单里');
  const ver = parseInt((SW.match(/poem-app-v(\d+)/) || [0, '0'])[1], 10);
  chk(ver >= 143, '缓存版本跟着提（本轮改了 3 份 js + css，实际 v' + ver + '）');
  const design = read('docs/auth-design.md');
  chk(/账号入口|入口动线/.test(design),
    'docs/auth-design.md 里记了账号入口的动线（D 这一步）');
  const readme = read('README.md');
  chk(/账号入口|用邮箱登录|个人中心/.test(readme), 'README 里能查到账号入口在哪');
}

