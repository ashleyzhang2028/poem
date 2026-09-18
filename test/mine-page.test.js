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
  chk(/class="foot settings-foot"/.test(MINE), '有页脚（版权 + 法务链接）');

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
  ['btn-avatar-pick', 'avatar-file', 'btn-avatar-clear', 'crop-layer',
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

  const nickRule = (strip(css).match(/\.nickname-input\s*\{[^}]*\}/) || [''])[0];
  chk(/border:\s*none/.test(nickRule) || /border:\s*0/.test(nickRule),
    '用户名输入框不画边框（用户 2026-09-18：不显示输入框的 border 样式和颜色）');
  chk(/background:\s*none/.test(nickRule),
    '用户名输入框不铺底色（无边框就该是一行字，不是一个盒子）');
  chk(/\bwidth:\s*\d[\d.]*em/.test(nickRule),
    '用户名输入框的宽度用 em 收窄（短，不占满一整行；实际「' +
    ((nickRule.match(/width:[^;]+/) || [''])[0]) + '」）');
  chk(!/(^|[;{\s])width:\s*100%/.test(nickRule),
    '用户名输入框不再占满一整行（用户 2026-09-18 点名的那个错）');
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
  chk(/id="btn-account-entry"/.test(MINE) && /id="btn-sign-out"/.test(MINE),
    '账号入口 / 退出两颗键都在（它们长在「账号」卡上，不在首卡里）');
  chk(!/id="btn-go-plans"/.test(MINE),
    '首卡里不再有「层级对比」那颗键（用户 2026-09-18：从这里移出，改成设置「关于」里的一行链接）');
  chk(!/btn-go-plans/.test(strip(MINE_JS)), 'js/mine.js 里也不再有它的接线');
  chk(!/id="link-plans"/.test(MINE) && !/id="upsell-row"/.test(MINE),
    '「我的」页不再有权限 / 层级对比那张卡（用户 2026-09-18：删除 我的页面的权限对比的卡片）');
  chk(!/link-plans/.test(strip(MINE_JS)) && !/upsell-row/.test(strip(MINE_JS)),
    'js/mine.js 里也不再有那条入口的接线（卡撤了，接线一并撤）');
  chk(!/location\.href = "\/plans\/"/.test(strip(MINE_JS)),
    '「我的」页一个字都不提 /plans/（那一页的入口只在设置「关于」里）');
  chk(/id\.signedIn/.test(MINE_JS), '账号入口的文案按 id.signedIn 分两种（不自己另算一遍登录态）');
  chk(/\?\s*"管理登录状态"\s*:\s*"登录"/.test(MINE_JS) || /"登录"\s*:\s*"管理登录状态"/.test(MINE_JS),
    '未登录「登录」/ 已登录「管理登录状态」（实际就是这两句）');
  chk(/location\.href = "\/login\/"/.test(MINE_JS), '账号入口落在 /login/');

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
  chk(/data-back="\/mine\/"/.test(read('profile/index.html')), '个人中心的返回键回「我的」页');
  chk(!/data-back="\/settings\/"/.test(read('profile/index.html')),
    '个人中心不再退回设置整页（两处落点会打架）');

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
  chk(d0.getElementById('btn-sign-out').hidden, '（真页面）未登录时不摆「退出登录」');
  chk(d0.getElementById('btn-account-entry').closest('.account-card')
        !== d0.getElementById('identity-row').closest('.account-card'),
    '（真页面）登录那颗键已从首卡移出（用户 2026-09-18：与权限对比一起移出这张卡）');
  chk(d0.getElementById('danger-card').hidden, '（真页面）未登录时不摆注销卡（没有账号可注销）');
  chk(d0.getElementById('btn-avatar-clear').hidden,
    '（真页面）没图时「删除头像」不出现（摆一颗点了没反应的灰键更糟）');
  chk(/还没有/.test(d0.getElementById('stats-list').textContent),
    '（真页面）本机数据如实写「还没有」');
  chk(!!d0.getElementById('family-panel'), '（真页面）子用户那一块画出来了');
  chk(!d0.getElementById('btn-family-add'),
    '（真页面）Free 只剩 0 个名额时**不摆**「再建一个」（摆一颗点不动的键没有意义）');
  chk(/当前 1 \/ 1 个/.test(d0.getElementById('family-hint').textContent) &&
      /Pro 用户可建 3 个/.test(d0.getElementById('family-hint').textContent) &&
      /Max 用户可建 180 个/.test(d0.getElementById('family-hint').textContent),
    '（真页面）上限那一行如实写出各层的名额（实际「' +
    d0.getElementById('family-hint').textContent + '」）');

  const order0 = [...d0.querySelectorAll('#mine-page > section')].map(s => s.id);
  chk(order0.indexOf('family-item') >= 0 && order0.indexOf('family-item') < order0.indexOf('stats-card'),
    '（真页面）子用户卡在本机数据卡**上方**（实际 ' + order0.join(' → ') + '）');
  chk(order0.indexOf('upsell-row') < 0,
    '（真页面）权限 / 层级对比那张卡整张撤了（实际 ' + order0.join(' → ') + '）');
  chk(order0.indexOf('danger-card') === order0.length - 1,
    '（真页面）注销仍是最下面那张卡');
  const admin = d0.getElementById('btn-go-admin');
  chk(!!admin && admin.closest('#mine-page') && !admin.closest('.account-card'),
    '（真页面）管理后台那颗键整张卡都在外面（用户 2026-09-18：从「关于」卡挪出，放到最下面）');

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

  // 头像：本机有图且还没传上服务器 → 「未同步」
  const w2 = boot({
    poem_avatar_local_v1: JSON.stringify({ v: 1, img: 'data:image/png;base64,iVBORw0KGgo=' })
  });
  await new Promise(r => setTimeout(r, 300));
  const d2 = w2.document;
  chk(d2.getElementById('avatar-hint').textContent === '未同步',
    '（真页面）本机有图、服务器上还没有时写「未同步」（用户 2026-09-18 点名的那句，' +
    '原先写「已存在本机，还没同步到服务器」，实际「' +
    d2.getElementById('avatar-hint').textContent + '」）');
  chk(!/已存在本机/.test(d2.getElementById('mine-page').textContent),
    '（真页面）页面上不再出现「已存在本机」那句长文案');

  console.log('\n' + (fails ? '❌ ' + fails + ' 项失败' : '🎉 「我的」页测试全部通过'));
  process.exit(fails ? 1 : 0);
})().catch(e => {
  console.log('✗ 测试自身抛异常：' + (e && e.stack || e));
  process.exit(1);
});
