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

  cfg.hasMail = function () { return this.mail() !== "console"; };
  return cfg;
}

console.log("=== 一、清单与判定同源：ENRTY 里每一项都真的被 config 读 ===");
{
  const src = read("api/_lib/config.js");
  ops.ENTRY.forEach(e => {
    has(src, e.key, "清单里的 " + e.key + " 在 config.js 里真的被读（不是写在文档里的话）");
  });

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

  eq(byKey.RESEND_API_KEY.level, "needed", "Resend 密钥是「这一件需要」（缺了只是发不出真信）");
  eq(byKey.SENDGRID_API_KEY.level, "optional", "SendGrid 退成「可选」（已收费，只有付费账号才配）");
  chk(/收费|付费/.test(byKey.SENDGRID_API_KEY.what), "SendGrid 那一项里如实写明「已收费」（不装作还能免费用）");
  eq(byKey.SENDGRID_API_KEY.secret, true, "SendGrid 仍是密钥项（不因为它退档就当成明文）");
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

  const half = ops.check(fullCfg({ smsEnabled: true, smsTransport: null }));
  chk(half.smsReady === false, "SMS_ENABLED=1 但没接商 → 仍然不是「能发」");
  chk(half.notes.some(n => /503/.test(n)), "并在提醒里说清「请求仍是 503」（不说成配置生效）");

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

  chk(!/长度|len\b/i.test(ops.report(cfg)), "报告里不报密钥长度");
}

console.log("\n=== 五之二、发信商主备口径：2026-09-16 起主 Resend（Issue #159） ===");
{

  const byKey2 = {};
  ops.ENTRY.forEach(e => { byKey2[e.key] = e; });
  const sg = byKey2.SENDGRID_API_KEY, rs = byKey2.RESEND_API_KEY;

  eq(rs.level, "needed", "Resend 是「这一件需要」");
  eq(sg.level, "optional", "SendGrid 是「可选」");
  chk(/收费|付费/.test(sg.what + sg.missing + sg.how),
    "SendGrid 三句话里至少有一处写明「已收费」（否则用户会以为它还免费）");

  const both = fullCfg({ sendgridKey: "SG.x", resendKey: "RS.y", mailTransport: null });
  const r = ops.check(both);
  eq(r.mail, "sendgrid", "两个密钥都填、又没指定通道时，缺省选中的仍是 sendgrid（推断顺序的事实）");
  chk(r.notes.some(n => /MAIL_TRANSPORT/.test(n) && /sendgrid/i.test(n)),
    "并在提醒里点破：想用 Resend 就要显式写 MAIL_TRANSPORT=resend");

  const onlyResend = fullCfg({ sendgridKey: null, resendKey: "RS.y", mailTransport: null });
  eq(ops.check(onlyResend).mail, "resend", "只填 Resend 密钥时，推断出来的通道就是 resend");
  chk(!ops.check(onlyResend).notes.some(n => /都填了/.test(n)),
    "只填一个时不出现「都填了」那条提醒（提醒不许对不适用的人喊）");

  const txt = ops.report(both);
  chk(txt.indexOf("SG.x") < 0 && txt.indexOf("RS.y") < 0, "那条提醒里没有出现任何密钥的值");
}

