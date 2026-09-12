/**
 * 底部播放栏（首页「朗读」与小古文「随机连读」共用）
 * ---------------------------------------------------
 * 设计取向（宋式美学 · 音乐播放器）：
 *  · 常驻贴底、占满整个底边宽度，像手机底部弹出的播放器，而不是浮起的小胶囊
 *  · 无「正在朗读」这类文字；状态全部由图标表达（播放 / 暂停 / 停止）
 *  · 主信息是「当前这一首」，下方小字提示「下一首 某某」
 *  · 图标全部用内联 SVG，跨设备一致、放大不糊
 *
 * 声音与状态：
 *  · Speech.stop() 会立刻 cancel 掉语音合成 —— 暂停/停止后不会再有声音
 *  · 播放栏只在「队列还在跑」时显示，队列结束或被停止即刻收起
 *
 * 用法：
 *   Reader.player({ items, rate, title, onIndex, onEnd })
 */
(function () {
  "use strict";

  let bar = null;
  let elNow = null;
  let elNext = null;
  let btnToggle = null;
  let btnPrev = null;
  let btnNext = null;
  let btnStop = null;
  let hideTimer = null;
  let stopCbs = [];

  /** 队列信息（用于文案：当前一首 / 下一首） */
  let queueInfo = { current: "", next: "", index: 0, total: 0, hasNext: false };

  function $(sel) {
    return document.querySelector(sel);
  }

  /* 图标：全部纯笔画 SVG，颜色跟随文字色 */
  function iconPlay() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.2 4.6 19.4 12 7.2 19.4Z" fill="currentColor" stroke="none"/></svg>';
  }
  function iconPause() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.2 5h2.9v14H8.2Z M12.9 5h2.9v14h-2.9Z" fill="currentColor" stroke="none"/></svg>';
  }
  function iconStop() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.6" y="6.6" width="10.8" height="10.8" rx="1.6" fill="currentColor" stroke="none"/></svg>';
  }
  function iconPrev() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 5h2.3v14H6.4Z M18.6 5.2v13.6L9.6 12Z" fill="currentColor" stroke="none"/></svg>';
  }
  function iconNext() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.3 5h2.3v14h-2.3Z M5.4 5.2 14.4 12l-9 6.8Z" fill="currentColor" stroke="none"/></svg>';
  }

  /** 创建播放栏（只创建一次） */
  function ensure() {
    if (bar) return bar;
    const el = document.createElement("div");
    el.className = "player-bar";
    el.id = "reader-player";
    el.hidden = true;
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", "朗读播放器");
    el.innerHTML =
      '<div class="pb-info">' +
      '<div class="pb-now" id="rp-now"></div>' +
      '<div class="pb-next" id="rp-next-title"></div>' +
      "</div>" +
      '<div class="pb-controls">' +
      '<button type="button" class="pb-btn pb-side" id="rp-prev" aria-label="上一首" title="上一首">' + iconPrev() + "</button>" +
      '<button type="button" class="pb-btn pb-toggle" id="rp-toggle" aria-label="暂停" title="暂停">' + iconPause() + "</button>" +
      '<button type="button" class="pb-btn pb-side" id="rp-next" aria-label="下一首" title="下一首">' + iconNext() + "</button>" +
      '<button type="button" class="pb-btn pb-side pb-stop" id="rp-stop" aria-label="停止朗读" title="停止">' + iconStop() + "</button>" +
      "</div>";
    document.body.appendChild(el);

    elNow = $("#rp-now");
    elNext = $("#rp-next-title");
    btnToggle = $("#rp-toggle");
    btnPrev = $("#rp-prev");
    btnNext = $("#rp-next");
    btnStop = $("#rp-stop");

    btnToggle.addEventListener("click", function () {
      if (window.Speech.paused()) window.Speech.resume();
      else window.Speech.pause();
      sync();
    });
    btnPrev.addEventListener("click", function () {
      if (prevItem()) sync();
    });
    btnNext.addEventListener("click", function () {
      if (!nextItem()) close();
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
      } else if (e.key === "ArrowLeft") {
        btnPrev.click();
      } else if (e.key === "Escape") {
        btnStop.click();
      }
    });

    bar = el;
    return bar;
  }

  /** 队列是否真的还在跑：暂停也算「在播」（要能点继续） */
  function running() {
    return !!(window.Speech && window.Speech.active && window.Speech.active());
  }

  /** 刷新图标与文案 */
  function sync() {
    if (!bar || bar.hidden) return;
    const isPaused = window.Speech.paused();

    // 暂停时用「播放」图标（点它就是继续），播放时用「暂停」图标
    btnToggle.innerHTML = isPaused
      ? '<span class="pb-glyph pb-play">' + iconPlay() + "</span>"
      : '<span class="pb-glyph pb-pause">' + iconPause() + "</span>";
    btnToggle.dataset.paused = isPaused ? "1" : "0";
    btnToggle.setAttribute("aria-label", isPaused ? "继续朗读" : "暂停朗读");
    btnToggle.title = isPaused ? "继续" : "暂停";
    bar.dataset.paused = isPaused ? "1" : "0";

    elNow.textContent = queueInfo.current || "";

    if (queueInfo.hasNext && queueInfo.next) {
      elNext.hidden = false;
      elNext.textContent = "下一首 · " + queueInfo.next;
    } else {
      elNext.hidden = true;
      elNext.textContent = "";
    }

    btnPrev.disabled = !(window.Speech.active && window.Speech.active() && queueInfo.index > 0);
  }

  /** 队列信息由页面在 onIndex 时写入（含下一条的标题） */
  function setQueueInfo(info) {
    queueInfo = {
      current: (info && info.current) || "",
      next: (info && info.next) || "",
      index: (info && info.index) || 0,
      total: (info && info.total) || 0,
      hasNext: !!(info && info.hasNext)
    };
    sync();
  }

  /** 控制条上的「上一首 / 下一首」：直接跳到队列中的前/后一条 */
  function nextItem() {
    if (!window.Speech || !window.Speech.active || !window.Speech.active()) return false;
    return !!window.Speech.next();
  }

  function prevItem() {
    if (!window.Speech || !window.Speech.active || !window.Speech.active()) return false;
    if (queueInfo.index <= 0) return false;
    // Speech 只支持向后跳，这里连跳两次序号回到上一条
    const target = queueInfo.index - 1;
    let ok = true;
    while (queueInfo.index > target && ok) {
      ok = !!window.Speech.next();
    }
    return ok;
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

  /** 底部留白（--nav-h）统一由 js/pwa.js 测量，播放栏开合后通知它重算 */
  function syncBottomGap() {
    if (window.PWA && window.PWA.syncBottomGap) window.PWA.syncBottomGap();
  }

  /** 收起播放栏 */
  function close() {
    if (!bar) return;
    clearTimeout(hideTimer);
    bar.hidden = true;
    queueInfo = { current: "", next: "", index: 0, total: 0, hasNext: false };
    document.body.classList.remove("has-audio-player");
    syncBottomGap();
  }

  /** 显示播放栏 */
  function open() {
    ensure();
    clearTimeout(hideTimer);
    bar.hidden = false;
    document.body.classList.add("has-audio-player");
    sync();
    syncBottomGap();
  }

  /**
   * 开始朗读
   * @param {Object} opt
   *   opt.items      字符串数组，或 [{ title, text, onStart }]
   *   opt.rate       语速
   *   opt.title      总标题（仅用于无障碍标签，不再显示在界面上）
   *   opt.onIndex(i) 当前读到第几条
   *   opt.onEnd()    全部读完
   */
  function player(opt) {
    const o = opt || {};
    const items = o.items || [];
    if (!items.length) return false;

    const titleAt = function (i) {
      const it = items[i];
      if (!it) return "";
      return (it && it.title) || "";
    };

    open();
    const ctrl = window.Speech.speakQueue(items, {
      rate: o.rate,
      onIndex: function (i) {
        setQueueInfo({
          current: titleAt(i),
          next: titleAt(i + 1),
          index: i,
          total: items.length,
          hasNext: i + 1 < items.length
        });
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
    if (o.title) bar.setAttribute("aria-label", "朗读播放器 · " + o.title);
    return true;
  }

  window.ReaderPlayer = {
    player: player,
    close: close,
    onStop: onStop,
    setQueueInfo: setQueueInfo,
    sync: sync,
    isOpen: function () { return !!bar && !bar.hidden; },
    isRunning: running
  };
})();
