/**
 * 「设置」二级页的清单渲染（全站唯一一份）
 * ==========================================================================
 * 为什么要有这个文件：
 *   设置项变多以后（Issue #114 分组、#132 账号 / 头像 / 复习算法），
 *   一页里堆不下。再往上加只会更长，于是把每一组摊成一页二级页：
 *
 *     /settings/         设置主页 —— 四条入口 + 版权与法务链接
 *     /settings/general/   通用     （用户名 / 头像 / 账号 / 数据管理）
 *     /settings/recite/    背诵     （学段 / 年级 / 学期 / 范围 / 数量 / 算法 / 进度总览）
 *     /settings/lists/     我的清单 （自选背诵的增删改查 / 篇目打印 · Pro）
 *     /settings/reader/    朗读     （自动注音 + 五档连读方式）
 *
 *   ⚠️ Issue #163：原「阅读辅助」与「朗读播放」各只有一条设置，两个组标题
 *      并成一组「朗读」，全站设置分组由六组变五组，主页入口由六条变四条。
 *   ⚠️ Issue #159：3 期新增「打印」一组（篇目打印页，Pro · export.paper），
 *      它长在「我的清单」页上 —— 要打印的正是这份清单，所以全站是六组。
 *
 * 这一份文件只渲染**一处**：
 *   · 主页那四组入口 + 账号那一行（未登录给登录入口，已登录给个人中心）——
 *     见 renderAccountEntry，Issue #132 · A→B→C→D 的 D。
 *     账号原本是自己一张卡、架在入口清单**上面**；Issue #163 用户原话
 *     「把这个按钮和其他按钮放一起啊」之后，它进清单**里面**：
 *     登录 / 个人中心那一行与「通用」等四行同宽、同高、同一个右箭头。

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

  /** 组 → 二级页的对照表（主页清单与各二级页共用这一份）
   *
   *  ⚠️ 顺序=主页上的顺序。账号那一行**不在这张表里**：它不是一组设置，
   *     是「我是谁」，而且它的文案随登录态变（见 renderAccountEntry）。
   *     但它与这四行**肩并肩**排，由 renderIndex 摆在一起。 */
  var GROUPS = [
    {
      key: "general",
      href: "/settings/general/",
      title: "通用",
      desc: "用户名、头像、账号、数据备份"
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
      desc: "自动注音 · 连读方式"
    }
  ];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /**
   * 画主页那四条入口（Issue #163 后由六条变四条）。
   *
   * 每一项的结构与「我的清单」那一组同一套排版（label + 说明 + 右侧箭头），
   * 所以用户看到的仍是设置页本来的样子，只是每一项现在点得动、点进去是一页。
   */
  function renderIndex() {
    var box = document.querySelector("#settings-index");
    if (!box) return;

    box.innerHTML = "";
    if (!box.classList.contains("settings-groups")) box.classList.add("settings-groups");
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
        go();
      box.appendChild(row);
    });
  }

  /* ---------------- 账号卡（Issue #132 · A→B→C→D 的 D） ---------------- */

  /**
   * 设置主页清单里的「账号」那一行。
   *
   * 为什么要它：设置主页本身是全站四页签之一，而账号那一项埋在
   * 设置 → 通用 → 账号 两层深里。一个还没登录的人从首页走到那里，
   * 才知道「这里可以建账号」。补这一行，动线从三步变一步。
   *
   * ⚠️ Issue #163 用户原话：「另外把这个按钮和其他按钮放一起啊」——
   *    它原先是一张**自己一张卡**、架在四组入口**上面**（两行字 + 一颗
   *    「用邮箱登录」的小按钮），与下面四张入口卡不像一套东西。
   *    现在它就是清单里的**一行**：与「通用」等四行同宽、同高、同一个箭头，
   *    只是内容换成「登录 / 昵称 + 层级徽章」。登录这颗键不再自成一处。
   *
   * 三条刻意收着的口径：
   *   · **已登录时只给「个人中心」，不给「去登录」** —— 再摆一次是自相矛盾的。
   *     想退出 / 注销的人在个人中心里，与那两件事放在一起。
   *   · **层级徽章与文案一律走 Entitlement** —— 本文件不出现 `plan === 'pro'`
   *     这类判断（`test/account-entry.test.js` 有源码扫描守着）。
   *   · **未登录那行只有标题，没有说明行** —— 它原先写「差语音朗读」，
   *     Issue #209 用户 2026-09-17 原话：「删除 差语音朗读。」（整句删掉，
   *     不是改写）。「登录能多出什么」这件事上面那张层级对比表逐条列着，
   *     不在一条入口行上再念一遍。
   *
   * 拿不到内核时（老缓存 / 脚本顺序不对）**这一行不画**：设置主页宁可少一行，
   * 也不长出一颗点了不知道去哪儿的按钮。
   */
  function renderAccountEntry() {
    var box = document.querySelector("#settings-index");
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

    var row = document.createElement("a");
    row.className = "settings-item settings-link";
    row.setAttribute("data-group-link", "account");

    if (id.signedIn) {
      var av = g.Avatar;
      var d = av && av.display ? av.display(backing) : { nickname: "" };
      var name = (d && d.nickname) || "未起名";
      row.id = "btn-entry-profile";
      row.href = "/profile/";
      row.innerHTML =
        '<span class="settings-link-main">' +
        '<span class="settings-link-title">' + esc(name) + badge + "</span>" +
        '<span class="settings-link-desc">个人中心 · 登录状态 · 退出</span>' +
        "</span>" +
        go();
    } else {
      row.id = "btn-entry-login";
      row.href = "/login/";
      row.innerHTML =
        '<span class="settings-link-main">' +
        '<span class="settings-link-title">登录' + badge + "</span>" +
        "</span>" +
        go();
    }

    box.appendChild(row);
  }

  /**
   * 右侧那颗箭头。
   *
   * ⚠️ 只能写成**字符串**拼进 innerHTML —— 若改成先 createElementNS 再 append，
   *    jsdom 与少数老 WebView 上 `<svg>` 会落到错误的命名空间里（画不出来）。
   *    写成 innerHTML 时 HTML 解析器认得 `<svg>`，不必再标命名空间。
   */
  function go() {
    return '<span class="settings-link-go" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M9.4 5.6 15.8 12l-6.4 6.4"/></svg>' +
      "</span>";
  }

  /* ⚠️ 顺序不能反：账号那一行是**追加进主页清单**的，
     所以它必须排在 renderIndex 之后（反了就被 renderIndex 的 innerHTML = "" 抹掉）。 */
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
