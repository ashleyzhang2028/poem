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

const DEV_A = "d_aaaaaaaa";
const DEV_B = "d_bbbbbbbb";

function mkDeps(uid, opts) {
  const o = opts || {};
  const store = o.store || storeMod.memoryStore();
  return {
    cfg: o.cfg || CONFIG,
    store,
    limiter: o.limiter || core.makeRateLimiter(),
    now: () => (typeof o.now === "function" ? o.now() : 1789000000000),
    account: uid ? { uid, sid: "s_" + uid } : null,
    ip: "1.2.3.4",
    deviceId: o.deviceId === undefined ? "unknown" : o.deviceId,
    _store: store
  };
}

function seedAccount(store, uid, opts) {
  const o = opts || {};
  store.putAccount({
    uid, email: uid + "@t.dev", email_hash: "h_" + uid,
    nickname: o.nickname || uid, plan: "max", plan_until: null, role: o.role || "admin",
    created_at: 1789000000000, last_login_at: 1789000000000, status: "active",
    email_verified_at: 1789000000000, password_hash: "", password_salt: ""
  });
}

console.log("");
console.log("一、创建：登录用户 / 设备号访客 / 拒绝没身份的那些");

(async () => {
  const store = storeMod.memoryStore();

  {
    const d = mkDeps("u1", { store });
    seedAccount(store, "u1", { role: "user" });
    const r = await core.feedbackCreate(d, { kind: "feature", content: "希望能有夜间模式" });
    chk(r.status === 200 && /^fb_/.test(r.body.thread.tid), "登录用户发一条：200 + tid（" + (r.body.thread.tid || "") + "）");
    chk(r.body.thread.status === "open", "新发的状态是 open");
    chk(r.body.thread.comments.length === 0, "刚发时还没有跟帖");
  }

  {
    const d = mkDeps(null, { store, deviceId: DEV_A });
    const r = await core.feedbackCreate(d, { kind: "problem", content: "搜索有点慢", deviceId: DEV_A });
    chk(r.status === 200, "没登录、但带着合规设备号：也能发（" + JSON.stringify(r.body.thread && r.body.thread.tid) + "）");
  }

  {
    const d = mkDeps(null, { store, deviceId: "unknown" });
    const r = await core.feedbackCreate(d, { kind: "other", content: "test" });
    chk(r.status === 400 && r.body.code === "E_NO_IDENTITY",
      "没登录、也没有合规设备号（http.js 的占位值 unknown）：拒收，不悄悄记成同一个人");
  }

  {
    const d = mkDeps(null, { store, deviceId: "d_ZZZZZZZZ" }); // 大写不合规（形状要求小写十六进制）
    const r = await core.feedbackCreate(d, { kind: "other", content: "test" });
    chk(r.status === 400 && r.body.code === "E_NO_IDENTITY", "设备号形状不对（非小写十六进制）：同样拒收");
  }

  {
    const d = mkDeps("u1", { store });
    seedAccount(store, "u1", { role: "user" });
    const r = await core.feedbackCreate(d, { kind: "other", content: "" });
    chk(r.status === 400 && r.body.code === "E_EMPTY", "空内容：400 E_EMPTY");
  }

  console.log("");
  console.log("二、只看得到自己的（登录按 uid，访客按设备号，互相看不到）");

  {
    const dA = mkDeps(null, { store, deviceId: DEV_A });
    const dB = mkDeps(null, { store, deviceId: DEV_B });
    await core.feedbackCreate(dA, { kind: "other", content: "A 设备发的", deviceId: DEV_A });
    await core.feedbackCreate(dB, { kind: "other", content: "B 设备发的", deviceId: DEV_B });

    const rA = await core.feedbackMine(dA, { deviceId: DEV_A });
    chk(rA.body.threads.every(t => /A 设备发的|夜间模式|搜索有点慢/.test(t.content) === true || true), "先占位");
    chk(rA.body.threads.some(t => t.content === "A 设备发的"), "A 设备看得到自己发的那一条");
    chk(!rA.body.threads.some(t => t.content === "B 设备发的"), "A 设备看不到 B 设备发的那一条");

    const dU2 = mkDeps("u2", { store });
    seedAccount(store, "u2", { role: "user" });
    const rU2 = await core.feedbackMine(dU2, {});
    chk(!rU2.body.threads.some(t => t.content === "A 设备发的"), "登录用户看不到访客发的（身份类型不同，不会串号）");
  }

  {
    const d = mkDeps(null, { store, deviceId: "unknown" });
    const r = await core.feedbackMine(d, {});
    chk(r.status === 200 && r.body.threads.length === 0 && r.body.noIdentity === true,
      "没有可用身份时「我的反馈」如实回空列表（不是报错，也不是假装有）");
  }

  console.log("");
  console.log("三、跟帖：只能跟自己的串，管理员回复对方看得到");

  let tidShared = "";
  {
    const dA = mkDeps(null, { store, deviceId: DEV_A });
    const r = await core.feedbackCreate(dA, { kind: "feature", content: "能不能加个打印功能", deviceId: DEV_A });
    tidShared = r.body.thread.tid;

    const rC = await core.feedbackComment(dA, { tid: tidShared, content: "补充一下，最好能打印带拼音的版本", deviceId: DEV_A });
    chk(rC.status === 200 && /^fc_/.test(rC.body.comment.cid), "本人追加跟帖：200");

    const dB = mkDeps(null, { store, deviceId: DEV_B });
    const rForbid = await core.feedbackComment(dB, { tid: tidShared, content: "我也想要", deviceId: DEV_B });
    chk(rForbid.status === 404 && rForbid.body.code === "E_NO_THREAD",
      "别的设备想跟别人的帖：404（不暴露「这条存在但不是你的」，避免枚举）");

    const dAdmin = mkDeps("uAdmin", { store });
    seedAccount(store, "uAdmin", { role: "owner" });
    const rReply = await core.adminFeedbackReply(dAdmin, { tid: tidShared, content: "已经在做了，下个版本上" });
    chk(rReply.status === 200 && rReply.body.comment.role === "admin", "管理员回复：200，角色标 admin");
    chk(rReply.body.status === "replied", "回复后状态自动变 replied");

    const mineAfter = await core.feedbackMine(dA, { deviceId: DEV_A });
    const thread = mineAfter.body.threads.find(t => t.tid === tidShared);
    chk(!!thread, "本人再看自己这一条还在");
    chk(thread.status === "replied", "本人这边也看到状态变成了 replied");
    chk(thread.comments.some(c => c.role === "admin" && c.content === "已经在做了，下个版本上"),
      "本人看得到管理员的回复内容");

    const rReopen = await core.feedbackComment(dA, { tid: tidShared, content: "谢谢，等着啦", deviceId: DEV_A });
    chk(rReopen.status === 200, "本人再追一句：200");
    const mine2 = await core.feedbackMine(dA, { deviceId: DEV_A });
    chk(mine2.body.threads.find(t => t.tid === tidShared).status === "open",
      "用户追问后状态自动回到 open（提醒管理员再看一眼）");
  }

  console.log("");
  console.log("四、删除：自己能删自己的（含正文本身），删不掉管理员回的；管理员什么都能删");

  {
    const dA = mkDeps(null, { store, deviceId: DEV_A });
    const rSelfDel = await core.feedbackDelete(dA, { tid: tidShared, deviceId: DEV_A });
    chk(rSelfDel.status === 200 && rSelfDel.body.deleted === "thread", "本人删掉整条：200（连带跟帖一起没了）");

    const mineAfterDel = await core.feedbackMine(dA, { deviceId: DEV_A });
    chk(!mineAfterDel.body.threads.some(t => t.tid === tidShared), "删完之后这一条真的不见了");
  }

  {
    const dA = mkDeps(null, { store, deviceId: DEV_A });
    const created = await core.feedbackCreate(dA, { kind: "other", content: "另开一条", deviceId: DEV_A });
    const tid = created.body.thread.tid;

    const dAdmin = mkDeps("uAdmin", { store });
    seedAccount(store, "uAdmin", { role: "owner" });
    const reply = await core.adminFeedbackReply(dAdmin, { tid, content: "收到" });
    const adminCid = reply.body.comment.cid;

    const rDelAdminComment = await core.feedbackDelete(dA, { cid: adminCid, deviceId: DEV_A });
    chk(rDelAdminComment.status === 404 && rDelAdminComment.body.code === "E_NO_COMMENT",
      "普通用户删不掉管理员回的那条评论（404，不是悄悄失败）");

    const rAdminDelComment = await core.adminFeedbackDeleteComment(dAdmin, { cid: adminCid });
    chk(rAdminDelComment.status === 200, "管理员自己能删掉这条评论：200");

    const dU = mkDeps("uX", { store });
    seedAccount(store, "uX", { role: "user" });
    const other = await core.feedbackCreate(dU, { kind: "other", content: "另一个用户发的" });
    const rAdminDelThread = await core.adminFeedbackDeleteThread(dAdmin, { tid: other.body.thread.tid });
    chk(rAdminDelThread.status === 200, "管理员能删掉别人整条反馈：200（含跟帖一起没）");

    const rUserForbid = await core.adminFeedbackDeleteThread(dU, { tid });
    chk(rUserForbid.status === 403 && rUserForbid.body.code === "E_FORBIDDEN", "普通用户调管理端删除接口：403");
  }

  console.log("");
  console.log("四之二、有进展提醒的水位线（与 report.js 同一种做法）");

  {
    const vm = require("vm");
    const fakeStore = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); } };
    const sb = { window: {}, document: { addEventListener() {} }, navigator: {}, console };
    sb.window = sb;
    sb.localStorage = fakeStore;
    vm.createContext(sb);
    vm.runInContext(read("js/feedback.js"), sb, { filename: "feedback.js" });
    const F = sb.window.Feedback;

    chk(F.seenAt() === 0, "还没检查过：水位线是 0");
    let pend = F.pendingUpdates([{ tid: "t1", status: "replied", updatedAt: 100 }]);
    chk(pend.length === 0, "第一次调用只打基线，不当场弹旧反馈");
    chk(F.seenAt() === 100, "基线设到当时最新的那个时刻（" + F.seenAt() + "）");

    pend = F.pendingUpdates([
      { tid: "t1", status: "replied", updatedAt: 100 },
      { tid: "t2", status: "open", updatedAt: 200 },
      { tid: "t3", status: "closed", updatedAt: 300 }
    ]);
    chk(pend.length === 1 && pend[0].tid === "t3", "只有「时间更新 + 状态不是 open」那一条算数（实际 " + pend.map(x => x.tid) + "）");

    F.markSeen(300);
    pend = F.pendingUpdates([{ tid: "t3", status: "closed", updatedAt: 300 }]);
    chk(pend.length === 0, "标记看过之后同一条不再算数");
  }

  console.log("");
  console.log("五、管理端列表 / 状态机 / 权限闸");

  {
    const d = mkDeps("uAdmin", { store });
    seedAccount(store, "uAdmin", { role: "owner" });
    const r = await core.adminFeedbackList(d, { status: "all" });
    chk(r.status === 200, "管理员读全站列表：200");
    chk(Array.isArray(r.body.threads), "回一个数组");
    chk(r.body.threads.every(t => typeof t.email !== "undefined"), "管理端看得到邮箱字段（普通用户那份没有）");

    const dU = mkDeps("uPlain", { store });
    seedAccount(store, "uPlain", { role: "user" });
    const rForbid = await core.adminFeedbackList(dU, {});
    chk(rForbid.status === 403 && rForbid.body.code === "E_FORBIDDEN", "普通用户读管理端列表：403");

    const rStatusBad = await core.adminFeedbackStatus(d, { tid: "fb_不存在", status: "closed" });
    chk(rStatusBad.status === 404 && rStatusBad.body.code === "E_NO_THREAD", "改不存在的 tid 状态：404");

    const rStatusBadValue = await core.adminFeedbackStatus(d, { tid: "fb_x", status: "乱写" });
    chk(rStatusBadValue.status === 400 && rStatusBadValue.body.code === "E_STATUS", "认不出的状态：400");
  }

  console.log("");
  console.log("六、界面接入：入口 / 页面 / 离线缓存都带上了");

  {
    const fbJs = read("js/feedback.js");
    const nums = (fbJs.match(/LIMITS = \{ content: (\d+), comment: (\d+) \}/) || []);
    chk(!!nums[1] && Number(nums[1]) === core.FEEDBACK_LIMITS.content, "js/feedback.js 的 content 上界与服务端一致（" + nums[1] + "）");
    chk(!!nums[2] && Number(nums[2]) === core.FEEDBACK_LIMITS.comment, "js/feedback.js 的 comment 上界与服务端一致（" + nums[2] + "）");
    const kinds = (fbJs.match(/key: "([a-z]+)"/g) || []).map(x => x.replace(/.*"([a-z]+)"/, "$1"));
    chk(JSON.stringify(kinds) === JSON.stringify(core.FEEDBACK_KINDS), "js/feedback.js 的三档与服务端逐字一致：" + kinds.join(","));

    const mineHtml = read("mine/index.html");
    chk(/href="\/settings\/feedback\/"/.test(mineHtml), "「我的」→「更多」里有这一条入口");

    chk(fs.existsSync(path.join(ROOT, "settings/feedback/index.html")), "settings/feedback/index.html 存在");
    const pageHtml = read("settings/feedback/index.html");
    chk(/js\/feedback\.js/.test(pageHtml) && /js\/feedback-page\.js/.test(pageHtml), "反馈页带上了数据层与页面层两个脚本");

    const adminNav = read("admin/index.html");
    chk(/href="\/admin\/feedback\.html"/.test(adminNav), "管理后台导航里有「意见反馈」这一条入口");
    const adminHtml = read("admin/feedback.html");
    chk(/id="feedback-card"/.test(adminHtml), "管理后台的意见反馈页有反馈卡片");
    chk(/js\/feedback\.js/.test(adminHtml), "管理后台的意见反馈页也带上了 js/feedback.js（读标签用）");

    const swSrc = read("sw.js");
    chk(/\.\/js\/feedback\.js/.test(swSrc) && /\.\/js\/feedback-page\.js/.test(swSrc) && /\.\/settings\/feedback\//.test(swSrc),
      "新脚本与新页面进了 SW 预缓存清单（离线也能看自己发过的）");
    const ver = parseInt((swSrc.match(/poem-app-v(\d+)/) || [0, "0"])[1], 10);
    chk(ver >= 281, "缓存版本号已往上推（实际 v" + ver + "）");
  }

  console.log("");
  console.log("七、数据形状 / schema / 路由");

  {
    chk(core.FEEDBACK_KINDS.join(",") === "feature,problem,other", "三档写死且稳定：" + core.FEEDBACK_KINDS.join(","));
    chk(core.FEEDBACK_STATUSES.join(",") === "open,replied,closed", "三态写死且稳定：" + core.FEEDBACK_STATUSES.join(","));

    const sql = read("api/_lib/schema.sql");
    chk(/create table if not exists public\.feedback_threads/.test(sql), "schema.sql 建了 public.feedback_threads");
    chk(/create table if not exists public\.feedback_comments/.test(sql), "schema.sql 建了 public.feedback_comments");
    chk(/alter table public\.feedback_threads enable row level security/.test(sql), "串表开了 RLS 且不给策略");
    chk(/alter table public\.feedback_comments enable row level security/.test(sql), "楼层表开了 RLS 且不给策略");
    chk(/references public\.feedback_threads\(tid\) on delete cascade/.test(sql), "楼层跟着串一起删（数据库级联，不必服务端手动清）");

    const routes = read("api/_lib/routes.js");
    chk(/"GET \/feedback":/.test(routes), "路由表有 GET /feedback");
    chk(/"POST \/feedback":/.test(routes), "路由表有 POST /feedback");
    chk(/"POST \/admin\/feedback":/.test(routes), "路由表有 POST /admin/feedback");
    ["api/_routes/feedback/index.js", "api/_routes/admin/feedback.js"].forEach(f => {
      chk(fs.existsSync(path.join(ROOT, f)), f + " 存在");
    });
    const R = require("../api/_lib/routes.js");
    chk(!!R.resolve("GET", "/api/feedback"), "GET /api/feedback 能解析到");
    chk(!!R.resolve("POST", "/api/feedback"), "POST /api/feedback 能解析到");
    chk(!!R.resolve("POST", "/api/admin/feedback"), "POST /api/admin/feedback 能解析到");
  }

  {

    const realFetch = global.fetch;
    const seen = [];
    global.fetch = async (u, o) => {
      seen.push({ u: String(u), m: (o && o.method) || "GET" });
      return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => [], text: async () => "[]" };
    };
    try {
      const sb = require("../api/_lib/store.js").supabaseStore({ supabaseUrl: "https://x.supabase.co", supabaseServiceKey: "k" });
      let threw = null;
      try {
        await sb.putFeedbackThread({ tid: "fb_1" });
        await sb.listFeedbackThreads({ uid: "u 1" }, 5);
        await sb.putFeedbackComment({ cid: "fc_1", tid: "fb_1" });
        await sb.listFeedbackComments({ tids: ["fb_1", "fb_2"] }, 5);
        await sb.deleteFeedbackThread("fb_1");
      } catch (e) { threw = e; }
      chk(!threw, "supabase 实现的方法**真的能跑**（实际 " + (threw ? threw.message : "ok") + "）");
      chk(seen.some(x => x.m === "POST" && /\/feedback_threads$/.test(x.u)), "putFeedbackThread 真的 POST 到 /feedback_threads");
      chk(seen.some(x => /tid=in\.\(fb_1,fb_2\)/.test(x.u)), "多个 tid 用 in.() 一次查（不是循环单条查）");
    } finally { global.fetch = realFetch; }
  }

  console.log("");
  console.log(fails ? ("✗ feedback.test.js：" + fails + " 条不通过") : "✓ feedback.test.js 全通过");
  process.exit(fails ? 1 : 0);
})();
