/**
 * 管理后台（/admin/）—— 按邮箱掩码发放 Free / Pro / Max
 * ==========================================================================
 * 2.2 之后本页有**两份名单**，它们不是一回事：
 *
 *   ① 「服务端名单」= **权威**（`POST /api/admin/grant` → `accounts.plan`）
 *      由 `/api/me` 下发，对方改一行存储改不动它。
 *      ⚠️ 前提是**对方先登录过一次**（库里得先有那一行），否则命中 0 条。
 *   ② 「本机名单」= 1 期之前那套「手工发邀请码的本机版」：
 *      管理员写好名单 → 导出给用户 → 用户自己导入 → 掩码对上就生效。
 *      **仍然不是权威**，只在没配服务端 / 连不上时兜底。
 *
 * ⚠️ 四条不许含糊的事（文档 §3.5 与 §3.4 白纸黑字）：
 *   1. **两份名单不自动同步** —— 服务端发了一条，对方那台机器的本机名单
 *      不会跟着多一条。界面上两块分开写、分开渲染，不许混成一块。
 *   2. **都不是收费凭据** —— 本机那份改一行存储就能升级；服务端那份改不动，
 *      但本站现在没有收款能力（4 期才做）。
 *   3. **角色闸在服务端** —— 这一页把入口藏起来**不是**安全边界
 *      （`accounts.role` 不是 owner / admin 时接口如实回 403）。
 *   4. **非 owner 看到的是一句如实的拒绝**，并且**不渲染**下面任何一块
 *      （不是「藏起来」——藏起来的东西改了 JS 就出来了；这里是不给它画）
 *
 * 分层那套规则一条都不在本文件里：全在 `js/entitlement.js`。
 * 发放走 `js/account-api.js`（**本页不自己 fetch**，有源码扫描守着）。
 */
