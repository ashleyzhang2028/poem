/**
 * 自动朗读控制条（吟诵标签页 左滑 / 首页点「朗读」时弹出）
 * ---------------------------------------------------
 * 交互设计（针对「不看手机也能听」这个场景）：
 *  · 朗读中整条标签常驻底部，任何页面都不会被弹层遮住
 *  · 暂停后出现「继续朗读」，可随时停止；全部读完后自动收起
 *  · 只在「有内容在朗读」时出现，不会打扰背诵主流程
 *  · 支持键盘：空格暂停/继续、→ 下一篇、Esc 停止
 *
 * 用法：
 *   Reader.player({ items, rate, onIndex, onEnd })
 */
(function () {
  "use strict";

  let bar = null;
  let label = null;
  let btnToggle = null;
  let btnNext = null;
  let btnStop = null;
  let hideTimer = null;
  let stopCbs = [];

  function $(sel) {
    return document.querySelector(sel);
  }

  /** 创建控制条（只创建一次） */
  function ensure() {
    if (bar) return bar;
    const el = document.createElement("div");
    el.className = "reader-player";
    el.id = "reader-player";
    el.hidden = true;
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", "自动朗读控制");
    el.innerHTML =
      '<span class="rp-icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M4 9.5v5h3l4.2 3.4V6.1L7 9.5H4Z" />' +
      '<path class="rp-w1" d="M15.2 9.2a4 4 0 0 1 0 5.6" />' +
      '<path class="rp-w2" d="M17.8 6.6a7.6 7.6 0 0 1 0 10.8" />' +
      "</svg></span>" +
      '<span class="rp-label" id="rp-label">准备朗读</span>' +
      '<button type="button" class="rp-btn" id="rp-toggle">暂停</button>' +
      '<button type="button" class="rp-btn" id="rp-next">下一篇</button>' +
      '<button type="button" class="rp-btn rp-stop" id="rp-stop" aria-label="停止朗读">停止</button>';
    document.body.appendChild(el);

    label = $("#rp-label");
    btnToggle = $("#rp-toggle");
    btnNext = $("#rp-next");
    btnStop = $("#rp-stop");

    btnToggle.addEventListener("click", function () {
      if (window.Speech.paused()) window.Speech.resume();
      else window.Speech.pause();
      sync();
    });
    btnNext.addEventListener("click", function () {
      if (!window.Speech.next()) close();
      sync();
    });
    btnStop.addEventListener("click", function () {
      window.Speech.stop();
      close();
      notifyStop();
    });

    document.addEventListener("keydown", function (e) {
      if (el.hidden) return;
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === " ") {
        e.preventDefault();
        btnToggle.click();
      } else if (e.key === "ArrowRight") {
        btnNext.click();
      } else if (e.key === "Escape") {
        btnStop.click();
      }
    });

    bar = el;
    return bar;
  }

  let nowText = "";
  let totalText = "";

  /** 刷新按钮文案与状态 */
  function sync() {
    if (!bar || bar.hidden) return;
    const isPaused = window.Speech.paused();
    btnToggle.textContent = isPaused ? "继续" : "暂停";
    btnToggle.dataset.paused = isPaused ? "1" : "0";
    bar.dataset.paused = isPaused ? "1" : "0";
    label.textContent = (isPaused ? "已暂停 · " : "正在朗读 · ") + (nowText || "") + totalText;
  }

  /** 注册「用户主动停止朗读」的回调（页面用来复位高亮 / 按钮状态） */
  function onStop(cb) {
    if (typeof cb === "function" && stopCbs.indexOf(cb) === -1) stopCbs.push(cb);
  }

  function notifyStop() {
    stopCbs.slice().forEach(function (cb) {
      try { cb(); } catch (e) { /* 界面回调异常不影响主流程 */ }
    });
  }

  /** 收起控制条 */
  function close() {
    if (!bar) return;
    clearTimeout(hideTimer);
    bar.hidden = true;
    nowText = "";
    totalText = "";
    document.body.classList.remove("has-audio-player");
  }

  /** 显示控制条 */
  function open() {
    ensure();
    clearTimeout(hideTimer);
    bar.hidden = false;
    document.body.classList.add("has-audio-player");
    sync();
  }

  /**
   * 开始朗读
   * @param {Object} opt
   *   opt.items      文本数组，或 [{ text, actions:[fn] }]（读完一条后执行 actions）
   *   opt.rate       语速
   *   opt.title      控制条上的总标题，如「今日 5 首」
   *   opt.onIndex(i) 当前读到第几条
   *   opt.onEnd()    全部读完
   */
  function player(opt) {
    const o = opt || {};
    const items = o.items || [];
    if (!items.length) return false;

    open();
    const ctrl = window.Speech.speakQueue(items, {
      rate: o.rate,
      onIndex: function (i) {
        nowText = (items[i] && items[i].title) || "";
        totalText = o.title ? " · " + o.title + "（" + (i + 1) + "/" + items.length + "）" : "";
        sync();
        if (typeof o.onIndex === "function") o.onIndex(i);
      },
      onEnd: function () {
        close();
        if (typeof o.onEnd === "function") o.onEnd();
      },
      onChange: sync
    });

    if (!ctrl) {
      close();
      return false;
    }
    return true;
  }

  window.ReaderPlayer = {
    player: player,
    close: close,
    onStop: onStop,
    isOpen: function () { return !!bar && !bar.hidden; }
  };
})();
