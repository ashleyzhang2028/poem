(function () {

  var USER_REV = "ppaubiuk";
  var DOMAIN_REV = "moc.361";

  function revive(rev) {
    return rev.split("").reverse().join("");
  }

  function address() {
    return revive(USER_REV) + String.fromCharCode(64) + revive(DOMAIN_REV);
  }

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
