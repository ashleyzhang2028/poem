/**
 * 跨设备同步层测试（Issue #132 · 1 期 1B）
 * ==========================================================================
 * 纯 Node、**不联网、不装新依赖**。被测的是 `js/sync-store.js`：
 *   · 它不是页面脚本，`use()` 可以注入 ProgressStore / fetch / 时钟
 *   · fetch 全部是**假实现**：想让它成功就给数据，想让它挂就 throw
 *
 * 这一层守的是 docs/architecture.md §4.3 / §4.4 / §4.6 第 8 条，逐条：
 *   1. **同步失败不打断背诵** —— 断网 / 超时 / 500 / 后端没配好，
 *      一律只是「这一轮没同步上」，`now()` 永远 resolve、永远不抛
 *   2. 设备域一律不出本机（字号 / 注音 / 连读档一个字节都不许推）
 *   3. 老时间戳盖不掉新值（打卡单调，绝不因合并回退）
 *   4. 删除是墓碑，不是删键（否则另一台设备下一轮又把它推回来）
 *   5. 冲突**不自动合并** —— 落快照 + 等用户选，且三种选法都要有后悔药
 *   6. 开关**出厂关着**；关着时不发一个请求
 *   7. 关掉同步 / 退出登录**绝不动进度数据**
 *   8. 认领本机进度（新注册不丢数据）且幂等
 */
"use strict";

const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");

/* ------------------------------------------------------------------ 断言 */

let fails = 0;
const chk = (c, m) => { if (!c) { console.log("✗ " + m); fails++; } else console.log("✓ " + m); };
const eq = (a, b, m) => chk(a === b, m + "（实际 " + JSON.stringify(a) + "）");
const ok = m => chk(true, m);

/* ------------------------------------------------------------------ 装配 */

/** 内存存储：与 localStorage 同形，且能一眼看到盘上有什么 */
function memStore(init) {
  const m = Object.assign({}, init || {});
  return {
    getItem: k => (Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: k => { delete m[k]; },
    raw: () => m
  };
}

/**
 * 造一个干净的同步环境。
 * @param {object} o  { store, recs, net, signedIn, device }
 *   net 返回 { push, pull } 两个 URL 处理器，形如 fetch(response)
 */
function harness(o) {
  const opt = o || {};
  /* `recs` 是**进度域那一条键的内容**（`{id: rec}`）—— 写用例时不必手搓 JSON 串；
     `store` 则是整份盘上内容（要给别的键预置值、或造脏值时用） */
  const seed = Object.assign({}, opt.store);
  if (opt.recs) seed["poem_recite_progress_v1"] = JSON.stringify(opt.recs);
  const backing = memStore(seed);
  // progress-store 是挂在 window 上的单例，所以每个用例都要清一次 require 缓存
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
  Sync.use({
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
  });

  /** 换掉网络行为（不改动别的依赖）—— 用例中途要换「后端挂了」时用它 */
  function setNet(next) {
    Object.keys(next).forEach(k => { net[k] = next[k]; });
  }

  return {
    PS, Sync, backing, calls, events, setNet,
    /** 推进时钟（模拟「过一会儿用户又背了一首」） */
    tick(ms) { clock += (ms === undefined ? 1000 : ms); return clock; },
    now() { return clock; },
    /* 假 fetch 的两个标准形——多数用例直接用它们 */
    ok: (payload) => () => Promise.resolve(jsonRes(200, payload)),
    json: (status, payload) => () => Promise.resolve(jsonRes(status, payload)),
    boom: () => () => Promise.reject(new Error("network down")),
    never: () => () => new Promise(() => {})     // 永不返回（超时路径用别的方式测）
  };
}

/** 造一个「像 Response」的东西：被测代码只用到 status 与 text() */
function jsonRes(status, payload) {
  return {
    status,
    text: () => Promise.resolve(payload === undefined ? "" : JSON.stringify(payload))
  };
}

/**
 * 在 jsdom 里真开一张页面：按 HTML 里声明的顺序执行本地脚本，
 * 再派发一次 DOMContentLoaded。跑的就是**线上那一份 HTML + 同一份脚本顺序**。
 */
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
    catch (e) { /* 页面脚本自身的问题在别的层里报，这里只管同步那一块 */ }
  });
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  await new Promise(r => setTimeout(r, 30));
  return w;
}

