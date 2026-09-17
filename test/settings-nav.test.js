/**
 * 二级设置页专项测试（Issue #132 后续）
 * ==========================================================================
 * 为什么设置要拆页：一页里已经堆了六组（#114 分组、#132 账号 / 头像 /
 * 复习算法 / 朗读播放；#163 又把最后两组并成一组「朗读」，现在是五组）。
 * 再往上加只会更长，于是每一组摊成一页：
 *
 *   /settings/          「我的」：个人中心 + 四组入口 + 关于 + 版权与法务链接
 *                                （不加载 js/settings.js）
 *   /settings/general/  通用     —— 用户名 / 头像 / 账号 / 数据管理
 *   /settings/recite/   背诵     —— 学段 / 年级 / 学期 / 范围 / 数量 + 复习算法
 *   /settings/lists/    我的清单 —— 自选背诵的增删改查
 *   /settings/reader/   朗读     —— 自动注音 + 五档连读方式
 *
 * ⚠️ Issue #209（用户 2026-09-17）：「将右下角设置改成 我的 并将齿轮图标
 *    换成圆形用户头像 …… 用户点击我的之后，转到我的页面，显示之前四个设置项，
 *    包括 通用 背诵 我的清单 朗读，把我的清单改成 清单，另外在通用上面加一个
 *    个人中心，最下面加一个 关于」
 *    —— 路由 `/settings/` 一个字没动（全站所有 `href="/settings/"` 与
 *    `data-back="/settings/"` 因此都不必改），变的是**这一页叫什么**
 *    （顶栏页名「我的」、底部最后一格也叫「我的」）与**清单的六行**。
 *
 * 这一层守四件事（都是「拆页会静默出错」的那类）：
 *   一、结构：四张页合起来是精简后的五组、每件控件**只在一页**上
 *   二、返回：二级页的返回键回「我的」页，不回背诵首页
 *   三、离线：新页面与新脚本都进了 sw.js 的预缓存清单，且版本号跟着提
 *   四、页签：最后一格叫「我的」（不是「设置」），图标是圆形用户头像
 * 跑法：`node test/settings-nav.test.js`（纯 Node，不联网、不装依赖）
 */
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

/* ================= 一、主页：四个入口，一个不多一个不少 ================= */
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
  // 每一条 href 都真的有那张页
  groups.forEach(g => {
    const f = g.href.replace(/^\/settings\//, 'settings/').replace(/\/$/, '');
    chk(fs.existsSync(path + (f === 'settings' ? '' : f) + '/index.html'),
      '入口 ' + g.href + ' 对应的页面文件存在');
  });
  // 入口清单由数据生成，HTML 里不手写一遍（加一组只改一处）
  chk(/renderIndex\(\)/.test(NAV) && /#settings-index/.test(NAV),
    '入口清单由 js/settings-nav.js 按数据渲染进 #settings-index');
  chk(/settings-index/.test(SRC.index), '主页有一块空的入口清单容器（不在 HTML 里手写分组）');
  chk(!/href="\/settings\/(general|recite|lists|reader)\/"/.test(SRC.index),
    '主页 HTML 里不写死入口地址（避免两处各写一份，加一组漏一页）');
  chk(/settings-nav\.js/.test(SRC.index), '主页加载 js/settings-nav.js');
  /* Issue #163 用户原话：「另外把这个按钮和其他按钮放一起啊」——
     账号那一行（登录 / 个人中心）**在清单里面**，与四组入口排成一列，
     不再是架在清单上面的另一张卡。所以判据是「同一张清单里五行、
     它排最后一个」，而不是「有没有那一行」。 */
  chk(!/id="account-entry"/.test(SRC.index),
    '主页不再有独立的账号卡容器（那一行已在清单里）');
  /* ⚠️ Issue #209（用户 2026-09-17）：「在通用上面加一个 个人中心」——
     账号那一行从「清单最后一条」挪到**第一条**，所以判据从 appendChild
     改成 insertBefore(firstChild)。两件事必须同时成立：
       · 它仍进的是**同一张清单**（#settings-index），不是另起一处；
       · 它排在其他四组**前面**。 */
  chk(/querySelector\("#settings-index"\)/.test(NAV) &&
    /insertBefore\(el, box\.firstChild\)/.test(NAV),
    '账号那一行仍进**同一张清单**，且插在**第一条**（用户点名的位置）');
  chk(/renderIndex\(\);\s*\n\s*renderAccountEntry\(\);\s*\n\s*renderAbout\(\);/.test(NAV),
    '三步顺序：renderIndex → renderAccountEntry → renderAbout（反了就被清单重画抹掉）');
}

