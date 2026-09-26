"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

let fails = 0;
const chk = (c, m) => { if (!c) { console.log("✗ " + m); fails++; } else console.log("✓ " + m); };

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-secret-at-least-16-chars";
process.env.MAIL_TRANSPORT = process.env.MAIL_TRANSPORT || "console";

const core = require("../api/_lib/core.js");
const storeMod = require("../api/_lib/store.js");
const CONFIG = require("../api/_lib/config.js");

function mkDeps(uid, opts) {
  const store = storeMod.memoryStore();
  const o = opts || {};
  return {
    cfg: o.cfg || CONFIG,
    store,
    limiter: core.makeRateLimiter(),
    now: () => (typeof o.now === "function" ? o.now() : 1789000000000),
    account: uid ? { uid, sid: "s_" + uid } : null,
    ip: "1.2.3.4",
    deviceId: "d1",
    _store: store
  };
}

function admin(store, uid, opts) {
  const o = opts || {};
  store.putAccount({
    uid, email: uid + "@t.dev", email_hash: "h_" + uid,
    nickname: o.nickname || uid, plan: "max", plan_until: null, role: o.role || "owner",
    created_at: 1789000000000, last_login_at: 1789000000000, status: "active",
    email_verified_at: 1789000000000, password_hash: "", password_salt: ""
  });
}

console.log("");
console.log("一、服务端内核：创建 / 频控 / 每日上限 / 空内容闸");

