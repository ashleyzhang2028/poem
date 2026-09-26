"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

let fails = 0;
const chk = (c, m) => { if (!c) { console.log("✗ " + m); fails++; } else console.log("✓ " + m); };
const eq = (a, b, m) => chk(a === b, m + "（实际 " + JSON.stringify(a) + "）");

function bootServer(envVars) {
  const saved = {};
  const keys = ["SESSION_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "MAIL_TRANSPORT"];
  keys.forEach(k => { saved[k] = process.env[k]; });
  keys.forEach(k => { delete process.env[k]; });
  Object.assign(process.env, { SESSION_SECRET: "test-secret-at-least-16-chars", MAIL_TRANSPORT: "console", ...envVars });
  Object.keys(require.cache).forEach(k => {
    if (k.startsWith(path.join(ROOT, "api"))) delete require.cache[k];
  });
  return {
    restore: () => { keys.forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); }
  };
}

function serverDeps(store, extra) {
  const cfg = require("../api/_lib/config.js");
  return Object.assign({
    cfg,
    store,
    limiter: require("../api/_lib/core.js").makeRateLimiter(),
    now: () => 1700000000000,
    ip: "1.1.1.1",
    deviceId: "d_test",
    account: { uid: "u_1", sid: "s_1" }
  }, extra || {});
}

