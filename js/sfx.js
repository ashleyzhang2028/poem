// 答题音效（Issue #356 P3 的第一版留在 js/game.js 里，第六轮抽出来重做）
//
// ---------------------------------------------------------------------------
// 抽出来的理由
// ---------------------------------------------------------------------------
// 用户 2026-09-30 的原话：「也没听到任何声音，一点都不活跃和游戏闯关的感觉。
// 包括出结果也应该有音效」。
//
// 翻旧账：第一版只写了两种声音（答对 880→1318.5Hz 的上扬双音 / 答错 220Hz
// 的低沉单音），而且一共只在三处调过 —— 考试逐题判分（还得是 `judge: instant`
// 的题库与模拟题，交卷制的「考试」根本走不到那一行）、闯关的答对答错。
// 飞花令的「查一查」（核一核、连读）一声不响；交卷出分那一屏是**最该有声的
// 时刻**（横幅 + 数字滚动都在那儿），也没有声。换句话说：听见过的路本来就窄。
//
// 更要紧的是「点了没反应」这条老毛病（本 Issue 已经修过两次同类的东西：
// 「换令」的种子取自身、空关那颗没有处理函数的死按钮）。Web Audio 上它是
// 一个**静默失效**：`new AudioContext()` 造出来是 `suspended`，`resume()` 是
// 异步的，而 `start()` 要排在 `currentTime` 之后。第一版把这两件事同时丢给
// 浏览器安排，运气不好（尤其中文语音在朗读时占着音频通道）就一声都出不来，
// 控制台也不报错。所以这里：
//
//   · 第一次**真碰屏幕**时才 create/resume（自动播放策略要求手势），
//     resume 的 then 里补一声很轻的过门 —— Safari 与部分安卓 Chrome 要这么
//     一下才算真正解锁，之后每一声都稳；
//   · `start()` 一律排在「现在 + 24ms」之后，不信 `currentTime` 那一刻排得进去；
//   · 单个 OscillatorNode 换成「Oscillator + 包络 Gain」的整套小合成，
//     每种声音 = 一串音符（freq / at / dur / type），改口味只动这张表。
//
// ---------------------------------------------------------------------------
// 落在哪个文件、由谁读
// ---------------------------------------------------------------------------
// 放全局 `js/sfx.js`，不塞进 `js/game.js`：设置页那个「答题音效」开关
// （`settings/reader/index.html`）也要能试听一声（「点击试听一声」），
// 声音的出处与开关的出处得是同一个，不然两边会各响各的。
//
// 开关仍是 `poem_sound_v1`（**设备域**，跟设备走不跟账号走 —— 换一台没插
// 耳机的设备不该被迫继承静音），与 `js/sync-coverage.js` 里登记的那条一致。
//
// ---------------------------------------------------------------------------
// 四种声音，都用 Web Audio 现场合成，不带任何音频文件（离线仍可用）
// ---------------------------------------------------------------------------
//   ok     答对           C5 → E5 → G5 的分解三音，明亮、上扬
//   no     答错           160Hz 的一声闷响，短、不刺耳（不是「嗡」的长音）
//   pass   闯关过关        E6 那一响 + 一串快速上行的琶音，比 ok 更「过关」
//   rank   交卷出分        前奏（G4 A4 B4）+ 按分数档上行的和弦
//                         90+ = 五音收尾（金）· 60~89 = 三音（绿）· <60 = 温柔两句（蓝）
//                         三档都是鼓励的口吻 —— 与成绩横幅同一套纪律，
//                         没有一档是「失败」的下行音。
//
// 音高取十二平均律：A4 = 440Hz，f(n) = 440 * 2^((n-69)/12)。
(function (root) {
  "use strict";

  var KEY = "poem_sound_v1";

  // 半音 → 频率。写音名（C5 / A4）比写 523.25 好核对。
  var NOTES = {
    "G3": 196.00, "A3": 220.00,
    "C4": 261.63, "D4": 293.66, "E4": 329.63, "G4": 392.00, "A4": 440.00, "B4": 493.88,
    "C5": 523.25, "D5": 587.33, "E5": 659.25, "G5": 783.99, "A5": 880.00, "B5": 987.77,
    "C6": 1046.50, "E6": 1318.51, "G6": 1567.98
  };

  function hz(name) {
    var v = NOTES[String(name || "").toUpperCase()];
    return v || 0;
  }

  // 一种声音 = 音符表 + 一个总音量。
  // at 是相对这一声起点的偏移（秒），dur 是每个音符自己的长度。
  var VOICES = {
    ok: {
      gain: 0.17,
      notes: [
        { n: "C5", at: 0,    dur: 0.11, type: "sine" },
        { n: "E5", at: 0.07, dur: 0.11, type: "sine" },
        { n: "G5", at: 0.14, dur: 0.20, type: "sine" }
      ]
    },
    no: {
      // 低沉单音，但只 0.18s —— 长了下行音会像「报错」，这里只要「不对」那一下
      gain: 0.16,
      notes: [
        { n: "G3", at: 0,    dur: 0.09, type: "sine" },
        { n: "A3", at: 0.07, dur: 0.16, type: "sine" }
      ]
    },
    pass: {
      gain: 0.16,
      notes: [
        { n: "E6", at: 0,     dur: 0.10, type: "triangle" },
        { n: "C6", at: 0.08,  dur: 0.09, type: "triangle" },
        { n: "E6", at: 0.16,  dur: 0.09, type: "triangle" },
        { n: "G6", at: 0.24,  dur: 0.22, type: "triangle" }
      ]
    }
  };

  // 交卷出分：前奏共用，收尾按分数档
  var RANK_INTRO = [
    { n: "G4", at: 0,    dur: 0.10, type: "sine" },
    { n: "A4", at: 0.09, dur: 0.10, type: "sine" },
    { n: "B4", at: 0.18, dur: 0.13, type: "sine" }
  ];
  var RANK_TAIL = {
    gold: {
      gain: 0.19,
      notes: [
        { n: "C5", at: 0.30, dur: 0.12, type: "triangle" },
        { n: "E5", at: 0.40, dur: 0.12, type: "triangle" },
        { n: "G5", at: 0.50, dur: 0.12, type: "triangle" },
        { n: "C6", at: 0.60, dur: 0.14, type: "triangle" },
        { n: "E6", at: 0.74, dur: 0.42, type: "triangle" }
      ]
    },
    green: {
      gain: 0.17,
      notes: [
        { n: "C5", at: 0.30, dur: 0.12, type: "triangle" },
        { n: "E5", at: 0.42, dur: 0.12, type: "triangle" },
        { n: "G5", at: 0.54, dur: 0.34, type: "triangle" }
      ]
    },
    blue: {
      // <60 也不给下行音：两句温柔的上行，与横幅那句「再练一次，会更好」同口气
      gain: 0.15,
      notes: [
        { n: "D5", at: 0.30, dur: 0.18, type: "sine" },
        { n: "G5", at: 0.48, dur: 0.30, type: "sine" }
      ]
    }
  };

  function voiceOf(name, band) {
    if (name === "rank") {
      var tail = RANK_TAIL[band] || RANK_TAIL.green;
      return { gain: tail.gain, notes: RANK_INTRO.concat(tail.notes) };
    }
    return VOICES[name] || null;
  }

  // 成绩档 → 收尾音。分档与成绩横幅（≥90 金 / 60~89 绿 / <60 蓝）共用同一套边。
  function bandOf(pct) {
    var n = Number(pct);
    if (!isFinite(n)) n = 0;
    if (n >= 90) return "gold";
    if (n >= 60) return "green";
    return "blue";
  }

  var ctx = null;
  var unlocked = false;

  function on() {
    try {
      var v = root.localStorage.getItem(KEY);
      return v == null ? true : v !== "0";
    } catch (e) { return true; }
  }

  function write(onoff) {
    try { root.localStorage.setItem(KEY, onoff ? "1" : "0"); } catch (e) { }
    return !!onoff;
  }

  function Ctor() {
    return root.AudioContext || root.webkitAudioContext || null;
  }

  function supported() { return !!Ctor(); }

  // 造 / 解一层 AudioContext。**必须在用户手势里调**（自动播放策略），
  // 所以下面每个入口都挂在 click / change 上，没有一个从定时器里自己响。
  function ready() {
    var C = Ctor();
    if (!C) return null;
    if (!ctx) {
      try { ctx = new C(); } catch (e) { ctx = null; return null; }
    }
    if (ctx.state === "suspended" && ctx.resume) {
      try { ctx.resume(); } catch (e) { }
    }
    unlock();
    return ctx;
  }

  // 解锁那一下：resume 是异步的，就在它的 then 里排一声「很轻的过门」。
  // 听完这一声，这台设备上后面每一声都出得来 —— 包括交卷那一屏
  // （判分要等服务端复核，晚个几百毫秒，早已不在手势的调用栈里了）。
  function unlock() {
    if (unlocked || !ctx) return;
    unlocked = true;
    var fire = function () { play("ok", null, 0.35); };
    try {
      if (ctx.resume && typeof ctx.resume === "function") ctx.resume().then(fire, function () { });
      else root.setTimeout(fire, 0);
    } catch (e) { }
  }

  // 排一声。音量乘一个系数（过门那一响压到 0.35 倍，不吵）。
  function play(name, band, vol) {
    if (!on()) return false;
    var v = voiceOf(name, band);
    if (!v) return false;

    var a = ctx || (on() ? ready() : null);
    if (!a) return false;

    var k = typeof vol === "number" ? vol : 1;
    // 不信 currentTime 那一刻排得进去：往后让 24ms，且紧跟在一串音符之后
    // （同一毫秒里排两个 start，老 Safari 会把后面的丢掉）。
    var t0 = a.currentTime + 0.024;
    var end = 0.03;

    v.notes.forEach(function (note) {
      var f = hz(note.n);
      if (!f) return;
      var at = t0 + note.at;
      var dur = note.dur;
      try {
        var o = a.createOscillator();
        var g = a.createGain();
        o.connect(g);
        g.connect(a.destination);
        o.type = note.type || "sine";
        o.frequency.setValueAtTime(f, at);
        // 包络：3ms 起音（防「咔」声）+ 指数尾巴，两截都软收
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v.gain * k), at + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        o.start(at);
        o.stop(at + dur + 0.02);
      } catch (e) { }
      end = Math.max(end, note.at + dur);
    });
    return true;
  }

  // 答题那一刻的调用口。答对 / 答错就这两个，别在页面里各写各的音高。
  function answer(ok) { return play(ok ? "ok" : "no"); }

  // 闯关过关（比答对那一响更长、更亮）
  function pass() { return play("pass"); }

  // 交卷出分：按百分制给档，与成绩横幅同一套边（90 / 60）
  function rank(right, total) {
    var n = Number(total) || 0;
    var pct = n ? (Number(right) || 0) / n * 100 : 0;
    return play("rank", bandOf(pct));
  }

  root.Sfx = {
    KEY: KEY,
    supported: supported,
    on: on,
    write: write,
    ready: ready,
    play: play,
    answer: answer,
    pass: pass,
    rank: rank,
    bandOf: bandOf,
    // 试听用（设置页那颗「试听一声」）
    notesOf: function (name, band) {
      var v = voiceOf(name, band);
      return v ? v.notes.map(function (n) { return n.n; }) : [];
    }
  };
})(typeof window !== "undefined" ? window : this);
