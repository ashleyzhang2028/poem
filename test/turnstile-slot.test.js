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
//
// opts.late = true 模拟**真网页的那条时序**：Cloudflare 的脚本还没到，
// 页面就先调了 mount()（用户一打开页面就挂），脚本在之后才异步回来 ——
// `window.turnstile` 是脚本自己的顶层赋值，所以这里用脚本 onload 那一刻
// 才把 turnstile 塞进沙箱。
function boot(cf, opts) {
  opts = opts || {};
  const calls = {};
  const appended = [];
  const sandbox = {
    module: { exports: {} },
    console: console,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    Promise: Promise, URLSearchParams: URLSearchParams,
    document: {
      getElementById: () => ({}),
      querySelector: () => null,
      createElement: () => ({
        setAttribute() {}, _onload: null,
        get onload() { return this._onload; },
        set onload(fn) { this._onload = fn; }
      }),
      head: { appendChild: (s) => appended.push(s) }
    }
  };
  if (cf && !opts.late) sandbox.turnstile = cf(calls);
  sandbox.globalThis = sandbox;
  sandbox.module.exports = {};
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);

  // 脚本「加载完成」：沙箱里现在才出现 window.turnstile，再触发 onload
  function arrive() {
    if (cf) sandbox.turnstile = cf(calls);
    appended.forEach((s) => { if (typeof s.onload === "function") s.onload(); });
  }
  return { T: sandbox.module.exports, calls: calls, appended: appended, arrive: arrive };
}

const CF_OK = (calls) => ({
  render: (el, opts) => { Object.assign(calls, opts); return "w0"; },
  reset() {}
});

