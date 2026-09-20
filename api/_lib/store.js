"use strict";

function memoryStore() {
  var db = { accounts: {}, codes: {}, sessions: {}, progress: {}, verifications: {}, resets: {}, reports: {} };
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

    degrade: function () { return []; },
    deleteAccount: function (uid) { delete db.accounts[uid]; return true; },

    putCode: function (rec) { db.codes[rec.code_id] = rec; return rec; },
    getCode: function (codeId) { return db.codes[codeId] || null; },

    patchCode: function (codeId, patch) {
      var c = db.codes[codeId];
      if (!c) return false;
      Object.keys(patch).forEach(function (k) { c[k] = patch[k]; });
      return true;
    },

    patchAccount: function (uid, patch) {
      var a = db.accounts[uid];
      if (!a) return false;

      ["plan", "plan_until", "role", "last_login_at", "nickname", "status",
        "email", "email_verified_at", "password_hash", "password_salt"].forEach(function (k) {
        if (patch && Object.prototype.hasOwnProperty.call(patch, k)) a[k] = patch[k];
      });
      return true;
    },

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

    putVerification: function (rec) { db.verifications[rec.vid] = rec; return rec; },
    getVerification: function (vid) { return db.verifications[vid] || null; },

    patchVerification: function (vid, patch) {
      var r = db.verifications[vid];
      if (!r) return false;
      Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
      return true;
    },

    voidVerifications: function (uid, at) {
      Object.keys(db.verifications).forEach(function (k) {
        var r = db.verifications[k];
        if (r.uid === uid && !r.consumed_at) r.consumed_at = at;
      });
      return true;
    },

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

        if (cur && cur.updated_at > r.updated_at) return;
        db.progress[key] = { uid: uid, child_id: cid, poem_id: r.poem_id, payload: r.payload, updated_at: r.updated_at, deleted: r.deleted ? 1 : 0 };
      });
      return true;
    },

    deleteProgress: function (uid) {
      Object.keys(db.progress).forEach(function (k) { if (db.progress[k].uid === uid) delete db.progress[k]; });
      return true;
    },

    // ---- 报告台账（Issue #243 第四轮）--------------------------------------
    // 与 progress 那张表**不共享生命周期**：注销账号时报告**留着**
    // （uid 外键在真库上是 on delete，但 memory 这一份要自己保住台账 ——
    //  它是管理员的工作台，不是用户的私有数据）。
    putReport: function (row) { db.reports[row.rid] = row; return { rid: row.rid }; },
    getReport: function (rid) {
      var r = db.reports[rid];
      return Promise.resolve(r || null);
    },
    listReports: function (filter, limit) {
      var f = filter || {};
      var out = Object.keys(db.reports).map(function (k) { return db.reports[k]; });
      if (f.uid) out = out.filter(function (r) { return r.uid === f.uid; });
      if (f.status) out = out.filter(function (r) { return r.status === f.status; });
      if (f.poemId) out = out.filter(function (r) { return r.poem_id === f.poemId; });
      out.sort(function (a, b) { return (b.created_at || 0) - (a.created_at || 0); });
      return Promise.resolve(out.slice(0, limit || 200));
    },
    patchReport: function (rid, patch) {
      var r = db.reports[rid];
      if (!r) return Promise.resolve(null);
      Object.keys(patch || {}).forEach(function (k) { r[k] = patch[k]; });
      return Promise.resolve(r);
    },
    countReports: function (filter) {
      var f = filter || {};
      var counts = { all: 0 };
      Object.keys(db.reports).forEach(function (k) {
        var r = db.reports[k];
        var hit = true;
        if (f.uid && r.uid !== f.uid) hit = false;
        if (f.status && r.status !== f.status) hit = false;
        if (!hit) return;
        counts.all += 1;
        counts[r.status || "new"] = (counts[r.status || "new"] || 0) + 1;
      });
      return Promise.resolve(counts);
    },
    countReportsByUid: function (uid, since) {
      var n = 0;
      var day = since - 86400000;
      Object.keys(db.reports).forEach(function (k) {
        var r = db.reports[k];
        if (r.uid === uid && Number(r.created_at || 0) > day) n += 1;
      });
      return Promise.resolve(n);
    }
  };
  return api;
}

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
          err.upstream = String(t).slice(0, 300);
          throw err;
        });
      }
      var ct = r.headers.get("content-type") || "";
      if (ct.indexOf("json") < 0) return null;
      return r.json();
    });
  }

  var degraded = [];

  // 迁移列：库停在旧形状时这三/四列还没有。
  // 建号**不能**因为它们缺席就整个失败 —— 那正是「首次注册必炸」的成因。
  var MIGRATED = ["email", "email_verified_at", "password_hash", "password_salt"];

  function isMissingColumn(err) {
    if (!err || err.status !== 400) return false;
    var up = String(err.upstream || err.message || "");
    if (up.indexOf("42703") >= 0) return true;
    if (up.indexOf("PGRST204") >= 0) return true;
    return /column .* does not exist/i.test(up);
  }

  function pick(row, keys) {
    var out = {};
    keys.forEach(function (k) {
      if (row && Object.prototype.hasOwnProperty.call(row, k)) out[k] = row[k];
    });
    return out;
  }

  function refusedColumns(sentKeys) {
    // PostgREST 一次只点名**第一列**（`Could not find the 'c' column of 'accounts'`），
    // 所以「哪几列没写进去」要按**这一发真发出去的那几列**来数，不能只认上游那一句 ——
    // 否则报告里永远只有一列，用户会以为只缺一列。
    return sentKeys.filter(function (k) { return MIGRATED.indexOf(k) >= 0; });
  }

  function noteDegrade(cols) {
    (cols.length ? cols : ["(未能定位列名)"]).forEach(function (c) {
      if (degraded.indexOf(c) < 0) degraded.push(c);
    });
  }

  function sendAccount(row) {
    return call("/accounts?on_conflict=uid", {
      method: "POST", body: row, prefer: "resolution=merge-duplicates,return=representation"
    }).then(function (rows) { return rows && rows[0] ? rows[0] : row; });
  }

  function readAccount(filter, hash) {
    return call("/accounts?" + filter + "&select=" + COLS + "&limit=1").then(function (rows) {
      return rows && rows[0] ? rows[0] : null;
    })["catch"](function (err) {
      // 旧形状的库上，`select` 里那几个迁移列不存在 —— 读也读不成。
      // 「读不出账号」不能变成 500：注册正是**靠这次读**判断是新号还是老号的，
      // 一炸用户就拿到「服务端出了点问题」。退到老列那份投影，把能读到的读回来。
      if (!isMissingColumn(err)) throw err;
      // ⚠️ 这里**只能**列老表真有的那批列。把迁移列写进来，第二发照样 400 ——
      //    那就等于没退，用户看到的还是 500。
      var CLS = ["uid", "email_hash", "email_mask", "nickname", "plan", "plan_until", "role",
        "created_at", "last_login_at", "status"];
      var second = call("/accounts?" + filter + "&select=" + CLS.join(",") + "&limit=1");
      // 第二发再被拒（表比第 5、6 节还老）时，也要**如实记降级**再退出，
      // 否则用户拿到 500、报告里还写着「一路都通」。
      second["catch"](function (e2) { noteDegrade(MIGRATED); });
      return second.then(function (rows) {
          noteDegrade(MIGRATED);
          return rows && rows[0] ? rows[0] : null;
        });
    });
  }

  function putAccount(acc) {
    // 第一发：老库认得的那批列。新库里这些列都有，所以这一步永远安全；
    // 少发列不会丢数据（幂等 upsert 只更新发过去的那几列）。
    var safeKeys = Object.keys(acc).filter(function (k) { return MIGRATED.indexOf(k) < 0; });
    var safe = pick(acc, safeKeys);
    var rest = pick(acc, MIGRATED);

    return sendAccount(safe)["catch"](function (err) {
      if (!isMissingColumn(err)) throw err;

      // 库是更老的形状（连安全列都缺）：只能降级到建表那批老列，
      // 并记下「哪几列没写进去」，由 /api/diag 与注册响应如实报出来。
      noteDegrade(refusedColumns(safeKeys));
      var CLS = ["uid", "email_hash", "email_mask", "nickname", "plan", "plan_until", "role",
        "created_at", "last_login_at", "status"];
      return sendAccount(pick(acc, CLS));
    }).then(function (saved) {
      if (!Object.keys(rest).length) return saved;

      // 第二发：补上迁移列。整发被拒（列根本不在）就降级，绝不抛给用户。
      return call("/accounts?uid=eq." + q(acc.uid), {
        method: "PATCH", body: rest, prefer: "return=minimal"
      }).then(function () {
        return saved;
      })["catch"](function (err) {
        if (!isMissingColumn(err)) throw err;
        noteDegrade(Object.keys(rest));
        return saved;
      });
    });
  }

  var COLS = "uid,email,email_hash,email_mask,nickname,plan,plan_until,role,created_at,last_login_at,status,email_verified_at,password_hash,password_salt";
  var q = encodeURIComponent;

  var api = {
    kind: "supabase",
    ready: function () { return !!base && !!KEY; },

    getAccountByHash: function (hash) {
      return readAccount("email_hash=eq." + q(hash), hash);
    },
    getAccount: function (uid) {
      return readAccount("uid=eq." + q(uid), uid);
    },
    putAccount: function (acc) {
      return putAccount(acc);
    },
    degrade: function () { return degraded.slice(); },
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

    listProgress: function (uid, child, since) {
      var cid = child == null ? "" : String(child);
      var p = "/progress?uid=eq." + q(uid) + "&child_id=eq." + q(cid)
            + "&select=poem_id,payload,updated_at,deleted";
      if (since) p += "&updated_at=gt." + q(since);
      return call(p);
    },

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

  return attachReportApi(api);
}

