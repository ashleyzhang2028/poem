#!/usr/bin/env node
/**
 * 零依赖本地静态服务器：node scripts/serve.js
 * 手机测试：连同一 Wi-Fi，访问 http://<电脑IP>:8080
 *
 * URL 与线上保持一致：目录化路由，不带 .html
 *   /            首页
 *   /classic/    小古文
 *   /tangshi/    唐诗三百首
 *   /settings/   设置
 *   /terms/      用户协议
 *   /privacy/    隐私条款
 * 各页面的真实文件是对应目录下的 index.html。
 *
 * 另外兼容两种老写法，避免老书签 / 老缓存直接 404：
 *   /classic.html        → 301 到 /classic/
 *   /classic            → 301 到 /classic/
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 8080;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};

/**
 * 把请求路径解析成磁盘上的真实文件。
 * 返回 { file } 或 { redirect }（需要 301 到目录形式）。
 */
function resolve(urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, "");
  const abs = path.resolve(ROOT, rel);

  // 目录穿越保护：解析后必须仍在站点根目录内
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return { status: 403 };

  // /classic.html → /classic/（目录化之后老链接的兜底）
  if (rel && abs.endsWith(".html")) {
    const dir = abs.slice(0, -".html".length);
    if (fs.existsSync(path.join(dir, "index.html"))) {
      return { redirect: "/" + rel.slice(0, -".html".length) + "/" };
    }
  }

  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    if (!urlPath.endsWith("/")) return { redirect: urlPath + "/" };
    return { file: path.join(abs, "index.html") };
  }

  // /classic（无末尾斜杠、也不是文件）→ /classic/
  if (rel && fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    return { redirect: "/" + rel + "/" };
  }

  return { file: abs };
}

http.createServer(function (req, res) {
  const urlPath = req.url.split("?")[0].split("#")[0] || "/";
  const r = resolve(urlPath);

  if (r.redirect) {
    res.writeHead(301, { Location: r.redirect }).end();
    return;
  }
  if (!r.file) {
    res.writeHead(r.status || 404, { "Content-Type": "text/plain; charset=utf-8" }).end("404 Not Found");
    return;
  }

  fs.readFile(r.file, function (err, data) {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("404 Not Found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(r.file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache"
    }).end(data);
  });
}).listen(PORT, function () {
  console.log("古诗词背诵已启动：http://localhost:" + PORT);
  console.log("手机访问：连同一 Wi-Fi，打开 http://<电脑局域网IP>:" + PORT);
});
