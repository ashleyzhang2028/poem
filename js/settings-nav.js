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

  var APP_VERSION = "1.0 (v198)";
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
      "</div>" +
      // 「这几页去哪儿看」与上面对齐：左列自己就是链接，右列留空。
      // 分成两段是因为上面三行是**这台应用自己的事**（叫什么 / 哪一版 /
      // 能不能离线），下面四行是**另外几张页**；凑在一个表里，用户会以为
      // 「层级对比」也是设置里的一项。
      '<h2 class="settings-about-title">页面</h2>' +
      '<div class="kv-list">' +
      kvRow(link("/plans/", "层级对比"), "") +
      kvRow(link("/terms/", "用户协议"), "") +
      kvRow(link("/privacy/", "隐私条款"), "") +
      kvRow(link("/settings/reports/", "我的报告"), "") +
      "</div>";
  }

  // 「自检」那一行**只给已登录的管理员**（Issue #276 后续）。
  //
  // 用户原话：「自检页面只能已登录的管理员账号访问，其他情况一律不显示自检
  // 页面链接，且不能访问」。判据与 `/admin/` 走**同一个出口**
  // `Entitlement.isOwner()`（源头是服务端下发的 `accounts.role`），
  // 不在这一处另判一套 —— 两个地方各写一遍，迟早一处改、另一处忘。
  //
  // ⚠️ 它原先是「关于」里平铺的第五行。现在单独一段追加，是因为那一行
  //    得先知道「我是谁」才知道渲不渲染：`Entitlement.identity()` 要
  //    `poem_plan_v1` 里那份服务端答案，而那份答案可能比这一屏晚到
  //    （登录页回来、同步拉到角色）。所以这里**先不画**，等
  //    `entitlementchange` / 脚本就位后再补一次 —— 补的时候仍是同一个判据。
  //    ⚠️ `entitlementchange` 由 `js/entitlement.js` 在**那份缓存被写**的
  //       那一刻发（`writeTier` / `clearTier` 两个写入口各喊一声）。
  //       Issue #276 后续之前这里只是**听着**，没人发 —— 于是管理员登录完
  //       回到这一页，那一行要等下一次整页刷新才出现。
  function selfCheckRow() {
    var Ent = null;
    try { Ent = window.Entitlement || null; } catch (e) { Ent = null; }
    if (!Ent || typeof Ent.isOwner !== "function") return "";

    var backing = null;
    try { backing = window.localStorage; } catch (e) { backing = null; }

    var id = null;
    try { id = Ent.identity({ backing: backing }); } catch (e) { id = null; }

    // ⚠️ 带上 `uid`（Issue #276 后续）：判据是「服务端那份答案是不是当前
    // 这位的」，不是「这台机器上最后一位管理员是谁」。
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

    // 角色是**异步到位**的（登录回来、云端拉到 role 都会换一份
    // `poem_plan_v1`）。这里挂一次「变了就重画那一行」，不然管理员
    // 刚登录完回到这一页，入口要等一次整页刷新才出现。
    window.addEventListener("storage", renderSelfCheck);
    window.addEventListener("entitlementchange", renderSelfCheck);
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
