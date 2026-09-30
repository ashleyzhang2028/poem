"use strict";

// 飞花令「闯关模式」（Issue #356 P4）
// ---------------------------------------------------------------------------
// 用户 2026-09-30 要的是「让飞花令的闯关模式更加鲜活」。这一层守三件事：
//
//   ① **判分内核**（js/quiz.js）：一句作答算不算「写对了」？
//      —— 一句一字不差地存在语料里、且含令字，才算；标点随便敲（全角半角、
//         带不带逗号），只要那些**连着的汉字**对得上就算。太短的不放（免得
//         一个字蒙对），没带令字的不算，语料里没有的句子不算。
//   ② **两种形态并存**（js/game.js）：闯关是**并列增量**，从前的「查一查」
//      一个字不改还在那儿；闯关里不给「看答案」（摊开答案 = 把题答了）。
//   ③ **两端同一个范围**（api/_lib/game.js）：判分语料跟着用户选的范围走。
//      这条最容易被忘掉：查一查按 scope 过滤、服务器还扫全站，就会出现
//      「界面说没有、服务器说对上」各说一套。
//
// 界面测试层已按 Issue #278 删除，所以渲染那部分只做静态判据（读源码），
// 不起浏览器。判分内核是真跑（纯逻辑，Node 直接 require）。
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

let fails = 0;
const chk = (c, m) => { if (!c) { console.log("✗ " + m); fails++; } else console.log("✓ " + m); };
const eq = (a, b, m) => chk(a === b, m + "（实际 " + JSON.stringify(a) + "）");

const Q = require("../js/quiz.js");
const gameSrc = read("js/game.js");
const cssSrc = read("css/account.css");
const serverGame = read("api/_lib/game.js");

const POEMS = [
  { id: "p1", book: "poems", title: "登鹳雀楼", text: "白日依山尽，黄河入海流。欲穷千里目，更上一层楼。", grade: 1 },
  { id: "p2", book: "poems", title: "凉州词", text: "黄河远上白云间，一片孤城万仞山。", grade: 2 },
  { id: "p3", book: "tangshi", title: "将进酒", text: "君不见黄河之水天上来，奔流到海不复回。", grade: 0 }
];

console.log("");
console.log("一、判分内核：什么算「写对了」");

{
  const ok = (said, m) => {
    const r = Q.judgeSetLine({ poems: POEMS, chars: ["黄"], said });
    chk(r.ok, m + "（" + said + "）");
    return r;
  };
  const no = (said, why, m) => {
    const r = Q.judgeSetLine({ poems: POEMS, chars: ["黄"], said });
    chk(!r.ok && r.why === why, m + "（" + said + " → " + r.why + "）");
  };

  ok("黄河入海流", "整句照抄算对");
  ok("黄河远上白云间", "另一首里的句子也算对");
  ok("君不见黄河之水天上来", "含令字的长句算对");
  ok("黄河入海流。", "末尾带句号照旧算对（标点不该成为门槛）");
  ok("白日依山尽，黄河入海流", "只写其中一段，只要是**连着**的一段就算对");

  no("更上一层楼", "nochar", "写对了但没带令字：不算（这是飞花令，不是背诗）");
  no("黄河", "short", "太短：不放（一个字蒙对不算）");
  no("我想不起来", "nochar", "随口一句：不算");
  no("黄河之水滚滚来", "notfound", "像诗但不是语料里的句子：不算（不猜近似）");
  no("   ", "empty", "空的：不算");
  no("入海流更上一层楼", "nochar", "自己拼的两句：不算（拼出来的那一段里没有令字）");
  no("黄河入海流欲穷千里目", "notfound", "两句硬接在一起：不算（删掉标点也不是语料里的那一句）");

  const r = Q.judgeSetLine({ poems: POEMS, chars: ["黄"], said: "黄河入海流" });
  eq(r.row && r.row.id, "p1", "命中时回带那一条句子的出处（用来回显「在合集里对上了：……」）");
}

console.log("");
console.log("二、关卡排布：令字 → 一关一句库，同一份种子两边一致");

{
  const a = Q.levelChars(POEMS, { chars: ["黄"], per: 2, min: 1, seed: "0" });
  eq(a.chars.length, 1, "只挑得出一个够闯的令字时，就一关");
  chk(a.levels[0].pool.length === 3, "这一关的句库是语料里带「黄」的全部 3 句");

  const short = Q.levelChars(POEMS, { chars: ["黄"], per: 2, min: 99, seed: "0" });
  eq(short.levels.length, 0, "语料里带这个字根本没几句时，不给这一关（免得一关都闯不过）");

  // 只含碎段（「水」「水长流」这类）的句子不该进句库 —— 它们判不过 short 那道关
  chk(Q.passable("处处闻啼鸟") === true && Q.passable("水") === false && Q.passable("水长流") === false,
    "passable()：够一句的算能作答，碎段不算");

  const b1 = Q.levelChars(POEMS, { chars: ["黄", "河"], per: 2, min: 1, seed: "s1" });
  const b2 = Q.levelChars(POEMS, { chars: ["黄", "河"], per: 2, min: 1, seed: "s1" });
  eq(JSON.stringify(b1), JSON.stringify(b2), "同一个种子 → 同一副关卡（前后端算得一样才敢让服务器判）");
}

