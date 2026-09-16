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
 * 「配置与真开通」的**步骤清单**（2D 的唯一来源）。
 * ==========================================================================
 * 2C 把「缺哪个变量」做成了可执行的（`doctor.js`），但**「照着补」这件事本身**
 * 还散在三处：文档一句「去 Supabase 建项目」、`.env.example` 一句
 * 「Project Settings → API」、以及只有做过的人才知道的坑
 * （service_role 不是 anon、SPF/DKIM/DMARC 三条 DNS、探活为什么每 5 天）。
 *
 * 这一份把那三处收成一处，`doctor.js --steps` 直接打印它。
 * 与 ENTRY 的关系是**互补而不是重复**：
 *   · ENTRY 回答「每个变量缺了会怎样」
 *   · STEPS 回答「为了让它不缺，先做什么、在哪做、做完了怎么知道成了」
 * 两步各有一句 `check`（判据），与 `ops.check()` 是**同一个函数**，不重算一遍。
 *
 * ⚠️ 与 ENTRY 同一条纪律：**不出现任何密钥的值**（连长度都不报）。
 *    这份文字同样是可以直接贴进 Issue 的。
 * ⚠️ 本文件仍不 import 任何第三方包（Node 里可直接 require）。
 */

/** 一段可直接粘进终端的验收命令（`$VAR` 由用户自己的 shell 展开） */
var VERIFY_DB = 'curl -sS -o /dev/null -w \'%{http_code}\\n\' "$SUPABASE_URL/rest/v1/accounts?select=uid&limit=1" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"';

var STEPS = [
  {
    id: "A",
    title: "生成会话密钥",
    level: "required",
    where: "托管平台的环境变量（一个 SESSION_SECRET）",
    why: "会话 Cookie 靠它签名。缺它时 /api/* 一律回 503 —— 「未开放」是如实回答，不是坏掉",
    how: [
      "本机执行：openssl rand -hex 32",
      "把输出**整串**填进托管平台的环境变量 SESSION_SECRET",
      "至少 16 个字符才算设上了（`config.hasSession()` 判的就是这一条）"
    ],
    check: "自检里 SESSION_SECRET 从「未设置」变「已设置」，并且 hasSession 为 true"
  },
  {
    id: "B",
    title: "建 Supabase 项目并跑到能连",
    level: "required",
    where: "Supabase 控制台 + 托管平台的环境变量（两个值）",
    why: "不配库时自动降级为**内存存储**：本实例重启即丢账号与进度（进程内的假象）",
    how: [
      "supabase.com 建项目（免费档即可；免费项目连续 7 天没有请求会被暂停 —— 见第 D 步）",
      "控制台左侧 SQL Editor：整段粘贴 api/_lib/schema.sql 并执行（四张表 + 条件 upsert 函数 + 四表 RLS 全开）",
      "Project Settings → API：复制 Project URL → 填 SUPABASE_URL",
      "**同一页**复制 service_role key → 填 SUPABASE_SERVICE_KEY（⚠️ 不是 anon key）"
    ],
    check: "自检里「最低线已过」（hasSession 且 hasDb），并且这段命令回 200：" + VERIFY_DB
  },
  {
    id: "C",
    title: "注册发信商并把域名验到能真发信",
    level: "needed",
    where: "发信商后台 + 域名 DNS + 托管平台的环境变量（一个密钥）",
    why: "不配时落到 console 通道：**真实用户收不到信**，只往服务端日志写一行（本地开发与 CI 正是靠它跑完整链路）",
    how: [
      "二选一注册：SendGrid（主选，国内到达率较好）或 Resend（备选，账号数据固定在美国）",
      "SendGrid → Settings → API Keys → 建一枚 **Mail Send** 权限的 key → 填 SENDGRID_API_KEY",
      "Resend → API Keys → 建一枚 key → 填 RESEND_API_KEY（与上面只备其一）",
      "在发信商后台验证**发信子域**（如 mail.kuibu.app）→ 按提示加 SPF / DKIM / DMARC 三条 DNS 记录",
      "MAIL_FROM 填验证过的子域里的地址（默认 noreply@mail.kuibu.app）"
    ],
    verify: [
      "POST /api/send-code 看看 delivered 是不是 true（false 就是还在 console 通道）",
      "往自己的 QQ / 163 邮箱发一封：**缺 SPF/DKIM/DMARC 会被直接判成垃圾邮件或拒收**，只验证域名不够",
      "收不到时先看垃圾箱，再看发信商后台的投递日志（那一页会说 ISP 为什么拒）"
    ],
    check: "自检里「发信通道」从 console 变成你配的那一家；发一封真信，delivered 为 true"
  },
  {
    id: "D",
    title: "上探活与备份（可用性兜底，不是可靠性方案）",
    level: "optional",
    where: "本仓库的 .cnb.yml（两条 crontab 流水线）+ CNB 密钥仓库",
    why: "免费档连续 7 天没有请求就**整个项目停机**。用户看到的是「打不开」，不是「有点慢」—— 这是本方案里唯一会直接砸在用户身上的平台限制",
    how: [
      "把 SUPABASE_URL / SUPABASE_SERVICE_KEY 放进**密钥仓库**（禁止本地克隆，只由流水线引用）",
      "在 .cnb.yml 里加两条定时任务：supabase-keepalive 与 supabase-backup",
      "探活的请求**必须打到数据库**（PostgREST 查询算活动，根路径与状态页不算）",
      "探活排**每 5 天**而不是每 7 天：平台可能延迟数小时甚至跳过，留 2 天缓冲",
      "备份每周一次 pg_dump（免费档没有自动备份，误删就是永久消失）",
      "备份还要第三个值 SUPABASE_DB_URL —— 它**不能在控制台复制**，只能去 Project Settings → Database → Connection string 那一页取模板，再把里面的 [YOUR-PASSWORD] 换成数据库密码（那串明文密码只在建项目时出现过一次；忘了就点 Reset database password 重设）。模板形如 postgresql://postgres:[YOUR-PASSWORD]@db.<ref>.supabase.co:5432/postgres，把 [YOUR-PASSWORD] 整体替换掉再填进密钥仓库",
      "密码里有 @ : / # ? 这类字符时必须**百分号编码**（@ → %40），否则 pg_dump 会把密码里那一段当成主机名，报的是「could not translate host name」，看着像 DNS 坏了其实不是"
    ],
    check: "仓库的流水线列表里能看见这两条；手动触发一次探活，成功即回执"
  },
  {
    id: "E",
    title: "配完当场验收（四步，每步一个明确结论）",
    level: "required",
    where: "本机终端（对着已部署的站点）",
    why: "「配完了」和「配对了」是两件事。这一段把前者变成后者 —— 只回答事实，不做「应该没问题」这类判断",
    how: [
      "① 库连通：期望回 200 —— " + VERIFY_DB,
      "② 会话可签：curl -sS \"$SITE_URL/api/me\" | head -c 200 —— 期望 401 E_NO_SESSION；**回 503 E_NOT_CONFIGURED 就是 SESSION_SECRET 没生效**",
      "③ 真发信：POST /api/send-code → delivered:true 且 transport 是你配的那一家（console 通道**永远**是 false，这是 2C 定的，2D 不改）",
      "④ 注销可达：curl -sS -o /dev/null -w '%{http_code}\\n' -X DELETE \"$SITE_URL/api/account\" —— 期望 401（不是 500）"
    ],
    check: "四条全对：① 200 ② 401 ③ delivered=true ④ 401。任何一条不对，回到它上面那一步"
  }
];

