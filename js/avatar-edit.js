(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  function avatarMod() { return window.Avatar || null; }
  function avatarImageMod() { return window.AvatarImage || null; }
  function accountApiMod() { return window.AccountApi || null; }

  function toast(msg) {
    var t = $("#toast");
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2200);
  }

  var crop = { file: null, url: "", w: 0, h: 0, zoom: 1, ox: 0.5, oy: 0.5, drag: null };

  function render() {
    var A = avatarMod();
    var slot = $("#avatar-slot");
    if (!A) return;
    var html = "";
    try { html = A.html(window.localStorage, { dock: true }); } catch (e) { html = ""; }
    if (slot) {
      slot.innerHTML = html;
      if (html) slot.removeAttribute("aria-hidden");
      else slot.setAttribute("aria-hidden", "true");
    }

    var d = null;
    try { d = A.display(window.localStorage); } catch (e) { d = null; }
    var hasImage = !!(d && d.hasImage);

    var pick = $("#btn-avatar-pick");
    if (pick) pick.textContent = hasImage ? "更新头像" : "上传头像";

    bindAvatarButtons();
  }

  function refreshChrome() {
    if (window.SiteChrome && window.SiteChrome.refreshUser) window.SiteChrome.refreshUser();
  }

  function onPickFile(input) {
    var AI = avatarImageMod();
    if (!AI) return;
    var file = input && input.files && input.files[0];
    if (!file) return;
    var chk = AI.checkFile(file);
    if (!chk.ok) { toast(chk.message); input.value = ""; return; }

    AI.decode(file).then(function (src) {
      crop.file = file;
      crop.w = src.width || src.naturalWidth || 0;
      crop.h = src.height || src.naturalHeight || 0;
      crop.zoom = 1; crop.ox = 0.5; crop.oy = 0.5;
      crop.url = (window.URL && URL.createObjectURL) ? URL.createObjectURL(file) : "";
      AI.release(src);
      openCrop();
      input.value = "";
    }).catch(function () {
      toast("这张图片打不开，请换一张");
      input.value = "";
    });
  }

  function openCrop() {
    var layer = $("#crop-layer");
    var img = $("#crop-img");
    if (!layer || !img) return;
    img.src = crop.url;
    var z = $("#crop-zoom");
    if (z) { z.value = "0"; z.disabled = false; }
    layer.hidden = false;
    document.body.classList.add("crop-open");
    drawCrop();
  }

  function closeCrop() {
    var layer = $("#crop-layer");
    if (layer) layer.hidden = true;
    document.body.classList.remove("crop-open");
    var img = $("#crop-img");
    if (img) img.removeAttribute("src");
    if (crop.url && window.URL && URL.revokeObjectURL) URL.revokeObjectURL(crop.url);
    crop.file = null; crop.url = ""; crop.drag = null;
  }

  function drawCrop() {
    var img = $("#crop-img");
    var box = $("#crop-box");
    if (!img || !box || !crop.w || !crop.h) return;
    var side = box.clientWidth || 260;

    var base = side / Math.min(crop.w, crop.h);
    var k = base * crop.zoom;
    var dispW = crop.w * k;
    var dispH = crop.h * k;

    var left = side / 2 - crop.ox * dispW;
    var top = side / 2 - crop.oy * dispH;
    left = Math.min(0, Math.max(side - dispW, left));
    top = Math.min(0, Math.max(side - dispH, top));

    img.style.width = dispW + "px";
    img.style.height = dispH + "px";
    img.style.left = left + "px";
    img.style.top = top + "px";
  }

  function setZoomFromSlider(v) {
    var AI = avatarImageMod();
    if (!AI) return;
    var r = AI.zoomRange(crop.w, crop.h);
    var t = Math.min(1, Math.max(0, Number(v) || 0));
    crop.zoom = r.min * Math.pow(r.max / r.min || 1, t);
    var c = AI.clampOffset(crop.w, crop.h, crop.zoom, crop.ox, crop.oy);
    crop.ox = c.ox; crop.oy = c.oy;
    drawCrop();
  }

  function zoomBy(factor) {
    var AI = avatarImageMod();
    if (!AI) return;
    var r = AI.zoomRange(crop.w, crop.h);
    crop.zoom = AI.clampZoom(crop.w, crop.h, crop.zoom * factor);
    var t = Math.log(crop.zoom / r.min) / Math.log(r.max / r.min || 1);
    var z = $("#crop-zoom");
    if (z) z.value = String(Math.min(1, Math.max(0, t)));
    var c = AI.clampOffset(crop.w, crop.h, crop.zoom, crop.ox, crop.oy);
    crop.ox = c.ox; crop.oy = c.oy;
    drawCrop();
  }

  function confirmCrop() {
    var AI = avatarImageMod();
    var A = avatarMod();
    var btn = $("#btn-crop-ok");
    if (!AI || !A || !crop.file) return;
    if (btn) { btn.disabled = true; btn.textContent = "处理中…"; }
    var view = { zoom: crop.zoom, ox: crop.ox, oy: crop.oy };
    AI.process(crop.file, view).then(function (blob) {
      return AI.blobToDataUrl(blob).then(function (dataUrl) {
        return { blob: blob, dataUrl: dataUrl };
      });
    }).then(function (out) {
      A.setLocalImage(window.localStorage, out.dataUrl);
      closeCrop();
      render();
      refreshChrome();
      return upload(out.blob).then(function (ok) {
        if (ok) render();
        return ok;
      });
    }).then(function () {
      if (btn) { btn.disabled = false; btn.textContent = "用这张"; }
    }).catch(function () {
      if (btn) { btn.disabled = false; btn.textContent = "用这张"; }
      toast("这张图片处理不了，请换一张");
    });
  }

  function upload(blob) {
    var Api = accountApiMod();
    if (!Api || !Api.uploadAvatar) return Promise.resolve(false);
    return Api.uploadAvatar({ blob: blob, type: blob.type }).then(function (r) {
      render();
      if (r && r.ok) {
        // 服务器那把地址的**破缓存参数每次上传都会换**（`?v=<时间戳>`）。
        // 本机那份字节优先里画着的还是**刚才那张**，而账号域那条地址已经是新的
        // —— 把本机那份字节清掉，让这个子用户下一次真正从服务器取新图（Issue #320）。
        // 不这么做的话，改完头像当场看到的还是旧脸（同一处缓存，两个症状）。
        dropLocalOnUpload(r);
        refreshChrome();
        toast("头像已保存");
        return true;
      }
      if (r && r.reason === "guest") toast("头像已存在本机，登录后才会同步到其它设备");
      else if (r && r.reason === "not-configured") toast("头像已存在本机（服务器还没开放）");
      else toast((r && r.message) || "头像已存在本机，还没同步到服务器");
      return false;
    });
  }

  function dropLocalOnUpload(r) {
    var S = window.SyncStore;
    if (!S || typeof S.dropLocal !== "function") return;
    // ⚠️ 只在一个条件下清：服务端已经收下这张图（`r.ok`）、而且它回来的地址
    //    与账号域里那条不一致时才谈得上「缓存旧了」。收下之前（离线 / 未登录）
    //    本机那份字节就是**唯一**一张，清掉等于把用户的头像抹了。
    try { S.dropLocal("", { backing: window.localStorage }); } catch (e) { }
  }

  function clear() {
    var Api = accountApiMod();
    if (!window.confirm("删除头像？之后显示用户名首字。")) return;
    var done = function () { render(); refreshChrome(); };
    if (!Api || !Api.deleteAvatar) {
      var A = avatarMod();
      if (A) A.resetAvatar(window.localStorage);
      done();
      return;
    }
    Api.deleteAvatar().then(function (r) {
      done();
      if (r && r.remote === "skipped") toast("本机头像已删除，服务器那份还没删掉");
      else toast("头像已删除");
    });
  }

  function bindCrop() {
    var layer = $("#crop-layer");
    var box = $("#crop-box");
    var zoom = $("#crop-zoom");
    if (!layer) return;
    if (zoom) zoom.addEventListener("input", function () { setZoomFromSlider(zoom.value); });
    var ok = $("#btn-crop-ok");
    if (ok) ok.addEventListener("click", confirmCrop);
    var cancel = $("#btn-crop-cancel");
    if (cancel) cancel.addEventListener("click", closeCrop);
    if (!box) return;

    var pointers = {};
    var pinchDist = 0;

    box.addEventListener("pointerdown", function (e) {
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (box.setPointerCapture) { try { box.setPointerCapture(e.pointerId); } catch (err) { } }
      var n = Object.keys(pointers).length;
      if (n === 1) {
        crop.drag = { x: e.clientX, y: e.clientY };
      } else if (n === 2) {
        var ids = Object.keys(pointers);
        var a = pointers[ids[0]], b = pointers[ids[1]];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        crop.drag = null;
      }
    });

    box.addEventListener("pointermove", function (e) {
      if (!pointers[e.pointerId]) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);
      var side = box.clientWidth || 260;

      if (ids.length >= 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0 && dist > 0) zoomBy(dist / pinchDist);
        pinchDist = dist;
        return;
      }
      if (!crop.drag) return;
      var dx = e.clientX - crop.drag.x;
      var dy = e.clientY - crop.drag.y;
      crop.drag = { x: e.clientX, y: e.clientY };

      var k = (side / Math.min(crop.w, crop.h)) * crop.zoom;
      crop.ox -= dx / (crop.w * k);
      crop.oy -= dy / (crop.h * k);

      var AI = avatarImageMod();
      if (AI) {
        var c = AI.clampOffset(crop.w, crop.h, crop.zoom, crop.ox, crop.oy);
        crop.ox = c.ox; crop.oy = c.oy;
      }
      drawCrop();
    });

    var endPointer = function (e) {
      delete pointers[e.pointerId];
      if (Object.keys(pointers).length < 2) pinchDist = 0;
      if (!Object.keys(pointers).length) crop.drag = null;
    };
    box.addEventListener("pointerup", endPointer);
    box.addEventListener("pointercancel", endPointer);
    box.addEventListener("pointerleave", endPointer);
  }

  function bindAvatarButtons() {
    var pick = $("#btn-avatar-pick");
    var file = $("#avatar-file");
    if (pick && file && !pick.dataset.bound) {
      pick.dataset.bound = "1";
      pick.addEventListener("click", function () { file.click(); });
    }
    if (file && !file.dataset.bound) {
      file.dataset.bound = "1";
      file.addEventListener("change", function () { onPickFile(file); });
    }

    var clearBtn = $("#btn-crop-clear");
    if (clearBtn && !clearBtn.dataset.bound) {
      clearBtn.dataset.bound = "1";

      clearBtn.addEventListener("click", function () { closeCrop(); clear(); });
    }
  }

  function bind() {
    bindAvatarButtons();
    bindCrop();

    window.addEventListener("resize", function () {
      var layer = $("#crop-layer");
      if (layer && !layer.hidden) drawCrop();
    });
  }

  function init() {
    bind();
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.AvatarEdit = { render: render, bind: bind };
})();
