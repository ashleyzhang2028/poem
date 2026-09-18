"use strict";

var handler = require("../_lib/handler");
var H = require("../_lib/http");
var identity = require("../_lib/identity");

var TABLES = ["accounts", "codes", "sessions", "progress", "verifications", "resets"];

var ACCOUNT_COLS = [
  "uid", "email", "email_hash", "email_mask", "nickname", "plan", "plan_until", "role",
  "created_at", "last_login_at", "status", "email_verified_at", "password_hash", "password_salt"
];

var PROGRESS_COLS = ["uid", "child_id", "poem_id", "payload", "updated_at", "deleted"];

function originOf(d, req) {
  var proto = String((req.headers || {})["x-forwarded-proto"] || "https").split(",")[0].trim();
  var host = String((req.headers || {})["x-forwarded-host"] || (req.headers || {}).host || "localhost").split(",")[0].trim();
  if (!/^[a-z]+$/.test(proto)) proto = "https";
  if (!/^[A-Za-z0-9.:_-]+$/.test(host)) host = "localhost";
  var cfgSite = String(d.cfg.siteUrl || "").replace(/\/+$/, "");
  return { siteUrl: cfgSite, current: proto + "://" + host };
}

function originMatch(a, b) {
  function norm(u) {
    return String(u || "").replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
  }
  return !!a && !!b && norm(a) === norm(b);
}

function dbProbe(d, table, select) {
  var store = d.store;
  if (!store || store.kind !== "supabase") return Promise.resolve(null);
  var key = String(d.cfg.supabaseServiceKey || "");
  var base = String(d.cfg.supabaseUrl || "").replace(/\/+$/, "");
  var url = base + "/rest/v1/" + table + "?select=" + encodeURIComponent(select) + "&limit=1";
  var started = Date.now();

  function maskedTarget() {
    try {
      var h = new URL(base).host;
      var head = h.slice(0, 3);
      var tail = h.slice(-12);
      return head + "…" + tail;
    } catch (e) {
      return "(URL 形状不对，无法解析主机名)";
    }
  }

  return fetch(url, {
    headers: { apikey: key, Authorization: "Bearer " + key }
  }).then(function (r) {
    return r.text().then(function (t) {
      return { status: r.status, body: String(t).slice(0, 300), ms: Date.now() - started };
    });
  }).catch(function (e) {
    var msg = String((e && e.message) || e);
    var cause = e && e.cause ? String(e.cause.code || e.cause.message || e.cause) : "";
    return { status: 0, body: cause ? msg + " (" + cause + ")" : msg, ms: Date.now() - started };
  }).then(function (raw) {
    var verdict;
    if (raw.status === 0) {
      verdict = "连不上：域名解析或网络不通（多半是 SUPABASE_URL 拼错，或项目被暂停）";
    } else if (raw.status === 404) {
      verdict = "表不存在：建表 SQL（api/_lib/schema.sql）没跑，或只跑了一半";
    } else if (raw.status === 401 || raw.status === 403) {
      verdict = "密钥不对：SUPABASE_SERVICE_KEY 填成了 anon key，或改完没重新部署";
    } else if (raw.status === 400) {
      verdict = "列不对：表在，但形状是旧的（缺本次登录流程新加的列）—— 跑 schema.sql 里补列的那一段";
    } else if (raw.status === 200) {
      verdict = "通";
    } else {
      verdict = "上游回了 " + raw.status;
    }
    return {
      table: table,
      target: maskedTarget(),
      ms: raw.ms,
      httpStatus: raw.status,
      verdict: verdict,
      upstream: raw.status === 200 ? null : raw.body
    };
  });
}

