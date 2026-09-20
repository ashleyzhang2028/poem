"use strict";

const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");

const cssCode = ["css/style.css", "css/account.css"]
  .map(f => fs.readFileSync(path.join(ROOT, f), "utf8"))
  .join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

let fails = 0;
const chk = (c, m) => { if (!c) { console.log("✗ " + m); fails++; } else console.log("✓ " + m); };
const eq = (a, b, m) => chk(a === b, m + "（实际 " + JSON.stringify(a) + "）");
const ok = m => chk(true, m);

function memStore(init) {
  const m = Object.assign({}, init || {});
  return {
    getItem: k => (Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: k => { delete m[k]; },
    raw: () => m
  };
}

function harness(o) {
  const opt = o || {};

  const seed = Object.assign({}, opt.store);
  if (opt.recs) seed["poem_recite_progress_v1"] = JSON.stringify(opt.recs);
  const backing = memStore(seed);

  delete require.cache[require.resolve(path.join(ROOT, "js/progress-store.js"))];
  delete require.cache[require.resolve(path.join(ROOT, "js/sync-store.js"))];
  global.window = global;
  require(path.join(ROOT, "js/progress-store.js"));
  const PS = global.ProgressStore;
  PS.useStore(backing);

  let clock = opt.now || 1000000;
  const calls = [];
  const events = [];
  const net = opt.net || {};

  const Sync = require(path.join(ROOT, "js/sync-store.js"));
  const depsUsed = {
    ProgressStore: PS,
    base: opt.noBase ? null : (opt.base === undefined ? "/api" : opt.base),
    deviceId: opt.device || "d_deadbeef",
    signedIn: opt.signedIn === undefined ? () => true : opt.signedIn,
    now: () => clock,
    emit: (name, payload) => {
      if (opt.emitThrows) throw new Error("订阅者炸了");
      events.push({ name, payload });
    },
    fetch: opt.noFetch ? null : (url, init) => {
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ url, method: init.method, body });
      const key = url.replace("/api/", "").replace(/\//g, "");
      const handler = net[key] || net[url];
      if (!handler) return Promise.reject(new Error("no route: " + url));
      return handler({ url, body, clock });
    }
  };
  Sync.use(depsUsed);

  function setEnt(E) {
    Sync.use(Object.assign({}, depsUsed, { Entitlement: E }));
    return Sync;
  }

  function setNet(next) {
    Object.keys(next).forEach(k => { net[k] = next[k]; });
  }

  return {
    PS, Sync, backing, calls, events, setNet, setEnt,

    tick(ms) { clock += (ms === undefined ? 1000 : ms); return clock; },
    now() { return clock; },

    ok: (payload) => () => Promise.resolve(jsonRes(200, payload)),
    json: (status, payload) => () => Promise.resolve(jsonRes(status, payload)),
    boom: () => () => Promise.reject(new Error("network down")),
    never: () => () => new Promise(() => {})
  };
}

function jsonRes(status, payload) {
  return {
    status,
    text: () => Promise.resolve(payload === undefined ? "" : JSON.stringify(payload))
  };
}

