(function () {
  "use strict";

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

  var APP_VERSION = "1.0 (v151)";

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

    box.innerHTML =
      '<h2 class="settings-about-title">关于</h2>' +
      '<div class="kv-list">' +
      '<div class="kv-row"><span class="kv-k">应用</span><span class="kv-v">跬步 · 古诗词背诵</span></div>' +
      '<div class="kv-row"><span class="kv-k">版本</span><span class="kv-v">' + esc(APP_VERSION) + "</span></div>" +
      '<div class="kv-row"><span class="kv-k">离线缓存</span><span class="kv-v">' + esc(cached) + "</span></div>" +
      '<div class="kv-row"><span class="kv-k">用户协议</span><span class="kv-v"><a href="/terms/">查看</a></span></div>' +
      '<div class="kv-row"><span class="kv-k">隐私条款</span><span class="kv-v"><a href="/privacy/">查看</a></span></div>' +
      "</div>";
  }

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

    var el;
    if (id.signedIn) {

      var av = g.Avatar;
      var d = av && av.display ? av.display(backing) : { nickname: "" };
      var name = (d && d.nickname) || "未起名";
      el = row(esc(name) + badge, "标签 · 登录状态 · 退出",
        { id: "btn-entry-profile", key: "account", href: "/profile/" });
    } else {

      el = row("个人中心" + badge, "标签 · 登录 · 层级",
        { id: "btn-entry-login", key: "account", href: "/login/" });
    }

    if (box.firstChild) box.insertBefore(el, box.firstChild);
    else box.appendChild(el);
  }

  function go() {
    return '<span class="settings-link-go" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M9.4 5.6 15.8 12l-6.4 6.4"/></svg>' +
      "</span>";
  }

  function init() {
    renderIndex();
    renderAccountEntry();
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
    renderAccountEntry: renderAccountEntry,
    renderAbout: renderAbout,
    hrefFor: function (key) {
      for (var i = 0; i < GROUPS.length; i += 1) {
        if (GROUPS[i].key === key) return GROUPS[i].href;
      }
      return "/settings/";
    }
  };
})();
