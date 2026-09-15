/**
 * PWA 清单加载与「应用名」同步
 *
 * 页面标题会随用户名变化，但 manifest.webmanifest 是静态文件。
 * 这里在页面加载时先把清单读进内存（window.__manifest），
 * 再按当前用户名生成一份同内容的 Blob 清单替换 link.href，
 * 这样「添加到主屏幕」后的应用名也能跟随用户名（默认名 Ashley 同理）。
 *
 * 为什么把「换 href」这件事收在本文件、而不是留在 js/app.js：
 *   原先 app.js 的 applyAppName() 里读 **当时是否已拿到** window.__manifest，
 *   拿到就换 Blob、没拿到就保持静态 href —— 于是换不换取决于
 *   「清单 XHR」和「DOMContentLoaded → chrome:ready」谁先到，
 *   同一个页面在不同机器上会落到不同状态：CI 慢一点就换、本地快就不换。
 *   症状是 manifest 应用名在不同环境下不一致（「跬步 · 课内背诵」/
 *   「跬步 · Ashley的背诵」两种），测试也跟着红绿飘（Issue #132 期间 CI 复现）。
 *
 *   现在改成同源：**只有本文件决定 href**，读盘完成、拿到数据后才换一次，
 *   换完派发 manifest:ready。app.js 只管「标题变了就告诉这里」，
 *   不再自己判断时机 —— 状态因此与加载快慢无关。
 */
(function () {
  "use strict";

  var link = document.getElementById("app-manifest");
  // 首页之外（设置页等）没有清单链接：只要有人要用同步能力，仍然把 API 挂上，
  // 否则 app.js 里的调用要先判 window.ManifestSync 存在，多一处时序假设。
  var loaded = false;
  var base = null;
  var currentTitle = null;

  /** 目标应用名（由 app.js 传进来，本文件不自己拼文案） */
  function apply(title) {
    if (title) currentTitle = title;
    if (!link || !loaded || !base || !currentTitle) return;
    if (!window.Blob || !window.URL || !URL.createObjectURL) return;
    try {
      var manifest = JSON.parse(JSON.stringify(base));
      if (!manifest.name) return;
      manifest.name = currentTitle;
      manifest.short_name = "跬步";
      var blob = new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" });
      var url = URL.createObjectURL(blob);
      var previous = link.dataset.blobUrl;
      link.dataset.blobUrl = url;
      link.href = url;
      // 旧的那份 Blob 得等人已经改用新 URL 之后再撤销，先撤会出现「中间一刻指向空」
      if (previous) URL.revokeObjectURL(previous);
    } catch (e) {
      /* 清单更新失败不影响主流程 */
    }
  }

  /** 清单是否已读进内存（页面 / 测试可据此判断时机，不必猜） */
  function ready() {
    return loaded;
  }

  window.ManifestSync = { apply: apply, ready: ready };

  if (!link) return;
  var href = link.getAttribute("href");
  if (!href || location.protocol === "file:") return;

  var xhr = new XMLHttpRequest();
  xhr.open("GET", href, true);
  xhr.onload = function () {
    try {
      base = JSON.parse(xhr.responseText);
      window.__manifest = base;
    } catch (e) {
      base = null;
      window.__manifest = null;
    }
    loaded = true;
    apply(currentTitle);
    document.dispatchEvent(new Event("manifest:ready"));
  };
  xhr.onerror = function () {
    base = null;
    window.__manifest = null;
    loaded = true;
    document.dispatchEvent(new Event("manifest:ready"));
  };
  xhr.send();
})();
