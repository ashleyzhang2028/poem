// 飞花令「令字」的排版（Issue #356 第二轮，用户 2026-09-30 裁决）
//
// 用户看到的是（390×844，真机）：
//
//     达  掘          ← 汉字
//     dá              ← 拼音在**下面**（且只有第一个字有）
//
// 两件事要守：
//   ① **拼音在上、汉字在下** —— DOM 里拼音那一行必须先出现；
//   ② 两个令字**汉字基线对齐** —— 从前令字盒用 `align-items: flex-end` 横排，
//      而「有拼音的字」与「没拼音的字」盒高不一样（拼音表里查不到的字不渲染
//      拼音行），真机量到 390×844 上：有拼音的盒 58px、没拼音的盒 42px，
//      汉字高低差 8px。
//
// 界面测试层已按 Issue #278 删除，所以这里**只做静态判据**（读源码 + 读 CSS），
// 不起浏览器。要真量像素，跑 `node scripts/serve.js` 自己看一眼。
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };

const game = fs.readFileSync(path.join(root, 'js/game.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/account.css'), 'utf8');

// --- ① 拼音那一行的 DOM 次序：拼音 → 汉字 --------------------------------
// 找一个令字的模板片段：含 game-char-py 与 game-char-han 的那一段
const m = game.match(/<div class="game-chars">'[\s\S]{0,600}?join\(""\) \+ "<\/div>"/);
chk(!!m, '在 js/game.js 里找得到令字的渲染片段');
if (m) {
  const frag = m[0];
  const iPy = frag.indexOf('game-char-py');
  const iHan = frag.indexOf('game-char-han');
  chk(iPy >= 0, '令字有专门的拼音行 `.game-char-py`');
  chk(iHan >= 0, '令字有专门的汉字行 `.game-char-han`');
  chk(iPy >= 0 && iHan >= 0 && iPy < iHan,
    '拼音行排在汉字行**前面**（拼音在上、汉字在下）');
}

// 不许用 CSS 的 order / column-reverse 去「翻」DOM 顺序 —— 那样读屏念出来
// 是「字 → 音」，与看到的相反
chk(!/\.game-char[^}]*flex-direction:\s*column-reverse/.test(css),
  '不靠 column-reverse 视觉翻转（读屏与视觉顺序须一致）');
chk(!/\.game-char-py\s*\{[^}]*order:\s*-?\d/.test(css),
  '不靠 order 视觉翻转（读屏与视觉顺序须一致）');

// --- ② 两字的汉字基线必须对齐 -------------------------------------------
// 令字盒：横排不能再用 flex-end（底边对齐），得用 center（盒等高时 = 汉字对齐）
const charsBlock = (css.match(/\.game-chars\s*\{[^}]*\}/) || [''])[0];
chk(/align-items:\s*center/.test(charsBlock),
  '令字横排用 align-items: center（不是 flex-end —— 盒高不一时汉字会错开）');
chk(!/align-items:\s*flex-end/.test(charsBlock), '令字横排不再用 flex-end');

// 拼音行定高：有拼音的字与没拼音的字盒高一致，汉字基线才对得上
const pyBlock = (css.match(/\.game-char-py\s*\{[^}]*\}/) || [''])[0];
const pyH = (pyBlock.match(/height:\s*(\d+)px/) || [])[1];
chk(!!pyH && Number(pyH) > 0,
  '拼音行有定高（否则没拼音的字盒矮一截，汉字基线错开；实际 height=' + (pyH || '无') + '）');

// 没拼音的字也得渲染这一行 —— 空着占位，盒高才一致
chk(!/pinyinOf\(c\)\s*\?/.test(game),
  '不再「有拼音才渲染拼音行」—— 空着也要占位，两盒才等高（基线对齐）');

// --- ③ CSS 里不许留下「拼音在汉字下面」的老写法 ---------------------------
// 老写法是 .game-char 用 flex-direction: column 让汉字在前、拼音在后。
// 现在顺序由 DOM 定，CSS 只管纵排。判据：确有一条纵排，且没有 margin-top
// 把拼音往下推（那正是「拼音沉到下面」的视觉来源）。
chk(/\.game-char\s*\{[^}]*flex-direction:\s*column/.test(css),
  '令字盒仍是纵排（拼音一行 + 汉字一行）');

// --- ④ 「为什么一次给两个字」的出处必须在场上 -------------------------------
// 用户 2026-09-30 问的原话：「为什么每次出两个令字，是有什么原因吗」
// —— 原因 09804fc 就写在代码里，后来被 75ddaf8（「去掉 css/js/html 里的所有
// 注释」）整批删掉，于是这一个决定变成了「没人知道为什么」的既成事实。
// 这一层钉住它：理由必须留在 pickChars() 旁边。
chk(/一次给两个字/.test(game),
  'pickChars() 旁边留着「一次给两个字」的理由（两个字才有「凑一凑」的余地）');
chk(/单字太难|凑一凑/.test(game),
  '理由写得具体（为什么不是一个字），不是光留一句「给两个」');

console.log('');
if (fails) { console.log('失败 ' + fails + ' 项'); process.exit(1); }
console.log('全部通过');
