(function () {
  "use strict";

  let bar = null;
  let elNow = null;
  let elNext = null;
  let elMode = null;
  let btnToggle = null;
  let btnPrev = null;
  let btnNext = null;
  let btnStop = null;
  let hideTimer = null;
  let stopCbs = [];

  let queueInfo = { current: "", next: "", index: 0, total: 0, hasNext: false, mode: "" };

  function $(sel) {
    return document.querySelector(sel);
  }

  function iconPlay() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.4 6.1 18.3 12 8.4 17.9Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  }
  function iconPause() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.2 5h2.9v14H8.2Z M12.9 5h2.9v14h-2.9Z" fill="currentColor" stroke="none"/></svg>';
  }
  function iconStop() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.6" y="6.6" width="10.8" height="10.8" rx="1.6" fill="currentColor" stroke="none"/></svg>';
  }
  function iconPrev() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.3 6.1 9.1 12l8.2 5.9Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linejoin="round" stroke-linecap="round"/><path d="M7.5 5.6v12.8" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>';
  }
  function iconNext() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.7 6.1l8.2 5.9-8.2 5.9Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linejoin="round" stroke-linecap="round"/><path d="M16.5 5.6v12.8" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>';
  }

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

      '<div class="pb-mode" id="rp-mode"></div>' +
      '<div class="pb-now" id="rp-now"></div>' +
      '<div class="pb-next" id="rp-next-title"></div>' +
      "</div>" +
      '<button type="button" class="pb-btn pb-side" id="rp-prev" aria-label="上一首" title="上一首">' + iconPrev() + "</button>" +
      '<button type="button" class="pb-btn pb-toggle" id="rp-toggle" aria-label="暂停" title="暂停">' + iconPause() + "</button>" +
      '<button type="button" class="pb-btn pb-side" id="rp-next" aria-label="下一首" title="下一首">' + iconNext() + "</button>" +
      '<button type="button" class="pb-btn pb-side pb-stop" id="rp-stop" aria-label="停止朗读" title="停止">' + iconStop() + "</button>";
    document.body.appendChild(el);

    elNow = $("#rp-now");
    elMode = $("#rp-mode");
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
      const cur = window.Speech && typeof window.Speech.index === "function" ? window.Speech.index() : queueInfo.index;
      if (cur > 0) queueInfo.index = cur;
      if (prevItem()) sync();
    });
    btnNext.addEventListener("click", function () {
      const cur = window.Speech && typeof window.Speech.index === "function" ? window.Speech.index() : queueInfo.index;
      if (cur >= 0) queueInfo.index = cur;
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

  function running() {
    return !!(window.Speech && window.Speech.active && window.Speech.active());
  }

  function sync() {
    if (!bar || bar.hidden) return;
    const isPaused = window.Speech.paused();

    btnToggle.innerHTML = isPaused
      ? '<span class="pb-glyph pb-play">' + iconPlay() + "</span>"
      : '<span class="pb-glyph pb-pause">' + iconPause() + "</span>";
    btnToggle.dataset.paused = isPaused ? "1" : "0";
    btnToggle.setAttribute("aria-label", isPaused ? "继续朗读" : "暂停朗读");
    btnToggle.title = isPaused ? "继续" : "暂停";
    bar.dataset.paused = isPaused ? "1" : "0";

    if (elMode) {
      elMode.hidden = !queueInfo.mode;
      elMode.textContent = queueInfo.mode || "";
    }
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

  function setQueueInfo(info) {
    queueInfo = {
      current: (info && info.current) || "",
      next: (info && info.next) || "",
      index: (info && info.index) || 0,
      total: (info && info.total) || 0,
      hasNext: !!(info && info.hasNext),

      mode: info && info.mode != null ? info.mode : queueInfo.mode
    };
    sync();
  }

  function nextItem() {
    if (!window.Speech || !window.Speech.active || !window.Speech.active()) return false;

    if (typeof window.Speech.nextItem === "function") return !!window.Speech.nextItem();
    return !!window.Speech.next();
  }

  function prevItem() {
    if (!window.Speech || !window.Speech.active || !window.Speech.active()) return false;
    if (queueInfo.index <= 0) return false;

    if (typeof window.Speech.setIndex === "function") {
      return !!window.Speech.setIndex(queueInfo.index - 1);
    }

    const target = queueInfo.index - 1;
    let guard = (queueInfo.total || 0) + 2;
    while (queueInfo.index > target && guard-- > 0) {
      if (!window.Speech.next()) break;
    }
    return queueInfo.index <= target;
  }

  function onStop(cb) {
    if (typeof cb === "function" && stopCbs.indexOf(cb) === -1) stopCbs.push(cb);
  }

  function notifyStop() {
    stopCbs.slice().forEach(function (cb) {
      try { cb(); } catch (e) {  }
    });
  }

  function syncBottomGap() {
    if (window.PWA && window.PWA.syncBottomGap) window.PWA.syncBottomGap();
  }

  function close() {
    if (!bar) return;
    clearTimeout(hideTimer);
    bar.hidden = true;
    queueInfo = { current: "", next: "", index: 0, total: 0, hasNext: false, mode: "" };
    document.body.classList.remove("has-audio-player");
    syncBottomGap();
  }

  function open() {
    ensure();
    clearTimeout(hideTimer);
    bar.hidden = false;
    document.body.classList.add("has-audio-player");
    sync();
    syncBottomGap();
  }

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
    queueInfo.mode = o.mode || "";
    const ctrl = window.Speech.speakQueue(items, {
      rate: o.rate,
      onIndex: function (i) {
        setQueueInfo({
          current: titleAt(i),
          next: (window.Speech && typeof window.Speech.peek === "function" && window.Speech.peek(i + 1)) || titleAt(i + 1),
          index: i,
          total: items.length,
          hasNext: i + 1 < items.length,
          mode: o.mode || null
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