/** 步骤渲染成给人看的文字（`doctor.js --steps` 与 Issue 评论用同一份） */
function stepsReport(cfg) {
  var lines = [];
  lines.push("跬步 · 配置与真开通（2D：Supabase + 发信商 + 会话密钥 + 探活）");
  lines.push("=".repeat(60));
  lines.push("五步，按顺序做。每一步做完都有一条**本机就能跑的判据**，不必先部署。");
  lines.push("真值进托管平台的环境变量，**不进仓库**（.env 被 .gitignore 挡着）。");
  lines.push("");
  STEPS.forEach(function (st) {
    lines.push("── 第 " + st.id + " 步 · " + st.title + "  [" + TIER_TEXT[st.level] + "]");
    lines.push("   在哪配：" + st.where);
    lines.push("   为什么：" + st.why);
    lines.push("   怎么做：");
    st.how.forEach(function (h, i) { lines.push("     " + (i + 1) + ". " + h); });
    if (st.verify) {
      lines.push("   怎么验：");
      st.verify.forEach(function (h) { lines.push("     · " + h); });
    }
    lines.push("   判据：" + st.check);
    lines.push("");
  });
  lines.push("-- 现在到哪一步了（据当前环境变量如实报，不报值）--");
  var r = check(cfg);
  lines.push("   第 A/B 步（最低线）：" + (r.ok ? "已过" : "未过（缺 " + r.blocking.map(function (i) { return i.key; }).join("、") + "）"));
  lines.push("   第 C 步（真发信）：" + (r.mail === "console" ? "未过（发信通道是 console）" : "已过（" + r.mail + "）"));
  lines.push("   第 D 步（探活与备份）：不在环境变量里，看仓库 .cnb.yml 的两条 crontab");
  lines.push("   第 E 步（验收）：上面四条命令，本机跑");
  lines.push("");
  lines.push("短信不在五步里：要先签商 + 模板报备（3~7 工作日，**日历时间不是人日**），");
  lines.push("再实现 transports.<商名>，最后才开 SMS_ENABLED=1。开了但不接商，仍是 503 E_SMS_NOT_OPEN。");
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
  STEPS: STEPS,
  check: check,
  report: report,
  stepsReport: stepsReport,
  envExample: envExample
};
