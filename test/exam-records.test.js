"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

let fails = 0;
const chk = (c, m) => { if (!c) { console.log("✗ " + m); fails++; } else console.log("✓ " + m); };
const eq = (a, b, m) => chk(a === b, m + "（实际 " + JSON.stringify(a) + "）");

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-secret-at-least-16-chars";
process.env.MAIL_TRANSPORT = process.env.MAIL_TRANSPORT || "console";

const core = require("../api/_lib/core.js");
const storeMod = require("../api/_lib/store.js");
const CONFIG = require("../api/_lib/config.js");

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
    deviceId: "unknown"
  };
}

function seedAccount(store, uid, plan) {
  store.putAccount({
    uid, email: uid + "@t.dev", email_hash: "h_" + uid,
    nickname: uid, plan: plan || "max", plan_until: null, role: "user",
    created_at: 1789000000000, last_login_at: 1789000000000, status: "active",
    email_verified_at: 1789000000000, password_hash: "", password_salt: ""
  });
}

const PAPER = {
  scopeId: "poems:primary", scopeLabel: "小学（119 条）",
  size: 3, score: 2, total: 3, durationSec: 245,
  items: [
    { stem: "床前明月光", picked: "疑是地上霜", answer: "疑是地上霜", correct: true },
    { stem: "两个黄鹂鸣翠柳", picked: "一行白鹭上青天", answer: "一行白鹭上青天", correct: true },
    { stem: "锄禾日当午", picked: "汗滴禾下土", answer: "谁知盘中餐", correct: false }
  ]
};

console.log("");
console.log("一、只有登录 + Max 才能写考试记录");

(async () => {
  {
    const d = mkDeps(null);
    const r = await core.examRecordCreate(d, PAPER);
    chk(r.status === 401 && r.body.code === "E_NO_SESSION", "没登录：401 E_NO_SESSION");
  }

  {
    const store = storeMod.memoryStore();
    seedAccount(store, "u1", "pro");
    const d = mkDeps("u1", { store });
    const r = await core.examRecordCreate(d, PAPER);
    chk(r.status === 403 && r.body.code === "E_TIER", "登录但只是 Pro：403 E_TIER（考试要 Max）");
  }

  {
    const store = storeMod.memoryStore();
    seedAccount(store, "u1", "max");
    const d = mkDeps("u1", { store });
    const r = await core.examRecordCreate(d, { scopeId: "all", scopeLabel: "全部", size: 0, score: 0, total: 0, items: [] });
    chk(r.status === 400 && r.body.code === "E_EMPTY", "题量为 0：400 E_EMPTY（没有卷面就不存）");
  }

  console.log("");
  console.log("二、Max 登录：写一条 → 能拉出来 → 逐题详情齐全");

  const store = storeMod.memoryStore();
  seedAccount(store, "u1", "max");
  seedAccount(store, "u2", "max");
  const d1 = mkDeps("u1", { store });
  const d2 = mkDeps("u2", { store });

  let eid1 = "";
  {
    const r = await core.examRecordCreate(d1, PAPER);
    chk(r.status === 200 && /^er_/.test(r.body.record.eid), "写成功：200 + eid（" + (r.body.record && r.body.record.eid) + "）");
    eq(r.body.record.score, 2, "score 落库对");
    eq(r.body.record.total, 3, "total 落库对");
    eq(r.body.record.scopeLabel, "小学（119 条）", "scopeLabel 落库对");
    chk(r.body.record.items.length === 3, "逐题详情三条一条不少");
    chk(r.body.record.items[2].correct === false, "答错的那一题 correct=false（不是悄悄改成 true）");
    eid1 = r.body.record.eid;
  }

  {
    const r = await core.examRecordsMine(d1, {});
    chk(r.status === 200 && r.body.records.length === 1, "u1 的历史里有这一条");
    eq(r.body.records[0].eid, eid1, "就是刚写的那一条");
  }

  {
    const r = await core.examRecordsMine(d2, {});
    chk(r.status === 200 && r.body.records.length === 0, "u2 看不到 u1 的记录（按账号隔离）");
  }

  console.log("");
  console.log("三、删除：只有本人能删，删掉的确实少一条");

  {
    const r = await core.examRecordDelete(d2, { eid: eid1 });
    chk(r.status === 404, "u2 删 u1 的记录：404（不是别人的想删就删）");
  }

  {
    const r = await core.examRecordDelete(d1, { eid: eid1 });
    chk(r.status === 200 && r.body.deleted === eid1, "u1 删自己的记录：成功");
  }

  {
    const r = await core.examRecordsMine(d1, {});
    eq(r.body.records.length, 0, "删完之后历史里 0 条");
  }

  {
    const r = await core.examRecordDelete(d1, { eid: eid1 });
    chk(r.status === 404, "再删一次同一条：404（不是假装成功）");
  }

  console.log("");
  console.log("四、字段截断：过长的 items 与 scopeLabel 不会原样落库");

  {
    const longItems = [];
    for (let i = 0; i < 90; i++) longItems.push({ stem: "题" + i, picked: "x", answer: "y", correct: false });
    const r = await core.examRecordCreate(d1, {
      scopeId: "all", scopeLabel: "x".repeat(200), size: 90, score: 0, total: 90, items: longItems
    });
    chk(r.status === 200, "90 题的卷子也能存");
    chk(r.body.record.items.length <= 60, "逐题详情截到上限（实际 " + r.body.record.items.length + "）");
    chk(r.body.record.scopeLabel.length <= 40, "范围名截到 40 字（实际 " + r.body.record.scopeLabel.length + "）");
  }

  console.log("");
  console.log("五、前端接线：js/game.js 交卷时把「考试」推上云，模拟考试不推");

  const gameSrc = read("js/game.js");
  chk(/AccountApi\.examRecordCreate/.test(gameSrc), "submit() 里调用了 AccountApi.examRecordCreate");
  chk(/state\.mode === "formal" && window\.AccountApi/.test(gameSrc), "只在 state.mode === \"formal\"（考试）时才推，模拟考试不推");
  chk(/data-game-history/.test(gameSrc), "首页有「我的考试历史」入口");
  chk(/AccountApi\.examRecordDelete/.test(gameSrc), "历史页里能删除单条记录");

  const routesSrc = read("api/_lib/routes.js");
  chk(/GET \/exam\/records/.test(routesSrc) && /POST \/exam\/records/.test(routesSrc),
    "路由表登记了 GET/POST /exam/records");

  const schemaSrc = read("api/_lib/schema.sql");
  chk(/create table if not exists public\.exam_records/.test(schemaSrc), "schema.sql 里有 exam_records 建表语句");

  console.log("");
  console.log(fails ? ("❌ " + fails + " 条失败") : "🎉 考试历史（服务端存取）测试全部通过");
  process.exit(fails ? 1 : 0);
})();
