/**
 * Serverless 处理器的公共外壳：JSON 应答、方法校验、错误归一化。
 *
 * 三条硬规矩（docs/architecture.md §4.3 的 review checklist）：
 *   1. **明文验证码不进任何日志** —— 这个文件里的 log 只接受掩码与 id，
 *      并且有一个安全序列化器把 code / codeHash / salt / token 一律抹掉
 *   2. **不透露「这个邮箱是否存在」** —— 成功路径的响应体永远一致
 *   3. 所有写接口都要频控（频控在 handlers 里，这里只提供外壳）
 *
 * ⚠️ 本文件同时被 Vercel（Node 运行时）与 test/api.test.js 使用，
 *    因此不 import 任何第三方包，只用 Node 内建。
 */
"use strict";

var SECRET_KEYS = /^(code|codeHash|salt|token|sessionSecret|supabaseServiceKey|apiKey|sid|pepper)$/i;

/**
 * 安全序列化：**给日志用的**。
 * 明文码、哈希、盐、密钥一律替换成 [redacted]。
 * 这是「明文验证码不进任何日志」这条在代码里唯一的落点 ——
 * 只要所有日志都从这里过，就不会漏。
 */
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
  // 单行 JSON，便于 Vercel 日志检索；detail 一律过 redact
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

/** 读 JSON 请求体：Vercel 会预解析到 req.body，本地 / 测试里可能是流 */
function readBody(req) {
  return new Promise(function (resolve) {
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === "string") {
        try { return resolve(JSON.parse(req.body)); } catch (e) { return resolve(null); }
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
    req.on("data", function (c) {
      chunks.push(c);
      if (Buffer.concat(chunks).length > 64 * 1024) { done = true; resolve(null); }  // 64KB 上限：进度也是 KB 级
    });
    req.on("end", finish);
    req.on("error", function () { done = true; resolve(null); });
  });
}

/** 客户端 IP：Vercel 走 x-forwarded-for，取第一段 */
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

/** 环境变量里声明的密钥是否齐全 —— 缺了就让接口以「未启用」应答，而不是 500 */
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
