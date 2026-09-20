"use strict";

// 旧形状库上的注册（Issue #225）
//
// 用户报的原话是「注册时显示 服务端出了点问题，稍后再试」—— 那是 E_INTERNAL（500），
// 兜底 catch 打出来的。他问「我需要配置什么吗」：**配置没错**。
// 错在这里：注册写账号那一发把 `email / email_verified_at / password_hash /
// password_salt` 一起塞给 PostgREST，而现网的表还停在 09-15 那张老形状
// （那四列是 09-16 第 6 节才 ALTER 上去的）—— 整发被上游按 400 / 42703 拒掉，
// 一个用户什么都没做错，却拿到一句「服务端出了点问题」。
//
// 这一层守四件事（全部用**真的 HTTP + 真的 PostgREST 形状**的假库，不 mock fetch）：
//   （写这层时踩过一个坑，记在这儿：假库判定「哪列缺」必须按**列名精确**匹配，
//     不能用子串 —— `email_hash` 里含 `email`，子串匹配会把「只拒一次」的库
//     误判成「一直拒」，于是测出来的结论是假的。）
//   ① 建号时 `email_mask` 一定带上 —— 老库那一列是 `not null`，留空就是首次注册必炸；
//   ② 缺迁移列时**降级**：把老库认得的那批列写进去，密码再单独补一发；
//   ③ 降级是事实，如实报（`storeDegraded` 点名哪几列没落库），不许静默假装写成功；
//   ④ 表是新的这一路，降级字段**一个都不许出现**（别修出个假告警，那比不修更坏）。

const http = require("http");
const path = require("path");

const ROOT = path.join(__dirname, "..");

let pass = 0, fail = 0;
function chk(ok, msg) {
  if (ok) { pass += 1; console.log("✓ " + msg); }
  else { fail += 1; console.log("✗ " + msg); }
}

function boot(envVars) {
  const keys = [
    "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SESSION_SECRET", "SESSION_KEY",
    "MAIL_TRANSPORT", "RESEND_API_KEY", "SITE_URL", "REQUIRE_EMAIL_VERIFIED",
    "TURNSTILE_ENABLED", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY", "TURNSTILE_BYPASS"
  ];
  const saved = {};
  keys.forEach(k => { saved[k] = process.env[k]; });
  keys.forEach(k => { delete process.env[k]; });
  Object.assign(process.env, { SESSION_SECRET: "test-secret-at-least-16-chars", MAIL_TRANSPORT: "console" }, envVars || {});
  Object.keys(require.cache).forEach(k => {
    if (k.startsWith(path.join(ROOT, "api"))) delete require.cache[k];
  });
  return { restore: () => { keys.forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); } };
}

