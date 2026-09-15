/**
 * 服务端账号的**唯一接线处**（Issue #132 · 2 期 补洞 + 2A）
 * ==========================================================================
 * 1A/1B 把服务端建好了，但**前端有两根线一直没接**：
 *
 *   ① `GET /api/me` 从没有页面调用过 —— 于是服务端判定的层级与角色
 *      没有下发到界面（`js/entitlement.js` 的注释里那句「1 期接服务端后
 *      这里改成读 /api/me」一直没兑现）。Pro/Max 的唯一合法挂载点空着，
 *      3 期的收费就没有落点。
 *   ② `DELETE /api/account` 写好了，`js/auth-api.js` 里也有 `deleteAccount()`，
 *      但**没有任何页面调它** —— `js/profile.js` 注销时走的仍是本机内核
 *      那个版本，只删本机那一份。一个走服务端登录的人在个人中心点注销，
 *      **云端那一行还在**。这是合规问题（删除权），不是体验问题。
 *
 * 本文件把那两根线接上，**并且只接这一次**：
 * 页面不各自 `fetch("/api/me")`、不各自读 Cookie、不各自拼存储键 ——
 * 有源码扫描守着（test/account-bind.test.js）。
 *
 * 2.2 期（Issue #159）在这里又加了一组：**权威发放**（`/api/admin/grant`）。
 * 它是本项目第一条「能改别人数据」的写接口，但**这一层不判权限** ——
 * 判权限在服务端（`accounts.role`），客户端把入口藏起来从来不是安全边界。
 *
 * ## 四条不可退让的边界（1A 立的，这一层一条都不许破）
 *
 * 1. **失败不打断任何事** —— 连不上、503、401、超时，一律只是
 *    「这一轮没问成」，不弹窗、不报错、更不影响背诵。所有调用都包在
 *    `guard()` 里，任何异常都在那里被吞掉。
 * 2. **不假装** —— 服务端不可用时如实回 `{ ok:false, degraded:true, reason }`，
 *    界面据此说「本机登记」，绝不把本机那份说成「服务器判定」。
 *    `reason` 只有四种取值，每一种界面上有一句话对应（不合并成「失败」）。
 * 3. **不清用户数据** —— 拉不到 `/api/me` 时**不删**本机那份层级缓存
 *    （删了等于「后端抖一下，用户层级回落 Free」——那是产品级事故）。
 * 4. **不做无谓请求** —— `refreshMe()` 有一道**同会话只问一次**的闸；
 *    没登录（本机会话为空）时直接返回，一个请求都不发。
 *
 * ## 与 `js/auth-api.js` 的分工
 *
 *   auth-api.js   只管**传输**：一条路一个方法，返回 `{ok, code, message}`。
 *   本文件        只管**接线**：把 `/api/me` 的答案写进权益层、把注销
 *                 真的送到服务端、把结果如实回给界面。
 *   于是换传输（比如将来换成同源外的域名）只改前者的 base，业务代码不动。
 *
 * ⚠️ 本文件**不 import 任何东西**、不碰 `document`，可在 Node 里 require。
 *    依赖全部现取（`globalThis.AuthApi` / `globalThis.Entitlement` /
 *    `globalThis.AuthCore`），**不在模块加载时缓存** —— 缓存一份的后果是
 *    「脚本顺序一变就永远抓到 null」，而症状是**静默失效**（不报错、
 *    只是层级永远不更新）。这条与 `js/storage.js` 的 `PS()`、
 *    `js/sync-store.js` 的 `engine()` 是同一条教训。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AccountApi = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var BASE = "/api";

  /** `refreshMe()` 的结果分类。**四种各说各的话**，界面不许把它们合并成「失败」 */
  var REASON = {
    /* 问到了 —— 层级与角色已由服务端判定 */
    OK: "ok",
    /* 没有会话（未登录 / 会话过期）：这是**正常状态**，不是错误 */
    GUEST: "guest",
    /* 本站还没开放云端账号（缺服务端密钥，接口回 503）—— 本期常态 */
    NOT_CONFIGURED: "not-configured",
    /* 这会儿连不上（断网 / 超时 / 5xx）—— 这一轮没问成，下次再说 */
    UNAVAILABLE: "unavailable"
  };

  /** 2.2 多出来的一种：通道里**没有发放方法**（老缓存里的旧 AuthApi）。
      它既不是「没配好」也不是「没权限」，界面上要说的话不一样 —— 刷新即可。 */
  var REASON_NO_CHANNEL = "no-channel";

  /** 依赖现取：脚本顺序不保证，缓存一份就会静默失效 */
  function deps(o) {
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    var d = o || {};
    return {
      api: d.api || (g && g.AuthApi) || null,
      /* 测试注入用：AuthApi 是个工厂，造通道要调 create() */
      make: d.make || (d.api && d.api.create) || (g && g.AuthApi && g.AuthApi.create) || null,
      E: d.E || (g && g.Entitlement) || null,
      A: d.A || (g && g.AuthCore) || null,
      backing: d.backing || (g && g.localStorage) || null,
      now: d.now || function () { return Date.now(); }
    };
  }

  /**
   * 造一个通道适配器。
   *
   * @param {object} opt  { api, E, A, backing, now }
   *   · api  —— 一个 AuthApi 通道（测试里给假的）。不传就现造一个。
   */
  function bind(opt) {
    var D = deps(opt);
    var channel = usable(D.api) || (D.make ? safeCreate(D.make) : null);

    /* 每一次 `refreshMe()` 的结果（供页面只读）。**不是缓存** ——
       它只回答「上一轮问了什么」，不参与判权。 */
    var last = { reason: null, at: 0 };

    /**
     * 一个通道要能用，必须**同时有 me 与 deleteAccount 两个方法**。
     *
     * 为什么要一这道闸：注入进来的东西（老缓存里的旧 `window.AuthApi`、
     * 测试替身、将来越野换的实现）不保证形状完整。少了 `me`，
     * `refreshMe()` 会在 `channel.me()` 上抛 `TypeError` ——
     * 那个异常虽然最终被 `refreshMe()` 的 catch 吞掉，但**堆栈会进控制台**，
     * 而症状是「层级永远不更新」。宁可在入口就判成「没有通道」，
     * 按「未开放」如实回话（那一条路径本来就是设计好的）。
     */
    function usable(ch) {
      return ch && typeof ch.me === "function" && typeof ch.deleteAccount === "function"
        ? ch : null;
    }

    /**
     * 权威发放要的通道**单独判**（2.2）。
     *
     * ⚠️ 刻意**不**并进上面的 `usable()`：那一份是 `/api/me` 与注销的闸，
     *    而老缓存里的旧 `AuthApi`（没有 `grant()`）一进来就会被判成「没有通道」，
     *    症状是**层级再也不更新** —— 那是拿一个不相关的新功能去废掉既有功能。
     *    这里只在真正要发放时判一次，缺了如实回 `E_NO_CHANNEL`。
     */
    function grantChannel() {
      var ch = usable(D.api) || (D.make ? safeCreate(D.make) : null);
      return ch && typeof ch.grant === "function" && typeof ch.revoke === "function" &&
        typeof ch.grants === "function" ? ch : null;
    }

    function safeCreate(make) {
      try {
        /* 设备标识由内核发（`poem_auth_v1` 里的 `deviceId`）——
           取不到就留空，服务端会退回按 IP 分桶。**绝不现编一个 id**。 */
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

    /** 有没有本机会话 —— 没有就**一个请求都不发**（未登录是本来的正常状态） */
    function hasLocalSession() {
      var A = D.A;
      if (!A || !A.makeStore || !A.session || !D.backing) return false;
      try {
        var st = A.makeStore(D.backing);
        return !!A.session(st);
      } catch (e) { return false; }
    }

    /**
     * 把服务端那一份判定写进权益层。
     *
     * ⚠️ **写的时候必须带 `source: "server"`** —— 那是 `identity()` 认出
     *    「这一份是权威判定」的唯一凭据。漏了它，界面照旧显示本机登记那份，
     *    症状是「服务端给了 Pro，用户看到的还是 Free」，且不报任何错。
     */
    /**
     * 服务端自报的**开通状态**（2C）。**只记不判** —— 它不参与任何判权，
     * 只是让界面在说「由服务器判定」时能如实补一句这台服务器当前是什么状态
     * （发信靠 console 的实例，与配齐的实例，说的不是同一件事）。
     *
     * ⚠️ 这一份**不落盘**：它是「这一轮问到的实情」，缓存一份下来必然与
     *    服务端的真实状态漂移（服务端改配置不会通知客户端）。
     */
    var lastChannel = null;

    function applyMe(me) {
      var E = D.E;
      if (!E || !E.writeTier || !D.backing) return false;
      /* 服务端自报的开通状态：如实收下，字段缺了就留 null（**不编默认值**） */
      lastChannel = (me && me.channel && typeof me.channel === "object") ? {
        mail: typeof me.channel.mail === "string" ? me.channel.mail : null,
        delivered: me.channel.delivered === true,
        db: typeof me.channel.db === "string" ? me.channel.db : null,
        sms: me.channel.sms === true
      } : null;

      var plan = (me && me.plan) || {};
      var tier = E.isTier(plan.tier) ? plan.tier : "free";
      var until = plan.until == null ? null : Number(plan.until);
      var r = E.writeTier(D.backing, tier, until, {
        source: "server",
        role: E.isRole(me && me.role) ? me.role : null
      });
      /* 能力清单（`features[]`）本期不落盘：它随时可能变，而权益判定
         已经由 tier 一个值决定 —— 存一份下来只会出现「缓存与内核漂移」。 */
      return !!(r && r.ok);
    }

    /** 服务端说没登录 → 把那一份判定清掉（否则一个退出的人还顶着 Pro 徽章） */
    function clearServerTier() {
      var E = D.E;
      if (!E) return false;
      /* 只在**这一份确实来自服务端**时才清：本机发放名单写的那一份与
         服务端判定无关，退出登录不该把它抹掉（管理员的名单还在）。 */
      try {
        if (E.readServerTier && E.readServerTier(D.backing)) {
          if (E.clearTier) E.clearTier(D.backing);
          return true;
        }
      } catch (e) { /* 隐私模式：没盘可清 */ }
      return false;
    }

    /**
     * 问一次 `/api/me`，把答案落到权益层。**这是「补洞」那一件。**
     *
     * @returns {Promise<{ok, reason, tier?, role?, mask?, me?}>}
     *   `reason` 见 REASON。任何异常都已在这里被吞掉。
     */
    function refreshMe(o) {
      var opt2 = o || {};
      var t = D.now();
      last = { reason: null, at: t };

      /* 没登录就别问 —— 未登录是本来的正常状态（docs §10「会话过期静默降级」） */
      if (!opt2.force && !hasLocalSession()) {
        /* 本机会话空 + 本机也认不出「服务端那份」，说明确实是游客。
           这时**不**主动去清任何东西（用户可能只是本机缓存被清了，
           而服务端那一份判定即将由 refreshMe 带回）。 */
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
          /* 没有会话：**清掉服务端那一份判定**，但绝不碰本机名单、不碰进度 */
          clearServerTier();
          last.reason = REASON.GUEST;
          return { ok: false, reason: REASON.GUEST };
        }
        if (code === "E_NOT_CONFIGURED") {
          last.reason = REASON.NOT_CONFIGURED;
          return { ok: false, reason: REASON.NOT_CONFIGURED, message: r && r.message };
        }
        /* 连不上 / 超时 / 5xx：**什么都不动**（见边界第 3 条），下次再说 */
        last.reason = REASON.UNAVAILABLE;
        return { ok: false, reason: REASON.UNAVAILABLE, message: r && r.message };
      }).catch(function () {
        last.reason = REASON.UNAVAILABLE;
        return { ok: false, reason: REASON.UNAVAILABLE };
      });
    }

    /**
     * 注销账号（2A）。**两条路必须一起走**：
     *
     *   1. 服务端：`DELETE /api/account`（先导出 → 删行 → 吊销会话）
     *   2. 本机：`AuthCore.deleteAccount()`（清本机会话、信任期、账号记录）
     *
     * ⚠️ 顺序是**先服务端、后本机**，理由不是美观：
     *    服务端那一步需要会话 Cookie，而本机注销会把内核的会话清掉 ——
     *    反过来做的话，服务端那一步会以 401 收场，而用户以为注销成功了。
     *
     * ⚠️ 服务端不可用（未开放 / 连不上）时**不阻断本机注销**，但**如实回话**：
     *    `remote: "skipped"` 表示「云端那一行没被删」。这是删除权上的实情，
     *    界面必须说出来，不许写「注销完成」了事。
     *
     * @returns {Promise<{ok, remote, reason, export?, local?}>}
     *   remote: "deleted" | "none" | "skipped"
     *     deleted —— 云端那份已删，`export` 里带着它（先导后删）
     *     none    —— 本来就没有云端账号（未登录 / 本站没服务端）
     *     skipped —— 有账号但现在连不上，云端那份还在
     */
    function deleteAccount(o) {
      var opt2 = o || {};
      var A = D.A;
      var exportData = null;

      function finishLocal() {
        /* 本机注销：内核那一版负责「重输邮箱」的校验与清账号 */
        var local = { ok: false };
        try {
          if (A && A.makeStore && A.deleteAccount && D.backing) {
            local = A.deleteAccount(A.makeStore(D.backing), opt2.email);
          }
        } catch (e) { local = { ok: false, message: "本机账号清不掉，请刷新页面重试" }; }
        return local;
      }

      /* ⚠️ `confirm !== true` 时**连本机那一半都不做** —— 注销是个危险动作，
         「没确认就不动」必须是同一句话，不能因为「反正本机这半也删了」而放过。 */
      if (opt2.confirm !== true) {
        return Promise.resolve({
          ok: false, remote: "none", reason: REASON.GUEST, local: { ok: false },
          message: "请先确认要注销这个账号"
        });
      }
      if (!channel || !hasLocalSession()) {
        /* 没有服务端 / 没登录：**只做本机那一半**，并如实说 remote 是 none */
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
          /* 服务端本来就没有这个会话：等于云端那份不存在，本机照常注销 */
          var l3 = finishLocal();
          return { ok: l3.ok, remote: "none", reason: REASON.GUEST, local: l3, message: l3.message };
        }
        if (code === "E_NOT_CONFIGURED") {
          var l4 = finishLocal();
          return { ok: l4.ok, remote: "none", reason: REASON.NOT_CONFIGURED, local: l4, message: l4.message };
        }
        /* 连不上：本机照样注销（用户要求删除的意愿是明确的），但如实标注云端还在 */
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

    /* ------------------------------------------------ 权威发放（2.2） */

    /**
     * 发放 / 收回 / 列出**服务端权威名单**。
     *
     * ⚠️ 这三条**只送到服务端，不碰本机名单**（`poem_plan_grant_v1`）。
     *    两者是两件事：本机名单是「手工发邀请码的本机版」，改一行存储就能改；
     *    服务端这一份才改得动 `/api/me` 下发的层级。
     *    **不自动同步**：服务端发了不等于对方那台机器的本机名单也多一条 ——
     *    那正是「本机名单传不出去」这条局限在 2.2 之后仍然成立的部分。
     *
     * ⚠️ 与 `refreshMe()` 同一条边界：**失败不打断任何事**，如实回 reason。
     *    这里多一个 `reason: "no-channel"` —— 老缓存里没有发放方法的通道，
     *    那不是「服务端没配好」，也不是「没权限」，界面上要说的话不一样。
     */
    var REASON_NO_CHANNEL = "no-channel";

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
          /* 发完之后**立刻问一次 /api/me**：管理员自己可能正是在给别人发
             同一个层级，而自己的层级也可能刚被改（自己是 owner 时不会，
             但这条路径不该有「假设」）。refreshMe 有同会话的闸，这里用 force。 */
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
        /* E_FORBIDDEN / E_TIER / E_MASK / 429 —— 服务端**明确回绝**，
           这一类**不是降级**，原样把它的话带上去（不自己改写一份）。 */
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

    return {
      /* 只读出口：给测试与界面看「上一轮问了什么」，不参与判权 */
      last: function () { return { reason: last.reason, at: last.at }; },
      /* 服务端自报的开通状态（2C）。**不参与判权**，只用于如实标注。
         ⚠️ 这里**刻意不再暴露底层通道对象**（原来那个 `channel()` 已被本方法取代）：
            同一个名字给两个东西，症状正是刚才实测到的那种 —— 后写的把前写的盖掉，
            而且不报错，只是「服务端自报的状态永远是空的」。 */
      channel: function () { return lastChannel; },
      hasLocalSession: hasLocalSession,
      applyMe: applyMe,
      clearServerTier: clearServerTier,
      refreshMe: refreshMe,
      deleteAccount: deleteAccount,
      /* 权威发放（2.2）：**只有 /admin/ 页调**。不判权限 —— 判权限在服务端。 */
      adminGrant: adminGrant,
      adminGrants: adminGrants,
      adminRevoke: adminRevoke
    };
  }

  /**
   * 问一次 `/api/me` 并把答案落到权益层 —— 全局的那一个（给页面用）。
   *
   * ⚠️ **同会话只问一次**：`refreshMe()` 会被多张页面调用（首页、个人中心、
   *    设置页…），每次都发请求的话，一个用户在四页签之间点几下就是四个请求，
   *    而答案其实一样。这道闸**只按模块存活期计**（页面级），跨页面自然重来 ——
   *    这正是我们要的：刷新页面就该重新问一次。
   */
  var globalPromise = null;
  var globalBound = null;

  function boundOnce(opt) {
    if (!globalBound) globalBound = bind(opt);
    return globalBound;
  }

  function refreshOnce(opt) {
    if (!globalPromise) {
      globalPromise = boundOnce(opt).refreshMe(opt).then(function (r) {
        /* ⚠️ **失败的也要落闸**：连不上时若每次都重试，一个断网的用户
           每张页面都白等 15 秒超时。这一轮没问成，下次刷新页面再说。 */
        return r;
      });
    }
    return globalPromise;
  }

  /** 给测试用：把闸与单例清掉 */
  function reset() {
    globalPromise = null;
    globalBound = null;
  }

  return {
    BASE: BASE,
    REASON: REASON,
    bind: bind,
    refreshMe: refreshOnce,
    /* 这两个是「接线」的直接出口：页面调它们就够了 */
    deleteAccount: function (o) { return boundOnce(o).deleteAccount(o); },
    /* 权威发放（2.2）：**只有 /admin/ 页用**，别处不许调（有源码扫描守着） */
    adminGrant: function (o) { return boundOnce(o).adminGrant(o); },
    adminGrants: function (o) { return boundOnce(o).adminGrants(o); },
    adminRevoke: function (o) { return boundOnce(o).adminRevoke(o); },
    applyMe: function (o) { return boundOnce(o).applyMe(o); },
    clearServerTier: function (o) { return boundOnce(o).clearServerTier(o); },
    hasLocalSession: function (o) { return boundOnce(o).hasLocalSession(o); },
    last: function () { return globalBound ? globalBound.last() : { reason: null, at: 0 }; },
    channel: function () { return globalBound ? globalBound.channel() : null; },
    reset: reset
  };
});
