const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = __dirname + '/../';
const read = f => fs.readFileSync(path + f, 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

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

function signIn(w, email) {
  const A = w.AuthCore;
  const store = A.makeStore(w.localStorage);
  const id = { channel: 'email', value: email };
  const r = A.requestCode(store, id, 'login');
  const v = A.verifyCode(store, r.codeId, r.code, 'login');
  if (!v || !v.ok) throw new Error('测试里的登录没能建立会话：' + JSON.stringify(v));
  return v;
}

function repaint(p) {
  p.doc.dispatchEvent(new p.window.Event('DOMContentLoaded', { bubbles: true }));
}

{

  chk(!/userAvatarHtml|userHref|__AVATAR_PAGE__/.test(CHROME),
    'chrome.js 不再画顶栏头像，那条 /profile/ 的落点也整件撤掉');

  chk(!/top-user/.test(strip(CHROME)) && !/avatar-top/.test(strip(CHROME)),
    '顶栏那枚头像相关的类名也从引擎里删干净（不留没人用的渲染分支）');
}

{
  chk(/id="btn-account-entry"/.test(SRC.profile),
    '/profile/ 的身份卡里有账号入口（它是账号三页唯一的枢纽）');
  chk(/renderAccountEntry\(id\)/.test(PROFILE_JS),
    '那颗入口的文案由 profile.js 按登录态写（不在 HTML 里写死两处）');
  chk(/location\.href = "\/login\/"/.test(PROFILE_JS),
    '账号入口落在 /login/');
  chk(/id\.signedIn/.test(PROFILE_JS.slice(PROFILE_JS.indexOf('function renderAccountEntry'))),
    '入口文案按 id.signedIn 分两种（不是自己另算一遍登录态）');

  chk(!/replace\(\s*"\/profile\//.test(PROFILE_JS) && !/history\.back/.test(PROFILE_JS),
    '个人中心不做「跳回来」的花招（点一下就被弹回去，用户只会以为按钮坏了）');
}

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

  chk(!/href="\/login\/"/.test(stripHtml(SRC.home)), '页面 HTML 里不写死 /login/（地址只在 JS 一处）');
  chk(/"\/login\/"/.test(NAV) && /"\/profile\/"/.test(NAV),
    '那一行的两个落点（/login/ 与 /profile/）都在 js/settings-nav.js 里');
}

{
  const URL_HOME = 'https://local.test/settings/';

  const rowsOf = (p) => [...p.doc.querySelectorAll('#settings-index > .settings-link')];
  const firstRow = (p) => rowsOf(p)[0];

  let p = boot(SETTINGS_HOME, URL_HOME, {});
  const E = p.window.Entitlement, A = p.window.AuthCore;
  chk(!!E && !!A, '「我的」页上 Entitlement 与 AuthCore 都在（第一条要读它们）');
  let rows = rowsOf(p);

  chk(rows.length === 5, '清单里是五条：个人中心 + 四组入口（实际 ' + rows.length + '）');
  chk(!!p.doc.querySelector('#settings-about .kv-list'), '末尾还有「关于」那一块（只读信息 + 法务）');
  chk(p.doc.querySelectorAll('.settings-index').length === 1,
    '全页只有一张清单（不是「一张卡 + 一张清单」两处）');

  chk(firstRow(p).id === 'btn-entry-login' &&
    firstRow(p).getAttribute('href') === '/login/',
    '未登录时第一条给的是去 /login/ 的入口（实际 ' + firstRow(p).id + '）');
  chk(firstRow(p).getAttribute('data-group-link') === 'account',
    '第一条标着 data-group-link="account"（它为「我是谁」这一档，不是第五组设置）');
  const out = stripHtml(firstRow(p).outerHTML);

  chk(/个人中心/.test(out), '第一条的标题是「个人中心」（这一页的主语）');
  chk(!/btn-entry-profile/.test(out), '未登录时那条路指向 /login/，不是 /profile/');
  chk(/Free/.test(out), '未登录也是 Free 徽章（徽章文案由 Entitlement.tierLabel 出，不自己拼）');
  chk(!/登录可用/.test(out), '那一行不出现「登录可用……」这一串理由（Issue #163 已删）');
  chk(!/语音朗读/.test(out), '这一行也不写「差语音朗读」（Issue #209 整句删除）');

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

  const E2 = p.window.Entitlement;
  E2.writeTier(p.window.localStorage, 'max');
  repaint(p);
  const inn2 = stripHtml(firstRow(p).outerHTML);
  const badge = (inn2.match(/tier-badge[^>]*>([^<]*)/) || ['', ''])[1];
  chk(/Max/.test(badge), '层级改成 max 后徽章跟着变（实际「' + badge + '」）');
  chk(/Free/.test(out) && !/Free/.test(inn2), '徽章的取数随盘上层级走，不是页面里写死的');

  ['poem_plan_v1', 'poem_plan_grant_v1'].forEach(k => {
    chk(strip(NAV).indexOf(k) < 0, 'js/settings-nav.js 不出现权益存储键名 ' + k);
  });

  const navCode = strip(NAV);
  chk(!/plan\s*===/.test(navCode) && !/tier\s*===\s*["']/.test(navCode),
    'js/settings-nav.js 不自己比对 plan / tier（一律走 Entitlement）');
  chk(/E\.identity\(/.test(navCode) && /E\.tierLabel\(/.test(navCode),
    '第一条的登录态与徽章文案都取自 Entitlement');

  const about = p.doc.querySelector('#settings-about');
  const aboutText = stripHtml(about ? about.innerHTML : '');
  chk(/跬步/.test(aboutText), '「关于」里写着应用名');
  chk(/\/terms\//.test(aboutText) && /\/privacy\//.test(aboutText),
    '「关于」里有用户协议与隐私条款两条入口');
  chk(/离线/.test(aboutText), '「关于」里有离线缓存那一行（读 Service Worker 的真实状态）');
}

{
  chk(/data-back="\/profile\/"/.test(SRC.login),
    '登录页的返回落点是个人中心（登录是身份的事，落回设置页等于又多绕一层）');
  chk(/data-back="\/settings\/"/.test(SRC.profile),
    '个人中心的返回落点仍是设置主页');
  chk(!/data-back="\/settings\/"/.test(SRC.login), '登录页不再退回设置页（两处落点会打架）');

  chk(/location\.href = "\/profile\/"/.test(LOGIN_JS),
    '登录成功后回个人中心（权限那一节就在那里，登录完最该看见的是「我在哪一层」）');
  chk(!/\/settings\/general\//.test(LOGIN_JS), '登录页里不再有回设置 · 通用的老落点');

  chk(/login: "\/login\/"/.test(CHROME) && /profile: "\/profile\/"/.test(CHROME),
    'js/chrome.js 的 ROUTES 里有 /login/ 与 /profile/');
}

{

  chk(/location\.href = "\/login\/"/.test(PROFILE_JS), '路一：/profile/ → /login/');
  chk(/"\/login\//.test(NAV), '路二：「我的」页清单第一条 → /login/');

  ['login', 'profile', 'admin', 'settings', 'settings/general'].forEach(f => {
    chk(fs.existsSync(path + f + '/index.html'), '落点真的有那张页：/' + f + '/');
  });

  chk(/id="top-back"|data-back=/.test(SRC.login) || /top-back/.test(CHROME),
    '登录页有返回键（深页不留底部页签，只能靠顶栏退出）');
  chk(/data-dock="off"/.test(SRC.login) && /data-dock="off"/.test(SRC.profile),
    '登录页与个人中心都不挂底部页签（专心做完一件事，免得误触跳走）');
}

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

    chk(/function isLocal\(\)/.test(LOGIN_JS), '登录页把「走哪条路」收在一个判据函数里');
    chk(/AuthApi/.test(LOGIN_JS) && /auth-api\.js/.test(read('login/index.html')),
      '登录页加载了 js/auth-api.js（通道）');

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
