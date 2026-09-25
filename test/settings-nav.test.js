const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = __dirname + '/../';
const read = f => fs.readFileSync(path + f, 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const PAGES = {
  index: 'settings/index.html',
  general: 'settings/general/index.html',
  recite: 'settings/recite/index.html',
  lists: 'settings/lists/index.html',
  reader: 'settings/reader/index.html'
};
const SRC = {};
Object.keys(PAGES).forEach(k => { SRC[k] = read(PAGES[k]); });
const NAV = read('js/settings-nav.js');

{
  const groups = [...NAV.matchAll(/key:\s*"([a-z]+)",\s*\n\s*href:\s*"([^"]+)",\s*\n\s*title:\s*"([^"]+)"/g)]
    .map(m => ({ key: m[1], href: m[2], title: m[3] }));
  chk(groups.length === 4, 'js/settings-nav.js 声明四个二级页（实际 ' + groups.length + '）');
  chk(groups.map(g => g.key).join(',') === 'general,recite,lists,reader',
    '四个二级页的 key 稳定：' + groups.map(g => g.key).join(','));
  chk(groups.every(g => /^\/settings\/[a-z]+\/$/.test(g.href)),
    '入口地址一律目录化（/settings/xxx/，不带 .html）');
  chk(groups.every(g => /^\/settings\/[a-z]+\/$/.test(g.href) && !/index\.html/.test(g.href)),
    '入口里不出现 index.html（老地址仍可用，但界面不给）');

  groups.forEach(g => {
    const f = g.href.replace(/^\/settings\//, 'settings/').replace(/\/$/, '');
    chk(fs.existsSync(path + (f === 'settings' ? '' : f) + '/index.html'),
      '入口 ' + g.href + ' 对应的页面文件存在');
  });

  chk(/renderIndex\(\)/.test(NAV) && /#settings-index/.test(NAV),
    '入口清单由 js/settings-nav.js 按数据渲染进 #settings-index');
  chk(/settings-index/.test(SRC.index), '主页有一块空的入口清单容器（不在 HTML 里手写分组）');
  chk(!/href="\/settings\/(general|recite|lists|reader)\/"/.test(SRC.index),
    '主页 HTML 里不写死入口地址（避免两处各写一份，加一组漏一页）');
  chk(/settings-nav\.js/.test(SRC.index), '主页加载 js/settings-nav.js');

  chk(!/id="account-entry"/.test(SRC.index),
    '主页不再有独立的账号卡容器（那一行已在清单里）');

  ['#input-username', '#family-panel'].forEach(sel => {
    const id = sel.replace(/^#/, '');
    const hit = Object.keys(PAGES).filter(k => new RegExp('id="' + id + '"').test(SRC[k]));
    chk(hit.length === 0,
      '控件 ' + sel + ' 已不在设置那几张页上（用户名与子用户都是「我是谁」，' +
      '归「我的」页 /mine/；实际：' + (hit.join(',') || '哪一页都没有') + '）');
  });

  chk(!/renderAccountEntry/.test(NAV) && !/"\/login\/"/.test(NAV),
    '设置整页不再画账号那一行（它是「我是谁」，归「我的」页 /mine/）');
  chk(/renderIndex\(\);\s*\n\s*renderAbout\(\);/.test(NAV),
    '两步顺序：renderIndex → renderAbout（反了就被清单重画抹掉）');
}

{
  const OWNER = {

    // ⚠️ 原先这里还有 #account-panel（账号那一块）—— 用户 2026-09-21
    //    「哪些应该放到我的却放到了设置」：账号与跨设备同步都收回「我的」页，
    //    #account-panel 与 #toggle-sync 在设置这一侧一个都不剩。
    general: ['#btn-export', '#btn-import', '#btn-reset'],
    recite: ['#seg-stage', '#grade-chips', '#seg-term', '#seg-scope', '#seg-count', '#seg-algo'],
    lists: ['#collections-list', '#btn-collections-import', '#collections-tip'],
    reader: ['#seg-helper', '#seg-play']
  };
  Object.keys(OWNER).forEach(owner => {
    OWNER[owner].forEach(sel => {
      const id = sel.replace(/^#/, '');
      const pagesWithIt = Object.keys(PAGES).filter(k => new RegExp('id="' + id + '"').test(SRC[k]));
      chk(pagesWithIt.length === 1 && pagesWithIt[0] === owner,
        '控件 ' + sel + ' 只在「' + owner + '」页（实际：' + (pagesWithIt.join(',') || '哪一页都没有') + '）');
    });
  });

  const titles = ['general', 'recite', 'lists', 'reader']
    .flatMap(k => [...SRC[k].matchAll(/aria-labelledby="grp-([a-z]+)"/g)].map(m => m[1]));
  chk(titles.join(',') === 'recite,algo,print',
    '四张页合起来仍是那几组，顺序不变（只有两组以上的页才留 aria-labelledby，实际 ' + titles.join(',') + '）');

  ['#account-panel', '#toggle-sync', '#sync-hint'].forEach(sel => {
    const id = sel.replace(/^#/, '');
    const hit = Object.keys(PAGES).filter(k => new RegExp('id="' + id + '"').test(SRC[k]));
    chk(hit.length === 0,
      '控件 ' + sel + ' 不在任何一张设置页上（账号与同步归「我的」页 /mine/；' +
      '实际：' + (hit.join(',') || '哪一页都没有') + '）');
  });

  ['general', 'reader'].forEach(k => {
    chk(!/settings-group-title/.test(SRC[k]),
      PAGES[k] + ' 正文顶部不再重复写组标题（组名只留顶栏 data-page 一处）');
  });
  chk(!/settings-group-title[^>]*>我的清单</.test(SRC.lists) &&
      /settings-group-title[^>]*>打印</.test(SRC.lists),
    '「我的清单」页只留「打印」那一颗组标题（页名本身不再重复写一遍）');
  ['general', 'lists', 'reader'].forEach(k => {
    chk(/data-page="/.test(SRC[k]),
      PAGES[k] + ' 仍带着页名（顶栏据此写出「跬步 · 通用」这类标题）');
  });
  chk(/aria-labelledby="grp-algo"[\s\S]*?<\/section>/.test(SRC.recite) &&
      !/aria-labelledby="grp-play"/.test(SRC.reader),
    '「朗读」页不再有第二个组标题（原「阅读辅助」「朗读播放」两个组标题并成一个）');

  chk(!/aria-labelledby="grp-/.test(SRC.index), '主页不再有设置分组（只有入口清单）');
  chk(!/id="input-username"|id="seg-stage"|id="seg-play"|id="collections-list"/.test(SRC.index),
    '主页不残留任何设置控件');
}

{
  const chrome = read('js/chrome.js');
  chk(/function pageBackHref\(\)/.test(chrome), 'js/chrome.js 有 pageBackHref()：返回目标只有一个来源');
  chk(/bodyData\("back"\)/.test(chrome), 'pageBackHref() 读 body 上的 data-back');
  chk(/\/\^\\\/\[\^\\\/\\s\]\//.test(chrome) || /\^\\\/\[\^\\\/\\s\]/.test(chrome),
    'data-back 只认站内绝对路径（/ 开头），不认 javascript: 与外站地址');
  ['general', 'recite', 'lists', 'reader'].forEach(k => {
    chk(/data-back="\/settings\/"/.test(SRC[k]),
      PAGES[k] + ' 声明上一层是设置主页（从阅读页返回不该一脚踢去背诵首页）');
  });
  chk(/data-back="\/mine\/"/.test(SRC.index),
    '设置整页的上一层是「我的」页（齿轮点进来，返回键点回去）');
}

{
  ['index', 'general', 'recite', 'lists', 'reader'].forEach(k => {
    chk(/data-nav="settings"/.test(SRC[k]),
      PAGES[k] + ' 声明自己是「设置」页签（五张页的页签选中态一致）');
    chk(/js\/chrome\.js/.test(SRC[k]), PAGES[k] + ' 共用同一套顶栏与底部页签');
    chk(/js\/pwa\.js/.test(SRC[k]), PAGES[k] + ' 加载 js/pwa.js（--nav-h 每页都要实测）');
    chk(/<base href="\/"/.test(SRC[k]), PAGES[k] + ' 带 <base href="/">（子目录页面里相对资源才解析得对）');
    chk(/id="settings-page"/.test(SRC[k]), PAGES[k] + ' 有独立的整页容器');
    chk(!/class="foot/.test(SRC[k]), PAGES[k] + ' 没有页底页脚（应用形态，版权与法务收在「关于」里）');
    chk(/data-page="/.test(SRC[k]), PAGES[k] + ' 声明页名（顶栏第一行写得出「跬步 · 通用」）');

    const rel = (SRC[k].match(/(?:src|href)="(\.\.\/[^"]*)"/g) || []);
    chk(rel.length === 0, PAGES[k] + ' 不出现 ../ 相对引用（实际 ' + rel.join(',') + '）');
  });

  const pageNames = ['index', 'general', 'recite', 'lists', 'reader']
    .map(k => (SRC[k].match(/data-page="([^"]+)"/) || [])[1]);

  chk(pageNames.join(',') === '设置,通用,背诵,我的清单,朗读',
    '五张页的页名各不相同且如实：' + pageNames.join(' / '));
  chk(new Set(pageNames).size === 5, '五张页的页名不重复（否则「返回上一页」会让人分不清层）');
}

{
  const sw = read('sw.js');
  chk(/\.\/settings\/general\//.test(sw) && /\.\/settings\/recite\//.test(sw) &&
    /\.\/settings\/lists\//.test(sw) && /\.\/settings\/reader\//.test(sw),
    '四张二级页都在预缓存清单里（断网也进得去）');
  chk(/\.\/js\/settings-nav\.js/.test(sw), 'js/settings-nav.js 在预缓存清单里');
  const ver = parseInt((sw.match(/poem-app-v(\d+)/) || [0, '0'])[1], 10);
  chk(ver >= 194, '缓存版本已跟着提（本轮改了 css / js / 页面文案，实际 v' + ver + '）');

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
  const js = read('js/settings.js');

  chk(!/document\.querySelector\("#seg-algo"\)\.addEventListener/.test(js),
    'js/settings.js 不在取到的节点上直接 .addEventListener（取不到就报 null 错）');
  ['seg-stage', 'grade-chips', 'seg-scope', 'seg-count', 'seg-helper', 'seg-play', 'seg-algo'].forEach(id => {
    chk(new RegExp('\\$\\("#' + id + '"\\)').test(js) || new RegExp('#' + id + ' button').test(js),
      'js/settings.js 用 $() 取 #' + id + '，取不到就跳过（多张页共用一份逻辑）');
  });
  chk(/if \(!box\) return;/.test(js), '渲染前先判空（缺控件的那几页不报错）');

  chk(!/<script src="[^"]*js\/settings\.js"><\/script>/.test(SRC.index),
    '主页不加载 js/settings.js（只有 js/settings-nav.js）');
}

{
  const chrome = read('js/chrome.js');
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  chk(/label:\s*"我的"/.test(code(chrome)), '底部最后一格写「我的」');
  const dockBlock = code(chrome).slice(code(chrome).indexOf("DOCK_ITEMS"), code(chrome).indexOf("function dockKey"));
  chk(!/label:\s*"设置"/.test(dockBlock), '底部页签里没有一格叫「设置」（设置整页藏在齿轮后面）');

  chk(/key:\s*"mine",\s*href:\s*"\/mine\/"/.test(chrome),
    '那一格的路由是 /mine/（「我的」页；设置整页在它右上角那颗齿轮后面）');
  chk(/function pageTopAction\(/.test(code(chrome)) && /GLYPHS\.gear/.test(chrome),
    'js/chrome.js 认识页面上的齿轮入口（data-top-action="settings" → /settings/）');

  const glyph = chrome.slice(chrome.indexOf('tabMineImg:'), chrome.indexOf('dockKey('));
  chk(!/M9\.63 5\.52/.test(code(chrome)),
    '齿轮那枚图标连同定义一起删掉（不留没人用的图形）');
  chk(/__SRC__/.test(glyph) && /dockIcon\(/.test(chrome),
    '那一格的头像由渲染时现算（__SRC__ 占位符 + dockIcon 两处配套）');

  chk(/A\.html\(backingStore\(\), \{ dock: true \}\)/.test(code(chrome)),
    '那一格的头像取自 Avatar.html(..., { dock: true })（全站唯一那份「我是谁」的口径），' +
    '不另拼一份圆 + 首字');

  chk(/__SRC__/.test(glyph),
    '那一格的形状是 <img>（Issue #229：用户传了图就画图，没传回落首字由 .avatar-dock 那条路管）');

  const nav = read('js/settings-nav.js');
  chk(/function renderAbout\(/.test(nav), 'js/settings-nav.js 有 renderAbout()');
  chk(/settings-about/.test(read('settings/index.html')),
    '「我的」页 HTML 里有 #settings-about 那块容器');
  chk(/serviceWorker/.test(nav), '「关于」里的离线状态读 Service Worker 的真实状态（不假装）');

  const swVer = (read('sw.js').match(/poem-app-v(\d+)/) || [0, '0'])[1];
  const pageVer = (nav.match(/APP_VERSION = "[^"]*v(\d+)/) || [0, '0'])[1];
  chk(!!swVer && swVer === pageVer,
    '「关于」里的版本号与 sw.js 的 CACHE_NAME 同一个数（实际 v' + pageVer + ' / v' + swVer + '）');
  chk(/离线缓存/.test(read('js/settings-nav.js')), '「关于」里写得出「离线缓存」这一行');

  // ---- Issue #209：层级对比 / 用户协议 / 隐私条款 三条链接落在「关于」那几行里 ----
  //
  // 三件都住在同一个 .kv-list 里，所以两件事是**一起**要守的：
  //   ① 长句「查看」不再顶在最右边（用户 2026-09-18：直接变成链接，不需要右边的「查看」）；
  //   ② 行高必须跟上面那几行一致（行高不一致，一眼就看得出这一块是拼上来的）。
  const aboutBlock = nav.slice(nav.indexOf('function renderAbout('),
    nav.indexOf('function go()'));
  chk(/层级对比/.test(aboutBlock) && /\/plans\//.test(aboutBlock),
    '「关于」里有「层级对比」这一行，落在 /plans/（它从「我的」页首卡挪到了这儿）');
  chk(/用户协议/.test(aboutBlock) && /隐私条款/.test(aboutBlock),
    '「关于」里仍有用户协议与隐私条款两条入口');
  chk(!/>查看<\/a>/.test(aboutBlock),
    '那三条不再各挂一个「查看」（链接本身就说清了它是链接）');
  // 只看**渲染出来的那几行**（box.innerHTML 那一段）：注释里也写着词，
  // 拿整段搜会把注释当成内容，位置就量不准了。
  const rowsHtml = aboutBlock.slice(aboutBlock.indexOf("box.innerHTML ="));
  chk(rowsHtml.indexOf('离线缓存') < rowsHtml.indexOf('/plans/') &&
      rowsHtml.indexOf('/plans/') < rowsHtml.indexOf('用户协议'),
    '「层级对比」那一行插在离线缓存与用户协议**中间那一行**（用户点名的位置）');
  // 这几行的条目都是 link(href, 词) 造出来的 —— 左列就是那个 <a>，
  // 不另挂「查看」；右列（kvRow 的第二格）是空串。
  chk(/link\("\/plans\/",\s*"层级对比"\)/.test(rowsHtml),
    '左边那格自己就是链接（不是只把右边那颗「查看」做成链接）');
  chk(/link\("\/terms\/",\s*"用户协议"\)/.test(rowsHtml),
    '用户协议左边那格也是链接');
  chk(/link\("\/privacy\/",\s*"隐私条款"\)/.test(rowsHtml),
    '隐私条款左边那格也是链接');

  // ---- Issue #229：这几行是同一套（用户 2026-09-18）----
  //
  // 上一轮只顾着「别是无样式正文」，给链接加了一道 celadon 下划线 —— 那是错的。
  // 用户这一轮把口径说全了：不要下划线，而且间距要和「应用 / 版本 / 离线缓存」
  // 那几行一样（行高不一样，一眼就看得出这块是拼上来的）。办法是让每行的高度
  // 由 min-height 一家说了算：.kv-row 上下不写 padding，链接那一行就不会被
  // 自己的行盒撑高。
  const css = read('css/style.css');
  const rule = (sel) => (css.match(new RegExp(
    sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*\\}')) || [''])[0];

  // 「不画下划线」全站只有一条默认（style.css 顶上的 `a { text-decoration: none }`），
  // 这几行不必再各写一遍 —— 要守的是「没有一条规则把下划线加回来」。
  const kvLink = rule('.kv-k a');
  chk(!/text-decoration:\s*underline/.test(kvLink) && !/border-bottom:\s*1px/.test(kvLink),
    '那几行的链接不画下划线（用户 2026-09-18：不要下划线）');
  chk(!/--celadon/.test(kvLink),
    '原先那道 celadon 细线也撤掉（下划线就是它）');
  chk(/font-size:\s*13px/.test(kvLink),
    '链接与正文同一个字号（13px）—— 比正文大的词搁在一行里，那一行看着就不齐');

  const kvRowRule = rule('.kv-row');
  chk(/align-items:\s*center/.test(kvRowRule),
    '行内按中线对齐（链接与右边那颗值对齐；baseline 会因为字号差把行撑高）');
  chk(/padding:\s*0/.test(kvRowRule) && !/padding:\s*[1-9]\d*px\s+0/.test(kvRowRule),
    '行高只由 min-height 定：上下 padding 是 0（写了上下 padding，链接那一行就与上面几行对不上）');
  chk(/min-height:\s*42px/.test(kvRowRule), '行高仍是 42px（与上面几行同一个数）');

  // 「自检」那一行：用户 2026-09-18 点名从「设置 · 通用」搬来。
  //
  // ⚠️ Issue #276 后续（用户 2026-09-24）：「自检页面只能已登录的管理员账号
  //    访问，其他情况一律**不显示**自检页面链接」。所以这一行**不再无条件
  //    渲染** —— 它搬进了一个按角色开关的 `renderSelfCheck()`。
  //    这一层守着「搬走了、但入口还在（对的人看得见）」与「对所有人都在
  //    一份静态 HTML 里」这两种坏法。
  chk(/\/self-check\//.test(nav) && /自检/.test(nav),
    '「关于」这一块仍备着去 /self-check/ 的「自检」入口（它原先在「设置 · 通用」当一颗按钮）');
  chk(/function renderSelfCheck\(/.test(nav),
    '那一行改由 renderSelfCheck() 渲染（不再直接写死在 renderAbout 的 innerHTML 里）');
  chk(/Ent\.isOwner\(/.test(nav) && /Entitlement/.test(nav),
    '它的判据是 Entitlement.isOwner()（与 /admin/ 走同一个出口，不另判一套）');
  chk(/isOwner\(backing, id \? \{ role: id\.role, uid: id\.uid \} : undefined\)/.test(nav),
    '传参形状与 /admin/ 那一处逐字相同（带上 uid —— 判的是「这份答案是不是当前这位的」）');
  chk(/if \(!ok\) return "";/.test(nav),
    '不通过时**返回空串** —— 那一行压根不进 DOM（不是 hidden，也不是 CSS 遮住）');
  chk(/host\.hidden = !host\.innerHTML/.test(nav),
    '整块空的时候连 .kv-list 一起收走（不留一圈空 margin）');
  chk(/addEventListener\("storage"/.test(nav) && /addEventListener\("entitlementchange"/.test(nav),
    '角色是异步到位的：登录回来 / 云端拉到 role 后重画那一行，不用整页刷新');
  chk(!/跑一遍自检/.test(aboutBlock) && !/btn-selfcheck/.test(nav),
    '文案就叫「自检」（用户 2026-09-18 点名改），也不留那颗按钮的 id');
  chk(!/btn-selfcheck/.test(read('settings/general/index.html')) &&
      !/跑一遍自检/.test(read('settings/general/index.html')),
    '「设置 · 通用」里那一块（按钮 + 说明）整块撤干净，不留空壳');

  // 设置首页要先把 Entitlement 请进来，否则上面那条判据拿不到角色。
  const settingsIndex = read('settings/index.html');
  chk(settingsIndex.indexOf('/js/entitlement.js') >= 0,
    '设置首页加载了 js/entitlement.js（renderSelfCheck 要用它判角色）');
  chk(settingsIndex.indexOf('/js/entitlement.js') < settingsIndex.indexOf('/js/settings-nav.js'),
    '而且排在 js/settings-nav.js **之前** —— 后者渲染「关于」时就要这份答案');

  // 自检页自己那一半：入口藏了不等于页面进不去（有地址的人照样能敲）。
  const scHtml = read('self-check/index.html');
  chk(/id="self-check-gate"|js\/self-check-gate\.js/.test(scHtml),
    '/self-check/ 引了 js/self-check-gate.js（页面自己那道闸）');
  chk(/<main class="settings-page selfcheck-page" id="selfcheck-page" hidden>/.test(scHtml),
    '内容那一块**默认 hidden**（判据没跑完之前谁都不许先看见逐条结论）');
  chk(/id="selfcheck-deny"/.test(scHtml),
    '备着一张「只对管理员开放」的拒绝卡');
  chk(/id="self-check-script" type="text\/plain" data-src="\/js\/self-check\.js"/.test(scHtml),
    '自检脚本是**占位**（type=text/plain 不执行），放行时才换成真脚本');
  const gate = read('js/self-check-gate.js');
  chk(/E\.isOwner\(backing, id \? \{ role: id\.role, uid: id\.uid \} : undefined\)/.test(gate) &&
      /window\.Entitlement/.test(gate),
    '页面那道闸与入口那道闸走同一个出口 Entitlement.isOwner()（连传参形状都逐字相同）');
  chk(/page\.hidden = false/.test(gate),
    '放行时把内容那一块从 hidden 里放出来');
  chk(/replaceChild\(s, holder\)/.test(gate),
    '放行时才把占位换成真脚本 —— 拒绝那一支里 /js/self-check.js 一次都没被请求');
}

console.log('\n' + (fails ? '❌ ' + fails + ' 项失败' : '🎉 二级设置页测试全部通过'));
process.exit(fails ? 1 : 0);
