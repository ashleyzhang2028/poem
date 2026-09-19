(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Entitlement = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var NS = "poem_plan_v1";
  var GRANT_NS = "poem_plan_grant_v1";
  var OWNER_NS = "poem_owner_v1";

  var TIERS = ["free", "pro", "max"];

  var ROLES = ["owner", "admin", "user"];

  var CAPS = {

    "recite.basic":      { minTier: "free", login: false, quota: null, name: "每日背诵" },

    "library.all":       { minTier: "free", login: false, quota: null, name: "课外阅读" },

    "read.aloud":        { minTier: "free", login: true,  quota: null, name: "语音朗读" },
    "pinyin.helper":     { minTier: "free", login: false, quota: null, name: "阅读辅助" },
    // 进度导出（Issue #229 第二轮）：门槛从「打开即用」收到**登录可用** ——
    // 层级仍是 free（免费档登录后就给），但未登录不再放行。改这一行要同时改
    // api/_lib/core.js 的 featuresFor()（两端同源）。
    "export.progress":   { minTier: "free", login: true,  quota: null, name: "进度导出" },

    // 复习算法按层级开放（Issue #229 第四轮，用户原话）：
    //   「游客可以用斯宾浩斯遗忘曲线 / 登录 free 添加莱特纳盒 /
    //     pro 添加 SM-2 / max 再添加 FSRS 支持全部」
    // 四条各是一格（「一格说一件事」），念的是同一组的三个层级。
    // 键名 = "algo." + js/review-models.js 里那张模型的 key（内核据此发问）。
    "algo.ebbinghaus":   { minTier: "free", login: false, quota: null, name: "遗忘曲线" },
    "algo.leitner":      { minTier: "free", login: true,  quota: null, name: "莱特纳盒" },
    "algo.sm2":          { minTier: "pro",  login: true,  quota: null, name: "SM-2 复习" },
    "algo.fsrs":         { minTier: "max",  login: true,  quota: null, name: "FSRS 复习" },

    "collections.many":  { minTier: "pro",  login: true,  quota: null, name: "自选清单",
                           quotas: { free: 10, pro: 100, max: 5000 } },
    "sync.multiDevice":  { minTier: "pro",  login: true,  quota: null, name: "设备同步" },
    "export.paper":      { minTier: "pro",  login: true,  quota: null, name: "PDF / 打印" },

    "profile.family":    { minTier: "pro",  login: true,  quota: null, name: "子用户",
                           quotas: { free: 1, pro: 3, max: 180 } },

    "quiz.review":       { minTier: "pro",  login: true,  quota: null, name: "题库" },

    "export.all":        { minTier: "pro",  login: true,  quota: null, name: "课内诗词导出",
                           quotas: { free: 0, pro: 261, max: 261 } },

    "feihualing":        { minTier: "max",  login: true,  quota: null, name: "飞花令" },
    "exam.gathering":    { minTier: "max",  login: true,  quota: null, name: "古诗词大会" },
    "exam.paper":        { minTier: "max",  login: true,  quota: null, name: "试题模拟" }

  };

  var ALIAS = {};

  function tierIndex(t) {
    var i = TIERS.indexOf(t);
    return i < 0 ? 0 : i;
  }

  function isTier(t) { return TIERS.indexOf(t) >= 0; }
  function isRole(r) { return ROLES.indexOf(r) >= 0; }

  function emptyGrants() { return { v: 1, grants: [] }; }

  function readGrants(backing) {
    if (!backing) return emptyGrants();
    var text = null;
    try { text = backing.getItem(GRANT_NS); } catch (e) { return emptyGrants(); }
    if (!text) return emptyGrants();
    var o = null;
    try { o = JSON.parse(text); } catch (e) { return emptyGrants(); }
    if (!o || typeof o !== "object" || !Array.isArray(o.grants)) return emptyGrants();
    return o;
  }

  function writeGrants(backing, data) {
    if (!backing) return false;
    try { backing.setItem(GRANT_NS, JSON.stringify(data || emptyGrants())); return true; }
    catch (e) { return false; }
  }

  function normGrant(g) {
    if (!g || typeof g !== "object") return null;
    var mask = String(g.emailMask == null ? "" : g.emailMask).trim().toLowerCase();
    if (!mask || !isTier(g.tier)) return null;
    var until = g.until == null ? null : Number(g.until);
    if (until !== null && !isFinite(until)) until = null;
    return {
      emailMask: mask, tier: g.tier, until: until,
      by: String(g.by || "").slice(0, 24),
      at: Number(g.at) || 0,
      note: String(g.note == null ? "" : g.note).slice(0, 60)
    };
  }

  function putGrant(backing, grant) {
    var g = normGrant(grant);
    if (!g) return { ok: false, code: "E_GRANT", message: "发放记录不完整：需要邮箱掩码与层级" };
    var data = readGrants(backing);
    data.grants = data.grants
      .map(normGrant)
      .filter(function (x) { return x && x.emailMask !== g.emailMask; });
    data.grants.push(g);
    writeGrants(backing, data);
    return { ok: true, grant: g };
  }

  function removeGrant(backing, mask) {
    var m = String(mask == null ? "" : mask).trim().toLowerCase();
    var data = readGrants(backing);
    var before = data.grants.length;
    data.grants = data.grants.map(normGrant).filter(function (g) { return g && g.emailMask !== m; });
    writeGrants(backing, data);
    return { ok: true, removed: before - data.grants.length };
  }

  function clearGrants(backing) {
    writeGrants(backing, emptyGrants());
    return { ok: true };
  }

  function exportGrants(backing) {
    return JSON.stringify(readGrants(backing), null, 2);
  }

  function importGrants(backing, text) {
    var o = null;
    try { o = JSON.parse(text); } catch (e) { return { ok: false, code: "E_JSON", message: "名单格式不正确" }; }
    if (!o || typeof o !== "object" || !Array.isArray(o.grants)) {
      return { ok: false, code: "E_JSON", message: "名单格式不正确" };
    }
    var clean = o.grants.map(normGrant).filter(Boolean);
    writeGrants(backing, { v: 1, grants: clean });
    return { ok: true, count: clean.length };
  }

  function grantFor(backing, mask, ts) {
    var m = String(mask == null ? "" : mask).trim().toLowerCase();
    if (!m) return null;
    var t = typeof ts === "number" ? ts : Date.now();
    var hit = readGrants(backing).grants
      .map(normGrant)
      .filter(function (g) { return g && g.emailMask === m; });
    if (!hit.length) return null;
    var g = hit[hit.length - 1];
    if (g.until != null && g.until <= t) return null;
    return g;
  }

  function isOwner(backing, opt) {
    var opt2 = opt || {};

    if (opt2.role && isRole(opt2.role)) return opt2.role === "owner" || opt2.role === "admin";
    var b = backing || defaultBacking();
    if (!b) return true;
    var raw = null;
    try { raw = b.getItem(OWNER_NS); } catch (e) { raw = null; }
    return raw == null || raw === "" || raw === "owner";
  }

  function markOwner(backing) {
    var b = backing || defaultBacking();
    if (!b) return { ok: false };
    try { b.setItem(OWNER_NS, "owner"); return { ok: true }; } catch (e) { return { ok: false }; }
  }

  function readPlan(backing) {
    if (!backing) return null;
    var text = null;
    try { text = backing.getItem(NS); } catch (e) { return null; }
    if (!text) return null;
    var o = null;
    try { o = JSON.parse(text); } catch (e) { return null; }
    return o && typeof o === "object" ? o : null;
  }

  function readTier(backing) {
    var o = readPlan(backing);
    if (!o) return "free";
    var until = o.until == null ? null : Number(o.until);
    if (until !== null && isFinite(until) && until <= Date.now()) return "free";
    return isTier(o.tier) ? o.tier : "free";
  }

  function readServerTier(backing) {
    var o = readPlan(backing);
    if (!o || o.source !== "server") return null;
    var until = o.until == null ? null : Number(o.until);
    if (until !== null && isFinite(until) && until <= Date.now()) return "free";
    return isTier(o.tier) ? o.tier : null;
  }

  function readServerRole(backing) {
    var o = readPlan(backing);
    if (!o || o.source !== "server") return null;
    return isRole(o.role) ? o.role : null;
  }

  function tierSource(backing) {
    var o = readPlan(backing);
    return o && o.source === "server" ? "server" : "local";
  }

  function writeTier(backing, tier, until, opt) {
    if (!backing) return { ok: false, code: "E_STORAGE", message: "浏览器不允许保存数据" };
    if (!isTier(tier)) return { ok: false, code: "E_TIER", message: "不认识的层级" };
    var o = opt || {};
    var payload = { v: 1, tier: tier, until: until == null ? null : Number(until) };
    if (o.source) payload.source = String(o.source);
    if (o.role && isRole(o.role)) payload.role = o.role;
    try { backing.setItem(NS, JSON.stringify(payload)); } catch (e) {
      return { ok: false, code: "E_STORAGE", message: "浏览器不允许保存数据" };
    }
    return { ok: true };
  }

  function clearTier(backing) {
    if (!backing) return { ok: false };
    try { backing.removeItem(NS); } catch (e) {  }
    return { ok: true };
  }

  function cap(name) {
    var key = Object.prototype.hasOwnProperty.call(ALIAS, name) ? ALIAS[name] : name;
    return CAPS[key] || null;
  }

  function capNames() {
    var out = Object.keys(CAPS);
    Object.keys(ALIAS).forEach(function (a) { if (out.indexOf(a) < 0) out.push(a); });
    return out.sort();
  }

  function can(name, ctx) {
    var c = cap(name);
    var k = ctx || {};
    var tier = isTier(k.tier) ? k.tier : "free";
    var signedIn = !!k.signedIn;

    if (!c) {
      return { ok: false, reason: "unknown", minTier: "free", quota: null, name: "" };
    }
    if (c.login && !signedIn) {
      return { ok: false, reason: "login", minTier: c.minTier, quota: c.quota, name: c.name };
    }
    if (tierIndex(tier) < tierIndex(c.minTier)) {
      return { ok: false, reason: "tier", minTier: c.minTier, quota: c.quota, name: c.name };
    }
    return { ok: true, reason: "ok", minTier: c.minTier, quota: c.quota, name: c.name };
  }

  function denyReason(name, ctx) {
    var r = can(name, ctx);
    if (r.ok) return "";
    if (r.reason === "unknown") return "这个功能暂不可用";
    if (r.reason === "login") return "登录可用";
    return r.minTier === "max" ? "Max 起" : "Pro 起";
  }

  function tierLabel(tier) {
    var t = isTier(tier) ? tier : "free";
    return t === "max" ? "Max" : t === "pro" ? "Pro" : "Free";
  }

  function matrix(ctx) {
    return Object.keys(CAPS).map(function (k) {
      var c = CAPS[k];
      var r = can(k, ctx);
      return {
        cap: k, name: c.name, ok: r.ok, reason: r.reason,
        minTier: c.minTier, quota: c.quota,
        hint: r.ok ? (c.quota ? "每月 " + c.quota + " 次" : "") : denyReason(k, ctx)
      };
    });
  }

  var COLUMNS = [
    { id: "guest", tier: "free", guest: true  },
    { id: "free",  tier: "free", guest: false },
    { id: "pro",   tier: "pro",  guest: false },
    { id: "max",   tier: "max",  guest: false }
  ];

  function columnLabel(col) {
    if (!col) return "";
    if (col.guest) return "游客";
    return tierLabel(col.tier);
  }

  function quotaFor(c, tier) {
    if (!c) return null;
    if (c.quotas && typeof c.quotas === "object") {
      if (!isTier(tier)) return null;
      var v = c.quotas[tier];
      return typeof v === "number" ? v : null;
    }
    return c.quota == null ? null : c.quota;
  }

  function quotaText(amount) {
    if (amount === Infinity) return "不限";
    if (amount === 0) return "不支持";
    return String(amount) + " 个";
  }

  function compare(o) {
    var opt = o || {};
    var now = typeof opt.now === "number" ? opt.now : undefined;

    var cols = COLUMNS.map(function (c) {
      return { id: c.id, guest: !!c.guest, tier: c.tier, label: columnLabel(c) };
    });

    var rows = Object.keys(CAPS).map(function (k) {
      var c = CAPS[k];
      var cells = COLUMNS.map(function (col) {

        var ctx = { tier: col.tier, signedIn: !col.guest };
        if (now !== undefined) ctx.now = now;
        var r = can(k, ctx);

        var amount = quotaFor(c, col.tier);
        return {
          ok: r.ok,
          reason: r.ok ? "ok" : r.reason,
          quota: amount,

          hint: r.ok
            ? (amount == null ? (c.quota ? "每月 " + c.quota + " 次" : "") : quotaText(amount))
            : denyReason(k, ctx)
        };
      });
      return { cap: k, name: c.name, quota: c.quota, quotas: c.quotas || null,
               unit: c.unit || "", minTier: c.minTier, cells: cells };
    });

    var groups = [];
    var byMin = { free: [], pro: [], max: [] };
    rows.forEach(function (r) {
      (byMin[r.minTier] || byMin.free).push(r);
    });
    [

      { key: "free", title: "所有版本都有" },
      { key: "pro", title: "Pro 起" },
      { key: "max", title: "Max 起" }
    ].forEach(function (g) {
      if (byMin[g.key].length) groups.push({ key: g.key, title: g.title, note: g.note, rows: byMin[g.key] });
    });

    var summary = cols.map(function (col, i) {
      var on = 0;
      rows.forEach(function (r) { if (r.cells[i] && r.cells[i].ok) on += 1; });
      return { id: col.id, label: col.label, ok: on, total: rows.length };
    });

    return { cols: cols, rows: rows, groups: groups, summary: summary };
  }

  function identity(o) {
    var opt = o || {};
    var backing = opt.backing || defaultBacking();
    var t = typeof opt.now === "number" ? opt.now : Date.now();

    var authStore = opt.authStore || (function () {
      var g = typeof globalThis !== "undefined" ? globalThis : null;
      var A = (g && g.AuthCore) || null;
      try { return A && A.makeStore ? A.makeStore(backing) : null; } catch (e) { return null; }
    })();

    var uid = "", mask = "", signedIn = false;

    var serverTier = readServerTier(backing);
    var serverRole = readServerRole(backing);

    var role = isOwner(backing, serverRole ? { role: serverRole } : undefined)
      ? (serverRole === "owner" || serverRole === "admin" ? serverRole : "owner")
      : "user";
    if (authStore) {
      var s = null;
      try { s = authSession(authStore); } catch (e) { s = null; }
      if (s && s.account) {
        signedIn = true;
        uid = s.account.uid || "";
        var ids = s.account.identities || [];
        for (var i = 0; i < ids.length; i++) {
          if (ids[i] && ids[i].mask) { mask = ids[i].mask; break; }
        }

        var accTier = s.account.plan && s.account.plan.tier;
        if (isTier(accTier) && accTier !== "free") {
          return finish(accTier, signedIn, uid, mask, role, "local");
        }

        if (serverTier && serverTier !== "free") {
          return finish(serverTier, signedIn, uid, mask, role, "server");
        }
      }
    }

    var tier = readTier(backing);

    if (serverTier && tierIndex(serverTier) > tierIndex(tier)) tier = serverTier;
    if (signedIn) {
      var g = grantFor(backing, mask, t);
      if (g && tierIndex(g.tier) > tierIndex(tier)) tier = g.tier;
    }
    return finish(tier, signedIn, uid, mask, role,
      serverTier && tierIndex(serverTier) >= tierIndex(tier) ? "server" : "local");
  }

  function defaultBacking() {
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    if (!g) return null;
    try {
      return g.localStorage && typeof g.localStorage.getItem === "function" ? g.localStorage : null;
    } catch (e) {
      return null;
    }
  }

  var authSession = function (authStore) {
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    var A = (g && g.AuthCore) || null;
    if (A && A.session) return A.session(authStore);
    return null;
  };

  function setAuthCore(A) {
    authSession = function (authStore) { return A && A.session ? A.session(authStore) : null; };
  }

  function finish(tier, signedIn, uid, mask, role, tierSource) {
    var ctx = { tier: tier, signedIn: signedIn };
    return {
      uid: uid, mask: mask, signedIn: signedIn, tier: tier, role: role,
      tierSource: tierSource || "local",
      label: tierLabel(tier),
      ctx: ctx,
      can: function (name) { return can(name, ctx); },
      hint: function (name) { return denyReason(name, ctx); }
    };
  }

  function guestIdentity() { return finish("free", false, "", "", "user", "local"); }

  return {
    NS: NS, GRANT_NS: GRANT_NS, OWNER_NS: OWNER_NS,
    TIERS: TIERS, ROLES: ROLES, CAPS: CAPS, ALIAS: ALIAS,
    capNames: capNames, cap: cap, can: can, denyReason: denyReason,
    tierLabel: tierLabel, matrix: matrix, compare: compare, COLUMNS: COLUMNS,
    quotaFor: quotaFor, quotaText: quotaText, columnLabel: columnLabel,
    isTier: isTier, isRole: isRole,
    tierIndex: tierIndex,
    emptyGrants: emptyGrants, readGrants: readGrants, writeGrants: writeGrants,
    normGrant: normGrant, putGrant: putGrant, removeGrant: removeGrant,
    clearGrants: clearGrants, exportGrants: exportGrants, importGrants: importGrants,
    grantFor: grantFor,
    readTier: readTier, writeTier: writeTier, clearTier: clearTier,
    readPlan: readPlan, readServerTier: readServerTier,
    readServerRole: readServerRole, tierSource: tierSource,
    isOwner: isOwner, markOwner: markOwner,
    identity: identity, guestIdentity: guestIdentity, setAuthCore: setAuthCore,
    defaultBacking: defaultBacking
  };
});
