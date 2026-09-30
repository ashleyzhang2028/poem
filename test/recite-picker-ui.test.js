// 「加入背诵」弹框底部那一行（Issue #370 第三轮，用户 2026-09-30）
//
// 用户原话：
//   「加入背诵的弹框 新建集合，例如：我要背的 这里的 placeholder 字号有点大，
//     应该去掉变大的字号  右侧 新建按钮居然两行显示，极其丑陋」
//
// 两件事都不是「随手调个像素」，是两个真回退：
//
//   ① **placeholder 字比输入框自己的字还大**。`css/style.css` 里有一条 700px 以下的
//      规矩（原先是为了治 iOS 上小于 16px 的输入框聚焦会自己放大页面）：
//          @media screen and (max-width: 700px) { input:not(...) { font-size: 16px } }
//      它选中的是 **input 本体**。输入框自己的字（`--ctl-font-md` 14px）被顶成 16px，
//      而 `.settings-input::placeholder`（14px）没被顶 —— 于是光看数字是「placeholder
//      更小」，真机上是**输入框的字 16px / 提示语 14px 反过来**：提示语比打出来的字
//      大一圈，还很稀疏。真要保住那一层，得让 16px 只管**真实输入**，提示语一直跟着
//      输入框走。
//
//   ② **「新建」两个字被挤成两行**。`.recite-new` 是一行 flex（输入框 flex:1 + 这颗键），
//      键是 `.btn.ghost-btn`：`.btn` 的通身本领是 `flex: 1`（它本来是「一排通栏按钮」用的），
//      高度 `--ctl-h-lg` 44px，框里只给 0/28px 的内边距。390px 上实测键只剩 54px 宽，
//      两个 15px 的字要 30px，加上 `.btn` 的 44px 行高，字就折了行 —— 真机上那两个字
//      竖着排，一行里最丑的就它。
//
// 界面测试层已按 Issue #278 删除，所以这里**只做静态判据**（读源码 + 读 CSS），
// 不起浏览器。要真量像素，跑 `node scripts/serve.js`，390×844 真机看一眼。
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const classic = fs.readFileSync(path.join(root, 'css/classic.css'), 'utf8');
const style = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
const core = fs.readFileSync(path.join(root, 'js/reader-core.js'), 'utf8');

const pick = (src, head, tail) => {
  const a = src.indexOf(head);
  return a < 0 ? '' : src.slice(a, src.indexOf(tail, a));
};

console.log('');
console.log('=== 一、弹框的骨架没变（那颗键还是 .btn.ghost-btn） ===');

chk(/class="recite-cols" id="gw-recite-cols"/.test(core),
  '列表容器 .recite-cols 还在');
chk(/class="recite-new"/.test(core), '底部那一行还是 .recite-new');
chk(/class="btn ghost-btn" id="gw-recite-create"/.test(core),
  '「新建」还是 .btn.ghost-btn（不换 class，只把它在单行里的体量按住）');
chk(/id="gw-recite-new"[^>]*placeholder="新建集合，例如：我要背的"/.test(core),
  '输入框还是 #gw-recite-new + 那句 placeholder');

console.log('');
console.log('=== 二、placeholder 不许比输入框自己的字大 ===');

const phFix = pick(classic, '.recite-new .settings-input::placeholder', '}');
chk(phFix.length > 0, 'css/classic.css 里给这一处的 ::placeholder 单独立了规矩');
chk(/font-size:\s*var\(--ctl-font-md\)/.test(phFix),
  '提示语字号钉在 --ctl-font-md（14px），跟输入框自己的字号同档');

// 输入框自己那一档也是 14px —— 两边同一个变量，谁也不会反超谁
chk(/\.settings-input\s*\{[\s\S]{0,400}?font-size:\s*var\(--ctl-font-md\)/.test(style),
  '.settings-input 自己的字号也是 --ctl-font-md —— 两边同源，不会一边被顶大');

// 那条 700px 以下的 16px 规矩本身留着（iOS 聚焦放大还是要治），但不能再把提示语带大
chk(/@media screen and \(max-width: 700px\)[\s\S]{0,220}?font-size:\s*var\(--input-font-narrow\)/.test(style),
  '窄屏那条 16px 的输入框规矩还在（iOS 聚焦不自放大），没被顺手删掉');
chk(!/\.settings-input::placeholder\s*\{[^}]*font-size:\s*var\(--input-font-narrow\)/.test(style),
  '全站没有哪一处把「提示语」也钉成 16px —— 大的是输入、不是提示');

console.log('');
console.log('=== 三、「新建」是一行里的一颗窄键，不许换行 ===');

const btnFix = pick(classic, '.recite-new .ghost-btn', '}');
chk(btnFix.length > 0, 'css/classic.css 里给这一行的「新建」单独立了规矩');
chk(/flex:\s*0 0 auto/.test(btnFix),
  '键 flex: 0 0 auto —— 不再吃 .btn 那把 flex: 1（不再跟输入框抢宽）');
chk(/white-space:\s*nowrap/.test(btnFix),
  'white-space: nowrap —— 「新建」两个字不折行');
chk(/height:\s*var\(--ctl-h-md\)/.test(btnFix),
  '高度收到 --ctl-h-md（38px），与旁边输入框同高（不再用 .btn 的 44px）');
chk(/font-size:\s*var\(--ctl-font-md\)/.test(btnFix),
  '字号收到 --ctl-font-md（14px），不再是 .btn 的 15px');
chk(/line-height:\s*var\(--ctl-leading-md\)/.test(btnFix),
  '行高收到 --ctl-leading-md —— 是它把字挤折行的，必须一起收');
chk(/padding:\s*0 18px/.test(btnFix),
  '左右给足内边距（18px）—— 「新建」两个字不贴边');

const row = pick(classic, '.recite-new {', '}');
chk(/align-items:\s*center/.test(row),
  '这一行 align-items: center —— 输入框与键中线对齐');
chk(/\.recite-new \.settings-input\s*\{[^}]*min-width:\s*0/.test(classic),
  '输入框 min-width: 0 —— 窄屏上先压输入框，不把键挤变形');

console.log('');
if (fails) { console.log('失败 ' + fails + ' 项'); process.exit(1); }
console.log('全部通过');
