"use strict";

var SECRET_KEYS = /^(code|codeHash|salt|token|sessionSecret|supabaseServiceKey|apiKey|sid|pepper)$/i;

function redact(value, depth) {
  depth = depth || 0;
  if (depth > 6) return "[deep]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(function (v) { return redact(v, depth + 1); });
  if (typeof value === "object") {
    var out = {};
    Object.keys(value).forEach(function (k) {
      out[k] = SECRET_KEYS.test(k) ? "[redacted]" : redact(value[k], depth + 1);
    });
    return out;
  }
  return "[unknown]";
}

function log(event, detail) {

  try {
    console.log(JSON.stringify({ at: new Date().toISOString(), event: event, detail: redact(detail || {}) }));
  } catch (e) {
    console.log(JSON.stringify({ at: new Date().toISOString(), event: event, detail: "[unserializable]" }));
  }
}

function json(res, status, body, headers) {
  var h = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (headers) Object.keys(headers).forEach(function (k) { h[k] = headers[k]; });
  res.statusCode = status;
  Object.keys(h).forEach(function (k) { res.setHeader(k, h[k]); });
  res.end(JSON.stringify(body));
}

function methodNotAllowed(res, allow) {
  json(res, 405, { code: "E_METHOD", message: "不支持的请求方式" }, { Allow: allow.join(", ") });
}

// 把「平台已经替我们读走的 body」翻译成我们这一层的形状。
//
// 三个来源，优先级从高到低：
//   ① `req.body` 已经被平台填好（Vercel 在 content-type 是 JSON 时会先自己解析）
//      —— 解析成功时是对象、失败时可能是**原始字符串或 Buffer**；
//   ② 流还没读 —— 我们自己读；
//   ③ 流**已经被读完了**（`req.readableEnded` / `req.complete`，或干脆没有
//      data/end 事件可听）—— 这时再挂监听就永远等不到 end。
//
// ⚠️ ①与③是同一次故障的两半（Issue #276 后续，线上实测）：
//    Vercel 的 Node 运行时面对 `Content-Type: application/json` 会**先自己读一遍流**。
//    正文不是合法 JSON 时（多为代理重发、前端拼错、被中间层改写），它把流读空、
//    又不往 `req.body` 放东西 —— 于是我们这两个监听器（data / end）一个都不会触发，
//    `readBody` 的 Promise **永不 resolve**，函数被平台判超时：
//      症状 = 所有 POST /api/* 回 **500 E_INTERNAL**，
//      前端 auth-api 把它翻成「**服务暂时不可用，请稍后重试。**」。
//    实测（2026-09-24，对着线上 kuibu.app）：
//      curl -X POST .../api/reset-request -H 'Content-Type: application/json' -d 'oops'
//        → 500 {"code":"E_INTERNAL",...}      ← 用户看到的那句话
//      同一份正文换成 text/plain → 400 E_BAD_BODY（平台不管非 JSON，交给我们自己读）
//    本地（scripts/serve.js）永远复现不出来 —— 本机没有那一层「平台先读」。
//
// 所以这一条要守住两件事：
//   ① **绝不挂起**：流已经读完（或压根读不动）时立刻给出结论，不等人；
//   ② 结论是「这份正文不是合法 JSON」= null，由 handler 如实回 400 E_BAD_BODY ——
//      「请求本身不对」不该被说成「服务端出了点问题」。
function readBody(req) {
  return new Promise(function (resolve) {
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === "string") {
        try { return resolve(JSON.parse(req.body)); } catch (e) { return resolve(null); }
      }
      // Buffer / Uint8Array：平台原样交给我们的裸字节，自己解一遍。
      // ⚠️ 不能当成「已经解析好的对象」直接 resolve —— 那会让上层拿到一个
      //    Buffer，`body.email` 恒为 undefined，症状比 500 更难查
      //    （每一条参数都悄悄变成空值，界面只说「邮箱格式不对」）。
      if (Buffer.isBuffer(req.body) || req.body instanceof Uint8Array) {
        var text0 = Buffer.from(req.body).toString("utf8");
        if (!text0) return resolve({});
        try { return resolve(JSON.parse(text0)); } catch (e) { return resolve(null); }
      }
      return resolve(req.body);
    }

    var chunks = [];
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      var text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch (e) { resolve(null); }
    }

    // ③ 流已经被平台读完：再挂监听就永远等不到 end（上面那条实测）。
    //    判据用 Node 官方的两个只读位，不靠猜：
    //      readableEnded —— 已经读过 EOF
    //      complete      —— 请求已完整收到
    //    两个都真、而 req.body 又是空的，唯一如实结论就是「没有正文可读」= {}。
    //    ⚠️ 这里回 {} 而不是 null：与「客户端本来就没发正文」同一档
    //    （本地 POST 不带 body 时也是 {}），由各路由自己按缺字段回它自己的
    //    400（如 E_EMAIL_FORMAT），不是「正文不是合法 JSON」。
    if (req.readableEnded === true || req.complete === true) {
      // 有些运行时会在 body 解析失败后再挂一个空的 data 流；若还能同步读到
      // 已经缓冲的内容就用它，否则直接收工 —— 反正不许挂起。
      if (typeof req.read === "function") {
        try {
          var buf = req.read();
          if (buf) chunks.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
          if (chunks.length) return finish();
        } catch (e) { /* 读不动就按空处理 */ }
      }
      return resolve({});
    }

    req.on("data", function (c) {
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      if (Buffer.concat(chunks).length > 64 * 1024) { done = true; resolve(null); }
    });
    req.on("end", finish);
    req.on("error", function () { done = true; resolve(null); });
  });
}

function clientIp(req) {
  var h = req.headers || {};
  var xff = h["x-forwarded-for"] || h["x-real-ip"] || "";
  var first = String(xff).split(",")[0].trim();
  return first || "unknown";
}

function deviceId(req, body) {
  var v = (body && body.deviceId) || (req.headers && req.headers["x-kb-device"]) || "";
  v = String(v).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  return v || "unknown";
}

function notConfigured(res, what) {
  log("api.not_configured", { what: what });
  json(res, 503, {
    code: "E_NOT_CONFIGURED",
    message: "服务端还没配置好（缺 " + what + "）。当前仍可完全离线使用本站。"
  });
}

module.exports = {
  json: json,
  log: log,
  redact: redact,
  readBody: readBody,
  clientIp: clientIp,
  deviceId: deviceId,
  methodNotAllowed: methodNotAllowed,
  notConfigured: notConfigured
};
