#!/usr/bin/env node

const http = require("http");
const fs = require("fs");
const path = require("path");
const apiHandler = require("../api/handler.js");

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

function resolve(urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, "");
  const abs = path.resolve(ROOT, rel);

  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return { status: 403 };

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

  if (rel && fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    return { redirect: "/" + rel + "/" };
  }

  return { file: abs };
}

function createServer() {
  return http.createServer(function (req, res) {
    const urlPath = req.url.split("?")[0].split("#")[0] || "/";
    if (urlPath.startsWith("/api/")) {
      apiHandler(req, res);
      return;
    }
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
  });
}

if (require.main === module) {
  createServer().listen(PORT, function () {
    console.log("古诗词背诵已启动：http://localhost:" + PORT);
    console.log("手机访问：连同一 Wi-Fi，打开 http://<电脑局域网IP>:" + PORT);
  });
}

module.exports = { createServer, resolve };