// legacy = true 时：accounts 只有 09-15 那批老列；verifications / resets 两张表也不存在
function fakeSupabase(opts) {
  opts = opts || {};
  const legacy = opts.legacy === true;
  // 老表上真的没有这四列（第 6 节才加）
  const MIGRATED = ["email", "email_verified_at", "password_hash", "password_salt"];
  const TABLES = legacy ? ["accounts", "codes", "sessions", "progress"] : ["accounts", "codes", "sessions", "progress", "verifications", "resets"];
  const NEW_ONLY = ["verifications", "resets", "resets_marker"];

  const db = { accounts: {}, codes: {}, sessions: {}, progress: {}, verifications: {}, resets: {} };
  const calls = [];

  function rejectColumn(row, res) {
    const bad = MIGRATED.filter(c => Object.prototype.hasOwnProperty.call(row, c));
    if (!bad.length) return false;
    res.writeHead(400, { "Content-Type": "application/json" });
    // PostgREST 的真实形状：PGRST204 + 列名
    res.end(JSON.stringify({ code: "PGRST204", message: "Could not find the '" + bad[0] + "' column of 'accounts' in the schema cache" }));
    return true;
  }

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      const url = req.url.split("?")[0];
      const table = url.replace("/rest/v1/", "");
      calls.push({ method: req.method, table: table, body: body, query: req.url });

      if (req.headers.apikey !== "legacy-service-key") {
        res.writeHead(401, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ message: "Invalid API key" }));
      }
      if (NEW_ONLY.indexOf(table) >= 0 && legacy) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ code: "PGRST205", message: "Could not find the table 'public." + table + "' in the schema cache" }));
      }
      if (TABLES.indexOf(table) < 0) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ code: "PGRST205", message: "Could not find the table 'public." + table + "' in the schema cache" }));
      }

      if (table === "accounts" && (req.method === "POST" || req.method === "PATCH")) {
        const row = JSON.parse(body || "{}");
        if (legacy && rejectColumn(row, res)) return;
        if (req.method === "POST") {
          db.accounts[row.uid] = Object.assign({}, db.accounts[row.uid], row);
          res.writeHead(201, { "Content-Type": "application/json" });
          return res.end(JSON.stringify([row]));
        }
        // PATCH 也要真落库 —— 不然「密码摘要到底写没写进去」这条断言测的是假库，
        // 不是代码（假库不写、断言却绿，那是自欺）。
        const uid = decodeURIComponent((req.url.split("uid=eq.")[1] || "").split("&")[0]);
        if (db.accounts[uid]) db.accounts[uid] = Object.assign({}, db.accounts[uid], row);
        res.writeHead(204);
        return res.end();
      }
      if (req.method === "GET") {
        // 旧形状的库上，`select` 里那几个迁移列也不存在 —— 读同样被拒（42703）。
        // 这条不加，测出来的就不是用户那个库。
        if (legacy && table === "accounts") {
          // ⚠️ 按**列名精确**匹配，不是子串 —— 真的 PostgREST 也是按列名判的。
          // 用子串会把 `email_hash` / `email_mask` 也算成 `email`，于是「只拒一次」
          // 的库被误判成「一直拒」，测出来的结论是假的。
          const cols = decodeURIComponent((req.url.split("select=")[1] || "").split("&")[0]).split(",");
          const miss = MIGRATED.filter(c => cols.indexOf(c) >= 0)[0];
          if (miss) {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ code: "42703", message: "column accounts." + miss + " does not exist" }));
          }
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(Object.values(db[table] || {})));
      }
      if (req.method === "POST") {
        res.writeHead(201);
        return res.end("");
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("[]");
    });
  });

  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => resolve({
      db: db,
      calls: calls,
      url: "http://127.0.0.1:" + server.address().port,
      close: () => new Promise(r => server.close(r))
    }));
  });
}

function serve() {
  const entry = require("../api/handler.js");
  const server = http.createServer(entry);
  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => resolve({
      base: "http://127.0.0.1:" + server.address().port,
      close: () => new Promise(r => server.close(r))
    }));
  });
}

async function register(base, email) {
  const res = await fetch(base + "/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email, password: "legacy-db-123456", deviceId: "legacy-" + Date.now() })
  });
  return { status: res.status, body: await res.json() };
}

