// 连播朗读 · 底部播放工具栏「下一首 / 上一首」不跳篇（Issue #329）
//
// 背景（用户报的）：
//   连播朗读时点底部工具栏的「下一首」，感觉有篇被跳过；再点一次，中间又跳过一篇。
//
// 根因：
//   window.Speech.next() 原先的语义是"往后跳一篇"（q.index += 1），
//   可 reader 工具栏的「下一首」要的是"从当前这篇跳到下一篇"。
//   自动续播已经把索引推到了下一篇，此时再 next() 就又 +1，
//   于是每点一次就多吃掉一篇 —— 点的越多，跳过的越多（正比关系）。
//
//   真浏览器里 cancel() 还会回调当前 utterance 的 onend，
//   那次"残响"回调如果也推进索引，就会再多吃一篇。这里两个行为都测。
//
// 修复：
//   · 新增 Speech.nextItem()：严格"跳到下一篇"（不受残响回调影响）；
//   · 新增 Speech.setIndex(i)：工具栏「上一首」的直接定位；
//   · 新增 Speech.peek(i)：「下一首 · xxx」不再猜，直接问队列；
//   · cancel 触发的残响回调由队列的 seeking 标志抑制，不再多推索引。
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let fails = 0;
const chk = (c, m) => { if (!c) { console.log('✗ ' + m); fails++; } else console.log('✓ ' + m); };
const eq = (a, b, m) => chk(a === b, m + '（期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a) + '）');

// 起一个最小可用的 speechSynthesis。reentrant = 真浏览器行为：
// cancel() 会同步回调被取消那条 utterance 的 onend。
function harness(reentrant) {
  let cur = null;
  const synth = {
    speaking: false,
    paused: false,
    speak(u) { synth.speaking = true; cur = u; },
    cancel() {
      synth.speaking = false;
      const u = cur;
      cur = null;
      if (reentrant && u && u.onend) u.onend();
    },
    pause() { synth.paused = true; },
    resume() { synth.paused = false; },
    getVoices() { return []; }
  };
  class Utt { constructor(t) { this.text = t; } }
  const sandbox = {
    window: { speechSynthesis: synth, SpeechSynthesisUtterance: Utt },
    setTimeout, clearTimeout, console, Date, Promise
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/speech.js'), 'utf8'), sandbox, { filename: 'js/speech.js' });

  const Speech = sandbox.window.Speech;
  const items = [0, 1, 2, 3, 4].map(i => ({ title: '诗' + i, text: 't' + i }));
  let shown = 0;
  let ended = false;
  Speech.speakQueue(items, {
    onIndex: i => { shown = i; },
    onEnd: () => { ended = true; }
  });
  return {
    Speech, items,
    // 当前工具栏显示第几篇 / 引擎实际在读什么
    shown: () => shown,
    speaking: () => (cur ? cur.text : 'none'),
    // 这一篇自然读完 -> 自动续播下一篇
    finish: () => { const u = cur; cur = null; synth.speaking = false; if (u && u.onend) u.onend(); },
    ended: () => ended
  };
}

['cancel 不回调 onend（部分内核）', 'cancel 回调 onend（真浏览器）'].forEach(function (label, idx) {
  const reentrant = idx === 1;
  console.log('\n=== ' + label + ' ===');

  // 1 · 连播到底，一次都不能跳篇
  {
    const h = harness(reentrant);
    eq(h.shown(), 0, '连播起点是第 1 篇');
    const seen = [h.shown()];
    for (let k = 0; k < 4; k++) {
      const ok = h.Speech.nextItem();
      chk(ok, '第 ' + (k + 2) + ' 篇：点「下一首」有响应');
      seen.push(h.shown());
    }
    eq(seen.join(','), '0,1,2,3,4', '连点 4 次「下一首」按顺序走完，一篇不跳');
    eq(h.speaking(), 't4', '工具栏显示第 5 篇时，引擎读的正是第 5 篇');
    eq(h.Speech.nextItem(), false, '已是最后一篇，再点「下一首」到头（不报错）');
    chk(h.ended(), '到头时正常收尾');
  }

  // 2 · 自动续播之后再点「下一首」，也不能多吃一篇（用户报的正是这一条）
  {
    const h = harness(reentrant);
    h.finish();
    eq(h.shown(), 1, '第 1 篇读完后自动续播到第 2 篇');
    h.Speech.nextItem();
    eq(h.shown(), 2, '此时点「下一首」只走到第 3 篇（不是第 4 篇）');
    eq(h.speaking(), 't2', '引擎读的就是第 3 篇，音画一致');
    h.finish();
    eq(h.shown(), 3, '第 3 篇读完后自动续播到第 4 篇');
    h.Speech.nextItem();
    eq(h.shown(), 4, '再点一次「下一首」只走到第 5 篇');
    eq(h.speaking(), 't4', '引擎读的就是第 5 篇');
  }

  // 3 · 连点 N 次 = 前进 N 篇（不会指数级多吃）
  {
    const h = harness(reentrant);
    h.Speech.nextItem();
    h.Speech.nextItem();
    eq(h.shown(), 2, '连点 2 次「下一首」正好前进 2 篇');
  }

  // 4 · 上一首
  {
    const h = harness(reentrant);
    h.Speech.nextItem();
    h.Speech.nextItem();
    eq(h.shown(), 2, '先走到第 3 篇');
    chk(h.Speech.setIndex(1), '点「上一首」能回退');
    eq(h.shown(), 1, '回到第 2 篇');
    chk(h.Speech.setIndex(0), '再点「上一首」');
    eq(h.shown(), 0, '回到第 1 篇');
    eq(h.speaking(), 't0', '引擎读的就是第 1 篇');
  }

  // 5 · 残响回调必须认"自己属于哪一篇"，不能无脑 +1。
  //     这是"点一次跳一首"的真正来源：cancel 打断当前篇时，
  //     那条 utterance 的 onend 会再跑一次，若按"当前位置 +1"推进，
  //     就会把被跳转落点之后的那一篇整个跨过去。
  {
    const h = harness(reentrant);
    h.finish();
    eq(h.shown(), 1, '（残响）自动续播后正停在第 2 篇');
    h.Speech.nextItem();
    eq(h.shown(), 2, '（残响）点「下一首」落到第 3 篇');
    // 此刻再补一次"迟到的 onend"（有些内核 cancel 的回调是异步来的），
    // 它属于第 2 篇（过期回执），必须被丢掉，不能把索引再推到第 4 篇。
    h.Speech.nextItem();
    eq(h.shown(), 3, '（残响）再点一次落到第 4 篇，没有被过期回执顶掉');
  }

  // 5b · 连点 N 次「下一首」，落点严格等于 N（不多不少）
  {
    const h = harness(reentrant);
    for (let n = 1; n <= 4; n++) {
      h.Speech.nextItem();
      eq(h.shown(), n, '（计数）连点 ' + n + ' 次「下一首」正好到第 ' + (n + 1) + ' 篇');
      eq(h.speaking(), 't' + n, '（计数）引擎读的正是第 ' + (n + 1) + ' 篇');
    }
  }

  // 6 · 「下一首 · xxx」的篇名要跟真实队列对齐
  {
    const h = harness(reentrant);
    eq(h.Speech.peek(1), '诗1', 'peek(1) 取到第 2 篇的篇名（不是猜的）');
    eq(h.Speech.peek(0), '诗0', 'peek(0) 取到第 1 篇的篇名');
    h.Speech.nextItem();
    eq(h.Speech.peek(h.Speech.index() + 1), '诗2', '任意位置都能取到真正的「下一首」篇名');
  }
});

console.log('');
if (fails) {
  console.log('✗ ' + fails + ' 项断言失败');
  process.exit(1);
}
console.log('✅ 连播「上一首 / 下一首」不跳篇（两种 cancel 行为下都验过）');
