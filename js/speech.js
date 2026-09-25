(function () {
  "use strict";

  const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
  const Utter = typeof window !== "undefined" ? window.SpeechSynthesisUtterance : null;

  let current = null;

  let queue = null;

  let singlePaused = false;

  let singleEndedAt = 0;
  const SINGLE_TAIL_MS = 600;

  function supported() {
    return !!(synth && Utter);
  }

  let gateFn = null;

  function setGate(fn) {
    gateFn = typeof fn === "function" ? fn : null;
  }

  function gate() {
    if (gateFn) return gateFn();
    const E = typeof window !== "undefined" ? window.Entitlement : null;
    if (!E || typeof E.can !== "function") {

      return { ok: true, hint: "" };
    }
    const id = typeof E.identity === "function" ? E.identity() : E.guestIdentity();
    const r = id.can("read.aloud");
    return { ok: !!r.ok, hint: r.ok ? "" : id.hint("read.aloud") };
  }

  function allowed() {
    return gate();
  }

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

  function speaking() {
    if (queue) return true;
    if (singlePaused) return true;
    if (!synth) return false;
    try {
      return !!synth.speaking;
    } catch (e) {
      return false;
    }
  }

  function paused() {
    if (queue) return !!queue.paused;
    if (singlePaused) return true;
    if (!synth) return false;
    try {
      return !!synth.paused;
    } catch (e) {
      return false;
    }
  }

  function stop() {
    queue = null;
    singlePaused = false;
    singleEndedAt = 0;
    if (!synth) return;
    try {
      synth.cancel();
    } catch (e) {

    }
    current = null;
  }

  function speak(text, opts) {
    if (!supported()) return false;
    if (!gate().ok) return false;
    const u = makeUtter(text, opts);
    if (!u) return false;

    stop();
    singlePaused = false;
    singleEndedAt = 0;
    u.onend = function () { current = null; singleEndedAt = Date.now(); };
    u.onerror = function () { current = null; singleEndedAt = Date.now(); };
    current = u;
    try {
      synth.speak(u);
      return true;
    } catch (e) {
      current = null;
      return false;
    }
  }

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

      q.index += 1;
      readNext();
      return;
    }

    // 这一条 utterance 属于哪一篇 —— 记死，别用相对 +1。
    // 用相对 +1 的话，cancel 触发的"残响"回调会从当前位置再往前推一格，
    // 把中间那篇整个跨过去（就是用户看到的"点一次跳一首"）。
    const at = q.index;

    if (typeof it.onStart === "function") {
      try { it.onStart(at); } catch (e) {  }
    }
    if (typeof q.opts.onIndex === "function") {
      try { q.opts.onIndex(at); } catch (e) {  }
    }

    function advance() {
      if (!queue || queue !== q) return;
      // 已经不在这一篇上了（被主动跳转打断 / 已被别的回调推进过）：忽略残响
      if (q.index !== at) return;
      q.current = null;
      q.index = at + 1;
      readNext();
    }

    u.onend = advance;
    u.onerror = advance;

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
      try { q.opts.onEnd(done !== false); } catch (e) {  }
    }
  }

  function speakQueue(items, opts) {
    if (!supported()) return null;
    if (!gate().ok) return null;
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
      current: null,
      // 主动跳转（点上一首/下一首）期间为 true：此间由 cancel 触发的
      // onend 是"被打断"的残响，必须忽略，否则索引会被多推一格。
      seeking: false
    };
    readNext();
    return controller;
  }

  function notifyChange() {
    if (queue && typeof queue.opts.onChange === "function") {
      try { queue.opts.onChange(); } catch (e) {  }
    }
  }

  function pause() {
    if (!synth) return false;
    if (!queue) {

      if (!synth.speaking) return false;
      singlePaused = true;
      try {
        synth.pause();
      } catch (e) {  }
      return true;
    }
    queue.paused = true;
    try {
      synth.pause();

      setTimeout(function () {
        if (!queue || !queue.paused) return;
        try {
          if (synth.speaking && !synth.paused) {
            queue.index = Math.max(0, queue.index - 0);
          }
        } catch (e) {  }
      }, 60);
    } catch (e) {

    }
    notifyChange();
    return true;
  }

  function resume() {
    if (!synth) return false;
    if (!queue) {
      if (!singlePaused) return false;
      singlePaused = false;
      try {
        synth.resume();
      } catch (e) {  }
      return true;
    }
    queue.paused = false;
    try {
      synth.resume();
    } catch (e) {

    }
    notifyChange();
    return true;
  }

  function next() {
    if (!queue || !synth) return false;
    const q = queue;
    q.current = null;
    q.seeking = true;
    try { synth.cancel(); } catch (e) {  }
    q.index += 1;
    if (q.index >= q.items.length) {
      q.seeking = false;
      finish(true);
      notifyChange();
      return false;
    }
    readNext();
    q.seeking = false;
    notifyChange();
    return true;
  }

  function index() {
    return queue ? queue.index : -1;
  }

  function pending() {
    return !!queue;
  }

  function setIndex(i) {
    if (!queue) return false;
    const q = queue;
    const t = Math.max(0, Math.min(q.items.length - 1, Number(i) | 0));
    if (t === q.index) return false;

    if (t > q.index) {
      while (q.index < t) {
        if (!next()) return false;
      }
      return true;
    }

    q.current = null;
    q.seeking = true;
    try { synth.cancel(); } catch (e) {  }
    q.index = t;
    readNext();
    q.seeking = false;
    notifyChange();
    return true;
  }

  function nextItem() {
    if (!queue) return false;
    const q = queue;
    const cur = Math.max(0, Math.min(q.items.length - 1, q.index));

    const target = cur + 1;

    q.current = null;
    q.seeking = true;
    try { synth.cancel(); } catch (e) {  }

    if (target >= q.items.length) {
      q.index = target;
      q.seeking = false;
      finish(true);
      notifyChange();
      return false;
    }

    q.index = target;
    readNext();
    q.seeking = false;
    notifyChange();
    return true;
  }

  function peek(i) {
    if (!queue) return "";
    const q = queue;
    const t = Math.max(0, Number(i) | 0);
    const it = q.items[t];
    return it ? normalize(it).title || "" : "";
  }

  function onVoicesReady(cb) {
    if (!supported() || !synth.addEventListener || typeof cb !== "function") return;
    try {
      synth.addEventListener("voiceschanged", cb);
    } catch (e) {

    }
  }

  function currentText() {
    if (queue && queue.current) return queue.current.text || "";
    if (current) return current.text || "";
    return "";
  }

  function active() {
    if (queue) return true;
    if (singlePaused) return true;
    if (singleEndedAt && Date.now() - singleEndedAt < SINGLE_TAIL_MS) return true;
    try {
      return !!(synth && synth.speaking);
    } catch (e) {
      return false;
    }
  }

  const controller = {
    pause: pause,
    resume: resume,
    next: next,
    nextItem: nextItem,
    setIndex: setIndex,
    peek: peek,
    pending: pending,
    stop: stop,
    index: index,
    paused: function () { return !!(queue && queue.paused); }
  };

  window.Speech = {
    supported: supported,
    allowed: allowed,
    setGate: setGate,
    speak: speak,
    speakQueue: speakQueue,
    stop: stop,
    pause: pause,
    resume: resume,
    next: next,
    nextItem: nextItem,
    setIndex: setIndex,
    peek: peek,
    pending: pending,
    index: index,
    speaking: speaking,
    paused: paused,
    active: active,
    currentText: currentText,
    onVoicesReady: onVoicesReady
  };
})();
