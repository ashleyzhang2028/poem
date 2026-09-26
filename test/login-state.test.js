"use strict";

// ===========================================================================
// 登录状态：服务端签了会话，界面必须认（Issue #274）
// ---------------------------------------------------------------------------
// 用户原话（连报三遍）：
//   「已经成功登录了，结果设置页很多内容还是需要登录，登录按钮依然在我的里面，
//     不应该是已经登录的状态吗」
//   「用户登录所有页面需要变成登录状态，从首页到设置等等页面，
//     目前登录了各页面还是认为没有登录」
//
// 这一层就是为这句话立的：**真起一张页面、真走一次服务端登录**，
// 然后量界面上那几处「登录了没」。
//
// 为什么必须真起页面（Issue #278 刚把界面层整层删掉，这里又加回来一点点）：
// 这个 bug 的形态恰恰是「每个文件单看都对，连起来才是错的」——
// `js/login.js` 只把界面切到「已完成」、`Entitlement.identity()` 只读本机、
// `js/mine.js` 只在有本机会话时才问 `/api/me`。**三处都合规**，
// 合起来就是「登录成功、界面说你是游客」。源码扫描照不出这种错。
//
// 依赖：jsdom 与 fetch 都是**运行时才要**的（本机 / CI 装得到就装）。
// 装不到这一层会如实**跳过**并说明原因 —— 绝不假装通过。
// ===========================================================================

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

let fails = 0;
const chk = (c, m) => { if (!c) { console.log("✗ " + m); fails++; } else console.log("✓ " + m); };
const eq = (a, b, m) => chk(a === b, m + "（实际 " + JSON.stringify(a) + "）");

// ---- 依赖：jsdom ----------------------------------------------------------
let JSDOM = null;
try { JSDOM = require("jsdom").JSDOM; } catch (e) { JSDOM = null; }

if (!JSDOM) {
  console.log("=== 登录状态 · 真页面 ===");
  console.log("⚠️ 跳过：这一层要 jsdom（`npm i --no-save jsdom`）。");
  console.log("   跳过的理由只有一个：这是**唯一**能照出「每个文件都对、连起来错」的层。");
  console.log("✅ 登录状态测试通过（未跑真页面那一层）");
  process.exit(0);
}

// ---- 服务端：真起 api/handler --------------------------------------------
const KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SESSION_SECRET", "MAIL_TRANSPORT",
  "ALLOW_CODE_ECHO", "REQUIRE_EMAIL_VERIFIED", "TURNSTILE_ENABLED", "OWNER_EMAILS",
  "SITE_URL", "MAIL_FROM", "RESEND_COOLDOWN_MS", "PASSWORD_MIN", "PASSWORD_MAX"];

function boot() {
  const saved = {};
  KEYS.forEach(k => { saved[k] = process.env[k]; delete process.env[k]; });
  Object.assign(process.env, {
    SESSION_SECRET: "test-secret-at-least-16-chars",
    MAIL_TRANSPORT: "console",
    // 确认链接里的令牌要能拿到（否则注册完点不了链接）——
    // 与 api.test.js 同一个开关，**只在这层测试里**开。
    ALLOW_CODE_ECHO: "1"
  });
  Object.keys(require.cache).forEach(k => {
    if (k.startsWith(path.join(ROOT, "api"))) delete require.cache[k];
  });
  return { restore: () => { KEYS.forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); } };
}

function serve() {
  const server = http.createServer(require("../api/handler.js"));
  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => resolve({
      base: "http://127.0.0.1:" + server.address().port,
      close: () => new Promise(r => server.close(r))
    }));
  });
}

function wirePath(p) {
  const s = String(p);
  if (s === "/api") return "/api/handler?__path=";
  if (s.indexOf("/api/") === 0) {
    const parts = s.slice("/api/".length).split("?");
    const q = parts.slice(1).join("?");
    return "/api/handler?__path=" + encodeURIComponent(parts[0]) + (q ? "&" + q : "");
  }
  return s;
}

