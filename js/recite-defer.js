(function () {
  "use strict";

  // 「以后再背」（Issue #481）
  // ---------------------------------------------------------------------------
  // 背诵列表里每一首的播放键右侧，原先只有**一颗**「以后再背」——短按顺延一天、
  // 长按 / 右键这一阵子先别上榜。手机上长按与右键都很难用（长按时页面会选中
  // 文字、右键更是没有），所以现在拆成两颗明说的键：
  //
  //   ① **明日再背**（`defer`）：这一首从明天的计划里下去，后天照旧排队。
  //      适合「今天累了 / 这首今天不想背」。
  //   ② **月后再背**（`rest`）：这一首这一阵子先别上榜 —— 课本里还轮不到它、
  //      短期也不会背的那一档。搁 30 天，到日子自己回来；到期之前每点一次续 30 天。
  //
  // 为什么要有②：只靠①「一天一天点」，那些「本来就还轮不到」的诗会**天天**
  // 占住当天的一个位子（每天点掉它，末尾再补一首别的），孩子等于每天要跟它
  // 打一次照面、多做一次判断。这一档不是把诗删掉（「我的」页可以列、可以撤），
  // 只是把「这首我确定暂时不背」这件事说出口。
  //
  // 两种点法都只记**作品号 + 一个日期**（月后再背那条另带 `until` / `span`），
  // 不碰背诵进度里的任何一格（level / nextReviewAt / history 都不动）—— 所以：
  //   · 关掉、刷新、换设备（走同步）都还认得；
  //   · 「清空进度」另有一处显式的「连延后名单一起清」；
  //   · 漏掉几天没点，那几天自然不算延后，不会越攒越多。
  //
  // 排期那边怎么看：拿到一首时问一句 `holdUntil()` —— 给出「该等到哪一天」，
  // 到那天之前它就不上榜（见 js/today-plan.js 与 js/app.js 的 deferToday）。
  // 背诵算法本身一个字不改。

  var KEY = "poem_recite_defer_v1";
  // 作品号 → 一条「拿它来读」的稿子（页面注入：从课内主表 / 全站目录里现查）。
  // 名单要给人看，光有作品号不够；注入而不是内置，是因为这一层不该知道全站
  // 目录长什么样。
  var refOf = null;
  function useRef(fn) { refOf = typeof fn === "function" ? fn : null; }
  // 两个档位的名字（`span` 是这一档搁多少天：1 = 明日、30 = 月后）
  var DEFER_DAY = "day";
  var DEFER_MONTH = "month";
  var SYNC_ID = "defer:v1";
  var MAX = 400;

  // 「月后再背」搁多久（Issue #481）：一个月。一天太少（那是「明日再背」），
  // 再长会把「半年后想背了」也一起挡掉；到期自己回来，还没到期再点一次就再
  // 续一期（可续）。
  var REST_DAYS = 30;

  // 「明日再背」搁到哪天：点它的**第二天**。不是「从今天起一天」——
  // 差一天的话，明天一打开它还在，等于没点。
  var DEFER_DAYS = 1;

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

  // 「到哪一天为止不排」的落库写法：当天 0 点的 `Y-M-D`。
  // 两档都往 `until` 上写，所以哪天回来这件事只有一个出口（`holdUntil`）。
  function keepStr(now, days) {
    var t0 = startOfDay(now === undefined ? Date.now() : now);
    return dayStrOf(t0 + days * 24 * 60 * 60 * 1000);
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
    var items = [];
    ((data && data.items) || []).forEach(function (it) {
      if (!it || typeof it !== "object") return;
      var wid = String(it.wid || "");
      var day = String(it.day || "");
      if (!wid || !parseDay(day)) return;
      var at = Number(it.at) > 0 ? Math.round(Number(it.at)) : 0;
      var row = { wid: wid, day: day, at: at };
      // 每一条都带一个「搁到哪一天」（`until`）与「搁多少天」（`span`）——
      // 两档的区别只在这两个数：`span` 1 天 = 明日再背、30 天 = 月后再背。
      // 老条目（拆档之前只有「顺延一天」那条路）没有这两格，按明日补上。
      //
      // ⚠️ `until` 一律是 `Y-M-D` 这一种写法（不是毫秒），落盘 / 上云 / 读回来
      // 都走同一个 `dayStrOf()` —— 混两种写法的话，读回来那一趟会被当成
      // 没有 `until`（于是「搁着」这个词只在本机内存里成立，重启就没了）。
      var until = parseDay(it.until);
      var span = Number(it.span);
      span = span > 0 ? Math.round(span) : DEFER_DAYS;
      if (until == null) until = parseDay(day) + span * 24 * 60 * 60 * 1000;
      row.until = dayStrOf(until);
      row.span = span;
      items.push(row);
    });

    // 同一个人在**同一档**上只留最近点的那一次（`.day` 最新、`at` 最新）——
    // 一档一个状态，不攒历史。档位之间互不影响（今天说明日、明天改说月后，
    // 两条并存）。
    var byKey = {};
    items.forEach(function (it) {
      var k = it.wid + "@" + it.span;
      var prev = byKey[k];
      if (!prev || it.day > prev.day || (it.day === prev.day && it.at >= prev.at)) {
        byKey[k] = it;
      }
    });
    items = Object.keys(byKey).map(function (k) { return byKey[k]; });
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

  // 落盘。调用方（`defer` / `rest` / `unrest` / `clearAll`）**必须交出整条**：
  // 规整 `normalize()` 认全部五格（wid / day / at / until / span），缺的它会
  // 按档位补齐 —— 从盘上带过来的行用 `read()` 已经读全了。
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

  // 「明日再背」：今天点一下，明天的计划里不再有它（后天照旧排队）。
  //
  // 台账里就是**一条**「作品号 + 点它的那一天 + 搁到哪天」，与「月后再背」
  // 同一张表、同一个出口（`until`）—— 两档都是「哪天之前不排」，只是日子
  // 长短不同。同一天在**同一档**上再点一次不叠算（一次点击只算一天）；
  // 换一档（今天先说明日、明天又改说月后）则以改口那次为准，`until` 重写。
  function defer(poemOrId, now) {
    if (typeof poemOrId !== "string" && !(poemOrId && poemOrId.id)) {
      return { ok: false, code: "E_NO_POEM", days: 0 };
    }
    var wid = widOf(poemOrId);
    if (!wid) return { ok: false, code: "E_NO_POEM", days: 0 };
    var t = now === undefined ? Date.now() : now;
    var data = read();
    var until = keepStr(t, DEFER_DAYS);
    if (deferredToday(wid, t)) {
      return { ok: true, added: false, days: days(wid), until: until };
    }
    var found = null;
    data.items.forEach(function (it) {
      if (it.wid === wid && it.span === DEFER_DAYS) found = it;
    });
    if (found) {
      // 同一档、换一天再点：那一天也顺延下去（原先「顺延一天」那条路）
      found.day = todayStr(t);
      found.at = t;
      found.until = until;
      if (!write(data.items)) {
        return { ok: false, code: "E_STORAGE", days: days(wid), until: until };
      }
      return { ok: true, added: true, extended: true, days: days(wid), until: until };
    }
    data.items.push({ wid: wid, day: todayStr(t), at: t, until: until, span: DEFER_DAYS });
    if (!write(data.items)) return { ok: false, code: "E_STORAGE", days: days(wid), until: until };
    return { ok: true, added: true, days: days(wid), until: until };
  }

  // 「月后再背」：不再一天一天点，一次说到底。
  //
  // 台账里它仍是**一条记录**，「搁到哪一天」写在 `until` 上。到日子自己回来；
  // 没到再点一次就往后**续**一期（`until` 往后推 REST_DAYS，不是再记一条）——
  // 「月后」是一个可续的档，不是只能点一次。
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
      if (it.wid === wid && it.span !== DEFER_DAYS) found = it;
    });
    if (found) {
      // 已经搁着：同一天不再续（一次点击只算一次），换一天点才续
      var sameDayAsRest = found.day === todayStr(t);
      if (!sameDayAsRest) {
        found.until = dayStrOf(startOfDay(found.until) + span * 24 * 60 * 60 * 1000);
        found.day = todayStr(t);
        found.span = span;
        found.at = t;
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

  // 某一条的档位（`month` = 月后再背、`day` = 明日再背）。`span === 1` 是日档。
  function tierOf(it) {
    return it && it.span === DEFER_DAYS ? DEFER_DAY : DEFER_MONTH;
  }

  // 撤掉某一档，当场回到正常次序 —— 「我的」页那两个名单上的「删除」、
  // 详情页与弹卡片上的「撤掉」都走它。不传 `tier` 就两档一起撤。
  function unrest(poemOrId, tier) {
    var wid = widOf(poemOrId);
    if (!wid) return false;
    var hit = function (it) {
      if (it.wid !== wid) return false;
      return !tier || tierOf(it) === tier;
    };
    var data = read();
    var before = data.items.length;
    data.items = data.items.filter(function (it) { return !hit(it); });
    if (data.items.length === before) return false;
    write(data.items);
    return true;
  }

  // 清空整份台账。顺带把 `refOf` 摘掉 —— 它闭着页面的取值函数，
  // 留着会把那一页（连同它的全站目录）钉在内存里。
  function clearAll() {
    var data = read();
    var n = data.items.length;
    write([]);
    refOf = null;
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
    var until = null;
    read().items.forEach(function (it) {
      if (it.wid !== wid) return;
      var ts = parseDay(it.until);
      if (ts != null && (until == null || ts > until)) until = ts;
    });
    return until;
  }

  // 这一首在某档上是不是压着（那档还没到期）—— 界面与列表要用
  function restingTier(poemOrId, tier, now) {
    if (!has(poemOrId)) return false;
    var wid = widOf(poemOrId);
    var t0 = startOfDay(now === undefined ? Date.now() : now);
    var out = false;
    read().items.forEach(function (it) {
      if (it.wid !== wid || tierOf(it) !== tier) return;
      var ts = parseDay(it.until);
      if (ts != null && ts > t0) out = true;
    });
    return out;
  }

  function resting(poemOrId, now) { return restingTier(poemOrId, DEFER_MONTH, now); }

  // 那一档压到哪一天（压着才有；没压着回 null）。界面拿它说「X 月 X 日再上榜」
  function restUntil(poemOrId, now, tier) {
    if (!has(poemOrId)) return null;
    var wid = widOf(poemOrId);
    var t0 = startOfDay(now === undefined ? Date.now() : now);
    var t = tier || DEFER_MONTH;
    var out = null;
    read().items.forEach(function (it) {
      if (it.wid !== wid || tierOf(it) !== t) return;
      var ts = parseDay(it.until);
      if (ts != null && ts > t0 && (out == null || ts > out)) out = ts;
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

  // 「我的」页那两个名单：按档列出来，一人一条（同一条只带一个档位）。
  //
  // 每条都回一份**稿子**（标题 / 作者 / 朝代），不是只有作品号 —— 名单要给人
  // 看、要能点回去读；稿子由 `refOf()` 注入（页面把目录与课内主表给它）。
  //
  // 到期的**不列**：日子一到它就自己上榜了，还挂在名单上会让人以为「它没回来」。
  function listByTier(tier, now) {
    var t = tier || DEFER_MONTH;
    var t0 = startOfDay(now === undefined ? Date.now() : now);
    var out = [];
    read().items.forEach(function (it) {
      if (tierOf(it) !== t) return;
      var ts = parseDay(it.until);
      if (ts == null || ts <= t0) return;
      var wid = widOf(it.wid);
      var row = {
        wid: wid,
        tier: t,
        day: it.day,
        until: ts,
        untilStr: it.until,
        span: Number(it.span) > 0 ? Math.round(Number(it.span)) : DEFER_DAYS,
        at: it.at
      };
      var ref = null;
      if (typeof refOf === "function") {
        try { ref = refOf(wid); } catch (e) { ref = null; }
      }
      if (!ref || !ref.title) return;
      row.id = ref.id || wid;
      row.title = ref.title;
      row.author = ref.author || "";
      row.dynasty = ref.dynasty || "";
      row.grade = Number(ref.grade) || 0;
      row.term = Number(ref.term) || 0;
      out.push(row);
    });
    out.sort(function (a, b) {
      if (a.until !== b.until) return a.until - b.until;
      return a.title < b.title ? -1 : 1;
    });
    return out;
  }

  function countByTier(tier, now) { return listByTier(tier, now).length; }

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
    DEFER_DAYS: DEFER_DAYS,
    DEFER_DAY: DEFER_DAY,
    DEFER_MONTH: DEFER_MONTH,

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
    restingTier: restingTier,
    restUntil: restUntil,
    listByTier: listByTier,
    countByTier: countByTier,
    useRef: useRef,
    tierOf: tierOf,
    clear: clearAll,

    cloudRow: cloudRow,
    applyCloud: applyCloud
  };
})();
