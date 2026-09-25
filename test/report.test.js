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
  console.log("六、界面入口");

  {
    const PAGES = ["classic", "tangshi", "songci", "guwen", "zhaoming", "yuanqu", "library", "search", "poems"];
    PAGES.forEach(p => {
      const f = p + "/index.html";
      const s = read(f);

      const iRep = Math.max(s.indexOf('id="gw-report"'), s.indexOf('id="lib-gw-report"'));
      chk(iRep >= 0, f + " 有详情页那一颗小旗");
      chk(/data-gw="report"/.test(s), f + " 的小旗带 data-gw=\"report\"（引擎按它取）");
      chk(/js\/report\.js/.test(s), f + " 加载 js/report.js");
      chk(/js\/account-api\.js/.test(s), f + " 加载 js/account-api.js（报告要发到服务端）");

      const iTrans = s.indexOf('id="rd-trans-toggle"');
      const iRecite = Math.max(s.indexOf('id="gw-recite"'), s.indexOf('id="lib-gw-recite"'));
      chk(iTrans >= 0 && iTrans < iRep, f + " 小旗排在译文按钮**之后**");
      chk(iRep >= 0 && iRep < iRecite, f + " 小旗排在「加入背诵」**之前**");
    });

    const classic = read("classic/index.html");
    const repBtn = classic.slice(classic.indexOf('id="gw-report"') - 200, classic.indexOf('id="gw-report"') + 400);
    chk(!/data-on=/.test(repBtn), "小旗**没有** data-on（它不是「加入」那一类开关）");
    chk(!/aria-pressed/.test(repBtn), "小旗没有 aria-pressed（同上）");
  }

  {

    const rc = read("js/reader-core.js");
    chk(/reportItemBtn\(p\)/.test(rc), "reader-core 列表行画那一颗");
    chk(/function reportItemBtn/.test(rc) && /function openReport/.test(rc) && /function syncReportButton/.test(rc),
      "reader-core 有 reportItemBtn / openReport / syncReportButton 三件");
    chk(/\.item-report/.test(rc), "列表行的点击绑在 .item-report 上");
    chk(/R\.bindSelection/.test(rc), "详情页正文档了选区监听（选中 → 报这一段）");

    const row = rc.slice(rc.indexOf("dailyItemBtn(p)") - 400, rc.indexOf("dailyItemBtn(p)") + 400);
    const iRep = rc.indexOf("reportItemBtn(p)");
    const iDaily = rc.indexOf("dailyItemBtn(p)");
    chk(iRep >= 0 && iDaily >= 0 && iRep < iDaily, "列表行里报告那颗在「＋」**左边**（排在最左）");
  }

  {

    const nav = read("js/settings-nav.js");
    chk(/\/settings\/reports\//.test(nav), "设置「关于」里有「我的报告」入口");
    chk(fs.existsSync(path.join(ROOT, "settings/reports/index.html")), "settings/reports/index.html 存在");
    const pg = read("settings/reports/index.html");
    chk(/id="reports-panel"/.test(pg), "那一页有挂载点");
    chk(/js\/reports-page\.js/.test(pg), "那一页加载 js/reports-page.js");
    chk(/js\/report\.js/.test(pg), "那一页加载 js/report.js");
    chk(/href="\/login\/"/.test(pg), "那一页给没登录的人一条去登录的路（不只是说「请登录」）");
    chk(/data-back="\/settings\/"/.test(pg), "那一页声明上一层是设置主页");

    const NAV_GROUPS = (nav.match(/key:\s*"[a-z]+",\s*\n\s*href:\s*"\/settings\/[a-z]+\/"/g) || []);
    chk(NAV_GROUPS.length === 4, "设置仍是四组（「我的报告」收在「关于」里，不新开一组）");
  }

  {

    const admin = read("admin/index.html");
    chk(/id="reports-card"/.test(admin), "管理端有「用户报告」那一张卡");
    chk(/id="reports-list"/.test(admin), "有列表挂载点");
    chk(/id="report-filter"/.test(admin), "有状态筛选下拉");
    chk(/js\/report\.js/.test(admin), "管理端也加载 js/report.js（标签文案一份出）");
    chk(/源码/.test(admin), "卡里如实写着「真的修复是改源码」");

    const aj = read("js/admin-page.js");
    chk(/function loadReports/.test(aj) && /function renderReports/.test(aj) && /function onReportsClick/.test(aj),
      "admin-page 有 loadReports / renderReports / onReportsClick 三件");
    chk(/adminReportPatch/.test(aj), "改状态走 adminReportPatch");
    chk(/标成「未采纳」/.test(aj), "「不采纳」会多问一句（用户看得到这个状态）");
    // 「就地更新」= 拿到那一行、改它的状态文字，**不**重拉整张表。
    // 判据是「查那一行 + 改状态」，不是某个特定的 class 名：
    // Issue #319 把名录那张表重排过一遍，class 名会变，这件事不会。
    chk(/admin-report-row\[data-rid|stay|就地/.test(aj) && /li\.querySelector/.test(aj),
      "改完**就地更新那一行**（不重拉整张表，否则滚动位置被打回顶部）");

    {
      const rp = read("js/reports-page.js");
      chk(/serverOnly/.test(rp),
        "「本机压着几条」比的是 serveOnly 那一份（服务端原样），不是并起来画出来的那一列");

      chk(/function updateSend\(serverOnly\)/.test(rp) && /pendingLocal\(serverOnly/.test(rp),
        "pendingLocal 的入参是 serverOnly（并起来那一列传进去 = 永远是 0）");
      chk(!/已在服务器上|没有压在本机发不出去的/.test(rp),
        "updateSend 不再报「服务器上几条 / 没有压着的」——那是用户数得出来的一句话（Issue #278）");
      const rj = read("js/report.js");
      chk(/serverOnly: r\.reports/.test(rj),
        "Report.mine() 把服务端原样那一份单独带出来（画的是并集，比的是原样）");
      chk(/pendingLocal: pendingLocal/.test(rj) && /resend: resend/.test(rj),
        "Report 上挂着 pendingLocal / resend（「还没发出去」与「补发」是一对）");
      chk(/function pendingLocal\(remote\)[\s\S]{0,200}readLocal\(\)/.test(rj),
        "pendingLocal 拿本机那一份去比服务端那份（方向不能反）");
      chk(/function mergeLocal[\s\S]{0,900}return out\.slice/.test(rj) &&
          !/function mergeLocal[\s\S]{0,900}writeLocal\(out\)/.test(rj),
        "mergeLocal **不落回本机** —— 落回去的话本机那几条看起来就都「送达了」");
    }

    const api = read("js/account-api.js");
    chk(/function report\(/.test(api) && /function myReports\(/.test(api), "account-api 有 report / myReports");
    chk(/function adminReports\(/.test(api) && /function adminReportPatch\(/.test(api), "account-api 有 adminReports / adminReportPatch");

    ["report", "myReports", "adminReports", "adminReportPatch"].forEach(n => {
      chk(new RegExp("\\b" + n + ":\\s*" + n + "\\b").test(api),
        "account-api 的 bind() **挂上了** " + n + "（定义了没挂 = 运行时 is not a function）");
      chk(api.indexOf("boundOnce(o)." + n) >= 0, "account-api 顶层转发了 " + n);
    });

    const AccountApi = require("../js/account-api.js");
    chk(AccountApi && typeof AccountApi.adminReports === "function", "AccountApi.adminReports 真的可调（不是 undefined）");
    chk(typeof AccountApi.report === "function" && typeof AccountApi.myReports === "function", "AccountApi.report / myReports 真的可调");
    chk(typeof AccountApi.adminReportPatch === "function", "AccountApi.adminReportPatch 真的可调");
    const auth = read("js/auth-api.js");
    chk(/report: function/.test(auth), "auth-api 有 report");
    chk(/myReports: function/.test(auth), "auth-api 有 myReports");
    chk(/adminReports: function/.test(auth), "auth-api 有 adminReports");
    chk(/adminReportPatch: function/.test(auth), "auth-api 有 adminReportPatch");
  }

  {

    const rj = read("js/report.js");
    chk(/reason: "guest"/.test(rj), "report.js 认得 guest 这一档");
    chk(/去登录/.test(rj), "未登录时给出「去登录」这条路");
    chk(/signedIn\(\)/.test(rj), "发之前先看登录状态（不让人白填一遍）");
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
  console.log("八、弹层的长相必须**自带**（Issue #229）");

  {
    const read0 = f => fs.readFileSync(path.join(ROOT, f), "utf8");
    const CSS = read0("css/style.css").replace(/\/\*[\s\S]*?\*\//g, " ");
    const RJ = read0("js/report.js");

    ["account-field", "account-label", "account-input", "account-hint", "account-msg"]
      .forEach(cls => {
        const re = new RegExp("(?:^|\\n)[ \\t]*\\.report-modal[^{,]*\\." + cls + "\\b[^{]*\\{", "m");
        chk(re.test(CSS),
          ".report-modal 自带 ." + cls + " 的规则（不靠账页那张样式表）");
      });

    const NEED_ACCOUNT = ["poems", "settings/reports", "settings/lists"];
    const NO_ACCOUNT = ["classic", "tangshi", "songci", "guwen", "zhaoming",
      "yuanqu", "library", "search"];
    NO_ACCOUNT.forEach(p => {
      const s = read0(p + "/index.html");
      chk(/js\/report\.js/.test(s) || /reader-core\.js/.test(s),
        p + "/ 会用到这张弹层（加载 report.js 或阅读器引擎）");
      chk(!/css\/account\.css/.test(s),
        p + "/ **不**加载 css/account.css —— 所以弹层的长相不许指望它");
    });
    NEED_ACCOUNT.forEach(p => {
      chk(/css\/account\.css/.test(read0(p + "/index.html")),
        p + "/ 加载了 css/account.css（这一条是上一条守卫的对照组）");
    });
  }

  {

    const CSS = read("css/style.css").replace(/\/\*[\s\S]*?\*\//g, " ");
    const RJ = read("js/report.js");
    const kinds = [...CSS.matchAll(/(?:^|\n)[ \t]*(\.report-kinds(?: button)?(?:\.active)?)[^{]*\{([^}]*)\}/g)]
      .map(m => ({ sel: m[1].trim(), body: m[2] }));
    const base = kinds.filter(k => k.sel === ".report-kinds button").map(k => k.body).join(";");
    chk(kinds.length >= 3, "css/style.css 里有 .report-kinds 一族规则（实际 " + kinds.length + " 条）");

    const fs_ = (base.match(/font-size:\s*([0-9.]+)px/) || [])[1];
    chk(Number(fs_) > 0 && Number(fs_) <= 12.5,
      ".report-kinds button 的字号收到 ≤12.5px（实际 " + fs_ + "px）");

    const pad = (base.match(/padding:\s*([0-9.]+)px\s+([0-9.]+)px/) || []);
    chk(pad.length === 3 && Number(pad[1]) <= 10 && Number(pad[2]) === 10,
      "上下 ≤10px、左右 = 10px（+2px 已加，实际 " + (pad[0] || "没写") + "）");

    chk(/white-space:\s*nowrap/.test(base), "每一颗**不许折行**（「正文」被拆成两行就不是一颗按钮了）");
    chk(/flex:\s*none/.test(base), "不参与拉伸（六颗挤在一行时那六份 flex:1 会互相压）");

    const gap = (CSS.match(/(?:^|\n)[ \t]*\.report-kinds\s*\{([^}]*)\}/) || [])[1] || "";
    chk(/gap:\s*6px/.test(gap), ".report-kinds 的间距是 6px（原先 8px，六颗就是多出来的 10px）");

    chk(/@media\s*\(max-width:\s*360px\)[\s\S]{0,400}?\.report-kinds button\s*\{[^}]*padding:\s*6px 7px/.test(CSS),
      "≤360px 有专门的窄屏档（内边距与间距一起收，同样 +2px → 7px，320px 机上六颗仍是一行）");

    chk(/role="group" aria-label="报哪一类问题"/.test(RJ),
      "六颗用 role=\"group\"（它们是可切换的单选，不是一组动作按钮；radiogroup 会让读屏找不存在的子项）");
    chk(/aria-pressed=/.test(RJ), "每一颗带 aria-pressed（读屏据此念「已选中 / 未选中」）");
    chk(!/role="radiogroup"/.test(RJ), "不再用 radiogroup");
  }

  console.log("");
  console.log("八之二、两格输入框**等长等宽、都是两行高**，提示语是有礼的例句（Issue #229 续）");

  {
    const CSS2 = read("css/style.css").replace(/\/\*[\s\S]*?\*\//g, " ");
    const RJ2 = read("js/report.js");

    const noteTag = (RJ2.match(/<textarea id="report-note"[^>]*rows="(\d+)"/) || []);
    const suggTag = (RJ2.match(/<textarea id="report-suggestion"[^>]*rows="(\d+)"/) || []);
    chk(/class="account-input report-textarea" rows="2"/.test(RJ2),
      "「哪里不对」是 textarea rows=2（原先 3 行）");
    chk(/class="account-input report-textarea" rows="2"/.test(RJ2),
      "「应该是什么」也是 textarea rows=2（原先是一枚 220px 的单行 input）");
    chk(noteTag[1] === "2" && suggTag[1] === "2",
      "两格 rows 都是 2（实际 " + noteTag[1] + " / " + suggTag[1] + "）");
    chk(!/<input id="report-suggestion"/.test(RJ2),
      "「应该是什么」不再是一枚 <input>（元素已与上面那格统一）");

    const ta = (CSS2.match(/\.report-modal \.report-textarea\s*\{([^}]*)\}/) || [])[1] || "";
    const mh = (ta.match(/min-height:\s*([0-9.]+)px/) || [])[1];

    chk(Number(mh) >= 73 && Number(mh) <= 74,
      "两格共用的 min-height 是两行实高（实际 " + (mh || "没写") + "px；行高 1.65 × 15px × 2 + 24）");
    chk(/line-height:\s*1\.65/.test(ta), "行高与正文那一档同源（1.65）");

    chk(!/max-width:\s*220px/.test(CSS2),
      "旧的「input.account-input { max-width: 220px }」已撤（否则两格又不一样宽）");
    chk(/\.report-modal textarea\.account-input\s*\{\s*max-width:\s*none/.test(CSS2),
      "textarea.account-input 明确不吃宽度上限（满行）");

    chk(/placeholder="例：应读 cháng，或写作「明月光」"/.test(RJ2),
      "「应该是什么」的提示语是「例：…」这一档的例句（与「哪里不对」的写法一致）");
    chk(!/想好了就填，没想到就空着/.test(RJ2),
      "那句随意的「想好了就填，没想到就空着」已经一个字都不留");
    chk(/placeholder="例：「长」这里该读 cháng，不是 zhǎng"/.test(RJ2),
      "「哪里不对」的提示语照旧（例：…，没被动过）");
  }

  console.log("");
  console.log(fails ? ("✗ report.test.js：" + fails + " 条不通过") : "✓ report.test.js 全通过");
  process.exit(fails ? 1 : 0);
})();