function memStore(init) {
  const m = Object.assign({}, init || {});
  return {
    getItem: k => (Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: k => { delete m[k]; },
    raw: () => m
  };
}

function device(plate) {
  const backing = memStore(plate);
  delete require.cache[require.resolve(path.join(ROOT, "js/family.js"))];
  delete require.cache[require.resolve(path.join(ROOT, "js/progress-store.js"))];
  delete require.cache[require.resolve(path.join(ROOT, "js/sync-store.js"))];
  const prev = global.window;
  global.window = global;

  const Fam = require(path.join(ROOT, "js/family.js"));
  global.Family = Fam;

  delete require.cache[require.resolve(path.join(ROOT, "js/progress-store.js"))];
  require(path.join(ROOT, "js/progress-store.js"));
  const PS = global.ProgressStore;
  PS.useStore(backing);
  const Sync = require(path.join(ROOT, "js/sync-store.js"));
  const calls = [];
  let clock = 1700000000000;
  Sync.use({
    ProgressStore: PS,
    base: "/api",
    deviceId: "d_a",
    signedIn: () => true,
    now: () => clock,
    fetch: null
  });
  const api = {
    Sync, PS, backing, calls,
    F: Fam,
    tick(ms) { clock += (ms === undefined ? 1000 : ms); return clock; },
    setNet(fn) {
      Sync.use({
        ProgressStore: PS, base: "/api", deviceId: "d_a", signedIn: () => true, now: () => clock,
        fetch: (url, init) => {
          const body = init.body ? JSON.parse(init.body) : null;
          calls.push({ url, body });
          return fn(url, body);
        }
      });
      return api;
    },
    restoreWindow() { global.window = prev; }
  };
  return api;
}

function jsonRes(status, payload) {
  return { status, text: () => Promise.resolve(payload === undefined ? "" : JSON.stringify(payload)) };
}

async function main() {

  console.log("\n=== 一、空串 = 第一个孩子那一份（与 family.js 的无后缀老键同源） ===");
  {
    const env = bootServer({});
    try {
      const core = require("../api/_lib/core.js");
      eq(core.childId(undefined), "", "不传 child → 空串（老客户端的请求落在第一个孩子那一档）");
      eq(core.childId(null), "", "null → 空串");
      eq(core.childId(""), "", "空串还是空串");
      eq(core.childId("   "), "", "只有空白 → 空串");
      eq(core.childId("f-abc_123"), "f-abc_123", "正常的子用户 id 原样通过");
      eq(core.childId("a".repeat(64)), "a".repeat(64), "64 字上限之内通过");
      eq(core.childId("a".repeat(65)), "", "超过 64 字 → 空串（不是报错、也不是截断）");
      eq(core.childId("f-abc'; drop--"), "", "带引号的脏值 → 空串（它进 PostgREST 查询串，必须收窄）");
      eq(core.childId("孩子一号"), "", "非 ASCII 也落回空串（id 是客户端生成的随机串，不是名字）");

      const store = require("../api/_lib/store.js").memoryStore();
      await store.putProgress("u_1", "", [{ poem_id: "p1", payload: { level: 1 }, updated_at: 100 }]);
      await store.putProgress("u_1", "f-a", [{ poem_id: "p1", payload: { level: 9 }, updated_at: 100 }]);
      eq(store.listProgress("u_1", "", 0).length, 1, "账号那一档只有 1 条");
      eq(store.listProgress("u_1", "", 0)[0].payload.level, 1, "账号那一档读到的 level 是 1");
      eq(store.listProgress("u_1", "f-a", 0)[0].payload.level, 9, "子用户那一档读到的 level 是 9（同名篇目互不干扰）");
      eq(store.listProgress("u_2", "", 0).length, 0, "另一个账号读不到（uid 仍是第一道过滤）");
    } finally { env.restore(); }
  }

  console.log("\n=== 二、A 孩子的进度不能被 B 孩子拉到（服务端） ===");
  {
    const env = bootServer({});
    try {
      const core = require("../api/_lib/core.js");
      const store = require("../api/_lib/store.js").memoryStore();
      const d = serverDeps(store);

      await store.putAccount({ uid: "u_1", email_hash: "h", email: "a@qq.com", nickname: "", plan: "pro", plan_until: null, role: "user", created_at: 1, last_login_at: 1, status: "active" });

      await core.syncPush(d, { recs: [{ id: "p1", payload: { level: 5 }, updatedAt: 100 }], child: "f-ming" });
      await core.syncPush(d, { recs: [{ id: "p1", payload: { level: 2 }, updatedAt: 100 }], child: "f-hong" });

      const a = await core.syncPull(d, { since: 0, child: "f-ming" });
      const b = await core.syncPull(d, { since: 0, child: "f-hong" });
      const z = await core.syncPull(d, { since: 0 });

      eq(a.body.recs.length, 1, "小明那一份只有 1 条");
      eq(a.body.recs[0].payload.level, 5, "小明看到的是自己的 level 5");
      eq(b.body.recs[0].payload.level, 2, "小红看到的是自己的 level 2");
      eq(a.body.child, "f-ming", "回包里带上 child（客户端据此判「拉回来的是谁的」）");
      eq(z.body.recs.length, 0, "不传 child = 账号那一档，两个孩子的进度一条都不在里面");

      eq(store.listProgress("u_1", "f-ming", 0)[0].payload.level, 5, "落库分开：小明那一行");
      eq(store.listProgress("u_1", "f-hong", 0)[0].payload.level, 2, "落库分开：小红那一行");

      await core.syncPush(d, { recs: [{ id: "p1", payload: { level: 1 }, updatedAt: 50 }], child: "f-ming" });
      eq(store.listProgress("u_1", "f-ming", 0)[0].payload.level, 5, "小明那一桶：老时间戳盖不掉新值");
      await core.syncPush(d, { recs: [{ id: "p1", payload: { level: 7 }, updatedAt: 200 }], child: "f-ming" });
      eq(store.listProgress("u_1", "f-ming", 0)[0].payload.level, 7, "小明那一桶：新时间戳能盖掉老值");
      eq(store.listProgress("u_1", "f-hong", 0)[0].payload.level, 2, "推小明**不会**动到小红（桶是分开的）");

      const since = await core.syncPull(d, { since: 150, child: "f-ming" });
      eq(since.body.recs.length, 1, "since 之后只剩那条新的（游标与桶一起用）");
      eq(since.body.recs[0].id, "p1", "游标过滤后仍是 p1");
    } finally { env.restore(); }
  }

  console.log("\n=== 三、名册（family:v1）落在账号那一档 ===");
  {
    const env = bootServer({});
    try {
      const core = require("../api/_lib/core.js");
      const store = require("../api/_lib/store.js").memoryStore();
      const d = serverDeps(store);

      await store.putAccount({ uid: "u_1", email_hash: "h", email: "a@qq.com", nickname: "", plan: "pro", plan_until: null, role: "user", created_at: 1, last_login_at: 1, status: "active" });

      const empty = await core.familyGet(d);
      eq(empty.status, 200, "没有名册时回 200（不是 404 —— 那是「对方还没同步过名册」）");
      eq(empty.body.family.profiles.length, 0, "回的是一份空名册");
      eq(empty.body.updatedAt, 0, "updatedAt 为 0（表示服务端还没有这一份）");

      const pushed = await core.familyPut(d, {
        family: {
          v: 1, at: "f-ming",
          profiles: [
            { id: "f-ming", nickname: "小明", avatar: { img: "https://x.supabase.co/a.jpg" }, createdAt: 100 },
            { id: "f-hong", nickname: "小红", avatar: { img: "" }, createdAt: 200 }
          ]
        }
      });
      eq(pushed.status, 200, "写名册成功");

      const acctRows = store.listProgress("u_1", "", 0);
      eq(acctRows.length, 1, "账号那一档正好 1 条（名册）");
      eq(acctRows[0].poem_id, "family:v1", "那条就是 family:v1");
      eq(store.listProgress("u_1", "f-ming", 0).length, 0, "小明那一档没有被名册污染");

      const got = await core.familyGet(d);
      eq(got.body.family.profiles.length, 2, "读回来是两个孩子");
      eq(got.body.family.profiles[0].nickname, "小明", "昵称保住了");
      eq(got.body.family.profiles[0].avatar.img, "https://x.supabase.co/a.jpg", "头像地址保住了");

      eq(got.body.family.profiles[0].avatar.char, undefined, "上一版的字不再进白名单（两边都画首字印）");
      eq(got.body.family.profiles[0].avatar.ink, undefined, "上一版的色不再进白名单");
      eq(got.body.family.profiles[1].avatar.img, "", "没传图的孩子地址是空串（回落首字印）");
      eq(got.body.family.at, "f-ming", "选中的那个也保住了");

      const viaPush = await core.syncPush(d, {
        child: "",
        recs: [{ id: "family:v1", payload: { v: 1, at: "f-hong", profiles: [{ id: "f-hong", nickname: "小红" }] }, updatedAt: 1700000009999 }]
      });
      eq(viaPush.status, 200, "名册也可以从 sync/push 那条路进来（老客户端只有那条路）");
      const after = await core.familyGet(d);
      eq(after.body.family.at, "f-hong", "从 push 进来的名册也读得到（两个入口同一处落库）");

      await core.syncPush(d, { child: "", recs: [{ id: "family:v1", payload: { v: 1, at: "f-old", profiles: [{ id: "f-old", nickname: "老" }] }, updatedAt: 100 }] });
      eq((await core.familyGet(d)).body.family.at, "f-hong", "名册也守「老时间戳盖不掉新值」");

      const legacy = await core.syncPush(d, { recs: [{ id: "family:v1", payload: { v: 1, at: "f-legacy", profiles: [{ id: "f-legacy", nickname: "旧" }] }, updatedAt: 1700000019999 }] });
      eq(legacy.status, 200, "不带 child 的请求落空串那一档（老客户端行为不变）");
      eq((await core.familyGet(d)).body.family.at, "f-legacy", "老客户端推的名册也读得到");

      const dirty = await core.familyPut(d, {
        family: { v: 1, at: "f-不在名册里", profiles: [{ id: "f-x", nickname: "x".repeat(50) }, { id: "" }, null, "字符串"] }
      });
      eq(dirty.status, 200, "脏名册不失败（少一个孩子比整份写坏强）");
      eq(dirty.body.family.profiles.length, 1, "只收下认得出的那一条");
      eq(dirty.body.family.profiles[0].nickname.length, 12, "昵称被截到 12 字（与客户端同一档）");
      eq(dirty.body.family.at, "f-x", "at 指向不在名册里的 id → 落回第一条（不然另一台设备切过去看到空进度）");
    } finally { env.restore(); }
  }

  console.log("\n=== 四、名册与进度共用同一把闸（Pro 起） ===");
  {
    const env = bootServer({});
    try {
      const core = require("../api/_lib/core.js");
      const store = require("../api/_lib/store.js").memoryStore();
      const d = serverDeps(store);

      await store.putAccount({ uid: "u_1", email_hash: "h", email: "a@qq.com", nickname: "", plan: "free", plan_until: null, role: "user", created_at: 1, last_login_at: 1, status: "active" });
      const r1 = await core.familyPut(d, { family: { v: 1, at: "f-a", profiles: [{ id: "f-a", nickname: "A" }] } });
      eq(r1.status, 403, "free 写名册回 403（与 sync/push 同一把闸）");
      eq(r1.body.code, "E_TIER", "码是 E_TIER（不是「连不上」——那会让人一直重试）");

      const r2 = await core.familyGet(d);
      eq(r2.status, 200, "**读**名册仍回 200（读不涉及上传，不占层级）");

      await store.patchAccount("u_1", { plan: "pro" });
      const r3 = await core.familyPut(d, { family: { v: 1, at: "f-a", profiles: [{ id: "f-a", nickname: "A" }] } });
      eq(r3.status, 200, "pro 写名册放行");

      const anon = await core.familyGet(serverDeps(store, { account: null }));
      eq(anon.status, 401, "没登录读名册回 401（与 403 分开：一个去登录、一个去找管理员）");
    } finally { env.restore(); }
  }

  console.log("\n=== 五、注销导出所有孩子 ===");
  {
    const env = bootServer({});
    try {
      const core = require("../api/_lib/core.js");
      const store = require("../api/_lib/store.js").memoryStore();
      const d = serverDeps(store);
      await store.putAccount({ uid: "u_1", email_hash: "h", email: "a@qq.com", nickname: "", plan: "pro", plan_until: null, role: "user", created_at: 1, last_login_at: 1, status: "active" });

      await store.putProgress("u_1", "", [{ poem_id: "family:v1", payload: { v: 1, at: "f-a", profiles: [{ id: "f-a", nickname: "A", createdAt: 1 }, { id: "f-b", nickname: "B", createdAt: 2 }] }, updated_at: 10 }]);
      await store.putProgress("u_1", "", [{ poem_id: "p1", payload: { level: 1 }, updated_at: 11 }]);
      await store.putProgress("u_1", "f-a", [{ poem_id: "p1", payload: { level: 5 }, updated_at: 12 }]);
      await store.putProgress("u_1", "f-b", [{ poem_id: "p2", payload: { level: 3 }, updated_at: 13 }]);

      const out = await core.accountDelete(d, { confirm: true });
      eq(out.status, 200, "注销成功");
      const recs = out.body.export.recs;
      const kids = {};
      recs.forEach(r => { kids[r.child || ""] = (kids[r.child || ""] || 0) + 1; });
      chk(kids["f-a"] === 1, "导出里有小明的那一条（child = f-a）");
      chk(kids["f-b"] === 1, "导出里有小红的那一条（child = f-b）—— 只导当前那个就是永久丢失");
      chk((kids[""] || 0) >= 2, "账号那一档（名册 + 账号级记录）也在导出里");
      eq(store.listProgress("u_1", "f-a", 0).length, 0, "删干净了：小明那一档");
      eq(store.listProgress("u_1", "f-b", 0).length, 0, "删干净了：小红那一档");
    } finally { env.restore(); }
  }

  console.log("\n=== 六、客户端：记账表按孩子分家 ===");
  {
    const A = device();
    try {
      const F = A.F;
      F.ensure({ backing: A.backing });
      const first = F.currentId({ backing: A.backing });
      const second = F.create("小红", { backing: A.backing });
      chk(second.ok, "建了第二个孩子");

      F.select(second.profile.id, { backing: A.backing });
      A.Sync.markSeen("p1", 1234);
      chk(!!A.backing.raw()["poem_sync_seen_v1::" + second.profile.id], "第二个孩子的记账落在带后缀那把键上");

      F.select(first, { backing: A.backing });
      eq(A.Sync.seen()["p1"], undefined, "切回第一个孩子：看不见小红的记账（表是分开的）");

      A.Sync.markSeen("p2", 5678);
      chk(!!A.backing.raw()["poem_sync_seen_v1::" + first], "第一个孩子的记账落在自己那把键上");

      chk("poem_sync_seen_v1::" + first !== "poem_sync_seen_v1::" + second.profile.id,
        "（对照）两个孩子的记账表键名确实不同");

      A.Sync.markSeen("p3", -1);
      eq(A.Sync.conflicts().join(","), "p3", "当前孩子的冲突清单只有自己那条");
      F.select(second.profile.id, { backing: A.backing });
      eq(A.Sync.conflicts().length, 0, "切到小红：她那边的冲突清单是空的（没串过来）");

      F.select(first, { backing: A.backing });
      A.Sync.markSeen("__cursor__", 999);
      F.select(second.profile.id, { backing: A.backing });
      eq(A.Sync.seen()["__cursor__"], undefined, "游标也分家（拿着别人的游标会漏拉一整段）");
    } finally { A.restoreWindow(); }
  }

  console.log("\n=== 七、客户端：名册上云走账号那一档 ===");
  {
    const A = device({ poem_sync_pref_v1: JSON.stringify({ v: 1, enabled: true }) });
    try {
      const F = A.F;
      F.ensure({ backing: A.backing });
      F.create("小红", { backing: A.backing });

      const sent = [];
      A.setNet((url, body) => { sent.push({ url, body }); return Promise.resolve(jsonRes(200, { ok: true, applied: 1, child: body.child === undefined ? "" : body.child, serverTime: 1 })); });

      await A.Sync.pushPending();
      const pushCalls = sent.filter(c => /sync\/push/.test(c.url));
      chk(pushCalls.length >= 1, "推了一轮");
      const regCall = pushCalls.filter(c => (c.body.recs || []).some(r => r.id === "family:v1"));
      eq(regCall.length, 1, "名册**单独**一条推上去（不与进度混在同一批）");
      eq(regCall[0].body.child, "", "名册走的是**账号那一档**（child = 空串）");
      eq(regCall[0].body.recs[0].payload.profiles.length, 2, "推上去的名册里有两个孩子");

      sent.length = 0;
      await A.Sync.pushPending();
      const again = sent.filter(c => (c.body.recs || []).some(r => r.id === "family:v1"));
      eq(again.length, 0, "名册内容没变时**不再推**（指纹相同 —— 否则每轮白传一次）");

      A.tick(5000);
      F.create("小刚", { backing: A.backing });
      sent.length = 0;
      await A.Sync.pushPending();
      const third = sent.filter(c => (c.body.recs || []).some(r => r.id === "family:v1"));
      eq(third.length, 1, "名册改了 → 再推一次");
      eq(third[0].body.recs[0].payload.profiles.length, 3, "推上去的是三个孩子");
    } finally { A.restoreWindow(); }
  }

  console.log("\n=== 八、云端名册落到本机 ===");
  {
    const A = device({ poem_sync_pref_v1: JSON.stringify({ v: 1, enabled: true }) });
    try {
      const F = A.F;

      F.ensure({ backing: A.backing });
      eq(F.list({ backing: A.backing }).length, 1, "本机只有一个孩子");

      const cloud = {
        v: 1, at: "f-cloud-b",
        profiles: [
          { id: "f-cloud-a", nickname: "云A", avatar: { img: "https://x.supabase.co/a.jpg" }, createdAt: 100 },
          { id: "f-cloud-b", nickname: "云B", avatar: { img: "" }, createdAt: 200 }
        ]
      };

      A.setNet((url, body) => Promise.resolve(jsonRes(200, {
        ok: true, child: body.child === undefined ? "" : body.child, serverTime: 300,
        recs: [{ id: "family:v1", payload: cloud, updatedAt: 250, deleted: false }]
      })));
      await A.Sync.pullOnce(0);
      const after = F.list({ backing: A.backing });
      eq(after.length, 2, "云端名册落到了本机（两个孩子）");
      eq(after[0].nickname, "云A", "昵称跟着落下来了");
      eq(F.currentId({ backing: A.backing }), "f-cloud-b", "选中的那个也跟着落下来了（at）");

      chk(!!A.backing.raw()["poem_family_v1"], "名册那一把键在");
    } finally { A.restoreWindow(); }
  }

  console.log("\n=== 八之二、内核不给恢复入口时不假装落上了 ===");
  {
    const A = device({ poem_sync_pref_v1: JSON.stringify({ v: 1, enabled: true }) });
    try {
      const F = A.F;
      F.ensure({ backing: A.backing });
      const realRestore = F.restore;

      delete F.restore;
      A.setNet((url, body) => Promise.resolve(jsonRes(200, {
        ok: true, child: body.child === undefined ? "" : body.child, serverTime: 300,
        recs: [{ id: "family:v1", payload: { v: 1, at: "f-x", profiles: [{ id: "f-x", nickname: "X", createdAt: 1 }] }, updatedAt: 250, deleted: false }]
      })));
      const SEEN = () => {
        const k = Object.keys(A.backing.raw()).filter(x => /^poem_sync_seen_v1/.test(x))[0];
        return k ? A.backing.raw()[k] : "";
      };
      await A.Sync.pullOnce(0);
      eq(SEEN().indexOf("family:v1"), -1, "内核没给恢复入口 → **不记「同步过了」的印**（下次还会再来一次）");
      F.restore = realRestore;
    } finally { A.restoreWindow(); }
  }

  console.log("\n=== 九、在途切档：拉回来的那一批丢掉，一个字都不落盘 ===");
  {
    const A = device({ poem_sync_pref_v1: JSON.stringify({ v: 1, enabled: true }) });
    try {
      const F = A.F;
      F.ensure({ backing: A.backing });
      const first = F.currentId({ backing: A.backing });
      const second = F.create("小红", { backing: A.backing });

      let resolvePull = null;
      A.setNet((url, body) => {
        if (/sync\/pull/.test(url)) {

        return new Promise(res => { resolvePull = () => res(jsonRes(200, { ok: true, child: "f-someone-else", serverTime: 300, recs: [{ id: "p9", payload: { level: 9 }, updatedAt: 250, deleted: false }] })); });
        }
        return Promise.resolve(jsonRes(200, { ok: true, applied: 0, serverTime: 300 }));
      });

      const p = A.Sync.pullOnce(0);

      F.select(second.profile.id, { backing: A.backing });
      resolvePull();
      const r = await p;
      eq(r.stale, true, "判成「过时的那一批」");
      eq(r.recs.length, 0, "一条都不回给调用方");
      eq(A.PS.get("p9"), null, "**一个字都没落盘**（落下去就写进小红那一份了）");
      F.select(first, { backing: A.backing });
    } finally { A.restoreWindow(); }
  }

  console.log("\n=== 十、源码口径 ===");
  {
    const core = read("api/_lib/core.js");
    const storeSrc = read("api/_lib/store.js");
    const schema = read("api/_lib/schema.sql");
    const sync = read("js/sync-store.js");
    const family = read("js/family.js");
    const endpoint = read("api/_routes/family/index.js");

    chk(/function childId\(/.test(core), "core 有唯一的 childId() 入口（收窄只在这一处）");
    chk(/function sanitizeFamily\(/.test(core), "名册有自己的一份白名单（不与进度共用）");
    chk(/poemId === "family:v1"/.test(core), "sanitizePayload 按 poem_id 分岔（那一行不是一篇诗）");
    chk(/FAMILY_ROW_ID = "family:v1"/.test(core) && /FAMILY_ROW_ID = "family:v1"/.test(sync),
      "family:v1 这个 id 两端逐字一致（写歪一处就永远对不上）");

    eq((storeSrc.match(/child_id/g) || []).length > 3, true, "两个 store 实现都带 child_id");
    chk(/child_id=eq\./.test(storeSrc), "supabase 实现按 child_id 过滤（漏了就是一个账号的孩子互相看得见）");
    eq((storeSrc.match(/child_id: cid/g) || []).length, 2,
      "两个实现写入时都带上 child_id（各一处，逐字一致）");

    chk(/add column if not exists child_id/.test(schema), "schema 的加列是幂等的（if not exists）");
    chk(/primary key \(uid, child_id, poem_id\)/.test(schema), "主键换成了三列");
    chk(/on conflict \(uid, child_id, poem_id\)/.test(schema), "条件 upsert 的 on conflict 与主键逐字一致");
    chk(/excluded\.updated_at >= public\.progress\.updated_at/.test(schema), "「老时间戳盖不掉新值」那条 where 仍在（换主键时最容易弄丢）");
    chk(/coalesce\(r->>'child_id', ''\)/.test(schema), "库里缺 child_id 时落空串（= 第一个孩子那一份），不是 NULL");

    chk(/function seenKey\(/.test(sync), "记账表跟着孩子走的拼法只有一处（seenKey）");
    chk(/familyRow\(\)/.test(sync) && /applyRemoteFamily\(/.test(sync), "名册的推与收各有专属入口（不混进进度那条路）");
    chk(/row\.id === FAMILY_ROW_ID/.test(sync), "applyPull 按 id 把名册分出来");
    chk(/id !== SIG_KEY && id !== FAMILY_ROW_ID/.test(sync), "冲突清单不许把记账标记与名册混进去");
    chk(/function restore\(/.test(family) && /restore: function/.test(family), "Family 给了唯一的第二个写入口 restore()");
    chk(/E_EMPTY/.test(family), "空名册不许把本机清空（回 E_EMPTY，什么都不动）");
    chk(/handler\.make\("family", \["GET", "POST"\]/.test(endpoint), "/api/family 一个文件收 GET 与 POST");
    chk(/hasSession/.test(endpoint), "/api/family 没配密钥时如实回 503（与其余接口同一条）");
  }

  console.log("");
  console.log(fails === 0 ? "🎉 跨设备分档案测试全部通过" : "❌ 跨设备分档案测试 " + fails + " 项失败");
  process.exit(fails ? 1 : 0);
}

main().catch(e => {
  console.error("测试自身抛异常（这通常是环境问题，不是被测代码）：", e);
  process.exit(1);
});
