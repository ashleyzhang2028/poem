(function () {
  "use strict";

  function $(sel, root) { return (root || document).querySelector(sel); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function familyMod() { return window.Family || null; }
  function avatarMod() { return window.Avatar || null; }
  function entitlementMod() { return window.Entitlement || null; }
  function showToast(msg) {
    var t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { t.hidden = true; }, 2200);
  }

  function render() {
    const box = $("#family-panel");
    const hint = $("#family-hint");
    if (!box) return;
    const F = familyMod();
    const AV = avatarMod();
    if (!F) { box.innerHTML = ""; if (hint) hint.textContent = ""; return; }

    const data = F.ensureDetailed({ backing: window.localStorage });
    const list = data.data.profiles;
    const at = data.data.at;
    const lim = F.limit({ backing: window.localStorage, E: entitlementMod() });
    const unlimited = lim === Infinity;

    box.innerHTML = "";
    list.forEach(function (p) {
      const row = document.createElement("div");
      row.className = "family-row" + (p.id === at ? " current" : "");
      row.dataset.familyId = p.id;
      const name = p.nickname || "未起名";
      row.innerHTML =
        '<button class="family-pick" type="button" data-family-pick="' + esc(p.id) + '"' +
        (p.id === at ? ' aria-current="true"' : "") + ">" +
        (AV ? AV.htmlFor(p, {}) : "") +
        '<span class="family-name">' + esc(name) + "</span>" +
        (p.id === at ? '<span class="family-now">当前</span>' : "") +
        "</button>" +
        '<span class="family-acts">' +
        '<button class="family-act" type="button" data-family-rename="' + esc(p.id) + '" ' +
        'aria-label="重命名">改名</button>' +
        (list.length > 1
          ? '<button class="family-act danger" type="button" data-family-remove="' + esc(p.id) +
            '" aria-label="删除">删除</button>'
          : "") +
        "</span>";
      box.appendChild(row);
    });

    const left = unlimited
      ? Infinity
      : F.remaining({ backing: window.localStorage, E: entitlementMod() });

    if (left > 0) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "family-add";
      btn.id = "btn-family-add";
      btn.textContent = unlimited ? "新建" : "新建（还可建 " + left + " 个）";
      box.appendChild(btn);
    }

    if (hint) hint.textContent = limitLine(list.length, lim);
  }

  function quoText(n) {
    if (n === Infinity) return "不限";
    if (!(n > 0)) return "不支持";
    return String(n);
  }

  function limitLine(count, lim) {
    return "当前 " + count + " / " + quoText(lim) + " 个";
  }

  // 切子用户（Issue #320）。
  //
  // ⚠️ 顺序是有讲究的：**先让位、再切**。
  //    本机那份头像字节（`poem_avatar_local_v1`）跟着子用户走，
  //    而「搬字节」只发生在 `ensure()` / `adoptAvatarBytes()` 上。
  //    这里在切走之前先看一眼当前这个孩子是不是**一个字节都没有**
  //    （老键上还留着上一版不分家那张图的那类设备）——是的话赶紧认领，
  //    免得它被切走之后就再也认不着了。
  function switchFamily(id) {
    const F = familyMod();
    if (!F) return;
    const cur = F.currentId({ backing: window.localStorage });
    if (cur && cur !== id && typeof F.adoptAvatarBytes === "function") {
      F.adoptAvatarBytes(cur, { backing: window.localStorage });
    }
    const r = F.select(id, { backing: window.localStorage });
    if (!r.ok) { showToast("这个子用户已经不在名册里了"); return; }
    const p = F.current({ backing: window.localStorage });
    showToast("已切到「" + ((p && p.nickname) || "未起名") + "」");
    reloadAll();
  }

  function addFamily() {
    const F = familyMod();
    if (!F) return;
    const r = F.create("", { backing: window.localStorage, E: entitlementMod() });
    if (!r.ok) {
      if (r.code === "E_LIMIT") {
        const E = entitlementMod();
        const name = E && E.CAPS["profile.family"] ? E.CAPS["profile.family"].name : "家庭子用户";
        showToast("子用户已达上限（" + name + "）");
      } else {
        showToast("这一台设备上写不进去（隐私模式？）");
      }
      return;
    }
    F.select(r.profile.id, { backing: window.localStorage });
    render();
    showToast("建好了，顺手切了过来。给它起个名字。");
    syncNicknameInput();
    const inp = $("#family-rename-input");
    if (inp) inp.focus();
  }

  function startRenameFamily(id) {
    const F = familyMod();
    if (!F) return;
    const row = document.querySelector('.family-row[data-family-id="' + id + '"]');
    if (!row) return;
    const p = F.list({ backing: window.localStorage }).filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    row.innerHTML =
      '<input class="family-rename" id="family-rename-input" type="text" maxlength="' +
      F.NAME_MAX + '" value="' + esc(p.nickname || "") + '" placeholder="Ashley" ' +
      'aria-label="子用户名称" enterkeyhint="done" />' +
      '<span class="family-acts"><button class="family-act" type="button" ' +
      'data-family-rename-cancel="1">取消</button></span>';
    const inp = $("#family-rename-input");
    if (!inp) return;
    inp.focus();
    inp.select();
    const commit = function () {
      const r = F.rename(id, inp.value, { backing: window.localStorage });
      if (r.ok) {
        render();
        const F2 = familyMod();
        const cur = F2.current({ backing: window.localStorage });
        if (cur && cur.id === id) syncNicknameInput();
        showToast("名字改好了");
      } else {
        showToast("这个子用户已经不在名册里了");
        render();
      }
    };
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      if (e.key === "Escape") { e.preventDefault(); render(); }
    });
    inp.addEventListener("blur", function () { commit(); });
  }

  function removeFamily(id) {
    const F = familyMod();
    if (!F) return;
    const p = F.list({ backing: window.localStorage }).filter(function (x) { return x.id === id; })[0];
    const name = (p && p.nickname) || "未起名";
    if (!window.confirm("删除子用户「" + name + "」？\n\n名册里不再有它；它背过的进度数据仍留在本机（不会连带删除）。")) return;
    const r = F.remove(id, { backing: window.localStorage });
    if (!r.ok) {
      if (r.code === "E_LAST") showToast("至少要留一个子用户");
      else showToast("这个子用户已经不在名册里了");
      render();
      return;
    }
    showToast("已从名册里删掉「" + name + "」");
    reloadAll();
  }

  function syncNicknameInput() {
    if (window.AvatarEdit && typeof window.AvatarEdit.render === "function") window.AvatarEdit.render();
    if (typeof window.__mineSyncNickname === "function") window.__mineSyncNickname();
  }

  function reloadAll() {
    if (typeof window.__reloadSettingsControls === "function") window.__reloadSettingsControls();
    render();
    // ⚠️ 把**两处头像**都重画一遍：底栏那颗（`SiteChrome.refreshUser`）、
    //    「我的」页那一版（`family-change` 的听众）。
    //    昵称从前会自己换 —— 它读的是名册；头像读的是本机那份字节，
    //    而它从前**不在**这一条链上，于是切完还是上一个孩子那张脸（Issue #320）。
    try { document.dispatchEvent(new Event("family-change")); } catch (e) { }
    if (window.SiteChrome && window.SiteChrome.refreshUser) window.SiteChrome.refreshUser();
  }

  function bind() {
    const box = $("#family-panel");
    if (!box) return;
    box.addEventListener("click", function (e) {
      const pick = e.target.closest("[data-family-pick]");
      if (pick) { switchFamily(pick.dataset.familyPick); return; }
      const rn = e.target.closest("[data-family-rename]");
      if (rn) { startRenameFamily(rn.dataset.familyRename); return; }
      if (e.target.closest("[data-family-rename-cancel]")) { render(); return; }
      const rm = e.target.closest("[data-family-remove]");
      if (rm) { removeFamily(rm.dataset.familyRemove); return; }
      if (e.target.closest("#btn-family-add")) { addFamily(); return; }
    });
  }

  function init() {
    bind();
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.FamilyUi = { render: render, bind: bind, reload: reloadAll, notice: showToast };
})();
