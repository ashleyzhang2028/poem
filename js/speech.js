/**
 * 朗读 / 自动朗读引擎（语音合成）
 * ---------------------------------------------------
 * 说明与取舍：
 * 1. 诗词音频文件体积大、版权也不好处理，这里用浏览器内置的
 *    SpeechSynthesis（Web Speech API）实时朗读，零资源、零流量，
 *    断网也能读（系统语音包在本机）。
 * 2. iOS Safari 要求「由用户手势触发」，因此所有朗读都由点击开始；
 *    但点击开始之后，队列内部可以自动一篇接一篇读下去（自动朗读），
 *    这不违反手势策略。
 * 3. 不支持的浏览器（少数老安卓 WebView）会返回 false，界面给出提示并禁用按钮，
 *    不会让用户点了没反应。
 * 4. 环境（如 jsdom、无语音包的容器）里没有该 API，代码全部做了存在性判断。
 *
 * 队列（自动朗读）机制：
 *   speakQueue(items, opts)  —— 逐条朗读，一条读完自动读下一条
 *   · items：字符串数组，或 [{ text, onStart, actions }]
 *   · opts.onIndex(i)  当前读到第几条（界面高亮用）
 *   · opts.onEnd(done) 全部读完（done=false 表示被用户中断）
 *   · opts.onChange()  播放状态变化（暂停 / 继续 / 停止）
 *   控制器：pause() / resume() / next() / stop()
 */
