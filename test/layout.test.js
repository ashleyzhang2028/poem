/**
 * 布局避让测试（弹层不被底部导航压住）
 *
 * 背景：底部导航是**浮层** —— 页签 z-index 65、播放栏 70。
 * 弹层原本写 z-index 50，比它们都低，于是「加入背诵」弹框的下缘
 * （集合列表与新建输入框）被页签横切一刀，点下去命中的其实是页签。
 *
 * 这件事分两层修，都在这条防线上守着：
 *   一、**层级**：弹层必须高于页签与播放栏（.modal = 80，见 test/theme.test.js
 *       那组 z-index 断言），否则内容压根点不到；
 *   二、**避让**：层级只解决「点得到」，视觉上弹层下缘仍会与页签图标叠成一团
 *       （弹层是半透明纸底，页签从底下透出来）。所以弹层还要按底部导航的
 *       **实测高度**上收 —— 这一层是本文件守的。
 *
 * ⚠️ 避让必须用 --nav-h（js/pwa.js 实测），不能写死 62px：
 *    62px 只是默认字号下页签的高度，换字号 / 横屏 / PWA 就失准，
 *    于是又「差几像素」叠上一点 —— 那正是这个 bug 反复的原因。
 *
 * 运行：node test/layout.test.js
 */
const fs = require('fs');
const path = __dirname + '/../';
const read = f => fs.readFileSync(path + f, 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const css = read('css/style.css');
const classicCss = read('css/classic.css');
const pwa = read('js/pwa.js');
const core = read('js/reader-core.js');

/* 去掉注释：注释里会出现 `.modal-box` / `62px` 这类字样，
   不去掉会把「对旧做法的描述」当成当前样式来判。 */
const code = css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * 取某个选择器在样式表里**累积**的声明（同名规则后写的覆盖先写的）。
 * 规则可能写在 @media 里（宽屏那一档的 max-height 就是），
 * 所以不能只按「顶层规则」找 —— 那会漏掉媒体查询里的声明。
 * 做法：先把 @media 的外壳剥掉、把里面的规则提到顶层（这里只关心
 * 「某一档是否存在这条声明」，具体在哪一档由媒体查询自己决定），
 * 再按顺序累加同名选择器的声明块。
 */
function declsOf(sel) {
  const flat = code.replace(/@media[^{]+\{/g, '{');
  let acc = '';
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(flat))) {
    const sels = m[1].split(',').map(x => x.trim());
    // 只看「恰好是这个选择器」的规则：`.modal-box` 与 `.modal-box.small`
    // 是两条不同的选择器，别把后者的声明算到前者头上
    if (sels.includes(sel)) acc += m[2];
  }
  return acc;
}
const decl = {
  modal: declsOf('.modal'),
  box: declsOf('.modal-box'),
  small: declsOf('.modal-box.small'),
  toast: declsOf('.toast')
};

/* ---------------- 一、--nav-h 是唯一的避让基准 ---------------- */

chk(/--nav-h:\s*0px/.test(css), '--nav-h 变量有初值（无底部导航时为 0）');
chk(/setProperty\(\s*["']--nav-h["']/.test(pwa),
  'js/pwa.js 实测底部导航高度并写进 --nav-h（页签 / 播放栏取较高者 + 引导条）');

// 写死 62px 的垫高：那只是默认字号下页签的高度
const hardcoded = code.match(/calc\([^)]*62px[^)]*\)/g) || [];
chk(hardcoded.length === 0,
  '不再有写死 62px 的底部避让（会随字号 / 横屏失准）'
  + (hardcoded.length ? '：' + hardcoded.join(' / ') : ''));

/* ---------------- 二、弹层按 --nav-h 避让底部导航 ---------------- */

chk(/max-height:\s*calc\([^)]*var\(--nav-h\)/.test(decl.box),
  '大弹层的高度扣掉实测底部导航高度（--nav-h），末排按钮不被压住');
chk(/padding-bottom:\s*calc\([^)]*var\(--nav-h\)/.test(decl.box),
  '大弹层底部内边距再垫出底部导航高度，末排按钮整排落在导航上方');
// 小弹层的高度是「86 * --app-vh 再扣掉 --nav-h」：`var(--nav-h)` 不在 calc 的
// 最前面，所以这条不能只看紧跟 calc( 的第一个 token
chk(/max-height:\s*calc\([^;]*var\(--nav-h\)/.test(decl.small),
  '小弹层（设置 / 集合选择器）的高度同样按 --nav-h 避让');
chk(/padding-bottom:\s*calc\([^)]*var\(--nav-h\)/.test(decl.small),
  '小弹层的下内边距按 --nav-h 避让 —— 「加入背诵」弹框的输入框与新建键就在这一行');
chk(/margin-bottom:\s*calc\([^)]*var\(--nav-h\)/.test(decl.small),
  '小弹层的下外边距同样按 --nav-h 避让（与底部弹层口径一致）');

/* ---------------- 三、集合选择器确实走小弹层 ---------------- */

chk(/wrap\.className\s*=\s*"modal recite-picker"/.test(core),
  '集合选择器挂的是 .modal.recite-picker（继承全站弹层层级与避让）');
chk(/class="modal-box small"/.test(core),
  '集合选择器用的是小弹层 .modal-box.small（走小弹层那一套避让）');
chk(/class="recite-new"/.test(core) && /id="gw-recite-create"/.test(core),
  '「新建集合」输入与按钮在弹层内（避让规则生效时它们才不会被压住）');
chk(/document\.body\.appendChild\(wrap\)/.test(core),
  '集合选择器挂在 <body> 下（不在 .reader 里，不受那一层层叠上下文限制）');

/* ---------------- 四、底部两条导航的层级关系没被改乱 ---------------- */

const zOf = sel => {
  // 取**最后一个** z-index 声明（同名规则后写的覆盖先写的）
  const all = declsOf(sel).match(/z-index:\s*([^;]+)/g) || [];
  if (!all.length) return NaN;
  const last = all[all.length - 1].match(/z-index:\s*([^;]+)/)[1];
  return Number(last.trim());
};
const zModal = zOf('.modal'), zDock = zOf('.dock'), zPlayer = zOf('.player-bar');
const zTip = zOf('.ios-install-tip'), zToast = zOf('.toast');
chk(zModal > zDock && zModal > zPlayer,
  '弹层（' + zModal + '）高于页签（' + zDock + '）与播放栏（' + zPlayer + '）——内容点得到');
chk(zModal > zTip && zModal < zToast,
  '层级次序仍是 引导条（' + zTip + '）< 弹层（' + zModal + '）< toast（' + zToast + '）');
chk(zDock < zPlayer,
  '页签（' + zDock + '）仍低于播放栏（' + zPlayer + '）——播放栏出现时页签让路的关系没乱');

/* ---------------- 五、阅读器与底栏的关系 ---------------- */

chk(/body\.reader-open \.dock\s*\{[^}]*display:\s*none/.test(classicCss),
  '阅读器打开时底部页签仍是收起的（不为冲突的地方打补丁）');
chk(/\.reader\s*\{[^}]*z-index:\s*66/s.test(classicCss),
  '阅读器仍在页签（65）之上');
// 阅读器（66）低于弹层（80）：弹层挂 body，在阅读器里点「加入背诵」也盖得住
chk(zModal > zOf('.reader') || zModal > 66,
  '弹层（' + zModal + '）高于阅读器，阅读器里弹出的选择器盖得住正文');

console.log(fails === 0 ? '\n🎉 布局避让测试全部通过' : '\n❌ ' + fails + ' 项失败');
process.exit(fails ? 1 : 0);
