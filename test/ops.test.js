/**
 * 开通自检与配置清单专项测试（Issue #132 · 2 期 2C）
 * ==========================================================================
 * 2A 接上了两根线、2B 把短信 channel 做成真能跑的代码。剩下的「让它真的能用」
 * 在本项目里是唯一**没有业务代码可写**的一步（配置 + 开通，docs §4.10 的 2D）。
 *
 * 2C 的产出就是把那一步做成**可执行**的：一份清单 + 一台自检。
 * 这一层守的就是那份清单与那台自检本身 —— 因为「没有代码可写」的地方
 * 恰恰是最容易分叉的地方（文档说缺 X、程序说缺 Y，谁也不报错）。
 *
 * 守住五件事：
 *   一、清单与判定**同源**：报告里说的每一条，都能在 config.js 里找到落点
 *   二、「必须 / 需要 / 可选」三档分得清：缺 SESSION_SECRET 与缺 SendGrid 密钥
 *       不是同一件事，混成一张表会让用户以为不配齐就用不了
 *   三、**只报缺、不报值**：输出里出现任何密钥的值都是事故（这段文字会被贴进 Issue）
 *   四、`.env.example` 由清单生成，且**不是手抄的**（手抄的必然与代码分叉）
 *   五、`/api/me` 如实自报开通状态（mail / db / sms），界面据此才配自称「服务器判定」
 *
 * 跑法：`node test/ops.test.js`（纯 Node，不联网、不装依赖）
 */
"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

let fails = 0;
const chk = (c, m) => { if (!c) { console.log("✗ " + m); fails++; } else console.log("✓ " + m); };
const eq = (a, b, m) => chk(a === b, m + "（实际 " + JSON.stringify(a) + "）");
const has = (s, sub, m) => chk(String(s).indexOf(sub) >= 0, m);

const ops = require(path.join(ROOT, "api/_lib/ops.js"));
const CONFIG = require(path.join(ROOT, "api/_lib/config.js"));

/** 造一份「配齐了」的 cfg：形状与 config.js 一致（含那两个判定函数） */
function fullCfg(over) {
  const cfg = Object.assign({
    supabaseUrl: "https://x.supabase.co",
    supabaseServiceKey: "svc",
    sessionSecret: "0123456789abcdef0123456789abcdef",
    mailTransport: "sendgrid",
    sendgridKey: "SG.x",
    smsEnabled: false,
    smsTransport: null
  }, over || {});
  cfg.hasDb = function () { return !!(this.supabaseUrl && this.supabaseServiceKey); };
  cfg.hasSession = function () { return !!this.sessionSecret && this.sessionSecret.length >= 16; };
  cfg.mail = function () {
    if (this.mailTransport) return this.mailTransport;
    if (this.sendgridKey) return "sendgrid";
    if (this.resendKey) return "resend";
    return "console";
  };
  return cfg;
}