console.log("\n=== 五之三、文档与清单不许分叉（这轮换主选最容易漏的就是文档） ===");
{

  const arch = read("docs/architecture.md");

  const archProse = arch.split("\n").filter(l =>
    !/^\s*[|>#]?\s*[-:\s]*\|?\s*(免费档|国内到达率|数据落地|SDK 体验)/.test(l)
    && !/2026-09-16|已收费|转向收费|收费|~~|停用|放弃|Issue #159/.test(l)
    && !/原先|改前|旧口径|修订|对调|退为|退成/.test(l)

    && !/\|\s*「[^」]*SendGrid[^」]*」[^|]*\|/.test(l)
  ).join("\n");
  chk(!/主\s*SendGrid|SendGrid\s*主|SendGrid（主）/i.test(archProse),
    "docs/architecture.md 不再把 SendGrid 写成主选（排除了说明这次变更的那些行）");
  has(arch, "主 Resend", "docs/architecture.md 写明现在的主选是 Resend");

  const readme = read("README.md");
  const cLine = readme.split("\n").filter(l => /\|\s*\*\*C\*\*\s*\|/.test(l)).join("\n");
  has(cLine, "Resend", "README 的 C 步写的是 Resend");
  chk(cLine.indexOf("SendGrid") < 0, "README 的 C 步不再写 SendGrid（写了就等于让人白注册一个收费的）");

  const privacy = read("privacy/index.html");
  has(privacy, "Resend", "隐私条款列的服务商是 Resend");
  chk(privacy.indexOf("SendGrid") < 0, "隐私条款里不再出现 SendGrid（已停用，写了就是假的处理者）");

  const mailSrc = read("api/_lib/mail/index.js");
  chk(!/sendgrid\s*—\s*主选/.test(mailSrc), "mail/index.js 的注释不再把 sendgrid 写成主选");
}

console.log("\n=== 六、`.env.example` 由清单生成，且与清单一致 ===");
{
  const ex = ops.envExample();
  ops.ENTRY.forEach(e => {
    has(ex, "\n" + e.key + "=", ".env.example 里有 " + e.key + "=（空值，等用户填）");
  });
  chk(ex.indexOf("不要手改") >= 0, "生成物里标明「由脚本生成、不要手改」");
  chk(/三档|必须/.test(ex), "生成物按三档分组");

  const gen = read("scripts/env-example.js");
  chk(/ops\.envExample\(\)/.test(gen), "生成脚本取的是同一份清单（不是自己又写一遍）");

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

console.log("\n=== 七之二、2D 的六个步骤（配置与真开通，docs §4.12） ===");
{

  chk(Array.isArray(ops.STEPS) && ops.STEPS.length === 6, "六步齐备（实际 " + (ops.STEPS || []).length + "）");
  const ids = ops.STEPS.map(s2 => s2.id).join("");
  eq(ids, "ABCFDE", "六步的编号稳定（A/B/C/F 是「配什么」，D/E 是「配完怎么兜与怎么验」 —— F 不许排到 E 后面）");
  ops.STEPS.forEach(st => {
    chk(!!st.title && !!st.where && !!st.why && !!st.check,
      "第 " + st.id + " 步四句话都写全了（叫什么 / 在哪配 / 为什么 / 判据）");
    chk(st.how && st.how.length > 0, "第 " + st.id + " 步给了可照做的动作");
    chk(["required", "needed", "optional"].indexOf(st.level) >= 0,
      "第 " + st.id + " 步的档位是三种之一（复用清单那三档，不另立一套）");
  });

  const A2 = ops.STEPS[0], B2 = ops.STEPS[1], C2 = ops.STEPS[2], F2 = ops.STEPS[3], D2 = ops.STEPS[4], E2 = ops.STEPS[5];
  has(A2.how.join(" "), "openssl rand -hex 32", "A 步给的是可照抄的命令，不是「生成一个随机串」");
  has(A2.how.join(" "), "SESSION_SECRET", "A 步说清这一串填到哪个变量里");
  has(B2.how.join(" "), "api/_lib/schema.sql", "B 步的建表指向仓库里那份真 schema（不另抄一份 SQL）");
  has(B2.how.join(" "), "service_role", "B 步明说用 service_role");
  has(B2.how.join(" "), "不是 anon", "并且**明确排除** anon（配错这一项的症状是「读不到一行数据」）");
  has(C2.how.join(" "), "SPF", "C 步含 SPF");
  has(C2.how.join(" "), "DKIM", "C 步含 DKIM");
  has(C2.how.join(" "), "DMARC", "C 步含 DMARC（只有 SPF+DKIM 仍会被 QQ/163 拒收）");
  has(C2.why, "console", "C 步说清不配的下场是 console 通道（真实用户收不到信）");

  const chow = C2.how.join(" ");
  has(chow, "Resend", "C 步的主选是 Resend");
  has(chow, "收费", "并如实写明「SendGrid 已转向收费」（这是换主选的原因）");
  has(chow, "RESEND_API_KEY", "C 步说清这一枚 key 填到哪个变量里");
  has(chow, "MAIL_TRANSPORT", "C 步说清「两个密钥都填时必须显式指定通道」（不写就会一直花 SendGrid 的钱）");

  has(D2.how.join(" "), "密钥仓库", "D 步说清密钥放密钥仓库（不是 env 里手填）");
  has(D2.how.join(" "), ".cnb.yml", "D 步指向本仓库的 .cnb.yml");
  has(D2.why, "7 天", "D 步说清免费档的暂停判定（连续 7 天没请求）");
  has(D2.how.join(" "), "每 5 天", "探活排每 5 天，并给出理由（留 2 天缓冲）");
  has(D2.how.join(" "), "pg_dump", "备份走 pg_dump");
  has(D2.how.join(" "), "打到数据库", "探活必须打到数据库（根路径与状态页不算活动）");

  const ev = E2.how.join(" ");
  has(ev, "/api/me", "E 步验会话（/api/me）");
  has(ev, "401", "并给出期望值 401");
  has(ev, "503", "并给出反面：503 就是 SESSION_SECRET 没生效（两种状态不许合并成「失败」）");
  has(ev, "delivered:true", "E 步验真发信，判据是 delivered:true");
  has(ev, "DELETE", "E 步验注销接口可达");

  has(ev, "/api/config", "E 步验「接口真的活着」（/api/config）");
  has(ev, "The page could not be found", "并点明平台层 404 长什么样（与本站的 E_404 区分开）");
  has(ev, "E_404", "同时给出**本站** 404 的形状，两种不许混成一句「404」");
  has(ev, "rewrite", "并写明这条坏法的来由（rewrite 那一层）");

    has(ev, "api/handler.js", "E 步点明函数入口是固定的 api/handler.js");
    has(ev, "__path=:path*", "并写明 rewrite 如何把原 API 路径交给固定函数");
  has(ev, "vercel.json", "第 ⑤ 条的判据里要看 vercel.json 里那条 rewrite");

  const stepsText = ops.stepsReport(fullCfg()).replace(/不做「应该没问题」这类判断/g, "");
  chk(!/应该|大概|基本/.test(stepsText),
    "整份步骤文字里不出现「应该 / 大概 / 基本」这类判断（只回答事实）");

  const dbCmd = ops.STEPS[1].check;
  chk(dbCmd.indexOf("rest/v1/accounts") >= 0, "B 步的判据里带着那条真命令");
  chk(ev.indexOf("rest/v1/accounts") >= 0, "E 步的验收里也带着同一条");
  chk(ops.stepsReport(fullCfg()).indexOf("rest/v1/accounts") >= 0, "渲染出来看得见它");

  const txt2 = ops.stepsReport(fullCfg({ sendgridKey: "SG.STEP_SECRET", supabaseServiceKey: "STEP_SECRET_SVC" }));
  chk(txt2.indexOf("STEP_SECRET") < 0, "步骤文字里没有出现任何密钥的值");
  chk(txt2.indexOf("http_code") >= 0, "但命令本身要看得见（占位是 $VAR，由用户自己的 shell 展开）");
  chk(txt2.indexOf("-o /dev/null") >= 0, "验收命令把响应体丢掉（响应里可能有账号数据，不该进终端日志）");

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

  const cnb = read(".cnb.yml");
  has(cnb, "crontab: 0 3 */5 * *", "D 步说的探活真的写进了 .cnb.yml（每 5 天）");
  has(cnb, "crontab: 30 4 * * 1", "D 步说的备份也写了（每周一次）");
  has(cnb, "supabase-keepalive", "探活流水线有名字");
  has(cnb, "supabase-backup", "备份流水线有名字");
  has(cnb, "rest/v1/accounts", "探活打的是真查询（PostgREST），不是根路径");
  has(cnb, "test \"$CODE\" = \"200\"", "探活失败会红（不静默通过）");
  has(cnb, "secret", "密钥走密钥仓库的 imports，不手填在 env 里");
  chk(cnb.indexOf("SUPABASE_SERVICE_KEY=") < 0, ".cnb.yml 里没有把密钥值写死（只有引用）");

  const cnbCode = cnb.split("\n").filter(l => !/^\s*#/.test(l)).join("\n");
  chk(cnbCode.indexOf('apikey: $SUPABASE_URL') < 0,
    ".cnb.yml 的 apikey 头不是 SUPABASE_URL（那是 URL，不是 key —— 会回 401）");
  has(cnbCode, "apikey: $SUPABASE_SERVICE_KEY", ".cnb.yml 的 apikey 头用的是 service key");

  has(cnb, "Authorization: Bearer $SUPABASE_SERVICE_KEY", "Authorization 那一头也带着同一个 key");
  const vdb = ops.STEPS.filter(x => x.id === "E")[0].how.join("\n") + "\n" + ops.STEPS[1].check;
  chk(vdb.indexOf("apikey: $SUPABASE_URL") < 0,
    "ops.js 里那条验收命令（B 的判据 / E 的第①条）同样不是 SUPABASE_URL");
  has(vdb, "apikey: $SUPABASE_SERVICE_KEY", "ops.js 里那条命令用的是 service key");

  const stepD = ops.STEPS.filter(x => x.id === "D")[0].how.join("\n");
  has(stepD, "SUPABASE_DB_URL", "D 步写明了备份还要第三个值");
  has(stepD, "[YOUR-PASSWORD]", "D 步写明了那个占位符要整体替换掉");
  has(stepD, "Connection string", "D 步指明了去哪里取模板");
  has(stepD, "%40", "D 步写明密码里的特殊字符要百分号编码");
  has(cnb, "SUPABASE_DB_URL:?", ".cnb.yml 的备份真的校验这个变量注入没注入");

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

  has(stepD, "%3A", "D 步写明了其余保留字符怎么编码（: → %3A）");
  has(stepD, "只许出现一次", "D 步给出了「@ 只许出现一次」这条可自检的判据");
  has(stepD, "pooler.supabase.com", "D 步给出了解析不到直连主机名时的替代串（Session pooler）");
  has(stepD, "6543", "D 步写明 Transaction pooler 那个端口不要给 pg_dump 用");
  has(stepD, "server version mismatch", "D 步写明 pg_dump 比服务端低时的报错");

  has(stepD, "postgres:17", "D 步写明备份镜像用 postgres:17（跟着服务端大版本走）");
  has(stepD, "abort", "D 步写明版本低是直接 abort，不是「警告不是失败」");
  has(stepD, "0 字节", "D 步写明 0 字节不算备份");
  has(cnb, "image: postgres:17", ".cnb.yml 的备份镜像真的是 postgres:17");
  chk(!/image: postgres:16/.test(cnb),
    "备份镜像不再是 postgres:16（它对着服务端 17 一定 abort）");
  chk(cnbCode.indexOf("pg_dump --version") >= 0, "备份脚本先把 pg_dump 版本打出来");
  chk(/test "\$SIZE" -gt 0/.test(cnbCode), "备份脚本会为空文件把门（0 字节退非 0）");
  chk(/rm -f "\$OUT"/.test(cnbCode), "备份失败会把半截文件删掉（不让空文件冒充备份）");

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

  const src = read("api/_lib/core.js");
  const fn = src.slice(src.indexOf("function channelFacts"), src.indexOf("function featuresFor"));
  has(fn, "cfg.mail()", "channelFacts 走 cfg.mail()（单一判定处）");
  has(fn, "cfg.hasDb()", "channelFacts 走 cfg.hasDb()");
}

console.log("\n=== 十、3 期那三件：口径写清了，而且**不许偷偷接 AI / 收钱** ===");
{

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

  has(sec, "不接任何 AI 商", "§4.15 写明不接 AI 商");
  has(sec, "纯逻辑", "§4.15 写明判据是纯逻辑（含不含字 / 在不在库 / 说没说过）");
  has(sec, "检索", "§4.15 写明先做纯检索版（AI 对句降为可选的一层）");

  has(readme, "现场考试和飞花令归 max 所有，题库归 pro", "README 引用了用户的原话（层级口径）");
  has(readme, "§4.15", "README 指向 §4.15");

  const E = require(path.join(ROOT, "js/entitlement.js"));
  const ctx = t => ({ tier: t, signedIn: true });
  chk(!E.can("feihualing", ctx("pro")).ok && E.can("feihualing", ctx("max")).ok,
    "内核表：飞花令 pro 不可、max 可（与 §4.15 一致）");
  chk(!E.can("exam.paper", ctx("pro")).ok && E.can("exam.paper", ctx("max")).ok,
    "内核表：试题模拟 pro 不可、max 可（与 §4.15 一致）");

  chk(!E.can("exam.gathering", ctx("pro")).ok && E.can("exam.gathering", ctx("max")).ok,
    "内核表：古诗词大会集子 pro 不可、max 可（同一条口径）");
  chk(!E.can("quiz.review", ctx("free")).ok && E.can("quiz.review", ctx("pro")).ok,
    "内核表：题库复习 pro 起（与 §4.15 一致）");

  const aiVendors = /openai|anthropic|claude|gpt|gemini|qwen|deepseek|moonshot|智谱|通义|文心|kimi/i;
  ["js/quiz.js", "js/game.js", "api/_lib/game.js", "api/_routes/game/answer.js"].forEach(f => {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    chk(!aiVendors.test(src), f + " 里不出现任何 AI 商名 / SDK（三件不花钱）");
  });
  const coreSrc = read("api/_lib/core.js");
  chk(/var charge = input\.charge === true;/.test(coreSrc),
    "判分口的计费**默认关着**（charge 只有显式 true 才算）");
  chk(/免费、不限次\*\*，不计额度/.test(coreSrc),
    "不开计费时**如实说明**「免费不限次」（本站不收款、没有计费）");

  chk(!/ai\.explain/.test(coreSrc.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")),
    "服务端 featuresFor() 里没有任何 ai.* 能力（付费功能已删除）");

  const files = fs.readdirSync(path.join(ROOT, "js")).filter(f => /\.js$/.test(f));
  const holders = files.filter(f => /飞花令|现场考试|试题模拟|题库/.test(
    read("js/" + f).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")));

  eq(holders.sort().join(","), "entitlement.js,game.js",
    "js/ 下**代码里**提到这几件事的只有内核能力表 + 出题内核（页面文案归页面）");
  chk(/poems:open/.test(read("js/poems.js")) && /poems:open/.test(read("js/game.js")),
    "索引页与本层的唯一接口 `poems:open` 两端都接上了（点一句 → 打开那一篇的原文）");
  const gameSrc = read("js/game.js").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  chk(!/即将上线|敬请期待/.test(gameSrc), "js/game.js 里不写「即将上线」这类提前承诺");

  has(gameSrc, "Ent.denyReason(", "拦住用户的那句话由 Entitlement.denyReason() 出");
}

console.log("\n=== 九、客户端收下这一份，但**不参与判权**、**不落盘** ===");
const section9 = (async () => {
  const M = require(path.join(ROOT, "js/account-api.js"));
  const E = require(path.join(ROOT, "js/entitlement.js"));
  const A = require(path.join(ROOT, "js/auth-core.js"));

  if (E.setAuthCore) E.setAuthCore(A);

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
  const rv = A.verifyCode(store, rr.codeId, "246810", "login");

  const meUid = (rv && rv.account && rv.account.uid) || "";

  const api = M.bind({
    api: {
      me: () => Promise.resolve({
        ok: true, uid: meUid, plan: { tier: "pro", until: null }, role: "user", mask: "c***@163.com",
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

    const added = Object.keys(backing.raw()).filter(k => beforeKeys.indexOf(k) < 0);
    eq(added.join(","), "poem_plan_v1", "这一轮只多写了一个权益键（开通状态一个字节都没写盘）");
    const dumped = JSON.stringify(backing.raw());
    chk(dumped.indexOf("sendgrid") < 0, "开通状态**没有落盘**（缓存一份必然与服务端真实状态漂移）");
    eq(E.identity({ backing: backing, authStore: store }).tier, "pro", "层级照旧落到权益层（与开通状态无关）");
    eq(E.identity({ backing: backing, authStore: store }).tierSource, "server", "来源仍是「服务器判定」");
  }
})().catch(e => {

  console.error("测试自身抛异常（通常是环境问题）：", e);
  fails++;
});

console.log("\n=== 十一、待做清单（docs/todo.md）是唯一一处「现在不做、以后做」 ===");
{

  const exists = fs.existsSync(path.join(ROOT, "docs/todo.md"));
  chk(exists, "docs/todo.md 存在（唯一一处记「以后做」的文件）");

  if (exists) {
    const todo = read("docs/todo.md");

    has(todo, "短信登录", "记了「短信登录」");
    has(todo, "微信小程序", "记了「微信小程序版」");

    const secRows = todo.slice(todo.indexOf("## 1. 待做条目"), todo.indexOf("## 2. 明确**不在**这份文件里的"));
    chk(!/即将上线|敬请期待|马上就来|马上就好/.test(secRows),
      "待做条目表里不写「即将上线」这类提前承诺（它是「不做」，不是「在做」）");
    has(todo, "现在不做", "todo.md 写明当下的状态是「现在不做」");
    has(todo, "没有日期、没有工期", "todo.md 写明这里的条目没有日期、没有工期");

    chk(!/\d{4}-\d{2}-\d{2}\s*[~至到]\s*\d{4}/.test(todo),
      "todo.md 不给条目排日期（排期是 §5 的事，这里只记状态）");

    const sec1 = secRows;
    chk(sec1.indexOf("收费标准") < 0 && !/^\|\s*\d+\s*\|[^|]*收费/m.test(sec1),
      "「收费」不在待做条目表里（4 期整期取消，不许当成以后要做）");
    chk(sec1.indexOf("AI 讲解") < 0 && sec1.indexOf("纠音") < 0,
      "「AI 讲解 / 纠音」不在待做条目表里（已从能力表删除）");
    chk(!/整本导出|全站批量导出/.test(sec1),
      "集子整本导出不在待做条目表里（产品判断：不做）");

    ["docs/architecture.md", "docs/auth-design.md"].forEach(f => {
      has(read(f), "docs/todo.md", f + " 指向 docs/todo.md");
    });
    has(read("docs/auth-design.md").slice(0, 4000), "docs/todo.md",
      "auth-design.md 头部就指向（别让人翻到 §8 才看见）");
    has(read("docs/architecture.md").slice(0, 4000), "docs/todo.md",
      "architecture.md 头部就指向");

    has(read("docs/auth-design.md"), "todo.md) 第 1 条",
      "auth-design.md §8 短信那一节挂上了 todo.md 的指引");

    const sw = read("sw.js");
    chk(sw.indexOf("docs/todo.md") < 0, "todo.md 不进 sw.js 预缓存");

    chk(!/^\|\s*4\s*\|.*跨设备/m.test(secRows),
      "「跨设备分档案」已从待做条目表里拿掉（它 2026-09-18 已落地）");
    has(todo, "## 3. 已搬走", "todo.md 有「已搬走」这一节（记搬到哪一节）");
    has(todo, "§5.5", "已搬走那一行指向 architecture.md 的 §5.5");
    has(read("docs/architecture.md"), "§5.5", "architecture.md 里真有 §5.5 那一节");
  }

}

section9.then(() => {
  console.log("");
  if (fails) { console.log("❌ 开通自检 / 配置清单测试 " + fails + " 项失败"); process.exit(1); }
  console.log("🎉 开通自检 / 配置清单测试全部通过");
});
