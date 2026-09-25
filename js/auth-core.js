(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AuthCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var NS = "poem_auth_v1";
  var SESSION_DAYS = 30;
  var SESSION_RENEW_DAYS = 15;
  var TRUST_DAYS = 30;
  var CODE_TTL_MS = 10 * 60 * 1000;
  var CODE_LEN = 6;
  var CODE_MAX_ATTEMPTS = 5;
  var RESEND_COOLDOWN_MS = 60 * 1000;

  var SMS_RESEND_COOLDOWN_MS = 60 * 1000;
  var PURPOSES = ["login", "reset"];
  var CHANNELS = ["email", "sms"];

  var RATE = {

    email: [[3600000, 5], [86400000, 10]],
    device: [[3600000, 10], [86400000, 30]],

    ip: [[3600000, 30], [86400000, 100]],
    global: [[3600000, 20], [86400000, 60]]
  };

  var RATE_SMS = {
    phone: [[3600000, 2], [86400000, 5], [2592000000, 15]]
  };

  var DISPOSABLE = [
    "mailinator", "10minutemail", "guerrillamail", "trashmail", "yopmail",
    "temp-mail", "tempmail", "sharklasers", "getnada", "throwaway",
    "dispostable", "mailnesia", "maildrop", "fakeinbox", "spambox"
  ];

  var ERR = {
    E_EMAIL_EMPTY: "请先填邮箱",
    E_EMAIL_FORMAT: "这个邮箱看起来不太对，再检查一下",
    E_PHONE_FORMAT: "这个手机号看起来不太对，再检查一下",
    E_RATE_EMAIL: "发得太快了，请稍后再试",
    E_RATE_DEVICE: "这台设备今天发送次数有点多，稍后再试",
    E_RATE_IP: "网络有点异常，稍后再试",
    E_RATE_GLOBAL: "服务忙，请稍后再试",
    E_NO_CODE: "请先获取验证码",
    E_CODE_EXPIRED: "验证码已过期，点「重新发送」",
    E_CODE_WRONG: "验证码不对，再检查一下",
    E_CODE_USED: "这个验证码已经用过了，请重新发送",
    E_CODE_VOID: "请用最新收到的验证码",
    E_LOCKED: "为了安全，请稍后再试",
    E_CHANNEL: "暂时不支持这种登录方式",
    E_SMS_NOT_OPEN: "短信登录还没开通（需要先签短信商并完成模板报备）。当前可用邮箱随机码登录",
    E_PURPOSE: "验证码用途不匹配，请重新获取",
    E_IDENTITY: "这个账号没有登记该登录方式",
    E_STORAGE: "浏览器不允许保存数据，本次登录刷新后会失效"
  };

  var now = function () { return Date.now(); };
  var rnd = function () { return Math.random(); };

  function setClock(fn) { now = typeof fn === "function" ? fn : function () { return Date.now(); }; }
  function setRandom(fn) { rnd = typeof fn === "function" ? fn : function () { return Math.random(); }; }

  function randHex(bytes) {
    var s = "";
    for (var i = 0; i < bytes; i++) {
      s += ("0" + Math.floor(rnd() * 256).toString(16)).slice(-2);
    }
    return s;
  }

  function digits(len) {
    var s = "";
    for (var i = 0; i < len; i++) s += String(Math.floor(rnd() * 10));
    return s;
  }

  function digest(str) {
    var h1 = 0x811c9dc5, h2 = 0x9e3779b9, i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 = (h2 + c) >>> 0; h2 = Math.imul(h2 ^ (h2 >>> 13), 0x85ebca6b) >>> 0;
    }
    var a = ("00000000" + h1.toString(16)).slice(-8);
    var b = ("00000000" + h2.toString(16)).slice(-8);
    return a + b;
  }

  function codeDigest(uid, purpose, code, salt) {
    return digest(String(uid) + "|" + String(purpose) + "|" + String(code) + "|" + String(salt));
  }

  function normalizeEmail(input) {
    if (typeof input !== "string") return "";
    return input
      .replace(/[\u200b-\u200d\ufeff]/g, "")
      .replace(/\s+/g, "")
      .toLowerCase();
  }

  var EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

  function isEmailShape(email) {
    if (!email) return false;
    if (email.length > 254) return false;
    var at = email.indexOf("@");
    if (at <= 0 || at !== email.lastIndexOf("@")) return false;
    if (at > 64) return false;
    var domain = email.slice(at + 1);
    if (domain.length > 253 || domain[0] === "." || domain.slice(-1) === ".") return false;
    if (domain.indexOf("..") >= 0) return false;
    if (email.slice(0, at).indexOf("..") >= 0) return false;
    return EMAIL_RE.test(email);
  }

  var TYPO_DOMAINS = ["163.com", "qq.com", "126.com", "gmail.com", "outlook.com", "sina.com", "foxmail.com"];
  var TYPO_MAP = {
    "163.con": "163.com", "163.co": "163.com", "163.om": "163.com",
    "qq.con": "qq.com", "q.com": "qq.com", "qq.co": "qq.com",
    "126.con": "126.com", "gmail.con": "gmail.com", "gmial.com": "gmail.com",
    "outlook.con": "outlook.com", "hotnail.com": "hotmail.com"
  };

  function emailHint(email) {
    var e = normalizeEmail(email);
    var at = e.indexOf("@");
    if (at < 0) return null;
    var domain = e.slice(at + 1);
    if (TYPO_MAP[domain]) return "是不是想填 " + e.slice(0, at + 1) + TYPO_MAP[domain] + "？";
    if (TYPO_DOMAINS.indexOf(domain) < 0 && domain.indexOf(".") > 0) return null;
    return null;
  }

  function isDisposable(email) {
    var e = normalizeEmail(email);
    if (e.indexOf("@") < 0) return false;
    var domain = e.split("@").pop();
    return DISPOSABLE.some(function (d) { return domain.indexOf(d) >= 0; });
  }

  // ⚠️ **邮箱没有掩码**（Issue #320）：`maskEmail()` 整块删掉了。
  //    本机这份账号记的是**明文邮箱**（`identities[].value`），
  //    界面上那个「点一下才显示」是**临时的显示状态**（`js/mine.js`），
  //    不是一份数据 —— 不需要在这里再维持一个掩码字段。
  //    手机号那一路的掩码留着（`maskPhone`，短信通道预留）。

  function maskPhone(v) {
    var s = normalizePhone(v);

    if (!isPhoneShape(s)) return "***";
    return s.slice(0, 3) + "****" + s.slice(-4);
  }

  function normalizePhone(input) {
    var s = String(input == null ? "" : input).replace(/[\s\-()\.]/g, "");
    return s.replace(/^\+?0*86/, "");
  }

  function isPhoneShape(v) {
    return /^1[3-9]\d{9}$/.test(normalizePhone(v));
  }

  function emptyState() {
    return {
      v: 1, accounts: {}, codes: {}, sessions: {}, rate: {},
      trusted: {}, profile: null, pepper: null, deviceId: null, tz: null
    };
  }

  function makeStore(backing) {
    var mem = {};
    var usable = true;
    if (!backing) {
      try { backing = typeof localStorage !== "undefined" ? localStorage : null; }
      catch (e) { backing = null; }
    }
    if (backing) { try { backing.getItem(NS); } catch (e) { usable = false; } }
    function raw() {
      if (!backing || !usable) return mem[NS];
      try { return backing.getItem(NS); } catch (e) { usable = false; return mem[NS]; }
    }
    function put(text) {
      mem[NS] = text;
      if (!backing || !usable) return;
      try { backing.setItem(NS, text); }
      catch (e) { usable = false; }
    }
    return {
      read: function () {
        var t = raw();
        if (!t) return emptyState();
        try {
          var o = JSON.parse(t);
          return o && typeof o === "object" ? sanitize(o) : emptyState();
        } catch (e) { return emptyState(); }
      },
      write: function (state) { put(JSON.stringify(state)); },
      persistent: function () { return !!backing && usable; }
    };
  }

  function sanitize(o) {
    var s = emptyState();
    if (!o || typeof o !== "object") return s;
    ["accounts", "codes", "sessions", "rate", "trusted"].forEach(function (k) {
      if (o[k] && typeof o[k] === "object" && !Array.isArray(o[k])) s[k] = o[k];
    });
    if (typeof o.pepper === "string" && o.pepper) s.pepper = o.pepper;
    if (typeof o.deviceId === "string" && /^d_[0-9a-f]{8}$/.test(o.deviceId)) s.deviceId = o.deviceId;
    if (o.profile && typeof o.profile === "object") s.profile = o.profile;
    if (typeof o.tz === "number") s.tz = o.tz;
    Object.keys(s.accounts).forEach(function (uid) {
      var a = s.accounts[uid];
      if (!a || typeof a !== "object" || typeof a.uid !== "string" || !Array.isArray(a.identities)) {
        delete s.accounts[uid];
      }
    });
    Object.keys(s.codes).forEach(function (id) {
      var c = s.codes[id];
      if (!c || typeof c !== "object" || typeof c.codeHash !== "string") delete s.codes[id];
    });
    return s;
  }

  function newUid() { return "u_" + randHex(4); }
  function newCodeId() { return "c_" + randHex(6); }

  function uniqueId(taken, base) {
    if (!taken || !taken[base]) return base;
    for (var i = 1; i <= 32; i++) {
      var cand = base + "-" + i;
      if (!taken[cand]) return cand;
    }
    return base + "-" + Date.now();
  }

  function nextCodeId(state) { return uniqueId(state.codes, newCodeId()); }

  function normIdentity(identity) {
    if (!identity || typeof identity !== "object") return null;
    var ch = identity.channel;
    if (CHANNELS.indexOf(ch) < 0) return null;
    var value = ch === "email" ? normalizeEmail(identity.value) : normalizePhone(identity.value);
    if (!value) return null;
    return { channel: ch, value: value };
  }

  function identityKey(id) { return id.channel + ":" + digest(id.value); }

  function findAccount(state, identity) {
    var id = normIdentity(identity);
    if (!id) return null;
    var key = identityKey(id);
    var uids = Object.keys(state.accounts);
    for (var i = 0; i < uids.length; i++) {
      var acc = state.accounts[uids[i]];
      for (var j = 0; j < acc.identities.length; j++) {
        if (acc.identities[j].key === key) return acc;
      }
    }
    return null;
  }

  function createAccount(state, identity) {
    var id = normIdentity(identity);
    var t = now();
    var uid = uniqueId(state.accounts, newUid());
    var acc = {
      uid: uid,
      // 明文邮箱（`value`）+ 它自己的摘要（`key`）。`value` 落本机存储、
      // 供「本机体验版」回显；`key` 是查找用的摘要。
      identities: [{ channel: id.channel, key: identityKey(id), value: id.value, verifiedAt: t }],
      profile: { nickname: "" },
      createdAt: t, updatedAt: t, lastLoginAt: t,
      status: "active",
      plan: { tier: "free", until: null },
      security: { codesToday: 0, codesDay: dayKey(t), failCount: 0, lockedUntil: null, pwVersion: null }
    };
    state.accounts[uid] = acc;
    return acc;
  }

  function dayKey(ts) { return new Date(ts).toISOString().slice(0, 10); }

  function ensureBase(state) {
    if (!state.pepper) state.pepper = randHex(16);
    if (!state.deviceId) state.deviceId = "d_" + randHex(4);
    return state;
  }

  function windowsFor(bucket) {
    if (bucket === "phone") return RATE_SMS.phone || [];
    return RATE[bucket] || [];
  }

  function rateCode(bucket) {
    if (bucket === "email" || bucket === "phone") return "E_RATE_EMAIL";
    if (bucket === "device") return "E_RATE_DEVICE";
    if (bucket === "ip") return "E_RATE_IP";
    return "E_RATE_GLOBAL";
  }

  function rateCounts(state, bucket, key, t) {
    var id = bucket + ":" + key;

    var arr = (state.rate[id] || []).filter(function (ts) { return ts > t - 2592000000; });
    state.rate[id] = arr;
    return arr;
  }

  function rateCheck(state, bucket, key, t) {
    var windows = windowsFor(bucket);
    var arr = rateCounts(state, bucket, key, t);
    for (var i = 0; i < windows.length; i++) {
      var span = windows[i][0], cap = windows[i][1];
      var hit = arr.filter(function (ts) { return ts > t - span; });
      if (hit.length >= cap) {
        var oldest = Math.min.apply(null, hit);
        return { ok: false, retryAfter: Math.ceil((oldest + span - t) / 1000) };
      }
    }
    return { ok: true, retryAfter: 0 };
  }

  function rateHit(state, bucket, key, t) {
    var id = bucket + ":" + key;
    state.rate[id] = (state.rate[id] || []).concat([t]);
  }

  function guardClock(state, t) {
    if (typeof state.tz === "number" && t < state.tz - 60000) {
      Object.keys(state.codes).forEach(function (k) {
        if (!state.codes[k].consumedAt) state.codes[k].consumedAt = t;
      });

      state.clockRewound = true;
      state.tz = t;
      return { rewound: true };
    }
    state.tz = Math.max(t, typeof state.tz === "number" ? state.tz : t);
    return { rewound: false };
  }

  function requestCode(store, identity, purpose, opts) {
    opts = opts || {};
    purpose = purpose || "login";
    if (PURPOSES.indexOf(purpose) < 0) return { ok: false, code: "E_PURPOSE", message: ERR.E_PURPOSE };

    var id = normIdentity(identity);
    if (!id) {
      var ch = identity && identity.channel;
      return { ok: false, code: ch && CHANNELS.indexOf(ch) < 0 ? "E_CHANNEL" : "E_EMAIL_EMPTY", message: ERR[ch && CHANNELS.indexOf(ch) < 0 ? "E_CHANNEL" : "E_EMAIL_EMPTY"] };
    }
    if (id.channel === "sms" && !isPhoneShape(id.value)) {
      return { ok: false, code: "E_PHONE_FORMAT", message: ERR.E_PHONE_FORMAT };
    }
    if (id.channel === "email" && !isEmailShape(id.value)) {
      return { ok: false, code: "E_EMAIL_FORMAT", message: ERR.E_EMAIL_FORMAT };
    }
    // 邮箱回明文、短信回掩码（Issue #320）：这一句是界面上的
    // 「已发往 xxx@yyy」，用户自己刚填的邮箱掩成 b***@163.com 毫无意义。
    var sentTo = id.channel === "email" ? id.value : maskPhone(id.value);

    var state = ensureBase(store.read());
    var t = now();
    guardClock(state, t);

    var key = identityKey(id);

    var bucket = id.channel === "sms" ? "phone" : "email";
    var gate = rateCheck(state, bucket, key, t);
    if (!gate.ok) {
      var gc = rateCode(bucket);
      return { ok: false, code: gc, retryAfter: gate.retryAfter, message: ERR[gc] };
    }

    var coolMs = bucket === "phone" ? SMS_RESEND_COOLDOWN_MS : RESEND_COOLDOWN_MS;
    var sent = rateCounts(state, bucket, key, t);
    if (sent.length && sent[sent.length - 1] > t - coolMs) {
      var wait = Math.ceil((sent[sent.length - 1] + coolMs - t) / 1000);
      return { ok: false, code: "E_RATE_EMAIL", retryAfter: wait, message: ERR.E_RATE_EMAIL };
    }
    gate = rateCheck(state, "device", state.deviceId, t);
    if (!gate.ok) return { ok: false, code: "E_RATE_DEVICE", retryAfter: gate.retryAfter, message: ERR.E_RATE_DEVICE };
    gate = rateCheck(state, "global", "all", t);
    if (!gate.ok) return { ok: false, code: "E_RATE_GLOBAL", retryAfter: gate.retryAfter, message: ERR.E_RATE_GLOBAL };

    var acc = findAccount(state, id) || createAccount(state, id);

    if (acc.security.lockedUntil && acc.security.lockedUntil > t) {
      return { ok: false, code: "E_LOCKED", retryAfter: Math.ceil((acc.security.lockedUntil - t) / 1000), message: ERR.E_LOCKED };
    }

    Object.keys(state.codes).forEach(function (cid) {
      var c = state.codes[cid];
      if (c.uid === acc.uid && c.purpose === purpose && !c.consumedAt) c.consumedAt = t;
    });

    if (acc.security.codesDay !== dayKey(t)) { acc.security.codesDay = dayKey(t); acc.security.codesToday = 0; }
    acc.security.codesToday += 1;
    if (acc.security.codesToday > 10) {
      acc.security.lockedUntil = t + 3600000;
      store.write(state);
      return { ok: false, code: "E_LOCKED", retryAfter: 3600, message: ERR.E_LOCKED };
    }

    var code = opts.code || digits(CODE_LEN);
    var salt = randHex(8);

    var rec = {
      codeId: nextCodeId(state),
      uid: acc.uid, purpose: purpose, channel: id.channel,
      sentTo: sentTo,
      codeHash: codeDigest(acc.uid, purpose, code, salt),
      salt: salt,
      issuedAt: t, expiresAt: t + CODE_TTL_MS,
      attempts: 0, consumedAt: null
    };
    state.codes[rec.codeId] = rec;
    rateHit(state, bucket, key, t);
    rateHit(state, "device", state.deviceId, t);
    rateHit(state, "global", "all", t);
    store.write(state);

    return {
      ok: true, codeId: rec.codeId, code: code, purpose: purpose, channel: id.channel,
      sentTo: rec.sentTo, expiresAt: rec.expiresAt, cooldown: Math.ceil(RESEND_COOLDOWN_MS / 1000),
      isNewAccount: acc.createdAt === acc.updatedAt,
      disposable: id.channel === "email" && isDisposable(id.value),
      hint: id.channel === "email" ? emailHint(id.value) : null
    };
  }

  function issueSession(state, acc, scope, t) {
    var sid = uniqueId(state.sessions, "s_" + randHex(8));
    var sess = { sid: sid, uid: acc.uid, scope: scope, iat: t, exp: t + SESSION_DAYS * 86400000, nonce: randHex(8) };
    state.sessions[sid] = sess;
    return sess;
  }

  function verifyCode(store, codeId, code, purpose) {
    purpose = purpose || "login";
    if (!codeId) return { ok: false, code: "E_NO_CODE", message: ERR.E_NO_CODE };
    var state = ensureBase(store.read());
    var t = now();
    guardClock(state, t);

    var rec = state.codes[codeId];
    if (!rec) return { ok: false, code: "E_CODE_VOID", message: ERR.E_CODE_VOID };
    if (rec.purpose !== purpose) return { ok: false, code: "E_PURPOSE", message: ERR.E_PURPOSE };
    if (rec.consumedAt) return { ok: false, code: "E_CODE_USED", message: ERR.E_CODE_USED };
    if (rec.expiresAt <= t) return { ok: false, code: "E_CODE_EXPIRED", message: ERR.E_CODE_EXPIRED };
    if (rec.attempts >= CODE_MAX_ATTEMPTS) return { ok: false, code: "E_CODE_VOID", message: ERR.E_CODE_VOID };

    var acc = state.accounts[rec.uid];
    if (!acc) return { ok: false, code: "E_CODE_VOID", message: ERR.E_CODE_VOID };
    if (acc.security.lockedUntil && acc.security.lockedUntil > t) {
      return { ok: false, code: "E_LOCKED", retryAfter: Math.ceil((acc.security.lockedUntil - t) / 1000), message: ERR.E_LOCKED };
    }

    var given = String(code == null ? "" : code).replace(/\D/g, "");
    var expect = codeDigest(acc.uid, purpose, given, rec.salt);

    var same = given.length === CODE_LEN && expect === rec.codeHash ? 1 : 0;

    if (!same) {
      rec.attempts += 1;
      acc.security.failCount += 1;
      if (rec.attempts >= CODE_MAX_ATTEMPTS) {
        rec.consumedAt = t;
        acc.security.failRounds = (acc.security.failRounds || 0) + 1;
      }

      if ((acc.security.failRounds || 0) >= 3) acc.security.lockedUntil = t + 86400000;
      store.write(state);
      var left = CODE_MAX_ATTEMPTS - rec.attempts;
      if (!left) return { ok: false, code: "E_CODE_VOID", message: ERR.E_CODE_VOID };
      return {
        ok: false, code: "E_CODE_WRONG", attemptsLeft: left,
        message: ERR.E_CODE_WRONG + "，还可以再试 " + left + " 次"
      };
    }

    rec.consumedAt = t;
    acc.lastLoginAt = t;
    acc.updatedAt = t;
    acc.security.failCount = 0;
    var sess = issueSession(state, acc, "account", t);
    state.trusted[acc.uid] = t + TRUST_DAYS * 86400000;
    store.write(state);
    return { ok: true, session: sess, account: publicAccount(acc), isLocalOnly: !store.persistent() };
  }

  function publicAccount(acc) {
    return {
      uid: acc.uid, status: acc.status,
      nickname: (acc.profile && acc.profile.nickname) || "",
      identities: acc.identities.map(function (i) {
        return { channel: i.channel, value: i.value || "", verifiedAt: i.verifiedAt };
      }),
      plan: acc.plan, createdAt: acc.createdAt, lastLoginAt: acc.lastLoginAt
    };
  }

  function session(store) {
    var state = ensureBase(store.read());
    var t = now();
    guardClock(state, t);
    var sids = Object.keys(state.sessions);
    if (!sids.length) return null;
    var sid = sids[sids.length - 1];
    var sess = state.sessions[sid];
    if (!sess || sess.exp <= t) {
      if (sess) { delete state.sessions[sid]; store.write(state); }
      return null;
    }
    if (sess.exp - t < SESSION_RENEW_DAYS * 86400000) {
      sess.exp = t + SESSION_DAYS * 86400000;
      store.write(state);
    }
    var acc = state.accounts[sess.uid];
    if (!acc || acc.status !== "active") return null;
    return { scope: sess.scope, exp: sess.exp, account: publicAccount(acc) };
  }

  function trustedAccount(store) {
    var state = ensureBase(store.read());
    var t = now();
    var hit = Object.keys(state.trusted).filter(function (uid) { return state.trusted[uid] > t; });
    if (hit.length !== 1) return null;
    var acc = state.accounts[hit[0]];
    return acc && acc.status === "active" ? publicAccount(acc) : null;
  }

  function signOut(store) {
    var state = ensureBase(store.read());
    state.sessions = {};
    state.codes = {};
    store.write(state);
    return { ok: true };
  }

  function signInTrusted(store) {
    var state = ensureBase(store.read());
    var t = now();
    var hit = Object.keys(state.trusted).filter(function (uid) { return state.trusted[uid] > t; });
    if (hit.length !== 1) return { ok: false, code: "E_IDENTITY", message: ERR.E_IDENTITY };
    var acc = state.accounts[hit[0]];
    if (!acc || acc.status !== "active") return { ok: false, code: "E_IDENTITY", message: ERR.E_IDENTITY };
    acc.lastLoginAt = t;
    var sess = issueSession(state, acc, "account", t);
    store.write(state);
    return { ok: true, session: sess, account: publicAccount(acc) };
  }

  function resetCredential(store, codeId, code) {
    var r = verifyCode(store, codeId, code, "reset");
    if (!r.ok) return r;
    var state = ensureBase(store.read());
    state.sessions = {};
    state.trusted = {};
    Object.keys(state.accounts).forEach(function (uid) {
      var a = state.accounts[uid];
      if (a.uid === r.account.uid) { a.security.failCount = 0; a.security.lockedUntil = null; }
    });
    store.write(state);
    return { ok: true, account: r.account };
  }

  function deleteAccount(store, emailConfirm) {
    var state = ensureBase(store.read());
    var t = now();
    var sess = session(store);
    if (!sess) return { ok: false, code: "E_IDENTITY", message: ERR.E_IDENTITY };
    var acc = state.accounts[sess.account.uid];
    if (!acc) return { ok: false, code: "E_IDENTITY", message: ERR.E_IDENTITY };
    var emailId = acc.identities.filter(function (i) { return i.channel === "email"; })[0];
    var want = emailId ? digest(normalizeEmail(emailConfirm)) : null;
    if (!want || want !== emailId.key.split(":")[1]) {
      return { ok: false, code: "E_EMAIL_FORMAT", message: "请输入注册时用的完整邮箱以确认" };
    }
    acc.status = "deleted";
    delete state.accounts[acc.uid];
    delete state.trusted[acc.uid];
    state.sessions = {};
    state.codes = {};
    store.write(state);
    return { ok: true, uid: acc.uid, t: t };
  }

  function mergePolicy(local, remote) {
    var l = local || {}, r = remote || {};
    var localIds = Object.keys(l.recs || {});
    var remoteIds = Object.keys(r.recs || {});
    if (!localIds.length && !remoteIds.length) return { action: "none", put: {}, take: [] };
    if (localIds.length && !remoteIds.length) return { action: "adoptLocal", put: l.recs, take: [] };
    if (!localIds.length && remoteIds.length) return { action: "takeRemote", put: {}, take: remoteIds };
    var put = {}, take = [], conflict = [];
    localIds.forEach(function (id) {
      var a = l.recs[id], b = r.recs[id];
      if (!b) { put[id] = a; return; }

      var better = (a.reps || 0) > (b.reps || 0) ? a
        : (a.reps || 0) < (b.reps || 0) ? b
        : (a.nextReviewAt || 0) >= (b.nextReviewAt || 0) ? a : b;
      if (better === b) take.push(id);
      else if (better === a) put[id] = a;
      else conflict.push(id);
    });
    remoteIds.forEach(function (id) { if (!put[id] && localIds.indexOf(id) < 0) take.push(id); });
    if (conflict.length) return { action: "ask", conflict: conflict, put: put, take: take };
    return { action: "merge", put: put, take: take };
  }

  function nickname(store) {
    var p = store.read().profile;
    return p && typeof p.nickname === "string" ? p.nickname : "";
  }

  function setNickname(store, name) {
    var state = ensureBase(store.read());
    var n = String(name == null ? "" : name).replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 12);
    state.profile = state.profile || {};
    state.profile.nickname = n;
    state.sessions && Object.keys(state.sessions).forEach(function (sid) {
      var acc = state.accounts[state.sessions[sid].uid];
      if (acc) { acc.profile.nickname = n; acc.updatedAt = now(); }
    });
    store.write(state);
    return n;
  }

  return {
    NS: NS, PURPOSES: PURPOSES, CHANNELS: CHANNELS, RATE: RATE, RATE_SMS: RATE_SMS, ERR: ERR,
    CODE_LEN: CODE_LEN, CODE_TTL_MS: CODE_TTL_MS, CODE_MAX_ATTEMPTS: CODE_MAX_ATTEMPTS,
    RESEND_COOLDOWN_MS: RESEND_COOLDOWN_MS, SMS_RESEND_COOLDOWN_MS: SMS_RESEND_COOLDOWN_MS,
    rateCode: rateCode,
    SESSION_DAYS: SESSION_DAYS, TRUST_DAYS: TRUST_DAYS, RATE: RATE,
    makeStore: makeStore, emptyState: emptyState,
    setClock: setClock, setRandom: setRandom,
    normalizeEmail: normalizeEmail, isEmailShape: isEmailShape, emailHint: emailHint,
    isDisposable: isDisposable, maskPhone: maskPhone,
    normalizePhone: normalizePhone, isPhoneShape: isPhoneShape,
    digest: digest, codeDigest: codeDigest,
    requestCode: requestCode, verifyCode: verifyCode,
    session: session, trustedAccount: trustedAccount, signInTrusted: signInTrusted,
    signOut: signOut, resetCredential: resetCredential, deleteAccount: deleteAccount,
    mergePolicy: mergePolicy, nickname: nickname, setNickname: setNickname,
    publicAccount: publicAccount
  };
});
