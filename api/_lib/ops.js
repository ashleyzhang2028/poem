/**
 * 开通自检与配置清单（Issue #132 · 2 期 2C）
 * ==========================================================================
 * 2A 把 `/api/me` 与注销接上、2B 把短信 channel 的口子做成真能跑的代码。
 * 于是「能不能真的发信 / 真的同步」只剩一件事：**环境变量配上没有**。
 * 那一件事在本项目里是唯一「没有业务代码可写」的一步（docs/architecture.md §4.10
 * 「下一步（2D：配置与真开通，代码一个字不用改）」）—— 但**没有代码可写 ≠ 没有东西可做**。
 *
 * 这个文件做的是那一件事的**可执行版本**：
 *
 *   1. 把「哪些变量、各自什么用、缺了会怎样」写成一份**代码里的清单**——
 *      清单和校验读的是**同一份数据**，所以「文档说缺 X、程序说缺 Y」这种
 *      分叉不可能发生（文档在本项目里已经漂移过好几次，见 docs/auth-design.md
 *      里那些「已落地 / 未落地」的标注）。
 *   2. 给出一份 `.env.example` 的**唯一来源**：脚本生成，不手抄。
 *   3. 让「现在到底缺哪几个」可以在**不部署**的情况下问出来（`./scripts/doctor.sh`）。
 *
 * ## 三条口径（与 1A 立的边界同源）
 *
 * 1. **只报「缺」与「怎么补」，不报密码** —— 输出里不许出现任何密钥的值。
 *    这一条是硬性的：自检脚本最容易被贴进 Issue 或聊天窗口。
 * 2. **区分「必须」与「可选」** —— 缺 `SESSION_SECRET` 是**必须**（不配则接口整体 503）；
 *    缺 `SENDGRID_API_KEY` 只是「发不出真信」，本站照样能跑（console 兜底）。
 *    把两类混成一张「缺 6 项」的表，用户会以为不配齐就用不了。
 * 3. **不假装** —— 检查只回答事实，不做「已尽力」这类判断。
 *    `ok:false` 就是 `ok:false`，与 2B 的 `E_SMS_NOT_OPEN` 是同一条纪律。
 *
 * ⚠️ 本文件不 import 任何第三方包，可在 Node 里直接 require（见 test/api.test.js）。
 */
"use strict";

/**
 * 每一项配置的说明。
 *
 * `level` 三种取值：
 *   · "required" —— 缺了就**起不来**（接口整体 503 / 会话签不出来）
 *   · "needed"   —— 缺了「这一件事」做不成，但别的事照常（例：不发真信）
 *   · "optional" —— 有它更好，没有也行（例：改站名）
 *
 * `secret: true` 的项在**任何输出**里都不出现值，只出现「已设置 / 未设置」。
 */
