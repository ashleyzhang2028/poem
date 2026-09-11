/**
 * PWA / iOS 安装增强
 *
 * 处理三件事：
 * 1. 注册 Service Worker（离线可用、可安装）
 * 2. iOS（iPhone / iPad）上引导用户「添加到主屏幕」
 * 3. Android / 桌面 Chrome 支持时，展示原生安装按钮
 */
(function () {
  "use strict";

  var DISMISS_KEY = "poem-ios-tip-dismissed";

  function isStandalone() {
    // iOS Safari 专用属性
    if (window.navigator.standalone === true) return true;
    // 标准 PWA 显示模式
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
    if (window.matchMedia && window.matchMedia("(display-mode: fullscreen)").matches) return true;
    if (window.matchMedia && window.matchMedia("(display-mode: minimal-ui)").matches) return true;
    return false;
  }

  function isIOS() {
    var ua = window.navigator.userAgent || "";
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    // iPadOS 13+ 桌面版 Safari 会伪装成 Mac，靠触摸点数量区分
    if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return true;
    return false;
  }

  /**
   * 判断是否在「真正的」iOS Safari 里。
   * 微信、QQ、钉钉等 App 内置浏览器都无法「添加到主屏幕」，需要引导用户换 Safari。
   * 注意：这些内置浏览器的 UA 里通常根本没有 "Safari" 字样（如微信 UA 以 MicroMessenger 结尾），
   * 因此不能只靠「含 Safari」判断，必须先排除内置浏览器特征。
   */
  function isInAppBrowser() {
    var ua = window.navigator.userAgent || "";
    return /MicroMessenger|QQ\/|QQBrowser|DingTalk|Alipay|Weibo|UCBrowser|Quark|Baidu|BIDUBrowser|SogouMobileBrowser|2345Explorer|SnapChat|Instagram|FBAN|FBAV|Line\//i.test(ua);
  }

  function isSafari() {
    var ua = window.navigator.userAgent || "";
    if (isInAppBrowser()) return false;
    // 排除 iOS 上其它浏览器：Chrome(CriOS)、Firefox(FxiOS)、Edge(EdgiOS)、Opera(OPiOS)
    if (/CriOS|FxiOS|EdgiOS|OPiOS|mercury/i.test(ua)) return false;
    // iOS Safari 的 UA 一定同时含 "Safari" 与 "Version/"
    return /Safari/.test(ua) && /Version\//.test(ua);
  }

  function safeGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, val) {
    try { window.localStorage.setItem(key, val); } catch (e) { /* 隐私模式忽略 */ }
  }

  /* ---------- 1. Service Worker ---------- */
  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    // file:// 下无法注册，跳过
    if (location.protocol !== "http:" && location.protocol !== "https:") return;

    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js").then(function (reg) {
        // 有新版本时静默更新，下次进入即为新版
        reg.addEventListener("updatefound", function () {
          var sw = reg.installing;
          if (!sw) return;
          sw.addEventListener("statechange", function () {
            if (sw.state === "installed" && navigator.serviceWorker.controller) {
              // 已有旧版本在运行，提示用户刷新（不强制打断背诵）
              showUpdateTip();
            }
          });
        });
      }).catch(function () {
        // 注册失败不影响正常使用，仅失去离线能力
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

  /* ---------- 2. iOS 添加到主屏幕引导 ---------- */
  function showTip(text, btnLabel, onBtn) {
    var tip = document.getElementById("ios-install-tip");
    var btn = document.getElementById("ios-install-close");
    if (!tip || !btn) return;
    var textEl = tip.querySelector(".ios-tip-text");
    if (textEl) textEl.textContent = text;
    btn.textContent = btnLabel;
    // 用 onclick 覆盖，避免多次绑定导致行为串台
    btn.onclick = function () {
      hideInstallTip(tip);
      if (onBtn) onBtn();
    };
    tip.hidden = false;
    // 引导条是 fixed 的，会压住页脚里的用户协议 / 隐私条款链接，
    // 用 body 上的 class 给页面补出安全距离（见 css/style.css）
    document.body.classList.add("has-install-tip");
  }

  /* 隐藏引导条并撤掉底部留白 */
  function hideInstallTip(tip) {
    if (!tip) tip = document.getElementById("ios-install-tip");
    if (tip) tip.hidden = true;
    document.body.classList.remove("has-install-tip");
  }

  function setupIOSTip() {
    // 仅 iOS 且未安装时提示；Android / 桌面走 setupInstallPrompt
    if (!isIOS()) return;
    if (isStandalone()) return;                 // 已经装到桌面了
    if (safeGet(DISMISS_KEY) === "1") return;   // 用户已关闭过

    // 微信、QQ、Chrome 等 iOS 套壳浏览器没有「添加到主屏幕」，先引导去 Safari
    var inAppBrowser = !isSafari();
    var text = inAppBrowser
      ? "请用 Safari 打开本页，再「分享 → 添加到主屏幕」"
      : "想看桌面图标？点底部「分享」，选「添加到主屏幕」";

    // 稍后再弹，避免刚进页面就打断背诵
    setTimeout(function () {
      // 用户可能已经通过 Android 安装流程关掉了，再确认一次
      if (isStandalone()) return;
      showTip(text, "知道了", function () { safeSet(DISMISS_KEY, "1"); });
    }, 1200);
  }

  /* ---------- 3. Android / 桌面安装按钮 ---------- */
  var deferredPrompt = null;

  function setupInstallPrompt() {
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferredPrompt = e;

      // iOS 不触发该事件；真触发了也不该覆盖 iOS 的分享引导
      if (isIOS()) return;
      if (isStandalone()) return;                          // 已安装
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

  /* ---------- 4. 视口高度修正（iOS 地址栏收起/展开） ---------- */
  function fixIOSViewportHeight() {
    if (!isIOS()) return;
    function setVH() {
      document.documentElement.style.setProperty("--app-vh", window.innerHeight * 0.01 + "px");
    }
    setVH();
    window.addEventListener("orientationchange", function () { setTimeout(setVH, 300); });
    window.addEventListener("resize", setVH);
  }

  /* ---------- 5. 弹层打开时隐藏引导条，避免遮挡操作按钮 ---------- */
  function hideTipWhileModalOpen() {
    var tip = document.getElementById("ios-install-tip");
    if (!tip) return;

    function sync() {
      var modalOpen = !!document.querySelector(".modal:not([hidden])");
      if (modalOpen) {
        // 记录是否本来要显示，关闭弹层后恢复
        if (!tip.hidden) {
          tip.dataset.wasVisible = "1";
          tip.hidden = true;
        }
      } else if (tip.dataset.wasVisible === "1") {
        tip.hidden = false;
        delete tip.dataset.wasVisible;
      }
      // 留白跟着引导条的实际显隐走
      document.body.classList.toggle("has-install-tip", !tip.hidden);
    }

    // 弹层通过 hidden 属性切换，用 MutationObserver 监听最可靠
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
    hideTipWhileModalOpen();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
