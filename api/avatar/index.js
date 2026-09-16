/**
 * POST / DELETE /api/avatar —— 头像图片（上传 / 删除，Issue #163 · 2026-09-19）
 *
 * POST  body 为**原始图片字节**（不是 JSON）：
 *        Content-Type: image/jpeg | image/png
 *        x-kb-device: <deviceId>
 *      200 { url, bytes, note }
 *      400 { code:"E_TYPE" }      不是 JPEG/PNG（按字节判，不看头部声明）
 *      400 { code:"E_TOO_BIG" }   超过 AVATAR_MAX_BYTES
 *      401 { code:"E_NO_SESSION" }
 *      429 { code:"E_RATE_DEVICE", retryAfter }
 *      503 { code:"E_NOT_CONFIGURED" }
 *
 * DELETE 200 { deleted:true, url:"" }   —— 清掉云端那一张（回到首字印）
 *
 * ## 为什么请求体是**裸字节**而不是 JSON + base64
 *
 *   base64 会把体积抬 33%，而 Vercel 的请求体上限是 4.5MB —— 一张
 *   压好的 256×256 JPEG 只有 10~20KB，JSON 那层包装纯属浪费。
 *   而且 `readBody()` 有 64KB 上限（那是给进度用的），头像**不走它**。
 *
 * ## 为什么删掉之后还回一个空 url
 *
 *   前端把「云端地址」存在 `poem_profile_v1` 里（账号域，跨设备一致）。
 *   删除之后那个地址必须**真的空掉**，否则另一台设备还会去拉那张已经不存在的图
 *   （症状：一只裂图）。所以 DELETE 只做一件事 —— 把盘上那个地址清成空串，
 *   至于桶里那份（覆盖式上传留下的旧对象）删不掉也无所谓：路径只认 uid，
 *   同一个位置下次上传就盖掉了。
 *
 * Ref: docs/architecture.md §4.21（头像上云）
 */
"use strict";

var handler = require("../_lib/handler");
var H = require("../_lib/http");
var avatarStore = require("../_lib/avatar-store");

/** 裸字节日志会很长：只记长度，**绝不记内容** */
function byteLength(buf) { return buf && buf.length ? buf.length : 0; }

/** 读原始字节（**上限比 readBody 大得多**：图片是 KB 级，进度才是 KB 级小件） */
function readBytes(req, limit) {
  return new Promise(function (resolve) {
    if (req.body !== undefined && req.body !== null && typeof req.body !== "string") {
      /* Vercel 在 Content-Type 不是 json 时会把 body 预解析成 Buffer */
      if (typeof Buffer !== "undefined" && Buffer.isBuffer && Buffer.isBuffer(req.body)) {
        return resolve(req.body);
      }
      if (req.body instanceof Uint8Array) return resolve(Buffer.from(req.body));
    }
    var chunks = [];
    var total = 0;
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks));
    }
    req.on("data", function (c) {
      chunks.push(c);
      total += c.length;
      if (total > limit) { done = true; resolve(null); }   // 超限：直接判负，不继续吃内存
    });
    req.on("end", finish);
    req.on("error", function () { done = true; resolve(null); });
  });
}

/* ⚠️ 第四个参数 `{ rawBody: true }`：**这个接口的 body 是裸字节**（图片本身），
   不是 JSON。不加它的话外壳会拿 `readBody()` 去 JSON.parse 图片，
   于是每一次上传都以 `400 E_BAD_BODY` 收场 —— 而报错指向的是「请求体不合法」，
   看着像客户端的问题（有断言守着这一条）。 */
module.exports = handler.make("avatar", ["POST", "DELETE"], function (d, body, req) {
  var store = avatarStore.getAvatarStore(d.cfg);
  var method = String((req && req.method) || "POST").toUpperCase();

  /* ⚠️ 三件事分开回（没配好 / 没登录 / 格式不对），不许合并成一句「失败」——
     用户看到的下一步动作完全不同（去配置 / 去登录 / 换张图）。 */
  if (!d.cfg.hasSession()) {
    return { status: 503, body: { code: "E_NOT_CONFIGURED", message: "服务端还没配置好。当前仍可完全离线使用本站。" } };
  }
  if (!d.account) {
    return { status: 401, body: { code: "E_NO_SESSION", message: "请先登录再换头像" } };
  }

  var uid = d.account.uid;
  var t = d.now();
  var key = "avatar:" + String(d.deviceId || "unknown");
  var g = d.limiter.check(d.cfg, "device", key, t);
  if (!g.ok) {
    return { status: 429, body: { code: "E_RATE_DEVICE", message: "换头像太频繁了，请稍后再试", retryAfter: g.retryAfter } };
  }

  if (method === "DELETE") {
    d.limiter.hit("device", key, t);
    return Promise.resolve(store.remove(uid)).then(function () {
      return { status: 200, body: { deleted: true, url: "" } };
    });
  }

  var maxBytes = Number(d.cfg.avatarMaxBytes) > 0 ? Number(d.cfg.avatarMaxBytes) : 1024 * 1024;
  return readBytes(req, maxBytes).then(function (buf) {
    if (buf === null || byteLength(buf) > maxBytes) {
      H.log("avatar.too_big", { uid: uid, limit: maxBytes });
      return { status: 400, body: { code: "E_TOO_BIG", message: "图片太大了（请选 1MB 以内的）" } };
    }
    if (!buf.length) {
      return { status: 400, body: { code: "E_NO_BODY", message: "没有收到图片数据" } };
    }
    /* ⚠️ **按字节判**，不看 Content-Type：头部是客户端说的，而一个写着
       image/jpeg 的 HTML 存进 public 桶里就是一条存储型 XSS 的引信。 */
    var mime = avatarStore.sniffImage(buf);
    if (!mime) {
      H.log("avatar.bad_type", { uid: uid, declared: String((req.headers || {})["content-type"] || "") });
      return { status: 400, body: { code: "E_TYPE", message: "只支持 PNG / JPG 图片" } };
    }
    d.limiter.hit("device", key, t);
    return Promise.resolve(store.put(uid, mime, buf)).then(function (r) {
      if (!r || !r.ok) {
        /* 上游失败**如实回**，不假装成功：前端据此保留本机那份图并说一句
           「还没传上去」—— 假装成功的话用户换台设备就发现头像没了。 */
        var code = (r && r.code) || "E_UPSTREAM";
        H.log("avatar.put_failed", { uid: uid, code: code, status: r && r.status });
        var status = (code === "E_OFFLINE" || code === "E_NO_BUCKET") ? 503 : 502;
        var msg = code === "E_NO_BUCKET"
          ? "存储桶还没建好（在 Supabase 控制台建一个名为 " + d.cfg.avatarBucket + " 的 public bucket）"
          : "头像没能传上去，请稍后再试";
        return { status: status, body: { code: code, message: msg } };
      }
      var url = d.cfg.avatarPublicUrl(uid);
      H.log("avatar.put", { uid: uid });
      return {
        status: 200,
        body: {
          /* ⚠️ 破缓存：同一条 URL 换了字节，浏览器与 CDN 都还拿着旧那份 */
          url: url + "?v=" + t,
          bytes: byteLength(buf),
          note: "头像已保存到服务器。本机那份副本仍保留，断网时照旧显示。"
        }
      };
    });
  });
}, { rawBody: true });
