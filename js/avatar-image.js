(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AvatarImage = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var OUT_SIZE = 256;
  var QUALITY = 0.86;

  var MAX_SRC_PX = 4096;

  var OK_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"];

  var MAX_FILE = 12 * 1024 * 1024;

  function cropRect(w, h, zoom, ox, oy) {
    var W = Number(w) > 0 ? Number(w) : 1;
    var H = Number(h) > 0 ? Number(h) : 1;
    var z = Number(zoom) > 0 ? Number(zoom) : 1;

    var base = Math.max(1, Math.min(W, H) / z);
    var side = Math.min(base, Math.min(W, H));
    var cx = W * clamp01(ox === undefined ? 0.5 : ox);
    var cy = H * clamp01(oy === undefined ? 0.5 : oy);
    var sx = clamp(cx - side / 2, 0, W - side);
    var sy = clamp(cy - side / 2, 0, H - side);
    return { sx: sx, sy: sy, sw: side, sh: side };
  }

  function zoomRange(w, h) {
    var short = Math.max(1, Math.min(Number(w) > 0 ? Number(w) : 1, Number(h) > 0 ? Number(h) : 1));
    return { min: 1, max: Math.max(1, short / 32) };
  }

  function clampZoom(w, h, zoom) {
    var r = zoomRange(w, h);
    var z = Number(zoom);
    if (!isFinite(z) || z <= 0) return 1;
    return clamp(z, r.min, r.max);
  }

  function clampOffset(w, h, zoom, ox, oy) {
    var W = Number(w) > 0 ? Number(w) : 1;
    var H = Number(h) > 0 ? Number(h) : 1;
    var z = clampZoom(W, H, zoom);
    var side = Math.max(1, Math.min(W, H) / z);
    var half = side / 2;
    var minX = half / W, maxX = 1 - half / W;
    var minY = half / H, maxY = 1 - half / H;
    return {
      ox: minX > maxX ? 0.5 : clamp(num(ox, 0.5), minX, maxX),
      oy: minY > maxY ? 0.5 : clamp(num(oy, 0.5), minY, maxY)
    };
  }

  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function clamp01(v) { return clamp(num(v, 0.5), 0, 1); }

  function wantsPng(type) {
    var t = String(type || "").toLowerCase();
    return t === "image/png" || t === "image/webp" || t === "image/gif";
  }

  function isOkType(type) {
    return OK_TYPES.indexOf(String(type || "").toLowerCase()) >= 0;
  }

  function checkFile(file) {
    if (!file) return { ok: false, code: "E_NO_FILE", message: "没有选中文件" };
    if (!isOkType(file.type)) {
      return { ok: false, code: "E_TYPE", message: "请选 PNG / JPG / WebP 图片" };
    }
    if (Number(file.size) > MAX_FILE) {
      return { ok: false, code: "E_TOO_BIG", message: "图片太大了（请选 12MB 以内的）" };
    }
    return { ok: true };
  }

  function hasDom() {
    return typeof document !== "undefined" && typeof document.createElement === "function";
  }

  function decode(file, opt) {
    var o = opt || {};
    var timeout = Number(o.timeout) > 0 ? Number(o.timeout) : 8000;
    function withTimeout(p, mk) {
      return new Promise(function (res, rej) {
        var done = false;
        var t = setTimeout(function () { if (!done) { done = true; rej(new Error("E_DECODE_TIMEOUT")); } }, timeout);
        p.then(function (v) { if (!done) { done = true; clearTimeout(t); res(v); } },
               function (e) { if (!done) { done = true; clearTimeout(t); rej(e); } });
      });
    }
    if (typeof createImageBitmap === "function") {
      return withTimeout(createImageBitmap(file), "bitmap").catch(function () {
        return decodeViaImg(file);
      });
    }
    return decodeViaImg(file);
  }

  function decodeViaImg(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error("E_DECODE")); };
      img.src = url;

      img._revoke = url;
    });
  }

  function release(src) {
    try {
      if (src && typeof src.close === "function") src.close();
      else if (src && src._revoke && typeof URL !== "undefined") URL.revokeObjectURL(src._revoke);
    } catch (e) {  }
  }

  function render(src, view, srcType, opt) {
    var o = opt || {};
    var size = Number(o.size) > 0 ? Number(o.size) : OUT_SIZE;
    var v = view || {};
    return new Promise(function (res, rej) {
      if (!hasDom()) return rej(new Error("E_NO_DOM"));
      var w = src ? (src.width || src.naturalWidth || 0) : 0;
      var h = src ? (src.height || src.naturalHeight || 0) : 0;
      if (!w || !h) return rej(new Error("E_EMPTY_IMAGE"));

      var sw = 0, sh = 0;
      if (Math.max(w, h) > MAX_SRC_PX) {
        var k = MAX_SRC_PX / Math.max(w, h);
        sw = Math.round(w * k); sh = Math.round(h * k);
      }
      var c = document.createElement("canvas");
      c.width = size; c.height = size;
      var ctx = c.getContext("2d");
      if (!ctx) return rej(new Error("E_NO_CTX"));
      ctx.imageSmoothingEnabled = true;
      if (ctx.imageSmoothingQuality) ctx.imageSmoothingQuality = "high";
      var r = cropRect(w, h, v.zoom, v.ox, v.oy);
      ctx.drawImage(src, r.sx, r.sy, r.sw, r.sh, 0, 0, size, size);
      var type = wantsPng(srcType) ? "image/png" : "image/jpeg";
      var q = type === "image/png" ? undefined : QUALITY;
      if (typeof c.toBlob === "function") {
        c.toBlob(function (b) { b ? res(b) : rej(new Error("E_ENCODE")); }, type, q);
      } else {

        try {
          var d = c.toDataURL(type, q);
          res(dataUrlToBlob(d));
        } catch (e) { rej(new Error("E_ENCODE")); }
      }
    });
  }

  function dataUrlToBlob(dataUrl) {
    var parts = String(dataUrl).split(",");
    var meta = parts[0] || "";
    var body = parts[1] || "";
    var mime = (meta.match(/data:([^;]+)/) || [])[1] || "image/jpeg";
    var bin = typeof atob === "function" ? atob(body) : "";
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function blobToDataUrl(blob) {
    return new Promise(function (res, rej) {
      if (typeof FileReader !== "function") return rej(new Error("E_NO_READER"));
      var fr = new FileReader();
      fr.onload = function () { res(String(fr.result || "")); };
      fr.onerror = function () { rej(new Error("E_READ")); };
      fr.readAsDataURL(blob);
    });
  }

  function process(file, view, opt) {
    var check = checkFile(file);
    if (!check.ok) {
      var e = new Error(check.code);
      e.code = check.code; e.message = check.message;
      return Promise.reject(e);
    }
    return decode(file, opt).then(function (src) {
      return render(src, view, file.type, opt).then(function (blob) {
        release(src);
        return blob;
      }, function (err) { release(src); throw err; });
    });
  }

  return {
    OUT_SIZE: OUT_SIZE, QUALITY: QUALITY, MAX_SRC_PX: MAX_SRC_PX,
    MAX_FILE: MAX_FILE, OK_TYPES: OK_TYPES,
    cropRect: cropRect, zoomRange: zoomRange, clampZoom: clampZoom,
    clampOffset: clampOffset, wantsPng: wantsPng, isOkType: isOkType,
    checkFile: checkFile, hasDom: hasDom,
    decode: decode, release: release, render: render, process: process,
    dataUrlToBlob: dataUrlToBlob, blobToDataUrl: blobToDataUrl
  };
});
