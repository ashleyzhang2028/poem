(function () {
  "use strict";

  // 「注音勘误」的数据层（Issue #243 · 用户报《滕王阁序》的「长」注错）。
  //
  // 问题：注音是**按字查表 + 按词消歧**算出来的（data/pinyin-table.js +
  // js/pinyin.js 里那份词表）。表里「长: zhǎng/cháng」有两个读音，
  // 词表只列了「长啸 / 长大 / 长相思」几个词 —— 于是「秋水共长天一色」的
  // 「长」掉进兜底分支（取第一个读音 zhǎng），读错了。
  //
  // 这类错有两个特点：①只发生在**具体的某一篇**里（同一个字在别处可能没错）；
  // ②**永远补不完**（词表再补，也会遇到新篇目里的新词）。
  // 所以正确的做法不是「把唐诗宋词里的词都塞进词表」，而是开一个**勘误层**：
  // 记「某一篇 · 某一句 · 第几个字 → 读什么」，可在管理页面增删、随账号同步、
  // 改完立刻生效 —— 不改代码、不发版。
  //
  // 三条边界（改一条都有一层测试直接红）：
  //   · **按篇绑定**：这个字在《滕王阁序》里读 cháng，别处该读什么不受影响。
  //   · **按句定位**：只认那一句里的那一处，不是把整篇的字一起改掉
  //     （「长」在《滕王阁序》里出现好几次，各读各的）。
  //   · **按位移定位**：一句里可能有两个相同的字（「长洲」与「长天」），
  //     所以还带一个「这一句里第几次出现」的下标。
  //
  // 键名：本机 `poem_pinyin_fix_v1`（跟孩子走：一个家长几个孩子可以各有各的
  // 勘误口径）；云端在 progress 里一行 `pinyin_fix:v1`。
  // 云端合并规则与自选集合同源（**谁最后改谁赢**）：勘误表是整份一份数据，
  // 按条并起来会得到一份「一半是本机编的、一半是云端编的」的表，
  // 而用户在看的时候必须看到**一个**确定的结果。

  var KEY = "poem_pinyin_fix_v1";

  // 云端那一行的 poem_id（它是 progress 里的一行，不是新表）。
  // 与 js/sync-store.js、api/_lib/core.js 的 PINYIN_FIX_ROW_ID 逐字一致。
  var SYNC_ID = "pinyin_fix:v1";

  var MAX = 500;

  var LINE_MAX = 120;

  var PY_MAX = 12;

  function ps() {
    return typeof window !== "undefined" && window.ProgressStore ? window.ProgressStore : null;
  }

  function physKey() {
    var P = ps();
    if (P && typeof P.keyFor === "function") {
      try { return P.keyFor(KEY, P.childId ? P.childId() : ""); } catch (e) {  }
    }
    return KEY;
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

  function nowTs() { return Date.now(); }

  function read() {
    var s = store();
    var raw = null;
    try { raw = s ? s.getItem(physKey()) : null; } catch (e) { raw = null; }
    var o = null;
    try { o = raw ? JSON.parse(raw) : null; } catch (e) { o = null; }
    if (!o || typeof o !== "object") return { v: 1, updatedAt: 0, fixes: [] };
    return { v: 1, updatedAt: Number(o.updatedAt) || 0, fixes: normList(o.fixes) };
  }

  function writeFix(data, at) {
    var s = store();
    if (!s) return false;
    var out = { v: 1, updatedAt: Number(at) || nowTs(), fixes: normList(data && data.fixes) };
    try {
      if (!out.fixes.length) s.removeItem(physKey());
      else s.setItem(physKey(), JSON.stringify(out));
    } catch (e) {
      return false;
    }
    return out;
  }

  // 一条勘误只有五个字段：哪一篇（wid）、哪一句（line）、这一句里第几次出现
  // （at）、那是什么字（ch，冗余存一份，好让管理页不用回头翻正文）、读什么（py）。
  function normOne(f) {
    if (!f || typeof f !== "object") return null;
    var wid = String(f.wid == null ? "" : f.wid).trim().slice(0, 80);
    var line = String(f.line == null ? "" : f.line).trim().slice(0, LINE_MAX);
    var py = String(f.py == null ? "" : f.py).trim().slice(0, PY_MAX);
    var ch = String(f.ch == null ? "" : f.ch).trim().slice(0, 1);
    if (!wid || !line || !py) return null;
    var at = Number(f.at);
    at = isFinite(at) && at >= 0 ? Math.round(at) : 0;
    return { wid: wid, line: line, at: at, ch: ch, py: py };
  }

  function normList(list) {
    if (!Array.isArray(list)) return [];
    var seen = {};
    var out = [];
    list.forEach(function (f) {
      var o = normOne(f);
      if (!o) return;
      var k = keyOf(o);
      if (seen[k]) return;
      seen[k] = 1;
      out.push(o);
    });
    return out.slice(0, MAX);
  }

  function keyOf(f) {
    var o = (f && typeof f === "object") ? f : { wid: f };
    return String(o.wid == null ? "" : o.wid) + "\u0000" +
           String(o.line == null ? "" : o.line) + "\u0000" +
           String(Number(o.at) || 0);
  }

  function stamp() {
    var prev = read().updatedAt;
    var t = nowTs();
    return t <= prev ? prev + 1 : t;
  }

  // 改动一律走这里：写盘 + 推时间戳 + 通知界面。
  function commit(fixes) {
    var out = writeFix({ fixes: fixes }, stamp());
    if (out) emit();
    return out;
  }

  function add(patch) {
    var o = normOne(patch);
    if (!o) return { ok: false, reason: "bad" };
    var cur = read().fixes;
    var k = keyOf(o);
    var hit = false;
    var next = cur.map(function (f) {
      if (keyOf(f) !== k) return f;
      hit = true;
      return o;
    });
    if (!hit) next.push(o);
    if (next.length > MAX) return { ok: false, reason: "full", max: MAX };
    commit(next);
    return { ok: true, fix: o, replaced: hit };
  }

  function remove(key) {
    var k = String(typeof key === "object" && key ? keyOf(key) : key || "");
    if (!k) return { ok: false, reason: "missing" };
    var cur = read().fixes;
    var next = cur.filter(function (x) { return keyOf(x) !== k; });
    if (next.length === cur.length) return { ok: false, reason: "missing" };
    commit(next);
    return { ok: true, removed: cur.length - next.length };
  }

  function removeMany(keys) {
    var set = {};
    (keys || []).forEach(function (k) { set[String(k)] = 1; });
    var cur = read().fixes;
    var next = cur.filter(function (x) { return !set[keyOf(x)]; });
    var n = cur.length - next.length;
    if (!n) return { ok: false, reason: "missing" };
    commit(next);
    return { ok: true, removed: n };
  }

  function clear() {
    var n = read().fixes.length;
    if (!n) return { ok: true, removed: 0 };
    commit([]);
    return { ok: true, removed: n };
  }

  // 查一篇的勘误表：`一句\u0000第几次` → 读音。
  // 引擎每一步注音只建一次这张表（不是每个字查一遍）。
  function mapOf(wid) {
    var w = String(wid == null ? "" : wid);
    var out = {};
    if (!w) return out;
    read().fixes.forEach(function (f) {
      if (f.wid !== w) return;
      out[f.line + "\u0000" + f.at] = f.py;
    });
    return out;
  }

  function count() { return read().fixes.length; }

  function list() { return read().fixes.slice(); }

  function updatedAt() { return read().updatedAt; }

  function emit() {
    try {
      if (typeof window === "undefined" || !window.dispatchEvent) return;
      var ev = null;
      if (typeof window.CustomEvent === "function") ev = new window.CustomEvent("pinyin-fix-change");
      else if (window.Event) ev = new window.Event("pinyin-fix-change");
      if (ev) window.dispatchEvent(ev);
    } catch (e) {  }
  }

  // 云端那一行（`pinyin_fix:v1`）。返回 null 表示「本机没东西要推」。
  function cloudRow(seen) {
    var data = read();
    var rowId = SYNC_ID;
    var okTs = Number((seen || {})[rowId]) || 0;
    var ts = Number(data.updatedAt) || 0;
    if (ts <= okTs) {
      // 本机这一份是**刚同步下来的**（本机一个字都没改）—— 别拿 Date.now()
      // 去盖，否则每一轮都把同一份内容又推上去一次（死循环）。
      if (!okTs) ts = nowTs();
      else return null;
    }
    return {
      id: rowId,
      payload: { v: 1, fixes: data.fixes, updatedAt: ts },
      updatedAt: ts,
      deleted: !data.fixes.length
    };
  }

  // 云端那一行并进本机（整份一份数据：谁最后改谁赢）。
  function applyCloud(row, seen) {
    var payload = (row && row.payload) || null;
    if (!payload || typeof payload !== "object") return "skip";
    var rowId = SYNC_ID;
    var knownTs = Number((seen || {})[rowId]) || 0;
    var cloudTs = Number(row && row.updatedAt) > 0 ? Math.round(Number(row.updatedAt)) : 0;
    if (cloudTs && cloudTs === knownTs && !row.deleted) return "skip";

    var local = read();
    // 本机这一份比云端新 —— 不动（下一次推送会把云端那一行盖过来）。
    if (cloudTs && local.updatedAt && cloudTs < local.updatedAt) return "keepLocal";

    var out = writeFix({ fixes: row.deleted ? [] : payload.fixes }, cloudTs || local.updatedAt);
    if (!out) return "skip";
    emit();
    return "applied";
  }

  window.PinyinFix = {
    KEY: KEY,
    SYNC_ID: SYNC_ID,
    MAX: MAX,
    LINE_MAX: LINE_MAX,
    PY_MAX: PY_MAX,

    physKey: physKey,
    read: read,
    list: list,
    count: count,
    updatedAt: updatedAt,
    mapOf: mapOf,
    keyOf: keyOf,
    normOne: normOne,

    add: add,
    remove: remove,
    removeMany: removeMany,
    clear: clear,
    emit: emit,

    cloudRow: cloudRow,
    applyCloud: applyCloud
  };
})();

if (typeof module === "object" && module.exports) module.exports = (typeof window !== "undefined" ? window.PinyinFix : null);
