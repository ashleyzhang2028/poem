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
   * 一屏一屏地切。**这是本页唯一的「画到哪一步」出口** ——
   * 别在别处直接 `hide/show` 面板，那种写法必然漏掉一两块（然后留下一个
   * 「上一步的提示还挂在屏幕上」的鬼影）。
   *
   * @param {string} mode  pw | code | register | verify | forgot | done
   */
  var MODES = ["pw", "code", "register", "verify", "forgot", "done"];
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
    // 「已登录，补昵称」那一屏住在 .account-step 里（不是页签之一）
    if (mode === "done") show($("step-done")); else hide($("step-done"));
    if (mode === "code") { show($("step-email")); hide($("step-code")); }
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

    msg("msg-reg", "");
    return ch.register({ email: email, password: pw }).then(function (r) {
      // 口令这一栏用完就清 —— 它不该在屏幕上多留一秒
      if ($("input-reg-pw")) $("input-reg-pw").value = "";
      if ($("input-reg-pw2")) $("input-reg-pw2").value = "";
      if (!r.ok) {
        msg("msg-reg", r.message, "warn");
        return null;
      }
      state.regEmail = A.maskEmail(email);
      text($("verify-lead"), "确认邮件已发往 " + state.regEmail + "。");
      /* ⚠️ 「已发往」与「发出去了」是两件事。发信商没配（console 通道）时
         `verifySent` 为 false —— 那时**必须**如实写「没能发出去」，
         并把「重发」那颗按钮显眼地摆出来（§12 总原则：不许跑在代码前面）。 */
      if (r.verifySent) {
        note("verify-fail-note", "", "");
        text($("verify-lead"), "确认邮件已发往 " + state.regEmail + "。");
      } else {
        text($("verify-lead"), "账号建好了。但这台服务器现在**没能把确认邮件发出去**（发信商还没配好）。");
        note("verify-fail-note", "不确认也能用：现在就可以回「密码登录」用刚才那个密码进来。确认是为了将来能找回密码。", "warn");
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
    msg("msg-pw", "");
    return ch.login({ email: email, password: pw }).then(function (r) {
      if ($("input-pw")) $("input-pw").value = "";
      if (!r.ok) {
        /* ⚠️ `E_LOGIN_FAIL` 的文案**原样用服务端那句**（「邮箱或密码不对」）。
           在客户端改写成「这个邮箱没注册过」就等于把全站用户名单
           变成可查询的事实 —— 这正是服务端刻意只说一句话的原因。 */
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
      /* 邮箱没确认时**顺手给他留一句**（不拦他进去，只让他知道）。
         不在这里弹一次确认：「先去用，稍后再确认」是这一页明确给的路。 */
      if (r.account.emailVerified !== true) {
        showToast("登录成功；邮箱还没确认（确认后才能找回密码）");
      }
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
    msg("msg-forgot", "");
    return ch.resetRequest({ email: email }).then(function (r) {
      if (!r.ok) { msg("msg-forgot", r.message, "warn"); return null; }
      /* ⚠️ 这一句是**刻意的措辞**：「如果这个邮箱在本站注册过」。
         服务端回的也是同一个响应（不区分存在与否）—— 客户端要是写成
         「重设邮件已发往 xxx」，就等于替服务端回答了那个问题。
         那一句话把「谁是本站用户」变成可查询的事实（邮箱枚举）。 */
      msg("msg-forgot", "如果这个邮箱在本站注册过，重设链接已经发出去了。", "ok");
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
    return api.sendCode({ email: email, purpose: purpose }).then(function (r) {
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
        if (r.code === "E_OFFLINE" || r.code === "E_TIMEOUT" || r.code === "E_NOT_CONFIGURED") {
          msg("msg-code", r.message, "warn");
          state.cooldown = 0;
          startTick(codeBoxes);
          return;
        }
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

  /* ------------------------------------------------------------ 重发确认邮件 */

  function onResendVerify() {
    var ch = passwordChannel("msg-verify");
    if (!ch) return;
    if (!ch.resendVerification) {
      msg("msg-verify", "这个页面是旧缓存，刷新一下再试", "warn");
      return;
    }
    msg("msg-verify", "");
    return ch.resendVerification().then(function (r) {
      if (!r.ok) { msg("msg-verify", r.message, "warn"); return null; }
      if (r.alreadyVerified) {
        msg("msg-verify", "这个邮箱已经确认过了，不用再发。", "ok");
        return r;
      }
      /* ⚠️ 这里同样不许写「已发出」—— 只写「发往哪」+ 如实标出成没成 */
      if (r.verifySent) msg("msg-verify", "确认邮件已发往 " + (r.emailMask || state.regEmail) + "。", "ok");
      else msg("msg-verify", "这台服务器现在没能把邮件发出去（发信商还没配好）。稍后再试。", "warn");
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

    // 页签：切动作，不跳页
    $("tab-pw").addEventListener("click", function () { setMode("pw"); msg("msg-pw", ""); });
    $("tab-code").addEventListener("click", function () { setMode("code"); msg("msg-email", ""); });

    // 口令那两屏
    $("btn-login").addEventListener("click", onLogin);
    $("btn-register").addEventListener("click", onRegister);
    $("btn-forgot-send").addEventListener("click", onForgotSend);
    $("btn-resend-verify").addEventListener("click", onResendVerify);
    $("btn-go-register").addEventListener("click", function () { setMode("register"); msg("msg-reg", ""); });
    $("btn-forgot").addEventListener("click", function () { setMode("forgot"); msg("msg-forgot", ""); });
    $("btn-back-login").addEventListener("click", function () { setMode("pw"); });
    $("btn-back-login2").addEventListener("click", function () { setMode("pw"); });
    $("btn-verify-later").addEventListener("click", function () { setMode("pw"); });
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
