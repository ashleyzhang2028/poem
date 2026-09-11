/**
 * 联系邮箱 · 防爬渲染
 *
 * 目标：页面上不出现可被搜索引擎/爬虫直接抓取的邮箱字符串。
 * 手段（三重，尽量不误伤真人用户）：
 *   1. 源码里不写明文邮箱 —— HTML 中只放占位文字「显示邮箱地址」；
 *   2. 邮箱以逆序 + 分段数组存放，且由 JS 运行时拼装，正则扫 HTML / JS 原文都抓不到完整地址；
 *   3. 字符分割后才拼接，避免出现 user@domain 形式的完整明文；
 *   4. 邮件链接优先使用「复制到剪贴板」，不必暴露可见文本。
 *
 * 注意：这是「提高抓取成本」而非「绝对安全」。真要收信，地址终究要出现在 DOM 里，
 * 只是不再出现在静态 HTML 源码中，也不会被常见的邮箱正则直接命中。
 */
(function () {
  /* 用户名与域名分开、逆序存放；运行时倒序 + 拼接还原完整地址。
     注意：注释里也不要写明文地址，否则源码扫描仍然能抓到。 */
  var USER_REV = "ppaubiuk";
  var DOMAIN_REV = "moc.361";

  function revive(rev) {
    return rev.split("").reverse().join("");
  }

  function address() {
    return revive(USER_REV) + String.fromCharCode(64) + revive(DOMAIN_REV);
  }

  /** 点击后把邮箱写入剪贴板；失败则退回提示用户手动长按选中 */
  function copy(text, link) {
    var done = function () {
      var old = link.getAttribute("data-label") || link.textContent;
      link.textContent = "已复制 " + text;
      link.setAttribute("data-label", "显示邮箱地址");
      link.removeAttribute("href");
      setTimeout(function () { link.textContent = old; }, 4000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(text, link); });
    } else {
      fallback(text, link);
    }
  }

  function fallback(text, link) {
    // 极简兜底：不使用 execCommand（已废弃），直接把地址显示出来供用户复制
    var span = document.createElement("span");
    span.className = "mail-plain";
    span.textContent = text;
    link.replaceWith(span);
  }

  function mount() {
    var links = document.querySelectorAll("[data-mail-slot]");
    for (var i = 0; i < links.length; i++) {
      (function (link) {
        link.setAttribute("href", "mailto:" + address());
        link.addEventListener("click", function (e) {
          e.preventDefault();
          copy(address(), link);
        });
      })(links[i]);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
