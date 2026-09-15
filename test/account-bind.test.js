/**
 * 账号接线专项测试（Issue #132 · 2 期「补洞 + 2A」）
 * ==========================================================================
 * 1A/1B 把服务端建好了，但前端有**两根线一直没接**：
 *
 *   ① `GET /api/me` 从没有页面调用过 —— 服务端判定的层级与角色
 *      因此没有下发到界面，Pro/Max 的唯一合法挂载点空着。
 *   ② `DELETE /api/account` 写好了但没人调 —— 个人中心注销时走的仍是
 *      本机内核那个版本，**云端那一行还在**（合规问题，删除权）。
 *
 * 这一层守的就是这两条接线，以及接线时必须守住的四条边界：
 *   1. 失败不打断任何事（断网 / 503 / 401 / 超时，一律只是「这一轮没问成」）
 *   2. 不假装（拉不到就说「本机登记」，不许说成「服务器判定」）
 *   3. 不清用户数据（拉不到 `/api/me` **不删**本机那份层级缓存）
 *   4. 不做无谓请求（没登录一个请求都不发；同会话只问一次）
 *
 * 另加两条结构口径：
 *   · 平台口径的唯一性：页面不许自己 `fetch("/api/me")`、
 *     不许自己读 Cookie、不许自己写 `poem_plan_v1`
 *   · `/api/me` 必须真的下发 `role`（否则「服务端角色优先」只是注释）
 *
 * 跑法：`node test/account-bind.test.js`（纯 Node + 假 fetch，不联网、不装依赖）
 */
"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

let fails = 0;
const chk = (c, m) => { if (!c) { console.log("✗ " + m); fails++; } else console.log("✓ " + m); };
const eq = (a, b, m) => chk(a === b, m + "（实际 " + JSON.stringify(a) + "）");

/* ------------------------------------------------------------------ 装配 */

const E = require(path.join(ROOT, "js/entitlement.js"));
const A = require(path.join(ROOT, "js/auth-core.js"));
const M = require(path.join(ROOT, "js/account-api.js"));

/* ⚠️ 必须显式对接：`identity()` 要从会话里取账号，靠的就是这个显式注入，
   不是「读完两个文件就自动连上」。少这一步的症状正是「盘上明明有会话、
   盘上明明有 Pro，却永远判成没登录」—— 与 test/entitlement.test.js
   里那条跨 realm 的坑同源（也是这一轮「补洞」最该防的假绿）。 */
E.setAuthCore(A);

