(function () {
  "use strict";

  var $ = function (sel) { return document.querySelector(sel); };

  var CHECKS = [
    { key: "js", name: "浏览器能跑本站的离线界面", hint: "不通过＝页面本身没加载起来，与云端账号无关" },
    { key: "api", name: "本站的 /api/* 真的挂上了", hint: "回平台层的「The page could not be found」＝部署没把 /api/* 接到函数上" },
    { key: "api2", name: "函数认得平台转进来的地址", hint: "平台层把原路径放进 __path 再交给固定函数；这一步 404 说明 rewrite 契约对不上" },
    { key: "config", name: "站点自报的配置形状正确", hint: "这一条只验证接口活着，不涉及密钥" },
    { key: "me", name: "服务端状态可读", hint: "401 = 未登录（正常）；503 = 服务端没配会话密钥" },
    { key: "cors", name: "这个域名和 SITE_URL 对得上", hint: "对不上时，注册邮件里的链接会把人带去另一个域名" },
    { key: "reg", name: "注册接口能在不建号的前提下练一遍", hint: "只打形状不合法的请求，不写任何数据；看它回的是 500 还是正常报错" }
  ];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function readJson(res) {
    return res.text().then(function (t) {
      try { return t ? JSON.parse(t) : null; } catch (e) { return { __raw: String(t).slice(0, 200) }; }
    });
  }

  function call(path, init) {
    var url = path + (path.indexOf("?") >= 0 ? "&" : "?") + "_=" + Date.now();
    return fetch(url, Object.assign({ credentials: "same-origin", cache: "no-store" }, init || {}))
      .then(function (res) {
        return readJson(res).then(function (body) { return { status: res.status, body: body }; });
      });
  }

  function installPwa() {
    var p = null;
    try { p = window.__STEPSIU_PWA || window.SitePwa || null; } catch (e) { p = null; }
    return p;
  }

  var results = {};
  var serverReport = null;
  var rawLines = [];
  var running = false;

  function check(key, ok, detail) {
    results[key] = { ok: ok, detail: detail || "" };
  }

  function renderChecks() {
    var box = $("#selfcheck-list");
    if (!box) return;
    box.innerHTML = "";
    CHECKS.forEach(function (c) {
      var r = results[c.key];
      var state = r === undefined ? "wait" : (r.ok === true ? "ok" : (r.ok === false ? "bad" : "warn"));
      var row = document.createElement("div");
      row.className = "sc-row sc-" + state;
      row.setAttribute("data-check", c.key);
      var mark = state === "ok" ? "✓" : (state === "bad" ? "✗" : (state === "warn" ? "!" : "…"));
      row.innerHTML =
        '<span class="sc-mark" aria-hidden="true">' + mark + "</span>" +
        '<span class="sc-main"><span class="sc-name">' + esc(c.name) + "</span>" +
        '<span class="sc-detail">' + esc(r && r.detail ? r.detail : (state === "wait" ? "待测" : "")) + "</span></span>";
      box.appendChild(row);
    });
  }

  function setStatus(text, bad) {
    var el = $("#selfcheck-status");
    if (!el) return;
    el.textContent = text;
    el.className = "selfcheck-status" + (bad ? " bad" : "");
  }

  function runLocal() {
    check("js", true, "页面已加载（JS 能跑）");

    var origin = location.origin;
    var r0 = serverReport;

    return call("/api/config").then(function (res) {
      rawLines.push("GET /api/config → " + res.status + " " + JSON.stringify(res.body).slice(0, 200));
      var isSiteJson = !!(res.body && res.body.turnstile);
      var isPlatform404 = !!(res.body && (res.body.__raw || "").indexOf("The page could not be found") >= 0);
      if (res.status === 200 && isSiteJson) {
        check("api", true, "200，本站自己的 JSON");
      } else if (res.status === 404) {
        check("api", false, isPlatform404
          ? "404 且正文是平台层那句英文 —— /api/* 没接到函数上"
          : "404，但正文是本站形状（路由表里没有 /api/config）");
      } else if (res.status === 503) {
        check("api", true, "503 E_NOT_CONFIGURED —— 接口活着，只是没配会话密钥");
      } else {
        check("api", res.status === 200, "HTTP " + res.status);
      }

      check("config", !!(res.body && res.body.turnstile && typeof res.body.mail === "object"),
        res.body && res.body.turnstile ? "turnstile / mail 两段都在" : "响应形状不对（可能不是本站）");

      // 平台层会把 /api/* 的原路径放进 __path（见 vercel.json）再交给固定函数。
      // 单独测一次这条内部地址：用户地址能通、内部地址不通，说明那一条 rewrite 的
      // 落点与路由表的前缀对不上 —— 另一种坏法，症状同样是「全站 /api 404」。
      return call("/api/handler?__path=config");
    }).then(function (res) {
      rawLines.push("GET /api/handler?__path=config → " + res.status + " " + JSON.stringify(res.body).slice(0, 200));
      var isPlatform404 = !!(res.body && (res.body.__raw || "").indexOf("The page could not be found") >= 0);
      var isSite404 = !!(res.body && res.body.code === "E_404");
      if (res.status === 200) {
        check("api2", true, "200 —— 函数认得平台转进来的地址");
      } else if (isSite404) {
        check("api2", false, "函数在，但不认这个地址 —— vercel.json 与 handler 的 __path 契约对不上");
      } else if (isPlatform404) {
        check("api2", false, "平台层 404 —— 这个部署里压根没有这个函数");
      } else {
        check("api2", null, "HTTP " + res.status);
      }

      return call("/api/me");
    }).then(function (res) {
      rawLines.push("GET /api/me → " + res.status + " " + JSON.stringify(res.body).slice(0, 200));
      var code = res.body && res.body.code;
      if (res.status === 401) {
        check("me", true, "401 " + (code || "E_NO_SESSION") + " —— 会话通道正常（未登录就是该回这个）");
      } else if (res.status === 503) {
        check("me", false, "503 " + (code || "") + " —— 服务端没配会话密钥（就是设置里那一项）");
      } else if (res.status === 200) {
        check("me", true, "200 —— 这台浏览器已有登录会话");
      } else {
        check("me", false, "HTTP " + res.status + "（注册多半也是同一个原因）");
      }

      var siteUrl = serverReport && serverReport.site ? serverReport.site.siteUrl : "";
      if (!siteUrl) {
        check("cors", null, "服务端没自报 SITE_URL，看不出对不对");
      } else {
        var same = siteUrl.replace(/\/+$/, "").toLowerCase() === origin.replace(/\/+$/, "").toLowerCase();
        check("cors", same, same
          ? origin + " 与 SITE_URL 一致"
          : "当前 " + origin + "，而 SITE_URL 是 " + siteUrl + "（注册邮件里的链接会指向后者）");
      }

      // 探针：**故意**打形状不合法的请求（不合法域名 → 服务端在归一化那一步就退回）。
      // 用合法邮箱跑一发会在内存模式下真的建号（已实测），所以这里不能打合法邮箱。
      return call("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "selfcheck-probe@invalid",
          password: "selfcheck-probe-1234",
          deviceId: "selfcheck"
        })
      });
    }).then(function (res) {
      rawLines.push("POST /api/register（探针，形状不合法）→ " + res.status + " " + JSON.stringify(res.body).slice(0, 240));
      var code = res.body && res.body.code;
      if (res.status === 500 || code === "E_INTERNAL") {
        check("reg", false, "500 E_INTERNAL —— 服务端内部抛异常了，这正是「服务端出了点问题」那句话的来源");
      } else if (res.status === 503) {
        check("reg", false, "503 E_NOT_CONFIGURED —— 缺会话密钥");
      } else if (res.status === 400) {
        check("reg", true, "400 " + (code || "") + " —— 注册链路能正常应答（这一发是故意不合法的形状，服务端一个字都没写）");
      } else if (res.status === 404) {
        check("reg", false, "404 —— /api/* 没挂上，跟上面那条同因");
      } else {
        check("reg", null, "HTTP " + res.status + " " + (code || ""));
      }
      renderChecks();
      renderSummary();
    })["catch"](function (e) {
      rawLines.push("本地检查抛错：" + String((e && e.message) || e));
      setStatus("网络层就断了：" + String((e && e.message) || e), true);
      renderChecks();
      renderSummary();
    });
  }

  function loadServer() {
    return call("/api/diag").then(function (res) {
      rawLines.push("GET /api/diag → " + res.status + " " + JSON.stringify(res.body).slice(0, 200));
      if (res.status === 200 && res.body && res.body.report) {
        serverReport = res.body.report;
        results.diagAvailable = true;
        renderServer(serverReport);
        return true;
      }
      results.diagAvailable = res.status !== 404;
      results.diagUnavailable = true;
      rawLines.push("  → /api/diag 不可用（HTTP " + res.status + "），改用本地检查 + 命令行判据");
      return false;
    })["catch"](function (e) {
      results.diagUnavailable = true;
      rawLines.push("GET /api/diag 失败：" + String((e && e.message) || e));
      return false;
    });
  }

  function renderServer(r) {
    var box = $("#selfcheck-server");
    if (!box) return;
    var verdict = r.verdict === "ok" ? "ok" : "bad";
    var html = "";
    html += '<div class="sc-verdict sc-' + verdict + '">' +
      '<span class="sc-verdict-tag">结论</span>' + esc(r.verdictText || "（没有结论）") + "</div>";

    html += '<div class="sc-kv">';
    html += kv("访问地址", r.site.currentOrigin);
    html += kv("SITE_URL（写进邮件里的）", r.site.siteUrl || "(没配，用默认值)", r.site.match ? "一致" : "不一致");
    html += kv("会话密钥", r.session.ok ? "已配（长度 ≥16）" : "缺（长度 " + r.session.keyLength + "）", r.session.ok ? "ok" : "bad");
    html += kv("数据存储", r.database.mode === "supabase" ? "Supabase" : "内存（重启即丢）", r.database.mode === "supabase" ? "ok" : "warn");
    if (r.database.target) html += kv("数据库主机（脱敏）", r.database.target);
    if (r.serviceKeyShape) html += kv("服务端密钥形状", r.serviceKeyShape, r.serviceKeyShape.indexOf("service_role") >= 0 ? "ok" : "warn");
    html += kv("发信通道", r.mail.transport + (r.mail.real ? "" : "（用户收不到信）"), r.mail.real ? "ok" : "warn");
    html += kv("密码长度", r.limits.passwordMin + " ~ " + r.limits.passwordMax + " 位");
    html += kv("人机校验（服务端）", r.turnstile.server ? "开着" : "关着");
    html += "</div>";

    if (r.database.connect) {
      html += '<h3 class="sc-h3">数据库探活</h3><div class="sc-kv">';
      html += kv("取一行 accounts", "HTTP " + r.database.connect.httpStatus + " · " + r.database.connect.ms + "ms",
        r.database.connect.httpStatus === 200 ? "ok" : "bad");
      html += kv("判定", r.database.connect.verdict, r.database.connect.httpStatus === 200 ? "ok" : "bad");
      html += "</div>";
      if (r.database.connect.upstream) {
        html += '<pre class="sc-pre">上游原话（已截断 300 字）：\n' + esc(r.database.connect.upstream) + "</pre>";
      }
    }

    if (r.database.tables && r.database.tables.length) {
      html += '<h3 class="sc-h3">六张表逐张看</h3><table class="sc-table"><thead><tr><th>表</th><th>HTTP</th><th>判定</th></tr></thead><tbody>';
      r.database.tables.forEach(function (t) {
        html += "<tr><td>" + esc(t.table) + "</td><td>" + t.httpStatus + "</td><td>" +
          esc(t.verdict) + "</td></tr>";
      });
      html += "</tbody></table>";
    }

    if (r.database.write) {
      html += '<h3 class="sc-h3">写入实跑（真 INSERT，完了就删）</h3><div class="sc-kv">';
      html += kv("写一行 progress", r.database.write.ok ? "成功 · " + r.database.write.ms + "ms" : "失败",
        r.database.write.ok ? "ok" : "bad");
      if (r.database.write.ok) {
        html += kv("读回来", r.database.write.verified ? "在" : "不在", r.database.write.verified ? "ok" : "bad");
        html += kv("清掉", r.database.write.cleanup ? "已删" : "没删掉（自己去 progress 表删 uid 以 u_diag 开头的那行）", r.database.write.cleanup ? "ok" : "warn");
      } else if (r.database.write.verdict) {
        html += kv("判定", r.database.write.verdict, "bad");
      }
      html += "</div>";
      if (r.database.write.upstream) {
        html += '<pre class="sc-pre">上游原话：\n' + esc(r.database.write.upstream) + "</pre>";
      }
    }

    box.innerHTML = html;
    box.hidden = false;
  }

  function kv(k, v, state) {
    return '<div class="sc-kv-row">' +
      '<span class="sc-kv-k">' + esc(k) + "</span>" +
      '<span class="sc-kv-v' + (state ? " sc-" + state : "") + '">' + esc(v) + "</span></div>";
  }

  function renderSummary() {
    var done = CHECKS.filter(function (c) { return results[c.key]; });
    var bad = done.filter(function (c) { return results[c.key].ok === false; });
    if (!done.length) { setStatus("还在测…"); return; }
    if (bad.length) {
      setStatus("有 " + bad.length + " 条没过。先把上面第一处标 ✗ 的修掉 —— 下面「服务端自报」和命令判据能定位到具体哪一环。", true);
      return;
    }
    setStatus("前端这几条都过了。若注册还是 500，问题在服务端那一环 —— 看下面的「服务端自报」。");
  }

  function reportText() {
    var lines = [];
    lines.push("跬步 · 自助排查报告");
    lines.push("时间：" + new Date().toLocaleString());
    lines.push("地址：" + location.origin + location.pathname);
    lines.push("");
    lines.push("【前端检查】");
    CHECKS.forEach(function (c) {
      var r = results[c.key];
      if (!r) return;
      lines.push("  " + (r.ok === true ? "[过] " : (r.ok === false ? "[未过] " : "[无] ")) + c.name + "： " + (r.detail || ""));
    });
    if (serverReport) {
      var r2 = serverReport;
      lines.push("");
      lines.push("【服务端自报】");
      lines.push("  结论：" + r2.verdictText);
      lines.push("  访问地址：" + r2.site.currentOrigin);
      lines.push("  SITE_URL：" + r2.site.siteUrl + "（一致：" + (r2.site.match ? "是" : "否") + "）");
      lines.push("  会话密钥：" + (r2.session.ok ? "已配" : "缺") + "（长度 " + r2.session.keyLength + "）");
      lines.push("  数据存储：" + r2.database.mode);
      if (r2.database.target) lines.push("  数据库主机（脱敏）：" + r2.database.target);
      if (r2.serviceKeyShape) lines.push("  服务端密钥形状：" + r2.serviceKeyShape);
      if (r2.database.connect) {
        lines.push("  取一行 accounts：HTTP " + r2.database.connect.httpStatus + " · " + r2.database.connect.ms + "ms —— " + r2.database.connect.verdict);
      }
      (r2.database.tables || []).forEach(function (t) {
        lines.push("    表 " + t.table + "：HTTP " + t.httpStatus + " —— " + t.verdict);
      });
      if (r2.database.write) {
        lines.push("  写入实跑：" + (r2.database.write.ok ? "成功" : "失败") + " · " + r2.database.write.ms + "ms" +
          (r2.database.write.verdict ? " —— " + r2.database.write.verdict : ""));
      }
      lines.push("  发信通道：" + r2.mail.transport);
      lines.push("  人机校验：服务端" + (r2.turnstile.server ? "开着" : "关着"));
    } else {
      lines.push("");
      lines.push("【服务端自报】不可用（/api/diag 没答上）——多半是这次部署没带上这条路由，走命令行判据");
    }
    lines.push("");
    lines.push("【原始行】");
    rawLines.forEach(function (l) { lines.push("  " + l); });
    lines.push("");
    lines.push("本页不显示也不上报任何密钥；上面每一条都已脱敏。");
    return lines.join("\n");
  }

  function renderReport() {
    var box = $("#selfcheck-report");
    if (!box) return;
    box.value = reportText();
    box.hidden = false;
  }

  function copy(text, okMsg) {
    var done = function () {
      var st = $("#selfcheck-status");
      if (st) { st.textContent = okMsg; st.className = "selfcheck-status"; }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done)["catch"](function () { fallback(text); done(); });
    } else {
      fallback(text); done();
    }
  }

  function fallback(text) {
    var t = document.createElement("textarea");
    t.value = text;
    t.style.position = "fixed";
    t.style.left = "-9999px";
    document.body.appendChild(t);
    t.select();
    try { document.execCommand("copy"); } catch (e) {  }
    document.body.removeChild(t);
  }

  function bind() {
    var again = $("#btn-selfcheck-again");
    if (again) again.addEventListener("click", function () { if (!running) start(); });

    var rep = $("#btn-selfcheck-report");
    if (rep) rep.addEventListener("click", function () {
      renderReport();
      copy($("#selfcheck-report").value, "报告已复制，贴给 CodeBuddy 就行（里面没有任何密钥）");
    });

    var steps = $("#btn-selfcheck-steps");
    if (steps) steps.addEventListener("click", function () {
      var box = $("#selfcheck-steps");
      if (!box) return;
      box.hidden = !box.hidden;
    });
  }

  function start() {
    running = true;
    results = { js: { ok: true, detail: "页面已加载（JS 能跑）" } };
    serverReport = null;
    rawLines = [];
    var rbox = $("#selfcheck-report");
    if (rbox) { rbox.hidden = true; rbox.value = ""; }
    $("#selfcheck-steps").hidden = true;
    renderChecks();
    setStatus("正在测…");

    loadServer().then(function () {
      return runLocal();
    }).then(function () {
      running = false;
      renderChecks();
      renderSummary();
      var rep = $("#btn-selfcheck-report");
      if (rep) rep.disabled = false;
    })["catch"](function (e) {
      running = false;
      rawLines.push("整轮失败：" + String((e && e.message) || e));
      renderChecks();
      renderSummary();
    });
  }

  function init() {
    bind();
    start();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.SelfCheck = { run: start, report: reportText, results: function () { return results; } };
})();