var ENTRY = [
  {
    key: "SESSION_SECRET",
    level: "required",
    group: "会话",
    secret: true,
    what: "会话 Cookie 的签名密钥（至少 16 个字符）",
    missing: "缺它时 /api/* 一律回 503 E_NOT_CONFIGURED —— 「未开放」是如实回答，不是坏掉",
    how: "生成一串随机字符（openssl rand -hex 32），填进托管平台的环境变量"
  },
  {
    key: "SUPABASE_URL",
    level: "required",
    group: "数据库",
    secret: false,
    what: "Supabase 项目的 URL（形如 https://xxxx.supabase.co）",
    missing: "缺它时自动降级为**内存存储**：本实例重启即丢账号与进度（进程内的假象）",
    how: "Supabase 建项目 → Project Settings → API → Project URL"
  },
  {
    key: "SUPABASE_SERVICE_KEY",
    level: "required",
    group: "数据库",
    secret: true,
    what: "Supabase 的 service_role key（**只在服务端**，绝不进浏览器）",
    missing: "同 SUPABASE_URL：降级为内存存储",
    how: "Supabase → Project Settings → API → service_role（不是 anon）"
  },
  {
    key: "MAIL_TRANSPORT",
    level: "optional",
    group: "发信",
    secret: false,
    what: "发信通道：sendgrid | resend | console（缺省按「有哪个密钥用哪个」推）",
    missing: "不填也能跑：自动落到 console —— **真实用户收不到信**，只往服务端日志写一行",
    how: "二选一填 sendgrid / resend；本地开发不必填"
  },
  {
    key: "SENDGRID_API_KEY",
    level: "needed",
    group: "发信",
    secret: true,
    what: "SendGrid 的 API key（主选通道）",
    missing: "发不出真邮件；登录链接验证码只能走 ALLOW_CODE_ECHO 冒烟模式手动取",
    how: "SendGrid → Settings → API Keys → 建一枚 Mail Send 权限的 key"
  },
  {
    key: "RESEND_API_KEY",
    level: "optional",
    group: "发信",
    secret: true,
    what: "Resend 的 API key（备选通道，与 SendGrid 只备其一）",
    missing: "不影响：SendGrid 能用就用 SendGrid",
    how: "Resend → API Keys"
  },
  {
    key: "MAIL_FROM",
    level: "optional",
    group: "发信",
    secret: false,
    what: "发信人地址（默认 noreply@mail.kuibu.app）",
    missing: "用默认值；但**域名没做 SPF/DKIM/DMARC 时会被判垃圾邮件**",
    how: "在发信商后台验证域名 → 按提示加 SPF / DKIM / DMARC 三条 DNS 记录"
  },
  {
    key: "MAIL_FROM_NAME",
    level: "optional",
    group: "发信",
    secret: false,
    what: "发信人显示名（默认「跬步」）",
    missing: "用默认值",
    how: "照实填"
  },
  {
    key: "SITE_URL",
    level: "optional",
    group: "站点",
    secret: false,
    what: "站点对外地址（默认 https://kuibu.app），写进邮件正文",
    missing: "用默认值",
    how: "填你自己的域名"
  },
  {
    key: "COOKIE_NAME",
    level: "optional",
    group: "会话",
    secret: false,
    what: "会话 Cookie 的名字（默认 kbsid）",
    missing: "用默认值",
    how: "同域部署多站点时才需要改"
  },
  {
    key: "SMS_ENABLED",
    level: "optional",
    group: "短信",
    secret: false,
    what: "是否允许尝试短信通道（SMS_ENABLED=1 才是「允许」）",
    missing: "默认 0 / 关闭。**开了也不等于能发** —— 还要 SMS_TRANSPORT 指向已实现的商",
    how: "签了短信商 + 模板报备通过之后再开（3~7 工作日，日历时间）"
  },
  {
    key: "SMS_TRANSPORT",
    level: "optional",
    group: "短信",
    secret: false,
    what: "短信商的名字（指向 api/_lib/mail/index.js 里已实现的 transports.<名>）",
    missing: "没有实现可指：只开开关不接商，请求**仍然是 503 E_SMS_NOT_OPEN**（2B 的核心口径）",
    how: "先签商 + 模板报备，再实现 transports.<商名>；在此之前这一项**不填**"
  },
  {
    key: "ALLOW_CODE_ECHO",
    level: "optional",
    group: "冒烟",
    secret: false,
    what: "把明文验证码随响应回给调用方（**只给冒烟自测用**）",
    missing: "默认关闭。生产**绝不许开** —— 开了等于把验证码送给任何调接口的人",
    how: "本地联调临时开；上线前确认它是 0"
  }
];

/** 出厂口径：`hasDb` / `hasSession` / `mail()` 是**唯一的**判定处（见 config.js） */
var TIER_TEXT = {
  required: "必须",
  needed: "这一件需要",
  optional: "可选"
};

/** 一个值算不算「设了」（空串与纯空格都不算 —— 托管平台的空变量很常见） */
function isSet(v) {
  return !(v === undefined || v === null || String(v).trim() === "");
}

function valueOf(cfg, key) {
  if (!cfg) return undefined;
  return cfg[key];
}

/**
 * 体检：只回答「哪些设了、哪些没设、缺了会怎样」，**不出现任何值**。
 *
 * @param {object} cfg   CONFIG（或测试里造的同形状对象）
 * @returns {object}     { ok, groups, missing, blocking, notes }
 *   · ok       —— 达到「能真跑」的最低线：会话可签 + 有库
 *   · missing  —— 没设的项（**只给 key 与说明，不给值**）
 *   · blocking —— 其中会把功能挡死的（required）
 *   · delivery —— 发信这一件到底能不能成（派生口径，与 config.mail() 同源）
 */