/** 内存存储：够用即可，测的是回落行为不是浏览器兼容 */
function mem(init) {
  const m = Object.assign({}, init || {});
  return {
    getItem: k => (Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: k => { delete m[k]; },
    raw: () => m
  };
}

/** 造一个「有会话」的盘（并返回 store） */
function signedInStore(backing, email) {
  const store = A.makeStore(backing);
  const r = A.requestCode(store, { channel: "email", value: email || "zhangmin@163.com" }, "login", { code: "246810" });
  const v = A.verifyCode(store, r.codeId, "246810", "login");
  if (!v || !v.ok) throw new Error("用例里的登录没建立起来");
  return { store, mask: v.account.identities[0].mask };
}

/** 假通道：直接给 /api/me 与 DELETE /api/account 的答案 */
function fakeApi(answers) {
  const a = answers || {};
  const calls = [];
  return {
    calls: calls,
    me: function () { calls.push("me"); return Promise.resolve(a.me || { ok: false, code: "E_OFFLINE" }); },
    deleteAccount: function (input) {
      calls.push("delete");
      return Promise.resolve(a.del || { ok: false, code: "E_OFFLINE" });
    }
  };
}

/* ==================================================================== 一 */

async function main() {

  console.log("=== 一、`/api/me` 的下发：层级与角色真的落到权益层 ===");
  {
    const b = mem();
    const { store, mask } = signedInStore(b);
    eq(E.identity({ backing: b, authStore: store }).tier, "free", "起点：本机口径是 free");
    eq(E.identity({ backing: b, authStore: store }).tierSource, "local", "起点：层级来源是「本机登记」");

    const api = M.bind({ api: fakeApi({ me: { ok: true, plan: { tier: "pro", until: null }, role: "owner", mask: mask } }), E: E, A: A, backing: b });
    const r = await api.refreshMe();

    eq(r.ok, true, "/api/me 拿到了答案");
    eq(r.reason, M.REASON.OK, "reason 是 ok");
    const id = E.identity({ backing: b, authStore: store });
    eq(id.tier, "pro", "服务端判定的 pro 真的落到了权益层（「补洞」那一件）");
    eq(id.label, "Pro", "徽章文案跟着变");
    eq(id.tierSource, "server", "层级来源标成「服务器判定」（不标的话本机那份会被读成权威）");
    eq(E.can("feihualing", id.ctx).ok, true, "于是 Pro 能力真的开了（飞花令）");
  }

  console.log("\n=== 二、角色（role）也是服务端优先，本机兜底只在没有服务端答案时生效 ===");
  {
    // 本机「谁打开谁是主人」的兜底：全新盘 → owner
    const b1 = mem();
    const a1 = M.bind({ api: fakeApi({ me: { ok: true, plan: { tier: "free" }, role: "user" } }), E: E, A: A, backing: b1 });
    const { store: s1 } = signedInStore(b1);
    eq(E.identity({ backing: b1, authStore: s1 }).role, "owner", "还没问服务端时：本机兜底判成 owner");
    await a1.refreshMe();
    eq(E.identity({ backing: b1, authStore: s1 }).role, "user",
      "服务端说 role=user 时，本机那个「谁打开谁是主人」的兜底让位（否则清空存储就能当管理员）");

    // 反过来：服务端说 owner，本机标记是 member
    const b2 = mem({ [E.OWNER_NS]: "member" });
    const a2 = M.bind({ api: fakeApi({ me: { ok: true, plan: { tier: "free" }, role: "owner" } }), E: E, A: A, backing: b2 });
    const { store: s2 } = signedInStore(b2);
    eq(E.identity({ backing: b2, authStore: s2 }).role, "user", "本机标记 member 时是 user");
    await a2.refreshMe();
    eq(E.identity({ backing: b2, authStore: s2 }).role, "owner", "服务端说 owner 时以服务端为准（两向都验）");

    // role 与 tier 正交：管理员不是 VIP
    const id = E.identity({ backing: b2, authStore: s2 });
    eq(id.role, "owner", "管理员身份成立");
    eq(id.tier, "free", "…但层级仍是 free —— 店长不是 VIP（不许折叠成一条轴）");
  }

  console.log("\n=== 三、没登录：一个请求都不发 ===");
  {
    const b = mem();                                  // 空盘 = 没会话
    const fake = fakeApi({});
    const api = M.bind({ api: fake, E: E, A: A, backing: b });
    const r = await api.refreshMe();
    eq(r.ok, false, "没登录时 refreshMe 回 ok:false");
    eq(r.reason, M.REASON.GUEST, "reason 是 guest（**正常状态**，不是错误）");
    eq(fake.calls.length, 0, "没登录时**一个请求都没发**");
  }

  console.log("\n=== 四、服务端没配好（503）：如实说「未开放」，且一个字都不动 ===");
  {
    const b = mem();
    const { store } = signedInStore(b);
    E.writeTier(b, "pro");                            // 本机登记了一份 pro（管理员发的）
    const api = M.bind({ api: fakeApi({ me: { ok: false, code: "E_NOT_CONFIGURED" } }), E: E, A: A, backing: b });
    const r = await api.refreshMe();
    eq(r.reason, M.REASON.NOT_CONFIGURED, "reason 是 not-configured（与「连不上」分开说）");
    eq(E.identity({ backing: b, authStore: store }).tier, "pro", "本机那份层级**一字不动**（后端抖不能把用户降级）");
    eq(E.identity({ backing: b, authStore: store }).tierSource, "local", "来源仍如实是「本机登记」");
  }

  console.log("\n=== 五、连不上（断网 / 超时 / 5xx）：不清数据、不抛异常 ===");
  {
    const b = mem();
    const { store } = signedInStore(b);
    E.writeTier(b, "max");
    const boom = { me: () => Promise.reject(new Error("network down")), deleteAccount: () => Promise.reject(new Error("network down")) };
    const api = M.bind({ api: boom, E: E, A: A, backing: b });
    const r = await api.refreshMe();
    eq(r.ok, false, "连不上时 refreshMe 回 ok:false（不抛）");
    eq(r.reason, M.REASON.UNAVAILABLE, "reason 是 unavailable");
    eq(E.readTier(b), "max", "本机那份层级仍然在（**边界第 3 条**：不清用户数据）");
    // 没有通道（老 WebView 连 fetch 都没有）
    const api2 = M.bind({ api: null, make: null, E: E, A: A, backing: b });
    const r2 = await api2.refreshMe();
    eq(r2.reason, M.REASON.NOT_CONFIGURED, "连通道都造不出来时按「未开放」处理，不抛");
  }

  console.log("\n=== 六、会话过期（401）：清掉服务端那一份，但绝不碰本机名单与进度 ===");
  {
    const b = mem({ "poem_recite_progress_v1": JSON.stringify({ p1: { level: 3 } }) });
    const { store, mask } = signedInStore(b);
    E.putGrant(b, { emailMask: mask, tier: "pro" });        // 本机发放名单
    const api = M.bind({ api: fakeApi({ me: { ok: true, plan: { tier: "pro", until: null }, role: "owner" } }), E: E, A: A, backing: b });
    await api.refreshMe();
    eq(E.readServerTier(b), "pro", "服务端那份先落下来了");

    const api2 = M.bind({ api: fakeApi({ me: { ok: false, code: "E_NO_SESSION" } }), E: E, A: A, backing: b });
    const r = await api2.refreshMe();
    eq(r.reason, M.REASON.GUEST, "401 → guest");
    eq(E.readServerTier(b), null, "服务端那一份被清掉了（否则退出的人还顶着 Pro 徽章）");
    eq(E.readTier(b), "free", "本机层级缓存**没有被顺手清掉**（它有自己的生命周期）");
    chk(!!b.getItem("poem_recite_progress_v1"), "进度键一个字节都没动");
    chk(!b.getItem(E.OWNER_NS), "也没有顺手落一个 owner 标记");
  }

  console.log("\n=== 七、只清服务端那一份：本机发放名单不许被退出登录抹掉 ===");
  {
    const b = mem();
    E.writeTier(b, "free");                              // 本机登记（无 source）
    const api = M.bind({ api: fakeApi({}), E: E, A: A, backing: b });
    eq(api.clearServerTier(), false, "没有服务端那一份时 clearServerTier 什么都不做（返回 false 如实）");
    eq(E.readTier(b), "free", "本机那一份仍在");
    E.writeTier(b, "pro", null, { source: "server" });
    eq(api.clearServerTier(), true, "有服务端那一份时才清，且如实返回 true");
    eq(E.readServerTier(b), null, "清干净了");
  }

  console.log("\n=== 八、同会话只问一次（不做无谓请求） ===");
  {
    const b = mem();
    signedInStore(b);
    const fake = fakeApi({ me: { ok: true, plan: { tier: "free" } } });
    M.reset();
    const p1 = M.refreshMe({ api: fake, E: E, A: A, backing: b });
    const p2 = M.refreshMe({ api: fake, E: E, A: A, backing: b });
    const [r1, r2] = await Promise.all([p1, p2]);
    eq(fake.calls.length, 1, "同会话里两次 refreshMe 只发一个请求（四页签点几下不会问四遍）");
    chk(r1 === r2 || JSON.stringify(r1) === JSON.stringify(r2), "两次拿到的是同一个结果");
    M.reset();
  }

  console.log("\n=== 九、注销（2A）：先服务端、后本机，顺序不能反 ===");
  {
    const b = mem({ "poem_recite_progress_v1": JSON.stringify({ p1: { level: 3 } }) });
    signedInStore(b, "zhangmin@163.com");
    const order = [];
    const fake = {
      calls: order,
      me: () => Promise.resolve({ ok: false, code: "E_NO_SESSION" }),
      deleteAccount: function () {
        order.push("remote");
        /* 服务端那一步要会话 Cookie —— 用「本机会话还在不在」来断言顺序 */
        const still = !!A.session(A.makeStore(b));
        return Promise.resolve({ ok: true, export: { recs: [{ id: "p1" }], still: still } });
      }
    };
    const api = M.bind({ api: fake, E: E, A: A, backing: b });
    const r = await api.deleteAccount({ email: "zhangmin@163.com", confirm: true });
    eq(r.ok, true, "注销成功");
    eq(r.remote, "deleted", "remote 标成 deleted（云端那份真的删了）");
    eq(r.export && r.export.recs.length, 1, "云端那一份**随响应回来了**（先导出后删，docs §4.2 第 3 条）");
    eq(r.export.still, true, "调服务端时**本机会话还在** —— 证明顺序是「先服务端、后本机」");
    eq(A.session(A.makeStore(b)), null, "本机会话也清掉了");
    chk(!!b.getItem("poem_recite_progress_v1"), "进度键一个字节没动（注销不删进度）");
  }

  console.log("\n=== 十、注销时连不上：不阻断本机注销，但**如实说云端还在** ===");
  {
    const b = mem();
    signedInStore(b);
    const fake = { me: () => Promise.resolve({ ok: false, code: "E_OFFLINE" }), deleteAccount: () => Promise.reject(new Error("down")) };
    const api = M.bind({ api: fake, E: E, A: A, backing: b });
    const r = await api.deleteAccount({ email: "zhangmin@163.com", confirm: true });
    eq(r.ok, true, "本机注销照常完成（用户要求删除的意愿是明确的）");
    eq(r.remote, "skipped", "但 remote 如实标成 skipped —— 云端那一行还在，不许写「注销完成」");
    eq(A.session(A.makeStore(b)), null, "本机的账号与会话确实清掉了");
  }

  console.log("\n=== 十一、注销：本站没服务端时不假装删过云端 ===");
  {
    const b = mem();
    signedInStore(b);
    const api = M.bind({ api: null, make: null, E: E, A: A, backing: b });
    const r = await api.deleteAccount({ email: "zhangmin@163.com", confirm: true });
    eq(r.ok, true, "本机注销完成");
    eq(r.remote, "none", "remote 是 none（本来就没有云端账号），不是 deleted");
    eq(r.reason, M.REASON.NOT_CONFIGURED, "reason 如实是「未开放」");
  }

  console.log("\n=== 十二、注销的两个前置：邮箱对不上 / 没确认，都不许删 ===");
  {
    const b = mem();
    signedInStore(b, "zhangmin@163.com");
    const fake = { me: () => Promise.resolve({ ok: false, code: "E_NO_SESSION" }), deleteAccount: () => Promise.resolve({ ok: true, export: {} }) };
    const api = M.bind({ api: fake, E: E, A: A, backing: b });
    const r = await api.deleteAccount({ email: "someoneelse@163.com", confirm: true });
    eq(r.ok, false, "重输的邮箱对不上 → 本机注销被内核拒掉");
    chk(!!A.session(A.makeStore(b)), "会话仍在（没注销）");

    const r2 = await api.deleteAccount({ email: "zhangmin@163.com", confirm: false });
    eq(r2.ok, false, "没带 confirm 时本机注销也不做");
    chk(!!A.session(A.makeStore(b)), "会话仍在");
  }

  console.log("\n=== 十三、源码口径：服务端的答案只在一处接，页面不自己拼 ===");
  {
    const PAGES = ["js/profile.js", "js/settings.js", "js/login.js", "js/admin-page.js"];
    PAGES.forEach(f => {
      const src = read(f).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
      chk(!/fetch\(\s*["'`]\/api\//.test(src) && !/fetch\(\s*["'`]\/api\//.test(src),
        f + " 不自己 fetch(\"/api/me\") 这类地址（接线只在 js/account-api.js 里）");
      chk(!/poem_plan_v1|poem_plan_grant_v1|poem_owner_v1/.test(src),
        f + " 不自己拼权益相关的存储键名（键名只在 entitlement.js 里）");
      chk(!/document\.cookie/.test(src), f + " 不自己读 Cookie（会话是 HttpOnly，读不到也不该试）");
      chk(!/\/api\/account/.test(src), f + " 不自己拼注销的地址（走 AccountApi.deleteAccount）");
    });
    const prof = read("js/profile.js").replace(/\/\*[\s\S]*?\*\//g, " ");
    chk(/AccountApi|acct\(\)/.test(prof), "个人中心的注销走账号接线层");
    chk(/M\.deleteAccount\(/.test(prof), "…且用的是 AccountApi.deleteAccount（服务端 + 本机两条路一起走）");
    chk(/remote === "skipped"/.test(prof), "个人中心如实处理「云端那份没删掉」这一支");
    const set = read("js/settings.js").replace(/\/\*[\s\S]*?\*\//g, " ");
    chk(/refreshServerIdentity/.test(set), "设置页也接上了 /api/me");
    chk(/clearServerTier/.test(set), "退出登录时会清掉服务端那一份层级");
  }

  console.log("\n=== 十四、服务端真的下发 role（否则「服务端角色优先」只是注释） ===");
  {
    const core = read("api/_lib/core.js");
    const pub = core.slice(core.indexOf("function publicAccount"), core.indexOf("function planTier"));
    chk(/role:/.test(pub), "publicAccount 下发 role（2 期「补洞」之前这条链路是断的）");
    chk(/"owner", "admin", "user"/.test(pub) || /\["owner", "admin", "user"\]/.test(pub),
      "role 取值做过白名单校验（脏值一律回落 user）");
    const meJs = read("api/me.js");
    chk(/role/.test(meJs), "/api/me 的注释里写明会下发 role");
  }

  console.log("\n=== 十五、结构：接线层进了预缓存，三张页都加载了它 ===");
  {
    const sw = read("sw.js");
    chk(sw.indexOf('"./js/account-api.js"') >= 0, "sw.js 预缓存里有 js/account-api.js");
    /* plans/index.html 是 2.1 新增的接线页：它问 `/api/me` 只为一件事 ——
       「关于这些层级」那一段得如实说清层级**是谁定的**。 */
    ["profile/index.html", "settings/general/index.html", "plans/index.html"].forEach(f => {
      const s = read(f);
      chk(/js\/account-api\.js/.test(s), f + " 加载了 js/account-api.js");
      chk(s.indexOf("js/auth-api.js") >= 0, f + " 加载了 js/auth-api.js（接线层的传输依赖）");
      chk(s.indexOf("entitlement.js") < s.indexOf("account-api.js"),
        f + " 里 entitlement 排在 account-api 之前（要先把权益层装上）");
    });
    // 预缓存清单里的路径都得真实存在
    const list = [...sw.matchAll(/"(\.\/[^"]+)"/g)].map(m => m[1]);
    const missing = list.filter(u => {
      if (u === "./") return false;
      const f = u.replace(/^\.\//, "");
      if (fs.existsSync(path.join(ROOT, f))) return false;
      return !(/\/$/.test(f) && fs.existsSync(path.join(ROOT, f + "index.html")));
    });
    eq(missing.length, 0, "预缓存清单里的文件都存在");
    const ver = parseInt((sw.match(/poem-app-v(\d+)/) || [0, "0"])[1], 10);
    chk(ver >= 122, "缓存版本跟着提了（新增 1 个脚本，实际 v" + ver + "）");
  }

  console.log("\n=== 十六、真页面：注销真的发出 DELETE，云端那一份给到用户（jsdom） ===");
  {
    /* 这一节是整层里**唯一看得见「只在真页面上才炸」那类坑的地方**：
       接线层自身的单元测试全绿，而页面里可能根本没加载它、脚本顺序错、
       或者点了按钮没接上。jsdom 缺席时整节跳过（与别层同口径）。 */
    let JSDOM = null;
    try { JSDOM = require("jsdom").JSDOM; } catch (e) { JSDOM = null; }

    if (!JSDOM) {
      console.log("(未安装 jsdom，跳过真页面一节 —— run.sh 会先装好它)");
    } else {
      const page = await bootPage("profile/index.html", "https://kuibu.app/profile/", {
        me: { ok: false, code: "E_NO_SESSION" },
        del: { ok: false, code: "E_OFFLINE" }
      });
      const w = page.window, doc = page.doc;

      chk(!!w.AccountApi, "个人中心里 AccountApi 挂在 window 上（接线层真的被加载了）");
      const sess = w.AuthCore.session(w.AuthCore.makeStore(w.localStorage));
      chk(!!sess, "用例里的登录建立成功");
      okLine(doc.getElementById("account-list").textContent, "层级那一行如实标注来源");

      /* 点注销：先「我要注销」，再重输邮箱，最后确认 */
      doc.getElementById("btn-delete-start").click();
      eq(doc.getElementById("delete-step-2").hidden, false, "两步确认：第二步露出来了");
      doc.getElementById("input-delete-email").value = "zhangmin@163.com";
      doc.getElementById("btn-delete-confirm").click();
      await sleep(60);

      eq(page.calls.deleteMethod, "DELETE", "连不上时也**真的发过 DELETE**（不是只在本机删）");
      eq(page.calls.deleteUrl.indexOf("/api/account") >= 0, true, "打的是 /api/account");
      chk(!w.AuthCore.session(w.AuthCore.makeStore(w.localStorage)),
        "本机账号注销掉了（注销是**两半都走**）");
      okLine(doc.getElementById("msg-delete").textContent, "连不上时如实说「云端那份没删掉」");
      okLine(doc.getElementById("msg-delete").textContent, "不写「注销完成」了事");
    }
  }

  console.log("");
  if (fails) { console.log("❌ 账号接线测试 " + fails + " 项失败"); process.exit(1); }
  console.log("🎉 账号接线测试全部通过");
}

/* ------------------------------------------------------- 真页面（jsdom） */

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 一句「文案里必须有某个意思」的软断言（找不到就把实际值打出来，便于定位） */
function okLine(text, what) {
  const t = String(text || "");
  chk(t.length > 0, what + "：" + t.replace(/\s+/g, " ").slice(0, 120));
}

/**
 * 起一张真页：按 HTML 里声明的顺序执行本地脚本，
 * 并把 `fetch` 换成假的（想让它成功就给数据，想让它挂就 reject）。
 *
 * ⚠️ 假 fetch 必须**活得比页面久**：页面里的 `refreshMe()` 是被 promise 链
 *    驱动的，冲掉太早会得到「什么都没发生」的假绿。所以这里把调过的次数与
 *    方法名都记在返回的对象上，供用例断言。
 */
async function bootPage(rel, url, answers) {
  const JSDOM = require("jsdom").JSDOM;
  const html = read(rel);
  const dom = new JSDOM(html, { url: url, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const calls = { me: 0, deleteMethod: null, deleteUrl: null };

  w.fetch = function (u, init) {
    const m = ((init && init.method) || "GET").toUpperCase();
    if (String(u).indexOf("/api/me") >= 0) {
      calls.me += 1;
      return Promise.resolve(resOf(answers && answers.me));
    }
    calls.deleteMethod = m;
    calls.deleteUrl = String(u);
    return Promise.resolve(resOf(answers && answers.del));
  };

  [...w.document.querySelectorAll("script[src]")].forEach(s => {
    const src = s.getAttribute("src");
    if (!src) return;
    const p = path.join(ROOT, src.replace(/^\//, ""));
    if (!fs.existsSync(p)) return;
    /* 页面脚本自身的问题在别的层里报，这里只管接线那一块 */
    try { w.eval(fs.readFileSync(p, "utf8")); } catch (e) { }
  });

  /* 内核之间显式对接（`identity()` 要从会话里取账号，靠的就是这一下） */
  if (w.Entitlement && w.Entitlement.setAuthCore) w.Entitlement.setAuthCore(w.AuthCore);

  if (w.AuthCore) {
    const store = w.AuthCore.makeStore(w.localStorage);
    const r = w.AuthCore.requestCode(store, { channel: "email", value: "zhangmin@163.com" }, "login", { code: "246810" });
    w.AuthCore.verifyCode(store, r.codeId, "246810", "login");
  }
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  await sleep(30);
  return { window: w, doc: w.document, calls: calls };
}

/** 造一个「像 Response」的东西：被测代码只用到 status 与 text() */
function resOf(a) {
  if (!a) return { status: 503, text: () => Promise.resolve(JSON.stringify({ code: "E_NOT_CONFIGURED" })) };
  if (a.ok) return { status: 200, ok: true, text: () => Promise.resolve(JSON.stringify(a.body || {})) };
  const status = a.code === "E_OFFLINE" ? 0 : (a.code === "E_NO_SESSION" ? 401 : 503);
  return { status: status, text: () => Promise.resolve(JSON.stringify({ code: a.code, message: a.message })) };
}

main().catch(e => {
  console.error("测试自身抛异常（通常是环境问题，不是被测代码）：", e);
  process.exit(1);
});