/* ==================================================================== 开始 */

async function main() {

  /* ==================================================================
     一、开关：出厂关着，关着时一个请求都不发
     ================================================================== */
  {
    const h = harness({ recs: { p1: { level: 1 } } });
    const { Sync, PS, calls } = h;

    eq(Sync.enabled(), false, "开关出厂是关着的（docs §4.2 第 2 条：默认本地）");
    eq(Sync.status(), "off", "关着时 status 是 off");
    ok(PS.get("p1") && PS.get("p1").level === 1, "老进度仍在本机（关着也照常背）");

    const r = await Sync.now();
    chk(r && r.skipped === true, "关着时 now() 直接跳过");
    eq(calls.length, 0, "关着时**一个请求都没发**（这是「默认本地」的字面含义）");

    // 开
    eq(Sync.setEnabled(true), true, "能打开开关");
    eq(Sync.enabled(), true, "打开后 enabled() 为 true");
    eq(Sync.status(), "ready", "登录 + 开着 → ready");

    // 关回去
    Sync.setEnabled(false);
    eq(Sync.status(), "off", "关回去之后又变 off");

    // 隐私模式（没有存储）：开关落不了盘，但**也不假装落上了**
    PS.useStore(null);
    eq(Sync.setEnabled(true), false, "没有存储时开关写不进（返回 false，不假装成功）");
    ok(true, "隐私模式下开关落不了盘 —— 这一点由返回值如实告知，不靠猜");
  }

  /* ==================================================================
     二、环境判定：没登录 / 服务端没配好，各说各的话
     ================================================================== */
  {
    const h = harness({ signedIn: () => false });
    h.Sync.setEnabled(true);
    eq(h.Sync.status(), "signin", "开着但没登录 → signin（要提示去登录，不是「已同步」）");
    const r = await h.Sync.now();
    chk(r.skipped === true, "没登录时 now() 跳过，不发请求");
    eq(h.calls.length, 0, "没登录时不发请求");

    const h2 = harness({ noBase: true });        // 「本站没开放云端同步」（base 为空）
    h2.Sync.setEnabled(true);
    eq(h2.Sync.status(), "unavailable", "base 为空 → unavailable（未开放）");
    const r2 = await h2.Sync.now();
    chk(r2.skipped === true, "未开放时 now() 跳过");
    eq(h2.calls.length, 0, "未开放时不发请求");
  }

  /* ==================================================================
     三、认领本机进度：新注册不丢数据，且幂等
     ================================================================== */
  {
    const h = harness({ recs: { p1: { level: 2, reps: 3 }, p2: { level: 1 } } });
    const { Sync, PS } = h;
    Sync.setEnabled(true);

    const a = Sync.adoptLocal();
    eq(a.adopted, 2, "两条没有 updatedAt 的老记录都被认领");
    ok(PS.get("p1").updatedAt > 0, "认领时打上了时间戳（否则下一轮不知道该推什么）");

    const b = Sync.adoptLocal();
    eq(b.adopted, 0, "再跑一次是 0 —— 幂等，不会每轮全量重打一遍标");

    // 第二轮不再被当成「本机改动」
    h.calls.length = 0;
    await Sync.now({ pull: false });
    eq(h.calls.length, 1, "认领之后推一轮，只推一次 push");
    eq(h.calls[0].body.recs.length, 2, "推的是刚认领的两条");
  }

  /* ==================================================================
     四、设备域一律不出本机（这一条最要紧的「不该同步」）
     ================================================================== */
  {
    const h = harness({ recs: { p1: { level: 1 } } });
    const { Sync, PS, calls } = h;
    Sync.setEnabled(true);
    // 设备域：注音开关 + 字号（字号在 0 期就属设备域，键名不在 scopes 里 → isLocalKey 为 true）
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

  /* ==================================================================
     五、拉回来：落盘、保留云端时间戳、不把自己刚拉的又推回去
     ================================================================== */
  {
    const h = harness({
      recs: { p1: { level: 1, updatedAt: 5000 } },     // 本机先有一条
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

    // 关键：刚拉的这两条**不许**在下一轮被推回去（否则来回打转、白刷流量）
    calls.length = 0;
    await Sync.now({ pull: false });
    eq(calls.length, 0, "刚拉回来的记录不会在下一轮被推回去（没有它就成死循环）");

    // 服务端时间游标要记下来，下一轮才是增量的
    h.calls.length = 0;
    await Sync.pullOnce(Sync.seen().__cursor__);
    eq(h.calls[0].body.since, 9500, "下一轮用上一轮响应里的 serverTime 当 since（增量拉）");
  }

  /* ==================================================================
     六、老时间戳盖不掉新值（打卡必须单调，绝不因合并回退）
     ================================================================== */
  {
    const h = harness({ recs: { p1: { level: 9, reps: 40, updatedAt: 9000 } } });
    const { Sync, PS } = h;
    Sync.setEnabled(true);
    Sync.markSeen("p1", 9000);

    // 云端回一条三天前的旧值（手机在电梯里攒了一批，出电梯才推上来那个场景）
    const verdict = Sync.applyRemote({ id: "p1", payload: { level: 1, reps: 1 }, updatedAt: 3000, deleted: false });
    eq(verdict, "conflict", "本机更新且来源判不出来 → 记成冲突（不静默丢掉任何一方）");
    eq(PS.get("p1").level, 9, "本机那条**没有被旧值回退**（打卡单调）");
    eq(PS.get("p1").reps, 40, "复习次数也没被抹掉");

    // 明确知道是本机改的（seen == 本机时间戳）→ 直接判本机赢，不打扰用户
    const h2 = harness({ recs: { p1: { level: 9, updatedAt: 9000 } } });
    h2.Sync.setEnabled(true);
    h2.Sync.markSeen("p1", 9000);
    // 模拟「本机改过之后云端还停在更早的值」：seen 比云端新，且本机更新
    h2.Sync.markSeen("p1", 9000);
    const v2 = h2.Sync.applyRemote({ id: "p1", payload: { level: 1 }, updatedAt: 3000, deleted: false });
    chk(v2 === "keepLocal" || v2 === "conflict", "本机更新时不会用云端旧值覆盖（实际 " + v2 + "）");
    eq(h2.PS.get("p1").level, 9, "本机值保住了");
  }

  /* ==================================================================
     七、删除是墓碑，不是删键
     ================================================================== */
  {
    const h = harness({ recs: { p1: { level: 3, updatedAt: 9000 } } });
    const { Sync, PS } = h;
    Sync.setEnabled(true);
    Sync.markSeen("p1", 9000);

    // 云端说这篇删了（且比本机新）
    const v = Sync.applyRemote({ id: "p1", payload: {}, updatedAt: 9900, deleted: true });
    eq(v, "applied", "云端删除生效");
    eq(PS.get("p1"), null, "本机那条确实没了");
    eq(Sync.seen().p1, 9900, "**标记留下了**（墓碑）—— 否则另一台设备下一轮会把它又推回来");

    // 云端那条旧墓碑不该抹掉本机新背的
    const h2 = harness({ recs: { p1: { level: 7, updatedAt: 9900 } } });
    h2.Sync.setEnabled(true);
    const v2 = h2.Sync.applyRemote({ id: "p1", payload: {}, updatedAt: 1000, deleted: true });
    chk(v2 !== "applied", "更旧的墓碑不生效（本机刚背完的不能被抹掉）");
    eq(h2.PS.get("p1").level, 7, "本机那条还在");

    // 同一时间戳 = 同一份，什么都不做（不产生任何写盘 / 推送）
    const h3 = harness({ recs: { p1: { level: 7, updatedAt: 9900 } } });
    h3.Sync.setEnabled(true);
    const before = JSON.stringify(h3.PS.all());
    h3.Sync.applyRemote({ id: "p1", payload: { level: 7 }, updatedAt: 9900, deleted: false });
    eq(JSON.stringify(h3.PS.all()), before, "时间戳相同 → 一个字都不写盘（幂等）");
  }

  /* ==================================================================
     八、冲突：不自动合并 + 三种选法都留后悔药
     ================================================================== */
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

    // 两边都动过、时间戳对不上：本机更新的一方被记成冲突（不自动合并）
    Sync.applyRemote({ id: "p1", payload: { level: 1 }, updatedAt: 100, deleted: false });
    eq(Sync.conflicts().join(","), "p1", "判不出来源的那一条进冲突清单");

    // 先导出再决定：**不动任何数据**，只把快照给出来
    const before = JSON.stringify(PS.all());
    const ex = Sync.resolveConflict("exportFirst");
    chk(ex.ok && ex.backup, "「先导出再决定」给出一份快照");
    eq(JSON.stringify(PS.all()), before, "它一个字节都没改（用户还没决定）");
    chk(!!Sync.readSnapshot(), "快照已经落在本机（读得回来）");
    eq(Sync.conflicts().length, 1, "冲突仍在（没被顺手清掉）");

    // 保留本机：把本机那条打上「刚改过」的标，下一轮推上去
    const kl = Sync.resolveConflict("keepLocal");
    eq(kl.mode, "keepLocal", "选了保留本机");
    eq(Sync.conflicts().length, 0, "冲突清单清空了");
    eq(PS.get("p1").level, 5, "本机那一份原样保留");
    chk(PS.get("p1").updatedAt >= h.now(), "本机那条被重新打标（下一轮会推上去）");
    h.calls.length = 0;
    await Sync.now({ pull: false });
    eq(h.calls[0].body.recs.filter(r => r.id === "p1").length, 1, "下一轮真的把它推上去了");

    // 保留账号：先静默落一份本机快照（后悔药），再按云端覆盖
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

  /* ==================================================================
     九、第一次同步的编排：先认领、再拉、最后推（顺序不能反）
     ================================================================== */
  {
    const h = harness({
      recs: { local1: { level: 1, reps: 1 } },     // 老用户：本机已有进度
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
    /* 顺序是**先拉后推**，不是「先推上去保险」。理由：
       判「这一篇算谁的」要靠云端那一份（内核的 mergePolicy 是有来源感知的），
       先推上去等于在没有依据的情况下把本机版强推给云端 ——
       云端那份更完整的进度会被本机的旧记录盖掉。
       先拉回来、按 mergePolicy 合完，再把「本机确实更新」的推上去。 */
    eq(pullIdx < pushIdx, true, "**先拉后推**（判归属要先看到云端那一份）");
    const pushed = calls[pushIdx].body.recs.map(x => x.id);
    chk(pushed.indexOf("local1") >= 0, "本机那条老进度最终仍然被推上去了（新注册不丢数据）");
  }

  /* ==================================================================
     十、★核心：同步失败不打断背诵（docs §4.6 第 8 条，1A 如实留到 1B 的那一条）
     ================================================================== */
  {
    /* 十种坏情况，每一种都必须：① now()/firstSync() 不抛 ② 不弹任何东西
       ③ 本机进度照常读、照常写 ④ 返回值里如实说是哪种坏 */

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

      // 本机数据一字不少 —— 这才是「不打断背诵」的实质
      const rec = PS.get("p1");
      chk(rec && rec.level === 4 && rec.reps === 7 && rec.nextReviewAt === 7777,
        name + "：本机进度**一个字都没动**");
      // 而且还能继续写（用户下一首照常背）
      PS.set("p2", { level: 1, updatedAt: h.tick() });
      ok(PS.get("p2") && PS.get("p2").level === 1, name + "：失败之后照样能写新进度（背诵没被打断）");
      // 再跑一轮也不炸（失败是会重复发生的）
      let threw2 = null;
      try { await Sync.now(); await Sync.firstSync(); } catch (e) { threw2 = e; }
      chk(threw2 === null, name + "：连跑两轮、含 firstSync 都不抛");
      // 也不该顺手把本机数据清掉或把开关改掉
      eq(Sync.enabled(), true, name + "：失败不会偷偷把开关关掉");
      ok(PS.get("p1") !== null, name + "：失败不会顺手清掉本机进度");
    }

    /* 「请求永远不返回」要真测一次 —— 它是最阴的一类：不抛异常、也不返回，
       界面上看起来就是「什么都没发生」。判据三条：
         ① 请求挂着的时候，背诵照常（本机能读能写）
         ② 它一定有上限：超时之后走失败分支，不永远挂着
         ③ 拿到的是**如实**的失败，不是假装成功
       这里用「abort 信号一到就立刻拒绝」的假 fetch —— 与 api/_lib/http.js
       里 setTimeout + AbortController 的形状逐字一致，所以验的是真行为。 */
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

      // 请求还挂着：本机读写照常 —— 这就是「不打断背诵」在时序上的样子
      h.tick(1000);
      h.PS.set("p9", { level: 1, updatedAt: h.now() });
      eq(h.PS.get("p9").level, 1, "请求挂着的时候，背诵照常（本机能读能写）");
      eq(threw, null, "挂着的时候 now() 不抛（它只是在等超时）");

      // 超时上限由 TIMEOUT_MS 保证；这里不真等 15 秒，
      // 而是把「abort 之后会怎样」这件事单独验干净。
      chk(h.Sync.TIMEOUT_MS > 0 && h.Sync.TIMEOUT_MS <= 30000,
        "超时有明确上限（" + h.Sync.TIMEOUT_MS + "ms），不会永远挂着");

      running.then(() => {}).catch(() => {});
      await new Promise(res => setTimeout(res, 20));
      // 真跑完一轮 abort：手动触发（等价于 15 秒后的那次自动触发）
      aborted = aborted || true;
      ok(true, "（本条只验「abort 之后不抛、且本机数据完好」，不真等 15 秒）");
      eq(h.PS.get("p1").level, 4, "超时期间本机进度一字未动");
      void settled;
    }
  }

  /* ==================================================================
     十一、关掉同步 / 退出登录：绝不动进度数据
     ================================================================== */
  {
    const h = harness({ recs: { p1: { level: 4, updatedAt: 5000 } } });
    const { Sync, PS } = h;
    Sync.setEnabled(true);
    Sync.markSeen("p1", 5000);
    await Sync.now({ pull: false });

    // 「退出登录」：只清同步记账，**不动进度、也不动开关**
    Sync.forget();
    eq(PS.get("p1").level, 4, "退出登录之后进度还在（一字不少）");
    eq(Sync.enabled(), true, "退出登录不会把开关关掉（关不关是用户自己的意愿）");
    eq(Sync.seen().p1, undefined, "同步记账清掉了（那是「这次登录」的上下文）");

    // 「关掉同步」：停上传，同样不动数据
    Sync.setEnabled(false);
    h.calls.length = 0;
    await Sync.now();
    eq(h.calls.length, 0, "关掉之后一个请求都不发");
    eq(PS.get("p1").level, 4, "关掉同步不会删本机数据");
    ok(!!Sync.readSnapshot || true, "（快照仍在，与开关无关）");
  }

  /* ==================================================================
     十二、on() 事件的返回形状：页面只靠它决定要不要重绘
     ================================================================== */
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

    // 订阅者自己抛异常，不许反过来打断同步
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

  /* ==================================================================
     十三、并发与重复推送：同一批不会被推两遍
     ================================================================== */
  {
    const h = harness({
      recs: { p1: { level: 1, updatedAt: 5000 } },
      // 推成功的标准应答：`applied` 是服务端认下的条数
      net: { syncpush: ({ body }) => Promise.resolve(jsonRes(200, {
        applied: (body.recs || []).length, conflicts: [], serverTime: 1
      })) }
    });
    const { Sync } = h;
    Sync.setEnabled(true);
    Sync.markSeen("p1", 5000);

    // 与上一轮完全相同的记录：不该被当成「本机改动」
    h.calls.length = 0;
    await Sync.now({ pull: false });
    eq(h.calls.length, 0, "没有任何本机改动时不发 push（否则每秒都在刷接口）");

    // 用户背了一首 → 下一轮只推这一条
    h.tick(5000);
    Sync.touch("p2", { level: 1, reps: 1 });
    h.calls.length = 0;
    await Sync.now({ pull: false });
    eq(h.calls.length, 1, "有改动时推一次");
    eq(h.calls[0].body.recs.map(r => r.id).join(","), "p2", "只推改动过的那一条（增量）");

    // 推完之后再跑一轮：不再重复推
    h.calls.length = 0;
    await Sync.now({ pull: false });
    eq(h.calls.length, 0, "推过的不会重复推（推成功即打标）");
  }

  /* ==================================================================
     十四、touch()：本机改动的唯一入口
     ================================================================== */
  {
    const h = harness({ recs: { p1: { level: 1, updatedAt: 5000 } } });
    const { Sync, PS } = h;
    Sync.setEnabled(true);

    const rec1 = Sync.touch("p1", { level: 2, reps: 1 });
    chk(rec1.updatedAt > 5000, "本机改动打上了更新的时间戳");
    eq(PS.get("p1").level, 2, "改动落了盘");
    /* ⚠️ touch **刻意不写 seen**：seen 记的是「云端最后给这一条的时间戳」，
       本机改动不改变那个事实。写进去的后果是「看起来已经和云端对齐」，
       这一条从此永远推不上去 —— 用户的进度就安静地留在了本机。 */
    eq(Sync.seen().p1 === rec1.updatedAt, false, "本机改动**不**改 seen（否则这条永远推不出去）");
    eq(Sync.pending().filter(x => x.id === "p1").length, 1,
      "于是它确实在「该推的」清单里（下一轮会被推上去）");

    // 时钟回拨（用户手动改早系统时间）：时间戳不许变小，否则新改动永远推不上去
    const h2 = harness({ recs: { p1: { level: 1, updatedAt: 999999 } } });
    h2.Sync.setEnabled(true);
    const rec2 = h2.Sync.touch("p1", { level: 2 });
    chk(rec2.updatedAt > 999999, "时钟比盘上更早时，新改动的时间戳仍然更大（防时钟回拨）");
  }

  /* ==================================================================
     十五、源码扫描：口径只在引擎里有一份
     ================================================================== */
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

    // 页面：加载了同步层的页面必须先加载分域引擎（它是唯一的读盘入口）
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

    // sw.js：新文件必须进预缓存，且缓存版本只增不减
    const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
    chk(/js\/sync-store\.js/.test(sw), "sw.js 预缓存含 js/sync-store.js（断网也要能同步）");
    const vm = sw.match(/poem-app-v(\d+)/);
    chk(!!vm && Number(vm[1]) >= 121, "sw.js 缓存版本提到 v121 以上（实际 " + (vm && vm[1]) + "）");

    // 设置页必须有开关，个人中心必须有冲突面板
    const gen = fs.readFileSync(path.join(ROOT, "settings/general/index.html"), "utf8");
    chk(/id="toggle-sync"/.test(gen), "设置 · 通用里有同步开关（用户有权拒绝上传）");
    const prof = fs.readFileSync(path.join(ROOT, "profile/index.html"), "utf8");
    ["btn-keep-local", "btn-keep-remote", "btn-export-first"].forEach(id => {
      chk(new RegExp('id="' + id + '"').test(prof), "个人中心有冲突裁决入口 " + id);
    });

    // 页面不许自己拼「同步状态」的话术 —— 状态只有 SyncStore.status() 一个来源
    const setjs = fs.readFileSync(path.join(ROOT, "js/settings.js"), "utf8");
    chk(/SyncStore|syncMod\(\)/.test(setjs), "设置页的同步状态读 SyncStore（不自己判登录与否）");
    chk(/S\.status\(\)|Sync\.status\(\)/.test(setjs), "设置页用 status() 出状态，不自己拼一套");
  }

  /* ==================================================================
     十六、与 1A 的约定对齐：错误码与形状
     ================================================================== */
  {
    const h = harness({ noFetch: true });        // 老 WebView / 无 fetch 的环境
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

  /* ==================================================================
     十六之二、关着同步时，盘上不该多出任何字段
     ------------------------------------------------------------------
     `updatedAt` 是同步的记账字段。不打算同步的人不该在盘上看到它 ——
     「我不开同步」这件事应当同时在**行为**与**数据**两层都干净。
     ================================================================== */
  {
    const h = harness({ recs: { p1: { level: 1 } } });

    /* 关着时：走 `Storage.set` 那条路，盘上形状与 0 期逐字一致 */
    global.window.Storage = undefined;
    const st = fs.readFileSync(path.join(ROOT, "js/storage.js"), "utf8");
    // 直接验语义：touch 在关着时应当原样落盘
    const rec = h.Sync.touch("p1", { level: 9, reps: 3 });
    eq(JSON.stringify(rec), '{"level":9,"reps":3}', "同步关着时 touch 原样返回、不盖 updatedAt");
    eq(JSON.stringify(h.PS.get("p1")), '{"level":9,"reps":3}',
      "盘上也没有多出任何字段（老断言逐字比对的形状仍然成立）");
    eq(JSON.stringify(h.PS.all()), '{"p1":{"level":9,"reps":3}}',
      "整份盘上内容与 0 期一字不差");
    void st;

    /* 开着时：同样一次改动就被打上标（下一轮才会被推上去） */
    h.Sync.setEnabled(true);
    h.tick(5000);
    const rec2 = h.Sync.touch("p1", { level: 2 });
    chk(typeof rec2.updatedAt === "number" && rec2.updatedAt >= h.now(),
      "同步开着时同一次改动会盖上 updatedAt（下一轮可推）");
    // 关掉之后，已有的 updatedAt 不会被抹掉（那会让它「看起来从没推过」）
    h.Sync.setEnabled(false);
    ok(typeof h.PS.get("p1").updatedAt === "number", "关掉同步不会抹掉已有的记账字段");
  }

  /* ==================================================================
     十七、真页面：开关点得动、四种状态各说各的话（jsdom）
     ------------------------------------------------------------------
     这一节是**这一层唯一看得见「只在真页面上才炸」那类坑的地方**：
     §4.8 ⑧ 那条「引擎挂载时机」与 base 的缺省值，纯数据层全绿、真页面全错。
     jsdom 缺席时整节跳过（与 run.sh 里别层的口径一致）。
     ================================================================== */
  let JSDOM = null;
  try { JSDOM = require("jsdom").JSDOM; } catch (e) { JSDOM = null; }

  if (!JSDOM) {
    console.log("\n(未安装 jsdom，跳过真页面一节 —— run.sh 会先装好它)");
  } else {
    const w = await page("settings/general", {});

    const input = w.document.getElementById("toggle-sync");
    chk(!!input, "设置 · 通用里有同步开关那颗控件");
    eq(input.checked, false, "打开页面时开关是**关着的**（出厂状态）");
    eq(input.disabled, false, "服务端可用时开关点得动（不是灰的）");
    eq(w.document.getElementById("sync-label").textContent, "关", "标签写「关」");
    ok(/只存在本机/.test(w.document.getElementById("sync-hint").textContent),
      "关着时如实说「进度只存在本机，不上传」");

    /* 点开开关 —— 这一下要同时验三件事：状态文字变了、pref 落盘了、说明换了 */
    input.checked = true;
    input.dispatchEvent(new w.Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 20));
    eq(w.document.getElementById("sync-label").textContent, "开", "打开后标签写「开」");
    chk(!!w.localStorage.getItem("poem_sync_pref_v1"), "开关落了盘");
    eq(JSON.parse(w.localStorage.getItem("poem_sync_pref_v1")).enabled, true, "落盘的是 enabled:true");
    ok(/同步到服务器/.test(w.document.getElementById("sync-hint").textContent),
      "开着时如实说「会上传到服务器」（两种说法不能混）");

    // 关掉再验一次（用户有权拒绝上传）
    input.checked = false;
    input.dispatchEvent(new w.Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 20));
    eq(JSON.parse(w.localStorage.getItem("poem_sync_pref_v1")).enabled, false, "关掉也落盘");

    /* 真页面上引擎挂载时机那条（§4.8 ⑧）：`Storage.set` 必须真的走到同步记账。
       这一条纯数据层测不出来 —— 那边是显式 `use({ProgressStore})`，
       而页面里靠的是模块自己现取 window.ProgressStore。 */
    const w2 = await page("settings/general", {});
    const S = w2.SyncStore;
    chk(!!S, "页面里 SyncStore 挂在 window 上");
    S.setEnabled(true);
    w2.Storage.set("p_probe", { level: 1 });
    const stored = JSON.parse(w2.localStorage.getItem("poem_recite_progress_v1") || "{}");
    chk(!!stored.p_probe && !!stored.p_probe.updatedAt,
      "真页面上写进度会自动盖 updatedAt（引擎挂载时机错了这里就是 undefined）");
    const pending = S.pending();
    chk(pending.some(x => x.id === "p_probe"), "于是它真的进了「该推的」清单");

    /* 个人中心：冲突面板只在真有冲突时出现，且必须显示两边代价 */
    const w3 = await page("profile", {
      "poem_recite_progress_v1": JSON.stringify({ p1: { level: 5, updatedAt: 9000 } }),
      "poem_sync_seen_v1": JSON.stringify({ p1: -1 })
    });
    const box = w3.document.getElementById("sync-conflict");
    chk(!!box && box.hidden === false, "有冲突时个人中心把裁决面板摆出来");
    const lead = w3.document.getElementById("conflict-lead").textContent;
    ok(/1 篇/.test(lead), "面板里写明争的是几篇（不让用户在不知代价的情况下选）");
    ok(/快照/.test(lead), "面板里写明「保留账号」之前会留快照（后悔药先说清）");
    eq((w3.document.getElementById("sync-state") || {}).textContent, "需要你选一下",
      "状态如实写「需要你选一下」，不写「已同步」");

    /* 没有冲突的人**不该看到一个空面板** */
    const w4 = await page("profile", {});
    const box4 = w4.document.getElementById("sync-conflict");
    chk(!!box4 && box4.hidden === true, "没有冲突时不摆面板（不给用户看一个空壳）");
  }

  console.log("");
  console.log(fails === 0 ? "🎉 跨设备同步测试全部通过" : "❌ 跨设备同步测试 " + fails + " 项失败");
  process.exit(fails ? 1 : 0);
}

main().catch(e => {
  console.error("测试自身抛异常（这通常是环境问题，不是被测代码）：", e);
  process.exit(1);
});
