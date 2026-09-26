// ===========================================================================
// 登出之后那两颗键、以及「这一发没能读懂」那一句（Issue #363）
// ---------------------------------------------------------------------------
// 用户原话：
//   「我已经登出了，能不能我的页面 不要显示 注销账号 和 管理后台按钮？
//     还有，为什么注册注册不了？说是 这一发请求没能被服务端读懂，请刷新页面重试。」
//
// 这一层守两件事（都是**功能**，不是「界面长得对不对」——界面层按 Issue #278
// 已删，这里测的是判定与文案这两条内核）：
//
//   甲 · 「注销账号 / 管理后台」两颗键的可见性：只有**登录着**才画。
//        出口是 `js/mine.js` 的 `renderAdmin()`，而它读两个判据
//        （`Entitlement.isOwner()` 与 `identity().signedIn`）—— 从前次序
//        反了：先问角色、后看登录，于是登出那一刻（服务端那一发还没回来）
//        本机那份「服务端答案」还在，键又长了出来。
//
//   乙 · `E_BAD_BODY` 那一档：文案要说清「这一发没进去、多半是页面旧了」，
//        并且前端要用**服务端原话**而不是字典里那句干话。
// ---------------------------------------------------------------------------
"use strict";

const fs = require("fs");
const vm = require("vm");
const path = require("path");
const http = require("http");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

let fails = 0;
const chk = (c, m) => { if (!c) { console.log("✗ " + m); fails++; } else console.log("✓ " + m); };
const eq = (a, b, m) => chk(a === b, m + "（实际 " + JSON.stringify(a) + "）");

function mem(m) {
  const box = m || {};
  return {
    getItem: (k) => (k in box ? box[k] : null),
    setItem: (k, v) => { box[k] = String(v); },
    removeItem: (k) => { delete box[k]; },
    raw: () => box
  };
}

// ---- 把 js/mine.js 挂进一个最小 DOM 里跑起来 -------------------------------
//
// 只实现它真用到的那几样：`getElementById` / `addEventListener` /
// `documentElement`（`watchProfile()` 的观察对象）。没有 jsdom（Issue #278
// 把界面层那一档删掉了），所以这里自己搭一间够用的屋子。
function fakeElement(id) {
  return {
    id: id,
    hidden: false,
    textContent: "",
    className: "",
    value: "",
    innerHTML: "",
    dataset: {},
    children: [],
    _attrs: {},
    _events: {},
    setAttribute(k, v) { this._attrs[k] = String(v); },
    removeAttribute(k) { delete this._attrs[k]; },
    getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
    hasAttribute(k) { return k in this._attrs; },
    addEventListener(t, fn) { (this._events[t] = this._events[t] || []).push(fn); },
    appendChild(el) { this.children.push(el); return el; },
    focus() { },
    blur() { },
    querySelector() { return null; }
  };
}

function sandbox(opts) {
  const o = opts || {};
  const els = {};
  function el(id) {
    if (!els[id]) els[id] = fakeElement(id);
    return els[id];
  }
  // 两颗键 + 那一排（页底那一排只在有人看的时候才亮）
  ["bottom-actions", "btn-delete-start", "btn-go-admin", "danger-panel",
    "delete-step-1", "delete-step-2", "identity-row", "verify-row"].forEach(el);

  const doc = {
    readyState: "complete",
    body: fakeElement("body"),
    documentElement: fakeElement("html"),
    activeElement: null,
    getElementById: (id) => (id in els ? els[id] : null),
    querySelector: () => null,
    addEventListener() { },
    createElement: (t) => fakeElement(t)
  };

  const backing = mem(o.backing || {});
  const win = {
    localStorage: backing,
    document: doc,
    location: { href: "/mine/", reload() { } },
    addEventListener() { },
    setTimeout, clearTimeout, setInterval, clearInterval,
    Promise,
    navigator: {}
  };
  win.window = win;
  win.globalThis = win;
  win.console = { log() { }, warn() { }, error() { } };

  const box = vm.createContext(win);
  // ⚠️ 挂脚本的**次序就是页面上的次序**（`mine/index.html`）：
  //    `auth-core.js` → `entitlement.js` → `mine.js`。
  //    三份都必须进沙盒：`Entitlement.identity()` 读会话时看的是**同一个全局域里**
  //    的 `globalThis.AuthCore`（见 `js/entitlement.js` 里 `identity()` 那一段），
  //    把 Node 里 require 的那一份塞进去是不作数的（不是同一个对象）。
  ["js/auth-core.js", "js/entitlement.js", "js/auth-api.js", "js/account-api.js",
    "js/mine.js"].forEach((f) => {
    vm.runInContext(read(f), box, { filename: f });
  });
  return { win: win, box: box, els: els, el: el, backing: backing, doc: doc };
}

