/**
 * 登录页逻辑（/login/）—— 把 js/auth-core.js 这个「内核」接上车
 * ==========================================================================
 * 内核（auth-core.js）早写好了：状态机、频控、锁定、密码学上的零碎都在里面，
 * 而且有 110 条断言守着。本文件**只做界面**，一条业务规则都不新造 ——
 * 凡是「能不能发码」「码对不对」「还锁着多久」，一律问内核。
 *
 * 为什么业务规则全交给内核：本合同一份逻辑跑三张页（login / profile / admin），
 * 一旦某页自己写了「错三次就锁」这类判断，三张页的规则必然漂移，
 * 而漂移出来的 bug 恰好都是最敏感的账号问题。
 *
 * ## Issue #197：这一页从一个表单改成**四个页签 + 两屏支路**
 *
 * 用户要的是**一整套完整流程**：注册 → 邮件确认 → 登录 / 忘记密码 → 重设，
 * 外加原有的随机码快捷登录。摊成一页长条的后果上一轮已经被点过名
 * （「重复的注册按钮」），所以：
 *
 *   · 页签只有两个 —— **密码登录 / 快捷登录**（两条并行的主路）
 *   · 注册与忘记密码是**藏在文字链后面的另外两屏**（它们本来就是少数路径）
 *   · 注册完多一屏「等你去邮箱点确认」
 *
 * 四条刻意的做法：
 *   1. **不假装有服务器**：有服务端时真的走服务端（`js/auth-api.js`），
 *      没有（没配好 / 连不上 / 断网）才回落本机，并如实标注
 *      「本地体验版」，绝不写成「邮件已发出」（docs/auth-design.md §7.1）
 *   2. **错误码→文案只映射一次**：内核与 `js/auth-api.js` 返回的 `message`
 *      就是给用户看的话，本页**不重写一份**。重写就意味着
 *      「内核改了口径、界面还是老话」。
 *   3. **只读不写**：本页只碰 `poem_auth_v1`（会话/码）与 `poem_profile_v1`
 *      （昵称），**一个字节都不写进度键** —— 有测试守着（只读页面不写盘）。
 *   4. **口令不落任何本地存储**（Issue #197 新增的一条）：填进 input 的那串
 *      只在内存里活到发请求那一刻，之后既不写 localStorage，
 *      也不进 URL、不进日志。有源码断言守着（本文件里不许出现
 *      `localStorage` 与 `password` 同时出现在一行）。
 */
