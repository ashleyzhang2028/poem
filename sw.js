/**
 * Service Worker —— 让应用可安装、可离线使用
 *
 * 苹果手机说明：iOS Safari 不弹安装横幅，靠「分享 → 添加到主屏幕」安装；
 * 添加到主屏幕后本 SW 的缓存生效，断网也能正常背诵。
 *
 * ⚠️ 维护约定（很重要，曾因此踩坑）：
 *   下面的静态资源（css / js / 字体）一律「缓存优先」——命中缓存就直接返回，
 *   不会回源比对。所以**只要改了 css/ 或 js/ 里的任何文件，就必须把
 *   CACHE_NAME 的版本号 +1**，否则老用户会一直拿着旧副本：
 *   表现为「明明改了样式，刷新后还是老样子」，改多少遍都不生效。
 *   （`activate` 里会删掉所有非当前版本的缓存，升版本即完成替换。）
 *
 *   改了哪些文件就升一次，宁可多升，不要漏升。
 *   版本回滚同理：版本号只能往上走，不要改回旧号，否则老缓存会被复用。
 *
 * 版本历史：
 *   v19  全站 URL 目录化（/settings/ 等，不再带 .html）
 *   v20  （跳过）目录化之后又改了 css/style.css、css/classic.css、js/chrome.js
 *   v21  设置页分组标题降级为辅助标签（字号 / 字重 / 颜色三重降级）
 *   v22  全站 UI 走查：阅读器顶栏并入全站顶栏、详情页工具条改换行、
 *        播放栏出现时页签让路、法务页底部留白、iOS 输入框防缩放真正生效、
 *        圆角与宽度收敛到变量（css/style.css、css/classic.css、
 *        css/legal.css、js/chrome.js、js/classic.js、classic/index.html）
 */
const CACHE_NAME = "poem-app-v22";

/* 需要在首次访问时预缓存的核心资源 */
const PRECACHE = [
  "./",
  "./manifest.webmanifest",
  "./css/style.css",
  "./css/classic.css",
  "./fonts/NotoSerifSC-400.woff2",
  "./fonts/NotoSerifSC-600.woff2",
  "./fonts/NotoSansSC-400.woff2",
  "./fonts/NotoSansSC-600.woff2",
  "./classic/",
  "./settings/",
  "./js/settings.js",
  "./terms/",
  "./privacy/",
  "./css/legal.css",
  "./js/contact.js",
  "./data/pinyin-table.js",
  "./data/common-chars.js",
  "./js/pinyin.js",
  "./js/speech.js",
  "./js/reader.js",
  "./js/storage.js",
  "./js/scheduler.js",
  "./js/app.js",
  "./js/chrome.js",
  "./js/classic.js",
  "./js/manifest-loader.js",
  "./data/poems-1.js",
  "./data/poems-2.js",
  "./data/poems-3.js",
  "./data/poems-4.js",
  "./data/poems-5.js",
  "./data/poems-6.js",
  "./data/poems-7.js",
  "./data/poems-8.js",
  "./data/poems-9.js",
  "./data/poems-10.js",
  "./data/poems-11.js",
  "./data/poems-12.js",
  "./data/index.js",
  "./data/poems-classic.js",
  "./icons/icon-120.png",
  "./icons/icon-152.png",
  "./icons/icon-167.png",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-256.png",
  "./icons/icon-384.png",
  "./icons/icon-512.png",
  "./icons/icon.svg"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // 单个资源失败不应让整次安装失败，用 allSettled 兜底
      return Promise.allSettled(PRECACHE.map(function (url) {
        return cache.add(new Request(url, { cache: "reload" }));
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE_NAME ? null : caches.delete(k);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  const req = event.request;

  // 只处理同源 GET
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 页面导航：网络优先（顺手更新该页缓存）；离线时先回退到「同一页面」的缓存，
  // 再回退到首页 —— 直接回退首页会让断网下的设置页、法务页莫名回到列表页
  if (req.mode === "navigate") {
    const pageUrl = req.url.split("#")[0].split("?")[0];
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(pageUrl, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(pageUrl).then(function (hit) {
          if (hit) return hit;
          // 首页现在的 URL 就是 "./"（目录化路由，不再有 index.html）
          return caches.match("./");
        });
      })
    );
    return;
  }

  // 其余静态资源：缓存优先，回源后写入缓存
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
