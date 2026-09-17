(function () {
  "use strict";

  var link = document.getElementById("app-manifest");

  var loaded = false;
  var base = null;
  var currentTitle = null;

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

      if (previous) URL.revokeObjectURL(previous);
    } catch (e) {

    }
  }

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