function check(cfg) {
  var items = ENTRY.map(function (e) {
    var set = isSet(valueOf(cfg, e.key));
    return {
      key: e.key, level: e.level, group: e.group, secret: !!e.secret,
      set: set, what: e.what, missing: e.missing, how: e.how
    };
  });

  var missing = items.filter(function (i) { return !i.set; });
  var blocking = missing.filter(function (i) { return i.level === "required"; });

  /* 派生口径一律**问 config 自己的函数**，不在这里重算一遍 —— 重算一份的后果是
     「自检说能发、真跑起来落到 console」这类假绿（config.mail() 的注释里写着同一条教训）。 */
  var hasSession = typeof cfg.hasSession === "function" ? !!cfg.hasSession() : isSet(cfg.sessionSecret);
  var hasDb = typeof cfg.hasDb === "function" ? !!cfg.hasDb() : (isSet(cfg.supabaseUrl) && isSet(cfg.supabaseServiceKey));
  var mail = typeof cfg.mail === "function" ? cfg.mail() : "console";
  var smsEnabled = cfg.smsEnabled === true;
  var smsTransport = isSet(cfg.smsTransport) ? cfg.smsTransport : null;

  var notes = [];
  if (!hasSession) notes.push("缺 SESSION_SECRET：所有 /api/* 会回 503 —— 本站仍可完全离线使用（这是设计好的降级，不是坏掉）");
  if (hasSession && !hasDb) notes.push("会话可签但没配库：账号与进度只活在**当前实例的内存**里，重启即丢");
  if (mail === "console") notes.push("当前发信通道是 console：真实用户**收不到**验证码邮件（本地开发与 CI 正是靠它跑完整链路）");
  if (smsEnabled && !smsTransport) notes.push("SMS_ENABLED=1 但没接短信商：请求仍是 503 E_SMS_NOT_OPEN（这是 2B 定死的口径，不是 bug）");
  if (smsTransport) notes.push("SMS_TRANSPORT 指向了 " + smsTransport + "：请确认 api/_lib/mail/index.js 里真的实现了它，否则投递会以 E_SMS_FAIL 失败");

  return {
    ok: hasSession && hasDb,
    hasSession: hasSession,
    hasDb: hasDb,
    mail: mail,
    smsReady: !!(smsEnabled && smsTransport),
    items: items,
    missing: missing,
    blocking: blocking,
    notes: notes
  };
}

/**
 * 渲染成给**人看**的一小段文字（自检脚本与 Issue 评论都用它）。
 *
 * ⚠️ 只输出 key 与「已设置 / 未设置」，`secret` 项连长度都不报 ——
 *    长度是密钥信息的一半。这段文字是可以直接贴进 Issue 的，这条规矩就是为那件事定的。
 */
function report(cfg) {
  var r = check(cfg);
  var lines = [];
  lines.push(r.ok ? "✅ 最低线已过：会话可签 + 数据库已配（能真跑）"
    : "⚠️ 还没到「能真跑」的最低线（缺 " + r.blocking.map(function (i) { return i.key; }).join("、") + "）");
  lines.push("");
  lines.push("发信通道：" + r.mail + (r.mail === "console" ? "（用户收不到信，只写服务端日志）" : ""));
  lines.push("短信通道：" + (r.smsReady ? "已接商 " + cfg.smsTransport : "未开通（如实回 503，不假装发短信）"));
  lines.push("");
  lines.push("-- 已设置的项 --");
  r.items.filter(function (i) { return i.set; }).forEach(function (i) {
    lines.push("  [" + (i.secret ? "已设置" : "有值") + "] " + i.key + "（" + i.group + "）" + i.what);
  });
  var un = r.items.filter(function (i) { return !i.set; });
  lines.push("");
  lines.push("-- 未设置的项 --");
  if (!un.length) lines.push("  （无）");
  un.forEach(function (i) {
    lines.push("  [" + TIER_TEXT[i.level] + "] " + i.key + "（" + i.group + "）：" + i.missing);
    lines.push("        怎么补：" + i.how);
  });
  if (r.notes.length) {
    lines.push("");
    lines.push("-- 口径提醒 --");
    r.notes.forEach(function (n) { lines.push("  · " + n); });
  }
  return lines.join("\n");
}

/**
 * `.env.example` 的**唯一来源** —— 脚本 `scripts/env-example.js` 生成它，不手抄。
 * 手抄一份的下场：某天加了一个变量，文档还是老样子，用户照文档配完发现「还是不对」。
 */
function envExample() {
  var out = [
    "# 跬步 · 服务端环境变量（由 `node scripts/env-example.js` 生成，**不要手改**）",
    "#",
    "# 全部可选：一个都不配，本站照样能完全离线使用（打开即背）。",
    "# 配齐「必须」两项之后，账号与进度才会真的落到服务端。",
    "#",
    "# 用法：把这份内容复制到托管平台的环境变量里（Vercel / 其它 Node 托管均可）。",
    "#      **不要提交填了真值的 .env**（.gitignore 已经挡着）。",
    "#"
  ];
  ["必须", "这一件需要", "可选"].forEach(function (label) {
    var level = label === "必须" ? "required" : (label === "这一件需要" ? "needed" : "optional");
    out.push("# ---------------------------------------------------------------------------");
    out.push("# " + label);
    out.push("# ---------------------------------------------------------------------------");
    ENTRY.filter(function (e) { return e.level === level; }).forEach(function (e) {
      out.push("# " + e.what);
      out.push("#   缺它：" + e.missing);
      out.push("#   怎么补：" + e.how);
      out.push(e.key + "=");
      out.push("");
    });
  });
  return out.join("\n");
}

module.exports = {
  ENTRY: ENTRY,
  check: check,
  report: report,
  envExample: envExample
};
