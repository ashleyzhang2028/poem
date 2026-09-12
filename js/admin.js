/**
 * 管理页 · 访问统计（admin.html）
 * ---------------------------------------------------
 * 这个页面刻意做得很「朴素」，只解决一个问题：
 * 「到底有多少人用过？」——而且不引入后端、不引入第三方统计。
 *
 * 数据从哪来：
 *   1. 本机：js/stats.js 每次访问都写一条本地记录（localStorage），这里直接读；
 *   2. 全网：读仓库里的公开文件 data/visits.json（累计聚合结果）。
 *
 * 数据怎么合上去：
 *   若在页面上填了「仓库访问令牌」，本页会把本机待同步的记录合并进
 *   data/visits.json 再提交回仓库（CNB 开放接口，只用一个文件读写权限）。
 *   没填令牌时页面完全可用，只是只能看本机数据。
 *
 * 隐私边界（与《隐私条款》一致）：
 *   记录里只有 { 匿名编号, 日期, 页面, 来源域名 }，没有 IP、UA、设备指纹，
 *   也没有用户在应用里输入或背诵的任何内容。
 */
(function () {
  "use strict";

  var $ = function (sel) { return document.querySelector(sel); };
  var REPO = "npu-gpu-cpu/poem";
  var FILE = "data/visits.json";
  var API = "https://api.cnb.cool/" + REPO + "/-/git/contents/" + FILE;

  var remote = null;   // 仓库里的数据
  var statusEl = null;

  function status(msg, kind) {
    if (!statusEl) statusEl = $("#ad-status");
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.dataset.kind = kind || "";
  }

  function toast(msg) {
    var t = $("#toast");
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 1800);
  }

  /* ---------------- 统计口径 ---------------- */
  /** 把一组访问记录聚合成 {total, visitors, days, byDay} */
  function summarize(list) {
    var ids = {};
    var byDay = {};
    list.forEach(function (r) {
      if (!r || !r.date) return;
      if (r.id) ids[r.id] = 1;
      byDay[r.date] = (byDay[r.date] || 0) + 1;
    });
    return {
      total: list.length,
      visitors: Object.keys(ids).length,
      days: Object.keys(byDay).length,
      byDay: byDay
    };
  }

  /** 按日期排成柱状条 */
  function renderBars(byDay, limit) {
    var box = $("#ad-bars");
    if (!box) return;
    var dates = Object.keys(byDay).sort();
    if (!dates.length) {
      box.innerHTML = '<div class="empty">暂无数据</div>';
      return;
    }
    var shown = limit ? dates.slice(-limit) : dates;
    var max = Math.max.apply(null, shown.map(function (d) { return byDay[d]; }));
    box.innerHTML = "";
    shown.forEach(function (d) {
      var n = byDay[d];
      var row = document.createElement("div");
      row.className = "ad-bar";
      row.innerHTML =
        '<span class="ad-bar-day">' + d.slice(5) + '</span>' +
        '<span class="ad-bar-track"><i style="width:' + Math.round((n / max) * 100) + '%"></i></span>' +
        '<b>' + n + '</b>';
      box.appendChild(row);
    });
  }

  function renderLocal() {
    var pending = window.Stats ? window.Stats.pending() : [];
    var local = window.Stats ? window.Stats.localCount() : 0;
    var sum = summarize(pending);
    $("#ad-local").textContent = String(local);
    $("#ad-pending").textContent = String(pending.length);
    $("#ad-id").textContent = window.Stats ? window.Stats.visitorId() : "—";

    var all = pending.slice();
    if (remote && Array.isArray(remote.visits)) all = all.concat(remote.visits);
    var total = summarize(all);

    $("#ad-visitors").textContent = total.total + " 次访问";
    $("#ad-visitors-card").textContent = String(total.total);
    $("#ad-unique").textContent = String(total.visitors);
    $("#ad-days").textContent = String(total.days);
    $("#ad-today").textContent = String(total.byDay[window.Stats ? window.Stats.today() : ""] || 0);
    renderBars(total.byDay, 14);

    var el = $("#ad-remote");
    if (remote) {
      el.textContent = "仓库数据：" + (remote.visits || []).length + " 条，最近更新 " +
        (remote.updatedAt || "未知");
    } else {
      el.textContent = "仓库数据：尚未加载（点「刷新全网数据」）";
    }
  }

  /* ---------------- 仓库读写 ---------------- */
  function b64encode(str) {
    // 中文安全：先转 UTF-8 字节再 base64
    var bytes = new TextEncoder().encode(str);
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64decode(b64) {
    var bin = atob(String(b64).replace(/\s/g, ""));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function headers() {
    var h = { "Content-Type": "application/json" };
    var t = window.Stats.token();
    if (t) h["Authorization"] = "Bearer " + t;
    return h;
  }

  /** 读取仓库里的 data/visits.json（公开仓库无需令牌也能读） */
  function loadRemote() {
    status("正在读取仓库数据…");
    return fetch(API, { headers: headers(), cache: "no-store" })
      .then(function (res) {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (json) {
        if (!json) {
          status("仓库里还没有 data/visits.json（首次同步会自动创建）", "warn");
          remote = null;
          return null;
        }
        var text = json.content ? b64decode(json.content) : "";
        var data = text ? JSON.parse(text) : { visits: [] };
        remote = {
          visits: Array.isArray(data.visits) ? data.visits : [],
          updatedAt: data.updatedAt || ""
        };
        status("已读取仓库数据：" + remote.visits.length + " 条", "ok");
        return remote;
      })
      .catch(function (e) {
        status("读取失败：" + e.message + "（无令牌时也可能是网络/权限问题）", "err");
        return null;
      });
  }

  /** 把本机待同步记录合并进仓库文件 */
  function syncToRepo() {
    var pending = window.Stats.pending();
    if (!pending.length) {
      status("本机没有待同步的记录", "warn");
      toast("没有需要同步的记录");
      return Promise.resolve();
    }
    if (!window.Stats.token()) {
      status("请先填写仓库访问令牌，只有站主能写入统计文件", "err");
      toast("需要先填写令牌");
      return Promise.resolve();
    }
    status("正在同步…");
    return loadRemote().then(function () {
      var known = {};
      (remote ? remote.visits : []).forEach(function (r) {
        known[(r.date || "") + "|" + (r.id || "") + "|" + (r.page || "")] = 1;
      });
      var add = pending.filter(function (r) {
        return !known[(r.date || "") + "|" + (r.id || "") + "|" + (r.page || "")];
      });
      var visits = (remote ? remote.visits.slice() : []).concat(add);
      // 只保留最近 120 天的明细，避免文件无限膨胀
      var cutoff = Date.now() - 120 * 24 * 3600 * 1000;
      visits = visits.filter(function (r) {
        var t = Date.parse(r.date + "T00:00:00Z");
        return !isFinite(t) || t >= cutoff;
      });
      var body = JSON.stringify({
        updatedAt: new Date().toISOString(),
        totalVisits: visits.length,
        visits: visits
      }, null, 2);
      return putFile(body).then(function () {
        window.Stats.clearPending();
        status("同步成功，仓库里现有 " + visits.length + " 条访问记录", "ok");
        toast("已同步 " + add.length + " 条");
      });
    }).catch(function (e) {
      status("同步失败：" + e.message, "err");
      toast("同步失败");
    });
  }

  function putFile(text) {
    // 先问当前文件 sha（没有文件则新建）
    return fetch(API, { headers: headers(), cache: "no-store" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (cur) {
        var payload = {
          message: "chore: update visit stats",
          content: b64encode(text)
        };
        if (cur && cur.sha) payload.sha = cur.sha;
        return fetch(API, {
          method: "PUT",
          headers: headers(),
          body: JSON.stringify(payload)
        });
      })
      .then(function (res) {
        if (!res.ok) return res.text().then(function (t) { throw new Error("HTTP " + res.status + " " + t.slice(0, 120)); });
        return res.json();
      });
  }

  /* ---------------- 事件 ---------------- */
  function bind() {
    var tokenInput = $("#ad-token");
    if (tokenInput && window.Stats.token()) tokenInput.value = window.Stats.token();

    $("#ad-save-token").addEventListener("click", function () {
      window.Stats.setToken(tokenInput.value.trim());
      updateTokenHint();
      toast("令牌已保存在本机");
    });
    $("#ad-clear-token").addEventListener("click", function () {
      window.Stats.setToken("");
      if (tokenInput) tokenInput.value = "";
      updateTokenHint();
      toast("已清除令牌");
    });

    $("#ad-sync").addEventListener("click", function () { syncToRepo().then(renderLocal); });
    $("#ad-load").addEventListener("click", function () { loadRemote().then(renderLocal); });
    $("#ad-export").addEventListener("click", function () {
      var blob = new Blob([JSON.stringify({ visits: window.Stats.pending() }, null, 2)],
        { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "visits-" + window.Stats.today() + ".json";
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  function updateTokenHint() {
    var hint = $("#ad-token-hint");
    if (!hint) return;
    hint.textContent = window.Stats.token()
      ? "当前：已配置令牌 —— 可以同步到仓库（令牌只存在本机浏览器）"
      : "当前：未配置令牌 —— 访问只记在本机";
  }

  function init() {
    if (!window.Stats) return;
    bind();
    updateTokenHint();
    renderLocal();
    // 有令牌就顺手拉一次全网数据，没有则只显示本机
    if (window.Stats.token()) loadRemote().then(renderLocal);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