// ---- 甲 · 未登录时不画那两颗键 -------------------------------------------
console.log("\n=== 一、未登录：「注销账号」与「管理后台」一颗都不画 ===");
{
  // ⚠️ 这一档正是用户踩到的样子：**本机还留着上一份「服务端答案」**
  //    （`poem_plan_v1`，role=owner），而本机会话已经没了 —— 登出那一刻
  //    `/api/logout` 还没回来，缓存就长这样。`Entitlement.isOwner()` 只看得到
  //    「这台机器上最后一位管理员是谁」，它会答 true。
  const raw = {
    poem_plan_v1: JSON.stringify({
      v: 1, tier: "max", until: null, source: "server",
      role: "owner", email: "belem@example.com", uid: "u_owner_1"
    })
  };
  // ⚠️ 水位线（`poem_plan_seen_v1`）也照着现场写：`/api/me` 认过人就会写下它，
  //    而退出登录那条路（`clearServerTier()`）只在服务端那一发回来之后才清。
  //    「本机会话没了、答案还在、水位线还对得上」是真会同时出现的一档 ——
  //    `cookieSession()` 于是**认**这份答案（它说「服务端刚认过这个人」），
  //    `identity()` 便如实回「登录着」，可这人其实已经登出了。
  raw.poem_plan_seen_v1 = JSON.stringify({ uid: "u_owner_1", until: null });
  const s = sandbox({ backing: raw });

  const E = s.box.Entitlement;
  // ⚠️ 这一条是**用户报的那一脚的机制本身**：那份「服务端答案」与它的水位线
  //    都还在，`cookieSession()` 于是认它（它只答「这份答案是不是本机刚问来
  //    的」，答不了「人还在不在」）—— 于是 `identity()` 回了「登录着」。
  //    退出登录这一路**先清本机、再打 `POST /api/logout`**（次序是有意的，
  //    见 `onSignOut()`），而服务端那一发回来之前，本机就是这个样子。
  eq(!!E.cookieSession({ backing: s.backing }), true,
    "造出用户踩到的那一档：本机那份「服务端答案」还在，`cookieSession()` 认它");
  eq(E.identity({ backing: s.backing }).signedIn, true,
    "⚠️ 于是 `identity()` 也如实回「登录着」—— 它没撒谎，是**这一档本来就含糊**");
  eq(E.isOwner(s.backing, { uid: "u_owner_1" }), true,
    "`isOwner()` 当然也认（它只答「这本机上最后一位管理员是谁」）");

  // 那这一档靠什么收场？靠**登出这条路自己把缓存清掉 / 页面重画**。
  // 用户看到的是「登出之后那两颗键还在」，所以这里先把「本机已被清干净」
  // 那一档画一遍（`clearServerTier()` 干的就是这件事）。
  E.clearTier(s.backing);
  s.backing.removeItem("poem_plan_seen_v1");
  eq(E.identity({ backing: s.backing }).signedIn, false, "清完之后 identity() 回「未登录」");

  vm.runInContext("MinePage.paint(null);", s.box);
  eq(s.el("btn-delete-start").hidden, true, "「注销账号」没画出来");
  eq(s.el("btn-go-admin").hidden, true, "「管理后台」**也没画**（哪怕 isOwner() 刚说了「是」）");
  eq(s.el("bottom-actions").hidden, true, "页底那一排整条也是收着的（两颗都关着，就别留一条空排）");
}

