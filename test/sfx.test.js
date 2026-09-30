// 「答题音效」（Issue #356 第六轮，用户 2026-09-30）
//
// 用户原话：「也没听到任何声音，一点都不活跃和游戏闯关的感觉。包括出结果也应该有音效」。
//
// 第一版（P3）错在两点，这一层把两点都钉住：
//
//   ① **发声点太窄**。第一版只在「逐题即时判分」的三处响过 —— 题库、模拟题、
//      闯关；考试（交卷后批，`judge !== "instant"`，永远走不到那一行）、
//      飞花令的「核一核」、**交卷出分那一屏**全都没有声。用户说「没听到任何
//      声音」不是耳朵的问题，是这几处根本没接线。
//   ② **Web Audio 静默失效**。`new AudioContext()` 造出来是 `suspended`，
//      `resume()` 是异步的，`start()` 又必须排在 `currentTime` 之后 —— 三件事
//      凑不好就一声不响，而且不报错。所以解锁必须在用户手势里做，且每个会
//      发声的点击入口都要过一遍。
//
// 界面测试层已按 Issue #278 删除，所以「什么时候响」只做静态判据（读源码）；
// 「响成什么样」是真跑 `js/sfx.js`（纯逻辑，Node 里给个假 AudioContext 就能验
// 音符序列、分档、开关、以及「解不开就老实返回 false」）。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };
const eq = (a, b, m) => chk(a === b, m + '（实际 ' + JSON.stringify(a) + '）');

// --- 一个假的 AudioContext：只记「排了什么」，不管声音 ---------------------
function fakeCtx() {
  const log = { started: [], types: [], gains: [] };
  const node = () => ({
    connect() {},
    frequency: {
      value: 0,
      setValueAtTime(f, at) { log.started.push({ f, at }); }
    },
    gain: {
      value: 0,
      setValueAtTime() {},
      exponentialRampToValueAtTime(v) { log.gains.push(v); }
    },
    type: "",
    start(at) { log.started[log.started.length - 1].start = at; },
    stop() {}
  });
  return {
    log,
    state: "suspended",
    currentTime: 5,
    resume() { this.state = "running"; this.log.resumed = true; return Promise.resolve(); },
    createOscillator() { const n = node(); n.kind = "osc"; return n; },
    createGain() { return node(); },
    destination: {}
  };
}

function sandbox(extra) {
  const box = {
    localStorage: {
      _v: {},
      getItem(k) { return this._v[k] == null ? null : this._v[k]; },
      setItem(k, v) { this._v[k] = String(v); }
    },
    setTimeout(fn) { fn(); },
    Promise, isFinite, Number, String, Math, console
  };
  Object.assign(box, extra || {});
  box.window = box;
  vm.createContext(box);
  vm.runInContext(read("js/sfx.js"), box, { filename: "js/sfx.js" });
  return box;
}

console.log("");
console.log("一、四种声音都在一个出处：js/sfx.js");

const sfx = sandbox({ AudioContext: function () { return fakeCtx(); } });
const S = sfx.Sfx;

chk(!!S, "js/sfx.js 挂在 window.Sfx 上");
["answer", "pass", "rank", "play", "ready", "on", "write", "bandOf", "notesOf", "supported"].forEach(function (name) {
  chk(typeof S[name] === "function", "导出 " + name + "()");
});

// 开关还是那把键，且**默认开**（跟设备走、不跟账号走的依据在 sync-coverage.js）
eq(S.KEY, "poem_sound_v1", "开关键沿用 poem_sound_v1（同步边界总表里登记过的那把）");
eq(S.on(), true, "默认开（没写过这把键 = 开）");
S.write(false);
eq(S.on(), false, "关得掉");
eq(S.answer(true), false, "关着的时候一声不响，且老实返回 false（不假装响过了）");
S.write(true);

console.log("");
console.log("二、答对 / 答错 / 过关 / 出分，四种声音各有各的音符");

function notesAfter(fn) {
  const ctx = fakeCtx();
  const box = sandbox({ AudioContext: function () { return ctx; } });
  box.Sfx.play("ok");                 // 先解锁（第一声顺带解锁）
  ctx.log.started.length = 0;         // 清掉解锁那一响
  fn(box.Sfx);
  return ctx.log.started.slice();
}

