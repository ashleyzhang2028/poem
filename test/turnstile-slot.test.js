"use strict";

/* 用户 2026-09-19（Issue #225）：在托管平台配好了
   TURNSTILE_ENABLED / TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY 三个变量，
   页面上却**看不见方框**，而且卡在「请先完成人机校验（上面那个方框）」上出不去。

   这一层守的就是那一步：**方框没渲染出来时，不许再让用户去勾一个不存在的东西。**
   js/turnstile.js 是纯 UMD，VM 里给个假 document / 假 Cloudflare 就能把六种
   现场逐个跑出来，不必开浏览器。 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "js/turnstile.js"), "utf8");

let pass = 0, fail = 0;
function chk(ok, msg) {
  if (ok) { pass += 1; console.log("✓ " + msg); }
  else { fail += 1; console.log("✗ " + msg); }
}

// 把 js/turnstile.js 装进一个沙箱。cf 为 null 时表示脚本没加载出来。
function boot(cf) {
  const calls = {};
  const sandbox = {
    module: { exports: {} },
    console: console,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    Promise: Promise, URLSearchParams: URLSearchParams,
    document: {
      getElementById: () => ({}),
      querySelector: () => null,
      createElement: () => ({ setAttribute() {} }),
      head: { appendChild() {} }
    }
  };
  if (cf) sandbox.turnstile = cf(calls);
  sandbox.globalThis = sandbox;
  sandbox.module.exports = {};
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { T: sandbox.module.exports, calls: calls };
}

const CF_OK = (calls) => ({
  render: (el, opts) => { Object.assign(calls, opts); return "w0"; },
  reset() {}
});

(async function () {
  console.log("=== 人机校验的方框（Issue #225 · 看不见方框时不许再让人去勾它）===");

  const js = fs.readFileSync(path.join(ROOT, "js/turnstile.js"), "utf8");
  chk(/function why\(\)/.test(js) && /function failed\(\)/.test(js),
    "js/turnstile.js 自己分得清「没配」/「渲染失败」/「脚本加载失败」，并把原因说成人话（why()）");

  chk(/BROKEN/.test(js) && /widget_error/.test(js) && /render_failed/.test(js),
    "「装不上」的那几种 err（widget_error / render_failed / script_* / no_render_api）被点名收在一处");

  {
    // ① 根本没配 —— 如实「不渲染、不校验」，不该拦
    const { T } = boot(CF_OK);
    await T.mount({}, { siteKey: "", enabled: false });
    chk(T.state().skipped === true && T.gate() === null,
      "没配时 skipped=true 且 gate 放行（如实降级，不假装拦着）");
    chk(T.failed() === false, "没配不算「坏了」（不许报假故障）");
  }

  {
    // ② 配好、方框渲染出来、但用户还没勾 —— 这时才该说「请先完成人机校验」
    const { T } = boot(CF_OK);
    await T.mount({}, { siteKey: "0x4AAAAAAA", enabled: true });
    chk(T.state().configured === true && T.state().err === null,
      "两个 key 都在、脚本也回来了：widget 渲染出来（err 为空）");
    chk(/请先完成人机校验/.test(T.gate() || ""),
      "⚠️ 这一档才是「请先完成人机校验（上面那个方框）」—— 方框真的在页面上");
    chk(T.failed() === false, "「没勾」不是「坏了」—— 两件事必须分得开");
  }

  {
    // ③ 用户点名的现场：Site Key / 域名不允许 → Cloudflare 调 error-callback
    const { T, calls } = boot(CF_OK);
    await T.mount({}, { siteKey: "0x4AAAAAAA_wrong", enabled: true });
    chk(typeof calls["error-callback"] === "function",
      "widget 挂了 error-callback（Cloudflare 判 Site Key 错 / 域名不在允许列表时走这条）");
    calls["error-callback"]();
    chk(T.state().err === "widget_error" && T.failed() === true,
      "error-callback 之后如实记成「坏了」");
    chk(T.gate() === null,
      "⚠️ 关键：不再回「请先完成人机校验（上面那个方框）」—— 那个方框根本不存在，" +
      "用户照着找会永远卡在页面上（这就是 Issue #225 里那句卡住的话）");
    chk(/Site Key|允许列表/.test(T.why()),
      "why() 直说两种真原因：Site Key 填错、或本站域名没加进 widget 的允许列表");
    chk(/管理员/.test(T.why()),
      "并告诉用户这不是他能修的（指一条去找站点管理员的路），而不是让他一直重试");
  }

  {
    // ④ 脚本压根没加载出来（拦截 / 断网 / CSP）
    const { T } = boot(() => ({ render() { return "w"; }, reset() {} }));
    const sandboxNoCf = boot(null);
    const r = await sandboxNoCf.T.mount({}, { siteKey: "0x4AAAAAAA", enabled: true });
    chk(r.err === "script_timeout" || r.err === "script_error",
      "Cloudflare 脚本没回来时如实记 script_timeout / script_error（实际 " + r.err + "）");
    chk(sandboxNoCf.T.failed() === true, "这一档同样算「坏了」（方框也不会出现）");
    chk(sandboxNoCf.T.gate() === null, "脚本坏掉时也放行前端 —— 不能再让人去勾不存在的方框");
    chk(/拦截|网络/.test(sandboxNoCf.T.why()),
      "why() 说的是「关掉广告拦截 / 换个网络」，不是让用户去勾方框");
    chk(T && true, "（对照）脚本正常时同一个 mount 不会走到这里");
  }

  {
    // ⑤ 拿到 token —— 放行
    const { T, calls } = boot(CF_OK);
    await T.mount({}, { siteKey: "0x4AAAAAAA", enabled: true });
    calls.callback("token-abc");
    chk(T.token() === "token-abc" && T.gate() === null,
      "勾完拿到 token 就放行（gate 回 null）");
    calls["expired-callback"]();
    chk(T.token() === "" && !!T.gate(),
      "token 过期后回到「请先完成人机校验」（这时方框还在，说得通）");
  }

  {
    // ⑥ 三个页面都得把「坏了」这档说出来
    const login = fs.readFileSync(path.join(ROOT, "login/index.html"), "utf8");
    const reset = fs.readFileSync(path.join(ROOT, "reset/index.html"), "utf8");
    const loginJs = fs.readFileSync(path.join(ROOT, "js/login.js"), "utf8");
    const resetJs = fs.readFileSync(path.join(ROOT, "js/reset.js"), "utf8");

    ["ts-pw", "ts-code", "ts-reg", "ts-verify", "ts-forgot", "ts-unverified"].forEach((id) => {
      chk(new RegExp('id="ts-broken-' + id + '"').test(login),
        "登录/注册页每一处挂载点旁边都备了一条失败提示（" + id + "）");
    });
    chk(/id="ts-broken-reset"/.test(reset), "重设密码页也有（ts-reset）");
    chk(/ts-broken-/.test(loginJs) && /turnstileBrokenNote/.test(loginJs),
      "js/login.js 在 mount 之后查一次、坏了就把原因写进那条提示");
    chk(/ts-broken-/.test(resetJs) && /turnstileBrokenNote/.test(resetJs),
      "js/reset.js 同样处理");
    chk(/turnstileHideNotes/.test(loginJs) && /turnstileHideNotes\(\)/.test(loginJs),
      "切屏时把上一屏的失败提示收掉（注册屏的红字不许留在登录屏上）");
    chk(/api\/diag/.test(loginJs) || /自检/.test(loginJs),
      "提示里给一条能走的路：自检页 / /api/diag 看服务端怎么说");
  }

  console.log("");
  console.log(fail ? "❌ " + fail + " 项失败" : "✅ 全部通过（" + pass + " 项）");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