(async function () {
  console.log("=== 人机校验的方框（Issue #225 · 看不见方框时不许再让人去勾它）===");
  console.log("    Issue #276：方框要在**点提交之前**就准备好，不是点完才慢慢弹出来。");

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
    const { T, calls } = boot(CF_OK);
    await T.mount({}, { siteKey: "0x4AAAAAAA", enabled: true });
    chk(T.state().configured === true && T.state().err === null,
      "两个 key 都在、脚本也回来了：widget 渲染出来（err 为空）");
    chk(calls.size === "flexible", "Turnstile 使用 flexible 尺寸适配窄屏");
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
    const rendered = [];
    const removed = [];
    const { T } = boot(() => ({
      render(el) { rendered.push(el); return "w" + rendered.length; },
      reset() {},
      remove(id) { removed.push(id); }
    }));
    const first = { id: "ts-reg" };
    const second = { id: "ts-forgot" };
    await T.mount(first, { siteKey: "0x4AAAAAAA", enabled: true });
    await T.mount(second, { siteKey: "0x4AAAAAAA", enabled: true });
    chk(rendered.length === 2 && rendered[1] === second && removed[0] === "w1",
      "切到另一处受保护表单时，Turnstile 方框跟着移到当前面板");
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
    // ⑥ 只有服务端真正校验的提交才显示 Turnstile
    const login = fs.readFileSync(path.join(ROOT, "login/index.html"), "utf8");
    const reset = fs.readFileSync(path.join(ROOT, "reset/index.html"), "utf8");
    const loginJs = fs.readFileSync(path.join(ROOT, "js/login.js"), "utf8");
    const resetJs = fs.readFileSync(path.join(ROOT, "js/reset.js"), "utf8");

    // ⚠️ Issue #278 第四轮：`ts-pw` 进了这张表 —— 用户 2026-09-24 明确要求
    //    「登录页面同样加上 cloudflare 的验证」，服务端（core.js 的
    //    loginWithPassword）那条路也挂上了闸。原来那条「密码登录不显示
    //    Turnstile」的断言因此**反过来**：现在必须显示，否则前端不画方框、
    //    服务端却要 token，谁也不进来。
    ["ts-pw", "ts-code", "ts-reg", "ts-verify", "ts-forgot", "ts-unverified"].forEach((id) => {
      chk(new RegExp('id="ts-broken-' + id + '"').test(login),
        "登录/注册页每一处挂载点旁边都备了一条失败提示（" + id + "）");
    });
    chk(/id="ts-pw" hidden/.test(login),
      "密码登录那一屏也挂 Turnstile（Issue #278：服务端那条路现在确实校验它）");
    // 重设密码页仍然不挂：那一条**没变**（reset-confirm 是点邮件链接进来的，
    // 那一步已经证明了邮箱可达；reset-request 在登录页上，那一处有方框）。
    chk(!/ts-reset|turnstile\.js/.test(reset), "重设密码页不显示服务端不校验的 Turnstile");
    chk(/ts-broken-/.test(loginJs) && /turnstileBrokenNote/.test(loginJs),
      "js/login.js 在 mount 之后查一次、坏了就把原因写进那条提示");
    chk(!/Turnstile|turnstileBrokenNote|mountTurnstile/.test(resetJs),
      "js/reset.js 不执行服务端未采用的 Turnstile 校验");
    chk(/turnstileHideNotes/.test(loginJs) && /turnstileHideNotes\(\)/.test(loginJs),
      "切屏时把上一屏的失败提示收掉（注册屏的红字不许留在登录屏上）");
    chk(/请刷新页面重试/.test(loginJs) && /如问题持续，请联系管理员/.test(loginJs),
      "提示提供刷新重试和联系管理员两步处理方式");
  }


  {
    // ⑦ 用户 2026-09-21（Issue #276）：验证框**提交之后才弹出来**，还慢慢转圈。
    //
    // 真网页的时序应该是：用户一打开页面，Cloudflare 的脚本就上路；等他填完
    // 邮箱密码点「注册」时，方框早就在那儿、token 早在手里。原先把「拉脚本
    // （最多 8 秒）+ 渲染 widget + 等 Cloudflare 判人机」全压在点提交之后，
    // 用户看到的就是「点完按钮，验证框才慢慢冒出来」。
    // preload() 就是修这一条的：**页面打开时**就把脚本插上去（这时还没拿到
    // siteKey，所以只加载、不渲染）。这一节守三件事：
    //   ① preload() 当场就插 <script>（不是等有人 mount 才插）；
    //   ② 它只插一个，重复叫不多插（否则页面上会出现两个方框）；
    //   ③ 脚本还没回来、siteKey 先到时挂载不拦人、也不报假故障。
    const { T, appended } = boot(CF_OK, { late: true });
    chk(typeof T.preload === "function",
      "⚠️ js/turnstile.js 给出了 preload() —— 页面打开时就能把脚本拉起来（Issue #276）");
    if (typeof T.preload === "function") T.preload();
    chk(appended.length === 1 && appended[0].src === T.SCRIPT_SRC,
      "⚠️ 页面一打开（preload）就把 Cloudflare 的脚本插上 —— 不用等用户点提交");
    if (typeof T.preload === "function") T.preload();
    chk(appended.length === 1, "重复 preload 不会插第二个 <script>（否则页面上两个方框）");

    const mounting = T.mount({ id: "ts-reg" }, { siteKey: "0x4AAAAAAA", enabled: true });
    chk(T.failed() === false && T.state().err === null,
      "脚本还在路上时挂载：不算坏、也不报假故障（「还没到」不是「坏了」）");
    chk(appended.length === 1, "拿到 siteKey 后挂载复用 preload 那一份脚本，不再插一个");

  }

  {
    // ⑦c 脚本「还在路上」不是「坏了」（Issue #278 第五轮 · 真浏览器量出来的）。
    //
    // 现场：页面打开时 preload() 插 <script>（Issue #276），紧接着拿到 siteKey
    // 的 mount() 走 `loadScript().then(renderWidget)` —— 而 loadScript() 那一下
    // 回的是**已经 resolve 的 Promise**，.then 于是不等脚本到达就跑了
    // renderWidget，此时 root.turnstile 还没出现，旧实现记下 `no_render_api`
    // （在 BROKEN 表里）→ 页面上摆出一句**红字**「人机校验脚本没给出可用的接口
    // （多半是被网络中间层改写了）」。而 300ms 后方框正常画出来、token 也拿到了。
    // 用户看到的是一个根本不存在的故障。
    // ⚠️ 这一节要分清**两个时刻**，不能只看「mount 之后」那一个瞬间：
    //   · 脚本还在路上（前 8 秒内）：`renderWidget()` 被叫到时
    //     `root.turnstile` 还没出现 —— 这一档**什么都不许记**。
    //     旧实现在这里记 `no_render_api`（BROKEN 表里的一员），
    //     于是页面上立刻摆出一句红字「脚本没给出可用的接口（多半是被网络
    //     中间层改写了）」，而方框半秒后就自己画出来了。
    //   · 脚本一直没来（过了 loadScript 的 8 秒超时）：那才是真的坏了，
    //     由 loadScript 的失败分支记 script_timeout，页面上该说话。
    // 所以判据是「**那一刻** err 是不是 no_render_api」，而不是「最终 err 是不是空」。
    const { T } = boot(CF_OK, { late: true });
    if (typeof T.preload === "function") T.preload();
    await T.mount({ id: "ts-reg" }, { siteKey: "0x4AAAAAAA", enabled: true });
    chk(T.state().err !== "no_render_api",
      "⚠️ 脚本还在路上时**不许**记成 no_render_api —— 那会让页面上多一句假红字（Issue #278）");
    chk(T.state().ready === false, "还没有 token（方框都还没画出来）—— 但也不许拦人");
    chk(T.gate() === null, "这一档前端不拦人（脚本还在路上，方框马上就到）");

    // 而脚本一路没来（8 秒超时之后）仍然如实说「坏了」，且仍然放行前端
    chk(T.state().err === "script_timeout" && T.failed() === true,
      "脚本一直没到（8 秒超时）才记「坏了」，实际 " + T.state().err);
    chk(T.gate() === null, "超时那一档同样放行前端（方框不存在时不能让人去勾它）");
  }

  {
    // ⑦d 脚本到得比 siteKey 晚：脚本回来时必须补渲染一次，否则方框永远不出现
    const { T, calls, arrive } = boot(CF_OK, { late: true });
    if (typeof T.preload === "function") T.preload();
    const mounting = T.mount({ id: "ts-reg" }, { siteKey: "0x4AAAAAAA", enabled: true });
    chk(T.state().ready === false, "脚本还没回来时没有 token（方框都还没画出来）");
    arrive();
    await mounting;
    chk(calls.sitekey === "0x4AAAAAAA",
      "⚠️ 脚本回来之后补渲染一次 —— 否则方框永远不出现（Issue #276 的「慢慢才弹出来」）");
  }

  {
    // ⑧ token 是全局的，页面切一次面板就会把它清掉一次；提交要等一等。
    //    这一节只钉「挂载本身不再顺手把 token 抹掉」—— 旧实现每换一次容器就
    //    remove + 清空 token，用户在注册页填表期间切一下屏，token 就没了。
    const rendered = [];
    const removed = [];
    const { T } = boot(() => ({
      render(el, opts) { rendered.push(el.id); if (opts.callback) opts.callback("tok-" + rendered.length); return "w" + rendered.length; },
      reset() {},
      remove(id) { removed.push(id); }
    }));
    await T.mount({ id: "ts-code" }, { siteKey: "0x4AAAAAAA", enabled: true });
    const before = T.token();
    await T.mount({ id: "ts-reg" }, { siteKey: "0x4AAAAAAA", enabled: true });
    chk(before !== "" && T.token() !== "",
      "换面板之后 token 不丢（旧实现每换一次容器就清空一次 token）");
    chk(rendered.join(",") === "ts-code,ts-reg",
      "换面板时把上一个方框挪走、在新面板上补一个（不叠两个）");
  }

  {
    // ⑨ 页面结构与接线：脚本在页面打开时就上路，方框在切到那一屏时就挂上
    const login = fs.readFileSync(path.join(ROOT, "login/index.html"), "utf8");
    const loginJs = fs.readFileSync(path.join(ROOT, "js/login.js"), "utf8");
    // Issue #278 第四轮改了口径：pw 那一屏**现在挂**（服务端也校验了）。
    // ⚠️ 两条要一起在：TS_SLOTS 里有 pw（切屏就画）+ 提交时带令牌。
    //    只有前者 = 用户勾了方框，令牌却没送出去 → 服务端回 E_TURNSTILE；
    //    只有后者 = 页面上没有方框可勾 → 那句提示指着一个不存在的东西。
    chk(/TS_SLOTS = \{[\s\S]{0,40}pw:\s*"ts-pw"/.test(loginJs),
      "密码登录那屏也在 TS_SLOTS 里（服务端那条路挂了闸，前端就得画方框）");
    chk(/turnstileBlocked\("msg-pw"\)/.test(loginJs), "提交口令前先过前端那道闸");
    chk(/turnstileToken:\s*turnstileToken\(\)/.test(loginJs), "并且把当前那枚令牌带上（否则必然被服务端拒）");
    const setModeBody = loginJs.slice(loginJs.indexOf("function setMode(mode)"), loginJs.indexOf("function esc("));
    chk(/mountTurnstile\(mode\)/.test(setModeBody),
      "setMode 里就挂当前面板（用户切到某屏的那一下，方框已经开始画了）");
    chk(/api\.config\(\)/.test(loginJs) && /mountTurnstile\(state\.mode\)/.test(loginJs),
      "拿到 /api/config 之后把当前面板挂上（那时才第一次知道 siteKey）");
    chk(/TS\.preload\(\)/.test(loginJs),
      "⚠️ 页面打开（init）就调 TS.preload() —— 脚本在路上，不是等点提交才去拉");
    const initBody = loginJs.slice(loginJs.indexOf("function init()"), loginJs.indexOf("if (document.readyState"));
    chk(/preloadTurnstileScript\(\)/.test(initBody),
      "preload 就在 init 里（不是藏在某个提交处理函数里）");
    chk(/<script src="\/js\/turnstile\.js"><\/script>/.test(login) && !/challenges\.cloudflare\.com/.test(login),
      "登录页仍然只引本站那一份实现（不自己再手写一段 Cloudflare 脚本）");
  }

  console.log("");
  console.log(fail ? "❌ " + fail + " 项失败" : "✅ 全部通过（" + pass + " 项）");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
