/**
 * 数据访问层：**唯一的数据库出口**。
 *
 * 两个实现，接口完全一样：
 *   · supabaseStore — 走 Supabase 的 PostgREST（`/rest/v1/...`），service key 只在服务端。
 *                     **不引 @supabase/supabase-js**：只需要 4 张表的增查改删，
 *                     一个 fetch 封装比引一个 SDK 更清楚，也少一个依赖要升。
 *   · memoryStore   — 进程内 Map。用途有两个，都不是「偷懒」：
 *                     ① 本地开发与 `test/api.test.js`（不联网、不需要真库）
 *                     ② **后端整体挂掉时的降级**：接口返回 503，
 *                        而前端仍然完全可用（见 docs §4.6 第 8 条）
 *
 * 四张表（docs/architecture.md §2.1）：
 *   accounts (uid, email_hash, email_mask, nickname, plan, plan_until, role, created_at, last_login_at, status)
 *   codes    (code_id, uid, purpose, channel, sent_to, code_hash, salt, issued_at, expires_at, attempts, consumed_at)
 *   sessions (sid, uid, iat, exp, revoked, device)
 *
 * 接口共 15 个方法，两个实现（memory / supabase）**一个都不能少**：
 *   账号 8（getAccountByHash / getAccount / putAccount / deleteAccount /
 *          patchAccount / findAccountsByMask / listAccounts / ——）
 *   码   4（putCode / getCode / patchCode / voidCodes）
 *   确认 4（putVerification / getVerification / patchVerification / voidVerifications）
 *   重设 4（putReset / getReset / patchReset / voidResets）
 *   会话 3（putSession / getSession / revokeSessions）
 *   进度 3（listProgress / putProgress / deleteProgress）
 *         ⚠️ 前两个的签名是 `(uid, child, ...)` —— **child 是必给的**，
 *            两个实现漏一个不会报错，只会「一个账号的孩子互相看得见进度」。
 * 少一个的后果不是编译错误，是**某个安全约束静默失效** ——
 * 所以 test/api.test.js 有一个「两个实现的键集合完全一致」的断言。
 *   progress (uid, child_id, poem_id, payload, updated_at, deleted)
 *            —— `child_id` 是 5.3 加的（跨设备分档案）；**空串 = 第一个孩子那一份**，
 *               与 `js/family.js` 的无后缀老键逐字同源。主键 `(uid, child_id, poem_id)`。
 *
 * ⚠️ 索引：accounts.email_hash 与 progress.(uid,poem_id) 都要有唯一索引，
 *    建表 SQL 在 api/_lib/schema.sql（1A 交付物之一）。
 */
"use strict";

/* ------------------------------------------------------------ 内存实现 */

