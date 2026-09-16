/**
 * 个人中心（/profile/）—— 「看自己是谁、能用什么」
 * ==========================================================================
 * 与设置页的分工：设置页是**调机器**（背哪一册、每天几首、字号多大），
 * 个人中心是**看人**（我是谁、什么层级、还差什么）。两者之间只放跳转链接。
 *
 * 三条硬规矩（写在代码里，也由 test/account-pages.test.js 守着）：
 *   1. **页面上不许自己拼 plan / tier** —— 徽章与权限清单一律读
 *      `Entitlement.tierLabel()` / `Entitlement.matrix()`。
 *      自己拼一份的后果：内核改了层级口径，这一页还是老话。
 *   1b. **服务端判定只在 `js/account-api.js` 里接一次**（2 期「补洞」）——
 *      本页不自己 `fetch("/api/me")`、不自己读 Cookie、不自己写层级缓存键。
 *      层级来源（服务端 / 本机）如实标注出来：`Entitlement.identity().tierSource`。
 *   2. **退出只清会话，注销只清账号** —— 两者都**不碰背诵进度**。
 *      界面上如实写出来，不靠用户猜（「退出不会删掉任何背诵进度」）。
 *   3. **注销要二次确认 + 重输邮箱** —— 内核 `deleteAccount` 会拒掉对不上的邮箱，
 *      本页只负责把这一步如实呈现，不做假动作（不摆一颗点了没反应的按钮）。
 */
