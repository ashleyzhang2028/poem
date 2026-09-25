(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AccountApi = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var BASE = "/api";

  var REASON = {

    OK: "ok",

    GUEST: "guest",

    NOT_CONFIGURED: "not-configured",

    UNAVAILABLE: "unavailable"
  };

  var REASON_NO_CHANNEL = "no-channel";

  function deps(o) {
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    var d = o || {};
    return {
      api: d.api || (g && g.AuthApi) || null,

      make: d.make || (d.api && d.api.create) || (g && g.AuthApi && g.AuthApi.create) || null,
      E: d.E || (g && g.Entitlement) || null,
      A: d.A || (g && g.AuthCore) || null,

      AV: d.AV || (g && g.Avatar) || null,
      backing: d.backing || (g && g.localStorage) || null,
      now: d.now || function () { return Date.now(); }
    };
  }

  function bind(opt) {
    var D = deps(opt);
    var channel = usable(D.api) || (D.make ? safeCreate(D.make) : null);

    var last = { reason: null, at: 0 };

    function usable(ch) {
      return ch && typeof ch.me === "function" && typeof ch.deleteAccount === "function"
        ? ch : null;
    }

    function grantChannel() {
      var ch = usable(D.api) || (D.make ? safeCreate(D.make) : null);
      return ch && typeof ch.grant === "function" && typeof ch.revoke === "function" &&
        typeof ch.grants === "function" ? ch : null;
    }

    function safeCreate(make) {
      try {

        var dev = "";
        try {
          var A = D.A, b = D.backing;
          if (A && A.makeStore && b) {
            var st = A.makeStore(b);
            dev = (st && st.read() && st.read().deviceId) || "";
          }
        } catch (e) { dev = ""; }
        return usable(make({ deviceId: dev }));
      } catch (e) { return null; }
    }

    function hasLocalSession() {
      var A = D.A;
      if (!A || !A.makeStore || !A.session || !D.backing) return false;
      try {
        var st = A.makeStore(D.backing);
        return !!A.session(st);
      } catch (e) { return false; }
    }

    var lastChannel = null;

    var lastAccount = null;

    function applyMe(me) {
      var E = D.E;
      if (!E || !E.writeTier || !D.backing) return false;

      lastChannel = (me && me.channel && typeof me.channel === "object") ? {
        mail: typeof me.channel.mail === "string" ? me.channel.mail : null,
        delivered: me.channel.delivered === true,
        db: typeof me.channel.db === "string" ? me.channel.db : null,
        sms: me.channel.sms === true,

        emailGate: me.channel.emailGate === true ? true : (me.channel.emailGate === false ? false : null),
        emailDeliverable: me.channel.emailDeliverable === true ? true : (me.channel.emailDeliverable === false ? false : null)
      } : null;

      lastAccount = (me && typeof me === "object") ? {
        avatar: typeof me.avatar === "string" ? me.avatar : "",
        uid: typeof me.uid === "string" ? me.uid : null,
        email: typeof me.email === "string" ? me.email : "",
        mask: typeof me.mask === "string" ? me.mask : "",
        emailVerified: me.emailVerified === true,
        emailVerifiedAt: me.emailVerifiedAt == null ? null : Number(me.emailVerifiedAt),
        nickname: typeof me.nickname === "string" ? me.nickname : ""
      } : null;

      var plan = (me && me.plan) || {};
      var tier = E.isTier(plan.tier) ? plan.tier : "free";
      var until = plan.until == null ? null : Number(plan.until);

      var r = E.writeTier(D.backing, tier, until, {
        source: "server",
        role: E.isRole(me && me.role) ? me.role : null,
        uid: (me && me.uid) || ""
      });

      adoptAvatar(me);

      return !!(r && r.ok);
    }

    function adoptAvatar(me) {
      var AV = D.AV;
      if (!AV || !AV.avatar || !AV.setAvatar || !D.backing) return false;
      var url = String((me && me.avatar) || "").trim();
      if (!url || !AV.isImgUrl || !AV.isImgUrl(url)) return false;
      var cur = null;
      try { cur = AV.avatar(D.backing) || {}; } catch (e) { cur = null; }
      if (cur && cur.img) return false;
      try { return !!AV.setAvatar(D.backing, { img: url }); } catch (e) { return false; }
    }

    function clearServerTier() {
      var E = D.E;
      if (!E) return false;

      try {

        var plan = E.readPlan ? E.readPlan(D.backing) : null;
        if (plan && plan.source === "server") {
          if (E.clearTier) E.clearTier(D.backing);

          lastAccount = null;
          return true;
        }
      } catch (e) {  }
      return false;
    }

    function refreshMe(o) {
      var opt2 = o || {};
      var t = D.now();
      last = { reason: null, at: t };

      if (!opt2.force && !hasLocalSession()) {

        last.reason = REASON.GUEST;
        return Promise.resolve({ ok: false, reason: REASON.GUEST, guest: true });
      }
      if (!channel) {
        last.reason = REASON.NOT_CONFIGURED;
        return Promise.resolve({ ok: false, reason: REASON.NOT_CONFIGURED });
      }

      return channel.me().then(function (r) {
        if (r && r.ok) {
          applyMe(r);
          last.reason = REASON.OK;
          return {
            ok: true, reason: REASON.OK,
            tier: r.plan ? r.plan.tier : undefined,
            role: r.role, mask: r.mask, uid: r.uid, me: r
          };
        }
        var code = (r && r.code) || "E_OFFLINE";
        if (code === "E_NO_SESSION") {

          clearServerTier();
          last.reason = REASON.GUEST;
          return { ok: false, reason: REASON.GUEST };
        }
        if (code === "E_NOT_CONFIGURED") {
          last.reason = REASON.NOT_CONFIGURED;
          return { ok: false, reason: REASON.NOT_CONFIGURED, message: r && r.message };
        }

        last.reason = REASON.UNAVAILABLE;
        return { ok: false, reason: REASON.UNAVAILABLE, message: r && r.message };
      }).catch(function () {
        last.reason = REASON.UNAVAILABLE;
        return { ok: false, reason: REASON.UNAVAILABLE };
      });
    }

    function deleteAccount(o) {
      var opt2 = o || {};
      var A = D.A;
      var exportData = null;

      function finishLocal() {

        var local = { ok: false };
        try {
          if (A && A.makeStore && A.deleteAccount && D.backing) {
            local = A.deleteAccount(A.makeStore(D.backing), opt2.email);
          }
        } catch (e) { local = { ok: false, message: "本机账号清不掉，请刷新页面重试" }; }
        return local;
      }

      if (opt2.confirm !== true) {
        return Promise.resolve({
          ok: false, remote: "none", reason: REASON.GUEST, local: { ok: false },
          message: "请先确认要注销这个账号"
        });
      }
      if (!channel || !hasLocalSession()) {

        var l1 = finishLocal();
        return Promise.resolve({
          ok: l1.ok, remote: "none",
          reason: !channel ? REASON.NOT_CONFIGURED : REASON.GUEST,
          local: l1, message: l1.message
        });
      }

      return channel.deleteAccount({ confirm: true }).then(function (r) {
        if (r && r.ok) {
          exportData = r.export || null;
          var l2 = finishLocal();
          return {
            ok: l2.ok, remote: "deleted", reason: REASON.OK,
            export: exportData, local: l2, message: l2.message
          };
        }
        var code = (r && r.code) || "E_OFFLINE";
        if (code === "E_NO_SESSION") {

          var l3 = finishLocal();
          return { ok: l3.ok, remote: "none", reason: REASON.GUEST, local: l3, message: l3.message };
        }
        if (code === "E_NOT_CONFIGURED") {
          var l4 = finishLocal();
          return { ok: l4.ok, remote: "none", reason: REASON.NOT_CONFIGURED, local: l4, message: l4.message };
        }

        var l5 = finishLocal();
        return {
          ok: l5.ok, remote: "skipped", reason: REASON.UNAVAILABLE,
          local: l5, message: l5.message
        };
      }).catch(function () {
        var l6 = finishLocal();
        return { ok: l6.ok, remote: "skipped", reason: REASON.UNAVAILABLE, local: l6, message: l6.message };
      });
    }

    var REASON_NO_CHANNEL = "no-channel";

    function uploadAvatar(input) {
      var o = input || {};
      if (!hasLocalSession()) return Promise.resolve({ ok: false, reason: REASON.GUEST, code: "E_NO_SESSION" });
      var ch = avatarChannel();
      if (!ch) return Promise.resolve({ ok: false, reason: REASON_NO_CHANNEL });
      return Promise.resolve(ch.uploadAvatar({ blob: o.blob, type: o.type })).then(function (r) {
        if (r && r.ok && r.url) {

          var AV = D.AV;
          if (AV && AV.setAvatar) {
            try { AV.setAvatar(D.backing, { img: r.url }); } catch (e) {  }
          }
          return { ok: true, reason: REASON.OK, url: r.url, bytes: r.bytes, note: r.note };
        }
        var code = (r && r.code) || "E_OFFLINE";
        if (code === "E_NOT_CONFIGURED") return { ok: false, reason: REASON.NOT_CONFIGURED, code: code, message: r && r.message };
        if (code === "E_NO_SESSION") return { ok: false, reason: REASON.GUEST, code: code, message: r && r.message };
        return { ok: false, reason: REASON.UNAVAILABLE, code: code, message: r && r.message };
      })["catch"](function () { return { ok: false, reason: REASON.UNAVAILABLE, code: "E_OFFLINE" }; });
    }

    function deleteAvatar() {
      var AV = D.AV;
      function clearLocal() {
        if (AV && AV.resetAvatar) {
          try { AV.resetAvatar(D.backing); } catch (e) {  }
        }
      }
      if (!hasLocalSession()) { clearLocal(); return Promise.resolve({ ok: true, reason: REASON.GUEST, remote: "none" }); }
      var ch = avatarChannel();
      if (!ch) { clearLocal(); return Promise.resolve({ ok: true, reason: REASON_NO_CHANNEL, remote: "none" }); }
      return Promise.resolve(ch.deleteAvatar()).then(function (r) {
        clearLocal();
        if (r && r.ok) return { ok: true, reason: REASON.OK, remote: "deleted" };
        var code = (r && r.code) || "E_OFFLINE";
        if (code === "E_NOT_CONFIGURED") return { ok: true, reason: REASON.NOT_CONFIGURED, remote: "none" };
        if (code === "E_NO_SESSION") return { ok: true, reason: REASON.GUEST, remote: "none" };

        return { ok: true, reason: REASON.UNAVAILABLE, remote: "skipped", code: code };
      })["catch"](function () { clearLocal(); return { ok: true, reason: REASON.UNAVAILABLE, remote: "skipped" }; });
    }

    function avatarChannel() {
      var ch = usable(D.api) || (D.make ? safeCreate(D.make) : null);
      return ch && typeof ch.uploadAvatar === "function" && typeof ch.deleteAvatar === "function" ? ch : null;
    }

    function adminGrant(input) {
      var o = input || {};
      if (!hasLocalSession()) {
        return Promise.resolve({ ok: false, reason: REASON.GUEST, message: "请先登录再来发名单" });
      }
      var ch = grantChannel();
      if (!ch) {
        return Promise.resolve({
          ok: false, reason: REASON_NO_CHANNEL,
          message: "页面脚本版本对不上（刷新一次即可），这一轮没发出任何东西"
        });
      }
      return ch.grant({ emailMask: o.emailMask, tier: o.tier, until: o.until }).then(function (r) {
        if (r && r.ok) {

          return {
            ok: true, reason: REASON.OK,
            matched: r.matched, changed: r.changed, ambiguous: !!r.ambiguous,
            emailMask: r.emailMask, tier: r.tier, until: r.until == null ? null : r.until,
            uid: r.uid, note: r.note
          };
        }
        var code = (r && r.code) || "E_OFFLINE";
        if (code === "E_NOT_CONFIGURED") return { ok: false, reason: REASON.NOT_CONFIGURED, message: r && r.message };
        if (code === "E_NO_SESSION") {
          clearServerTier();
          return { ok: false, reason: REASON.GUEST, message: "登录状态已过期，请重新登录" };
        }

        return { ok: false, reason: REASON.OK, code: code, message: r && r.message, retryAfter: r && r.retryAfter };
      }).catch(function () {
        return { ok: false, reason: REASON.UNAVAILABLE, message: "连不上服务端，这一轮没发出任何东西" };
      });
    }

    function adminGrants() {
      if (!hasLocalSession()) return Promise.resolve({ ok: false, reason: REASON.GUEST });
      var ch = grantChannel();
      if (!ch) return Promise.resolve({ ok: false, reason: REASON_NO_CHANNEL });
      return ch.grants().then(function (r) {
        if (r && r.ok) return { ok: true, reason: REASON.OK, grants: r.grants || [], store: r.store };
        var code = (r && r.code) || "E_OFFLINE";
        if (code === "E_NOT_CONFIGURED") return { ok: false, reason: REASON.NOT_CONFIGURED };
        if (code === "E_NO_SESSION") return { ok: false, reason: REASON.GUEST };
        if (code === "E_FORBIDDEN") return { ok: false, reason: REASON.OK, code: code, message: r && r.message };
        return { ok: false, reason: REASON.UNAVAILABLE };
      }).catch(function () { return { ok: false, reason: REASON.UNAVAILABLE }; });
    }

    function adminAccounts() {
      if (!hasLocalSession()) return Promise.resolve({ ok: false, reason: REASON.GUEST });
      var ch = usable(D.api) || (D.make ? safeCreate(D.make) : null);
      if (!ch || typeof ch.accounts !== "function") return Promise.resolve({ ok: false, reason: REASON_NO_CHANNEL });
      return ch.accounts().then(function (r) {
        if (r && r.ok) return { ok: true, reason: REASON.OK, accounts: r.accounts || [], total: r.total, store: r.store };
        var code = (r && r.code) || "E_OFFLINE";
        if (code === "E_NOT_CONFIGURED") return { ok: false, reason: REASON.NOT_CONFIGURED };
        if (code === "E_NO_SESSION") return { ok: false, reason: REASON.GUEST };
        if (code === "E_FORBIDDEN") return { ok: false, reason: REASON.OK, code: code, message: r && r.message };
        return { ok: false, reason: REASON.UNAVAILABLE };
      })["catch"](function () { return { ok: false, reason: REASON.UNAVAILABLE }; });
    }

    function reportChannel() {
      var ch = usable(D.api) || (D.make ? safeCreate(D.make) : null);
      return ch && typeof ch.report === "function" ? ch : null;
    }

    function report(input) {
      var o = input || {};
      if (!hasLocalSession()) return Promise.resolve({ ok: false, reason: REASON.GUEST, code: "E_NO_SESSION" });
      var ch = reportChannel();
      if (!ch) return Promise.resolve({ ok: false, reason: REASON_NO_CHANNEL, code: "E_NO_CHANNEL" });
      return ch.report(o).then(function (r) {
        if (r && r.ok) return { ok: true, reason: REASON.OK, rid: r.rid, createdAt: r.createdAt, remaining: r.remaining };
        var code = (r && r.code) || "E_OFFLINE";
        if (code === "E_NOT_CONFIGURED") return { ok: false, reason: REASON.NOT_CONFIGURED, code: code };
        if (code === "E_NO_SESSION") return { ok: false, reason: REASON.GUEST, code: code };
        return { ok: false, reason: REASON.OK, code: code, message: r && r.message };
      })["catch"](function () { return { ok: false, reason: REASON.UNAVAILABLE, code: "E_OFFLINE" }; });
    }

    function myReports(input) {
      var o = input || {};
      if (!hasLocalSession()) return Promise.resolve({ ok: false, reason: REASON.GUEST, code: "E_NO_SESSION" });
      var ch = usable(D.api) || (D.make ? safeCreate(D.make) : null);
      if (!ch || typeof ch.myReports !== "function") {
        return Promise.resolve({ ok: false, reason: REASON_NO_CHANNEL, code: "E_NO_CHANNEL" });
      }
      return ch.myReports({ limit: o.limit }).then(function (r) {
        if (r && r.ok) return { ok: true, reason: REASON.OK, reports: r.reports || [] };
        var code = (r && r.code) || "E_OFFLINE";
        if (code === "E_NOT_CONFIGURED") return { ok: false, reason: REASON.NOT_CONFIGURED, code: code };
        if (code === "E_NO_SESSION") return { ok: false, reason: REASON.GUEST, code: code };
        return { ok: false, reason: REASON.UNAVAILABLE, code: code };
      })["catch"](function () { return { ok: false, reason: REASON.UNAVAILABLE, code: "E_OFFLINE" }; });
    }

    function adminReports(input) {
      var o = input || {};
      if (!hasLocalSession()) return Promise.resolve({ ok: false, reason: REASON.GUEST });
      var ch = usable(D.api) || (D.make ? safeCreate(D.make) : null);
      if (!ch || typeof ch.adminReports !== "function") {
        return Promise.resolve({ ok: false, reason: REASON_NO_CHANNEL });
      }
      return ch.adminReports({ status: o.status, poemId: o.poemId, limit: o.limit }).then(function (r) {
        if (r && r.ok) {
          return { ok: true, reason: REASON.OK, reports: r.reports || [], counts: r.counts || {}, total: r.total, store: r.store };
        }
        var code = (r && r.code) || "E_OFFLINE";
        if (code === "E_NOT_CONFIGURED") return { ok: false, reason: REASON.NOT_CONFIGURED };
        if (code === "E_NO_SESSION") return { ok: false, reason: REASON.GUEST };
        if (code === "E_FORBIDDEN") return { ok: false, reason: REASON.OK, code: code, message: r && r.message };
        return { ok: false, reason: REASON.UNAVAILABLE };
      })["catch"](function () { return { ok: false, reason: REASON.UNAVAILABLE }; });
    }

    function adminReportPatch(input) {
      var o = input || {};
      if (!hasLocalSession()) return Promise.resolve({ ok: false, reason: REASON.GUEST });
      var ch = usable(D.api) || (D.make ? safeCreate(D.make) : null);
      if (!ch || typeof ch.adminReportPatch !== "function") {
        return Promise.resolve({ ok: false, reason: REASON_NO_CHANNEL });
      }
      return ch.adminReportPatch({ rid: o.rid, status: o.status, reply: o.reply }).then(function (r) {
        if (r && r.ok) return { ok: true, reason: REASON.OK, report: r.report };
        var code = (r && r.code) || "E_OFFLINE";
        if (code === "E_NOT_CONFIGURED") return { ok: false, reason: REASON.NOT_CONFIGURED };
        if (code === "E_NO_SESSION") return { ok: false, reason: REASON.GUEST };
        if (code === "E_FORBIDDEN") return { ok: false, reason: REASON.OK, code: code, message: r && r.message };
        return { ok: false, reason: REASON.UNAVAILABLE };
      })["catch"](function () { return { ok: false, reason: REASON.UNAVAILABLE }; });
    }

    function adminSetRole(input) {
      var o = input || {};
      if (!hasLocalSession()) return Promise.resolve({ ok: false, reason: REASON.GUEST });
      var ch = usable(D.api) || (D.make ? safeCreate(D.make) : null);
      if (!ch || typeof ch.setRole !== "function") return Promise.resolve({ ok: false, reason: REASON_NO_CHANNEL });
      return ch.setRole({ uid: o.uid, role: o.role }).then(function (r) {
        if (r && r.ok) {
          return {
            ok: true, reason: REASON.OK,
            uid: r.uid, role: r.role, before: r.before, changed: r.changed,
            emailMask: r.emailMask, note: r.note
          };
        }
        var code = (r && r.code) || "E_OFFLINE";
        if (code === "E_NOT_CONFIGURED") return { ok: false, reason: REASON.NOT_CONFIGURED, code: code, message: r && r.message };
        if (code === "E_NO_SESSION") return { ok: false, reason: REASON.GUEST, code: code, message: r && r.message };
        return { ok: false, reason: REASON.OK, code: code, message: r && r.message };
      })["catch"](function () { return { ok: false, reason: REASON.UNAVAILABLE, code: "E_OFFLINE" }; });
    }

    function adminRevoke(input) {
      var o = input || {};
      if (!hasLocalSession()) return Promise.resolve({ ok: false, reason: REASON.GUEST });
      var ch = grantChannel();
      if (!ch) return Promise.resolve({ ok: false, reason: REASON_NO_CHANNEL });
      return ch.revoke({ emailMask: o.emailMask }).then(function (r) {
        if (r && r.ok) return { ok: true, reason: REASON.OK, matched: r.matched, changed: r.changed, emailMask: r.emailMask };
        var code = (r && r.code) || "E_OFFLINE";
        if (code === "E_NOT_CONFIGURED") return { ok: false, reason: REASON.NOT_CONFIGURED };
        if (code === "E_NO_SESSION") return { ok: false, reason: REASON.GUEST };
        if (code === "E_FORBIDDEN") return { ok: false, reason: REASON.OK, code: code, message: r && r.message };
        return { ok: false, reason: REASON.UNAVAILABLE };
      }).catch(function () { return { ok: false, reason: REASON.UNAVAILABLE }; });
    }

    function setNickname(input) {
      var o = input || {};

      var ch = usable(D.api) || (D.make ? safeCreate(D.make) : null);
      if (!ch || typeof ch.setNickname !== "function") {
        return Promise.resolve({ ok: false, reason: REASON_NO_CHANNEL, code: "E_NO_CHANNEL" });
      }
      return Promise.resolve(ch.setNickname({ nickname: o.nickname })).then(function (r) {
        if (r && r.ok) {
          return { ok: true, reason: REASON.OK, nickname: r.nickname || "", account: r.account || null };
        }
        var code = (r && r.code) || "E_OFFLINE";
        if (code === "E_NOT_CONFIGURED") return { ok: false, reason: REASON.NOT_CONFIGURED, code: code };
        if (code === "E_NO_SESSION") {
          clearServerTier();
          return { ok: false, reason: REASON.GUEST, code: code };
        }
        return { ok: false, reason: REASON.UNAVAILABLE, code: code, message: r && r.message };
      })["catch"](function () {
        return { ok: false, reason: REASON.UNAVAILABLE, code: "E_OFFLINE" };
      });
    }

    function resendVerification() {
      if (!hasLocalSession()) {
        return Promise.resolve({ ok: false, reason: REASON.GUEST, code: "E_NO_SESSION" });
      }
      var ch = usable(D.api) || (D.make ? safeCreate(D.make) : null);
      if (!ch || typeof ch.resendVerification !== "function") {
        return Promise.resolve({ ok: false, reason: REASON_NO_CHANNEL, code: "E_NO_CHANNEL" });
      }
      return ch.resendVerification().then(function (r) {
        if (r && r.ok) {
          return {
            ok: true, reason: REASON.OK,
            alreadyVerified: r.alreadyVerified === true,

            verifySent: r.verifySent === true,
            verifyAttempts: Number(r.verifyAttempts) || 1,
            verifyReason: r.verifyReason || null,
            emailMask: r.emailMask || ""
          };
        }
        var code = (r && r.code) || "E_OFFLINE";
        if (code === "E_NOT_CONFIGURED") return { ok: false, reason: REASON.NOT_CONFIGURED, code: code };
        if (code === "E_NO_SESSION") return { ok: false, reason: REASON.GUEST, code: code };
        return { ok: false, reason: REASON.UNAVAILABLE, code: code, message: r && r.message };
      })["catch"](function () {
        return { ok: false, reason: REASON.UNAVAILABLE, code: "E_OFFLINE" };
      });
    }

    function gameAnswer(input) {
      var o = input || {};
      if (!hasLocalSession()) {
        return Promise.resolve({ ok: false, reason: REASON.GUEST, status: 401, code: "E_NO_SESSION" });
      }
      var ch = usable(D.api) || (D.make ? safeCreate(D.make) : null);
      if (!ch || typeof ch.gameAnswer !== "function") {
        return Promise.resolve({ ok: false, reason: REASON_NO_CHANNEL, status: 0, code: "E_NO_CHANNEL" });
      }
      return ch.gameAnswer({
        kind: o.kind, bankId: o.bankId, poemId: o.poemId,
        chosen: o.chosen, chars: o.chars, said: o.said, charge: o.charge === true
      }).then(function (r) {
        if (r && r.ok) return { ok: true, status: 200, body: r };
        var code = (r && r.code) || "E_OFFLINE";
        if (code === "E_NOT_CONFIGURED") return { ok: false, reason: REASON.NOT_CONFIGURED, status: 503, code: code };
        if (code === "E_NO_SESSION") return { ok: false, reason: REASON.GUEST, status: 401, code: code };

        if (code === "E_TIER" || code === "E_FORBIDDEN") {
          return { ok: false, reason: REASON.OK, status: 403, code: code, message: r && r.message, tier: r && r.tier };
        }
        if (code === "E_RATE_DEVICE") return { ok: false, reason: REASON.OK, status: 429, code: code };
        if (code === "E_STALE") return { ok: false, reason: REASON.OK, status: 400, code: code, message: r && r.message };
        return { ok: false, reason: REASON.UNAVAILABLE, status: 0, code: code };
      })["catch"](function () {
        return { ok: false, reason: REASON.UNAVAILABLE, status: 0, code: "E_OFFLINE" };
      });
    }

    return {

      last: function () { return { reason: last.reason, at: last.at }; },

      channel: function () { return lastChannel; },

      account: function () { return lastAccount; },
      hasLocalSession: hasLocalSession,
      applyMe: applyMe,
      clearServerTier: clearServerTier,
      refreshMe: refreshMe,
      deleteAccount: deleteAccount,
      resendVerification: resendVerification,
      setNickname: setNickname,

      uploadAvatar: uploadAvatar,
      deleteAvatar: deleteAvatar,

      adminGrant: adminGrant,
      adminGrants: adminGrants,
      adminRevoke: adminRevoke,
      adminAccounts: adminAccounts,
      adminSetRole: adminSetRole,

      report: report,
      myReports: myReports,
      adminReports: adminReports,
      adminReportPatch: adminReportPatch,

      gameAnswer: gameAnswer
    };
  }

  var globalPromise = null;
  var globalBound = null;

  function boundOnce(opt) {
    if (!globalBound) globalBound = bind(opt);
    return globalBound;
  }

  function refreshOnce(opt) {
    if (!globalPromise) {
      globalPromise = boundOnce(opt).refreshMe(opt).then(function (r) {

        return r;
      });
    }
    return globalPromise;
  }

  function reset() {
    globalPromise = null;
    globalBound = null;
  }

  return {
    BASE: BASE,
    REASON: REASON,
    bind: bind,
    refreshMe: refreshOnce,

    deleteAccount: function (o) { return boundOnce(o).deleteAccount(o); },

    adminGrant: function (o) { return boundOnce(o).adminGrant(o); },
    adminGrants: function (o) { return boundOnce(o).adminGrants(o); },
    adminRevoke: function (o) { return boundOnce(o).adminRevoke(o); },
    adminSetRole: function (o) { return boundOnce(o).adminSetRole(o); },

    report: function (o) { return boundOnce(o).report(o); },
    myReports: function (o) { return boundOnce(o).myReports(o); },
    adminReports: function (o) { return boundOnce(o).adminReports(o); },
    adminReportPatch: function (o) { return boundOnce(o).adminReportPatch(o); },

    uploadAvatar: function (o) { return boundOnce(o).uploadAvatar(o); },
    deleteAvatar: function (o) { return boundOnce(o).deleteAvatar(o); },

    adminAccounts: function (o) { return boundOnce(o).adminAccounts(o); },

    gameAnswer: function (o) { return (globalBound || (globalBound = bind(o))).gameAnswer(o); },
    applyMe: function (o) { return boundOnce(o).applyMe(o); },
    clearServerTier: function (o) { return boundOnce(o).clearServerTier(o); },
    hasLocalSession: function (o) { return boundOnce(o).hasLocalSession(o); },
    last: function () { return globalBound ? globalBound.last() : { reason: null, at: 0 }; },
    channel: function () { return globalBound ? globalBound.channel() : null; },
  account: function () { return globalBound ? globalBound.account() : null; },
  resendVerification: function () {
    return globalBound ? globalBound.resendVerification()
      : Promise.resolve({ ok: false, reason: REASON.NOT_CONFIGURED, code: "E_NOT_CONFIGURED" });
  },
    reset: reset
  };
});