function memoryStore() {
  var db = { accounts: {}, codes: {}, sessions: {}, progress: {}, verifications: {}, resets: {} };
  var api = {
    kind: "memory",
    ready: function () { return true; },
    _db: db,

    getAccountByHash: function (hash) {
      var ids = Object.keys(db.accounts);
      for (var i = 0; i < ids.length; i++) if (db.accounts[ids[i]].email_hash === hash) return db.accounts[ids[i]];
      return null;
    },
    getAccount: function (uid) { return db.accounts[uid] || null; },
    putAccount: function (acc) { db.accounts[acc.uid] = acc; return acc; },
    deleteAccount: function (uid) { delete db.accounts[uid]; return true; },

    putCode: function (rec) { db.codes[rec.code_id] = rec; return rec; },
    getCode: function (codeId) { return db.codes[codeId] || null; },
    /** 单条更新（失败次数 / 已消费）。**两个实现都必须有它** ——
        缺了的话「码用一次即废」这条会静默失效：接口照样回 200，
        但同一个码能反复用（test/api.test.js 里那条「不能用第二次」正是它抓的）。 */
    patchCode: function (codeId, patch) {
      var c = db.codes[codeId];
      if (!c) return false;
      Object.keys(patch).forEach(function (k) { c[k] = patch[k]; });
      return true;
    },
    /**
     * 单条更新（**权威发放用**：改 plan / plan_until）。
     *
     * ⚠️ 与 patchCode 同一条教训：少一个方法不会编译报错，只会让
     *    「发放层级」这件事**静默失效** —— 接口照样回 200，改了库里啥也没变。
     *    所以两个实现的键集合必须完全一致（test/api.test.js 有断言守着）。
     * ⚠️ 白名单式落库：只写调用方明确给的那几个键，不做「整个对象盖进去」——
     *    后者会把请求体里的任意字段写进 accounts 表（那是坏客户端的提权口子）。
     */
    patchAccount: function (uid, patch) {
      var a = db.accounts[uid];
      if (!a) return false;
      /* ⚠️ 白名单式落库（不把整个对象盖进去）。这一份**同时是**
         「哪些列是可改的」的定义 —— 加一列忘了加在这里，
         症状是「接口回 200、库里啥也没变」（反复踩过）。
         Issue #197 新增四列：明文邮箱 / 确认时刻 / 口令摘要 / 口令盐。 */
      ["plan", "plan_until", "role", "last_login_at", "nickname", "status",
        "email", "email_verified_at", "password_hash", "password_salt"].forEach(function (k) {
        if (patch && Object.prototype.hasOwnProperty.call(patch, k)) a[k] = patch[k];
      });
      return true;
    },
    /**
     * 按**邮箱掩码**找账号（权威发放的检索方式：管理员手上只有掩码）。
     *
     * ⚠️ 只回「账面上的掩码完全相同」的那一条，不做模糊匹配、不做大小写以外的
     *    归一 —— 模糊匹配的下场是「发一个 a***@qq.com，命中了另一个人的账号」。
     */
    findAccountsByMask: function (mask) {
      var m = String(mask == null ? "" : mask).trim().toLowerCase();
      if (!m) return [];
      var out = [];
      Object.keys(db.accounts).forEach(function (uid) {
        var a = db.accounts[uid];
        if (String(a.email_mask || "").toLowerCase() === m) out.push(a);
      });
      return out;
    },
    listAccounts: function () {
      return Object.keys(db.accounts).map(function (uid) { return db.accounts[uid]; });
    },

    voidCodes: function (uid, purpose, at) {
      Object.keys(db.codes).forEach(function (k) {
        var c = db.codes[k];
        if (c.uid === uid && c.purpose === purpose && !c.consumed_at) c.consumed_at = at;
      });
      return true;
    },

    /* ------------------------------------------------ 邮箱确认（Issue #197）
       一张表一件事：`codes` 管「短码」，`verifications` 管「确认邮件里的长链接」。
       合成一张表的后果是「两种凭据的 TTL、失败上限、作废规则互相污染」——
       而它们是两种完全不同的东西（一个是 6 位数字、一个是 64 位 hex）。 */
    putVerification: function (rec) { db.verifications[rec.vid] = rec; return rec; },
    getVerification: function (vid) { return db.verifications[vid] || null; },
    /** 单条更新（失败次数 / 已确认）。两个实现都必须有 —— 缺了「一次即废」会静默失效 */
    patchVerification: function (vid, patch) {
      var r = db.verifications[vid];
      if (!r) return false;
      Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
      return true;
    },
    /** 同 uid + purpose 的旧记录一并作废（发新的即作废旧链接） */
    voidVerifications: function (uid, at) {
      Object.keys(db.verifications).forEach(function (k) {
        var r = db.verifications[k];
        if (r.uid === uid && !r.consumed_at) r.consumed_at = at;
      });
      return true;
    },

    /* ------------------------------------------------ 重设口令（Issue #197） */
    putReset: function (rec) { db.resets[rec.rid] = rec; return rec; },
    getReset: function (rid) { return db.resets[rid] || null; },
    patchReset: function (rid, patch) {
      var r = db.resets[rid];
      if (!r) return false;
      Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
      return true;
    },
    voidResets: function (uid, at) {
      Object.keys(db.resets).forEach(function (k) {
        var r = db.resets[k];
        if (r.uid === uid && !r.consumed_at) r.consumed_at = at;
      });
      return true;
    },

    putSession: function (s) { db.sessions[s.sid] = s; return s; },
    getSession: function (sid) { return db.sessions[sid] || null; },
    revokeSessions: function (uid) {
      Object.keys(db.sessions).forEach(function (k) { if (db.sessions[k].uid === uid) db.sessions[k].revoked = 1; });
      return true;
    },

    /**
     * 拉一个账号下**某一个子档案**的进度。
     *
     * ⚠️ `child` 是**必给的**（与 supabase 实现逐字一致）—— 不传不是「全部」，
     *    而是**第一个孩子那一份**（空串就是 `js/family.js` 里那个无后缀老键）。
     *    默认成「全部」的下场：另一个人家孩子的进度会混进来，而症状只是
     *    「怎么多出几首没背过的」—— 谁也查不出来。
     *
     * ⚠️ 但**不许因此把别人的孩子挡住**：`uid` 仍然是第一道过滤。
     *    两个条件都要，缺一个都是串数据。
     */
    listProgress: function (uid, child, since) {
      var cid = child == null ? "" : String(child);
      var out = [];
      Object.keys(db.progress).forEach(function (k) {
        var r = db.progress[k];
        if (r.uid !== uid) return;
        if (String(r.child_id || "") !== cid) return;
        if (since && r.updated_at <= since) return;
        out.push({ poem_id: r.poem_id, payload: r.payload, updated_at: r.updated_at, deleted: r.deleted });
      });
      return out;
    },
    putProgress: function (uid, child, recs) {
      var cid = child == null ? "" : String(child);
      recs.forEach(function (r) {
        var key = uid + "|" + cid + "|" + r.poem_id;
        var cur = db.progress[key];
        // 按条覆盖，但**时间戳老的不能盖掉新的**（防乱序到达把新数据写回旧值）
        if (cur && cur.updated_at > r.updated_at) return;
        db.progress[key] = { uid: uid, child_id: cid, poem_id: r.poem_id, payload: r.payload, updated_at: r.updated_at, deleted: r.deleted ? 1 : 0 };
      });
      return true;
    },
    /** 注销：一个账号下**所有孩子**的进度一并删（账号没了，档案也没了） */
    deleteProgress: function (uid) {
      Object.keys(db.progress).forEach(function (k) { if (db.progress[k].uid === uid) delete db.progress[k]; });
      return true;
    }
  };
  return api;
}

