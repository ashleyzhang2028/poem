"use strict";

/**
 * 微信小程序登录那两条路由 + 会话认 Bearer（Issue #71，2026-10-11）。
 *
 * 这一层盯的就是 Issue 里点名的那件事：**「登录成功了但 /api/sync/* 一律 401」**。
 * 它是本项目反复在修的那类错 —— 补了一半看起来像全对：
 *   - 只加路由不认 Bearer → 登录回 token、跟着每条同步 401
 *   - 加了白名单但把 `device` 写成 `deviceId` → 不报错，限流拆成空桶
 *   - `settings:v1` / `profile:v1` 没有服务端白名单 → 「同步成功但什么也没发生」
 * 三件都不会报错，所以只能靠这一层把它们钉住。
 *
 * 全部走**真 http**：起 `api/handler.js`、发真请求。不 mock 路由表、不直接调 core ——
 * 直接调 core 会把「路由没注册」「handler 没塞 device」这类错整个放过去。
 */

const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

let fails = 0;
const chk = (c, m) => { if (!c) { console.log("✗ " + m); fails++; } else console.log("✓ " + m); };
const eq = (a, b, m) => chk(a === b, m + "（实际 " + JSON.stringify(a) + "）");

function boot(envVars) {
  const keys = ["SESSION_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "WX_APPID", "WX_SECRET"];
  const saved = {};
  keys.forEach(k => { saved[k] = process.env[k]; delete process.env[k]; });
  Object.assign(process.env, {
    SESSION_SECRET: "test-secret-at-least-16-chars",
    ...envVars
  });
  Object.keys(require.cache).forEach(k => {
    if (k.startsWith(path.join(ROOT, "api"))) delete require.cache[k];
  });
  return { restore: () => { keys.forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); } };
}

/** 假的 code2Session：不打外网。`BAD` 是微信那条「code 无效」 */
function fakeWx(codes) {
  const config = require("../api/_lib/config.js");
  const seen = [];
  config.wxFetch = (url) => {
    const u = new URL(url);
    seen.push(u.searchParams.get("js_code"));
    const code = u.searchParams.get("js_code");
    if (codes && codes[code]) return Promise.resolve({ json: () => Promise.resolve(codes[code]) });
    return Promise.resolve({
      json: () => Promise.resolve({ openid: "openid-" + code, unionid: "union-" + code, session_key: "sk" })
    });
  };
  return { seen };
}

function serve() {
  const entry = require("../api/handler.js");
  const server = http.createServer(entry);
  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        base: "http://127.0.0.1:" + server.address().port,
        port: server.address().port,
        close: () => new Promise(r => server.close(r))
      });
    });
  });
}

async function call(base, method, p, body, headers) {
  const init = { method, headers: Object.assign({ "Content-Type": "application/json" }, headers || {}) };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(base + p, init);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
  return { status: res.status, body: json, raw: text };
}

/** 原始 socket：用来发**原样大写**的 Authorization —— fetch 会把它归一成小写 */
function rawReq(port, text) {
  return new Promise(resolve => {
    const s = net.connect(port, "127.0.0.1", () => s.write(text));
    let buf = "";
    s.on("data", d => { buf += d; });
    s.on("end", () => resolve(buf));
  });
}

