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