(async () => {
  {
    const d = mkDeps("u1");
    admin(d._store, "u1", { role: "user" });
    const r = await core.reportCreate(d, {
      kind: "pinyin", poemId: "gw-tw", poemTitle: "滕王阁序", book: "古文观止",
      quote: "秋水共长天", context: "落霞与孤鹜齐飞，秋水共长天一色。", note: "「长」该读 cháng"
    });
    chk(r.status === 200 && /^rp_/.test(r.body.rid), "报一条：回 200 + rid（" + (r.body.rid || "") + "）");
    chk(r.body.status === "new", "新报的一律是 new（不是「已修复」—— 那得管理员说）");
    chk(typeof r.body.remaining === "number", "回执里带今日剩余条数（" + r.body.remaining + "）");

    const rows = await d._store.listReports({ uid: "u1" }, 10);
    chk(rows.length === 1, "落库一条");
    chk(rows[0].email === "u1@t.dev",
      "邮箱是**快照明文**（Issue #320：从前是掩码，而掩码不可逆 —— 账号注销后认不出是谁）");
    chk(rows[0].nickname === "u1", "昵称也是快照");
    chk(rows[0].context.indexOf("秋水共长天一色") >= 0, "落库带上了整句上下文（不是只有两个字）");
  }

  {

    const d = mkDeps("u1");
    admin(d._store, "u1", { role: "user" });
    let r = await core.reportCreate(d, { kind: "text" });
    chk(r.status === 400 && r.body.code === "E_EMPTY", "什么都不填：400 E_EMPTY");

    r = await core.reportCreate(d, { kind: "text", quote: "错字" });
    chk(r.status === 200, "只填了引文也算（一键上报：选中一段直接发）");
  }

  {

    const d = mkDeps("u1");
    admin(d._store, "u1", { role: "user" });
    const r = await core.reportCreate(d, { kind: "不存在的一档", note: "x" });
    chk(r.status === 200, "认不出的 kind 不报错");
    const rows = await d._store.listReports({ uid: "u1" }, 10);
    chk(rows[0].kind === "other", "认不出的 kind 落 other（" + rows[0].kind + "）");
  }

  {

    const d = mkDeps("u1");
    admin(d._store, "u1", { role: "user" });
    let last = null;
    for (let i = 0; i < core.REPORT_DAILY_MAX + 3; i++) {
      d.deviceId = "dev-" + i;
      last = await core.reportCreate(d, { kind: "text", note: "第 " + i });
    }
    chk(last.status === 429 && last.body.code === "E_RATE_REPORT",
      "超过每日上限（" + core.REPORT_DAILY_MAX + "）后回 429 E_RATE_REPORT");
    const rows = await d._store.listReports({ uid: "u1" }, 100);
    chk(rows.length === core.REPORT_DAILY_MAX,
      "一天最多落 " + core.REPORT_DAILY_MAX + " 条（实际 " + rows.length + "）");
  }

  {

    let clock = 1789000000000;
    const d = mkDeps("u1", { now: () => clock });
    admin(d._store, "u1", { role: "user" });
    for (let i = 0; i < core.REPORT_DAILY_MAX; i++) {
      d.deviceId = "dev-" + i;
      await core.reportCreate(d, { kind: "text", note: "x" });
    }
    clock = 1789000000000 + 86400000 + 1000;
    d.deviceId = "dev-新的一天";
    const r = await core.reportCreate(d, { kind: "text", note: "第二天" });
    chk(r.status === 200, "隔一天（24h 之后）又能报");
  }

  {

    const d = mkDeps("u1");
    admin(d._store, "u1", { role: "user" });
    let hit = null;
    for (let i = 0; i < 40; i++) {
      hit = await core.reportCreate(d, { kind: "text", note: "连点 " + i });
      if (hit.status === 429) break;
    }
    chk(hit && hit.status === 429, "同一台机器连点会被 device 档挡下（429 " + (hit && hit.body && hit.body.code) + "）");
  }

  {

    const fakeCfg = Object.assign({}, CONFIG, { hasSession: () => false });
    const d = mkDeps("u1", { cfg: fakeCfg });
    const r = await core.reportCreate(d, { kind: "text", note: "x" });
    chk(r.status === 503 && r.body.code === "E_NOT_CONFIGURED", "服务端没配好：503 E_NOT_CONFIGURED（不是 500）");

    const d2 = mkDeps(null);
    const r2 = await core.reportCreate(d2, { kind: "text", note: "x" });
    chk(r2.status === 401 && r2.body.code === "E_NO_SESSION", "没登录：401（报告要认人）");
    chk(/Issue/.test(r2.body.message), "未登录那句**给出别的出路**（直接开 Issue）");
  }

  console.log("");
  console.log("二、只读自己那一份（uid 从会话取，不从请求体取）");

  {
    const dA = mkDeps("uA"), dB = mkDeps("uB");
    admin(dA._store, "uA", { role: "user" });
    admin(dA._store, "uB", { role: "user" });

    await core.reportCreate(dA, { kind: "text", note: "A 的" });

    dB._store.putReport({
      rid: "rp_other", uid: "uA", email: "uA@t.dev", nickname: "A", kind: "text",
      status: "new", poem_id: "", poem_title: "", book: "", quote: "", context: "",
      note: "别人的", suggestion: "", device: "", ua: "", created_at: 1789000000000, updated_at: 1789000000000
    });

    const r = await core.reportMine(dB, {});
    chk(r.status === 200, "读自己那一份：200");
    chk(r.body.reports.every(x => x.rid !== "rp_other"), "**看不到别人报的**（uid 从会话取）");
    chk(!/emailMask|@/.test(JSON.stringify(r.body.reports)),
      "用户端那一份**不含**邮箱字段（那是给管理员认人用的，不是给用户看的）");

    const r2 = await core.reportMine(dB, { uid: "uA", limit: 10 });
    chk(r2.body.reports.every(x => x.rid !== "rp_other"), "请求体里塞别人的 uid 也没用");
  }

  console.log("");
  console.log("三、管理端两道闸：会话 + 角色");

  {
    const d = mkDeps("uAdmin");
    admin(d._store, "uAdmin", { role: "owner" });
    admin(d._store, "uUser", { role: "user" });
    admin(d._store, "uPlain", { role: "user" });

    const uDeps = mkDeps("uUser");
    admin(uDeps._store, "uUser", { role: "user" });
    uDeps._store.putReport({
      rid: "rp1", uid: "uUser", email: "uUser@t.dev", nickname: "小朋友", kind: "pinyin",
      status: "new", poem_id: "gw-tw", poem_title: "滕王阁序", book: "古文观止",
      quote: "长", context: "秋水共长天一色。", note: "读 cháng", suggestion: "cháng",
      device: "d1", ua: "UA", created_at: 1789000000000, updated_at: 1789000000000
    });

    let r = await core.adminReports(uDeps, {});
    chk(r.status === 403 && r.body.code === "E_FORBIDDEN", "普通用户读台账：403 E_FORBIDDEN");

    r = await core.adminReportPatch(uDeps, { rid: "rp1", status: "fixed" });
    chk(r.status === 403, "普通用户改状态：403（用户端不能自己把报告标成已修复）");

    const aDeps = mkDeps("uAdmin");
    aDeps._store.putAccount({
      uid: "uAdmin", email: "a@t.dev", email_hash: "ha", nickname: "管理员",
      plan: "max", plan_until: null, role: "owner", created_at: 1, last_login_at: 1, status: "active"
    });
    aDeps._store.putReport({
      rid: "rp1", uid: "uUser", email: "uUser@t.dev", nickname: "小朋友", kind: "pinyin",
      status: "new", poem_id: "gw-tw", poem_title: "滕王阁序", book: "古文观止",
      quote: "长", context: "秋水共长天一色。", note: "读 cháng", suggestion: "cháng",
      device: "d1", ua: "UA", created_at: 1789000000000, updated_at: 1789000000000
    });

    r = await core.adminReports(aDeps, {});
    chk(r.status === 200, "管理员读台账：200");
    chk(r.body.reports.length === 1, "读到那一条");
    chk(r.body.reports[0].email === "uUser@t.dev", "管理端**看得见明文邮箱**（用来认人）");
    chk(Array.isArray(r.body.kinds) && r.body.kinds.length === core.REPORT_KINDS.length, "回 kinds 清单（界面据此画筛选项）");
    chk(r.body.counts && typeof r.body.counts.all === "number", "回各状态计数（" + JSON.stringify(r.body.counts) + "）");

    const g = mkDeps(null);
    const rg = await core.adminReports(g, {});
    chk(rg.status === 401, "没登录读台账：401");
  }

  console.log("");
  console.log("四、状态机与序列化");

  {
    const d = mkDeps("uA");
    admin(d._store, "uA", { role: "owner" });
    d._store.putReport({
      rid: "rpX", uid: "uB", email: "uB@t.dev", nickname: "B", kind: "text",
      status: "new", poem_id: "", poem_title: "", book: "", quote: "", context: "",
      note: "x", suggestion: "", device: "", ua: "", created_at: 1789000000000, updated_at: 1789000000000
    });

    let r = await core.adminReportPatch(d, { rid: "rpX", status: "fixed", reply: "已改" });
    chk(r.status === 200 && r.body.report.status === "fixed", "改成 fixed：200");
    chk(r.body.report.handledBy === "uA", "盖上处理人（" + r.body.report.handledBy + "）");
    chk(r.body.report.handledAt > 0, "盖上处理时刻");
    chk(/源码/.test(r.body.note), "回执里说清「真的修好要改源码」（台账不是数据源）");

    r = await core.adminReportPatch(d, { rid: "rpX", status: "new" });
    chk(r.body.report.handledAt === 0 || r.body.report.handledAt === null || !r.body.report.handledAt,
      "退回 new 时**清掉**处理人 / 处理时刻（否则「处理过几条」会把「只看了一眼」算进去）");

    r = await core.adminReportPatch(d, { rid: "rpX", status: "open" });
    chk(r.status === 200 && r.body.report.status === "new", "别名 open → new（老叫法仍认）");
    r = await core.adminReportPatch(d, { rid: "rpX", status: "done" });
    chk(r.status === 200 && r.body.report.status === "fixed", "别名 done → fixed");

    r = await core.adminReportPatch(d, { rid: "rpX", status: "乱写" });
    chk(r.status === 400 && r.body.code === "E_STATUS", "认不出的状态：400 E_STATUS");

    r = await core.adminReportPatch(d, { rid: "rp_不存在", status: "fixed" });
    chk(r.status === 404 && r.body.code === "E_NO_REPORT", "不存在的 rid：404 E_NO_REPORT");
  }

  console.log("");
  console.log("五、数据形状：前端与服务端共用同一组上界");

  {
    chk(core.REPORT_STATUSES.join(",") === "new,read,accepted,fixed,rejected",
      "五个状态写死且稳定：" + core.REPORT_STATUSES.join(","));
    chk(core.REPORT_KINDS.join(",") === "text,translation,pinyin,audio,ui,other",
      "六档「报什么」写死且稳定：" + core.REPORT_KINDS.join(","));

    const d = mkDeps("u1");
    admin(d._store, "u1", { role: "user" });
    const long = "长".repeat(5000);
    const r = await core.reportCreate(d, { kind: "text", note: long, quote: long, context: long, suggestion: long });
    chk(r.status === 200, "超长文本不报错（截断而不是拒收）");
    const rows = await d._store.listReports({ uid: "u1" }, 10);
    chk(rows[0].note.length === core.REPORT_LIMITS.note, "note 截到 " + core.REPORT_LIMITS.note);
    chk(rows[0].quote.length === core.REPORT_LIMITS.quote, "quote 截到 " + core.REPORT_LIMITS.quote);
    chk(rows[0].context.length === core.REPORT_LIMITS.context, "context 截到 " + core.REPORT_LIMITS.context);
    chk(rows[0].suggestion.length === core.REPORT_LIMITS.suggestion, "suggestion 截到 " + core.REPORT_LIMITS.suggestion);
  }

  {

    const reportJs = read("js/report.js");
    const m = reportJs.match(/var LIMITS = \{([^}]*)\}/);
    chk(!!m, "js/report.js 有 LIMITS 常量块");
    const nums = (m[1].match(/:\s*(\d+)/g) || []).map(x => Number(x.replace(/[^\d]/g, "")));
    const want = [core.REPORT_LIMITS.quote, core.REPORT_LIMITS.context, core.REPORT_LIMITS.note, core.REPORT_LIMITS.suggestion];
    chk(JSON.stringify(nums) === JSON.stringify(want),
      "js/report.js 的四个上界与服务端逐字一致（前端 " + nums.join(",") + " / 服务端 " + want.join(",") + "）");

    const kinds = (reportJs.match(/\{ key: "([a-z]+)"/g) || []).map(x => x.replace(/.*"([a-z]+)"/, "$1"));
    chk(kinds.length === core.REPORT_KINDS.length, "js/report.js 声明 " + core.REPORT_KINDS.length + " 档（实际 " + kinds.length + "）");
    core.REPORT_KINDS.forEach(k => {
      chk(kinds.indexOf(k) >= 0, "前端有「" + k + "」这一档");
    });
  }

  {

    const sql = read("api/_lib/schema.sql");
    chk(/create table if not exists public\.reports/.test(sql), "schema.sql 建了 public.reports");
    chk(/alter table public\.reports enable row level security/.test(sql),
      "reports 开了 RLS（漏掉这一段不会报错，症状是 anon key 能读别人报的错）");
    chk(/create index if not exists reports_status_created_idx/.test(sql), "按状态 + 时间建了索引（管理端默认就这么翻）");
    chk(/uid\s+text\s+not null references public\.accounts\(uid\)/.test(sql), "uid 外键指向 accounts");

    const purge = sql.slice(sql.indexOf("kb_purge_expired"));
    chk(purge.indexOf("public.reports") < 0 || purge.indexOf("delete from public.reports") < 0,
      "kb_purge_expired **不删**报告（人工台账，自动删就等于把没看的反馈丢掉）");
  }

  {

    const routes = read("api/_lib/routes.js");
    chk(/"GET \/report":/.test(routes), "路由表有 GET /report");
    chk(/"POST \/report":/.test(routes), "路由表有 POST /report");
    chk(/"POST \/admin\/reports":/.test(routes), "路由表有 POST /admin/reports");
    ["api/_routes/report/index.js", "api/_routes/admin/reports.js"].forEach(f => {
      chk(fs.existsSync(path.join(ROOT, f)), f + " 存在");
    });

    const R = require("../api/_lib/routes.js");
    chk(!!R.resolve("GET", "/api/report"), "GET /api/report 能解析到");
    chk(!!R.resolve("POST", "/api/report"), "POST /api/report 能解析到");
    chk(!!R.resolve("POST", "/api/admin/reports"), "POST /api/admin/reports 能解析到");
  }

  console.log("");
  console.log("七、不做什么：不进 progress、不参与同步、不按孩子分家");

  {
    const coreSrc = read("api/_lib/core.js");
    chk(core.REPORT_KINDS !== undefined, "core 里报告是独立的一节");

    const sp = coreSrc.slice(coreSrc.indexOf("function sanitizePayload"),
      coreSrc.indexOf("function sanitizeImgUrl"));
    chk(sp.indexOf("report") < 0, "sanitizePayload **不**收报告（它不进 progress 同步白名单）");

    const rc = coreSrc.slice(coreSrc.indexOf("function reportCreate"), coreSrc.indexOf("function reportMine"));
    chk(rc.indexOf("putProgress") < 0, "reportCreate **不写** progress（报告与学习进度是两回事）");
    chk(rc.indexOf("putReport") >= 0, "reportCreate 写的是 putReport");

    const store = read("api/_lib/store.js");
    const mem = store.slice(store.indexOf("putReport: function"), store.indexOf("putReport: function") + 1200);
    chk(mem.indexOf("child") < 0, "report 那几条 store 方法**不含** child（报告与「哪个孩子」无关）");

    const names = ["putReport", "getReport", "listReports", "patchReport", "countReports", "countReportsByUid"];

    names.forEach(n => {
      const lit = (store.match(new RegExp("\\b" + n + ":\\s*function", "g")) || []).length;
      const asg = (store.match(new RegExp("api\\." + n + "\\s*=", "g")) || []).length;
      chk(lit >= 1 && asg >= 1,
        "memory 与 supabase 两个实现都有 " + n + "（字面量 " + lit + " / 挂载 " + asg + "）");
    });
  }

  console.log("");
  console.log(fails ? ("✗ report.test.js：" + fails + " 条不通过") : "✓ report.test.js 全通过");
  process.exit(fails ? 1 : 0);
})();