(function () {
  "use strict";

  var A = window.AuthCore;
  var Ent = window.Entitlement;
  /* 人机校验（Cloudflare Turnstile，Issue #197 后续）。
     ⚠️ 它可能是 `undefined`（老 WebView 没加载到、或这一页是按老 HTML 打开的）——
        下面的每一处都按「没有它也能跑」写：**真闸在服务端**，
        前端这里少一个模块只意味着「这一次没带 token」，服务端会如实回答。
        ⚠️ 绝不在这里现编一个空对象假装它有接口 —— 那会让 `T.mount` 这类
           调用静默地什么都不做，而症状是「人机校验一片空白还以为配好了」。 */
  var TS = window.Turnstile || null;

  /* 存储：内核的标准配件。隐私模式下内核会自己降级为内存会话 */
  var backing = null;
  try { backing = window.localStorage; } catch (e) { backing = null; }
  var store = A && A.makeStore ? A.makeStore(backing) : null;

  /* 服务端通道（1 期 · 1A 期）。**没配好 / 连不上 / 断网**时整体降级为
     「本地体验版」：那时下面的每一个分支都回落到内核的本机实现，
     界面上多一行如实说明，其余一字不改（docs §4.6 第 1 条）。 */
  var api = (window.AuthApi && window.AuthApi.supported()) ? window.AuthApi.create({
    // 设备标识由内核发；取不到（隐私模式 / 还没建过会话）就留空，
    // 服务端会退回按 IP 分桶 —— 绝不在这里现编一个 id
    deviceId: (function () {
      try { return (store && store.read().deviceId) || ""; } catch (e) { return ""; }
    })()
  }) : null;

  /**
   * 这一屏走的是哪条路。
   *   true  = 本机体验版（没有服务端，或它现在不可用）
   *   false = 服务端（真发信、真会话）
   * ⚠️ 判据**只有这一处**：别在别的分支里各写一遍 `if (api)`，
   *    那种写法在「服务端先成功、后失败」时会两处不一致。
   */
  function isLocal() { return !api || api.degraded(); }

  /**
   * 口令那一套是不是**需要服务端**。
   *
   * ⚠️ 这是 Issue #197 里最要紧的一条「不假装」：
   *    注册、口令登录、确认邮件、重设口令**全都 100% 在服务端**
   *    （口令摘要要有 pepper、要落库；确认链接要发信）。本机内核里
   *    没有这些东西，也不该有 —— 在浏览器里存一份口令摘要等于
   *    把「谁都改得动」的东西当成凭据（docs/auth-design.md §1 第 3 条）。
   *
   *    所以服务端不可用时，这几条路**如实说「暂时不可用」**，
   *    绝不偷偷回落到一个本机版本 —— 那会给出一个「注册成功了」
   *    但换台设备就登不上去的假承诺。
   *    而**随机码那条路照旧可以本机降级**（它本来就是本机自证）。
   */
  function passwordNeedsServer() {
    return isLocal();
  }

  /* 人机校验的配置（从 `GET /api/config` 来；**出厂是「没配」** ——
     拿不到那一条时的表现与「服务端没配」逐字一致：不渲染、不拦。
     ⚠️ 这不是「默认放行」的安全洞：真闸在服务端（`core.humanGuard`），
        前端这里拿不到 siteKey 只意味着「这一次没带 token」，
        服务端会按它自己的配置如实回答。 */
  var tsConfig = { enabled: false, siteKey: "" };

  /* 出厂**不许假设**发信是通的（下面那三条「请查收」的落点都读它）。

     ⚠️ 这是**一个真出过的坑**：落点上原先写的是一句笃定语气的
        「重设链接已经发出去了」「确认邮件已经发出去了」——
        在**发信商没配好**（console 通道）的实例上，那句话对**所有人**
        都是空的（谁都收不到），而界面又不像别处那样如实改口。
        用户会去收件箱等一封永远不来的信，然后回来反复点。
        实测：把 `GET /api/config` 换成一个不含 `mail` 的响应，
        「忘记密码」那一屏照样写着「已经发出去了」。

     ⚠️ 判据只有一处（`GET /api/config` 的 `mail.delivered`，与登录页上方
        那句「这台服务器还没接上发信商」、服务端 `/api/me` 的 `channel`
        同源），这里**不另算一份**。
     ⚠️ 它**不泄露「这个邮箱注册过没有」**：说的是**这台服务器**的属性，
        与请求里那个邮箱无关（`api/_lib/routes/config.js` 里写着同一条纪律）。 */
  var mailDelivered = null;        // null = 还不知道（拿不到配置 ≠ 没配好）

  /* 本页状态（**不进 localStorage**：它只是「这一屏画到哪一步」） */
  var state = {
    purpose: "login",        // 只有"login"一种用途，保留以兼容旧断言
    mode: "pw",              // 当前显示哪一屏：pw | code | register | verify | forgot | done
    codeId: "",              // 内核给的码记录 id（明文码不在盘上，只在下面这个变量里）
    code: "",                // 明文码，仅存在于本次会话的内存里
    sentTo: "",              // 掩码，用于回显「已发往 a***@b.com」
    expiresAt: 0,
    cooldown: 0,
    tick: null,
    /* 从 URL 里取来的那两个参数（/reset/ 那一页用同一个页面逻辑的另一半，见 js/reset.js） */
    regEmail: ""             // 注册时填的邮箱（确认那一屏要回显掩码）
  };

  function $(id) { return document.getElementById(id); }
  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }
  function text(el, s) { if (el) el.textContent = s == null ? "" : String(s); }

  /**
   * 「请查收」这一类落点的**唯一出口** —— 发信成不成，由它一处改口。
   *
   * 为什么必须收成一处：这句话原先在**三个地方各写各的**
   * （忘记密码 / 重发确认邮件 / 等确认那一屏），于是「发信商没配好」
   * 这件事只在**其中一处**说了出来 —— 另外两处照样让用户去收件箱等信。
   * 一句话在三处漂移，用户就会看到三种解释（Issue #197 里用户问的
   * 「到底哪个是真的」正是这样来的）。
   *
   * @param {string} sent   发信通了时说的话（含掩码回显）
   * @param {string} masked 掩码，用于「这一步只能由运维做，所以 a***@b.com 现在收不到信」
   * @returns {string}
   */
  function mailOutcome(sent, masked) {
    if (mailDelivered === false) return mailNotConfiguredNote(masked);
    return sent;
  }

  function showToast(msg) {
    var t = $("toast");
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { t.hidden = true; }, 2200);
  }

  /** 就地提示：等级 = "" | "warn" | "ok"，单独一处，免得各分支各写一遍 class */
  function msg(id, s, level) {
    var el = $(id);
    if (!el) return;
    el.textContent = s == null ? "" : String(s);
    el.className = "account-msg" + (level ? " " + level : "");
  }

  /**
   * 一块「结果」提示（`.account-note` 的 ok / warn 两个语气）。
   *
   * ⚠️ 它与 `msg()` 分工不同：`msg()` 是**表单字段旁边那一行**（说哪里填错了），
   *    这一块是**动作之后的结果**（说这件事成了没有）。
   *    合成一处的后果是「确认邮件没发出去」被塞进邮箱框下面那一行小字里 ——
   *    而它讲的其实不是邮箱的问题。
   */
  function note(id, s, level) {
    var el = $(id);
    if (!el) return;
    if (!s) { el.hidden = true; el.textContent = ""; return; }
    el.className = "account-note" + (level ? " " + level : "");
    el.textContent = String(s);
    el.hidden = false;
  }

  /**
   * 「发信商没配好」只有一个说法 —— **一处定义，三处引用**。
   *
   * 为什么必需：这一句在三个地方要说（注册完那一屏 / 快捷登录发了码 /
   * 忘记密码发了重设信），而它们原先各写各的。漂移的后果不是错别字，
   * 是**用户看到三种不同的解释**，然后来问「到底哪个是真的」——
   * 这正是 Issue #197 里用户问的那一句：「我在 resend 配了，还要去哪配？」
   *
   * ⚠️ 这句话回答的是**运维**（去哪把发信商接上），不是用户能做的事。
   *    所以它必须能被看懂，又不能被误读成「你哪里填错了」。
   *    真正的用户动作只有一件：找运维要码 / 等发信商配好。
   */
  function mailNotConfiguredNote(masked) {
    /* ⚠️ 文案里刻意**不写那个密钥的变量名** —— 页面是**任何访客都能读到的源码**，
       而「服务端密钥名不进前端」这一条有测试守着（test/api.test.js 那一节，
       闸门是拿这几个**名字本身**去扫全部前端文件的）。
       变量名不是密钥，但那条闸的价值正在于「一个名字都不许漏出来」；
       指路指到 doctor 的第 C 步已经足够具体。 */
    return "这台服务器还没接上发信商（现在是 console 通道：只往服务端日志写一行，不往外发信）。" +
      "要收信得请运维在托管平台的环境变量里补上发信密钥 —— 步骤：在终端跑 " +
      "`npm run doctor -- --steps`，第 C 步写的就是它" +
      "（托管平台环境变量填密钥 + 在 Resend 后台验发信子域 SPF/DKIM/DMARC 三条 DNS）。" +
      (masked ? "这一步只能由运维做，所以 " + masked + " 现在收不到信。" : "");
  }

  /* ------------------------------------------------------------ 人机校验 */

  /**
   * 六个挂载点 → 哪一屏用哪一块（Issue #197 后续）。
   *
   * ⚠️ 为什么**一个屏幕一块**而不是全局共用一块 widget：
   *    Turnstile 的 widget 只能住在**一个** DOM 位置上，而本页是
   *    「一次只显示一件动作」（见文件头那段）。共用一块的话，
   *    切屏时要么把 widget 搬来搬去（Cloudflare 不允许直接移动 iframe），
   *    要么让它留在一个已经 `hidden` 的屏里 —— 后者会让用户
   *    「看不见、但必须勾」而死在这一步。
   *
   * ⚠️ 六块**按需**渲染（切到哪一屏渲染哪一块），不是一次全渲染：
   *    一次渲染六个 widget = 六次第三方请求，而其中五个用户根本走不到。
   */
  var TS_SLOTS = {
    pw: "ts-pw",
    code: "ts-code",
    register: "ts-reg",
    forgot: "ts-forgot",
    verify: "ts-verify",
    unverified: "ts-unverified"
  };
  /* 挂过的不重复挂（Cloudflare 第二次 render 到同一个容器会叠一个） */
  var tsMounted = {};

  /**
   * 把某一屏的人机校验挂上去（幂等）。
   *
   * 没配 siteKey 时 `TS.mount` 会**立刻 resolve 而不做任何事**，
   * 于是这里的 `show(slot)` 也不会发生 —— 页面上那块一直是 `hidden`。
   * 这正是「不许摆一个空壳让人以为有人机校验」的落点。
   */
  function mountTurnstile(slotKey) {
    if (!TS || !TS.mount || !slotKey) return;
    var slotId = TS_SLOTS[slotKey];
    var el = slotId ? $(slotId) : null;
    if (!el) return;
    TS.mount(el, { siteKey: tsConfig.siteKey, enabled: tsConfig.enabled }).then(function (st) {
      /* ⚠️ 只在**真的渲染了**的时候摘掉 hidden —— 判据是 `configured`
         （拿到 siteKey 了），不是 `ready`（token 拿到了没有：
         用户可能还没勾，那是 `ready:false` 而 widget 已经在屏幕上了）。 */
      if (st && st.configured) show(el);
    });
  }

  /** 这一屏的人机校验必须先过（没过就返回 true，且已就地提示） */
  function turnstileBlocked(msgId) {
    if (!TS || !TS.gate) return false;
    var why = TS.gate();
    if (!why) return false;
    msg(msgId, why, "warn");
    return true;
  }

  /**
   * 每一次提交之后重置（无论成没成）。
   *
   * ⚠️ Turnstile 的 token **一次性**：不重置的下场是「第二次点按钮必失败」，
   *    而用户看到的是「人机校验没通过」—— 他会以为是自己做错了什么，
   *    然后一遍遍点，一遍遍失败。
   */
  function turnstileReset() {
    if (TS && TS.reset) { try { TS.reset(); } catch (e) { /* 没有 widget：空操作 */ } }
  }

  /**
   * 一屏一屏地切。**这是本页唯一的「画到哪一步」出口** ——
   * 别在别处直接 `hide/show` 面板，那种写法必然漏掉一两块（然后留下一个
   * 「上一步的提示还挂在屏幕上」的鬼影）。
   *
   * @param {string} mode  pw | code | register | verify | forgot | done
   */
  var MODES = ["pw", "code", "register", "verify", "unverified", "forgot", "done"];
  function setMode(mode) {
    if (MODES.indexOf(mode) < 0) mode = "pw";
    state.mode = mode;
    // 两个主路页签（只有 pw / code 两种；其余几屏是支路，页签不跟着动）
    var tabPw = $("tab-pw"), tabCode = $("tab-code");
    var isPw = mode === "pw" || mode === "register" || mode === "forgot";
    if (tabPw) tabPw.setAttribute("aria-selected", isPw ? "true" : "false");
    if (tabCode) tabCode.setAttribute("aria-selected", isPw ? "false" : "true");
    hide($("auth-tabs"));                       // 支路屏不摆页签
    if (mode === "pw" || mode === "code") show($("auth-tabs"));

    var panes = { pw: $("pane-pw"), code: $("pane-code"), register: $("pane-register"),
      verify: $("pane-verify"), forgot: $("pane-forgot") };
    Object.keys(panes).forEach(function (k) {
      var el = panes[k];
      if (!el) return;
      if (k === mode) show(el); else hide(el);
    });
    // 「已登录，补昵称」与「等你点确认」两屏住在 .account-step 里（不是页签之一）
    if (mode === "done") show($("step-done")); else hide($("step-done"));
    if (mode === "unverified") show($("step-unverified")); else hide($("step-unverified"));
    if (mode === "code") { show($("step-email")); hide($("step-code")); }
    /* 切到哪一屏，就把那一屏的人机校验挂上去（幂等；没配时它什么都不做）。
       ⚠️ `unverified` 那一屏不是 pane（它住在 .account-step 里），
          所以这里单独判一次 —— 漏掉它的症状是「那一屏的『重新发一封』
          永远过不了校验」，而用户正卡在那个死结里。 */
    if (TS && mode !== "done") mountTurnstile(mode);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ------------------------------------------------------------ 口令那一套 */

  /**
   * 把「需要服务端」这条路走通，或者**如实说不通**。
   *
   * ⚠️ 这是本页唯一回答「口令功能现在能不能用」的地方。
   *    在别处各写一遍 `if (api && !api.degraded())` 的下场是
   *    「注册那一颗按钮说能用、点了又说不能用」这种自相矛盾。
   *
   * @param {string} msgId 就地提示落在哪一行
   * @returns {object|null} 通道，或 null（已就地提示）
   */
  function passwordChannel(msgId) {
    if (!api) {
      msg(msgId, "这个站点没有连上服务器，暂时不能注册或改密码。你仍然可以用「快捷登录」的随机码进来。", "warn");
      return null;
    }
    return api;
  }

  /**
   * 口令那一栏旁边那颗「显示 / 隐藏」。
   *
   * ⚠️ 三个必须做对的细节：
   *   ① 它只切 `type`，**不复制那份值到别处**（复制一处就多一处泄露口）
   *   ② 切回隐藏时**不重排光标位置**（重排会让正在打字的用户丢掉输入点）
   *   ③ 按钮上的字跟着状态变（「显示」↔「隐藏」），且 `aria-label` 一起变 ——
   *      不然读屏用户听到的永远是「显示密码」，而他眼前是明文
   */
  function bindEye(btnId, inputId) {
    var btn = $(btnId), input = $(inputId);
    if (!btn || !input) return;
    btn.addEventListener("click", function () {
      var shown = input.type === "text";
      input.type = shown ? "password" : "text";
      btn.textContent = shown ? "显示" : "隐藏";
      btn.setAttribute("aria-label", shown ? "显示密码" : "隐藏密码");
    });
  }

  /* ------------------------------------------------------------ 六格输入框 */

  /**
   * 六格验证码。
   *
   * 三件必须做对的事（否则手机上会被骂）：
   *   · **整段粘贴**：从邮件里复制 6 位粘进任意一格，要自动铺满六格
   *   · **自动跳格**：输完一格跳下一格；退格时空格退到上一格
   *   · **合成一个值**：`value()` 把六格拼起来，内核只认这一个字符串
   * 用 `inputmode="numeric"` 而不是 `type="number"`：后者在 iOS 上会出
   * 上下微调箭头，且 `maxlength` 常常不生效。
   */
  function buildCodeRow(rowId) {
    var row = $(rowId);
    if (!row) return [];
    row.innerHTML = "";
    var boxes = [];
    for (var i = 0; i < A.CODE_LEN; i++) {
      var b = document.createElement("input");
      b.className = "code-box";
      b.type = "text";
      b.inputMode = "numeric";
      b.pattern = "[0-9]*";
      b.maxLength = 1;
      b.autocomplete = "one-time-code";     // iOS 能从短信/邮件里直接补全
      b.setAttribute("aria-label", "第 " + (i + 1) + " 位随机码");
      b.dataset.idx = String(i);
      row.appendChild(b);
      boxes.push(b);
    }
    row.addEventListener("input", function (e) {
      var el = e.target;
      if (!/^[0-9]?$/.test(el.value)) { el.value = el.value.replace(/\D/g, "").slice(-1); }
      el.classList.toggle("filled", !!el.value);
      var i = Number(el.dataset.idx);
      if (el.value && boxes[i + 1]) boxes[i + 1].focus();
    });
    row.addEventListener("keydown", function (e) {
      var el = e.target;
      var i = Number(el.dataset.idx);
      if (e.key === "Backspace" && !el.value && boxes[i - 1]) {
        boxes[i - 1].focus();
        boxes[i - 1].value = "";
        boxes[i - 1].classList.remove("filled");
        e.preventDefault();
      }
      if (e.key === "ArrowLeft" && boxes[i - 1]) { boxes[i - 1].focus(); e.preventDefault(); }
      if (e.key === "ArrowRight" && boxes[i + 1]) { boxes[i + 1].focus(); e.preventDefault(); }
      if (e.key === "Enter") { e.preventDefault(); verify(); }
    });
    row.addEventListener("paste", function (e) {
      var txt = (e.clipboardData || window.clipboardData).getData("text") || "";
      var digits = String(txt).replace(/\D/g, "").slice(0, A.CODE_LEN);
      if (!digits) return;
      e.preventDefault();
      setCode(boxes, digits);
    });
    return boxes;
  }

  function setCode(boxes, digits) {
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].value = digits[i] || "";
      boxes[i].classList.toggle("filled", !!boxes[i].value);
    }
    var last = Math.min(digits.length, boxes.length - 1);
    if (boxes[last]) boxes[last].focus();
  }

  function readCode(boxes) {
    return boxes.map(function (b) { return b.value || ""; }).join("").replace(/\D/g, "");
  }

  /* ------------------------------------------------------------ 倒计时 */

  /**
   * 每秒刷新两个数字：码的剩余有效期、重发的冷却。
   *
   * ⚠️ 时间**只从内核给的 expiresAt / 发码时刻算**，不在这里自己记一个
   *    「我什么时候发的」—— 那样刷新页面倒计时就断了（本页要能从 pending 恢复）。
   */
  function startTick(boxes) {
    stopTick();
    state.tick = setInterval(function () {
      if (!state.expiresAt) { stopTick(); return; }
      var left = Math.max(0, Math.round((state.expiresAt - Date.now()) / 1000));
      var mm = Math.floor(left / 60);
      var ss = String(left % 60).padStart(2, "0");
      text($("code-timer"), left > 0 ? "有效 " + mm + ":" + ss : "已过期，请重新发送");

      var cd = Math.max(0, Math.round((state.cooldown - Date.now()) / 1000));
      var again = $("btn-resend");
      if (again) {
        again.disabled = cd > 0;
        again.textContent = cd > 0 ? "重新发送（" + cd + "s）" : "重新发送";
      }
      if (!left && $("btn-verify")) $("btn-verify").disabled = false;
      void boxes;
    }, 1000);
  }

  function stopTick() {
    if (state.tick) { clearInterval(state.tick); state.tick = null; }
  }

  /* ============================================================ 注册 */

  /**
   * 注册那一条：**只在服务端**走（见 `passwordNeedsServer`）。
   *
   * 三件客户端先做的事（都能省下一次必然失败的请求）：
   *   ① 邮箱形状（用内核那一份规则，与服务端同源）
   *   ② 口令长度（与服务端 `checkPassword` 同一档，但**不替代**它 ——
   *      这里只是「早点说」，真正说了算的永远是服务端）
   *   ③ 两次口令一致
   */
  function onRegister() {
    var ch = passwordChannel("msg-reg");
    if (!ch) return;
    var email = (($("input-reg-email") || {}).value || "").trim();
    var pw = ($("input-reg-pw") || {}).value || "";
    var pw2 = ($("input-reg-pw2") || {}).value || "";

    if (!A.isEmailShape(A.normalizeEmail(email))) {
      msg("msg-reg", email ? A.ERR.E_EMAIL_FORMAT : A.ERR.E_EMAIL_EMPTY, "warn");
      return;
    }
    if (!pw) { msg("msg-reg", ch.messageOf("E_PW_EMPTY") || "请先填密码", "warn"); return; }
    if (pw.length < 8) { msg("msg-reg", "密码至少 8 位", "warn"); return; }
    if (pw !== pw2) { msg("msg-reg", "两次填的密码不一样", "warn"); return; }
    /* 人机校验：**在客户端先判一次**，只为省掉一次必然失败的请求。
       ⚠️ 它**不是**安全边界 —— 真判在服务端（`POST /api/register` 会再核一遍）。
          token 还没拿到的情形分两档：没配（放行）与「用户没勾」（拦住），
          这个区分由 `TS.gate()` 一处给出（见 js/turnstile.js 的 `gate`）。 */
    if (turnstileBlocked("msg-reg")) return;

    msg("msg-reg", "");
    return ch.register({ email: email, password: pw }).then(function (r) {
      /* token 一次性：无论成没成都作废（见 turnstileReset 的说明）。 */
      turnstileReset();
      // 口令这一栏用完就清 —— 它不该在屏幕上多留一秒
      if ($("input-reg-pw")) $("input-reg-pw").value = "";
      if ($("input-reg-pw2")) $("input-reg-pw2").value = "";
      if (!r.ok) {
        msg("msg-reg", r.message, "warn");
        return null;
      }
      state.regEmail = A.maskEmail(email);
      var vInput = $("input-verify-email");
      if (vInput) vInput.value = email;      // 重发那一屏要预填，省得用户再打一遍
      /* ⚠️ 「已发往」与「发出去了」是两件事。发信商没配（console 通道）时
         `verifySent` 为 false —— 那时**必须**如实写「没能发出去」，
         并把「重发」那颗按钮显眼地摆出来（§12 总原则：不许跑在代码前面）。 */
      /* ------------------------------------------------------------------
         注册完这一屏说什么，**取决于服务端拦不拦确认**（Issue #197 后半段）
         ------------------------------------------------------------------
         默认拦（用户 2026-09-16 裁决）：那这一屏的第一句话必须是
         「去收件箱点链接」，而不是任何形式的「先去用」——
         后者是一句用户照做会被 403 挡回来的假话。
         实测过的那种翻车正是这一处：界面上写「现在就可以回密码登录」，
         用户回过去，得到的是一句「邮箱还没确认」。
         ------------------------------------------------------------------ */
      var gated = r.requiresVerification === true;
      if (!gated) {
        /* 运维在这台服务器上关掉了闸（没配好发信商时的应急口径）。
           ⚠️ 这时**必须说出来**，否则用户以为自己已经通过了确认这套流程，
              而实际上这台服务器根本没有拦。与「如实标注」是同一条纪律。 */
        if (r.verifySent) {
          note("verify-fail-note", "这台服务器现在**没有**拦「邮箱没确认」——不点也能登录，确认只是为了将来能找回密码。", "warn");
          text($("verify-lead"), "确认邮件已发往 " + state.regEmail + "。");
        } else {
          text($("verify-lead"), "账号建好了。但这台服务器现在**没能把确认邮件发出去**（发信商还没配好）。");
          note("verify-fail-note", "这台服务器也没拦「邮箱没确认」：现在就可以回「密码登录」用刚才那个密码进来。", "warn");
        }
      } else if (r.verifySent) {
        note("verify-fail-note", "", "");
        text($("verify-lead"), "确认邮件已发往 " + state.regEmail + "。点开那条链接之后就能登录。");
        note("verify-fail-note", "**邮箱确认之后才能登录**：请现在去收件箱点开那条链接。", "warn");
      } else {
        /* 最糟的一格：既拦着，又发不出去。必须一次把两件事都说清 ——
           只说「账号建好了」等于把用户锁在门外还不告诉他门在哪。
           ⚠️ 两个分支在这里各改了一半，必须**同时**保留（Issue #197 前半 + 后半）：
              ① 这台服务器是**拦**确认的 → 不许写「不确认也能用」（那是被推翻的旧口径）；
              ② 发信商没配好 → 必须把**去哪补**说出来，否则用户只知道「发不出去」，
                 却不知道该找谁、改哪里。
           两句合起来才是这一格该说的话：「现在是拦着的 + 信发不出去 +
           钥匙要去哪插 + 唯一那条出路在下面那颗键」。
           ⚠️ 试了几次、为什么没成 —— 服务端如实带上（`verifyAttempts` / `verifyReason`）：
              带上它用户才知道「等一下再点重发」还是「这台服务器根本没配发信商」。 */
        var tries = Number(r.verifyAttempts) || 1;
        text($("verify-lead"), "账号建好了。但这台服务器现在**没能把确认邮件发出去**（已试 "
          + tries + " 次）。");
        note("verify-fail-note", "而这台服务器**要求邮箱确认之后才能登录**。" +
          mailNotConfiguredNote(state.regEmail) +
          " 请稍后点下面那颗「重发确认邮件」，或者联系站长先把发信商配好。", "warn");
      }
      showToast(r.created ? "账号已建好" : "账号信息已更新");
      setMode("verify");
      return r;
    }, function () {
      msg("msg-reg", "连不上服务器，请稍后再试", "warn");
    });
  }

  /* ============================================================ 口令登录 */

  function onLogin() {
    var ch = passwordChannel("msg-pw");
    if (!ch) return;
    var email = (($("input-pw-email") || {}).value || "").trim();
    var pw = ($("input-pw") || {}).value || "";
    if (!A.isEmailShape(A.normalizeEmail(email))) {
      msg("msg-pw", email ? A.ERR.E_EMAIL_FORMAT : A.ERR.E_EMAIL_EMPTY, "warn");
      return;
    }
    if (!pw) { msg("msg-pw", ch.messageOf("E_PW_EMPTY") || "请先填密码", "warn"); return; }
    /* ⚠️ 口令登录**服务端不挂人机校验**（它本来就有凭据：口令猜中才能过）。
       但页面上那一块 widget 是渲染着的（用户看得见），所以这里仍然
       判一次、也仍然重置 —— 界面上看得见的东西与它有没有被用上
       必须是同一件事，否则用户会问「我勾了这个为什么没用」。 */
    if (turnstileBlocked("msg-pw")) return;
    msg("msg-pw", "");
    return ch.login({ email: email, password: pw }).then(function (r) {
      turnstileReset();
      if ($("input-pw")) $("input-pw").value = "";
      if (!r.ok) {
        /* ⚠️ `E_LOGIN_FAIL` 的文案**原样用服务端那句**（「邮箱或密码不对」）。
           在客户端改写成「这个邮箱没注册过」就等于把全站用户名单
           变成可查询的事实 —— 这正是服务端刻意只说一句话的原因。 */
        /* ⚠️ `E_EMAIL_UNVERIFIED` **不走这一行** —— 它要的是一整屏
           「去点确认」（那一屏上有「重新发一封」的键），而不是输入框
           旁边一行小字。把它当普通错误处理的后果实测过：
           用户停在登录页反复点「登录」，因为屏幕上没有任何办法把信再来一封。 */
        if (r.code === "E_EMAIL_UNVERIFIED") { showUnverified(r); return null; }
        msg("msg-pw", r.message, "warn");
        return null;
      }
      // 服务端的账号形状与内核不同（多了 mask / email）→ 统一成内核那一套
      onSignedIn({
        account: {
          uid: r.account.uid,
          nickname: r.account.nickname || "",
          identities: [{ channel: "email", mask: r.account.mask || "" }],
          createdAt: 0, lastLoginAt: 1
        },
        remote: true,
        emailVerified: r.account.emailVerified === true
      });
      /* ⚠️ 这里**不再有**「邮箱没确认也放进来了」那个分支 —— 默认口径下
         服务端不会让这种会话签发（走上面那个 403 分支）。
         留着它等于留一条「万一服务端放行了，界面也装作没事」的暗路；
         而一个「点不点确认都一样」的界面，正是这道闸最容易被无声撤销的地方。 */
      return r;
    }, function () {
      msg("msg-pw", "连不上服务器，请稍后再试", "warn");
    });
  }

  /* ============================================================ 忘记密码 */

  function onForgotSend() {
    var ch = passwordChannel("msg-forgot");
    if (!ch) return;
    var email = (($("input-forgot-email") || {}).value || "").trim();
    if (!A.isEmailShape(A.normalizeEmail(email))) {
      msg("msg-forgot", email ? A.ERR.E_EMAIL_FORMAT : A.ERR.E_EMAIL_EMPTY, "warn");
      return;
    }
    if (turnstileBlocked("msg-forgot")) return;
    msg("msg-forgot", "");
    return ch.resetRequest({ email: email }).then(function (r) {
      turnstileReset();
      if (!r.ok) { msg("msg-forgot", r.message, "warn"); return null; }
      /* ⚠️ 这一句是**刻意的措辞**：「如果这个邮箱在本站注册过」。
         服务端回的也是同一个响应（不区分存在与否）—— 客户端要是写成
         「重设邮件已发往 xxx」，就等于替服务端回答了那个问题。
         那一句话把「谁是本站用户」变成可查询的事实（邮箱枚举）。 */
      /* ⚠️ 但「发出去了」有个前提：这台服务器得接上了发信商。
         没接上时上面那句话对**所有人**都是空的（谁都收不到），
         所以必须当场说出来 —— 措辞仍不许泄露邮箱存不存在，
         因为这条讲的完全是服务器的事。
         ⚠️ 判据取**两处服务端自报的合取**，而不是只看响应里那一个字段：
            `r.mailConfigured` 是这一条响应自带的，`mailDelivered` 是
            `GET /api/config` 那一份。两处都说「配好了」才敢写「已经发出去了」——
            少一处就退回如实那句（宁可多说一次「没接上」，也不许让人白等一封信）。 */
      var mailOk = (r.mailConfigured !== false) && mailDelivered !== false;
      if (mailOk) {
        msg("msg-forgot", "若该邮箱已注册，重设链接已发出。", "ok");
      } else {
        msg("msg-forgot", mailOutcome("若该邮箱已注册，重设链接已发出。", email), "warn");
      }
      showToast("请查收邮件");
      return r;
    }, function () {
      msg("msg-forgot", "连不上服务器，请稍后再试", "warn");
    });
  }

  /* ============================================================ 随机码 */

  /**
   * 发码（登录 / 注册同一件事）。
   *   · 服务端可用 → 走 `POST /api/send-code`（真发信，码在服务端）
   *   · 服务端没配好 / 连不上 → 回落内核的本机实现（「本地体验版」）
   *
   * ⚠️ 回落是**静默**的：连不上服务端不是用户的问题，
   *    不该弹一次错误、更不该打断他。界面上多一行如实说明即可。
   * ⚠️ 回落之后**绝不**把本机生成的码说成「已发送」。
   */
  function sendCode() {
    if (!store) { msg("msg-email", "浏览器不允许保存数据，本次登录刷新后会失效", "warn"); }
    var msgId = "msg-email";
    var email = (($("input-email") || {}).value || "").trim();

    var shaped = A.isEmailShape(A.normalizeEmail(email));
    if (!shaped) {
      msg(msgId, email ? A.ERR.E_EMAIL_FORMAT : A.ERR.E_EMAIL_EMPTY, "warn");
      return Promise.resolve(null);
    }

    if (api && !api.degraded()) return sendCodeRemote("login", email, msgId);
    return Promise.resolve(sendCodeLocal("login", email, msgId));
  }

  /** 服务端那条路 */
  function sendCodeRemote(purpose, email, msgId) {
    /* ⚠️ 人机校验只挂在**服务端那条路**上：本机体验版没有服务端，
       也就没有人机校验可谈（它的「码」本来就在本机生成）。 */
    if (turnstileBlocked(msgId)) return Promise.resolve(null);
    return api.sendCode({ email: email, purpose: purpose }).then(function (r) {
      turnstileReset();
      if (!r.ok) {
        if (r.code === "E_NOT_CONFIGURED" || r.code === "E_OFFLINE" || r.code === "E_TIMEOUT") {
          msg(msgId, r.message, "warn");
          return sendCodeLocal("login", email, msgId);
        }
        if (r.retryAfter) {
          state.cooldown = Date.now() + r.retryAfter * 1000;
          startTick(codeBoxes);
        }
        hideNotes();
        msg(msgId, r.message, "warn");
        return null;
      }
      state.purpose = "login";
      state.codeId = r.codeId;
      state.code = r.devCode || "";
      state.sentTo = A.maskEmail(email);
      state.expiresAt = r.expiresAt;
      state.cooldown = Date.now() + (r.cooldown || 60) * 1000;
      state.remote = true;
      return afterSent("login", r.delivered ? "已发往 " + state.sentTo : "已生成随机码，将发往 " + state.sentTo,
        r.delivered ? "验证码已发出" : "已生成随机码");
    });
  }

  /** 本机那条路（没有服务端，或它现在不可用） */
  function sendCodeLocal(purpose, email, msgId) {
    state.remote = false;
    var r = A.requestCode(store, { channel: "email", value: email }, purpose, { code: undefined });

    if (!r.ok) {
      if (r.retryAfter) { state.cooldown = Date.now() + r.retryAfter * 1000; startTick(codeBoxes); }
      msg(msgId, r.message, "warn");
      return null;
    }

    if (r.disposable) {
      msg(msgId, "这是临时邮箱，收不到后续邮件，可能丢失账号。仍可继续。", "warn");
    } else if (r.hint) {
      msg(msgId, r.hint, "warn");
    } else {
      msg(msgId, "");
    }
    state.remote = false;
    return afterSent(purpose, "随机码已生成，将发往 " + r.sentTo,
      r.isNewAccount ? "这是一封新账号的随机码" : "已生成随机码");
  }

  /**
   * 码已出去（或本机已生成）之后，两条路共用的收尾。
   * ⚠️ 合成一处，是为了「服务端版忘了一件事、本机版记住了」这类漂移不再可能。
   */
  function afterSent(purpose, sentToLine, toast) {
    showToast(toast);
    renderLocalOnlyTools();
    text($("code-sent-to"), sentToLine);
    setMode("code");
    hide($("step-email"));
    show($("step-code"));
    codeBoxes = buildCodeRow("code-row");
    setCode(codeBoxes, "");
    if (codeBoxes[0]) codeBoxes[0].focus();
    startTick(codeBoxes);
    return true;
  }

  /** 两块说明都收起来（发码还没决定走哪条路时用） */
  function hideNotes() {
    var localNote = $("local-note"), remoteNote = $("remote-note"), tools = $("code-tools");
    if (localNote) localNote.hidden = true;
    if (remoteNote) remoteNote.hidden = true;
    if (tools) tools.hidden = true;
  }

  function renderLocalOnlyTools() {
    var local = isLocal();
    var copy = $("btn-copy-code"), mailBtn = $("btn-mail-code");
    var tools = $("code-tools"), localNote = $("local-note"), remoteNote = $("remote-note");
    if (copy) copy.hidden = !local;
    if (mailBtn) mailBtn.hidden = !local;
    if (tools) tools.hidden = !local;
    if (localNote) localNote.hidden = !local;
    if (remoteNote) remoteNote.hidden = local;
  }

  var codeBoxes = [];

  function onSend() {
    return sendCode();
  }

  /* ------------------------------------------------------------ 校验（随机码） */

  function verify() {
    var digits = readCode(codeBoxes);
    if (digits.length < A.CODE_LEN) {
      msg("msg-code", "请填满 6 位随机码", "warn");
      return;
    }
    if (state.expiresAt && Date.now() > state.expiresAt) {
      msg("msg-code", A.ERR.E_CODE_EXPIRED, "warn");
      return;
    }
    if (state.remote) return verifyRemote(digits);

    var r = A.verifyCode(store, state.codeId, digits, state.purpose);
    if (!r.ok) {
      msg("msg-code", r.message, "warn");
      if (r.code === "E_CODE_VOID" || r.code === "E_CODE_USED") state.cooldown = 0;
      startTick(codeBoxes);
      return;
    }
    onSignedIn(r);
  }

  /** 服务端校验。会话由服务端通过 HttpOnly Cookie 签发，**JS 读不到 token** */
  function verifyRemote(digits) {
    return api.verifyCode({ codeId: state.codeId, code: digits }).then(function (r) {
      if (!r.ok) {
        if (r.code === "E_EMAIL_UNVERIFIED") {
          /* 与口令那条路同一个出口：这不是「码不对」，是「有出路的一件事」。
             界面上给出一颗「重发确认邮件」（匿名口，不需要登录）。 */
          text($("verify-lead"), "这个邮箱还没确认。");
          /* ⚠️ Issue #197：这句话三处各写一份会漂移，收成一句。
             用户要的是**下一步动作**，「先去收件箱点开」这半句是描述不是动作。 */
          note("verify-fail-note", "去收件箱点开确认邮件；没收到就点下面那颗重发。", "warn");
          setMode("verify");
          return;
        }
        if (r.code === "E_OFFLINE" || r.code === "E_TIMEOUT" || r.code === "E_NOT_CONFIGURED") {
          msg("msg-code", r.message, "warn");
          state.cooldown = 0;
          startTick(codeBoxes);
          return;
        }
        /* 码对的、邮箱没确认（Issue #197 后半段）→ 同样一整屏说清。
           ⚠️ 这一条**必须在 `E_CODE_*` 那一支之前判**：它是 403、不是 400，
              走到下面那一支会把「去点确认」说成「验证码不对」，而用户
              会一直在那儿重填那六位数字。 */
        if (r.code === "E_EMAIL_UNVERIFIED") { showUnverified(r); return; }
        msg("msg-code", r.message, "warn");
        if (r.code === "E_CODE_VOID" || r.code === "E_CODE_USED") state.cooldown = 0;
        startTick(codeBoxes);
        return;
      }
      onSignedIn({
        account: {
          uid: r.account.uid,
          nickname: r.account.nickname || "",
          identities: [{ channel: "email", mask: r.account.mask || "" }],
          createdAt: 0, lastLoginAt: 1
        },
        remote: true,
        emailVerified: r.account.emailVerified === true
      });
    });
  }

  /**
   * 登录成功（注册与登录走的是同一条路 —— 这正是邮箱码方案的省事之处）。
   */
  function onSignedIn(r) {
    stopTick();
    setMode("done");

    var isNew = !r.account.lastLoginAt || r.account.lastLoginAt === r.account.createdAt;
    text($("done-lead"), (isNew ? "账号已建好 · " : "已登录 · ") +
      (Ent ? Ent.tierLabel(Ent.identity().tier) : "Free") +
      " · " + (r.account.identities[0] ? r.account.identities[0].mask : ""));

    var nickInput = $("input-nickname");
    if (nickInput) {
      var cur = window.Avatar && Avatar.nickname ? Avatar.nickname(backing) : "";
      nickInput.value = cur || "";
      nickInput.focus();
    }
    /* ⚠️ 这一句只在**服务端**那条路上说。本机体验版说「进度已可跨设备同步」
       是假话（本机版根本没有跨设备这回事）—— 与 §12「不假装」同一条。 */
    if (r.remote) {
      showToast("登录成功：进度已可跨设备同步");
    } else if (r.isLocalOnly) {
      showToast("浏览器不允许保存数据：本次登录刷新后会失效");
    } else {
      showToast("登录成功（本机体验版）");
    }
  }

  function onFinish() {
    var v = ($("input-nickname") || {}).value || "";
    var clean = String(v).trim().slice(0, 12);
    if (window.Avatar && Avatar.saveNickname) {
      try { Avatar.saveNickname(backing, clean); } catch (e) { /* 隐私模式：不抛 */ }
    }
    if (A.setNickname && store) { try { A.setNickname(store, clean); } catch (e) { /* 昵称写不进不影响登录 */ } }
    location.href = "/profile/";
  }

  /* ------------------------------------------------------------ 邮箱没确认 */

  /**
   * 「口令对了 / 码也对了，但邮箱还没确认」——**切到「等确认」那一屏**。
   *
   * ## 为什么不是输入框旁边一行字
   * 这条路的下一步**不在这一页**（去收件箱），而且屏幕上必须有一个
   * 「信还是没收到」的出路（那颗「重新发一封」）。做成一行小字的后果
   * 实测过：用户停在登录页反复点「登录」，因为没有任何别的可点。
   *
   * ## 为什么是一个独立状态而不是复用 setMode("verify")
   * `setMode("verify")` 是**注册完**那一屏，它的文案里全是「账号建好了…」
   * ——对「回来登录但没确认」的人说「账号建好了」是一句错话（他早就建好了）。
   * 所以走 `.account-step` 里单独一块 `step-unverified`，与 `step-done` 同级。
   *
   * ⚠️ 进去时**停下倒计时**（`stopTick`）：这一屏与那个码没关系了，
   *    留着一个每秒跳动的「有效 3:12」会让人以为还要填什么。
   *
   * @param {object} r 服务端那一份响应（`message` / `emailMask` / `verifySent`）
   */
  function showUnverified(r) {
    stopTick();
    setMode("unverified");
    text($("unverified-lead"), r.message || "邮箱还没确认：请点开注册时那封确认邮件里的链接。");
    /* ⚠️ 「刚才这一下有没有真发出去」必须分开说 —— 实测过的那句翻车话是
       「确认邮件已发出」，而发信商是 console（真实用户收不到）。
       服务端把事实放在 `verifySent` 里，这里照它说。 */
    if (r.verifySent === true) {
      note("unverified-note", "我们又发了一封，发往 " + (r.emailMask || "你的邮箱") + "。", "ok");
    } else if (r.verifySent === false) {
      note("unverified-note", "这一次没有重复发信 —— 稍后点下面那颗「重新发一封」即可。", "");
    } else {
      note("unverified-note", "", "");
    }
    msg("msg-unverified", "");
    var lead = $("unverified-lead");
    if (lead) lead.focus && lead.focus();
  }

  /**
   * 那一屏的「重新发一封」。
   *
   * ⚠️ 它**必须能在没登录的情况下用**（这一屏上的人不可能登录着 ——
   *    登录正是被这道闸挡下来的那件事）。所以它走
   *    `POST /api/resend-verification` 之外的一条**匿名**路：
   *    服务端 `send-code` 那条「无论邮箱是否存在，响应完全一致」的纪律
   *    在 `resend` 上也必须成立，否则这里就成了一个邮箱枚举口
   *    （「没注册过 / 已确认过」两种回答能筛出全站用户名单）。
   */
  function onUnverifiedResend() {
    var ch = passwordChannel("msg-unverified");
    if (!ch) return;
    if (!ch.resendVerificationByEmail) {
      msg("msg-unverified", "这个页面是旧缓存，刷新一下再试", "warn");
      return;
    }
    var email = (($("input-pw-email") || {}).value || (($("input-email") || {}).value || "")).trim();
    if (!A.isEmailShape(A.normalizeEmail(email))) {
      msg("msg-unverified", "请回到登录那一屏填上邮箱，再点这颗键", "warn");
      return;
    }
    if (turnstileBlocked("msg-unverified")) return;
    msg("msg-unverified", "");
    return ch.resendVerificationByEmail({ email: email }).then(function (r) {
      turnstileReset();
      if (!r.ok) { msg("msg-unverified", r.message, "warn"); return null; }
      /* ⚠️ 文案与 `reset-request` 同一条纪律：**不说这个邮箱注册过没有**。
         服务端回的也是同一个形状（存在与否都一样）。 */
      if (r.alreadyVerified) {
        msg("msg-unverified", "这个邮箱已经确认过了，直接回「密码登录」进来即可。", "ok");
      } else if (r.verifySent) {
        msg("msg-unverified", "确认邮件已发往 " + (r.emailMask || "你的邮箱") + "。", "ok");
      } else {
        msg("msg-unverified", "这台服务器现在没能把邮件发出去（发信商还没配好），稍后再试。", "warn");
      }
      return r;
    }, function () {
      msg("msg-unverified", "连不上服务器，请稍后再试", "warn");
    });
  }

  /* ------------------------------------------------------------ 重发确认邮件 */

  /**
   * 重发确认邮件 —— **匿名也能点**（Issue #197 复审的那条出路）。
   *
   * ⚠️ 为什么它必须匿名可用：用户裁了「不确认就不让登录」，于是
   *    「注册完没点确认」的人**登不进来**。如果这颗键还要登录，
   *    他就被锁在门外、屏幕上没有任何可点的东西 —— 而重发确认邮件
   *    恰恰是他唯一需要的那件事。
   *
   * ⚠️ 匿名口是全站唯一「不登录也能让本站往外发信」的接口，所以服务端
   *    四条闸都上了（频控四层 + 冷却 + 存在与否回话逐字相同 + 已确认的不发信）。
   *    界面上**同样不许**把回复说得比事实更具体（不区分存在与否）。
   */
  function onResendVerify() {
    var ch = passwordChannel("msg-verify");
    if (!ch) return;
    if (!ch.resendVerification) {
      msg("msg-verify", "这个页面是旧缓存，刷新一下再试", "warn");
      return;
    }
    /* 邮箱从那一屏的输入框来（注册那一屏会预填）。已经登录的人留空 ——
       服务端认会话里的 uid，两条入口共用一套闸与一套文案。 */
    var emailInput = $("input-verify-email");
    var email = ((emailInput || {}).value || "").trim();
    var sess = A.session(store);
    var signedIn = !!(sess && sess.account);
    if (!signedIn && !email) {
      msg("msg-verify", "请先填邮箱", "warn");
      return;
    }
    if (turnstileBlocked("msg-verify")) return;
    msg("msg-verify", "");
    return ch.resendVerification(signedIn ? {} : { email: email }).then(function (r) {
      turnstileReset();
      if (!r.ok) { msg("msg-verify", r.message, "warn"); return null; }
      if (r.alreadyVerified) {
        msg("msg-verify", "这个邮箱已经确认过了，不用再发。", "ok");
        return r;
      }
      /* ⚠️ 这里同样不许写「已发出」—— 只写「发往哪」+ 如实标出成没成。
         ⚠️ 匿名口回的 `verifySent` 与生俱来就是 false（服务端刻意不泄露
         「有没有这个人」），所以那一支里**不能说「发信商没配好」** ——
         那是一个我们**不知道**的结论（「不存在」与「存在但没配好」回话逐字相同）。
         正确的说法是那三档分别对应的那一句话：
           真发了 / 没发（而且我们知道自己是谁）/ 不知道（匿名）。
         ⚠️ 判据是「登录态」而不是「`verifySent` 的真假」—— 后者会把
            匿名那一支错说成「发信商没配好」。 */
      if (signedIn && r.verifySent) {
        msg("msg-verify", mailOutcome(
          "确认邮件已发往 " + (r.emailMask || state.regEmail) + "。",
          r.emailMask || state.regEmail), mailDelivered === false ? "warn" : "ok");
      } else if (signedIn) {
        /* ⚠️ 试了几次 —— 服务端如实带上（`verifyAttempts`）。 */
        msg("msg-verify", "这台服务器现在没能把邮件发出去（已试 " + (Number(r.verifyAttempts) || 1)
          + " 次）。稍后再试。", "warn");
      } else {
        /* ⚠️ 匿名那一支**不许说「发信商没配好」**（上面那一段说明写着同样的理由）：
           服务端刻意让「存在」与「不存在」回话逐字相同，我们不知道这个邮箱在不在。
           `mailOutcome` 说的却是**服务器**的事（与邮箱无关），所以这里用它**不泄露**枚举；
           但只有在如实知道「这台服务器发不出信」时才改口。 */
        msg("msg-verify", mailDelivered === false
          ? mailNotConfiguredNote("")
          : "若该邮箱已注册且未确认，确认邮件已发出。",
          mailDelivered === false ? "warn" : "ok");
      }
      return r;
    }, function () {
      msg("msg-verify", "连不上服务器，请稍后再试", "warn");
    });
  }

  /* ------------------------------------------------------------ 信任期 */

  /**
   * 信任期内一点即入（30 天），不发码。
   *
   * ⚠️ 信任期那一条按钮**只对本机会话有意义**。走服务端登录的人，
   *    会话在 HttpOnly Cookie 里，页面上没有「信任」这件事可谈 ——
   *    所以服务端可用时它一并交给服务端会话的过期规则去管，
   *    这里仍然沿用内核的本机信任期（两条不冲突，各管各的）。
   */
  function renderTrust() {
    var acc = A.trustedAccount(store);
    var panel = $("trust-panel");
    if (!acc) { hide(panel); return; }
    var mask = (acc.identities[0] && acc.identities[0].mask) || "";
    var btn = $("btn-trust");
    if (btn) btn.textContent = "继续以 " + mask + " 进入";
    show(panel);
  }

  function onTrust() {
    var r = A.signInTrusted(store);
    if (!r.ok) { msg("msg-email", r.message, "warn"); hide($("trust-panel")); return; }
    onSignedIn({ account: r.account, isLocalOnly: !store.persistent() });
  }

  /* ------------------------------------------------------------ 本地体验版的工具 */

  function onCopyCode() {
    var code = state.code || "";
    if (!code) { showToast("请先发送随机码"); return; }
    var done = function () { showToast("随机码已复制，请自己保管好"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done, function () { showToast("复制失败，请手动抄下：" + code); });
    } else {
      showToast("请手动抄下：" + code);
    }
  }

  function onMailCode() {
    var code = state.code || "";
    if (!code) { showToast("请先发送随机码"); return; }
    var subject = "【跬步】登录随机码 " + code;
    var body = "跬步登录随机码：" + code + "\n有效期 10 分钟，仅能使用一次。\n"
      + "这是「本地体验版」：本站没有服务器，这封邮件由你自己发出、自己保管。";
    window.location.href = "mailto:?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  }

  /* ------------------------------------------------------------ 初始化 */

  var inited = false;
  function init() {
    if (inited) return;              // 幂等：兜底重跑时不再挂第二遍监听
    inited = true;
    if (!A || !store) {
      msg("msg-email", "账号内核没有加载成功，请刷新页面重试", "warn");
      return;
    }
    renderTrust();

    /* ---- 先把「要不要人机校验」问清楚（Issue #197 后续）----
       ⚠️ 它在**任何一次挂载之前**跑，而且失败**不拦**：
          拿不到配置 = 与「服务端没配」同样的表现（不渲染、不拦），
          真闸在服务端。把「拉配置失败」做成一个错误弹窗的下场是
          一次 CDN 抖动就让登录页看起来坏掉了。 */
    if (TS && api && api.config) {
      api.config().then(function (r) {
        if (!r || !r.ok) return;
        /* 发信商配好了没有 —— 与「人机校验那一个」取自**同一次**调用，
           不为它多发一个请求（这一条是全局唯一一个匿名可打的读接口）。 */
        if (r.mail && typeof r.mail.delivered === "boolean") mailDelivered = r.mail.delivered;
        if (!r.turnstile) return;
        tsConfig.enabled = r.turnstile.enabled === true;
        tsConfig.siteKey = r.turnstile.siteKey || "";
        /* 配置一到就补挂当前那一屏（init 里 setMode 可能跑在它前面） */
        if (tsConfig.enabled) mountTurnstile(state.mode);
      }, function () { /* 拿不到就保持「没配」那一档（也**不许**据此说「发信商没配好」） */ });
    }

    // 页签：切动作，不跳页
    $("tab-pw").addEventListener("click", function () { setMode("pw"); msg("msg-pw", ""); });
    $("tab-code").addEventListener("click", function () { setMode("code"); msg("msg-email", ""); });

    // 口令那两屏
    $("btn-login").addEventListener("click", onLogin);
    $("btn-register").addEventListener("click", onRegister);
    $("btn-forgot-send").addEventListener("click", onForgotSend);
    $("btn-resend-verify").addEventListener("click", onResendVerify);
    $("btn-unverified-resend").addEventListener("click", onUnverifiedResend);
    $("btn-unverified-back").addEventListener("click", function () { setMode("pw"); });
    $("btn-go-register").addEventListener("click", function () { setMode("register"); msg("msg-reg", ""); });
    $("btn-forgot").addEventListener("click", function () { setMode("forgot"); msg("msg-forgot", ""); });
    $("btn-back-login").addEventListener("click", function () { setMode("pw"); });
    $("btn-back-login2").addEventListener("click", function () { setMode("pw"); });
    $("btn-back-login3").addEventListener("click", function () { setMode("pw"); });
    /* 「等确认」那一屏左下那颗**返回登录**。⚠️ 它**不再**是「先去用」——
       默认口径下不确认就是登不进来，摆一颗点进去被 403 挡回来的按钮
       等于教用户去做一件做不到的事（见 login/index.html 里那段注释）。 */
    var later = $("btn-verify-later");
    if (later) later.addEventListener("click", function () { setMode("pw"); });
    bindEye("btn-pw-eye", "input-pw");
    bindEye("btn-reg-eye", "input-reg-pw");

    // 随机码那一屏
    $("btn-send").addEventListener("click", onSend);
    $("btn-edit-email").addEventListener("click", function () {
      hide($("step-code"));
      show($("step-email"));
      stopTick();
      msg("msg-code", "");
      msg("msg-email", "");
    });
    $("btn-resend").addEventListener("click", onSend);
    $("btn-verify").addEventListener("click", verify);
    $("btn-finish").addEventListener("click", onFinish);
    $("btn-trust").addEventListener("click", onTrust);
    $("btn-trust-other").addEventListener("click", function () {
      hide($("trust-panel"));
      setMode("pw");
    });
    $("btn-copy-code").addEventListener("click", onCopyCode);
    $("btn-mail-code").addEventListener("click", onMailCode);

    // 回车即提交（三个口令输入框各绑一次；邮箱框走「回车发码」）
    [["input-pw-email", onLogin], ["input-pw", onLogin],
      ["input-reg-email", onRegister], ["input-reg-pw", onRegister], ["input-reg-pw2", onRegister],
      ["input-forgot-email", onForgotSend],
      ["input-email", onSend]].forEach(function (pair) {
      var el = $(pair[0]);
      if (!el) return;
      el.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); pair[1](); }
      });
    });

    // 已登录：不必再走一遍流程，直接把他送回账号页
    var sess = A.session(store);
    if (sess && sess.account) {
      onSignedIn({ account: sess.account, isLocalOnly: !store.persistent() });
      return;
    }
    setMode("pw");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* 给测试用的出口：**只暴露读，不暴露写** —— 写一律经由按钮事件 */
  window.LoginPage = {
    state: state,
    MODES: MODES,
    buildCodeRow: buildCodeRow,
    readCode: readCode,
    setCode: setCode,
    sendCode: sendCode,
    setMode: setMode,
    isLocal: isLocal,
    passwordNeedsServer: passwordNeedsServer,
    esc: esc
  };
})();
