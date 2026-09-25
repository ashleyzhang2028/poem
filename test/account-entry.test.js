const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = __dirname + '/../';
const read = f => fs.readFileSync(path + f, 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const stripHtml = t => t.replace(/<!--[\s\S]*?-->/g, ' ');

// ⚠️ 原先这一档还读 `profile/index.html` 与 `js/profile.js`（个人中心）。
//    2026-09-20（Issue #244）那一页已删除 —— 它承担的账号入口动线
//    现在由「我的」页那一条独家承担，断言的落点也跟着换成 js/mine.js。
const SETTINGS_HOME = 'settings/index.html';
const MINE_HOME = 'mine/index.html';
const LOGIN = 'login/index.html';

const SRC = {
  home: read(SETTINGS_HOME),
  mine: read(MINE_HOME),
  login: read(LOGIN)
};
const NAV = read('js/settings-nav.js');
const MINE_JS = read('js/mine.js');
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
  chk(!/profile/.test(CHROME),
    'chrome.js 里连 profile 这个键名都没有了（个人中心那一页已删除，整条撤干净）');

  chk(!/top-user/.test(strip(CHROME)) && !/avatar-top/.test(strip(CHROME)),
    '顶栏那枚头像相关的类名也从引擎里删干净（不留没人用的渲染分支）');
}

{
  // ⚠️ Issue #276 第八轮：「登录 / 退出」并成一颗键之后，它由 js/mine.js
  //    画在**身份行**里（HTML 里没有静态标记了）；账号卡里那颗改叫
  //    「账号与安全」（#btn-account-open，去 /login/ 看「我是谁」）。
  //    两处的 id 都在 SRC.mine 上点名，判据按脚本画出来那一份。
  chk(/"btn-account-entry"/.test(MINE_JS) && /btn-account-open/.test(SRC.mine),
    '「我的」页有两颗账号相关的键：身份行那颗（登录/退出）+ 账号卡那颗（账号与安全）');
  chk(/id\.signedIn/.test(MINE_JS),
    '那颗入口的文案由 js/mine.js 按登录态写（不在 HTML 里写死两处）');
  chk(/location\.href = "\/login\/"/.test(MINE_JS),
    '未登录那一态落在 /login/');
  chk(/id\.signedIn/.test(MINE_JS.slice(MINE_JS.indexOf('function renderSignOut'))),
    '入口文案按 id.signedIn 分两种（不是自己另算一遍登录态）');

  chk(!/history\.back/.test(MINE_JS),
    '「我的」页不做「跳回来」的花招（点一下就被弹回去，用户只会以为按钮坏了）');
}

{
  chk(!/id="account-entry"/.test(SRC.home),
    '不再有独立的账号卡容器（#account-entry 整块撤了，不留空壳）');
  chk(/settings-nav\.js/.test(SRC.home), '设置整页加载 js/settings-nav.js（四组入口的唯一来源）');
  chk(!/renderAccountEntry/.test(NAV) && !/"\/login\/"/.test(NAV),
    '设置整页不再画账号那一行（「我是谁」归「我的」页，不归设置清单）');
  chk(/renderIndex\(\);\s*\n\s*renderAbout\(\);/.test(NAV),
    'init() 两步顺序：renderIndex → renderAbout');

  chk(/mine\.js/.test(SRC.mine), '「我的」页加载 js/mine.js（账号那一行的唯一来源）');
  chk(/renderSignOut/.test(MINE_JS) && /"btn-account-entry"/.test(MINE_JS),
    '那颗键由 js/mine.js 的 renderSignOut 画（登录态那两态只有这一个来源）');
  chk(!/href="\/login\/"/.test(stripHtml(SRC.mine)), '页面 HTML 里不写死 /login/（地址只在 JS 一处）');
  chk(/"\/login\/"/.test(MINE_JS), '账号入口的落点（/login/）写在 js/mine.js 里');
}