console.log("");
console.log("三、两种形态并存：查一查不动，闯关是并列的增量");

{
  chk(/data-game-fly-kind/.test(gameSrc), "飞花令屏上有「查一查 / 闯关」的分段");
  chk(/"look"/.test(gameSrc) && /"level"/.test(gameSrc), "两种形态各有一个 id（look / level）");
  chk(/flyKind: "look"/.test(gameSrc), "默认进的是从前的「查一查」（旧路径不许被顶掉）");
  chk(/function renderFlyLook\(/.test(gameSrc), "旧的「查一查」渲染整段留着（不是原地改造）");
  chk(/data-game-say/.test(gameSrc) && /function checkSaid/.test(gameSrc),
    "「自己写一句 + 核一核」那条路一个字没动");
  chk(/state\.flyKind !== "level"/.test(gameSrc),
    "闯关形态下不渲染「看答案」页底那块（摊开答案 = 把这一关答了）");

  // 闯关这张卡的引导语要与「作答」卡同一条口径（Issue #356 第五轮：不要
  // 「照抄」这种引导，要的是用户自己想起来的句子）。
  const lvHtml = (gameSrc.match(/function renderFlyLevel\(\)[\s\S]*?\n  \}/) || [""])[0];
  chk(!!lvHtml, "找得到闯关那一段的渲染片段（renderFlyLevel）");
  chk(!/整句照抄/.test(lvHtml), "闯关里没有「整句照抄」这个引导（与作答卡同口径）");
  chk(/LEVEL_PLACEHOLDER/.test(lvHtml),
    "闯关的示例句是与作答卡同一个常量，不是从这一关句库里挑的（那是把答案摊给用户看）");

  chk(/function startFlyLevel\(/.test(gameSrc), "有闯关的发牌函数");
  chk(/LEVEL_SECONDS = 45/.test(gameSrc), "闯关有限时（45 秒一关）");

  // 句库里不许留判不过的短句 —— 用户照着它抄，反而被判「太短，写整一点」。
  chk(/passable: passable/.test(read("js/quiz.js")), "判分内核导出 passable()（句库筛选与判分门槛共用一个数）");
  chk(/var MIN_SAY_HAN = 4/.test(read("js/quiz.js")), "门槛只写一次（MIN_SAY_HAN）");
  chk(/Q\.passable\(r\.text\)/.test(gameSrc), "闯关的句库筛掉判不过的短句");
  chk(/return r\.text\.indexOf\(c\) >= 0 && passable\(r\.text\)/.test(read("js/quiz.js")),
    "levelChars() 挑关时也走同一道筛子");
  chk(/function levelHintText\(/.test(gameSrc), "卡住会给提示");
  chk(/lvStreak/.test(gameSrc) && /lvBest/.test(gameSrc), "连对与最好成绩都记着");
  chk(/function levelPass\(/.test(gameSrc), "答对翻下一关的那条路单独成函数");
  // 判据收窄：整份源码里「失败」是既有文案（「读取失败，稍后再试。」），
  // 要守的是**说用户**的时候不出现这两个字 —— 倒计时到点也只说「先放着」。
  // 说用户「答得怎么样」的那几行不许出现否定字眼。判据只扫闯关那一段的用户文案
  // 与判分口径（levelDoneRow 的对照表），不扫既有的「读取失败，稍后再试。」
  // 那类跟成绩无关的话 —— 那是网络错误，不是对用户的评价。
  const lvMsgTable = (gameSrc.match(/function levelDoneRow\(\)?[\s\S]{0,700}?\n  \}/) || [""])[0];
  chk(!!lvMsgTable, "找得到 levelDoneRow()：闯关里「答得怎么样」的话只有一个出处");
  chk(!/失败|不及格/.test(lvMsgTable.replace(/\/\/[^\n]*/g, "")),
    "闯关里不拿「失败 / 不及格」说用户（与成绩横幅同一套鼓励口吻）");
  chk(!/levelDoneRow\(false, "timeout"[\s\S]{0,80}失败/.test(gameSrc), "倒计时到点不说「失败」");
  chk(/timeout: "这一关先放着"/.test(gameSrc), "到点的说法是「这一关先放着」（不是判错、也不是失败）");
  chk(/data-game-home/.test(gameSrc) && /hit\("data-game-home"\)/.test(gameSrc),
    "空关那颗「换一个题型」有真处理函数（data-game-back 全场没处理函数，是个死按钮）");
  chk(cssSrc.indexOf(".game-lv-char") >= 0 && cssSrc.indexOf(".game-lv-row") >= 0,
    "闯关的样式在 css/account.css 里（令字 + 连对清单）");
}

console.log("");
console.log("四、范围只管令字，不管作答（Issue #356 · 用户 2026-09-30 裁决）");

{
  // 用户原话：「令为风字，我回答了 春风不度玉门关，结果答案说不在范围内……
  //   我的初始出题范围确实是目标范围内的令字，但我的回答可以超出当前范围吧，
  //   否则没法回答了」。
  //
  // 范围收的是**题**（令字从哪一份语料里挑），不收**答**（你想起来的是哪一句）。
  // 王之涣《凉州词》只在乐府集里，不在课内 251 首里 —— 从前判分跟着范围走，
  // 于是「小学」范围里答它，一句真诗被判成「合集里没有」。

  chk(/function scoped\(scopeId\)/.test(serverGame), "服务端把范围收在同一处（scoped）");
  chk(/function answerCorpus\(/.test(gameSrc), "前端有一个「判作答用的语料」的出处（answerCorpus）");
  chk(/poems: answerCorpus\(\)/.test(gameSrc),
    "作答（查一查 checkSaid）扫整份语料，不按范围收窄");
  chk(/judgeSetLine\(\{ poems: answerCorpus\(\)/.test(gameSrc),
    "作答（闯关 checkLevelSaid）也扫整份语料，不按范围收窄");
  chk(/scopedCorpus\(\)\.slice\(\)/.test(gameSrc) === false, "…（判分语料不再从 scopedCorpus 来）");
  chk(/function scopedCorpus\(/.test(gameSrc) && /state\.chars = pickChars\(cps, state\.level, state\.flyRound\)/.test(gameSrc),
    "令字仍按范围挑（题该收：选了小学就从小学挑令字）");
  chk(/scopeId: state\.setup\.scope/.test(gameSrc), "请求里仍带 scopeId（判分扫全站、但范围这一痕留着）");
  chk(/require\(path\.join\(ROOT, "js", "exam\.js"\)\)/.test(serverGame),
    "服务端的范围过滤与前端同源（require js/exam.js 的 select，不另写一套）");
  chk(/scopeId: o\.scopeId/.test(read("js/account-api.js")), "前端把 scopeId 一起带到判分口");

  try {
    const SG = require("../api/_lib/game.js");

    // ⚠️ 这一条就是用户报的那件事本身。修前 found=false（被判「不在范围内」）。
    const cross = SG.checkFly({ chars: ["风"], said: "春风不度玉门关", scopeId: "poems:primary" });
    chk(cross.found === true,
      "小学范围里答「春风不度玉门关」（乐府集里的句子）→ 算对（范围不收作答）");
    eq(cross.title, "凉州词", "…并回带出处，让用户知道那句从哪来");
    chk(cross.inScope === false, "…如实报 inScope=false（它在范围外，不假装在小学里）");

    // 反过来：范围**内**的句子照旧算对，inScope=true。
    const inside = SG.checkFly({ chars: ["黄"], said: "黄河入海流", scopeId: "poems:primary" });
    chk(inside.found === true && inside.inScope === true, "课内那句：算对，inScope=true");

    // 集子级范围也是同一条规矩：答别的集子的句子照样算对。
    // 用「白毛浮绿水」（只在课内《咏鹅》里，唐诗三百首里没有）——
    // 拿「黄河入海流」试不出来：它课内课外在都在，inScope 本来就是 true。
    const tan = SG.checkFly({ chars: ["白"], said: "白毛浮绿水", scopeId: "book:tangshi" });
    chk(tan.found === true && tan.inScope === false,
      "选了唐诗三百首、答课内的一句 → 也算对，且如实报它不在这个集子里");

    // 语料里根本没有的句子，照旧判「没找到」——宽是宽在「不按范围卡」，不是「什么都算对」。
    const none = SG.checkFly({ chars: ["风"], said: "春风不度阳关道", scopeId: "poems:primary" });
    chk(none.found === false, "语料里没有的句子照旧判没找到（不猜近似）");

    // 服务端从前**收窄不了课内三学段**（语料里没带 grade，`scoped()` 一律退全站、
    // 永远报 exact=false）。这一轮把 grade/term 补进了服务端语料，它现在收得动了：
    // 小学 119 篇 / 初中 81 篇，与 README 的表对得上。
    const pri = SG.checkFly({ chars: ["白"], said: "白毛浮绿水", scopeId: "poems:primary" });
    chk(pri.scopeExact === true && pri.inScope === true,
      "课内学段服务端也收得动（exact=true，不再一律退全站）");
    eq(SG.scoped("poems:primary").corpus.length, 119, "服务端的小学范围 = 119 篇（与前端同一份）");
    eq(SG.scoped("poems:middle").corpus.length, 81, "服务端的初中范围 = 81 篇");
    const bad = SG.checkFly({ chars: ["黄"], said: "黄河入海流", scopeId: "nonsense" });
    chk(bad.scopeExact === false, "认不出的范围也不抛（退回全站，如实报 exact=false）");
  } catch (e) {
    chk(false, "checkFly 能直接跑（" + e.message + "）");
  }
}

console.log("");
console.log(fails ? ("❌ " + fails + " 条失败") : "🎉 飞花令闯关模式测试全部通过");
process.exit(fails ? 1 : 0);
