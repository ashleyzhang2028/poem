(function () {
  "use strict";

  var GROUPS = [
    {
      key: "general",
      href: "/settings/general/",
      title: "通用",
      desc: "用户名、账号、数据备份"
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
      title: "清单",
      desc: "自选背诵的增删改查"
    },
    {
      key: "reader",
      href: "/settings/reader/",
      title: "朗读",
      desc: "自动注音 · 连读方式"
    }
  ];

  var APP_VERSION = "1.0 (v164)";
  var APP_VERSION_NAME = "跬步 · 古诗词背诵";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function row(title, desc, attrs) {
    var a = document.createElement("a");
    a.className = "settings-item settings-link";
    if (attrs && attrs.id) a.id = attrs.id;
    if (attrs && attrs.key) a.setAttribute("data-group-link", attrs.key);
    a.href = attrs && attrs.href ? attrs.href : "/settings/";
    a.innerHTML =
      '<span class="settings-link-main">' +
      '<span class="settings-link-title">' + title + "</span>" +
      (desc ? '<span class="settings-link-desc">' + desc + "</span>" : "") +
      "</span>" +
      go();
    return a;
  }

  function renderIndex() {
    var box = document.querySelector("#settings-index");
    if (!box) return;

    box.innerHTML = "";
    if (!box.classList.contains("settings-groups")) box.classList.add("settings-groups");
    GROUPS.forEach(function (g) {
      box.appendChild(row(esc(g.title),
        esc(g.desc) + (g.extra ? '<span class="settings-link-extra"> · ' + esc(g.extra) + "</span>" : ""),
        { key: g.key, href: g.href }));
    });
  }

  function renderAbout() {
    var box = document.querySelector("#settings-about");
    if (!box) return;

    var cached = "未缓存";
    try {
      var nav = (typeof navigator !== "undefined" && navigator) || null;
      if (nav && nav.serviceWorker && nav.serviceWorker.controller) cached = "已缓存，可离线打开";
    } catch (e) { cached = "未缓存"; }

    // 「关于」这几行是同一套排法：左列写项名（自己当链接的那几行就是入口，
    // 不用另挂一颗「查看」），右列写值；没有值的那几行右列**留空**。
    //
    // 几条入口写成一整行普通文字（蓝色 + 无下划线），行高与「应用 / 版本 /
    // 离线缓存」完全一致 —— 用户 2026-09-18：不要下划线，间距要和上面几行一样。
    // 「自检」也走同一套（它原先在「设置 · 通用」里是一颗按钮，用户点名搬到
    // 这儿、排在最后一行）。
    box.innerHTML =
      '<h2 class="settings-about-title">关于</h2>' +
      '<div class="kv-list">' +
      kvRow("应用", esc(APP_VERSION_NAME)) +
      kvRow("版本", esc(APP_VERSION)) +
      kvRow("离线缓存", esc(cached)) +
      kvRow(link("/plans/", "层级对比"), "") +
      kvRow(link("/terms/", "用户协议"), "") +
      kvRow(link("/privacy/", "隐私条款"), "") +
      kvRow(link("/self-check/", "自检"), "") +
      "</div>";
  }

  function kvRow(k, v) {
    return '<div class="kv-row"><span class="kv-k">' + k + "</span>" +
      '<span class="kv-v">' + (v || "") + "</span></div>";
  }

  function link(href, text) {
    return '<a class="kv-link" href="' + href + '">' + esc(text) + "</a>";
  }

  function go() {
    return '<span class="settings-link-go" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M9.4 5.6 15.8 12l-6.4 6.4"/></svg>' +
      "</span>";
  }

  function init() {
    renderIndex();
    renderAbout();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.SettingsNav = {
    GROUPS: GROUPS,
    renderIndex: renderIndex,
    renderAbout: renderAbout,
    hrefFor: function (key) {
      for (var i = 0; i < GROUPS.length; i += 1) {
        if (GROUPS[i].key === key) return GROUPS[i].href;
      }
      return "/settings/";
    }
  };
})();
