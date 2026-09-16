/**
 * 二级设置页专项测试（Issue #132 后续）
 * ==========================================================================
 * 为什么设置要拆页：一页里已经堆了六组（#114 分组、#132 账号 / 头像 /
 * 复习算法 / 朗读播放）。再往上加只会更长，于是每一组摊成一页：
 *
 *   /settings/          主页：四个入口 + 版权与法务链接（不加载 js/settings.js）
 *   /settings/general/  通用     —— 用户名 / 头像印记 / 账号 / 数据管理
 *   /settings/recite/   背诵     —— 学段 / 年级 / 学期 / 范围 / 数量 + 复习算法
 *   /settings/lists/    我的清单 —— 自选背诵的增删改查
 *   /settings/reader/   阅读与朗读 —— 注音总开关 + 五档连读
 *
 * 这一层守三件事（都是「拆页会静默出错」的那类）：
 *   一、结构：四张页合起来仍是原来那六组、每件控件**只在一页**上
 *   二、返回：二级页的返回键回设置主页，不回背诵首页
 *   三、离线：新页面与新脚本都进了 sw.js 的预缓存清单，且版本号跟着提
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
  chk(/settings-index/.test(SRC.index), '主页有一块空的入口清单容器（不在 HTML 里手写六组）');
  chk(!/href="\/settings\/(general|recite|lists|reader)\/"/.test(SRC.index),
    '主页 HTML 里不写死入口地址（避免两处各写一份，加一组漏一页）');
  chk(/settings-nav\.js/.test(SRC.index), '主页加载 js/settings-nav.js');
}

/* ================= 二、每张页只放自己那一组，控件不重复 ================= */
{
  const OWNER = {
    general: ['#input-username', '#seal-chars', '#account-panel', '#btn-export', '#btn-import', '#btn-reset'],
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
  // 分组：四张页合起来是原来那六组 + 3 期新增的「打印」一组，分类与顺序一个字没改。
  // ⚠️ `print` 那一组是**新增**的（篇目打印页，Pro · `export.paper`），
  //    它长在「我的清单」页上 —— 要打印的正是这份清单，分两页等于让人来回搬东西。
  const titles = ['general', 'recite', 'lists', 'reader']
    .flatMap(k => [...SRC[k].matchAll(/aria-labelledby="grp-([a-z]+)"/g)].map(m => m[1]));
  chk(titles.join(',') === 'general,recite,algo,lists,print,reader,play',
    '四张页合起来是原六组 + 打印、原顺序（实际 ' + titles.join(',') + '）');
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
  chk(pageNames.join(',') === '设置,通用,背诵,我的清单,阅读与朗读',
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
  chk(ver >= 116, '缓存版本已跟着提（本轮改了 css / js / 新增 5 张页面，实际 v' + ver + '）');
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

console.log('\n' + (fails ? '❌ ' + fails + ' 项失败' : '🎉 二级设置页测试全部通过'));
process.exit(fails ? 1 : 0);