function writeProbe(d) {
  var store = d.store;
  if (!store || store.kind !== "supabase") return Promise.resolve(null);
  var KEY = String(d.cfg.supabaseServiceKey || "");
  var base = String(d.cfg.supabaseUrl || "").replace(/\/+$/, "");
  var uid = "u_diag" + identity.newUid().slice(2);
  var row = {
    uid: uid,
    child_id: "",
    poem_id: "__diag__",
    payload: { diag: true },
    updated_at: Date.now(),
    deleted: 0
  };
  var t0 = Date.now();
  return fetch(base + "/rest/v1/progress", {
    method: "POST",
    headers: {
      apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(row)
  }).then(function (r) {
    if (!r.ok) {
      return r.text().then(function (t) {
        return r.status === 404
          ? { ok: false, ms: Date.now() - t0, verdict: "表不存在或主键形状不对（(uid, child_id, poem_id) 三列主键要一起在）" }
          : { ok: false, ms: Date.now() - t0, verdict: "写入失败（HTTP " + r.status + "）", upstream: String(t).slice(0, 300) };
      });
    }
    return { ok: true, ms: Date.now() - t0, verified: false, cleanup: false };
  }).then(function (out) {
    if (!out.ok) return out;
    return fetch(base + "/rest/v1/progress?uid=eq." + encodeURIComponent(uid) + "&poem_id=eq.__diag__", {
      headers: { apikey: KEY, Authorization: "Bearer " + KEY }
    }).then(function (r) { return r.json(); }).then(function (rows) {
      out.verified = !!(rows && rows.length);
      if (!out.verified) out.verdict = "写进去读不回来（多半是 RLS 或服务端没给 service_role 权限）";
      return out;
    })["catch"](function () { return out; });
  }).then(function (out) {
    return fetch(base + "/rest/v1/progress?uid=eq." + encodeURIComponent(uid), {
      method: "DELETE",
      headers: { apikey: KEY, Authorization: "Bearer " + KEY, Prefer: "return=minimal" }
    }).then(function () { out.cleanup = true; return out; })["catch"](function () { return out; });
  })["catch"](function (e) {
    var cause = e && e.cause ? String(e.cause.code || e.cause.message || e.cause) : "";
    return {
      ok: false,
      ms: Date.now() - t0,
      verdict: "写测试行时连不上",
      upstream: (String((e && e.message) || e) + (cause ? " (" + cause + ")" : "")).slice(0, 300)
    };
  });
}

var VERDICT_TEXT = {
  no_secret: "缺 SESSION_SECRET：会话签不出来，所有 /api/* 会回 503（本站仍可离线用，这是设计好的降级）",
  db_not_configured: "缺 SUPABASE_URL / SUPABASE_SERVICE_KEY：账号只活在当前实例的内存里，重启即丢。注册能成，但换设备 / 重启后就找不回来",
  db_unreachable: "连不上数据库：注册时请求直接挂掉，界面显示「服务端出了点问题，稍后再试」",
  db_bad_key: "数据库密钥不对：同上，注册会 500",
  db_no_table: "表还没建：在 Supabase 的 SQL Editor 里整段执行 api/_lib/schema.sql",
  db_no_column: "表是旧形状：跑 api/_lib/schema.sql 里补列（ALTER）的那一段",
  db_write_fail: "表能读不能写：注册会在写账号那一步失败（比如 RLS 开了却没给 service_role 权限）",
  api_not_mounted: "本站的 /api/* 没挂到函数上 —— 你访问的这个域名上和 SITE_URL（本应用写进邮件里的地址）对不上，注册请求压根没到本站的服务端。多半是这次部署 `/api/*` 没接上，重新部署一次再看",
  ok: "一路都通：注册出问题就不在配置这一层了，请把本页的「服务端自报」整段贴给 CodeBuddy"
};

function verdictOf(r) {
  if (!r.session.ok) return "no_secret";
  if (r.database.mode !== "supabase") return "db_not_configured";
  var probe = r.database.probe || {};
  if (probe.connect && probe.connect.httpStatus === 0) return "db_unreachable";
  if (probe.connect && (probe.connect.httpStatus === 401 || probe.connect.httpStatus === 403)) return "db_bad_key";
  if (probe.connect && probe.connect.httpStatus === 404) return "db_no_table";
  if (probe.connect && probe.connect.httpStatus === 400) return "db_no_column";
  if (probe.tables && probe.tables.length) {
    var hit = probe.tables.filter(function (t) { return t.httpStatus !== 200; })[0];
    if (hit) return hit.httpStatus === 404 ? "db_no_table" : (hit.httpStatus === 400 ? "db_no_column" : "db_unreachable");
  }
  if (probe.write && probe.write.ok === false) return "db_write_fail";
  if (probe.columns && probe.columns.accounts && probe.columns.accounts.ok === false) return "db_no_column";
  if (probe.columns && probe.columns.progress && probe.columns.progress.ok === false) return "db_no_column";
  if (r.database.degraded && r.database.degraded.length) return "db_no_column";
  return "ok";
}

function sessionReport(d) {
  var key = d.cfg.sessionKeyOf.call(d.cfg);
  return { ok: key.length >= 16, keyLength: key.length, cookieName: d.cfg.cookieName };
}

function mailReport(d) {
  return { transport: d.cfg.mail(), real: d.cfg.mail() !== "console" };
}

module.exports = handler.make("diag", ["GET"], function (d, body, req) {
  var o = originOf(d, req);
  var r = {
    generatedAt: new Date().toISOString(),
    site: {
      siteUrl: o.siteUrl,
      currentOrigin: o.current,
      match: originMatch(o.siteUrl, o.current),
      apiBase: "/api"
    },
    session: sessionReport(d),
    database: { mode: (d.store && d.store.kind) || "unknown" },
    mail: mailReport(d),
    limits: { passwordMin: d.cfg.passwordMin, passwordMax: d.cfg.passwordMax },
    turnstile: {
      server: !!handler.core.turnstileReady(d.cfg),
      bypass: d.cfg.turnstileBypass === true,
      enabledFlag: d.cfg.turnstileEnabled === true,
      hasSiteKey: !!d.cfg.turnstileSiteKey,
      hasSecretKey: !!d.cfg.turnstileSecretKey
    }
  };

  var jobs = [dbProbe(d, "accounts", ACCOUNT_COLS.join(","))];

  if (r.database.mode === "supabase") {
    var base = String(d.cfg.supabaseUrl || "").replace(/\/+$/, "");
    r.database.target = (function () {
      try { return "…" + new URL(base).host.slice(-12); } catch (e) { return "(无法解析)"; }
    })();
    r.serviceKeyShape = (function () {
      var k = String(d.cfg.supabaseServiceKey || "");
      if (!k) return "missing";
      if (k.indexOf("sb_publishable") === 0 || k.indexOf("eyJhbGciOi") === 0) {
        try {
          var mid = JSON.parse(Buffer.from(k.split(".")[1], "base64").toString("utf8"));
          if (mid && mid.role === "anon") return "anon（错了：必须是 service_role）";
          if (mid && mid.role === "service_role") return "service_role（正确）";
        } catch (e) { return "看起来是 JWT，但解不出来"; }
      }
      return "不是 JWT（旧版 anon key 或填错了）";
    })();

    jobs.push(Promise.all(TABLES.map(function (t) {
      return dbProbe(d, t, PROGRESS_COLS.indexOf("payload") >= 0 && t === "progress" ? "uid" : "uid");
    })).then(function (rows) {
      r.database.probe = { connect: rows[0], tables: rows };
    }));

    jobs.push(Promise.all([
      dbProbe(d, "accounts", ACCOUNT_COLS.join(",")),
      dbProbe(d, "progress", PROGRESS_COLS.join(","))
    ]).then(function (rows) {
      r.database.columns = {
        accounts: { ok: rows[0].httpStatus === 200, missingHint: rows[0].httpStatus === 200 ? null : "缺本次登录流程新加的列（email / email_verified_at / password_hash / password_salt）" },
        progress: { ok: rows[1].httpStatus === 200, missingHint: rows[1].httpStatus === 200 ? null : "缺 child_id（主键是 (uid, child_id, poem_id)）" }
      };
    }));

    jobs.push(writeProbe(d).then(function (w) { r.database.probe.write = w; }));
  } else {
    r.database.probe = { connect: null, tables: [], write: null };
  }

  return Promise.all(jobs).then(function () {
    var code = verdictOf(r);
    var out = { verdict: code, verdictText: VERDICT_TEXT[code] };

    out.site = r.site;
    out.session = r.session;
    out.mail = r.mail;
    out.limits = r.limits;
    out.turnstile = r.turnstile;
    out.serviceKeyShape = r.serviceKeyShape || null;
    out.database = {
      mode: r.database.mode,

      // 写不进去的列（旧形状库）—— 空的才许报「一路都通」。
      // 这是**服务端自报**，和「上游探针通不通」是两件事：上游全通、
      // 但注册那一发被 42703 拒掉，正是这次用户遇到的那一档。
      degraded: (function () {
        try { return typeof d.store.degrade === "function" ? (d.store.degrade() || []) : []; } catch (e) { return []; }
      })(),
      target: r.database.target || null,
      reachable: r.database.probe.connect ? r.database.probe.connect.httpStatus : null,
      connect: r.database.probe.connect,
      tables: r.database.probe.tables || [],
      columns: r.database.columns || null,
      write: r.database.probe.write || null
    };
    out.checks = [
      { name: "带不带查询串都要能到本站", hint: "回「The page could not be found」= Vercel 平台层的 404，不是本站（本站的 404 是 JSON，形如 {\"code\":\"E_404\"}）" },
      { name: "会话密钥 ≥ 16 字符", ok: out.session.ok },
      { name: "环境里确实有密码用的 pepper（就是 SESSION_SECRET）", hint: "缺了它，密码登录永远报「邮箱或密码不对」，而注册照样成功" },
      { name: "数据库配置", ok: out.database.mode === "supabase", hint: out.database.mode === "supabase" ? null : "内存模式：账号重启即丢" },
      { name: "六张表都在", ok: out.database.tables.length ? out.database.tables.every(function (t) { return t.httpStatus === 200; }) : null },
      { name: "表形状是新的（accounts 的 14 列 + progress 的 child_id）", ok: out.database.columns ? (out.database.columns.accounts.ok && out.database.columns.progress.ok) : null },
      { name: "能写进去（真跑一次 INSERT + DELETE）", ok: out.database.write ? out.database.write.ok : null }
    ];
    out.nextSteps = [
      { n: 1, name: "API 形态", cmd: "curl -sS -o /dev/null -w '%{http_code}\\n' https://<你的域名>/api/config" },
      { n: 2, name: "会话可签", cmd: "curl -sS https://<你的域名>/api/me" },
      { n: 3, name: "库能不能读（期望 200）", cmd: "curl -sS -o /dev/null -w '%{http_code}\\n' \"$SUPABASE_URL/rest/v1/accounts?select=uid&limit=1\" -H \"apikey: $SUPABASE_SERVICE_KEY\" -H \"Authorization: Bearer $SUPABASE_SERVICE_KEY\"" },
      { n: 4, name: "库能不能写", cmd: "curl -sS -o /dev/null -w '%{http_code}\\n' -X POST \"$SUPABASE_URL/rest/v1/codes\" -H \"apikey: $SUPABASE_SERVICE_KEY\" -H \"Authorization: Bearer $SUPABASE_SERVICE_KEY\" -H 'Content-Type: application/json' -H 'Prefer: return=minimal' -d '{\"code_id\":\"diag-tmp\",\"uid\":\"u_diag\",\"purpose\":\"diag\",\"code_hash\":\"x\",\"salt\":\"x\",\"created_at\":0,\"expires_at\":0,\"consumed_at\":null,\"attempts\":0}'" },
      { n: 5, name: "注册真跑一遍", cmd: "curl -sS -i -X POST https://<你的域名>/api/register -H 'Content-Type: application/json' -d '{\"email\":\"you+diag@example.com\",\"password\":\"diagtest12345\",\"deviceId\":\"diag\"}'" },
      { n: 6, name: "服务端日志里搜", cmd: "Vercel → Logs，搜 api.error，把那一行的 error 字段贴回来" }
    ];
    out.neverSend = ["SESSION_SECRET 的值", "SUPABASE_SERVICE_KEY 的值", "SUPABASE_DB_URL", "用户密码", "任何完整邮箱"];

    return { status: 200, body: { code: "E_DIAG", message: "诊断报告见 body", report: out }, headers: { "Cache-Control": "no-store" } };
  });
});