/* ---------------------------------------------------------- Supabase 实现 */

function supabaseStore(cfg) {
  var base = cfg.supabaseUrl.replace(/\/+$/, "") + "/rest/v1";
  var KEY = cfg.supabaseServiceKey;

  function call(path, opts) {
    opts = opts || {};
    var headers = {
      apikey: KEY,
      Authorization: "Bearer " + KEY,
      "Content-Type": "application/json"
    };
    if (opts.prefer) headers.Prefer = opts.prefer;
    return fetch(base + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          var err = new Error("supabase " + r.status + ": " + String(t).slice(0, 300));
          err.status = r.status;
          throw err;
        });
      }
      var ct = r.headers.get("content-type") || "";
      if (ct.indexOf("json") < 0) return null;
      return r.json();
    });
  }

  /* ⚠️ `email` 明文也在这一份里（Issue #197）：它是**给管理员看**的列，
     而这一份 COLS 是服务端内部读取用的（service key 的请求，不经浏览器）。
     下发给普通用户的 `publicAccount()` 仍然只回掩码 —— 两件事别混。 */
  var COLS = "uid,email,email_hash,email_mask,nickname,plan,plan_until,role,created_at,last_login_at,status,email_verified_at,password_hash,password_salt";
  var q = encodeURIComponent;

  return {
    kind: "supabase",
    ready: function () { return !!base && !!KEY; },

    getAccountByHash: function (hash) {
      return call("/accounts?email_hash=eq." + q(hash) + "&select=" + COLS + "&limit=1")
        .then(function (rows) { return rows && rows[0] ? rows[0] : null; });
    },
    getAccount: function (uid) {
      return call("/accounts?uid=eq." + q(uid) + "&select=" + COLS + "&limit=1")
        .then(function (rows) { return rows && rows[0] ? rows[0] : null; });
    },
    putAccount: function (acc) {
      return call("/accounts?on_conflict=uid", {
        method: "POST", body: acc, prefer: "resolution=merge-duplicates,return=representation"
      }).then(function (rows) { return rows && rows[0] ? rows[0] : acc; });
    },
    deleteAccount: function (uid) {
      return call("/accounts?uid=eq." + q(uid), { method: "DELETE", prefer: "return=minimal" }).then(function () { return true; });
    },

    putCode: function (rec) {
      return call("/codes", { method: "POST", body: rec, prefer: "return=minimal" }).then(function () { return rec; });
    },
    getCode: function (codeId) {
      return call("/codes?code_id=eq." + q(codeId) + "&limit=1").then(function (rows) { return rows && rows[0] ? rows[0] : null; });
    },
    voidCodes: function (uid, purpose, at) {
      return call("/codes?uid=eq." + q(uid) + "&purpose=eq." + q(purpose) + "&consumed_at=is.null", {
        method: "PATCH", body: { consumed_at: at }, prefer: "return=minimal"
      }).then(function () { return true; });
    },
    /** 单条更新（失败次数 / 已消费） */
    patchCode: function (codeId, patch) {
      return call("/codes?code_id=eq." + q(codeId), {
        method: "PATCH", body: patch, prefer: "return=minimal"
      }).then(function () { return true; });
    },

    patchAccount: function (uid, patch) {
      var body = {};
      ["plan", "plan_until", "role", "last_login_at", "nickname", "status",
        "email", "email_verified_at", "password_hash", "password_salt"].forEach(function (k) {
        if (patch && Object.prototype.hasOwnProperty.call(patch, k)) body[k] = patch[k];
      });
      if (!Object.keys(body).length) return Promise.resolve(true);
      return call("/accounts?uid=eq." + q(uid), {
        method: "PATCH", body: body, prefer: "return=minimal"
      }).then(function () { return true; });
    },
    findAccountsByMask: function (mask) {
      var m = String(mask == null ? "" : mask).trim().toLowerCase();
      if (!m) return Promise.resolve([]);
      return call("/accounts?email_mask=eq." + q(m) + "&select=" + COLS + "&limit=2")
        .then(function (rows) { return rows || []; });
    },
    listAccounts: function () {
      return call("/accounts?select=" + COLS + "&order=created_at.desc&limit=500")
        .then(function (rows) { return rows || []; });
    },

    /* ------------------------------------ 邮箱确认 / 重设口令（Issue #197） */
    putVerification: function (rec) {
      return call("/verifications", { method: "POST", body: rec, prefer: "return=minimal" }).then(function () { return rec; });
    },
    getVerification: function (vid) {
      return call("/verifications?vid=eq." + q(vid) + "&limit=1").then(function (rows) { return rows && rows[0] ? rows[0] : null; });
    },
    patchVerification: function (vid, patch) {
      return call("/verifications?vid=eq." + q(vid), { method: "PATCH", body: patch, prefer: "return=minimal" })
        .then(function () { return true; });
    },
    voidVerifications: function (uid, at) {
      return call("/verifications?uid=eq." + q(uid) + "&consumed_at=is.null", {
        method: "PATCH", body: { consumed_at: at }, prefer: "return=minimal"
      }).then(function () { return true; });
    },

    putReset: function (rec) {
      return call("/resets", { method: "POST", body: rec, prefer: "return=minimal" }).then(function () { return rec; });
    },
    getReset: function (rid) {
      return call("/resets?rid=eq." + q(rid) + "&limit=1").then(function (rows) { return rows && rows[0] ? rows[0] : null; });
    },
    patchReset: function (rid, patch) {
      return call("/resets?rid=eq." + q(rid), { method: "PATCH", body: patch, prefer: "return=minimal" })
        .then(function () { return true; });
    },
    voidResets: function (uid, at) {
      return call("/resets?uid=eq." + q(uid) + "&consumed_at=is.null", {
        method: "PATCH", body: { consumed_at: at }, prefer: "return=minimal"
      }).then(function () { return true; });
    },

    putSession: function (s) {
      return call("/sessions", { method: "POST", body: s, prefer: "return=minimal" }).then(function () { return s; });
    },
    getSession: function (sid) {
      return call("/sessions?sid=eq." + q(sid) + "&limit=1").then(function (rows) { return rows && rows[0] ? rows[0] : null; });
    },
    revokeSessions: function (uid) {
      return call("/sessions?uid=eq." + q(uid), { method: "PATCH", body: { revoked: 1 }, prefer: "return=minimal" })
        .then(function () { return true; });
    },

    /**
     * 拉某个子档案的进度。`child` 是必给的 —— 空串 = 第一个孩子那一份
     * （与 `js/family.js` 的无后缀老键同源，见 schema.sql 第 5.3 节）。
     * `child_id=eq.` 那一节**不能省**：省了就是「一个账号的孩子互相看得见进度」。
     */
    listProgress: function (uid, child, since) {
      var cid = child == null ? "" : String(child);
      var p = "/progress?uid=eq." + q(uid) + "&child_id=eq." + q(cid)
            + "&select=poem_id,payload,updated_at,deleted";
      if (since) p += "&updated_at=gt." + q(since);
      return call(p);
    },
    /**
     * 按条写回，**但时间戳老的盖不掉新的**。
     *
     * ⚠️ 这里刻意**不用** PostgREST 的 `on_conflict=merge-duplicates`：
     *    那个展开出来是**无条件**的 `DO UPDATE`，等于「谁最后写谁赢」。
     *    而同步的到达顺序本来就不保证（手机断网攒了一批、出电梯才推上来），
     *    无条件 upsert 会把用户在另一台设备上刚背完的进度**回退**成几天前的。
     *    走 schema.sql 里的 `kb_upsert_progress()`，那条 where 在数据库里。
     *    memoryStore 那边有等价的判断 —— 两个实现必须同语义，
     *    test/api.test.js 的「老时间戳盖不掉新值」在两边都跑。
     */
    putProgress: function (uid, child, recs) {
      var cid = child == null ? "" : String(child);
      var rows = recs.map(function (r) {
        return { uid: uid, child_id: cid, poem_id: r.poem_id, payload: r.payload, updated_at: r.updated_at, deleted: r.deleted ? 1 : 0 };
      });
      if (!rows.length) return Promise.resolve(true);
      return call("/rpc/kb_upsert_progress", {
        method: "POST", body: { rows: rows }, prefer: "return=minimal"
      }).then(function () { return true; });
    },
    deleteProgress: function (uid) {
      return call("/progress?uid=eq." + q(uid), { method: "DELETE", prefer: "return=minimal" }).then(function () { return true; });
    }
  };
}

/**
 * 取 store：配好 Supabase 就用它，否则**降级为内存**。
 * 降级不是「假装成功」—— 调用方通过 kind 能知道自己在跟谁说话，
 * `/api/me` 也会把 `store` 字段如实回给前端（便于排查，不含敏感信息）。
 *
 * ⚠️ `_reset()` 的顺序要清两件东西：store 单例**与频控器**。
 *    只清 store 的后果是「换一个 cfg 跑第二遍时，频控的账还挂在上一轮的键上」——
 *    test/api.test.js 每次 boot() 都换一套环境变量，那里就是靠 _reset 分家的。
 */
var singleton = null;
function getStore(cfg) {
  if (singleton) return singleton;
  singleton = cfg.hasDb() ? supabaseStore(cfg) : memoryStore();
  return singleton;
}

module.exports = {
  memoryStore: memoryStore,
  supabaseStore: supabaseStore,
  getStore: getStore,
  _reset: function () { singleton = null; }
};