/* ================= 二、每张页只放自己那一组，控件不重复 ================= */
{
  const OWNER = {
    /* Issue #163：'#seal-chars'（字集 / 四色那套）已随功能删掉，
       换成头像上传的入口与文件选择框。 */
    general: ['#input-username', '#btn-avatar-pick', '#avatar-file', '#account-panel',
      '#btn-export', '#btn-import', '#btn-reset'],
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
  // 分组：四张页合起来是五组（Issue #163 把「阅读辅助 + 朗读播放」并成一组「朗读」），
  // 再 + 3 期新增的「打印」一组，前四组与顺序一个字没改。
  // ⚠️ `print` 那一组是**新增**的（篇目打印页，Pro · `export.paper`），
  //    它长在「我的清单」页上 —— 要打印的正是这份清单，分两页等于让人来回搬东西。
  const titles = ['general', 'recite', 'lists', 'reader']
    .flatMap(k => [...SRC[k].matchAll(/aria-labelledby="grp-([a-z]+)"/g)].map(m => m[1]));
  chk(titles.join(',') === 'recite,algo,print',
    '四张页合起来仍是那几组，顺序不变（只有两组以上的页才留 aria-labelledby，实际 ' + titles.join(',') + '）');
  // Issue #163（第三轮）：**一页只有一组时，正文顶部不再重复写组名** ——
  // 「通用」「我的清单」「朗读」都已经写在顶栏页名上，正文再写一遍是同一屏里说两次。
  // ⚠️ 「我的清单」页现在**有两组**（自选背诵 + 3 期的打印），所以它只该留
  //    「打印」那一颗组标题 —— 前一组的名字仍是顶栏页名。
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
  // 主页不再是「一堆控件里的一页」：它没有分组，只有入口清单
  chk(!/aria-labelledby="grp-/.test(SRC.index), '主页不再有设置分组（只有入口清单）');
  chk(!/id="input-username"|id="seg-stage"|id="seg-play"|id="collections-list"/.test(SRC.index),
    '主页不残留任何设置控件');
}

/* ================= 三、二级页的返回上一层 ================= */
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
  chk(!/data-back=/.test(SRC.index), '主页自己就是最上面那一层，不声明 data-back');
}

/* ================= 四、四张页的共性（页签 / 顶栏 / 页脚 / 离线） ================= */
{
  ['index', 'general', 'recite', 'lists', 'reader'].forEach(k => {
    chk(/data-nav="settings"/.test(SRC[k]),
      PAGES[k] + ' 声明自己是「设置」页签（五张页的页签选中态一致）');
    chk(/js\/chrome\.js/.test(SRC[k]), PAGES[k] + ' 共用同一套顶栏与底部页签');
    chk(/js\/pwa\.js/.test(SRC[k]), PAGES[k] + ' 加载 js/pwa.js（--nav-h 每页都要实测）');
    chk(/<base href="\/"/.test(SRC[k]), PAGES[k] + ' 带 <base href="/">（子目录页面里相对资源才解析得对）');
    chk(/id="settings-page"/.test(SRC[k]), PAGES[k] + ' 有独立的整页容器');
    chk(/class="foot settings-foot"/.test(SRC[k]), PAGES[k] + ' 有页脚（版权 + 法务链接）');
    chk(/data-page="/.test(SRC[k]), PAGES[k] + ' 声明页名（顶栏第一行写得出「跬步 · 通用」）');
    // 资源引用不能是相对路径（./css/... 会去 /settings/xxx/css/... 找）。
    // 例外：`./` 开头的图标在带 <base href="/"> 的页面里同样解析成站点根，
    // 所以只揪出 `../` 这类真的会跑偏的写法。
    const rel = (SRC[k].match(/(?:src|href)="(\.\.\/[^"]*)"/g) || []);
    chk(rel.length === 0, PAGES[k] + ' 不出现 ../ 相对引用（实际 ' + rel.join(',') + '）');
  });
  // 页面名各自不同：用户得知道自己在哪一层
  const pageNames = ['index', 'general', 'recite', 'lists', 'reader']
    .map(k => (SRC[k].match(/data-page="([^"]+)"/) || [])[1]);
  /* ⚠️ Issue #209：顶页从「设置」改名成「我的」（底部那格也一起改了）——
     用户原话「将右下角设置改成 我的 …… 用户点击我的之后，转到我的页面」。
     二级页的页名一个字没改：它们仍是各自那一组。
     ⚠️ 「我的清单」那一张仍是「我的清单」（页名），只是在**清单里**简称「清单」。 */
  chk(pageNames.join(',') === '我的,通用,背诵,我的清单,朗读',
    '五张页的页名各不相同且如实：' + pageNames.join(' / '));
  chk(new Set(pageNames).size === 5, '五张页的页名不重复（否则「返回上一页」会让人分不清层）');
}

/* ================= 五、Service Worker：新页面与新脚本都要能离线进 ================= */
{
  const sw = read('sw.js');
  chk(/\.\/settings\/general\//.test(sw) && /\.\/settings\/recite\//.test(sw) &&
    /\.\/settings\/lists\//.test(sw) && /\.\/settings\/reader\//.test(sw),
    '四张二级页都在预缓存清单里（断网也进得去）');
  chk(/\.\/js\/settings-nav\.js/.test(sw), 'js/settings-nav.js 在预缓存清单里');
  const ver = parseInt((sw.match(/poem-app-v(\d+)/) || [0, '0'])[1], 10);
  chk(ver >= 143, '缓存版本已跟着提（本轮改了 css / js / 数据，实际 v' + ver + '）');
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

/* ================= 六、JS：一份逻辑跑五张页，取不到就跳过 ================= */
{
  const js = read('js/settings.js');
  // 二级页之后同一份 settings.js 被多张页共用 —— 任何「这一页一定有某个 id」
  // 的假设都会在别的页上炸。$() 取不到返回 null，必须就地跳过。
  chk(!/document\.querySelector\("#seg-algo"\)\.addEventListener/.test(js),
    'js/settings.js 不在取到的节点上直接 .addEventListener（取不到就报 null 错）');
  ['seg-stage', 'grade-chips', 'seg-scope', 'seg-count', 'seg-helper', 'seg-play', 'seg-algo'].forEach(id => {
    chk(new RegExp('\\$\\("#' + id + '"\\)').test(js) || new RegExp('#' + id + ' button').test(js),
      'js/settings.js 用 $() 取 #' + id + '，取不到就跳过（多张页共用一份逻辑）');
  });
  chk(/if \(!box\) return;/.test(js), '渲染前先判空（缺控件的那几页不报错）');
  // 主页不加载 settings.js：它只管「进哪一页」，不该顺手把整页设置逻辑拖进来
  chk(!/<script src="[^"]*js\/settings\.js"><\/script>/.test(SRC.index),
    '主页不加载 js/settings.js（只有 js/settings-nav.js）');
}

/* ================= 七、底部最后一格＝「我的」（Issue #209） ================= */
{
  const chrome = read('js/chrome.js');
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  // 页签文案：「设置」→「我的」
  chk(/label:\s*"我的"/.test(code(chrome)), '底部最后一格写「我的」（用户点名的改名）');
  chk(!/label:\s*"设置"/.test(code(chrome)), '不再有一格叫「设置」（改了名，不是又加一格）');
  // 路由一个字没动：改的是名字与图标，不是地址
  chk(/key:\s*"settings",\s*href:\s*"\/settings\/"/.test(chrome),
    '那一格的路由仍是 /settings/（全站所有链接与返回落点因此都不必改）');
  // 图标：圆形用户头像，不是齿轮
  const glyph = chrome.slice(chrome.indexOf('tabMine:'), chrome.indexOf('/* 顶栏右侧：返回上一页'));
  chk(/<circle[^>]*r="10"/.test(glyph), '那一格的图标是一枚**整圆**（圆形用户头像）');
  chk(!/M9\.63 5\.52/.test(code(chrome)),
    '齿轮那枚图标连同定义一起删掉（不留没人用的图形）');
  chk(/__CHAR__/.test(glyph) && /dockIcon\(/.test(chrome),
    '圆里的首字由渲染时现算（占位符 + dockIcon 两处配套）');
  chk(/A\.display\(backing\)/.test(code(chrome)),
    '首字取自 Avatar.display（全站唯一那份「我是谁」的口径），不另读一遍档案');

  // 「关于」那一块：只读信息 + 两条法务入口 + 离线状态
  const nav = read('js/settings-nav.js');
  chk(/function renderAbout\(/.test(nav), 'js/settings-nav.js 有 renderAbout()');
  chk(/settings-about/.test(read('settings/index.html')),
    '「我的」页 HTML 里有 #settings-about 那块容器');
  chk(/serviceWorker/.test(nav), '「关于」里的离线状态读 Service Worker 的真实状态（不假装）');
  /* ⚠️ 版本号与 sw.js 的 CACHE_NAME **必须同步**：页面读不到 Service Worker
     作用域里的常量，所以那一串是手写的。两处一旦走散，用户看到的版本号
     就会与真正生效的缓存对不上 —— 这类「只差一点点的谎」最难被发现。 */
  const swVer = (read('sw.js').match(/poem-app-v(\d+)/) || [0, '0'])[1];
  const pageVer = (nav.match(/APP_VERSION = "[^"]*v(\d+)/) || [0, '0'])[1];
  chk(!!swVer && swVer === pageVer,
    '「关于」里的版本号与 sw.js 的 CACHE_NAME 同一个数（实际 v' + pageVer + ' / v' + swVer + '）');
  chk(/离线缓存/.test(read('js/settings-nav.js')), '「关于」里写得出「离线缓存」这一行');
}

console.log('\n' + (fails ? '❌ ' + fails + ' 项失败' : '🎉 二级设置页测试全部通过'));
process.exit(fails ? 1 : 0);
