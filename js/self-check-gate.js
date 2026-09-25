(function () {
  "use strict";

  // 「自检页谁能看」（Issue #276 后续）。
  //
  // 用户原话：
  //
  //   「自检页面只能已登录的管理员账号访问，其他情况一律不显示自检页面
  //     链接，且不能访问」
  //
  // 三件事，缺一不可 —— **入口**与**页面**都得判，判据只有一个：
  //
  //   · 入口：`js/settings-nav.js` 的「设置 · 关于」里那一行「自检」，
  //     只有 `Entitlement.isOwner()` 为真（服务端下发的 role 是
  //     owner / admin）时才渲染。未登录、普通用户、服务端没答案 —— 一律
  //     不显示那一行。
  //   · 页面：本脚本在 `/self-check/` 上跑，判据与 `/admin/` 走同一个出口
  //     （`Entitlement.isOwner()`），不通过就把整块内容收走、换成一句
  //     「只对管理员开放」，并**不启动** `js/self-check.js`（它压根不会被
  //     加载，所以既不会打 `/api/diag` 也不会打 `/api/register` 探针）。
  //   · 隐藏入口**不是**安全边界（README 那四条硬规矩里的原话）：
  //      `/api/diag` 自己会回 401 / 403，服务端那一闸在 `core.opsDiag`。
  //      这里做的是「不把一个内部诊断页摆在普通用户面前」。
  //
  // ⚠️ 本脚本**必须在 `js/self-check.js` 之前**加载，并且用同步的
  //    `document.write` 之外的手段挡住后者：做法是把那一行 `<script>`
  //    留在文档里、给它 `type="text/plain"`（浏览器不执行），只在放行时
  //    把它换成真的脚本 —— 见下面 `arm()`。

  function Ent() { return window.Entitlement || null; }

  var backing = null;
  try { backing = window.localStorage; } catch (e) { backing = null; }

  function allowed() {
    var E = Ent();
    if (!E || typeof E.isOwner !== "function") return false;
    var id = null;
    try { id = E.identity({ backing: backing }); } catch (e) { id = null; }
    // ⚠️ 传参带上 **uid**（Issue #276 后续）：光有 role 分不清服务端那份
    //    答案是不是**当前这位**的 —— 同一台机器换个人登录时，上一位的
    //    owner 会被继承。`Entitlement.isOwner()` 会核对缓存里那份答案的主人。
    try {
      return !!E.isOwner(backing, id ? { role: id.role, uid: id.uid } : undefined);
    } catch (e) {
      return false;
    }
  }

  function deny() {
    var page = document.getElementById("selfcheck-page");
    if (page) page.hidden = true;
    var denyBox = document.getElementById("selfcheck-deny");
    if (denyBox) denyBox.hidden = false;
    var back = document.getElementById("btn-selfcheck-back");
    if (back) {
      back.addEventListener("click", function () { location.href = "/mine/"; });
    }
  }

  function arm() {
    // 放行：先把内容那一块从 `hidden` 里放出来（页面默认是**藏着**的 ——
    // 判据没跑完之前，谁都不许先看见「逐条结论」那几个字）。
    var page = document.getElementById("selfcheck-page");
    if (page) page.hidden = false;

    // 再把「占位」的 `<script id="self-check-script" type="text/plain">`
    // 换成一枚真脚本。这样一来拒绝那一支里那个文件**一次都没被请求**，
    // 页面也就不会替它去打任何接口。
    var holder = document.getElementById("self-check-script");
    if (!holder) return;
    var s = document.createElement("script");
    s.src = holder.getAttribute("data-src") || "/js/self-check.js";
    holder.parentNode.replaceChild(s, holder);
  }

  function init() {
    if (allowed()) { arm(); return; }
    deny();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.SelfCheckGate = { allowed: allowed };
})();