// ---- 报告台账（Supabase）-------------------------------------------------
// 与其它表同一条口径：service key 直连 PostgREST，RLS 全开且不给策略。
// 三条与 accounts/progress 不同的地方：
//   · `listReports` 的**排序在服务端做**（order=created_at.desc）——
//     客户端再排一次的下场是「分页时顺序与游标对不上」。
//   · `countReports` **一次查完再就近分组**（不查五次）—— 见它的正文。
//   · `patchReport` 返回 representation，因为内核要**回写之后那一条**
//     （不是回写前）。空返回会让界面上那一行停在旧状态。
var REPORT_COLS = "rid,uid,email_mask,nickname,kind,status,poem_id,poem_title,book," +
  "quote,context,note,suggestion,device,ua,created_at,updated_at,handled_at,handled_by,reply";

function reportFilterQs(filter) {
  var parts = [];
  if (filter && filter.uid) parts.push("uid=eq." + q(filter.uid));
  if (filter && filter.status) parts.push("status=eq." + q(filter.status));
  if (filter && filter.poemId) parts.push("poem_id=eq." + q(filter.poemId));
  return parts.length ? "&" + parts.join("&") : "";
}

function attachReportApi(api) {
  api.putReport = function (row) {
    return call("/reports", { method: "POST", body: row, prefer: "return=minimal" }).then(function () {
      return { rid: row.rid };
    });
  };
  api.getReport = function (rid) {
    return call("/reports?rid=eq." + q(rid) + "&select=" + REPORT_COLS + "&limit=1")
      .then(function (rows) { return rows && rows[0] ? rows[0] : null; });
  };
  api.listReports = function (filter, limit) {
    var p = "/reports?select=" + REPORT_COLS + reportFilterQs(filter) +
      "&order=created_at.desc&limit=" + encodeURIComponent(String(limit || 200));
    return call(p).then(function (rows) { return rows || []; });
  };
  api.patchReport = function (rid, patch) {
    return call("/reports?rid=eq." + q(rid), {
      method: "PATCH", body: patch, prefer: "return=representation"
    }).then(function (rows) { return rows && rows[0] ? rows[0] : null; });
  };
  api.countReports = function (filter) {
    // 状态分布**一次查完**：拉一次全量（上限 5000，台账量级远不到），
    // 在本地按状态分组。分五次查的下场是「五个数字来自五个不同的瞬间」——
    // 管理员正好在这五次之间改了一条状态，面板上就会出现
    // 「总计 12，各状态加起来 13」。
    var base = "/reports?select=status" + reportFilterQs(filter) + "&limit=5000";
    return call(base).then(function (rows) {
      var out = { all: 0 };
      ((require("./core").REPORT_STATUSES) || []).forEach(function (st) { out[st] = 0; });
      (rows || []).forEach(function (r) {
        out.all += 1;
        var st = String((r && r.status) || "new");
        out[st] = (out[st] || 0) + 1;
      });
      return out;
    });
  };
  api.countReportsByUid = function (uid, since) {
    var day = Number(since) - 86400000;
    return call("/reports?select=rid&uid=eq." + q(uid) + "&created_at=gt." + q(day) + "&limit=1000")
      .then(function (rows) { return (rows || []).length; });
  };
  return api;
}

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