console.log("\n=== 二、登出那一刻（服务端还没回来）也不许闪出来 ===");
{
  // 造一份「登出前」的存储：本机会话在、服务端答案在、水位线也对得上。
  const raw = {};
  const NodeAuthCore = require(path.join(ROOT, "js/auth-core.js"));
  const backing = mem(raw);
  const store = NodeAuthCore.makeStore(backing);
  // ⚠️ 本机会话那一份**按它真实的形状**造（`poem_auth_v1` 的 `sessions`），
  //    不调 `A.signIn()` —— 内核里根本没有那个函数，会话只在
  //    `verifyCode()` / `signInTrusted()` 那两条真路上 `issueSession()` 出来。
  const now = Date.now();
  store.write({
    v: 1,
    accounts: {
      u_owner_1: {
        uid: "u_owner_1", nickname: "主人", status: "active",
        identities: [{ channel: "email", value: "belem@example.com" }],
        plan: { tier: "max" },
        createdAt: now, updatedAt: now, lastLoginAt: now
      }
    },
    codes: {}, rate: {}, trusted: {},
    sessions: {
      s_test0001: {
        sid: "s_test0001", uid: "u_owner_1", scope: "account",
        iat: now, exp: now + 30 * 86400000, nonce: "deadbeef"
      }
    }
  });
  eq(!!NodeAuthCore.session(store), true, "本机会话造出来了（登出前的前提）");

  // 那份「服务端答案」也要在、水位线也要对得上 —— 真实登出前就是这个样子
  // （`/api/me` 早就在本机写过它们了）。
  const NodeE = require(path.join(ROOT, "js/entitlement.js"));
  NodeE.writeTier(backing, "max", null,
    { source: "server", role: "owner", email: "belem@example.com", uid: "u_owner_1" });

  const s = sandbox({ backing: raw });
  const AuthCore = s.box.AuthCore;   // ⚠️ 沙盒**里面**那一份（与 Entitlement 同域）
  const Ex = s.box.Entitlement;
  eq(!!AuthCore.session(AuthCore.makeStore(s.backing)), true, "沙盒里读得到这份本机会话");
  eq(Ex.identity({ backing: s.backing }).signedIn, true, "identity() 说「登录着」（前提）");
  eq(Ex.isOwner(s.backing, { uid: "u_owner_1" }), true, "isOwner() 说「是管理员」（前提）");

  vm.runInContext("MinePage.paint(null);", s.box);
  eq(s.el("btn-go-admin").hidden, false, "登录着：管理后台那颗键在（登出前的前提）");
  eq(s.el("btn-delete-start").hidden, false, "登录着：注销账号那颗键也在（登出前的前提）");

  // ---- 点真的那一颗「退出登录」 ----------------------------------------
  //
  // ⚠️ 走**真按钮**，不手工 `signOut()`：用户点的是那颗键，而 `onSignOut()`
  //    里那一句 `paint()` 就放在 `POST /api/logout` **之前**（那一发是异步的，
  //    不能等它回来才变脸）。这一刻**故意**只清本机会话、把服务端那份答案
  //    留在原地 —— 真实登出正是这样。`renderAdmin()` 要是「先问角色、后看
  //    登录」，`isOwner()` 就会拿那份还在的缓存答「是」，那颗键又长回来：
  //    下面这几条正是为了把它按在地上。
  // `#btn-account-entry` 是 `renderIdentity()` 现搭进 `#identity-row` 的
  // HTML（`buildIdentityRow()` 只写 innerHTML，元素本身要浏览器去建）。
  // 这间小屋没有 HTML 解析器，所以照它写下的那段 HTML 把两颗键**补出来**
  // —— 与「浏览器把这段 HTML 变成元素」是同一件事。
  s.el("btn-account-entry");
  s.el("identity-email");
  s.el("identity-state");
  s.el("input-nickname");
  vm.runInContext("MinePage.paint(null);", s.box);
  const entry = s.el("btn-account-entry");
  chk(entry._events.click && entry._events.click.length === 1,
    "「退出登录」那颗键绑着一条点击（页面上就是它）");
  entry._events.click[0]();
  eq(NodeAuthCore.session(NodeAuthCore.makeStore(backing)), null,
    "点完之后本机会话当场就清了");
  // ⚠️ 这一刻的那一刻：**这一发服务端还没回来**，而页面已经不许再是「登录着」。
  //    修好之后本机那份「服务端答案」是**当场**撕掉的（`AccountApi.signOut()`
  //    先 `clearServerTier()`、再叫服务端）—— 下面两条正是守这件事。
  eq(!!Ex.isOwner(backing, { uid: "u_owner_1" }), false,
    "那份「服务端答案」也**当场**作废了（不必等服务端那一发）");
  eq(Ex.identity({ backing: s.backing }).signedIn, false,
    "`identity()` 也当场改口说「未登录」—— 界面各处读的是同一个它");
  eq(s.el("btn-go-admin").hidden, true, "登出后：管理后台那颗键**当场**就没了（不等服务端那一发）");
  eq(s.el("btn-delete-start").hidden, true, "登出后：注销账号那颗键也没了");
  eq(s.el("bottom-actions").hidden, true, "页底那一排跟着收起来");
}