(function () {
  "use strict";

  var A = window.AuthCore;
  var Ent = window.Entitlement;

  /* 账号接线层（2 期「补洞 + 2A」）：`/api/me` 与 `/api/account` 的唯一接入口。
     脚本顺序不对或老缓存时它是 undefined —— 那时**本页照旧工作**（纯本机口径），
     不报错、不清数据（与 syncMod() 同一条口径）。 */
  function acct() { return window.AccountApi || null; }

  var backing = null;
  try { backing = window.localStorage; } catch (e) { backing = null; }
  var store = A && A.makeStore ? A.makeStore(backing) : null;

  function $(id) { return document.getElementById(id); }
  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function showToast(m) {
    var t = $("toast");
    if (!t) return;
    t.textContent = m;
    t.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { t.hidden = true; }, 2200);
  }

  /* ------------------------------------------------------------ 一、身份 */

  /**
   * 身份那一行：印 + 昵称 + 邮箱掩码 + 层级徽章。
   *
   * 印走 `Avatar.html()`（全站唯一画印的地方）—— 这一页的印要比别处大一档，
   * 由 CSS 的 `.identity-row .seal-avatar` 给尺寸，本页不传 size。
   */
  function renderIdentity(id) {
    var row = $("identity-row");
    if (!row) return;
    var d = window.Avatar ? Avatar.display(backing) : { char: "诗", nickname: "", isDefaultName: true };
    var name = d.nickname || (d.isDefaultName ? "未起名" : d.nickname);
    var badge = '<span class="tier-badge tier-' + esc(id.tier) + '">' + esc(Ent.tierLabel(id.tier)) + "</span>";
    var sub = id.signedIn
      ? "已登录 · " + esc(id.mask || "（无邮箱）")
      : "本机游客 · 未登录";
    row.innerHTML =
      (window.Avatar ? Avatar.html(backing, { cls: "seal-avatar-id" }) : "") +
      '<span class="identity-main">' +
      '<p class="identity-name">' + esc(name) + "</p>" +
      '<span class="identity-sub">' + sub + "</span>" +
      "</span>" + badge;

    /* Issue #163：这一行原先是「昵称与印记在「设置 · 通用」里改；层级本机登记。」
       —— 前半句讲的是**怎么改**，属于「去别处调」的事，与页面里已经有的
       那几颗键说的是同一类东西（用户原话：「删除 昵称与印记在「设置 · 通用」里改。」）。
       现在这一行只说**这一页答不出来的那一件事**：层级是谁定的。
       未登录时连它也不必说（「本机登记」对一个还没登录的人没有意义）。 */
    var hint = $("identity-hint");
    if (hint) {
      hint.hidden = !id.signedIn;
      hint.textContent = id.signedIn ? "层级" + tierSourceLine(id) + "。" : "";
    }

    renderAccountEntry(id);
  }

  /**
   * 身份卡里那颗账号入口（Issue #132 · A→B→C→D 的 D）。
   *
   * 为什么这一颗在这里：个人中心**不在四页签里**（四页签 = 背诵 / 课外 /
   * 搜索 / 设置，第一个字都只有两三个字，再加一格手机上一行就挤变形），
   * 所以从一个「未登录的人」到 `/login/` 的路径只剩两条：
   *   · 设置主页那张「账号」卡 —— 只在**未登录**时出现（登录后再摆一次
   *     「去登录」是自相矛盾的）；
   *   · 这一颗 —— 首页那枚印点进来就是这里，**未登录也画那枚印**，
   *     所以它是未登录用户最可能落地的地方。
   *
   * 两个状态共用同一个按钮，文案在 JS 里按登录态写：
   *   · 未登录 → 「登录」—— 落到 `/login/` 也**不是死路**：
   *     那一页认信任期与会话，信任期内顶部给「继续以 a***@b.com 进入」，
   *     会话还在时同样能继续，不会把已登录的人再拦一次收码。
   *
   * ⚠️ 不做「到了 /login/ 就自动跳回本页」那种聪明：点一下就把人弹回去，
   *    用户只会以为按钮坏了。
   */
  function renderAccountEntry(id) {
    var btn = $("btn-account-entry");
    if (!btn) return;
    var out = $("btn-sign-out");
    var hint = $("signout-hint");
    /* 未登录那一颗的文案（Issue #163 用户 2026-09-16）：
       从「建一个账号（免费）」改成「登录可用语音朗读」，本轮再收成**「登录」**——

       用户原话：「登录可用语音朗读？？？登录就登录，写那么多废话干什么」。
       这一颗键做的事就是「去登录」，按钮上写理由是说给已经决定点的人听的；
       「登录能多出什么」这件事由 /login/ 那一页自己说，不在这儿念一遍。 */
    btn.textContent = id.signedIn ? "管理登录状态" : "登录";
    btn.addEventListener("click", function () { location.href = "/login/"; });

    /* 「退出登录」与它并排在同一行：两件事都是「管登录状态」，
       一次性摆两颗各占一整行，用户会以为是两件不相干的事。
       Issue #163 又往前一步：它旁边还有「权限对比」——
       一页里三颗需要动手的键（登录 / 退出 / 去对比页）现在全在同一行上。 */
    if (out) out.hidden = !id.signedIn;
    if (hint) hint.hidden = !id.signedIn;

    /* 未登录时补一句「登录还差什么」：只写**还差的那件事**，不写理由。
       文案由权益层出自己的口径（`hint`），这里不手拼「登录可用」这类字样 ——
       全站「登录取向说什么」只有 denyReason() 一处。
       ⚠️ 未登录那颗键就叫「登录」，「差语音朗读」这件事在它底下的说明行里说：
         按钮写事、说明写差别，两处分工不与全站别处冲突。 */
    var loginHint = $("login-hint");
    if (loginHint) {
      loginHint.hidden = id.signedIn;
      loginHint.textContent = id.signedIn ? "" : diffLine(id);
    }
  }

  /**
   * 未登录与 Free 之间**只差的那一条**（当前是语音朗读）。
   *
   * 数出「差几条」，再从权益层取那一条的中文名 —— 不把「语音朗读」四个字
   * 写死在这里：将来 Free 只差的那一条变成别的（或不止一条），
   * 这一行会自己跟着变，而不是悄悄地开始说假话。
   */
  function diffLine(id) {
    if (!Ent || typeof Ent.capNames !== "function") return "";
    var freeCtx = { tier: "free", signedIn: true };
    var diff = Ent.capNames().filter(function (key) {
      /* 只看真能力（别名指回同一张表，列两遍是同一件事） */
      if (typeof Ent.cap === "function" && !Ent.cap(key)) return false;
      return id.can(key).ok !== Ent.can(key, freeCtx).ok;
    });
    if (!diff.length) return "";
    if (diff.length > 1) return "差 " + diff.length + " 项。";
    var c = Ent.cap(diff[0]);
    var name = c && c.name ? String(c.name).split("（")[0] : diff[0];
    return "差" + name + "。";
  }

  /* ------------------------------------------------------------ 二、本机数据概览 */

  /**
   * 本机数据：有记录的篇数、已学、到期、平均掌握度。
   *
   * 全部走 `Storage.all()` 与 `Scheduler` —— 本页**不自己重算一遍**统计口径。
   * 重算就一定会和进度总览页对不上，而「两个页面说两个数」是最难解释的 bug。
   */
  function renderStats() {
    var box = $("stats-list");
    if (!box) return;
    var all = window.Storage ? window.Storage.all() : {};
    var ids = Object.keys(all || {});
    var learned = 0, due = 0, masterySum = 0;
    ids.forEach(function (id) {
      var rec = all[id];
      if (!rec) return;
      if (window.Scheduler) {
        if (Scheduler.isLearned(rec)) learned += 1;
        if (Scheduler.isDue(rec)) due += 1;
        masterySum += Scheduler.mastery(rec);
      }
    });
    var avg = learned ? Math.round(masterySum / learned) : 0;
    var rows = [
      ["有记录的篇目", ids.length ? ids.length + " 篇" : "还没有"],
      ["已开始记忆", learned ? learned + " 篇" : "还没有"],
      ["今天到期", due ? due + " 篇" : "没有"]
    ];
    if (learned) rows.push(["平均掌握度", avg + "%"]);
    box.innerHTML = rows.map(function (r) {
      return '<div class="kv-row"><span class="kv-k">' + esc(r[0]) +
        '</span><span class="kv-v">' + esc(r[1]) + "</span></div>";
    }).join("");
  }

  /* ------------------------------------------------------------ 三、账号信息 */

  /**
   * 账号那一行 —— 只在「关于」卡的末尾占一行，不再独占一张卡。
   *
   * Issue #163 用户原话：「个人页面一个卡片一个按钮……其他描述部分重新整理组合。」
   * 原先「账号」自成一卡（状态 / 邮箱 / 层级 / 本次登录四行 + 一颗退出键），
   * 而它回答的「我是谁」与上面那张身份卡完全重合 —— 同一个人介绍两遍。
   * 现在身份卡说「印 + 昵称 + 邮箱 + 层级」，这一行只补身份卡上没有的那两条：
   * 本次登录还剩多久、这台设备上记着哪个邮箱。
   */
  function renderAccount(sess) {
    var list = $("account-list");
    if (!list) return;
    if (!sess || !sess.account) { hide(list); hide($("danger-card")); return; }
    var acc = sess.account;
    var days = Math.max(0, Math.round((sess.exp - Date.now()) / 86400000));
    /* ⚠️ 这里**不再列层级**：层级徽章已经在身份卡那一行上，
       「由谁定」也已经在它的下一行说了（`#identity-hint`）——
       第三处再写一遍「Free（本机登记）」就是同一件事说三次。
       所以这个函数**不需要**再问一次 `Ent.identity()`（少一次合成，
       也少一处可能与身份卡不一致的读数）。 */
    var rows = [
      ["账号", acc.identities[0] ? acc.identities[0].mask : "（无邮箱）"],
      ["本次登录", "还剩 " + days + " 天"]
    ];
    list.innerHTML = rows.map(function (r) {
      return '<div class="kv-row"><span class="kv-k">' + esc(r[0]) +
        '</span><span class="kv-v">' + esc(r[1]) + "</span></div>";
    }).join("");
    show(list);
    show($("danger-card"));
  }

  /**
   * 层级是**谁定的** —— 如实说出来，不含糊。
   *
   * 为什么值得单独占一个函数：这两句话在用户眼里的分量完全不同 ——
   * 「服务器判定」改不了，「本机登记」改一行存储就能改（文档 §3.4 的口径）。
   * 页面上不写清这一条，等于把本机登记那份说得像权威判定。
   */
  function tierSourceLine(id) {
    return id && id.tierSource === "server" ? "由服务器判定" : "本机登记";
  }

  /* 「权限」那一节**整节撤掉了**（Issue #163 第三轮）----
     它原先只剩「一行身份（你在哪一层）+ 一颗进对比页的按钮」。而那一行身份
     与身份卡上的层级徽章是同一个值、徽章由 `Ent.tierLabel()` 出，
     那颗按钮又与「同步设置」「管理后台」同属「去别处」的一类 ——
     于是它两头都重复。现在：层级只在身份卡上说（徽章 + 「层级由谁定」一行），
     「谁能用什么」只在 /plans/ 那张表上说，进表的那颗键并进「关于」卡那一行。

     ⚠️ 判权仍然一个字都没变：徽章文案照旧只走 `Ent.tierLabel()`，
        本页不自己比 tier（有源码扫描守着）。 */

  /* ------------------------------------------------------------ 五、管理员入口 */

  function renderAdmin(id) {
    // role 与 tier 是两条正交的轴：店长不是 VIP（谁能管理 ≠ 能用什么）。
    // 判据只走 `Entitlement.isOwner()` —— 与 /admin/ 页**同一个出口**，
    // 不会出现「入口看得见、点进去被拒」这种自相矛盾的组合。
    // ⚠️ **不传 `id.role`**：那个值本来就是 `isOwner()` 算出来的
    //    （见 entitlement.js 的 identity()），传回去等于自己问自己，
    //    而服务端版会在 `id.role` 里下发真实角色 —— 那时这一行要改成
    //    `Ent.isOwner(null, { role: id.role })`。现在不传才是对的。
    /* Issue #163：「管理」原先自成一卡（一句说明 + 一颗键），
       而它只是「去别处」的一颗键 —— 与权限对比、同步设置同属一类，
       现在三颗并排在「关于」卡底下那一行里。入口的判据一个字没改。 */
    var btn = $("btn-go-admin");
    if (!btn) return;
    if (Ent.isOwner(backing)) {
      // 与 /admin/ 页**同一个判据**；第一次看到入口时顺手把主人标记落下，
      // 免得出现「个人中心里有入口、点进去却被拒」这种自相矛盾的组合。
      Ent.markOwner(backing);
      show(btn);
    } else {
      hide(btn);
    }
  }

  /* ------------------------------------------------------------ 六、动作 */

  function onSignOut() {
    var r = A.signOut(store);
    if (r.ok) {
      showToast("已退出登录（进度没动）");
      location.href = "/settings/general/";
    }
  }

  function onDeleteStart() {
    show($("delete-step-2"));
    hide($("delete-step-1"));
    var el = $("input-delete-email");
    if (el) el.focus();
  }

  function onDeleteCancel() {
    hide($("delete-step-2"));
    show($("delete-step-1"));
    var el = $("input-delete-email");
    if (el) el.value = "";
    var m = $("msg-delete");
    if (m) { m.textContent = ""; m.className = "account-msg"; }
  }

  /**
   * 确认注销（2A 的核心接线）。
   *
   * **两条路一起走，顺序不能反**：先服务端（`DELETE /api/account`，
   * 它要会话 Cookie），再本机（`AuthCore.deleteAccount`，它会清掉内核会话）。
   * 反过来先本机的话，服务端那一步会以 401 收场，而用户以为注销成功了 ——
   * 云端那一行还在，且没人会知道。
   *
   * 服务端不可用时**不阻断本机注销**（用户要求删除的意愿是明确的），
   * 但如实说「云端那一份没删掉」—— 删除权上的实情，不许含糊。
   */
  function onDeleteConfirm() {
    var el = $("input-delete-email");
    var v = (el && el.value ? el.value : "").trim();
    var msg = $("msg-delete");
    var btn = $("btn-delete-confirm");
    if (btn) btn.disabled = true;
    if (msg) { msg.textContent = "正在注销……", msg.className = "account-msg"; }

    var M = acct();
    var p = M
      ? M.deleteAccount({ email: v, confirm: true, backing: backing, A: A, E: Ent })
      : Promise.resolve(localOnlyDelete(v));

    Promise.resolve(p).then(function (r) {
      if (btn) btn.disabled = false;
      if (!r.ok) {
        if (msg) { msg.textContent = r.message || "注销没成功，请刷新页面重试", msg.className = "account-msg warn"; }
        return;
      }
      afterDeleted(r, msg);
    })["catch"](function () {
      if (btn) btn.disabled = false;
      if (msg) { msg.textContent = "注销没成功，请刷新页面重试", msg.className = "account-msg warn"; }
    });
  }

  /** 账号接线层没加载（老缓存里的旧页面）时的兜底：只做本机那一半，并如实说明 */
  function localOnlyDelete(email) {
    var r = A.deleteAccount(store, email);
    return { ok: r.ok, remote: "none", message: r.message };
  }

  function afterDeleted(r, msg) {
    /* 云端那一份**真的给到用户**：服务端注销时先导出再删行，那份数据随响应回来。
       这一颗按钮只在真导出到东西时出现 —— 不摆一颗点了没反应的按钮。 */
    var box = $("delete-export"), btn = $("btn-delete-export");
    if (box && btn && r.export) {
      show(box);
      btn.onclick = function () { downloadCloudExport(r.export); };
    } else if (box) {
      hide(box);
    }

    var line;
    if (r.remote === "deleted") {
      line = "账号已注销：账号与云端进度都已在服务器上删除，那一份已导出给你。" +
        "这台设备上的背诵进度仍在。";
    } else if (r.remote === "skipped") {
      line = "本机账号已注销。但没连上服务器，云端那一份还在 —— " +
        "网络恢复后再注销一次，或在服务器上删除。";
    } else {
      line = "账号已注销。这台设备上的背诵进度仍在。";
    }
    if (msg) { msg.textContent = line, msg.className = "account-msg " + (r.remote === "skipped" ? "warn" : "ok"); }
    showToast(r.remote === "skipped" ? "已注销本机账号；云端那一份没删掉" : "账号已注销，背诵进度仍在");
    if (r.remote === "skipped") return;          // 有话说的时候**别跳走**，让他读完
    setTimeout(function () { location.href = "/settings/general/"; }, 1400);
  }

  /** 把云端导出写成文件。拿不到 Blob 时如实提示，不假装下载过 */
  function downloadCloudExport(data) {
    var text = JSON.stringify(data, null, 2);
    try {
      var blob = new Blob([text], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "跬步-云端数据-" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      showToast("这份浏览器不允许直接下载文件，请换个浏览器再来");
    }
  }

  /* ------------------------------------------------------------ 七、缓存版本 */

  function renderCacheInfo() {
    var el = $("about-cache");
    if (!el) return;
    // 版本号从 sw.js 的注册里读不到（SW 上下文不同），所以从 <meta> 里的构建标识读。
    // 拿不到就如实说「当前已离线就绪」——不编一个假版本号出来。
    var meta = document.querySelector('meta[name="kuibu-cache"]');
    el.textContent = meta ? meta.getAttribute("content") : "已离线就绪";
  }

  /* ------------------------------------------------------------ 初始化 */

  /** 把整页按当前（本机 + 服务端已落盘的那一份）口径画一遍 */
  function paint(sess) {
    var id = Ent.identity({ backing: backing, authStore: store });
    renderIdentity(id);
    renderStats();
    renderAccount(sess);
    renderSync();
    renderAdmin(id);
    renderCacheInfo();
  }

  function init() {
    if (!A || !Ent || !store) return;
    /* ⚠️ onSignOut 必须先接上：paint() 里那颗「登录 / 管理登录状态」的键
       在 paint 期间就被画出来并被点得到（本机口径那一遍是同步跑的），
       而这里原先只在文件底部接它 —— 服务端那一遍 paint 之前就点，
       事件是空的（点了没反应）。所以接在 paint 之前。 */
    $("btn-sign-out").addEventListener("click", onSignOut);
    var sess = A.session(store);
    paint(sess);

    /* ------------------------------------------------------------------
       「补洞」（Issue #132 · 2 期）：把 `/api/me` 接上。
       ------------------------------------------------------------------
       先画一遍**本机口径**（上面那次 paint）—— 服务端好不好、快不快，
       页面都已经可用了；`/api/me` 回来之后再画一遍。

       为什么必须**先画再问**，而不是「等回来了再画」：
         · 断网 / 服务端没配好时，等下去就是一片空白，而本机那份本来就在盘上
         · 首屏速度是跬步最硬的产品特性（docs §2.3 第 3 条），不能押在一个请求上

       ⚠️ 调不到就**什么都不做**（不当成错误、不清层级缓存）——
          见 js/account-api.js 的边界第 3 条。
       ------------------------------------------------------------------ */
    var M = acct();
    if (M && sess) {
      Promise.resolve(M.refreshMe({ backing: backing, A: A, E: Ent })).then(function (r) {
        /* 只在拿到服务端的答案（或明确「没有会话」）时重画；
           连不上时数据一字未变，重画纯属白抖一次 DOM。 */
        if (!r || !r.ok) return;
        paint(A.session(store));
      })["catch"](function () { /* 问不到就算了，页面已经是可用状态 */ });
    }

    $("btn-go-plans").addEventListener("click", function () { location.href = "/plans/"; });
    $("btn-go-admin").addEventListener("click", function () { location.href = "/admin/"; });
    $("btn-delete-start").addEventListener("click", onDeleteStart);
    $("btn-delete-cancel").addEventListener("click", onDeleteCancel);
    $("btn-delete-confirm").addEventListener("click", onDeleteConfirm);
    $("btn-go-sync").addEventListener("click", function () { location.href = "/settings/general/"; });
    $("btn-keep-local").addEventListener("click", function () { onResolve("keepLocal"); });
    $("btn-keep-remote").addEventListener("click", function () { onResolve("keepRemote"); });
    $("btn-export-first").addEventListener("click", function () { onResolve("exportFirst"); });
  }

  /* ------------------------------------------------------------ 四之二、同步 */

  function syncMod() { return window.SyncStore || null; }

  /**
   * 同步这一卡。**三种状态各说各的话**，而且**都不许出现「已同步」这种笼统话** ——
   * 1A 立的那条「不假装」的纪律在这里同样成立：没同步上就直说没同步上。
   *
   * 冲突面板只在 `SyncStore.conflicts()` 非空时出现，且**必须同时显示两边**
   * 「篇数 / 截至时间」（docs §4.4 D 项）—— 不让用户在不知代价的情况下选。
   */
  function renderSync() {
    var list = $("sync-list");
    var S = syncMod();
    if (!list) return;
    var hint = $("sync-hint");

    if (!S) {
      list.innerHTML = '<div class="kv-row"><span class="kv-k">状态</span>' +
        '<span class="kv-v" id="sync-state">不可用</span></div>';
      if (hint) hint.textContent = "同步层没加载成功，刷新页面重试（背诵不受影响）。";
      hide($("sync-conflict"));
      return;
    }

    var st = S.status();
    var on = S.enabled();
    var n = S.conflicts().length;
    /* ⚠️ 冲突**最先说**：它是一件「欠着用户一个决定」的事，
       不该被「开关关着」盖过去 —— 面板摆出来了、状态却写「已关闭」，
       用户会以为那个面板是个残留物。关掉开关也一样要他把这一篇选完。 */
    var stateText = n ? "需要你选一下"
      : st === "unavailable" ? "未开放"
      : st === "off" ? "已关闭"
      : st === "signin" ? "等登录"
      : "开启中";

    /* 「开 / 关」用与层级徽章同一枚药丸（.tier-badge）：这里是**只读回显**，
       不是开关本体（开关在设置 · 通用里，这里连点都不给点）。
       ⚠️ 开着才用深天青那枚 —— 与设置页开关的选中色同一句「实底 = 开着」，
          两处说的是同一件事，不该一处绿一处灰。 */
    var swPill = on
      ? '<span class="tier-badge on" id="sync-switch">开</span>'
      : '<span class="tier-badge" id="sync-switch">关</span>';
    list.innerHTML =
      '<div class="kv-row"><span class="kv-k">状态</span>' +
      '<span class="kv-v" id="sync-state">' + esc(stateText) + "</span></div>" +
      '<div class="kv-row"><span class="kv-k">开关</span>' +
      '<span class="kv-v">' + swPill + "</span></div>";

    if (hint) {
      hint.textContent = n
        ? "有 " + n + " 篇需要你选一下（下面），选完之前不会自动合并。"
        : st === "unavailable"
        ? "本站未开放同步，进度只存本机。"
        : st === "off"
          ? "关闭中：进度只存本机。开关在「设置 · 通用」里。"
          : st === "signin"
            ? "已开启，登录后才会真的同步。"
            : "进度与账号设置会同步；本机那份始终完整，断网照常背。";
    }

    renderConflict(S, !!sess());
  }

  function sess() {
    try { return A && A.session ? A.session(store) : null; } catch (e) { return null; }
  }

  function renderConflict(S, signedIn) {
    var box = $("sync-conflict");
    var lead = $("conflict-lead");
    if (!box) return;
    var list = S.conflicts();
    if (!list.length) { hide(box); return; }

    // 两边各有多少篇、本机那份截止到什么时候 —— 用户有权在知道代价之后再选
    var localCount = 0;
    try { localCount = Object.keys(window.ProgressStore.all() || {}).length; } catch (e) { localCount = 0; }
    if (lead) {
      lead.textContent = "有 " + list.length + " 篇两边都改过，判不出该听谁的，未自动合并。" +
        "本机共 " + localCount + " 篇。" +
        (signedIn ? "" : "请先登录再选。") +
        "选「保留账号」前会先在本机留一份快照。";
    }
    show(box);
  }

  /** 用户选边。三种都走 SyncStore —— 复盘口径只在那里有一份 */
  function onResolve(mode) {
    var S = syncMod();
    var msg = $("msg-conflict");
    if (!S) return;
    var r = S.resolveConflict(mode);
    if (!r || !r.ok) {
      if (msg) { msg.textContent = (r && r.message) || "没能完成这一步"; msg.className = "account-msg warn"; }
      return;
    }
    if (mode === "exportFirst") {
      /* 先导出再决定：**不动任何数据**，只把快照给用户。
         这一步存在的意义是让用户拿着两份数据（本机的备份 + 这份快照）去第三方比对，
         所以这里给的是文件，不是一句提示。 */
      var text = JSON.stringify(r.backup || {}, null, 2);
      try {
        var blob = new Blob([text], { type: "application/json" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "跬步-同步快照-" + new Date().toISOString().slice(0, 10) + ".json";
        a.click();
        URL.revokeObjectURL(a.href);
        if (msg) { msg.textContent = "快照已导出，冲突还没处理，你想好了再回来选。"; msg.className = "account-msg"; }
      } catch (e) {
        if (msg) { msg.textContent = "这份浏览器不允许直接下载文件，请到「设置 · 通用」用导出备份。"; msg.className = "account-msg warn"; }
      }
      return;
    }
    renderSync();
    showToast(mode === "keepLocal" ? "已按本机这一份处理，稍后会同步上去" : "已按账号这一份处理");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.ProfilePage = { renderSync: renderSync, esc: esc };
})();
