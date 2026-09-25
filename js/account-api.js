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

    // 「能不能进登录了才做得成的那件事」= 唯一出口 `Entitlement.cookieSession()`。
    //
    // ⚠️ 从前这里一律用 `hasLocalSession()`（只读本机会话），于是**服务端登录
    //    的人被自己的门挡在外面**：发报告、改昵称、传头像、看别人的账号名录
    //    全回「请先登录」，而他明明刚点完确认链接（Issue #274）。
    //    服务端那份答案（`poem_plan_v1` 里 `source: "server"` 那一份）
    //    同样是一份登录凭据 —— 它是 `/api/me` 认过人之后写下的。
    function signedIn() {
      var E = D.E;
      if (!E || typeof E.cookieSession !== "function") return hasLocalSession();
      try { return !!E.cookieSession({ backing: D.backing }); } catch (e) { return hasLocalSession(); }
    }

    // ⚠️ **别再用它当「登录了没」的判据**（Issue #274）。
    //
    // 它只回答「**本机**有没有一份会话」（`poem_auth_v1.sessions`），而服务端
    // 登录（口令 / 真邮件验证码 / 确认链接 / 重设）签的是 Cookie，本机一个字
    // 都没有。判登录状态一律走 `signedIn()`（→ `Entitlement.cookieSession()`）。
    // 它现在只剩一个用处：退出登录时决定要不要顺带清本机那份凭据（见下）。
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
        emailVerified: me.emailVerified === true,
        emailVerifiedAt: me.emailVerifiedAt == null ? null : Number(me.emailVerifiedAt),
        nickname: typeof me.nickname === "string" ? me.nickname : ""
      } : null;

      var plan = (me && me.plan) || {};
      var tier = E.isTier(plan.tier) ? plan.tier : "free";
      var until = plan.until == null ? null : Number(plan.until);
      // ⚠️ `uid` 一起写进去（Issue #276 后续）：这份答案**属于谁**必须跟着
      // 一起存，否则同一台机器换个人登录时，上一个人的 `role: "owner"`
      // 还是那一份 —— 新登录的普通用户会被当成管理员。
      // ⚠️ `email` 也一起写进去（Issue #274 / #320）：服务端登录的人本机没有
      //    会话，界面要显示「已登录 · xxx@yyy」（点开才显示）时，邮箱只能从
      //    这份缓存里取（它就是服务端那次 `/api/me` 原样给的，`publicAccount`
      //    的同一个字段）。
      var r = E.writeTier(D.backing, tier, until, {
        source: "server",
        role: E.isRole(me && me.role) ? me.role : null,
        email: (me && me.email) || "",
        uid: (me && me.uid) || ""
      });

      adoptAvatar(me);

      return !!(r && r.ok);
    }

    // 头像字节跨设备（Issue #243 后续 · 用户口径「能上云的全上」）。
    //
    // 已登录时头像的权威地址在服务器（Storage 桶里那张图），本机只留一份
    // 副本供断网时显示。所以在**新设备上第一次拿到 /api/me** 时要把地址
    // 写回账号域 —— 不写的话，换台设备头像就退回昵称首字（用户会以为
    // 「头像没同步」）。这是唯一一处能写回的地方：/api/me 是账号事实的
    // 唯一来路，散在几个页面里各写一遍必然漏。
    //
    // 本机那份 data URL 副本仍然保留（它就是「传不上去时还能看」的那一份），
    // 所以这里只在**地址与手上这份不一样**时才写。
    //
    // ⚠️ 判据是「不一样」，不是「手上这份是空的」（Issue #320）。
    //    原先写的是 `if (cur && cur.img) return false`，于是地址一旦写进去
    //    就再也不更新 —— 可服务器那把地址的**缓存破参数是每次上传都会换的**
    //    （`/api/avatar/...?v=<时间戳>`）。换头像之后本机那条地址停在旧 `?v=`，
    //    浏览器拿到的还是旧那张图。子用户切的正是「谁的头像」这件事，
    //    于是同一条 bug 露出两个症状：切了孩子，头像没跟着换。
    function adoptAvatar(me) {
      var AV = D.AV;
      if (!AV || !AV.avatar || !AV.setAvatar || !D.backing) return false;
      var url = String((me && me.avatar) || "").trim();
      if (!url || !AV.isImgUrl || !AV.isImgUrl(url)) return false;
      var cur = null;
      try { cur = AV.avatar(D.backing) || {}; } catch (e) { cur = null; }
      if (cur && cur.img === url) return false;
      // ⚠️ 只比较**这张图是谁的**那一刻：本机那份字节（LOCAL_NS）仍是优先显示
      //    的那一份，所以地址换了不等于用户当下会看到新脸 —— 真要立刻换脸，
      //    得把本机那份字节一并清掉（此刻手上没有被处理过的字节）。
      try { return !!AV.setAvatar(D.backing, { img: url }); } catch (e) { return false; }
    }

    function clearServerTier() {
      var E = D.E;
      if (!E) return false;

      try {
        // ⚠️ 判据从「有没有服务端层级」放宽到「**这一份是不是服务端的**」
        //    （Issue #276 后续）：退出登录时要清掉的是**上一位的整个答案**
        //    （tier 与 role 一起）。只看 tier 的话，一位 free 的管理员
        //    退出后 `tier: "free"` 是假值，那一行 `role: "owner"` 反而留在
        //    本机 —— 下一个登录的人就继承了他的管理后台入口。
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

      // ⚠️ 这里原先挡着一道 `if (!opt2.force && !hasLocalSession()) return GUEST`
      //    （Issue #274）—— 它读的是**本机** `poem_auth_v1.sessions`，而服务端
      //    登录的人本机一份会话都没有。后果有两层：
      //      ① `/api/me` **从来没被调用过**，明文邮箱、确认状态、子用户上限、
      //         服务端层级与角色全停在出厂态；
      //      ② 「有没有登录」在本机被答成 false，于是设置页那些「登录可用」
      //         永远不亮。
      //    现在**开机就问一次服务端**：服务端回 401（`E_NO_SESSION`）才是
      //    真的没登录，那一条下面接得住（`clearServerTier()` 顺手把缓存清掉）。
      //    这一发是 `credentials: "same-origin"` 的 GET，没 Cookie 时开销极小；
      //    `AccountApi.refreshMe()` 又是**单例**的（多张页面复用同一发）。
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
            role: r.role, email: r.email, uid: r.uid, me: r
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
      if (!channel || !signedIn()) {

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
      if (!signedIn()) return Promise.resolve({ ok: false, reason: REASON.GUEST, code: "E_NO_SESSION" });
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
      if (!signedIn()) { clearLocal(); return Promise.resolve({ ok: true, reason: REASON.GUEST, remote: "none" }); }
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
      if (!signedIn()) {
        return Promise.resolve({ ok: false, reason: REASON.GUEST, message: "请先登录再来发名单" });
      }
      var ch = grantChannel();
      if (!ch) {
        return Promise.resolve({
          ok: false, reason: REASON_NO_CHANNEL,
          message: "页面脚本版本对不上（刷新一次即可），这一轮没发出任何东西"
        });
      }
      return ch.grant({ uid: o.uid, tier: o.tier, until: o.until }).then(function (r) {
        if (r && r.ok) {

          return {
            ok: true, reason: REASON.OK,
            matched: r.matched, changed: r.changed, ambiguous: !!r.ambiguous,
            email: r.email, tier: r.tier, until: r.until == null ? null : r.until,
            uid: r.uid, before: r.before, note: r.note
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
      if (!signedIn()) return Promise.resolve({ ok: false, reason: REASON.GUEST });
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
      if (!signedIn()) return Promise.resolve({ ok: false, reason: REASON.GUEST });
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

    // ---- 用户报告 / 勘误（Issue #243 第四轮）-----------------------------
    // 三条与 adminGrant 那一族不同的地方：
    //   · **游客也能读自己那一份**？不能 —— 服务端认人。所以没登录时
    //     直接回 `guest`，界面去画本机那一份（js/report.js 有兜底）。
    //   · 报告是**加密钥**的：`report` / `myReports` 都用同一个 channel。
    //     不复用 grantChannel（那一族要三个方法齐备，报告不需要）。
    //   · 错误码原样带出去（E_RATE_REPORT / E_EMPTY 这些），
    //     因为界面要按码说不同的话，而不是笼统一句「没发出去」。
    function reportChannel() {
      var ch = usable(D.api) || (D.make ? safeCreate(D.make) : null);
      return ch && typeof ch.report === "function" ? ch : null;
    }

    function report(input) {
      var o = input || {};
      if (!signedIn()) return Promise.resolve({ ok: false, reason: REASON.GUEST, code: "E_NO_SESSION" });
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
      if (!signedIn()) return Promise.resolve({ ok: false, reason: REASON.GUEST, code: "E_NO_SESSION" });
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
      if (!signedIn()) return Promise.resolve({ ok: false, reason: REASON.GUEST });
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
      if (!signedIn()) return Promise.resolve({ ok: false, reason: REASON.GUEST });
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

    // 改别人的角色（Issue #276）：与 adminGrant 同一族（同一个 channel、
    // 同一套 reason 归类），因为它们的失败形态一模一样（未登录 / 没配 /
    // 连不上 / 服务端拒绝）。
    function adminSetRole(input) {
      var o = input || {};
      if (!signedIn()) return Promise.resolve({ ok: false, reason: REASON.GUEST });
      var ch = usable(D.api) || (D.make ? safeCreate(D.make) : null);
      if (!ch || typeof ch.setRole !== "function") return Promise.resolve({ ok: false, reason: REASON_NO_CHANNEL });
      return ch.setRole({ uid: o.uid, role: o.role }).then(function (r) {
        if (r && r.ok) {
          return {
            ok: true, reason: REASON.OK,
            uid: r.uid, role: r.role, before: r.before, changed: r.changed,
            email: r.email, note: r.note
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
      if (!signedIn()) return Promise.resolve({ ok: false, reason: REASON.GUEST });
      var ch = grantChannel();
      if (!ch) return Promise.resolve({ ok: false, reason: REASON_NO_CHANNEL });
      return ch.revoke({ uid: o.uid }).then(function (r) {
        if (r && r.ok) return { ok: true, reason: REASON.OK, matched: r.matched, changed: r.changed, uid: r.uid, email: r.email };
        var code = (r && r.code) || "E_OFFLINE";
        if (code === "E_NOT_CONFIGURED") return { ok: false, reason: REASON.NOT_CONFIGURED };
        if (code === "E_NO_SESSION") return { ok: false, reason: REASON.GUEST };
        if (code === "E_FORBIDDEN") return { ok: false, reason: REASON.OK, code: code, message: r && r.message };
        return { ok: false, reason: REASON.UNAVAILABLE };
      }).catch(function () { return { ok: false, reason: REASON.UNAVAILABLE }; });
    }

    // -------------------------------------------------------------------
    // 昵称（Issue #278）
    // -------------------------------------------------------------------
    // 昵称是**账号域**的东西（换台设备应该还在），所以它必须落服务器。
    // 这里的三档与 resendVerification 同源：GUEST（没登录）/ NOT_CONFIGURED
    // （这台服务器没开放云端账号）/ UNAVAILABLE（连不上）。
    // **任何一档都不拦人**：名字没同步上，比「进不去」轻得多 ——
    // 本机那一份仍然写下了（调用方负责），页面如实说一句就是了。
    function setNickname(input) {
      var o = input || {};
      // ⚠️ 这里**不能**像别的写口那样先用 `hasLocalSession()` 挡一道。
      // 那一位读的是**本机** `poem_auth_v1.sessions`，而「服务器上的账号」
      // 恰恰是另一回事：刚注册完（或刚点开确认链接）的人，本机一个会话
      // 都没有，但服务端已经给了 Cookie —— 先挡一道就会把**唯一需要它的人**
      // 挡在门外（症状是「起了名，换台设备名字没了，而且一句提示都不说」）。
      // 登录与否由服务端说了算：它回 401 就是没登录，那一条下面接得住。
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

    // 退出登录（Issue #274）：本机那一份由 `AuthCore.signOut()` 清，
    // **服务端那一枚 Cookie 必须由这里撤掉**。
    //
    // ⚠️ 它**不受 `signedIn()` 的挡**：退出恰恰是「自认为没登录、其实还登录着」
    //    的那一刻最需要它（`poem_plan_v1` 被清掉之后 `cookieSession()` 就没人
    //    答得上来了）。服务端本来不认识这枚 Cookie 也回 200（幂等）。
    //
    // ⚠️ 退出的结果是**干净的一份**：服务端撤会话 + 清掉那份服务端答案缓存
    //    （`clearServerTier()`）—— 后者是界面「登录了没」的判据，不清的话
    //    界面上那颗键会一直写着「退出登录」。
    function signOut() {
      var ch = usable(D.api) || (D.make ? safeCreate(D.make) : null);
      var done = function (reason) {
        clearServerTier();
        return { ok: true, reason: reason || REASON.OK, signedOut: true };
      };
      if (!ch || typeof ch.logout !== "function") return Promise.resolve(done(REASON_NO_CHANNEL));
      return Promise.resolve(ch.logout()).then(function () {
        return done(REASON.OK);
      })["catch"](function () {
        return done(REASON.UNAVAILABLE);
      });
    }

    function resendVerification() {
      if (!signedIn()) {
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
            email: r.email || ""
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
      if (!signedIn()) {
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
      signedIn: signedIn,
      signOut: signOut,
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
    signedIn: function (o) { return boundOnce(o).signedIn(o); },
    signOut: function (o) { return boundOnce(o).signOut(o); },
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
