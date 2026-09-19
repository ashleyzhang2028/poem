(function () {
  "use strict";

  var NS = {
    pref: "poem_sync_pref_v1",

    seen: "poem_sync_seen_v1",
    premerge: "poem_pre_merge_backup_v1"
  };

  function childId() {
    var g = typeof window !== "undefined" ? window.Family : null;
    if (!g || typeof g.currentId !== "function") return "";

    try {
      var b = backing();
      return String(b ? g.currentId({ backing: b }) : g.currentId()) || "";
    } catch (e) { return ""; }
  }

  var CHUNK = 500;

  var TIMEOUT_MS = 15000;

  function seenKey() {
    var cid = childId();
    return cid ? NS.seen + "::" + cid : NS.seen;
  }

  var deps = {};

  var EVT = {
    applied: "sync:applied",
    conflict: "sync:conflict",
    state: "sync:state"
  };

  function norm(v) { return typeof v === "number" && isFinite(v) ? v : 0; }

  function engine() {
    if (deps.ProgressStore) return deps.ProgressStore;
    var g = typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null);
    return (g && g.ProgressStore) || null;
  }

  function backing() {
    try { var e = engine(); return (e && e.store && e.store()) || null; } catch (e2) { return null; }
  }

  function pref() {
    var store = backing();
    var text = null;
    try { text = store ? store.getItem(NS.pref) : null; } catch (e) { text = null; }
    if (!text) return { v: 1, enabled: false };
    var o = null;
    try { o = JSON.parse(text); } catch (e) { o = null; }
    if (!o || typeof o !== "object") return { v: 1, enabled: false };
    return { v: 1, enabled: o.enabled === true };
  }

  function gate() {
    var E = deps.Entitlement ||
      ((typeof window !== "undefined" && window.Entitlement) || null);

    if (!E || typeof E.identity !== "function") return { ok: true, hint: "" };
    var id = null;
    try { id = typeof E.identity === "function" ? E.identity() : E.guestIdentity(); } catch (e) { id = null; }
    if (!id || typeof id.can !== "function") return { ok: true, hint: "" };
    var r = id.can("sync.multiDevice");
    return { ok: !!r.ok, hint: r.ok ? "" : (id.hint ? id.hint("sync.multiDevice") : "Pro 起") };
  }

  function setEnabled(on) {
    var want = !!on;
    if (want) {
      var g = gate();
      if (!g.ok) return { ok: false, enabled: enabled(), code: "E_TIER", hint: g.hint };
    }
    var b = backing();
    if (!b) return { ok: false, enabled: enabled(), code: "E_STORAGE" };
    var next = { v: 1, enabled: want };
    try { b.setItem(NS.pref, JSON.stringify(next)); }
    catch (e) { return { ok: false, enabled: enabled(), code: "E_STORAGE" }; }
    emit(EVT.state, { enabled: next.enabled });
    return { ok: true, enabled: next.enabled };
  }

  function enabled() { return pref().enabled; }

  function allowed() { return gate(); }

  function readSeen() {
    var b = backing();
    if (!b) return {};
    var text = null;
    try { text = b.getItem(seenKey()); } catch (e) { return {}; }
    if (!text) return {};
    var o = null;
    try { o = JSON.parse(text); } catch (e) { return {}; }
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  }

  function writeSeen(map) {
    var b = backing();
    if (!b) return false;
    try { b.setItem(seenKey(), JSON.stringify(map || {})); return true; }
    catch (e) { return false; }
  }

  function markSeen(poemId, ts) {
    if (!poemId) return false;
    var m = readSeen();
    m[poemId] = Math.round(norm(ts));
    return writeSeen(m);
  }

  function markSeenMany(pairs) {
    if (!pairs || !pairs.length) return false;
    var m = readSeen();
    pairs.forEach(function (p) { if (p && p.id) m[p.id] = Math.round(norm(p.ts)); });
    return writeSeen(m);
  }

  function touch(poemId, rec) {
    if (!engine()) return rec;

    if (!pref().enabled) {
      var e = engine();
      e.set(poemId, rec);
      return e.get(poemId);
    }
    var next = {};
    Object.keys(rec || {}).forEach(function (k) { next[k] = rec[k]; });
    var prev = null;
    try { prev = engine().get(poemId); } catch (e) { prev = null; }
    var now = deps.now ? deps.now() : Date.now();
    if (prev && norm(prev.updatedAt) >= now) next.updatedAt = norm(prev.updatedAt) + 1;
    else next.updatedAt = now;
    try { engine().set(poemId, next); } catch (e) { return next; }
    return next;
  }

  function snapshot() {
    var b = backing();
    if (!b) return null;
    var snap = {
      v: 1,
      at: new Date(deps.now ? deps.now() : Date.now()).toISOString(),
      progress: {},
      settings: null
    };
    try { snap.progress = engine().all() || {}; } catch (e) { snap.progress = {}; }
    try { snap.settings = engine().settings() || null; } catch (e) { snap.settings = null; }
    var text = JSON.stringify(snap);
    try { b.setItem(NS.premerge, text); } catch (e) { return null; }
    return snap;
  }

  function snapshotText() {
    var b = backing();
    if (!b) return "";
    try { return b.getItem(NS.premerge) || ""; } catch (e) { return ""; }
  }

  function readSnapshot() {
    var text = snapshotText();
    if (!text) return null;
    try {
      var o = JSON.parse(text);
      return o && typeof o === "object" ? o : null;
    } catch (e) { return null; }
  }

  function conflicts() {
    var seen = readSeen();
    return Object.keys(seen).filter(function (id) {

      // 「今日加背」「自选集合」「集子已读」都不进这里：它们各有自己的
      // 合并规则（加背按天并集、已读纯并集、集合谁最后改谁赢 —— 集合那一条
      // 例外：firstMerge 里它**是**要裁决的，见下面），
      // 弹一次「保留本机还是保留账号」是错的。
      if (id !== CURSOR_KEY && id !== SIG_KEY && id !== FAMILY_ROW_ID) {
        // 下面几档另有各自的合并规则
      } else {
        return false;
      }
      if (id === DAILY_EXTRA_ROW_ID) return false;
      // 「注音勘误」也不进冲突裁决：它是一份「一个确定结果」的表，
      // 按时间戳判新旧即可，问「保留本机还是保留账号」是多余的。
      if (id === PINYIN_FIX_ROW_ID) return false;
      if (id.indexOf(READ_ROW_STAMP) === 0) return false;
      if (readSync() && readSync().isReadRow(id)) return false;
      if (/__at$/.test(id)) return false;
      return norm(seen[id]) < 0;
    });
  }

  function resolveConflict(mode, account) {
    var list = conflicts();
    if (!list.length) return { ok: true, applied: 0, mode: mode };
    if (mode === "exportFirst") {

      var snap = readSnapshot();
      if (!snap) snap = snapshot();
      var backup = snap ? JSON.parse(JSON.stringify(snap)) : { v: 1, progress: {}, settings: null };
      backup.conflicts = list.slice();
      backup.note = "这份快照含本机当前的全部进度与账号域设置，以及待你裁决的篇目清单。本站没有改动任何数据。";
      return { ok: true, applied: 0, mode: "exportFirst", backup: backup, conflicts: list.slice() };
    }
    if (mode === "keepLocal") {
      var now = deps.now ? deps.now() : Date.now();
      var next = readSeen();
      list.forEach(function (id) {
        var rec = null;
        try { rec = engine().get(id); } catch (e) { rec = null; }
        if (rec) {

          rec.updatedAt = norm(rec.updatedAt) >= now ? norm(rec.updatedAt) + 1 : now;
          try { engine().set(id, rec); } catch (e) {  }
        }

        next[id] = 0;
      });
      writeSeen(next);
      emit(EVT.state, { conflicts: 0 });
      return { ok: true, applied: list.length, mode: "keepLocal" };
    }
    if (mode === "keepRemote") {
      snapshot();
      var byId = {};
      ((account && account.recs) || []).forEach(function (r) { byId[r.id] = r; });
      var seen = readSeen();
      list.forEach(function (id) {
        var r = byId[id];
        if (r && !r.deleted) {
          var rec = {};
          Object.keys(r.payload || {}).forEach(function (k) { rec[k] = r.payload[k]; });
          rec.updatedAt = norm(r.updatedAt);
          try { engine().set(id, rec); } catch (e) {  }
          seen[id] = rec.updatedAt;
        } else if (r && r.deleted) {
          try { engine().remove(id); } catch (e) {  }
          seen[id] = norm(r.updatedAt);
        } else {
          seen[id] = 0;
        }
      });
      writeSeen(seen);
      emit(EVT.state, { conflicts: 0 });
      return { ok: true, applied: list.length, mode: "keepRemote" };
    }
    return { ok: false, code: "E_MODE", message: "不认识的合并方式" };
  }

  function request(path, method, body) {
    var f = deps.fetch || (typeof fetch === "function" ? fetch : null);
    if (!f || deps.base === null) {
      return Promise.resolve({ ok: false, code: "E_OFFLINE", message: "连不上服务端" });
    }
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;
    var init = {
      method: method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" }
    };
    if (deps.deviceId) init.headers["x-kb-device"] = deps.deviceId;

    var outgoing = (body === undefined || body === null) ? null : Object.assign({}, body);
    if (outgoing && outgoing.child === undefined) outgoing.child = childId();
    if (outgoing !== null) init.body = JSON.stringify(outgoing);
    if (ctrl) init.signal = ctrl.signal;

    return f(deps.base + path, init).then(function (res) {
      if (timer) clearTimeout(timer);
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!data || typeof data !== "object") {
          return { ok: false, code: "E_INTERNAL", message: "服务端返回了看不懂的内容" };
        }
        if (res.status === 503 || data.code === "E_NOT_CONFIGURED") {
          return { ok: false, code: "E_NOT_CONFIGURED", message: "这个站点还没开放云端同步" };
        }
        if (res.status === 401) {
          return { ok: false, code: data.code || "E_NO_SESSION", message: "还没有登录" };
        }
        if (res.status >= 200 && res.status < 300) {
          var out = { ok: true, status: res.status };
          Object.keys(data).forEach(function (k) { out[k] = data[k]; });
          return out;
        }
        return { ok: false, code: data.code || "E_INTERNAL", message: data.message || "同步没成功" };
      });
    }).catch(function (e) {
      if (timer) clearTimeout(timer);
      var code = (e && e.name === "AbortError") ? "E_TIMEOUT" : "E_OFFLINE";
      return { ok: false, code: code, message: "这一轮没同步上，进度仍在本机" };
    });
  }

  function emit(name, payload) {
    try {
      if (deps.emit && deps.emit !== emit) deps.emit(name, payload || {});
    } catch (e) {  }
  }

  function base() {
    if (typeof deps.base === "string" && deps.base) return deps.base;
    return "/api";
  }

  function status() {
    if (deps.base === null) return "unavailable";
    if (!enabled()) return "off";
    if (!gate().ok) return "tier";
    if (deps.signedIn && !deps.signedIn()) return "signin";
    return "ready";
  }

  function applyRemote(r) {
    var id = r && r.id;
    if (!id) return "skip";
    var cloudTs = norm(r.updatedAt);
    var seen = readSeen();
    var knownCloud = norm(seen[id]);

    if (knownCloud < 0) return "conflict";

    var local = null;
    try { local = engine().get(id); } catch (e) { local = null; }
    var localTs = local ? norm(local.updatedAt) : 0;

    if (r.deleted) {

      if (!local) { markSeen(id, cloudTs); return "skip"; }
      if (cloudTs >= localTs) {
        try { engine().remove(id); } catch (e) { return "skip"; }
        markSeen(id, cloudTs);
        return "applied";
      }
      return "keepLocal";
    }

    if (!local) {
      var rec = {};
      Object.keys(r.payload || {}).forEach(function (k) { rec[k] = r.payload[k]; });
      rec.updatedAt = cloudTs;
      try { engine().set(id, rec); } catch (e) { return "skip"; }
      markSeen(id, cloudTs);
      return "applied";
    }

    if (cloudTs === localTs) { markSeen(id, cloudTs); return "skip"; }

    if (cloudTs > localTs) {
      var next = {};
      Object.keys(r.payload || {}).forEach(function (k) { next[k] = r.payload[k]; });
      next.updatedAt = cloudTs;
      try { engine().set(id, next); } catch (e) { return "skip"; }
      markSeen(id, cloudTs);
      return "applied";
    }

    if (knownCloud === cloudTs) return "keepLocal";
    markSeen(id, -1);
    return "conflict";
  }

  function pending(seen) {
    var out = [];
    var all = {};
    try { all = engine().all() || {}; } catch (e) { all = {}; }
    Object.keys(all).forEach(function (id) {
      var ts = norm(all[id] && all[id].updatedAt);
      if (!ts) return;
      var known = norm(seen[id]);
      if (known < 0) return;
      if (ts !== known) out.push({ id: id, payload: all[id], updatedAt: ts, deleted: false });
    });
    return out;
  }

  function sendBatch(recs, child) {
    return request("/sync/push", "POST", { recs: recs, child: child }).then(function (r) {
      if (!r.ok) return r;
      markSeenMany(recs.map(function (it) { return { id: it.id, ts: it.updatedAt }; }));
      return r;
    });
  }

  function pushPending() {
    if (status() !== "ready") return Promise.resolve({ ok: true, applied: 0, skipped: true });
    var seen = readSeen();
    var list = pending(seen);
    var reg = familyRow();
    var extra = dailyExtraRow(seen);
    var cols = collectionsRow(seen);
    var pfix = pinyinFixRow(seen);
    var reads = readRows(seen);
    if (!list.length && !reg && !extra && !cols && !pfix && !reads.length) {
      return Promise.resolve({ ok: true, applied: 0 });
    }

    var sent = 0;

    // 名册（family:v1）、「今日加背」（daily_extra:v1）与「集子已读」
    // （reads:*）都顶着 child_id = ""，与第一批**同路**：都不按孩子分家
    // （名册是账号级的，加背只属于「今天」，已读是「这个账号读过没有」）。
    // 「自选集合」（collections:v1）也走这一批 —— 它是整份一份数据，
    // 与孩子无关（集合本身不含进度）。
    var headRecs = [];
    if (reg) headRecs.push(reg);
    if (extra) headRecs.push(extra);
    if (cols) headRecs.push(cols);
    if (pfix) headRecs.push(pfix);
    reads.forEach(function (r) { headRecs.push(r); });
    var head = Promise.resolve({ ok: true });
    if (headRecs.length) {
      head = sendBatch(headRecs, "").then(function (r) {
        if (r && r.ok) {
          sent += headRecs.length;
          if (reg) writeSig(cloudSig(reg.payload));
        }
        return r;
      });
    }

    return head.then(function (prev) {
      if (prev && prev.ok === false) return prev;
      var chain = Promise.resolve();
      for (var i = 0; i < list.length; i += CHUNK) {
        (function (batch) {
          chain = chain.then(function () {
            if (status() !== "ready") return null;
            return sendBatch(batch, undefined).then(function (r) {
              if (r && r.ok) sent += batch.length;
              return r;
            });
          });
        })(list.slice(i, i + CHUNK));
      }
      return chain;
    }).then(function (last) {
      if (last && last.ok === false) return last;
      return { ok: true, applied: sent };
    });
  }

  function applyPull(r) {
    var rows = (r && r.recs) || [];
    var out = { applied: 0, keepLocal: 0, conflict: 0, family: false, serverTime: norm(r && r.serverTime) };
    rows.forEach(function (row) {

      if (row && row.id === FAMILY_ROW_ID) {
        var fv = applyRemoteFamily(row);
        if (fv === "applied") { out.applied++; out.family = true; }
        return;
      }

      // 「今日加背」那一行不进 applyRemote 的「谁最后写谁赢」：它是**按天合并**
      // 的（两台设备今天各加两首，要并成四首），而且判据是 payload 里的
      // `date`，与 updatedAt 谁大谁小无关。理由写在 js/daily-extra.js。
      if (row && row.id === DAILY_EXTRA_ROW_ID) {
        var dv = applyRemoteDailyExtra(row);
        if (dv === "applied") { out.applied++; out.dailyExtra = true; }
        return;
      }

      // 「集子已读」：**并集**（读过就是读过，谁的都不该被抹掉），
      // 所以不交给 applyRemote 的「谁最后写谁赢」。见 js/read-sync.js。
      var RS = readSync();
      if (row && RS && RS.isReadRow(row.id)) {
        var rv = applyRemoteReads(row);
        if (rv === "applied") { out.applied++; out.reads = true; }
        return;
      }

      // 「自选集合」：与普通进度同一条路（谁最后写谁赢），但它**要**记 seen，
      // 而且合并之后本机那一份的时间戳必须**就是云端那个**（否则每轮同步
      // 都会把本机重写一遍，首页计划跟着反复重算）。见 applyRemoteCollections。
      // 「注音勘误」：与自选集合同一条路（整份一份数据、谁最后改谁赢），
      // 但**不进**冲突裁决 —— 按时间戳判新旧就够了。见 applyRemotePinyinFix。
      if (row && row.id === PINYIN_FIX_ROW_ID) {
        var pv = applyRemotePinyinFix(row);
        if (pv === "applied") { out.applied++; out.pinyinFix = true; }
        return;
      }

      // 「自选集合」：与普通进度同一条路（谁最后写谁赢），但它**要**记 seen，
      // 而且合并之后本机那一份的时间戳必须**就是云端那个**（否则每轮同步
      // 都会把本机重写一遍，首页计划跟着反复重算）。见 applyRemoteCollections。
      if (row && row.id === COLLECTIONS_ROW_ID) {
        var cv = applyRemoteCollections(row);
        if (cv === "applied") { out.applied++; out.collections = true; }
        return;
      }
      var verdict = applyRemote(row);
      if (verdict === "applied") out.applied++;
      else if (verdict === "conflict") out.conflict++;
      else if (verdict === "keepLocal") out.keepLocal++;
    });
    if (out.applied) emit(EVT.applied, { count: out.applied });
    if (out.conflict) emit(EVT.conflict, { count: out.conflict });
    return out;
  }

  function pullOnce(since) {
    if (status() !== "ready") return Promise.resolve({ ok: true, applied: 0, skipped: true });

    var asked = childId();
    return request("/sync/pull", "POST", { since: norm(since) }).then(function (r) {
      if (!r.ok) return r;
      if (String(r.child == null ? "" : r.child) !== asked) {
        return { ok: true, recs: [], serverTime: norm(r.serverTime), stale: true,
                 applied: { applied: 0, keepLocal: 0, conflict: 0 } };
      }
      var applied = applyPull(r);
      var st = norm(r.serverTime);
      if (st > cursor()) setCursor(st);
      return { ok: true, recs: r.recs || [], serverTime: st, applied: applied };
    });
  }

  var CURSOR_KEY = "__cursor__";

  var FAMILY_ROW_ID = "family:v1";

  var DAILY_EXTRA_ROW_ID = "daily_extra:v1";

  // 「自选集合」那一行。它**不新开表**（progress 里的一行），合并规则是
  // 「谁最后改谁赢」，与普通进度同源；但它要在**首次合并**时进冲突裁决 ——
  // 两端的集合结构不同，按篇并起来会得到一份谁也不认识的东西。
  var COLLECTIONS_ROW_ID = "collections:v1";

  // 「集子已读」那一族行的前缀（一个集子一行，`reads:<本机键名>`）。
  var READ_ROW_PREFIX = "reads:";

  // 已读的时间戳存在 seen 里（见 js/read-sync.js 的 touch()），
  // 这一格不是一条记录 —— 不许进冲突裁决。
  var READ_ROW_STAMP = "reads:";

  var SIG_KEY = "__family_sig__";
  function cursor() { return norm(readSeen()[CURSOR_KEY]); }
  function setCursor(ts) {
    markSeen(CURSOR_KEY, ts);
  }

  function familyMod() {
    var g = typeof window !== "undefined" ? window.Family : null;
    return g && typeof g.list === "function" ? g : null;
  }

  // 「今日加背」（Issue #243 后续）：它上云，走的是与自选集合同一条路 ——
  // 作为 progress 里的**一行**（`daily_extra:v1`），不新开表。
  //
  // 这一行必须在同步的两个方向上都被照顾到（少照顾一边的症状很隐蔽）：
  //   · 推送：本机改了要推上去（pushPending）；
  //   · 拉取：别的设备改了要并进来（applyPull）；
  //   · 首次合并：两端都有旧数据时不能进「冲突裁决」（见下）。
  function dailyExtraMod() {
    var D = typeof window !== "undefined" ? window.DailyExtra : null;
    return D && typeof D.cloudRow === "function" && typeof D.applyCloud === "function" ? D : null;
  }

  function dailyExtraRow(seen) {
    var D = dailyExtraMod();
    if (!D) return null;
    try { return D.cloudRow(seen || readSeen()) || null; } catch (e) { return null; }
  }

  // 「自选集合」（Issue #243 后续）：一行 progress，与加背同路。
  function collectionsMod() {
    var C = typeof window !== "undefined" ? window.ReciteCollections : null;
    return C && typeof C.cloudRow === "function" && typeof C.applyCloud === "function" ? C : null;
  }

  function collectionsRow(seen) {
    var C = collectionsMod();
    if (!C) return null;
    try { return C.cloudRow(seen || readSeen()) || null; } catch (e) { return null; }
  }

  // 「注音勘误」（Issue #243）：一行 progress（`pinyin_fix:v1`），
  // 与自选集合同路（整份一份数据、谁最后改谁赢）。它**不进冲突裁决** ——
  // 勘误表是「一个确定的结果」，两边都有旧数据时该按时间戳判新旧，
  // 而不是弹一次「保留本机还是保留账号」。
  var PINYIN_FIX_ROW_ID = "pinyin_fix:v1";

  function pinyinFixMod() {
    var F = typeof window !== "undefined" ? window.PinyinFix : null;
    return F && typeof F.cloudRow === "function" && typeof F.applyCloud === "function" ? F : null;
  }

  function pinyinFixRow(seen) {
    var F = pinyinFixMod();
    if (!F) return null;
    try { return F.cloudRow(seen || readSeen()) || null; } catch (e) { return null; }
  }

  // 「集子已读」（Issue #243 后续）：一个集子一行，`reads:<本机键名>`。
  function readSync() {
    var R = typeof window !== "undefined" ? window.ReadSync : null;
    return R && typeof R.rows === "function" && typeof R.applyCloud === "function" ? R : null;
  }

  function readRows(seen) {
    var R = readSync();
    if (!R) return [];
    try { return R.rows(seen || readSeen()) || []; } catch (e) { return []; }
  }

  function familySig() { return String(readSeen()[SIG_KEY] || ""); }

  function writeSig(sig) {
    var m = readSeen();
    m[SIG_KEY] = String(sig || "");
    return writeSeen(m);
  }

  function cloudSig(cloud) {
    return String((cloud && cloud.at) || "") + "|" + ((cloud && cloud.profiles) || []).map(function (p) {
      return [p.id, p.nickname, (p.avatar && p.avatar.char) || "", (p.avatar && p.avatar.ink) || ""].join("~");
    }).join(";");
  }

  function localTs(list) {
    var ts = 0;
    (list || []).forEach(function (p) { var t = norm(p && p.createdAt); if (t > ts) ts = t; });
    return ts;
  }

  function familyRow() {
    var F = familyMod();
    if (!F) return null;
    var b = backing();
    var opt = b ? { backing: b } : undefined;
    var list = [], at = "";
    try { list = F.list(opt) || []; at = String(F.currentId(opt) || ""); } catch (e) { return null; }
    if (!list.length) return null;
    var sig = cloudSig({ at: at, profiles: list });
    if (familySig() === sig) return null;
    var ts = localTs(list);
    var known = norm(readSeen()[FAMILY_ROW_ID]);
    if (!ts) ts = deps.now ? deps.now() : Date.now();

    if (ts <= known) ts = known + 1;
    return { id: FAMILY_ROW_ID, payload: { v: 1, at: at, profiles: list, updatedAt: ts }, updatedAt: ts, deleted: false };
  }

  // 与 applyRemoteFamily 同一个形状：判词是 "applied" / "skip"。
  // 不返回 "conflict" —— 加背**不进冲突裁决**：它不是一份「进度」，
  // 而是「今天加的那几首」；两端的日期不同就以本机为准（在 DailyExtra 里判）。
  function applyRemoteDailyExtra(row) {
    var D = dailyExtraMod();
    if (!D) return "skip";
    var seen = readSeen();
    var known = norm(seen[DAILY_EXTRA_ROW_ID]);
    var cloudTs = norm(row && row.updatedAt);

    // 拉取 -> 读盘 -> 写盘之间隔着一个网络往返，两端可能同时改了同一行。
    // 这里只在「云端确实比见过的更新」时才动本机（与 applyRemote 同一条守卫）。
    if (cloudTs && known === cloudTs && !row.deleted) return "skip";

    var verdict = "skip";
    try { verdict = D.applyCloud(row, seen) || "skip"; } catch (e) { verdict = "skip"; }

    // ⚠️ 无论合没合上都要把「见过」记下来：不记的话，下一轮拉取
    //    （pull 是按 updated_at 的手表走的）会把这一行当成新东西反复拉，
    //    而 applyCloud 每次都会把本机盘上那一份重写一遍 —— 症状是
    //    「每轮同步都触发一次 daily-extra-change，首页计划反复重算」。
    if (cloudTs) markSeen(DAILY_EXTRA_ROW_ID, cloudTs);
    return verdict;
  }

  function applyRemoteReads(row) {
    var R = readSync();
    if (!R) return "skip";
    var seen = readSeen();
    var known = norm(seen[row.id]);
    var cloudTs = norm(row && row.updatedAt);
    if (cloudTs && known === cloudTs && !row.deleted) return "skip";

    var verdict = "skip";
    try { verdict = R.applyCloud(row, seen) || "skip"; } catch (e) { verdict = "skip"; }

    // 无论合没合上都要记 seen：不记的话下一轮拉取会把它当新东西反复拉，
    // 每次都把本机那一份重写一遍（症状是「已读标记反复闪」）。
    if (cloudTs) markSeen(row.id, cloudTs);
    return verdict;
  }

  // 「注音勘误」那一行（`pinyin_fix:v1`）：与自选集合同一套 —— 整份一份数据、
  // 谁最后改谁赢，合并完把本机的时间戳同步成云端那个（下一轮才判得出「没变」）。
  function applyRemotePinyinFix(row) {
    var F = pinyinFixMod();
    if (!F) return "skip";
    var seen = readSeen();
    var rowId = PINYIN_FIX_ROW_ID;
    var known = norm(seen[rowId]);
    var cloudTs = norm(row && row.updatedAt);
    if (cloudTs && known === cloudTs && !row.deleted) return "skip";

    var verdict = "skip";
    try { verdict = F.applyCloud(row, seen) || "skip"; } catch (e) { verdict = "skip"; }
    // ⚠️ applyCloud 可能判「本机这一份更新」而一个字都没写 —— 那种情况
    //    **不能**记 seen（记了就等于承认「云端那一版收下了」，
    //    于是本机那一版再也推不上去）。只有真收下（applied）才记。
    if (verdict === "applied" && cloudTs) markSeen(rowId, cloudTs);
    return verdict;
  }

  function applyRemoteCollections(row) {
    var C = collectionsMod();
    if (!C) return "skip";
    var seen = readSeen();
    var known = norm(seen[COLLECTIONS_ROW_ID]);
    var cloudTs = norm(row && row.updatedAt);
    if (cloudTs && known === cloudTs && !row.deleted) return "skip";

    var verdict = "skip";
    try { verdict = C.applyCloud(row, seen) || "skip"; } catch (e) { verdict = "skip"; }

    if (cloudTs) markSeen(COLLECTIONS_ROW_ID, cloudTs);
    return verdict;
  }

  function applyRemoteFamily(row) {
    var F = familyMod();
    if (!F) return "skip";
    var cloud = (row && row.payload) || null;
    if (!cloud || !Array.isArray(cloud.profiles) || !cloud.profiles.length) return "skip";
    if (typeof F.restore !== "function") return "skip";
    var cloudTs = norm(row.updatedAt);
    var known = norm(readSeen()[FAMILY_ROW_ID]);
    if (known === cloudTs) return "skip";
    var inSig = cloudSig(cloud);
    if (familySig() === inSig) { markSeen(FAMILY_ROW_ID, cloudTs); return "skip"; }
    var b = backing();
    var opt = b ? { backing: b } : undefined;
    var local = [];
    try { local = F.list(opt) || []; } catch (e) { local = []; }

    if (local.length && known > 0 && known !== cloudTs && localTs(local) > cloudTs) return "skip";
    var applied = false;

    try { applied = !!(opt ? F.restore(cloud, opt) : F.restore(cloud)); } catch (e) { applied = false; }
    markSeen(FAMILY_ROW_ID, cloudTs);
    if (applied) { writeSig(inSig); emit(EVT.applied, { count: 1, family: true }); }
    return applied ? "applied" : "skip";
  }

  function firstMerge(remoteRecs) {
    var A = deps.AuthCore || null;
    var remoteRecs2 = remoteRecs || null;
    var localRecs = {};
    try { localRecs = engine().all() || {}; } catch (e) { localRecs = {}; }

    var forCore = {};
    Object.keys(localRecs).forEach(function (id) {
      var rec = {};
      Object.keys(localRecs[id] || {}).forEach(function (k) {
        if (k !== "updatedAt") rec[k] = localRecs[id][k];
      });
      forCore[id] = rec;
    });

    var outcome = null;
    if (A && typeof A.mergePolicy === "function") {
      outcome = A.mergePolicy({ recs: forCore }, { recs: remoteRecs2 || {} });
    } else {

      outcome = Object.keys(forCore).length
        ? { action: Object.keys(remoteRecs2 || {}).length ? "ask" : "adoptLocal" }
        : { action: Object.keys(remoteRecs2 || {}).length ? "takeRemote" : "none" };
    }

    if (outcome.action === "ask") {
      snapshot();

      // 「今日加背」不进冲突裁决：它是**按天合并**的（见 js/daily-extra.js），
      // 两端都有旧数据时该并起来，而不是弹一次「保留本机还是保留账号」。
      // 「今日加背」「集子已读」不进冲突裁决（各自有自己的合并规则）；
      // 「自选集合」**进** —— 两端结构不同，按篇并起来会得到一份谁也不认识的东西。
      var list = (outcome.conflict || conflictIds(forCore, remoteRecs2))
        .filter(function (id) { return id !== DAILY_EXTRA_ROW_ID; })
        .filter(function (id) {
          var R = readSync();
          return !(R && R.isReadRow(id)) && id.indexOf(READ_ROW_PREFIX) !== 0;
        });
      list.forEach(function (id) {
        markSeen(id, -1);
      });
      emit(EVT.conflict, { count: list.length });
    }
    return { action: outcome.action, conflict: outcome.conflict || [] };
  }

  function conflictIds(local, remote) {
    return Object.keys(local).filter(function (id) { return !!remote[id]; });
  }

  function firstSync() {
    if (status() !== "ready") return Promise.resolve({ ok: true, skipped: true, reason: status() });

    adoptLocal();

    return pullOnce(0).then(function (r) {
      if (!r.ok) return r;

      var remoteMap = {};
      (r.recs || []).forEach(function (row) {
        if (!row.deleted) remoteMap[row.id] = row.payload || {};
      });
      var out = firstMerge(remoteMap);
      var rest = status() === "ready" ? pushPending() : Promise.resolve({ ok: true, applied: 0 });
      return rest.then(function (p) {
        return {
          ok: true,
          pulled: (r.applied && r.applied.applied) || 0,
          conflicts: out.conflict.length,
          pushed: (p && p.applied) || 0,
          action: out.action
        };
      });
    });
  }

  function adoptLocal() {
    var all = {};
    try { all = engine().all() || {}; } catch (e) { return { adopted: 0 }; }
    var n = 0;
    Object.keys(all).forEach(function (id) {
      var rec = all[id];
      if (!rec || typeof rec !== "object") return;
      if (norm(rec.updatedAt)) return;
      rec.updatedAt = deps.now ? deps.now() : Date.now();
      try { engine().set(id, rec); } catch (e) { return; }
      n++;
    });
    return { adopted: n };
  }

  function now(opts) {
    var o = opts || {};
    if (status() !== "ready") return Promise.resolve({ ok: true, skipped: true, reason: status() });
    var runPush = o.push !== false;
    var runPull = o.pull !== false;
    var steps = Promise.resolve({ ok: true });
    if (runPush) {
      steps = steps.then(function (prev) {
        if (prev && prev.ok === false) return prev;
        return pushPending();
      });
    }
    if (runPull) {
      steps = steps.then(function (prev) {
        if (prev && prev.ok === false) return prev;
        return pullOnce(cursor());
      });
    }
    return steps;
  }

  function forget() {
    var b = backing();
    if (!b) return { ok: true };

    var keys = [NS.seen];
    try {
      var g = typeof window !== "undefined" ? window.Family : null;
      if (g && typeof g.list === "function") {
        (g.list({ backing: b }) || []).forEach(function (p) {
          var id = p && p.id ? String(p.id) : "";
          if (id) keys.push(NS.seen + "::" + id);
        });
      }
    } catch (e) {  }
    keys.forEach(function (k) {
      try { b.removeItem(k); } catch (e) {  }
    });
    emit(EVT.state, { conflicts: 0 });
    return { ok: true };
  }

  function init(o) {
    deps = o || {};
    if (deps.base === undefined) deps.base = "/api";
    return api;
  }

  var api = {
    NS: NS, EVT: EVT, CHUNK: CHUNK, TIMEOUT_MS: TIMEOUT_MS,
    FAMILY_ROW_ID: FAMILY_ROW_ID,
    DAILY_EXTRA_ROW_ID: DAILY_EXTRA_ROW_ID,
    COLLECTIONS_ROW_ID: COLLECTIONS_ROW_ID,
    PINYIN_FIX_ROW_ID: PINYIN_FIX_ROW_ID,
    READ_ROW_PREFIX: READ_ROW_PREFIX,
    dailyExtraRow: dailyExtraRow,
    collectionsRow: collectionsRow,
    readRows: readRows,
    applyRemoteReads: applyRemoteReads,
    applyRemoteCollections: applyRemoteCollections,

    init: init,

    use: function (o) { deps = o || {}; return api; },

    pref: pref,
    enabled: enabled,
    setEnabled: setEnabled,
    status: status,
    allowed: allowed,
    gate: gate,

    touch: touch,
    markSeen: markSeen,
    markSeenMany: markSeenMany,
    seen: readSeen,
    conflicts: conflicts,
    resolveConflict: resolveConflict,

    snapshot: snapshot,
    readSnapshot: readSnapshot,
    snapshotText: snapshotText,

    request: request,
    pullOnce: pullOnce,
    pushPending: pushPending,
    pending: function () { return pending(readSeen()); },
    now: now,
    firstSync: firstSync,
    adoptLocal: adoptLocal,
    firstMerge: firstMerge,
    applyRemote: applyRemote,
    forget: forget,

    _applyPull: applyPull
  };

  if (typeof window !== "undefined") window.SyncStore = api;
  return api;
})();

if (typeof module === "object" && module.exports) module.exports = (typeof window !== "undefined" ? window.SyncStore : null);
