/**
 * 朗读音频（语音合成）
 * ---------------------------------------------------
 * 说明与取舍：
 * 1. 诗词音频文件体积大、版权也不好处理，这里用浏览器内置的
 *    SpeechSynthesis（Web Speech API）实时朗读，零资源、零流量，
 *    断网也能读（系统语音包在本机）。
 * 2. iOS Safari 要求「由用户手势触发」，因此在点击播放时同步调用 speak，
 *    不做自动播放。
 * 3. 不支持的浏览器（少数老安卓 WebView）会返回 false，界面给出提示并禁用按钮，
 *    不会让用户点了没反应。
 * 4. 环境（如 jsdom、无语音包的容器）里没有该 API，代码全部做了存在性判断。
 */
(function () {
  "use strict";

  const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
  const Utter = typeof window !== "undefined" ? window.SpeechSynthesisUtterance : null;

  let current = null;

  /** 是否可用 */
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

  /**
   * 朗读文本
   * @param {string} text 要读的正文
   * @param {object} [opts] rate 语速（默认 0.85，比正常慢一点，方便跟读）
   * @returns {boolean} 是否成功发起朗读
   */
  function speak(text, opts) {
    if (!supported()) return false;
    const body = String(text == null ? "" : text).trim();
    if (!body) return false;

    stop();
    const u = new Utter(body);
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.lang = (voice && voice.lang) || "zh-CN";
    u.rate = opts && opts.rate ? opts.rate : 0.85;
    u.pitch = 1;
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

  /** 停止朗读 */
  function stop() {
    if (!synth) return;
    try {
      synth.cancel();
    } catch (e) {
      /* ignore */
    }
    current = null;
  }

  function speaking() {
    if (!synth) return false;
    try {
      return !!synth.speaking;
    } catch (e) {
      return false;
    }
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

  window.Speech = {
    supported: supported,
    speak: speak,
    stop: stop,
    speaking: speaking,
    onVoicesReady: onVoicesReady
  };
})();