{
  const URL_MINE = 'https://local.test/mine/';

  const entryBtn = (p) => p.doc.getElementById('btn-account-entry');
  const actionsRow = (p) => p.doc.getElementById('account-actions');
  const shownIds = (p) => [...actionsRow(p).querySelectorAll('button')]
    .filter(b => !b.hidden).map(b => b.id);

  let p = boot(MINE_HOME, URL_MINE, {});
  const E = p.window.Entitlement, A = p.window.AuthCore;
  chk(!!E && !!A, '「我的」页上 Entitlement 与 AuthCore 都在（那颗入口要读它们）');
  chk(!!entryBtn(p), '账号那一行的入口就在「我的」页上（#btn-account-entry）');

  chk(E.tierLabel(E.identity({ backing: p.window.localStorage }).tier) === 'Free',
    '未登录也是 Free 徽章（文案由 Entitlement.tierLabel 出，不自己拼）');

  chk(entryBtn(p).textContent === '登录',
    '未登录时那颗键上只有一个词：登录（实际「' + entryBtn(p).textContent + '」）');
  chk(shownIds(p).join(',') === 'btn-account-entry',
    '未登录时那一行里只剩「登录」一颗（实际 ' + shownIds(p).join(',') + '）');
  chk(!/btn-go-plans/.test(SRC.mine) && !/btn-go-plans/.test(MINE_JS),
    '「用户对比」那颗键整颗撤了（用户 2026-09-18：从这里移出，' +
    '改成设置「关于」里的一行链接）');
  chk(!/link-plans/.test(SRC.mine) && !/link-plans/.test(MINE_JS),
    '「用户对比」那张卡也整张撤了（用户 2026-09-18：删除 我的页面的权限对比的卡片）');

  // 用户 2026-09-18：这一页去进度页的那个入口叫「背诵进度」（原先「背诵进度总览」），
  // 而且它是一行链接（一行字，不是一颗键）—— 「去别处看」不必画成按钮。
  chk(/id="link-progress"/.test(SRC.mine) && /href="\/progress\/"/.test(SRC.mine),
    '「本机数据」卡里那条入口仍在（落在 /progress/）');
  chk(/>背诵进度</.test(SRC.mine) && !/背诵进度总览/.test(SRC.mine),
    '它在页面上的名字就是「背诵进度」（用户 2026-09-18 点名改，实际「' +
    (SRC.mine.match(/>([^<]*背诵进度[^<]*)</) || ['', ''])[1] + '」）');
  chk(/<a[^>]*id="link-progress"/.test(SRC.mine) && !/<button[^>]*id="link-progress"/.test(SRC.mine),
    '它是链接（<a>），不是按钮（用户 2026-09-18：这个按钮改成链接）');
  chk(!/class="btn[^"]*"[^>]*id="link-progress"/.test(SRC.mine) &&
      !/id="link-progress"[^>]*class="btn/.test(SRC.mine),
    '它不再挂着按钮那套 class（挂了就还是画出来一颗键）');

  const identityText = stripHtml(p.doc.getElementById('identity-row').outerHTML);
  chk(!/未起名/.test(identityText), '身份行不再重复写昵称（它就在旁边的输入框里）');
  chk(/游客/.test(identityText) && !/本机游客/.test(identityText),
    '未登录时只写「游客」（用户 2026-09-18 点名的那个词）');
  chk(!/语音朗读/.test(identityText), '这一行不写「差语音朗读」（Issue #209 整句删除）');

  p = boot(MINE_HOME, URL_MINE, {});
  signIn(p.window, 'belem@example.com');
  repaint(p);

  // ⚠️ Issue #276 第八轮：用户问「登录按钮和退出登录按钮应该同时显示吗？
  //    他们应该是一个按钮两个状态吧？」—— 是。旧实现里已登录那颗叫「账号」、
  //    旁边另有一颗「退出登录」，两颗并存；现在**一颗键两个状态**：
  //    未登录「登录」、已登录「退出登录」。
  chk(entryBtn(p).textContent === '退出登录',
    '已登录时那颗键换成「退出登录」（实际「' + entryBtn(p).textContent + '」）');
  chk(shownIds(p).join(',') === 'btn-account-entry',
    '已登录时那一格上也只有**一颗**键（实际 ' + shownIds(p).join(',') + '）');
  const innText = stripHtml(p.doc.getElementById('identity-row').outerHTML);
  chk(/游客|已登录/.test(innText), '已登录时身份行仍写着登录态那一句');
  chk(!/belem@example\.com/.test(innText), '页面上不出现明文邮箱（掩码之外一个字符都不露）');
  chk(/已登录 · b\*\*\*/.test(innText), '已登录时如实写掩码（实际「' +
    (innText.match(/已登录[^<]*/) || [''])[0] + '」）');

  const E2 = p.window.Entitlement;
  E2.writeTier(p.window.localStorage, 'max');
  repaint(p);
  const badge = stripHtml(p.doc.getElementById('identity-row').outerHTML)
    .match(/tier-badge[^>]*>([^<]*)/);
  const badgeText = badge ? badge[1] : (stripHtml(p.doc.getElementById('identity-row').innerHTML)
    .match(/(Max|Pro|Free)/) || [''])[0];
  chk(/Max/.test(badgeText), '层级改成 max 后徽章跟着变（实际「' + badgeText + '」）');

  ['poem_plan_v1', 'poem_plan_grant_v1'].forEach(k => {
    chk(strip(NAV).indexOf(k) < 0, 'js/settings-nav.js 不出现权益存储键名 ' + k);
  });

  const mineCode = strip(MINE_JS);
  chk(!/plan\s*===/.test(mineCode) && !/tier\s*===\s*["']/.test(mineCode),
    'js/mine.js 不自己比对 plan / tier（一律走 Entitlement）');
  chk(/Ent\.tierLabel\(/.test(mineCode), '那一行的徽章文案取自 Entitlement.tierLabel()');

  const about = boot(SETTINGS_HOME, 'https://local.test/settings/', {}).doc.querySelector('#settings-about');
  const aboutText = stripHtml(about ? about.innerHTML : '');
  chk(/跬步/.test(aboutText), '「关于」里写着应用名（在设置整页上）');
  chk(/\/terms\//.test(aboutText) && /\/privacy\//.test(aboutText),
    '「关于」里有用户协议与隐私条款两条入口');
  chk(/离线/.test(aboutText), '「关于」里有离线缓存那一行（读 Service Worker 的真实状态）');
}

{
  chk(/data-back="\/mine\/"/.test(SRC.login),
    '登录页的返回落点是「我的」页（登录是身份的事，落回设置页等于又多绕一层）');
  chk(!/data-back="\/settings\/"/.test(SRC.login), '登录页不再退回设置页（两处落点会打架）');

  chk(/location\.href = nextUrl\(\) \|\| "\/mine\/"/.test(LOGIN_JS),
    '登录成功后回「我的」页（层级徽章就在那里，登录完最该看见的是「我在哪一层」）');
  chk(/\?next=/.test(read('js/print.js')),
    '从别的页面被送来登录的，登录完回原来那一页（?next= 只认站内路径，Issue #229）');
  chk(/raw\.charAt\(0\) !== "\/"/.test(LOGIN_JS) && /raw\.charAt\(1\) === "\/"/.test(LOGIN_JS),
    'next 只收本站路径：/ 开头、第二个字符不是 /（不当开放跳板）');
  chk(!/\/settings\/general\//.test(LOGIN_JS), '登录页里不再有回设置 · 通用的老落点');

  chk(/login: "\/login\/"/.test(CHROME) && /mine: "\/mine\/"/.test(CHROME),
    'js/chrome.js 的 ROUTES 里有 /login/ 与 /mine/（/profile/ 那条已随页面删除）');
}

{

  chk(/"\/login\//.test(MINE_JS), '路一：「我的」页那颗账号入口 → /login/');

  ['login', 'admin', 'settings', 'settings/general', 'mine'].forEach(f => {
    chk(fs.existsSync(path + f + '/index.html'), '落点真的有那张页：/' + f + '/');
  });
  chk(!fs.existsSync(path + 'profile/index.html'),
    '/profile/ 那一页不在（2026-09-20 Issue #244 已删，删干净不是留个空目录）');

  chk(/id="top-back"|data-back=/.test(SRC.login) || /top-back/.test(CHROME),
    '登录页有返回键（深页不留底部页签，只能靠顶栏退出）');
  chk(/data-dock="off"/.test(SRC.login) && /data-dock="off"/.test(read('admin/index.html')),
    '登录页与管理后台都不挂底部页签（专心做完一件事，免得误触跳走）');
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
    '设置整页与 js/settings-nav.js 都在预缓存清单里');
  chk(/\.\/mine\//.test(SW) && /\.\/js\/mine\.js/.test(SW),
    '「我的」页与 js/mine.js 都在预缓存清单里（断网也进得去）');
  const ver = parseInt((SW.match(/poem-app-v(\d+)/) || [0, '0'])[1], 10);
  chk(ver >= 194, '缓存版本跟着提（本轮改了多份 js + css + 页面文案，实际 v' + ver + '）');
  const design = read('docs/auth-design.md');
  chk(/账号入口|入口动线/.test(design),
    'docs/auth-design.md 里记了账号入口的动线（D 这一步）');
  const readme = read('README.md');
  chk(/账号入口|用邮箱登录|个人中心/.test(readme), 'README 里能查到账号入口在哪');
}
