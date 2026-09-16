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
     飞花令与现场考试归 Max、题库复习归 Pro。
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
  chk(/现场考试[\s\S]{0,200}Max/.test(sec), "现场考试归 Max（同上）");
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
    "内核表：现场考试 pro 不可、max 可（与 §4.15 一致）");
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
  const holders = files.filter(f => /飞花令|现场考试|题库/.test(read("js/" + f)));
  eq(holders.sort().join(","), "entitlement.js,game.js,quiz.js",
    "js/ 下提到这三件事的只有内核能力表 + 那一层页面 + 出题内核（其余页面一个字都不渲染）");
  const gameSrc = read("js/game.js").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  chk(!/即将上线|敬请期待/.test(gameSrc), "js/game.js 里不写「即将上线」这类提前承诺");
  /* 未登录时先提登录，不提层级 —— 「未登录」与「层级不够」是两回事 */
  has(gameSrc, "Ent.denyReason(", "拦住用户的那句话由 Entitlement.denyReason() 出");
}

console.log("\n=== 九、客户端收下这一份，但**不参与判权**、**不落盘** ===");
{
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
  return api.refreshMe().then(res => {
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

    console.log("");
    if (fails) { console.log("❌ 开通自检 / 配置清单测试 " + fails + " 项失败"); process.exit(1); }
    console.log("🎉 开通自检 / 配置清单测试全部通过");
  }).catch(e => {
    console.error("测试自身抛异常（通常是环境问题）：", e);
    process.exit(1);
  });
}
