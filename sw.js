const CACHE_NAME = "poem-app-v241";

const PRECACHE = [
  "./",
  "./manifest.webmanifest",
  "./css/style.css",
  "./css/classic.css",
  "./css/account.css",
  "./fonts/NotoSerifSC-400.woff2",
  "./fonts/NotoSerifSC-600.woff2",
  "./fonts/NotoSansSC-400.woff2",
  "./fonts/NotoSansSC-600.woff2",
  "./classic/",
  "./mine/",
  "./settings/",
  "./settings/general/",
  "./settings/recite/",
  "./settings/lists/",
  "./settings/reader/",
  "./self-check/",
  "./login/",
  "./verify/",
  "./reset/",
  "./admin/",
  "./plans/",
  "./js/login.js",
  "./js/verify.js",
  "./js/reset.js",
  "./js/admin-page.js",
  "./js/plans.js",
  "./js/export-core.js",
  "./js/quiz.js",
  "./js/game.js",
  "./js/print-core.js",
  "./js/print.js",
  "./js/settings.js",
  "./js/settings-nav.js",
  "./js/self-check-gate.js",
  "./js/self-check.js",
  "./js/family-ui.js",
  "./js/mine.js",
  "./js/avatar-edit.js",
  "./js/play-modes.js",
  "./terms/",
  "./privacy/",
  "./css/legal.css",
  "./js/contact.js",
  "./data/pinyin-table.js",
  "./data/common-chars.js",
  "./js/pinyin.js",
  "./js/family.js",
  "./js/progress-store.js",
  "./js/read-sync.js",
  "./js/sync-store.js",
  "./js/auth-core.js",
  "./js/turnstile.js",
  "./js/auth-api.js",
  "./js/entitlement.js",
  "./js/account-api.js",
  "./js/avatar.js",
  "./js/avatar-image.js",
  "./js/speech.js",
  "./js/reader.js",
  "./js/storage.js",
  "./js/review-models.js",
  "./js/scheduler.js",
  "./js/app.js",
  "./js/chrome.js",
  "./js/classic.js",
  "./js/reader-core.js",
  "./data/site-index.js",
  "./progress/",
  "./js/progress.js",
  "./data/works-map.js",
  "./data/works-index.js",
  "./data/text-master.js",
  "./data/canonical-texts.js",
  "./data/group-order.js",
  "./js/collections.js",
  "./js/daily-extra.js",
  "./js/daily-extra-ui.js",
  "./js/report.js",
  "./settings/reports/",
  "./js/reports-page.js",
  "./js/pinyin-edit.js",
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
  "./poems/",
  "./js/poems.js",
  "./data/poems-classic.js",
  "./yuefu/",
  "./js/yuefu.js",
  "./data/poems-yuefu.js",

  "./tangshi/",
  "./data/poems-tangshi.js",
  "./js/tangshi.js",
  "./songci/",
  "./data/poems-songci.js",
  "./js/songci.js",
  "./guwen/",
  "./data/poems-guwen.js",
  "./js/guwen.js",
  "./zhaoming/",
  "./js/zhaoming.js",
  "./data/poems-zhaoming.js",
  "./yuanqu/",
  "./js/yuanqu.js",
  "./data/poems-yuanqu.js",
  "./jinxiandai/",
  "./js/jinxiandai.js",
  "./data/poems-jinxiandai.js",
  "./chengyu/",
  "./js/chengyu.js",
  "./data/poems-chengyu.js",
  "./changshi/",
  "./js/changshi.js",
  "./data/poems-changshi.js",
  "./library/",
  "./js/library.js",
  "./search/",
  "./js/search.js",
  "./icons/icon-192.png",
  "./icons/icon-256.png",
  "./icons/icon-384.png",
  "./icons/icon-512.png",
  "./icons/icon.svg"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
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

  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return;

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
          return caches.match("./");
        });
      })
    );
    return;
  }

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
