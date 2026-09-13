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
 *   v23  小古文连读改用圆形播放键：工具栏「连读」与各分组右侧的
 *        「随机连读」都换成与首页今日条同款的圆键（一大一小两档），
 *        ▶ / ⏸ 同键两态、不再有随状态改写的可见文字
 *        （classic/index.html、css/classic.css、js/classic.js）
 *   v24  字号在最细处再补一档 13px（Issue #55）：默认档仍是 17px 不变，
 *        A－ 在 15px 之下还能再多点一次（js/app.js、js/classic.js）；
 *        小古文页首收紧：搜索框与第一个分组标题之间的空档由 28px 收到 18px
 *        （.toolbar 的 margin-bottom 与 .group-head 的上内边距各让一点）
 *   v25  小古文条目短竖条透明度降到 55%；卡头下内边距 8px、首条不再画分隔线
 *        （卡头与圆键离开那条线）；序号圆挪进标题行、直径与字号同高（.item-num
 *        取代 .item-index），列表每行文字多出 40 余像素
 *        （css/style.css、css/classic.css、js/app.js、js/classic.js）
 *   v26  小古文搜索框提示字与「全部 / 未读」同字号（Issue #55）：
 *        只压 ::placeholder 到 12.5px，输入的文字仍是 16px（iOS 聚焦不缩放），
 *        并把「输入框字号」这条写在 classic.css 自己末尾、不再只靠 style.css
 *        （css/classic.css）
 *   v27  首页今日条两颗圆的直径真正对齐（Issue #55）：
 *        圆环与左侧播放键同读 --today-btn-size（46px），真机量得 46×46 相等、
 *        中线齐平；不给描边做补偿（svg overflow: hidden 会把描边裁进盒内，
 *        盒子即最大外径）—— 见 css/style.css 里那条路标注释（css/style.css）；
 *        序号圆与下方正文左对齐（Issue #55 后续）：标题行收掉 -12px 负外边距，
 *        圆周左缘 = 篇名 = 元信息，三者同一条左基准线；
 *        列表序号圆去掉淡绿底，改为与序号同色的 1px 圆形描边（空心圆），
 *        数字水平 + 垂直居中；圆外径仍是 16.5px（border-box，描边不撑大圆），
 *        与「圆 / 篇名 / 元信息同一条左基准线」并存 —— 描边不改变圆的占位宽度；
 *        小古文卡片：左侧短竖条整体隐藏、条目左右内边距收成对称的 8px
 *        （圆左内缘 = 箭头右内缘）；搜索框提示字用 translateY(-2.25px)
 *        上抬回水平中轴（输入文字 16px 本来居中，不动输入框本体）
 *        （css/style.css、css/classic.css）
 *   v28  首页今日条两颗圆的直径再收 4px（46 → 42，Issue #55 后续）：
 *        播放键与 0/5 进度环同读 --today-btn-size，一起缩小、外径仍逐位相等，
 *        中线齐平；SVG 图标尺寸不动（css/style.css）
 *   v29  小古文索引页列表内容与卡片左缘的间距 +2px（Issue #55 后续）：
 *        条目左内边距 8 → 10px，右侧仍是 8px、不动 ——
 *        用户明确要求「只加左侧」（css/classic.css）
 *   v30  小古文条目的播放键左侧间距再减 12px（Issue #55 后续）：
 *        卡内 gap 清零，改由两颗图标各自给外边距 —— 圆键左缘贴内容块右缘
 *        （12 - 12 = 0），与箭头之间仍是 6px（css/classic.css）
 *   v31  小古文条目的正文宽度放开（Issue #55 后续）：
 *        去掉播放键的 margin-left:-12px（负外边距只会把圆键压到正文上，
 *        正文一个字都不会变长）；内容块由 flex: 1 1 0% 改成 flex: 0 1 auto，
 *        宽屏下按内容取宽、摘要在自身宽度用完处结束，正文一路排到播放键跟前；
 *        窄屏下圆键左缘与正文那一行的可用宽度分毫不动（css/classic.css）
 *   v32  首页今日条播放键的「内径」收 4px（Issue #55 后续）：
 *        外径 42px 不动，只把里面的 ▶ / ⏸ 图形从 19px 图标框收到 14px ——
 *        内径另起一个唯一来源 --today-btn-inner（与 --today-btn-size 分开），
 *        ▶ / ⏸ 同框，两态切换不会忽大忽小（css/style.css）
 *   v33  **全站播放键的三角形改为空心**（Issue #55 后续）：
 *        凡「听」的圆键里那颗 ▶ 一律只留描边、不填色，描边色即圆环色
 *        （currentColor），与「列表序号空心圆 / 折叠箭头空心三角」同一套
 *        「空心描边」语言；三角轮廓较原实心路径内收 1px，
 *        描边宽 2.4（24 viewBox）≈ 圆径的 10%，与 18×18 箭头图标
 *        （stroke-width 1.8）笔画同量级。
 *        改动落在 index.html、classic/index.html、
 *        js/app.js（今日条 + 列表项）、js/classic.js（列表项 + 分组小键）、
 *        js/reader.js（底部播放栏 ▶ / 上一首 / 下一首三枚）
 */
const CACHE_NAME = "poem-app-v33";

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
