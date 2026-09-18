"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

let pass = 0, fail = 0;
function chk(ok, msg) {
  if (ok) { pass += 1; console.log("✓ " + msg); }
  else { fail += 1; console.log("✗ " + msg); }
}

function boot(envVars, afterSession) {
  const keys = [
    "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SESSION_SECRET", "SESSION_KEY",
    "MAIL_TRANSPORT", "RESEND_API_KEY", "SITE_URL", "SUPABASE_AVATAR_BUCKET",
    "TURNSTILE_ENABLED", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY", "TURNSTILE_BYPASS"
  ];
  const saved = {};
  keys.forEach(k => { saved[k] = process.env[k]; });
  keys.forEach(k => { delete process.env[k]; });
  Object.assign(process.env, { SESSION_SECRET: "test-secret-at-least-16-chars", MAIL_TRANSPORT: "console" }, envVars || {}, afterSession || {});
  Object.keys(require.cache).forEach(k => {
    if (k.startsWith(path.join(ROOT, "api"))) delete require.cache[k];
  });
  return { restore: () => { keys.forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); } };
}

function serve() {
  const entry = require("../api/index.js");
  const server = http.createServer(entry);
  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => resolve({
      base: "http://127.0.0.1:" + server.address().port,
      close: () => new Promise(r => server.close(r))
    }));
  });
}

async function diagAt(base) {
  const res = await fetch(base + "/api/diag");
  const body = await res.json();
  return { status: res.status, body };
}