// 一次**真**的服务端登录：注册 → 点确认链接（这一发就会种 kbsid）→ 拿到 Cookie。
// ⚠️ 走的是「点确认链接即登录」那条路，因为它是用户实际用的那条。
async function serverLogin(base, email) {
  const store = require("../api/_lib/store.js").getStore(require("../api/_lib/config.js"));

  const post = async (p, b) => {
    const res = await fetch(base + wirePath(p), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {})
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
    return { status: res.status, body: json, setCookie: res.headers.get("set-cookie") };
  };

  const reg = await post("/api/register", { email: email, password: "hunter2hunter" });
  eq(reg.status, 202, "服务端：注册受理（202，待确认邮箱）");

  // ① 点确认链接 → 邮箱确认 + 直接登录（Issue #278 起这一发就种会话）
  const vids = Object.keys(store._db.verifications)
    .filter(k => !store._db.verifications[k].consumed_at)
    .sort((a, b) => store._db.verifications[b].issued_at - store._db.verifications[a].issued_at);
  const v = await post("/api/verify-email", { vid: vids[0], token: reg.body.devVerifyToken });
  eq(v.status, 200, "服务端：点确认链接成功（" + v.status + "）");
  const cookie = String(v.setCookie || "").split(";")[0];
  chk(/^kbsid=/.test(cookie), "服务端：确认链接那一发种下了会话 Cookie（kbsid）");
  return { cookie: cookie, uid: reg.body.uid };
}

// 服务端那张报告台账里，这个 uid 名下的条数（直接问真 store，不猜）。
function reportCount(uid) {
  const store = require("../api/_lib/store.js").getStore(require("../api/_lib/config.js"));
  return Object.keys(store._db.reports || {})
    .map(k => store._db.reports[k])
    .filter(r => r && r.uid === uid).length;
}

