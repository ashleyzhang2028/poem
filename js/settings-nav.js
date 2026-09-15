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
 *     /settings/reader/    阅读与朗读（注音总开关 + 五档连读）
 *
 * 这一份文件只做**清单渲染**：一组一件事、点进去是那一页。
 * 各二级页里的表单控件（学段 / 年级 / 范围 / 算法 / 连读 / 清单面板）
 * 仍是 js/settings.js 那一套 —— 它按 id 回显与写值，HTML 搬到哪一页
 * 都照旧工作，所以那 500 行调用点一处不用动。
 *
 * 三条刻意的口径：
 *   · 入口卡片由**清单数据**生成，不在 HTML 里手写六个 <section> ——
 *     加一组只改下面这一处，不会出现「主页加了、二级页没加」。
 *   · URL 一律目录化（`/settings/reader/`），与全站既有约定一致
 *     （见 js/chrome.js 的 ROUTES：不带 .html）。
 *   · 清单渲染成 <a> 而不是 <button>：可右键、可新开、可键盘，
 *     设置页此前那条「点了没反应」的老账（.dock-item 下划线）也是同一类坑。
 */
(function () {
  "use strict";

  /** 六组 → 二级页的对照表（主页清单与各二级页共用这一份） */
  var GROUPS = [
    {
      key: "general",
      href: "/settings/general/",
      title: "通用",
      desc: "用户名与头像印记、本机账号、数据备份"
    },
    {
      key: "recite",
      href: "/settings/recite/",
      title: "背诵",
      desc: "今天背哪几首：学段 / 年级 / 学期 / 范围 / 数量",
      extra: "复习算法"
    },
    {
      key: "lists",
      href: "/settings/lists/",
      title: "我的清单",
      desc: "自选背诵：导入 / 导出 / 改名 / 删除 / 整组移出 / 调顺序"
    },
    {
      key: "reader",
      href: "/settings/reader/",
      title: "阅读与朗读",
      desc: "自动注音，以及连读时怎么念"
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

  function init() {
    renderIndex();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.SettingsNav = {
    GROUPS: GROUPS,
    renderIndex: renderIndex,
    hrefFor: function (key) {
      for (var i = 0; i < GROUPS.length; i += 1) {
        if (GROUPS[i].key === key) return GROUPS[i].href;
      }
      return "/settings/";
    }
  };
})();
