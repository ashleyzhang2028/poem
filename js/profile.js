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
 *   2. **退出只清会话，注销只清账号** —— 两者都**不碰背诵进度**。
 *      界面上如实写出来，不靠用户猜（「退出不会删掉任何背诵进度」）。
 *   3. **注销要二次确认 + 重输邮箱** —— 内核 `deleteAccount` 会拒掉对不上的邮箱，
 *      本页只负责把这一步如实呈现，不做假动作（不摆一颗点了没反应的按钮）。
 */
(function () {
  "use strict";

  var A = window.AuthCore;
  var Ent = window.Entitlement;

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

    var hint = $("identity-hint");
    if (hint) {
      hint.textContent = id.signedIn
        ? "昵称与头像印记在「设置 · 通用」里改；层级由管理员发放。"
        : "昵称与头像印记在「设置 · 通用」里改，不登录也能改。";
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
   *   · 未登录 → 「用邮箱建一个账号（免费）」
   *   · 已登录 → 「管理登录状态（退出 / 注销）」—— 落到 `/login/` 也**不是死路**：
   *     那一页认信任期与会话，信任期内顶部给「继续以 a***@b.com 进入」，
   *     会话还在时同样能继续，不会把已登录的人再拦一次收码。
   *
   * ⚠️ 不做「到了 /login/ 就自动跳回本页」那种聪明：点一下就把人弹回去，
   *    用户只会以为按钮坏了。
   */
  function renderAccountEntry(id) {
    var btn = $("btn-account-entry");
    if (!btn) return;
    btn.textContent = id.signedIn
      ? "管理登录状态（退出 / 注销）"
      : "用邮箱建一个账号（免费）";
    btn.addEventListener("click", function () { location.href = "/login/"; });
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
      ["已开始记忆", learned ? learned + " 篇" : "还没有开始"],
      ["今天到期", due ? due + " 篇" : "今天没有到期的"]
    ];
    if (learned) rows.push(["平均掌握度", avg + "%"]);
    box.innerHTML = rows.map(function (r) {
      return '<div class="kv-row"><span class="kv-k">' + esc(r[0]) +
        '</span><span class="kv-v">' + esc(r[1]) + "</span></div>";
    }).join("");
  }

  /* ------------------------------------------------------------ 三、账号信息 */

  function renderAccount(sess) {
    var card = $("account-card");
    var list = $("account-list");
    if (!card || !list) return;
    if (!sess || !sess.account) { hide(card); hide($("danger-card")); return; }
    var acc = sess.account;
    var days = Math.max(0, Math.round((sess.exp - Date.now()) / 86400000));
    var rows = [
      ["状态", "已登录"],
      ["邮箱", acc.identities[0] ? acc.identities[0].mask : "（无）"],
      ["层级", Ent.tierLabel(Ent.identity().tier)],
      ["本次登录", "还剩 " + days + " 天"]
    ];
    list.innerHTML = rows.map(function (r) {
      return '<div class="kv-row"><span class="kv-k">' + esc(r[0]) +
        '</span><span class="kv-v">' + esc(r[1]) + "</span></div>";
    }).join("");
    show(card);
    show($("danger-card"));
  }

  /* ------------------------------------------------------------ 四、权限清单 */

  /**
   * 权限清单：一条一事，能用的打勾、不能用的写门槛。
   *
   * 全部来自 `Entitlement.matrix(ctx)` —— 本页**只负责排版**。
   * 这也是「免费不残缺」这条原则在界面上唯一能被用户看见的地方：
   * 他得能一眼看出「我现在能用什么、什么要升级」。
   */
  function renderCaps(id) {
    var list = $("cap-list");
    if (!list) return;
    var rows = Ent.matrix(id.ctx);
    list.innerHTML = rows.map(function (r) {
      var mark = r.ok ? "✓" : "·";
      // 门槛文案与能力名之间留一个空格：不加的话读起来是
      // 「自选清单 20 个Pro 起可用」，像是排版出错
      var hint = r.hint ? '<span class="cap-hint"> ' + esc(r.hint) + "</span>" : "";
      return '<li class="' + (r.ok ? "on" : "off") + '">' +
        '<span class="cap-mark" aria-hidden="true">' + mark + "</span>" +
        '<span class="cap-name">' + esc(r.name) + hint + "</span></li>";
    }).join("");
    // 清单里的门槛文案来自内核；这里只补一句「本机演示版」的诚实说明
    var hint = $("cap-hint");
    if (hint) {
      hint.textContent = id.signedIn
        ? "层级由管理员按邮箱掩码发放。本期没有服务器，层级只是本机登记，升级后重新打开页面即生效。"
        : "登录后可用语音朗读（免费）。其他带门槛的能力需要管理员发放的层级。";
    }
  }

  /* ------------------------------------------------------------ 五、管理员入口 */

  function renderAdmin(id) {
    // role 与 tier 是两条正交的轴：店长不是 VIP（谁能管理 ≠ 能用什么）。
    // 判据只走 `Entitlement.isOwner()` —— 与 /admin/ 页**同一个出口**，
    // 不会出现「入口看得见、点进去被拒」这种自相矛盾的组合。
    // ⚠️ **不传 `id.role`**：那个值本来就是 `isOwner()` 算出来的
    //    （见 entitlement.js 的 identity()），传回去等于自己问自己，
    //    而服务端版会在 `id.role` 里下发真实角色 —— 那时这一行要改成
    //    `Ent.isOwner(null, { role: id.role })`。现在不传才是对的。
    if (Ent.isOwner(backing)) {
      // 与 /admin/ 页**同一个判据**；第一次看到入口时顺手把主人标记落下，
      // 免得出现「个人中心里有入口、点进去却被拒」这种自相矛盾的组合。
      Ent.markOwner(backing);
      show($("admin-card"));
    } else {
      hide($("admin-card"));
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

  function onDeleteConfirm() {
    var el = $("input-delete-email");
    var v = (el && el.value ? el.value : "").trim();
    var msg = $("msg-delete");
    var r = A.deleteAccount(store, v);
    if (!r.ok) {
      if (msg) { msg.textContent = r.message; msg.className = "account-msg warn"; }
      return;
    }
    if (msg) { msg.textContent = "账号已注销。", msg.className = "account-msg ok"; }
    showToast("账号已注销，背诵进度仍在");
    setTimeout(function () { location.href = "/settings/general/"; }, 900);
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

  function init() {
    if (!A || !Ent || !store) return;
    var id = Ent.identity({ backing: backing, authStore: store });
    var sess = A.session(store);

    renderIdentity(id);
    renderStats();
    renderAccount(sess);
    renderCaps(id);
    renderAdmin(id);
    renderCacheInfo();

    if (!sess) show($("guest-card"));

    $("btn-go-login").addEventListener("click", function () { location.href = "/login/"; });
    $("btn-sign-out").addEventListener("click", onSignOut);
    $("btn-go-admin").addEventListener("click", function () { location.href = "/admin/"; });
    $("btn-delete-start").addEventListener("click", onDeleteStart);
    $("btn-delete-cancel").addEventListener("click", onDeleteCancel);
    $("btn-delete-confirm").addEventListener("click", onDeleteConfirm);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.ProfilePage = { renderCaps: renderCaps, esc: esc };
})();