async function main() {
  /* ---------- 一、没配 WX_APPID / WX_SECRET：如实回 503，不假装登录过 ---------- */
  {
    const env = boot({});
    fakeWx();
    const srv = await serve();
    try {
      const r = await call(srv.base, "POST", "/api/wx/login", { code: "C1", device: "d1" });
      eq(r.status, 503, "缺 WX_APPID / WX_SECRET 时登录回 503");
      eq(r.body.code, "E_WX_NOT_CONFIGURED", "回的是「服务端没配好」，不是「你 code 不对」");
      chk(!("accessToken" in (r.body || {})), "绝不假装登录成功（没有 token 下发）");
    } finally {
      await srv.close();
      env.restore();
    }
  }

  /* ---------- 二、配好了：登录 → Bearer 拉/推 → 刷新 ---------- */
  {
    const env = boot({ WX_APPID: "wx_test", WX_SECRET: "sec_test" });
    fakeWx({ BAD: { errcode: 40029, errmsg: "invalid code" } });
    const srv = await serve();
    try {
      const login = await call(srv.base, "POST", "/api/wx/login", { code: "C1", device: "d1" });
      eq(login.status, 200, "登录通");
      chk(!!login.body.accessToken, "下发 accessToken");
      chk(!!login.body.refreshToken, "下发 refreshToken");
      chk("tier" in login.body && "role" in login.body && "userId" in login.body,
        "字段名与小程序端 applySession() 读的一致（tier / role / userId）");
      chk(!!login.body.expiresIn, "下发 expiresIn（客户端据此算过期）");
      eq(login.body.tier, "free", "新账号默认 free 档");
      eq(login.body.role, "user", "新账号默认 user 角色（服务端不给任何自助提权的口）");
      chk(login.setCookie === null || login.setCookie === undefined || login.setCookie === "",
        "不往小程序塞 Set-Cookie（它不接 Cookie，白带一个头只会误导）");

      const bearer = { authorization: "Bearer " + login.body.accessToken };

      /* 这一条就是 Issue #71 那句「/api/sync/* 会一律 401」 */
      const pull = await call(srv.base, "POST", "/api/sync/pull", { deviceId: "d1", since: 0 }, bearer);
      eq(pull.status, 200, "Bearer 打 /api/sync/pull 不再 401（tokenOf 认了）");

      const push = await call(srv.base, "POST", "/api/sync/push", { deviceId: "d1", recs: [] }, bearer);
      eq(push.status, 200, "Bearer 打 /api/sync/push 通（syncTierGate 只判会话，不判档位）");

      const me = await call(srv.base, "GET", "/api/me", undefined, bearer);
      eq(me.status, 200, "Bearer 也能问 /api/me（网页版同号那条兜底）");
      eq(me.body.uid, login.body.userId, "/api/me 认的是同一个人");

      const admin = await call(srv.base, "POST", "/api/admin/accounts", {}, bearer);
      chk(admin.status === 403, "普通 user 进不去管理口（档位放开不等于权限放开，实际 " + admin.status + "）");

      /* 不带凭据仍然要挡住 —— 放开 Bearer 不等于把闸拆了 */
      const none = await call(srv.base, "POST", "/api/sync/pull", { deviceId: "d1", since: 0 });
      eq(none.status, 401, "不带凭据仍然 401");
      eq(none.body.code, "E_NO_SESSION", "回的是 E_NO_SESSION");
      const forged = await call(srv.base, "POST", "/api/sync/pull", { deviceId: "d1", since: 0 },
        { authorization: "Bearer fake.fake" });
      eq(forged.status, 401, "伪造的令牌 401");

      /* 原样大写的头名 —— fetch 会归一成小写，只有原始 socket 测得到那条分支 */
      const body27 = JSON.stringify({ deviceId: "d1", since: 0 });
      const upper = await rawReq(srv.port,
        "POST /api/sync/pull HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n" +
        "Authorization: Bearer " + login.body.accessToken + "\r\n" +
        "Content-Length: " + Buffer.byteLength(body27) + "\r\nConnection: close\r\n\r\n" + body27);
      chk(/^HTTP\/1\.1 200/.test(upper), "Authorization 头名原样大写也认（某些代理给的就是这个）");

      /* 刷新 */
      const r1 = await call(srv.base, "POST", "/api/wx/refresh", { refreshToken: login.body.refreshToken, device: "d1" });
      eq(r1.status, 200, "刷新回一枚新令牌");
      chk(r1.body.accessToken && r1.body.accessToken !== login.body.accessToken, "新令牌与旧的不同");

      const oldAfter = await call(srv.base, "POST", "/api/sync/pull", { deviceId: "d1", since: 0 }, bearer);
      eq(oldAfter.status, 401, "刷新之后**旧**令牌当场作废（不然被偷走的那枚能一直用）");
      const fresh = await call(srv.base, "POST", "/api/sync/pull", { deviceId: "d1", since: 0 },
        { authorization: "Bearer " + r1.body.accessToken });
      eq(fresh.status, 200, "新令牌能用");
      const r2 = await call(srv.base, "POST", "/api/wx/refresh", { refreshToken: r1.body.refreshToken, device: "d1" });
      eq(r2.status, 200, "拿新 refreshToken 再刷一次也通（链路闭合）");

      const bad = await call(srv.base, "POST", "/api/wx/refresh", { refreshToken: "nope.nope", device: "d1" });
      eq(bad.status, 401, "乱编的 refreshToken 回 401（客户端据此清会话并重新登录）");

      /* 同一个 openid 再登录要认回同一个账号，否则换设备进度跟不过去 */
      const again = await call(srv.base, "POST", "/api/wx/login", { code: "C1", device: "d2" });
      eq(again.body.userId, login.body.userId, "同一个 openid 再登录认回同一个 uid");
      eq(again.status, 200, "第二个设备也能登进来");

      /* 微信侧的错误码要翻译成人话，不能都变成 500 */
      const badCode = await call(srv.base, "POST", "/api/wx/login", { code: "BAD", device: "d1" });
      eq(badCode.status, 401, "code 失效回 401（客户端据此重新 wx.login）");
      eq(badCode.body.code, "E_WX_CODE", "回的是 E_WX_CODE");

      const noCode = await call(srv.base, "POST", "/api/wx/login", { device: "d1" });
      eq(noCode.status, 400, "不带 code 回 400");
    } finally {
      await srv.close();
      env.restore();
    }
  }

  /* ---------- 三、device 这个字段：读不到不报错，所以只能在这儿钉 ---------- */
  {
    const env = boot({ WX_APPID: "wx_test", WX_SECRET: "sec_test" });
    fakeWx();
    const srv = await serve();
    try {
      await call(srv.base, "POST", "/api/wx/login", { code: "C9", device: "device-abc" });
      const store = require("../api/_lib/store.js").getStore(require("../api/_lib/config.js"));
      const rows = Object.values(store._db.sessions);
      const row = rows[rows.length - 1];
      eq(row.device, "device-abc", "会话行里落下 device（限流与「哪台机器」都靠它）");
      chk(!!row.refresh_token, "会话行里也放着 refreshToken —— 刷新那条路全靠它找回这一行");

      const src = fs.readFileSync(path.join(ROOT, "api/_routes/wx/login.js"), "utf8");
      chk(/body\.device \|\| body\.deviceId/.test(src),
        "登录路由读的是 `device`（写 `deviceId` 会静默拿不到 —— 两套报文在本仓库并存）");
      const src2 = fs.readFileSync(path.join(ROOT, "api/_routes/wx/refresh.js"), "utf8");
      chk(/body\.device \|\| body\.deviceId/.test(src2),
        "刷新路由**也**读 `device`（最容易漏的一处：登录带了、刷新忘了）");
    } finally {
      await srv.close();
      env.restore();
    }
  }

  /* ---------- 四、settings:v1 / profile:v1 的服务端白名单 ---------- */
  {
    const env = boot({ WX_APPID: "wx_test", WX_SECRET: "sec_test" });
    fakeWx();
    const srv = await serve();
    try {
      const login = await call(srv.base, "POST", "/api/wx/login", { code: "CS", device: "d1" });
      const bearer = { authorization: "Bearer " + login.body.accessToken };

      await call(srv.base, "POST", "/api/sync/push", {
        deviceId: "d1",
        recs: [
          { id: "settings:v1", updatedAt: 1000, payload: { v: 1, settings: { grade: 4, theme: "ink", dailyCount: 12, junk: "drop-me", sfx: true }, updatedAt: 1000 } },
          { id: "profile:v1", updatedAt: 1000, payload: { v: 1, avatar: "https://cdn.test/a.png", updatedAt: 1000 } }
        ]
      }, bearer);

      const back = await call(srv.base, "POST", "/api/sync/pull", { deviceId: "d1", since: 0 }, bearer);
      const byId = {};
      (back.body.recs || []).forEach(r => { byId[r.id] = r.payload; });

      chk(!!byId["settings:v1"], "settings:v1 能落库（不加白名单它会被清成 {}）");
      eq(byId["settings:v1"] && byId["settings:v1"].settings.grade, 4, "grade 留下来了");
      eq(byId["settings:v1"] && byId["settings:v1"].settings.dailyCount, 12, "dailyCount 留下来了");
      chk(byId["settings:v1"] && !("junk" in byId["settings:v1"].settings),
        "白名单之外的键被丢掉（服务端说了算，不照单全收）");
      chk(byId["settings:v1"] && !("sfx" in byId["settings:v1"].settings),
        "跟设备走的那几项不进云端（音效换台手机就不成立了）");

      chk(!!byId["profile:v1"], "profile:v1 能落库");
      eq(byId["profile:v1"] && byId["profile:v1"].avatar, "https://cdn.test/a.png", "头像地址留下来了");

      /* 白名单键表与小程序端 DEFAULTS 必须一一对应 —— 那边加一个键、这边不跟，
         症状就是「改了设置、换台手机还是默认」，而且不报错 */
      const core = require("../api/_lib/core.js");
      const mine = Object.keys(core.SETTINGS_KEYS || {});
      chk(mine.length > 0, "服务端有一张设置白名单键表（不用 Object.keys 照单全收）");

      /* 与小程序端 DEFAULTS 逐条对 —— 跨仓库，所以那边不在时跳过而不是假绿。
         **新增一个跨设备的设置键时，这一条会红**，那正是它存在的理由：
         漏加的症状是「改了设置、换台手机还是默认」，而且哪里都不报错。 */
      const miniStore = path.join(ROOT, "..", "poem-wechat-mini-program", "miniprogram", "utils", "store.js");
      if (!fs.existsSync(miniStore)) {
        console.log("（跳过与小程序端 DEFAULTS 的对照：兄弟仓库不在本地 —— 这条要在两仓都在的机器上跑）");
      } else {
        const m = /const DEFAULTS = \{([\s\S]*?)\n\};/.exec(fs.readFileSync(miniStore, "utf8"));
        const keys = [];
        let x;
        const re = /^\s*([A-Za-z][A-Za-z0-9]*)\s*:/gm;
        while (m && (x = re.exec(m[1]))) keys.push(x[1]);
        // lastSyncAt 是「上次同步到哪」的读数，不进报文（小程序端自己也这么标注）
        const missing = keys.filter(k => k !== "lastSyncAt" && mine.indexOf(k) < 0);
        eq(missing.length, 0, "小程序端每个跨设备的设置键都在服务端白名单里（实际缺 " + JSON.stringify(missing) + "）");
      }
    } finally {
      await srv.close();
      env.restore();
    }
  }

  console.log(fails === 0 ? "\n🎉 微信登录与 Bearer 会话测试全部通过" : "\n❌ " + fails + " 项失败");
  process.exit(fails ? 1 : 0);
}

main().catch(e => {
  console.error("测试自身抛异常（这通常是环境问题，不是被测代码）：", e);
  process.exit(1);
});
