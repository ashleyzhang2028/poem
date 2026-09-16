/**
 * 头像图片：本地压缩 + 方形裁切（纯几何，零网络；只有「读文件」与「编码」碰浏览器）
 * ==========================================================================
 * 用户 2026-09-19（Issue #163）：
 *
 *   「允许用户上传图片作为头像，**在上传前进行本地压缩**，支持用户进行**方形裁切**，
 *     放大缩小裁切，然后再上传裁切后的图片作为头像到 supabase 的文件或者图像存储。」
 *
 * 三个动作都在**这一台设备上**完成，一个字节都不发出去（直到最后那一次上传）：
 *
 *   ① 读文件 → 丢给浏览器解码（`createImageBitmap`，退回 `<img>`）
 *   ② 方形裁切 + 缩放 → 画进一张 256×256 的 `<canvas>`
 *   ③ 编码 → `canvas.toBlob("image/jpeg", 0.86)`
 *
 * ## 为什么是 256×256、JPEG
 *
 *   · **256**：顶栏那一枚画出来 42px（手机上 1x）、视网膜屏按 2x 算 84px，
 *     256 已经是 3x —— 再大只是白白多传几十 KB。四个尺寸共用一张图。
 *   · **JPEG**：头像基本都是照片，PNG 存照片常常大 5~10 倍。**PNG 只在一种
 *     情况下留着**：原图本身就带透明（截图 / 图标），转 JPEG 会把透明填成黑边。
 *     判据是原图类型，不是「看着像不像照片」—— 猜错一次就毁一张图。
 *
 * ## 为什么这一层要单独一个文件
 *
 *   `js/avatar.js` 是**纯逻辑**（Node 里 require 得到，测试不装 jsdom 也能跑）。
 *   本文件碰 `document` / `canvas` / `Blob`，Node 里没有。分开之后：
 *      · 头像的**规矩**（回落、地址白名单、分域）能在最轻的测试里守
 *      · 图片的**几何**（裁切框换算、缩放钳制）也能在 Node 里守 ——
 *        所以 `cropRect()` / `fitScale()` / `clampOffset()` 都是纯函数
 *
 * ⚠️ 本文件**不上传任何东西**。上传在 `js/account-api.js` 那条线上，
 *    （它负责会话、错误、降级），这里只产出「一张压好的图」。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AvatarImage = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /** 输出边长（正方形）与 JPEG 质量。改这两个数就会改字节数，见文件头 */
  var OUT_SIZE = 256;
  var QUALITY = 0.86;

  /** 原图解码后的边长上限 —— 超大的原图（手机直出 4000×3000）先在解码后缩一遍 */
  var MAX_SRC_PX = 4096;

  /** 原图类型白名单。**不做「按扩展名猜」**：扩展名是用户改得了的 */
  var OK_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"];

  /** 原图体积上限（12MB）。比这大的图在手机上解码就可能把标签页搞崩 */
  var MAX_FILE = 12 * 1024 * 1024;

  /* ------------------------------------------------------------ 纯几何 */

  /**
   * 把「用户选的框」换算成**原图坐标系**里要画的矩形。
   *
   * 交互层给的是**归一化**的三件事：`zoom`（放大倍数，1 = 铺满方框）、
   * `ox` / `oy`（中心点在原图上的归一化位置，0~1）。
   * 用归一化而不是像素，是为了让「拖到哪」与「画布多大」无关 ——
   * 手机上拖一次、桌面上同一张图拖一次，结果得是同一个框。
   *
   * 换算法：
   *   1. 基准边长 = min(w, h)（正方形裁切，永远取短边）
   *   2. 实际边长 = 基准 / zoom（放大 → 框变小 → 看到的更多细节）
   *   3. 中心点 = ox·w, oy·h，框再夹回图内（见 clampOffset）
   *
   * 返回 `{ sx, sy, sw, sh }` —— 与 `drawImage(img, sx, sy, sw, sh, 0, 0, O, O)`
   * 的参数逐位对应。
   */
  function cropRect(w, h, zoom, ox, oy) {
    var W = Number(w) > 0 ? Number(w) : 1;
    var H = Number(h) > 0 ? Number(h) : 1;
    var z = Number(zoom) > 0 ? Number(zoom) : 1;
    /* 短边不能小于 1px：zoom 极大时（用户一路放大到底）也要画得出东西，
       否则 drawImage 的 sw 为 0 → 全黑（一个「图没了」的症状） */
    var base = Math.max(1, Math.min(W, H) / z);
    var side = Math.min(base, Math.min(W, H));
    var cx = W * clamp01(ox === undefined ? 0.5 : ox);
    var cy = H * clamp01(oy === undefined ? 0.5 : oy);
    var sx = clamp(cx - side / 2, 0, W - side);
    var sy = clamp(cy - side / 2, 0, H - side);
    return { sx: sx, sy: sy, sw: side, sh: side };
  }

  /**
   * 缩放倍数的上下限。
   *
   * 上限按「框不小于 32 原图像素」推 —— 再往里缩，画出来的就是一团马赛克。
   * 下限固定 1：**小于 1 等于把图画小、方框里露出纸底**，那不是裁切。
   */
  function zoomRange(w, h) {
    var short = Math.max(1, Math.min(Number(w) > 0 ? Number(w) : 1, Number(h) > 0 ? Number(h) : 1));
    return { min: 1, max: Math.max(1, short / 32) };
  }

  /** 把 zoom 夹进 `zoomRange()` */
  function clampZoom(w, h, zoom) {
    var r = zoomRange(w, h);
    var z = Number(zoom);
    if (!isFinite(z) || z <= 0) return 1;
    return clamp(z, r.min, r.max);
  }

  /**
   * 把中心点夹回「框不出界」的范围。
   *
   * 单独一个函数、而不是让 `cropRect()` 自己夹：`cropRect()` 里那一夹
   * 会让**拖到边缘时中心点与实际框不一致**，下一次拖动就从对不上的地方接着走
   * （症状：手指到了边界，图还在慢慢挪）。
   */
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

  /**
   * 原图是否带透明 —— 决定输出 PNG 还是 JPEG。
   *
   * 判据是**类型**（png / webp / gif 才可能带透明），不是逐像素扫 alpha：
   * 逐像素扫要先把整张图读进 canvas，一张 4000×3000 的图就是 12M 次读取，
   * 手机上会卡住好几秒 —— 而这一层的全部意义就是「快、本地、不出去」。
   * 宁可偶尔把一张「其实是纯色的 PNG」也存成 PNG（大一点），
   * 也不能把一张真有透明的图转成 JPEG（透明一律变黑边，是**毁图**）。
   */
  function wantsPng(type) {
    var t = String(type || "").toLowerCase();
    return t === "image/png" || t === "image/webp" || t === "image/gif";
  }

  function isOkType(type) {
    return OK_TYPES.indexOf(String(type || "").toLowerCase()) >= 0;
  }

  /**
   * 检查一个用户挑的文件。返回 `{ ok, code, message }` —— **不抛**。
   *
   * 三种拒绝各有各的话，不合并成「这个文件不行」：
   * 用户要据此决定「换个格式」还是「这张图太大」，一句笼统的话帮不上。
   */
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

  /* ------------------------------------------------------ 浏览器侧（有 DOM 才跑） */

  function hasDom() {
    return typeof document !== "undefined" && typeof document.createElement === "function";
  }

  /**
   * 解码一张图。优先 `createImageBitmap`（它解码在主线程之外，大图不卡界面），
   * 退回 `<img>` + `URL.createObjectURL`。
   *
   * ⚠️ 两条路都要**按时长**兜底：iOS 上 `createImageBitmap` 曾经对某些
   *    HEIC 转出来的 JPEG 直接不解析也不报错（Promise 永远 pending）——
   *    用户看到的是「点了确定，什么都没发生」。超时即如实失败。
   */
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
      /* 解出来的对象自己带 URL，调用方用完调 `release()` —— 不 revoke 就是内存泄漏
         （一次会话里连挑五张图，五份几十 MB 的位图都还在） */
      img._revoke = url;
    });
  }

  /** 用完把解码出来的东西放掉（ImageBitmap 有 close()，<img> 有 blob URL） */
  function release(src) {
    try {
      if (src && typeof src.close === "function") src.close();
      else if (src && src._revoke && typeof URL !== "undefined") URL.revokeObjectURL(src._revoke);
    } catch (e) { /* 放不掉也不该让主流程失败 */ }
  }

  /**
   * 把解码好的原图按裁切框画成一张压好的图。
   *
   * @param {*}      src     decode() 的产物
   * @param {Object} view    { zoom, ox, oy }
   * @param {string} srcType 原图的 MIME（决定 PNG 还是 JPEG）
   * @returns {Promise<Blob>}
   *
   * ⚠️ canvas 用**离屏的**（`document.createElement("canvas")`，不进 DOM）：
   *    进 DOM 就要参与布局，手机上会看到一次「画面跳一下」。
   * ⚠️ 透明底**不填白**：填白会把 PNG 的透明区变成白块（看着像坏图），
   *    而我们要的恰恰是「原来是透明，出来还是透明」。
   */
  function render(src, view, srcType, opt) {
    var o = opt || {};
    var size = Number(o.size) > 0 ? Number(o.size) : OUT_SIZE;
    var v = view || {};
    return new Promise(function (res, rej) {
      if (!hasDom()) return rej(new Error("E_NO_DOM"));
      var w = src ? (src.width || src.naturalWidth || 0) : 0;
      var h = src ? (src.height || src.naturalHeight || 0) : 0;
      if (!w || !h) return rej(new Error("E_EMPTY_IMAGE"));
      /* 超大原图先在**解码后**缩一遍：直接 drawImage 到 256 也要走一遍
         全尺寸的重采样，4000px 的源在低端安卓上要 1~2 秒（用户以为死机了） */
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
        /* 极老的 WebView 没有 toBlob：退回 dataURL 再转 Blob */
        try {
          var d = c.toDataURL(type, q);
          res(dataUrlToBlob(d));
        } catch (e) { rej(new Error("E_ENCODE")); }
      }
    });
  }

  /** dataURL → Blob（只在没有 `toBlob` 的老 WebView 上走这条路） */
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

  /** Blob → data URL（本机那份缓存用它；上传走 Blob，不走这个） */
  function blobToDataUrl(blob) {
    return new Promise(function (res, rej) {
      if (typeof FileReader !== "function") return rej(new Error("E_NO_READER"));
      var fr = new FileReader();
      fr.onload = function () { res(String(fr.result || "")); };
      fr.onerror = function () { rej(new Error("E_READ")); };
      fr.readAsDataURL(blob);
    });
  }

  /** 端到端：一个文件 + 一个裁切视图 → 一张压好的 Blob。失败一律 reject(Error) */
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