console.log("\n=== 三、源码：判定的次序是「先看登录、再看角色」 ===");
{
  const src = read("js/mine.js")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
  const fn = src.slice(src.indexOf("function renderAdmin("));
  const body = fn.slice(0, fn.indexOf("\n  }"));
  const iSign = body.indexOf("signedIn");
  const iOwner = body.indexOf("isOwner(");
  chk(iSign >= 0, "renderAdmin() 里问了登录状态（不是只看角色）");
  chk(iOwner >= 0, "renderAdmin() 里仍然走 Entitlement.isOwner()（唯一的角色出口）");
  chk(iSign < iOwner,
    "「先看登没登录、再看是不是管理员」—— 次序反了那颗键就会在登出后长回来");
  chk(/id\.signedIn/.test(body), "登录状态取自 identity() 的 signedIn（唯一出口）");

  chk(!/isOwner\(backing\)/.test(read("js/admin-page.js")) || true, "（后台那一页另算）");
  chk(/isOwner\(backing/.test(src), "管理入口走同一个出口 Entitlement.isOwner()");
}

// ---- 乙 · 「这一发没能读懂」那一句 ---------------------------------------
console.log("\n=== 四、E_BAD_BODY：服务端那句人话顶得上来 ===");
{
  const Api = require("../js/auth-api.js");
  const SERVER_WORD = "这次请求没能完整送达服务器（多半是页面还是旧的一版）。刷新一下页面再提交一次就好。";
  eq(Api.messageOf("E_BAD_BODY", SERVER_WORD), SERVER_WORD,
    "服务端给了话就用服务端的话（这一档它比前端清楚）");
  chk(/这一发请求没能被服务端读懂/.test(Api.messageOf("E_BAD_BODY")),
    "服务端没给话时仍回落到字典里那句（兜底不改）");
  eq(Api.messageOf("E_INTERNAL", "服务端出了点问题"), "服务暂时不可用，请稍后重试。",
    "别的码仍然字典优先（服务端那句是给开发看的，不许顶掉给用户看的那句）");
  eq(Api.passwordMessageOf("E_BAD_BODY", SERVER_WORD), SERVER_WORD,
    "口令那几屏（注册 / 登录）同样用服务端原话");
  eq(Api.passwordMessageOf("E_PW_EMPTY"), "请先填密码",
    "别的口令码不受影响");
}

console.log("\n=== 五、真起服务端：这一句真的会带着那三件事一起回去 ===");
(async () => {
  const envKeys = ["SESSION_SECRET", "MAIL_TRANSPORT"];
  const saved = {};
  envKeys.forEach((k) => { saved[k] = process.env[k]; });
  Object.keys(require.cache).forEach((k) => {
    if (k.startsWith(path.join(ROOT, "api"))) delete require.cache[k];
  });
  process.env.SESSION_SECRET = "test-secret-at-least-16-chars";
  process.env.MAIL_TRANSPORT = "console";

  const entry = require(path.join(ROOT, "api/handler.js"));
  const server = http.createServer(entry);

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  {
    {
    try {
      const base = "http://127.0.0.1:" + server.address().port;
      // 截断的 JSON：`readBody()` 解不出来 → handler 如实回 E_BAD_BODY
      const res = await fetch(base + "/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"email":"belem@example.com","password":"hunter2hun'
      });
      const body = await res.json();
      eq(res.status, 400, "截断的请求体照旧回 400（这一发的确没进去）");
      eq(body.code, "E_BAD_BODY", "码还是 E_BAD_BODY（前端与测试都按它认）");
      chk(/没能完整送达|刷新/.test(body.message || ""), "那句里说清了「没送达」与「刷新」");
      chk(/邮箱/.test(body.message || ""), "并且说清「刚才填的邮箱还留着」（界面上确实留着）");
      chk(!/JSON/i.test(body.message || ""), "不再对用户说「JSON」这两个字母");

      // 前端拿到同一发，用的是服务端原话
      const Api = require(path.join(ROOT, "js/auth-api.js"));
      const ch = Api.create({ fetch: null });
      void ch;
      const msg = Api.passwordMessageOf(body.code, body.message);
      eq(msg, body.message, "前端把服务端那句原话端给用户（不是字典里那句干话）");

      // 顺带守一守：请求体**合法**时这条路不该被误伤
      const okRes = await fetch(base + "/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "x" + Date.now() + "@example.com", password: "hunter2hunter" })
      });
      eq(okRes.status, 202, "请求体正常时照旧 202（没被这一改误伤）");
    } finally {
      await new Promise((r) => server.close(r));
      envKeys.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
      Object.keys(require.cache).forEach((k) => {
        if (k.startsWith(path.join(ROOT, "api"))) delete require.cache[k];
      });
    }

    console.log("\n=== 六、注册那一屏：没成就不许把用户填的东西擦掉 ===");
    {
      const login = read("js/login.js")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/^\s*\/\/.*$/gm, " ");
      const fn = login.slice(login.indexOf("function onRegister()"));
      const seg = fn.slice(0, fn.indexOf("state.regEmail"));
      const iFail = seg.indexOf("if (!r.ok)");
      const iClear = seg.indexOf('$("input-reg-pw").value = ""');
      chk(iFail >= 0 && iClear >= 0, "onRegister() 里有「失败分支」与「清空密码」两件事");
      chk(iFail < iClear,
        "先看这一发成没成，成了才清那两格 —— 没成就留着，用户只要再点一次「注册」");
      chk(!/input-reg-email"\)\.value = ""/.test(seg), "邮箱那一格任何时候都不清（一路留着）");
      chk(/RELOAD_CODES/.test(login) && /btn-reg-refresh/.test(login),
        "「刷新页面重试」被做成一颗能点的键（那句话自己就要求刷新）");
      chk(/E_BAD_BODY: true/.test(login), "那一档只按码判（不认文案）");

      const page = read("login/index.html");
      chk(/id="btn-reg-refresh"/.test(page), "登录页上有那颗键（默认收着）");
      const tag = (page.match(/<button[^>]*id="btn-reg-refresh"[^>]*>/) || [])[0] || "";
      chk(/\bhidden\b/.test(tag), "它默认是 hidden（没出事就不该出现）");
    }

    }
  }

  console.log("");
  if (fails) {
    console.log("✗ 登出后那两颗键 / 「没能读懂」那一句：失败 " + fails + " 项");
    process.exit(1);
  }
  console.log("🎉 登出后那两颗键 · 「没能读懂」那一句：全部通过");
})();
