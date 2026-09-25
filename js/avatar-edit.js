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

    // ⚠️ 那颗键的文案就是**这一页上唯一**说明「有图 / 没图」的地方
    //    （Issue #276 第八轮）。用户原话：「如果用户上传了头像，上传头像
    //    是不是应该显示更新头像？」—— 是：没图时它说「上传头像」，
    //    有图时它说「更新头像」。一个动作、两个文案，判据就是本机有没有图。
    //    ⚠️ 这也顺手消掉了旧设计里那颗**没图时也画着**（只是 hidden）的
    //       「删除头像」：用户问「没上传头像是不是不该显示删除头像按钮」，
    //       答案是不该 —— 删除只在**有图**这一半里说得通，而那一半的唯一
    //       入口就是这颗键点进来的裁切层（删除那颗现在住在那儿，见
    //       mine/index.html 的 #btn-crop-clear）。所以这里不再有第二颗键
    //       要从「有没有图」推显隐 —— 一颗键、一处文案，推不出第二处。
    var pick = $("#btn-avatar-pick");
    if (pick) pick.textContent = hasImage ? "更新头像" : "上传头像";

    // 身份行是新节点的话，那颗键这会儿才存在 —— 在这里补绑一次（幂等）。
    // 不补的话：mine.js 重画身份行的那一瞬间，键就与监听器一起被丢掉了。
    bindAvatarButtons();
  }

  // ⚠️ 原先这里往「我的」页写一行「已同步 / 未同步」（renderHint + synced 一对）——
  //    本机有图就当场看得到，服务器那一份成不成是后台自己的事，
  //    用户在这一页不需要这行状态（用户 2026-09-21：能省则省）。两边一起撤掉，
  //    不留一个没人调用的判断。

  // 刷「页壳」：顶栏 + 底栏。
  //
  // ⚠️ 这里**只转发**给 SiteChrome，不再自己找节点写 innerHTML。
  //    原先末尾那三行 `document.querySelector("#site-dock .dock-icon")`
  //    取到的是**第一颗** dock 图标（左下角「背诵」那一格），于是传完头像：
  //      · 「背诵」的图标被换成了头像（用户 2026-09-24 原话：
  //        「左下角背诵上面的图标变成头像」）；
  //      · 「我的」那一格反而没动（「我的上面头像应该更新却没有直接更新」）。
  //    底栏头像的唯一出口是 SiteChrome.refreshUser → refreshDockAvatar，
  //    它按 `[data-nav-go="mine"]` 点名那一格。页面里不再有第二处写它的地方。
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

  // ⚠️ 「上传/更新头像」那颗键挂在**身份行**里（Issue #276：与「登录」同行），
  //    而身份行是 js/mine.js 按需整段重画的（buildIdentityRow 换 innerHTML
  //    —— 换一次，那颗键就是全新的节点）。所以绑定必须**幂等**：用
  //    dataset.bound 记一次，由 render() 每次重画后补调一次。不补的下场是
  //    「重画一次这颗键就哑了」—— 点了没反应，而且不报错。
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
    // 删除那颗住在裁切层里，是**静态标记**（只画一次，不随身份行重画）——
    // 但幂等这一条照旧：裁切层若被重建过，这里还能补上。
    var clearBtn = $("#btn-crop-clear");
    if (clearBtn && !clearBtn.dataset.bound) {
      clearBtn.dataset.bound = "1";
      // ⚠️ 先关层再删：删除之后这一层里的「用这张」就没有意义了
      //    （它处理的是 crop.file，而 crop.file 只有「新挑一张」才有）。
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
