/**
 * 「设置」二级页的清单渲染（全站唯一一份）
 * ==========================================================================
 * 为什么要有这个文件：
 *   设置项变多以后（Issue #114 分组、#132 账号 / 头像 / 复习算法 / 朗读播放），
 *   一页里已经堆了六组。再往上加只会更长，于是把每一组摊成一页二级页：
 *
 *     /settings/         设置主页 —— 六个入口 + 版权与法务链接
 *     /settings/general/   通用     （用户名 / 头像印记 / 账号 / 数据管理）
 *     /settings/recite/    背诵     （学段 / 年级 / 学期 / 范围 / 数量 / 算法 / 进度总览）
 *     /settings/lists/     我的清单 （自选背诵的增删改查）
 *     /settings/reader/    朗读     （自动注音 + 五档连读范围）
 *
 * 这一份文件只做**渲染**两件事：
 *   · 主页那四条入口（一组一件事、点进去是那一页）；
 *   · 主页顶上那张「账号」卡（未登录给登录入口，已登录给个人中心）——
 *     见 renderAccountEntry，Issue #132 · A→B→C→D 的 D。

 * 各二级页里的表单控件（学段 / 年级 / 范围 / 算法 / 连读 / 清单面板）
 * 仍是 js/settings.js 那一套 —— 它按 id 回显与写值，HTML 搬到哪一页
 * 都照旧工作，所以那 500 行调用点一处不用动。
 *
 * 三条刻意的口径：
 *   · 入口卡片由**清单数据**生成，不在 HTML 里手写六个 <section> ——
 *     加一组只改下面这一处，不会出现「主页加了、二级页没加」。
 *   · URL 一律目录化（`/settings/reader/`），与全站既有约定一致
 *     （见 js/chrome.js 的 ROUTES：不带 .html）。
 *   · 清单与账号入口都渲染成 <a> 而不是 <button>：可右键、可新开、可键盘，
 *     设置页此前那条「点了没反应」的老账（.dock-item 下划线）也是同一类坑。
 *   · 账号入口的判据只走 `Entitlement` / `AuthCore`（层级徽章也用它出文案），
 *     这一份文件里**没有**任何 `plan === 'pro'` 这类自己拼的判断。
 */
(function () {
  "use strict";

  /** 组 → 二级页的对照表（主页清单与各二级页共用这一份） */
  var GROUPS = [
    {
      key: "general",
      href: "/settings/general/",
      title: "通用",
      desc: "用户名、头像印记、账号、数据备份"
    },
    {
      key: "recite",
      href: "/settings/recite/",
      title: "背诵",
      desc: "学段 / 年级 / 学期 / 范围 / 数量",
      extra: "复习算法"
    },
    {
      key: "lists",
      href: "/settings/lists/",
      title: "我的清单",
      desc: "自选背诵的增删改查"
    },
    {
      key: "reader",
      href: "/settings/reader/",
      title: "朗读",
      desc: "自动注音 · 连读范围"
    }
  ];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /**
   * 画主页那六个入口。
   *
   * 每一项的结构与「我的清单」那一组同一套排版（label + 说明 + 右侧箭头），
   * 所以用户看到的仍是设置页本来的样子，只是每一项现在点得动、点进去是一页。
   */
  function renderIndex() {
    var box = document.querySelector("#settings-index");
    if (!box) return;

    box.innerHTML = "";
    GROUPS.forEach(function (g) {
      var row = document.createElement("a");
      row.className = "settings-item settings-link";
      row.href = g.href;
      row.setAttribute("data-group-link", g.key);
      row.innerHTML =
        '<span class="settings-link-main">' +
        '<span class="settings-link-title">' + esc(g.title) + "</span>" +
        '<span class="settings-link-desc">' + esc(g.desc) +
        (g.extra ? '<span class="settings-link-extra"> · ' + esc(g.extra) + "</span>" : "") +
        "</span>" +
        "</span>" +
        '<span class="settings-link-go" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
        'stroke-linecap="round" stroke-linejoin="round"><path d="M9.4 5.6 15.8 12l-6.4 6.4"/></svg>' +
        "</span>";
      box.appendChild(row);
    });
  }

  /* ---------------- 账号卡（Issue #132 · A→B→C→D 的 D） ---------------- */

  /**
   * 设置主页顶上那张「账号」卡。
   *
   * 为什么要它：设置主页本身是全站四页签之一，而账号那一项埋在
   * 设置 → 通用 → 账号 两层深里。一个还没登录的人从首页走到那里，
   * 才知道「这里可以建账号」。补这一张，动线从三步变一步。
   *
   * 两条刻意收着的口径：
   *   · **已登录时只给「个人中心」，不给「去登录」** —— 再摆一次是自相矛盾的。
   *     想退出 / 注销的人在个人中心里，与那两件事放在一起。
   *   · **层级徽章与文案一律走 Entitlement** —— 本文件不出现 `plan === 'pro'`
   *     这类判断（`test/account-entry.test.js` 有源码扫描守着）。
   *
   * 拿不到内核时（老缓存 / 脚本顺序不对）**整张卡不画**：设置主页宁可少一张卡，
   * 也不长出一颗点了不知道去哪儿的按钮。
   */
  function renderAccountEntry() {
    var box = document.querySelector("#account-entry");
    if (!box) return;

    var g = typeof globalThis !== "undefined" ? globalThis : null;
    var A = g && g.AuthCore;
    var E = g && g.Entitlement;
    if (!A || !E) return;

    var backing = null;
    try { backing = g.localStorage; } catch (e) { backing = null; }

    var id = null;
    try { id = E.identity({ backing: backing }); } catch (e) { id = null; }
    if (!id) return;

    var badge = '<span class="tier-badge tier-' + esc(id.tier) + '">' +
      esc(E.tierLabel(id.tier)) + "</span>";

    var inner;
    if (id.signedIn) {
      var av = g.Avatar;
      var d = av && av.display ? av.display(backing) : { nickname: "" };
      var name = (d && d.nickname) || "未起名";
      inner =
        '<div class="account-entry-card" data-state="in">' +
        '<div class="account-entry-line">' +
        (av && av.html ? av.html(backing, { cls: "seal-avatar-entry" }) : "") +
        '<span class="account-entry-main">' +
        '<span class="account-entry-name">' + esc(name) + "</span>" +
        '<span class="account-entry-sub">已登录 · ' + esc(id.mask || "（无邮箱）") + "</span>" +
        "</span>" + badge + "</div>" +
        '<div class="settings-btns">' +
        '<a class="btn ghost-btn" id="btn-entry-profile" href="/profile/">个人中心</a>' +
        "</div></div>";
    } else {
      inner =
        '<div class="account-entry-card" data-state="out">' +
        '<p class="account-entry-line">' +
        '<span class="account-entry-sub">未登录（游客）</span>' + badge + "</p>" +
        '<p class="settings-hint">进度只存在本机，清缓存就没了。登录只为不丢。</p>' +
        '<div class="settings-btns">' +
        '<a class="btn ghost-btn" id="btn-entry-login" href="/login/">用邮箱登录</a>' +
        "</div></div>";
    }

    box.innerHTML = inner;
    box.hidden = false;
  }

  function init() {
    renderIndex();
    renderAccountEntry();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.SettingsNav = {
    GROUPS: GROUPS,
    renderIndex: renderIndex,
    renderAccountEntry: renderAccountEntry,
    hrefFor: function (key) {
      for (var i = 0; i < GROUPS.length; i += 1) {
        if (GROUPS[i].key === key) return GROUPS[i].href;
      }
      return "/settings/";
    }
  };
})();
