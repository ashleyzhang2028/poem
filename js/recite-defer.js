(function () {
  "use strict";

  // 「以后再背」（Issue #481）
  // ---------------------------------------------------------------------------
  // 背诵列表里每一首的播放键右侧多一颗「以后再背」。点一下，这一首就当没排过：
  // 它从今天的计划里下去，**背完这一趟再说**（今天不再冒出来）。
  //
  // 一个动作，两档口径 —— 同一份台账，长短不同：
  //
  //   ① **顺延**（默认，短按）：按作品把日子往后挪一天。今天点一次，明天照旧
  //      出现；明天再点，后天再出现。每天点都只算一天。适合「今天累了 /
  //      这首今天不想背」。
  //   ② **先搁一搁**（长按 / 右键，`rest()`）：这一首**这一阵子先别上榜**。
  //      它就是「课本里还轮不到它、短期也不会背」的那一档 —— 搁 30 天，到
  //      日子自己回来；到期之前每点一次续 30 天。适合「这首诗压根没学过、
  //      可能最近几个月半年都不会学」。
  //
  // 为什么要有②：只靠①「一天一天点」，那些「本来就还轮不到」的诗会**天天**
  // 占住当天的一个位子（每天点掉它，末尾再补一首别的），孩子等于每天要跟它
  // 打一次照面、多做一次判断。这一档不是把诗删掉（名单可以列、可以撤），
  // 只是把「这首我确定暂时不背」这件事说出口。
  //
  // 两种点法都只记**作品号 + 一个日期**，不碰背诵进度里的任何一格（level /
  // nextReviewAt / history 都不动）—— 所以：
  //   · 关掉、刷新、换设备（走同步）都还认得；
  //   · 「清空进度」另有一处显式的「连延后名单一起清」；
  //   · 漏掉几天没点，那几天自然不算延后，不会越攒越多。
  //
  // 排期那边怎么看：拿到一首时问一句 `holdUntil()` —— 给出「该等到哪一天」，
  // 到那天之前它就不上榜（见 js/today-plan.js 与 js/app.js 的 deferToday）。
  // 背诵算法本身一个字不改。
  var KEY = "poem_recite_defer_v1";
  var SYNC_ID = "defer:v1";
  var MAX = 400;

  // 「先搁一搁」搁多久（Issue #481 后续）：一个学期上下。一个月正好是
  // 「这一阵子别上榜」的粒度 —— 太长会把「半年后想背了」也一起挡掉，太短
  // 又变成天天要点。到期自己回来；还没到期再点一次就再续一期（可续）。
  var REST_DAYS = 30;

  function ps() {
    return typeof window !== "undefined" && window.ProgressStore ? window.ProgressStore : null;
  }

  function store() {
    var P = ps();
    if (P && typeof P.store === "function") {
      try {
        var s = P.store();
        if (s) return s;
      } catch (e) {  }
    }
    try {
      return typeof window !== "undefined" ? window.localStorage : null;
    } catch (e) {
      return null;
    }
  }

  function physKey() {
    var P = ps();
    if (P && typeof P.keyFor === "function") {
      try { return P.keyFor(KEY, P.childId ? P.childId() : ""); } catch (e) {  }
    }
    return KEY;
  }

  // 作品号：同一份作品的不同版本（课内教材本 / 集子本）算同一首。
  //
  // 课内那 251 首在目录（SITE_INDEX）里的号是 `poems-` 前缀的
  // （`poems-xx1-01`，`originId` 才是教材里的 `xx1-01`），而它们进每日计划
  // 走的是 `POEMS_ALL` 里的 `xx1-01` —— 同一首两个号。作品主表（WorksIndex）
  // 只归并「不同集子里同文」的那几组，课内这份别名不在里面，所以这里先剥掉
  // `poems-` 再看作品号（两边都剥，正好落在同一个号上）。
  function stripCoursePrefix(id) {
    return String(id || "").replace(/^poems-/, "");
  }

  function widOf(poemOrId) {
    var id = typeof poemOrId === "string" ? poemOrId : (poemOrId && poemOrId.id) || "";
    if (!id) return "";
    var bare = stripCoursePrefix(id);
    if (window.WorksIndex && typeof window.WorksIndex.widOf === "function") {
      try {
        var wid = window.WorksIndex.widOf(bare) || bare;
        return stripCoursePrefix(wid);
      } catch (e) {  }
    }
    return bare;
  }

  function parseDay(str) {
    var m = String(str == null ? "" : str).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  }

  function startOfDay(ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function dayStrOf(ts) {
    var d = new Date(ts);
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  function todayStr(now) {
    return dayStrOf(now === undefined ? Date.now() : now);
  }

  function stampOf() {
    var s = store();
    var raw = null;
    try { raw = s ? s.getItem(physKey()) : null; } catch (e) { raw = null; }
    var v = null;
    try { v = raw ? JSON.parse(raw) : null; } catch (e) { v = null; }
    return v && Number(v.updatedAt) > 0 ? Math.round(Number(v.updatedAt)) : 0;
  }

  function bump(prev) {
    var t = Date.now();
    return t > prev ? t : prev + 1;
  }

  function normalize(data) {
    var seen = {};
    var items = [];
    ((data && data.items) || []).forEach(function (it) {
      if (!it || typeof it !== "object") return;
      var wid = String(it.wid || "");
      var day = String(it.day || "");
      if (!wid || !parseDay(day)) return;
      var k = wid + "@" + day;
      if (seen[k]) return;
      seen[k] = true;
      var row = { wid: wid, day: day, at: Number(it.at) > 0 ? Math.round(Number(it.at)) : 0 };
      // 搁着的那一条另带一个「搁到哪一天」（顺延那条路没有它）——
      // 有它才是「先搁一搁」，没它就是「今天顺延一天」。
      // ⚠️ `until` 一律是 `Y-M-D` 这一种写法（不是毫秒），落盘 / 上云 / 读回来
      // 都走同一个 `dayStrOf()` —— 混两种写法的话，读回来那一趟会被当成
      // 没有 `until`（于是「搁着」这个词只在本机内存里成立，重启就没了）。
      var until = parseDay(it.until);
      if (until != null) {
        row.until = dayStrOf(until);
        var span = Number(it.span);
        row.span = span > 0 ? Math.round(span) : REST_DAYS;
      }
      items.push(row);
    });
    items.sort(function (a, b) {
      if (a.day !== b.day) return a.day < b.day ? -1 : 1;
      return a.wid < b.wid ? -1 : 1;
    });
    // 只留最近这些天点过的（上限到了先丢最旧的）
    if (items.length > MAX) items = items.slice(items.length - MAX);
    return { v: 1, items: items };
  }

  function read() {
    var s = store();
    if (!s) return { v: 1, updatedAt: 0, items: [] };
    var raw = null;
    try { raw = s.getItem(physKey()); } catch (e) { raw = null; }
    if (!raw) return { v: 1, updatedAt: 0, items: [] };
    var data = null;
    try { data = JSON.parse(raw); } catch (e) { data = null; }
    if (!data || typeof data !== "object") return { v: 1, updatedAt: 0, items: [] };
    var out = normalize(data);
    out.updatedAt = Number(data.updatedAt) > 0 ? Math.round(Number(data.updatedAt)) : 0;
    return out;
  }

  // 落盘。调用方（`rest` / `defer` / `unrest` / `clearAll`）**必须交出整条**：
  // 规整 `normalize()` 认全部五格（wid / day / at / until / span），所以入口
  // 处把 `until` 补上就行 —— 从盘上带过来的行用 `read()` 已经读全了，
  // 新补的行由 `rest()` 自己写全。
  function write(items, at) {
    var s = store();
    if (!s) return false;
    var out = normalize({ items: items });
    // 空名单也照落一份带时间戳的空壳：不然「全撤了」这件事上不了云
    out.updatedAt = typeof at === "number" ? at : bump(stampOf());
    try { s.setItem(physKey(), JSON.stringify(out)); } catch (e) {
      return false;
    }
    emit(out.items);
    return true;
  }

  function emit(items) {
    try {
      window.dispatchEvent(new CustomEvent("recite-defer-change", {
        detail: { items: (items || []).slice(), count: (items || []).length }
      }));
    } catch (e) {  }
  }

  // 某一首被延后过几天（按作品算）
  function days(poemOrId) {
    var wid = widOf(poemOrId);
    if (!wid) return 0;
    var n = 0;
    read().items.forEach(function (it) {
      if (it.wid === wid) n += 1;
    });
    return n;
  }

  function has(poemOrId) {
    return days(poemOrId) > 0;
  }

  // 今天点过没有 —— 今天点过就不再多点一次（一天一次就够）
  function deferredToday(poemOrId, now) {
    var wid = widOf(poemOrId);
    if (!wid) return false;
    var today = todayStr(now);
    return read().items.some(function (it) { return it.wid === wid && it.day === today; });
  }

  function defer(poemOrId, now) {
    if (typeof poemOrId !== "string" && !(poemOrId && poemOrId.id)) {
      return { ok: false, code: "E_NO_POEM", days: 0 };
    }
    var wid = widOf(poemOrId);
    if (!wid) return { ok: false, code: "E_NO_POEM", days: 0 };
    if (deferredToday(wid, now)) {
      return { ok: true, added: false, days: days(wid) };
    }
    var data = read();
    data.items.push({ wid: wid, day: todayStr(now), at: Date.now() });
    if (!write(data.items)) return { ok: false, code: "E_STORAGE", days: days(wid) };
    return { ok: true, added: true, days: days(wid) };
  }

  // 「先搁一搁」（长按 / 右键那一档）：不再一天一天点，一次说到底。
  //
  // 台账里它仍是**一条记录**，只是「搁到哪一天」写在 `until` 上（顺延那条路
  // 不写 `until`，所以两条路不打架、互不叠算）。到日子自己回来；没到再点一次
  // 就往后**续**一期（`until` 往后推 REST_DAYS，不是再记一条）。
  //
  // 已经搁着的这一期**不重复记**：同一天连点两次没意义，返回 `added: false`
  // 并把当前 `until` 带回去，界面照旧能说「搁到哪天」。
  function rest(poemOrId, now, opt) {
    if (typeof poemOrId !== "string" && !(poemOrId && poemOrId.id)) {
      return { ok: false, code: "E_NO_POEM", days: REST_DAYS, until: null };
    }
    var wid = widOf(poemOrId);
    if (!wid) return { ok: false, code: "E_NO_POEM", days: REST_DAYS, until: null };
    var t = now === undefined ? Date.now() : now;
    var o = opt || {};
    var span = Number(o.days) > 0 ? Math.round(Number(o.days)) : REST_DAYS;
    var data = read();
    var found = null;
    data.items.forEach(function (it) {
      if (it.wid === wid && it.until) found = it;
    });
    if (found) {
      // 已经搁着：同一天不再续（一次点击只算一次），换一天点才续
      var sameDayAsRest = found.day === todayStr(t);
      if (!sameDayAsRest) {
        found.until = dayStrOf(startOfDay(found.until) + span * 24 * 60 * 60 * 1000);
        found.day = todayStr(t);
        if (!write(data.items)) {
          return { ok: false, code: "E_STORAGE", days: span, until: found.until };
        }
        return { ok: true, added: true, extended: true, days: span, until: found.until };
      }
      return { ok: true, added: false, extended: false, days: span, until: found.until };
    }
    var until = dayStrOf(startOfDay(t) + span * 24 * 60 * 60 * 1000);
    data.items.push({
      wid: wid,
      day: todayStr(t),
      until: until,
      span: span,
      at: t
    });
    if (!write(data.items)) return { ok: false, code: "E_STORAGE", days: span, until: null };
    return { ok: true, added: true, days: span, until: until };
  }

  // 撤掉「先搁一搁」，今天当场回来（长按菜单里那一颗「撤掉」）
  function unrest(poemOrId) {
    var wid = widOf(poemOrId);
    if (!wid) return false;
    var data = read();
    var before = data.items.length;
    data.items = data.items.filter(function (it) {
      return !(it.wid === wid && it.until);
    });
    if (data.items.length === before) return false;
    write(data.items);
    return true;
  }

  // 撤销今天顺延的这一次（孩子点了又后悔）。搁着的那一条不动 —— 那一条要撤
  // 走 `unrest()`，它跟「今天的顺延」不是一件事。
  function undo(poemOrId, now) {
    var wid = widOf(poemOrId);
    if (!wid) return false;
    var today = todayStr(now);
    var data = read();
    var before = data.items.length;
    data.items = data.items.filter(function (it) {
      return !(it.wid === wid && it.day === today && !it.until);
    });
    if (data.items.length === before) return false;
    write(data.items);
    return true;
  }

  function clearAll() {
    var data = read();
    var n = data.items.length;
    write([]);
    return n;
  }

  // 一首今天该不该压着不排 —— 要压就回「该等到哪一天」（当天 0 点的时间戳），
  // 不压回 null。
  //
  // 一次延后 = 往后挪一天：点的那一天（含当天）先不见，第二天照旧。
  // 今天已经背掉的（有 lastReviewAt）不压 —— 它本来就该留在计划里，压下去
  // 只会让「今天背过」的那一格凭空消失。
  function holdUntil(poemOrId, rec, now) {
    if (rec && rec.lastReviewAt) return null;
    var wid = widOf(poemOrId);
    if (!wid) return null;
    var t0 = startOfDay(now === undefined ? Date.now() : now);
    var until = null;
    var last = null;
    read().items.forEach(function (it) {
      if (it.wid !== wid) return;
      // 「先搁一搁」：搁到哪一天，就压到哪一天（到期自己回来）
      var rest = parseDay(it.until);
      if (rest != null) {
        if (until == null || rest > until) until = rest;
        return;
      }
      var ts = parseDay(it.day);
      // 「顺延一天」：只认今天及今天的点法 —— 昨天的那一次今天已经顺过去了，
      // 不该再往后推
      if (ts != null && ts <= t0) last = ts;
    });
    // 两档取更远的那个：搁着的期间里又点了一次顺延，仍按搁到的日子算
    var deferred = last == null ? null : last + 24 * 60 * 60 * 1000;
    if (until != null && (deferred == null || until > deferred)) return until;
    return deferred;
  }

  // 这一首是不是「搁着」（有 until 且还没到期）—— 界面与列表要用
  function resting(poemOrId, now) {
    if (!has(poemOrId)) return false;
    var wid = widOf(poemOrId);
    var t0 = startOfDay(now === undefined ? Date.now() : now);
    var out = false;
    read().items.forEach(function (it) {
      if (it.wid !== wid || !it.until) return;
      var rest = parseDay(it.until);
      if (rest != null && rest > t0) out = true;
    });
    return out;
  }

  // 搁到哪一天（搁着才有；没搁着回 null）。界面拿它说「搁到 X 月 X 日」
  function restUntil(poemOrId, now) {
    if (!has(poemOrId)) return null;
    var wid = widOf(poemOrId);
    var t0 = startOfDay(now === undefined ? Date.now() : now);
    var out = null;
    read().items.forEach(function (it) {
      if (it.wid !== wid || !it.until) return;
      var rest = parseDay(it.until);
      if (rest != null && rest > t0 && (out == null || rest > out)) out = rest;
    });
    return out;
  }

  function holdToday(poemOrId, rec, now) {
    var until = holdUntil(poemOrId, rec, now);
    if (until == null) return false;
    return until > startOfDay(now === undefined ? Date.now() : now);
  }

  function count() { return read().items.length; }

  function items() { return read().items.slice(); }

  // ---- 上云（与「今日加背」同一套口径：账号域、按作品比对、时间戳取新的） ----
  function cloudRow(seen) {
    var s = store();
    if (!s) return null;
    var raw = null;
    try { raw = s.getItem(physKey()); } catch (e) { raw = null; }

    var mem = seen || {};
    var known = Number(mem[SYNC_ID]) || 0;

    if (!raw) {
      if (known > 0) {
        var t = Date.now();
        if (t <= known) t = known + 1;
        return { id: SYNC_ID, payload: { v: 1, items: [], updatedAt: t }, updatedAt: t, deleted: true };
      }
      return null;
    }

    var data = null;
    try { data = JSON.parse(raw); } catch (e) { data = null; }
    if (!data || !Array.isArray(data.items)) return null;

    var ts = Number(data.updatedAt) > 0 ? Math.round(Number(data.updatedAt)) : 0;
    if (ts <= known) return null;
    return { id: SYNC_ID, payload: JSON.parse(raw), updatedAt: ts, deleted: false };
  }

  function applyCloud(row, seen) {
    var payload = (row && row.payload) || null;
    if (!payload || typeof payload !== "object") return "skip";
    // 老客户端推上来的行没有 `until` / `span`（那时候只有「顺延一天」），
    // 这里一律当它们没有 —— 服务端白名单只放 `wid/day/at`，是新旧同表的缘故

    var mem = seen || {};
    var known = Number(mem[SYNC_ID]) || 0;
    var cloudTs = Number(row && row.updatedAt) > 0 ? Math.round(Number(row.updatedAt)) : 0;
    var s = store();
    var raw = null;
    try { raw = s ? s.getItem(physKey()) : null; } catch (e) { raw = null; }
    var local = null;
    try { local = raw ? JSON.parse(raw) : null; } catch (e) { local = null; }
    var localItems = normalize(local).items;

    if (row.deleted) {
      if (!localItems.length) return "skip";
      if (known >= cloudTs) return "skip";
      try { if (s) s.setItem(physKey(), JSON.stringify({ v: 1, updatedAt: cloudTs, items: [] })); }
      catch (e) {  }
      emit([]);
      return "applied";
    }

    var merged = localItems.slice();
    var have = {};
    merged.forEach(function (it) { have[it.wid + "@" + it.day] = true; });
    var cloudItems = normalize({ items: payload.items }).items;
    var added = 0;
    cloudItems.forEach(function (it) {
      var k = it.wid + "@" + it.day;
      if (have[k]) return;
      have[k] = true;
      merged.push(it);
      added += 1;
    });
    if (!added) return "skip";

    var out = normalize({ items: merged });
    out.updatedAt = Math.max(cloudTs, 0);
    try { s.setItem(physKey(), JSON.stringify(out)); } catch (e) { return "skip"; }
    emit(out.items);
    return "applied";
  }

  window.ReciteDefer = {
    KEY: KEY,
    SYNC_ID: SYNC_ID,
    MAX: MAX,
    REST_DAYS: REST_DAYS,

    physKey: physKey,
    widOf: widOf,
    list: items,
    count: count,
    days: days,
    has: has,
    holdUntil: holdUntil,
    holdToday: holdToday,
    deferredToday: deferredToday,
    defer: defer,
    rest: rest,
    unrest: unrest,
    resting: resting,
    restUntil: restUntil,
    undo: undo,
    clear: clearAll,

    cloudRow: cloudRow,
    applyCloud: applyCloud
  };
})();
