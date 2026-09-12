/**
 * 匿名访问统计（无后端）
 * ---------------------------------------------------
 * 目的：只有站主知道「一共有多少人用过、大约什么时候用的」，
 *       但完全不引入账号、Cookie、第三方统计 SDK 或用户画像。
 *
 * 工作方式（三步，全部在前端完成）：
 *   1. 首次访问时在本机 localStorage 生成一个随机匿名编号（UUID 形状，无任何个人信息）；
 *   2. 命中规则（新设备首访，或距上次上报超过 MIN_GAP）才发一次上报，避免刷量；
 *   3. 上报到 CNB 仓库的公开数据文件（data/visits.json）：
 *        · 有人配置仓库令牌（见 js/admin.js）→ 直接由管理页写入；
 *        · 没配置 → 累积在本地待上报队列，站主在管理页一键同步。
 *
 * 刻意不做的事：
 *   · 不发送 IP 之外的任何设备信息（IP 由托管平台日志自行记录，本模块不读取）
 *   · 不发送浏览历史、不发送背诵内容、不写 Cookie、不加载任何第三方脚本
 *   · 不做跨站跟踪（不发 Referer 头，只记录来源域名用于粗略了解入口）
 */
(function () {
  "use strict";

  var TOTAL_KEY = "poem_stats_id_v1";     // 匿名编号
  var COUNT_KEY = "poem_stats_local_v1";  // 本机累计访问次数（兜底统计）
  var LAST_KEY = "poem_stats_sent_v1";    // 上次上报时间
  var QUEUE_KEY = "poem_stats_queue_v1";  // 待上报队列（无令牌时暂存）
  var ADMIN_KEY = "poem_admin_token_v1";  // 管理员令牌（管理页填写后才会上报）

  var MIN_GAP = 6 * 60 * 60 * 1000;       // 同一设备 6 小时内只上报一次
  var DATA_URL = "./data/visits.json";

  /* ---------------- 基础工具（隐私模式下 localStorage 可能不可用） ---------------- */
  function safeGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, val) {
    try { window.localStorage.setItem(key, val); } catch (e) { /* 忽略 */ }
  }
  function parse(str, fallback) {
    try {
      var v = JSON.parse(str);
      return v === null || v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  /** 匿名编号：随机 UUID（不基于设备信息，换浏览器即换编号） */
  function visitorId() {
    var id = safeGet(TOTAL_KEY);
    if (id && /^v-[0-9a-z]{8,}$/.test(id)) return id;
    var rnd;
    if (window.crypto && window.crypto.randomUUID) {
      rnd = window.crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    } else {
      rnd = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    }
    id = "v-" + rnd;
    safeSet(TOTAL_KEY, id);
    return id;
  }

  /** 本地累计访问次数（断网也有底账，管理页可看到「本机记录」） */
  function bumpLocal() {
    var n = parseInt(safeGet(COUNT_KEY) || "0", 10);
    if (!isFinite(n) || n < 0) n = 0;
    n += 1;
    safeSet(COUNT_KEY, String(n));
    return n;
  }

  function today() {
    var d = new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  /** 只保留来源域名，不记录完整 URL 与查询串 */
  function refHost() {
    try {
      if (!document.referrer) return "";
      var a = document.createElement("a");
      a.href = document.referrer;
      var h = a.hostname || "";
      return h === location.hostname ? "" : h;
    } catch (e) {
      return "";
    }
  }

  function pageName() {
    var p = location.pathname.split("/").pop() || "index.html";
    return p;
  }

  /** 一次访问记录：只有「日期 + 页面 + 来源域名」，没有 IP / UA / 设备标识 */
  function visitRecord() {
    return { id: visitorId(), date: today(), page: pageName(), ref: refHost() };
  }

  function queue() {
    var q = parse(safeGet(QUEUE_KEY), []);
    return Array.isArray(q) ? q : [];
  }

  /** 无令牌时把访问记进本地队列，等站主在管理页同步 */
  function pushQueue(rec) {
    var q = queue();
    q.push(rec);
    // 队列只留最近 500 条，避免把 localStorage 撑满
    if (q.length > 500) q = q.slice(q.length - 500);
    safeSet(QUEUE_KEY, JSON.stringify(q));
  }

  function adminToken() {
    return safeGet(ADMIN_KEY) || "";
  }

  /** 上报一次（有令牌才真正发出去，否则仅入队） */
  function report(rec) {
    pushQueue(rec);
    safeSet(LAST_KEY, String(Date.now()));
    return false;
  }

  /* ---------------- 对外接口 ---------------- */
  var api = {
    id: visitorId,
    /** 本机累计访问次数（不依赖任何服务器） */
    localCount: function () {
      return parseInt(safeGet(COUNT_KEY) || "0", 10) || 0;
    },
    /** 本次是否有新的匿名访问需要记一笔 */
    needReport: function () {
      var last = parseInt(safeGet(LAST_KEY) || "0", 10) || 0;
      return Date.now() - last > MIN_GAP;
    },
    /** 待上报队列（管理页同步用） */
    pending: function () {
      return queue();
    },
    clearPending: function () {
      safeSet(QUEUE_KEY, "[]");
    },
    record: function (rec) {
      pushQueue(rec);
    },
    token: adminToken,
    setToken: function (t) {
      safeSet(ADMIN_KEY, t || "");
    },
    dataUrl: DATA_URL,
    visitorId: visitorId,
    pageName: pageName,
    refHost: refHost,
    today: today
  };

  /**
   * 记录一次访问。
   * 注意：无论能否上报，本机都会 +1（设置页 / 管理页都能看到「本机访问次数」）。
   */
  function track() {
    var n = bumpLocal();
    window.__poemLocalVisits = n;
    if (!api.needReport()) return false;
    report(visitRecord());
    return true;
  }

  api.track = track;
  window.Stats = api;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", track);
  } else {
    track();
  }
})();
