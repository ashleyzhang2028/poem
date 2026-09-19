(function () {
  "use strict";

  // 「集子已读」上云（Issue #243 后续 · 用户口径「云同步能加的都加上」）。
  //
  // 六部集子各有自己的一把已读键（`poem_classic_read_v1` / `poem_tangshi_read_v1`
  // / `poem_songci_read_v1` / `poem_guwen_read_v1` / `poem_zhaoming_read_v1` /
  // `poem_yuanqu_read_v1` / `poem_poems_read_v1`），形状是 `{ 篇 id: { read, at, times } }`。
  //
  // 它们不上云时是**七把各自独立的键**；上云时不再开七张表、也不推七行 ——
  // 一行一个集子会撑出六条「要拉的东西」，而每一部都可能有几百篇。
  // 折中的口径是：**一个集子一行**，`poem_id = "reads:<键名>"`，
  // 载荷只带「读过的篇」的薄记录（`{ at, times }`）。没读过的篇**不进载荷** ——
  // 这一张表是稀疏的：七部集子全站近两千篇，全读完也只有一百来 KB，
  // 平时一个人读过的通常不到一百篇。
  //
  // 合并规则是**并集**（与加背同源，与自选集合相反）：两台设备各读过几篇，
  // 合起来都要留着。理由很直白 —— 「读过」是一条**只增不减**的事实，
  // 没有「哪一端更新」这回事，谁的记录都不该被抹掉。
  //
  // ⚠️ 与加背的差别：加背有「日期」这个会过期的维度（按天并集），
  //    已读没有 —— 读过就是读过。所以这里是纯并集，`updatedAt` 只用来
  //    判「要不要跑一趟」，不用来判谁赢。

  var PREFIX = "reads:";

  // 集子引擎（js/reader-core.js）那把 `readStore` 的键名。
  // 引擎是逐集子配置的（`W.readStore`），这里只做「哪些键算已读」的判定。
  var BOOKS = [
    "poem_poems_read_v1",
    "poem_classic_read_v1",
    "poem_tangshi_read_v1",
    "poem_songci_read_v1",
    "poem_guwen_read_v1",
    "poem_zhaoming_read_v1",
    "poem_yuanqu_read_v1"
  ];

  function ps() {
    return typeof window !== "undefined" && window.ProgressStore ? window.ProgressStore : null;
  }

  function known(key) {
    return BOOKS.indexOf(String(key == null ? "" : key)) > -1;
  }

  // 从行号反推那把本机键（`reads:poem_tangshi_read_v1` → `poem_tangshi_read_v1`）。
  function keyOf(rowId) {
    var s = String(rowId == null ? "" : rowId);
    if (s.indexOf(PREFIX) !== 0) return "";
    var k = s.slice(PREFIX.length);
    return known(k) ? k : "";
  }

  function isReadRow(rowId) {
    return !!keyOf(rowId);
  }

  function nowTs() { return Date.now(); }

  // 一个集子一行：把本机那把已读键收成云端载荷。
  //
  // updatedAt 是「本机这一份最后改动的时刻」—— 每次标记都往前推一格
  // （同一毫秒里连标两篇也要区分开），否则第二次标记永远推不上去。
  function cloudRow(key, seen) {
    var K = keyOf(PREFIX + key) || (known(key) ? key : "");
    if (!K) return null;
    var P = ps();
    var map = null;
    try { map = P && P.readMap ? (P.readMap(K) || {}) : null; } catch (e) { map = null; }
    if (!map) return null;

    var mem = seen || {};
    var rowId = PREFIX + K;
    var knownTs = Number(mem[rowId]) || 0;
    var stamp = Number(mem[rowId + "__at"]) || 0;

    var marks = {};
    var n = 0;
    Object.keys(map).forEach(function (id) {
      if (!id) return;
      var v = map[id];
      if (!v) return;
      var o = (v && typeof v === "object") ? v : {};
      marks[id] = {
        at: Number(o.at) > 0 ? Math.round(Number(o.at)) : 0,
        times: Number(o.times) > 0 ? Math.round(Number(o.times)) : 0
      };
      n++;
    });

    // 一篇都没读过：之前推过就补一条删除（另一端也要知道「这里空了」）。
    if (!n) {
      if (knownTs > 0) {
        var t = nowTs();
        if (t <= knownTs) t = knownTs + 1;
        return { id: rowId, payload: { v: 1, marks: {}, updatedAt: t }, updatedAt: t, deleted: true };
      }
      return null;
    }

    var ts = stamp;
    if (ts <= knownTs) {
      // ⚠️ 没有「本机改动时刻」而云端那一行比本机见过的还新 —— 说明这一份
      //    是**刚同步下来的**（本机一个字都没动过）。这时候绝不能拿
      //    `Date.now()` 当时间戳：它比云端那个新 → 下一轮又推上去 → 死循环，
      //    而且推的是同一份内容。用「云端那个时间戳」当本机的时间戳，
      //    下一轮就判得出「没变」。
      //
      //    本机盘上那份**确有内容**且从没推过（换台新设备第一次打开）时，
      //    knownTs 是 0、stamp 也是 0 —— 那种情况才该盖一个新的时刻，
      //    否则这些已读永远推不上去（另一台设备看不到）。
      if (!knownTs) ts = nowTs();
      else return null;
    }
    return { id: rowId, payload: { v: 1, marks: marks, updatedAt: ts }, updatedAt: ts, deleted: false };
  }

  // 云端那一行并进本机。判词只有 "applied" / "skip"（它不进冲突裁决）。
  function applyCloud(row, seen) {
    var key = keyOf(row && row.id);
    if (!key) return "skip";
    var payload = (row && row.payload) || null;
    if (!payload || typeof payload !== "object") return "skip";

    var P = ps();
    if (!P || !P.setReadMap) return "skip";

    var rowId = PREFIX + key;
    var mem = seen || {};
    var knownTs = Number(mem[rowId]) || 0;
    var cloudTs = Number(row && row.updatedAt) > 0 ? Math.round(Number(row.updatedAt)) : 0;
    if (cloudTs && cloudTs === knownTs && !row.deleted) return "skip";

    // 并完之后「本机这一份的时间戳」要落在**云端那个**上：本机没改动，
    // 只是把对方读过的那几篇并了进来 —— 声明「我改了」的话下一轮又会推回去
    // （见 cloudRow 里那段）。这一格存在 seen 里，因为已读那把 map 塞不下。
    function syncStampTo(ts) {
      try {
        var S = typeof window !== "undefined" ? window.SyncStore : null;
        if (!S || typeof S.markSeen !== "function") return;
        var prev = Number((S.seen ? S.seen() : {})[rowId + "__at"]) || 0;
        if (ts <= prev) return;
        S.markSeen(rowId + "__at", ts);
      } catch (e) {  }
    }

    if (row.deleted) {
      try { P.setReadMap(key, {}); } catch (e) { return "skip"; }
      syncStampTo(cloudTs);
      return "applied";
    }

    // ⚠️ **并集**，不是覆盖：本机读过的留着，云端读过的并进来。
    //    只有「同一篇两端都读过」时才比 at（早的那个留着 —— 第一次读完的时刻
    //    是用户真正在意的那个数，晚的那个只是另一台设备后来的重复标记）。
    var local = {};
    try { local = P.readMap(key) || {}; } catch (e) { local = {}; }

    var next = {};
    Object.keys(local).forEach(function (id) {
      var o = (local[id] && typeof local[id] === "object") ? local[id] : {};
      next[id] = { read: true, at: Number(o.at) > 0 ? Math.round(Number(o.at)) : 0,
                   times: Number(o.times) > 0 ? Math.round(Number(o.times)) : 0 };
    });

    var marks = (payload.marks && typeof payload.marks === "object") ? payload.marks : {};
    var added = 0;
    Object.keys(marks).forEach(function (id) {
      if (!id) return;
      var o = (marks[id] && typeof marks[id] === "object") ? marks[id] : {};
      var at = Number(o.at) > 0 ? Math.round(Number(o.at)) : 0;
      var times = Number(o.times) > 0 ? Math.round(Number(o.times)) : 0;
      var had = next[id];
      if (!had) {
        next[id] = { read: true, at: at, times: times };
        added++;
        return;
      }
      // 两端都读过：at 取**早**的（第一次读完才是那个真实时刻），
      // times 取大的（两端各自数过几次，合起来是总数 —— 只增不减）。
      if (at && had.at && at < had.at) had.at = at;
      if (!had.at && at) had.at = at;
      if (times > had.times) had.times = times;
      had.read = true;
    });

    if (!added && knownTs > 0 && knownTs === cloudTs) return "skip";

    try { P.setReadMap(key, next); } catch (e) { return "skip"; }
    syncStampTo(cloudTs);
    return added ? "applied" : "skip";
  }

  // 「本机这一份最后改动的时刻」。引擎写已读时调它把这一格往前推 ——
  // 已读键本身只存 `{ 篇 id: ... }`，塞一个 `__at` 进去会被
  // 「按 id 判读过没有」的读法当成一篇（篇名叫 `__at` 的诗不存在），
  // 所以时间戳存在 sync-store 的 seen 里（那一格本来就按行号存东西）。
  function touch(key) {
    var K = String(key == null ? "" : key);
    if (!known(K)) return false;
    try {
      var S = typeof window !== "undefined" ? window.SyncStore : null;
      if (!S || typeof S.markSeen !== "function") return false;
      var mem = S.seen ? (S.seen() || {}) : {};
      var rowId = PREFIX + K;
      var t = nowTs();
      var prev = Number(mem[rowId + "__at"]) || 0;
      if (t <= prev) t = prev + 1;
      S.markSeen(rowId + "__at", t);
      return true;
    } catch (e) {
      return false;
    }
  }

  function stampOf(key) {
    try {
      var S = typeof window !== "undefined" ? window.SyncStore : null;
      if (!S || typeof S.seen !== "function") return 0;
      var mem = S.seen() || {};
      return Number(mem[PREFIX + String(key)] + "__at") || 0;
    } catch (e) {
      return 0;
    }
  }

  window.ReadSync = {
    PREFIX: PREFIX,
    BOOKS: BOOKS,
    MAX: 2000,

    known: known,
    keyOf: keyOf,
    isReadRow: isReadRow,
    rowIdOf: function (key) { return PREFIX + String(key == null ? "" : key); },

    cloudRow: cloudRow,
    applyCloud: applyCloud,
    touch: touch,
    stampOf: stampOf,

    // 所有「本机有东西要推」的行（sync-store 推之前调它）。
    rows: function (seen) {
      var out = [];
      BOOKS.forEach(function (k) {
        var r = null;
        try { r = cloudRow(k, seen) || null; } catch (e) { r = null; }
        if (r) out.push(r);
      });
      return out;
    }
  };
})();

if (typeof module === "object" && module.exports) module.exports = (typeof window !== "undefined" ? window.ReadSync : null);