{
  const ok = notesAfter(function (s) { s.answer(true); });
  const no = notesAfter(function (s) { s.answer(false); });
  chk(ok.length >= 2 && no.length >= 1, "答对有音、答错有音");
  chk(ok[ok.length - 1].f > ok[0].f, "答对是**上扬**的（最后一个音比第一个高）");
  chk(no[no.length - 1].f < ok[0].f, "答错明显比答对低（低沉的单音那一类，不是同一串）");
  chk(no[no.length - 1].f < 300, "答错落在低频（实际 " + no[no.length - 1].f.toFixed(1) + "Hz）");
  chk(no[no.length - 1].at - no[0].at < 0.4, "答错很短 —— 长下行音听着像「报错」，这里只要「不对」那一下");

  // 每个音符都排在「现在 + 一点」之后：不信 currentTime 那一刻排得进去
  chk(ok.every(n => n.start >= 5), "start() 排在 currentTime 之后（实际 currentTime = 5）");

  const pass = notesAfter(function (s) { s.pass(); });
  chk(pass.length >= 4, "过关是一串琶音（比答对那两三个音更长）");
  chk(pass[pass.length - 1].f > ok[ok.length - 1].f, "过关的最高音比答对还高 —— 听着更「过关」");
}

console.log("");
console.log("三、出分那一声按分数分档，三档**没有一档是下行**");

{
  function rankNotes(right, total) {
    const ctx = fakeCtx();
    const box = sandbox({ AudioContext: function () { return ctx; } });
    box.Sfx.play("ok");
    ctx.log.started.length = 0;
    box.Sfx.rank(right, total);
    return ctx.log.started.slice();
  }
  const gold = rankNotes(9, 10);
  const green = rankNotes(7, 10);
  const blue = rankNotes(1, 10);

  chk(gold.length > green.length && green.length > blue.length,
    "音数随分数档变多（90+ 五音收尾 / 60~89 三音 / <60 温柔两句）");
  [["金", gold], ["绿", green], ["蓝", blue]].forEach(function (row) {
    const list = row[1];
    const asc = list.every(function (n, i) { return i === 0 || n.f >= list[i - 1].f; });
    chk(asc, row[0] + "档不是下行音 —— 与成绩横幅同一套鼓励口吻，没有「失败」声");
  });
  chk(gold[gold.length - 1].f > 1000, "90+ 收在高音（金档那一串往上冲）");

  eq(S.bandOf(90), "gold", "90 分是金档");
  eq(S.bandOf(89.9), "green", "89.9 落到绿档");
  eq(S.bandOf(60), "green", "60 分是绿档");
  eq(S.bandOf(59.9), "blue", "59.9 落到蓝档");
  eq(S.bandOf(undefined), "blue", "没分数时不抛，按最低档走");

  // 分档边与成绩横幅（js/game.js 的 SCORE_BANDS）必须是同一套
  const gameSrc = read("js/game.js");
  chk(/min: 90[\s\S]{0,80}min: 60[\s\S]{0,80}min: 0/.test(gameSrc),
    "成绩横幅那三档的边也是 90 / 60 / 0（两边同源，改一边就得改另一边）");
}

console.log("");
console.log("四、解不开就老实说不支持，不静默失效");

{
  const none = sandbox({});   // 这台设备没有 AudioContext
  eq(none.Sfx.supported(), false, "没有 AudioContext 时 supported() = false");
  eq(none.Sfx.answer(true), false, "这种设备上 play 返回 false（页面据此可以给一句实话）");
  eq(none.Sfx.play("nonsense"), false, "不认识的声音名返回 false，不抛");

  // 解锁：resume 是异步的，要在它 then 里补一响；且只补一次
  const ctx = fakeCtx();
  const box = sandbox({ AudioContext: function () { return ctx; } });
  box.Sfx.play("ok");
  chk(ctx.log.resumed === true, "第一次发声时把 suspended 的 AudioContext resume 了（自动播放策略）");
  const before = ctx.log.started.length;
  box.Sfx.ready();
  eq(ctx.log.started.length, before, "解锁那一响只补一次，不每点一下都响");
}

