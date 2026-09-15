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
 * 三条刻意的做法：
 *   1. **不假装有服务器**：本期没有后端，码由本机生成，界面如实标注
 *      「本地体验版」，绝不写成「邮件已发出」（docs/auth-design.md §7.1）
 *   2. **错误码→文案只映射一次**：内核返回的 `message` 就是给用户看的话，
 *      本页**不重写一份**。重写就意味着「内核改了口径、界面还是老话」。
 *   3. **只读不写**：本页只碰 `poem_auth_v1`（会话/码）与 `poem_profile_v1`
 *      （昵称），**一个字节都不写进度键** —— 有测试守着（只读页面不写盘）。
 */
(function () {
  "use strict";

  var A = window.AuthCore;
  var Ent = window.Entitlement;

  /* 存储：内核的标准配件。隐私模式下内核会自己降级为内存会话 */
  var backing = null;
  try { backing = window.localStorage; } catch (e) { backing = null; }
  var store = A && A.makeStore ? A.makeStore(backing) : null;

  /* 本页状态（**不进 localStorage**：它只是「这一屏画到哪一步」） */
  var state = {
    purpose: "login",        // login | reset
    codeId: "",              // 内核给的码记录 id（明文码不在盘上，只在下面这个变量里）
    code: "",                // 明文码，仅存在于本次会话的内存里
    sentTo: "",              // 掩码，用于回显「已发往 a***@b.com」
    expiresAt: 0,
    cooldown: 0,
    tick: null
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

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
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

  /* ------------------------------------------------------------ 发码 */

  function sendCode(purpose) {
    if (!store) { msg(purpose === "login" ? "msg-email" : "msg-reset", "浏览器不允许保存数据，本次登录刷新后会失效", "warn"); }
    var inputId = purpose === "login" ? "input-email" : "input-reset-email";
    var msgId = purpose === "login" ? "msg-email" : "msg-reset";
    var email = (($(inputId) || {}).value || "").trim();

    var r = A.requestCode(store, { channel: "email", value: email }, purpose, {
      // ⚠️ 本期没有服务端，码只能由本机生成 —— 这是「本地体验版」的全部含义。
      //    有服务端之后这一个参数就删掉，改成等接口返回。
      code: undefined
    });

    if (!r.ok) {
      // 冷却 / 频控：把「还要等多久」如实说出来，并照内核给的秒数起倒计时
      if (r.retryAfter) {
        if (purpose === "login") { state.cooldown = Date.now() + r.retryAfter * 1000; startTick(codeBoxes); }
      }
      msg(msgId, r.message, "warn");
      return null;
    }

    // 提示一次性邮箱：**只提示不阻断**（挡的是真用户，挡不住有心人）
    if (r.disposable) {
      msg(msgId, "这是临时邮箱，收不到后续邮件，可能丢失账号。仍可继续。", "warn");
    } else if (r.hint) {
      msg(msgId, r.hint, "warn");           // 域名级错别字（gmial.com 这类）
    } else {
      msg(msgId, "");
    }
    return r;
  }

  var codeBoxes = [];

  function onSend() {
    var r = sendCode("login");
    if (!r) return;
    state.purpose = "login";
    state.codeId = r.codeId;
    state.code = r.code;
    state.sentTo = r.sentTo;
    state.expiresAt = r.expiresAt;
    state.cooldown = Date.now() + r.cooldown * 1000;

    text($("code-sent-to"), "随机码已生成，将发往 " + r.sentTo);
    hide($("step-email"));
    show($("step-code"));
    hide($("step-done"));
    codeBoxes = buildCodeRow("code-row");
    setCode(codeBoxes, "");
    if (codeBoxes[0]) codeBoxes[0].focus();
    startTick(codeBoxes);
    // 本地体验版：**不写成「已发送」** —— 没有服务器，发不出去
    showToast(r.isNewAccount ? "这是一封新账号的随机码" : "已生成随机码");
  }

  /* ------------------------------------------------------------ 校验 */

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
    var r = A.verifyCode(store, state.codeId, digits, state.purpose);
    if (!r.ok) {
      msg("msg-code", r.message, "warn");
      // 码作废（错满 5 次 / 已用过）→ 让「重新发送」立刻可点，别让用户在那儿等
      if (r.code === "E_CODE_VOID" || r.code === "E_CODE_USED") state.cooldown = 0;
      startTick(codeBoxes);
      return;
    }
    onSignedIn(r);
  }

  /**
   * 登录成功（注册与登录走的是同一条路 —— 这正是邮箱码方案的省事之处）。
   *
   * 这里**不做**「本机进度 vs 账号进度」的合并：本期没有服务端，账号数据也
   * 只在本机，两边其实是同一份。真正的合并策略（§9 的 A~E 场景，含
   * 「弹选择」）属于接服务端的那一期，接口已由 `AuthCore.mergePolicy` 留好。
   * 现在假装做了合并，反而是给用户一个假的承诺。
   */
  function onSignedIn(r) {
    stopTick();
    hide($("step-email"));
    hide($("step-code"));
    show($("step-done"));

    var isNew = !r.account.lastLoginAt || r.account.lastLoginAt === r.account.createdAt;
    text($("done-lead"), (isNew ? "账号已在本机建好。" : "登录成功。") +
      "层级 " + (Ent ? Ent.tierLabel(Ent.identity().tier) : "Free") +
      "，记在 " + (r.account.identities[0] ? r.account.identities[0].mask : "") + "。");

    // 昵称：先把已有的填上（老用户回来了，别让他以为名字丢了）
    var nickInput = $("input-nickname");
    if (nickInput) {
      var cur = window.Avatar && Avatar.nickname ? Avatar.nickname(backing) : "";
      nickInput.value = cur || "";
      nickInput.focus();
    }
    if (r.isLocalOnly) {
      showToast("浏览器不允许保存数据：本次登录刷新后会失效");
    } else {
      showToast("登录成功");
    }
  }

  function onFinish() {
    var v = ($("input-nickname") || {}).value || "";
    var clean = String(v).trim().slice(0, 12);
    // 昵称写账号域（poem_profile_v1）+ 老键镜像，收在 Avatar.saveNickname 一处
    if (window.Avatar && Avatar.saveNickname) {
      try { Avatar.saveNickname(backing, clean); } catch (e) { /* 隐私模式：不抛 */ }
    }
    if (A.setNickname && store) { try { A.setNickname(store, clean); } catch (e) { /* 昵称写不进不影响登录 */ } }
    // 回到设置页：账号那一项在「通用」里，用户接着能看到自己的状态
    location.href = "/settings/general/";
  }

  /* ------------------------------------------------------------ 信任期 */

  /**
   * 信任期内一点即入（30 天），不发码。
   *
   * 这是「每次都要去邮箱拿码」的代价补偿 —— 但信任期**不等于永久会话**：
   * 会话仍然会过期，那时还是要收码（docs §6.3）。
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

  /* ------------------------------------------------------------ 重设凭证 */

  function onResetSend() {
    var r = sendCode("reset");
    if (!r) return;
    state.purpose = "reset";
    state.codeId = r.codeId;
    state.code = r.code;
    state.sentTo = r.sentTo;
    state.expiresAt = r.expiresAt;
    var boxes = buildCodeRow("reset-code-row");
    show($("reset-code-row"));
    show($("btn-reset-verify"));
    if (boxes[0]) boxes[0].focus();
    msg("msg-reset", "随机码已生成，将发往 " + r.sentTo + "（与登录的码不通用）");
  }

  function onResetVerify() {
    var boxes = Array.prototype.slice.call($("reset-code-row").querySelectorAll("input"));
    var digits = readCode(boxes);
    if (digits.length < A.CODE_LEN) { msg("msg-reset", "请填满 6 位随机码", "warn"); return; }
    var r = A.resetCredential(store, state.codeId, digits);
    if (!r.ok) { msg("msg-reset", r.message, "warn"); return; }
    hide($("reset-code-row"));
    hide($("btn-reset-verify"));
    msg("msg-reset", "已重设。这台设备与其他设备上的登录都已结束，请用上面的邮箱重新登录。", "ok");
    state.purpose = "login";
    renderTrust();          // 信任期已清，那一条会自己收起来
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

  function init() {
    if (!A || !store) {
      msg("msg-email", "账号内核没有加载成功，请刷新页面重试", "warn");
      return;
    }
    // 已登录：不必再走一遍流程，直接把他送回账号页
    var sess = A.session(store);
    renderTrust();

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
      show($("step-email"));
    });
    $("btn-reset-send").addEventListener("click", onResetSend);
    $("btn-reset-verify").addEventListener("click", onResetVerify);
    $("btn-copy-code").addEventListener("click", onCopyCode);
    $("btn-mail-code").addEventListener("click", onMailCode);

    var emailInput = $("input-email");
    if (emailInput) {
      emailInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); onSend(); }
      });
    }

    // 已登录时把「登录」这一块收起来 —— 别让已登录的人再走一遍登录流程
    if (sess && sess.account) {
      onSignedIn({ account: sess.account, isLocalOnly: !store.persistent() });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* 给测试用的出口：**只暴露读，不暴露写** —— 写一律经由按钮事件 */
  window.LoginPage = {
    state: state,
    buildCodeRow: buildCodeRow,
    readCode: readCode,
    setCode: setCode,
    sendCode: sendCode,
    esc: esc
  };
})();