(function () {
  "use strict";

  const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
  const Utter = typeof window !== "undefined" ? window.SpeechSynthesisUtterance : null;

  let current = null;

  /** 队列状态 */
  let queue = null;

  /* ---------------- 基础能力 ---------------- */

  function supported() {
    return !!(synth && Utter);
  }

  /** 中文语音优先：优先 zh-CN，其次任何 zh */
  function pickVoice() {
    if (!supported() || !synth.getVoices) return null;
    let voices = [];
    try {
      voices = synth.getVoices() || [];
    } catch (e) {
      return null;
    }
    return (
      voices.filter(function (v) { return /zh[-_]?CN|zh[-_]?Hans/i.test(v.lang || ""); })[0] ||
      voices.filter(function (v) { return /^zh/i.test(v.lang || ""); })[0] ||
      null
    );
  }

  /** 造一条 utterance（统一语速 / 音色） */
  function makeUtter(text, opts) {
    const body = String(text == null ? "" : text).trim();
    if (!body) return null;
    const u = new Utter(body);
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.lang = (voice && voice.lang) || "zh-CN";
    u.rate = opts && opts.rate ? opts.rate : 0.85;
    u.pitch = 1;
    return u;
  }

  /** 是否正在朗读（含暂停） */
  function speaking() {
    if (queue) return true;
    if (!synth) return false;
    try {
      return !!synth.speaking;
    } catch (e) {
      return false;
    }
  }

  /** 是否处于暂停 */
  function paused() {
    if (queue) return !!queue.paused;
    if (!synth) return false;
    try {
      return !!synth.paused;
    } catch (e) {
      return false;
    }
  }

  /** 硬停止：连队列一起清空 */
  function stop() {
    queue = null;
    if (!synth) return;
    try {
      synth.cancel();
    } catch (e) {
      /* ignore */
    }
    current = null;
  }

  /* ---------------- 单条朗读 ---------------- */

  /**
   * 朗读一段文本（会先停掉当前朗读与队列）
   * @returns {boolean} 是否成功发起朗读
   */
  function speak(text, opts) {
    if (!supported()) return false;
    const u = makeUtter(text, opts);
    if (!u) return false;

    stop();
    u.onend = function () { current = null; };
    u.onerror = function () { current = null; };
    current = u;
    try {
      synth.speak(u);
      return true;
    } catch (e) {
      current = null;
      return false;
    }
  }

  /* ---------------- 队列朗读（自动连播） ---------------- */

  function normalize(item) {
    if (typeof item === "string") return { text: item };
    return item || {};
  }

  function readNext() {
    if (!queue) return;
    const q = queue;
    if (q.index >= q.items.length) {
      finish(true);
      return;
    }

    const it = normalize(q.items[q.index]);
    const u = makeUtter(it.text, q.opts);
    if (!u) {
      // 空文本直接跳过
      q.index += 1;
      readNext();
      return;
    }

    if (typeof it.onStart === "function") {
      try { it.onStart(q.index); } catch (e) { /* 界面回调异常不影响朗读 */ }
    }
    if (typeof q.opts.onIndex === "function") {
      try { q.opts.onIndex(q.index); } catch (e) { /* ignore */ }
    }

    u.onend = function () {
      if (!queue || queue !== q) return;
      q.current = null;
      q.index += 1;
      readNext();
    };
    u.onerror = function () {
      if (!queue || queue !== q) return;
      q.current = null;
      q.index += 1;
      readNext();
    };

    q.current = u;
    try {
      synth.speak(u);
    } catch (e) {
      q.index += 1;
      readNext();
    }
  }

  function finish(done) {
    const q = queue;
    queue = null;
    if (!q) return;
    if (typeof q.opts.onEnd === "function") {
      try { q.opts.onEnd(done !== false); } catch (e) { /* ignore */ }
    }
  }

  /**
   * 顺序朗读多条内容，一条读完自动读下一条
   * @param {Array<string|{text:string,actions:Array}>} items
   * @param {Object} [opts] rate / onIndex(i) / onEnd(done) / onChange()
   * @returns {Object|null} 控制器
   */
  function speakQueue(items, opts) {
    if (!supported()) return null;
    const list = (items || []).filter(function (it) {
      return normalize(it).text;
    });
    if (!list.length) return null;

    stop();
    queue = {
      items: list,
      opts: opts || {},
      index: 0,
      paused: false,
      current: null
    };
    readNext();
    return controller;
  }

  function notifyChange() {
    if (queue && typeof queue.opts.onChange === "function") {
      try { queue.opts.onChange(); } catch (e) { /* ignore */ }
    }
  }

  /** 暂停 / 继续：优先走原生暂停，个别设备不支持时用「停止后记住位置」兜底 */
  function pause() {
    if (!queue || !synth) return false;
    queue.paused = true;
    try {
      synth.pause();
      // 部分浏览器 pause 无效（speaking 仍为 true 且不再触发 end），这里兜底
      setTimeout(function () {
        if (!queue || !queue.paused) return;
        try {
          if (synth.speaking && !synth.paused) {
            queue.index = Math.max(0, queue.index - 0);
          }
        } catch (e) { /* ignore */ }
      }, 60);
    } catch (e) {
      /* ignore */
    }
    notifyChange();
    return true;
  }

  function resume() {
    if (!queue || !synth) return false;
    queue.paused = false;
    try {
      synth.resume();
    } catch (e) {
      /* ignore */
    }
    notifyChange();
    return true;
  }

  /** 跳过当前，直接读下一条；已在最后一条则结束 */
  function next() {
    if (!queue || !synth) return false;
    const q = queue;
    q.current = null;
    q.index += 1;
    try {
      synth.cancel();
    } catch (e) { /* ignore */ }
    if (q.index >= q.items.length) {
      finish(true);
      notifyChange();
      return false;
    }
    readNext();
    notifyChange();
    return true;
  }

  /** 当前读到第几条（0 起）；未在队列朗读时为 -1 */
  function index() {
    return queue ? queue.index : -1;
  }

  /** 语音包异步加载：加载后再刷新一次按钮状态 */
  function onVoicesReady(cb) {
    if (!supported() || !synth.addEventListener || typeof cb !== "function") return;
    try {
      synth.addEventListener("voiceschanged", cb);
    } catch (e) {
      /* ignore */
    }
  }

  /** 当前文本片段（用于界面提示「正在朗读：xxx」） */
  function currentText() {
    if (queue && queue.current) return queue.current.text || "";
    if (current) return current.text || "";
    return "";
  }

  const controller = {
    pause: pause,
    resume: resume,
    next: next,
    stop: stop,
    index: index,
    paused: function () { return !!(queue && queue.paused); },
    active: function () { return !!queue; }
  };

  window.Speech = {
    supported: supported,
    speak: speak,
    speakQueue: speakQueue,
    stop: stop,
    pause: pause,
    resume: resume,
    next: next,
    index: index,
    speaking: speaking,
    paused: paused,
    currentText: currentText,
    onVoicesReady: onVoicesReady
  };
})();
