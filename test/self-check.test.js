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
  const entry = require("../api/handler.js");
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

  /* 用户 2026-09-24（Issue #276 后续）：
       「自检页面只能已登录的管理员账号访问，其他情况一律**不显示**自检
         页面链接，且不能访问」

     两半都要守：入口（设置 · 关于 里那一行）与页面自己。
     ⚠️ 隐藏入口**不是**安全边界（README 那四条硬规矩）：`/api/diag` 仍
        公开（它按设计只回**形状**不回**值**，README §自助排查 里那句
        `curl -sS "$SITE_URL/api/diag"` 是给「页面打不开的人」留的出路）。
        所以这一层守的是「页面与入口」，不是「接口」。 */
  {
    const gate = fs.readFileSync(path.join(ROOT, "js/self-check-gate.js"), "utf8");
    const nav = fs.readFileSync(path.join(ROOT, "js/settings-nav.js"), "utf8");

    chk(/window\.Entitlement/.test(gate) && /E\.isOwner\(/.test(gate),
      "页面那道闸走 Entitlement.isOwner()（源头是服务端下发的 accounts.role）");
    chk(/E\.isOwner\(backing, id \? \{ role: id\.role, uid: id\.uid \} : undefined\)/.test(gate),
      "传参形状与 /admin/ 那一处逐字相同（两个地方各判一套迟早漂）");
    chk(/if \(allowed\(\)\) \{ arm\(\); return; \}/.test(gate) && /deny\(\);/.test(gate),
      "闸只有两支：放行（arm）与拒绝（deny），没有第三条模糊态");

    // 拒绝那一支必须**连脚本都不请求**：不然页面照样会打 /api/diag 与
    // /api/register 探针 —— 「不能访问」就只是「看不见」。
    chk(/type="text\/plain"[^>]*data-src="\/js\/self-check\.js"/.test(html),
      "自检脚本在 HTML 里是**占位**（type=text/plain 浏览器不执行）");
    chk(/document\.createElement\("script"\)/.test(gate) && /replaceChild\(s, holder\)/.test(gate),
      "只有放行时才把它换成真脚本 —— 拒绝那一支里那个文件一次都没被请求");
    chk(/page\.hidden = true/.test(gate) && /denyBox\.hidden = false/.test(gate) &&
      /selfcheck-deny/.test(html),
      "拒绝时把内容收走、把「只对管理员开放」那张卡放出来");

    chk(/ENTRY|isOwner|Entitlement/.test(nav) && /Entitlement\.isOwner|Ent\.isOwner/.test(nav),
      "入口那一道（设置 · 关于）与页面那一道同源，不另判一套");
    chk(/if \(!ok\) return "";/.test(nav),
      "不通过时那一行**返回空串**（不进 DOM，不是 hidden 也不是 CSS 遮住）");
  }

  // 「不能访问」的另一半：那把门后面的东西**不许先渲染出来**。
  // 页面默认 hidden 是关键 —— 否则判据还没跑完，逐条结论已经闪了一下，
  // 截图 / 读屏 / 缓存都可能把它留下。
  chk(/id="selfcheck-page" hidden>/.test(html),
    "内容那一块在 HTML 里就是 hidden（判据跑完之前谁都不许先看见）");
  chk(/id="selfcheck-steps"[\s\S]{0,120}?hidden/.test(html),
    "命令行判据那一段也是默认收着的（它同样只在管理员那里才展开）");

  // 页面引了 gate.js 与 entitlement.js，且**顺序**是「先判据、后脚本」。
  const gateIdx = html.indexOf("js/self-check-gate.js");
  const entIdx = html.indexOf("js/entitlement.js");
  chk(gateIdx > 0 && entIdx > 0 && entIdx < gateIdx,
    "/self-check/ 先引 entitlement.js 再引 self-check-gate.js（判角色要有那份答案）");

  chk(!/apikey/i.test(js) && !/Authorization/i.test(js) && !/eyJ|sb_[a-z]/i.test(js),
    "前端脚本里不发任何密钥头、也不认密钥形状（apikey / Authorization / JWT 前缀都不出现）");
  chk(/api\/diag/.test(js) && /api\/register/.test(js) && /api\/config/.test(js),
    "前端依次打 /api/diag、/api/config、/api/me、/api/register 四条");

  /* Issue #205 第三次：线上整站 /api/* 回**平台层** 404（函数没被调起来）。
     用户能自己看见的只有「报告里那四条全未过」，而它们**分不出**两种坏法：
       ① 函数压根不在这次部署里（平台层 404，纯文本）
       ② 函数在、但平台转进来的地址它不认（本站 E_404，JSON）
     所以自检多一条：按**平台转进来之后**的那个地址再打一发。 */
  chk(/api\/handler\?__path=config/.test(js),
    "自检多打一发 rewrite 之后的地址（/api/handler?__path=config）—— 它专测「函数认不认转进来的形状」");
  chk(/api2/.test(js), "并且那一条是独立的一行结论（不并进 /api/config 那条里，否则分不出是哪一环）");
  chk(/对不上/.test(js), "它的不通过文案直说「rewrite 的落点与路由表前缀对不上」");
  chk(/api\/handler\?__path=me/.test(html),
    "命令行判据里也备着这一发（页面打不开时照样能查）");

  // 用户 2026-09-18（Issue #229）：入口从「设置 · 通用」那颗按钮改成
  // 「设置 · 关于」里的一行链接（排在隐私条款下面）。口径没变 ——
  // 页面上仍得有一条去 /self-check/ 的路，否则用户打不开时根本不知道有这页。
  const nav = fs.readFileSync(path.join(ROOT, "js/settings-nav.js"), "utf8");
  chk(/link\("\/self-check\/",\s*"自检"\)/.test(nav) && /\/self-check\//.test(nav),
    "「设置 · 关于」里有去 /self-check/ 的一行链接「自检」");
  chk(nav.indexOf("隐私条款") < nav.indexOf("/self-check/"),
    "它排在隐私条款**下面一行**（用户点名的位置）");
  chk(!/btn-selfcheck/.test(nav), "入口不再是一颗按钮（用户 2026-09-18：按钮变成链接）");
  const general = fs.readFileSync(path.join(ROOT, "settings/general/index.html"), "utf8");
  chk(!/self-check/.test(general),
    "「设置 · 通用」里那一块整块撤干净（同一件事不在两处各说一遍）");
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
    let accountPresent = false;
    const fake = http.createServer((req, res) => {
      const table = req.url.split("?")[0];
      if (table === "/rest/v1/accounts" && req.method === "POST") accountPresent = true;
      if (table === "/rest/v1/progress" && req.method === "POST" && !accountPresent) {
        res.writeHead(409, { "Content-Type": "application/json" });
        return res.end('{"code":"23503"}');
      }
      if (table === "/rest/v1/accounts" && req.method === "DELETE") accountPresent = false;
      if (req.method === "POST" || req.method === "DELETE") { res.writeHead(204); return res.end(); }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(table === "/rest/v1/progress" && accountPresent ? '[{"uid":"diag"}]' : "[]");
    });
    await new Promise(r => fake.listen(0, "127.0.0.1", r));
    const r = boot({ SUPABASE_URL: "http://127.0.0.1:" + fake.address().port, SUPABASE_SERVICE_KEY: "sb_secret_fake" });
    const s = await serve();
    const d = await diagAt(s.base);
    chk(d.body.report.verdict === "ok" && d.body.report.database.write.verified === true,
      "写入探针先创建外键所需的账号，再检查进度行");
    chk(d.body.report.database.write.cleanup === true && !accountPresent,
      "写入探针删除临时账号及其级联进度");
    await s.close();
    fake.close();
    r.restore();
  }

  {
    const fake = http.createServer((req, res) => {
      const p = req.url.split("?")[0];
      if (req.headers.apikey !== "sb_secret_fake") {
        res.writeHead(401, { "Content-Type": "application/json" });
        return res.end('{"message":"Invalid API key"}');
      }
      if (p === "/rest/v1/accounts" && req.method === "GET") {
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

  /* 用户 2026-09-19（Issue #225）：在 Vercel 配了 TURNSTILE_ENABLED /
     TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY 三个变量，页面上却**看不见方框**。
     这一档恰恰没有判据：磁盘上三样都在，坏的是「那个 Site Key 对不对」
     「本站域名在那个 widget 的允许列表里吗」—— 只有真打一次 Cloudflare
     才知道。这里把四种坏法逐个跑出来，并守着「报告里不出现任何 key 值」。 */
  chk(/secretProbe/.test(fs.readFileSync(path.join(ROOT, "api/_routes/diag.js"), "utf8")),
    "/api/diag 会拿假 token 真打一次 Cloudflare 的 siteverify（只在配了 Secret Key 时）");

  {
    const r = boot(null, { TURNSTILE_ENABLED: "1" });
    const s = await serve();
    const d = await diagAt(s.base);
    const t = d.body.report.turnstile;
    chk(t.server === false && t.widget === "no_site_key",
      "只开开关、两个 key 都没填：如实报「前端不会渲染方框」（实际 " + t.widget + "）");
    chk(d.body.report.checks.some(c => /人机校验/.test(c.name) && c.ok === false),
      "而且自检里那一条明确是「未过」，不是「无」");
    chk(/两个 key 是一对/.test(t.note || ""),
      "note 直说两个 key 缺一个都跑不起来（这正是「配了三个变量却看不见方框」的一种）");
    await s.close();
    r.restore();
  }

  {
    // 假 Cloudflare：secret 不对 → invalid-input-secret
    const fake = http.createServer((req, res) => {
      let b = "";
      req.on("data", c => { b += c; });
      req.on("end", () => {
        const secret = new URLSearchParams(b).get("secret") || "";
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: false,
          "error-codes": secret === "good-secret" ? ["invalid-input-response"] : ["invalid-input-secret"]
        }));
      });
    });
    await new Promise(r => fake.listen(0, "127.0.0.1", r));
    const port = fake.address().port;

    // 把探测地址换成这台假 Cloudflare
    const diagPath = path.join(ROOT, "api/_routes/diag.js");
    const origSrc = fs.readFileSync(diagPath, "utf8");
    const patched = origSrc.replace(
      /var TURNSTILE_PROBE_URL = "[^"]+";/,
      'var TURNSTILE_PROBE_URL = "http://127.0.0.1:' + port + '/siteverify";'
    );
    chk(patched !== origSrc, "测试里能替掉探测地址（否则这一层只能空跑）");
    fs.writeFileSync(diagPath, patched);
    try {
      {
        const r = boot({ TURNSTILE_ENABLED: "1", TURNSTILE_SITE_KEY: "0xsite", TURNSTILE_SECRET_KEY: "wrong-secret" });
        const s = await serve();
        const d = await diagAt(s.base);
        const t = d.body.report.turnstile;
        chk(t.secretValid === false, "Secret Key 不对时如实报 secretValid=false");
        chk(t.secretProbe && t.secretProbe.codes.indexOf("invalid-input-secret") >= 0,
          "并把 Cloudflare 的原话（invalid-input-secret）带回来 —— 这是唯一的材料");
        chk(/弄混|无效/.test(t.note || ""),
          "note 点出最常见的那种：把 Site Key 与 Secret Key 弄混了");
        chk(t.widget === "renders" && t.server === true,
          "⚠️ 关键：**磁盘上三个变量都在**，widget 报 renders、server 报 true ——" +
          " 不看这一次真探测，完全分不出密钥是坏的");
        await s.close();
        r.restore();
      }
      {
        const r = boot({ TURNSTILE_ENABLED: "1", TURNSTILE_SITE_KEY: "0xsite", TURNSTILE_SECRET_KEY: "good-secret" });
        const s = await serve();
        const d = await diagAt(s.base);
        const t = d.body.report.turnstile;
        chk(t.secretValid === true, "Secret Key 有效时 secretValid=true（收到 invalid-input-response 才算有效）");
        await s.close();
        r.restore();
      }
      {
        const r = boot({ TURNSTILE_ENABLED: "1", TURNSTILE_SITE_KEY: "0xsite", TURNSTILE_SECRET_KEY: "good-secret" });
        const s = await serve();
        const d = await diagAt(s.base);
        const strings = JSON.stringify(d.body);
        chk(strings.indexOf("good-secret") < 0 && strings.indexOf("wrong-secret") < 0,
          "报告里不出现 Secret Key 的值（一个字都不许漏）");
        chk(strings.indexOf("0xsite") >= 0 || strings.indexOf("hasSiteKey") >= 0,
          "Site Key 只报「有没有」，不报值");
        await s.close();
        r.restore();
      }
      {
        const r = boot({ TURNSTILE_ENABLED: "1", TURNSTILE_SITE_KEY: "0xsite", TURNSTILE_SECRET_KEY: "good-secret", TURNSTILE_BYPASS: "1" });
        const s = await serve();
        const d = await diagAt(s.base);
        const t = d.body.report.turnstile;
        chk(t.widget === "bypassed" && /BYPASS/.test(t.note || ""),
          "TURNSTILE_BYPASS=1 被点名报出来（它刻意不随任何响应下发，只有自检能看见）");
        chk(d.body.report.checks.some(c => /人机校验/.test(c.name) && c.ok === null),
          "绕过那一档是「无」不是「未过」—— 不假装校验在跑");
        await s.close();
        r.restore();
      }
    } finally {
      fs.writeFileSync(diagPath, origSrc);
    }
    fake.close();
  }

  {
    const r = boot({});
    const s = await serve();
    const d = await diagAt(s.base);
    chk(d.body.report.turnstile.widget === "disabled",
      "没开人机校验就是 disabled（默认关，不是坏）");
    chk(d.body.report.turnstile.secretProbe === null,
      "没配 Secret Key 时不打 Cloudflare（不打没意义的请求）");
    await s.close();
    r.restore();
  }

  console.log("");
  console.log(fail ? "❌ " + fail + " 项失败" : "✅ 全部通过（" + pass + " 项）");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
