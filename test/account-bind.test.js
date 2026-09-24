"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

let fails = 0;
const chk = (c, m) => { if (!c) { console.log("✗ " + m); fails++; } else console.log("✓ " + m); };
const eq = (a, b, m) => chk(a === b, m + "（实际 " + JSON.stringify(a) + "）");

const E = require(path.join(ROOT, "js/entitlement.js"));
const A = require(path.join(ROOT, "js/auth-core.js"));
const M = require(path.join(ROOT, "js/account-api.js"));

E.setAuthCore(A);

function mem(init) {
  const m = Object.assign({}, init || {});
  return {
    getItem: k => (Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: k => { delete m[k]; },
    raw: () => m
  };
}

function signedInStore(backing, email) {
  const store = A.makeStore(backing);
  const r = A.requestCode(store, { channel: "email", value: email || "zhangmin@163.com" }, "login", { code: "246810" });
  const v = A.verifyCode(store, r.codeId, "246810", "login");
  if (!v || !v.ok) throw new Error("用例里的登录没建立起来");
  return { store, mask: v.account.identities[0].mask };
}

function fakeApi(answers) {
  const a = answers || {};
  const calls = [];
  return {
    calls: calls,
    me: function () { calls.push("me"); return Promise.resolve(a.me || { ok: false, code: "E_OFFLINE" }); },
    deleteAccount: function (input) {
      calls.push("delete");
      return Promise.resolve(a.del || { ok: false, code: "E_OFFLINE" });
    },

    grant: function (input) { calls.push("grant"); return Promise.resolve(a.grant || { ok: false, code: "E_OFFLINE" }); },
    revoke: function (input) { calls.push("revoke"); return Promise.resolve(a.revoke || { ok: false, code: "E_OFFLINE" }); },
    grants: function () { calls.push("grants"); return Promise.resolve(a.grants || { ok: false, code: "E_OFFLINE" }); }
  };
}

function legacyApi(answers) {
  const full = fakeApi(answers);
  return { calls: full.calls, me: full.me, deleteAccount: full.deleteAccount };
}

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

    eq(E.can("quiz.review", id.ctx).ok, true, "于是 Pro 能力真的开了（题库复习）");
    eq(E.can("feihualing", id.ctx).ok, false, "而 Max 的飞花令没跟着开（层级没被抬高）");
  }

  console.log("\n=== 二、角色（role）**只**从服务端来（Issue #276：本机兜底已删）===");
  {

    const b1 = mem();
    const a1 = M.bind({ api: fakeApi({ me: { ok: true, plan: { tier: "free" }, role: "user" } }), E: E, A: A, backing: b1 });
    const { store: s1 } = signedInStore(b1);
    eq(E.identity({ backing: b1, authStore: s1 }).role, "user",
      "还没问服务端时**不是** owner（老口径「谁打开谁是主人」已删）");
    await a1.refreshMe();
    eq(E.identity({ backing: b1, authStore: s1 }).role, "user",
      "服务端说 role=user 时是 user");

    const b2 = mem({ poem_owner_v1: "member" });
    const a2 = M.bind({ api: fakeApi({ me: { ok: true, plan: { tier: "free" }, role: "owner" } }), E: E, A: A, backing: b2 });
    const { store: s2 } = signedInStore(b2);
    eq(E.identity({ backing: b2, authStore: s2 }).role, "user", "本机标记 `poem_owner_v1` 已经没人读了（一律 user）");
    await a2.refreshMe();
    eq(E.identity({ backing: b2, authStore: s2 }).role, "owner", "服务端说 owner 时以服务端为准");

    const id = E.identity({ backing: b2, authStore: s2 });
    eq(id.role, "owner", "管理员身份成立");
    eq(id.tier, "free", "…但层级仍是 free —— 店长不是 VIP（不许折叠成一条轴）");
  }

  console.log("\n=== 三、没登录：一个请求都不发 ===");
  {
    const b = mem();
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
    E.writeTier(b, "pro");
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

    const api2 = M.bind({ api: null, make: null, E: E, A: A, backing: b });
    const r2 = await api2.refreshMe();
    eq(r2.reason, M.REASON.NOT_CONFIGURED, "连通道都造不出来时按「未开放」处理，不抛");
  }

  console.log("\n=== 六、会话过期（401）：清掉服务端那一份，但绝不碰本机名单与进度 ===");
  {
    const b = mem({ "poem_recite_progress_v1": JSON.stringify({ p1: { level: 3 } }) });
    const { store } = signedInStore(b);
    const api = M.bind({ api: fakeApi({ me: { ok: true, plan: { tier: "pro", until: null }, role: "owner" } }), E: E, A: A, backing: b });
    await api.refreshMe();
    eq(E.readServerTier(b), "pro", "服务端那份先落下来了");

    const api2 = M.bind({ api: fakeApi({ me: { ok: false, code: "E_NO_SESSION" } }), E: E, A: A, backing: b });
    const r = await api2.refreshMe();
    eq(r.reason, M.REASON.GUEST, "401 → guest");
    eq(E.readServerTier(b), null, "服务端那一份被清掉了（否则退出的人还顶着 Pro 徽章）");
    eq(E.readTier(b), "free", "本机层级缓存**没有被顺手清掉**（它有自己的生命周期）");
    chk(!!b.getItem("poem_recite_progress_v1"), "进度键一个字节都没动");
    chk(!b.getItem("poem_owner_v1"), "也没有顺手落一个 owner 标记（那个键已经没有了）");
  }

  console.log("\n=== 七、只清服务端那一份：退出登录不碰本机那份缓存 ===");
  {
    const b = mem();
    E.writeTier(b, "free");
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
    // ⚠️ 原先这里还有 js/profile.js：那一页（个人中心）2026-09-20 已删除，
    //    它的注销接线整体留在 js/mine.js 里，所以下面换成 js/mine.js 继续守。
    const PAGES = ["js/mine.js", "js/settings.js", "js/login.js", "js/admin-page.js"];
    PAGES.forEach(f => {
      const src = read(f).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
      chk(!/fetch\(\s*["'`]\/api\//.test(src) && !/fetch\(\s*["'`]\/api\//.test(src),
        f + " 不自己 fetch(\"/api/me\") 这类地址（接线只在 js/account-api.js 里）");
      chk(!/poem_plan_v1|poem_plan_grant_v1|poem_owner_v1/.test(src),
        f + " 不自己拼权益相关的存储键名（键名只在 entitlement.js 里）");
      chk(!/document\.cookie/.test(src), f + " 不自己读 Cookie（会话是 HttpOnly，读不到也不该试）");
      chk(!/\/api\/account/.test(src), f + " 不自己拼注销的地址（走 AccountApi.deleteAccount）");
    });
    const mine = read("js/mine.js").replace(/\/\*[\s\S]*?\*\//g, " ");
    chk(/AccountApi|acct\(\)/.test(mine), "「我的」页的注销走账号接线层");
    chk(/M\.deleteAccount\(/.test(mine), "…且用的是 AccountApi.deleteAccount（服务端 + 本机两条路一起走）");
    chk(/remote === "skipped"/.test(mine), "「我的」页如实处理「云端那份没删掉」这一支");
    const set = read("js/settings.js").replace(/\/\*[\s\S]*?\*\//g, " ");
    // ⚠️ 用户 2026-09-21：账号那一整项从「设置 · 通用」收回「我的」页，
    //    设置侧那次 refreshServerIdentity() 跟着撤掉（它画的正是那一块）。
    chk(!/refreshServerIdentity/.test(set) && !/renderAccount\(/.test(set),
      "设置页不再自己接 /api/me（账号那一块归「我的」页）");
    chk(/clearServerTier/.test(set), "退出登录时仍会清掉服务端那一份层级");
  }

  console.log("\n=== 十四、服务端真的下发 role（否则「服务端角色优先」只是注释） ===");
  {
    const core = read("api/_lib/core.js");
    const pub = core.slice(core.indexOf("function publicAccount"), core.indexOf("function planTier"));
    chk(/role:/.test(pub), "publicAccount 下发 role（2 期「补洞」之前这条链路是断的）");
    chk(/"owner", "admin", "user"/.test(pub) || /\["owner", "admin", "user"\]/.test(pub),
      "role 取值做过白名单校验（脏值一律回落 user）");

    const coreSrc2 = read("api/_lib/core.js");
    const meStart = coreSrc2.indexOf("function me(deps)");
    const meFn = coreSrc2.slice(meStart, coreSrc2.indexOf("\n}\n", meStart) + 3);
    chk(/publicAccount\(cfg, acc\)/.test(meFn),
      "/api/me 的响应体由 publicAccount() 产出 —— role 因此随 /api/me 一起下发");
  }

  console.log("\n=== 十五、结构：接线层进了预缓存，三张页都加载了它 ===");
  {
    const sw = read("sw.js");
    chk(sw.indexOf('"./js/account-api.js"') >= 0, "sw.js 预缓存里有 js/account-api.js");

    const at = (src, file) => {
      const m = src.match(new RegExp('<script src="\\/?' + file.replace(/[./]/g, "\\$&") + '"><\\/script>'));
      return m ? src.indexOf(m[0]) : -1;
    };
    // ⚠️ 「设置 · 通用」不再加载接线层：那一页上已经没有账号 / 同步的挂载点，
    //    拖进来只会白跑一遍（真正接的那两张页在下面）。
    ["mine/index.html", "plans/index.html"].forEach(f => {
      const s = read(f);
      const aApi = at(s, "js/account-api.js");
      const authApi = at(s, "js/auth-api.js");
      const ent = at(s, "js/entitlement.js");
      chk(aApi >= 0, f + " 加载了 js/account-api.js");
      chk(authApi >= 0, f + " 加载了 js/auth-api.js（接线层的传输依赖）");
      chk(ent >= 0 && ent < aApi,
        f + " 里 entitlement 排在 account-api 之前（要先把权益层装上）");
    });

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

    let JSDOM = null;
    try { JSDOM = require("jsdom").JSDOM; } catch (e) { JSDOM = null; }

    if (!JSDOM) {
      console.log("(未安装 jsdom，跳过真页面一节 —— run.sh 会先装好它)");
    } else {
      const page = await bootPage("mine/index.html", "https://kuibu.app/mine/", {
        me: { ok: false, code: "E_NO_SESSION" },
        del: { ok: false, code: "E_OFFLINE" }
      });
      const w = page.window, doc = page.doc;

      chk(!!w.AccountApi, "「我的」页里 AccountApi 挂在 window 上（接线层真的被加载了）");
      const sess = w.AuthCore.session(w.AuthCore.makeStore(w.localStorage));
      chk(!!sess, "用例里的登录建立成功");
      okLine(doc.getElementById("account-list").textContent, "层级那一行如实标注来源");

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

  console.log("\n=== 十七、2.2 权威发放：只送服务端、四种失败各说各的话、绝不拿本机名单顶替 ===");
  {

    {
      const b = mem();
      const fake = fakeApi({});
      const api = M.bind({ api: fake, E: E, A: A, backing: b });
      const r = await api.adminGrant({ emailMask: "a***@qq.com", tier: "pro" });
      eq(r.ok, false, "没登录时发放回 ok:false");
      eq(r.reason, M.REASON.GUEST, "reason 是 guest");
      eq(fake.calls.length, 0, "没登录时**一个请求都不发**");
    }

    {
      const b = mem();
      const { store, mask } = signedInStore(b);
      const fake = fakeApi({ grant: { ok: true, matched: 1, changed: true, emailMask: mask, tier: "pro", until: null } });
      const api = M.bind({ api: fake, E: E, A: A, backing: b });
      const r = await api.adminGrant({ emailMask: mask, tier: "pro" });
      eq(r.ok, true, "发放成功");
      eq(r.matched, 1, "matched 原样带回");
      eq(fake.calls.join(","), "grant", "只调了 grant 一条");
    }

    {
      const b = mem();
      signedInStore(b);
      const fake = fakeApi({ grant: { ok: true, matched: 0, changed: false, emailMask: "n***@qq.com", tier: "pro" } });
      const api = M.bind({ api: fake, E: E, A: A, backing: b });
      const r = await api.adminGrant({ emailMask: "n***@qq.com", tier: "pro" });
      eq(r.ok, true, "命中 0 条**不是失败**：ok 仍是 true");
      eq(r.changed, false, "changed 为 false —— 界面上据此说「对方还没登录过」，不说「发放失败」");
    }

    {
      const b = mem();
      signedInStore(b);
      const fake = fakeApi({ grant: { ok: false, code: "E_FORBIDDEN", message: "这一条只对管理员开放" } });
      const api = M.bind({ api: fake, E: E, A: A, backing: b });
      const r = await api.adminGrant({ emailMask: "a***@qq.com", tier: "pro" });
      eq(r.ok, false, "403 时 ok:false");
      eq(r.reason, M.REASON.OK, "**reason 不是 unavailable**（403 是「确实没权限」，说成「连不上」会让人一直重试）");
      eq(r.code, "E_FORBIDDEN", "错误码原样带上去");
      eq(r.message, "这一条只对管理员开放", "文案直接用服务端那句，不自己改写一份");
    }

    {
      const b = mem();
      signedInStore(b);
      E.writeTier(b, "free", null, { source: "server", role: "user" });
      const boom = { me: () => Promise.reject(new Error("down")), deleteAccount: () => Promise.reject(new Error("down")),
        grant: () => Promise.reject(new Error("down")), revoke: () => Promise.reject(new Error("down")), grants: () => Promise.reject(new Error("down")) };
      const api = M.bind({ api: boom, E: E, A: A, backing: b });
      const r = await api.adminGrant({ emailMask: "a***@qq.com", tier: "max" });
      eq(r.ok, false, "连不上时 ok:false");
      eq(r.reason, M.REASON.UNAVAILABLE, "reason 是 unavailable");
      chk(/没发出任何东西/.test(r.message), "文案说清「这一轮没发出任何东西」（不许让人以为发成了）");
      eq(E.readTier(b), "free", "本机那份缓存**一个字都没被改**（发放失败不该有任何副作用）");
    }

    {
      const b = mem();
      signedInStore(b);
      const fake = fakeApi({ grant: { ok: false, code: "E_NOT_CONFIGURED", message: "服务端还没配置好" } });
      const api = M.bind({ api: fake, E: E, A: A, backing: b });
      const r = await api.adminGrant({ emailMask: "a***@qq.com", tier: "pro" });
      eq(r.reason, M.REASON.NOT_CONFIGURED, "reason 是 not-configured（与「连不上」分开说）");
    }

    {
      const b = mem();
      signedInStore(b);
      const old = legacyApi({ me: { ok: true, plan: { tier: "pro" }, role: "owner" } });
      const api = M.bind({ api: old, E: E, A: A, backing: b });
      const r = await api.adminGrant({ emailMask: "a***@qq.com", tier: "pro" });
      eq(r.ok, false, "旧通道里没有 grant → 发放失败");
      eq(r.reason, "no-channel", "reason 是 no-channel（既不是「没配好」也不是「没权限」，刷新即可）");
      const me = await api.refreshMe();
      eq(me.ok, true, "**同一个旧通道上 refreshMe 照常工作**（不相关的新功能不许废掉既有功能）");
      eq(E.readServerTier(b), "pro", "…而且服务端那份判定照旧落盘");
    }

    {
      const b = mem();
      signedInStore(b);
      const fake = fakeApi({ grants: { ok: true, grants: [{ emailMask: "a***@qq.com", tier: "pro" }] } });
      const api = M.bind({ api: fake, E: E, A: A, backing: b });
      const r = await api.adminGrants();
      eq(r.ok, true, "列名单走接线层");
      eq(r.grants.length, 1, "名单原样带回（接线层不加工）");
      const r2 = await api.adminRevoke({ emailMask: "a***@qq.com" });
      eq(r2.ok, false, "假通道没给 revoke 的答案时如实失败（不假装成功）");
    }
  }

  console.log("\n=== 十八、真页面：/admin/ 的发放与改角色真的打接口（jsdom） ===");
  {
    let JSDOM = null;
    try { JSDOM = require("jsdom").JSDOM; } catch (e) { JSDOM = null; }

    if (!JSDOM) {
      console.log("(未安装 jsdom，跳过真页面一节 —— run.sh 会先装好它)");
    } else {
      const page = await bootAdminPage();
      const w = page.window, doc = page.doc;

      chk(!!w.AccountApi, "/admin/ 里 AccountApi 挂在 window 上（接线层真的被加载了）");
      chk(!!w.AuthCore.session(w.AuthCore.makeStore(w.localStorage)), "用例里的登录建立成功");

      eq(doc.getElementById("server-card").hidden, false, "服务端那一块渲染出来了");
      eq(doc.getElementById("accounts-card").hidden, false, "名录那一块也渲染出来了");
      eq(!!doc.getElementById("list-card"), false, "「本机发放名单」那一卡已删（Issue #276：全走数据库）");
      eq(!!doc.getElementById("sim-card"), false, "「模拟身份」那一卡已删（本机不再能自己改层级）");
      await sleep(60);

      const srv = doc.getElementById("server-list").textContent;
      chk(/s\*\*\*@qq\.com/.test(srv), "服务端名单渲染的是**接口回的**那条掩码（实际：" + srv.replace(/\s+/g, " ").slice(0, 80) + "）");

      // 名录：角色一列 + 改角色两颗键
      const accts = doc.getElementById("accounts-list").textContent;
      chk(/belem@163\.com/.test(accts), "名录里给出了明文邮箱（管理员认人靠它）");
      chk(/主人（种子）/.test(accts), "owner 那一行如实标出「种子」身份（不由这个口改）");

      const kidRow = doc.querySelector('.acct-row[data-uid="u_kid"]');
      chk(!!kidRow, "普通用户那一行在名录里");
      const roleBtns = kidRow.querySelectorAll("button[data-set-role]");
      eq(roleBtns.length, 2, "普通用户那一行有两颗角色键（普通用户 / 管理员）");
      const ownerRow = doc.querySelector('.acct-row[data-uid="u_owner"]');
      eq(ownerRow.querySelectorAll("button[data-set-role]").length, 0,
        "种子主人那一行**没有**角色键（改不了自己 / 改不了名单里的人 —— 服务端也再拦一次）");

      // 点「管理员」：真的打接口
      const adminBtn = kidRow.querySelector('button[data-set-role="admin"]');
      w.confirm = () => true;
      adminBtn.click();
      await sleep(60);
      eq(page.calls.roleMethod, "POST", "「改角色」真的发了 POST");
      eq(page.calls.roleUrl.indexOf("/api/admin/role") >= 0, true, "打的是 /api/admin/role");
      eq(page.calls.roleBody.uid, "u_kid", "带上要改的那个 uid");
      eq(page.calls.roleBody.role, "admin", "带上目标角色");
      okLine(doc.getElementById("msg-accounts").textContent, "改角色的回执如实说出结果");
      chk(/管理员/.test(kidRow.querySelector("[data-role-badge]").textContent), "那一行就地更新成管理员（不重拉整张表）");

      // 发放层级照旧
      doc.getElementById("input-mask").value = "x***@qq.com";
      doc.getElementById("btn-grant").click();
      await sleep(60);
      eq(page.calls.grantMethod, "POST", "「发放到服务端」真的发了 POST");
      eq(page.calls.grantUrl.indexOf("/api/admin/grant") >= 0, true, "打的是 /api/admin/grant");
      eq(page.calls.grantBody.tier, "pro", "带上默认档位 pro");
      eq(page.calls.grantBody.emailMask, "x***@qq.com", "带上填的掩码（表单读法只有一份）");
      okLine(doc.getElementById("msg-grant").textContent, "发放成功的回执如实说出「已写进数据库」");

      const revokeBtn = doc.querySelector('#server-list button[data-revoke]');
      chk(!!revokeBtn, "服务端名单每行有一颗「收回」");
      revokeBtn.click();
      await sleep(60);
      eq(page.calls.revokeMethod, "DELETE", "「收回」真的发了 DELETE");
      eq(page.calls.revokeUrl.indexOf("/api/admin/grant") >= 0, true, "打的是同一个地址");

      // ---- 用户报告那一张台账（Issue #276 第二轮）------------------------
      await sleep(60);
      eq(page.calls.reportBody.status, "new",
        "打开台账默认只看「已收到（还没看）」—— 下拉第一项就是它，不是「全部」");
      const counts = [...doc.querySelectorAll("#report-counts button")];
      chk(counts.length >= 5, "那一排小字每一格都是一颗可点的键（实际 " + counts.length + " 颗）");
      eq(counts.filter(b => b.className.indexOf("active") >= 0).length, 1,
        "只有当前筛的那一格是选中态（一排灰字 + 另一个下拉 = 同一件事两套控件，这次收成一套）");
      eq(counts[0].getAttribute("data-count-status"), "all",
        "第一格是「全部」（总数先摆出来），后面才是各档");
      chk(counts.some(b => b.getAttribute("data-count-status") === "new" &&
          b.textContent.indexOf("1") >= 0),
        "每一格括号里是全站该状态的条数（服务端 counts 原样画出来）");

      // 点「全部」那一格 → 真的换筛选重拉
      counts[0].click();
      await sleep(60);
      eq(page.calls.reportBody.status, "all", "点那一排小字 = 切筛选（不必再去动下拉）");
      eq(doc.getElementById("report-filter").value, "all", "下拉跟着走（两处共用一个出口）");

      // 状态键 + 「不采纳」多问一句
      doc.getElementById("report-filter").value = "all";
      doc.getElementById("report-filter").dispatchEvent(new w.Event("change"));
      await sleep(60);
      const rows = [...doc.querySelectorAll(".admin-report-row")];
      chk(rows.length >= 1, "台账把服务端那几条画出来了（实际 " + rows.length + " 条）");
      const acts = [...rows[0].querySelectorAll("button[data-report-act]")]
        .map(b => b.getAttribute("data-report-act"));
      eq(acts.join(","), "read,accepted,fixed,rejected",
        "每一条有四颗状态键，末一颗就是「不采纳」—— 只有终态才配一颗显眼的键");

      // 卡顶那几步：把「改源码 → 标已修复 → 注音走勘误」说清。
      // ⚠️ Issue #278 第六轮把四步收成三步（用户裁：「管理员页面如果废话太多
      //    也要删除精简，简单明了」）—— 原先第 1 步「用户点小旗 → 报告送进
      //    数据库」讲的是**报告怎么来的**，而看这一页的人刚点完小旗，
      //    那一步对他没有信息量。剩下三步都是他要做的事。
      const flow = doc.getElementById("reports-intro").parentElement
        .querySelectorAll(".admin-flow li");
      chk(flow.length === 3, "报告卡顶部有三步流程（实际 " + flow.length + " 步）");
      chk(/改源码/.test(doc.querySelector(".admin-flow").textContent) &&
          /标为已修复/.test(doc.querySelector(".admin-flow").textContent),
        "流程里点名「改源码」与「标为已修复」—— 这正是用户看不懂的那两件事");

      // 「钉住」不再留在孤零零的一格里：注音勘误自成一张卡，四格按步骤排
      const cards = [...doc.querySelectorAll("#admin-page > section")].map(x => x.id);
      chk(cards.indexOf("pinyin-card") > cards.indexOf("reports-card"),
        "注音勘误自成一张卡、排在报告卡之后（原先它在 DOM 里被报告的 </section> 截断、整块钻进报告卡里）");
      const pfLabels = [...doc.querySelectorAll("#pinyin-card .account-label")]
        .map(x => x.textContent.trim());
      chk(pfLabels.length === 4 && /^①/.test(pfLabels[0]) && /^④/.test(pfLabels[3]),
        "注音勘误四格带①②③④（一路往下填的顺序看得出来），实际：" + pfLabels.join(" / "));
    }
  }

  console.log("\n=== 十八之二、真页面：没有服务端角色时 /admin/ 如实拒绝（Issue #276）===");
  {
    let JSDOM = null;
    try { JSDOM = require("jsdom").JSDOM; } catch (e) { JSDOM = null; }
    if (!JSDOM) {
      console.log("(未安装 jsdom，跳过)");
    } else {
      const page = await bootAdminPage({ role: "user" });
      const doc = page.doc;
      eq(doc.getElementById("deny-card").hidden, false, "角色是 user 时画的是拒绝卡");
      eq(doc.getElementById("grant-card").hidden, true, "发放那一块**没画**（非 owner 看不到任何发放信息）");
      eq(doc.getElementById("accounts-card").hidden, true, "名录那一块也没画");
      eq(doc.getElementById("deny-lead").textContent, "只对管理员开放。",
        "拒绝卡只有这一句（用户裁：「说这么多废话干什么」）—— 不再分未登录 / 角色不够两种啰嗦");

      const page2 = await bootAdminPage({ signedOut: true });
      eq(page2.doc.getElementById("deny-card").hidden, false, "未登录时也拒绝");
      eq(page2.doc.getElementById("deny-lead").textContent, "只对管理员开放。",
        "未登录那一档与角色不够那一档**同一句**（答案本来就是一个：不放行）");
    }
  }

  console.log("\n=== 十一、头像地址跟着 /api/me 回来（Issue #243 后续）===");
  {
    // 头像字节太大（≤1 MB 的 data URL），进不了同步载荷 —— 它的跨设备靠
    // Storage 桶里那张图的公开地址。新设备上第一次拿到 /api/me 时把它写回
    // 账号域，否则换台设备头像就退回昵称首字（用户会以为「头像没同步」）。
    const AV = require(path.join(ROOT, "js/avatar.js"));
    const URL_OK = "https://x.supabase.co/storage/v1/object/public/avatars/zh/zhang/avatar.jpg";

    const b1 = mem();
    const { store: s1 } = signedInStore(b1);
    const a1 = M.bind({
      api: fakeApi({ me: { ok: true, plan: { tier: "pro" }, role: "user", avatar: URL_OK } }),
      E: E, A: A, AV: AV, backing: b1
    });
    eq(AV.avatar(b1).img, "", "起点：这台新设备的账号域里没有头像图片");
    await a1.refreshMe();
    eq(AV.avatar(b1).img, URL_OK, "/api/me 带回的地址真的写进了账号域");

    // 本机已经有图片时**不动它**：那份是「服务器还没配上时还能看」的
    const b2 = mem();
    const { store: s2 } = signedInStore(b2);
    AV.setAvatar(b2, { img: "https://example.com/mine.jpg" });
    const a2 = M.bind({
      api: fakeApi({ me: { ok: true, plan: { tier: "pro" }, role: "user", avatar: URL_OK } }),
      E: E, A: A, AV: AV, backing: b2
    });
    await a2.refreshMe();
    eq(AV.avatar(b2).img, "https://example.com/mine.jpg", "本机已有图片时不覆盖（它不是空位）");

    // 服务端没配 Storage：如实回空串，不编一个假地址
    const b3 = mem();
    signedInStore(b3);
    const a3 = M.bind({
      api: fakeApi({ me: { ok: true, plan: { tier: "free" }, role: "user", avatar: "" } }),
      E: E, A: A, AV: AV, backing: b3
    });
    await a3.refreshMe();
    eq(AV.avatar(b3).img, "", "服务端没配 Storage 时账号域仍是空的（不假装有头像）");

    // 脏地址（不是白名单里的形状）一律不收
    const b4 = mem();
    signedInStore(b4);
    const a4 = M.bind({
      api: fakeApi({ me: { ok: true, plan: { tier: "free" }, role: "user", avatar: "javascript:alert(1)" } }),
      E: E, A: A, AV: AV, backing: b4
    });
    await a4.refreshMe();
    eq(AV.avatar(b4).img, "", "javascript: 这种假地址不收（走的是同一份 isImgUrl 白名单）");

    // 服务端那一侧：publicAccount() 如实带上地址，没配就回空串
    const core = require(path.join(ROOT, "api/_lib/core.js"));
    const withStore = core.publicAccount(
      { avatarPublicUrl: u => "https://x.supabase.co/storage/v1/object/public/avatars/" + u.slice(0, 2) + "/" + u + "/avatar.jpg" },
      { uid: "zhangmin", nickname: "张敏", role: "user" }
    );
    chk(/\.jpg$/.test(withStore.avatar), "配了 Storage 时 /api/me 带上公开地址");
    eq(core.publicAccount({}, { uid: "zhangmin" }).avatar, "",
      "没配 Storage 时回空串（不编一个指向不存在文件的地址）");
    eq(core.avatarUrlOf({}, "ab"), "", "uid 太短时也不编地址");
  }

  console.log("");
  if (fails) { console.log("❌ 账号接线测试 " + fails + " 项失败"); process.exit(1); }
  console.log("🎉 账号接线测试全部通过");
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function okLine(text, what) {
  const t = String(text || "");
  chk(t.length > 0, what + "：" + t.replace(/\s+/g, " ").slice(0, 120));
}

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

    try { w.eval(fs.readFileSync(p, "utf8")); } catch (e) { }
  });

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

async function bootAdminPage(opts) {
  opts = opts || {};
  const JSDOM = require("jsdom").JSDOM;
  const html = read("admin/index.html");
  const dom = new JSDOM(html, { url: "https://kuibu.app/admin/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const calls = {
    count: 0, me: 0,
    grantMethod: null, grantUrl: null, grantBody: null,
    revokeMethod: null, revokeUrl: null,
    roleMethod: null, roleUrl: null, roleBody: null,
    listMethod: null
  };

  w.fetch = function (u, init) {
    const url = String(u);
    const m = ((init && init.method) || "GET").toUpperCase();
    calls.count += 1;
    if (url.indexOf("/api/me") >= 0) {
      calls.me += 1;
      return Promise.resolve(jsonRes(200, { uid: "u_1", role: "owner", plan: { tier: "free", until: null }, mask: "a***@b.com", features: [] }));
    }
    if (url.indexOf("/api/admin/grants") >= 0) {
      calls.listMethod = m;
      return Promise.resolve(jsonRes(200, { grants: [{ emailMask: "s***@qq.com", tier: "pro", until: null }], store: "memory" }));
    }
    if (url.indexOf("/api/admin/accounts") >= 0) {
      calls.accountsMethod = m;
      return Promise.resolve(jsonRes(200, {
        total: 2, store: "memory", accounts: [
          { uid: "u_owner", email: "belem@163.com", emailMask: "b***@163.com", nickname: "主人",
            tier: "max", role: "owner", status: "active", emailVerified: true, hasPassword: true,
            createdAt: 1, lastLoginAt: 2 },
          { uid: "u_kid", email: "kid@example.com", emailMask: "k***@example.com", nickname: "",
            tier: "free", role: "user", status: "active", emailVerified: true, hasPassword: true,
            createdAt: 3, lastLoginAt: 4 }
        ]
      }));
    }
    if (url.indexOf("/api/admin/reports") >= 0) {
      const body = init && init.body ? JSON.parse(init.body) : {};
      calls.reportMethod = m; calls.reportUrl = url; calls.reportBody = body;
      // 两条：一条还没处理、一条已修复 —— 用来验「默认只看新到的」那一档。
      return Promise.resolve(jsonRes(200, {
        total: 2, store: "memory",
        counts: { all: 2, new: 1, read: 0, accepted: 0, fixed: 1, rejected: 0 },
        reports: body.status === "all" || body.status === "fixed"
          ? [{ rid: "r_1", kind: "pinyin", status: "fixed", poemId: "p1", poemTitle: "滕王阁序",
               book: "古文观止", quote: "长", context: "秋水共长天一色。", note: "该读 cháng",
               suggestion: "", reply: "", createdAt: 1, updatedAt: 2, handledAt: 2, emailMask: "a***@qq.com" }]
          : [{ rid: "r_2", kind: "text", status: "new", poemId: "p2", poemTitle: "静夜思",
               book: "一年级上册", quote: "明月", context: "床前明月光。", note: "少了一个字",
               suggestion: "", reply: "", createdAt: 3, updatedAt: 3, handledAt: 0, emailMask: "b***@qq.com" }]
      }));
    }
    if (url.indexOf("/api/admin/role") >= 0) {
      const body = init && init.body ? JSON.parse(init.body) : {};
      calls.roleMethod = m; calls.roleUrl = url; calls.roleBody = body;
      return Promise.resolve(jsonRes(200, {
        uid: body.uid, role: body.role, before: "user", changed: true,
        emailMask: "k***@example.com", note: "已写进数据库"
      }));
    }
    if (url.indexOf("/api/admin/grant") >= 0) {
      const body = init && init.body ? JSON.parse(init.body) : {};
      if (m === "DELETE") {
        calls.revokeMethod = m; calls.revokeUrl = url;
        return Promise.resolve(jsonRes(200, { matched: 1, changed: true, emailMask: body.emailMask, tier: "free" }));
      }
      calls.grantMethod = m; calls.grantUrl = url; calls.grantBody = body;
      return Promise.resolve(jsonRes(200, { matched: 1, changed: true, emailMask: body.emailMask, tier: body.tier, until: null, note: "已写进服务端的权威名单" }));
    }
    return Promise.resolve(jsonRes(404, { code: "E_404" }));
  };

  [...w.document.querySelectorAll("script[src]")].forEach(s => {
    const src = s.getAttribute("src");
    if (!src) return;
    const p = path.join(ROOT, src.replace(/^\//, ""));
    if (!fs.existsSync(p)) return;
    try { w.eval(fs.readFileSync(p, "utf8")); } catch (e) { }
  });
  if (w.Entitlement && w.Entitlement.setAuthCore) w.Entitlement.setAuthCore(w.AuthCore);

  if (w.Entitlement) {
    // 服务端答案的缓存（Issue #276：本机发放名单已下线，这里是「上一次问到的」那份）。
    // 角色写 owner —— 否则新版 /admin/ 会如实拒绝（本机兜底已删）。
    if (!opts.signedOut) {
      w.Entitlement.writeTier(w.localStorage, "free", null, { source: "server", role: opts.role || "owner" });
    }
  }
  if (w.AuthCore && !opts.signedOut) {
    const store = w.AuthCore.makeStore(w.localStorage);
    const r = w.AuthCore.requestCode(store, { channel: "email", value: "zhangmin@163.com" }, "login", { code: "246810" });
    w.AuthCore.verifyCode(store, r.codeId, "246810", "login");
  }
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  await sleep(40);
  return { window: w, doc: w.document, calls: calls };
}

function jsonRes(status, body) {
  return {
    status: status, ok: status >= 200 && status < 300,
    headers: { get: () => "application/json" },
    text: () => Promise.resolve(JSON.stringify(body))
  };
}

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