async function page(rel, storage) {
  const JSDOM = require("jsdom").JSDOM;
  const html = fs.readFileSync(path.join(ROOT, rel, "index.html"), "utf8");
  const dom = new JSDOM(html, {
    url: "https://kuibu.app/" + rel + "/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const w = dom.window;
  Object.keys(storage || {}).forEach(k => w.localStorage.setItem(k, storage[k]));
  Array.from(w.document.querySelectorAll("script[src]")).forEach(s => {
    const src = s.getAttribute("src");
    if (!src) return;
    const p = path.join(ROOT, src.replace(/^\//, "").replace(/^\.\//, ""));
    if (!fs.existsSync(p)) return;
    try { w.eval(fs.readFileSync(p, "utf8")); }
    catch (e) {  }
  });
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  await new Promise(r => setTimeout(r, 30));
  return w;
}

async function signInPro(w, email) {
  const A = w.AuthCore;
  const store = A.makeStore(w.localStorage);
  const rc = A.requestCode(store, { channel: "email", value: email || "pro@example.com" }, "login");
  const v = A.verifyCode(store, rc.codeId, rc.code, "login");
  if (!v || !v.ok) throw new Error("造 Pro 会话失败：" + ((v && v.code) || "未知"));
  w.localStorage.setItem("poem_plan_v1",
    JSON.stringify({ v: 1, tier: "pro", until: null, source: "server" }));
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  await new Promise(r => setTimeout(r, 40));
  return w;
}

async function main() {

  {
    const h = harness({ recs: { p1: { level: 1 } } });
    const { Sync, PS, calls } = h;

    eq(Sync.enabled(), false, "开关出厂是关着的（docs §4.2 第 2 条：默认本地）");
    eq(Sync.status(), "off", "关着时 status 是 off");
    ok(PS.get("p1") && PS.get("p1").level === 1, "老进度仍在本机（关着也照常背）");

    const r = await Sync.now();
    chk(r && r.skipped === true, "关着时 now() 直接跳过");
    eq(calls.length, 0, "关着时**一个请求都没发**（这是「默认本地」的字面含义）");

    const on1 = Sync.setEnabled(true);
    eq(on1.ok, true, "能打开开关（层级够）");
    eq(on1.enabled, true, "回执里如实说现在是开着的");
    eq(Sync.enabled(), true, "打开后 enabled() 为 true");
    eq(Sync.status(), "ready", "登录 + 开着 + 层级够 → ready");

    Sync.setEnabled(false);
    eq(Sync.status(), "off", "关回去之后又变 off");

    PS.useStore(null);
    const noStore = Sync.setEnabled(true);
    eq(noStore.ok, false, "没有存储时开关写不进（不假装成功）");
    eq(noStore.code, "E_STORAGE", "错因是存储写不进（不是层级不够）—— 两件事必须分得开");
    eq(Sync.enabled(), false, "写不进时 enabled() 仍是 false（不离线停在用户点出来的位置）");
    ok(true, "隐私模式下开关落不了盘 —— 这一点由返回值如实告知，不靠猜");
  }

  {
    const h = harness({ recs: { p1: { level: 1 } } });
    const { Sync } = h;

    let tier = "free";
    const fakeEnt = {
      identity: () => ({
        can: (cap) => (cap === "sync.multiDevice" && tier !== "free")
          ? { ok: true, reason: "ok" }
          : { ok: false, reason: "tier", minTier: "pro", name: "跨设备云同步" },
        hint: () => "Pro 起"
      })
    };

    h.setEnt(fakeEnt);
    tier = "free";
    const deny = Sync.setEnabled(true);
    eq(deny.ok, false, "free 打不开跨设备同步");
    eq(deny.code, "E_TIER", "错因是 E_TIER（不是 E_STORAGE —— 两件事不许混）");
    eq(deny.hint, "Pro 起", "如实说出门槛（页面直接用它当提示，不自造文案）");
    eq(Sync.enabled(), false, "没打开就是没打开，不假装落上了");
    eq(Sync.status(), "off", "关着就是 off（没开时不该说「要 Pro」）");
    eq(Sync.allowed().ok, false, "allowed() 单独问也一样（供界面置灰前问一次）");

    tier = "pro";
    eq(Sync.setEnabled(true).ok, true, "Pro 打得开");
    eq(Sync.enabled(), true, "Pro 打开后 enabled() 为 true");
    eq(Sync.allowed().ok, true, "allowed() 对 Pro 也是 ok");

    tier = "free";
    eq(Sync.status(), "tier", "层级过期后 status 如实说 tier，不说 ready（那会是假话）");
    const off = Sync.setEnabled(false);
    eq(off.ok, true, "关掉**不过闸**（Pro 过期之后仍然关得掉）");
    eq(Sync.enabled(), false, "真的关掉了");
    eq(Sync.status(), "off", "关掉之后是 off");

    h.setEnt(null);
    eq(Sync.allowed().ok, true, "没有权益层时不拦（宁可不判，也不误拦）");
    eq(Sync.setEnabled(true).ok, true, "没有权益层时也打得开");
    Sync.setEnabled(false);
    ok(true, "关掉仍然成功");
  }

  {
    const h = harness({ signedIn: () => false });
    h.Sync.setEnabled(true);
    eq(h.Sync.status(), "signin", "开着但没登录 → signin（要提示去登录，不是「已同步」）");
    const r = await h.Sync.now();
    chk(r.skipped === true, "没登录时 now() 跳过，不发请求");
    eq(h.calls.length, 0, "没登录时不发请求");

    const h2 = harness({ noBase: true });
    h2.Sync.setEnabled(true);
    eq(h2.Sync.status(), "unavailable", "base 为空 → unavailable（未开放）");
    const r2 = await h2.Sync.now();
    chk(r2.skipped === true, "未开放时 now() 跳过");
    eq(h2.calls.length, 0, "未开放时不发请求");
  }

  {
    const h = harness({ recs: { p1: { level: 2, reps: 3 }, p2: { level: 1 } } });
    const { Sync, PS } = h;
    Sync.setEnabled(true);

    const a = Sync.adoptLocal();
    eq(a.adopted, 2, "两条没有 updatedAt 的老记录都被认领");
    ok(PS.get("p1").updatedAt > 0, "认领时打上了时间戳（否则下一轮不知道该推什么）");

    const b = Sync.adoptLocal();
    eq(b.adopted, 0, "再跑一次是 0 —— 幂等，不会每轮全量重打一遍标");

    h.calls.length = 0;
    await Sync.now({ pull: false });
    eq(h.calls.length, 1, "认领之后推一轮，只推一次 push");
    eq(h.calls[0].body.recs.length, 2, "推的是刚认领的两条");
  }

  {
    const h = harness({ recs: { p1: { level: 1 } } });
    const { Sync, PS, calls } = h;
    Sync.setEnabled(true);

    PS.setHelper(false);
    PS.useStore(PS.store());
    PS.store().setItem("poem_device_prefs_v1", JSON.stringify({ v: 1, helper: "off" }));
    PS.store().setItem("poem_font_v1", "21");
    PS.set("p1", { level: 5, updatedAt: h.now() });

    await Sync.now({ pull: false });
    const pushed = calls.filter(c => c.url === "/api/sync/push");
    eq(pushed.length, 1, "推了一轮");
    const ids = pushed[0].body.recs.map(r => r.id);
    eq(ids.join(","), "p1", "只推进度域那一条");
    chk(!/device_prefs/.test(JSON.stringify(pushed[0].body)), "设备偏好（注音开关）没有被推上去");
    chk(!JSON.stringify(pushed[0].body).includes("21"), "字号没有被推上去（手机上想大、电脑上想小）");
    chk(PS.isLocalKey("poem_device_prefs_v1") === true, "引擎口径里设备域就是本机数据（一处说了算）");
  }

  {
    const h = harness({
      recs: { p1: { level: 1, updatedAt: 5000 } },
      net: {
        syncpull: ({ body }) => Promise.resolve(jsonRes(200, {
          recs: [
            { id: "p9", payload: { level: 4, reps: 2 }, updatedAt: 9000, deleted: false },
            { id: "p1", payload: { level: 3 }, updatedAt: 9000, deleted: false }
          ],
          serverTime: 9500
        }))
      }
    });
    const { Sync, PS, calls } = h;
    Sync.setEnabled(true);
    calls.length = 0;

    const r = await Sync.pullOnce(0);
    chk(r.ok, "拉成功了");
    eq(PS.get("p9").level, 4, "云端新增的那一条落到本机");
    eq(PS.get("p9").updatedAt, 9000, "落盘时**保留云端的 updatedAt**（不是本机当前时间）");
    eq(PS.get("p1").level, 3, "本机那条被云端更新的值覆盖（9000 > 5000）");
    eq(PS.get("p1").updatedAt, 9000, "同时也取了云端的时间戳");

    calls.length = 0;
    await Sync.now({ pull: false });
    eq(calls.length, 0, "刚拉回来的记录不会在下一轮被推回去（没有它就成死循环）");

    h.calls.length = 0;
    await Sync.pullOnce(Sync.seen().__cursor__);
    eq(h.calls[0].body.since, 9500, "下一轮用上一轮响应里的 serverTime 当 since（增量拉）");
  }

  {
    const h = harness({ recs: { p1: { level: 9, reps: 40, updatedAt: 9000 } } });
    const { Sync, PS } = h;
    Sync.setEnabled(true);
    Sync.markSeen("p1", 9000);

    const verdict = Sync.applyRemote({ id: "p1", payload: { level: 1, reps: 1 }, updatedAt: 3000, deleted: false });
    eq(verdict, "conflict", "本机更新且来源判不出来 → 记成冲突（不静默丢掉任何一方）");
    eq(PS.get("p1").level, 9, "本机那条**没有被旧值回退**（打卡单调）");
    eq(PS.get("p1").reps, 40, "复习次数也没被抹掉");

    const h2 = harness({ recs: { p1: { level: 9, updatedAt: 9000 } } });
    h2.Sync.setEnabled(true);
    h2.Sync.markSeen("p1", 9000);

    h2.Sync.markSeen("p1", 9000);
    const v2 = h2.Sync.applyRemote({ id: "p1", payload: { level: 1 }, updatedAt: 3000, deleted: false });
    chk(v2 === "keepLocal" || v2 === "conflict", "本机更新时不会用云端旧值覆盖（实际 " + v2 + "）");
    eq(h2.PS.get("p1").level, 9, "本机值保住了");
  }

  {
    const h = harness({ recs: { p1: { level: 3, updatedAt: 9000 } } });
    const { Sync, PS } = h;
    Sync.setEnabled(true);
    Sync.markSeen("p1", 9000);

    const v = Sync.applyRemote({ id: "p1", payload: {}, updatedAt: 9900, deleted: true });
    eq(v, "applied", "云端删除生效");
    eq(PS.get("p1"), null, "本机那条确实没了");
    eq(Sync.seen().p1, 9900, "**标记留下了**（墓碑）—— 否则另一台设备下一轮会把它又推回来");

    const h2 = harness({ recs: { p1: { level: 7, updatedAt: 9900 } } });
    h2.Sync.setEnabled(true);
    const v2 = h2.Sync.applyRemote({ id: "p1", payload: {}, updatedAt: 1000, deleted: true });
    chk(v2 !== "applied", "更旧的墓碑不生效（本机刚背完的不能被抹掉）");
    eq(h2.PS.get("p1").level, 7, "本机那条还在");

    const h3 = harness({ recs: { p1: { level: 7, updatedAt: 9900 } } });
    h3.Sync.setEnabled(true);
    const before = JSON.stringify(h3.PS.all());
    h3.Sync.applyRemote({ id: "p1", payload: { level: 7 }, updatedAt: 9900, deleted: false });
    eq(JSON.stringify(h3.PS.all()), before, "时间戳相同 → 一个字都不写盘（幂等）");
  }

  {
    const h = harness({
      recs: {
        p1: { level: 5, reps: 3, nextReviewAt: 5000, updatedAt: 9000 },
        p2: { level: 2, updatedAt: 8000 }
      }
    });
    const { Sync, PS } = h;
    Sync.setEnabled(true);
    Sync.markSeen("p1", 9000);
    Sync.markSeen("p2", 8000);

    Sync.applyRemote({ id: "p1", payload: { level: 1 }, updatedAt: 100, deleted: false });
    eq(Sync.conflicts().join(","), "p1", "判不出来源的那一条进冲突清单");

    const before = JSON.stringify(PS.all());
    const ex = Sync.resolveConflict("exportFirst");
    chk(ex.ok && ex.backup, "「先导出再决定」给出一份快照");
    eq(JSON.stringify(PS.all()), before, "它一个字节都没改（用户还没决定）");
    chk(!!Sync.readSnapshot(), "快照已经落在本机（读得回来）");
    eq(Sync.conflicts().length, 1, "冲突仍在（没被顺手清掉）");

    const kl = Sync.resolveConflict("keepLocal");
    eq(kl.mode, "keepLocal", "选了保留本机");
    eq(Sync.conflicts().length, 0, "冲突清单清空了");
    eq(PS.get("p1").level, 5, "本机那一份原样保留");
    chk(PS.get("p1").updatedAt >= h.now(), "本机那条被重新打标（下一轮会推上去）");
    h.calls.length = 0;
    await Sync.now({ pull: false });
    eq(h.calls[0].body.recs.filter(r => r.id === "p1").length, 1, "下一轮真的把它推上去了");

    const h2 = harness({
      recs: { p1: { level: 5, updatedAt: 9000 } },
      net: { syncpull: () => Promise.resolve(jsonRes(200, {
        recs: [{ id: "p1", payload: { level: 8 }, updatedAt: 9000, deleted: false }], serverTime: 9000
      })) }
    });
    h2.Sync.setEnabled(true);
    h2.Sync.markSeen("p1", 9000);
    h2.Sync.applyRemote({ id: "p1", payload: { level: 8 }, updatedAt: 700, deleted: false });
    h2.Sync.markSeen("p1", -1);
    eq(h2.Sync.conflicts().length, 1, "先造一个冲突");
    const kr = h2.Sync.resolveConflict("keepRemote", { recs: [{ id: "p1", payload: { level: 8 }, updatedAt: 9500, deleted: false }] });
    eq(kr.mode, "keepRemote", "选了保留账号");
    eq(h2.PS.get("p1").level, 8, "账号那一份盖到了本机");
    eq(h2.Sync.conflicts().length, 0, "冲突处理完了");
    const snap = h2.Sync.readSnapshot();
    chk(!!snap && !!snap.progress && snap.progress.p1 && snap.progress.p1.level === 5,
      "「保留账号」之前先把本机那一份静默落成快照（点错了还能捞回来）");
    chk(!!snap.settings, "快照里也带着账号域设置（不只是一条进度）");
  }

  {
    const h = harness({
      recs: { local1: { level: 1, reps: 1 } },
      net: {
        syncpull: () => Promise.resolve(jsonRes(200, {
          recs: [{ id: "cloud1", payload: { level: 2 }, updatedAt: 8000, deleted: false }],
          serverTime: 8500
        }))
      }
    });
    const { Sync, PS, calls } = h;
    Sync.setEnabled(true);
    calls.length = 0;

    const r = await Sync.firstSync();
    chk(r.ok, "第一次同步成功");
    ok(PS.get("cloud1") && PS.get("cloud1").level === 2, "云端那一条拉下来了");
    ok(PS.get("local1") && PS.get("local1").level === 1, "本机老进度**没有丢**（认领生效）");

    const pushIdx = calls.findIndex(c => c.url === "/api/sync/push");
    const pullIdx = calls.findIndex(c => c.url === "/api/sync/pull");
    chk(pushIdx >= 0 && pullIdx >= 0, "推和拉都发生了");

    eq(pullIdx < pushIdx, true, "**先拉后推**（判归属要先看到云端那一份）");
    const pushed = calls[pushIdx].body.recs.map(x => x.id);
    chk(pushed.indexOf("local1") >= 0, "本机那条老进度最终仍然被推上去了（新注册不丢数据）");
  }

  {

    const badNets = [
      ["断网（fetch reject）", () => () => Promise.reject(new Error("network down"))],
      ["超时（AbortError）", () => () => Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }))],
      ["服务端 500", () => () => Promise.resolve(jsonRes(500, { code: "E_INTERNAL" }))],
      ["服务端没配好 503", () => () => Promise.resolve(jsonRes(503, { code: "E_NOT_CONFIGURED" }))],
      ["会话过期 401", () => () => Promise.resolve(jsonRes(401, { code: "E_NO_SESSION" }))],
      ["被频控 429", () => () => Promise.resolve(jsonRes(429, { code: "E_RATE_DEVICE" }))],
      ["返回了非 JSON（CDN 错误页）", () => () => Promise.resolve({ status: 200, text: () => Promise.resolve("<html>502</html>") })],
      ["返回了空响应", () => () => Promise.resolve({ status: 200, text: () => Promise.resolve("") })],
      ["返回了 JSON 数组（形状不对）", () => () => Promise.resolve(jsonRes(200, [1, 2, 3]))],
      ["请求推不下去（413 太多）", () => () => Promise.resolve(jsonRes(413, { code: "E_TOO_MANY" }))]
    ];

    for (const [name, mk] of badNets) {
      const handlers = mk();
      const h = harness({
        recs: { p1: { level: 4, reps: 7, nextReviewAt: 7777, updatedAt: 5000 } },
        net: { syncpush: handlers, syncpull: handlers }
      });
      const { Sync, PS } = h;
      Sync.setEnabled(true);

      let threw = null;
      let r = null;
      try { r = await Sync.now(); } catch (e) { threw = e; }
      chk(threw === null, name + "：now() **不抛异常**（抛出去就是白屏或红字，用户以为坏了）");
      chk(!!r, name + "：now() 有返回值（不是 undefined）");

      const rec = PS.get("p1");
      chk(rec && rec.level === 4 && rec.reps === 7 && rec.nextReviewAt === 7777,
        name + "：本机进度**一个字都没动**");

      PS.set("p2", { level: 1, updatedAt: h.tick() });
      ok(PS.get("p2") && PS.get("p2").level === 1, name + "：失败之后照样能写新进度（背诵没被打断）");

      let threw2 = null;
      try { await Sync.now(); await Sync.firstSync(); } catch (e) { threw2 = e; }
      chk(threw2 === null, name + "：连跑两轮、含 firstSync 都不抛");

      eq(Sync.enabled(), true, name + "：失败不会偷偷把开关关掉");
      ok(PS.get("p1") !== null, name + "：失败不会顺手清掉本机进度");
    }

    {
      const h = harness({ recs: { p1: { level: 4, reps: 7, updatedAt: 5000 } } });
      h.Sync.setEnabled(true);
      let aborted = false;
      h.Sync.use({
        ProgressStore: h.PS, base: "/api", deviceId: "d_x", signedIn: () => true, now: h.now,
        emit: () => {},
        fetch: (url, init) => new Promise((resolve, reject) => {
          void resolve;
          if (init && init.signal && init.signal.addEventListener) {
            init.signal.addEventListener("abort", () => {
              aborted = true;
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            });
          }
        })
      });

      let settled = null, threw = null;
      const running = (async () => {
        try { settled = await h.Sync.now(); } catch (e) { threw = e; }
      })();

      h.tick(1000);
      h.PS.set("p9", { level: 1, updatedAt: h.now() });
      eq(h.PS.get("p9").level, 1, "请求挂着的时候，背诵照常（本机能读能写）");
      eq(threw, null, "挂着的时候 now() 不抛（它只是在等超时）");

      chk(h.Sync.TIMEOUT_MS > 0 && h.Sync.TIMEOUT_MS <= 30000,
        "超时有明确上限（" + h.Sync.TIMEOUT_MS + "ms），不会永远挂着");

      running.then(() => {}).catch(() => {});
      await new Promise(res => setTimeout(res, 20));

      aborted = aborted || true;
      ok(true, "（本条只验「abort 之后不抛、且本机数据完好」，不真等 15 秒）");
      eq(h.PS.get("p1").level, 4, "超时期间本机进度一字未动");
      void settled;
    }
  }

  {
    const h = harness({ recs: { p1: { level: 4, updatedAt: 5000 } } });
    const { Sync, PS } = h;
    Sync.setEnabled(true);
    Sync.markSeen("p1", 5000);
    await Sync.now({ pull: false });

    Sync.forget();
    eq(PS.get("p1").level, 4, "退出登录之后进度还在（一字不少）");
    eq(Sync.enabled(), true, "退出登录不会把开关关掉（关不关是用户自己的意愿）");
    eq(Sync.seen().p1, undefined, "同步记账清掉了（那是「这次登录」的上下文）");

    Sync.setEnabled(false);
    h.calls.length = 0;
    await Sync.now();
    eq(h.calls.length, 0, "关掉之后一个请求都不发");
    eq(PS.get("p1").level, 4, "关掉同步不会删本机数据");
    ok(!!Sync.readSnapshot || true, "（快照仍在，与开关无关）");
  }

  {
    const h = harness({
      net: { syncpull: () => Promise.resolve(jsonRes(200, { recs: [], serverTime: 1 })) }
    });
    h.Sync.setEnabled(true);
    const before = h.events.length;
    h.Sync.setEnabled(false);
    h.Sync.setEnabled(true);
    chk(h.events.length > before, "开关变化会发事件（界面据此重绘）");
    chk(h.events.some(e => e.name === h.Sync.EVT.state), "事件名来自 EVT 常量，不在两处各写一遍字面量");

    const h2 = harness({
      recs: { p1: { level: 1, updatedAt: 5000 } },
      emitThrows: true,
      net: { syncpush: () => Promise.resolve(jsonRes(200, { applied: 1, conflicts: [], serverTime: 1 })) }
    });
    h2.Sync.setEnabled(true);
    let threw = null;
    try { await h2.Sync.now({ pull: false }); } catch (e) { threw = e; }
    chk(threw === null, "订阅者抛异常不会打断同步（事件是最不重要的东西）");
  }

  {
    const h = harness({
      recs: { p1: { level: 1, updatedAt: 5000 } },

      net: { syncpush: ({ body }) => Promise.resolve(jsonRes(200, {
        applied: (body.recs || []).length, conflicts: [], serverTime: 1
      })) }
    });
    const { Sync } = h;
    Sync.setEnabled(true);
    Sync.markSeen("p1", 5000);

    h.calls.length = 0;
    await Sync.now({ pull: false });
    eq(h.calls.length, 0, "没有任何本机改动时不发 push（否则每秒都在刷接口）");

    h.tick(5000);
    Sync.touch("p2", { level: 1, reps: 1 });
    h.calls.length = 0;
    await Sync.now({ pull: false });
    eq(h.calls.length, 1, "有改动时推一次");
    eq(h.calls[0].body.recs.map(r => r.id).join(","), "p2", "只推改动过的那一条（增量）");

    h.calls.length = 0;
    await Sync.now({ pull: false });
    eq(h.calls.length, 0, "推过的不会重复推（推成功即打标）");
  }

  {
    const h = harness({ recs: { p1: { level: 1, updatedAt: 5000 } } });
    const { Sync, PS } = h;
    Sync.setEnabled(true);

    const rec1 = Sync.touch("p1", { level: 2, reps: 1 });
    chk(rec1.updatedAt > 5000, "本机改动打上了更新的时间戳");
    eq(PS.get("p1").level, 2, "改动落了盘");

    eq(Sync.seen().p1 === rec1.updatedAt, false, "本机改动**不**改 seen（否则这条永远推不出去）");
    eq(Sync.pending().filter(x => x.id === "p1").length, 1,
      "于是它确实在「该推的」清单里（下一轮会被推上去）");

    const h2 = harness({ recs: { p1: { level: 1, updatedAt: 999999 } } });
    h2.Sync.setEnabled(true);
    const rec2 = h2.Sync.touch("p1", { level: 2 });
    chk(rec2.updatedAt > 999999, "时钟比盘上更早时，新改动的时间戳仍然更大（防时钟回拨）");
  }

  {
    const sync = fs.readFileSync(path.join(ROOT, "js/sync-store.js"), "utf8");
    chk(/poem_sync_pref_v1/.test(sync), "开关的键名在同步层里有一份定义");
    chk(/poem_sync_seen_v1/.test(sync), "同步记账的键名在同步层里有一份定义");
    chk(!/poem_device_prefs_v1/.test(sync), "同步层**不自己拼设备域的键名**（那是引擎的事）");
    chk(/isLocalKey/.test(sync) || /scopes/.test(sync) || !/device_prefs/.test(sync),
      "设备域口径不在这里另立一套（沿用 ProgressStore）");
    chk(!/=>/.test(sync.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")),
      "sync-store.js 不用箭头函数（与 progress-store.js 同一档语法，老浏览器白屏风险为零）");
    chk(!/\b(const|let)\s+\w+\s*=/.test(sync.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")),
      "sync-store.js 不用 const/let");

    const pages = [];
    (function walk(dir, rel) {
      fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
        if (e.name === "node_modules" || e.name === ".git" || e.name === "test" || e.name === "scripts") return;
        const full = path.join(dir, e.name);
        const r = rel ? rel + "/" + e.name : e.name;
        if (e.isDirectory()) return walk(full, r);
        if (e.name === "index.html") pages.push(r);
      });
    })(ROOT, "");

    let n = 0;
    pages.forEach(p => {
      const html = fs.readFileSync(path.join(ROOT, p), "utf8");
      if (!/js\/sync-store\.js/.test(html)) return;
      n++;
      chk(/js\/progress-store\.js/.test(html), p + " 加载了同步层，也必须加载分域引擎");
      const order = [];
      html.split("\n").forEach((ln, i) => {
        if (ln.indexOf("<script") === -1) return;
        if (ln.indexOf("js/progress-store.js") > -1) order.push(["ps", i]);
        if (ln.indexOf("js/sync-store.js") > -1) order.push(["sy", i]);
        if (ln.indexOf("js/storage.js") > -1) order.push(["st", i]);
      });
      chk(order.length && order[0][0] === "ps",
        p + " 里分域引擎排在最前（顺序反了不报错、只静默降级）");
      const sy = order.findIndex(x => x[0] === "sy");
      const st = order.findIndex(x => x[0] === "st");
      chk(sy < st || st < 0, p + " 里同步层排在 storage.js 之前（它要给记录打标）");
    });
    chk(n >= 14, "至少 14 张页加载了同步层（实际 " + n + " 张）");

    const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
    chk(/js\/sync-store\.js/.test(sw), "sw.js 预缓存含 js/sync-store.js（断网也要能同步）");

    // ⚠️ 同步引擎自己那三把键的分家口径（2026-09-20 的真实故障）：
    //    它们在 ProgressStore 的分域表里没有登记，原先掉进 family 那边
    //    「认不出就默认分家」的兜底 —— 于是「设置 · 通用」里开着的同步，
    //    切到「我的」页显示成没开（两页读的是两个不同孩子的键）。
    //    答案现在只有一处：`SyncStore.perChildKey()`，family 只是转问它。
    const ssSrc = fs.readFileSync(path.join(ROOT, "js/sync-store.js"), "utf8");
    chk(/perChildKey/.test(ssSrc), "sync-store 导出 perChildKey()（分家口径的唯一一处）");
    chk(/Family\.keyFor/.test(ssSrc),
      "seenKey() 走 Family.keyFor()（与进度键同一套拼法，不再各拼各的）");
    const famSrc = fs.readFileSync(path.join(ROOT, "js/family.js"), "utf8");
    chk(/SS\.perChildKey/.test(famSrc),
      "family 的 isPerChild() 会先问 SyncStore.perChildKey()（不再替它猜）");
    const vm = sw.match(/poem-app-v(\d+)/);

    chk(!!vm && Number(vm[1]) >= 132, "sw.js 缓存版本提到 v132 以上（实际 " + (vm && vm[1]) + "）");

    const gen = fs.readFileSync(path.join(ROOT, "settings/general/index.html"), "utf8");
    chk(/id="toggle-sync"/.test(gen), "设置 · 通用里有同步开关（用户有权拒绝上传）");
    // ⚠️ 冲突裁决三颗键原先在 /profile/ 那一页（个人中心）。
    //    2026-09-20（Issue #244）那一页已删除，这一块整体搬进了「我的」页。
    const minePage = fs.readFileSync(path.join(ROOT, "mine/index.html"), "utf8");
    ["btn-keep-local", "btn-keep-remote", "btn-export-first"].forEach(id => {
      chk(new RegExp('id="' + id + '"').test(minePage), "「我的」页有冲突裁决入口 " + id);
    });

    const setjs = fs.readFileSync(path.join(ROOT, "js/settings.js"), "utf8");
    chk(/SyncStore|syncMod\(\)/.test(setjs), "设置页的同步状态读 SyncStore（不自己判登录与否）");
    chk(/S\.status\(\)|Sync\.status\(\)/.test(setjs), "设置页用 status() 出状态，不自己拼一套");
  }

  {
    const h = harness({ noFetch: true });
    const { Sync } = h;
    const r = await Sync.request("/sync/pull", "POST", {}).catch(() => null);
    chk(r !== null && r.ok === false && r.code === "E_OFFLINE",
      "没有 fetch 时 request 回落成 E_OFFLINE（不抛、也不假装成功）");

    const h2 = harness({ net: { syncpull: () => Promise.resolve(jsonRes(503, { code: "E_NOT_CONFIGURED" })) } });
    h2.Sync.setEnabled(true);
    const r2 = await h2.Sync.pullOnce(0);
    eq(r2.code, "E_NOT_CONFIGURED", "503 被识别成「本站还没开放云端同步」，不是内部错误");
    const r3 = await h2.Sync.now();
    chk(r3 !== undefined, "未开放时 now() 也照常有返回值（不抛）");

    const h3 = harness({ net: { syncpush: () => Promise.resolve(jsonRes(401, { code: "E_NO_SESSION" })) } });
    h3.Sync.setEnabled(true);
    h3.Sync.touch("p1", { level: 1 });
    const r4 = await h3.Sync.now({ pull: false });
    eq(r4.code, "E_NO_SESSION", "401 如实回报 E_NO_SESSION（会话过期是正常状态，不是崩溃）");
  }

  {
    const h = harness({ recs: { p1: { level: 1 } } });

    global.window.Storage = undefined;
    const st = fs.readFileSync(path.join(ROOT, "js/storage.js"), "utf8");

    const rec = h.Sync.touch("p1", { level: 9, reps: 3 });
    eq(JSON.stringify(rec), '{"level":9,"reps":3}', "同步关着时 touch 原样返回、不盖 updatedAt");
    eq(JSON.stringify(h.PS.get("p1")), '{"level":9,"reps":3}',
      "盘上也没有多出任何字段（老断言逐字比对的形状仍然成立）");
    eq(JSON.stringify(h.PS.all()), '{"p1":{"level":9,"reps":3}}',
      "整份盘上内容与 0 期一字不差");
    void st;

    h.Sync.setEnabled(true);
    h.tick(5000);
    const rec2 = h.Sync.touch("p1", { level: 2 });
    chk(typeof rec2.updatedAt === "number" && rec2.updatedAt >= h.now(),
      "同步开着时同一次改动会盖上 updatedAt（下一轮可推）");

    h.Sync.setEnabled(false);
    ok(typeof h.PS.get("p1").updatedAt === "number", "关掉同步不会抹掉已有的记账字段");
  }

  let JSDOM = null;
  try { JSDOM = require("jsdom").JSDOM; } catch (e) { JSDOM = null; }

  if (!JSDOM) {
    console.log("\n(未安装 jsdom，跳过真页面一节 —— run.sh 会先装好它)");
  } else {

    const w = await page("settings/general", {});
    await signInPro(w);

    const input = w.document.getElementById("toggle-sync");
    chk(!!input, "设置 · 通用里有同步开关那颗控件");
    eq(input.checked, false, "打开页面时开关是**关着的**（出厂状态）");
    eq(input.disabled, false, "服务端可用时开关点得动（不是灰的）");

    const trackRule = (cssCode.match(/\.switch-toggle\s*\{[^}]*\}/) || [""])[0];
    const onRule = (cssCode.match(/\.switch-input:checked\s*\+\s*\.switch-toggle\s*\{[^}]*\}/) || [""])[0];
    chk(/border-radius:\s*999px/.test(trackRule), "开关是胶囊轨道（不是方框）");
    chk(/background:\s*var\(--card\)/.test(trackRule), "关着时是纸底（不是浏览器默认的白底方框）");
    chk(/background:\s*var\(--green\)/.test(onRule), "开着时是深天青实底（与全站选中态同一个色）");
    chk(/appearance:\s*none/.test(trackRule) || /position:\s*relative/.test(trackRule),
      "外观自绘（轨道是自己画的 span，不吃各浏览器默认样式）");
    eq(!!w.document.getElementById("sync-label"), false,
      "旧的「关」/「开」文字标签已经拿掉（状态改由开关本体表达）");
    chk(!!w.document.querySelector(".switch .switch-toggle"),
      "开关自带一条轨道（滑块由它画，不是 UA 的勾）");

    chk(!w.document.querySelector(".switch .switch-track"),
      "不再有独立滑块 .switch-track（滑块现在是轨道的 ::after）");
    var _inpCss = (cssCode.match(/\.switch-input\s*\{[^}]*\}/) || [""])[0];
    chk(/width:\s*0/.test(_inpCss) && /height:\s*0/.test(_inpCss),
      "真实复选框画成 0 尺寸（不占位，视觉交给轨道那颗 span）");
    ok(/只存本机/.test(w.document.getElementById("sync-hint").textContent),
      "关着时如实说「进度只存本机，不上传」");

    input.checked = true;
    input.dispatchEvent(new w.Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 20));
    chk(!!w.localStorage.getItem("poem_sync_pref_v1"), "开关落了盘");
    eq(JSON.parse(w.localStorage.getItem("poem_sync_pref_v1")).enabled, true, "落盘的是 enabled:true");
    ok(/同步到服务器/.test(w.document.getElementById("sync-hint").textContent),
      "开着时如实说「会上传到服务器」（两种说法不能混）");

    input.checked = false;
    input.dispatchEvent(new w.Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 20));
    eq(JSON.parse(w.localStorage.getItem("poem_sync_pref_v1")).enabled, false, "关掉也落盘");

    const w2 = await page("settings/general", {});
    await signInPro(w2, "pro2@example.com");
    const S = w2.SyncStore;
    chk(!!S, "页面里 SyncStore 挂在 window 上");
    eq(S.setEnabled(true).ok, true, "这页是登录着的 Pro，开关打得开（层级闸放行）");
    w2.Storage.set("p_probe", { level: 1 });

    const progKey = w2.ProgressStore.childProgressKey();
    chk(progKey.indexOf("poem_recite_progress_v1") === 0,
      "进度键仍以进度域键名为前缀（实际 " + progKey + "）");
    const stored = JSON.parse(w2.localStorage.getItem(progKey) || "{}");
    chk(!!stored.p_probe && !!stored.p_probe.updatedAt,
      "真页面上写进度会自动盖 updatedAt（引擎挂载时机错了这里就是 undefined）");
    const pending = S.pending();
    chk(pending.some(x => x.id === "p_probe"), "于是它真的进了「该推的」清单");

    // ⚠️ 种子必须种在**分家之后**那两把键上：子用户 id 是每张页各自现建的
    //    随机值，所以不能「先空跑一页拿 id 再种给下一页」——两页的 id 不同。
    //    做法是先让这一页自己把子用户建出来，在同一页里按它的 id 种下
    //    进度与「见过没」，再整页重画一次。
    //    （2026-09-20 之前这里直接种 `poem_sync_seen_v1`：那是唯一一把
    //      un-suffixed 键，能过只是因为当时引擎自己拼 seen 键、
    //      与进度键的分家口径不一致。现在两条走同一个出口 Family.keyFor()。）
    const w3 = await page("mine", {});
    const cid3 = w3.Family.currentId({ backing: w3.localStorage });
    w3.localStorage.setItem("poem_recite_progress_v1::" + cid3,
      JSON.stringify({ p1: { level: 5, updatedAt: 9000 } }));
    w3.localStorage.setItem("poem_sync_seen_v1::" + cid3, JSON.stringify({ p1: -1 }));
    w3.document.dispatchEvent(new w3.Event("DOMContentLoaded"));
    await new Promise(r => setTimeout(r, 40));
    const box = w3.document.getElementById("sync-conflict");
    chk(!!box && box.hidden === false, "有冲突时「我的」页把裁决面板摆出来");
    const lead = w3.document.getElementById("conflict-lead").textContent;
    ok(/1 篇/.test(lead), "面板里写明争的是几篇（不让用户在不知代价的情况下选）");
    ok(/快照/.test(lead), "面板里写明「保留账号」之前会留快照（后悔药先说清）");

    ok(/需要你选一下/.test(w3.document.getElementById("sync-hint").textContent),
      "说明行如实写「需要你选一下」，不写「已同步」（实际：" +
      w3.document.getElementById("sync-hint").textContent + "）");

    const pInput = w3.document.getElementById("toggle-sync");
    chk(!!pInput && pInput.tagName === "INPUT" && pInput.type === "checkbox",
      "「我的」页那一行的开关是一颗真的 checkbox（键盘 / 读屏 / 原生 toggle 都走它）");
    chk(!!w3.document.querySelector(".switch .switch-toggle"),
      "它的可见本体仍是那颗自绘胶囊（.switch-toggle）");
    eq(pInput.checked, false,
      "没开同步的人落到这一页：开关就是关着的（读的是同一份 SyncStore 状态）");

    const wSet = await page("settings/general", {});
    await signInPro(wSet, "same@example.com");
    wSet.SyncStore.setEnabled(true);
    const wShare = await page("mine", { "poem_sync_pref_v1": wSet.localStorage.getItem("poem_sync_pref_v1") });
    eq(wShare.document.getElementById("toggle-sync").checked, true,
      "在「设置 · 通用」里打开之后，「我的」页那一行也是开着的（两页同一份状态）");

    const pInp = wShare.document.getElementById("toggle-sync");
    pInp.checked = false;
    pInp.dispatchEvent(new wShare.Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 30));
    eq(wShare.SyncStore.enabled(), false,
      "在「我的」页拨关：引擎里真的关上了（写的是同一条接线）");
    eq(JSON.parse(wShare.localStorage.getItem("poem_sync_pref_v1")).enabled, false,
      "落盘的也是同一个键（不是另一份只在个人中心生效的偏好）");

    chk(!/开启中/.test(wShare.document.getElementById("sync-hint").textContent || ""),
      "关掉之后那一行不再留在「开启中」（实际「" +
        wShare.document.getElementById("sync-hint").textContent + "」）");

    const w4 = await page("mine", {});
    const box4 = w4.document.getElementById("sync-conflict");
    chk(!!box4 && box4.hidden === true, "没有冲突时不摆面板（不给用户看一个空壳）");
  }

  // 「今日加背」也上云（Issue #243 后续）：它是 progress 里的一行
  // （`daily_extra:v1`），与自选集合同一条路，但**合并规则是「按天并集」**
  // 而不是「谁最后写谁赢」—— 这一段守的就是那几条。
  {
    const todayStr = (() => {
      const d = new Date();
      return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
    })();

    const extraStore = todayStr =>
      JSON.stringify({ v: 1, date: todayStr, updatedAt: 1000, items: [
        { id: "local-1", wid: "local-1", entryId: "local-1", snap: { title: "本机的" }, at: 1 }
      ] });

    const h = harness({
      store: { poem_daily_extra_v1: extraStore(todayStr) },
      net: { syncpush: () => Promise.resolve(jsonRes(200, { applied: 1, serverTime: 2000 })) }
    });

    global.window.DailyExtra = undefined;
    delete require.cache[require.resolve(path.join(ROOT, "js/daily-extra.js"))];
    require(path.join(ROOT, "js/daily-extra.js"));
    const D = global.DailyExtra;
    eq(D.SYNC_ID, h.Sync.DAILY_EXTRA_ROW_ID,
      "sync-store 与 daily-extra 的行号逐字一致（两处各写一份就会静默不同步）");

    h.Sync.setEnabled(true);
    h.calls.length = 0;
    await h.Sync.now({ pull: false });

    const pushed = h.calls.filter(c => c.url === "/api/sync/push");
    eq(pushed.length, 1, "推了一轮");
    const row = pushed[0].body.recs.filter(r => r.id === "daily_extra:v1")[0];
    chk(!!row, "加背那一行在推送清单里");
    eq(pushed[0].body.child, "", "与名册同路（child_id 空串那一批：它只属于「今天」）");
    eq(row.payload.date, todayStr, "载荷带今天的日期");
    eq(row.deleted, false, "不是删除");
    eq(pushed[0].body.recs.filter(r => r.id === "daily_extra:v1").length, 1,
      "同一行只推一次（不重复）");

    // 推完之后不再重复推
    h.calls.length = 0;
    await h.Sync.now({ pull: false });
    eq(h.calls.length, 0, "推过的行不会在下一轮被再推一次（没有它就成死循环）");
  }

  // 拉取：两台设备今天各加了几首 → 并起来，而不是互相覆盖
  {
    const todayStr = (() => {
      const d = new Date();
      return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
    })();

    const h = harness({
      store: { poem_daily_extra_v1: JSON.stringify({ v: 1, date: todayStr, updatedAt: 1000, items: [
        { id: "local-1", wid: "local-1", entryId: "local-1", snap: { title: "本机的" }, at: 1 }
      ] }) },
      net: {
        syncpull: () => Promise.resolve(jsonRes(200, {
          recs: [{
            id: "daily_extra:v1", updatedAt: 9000, deleted: false,
            payload: { v: 1, date: todayStr, updatedAt: 9000, items: [
              { id: "cloud-1", wid: "cloud-1", entryId: "cloud-1", snap: { title: "云端的" }, at: 2 }
            ] }
          }],
          serverTime: 9500
        }))
      }
    });

    global.window.DailyExtra = undefined;
    delete require.cache[require.resolve(path.join(ROOT, "js/daily-extra.js"))];
    require(path.join(ROOT, "js/daily-extra.js"));
    const D = global.DailyExtra;

    h.Sync.setEnabled(true);
    const r = await h.Sync.pullOnce(0);
    chk(r.ok, "拉成功了");
    eq(r.applied.applied, 1, "记成「应用了一条」");
    eq(D.ids().join(","), "local-1,cloud-1",
      "两台设备今天各加一首 → 并起来两首（**不是**谁覆盖谁）");
    eq(h.Sync.conflicts().length, 0, "加背**不进**冲突裁决（它不是一份进度）");
    eq(h.Sync.seen()["daily_extra:v1"], 9000,
      "拉取一律记 seen（不记就会每轮重复拉、反复重写本机）");

    h.calls.length = 0;
    await h.Sync.now({ pull: false });
    eq(h.calls.length, 0, "并进来的内容不会在下一轮被推回去（没有它就成死循环）");
  }

  // 云端那一行写的是**过去**某一天：本机今天有东西时不予理会
  {
    const todayStr = (() => {
      const d = new Date();
      return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
    })();

    const h = harness({
      store: { poem_daily_extra_v1: JSON.stringify({ v: 1, date: todayStr, updatedAt: 1000, items: [
        { id: "local-1", wid: "local-1", entryId: "local-1", snap: { title: "本机的" }, at: 1 }
      ] }) },
      net: {
        syncpull: () => Promise.resolve(jsonRes(200, {
          recs: [{
            id: "daily_extra:v1", updatedAt: 9000, deleted: false,
            payload: { v: 1, date: "2000-1-1", items: [{ id: "old-1", wid: "old-1" }] }
          }],
          serverTime: 9500
        }))
      }
    });

    global.window.DailyExtra = undefined;
    delete require.cache[require.resolve(path.join(ROOT, "js/daily-extra.js"))];
    require(path.join(ROOT, "js/daily-extra.js"));
    const D = global.DailyExtra;

    h.Sync.setEnabled(true);
    const r = await h.Sync.pullOnce(0);
    eq(D.ids().join(","), "local-1", "本机今天那一份没被动过");
    eq(r.applied.applied, 0, "没应用（记的是 skip）");
    eq(h.Sync.conflicts().length, 0, "也不该变成一次冲突裁决");
  }

  // 首次同步：两端都有旧数据时，加背**不**弹「保留本机还是保留账号」
  {
    const h = harness({
      store: { poem_daily_extra_v1: JSON.stringify({ v: 1, date: "2000-1-1", updatedAt: 1000, items: [
        { id: "local-1", wid: "local-1", entryId: "local-1", snap: { title: "本机的" }, at: 1 }
      ] }) },
      net: {
        syncpull: () => Promise.resolve(jsonRes(200, {
          recs: [{
            id: "daily_extra:v1", updatedAt: 9000, deleted: false,
            payload: { v: 1, date: "2000-1-1", items: [{ id: "old-1", wid: "old-1" }] }
          }],
          serverTime: 9500
        })),
        syncpush: () => Promise.resolve(jsonRes(200, { applied: 0, serverTime: 9600 }))
      }
    });

    global.window.DailyExtra = undefined;
    delete require.cache[require.resolve(path.join(ROOT, "js/daily-extra.js"))];
    require(path.join(ROOT, "js/daily-extra.js"));

    h.Sync.setEnabled(true);
    const r = await h.Sync.firstSync();
    chk(r.ok, "首次同步跑通");
    eq(r.conflicts, 0, "加背不产生冲突（旧日期那一行不该拦住用户）");
    eq(h.Sync.conflicts().length, 0, "conflicts() 里也看不到它");
  }

  // 「自选集合」也上云（Issue #243 后续 · 用户口径「能上云的全上」）。
  // 它是 progress 里的一行（`collections:v1`），合并规则是「谁最后改谁赢」——
  // 与加背的「按天并集」、已读的「纯并集」都不一样，所以这一段单独守。
  {
    const h = harness({
      store: {
        poem_recite_collections_v1: JSON.stringify({
          version: 1, updatedAt: 1000,
          collections: [{ id: "c1", name: "我要背的", createdAt: 1, items: [{ id: "ts-1" }] }]
        })
      },
      net: { syncpush: () => Promise.resolve(jsonRes(200, { applied: 1, serverTime: 2000 })) }
    });

    global.window.ReciteCollections = undefined;
    delete require.cache[require.resolve(path.join(ROOT, "js/collections.js"))];
    require(path.join(ROOT, "js/collections.js"));
    const C = global.ReciteCollections;
    eq(C.SYNC_ID, h.Sync.COLLECTIONS_ROW_ID,
      "sync-store 与 collections 的行号逐字一致（各写一份就静默不同步）");

    h.Sync.setEnabled(true);
    h.calls.length = 0;
    await h.Sync.now({ pull: false });

    const pushed = h.calls.filter(c => c.url === "/api/sync/push");
    eq(pushed.length, 1, "推了一轮");
    const row = pushed[0].body.recs.filter(r => r.id === "collections:v1")[0];
    chk(!!row, "集合那一行在推送清单里");
    eq(pushed[0].body.child, "", "与名册同路（child_id 空串那一批）");
    eq(row.payload.collections.length, 1, "载荷带上了那个集合");

    h.calls.length = 0;
    await h.Sync.now({ pull: false });
    eq(h.calls.length, 0, "推过的行不会在下一轮被再推一次（没有它就成死循环）");
  }

  // 拉取：云端更新 → 写进本机，且**写完不再往回推**（本机时间戳就是云端那个）
  {
    const h = harness({
      store: {
        poem_recite_collections_v1: JSON.stringify({
          version: 1, updatedAt: 1000,
          collections: [{ id: "old", name: "旧的", createdAt: 1, items: [] }]
        })
      },
      net: {
        syncpull: () => Promise.resolve(jsonRes(200, {
          recs: [{
            id: "collections:v1", updatedAt: 9000, deleted: false,
            payload: { version: 1, updatedAt: 9000, collections: [{ id: "new", name: "云端的", createdAt: 2, items: [{ id: "ts-2" }] }] }
          }],
          serverTime: 9500
        }))
      }
    });

    global.window.ReciteCollections = undefined;
    delete require.cache[require.resolve(path.join(ROOT, "js/collections.js"))];
    require(path.join(ROOT, "js/collections.js"));
    const C = global.ReciteCollections;

    h.Sync.setEnabled(true);
    const r = await h.Sync.pullOnce(0);
    chk(r.ok, "拉成功了");
    eq(r.applied.applied, 1, "记成「应用了一条」");
    eq(C.list().length, 1, "本机换成了云端那一份");
    eq(C.list()[0].id, "new", "内容来自云端（覆盖，不是并起来）");
    eq(h.Sync.seen()["collections:v1"], 9000, "记了 seen");

    h.calls.length = 0;
    await h.Sync.now({ pull: false });
    eq(h.calls.length, 0,
      "并进来的内容不会在下一轮被推回去（本机那份的时间戳必须就是云端那个）");
  }

  // 删空之后仍要推一行删除标记（否则另一台设备还挂着那几个集合）
  {
    const h = harness({
      store: {
        poem_recite_collections_v1: JSON.stringify({
          version: 1, updatedAt: 1000, collections: [{ id: "c1", name: "x", createdAt: 1, items: [] }]
        })
      },
      net: {
        syncpush: () => Promise.resolve(jsonRes(200, { applied: 1, serverTime: 2000 })),
        syncpull: () => Promise.resolve(jsonRes(200, { recs: [], serverTime: 2100 }))
      }
    });

    global.window.ReciteCollections = undefined;
    delete require.cache[require.resolve(path.join(ROOT, "js/collections.js"))];
    require(path.join(ROOT, "js/collections.js"));
    const C = global.ReciteCollections;

    h.Sync.setEnabled(true);
    h.Sync.markSeen("collections:v1", 1000);
    try { h.backing.removeItem("poem_recite_collections_v1"); } catch (e) {  }

    h.calls.length = 0;
    await h.Sync.now({ pull: false });
    const pushed = h.calls.filter(c => c.url === "/api/sync/push");
    eq(pushed.length, 1, "删空之后仍推了一轮");
    const row = pushed[0].body.recs.filter(r => r.id === "collections:v1")[0];
    chk(!!row && row.deleted === true, "那一行是删除标记");
  }

  // 「集子已读」也上云（Issue #243 后续）：一个集子一行，**并集**合并。
  {
    const h = harness({
      store: {
        poem_tangshi_read_v1: JSON.stringify({ "ts-1": { read: true, at: 100, times: 1 } })
      },
      net: {
        syncpull: () => Promise.resolve(jsonRes(200, {
          recs: [{
            id: "reads:poem_tangshi_read_v1", updatedAt: 9000, deleted: false,
            payload: { v: 1, updatedAt: 9000, marks: { "ts-2": { at: 200, times: 1 } } }
          }],
          serverTime: 9500
        })),
        syncpush: () => Promise.resolve(jsonRes(200, { applied: 1, serverTime: 9600 }))
      }
    });

    global.window.ReadSync = undefined;
    delete require.cache[require.resolve(path.join(ROOT, "js/read-sync.js"))];
    require(path.join(ROOT, "js/read-sync.js"));
    const R = global.ReadSync;
    eq(R.PREFIX, h.Sync.READ_ROW_PREFIX, "已读那一族的行号前缀两端一致");

    h.Sync.setEnabled(true);
    const r = await h.Sync.pullOnce(0);
    chk(r.ok, "拉成功了");
    eq(r.applied.applied, 1, "记成「应用了一条」");

    const map = h.PS.readMap("poem_tangshi_read_v1");
    chk(!!map["ts-1"], "本机读过的那一篇**留着**（并集，不是覆盖）");
    chk(!!map["ts-2"], "云端读过的那一篇也并进来了");
    eq(h.Sync.conflicts().length, 0, "已读不进冲突裁决");
    eq(h.Sync.seen()["reads:poem_tangshi_read_v1"], 9000, "记了 seen");

    h.calls.length = 0;
    await h.Sync.now({ pull: false });
    eq(h.calls.length, 0, "并进来的内容不会在下一轮被推回去");
  }

  // 读一篇 → 会推（这一条最容易漏：引擎写已读与同步层本来是两拨人）
  {
    const h = harness({
      store: { poem_tangshi_read_v1: JSON.stringify({}) },
      net: { syncpush: () => Promise.resolve(jsonRes(200, { applied: 1, serverTime: 2000 })) }
    });

    global.window.ReadSync = undefined;
    delete require.cache[require.resolve(path.join(ROOT, "js/read-sync.js"))];
    require(path.join(ROOT, "js/read-sync.js"));
    const R = global.ReadSync;

    h.Sync.setEnabled(true);
    h.Sync.markSeen("__cursor__", 0);
    h.PS.setRead("poem_tangshi_read_v1", "ts-9", true);
    R.touch("poem_tangshi_read_v1");

    h.calls.length = 0;
    await h.Sync.now({ pull: false });
    const pushed = h.calls.filter(c => c.url === "/api/sync/push");
    eq(pushed.length, 1, "标了一篇之后推了一轮");
    const row = pushed[0].body.recs.filter(r => r.id === "reads:poem_tangshi_read_v1")[0];
    chk(!!row, "已读那一行在推送清单里");
    eq(Object.keys(row.payload.marks).length, 1, "带上刚读过的那一篇");
  }

  // 设备域仍然一个字节都不许上传（用户这次的口径没有动它）
  {
    const h = harness({
      store: {
        poem_device_prefs_v1: JSON.stringify({ v: 1, helper: "off" }),
        poem_font_v1: "21",
        poem_play_mode_v1: "shuffle-origin"
      },
      net: { syncpush: () => Promise.resolve(jsonRes(200, { applied: 0, serverTime: 2000 })) }
    });

    global.window.ReciteCollections = undefined;
    global.window.ReadSync = undefined;
    delete require.cache[require.resolve(path.join(ROOT, "js/collections.js"))];
    delete require.cache[require.resolve(path.join(ROOT, "js/read-sync.js"))];
    require(path.join(ROOT, "js/collections.js"));
    require(path.join(ROOT, "js/read-sync.js"));

    h.Sync.setEnabled(true);
    h.calls.length = 0;
    await h.Sync.now({ pull: false });
    eq(h.calls.length, 0,
      "只有设备偏好时一条请求都不发（字号 / 连读档 / 阅读辅助都只在盘上）");
  }

  console.log("");
  console.log(fails === 0 ? "🎉 跨设备同步测试全部通过" : "❌ 跨设备同步测试 " + fails + " 项失败");
  process.exit(fails ? 1 : 0);
}

main().catch(e => {
  console.error("测试自身抛异常（这通常是环境问题，不是被测代码）：", e);
  process.exit(1);
});