(function () {
  "use strict";

  var Ent = window.Entitlement;

  /* 账号接线层（2.2）：权威发放的**唯一接入口**。
     脚本顺序不对或老缓存时它是 undefined —— 那时**本页照旧工作**（只剩本机那一份），
     不报错、不清数据（与 js/profile.js 的 acct() 同一条口径）。 */
  function acct() { return window.AccountApi || null; }

  var backing = null;
  try { backing = window.localStorage; } catch (e) { backing = null; }

  /** 表单里选中的层级（默认 pro —— 发放按钮最常点的那一档） */
  var pickedTier = "pro";

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
  function msg(id, s, level) {
    var el = $(id);
    if (!el) return;
    el.textContent = s == null ? "" : String(s);
    el.className = "account-msg" + (level ? " " + level : "");
  }

  /* ------------------------------------------------------------ 一、权限闸 */

  /**
   * 是不是管理员。
   *
   * role 与 tier 是**两条正交的轴**：店长不是 VIP。
   * 判据只走 `Entitlement.isOwner()` —— **本页不许自己读那个键、也不许自己
   * 猜规则**（曾在这里写过「没有任何层级记录时才算主人」，那与 entitlement
   * 后来落下的 `poem_owner_v1` 标记是两套规则，两边必然漂移）。
   */
  function isOwner(id) {
    // ⚠️ 同上：不把 `id.role` 传回去（那是 isOwner 自己算出来的）。
    //    服务端下发的角色由 `identity()` 内部走 `readServerRole()` 读，
    //    这一步在 2 期「补洞」之后就已经通了 —— 这里照旧不传才是对的。
    // ⚠️ 但**这一页的准入不是安全边界**：真正拦人的是服务端的
    //    `accounts.role`（2.2 的 `POST /admin/grant` 会回 403）。
    //    入口藏不藏只影响体验，不影响权限（docs §3.4）。
    void id;
    return Ent.isOwner(backing);
  }

  /* ------------------------------------------------------------ 二、发放 */

  function renderTierPick() {
    var box = $("tier-pick");
    if (!box) return;
    box.innerHTML = Ent.TIERS.map(function (t) {
      return '<button type="button" data-tier="' + t + '"' +
        (t === pickedTier ? ' class="active"' : "") + ' aria-pressed="' +
        (t === pickedTier ? "true" : "false") + '">' + esc(Ent.tierLabel(t)) + "</button>";
    }).join("");
  }

  function onPick(e) {
    var b = e.target.closest ? e.target.closest("button[data-tier]") : null;
    if (!b) return;
    pickedTier = b.getAttribute("data-tier");
    renderTierPick();
  }

  /** 读表单：掩码 + 到期时刻（**服务端与本机两条路共用同一份读法**）。
      共用是为了「服务端版多掩了一次、本机版少掩了一次」这类漂移不再可能。 */
  function readForm() {
    var mask = (($("input-mask") || {}).value || "").trim();
    if (!mask) return { bad: "请填邮箱掩码（与用户在账号页看到的那串一致）" };
    var untilStr = (($("input-until") || {}).value || "").trim();
    var until = null;
    if (untilStr) {
      // 到期日按当天 23:59:59 生效结束：填「今天」等于今天还能用
      var t = Date.parse(untilStr + "T23:59:59");
      if (!isFinite(t)) return { bad: "到期日看不懂，请用日期选择器" };
      until = t;
    }
    return { mask: mask, until: until };
  }

  /** 发放成功之后把表单清一下（两条路都这么做） */
  function clearForm() {
    var m = $("input-mask"); if (m) m.value = "";
  }

  /**
   * 服务端权威发放（2.2）—— 本页的**主路**。
   *
   * ⚠️ 三件事各说各的话，不许合并成一句「发放失败」：
   *   · `matched: 0`  —— **不是失败**。对方还没登录过，库里没有那一行。
   *   · `ambiguous`   —— 掩码撞了（a***@qq.com 这样的空间不大），只改了第一条，
   *                      如实标出来（猜错等于给另一个人开了 Pro）。
   *   · 连不上 / 没配好 —— 如实说，并提示可以先用「只发到本机名单」兜底。
   *     但**绝不自动回落本机** —— 那会让管理员以为服务端已经发好了。
   */
  function onGrant() {
    var f = readForm();
    if (f.bad) { msg("msg-grant", f.bad, "warn"); return; }
    var M = acct();
    var btn = $("btn-grant");
    if (btn) btn.disabled = true;
    msg("msg-grant", "正在发往服务端……", "");

    if (!M || typeof M.adminGrant !== "function") {
      if (btn) btn.disabled = false;
      msg("msg-grant", "页面脚本版本对不上（刷新一次即可），这一轮没发出任何东西。想先用本机那份，点「只发到本机名单」。", "warn");
      return;
    }

    Promise.resolve(M.adminGrant({ emailMask: f.mask, tier: pickedTier, until: f.until, backing: backing, A: window.AuthCore, E: Ent }))
      .then(function (r) {
        if (btn) btn.disabled = false;
        if (!r || !r.ok) { grantFailed(r); return; }
        if (!r.changed) {
          /* 命中 0 条：**如实说**，且这不是错误 —— 语气按「提示」而不是「错误」 */
          msg("msg-grant", "服务端收到这一条了，但" + r.note, "warn");
          clearForm();
          loadServerGrants();
          return;
        }
        var line = "已写进服务端：" + r.emailMask + " → " + Ent.tierLabel(r.tier) +
          (r.until ? "（到期 " + new Date(r.until).toLocaleDateString() + "）" : "（永久）") +
          "。对方刷新页面（或打开个人中心）即由服务器判定生效。";
        if (r.ambiguous) line += "⚠️ 这个掩码在库里不只一条，只改了最早的那一条 —— 请让对方确认。";
        msg("msg-grant", line, "ok");
        clearForm();
        loadServerGrants();
      })["catch"](function () {
        if (btn) btn.disabled = false;
        msg("msg-grant", "连不上服务端，这一轮没发出任何东西。", "warn");
      });
  }

  /** 服务端那条路失败时的**分情况**说话（不许合并成一句「发放失败」） */
  function grantFailed(r) {
    var reason = r && r.reason;
    var text = (r && r.message) || "发放没成功。";
    if (reason === "guest") {
      text = "登录状态已过期，请重新登录后再来。";
    } else if (reason === "not-configured") {
      text = "本站还没开放云端账号（服务端缺密钥），这一条发不出去。可以先用「只发到本机名单」兜底 —— 但那一份不是权威。";
    } else if (reason === "no-channel") {
      text = "页面脚本版本对不上（刷新一次即可），这一轮没发出任何东西。";
    } else if (reason === "unavailable") {
      text = "连不上服务端，这一轮没发出任何东西。（本机名单不受影响，可先用「只发到本机名单」兜底 —— 但那一份不是权威。）";
    }
    msg("msg-grant", text, "warn");
  }

  /** 只发到本机名单（原来的那条路）—— 明确的**降级**操作，按钮上写着呢 */
  function onGrantLocal() {
    var f = readForm();
    if (f.bad) { msg("msg-grant", f.bad, "warn"); return; }
    var r = Ent.putGrant(backing, { emailMask: f.mask, tier: pickedTier, until: f.until, by: "owner", at: Date.now() });
    if (!r.ok) { msg("msg-grant", r.message, "warn"); return; }
    msg("msg-grant", "已发往**本机名单**：" + r.grant.emailMask + " → " + Ent.tierLabel(r.grant.tier) +
      (r.grant.until ? "（到期 " + new Date(r.grant.until).toLocaleDateString() + "）" : "（永久）") +
      "。⚠️ 这一份要对方自己导入，且不是权威。", "ok");
    clearForm();
    renderList();
  }

  /* ------------------------------------------ 服务端名单的渲染与操作（2.2） */

  /** 服务端那一份：**只读**（写靠发放/收回；这份列表是它的回执） */
  function renderServerGrants(data) {
    var box = $("server-list");
    if (!box) return;
    var list = (data && data.grants) || [];
    var empty = $("server-empty");
    if (empty) empty.hidden = list.length > 0;
    box.innerHTML = list.map(function (g) {
      var when = g.until ? "到期 " + new Date(g.until).toLocaleDateString() : "永久";
      return '<li class="grant-row">' +
        '<span class="grant-mail">' + esc(g.emailMask) + "</span>" +
        '<span class="tier-badge tier-' + esc(g.tier) + '">' + esc(Ent.tierLabel(g.tier)) + "</span>" +
        '<span class="grant-when">' + esc(when) + "</span>" +
        '<button class="grant-del" type="button" data-revoke="' + esc(g.emailMask) + '">收回</button>' +
        "</li>";
    }).join("");
  }

  function serverNote(text, warn) {
    var el = $("server-note");
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !text;
  }

  /**
   * 拉一次服务端名单。**四种结果各说各的话**（与 account-api 的 reason 一一对应）：
   *   ok / guest / not-configured / no-channel / unavailable。
   * ⚠️ 拉不到**不清空**已有列表 —— 清空等于「后端抖一下，管理员以为名单没了」。
   */
  function loadServerGrants() {
    var M = acct();
    if (!M || typeof M.adminGrants !== "function") {
      serverNote("页面脚本版本对不上（刷新一次即可）：这一块现在只能看本机名单。", true);
      return;
    }
    Promise.resolve(M.adminGrants({ backing: backing, A: window.AuthCore, E: Ent })).then(function (r) {
      if (r && r.ok) {
        renderServerGrants(r);
        serverNote("和上面那份**不是一回事**：这一份由服务器判定，对方改一行存储改不动它。两份不自动同步。", false);
        return;
      }
      if (r && r.reason === "guest") { serverNote("登录状态已过期，请重新登录后再来。下面这一份本机名单照旧可用。", true); return; }
      if (r && r.reason === "not-configured") { serverNote("本站还没开放云端账号（服务端缺密钥）：这一块暂时问不到。下面这一份本机名单照旧可用。", true); return; }
      if (r && r.reason === "no-channel") { serverNote("页面脚本版本对不上（刷新一次即可）：这一块现在只能看本机名单。", true); return; }
      if (r && r.code === "E_FORBIDDEN") { serverNote("这一条只对管理员开放（服务端的角色闸）：下面是本机那一份。", true); return; }
      serverNote("连不上服务端，这一轮没问到。下面这一份本机名单照旧可用。", true);
    })["catch"](function () { serverNote("连不上服务端，这一轮没问到。", true); });
  }

  function onServerListClick(e) {
    var b = e.target.closest ? e.target.closest("button[data-revoke]") : null;
    if (!b) return;
    var mask = b.getAttribute("data-revoke");
    var M = acct();
    if (!M || typeof M.adminRevoke !== "function") { msg("msg-server", "页面脚本版本对不上，这一轮没发出任何东西。", "warn"); return; }
    b.disabled = true;
    msg("msg-server", "正在收回 " + mask + " ……", "");
    Promise.resolve(M.adminRevoke({ emailMask: mask, backing: backing, A: window.AuthCore, E: Ent })).then(function (r) {
      b.disabled = false;
      if (!r || !r.ok) { msg("msg-server", (r && r.message) || "收回没成功，稍后再试。", "warn"); return; }
      msg("msg-server", r.changed
        ? "已在服务端收回 " + mask + " 的层级（对方刷新即回落 Free）。"
        : "服务端上本来就没有 " + mask + " 这一条。", r.changed ? "ok" : "warn");
      loadServerGrants();
    })["catch"](function () { b.disabled = false; msg("msg-server", "连不上服务端，这一轮没发出任何东西。", "warn"); });
  }

  /* ------------------------------------------------------------ 三、名单 */

  function renderList() {
    var box = $("grant-list");
    if (!box) return;
    var grants = Ent.readGrants(backing).grants;
    var empty = $("grant-empty");
    if (empty) empty.hidden = grants.length > 0;
    box.innerHTML = grants.map(function (g) {
      var when = g.until ? "到期 " + new Date(g.until).toLocaleDateString() : "永久";
      return '<li class="grant-row">' +
        '<span class="grant-mail">' + esc(g.emailMask) + "</span>" +
        '<span class="tier-badge tier-' + esc(g.tier) + '">' + esc(Ent.tierLabel(g.tier)) + "</span>" +
        '<span class="grant-when">' + esc(when) + "</span>" +
        '<button class="grant-del" type="button" data-mask="' + esc(g.emailMask) + '">删除</button>' +
        "</li>";
    }).join("");
  }

  function onListClick(e) {
    var b = e.target.closest ? e.target.closest("button[data-mask]") : null;
    if (!b) return;
    var mask = b.getAttribute("data-mask");
    var r = Ent.removeGrant(backing, mask);
    msg("msg-list", r.removed ? "已收回 " + mask + " 的层级" : "这条已经不在了", r.removed ? "ok" : "warn");
    renderList();
  }

  function onExport() {
    var text = Ent.exportGrants(backing);
    var done = function () { msg("msg-list", "名单已复制，发给对方让他导入即可", "ok"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {
        // 复制失败就把原文摊在提示里 —— 让用户能手动选走，总比干瞪眼强
        msg("msg-list", "复制失败，请手动抄下：" + text, "warn");
      });
    } else {
      msg("msg-list", "这份名单请手动抄下：" + text, "warn");
    }
  }

  /**
   * 导入名单。走全站那套 `.modal .text-modal`（「我的清单」导入用的是同一个），
   * **不用 `window.prompt`**：prompt 不能粘贴多行 JSON、样式在各家浏览器里
   * 完全不受控、而且部分 WebView 直接把它屏蔽掉（点了没反应）。
   */
  function onImportOpen() {
    var modal = $("text-dialog");
    if (!modal) return;
    var t = $("text-dialog-text");
    if (t) t.value = "";
    var title = $("text-dialog-title");
    if (title) title.textContent = "导入发放名单";
    var tip = $("text-dialog-tip");
    if (tip) tip.textContent = "把对方给你的名单 JSON 粘在这里，导入会覆盖当前名单。";
    modal.hidden = false;
    if (t) t.focus();
  }

  function closeImport() {
    var modal = $("text-dialog");
    if (modal) modal.hidden = true;
  }

  function onImportOk() {
    var t = $("text-dialog-text");
    var text = (t && t.value ? t.value : "").trim();
    if (!text) { msg("msg-list", "还没有粘贴内容", "warn"); closeImport(); return; }
    var r = Ent.importGrants(backing, text);
    closeImport();
    if (!r.ok) { msg("msg-list", r.message, "warn"); return; }
    msg("msg-list", "已导入 " + r.count + " 条发放记录", "ok");
    renderList();
  }

  /* ------------------------------------------------------------ 四、模拟身份 */

  /**
   * 「以 Free 身份预览」——本期后台**最有用**的一颗开关。
   *
   * 它做的只有一件事：把本机层级临时写回 free。因为全站所有权益判断都走
   * `Entitlement.can()` 这一个出口，所以一秒就能看清免费用户看到什么 ——
   * 这既是最快的自查手段，也是将来接服务端时最好的回归手段。
   */
  function renderSim(id) {
    var label = $("sim-label");
    var btn = $("btn-sim");
    if (!label || !btn) return;
    // ⚠️ 层级值本身也走 entitlement 的接口读（`readTier`），
    //    本页**不直接比对 "free" 这个字符串**：那等于在页面里写了一份
    //    「什么是免费层」的判断，内核换口径时它不会跟着变。
    var real = Ent.readTier(backing);
    var isFree = Ent.tierIndex(real) === 0;          // 0 = 最低档，语义由内核给
    label.textContent = Ent.tierLabel(real);
    // 已经在最低档时按钮写「恢复」——否则用户按了没反应，会以为坏了。
    // 恢复目标取「比最低档高一档」，而不是写死 "pro"：层级表换了这里也不用改。
    btn.textContent = isFree ? "恢复 " + Ent.tierLabel(Ent.TIERS[1]) : "降到 " + Ent.tierLabel(Ent.TIERS[0]);
    btn.setAttribute("data-mode", isFree ? "restore" : "free");
    void id;
  }

  function onSim() {
    var btn = $("btn-sim");
    var mode = btn ? btn.getAttribute("data-mode") : "free";
    if (mode === "restore") {
      Ent.writeTier(backing, "pro", null);
      showToast("已恢复为 Pro");
    } else {
      Ent.writeTier(backing, "free", null);
      showToast("现在以 Free 身份预览");
    }
    renderSim(Ent.identity({ backing: backing }));
  }

  /* ------------------------------------------------------------ 五、危险区 */

  function onWipeStart() { hide($("wipe-step-1")); show($("wipe-step-2")); msg("msg-wipe", ""); }
  function onWipeCancel() { hide($("wipe-step-2")); show($("wipe-step-1")); msg("msg-wipe", ""); }
  function onWipeConfirm() {
    Ent.clearGrants(backing);
    hide($("wipe-step-2"));
    show($("wipe-step-1"));
    msg("msg-wipe", "发放名单已清空，所有已发放的层级都已收回。", "ok");
    renderList();
  }

  /* ------------------------------------------------------------ 初始化 */

  function init() {
    var id = Ent.identity({ backing: backing });

    if (!isOwner(id)) {
      // 非管理员：只画一句如实的拒绝，**下面每一块都不渲染**
      show($("deny-card"));
      var lead = $("deny-lead");
      if (lead) {
        lead.textContent = "只对本机管理员开放。你现在是「" + Ent.tierLabel(id.tier) +
          "」" + (id.signedIn ? "（" + (id.mask || "无邮箱") + "）" : "（未登录）") + "。";
      }
      $("btn-back-profile").addEventListener("click", function () { location.href = "/profile/"; });
      return;
    }

    // 落一次「本机主人」标记（幂等）：落了之后就不再看层级记录。
    // 这一步是「首次打开的这个浏览器就是主人」那句话的实现。
    Ent.markOwner(backing);

    show($("grant-card"));
    show($("server-card"));
    show($("list-card"));
    show($("sim-card"));
    show($("danger-card"));
    renderTierPick();
    renderList();
    renderSim(id);
    loadServerGrants();

    $("tier-pick").addEventListener("click", onPick);
    $("btn-grant").addEventListener("click", onGrant);
    $("btn-grant-local").addEventListener("click", onGrantLocal);
    $("server-list").addEventListener("click", onServerListClick);
    $("btn-server-reload").addEventListener("click", loadServerGrants);
    $("grant-list").addEventListener("click", onListClick);
    $("btn-export").addEventListener("click", onExport);
    $("btn-import-open").addEventListener("click", onImportOpen);
    $("btn-sim").addEventListener("click", onSim);
    $("btn-wipe-start").addEventListener("click", onWipeStart);
    $("btn-wipe-cancel").addEventListener("click", onWipeCancel);
    $("btn-wipe-confirm").addEventListener("click", onWipeConfirm);

    // 导入对话框：三颗键与遮罩都关得掉（与「我的清单」同一套交互）
    var ok = $("text-dialog-ok"), cancel = $("text-dialog-cancel"), modal = $("text-dialog");
    if (ok) ok.addEventListener("click", onImportOk);
    if (cancel) cancel.addEventListener("click", closeImport);
    if (modal) {
      modal.addEventListener("click", function (e) {
        if (e.target && e.target.getAttribute && e.target.getAttribute("data-close")) closeImport();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.AdminPage = {
    isOwner: isOwner, esc: esc,
    /* 给测试用：两条路的读表单与分情况说话都是纯逻辑，单独暴露出来好钉住 */
    readForm: readForm, grantFailed: grantFailed
  };
})();
