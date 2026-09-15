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
 *   1. **不假装有服务器**：有服务端时真的走服务端（`js/auth-api.js`），
 *      没有（没配好 / 连不上 / 断网）才回落本机，并如实标注
 *      「本地体验版」，绝不写成「邮件已发出」（docs/auth-design.md §7.1）
 *      —— 1A 期之前只有一个「本机」分支，现在多了一个**真服务端**分支，
 *      两条路的判据只有一处：`api.degraded()`
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

  /* 本页状态（**不进 localStorage**：它只是「这一屏画到哪一步」） */
  var state = {
    purpose: "login",        // 本期只有登录一种用途
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

  /**
   * 发码（登录 / 注册同一件事）。
   *   · 服务端可用 → 走 `POST /api/send-code`（真发信，码在服务端）
   *   · 服务端没配好 / 连不上 → 回落内核的本机实现（「本地体验版」）
   *
   * ⚠️ 回落是**静默**的：连不上服务端不是用户的问题，
   *    不该弹一次错误、更不该打断他。界面上多一行如实说明即可。
   * ⚠️ 回落之后**绝不**把本机生成的码说成「已发送」——
   *    这正是 docs/auth-design.md §7.1 那条「不假装有服务器」。
   */
  function sendCode() {
    if (!store) { msg("msg-email", "浏览器不允许保存数据，本次登录刷新后会失效", "warn"); }
    var inputId = "input-email";
    var msgId = "msg-email";
    var email = (($(inputId) || {}).value || "").trim();

    // 先按内核的规矩就地校验一遍：格式错的邮箱**不用**打扰服务端
    // （也就不会因为一次手滑消耗掉服务端的一格频控额度）
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
        // 服务端不可用（没配好 / 断网 / 超时）→ 静默回落本机，用户无感
        if (r.code === "E_NOT_CONFIGURED" || r.code === "E_OFFLINE" || r.code === "E_TIMEOUT") {
          msg(msgId, r.message, "warn");
          return sendCodeLocal("login", email, msgId);
        }
        if (r.retryAfter) {
          state.cooldown = Date.now() + r.retryAfter * 1000;
          startTick(codeBoxes);
        }
        // 服务端明确回绝（频控 / 格式错）：这一屏**还没决定**走哪条路，
        // 两块说明都收起来 —— 摆着「本机体验版」而实际是服务端在管，
        // 等于给用户一个错的解释。
        hideNotes();
        msg(msgId, r.message, "warn");
        return null;
      }

      // 服务端不回明文码（除非开了冒烟模式），所以 state.code 留空 ——
      // 界面因此**不会**出现「抄下这串码」那一块，这是对的
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
    var r = A.requestCode(store, { channel: "email", value: email }, purpose, {
      // ⚠️ 本机版：码由浏览器生成。这是「本地体验版」的全部含义，
      //    界面必须如实标注，不能与真发信混为一谈。
      code: undefined
    });

    if (!r.ok) {
      // 冷却 / 频控：把「还要等多久」如实说出来，并照内核给的秒数起倒计时
      if (r.retryAfter) { state.cooldown = Date.now() + r.retryAfter * 1000; startTick(codeBoxes); }
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
    state.remote = false;
    return afterSent(purpose, "随机码已生成，将发往 " + r.sentTo,
      r.isNewAccount ? "这是一封新账号的随机码" : "已生成随机码");
  }

  /**
   * 码已出去（或本机已生成）之后，两条路共用的收尾：
   * 换屏、清空输入格、起倒计时、给一句 toast。
   * ⚠️ 合成一处，是为了「服务端版忘了一件事、本机版记住了」这类漂移不再可能。
   */
  function afterSent(purpose, sentToLine, toast) {
    showToast(toast);
    // 本地体验版那两块「复制码 / 自己发信」的按钮只在真·本机版出现
    renderLocalOnlyTools();
    text($("code-sent-to"), sentToLine);
    hide($("step-email"));
    show($("step-code"));
    hide($("step-done"));
    codeBoxes = buildCodeRow("code-row");
    setCode(codeBoxes, "");
    if (codeBoxes[0]) codeBoxes[0].focus();
    startTick(codeBoxes);
    return true;
  }

  /**
   * 「复制码 / 用邮件发给自己」这两颗按钮只在**本机版**画出来。
   * 服务端版里码在用户邮箱里，摆这两颗按钮是自相矛盾的
   * （既没有码可复制，也不该让用户「自己发给自己」）。
   */
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
    if (tools) tools.hidden = !local;          // 一整行都收起来，不留空档
    if (localNote) localNote.hidden = !local;
    // ⚠️ 两个说明**互斥**：本机版不许出现「进度会上传到服务器」，
    //    服务端版也不许出现「本应用没有服务器」——
    //    任一情况下摆错一句，都等于对用户说谎（docs §1 第 3 条）。
    if (remoteNote) remoteNote.hidden = local;
  }

  var codeBoxes = [];

  function onSend() {
    return sendCode();
  }

  /* ------------------------------------------------------------ 校验 */

  /**
   * 校验码。与发码一样是**两条路**：
   *   · `state.remote` 为真 → 走 `POST /api/verify-code`（服务端签会话 Cookie）
   *   · 否则 → 内核的本机实现
   *
   * ⚠️ 判据用 `state.remote`（**这一次发码走的是哪条路**），
   *    而不是 `api.degraded()`：发码成功之后网络再抖一下，
   *    用 degraded 判就会把「服务端发出去的码」拿到本机去校验 —— 必然失败，
   *    而用户看到的是「验证码不对」，完全无从排查。
   */
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
      // 码作废（错满 5 次 / 已用过）→ 让「重新发送」立刻可点，别让用户在那儿等
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
          // 校验这一步**不能**静默回落本机：服务端发出去的码，
          // 本机根本没有记录，回落只会给出一个必然错的结论。
          // 如实说「连不上」，并让「重新发送」保持可点。
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
      // 服务端的账号形状与内核不同（多了 mask、少了 identities）——
      // 统一成内核那一套再交给 onSignedIn，免得下游要判两种形状
      onSignedIn({
        account: {
          uid: r.account.uid,
          nickname: r.account.nickname || "",
          identities: [{ channel: "email", mask: r.account.mask || "" }],
          createdAt: 0, lastLoginAt: 1
        },
        remote: true
      });
    });
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
    /* 一行收场：是新建还是登录 + 层级 + 记在哪个邮箱。
       ⚠️ 「进度会上传」那一句**不在这里**：它属于收码屏那块 #remote-note
          （那里是用户点「确定」当场同意的地方），这一屏再说一遍是重复。 */
    text($("done-lead"), (isNew ? "账号已建好 · " : "已登录 · ") +
      (Ent ? Ent.tierLabel(Ent.identity().tier) : "Free") +
      " · " + (r.account.identities[0] ? r.account.identities[0].mask : ""));

    // 昵称：先把已有的填上（老用户回来了，别让他以为名字丢了）
    var nickInput = $("input-nickname");
    if (nickInput) {
      var cur = window.Avatar && Avatar.nickname ? Avatar.nickname(backing) : "";
      nickInput.value = cur || "";
      nickInput.focus();
    }
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
    // 昵称写账号域（poem_profile_v1）+ 老键镜像，收在 Avatar.saveNickname 一处
    if (window.Avatar && Avatar.saveNickname) {
      try { Avatar.saveNickname(backing, clean); } catch (e) { /* 隐私模式：不抛 */ }
    }
    if (A.setNickname && store) { try { A.setNickname(store, clean); } catch (e) { /* 昵称写不进不影响登录 */ } }
    // 回到**个人中心**（Issue #132 · D）：登录完最该看见的是「我是谁、
    // 现在能用什么」——那张权限清单就在这里。落回设置页要多绕一层，
    // 而且设置页是「调机器」的地方，不是「看自己」的地方。
    // 与顶栏返回键的落点（data-back="/profile/"）同一条动线，不出现两条。
    location.href = "/profile/";
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
