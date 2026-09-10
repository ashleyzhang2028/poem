/**
 * PWA 清单加载
 *
 * 页面标题会随用户名变化，但 manifest.webmanifest 是静态文件。
 * 这里在页面加载时先把清单读进内存（window.__manifest），
 * 用户改名后由 app.js 生成一份同内容的 Blob 清单替换 link.href，
 * 这样「添加到主屏幕」后的应用名也能跟随用户名。
 */
(function () {
  "use strict";

  var link = document.getElementById("app-manifest");
  if (!link) return;

  var href = link.getAttribute("href");
  if (!href || location.protocol === "file:") return;

  var xhr = new XMLHttpRequest();
  xhr.open("GET", href, true);
  xhr.onload = function () {
    try {
      window.__manifest = JSON.parse(xhr.responseText);
    } catch (e) {
      window.__manifest = null;
    }
  };
  xhr.onerror = function () {
    window.__manifest = null;
  };
  xhr.send();
})();