console.log("=== 一、清单与判定同源：ENRTY 里每一项都真的被 config 读 ===");
{
  const src = read("api/_lib/config.js");
  ops.ENTRY.forEach(e => {
    has(src, e.key, "清单里的 " + e.key + " 在 config.js 里真的被读（不是写在文档里的话）");
  });
  /* 反向：config.js 里读的每一个 env 名字，清单里都该有 —— 漏一个的后果是
     「程序读了、文档没写」，用户照文档配完发现还是不对。 */
  const readKeys = [...src.matchAll(/env\(\s*"([A-Z_]+)"/g)].map(m => m[1]);
  const listed = ops.ENTRY.map(e => e.key);
  const unlisted = [...new Set(readKeys)].filter(k => listed.indexOf(k) < 0);
  eq(unlisted.length, 0, "config.js 读的每个变量都在清单里（未列出的：" + unlisted.join(",") + "）");
}

console.log("\n=== 二、三档分得清：必须 / 这一件需要 / 可选 ===");
{
  const byKey = {};
  ops.ENTRY.forEach(e => { byKey[e.key] = e; });
  eq(byKey.SESSION_SECRET.level, "required", "SESSION_SECRET 是「必须」（缺了接口整体 503）");
  eq(byKey.SENDGRID_API_KEY.level, "needed", "SendGrid 密钥是「这一件需要」（缺了只是发不出真信）");
  eq(byKey.MAIL_FROM_NAME.level, "optional", "发信人显示名是「可选」");
  ops.ENTRY.forEach(e => {
    chk(["required", "needed", "optional"].indexOf(e.level) >= 0, e.key + " 的档位是三种之一");
    chk(!!e.what && !!e.missing && !!e.how, e.key + " 三句话都写全了（是什么 / 缺了怎样 / 怎么补）");
    chk(e.secret === true || e.secret === false, e.key + " 明确标了是不是密钥");
  });
}

console.log("\n=== 三、出厂（一个都不配）：如实说「还没到最低线」，且不吓唬人 ===");
{
  const bare = fullCfg({ supabaseUrl: null, supabaseServiceKey: null, sessionSecret: null, mailTransport: null, sendgridKey: null });
  const r = ops.check(bare);
  eq(r.ok, false, "没配 SESSION_SECRET / 库 → ok:false");
  eq(r.hasSession, false, "hasSession 如实为false");
  eq(r.mail, "console", "发信通道如实是 console");
  eq(r.missing.length, ops.ENTRY.length, "一个都没配时，缺的项就是全部项");
  eq(r.blocking.length, 3, "其中「必须」的三项被单独挑出来（SESSION_SECRET + Supabase 那一对）");
  const txt = ops.report(bare);
  has(txt, "本站仍可完全离线使用", "报告里写清「没配也照样能离线用」（不把「未配置」说成「坏掉」）");
  has(txt, "收不到", "console 模式如实说「真实用户收不到信」");
}

console.log("\n=== 四、配齐之后：ok 为真，且三档状态各自如实 ===");
{
  const r = ops.check(fullCfg());
  eq(r.ok, true, "会话可签 + 有库 → ok:true");
  eq(r.mail, "sendgrid", "通道如实是 sendgrid");
  chk(r.smsReady === false, "没开短信时 smsReady 是 false（**不假装**）");
  /* 只开开关不接商 —— 2B 定死的口径，这里再钉一遍 */
  const half = ops.check(fullCfg({ smsEnabled: true, smsTransport: null }));
  chk(half.smsReady === false, "SMS_ENABLED=1 但没接商 → 仍然不是「能发」");
  chk(half.notes.some(n => /503/.test(n)), "并在提醒里说清「请求仍是 503」（不说成配置生效）");
  /* 接了个没实现的商 */
  const fake = ops.check(fullCfg({ smsEnabled: true, smsTransport: "acme" }));
  chk(fake.smsReady === true, "指了商名就算「已接」");
  chk(fake.notes.some(n => /E_SMS_FAIL/.test(n)), "但提醒要人去核对那个商真的实现了（否则投递会 E_SMS_FAIL）");
}

console.log("\n=== 五、**只报缺、不报值**：任何密钥的值都不许出现在输出里 ===");
{
  const cfg = fullCfg({ sendgridKey: "SG.SUPER_SECRET_KEY", supabaseServiceKey: "SUPER_SECRET_SVC", sessionSecret: "SUPER_SECRET_SESSION_abcdef" });
  const txt = ops.report(cfg) + JSON.stringify(ops.check(cfg));
  ["SUPER_SECRET_KEY", "SUPER_SECRET_SVC", "SUPER_SECRET_SESSION_abcdef"].forEach(v => {
    chk(txt.indexOf(v) < 0, "输出里没有出现 " + v.slice(0, 12) + "… 的值");
  });
  const json = JSON.stringify(ops.check(cfg));
  chk(json.indexOf("SUPER_SECRET") < 0, "连 --json 的形状里也没有值（只有 key 与档位）");
  /* 密钥项连长度都不报：长度是密钥信息的一半 */
  chk(!/长度|len\b/i.test(ops.report(cfg)), "报告里不报密钥长度");
}

console.log("\n=== 六、`.env.example` 由清单生成，且与清单一致 ===");
{
  const ex = ops.envExample();
  ops.ENTRY.forEach(e => {
    has(ex, "\n" + e.key + "=", ".env.example 里有 " + e.key + "=（空值，等用户填）");
  });
  chk(ex.indexOf("不要手改") >= 0, "生成物里标明「由脚本生成、不要手改」");
  chk(/三档|必须/.test(ex), "生成物按三档分组");
  /* 生成物与脚本输出**逐字一致** —— 不一致说明有人手改了模板文件 */
  const gen = read("scripts/env-example.js");
  chk(/ops\.envExample\(\)/.test(gen), "生成脚本取的是同一份清单（不是自己又写一遍）");
  /* 落盘的 .env.example 必须与此刻的清单一致 */
  const onDisk = read(".env.example");
  chk(onDisk === ex, "仓库里的 .env.example 与清单此刻逐字一致（改了清单要重跑生成）"
    + (onDisk === ex ? "" : "\n  实际落盘 " + onDisk.length + " 字符 / 清单 " + ex.length + " 字符"));
  chk(read(".gitignore").indexOf(".env") >= 0 && !/^\.env\.example/m.test(read(".gitignore")),
    ".gitignore 挡着真值 .env，但**没有**挡掉要提交的 .env.example");
}

console.log("\n=== 七、自检脚本：能跑、能出 JSON、退出码如实 ===");
{
  const { execFileSync } = require("child_process");
  const OPS_KEYS = ops.ENTRY.map(e => e.key);
  /** 造一份「只留下与配置无关的变量」的环境：这才是「出厂」那一档。
      ⚠️ 不能直接用 `env -i`（连 PATH 都没了，node 都找不到），
         也不能继承当前 CI 环境（CNB 的变量里可能有同名项）。 */
  const bareEnv = () => {
    const e = Object.assign({}, process.env);
    OPS_KEYS.forEach(k => { delete e[k]; });
    return e;
  };
  const run = (args, env) => {
    try {
      return { out: execFileSync("node", [path.join(ROOT, "scripts/doctor.js")].concat(args), { encoding: "utf8", env: env || bareEnv() }), code: 0 };
    } catch (e) { return { out: String(e.stdout || ""), code: e.status }; }
  };
  const bare = run([]);
  eq(bare.code, 1, "什么都没配时退出码是 1（脚本能被 CI 当门用）");
  has(bare.out, "SESSION_SECRET", "告诉人第一件要补的是什么");
  const j = JSON.parse(run(["--json"]).out);
  eq(j.ok, false, "--json 的 ok 如实为 false");
  eq(j.blocking.length, 3, "--json 里 blocking 就是那三项必须的");
  chk(JSON.stringify(j).indexOf("SUPER") < 0, "--json 里没有值");
  const ex = run(["--example"]).out;
  has(ex, "SESSION_SECRET=", "--example 打出可直接粘贴的模板");

  /* 配齐的那一档：退出码翻成 0 */
  const env = {
    SESSION_SECRET: "0123456789abcdef0123456789abcdef",
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_KEY: "svc"
  };
  const fullEnv = Object.assign(bareEnv(), env);
  const full = run([], fullEnv);
  eq(full.code, 0, "配齐「必须」两项之后退出码是 0");
  has(full.out, "最低线已过", "并明说「能真跑」");
}

console.log("\n=== 七之二、2D 的五个步骤（配置与真开通，docs §4.12） ===");
{
  /* 这一节守的是**「怎么补」那一段本身**：它与清单同源（都在 ops.js 里），
     所以这里断言的是「五步都在、每步都能落地」——
     而不是「文档里写了没写」（那一条由另一条断言守着：
     文档若与命令分叉，就是本节要拦的下一件事故）。 */
  chk(Array.isArray(ops.STEPS) && ops.STEPS.length === 5, "五步齐备（实际 " + (ops.STEPS || []).length + "）");
  const ids = ops.STEPS.map(s2 => s2.id).join("");
  eq(ids, "ABCDE", "五步的编号是 A~E，顺序稳定（顺序错了会把「可选」的一步排在「必须」前面）");
  ops.STEPS.forEach(st => {
    chk(!!st.title && !!st.where && !!st.why && !!st.check,
      "第 " + st.id + " 步四句话都写全了（叫什么 / 在哪配 / 为什么 / 判据）");
    chk(st.how && st.how.length > 0, "第 " + st.id + " 步给了可照做的动作");
    chk(["required", "needed", "optional"].indexOf(st.level) >= 0,
      "第 " + st.id + " 步的档位是三种之一（复用清单那三档，不另立一套）");
  });

  const A2 = ops.STEPS[0], B2 = ops.STEPS[1], C2 = ops.STEPS[2], D2 = ops.STEPS[3], E2 = ops.STEPS[4];
  has(A2.how.join(" "), "openssl rand -hex 32", "A 步给的是可照抄的命令，不是「生成一个随机串」");
  has(A2.how.join(" "), "SESSION_SECRET", "A 步说清这一串填到哪个变量里");
  has(B2.how.join(" "), "api/_lib/schema.sql", "B 步的建表指向仓库里那份真 schema（不另抄一份 SQL）");
  has(B2.how.join(" "), "service_role", "B 步明说用 service_role");
  has(B2.how.join(" "), "不是 anon", "并且**明确排除** anon（配错这一项的症状是「读不到一行数据」）");
  has(C2.how.join(" "), "SPF", "C 步含 SPF");
  has(C2.how.join(" "), "DKIM", "C 步含 DKIM");
  has(C2.how.join(" "), "DMARC", "C 步含 DMARC（只有 SPF+DKIM 仍会被 QQ/163 拒收）");
  has(C2.why, "console", "C 步说清不配的下场是 console 通道（真实用户收不到信）");
  /* D 步：探活与备份。三条最容易做错的地方都要在文字里 */
  has(D2.how.join(" "), "密钥仓库", "D 步说清密钥放密钥仓库（不是 env 里手填）");
  has(D2.how.join(" "), ".cnb.yml", "D 步指向本仓库的 .cnb.yml");
  has(D2.why, "7 天", "D 步说清免费档的暂停判定（连续 7 天没请求）");
  has(D2.how.join(" "), "每 5 天", "探活排每 5 天，并给出理由（留 2 天缓冲）");
  has(D2.how.join(" "), "pg_dump", "备份走 pg_dump");
  has(D2.how.join(" "), "打到数据库", "探活必须打到数据库（根路径与状态页不算活动）");

  /* E 步：四条验收判据，每一条都必须是「一个明确数字/布尔」，不许是「应该没问题」 */
  const ev = E2.how.join(" ");
  has(ev, "/api/me", "E 步验会话（/api/me）");
  has(ev, "401", "并给出期望值 401");
  has(ev, "503", "并给出反面：503 就是 SESSION_SECRET 没生效（两种状态不许合并成「失败」）");
  has(ev, "delivered:true", "E 步验真发信，判据是 delivered:true");
  has(ev, "DELETE", "E 步验注销接口可达");
  /* ⚠️ 这句话本身就是那条规矩的**声明**（「不做『应该没问题』这类判断」），
     所以先把它抠掉再扫 —— 拿裸词去扫必然误判，与账户页那条
     「btn-resend 不是 Resend」是同一类坑。 */
  const stepsText = ops.stepsReport(fullCfg()).replace(/不做「应该没问题」这类判断/g, "");
  chk(!/应该|大概|基本/.test(stepsText),
    "整份步骤文字里不出现「应该 / 大概 / 基本」这类判断（只回答事实）");

  /* C6 与 E 的验收命令**同源**：不是两份，是同一份 —— 两边逐字一致 */
  const dbCmd = ops.STEPS[1].check;
  chk(dbCmd.indexOf("rest/v1/accounts") >= 0, "B 步的判据里带着那条真命令");
  chk(ev.indexOf("rest/v1/accounts") >= 0, "E 步的验收里也带着同一条");
  chk(ops.stepsReport(fullCfg()).indexOf("rest/v1/accounts") >= 0, "渲染出来看得见它");

  /* ⚠️ 与清单同一条纪律：步骤文字里也不许出现任何密钥的值 */
  const txt2 = ops.stepsReport(fullCfg({ sendgridKey: "SG.STEP_SECRET", supabaseServiceKey: "STEP_SECRET_SVC" }));
  chk(txt2.indexOf("STEP_SECRET") < 0, "步骤文字里没有出现任何密钥的值");
  chk(txt2.indexOf("http_code") >= 0, "但命令本身要看得见（占位是 $VAR，由用户自己的 shell 展开）");
  chk(txt2.indexOf("-o /dev/null") >= 0, "验收命令把响应体丢掉（响应里可能有账号数据，不该进终端日志）");

  /* --steps 的出口：能跑、能自报、退出码与 --check 一致 */
  const { execFileSync } = require("child_process");
  const OPS_KEYS2 = ops.ENTRY.map(e => e.key);
  const bareEnv2 = () => {
    const e = Object.assign({}, process.env);
    OPS_KEYS2.forEach(k => { delete e[k]; });
    return e;
  };
  const run2 = (args, env) => {
    try {
      return { out: execFileSync("node", [path.join(ROOT, "scripts/doctor.js")].concat(args), { encoding: "utf8", env: env || bareEnv2() }), code: 0 };
    } catch (e) { return { out: String(e.stdout || ""), code: e.status }; }
  };
  const steps = run2(["--steps"]);
  eq(steps.code, 0, "--steps 只是打印步骤，始终退 0（它不体检）");
  ["A", "B", "C", "D", "E"].forEach(x => has(steps.out, "第 " + x + " 步", "--steps 打出第 " + x + " 步"));
  has(steps.out, "未过", "--steps 会如实报「现在到哪一步了」");
  /* D 步说的两条定时任务，必须**真的在 .cnb.yml 里**（说了不做就是空话） */
  const cnb = read(".cnb.yml");
  has(cnb, "crontab: 0 3 */5 * *", "D 步说的探活真的写进了 .cnb.yml（每 5 天）");
  has(cnb, "crontab: 30 4 * * 1", "D 步说的备份也写了（每周一次）");
  has(cnb, "supabase-keepalive", "探活流水线有名字");
  has(cnb, "supabase-backup", "备份流水线有名字");
  has(cnb, "rest/v1/accounts", "探活打的是真查询（PostgREST），不是根路径");
  has(cnb, "test \"$CODE\" = \"200\"", "探活失败会红（不静默通过）");
  has(cnb, "secret", "密钥走密钥仓库的 imports，不手填在 env 里");
  chk(cnb.indexOf("SUPABASE_SERVICE_KEY=") < 0, ".cnb.yml 里没有把密钥值写死（只有引用）");

  /* ⚠️ 探活的 apikey 头必须是**密钥**，不是 URL（2026-09-17 修的真 bug）
     ----------------------------------------------------------------------
     原先写的是 `-H "apikey: $SUPABASE_URL"`：把一个 URL 当 key 发出去，
     Supabase 一律回 401 —— 而症状看起来像「密钥仓库没配好」，于是会被
     反复去查密钥仓库。这条断言把「apikey 后面跟的不是 URL」钉死，
     并把那条命令在三处（.cnb.yml / ops.STEPS / 文档）都对一遍。 */
  /* ⚠️ 先把注释行抠掉再扫 —— 那条错误的写法会出现在解释它的注释里，
     拿裸串去扫必然误判（与账户页那条「btn-resend 不是 Resend」同一类坑）。 */
  const cnbCode = cnb.split("\n").filter(l => !/^\s*#/.test(l)).join("\n");
  chk(cnbCode.indexOf('apikey: $SUPABASE_URL') < 0,
    ".cnb.yml 的 apikey 头不是 SUPABASE_URL（那是 URL，不是 key —— 会回 401）");
  has(cnbCode, "apikey: $SUPABASE_SERVICE_KEY", ".cnb.yml 的 apikey 头用的是 service key");
  /* 同一个 key 两个头都要带：apikey 给的是 key，Authorization 给的是 token */
  has(cnb, "Authorization: Bearer $SUPABASE_SERVICE_KEY", "Authorization 那一头也带着同一个 key");
  const vdb = ops.STEPS[4].how.join("\n") + "\n" + ops.STEPS[1].check;
  chk(vdb.indexOf("apikey: $SUPABASE_URL") < 0,
    "ops.js 里那条验收命令（B 的判据 / E 的第①条）同样不是 SUPABASE_URL");
  has(vdb, "apikey: $SUPABASE_SERVICE_KEY", "ops.js 里那条命令用的是 service key");

  /* ⚠️ 备份要的第三个值 SUPABASE_DB_URL：**控制台复制不到**，
     得去 Connection string 取模板再替换 [YOUR-PASSWORD]。这一步不写出来，
     下一个人只会拿到一个含占位符的串，然后看着
     「could not translate host name」以为 DNS 坏了。 */
  const stepD = ops.STEPS[3].how.join("\n");
  has(stepD, "SUPABASE_DB_URL", "D 步写明了备份还要第三个值");
  has(stepD, "[YOUR-PASSWORD]", "D 步写明了那个占位符要整体替换掉");
  has(stepD, "Connection string", "D 步指明了去哪里取模板");
  has(stepD, "%40", "D 步写明密码里的特殊字符要百分号编码");
  has(cnb, "SUPABASE_DB_URL:?", ".cnb.yml 的备份真的校验这个变量注入没注入");

  /* ⚠️ 备份镜像的大版本必须跟得上服务端（2026-09-16 修的第二处真 bug）
     ----------------------------------------------------------------------
     用户在 Issue #159 报了第三条红：`pg_dump` 连 Supabase（PostgreSQL **17.6**）
     时以 `aborting because of server version mismatch` 退出，而流水线用的是
     `postgres:16` —— 里面的 pg_dump 是 16.15。pg_dump **不改**连比自己新的
     服务端（反方向才行），所以它在真正读到数据之前就会退出。

     这条和新版探活那条 401 是**同一形状**的坑：症状都像「密钥 / 连接串配错了」
     （用户当时正是把密码换成 Session pooler 串之后再试的），于是下一轮排查会
     反过来怀疑连接串 —— 而真正的病根是**客户端比服务端老一个大版本**。

     判据落在「.cnb.yml 里的备份镜像声明了与服务端同大版本」上 ——
     不写死 17 这个数字的反面（写「不是 16」会过期），只钉住它**声明的版本**
     与 D 步文字里写的那一个大版本**是同一个**。 */
  /* ⚠️ 先按新版探活那条的老规矩**抠掉注释行**再扫：镜像名在解释它的注释里
     也会出现一次，拿裸串去数必然数出两份 —— 那是测试自己读数错，不是重复声明。 */
  const cnbPinned = (cnbCode.match(/image:\s*postgres:\d+/g) || []);
  chk(cnbPinned.length === 1,
    "备份那条流水线的镜像**只声明一次**（出现 " + cnbPinned.length + " 次；多一处就是下次只改一处）");
  chk(cnbPinned.length === 1 && cnbPinned[0].indexOf("postgres:17") >= 0,
    "备份镜像是 postgres:17（Supabase 现在是 17；用 16 会在读数据之前就以 version mismatch 退出）");
  chk(!/image:\s*postgres:16\b/.test(cnbCode),
    "备份镜像不再是 postgres:16（pg_dump 不改连比自己新的服务端）");
  has(cnb, "server version mismatch", ".cnb.yml 里写明了这条报错原文（下次有人报同样的红，一眼能对上）");
  has(stepD, "version mismatch", "D 步也写了这条坑（说了不做 = 下一个人还会踩）");
  has(stepD, "postgres:17", "D 步给出的是可照抄的镜像名，不是「选个匹配的版本」");

  /* ⚠️ Issue #159：备份报 could not translate host name，别一律当成「密码没编码」
     ----------------------------------------------------------------------------
     报错里引号内那串主机名是**判据**：
       · 带 `…@` / 密码尾巴  → 密码没百分号编码（改密钥仓库里的值）
       · 干净的 db.<ref>.…    → URL 已经解析成功，是这个名字解析不到（DNS / IPv6）
     两者只差几个字符，方向完全相反。所以备份脚本现在**先把 URL 形状判掉**，
     不让那句会被误读的报错发出来。 */
  has(stepD, "%3A", "D 步写明了其余保留字符怎么编码（: → %3A）");
  has(stepD, "只许出现一次", "D 步给出了「@ 只许出现一次」这条可自检的判据");
  has(stepD, "pooler.supabase.com", "D 步给出了解析不到直连主机名时的替代串（Session pooler）");
  has(stepD, "6543", "D 步写明 Transaction pooler 那个端口不要给 pg_dump 用");

  has(cnbCode, "could not translate host name", "备份脚本自己会把那句误读的报错讲清楚");
  has(cnbCode, "DB_HOST=", "备份脚本真的从 URL 里拆出主机段来自检");
  chk(/case "\$DB_HOST" in[\s\S]{0,200}\*@\*/.test(cnbCode),
    "备份脚本判的是「主机段里还有 @」= 密码没编码");
  chk(cnbCode.indexOf("postgres://*|postgresql://*") >= 0,
    "备份脚本先要求整串是 postgres:// / postgresql:// 开头");
  chk(cnb.indexOf("SUPABASE_DB_URL=") < 0, ".cnb.yml 里没有把 DB URL 的值写死");

  const stepsCheck = run2(["--steps", "--check"]);
  eq(stepsCheck.code, 1, "--steps --check 没配齐时退出码 1（与 --check 同一条判据）");
  const fullEnv2 = Object.assign(bareEnv2(), {
    SESSION_SECRET: "0123456789abcdef0123456789abcdef",
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_KEY: "svc"
  });
  eq(run2(["--steps", "--check"], fullEnv2).code, 0, "配齐后 --steps --check 退出码翻成 0");
}

console.log("\n=== 八、/api/me 如实自报开通状态（界面才配自称「服务器判定」） ===");
{
  const core = require(path.join(ROOT, "api/_lib/core.js"));
  const cfg = fullCfg({ mailTransport: null, sendgridKey: null });
  const acc = { uid: "u_1", plan: "free", email_mask: "a***@b.com", nickname: "" };
  const pub = core.publicAccount(cfg, acc);
  chk(pub.channel && typeof pub.channel === "object", "publicAccount 下发 channel（开通状态）");
  eq(pub.channel.mail, "console", "mail 如实是 console");
  eq(pub.channel.delivered, false, "console 时 delivered 如实 false（不假装发出去了）");
  eq(pub.channel.db, "db", "有库时 db 如实是 db");
  eq(pub.channel.sms, false, "短信没开通时 sms 如实 false");
  const mem = core.channelFacts(fullCfg({ supabaseUrl: null, supabaseServiceKey: null }));
  eq(mem.db, "memory", "没配库时 db 如实是 memory（不是 db）");
  /* 派生口径必须问 config 自己的函数，不许在这里重算一份 */
  const src = read("api/_lib/core.js");
  const fn = src.slice(src.indexOf("function channelFacts"), src.indexOf("function featuresFor"));
  has(fn, "cfg.mail()", "channelFacts 走 cfg.mail()（单一判定处）");
  has(fn, "cfg.hasDb()", "channelFacts 走 cfg.hasDb()");
}

console.log("\n=== 十、3 期那三件：口径写清了，而且**不许偷偷接 AI / 收钱** ===");
{
  /* 用户 2026-09-17 在 Issue #159 里定下的层级口径：
     飞花令与试题模拟（原名「现场考试」）归 Max、题库复习归 Pro。
     设计落在 docs/architecture.md §4.15（先落设计），实现落在 §5.0.1（后落代码）。

     ⚠️ 这一节原先守的是「**不许提前开工**」（当时只有设计、没有代码）。
        代码落地之后那条刹车已经**不成立了** —— 现在守的是它真正想守的几件事：
        ① 文档里的层级口径与**内核表**一致（口径与代码不许各说各话）；
        ② 三件**一行 AI 都不接**、**一分钱都不收**（charge 默认关着）；
        ③ 界面**不假装**（不写「即将上线」，也不假装扣费）。
     把「已经做完」硬当成「不许做」来断言，只会让下一个人把真话改成假话。 */
  const arch = read("docs/architecture.md");
  const readme = read("README.md");

  chk(/### 4\.15 3 期「不花钱的那三件」设计方案/.test(arch),
    "docs/architecture.md 有 §4.15（三件的设计方案）");
  chk(/### 5\.0\.1 三件不花钱的：\*\*设计已定（§4\.15），并且已落地\*\*/.test(arch),
    "docs/architecture.md 有 §5.0.1（落地记录）");
  const sec = arch.slice(arch.indexOf("### 4.15"), arch.indexOf("## 5. 排期与顺序"));

  ["飞花令", "题库", "现场考试"].forEach(k => has(sec, k, "§4.15 里写到了「" + k + "」"));
  chk(/飞花令[\s\S]{0,200}Max/.test(sec), "飞花令归 Max（用户口径）");
  chk(/现场考试[\s\S]{0,200}Max/.test(sec), "现场考试（今名「试题模拟」）归 Max（同上）");
  chk(/题库[\s\S]{0,160}Pro/.test(sec), "题库复习归 Pro（同上）");

  /* 文档里那两条「不」：不接 AI 商、不建额度表 */
  has(sec, "不接任何 AI 商", "§4.15 写明不接 AI 商");
  has(sec, "纯逻辑", "§4.15 写明判据是纯逻辑（含不含字 / 在不在库 / 说没说过）");
  has(sec, "检索", "§4.15 写明先做纯检索版（AI 对句降为可选的一层）");

  /* README 与文档同一口径（两处漂移 = 下一个人读哪份都错） */
  has(readme, "现场考试和飞花令归 max 所有，题库归 pro", "README 引用了用户的原话（层级口径）");
  has(readme, "§4.15", "README 指向 §4.15");

  /* ① 文档里的层级口径与**内核表**一致 —— 这两处各说各话正是本轮修掉的那个坑 */
  const E = require(path.join(ROOT, "js/entitlement.js"));
  const ctx = t => ({ tier: t, signedIn: true });
  chk(!E.can("feihualing", ctx("pro")).ok && E.can("feihualing", ctx("max")).ok,
    "内核表：飞花令 pro 不可、max 可（与 §4.15 一致）");
  chk(!E.can("exam.paper", ctx("pro")).ok && E.can("exam.paper", ctx("max")).ok,
    "内核表：试题模拟 pro 不可、max 可（与 §4.15 一致）");
  /* Issue #163 末条：集子访问是拆出来的第二条能力（两行两个钩叉） */
  chk(!E.can("exam.gathering", ctx("pro")).ok && E.can("exam.gathering", ctx("max")).ok,
    "内核表：古诗词大会集子 pro 不可、max 可（同一条口径）");
  chk(!E.can("quiz.review", ctx("free")).ok && E.can("quiz.review", ctx("pro")).ok,
    "内核表：题库复习 pro 起（与 §4.15 一致）");

  /* ② 一分钱都不收、一行 AI 都不接：判分口与内核里不许出现任何 AI 商名 / SDK */
  const aiVendors = /openai|anthropic|claude|gpt|gemini|qwen|deepseek|moonshot|智谱|通义|文心|kimi/i;
  ["js/quiz.js", "js/game.js", "api/_lib/game.js", "api/game/answer.js"].forEach(f => {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    chk(!aiVendors.test(src), f + " 里不出现任何 AI 商名 / SDK（三件不花钱）");
  });
  const coreSrc = read("api/_lib/core.js");
  chk(/var charge = input\.charge === true;/.test(coreSrc),
    "判分口的计费**默认关着**（charge 只有显式 true 才算）");
  chk(/免费、不限次\*\*，不计额度/.test(coreSrc),
    "不开计费时**如实说明**「免费不限次」（本站不收款、没有计费）");
  /* 用户 2026-09-17：「把需要收我 app 费用的功能删除」。
     两端能力表都不许再有 ai.* —— 上一节已钉客户端，这里钉服务端。 */
  chk(!/ai\.explain/.test(coreSrc.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")),
    "服务端 featuresFor() 里没有任何 ai.* 能力（付费功能已删除）");

  /* ③ 界面不假装：3 期的功能名**只许出现在该出现的地方** */
  const files = fs.readdirSync(path.join(ROOT, "js")).filter(f => /\.js$/.test(f));
  const holders = files.filter(f => /飞花令|现场考试|试题模拟|题库/.test(read("js/" + f)));
  /* ⚠️ 判据按**文件**列出来（不是按出现次数）：这里要的是「这几件事的名字
     只活在该活的那几处」。`js/poems.js` 是索引页自己，它只在一句注释里
     说明「那一层点一句能打开原文」—— 不渲染题目、不判权、不写文案。 */
  /* ⚠️ Issue #163 末条（2026-09-19）：`js/plans.js` **不再**出现在这里。
     它原先有一处把 `exam.paper` 那一格写成两行字的排版（「古诗词大会 / 试题模拟」）——
     用户把那个折中否掉了：「是要拆成两个表格行，不是换行 这是两个功能」。
     现在那一页只画内核给的名字（一个字都不拼），所以这几件事的名字只活在
     内核能力表 + 出题内核 + 那一层页面里。 */
  eq(holders.sort().join(","), "entitlement.js,game.js,poems.js,quiz.js",
    "js/ 下提到这几件事的只有内核能力表 + 出题内核 + 那一层页面 + 挂载它的索引页");
  const gameSrc = read("js/game.js").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  chk(!/即将上线|敬请期待/.test(gameSrc), "js/game.js 里不写「即将上线」这类提前承诺");
  /* 未登录时先提登录，不提层级 —— 「未登录」与「层级不够」是两回事 */
  has(gameSrc, "Ent.denyReason(", "拦住用户的那句话由 Entitlement.denyReason() 出");
}

console.log("\n=== 九、客户端收下这一份，但**不参与判权**、**不落盘** ===");
const section9 = (async () => {
  const M = require(path.join(ROOT, "js/account-api.js"));
  const E = require(path.join(ROOT, "js/entitlement.js"));
  const A = require(path.join(ROOT, "js/auth-core.js"));

  const backing = (() => {
    const m = {};
    return {
      getItem: k => (Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null),
      setItem: (k, v) => { m[k] = String(v); },
      removeItem: k => { delete m[k]; },
      raw: () => m
    };
  })();

  const store = A.makeStore(backing);
  const rr = A.requestCode(store, { channel: "email", value: "c@163.com" }, "login", { code: "246810" });
  A.verifyCode(store, rr.codeId, "246810", "login");

  const api = M.bind({
    api: {
      me: () => Promise.resolve({
        ok: true, plan: { tier: "pro", until: null }, role: "user", mask: "c***@163.com",
        channel: { mail: "sendgrid", delivered: true, db: "db", sms: false }
      }),
      deleteAccount: () => Promise.resolve({ ok: false, code: "E_OFFLINE" })
    },
    E: E, A: A, backing: backing
  });

  M.reset();
  const beforeKeys = Object.keys(backing.raw()).slice().sort();
  const res = await api.refreshMe();
  {
    eq(res.ok, true, "refreshMe 拿到答案");
    const ch = api.channel();
    chk(!!ch, "开通状态被如实收下");
    eq(ch.mail, "sendgrid", "mail 字段收下");
    eq(ch.sms, false, "sms 字段收下");
    /* 收下 ≠ 落盘：它是「这一轮问到的实情」 */
    const added = Object.keys(backing.raw()).filter(k => beforeKeys.indexOf(k) < 0);
    eq(added.join(","), "poem_plan_v1", "这一轮只多写了一个权益键（开通状态一个字节都没写盘）");
    const dumped = JSON.stringify(backing.raw());
    chk(dumped.indexOf("sendgrid") < 0, "开通状态**没有落盘**（缓存一份必然与服务端真实状态漂移）");
    eq(E.identity({ backing: backing, authStore: store }).tier, "pro", "层级照旧落到权益层（与开通状态无关）");
    eq(E.identity({ backing: backing, authStore: store }).tierSource, "server", "来源仍是「服务器判定」");
  }
})().catch(e => {
  /* 异步块自己出错时只记一次失败（退出码同样留到最末统一出） */
  console.error("测试自身抛异常（通常是环境问题）：", e);
  fails++;
});


console.log("\n=== 十一、待做清单（docs/todo.md）是唯一一处「现在不做、以后做」 ===");
{
  /* 用户 2026-09-18 在 Issue #159 里定：
       「把短信登录放在 docs/todo.md, 现在不做。
        任何以后做的都放这里，包括微信小程序版等等。」

     这一节守的就是那件字面上的事：**那份文件真的存在、真的记了那两条、
     而且不许被写成排期承诺**（写成「即将上线」正是本项目最恨的假话）。
     同一条纪律的另一半：**已经裁掉的事不许搬进去** ——
     搬进去就成了「以后要做」的另一种说法（收费 / AI 讲解 / 集子整本导出都不许出现）。 */
  const exists = fs.existsSync(path.join(ROOT, "docs/todo.md"));
  chk(exists, "docs/todo.md 存在（唯一一处记「以后做」的文件）");

  if (exists) {
    const todo = read("docs/todo.md");

    /* ① 用户点名要放进去的两条，一条都不许少 */
    has(todo, "短信登录", "记了「短信登录」");
    has(todo, "微信小程序", "记了「微信小程序版」");

    /* ② 「现在不做」这件事要写明白 —— 不是「即将上线」。
       ⚠️ 判据要落在**条目表**（第 1 节）上，不能整篇正则扫：
       本文档正文里**必然出现**这几个词（它正是在写「不许这么说」这条纪律），
       整篇一扫就会把「引用禁语」判成「用了禁语」—— 那是测试自己读数错。 */
    const secRows = todo.slice(todo.indexOf("## 1. 待做条目"), todo.indexOf("## 2. 明确**不在**这份文件里的"));
    chk(!/即将上线|敬请期待|马上就来|马上就好/.test(secRows),
      "待做条目表里不写「即将上线」这类提前承诺（它是「不做」，不是「在做」）");
    has(todo, "现在不做", "todo.md 写明当下的状态是「现在不做」");
    has(todo, "没有日期、没有工期", "todo.md 写明这里的条目没有日期、没有工期");

    /* ③ 那条最容易被写丢的纪律：这里没有日期、没有工期 */
    chk(!/\d{4}-\d{2}-\d{2}\s*[~至到]\s*\d{4}/.test(todo),
      "todo.md 不给条目排日期（排期是 §5 的事，这里只记状态）");

    /* ④ 已裁掉的事不许搬进来（搬进来 = 「以后要做」的另一种说法） */
    const sec1 = secRows;
    chk(sec1.indexOf("收费标准") < 0 && !/^\|\s*\d+\s*\|[^|]*收费/m.test(sec1),
      "「收费」不在待做条目表里（4 期整期取消，不许当成以后要做）");
    chk(sec1.indexOf("AI 讲解") < 0 && sec1.indexOf("纠音") < 0,
      "「AI 讲解 / 纠音」不在待做条目表里（已从能力表删除）");
    chk(!/整本导出|全站批量导出/.test(sec1),
      "集子整本导出不在待做条目表里（产品判断：不做）");

    /* ⑤ 两份主文档都要指向它 —— 三处口径只有一处是状态源 */
    ["docs/architecture.md", "docs/auth-design.md"].forEach(f => {
      has(read(f), "docs/todo.md", f + " 指向 docs/todo.md");
    });
    has(read("docs/auth-design.md").slice(0, 4000), "docs/todo.md",
      "auth-design.md 头部就指向（别让人翻到 §8 才看见）");
    has(read("docs/architecture.md").slice(0, 4000), "docs/todo.md",
      "architecture.md 头部就指向");

    /* ⑥ 短信那一节自身也要挂上这条指引（它是最容易被当成「欠着」的一节） */
    has(read("docs/auth-design.md"), "todo.md) 第 1 条",
      "auth-design.md §8 短信那一节挂上了 todo.md 的指引");

    /* ⑦ 不是 SW 预缓存资源：它是给人看的文档，不是给浏览器下载的页面 */
    const sw = read("sw.js");
    chk(sw.indexOf("docs/todo.md") < 0, "todo.md 不进 sw.js 预缓存");

    /* ⑧ 纪律第 2 条「做完一件就搬走一件」：跨设备分档案 2026-09-18 落了地，
       它必须**从待做表里拿掉**，并在「已搬走」里留一行搬到哪一节 ——
       留在待做表里的症状是「下一次有人翻这份文件，会以为还欠着」，
       而那正是这份文件当初被建出来的理由（Issue #159 里它被反复问过）。 */
    chk(!/^\|\s*4\s*\|.*跨设备/m.test(secRows),
      "「跨设备分档案」已从待做条目表里拿掉（它 2026-09-18 已落地）");
    has(todo, "## 3. 已搬走", "todo.md 有「已搬走」这一节（记搬到哪一节）");
    has(todo, "§5.5", "已搬走那一行指向 architecture.md 的 §5.5");
    has(read("docs/architecture.md"), "§5.5", "architecture.md 里真有 §5.5 那一节");
  }

}

/* 末节收口：此刻所有同步断言都已跑完，等 §九 那个异步块收尾再出退出码 */
section9.then(() => {
  console.log("");
  if (fails) { console.log("❌ 开通自检 / 配置清单测试 " + fails + " 项失败"); process.exit(1); }
  console.log("🎉 开通自检 / 配置清单测试全部通过");
});
