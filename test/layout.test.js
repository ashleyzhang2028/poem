const fs = require('fs');
const path = __dirname + '/../';
const read = f => fs.readFileSync(path + f, 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const css = read('css/style.css');
const classicCss = read('css/classic.css');
const pwa = read('js/pwa.js');
const core = read('js/reader-core.js');

const code = css.replace(/\/\*[\s\S]*?\*\//g, '');

function declsOf(sel) {
  const flat = code.replace(/@media[^{]+\{/g, '{');
  let acc = '';
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(flat))) {
    const sels = m[1].split(',').map(x => x.trim());

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

chk(/--nav-h:\s*0px/.test(css), '--nav-h 变量有初值（无底部导航时为 0）');
chk(/setProperty\(\s*["']--nav-h["']/.test(pwa),
  'js/pwa.js 实测底部导航高度并写进 --nav-h（页签 / 播放栏取较高者 + 引导条）');

const hardcoded = code.match(/calc\([^)]*62px[^)]*\)/g) || [];
chk(hardcoded.length === 0,
  '不再有写死 62px 的底部避让（会随字号 / 横屏失准）'
  + (hardcoded.length ? '：' + hardcoded.join(' / ') : ''));

chk(/max-height:\s*calc\([^)]*var\(--nav-h\)/.test(decl.box),
  '大弹层的高度扣掉实测底部导航高度（--nav-h），末排按钮不被压住');
chk(/padding-bottom:\s*calc\([^)]*var\(--nav-h\)/.test(decl.box),
  '大弹层底部内边距再垫出底部导航高度，末排按钮整排落在导航上方');

chk(/max-height:\s*calc\([^;]*var\(--nav-h\)/.test(decl.small),
  '小弹层（设置 / 集合选择器）的高度同样按 --nav-h 避让');
chk(/padding-bottom:\s*calc\([^)]*var\(--nav-h\)/.test(decl.small),
  '小弹层的下内边距按 --nav-h 避让 —— 「加入背诵」弹框的输入框与新建键就在这一行');
chk(/margin-bottom:\s*calc\([^)]*var\(--nav-h\)/.test(decl.small),
  '小弹层的下外边距同样按 --nav-h 避让（与底部弹层口径一致）');

chk(/wrap\.className\s*=\s*"modal recite-picker"/.test(core),
  '集合选择器挂的是 .modal.recite-picker（继承全站弹层层级与避让）');
chk(/class="modal-box small"/.test(core),
  '集合选择器用的是小弹层 .modal-box.small（走小弹层那一套避让）');
chk(/class="recite-new"/.test(core) && /id="gw-recite-create"/.test(core),
  '「新建集合」输入与按钮在弹层内（避让规则生效时它们才不会被压住）');
chk(/document\.body\.appendChild\(wrap\)/.test(core),
  '集合选择器挂在 <body> 下（不在 .reader 里，不受那一层层叠上下文限制）');

const zOf = sel => {

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

chk(/body\.reader-open \.dock\s*\{[^}]*display:\s*none/.test(classicCss),
  '阅读器打开时底部页签仍是收起的（不为冲突的地方打补丁）');
chk(/\.reader\s*\{[^}]*z-index:\s*66/s.test(classicCss),
  '阅读器仍在页签（65）之上');

chk(zModal > zOf('.reader') || zModal > 66,
  '弹层（' + zModal + '）高于阅读器，阅读器里弹出的选择器盖得住正文');

chk(/@media\s*\(min-width:\s*1024px\)[\s\S]*?--col-w:\s*min\(1200px,\s*100vw\)/.test(css),
  '桌面内容壳层封顶 1200px，避免超宽屏内容散开');
chk(/grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*280px\),\s*1fr\)\)/.test(css),
  '桌面列表使用流式等宽列，避免固定卡片宽度产生零散空隙');

const site = read('js/chrome.js');
const PAGES = fs.readdirSync(__dirname + '/..', { withFileTypes: true })
  .filter(e => e.isDirectory() && !e.name.startsWith('.') && !['node_modules', 'test', 'scripts'].includes(e.name))
  .map(e => e.name + '/index.html')
  .filter(f => fs.existsSync(path + f))
  .concat(['index.html']);
{
  const abs = f => new RegExp('"/(icons|favicon)[^"]*"').test(f);
  chk(abs(site),
    '顶栏徽标用站根绝对路径（子目录页面也能取到，实际 ' +
      (site.match(/src="[^"]*icon\.svg"/) || ['未找到'])[0] + '）');

  const rel = PAGES.filter(f => /"(\.\/)?(icons|favicon)/.test(read(f)));
  chk(rel.length === 0,
    '每个页面的图标引用都落在站根上（子目录页面不再拼成 /xxx/icons/…，实际 ' +
      (rel.length ? rel.join('、') : '全部合格') + '）');

  const bad = [];
  PAGES.forEach(f => {
    const dir = f.includes('/') ? f.split('/')[0] + '/' : '';
    const refs = read(f).match(/(?:src|href)="([^"]+)"/g) || [];
    refs.forEach(r => {
      const u = r.match(/"([^"]+)"/)[1];
      if (!/\.(png|jpg|jpeg|svg|ico|webp|woff2?|webmanifest)$/.test(u)) return;
      if (/^(https?:|\/\/|data:|\/)/.test(u)) return;
      if (!fs.existsSync(path + dir + u.replace(/^\.\//, ''))) bad.push(f + ' → ' + u);
    });
  });
  chk(bad.length === 0,
    '页面里每个图片 / 图标 / 清单引用都能落到磁盘上的文件（实际 ' +
      (bad.length ? bad.join('；') : '零断链') + '）');
}
console.log(fails === 0 ? '\n🎉 布局避让测试全部通过' : '\n❌ ' + fails + ' 项失败');
process.exit(fails ? 1 : 0);