(async function () {
  console.log("=== 自助排查（/api/diag 与 /self-check/）===");

  const html = fs.readFileSync(path.join(ROOT, "self-check/index.html"), "utf8");
  const js = fs.readFileSync(path.join(ROOT, "js/self-check.js"), "utf8");

  chk(/id="selfcheck-list"/.test(html) && /id="selfcheck-server"/.test(html),
    "/self-check/ 有逐条结论区与服务端自报区");
  chk(/id="btn-selfcheck-report"/.test(html) && /id="selfcheck-report"/.test(html),
    "/self-check/ 有「复制报告」按键与报告文本框");
  chk(/不显示、也不上报<\/strong>任何密钥/.test(html),
    "/self-check/ 页面自己写明不显示也不上报密钥");
  chk(/id="selfcheck-steps"[\s\S]*?api\.error/.test(html),
    "页面上备着命令行判据（含「搜 api.error」这一条），页面打不开时照样能查");
  chk(/js\/self-check\.js/.test(html), "/self-check/ 引了 js/self-check.js");

  chk(!/apikey/i.test(js) && !/Authorization/i.test(js) && !/eyJ|sb_[a-z]/i.test(js),
    "前端脚本里不发任何密钥头、也不认密钥形状（apikey / Authorization / JWT 前缀都不出现）");
  chk(/api\/diag/.test(js) && /api\/register/.test(js) && /api\/config/.test(js),
    "前端依次打 /api/diag、/api/config、/api/me、/api/register 四条");

  const general = fs.readFileSync(path.join(ROOT, "settings/general/index.html"), "utf8");
  chk(/href="\/self-check\/"/.test(general) && /id="btn-selfcheck"/.test(general),
    "「设置 · 通用」里有去 /self-check/ 的入口（打不开时也不知道有这个页面）");
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  chk(/\.\/self-check\//.test(sw) && /\.\/js\/self-check\.js/.test(sw),
    "sw.js 预缓存里收进了 /self-check/ 与它的脚本（离线也要能测）");

  chk(!/sw\.js[\s\S]{0,200}api\//.test(sw) || !/PRECACHE[\s\S]*?"\.\/api\//.test(sw),
    "sw.js 不缓存 /api/*（诊断结果更不能被缓存成旧结论）");

  {
    const r = boot(null, { SESSION_SECRET: "" });
    const s = await serve();
    const d = await diagAt(s.base);
    chk(d.body.report.session.ok === false && d.body.report.session.keyLength < 16,
      "缺会话密钥时如实报「未配」（长度 " + d.body.report.session.keyLength + "）");
    chk(d.body.report.verdict === "no_secret" && /SESSION_SECRET/.test(d.body.report.verdictText),
      "缺会话密钥时结论直指 SESSION_SECRET");
    await s.close();
    r.restore();
  }

  {
    const r = boot({});
    const s = await serve();
    const d = await diagAt(s.base);
    chk(d.status === 200 && d.body.report, "没配 SESSION_SECRET 时 /api/diag 仍回 200 + 报告（要能自报「缺什么」）");
    chk(d.body.report.database.mode === "memory", "没配库时如实报「内存存储」");
    await s.close();
    r.restore();
  }

  {
    const r = boot(null, { SESSION_SECRET: "" });
    const s = await serve();
    const d = await diagAt(s.base);
    chk(d.body.report.session.ok === false && d.body.report.session.keyLength < 16,
      "缺会话密钥时如实报「未配」（长度 " + d.body.report.session.keyLength + "）");
    chk(d.body.report.verdict === "no_secret" && /SESSION_SECRET/.test(d.body.report.verdictText),
      "缺会话密钥时结论直指 SESSION_SECRET");
    await s.close();
    r.restore();
  }

  {
    const r = boot({});
    const s = await serve();
    const d = await diagAt(s.base);
    chk(d.body.report.database.tables.length === 0,
      "没配库时不假装有六张表（tables 为空，不报假绿）");
    await s.close();
    r.restore();
  }

  const DEAD = "http://127.0.0.1:1";
  {
    const r = boot({ SUPABASE_URL: DEAD, SUPABASE_SERVICE_KEY: "sb_secret_test" });
    const s = await serve();
    const d = await diagAt(s.base);
    const rep = d.body.report;
    chk(rep.database.mode === "supabase", "配了库就按 supabase 走");
    chk(rep.database.connect && rep.database.connect.httpStatus === 0,
      "连不上时 httpStatus 记 0（不是 200，也不是抛异常）");
    chk(rep.verdict === "db_unreachable", "结论是「连不上数据库」（实际 " + rep.verdict + "）");
    chk(/连不上/.test(rep.verdictText), "结论文字直说连不上");
    chk(rep.database.tables.every(t => t.httpStatus === 0), "六张表逐张都记下「连不上」");
    chk(rep.database.write && rep.database.write.ok === false, "写入实跑也如实记失败");
    await s.close();
    r.restore();
  }

  {
    const r = boot({ SITE_URL: "https://elsewhere.test" });
    const s = await serve();
    const d = await diagAt(s.base);
    chk(d.body.report.site.match === false,
      "访问域名与 SITE_URL 不一致时如实报不一致（邮件链接会指去别处）");
    await s.close();
    r.restore();
  }

  {
    const strings = JSON.stringify(await (async () => {
      const r = boot({ SUPABASE_URL: DEAD, SUPABASE_SERVICE_KEY: "sb_secret_super_long_value_should_never_leak" });
      const s = await serve();
      const d = await diagAt(s.base);
      await s.close();
      r.restore();
      return d.body;
    })());
    chk(strings.indexOf("sb_secret_super_long_value_should_never_leak") < 0,
      "报告里不出现 service key 的值（一个字都不许漏）");
    chk(strings.indexOf("test-secret-at-least-16-chars") < 0,
      "报告里不出现 SESSION_SECRET 的值");
  }

  {
    const r = boot({ SUPABASE_URL: "https://abcdefghijklmno.supabase.co", SUPABASE_SERVICE_KEY: "sb_publishable_xxx" });
    const s = await serve();
    const d = await diagAt(s.base);
    chk(typeof d.body.report.serviceKeyShape === "string" && d.body.report.serviceKeyShape.length > 0,
      "配了库就一定会自报 key 的形状（" + d.body.report.serviceKeyShape + "）");
    chk(d.body.report.database.connect.httpStatus === 0 || d.body.report.database.connect.httpStatus === 401,
      "key 被上游拒掉时，这个形状的 key 是连不上 / 401（实测 " + d.body.report.database.connect.httpStatus + "）");
    await s.close();
    r.restore();
  }

  {
    const fake = http.createServer((req, res) => {
      const p = req.url.split("?")[0];
      if (req.headers.apikey !== "sb_secret_fake") {
        res.writeHead(401, { "Content-Type": "application/json" });
        return res.end('{"message":"Invalid API key"}');
      }
      if (p === "/rest/v1/accounts") {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end('{"code":"42703","message":"column accounts.email_verified_at does not exist"}');
      }
      if (p === "/rest/v1/verifications") {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end('{"code":"PGRST205","message":"Could not find the table"}');
      }
      if (req.method === "POST") { res.writeHead(201); return res.end(""); }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("[]");
    });
    await new Promise(r => fake.listen(0, "127.0.0.1", r));
    const r = boot({ SUPABASE_URL: "http://127.0.0.1:" + fake.address().port, SUPABASE_SERVICE_KEY: "sb_secret_fake" });
    const s = await serve();
    const d = await diagAt(s.base);
    const rep = d.body.report;
    chk(rep.verdict === "db_no_column", "表在但缺列（HTTP 400 / 42703）时报「表是旧形状」（实际 " + rep.verdict + "）");
    chk(rep.database.columns && rep.database.columns.accounts.ok === false,
      "accounts 的列检查如实为「不通过」");
    chk(rep.database.tables.filter(t => t.httpStatus === 404).length === 1,
      "缺的那张表（verifications = 404）在逐张表里被点名");
    chk(rep.database.connect.httpStatus === 400 && /42703/.test(rep.database.connect.upstream || ""),
      "上游原话原样带回来（42703 column ... does not exist）—— 这是定死哪一列缺的唯一材料");
    chk(rep.database.write && rep.database.write.ok === true,
      "写入那次是能成的（表本身能写，缺的是列）—— 不把两件事混成一句");
    await s.close();
    fake.close();
    r.restore();
  }

  {
    const fake = http.createServer((req, res) => {
      if (String(req.headers.apikey || "").indexOf("service_role") < 0) {
        res.writeHead(401, { "Content-Type": "application/json" });
        return res.end('{"message":"Invalid API key"}');
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("[]");
    });
    await new Promise(r => fake.listen(0, "127.0.0.1", r));
    const r = boot({ SUPABASE_URL: "http://127.0.0.1:" + fake.address().port, SUPABASE_SERVICE_KEY: "anon-key-fake" });
    const s = await serve();
    const d = await diagAt(s.base);
    const rep = d.body.report;
    chk(rep.verdict === "db_bad_key", "key 不对（401）时报「密钥不对」（实际 " + rep.verdict + "）");
    chk(/service_role/.test(rep.serviceKeyShape) === false,
      "并顺手说出 key 的形状不是 service_role（" + rep.serviceKeyShape + "）");
    await s.close();
    fake.close();
    r.restore();
  }

  {
    const r = boot({});
    const s = await serve();
    const base = s.base;

    const storeMod = require("../api/_lib/store.js");
    const cfgMod = require("../api/_lib/config.js");
    const st = storeMod.getStore(cfgMod);
    const count = () => Object.keys(st._db.accounts).length;
    const before = count();

    const probe = await fetch(base + "/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "selfcheck-probe@invalid", password: "selfcheck-probe-1234", deviceId: "selfcheck" })
    });
    const pbody = await probe.json();
    chk(probe.status === 400, "自检那发探针回 400（不是 500）——「链路活」与「内部炸了」分得开（实际 " + probe.status + "）");
    chk(pbody.code === "E_EMAIL_FORMAT", "理由还是邮箱形状，而不是别的（实际 " + pbody.code + "）");
    chk(count() === before, "⚠️ 探针**一个字都没写**：账号数不变（" + before + " → " + count() + "）");
    chk(Object.keys(st._db.verifications).length === 0 && Object.keys(st._db.codes).length === 0,
      "也没留下 verifications / codes（那两样才是「注册」的真副作用）");

    const real = await fetch(base + "/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "probe-counter@" + Date.now() + "example.com", password: "counter-1234", deviceId: "x" })
    });
    chk(real.status === 202 && count() === before + 1,
      "对照组：同一发里换成**合法**邮箱就真会建号（" + real.status + "，" + before + " → " + count() + "）——" +
      " 所以探针才必须用不合法的形状");

    await s.close();
    r.restore();
  }

  {
    {
    const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
    chk(/storeDegraded/.test(readme) && /register-legacy-db\.test\.js/.test(readme),
      "README 里写明了「旧形状库的注册不再 500」这条，并指到守着它的那一层测试");
    chk(/degraded/.test(readme), "README 里也写了 diag 的 degraded 字段（哪几列没写进去）");
  }

  const jsSrc = fs.readFileSync(path.join(ROOT, "js/self-check.js"), "utf8");
    chk(/selfcheck-probe@invalid/.test(jsSrc),
      "探针那句写死在代码里是 @invalid（改一个字就会开始建号 —— 这条守着它）");
    chk(/只在服务端读|两个字都不写|一个字都没写|归一化那一步就退回/.test(jsSrc),
      "页面上如实说明了「这一发不写任何数据」");
  }

  console.log("");
  console.log(fail ? "❌ " + fail + " 项失败" : "✅ 全部通过（" + pass + " 项）");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
