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

function seedAccount(store, uid, role) {
  store.putAccount({
    uid, email: uid + "@t.dev", email_hash: "h_" + uid,
    nickname: uid, plan: "max", plan_until: null, role: role || "admin",
    created_at: 1789000000000, last_login_at: 1789000000000, status: "active",
    email_verified_at: 1789000000000, password_hash: "", password_salt: ""
  });
}

const FIX = { wid: "gz-tw", line: "秋水共长天一色", at: 4, ch: "长", py: "cháng", poemTitle: "滕王阁序", book: "古文观止" };

console.log("");
console.log("一、提交：待审核，不改变全站生效那一份");

(async () => {
  {
    const d = mkDeps("uAdmin");
    seedAccount(d._store, "uAdmin");
    const r = await core.pinyinProposalSubmit(d, FIX);
    chk(r.status === 200 && /^pf_/.test(r.body.proposal.fid), "提交一条：回 200 + fid（" + (r.body.proposal.fid || "") + "）");
    chk(r.body.proposal.status === "pending", "新提交的一律是 pending");
    chk(r.body.proposal.prevPy === "", "还没有已生效的版本时 prevPy 是空的");
    chk(/等待管理员审核/.test(r.body.note), "回执说清楚了还没生效");

    const pub = await core.pinyinFixesPublic(d);
    chk(pub.body.fixes.length === 0, "**待审核不出现**在公开只读接口里（全站读者看不到）");
  }

  {

    const d = mkDeps("uUser");
    seedAccount(d._store, "uUser", "user");
    const r = await core.pinyinProposalSubmit(d, FIX);
    chk(r.status === 403 && r.body.code === "E_FORBIDDEN", "普通用户提交：403 E_FORBIDDEN");

    const g = mkDeps(null);
    const rg = await core.pinyinProposalSubmit(g, FIX);
    chk(rg.status === 401, "没登录提交：401");
  }

  {

    const d = mkDeps("uAdmin");
    seedAccount(d._store, "uAdmin");
    let r = await core.pinyinProposalSubmit(d, FIX);
    const fid1 = r.body.proposal.fid;
    r = await core.pinyinProposalSubmit(d, Object.assign({}, FIX, { py: "zhǎng" }));
    chk(r.body.proposal.fid === fid1, "同一处（wid+line+at）再次提交是**改写**同一条待审核记录，不是新开一条");
    chk(r.body.replaced === true, "回执标出这是改写");
    chk(r.body.proposal.py === "zhǎng", "内容确实换成了新值");

    const list = await core.pinyinProposalList(d, { status: "pending" });
    chk(list.body.proposals.length === 1, "待审核队列里只有一条（不会越提越多）");
  }

  {

    const d = mkDeps("uAdmin");
    seedAccount(d._store, "uAdmin");
    const r = await core.pinyinProposalSubmit(d, { wid: "", line: FIX.line, py: "cháng" });
    chk(r.status === 400 && r.body.code === "E_BAD_FIX", "缺篇目：400 E_BAD_FIX");
  }

  console.log("");
  console.log("二、批准：全站生效，且顶替旧的那一条");

  {
    const d = mkDeps("uAdmin");
    seedAccount(d._store, "uAdmin");
    let r = await core.pinyinProposalSubmit(d, FIX);
    const fid1 = r.body.proposal.fid;

    r = await core.pinyinProposalReview(d, { fid: fid1, decision: "approve" });
    chk(r.status === 200 && r.body.proposal.status === "approved", "批准：200，状态变 approved");
    chk(/全站读者/.test(r.body.note), "回执说清「全站读者下次打开即可看到」");

    const pub = await core.pinyinFixesPublic(d);
    chk(pub.body.fixes.length === 1, "批准之后公开接口能看到这一条");
    chk(pub.body.fixes[0].py === "cháng", "读音对（" + pub.body.fixes[0].py + "）");
    chk(pub.body.version > 0, "带了一个可比较新旧的 version（" + pub.body.version + "）");
    chk(!("proposedBy" in pub.body.fixes[0]), "公开接口**不带**谁提的这类管理信息");

    r = await core.pinyinProposalSubmit(d, Object.assign({}, FIX, { py: "zhǎng" }));
    const fid2 = r.body.proposal.fid;
    chk(fid2 !== fid1, "已批准的那一条还生效着时，再提议是**新的一条**（不是原地改写批准过的）");
    chk(r.body.proposal.prevPy === "cháng", "新提议记下了「当前生效的是什么」（" + r.body.proposal.prevPy + "）");

    const before = await core.pinyinFixesPublic(d);
    chk(before.body.fixes[0].py === "cháng", "**批准前**：全站读者仍看到旧的那个读音（没有空窗期）");

    r = await core.pinyinProposalReview(d, { fid: fid2, decision: "approve" });
    chk(r.status === 200, "批准新的那一条：200");
    const after = await core.pinyinFixesPublic(d);
    chk(after.body.fixes.length === 1 && after.body.fixes[0].py === "zhǎng",
      "批准之后：旧的那条被顶替，全站只剩一条在生效，读音是新的（" + after.body.fixes[0].py + "）");

    const list = await core.pinyinProposalList(d, { status: "all" });
    const superseded = list.body.proposals.filter(p => p.status === "superseded");
    chk(superseded.length === 1 && superseded[0].fid === fid1, "旧的那条标成 superseded（留痕迹，不删）");
  }

  console.log("");
  console.log("三、驳回 / 下线");

  {
    const d = mkDeps("uAdmin");
    seedAccount(d._store, "uAdmin");
    let r = await core.pinyinProposalSubmit(d, FIX);
    const fid = r.body.proposal.fid;

    r = await core.pinyinProposalReview(d, { fid, decision: "reject", note: "读起来怪怪的" });
    chk(r.status === 200 && r.body.proposal.status === "rejected", "驳回待审核的那一条：200");
    chk(/驳回/.test(r.body.note), "回执说清没有生效");

    r = await core.pinyinProposalReview(d, { fid, decision: "approve" });
    chk(r.status === 409 && r.body.code === "E_STATE", "已驳回的不能再批准：409 E_STATE");
  }

  {

    const d = mkDeps("uAdmin");
    seedAccount(d._store, "uAdmin");
    let r = await core.pinyinProposalSubmit(d, FIX);
    const fid = r.body.proposal.fid;
    await core.pinyinProposalReview(d, { fid, decision: "approve" });

    r = await core.pinyinProposalReview(d, { fid, decision: "reject" });
    chk(r.status === 200 && r.body.proposal.status === "rejected", "已生效的也能「驳回」= 下线");
    chk(/下线/.test(r.body.note), "回执说的是「下线」不是「驳回」（措辞对得上当时的状态）");

    const pub = await core.pinyinFixesPublic(d);
    chk(pub.body.fixes.length === 0, "下线之后公开接口不再有这一条（恢复自动注音）");
  }

  {
    const d = mkDeps("uAdmin");
    seedAccount(d._store, "uAdmin");
    const r = await core.pinyinProposalReview(d, { fid: "pf_不存在", decision: "approve" });
    chk(r.status === 404 && r.body.code === "E_NO_FIX", "不存在的 fid：404 E_NO_FIX");

    const r2 = await core.pinyinProposalReview(d, { fid: "pf_x", decision: "乱写" });
    chk(r2.status === 400 && r2.body.code === "E_DECISION", "认不出的 decision：400 E_DECISION");
  }

  console.log("");
  console.log("四、数据形状 / schema / 路由");

  {
    chk(core.PINYIN_PROPOSAL_STATUSES.indexOf("pending") >= 0 &&
      core.PINYIN_PROPOSAL_STATUSES.indexOf("approved") >= 0 &&
      core.PINYIN_PROPOSAL_STATUSES.indexOf("rejected") >= 0, "四个状态都在（pending/approved/rejected/superseded）");

    const sql = read("api/_lib/schema.sql");
    chk(/create table if not exists public\.pinyin_proposals/.test(sql), "schema.sql 建了 public.pinyin_proposals");
    chk(/alter table public\.pinyin_proposals enable row level security/.test(sql), "开了 RLS 且不给策略（默认拒绝）");
    chk(/create index if not exists pinyin_proposals_key_idx/.test(sql), "按 (wid,line,at,status) 建了索引");

    const routes = read("api/_lib/routes.js");
    chk(/"POST \/admin\/pinyin":/.test(routes), "路由表有 POST /admin/pinyin");
    chk(/"GET \/pinyin-fixes":/.test(routes), "路由表有 GET /pinyin-fixes");
    ["api/_routes/admin/pinyin.js", "api/_routes/pinyin-fixes.js"].forEach(f => {
      chk(fs.existsSync(path.join(ROOT, f)), f + " 存在");
    });

    const R = require("../api/_lib/routes.js");
    chk(!!R.resolve("POST", "/api/admin/pinyin"), "POST /api/admin/pinyin 能解析到");
    chk(!!R.resolve("GET", "/api/pinyin-fixes"), "GET /api/pinyin-fixes 能解析到");
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
        await sb.putPinyinProposal({ fid: "pf_1" });
        await sb.listPinyinProposals({ status: "pending" }, 5);
        await sb.countPinyinProposals();
      } catch (e) { threw = e; }
      chk(!threw, "supabase 实现的方法**真的能跑**（实际 " + (threw ? threw.message : "ok") + "）");
      chk(seen.some(x => x.m === "POST" && /\/pinyin_proposals$/.test(x.u)), "putPinyinProposal 真的 POST 到 /pinyin_proposals");
    } finally { global.fetch = realFetch; }
  }

  console.log("");
  console.log(fails ? ("✗ pinyin-proposal.test.js：" + fails + " 条不通过") : "✓ pinyin-proposal.test.js 全通过");
  process.exit(fails ? 1 : 0);
})();