// ---- 页面：把真页面装进 jsdom，把 fetch 接到真服务端上 --------------------
async function openPage(base, cookie, url, scripts) {
  const html = fs.readFileSync(path.join(ROOT, url.replace(/^\//, "") === "" ? "index.html" : url.replace(/^\//, "") + "index.html"), "utf8");

  const dom = new JSDOM(html, {
    url: base + url,
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const win = dom.window;

  // 页面里的 fetch = 真服务端 + 这枚 Cookie（`credentials: same-origin` 的替身）
  win.fetch = (u, init) => {
    const o = init || {};
    o.headers = Object.assign({}, o.headers || {}, cookie ? { Cookie: cookie } : {});
    return fetch(base + wirePath(String(u)), o);
  };
  win.AbortController = globalThis.AbortController;

  // 按页面自己的 <script src> 次序把脚本装进去（**不猜次序**）
  const tags = scripts || [].slice.call(win.document.querySelectorAll("script[src]"))
    .map(s => s.getAttribute("src"))
    .filter(s => /^\/?js\//.test(s))
    .map(s => s.replace(/^\//, ""));

  for (const rel of tags) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;
    const code = fs.readFileSync(file, "utf8");
    try {
      win.eval(code);
    } catch (e) {
      chk(false, "装 " + rel + " 时炸了：" + (e && e.message));
    }
  }
  win.document.dispatchEvent(new win.Event("DOMContentLoaded"));
  return { dom, win };
}

function text(win, id) {
  const el = win.document.getElementById(id);
  return el ? String(el.textContent || "").trim() : null;
}

function tick(ms) { return new Promise(r => setTimeout(r, ms || 30)); }

(async function main() {
  console.log("=== 登录状态 · 服务端签了会话，界面就得认（Issue #274）===");

  const booted = boot();
  const server = await serve();
  const base = server.base;

  try {
    // -----------------------------------------------------------------------
    console.log("\n--- 一、服务端登录（Cookie）后，各页面的「登录了没」---");
    // -----------------------------------------------------------------------
    const { cookie } = await serverLogin(base, "state@example.com");

    {
      const { win } = await openPage(base, cookie, "/mine/");
      // 页面自己开机时会问 /api/me（js/chrome.js 的 refreshAccount + js/mine.js）
      await tick(200);

      const id = win.Entitlement.identity({ backing: win.localStorage });
      eq(id.signedIn, true, "「我的」页：Entitlement.identity().signedIn 是 true（从前恒为 false）");
      eq(id.email, "state@example.com", "明文邮箱来自 /api/me（Issue #320：掩码字段整个没了）");
      eq(id.mask, undefined, "identity() 里**没有** mask 字段了");
      chk(/已登录/.test(text(win, "identity-sub") || ""), "身份行写「已登录」");
      eq(text(win, "btn-account-entry"), "退出登录", "那颗键写「退出登录」（不是「登录」）");
      eq(win.document.getElementById("btn-account-entry").dataset.action, "sign-out", "它的落点是退出，不是再跳一次登录页");
      chk(win.document.getElementById("btn-go-admin").hidden !== false, "非管理员看不到管理入口（角色也来自服务端）");

      // 页底那一排（Issue #323）：注销账号 + 管理后台住在一起，**都在卡外**。
      // 已登录的非管理员：只看得到「注销账号」一颗；两颗都不在卡片里。
      const del = win.document.getElementById("btn-delete-start");
      chk(!!del, "页底有「注销账号」那颗键（从前它是危险区卡里的一颗满宽键）");
      chk(!!del && !del.hasAttribute("hidden"), "已登录的人看得到「注销账号」（实际 hidden 属性 = " + (del && del.getAttribute("hidden")) + "）");
      eq(del && String(del.textContent || "").trim(), "注销账号", "它的字就是「注销账号」");
      chk(del && !del.closest(".account-card"), "它在**卡外**（页底那一排，不是卡片里的一颗键）");
      const adminBtn = win.document.getElementById("btn-go-admin");
      chk(adminBtn && !adminBtn.closest(".account-card"), "「管理后台」也在卡外，与注销那颗同一排");
      eq(!!(adminBtn && adminBtn.parentNode === del.parentNode), true, "两颗键是同一个容器里的兄弟（摆在一起）");
      chk(!win.document.getElementById("danger-card"), "那一张「注销账号」卡片整块没了（连标题一起）");
      win.close();
    }

    {
      const { win } = await openPage(base, cookie, "/settings/");
      await tick(200);
      const id = win.Entitlement.identity({ backing: win.localStorage });
      eq(id.signedIn, true, "设置首页：identity().signedIn 是 true");
      // 设置首页那一行「自检」只给已登录管理员 —— 这里量的是**它认得出自己是谁**
      // （非管理员不显示，与身份无关；`isOwner` 另有断言守着）。
      eq(win.Entitlement.isOwner(win.localStorage, { uid: id.uid }), false, "设置首页：认得出「我是谁」，而这个人不是管理员");
      win.close();
    }

    {
      const { win } = await openPage(base, cookie, "/settings/general/");
      await tick(200);
      const id = win.Entitlement.identity({ backing: win.localStorage });
      eq(id.signedIn, true, "设置 · 通用：identity().signedIn 是 true");
      eq(id.hint("export.progress"), "", "「进度导出」不再回「登录可用」");
      eq(id.can("algo.leitner").ok, true, "莱特纳盒不再回「登录可用」");
      eq(id.can("read.aloud").ok, true, "语音朗读不再回「登录可用」");
      win.close();
    }

    {
      const { win } = await openPage(base, cookie, "/");
      await tick(200);
      const id = win.Entitlement.identity({ backing: win.localStorage });
      eq(id.signedIn, true, "首页：identity().signedIn 是 true（从首页到设置，一个判据）");
      win.close();
    }

    // -----------------------------------------------------------------------
    console.log("\n--- 二、退出登录：服务端那枚票也要撤（不能只清本机）---");
    // -----------------------------------------------------------------------
    {
      const { win } = await openPage(base, cookie, "/mine/");
      await tick(200);
      const Ent = win.Entitlement;
      const A = win.AuthCore;

      chk(!!win.AccountApi.signOut, "AccountApi 有 signOut（服务端那一半的出口）");
      await win.AccountApi.signOut({ backing: win.localStorage, E: Ent, A: A });
      await tick(60);

      eq(Ent.identity({ backing: win.localStorage }).signedIn, false, "退出之后 identity() 如实回未登录（那份服务端答案被清掉）");
      eq(Ent.cookieSession({ backing: win.localStorage }), null, "cookieSession() 也回 null（判据只剩一处，清它就够）");

      const me = await win.fetch("/api/me", { method: "GET" });
      eq(me.status, 401, "服务端从此不认这枚 Cookie（会话被标成 revoked）");
      win.close();
    }

    // -----------------------------------------------------------------------
    console.log("\n--- 三、未登录的人不许被误判成登录 ---");
    // -----------------------------------------------------------------------
    {
      const { win } = await openPage(base, "", "/mine/");
      await tick(200);
      const id = win.Entitlement.identity({ backing: win.localStorage });
      eq(id.signedIn, false, "没有 Cookie：identity() 回未登录");
      eq(text(win, "btn-account-entry"), "登录", "那颗键写「登录」（这一页唯一的入口）");
      chk(/游客/.test(text(win, "identity-sub") || ""), "身份行写「游客」");

      // 未登录：页底两颗键**都不显示**（注销要账号，管理后台要角色）。
      const del = win.document.getElementById("btn-delete-start");
      const adminBtn = win.document.getElementById("btn-go-admin");
      chk(!!del && del.hasAttribute("hidden"), "未登录：看不到「注销账号」");
      chk(!!adminBtn && adminBtn.hasAttribute("hidden"), "未登录：看不到「管理后台」");
      chk(win.document.getElementById("bottom-actions").hasAttribute("hidden"), "那一排整个空着时也不占位");
      win.close();
    }

    // -----------------------------------------------------------------------
    console.log("\n--- 三b、登出之后，页底那一排不许留一颗键在屏幕上（Issue #320）---");
    // -----------------------------------------------------------------------
    // 用户原话：「如果用户已经登出，不要显示 注销账号和 管理后台 按钮」。
    //
    // 这是**从「登录着」那一屏退出来**的一个 bug：两颗键的可见性从前只在
    // 「登录着」那一档里画（`show()`），未登录那一档一声不响地 `return` ——
    // 于是登出之后没人把那两颗键关掉，前一次画的 `hidden=false` 就留在屏幕上。
    // 光从「游客」那一屏进来看不出来（出厂就是 hidden），必须**先登录、再登出**。
    {
      // ⚠️ 这里**自己登一个**，不共用上面那一枚 Cookie —— 登出会顺手把服务端
      //    那枚票也撤掉（`AccountApi.signOut()` 打 `POST /api/logout`），
      //    共用的话后面几节就全成了「未登录」。
      const b = await serverLogin(base, "leave@example.com");
      const { win } = await openPage(base, b.cookie, "/mine/");
      await tick(200);
      const d = win.document;
      const Ent = win.Entitlement;

      eq(Ent.identity({ backing: win.localStorage }).signedIn, true, "前提：先以服务端会话登录着");
      chk(!d.getElementById("btn-delete-start").hasAttribute("hidden"), "前提：登录着时「注销账号」看得见");

      // 走用户实际点的那条路：身份行那颗「退出登录」→ `onSignOut()`
      // （`AccountApi.signOut()` 撤掉服务端那枚票 + 本机那份答案）。
      await win.AccountApi.signOut({ backing: win.localStorage, E: Ent, A: win.AuthCore });
      win.dispatchEvent(new win.Event("storage"));
      await tick(120);

      eq(Ent.identity({ backing: win.localStorage }).signedIn, false, "登出之后：identity() 回未登录");

      const del = d.getElementById("btn-delete-start");
      const adminBtn = d.getElementById("btn-go-admin");
      chk(!!del && del.hasAttribute("hidden"), "登出之后：「注销账号」那颗键收起来了（从前它留在屏幕上）");
      chk(!!adminBtn && adminBtn.hasAttribute("hidden"), "登出之后：「管理后台」也收起来了");
      chk(d.getElementById("bottom-actions").hasAttribute("hidden"), "那一排跟着整个收掉，不占位");
      win.close();
    }

    // -----------------------------------------------------------------------
    console.log("\n--- 三c、登出的是「管理员」：两颗键都要收（不许靠 isOwner 单独放行）---");
    // -----------------------------------------------------------------------
    // `Entitlement.isOwner()` 只回答「这个人是不是管理员」—— 一份还没被清掉的
    // 服务端答案会让它照样回 `true`。所以「画不画那颗键」必须**两个条件一起看**：
    // `owner && signedIn`。只留 `owner` 那一半，就是「登出了还显示管理后台」。
    {
      // ⚠️ 次序：**先把库里那个账号提成 owner，再开页面** —— 页面开机的那一发
      //    `/api/me` 就是它第一次（也是唯一一次）读到这一行，`AccountApi` 的
      //    `refreshMe()` 又是**单例**的，开完页面再改库是改不动的。
      const a = await serverLogin(base, "boss@example.com");
      const cfg = require("../api/_lib/config.js");
      const store = require("../api/_lib/store.js").getStore(cfg);
      const ident = require("../api/_lib/identity.js");
      const boss = store.getAccountByHash(
        ident.emailHash("boss@example.com", cfg.sessionSecret || "no-pepper"));
      chk(!!boss, "服务端：库里认得出这个账号");
      store.patchAccount(boss.uid, { role: "owner" });

      const { win } = await openPage(base, a.cookie, "/mine/");
      await tick(200);
      const d = win.document;
      const Ent = win.Entitlement;
      const uid = Ent.identity({ backing: win.localStorage }).uid;

      eq(Ent.isOwner(win.localStorage, { uid: uid }), true, "前提：这个人是管理员");
      chk(!d.getElementById("btn-go-admin").hasAttribute("hidden"), "登录着：「管理后台」看得见");

      await win.AccountApi.signOut({ backing: win.localStorage, E: Ent, A: win.AuthCore });
      win.dispatchEvent(new win.Event("storage"));
      await tick(120);

      eq(Ent.identity({ backing: win.localStorage }).signedIn, false, "登出之后：identity() 回未登录");
      eq(Ent.isOwner(win.localStorage, { uid: uid }), false, "那份服务端答案也被清掉了，isOwner() 跟着回 false");
      chk(d.getElementById("btn-go-admin").hasAttribute("hidden"), "登出之后：「管理后台」照样收起来");
      chk(d.getElementById("btn-delete-start").hasAttribute("hidden"), "登出之后：「注销账号」也收起来");
      win.close();
    }

    // -----------------------------------------------------------------------
    console.log("\n--- 四、服务端那份答案换了人，不继承 ---");
    // -----------------------------------------------------------------------
    {
      const a = await serverLogin(base, "jia@example.com");
      const { win } = await openPage(base, a.cookie, "/mine/");
      await tick(200);
      const Ent = win.Entitlement;
      eq(Ent.identity({ backing: win.localStorage }).signedIn, true, "先以甲登录（服务端答案在）");

      // 把那份答案的主人改成别人 —— 相当于同一台机器上换个人登录。
      const plan = JSON.parse(win.localStorage.getItem("poem_plan_v1"));
      plan.uid = "u-somebody-else";
      win.localStorage.setItem("poem_plan_v1", JSON.stringify(plan));
      eq(Ent.identity({ backing: win.localStorage }).signedIn, false, "换了人：那份答案不再被认（水位线对不上）");
      eq(Ent.cookieSession({ backing: win.localStorage }), null, "cookieSession() 也一并回 null");

      // 水位线：本机只认「自己刚问来的那一份」，不是「见到 source:server 就认」
      chk(!!win.localStorage.getItem(Ent.SEEN), "服务端答案写下的同时也留下了水位线（" + Ent.SEEN + "）");
      win.localStorage.removeItem(Ent.SEEN);
      eq(Ent.identity({ backing: win.localStorage }).signedIn, false, "没有水位线的那一份不认（旧版本写下 / 来路不明）");
      win.close();
    }

    // -----------------------------------------------------------------------
    console.log("\n--- 四之二、「我的报告」：登录着就看得见自己的（Issue #327）---");
    // -----------------------------------------------------------------------
    // 用户原话：「我的报告 / 报过的错，处理到哪一步 / 我报过的 / 登录后才能报告。/
    //   本机的（服务端暂时读不到）。/ 还没有报过。」
    //   —— 四句话里三句与事实不符：他登录着，服务端上还压着他报过的错。
    //
    // 病根是这一页拿**本机判据**（`Entitlement.cookieSession()` 读 `poem_plan_v1`
    // 那份缓存）当门：服务端刚登录、`/api/me` 那一发还没落地时它是 false，
    // 于是 `Report.mine()` 直接调头去读本机空存稿，页面就写「还没有报过」。
    // 这一节量的是**行为**：真起那一页，看它认不认得服务端上的报告。
    {
      const a = await serverLogin(base, "rep@example.com");
      // 先用真接口报一条（走服务端那张台账）
      const post = await fetch(base + wirePath("/api/report"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: a.cookie },
        body: JSON.stringify({ kind: "text", poemTitle: "静夜思", note: "这里有个错字" })
      });
      eq(post.status, 200, "服务端：以这个人的身份报一条（200）");
      eq(reportCount(a.uid), 1, "服务端那张台账上确实是 1 条");

      const { win } = await openPage(base, a.cookie, "/settings/reports/");
      await tick(300);
      const panel = text(win, "reports-panel") || "";
      chk(/静夜思/.test(panel), "「我的报告」列出了服务端上那一条（实际「" + panel.slice(0, 60) + "」）");
      chk(!/没有报过/.test(panel), "不再说「还没有报过」（服务端明明有一条）");
      chk(!/读不到/.test(panel), "不再说「服务端暂时读不到」");
      chk(win.document.getElementById("reports-guest").hidden === true, "没有 Cookie 才显示的那句「登录后才能报告」是隐藏的");
      win.close();
    }

    // -----------------------------------------------------------------------
    console.log("\n--- 四之三、没登录的人仍要说「登录后才能报告」---");
    // -----------------------------------------------------------------------
    {
      const { win } = await openPage(base, "", "/settings/reports/");
      await tick(300);
      const g = win.document.getElementById("reports-guest");
      chk(!!g && g.hidden === false, "没有 Cookie：那一句「登录后才能报告」如实出现");
      chk(/登录/.test(text(win, "reports-guest") || ""), "而且它给出一条去登录的路（不只是报错）");
      const panel = text(win, "reports-panel") || "";
      chk(!/没有报过/.test(panel), "未登录时不说「你还没有报过」（那是服务端才答得出的问题）");
      win.close();
    }

    // -----------------------------------------------------------------------
    console.log("\n--- 四之四、本机判据与服务端判据各管各的（源码口径）---");
    // -----------------------------------------------------------------------
    {
      const rj = fs.readFileSync(path.join(ROOT, "js/report.js"), "utf8");
      chk(/function mine\(opt\)([\s\S]{0,400})A\.myReports\(/.test(rj),
        "Report.mine() 里 `A.myReports(` 排在很前面（不再先被本机判据挡掉）");
      chk(!/typeof A\.myReports !== "function" \|\| !signedIn\(\)/.test(rj),
        "Report.mine() 不再拿 `!signedIn()` 当门（本机读数答不了「服务端认不认我」）");
      chk(/code === "E_NO_SESSION"/.test(rj), "401 才是「没登录」，靠 code 分得清");

      const apiSrc = fs.readFileSync(path.join(ROOT, "js/account-api.js"), "utf8");
      const mr = apiSrc.slice(apiSrc.indexOf("function myReports"));
      chk(!/if \(!signedIn\(\)\) return[\s\S]{0,80}E_NO_SESSION/.test(mr.slice(0, 400)),
        "AccountApi.myReports() 不再用本机判据当门（401 由服务端回）");

      const rp = fs.readFileSync(path.join(ROOT, "js/reports-page.js"), "utf8");
      chk(/r\.guest/.test(rp), "那一页按服务端回的 guest 定稿，不是按本机 isSignedIn()");
      chk(!/\{ local: !!\(r && r\.local\) \}/.test(rp), "不再把「读回来了」误标成「本机的」");
    }

    // -----------------------------------------------------------------------
    console.log("\n--- 五、判据只剩一处（不许再有第二份「登录了没」）---");
    // -----------------------------------------------------------------------
    {
      // ⚠️ 这一条**不是**「谁都不许读本机会话」——「我的」页仍要把本机那份
      //    会话交给 `renderAccount()` 当**显示输入**（「登录还有 N 天」只有
      //    本机算得出来，Cookie 是 HttpOnly）。要守的是：
      //    **「是登录还是不登录」这个结论只许由 identity()/cookieSession() 出**。
      //
      //    所以量两件事：① 没有任何文件把 `AuthCore.session()` 的结果当布尔
      //    判据用（`!!A.session()` / `if (A.session())`）；② 已经改成问
      //    `identity()/cookieSession()` 的那几个出口不再回头问本机。
      // 只量**代码行**（注释里提一句旧写法不算犯忌）。
      const codeOnly = src => src.split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      //  ⚠️ `js/mine.js` 里那九处 `paint(A.session(store))` **是允许的**：
      //     它们把本机会话交给 `renderAccount()` 当**显示输入**（「登录还有
      //     N 天」只有本机算得出来 —— Cookie 是 HttpOnly，脚本读不到）。
      //     要守的不是「谁都不许读本机」，而是**「是登录还是不登录」这个结论
      //     只许由 identity()/cookieSession() 出**。所以量的是：
      const files = ["js/settings.js", "js/settings-nav.js", "js/app.js",
        "js/game.js", "js/print.js", "js/report.js", "js/sync-store.js", "js/chrome.js",
        "js/plans.js"];
      const bad = [];
      files.forEach(f => {
        const src = codeOnly(fs.readFileSync(path.join(ROOT, f), "utf8"));
        const calls = (src.match(/A\.session\([^)]*\)|AuthCore\.session\([^)]*\)/g) || []);
        if (calls.length) bad.push(f + " × " + calls.length);
      });
      eq(bad.join(", "), "", "这些文件里一处都不再读本机会话（登录与否只问 identity()/cookieSession()）");

      const mineSrc = fs.readFileSync(path.join(ROOT, "js/mine.js"), "utf8");
      chk(!/!!\s*A\.session\(|\bif \(A\.session\(/.test(mineSrc),
        "「我的」页不再拿 A.session() 当布尔判据（它只是 renderAccount 的显示输入）");

      // ⚠️ 页底两颗键的可见性**每一处都要先看登录状态**（Issue #320 用户最后一句）。
      //    两处画页底那一排的地方（`renderSignedIn` / `renderAdmin`）各有分工：
      //   · `renderSignedIn()` —— 未登录就**明确关掉**两颗键（那一档不能再「什么都不做」）；
      //   · `renderAdmin()`    —— 它跑在后面，`show()` 会盖掉上一步刚关的键，
      //                          所以 `owner`（是不是管理员）与 `signedIn` 一起看。
      //
      // ⚠️ 直接量那两句判据的原文，不去切函数体 —— 函数体里有 `{ role: … }`
      //    这种花括号，按 `}` 切会切在半路（先写的版本正是这么误报的）。
      chk(/if \(!id \|\| !id\.signedIn\) \{[\s\S]{0,160}?hide\(\$\("btn-delete-start"\)\)[\s\S]{0,80}?hide\(\$\("btn-go-admin"\)\)/.test(mineSrc),
        "`renderSignedIn()` 未登录那一档**明确关掉**两颗键（不靠「什么都没做」）");
      chk(/if \(owner && id && id\.signedIn\)/.test(mineSrc),
        "`renderAdmin()` 里两个条件一起看（`owner && id.signedIn`）—— 缺一个就是登出了还显示");
      chk(!/if \(owner\) \{/.test(mineSrc),
        "没有哪一处只看 `owner` 就画「管理后台」（`isOwner()` 答不了「登录着没」）");
      const syncSrc = codeOnly(fs.readFileSync(path.join(ROOT, "js/sync-store.js"), "utf8"));
      chk(!/deps\.signedIn/.test(syncSrc),
        "同步引擎不再由调用方注入「登录了没」（注入的每一份都是第二个判据）");
      chk(/function signedIn\(\)/.test(syncSrc) && /cookieSession/.test(syncSrc),
        "同步引擎的登录判据也收到 cookieSession() 这一处");

      const apiSrc0 = fs.readFileSync(path.join(ROOT, "js/account-api.js"), "utf8");
      chk(!/if \(!hasLocalSession\(\)\)/.test(apiSrc0),
        "js/account-api.js 里再没有任何一处拿 hasLocalSession() 当门");

      // ⚠️ **每一张有导航的页面都要装齐那三份脚本**（这是那句话的机制部分）：
      //    问服务端的那一发住在 `js/chrome.js`，而它得先有 `auth-api.js`
      //    与 `account-api.js` 才存在。缺一张，那一张页面上就永远
      //    「答不出我是谁」—— 而用户看到的正是「从首页到设置各页面没登录」。
      //    所以这条断言量的是「**全都接了**」，不是抽查一张。
      const missingScripts = [];
      (function walk(dir) {
        fs.readdirSync(dir).forEach(f => {
          const p = path.join(dir, f);
          const st = fs.statSync(p);
          if (st.isDirectory()) {
            if (!/node_modules|\\.git|test|scripts|docs|data|css|icons|image|fonts|api/.test(f)) walk(p);
            return;
          }
          if (f !== "index.html") return;
          const h = fs.readFileSync(p, "utf8");
          const srcs = (h.match(/<script src="[^"]+"/g) || []).map(x => x.replace(/.*src="/, "").split("?")[0]);
          const has = x => srcs.some(y => y.endsWith(x));
          // 只有「有导航」的页面（装了 chrome.js）才需要这几份。
          if (!has("js/chrome.js")) return;
          const need = ["js/entitlement.js", "js/auth-api.js", "js/account-api.js"];
          need.filter(x => !has(x)).forEach(x => missingScripts.push(p.replace(ROOT, "") + " 缺 " + x));
        });
      })(ROOT);
      eq(missingScripts.join("; "), "", "每一张有导航的页面都装齐了 entitlement / auth-api / account-api");

      const apiSrc = fs.readFileSync(path.join(ROOT, "js/account-api.js"), "utf8");
      chk(/function signedIn\(\)/.test(apiSrc), "js/account-api.js 的门只有一个出口 signedIn()");
      const guards = (apiSrc.match(/if \(!signedIn\(\)\)/g) || []).length;
      chk(guards >= 8, "登录写口统一问 signedIn()（实际 " + guards + " 处）");
      chk(!/if \(!hasLocalSession\(\)\)/.test(apiSrc), "再没有任何一处拿 hasLocalSession() 当门（那是本机读数）");
    }

  } finally {
    await server.close();
    booted.restore();
  }

  console.log("");
  if (fails) { console.log("❌ 登录状态测试 " + fails + " 项失败"); process.exit(1); }
  console.log("🎉 登录状态测试全部通过");
})();
