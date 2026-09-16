/**
 * 发信适配层：**业务代码只认这一个出口**。
 *
 *   await mail.send({ to, mask, subject, text, html })
 *
 * 三个实现（**顺序不代表主备**，主备由配置决定）：
 *   · resend   — 当前主选（免费档 100 封/天、3000 封/月）
 *   · sendgrid — 历史备选：2026-09-16 起 SendGrid 转向收费，用户改用 Resend
 *                （Issue #159），因此它只在「你另有 SendGrid 付费账号」时才配
 *   · console  — **只在没配任何密钥时兜底**：不发信，把码打到服务端日志
 *
 * 为什么要有 console：docs §4.6 第 1 条要求「未登录用户的体验与今天逐字一致」。
 * 没配发信密钥时，登录功能本来就该是「未启用」，而不是 500。
 * console 让本地开发与 CI 也能走完整链路，**但它产出的码只在服务端日志里**，
 * 所以配置校验会明确告知「当前是 console 模式，真实用户收不到信」。
 *
 * ⚠️ 换发信商**不改任何业务代码** —— 这正是 docs/auth-design.md §11
 *    那句「只换 transport」的意思。
 */
"use strict";

var http = require("http");
var https = require("https");

/** 极小的 HTTPS POST：不引 SDK（一个 SDK 换两行 header 不值得多一个依赖） */
function postJson(url, headers, body) {
  return new Promise(function (resolve, reject) {
    var u = new URL(url);
    var payload = Buffer.from(JSON.stringify(body), "utf8");
    var req = https.request({
      method: "POST",
      hostname: u.hostname,
      path: u.pathname + (u.search || ""),
      headers: Object.assign({
        "Content-Type": "application/json",
        "Content-Length": payload.length
      }, headers)
    }, function (res) {
      var chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () {
        var text = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve({ status: res.statusCode, text: text });
        var err = new Error("mail " + res.statusCode + ": " + text.slice(0, 300));
        err.status = res.statusCode;
        reject(err);
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/* ------------------------------------------------------------- 邮件正文 */

/**
 * 验证码邮件正文。**只有一处** —— 两个通道共用，
 * 免得「SendGrid 版写了一句、Resend 版漏了一句」。
 */
function buildMessage(cfg, opts) {
  var minutes = Math.round(cfg.codeTtlMs / 60000);
  var subject = "【跬步】登录验证码 " + opts.code;
  var text = [
    "你的验证码是：" + opts.code,
    "",
    minutes + " 分钟内有效，用过一次即失效。",
    "如果不是你本人操作，忽略这封邮件即可 —— 你的账号不会有任何变化。",
    "",
    "跬步 · 积跬步，至千里",
    cfg.siteUrl
  ].join("\n");
  // 纯文本为主：邮件客户端对 HTML 的过滤规则多变，验证码只需一封能读的信
  var html = [
    '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.7;color:#2b2b2b">',
    '<p>你的验证码是：</p>',
    '<p style="font-size:28px;letter-spacing:6px;font-weight:700;color:#2f6055">' + opts.code + '</p>',
    '<p style="color:#666;font-size:13px">' + minutes + ' 分钟内有效，用过一次即失效。<br>',
    '如果不是你本人操作，忽略这封邮件即可 —— 你的账号不会有任何变化。</p>',
    '<p style="color:#666;font-size:13px">跬步 · 积跬步，至千里<br>',
    '<a href="' + cfg.siteUrl + '" style="color:#2f6055">' + cfg.siteUrl + "</a></p>",
    "</div>"
  ].join("");
  return { subject: subject, text: text, html: html };
}

/**
 * 确认邮件正文（Issue #197）。与验证码邮件**分开**两封，不合成一封。
 *
 * 为什么不合成：确认邮件的动作是「点一条链接」，验证码的动作是「抄六个数字」。
 * 一封邮件里同时给这两样，用户会分不清该做哪一件 —— 而两件事的后果
 * 完全不同（一个是确认邮箱，一个是登录）。
 *
 * ⚠️ 链接里带着**一次性令牌**，所以：
 *   · 正文里**不重复打印**令牌（用户只需要点链接）
 *   · 不加任何跟踪像素、不外链图片（一封邮件不该是一次数据外发）
 */
function buildConfirm(cfg, opts) {
  var hours = Math.round((opts.ttlMs || 86400000) / 3600000);
  var url = link(cfg, "verify", opts);
  var subject = "【跬步】确认你的邮箱";
  var text = [
    "点下面这条链接确认你的邮箱：",
    "",
    url,
    "",
    hours + " 小时内有效，用过一次即失效。",
    "确认之后，你才能在忘记密码时用它重设密码。",
    "如果不是你本人操作，忽略这封邮件即可 —— 你的账号不会有任何变化。",
    "",
    "跬步 · 积跬步，至千里",
    cfg.siteUrl
  ].join("\n");
  return { subject: subject, text: text, html: shell(
    "<p>点下面这颗按钮确认你的邮箱：</p>" + button(url, "确认邮箱") +
    "<p style=\"color:#666;font-size:13px\">" + hours + " 小时内有效，用过一次即失效。<br>" +
    "确认之后，你才能在忘记密码时用它重设密码。<br>" +
    "如果不是你本人操作，忽略这封邮件即可 —— 你的账号不会有任何变化。</p>", cfg) };
}

/**
 * 重设密码邮件正文（Issue #197）。
 *
 * 这一封的措辞与其它几封**刻意不同**：它必须说清「不是你点的话要小心」，
 * 因为收到一封没申请过的重设邮件，是「有人知道你的邮箱」的第一个信号。
 */
function buildReset(cfg, opts) {
  var minutes = Math.round((opts.ttlMs || 3600000) / 60000);
  var url = link(cfg, "reset", opts);
  var subject = "【跬步】重设密码";
  var text = [
    "点下面这条链接重设密码：",
    "",
    url,
    "",
    minutes + " 分钟内有效，用过一次即失效。",
    "重设之后，你在其它设备上的登录会全部退出。",
    "如果不是你本人操作，别点这条链接，也请考虑换一个更结实的密码。",
    "",
    "跬步 · 积跬步，至千里",
    cfg.siteUrl
  ].join("\n");
  return { subject: subject, text: text, html: shell(
    "<p>点下面这颗按钮重设密码：</p>" + button(url, "重设密码") +
    "<p style=\"color:#666;font-size:13px\">" + minutes + " 分钟内有效，用过一次即失效。<br>" +
    "重设之后，你在其它设备上的登录会全部退出。<br>" +
    "如果不是你本人操作，别点这条链接，也请考虑换一个更结实的密码。</p>", cfg) };
}

/**
 * 链接的**唯一一处拼装**。
 *
 * ⚠️ 站点根地址取 `cfg.siteUrl`，**不取请求头里的 Host**：
 *    Host 是请求方可以随手改的，而这条链接会进用户邮箱 ——
 *    拿它拼链接等于把「重置密码去哪」交给任何一个能发包的人。
 */
function link(cfg, kind, opts) {
  var base = String(cfg.siteUrl || "").replace(/\/+$/, "");
  if (kind === "verify") {
    return base + "/verify/?vid=" + encodeURIComponent(opts.vid || "") +
      "&token=" + encodeURIComponent(opts.token || "");
  }
  return base + "/reset/?rid=" + encodeURIComponent(opts.rid || "") +
    "&token=" + encodeURIComponent(opts.token || "");
}

/** 邮件外壳：与验证码那封同一套观感（一处定义，几个模板共用） */
function shell(inner, cfg) {
  return [
    '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.7;color:#2b2b2b">',
    inner,
    '<p style="color:#666;font-size:13px">跬步 · 积跬步，至千里<br>',
    '<a href="' + cfg.siteUrl + '" style="color:#2f6055">' + cfg.siteUrl + "</a></p>",
    "</div>"
  ].join("");
}

function button(href, label) {
  return '<p><a href="' + href + '" style="display:inline-block;padding:10px 18px;' +
    'background:#2f6055;color:#fff;border-radius:8px;text-decoration:none">' + label + "</a></p>" +
    '<p style="color:#666;font-size:12px;word-break:break-all">' + href + "</p>";
}

/* --------------------------------------------------------------- 通道 */

var transports = {};

transports.sendgrid = function (cfg) {
  return {
    name: "sendgrid",
    configured: function () { return !!cfg.sendgridKey; },
    send: function (msg) {
      return postJson("https://api.sendgrid.com/v3/mail/send", {
        Authorization: "Bearer " + cfg.sendgridKey
      }, {
        personalizations: [{ to: [{ email: msg.to }] }],
        from: { email: cfg.mailFrom, name: cfg.mailFromName },
        subject: msg.subject,
        content: [
          { type: "text/plain", value: msg.text },
          { type: "text/html", value: msg.html }
        ]
      }).then(function (r) { return { ok: true, transport: "sendgrid", status: r.status, id: r.text || null }; });
    }
  };
};

transports.resend = function (cfg) {
  return {
    name: "resend",
    configured: function () { return !!cfg.resendKey; },
    send: function (msg) {
      return postJson("https://api.resend.com/emails", {
        Authorization: "Bearer " + cfg.resendKey
      }, {
        from: cfg.mailFromName + " <" + cfg.mailFrom + ">",
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        html: msg.html
      }).then(function (r) {
        var id = null;
        try { id = JSON.parse(r.text).id; } catch (e) { id = null; }
        return { ok: true, transport: "resend", status: r.status, id: id };
      });
    }
  };
};

/**
 * console：**不发信**，也**不打码**。
 *
 * 只记一行「本该发往谁」，供本地开发确认链路走到了哪一步。
 * ⚠️ 这里**刻意不打印明文码** —— docs §4.3 第 1 条是
 *    「明文验证码不进任何日志（含错误上报、监控、console.log）」，
 *    而这条纪律最容易在「反正是本地开发」的借口下破掉，
 *    破了之后同一个 log 函数在生产也会照打。
 *    要看码请显式开 ALLOW_CODE_ECHO=1 从接口响应里取（那条路明写「仅冒烟用」）。
 */
transports.console = function (cfg) {
  return {
    name: "console",
    configured: function () { return true; },
    devOnly: true,
    send: function (msg) {
      console.log("[mail:console] 未配置发信商，验证码未向外发送 → 收件人 " + (msg.mask || "***") +
        "（明文码不回给调用方，也**不打印**；要看码请开 ALLOW_CODE_ECHO=1）");
      return Promise.resolve({ ok: true, transport: "console", delivered: false });
    }
  };
};

/* --------------------------------------------------------- 短信（口子） */

/**
 * 短信通道的**空壳**（2B：只留口子，不接任何短信商）。
 *
 * 为什么这里不写一个「调腾讯云/阿里云」的实现：
 *   1. 没签短信商就没有密钥，写了也是死代码 —— 而**死代码会被当成"已经支持"**
 *   2. 短信要求签名 + 模板报备（3~7 工作日），模板 ID 现在根本不存在；
 *      凭空写一个 SMS_TEMPLATE_ID 只会让人以为填上就能用
 *   3. 真正开通时要做的第一件事是「选商 + 报备 + 定模板」，
 *      那是产品动作，不是往这个文件里加 20 行
 *
 * 所以：`sms` 被显式选中时，它**如实失败** ——
 * 「未接入短信商」是当前的事实，不是错误。sendCode 会把它翻成
 * `E_SMS_NOT_OPEN`（503），绝不假装「短信已发送」。
 * 将来接入时：实现 transports.<商名>，把 cfg.smsTransport 指过去，本文件之外的
 * 业务代码一行都不用改（这正是 §8「只换 transport」那句话的兑现）。
 */
transports.sms = function (cfg) {
  return {
    name: "sms",
    configured: function () { return false; },   // 还没接入任何短信商
    notImplemented: true,
    send: function () {
      return Promise.reject(new Error("SMS channel not implemented: 尚未接入短信商（需签名 + 模板报备）"));
    }
  };
};

/** 取通道：显式指定的优先，否则按「有哪个密钥用哪个」推，最后落到 console */
function pick(cfg) {
  var want = cfg.mail ? cfg.mail() : "console";
  // 短信通道：**默认关**。cfg.smsTransport 显式指定了商名才走它，
  // 否则落到 transports.sms 的空壳（它会如实失败）。
  if (want === "sms") {
    var svc = cfg.smsTransport;
    if (svc && transports[svc]) return transports[svc](cfg);
    return transports.sms(cfg);
  }
  var t = transports[want] ? transports[want](cfg) : transports.console(cfg);
  return t;
}

/**
 * 对外的唯一出口。
 *
 * @param {object} cfg   CONFIG
 * @param {object} opts  { to, mask, code }
 * @returns {Promise<{ok,transport,delivered}>}
 */
function send(cfg, opts) {
  var t = pick(cfg);
  var msg = buildMessage(cfg, opts);
  msg.to = opts.to;
  msg.mask = opts.mask;
  msg.code = opts.code;
  return t.send(msg).then(function (r) {
    return {
      ok: true,
      transport: r.transport,
      delivered: r.transport !== "console",
      status: r.status || null,
      id: r.id || null
    };
  });
}

/**
 * 通用出口：`sendKind(cfg, kind, opts)`。
 *
 * ⚠️ 三种邮件（登录码 / 确认邮箱 / 重设密码）走**同一个** `transports` 与
 *    同一个 `delivered` 判定 —— 这一点很重要，因为「发信商配没配」
 *    是环境的事，与发的是哪一封无关。四个出口各判一遍的下场是
 *    「登录码能发出去、确认邮件发不出去」，而用户完全无从理解为什么。
 */
function sendKind(cfg, kind, opts) {
  var t = pick(cfg);
  var msg = kind === "verify" ? buildConfirm(cfg, opts)
    : kind === "reset" ? buildReset(cfg, opts)
      : buildMessage(cfg, opts);
  msg.to = opts.to;
  msg.mask = opts.mask;
  msg.code = opts.code;
  if (opts.vid) msg.vid = opts.vid;
  if (opts.rid) msg.rid = opts.rid;
  return t.send(msg).then(function (r) {
    return {
      ok: true,
      transport: r.transport,
      /* ⚠️ 「发出去了」这件事**只由通道决定**，不由「接口回没回 200」决定。
         console 通道下 delivered 必须是 false —— 它是「没往外发」的通道，
         界面据此写「没能发出」而不是「已发出」（§12 总原则）。 */
      delivered: r.transport !== "console",
      status: r.status || null,
      id: r.id || null
    };
  });
}

/** 确认邮件 */
function confirm(cfg, opts) {
  var o = Object.assign({}, opts);
  if (!o.vid) o.vid = "";
  return sendKind(cfg, "verify", o);
}

/** 重设密码邮件 */
function reset(cfg, opts) {
  var o = Object.assign({}, opts);
  if (!o.rid) o.rid = "";
  return sendKind(cfg, "reset", o);
}

module.exports = {
  send: send,
  confirm: confirm,
  reset: reset,
  sendKind: sendKind,
  pick: pick,
  buildMessage: buildMessage,
  buildConfirm: buildConfirm,
  buildReset: buildReset,
  link: link,
  transports: transports
};
