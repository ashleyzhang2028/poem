/**
 * 管理后台（/admin/）—— 按邮箱掩码发放 Free / Pro / Max
 * ==========================================================================
 * 诚实形态是「手工发邀请码的本机版」：
 *
 *   管理员在这台机器上写好名单  →  把名单导出给用户
 *   →  用户在自己浏览器上导入  →  名单里的掩码与自己的邮箱掩码对上就生效
 *
 * ⚠️ 三条不许含糊的事（文档 §3.5 与 §3.4 白纸黑字）：
 *   1. **发给别人需要对方自己导入名单** —— 本页发的是本机名单，传不出去
 *      （服务端已接通，但权威发放 `POST /admin/grant` 还没做，见 docs §3.5）
 *   2. **对方改一行存储就能升级** —— 所以这不是收费凭据、不是安全边界
 *   3. **非 owner 看到的是一句如实的拒绝**，并且**不渲染**下面任何一块
 *      （不是「藏起来」——藏起来的东西改了 JS 就出来了；这里是不给它画）
 *
 * 分层那套规则一条都不在本文件里：全在 `js/entitlement.js`。
 * 本页只做「读名单、写名单、把结果画出来」。
 */
(function () {
  "use strict";

  var Ent = window.Entitlement;

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
    //    服务端版接进来时，这里改成 `Ent.isOwner(null, { role: id.role })`。
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

  function onGrant() {
    var mask = (($("input-mask") || {}).value || "").trim();
    if (!mask) { msg("msg-grant", "请填邮箱掩码（与用户在账号页看到的那串一致）", "warn"); return; }
    var untilStr = (($("input-until") || {}).value || "").trim();
    var until = null;
    if (untilStr) {
      // 到期日按当天 23:59:59 生效结束：填「今天」等于今天还能用
      var t = Date.parse(untilStr + "T23:59:59");
      if (!isFinite(t)) { msg("msg-grant", "到期日看不懂，请用日期选择器", "warn"); return; }
      until = t;
    }
    var r = Ent.putGrant(backing, { emailMask: mask, tier: pickedTier, until: until, by: "owner", at: Date.now() });
    if (!r.ok) { msg("msg-grant", r.message, "warn"); return; }
    msg("msg-grant", "已发放：" + r.grant.emailMask + " → " + Ent.tierLabel(r.grant.tier) +
      (r.grant.until ? "（到期 " + new Date(r.grant.until).toLocaleDateString() + "）" : "（永久）"), "ok");
    var m = $("input-mask"); if (m) m.value = "";
    renderList();
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
    show($("list-card"));
    show($("sim-card"));
    show($("danger-card"));
    renderTierPick();
    renderList();
    renderSim(id);

    $("tier-pick").addEventListener("click", onPick);
    $("btn-grant").addEventListener("click", onGrant);
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

  window.AdminPage = { isOwner: isOwner, esc: esc };
})();
