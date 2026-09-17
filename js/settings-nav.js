/**
 * 「我的」页清单渲染（全站唯一一份）
 * ==========================================================================
 * 这一份文件画的是**「我的」那一页**（路由 /settings/，底部最后一个页签）
 * 上的那张清单 —— 全站所有「分组入口」的唯一一处定义。
 *
 * ```
 *   个人中心        标签 / 退出登录 / 注销            ← 这是谁（一直排第一个）
 *   通用            用户名、头像、账号、数据备份
 *   背诵            学段 / 年级 / 学期 / 范围 / 数量 · 复习算法
 *   清单            自选背诵的增删改查
 *   朗读            自动注音 · 连读方式
 *   关于            应用名、法务两页与离线状态、当前版本   ← 这台应用是什么（一直排最后一个）
 * ```
 *
 *   ⚠️ Issue #209（用户 2026-09-17）：「将右下角设置改成 我的 …… 用户点击我的之后，
 *      转到我的页面，显示之前四个设置项，包括 通用 背诵 我的清单 朗读，
 *      把我的清单改成 清单，另外在通用上面加一个 个人中心，最下面加一个 关于」
 *      —— 于是底部那格的**名字**从「设置」变成「我的」（见 js/chrome.js 的
 *      DOCK_ITEMS），这一页的清单从「四组 + 账号一行」变成**六行**：
 *      账号那一行**升格**成第一条「个人中心」（它本来就是「我是谁」，
 *      而这一页现在就叫「我的」），末尾补一条「关于」（应用名 / 法务 / 离线）。
 *      「我的清单」在清单里简称「清单」（页名仍是原样，见 settings/lists/index.html）。
 *
 *   ⚠️ 「关于」里的那几条**不从这一页单独开一页**：它们是只读信息 + 两条外链
 *      （/terms/、/privacy/），摊成第三条二级页会得到一张只有四行的空页。
 *      它们由 renderAbout 就地渲染成这一页最底下那一块（.settings-about）。
 *
 * 三条刻意的口径：
 *   · 清单由**数据**生成，不在 HTML 里手写六个 <section> —— 加一行只改下面一处，
 *     不会出现「主页加了、别处没加」。
 *   · URL 一律目录化（`/settings/reader/`），与全站既有约定一致
 *     （见 js/chrome.js 的 ROUTES：不带 .html）。
 *   · 每一行都渲染成 <a> 而不是 <button>：可右键、可新开、可键盘，
 *     设置页此前那条「点了没反应」的老账（.dock-item 下划线）也是同一类坑。
 *   · 层级徽章只走 `Entitlement`（`tierLabel` / `identity`），
 *     这一份文件里**没有**任何 `plan === 'pro'` 这类自己拼的判断。
 *
 * 各二级页里的表单控件（学段 / 年级 / 范围 / 算法 / 连读 / 清单面板）
 * 仍是 js/settings.js 那一套 —— 它按 id 回显与写值，HTML 搬到哪一页
 * 都照旧工作，所以那 500 行调用点一处不用动。
 */
(function () {
  "use strict";

  /** 组 → 二级页的对照表（这一页的清单与各二级页共用这一份）
   *
   *  ⚠️ 顺序 = 这一页上的顺序。清单最终是**六行**，但这里只有四组：
   *     · 第一条「个人中心」不在表里 —— 它不是一组设置，是「我是谁」，
   *       文案随登录态变（见 renderAccountEntry），由 init() 最先插进来；
   *     · 最后一条「关于」也不在表里 —— 它是一块只读信息（见 renderAbout），
   *       不是一张要进去的二级页，由 init() 最后追加。 */
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

  /** 与 sw.js 的 CACHE_NAME 同步的版本号（页面读不到 SW 作用域里的常量）。
   *  ⚠️ 改了 sw.js 的 CACHE_NAME 就改它一处 —— test/settings-nav.test.js 有断言守着。 */
  var APP_VERSION = "1.0 (v145)";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /**
   * 一行入口的骨架（标题 + 说明 + 右侧箭头）。
   *
   * 这一页上**每一行都是同一件事**：点一下去别处。所以骨架只写一次，
   * 三处（分组入口 / 个人中心 / 关于）都从这里拿 —— 上一版分组入口与
   * 账号那一行各拼一遍 innerHTML，两处的类名与结构靠人抄对。
   *
   * ⚠️ 箭头只能写成**字符串**拼进 innerHTML：若改成先 createElementNS 再 append，
   *    jsdom 与少数老 WebView 上 `<svg>` 会落到错误的命名空间里（画不出来）。
   *    写成 innerHTML 时 HTML 解析器认得 `<svg>`，不必再标命名空间。
   */
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

  /**
   * 画那四组入口。
   *
   * 每一项的结构与「个人中心」那一行同一套排版（标题 + 说明 + 右侧箭头），
   * 所以用户看到的仍是本来的样子，只是每一项现在点得动、点进去是一页。
   */
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

  /**
   * 「关于」那一块（这一页最底下一条）。
   *
   * 用户 2026-09-17 原话：「最下面加一个 关于」。
   * 它是**只读信息 + 两条外链**，不是一张二级页 —— 摊成第三条页面会得到
   * 一张只有四行的空页（而「关于」本来最不需要点进去）。
   *
   * 三条口径：
   *   · 应用名 / 法务两页的地址写在这里一处，页面 HTML 里不再抄一遍；
   *   · **离线状态**读 `navigator.serviceWorker.controller`：注册好了才说
   *     「已缓存」，否则如实说「未缓存」—— 与 js/pwa.js 注册的是同一个 SW，
   *     但这里只**读**它，不重复注册（注册口只有 js/pwa.js 一处）；
   *   · 版本号从 sw.js 的 CACHE_NAME 推不出来（那是 Service Worker 作用域里的
   *     常量，页面读不到），所以这里显式写一个与 sw.js 同步的版本常量 ——
   *     改了 sw.js 的 CACHE_NAME 就改它，`test/settings-nav.test.js` 有断言守着。
   */
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

    var el;
    if (id.signedIn) {
      // 已登录：这一行的标题是**昵称 + 层级徽章**，说明行点明它去哪
      // （「个人中心 · 登录状态 · 退出」三件事都在那一页上）。
      var av = g.Avatar;
      var d = av && av.display ? av.display(backing) : { nickname: "" };
      var name = (d && d.nickname) || "未起名";
      el = row(esc(name) + badge, "标签 · 登录状态 · 退出",
        { id: "btn-entry-profile", key: "account", href: "/profile/" });
    } else {
      // 未登录：标题就是「个人中心」（不是「登录」）—— 这一页叫「我的」，
      // 第一条必须回答「我在这台机器上是谁」，而不是把人直接推到一张登录表单上。
      el = row("个人中心" + badge, "标签 · 登录 · 层级",
        { id: "btn-entry-login", key: "account", href: "/login/" });
    }

    // ⚠️ **插在第一条**：用户 2026-09-17 原话「在通用上面加一个 个人中心」——
    //    「我是谁」排在其他设置项之前，是这一页的主语。
    if (box.firstChild) box.insertBefore(el, box.firstChild);
    else box.appendChild(el);
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

  /* ⚠️ 三步的顺序不能反，且每一步都**必须**在 renderIndex 之后 ——
     renderIndex 开头是一句 `innerHTML = ""`，先插的行会被它整块抹掉。
       ① renderIndex    四组入口（清单的主体）
       ② renderAccountEntry  「个人中心」插到**第一条**（用户点名的位置）
       ③ renderAbout     「关于」追加到**最后一条** */
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
