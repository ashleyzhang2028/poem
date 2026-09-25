(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Quiz = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var PUNCT = /[。！？；，、：·…—～「」『』（）《》〈〉“”‘’"'()\[\]【】!?;:,.]/;

  function isPunct(ch) { return PUNCT.test(ch); }

  function splitLines(text) {
    var src = String(text == null ? "" : text);
    var out = [];

    src.split(/[。！？\n]+/).forEach(function (big) {
      big.split(/[，、：;；]+/).forEach(function (small) {
        var s = small.replace(/[「」『』“”‘’"'()（）《》〈〉\[\]【】]/g, "").trim();
        if (s) out.push(s);
      });
    });
    return out;
  }

  function hanOf(s) {
    return String(s == null ? "" : s).split("").filter(function (ch) {
      return isHan(ch);
    });
  }

  function isHan(ch) {
    var c = String(ch || "").charCodeAt(0);
    return c >= 0x3400 && c <= 0x9fff;
  }

  function sourceOf(p) {
    var bits = [];
    if (p && p.gradeGroup) bits.push(p.gradeGroup);
    else if (p && p.selection) bits.push(p.selection);
    else if (p && p.book) bits.push(p.book);
    if (p && p.dynasty) bits.push(p.dynasty);
    if (p && p.author) bits.push(p.author);
    return bits.filter(Boolean).join(" · ");
  }

  // 同一篇的正文重复切分是这一层最贵的一步：`lines()` / `candidates()` /
  // `flyFlower()` 一行一行地把同一批篇目扫一遍，而每一篇的正文本就在手边。
  // 切分结果只由**正文**决定（与篇名 / 作者无关），所以按正文缓存一次就够：
  // 出题内核是「同样输入同样输出」的纯函数，这一层缓存不改变任何结果，
  // 只是不再把同一句话切两遍。
  var SPLIT_CACHE = {};

  function splitCached(text) {
    var key = String(text == null ? "" : text);
    var hit = SPLIT_CACHE[key];
    if (hit) return hit;

    hit = splitLines(key);
    // 语料是有限的（全站也就两千来篇），不必考虑淘汰
    SPLIT_CACHE[key] = hit;
    return hit;
  }

  var LINES_CACHE = [];

  function linesFingerprint(poems) {
    var src = poems || [];
    var s = "";
    for (var i = 0; i < src.length; i++) {
      var p = src[i];
      s += (p && p.id ? p.id : "") + "\u0001" +
        (p && p.text ? p.text : "") + "\u0002";
    }
    return src.length + ":" + s;
  }

  // `lines()` 是这一层被叫得最多的一个函数（candidates 扫一遍、每一句令字
  // 又扫一遍），而它的结果**只由传进来的那批篇目决定**。出题内核是纯函数，
  // 缓存不改变任何结果，只是不再把同一批语料切十遍。
  function lines(poems) {
    var fp = linesFingerprint(poems);
    for (var c = 0; c < LINES_CACHE.length; c++) {
      if (LINES_CACHE[c].fp === fp) return LINES_CACHE[c].rows;
    }
    var rows = buildLines(poems);
    LINES_CACHE.push({ fp: fp, rows: rows });
    // 语料是有限的，留两三批就够（正常调用方就那么几批：课内 / 课外 / 两批合起来）
    if (LINES_CACHE.length > 4) LINES_CACHE.shift();
    return rows;
  }

  function buildLines(poems) {
    var out = [];
    (poems || []).forEach(function (p) {
      if (!p || !p.id) return;
      var seen = {};
      splitCached(p.text).forEach(function (s) {
        if (seen[s]) return;
        seen[s] = 1;
        out.push({
          id: p.id,
          title: p.title || "",
          author: p.author || "",
          dynasty: p.dynasty || "",
          text: s,
          source: sourceOf(p)
        });
      });
    });
    return out;
  }

  function candidates(poems, opt) {
    var o = opt || {};
    var min = o.min == null ? 6 : o.min;
    var rows = lines(poems);
    var freq = {};
    var poemsOf = {};
    rows.forEach(function (r) {
      var seen = {};
      hanOf(r.text).forEach(function (ch) {
        if (seen[ch]) return;
        seen[ch] = 1;
        freq[ch] = (freq[ch] || 0) + 1;
        (poemsOf[ch] || (poemsOf[ch] = {}))[r.id] = 1;
      });
    });
    return Object.keys(freq).filter(function (ch) {
      return freq[ch] >= min && Object.keys(poemsOf[ch]).length >= 2;
    }).sort(function (a, b) {
      return freq[b] - freq[a] || (a < b ? -1 : 1);
    });
  }

  function flyFlower(o) {
    var opt = o || {};
    var chars = (opt.chars || [opt.char]).filter(Boolean).map(String);
    var excl = {};
    (opt.exclude || []).forEach(function (id) { excl[id] = 1; });
    var limit = opt.limit == null ? 0 : Number(opt.limit);

    var byChar = {};
    chars.forEach(function (c) { byChar[c] = 0; });

    var rows = [];
    lines(opt.poems).forEach(function (r) {
      if (excl[r.id]) return;
      var hit = chars.filter(function (c) { return r.text.indexOf(c) >= 0; });
      if (!hit.length) return;
      hit.forEach(function (c) { byChar[c] += 1; });
      rows.push({
        id: r.id, title: r.title, author: r.author, dynasty: r.dynasty,
        text: r.text, source: r.source, hit: hit
      });
    });

    rows.sort(function (a, b) {
      return b.hit.length - a.hit.length || a.text.length - b.text.length ||
        (a.id < b.id ? -1 : 1);
    });
    var count = rows.length;
    if (limit > 0) rows = rows.slice(0, limit);
    return { chars: chars, rows: rows, count: count, byChar: byChar };
  }

  function buildBank(poems, o) {
    var opt = o || {};
    var perPoem = opt.perPoem == null ? 1 : Number(opt.perPoem);
    var bank = [];
    (poems || []).forEach(function (p) {
      if (!p || !p.id) return;
      var ss = splitCached(p.text);
      if (ss.length < 2) return;

      var pairs = [];
      for (var i = 0; i < ss.length - 1; i += 1) {
        if (ss[i] !== ss[i + 1]) pairs.push(i);
      }
      if (!pairs.length) return;
      var n = Math.min(perPoem, pairs.length);
      for (var k = 0; k < n; k += 1) {
        var at = pairs[k];
        bank.push({
          id: p.id + "#" + k,
          poemId: p.id,
          title: p.title || "",
          author: p.author || "",
          dynasty: p.dynasty || "",
          source: sourceOf(p),
          stem: ss[at],
          answer: ss[at + 1]
        });
      }
    });
    return bank;
  }

  function pick(o) {
    var opt = o || {};
    var bank = opt.bank || [];
    if (!bank.length) return null;
    var want = opt.options == null ? 4 : Number(opt.options);

    var q = null;
    if (opt.id != null) {
      for (var i = 0; i < bank.length; i++) if (bank[i].id === opt.id) { q = bank[i]; break; }
    } else {
      var at = Number(opt.at == null ? 0 : opt.at) % bank.length;
      q = bank[at];
    }
    if (!q) return null;

    var avoid = {};
    (opt.avoid || []).forEach(function (pid) { avoid[pid] = 1; });
    avoid[q.poemId] = 1;

    var answer = q.answer;
    var pool = bank.filter(function (x) {
      if (x.poemId === q.poemId) return false;
      if (avoid[x.poemId]) return false;
      if (x.answer === answer) return false;
      if (Math.abs(x.answer.length - answer.length) > (opt.tolerance == null ? 4 : Number(opt.tolerance))) return false;
      if (overlap(x.answer, answer) > 0.5) return false;
      return true;
    });

    if (pool.length < want - 1) {
      pool = pool.concat(bank.filter(function (x) {
        if (x.poemId === q.poemId || avoid[x.poemId]) return false;
        if (x.answer === answer) return false;
        return overlap(x.answer, answer) <= 0.5 && !pool.some(function (y) { return y.id === x.id; });
      }));
    }

    var seen = {};
    seen[answer] = 1;
    var bag = [];
    pool.forEach(function (x) {
      if (seen[x.answer]) return;
      seen[x.answer] = 1;
      bag.push(x.answer);
    });
    bag = shuffle(bag, String(opt.seed == null ? q.id : opt.seed));

    var options = bag.slice(0, Math.max(0, want - 1));
    options.push(answer);
    options = shuffle(options, String(opt.seed == null ? q.id : opt.seed) + "|opt");

    return {
      id: q.id,
      poemId: q.poemId,
      title: q.title,
      author: q.author,
      dynasty: q.dynasty,
      source: q.source,
      stem: q.stem,
      options: options,
      answerIndex: options.indexOf(answer),
      answer: answer
    };
  }

  function overlap(a, b) {
    var A = hanOf(a), B = hanOf(b);
    if (!A.length || !B.length) return 0;
    var set = {};
    B.forEach(function (c) { set[c] = 1; });
    var same = 0;
    var mark = {};
    A.forEach(function (c) { if (set[c] && !mark[c]) { mark[c] = 1; same += 1; } });
    return same / Math.min(A.length, B.length);
  }

  function shuffle(arr, seed) {
    var out = arr.slice();
    var s = 2166136261;
    String(seed == null ? "" : seed).split("").forEach(function (ch) {
      s ^= ch.charCodeAt(0);
      s = (s * 16777619) >>> 0;
    });
    for (var i = out.length - 1; i > 0; i -= 1) {
      s = (s * 1103515245 + 12345) >>> 0;
      var j = s % (i + 1);
      var t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }

  function paper(o) {
    var opt = o || {};
    var size = Math.max(1, Number(opt.size == null ? 5 : opt.size));
    var bank = shuffle(opt.bank || [], String(opt.seed == null ? "paper" : opt.seed));
    var out = [];
    var used = {};
    for (var i = 0; i < bank.length && out.length < size; i += 1) {
      if (used[bank[i].poemId]) continue;
      var q = pick({
        bank: opt.bank || [],
        id: bank[i].id,
        options: opt.options,
        avoid: Object.keys(used),
        seed: String(opt.seed == null ? "paper" : opt.seed) + "#" + out.length
      });
      if (!q || q.answerIndex < 0) continue;
      used[bank[i].poemId] = 1;
      out.push(q);
    }
    return out;
  }

  function grade(q, chosen) {
    if (!q) return { ok: false, why: "noAnswer" };
    var pick = chosen == null ? "" : String(chosen);
    if (!pick) return { ok: false, why: "empty" };
    return { ok: pick === String(q.answer), why: pick === String(q.answer) ? "ok" : "wrong" };
  }

  function charSummary(poems, chars) {
    var ff = flyFlower({ poems: poems, chars: chars });
    var parts = chars.map(function (c) {
      return c + " " + (ff.byChar[c] || 0) + " 句";
    });
    return { total: ff.count, byChar: ff.byChar, text: parts.join(" · ") };
  }

  return {
    splitLines: splitLines,
    hanOf: hanOf,
    isHan: isHan,
    lines: lines,
    candidates: candidates,
    flyFlower: flyFlower,
    buildBank: buildBank,
    pick: pick,
    paper: paper,
    grade: grade,
    overlap: overlap,
    shuffle: shuffle,
    charSummary: charSummary,
    sourceOf: sourceOf
  };
});
