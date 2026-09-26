(function () {
  "use strict";

  var GROUPS = [
    {
      key: "general",
      href: "/settings/general/",
      title: "通用",
      desc: "数据备份 · 课内诗词导出"
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

  var APP_VERSION = "1.0 (v260)";
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

    box.innerHTML =
      '<h2 class="settings-about-title">关于</h2>' +
      '<div class="kv-list">' +
      kvRow("应用", esc(APP_VERSION_NAME)) +
      kvRow("版本", esc(APP_VERSION)) +
      kvRow("离线缓存", esc(cached)) +
      "</div>" +

      '<h2 class="settings-about-title">页面</h2>' +
      '<div class="kv-list">' +
      kvRow(link("/plans/", "用户对比"), "") +
      kvRow(link("/terms/", "用户协议"), "") +
      kvRow(link("/privacy/", "隐私条款"), "") +
      kvRow(link("/settings/reports/", "我的报告"), "") +
      "</div>";
  }

  function selfCheckRow() {
    var Ent = null;
    try { Ent = window.Entitlement || null; } catch (e) { Ent = null; }
    if (!Ent || typeof Ent.isOwner !== "function") return "";

    var backing = null;
    try { backing = window.localStorage; } catch (e) { backing = null; }

    var id = null;
    try { id = Ent.identity({ backing: backing }); } catch (e) { id = null; }

    var ok = false;
    try { ok = !!Ent.isOwner(backing, id ? { role: id.role, uid: id.uid } : undefined); } catch (e) { ok = false; }
    if (!ok) return "";
    return kvRow(link("/self-check/", "自检"), "");
  }

  function renderSelfCheck() {
    var box = document.querySelector("#settings-about");
    if (!box) return;
    var host = box.querySelector("#settings-selfcheck");
    if (!host) {
      host = document.createElement("div");
      host.id = "settings-selfcheck";
      host.className = "kv-list";
      box.appendChild(host);
    }
    host.innerHTML = selfCheckRow();
    host.hidden = !host.innerHTML;
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
    renderSelfCheck();

    window.addEventListener("storage", renderSelfCheck);
    window.addEventListener("entitlementchange", renderSelfCheck);
    document.addEventListener("entitlementchange", renderSelfCheck);
    document.addEventListener("account:ready", renderSelfCheck);
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
    renderSelfCheck: renderSelfCheck,
    hrefFor: function (key) {
      for (var i = 0; i < GROUPS.length; i += 1) {
        if (GROUPS[i].key === key) return GROUPS[i].href;
      }
      return "/settings/";
    }
  };
})();
