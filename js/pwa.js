(function () {
  "use strict";

  var DISMISS_KEY = "poem-ios-tip-dismissed";

  function isStandalone() {

    if (window.navigator.standalone === true) return true;

    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
    if (window.matchMedia && window.matchMedia("(display-mode: fullscreen)").matches) return true;
    if (window.matchMedia && window.matchMedia("(display-mode: minimal-ui)").matches) return true;
    return false;
  }

  function isIOS() {
    var ua = window.navigator.userAgent || "";
    if (/iPad|iPhone|iPod/.test(ua)) return true;

    if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return true;
    return false;
  }

  function isInAppBrowser() {
    var ua = window.navigator.userAgent || "";
    return /MicroMessenger|QQ\/|QQBrowser|DingTalk|Alipay|Weibo|UCBrowser|Quark|Baidu|BIDUBrowser|SogouMobileBrowser|2345Explorer|SnapChat|Instagram|FBAN|FBAV|Line\//i.test(ua);
  }

  function isSafari() {
    var ua = window.navigator.userAgent || "";
    if (isInAppBrowser()) return false;

    if (/CriOS|FxiOS|EdgiOS|OPiOS|mercury/i.test(ua)) return false;

    return /Safari/.test(ua) && /Version\//.test(ua);
  }

  function safeGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, val) {
    try { window.localStorage.setItem(key, val); } catch (e) {  }
  }

  function registerSW() {
    if (!("serviceWorker" in navigator)) return;

    if (location.protocol !== "http:" && location.protocol !== "https:") return;

    window.addEventListener("load", function () {

      navigator.serviceWorker.register("/sw.js").then(function (reg) {

        reg.addEventListener("updatefound", function () {
          var sw = reg.installing;
          if (!sw) return;
          sw.addEventListener("statechange", function () {
            if (sw.state === "installed" && navigator.serviceWorker.controller) {

              showUpdateTip();
            }
          });
        });
      }).catch(function () {

      });
    });
  }

  function showUpdateTip() {
    var tip = document.getElementById("ios-install-tip");
    if (!tip || !tip.hidden) return;
    var text = tip.querySelector(".ios-tip-text");
    var btn = document.getElementById("ios-install-close");
    if (text) text.textContent = "版本已更新，点这里刷新生效";
    if (btn) {
      btn.textContent = "刷新";
      btn.onclick = function () { location.reload(); };
    }
    tip.hidden = false;
    document.body.classList.add("has-install-tip");
  }

  function showTip(text, btnLabel, onBtn) {
    var tip = document.getElementById("ios-install-tip");
    var btn = document.getElementById("ios-install-close");
    if (!tip || !btn) return;
    var textEl = tip.querySelector(".ios-tip-text");
    if (textEl) textEl.textContent = text;
    btn.textContent = btnLabel;

    btn.onclick = function () {
      hideInstallTip(tip);
      if (onBtn) onBtn();
    };
    tip.hidden = false;

    document.body.classList.add("has-install-tip");
  }

  function hideInstallTip(tip) {
    if (!tip) tip = document.getElementById("ios-install-tip");
    if (tip) tip.hidden = true;
    document.body.classList.remove("has-install-tip");
  }

  function setupIOSTip() {

    if (!isIOS()) return;
    if (isStandalone()) return;
    if (safeGet(DISMISS_KEY) === "1") return;

    var inAppBrowser = !isSafari();
    var text = inAppBrowser
      ? "请用 Safari 打开本页，再「分享 → 添加到主屏幕」"
      : "想看桌面图标？点底部「分享」，选「添加到主屏幕」";

    setTimeout(function () {

      if (isStandalone()) return;
      showTip(text, "知道了", function () { safeSet(DISMISS_KEY, "1"); });
    }, 1200);
  }

  var deferredPrompt = null;

  function setupInstallPrompt() {
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferredPrompt = e;

      if (isIOS()) return;
      if (isStandalone()) return;
      if (safeGet("poem-android-tip-dismissed") === "1") return;

      setTimeout(function () {
        showTip("把本应用装到桌面，离线也能背诵", "安装", function () {
          safeSet("poem-android-tip-dismissed", "1");
          if (deferredPrompt) {
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then(function () { deferredPrompt = null; });
          }
        });
      }, 1200);
    });

    window.addEventListener("appinstalled", function () {
      deferredPrompt = null;
      hideInstallTip();
    });
  }

  function fixIOSViewportHeight() {
    if (!isIOS()) return;
    function setVH() {
      document.documentElement.style.setProperty("--app-vh", window.innerHeight * 0.01 + "px");
    }
    setVH();
    window.addEventListener("orientationchange", function () { setTimeout(setVH, 300); });
    window.addEventListener("resize", setVH);
  }

  function trackScrollbarWidth() {
    function setSW() {
      var v = window.innerWidth - document.documentElement.clientWidth;
      var w = (v > 0 && v < 40) ? v : 0;
      document.documentElement.style.setProperty("--scroll-w", w + "px");
    }
    setSW();
    window.addEventListener("resize", setSW);
  }

  function measureBottomNav() {
    var bar = document.querySelector(".player-bar");
    var dock = document.getElementById("site-dock");
    var tip = document.getElementById("ios-install-tip");
    var keep = {};

    function show(el, key, display) {
      if (!el) return;
      keep[key] = [el.hidden, el.style.display];
      el.hidden = false;
      if (display) el.style.display = display;
    }
    function restore(el, key) {
      if (!el || !keep[key]) return;
      el.hidden = keep[key][0];
      el.style.display = keep[key][1];
    }

    show(bar, "bar", "flex");
    show(dock, "dock", "flex");
    show(tip, "tip", "flex");

    function h(el) {
      if (!el) return 0;
      var r = el.getBoundingClientRect();
      return r.height > 0 ? r.height : 0;
    }

    var navH = Math.max(h(bar), h(dock));

    if (tip && keep.tip && !keep.tip[0]) {
      navH += h(tip) + 8;
    }

    restore(bar, "bar");
    restore(dock, "dock");
    restore(tip, "tip");

    return navH;
  }

  function syncBottomGap() {
    var tip = document.getElementById("ios-install-tip");
    var tipVisible = !!(tip && !tip.hidden);
    document.body.classList.toggle("has-install-tip", tipVisible);
    var navH = measureBottomNav();
    var root = document.documentElement;
    root.style.setProperty("--nav-h", navH + "px");

    root.style.setProperty("--player-bar-h", navH + "px");
    return navH;
  }

  function hideTipWhileModalOpen() {
    var tip = document.getElementById("ios-install-tip");
    if (!tip) return;

    function sync() {
      var modalOpen = !!document.querySelector(".modal:not([hidden])");
      if (modalOpen) {

        if (!tip.hidden) {
          tip.dataset.wasVisible = "1";
          tip.hidden = true;
        }
      } else if (tip.dataset.wasVisible === "1") {
        tip.hidden = false;
        delete tip.dataset.wasVisible;
      }

      syncBottomGap();
    }

    var observer = new MutationObserver(sync);
    document.querySelectorAll(".modal").forEach(function (m) {
      observer.observe(m, { attributes: true, attributeFilter: ["hidden"] });
    });
  }

  function init() {
    registerSW();
    setupIOSTip();
    setupInstallPrompt();
    fixIOSViewportHeight();
    trackScrollbarWidth();
    hideTipWhileModalOpen();
    syncBottomGap();
    window.addEventListener("resize", syncBottomGap);
    window.addEventListener("orientationchange", function () {
      setTimeout(syncBottomGap, 320);
    });

    if (window.ResizeObserver) {
      var bar = document.querySelector(".player-bar");
      if (bar) new ResizeObserver(function () { syncBottomGap(); }).observe(bar);
    }
  }

  window.PWA = window.PWA || {};
  window.PWA.syncBottomGap = syncBottomGap;
  window.PWA.trackScrollbarWidth = trackScrollbarWidth;
  window.PWA.measureBottomNav = measureBottomNav;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