console.log("");
console.log("五、发声点：四个题型都得响（这是用户说「没听到声音」的正解）");

{
  const gameSrc = read("js/game.js");
  const settingsSrc = read("js/settings.js");
  const roomSrc = read("settings/reader/index.html");
  const dahuiSrc = read("dahui/index.html");

  chk(!/new (window\.)?(AudioContext|webkitAudioContext)/.test(gameSrc),
    "js/game.js 里不再自己造 AudioContext（声音收在 js/sfx.js 一处）");
  chk(/window\.Sfx/.test(gameSrc), "js/game.js 从 window.Sfx 取声音");

  // ① 考试逐题判分（题库 / 模拟题）
  chk(/playSound\(justRight\)/.test(gameSrc), "考试逐题判分那一处还在响");
  // ② 飞花令「查一查」的核一核 —— 第一版整个漏掉
  chk(/playSound\(!!local\)/.test(gameSrc),
    "飞花令「核一核」按**本机那一条**立刻响（等服务器一个来回再响就晚了半拍）");
  // ③ 闯关的过关 / 断关
  chk(/playPass\(\)/.test(gameSrc) && /function playPass\(/.test(gameSrc), "闯关答对是单独那一声「过关」");
  chk(/levelFail[\s\S]{0,220}?playSound\(false\)/.test(gameSrc), "闯关断关（含倒计时到点）也响");
  // ④ 交卷出分 —— 用户点名要的那一处
  chk(/playRank\(state\.graded\)/.test(gameSrc), "交卷出分那一屏有声音（用户点名「出结果也应该有音效」）");
  chk(/state\.gradedAnimated = true[\s\S]{0,600}?playRank\(state\.graded\)/.test(gameSrc),
    "出分那一声与成绩横幅的数字滚动同起（state.gradedAnimated 顺带挡住重复播放）");

  // 解锁必须在手势里：会发声的点击入口逐个过一遍
  chk(/function unlockSound\(/.test(gameSrc), "有 unlockSound()：解锁音频的唯一出口");
  // 取 bind() 那一段（点击分派都在里面）
  const hitIdx = gameSrc.indexOf("function bind() {");
  const body = gameSrc.slice(hitIdx, gameSrc.indexOf("\n  function openPoem", hitIdx));
  const cases = [
    ["data-game-opt", /var opt = hit\("data-game-opt"\)[\s\S]{0,400}?unlockSound\(\)/],
    ["data-game-submit", /hit\("data-game-submit"\)\s*;\s*if \(sub\) \{ unlockSound\(\)/],
    ["data-game-say", /hit\("data-game-say"\)\s*;\s*if \(say\) \{ unlockSound\(\)/],
    ["data-game-lv-say", /hit\("data-game-lv-say"\)\s*;\s*if \(lvSay\) \{ unlockSound\(\)/]
  ];
  cases.forEach(function (row) {
    chk(row[1].test(body),
      "点了 " + row[0] + " 先解锁音频（自动播放策略：必须在用户手势里）");
  });

  // 脚本必须真的引到页面上 —— 漏一个 <script> 就是「代码在、页面不响」
  chk(/js\/sfx\.js/.test(dahuiSrc), "/dahui/ 引了 js/sfx.js");
  chk(/\/js\/sfx\.js/.test(roomSrc), "设置 · 阅读与朗读页引了 js/sfx.js");

  // 设置页：开关旁边有个「试听一声」——点开开关就该知道这台设备出不出声
  chk(/id="sound-try"/.test(roomSrc), "设置页有「试听一声」");
  chk(/sound-try[\s\S]{0,120}?trySound/.test(settingsSrc), "那颗按钮接的是 trySound()");
  chk(/function trySound\(/.test(settingsSrc), "trySound() 真的在 js/settings.js 里");
  chk(/trySound\(\)/.test(settingsSrc.slice(settingsSrc.indexOf('soundToggle.addEventListener'), settingsSrc.indexOf('soundTry'))),
    "打开开关时顺手响一声（这台设备出不出声，当场就知道）");
}

console.log("");
if (fails) { console.log("❌ 失败 " + fails + " 项"); process.exit(1); }
console.log("🎉 答题音效测试全部通过");