(async function () {
  console.log("=== 旧形状库上的注册（Issue #225）===");

  {
    const fake = await fakeSupabase({ legacy: true });
    const r = boot({ SUPABASE_URL: fake.url, SUPABASE_SERVICE_KEY: "legacy-service-key" });
    const s = await serve();
    const out = await register(s.base, "legacy" + Date.now() + "@example.com");

    chk(out.status === 202, "旧表上的注册不再 500 —— 用户不该为「库没迁」买单（实际 HTTP " + out.status + "）");
    chk(out.body.code !== "E_INTERNAL", "更不会回那句「服务端出了点问题，稍后再试」");

    const rows = Object.keys(fake.db.accounts).map(k => fake.db.accounts[k]);
    chk(rows.length === 1, "账号真的建出来了（" + rows.length + " 行）—— 不是「回了 202 但其实没落库」");
    const acc = rows[0];
    chk(!!acc && acc.email_mask === "legacy***@example.com" || /@example\.com$/.test(String(acc && acc.email_mask)),
      "建号那一发**带上了 email_mask**（" + (acc && acc.email_mask) + "）—— 老库这一列是 not null，留空就是首次注册必炸");
    chk(!!acc && typeof acc.email_hash === "string" && acc.email_hash.length === 64, "email_hash 照旧落库（登录查找靠它）");
    chk(!!acc && acc.status === "pending", "状态是 pending（等邮箱确认）");

    const posts = fake.calls.filter(c => c.table === "accounts" && c.method === "POST");
    const first = JSON.parse(posts[0].body);
    chk(!("password_hash" in first) && !("email" in first) && !("email_verified_at" in first),
      "首发的 POST 不带迁移列（老库整发拒收，所以一次只发它认得的那批）");

    chk(Array.isArray(out.body.storeDegraded) && out.body.storeDegraded.indexOf("password_hash") >= 0,
      "并且**如实报出降级**：点名哪几列没落库（" + JSON.stringify(out.body.storeDegraded) + "）");
    chk(/旧形状|schema\.sql/.test(String(out.body.note || "")), "提示里直接给出「重跑 schema.sql」这条出路");

    const dl = await fetch(s.base + "/api/diag");
    const rep = (await dl.json()).report;
    chk(rep.verdict === "db_no_table" || rep.verdict === "db_no_column",
      "自检也跟着如实说（verdict = " + rep.verdict + "），而不是报 ok");
    chk(rep.database.degraded === undefined || Array.isArray(rep.database.degraded),
      "自检报告里 degraded 是「本次请求内写不进去的列」，格式固定（" + JSON.stringify(rep.database.degraded) + "）");
    chk(rep.verdict === "db_no_column" || rep.verdict === "db_no_table",
      "旧形状的库自检**不许报 ok**（verdict = " + rep.verdict + "）");

    await s.close();
    fake.close();
    r.restore();
  }

  {
    const fake = await fakeSupabase({ legacy: false });
    const r = boot({ SUPABASE_URL: fake.url, SUPABASE_SERVICE_KEY: "legacy-service-key" });
    const s = await serve();
    const out = await register(s.base, "fresh" + Date.now() + "@example.com");

    chk(out.status === 202, "表是新的这一路照旧 202");
    chk(out.body.storeDegraded === undefined,
      "表是新的就**一个降级字段都不出现**（别修出个假告警，那比不修更坏）");
    chk(!/旧形状/.test(String(out.body.note || "")), "提示语里也没有「库是旧形状」这类假话");

    const rows = Object.keys(fake.db.accounts).map(k => fake.db.accounts[k]);
    chk(rows.length === 1 && typeof rows[0].password_hash === "string" && rows[0].password_hash.indexOf("scrypt$") === 0,
      "密码摘要照样落库（scrypt$…），降级逻辑没有顺手动坏新库这一路");
    chk(typeof rows[0].email_verified_at === "undefined" || rows[0].email_verified_at === null,
      "确认时刻还是空的（等用户点邮件）");
    const patches = fake.calls.filter(c => c.table === "accounts" && c.method === "POST");
    chk(patches.length === 2, "新库上也是「先写老列、再补迁移列」两发（不靠上游报错来分叉）：" + patches.length);

    await s.close();
    fake.close();
    r.restore();
  }

  {
    // 老库 + 连确认表都没有（09-15 那张库真实的样子）时，注册仍要给出**能用的一句话**，
    // 而不是 500。发不出确认信是事实，该由 verifySent / verifyReason 如实说。
    const fake = await fakeSupabase({ legacy: true });
    const r = boot({ SUPABASE_URL: fake.url, SUPABASE_SERVICE_KEY: "legacy-service-key" });
    const s = await serve();
    const out = await register(s.base, "nonewtable" + Date.now() + "@example.com");
    chk(out.status === 202, "verifications 表不存在时注册仍是 202（不把「没建表」变成「服务端坏了」）");
    chk(out.body.verifySent === false, "如实报「确认信没发出去」（verifySent = false）");
    await s.close();
    fake.close();
    r.restore();
  }

  console.log("");
  console.log(fail ? "❌ " + fail + " 项失败" : "✅ 全部通过（" + pass + " 项）");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
