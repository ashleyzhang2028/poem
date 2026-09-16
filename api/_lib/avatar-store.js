/**
 * 头像的对象存储出口（Supabase Storage）—— **唯一的图片上传处**
 * ==========================================================================
 * 用户 2026-09-19（Issue #163）：
 *
 *   「允许用户上传图片作为头像……然后再上传裁切后的图片作为头像到
 *     **supabase 的文件或者图像存储**。」
 *
 * 与 `api/_lib/store.js` 同一条纪律：**这里也是两个实现、接口一模一样**。
 *   · supabaseAvatar — 走 Supabase Storage 的 REST（`/storage/v1/object/...`），
 *                      service key 只在服务端，**不引 @supabase/storage-js**
 *   · memoryAvatar   — 进程内 Map。用途有两个：
 *                      ① 本地开发与 `test/api.test.js`（不联网、不需要真桶）
 *                      ② 没配 Supabase 时的降级：接口如实回 503，
 *                         而不是抛一个 500
 *
 * ## 三条口径
 *
 * 1. **路径由服务端算**（`CONFIG.avatarPath(uid)`），客户端只说「这是我要传的字节」。
 *    让客户端给路径的下场是「一个登录用户能覆盖另一个用户的头像」——
 *    路径里带 uid，而 uid 是服务端从会话里读的，客户端伪造不了。
 * 2. **上传即覆盖**（文件名固定 `avatar.jpg`）。不删旧对象：删旧的要再发一个请求，
 *    它失败时用户头像不变、而桶里多一份垃圾；覆盖则天然幂等。
 * 3. **换内容要破缓存**。同一条 URL 换了字节，浏览器与 CDN 都还拿着旧那份 ——
 *    所以服务端回一个 `url` 带上 `?v=<时间戳>`，前端存的也是它
 *    （`js/avatar.js` 的 `isImgUrl()` 认它是 https 地址，不特殊处理）。
 *
 * ⚠️ 本文件同时被 Vercel 与 test 使用，**不 import 任何第三方包**，只用 fetch。
 */
"use strict";

/** 允许的图片类型 —— 与 `js/avatar-image.js` 的 OK_TYPES 同源，但这里只收**压完之后**那两种 */
var OK_MIME = ["image/jpeg", "image/png"];

/** 路径里的 uid 白名单化（与 `CONFIG.avatarPath` 同一把尺子） */
function safeUid(uid) {
  return String(uid || "").replace(/[^A-Za-z0-9_-]/g, "");
}

function memoryAvatar() {
  var objects = {};
  return {
    kind: "memory",
    ready: function () { return true; },
    _objects: objects,
    put: function (uid, mime, bytes) {
      var u = safeUid(uid);
      if (!u) return Promise.resolve({ ok: false, code: "E_NO_UID" });
      objects[u] = { mime: mime, bytes: bytes, at: Date.now() };
      return Promise.resolve({ ok: true, bytes: bytes.length });
    },
    get: function (uid) {
      var o = objects[safeUid(uid)];
      return Promise.resolve(o || null);
    },
    remove: function (uid) {
      delete objects[safeUid(uid)];
      return Promise.resolve(true);
    }
  };
}

/**
 * Supabase Storage 实现。
 *
 * 两个 REST 调用，都是 service key：
 *   PUT  /storage/v1/object/<bucket>/<path>          body = 图片字节
 *   POST /storage/v1/object/<bucket>/<path>  (x-upsert)  ← 新版本用它做覆盖
 *
 * ⚠️ 用 **PUT 不带 x-upsert** 时会**拒绝覆盖**（409 Duplicate）——
 *    那正是「改一次头像就再也改不动」的病根。所以两件事都要做：
 *    `x-upsert: true` 头 + 老版本走 POST。
 */
function supabaseAvatar(cfg) {
  var base = String(cfg.supabaseUrl || "").replace(/\/+$/, "") + "/storage/v1/object";
  var KEY = cfg.supabaseServiceKey;
  var BUCKET = String(cfg.avatarBucket || "avatars");

  function put(uid, mime, bytes) {
    var path = cfg.avatarPath(uid);
    if (!path) return Promise.resolve({ ok: false, code: "E_NO_UID" });
    var buf = bytes;
    return fetch(base + "/" + BUCKET + "/" + path, {
      method: "POST",
      headers: {
        apikey: KEY,
        Authorization: "Bearer " + KEY,
        "Content-Type": mime,
        "x-upsert": "true",
        "Cache-Control": "max-age=31536000"
      },
      body: buf
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          var code = r.status === 404 ? "E_NO_BUCKET" : "E_UPSTREAM";
          return { ok: false, code: code, status: r.status, detail: String(t).slice(0, 200) };
        });
      }
      return { ok: true, bytes: buf && buf.length ? buf.length : 0 };
    }).catch(function (e) {
      return { ok: false, code: "E_OFFLINE", detail: String(e && e.message || e).slice(0, 120) };
    });
  }

  return {
    kind: "supabase",
    ready: function () { return !!base && !!KEY && !!BUCKET; },
    put: put,
    get: function () { return Promise.resolve(null); },   // 读走公开 URL，不经过这里
    remove: function (uid) {
      var path = cfg.avatarPath(uid);
      if (!path) return Promise.resolve(false);
      return fetch(base + "/" + BUCKET + "/" + path, {
        method: "DELETE",
        headers: { apikey: KEY, Authorization: "Bearer " + KEY }
      }).then(function () { return true; }).catch(function () { return false; });
    }
  };
}

/** 单例（与 store.js 的 getStore 同款）：同一进程里只造一个 */
var singleton = null;

function getAvatarStore(cfg) {
  var c = cfg || require("./config");
  if (singleton && singleton._cfg === c) return singleton.impl;
  var impl = (c.hasAvatarStore && c.hasAvatarStore()) ? supabaseAvatar(c) : memoryAvatar();
  singleton = { _cfg: c, impl: impl };
  return impl;
}

/** 测试用：把单例清掉（每个用例注入自己的 cfg） */
function resetAvatarStore() { singleton = null; }

/**
 * 一坨字节**是不是真的图片** —— 判前几个字节（magic number），不看 Content-Type。
 *
 * 为什么不信 Content-Type：它是**客户端说的**。一个写着 `image/jpeg` 的
 * HTML 文件被存进 public 桶里，就是一条存储型 XSS 的引信（浏览器对
 * `.jpg` 结尾的地址会按 Content-Type 渲染）。这里只放行两种真实魔术字：
 *   · JPEG：FF D8 FF
 *   · PNG： 89 50 4E 47 0D 0A 1A 0A
 */
function sniffImage(buf) {
  if (!buf || !buf.length || buf.length < 8) return "";
  var b = buf;
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 &&
      b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A) return "image/png";
  return "";
}

module.exports = {
  OK_MIME: OK_MIME,
  safeUid: safeUid,
  memoryAvatar: memoryAvatar,
  supabaseAvatar: supabaseAvatar,
  getAvatarStore: getAvatarStore,
  resetAvatarStore: resetAvatarStore,
  sniffImage: sniffImage
};
